#!/usr/bin/env node
/**
 * test-director-chain-parity.mjs —— 五步链「图 ↔ 执行」一致性套件
 *                                   （**19 号文 P2 · N9 / F9 / F10** · 前缀 `PC-`）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须有这一套（而不是"看起来已经收敛了"）
 * ──────────────────────────────────────────────────────────────────
 * N9 的病因是**两份真相源**：`DIRECTOR_CHAIN`（声明式，带 `depends_on`）被面板与闸门引用，
 * 而 `runDirector()` 自建 `push(1..5)`（**无 id**、顺序硬编码）⇒ 界面展示的和真正执行的对不上。
 * 收敛的**唯一有效证据**不是"两边步骤数都是 5"（反例：顺序/依赖不同也会过），而是：
 *   ① 执行的 id 集 == 图的 id 集；
 *   ② 执行的**顺序**由图**现算** —— 换一张声明顺序不同的图，执行顺序**必须跟着变**；
 *   ③ 图上多一步而本版本未实现 ⇒ **可分辨地降级**，不静默少跑、不抛穿。
 *
 * 🔴 ③ 是纪律 19/100 的落点：执行链上的模块**一律不许抛穿**。
 *
 * ── 断言表 ────────────────────────────────────────────────────────
 *  | 编号    | 被测行为 | 期望 |
 *  |:--------|:---------|:-----|
 *  | PC-1a–c | 声明图本身（字段齐 / id 唯一 / 无环） | 5 步全齐 |
 *  | PC-2a–e | **执行 ↔ 图一致**（id 集 / 顺序 / depends_on / 序号） | 全中 |
 *  | PC-3a–e | **顺序由图现算**（换图必变）+ 未实现可分辨降级 + 成环不抛 | 全中 |
 *  | PC-4a–d | **F10**：连续性驱动归属（不连续 ⇒ 排除当前维度） | 正负对照各一条 |
 *
 * 🧪 植入缺陷校准（纪律 32 · 实际改坏一次并确认**精确报红**）：
 *    · `PC_NEG=1` ⇒ 用"写死顺序"的假 `chainPlan` ⇒ **`PC-3a` 必红**（顺序不再随图变）
 *    · `PC_NEG=2` ⇒ 用"一律排除 currentDim、不看 continuous"的假归属 ⇒ **`PC-4b` 必红**
 *    ⇒ 两者都只在**目标断言**上红，其余保持绿（证明判据有分辨力、且不是靠耦合蒙对）。
 *
 * 用法：node scripts/test-director-chain-parity.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runDirector, chainPlan } from "../src/logic/director-run.js";
import { DIRECTOR_CHAIN } from "../src/logic/director-chain.js";
import { topoSort } from "../src/logic/dag.js";
import { planAttribution } from "../src/logic/attribution.js";

let pass = 0, fail = 0;
const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (cond || detail === undefined ? "" : "  → " + JSON.stringify(detail)));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  五步链一致性 · 图(声明) ↔ runDirector(执行) ｜ 19 号文 N9/F9/F10");
console.log("═══════════════════════════════════════════════════════════");

/* ── 闸门自检：断言编号唯一（本仓惯例，重号会让报告失去可归因性） ── */
{
	const selfSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
	const ids = [...selfSrc.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]);
	const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
	if (dup.length) {
		console.error("IS_PASS: FALSE（INVALID：断言编号重号 " + dup.length + " 个 —— " + dup.join(", ") + "）");
		process.exit(2);
	}
	console.log("  [自检] 断言编号唯一：" + ids.length + " 条，零重号");
}

const ALL_IDS = DIRECTOR_CHAIN.map((s) => String(s.id));

/* ══════════════ PC-1 · 声明图本身 ══════════════ */
t("PC-1a", "DIRECTOR_CHAIN 是 5 步且每步字段齐全（id/role/output/task）",
	Array.isArray(DIRECTOR_CHAIN) && DIRECTOR_CHAIN.length === 5
	&& DIRECTOR_CHAIN.every((s) => s.id && s.role && s.output && s.task),
	DIRECTOR_CHAIN.map((s) => s.id));
t("PC-1b", "图上 id **唯一**（重号会让 id 集对账变成空真）",
	new Set(ALL_IDS).size === ALL_IDS.length, ALL_IDS);
t("PC-1c", "图**无环**（`topoSort` 非 null）",
	topoSort(DIRECTOR_CHAIN) !== null, topoSort(DIRECTOR_CHAIN));

/* ══════════════ PC-2 · 执行 ↔ 图 一致（顺序与依赖，不只是数量） ══════════════ */
const RUN = await runDirector({ userText: "补充第三章剧情支线", config: { localModel: { enabled: false } } });
const RUN_IDS = RUN.steps.map((s) => String(s.id));
t("PC-2a", "`runDirector().steps` **每步都带 id**（收敛前 `push(1..5)` 无 id ⇒ 本条红）",
	RUN.steps.length > 0 && RUN.steps.every((s) => s.id != null && String(s.id).trim() !== ""), RUN.steps);
