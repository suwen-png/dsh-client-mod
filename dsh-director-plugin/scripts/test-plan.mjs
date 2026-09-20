#!/usr/bin/env node
/**
 * `test-plan.mjs` —— **增量测试规划器**：算出「这一轮到底该跑哪些套件」
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有它（2026-09-17 用户裁定）
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：「测试太费token了, 每次重复跑很多遍测试, 有的是安装的测试,
 * 有的是反复打开关闭软件, 这些重复很多遍的测试, 请写一个测试流程文档…
 * 已经测试通过, 没有相关改动的情况下, 不需要进行重复测试」
 *
 * 本脚本给出**可复算**的判定（不是"应该没问题"）：
 *
 *   **判据 A · 指纹相等 ⇒ 全跳**
 *     产物 `lib/client.js` 内嵌了 `src/**` 的内容指纹；台账里记着"上一次全绿时
 *     的指纹"。两枚相同 ⇒ **所有闸门的输入逐字节相同** ⇒ 结果不可能变。
 *     这是逻辑证明，不是抽样。
 *
 *   **判据 B · 改动集与闸门输入无交集 ⇒ 全跳**
 *     只改了 docs/ 之类跟任何闸门输入都不沾的东西。
 *
 *   **判据 C · 否则按覆盖面取集**
 *     · 结构类（推导不出 src 覆盖面：安装/桩/语法/模板/依赖环）—— 一律跑
 *     · 有覆盖面 ⇒ 跑「覆盖面 ∩ 改动集 ≠ ∅」的
 *     · 读产物的（`lib/client.js`）⇒ 只要 `src/**` 有改动就要跑（产物 = src 的函数）
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node scripts/test-plan.mjs                 # 出计划（只读，不跑）
 *   node scripts/test-plan.mjs --explain       # 逐套件打印判定依据
 *   node scripts/test-plan.mjs --all           # 忽略台账/改动集，全跑
 *   node scripts/test-plan.mjs --changed a.js,b.js
 *   node scripts/test-plan.mjs --run           # 出计划并执行（离线批量 + 真机合并一次启动）
 *   node scripts/test-plan.mjs --run --record  # 跑完把结果写进台账
 *
 * 退出码：0 计划成功（"--run" 时=全部通过） / 1 有套件红 / 2 用法错或环境不可用
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	PLUGIN_ROOT, listSuites, surfaceOf, artifactStamp, srcStamp,
	needsPlatformStub, loadLedger, saveLedger, record, LEDGER_PATH, selfCheck
} from "./_test-ledger.mjs";

/* ── 参数 ───────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const valOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const unknown = argv.filter((a, i) => a.startsWith("-") && !["--explain", "--all", "--run", "--record", "--changed", "--quiet", "--help", "-h"].includes(a));
if (has("--help") || has("-h")) {
	console.log("用法：node scripts/test-plan.mjs [--explain] [--all] [--changed a.js,b.js] [--run] [--record]");
	process.exit(0);
}
if (unknown.length) { console.error("用法错：不认识的参数 " + unknown.join(" ") + "（--help 看用法）"); process.exit(2); }

/* ══ 🔴 `T-PLUG-062` 前置：**提取器必须先自证能收到真引用** ══════════════════════
 * 本脚本的结论**完全**建立在 `surfaceOf()` 之上。它若失效（正则写窄 / 路径断言写错），
 * 会把**所有**套件**静默**判成「与本改动无交集」而全跳过 —— **假跳过比假红危险**（22 号文 §十）。
 * ⇒ 先跑植入缺陷校准；不通过就 INVALID，**绝不给出一个"看起来全绿"的空计划**。 */
{
	const sc = selfCheck();
	if (!sc.ok) {
		console.error("══ 覆盖面提取器自检（T-PLUG-062）══");
		for (const x of sc.rows || []) console.error("  " + (x.ok ? "✅" : "❌") + " " + x.name);
		console.error("INVALID：覆盖面提取器校准未通过 ⇒ 本次「该跑哪些套件」的结论**不可信**（纪律 32/62）。");
		console.error("  复核：node scripts/_test-ledger.mjs --self-check");
		process.exit(2);
	}
	if (has("--explain")) console.log("  [前置] ✅ 覆盖面提取器自检通过（5 组样本 · 其中 3 组是坏样本）");
}

