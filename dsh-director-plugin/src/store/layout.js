/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：A11 布局 store（弹窗三态扩展版）
 * 引用：T-PLUG-015
 * 上游：bridge/nav-hook.js, client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/FloatDock.js, components/MindMap.js, mount.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/layout.js — A11 布局 store（弹窗三态扩展版）
 *
 * 迁移源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
 *   行范围：6439 ~ 6483（45 行）
 *   区块标记：`// ========== 总监对话模式 - 布局store（小窗宽度/折叠/焦点） ==========`
 *
 * 职责：小窗宽度 / 折叠状态 / 焦点目标 / 上下伸缩面板高度 / **弹窗三态** 的集中状态层。
 *
 * ⚠️ 兼容约束（R5）：持久化 key `dsh.director.layout` **必须原样保留**，
 *    改名将导致用户存量布局数据全部丢失。
 *
 * ── 本轮扩展（T-PLUG-015 弹窗形态，docs/10 §四 4.3）──────────────
 *   新增字段（**只增不改**，存量数据无这些键 ⇒ 读取端必须做默认值兜底）：
 *     `dialogOpen`      弹窗是否打开
 *     `dialogCollapsed` 整窗最小化（收成右下角 chip）—— 05 号文只设计了左右两栏折叠，
 *                       整窗最小化是**本轮新增**的第三态（docs/10 §4.3 标注 🆕）
 *     `activeNodeId`    当前展示的层级节点（全局 / 项目·文件夹 / 会话）
 *     `leftTab`         左面板分段：director（总监）/ levels（层级）/ agents（智能体）
 *   **既有字段语义不变**：`directorPanelCollapsed`（左栏）/ `chatPanelCollapsed`（右栏）/
 *     `directorPanelWidth` / `chatPanelWidth` / `focusTarget`。
 *
 *   边界与吸附（docs/11 §二 I8）：宽度 `clamp(180, 55%×视口)`；拖到 <180 自动吸附折叠；
 *   双击中缝复位 300/300。
 *
 * 全局契约（宿主 G1/G4 依赖，**不可改名**）：
 *   - `window.__directorLayoutStore` — 宿主 ChatView（client.js:7111）与 view-sync（client.js:9146）调用
 *   - `window.__directorFocusTarget` — setFocusTarget 同步写入（client.js:6469）
 */

export const DIRECTOR_LAYOUT_KEY = "dsh.director.layout";

/** 左/右栏宽度的边界（docs/10 §4.1） */
export const PANEL_MIN_WIDTH = 180;
/** 单栏最大占比（相对视口宽） */
export const PANEL_MAX_RATIO = 0.55;
/** 默认栏宽 */
export const PANEL_DEFAULT_WIDTH = 300;
/** 折叠后的竖条宽度 */
export const PANEL_RAIL_WIDTH = 40;

/** 左面板分段（单一真相源，勿另写字面量） */
export const LEFT_TAB = Object.freeze({ DIRECTOR: "director", LEVELS: "levels", AGENTS: "agents" });

/** 视口宽度（SSR / 测试环境兜底 1440） */
function viewportWidth() {
	try {
		if (typeof window !== "undefined" && window.innerWidth) return window.innerWidth;
	} catch (e) { /* 忽略 */ }
	return 1440;
}

/** 单栏宽度上限（按视口比例，且不低于下限，避免极小视口下 clamp 反向） */
export function maxPanelWidth() {
	return Math.max(PANEL_MIN_WIDTH, Math.round(viewportWidth() * PANEL_MAX_RATIO));
}

/**
 * 宽度钳制 + 吸附判定（docs/11 §二 I8）
 * @param {number} w 期望宽度
 * @returns {{width:number, collapse:boolean}} collapse=true 表示"拖到过窄 ⇒ 应吸附为折叠"
 */
export function clampPanelWidth(w) {
	const n = Number(w);
	if (!Number.isFinite(n) || n <= 0) return { width: PANEL_DEFAULT_WIDTH, collapse: false };
	if (n < PANEL_MIN_WIDTH) return { width: PANEL_MIN_WIDTH, collapse: true };
	return { width: Math.min(Math.round(n), maxPanelWidth()), collapse: false };
}

