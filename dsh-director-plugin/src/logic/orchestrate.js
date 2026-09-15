/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总监统筹闭环（纯函数）
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js, components/OrchestratorPanel.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/orchestrate.js — 总监统筹闭环（纯函数）
 *
 * ── 需求（用户原话）─────────────────────────────────────────────
 *   「我最终核心目标为，比如我提供一个想法……文档完成之后，后续的开发文档编写，审核，
 *     蓝图设计，测试等等都由总监统筹。审核标准为前端审美、按钮交互，
 *     审核标准是为围绕核心目的进行打分判断是否满足，打分标准也需要进行审核，
 *     打分起码三轮多方位评估。」
 *   「也就是我提供一个想法，主要定时审核设计图效果就可以，有问题提给总监修改。」
 *
 * ── 三个必须分开的概念（混在一起就会退化成"跑三次同一套"）──────
 *   ① **阶段编排**：想法 → 文档 → 审核 → 蓝图 → 测试 → 收口（谁来产出什么、何时进下一阶段）
 *   ② **打分标准**：6 个维度 × 0–5 分，每档都有判据（不是"感觉不错给 4 分"）
 *   ③ **三轮机制**：三轮换的是**证据来源**，不是重复次数
 *        R1 规格符合性（对照需求文档）／ R2 独立证据源（真机截图 + DOM 回读）／
 *        R3 反证（构造"应该失败"的输入）
 *
 * ── 并行的一条硬要求：**打分标准自己也要被审**（用户明确要求）────────
 *   `auditRubric()` 三条：可达性 / 不重叠 / 可证伪。三条不全过，
 *   这套标准**不允许拿来打分** —— 否则分数是"看起来能区分"的数字。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、阶段编排
 * ══════════════════════════════════════════════════════════════════ */

export const STAGE = Object.freeze({
	PLAN: "plan",
	DOC: "doc",
	REVIEW: "review",
	BLUEPRINT: "blueprint",
	TEST: "test",
	DONE: "done"
});

/** 阶段定义：`need` = 进入本阶段需要的产出；`out` = 本阶段应产出什么 */
export const STAGES = Object.freeze([
	{ key: STAGE.PLAN, label: "拆解", out: "需求理解 + 任务清单", need: "想法" },
	{ key: STAGE.DOC, label: "文档", out: "设计/开发文档（含验收判据）", need: "任务清单" },
	{ key: STAGE.REVIEW, label: "审核", out: "六维打分 ≥ 阈值（≥3 轮）", need: "文档" },
	{ key: STAGE.BLUEPRINT, label: "蓝图", out: "施工图 / 蓝图", need: "审核通过" },
	{ key: STAGE.TEST, label: "测试", out: "测试计划 + 结果（含期望）", need: "蓝图" },
	{ key: STAGE.DONE, label: "收口", out: "闭环留痕", need: "测试通过" }
]);

export const STAGE_ORDER = Object.freeze(STAGES.map((s) => s.key));

/** 阶段 i 的下一阶段（末态返回自身） */
export function nextStage(key) {
	const i = STAGE_ORDER.indexOf(key);
	if (i < 0) return STAGE_ORDER[0];
	return STAGE_ORDER[Math.min(i + 1, STAGE_ORDER.length - 1)];
}

/**
 * 能否进入下一阶段。
 * @param {string} current
 * @param {object} evidence 各阶段的产出证据（真值：字符串非空 / 数组非空 / 布尔）
 * @returns {{ok:boolean, next:string, reason:string, missing:string[]}}
 */
export function canAdvance(current, evidence = {}) {
	const next = nextStage(current);
	const need = (STAGES[STAGE_ORDER.indexOf(next)] || {}).need || "";
	const missing = [];
	if (next === STAGE.DOC && !nonEmpty(evidence.plan)) missing.push("任务清单");
	if (next === STAGE.REVIEW && !nonEmpty(evidence.doc)) missing.push("文档");
	if (next === STAGE.BLUEPRINT) {
		if (!nonEmpty(evidence.doc)) missing.push("文档");
		if (!(evidence.score && evidence.score.passed)) missing.push("审核通过");
	}
	if (next === STAGE.TEST && !nonEmpty(evidence.blueprint)) missing.push("蓝图");
	if (next === STAGE.DONE) {
		if (!nonEmpty(evidence.blueprint)) missing.push("蓝图");
		if (!(evidence.test && evidence.test.passed)) missing.push("测试通过");
	}
	return {
		ok: missing.length === 0,
		next,
		reason: missing.length ? ("缺：" + missing.join("、") + "（进入「" + need + "」前需要）") : "可进入「" + next + "」",
		missing
	};
}

