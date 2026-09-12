/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：智能路由（要求 8）＋ 六维审核（要求 3）
 * 引用：要求 8 · 要求 3 · 17 号文 §1
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js
 * 下游：store/plugin-db.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 C（输入路由决策树）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/routing.js — 智能路由（要求 8）＋ 六维审核（要求 3）
 *
 * 需求来源（严格按文档，勿自行改动）：
 *   - 17 号文 §三 智能路由设计（5 步）：**意图理解 → 项目匹配 → 任务拆分 → 路由决策 → 执行落实**
 *     §6.3 扩展：V12 半自动（建议+用户确认）→ V13 全自动
 *   - 17 号文 §1A.9 六维度审核检查清单（**不得减项**）：
 *     ① 需求满足度 ② 方案符合度 ③ 质量达标度 ④ 风险控制 ⑤ 完整性 ⑥ 一致性
 *   - 17 号文 §1A.10 分支分派与汇总；§1A.2 协作流程（不通过则带审核意见打回）
 *
 * 硬约束（docs/10 要求 8）：
 *   ① 总监页面**只有一个**；② 用户输入 → 总监**整理 + 确认** → 判定归属对话；
 *   ③ 三条去向：**转给该对话的总监** / **直接调用对应对话** / **新建对话**；
 *   ④ 路由结果**必须可确认、可回看**（不得静默分发）。
 *
 * 设计取舍：本模块**全部为纯函数 + 规则打分**（不调模型）——
 *   目的是让"路由决策"这一关键路径**确定可复现**，离线可断言。
 *   需要模型增强时由上层注入（`opts.rank`），本模块不依赖网络。
 */

import { saveDecision, saveReview, listDecisions } from "../store/plugin-db.js";

/* ══════════════════════════════════════════════════════════════════
 * 一、STEP 1 意图理解
 * ══════════════════════════════════════════════════════════════════ */

/** 意图类型（17 号文 §三 STEP1 原列：需求 / 问题 / 指令 / 讨论 / 反馈） */
export const INTENT = Object.freeze({
	REQUIREMENT: "需求",
	QUESTION: "问题",
	COMMAND: "指令",
	DISCUSSION: "讨论",
	FEEDBACK: "反馈"
});

const INTENT_RULES = [
	{ kind: INTENT.QUESTION, re: /[?？]|怎么|如何|为什么|是什么|能不能|是否/, weight: 2 },
	{ kind: INTENT.FEEDBACK, re: /不对|有问题|错了|不好|差|不满意|应该是|其实要|并不是/, weight: 3 },
	{ kind: INTENT.COMMAND, re: /^(请|帮我|给我|把|执行|运行|跑|部署|提交|删除|改|修|加)/, weight: 3 },
	{ kind: INTENT.REQUIREMENT, re: /要|需要|必须|希望|要求|新增|实现|支持/, weight: 2 },
	{ kind: INTENT.DISCUSSION, re: /讨论|看看|评估|比较|方案|建议|想法/, weight: 2 }
];

/**
 * 中文分词（CJK / 拉丁边界插空格）+ 过滤停用词
 * 与 `logic/director-run.js#tokenize` 同源口径（CJK 单字 + bigram 兜底）。
 */
const STOP = new Set(["的", "了", "是", "在", "和", "与", "及", "把", "被", "给", "对", "为", "就", "都", "也", "很", "我", "你", "他", "它", "这", "那", "个", "们", "一下", "一个", "the", "a", "an", "to", "of", "and", "is", "in", "for", "on"]);