const DEFAULTS = Object.freeze({
	// ── 05 号文既有字段（语义不变）──
	directorPanelWidth: PANEL_DEFAULT_WIDTH,
	chatPanelWidth: PANEL_DEFAULT_WIDTH,
	directorPanelCollapsed: false,
	chatPanelCollapsed: false,
	focusTarget: "director",
	// V7: 上下伸缩界面
	bottomPanelHeight: 180,
	bottomPanelCollapsed: true,
	topPanelCollapsed: false,
	// ── 本轮新增（弹窗三态）──
	dialogOpen: false,
	dialogCollapsed: false,
	activeNodeId: null,
	leftTab: LEFT_TAB.DIRECTOR,
	// ── 本轮新增（设计图工作室 · T-PLUG-018）──
	//  📐 设计图是**全屏覆盖层**（用户：「点击铺满全屏」），与弹窗三态无关，
	//     故单开一个布尔。打开时弹窗前端的浮层会让位（避免两层浮层叠着打架）。
	designStudioOpen: false,
	// 分支导图（血缘树）覆盖层。与设计图同为全屏层，但内容不同：
	//   导图 = 真实会话的分支血缘（消费 sessions.fork 写入的 meta.parentSession）
	//   设计图 = 手工编辑的界面稿（元素 + 交互逻辑）
	mindmapOpen: false,
	// 浮动按钮组里「思维导图」在前、「总监」在后（用户明确要求顺序）
	floatDockOpen: true,
	/* ── 本轮新增：导图节点的**用户摆放位置**（用户：思维导图的框不能动 需要可以移动）──
	 * 🔴 放这里而不是新开一个持久化 key：本 store 的语义就是"在哪"（宽度/折叠/焦点），
	 *    节点坐标同属"在哪"。再开第四个 key 只会让"复位"变成半复位。
	 * 🔴 只存**用户拖过的**节点（未拖过的走自动布局）⇒ 数据量最小、自动布局改动仍能生效。
	 *    形如 { "<sessionId>": { x, y } }
	 */
	mmPos: {}
});

