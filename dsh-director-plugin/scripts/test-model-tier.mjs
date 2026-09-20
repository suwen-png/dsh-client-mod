#!/usr/bin/env node
/**
 * test-model-tier.mjs —— 模型 tier 决策树 · 纯函数离线测试（无需 Harness）
 *
 * ════════════════════════════════════════════════════════════
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | MT-1  | 版本号是非空字符串 | TIER_DECISION_VERSION 可被读取 |
 *  | MT-2  | 规则表是纯数据（可 JSON 序列化） | DEFAULT_TIER_RULES JSON 往返不丢字段 |
 *  | MT-3  | 紧急且复杂 ⇒ strong | 命中 r-urgent-complex |
 *  | MT-4  | 多步（≥4）⇒ strong | 命中 r-multi-step |
 *  | MT-5  | 输入含糊 ⇒ standard | 命中 r-ambiguous |
 *  | MT-6  | 成本敏感且不复杂 ⇒ cheap | 命中 r-cost-sensitive |
 *  | MT-7  | 长文 ⇒ standard | 命中 r-long-text |
 *  | MT-8  | 琐碎 ⇒ cheap | 命中 r-trivial |
 *  | MT-9  | 未命中 ⇒ standard 兜底 | 命中 r-fallback |
 *  | MT-10 | 返回体带 via/costRank/matchedRule | 字段齐全 |
 *  | MT-11 | 规则表可外置覆盖 | 传自定义 rules 走自定义分支 |
 *  | MT-12 | 规则顺序：先命中先胜 | 紧急复杂优先于多步 |
 *  | MT-13 | 信号归一化：null/缺省不抛 | 安全默认值 |
 *  | MT-14 | 复杂度钳制在 0..10 | 越界值被夹回 |
 *  | MT-15 | tierRankDelta 升/降/平 | strong>cheap，standard==standard |
 *  | MT-16 | 成本倍率直通 roles.js | cheap=1 strong=6 |
 *  | MT-17 | 坏规则表（全坏条目）不抛 | 回落 standard |
 *
 * 用法：
 *   node scripts/test-model-tier.mjs                 ｜ 全绿应 exit 0
 *   MODEL_TIER_NEG=1 node scripts/test-model-tier.mjs ｜ 植入缺陷（必须红 exit≠0）
 * 退出码：0 全绿 / 1 有失败 / 2 对账 INVALID
 */
import {
	TIER_DECISION_VERSION, DEFAULT_TIER_RULES,
	normalizeSignals, decideTier, tierRankDelta, tierCostMultiplier
} from "../src/logic/model-tier.js";
import { MODEL_TIER } from "../src/logic/roles.js";
import { tallyCheck } from "./_test-tally.mjs";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + name); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + "\n       " + JSON.stringify(detail)); }
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  模型 tier 决策树 · 纯函数离线测试（logic/model-tier.js）");
console.log("  TIER_DECISION_VERSION = " + TIER_DECISION_VERSION);
console.log("═══════════════════════════════════════════════════════════");

t("MT-1", "版本号是非空字符串（规则表改了可据此重选档）",
	typeof TIER_DECISION_VERSION === "string" && TIER_DECISION_VERSION.length > 0, TIER_DECISION_VERSION);

const roundTrip = JSON.parse(JSON.stringify(DEFAULT_TIER_RULES));
t("MT-2", "🔴 规则表是纯数据（JSON 往返不丢 id/tier/when/reason）",
	Array.isArray(roundTrip) && roundTrip.length === DEFAULT_TIER_RULES.length
		&& roundTrip.every((r, i) => r.id === DEFAULT_TIER_RULES[i].id && r.tier === DEFAULT_TIER_RULES[i].tier
			&& r.reason === DEFAULT_TIER_RULES[i].reason),
	{ count: roundTrip.length });

const urgentComplex = decideTier({ urgency: true, urgent: true, complexity: 9 });
t("MT-3", "紧急且复杂（复杂度≥7）⇒ strong",
	urgentComplex.tier === MODEL_TIER.STRONG && urgentComplex.matchedRule === "r-urgent-complex", urgentComplex);

const multi = decideTier({ steps: 5, complexity: 3 });
t("MT-4", "多步任务（≥4 步）⇒ strong",
	multi.tier === MODEL_TIER.STRONG && multi.matchedRule === "r-multi-step", multi);

const ambiguous = decideTier({ ambiguous: true, complexity: 3 });
t("MT-5", "输入含糊 ⇒ standard",
	ambiguous.tier === MODEL_TIER.STANDARD && ambiguous.matchedRule === "r-ambiguous", ambiguous);

const cheapSensitive = decideTier({ costSensitive: true, complexity: 4, steps: 1 });
t("MT-6", "成本敏感且不复杂（≤5）⇒ cheap",
	cheapSensitive.tier === MODEL_TIER.CHEAP && cheapSensitive.matchedRule === "r-cost-sensitive", cheapSensitive);

const long = decideTier({ wordCount: 500, complexity: 3 });
t("MT-7", "长文（≥400 词）⇒ standard",
	long.tier === MODEL_TIER.STANDARD && long.matchedRule === "r-long-text", long);

