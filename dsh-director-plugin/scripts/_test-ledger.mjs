#!/usr/bin/env node
/**
 * `_test-ledger.mjs` —— 测试台账 + 闸门覆盖面推导（**共享唯一真相源**）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它治的是什么（2026-09-17 用户裁定："测试太费token、重复跑很多次、
 * 反复打开关闭软件"）
 * ──────────────────────────────────────────────────────────────────
 * 原流程的三个漏洞：
 *   ① **没有"该跑哪些"的判据** ⇒ 一律全量跑，改一行也跑几十套；
 *   ② **没有"已通过"的记录** ⇒ 同一份产物在一轮里被反复跑（甚至我刚跑完、
 *      并行会话又跑一遍）；
 *   ③ **真机套逐套件各自启停软件** ⇒ 一次验证开合七八次。
 *
 * 本模块提供两条**可复算**的判据（不是"应该没问题"式的感觉）：
 *
 *   · **判据 A（指纹相等 ⇒ 全跳）**
 *     产物 `lib/client.js` 是 `src/**` 的确定性函数，产物内嵌了内容指纹
 *     （`window.__dshBuildStamp` / `build-stamp.mjs`）。指纹相同 ⇒ **所有闸门的
 *     输入逐字节相同** ⇒ 结果不可能变。这是逻辑上的"证明"，不是抽样。
 *
 *   · **判据 B（指纹变了 ⇒ 按覆盖面取集）**
 *     从每个闸门源码里**静态提取**它引用的 `src/...` 路径，得到该闸门的"覆盖面"。
 *     改动集 ∩ 覆盖面 = ∅ 且该闸门不读产物 ⇒ 跳过。
 *     引用不到任何 src 路径的套件归为 `structural`（结构类：安装/桩/语法/模板），
 *     它们在"任何 src 改动"或"任何脚本改动"时都要跑。
 *
 * 🔴 覆盖面是**推导**出来的，不是手抄的表 —— 手抄必漂移（本仓已被"两份桩漂移"
 *    咬过两次）。提取规则写在 `surfaceOf()` 里，`--explain` 可逐套件复核。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const LEDGER_PATH = join(PLUGIN_ROOT, "logs", "test-ledger.json");
export const ARTIFACT = join(PLUGIN_ROOT, "lib", "client.js");

/* ── 1. 产物内容指纹（唯一权威：构建时写进产物里） ───────────────── */
import { readStampIn, computeSrcStamp } from "./build-stamp.mjs";

/** 产物内嵌指纹（null = 产物不存在 / 没打指纹） */
export function artifactStamp() {
	try { return readStampIn(readFileSync(ARTIFACT, "utf8")); } catch (e) { return null; }
}
/** 当前 src 内容指纹（与产物内嵌的那枚同源同算法） */
export function srcStamp() {
	try { return computeSrcStamp(PLUGIN_ROOT); } catch (e) { return null; }
}

/* ── 2. 套件发现 + 离线/真机分类（与 `_offline-run.mjs` 同一口径） ──── */
export function listSuites() {
	const dir = join(PLUGIN_ROOT, "scripts");
	const out = [];
	for (const f of readdirSync(dir).filter((x) => /^(lint-|verify-|test-|prove-).*\.mjs$/.test(x) && !x.startsWith("_")).sort()) {
		const fp = join(dir, f);
		const text = readFileSync(fp, "utf8");
		/* 真机判据与 `_offline-run.mjs` 保持一致（同一口径，避免两处各自为政） */
		const live = /webSocketDebuggerUrl|\/json\/list|connectOverCDP/.test(text);
		out.push({ name: f, file: fp, live: live, text: text });
	}
	return out;
}

