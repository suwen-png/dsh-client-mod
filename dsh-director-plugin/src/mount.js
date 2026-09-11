/**
 * mount.js — 多层级总监面板的挂载层（方案 C：slot 优先 / DOM 兜底）
 *
 * 设计依据：`docs/04-多层级总监结构设计与方案选型.md` §二 选定方案 C
 *   - **slot 优先**：若宿主暴露了 slots 服务（window.__DSH_SLOTS__），则注册到
 *     `conversation.view`（03号文 §2.1「[总监][对话][轨迹] 三 tab 同属 conversation.view」），
 *     与原生 UI 完全一致。
 *   - **DOM 兜底**（默认路径）：自行 createRoot 渲染浮层面板。
 *     🔴 为什么兜底是默认：宿主 `conversation.view` 的 slots 实例由 app-shell 通过
 *     `ctx.slots.install` 注入，**插件侧能否拿到同一实例未经实测**；而本插件当前
 *     正是因「宿主已退坡 + 插件未注册入口」导致功能不可达（见 memory 2026-09-11 ⑫）。
 *     兜底通道**零宿主依赖、必定可见**，故作为默认与保底。
 *
 * ⚠️ 构建约束：`react-dom/client` 同为平台冻结模块（ADR-001），构建期外置为 `require(...)`。
 */

import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import * as react_dom_client from "react-dom/client";
import { DirectorHierarchy } from "./components/DirectorHierarchy.js";
import { dshLog } from "./util/debug.js";

export const OVERLAY_HOST_ID = "dsh-director-hierarchy-overlay";
export const LAUNCHER_ID = "dsh-director-hierarchy-launcher";

/** 面板尺寸（浮层形态） */
const PANEL = { width: 880, height: 560, right: 24, bottom: 64 };

function makeLauncher(onToggle) {
	const btn = document.createElement("button");
	btn.id = LAUNCHER_ID;
	btn.textContent = "总监层级";
	Object.assign(btn.style, {
		position: "fixed", right: "24px", bottom: "24px", zIndex: 2147483000,
		padding: "8px 14px", fontSize: "13px", borderRadius: "999px",
		border: "1px solid #2f6bdd", background: "#2f6bdd", color: "#fff",
		cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.35)"
	});
	btn.addEventListener("click", onToggle);
	document.body.appendChild(btn);
	return btn;
}

/**
 * 挂载多层级总监面板（浮层兜底通道）
 * @param {object} [opts]
 * @param {boolean} [opts.withLauncher=true] 是否创建右下角入口按钮
 * @param {boolean} [opts.open=false] 初始是否展开
 * @returns {{overlay: HTMLElement, launcher: HTMLElement|null, root: object, unmount: () => void, show: () => void, hide: () => void}|null}
 */
export function mountHierarchyOverlay(opts = {}) {
	if (typeof window === "undefined" || typeof document === "undefined") return null;
	if (document.getElementById(OVERLAY_HOST_ID)) return null; // 幂等

	const overlay = document.createElement("div");
	overlay.id = OVERLAY_HOST_ID;
	Object.assign(overlay.style, {
		position: "fixed", zIndex: 2147483001,
		right: PANEL.right + "px", bottom: PANEL.bottom + "px",
		width: PANEL.width + "px", height: PANEL.height + "px",
		border: "1px solid #2a2c30", borderRadius: "12px", overflow: "hidden",
		background: "#16171a", boxShadow: "0 12px 40px rgba(0,0,0,.5)",
		display: opts.open ? "block" : "none"
	});
	document.body.appendChild(overlay);

	const root = react_dom_client.createRoot(overlay);
	const render = (open) => root.render(
		(0, react_jsx_runtime.jsx)(DirectorHierarchy, { onClose: () => { hide(); } })
	);
	const show = () => { overlay.style.display = "block"; render(true); };
	const hide = () => { overlay.style.display = "none"; };
	render(opts.open);

	const launcher = opts.withLauncher === false ? null : makeLauncher(() => {
		if (overlay.style.display === "none") show(); else hide();
	});

	dshLog("hierarchy", "浮层面板已挂载（DOM 兜底通道）");
	return {
		overlay, launcher, root,
		show, hide,
		unmount: () => {
			try { root.unmount(); } catch { /* 已卸载 */ }
			overlay.remove();
			if (launcher) launcher.remove();
		}
	};
}

/**
 * 尝试注册到宿主 slot（可选增强，失败静默）
 * 仅当宿主在 window 上暴露 slots 服务时生效；否则返回 false。
 * @returns {boolean} 是否注册成功
 */
export function tryRegisterHostSlot() {
	try {
		const slots = typeof window !== "undefined" ? window.__DSH_SLOTS__ : null;
		if (!slots || typeof slots.register !== "function") return false;
		slots.register({
			name: "conversation.view",
			id: "director",
			order: -1,
			title: "总监"
		}, DirectorHierarchy);
		dshLog("hierarchy", "已注册到宿主 conversation.view slot（id=director）");
		return true;
	} catch (e) {
		dshLog("hierarchy", "宿主 slot 注册失败，改用浮层兜底: " + (e && e.message));
		return false;
	}
}

/**
 * 统一入口：先尝试宿主 slot，无论成功与否都确保浮层兜底可用。
 * @param {object} [opts] 同 mountHierarchyOverlay
 */
export function mountHierarchy(opts = {}) {
	const slotOk = tryRegisterHostSlot();
	const overlay = mountHierarchyOverlay(opts);
	if (typeof window !== "undefined") {
		window.__dshHierarchyMount = { slotRegistered: slotOk, overlay: Boolean(overlay), ...(overlay || {}) };
	}
	return { slotRegistered: slotOk, overlay };
}

export default mountHierarchy;
