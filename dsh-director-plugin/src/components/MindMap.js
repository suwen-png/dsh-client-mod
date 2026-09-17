/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：分支导图覆盖层（血缘树 · 缩滚展开 · 待总监路由）
 * 引用：—
 * 上游：client-entry.js, mount.js
 * 下游：logic/branch-tree.js, logic/branch-focus.js, components/OverviewDialog.js, logic/routing.js, logic/mindmap-render.js, util/debug.js, util/safe-area.js, bridge/chat-bridge.js, store/mindmap-schema.js, logic/flow.js, store/layout.js, store/personalize.js, components/NodeDetailPanel.js, components/PersonalizePanel.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A4（分支导图态）· F1–F4（思维导图元素库渲染：节点四型 / 状态四态 / 连线 / 控件）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/MindMap.js — 分支导图覆盖层（血缘树 · 缩滚展开 · 待总监路由）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
 *   ├─ 板块 A · A4 分支导图态（画面）
 *   ├─ 板块 C · C2 分支生命周期状态机（节点上的状态点即此状态机的当前值）
 *   ├─ 板块 C · C4 输入路由决策树（底栏输入 = 「目标未定」那一支）
 *   ├─ 板块 F · 思维导图元素库（本组件消费的元素词汇表 = store/mindmap-schema.js）
 *   └─ 板块 G · 单框控件 / 自由拖动 / 右侧对话面板（第三轮并入）
 *  数据源   logic/branch-tree.js（血缘来自宿主 sessions 写入的 parentId）
 *  元素库   store/mindmap-schema.js（节点型 / 状态 / 连线 / 单框控件 / 覆盖度）
 *  流转     logic/flow.js（一条消息走过总监 / 对话 / 导图 / 设计图的足迹）
 *  面板     components/NodeDetailPanel.js（点框在右侧展开该对话）
 *
 * ══════════════════════════════════════════════════════════════════
 *  第三轮需求原文（用户三条）
 * ══════════════════════════════════════════════════════════════════
 *  ① 「思维导图的单个框没有展开和折叠的选项」
 *  ② 「思维导图的框不能动 需要可以移动」
 *  ③ 「点击框在右侧展开对话 对话的最上面是现在正在做的事情…我要在思维导图界面能看到」
 *
 *  ⇒ 落地口径：
 *     ① 每个框**都有**一组小控件（`controlsOfRow` 算出，不由本组件各自 if）：
 *        ▾/▸ 折叠展开（有子才可点，无子写明原因）· 💬 展开右侧对话 · ✚ 分支 · 📂 打开 · ✥ 拖动手柄
 *     ② 拖动**只改画面位置**（写进 layout store 的 `mmPos`，只存拖过的节点），
 *        并提供「自动布局」一键归位；**绝不改 parentSessionId**（血缘由宿主 fork 固化）
 *     ③ 点框 → 右侧 `NodeDetailPanel`：最上面是「现在在做的事」，下面是跨维流转，
 *        底部输入落到**这个框对应的会话**（非当前会话会先打开它）
 *
 * ══════════════════════════════════════════════════════════════════
 *  节点四态（宿主真值）
 * ══════════════════════════════════════════════════════════════════
 *  running 执行中（蓝）← `running === true` ｜ review 待审（紫）← `pendingInteraction`
 *  done 已收口（绿）← `completed === true` ｜ idle 待命（灰）← 以上都不成立
 *  ⚠️ 设计稿 A4 第四态原为「出错」，宿主无错误字段 ⇒ 显式改「待审」并登记 `supported:false`。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 三条踩过的坑（勿回退）
 * ══════════════════════════════════════════════════════════════════
 *  ① **hooks 必须全部排在 `if (!open) return null` 之前** —— 否则 open false→true
 *     时 hooks 数量变化 ⇒ 整层崩溃（设计图工作室吃过一次）。
 *  ② **订阅顺序**：先 `subscribe` → 再同步取一次快照 → 最后才 `refresh`。
 *     `refreshBranchTree()` 走 ctx 通道时**同步 notify**，先 refresh 会让通知落在订阅之前
 *     ⇒ 首次打开永远空树。
 *  ③ **✕ 必须避让原生窗口控件**（实测 138px，操作系统图层，z-index 无效）：
 *     顶栏与工具条 `paddingRight = max(10, inset + 10)`。
 *
 * ⚠️ 构建约束：react / react/jsx-runtime 为平台冻结模块（ADR-001），构建期外置。
 */

import * as react from "react";
import {
	LAYOUT, subscribeBranch, getBranchSnapshot, refreshBranchTree,
	visibleRows, ancestorChain, treeBounds, matchRows, degradationReason,
	hostCapabilities, openSession, forkBranch, watchCurrentSession
} from "../logic/branch-tree.js";
import { focusRows, hasDownstream } from "../logic/branch-focus.js";
import { OverviewDialog } from "./OverviewDialog.js";
import { route, review6, DESTINATION, DESTINATION_LABEL } from "../logic/routing.js";
import { edgePathFor, edgeStyleOf, metaLineOf, stateTitleOf, kindLabelOf, nodeBtnStyle } from "../logic/mindmap-render.js";
import { dshLog } from "../util/debug.js";
import { readInset, watchInset } from "../util/safe-area.js";
import { readConversation } from "../bridge/chat-bridge.js";
import { NODE_KINDS, STATE_KINDS, MM_COVERAGE, supportedStates, controlsOfRow, coverageStats } from "../store/mindmap-schema.js";
import { flowStore, lastFlowIdFor, flowOrigin, DIM } from "../logic/flow.js";
import { directorLayoutStore } from "../store/layout.js";
import { personalizeStore } from "../store/personalize.js";
import { NodeDetailPanel } from "./NodeDetailPanel.js";
import { PersonalizePanel } from "./PersonalizePanel.js";

const h = react.createElement;
export const MINDMAP_ID = "dsh-mindmap";

/** toast 自动消失时长（ms）—— 沿用设计图工作室的修正：原实现"永不消失"是缺陷 */
const TOAST_MS = 2400;
/** 画布缩放范围 */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3;
/** 「适应屏幕」的可读性下限：超长链不再为塞进全部节点而无限缩小（33 节点链会缩到 22%，节点成蚂蚁、💬 按钮点不中）；
 *  低于此值就停在 30%，放不下的方向交给滚动 —— 与主流画布工具一致，保证节点可读、控件可点。 */
const FIT_MIN = 0.3;
/** 判定"这是在拖，不是在点"的位移阈值（px）—— 低于它仍算点击（打开右侧对话） */
const DRAG_SLOP = 4;

const S = {
	root: {
		position: "fixed", inset: 0, zIndex: 2147483100, display: "flex", flexDirection: "column",
		/* 🔴 必须 `backgroundColor`（长写）—— `background` 简写会把 `background-image` 重置掉，
		 *    而 `.dp-textured` 的三档纹理正是用 background-image 实现的（见 store/personalize.js）。
		 *    写成简写的后果：个性化面板里选纹理**看起来完全没反应**。 */
		backgroundColor: "var(--dp-bg-0, #0b0c0e)", color: "var(--dp-t1, #e8eaed)",
		fontFamily: "inherit", fontSize: "calc(12.5px * var(--dp-font, 1))"
	},
	top: {
		display: "flex", alignItems: "center", gap: 8, height: 40, flex: "0 0 40px", padding: "0 10px",
		borderBottom: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-1, #141519)", flex: "0 0 auto"
	},
	tools: {
		display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", minHeight: 38, flex: "0 0 auto",
		padding: "calc(5px * var(--dp-density, 1)) 10px", borderBottom: "1px solid var(--dp-line, #31343a)",
		background: "var(--dp-bg-1, #141519)"
	},
	/* 主区：左画布 + 右对话面板（右面板可关闭 ⇒ 画布自动铺满） */
	main: { flex: 1, minHeight: 0, display: "flex", overflow: "hidden" },
	canvasWrap: { flex: 1, minWidth: 0, minHeight: 0, position: "relative", display: "flex", overflow: "hidden" },
	body: { flex: 1, minHeight: 0, position: "relative", overflow: "auto", background: "var(--dp-bg-0, #0b0c0e)" },
	// 居中不用 flex（flex 的 center/safe-center 在内容窄于视口时会凭空造出横向可滚动区，小地图点击会跳进空白）；
	// 改为 block + 渲染时按视口与内容包围盒动态算 margin（见 stageWrap），内容大于视口时 margin 归零、正常双向滚动。
	// overflow:hidden 裁掉内部 stage 按 minW/minH 预留、却落在可见包围盒之外的绘制空白，使其不贡献假滚动。
	stageWrap: { position: "relative", overflow: "hidden" },
	stage: { position: "relative", transformOrigin: "top left", userSelect: "none", WebkitUserSelect: "none" },
	/* ── 节点 ──
	 * 四型配色来自 NODE_KINDS[kind].accent；选中/悬停只改"描边与光晕"，不改底色。 */
	node: (sel, hov, kind, dragging) => {
		const a = (NODE_KINDS[kind] || NODE_KINDS.leaf).accent;
		return {
			position: "absolute", boxSizing: "border-box", width: LAYOUT.nodeW, height: LAYOUT.nodeH,
			border: "1px solid " + (sel ? "var(--dp-ac, #2f6feb)" : hov ? a : "var(--dp-line, rgba(255,255,255,.13))"),
			borderLeft: "3px solid " + a,
			background: sel ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "var(--dp-bg-2, rgba(255,255,255,.035))",
			borderRadius: "var(--dp-radius, 8px)", padding: "5px 8px 5px 9px",
			cursor: dragging ? "grabbing" : "grab", color: "var(--dp-t1, #e6e8ec)",
			boxShadow: dragging ? "var(--dp-shadow, 0 10px 30px rgba(0,0,0,.45))" : sel ? "0 0 0 3px var(--dp-ac-soft, rgba(47,111,235,.16))" : hov ? "0 0 0 3px rgba(75,142,247,.16)" : "none",
			userSelect: "none", WebkitUserSelect: "none",
			display: "flex", flexDirection: "column", gap: 3, overflow: "visible",
			zIndex: dragging ? 9 : sel ? 5 : 1
		};
	},
	dot: (state) => ({
		position: "absolute", right: 6, top: 6, width: 7, height: 7, borderRadius: "50%",
		background: (STATE_KINDS[state] || STATE_KINDS.idle).color
	}),
	foot: {
		flex: "0 0 auto", borderTop: "1px solid var(--dp-line, #31343a)",
		background: "var(--dp-bg-1, #141519)", padding: "7px 10px", display: "flex", flexDirection: "column", gap: 6
	},
	input: {
		flex: 1, minWidth: 0, height: 30, boxSizing: "border-box",
		border: "1px solid var(--dp-line, #3d4148)", background: "var(--dp-bg-0, #1a1b20)",
		color: "var(--dp-t1, #e8eaed)", borderRadius: "var(--dp-radius-sm, 5px)",
		padding: "0 9px", fontSize: "calc(11.5px * var(--dp-font, 1))", fontFamily: "inherit"
	},
	btn: {
		height: 28, padding: "0 11px", borderRadius: "var(--dp-radius-sm, 5px)", cursor: "pointer",
		fontSize: "calc(11.5px * var(--dp-font, 1))", whiteSpace: "nowrap",
		border: "1px solid var(--dp-line, #3d4148)", background: "var(--dp-bg-2, #212429)",
		color: "var(--dp-t2, #c3c8ce)", display: "inline-flex", alignItems: "center", gap: 4
	},
	btnPri: {
		height: 30, padding: "0 13px", borderRadius: "var(--dp-radius-sm, 5px)", cursor: "pointer",
		fontSize: "calc(12px * var(--dp-font, 1))", border: "1px solid var(--dp-ac, #2f6bdd)",
		background: "var(--dp-ac, #2f6bdd)", color: "#fff", whiteSpace: "nowrap"
	},
	chip: {
		fontSize: "calc(10.5px * var(--dp-font, 1))", padding: "calc(2px * var(--dp-density, 1)) 7px",
		borderRadius: "var(--dp-radius-sm, 5px)", background: "var(--dp-ac-soft, rgba(47,111,235,.16))",
		border: "1px solid var(--dp-ac-line, rgba(47,111,235,.4))", color: "var(--dp-ac, #9fc2ff)", whiteSpace: "nowrap"
	},
	muted: { fontSize: "calc(10.5px * var(--dp-font, 1))", color: "var(--dp-t3, #6f757d)" }
};