t("PC-2b", "**id 集相等**（不是「数量相等」—— 数量相同而 id 不同即红）",
	RUN_IDS.slice().sort().join("|") === ALL_IDS.slice().sort().join("|"),
	{ got: RUN_IDS.slice().sort(), want: ALL_IDS.slice().sort() });
t("PC-2c", "🔴 **顺序** === `topoSort(DIRECTOR_CHAIN)` 现算的顺序",
	RUN_IDS.join(",") === topoSort(DIRECTOR_CHAIN).join(","),
	{ got: RUN_IDS, want: topoSort(DIRECTOR_CHAIN) });
{
	/* depends_on 关系必须被遵守：每个依赖都要**排在**该步之前 */
	const pos = {};
	RUN_IDS.forEach((id, i) => { pos[id] = i; });
	const bad = DIRECTOR_CHAIN.filter((s) => (s.depends_on || [])
		.some((d) => pos[d] === undefined || pos[d] > pos[s.id]));
	t("PC-2d", "🔴 `depends_on` 被遵守：每个依赖都排在它**之前**（反例：只比数量会放过乱序）",
		bad.length === 0, bad.map((s) => ({ id: s.id, deps: s.depends_on, pos: pos[s.id] })));
}
t("PC-2e", "`n` 是 1..N 的连续序号（界面/日志按它编号）",
	RUN.steps.every((s, i) => s.n === i + 1), RUN.steps.map((s) => s.n));

/* ══════════════ PC-3 · 顺序**由图现算**（F9 的唯一有效判据） ══════════════
 * 🔴 只断言"执行顺序 == 图顺序"仍然可能是**两边都写死**恰好一致。
 *    真正的判据是**换一张图，顺序必须跟着变** —— 下面用一张"声明顺序不同、
 *    依赖不变"的图来证。写死顺序的实现对这张图会返回原顺序 ⇒ 本段必红。 */
const SHUFFLED = [
	{ id: "polish", role: "polisher", output: "polished", task: "整理语言" },
	{ id: "model", role: "model-router", output: "model", depends_on: ["polish"], task: "调整模型" },
	{ id: "branch", role: "branch-judge", output: "branch", depends_on: ["polish"], task: "切换分支" },
	{ id: "context", role: "context-picker", output: "ctx", depends_on: ["branch", "model"], task: "上下文筛选" },
	{ id: "review", role: "output-reviewer", output: "verdict", depends_on: ["context"], task: "自动审核" }
];

/* 🧪 校准开关 1：`PC_NEG=1` ⇒ 换成"顺序写死"的假实现（应使 PC-3a 红） */
const hardcodedPlan = (chain, implIds) => {
	const fixed = ["polish", "branch", "model", "context", "review"];
	const have = Array.isArray(implIds) ? implIds.map(String) : [];
	return fixed.map((id, i) => ({ id: id, n: i + 1, implemented: have.indexOf(id) >= 0 }));
};
const NEG = String(process.env.PC_NEG || "").trim();
const PLAN_FN = NEG === "1" ? hardcodedPlan : chainPlan;
if (NEG === "1") console.log("  🧪 校准模式 PC_NEG=1（顺序写死的假实现 ⇒ 期望 PC-3a 红）");

const shuffledOrder = PLAN_FN(SHUFFLED, ALL_IDS).map((s) => s.id);
t("PC-3a", "🔴 换一张**声明顺序不同**的图 ⇒ 顺序**必须跟着变**（写死顺序的实现在本条红）",
	shuffledOrder.join(",") === "polish,model,branch,context,review",
	{ got: shuffledOrder, want: "polish,model,branch,context,review" });
{
	const pos = {};
	shuffledOrder.forEach((id, i) => { pos[id] = i; });
	const bad = SHUFFLED.filter((s) => (s.depends_on || []).some((d) => pos[d] === undefined || pos[d] > pos[s.id]));
	t("PC-3b", "…且换序后**依赖仍被遵守**（`model` 排在 `branch` 前也不违例：二者互不依赖）",
		bad.length === 0, bad.map((s) => ({ id: s.id, deps: s.depends_on })));
}
{
	/* 🔴 图**多出**一步而未实现 ⇒ 必须**可分辨**（`implemented:false`），且**不抛穿** */
	const WITH_EXTRA = SHUFFLED.concat([{ id: "publish", role: "publisher", output: "pub", depends_on: ["review"], task: "发布" }]);
	let plan = null, threw = "";
	try { plan = chainPlan(WITH_EXTRA, ALL_IDS); } catch (e) { threw = e.message; }
	const extra = plan ? plan.filter((s) => s.id === "publish")[0] : null;
	t("PC-3c", "🔴 图上**多一步**未实现 ⇒ 该步 `implemented:false`（可分辨降级），其余步骤不受影响",
		threw === "" && !!extra && extra.implemented === false && plan.length === 6
		&& plan.filter((s) => ALL_IDS.indexOf(s.id) >= 0).every((s) => s.implemented === true),
		{ threw: threw, plan: plan });
	t("PC-3d", "🔴 负对照：id **全部**已实现 ⇒ `implemented` 全 `true`（防「恒 false」的空真）",
		chainPlan(DIRECTOR_CHAIN, ALL_IDS).every((s) => s.implemented === true),
		chainPlan(DIRECTOR_CHAIN, ALL_IDS));
}
{
	/* 成环图：`topoSort` 返 null ⇒ 降级为声明顺序，**不抛穿**（执行链不许抛 · 纪律 100） */
	const CYCLIC = [{ id: "a", depends_on: ["b"] }, { id: "b", depends_on: ["a"] }];
	let out = null, threw = "";
	try { out = chainPlan(CYCLIC, ["a", "b"]); } catch (e) { threw = e.message; }
	t("PC-3e", "🔴 图上**成环** ⇒ 降级为声明顺序且**不抛穿**（纪律 19/100：执行链上的模块不许抛）",
		threw === "" && !!out && out.map((s) => s.id).join(",") === "a,b", { threw: threw, out: out });
}

