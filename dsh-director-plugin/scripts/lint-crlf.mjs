#!/usr/bin/env node
/**
 * lint-crlf.mjs —— **Windows 批处理行尾**闸门（第二十九轮 · 2026-09-17）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它治的是什么（🔴 用户连报两次「打开就闪退」，真因就是它）
 * ──────────────────────────────────────────────────────────────────
 *   症状：双击 `Start Harness.cmd` → 黑窗**一闪即逝**，什么也没发生。
 *         最要命的是：**连脚本第一行的日志探针都没写** ⇒
 *         `logs/harness-launch.log` 里干干净净，一点线索都没有。
 *
 *   根因（字节级有据）：该文件是 **LF-only**（实测 CR=0 / loneLF=44）。
 *     cmd.exe 解析纯 LF 的批处理时，`if ... (`…`)` 这类**多行括号块**
 *     与 `for /f ... do if ...` 复合行会错乱 ⇒ 整份脚本**一行都不执行**。
 *
 *   🔴 它为什么是**结构性必然**、必须靠闸门兜住：
 *     · 本仓写盘约定是 LF（纪律 ⑨ 针对 `src/**`）—— 一旦被套用到
 *       `.cmd` / `.ps1`，新写的批处理**必然**是 LF-only；
 *     · LF 与 CRLF 在编辑器里**长得一模一样**，肉眼看不出；
 *     · 症状（闪退、零日志）与"行尾"这个原因**毫无表面关联**
 *       ⇒ 排查会往"程序崩了/环境坏了"方向跑，实际二者都不是。
 *     · 实测佐证：同一台机器、同一时刻，`start-harness.mjs` 直跑
 *       RC=0 且 2.6 s 出窗；裸启动 exe 12 s 仍存活 ⇒ **产品与脚本都好的**，
 *       坏的只有"双击"这一层。
 *
 * ══════════════════════════════════════════════════════════════════
 * 判据
 * ──────────────────────────────────────────────────────────────────
 *   `*.cmd` / `*.bat` / `*.ps1` 必须 **CRLF**：· loneLF === 0 · CRLF > 0
 *
 *   扫描面 = 项目根（跳过 node_modules/.git/original/workspace/snapshots）
 *          ∪ 交付到用户桌面的 `Start Harness.cmd`
 *            （🔴 它是用户唯一的双击入口，属**交付面**；存在才校验，
 *              不存在不报错 —— 项目内那份才是权威源。）
 *
 * 退出码：0 全通过 / 1 有 LF-only 文件 / 2 用法错
 * 校准：`CRLF_CAL=1` → 注入一个 LF-only 临时文件，**必须变红**（纪律 ㉜）
 *      输出里打印 CAL_HIT / CAL_MISS 供机械判读。
 *      ⚠️ 校准**不进常规批**（常规跑不设该环境变量）。
 *
 * 🔴 只读、零副作用（校准的临时文件写在系统 temp 并当场删除）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = import.meta.dirname; // …/dsh-director-plugin/scripts
const ROOT = path.resolve(HERE, "..", ".."); // …/dsh-client-mod
const SKIP_DIRS = new Set([
	"node_modules", ".git", "original", "workspace", "snapshots", "dist", "lib", "cache",
]);
const EXT = /\.(cmd|bat|ps1)$/i;
const DESKTOP_COPIES = [
	path.join(os.homedir(), "Desktop", "Start Harness.cmd"),
	path.join(os.homedir(), "Desktop", "Stop Harness.cmd"),
].filter((p) => fs.existsSync(p));

const args = process.argv.slice(2);
if (args.length > 0) {
	console.log("用法：node scripts/lint-crlf.mjs      （无参数；校准用 CRLF_CAL=1）");
	process.exit(2);
}
const CAL = process.env.CRLF_CAL === "1";

/* ── 收集扫描面 ─────────────────────────────────────────────── */
const targets = [];
(function walk(d) {
	let ents;
	try {
		ents = fs.readdirSync(d, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of ents) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) {
			if (!SKIP_DIRS.has(e.name)) walk(p);
		} else if (EXT.test(e.name)) {
			targets.push(p);
		}
	}
})(ROOT);

for (const p of DESKTOP_COPIES) targets.push(p);

let calPath = null;
if (CAL) {
	calPath = path.join(os.tmpdir(), "dsh-crlf-cal-" + process.pid + ".cmd");
	/* 故意写成 LF-only（Node 不转换换行）—— 复现缺陷形态本身。 */
	fs.writeFileSync(calPath, "@echo off\nif exist x (\n  echo hi\n)\n", "utf8");
	targets.push(calPath);
}

/* ── 逐字节判行尾（不信任何文本模式的 read） ───────────────────── */
const bad = [];
const rows = [];
for (const p of targets) {
	let d;
	try {
		d = fs.readFileSync(p);
	} catch {
		continue;
	}
	let crlf = 0;
	let lf = 0;
	for (let i = 0; i < d.length; i++) {
		if (d[i] === 10) {
			lf++;
			if (i > 0 && d[i - 1] === 13) crlf++;
		}
	}
	const loneLF = lf - crlf;
	rows.push({ p, crlf, loneLF });
	if (loneLF > 0) bad.push({ p, crlf, loneLF });
}

/* ── 报告 ───────────────────────────────────────────────────── */
console.log(" lint-crlf —— Windows 批处理行尾（.cmd/.bat/.ps1 必须 CRLF）");
console.log(" 扫描面：" + rows.length + " 个批处理文件"
	+ (CAL ? "（含 1 个校准注入）" : "")
	+ (DESKTOP_COPIES.length ? " · 含桌面双击副本 " + DESKTOP_COPIES.length + " 个（Start/Stop）" : ""));

const rel = (p) => {
	const r = path.relative(ROOT, p);
	return r.startsWith("..") ? p : r;
};

if (bad.length > 0) {
	console.log(" ❌ 不合格 " + bad.length + " 个 —— LF-only 会让双击**闪退且零日志**：");
	for (const b of bad) {
		console.log("     " + rel(b.p).padEnd(52) + " CRLF=" + b.crlf + " loneLF=" + b.loneLF);
	}
	console.log(" 修法：按 CRLF 重写（不是改内容）。例：读成 bytes → 先把 CRLF 归一成 LF");
	console.log("       再把 LF 全部换成 CRLF → 二进制写回。改完用本闸门复验。");
	if (CAL) {
		console.log(" " + (calPath && bad.some((b) => b.p === calPath) ? "CAL_HIT" : "CAL_MISS")
			+ " —— 校准：注入的 LF-only 文件" + (calPath && bad.some((b) => b.p === calPath) ? "被判红（判据成立）" : "**未被判红（判据失效）**"));
	}
	console.log(" IS_PASS: FALSE");
	if (calPath) {
		try { fs.unlinkSync(calPath); } catch { /* 清理失败不影响判据 */ }
	}
	process.exit(1);
}

console.log(" ✅ 全部 " + rows.length + " 个批处理均为 CRLF");
if (CAL) {
	console.log(" CAL_MISS —— 校准失败：注入的 LF-only 文件**没有**被判红 ⇒ 闸门不成立");
	if (calPath) {
		try { fs.unlinkSync(calPath); } catch { /* ignore */ }
	}
	console.log(" IS_PASS: FALSE");
	process.exit(1);
}
console.log(" IS_PASS: TRUE");
process.exit(0);
