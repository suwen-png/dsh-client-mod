/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：「标准设计图框架」的数据映射（设计图插件的原子层）
 * 引用：V16 诉求 6（标准设计图框架的映射）+ 2026-09-12 诉求 10（不同版本的选择） · T-PLUG-018
 * 上游：components/DesignStudio.js, store/design.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 D2 · D4（18 类元素 + 标准框架 20 元素）· E3（版本快照模型）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/design-schema.js — 「标准设计图框架」的数据映射（设计图插件的原子层）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 D】设计图工作室
 *   ├─ D1 全屏工作室布局      → components/DesignStudio.js
 *   ├─ D2 元素类型库（18 类）  → 本文件 ELEMENT_KINDS
 *   ├─ D3 元素交互逻辑面板     → 本文件 LOGIC_FIELDS + components/DesignStudio.js 左侧栏
 *   └─ D4 标准框架模板        → 本文件 STANDARD_FRAMES
 *  业务不变量  docs/10-总监与对话架构总纲.md §四
 *  总台账      docs/00-统筹入口/03-待完成任务清单.md  T-PLUG-018
 *
 *  需求原文（用户）：「做一个标准设计图框架的映射 也就是在总监页面单独加一个设计图的插件吧，
 *  按钮形式 点击铺满全屏，允许调整修改拖拽增加元素，最下面对话保留，这个对话处理设计图的修订
 *  属于新开的临时对话 只处理设计图，然后每一个元素可以点击 点击在左侧显示交互逻辑」
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么要有"标准框架模板"（而不是让用户从白纸开始拖）
 * ══════════════════════════════════════════════════════════════════
 *  这一版项目的痛点不是"能不能画"，而是**沟通**：每次改设计都要用文字描述"右区第三栏"，
 *  三版改下来各说各话（用户原话："三次改版，改出来三版本完全不一样的"）。
 *  ⇒ 标准框架把「三页签 + 两弹窗 + 导图态」这一套**布局约定**固化成可加载的模板：
 *     加载后每个元素**自带名字与交互逻辑**，后续所有讨论都能指着同一个 id 说话。
 *  ⇒ 这就是"映射"的含义：**设计图 → 具名元素 → 可寻址**。
 *
 *  🔴 与 R5 冻结项的关系：本文件纯数据，不碰任何持久化 key、不碰宿主库。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、元素类型库（标准设计图的 18 个原子）
 *     `w/h` 是默认尺寸（px，按 V16 的 1:1.22 折算视口 1180×644）；
 *     `logic` 是该类型**默认携带**的交互逻辑骨架（可被实例覆盖）。
 * ══════════════════════════════════════════════════════════════════ */