const trivial = decideTier({ complexity: 1, steps: 1 });
t("MT-8", "琐碎任务（复杂度≤2）⇒ cheap",
	trivial.tier === MODEL_TIER.CHEAP && trivial.matchedRule === "r-trivial", trivial);

const fallback = decideTier({ complexity: 5, steps: 2, wordCount: 100 });
t("MT-9", "未命中特定规则 ⇒ standard 兜底（r-fallback）",
	fallback.tier === MODEL_TIER.STANDARD && fallback.matchedRule === "r-fallback", fallback);

t("MT-10", "返回体带 via/costRank/matchedRule/reason 四字段齐全",
	typeof urgentComplex.via === "string" && typeof urgentComplex.costRank === "number"
		&& typeof urgentComplex.matchedRule === "string" && typeof urgentComplex.reason === "string",
	urgentComplex);

/* 外置规则表：调用方传自己的 rules ⇒ 走自定义分支，本模块零改动 */
const customRules = [
	{ id: "my-rule", tier: MODEL_TIER.STRONG, when: { domain: "novel" }, reason: "小说领域一律强档" },
	{ id: "my-default", tier: MODEL_TIER.CHEAP, when: {}, reason: "其余便宜档" }
];
const custom = decideTier({ domain: "novel", complexity: 1 }, customRules);
const customOther = decideTier({ domain: "math", complexity: 9 }, customRules);
t("MT-11", "🔴 规则表外置可覆盖（传自定义 rules 走自定义分支，不改源码）",
	custom.tier === MODEL_TIER.STRONG && custom.matchedRule === "my-rule"
		&& customOther.tier === MODEL_TIER.CHEAP && customOther.matchedRule === "my-default",
	{ novel: custom, math: customOther });

/* 规则顺序：urgent+complex(9) 同时也 steps=4 ⇒ 应先命中 r-urgent-complex（排在 r-multi-step 之前） */
const order = decideTier({ urgent: true, complexity: 9, steps: 4 });
t("MT-12", "规则顺序：首个全满足者胜出（紧急复杂优先于多步）",
	order.matchedRule === "r-urgent-complex", order);

let threwNorm = false, weird;
try {
	weird = normalizeSignals(null);
	normalizeSignals(undefined);
	normalizeSignals("junk");
	normalizeSignals({ complexity: "abc", steps: "x" });
} catch (e) { threwNorm = true; }
t("MT-13", "🔴 信号归一化：null/非对象/坏数字不抛、给安全默认",
	threwNorm === false && weird && typeof weird.complexity === "number" && weird.steps === 1,
	{ threw: threwNorm, weird: weird });

const clamped = normalizeSignals({ complexity: 99, wordCount: -5 });
t("MT-14", "复杂度钳制在 0..10（越界值夹回）",
	clamped.complexity === 10 && clamped.wordCount === 0, clamped);

t("MT-15", "tierRankDelta：strong>cheap(+)、standard==standard(0)、cheap<standard(-)",
	tierRankDelta(MODEL_TIER.STRONG, MODEL_TIER.CHEAP) > 0
		&& tierRankDelta(MODEL_TIER.STANDARD, MODEL_TIER.STANDARD) === 0
		&& tierRankDelta(MODEL_TIER.CHEAP, MODEL_TIER.STRONG) < 0,
	{ s: tierRankDelta(MODEL_TIER.STRONG, MODEL_TIER.CHEAP) });

t("MT-16", "成本倍率直通 roles.js（cheap=1 strong=6，单一真相源）",
	tierCostMultiplier(MODEL_TIER.CHEAP) === 1 && tierCostMultiplier(MODEL_TIER.STRONG) === 6
		&& tierCostMultiplier(MODEL_TIER.STANDARD) === 2,
	{ cheap: tierCostMultiplier(MODEL_TIER.CHEAP), strong: tierCostMultiplier(MODEL_TIER.STRONG) });

let threwBad = false, bad;
try {
	bad = decideTier({ complexity: 5 }, [null, "junk", { tier: "nope" }]);
} catch (e) { threwBad = true; }
t("MT-17", "坏规则表（null/字符串/缺 tier）不抛、回落 standard",
	threwBad === false && bad && bad.tier === MODEL_TIER.STANDARD,
	{ threw: threwBad, bad: bad });

/* ════════════════════════════════════════════════════════════
 * 植入缺陷校准（纪律 32/108：注入的缺陷必须真能翻转结论）。
 *   MODEL_TIER_NEG=1 ⇒ 断言「琐碎任务竟然选了 strong」—— 与 MT-8 真值相反。
 *   若有人把决策树改坏成"什么都 strong"，本套件当场变红。
 * ════════════════════════════════════════════════════════════ */
if (process.env.MODEL_TIER_NEG === "1") {
	console.log("  [注入缺陷] MODEL_TIER_NEG=1 ⇒ 期望琐碎任务竟然选 strong（与 MT-8 真值相反）");
	t("MT-NEG", "🔴 校准·琐碎任务竟然选 strong？",
		decideTier({ complexity: 1, steps: 1 }).tier === MODEL_TIER.STRONG);
}

const ran = pass + fail;
const MIN_ASSERTIONS = 17;
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "test-model-tier（纯离线）" });
if (!tally.ok) process.exit(2);

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + ran);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
