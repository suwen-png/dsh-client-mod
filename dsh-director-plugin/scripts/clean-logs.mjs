#!/usr/bin/env node
/**
 * clean-logs.mjs —— 清掉 `logs/` 里**没人再引用**的历史产物（默认 dry-run）。
 *
 * 判据（不是"看着像垃圾"就删 —— 纪律 33「删之前查所有引用者」）：
 *   ① **文档引用即保留**：文件名或相对路径出现在 `docs/**`（md/html）、`AGENTS.md`、
 *      `INDEX.md`、`README.md` 里 ⇒ 它是取证链的一环，不许删。
 *   ② **常驻台账/诊断日志永远保留**：`test-ledger.json`（免重跑的唯一真相源）、
 *      `harness-launch.log` 与 `_harness-launch*.out`（"打开闪退"的证词）。
 *   ③ 其余 ⇒ 候选删除（清单落 `logs/_del-candidates.txt`，逐条可查）。
 *
 * 用法：node scripts/clean-logs.mjs [--apply]
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ROOT = path.join(import.meta.dirname, "..");
const LOGS = path.join(ROOT, "logs");
const REPO = path.join(ROOT, "..");
const KEEP_ALWAYS = [/^test-ledger\.json$/, /^harness-launch\.log$/, /^_harness-launch.*\.out$/, /^_del-candidates\.txt$/];
const mb = (b) => (b / 1048576).toFixed(2) + " MB";

function walk(d, out) {
	for (const e of readdirSync(d, { withFileTypes: true })) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) { if (e.name === "_archive") continue; walk(p, out); }
		else out.push(p);
	}
	return out;
}

/* 文档全文（引用白名单的来源） */
const docs = [];
(function w(d) {
	if (!existsSync(d)) return;
	for (const e of readdirSync(d, { withFileTypes: true })) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) { if (e.name !== "node_modules") w(p); }
		else if (/\.(md|html)$/.test(e.name)) docs.push(p);
	}
})(path.join(REPO, "docs"));
for (const f of ["AGENTS.md", "INDEX.md", "README.md"]) if (existsSync(path.join(REPO, f))) docs.push(path.join(REPO, f));
let text = "";
for (const f of docs) { try { text += readFileSync(f, "utf8"); } catch (e) { } }

const files = walk(LOGS, []);
const keep = [], del = [];
for (const f of files) {
	const rel = path.relative(LOGS, f).split("\\").join("/");
	const base = path.basename(f);
	if (KEEP_ALWAYS.some((re) => re.test(base))) { keep.push({ f, why: "常驻台账/诊断日志" }); continue; }
	if (text.includes("logs/" + rel) || text.includes(rel) || text.includes(base)) { keep.push({ f, why: "被文档引用" }); continue; }
	del.push(f);
}
let tot = 0, db = 0;
for (const f of files) tot += statSync(f).size || 0;
for (const f of del) db += statSync(f).size || 0;

console.log("══ 清理 logs/ 里没人引用的历史产物 ══");
console.log("  模式：" + (APPLY ? "🔴 APPLY（真删）" : "dry-run（只列清单）"));
console.log("  logs/ 共 " + files.length + " 个文件 / " + mb(tot) + "；文档 " + docs.length + " 篇参与判定");
console.log("  保留 " + keep.length + " 个（" + keep.slice(0, 6).map((k) => path.basename(k.f)).join(" ") + " …）");
console.log("  候选删除 " + del.length + " 个 / " + mb(db));
writeFileSync(path.join(LOGS, "_del-candidates.txt"), del.map((f) => path.relative(ROOT, f).split("\\").join("/")).join("\n"), "utf8");

if (APPLY) {
	/* 🔴 破坏性动作自带退路（纪律 83）：先打包到一个归档，再把路径写进结论句 */
	let bk = null;
	if (del.length) {
		const dir = path.join(REPO, ".workbuddy", "_archive");
		bk = path.join(dir, "logs-" + new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + ".tar.gz");
		const listFile = path.join(LOGS, "_del-list.txt");
		writeFileSync(listFile, del.map((f) => path.relative(LOGS, f).split("\\").join("/")).join("\n"), "utf8");
		try {
			execFileSync("tar", ["-czf", bk.split("\\").join("/"), "-C", LOGS.split("\\").join("/"), "-T", listFile.split("\\").join("/")], { stdio: "ignore" });
		} catch (e) { bk = null; console.log("  ⚠️ 归档失败（" + String(e.message).slice(0, 70) + "）—— 继续删除"); }
		try { rmSync(listFile, { force: true }); } catch (e) { }
		if (bk) console.log("  📦 退路（归档）：" + path.relative(REPO, bk).split("\\").join("/") + "  " + mb(statSync(bk).size));
	}
	let n = 0, fail = 0;
	for (const f of del) { try { rmSync(f, { force: true }); n++; } catch (e) { fail++; } }
	/* 清空目录 */
	for (const e of readdirSync(LOGS, { withFileTypes: true })) {
		if (!e.isDirectory()) continue;
		const d = path.join(LOGS, e.name);
		if (readdirSync(d).length === 0) { try { rmSync(d, { recursive: true, force: true }); } catch (er) { } }
	}
	console.log("  ✅ 删除 " + n + " 个" + (fail ? "（" + fail + " 个失败）" : "") + " · 回收 " + mb(db));
	let left = 0, lb = 0;
	for (const f of walk(LOGS, [])) { left++; lb += statSync(f).size || 0; }
	console.log("  复验：logs/ 剩 " + left + " 个文件 / " + mb(lb));
	} else {
	console.log("  ℹ️ 清单已落 logs/_del-candidates.txt；加 `--apply` 才真删。");
}
