#!/usr/bin/env node
/**
 * clean-sessions.mjs —— 清理 Harness 的**全部会话**（可回滚：先移入 `.trash-<ts>`）
 *
 * ── 为什么要有这个脚本（根因，不是一次性需求）──────────────────────
 *   2026-09-16 用户在第十九轮反馈：「重复创建了一百多个会话」。
 *   这类累积**至少发生过两次**，而每次手工清理都要重新摸一遍"会话到底存哪几处"。
 *   本脚本把那次摸索的结论固化下来。
 *
 * ── 会话的**三处落点**（少清一处就会留下"点开是空的幽灵会话"）────────
 *   ① `~/.dsh/sessions/<工作区目录>/<session-xxx>/`   ← 真身（磁盘）
 *   ② `~/.dsh/storages/workspace.json`
 *        · `global.archivedSessionIds`     归档列表（不清 ⇒ 幽灵会话）
 *        · `tables.workspaces.*.sessionIds` 工作区登记表（**不清 ⇒ 侧栏仍然列出**）
 *   ③ `~/.dsh/storages/session_projcache.json`
 *        · `tables.sessions`               标题/统计投影缓存（纯缓存，清了会自动重建）
 *
 * 🔴 **不碰** `~/.dsh/profiles/` 与 cookie —— 那是**应用身份（登录态）**，不是应用数据。
 *    「清对话」和「清登录态」是两件事（锚点 §八 第 59 条）。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   node scripts/clean-sessions.mjs                 # **dry-run**（只报清单与数量，不动盘）
 *   node scripts/clean-sessions.mjs --apply         # 真清（移入 .trash-<ts> 后可回滚）
 *   node scripts/clean-sessions.mjs --apply --keep 1  # 保留最近 1 个会话（给真机脚本留起点）
 *   node scripts/clean-sessions.mjs --verbose       # 连每条会话目录名一起列
 *
 * 🔴 **会话目录有两种命名纪元**（2026-09-16 实测，漏一种就漏一半）：
 *      `session-<uuid>`（117 条）与 `<uuid>`（裸 UUID，14 条，内含 `session.jsonl.zstd`）。
 *    只按 `session-` 前缀过滤 ⇒ 清完还剩 14 个，且宿主会话数**看起来**只降了一半。
 *
 * 退出码：0 = 成功（dry-run 也算成功）；1 = 执行/复核失败；2 = 用法错（纪律 17、34）
 *
 * 🔴 复核是**必做**的（不是可选）：删完必须回读三处数量，任一非 0 即 exit 1。
 *    否则"看起来清干净了"与"真清干净了"分不出来（纪律 15 的同型要求）。
 */
import { readdirSync, statSync, existsSync, mkdirSync, renameSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
	console.log("用法：node scripts/clean-sessions.mjs [--apply] [--keep N] [--verbose]");
	process.exit(0);
}
const APPLY = argv.includes("--apply");
const VERBOSE = argv.includes("--verbose");
const keepIdx = argv.indexOf("--keep");
let KEEP = 0;
if (keepIdx >= 0) {
	const v = Number(argv[keepIdx + 1]);
	if (!Number.isFinite(v) || v < 0 || Math.floor(v) !== v) {
		console.error("用法错：--keep 需要一个非负整数");
		process.exit(2);
	}
	KEEP = v;
}
const unknown = argv.filter((a, i) => a.startsWith("-") && a !== "--apply" && a !== "--verbose" && !(keepIdx >= 0 && i === keepIdx + 1));
if (unknown.length) {
	console.error("用法错：不认识的参数 " + unknown.join(" ") + "（--help 看用法）");
	process.exit(2);
}

const DSH = join(homedir(), ".dsh");
const SESS_ROOT = join(DSH, "sessions");
const STORAGES = join(DSH, "storages");
const WS_JSON = join(STORAGES, "workspace.json");
const PC_JSON = join(STORAGES, "session_projcache.json");

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const TS = String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate())
	+ "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
const TRASH = join(DSH, ".trash-" + TS);

function readJson(p) {
	try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return null; }
}

/**
 * 会话目录名判据：`session-<uuid>` **或** 裸 `<uuid>`（两种命名纪元都存在）。
 * 两者都以"一段 8-4-4-4-12 的十六进制"结尾 —— 用这个当共同特征，避免漏掉一种。 */
