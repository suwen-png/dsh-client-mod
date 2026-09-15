#!/usr/bin/env node
/**
 * test-policy.mjs —— 执行模式与策略**纯函数离线测试**
 *
 * ══════════════════════════════════════════════════════════════════
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | PL-1 | 策略表自审 | 内置表 ok；**默认模式是 direct**（不为了复杂而复杂） |
 *  | PL-2 | 🔴 正负对照校准 | 植入「strict.maxMode = full」→ 必须报红；还原 → 绿 |
 *  | PL-3 | 模式决策 | 单步→direct；平坦并行→light；多阶段/闸门/高风险→full |
 *  | PL-4 | 🔴 策略天花板 | strict 下想要 full → 压到 light 且 `capped:true`（不偷偷升） |
 *  | PL-5 | force | 用户显式指定优先于结构判定 |
 *  | PL-6 | 预算 | 上限齐全；rounds=0 表示不限；需要超上限时**如实标 truncated** |
 *  | PL-7 | 成本预估 | 调用数 / 权重 / 倍率三者关系正确，文案含倍率 |
 *  | PL-8 | 🔴 升档 | 无证据**不升**；有证据才升；已达策略上限**不升**；预算用尽不升 |
 *  | PL-9 | 文案 | explainMode 同时给出「适用」与「自身失败模式」 |
 *
 * 用法：node scripts/test-policy.mjs ｜ 退出码 0 全绿 / 1 有失败 / 2 INVALID
 */
import {
	MODE, MODES, POLICY, POLICIES,
	modeOf, explainMode, policyOf, profileOf,
	decideMode, budgetFor, estimateCost, suggestEscalation, auditPolicy,
	MODEL_TIER, TIER_COST
} from "../src/logic/policy.js";

const EXPECTED_TOTAL = 49;
let pass = 0, fail = 0;
const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++;
	else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}
const clone = (o) => JSON.parse(JSON.stringify(o));

console.log("═══════════════════════════════════════════════════════════");
console.log("  执行模式与策略 · 纯函数离线测试（logic/policy.js）");
console.log("═══════════════════════════════════════════════════════════");

console.log("\n【A】策略表自审与默认值");
const ap = auditPolicy();
t("PL-1a", "内置策略表自审通过", ap.ok, ap.fails);
t("PL-1b", "三种模式与四种策略齐全", MODES.length === 3 && POLICIES.length === 4);
t("PL-1c", "🔴 默认模式是 direct、倍率 1（不为了复杂而复杂）",
	MODES[0].key === MODE.DIRECT && MODES[0].multiplier === 1, MODES.map((m) => m.key + ":" + m.multiplier));
t("PL-1d", "倍率单调递增（4 → 15 量级）", MODES[0].multiplier < MODES[1].multiplier && MODES[1].multiplier < MODES[2].multiplier);
t("PL-1e", "默认策略是 balanced", POLICIES[1].key === POLICY.BALANCED);
t("PL-1f", "未知模式回落 direct（保守）", modeOf("nope").key === MODE.DIRECT);
t("PL-1g", "未知策略回落 balanced", policyOf("nope").key === POLICY.BALANCED);

console.log("\n【B】🔴 正负对照校准（植入目标缺陷）");
const badPol = clone(POLICIES);
badPol.find((p) => p.key === POLICY.STRICT).maxMode = MODE.FULL;
const badRes = auditPolicy(MODES, badPol);
t("PL-2a", "植入 strict.maxMode=full → **必须报红**",
	badRes.ok === false && badRes.fails.some((f) => f.indexOf("strict") >= 0), badRes.fails);
const badPol2 = clone(POLICIES);
badPol2.find((p) => p.key === POLICY.UNLIMITED).cap.calls = 1;
t("PL-2b", "植入上限非单调（unlimited.calls=1）→ 必须报红",
	auditPolicy(MODES, badPol2).fails.some((f) => f.indexOf("非单调") >= 0), auditPolicy(MODES, badPol2).fails);
const badModes = clone(MODES);
badModes[1].multiplier = 99;
t("PL-2c", "植入倍率非递增（light=99）→ 必须报红",
	auditPolicy(badModes, POLICIES).fails.some((f) => f.indexOf("倍率非递增") >= 0), auditPolicy(badModes, POLICIES).fails);
