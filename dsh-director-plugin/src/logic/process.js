/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：D1 总监对话核心处理函数
 * 引用：批次 6
 * 上游：client-entry.js
 * 下游：config/model.js, store/persist.js, store/memory.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/process.js — D1 总监对话核心处理函数
 *
 * 迁移来源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
 *   源区间：**6706 ~ 6818**（含区块头注释；函数体 6707~6818）
 *   迁移方式：**逐字保真**（逻辑与分支、消息文案、时序、锁语义均不改）
 *
 * 依赖映射（宿主内联 → 插件模块）
 *   directorConfig               ← config/model.js（C2）
 *   classifyTask                 ← config/model.js（C2）
 *   polishLanguage               ← config/model.js（C2）
 *   callLocalModel               ← config/model.js（C2）
 *   saveDirectorStore            ← store/persist.js（A8）
 *   idbGetMemoryCore             ← store/memory.js（A2）
 *   window.__dshDebug            ← util/debug.js（D3，全局契约）
 *   window.__dshDocsIndex        ← store/docs-index-inject.js（A13+A14，全局契约）
 *
 * 调用方（**本批次不改接线**）
 *   宿主 client.js:11763 `window.__directorSubmit` → `directorProcess(sessionId, draft, dStore, t, onForward)`
 *   宿主侧 F3 区属**批次 6**接线范围；本批次仅提供插件侧实现与全局契约。
 *
 * ⚠️ 迁移保真要点（勿顺手优化）
 *   - V9.4-P1 **并发锁**：`processing` / `calling-local-model` 期间拒绝重入，防止消息交错。
 *   - 步骤 1~5 的**执行顺序与条件**不得调整；`reasoning` 的三处赋值存在**互斥优先级**。
 *   - 步骤 5 转发使用 `setTimeout(..., 300)` —— 延迟是刻意的（等 UI 落定），勿改。
 *   - `t`（i18n 翻译函数）在宿主原实现中**未被使用**，此处保留形参以维持 5 参签名兼容。
 */

import { directorConfig, classifyTask, polishLanguage, callLocalModel } from "../config/model.js";
import { saveDirectorStore } from "../store/persist.js";
import { idbGetMemoryCore } from "../store/memory.js";

/**
 * 总监消息处理主链路：并发锁 → 语言整理 → 本地模型 → 上下文记忆 → 执行逻辑 → 落盘 → 自动转发。
 *
 * @param {string} sessionId 会话 ID
 * @param {string} userText 用户输入原文
 * @param {object} store 总监 store（A9 `createDirectorStore` 产物）
 * @param {Function} t i18n 翻译函数（宿主原实现未使用，保留签名）
 * @param {(instruction:string)=>void} [onForward] 自动转发回调
 * @returns {Promise<void>}
 */
