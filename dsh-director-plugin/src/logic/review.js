/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：D2 对话返回审核（**保留能力，当前无调用点**）
 * 引用：—
 * 上游：client-entry.js
 * 下游：config/model.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/review.js — D2 对话返回审核（**保留能力，当前无调用点**）
 *
 * 迁移来源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
 *   源区间：**6820 ~ 6855**（含区块头注释）
 *   迁移方式：**逐字保真**
 *
 * 🔴 状态判定：**死代码 —— 「保留不调用」（有意为之，非遗漏）**
 *   三重证据：
 *   ① `grep -rn "directorReviewReturn"` 全仓**唯一命中即定义行**（宿主 6821），**零调用点**；
 *   ② `docs/20-任务文档/10-总监对话模式问题修复开发文档-v2.md:213` —— 「移除 `directorReviewReturn` 函数（或保留但不调用）」；
 *   ③ 同上 `:219` —— 「**保留 `directorReviewReturn` 函数定义（供未来使用），但不调用**」；
 *      `docs/30-开发链路/V10-代码修改点映射文档.md:92` F30 行 —— `directorReviewReturn()` / 保留 / 已有 / 「返回审核（AI 化）」。
 *   → 故本模块**不接入 `client-entry.js` 的自动装配链**，仅在插件内提供实现 + 全局契约，
 *     待未来明确启用时再由接线层调用。**请勿因「未接线」而判定为迁移遗漏。**
 *
 * 依赖映射（宿主内联 → 插件模块）
 *   directorConfig   ← config/model.js（C2）
 *   callLocalModel   ← config/model.js（C2）
 *
 * ⚠️ 迁移保真要点（勿顺手优化）
 *   - 首行两个早退：`returnReview` 未启用 → 直接 return；内容 < 10 字 → 记一条 system 消息后 return。
 *   - 本地模型分支（AI 审核）与规则模板分支（启发式打分）**互斥**，由 `config.localModel.enabled` 决定。
 *   - 规则模板的 3 条启发式与基础分 `5 - issues.length`（下限 1）**原样保留**。
 *   - `sessionId` 与 `t` 在宿主原实现中**未被使用**，保留形参以维持 4 参签名兼容。
 */

import { directorConfig, callLocalModel } from "../config/model.js";

/**
 * 审核模型返回内容质量（AI 审核 / 规则模板审核二选一）。
 *
 * @param {string} sessionId 会话 ID（宿主原实现未使用，保留签名）
 * @param {string} returnText 待审核的模型返回文本
 * @param {object} store 总监 store（A9 `createDirectorStore` 产物）
 * @param {Function} t i18n 翻译函数（宿主原实现未使用，保留签名）
 * @returns {Promise<void>}
 */
export async function directorReviewReturn(sessionId, returnText, store, t) {
	const config = store.getState().config || directorConfig;
	if (!config.duties?.returnReview?.enabled) return;
	if (!returnText || returnText.length < 10) {
		store.addMessage({ role: "system", content: "【返回审核】返回内容过短（" + returnText.length + "字），跳过审核。" });
		return;
	}
	store.addMessage({ role: "system", content: "【返回审核】正在审核模型返回内容（" + returnText.length + "字）..." });
	// 如果本地模型启用，使用模型审核
	if (config.localModel?.enabled) {
		try {
			var reviewPrompt = "你是一位严格的内容审核专家。请审核以下AI模型返回的内容，从以下维度评估：\n1. 准确性：内容是否准确，有无事实错误\n2. 完整性：是否完整回答了问题，有无遗漏\n3. 相关性：是否与问题相关，有无跑题\n4. 格式规范：格式是否清晰，代码块/列表是否正确\n5. 安全性：有无不安全或不当内容\n\n返回内容：\n" + returnText.slice(0, 2000) + (returnText.length > 2000 ? "\n...（内容过长，仅审核前2000字）" : "") + "\n\n请输出审核结论（通过/需改进/不通过）+ 各维度评分（1-5分）+ 具体问题和改进建议。";
			var reviewResult = await callLocalModel(reviewPrompt, config);
			if (reviewResult) {
				store.addMessage({ role: "system", content: "【返回审核结果】\n" + reviewResult });
			} else {
				store.addMessage({ role: "system", content: "【返回审核】本地模型审核未返回结果，已记录内容长度 " + returnText.length + " 字。" });
			}
		} catch (err) {
			store.addMessage({ role: "system", content: "【返回审核】审核出错：" + err.message + "。已记录内容长度 " + returnText.length + " 字。" });
		}
	} else {
		// 本地模型未启用，使用规则模板审核
		var issues = [];
		if (returnText.length < 50) issues.push("内容过短，可能未完整回答");
		if (/TODO|FIXME|待补充|占位/.test(returnText)) issues.push("包含待补充/占位内容");
		if (/```[\s\S]*```/.test(returnText) && returnText.split("```").length % 2 === 0) issues.push("代码块可能未正确闭合");
		var score = 5 - issues.length;
		if (score < 1) score = 1;
		store.addMessage({
			role: "system",
			content: "【返回审核】规则模板审核结果：\n- 内容长度：" + returnText.length + "字\n- 综合评分：" + score + "/5\n" + (issues.length > 0 ? "- 发现问题：\n" + issues.map(function(i) { return "  • " + i; }).join("\n") : "- 未发现明显问题\n- 建议：启用本地模型可获得更深入的AI审核")
		});
	}
}
