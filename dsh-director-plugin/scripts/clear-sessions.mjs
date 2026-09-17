#!/usr/bin/env node
/**
 * clear-sessions.mjs —— **清空宿主会话**（用户指令：「清除所有的会话」）+ 可选截图。
 *
 * ══════════════════════════════════════════════════════════════════
 * 清的是**宿主自己的会话档案**（不是产品源码、不是 git 内容）：
 *   ① `~/.dsh/sessions/**`   —— 会话包（每个目录一份 `session.jsonl.zstd`，170 份 / 13 MB）
 *   ② `~/.dsh/.trash-*`      —— 宿主自己回收站里的会话档案（7 个 / 38 MB）
 *   ③ `~/.dsh/storages/session_projcache.json` —— 会话工程缓存（可再生）
 *   ④ `~/.dsh/storages/workspace.json` 里的 `archivedSessionIds` —— 指向已删会话的索引
 *      （**必须一起清**：留索引指空 ⇒ 下次启动按老列表找不存在的会话）
 *
 * 🔴 纪律：
 *   · **默认 dry-run**，`--apply` 才真删（纪律 81）
 *   · 删之前先**打包成一个 tar.gz 备份**，并把它在哪写进结论句（纪律 83 破窗退路）
 *   · **应用在跑时拒绝执行**（进程存在 ⇒ 退出码 2）—— 改动运行中的库会留下半态
 *   · 删完**立刻复验计数**（不是"发出删除命令"就算数）
 *
 * 用法：node scripts/clear-sessions.mjs [--apply] [--shots] [--no-backup]
 *   退出码：0 成功（或 dry-run）· 1 有失败项 · 2 前提不成立（应用在跑）
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";

const APPLY = process.argv.includes("--apply");
const SHOTS = process.argv.includes("--shots");
const NO_BACKUP = process.argv.includes("--no-backup");

const DSH = join(homedir(), ".dsh");
const REPO = join(import.meta.dirname, "..", "..");
const PLUG = join(import.meta.dirname, "..");
const ARCHIVE = join(REPO, ".workbuddy", "_archive");
const IMG = "DeepSeek Harness.exe";

function alive() {
	try {
		const o = execFileSync("tasklist", ["/FI", "IMAGENAME eq " + IMG, "/FO", "CSV", "/NH"], { encoding: "utf8" });
		return o.split(/\r?\n/).filter((l) => l.toUpperCase().includes(IMG.toUpperCase())).length;
	} catch (e) { return -1; }
}
const mb = (b) => (b / 1048576).toFixed(2) + " MB";
function treeSize(p) {
	let t = 0, n = 0;
	const walk = (d) => {
		let es; try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
		for (const e of es) { const q = join(d, e.name); if (e.isDirectory()) walk(q); else { try { t += statSync(q).size; n++; } catch (_) { } } }
	};
	if (!existsSync(p)) return { t: 0, n: 0 };
	const st = statSync(p);
	if (!st.isDirectory()) return { t: st.size, n: 1 };
	walk(p);
	return { t, n };
}

const run = alive();
console.log("══ 清空宿主会话 ══");
console.log("  模式：" + (APPLY ? "🔴 APPLY（真删）" : "dry-run（只列清单）"));
console.log("  宿主进程数 = " + run);
if (run !== 0) {
	console.log("  ❌ 应用正在运行，拒绝清理（先关掉它，或跑 `node scripts/start-harness.mjs --stop`）");
	process.exit(2);
}

/* ── 清点 ── */
const targets = [];
const sessRoot = join(DSH, "sessions");
if (existsSync(sessRoot)) {
	for (const d of readdirSync(sessRoot, { withFileTypes: true })) {
		if (!d.isDirectory()) continue;
		targets.push({ path: join(sessRoot, d.name), why: "会话包目录（profile 根）", keepDir: false });
	}
}
for (const d of readdirSync(DSH, { withFileTypes: true })) {
	if (d.isDirectory() && /^\.trash-/.test(d.name)) targets.push({ path: join(DSH, d.name), why: "宿主回收站里的会话档案", keepDir: false });
}
const projCache = join(DSH, "storages", "session_projcache.json");
const wsJson = join(DSH, "storages", "workspace.json");

let sessN = 0, sessB = 0;
for (const t of targets) { const s = treeSize(t.path); sessN += s.n; sessB += s.t; }
console.log("");
console.log("── ① 会话与回收站（" + targets.length + " 个目录 / " + sessN + " 个文件 / " + mb(sessB) + "）──");
for (const t of targets) console.log("   " + String(t.path).replace(homedir(), "~") + "   [" + t.why + "]");
const pc = treeSize(projCache);
console.log("── ② 会话工程缓存：" + (existsSync(projCache) ? mb(pc.t) + "  " + projCache.replace(homedir(), "~") : "（不存在）"));
let archivedN = -1;
try { archivedN = (JSON.parse(readFileSync(wsJson, "utf8")).global || {}).archivedSessionIds?.length ?? -1; } catch (e) { }
console.log("── ③ 会话索引 archivedSessionIds = " + archivedN + " 条（" + wsJson.replace(homedir(), "~") + "）");