export function createDirectorLayoutStore() {
	let state = { ...DEFAULTS };
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DIRECTOR_LAYOUT_KEY) : null;
		if (raw) {
			// 🔴 只合并"已知字段"，忽略未知残留；缺字段由 DEFAULTS 兜底
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object") {
				for (const k of Object.keys(DEFAULTS)) {
					if (parsed[k] !== undefined) state[k] = parsed[k];
				}
			}
		}
	} catch (e) { /* 解析失败 → 用默认值 */ }
	const listeners = new Set();
	function notify() {
		try { if (typeof localStorage !== "undefined") localStorage.setItem(DIRECTOR_LAYOUT_KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式 */ }
		for (const fn of listeners) { try { fn(state); } catch (e) { /* 单个订阅者异常不影响其他 */ } }
	}
	/** 拖拽调宽：返回是否触发了吸附折叠（供 UI 反馈） */
	function applyWidth(key, w) {
		const { width, collapse } = clampPanelWidth(w);
		state = { ...state, [key]: width };
		if (collapse) {
			const ck = key === "directorPanelWidth" ? "directorPanelCollapsed" : "chatPanelCollapsed";
			state = { ...state, [ck]: true };
		}
		notify();
		return collapse;
	}
	return {
		getState: () => state,
		subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
		setDirectorWidth: (w) => { state = { ...state, directorPanelWidth: Math.max(180, Math.min(w, 600)) }; notify(); },
		setChatWidth: (w) => { state = { ...state, chatPanelWidth: Math.max(180, Math.min(w, 600)) }; notify(); },
		toggleDirectorCollapsed: () => { state = { ...state, directorPanelCollapsed: !state.directorPanelCollapsed }; notify(); },
		toggleChatCollapsed: () => { state = { ...state, chatPanelCollapsed: !state.chatPanelCollapsed }; notify(); },
		setFocusTarget: (target) => { state = { ...state, focusTarget: target }; notify(); if (typeof window !== "undefined") window.__directorFocusTarget = target; },
		// V7: 上下伸缩
		setBottomPanelHeight: (h) => { state = { ...state, bottomPanelHeight: Math.max(60, Math.min(h, 400)) }; notify(); },
		toggleBottomPanel: () => { state = { ...state, bottomPanelCollapsed: !state.bottomPanelCollapsed }; notify(); },
		setBottomPanelCollapsed: (v) => { state = { ...state, bottomPanelCollapsed: v }; notify(); },
		toggleTopPanel: () => { state = { ...state, topPanelCollapsed: !state.topPanelCollapsed }; notify(); },

		/* ── 本轮新增：弹窗三态 ─────────────────────────────── */

		/** 打开/关闭弹窗（关闭时同时解除整窗最小化，避免"关了但还是 chip"的困惑） */
		setDialogOpen: (v) => {
			state = { ...state, dialogOpen: Boolean(v), dialogCollapsed: v ? state.dialogCollapsed : false };
			notify();
		},
		toggleDialog: () => {
			state = { ...state, dialogOpen: !state.dialogOpen, dialogCollapsed: false };
			notify();
		},
		/** 整窗最小化 / 还原 */
		setDialogCollapsed: (v) => { state = { ...state, dialogCollapsed: Boolean(v), dialogOpen: true }; notify(); },
		toggleDialogCollapsed: () => { state = { ...state, dialogCollapsed: !state.dialogCollapsed, dialogOpen: true }; notify(); },
		/** 切换当前层级节点（要求 7 / 9） */
		setActiveNode: (nodeId) => { state = { ...state, activeNodeId: nodeId || null }; notify(); },
		/** 切换左面板分段 */
		setLeftTab: (t) => {
			state = { ...state, leftTab: Object.values(LEFT_TAB).indexOf(t) >= 0 ? t : LEFT_TAB.DIRECTOR };
			notify();
		},
		/** 拖拽调宽（带吸附：过窄自动折叠）。返回是否触发吸附 */
		dragDirectorWidth: (w) => applyWidth("directorPanelWidth", w),
		dragChatWidth: (w) => applyWidth("chatPanelWidth", w),
		/** 双击中缝复位 */
		resetPanelWidths: () => {
			state = { ...state, directorPanelWidth: PANEL_DEFAULT_WIDTH, chatPanelWidth: PANEL_DEFAULT_WIDTH, directorPanelCollapsed: false, chatPanelCollapsed: false };
			notify();
		},
		/** 全部复位（调试/测试用） */
		resetLayout: () => { state = { ...DEFAULTS }; notify(); },

		/* ── 本轮新增：设计图工作室（T-PLUG-018）──────────────── */
		/** 打开/关闭设计图工作室（全屏覆盖层；**不依赖 dialogOpen**） */
		setDesignStudio: (v) => { state = { ...state, designStudioOpen: Boolean(v) }; notify(); },
		toggleDesignStudio: () => { state = { ...state, designStudioOpen: !state.designStudioOpen }; notify(); },
		/** 浮动按钮组显隐 */
		setFloatDock: (v) => { state = { ...state, floatDockOpen: Boolean(v) }; notify(); },

		/* ── 本轮新增：分支导图覆盖层 ─────────────────────────── */
		setMindmap: (v) => { state = { ...state, mindmapOpen: Boolean(v) }; notify(); },
		toggleMindmap: () => { state = { ...state, mindmapOpen: !state.mindmapOpen }; notify(); },
		/** 记录用户把某个框拖到哪（**只改画面位置，不改血缘**） */
		setNodePos: (sessionId, pos) => {
			if (!sessionId || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
			state = { ...state, mmPos: { ...state.mmPos, [String(sessionId)]: { x: Math.round(pos.x), y: Math.round(pos.y) } } };
			notify();
			return true;
		},
		/** 单个框归位（回到自动布局） */
		clearNodePos: (sessionId) => {
			if (!state.mmPos || !(String(sessionId) in state.mmPos)) return false;
			const next = { ...state.mmPos };
			delete next[String(sessionId)];
			state = { ...state, mmPos: next };
			notify();
			return true;
		},
		/** 全部归位（"自动布局"按钮） */
		resetNodePos: () => {
			state = { ...state, mmPos: {} };
			notify();
			return true;
		}
	};
}

/** 单例 + 挂载全局（宿主依赖 window.__directorLayoutStore） */
export const directorLayoutStore = createDirectorLayoutStore();
if (typeof window !== "undefined") window.__directorLayoutStore = directorLayoutStore;
