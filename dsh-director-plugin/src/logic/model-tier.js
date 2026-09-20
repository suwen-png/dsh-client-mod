/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：模型 tier 决策树（**纯函数**：无 DOM / 无 store / 无副作用）
 * 引用：—
 * 上游：client-entry.js
 * 下游：logic/roles.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/model-tier.js — 模型 tier 决策树（**纯函数**：无 DOM / 无 store / 无副作用）
 *
 * ── 为什么单独一层（WS-B · B8）─────────────────────────────────────
 *   最高权重需求：「分流/任务判断由模型按语义做，插件只执行」。
 *   选哪个档的模型（cheap/standard/strong）是**决策**，不是实现细节。
 *   改之前：`roles.js#resolveTierModel()` 只会把抽象档位**落成模型名**
 *   （cheap→deepseek-chat、strong→deepseek-reasoner），
 *   但「这件事该用哪个档」这个**判断**散落在调用点的 if 里，没有唯一真相源。
 *
 *   本模块只做一件事：给定**任务信号**（复杂度 / 步数 / 成本敏感度 / 紧迫性…），
 *   按一张**外置规则表**纯函数地选档，并给出**为什么选它**（reason）。
 *
 * ── 🔴 三条硬边界 ────────────────────────────────────────────────
 *   · **零 DOM / 零 localStorage**：必须能在 Node 离线单测里裸跑。
 *   · **规则表外置**：`DEFAULT_TIER_RULES` 是**纯数据**（不是闭包），
 *     调用方可传 `rules` 覆盖 ⇒ 改策略**不改代码**（纪律 126：映射不写死在分支里）。
 *   · **复用 roles.js 的档位词汇**：`MODEL_TIER` 来自 roles.js（它本身零 import），
 *     本模块**不另造** cheap/standard/strong 三套常量（否则就是纪律 126 的隐式断链）。
 */

import { MODEL_TIER, TIER_COST } from "./roles.js";

/** 档位优先级（升档用：strong > standard > cheap；同档相等） */
const TIER_RANK = Object.freeze({
	[MODEL_TIER.CHEAP]: 1,
	[MODEL_TIER.STANDARD]: 2,
	[MODEL_TIER.STRONG]: 3,
	[MODEL_TIER.INHERIT]: 2
});

/* ══════════════════════════════════════════════════════════════════
 * 规则表（纯数据；**不写死在 if/else 里**）
 * ══════════════════════════════════════════════════════════════════
 * 每条规则形状：
 *   {
 *     id:        string   规则名（reason 里回显，便于审计「为什么升档」）
 *     tier:      string    命中时选的档（MODEL_TIER.* 之一）
 *     when: {              条件（**全部满足**才命中；缺省字段 = 不限）
 *       complexityMin?: number   复杂度 ≥ 此值
 *       complexityMax?: number   复杂度 ≤ 此值
 *       stepsMin?:     number    步数 ≥ 此值
 *       costSensitive?: boolean  成本敏感（true 时倾向降档）
 *       urgent?:       boolean   紧急（true 时倾向升档）
 *       ambiguous?:    boolean   输入含糊（true 时倾向升档给推理）
 *       wordMin?:      number    原文词数 ≥ 此值
 *     }
 *     reason: string        命中时回显的理由
 *   }
 *
 * 🔴 规则按**数组顺序**自上而下匹配，**首个全条件满足者胜出**（与关键词打分不同：
 *    这里是决策树，不是累加）。调用方传自己的 rules 即可改策略，本模块零改动。
 */
export const DEFAULT_TIER_RULES = Object.freeze([
	{
		id: "r-urgent-complex",
		tier: MODEL_TIER.STRONG,
		when: { urgent: true, complexityMin: 7 },
		reason: "紧急且复杂（复杂度≥7）⇒ 强档推理，一次做对比省钱重要"
	},
	{
		id: "r-multi-step",
		tier: MODEL_TIER.STRONG,
		when: { stepsMin: 4 },
		reason: "多步任务（≥4 步）⇒ 强档，靠推理维持跨步一致性"
	},
	{
		id: "r-ambiguous",
		tier: MODEL_TIER.STANDARD,
		when: { ambiguous: true },
		reason: "输入含糊/有歧义 ⇒ 升到标准档，给一轮澄清式推理"
	},
	{
		id: "r-cost-sensitive",
		tier: MODEL_TIER.CHEAP,
		when: { costSensitive: true, complexityMax: 5 },
		reason: "成本敏感且不复杂（复杂度≤5）⇒ 便宜档足够"
	},
	{
		id: "r-long-text",
		tier: MODEL_TIER.STANDARD,
		when: { wordMin: 400 },
		reason: "长文（≥400 词）⇒ 标准档，便宜档易在长上下文里漏要点"
	},
	{
		id: "r-trivial",
		tier: MODEL_TIER.CHEAP,
		when: { complexityMax: 2 },
		reason: "琐碎任务（复杂度≤2）⇒ 便宜档，省钱杠杆最大"
	},
	{
		id: "r-fallback",
		tier: MODEL_TIER.STANDARD,
		when: {},
		reason: "未命中任何特定规则 ⇒ 标准档（不便宜不奢侈的默认）"
	}
]);