/* ── 截图（--shots）── */
const shots = [];
if (SHOTS) {
	const dirs = [join(PLUG, "logs")];
	for (const d of dirs) {
		if (!existsSync(d)) continue;
		const walk = (p) => {
			for (const e of readdirSync(p, { withFileTypes: true })) {
				const q = join(p, e.name);
				if (e.isDirectory()) { if (e.name !== "node_modules") walk(q); continue; }
				if (/\.(png|jpg|webp)$/i.test(e.name) || /^index\.json$/.test(e.name)) shots.push(q);
			}
		};
		walk(d);
	}
	console.log("");
	console.log("── ④ 截图/清单（--shots）：" + shots.length + " 个 / " + mb(shots.reduce((s, f) => s + (statSync(f).size || 0), 0)) + " ──");
	for (const f of shots.slice(0, 20)) console.log("   " + relative(PLUG, f).replace(/\\/g, "/"));
	if (shots.length > 20) console.log("   …（另 " + (shots.length - 20) + " 个）");
}

/* ── 备份 → 删除 ── */
const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
const bk = join(ARCHIVE, "dsh-sessions-" + stamp + ".tar.gz");
let backupOk = false;
if (APPLY && !NO_BACKUP && targets.length) {
	mkdirSync(ARCHIVE, { recursive: true });
	const posix = (p) => String(p).split("\\").join("/");
	const list = targets.map((t) => relative(DSH, t.path)).concat(existsSync(projCache) ? ["storages/session_projcache.json"] : []);
	try {
		execFileSync("tar", ["-czf", posix(bk), "-C", posix(DSH)].concat(list), { stdio: "ignore" });
		backupOk = existsSync(bk);
		console.log("");
		console.log("  📦 备份：" + bk.replace(homedir(), "~") + "  " + (backupOk ? mb(statSync(bk).size) : "❌ 失败"));
	} catch (e) { console.log("  ⚠️ 备份失败（" + e.message.slice(0, 80) + "）—— 继续删除，请知悉"); }
}

let failed = 0;
if (APPLY) {
	for (const t of targets) {
		try { rmSync(t.path, { recursive: true, force: true }); } catch (e) { failed++; console.log("  ❌ 删不掉 " + t.path + "：" + e.message.slice(0, 90)); }
	}
	if (existsSync(projCache)) { try { rmSync(projCache, { force: true }); } catch (e) { failed++; console.log("  ❌ 缓存删不掉：" + e.message.slice(0, 90)); } }
	if (archivedN > 0) {
		try {
			copyFileSync(wsJson, wsJson + ".bak-" + stamp);
			const j = JSON.parse(readFileSync(wsJson, "utf8"));
			if (j.global) j.global.archivedSessionIds = [];
			writeFileSync(wsJson, JSON.stringify(j), "utf8");
		} catch (e) { failed++; console.log("  ❌ 索引清不掉：" + e.message.slice(0, 90)); }
	}
	for (const f of shots) { try { rmSync(f, { force: true }); } catch (e) { failed++; } }
}

/* ── 复验 ── */
let leftN = 0, leftB = 0;
if (existsSync(sessRoot)) {
	for (const d of readdirSync(sessRoot, { withFileTypes: true })) { const s = treeSize(join(sessRoot, d.name)); leftN += s.n; leftB += s.t; }
}
let trashN = readdirSync(DSH, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\.trash-/.test(e.name)).length;
console.log("");
console.log("── 复验（" + (APPLY ? "清理后" : "dry-run 未改动") + "）──");
console.log("   sessions/ 剩余文件 = " + leftN + " / " + mb(leftB) + "（原 " + sessN + " / " + mb(sessB) + "）");
console.log("   .trash-* 剩余目录 = " + trashN);
console.log("   session_projcache.json 存在 = " + existsSync(projCache));
console.log("   archivedSessionIds 条数 = " + (() => { try { return (JSON.parse(readFileSync(wsJson, "utf8")).global || {}).archivedSessionIds?.length ?? -1; } catch (e) { return "读取失败"; } })());
if (SHOTS) console.log("   截图剩余 = " + shots.filter((f) => existsSync(f)).length);
console.log("");
if (!APPLY) console.log("  ℹ️ 这是 dry-run —— 加 `--apply`" + (SHOTS ? " --shots" : "（清截图再加 --shots）") + " 才真删。");
else console.log("  ✅ 完成" + (failed ? "（" + failed + " 项失败）" : "") + (backupOk ? "　退路：备份在 " + bk : ""));
process.exit(failed ? 1 : 0);
