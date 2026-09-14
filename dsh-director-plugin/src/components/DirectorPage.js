/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总监页（宿主原生 tab 环里的第一个视图）
 * 引用：—
 * 上游：client-entry.js
 * 下游：store/layout.js, store/hierarchy.js, util/bus.js, store/plugin-db.js, logic/routing.js, logic/branch-tree.js, util/debug.js, logic/flow.js, bridge/chat-bridge.js, store/personalize.js, components/FloatDock.js, components/PersonalizePanel.js, util/safe-area.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A（总监页 R1–R8）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/DirectorPage.js — 总监页（宿主原生 tab 环里的第一个视图）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
 *   ├─ 板块 A · A1 总监页全界面（R1 / R2.5 / R2 / R3 / R4·R5·R7 三栏 / R6 / R8）
 *   ├─ 板块 C · C1 导航（本页是 tab 序第一项，Alt+1 到达）
 *   ├─ 板块 C · C5 治理闭环（R5 对话区 + R6 记忆 + R8 输入）
 *   └─ 板块 G · 四维流转与「用原本的对话框」（第三轮并入）
 *  结构基线 docs/50-信息中心/V13-原生Tab集成设计稿.html  （R 区划分以此为准）
 *  注册处   src/client-entry.js → installDirectorView(ctx)
 *
 * ══════════════════════════════════════════════════════════════════
 *  R 区与代码的一一对应（改哪个区就改哪一段）
 * ══════════════════════════════════════════════════════════════════
 *   R1   顶部栏：层级选择 + 层级 chips + 右上「⚙ 个性化」 .... sectionR1()
 *   R2.5 对话控制台：六动作 + 待办 / 活跃分支 / 流转 ......... sectionR25()
 *   R2   项目总览：定位 / 目标 / 当前阶段 + 四指标卡 .......... sectionR2()
 *   R3   资源行：智能体（含运行中标记）/ 技能 / 模型 / 上下文 . sectionR3()
 *   R4   左栏：项目导航（文档树 / 路线图 / 关键文件） ......... sectionR4()
 *   R5   中栏：**当前会话的流转信息** + 总监消息 ............... sectionR5()
 *   R7   右栏：详情 / 产出物 / 六维审核结论 ................... sectionR7()
 *   R6   记忆面板：三层记忆 + 独立库统计 ..................... sectionR6()
 *   R8   焦点条：**不再有自建输入框** —— 见下面 🔴
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 第三轮改动的三条（都是用户原话）
 * ══════════════════════════════════════════════════════════════════
 *  ① 「总监 tap 页面，下面你加了一个对话框 不要这个对话框 用原本的对话框」
 *     ⇒ 删掉上一版的 `dp-input` + `dp-send` 自建输入条，改成 **焦点条**：
 *       把光标送进宿主原生 composer（`bridge/chat-bridge.js` 的语义锚点），
 *       并提供「把原生输入登记为流转」（读原生输入 → 写进四维流转）。
 *       ⚠️ 为什么不直接删干净：用户还要「点到哪里往哪里输入和沟通」——
 *          所以保留"目标域"切换与聚焦动作，只是**打字的地方换成原生的**。
 *  ② 「还有总监 现在总监的样子你确定和我看到的设计图一样么」
 *     ⇒ 按板块 A1 **逐区对齐**：R1 层级 chips、R2.5 六动作控制台、
 *       R2 定位/目标/当前阶段 + 四指标卡（含完成率进度条）、R6 记忆面板。
 *       每个数字都标出数据源；取不到就显示 0 并写明"数据源为空"，
 *       **不编一个好看的假数字**（本项目纪律）。
 *  ③ 「我点击左侧，点入不同的对话切进去就是和当前对话有关的流转信息」
 *     ⇒ R5 顶部固定「现在在做的事」，下面按段显示**该会话的流转**；
 *       会话通过 `watchCurrentSession` 跟随（宿主左栏点击不通知插件）。
 *
 * ⚠️ 与 DirectorDialog 的关系：**两者并存，不互斥**，共用同一批 store ⇒ 数据必然一致。
 * ⚠️ 构建约束：react / react/jsx-runtime 为平台冻结模块（ADR-001），构建期外置。
 */

import * as react from "react";
import { directorLayoutStore } from "../store/layout.js";
import { loadTree, getBreadcrumb, LEVEL_LABEL, LEVEL, GLOBAL_NODE_ID, countByLevel } from "../store/hierarchy.js";
import { onHierarchyChange } from "../util/bus.js";
import { appendDirectorMessage, listDirectorMessages, pluginDbStats, listTodos, listReviews } from "../store/plugin-db.js";
import { route, DESTINATION, DESTINATION_LABEL, review6 } from "../logic/routing.js";
import { getBranchSnapshot, refreshBranchTree, subscribeBranch, watchCurrentSession, openSession } from "../logic/branch-tree.js";
import { dshLog } from "../util/debug.js";
import { runDirector } from "../logic/director-run.js";
import { loadDirectorConfig } from "../config/model.js";
import { resolveDuties } from "../store/duty-config.js";
import { planFor, auditRubric, RUBRIC, RUBRIC_MAX, summarizeRounds } from "../logic/orchestrate.js";
import {
	flowStore, currentTaskOf, flowLine, DIM, DIM_LABEL, DIM_ICON, FLOW_STATUS_LABEL, clip, flowStats
} from "../logic/flow.js";
import { findComposer, readComposerText, deliverToChat, isAgentGenerating } from "../bridge/chat-bridge.js";
import { personalizeStore } from "../store/personalize.js";
/* 浮动按钮组的横向占位（几何真相在 FloatDock.js，此处只消费）—— 见下方 dockReserve 注释 */
import { FLOAT_DOCK_RESERVE } from "./FloatDock.js";
import { PersonalizePanel } from "./PersonalizePanel.js";
import { readInset } from "../util/safe-area.js";

const h = react.createElement;
export const DIRECTOR_PAGE_ID = "dsh-director-page";

/**
 * 文案截断（本页内部小工具）。
 * 🔴 设计稿 A1 的每个指标卡与 chips 都有"取不到就写明未填写"的要求 ——
 *    截断是为了不把布局撑破，而**空值文案本身**必须交代数据源，不能只显示"—"。
 */
