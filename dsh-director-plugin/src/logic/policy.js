/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：执行模式与策略
 * 引用：—
 * 上游：client-entry.js, components/OrchestratorPanel.js
 * 下游：logic/roles.js
 * 设计稿：docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 八（三模式四策略 · 削顶标注 · 无证据不升级）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/policy.js — 执行模式与策略
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它（这是"防止用户把简单任务做成贵任务"的那道闸）
 * ══════════════════════════════════════════════════════════════════
 *  Anthropic 的实测口径：「普通 agent 约 4 倍对话 token，multi-agent 约 15 倍」，
 *  并把这写成硬条件 ——「多 agent 系统要求**任务价值足够高**以支付性能溢价」。
 *  而用户最容易犯的错，恰恰是「任务简单却选了多 agent」，成本从 1 倍直接跳到 15 倍。
 *
 *  ⇒ 故本文件的默认值是 **direct**，升档需要理由。
 *     这与 OrgAgent 论文的做法一致：三种执行模式
 *     （direct generation / light collaboration / full MAS）
 *     配四种策略（strict / balanced / unlimited / auto）。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 选模式的判据是「依赖结构」，不是「模型数量」
 * ══════════════════════════════════════════════════════════════════
 *  Microsoft Agent Framework 官方原话：**从依赖结构选拓扑，不是从模型数量选**。
 *  并行只有在子任务**真正独立**、且下游能处理部分或冲突结果时才有效。
 *  故 `decideMode()` 读的是 `maxParallel`（最大并行度）与 `levels`（层数），
 *  而不是"有几个角色"。
 *
 * ⚠️ 依赖方向：本文件只 import `logic/roles.js`（为拿档位倍率常量）。
 *   roles.js 自身**零依赖**，故本文件仍可被离线单测直接 import，
 *   不会牵进任何平台冻结模块（react 等）。反向依赖不存在，无环。
 */

import { MODEL_TIER, TIER_COST } from "./roles.js";

/* ══════════════════════════════════════════════════════════════════
 * 一、执行模式
 * ══════════════════════════════════════════════════════════════════ */

/** 三种执行模式（OrgAgent: direct / light collaboration / full MAS） */
export const MODE = Object.freeze({
	DIRECT: "direct",   // 单角色直接产出
	LIGHT: "light",     // 轻量协作：少量并行，共同产出
	FULL: "full"        // 全量协作：多角色 + 跨族评审 + 多轮
});

/**
 * 模式元数据。
 * 🔴 `multiplier` 是**token 量级**（相对普通对话），不是单价 ——
 *    界面上必须如实显示，否则用户会在账单出来后才后悔。
 * 🔴 `failMode` 写的是**这种模式自己会怎么坏**，不是别人的毛病。
 */
export const MODES = Object.freeze([
	{
		key: MODE.DIRECT, label: "直连", icon: "▸", multiplier: 1,
		when: "单一动作：问一句、查一下、改一处、整理一段话",
		failMode: "任务其实需要多步，但没人拆，最后交出来的东西缺一半",
		delegates: false, reviews: false
	},
	{
		key: MODE.LIGHT, label: "轻协作", icon: "▸▸", multiplier: 4,
		when: "2 到 4 个**真正独立**的子任务，能一次并行做完",
		failMode: "没有真正并行：几个子任务共用了同一个上游产出，结果还是串行跑，白花 4 倍",
		delegates: true, reviews: false
	},
	{
		key: MODE.FULL, label: "全协作", icon: "▸▸▸", multiplier: 15,
		when: "多阶段产出（文档 → 审核 → 蓝图 → 测试）且需要独立合规层验收",
		failMode: "过度委派：简单查询拉起一堆子 agent，成本涨 15 倍而质量没有提升",
		delegates: true, reviews: true
	}
]);

/** 取模式元数据（未知回落直连，**偏保守**） */
export function modeOf(key) {
	return MODES.find((m) => m.key === key) || MODES[0];
}

/** 模式选择理由文案（UI 上直接显示，避免"系统替我决定了但我不懂为什么"） */
export function explainMode(key) {
	const m = modeOf(key);
	return "【" + m.label + "】适用：" + m.when + "；代价约 " + m.multiplier + " 倍 token；自身风险：" + m.failMode;
}

/* ══════════════════════════════════════════════════════════════════
 * 二、策略（硬上限的松紧）
 * ══════════════════════════════════════════════════════════════════ */

/** 四种策略（OrgAgent: strict / balanced / unlimited / auto） */
export const POLICY = Object.freeze({
	STRICT: "strict",
	BALANCED: "balanced",
	UNLIMITED: "unlimited",
	AUTO: "auto"
});