/* ── 3. 覆盖面推导 ───────────────────────────────────────────────
 * 规则（只看**代码里的路径字面量**，注释已剥离）：
 *   ① 任意位置出现 `src/xxx/yyy.js`（含 `../src/...`、`"src/..."`、import 语句）
 *      —— 实测本仓**主模式就是 ESM `import ... from "../src/logic/flow.js"`**，
 *         第一版正则只认 `"src/`（无 `../`）⇒ 69 套里 61 套被误判成"无覆盖面"。
 *   ② 辅助函数式相对路径，如 `SRC("components/DirectorDialog.js")` / `read("logic/x.js")`
 *      ⇒ 补上 `src/` 前缀。
 *   ③ 读产物（`lib/client.js` / `__ModuleLoader__` / `__dshBuildStamp`）另记 `readsArtifact`
 *      —— 这类闸门**任何 src 改动都影响它**，不能按文件级覆盖面跳过。
 * 提取不到任何 src 引用 ⇒ 归 `structural`（结构类：安装/桩/语法/模板/依赖环）。
 * 🔴 规则是**推导**而不是手抄表：手抄必漂移（本仓已被"两份桩漂移"咬过两次）。 */
const SRC_ANY = /src\/([\w\-.\/]+\.js)/g;
const SRC_HELPER = /(?:SRC|read|src|code)\(\s*["']([\w\-.\/]+\.js)["']\s*\)/g;
const ARTIFACT_HINT = /lib\/client\.js|__ModuleLoader__|__dshBuildStamp/;

/** 剥注释（避免"注释里写了某文件路径"造成假覆盖；只需够用，不追求完整词法分析） */
export function stripComments(s) {
	return String(s)
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** @returns {{files:string[], structural:boolean, readsArtifact:boolean}} */
export function surfaceOf(suite) {
	const code = stripComments(suite.text);
	const files = new Set();
	let m;
	SRC_ANY.lastIndex = 0;
	while ((m = SRC_ANY.exec(code))) {
		const p = "src/" + m[1];
		/* 只收真实存在的 src 文件（挡掉 `docs/xx/src/yy.js` 这类误命中） */
		if (existsSync(join(PLUGIN_ROOT, p))) files.add(p);
	}
	SRC_HELPER.lastIndex = 0;
	while ((m = SRC_HELPER.exec(code))) {
		const p = "src/" + m[1];
		if (existsSync(join(PLUGIN_ROOT, p))) files.add(p);
	}
	return { files: [...files].sort(), structural: files.size === 0, readsArtifact: ARTIFACT_HINT.test(code) };
}

/* ── 3b. 平台桩钩子判据（**唯一真相源**） ────────────────────────
 * `react` / `react-dom` 按 ADR-001 是**平台冻结模块**，本仓库不装 `node_modules`
 * ⇒ 任何会 `import` 到 `src/**` 的离线套件都必须带
 * `node --import ./scripts/_platform-stub.mjs`，否则裸跑崩在
 * `Cannot find package 'react'`（**INVALID ≠ FAIL**，但也不该由人肉记）。
 *
 * 🔴 判据**不许写窄**：第一版只认 `from "../src/` 这一种写法，而 `verify-dialog.mjs`
 *    用的是别的形态 ⇒ 被误判成"不用桩" ⇒ 规划器把一次**环境缺失**报成 exit 2，
 *    读起来像"产品坏了"。这里改为**任何位置出现 src 路径字面量**即算需要桩
 *    （注释已剥离，所以只认代码里的引用）。 */
const SRC_ANY_REF = /["'`][^"'`\n]*\bsrc\//;
export function needsPlatformStub(suite) {
	return SRC_ANY_REF.test(stripComments(suite.text || ""));
}

/* ── 4. 台账读写 ──────────────────────────────────────────────── */
export function loadLedger() {
	try { return JSON.parse(readFileSync(LEDGER_PATH, "utf8")); } catch (e) { return { suites: {} }; }
}
export function saveLedger(l) {
	mkdirSync(join(PLUGIN_ROOT, "logs"), { recursive: true });
	writeFileSync(LEDGER_PATH, JSON.stringify(l, null, 1) + "\n", "utf8");
}
/** 记录一套件的结果。**只在绿时把 stamp 推进** —— 红不能盖住上一次的绿 */
export function record(l, name, ok, stamp, extra) {
	const e = l.suites[name] || {};
	e.lastRunAt = new Date().toISOString();
	e.lastResult = ok ? "PASS" : "FAIL";
	if (ok) e.passStamp = stamp;
	e.surface = (extra && extra.surface) || e.surface || null;
	l.suites[name] = e;
	return l;
}

/* ── 5. 改动集由调用方（test-plan.mjs）用 spawnSync 取，本模块不掺和进程 ── */
