/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总监弹窗的挂载层（T-PLUG-015 起：弹窗形态为主通道）
 * 引用：V16 诉求 1（四浮层互不拖死） · T-PLUG-015
 * 上游：client-entry.js
 * 下游：components/DirectorDialog.js, components/DesignStudio.js, components/MindMap.js, components/FloatDock.js, store/layout.js, store/design.js, bridge/split.js, bridge/chat-bridge.js, bridge/nav-hook.js, util/debug.js, util/bus.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A（四浮层挂载 + 错误边界）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
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
 *   🔴 **2026-09-12 订正**：原文此处写「`window.__DSH_SLOTS__` 从来不存在 ⇒ slot 通道恒失败」，
 *      该结论**只对了一半** —— 不存在的只是那个**全局变量名**；真正的入口是 cordis 的
 *      `ctx.slots`（由 `apply(ctx)` 注入）。同族先例已在宿主源码中确证：
 *        `dsh-client-ui-trajectory/lib/client.js:7316,7340`
 *          `inject: ["slots"]` + `ctx.slots.inject("conversation.view", () => ctx.slots.register({...}))`
 *      ⇒ 总监 tab 的注册现已实现在 `client-entry.js:installDirectorView(ctx)`（本文件不再承担）。
 *   ⇒ 本文件继续负责**自挂 DOM 通道**，它仍有独立价值：
 *      **零宿主依赖、必定可见、完全可逆** —— 当 slot 不可用（宿主版本差异）时保底。
 *      两条通道**并存不互斥**：slot 通道给原生 tab，DOM 通道给浮动按钮组与全屏工作室。
 *
 * ⚠️ 构建约束：`react-dom/client` 同为平台冻结模块（ADR-001），构建期外置为 `require(...)`。
 */

import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import * as react_dom_client from "react-dom/client";
import { DirectorDialog, DIALOG_ID } from "./components/DirectorDialog.js";
import { DesignStudio, STUDIO_ID } from "./components/DesignStudio.js";
import { MindMap, MINDMAP_ID } from "./components/MindMap.js";
import { FloatDock, FLOATDOCK_ID, LAUNCHER_ID as DOCK_LAUNCHER_ID } from "./components/FloatDock.js";
import { directorLayoutStore } from "./store/layout.js";
import { installDesignApi } from "./store/design.js";
import { installSplitApi, clearSplit } from "./bridge/split.js";
import { installChatBridgeApi } from "./bridge/chat-bridge.js";
import { installNavHook, installNavHookApi } from "./bridge/nav-hook.js";
import { dshLog } from "./util/debug.js";
import { emitHierarchyChange } from "./util/bus.js";

/** 弹窗 React 挂载宿主（无样式、零布局影响） */
export const DIALOG_HOST_ID = "dsh-director-dialog-host";
/** 🔴 **保持旧名**，既有真机脚本按此 id 取入口，改名会静默失联（现挂在 FloatDock 的「总监」按钮上） */
export const LAUNCHER_ID = "dsh-director-hierarchy-launcher";
/** 旧浮层宿主 id（兼容保留，默认不创建） */
export const OVERLAY_HOST_ID = "dsh-director-hierarchy-overlay";

// `h` 必须在 Shell 之前声明（Shell 内部引用它做渲染）
const h = react.createElement;

/**
 * SafeLayer —— **单层错误边界**（2026-09-12 真机事故的结构性修复）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须有它（事故复盘）
 * ──────────────────────────────────────────────────────────────────
 * 事故链：`DesignStudio` 在「open=true 且 doc=null」的首帧里对 null 取 `.title`
 *   → TypeError → **Shell 根没有错误边界** → React 卸载**整棵树**
 *   → 浮动按钮组 / 弹窗 / 工作室**同时消失**（hostChildCount = 0）
 *   → 且因 `designStudioOpen` 已持久化，**每次重启必然复现**，用户侧表现为"插件没了"。
 * 关键教训：**一个非关键层的渲染异常，不得升级为整个插件域的可用性故障**。
 *   四层是相互独立的能力（设计图 / 导图 / 弹窗 / 按钮组），必须**故障隔离**。
 *
 * 设计取舍：捕获后**不静默**——渲染一个可见的小角标（含错误摘要 + 重试），
 *   因为静默失败正是本次事故"难以定位"的根源。宁可难看，也要能看见。
 */
class SafeLayer extends react.Component {
	constructor(props) {
		super(props);
		this.state = { err: null };
		this.reset = this.reset.bind(this);
	}
	static getDerivedStateFromError(err) { return { err }; }
	componentDidCatch(err) {
		try { dshLog("shell", "层「" + this.props.name + "」渲染异常已隔离（其余层不受影响）: " + ((err && err.message) || err)); } catch (_) {}
	}
	reset() { this.setState({ err: null }); }
	render() {
		if (!this.state.err) return this.props.children;
		const msg = String((this.state.err && this.state.err.message) || this.state.err);
		return h("div", {
			style: {
				position: "fixed", left: 14, bottom: 14, zIndex: 2147483000, maxWidth: 460,
				padding: "8px 10px", borderRadius: 8, fontSize: 11.5, lineHeight: 1.5,
				border: "1px solid rgba(248,81,73,.5)", background: "rgba(60,18,18,.94)", color: "#f0877f",
				fontFamily: "inherit", boxShadow: "0 6px 20px rgba(0,0,0,.45)"
			},
			"data-testid": "d-layer-error"
		}, [
			h("div", { key: "t", style: { fontWeight: 700, marginBottom: 3 } }, "⚠ 插件层「" + this.props.name + "」异常（已隔离）"),
			h("div", { key: "m", style: { color: "#f5b7b1", wordBreak: "break-word" } }, msg),
			h("button", {
				key: "r", type: "button",
				style: { marginTop: 6, padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, border: "1px solid rgba(248,81,73,.5)", background: "rgba(248,81,73,.18)", color: "#ffd9d5" },
				onClick: this.reset
			}, "重试该层")
		]);
	}
}