export const POLICIES = Object.freeze([
	{
		key: POLICY.STRICT, label: "严格", icon: "🔒",
		note: "上限压到最低，宁可少跑几步也不超预算。适合「我就想快点看到东西」",
		cap: { calls: 6, parallel: 2, rounds: 1, bytes: 60000 },
		/* 严格模式下**禁止升级**模式：说了省就别偷偷升 */
		maxMode: MODE.LIGHT
	},
	{
		key: POLICY.BALANCED, label: "平衡", icon: "⚖",
		note: "按依赖结构如实选档，上限给到够用。默认值",
		cap: { calls: 24, parallel: 4, rounds: 3, bytes: 200000 },
		maxMode: MODE.FULL
	},
	{
		key: POLICY.UNLIMITED, label: "不限", icon: "∞",
		note: "不设轮数上限，只保留硬性的并发与调用数兜底。适合用户明确说「做透」",
		cap: { calls: 120, parallel: 8, rounds: 0, bytes: 800000 },   // rounds 0 = 不限轮
		maxMode: MODE.FULL
	},
	{
		key: POLICY.AUTO, label: "自动", icon: "◎",
		note: "先按平衡跑第一步，跑完看实际用量再决定要不要放宽（**不是一上来就放开**）",
		cap: { calls: 24, parallel: 4, rounds: 3, bytes: 200000 },
		maxMode: MODE.FULL
	}
]);

export function policyOf(key) {
	return POLICIES.find((p) => p.key === key) || POLICIES[1];
}

/* ══════════════════════════════════════════════════════════════════
 * 三、任务画像（决定模式的输入）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 从 DAG 统计里提取决策所需的画像。
 * 只读**结构量**，不读字数、不读"看起来难不难"。
 *
 * @param {object} stats `logic/dag.js#graphStats` 的返回（或同形状对象）
 * @param {object} [extra] { deliverables?:number, risk?:0-5, gates?:number }
 */