const SESSION_DIR_RE = /^(?:session-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 磁盘口径：`sessions/<工作区>/<会话目录>` */
function diskInventory() {
	const out = { projects: [], total: 0 };
	if (!existsSync(SESS_ROOT)) return out;
	for (const proj of readdirSync(SESS_ROOT)) {
		const dir = join(SESS_ROOT, proj);
		let st = null;
		try { st = statSync(dir); } catch (e) { continue; }
		if (!st.isDirectory()) continue;
		const kids = readdirSync(dir).filter((n) => SESSION_DIR_RE.test(n));
		out.projects.push({ proj: proj, dir: dir, names: kids });
		out.total += kids.length;
	}
	return out;
}

/** 取每个会话的目录 mtime，用于 `--keep N` 挑"最近 N 个" */
function withMtime(dir, names) {
	return names.map((n) => {
		let m = 0;
		try { m = statSync(join(dir, n)).mtimeMs; } catch (e) { /* 留着 0，排最后 */ }
		return { name: n, m: m };
	});
}

function main() {
	const disk = diskInventory();
	const ws = readJson(WS_JSON);
	const pc = readJson(PC_JSON);
	const wsIds = ws ? Object.keys(ws.tables && ws.tables.workspaces ? ws.tables.workspaces : {})
		.reduce((a, k) => a.concat((ws.tables.workspaces[k].sessionIds || [])), []) : [];
	const archived = ws && ws.global && Array.isArray(ws.global.archivedSessionIds) ? ws.global.archivedSessionIds : [];
	const pcN = pc && pc.tables && pc.tables.sessions ? Object.keys(pc.tables.sessions).length : 0;

	console.log("═══ 清理前清点（三处落点）═══");
	console.log("  ① 磁盘   " + SESS_ROOT);
	disk.projects.forEach((p) => console.log("        " + p.proj + "  " + p.names.length + " 个"));
	console.log("     → 磁盘合计 " + disk.total);
	console.log("  ② workspace.json  sessionIds " + wsIds.length + " 条 ｜ archivedSessionIds " + archived.length + " 条");
	console.log("  ③ session_projcache.json  tables.sessions " + pcN + " 条（纯缓存）");

	/* 选中要移走的：按 mtime 降序，跳掉最近 KEEP 个（**全局**保留，跨工作区一起排） */
	const all = [];
	disk.projects.forEach((p) => withMtime(p.dir, p.names).forEach((x) => all.push({ proj: p.proj, dir: p.dir, name: x.name, m: x.m })));
	all.sort((a, b) => b.m - a.m);
	const keepSet = new Set(all.slice(0, KEEP).map((x) => x.name));
	const move = all.filter((x) => !keepSet.has(x.name));
	console.log("  选中移走 " + move.length + " 个" + (KEEP ? "（保留最近 " + KEEP + " 个：" + [...keepSet].map((s) => s.slice(0, 18)).join(", ") + "）" : ""));
	if (VERBOSE) move.slice(0, 40).forEach((x) => console.log("        " + x.proj + "/" + x.name));

	if (!APPLY) {
		console.log("\n（dry-run：**没有动任何文件**。确认无误后加 --apply 执行）");
		console.log("可回滚性：执行时全部移入 " + TRASH + "，不删除。");
		return 0;
	}
	if (!move.length && wsIds.length === 0 && archived.length === 0 && pcN === 0) {
		console.log("\n已经没有任何会话与登记，无需清理。");
		return 0;
	}

	/* ── 执行 ─────────────────────────────────────────────── */
	console.log("\n═══ 执行（移入 " + TRASH + "，不删除）═══");
	mkdirSync(join(TRASH, "sessions"), { recursive: true });
	mkdirSync(join(TRASH, "storages"), { recursive: true });

	let moved = 0, failed = 0;
	for (const x of move) {
		const from = join(x.dir, x.name);
		const toDir = join(TRASH, "sessions", x.proj);
		try {
			mkdirSync(toDir, { recursive: true });
			renameSync(from, join(toDir, x.name));
			moved++;
		} catch (e) {
			failed++;
			console.error("  ✗ 移走失败 " + x.proj + "/" + x.name + "：" + e.message);
		}
	}
	console.log("  ① 磁盘：移走 " + moved + " 个，失败 " + failed + " 个");

	/* ②③ 两个 json：**先备份到 trash，再原地改**（原地改 = 先读 → 全内存改 → 校验 → 再写） */
	if (ws) {
		copyFileSync(WS_JSON, join(TRASH, "storages", "workspace.json"));
		const keptIds = ws.global.archivedSessionIds || [];
		ws.global.archivedSessionIds = [];
		Object.keys(ws.tables.workspaces).forEach((k) => { ws.tables.workspaces[k].sessionIds = []; });
		writeFileSync(WS_JSON, JSON.stringify(ws, null, "\t"), "utf8");
		console.log("  ② workspace.json：清空 sessionIds " + wsIds.length + " 条 + archivedSessionIds " + keptIds.length + " 条（已备份）");
	}
	if (pc) {
		copyFileSync(PC_JSON, join(TRASH, "storages", "session_projcache.json"));
		pc.tables.sessions = {};
		writeFileSync(PC_JSON, JSON.stringify(pc, null, "\t"), "utf8");
		console.log("  ③ session_projcache.json：清空 tables.sessions " + pcN + " 条（已备份）");
	}

	/* ── 复核（必做）─────────────────────────────────────── */
	console.log("\n═══ 复核（回读三处，任一非 0 即失败）═══");
	const d2 = diskInventory();
	const ws2 = readJson(WS_JSON);
	const pc2 = readJson(PC_JSON);
	const ws2Ids = ws2 ? Object.keys(ws2.tables.workspaces).reduce((a, k) => a.concat(ws2.tables.workspaces[k].sessionIds || []), []) : [];
	const arch2 = (ws2 && ws2.global && ws2.global.archivedSessionIds) || [];
	const pc2N = pc2 && pc2.tables.sessions ? Object.keys(pc2.tables.sessions).length : 0;
	console.log(" ① 磁盘 " + d2.total + " ｜ ② sessionIds " + ws2Ids.length + " · archived " + arch2.length + " ｜ ③ 缓存 " + pc2N);
	const ok = d2.total === KEEP && ws2Ids.length === 0 && arch2.length === 0 && pc2N === 0 && failed === 0;
	console.log(" 结果：" + (ok ? "✅ 已清空（保留 " + KEEP + " 个）" : "❌ 未达预期"));
	console.log("\n回滚方法：把 " + TRASH + "\\sessions\\* 移回 " + SESS_ROOT + "，两个 json 从 " + TRASH + "\\storages 覆盖回 " + STORAGES);
	console.log("⚠️ 应用**正在运行时**清盘：Harness 内存里还留着旧列表 ⇒ 必须 `Page.reload`（或重启）才会反映为 0。");
	return ok ? 0 : 1;
}

process.exit(main());