/** 元素类型（单一真相源；UI 工具栏顺序即此对象键序） */
export const ELEMENT_KINDS = Object.freeze({
	// ── 结构类（大块）──
	window: { label: "窗口", icon: "▣", group: "结构", w: 1180, h: 644, logic: {
		trigger: "应用启动（Electron 主窗口创建）",
		action: "装载宿主 React 根，承载全部页面",
		state: "未挂载 → 已挂载（根节点 #root）",
		data: "读 dsh.workspace.view.v5；写 dsh.sessions.current",
		fallback: "宿主版本差异致 slot 不可用时，插件降级为自挂 DOM 通道（浮动按钮组）仍可用",
		shortcut: "—",
		code: "src/mount.js mountHierarchy"
	} },
	sidebar: { label: "侧栏", icon: "▮", group: "结构", w: 230, h: 644, logic: {
		trigger: "点击会话行 / 文件夹行",
		action: "切换当前会话；点文件夹则进入该层级总监",
		state: "未选中 → 选中（高亮当前行）",
		data: "写 dsh.sessions.current；读 dsh.workspace.view.v5 展开态",
		fallback: "会话不存在 → 回落全局总管；侧栏收起时入口移入浮动按钮组，不留死路",
		shortcut: "Ctrl+K 搜索会话",
		code: "src/bridge/nav-hook.js（捕获阶段 pointerdown + 三级名称匹配）"
	} },
	tabring: { label: "页签环", icon: "▭▭", group: "结构", w: 420, h: 30, logic: {
		trigger: "点击页签 / Alt+1·2·3",
		action: "在 总监 / 对话 / 轨迹 之间切换视图",
		state: "active 从旧 id → 新 id；仅当 tab 数 > 1 时才渲染",
		data: "读 ctx.slots entries(\"conversation.view\")；写宿主 activeView",
		fallback: "slot 不可用时注册失败并返回 {registered:false,reason}，浮层通道保底，不静默消失",
		shortcut: "Alt+1 总监 / Alt+2 对话 / Alt+3 轨迹",
		code: "src/client-entry.js installDirectorView（order:-1 排最前）"
	} },
	region: { label: "分区", icon: "▤", group: "结构", w: 360, h: 120, logic: {
		trigger: "—（被动容器）",
		action: "R1–R8 分区容器，只负责布局与分区标题",
		state: "无独立状态，随上游数据重渲染",
		data: "只读上游 props（总监层级 / 统计值）",
		fallback: "数据为空时渲染占位文案而不是留白（如 R5「尚无总监消息」）",
		shortcut: "—",
		code: "src/components/DirectorPage.js sectionR1…sectionR8"
	} },
	panel: { label: "面板", icon: "▯", group: "结构", w: 200, h: 160, logic: {
		trigger: "拖中缝（分隔条）",
		action: "调整面板宽度",
		state: "width 变化，钳制 180–55%×视口；过窄自动吸附折叠",
		data: "写 dsh.director.layout（directorPanelWidth / chatPanelWidth）",
		fallback: "视口过小时吸附为折叠态并提供展开按钮，避免面板被压成 0 宽不可达",
		shortcut: "—",
		code: "src/store/layout.js clampPanelWidth"
	} },
	canvas: { label: "画布", icon: "▦", group: "结构", w: 480, h: 280, logic: {
		trigger: "滚轮缩放 / 拖拽空白平移 / 点空白",
		action: "缩放与平移画布；点空白取消选中",
		state: "zoom 10%–400%；selected 置空",
		data: "只读设计图 doc.elements",
		fallback: "无图时显示引导文案并自动铺一张标准框架，不留空白画布",
		shortcut: "Ctrl+0 适应 100%",
		code: "src/components/DesignStudio.js（canvasWrap / grid）"
	} },

	// ── 控件类 ──
	button: { label: "按钮", icon: "⬜", group: "控件", w: 84, h: 28, logic: {
		trigger: "点击 / Enter / Space",
		action: "执行绑定的 onClick",
		state: "hover / active / focus-visible / disabled 四态",
		data: "由 onClick 决定；不直接读写 store",
		fallback: "disabled 时保留 title 说明原因，不静默变灰无解释",
		shortcut: "Enter / Space（聚焦态）",
		code: "src/components/DesignStudio.js 各 S.btn"
	} },
	input: { label: "输入框", icon: "▬", group: "控件", w: 240, h: 28, logic: {
		trigger: "Enter 提交 / 点击发送",
		action: "按**目标徽章**决定提交去向（总监 or 对话 / 或设计图修订）",
		state: "draft 有值 → 提交后清空；无图或无目标时 disabled",
		data: "总监消息走 plugin-db/directorConversations；设计图修订走 dsh.director.design（三向隔离）",
		fallback: "解析不出目标时进「待确认 / 未识别」区并回显，绝不静默丢弃用户输入",
		shortcut: "Enter 提交 / Shift+Enter 换行",
		code: "src/components/DirectorPage.js R8 + src/components/DesignStudio.js ds-input"
	} },
	select: { label: "下拉", icon: "▾", group: "控件", w: 140, h: 24, logic: {
		trigger: "选择选项",
		action: "切换层级 / 模型 / 设计图文档",
		state: "value 变化触发上层重渲染",
		data: "写 dsh.director.config（模型）/ layout（层级）/ 设计图 activeDocId",
		fallback: "选项为空时保留占位项而不是抛错；自动化赋值必须走 HTMLSelectElement.prototype，否则 Illegal invocation",
		shortcut: "↑↓ 切换选项",
		code: "src/components/DirectorPage.js R3 + src/components/DesignStudio.js ds-doclist"
	} },
	badge: { label: "徽章", icon: "◉", group: "控件", w: 56, h: 20, logic: {
		trigger: "—（随状态被动更新）",
		action: "标示当前提交目标（总监 / 对话）",
		state: "目标切换时文案与配色同步",
		data: "读 layout.focusTarget",
		fallback: "目标未定时显示「未指定」并要求先选，不默认投递给任何一方",
		shortcut: "—",
		code: "src/components/DirectorPage.js dp-focus"
	} },
	text: { label: "文本", icon: "T", group: "控件", w: 140, h: 18, logic: {
		trigger: "—",
		action: "静态说明文字",
		state: "无独立状态",
		data: "只读常量或上游 props",
		fallback: "文案缺失时回落为「—」，不留空白",
		shortcut: "—",
		code: "各组件 S.muted"
	} },
	icon: { label: "图标按钮", icon: "✕", group: "控件", w: 24, h: 22, logic: {
		trigger: "点击",
		action: "折叠 / 最小化 / 关闭",
		state: "展开 ↔ 折叠（↔ 关闭）",
		data: "写 dsh.director.layout（collapsed / open 标志）",
		fallback: "折叠态下必须有可达替代入口（曾整块消失，真机暴露）；Esc 可关闭最上层",
		shortcut: "Esc",
		code: "src/components/DirectorDialog.js rail 控制簇"
	} },
	list: { label: "列表", icon: "☰", group: "控件", w: 180, h: 140, logic: {
		trigger: "点击行",
		action: "选中该项并联动左右面板内容",
		state: "选中行高亮",
		data: "读上游数据，写选中 id",
		fallback: "列表为空时渲染空态说明，不显示空白框",
		shortcut: "↑↓ 移动选中",
		code: "src/components/DirectorHierarchy.js"
	} },
	card: { label: "卡片", icon: "▢", group: "控件", w: 200, h: 96, logic: {
		trigger: "点击卡片体",
		action: "展开详情 / 切换层级",
		state: "收起 ↔ 展开",
		data: "读汇总指标；写选中的层级 id",
		fallback: "指标缺失显示「—」而不是 NaN / undefined",
		shortcut: "—",
		code: "src/components/DirectorPage.js S.blk"
	} },
	progress: { label: "进度条", icon: "▬▬", group: "控件", w: 160, h: 8, logic: {
		trigger: "—（随数据被动更新）",
		action: "展示完成率（待办 / 覆盖度）",
		state: "宽度随百分比变化",
		data: "读 todos / auditCoverage 汇总",
		fallback: "分母为 0 时显示 0% 而不是 NaN%",
		shortcut: "—",
		code: "src/components/DirectorPage.js"
	} },

	// ── 语义类（总监专有）──
	node: { label: "导图节点", icon: "●", group: "语义", w: 130, h: 44, logic: {
		trigger: "左键点选 / 拖拽 / 方向键微移",
		action: "选中 → 左侧逻辑面板显示该分支的交互逻辑",
		state: "常态 / hover / 选中 / 执行中 四态",
		data: "血缘来自 sessions.fork 写入的 meta.parentSession（只消费，不新建模型）",
		fallback: "摘要无血缘字段时退化为分组树并**显式标注「无血缘」**，不假装是分支树",
		shortcut: "方向键微移 / Shift+方向键 1px",
		code: "src/logic/branch-tree.js"
	} },
	edge: { label: "连线", icon: "—", group: "语义", w: 80, h: 2, logic: {
		trigger: "—（随节点位置实时重算）",
		action: "绘制父子血缘连线",
		state: "随节点移动 / 折叠实时重算",
		data: "读 flattenLineage() 已有的 children 映射 + depth 缩进",
		fallback: "检测到环时**断边并标记 cycles**，不无限递归",
		shortcut: "—",
		code: "src/logic/branch-tree.js"
	} },
	overline: { label: "浮动按钮组", icon: "◍", group: "语义", w: 150, h: 34, logic: {
		trigger: "点击",
		action: "打开对应全屏能力（设计图 / 思维导图 / 总监）",
		state: "目标层 open 标志翻转（designStudioOpen / mindmapOpen / dialogOpen）",
		data: "写 dsh.director.layout",
		fallback: "某层渲染异常被 SafeLayer 隔离，只损失该层并显示可重试角标；顺序「🧠导图」在「◆总监」之前（用户明确要求）",
		shortcut: "Esc 关闭最上层",
		code: "src/components/FloatDock.js"
	} }
});