const badPol3 = clone(POLICIES);
badPol3.find((p) => p.key === POLICY.BALANCED).maxMode = "ultra";
t("PL-2d", "植入非法 maxMode → 必须报红",
	auditPolicy(MODES, badPol3).fails.some((f) => f.indexOf("maxMode 非法") >= 0));
t("PL-2e", "🟢 还原内置表 → 恢复绿（负 → 正 全链路）", auditPolicy(MODES, POLICIES).ok === true);

console.log("\n【C】模式决策（判据是依赖结构，不是角色数）");
const p1 = profileOf({ steps: 1, levels: 1, maxParallel: 1 });
t("PL-3a", "单步无拆解空间 → direct", decideMode(p1, POLICY.BALANCED).mode === MODE.DIRECT, decideMode(p1, POLICY.BALANCED).reason);
const p2 = profileOf({ steps: 3, levels: 2, maxParallel: 3 });
t("PL-3b", "平坦真并行（2 层 / 并行 3）→ light", decideMode(p2, POLICY.BALANCED).mode === MODE.LIGHT, decideMode(p2, POLICY.BALANCED).reason);
const p3 = profileOf({ steps: 4, levels: 3, maxParallel: 2 });
t("PL-3c", "多阶段（3 层）→ full", decideMode(p3, POLICY.BALANCED).mode === MODE.FULL, decideMode(p3, POLICY.BALANCED).reason);
const p4 = profileOf({ steps: 2, levels: 1, maxParallel: 2, gates: 1 });
t("PL-3d", "有闸门 → full（少不得人工介入）", decideMode(p4, POLICY.BALANCED).mode === MODE.FULL, decideMode(p4, POLICY.BALANCED).reason);
const p5 = profileOf({ steps: 2, levels: 1, maxParallel: 2 }, { risk: 5 });
t("PL-3e", "高风险（risk 5）→ full", decideMode(p5, POLICY.BALANCED).mode === MODE.FULL);
t("PL-3f", "决策理由里带上**结构量**（可复算）",
	decideMode(p3, POLICY.BALANCED).reason.indexOf("层数") >= 0, decideMode(p3, POLICY.BALANCED).reason);
t("PL-3g", "trace 非空（决策可追溯）", decideMode(p3, POLICY.BALANCED).trace.length > 0);
t("PL-3h", "profileOf 补齐缺失字段（不返回 undefined）",
	(() => { const x = profileOf({}); return x.steps === 0 && x.levels === 0 && x.risk === 2; })());
t("PL-3i", "风险值被夹在 0..5", profileOf({}, { risk: 99 }).risk === 5);

console.log("\n【D】🔴 策略天花板（说了省就别偷偷升）");
const d1 = decideMode(p3, POLICY.STRICT);
t("PL-4a", "strict 策略下 want=full → 实际压到 light",
	d1.mode === MODE.LIGHT && d1.wantMode === MODE.FULL, d1);
t("PL-4b", "capped 标记为 true（用户看得见被压过）", d1.capped === true);
t("PL-4c", "trace 写明「压到」（不静默）", d1.trace.some((x) => x.indexOf("压到") >= 0), d1.trace);
t("PL-4d", "balanced 下不压（full 就是 full）",
	decideMode(p3, POLICY.BALANCED).capped === false && decideMode(p3, POLICY.BALANCED).mode === MODE.FULL);
t("PL-5a", "force 显式指定 direct 优先于结构判定（含 strict）",
	decideMode(p3, POLICY.STRICT, { force: MODE.DIRECT }).mode === MODE.DIRECT, decideMode(p3, POLICY.STRICT, { force: MODE.DIRECT }));
t("PL-5b", "force 也受策略天花板约束（strict + force full → light）",
	decideMode(p1, POLICY.STRICT, { force: MODE.FULL }).mode === MODE.LIGHT);
t("PL-5c", "非法 force 被忽略（回落结构判定）",
	decideMode(p3, POLICY.BALANCED, { force: "ultra" }).mode === MODE.FULL);