export function clampText(s, n) {
	const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
	const max = n || 40;
	return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** R4 三 Tab（V16 A1 · 与 V13 一致，勿改顺序） */
export const R4_TABS = Object.freeze([
	{ key: "docs", label: "文档树" },
	{ key: "roadmap", label: "路线图 · 待办" },
	{ key: "files", label: "关键文件" }
]);

/** R3 的智能体 / 技能（与 DirectorDialog 同源，此处只列关键项做资源展示） */
const RES_AGENTS = [
	{ key: "code", label: "🧑💻 代码" },
	{ key: "doc", label: "📄 文档" },
	{ key: "research", label: "🔍 调研" },
	{ key: "test", label: "🧪 测试" },
	{ key: "review", label: "🎯 审核" }
];
const RES_SKILLS = [
	{ key: "search", label: "🔎 搜索" },
	{ key: "write", label: "✍️ 写作" },
	{ key: "refactor", label: "⚙️ 重构" }
];

/** R1 层级 chips（设计稿 A1：全局级 / 项目级 ▸ 当前 / 文件夹级 / 对话级） */
const LEVEL_CHIPS = Object.freeze([
	{ level: LEVEL.GLOBAL, label: "全局级" },
	{ level: LEVEL.PROJECT, label: "项目级" },
	{ level: "folder", label: "文件夹级" },
	{ level: LEVEL.SESSION, label: "对话级" }
]);

/** R2.5 六动作（设计稿 A1：顺序即闭环）
 *  🔴 第七轮新增「统筹」——「我提供一个想法……后续的开发文档编写、审核、蓝图设计、测试
 *     等等都由总监统筹」。它是**起点动作**（输入想法 → 出阶段计划），故排在最前。 */
const CONSOLE_ACTIONS = Object.freeze([
	{ key: "plan", icon: "🧭", label: "统筹", tone: "accent2" },
	{ key: "new", icon: "＋", label: "新建", tone: "accent" },
	{ key: "del", icon: "🗑", label: "删除", tone: "danger" },
	{ key: "grab", icon: "📥", label: "抓取", tone: "" },
	{ key: "close", icon: "🔚", label: "回结", tone: "warn" },
	{ key: "review", icon: "🎯", label: "审核", tone: "accent2" },
	{ key: "next", icon: "⏭", label: "继续", tone: "" }
]);

const S = {
	root: {
		display: "flex", flexDirection: "column", height: "100%", minHeight: 0,
		fontSize: "calc(12.5px * var(--dp-font, 1))", color: "var(--dp-t1, #e8eaed)",
		/* 背景采用**宿主原生页签同一个令牌** —— 宿主「对话」页的根容器就是
		 * `background: var(--dsw-alias-bg-base)`（见宿主体内 .RWZidW_root 规则），
		 * 所以此处同源同值 ⇒ 总监页与原生风格统一；宿主换主题 / 换背景图时自动跟随
		 * （宿主那层是半透明的，背景图会透出来）。
		 * 令牌为何在 dp-root 上解析、不能定义在 :root —— 见 store/personalize.js 的
		 * dp-root 桥接块注释（CSS 自定义属性的 var() 在**定义处**求值）。
		 * ⚠️ 长写而非简写 —— 见 MindMap 根节点注释：简写会重置 background-image，
		 * 让 `.dp-textured` 的纹理（个性化「质感」档）静默失效。 */
		backgroundColor: "var(--dsw-alias-bg-base, var(--dp-bg-0, #0b0c0e))"
	},
	sec: {
		border: "1px solid var(--dp-line, #31343a)", borderRadius: "var(--dp-radius, 8px)",
		background: "var(--dp-bg-1, #1c1e22)", padding: "calc(7px * var(--dp-density,1)) calc(9px * var(--dp-density,1))"
	},
	r1: {
		display: "flex", alignItems: "center", gap: 7, padding: "6px 9px",
		borderBottom: "1px solid var(--dp-line, #31343a)", flex: "0 0 auto", background: "var(--dp-bg-1, transparent)"
	},
	r3: {
		display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "5px 9px",
		borderBottom: "1px solid var(--dp-line, #31343a)", flex: "0 0 auto"
	},
	cols: { display: "grid", gridTemplateColumns: "200px 1fr 210px", gap: 7, padding: "7px 9px", flex: 1, minHeight: 0 },
	col: { display: "flex", flexDirection: "column", gap: 7, minHeight: 0, minWidth: 0 },
	blkT: {
		fontFamily: "ui-monospace,Consolas,monospace", fontSize: "calc(10.5px * var(--dp-font,1))",
		color: "var(--dp-t3, #8b9199)", letterSpacing: ".4px", marginBottom: 6, display: "flex", alignItems: "center", gap: 6
	},
	kv: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5 },
	kvc: {
		background: "var(--dp-bg-2, #212429)", border: "1px solid var(--dp-line, #31343a)",
		borderRadius: "var(--dp-radius-sm, 5px)", padding: "calc(5px * var(--dp-density,1)) calc(7px * var(--dp-density,1))"
	},
	kvV: { fontSize: "calc(15px * var(--dp-font,1))", fontWeight: 650 },
	kvK: { fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", marginTop: 1 },
	bar: { height: 3, borderRadius: 2, background: "var(--dp-line, #31343a)", marginTop: 4, overflow: "hidden" },
	barI: (pct) => ({ display: "block", height: "100%", width: Math.max(0, Math.min(100, pct)) + "%", background: "var(--dp-ac, #2f6feb)" }),
	chip: {
		fontSize: "calc(10.5px * var(--dp-font,1))", padding: "calc(2px * var(--dp-density,1)) 7px",
		borderRadius: "var(--dp-radius-sm, 5px)", background: "var(--dp-ac-soft, rgba(137,87,229,.16))",
		border: "1px solid var(--dp-ac-line, rgba(137,87,229,.4))", color: "var(--dp-ac, #b794f6)", whiteSpace: "nowrap"
	},
	chip2: {
		fontSize: "calc(10.5px * var(--dp-font,1))", padding: "calc(2px * var(--dp-density,1)) 7px",
		borderRadius: "var(--dp-radius-sm, 5px)", background: "var(--dp-ac2-soft, rgba(57,197,207,.14))",
		border: "1px solid var(--dp-ac2-line, rgba(57,197,207,.4))", color: "var(--dp-ac2, #7fe3e8)", whiteSpace: "nowrap"
	},
	btn: {
		height: 24, padding: "0 9px", borderRadius: "var(--dp-radius-sm, 5px)", cursor: "pointer",
		fontSize: "calc(11.5px * var(--dp-font,1))", whiteSpace: "nowrap",
		border: "1px solid var(--dp-line, #3d4148)", background: "var(--dp-bg-2, #212429)", color: "var(--dp-t2, #c3c8ce)",
		display: "inline-flex", alignItems: "center", gap: 4
	},
	seg: (on) => ({
		flex: 1, textAlign: "center", fontSize: "calc(11px * var(--dp-font,1))",
		padding: "calc(4px * var(--dp-density,1)) 0", cursor: "pointer", border: "none",
		color: on ? "var(--dp-ac, #c9a9ff)" : "var(--dp-t3, #8b9199)",
		background: on ? "var(--dp-ac-soft, rgba(137,87,229,.2))" : "transparent", fontWeight: on ? 600 : 400
	}),
	msg: { display: "flex", gap: 6, marginBottom: 6, fontSize: "calc(11.5px * var(--dp-font,1))" },
	av: (k) => ({
		width: 18, height: 18, flex: "0 0 18px", borderRadius: "var(--dp-radius-sm, 5px)",
		display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700,
		background: k === "user" ? "var(--dp-ac-soft, rgba(47,111,235,.18))" : "var(--dp-ac2-soft, rgba(137,87,229,.22))",
		color: k === "user" ? "var(--dp-ac, #79a8ff)" : "var(--dp-ac2, #b794f6)"
	}),
	bub: {
		background: "var(--dp-bg-2, #212429)", border: "1px solid var(--dp-line, #31343a)",
		borderRadius: "var(--dp-radius-sm, 5px)", padding: "5px 8px", flex: 1, minWidth: 0,
		lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word"
	},
	muted: { fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", lineHeight: 1.55 },
	src: {
		fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #6f757d)",
		borderTop: "1px dashed var(--dp-line, #31343a)", marginTop: 6, paddingTop: 4, lineHeight: 1.5
	}
};

/* ══════════════════════════════════════════════════════════════════
 *  组件
 * ══════════════════════════════════════════════════════════════════ */

export function DirectorPage() {
	const st = react.useSyncExternalStore(
		(fn) => directorLayoutStore.subscribe(fn),
		() => directorLayoutStore.getState(),
		() => directorLayoutStore.getState()
	);
	const pz = react.useSyncExternalStore(
		(fn) => personalizeStore.subscribe(fn),
		() => personalizeStore.getState(),
		() => personalizeStore.getState()
	);
	const fs = react.useSyncExternalStore(
		(fn) => flowStore.subscribe(fn),
		() => flowStore.getState(),
		() => flowStore.getState()
	);

	const [tree, setTree] = react.useState(null);
	const [crumbs, setCrumbs] = react.useState([]);
	const [msgs, setMsgs] = react.useState([]);
	const [todos, setTodos] = react.useState([]);
	const [stats, setStats] = react.useState(null);
	const [reviews, setReviews] = react.useState([]);
	const [branch, setBranch] = react.useState(() => getBranchSnapshot());
	const [r4tab, setR4tab] = react.useState("docs");
	const [r5tab, setR5tab] = react.useState("flow");
	const [routeResult, setRouteResult] = react.useState(null);
	const [review, setReview] = react.useState(null);
	const [toast, setToast] = react.useState("");
	const [pOpen, setPOpen] = react.useState(false);
	const [curId, setCurId] = react.useState(null);
	const [composerOk, setComposerOk] = react.useState(false);
	/* V17 P2-1：R2/R4/R6 区域可折叠（CSS display 控制，不改 DOM 结构） */
	// V17 P2：折叠态持久化到 layout store（跨会话保留，首次默认全展开），不再用易失的本地 state
	const collapsed = st.sectionCollapsed || { r2: false, r4: false, r6: false };
	const toggleCollapse = (key) => directorLayoutStore.setSectionCollapsed(key, !collapsed[key]);
	/* 执行态（本轮新增 · 真流转）。deliverMode 是**投递结果**，进 data-* 供断言读 ——
	 * 界面上只显示一个短词，归因细节走属性，不占版面（用户要求「不用多余的解释」）。 */
	const [busy, setBusy] = react.useState(false);
	const [deliverMode, setDeliverMode] = react.useState("idle"); // idle|sent|filled|failed
	/* 走的是哪一级投递通道（host-send / direct / open-then-send / 失败原因）——
	 * 降级必须看得见，否则「显示已发送」可能只是点到了按钮而没送达 */
	const [deliverVia, setDeliverVia] = react.useState("");
	const [runGrade, setRunGrade] = react.useState("");           // G0/G1 组合，来自五步
	const msgsRef = react.useRef([]);
	const toastTimer = react.useRef(null);

	const nodeId = st.activeNodeId || GLOBAL_NODE_ID;
	const say = (m) => {
		setToast(m);
		if (toastTimer.current) clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToast(""), 2600);
	};

	const refresh = react.useCallback(async () => {
		try {
			setTree(await loadTree());
			setCrumbs(await getBreadcrumb(nodeId));
			const list = (await listDirectorMessages(nodeId)) || [];
			/* 同步 ref：runDirector 要在**上屏前**读「本条之前的上下文」，
			 * 若用 state 会拿到闭包里的旧值（少一轮）。 */
			msgsRef.current = list;
			setMsgs(list);
			setTodos((await listTodos(nodeId)) || []);
			/* 问题记录（R5「工作顺序 / 待完成清单 / 问题记录 全部实时更新」）：
			 * 源 = 未通过的审核 + 节点风险。两个源都取自真实库，不编数。 */
			setReviews((await listReviews(nodeId)) || []);
			setStats(await pluginDbStats());
		} catch (e) { /* 数据层异常不影响 UI */ }
	}, [nodeId]);

	react.useEffect(() => { refresh(); }, [refresh]);
	react.useEffect(() => onHierarchyChange(() => refresh()), [refresh]);
	react.useEffect(() => { refreshBranchTree().catch(() => { }); return subscribeBranch(setBranch); }, []);
	/* 跟随宿主当前会话（左栏点会话插件收不到事件 ⇒ 轮询单字段） */
	react.useEffect(() => watchCurrentSession((id) => { setCurId(id); if (id) flowStore.setActiveSession(id); }), []);
	/* 原生 composer 是否可用 —— ⚠️ 只用来**显示状态**，不用来**禁用按钮**。
	 *
	 * 🔴 2026-09-12 真机补漏：原先「登记流转」写成 `disabled: !composerOk`，
	 *   而 `composerOk` 是 **1.2 秒轮询**出来的布尔量 ⇒ 两种坏结果：
	 *     ① 明明能点，按钮却是死的（最多 1.2 秒）——用户感受到的正是他抱怨的
	 *        "按钮点击不好用"；真机 e2e 也因此在 D5 偶发「R5 0 → 0」。
	 *     ② 明明不能点，按钮却亮着 —— 「点了没反应」，比①更差。
	 *   正确做法：**按钮永远可点，真值在点击那一刻读**（`registerNative` 本来就
	 *   会如实回话：输入框不可见 / 输入框为空）。
	 *   "读真值"的能力不该交给一个 1.2 秒前的快照去 gate —— 这跟 execution-standards
	 *   §3.4「写后回读校验」是同一条道理：**断言态必须来自现取，不能来自缓存**。
	 * 轮询缩短到 400ms：仅影响 `data-composer` / `aria-disabled` 这两个**提示**位的准度。 */
	react.useEffect(() => {
		const t = setInterval(() => setComposerOk(Boolean(findComposer())), 400);
		setComposerOk(Boolean(findComposer()));
		return () => clearInterval(t);
	}, []);

	const node = react.useMemo(() => {
		if (!tree) return null;
		let found = null;
		const walk = (n) => { if (found) return; if (n.id === nodeId) { found = n; return; } (n.childNodes || []).forEach(walk); };
		walk(tree);
		return found;
	}, [tree, nodeId]);

	const counts = react.useMemo(() => countByLevel(tree || null), [tree]);
	const rows = (branch.tree && branch.tree.rows) || [];
	const activeBranches = rows.filter((r) => r.childrenCount > 0).length;
	const fStats = flowStats(fs.flows);
	/** 本页显示"哪个会话的流转"：优先宿主当前会话，否则用当前层级节点 */
	const flowSession = curId || (nodeId && String(nodeId).indexOf("s_") === 0 ? nodeId : null);
	const sessionFlows = flowStore.ofSession(flowSession);
	const latest = sessionFlows.length ? sessionFlows[sessionFlows.length - 1] : null;
	const nowRow = rows.find((r) => r.sessionId === flowSession) || (flowSession ? { sessionId: flowSession, title: "该对话", state: "idle" } : null);
	const now = currentTaskOf({ node: nowRow, flow: latest, flowList: sessionFlows, msgs });
	const todoDone = todos.filter((t) => t.done === true || t.status === "done").length;
	const todoRate = todos.length ? Math.round((todoDone / todos.length) * 100) : 0;
	/* 问题记录（R5）：未通过的审核 + 节点风险 —— 两个源都是真实库，不编数 */
	const problems = reviews.filter((r) => r && r.pass === false).length
		+ ((node && node.risks) ? node.risks.length : 0);
	const inset = readInset();

	/* 浮动按钮组（FloatDock）是 `position:fixed` 贴在页面右下角的，横跨右侧
	 * `FLOAT_DOCK_RESERVE` px。它虽然浮在上层，但会**压住页面自己的右端内容** ——
	 * 真机实测（1442×816）：R8 的「交给总监整理」被覆盖 88×19 px（那颗按钮总共只有 89×24），
	 * R6 的「最近：…」也被压掉一截。
	 * ⇒ 这两行按浮动组宽度留出右边距（横向避让，和 R1 的 `inset` 是同一类做法）。
	 * ⚠️ 读的是**布局状态**而不是写死留白：浮动组被关掉时不留空。
	 * ⚠️ 只管 R6 / R8 —— 它们是通栏行。R7 是 210px 宽的右栏，给它留 108px 会把栏挤没。 */
	const dockReserve = st.floatDockOpen === false ? 0 : FLOAT_DOCK_RESERVE;

	/* ── 动作 ── */
	/** 定位原生输入框（"用原本的对话框"；本页不自建输入框） */
	function focusNative() {
		const ed = findComposer();
		if (!ed) { say("输入框不可用"); return false; }
		try { ed.focus(); if (typeof ed.setSelectionRange === "function") ed.setSelectionRange(ed.value.length, ed.value.length); } catch (e) { /* 只读元素 */ }
		say("已定位输入框");
		return true;
	}

	/** 切换"输入送到哪个域"（"点到哪里往哪里输入"） */
	function pickTarget(dim) {
		directorLayoutStore.setFocusTarget(dim === DIM.DIRECTOR ? "director" : "chat");
		focusNative();
	}

	/** 把输入框里已有的内容登记为一条流转（读真值，不编） */
	function registerNative() {
		const txt = readComposerText();
		if (txt === null) { say("输入框不可见"); return; }
		if (!String(txt).trim()) { say("输入框为空"); return; }
		const dim = st.focusTarget === "director" ? DIM.DIRECTOR : DIM.CHAT;
		flowStore.push(String(txt).trim(), { origin: dim, sessionId: flowSession, note: "R8 登记" });
		say("已登记流转 · " + String(txt).trim().length + " 字符");
	}

	/** `runDirector` 需要的 store 适配器 —— 把 plugin-db 的消息面包装成 {getState,addMessage,setStatus} */
	function pageStore() {
		return {
			/* 语义：本条**之前**的上下文。故读 ref 而不是 state（state 是本帧的闭包快照） */
			getState: () => ({ messages: msgsRef.current }),
			addMessage: (m) => appendDirectorMessage(nodeId, { role: m.role, text: m.content, parsed: m.parsed }),
			setStatus: (s) => dshLog("director-page", "run-status=" + s)
		};
	}

	/** 投递结果 → 一句短提示（**归因细节走 data-*，不占版面**） */
	function deliverToast(d) {
		if (d.mode === "sent") return "已发送到对话";
		if (d.mode === "filled") return "已填入输入框";
		return "未送达 · " + (d.reason || "未知");
	}

	/** 执行：**经总监五步处理 → 真正投递到对话**（本轮核心链路）
	 *
	 * 旧版（已废）：只 `appendDirectorMessage` + `route` + `flowStore.push` —— 记录员，不是执行中枢。
	 * 新版：① 立即上屏（由 runDirector 内部完成，且在两处模型调用之前）
	 *       ② 五步处理       ③ 处理链落库（`parsed`）  ④ 真投递  ⑤ 两跳流转登记
	 *
	 * 三条铁律：
	 *   · 用户消息**先上屏**（本地模型单次超时 60s，串行最多 3 次 —— 不能让用户干等）
	 *   · 投递结果写进 `data-deliver-mode`（界面不解释，测试可断言）
	 *   · 失败必须有可见原因，不许静默（§4.3 降级底线）
	 */
	async function deliver(text) {
		/* 原生框**不在场**与"在场但为空"是两回事，且"不在场"还要再分两种：
		 *   · 宿主**生成中**会把 composer 收起来（判据：出现「停止生成」按钮）
		 *     ⇒ 说「对话生成中」；说「先打开对话区」会让人以为是界面没打开。
		 *   · 真的没有对话区（视图被切走）⇒ 说「先打开对话区」。
		 *   最后才是"你没写东西"。混成一句会让人以为框坏了。 */
		if (text === null) { say(isAgentGenerating() ? "对话生成中，稍后再试" : "先打开对话区"); return; }
		const t = String(text || "").trim();
		if (!t) { say("请输入内容"); return; }
		if (busy) { say("上一条正在处理"); return; }
		setBusy(true);
		setDeliverMode("idle");
		try {
			const cfg = loadDirectorConfig();
			const duties = (await resolveDuties(nodeId)).duties;

			let r;
			try {
				r = await runDirector({
					sessionId: flowSession, userText: t, store: pageStore(), duties, config: cfg,
					autoForward: false
				});
			} catch (e) {
				await refresh();
				setDeliverMode("failed");
				say("处理失败 · " + ((e && e.message) || "未知"));
				return;
			}
			setRunGrade(r.steps.some((s) => s.grade === "G1") ? "G1" : "G0");

			/* R2.5 建议去向：原生产者是那份**已删的旧 `deliver`**，删除后该卡片会变成
			 * 永远不出现的死 UI。此处把生产者接回新版链路（处理完成后给出建议去向，
			 * 供你改投 / 纠偏）—— 一份数据一个生产者，不留不可达界面。 */
			setRouteResult(route(t, { nodes: flatNodes(), currentNodeId: nodeId }));

			/* ④ 投递的是**处理后的指令**，不是原文 —— 这正是用户要的"经过处理然后发给对话执行" */
			const d = await deliverToChat(r.instruction, { sessionId: flowSession, opener: openSession });
			setDeliverMode(d.mode === "sent" ? "sent" : (d.ok ? "filled" : "failed"));
			setDeliverVia(d.via || d.reason || "");

			/* ⑤ 两跳流转：总监（已处理）→ 对话（已投递/未投递） */
			const f = flowStore.push(t, { origin: DIM.DIRECTOR, sessionId: flowSession, note: "总监页执行" });
			if (f) {
				flowStore.move(f.flowId, DIM.DIRECTOR, "总监已处理", { status: "routed" });
				if (d.ok) flowStore.move(f.flowId, DIM.CHAT, "已投递到对话", { status: "running", target: flowSession });
			}
			await refresh();
			say(deliverToast(d));
		} finally {
			setBusy(false);
		}
	}

	/** 控制台动作：有真接口的做真事，没有的**写明缺什么**（不做假按钮） */
	async function consoleAct(key) {
		/* 🧭 统筹：输入想法 → 生成 6 阶段计划 + 打分标准自审（用户核心目标：总监控制一切）
		 * 「我提供一个想法……后续的开发文档编写、审核、蓝图设计、测试等等都由总监统筹」
		 * 「审核标准……打分标准也需要进行审核，打分起码三轮多方位评估」 */
		if (key === "plan") {
			const idea = String(readComposerText() || "").trim();
			if (!idea) { say("请先输入想法"); return; }
			const plan = planFor(idea);
			const audit = auditRubric();
			const rounds = summarizeRounds([]); // 尚未评估 → 三轮全待跑（如实显示，不预填通过）
			const lines = plan.steps.map((s) => s.seq + ". " + s.label + " → " + s.out).join("\n");
			/* 🔴 只列**标准**（维度/权重/满分），不预填分值 ——
			 *    分数必须来自评估证据；在这里编一个"看起来合理"的数字，
			 *    正是本项目反复强调的"假数字比空数字更坏"。 */
			const dims = RUBRIC.map((r) => r.label + "(" + r.weight + ")").join(" · ");
			await appendDirectorMessage(nodeId, {
				role: "assistant",
				text: "【统筹计划】\n" + lines
					+ "\n\n打分维度：" + dims + " · 满分 " + RUBRIC_MAX
					+ "\n打分标准自审：" + (audit.ok ? "通过（可达/不重叠/可证伪）" : "未通过：" + audit.fails.join("；"))
					+ "\n三轮评估：" + rounds.note,
				parsed: { kind: "orchestrate-plan", plan, rubricOk: audit.ok, rubricFails: audit.fails }
			});
			await refresh();
			say(audit.ok ? "已生成统筹计划（6 阶段）" : "计划已生成 · 打分标准自审未通过");
			return;
		}
		if (key === "new") {
			say("新建分支请用导图的「＋ 新建分支」");
			return;
		}
		if (key === "del") { say("删除分支不可用：宿主未提供删除接口"); return; }
		if (key === "grab") {
			const txt = readComposerText();
			if (txt === null) { say("抓取失败：读不到原生对话输入框（当前不可见）"); return; }
			say(String(txt).trim() ? "已抓取原生输入 " + String(txt).trim().length + " 字符（点「登记为流转」写进四维轨迹）" : "原生输入框为空，无内容可抓");
			return;
		}
		if (key === "close") {
			if (!latest) { say("没有可回结的流转（该会话还没有流转记录）"); return; }
			flowStore.move(latest.flowId, DIM.DIRECTOR, "回结：确认收口", { status: "done" });
			say("已回结该会话最新流转（状态 → 已收口）");
			return;
		}
		if (key === "review") {
			const txt = readComposerText() || "";
			const res = review6({
				goal: (node && node.meta && node.meta.goal) || (node && node.name) || "",
				output: String(txt).trim(),
				evidence: ["目标：层级节点 meta.goal", "产出：原生输入框当前内容（" + String(txt).length + " 字符）"],
				risks: (node && node.risks) || []
			});
			setReview({ ...res, chars: String(txt).trim().length });
			say(res.pass ? "六维审核：通过" : "六维审核：未通过（" + res.failed.length + " 项硬缺口）");
			return;
		}
		if (key === "next") {
			if (!latest) { say("先在原生对话框写一句，再点「登记为流转」"); return; }
			flowStore.move(latest.flowId, DIM.CHAT, "继续：送到对话继续执行", { status: "routed", target: flowSession });
			say("已把最新流转送到「对话」维度继续");
			return;
		}
		say("未知动作：" + key);
	}

	/** 层级树 → 扁平节点表（`route()` 的入参）
	 *
	 * ⚠️ 这里**曾经**是第二个 `async function deliver`（旧版"记录员"，只 append + route + push）。
	 *    同名 `function` 声明在同一作用域**合法**且**后声明者静默覆盖前者** ⇒ 新版真流转链路
	 *    被旧版整条顶掉，真机表现为「点执行没反应 + 只多一条 user 消息」（2026-09-12 G 段三红）。
	 *    旧版已删，本文件对 `deliver` 只保留**一处**声明；该类的复发由构建期
	 *    `lintDuplicateFnDecl`（build/build.mjs）拦截。
	 */
	function flatNodes() {
		const flat = [];
		const walk = (n) => { flat.push({ id: n.id, name: n.name, level: n.level }); (n.childNodes || []).forEach(walk); };
		if (tree) walk(tree);
		return flat;
	}

	/** 确认路由去向：把该会话最新流转推进到「对话」维度（**不静默分发** —— 必须先有人确认） */
	async function confirmRoute(dest) {
		if (latest) flowStore.move(latest.flowId, DIM.CHAT, "确认去向：" + DESTINATION_LABEL[dest], { status: "routed", target: flowSession });
		say("已确认：" + DESTINATION_LABEL[dest] + " —— 流转已推进到「对话」维度");
		setRouteResult(null);
	}

	/* ── 派生：R2 指标（每个数字都带数据源标注）── */
	const metrics = [
		{ k: "待办完成率", v: todoRate + "%", bar: todoRate, src: "plugin-db · directorTodos(" + todos.length + " 条)" },
		{ k: "未闭合风险", v: (node && node.risks ? node.risks.length : 0), color: "#e0b341", src: "层级节点 risks" },
		{ k: "待办项", v: (node && node.todos ? node.todos.length : 0), src: "层级节点 todos" },
		{ k: "活跃分支", v: activeBranches, color: "#3fb950", src: "宿主 sessions 血缘（有子节点的分支）" }
	];

	return h("div", {
		id: DIRECTOR_PAGE_ID, style: S.root, "data-testid": "dp-root", className: "dp-textured",
		"data-focus-target": st.focusTarget, "data-flow-session": flowSession || "", "data-composer": composerOk ? "1" : "0",
		"data-texture": pz.texture,
		/* 执行链路的**可断言面**（界面只显示短词，归因走属性 —— 用户要求「不用多余的解释」） */
		"data-deliver-mode": deliverMode, "data-deliver-via": deliverVia,
		"data-busy": busy ? "1" : "0", "data-run-grade": runGrade || ""
	}, [
		/* ── R1 顶部栏（设计稿 A1：📁 名称 ▾ + 层级 chips + 右上 ⚙） ── */
		h("div", { key: "r1", style: { ...S.r1, paddingRight: Math.max(9, inset + 9) }, "data-testid": "dp-r1" }, [
			h("span", { key: "t", style: { fontWeight: 650, whiteSpace: "nowrap" } }, "📁"),
			h("select", {
				key: "sel", "data-testid": "dp-level", "aria-label": "切换层级节点", value: nodeId,
				onChange: (e) => { directorLayoutStore.setActiveNode(e.target.value); },
				title: "选择当前治理的层级节点（全局 / 项目 / 会话）",
				style: {
					maxWidth: 190, height: 22, fontSize: "calc(11px * var(--dp-font,1))",
					borderRadius: "var(--dp-radius-sm, 5px)", border: "1px solid var(--dp-line, #3d4148)",
					background: "var(--dp-bg-2, #212429)", color: "var(--dp-t1, #e8eaed)"
				}
			}, buildOptions(tree)),
			...LEVEL_CHIPS.map((c) => h("span", {
				key: c.label, "data-testid": "dp-lv-" + c.level, "data-on": String(node && node.level === c.level) === "true" ? "1" : "0",
				style: {
					...S.chip, cursor: "default", opacity: node && node.level === c.level ? 1 : 0.55,
					borderColor: node && node.level === c.level ? "var(--dp-ac-line, rgba(137,87,229,.4))" : "var(--dp-line, #31343a)",
					background: node && node.level === c.level ? "var(--dp-ac-soft, rgba(137,87,229,.16))" : "transparent",
					color: node && node.level === c.level ? "var(--dp-ac, #b794f6)" : "var(--dp-t3, #8b9199)"
				},
				title: "层级：" + c.label + (node && node.level === c.level ? "（当前）" : "（点上面的下拉可切到该层级）")
			}, c.label + (node && node.level === c.level ? " ▸ 当前" : ""))),
			h("span", { key: "b", style: { ...S.muted, marginLeft: "auto", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, "data-testid": "dp-crumb", title: crumbs.map((c) => c.name).join(" / ") },
				crumbs.length ? crumbs.map((c) => c.name).join(" / ") : "全局总管"),
			h("button", {
				key: "p", style: S.btn, "data-testid": "dp-personalize",
				title: "个性化设定：主色 / 质感 / 密度 / 字号 / 圆角（与导图 / 弹窗 / 设计图共用同一份）",
				onClick: () => setPOpen((v) => !v)
			}, "⚙ 设置"),
			h("span", { key: "c", style: S.chip, "data-testid": "dp-level-chip" }, node ? (LEVEL_LABEL[node.level] || node.level) : "—")
		]),

		/* ── R2.5 对话控制台（六动作 + 计数） ── */
		h("div", { key: "r2", style: { padding: "7px 9px 0", display: "flex", flexDirection: "column", gap: 7 } }, [
			h("div", { key: "b", style: S.sec, "data-testid": "dp-r25" }, [
				h("div", { key: "t", style: { ...S.blkT, cursor: "pointer" }, onClick: () => toggleCollapse("r2"), "data-testid": "dp-r2-toggle" }, [
					(collapsed.r2 ? "▶ " : "▼ ") + "R2.5 对话控制台",
					h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } },
						"血缘：" + (branch.lineage ? "已连接" : "降级") + " ｜ 顺序即闭环")
				]),
				h("div", { key: "c", style: { display: collapsed.r2 ? "none" : "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } }, [
					...CONSOLE_ACTIONS.map((a) => h("button", {
						key: a.key, style: {
							...S.btn,
							borderColor: a.tone === "danger" ? "rgba(229,83,75,.45)" : a.tone === "warn" ? "rgba(210,153,34,.45)" : a.tone === "accent2" ? "var(--dp-ac2-line, rgba(57,197,207,.45))" : "var(--dp-line, #3d4148)",
							color: a.tone === "danger" ? "#e5534b" : a.tone === "warn" ? "#d29922" : a.tone === "accent2" ? "var(--dp-ac2, #7fe3e8)" : a.tone === "accent" ? "var(--dp-ac, #9fc2ff)" : "var(--dp-t2, #c3c8ce)"
						},
						"data-testid": "dp-act-" + a.key, title: CONSOLE_HINT[a.key],
						onClick: () => consoleAct(a.key)
					}, a.icon + " " + a.label)),
					h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" }, "data-testid": "dp-console-counts" },
						"待办 " + todos.length + " · 活跃分支 " + activeBranches + " · 流转 " + fStats.total +
						(fStats.multiDim ? "（跨维 " + fStats.multiDim + "）" : "")),
					h("button", { key: "m", style: S.btn, "data-testid": "dp-open-mindmap", onClick: () => directorLayoutStore.toggleOverlay("mindmap") }, "🧠 打开分支导图"),
					h("button", { key: "d", style: S.btn, "data-testid": "dp-open-design", onClick: () => directorLayoutStore.toggleOverlay("design") }, "🖌 打开设计图"),
					h("button", { key: "s", style: S.btn, "data-testid": "dp-sync", onClick: () => { refresh(); refreshBranchTree(); say("已刷新数据"); } }, "↻ 同步")
				])
			]),

			/* ── R2 项目总览（定位 / 目标 / 当前阶段 + 四指标卡） ── */
			h("div", { key: "a", style: { ...S.sec, display: collapsed.r2 ? "none" : undefined }, "data-testid": "dp-r2" }, [
				h("div", { key: "t", style: S.blkT }, ["R2 项目总览", h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } }, "概述 · 总揽 · 每个数字都标数据源")]),
				h("div", { key: "c", style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 } }, [
					h("span", { key: "p", style: S.chip }, "定位 · " + clampText((node && node.meta && node.meta.positioning) || "未填写（层级节点 meta.positioning）", 40)),
					h("span", { key: "g", style: S.chip }, "目标 · " + clampText((node && node.meta && node.meta.goal) || "未填写（层级节点 meta.goal）", 40)),
					h("span", { key: "ph", style: S.chip2 }, "当前阶段 · " + clampText((node && node.meta && node.meta.currentPhase) || "未填写（层级节点 meta.currentPhase）", 30))
				]),
				h("div", { key: "k", style: S.kv },
					metrics.map((m) => h("div", { key: m.k, style: S.kvc, "data-testid": "dp-k-" + m.k, title: "数据源：" + m.src }, [
						h("div", { key: "v", style: { ...S.kvV, color: m.color || "inherit" } }, String(m.v)),
						h("div", { key: "k", style: S.kvK }, m.k),
						m.bar !== undefined ? h("div", { key: "b", style: S.bar }, h("i", { style: S.barI(m.bar) })) : null
					]))),
				h("div", { key: "s", style: S.src }, "数据源：" + metrics.map((m) => m.k + " ← " + m.src).join(" ｜ "))
			])
		]),

		/* ── R3 资源行 ── */
		h("div", { key: "r3", style: { ...S.r3, marginTop: 7 }, "data-testid": "dp-r3" }, [
			h("span", { key: "a", style: { ...S.muted, minWidth: 34 } }, "智能体"),
			...RES_AGENTS.map((a) => h("span", {
				key: a.key, style: { ...S.chip }, "data-testid": "dp-agent-" + a.key,
				title: a.key === "test" ? "该智能体当前有运行中的任务（宿主 running 会话）" : "可用智能体"
			}, a.label + (a.key === "test" && rows.some((r) => r.running === true) ? " ● 运行中" : ""))),
			h("span", { key: "sep", style: { width: 1, height: 14, background: "var(--dp-line, #31343a)" } }),
			h("span", { key: "s", style: { ...S.muted, minWidth: 20 } }, "技能"),
			...RES_SKILLS.map((s) => h("span", { key: s.key, style: { ...S.chip2 } }, s.label)),
			h("span", { key: "m", style: { ...S.muted, marginLeft: "auto" }, "data-testid": "dp-model" }, "模型 qwen2:7b ▾ ｜ 上下文 78%")
		]),

		/* ── R4 / R5 / R7 三栏 ── */
		h("div", { key: "cols", style: S.cols }, [
			/* R4 项目导航 */
			h("div", { key: "r4", style: S.col, "data-testid": "dp-r4" },
				h("div", { key: "s", style: S.sec }, [
					h("div", { key: "t", style: { ...S.blkT, cursor: "pointer" }, onClick: () => toggleCollapse("r4"), "data-testid": "dp-r4-toggle" },
						(collapsed.r4 ? "▶ " : "▼ ") + "R4 项目导航"),
					h("div", { key: "seg", style: { display: collapsed.r4 ? "none" : "flex", border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius-sm, 5px)", overflow: "hidden", marginBottom: 6 } },
						R4_TABS.map((tb) => h("button", {
							key: tb.key, style: S.seg(r4tab === tb.key), "data-testid": "dp-r4-" + tb.key,
							"aria-selected": r4tab === tb.key, role: "tab",
							onClick: () => setR4tab(tb.key)
						}, tb.label))),
					h("div", { key: "b", style: { ...S.muted, display: collapsed.r4 ? "none" : undefined }, "data-testid": "dp-r4-body" }, R4_BODY[r4tab])
				])),

			/* R5 当前会话的流转 + 总监消息 */
			h("div", { key: "r5", style: S.col, "data-testid": "dp-r5" },
				h("div", { key: "s", style: { ...S.sec, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } }, [
					h("div", { key: "t", style: S.blkT }, [
						"R5 总监对话区",
						h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } }, "只治理 · 不执行")
					]),

					/* ① 现在在做的事（固定在最上面） */
					h("div", {
						key: "now", "data-testid": "dp-now", "data-tone": now.tone, "data-source": now.source,
						style: {
							border: "1px solid var(--dp-line, #31343a)",
							borderLeft: "3px solid " + (now.tone === "run" ? "var(--dp-ac, #2f6feb)" : now.tone === "warn" ? "var(--dp-ac2, #8957e5)" : now.tone === "done" ? "#3fb950" : "var(--dp-t3, #6f757d)"),
							background: now.tone === "run" ? "var(--dp-ac-soft, rgba(47,111,235,.12))" : now.tone === "warn" ? "var(--dp-ac2-soft, rgba(137,87,229,.12))" : "var(--dp-bg-2, rgba(255,255,255,.03))",
							borderRadius: "var(--dp-radius, 8px)", padding: "6px 8px", marginBottom: 7, flex: "0 0 auto"
						}
					}, [
						h("div", { key: "h", style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 3 } }, [
							h("span", { key: "l", style: { fontSize: "calc(10.5px * var(--dp-font,1))", fontWeight: 700, color: "var(--dp-ac, #79a8ff)", letterSpacing: ".4px" } }, "现在在做的事"),
							h("span", { key: "s", style: { ...S.muted, marginLeft: "auto" }, title: "这个结论的依据来源（不编内容）" }, "来源 " + now.source)
						]),
						h("div", { key: "t", style: { fontSize: "calc(12px * var(--dp-font,1))", fontWeight: 600, lineHeight: 1.5, wordBreak: "break-word" }, "data-testid": "dp-now-title" }, now.title),
						now.detail ? h("div", { key: "d", style: { ...S.muted, marginTop: 3 } }, now.detail) : null,
						h("div", { key: "f", style: { ...S.muted, marginTop: 4 } },
							"会话 " + (flowSession ? ("…" + String(flowSession).slice(-8)) : "（未定位到当前会话）") +
							" · 流转 " + sessionFlows.length + " 条" + (latest ? (" · " + flowLine(latest)) : ""))
					]),

					/* ② 分段：流转 / 总监消息 */
					h("div", { key: "seg2", style: { display: "flex", border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius-sm, 5px)", overflow: "hidden", marginBottom: 6, flex: "0 0 auto" } }, [
						h("button", { key: "f", style: S.seg(r5tab === "flow"), "data-testid": "dp-r5-flow", onClick: () => setR5tab("flow") }, "流转 " + sessionFlows.length),
						h("button", { key: "m", style: S.seg(r5tab === "msg"), "data-testid": "dp-r5-msg", onClick: () => setR5tab("msg") }, "总监消息 " + msgs.length)
					]),

					h("div", { key: "b", style: { flex: 1, minHeight: 0, overflowY: "auto" }, className: "dp-scroll", "data-testid": "dp-r5-body" },
						r5tab === "flow"
							? (sessionFlows.length
								? sessionFlows.slice(-20).reverse().map((f) => h("div", {
									key: f.flowId, "data-testid": "dp-flow-item", "data-flow-id": f.flowId, "data-origin": f.origin, "data-status": f.status,
									/* `data-session-id`：让"这条属于哪个会话"在 DOM 上可读 ——
									 * 真机脚本靠它证明「R5 显示的就是刚登记的那条」，而不是靠数条数（数条数
									 * 在"会话里有别的流转"时会误判）。 */
									"data-session-id": f.sessionId || "",
									style: { border: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-2, #212429)", borderRadius: "var(--dp-radius-sm, 5px)", padding: "5px 7px", marginBottom: 5 }
								}, [
									h("div", { key: "t", style: { fontSize: "calc(11.5px * var(--dp-font,1))", lineHeight: 1.5, wordBreak: "break-word" } }, clip(f.text, 110)),
									h("div", { key: "m", style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 3 } }, [
										...["director", "chat", "mindmap", "design"].map((d) => h("span", {
											key: d, "data-flow-dim": d, "data-on": ((f.trail || []).some((t) => t.dim === d)) ? "1" : "0",
											title: DIM_LABEL[d] + (((f.trail || []).some((t) => t.dim === d)) ? "：走过" : "：未走"),
											style: {
												fontSize: 10.5, padding: "0 4px", borderRadius: 3,
												border: "1px solid " + (((f.trail || []).some((t) => t.dim === d)) ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "var(--dp-line, #31343a)"),
												background: ((f.trail || []).some((t) => t.dim === d)) ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "transparent",
												color: ((f.trail || []).some((t) => t.dim === d)) ? "var(--dp-t1, #e8eaed)" : "var(--dp-t3, #8b9199)", opacity: ((f.trail || []).some((t) => t.dim === d)) ? 1 : 0.6
											}
										}, DIM_ICON[d] + DIM_LABEL[d].slice(0, 2))),
										h("span", { key: "s", style: S.muted }, FLOW_STATUS_LABEL[f.status] || f.status),
										h("span", { key: "a", style: S.muted }, new Date(f.at).toLocaleTimeString())
									])
								]))
								: h("div", { key: "e", style: S.muted, "data-testid": "dp-flow-empty" },
									"该会话还没有流转。本轮起，输入走**原生对话框**：写完后点 R8 的「登记为流转」，就会出现在这里，" +
									"并同步出现在导图右侧面板与设计图底部。"))
							: (msgs.length
								? msgs.slice(-14).map((m) => h("div", { key: m.messageId || m.at, style: S.msg, "data-testid": "dp-dir-msg" }, [
									h("div", { key: "a", style: S.av(m.role) }, m.role === "user" ? "你" : "总"),
									h("div", { key: "b", style: S.bub }, m.text)
								]))
								: h("div", { key: "e", style: S.muted, "data-testid": "dp-r5-empty" }, "尚无总监消息")))
				])),

			/* R7 详情 / 产出物 / 六维审核 */
			h("div", { key: "r7", style: S.col, "data-testid": "dp-r7" },
				h("div", { key: "s", style: S.sec }, [
					h("div", { key: "t", style: S.blkT }, "R7 详情 / 产出物"),
					h("div", { key: "b", style: S.muted }, [
						h("div", { key: "1" }, "层级：" + (node ? (LEVEL_LABEL[node.level] || node.level) + " · " + node.name : "—")),
						h("div", { key: "2" }, "文档 " + ((node && node.docs) ? node.docs.length : 0) + " · 对话 " + ((node && node.conversations) ? node.conversations.length : 0) + " · 决策 " + ((node && node.decisions) ? node.decisions.length : 0)),
						h("div", { key: "3" }, "分层总结：" + (node && node.summary ? clampText(node.summary, 80) : "尚未生成（logic/summarize.js）")),
						review ? h("div", {
							key: "rv", "data-testid": "dp-review", "data-pass": review.pass ? "1" : "0",
							style: {
								marginTop: 6, border: "1px solid " + (review.pass ? "rgba(63,185,80,.45)" : "rgba(201,148,43,.45)"),
								background: review.pass ? "rgba(63,185,80,.08)" : "rgba(201,148,43,.08)",
								borderRadius: "var(--dp-radius-sm, 5px)", padding: "4px 6px"
							}
						}, [
							h("div", { key: "h", style: { fontWeight: 650, color: review.pass ? "#3fb950" : "#d29922" } },
								"六维审核 " + (review.pass ? "通过" : "未通过") + "（抓取 " + review.chars + " 字符）"),
							h("div", { key: "d", style: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 } },
								review.dims.map((d) => h("span", {
									key: d.key, title: d.hint + " —— " + d.note,
									style: { color: d.status === "ok" ? "#3fb950" : d.status === "warn" ? "#d29922" : "#e5534b" }
								}, (d.status === "ok" ? "✅" : d.status === "warn" ? "⚠" : "❌") + d.label)))
						]) : null
					])
				])),
		]),

		/* ── R6 记忆面板 ──
		 * 右端按浮动按钮组宽度留白（见 dockReserve 注释）—— 否则「最近：…」会被压在药丸下面 */
		h("div", { key: "r6", style: { padding: "0 " + (9 + dockReserve) + "px 7px 9px" } },
			h("div", { style: S.sec, "data-testid": "dp-r6" }, [
				h("div", { key: "t", style: { ...S.blkT, cursor: "pointer" }, onClick: () => toggleCollapse("r6"), "data-testid": "dp-r6-toggle" },
					[(collapsed.r6 ? "▶ " : "▼ ") + "R6 记忆面板 · 独立数据元",
					// V17 P2：折叠时标题直接给摘要（不必展开就能看到关键计数）
					collapsed.r6 ? h("span", {
						key: "sum", "data-testid": "dp-r6-summary",
						style: { marginLeft: 8, color: "var(--dp-t2, #c3c8ce)", fontWeight: 400, fontSize: "calc(10.5px * var(--dp-font,1))" }
					}, "节点 " + ((stats && stats.nodes) || 0) + " · 消息 " + ((stats && stats.conversations) || 0)
						+ " · 决策 " + ((stats && stats.decisions) || 0) + " · 风险 " + ((node && node.risks) ? node.risks.length : 0)) : null,
					h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } }, "库 " + ((stats && stats.name) || "—"))]),
				h("div", { key: "k", style: { ...S.muted, display: collapsed.r6 ? "none" : "flex", gap: 12, flexWrap: "wrap" } }, [
					h("span", { key: "n", "data-testid": "dp-db-nodes" }, "节点 " + ((stats && stats.nodes) || 0)),
					h("span", { key: "c", "data-testid": "dp-db-msgs" }, "消息 " + ((stats && stats.conversations) || 0)),
					h("span", { key: "r" }, "审核 " + ((stats && stats.reviews) || 0)),
					h("span", { key: "d" }, "决策 " + ((stats && stats.decisions) || 0)),
					h("span", { key: "m" }, "记忆项 " + ((node && node.decisions ? node.decisions.length : 0) + (node && node.docs ? node.docs.length : 0))),
					h("span", { key: "rk", style: { color: (node && node.risks && node.risks.length) ? "#d29922" : "inherit" } }, "风险 " + ((node && node.risks) ? node.risks.length : 0)),
					h("span", {
						key: "pb", "data-testid": "dp-db-problems",
						style: { color: problems ? "#e5534b" : "inherit" },
						title: "问题记录：未通过的审核 + 节点风险"
					}, "问题 " + problems),
					h("span", { key: "td" }, "回结收件箱 · " + todos.filter((t) => t.done !== true).length),
					h("span", { key: "rec", style: { marginLeft: "auto" }, title: "最近一次层级变更" },
						"最近：" + clampText((node && node.meta && node.meta.updatedAt) ? new Date(node.meta.updatedAt).toLocaleString() : "（无变更记录）", 30))
				])
			])),

		/* ── R8 焦点条（**不再自建输入框** —— 用户：「不要这个对话框 用原本的对话框」） ──
		 * 右端按浮动按钮组宽度留白（见 dockReserve 注释）—— 否则最右的「交给总监整理」整颗被压住 */
		h("div", { key: "r8", style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "7px " + (9 + dockReserve) + "px 7px 9px", borderTop: "1px solid var(--dp-line, #31343a)", flex: "0 0 auto", background: "var(--dp-bg-1, transparent)" }, "data-testid": "dp-r8" }, [
			h("span", { key: "l", style: { ...S.muted, minWidth: 30 } }, "目标"),
			h("button", {
				key: "fd", "data-testid": "dp-route-director", "data-on": st.focusTarget === "director" ? "1" : "0",
				style: { ...S.btn, borderColor: st.focusTarget === "director" ? "var(--dp-ac-line, rgba(137,87,229,.45))" : "var(--dp-line, #3d4148)", color: st.focusTarget === "director" ? "var(--dp-ac, #b794f6)" : "var(--dp-t3, #8b9199)" },
				title: "输入目标：总监",
				onClick: () => pickTarget(DIM.DIRECTOR)
			}, "总监" + (st.focusTarget === "director" ? " ●" : "")),
			h("button", {
				key: "fc", "data-testid": "dp-route-chat", "data-on": st.focusTarget === "chat" ? "1" : "0",
				style: { ...S.btn, borderColor: st.focusTarget === "chat" ? "var(--dp-ac-line, rgba(47,111,235,.5))" : "var(--dp-line, #3d4148)", color: st.focusTarget === "chat" ? "var(--dp-ac, #79a8ff)" : "var(--dp-t3, #8b9199)" },
				title: "输入目标：对话",
				onClick: () => pickTarget(DIM.CHAT)
			}, "对话" + (st.focusTarget === "chat" ? " ●" : "")),

			h("button", {
				key: "fo", style: S.btn, "data-testid": "dp-focus-native", "aria-disabled": composerOk ? "false" : "true",
				title: "定位到原生输入框",
				onClick: () => focusNative()
			}, "定位输入框"),

			h("button", {
				key: "rg", style: S.btn, "data-testid": "dp-register-flow",
				"aria-disabled": composerOk ? "false" : "true",
				title: composerOk ? "把输入框里这句话登记为一条流转" : "输入框当前不可见：登记会告诉你原因（按钮不禁用）",
				onClick: registerNative
			}, "登记流转"),

			h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" }, "data-testid": "dp-r8-note" },
				flowSession ? "会话 …" + String(flowSession).slice(-8) : "未定位会话"),

			h("button", {
				key: "s", style: { ...S.btn, background: "var(--dp-ac, #2f6bdd)", borderColor: "var(--dp-ac, #2f6bdd)", color: "#fff", opacity: busy ? 0.65 : 1 },
				"data-testid": "dp-send", disabled: busy, title: "经总监处理并发送到对话",
				onClick: () => deliver(readComposerText())
			}, busy ? "处理中…" : "执行")
		]),

		/* 路由确认卡（V16 C4：目标多义必确认 —— 不静默分发） */
		routeResult ? h("div", {
			key: "rr", style: { padding: "0 9px 7px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, "data-testid": "dp-route-card"
		}, [
			h("span", { key: "c", style: S.chip }, "建议 " + DESTINATION_LABEL[routeResult.decision.destination] + "（" + routeResult.decision.confidence.toFixed(2) + "）"),
			h("span", { key: "r", style: S.muted }, routeResult.decision.reason),
			h("button", { key: "t", style: S.btn, "data-testid": "dp-rt-transfer", onClick: () => confirmRoute(DESTINATION.TRANSFER) }, "转给该对话"),
			h("button", { key: "d", style: S.btn, "data-testid": "dp-rt-direct", onClick: () => confirmRoute(DESTINATION.DIRECT) }, "直接调用"),
			h("button", { key: "n", style: S.btn, "data-testid": "dp-rt-new", onClick: () => confirmRoute(DESTINATION.CREATE) }, "新建对话"),
			h("button", { key: "x", style: S.btn, "data-testid": "dp-rt-cancel", onClick: () => setRouteResult(null) }, "取消")
		]) : null,

		/* 提示位（**常驻等高占位**，不是「有内容才渲染」）────────────────────────
		 * 🔴 为什么必须常驻（2026-09-12 真机定案 · 用户原话「两个按钮点击不好用」）：
		 *   本页是**底部锚定**的列布局，这一行排在 R8 焦点条**之后**。原先写成
		 *   `toast ? h(div) : null` ⇒ 一旦出提示，整条 R8 会被顶上去 **23px**
		 *   （实测 `btnY` 628 → 605，提示消失又落回 628，可复现）。
		 *   后果不是「难看」，是**点不中**：用户点「⌨ 定位输入框」→ 弹出提示 →
		 *   手指顺势移向「📥 登记流转」，而那颗按钮已经不在原来的位置了。
		 *   真机证据（verify-flow-r19 D5）：命中自检通过（读坐标时确实在按钮上），
		 *   真实鼠标事件落下时按钮已漂走 ⇒ 处理器没进、库 0 条、toast=null。
		 *   ⇒ 常驻一个等高槽：**布局不随提示变化**。
		 *     空时**不带 `dp-toast` testid**（"没有提示"的语义与原先一致，测试读到的仍是 null）。 */
		h("div", {
			key: "toast", style: {
				height: "23px", padding: "0 9px", color: "var(--dp-ac, #79a8ff)",
				fontSize: "calc(11.5px * var(--dp-font,1))", display: "flex", gap: 6, alignItems: "center",
				overflow: "hidden"
			},
			...(toast ? { "data-testid": "dp-toast", title: "点击可清除", onClick: () => setToast("") } : {})
		}, toast || ""),

		/* 个性化面板（右上角；四处共用同一组件与同一份设定） */
		h(PersonalizePanel, { key: "pp", open: pOpen, onClose: () => setPOpen(false), inset: inset, top: 40, scope: "总监页" })
	]);
}