/** 全部类型 key（校验 / 遍历用） */
export const ELEMENT_KIND_KEYS = Object.freeze(Object.keys(ELEMENT_KINDS));

/** 按 group 分组（工具栏渲染用） */
export function kindsByGroup() {
	const out = {};
	for (const k of ELEMENT_KIND_KEYS) {
		const g = ELEMENT_KINDS[k].group;
		(out[g] = out[g] || []).push(k);
	}
	return out;
}

/* ══════════════════════════════════════════════════════════════════
 * 二、交互逻辑字段（点击元素 → 左侧面板显示的就是这 7 个）
 *     字段是**固定七元组**：不设自由文本，否则又退化成"各写各的"。
 * ══════════════════════════════════════════════════════════════════ */

export const LOGIC_FIELDS = Object.freeze([
	{ key: "trigger", label: "触发方式", hint: "鼠标 / 键盘 / 事件，写清具体按键或事件名" },
	{ key: "action", label: "行为", hint: "点下去发生什么（一句话，可核验）" },
	{ key: "state", label: "状态变化", hint: "前后状态，如「展开 → 缩起」" },
	{ key: "data", label: "数据流向", hint: "读哪个 store，写哪个 store" },
	{ key: "fallback", label: "退化路径", hint: "失败 / 空数据 / 无权时怎么办（**不许留空**）" },
	{ key: "shortcut", label: "快捷键", hint: "与该动作等价的键盘路径" },
	{ key: "code", label: "对应代码", hint: "实现该逻辑的文件 —— 这条是给改代码的人看的" }
]);