console.log("\n【E】预算与成本");
const b1 = budgetFor(MODE.LIGHT, POLICY.BALANCED, { steps: 4, maxParallel: 3 });
t("PL-6a", "上限字段齐全且为正", b1.maxCalls > 0 && b1.maxParallel > 0 && b1.maxBytes > 0);
t("PL-6b", "light 不吃评审调用（每步 1 次）", b1.maxCalls === 4, b1);
const b2 = budgetFor(MODE.FULL, POLICY.BALANCED, { steps: 4, maxParallel: 2 });
t("PL-6c", "🌐 full 每步额外一次评审 → 需要 8 次", b2.note.indexOf("8") >= 0, b2.note);
t("PL-6d", "🔴 rounds=0 表示不限轮（unlimited 策略）", policyOf(POLICY.UNLIMITED).cap.rounds === 0);
const b3 = budgetFor(MODE.FULL, POLICY.STRICT, { steps: 20, maxParallel: 5 });
t("PL-6e", "需要超上限时如实标 truncated（不静默截断）", b3.truncated === true && b3.note.indexOf("截断") >= 0, b3);
t("PL-6f", "并发上限取 min(策略上限, 结构并行度)", budgetFor(MODE.LIGHT, POLICY.BALANCED, { maxParallel: 3 }).maxParallel === 3);
const c1 = estimateCost(MODE.FULL, 4, [TIER_COST.cheap, TIER_COST.standard, TIER_COST.strong, TIER_COST.cheap]);
t("PL-7a", "调用数 = 步数 × 2（full 含评审）", c1.calls === 8, c1);
t("PL-7b", "权重 = 档位和 × 2", c1.weight === (1 + 2 + 6 + 1) * 2, c1);
t("PL-7c", "倍数 = 权重 × 模式倍率", c1.relative === c1.weight * 15, c1);
t("PL-7d", "文案含倍率（用户有权知道代价）", c1.text.indexOf("倍") >= 0, c1.text);
t("PL-7e", "档位常量从 roles.js 转出（不重复定义）",
	MODEL_TIER.CHEAP === "cheap" && TIER_COST.strong > TIER_COST.cheap);

console.log("\n【F】🔴 升档（先按平衡跑，看证据再放宽）");
const bg = budgetFor(MODE.LIGHT, POLICY.BALANCED, { steps: 4 });
t("PL-8a", "🔴 无证据 → 不升", suggestEscalation({}, bg, POLICY.BALANCED).escalate === false);
t("PL-8b", "有步骤在等人 → 升到 full", suggestEscalation({ needsHuman: 2 }, bg, POLICY.BALANCED).to === MODE.FULL);
t("PL-8c", "有机械断言未过 → 升", suggestEscalation({ assertFailed: 1 }, bg, POLICY.BALANCED).escalate === true);
t("PL-8d", "有评审未过 → 升", suggestEscalation({ reviewFailed: 1 }, bg, POLICY.BALANCED).escalate === true);
t("PL-8e", "🔴 已达策略上限 → 不升（不绕过用户设的闸）",
	(() => { const b = budgetFor(MODE.FULL, POLICY.BALANCED, { steps: 4 }); const r = suggestEscalation({ needsHuman: 1 }, b, POLICY.BALANCED); return r.escalate === false && r.reason.indexOf("上限") >= 0; })());
t("PL-8f", "预算用尽 → 不升", suggestEscalation({ needsHuman: 1, callsUsed: 99 }, bg, POLICY.BALANCED).reason.indexOf("上限") >= 0);
t("PL-8g", "direct 起步时升到 light（不是一步跳到 full）",
	suggestEscalation({ needsHuman: 1 }, budgetFor(MODE.DIRECT, POLICY.BALANCED, { steps: 1 }), POLICY.BALANCED).to === MODE.LIGHT);

console.log("\n【G】文案");
const ex = explainMode(MODE.FULL);
t("PL-9a", "explainMode 含适用条件", ex.indexOf("适用") >= 0, ex);
t("PL-9b", "explainMode 含**自身失败模式**（不是只说好处）", ex.indexOf("风险") >= 0, ex);
t("PL-9c", "explainMode 含代价倍率", ex.indexOf("15") >= 0, ex);

console.log("\n───────────────────────────────────────────────────────────");
const total = pass + fail;
console.log("  断言总数 " + total + "（声明 " + EXPECTED_TOTAL + "）· 通过 " + pass + " · 失败 " + fail);
if (total !== EXPECTED_TOTAL) {
	console.log("  ⚠ 断言总数与声明不符 ⇒ INVALID");
	process.exit(2);
}
if (fail) { console.log("  失败项：" + failures.join(" | ")); process.exit(1); }
console.log("  IS_PASS: TRUE");
process.exit(0);
