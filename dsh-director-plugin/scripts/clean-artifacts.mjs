#!/usr/bin/env node
/**
 * clean-artifacts.mjs —— 清理运行产物（截图 / 一次性中间件 / 垃圾目录）
 *
 * 🔴 默认 **dry-run**（纪律 81：清理一条命令 + 默认 dry-run，看清单再决定）。
 *    加 `--apply` 才真删。删除项**逐条打印并落清单**（`logs/_deleted-<ts>.txt`）。
 *
 * 清理范围（**只碰产物，不碰源码 / 资产 / 台账**）：
 *   ① 全部截图：`**\*.png` / `**\*.bmp`（本仓所有 png 都只在 logs/ 下，assets 无 png —— 实测）
 *   ② `dsh-director-plugin/logs/` 下 `_` 前缀的一次性中间件（.log/.txt/.json/.expr/.exit/.out）
 *      ⚠️ 白名单保留：`_test-ledger*`（免重跑台账 = 机器真相源）
 *   ③ `scripts/__pycache__/`（Python 字节码缓存）
 *   ④ 已进回收站的垃圾目录：项目根 `.trash-*`、`~/.dsh` 下的 `.trash-*`（后者含 markdown 粘贴事故文件）
 *
 * **不删**：`logs/test-ledger.json`（台账）· `logs/playwright-tests/`（git 跟踪）·
 *          非 `_` 前缀的 `*.txt`/`*.log` 证据日志 · `src/**` · `assets/**` · 一切 git 跟踪文件。
 *
 * 用法：node scripts/clean-artifacts.mjs [--apply]
 */
import { readdirSync, statSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const APPLY = process.argv.includes("--apply");
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, "..");           // dsh-director-plugin
const ROOT = resolve(PLUGIN, "..");           // 仓库根
const KEEP_RE = /^_test-ledger/;

const files = [];   // {path, size, why}
const dirs = [];    // {path, why}
const reportOnly = [];  // 只报告、不删（用户数据）

const sum = (a) => a.reduce((s, x) => s + (x.size || 0), 0);
const fmt = (b) => (b / 1048576).toFixed(2) + " MB";
/** 目录递归体积（MB） */
const MB = (d) => {
	let t = 0;
	try {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			t += e.isDirectory() ? MB(p) : (statSync(p).size || 0);
		}
	} catch (e) { /* ignore */ }
	return t;
};

function walkFiles(d, skip) {
	let es;
	try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
	for (const e of es) {
		const p = join(d, e.name);
		if (e.isDirectory()) {
			if (e.name === "node_modules" || e.name === ".git" || (skip && skip.has(p))) continue;
			walkFiles(p, skip);
			continue;
		}
		const r = relative(ROOT, p).replace(/\\/g, "/");
		let size = 0;
		try { size = statSync(p).size; } catch (e2) { /* ignore */ }
		if (/\.(png|bmp)$/i.test(e.name)) { files.push({ path: p, size: size, why: "截图" }); continue; }
		if (/^dsh-director-plugin\/logs\//.test(r) && /^_/.test(e.name) && /\.(log|txt|json|expr|exit|out)$/i.test(e.name)) {
			if (KEEP_RE.test(e.name)) continue;
			files.push({ path: p, size: size, why: "一次性中间件" });
		}
	}
}

const skipTrees = new Set([join(PLUGIN, "logs", "playwright-tests")]);
walkFiles(ROOT, skipTrees);

/* Python 字节码缓存整目录 */
function walkPycache(d) {
	let es;
	try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
	for (const e of es) {
		const p = join(d, e.name);
		if (!e.isDirectory()) continue;
		if (e.name === "node_modules" || e.name === ".git") continue;
		if (e.name === "__pycache__") { dirs.push({ path: p, why: "Python 字节码缓存" }); continue; }
		walkPycache(p);
	}
}
walkPycache(ROOT);

