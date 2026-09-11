/**
 * mount.js — 总监弹窗的挂载层（T-PLUG-015 起：弹窗形态为主通道）
 *
 * ── 形态变更（docs/10 §4.1 + docs/11 §四 方案 F1）───────────────
 *   旧：880×560 的单面板浮层（`#dsh-director-hierarchy-overlay`）
 *       —— 与原生 tab（26×27，y=48）形态完全不同 ⇒ 用户裁定"看起来像完全重画"。
 *   新：**弹窗**（`#dsh-director-dialog`）—— 左＝总监面板（插件 React 组件），
 *       右＝**原生对话区本身**（由 `bridge/split.js` 向右挤，零节点移动）。
 *
 * ── 为什么仍是"自挂 DOM"而不是宿主 slot ─────────────────────────
 *   宿主 `conversation.view` tab 环**确实是 slot 驱动**（宿主 `client.js:9172`
 *   `renderSlot("conversation.view", …, { only: active.id })`），但**注册入口需要 `ctx.slots`**，
 *   而插件侧 `window.__DSH_SLOTS__` **从来不存在**（真机实测）。
 *   且本轮形态裁定为**弹窗**（非 tab），故自挂 DOM 仍是正确通道：
 *   **零宿主依赖、必定可见、完全可逆**。
 *   `tryRegisterHostSlot` 保留为可选增强（日后 `ctx.slots` 可用时可叠加）。
 *
 * ⚠️ 构建约束：`react-dom/client` 同为平台冻结模块（ADR-001），构建期外置为 `require(...)`。
 */

import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import * as react_dom_client from "react-dom/client";
import { DirectorDialog, DIALOG_ID } from "./components/DirectorDialog.js";
import { directorLayoutStore } from "./store/layout.js";
import { installSplitApi, clearSplit } from "./bridge/split.js";
import { installChatBridgeApi } from "./bridge/chat-bridge.js";
import { installNavHook, installNavHookApi } from "./bridge/nav-hook.js";
import { dshLog } from "./util/debug.js";
import { emitHierarchyChange } from "./util/bus.js";

/** 弹窗 React 挂载宿主（无样式、零布局影响） */
export const DIALOG_HOST_ID = "dsh-director-dialog-host";
/** 入口按钮 id —— 🔴 **保持旧名**，既有真机脚本按此 id 取入口，改名会静默失联 */
export const LAUNCHER_ID = "dsh-director-hierarchy-launcher";
/** 旧浮层宿主 id（兼容保留，默认不创建） */
export const OVERLAY_HOST_ID = "dsh-director-hierarchy-overlay";

function makeLauncher(onToggle) {
	const btn = document.createElement("button");
	btn.id = LAUNCHER_ID;
	btn.type = "button";
	btn.textContent = "总监";
	btn.setAttribute("aria-label", "打开总监");
	btn.title = "打开总监（Alt+` 亦可）";
	Object.assign(btn.style, {
		position: "fixed", right: "18px", bottom: "18px", zIndex: 2147483000,
		padding: "7px 14px", fontSize: "12.5px", borderRadius: "999px",
		border: "1px solid rgba(137,87,229,.5)", background: "rgba(137,87,229,.18)",
		color: "#b794f6", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.35)",
		backdropFilter: "blur(4px)"
	});
	btn.addEventListener("click", onToggle);
	document.body.appendChild(btn);
	return btn;
}

/**
 * 挂载总监弹窗
 * @param {object} [opts]
 * @param {boolean} [opts.withLauncher=true] 是否创建右下角入口按钮
 * @param {boolean} [opts.open=false] 初始是否展开
 * @param {boolean} [opts.legacyOverlay=false] 兼容：额外挂旧浮层（默认关闭）
 * @param {boolean} [opts.navHook=true] 是否安装「点击侧栏文件夹/项目 → 打开该层级总监」
 * @returns {{host:HTMLElement|null, launcher:HTMLElement|null, root:object, unmount:()=>void, show:()=>void, hide:()=>void}}
 */
export function mountHierarchy(opts = {}) {
	if (typeof window === "undefined" || typeof document === "undefined") return { host: null, launcher: null, root: null, unmount: () => {}, show: () => {}, hide: () => {} };

	// 能力安装（幂等）
	installSplitApi();
	installChatBridgeApi();
	installNavHookApi();

	let host = document.getElementById(DIALOG_HOST_ID);
	let alreadyMounted = Boolean(host);
	if (!host) {
		host = document.createElement("div");
		host.id = DIALOG_HOST_ID;
		document.body.appendChild(host);
	}
	const root = react_dom_client.createRoot(host);
	root.render((0, react_jsx_runtime.jsx)(DirectorDialog, {}));

	const show = () => { directorLayoutStore.setDialogOpen(true); emitHierarchyChange(); };
	const hide = () => { directorLayoutStore.setDialogOpen(false); };
	const launcher = opts.withLauncher === false ? null : makeLauncher(() => {
		if (directorLayoutStore.getState().dialogOpen) hide(); else show();
	});
	if (opts.open === true) show();

	// 点击侧栏文件夹 / 项目 → 打开该层级总监（要求 7 / 9）
	let navOff = null;
	if (opts.navHook !== false) {
		navOff = installNavHook();
		if (typeof window !== "undefined") window.__dshNavUninstall = navOff;
	}

	dshLog("hierarchy", "总监弹窗已挂载（弹窗通道，宿主零改动）");
	return {
		host, launcher, root, alreadyMounted,
		show, hide,
		unmount: () => {
			try { clearSplit(); } catch (e) { /* 已复原 */ }
			try { root.unmount(); } catch (e) { /* 已卸载 */ }
			if (navOff) navOff();
			host.remove();
			if (launcher) launcher.remove();
		}
	};
}

/**
 * 尝试注册到宿主 slot（可选增强，失败静默）
 * 🔴 现状：`window.__DSH_SLOTS__` 在真机上**不存在**（实测 2026-09-12），故本通道恒失败；
 *    保留以便宿主日后暴露 `ctx.slots` 时可直接叠加，不影响弹窗主通道。
 * @returns {boolean} 是否注册成功
 */
export function tryRegisterHostSlot() {
	try {
		const slots = typeof window !== "undefined" ? window.__DSH_SLOTS__ : null;
		if (!slots || typeof slots.register !== "function") return false;
		slots.register({ name: "conversation.view", id: "director", order: -1, label: () => "总监" }, DirectorDialog);
		dshLog("hierarchy", "已注册到宿主 conversation.view slot（id=director）");
		return true;
	} catch (e) {
		dshLog("hierarchy", "宿主 slot 注册失败（预期内），使用弹窗通道: " + (e && e.message));
		return false;
	}
}

/** 旧浮层通道（兼容保留；默认不再使用，见文件头） */
export function mountHierarchyOverlay() {
	if (typeof window === "undefined" || typeof document === "undefined") return null;
	dshLog("hierarchy", "mountHierarchyOverlay 已退役（弹窗形态取代），如需旧浮层请用 git 历史版本");
	return null;
}

export default mountHierarchy;
