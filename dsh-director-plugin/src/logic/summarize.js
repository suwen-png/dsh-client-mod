/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：分层总结 + 分梯度调用
 * 引用：03 号文 §4.3 · 17 号文 §1
 * 上游：client-entry.js, components/DirectorHierarchy.js
 * 下游：config/model.js, store/hierarchy.js, util/debug.js, util/bus.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/summarize.js — 分层总结 + 分梯度调用
 *
 * 需求来源（严格按文档，勿自行改动）：
 *   - 17-总监统治架构与项目驾驶舱方案-v9.md §1A.13 项目核心认知自动提取（:336-359）
 *       提取流程 1-6 步 →「**汇总为项目核心认知**，存储到记忆体系」
 *   - 同上 §2.1 `conversations[]`（该记忆层下所有对话）→ 分层总结的数据基础
 *   - 03-总监对话模式开发文档.md §4.3 降级策略（:236-242）
 *       Ollama 未启动 → 提示并跳过；超时 → 可重试/跳过；格式异常 → 原样展示
 *   - 03-总监对话模式开发文档.md §1.3 三层体系 → 总结须**逐层向上汇总**
 *
 * ── 分梯度调用（三个梯度，自上而下递进，失败自动回落）────────────
 *   G0 规则抽取 ：零模型。按 §1A.13「核心认知内容」7 项做结构化抽取
 *                 （定位/目标/当前阶段/核心需求/决策历史/风险偏差/约束条件）
 *   G1 本地模型 ：Ollama qwen2:7b（config/model.js callLocalModel），
 *                 把 G0 结构化文本 + 子级摘要 → 自然语言总结
 *   G2 上层汇总 ：父级对其下**所有子级 summary** 再汇总（递归向上），
 *                 实现 §1A.13「分层 → 汇总为上层核心认知」
 *   降级链：G2 →（Ollama 不可用/超时/格式异常）→ G0，并在结果中标注 `degraded`
 *
 * 全局契约：`window.__dshSummarize`
 */

import { callLocalModel, directorConfig } from "../config/model.js";
import { getNode, saveNode, LEVEL, LEVEL_LABEL } from "../store/hierarchy.js";
import { dshLog } from "../util/debug.js";
import { emitHierarchyChange } from "../util/bus.js";

/** 梯度定义 */
export const GRADE = { RULE: "G0", LOCAL: "G1", ROLLUP: "G2" };

/** 各梯度的模型超时（ms），03号文 §4.3 规定 >30s 需提示，此处与 callLocalModel 一致取 60s 上限 */
const GRADE_TIMEOUT_MS = 60000;

/**
 * G0 —— 规则抽取：不调用任何模型，产出结构化文本。
 * 字段对齐 17号文 §1A.13「核心认知内容」7 项。
 */
export function extractByRule(node, childSummaries = []) {
	const m = node?.meta || {};
	const conv = node?.conversations || [];
	const lines = [];

	lines.push("【层级】" + (LEVEL_LABEL[node?.level] || node?.level || "未知"));
	lines.push("【名称】" + (node?.name || "未命名"));
	if (m.positioning) lines.push("【定位】" + m.positioning);
	if (m.goal) lines.push("【目标】" + m.goal);
	if (m.currentPhase) lines.push("【当前阶段】" + m.currentPhase);

	if (node?.level === LEVEL.SESSION || conv.length) {
		const c = conv[0] || {};
		lines.push("【对话】" + (c.title || "-"));
		lines.push("【消息数】" + (c.messageCount ?? 0));
		if (c.lastMessage) lines.push("【最后消息】" + String(c.lastMessage).slice(0, 200));
	}

	lines.push("【决策】" + (node?.decisions || []).length + " 条");
	lines.push("【待办】" + (node?.todos || []).length + " 条");
	lines.push("【风险】" + (node?.risks || []).length + " 条");
	lines.push("【文档】" + (node?.docs || []).length + " 篇");

	// 结构化明细（截断，控 token）
	const fmt = (arr, key, n = 5) => (arr || []).slice(0, n)
		.map((x) => "  · " + String(x[key] || x.title || x.decisionId || x.todoId || x.riskId || "").slice(0, 120))
		.join("\n");
	if ((node?.decisions || []).length) lines.push("【决策明细】\n" + fmt(node.decisions, "title"));
	if ((node?.todos || []).length) lines.push("【待办明细】\n" + fmt(node.todos, "title"));
	if ((node?.risks || []).length) lines.push("【风险明细】\n" + fmt(node.risks, "title"));

	if (childSummaries.length) {
		lines.push("【子级摘要】共 " + childSummaries.length + " 项");
		lines.push(childSummaries.map((s, i) => "  " + (i + 1) + ". " + String(s.text || "").slice(0, 300)).join("\n"));
	}
	return lines.join("\n");
}