/* ══════════════ PC-4 · F10：连续性判定驱动归属 ══════════════
 * 「判了『建议开新分支』却不用它决定去向」正是用户第 2/6 条诉求落空的技术原因。
 * 落点 = `planAttribution(src, {continuous:false, currentDim})` ⇒ 候选集**排除当前维度**。 */
/* 🧪 校准开关 2：`PC_NEG=2` ⇒ 换成"一律排除、不看 continuous"的假归属（应使 PC-4b 红） */
const badAttr = (src, o) => {
	const a = planAttribution(src, { continuous: true, currentDim: null });   // 先拿全量候选（忽略入参）
	const cur = (o && o.currentDim) ? String(o.currentDim) : "";
	return { kind: a.kind, dims: a.dims.filter((d) => String(d.key) !== cur), reason: a.reason, extent: a.extent };
};
const ATTR = NEG === "2" ? badAttr : planAttribution;
if (NEG === "2") console.log("  🧪 校准模式 PC_NEG=2（一律排除当前维度 ⇒ 期望 PC-4b 红）");

const SRC_MULTI = "世界观和力量体系一起改";
{
	const a = ATTR(SRC_MULTI, { continuous: false, currentDim: "world" });
	const keys = a.dims.map((d) => String(d.key));
	t("PC-4a", "🔴 **不连续** + `currentDim=world` ⇒ 候选集**不含** world，且仍有 power（真的换维度去）",
		keys.indexOf("world") < 0 && keys.indexOf("power") >= 0, { got: keys, reason: a.reason });
}
{
	const a = ATTR(SRC_MULTI, { continuous: true, currentDim: "world" });
	const keys = a.dims.map((d) => String(d.key));
	t("PC-4b", "🔴 **负对照**：连续 ⇒ 候选集**含** world（防「一律排除」的空真）",
		keys.indexOf("world") >= 0 && keys.indexOf("power") >= 0, { got: keys });
}
{
	/* 单维源被排除后集合为空 —— 此时必须**可分辨**：`kind` 不得退化成 `noise`（"没有"≠"是噪声"） */
	const a = ATTR("补充第三章剧情支线", { continuous: false, currentDim: "plot" });
	t("PC-4c", "🔴 排除后为空 ⇒ `dims=[]` 且 `kind !== \"noise\"`（「没有可用维度」与「这是噪声」必须可分）",
		Array.isArray(a.dims) && a.dims.length === 0 && a.kind !== "noise",
		{ dims: a.dims.length, kind: a.kind, reason: a.reason });
}
{
	/* 前提（纪律 23）：**没给** `currentDim` 时，`continuous=false` 不得改动任何结果 —— 否则是误伤 */
	const a1 = planAttribution(SRC_MULTI, { continuous: false });
	const a2 = planAttribution(SRC_MULTI, {});
	t("PC-4d", "🔴 前提：未给 `currentDim` 时 `continuous=false` **不改变**结果（防「到处误伤」）",
		a1.dims.map((d) => d.key).join(",") === a2.dims.map((d) => d.key).join(","),
		{ noCurrentDim: a1.dims.map((d) => d.key), baseline: a2.dims.map((d) => d.key) });
}

/* ══════════════ 汇总 ══════════════ */
console.log("═══════════════════════════════════════════════════════════");
if (fail) {
	console.log("  失败项：" + failures.join(" ｜ "));
	console.log("  IS_PASS: FALSE");
} else {
	console.log("  IS_PASS: TRUE");
}
console.log("  通过 " + pass + " / 失败 " + fail);
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