/** 归一化任务信号（缺省给安全值，不抛） */
export function normalizeSignals(input) {
	const s = (input && typeof input === "object") ? input : {};
	const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
	const bool = (v, d) => (v == null ? d : Boolean(v));
	return {
		complexity: Math.max(0, Math.min(10, num(s.complexity, 3))),
		steps: Math.max(0, Math.floor(num(s.steps, 1))),
		costSensitive: bool(s.costSensitive, false),
		urgent: bool(s.urgent, false),
		ambiguous: bool(s.ambiguous, false),
		wordCount: Math.max(0, Math.floor(num(s.wordCount, 0))),
		domain: typeof s.domain === "string" ? s.domain : ""
	};
}

/** 判断一条规则的 when 是否被信号全部满足（缺省字段 = 不限） */
function matchWhen(when, s) {
	const w = (when && typeof when === "object") ? when : {};
	if (w.complexityMin != null && s.complexity < Number(w.complexityMin)) return false;
	if (w.complexityMax != null && s.complexity > Number(w.complexityMax)) return false;
	if (w.stepsMin != null && s.steps < Number(w.stepsMin)) return false;
	if (w.costSensitive != null && s.costSensitive !== Boolean(w.costSensitive)) return false;
	if (w.urgent != null && s.urgent !== Boolean(w.urgent)) return false;
	if (w.ambiguous != null && s.ambiguous !== Boolean(w.ambiguous)) return false;
	if (w.wordMin != null && s.wordCount < Number(w.wordMin)) return false;
	/* 等值字段：domain 精确相等才命中（缺省 = 不限） */
	if (w.domain != null && String(s.domain || "") !== String(w.domain)) return false;
	return true;
}

/**
 * 决策树选档。
 *
 * @param {object} signals 任务信号（见 normalizeSignals）
 * @param {Array} [rules] 规则表；缺省用 DEFAULT_TIER_RULES（外置，可覆盖）
 * @returns {{tier:string, reason:string, via:string, costRank:number, matchedRule:string}}
 *   via = "rule"（命中规则表）—— 台账据此区分「插件决策」vs「模型路由」
 */
export function decideTier(signals, rules) {
	const s = normalizeSignals(signals);
	const table = Array.isArray(rules) && rules.length ? rules : DEFAULT_TIER_RULES;
	for (let i = 0; i < table.length; i++) {
		const r = table[i];
		if (!r || typeof r !== "object") continue;
		if (matchWhen(r.when, s)) {
			const tier = Object.prototype.hasOwnProperty.call(TIER_RANK, r.tier) ? r.tier : MODEL_TIER.STANDARD;
			return {
				tier: tier,
				reason: String(r.reason || ""),
				via: "rule",
				costRank: TIER_RANK[tier] || 2,
				matchedRule: String(r.id || ("rule-" + i))
			};
		}
	}
	/* 理论上到不了（末条 when={} 兜底），但 rules 全是坏条目时别抛 */
	return { tier: MODEL_TIER.STANDARD, reason: "规则表为空/全坏 ⇒ 标准档", via: "fallback", costRank: 2, matchedRule: "empty" };
}

/**
 * 比较两档（用于「不允许降档到比当前还低」的守卫）。
 * @returns {number} 正数 = a 比 b 高；0 = 同级；负数 = a 比 b 低
 */
export function tierRankDelta(a, b) {
	const ra = TIER_RANK[a] != null ? TIER_RANK[a] : 2;
	const rb = TIER_RANK[b] != null ? TIER_RANK[b] : 2;
	return ra - rb;
}

/** 档位成本倍率（直通 roles.js，单一真相源；本模块不另造一份） */
export function tierCostMultiplier(tier) {
	return TIER_COST[tier] != null ? TIER_COST[tier] : TIER_COST[MODEL_TIER.STANDARD];
}

/** 决策树版本（规则表改了就 bump，调用方据此决定是否重选档） */
export const TIER_DECISION_VERSION = "1.0.0";

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installModelTierApi() {
	if (typeof window === "undefined") return null;
	window.__dshModelTier = {
		TIER_DECISION_VERSION, DEFAULT_TIER_RULES,
		normalizeSignals, decideTier, tierRankDelta, tierCostMultiplier
	};
	return window.__dshModelTier;
}