/* ── 改动集 ─────────────────────────────────────────────────────── */
function gitChanged() {
	/* 未提交改动 + 未跟踪文件，相对**插件根**统一成 `src/...` 形式 */
	const rel = (s) => s.replace(/\\/g, "/").replace(/^dsh-director-plugin\//, "");
	const out = new Set();
	for (const args of [["diff", "--name-only", "HEAD"], ["ls-files", "--others", "--exclude-standard"]]) {
		const r = spawnSync("git", ["-C", PLUGIN_ROOT, ...args], { encoding: "utf8" });
		if (r.status !== 0) continue;
		for (const l of String(r.stdout || "").split(/\r?\n/)) if (l.trim()) out.add(rel(l.trim()));
	}
	return [...out];
}
const changedArg = valOf("--changed");
const changed = changedArg ? changedArg.split(",").map((s) => s.trim()).filter(Boolean) : gitChanged();

/* ── 台账基准 ───────────────────────────────────────────────────── */
const ledger = loadLedger();
const stampNow = artifactStamp();
const srcNow = srcStamp();
/** 台账里"全部登记过的套件都绿"的那个指纹（最保守：取出现次数最多且无红记录的） */
function baseStamp() {
	const st = ledger.suites || {};
	const names = Object.keys(st);
	if (!names.length) return null;
	const green = new Set(), red = new Set();
	for (const n of names) { if (st[n].lastResult === "PASS" && st[n].passStamp) green.add(st[n].passStamp); if (st[n].lastResult === "FAIL") red.add(st[n].passStamp); }
	const counts = {};
	for (const g of green) if (!red.has(g)) counts[g] = (counts[g] || 0) + 1;
	let best = null, bestN = -1;
	for (const k of Object.keys(counts)) if (counts[k] > bestN) { bestN = counts[k]; best = k; }
	return best;
}
const base = baseStamp();

/* ── 闸门输入域 ─────────────────────────────────────────────────── */
const INPUT_DIRS = ["src/", "lib/", "build/", "scripts/", "package.json", "assets/"];
/** 改动集里有没有"可能影响闸门"的东西 */
const touchingInputs = changed.filter((c) => INPUT_DIRS.some((d) => c === d || c.startsWith(d)));
const srcTouched = changed.filter((c) => c.startsWith("src/") || c === "lib/client.js");

/* ── 决策 ───────────────────────────────────────────────────────── */
const suites = listSuites().map((s) => {
	const su = surfaceOf(s);
	return { name: s.name, live: s.live, ...su };
});

let mode = "C", reason = "";
if (has("--all")) { mode = "ALL"; reason = "--all：忽略台账与改动集，全量跑"; }
else if (base && stampNow && base === stampNow && !changed.length) {
	mode = "A"; reason = "判据 A：产物指纹 " + stampNow + " 与台账全绿基准一致，且无未提交改动 ⇒ 输入逐字节未变";
} else if (base && stampNow && base === stampNow && touchingInputs.length === 0) {
	mode = "A"; reason = "判据 A：产物指纹 " + stampNow + " 与台账全绿基准一致；改动集 " + changed.length + " 项均在闸门输入域之外";
} else if (!changed.length && stampNow && srcNow && stampNow === srcNow) {
	mode = "B"; reason = "判据 B：改动集为空、产物与 src 指纹一致，但台账无基准 ⇒ 保守起见跑一轮建基准";
} else if (changed.length && touchingInputs.length === 0) {
	mode = "B"; reason = "判据 B：改动集 " + changed.length + " 项全部落在闸门输入域之外（如仅 docs/）⇒ 无闸门受影响";
}

const decide = (s) => {
	if (mode === "ALL" || mode === "B") return { run: true, why: mode === "ALL" ? "--all" : "建基准/无基准" };
	if (mode === "A") return { run: false, why: "判据 A" };
	if (s.structural) return { run: true, why: "结构类（推导不出 src 覆盖面 ⇒ 一律跑）" };
	if (s.files.some((f) => changed.includes(f))) return { run: true, why: "覆盖面命中改动集" };
	if (s.readsArtifact && srcTouched.length) return { run: true, why: "读产物，且 src 有改动（产物 = src 的函数）" };
	const lim = s.files.slice(0, 2).join(",");
	return { run: false, why: "覆盖面（" + s.files.length + " 个：如 " + lim + "…）与改动集无交集" };
};

const planned = suites.map((s) => ({ ...s, ...decide(s) }));
const toRun = planned.filter((p) => p.run);
const off = toRun.filter((p) => !p.live);
const live = toRun.filter((p) => p.live);

/* ── 输出 ───────────────────────────────────────────────────────── */
console.log("══ 增量测试计划 ══");
console.log("  产物指纹  : " + (stampNow || "(无产物)") + "   ← lib/client.js 内嵌");
console.log("  src 指纹  : " + (srcNow || "(算不出)"));
console.log("  台账基准  : " + (base || "(无基准 —— 首次跑会建基准)"));
console.log("  改动集    : " + (changed.length ? changed.length + " 项（其中影响闸门输入的 " + touchingInputs.length + " 项）" : "空"));
if (changed.length && changed.length <= 12) for (const c of changed) console.log("              · " + c);
console.log("");
console.log("  ⇒ 判定    : " + mode + " ｜ " + reason);
console.log("     必跑 " + toRun.length + " 套（离线 " + off.length + " / 真机 " + live.length + "） ｜ 可跳过 " + (planned.length - toRun.length) + " 套");

if (has("--explain")) {
	console.log("\n── 逐套件依据 ──");
	for (const p of planned) console.log("   " + (p.run ? "跑  " : "跳过") + "  " + (p.live ? "[真机] " : "[离线] ") + p.name.padEnd(34) + " " + p.why);
}

if (!toRun.length) {
	console.log("\n（无需运行任何套件。要看逐套件依据加 --explain；要强制全跑加 --all）");
	process.exit(0);
}

console.log("\n── 批次（每批**一条命令**，不要拆开逐套件跑）──");
if (off.length) {
	console.log("  批次 1 · 离线（" + off.length + " 套）：");
	console.log("    node scripts/test-plan.mjs --run" + (has("--record") ? " --record" : "") + (changedArg ? " --changed " + changedArg : ""));
}
if (live.length) {
	console.log("  批次 2 · 真机（" + live.length + " 套，**只启动一次 Harness**）：");
	console.log("    node scripts/run-live.mjs" + (changedArg ? " --changed " + changedArg : "") + " " + live.map((l) => l.name).join(" "));
}

if (!has("--run")) { console.log("\n（只读规划。加 --run 执行）"); process.exit(0); }

/* ── 执行（离线批次） ───────────────────────────────────────────── */
console.log("\n════ 批次 1 · 离线执行 ════");
const results = [];
for (const p of off) {
	const fp = join(PLUGIN_ROOT, "scripts", p.name);
	const text = readFileSync(fp, "utf8");
	/* 桩判据走 `_test-ledger.needsPlatformStub()`（**唯一真相源**）：
	 * import 到 `src/**` 的套件必须带平台桩钩子（那些 src 模块 import react，
	 * 而本仓按 ADR-001 不装 node_modules）。缺桩 ⇒ exit 2（INVALID）。
	 * 判据写窄会造出"看起来很红其实环境缺件"的假红 —— 已踩过两次：
	 *   ① 旧判据只认 `from "../src/` 一种写法；
	 *   ② 本行原写 `suitesByName.get(p.name) || { text }` —— 而 `suites` 在 map 时
	 *      **丢弃了 `text` 字段**，于是取到的对象存在但没有 text ⇒ 判据恒 false ⇒
	 *      「有兜底」是假象（兜底只在 Map 里没有该键时才生效，而它**永远有**）。
	 *      ⇒ 直接用上面读到的 `text`，不做二次取数。 */
	const needStub = needsPlatformStub({ text: text });
	const args = needStub ? ["--import", "./scripts/_platform-stub.mjs", fp] : [fp];
	const r = spawnSync(process.execPath, args, { cwd: PLUGIN_ROOT, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
	const out = (r.stdout || "") + "\n" + (r.stderr || "");
	const code = r.status == null ? -1 : r.status;
	const ok = code === 0;
	const tail = out.split(/\r?\n/).filter((l) => l.trim()).slice(-3).join(" ｜ ");
	console.log("  " + (ok ? "OK " : code === 2 ? "INVALID " : "FAIL ") + p.name.padEnd(34) + " exit=" + code + " ｜ " + tail.slice(0, 150));
	results.push({ name: p.name, code: code, ok: ok });
	if (has("--record")) record(ledger, p.name, ok, stampNow || "", { surface: p.files });
}
if (has("--record")) { saveLedger(ledger); console.log("  台账已更新：" + LEDGER_PATH); }

const bad = results.filter((r) => !r.ok);
console.log("\n批次 1 汇总：OK=" + (results.length - bad.length) + "  非 0=" + bad.length);
if (live.length) console.log("⚠️ 真机批次（" + live.length + " 套）请另跑：node scripts/run-live.mjs " + live.map((l) => l.name).join(" "));
if (bad.length) { console.log("红：" + bad.map((b) => b.name + "(exit " + b.code + ")").join(" / ")); process.exit(1); }
process.exit(0);