export function profileOf(stats = {}, extra = {}) {
	const s = stats && typeof stats === "object" ? stats : {};
	const deliverables = Number.isFinite(extra.deliverables) ? Number(extra.deliverables) : (Number(s.steps) || 0);
	const risk = Number.isFinite(extra.risk) ? Math.max(0, Math.min(5, Number(extra.risk))) : 2;
	return {
		steps: Number(s.steps) || 0,
		edges: Number(s.edges) || 0,
		levels: Number(s.levels) || 0,
		maxParallel: Number(s.maxParallel) || 0,
		gates: Number.isFinite(s.gates) ? Number(s.gates) : (Number(extra.gates) || 0),
		loops: Number(s.loops) || 0,
		deliverables,
		risk
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 四、决策
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 决定执行模式。
 *
 * 判据（**依赖结构优先**，逐条可复算）：
 *   ① 步骤数 ≤ 1，或（层数 ≤ 1 且最大并行度 ≤ 1）⇒ direct
 *   ② 最大并行度 ≥ 2 且层数 ≤ 2 ⇒ light（真并行、结构平坦）
 *   ③ 层数 ≥ 3，或 有闸门，或 风险 ≥ 4 ⇒ full（多阶段 / 需要人 / 高风险）
 *   ④ 其余按 deliverables ≥ 4 ⇒ full，否则 light
 *
 * `policy.maxMode` 是**天花板**：用户说了"严格"就不许偷偷升到 full。
 *
 * @param {object} profile `profileOf()` 的返回
 * @param {string} [policyKey]
 * @param {object} [opts] { force?:string }
 * @returns {{mode:string, wantMode:string, capped:boolean, reason:string, trace:string[]}}
 */
export function decideMode(profile, policyKey = POLICY.BALANCED, opts = {}) {
	const p = profile && typeof profile === "object" ? profile : profileOf();
	const pol = policyOf(policyKey);
	const trace = [];

	let want;
	if (opts.force && MODES.some((m) => m.key === opts.force)) {
		want = opts.force;
		trace.push("用户显式指定：" + modeOf(want).label);
	} else if (p.steps <= 1 || (p.levels <= 1 && p.maxParallel <= 1)) {
		want = MODE.DIRECT;
		trace.push("步骤数 " + p.steps + "、层数 " + p.levels + "、最大并行 " + p.maxParallel + " ⇒ 无拆解空间");
	} else if (p.levels >= 3 || p.gates > 0 || p.risk >= 4) {
		want = MODE.FULL;
		trace.push("层数 " + p.levels + " / 闸门 " + p.gates + " / 风险 " + p.risk + " ⇒ 多阶段或少不了人工介入");
	} else if (p.maxParallel >= 2 && p.levels <= 2) {
		want = MODE.LIGHT;
		trace.push("最大并行 " + p.maxParallel + " 且层数 " + p.levels + " ⇒ 真并行、结构平坦");
	} else {
		want = p.deliverables >= 4 ? MODE.FULL : MODE.LIGHT;
		trace.push("产出 " + p.deliverables + " 项 ⇒ " + modeOf(want).label);
	}

	/* 策略天花板 */
	const rank = { direct: 0, light: 1, full: 2 };
	let mode = want;
	let capped = false;
	if (rank[want] > rank[pol.maxMode]) {
		mode = pol.maxMode;
		capped = true;
		trace.push("「" + pol.label + "」策略把上限压到 " + modeOf(pol.maxMode).label + "（原本想要 " + modeOf(want).label + "）");
	}

	return {
		mode, wantMode: want, capped,
		reason: trace.join("；") + " ⇒ 采用【" + modeOf(mode).label + "】",
		trace
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 五、预算与成本
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 生成本次运行的硬上限。
 * 🔴 `rounds: 0` 表示**不限轮**（策略里的"不限"档）—— 这是唯一一个
 *    允许"无上限"的字段，因为它对应的是用户明确说的"做透"。
 *    其余字段**一律有值**：没有任何兜底上限的系统，坏起来是无声的。
 * @returns {{maxCalls:number, maxParallel:number, maxRounds:number, maxBytes:number, gates:number, policy:string, mode:string}}
 */
export function budgetFor(mode, policyKey = POLICY.BALANCED, profile = {}) {
	const pol = policyOf(policyKey);
	const m = modeOf(mode);
	const p = profile && typeof profile === "object" ? profile : {};
	const cap = pol.cap;
	const steps = Number(p.steps) || 1;

	/* 调用数：每步至少 1 次；full 模式每步额外一次跨族评审；闸门不吃调用 */
	const perStep = m.reviews ? 2 : 1;
	const need = steps * perStep;
	return {
		maxCalls: Math.min(cap.calls, Math.max(need, 1)),
		maxParallel: Math.min(cap.parallel, Math.max(Number(p.maxParallel) || 1, 1)),
		maxRounds: cap.rounds,
		maxBytes: cap.bytes,
		gates: Number(p.gates) || 0,
		policy: pol.key,
		mode: m.key,
		/* 预算被策略压低时如实说明（不静默截断） */
		truncated: need > cap.calls,
		note: need > cap.calls
			? ("按结构需要约 " + need + " 次调用，策略上限 " + cap.calls + " 次 ⇒ 会截断")
			: ("需要约 " + need + " 次调用，上限 " + cap.calls + " 次")
	};
}

/**
 * 成本预估（相对普通对话的倍数）。
 *
 * 口径：**角色档位加权**后再乘模式系数。
 * 🔴 那个乘法关系要写出来给用户看 —— 因为"15 倍"的观感与"6 档位 × 15 倍"
 *    差别巨大，用户有权在点下按钮前知道。
 *
 * @param {string} mode
 * @param {Array} steps 步骤（读 role 的档位由调用方传 tiers 更直接）
 * @param {number[]} [tiers] 每步的成本倍率（`roles.js#TIER_COST`）
 * @returns {{calls:number, weight:number, multiplier:number, relative:number, text:string}}
 */
export function estimateCost(mode, steps, tiers) {
	const m = modeOf(mode);
	const n = Array.isArray(steps) ? steps.length : (Number(steps) || 1);
	const units = Array.isArray(tiers) && tiers.length
		? tiers.reduce((a, b) => a + (Number(b) || 1), 0)
		: n;
	const perStep = m.reviews ? 2 : 1;
	const calls = n * perStep;
	const weight = units * perStep;
	const relative = weight * m.multiplier;
	return {
		calls,
		weight,
		multiplier: m.multiplier,
		relative,
		text: modeOf(mode).label + "：" + calls + " 次调用 · 档位权重 " + weight
			+ " · 约 " + (relative / Math.max(1, n)).toFixed(1) + " 倍于普通对话（单步口径）"
	};
}

/** 档位倍率重导出（避免调用方为了一个常量多引一个模块） */
export { MODEL_TIER, TIER_COST };

/* ══════════════════════════════════════════════════════════════════
 * 六、升级判定（跑完再看要不要放宽）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 运行中是否该升档。
 * `AUTO` 策略的语义就是这个：**先按平衡跑，跑完看证据再放宽**。
 *
 * 只在三种证据出现时才建议升档（其余一律不动）：
 *   ① 有步骤因缺信息停下（needsHuman > 0）
 *   ② 有机械断言失败（assertFailed > 0）
 *   ③ 有跨族评审判负（reviewFailed > 0）
 *
 * @param {object} observed { needsHuman, assertFailed, reviewFailed, callsUsed }
 * @param {object} budget `budgetFor()` 的返回
 * @param {string} policyKey
 * @returns {{escalate:boolean, to:string|null, reason:string}}
 */
export function suggestEscalation(observed = {}, budget = {}, policyKey = POLICY.BALANCED) {
	const o = observed && typeof observed === "object" ? observed : {};
	const b = budget && typeof budget === "object" ? budget : {};
	const pol = policyOf(policyKey);
	const rank = { direct: 0, light: 1, full: 2 };

	/* 已经到策略上限 ⇒ 不升（否则就是绕过用户设的闸） */
	if (rank[b.mode || MODE.DIRECT] >= rank[pol.maxMode]) {
		return { escalate: false, to: null, reason: "已达「" + pol.label + "」策略上限（" + modeOf(pol.maxMode).label + "）" };
	}
	/* 预算已用尽 ⇒ 不升 */
	if (Number(o.callsUsed) >= Number(b.maxCalls)) {
		return { escalate: false, to: null, reason: "调用数已达上限 " + b.maxCalls };
	}

	const need = [];
	if (Number(o.needsHuman) > 0) need.push(Number(o.needsHuman) + " 个步骤在等人");
	if (Number(o.assertFailed) > 0) need.push(Number(o.assertFailed) + " 个机械断言未过");
	if (Number(o.reviewFailed) > 0) need.push(Number(o.reviewFailed) + " 个评审未通过");

	if (!need.length) return { escalate: false, to: null, reason: "无升级证据（无阻塞、无失败）" };

	const to = b.mode === MODE.DIRECT ? MODE.LIGHT : MODE.FULL;
	return {
		escalate: true, to,
		reason: "出现证据（" + need.join("、") + "）⇒ 建议升到【" + modeOf(to).label + "】（" + modeOf(to).multiplier + " 倍量级）"
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 七、策略表自检
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 策略表自检。
 *   ① 每个策略的 cap 四个字段都有值（rounds 允许 0 = 不限）
 *   ② maxMode 合法且**存在**（否则天花板形同虚设）
 *   ③ 上限随「松紧」单调：strict ≤ balanced ≤ unlimited（逐字段）
 *   ④ 模式倍率单调：direct < light < full
 *
 * 🔴 接受可选参数以便**正负对照校准**（纪律 32：新检查必须用植入的目标缺陷
 *    验证它会报红，且注入的是它本该管的那张表）。
 * @param {Array} [modes] 模式表（默认内置）
 * @param {Array} [policies] 策略表（默认内置）
 * @returns {{ok:boolean, fails:string[]}}
 */
export function auditPolicy(modes = MODES, policies = POLICIES) {
	const fails = [];
	const md = Array.isArray(modes) && modes.length ? modes : MODES;
	const pl = Array.isArray(policies) && policies.length ? policies : POLICIES;
	const keys = md.map((m) => m.key);

	for (const p of pl) {
		for (const k of ["calls", "parallel", "rounds", "bytes"]) {
			const v = p.cap[k];
			if (!Number.isFinite(v) || v < 0) fails.push(p.key + " 的 cap." + k + " 无效：" + v);
		}
		if (!keys.includes(p.maxMode)) fails.push(p.key + " 的 maxMode 非法：" + p.maxMode);
		/* strict 不许把天花板设成 full（说了省就别偷偷升） */
		if (p.key === POLICY.STRICT && p.maxMode === MODE.FULL) fails.push("strict 的 maxMode 不得为 full（与「省」的语义矛盾）");
	}

	const order = [POLICY.STRICT, POLICY.BALANCED, POLICY.UNLIMITED];
	const get = (k) => ((pl.find((x) => x.key === k) || {}).cap || {});
	for (let i = 1; i < order.length; i++) {
		for (const f of ["calls", "parallel", "bytes"]) {
			const prev = get(order[i - 1])[f];
			const cur = get(order[i])[f];
			if (Number.isFinite(prev) && Number.isFinite(cur) && cur < prev) {
				fails.push("上限非单调：" + order[i - 1] + "." + f + "(" + prev + ") > " + order[i] + "." + f + "(" + cur + ")");
			}
		}
	}

	const mult = md.map((m) => m.multiplier);
	for (let i = 1; i < mult.length; i++) {
		if (!(mult[i] > mult[i - 1])) fails.push("模式倍率非递增：" + md[i - 1].key + "(" + mult[i - 1] + ") ≥ " + md[i].key + "(" + mult[i] + ")");
	}

	return { ok: fails.length === 0, fails };
}

/* ══════════════════════════════════════════════════════════════════
 * 八、全局契约
 * ══════════════════════════════════════════════════════════════════ */

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installPolicyApi() {
	if (typeof window === "undefined") return null;
	window.__dshPolicy = {
		MODE, MODES, POLICY, POLICIES,
		modeOf, explainMode, policyOf,
		profileOf, decideMode,
		budgetFor, estimateCost, suggestEscalation,
		auditPolicy
	};
	return window.__dshPolicy;
}