export function tokenize(text) {
	const s = String(text == null ? "" : text)
		.replace(/([\u4e00-\u9fa5])/g, " $1 ")
		.replace(/([A-Za-z0-9_@./-]+)/g, " $1 ")
		.toLowerCase();
	const raw = s.split(/\s+/).filter(Boolean);
	const out = [];
	for (const w of raw) {
		if (w.length === 1 && /[\u4e00-\u9fa5]/.test(w)) { if (!STOP.has(w)) out.push(w); continue; }
		if (STOP.has(w) || w.length < 2) continue;
		out.push(w);
	}
	// bigram 兜底：中文按字切后语义弱，补相邻二元组提升匹配率
	const cjkRun = [];
	for (const w of out) {
		if (w.length === 1 && /[\u4e00-\u9fa5]/.test(w)) { cjkRun.push(w); continue; }
		if (cjkRun.length) { pushBigrams(cjkRun, out); cjkRun.length = 0; }
	}
	if (cjkRun.length) pushBigrams(cjkRun, out);
	return Array.from(new Set(out));
}
function pushBigrams(run, out) {
	for (let i = 0; i + 1 < run.length; i++) out.push(run[i] + run[i + 1]);
}

/**
 * STEP 1：意图理解（规则打分，返回全部命中的类型及其权重）
 * @returns {{kind:string, confidence:number, signals:string[]}}
 */