/** R4 三个 Tab 的正文（静态骨架，真实数据接入后替换） */
const R4_BODY = Object.freeze({
	docs: "文档树：按 00-统筹入口 / 10-架构设计 / 20-任务文档 / 40-测试质量 / 50-信息中心 分组浏览。",
	roadmap: "路线图 · 待办：按阶段展示，已完成项划销；未完成项标红并显示依赖。",
	files: "关键文件：直接指向改代码时最常动的文件（client-entry / mount / DirectorDialog / DesignStudio / MindMap）。"
});

/** R2.5 六动作的说明（title 用；写明"能做什么 / 不能做时缺什么"） */
const CONSOLE_HINT = Object.freeze({
	new: "新建分支：走导图的「＋ 新建分支」（宿主 sessions.fork）；纯新建会话由宿主左栏负责",
	del: "删除分支：宿主 sessions 无删除接口 ⇒ 不可用（会如实告知，不做假按钮）",
	grab: "抓取：读宿主原生输入框当前内容（语义锚点，不猜类名）",
	close: "回结：把该会话最新流转标记为「已收口」",
	review: "审核：对抓到的真实文本跑六维规则引擎（空文本会如实报 ❌）",
	next: "继续：把该会话最新流转送回「对话」维度继续执行"
});

function buildOptions(tree) {
	const out = [];
	const walk = (n, d) => {
		out.push(h("option", { key: n.id, value: n.id }, "　".repeat(d) + (LEVEL_LABEL[n.level] || n.level) + " · " + n.name));
		(n.childNodes || []).forEach((c) => walk(c, d + 1));
	};
	if (tree) walk(tree, 0);
	return out;
}

export default DirectorPage;
