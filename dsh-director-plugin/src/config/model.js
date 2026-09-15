/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：C2 配置与本地模型
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js, components/DirectorWorkbench.js, components/ModelSeat.js, logic/director-run.js, logic/process.js, logic/review.js, logic/summarize.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * config/model.js — C2 配置与本地模型
 *
 * 迁移源：client.js 6612 ~ 6702（91 行）
 *   区块标记：`// ========== 总监对话模式 - 配置与本地模型 ==========`
 *
 * 职责：
 *   1. 总监配置读写（localStorage `dsh.director.config`）
 *   2. Ollama 本地模型调用（`POST /api/generate`，60s 超时）
 *   3. Ollama 可用性探测（`GET /api/tags` + 目标模型匹配）
 *   4. 语言规范整理（纯函数）
 *   5. 任务分类（纯函数，5 类：code/design/research/writing/chat）
 *
 * ⚠️ 兼容约束（R5）：持久化 key `dsh.director.config` **必须原样保留**。
 * 全局契约：`window.__directorConfig` / `window.__dshCheckOllama` / `window.__dshOllamaStatus`
 */

export const DIRECTOR_CONFIG_KEY = "dsh.director.config";
/** Ollama 默认端点与模型（历史值，勿改） */
export const OLLAMA_DEFAULT_ENDPOINT = "http://localhost:11434";
export const OLLAMA_DEFAULT_MODEL = "qwen2:7b";
/** 本地模型调用超时（ms） — 原实现硬编码 60000 */
export const LOCAL_MODEL_TIMEOUT_MS = 60000;

export function loadDirectorConfig() {
	try {
		const raw = localStorage.getItem(DIRECTOR_CONFIG_KEY);
		if (raw) return JSON.parse(raw);
	} catch (e) {}
	return {
		autoForward: false,
		localModel: { enabled: true, endpoint: OLLAMA_DEFAULT_ENDPOINT, model: OLLAMA_DEFAULT_MODEL },
		duties: {
			languagePolish: { enabled: true, name: "语言规范整理" },
			contextMemory: { enabled: true, name: "上下文记忆" },
			executionLogic: { enabled: true, name: "执行逻辑分析" },
			modelRouting: { enabled: false, name: "模型路由" },
			returnReview: { enabled: true, name: "对话返回审核" }
		}
	};
}

export function saveDirectorConfig(config) {
	try { localStorage.setItem(DIRECTOR_CONFIG_KEY, JSON.stringify(config)); } catch (e) {}
}

export const directorConfig = loadDirectorConfig();
if (typeof window !== "undefined") window.__directorConfig = directorConfig;

/** 本地模型调用（Ollama 兼容）。失败/超时返回 null，不抛异常 */
export async function callLocalModel(prompt, config) {
	if (!config.localModel?.enabled) return null;
	const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
	const timeoutId = controller ? setTimeout(() => controller.abort(), LOCAL_MODEL_TIMEOUT_MS) : null;
	try {
		const endpoint = config.localModel.endpoint.replace(/\/$/, "");
		const resp = await fetch(`${endpoint}/api/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: config.localModel.model, prompt: prompt, stream: false }),
			signal: controller ? controller.signal : undefined
		});
		if (!resp.ok) {
			if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("localModel", "Ollama returned HTTP " + resp.status);
			return null;
		}
		const data = await resp.json();
		return data.response || null;
	} catch (e) {
		if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("localModel", "callLocalModel failed: " + e.message);
		return null;
	}
	finally { if (timeoutId !== null) clearTimeout(timeoutId); }
}

/** Ollama 状态检测：返回 {available, reason, models[, targetModel]} */
export async function checkOllamaStatus(config) {
	if (!config.localModel?.enabled) return { available: false, reason: "disabled", models: [] };
	try {
		const endpoint = config.localModel.endpoint.replace(/\/$/, "");
		const resp = await fetch(`${endpoint}/api/tags`, { method: "GET", signal: AbortController ? new AbortController().signal : undefined });
		if (!resp.ok) return { available: false, reason: "http_" + resp.status, models: [] };
		const data = await resp.json();
		const models = (data.models || []).map(m => m.name);
		const targetModel = config.localModel.model;
		const modelAvailable = models.some(m => m === targetModel || m.startsWith(targetModel.split(":")[0]));
		return { available: modelAvailable, reason: modelAvailable ? "ok" : "model_not_found", models: models, targetModel: targetModel };
	} catch (e) {
		return { available: false, reason: "connection_failed: " + e.message, models: [] };
	}
}

if (typeof window !== "undefined") {
	window.__dshCheckOllama = checkOllamaStatus;
	window.__dshOllamaStatus = { available: false, reason: "unchecked", models: [], lastCheck: 0 };
}

// ── 纯函数（无副作用，可直接单测）──

/** 语言规范整理：压缩空白、清理标点前后空格、补句末标点 */
export function polishLanguage(text) {
	let result = text.trim();
	result = result.replace(/\s+/g, " ");
	result = result.replace(/([，。！？；：])\s*/g, "$1");
	result = result.replace(/\s*([，。！？；：])/g, "$1");
	if (!/[。！？]$/.test(result) && result.length > 5) result += "。";
	return result;
}

/** 任务分类：code / design / research / writing / chat */
export function classifyTask(text) {
	const t = text.toLowerCase();
	if (/代码|bug|函数|变量|报错|错误|实现|开发|写一个|修复/.test(t)) return "code";
	if (/设计|架构|方案|系统|模块|流程|规范/.test(t)) return "design";
	if (/查|搜索|调研|资料|文档|信息|是什么/.test(t)) return "research";
	if (/翻译|整理|总结|摘要|润色/.test(t)) return "writing";
	return "chat";
}