export function classifyIntent(text) {
	const t = String(text || "");
	const hits = [];
	for (const r of INTENT_RULES) {
		if (r.re.test(t)) hits.push({ kind: r.kind, weight: r.weight });
	}
	if (!hits.length) return { kind: INTENT.REQUIREMENT, confidence: 0.35, signals: ["无显式特征词 → 默认按需求处理"] };
	hits.sort((a, b) => b.weight - a.weight);
	const top = hits[0];
	const total = hits.reduce((s, h) => s + h.weight, 0);
	return {
		kind: top.kind,
		confidence: Math.min(0.95, 0.4 + 0.2 * hits.length + (top.weight - 2) * 0.1),
		signals: hits.map((h) => h.kind + "(权重 " + h.weight + ")")
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 二、STEP 2 项目匹配
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 给候选节点打相关性分（关键词 + 名称命中 + 层级先验 + 近期活跃）
 * @param {string} text
 * @param {Array<{id:string,name:string,level:string,updatedAt?:number,conversations?:Array}>} nodes
 * @returns {Array<{nodeId:string,name:string,level:string,score:number,reason:string}>}
 */
export function scoreNodes(text, nodes) {
	const toks = tokenize(text);
	const now = Date.now();
	const out = [];
	for (const n of nodes || []) {
		if (!n || !n.id) continue;
		const name = String(n.name || "");
		const nameLower = name.toLowerCase();
		let score = 0;
		const reasons = [];
		// ① 名称命中（强信号）
		const nameHits = toks.filter((t) => t.length >= 2 && nameLower.indexOf(t) >= 0);
		if (nameHits.length) { score += 3 * nameHits.length; reasons.push("名称命中 " + nameHits.slice(0, 3).join("/")); }
		// ② 会话记录命中（中信号）
		const convs = Array.isArray(n.conversations) ? n.conversations : [];
		for (const c of convs) {
			const ct = String((c && (c.title || c.lastMessage)) || "").toLowerCase();
			const hits = toks.filter((t) => t.length >= 2 && ct.indexOf(t) >= 0);
			if (hits.length) { score += 1.2 * hits.length; reasons.push("会话命中 " + hits.slice(0, 2).join("/")); break; }
		}
		// ③ 近期活跃（弱信号）
		const ts = Number(n.updatedAt || (n.meta && n.meta.updatedAt) || 0);
		if (ts > 0 && now - ts < 86400000 * 3) { score += 0.8; reasons.push("近 3 日活跃"); }
		// ④ 层级先验：会话级优先被"直调"，项目级优先被"转派"
		if (n.level === "session") score += 0.3;
		if (n.level === "project") score += 0.2;
		if (score > 0) out.push({ nodeId: n.id, name: n.name, level: n.level, score: Math.round(score * 100) / 100, reason: reasons.join("；") || "弱相关" });
	}
	out.sort((a, b) => b.score - a.score);
	return out;
}

/* ══════════════════════════════════════════════════════════════════
 * 三、STEP 3 任务拆分
 * ══════════════════════════════════════════════════════════════════ */

/** 多意图检测：按连接词 / 分号 / 换行切分子任务 */
export function splitTasks(text) {
	const s = String(text || "").trim();
	if (!s) return [];
	const parts = s.split(/[；;\n]|(?:，?\s*(?:然后|接着|之后|另外|同时|再)\s*)/g)
		.map((x) => x.trim())
		.filter((x) => x.length >= 2);
	const list = parts.length ? parts : [s];
	return list.map((p, i) => ({
		index: i + 1,
		text: p,
		intent: classifyIntent(p).kind
	}));
}

/* ══════════════════════════════════════════════════════════════════
 * 四、STEP 4 路由决策（**待用户确认，不静默分发**）
 * ══════════════════════════════════════════════════════════════════ */

/** 去向（要求 8 三条） */
export const DESTINATION = Object.freeze({
	TRANSFER: "transfer",   // 转给该对话的总监
	DIRECT: "direct",       // 直接调用对应对话
	CREATE: "create"        // 新建对话
});
export const DESTINATION_LABEL = Object.freeze({
	transfer: "转给该对话的总监",
	direct: "直接调用对应对话",
	create: "新建对话"
});

/**
 * 由候选分决定"建议去向"
 * 规则（可解释，非黑箱）：
 *   - 有高分会话候选（≥3）→ 直调（产出型任务直接投给执行对话）
 *   - 有中分项目候选  → 转派（交给该层级总监继续治理）
 *   - 无候选          → 新建
 */
export function suggestDestination(candidates) {
	const top = (candidates || [])[0];
	if (!top) return { destination: DESTINATION.CREATE, confidence: 0.5, reason: "无匹配节点 → 由总监新建对话并初始化其总监" };
	if (top.level === "session" && top.score >= 3) return { destination: DESTINATION.DIRECT, confidence: Math.min(0.95, 0.5 + top.score / 20), reason: "命中会话「" + top.name + "」（" + top.reason + "）→ 直接调用该对话" };
	if (top.level === "project") return { destination: DESTINATION.TRANSFER, confidence: Math.min(0.9, 0.45 + top.score / 20), reason: "命中项目/文件夹「" + top.name + "」→ 转派给该层级总监" };
	return { destination: DESTINATION.DIRECT, confidence: 0.6, reason: "命中「" + top.name + "」→ 直接调用对应对话" };
}

/**
 * 完整路由（五步）
 * @param {string} text 用户输入
 * @param {object} ctx
 * @param {Array} ctx.nodes 候选节点（层级树拍平）
 * @param {string} [ctx.currentNodeId] 当前层级节点
 * @returns {{steps:Array, intent:object, candidates:Array, decision:object, subtasks:Array}}
 */
export function route(text, ctx = {}) {
	const nodes = (ctx.nodes || []).filter((n) => n && n.id);
	// STEP 1
	const intent = classifyIntent(text);
	// STEP 2（当前层级节点加权，体现"就近路由"）
	const candidates = scoreNodes(text, nodes).map((c) => ({
		...c,
		score: c.nodeId === ctx.currentNodeId ? Math.round((c.score + 1) * 100) / 100 : c.score,
		reason: c.nodeId === ctx.currentNodeId ? (c.reason + "；当前层级" ) : c.reason
	})).sort((a, b) => b.score - a.score);
	// STEP 3
	const subtasks = splitTasks(text);
	// STEP 4
	const decision = suggestDestination(candidates);
	// 步骤轨迹（供 UI 逐步展示）
	const steps = [
		{ n: 1, key: "intent", title: "意图理解", detail: intent.kind + "（置信 " + intent.confidence.toFixed(2) + "）", done: true },
		{ n: 2, key: "match", title: "项目匹配", detail: candidates.length ? candidates.length + " 个候选，最高 " + candidates[0].score : "无候选", done: true },
		{ n: 3, key: "split", title: "任务拆分", detail: subtasks.length + " 个子任务", done: true },
		{ n: 4, key: "decide", title: "路由决策", detail: DESTINATION_LABEL[decision.destination] + "（待确认）", done: false, pending: true },
		{ n: 5, key: "apply", title: "执行落实", detail: "确认后落库并转派/直调", done: false }
	];
	return { intent, candidates, subtasks, decision, steps };
}

/**
 * STEP 5：执行落实（**确认后才调用**）
 * 同时把决策**留痕**到 `directorDecisions`（要求 3 纠偏留痕 / 要求 8 可回看）。
 * @param {string} nodeId 所属层级节点
 * @param {object} routeResult route() 的返回值
 * @param {string} action 用户最终选定的去向（默认取建议值）
 */
export async function confirmRoute(nodeId, routeResult, action) {
	const dest = action || routeResult.decision.destination;
	const cand = (routeResult.candidates || [])[0] || null;
	const rec = await saveDecision({
		nodeId,
		kind: "route",
		text: "路由决策：" + DESTINATION_LABEL[dest] + (cand ? " → " + cand.name : ""),
		destination: dest,
		targetNodeId: cand ? cand.nodeId : null,
		intent: routeResult.intent.kind,
		subtasks: (routeResult.subtasks || []).map((s) => s.text),
		confidence: routeResult.decision.confidence,
		reason: routeResult.decision.reason,
		confirmed: true,
		at: Date.now()
	});
	return { ok: Boolean(rec), decision: rec };
}

/**
 * 回看历史路由决策（要求 8「可回看」，不得静默分发）
 *
 * 🔴 勿改回 `export { listDecisions as listRouteHistory } from "…"` 的**转发导出行**：
 *    自研 bundler（build/build.mjs）对 `export … from` 形态处理不完善（2026-09-12 实测
 *    会把该行连同后续代码并入一条注释 → 产物 `SyntaxError`）。此处用**显式本地包装**
 *    （import 原函数 + 本地具名导出），语义等价且对打包器透明。
 */
export function listRouteHistory(nodeId) {
	return listDecisions(nodeId);
}

/* ══════════════════════════════════════════════════════════════════
 * 五、六维审核（要求 3，17 号文 §1A.9 —— **不得减项**）
 * ══════════════════════════════════════════════════════════════════ */

/** 六维定义（单一真相源） */
export const REVIEW_DIMS = Object.freeze([
	{ key: "requirement", label: "需求满足度", hint: "核心需求 100% 覆盖 / 可选项标注 / 约束遵守" },
	{ key: "conformance", label: "方案符合度", hint: "约束遵守 / 范围一致 / 变更可追溯" },
	{ key: "quality", label: "质量达标度", hint: "符合智能体标准 / 功能可验证 / 性能可接受" },
	{ key: "risk", label: "风险控制", hint: "无新增 Bug / 无安全风险 / 遗留问题记录" },
	{ key: "completeness", label: "完整性", hint: "无遗漏 / 文档完整 / 边界覆盖" },
	{ key: "consistency", label: "一致性", hint: "方向一致 / 规范一致 / 决策一致" }
]);

/**
 * 六维审核（规则版，确定性输出）
 * @param {object} input
 * @param {string} input.goal 本次目标（用于"需求满足度"）
 * @param {string} input.output 产出描述 / 文本
 * @param {Array<string>} [input.evidence] 证据条目（文件路径、测试结果等）
 * @param {Array<string>} [input.risks] 已知风险
 * @returns {{dims:Array, pass:boolean, failed:Array, score:number}}
 */
export function review6(input = {}) {
	const goal = String(input.goal || "");
	const output = String(input.output || "");
	const evidence = Array.isArray(input.evidence) ? input.evidence : [];
	const risks = Array.isArray(input.risks) ? input.risks : [];
	const oLen = output.trim().length;

	/**
	 * 小工具：把"是否达标 + 说明"打包成一维
	 *
	 * 🔴 `status` 三态语义（17 号文 §1A.9 要求 ✅/⚠/❌ 可区分，不得退化为二元）：
	 *   - `ok === true`  → `"ok"`（✅）
	 *   - `ok === false` → `warnOnly ? "warn"`（⚠ 可后补 / 需人工确认）`: "bad"`（❌ 硬缺口，阻断通过）
	 *   2026-09-12 修正：原实现在未达标分支**恒定返回 `"bad"`** → 传入的 `"warn"` 失效，
	 *   六维退化为「全 ❌」（⚠ 仅在一致性一维出现，形同虚设）。修正后六维真正三态可辨。
	 */
	const dim = (key, ok, note, warnOnly) => {
		const d = REVIEW_DIMS.find((x) => x.key === key);
		return { key, label: d.label, hint: d.hint, status: ok ? "ok" : (warnOnly ? "warn" : "bad"), note };
	};

	const goalToks = tokenize(goal);
	const outLower = output.toLowerCase();
	const covered = goalToks.filter((t) => t.length >= 2 && outLower.indexOf(t) >= 0).length;
	const coverRate = goalToks.length ? covered / goalToks.length : (oLen > 0 ? 1 : 0);
	// 一致性证据（单次判定，供维度与说明共用，避免重复正则）
	const hasConsistency = evidence.some((e) => /一致|未变|冻结|三处|逐字节|cmp/.test(String(e)));

	const dims = [
		dim("requirement", oLen > 0 && coverRate >= 0.5,
			oLen === 0 ? "产出为空 → 无法满足任何需求" : "目标词覆盖 " + Math.round(coverRate * 100) + "%（" + covered + "/" + goalToks.length + "）",
			true),                                     // 覆盖不足 → ⚠（可后补）
		dim("conformance", evidence.length > 0,
			evidence.length ? "有 " + evidence.length + " 条可核验证据" : "无证据条目 → 变更不可追溯",
			false),                                    // 无证据 → ❌（硬缺口，阻断通过）
		dim("quality", oLen >= 20 && evidence.length > 0,
			"产出 " + oLen + " 字 / 证据 " + evidence.length + " 条",
			true),                                     // 产出过短 → ⚠
		dim("risk", risks.length === 0,
			risks.length ? "已记录 " + risks.length + " 条风险（需确认可控）" : "无遗留风险",
			true),                                     // 有风险 → ⚠（需确认可控）
		dim("completeness", oLen >= 20,
			oLen >= 20 ? "产出具备实质内容" : "产出过短，边界可能未覆盖",
			true),                                     // 过短 → ⚠
		dim("consistency", hasConsistency,
			hasConsistency ? "存在一致性证据" : "缺一致性证据（如『三处哈希一致』/『key 未改名』）",
			false)                                     // 缺一致性证据 → ❌（硬缺口）
	];
	const failed = dims.filter((d) => d.status === "bad");
	const warns = dims.filter((d) => d.status === "warn");
	const score = Math.round((dims.filter((d) => d.status === "ok").length / dims.length) * 100);
	return {
		dims, failed, warns,
		pass: failed.length === 0,
		score,
		summary: "六维：" + dims.map((d) => d.label + (d.status === "ok" ? "✅" : d.status === "warn" ? "⚠" : "❌")).join(" / ")
			+ " ⇒ " + (failed.length === 0 ? "通过" : "打回（" + failed.map((d) => d.label).join("、") + "）")
	};
}

/** 六维审核并留痕（要求 3：审核记录 + 纠偏可追溯） */
export async function reviewAndSave(nodeId, input) {
	const result = review6(input);
	const rec = await saveReview({
		nodeId,
		kind: "six-dim",
		dims: result.dims,
		pass: result.pass,
		score: result.score,
		summary: result.summary,
		target: input.target || null,
		at: Date.now()
	});
	return { ...result, saved: Boolean(rec), reviewId: rec ? rec.reviewId : null };
}

/** 安装全局契约（调试与验证脚本用） */
export function installRoutingApi() {
	if (typeof window === "undefined") return null;
	const api = {
		INTENT, DESTINATION, DESTINATION_LABEL, REVIEW_DIMS,
		tokenize, classifyIntent, scoreNodes, splitTasks, suggestDestination,
		route, confirmRoute, review6, reviewAndSave,
		listRouteHistory
	};
	window.__dshRouter = api;
	window.__dshReview6 = { REVIEW_DIMS, review6, reviewAndSave };
	return api;
}
