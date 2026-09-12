#!/usr/bin/env node
/**
 * test-orchestrate.mjs —— 统筹闭环 / 打分标准 / 三轮评估**纯函数离线测试**
 *
 * ══════════════════════════════════════════════════════════════════
 * 先写"测什么 + 期望结果"（用户要求），再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | OR-1 | 阶段编排 | 6 阶段有序；`nextStage` 逐级推进、末态不越界 |
 *  | OR-2 | 准入判定 | 缺证据 → `ok:false` 且 `missing` **点名缺什么**；齐了 → `ok:true` |
 *  | OR-3 | 计划生成 | 一条想法 → 6 步计划；空想法 → `empty:true`（不编假计划） |
 *  | OR-4 | 🔴 **打分标准自审** | 自带标准**必须通过**；人为破坏（缺 criterion / 缺 witness / 无 0 分档 / 权重 0）**必须报红** |
 *  | OR-5 | 打分 | 全 5 分 → `passed`；缺维度 → `passed:false` 且 `missing` 点名；**标准未过审 → 一律不判通过** |
 *  | OR-6 | 三轮 | 三轮全过 → `passed`；只跑 2 轮 → `passed:false`；证据同源 → `distinctEvidence:false` |
 *
 * 用户原话：「审核标准为前端审美、按钮交互，审核标准是为围绕核心目的进行打分判断是否满足，
 *           打分标准也需要进行审核，打分起码三轮多方位评估。」
 *
 * 用法：node scripts/test-orchestrate.mjs ｜ 退出码 0 全绿 / 1 有失败
 */
import {
	STAGE, STAGES, STAGE_ORDER, nextStage, canAdvance, planFor,
	RUBRIC, RUBRIC_MAX, auditRubric, score, ROUNDS, summarizeRounds
} from "../src/logic/orchestrate.js";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("═══════════════════════════════════════════════════════════");
console.log("  统筹闭环 · 纯函数离线测试（logic/orchestrate.js）");
console.log("═══════════════════════════════════════════════════════════");

console.log("\n【A】阶段编排");
t("OR-1a", "共 6 阶段且顺序 = 拆解→文档→审核→蓝图→测试→收口",
	eq(STAGE_ORDER, ["plan", "doc", "review", "blueprint", "test", "done"]), STAGE_ORDER);
t("OR-1b", "nextStage 逐级推进", ["doc", "review", "blueprint", "test", "done"].every((w, i) => nextStage(STAGE_ORDER[i]) === w));
t("OR-1c", "末态不越界（done → done）", nextStage(STAGE.DONE) === STAGE.DONE);
t("OR-1d", "未知 key → 回到首阶段（不抛错）", nextStage("不存在") === STAGE.PLAN);

console.log("\n【B】准入判定（缺什么必须点名）");
const b1 = canAdvance(STAGE.PLAN, {});
t("OR-2a", "只有想法 → 进「文档」缺任务清单", b1.ok === false && b1.missing.indexOf("任务清单") >= 0, b1);
const b2 = canAdvance(STAGE.DOC, { plan: ["a"] });
t("OR-2b", "有清单无文档 → 进「审核」缺文档", b2.ok === false && b2.missing.indexOf("文档") >= 0, b2);
const b3 = canAdvance(STAGE.DOC, { plan: ["a"], doc: "设计文档正文", score: { passed: true } });
t("OR-2c", "清单+文档+审核通过 → 可进「蓝图」", b3.ok === true, b3);
const b4 = canAdvance(STAGE.REVIEW, { doc: "文档", score: { passed: false } });
t("OR-2d", "🔴 审核未通过 → 不得进「蓝图」（`missing` 点名「审核通过」）",
	b4.ok === false && b4.missing.indexOf("审核通过") >= 0, b4);
const b5 = canAdvance(STAGE.BLUEPRINT, { blueprint: "蓝图", test: { passed: true } });
t("OR-2e", "蓝图 + 测试通过 → 可收口", b5.ok === true, b5);
t("OR-2f", "空数组/空白字符串不算证据", canAdvance(STAGE.PLAN, { plan: [] }).ok === false
	&& canAdvance(STAGE.DOC, { plan: ["a"], doc: "   " }).ok === false);

console.log("\n【C】计划生成");
const p1 = planFor("做一个插件");
t("OR-3a", "6 步计划且每步有产出物描述", p1.steps.length === 6 && p1.steps.every((s) => s.out && s.need), p1.steps.length);
t("OR-3b", "初始阶段 = plan，且全部 done=false", p1.stage === STAGE.PLAN && p1.steps.every((s) => s.done === false));
t("OR-3c", "🔴 空想法 → empty:true（不编假计划）", planFor("").empty === true && planFor(null).empty === true);
t("OR-3d", "想法原文被保留（不悄悄改写）", planFor("  原始想法  ").idea === "原始想法");

console.log("\n【D】🔴 打分标准自审（用户明确要求「打分标准也需要进行审核」）");
const a0 = auditRubric(RUBRIC);
t("OR-4a", "自带 6 维标准通过自审", a0.ok === true, a0.fails);
t("OR-4b", "维度覆盖用户点名的三维（核心目的 / 前端审美 / 按钮与交互）",
	["purpose", "aesthetic", "interaction"].every((k) => RUBRIC.some((r) => r.key === k)), RUBRIC.map((r) => r.key));