/**
 * 用 SafeLayer 包一层。
 * 🔴 **不要用 `layer.bind(null, name)` 当组件类型**（2026-09-12 踩坑）：
 *    `h(thunk, { key, children })` 会把**整个 props 对象**当成第 3 个实参传给 thunk
 *    ⇒ SafeLayer 的 children 变成 `{ key, children }` 这个普通对象
 *    ⇒ React error #31「Objects are not valid as a React child」。
 *    直接普通函数调用最稳：`layer(name, key, element)`。
 */
const layer = (name, key, el) => h(SafeLayer, { name, key }, el);

/**
 * Shell —— 宿主页面上「插件自挂层」的统一 React 根。
 *
 * 四件东西同根渲染（**同一个 root、四个独立层**，各自订阅 store 决定显隐）：
 *   DirectorDialog  弹窗（z 2147483000）—— 左总监面板 + 右原生对话区
 *   DesignStudio    全屏工作室（z 2147483200）—— 设计图编辑（T-PLUG-018）
 *   MindMap         分支导图覆盖层（z 2147483100）
 *   FloatDock       浮动按钮组（z 2147482990）—— 三个能力入口
 *
 * 分层顺序即 z-index 顺序：全屏工作室 > 导图 > 弹窗 > 浮动组。
 * 🔴 每层裹 `SafeLayer` —— 任一层崩溃只损失该层（见 SafeLayer 头注的事故复盘）。
 */
function Shell() {
	const st = react.useSyncExternalStore(
		(fn) => directorLayoutStore.subscribe(fn),
		() => directorLayoutStore.getState(),
		() => directorLayoutStore.getState()
	);
	return h(react.Fragment, null, [
		layer("dialog", "dialog", h(DirectorDialog, {})),
		layer("studio", "studio", h(DesignStudio, {
			open: Boolean(st.designStudioOpen),
			onClose: () => directorLayoutStore.setDesignStudio(false)
		})),
		layer("mindmap", "mindmap", h(MindMap, {
			open: Boolean(st.mindmapOpen),
			onClose: () => directorLayoutStore.setMindmap(false)
		})),
		layer("dock", "dock", h(FloatDock, {}))
	]);
}

/**
 * 旧版纯 DOM 入口按钮 —— **已由 FloatDock 取代**（保留函数仅为向后兼容调用点）。
 * 如需旧形态，改回 git 历史版本。返回 null 表示未创建。
 */
function makeLauncher() {
	dshLog("hierarchy", "makeLauncher 已退役（入口由 FloatDock 统一提供，含设计图 / 导图 / 总监三键）");
	return null;
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
	installDesignApi();   // 设计图工作室的全局契约（window.__dshDesign）

	let host = document.getElementById(DIALOG_HOST_ID);
	let alreadyMounted = Boolean(host);
	if (!host) {
		host = document.createElement("div");
		host.id = DIALOG_HOST_ID;
		document.body.appendChild(host);
	}
	// 🔴 **同一容器不得重复 createRoot**（2026-09-12）：
	//    React 18 对已 createRoot 过的容器再次 createRoot 会告警，且**两个 root 互抢同一容器**
	//    ⇒ 后者的 render 可能被前者的卸载清空（表现为"宿主 div 存在但 childCount = 0"）。
	//    故把 root 缓存在宿主元素上，重复挂载时复用并只做一次 render。
	let root = host.__dshShellRoot;
	if (!root) {
		root = react_dom_client.createRoot(host);
		host.__dshShellRoot = root;
	}
	root.render(h(Shell, {}));

	const show = () => { directorLayoutStore.setDialogOpen(true); emitHierarchyChange(); };
	const hide = () => { directorLayoutStore.setDialogOpen(false); };
	const launcher = opts.withLauncher === false ? null : makeLauncher();
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
			// 缓存作废：否则下次 mount 会拿到已卸载的 root（render 静默无效）
			try { delete host.__dshShellRoot; } catch (e) { /* noop */ }
			if (navOff) navOff();
			host.remove();
			if (launcher) launcher.remove();
		}
	};
}

/**
 * 尝试注册到宿主 slot（**保留为兼容退路**）
 *
 * 🔴 2026-09-12 订正：真正的 slot 通道是 cordis 的 `ctx.slots`（由 `apply(ctx)` 注入），
 *    已实现在 `client-entry.js` 的 `installDirectorView(ctx)` 中，并在构建期由
 *    `build/build.mjs` 的 apply 模板透传 ctx。
 *    本函数仅保留"全局变量形态"的退路：若日后宿主把 slots 暴露为全局，可直接叠加。
 * @returns {boolean} 是否注册成功
 */
export function tryRegisterHostSlot() {
	try {
		const slots = typeof window !== "undefined" ? window.__DSH_SLOTS__ : null;
		if (!slots || typeof slots.register !== "function") return false;
		slots.register({ name: "conversation.view", id: "director", order: -1, label: () => "总监" }, DirectorDialog);
		dshLog("hierarchy", "已注册到宿主 conversation.view slot（id=director，全局变量通道）");
		return true;
	} catch (e) {
		dshLog("hierarchy", "全局变量 slot 通道不可用（预期内），已由 ctx.slots 通道承担: " + (e && e.message));
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