/** 逻辑七元组的空骨架 */
export function emptyLogic() {
	const o = {};
	for (const f of LOGIC_FIELDS) o[f.key] = "";
	return o;
}

/* ══════════════════════════════════════════════════════════════════
 * 三、元素实例：创建 / 归一化 / 校验
 * ══════════════════════════════════════════════════════════════════ */

/** 画布坐标与尺寸的下限（防负数与零面积元素） */
export const MIN_SIZE = 8;
/** 画布逻辑尺寸（V16 折算视口；设计图与真机 1:1.22） */
export const CANVAS_W = 1180;
export const CANVAS_H = 644;

let seq = 0;
/** 稳定可读 id（便于在对话里指称："把 el-3 的按钮右移 20"） */
export function nextElementId(kind) {
	seq += 1;
	return "el-" + seq + "-" + String(kind || "x").slice(0, 3);
}
/** 重置序号（加载模板后调用，避免 id 与已有元素撞车） */
export function syncSeqFrom(elements) {
	let max = 0;
	for (const e of elements || []) {
		const m = /^el-(\d+)-/.exec(String(e && e.id));
		if (m) max = Math.max(max, Number(m[1]));
	}
	seq = Math.max(seq, max);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * 创建一个元素实例。
 * @param {string} kind ELEMENT_KINDS 的 key
 * @param {object} [patch] 覆盖字段（x/y/w/h/label/logic/props）
 * @returns {object|null} 未知 kind 返回 null（调用方须判空）
 */
export function createElement(kind, patch = {}) {
	const spec = ELEMENT_KINDS[kind];
	if (!spec) return null;
	const p = patch || {};
	const el = {
		id: p.id || nextElementId(kind),
		kind,
		x: Math.round(clamp(num(p.x, 0), 0, CANVAS_W)),
		y: Math.round(clamp(num(p.y, 0), 0, CANVAS_H)),
		w: Math.round(clamp(num(p.w, spec.w), MIN_SIZE, CANVAS_W)),
		h: Math.round(clamp(num(p.h, spec.h), MIN_SIZE, CANVAS_H)),
		z: Math.round(num(p.z, 1)),
		label: String(p.label == null ? spec.label : p.label),
		props: { ...(p.props || {}) },
		// 逻辑骨架来自类型默认值，再用实例覆盖 —— 保证「每个元素都有逻辑可显示」
		logic: { ...emptyLogic(), ...(spec.logic || {}), ...(p.logic || {}) }
	};
	return el;
}

/** 归一化（加载模板 / 从库读回时用；保证字段齐全，缺的补默认） */
export function normalizeElement(raw) {
	if (!raw || !raw.kind || !ELEMENT_KINDS[raw.kind]) return null;
	return createElement(raw.kind, raw);
}

/** 元素是否可渲染（只校验会影响绘制的字段） */
export function isRenderable(el) {
	return Boolean(el && el.id && ELEMENT_KINDS[el.kind]
		&& Number.isFinite(el.x) && Number.isFinite(el.y)
		&& el.w >= MIN_SIZE && el.h >= MIN_SIZE);
}

/** 命中测试：坐标 → 最上层元素（z 大者优先） */
export function hitTest(elements, x, y) {
	const list = (elements || []).filter(isRenderable);
	let best = null;
	for (const el of list) {
		if (x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h) {
			if (!best || el.z >= best.z) best = el;
		}
	}
	return best;
}

/* ══════════════════════════════════════════════════════════════════
 * 四、标准框架模板 —— 「三页签 + 两弹窗 + 导图态」
 *     一键铺设：所有元素自带 label 与逻辑，后续讨论可指着 id 说话。
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 模板定义：`seed` 是 createElement 的 patch 列表。
 * 🔴 坐标与 V16 板块 A 的高保真画面**逐块对应**，改画面时同步改这里。
 */
const FRAME_SEEDS = [
	// 窗口 + 侧栏
	{ kind: "window", label: "Harness 主窗口", x: 0, y: 0, w: 1180, h: 644, z: 0 },
	{ kind: "sidebar", label: "侧栏 · 会话树", x: 0, y: 0, w: 230, h: 644, z: 1 },
	// 页签环
	{ kind: "tabring", label: "页签环 · 总监/对话/轨迹", x: 240, y: 6, w: 440, h: 28, z: 3 },
	// R1 顶栏
	{ kind: "region", label: "R1 顶部栏", x: 240, y: 40, w: 930, h: 34, z: 2 },
	// R2 总览四卡
	{ kind: "card", label: "R2 项目总览 · 四指标", x: 240, y: 80, w: 930, h: 76, z: 2 },
	// R2.5 控制台
	{ kind: "region", label: "R2.5 总监控制台", x: 240, y: 162, w: 930, h: 56, z: 2 },
	// R3 资源行
	{ kind: "region", label: "R3 智能体 / 技能 / 资源", x: 240, y: 224, w: 930, h: 34, z: 2 },
	// 三栏 R4 / R5 / R7
	{ kind: "panel", label: "R4 项目导航（三 Tab）", x: 240, y: 264, w: 200, h: 240, z: 2 },
	{ kind: "panel", label: "R5 总监对话区", x: 447, y: 264, w: 520, h: 240, z: 2 },
	{ kind: "panel", label: "R7 详情 / 产出物", x: 974, y: 264, w: 196, h: 240, z: 2 },
	// R6 记忆 + R8 输入
	{ kind: "region", label: "R6 记忆面板", x: 240, y: 510, w: 930, h: 62, z: 2 },
	{ kind: "input", label: "R8 全局输入条", x: 240, y: 578, w: 850, h: 30, z: 3 },
	{ kind: "badge", label: "目标徽章 · 总监/对话", x: 240, y: 612, w: 96, h: 20, z: 3 },
	// 右侧对话弹窗（浮层三态）
	{ kind: "panel", label: "右侧「对话」弹窗", x: 858, y: 40, w: 312, h: 604, z: 6 },
	// 浮动按钮组（导图在总监之前）
	{ kind: "overline", label: "浮动组 · 🧠思维导图 / ◆总监", x: 900, y: 590, w: 170, h: 34, z: 8 },
	// 导图态（覆盖层）
	{ kind: "canvas", label: "导图态 · 分支血缘画布", x: 60, y: 80, w: 1060, h: 440, z: 10 },
	{ kind: "node", label: "分支节点 · 根", x: 180, y: 180, w: 130, h: 44, z: 11 },
	{ kind: "node", label: "分支节点 · 子 A", x: 400, y: 140, w: 130, h: 44, z: 11 },
	{ kind: "node", label: "分支节点 · 子 B", x: 400, y: 240, w: 130, h: 44, z: 11 },
	{ kind: "edge", label: "血缘连线", x: 310, y: 200, w: 90, h: 2, z: 10 }
];

/** 预置的标准框架（key → {label, desc, seed}） */
export const STANDARD_FRAMES = Object.freeze({
	threeTab: {
		label: "三页签标准框架",
		desc: "总监 / 对话 / 轨迹 三页签 + 右侧弹窗 + 导图态 —— 对齐 V16 板块 A",
		seed: FRAME_SEEDS
	}
});

/**
 * 生成标准框架的元素数组。
 * @param {string} [key] 模板 key，默认 threeTab
 * @returns {Array<object>} 元素数组（已归一化、id 已重编，可直接落库）
 */
export function buildStandardFrame(key = "threeTab") {
	const frame = STANDARD_FRAMES[key] || STANDARD_FRAMES.threeTab;
	return (frame.seed || []).map((s) => {
		const el = createElement(s.kind, s);
		// 模板里的 id 必须重编：同一模板可加载多次（多份设计图），id 不能撞
		if (el) el.id = nextElementId(s.kind);
		return el;
	}).filter(Boolean);
}

/* ══════════════════════════════════════════════════════════════════
 * 五、设计图文档（一整份可编辑稿）
 * ══════════════════════════════════════════════════════════════════ */

/** 文档 schema 版本（结构变更时 +1，读取端据此迁移） */
export const DESIGN_DOC_SCHEMA = 1;

/** 文档序号（**确定性**：不用 Math.random —— 随机 id 会让测试无法断言） */
let docSeq = 0;
export function nextDocId() {
	docSeq += 1;
	return "dd_" + Date.now().toString(36) + "_" + docSeq;
}

/* ══════════════════════════════════════════════════════════════════
 * 六、版本快照（2026-09-12 新增 · 用户需求「也没有保存 和不同版本的选择」）
 *
 * 🔴 为什么 `revision` 不够 —— 这是本模块存在的唯一理由：
 *   `revision` 是**每次落盘就 +1** 的自动代数（拖一下 +1、按一次方向键 +1），
 *   真机上看到的数字是 **605**。它能证明"存过 605 次"，却**回答不了用户真正会问的那句话**：
 *   「回到我刚才那个布局」—— 因为 605 次里**没有任何一次被标记为"这一版要留着"**。
 *   屏幕上是 605 个点，没有一个是"版本"。所以另立一套语义：`versions[]`。
 *
 * 三条设计取舍（均记录理由，便于日后推翻时知道推翻的是什么）：
 *   ① **内嵌在 doc 里**，不另开 localStorage 键 / 不另开 IDB store。
 *      版本必须与图**同生共死**：删除图时版本一起走。独立存储极易留孤儿版本，且回滚要多一次异步等待。
 *   ② **只快照 elements，不含 title**。标题是"图的身份"，内容是"图的样子"。
 *      回滚语义定为「**内容**回到那一刻」；若连标题一起回滚，用户重命名后再回滚会觉得图被换掉了。
 *   ③ **限流 VERSION_LIMIT**。每版是一份完整 elements 深拷贝（20 元素 ≈ 4KB），
 *      无上限会吃满 localStorage 5MB 配额 —— 而配额满的失败是**静默**的（persist 的 catch 吞掉）。
 *
 * ⚠️ 与 R5 冻结契约的关系：`dsh.director.design` 是**本插件自有键**（不在 R5 冻结清单内），
 *    故可自由增字段；但 `docId/title/elements/thread/revision` 五个既有字段**一律不动名、不动义**，
 *    保证「已落死基线」读得懂本版本写的数据，反之亦然。
 * ══════════════════════════════════════════════════════════════════ */

/** 每个设计图最多保留的版本数（超出淘汰最旧的；不做"归档"，理由：归档=隐藏的孤儿数据） */
export const VERSION_LIMIT = 30;

/**
 * 深拷贝元素。
 * 🔴 **必须真深拷贝**：版本与工作副本一旦共享引用，之后拖拽工作副本的元素
 *    （`moveElement` 返回新 doc 但内部元素对象可能被复用）就会**穿透改掉历史版本**，
 *    表现是"回滚到 v3 却是最新的样子" —— 这类共享引用 bug 不报错、只出错。
 */
export function cloneElements(els) {
	return JSON.parse(JSON.stringify(els || []));
}

/** 版本序号（确定性策略同 docSeq） */
let verSeq = 0;
export function nextVersionId() {
	verSeq += 1;
	return "dv_" + Date.now().toString(36) + "_" + verSeq;
}

/**
 * 生成一份版本快照。
 * @param {object} doc 源文档（工作副本）
 * @param {{note?:string,label?:string,vid?:string}} [patch]
 *   `note` 建议写"这一版改了什么" —— 它决定日后能不能指着版本说话（"回到'底栏加高'那版"）。
 */
export function createVersion(doc, patch = {}) {
	const p = patch || {};
	const n = ((doc && doc.versions) || []).length + 1;
	const els = cloneElements((doc && doc.elements) || []);
	return {
		vid: p.vid || nextVersionId(),
		label: String(p.label || ("v" + n)),
		note: String(p.note || "").slice(0, 200),
		savedAt: Date.now(),
		revision: Number((doc && doc.revision) || 0),
		count: els.length,
		elements: els
	};
}

/**
 * 归一化读回的版本（坏版本剔除）。
 * 注意：`normalizeElement` 会**保留传入的 id**（`createElement` 里 `p.id || nextElementId()`），
 * 故版本内元素 id 与工作副本一致 ⇒ 回滚后选中态、对话里的 id 指称仍然对得上。
 */
export function normalizeVersion(raw, i) {
	if (!raw || !raw.vid) return null;
	const els = (raw.elements || []).map(normalizeElement).filter(Boolean);
	return {
		vid: raw.vid,
		label: String(raw.label || ("v" + ((i || 0) + 1))),
		note: String(raw.note || ""),
		savedAt: raw.savedAt || Date.now(),
		revision: Number(raw.revision || 0),
		count: els.length,
		elements: els
	};
}

/** 版本摘要（不含 elements —— UI 列表与"选择版本"用，避免大对象外泄） */
export function versionSummary(v) {
	if (!v) return null;
	return { vid: v.vid, label: v.label, note: v.note, savedAt: v.savedAt, count: v.count, revision: v.revision };
}

/**
 * 新建一份设计图文档。
 * @param {object} [patch] { title, frameKey, elements, thread, versions }
 */
export function createDesignDoc(patch = {}) {
	const p = patch || {};
	const elements = p.elements ? p.elements.map(normalizeElement).filter(Boolean) : buildStandardFrame(p.frameKey);
	syncSeqFrom(elements);
	const now = Date.now();
	return {
		docId: p.docId || nextDocId(),
		schema: DESIGN_DOC_SCHEMA,
		title: String(p.title || "未命名设计图"),
		frameKey: p.frameKey || "threeTab",
		elements,
		// 设计图专用临时对话（只处理设计图修订）—— 与总监对话、宿主会话**三向隔离**
		thread: Array.isArray(p.thread) ? p.thread : [],
		/* 版本快照：新建图**无版本**（= 还没保存过）⇒ 顶栏显示"未保存"而不是"v0" */
		versions: Array.isArray(p.versions) ? p.versions.map(normalizeVersion).filter(Boolean) : [],
		createdAt: p.createdAt || now,
		updatedAt: now,
		revision: Number(p.revision || 0) + 1
	};
}

/** 归一化读回的文档（缺字段补默认，坏元素剔除） */
export function normalizeDoc(raw) {
	if (!raw || !raw.docId) return null;
	const elements = (raw.elements || []).map(normalizeElement).filter(Boolean);
	syncSeqFrom(elements);
	return {
		docId: raw.docId,
		schema: DESIGN_DOC_SCHEMA,
		title: String(raw.title || "未命名设计图"),
		frameKey: raw.frameKey || "threeTab",
		elements,
		thread: Array.isArray(raw.thread) ? raw.thread : [],
		/* 🔴 旧数据兼容（必须有）：基线冻结前落库的 doc 没有 versions 字段，
		 *    此处补空数组而不是补一个"自动版本" —— 补出来的版本会让用户以为曾经保存过。
		 *    代价是首次升级时所有图显示"未保存"，属**正确**的诚实显示。 */
		versions: (raw.versions || []).map(normalizeVersion).filter(Boolean),
		createdAt: raw.createdAt || Date.now(),
		updatedAt: raw.updatedAt || Date.now(),
		revision: Number(raw.revision || 0)
	};
}

/** 文档统计（左侧面板与状态栏显示用） */
export function docStats(doc) {
	const els = (doc && doc.elements) || [];
	const byKind = {};
	for (const e of els) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
	const missingLogic = els.filter((e) => !e.logic || !e.logic.action).length;
	return { total: els.length, byKind, missingLogic, thread: ((doc && doc.thread) || []).length };
}