/** G1 —— 本地模型总结。失败返回 null（由调用方回落 G0） */
async function summarizeByModel(factsText, level) {
	const prompt = [
		"你是项目总监的总结助手。请基于以下结构化事实，生成一份简洁的核心认知摘要。",
		"要求：① 中文；② 不超过 300 字；③ 分「定位/进展/风险/下一步」四小段；④ 只依据事实，不臆造。",
		"",
		"层级：" + (LEVEL_LABEL[level] || level),
		"",
		factsText
	].join("\n");
	try {
		const out = await callLocalModel(prompt, directorConfig);
		if (typeof out === "string" && out.trim()) return out.trim();
		if (out && typeof out.text === "string" && out.text.trim()) return out.text.trim();
		return null;
	} catch (e) {
		dshLog("summarize", "G1 本地模型调用异常，回落 G0: " + (e && e.message));
		return null;
	}
}

/**
 * 对单个节点生成总结（自动选梯度 + 降级）
 *
 * @param {object} node 目标节点
 * @param {object[]} [childNodes] 其子级节点（用于 G2 汇总）；缺省则不汇总子级
 * @param {object} [opts] { forceGrade?: "G0"|"G1" }
 * @returns {Promise<{text:string, grade:string, degraded:boolean, reason?:string, at:number}>}
 */
export async function summarizeNode(node, childNodes = [], opts = {}) {
	if (!node) return { text: "", grade: GRADE.RULE, degraded: false, reason: "无节点", at: Date.now() };

	// 收集子级已有摘要（G2 的输入）
	const childSummaries = (childNodes || [])
		.filter((c) => c && c.summary)
		.map((c) => ({ id: c.id, name: c.name, text: c.summary }));

	const factsText = extractByRule(node, childSummaries);
	const isParent = childSummaries.length > 0;
	let grade = opts.forceGrade || (isParent ? GRADE.ROLLUP : GRADE.LOCAL);

	let text = null;
	let degraded = false;
	let reason;

	if (grade !== GRADE.RULE) {
		text = await summarizeByModel(factsText, node.level);
		if (!text) { degraded = true; reason = "本地模型不可用或输出异常（03号文 §4.3 降级）"; }
	}

	if (!text) {
		// 回落 G0：规则抽取结果直接作为总结（拼接子级摘要）
		grade = GRADE.RULE;
		const head = "（规则抽取 · 未调用模型）\n";
		text = head + factsText;
	}

	const result = { text, grade, degraded, at: Date.now() };
	if (reason) result.reason = reason;
	return result;
}

/**
 * 分层总结：自底向上汇总整棵树。
 * 先叶子（会话级）→ 再文件夹级（汇总其子级）→ 最后全局级。
 * 每一级把结果写回节点（summary / summaryGrade / summaryAt）并落盘。
 *
 * @param {object} root loadTree() 返回的根（含 childNodes）
 * @param {object} [opts] { forceGrade }
 * @returns {Promise<{count:number, grades:Record<string,number>, degraded:number}>}
 */
export async function summarizeTree(root, opts = {}) {
	const stats = { count: 0, grades: { G0: 0, G1: 0, G2: 0 }, degraded: 0 };
	if (!root) return stats;

	// 后序遍历：先子后父，保证父级能拿到子级最新 summary
	const walk = async (node) => {
		for (const c of node.childNodes || []) await walk(c);
		const res = await summarizeNode(node, node.childNodes || [], opts);
		node.summary = res.text;
		node.summaryGrade = res.grade;
		node.summaryAt = res.at;
		const { childNodes, ...flat } = node;
		await saveNode(flat);
		stats.count++;
		stats.grades[res.grade] = (stats.grades[res.grade] || 0) + 1;
		if (res.degraded) stats.degraded++;
	};
	await walk(root);
	emitHierarchyChange();
	return stats;
}

/**
 * 向上提交（03号文 §3.2「会话中修改可提交到项目/全局」）
 * 把某节点的当前总结向上冒泡：父级重新汇总一次。
 */
export async function propagateUp(nodeId, opts = {}) {
	const node = await getNode(nodeId);
	if (!node || !node.parentId) return null;
	const parent = await getNode(node.parentId);
	if (!parent) return null;
	// 拉齐父级所有子级的最新 summary
	const kids = [];
	for (const cid of parent.children || []) {
		const c = await getNode(cid);
		if (c) kids.push(c);
	}
	const res = await summarizeNode(parent, kids, opts);
	parent.summary = res.text;
	parent.summaryGrade = res.grade;
	parent.summaryAt = res.at;
	await saveNode(parent);
	emitHierarchyChange();
	return { node: parent, result: res };
}

/** 安装全局契约 */
export function installSummarizeApi() {
	if (typeof window === "undefined") return null;
	window.__dshSummarize = {
		GRADE, GRADE_TIMEOUT_MS,
		extractByRule, summarizeNode, summarizeTree, propagateUp
	};
	return window.__dshSummarize;
}