t("OR-4c", "满分 = Σ(权重×5)", RUBRIC_MAX === RUBRIC.reduce((s, r) => s + r.weight * 5, 0), RUBRIC_MAX);

/* 正负对照：人为破坏标准，闸门必须报红 */
const bad1 = RUBRIC.map((r) => (r.key === "purpose" ? { ...r, criterion: "" } : r));
t("OR-4d", "🔴 正负对照：抽掉某维 criterion → 必须报红",
	auditRubric(bad1).ok === false && auditRubric(bad1).fails.some((f) => /purpose/.test(f)), auditRubric(bad1).fails);
const bad2 = RUBRIC.map((r) => (r.key === "aesthetic" ? { ...r, witness: "" } : r));
t("OR-4e", "🔴 正负对照：抽掉某维 witness → 必须报红", auditRubric(bad2).ok === false);
const bad3 = RUBRIC.map((r) => (r.key === "interaction" ? { ...r, criterion: "5=很好 3=一般" } : r));
t("OR-4f", "🔴 正负对照：某维没定义 0 分（不可证伪）→ 必须报红",
	auditRubric(bad3).ok === false && auditRubric(bad3).fails.some((f) => /不可证伪/.test(f)), auditRubric(bad3).fails);
const bad4 = RUBRIC.map((r) => (r.key === "consistency" ? { ...r, weight: 0 } : r));
t("OR-4g", "🔴 正负对照：权重为 0 → 必须报红", auditRubric(bad4).ok === false);
const bad5 = [{ ...RUBRIC[0] }, { ...RUBRIC[0] }];
t("OR-4h", "🔴 正负对照：key 重复（维度重叠）→ 必须报红", auditRubric(bad5).ok === false);

console.log("\n【E】打分");
const full = {};
for (const r of RUBRIC) full[r.key] = 5;
const s1 = score(full);
t("OR-5a", "全 5 分 → total=满分、ratio=1、passed=true", s1.total === RUBRIC_MAX && s1.ratio === 1 && s1.passed === true, s1);
t("OR-5b", "每维都回带 criterion（打分有据可依）", s1.dims.every((d) => d.criterion && d.criterion.length > 10));
const half = { ...full }; half.purpose = 2; half.aesthetic = 2; half.interaction = 2;
const s2 = score(half);
t("OR-5c", "🔴 削掉三个关键维度后 ratio 下降且低于阈值 → passed=false",
	s2.ratio < 0.7 && s2.passed === false, { ratio: s2.ratio, total: s2.total });
const s3 = score({ purpose: 5 });
t("OR-5d", "🔴 缺维度 → passed=false 且 missing 点名（不静默当满分）",
	s3.passed === false && s3.missing.length === RUBRIC.length - 1, s3.missing);
t("OR-5e", "分数被夹到 0–5（越界不放大）",
	score({ ...full, purpose: 99 }).dims.find((d) => d.key === "purpose").score === 5
	&& score({ ...full, purpose: -3 }).dims.find((d) => d.key === "purpose").score === 0);
t("OR-5f", "🔴 标准未过审时**一律不判通过**（分数再高也不行）",
	(() => { const r = score(full, { rubric: bad1 }); return r.rubricOk === false && r.passed === false; })());

console.log("\n【F】三轮多方位评估（换证据源，不是重复三次）");
t("OR-6a", "三轮编号 1/2/3 且各有方法描述", ROUNDS.map((r) => r.n).join(",") === "1,2,3"
	&& ROUNDS.every((r) => r.method && r.failsIf));
const ok3 = summarizeRounds([
	{ n: 1, ok: true, evidence: "对照表" }, { n: 2, ok: true, evidence: "截图" }, { n: 3, ok: true, evidence: "反证" }
]);
t("OR-6b", "三轮全过 → passed=true，且证据**不同源**", ok3.passed === true && ok3.distinctEvidence === true, ok3);
const only2 = summarizeRounds([{ n: 1, ok: true, evidence: "对照表" }, { n: 2, ok: true, evidence: "截图" }]);
t("OR-6c", "🔴 只跑两轮 → passed=false（防「跑两次当三轮」）",
	only2.passed === false && /≥3|三/.test(only2.note), only2.note);
const sameEv = summarizeRounds([
	{ n: 1, ok: true, evidence: "同一套断言" }, { n: 2, ok: true, evidence: "同一套断言" }, { n: 3, ok: true, evidence: "反证" }
]);
t("OR-6d", "🔴 第 2 轮证据与第 1 轮同源 → distinctEvidence=false（同错同绿）", sameEv.distinctEvidence === false);
const fail1 = summarizeRounds([
	{ n: 1, ok: false, evidence: "对照表" }, { n: 2, ok: true, evidence: "截图" }, { n: 3, ok: true, evidence: "反证" }
]);
t("OR-6e", "有任一轮不过 → passed=false 且点名轮次",
	fail1.passed === false && eq(fail1.failed, [1]), fail1);

/* ══ 汇总 ══ */
console.log("\n───────────────────────────────────────────────");
console.log(` 通过 ${pass} / 失败 ${fail}`);
if (fail) console.log(" 失败项：\n   - " + failures.join("\n   - "));
console.log(` IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("───────────────────────────────────────────────");
process.exit(fail === 0 ? 0 : 1);