/* 回收站目录
 * 🔴 **只清项目内的**。`~/.dsh` 下的 `.trash-*` 里装的是**宿主会话档案**
 *    （`sessions ... session.jsonl.zstd`）—— 那是**用户数据**，不是可再生的产物；
 *    永久删除不可逆 ⇒ **只报告、不删**（想要清就加 `--include-host-trash` 显式授权）。 */
const HOST_TRASH = process.argv.includes("--include-host-trash");
for (const base of [ROOT, join(homedir(), ".dsh")]) {
	const isHost = base.indexOf("dsh") > -1 && base !== ROOT;
	if (isHost && !HOST_TRASH) {
		let es2;
		try { es2 = readdirSync(base, { withFileTypes: true }); } catch (e) { continue; }
		for (const e of es2) if (e.isDirectory() && /^\.trash-/.test(e.name)) {
			const p = join(base, e.name);
			reportOnly.push({ path: p, size: MB(p) });
		}
		continue;
	}
	let es;
	try { es = readdirSync(base, { withFileTypes: true }); } catch (e) { continue; }
	for (const e of es) {
		if (e.isDirectory() && /^\.trash-/.test(e.name)) dirs.push({ path: join(base, e.name), why: "已进回收站的垃圾" });
	}
}

console.log("模式：" + (APPLY ? "🔴 APPLY（真删）" : "dry-run（只列清单）"));
console.log("");
console.log("[① 截图] " + files.filter((f) => f.why === "截图").length + " 个 / " + fmt(sum(files.filter((f) => f.why === "截图"))));
console.log("[② 一次性中间件] " + files.filter((f) => f.why === "一次性中间件").length + " 个 / " + fmt(sum(files.filter((f) => f.why === "一次性中间件"))));
let dsize = 0;
for (const d of dirs) dsize += MB(d.path);
console.log("[③ 目录] " + dirs.length + " 个 / " + fmt(dsize));
for (const d of dirs) console.log("      " + d.why + "  " + relative(ROOT, d.path).replace(/\\/g, "/"));
if (reportOnly.length) {
	console.log("");
	console.log("[④ 只报告 · 未删] " + reportOnly.length + " 个 / " + fmt(reportOnly.reduce((s, x) => s + x.size, 0))
		+ "  —— 内含**宿主会话档案**（用户数据，需你点头才动）");
	for (const d of reportOnly) console.log("      " + d.path + "  " + fmt(d.size));
}

const lines = ["# 清理清单 " + new Date().toISOString(), "", "## 文件"];
for (const f of files) lines.push(f.why + "\t" + f.size + "\t" + relative(ROOT, f.path).replace(/\\/g, "/"));
lines.push("", "## 目录");
for (const d of dirs) lines.push(d.why + "\t" + relative(ROOT, d.path).replace(/\\/g, "/"));

if (!APPLY) {
	console.log("");
	console.log("（dry-run 结束，未删除任何东西。加 --apply 执行）");
	process.exit(0);
}

let n = 0, bytes = 0;
for (const f of files) {
	try { rmSync(f.path, { force: true }); n++; bytes += f.size; } catch (e) { console.log("  ⚠️ 删不掉 " + f.path + " :: " + e.message); }
}
for (const d of dirs) {
	const before = MB(d.path);
	try { rmSync(d.path, { recursive: true, force: true }); n++; bytes += before; } catch (e) { console.log("  ⚠️ 删不掉 " + d.path + " :: " + e.message); }
}
try { mkdirSync(join(PLUGIN, "logs"), { recursive: true }); } catch (e) { /* ignore */ }
const mf = join(PLUGIN, "logs", "_deleted-" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt");
writeFileSync(mf, lines.join("\n") + "\n", "utf8");
console.log("");
console.log("✅ 删除 " + n + " 项 / 回收 " + fmt(bytes));
console.log("   清单已落盘：" + relative(ROOT, mf).replace(/\\/g, "/"));
