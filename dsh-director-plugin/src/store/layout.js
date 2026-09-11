/**
 * store/layout.js — A11 布局 store
 *
 * 迁移源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
 *   行范围：6439 ~ 6483（45 行）
 *   区块标记：`// ========== 总监对话模式 - 布局store（小窗宽度/折叠/焦点） ==========`
 *
 * 职责：小窗宽度 / 折叠状态 / 焦点目标 / 上下伸缩面板高度的集中状态层。
 *
 * ⚠️ 兼容约束（R5）：持久化 key `dsh.director.layout` **必须原样保留**，
 *    改名将导致用户存量布局数据全部丢失。
 *
 * 全局契约（宿主 G1/G4 依赖）：
 *   - `window.__directorLayoutStore` — 宿主 ChatView（client.js:7111）与 view-sync（client.js:9146）调用
 *   - `window.__directorFocusTarget` — setFocusTarget 同步写入（client.js:6469）
 */

export const DIRECTOR_LAYOUT_KEY = "dsh.director.layout";

export function createDirectorLayoutStore() {
	let state = {
		directorPanelWidth: 300,
		chatPanelWidth: 300,
		directorPanelCollapsed: false,
		chatPanelCollapsed: false,
		focusTarget: "director",
		// V7: 上下伸缩界面
		bottomPanelHeight: 180,
		bottomPanelCollapsed: true,
		topPanelCollapsed: false
	};
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DIRECTOR_LAYOUT_KEY) : null;
		if (raw) state = { ...state, ...JSON.parse(raw) };
	} catch (e) {}
	const listeners = new Set();
	function notify() {
		try { if (typeof localStorage !== "undefined") localStorage.setItem(DIRECTOR_LAYOUT_KEY, JSON.stringify(state)); } catch (e) {}
		for (const fn of listeners) fn(state);
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
		toggleTopPanel: () => { state = { ...state, topPanelCollapsed: !state.topPanelCollapsed }; notify(); }
	};
}

/** 单例 + 挂载全局（宿主依赖 window.__directorLayoutStore） */
export const directorLayoutStore = createDirectorLayoutStore();
if (typeof window !== "undefined") window.__directorLayoutStore = directorLayoutStore;