export async function directorProcess(sessionId, userText, store, t, onForward) {
	const config = store.getState().config || directorConfig;
	if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "directorProcess called: userText=" + userText.slice(0, 50) + " msgsBefore=" + store.getState().messages.length);
	// V9.4-P1: 并发锁 —— 上一次处理未结束时拒绝重入，防止消息交错/状态卡死
	const currentStatus = store.getState().status;
	if (currentStatus === "processing" || currentStatus === "calling-local-model") {
		store.addMessage({ role: "system", content: "⏳ 总监正在处理上一条指令，请稍候再发送。" });
		return;
	}
	store.addMessage({ role: "user", content: userText });
	store.setStatus("processing");
	// V9.2: 用户消息立即落盘，确保不丢失
	await saveDirectorStore(sessionId, store.getState());

	try {
		const history = store.getState().messages.slice(-10).map(m => `${m.role}: ${m.content}`).join("\n");
		const taskType = classifyTask(userText);
		const taskNames = { code: "代码开发", design: "系统设计", research: "资料调研", writing: "文本整理", chat: "日常对话" };

		let polished = userText;
		let reasoning = "";
		let modelSuggestion = "deepseek-chat";
		let branchSuggestion = "沿用当前分支";

		// 步骤1：语言规范整理
		if (config.duties?.languagePolish?.enabled) {
			polished = polishLanguage(userText);
		}

		// 步骤2：调用本地模型（如果启用）
		if (config.localModel?.enabled) {
			store.setStatus("calling-local-model");
			// V11: 读取项目记忆注入上下文
			let projectMemory = "";
			try {
				// 注：宿主原式为 `typeof idbGetMemoryCore === "function"`；迁移后为静态 import，
				//     该守卫恒真。保留原形态以便与宿主逐行对照（行为等价）。
				if (typeof idbGetMemoryCore === "function") {
					var memCore = await idbGetMemoryCore("default");
					if (memCore) {
						var memParts = [];
						if (memCore.positioning) memParts.push("项目定位: " + memCore.positioning);
						if (memCore.goal) memParts.push("项目目标: " + memCore.goal);
						if (memCore.currentPhase) memParts.push("当前阶段: " + memCore.currentPhase);
						if (memCore.conversationHistory && memCore.conversationHistory.length > 0) memParts.push("历史决策数: " + memCore.conversationHistory.length);
						if (memParts.length > 0) projectMemory = memParts.join("\n");
					}
				}
			} catch (e) { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("memory", "load project memory failed: " + e.message); }
			// V11: 读取文档索引摘要
			let docsSummary = "";
			try {
				if (typeof window !== "undefined" && window.__dshDocsIndex && window.__dshDocsIndex.docs) {
					var docs = window.__dshDocsIndex.docs;
					docsSummary = "项目文档库: 共" + docs.length + "篇文档";
					// 简单关键词匹配，取最相关的3篇文档标题
					var keywords = userText.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 1; });
					var relevant = docs.filter(function(d) {
						return keywords.some(function(k) { return (d.title || "").toLowerCase().indexOf(k) !== -1 || (d.content || "").toLowerCase().indexOf(k) !== -1; });
					}).slice(0, 3);
					if (relevant.length > 0) {
						docsSummary += "\n相关文档:\n" + relevant.map(function(d) { return "- " + d.title + (d.docType ? " (" + d.docType + ")" : ""); }).join("\n");
					}
				}
			} catch (e) {}
			var memorySection = projectMemory ? "\n\n## 项目记忆\n" + projectMemory : "";
			var docsSection = docsSummary ? "\n\n## " + docsSummary : "";
			const localPrompt = `你是一个AI助手总监，负责管理和指导项目开发。请基于项目记忆和文档上下文，分析以下用户输入，整理语言并给出执行建议。${memorySection}${docsSection}\n\n## 历史对话\n${history}\n\n## 用户输入\n${userText}\n\n请输出：\n1. 整理后的指令（简洁明确）\n2. 任务类型判断（代码开发/系统设计/资料调研/文本整理/日常对话）\n3. 模型建议（deepseek-chat/deepseek-coder等）\n4. 简要推理过程（结合项目记忆和文档上下文）`;
			const localResult = await callLocalModel(localPrompt, config);
			if (localResult) {
				reasoning = localResult;
				const match = localResult.match(/整理后的指令[：:]\s*(.+?)(?:\n|$)/);
				if (match) polished = match[1].trim();
			}
		}

		// 步骤3：上下文记忆分析
		if (config.duties?.contextMemory?.enabled && !reasoning) {
			const recentTopics = store.getState().messages.filter(m => m.role === "user").slice(-3).map(m => m.content.slice(0, 30));
			reasoning = `任务类型：${taskNames[taskType]}\n上下文关联：${recentTopics.length > 0 ? "与最近" + recentTopics.length + "条对话相关" : "新话题"}\n语言整理：${polished !== userText ? "已整理" : "无需整理"}\n模型建议：${modelSuggestion}`;
		}
		if (!reasoning) reasoning = `任务类型：${taskNames[taskType]}，直接转发。`;

		// 步骤4：执行逻辑分析
		if (config.duties?.executionLogic?.enabled && taskType === "code") {
			reasoning += "\n执行建议：建议分步实现，先确认需求再编码。";
		}

		const parsed = {
			instruction: polished,
			model: modelSuggestion,
			branch: branchSuggestion,
			taskType: taskType,
			reasoning: reasoning
		};

		store.addMessage({
			role: "assistant",
			content: `【总监分析】\n${reasoning}`,
			parsed: parsed
		});
		store.setStatus("done");

		// 步骤5：自动转发
		if (config.autoForward && typeof onForward === "function") {
			setTimeout(() => onForward(parsed.instruction), 300);
		}
	} catch (err) {
		store.addMessage({ role: "system", content: `总监处理失败: ${err.message}` });
		store.setStatus("error");
	}
	// V9.2: 最终确保所有消息落盘
	await saveDirectorStore(sessionId, store.getState());
}