/* ══════════════════════════════════════════════════════════════════
 *  组件
 *  ⚠️ 几何 / 文案类的**纯函数**（连线路径、徽标行、拖动换算、单框控件）
 *     在 logic/mindmap-render.js 与 store/mindmap-schema.js —— 那两个文件
 *     不 import react，故离线测试能直接跑（组件文件 import 了 react，Node 进不来）。
 * ══════════════════════════════════════════════════════════════════ */

export function MindMap({ open, onClose }) {
	/* ── 🔴 全部 hooks 必须在 `if (!open) return null` 之前 ────────── */
	const [snap, setSnap] = react.useState(() => getBranchSnapshot());
	const [sel, setSel] = react.useState(null);
	/** 右侧对话面板要显示的框（null = 面板关闭，画布铺满） */
	const [detailId, setDetailId] = react.useState(null);
	const [draft, setDraft] = react.useState("");
	const [routeResult, setRouteResult] = react.useState(null);
	const [review, setReview] = react.useState(null);
	const [toast, setToast] = react.useState("");
	const [inset, setInset] = react.useState(() => readInset());
	const [collapsed, setCollapsed] = react.useState(() => new Set());
	/* 分支链路聚焦（R9）：focusId=被聚焦的会话；focusUp=「含上一层」（祖先层全景） */
	const [focusId, setFocusId] = react.useState(null);
	const [focusUp, setFocusUp] = react.useState(false);
	/* 总览弹窗（R10）：挂在导图最上面，独立 fixed 层 */
	const [ovOpen, setOvOpen] = react.useState(false);
	const [hov, setHov] = react.useState(null);
	const [menu, setMenu] = react.useState(null);
	const [q, setQ] = react.useState("");
	const [k, setK] = react.useState(1);
	const [view, setView] = react.useState({ sl: 0, st: 0, cw: 0, ch: 0 });
	const [pOpen, setPOpen] = react.useState(false);
	/** 拖动中的实时位置（只在拖动期间存在；松手才写 store ⇒ 不每帧写盘） */
	const [dragPos, setDragPos] = react.useState(null);
	/** 当前宿主会话（决定右侧面板"原生内容能不能读"） */
	const [curId, setCurId] = react.useState(null);

	const lay = react.useSyncExternalStore(
		(fn) => directorLayoutStore.subscribe(fn),
		() => directorLayoutStore.getState(),
		() => directorLayoutStore.getState()
	);
	const pz = react.useSyncExternalStore(
		(fn) => personalizeStore.subscribe(fn),
		() => personalizeStore.getState(),
		() => personalizeStore.getState()
	);
	const flowSnap = react.useSyncExternalStore(
		(fn) => flowStore.subscribe(fn),
		() => flowStore.getState(),
		() => flowStore.getState()
	);

	const bodyRef = react.useRef(null);
	const searchRef = react.useRef(null);
	const fittedRef = react.useRef(false);
	const toastTimer = react.useRef(null);
	const dragRef = react.useRef(null);
	/** 🔴 拖动中的实时位置（与 `dragPos` 同步写）—— 松手时要**在 React 更新函数之外**
	 * 读到它，见 `onUp` 里的"渲染期副作用"事故说明。 */
	const dragPosRef = react.useRef(null);
	/** 「刚拖过」标记：拖动结束时置位一拍，避免拖完又被当成点击而弹出右侧面板 */
	const justDraggedRef = react.useRef(false);

	react.useEffect(() => {
		if (!open) return undefined;
		/* 🔴 顺序不可颠倒：**先订阅、再同步取一次、最后才发起刷新**。
		 *    `refreshBranchTree()` 是 async 函数，但走 ctx.sessions 通道时**没有 await**
		 *    ⇒ 它会在**同一轮同步执行**里就 `notify()`。若先 refresh 后 subscribe，
		 *    那次通知发生在订阅之前 ⇒ 首次打开时组件永远停在初始快照。
		 *    ⇒ 教训：**订阅类 API 必须先挂订阅再触发事件**，不要依赖"事件一定是异步的"。 */
		const off = subscribeBranch(setSnap);
		setSnap(getBranchSnapshot());
		refreshBranchTree().catch(() => { });
		return off;
	}, [open]);

	react.useEffect(() => watchInset(setInset), []);
	/* 跟随宿主当前会话（左栏点会话时插件收不到事件 ⇒ 轮询单字段）
	 * 用户：「我点击左侧，点入不同的对话切进去就是和当前对话有关的流转信息」 */
	react.useEffect(() => {
		if (!open) return undefined;
		return watchCurrentSession((id) => { setCurId(id); if (id) flowStore.setActiveSession(id); });
	}, [open]);

	/* 打开时自动适应一次（幂等：同一次打开只做一次，避免与用户的缩放打架） */
	react.useEffect(() => {
		if (!open) { fittedRef.current = false; return undefined; }
		if (fittedRef.current) return undefined;
		fittedRef.current = true;
		const t = setTimeout(() => { doFit(true); }, 60);
		return () => clearTimeout(t);
	}, [open]);

	/* 视口尺寸变化时刷新 view（驱动 stageWrap 的居中 margin 跟随重算），不依赖用户滚动/再点适应 */
	react.useEffect(() => {
		if (!open) return undefined;
		const el = bodyRef.current;
		if (!el || typeof ResizeObserver === "undefined") return undefined;
		const ro = new ResizeObserver(() => { syncView(); });
		ro.observe(el);
		return () => ro.disconnect();
	}, [open]);

	/* V17 P3：跨界面流转同步反馈 —— 导图覆盖层打开期间，别的维度把一条消息送到思维导图时
	 * 轻提示「已同步到思维导图」（自己发起的不提示；首次挂载把历史当已读，不翻旧账）。 */
	const syncSeenRef = react.useRef(lastFlowIdFor(flowSnap.flows, DIM.MINDMAP));
	react.useEffect(() => {
		const flows = flowSnap.flows;
		const latest = lastFlowIdFor(flows, DIM.MINDMAP);
		if (!open) { syncSeenRef.current = latest; return; } // 关闭期（组件隐藏不卸载）只追基线、不提示，避免一打开就弹旧账
		if (latest && latest !== syncSeenRef.current) {
			syncSeenRef.current = latest;
			const f = flows.find((x) => x.flowId === latest);
			if (f && flowOrigin(f) && flowOrigin(f) !== DIM.MINDMAP) say("已同步到思维导图");
		} else if (!latest) {
			syncSeenRef.current = null;
		}
	}, [flowSnap, open]);

	/* V17 P2 发现性：首次打开导图给一次操作引导（只点真实存在的操作：悬浮工具条 / 右键菜单），localStorage 只提示一次 */
	react.useEffect(() => {
		if (!open) return undefined;
		let shown = false;
		try { shown = localStorage.getItem("dsh.director.mm.hint.shown") === "1"; } catch (e) { /* 隐私模式每次提示可接受 */ }
		if (shown) return undefined;
		const t = setTimeout(() => {
			try { localStorage.setItem("dsh.director.mm.hint.shown", "1"); } catch (e) { /* 忽略 */ }
			say("悬浮节点出快捷工具条 · 右键节点看全部操作");
		}, 650);
		return () => clearTimeout(t);
	}, [open]);

	react.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

	/* 键盘：Esc 逐层退（个性化 → 菜单 → 右侧面板 → 导图）· Ctrl+0/=/- 缩放 · Ctrl+F 搜索 */
	react.useEffect(() => {
		if (!open) return undefined;
		const onKey = (e) => {
			if (e.key === "Escape") {
				if (pOpen) { setPOpen(false); e.preventDefault(); return; }
				if (menu) { setMenu(null); e.preventDefault(); return; }
				if (detailId) { setDetailId(null); e.preventDefault(); return; }
				onClose();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key === "0") { e.preventDefault(); setK(1); say("已回到 100%（1:1）"); return; }
			if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_")) { e.preventDefault(); zoom(-0.1); return; }
			if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoom(0.1); return; }
			if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
				e.preventDefault();
				if (searchRef.current) searchRef.current.focus();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open, menu, detailId, pOpen, onClose]);

	/* 拖动：window 级监听（指针移出画布也不丢）
	 * 🔴 松手才写 store（拖动过程只改本地 state）—— 每帧写 localStorage 会卡。 */
	react.useEffect(() => {
		if (!open) return undefined;
		const onMove = (e) => {
			const d = dragRef.current;
			if (!d) return;
			const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
			if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
			d.moved = true;
			const p = { id: d.id, x: Math.max(0, d.ox + dx / (k || 1)), y: Math.max(0, d.oy + dy / (k || 1)) };
			dragPosRef.current = p;                 // 松手时在 React 之外读它（见 onUp）
			setDragPos(p);
		};
		const onUp = () => {
			const d = dragRef.current;
			dragRef.current = null;
			if (!d) return;
			/* 🔴 2026-09-16 渲染进程被钉死的**真正**根因（真机逐事件计时取证）：
			 *   旧写法把"写 store + 弹 toast"放在了 `setDragPos((cur) => {...})` 的**更新函数里**。
			 *   更新函数是在 React 的**渲染期**被调用的，于是 `setNodePos()` 也在渲染期执行 ⇒
			 *   本组件用 `useSyncExternalStore` 订阅了同一个 store ⇒ 渲染期收到新快照 ⇒
			 *   再渲染、再进更新函数、再写 store …… **渲染循环**。
			 *   实测（logs/drag-cost-streaming.log，`scripts/_probe-drag-cost.mjs`）：
			 *     悬停 6 次鼠标移动合计 75ms、拖动中 6 次合计 91ms（**都正常**），
			 *     而 `mouseReleased` **超时 30,000ms**，此后 Runtime.evaluate 也再也读不到页面
			 *     —— 与"拖动过程"无关，**松手那一下**就是卡死点。
			 *   用 Debugger.pause 中断 V8 取到的栈也印证：整栈都是 React 自身的工作循环。
			 *   ⇒ 纪律：**状态更新函数必须是纯的**，副作用一律移到外面（这里改用 ref 读实时位置）。 */
			const cur = dragPosRef.current;
			dragPosRef.current = null;
			if (cur && cur.id === d.id) {
				directorLayoutStore.setNodePos(d.id, { x: cur.x, y: cur.y });
				say("已移动「" + String(d.title || "").slice(0, 12) + "」—— 位置已记住（「自动布局」可归位）");
			}
			setDragPos(null);
			/* 拖过就不算点击（否则每次拖完都会弹出右侧面板） */
			if (d.moved) {
				justDraggedRef.current = true;
				setTimeout(() => { justDraggedRef.current = false; }, 0);
				setSel(d.id);
			}
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
	}, [open, k]);

	if (!open) return null;

	/* ── 数据派生（纯计算，非 hooks，可安全放在早退之后） ── */
	const tree = snap.tree || { rows: [], edges: [], byId: {} };
	const baseRows = tree.rows || [];
	/* 位置叠加：store 里存的（用户拖过的）+ 拖动中的实时位置。
	 * ⚠️ 这里**故意不用 useMemo**：它必须与 `if (!open) return null` 的相对位置保持一致，
	 *    而 hooks 绝不能排在早退之后（本项目在 DesignStudio 上吃过一次整层崩溃）。
	 *    纯数组映射的代价可以忽略，稳定性更重要。 */
	const posMap = dragPos
		? { ...(lay.mmPos || {}), [dragPos.id]: { x: dragPos.x, y: dragPos.y } }
		: (lay.mmPos || {});
	const hasPos = Object.keys(posMap).length > 0;
	const rows = hasPos
		? baseRows.map((r) => {
			const p = posMap[r.sessionId];
			if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return r;
			return { ...r, x: p.x, y: p.y, moved: true };
		})
		: baseRows;

	/* ── 折叠计数：必须按**当前树里真的存在**的节点算 ────────────────────
	 * 🔴 为什么不能直接用 `collapsed.size`（2026-09-12 真机定案）：
	 *   `collapsed` 是组件 state，而本组件**不随树变化而卸载**（切会话 / 换数据后原地重渲），
	 *   于是里面会留着**旧树的 sessionId**。此时 `collapsed.size > 0` 但渲染出来的
	 *   `[data-collapsed=1]` 节点数是 **0** —— 两边对不上，后果是用户点「折叠全部」
	 *   得到一句「已展开全部」而画布毫无变化（正是用户反复投诉的「点了像没点」）。
	 *   真机证据（verify-mindmap r14/r15，同一份代码两次不同表现）：
	 *     r15 点了之后 toast=「已展开全部」而 DOM 里 `[data-collapsed=1]` = 0；
	 *     r14 点击后按钮文案停在「展开全部」⇒ C-M9b 红。
	 *   这是本项目**同一类缺陷的第四次**（r5tab 页签 / 导图 focusId / nd-panel 开关 /
	 *   本处 collapsed）：跨轮存活的组件 state，读取前必须先与当前数据对账。
	 *   ⇒ 纪律统一为：**派生值只从当前数据推**，不读可能过期的容器。
	 *       且必须从**当前可见的**那一份推（见下 `winRows`）—— 作用在看不见的节点上
	 *       等于"点了没反应"，这正是用户反复投诉的形态。 */
	/* ── 分支链路聚焦（用户需求 R9）──────────────────────────────
	 * 「我点击对话那么只默认显示这个分支的链路，然后可以选是否包含上一层，
	 *   如果有下一层可以往下一层走。」
	 * 应用顺序：**先聚焦、后折叠** —— 折叠只作用于已经可见的集合，
	 * 两套开关互不干扰（先折叠再聚焦会让"被折叠的节点"偷偷回到视野里）。 */
	const focus = focusRows(rows, focusId, { includeParents: focusUp });
	const focusDownOk = focusId ? hasDownstream(rows, focusId) : false;

	const winRows = visibleRows(focus.rows, collapsed);
	/* 🔴 2026-09-12 第二次定案（verify-mindmap r16/r17 C-M9a 连红）：
	 *   上一版只把"陈旧 id"修掉了，但**基数仍然取错** —— 用的是 `rows`（全部血缘行），
	 *   而画布渲染的是 `winRows`（聚焦 + 折叠之后**真正可见**的那一份）。
	 *   聚焦态下 `winRows ⊊ rows`，于是「折叠全部」会去折一个**看不见的**节点：
	 *   库里的数据对了、toast 也报了"已折叠 1 棵子树"、按钮文案翻了「展开全部」——
	 *   **而画布上什么都没发生**。用户视角就是坏的（点了像没点）。
	 *   实测证据：r16/r17 `{"allCollapsed":0(DOM),"allToast":"已折叠 1 棵子树",
	 *   "collapsibleNonRoot":0}` —— DOM 里 `data-collapsed=1` 是 0，而文案说折了 1 棵。
	 *   ⇒ 判据统一为：**动作与计数都只看 `winRows`**（所见即所折）。 */
	const collapsedLive = winRows.filter((r) => collapsed.has(r.sessionId)).length;
	const collapsibleLive = winRows.filter((r) => r.depth > 0 && r.childrenCount > 0).length;
	const bounds = treeBounds(winRows);
	// treeBounds 的 w/h 用 min(minW/minH, …) 做了**封顶**（其注释本意是"节点超出要撑大"，实现却夹了上限），
	// 33 节点链式树逻辑高约 2708 > minH 1600 时 bounds 会偏小。这里按 winRows 重算**未封顶**的真实内容尺寸，
	// 保证长树底部节点装得进 stage/wrap（否则 overflow:hidden 会裁掉、滚不到）。bounds 仍保留给 doFit 缩放比例。
	let realMaxX = 0, realMaxY = 0;
	for (const rr of winRows) {
		realMaxX = Math.max(realMaxX, rr.x + LAYOUT.nodeW);
		realMaxY = Math.max(realMaxY, rr.y + LAYOUT.nodeH);
	}
	const contentW = Math.max(bounds.x + bounds.w, realMaxX + LAYOUT.pad);
	const contentH = Math.max(bounds.y + bounds.h, realMaxY + LAYOUT.pad);
	const stageW = Math.max(LAYOUT.minW, contentW);
	const stageH = Math.max(LAYOUT.minH, contentH);
	// 滚动/居中容器贴合**真实可见包围盒**（不顶 minW、也不被 minH 封顶）：窄长树 fit 后由动态 margin 居中，
	// 长树放大后底部节点仍可滚入视口。绘制舞台 stageW/H 保留 minW 兜底（SVG 连线/小地图整棵树缩略用）。
	const wrapW = Math.max(contentW, 320);
	const wrapH = Math.max(contentH, 240);
	const matches = matchRows(rows, q);
	const chain = ancestorChain(rows, sel);
	const caps = hostCapabilities();
	const cov = coverageStats();
	const selNode = sel ? rows.find((r) => r.sessionId === sel) : null;
	const detailNode = detailId ? rows.find((r) => r.sessionId === detailId) : null;
	const hovNode = hov ? winRows.find((r) => r.sessionId === hov) : null;
	const visibleIds = new Set(winRows.map((r) => r.sessionId));
	const movesCount = Object.keys(lay.mmPos || {}).length;
	const reason = degradationReason();
	const posOf = (id) => rows.find((r) => r.sessionId === id);
	const selFlows = sel ? flowStore.ofSession(sel) : [];

	/* ── toast（自动消失；pointerEvents:none 不挡点击） ── */
	function say(msg) {
		setToast(msg);
		if (toastTimer.current) clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToast(""), TOAST_MS);
	}



	/* ── 视野同步（小地图用；滚动/缩放后量一次） ── */
	function syncView() {
		const el = bodyRef.current;
		if (!el) return;
		setView({ sl: el.scrollLeft, st: el.scrollTop, cw: el.clientWidth, ch: el.clientHeight });
	}

	/* ── 缩放（以视野中心为锚，避免"缩完目标跑出屏幕"） ── */
	function zoom(delta, absolute) {
		const el = bodyRef.current;
		const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, absolute !== undefined ? absolute : k + delta));
		if (!el) { setK(next); return; }
		const cx = (el.scrollLeft + el.clientWidth / 2) / k;
		const cy = (el.scrollTop + el.clientHeight / 2) / k;
		setK(next);
		requestAnimationFrame(() => {
			const e2 = bodyRef.current;
			if (!e2) return;
			e2.scrollLeft = Math.max(0, cx * next - e2.clientWidth / 2);
			e2.scrollTop = Math.max(0, cy * next - e2.clientHeight / 2);
			syncView();
		});
	}

	/* ── 适应屏幕（对**可见行**的包围盒，幂等 —— 已在视野内时只回文案） ── */
	function doFit(silent) {
		const el = bodyRef.current;
		if (!el || !winRows.length) { if (!silent) say("没有可适应的节点"); return; }
		const cw = el.clientWidth, ch = el.clientHeight;
		if (!cw || !ch) { if (!silent) say("画布尚未布局完成，请稍后再试"); return; }
		// 用**未封顶**的真实内容尺寸 contentW/H 算缩放（bounds.h 被 minH 封顶会让长树 fit 后仍溢出）；
		// 但不低于 FIT_MIN：超长链保留可读性，放不下的方向滚动而非无限缩小。
		const next = Math.max(FIT_MIN, Math.min(1.4, Math.min(cw / contentW, ch / contentH) * 0.96));
		setK(next);
		requestAnimationFrame(() => {
			const e2 = bodyRef.current;
			if (!e2) return;
			// 内容缩放后放得下 ⇒ 滚动归零，交给动态 margin 居中；被 FIT_MIN 夹住仍放不下才滚到包围盒左上
			e2.scrollLeft = contentW * next <= cw ? 0 : Math.max(0, bounds.x * next - 8);
			e2.scrollTop = contentH * next <= ch ? 0 : Math.max(0, bounds.y * next - 8);
			syncView();
			if (!silent) say("已适应：可见 " + winRows.length + " 个节点 · " + Math.round(next * 100) + "%");
		});
	}

	/* ── 节点动作（**只有有真实接口的**才出现在 UI 上） ── */
	async function actOpen(id) {
		setMenu(null);
		const r = await openSession(id);
		say(r.ok ? "已切到该分支的原生对话" : ("打开失败：" + r.reason));
	}

	async function actFork(id) {
		setMenu(null);
		if (!caps.fork) { say("fork 不可用：宿主未提供 sessions.fork"); return; }
		say("正在 fork…");
		const r = await forkBranch(id);
		if (r.ok) { setSel(r.sessionId); say("已创建子分支 " + String(r.sessionId).slice(-8)); }
		else say("fork 失败：" + r.reason);
	}

	/** 抓取原生对话区的真实产出（`readConversation` 是**唯一**守规通道：
	 *  走语义锚点找消息列表，不猜类名。找不到就如实报"未找到"，不编内容）。 */
	function grabText() {
		const conv = readConversation();
		return {
			text: String((conv && conv.lastText) || "").trim(),
			count: (conv && conv.count) || 0,
			found: Boolean(conv && conv.listFound)
		};
	}

	function actGrab(id) {
		setMenu(null);
		setSel(id);
		const g = grabText();
		if (!g.found) { say("未找到原生对话区：请先在对话 tab（或分屏）里打开内容，再抓取"); return; }
		if (!g.text) { say("原生对话区有 " + g.count + " 项但正文为空 —— 不抓空内容占位"); return; }
		setDraft(g.text);
		flowStore.push(g.text, { origin: "mindmap", sessionId: id, note: "从原生对话区抓取" });
		say("已抓取最近产出（" + g.text.length + " 字符 / 共 " + g.count + " 项）到导图，交总监判断去向");
	}

	/** 送审核：对**抓到的真实文本**跑六维规则引擎（抓不到就如实报 ❌，不编内容） */
	function actReview(id) {
		setMenu(null);
		setSel(id);
		const g = grabText();
		const node = rows.find((r) => r.sessionId === id);
		const res = review6({
			goal: (node && node.title) || "",
			output: g.text,
			evidence: g.found ? [
				"血缘：parentId 取自宿主会话摘要",
				"状态：取自宿主 running / completed / pendingInteraction",
				"产出：原生对话区 " + g.count + " 项（语义锚点读取）"
			] : [],
			risks: []
		});
		setReview({ sessionId: id, ...res, chars: g.text.length, found: g.found });
		say(res.pass ? "六维审核：通过" : "六维审核：未通过（" + res.failed.length + " 项硬缺口）");
	}

	function toggleCollapse(id) {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});
	}

	function toggleAll() {
		/* 判据 = `collapsedLive`（**当前可见的**、真被标记的节点数），不是 `collapsed.size`
		 *（后者可能含旧树 / 不可见节点的 id ⇒ 会走"展开全部"分支，而画布上并没有折叠）。 */
		const has = collapsedLive > 0;
		if (has) { setCollapsed(new Set()); say("已展开全部"); return; }
		/* 只折叠**可见集合里**"有子且非根"的节点 —— 与画布渲染的是同一份 `winRows`。
		 * 根也折掉会让画布只剩一个节点，什么也看不出来。
		 * 🔴 用 `winRows` 而不是 `rows`：聚焦态下两者不等，拿 `rows` 会折到看不见的节点上，
		 *   用户点「折叠全部」后画布毫无变化（r16/r17 C-M9a 实测）。 */
		const ids = winRows.filter((r) => r.depth > 0 && r.childrenCount > 0).map((r) => r.sessionId);
		setCollapsed(new Set(ids));
		/* 「无事可做」也必须说话并说清原因 —— 用户反复投诉过「点了像没点」。 */
		say(collapsibleLive
			? "已折叠 " + ids.length + " 棵子树（点框内的 ▸ 可单独展开）"
			: "本层没有可折叠的子树（根节点不参与「折叠全部」，否则画布只剩一个节点）");
	}

	/* ── 流转：把一个动作登记进 flow store（四维共用的那一份） ──
	 * `sidHint` = 面板/节点自己的会话（否则用当前选中）。
	 * 🔴 hopTo 走的是"最新一条流转" ⇒ 必须按**同一会话**取，不能混到别会话的条目上。 */
	function onFlow(payload, sidHint) {
		if (!payload) return;
		const sid = sidHint !== undefined && sidHint !== null ? sidHint : (sel || null);
		if (payload.hopTo) {
			const list = flowStore.ofSession(sid);
			const latest = list.length ? list[list.length - 1] : null;
			if (latest) flowStore.move(latest.flowId, payload.hopTo, payload.note, { status: "routed", target: sid });
			return;
		}
		flowStore.push(payload.text, { origin: payload.origin, sessionId: sid, note: payload.note || "在导图发起" });
	}

	/* ── 底栏输入 → 总监路由（V16 C4「目标未定」支） ── */
	const doRoute = () => {
		const text = draft.trim();
		if (!text) return;
		const nodes = rows.map((r) => ({ id: r.sessionId, name: r.title, level: r.depth === 0 ? "root" : "session" }));
		const r = route(text, { nodes, currentNodeId: sel || null });
		setRouteResult(r);
		flowStore.push(text, { origin: "mindmap", sessionId: sel || null, note: "交总监判断去向（导图）" });
		say("总监已整理，待你确认去向");
		dshLog("mindmap", "导图底栏路由：" + r.decision.destination + " conf=" + r.decision.confidence);
	};
	const confirm = (dest) => {
		const latestSid = sel || null;
		const list = flowStore.ofSession(latestSid);
		const latest = list.length ? list[list.length - 1] : null;
		if (latest) flowStore.move(latest.flowId, dest === DESTINATION.DIRECT ? "director" : "chat", "确认去向：" + DESTINATION_LABEL[dest], { status: "routed" });
		say("已确认：" + DESTINATION_LABEL[dest] + "（" + (routeResult.subtasks || []).length + " 个子任务）");
		setRouteResult(null);
		setDraft("");
	};

	/* ── 菜单项定义（enabled 由宿主能力探测决定，disabled 必须写明缺什么） ── */
	const menuItems = menu ? [
		{ key: "open", icon: "📂", label: "打开此对话", enabled: caps.open, why: "宿主 sessions.open", run: () => actOpen(menu.id) },
		{ key: "detail", icon: "💬", label: "在右侧展开对话", enabled: true, why: "插件侧面板，不依赖宿主写接口", run: () => { setMenu(null); setDetailId(menu.id); } },
		{ key: "fork", icon: "➕", label: "从此处分支（fork）", enabled: caps.fork, why: "宿主 sessions.fork", run: () => actFork(menu.id) },
		{ key: "grab", icon: "📥", label: "抓取信息到总监", enabled: true, why: "读原生对话区（bridge/chat-bridge）", run: () => actGrab(menu.id) },
		{ key: "review", icon: "🎯", label: "送交审核（六维）", enabled: true, why: "对抓到的真实文本跑 review6", run: () => actReview(menu.id) },
		{ sep: true },
		{ key: "locate", icon: "✥", label: "归位（回自动布局）", enabled: Boolean(posMap[menu.id]), why: "该框已被你拖过；未拖过的框本来就在自动布局位", run: () => { directorLayoutStore.clearNodePos(menu.id); setMenu(null); say("已归位该框"); } },
		{ key: "merge", icon: "🔀", label: "合并回父", enabled: false, why: "宿主 sessions 服务未暴露合并接口（取证：SessionRuntime 成员表只有 create/fork/open/search/refresh）" },
		{ key: "remove", icon: "✂️", label: "删除分支", enabled: false, why: "宿主 sessions 服务未暴露删除接口 —— 不接一个假按钮" }
	] : null;

	const padRight = Math.max(10, inset + 10);

	return h("div", {
		id: MINDMAP_ID, style: S.root, "data-testid": "mm-root", role: "dialog", "aria-label": "分支导图",
		"data-inset": inset, "data-lineage": snap.lineage ? "1" : "0", "data-source": snap.source || "none",
		"data-detail": detailId ? "1" : "0", "data-moved": String(movesCount), "data-edge": pz.edge,
		className: "dp-textured dp-overlay-in",
		onClick: () => { if (menu) setMenu(null); }
	}, [
		/* ── 顶栏（⚙ 个性化 + ✕ 都落在窗口控件安全区左侧） ── */
		h("div", { key: "t", style: { ...S.top, paddingRight: padRight }, "data-testid": "mm-top" }, [
			h("span", { key: "a", style: { fontWeight: 650 } }, "🧠 分支导图"),
			h("span", { key: "dom", className: "dp-domain map", "data-testid": "mm-domain" }, "❖ 导图"),
			h("span", {
				key: "s", style: S.chip, "data-testid": "mm-source",
				title: snap.lineage
					? "血缘来自宿主 ctx.sessions.list.getSnapshot()（parentId）"
					: ("已降级为「按工作区分组的平铺树」。原因：" + reason)
			}, snap.lineage ? "血缘：ctx.sessions ✔" : "血缘不可用（分组树）"),
			h("span", { key: "c", style: S.muted, "data-testid": "mm-count" },
				"分支 " + rows.length + " · 连线 " + (tree.edges || []).length +
				(collapsedLive ? " · 折叠 " + collapsedLive : "") +
				(movesCount ? " · 移动 " + movesCount : "")),
			curId ? h("span", { key: "cur", style: S.muted, "data-testid": "mm-current-chip", title: "宿主当前会话（左栏点了哪个就跟着变）" },
				"当前会话 …" + String(curId).slice(-8)) : null,

			h("button", {
				key: "ov", style: { ...S.btn, marginLeft: "auto" }, "data-testid": "mm-overview",
				title: "项目总览：已完成 / 待完成",
				onClick: () => setOvOpen(true)
			}, "▤ 总览"),
			h("button", {
				key: "p", style: S.btn, "data-testid": "mm-personalize",
				title: "个性化设定：主色 / 质感 / 密度 / 字号 / 圆角 / 连线（四处共用同一份）",
				onClick: () => setPOpen((v) => !v)
			}, "⚙ 个性化"),
			h("button", {
				key: "r", style: S.btn, "data-testid": "mm-refresh",
				onClick: () => { refreshBranchTree().catch(() => { }); say("已重读血缘快照"); }
			}, "↻ 刷新"),
			h("button", {
				key: "x", style: S.btn, "data-testid": "mm-close", "aria-label": "关闭分支导图",
				title: "关闭（Esc 逐层退：先关个性化 → 菜单 → 右侧面板）", onClick: onClose
			}, "✕")
		]),

		/* ── 工具条（设计稿 A4 .mtools：左树操作 / 右状态图例） ── */
		h("div", { key: "tl", style: { ...S.tools, paddingRight: padRight }, "data-testid": "mm-tools" }, [
			h("span", { key: "t0", style: { fontSize: "calc(11.5px * var(--dp-font,1))", fontWeight: 600, color: "var(--dp-ac2, #c9b0ff)" }, "data-testid": "mm-tree-title" },
				"⑂ 分支树 · " + (rows[0] ? rows[0].title : "（无会话）")),

			h("button", {
				key: "fork", style: { ...S.btn, opacity: caps.fork ? 1 : 0.5 }, "data-testid": "mm-new-fork",
				title: caps.fork ? "从当前选中的分支 fork（宿主 sessions.fork）" : "不可用：宿主未提供 sessions.fork",
				onClick: () => {
					const target = sel || (rows[0] && rows[0].sessionId);
					if (!target) { say("没有可 fork 的源会话"); return; }
					actFork(target);
				}
			}, "＋ 新建分支"),

			h("button", {
				key: "ca", style: S.btn, "data-testid": "mm-collapse-all",
				title: collapsedLive ? "展开全部子树" : "折叠全部有子的非根节点",
				onClick: toggleAll
			}, collapsedLive ? "🗖 展开全部" : "🗂 折叠全部"),

			h("button", {
				key: "al", style: { ...S.btn, opacity: movesCount ? 1 : 0.5 }, "data-testid": "mm-auto-layout",
				title: movesCount ? ("把 " + movesCount + " 个被你拖过的框放回自动布局") : "当前没有拖过的框（都在自动布局位）",
				onClick: () => {
					if (!movesCount) { say("没有拖过的框（拖动任一框后本按钮才有效）"); return; }
					directorLayoutStore.resetNodePos();
					say("已归位 " + movesCount + " 个框（回到自动布局）");
				}
			}, "▦ 自动布局"),

			h("button", {
				key: "fit", style: S.btn, "data-testid": "mm-fit", title: "把整棵可见血缘树缩进视野", onClick: () => doFit(false)
			}, "🔍 适应"),

			h("span", { key: "zs", style: { display: "inline-flex", alignItems: "center", gap: 4 } }, [
				h("button", { key: "o", style: S.btn, "data-testid": "mm-zoom-out", "aria-label": "缩小", title: "缩小 10%（Ctrl+-）", onClick: () => zoom(-0.1) }, "－"),
				h("span", {
					key: "v", "data-testid": "mm-zoom", "aria-live": "polite",
					/* 锁宽：`95%`(3 字) ↔ `100%`(4 字) 差 6px，会把右边的按钮推着走 */
					style: { ...S.muted, display: "inline-block", minWidth: 40, textAlign: "center", boxSizing: "border-box" }
				}, Math.round(k * 100) + "%"),
				h("button", { key: "i", style: S.btn, "data-testid": "mm-zoom-in", "aria-label": "放大", title: "放大 10%（Ctrl+=）", onClick: () => zoom(0.1) }, "＋"),
				h("button", { key: "1", style: S.btn, "data-testid": "mm-zoom-100", "aria-label": "回到 100%", title: "回到 100% 真实像素（Ctrl+0）", onClick: () => { setK(1); say("已回到 100%（1:1）"); } }, "1:1")
			]),

			h("input", {
				key: "q", ref: searchRef, style: { ...S.input, width: 168, flex: "0 0 auto" }, "data-testid": "mm-search",
				placeholder: "搜索标题 / 会话号（Ctrl+F）", value: q, onChange: (e) => setQ(e.target.value),
				title: "命中节点高亮，未命中节点淡出"
			}),
			matches ? h("span", { key: "qm", style: S.muted, "data-testid": "mm-search-hits" }, "命中 " + matches.size) : null,

			/* 状态图例 —— 只列**有数据源**的态，且可由个性化关掉 */
			pz.legend ? h("span", { key: "lg", style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }, "data-testid": "mm-legend" },
				supportedStates().map((s) => h("span", {
					key: s.key, style: { ...S.muted, display: "inline-flex", alignItems: "center", gap: 3 }, title: s.label + " —— " + s.from
				}, [h("span", {
					key: "d", style: { width: 7, height: 7, borderRadius: "50%", background: s.color, display: "inline-block" }
				}), h("span", { key: "l" }, s.label)]))) : h("span", { key: "lg0", style: { marginLeft: "auto" } }),

			h("span", {
				key: "cov", style: S.muted, "data-testid": "mm-coverage",
				title: "元素覆盖度（详见 store/mindmap-schema.js MM_COVERAGE）"
			}, "元素 " + cov.done + "/" + cov.total)
		]),

		/* ── 聚焦条（R9）：只在真正聚焦时出现，不聚焦不占位 ── */
		focus.applied ? h("div", {
			key: "fobar", style: { ...S.tools, paddingRight: padRight }, "data-testid": "mm-focusbar",
			"data-focus-id": focusId || "", "data-focus-up": focusUp ? "1" : "0",
			"data-focus-down": focusDownOk ? "1" : "0"
		}, [
			h("span", { key: "t", style: S.chip, "data-testid": "mm-focus-title" },
				"聚焦 " + String((rows.find((r) => r.sessionId === focusId) || {}).title || "该分支").slice(0, 18)),
			h("span", { key: "s", style: S.muted, "data-testid": "mm-focus-stats" },
				"下游 " + (focus.stats.down + 1) + " · 上游 " + focus.stats.up),
			h("button", {
				key: "u", "data-testid": "mm-focus-up", "data-on": focusUp ? "1" : "0",
				style: { ...S.btn, borderColor: focusUp ? "var(--dp-ac, #2f6feb)" : undefined },
				title: "含上一层", onClick: () => setFocusUp((v) => !v)
			}, (focusUp ? "☑" : "☐") + " 含上一层"),
			focusDownOk ? h("span", { key: "d", style: S.muted, "data-testid": "mm-focus-down" }, "▸ 可下钻（点子节点）") : null,
			h("button", {
				key: "x", "data-testid": "mm-focus-exit", style: S.btn, title: "退出聚焦，显示全部",
				onClick: () => { setFocusId(null); setFocusUp(false); say("已退出聚焦"); }
			}, "退出聚焦")
		]) : null,

		/* ── 主区：画布 + 右侧对话面板 ── */
		h("div", { key: "main", style: S.main }, [
			h("div", { key: "cw", style: S.canvasWrap, className: "dp-textured" }, [
				h("div", {
					key: "b", style: S.body, ref: bodyRef, "data-testid": "mm-body", className: "dp-scroll",
					onScroll: syncView, onPointerDown: () => { if (menu) setMenu(null); }
				},
				h("div", { key: "w", style: {
					...S.stageWrap, width: wrapW * k, height: wrapH * k,
					marginLeft: Math.max(0, (view.cw - wrapW * k) / 2),
					marginTop: Math.max(0, (view.ch - wrapH * k) / 2)
				} }, [
					h("div", {
						key: "s", style: { ...S.stage, width: stageW, height: stageH, transform: "scale(" + k + ")" },
						"data-testid": "mm-stage", "data-zoom": k
					}, [
						/* 连线：主干实线 / 分支虚线 / 选中链高亮（形状由个性化设定决定） */
						h("svg", {
							key: "svg", width: stageW, height: stageH,
							style: { position: "absolute", left: 0, top: 0, pointerEvents: "none" }, "data-testid": "mm-edges"
						}, (tree.edges || []).map((e, i) => {
							const a = posOf(e.from), b = posOf(e.to);
							if (!a || !b) return null;
							if (!visibleIds.has(e.to)) return null;   // 折叠隐藏的子边不画
							const p = edgePathFor(a, b, b.depth, chain.has(e.from) && chain.has(e.to), pz.edge);
							return h("path", { key: i, d: p.d, style: edgeStyleOf(p.kind), "data-edge-kind": p.kind });
						})),

						/* 节点（含单框控件 —— 见 store/mindmap-schema.js NODE_CONTROLS） */
						winRows.map((r) => {
							const st = r.state;
							const kind = NODE_KINDS[r.kind] || NODE_KINDS.leaf;
							const dim = matches && !matches.has(r.sessionId);
							const hit = matches && matches.has(r.sessionId);
							const isOpen = detailId === r.sessionId;
							const ctrls = controlsOfRow({ ...r, collapsed: collapsed.has(r.sessionId) }, caps);
							const cToggle = ctrls.find((c) => c.key === "toggle");
							const cDetail = ctrls.find((c) => c.key === "detail");
							const cFork = ctrls.find((c) => c.key === "fork");
							const cOpen = ctrls.find((c) => c.key === "open");
							return h("div", {
								key: r.sessionId,
								style: {
									...S.node(sel === r.sessionId, hov === r.sessionId, r.kind, dragPos && dragPos.id === r.sessionId),
									left: r.x, top: r.y,
									opacity: dim ? 0.32 : 1,
									outline: hit ? "2px solid #d29922" : (isOpen ? "2px solid var(--dp-ac, #2f6feb)" : "none"),
									outlineOffset: hit || isOpen ? 1 : 0
								},
								"data-testid": "mm-node", "data-session-id": r.sessionId, "data-state": st,
								"data-kind": r.kind, "data-depth": r.depth, "data-state-source": r.stateSource,
								/* 第 16 批：分流维度与标题来源 —— 用户原话「思维导图应该能看出来」。
								 * `data-split` 空串 = 这一支不是分流出来的（**空串不等于缺失**，
								 * 闸门按 `[data-split]` 非空计数即可，不必另设布尔位）。 */
								"data-split": r.splitDim || "", "data-title-origin": r.titleOrigin || "",
								/* 第 17 批：**总监派发**可见性 —— 用户原话「我需要在思维导图中看到这些」。
								 * 🔴 字段名与前一行 `data-state` 刻意**不同名**：`data-state` 是**血缘状态**
								 *    （宿主 running/blank 推导），这里是**派发状态**（本批台账）。同名不同义
								 *    会让闸门量错对象 —— 本项目台账（二）#8 就是这么连爆三条红的。
								 * 🔴 `data-said` 空串 = **确实没读到产出**（不是"未派发"）；
								 *    未派发的节点该字段也是空串 ⇒ 判"有没有产出"必须**先看 `data-dispatch` 非空**。 */
								"data-dispatch": r.dispatchId || "", "data-branch-state": r.dispatchState || "",
								"data-said": r.dispatchSay || "",
								/* 第 21 批：**会话档案**（R2/R3）可见性 —— 用户原话「（每个会话）都有自己的
								 * 总监，存在自己的会话总结文档」。字段由 `applyDossiers` 在**唯一摄取点**
								 * 写入，这里只做 DOM 投影（与 `data-split` / `data-dispatch` 同范式）。
								 * 🔴 `data-has-dossier` 是**独立布尔位**：只靠 `data-dossier-role` 的空串
								 *    分不出「没有档案」与「有档案但角色为空」——两者在闸门里必须可分。 */
								"data-has-dossier": r.hasDossier ? "1" : "0",
								"data-dossier-role": r.dossierRole || "",
								"data-dossier-summary": r.dossierSummary || "",
								"data-dossier-src": r.dossierSummarySrc || "",
								"data-dossier-reason": r.dossierSummaryReason || "",
								"data-collapsed": collapsed.has(r.sessionId) ? "1" : "0",
								"data-current": r.isCurrent ? "1" : "0",
								"data-moved": r.moved ? "1" : "0",
								"data-detail-open": isOpen ? "1" : "0",
								onMouseEnter: () => setHov(r.sessionId),
								onMouseLeave: () => setHov((p) => (p === r.sessionId ? null : p)),
								/* 拖动：在框体上按下即进入拖动（控件自己 stopPropagation，不会误触） */
								onPointerDown: (e) => {
									if (e.button !== 0) return;
									// 🔴 阻止原生文本选择/原生拖拽把主线程挂进桌面壳原生交互状态机（见 S.node userSelect 注释）
									e.preventDefault();
									dragRef.current = { id: r.sessionId, sx: e.clientX, sy: e.clientY, ox: r.x, oy: r.y, moved: false, title: r.title };
									setSel(r.sessionId);
								},
								onClick: (e) => {
									e.stopPropagation();
									setSel(r.sessionId);
									/* 拖过就不当点击（拖动结束时置位一拍，见 justDraggedRef） */
									if (justDraggedRef.current) return;
									setDetailId(r.sessionId);
									/* 同时进入「链路聚焦」（R9）：只看这一支及其上下游 */
									setFocusId(r.sessionId);
								},
								onContextMenu: (e) => {
									e.preventDefault(); e.stopPropagation();
									const box = bodyRef.current ? bodyRef.current.getBoundingClientRect() : { left: 0, top: 0 };
									setMenu({ id: r.sessionId, x: e.clientX - box.left + bodyRef.current.scrollLeft, y: e.clientY - box.top + bodyRef.current.scrollTop });
									setSel(r.sessionId);
								},
								title: r.sessionId + (r.parentSessionId ? " ← 父 " + r.parentSessionId : "（根/中心主题）") +
									"｜" + stateTitleOf(r) +
									/* 第 21 批：**会话档案**（R2/R3）—— 用户原话「（每个会话）都有自己的总监，
									 * 存在自己的会话总结文档」。角色走第 2 行（可见），总结走 title（不挤布局）；
									 * 读不到时写**原因**而不是留白（纪律 18/58）。 */
									(r.hasDossier ? "｜档案 · 总监 " + (r.dossierRole || "（未记）")
										+ " · 总结 " + (r.dossierSummary || (r.dossierSummaryReason ? "（无：" + r.dossierSummaryReason + "）" : "（空）")) : "") +
									"｜点框=右侧展开对话 · 按住拖动=移动 · 右键=菜单"
							}, [
								/* 第 1 行：类型图标 + 标题 + 状态点 */
								h("div", {
									key: "r1",
									style: { display: "flex", alignItems: "center", gap: 4, fontSize: "calc(11.5px * var(--dp-font,1))", fontWeight: 600, minWidth: 0 }
								}, [
									h("span", { key: "i", style: { flex: "0 0 auto", color: kind.accent } }, kind.icon),
									h("span", {
										key: "n", style: { flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
									}, r.title),
									h("span", { key: "d", style: { ...S.dot(st), position: "static", flex: "0 0 auto" }, "data-testid": "mm-dot" })
								]),
								/* 第 2 行：有据徽标（取不到就不写"未知"，退回深度） */
								h("div", {
									key: "r2", style: { fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
									"data-testid": "mm-node-meta"
								}, metaLineOf(r) + (r.splitDim ? " · 分流 " + r.splitDim : "") + (r.moved ? " · 已移动" : "")
									/* 第 21 批 R2：**该会话归哪个总监管**直接写在第 2 行（可见位）。
									 * 只挂 data 属性等于用户看不见（"闸门绿 ≠ 用户能验收"：纪律 57）。
									 * 🔴 `dossierRole` 形如 `A6 打磨 总监`（已自带"总监"后缀）⇒ 这里**不再前置**"总监"，
									 *    否则会渲染成 `总监 A6 打磨 总监`（第 21 批真机截图复核时发现）。 */
									+ (r.dossierRole ? " · " + r.dossierRole : "")
									+ (r.dispatchId ? " · 派发 " + (r.dispatchState || "unknown") : "")),
								/* 第 3 行（仅派发分支有）：**产出摘要**或**读不到的原因**。
								 * 🔴 读不到时**不许留空、也不许编**：写出 `dispatchSayReason`。
								 *    只给有产出的节点加行 ⇒ 读图人会以为"没产出的那几条没派发过" —— 那是错的信息。 */
								r.dispatchId ? h("div", {
									key: "r2b",
									style: {
										fontSize: "calc(10px * var(--dp-font,1))", marginTop: 1,
										color: r.dispatchSay ? "var(--dp-t2, #6b7280)" : "var(--dp-warn, #b45309)",
										whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
									},
									"data-testid": "mm-node-said", "data-said-empty": r.dispatchSay ? "0" : "1"
								}, r.dispatchSay ? "产出：" + r.dispatchSay : "产出未读到：" + String(r.dispatchSayReason || "原因未知").slice(0, 60)) : null,
								/* 第 3 行：**单框控件**（用户：「单个框没有展开和折叠的选项」）
								 * 每个框都有这一行；不可用的项**显示出来并写明原因**，不悄悄消失 */
								h("div", {
									key: "r3", style: { display: "flex", alignItems: "center", gap: 3, marginTop: "auto" },
									"data-testid": "mm-node-controls", "data-controls": ctrls.filter((c) => c.enabled).map((c) => c.key).join(",")
								}, [
									/* 折叠 / 展开（有子才有意义） */
									h("span", {
										key: "tg", style: nodeBtnStyle(cToggle.enabled, false), title: cToggle.enabled
											? (collapsed.has(r.sessionId) ? "展开 " + r.childrenCount + " 个子分支" : "折叠 " + r.childrenCount + " 个子分支") + "（" + cToggle.why + "）"
											: ("不可折叠 —— " + cToggle.why),
										"data-testid": "mm-node-toggle", "data-toggle-id": r.sessionId,
										"data-enabled": cToggle.enabled ? "1" : "0",
										"data-collapsed": collapsed.has(r.sessionId) ? "1" : "0",
										onPointerDown: (e) => e.stopPropagation(),
										onClick: (e) => {
											e.stopPropagation();
											if (!cToggle.enabled) { say("该框下没有子会话 ⇒ 无可折叠内容（不是坏了）"); return; }
											toggleCollapse(r.sessionId);
											say(collapsed.has(r.sessionId) ? ("已展开「" + String(r.title).slice(0, 12) + "」的 " + r.childrenCount + " 个子分支") : ("已折叠「" + String(r.title).slice(0, 12) + "」的 " + r.childrenCount + " 个子分支"));
										}
									}, collapsed.has(r.sessionId) ? cToggle.alt : cToggle.icon),
									/* 在右侧展开对话 */
									h("span", {
										key: "dt", style: nodeBtnStyle(cDetail.enabled, isOpen), title: "在右侧展开这个对话（含「现在在做的事」）",
										"data-testid": "mm-node-detail", "data-detail-id": r.sessionId, "data-enabled": "1",
										onPointerDown: (e) => e.stopPropagation(),
										onClick: (e) => { e.stopPropagation(); setDetailId(isOpen ? null : r.sessionId); }
									}, "💬"),
									/* fork / 打开（不可用则写明缺什么） */
									h("span", {
										key: "fk", style: nodeBtnStyle(cFork.enabled, false), title: cFork.enabled ? "从此处分支（fork）" : ("不可用 —— " + cFork.why),
										"data-testid": "mm-node-fork", "data-enabled": cFork.enabled ? "1" : "0",
										onPointerDown: (e) => e.stopPropagation(),
										onClick: (e) => { e.stopPropagation(); if (cFork.enabled) actFork(r.sessionId); else say("fork 不可用：" + cFork.why); }
									}, "✚"),
									h("span", {
										key: "op", style: nodeBtnStyle(cOpen.enabled, false), title: cOpen.enabled ? "打开该原生对话" : ("不可用 —— " + cOpen.why),
										"data-testid": "mm-node-open", "data-enabled": cOpen.enabled ? "1" : "0",
										onPointerDown: (e) => e.stopPropagation(),
										onClick: (e) => { e.stopPropagation(); if (cOpen.enabled) actOpen(r.sessionId); else say("打开不可用：" + cOpen.why); }
									}, "📂"),
									/* 拖动手柄（与框体同一动作，但给出可见的可拖提示） */
									h("span", {
										key: "mv", style: { ...nodeBtnStyle(true, false), cursor: "grab", marginLeft: "auto" },
										title: "按住拖动可移动这个框（只改位置，不改血缘）；右键菜单里有「归位」",
										"data-testid": "mm-node-move", "data-move-id": r.sessionId,
										onPointerDown: (e) => {
											e.stopPropagation();
											if (e.button !== 0) return;
											// 🔴 同节点框：阻止原生文本选择/原生拖拽挂起主线程
											e.preventDefault();
											dragRef.current = { id: r.sessionId, sx: e.clientX, sy: e.clientY, ox: r.x, oy: r.y, moved: false, title: r.title };
											setSel(r.sessionId);
										}
									}, "✥"),
									/* 当前会话标记 */
									r.isCurrent ? h("span", {
										key: "cu", "data-testid": "mm-current", style: {
											fontSize: 10.5, padding: "0 4px", borderRadius: 3,
											background: "var(--dp-ac-soft, rgba(47,111,235,.2))", border: "1px solid var(--dp-ac-line, rgba(47,111,235,.5))",
											color: "var(--dp-ac, #9fc2ff)"
										}
									}, "当前") : null
								]),
								/* 折叠时显示隐藏的子树规模（不是"什么都没有"） */
								collapsed.has(r.sessionId) ? h("span", {
									key: "gh", "data-testid": "mm-ghost", style: {
										position: "absolute", right: -22, top: LAYOUT.nodeH / 2 - 9, fontSize: 10.5,
										padding: "1px 5px", borderRadius: 4, background: "var(--dp-bg-2, #20212a)",
										border: "1px dashed var(--dp-line, #4c525c)", color: "var(--dp-t3, #8b9199)"
									}
								}, "+" + r.childrenCount) : null
							]);
						})
					]),

					/* 悬浮工具条（设计稿 A4 .hbtns：出现在节点上方）
					 * 🔴 故意**不放进 stage**：stage 带 `transform: scale(k)`，低缩放下工具条会跟着缩到点不着。 */
					hovNode ? h("div", {
						key: "hb", style: {
							position: "absolute", left: hovNode.x * k, top: Math.max(0, hovNode.y * k - 26), display: "flex", gap: 3,
							background: "var(--dp-bg-2, #20212a)", border: "1px solid var(--dp-line, #3d4148)",
							borderRadius: "var(--dp-radius, 8px)", padding: "2px 5px", zIndex: 6
						}, "data-testid": "mm-hoverbar", "data-hover-id": hovNode.sessionId,
						onMouseEnter: () => setHov(hovNode.sessionId)
					}, [
								h("span", { key: "f", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "从此处分支（fork）", onClick: () => actFork(hovNode.sessionId) }, "➕"),
								h("span", { key: "o", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "打开此对话", onClick: () => actOpen(hovNode.sessionId) }, "📂"),
								h("span", { key: "g", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "抓取到总监", onClick: () => actGrab(hovNode.sessionId) }, "📥"),
								h("span", { key: "v", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "送交审核（六维）", onClick: () => actReview(hovNode.sessionId) }, "🎯"),
								h("span", { key: "c", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "折叠 / 展开这棵子树", onClick: () => toggleCollapse(hovNode.sessionId) }, "🗂"),
								h("span", { key: "dt", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "在右侧展开这个对话", onClick: () => setDetailId(hovNode.sessionId) }, "💬"),
								h("span", {
									key: "m", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "更多（右键菜单）",
									onClick: () => setMenu({
										id: hovNode.sessionId,
										x: hovNode.x * k + 40,
										y: (hovNode.y + LAYOUT.nodeH) * k + 6
									})
								}, "⋯")
							]) : null,

					/* 右键菜单 —— 同样放 wrap（不缩放）；坐标已是 body 滚动空间 */
					menu ? h("div", {
						key: "cm", style: {
							position: "absolute", left: menu.x, top: menu.y, background: "var(--dp-bg-2, #20212a)",
							border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius, 8px)",
							padding: 5, zIndex: 7, minWidth: 224, boxShadow: "var(--dp-shadow, 0 12px 30px rgba(0,0,0,.65))"
						}, "data-testid": "mm-ctxmenu", "data-ctx-id": menu.id,
						onClick: (e) => e.stopPropagation(), onPointerDown: (e) => e.stopPropagation()
					}, menuItems.map((it, i) => (it.sep ? h("div", {
						key: "sp" + i, style: { height: 1, background: "var(--dp-line, #31343a)", margin: "4px 2px" }
					}) : h("div", {
						key: it.key,
						style: {
							fontSize: "calc(11px * var(--dp-font,1))", color: it.enabled ? "var(--dp-t2, #c3c8ce)" : "var(--dp-t3, #5d626a)",
							padding: "4px 8px", borderRadius: "var(--dp-radius-sm, 5px)",
							cursor: it.enabled ? "pointer" : "not-allowed", display: "flex", gap: 6, alignItems: "center"
						},
						"data-testid": "mm-ctx-" + it.key, "data-enabled": it.enabled ? "1" : "0",
						title: it.enabled ? it.why : ("不可用 —— " + it.why),
						onClick: () => { if (it.enabled && it.run) it.run(); }
					}, [
						h("span", { key: "i" }, it.icon),
						h("span", { key: "l" }, it.label),
						!it.enabled ? h("span", { key: "n", style: { marginLeft: "auto", fontSize: 10.5, color: "var(--dp-t3, #4c525c)" } }, "未接通") : null
					])))) : null
				])
			),

			/* ── 小地图（整树缩略 + 视野框；点击跳转；可由个性化关掉） ── */
			pz.minimap ? h("div", {
				key: "mm", style: {
					position: "absolute", right: 12, bottom: 12, width: 178, height: 104, background: "rgba(20,21,25,.9)",
					border: "1px solid var(--dp-line, #31343a)", borderRadius: "var(--dp-radius, 8px)", overflow: "hidden", cursor: "crosshair", zIndex: 5
				}, "data-testid": "mm-minimap",
				title: "小地图：整棵血缘树缩略，点击可跳转视野（个性化里可关）",
				onClick: (e) => {
					const el = bodyRef.current;
					if (!el) return;
					const box = e.currentTarget.getBoundingClientRect();
					const rx = (e.clientX - box.left) / box.width;
					const ry = (e.clientY - box.top) / box.height;
					el.scrollLeft = Math.max(0, rx * wrapW * k - el.clientWidth / 2);
					el.scrollTop = Math.max(0, ry * wrapH * k - el.clientHeight / 2);
					syncView();
				}
			}, [
				...rows.map((r) => h("div", {
					key: r.sessionId,
					style: {
						position: "absolute",
						left: (r.x / stageW) * 100 + "%",
						top: (r.y / stageH) * 100 + "%",
						width: Math.max(3, (LAYOUT.nodeW / stageW) * 100 * 0.9) + "%",
						height: Math.max(2, (LAYOUT.nodeH / stageH) * 100) + "%",
						background: chain.has(r.sessionId) ? "var(--dp-ac, #8957e5)" : (STATE_KINDS[r.state] || STATE_KINDS.idle).color,
						opacity: 0.85, borderRadius: 1
					}
				})),
				h("div", {
					key: "vp", "data-testid": "mm-minimap-vp",
					style: {
						position: "absolute",
						left: (view.sl / (wrapW * k)) * 100 + "%",
						top: (view.st / (wrapH * k)) * 100 + "%",
						width: ((view.cw || 0) / (wrapW * k)) * 100 + "%",
						height: ((view.ch || 0) / (wrapH * k)) * 100 + "%",
						border: "1px solid var(--dp-ac, #9fc2ff)", background: "var(--dp-ac-soft, rgba(47,111,235,.12))"
					}
				})
			]) : null
			]),

			/* ── 右侧：该框的对话（点框即开；最上面是「现在在做的事」） ── */
			detailNode ? h(NodeDetailPanel, {
				key: "nd", row: detailNode, flows: flowStore.ofSession(detailNode.sessionId),
				onClose: () => setDetailId(null),
				onSay: (m, tone) => say(m),
				onFlow: (payload) => {
					onFlow(payload, detailNode.sessionId);
					/* 面板里发起的输入也进"待总监判断"的草稿，方便接着路由 */
					if (payload && payload.text && !payload.hopTo) setDraft(payload.text);
				},
				onRoute: (text) => {
					if (!String(text || "").trim()) return;
					setDraft(String(text).trim());
					const nodes = rows.map((r) => ({ id: r.sessionId, name: r.title, level: r.depth === 0 ? "root" : "session" }));
					const r = route(String(text).trim(), { nodes, currentNodeId: detailNode.sessionId });
					setRouteResult(r);
					flowStore.push(String(text).trim(), { origin: "mindmap", sessionId: detailNode.sessionId, note: "交总监判断去向（右侧面板）" });
					say("总监已整理，待你确认去向（底栏）");
				}
			}) : null
		]),

		/* ── 总览弹窗（R10）：导图**最上面**的独立层，不改动画布布局 ── */
		h(OverviewDialog, {
			key: "ov", open: ovOpen, onClose: () => setOvOpen(false), rows, onSay: (m) => say(m)
		}),

		/* ── 底部：选中分支信息 + 待路由输入 + 审核结果 ── */
		h("div", { key: "f", style: S.foot }, [
			h("div", { key: "info", style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } }, [
				h("span", { key: "l", style: { ...S.muted, minWidth: 52 } }, "选中分支"),
				h("span", {
					key: "v", style: { fontSize: "calc(11.5px * var(--dp-font,1))", color: selNode ? "var(--dp-ac2, #d6c6ff)" : "var(--dp-t3, #6f757d)" }, "data-testid": "mm-sel"
				}, selNode
					? (selNode.title + " · " + selNode.sessionId + " · " + kindLabelOf(selNode) + " · " + (STATE_KINDS[selNode.state] || STATE_KINDS.idle).label +
						" · 流转 " + selFlows.length + " 条")
					: "未选中（点任一框 → 右侧展开该对话；未选时底栏输入走总监全域路由）"),
				detailNode ? h("span", { key: "d", style: { ...S.chip } }, "右侧已展开：" + String(detailNode.title).slice(0, 14)) : null,
				!caps.available ? h("span", { key: "w", style: { ...S.muted, color: "#d29922" } }, "⚠ 宿主 sessions 服务不可用 ⇒ fork / 打开 已禁用") : null
			]),
			h("div", { key: "in", style: { display: "flex", gap: 7, alignItems: "center" } }, [
				h("span", { key: "c", style: S.chip }, "路由"),
				h("input", {
					key: "i", style: S.input, "data-testid": "mm-input", value: draft,
					placeholder: "输入内容，交由总监判断去向",
					onChange: (e) => setDraft(e.target.value),
					onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doRoute(); } }
				}),
				h("button", { key: "b", style: S.btnPri, "data-testid": "mm-route", title: "交由总监判断去向", onClick: doRoute }, "交由总监")
			]),
			routeResult ? h("div", {
				key: "rr", style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, "data-testid": "mm-route-card"
			}, [
				h("span", {
					key: "c", style: { ...S.chip, background: "var(--dp-ac2-soft, rgba(137,87,229,.16))", borderColor: "var(--dp-ac2-line, rgba(137,87,229,.4))", color: "var(--dp-ac2, #b794f6)" }
				}, "建议 " + DESTINATION_LABEL[routeResult.decision.destination] + "（" + routeResult.decision.confidence.toFixed(2) + "）"),
				h("span", { key: "r", style: S.muted }, routeResult.decision.reason),
				h("button", { key: "t", style: S.btn, "data-testid": "mm-rt-transfer", onClick: () => confirm(DESTINATION.TRANSFER) }, "转给该对话"),
				h("button", { key: "d", style: S.btn, "data-testid": "mm-rt-direct", onClick: () => confirm(DESTINATION.DIRECT) }, "直接调用"),
				h("button", { key: "n", style: S.btn, "data-testid": "mm-rt-new", onClick: () => confirm(DESTINATION.CREATE) }, "新建分支"),
				h("button", { key: "c2", style: S.btn, "data-testid": "mm-rt-cancel", onClick: () => setRouteResult(null) }, "取消")
			]) : null,
			/* 六维审核卡（数据是**真实抓取**的文本 + 规则引擎输出；空文本会如实报 ❌） */
			review ? h("div", {
				key: "rv", style: {
					display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
					border: "1px solid " + (review.pass ? "rgba(63,185,80,.45)" : "rgba(201,148,43,.45)"),
					background: review.pass ? "rgba(63,185,80,.08)" : "rgba(201,148,43,.08)",
					borderRadius: "var(--dp-radius, 8px)", padding: "4px 8px"
				}, "data-testid": "mm-review", "data-pass": review.pass ? "1" : "0"
			}, [
				h("span", { key: "h", style: { fontSize: "calc(11px * var(--dp-font,1))", fontWeight: 650, color: review.pass ? "#3fb950" : "#d29922" } },
					"六维审核 " + (review.pass ? "通过" : "未通过")),
				h("span", { key: "c", style: S.muted }, "抓取 " + review.chars + " 字符" + (review.chars ? "" : "（原生对话区为空 ⇒ 需求满足度为 ❌，这是真实结果）")),
				h("span", { key: "d", style: { display: "inline-flex", gap: 6, flexWrap: "wrap" } },
					review.dims.map((d) => h("span", {
						key: d.key, style: { ...S.muted, color: d.status === "ok" ? "#3fb950" : d.status === "warn" ? "#d29922" : "#e5534b" },
						title: d.hint + " —— " + d.note
					}, (d.status === "ok" ? "✅" : d.status === "warn" ? "⚠" : "❌") + d.label))),
				h("button", { key: "x2", style: S.btn, "data-testid": "mm-review-close", onClick: () => setReview(null) }, "关闭")
			]) : null,
			h("div", { key: "note", style: S.muted },
				"状态点四态取自**宿主快照**（running / completed / pendingInteraction）；血缘取自宿主 fork 写入的 parentId；" +
				"拖动只改画面位置、不改血缘。元素 " + cov.done + "/" + cov.total + " 已落（" + cov.na + " 条明确不做，原因见 store/mindmap-schema.js）。")
		]),

		/* 个性化面板（右上角；与总监页 / 弹窗 / 设计图工作室同一个组件、同一份设定） */
		h(PersonalizePanel, { key: "pp", open: pOpen, onClose: () => setPOpen(false), inset: inset, top: 46, scope: "分支导图" }),

		/* toast：顶部居中药丸，自动消失，不挡点击 */
		toast ? h("div", {
			key: "toast", style: {
				position: "absolute", top: 84, left: "50%", transform: "translateX(-50%)",
				padding: "5px 12px", borderRadius: 999, pointerEvents: "none", maxWidth: "64%",
				background: "var(--dp-ac, rgba(47,111,235,.92))", border: "1px solid var(--dp-ac-line, rgba(159,194,255,.55))", color: "#fff",
				fontSize: "calc(11.5px * var(--dp-font,1))", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
				boxShadow: "var(--dp-shadow, 0 6px 22px rgba(0,0,0,.55))"
			}, "data-testid": "mm-toast"
		}, toast) : null
	]);
}

export default MindMap;
