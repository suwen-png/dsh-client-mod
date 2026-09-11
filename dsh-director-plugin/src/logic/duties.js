/**
 * logic/duties.js — 总监职责配置定义（03号文 §3.1「执行逻辑项」）
 *
 * ⚠️ 本模块**严格按文档实现，不自行改动需求**。
 *
 * 依据：`docs/20-任务文档/03-总监对话模式开发文档.md` §3.1（:138-148）
 *   「本质：每个执行逻辑 = 一段 prompt 模板 + 启停开关，控制总监要做什么。」
 *
 * ┌──────────────┬────────┬───────────────────────────────────────────┐
 * │ 执行逻辑项    │ 默认   │ prompt 模板（文档原文，逐字采用）           │
 * ├──────────────┼────────┼───────────────────────────────────────────┤
 * │ 整理语言      │ ✅ 启用 │ 你是一个项目总监，请把用户的口语化需求整理为 │
 * │              │        │ 精确、无歧义的技术指令，保留核心意图，去除冗余表述。 │
 * │ 调整模型      │ ✅ 启用 │ 根据任务类型判断最优模型：代码任务→coder模型，│
 * │              │        │ 推理任务→reasoner模型，日常对话→chat模型。输出模型名称和理由。 │
 * │ 切换分支      │ ✅ 启用 │ 判断当前消息与已有对话上下文是否连续。连续→沿用当前分支；不连续→建议开新分支。 │
 * │ 上下文筛选    │ ⬜ 禁用 │ 当切换模型/分支时，筛选需要传递的上下文片段，去除无关历史，控制token量。 │
 * │ 自动审核产出  │ ⬜ 禁用 │ 大模型返回结果后，自动审核文档/代码是否符合原始需求，不符合则标注问题并建议修正。 │
 * └──────────────┴────────┴───────────────────────────────────────────┘
 *
 * ── 与宿主旧 duties 的关系（重要，勿混）─────────────────────────────
 * 宿主 `config/model.js#loadDirectorConfig()` 的 `duties` 是**另一套键名**
 * （languagePolish / contextMemory / executionLogic / modelRouting / returnReview），
 * 且默认值与文档**不一致**（文档要求「上下文筛选」默认禁用，宿主 `contextMemory` 默认启用）。
 *
 * 因 R5 兼容约束：`localStorage["dsh.director.config"]` 是**持久化契约**且宿主内联仍在读，
 * **禁止改写其默认结构**。故本模块在插件侧**独立**定义文档 5 项，
 * 存于层级节点 `duties` 字段（§3.2 三级继承），运行时与宿主 config 合并时**插件职责优先**。
 *
 * 映射关系（供 `director-run.js` 把宿主状态带过来，仅作参考、不改变文档 5 项语义）：
 *   languagePolish ↔ languagePolish（同义）
 *   modelRouting   ↔ modelRouting（同义）
 *   branchSwitch   ← 宿主无对应项
 *   contextFilter  ↔ contextMemory（近似）
 *   outputReview   ↔ returnReview（近似）
 */

/** 文档 §3.1 五项职责的固定顺序（UI 渲染顺序同此） */
export const DUTY_KEYS = [
	"languagePolish",
	"modelRouting",
	"branchSwitch",
	"contextFilter",
	"outputReview"
];

/** 文档 §3.1 默认职责表（prompt 逐字采用文档原文） */
export const DEFAULT_DUTIES = {
	languagePolish: {
		key: "languagePolish",
		name: "整理语言",
		enabled: true,
		prompt: "你是一个项目总监，请把用户的口语化需求整理为精确、无歧义的技术指令，保留核心意图，去除冗余表述。"
	},
	modelRouting: {
		key: "modelRouting",
		name: "调整模型",
		enabled: true,
		prompt: "根据任务类型判断最优模型：代码任务→coder模型，推理任务→reasoner模型，日常对话→chat模型。输出模型名称和理由。"
	},
	branchSwitch: {
		key: "branchSwitch",
		name: "切换分支",
		enabled: true,
		prompt: "判断当前消息与已有对话上下文是否连续。连续→沿用当前分支；不连续→建议开新分支。"
	},
	contextFilter: {
		key: "contextFilter",
		name: "上下文筛选",
		enabled: false,
		prompt: "当切换模型/分支时，筛选需要传递的上下文片段，去除无关历史，控制token量。"
	},
	outputReview: {
		key: "outputReview",
		name: "自动审核产出",
		enabled: false,
		prompt: "大模型返回结果后，自动审核文档/代码是否符合原始需求，不符合则标注问题并建议修正。"
	}
};

/** 深拷贝一份默认职责（避免多处共享同一对象引用被污染） */
export function cloneDefaultDuties() {
	return JSON.parse(JSON.stringify(DEFAULT_DUTIES));
}

/**
 * 归一化任意输入为合法职责表：缺项补默认，多余项丢弃。
 * 用于读回持久化数据（可能被手工改坏或跨版本残留）。
 * @param {any} input
 * @returns {typeof DEFAULT_DUTIES}
 */
export function normalizeDuties(input) {
	const base = cloneDefaultDuties();
	if (!input || typeof input !== "object") return base;
	for (const k of DUTY_KEYS) {
		const src = input[k];
		if (!src || typeof src !== "object") continue;
		base[k].enabled = src.enabled === undefined ? base[k].enabled : Boolean(src.enabled);
		if (typeof src.prompt === "string") base[k].prompt = src.prompt;
		if (typeof src.name === "string" && src.name.trim()) base[k].name = src.name;
	}
	return base;
}

/** 取某节点自身配置的职责（未配置返回 null = 完全继承上层） */
export function readOwnDuties(node) {
	const own = node && node.duties;
	if (!own || typeof own !== "object" || Object.keys(own).length === 0) return null;
	return normalizeDuties(own);
}