function nonEmpty(v) {
	if (v == null) return false;
	if (Array.isArray(v)) return v.length > 0;
	if (typeof v === "string") return v.trim().length > 0;
	if (typeof v === "boolean") return v;
	if (typeof v === "object") return Object.keys(v).length > 0;
	return true;
}

/**
 * 从一个想法生成阶段计划（总监接手的第一步）。
 * 纯函数：只做结构与文案，不调模型、不落库。
 */
export function planFor(idea) {
	const text = String(idea == null ? "" : idea).trim();
	return {
		idea: text,
		stage: text ? STAGE.PLAN : STAGE.PLAN,
		steps: STAGES.map((s, i) => ({
			seq: i + 1, key: s.key, label: s.label, out: s.out, need: s.need,
			done: false
		})),
		createdAt: Date.now(),
		empty: !text
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 二、打分标准（6 维 × 0–5 分 · 每档有判据）
 * ══════════════════════════════════════════════════════════════════ */

/** 各维度权重：用户点名的两维（审美 / 按钮交互）与核心目的同权，避免"好看就行" */
export const RUBRIC = Object.freeze([
	{
		key: "purpose", label: "核心目的达成", weight: 3,
		criterion: "5=用户原话逐条可对上并各有证据；3=主干达成但有遗漏；0=与目标无关",
		witness: "需求条目 ↔ 实现/断言逐条对照表"
	},
	{
		key: "aesthetic", label: "前端审美", weight: 2,
		criterion: "5=颜色/圆角/阴影全部走宿主令牌、与宿主零割裂；3=局部硬编码；0=对比度 <3:1 或明显割裂",
		witness: "真机截图 + 计算样式回读（令牌名）"
	},
	{
		key: "interaction", label: "按钮与交互", weight: 3,
		criterion: "5=每颗按钮都有真实回调且回读有证据；3=个别按钮无反馈；0=点了没反应",
		witness: "逐按钮点击 + 状态回读断言"
	},
	{
		key: "resilience", label: "边界与降级", weight: 2,
		criterion: "5=失败可归因且有降级路径；3=只覆盖主路径；0=静默失败",
		witness: "反证用例（空输入 / 依赖缺失 / 目标不存在）"
	},
	{
		key: "consistency", label: "一致性", weight: 1,
		criterion: "5=复用既有常量与令牌，无重复真相源；3=局部另起一套；0=同一语义两处定义",
		witness: "grep 常量/令牌名，看是否单点"
	},
	{
		key: "verifiability", label: "可验证性", weight: 2,
		criterion: "5=有自动化断言且断言承重（改了会红）；3=有断言但可被绕过；0=无证据",
		witness: "断开断言后必须变红（反证）"
	}
]);

export const RUBRIC_MAX = RUBRIC.reduce((s, r) => s + r.weight * 5, 0); // 满分（加权）

/**
 * 打分标准自审（用户明确要求「打分标准也需要进行审核」）。
 * 三条，全过才允许用该标准打分：
 *   ① 可达性：每个维度都要有 `criterion` 与 `witness`（能举出 0 分与 5 分的例子）
 *   ② 不重叠：`key` 唯一，且 label 两两不同（同一判据不许出现在两个维度）
 *   ③ 可证伪：存在能打出 0 分的输入 —— 由 criterion 里出现 `0=` 保证
 */
export function auditRubric(rubric = RUBRIC) {
	const fails = [];
	if (!Array.isArray(rubric) || !rubric.length) return { ok: false, fails: ["标准为空"] };

	const keys = new Set();
	for (const r of rubric) {
		if (!r || !r.key) { fails.push("存在无 key 的维度"); continue; }
		if (keys.has(r.key)) fails.push("key 重复：" + r.key);
		keys.add(r.key);
		if (!r.criterion || !String(r.criterion).trim()) fails.push(r.key + " 缺 criterion（不可达性）");
		if (!r.witness || !String(r.witness).trim()) fails.push(r.key + " 缺 witness（无证据来源）");
		if (!/0\s*=/.test(String(r.criterion || ""))) fails.push(r.key + " 未定义 0 分（不可证伪）");
		if (!(r.weight > 0)) fails.push(r.key + " 权重非正");
	}
	const labels = rubric.map((r) => r && r.label);
	if (new Set(labels).size !== labels.length) fails.push("label 重复（维度重叠）");
	return { ok: fails.length === 0, fails };
}

/**
 * 打分。`values` = { [key]: 0..5 }，缺项按 0 计并在 `missing` 里报出（不静默算满/算零）。
 * @returns {{total:number, max:number, ratio:number, passed:boolean, threshold:number,
 *            dims:Array<{key,label,score,weight,points,criterion}>, missing:string[],
 *            rubricOk:boolean, rubricFails:string[]}}
 */
export function score(valueObj = {}, opts = {}) {
	const threshold = typeof opts.threshold === "number" ? opts.threshold : 0.7;
	const rubric = opts.rubric || RUBRIC;
	const audit = auditRubric(rubric);
	const missing = [];
	let total = 0;
	const dims = rubric.map((r) => {
		const raw = valueObj[r.key];
		if (raw === undefined || raw === null) missing.push(r.key);
		const s = clampScore(raw);
		const points = s * r.weight;
		total += points;
		return { key: r.key, label: r.label, score: s, weight: r.weight, points, criterion: r.criterion };
	});
	const ratio = RUBRIC_MAX ? total / RUBRIC_MAX : 0;
	return {
		total, max: RUBRIC_MAX, ratio,
		threshold,
		/* 🔴 标准没通过自审时，**一律不判通过** —— 否则分数是"看起来能区分"的数字 */
		passed: audit.ok && missing.length === 0 && ratio >= threshold,
		dims, missing,
		rubricOk: audit.ok, rubricFails: audit.fails
	};
}

function clampScore(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(5, Math.round(n)));
}

/* ══════════════════════════════════════════════════════════════════
 * 三、三轮多方位评估（换证据源，不是重复跑）
 * ══════════════════════════════════════════════════════════════════ */

export const ROUNDS = Object.freeze([
	{
		n: 1, key: "spec", label: "规格符合性",
		method: "逐条对照需求文档（用户原话 → 可测判据）",
		evidence: "需求条目 ↔ 实现/断言对照表",
		failsIf: "存在没有任何实现或断言承接的需求条目"
	},
	{
		n: 2, key: "independent", label: "独立证据源",
		method: "**不引用第 1 轮的断言**，改用真机截图 + 计算样式回读 + 与实现不同源的探针",
		evidence: "截图（放大可读）/ DOM 属性回读 / 独立探针输出",
		failsIf: "第 2 轮只是把第 1 轮的断言又跑一遍（证据同源 ⇒ 同错同绿）"
	},
	{
		n: 3, key: "counter", label: "反证",
		method: "构造「应该失败」的输入，断言它**确实失败且原因正确**",
		evidence: "反证用例 + 实际返回的 reason",
		failsIf: "反证用例没有失败，或失败原因与预期不符"
	}
]);

/**
 * 三轮汇总。`results` = [{n, ok, note}]。
 * @returns {{rounds:Array, passed:boolean, failed:Array, distinctEvidence:boolean, note:string}}
 */
export function summarizeRounds(results = []) {
	const byN = new Map((results || []).map((r) => [Number(r && r.n), r]));
	const rounds = ROUNDS.map((d) => {
		const got = byN.get(d.n);
		return { ...d, ok: Boolean(got && got.ok), note: (got && got.note) || "" };
	});
	const failed = rounds.filter((r) => !r.ok).map((r) => r.n);
	/* 三轮必须**各跑过**且证据不同源。只跑了两轮却报"三轮通过"是本模块要防的假绿。 */
	const ran = rounds.filter((r) => byN.has(r.n)).length;
	const evSet = new Set(rounds.filter((r) => byN.has(r.n)).map((r) => (byN.get(r.n) || {}).evidence || ""));
	return {
		rounds,
		passed: failed.length === 0 && ran >= 3,
		failed,
		distinctEvidence: (byN.get(2) || {}).evidence !== (byN.get(1) || {}).evidence,
		/* 提示语优先报"轮数不够"——只跑两轮时的首要问题是**没跑满**，
		 * 而不是"第 3 轮没过"（那是看轮数的视角，会让人以为跑过了但失败）。 */
		note: ran < 3
			? ("只跑了 " + ran + " 轮（要求 ≥3）" + (failed.length ? "；未过：" + failed.join("、") : ""))
			: (failed.length ? ("未通过轮次：" + failed.join("、")) : "三轮通过")
	};
}

/** 安装全局契约 */
export function installOrchestrateApi() {
	if (typeof window === "undefined") return null;
	const api = {
		STAGE, STAGES, STAGE_ORDER, nextStage, canAdvance, planFor,
		RUBRIC, RUBRIC_MAX, auditRubric, score,
		ROUNDS, summarizeRounds
	};
	window.__dshOrchestrate = api;
	return api;
}
