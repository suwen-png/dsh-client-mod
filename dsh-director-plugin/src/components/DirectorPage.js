/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总监页（宿主原生 tab 环里的第一个视图）
 * 引用：—
 * 上游：client-entry.js
 * 下游：store/layout.js, store/hierarchy.js, util/bus.js, store/plugin-db.js, logic/routing.js, logic/branch-tree.js, util/debug.js, logic/director-run.js, config/model.js, store/duty-config.js, logic/orchestrate.js, logic/flow.js, bridge/chat-bridge.js, store/personalize.js, components/FloatDock.js, components/PersonalizePanel.js, components/OrchestratorPanel.js, util/safe-area.js, logic/ledger.js, store/docs-index-inject.js, logic/key-files.js, components/DirectorDialog.js, store/agent-runs.js, logic/catalog.js, logic/roles.js, components/ModelSeat.js, bridge/host-composer-slot.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A（总监页 R1–R8）】 · docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 九（编排入口按钮 + 与个性化设定互斥）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/DirectorPage.js — 总监页（宿主原生 tab 环里的第一个视图）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V19-界面调整设计稿.html（第 5 批 10 条）
 *   ├─ 板块 B · R3 资源行**整行去除**（模型/上下文挪到 R8）
 *   ├─ 板块 C · R4/R7 左右缩回 + 弹窗（hover 5s）+ 可固定；R5 消息左右分栏
 *   ├─ 板块 D · 「正在使用 智能体 / 技能」小浮窗
 *   ├─ 板块 E · 按消息判定归属哪个对话（判定结果接入**投递**）
 *   ├─ 板块 F · R6 **整块去除**，有效数据并入 R2
 *   ├─ 板块 G · R4 三 Tab 重定义：路线图 · 待办 / 已完成任务 / 文档树
 *   ├─ 板块 H · R7 ＝ 关键文件 / 产出物（双 Tab）
 *   └─ 板块 I · R4/R7 接**真实数据源**（去掉硬编码占位）
 *  旧稿     docs/50-信息中心/V16/V18 系列（R 区划分与配色沿革）
 *  注册处   src/client-entry.js → installDirectorView(ctx)
 *
 * ══════════════════════════════════════════════════════════════════
 *  R 区与代码的一一对应（改哪个区就改哪一段）
 * ══════════════════════════════════════════════════════════════════
 *   R2.5 对话控制台：六动作 + 待办 / 活跃分支 / 流转 ......... sectionR25()
 *   R2   项目总览：定位 / 目标 / 当前阶段 + 四指标卡 + 库计数 . sectionR2()
 *   R4   左栏：项目导航（路线图·待办 / 已完成任务 / 文档树）.. sectionR4()  ← 缩回栏
 *   R5   中栏：**当前会话的流转信息** + 总监消息（左右分栏）... sectionR5()
 *   R7   右栏：关键文件 / 产出物 ......................... sectionR7()  ← 缩回栏
 *   R8   焦点条：目标路由 + 定位 / 登记 + **模型 ▾ + 上下文** + 执行
 *   ⚠️ R1 已于第 4 批整行取消；R3 资源行、R6 记忆面板于第 5 批整块去除。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 第 5 批的四条硬约束（都是用户原话或已定位根因）
 * ══════════════════════════════════════════════════════════════════
 *  ① 「R6 有用的数据整合到 R2」（板块 F）——
 *     R6 的 节点 / 消息 / 问题 三个数字**并入 R2**，并**保留原 `data-testid`**
 *     （`dp-db-nodes` / `dp-db-msgs` / `dp-db-problems`）—— 锚点是冻结契约（纪律 7），
 *     数据可以搬家，名字不能改。
 *  ② 「R4 修订：路线图待办 / 已完成任务 / 文档树」（板块 G）——
 *     **顺序也变了**：待办提到第一位（用户列的就是这个序）。关键文件搬去 R7。
 *  ③ 「R4 和 R7 对应的功能完善掉，指向的文档逻辑固定」（板块 I）——
 *     三个 Tab 的数据源固定为：03 清单 / 04 清单 / docs 索引树；
 *     R7 关键文件固定为 `logic/key-files.js`（生成式，来源是 src/** 的 @map 头）。
 *     **读不到就说读不到**：索引缺失时显示原因，不静默回落到空列表
 *     （空列表与"真的没有待办"在界面上无法区分 —— 那是最坏的假绿）。
 *  ④ 「有流转，但没有判断应该根据消息放到哪个对话」（板块 E）——
 *     `route()` 判出来的 `candidates[0].nodeId` 以前**只写进决策记录**，
 *     投递路径用的却是"当前会话"。现在：目标 id 落进 `flowStore.move.target`，
 *     且**只在该目标真有对话时**才投递（文件夹/项目级没有对话 ⇒ 如实说，不静默）。
 *
 * ⚠️ 与 DirectorDialog 的关系：**两者并存，不互斥**，共用同一批 store ⇒ 数据必然一致。
 * ⚠️ 构建约束：react / react/jsx-runtime 为平台冻结模块（ADR-001），构建期外置。
 */

import * as react from "react";
import { directorLayoutStore, TODO_NOTE_MAX_CHARS, todoNoteKey } from "../store/layout.js";
import { loadTree, getBreadcrumb, LEVEL_LABEL, GLOBAL_NODE_ID, countByLevel, SCOPE_KIND, scopeKindOf, scopeKeyOf, scopeHasConversation, findNodeBySessionId, findNodeById } from "../store/hierarchy.js";
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
import { OrchestratorPanel } from "./OrchestratorPanel.js";
import { readInset } from "../util/safe-area.js";
/* R4 三个 Tab 的真实数据源（板块 G / I） */
import { loadLedgerView, getLedgerViewSync, readDocContent } from "../logic/ledger.js";
import { getDocsIndexSync } from "../store/docs-index-inject.js";
/* R7「关键文件」的生成式数据源（板块 H / I） */
import { KEY_FILES, KEY_FILES_TOTAL } from "../logic/key-files.js";
/* 「正在使用」浮窗的数据源 —— 复用既有实现，不新造一份（板块 D） */
import { AGENTS, SKILLS, listAgentRuns } from "./DirectorDialog.js";
/* 🔴 第 6 批需求 6「执行状态 · 调用技能的窗口」——
 *   改前：数据只有 `listAgentRuns()` 一份（且只由弹窗手工点击写入），窗口"有内容才挂载"
 *         ⇒ 正常使用**永远看不到**（用户原话：「还是没有」）。
 *   改后：① 执行链 run（含五步逐条）由 `beginChain/fillChainSteps/endChain` 上报；
 *         ② 窗口**常驻**，空态写明"还没有执行记录"；③ 用 `useSyncExternalStore` 订阅，
 *         跑动过程中逐步刷新（不是跑完才看到）。
 *   角色 → 执行入口的指向表来自 `logic/roles.js#ROLE_TARGETS`（与链条指向同源）。 */
import {
	latestChain, activeChain, subscribeRuns, runsVersion, runsState, RUN_STATUS,
	beginChain, fillChainSteps, endChain
} from "../store/agent-runs.js";
import { CHAIN_TARGETS, targetOf, shortTarget } from "../logic/catalog.js";
import { ROLE_TARGETS } from "../logic/roles.js";
/* 第 6 批需求 8：**唯一**的模型选择器组件（同时是宿主标准席位
 * `conversation.input.model` 的组件）—— 一处逻辑，两个挂载点。 */
import { ModelSeat } from "./ModelSeat.js";
/* 第 6 批需求 7/9：宿主底部统计行之前注入的**单按钮**视图切换 + 两个动作的宿主侧契约。
 * ⚠️ 依赖方向是**单向**的（组件 → 桥接）：桥接不 import 组件，只认 handler 契约。 */
import { installHostComposerSlot, syncHostComposerSlot, setHostComposerHandlers, composerSlotState, SCOPE_TOGGLE_ID } from "../bridge/host-composer-slot.js";
import { syncConversationMirror } from "../bridge/chat-bridge.js";

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

/**
 * R4 三 Tab（V19 板块 G · **顺序即用户列的序**）
 *   「r4 修订, 变成 路线图代办/ 已完成任务/文档树」
 * ⇒ 原顺序是 文档树 / 路线图·待办 / 关键文件；现在：待办提前、关键文件**搬去 R7**。
 * ⚠️ `roadmap` / `docs` 两个 key 保留原字面量 ⇒ `dp-r4-roadmap` / `dp-r4-docs` 锚点不变；
 *    `files` 从 R4 消失（它的新家是 R7），新增 `done`。
 */
export const R4_TABS = Object.freeze([
	{ key: "roadmap", label: "路线图 · 待办" },
	{ key: "done", label: "已完成任务" },
	{ key: "docs", label: "文档树" }
]);

/** R7 双 Tab（V19 板块 H：接住从 R4 搬来的「关键文件」） */
export const R7_TABS = Object.freeze([
	{ key: "files", label: "关键文件" },
	{ key: "outputs", label: "产出物" }
]);

/* ── R4 / R7 的「左右缩回 · 弹出 · 固定」（V18 板块 E，第 5 批落地）────────────
 *  三个时长集中放这里（设计稿要求"可配常量、不散落"）。
 *
 *  🔴 第 6 批 · V20 需求 2：「现在是总监tap页面, r4和r7的鼠标移动不好用」
 *     真因**不是**"没有 hover 逻辑"，而是**闸门时长过长**：改前 `RAIL_HOVER_MS = 5000`
 *     —— 用户必须把鼠标**停满 5 秒**才展开，手感上等同"移过去没反应"。
 *     当时取 5 秒的理由（"R4/R7 与对话区相邻，鼠标横穿必然路过，即弹会误触"）仍然成立，
 *     所以不是取消时间闸，而是把它压到**人能感知为"停一下"**的量级：
 *       500ms ≈ "移过去、稳一下" 的自然停顿；横穿（<200ms）仍被过滤掉。
 *  🔴 两个时长**必须一起进 DOM**（`data-rail-hover-ms` / `data-rail-retract-ms`）：
 *     `verify-v17-sync.mjs` 的 A5 段写死 `sleep(5400)`，一旦这里改小，闸门就会
 *     "多等 10 倍"却仍然是绿的 —— 属纪律 14「闸门自己会过期」的温床。
 *     ⇒ 判据改为**从 DOM 读这两个数**（纪律 29：环境的量由环境读，不写死）。 */
export const RAIL_HOVER_MS = 500;
export const RAIL_RETRACT_MS = 300;
export const RAIL_WIDTH = 26;
/** 展开态的栏宽 —— ⚠️ 第 6 批起**降级为"默认值"**：真实宽度取自
 *  `directorLayoutStore.railWidth`（可拖拽、持久化，见 V20 需求 5）。
 *  留它们是为了**兼容旧引用**（`verify-*` 与设计稿里的数字），不再是真相源。 */
export const COL_R4_W = 200;
export const COL_R7_W = 210;

/* ── 第 6 批（V20 需求 4）：关键文件要显示「绝对路径」⇒ 需要项目根 ────────────
 *  🔴 为什么是**常量兜底**而不是"运行时探测根目录"：渲染进程**没有文件系统通道** ——
 *     T5 实测（见 `store/file-adapter.js` 头注释）：`window.require` / `global.require` /
 *     `electron.remote.require` / `process` **全部 `undefined`**（contextIsolation 生效）
 *     ⇒ 拿不到 cwd，也拿不到任何路径。
 *  🔴 环境量仍然优先（纪律 29）：`window.__dshProjectRoot` 存在就用它（换机器/换目录时
 *     由注入方给出），否则退回本仓库既知根。**用的是哪一个会写进 DOM**
 *     （`dp-root[data-file-root-src]` = `env` / `fallback`）⇒ 闸门可断言，不靠猜。 */
export const PROJECT_ROOT_FALLBACK = "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin";
export function projectRoot() {
	try {
		if (typeof window !== "undefined") {
			const w = window.__dshProjectRoot;
			if (w && typeof w === "string" && w.trim()) return { root: w.trim().replace(/[\\/]+$/, ""), src: "env" };
		}
	} catch (e) { /* 无 window（单测） */ }
	return { root: PROJECT_ROOT_FALLBACK, src: "fallback" };
}

/** 「正在使用」的判定窗口：最近 5 分钟内有调用记录的智能体 / 技能 */
export const RUNNING_WINDOW_MS = 5 * 60 * 1000;

const S = {
	root: {
		position: "relative",
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
	/* ⚠️ 原 `r1`（顶部栏）与 `r3`（资源行）样式已分别于第 4 / 第 5 批删除 ——
	 *    留一个没人用的样式对象只会让下一个人以为那两个区还在。 */
	/* 🔴 第 6 批 · V20 需求 5：「r4.r5,r7中间拼接的部分都改成无缝的, 靠在一起就行」
	 *   改前 `gap: 7` ⇒ 三栏之间各留 7px 缝。改 0 后相邻 `S.sec` 的 1px 边框直接相接
	 *   （视觉上合成一条分隔线），而 `padding` 保留 ⇒ 整组外缘仍有 7px 呼吸位。 */
	cols: { display: "grid", gap: 0, padding: "7px 9px", flex: 1, minHeight: 0, alignItems: "stretch" },
	/* ⚠️ `position:"relative"` 是第 6 批**宽度拖拽条**的定位上下文（吸附在栏的内侧边） */
	col: { display: "flex", flexDirection: "column", gap: 7, minHeight: 0, minWidth: 0, position: "relative" },
	/* 🔴 缩回栏：26px 宽、上下占满（align-items:stretch 由 S.cols 保证） */
	rail: {
		border: "1px solid var(--dp-line, #31343d)", borderRadius: "var(--dp-radius, 8px)",
		background: "var(--dp-bg-1, #1c1e22)", cursor: "pointer", minHeight: 0,
		display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
		padding: "8px 0", userSelect: "none"
	},
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
	/* 🔴 消息行：左右分栏（第 5 批 · 用户「对话我发的消息要在右侧,一左一右,做一个轻微的颜色区分」）
	 *    ⚠️ 只做**轻微**区分：背景 + 1px 边框两档，不加大色块。
	 *    ⚠️ 气泡最大宽 74% —— 留出对侧空白，"一左一右"才看得出来。 */
	msgRow: (mine) => ({
		display: "flex", gap: 6, marginBottom: 6,
		fontSize: "calc(11.5px * var(--dp-font,1))",
		justifyContent: mine ? "flex-end" : "flex-start", alignItems: "flex-start"
	}),
	av: (mine) => ({
		width: 18, height: 18, flex: "0 0 18px", borderRadius: "var(--dp-radius-sm, 5px)",
		display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700,
		background: mine ? "var(--dp-ac-soft, rgba(47,111,235,.18))" : "var(--dp-ac2-soft, rgba(137,87,229,.22))",
		color: mine ? "var(--dp-ac, #79a8ff)" : "var(--dp-ac2, #b794f6)"
	}),
	bub: (mine) => ({
		background: mine ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "var(--dp-bg-2, #212429)",
		border: "1px solid " + (mine ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "var(--dp-line, #31343a)"),
		borderRadius: "var(--dp-radius-sm, 5px)", padding: "5px 8px", maxWidth: "74%", minWidth: 0,
		lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word"
	}),
	muted: { fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", lineHeight: 1.55 },
	src: {
		fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #6f757d)",
		borderTop: "1px dashed var(--dp-line, #31343a)", marginTop: 6, paddingTop: 4, lineHeight: 1.5
	},
	row: {
		display: "flex", gap: 5, alignItems: "baseline", padding: "3px 0",
		borderBottom: "1px solid var(--dp-line, #2a2d33)", lineHeight: 1.45
	},
	idm: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-ac, #9fc2ff)", flex: "0 0 auto" }
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
	const [r4tab, setR4tab] = react.useState("roadmap");
	const [r7tab, setR7tab] = react.useState("files");
	const [r5tab, setR5tab] = react.useState("flow");
	/* 第 6 批需求 7：R5 的**双视图**（总监五步消息 / 对话消息含历史）。
	 * 🔴 由宿主底部注入的单按钮（`#dsh-host-scope-toggle`）驱动，「默认显示总监」
	 *    （用户原话）⇒ 初值 "director"。它与 `r5tab`（流转/总监消息）**正交**：
	 *    切到 chat 时整体替换 R5 正文，切回来时原样恢复（r5tab 不丢 —— 用户之前在
	 *    看"流转"还是"总监消息"会保留，符合"缩回原样恢复"的既有交互约定）。 */
	const [r5view, setR5view] = react.useState("director");
	/* 对话消息快照（宿主 DOM 读取，未读到时 `chatSnap.ok=false` + reason，不编空列表） */
	const [chatSnap, setChatSnap] = react.useState(null);
	const [routeResult, setRouteResult] = react.useState(null);
	const [review, setReview] = react.useState(null);
	const [toast, setToast] = react.useState("");
	const [pOpen, setPOpen] = react.useState(false);
	/* 编排面板（2026-09-14 架构补全）：与个性化面板**互斥**，避免两个浮层叠在一起。
	 * 🔴 开合型控件：打开一个必须关掉另一个 —— 否则叠层会挡住后续点击（纪律见技能
	 *    test-truthfulness-audit：开合型按钮被点到必须当场还原）。 */
	const [oOpen, setOOpen] = react.useState(false);
	const [curId, setCurId] = react.useState(null);
	const [composerOk, setComposerOk] = react.useState(false);
	/* ⚠️ 原 `mOpen` / `modelStatus` / `cfgTick` 三个 state 与 `cfg` memo 已随
	 * 「模型菜单残骸」一并删除（第 6 批需求 8 的处置，见下方「模型选择」块注释）——
	 * 它们当时只服务于那段**没有任何渲染**的死代码。 */
	const [onUserText, setOnUserText] = react.useState(""); // 登记流转时的原文（标记"哪条是你发的"）
	/* ── 第 6 批（V20 需求 3）：R4 条目「点开占用总监对话区」─────────────────
	 *  用户原话：「每一项点开的时候占用总监对话区，缩回去的时候再显示总监对话区
	 *             这部分的交互逻辑完善一下，思考怎么样的交互是符合规范且顺手的」
	 *  ⇒ 交互定案：**点一下展开（占用 R5）、再点同一条缩回**（同一个开关，
	 *    不用去找"关闭"按钮）；详情卡里另给「← 缩回」做显式出口。
	 *    **不新开列** —— R4→R7 的网格列数是第 6 批刚验收过的（需求 5 无缝拼接 +
	 *    自由拖拽），多一列会把刚对齐的宽度全部推翻。 */
	const [selectedItem, setSelectedItem] = react.useState(null);
	/* 补充说明：**已保存的那份从 store 派生**（`st.todoNotes`，随 store 订阅实时刷新），
	 * `noteDraft` 才是本地输入态。
	 * 🔴 必须分开存 —— 只留 draft 的话"未保存"与"已保存"在界面上无法区分，
	 *    用户会以为写进去了（这正是"点开就有、刷新就没了"这类投诉的来源）。 */
	const [noteDraft, setNoteDraft] = react.useState("");
	/* R4 文档树的钻孔视图（点一篇文档 → 看正文；这是"文档树可用"的落点，
	 * 不是装饰：`assets/docs-index.json` 里带每篇的 content） */
	const [docPath, setDocPath] = react.useState(null);
	/* R4/R7 的展开态（易失，不持久化）—— 钉住态走 store */
	const [railOpen, setRailOpen] = react.useState({ r4: false, r7: false });
	/* 第 6 批：哪一栏正在被拖宽（用于把拖拽条染成高亮色 —— 拖动时要有"抓住了"的反馈） */
	const [dragSide, setDragSide] = react.useState(null);
	/* V17 P2：R2 区域可折叠（CSS display 控制，不改 DOM 结构） */
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
	const railTimers = react.useRef({ r4: null, r7: null });

	const nodeId = st.activeNodeId || GLOBAL_NODE_ID;
	/* 🔴 作用域 id 的「读真值」通道（2026-09-14 实测根因，见 `liveRef` 块）：
	 *   `refresh()` 会被**宿主注入条**的 handler 间接调用（`deliver` → `await refresh()`），
	 *   而那个 handler 的闭包停在**装载帧** —— 装载帧 `tree` 还没到 ⇒ `st.activeNodeId` 为 null
	 *   ⇒ 闭包里的 `nodeId` 是 `__global__`。
	 *   后果实测（真机 `消息 8 → 0`）：写入那一侧我已改成 `liveRef.current.nodeId`（消息**确实**
	 *   落进了本作用域的桶，库里查得到），但紧随其后的 `refresh()` 仍按 `__global__` 去读
	 *   ⇒ `setMsgs([])` ⇒ R5「总监消息」被**刷成 0**，G3/G3a/G3b 三条一起红，
	 *   读数像"处理链根本没落库"，其实是**读错了桶**。
	 *   ⇒ `refresh` 内部一律读 ref；`useCallback` 的依赖**仍保留 `nodeId`**
	 *     —— 依赖是"什么时候该重跑"（切作用域必须重载，D8/D9 靠它），
	 *        ref 是"跑的时候用哪个值"。两者职责不同，缺一不可。 */
	const nodeIdRef = react.useRef(nodeId);
	nodeIdRef.current = nodeId;
	const say = (m) => {
		setToast(m);
		if (toastTimer.current) clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToast(""), 2600);
	};

	/* ── 第 6 批（V20 需求 4）：复制文本到剪贴板（R7 关键文件的降级落点）──────────
	 *  🔴 用户要的是「点击名称进入文件 / 点击路径打开文件夹」，但渲染进程**没有文件系统与外壳通道**
	 *     —— T5 实测（`store/file-adapter.js` 头注释）：`window.require` / `global.require` /
	 *     `electron.remote.require` / `process` **全部 `undefined`**（contextIsolation 生效）。
	 *     ⇒ **不假装能做到**：把"复制绝对路径"这个**真实发生**的动作做掉，
	 *       并把"为什么只能复制"同时写进按钮 `title` 与点击后的 toast（纪律 19：降级可以，无声不行）。
	 *  🔴 两级通道：`navigator.clipboard.writeText` → 失败退 `document.execCommand("copy")`。
	 *     **两级都失败必须返回 false**，由调用方报"复制失败"—— 不许假成功。
	 *     （真机实测 `navigator.clipboard` 是 object，但剪贴板权限在没有用户手势/无焦点时会 reject。） */
	function legacyCopy(t) {
		try {
			const ta = document.createElement("textarea");
			ta.value = t; ta.setAttribute("readonly", "");
			ta.style.position = "fixed"; ta.style.left = "-9999px"; ta.style.top = "0";
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand("copy");
			document.body.removeChild(ta);
			return !!ok;
		} catch (e) { return false; }
	}
	function copyText(text) {
		const t = String(text == null ? "" : text);
		if (!t) return Promise.resolve(false);
		try {
			if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
				return Promise.resolve(navigator.clipboard.writeText(t)).then(() => true, () => legacyCopy(t));
			}
		} catch (e) { /* 落到 legacy */ }
		return Promise.resolve(legacyCopy(t));
	}
	/** 复制 + 如实播报（成功/失败两条不同的文案，可被闸门按文案区分） */
	function copyPath(text, what) {
		copyText(text).then((ok) => {
			say(ok ? ("已复制" + (what || "路径") + "：" + text)
				: ("复制失败（" + (what || "路径") + "）· 请手动选中复制：" + text));
		});
	}

	/* R4/R7 的真实数据源。同步先取一版（此时索引可能还没加载 ⇒ ok=false + reason），
	 * 再由下方 effect 异步补一次。🔴 不静默回落空列表 —— 失败时 `ok:false` 且带 reason。 */
	const [ledgerView, setLedgerView] = react.useState(() => getLedgerViewSync());
	const docsIdxRef = react.useRef(getDocsIndexSync());

	const refresh = react.useCallback(async () => {
		try {
			/* ⚠️ 一律读 ref（见 `nodeIdRef` 注释）：本函数会被装载帧的 handler 调用，
			 *    用闭包里的 `nodeId` 会按过期作用域去读 ⇒ 把消息列表刷成 0。 */
			const id = nodeIdRef.current;
			setTree(await loadTree());
			setCrumbs(await getBreadcrumb(id));
			const list = (await listDirectorMessages(id)) || [];
			/* 同步 ref：runDirector 要在**上屏前**读「本条之前的上下文」，
			 * 若用 state 会拿到闭包里的旧值（少一轮）。 */
			msgsRef.current = list;
			setMsgs(list);
			setTodos((await listTodos(id)) || []);
			/* 问题记录（R5「工作顺序 / 待完成清单 / 问题记录 全部实时更新」）：
			 * 源 = 未通过的审核 + 节点风险。两个源都取自真实库，不编数。 */
			setReviews((await listReviews(id)) || []);
			setStats(await pluginDbStats());
		} catch (e) { /* 数据层异常不影响 UI */ }
	}, [nodeId]);

	/* R4/R7 的真实数据源：索引可能还没加载 ⇒ 先同步读一版（可能 ok=false），再异步补一次。
	 * 🔴 不静默回落空列表 —— 失败时 `ledgerView.ok === false` 且带 reason，界面显示原因。 */
	react.useEffect(() => {
		let alive = true;
		(async () => {
			const v = await loadLedgerView();
			if (!alive) return;
			docsIdxRef.current = getDocsIndexSync();
			setLedgerView(v);
		})();
		return () => { alive = false; };
	}, []);

	react.useEffect(() => { refresh(); }, [refresh]);
	react.useEffect(() => onHierarchyChange(() => refresh()), [refresh]);
	react.useEffect(() => { refreshBranchTree().catch(() => { }); return subscribeBranch(setBranch); }, []);
	/* 跟随宿主当前会话（左栏点会话插件收不到事件 ⇒ 轮询单字段）。
	 * ⚠️ 2026-09-14 第 4 批：这里**不再直接写 flowStore.setActiveSession** ——
	 *    作用域已由下拉唯一决定（见文件下方 scope 注释块），流转归属统一由 scopeKey 派生。 */
	react.useEffect(() => watchCurrentSession((id) => setCurId(id)), []);
	/* 宿主切了会话 ⇒ 把**下拉**也切到对应节点（用户：「就相当于切对话了」）。
	 *
	 * 🔴 三条边界，缺一条就会变成"抢用户的鼠标"：
	 *   ① **同一个会话只跟随一次**（`lastFollowRef`）—— 否则用户在总监页手动选到
	 *      「全局总管」后，任何一次重渲染都会把他弹回会话节点（下拉按不动）。
	 *   ② **树未加载 / 反查不到节点 ⇒ 不动**，不猜一个节点顶替（宁可保持原选择）。
	 *   ③ 只在真的不同值时写 `activeNodeId`（同值写入会白触发一轮全页刷新）。
	 * ⚠️ 本 hook 只依赖在它**之前**就已定义的 tree / curId / st，不得引用下方
	 *    才声明的 `scopeKey`（否则是 TDZ 报错，不是"没生效"）。 */
	const lastFollowRef = react.useRef(null);
	react.useEffect(() => {
		if (!tree || !curId) return;
		if (lastFollowRef.current === curId) return;
		const n = findNodeBySessionId(tree, curId);
		if (!n) return;
		lastFollowRef.current = curId;
		if (st.activeNodeId !== n.id) directorLayoutStore.setActiveNode(n.id);
	}, [tree, curId, st.activeNodeId]);
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
	/* 缩回栏的计时器收尾（组件卸载时清干净 —— 否则会在已卸载组件上 setState） */
	react.useEffect(() => () => {
		if (railTimers.current.r4) clearTimeout(railTimers.current.r4);
		if (railTimers.current.r7) clearTimeout(railTimers.current.r7);
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
	/* ── 作用域（scope）唯一真相源 ────────────────────────────────────────
	 * 🔴 2026-09-14 第 4 批 · 需求 ②③（用户原话见 store/hierarchy.js 的 scope 注释块）：
	 *    「我在下列表切换的时候，我下面的总监和对话数据也要一起变，就是相当于切对话了；
	 *      切换文件夹的时候不需要对话，因为没有」
	 *    ⇒ 本页**只认下拉选中的节点**（`st.activeNodeId`）。原先这里写的是
	 *      `curId || (nodeId 以 s_ 开头 ? nodeId : null)` —— 即**宿主当前会话压倒一切**：
	 *      用户把下拉切到别的节点，`curId` 没变，R5 仍按宿主会话过滤 ⇒
	 *      "切了下拉数据不动"，正是他报的现象。
	 *    ⇒ 现在：scope 由节点决定；宿主切会话时**反向写回 activeNodeId**（见下面的跟随 effect），
	 *      于是"点左侧切对话、插件跟着切"的能力仍在，而真相源只剩一处。
	 * 三态：会话节点 → 真实会话 id；文件夹/全局节点 → 节点 id（各自一份总监数据，且**没有对话**）。 */
	const scopeKind = scopeKindOf(node);
	const scopeKey = scopeKeyOf(nodeId, node);
	const scopeHasChat = scopeHasConversation(node);
	/** 本页显示"哪个作用域的流转"（= scopeKey，见上） */
	const flowSession = scopeKey;
	const sessionFlows = flowStore.ofSession(flowSession);
	const latest = sessionFlows.length ? sessionFlows[sessionFlows.length - 1] : null;
	/* ⚠️ 只在该作用域**真有对话**时才有"会话行"可比对；文件夹/全局作用域下
	 *    伪造一行 `{title:"该对话"}` 会让「现在在做的事」说出不存在的话
	 *    （项目纪律：读不到就说读不到，不编）。故非会话作用域传 null。 */
	const nowRow = scopeHasChat
		? (rows.find((r) => r.sessionId === scopeKey) || { sessionId: scopeKey, title: "该对话", state: "idle" })
		: null;
	const now = currentTaskOf({ node: nowRow, flow: latest, flowList: sessionFlows, msgs });
	/** 作用域的中文种类名（空态文案与 title 用；不编层级名） */
	const scopeKindLabel = scopeKind === SCOPE_KIND.SESSION ? "对话级"
		: scopeKind === SCOPE_KIND.FOLDER ? "文件夹级" : "全局级";
	/* 作用域变更 → 流转层的"当前会话"（flow.js 的 activeSessionId，供跨界面未读提示用） */
	react.useEffect(() => { flowStore.setActiveSession(scopeKey); }, [scopeKey]);

	/* ── 宿主注入条的「读真值」通道（🔴 2026-09-14 实测根因，代价已付）────────────
	 *  宿主注入条的四个 handler 由下面的 `useEffect` 装一次。若它们**闭包捕获当帧值**，
	 *  就会永远停在"装载那一帧"——而装载帧恰恰是**最不可信**的一帧。
	 *
	 *  真机取证（往原生输入框写文本 → 真实点击「登记流转」）：
	 *    页面当前帧 `data-scope`  = `session-472cbb4c-…`（原生会话 id，`scopeKind=session`）
	 *    handler 写进库的 `sessionId` = `se_session-472cbb4c-…`（**树节点 id**）
	 *  差一个 `se_` 前缀 ⇒ 落在**另一个桶** ⇒ R5（用当帧 scope 过滤）一条也读不到。
	 *  用户看到的正是「点了登记流转，右边什么都不出现」；而库里那条**确实存在** ⇒
	 *  断言与目测都会读成"产品坏了"，其实是**读的是两个不同的桶**。
	 *
	 *  为什么停在装载帧：`loadTree()` 是异步的 ⇒ 装载帧 `node` 还是 `null` ⇒
	 *  `scopeKeyOf(nodeId, null)` 退化成 `String(nodeId)`（节点 id），
	 *  而节点 id 恰恰是 `se_<sessionId>`（`logic/discover.js` 的 `ID_PREFIX`）。
	 *  ⚠️ 这一处**恰好绕过**了「作用域唯一真相源」—— 它确实调了 `scopeKeyOf()`，
	 *     只是喂进去的是**过期帧的 node（null）**。唯一真相源能被过期输入喂坏。
	 *
	 *  ⇒ 四个 handler 一律**现读** ref（与上文 `composerOk` 那条
	 *    「按钮永远可点、真值在点击那一刻读」是同一道理，纪律 36 的同一类坑）。
	 *  每帧同步写：ref 赋值在渲染期完成，handler 只可能在提交后被用户点击调用。 */
	const liveRef = react.useRef({});
	liveRef.current = { view: r5view, scope: flowSession, nodeId, busy };
	/* 选中条目 / 切换作用域时**重新装载**该条的补充说明（纪律 26：读原值再改）。
	 * 🔴 依赖里必须带 `scopeKey` —— 补充说明是**按作用域存**的：
	 *    同一条 `T-INIT-003` 在"全局层"和某个会话层是**两条不同的说明**。
	 *    漏了它 ⇒ 切作用域后输入框还显示上一个作用域的内容，
	 *    用户一保存就把 A 作用域的说明写进了 B 作用域（而且**任何断言都不会红**，
	 *    因为写确实是成功的 —— 这是本项目最典型的一类"写法合法、行为静默错"）。 */
	react.useEffect(() => {
		if (!selectedItem || selectedItem.kind !== "roadmap") { setNoteDraft(""); return; }
		const row = (directorLayoutStore.getState().todoNotes || {})[todoNoteKey(scopeKey, selectedItem.id)];
		setNoteDraft((row && row.note) || "");
	}, [selectedItem, scopeKey]);

	/* ── 第 6 批需求 7/9：宿主底部注入条的行为接线（单向：本组件 → 桥接）────────
	 *  为什么要 `useEffect` 而不是在渲染期直接调：`setHostComposerHandlers` 会
	 *  **同步触发一次 DOM 同步**（`syncHostComposerSlot`），在渲染期做 DOM 写属于副作用。
	 *
	 *  🔴 2026-09-14 改（**根因修复，取代原先"把值写进依赖数组"的做法**）：
	 *    旧写法依赖 `[r5view, busy]`，靠"依赖变了就重装一遍 handler"来让闭包追上现值 ——
	 *    这只是**把漏值的地方从 2 个缩小到 2 个**，没有消灭这一类错：
	 *      · `onRegister` / `onDeliver` 闭包捕获的 `flowSession` / `nodeId` **不在依赖里**
	 *        ⇒ `loadTree()` 一到就变的作用域，永远不会反映到 handler 上（实测落错桶）；
	 *      · `deliver` 的 `busy` 重入闸门同样是快照。
	 *    ⇒ 现在四个 handler 全部**经由 `liveRef` 现读**（见上文 ref 块），依赖数组可为空：
	 *      不再有"哪个值忘了进依赖"的可能 —— 这类遗漏**永远不会报错**，
	 *      只会表现为"数据偶尔串桶"，正是本项目反复强调的「写法合法、行为静默错」。 */
	react.useEffect(() => {
		installHostComposerSlot();
		setHostComposerHandlers({
			getView: () => liveRef.current.view,
			onToggleScope: () => setR5view((v) => (v === "chat" ? "director" : "chat")),
			onDeliver: () => deliver(readComposerText()),
			onRegister: () => registerNative(),
			canDeliver: () => !liveRef.current.busy
		});
	}, []);

	/* 切到「对话」视图时读宿主消息列表；回到「总监」时清掉快照。
	 *
	 * 🔴 第 6 批需求 7 的现实约束（2026-09-14 两条实测，见 `bridge/chat-bridge.js`
	 *    `conversationMirror` 的论证）：**总监页签下宿主消息列表整体不在 DOM**
	 *    （页签是"内容互换"不是"隐藏"），而逻辑层没有对话正文
	 *    ⇒ 现读 DOM 在结构上不可能成立 ⇒ 改为消费**镜像**：
	 *      · 宿主【对话】页签在场时（后台轮询）持续累积；
	 *      · 不在场时保留上一次快照，并把"当前为什么没更新"如实带出来。
	 *    界面必须同时说清**两件事**：数据是什么时候的、现在为什么没刷新（纪律 19）。 */
	react.useEffect(() => {
		if (r5view !== "chat") { setChatSnap(null); return; }
		const read = () => {
			try {
				const m = syncConversationMirror(60);
				if (m.items.length > 0) {
					setChatSnap({
						ok: true, total: m.total, items: m.items, at: m.at, live: m.reason === null,
						reason: m.reason, syncs: m.syncs
					});
				} else {
					setChatSnap({ ok: false, total: 0, items: [], at: m.at, live: false, reason: m.reason, syncs: m.syncs });
				}
			} catch (e) { setChatSnap({ ok: false, total: 0, items: [], at: 0, live: false, reason: "读取抛错：" + ((e && e.message) || e) }); }
		};
		read();
		/* 3s 轮询跟随：镜像本身也在后台同步，这里只是把结果搬进视图。
		 * （不做 MutationObserver：活在宿主容器上的观察器与并发工作线的重建行为耦合，代价不值。） */
		const t = setInterval(read, 3000);
		return () => clearInterval(t);
	}, [r5view]);
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
	 * ⇒ 这两行按浮动按钮组宽度留出右边距（横向避让，和原先 R1 的 `inset` 是同一类做法）。
	 * ⚠️ 读的是**布局状态**而不是写死留白：浮动按钮组被关掉时不留空。
	 * ⚠️ 只管通栏行 —— R7 是 210px 宽的右栏，给它留 108px 会把栏挤没。 */
	const dockReserve = st.floatDockOpen === false ? 0 : FLOAT_DOCK_RESERVE;

	/* ── 执行状态 · 技能 / 智能体调用（第 6 批需求 6）─────────────────────
	 * 用户原话：「我要的执行状态调用技能的窗口还是没有, 具体实现逻辑也要完善」
	 *
	 * 🔴 改前为什么"还是没有"（三个原因各自都够呛，缺一不可）：
	 *   ① 数据只来自 `listAgentRuns()`，而它**只由总监弹窗里的手工点击**写入
	 *      —— 真实执行链（`runDirector` 五步、投递）**一条都不写**
	 *      ⇒ 不在弹窗里点几下，这个窗口**永远没有内容**。
	 *   ② 渲染是 `running.length ? h(div) : null` ⇒ 空态**完全不挂载**，
	 *      用户看到的是"窗口不存在"，而不是"窗口在、暂时没记录"。
	 *   ③ 即使有记录，5 分钟窗口一过就整条消失 ⇒ **到点自己没了**。
	 *
	 * 🔴 改后的三条（逐条对上前面的原因）：
	 *   ① `deliver()` 里用 `beginChain/fillChainSteps/endChain` 上报**真实五步**，
	 *      含每步的角色与执行入口（指向表在 `logic/catalog.js` / `logic/roles.js`）；
	 *   ② 窗口**常驻**，空态写明"还没有执行记录 + 怎么办"；
	 *   ③ 展示的是**最近一次执行**（不按分钟过期），带相对时间与"运行中"实时态。
	 *
	 * ⚠️ `listAgentRuns` 那条"最近 N 分钟正在使用"的语义**保留**（它是单次调用视图，
	 *    与"一次完整执行"是两个不同粒度），只是不再作为窗口**是否存在**的依据。 */
	const runs = listAgentRuns();
	const running = (() => {
		const nowMs = Date.now();
		const recent = runs.filter((r) => r && nowMs - (r.at || 0) <= RUNNING_WINDOW_MS);
		const seen = new Set();
		const out = [];
		for (const r of recent) {
			const k = String(r.key || "");
			if (!k || seen.has(k)) continue;
			seen.add(k);
			const a = AGENTS.find((x) => x.key === k);
			const s = SKILLS.find((x) => x.key === k);
			out.push({ key: k, label: a ? a.label : (s ? s.label : k), kind: a ? "agent" : (s ? "skill" : "other"), status: r.status, note: r.note });
		}
		return out;
	})();
	const generating = isAgentGenerating();

	/* 执行链（订阅 store：跑动过程中逐步刷新，不是跑完才看到）。
	 * 🔴 用 `useSyncExternalStore` 而不是"跑完 setState"：五步之间有 `await`，
	 *    要在**第 1 步落表之后就能看到它**，否则"执行状态"就只是事后报告。 */
	const chainTick = react.useSyncExternalStore(subscribeRuns, runsVersion, () => 0);
	void chainTick; // 只为订阅：值本身不用（快照从 store 现取，避免拿缓存）
	const lastChain = latestChain();
	const liveChain = activeChain();
	const chainShow = liveChain || lastChain;
	/** 相对时间（分钟以内给秒，避免"刚刚"这种看不出进度的写法） */
	function relTime(ms) {
		if (!ms) return "—";
		const d = Math.max(0, Date.now() - ms);
		if (d < 60000) return Math.round(d / 1000) + " 秒前";
		if (d < 3600000) return Math.round(d / 60000) + " 分钟前";
		return Math.round(d / 3600000) + " 小时前";
	}
	/** 执行链状态 → 徽章（运行中/完成/告警/失败/中断 —— **不合并语义**） */
	function chainBadge(st2) {
		if (st2 === RUN_STATUS.RUNNING) return { t: "运行中", c: "#e0b341" };
		if (st2 === RUN_STATUS.FAIL) return { t: "失败", c: "#f85149" };
		if (st2 === RUN_STATUS.WARN) return { t: "告警", c: "#d29922" };
		if (st2 === RUN_STATUS.INTERRUPTED) return { t: "中断", c: "#8b9199" };
		return { t: "完成", c: "#3fb950" };
	}
	/** 单步状态 → 图标（`skipped` **必须**与 `ok` 区分：没做 ≠ 做了） */
	function stepMark(st2) {
		if (st2 === RUN_STATUS.OK) return { t: "✓", c: "#3fb950" };
		if (st2 === RUN_STATUS.RUNNING) return { t: "…", c: "#e0b341" };
		if (st2 === "skipped") return { t: "–", c: "#8b9199" };
		if (st2 === RUN_STATUS.INTERRUPTED) return { t: "○", c: "#8b9199" };
		return { t: "!", c: "#d29922" };
	}

	/* ── 缩回栏行为（V18 板块 E2）────────────────────────────────────── */
	const pinned = st.railPinned || { r4: false, r7: false };
	function railClear(side) {
		if (railTimers.current[side]) { clearTimeout(railTimers.current[side]); railTimers.current[side] = null; }
	}
	function railEnter(side) {
		if (railOpen[side]) return;
		railClear(side);
		railTimers.current[side] = setTimeout(() => {
			railTimers.current[side] = null;
			setRailOpen((v) => (v[side] ? v : { ...v, [side]: true }));
		}, RAIL_HOVER_MS);
	}
	function railLeave(side) {
		railClear(side);
		if (pinned[side]) return;
		railTimers.current[side] = setTimeout(() => {
			railTimers.current[side] = null;
			setRailOpen((v) => (v[side] ? { ...v, [side]: false } : v));
		}, RAIL_RETRACT_MS);
	}
	/** 点箭头：钉住（立即展开）/ 取消钉住（并缩回）—— 见设计稿「点击箭头 → 固定」 */
	function railTogglePin(side) {
		railClear(side);
		const next = !pinned[side];
		directorLayoutStore.setRailPinned(side, next);
		setRailOpen((v) => ({ ...v, [side]: next }));
	}

	/* ── 第 6 批 · V20 需求 5：「r4和r7的宽度都要允许自由拖拽」─────────────────
	 *  真相源 = `directorLayoutStore.railWidth`（持久化）；拖动期间**只写 store**。
	 *  🔴 不做本地 state 镜像：store 的 `notify()` 是**同步**的（纪律 20），
	 *     多一层 useState 会多一次异步渲染 ⇒ 手感发飘，且松手后的宽度可能与跑程内读到的不一致。
	 *  🔴 起步宽度**读真实 DOM**（`getBoundingClientRect`）而不是读 store：
	 *     用户眼睛看到的宽度才是基准；读 store 会在"上一次拖动没落地"时让栏**跳**一下。
	 *  🔴 监听挂 `window` 且用**捕获阶段**（第三参 true）：拖出栏外、拖过别栏、
	 *     甚至拖到窗口边缘都必须继续跟手 —— 挂在栏元素上会在离开的瞬间断掉。
	 *  🔴 收尾**必须摘监听 + 按原值复位光标**（纪律 26）：否则下一次进页面就带着
	 *     `col-resize` 光标，且监听器泄漏会让"点一下"都变成拖动。 */
	function railDragStart(side, e) {
		if (!e || typeof e.clientX !== "number") return;
		if (e.preventDefault) e.preventDefault();
		const host = e.currentTarget && e.currentTarget.parentElement;
		const w0 = (host && host.getBoundingClientRect) ? host.getBoundingClientRect().width : directorLayoutStore.getRailWidth(side);
		const x0 = e.clientX;
		/* R4 在左 ⇒ 鼠标右移变宽（+）；R7 在右 ⇒ 鼠标左移变宽（−）。 */
		const dir = side === "r4" ? 1 : -1;
		const prevCursor = (typeof document !== "undefined" && document.body) ? document.body.style.cursor : "";
		const onMove = (ev) => { directorLayoutStore.setRailWidth(side, w0 + dir * (ev.clientX - x0)); };
		const onUp = () => {
			window.removeEventListener("mousemove", onMove, true);
			window.removeEventListener("mouseup", onUp, true);
			if (typeof document !== "undefined" && document.body) document.body.style.cursor = prevCursor;
			setDragSide(null);
		};
		window.addEventListener("mousemove", onMove, true);
		window.addEventListener("mouseup", onUp, true);
		if (typeof document !== "undefined" && document.body) document.body.style.cursor = "col-resize";
		setDragSide(side);
	}
	/** 双击拖拽条 = 复位默认宽度（"拖歪了想回默认值"是**确定**会发生的场景，
	 *  且比"再精确拖回去"可靠得多） */
	function railDragReset(side) {
		directorLayoutStore.setRailWidth(side, side === "r4" ? COL_R4_W : COL_R7_W);
		say("已复位 " + (side === "r4" ? "R4" : "R7") + " 宽度");
	}

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
		/* 🔴 两个值都必须**现取**，不能吃闭包快照（本函数由宿主注入条调用，见上文 `liveRef` 块）：
		 *    · `scope`  → 决定这条落哪个桶；吃快照会让它落进 `se_<sid>` 这一类节点 id 桶，
		 *                 R5 按当帧 scope 过滤 ⇒ 读了也看不见（实测形态："点了没反应"）。
		 *    · `focusTarget` 同理（它在布局 store 里，切左右焦点时变）。 */
		const dim = directorLayoutStore.getState().focusTarget === "director" ? DIM.DIRECTOR : DIM.CHAT;
		flowStore.push(String(txt).trim(), { origin: dim, sessionId: liveRef.current.scope, note: "R8 登记" });
		/* 记下"哪一条是你在原生框里发的" —— 分栏后需要它来区分左右（见 msgRole） */
		setOnUserText(String(txt).trim());
		say("已登记流转 · " + String(txt).trim().length + " 字符");
	}

	/** `runDirector` 需要的 store 适配器 —— 把 plugin-db 的消息面包装成 {getState,addMessage,setStatus} */
	function pageStore() {
		return {
			/* 语义：本条**之前**的上下文。故读 ref 而不是 state（state 是本帧的闭包快照） */
			getState: () => ({ messages: msgsRef.current }),
			/* ⚠️ `nodeId` 同样**现取**：本适配器由 `deliver()` 构造，而 `deliver()` 由宿主注入条调用
			 *   ⇒ 吃闭包快照会把消息写进别的节点（库里查得到、页面上没有 = 最像"功能坏了"的一种）。 */
			addMessage: (m) => appendDirectorMessage(liveRef.current.nodeId, { role: m.role, text: m.content, parsed: m.parsed }),
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
		/* 🔴 本函数由宿主注入条调用 ⇒ 所有"属于当前作用域/当前帧"的值一律**现取**：
		 *   吃闭包快照会造成三种不同的静默错，且都像"功能坏了"：
		 *      · `scope`     → 五步处理与流转落进别的桶（R5 看不见）；
		 *      · `nodeId`    → 消息写进别的节点（库里查得到、页面上没有）；
		 *      · `busy`      → 重入闸门失效（连点两次会并发跑两轮五步）。
		 *    详见上文 `liveRef` 块里的真机取证。 */
		const scope = liveRef.current.scope;
		const curNodeId = liveRef.current.nodeId;
		if (liveRef.current.busy) { say("上一条正在处理"); return; }
		setBusy(true);
		setDeliverMode("idle");
		try {
			const c = loadDirectorConfig();
			const duties = (await resolveDuties(curNodeId)).duties;

			/* 🔴 第 6 批需求 6：**先登记再跑**（`beginChain` 在 `runDirector` 之前）。
			 *   理由：事后登记只能看到"跑成功了"的那些 —— 而用户要看的恰恰是
			 *   「卡在哪一步 / 为什么没成」。先登记 ⇒ 挂了也能看到挂在第几步。
			 * ⚠️ 登记失败返回 null，**不得因此中断主流程**（记录是观测面，不是执行前置）。 */
			const runId = beginChain({ sessionId: scope, text: t });

			let r;
			try {
				r = await runDirector({
					sessionId: scope, userText: t, store: pageStore(), duties, config: c,
					autoForward: false,
					/* V20 需求 3：**单条**注入当前任务的补充说明（O(1)）。
					 * `scope === scopeKey`（同一个作用域真相源），故这里就是本作用域。
					 * 没设当前任务 / 没写说明 ⇒ 传 `null`，执行链一个字都不加。 */
					taskNote: directorLayoutStore.getActiveTaskNote(scope)
				});
			} catch (e) {
				/* 失败也要**结链**（否则窗口会永远停在"运行中"，那是撒谎） */
				endChain(runId, { status: RUN_STATUS.FAIL, note: "处理失败：" + ((e && e.message) || "未知") });
				await refresh();
				setDeliverMode("failed");
				say("处理失败 · " + ((e && e.message) || "未知"));
				return;
			}
			/* 用 `runDirector` 返回的 `steps` **逐条对齐**（同源，不重新拼装）——
			 * 职责被关掉的那几步会落成 `skipped`，与"做了"在读数上分得开。 */
			fillChainSteps(runId, r.steps);
			setRunGrade(r.steps.some((s) => s.grade === "G1") ? "G1" : "G0");

			/* R2.5 建议去向：原生产者是那份**已删的旧 `deliver`**，删除后该卡片会变成
			 * 永远不出现的死 UI。此处把生产者接回新版链路（处理完成后给出建议去向，
			 * 供你改投 / 纠偏）—— 一份数据一个生产者，不留不可达界面。 */
			setRouteResult(route(t, { nodes: flatNodes(), currentNodeId: curNodeId }));

			/* ④ 投递的是**处理后的指令**，不是原文 —— 这正是用户要的"经过处理然后发给对话执行" */
			const d = await deliverToChat(r.instruction, { sessionId: scope, opener: openSession });
			setDeliverMode(d.mode === "sent" ? "sent" : (d.ok ? "filled" : "failed"));
			setDeliverVia(d.via || d.reason || "");

			/* 结链：状态按「是否真的送进对话」定档 —— `filled` 只是**填进输入框**，
			 * 🔴 **不算送达**（本项目踩过：把 filled 读成 sent 会让"送到了吗"永远为真）。
			 * ⚠️ 终态里不许出现 `running`（`endChain` 只写终态）——写 running 会复现
			 *    "重启后卡片还在转圈"那种"看起来在跑"的假状态。 */
			endChain(runId, {
				status: d.mode === "sent" ? RUN_STATUS.OK : (d.ok ? RUN_STATUS.WARN : RUN_STATUS.FAIL),
				grade: r.steps.some((s) => s.grade === "G1") ? "G1" : "G0",
				model: r.model,
				deliver: { mode: d.mode || "", via: d.via || "", reason: d.reason || "" },
				note: d.ok ? "" : ("未送达：" + (d.reason || "未知"))
			});

			/* ⑤ 两跳流转：总监（已处理）→ 对话（已投递/未投递） */
			const f = flowStore.push(t, { origin: DIM.DIRECTOR, sessionId: scope, note: "总监页执行" });
			if (f) {
				flowStore.move(f.flowId, DIM.DIRECTOR, "总监已处理", { status: "routed" });
				if (d.ok) flowStore.move(f.flowId, DIM.CHAT, "已投递到对话", { status: "running", target: scope });
				else flowStore.move(f.flowId, DIM.CHAT, "未投递：" + (d.reason || "未知"), { status: "routed", target: scope });
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
			say(String(txt).trim() ? "已抓取原生输入 " + String(txt).trim().length + " 字符（点「登记流转」写进四维轨迹）" : "原生输入框为空，无内容可抓");
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
	 * 🔴 2026-09-14 第 5 批补字段：`conversations` / `meta` / `parentSession`。
	 *    改前只传 `{id,name,level}` ⇒ `scoreNodes` 的②③两条信号**永远拿不到数据**
	 *    （会话记录命中 +1.2、近 3 日活跃 +0.8 从未生效）⇒ 「按消息判定归属」
	 *    实际上只剩"名称命中"一条腿。这正是用户说的"有流转但没按消息判断"的一半原因。
	 *    ⚠️ 这里**不改权重**（改了要重跑路由校准）—— 只是把原本该传的数据补上。
	 *
	 * ⚠️ 这里**曾经**是第二个 `async function deliver`（旧版"记录员"）。
	 *    同名 `function` 声明在同一作用域**合法**且**后声明者静默覆盖前者** ⇒ 新版真流转链路
	 *    被旧版整条顶掉，真机表现为「点执行没反应 + 只多一条 user 消息」（2026-09-12 G 段三红）。
	 *    旧版已删，本文件对 `deliver` 只保留**一处**声明；该类的复发由构建期
	 *    `lintDuplicateFnDecl`（build/build.mjs）拦截。
	 */
	function flatNodes() {
		const flat = [];
		const walk = (n) => {
			flat.push({
				id: n.id, name: n.name, level: n.level,
				meta: n.meta, conversations: n.conversations,
				parentSession: n.parentSession || (n.meta && n.meta.parentSession) || null,
				updatedAt: n.updatedAt || (n.meta && n.meta.updatedAt) || 0
			});
			(n.childNodes || []).forEach(walk);
		};
		if (tree) walk(tree);
		return flat;
	}

	/**
	 * 确认路由去向。
	 *
	 * 🔴 2026-09-14 第 5 批 · 用户原话：「目前总监有流转, 但是没有判断应该根据消息放到
	 *    那个对话, 需要看一下原因」—— **原因就是这里**：
	 *     改前 `flowStore.move(…, { target: flowSession })` 把目标**写死当前会话**，
	 *     路由判出来的 `candidates[0].nodeId` 只被 `saveDecision()` 存进了决策记录，
	 *     投递路径完全不知道它 ⇒ "判定"与"投递"是两条不相交的线。
	 *   ⇒ 现在目标 id 落进 `flowStore.move.target`，并且**真的按它投递**；
	 *      文件夹/项目级**没有对话** ⇒ 如实告知，**不静默发到当前会话**。
	 *      遍历用 `store/hierarchy.js` 的 `findNodeById`（不在这里再写一份 DFS —— 重复即漂移）。
	 */
	async function confirmRoute(dest) {
		const cand = (routeResult && routeResult.candidates && routeResult.candidates[0]) || null;
		const targetNode = cand && cand.nodeId ? findNodeById(tree, cand.nodeId) : null;
		/* 目标会话 id：只有"真有对话"的节点才有 —— 判据走 store/hierarchy.js 的单一真相源，
		 * 不在这里各算各的（否则又会出现"总监页与工作台口径不同"的老问题）。 */
		const targetSession = (targetNode && scopeHasConversation(targetNode)) ? scopeKeyOf(targetNode.id, targetNode) : null;
		const hit = Boolean(targetSession);
		const target = hit ? targetSession : flowSession;
		const why = !cand ? "无候选（新建对话）"
			: hit ? "命中会话"
				: (routeResult.decision.destination === DESTINATION.TRANSFER ? "目标为项目级（无对话）" : "目标无对话");

		/* 投递落点 = 判定出来的目标会话；判据与总监弹窗**同一套**（同源：scopeKeyOf） */
		let note = "（未投递，未静默改发当前会话）";
		let status = "routed";
		if (hit && (dest === DESTINATION.DIRECT || dest === DESTINATION.TRANSFER)) {
			const d = await deliverToChat((routeResult.subtasks || []).map((s) => s.text).join("\n"), {
				sessionId: targetSession, opener: openSession, autoSend: dest === DESTINATION.DIRECT
			});
			note = d.mode === "sent" ? "（已发送到该对话）"
				: d.ok ? "（已填入该对话输入框）" : "（投递失败：" + (d.reason || "未知") + "）";
			status = d.ok ? "running" : "routed";
		}
		if (latest) {
			flowStore.move(latest.flowId, DIM.CHAT, "确认去向：" + DESTINATION_LABEL[dest] + " · " + why, { status, target });
		}
		say("已确认：" + DESTINATION_LABEL[dest] + " · " + why + note);
		setRouteResult(null);
	}

	/* ── 派生：R2 指标（每个数字都带数据源标注）── */
	const metrics = [
		{ k: "待办完成率", v: todoRate + "%", bar: todoRate, src: "plugin-db · directorTodos(" + todos.length + " 条)" },
		{ k: "未闭合风险", v: (node && node.risks ? node.risks.length : 0), color: "#e0b341", src: "层级节点 risks" },
		{ k: "待办项", v: (node && node.todos ? node.todos.length : 0), src: "层级节点 todos" },
		{ k: "活跃分支", v: activeBranches, color: "#3fb950", src: "宿主 sessions 血缘（有子节点的分支）" }
	];

	/* ── 模型选择（第 6 批需求 8）────────────────────────────────────
	 * 🔴 本轮发现（**"看起来有、实际没有"的标本**）：
	 *    改前这里有 `modelCandidates` / `modelProbeNote` / `openModelMenu()` / `pickModel()`
	 *    四个函数与 `mOpen` / `modelStatus` 两个 state —— 全都能编译、逻辑也自洽，
	 *    但**没有任何一处渲染它们**。原因是第 6 批需求 9 移除 R8 整行时，
	 *    模型菜单挂在那一行里，被一起摘掉了，只留下函数残骸。
	 *    后果：界面上**没有任何模型选择入口**，而代码读起来像有 —— 这正是本项目
	 *    反复强调要消灭的状态（`lint-undefined-symbols` 不管"定义了没人用"，
	 *    所以它一路绿）。
	 *  ⇒ 处置：**删除残骸**，改由 `components/ModelSeat.js` 提供唯一实现
	 *    （它同时是宿主标准席位 `conversation.input.model` 的组件），
	 *    并渲染在「执行状态」窗口的尾行 —— 那里本来就有"模型"一项，
	 *    把它从**只读标签**升级为**可选入口**，不新增任何行（需求 9 的约束）。
	 *  ⚠️ 不新造第二套选择器：`ModelSeat` 的 `modelOptions / applyModelChoice /
	 *    selectedModelOf` 是纯函数，与宿主席位**共用同一份**（一处逻辑，两个挂载点）。 */

	/* ── 缩回栏的渲染（三处共用同一套行为，此处只画总监页的两处）── */
	function renderRail(side) {
		const isLeft = side === "r4";
		const title = isLeft ? "R4 项目导航" : "R7 关键文件 / 产出物";
		/* 箭头方向：R4 在左 ⇒ 展开方向朝右 ⇒ `›`；R7 在右 ⇒ 朝左 ⇒ `‹`。 */
		const arrow = isLeft ? "›" : "‹";
		/* 🔴 V18 板块 E1（第 5 批 · 本轮收口）：**「缩进后只剩一个箭头按钮」**。
		 *    上一版 rail 里还塞了 `◆` / 竖排标题文字（`writing-mode: vertical-rl`）——
		 *    那是**设计稿里的「现状」**（宿主旧面板竖排长文字的残留），不是目标态。
		 *    本版去掉两处可见文字，**只剩箭头**；可读名不靠可见文字承载，
		 *    改由 `aria-label` / `title` 给出 ⇒ **无障碍不退化**（点读屏仍能听到完整名称）。
		 *    E1 的另一半判据是「展开态与对话区**等高**」—— 那由 `S.cols` 的
		 *    `alignItems:stretch` + 每栏 `flex:1` 保证（**不是**写死高度），
		 *    真机判据见 `verify-v17-sync.mjs` A8（量 rail 与 R5 的盒高是否相等）。 */
		return h("div", {
			key: "rail-" + side, "data-testid": "dp-rail-" + side, role: "button", tabIndex: 0,
			"aria-label": title + "（悬停 " + RAIL_HOVER_MS + " 毫秒或点击展开）",
			"data-open": "0", "data-pinned": pinned[side] ? "1" : "0",
			title: title + "：悬停 " + RAIL_HOVER_MS + " 毫秒自动展开；点击立即展开并钉住",
			style: S.rail,
			onMouseEnter: () => railEnter(side),
			onMouseLeave: () => railLeave(side),
			onClick: () => railTogglePin(side),
			onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); railTogglePin(side); } }
		}, h("span", {
			key: "a", "data-testid": "dp-rail-" + side + "-arrow",
			style: { fontSize: 15, lineHeight: 1, color: "var(--dp-ac, #9fc2ff)" }
		}, arrow));
	}

	/* ── 第 6 批：宽度拖拽条（V20 需求 5）───────────────────────────────────────
	 *  4px 热区、绝对定位吸附在栏的**内侧边**（R4 → right，R7 → left），
	 *  半宽压出栏外 2px ⇒ 与 `S.cols` 的 `gap:0` 配合后，缝本身就成了拖拽带。
	 *  🔴 起始色**透明**、悬停才显形：常态下不该有一条装饰线干扰"无缝"的观感；
	 *     但 `aria-label` 与 `title` 常驻 ⇒ 键盘/读屏仍能发现它（无障碍不退化）。
	 *  🔴 `data-testid` 进冻结锚点表（纪律 7）：闸门要靠它做"拖动 40px ⇒ 宽度真的变了"。 */
	function renderResizer(side) {
		const isOn = dragSide === side;
		const tip = (side === "r4" ? "R4" : "R7") + " 栏宽度：按住左右拖动（双击复位 " + (side === "r4" ? COL_R4_W : COL_R7_W) + "px）";
		return h("div", {
			key: "rs-" + side, "data-testid": "dp-" + side + "-resizer",
			role: "separator", "aria-orientation": "vertical", "aria-label": tip, title: tip,
			"data-dragging": isOn ? "1" : "0",
			"data-width": directorLayoutStore.getRailWidth(side),
			style: {
				position: "absolute", top: 0, bottom: 0, width: 4, zIndex: 6,
				cursor: "col-resize", userSelect: "none",
				[side === "r4" ? "right" : "left"]: -2,
				background: isOn ? "var(--dp-ac, #2f6feb)" : "transparent"
			},
			onMouseDown: (e) => railDragStart(side, e),
			onDoubleClick: () => railDragReset(side)
		});
	}

	function renderPanelHead(side, label) {
		const isLeft = side === "r4";
		return h("div", {
			key: "t", style: { ...S.blkT, cursor: "pointer", marginBottom: 6 },
			"data-testid": "dp-" + side + "-toggle",
			title: pinned[side] ? "已钉住：点击取消钉住并缩回" : "点击钉住（鼠标移出也不缩回）",
			onClick: () => railTogglePin(side)
		}, [
			(pinned[side] ? "📌 " : "") + (isLeft ? "‹ " : "") + label + (isLeft ? "" : " ›"),
			h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } }, pinned[side] ? "已固定" : "鼠出缩回")
		]);
	}

	/* ── R4 正文（三 Tab · 真实数据源）── */
	function renderR4Body() {
		if (!ledgerView.ok) {
			return h("div", {
				key: "bad", "data-testid": "dp-r4-degraded",
				style: { ...S.muted, color: "#d29922", border: "1px solid rgba(210,153,34,.45)", borderRadius: 5, padding: "5px 7px" }
			}, "索引不可用（原因）：" + (ledgerView.reason || "未知") + " —— 未静默显示空列表");
		}
		if (r4tab === "roadmap") {
			const list = ledgerView.roadmap;
			return h("div", { key: "b", "data-testid": "dp-r4-body-roadmap", "data-count": list.length },
				list.length
					? list.map((r) => h("div", {
						key: r.id + r.task.slice(0, 12), "data-testid": "dp-r4-item", "data-id": r.id, "data-kind": "roadmap",
						/* 选中态进 DOM：闸门靠它证明"点的就是展开的那条"，而不是靠数条数 */
						"data-selected": (selectedItem && selectedItem.kind === "roadmap" && selectedItem.id === r.id) ? "1" : "0",
						"data-active": (directorLayoutStore.getActiveTask(scopeKey) === r.id) ? "1" : "0",
						role: "button", tabIndex: 0,
						title: "点开：在 R5 区看详情（未完成项可加补充说明）；再点一次缩回",
						onClick: () => pickItem("roadmap", r),
						onKeyDown: (e) => { if (e && (e.key === "Enter" || e.key === " ")) pickItem("roadmap", r); },
						style: {
							...S.row, display: "block", cursor: "pointer",
							borderColor: (selectedItem && selectedItem.kind === "roadmap" && selectedItem.id === r.id)
								? "var(--dp-ac-line, rgba(47,111,235,.45))" : undefined
						}
					}, [
						/* 第 1 行 =「未完成事项」本身（用户原话：「未完成事项，然后才是对应的号」）——
						 *   描述**占满整行可换行**；改前四条挤在一行 flex 里，窄栏下描述被压成
						 *   逐字竖排（第 6 批截图里就是这个形态）。 */
						h("div", { key: "t", "data-testid": "dp-r4-item-task", style: { fontSize: "calc(11.5px * var(--dp-font,1))", lineHeight: 1.45, wordBreak: "break-word" } }, clampText(r.task, 120)),
						/* 第 2 行 = 元信息**整组靠右**（用户样张：`T-INIT-0032026-08-24` 靠右）。
						 *   靠右的顺序是 状态 → 优先级 → 编号 ⇒ **编号落在最右**，可扫读"下一个号是几"。 */
						h("div", { key: "m", "data-testid": "dp-r4-item-meta", style: { display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", marginTop: 2, flexWrap: "wrap" } }, [
							r.status ? h("span", { key: "s", style: { ...S.muted, flex: "0 0 auto" } }, clampText(r.status, 24)) : null,
							r.prio ? h("span", { key: "p", style: { ...S.chip2, flex: "0 0 auto" } }, r.prio) : null,
							h("span", { key: "i", "data-testid": "dp-r4-item-id", style: { ...S.idm, flex: "0 0 auto" } }, r.id)
						])
					]))
					: h("div", { key: "e", style: S.muted }, "解析出 0 条 —— 03 清单里没有 `T-*` 条目行"));
		}
		if (r4tab === "done") {
			const list = ledgerView.done;
			return h("div", { key: "b", "data-testid": "dp-r4-body-done", "data-count": list.length },
				list.length
					? list.slice().reverse().map((r) => h("div", {
						key: r.id + r.task.slice(0, 12), "data-testid": "dp-r4-item", "data-id": r.id, "data-kind": "done",
						"data-selected": (selectedItem && selectedItem.kind === "done" && selectedItem.id === r.id) ? "1" : "0",
						role: "button", tabIndex: 0,
						title: "点开：在 R5 区看已完成任务的详情；再点一次缩回",
						onClick: () => pickItem("done", r),
						onKeyDown: (e) => { if (e && (e.key === "Enter" || e.key === " ")) pickItem("done", r); },
						style: {
							...S.row, display: "block", cursor: "pointer",
							borderColor: (selectedItem && selectedItem.kind === "done" && selectedItem.id === r.id)
								? "var(--dp-ac-line, rgba(47,111,235,.45))" : undefined
						}
					}, [
						h("div", { key: "t", "data-testid": "dp-r4-item-task", style: { fontSize: "calc(11.5px * var(--dp-font,1))", lineHeight: 1.45, wordBreak: "break-word" } }, clampText(r.task, 120)),
						/* 已完成：编号 + 日期 —— 与路线图**同一套靠右逻辑**（用户：「代办使用一样逻辑」） */
						h("div", { key: "m", "data-testid": "dp-r4-item-meta", style: { display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", marginTop: 2, flexWrap: "wrap" } }, [
							h("span", { key: "i", "data-testid": "dp-r4-item-id", style: { ...S.idm, flex: "0 0 auto" } }, r.id),
							r.date ? h("span", { key: "d", "data-testid": "dp-r4-item-date", style: { ...S.muted, flex: "0 0 auto" } }, r.date) : null
						])
					]))
					: h("div", { key: "e", style: S.muted }, "解析出 0 条 —— 04 清单里没有 `T-*` 条目行"));
		}
		/* docs：文档树（点一篇 → 钻孔看正文；正文来自 assets/docs-index.json） */
		if (docPath) {
			const md = readDocContent(docsIdxRef.current, docPath);
			return h("div", { key: "doc", "data-testid": "dp-r4-doc-view", "data-path": docPath }, [
				h("div", { key: "h", style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 5 } }, [
					h("button", { key: "b", style: { ...S.btn, height: 18, padding: "0 6px" }, "data-testid": "dp-doc-back", onClick: () => setDocPath(null) }, "← 返回"),
					h("span", { key: "p", style: { ...S.muted, minWidth: 0, wordBreak: "break-all" } }, docPath)
				]),
				md === null
					? h("div", { key: "e", style: { ...S.muted, color: "#d29922" } }, "读不到正文：索引里没有这篇（未静默显示空）")
					: h("div", { key: "c", style: { ...S.muted, whiteSpace: "pre-wrap", wordBreak: "break-word" } }, md)
			]);
		}
		const tree = ledgerView.tree;
		return h("div", { key: "b", "data-testid": "dp-r4-body-docs", "data-dirs": tree.length, "data-docs": ledgerView.docCount }, [
			...tree.map((g) => h("div", { key: g.dir, style: { marginBottom: 6 } }, [
				h("div", { key: "d", style: { ...S.muted, color: "var(--dp-t2, #c3c8ce)", fontWeight: 600 } }, g.dir + "（" + g.count + "）"),
				h("div", { key: "f", style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 } },
					g.files.map((f) => h("button", {
						key: f, style: { ...S.btn, height: 18, padding: "0 6px", fontSize: "calc(10.5px * var(--dp-font,1))" },
						"data-testid": "dp-doc-open", "data-path": (g.dir === "." ? "" : g.dir + "/") + f,
						title: "查看正文（来自 assets/docs-index.json）",
						onClick: () => setDocPath((g.dir === "." ? "" : g.dir + "/") + f)
					}, f.replace(/\.md$/, ""))))
			])),
			h("div", { key: "s", style: S.src }, "数据源：assets/docs-index.json（" + ledgerView.docCount + " 篇 · " + tree.length + " 组）"
				+ " ｜ 03/04 清单：" + ledgerView.roadmap.length + " 待办 / " + ledgerView.done.length + " 已完成")
		]);
	}

	/* ── R7 正文（关键文件 / 产出物）── */
	/* ── 第 6 批（V20 需求 3）：R4 条目详情 + 未完成项补充说明 ─────────────────
	 *  交互定案（用户原话：「点开的时候占用总监对话区，缩回去的时候再显示总监对话区
	 *                      这部分的交互逻辑完善一下，思考怎么样的交互是符合规范且顺手的」）：
	 *    · 点条目 → 占用 R5；**再点同一条 = 缩回**（一个开关，不必去找关闭键 —— 顺手）
	 *    · 详情卡里另给「← 缩回」显式出口（可发现性；也是无障碍的落点）
	 *    · 详情卡与 R5 常规内容**互斥**（一个 `selectedItem` 同时管住三块）
	 *  补充说明的存储与注入见 `store/layout.js` 的 `todoNotes`：
	 *    键 = `scopeKey::taskId`，执行链用 `getTodoNote()` **只读那一条**（O(1)）。 */
	function pickItem(kind, r) {
		if (!r || !r.id) return;
		const same = selectedItem && selectedItem.kind === kind && selectedItem.id === r.id;
		if (same) { setSelectedItem(null); return; }   // 再点同一条 = 缩回
		setSelectedItem({
			kind: kind, id: r.id, task: String(r.task || ""),
			status: String(r.status || ""), prio: String(r.prio || ""), date: String(r.date || "")
		});
	}
	function saveNote() {
		const res = directorLayoutStore.setTodoNote(scopeKey, selectedItem.id, noteDraft);
		if (!res.ok) { say("补充说明没保存：" + (res.why === "bad-key" ? "作用域或编号为空" : "内容为空（用「清除」显式删除）")); return; }
		if (res.removed) { setNoteDraft(""); say("已清除这条补充说明"); return; }
		setNoteDraft(res.note);   // 已截断就回填截断后的文本（不静默丢字）
		say(res.truncated
			? ("补充说明超长，已截断到 " + TODO_NOTE_MAX_CHARS + " 字（其余未保存）")
			: "已保存补充说明 —— 执行到当前任务时**单条**注入总监上下文");
	}
	function clearNote() {
		if (!noteDraft) { say("这条还没有补充说明"); return; }
		directorLayoutStore.clearTodoNote(scopeKey, selectedItem.id);
		setNoteDraft("");
		say("已清除这条补充说明");
	}
	function toggleActiveTask() {
		const cur = directorLayoutStore.getActiveTask(scopeKey);
		if (cur === selectedItem.id) { directorLayoutStore.setActiveTask(scopeKey, ""); say("已取消「当前任务」"); return; }
		directorLayoutStore.setActiveTask(scopeKey, selectedItem.id);
		say("已把 " + selectedItem.id + " 设为当前任务 —— 执行时只注入它的补充说明");
	}
	function renderR4Detail() {
		const it = selectedItem;
		const isTodo = it.kind === "roadmap";
		/* 已保存的那份**从 store 派生**（`st` 是 layout store 的订阅快照）——
		 * 不用本地 state 复制一份：复制出来的那份在别处改 store（例如清除）时不会跟着变。 */
		const savedRow = ((st && st.todoNotes) || {})[todoNoteKey(scopeKey, it.id)];
		const noteSaved = (savedRow && savedRow.note) || "";
		const dirty = noteDraft !== noteSaved;
		const isActive = directorLayoutStore.getActiveTask(scopeKey) === it.id;
		const scopeTail = String(scopeKey).slice(-8);
		return h("div", {
			key: "detail", "data-testid": "dp-r4-detail", "data-kind": it.kind, "data-id": it.id,
			"data-scope": scopeKey, "data-dirty": dirty ? "1" : "0",
			"data-note-len": String(noteSaved.length), "data-active": isActive ? "1" : "0",
			style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }
		}, [
			h("div", { key: "h", style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flex: "0 0 auto" } }, [
				h("button", {
					key: "b", style: { ...S.btn, height: 20 }, "data-testid": "dp-r4-detail-back",
					title: "缩回：R5 恢复显示总监对话区", onClick: () => setSelectedItem(null)
				}, "← 缩回"),
				isTodo
					? h("button", {
						key: "a", "data-testid": "dp-r4-set-active", "data-on": isActive ? "1" : "0",
						style: {
							...S.btn, height: 20,
							...(isActive ? { borderColor: "var(--dp-ac-line, rgba(47,111,235,.45))", color: "var(--dp-ac, #79a8ff)" } : {})
						},
						title: isActive ? "取消「当前任务」" : "设为当前任务：执行时只注入这一条的补充说明（O(1)，不污染其它步骤）",
						onClick: toggleActiveTask
					}, isActive ? "当前任务 ●" : "设为当前任务")
					: null,
				h("span", { key: "l", style: { ...S.muted, marginLeft: "auto" } }, isTodo ? "未完成事项详情" : "已完成任务详情")
			]),
			h("div", { key: "b", style: { flex: 1, minHeight: 0, overflowY: "auto" }, className: "dp-scroll" }, [
				h("div", { key: "id", style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 5, flexWrap: "wrap" } }, [
					h("span", { key: "i", "data-testid": "dp-r4-detail-id", style: { ...S.idm } }, it.id),
					it.status ? h("span", { key: "s", style: { ...S.chip2 } }, it.status) : null,
					it.prio ? h("span", { key: "p", style: { ...S.chip2 } }, it.prio) : null,
					it.date ? h("span", { key: "d", style: { ...S.muted } }, it.date) : null
				]),
				h("div", { key: "t", "data-testid": "dp-r4-detail-task", style: { fontSize: "calc(12px * var(--dp-font,1))", lineHeight: 1.55, wordBreak: "break-word" } }, it.task),
				/* 作用域脚注：补充说明是**按作用域存**的 —— 不写出来，用户无法知道
				 * "同一条任务在另一个作用域下还有另一份说明"，会以为数据丢了。 */
				h("div", { key: "sc", style: { ...S.muted, marginTop: 5 }, "data-testid": "dp-r4-detail-scope" },
					"补充说明存于作用域 …" + scopeTail + "（" + scopeKindLabel + "）"),
				isTodo
					? h("div", { key: "n", style: { marginTop: 7, borderTop: "1px solid var(--dp-line, #31343a)", paddingTop: 7 } }, [
						h("div", { key: "l", style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 4 } }, [
							h("span", { key: "a", style: { fontSize: "calc(11px * var(--dp-font,1))", fontWeight: 700, color: "var(--dp-ac, #79a8ff)" } }, "+ 补充说明"),
							h("span", { key: "c", style: { ...S.muted, marginLeft: "auto" } }, String(noteDraft.length) + " / " + TODO_NOTE_MAX_CHARS + " 字")
						]),
						h("textarea", {
							key: "x", "data-testid": "dp-r4-note-input", value: noteDraft, rows: 4,
							placeholder: "写这条任务的补充说明。执行到它时**只注入这一段**，不污染其它步骤。",
							style: {
								width: "100%", boxSizing: "border-box", resize: "vertical",
								background: "var(--dp-bg-2, #212429)", color: "var(--dp-t1, #e8eaed)",
								border: "1px solid var(--dp-line, #31343a)", borderRadius: "var(--dp-radius-sm, 5px)",
								padding: "5px 7px", font: "inherit", fontSize: "calc(11.5px * var(--dp-font,1))", lineHeight: 1.5
							},
							onChange: (e) => setNoteDraft(String((e.target && e.target.value) || ""))
						}),
						h("div", { key: "act", style: { display: "flex", gap: 6, alignItems: "center", marginTop: 5, flexWrap: "wrap" } }, [
							h("button", {
								key: "s", "data-testid": "dp-r4-note-save", "aria-disabled": dirty ? "false" : "true",
								style: { ...S.btn, ...(dirty ? { borderColor: "var(--dp-ac-line, rgba(47,111,235,.45))", color: "var(--dp-ac, #79a8ff)" } : {}) },
								onClick: saveNote
							}, dirty ? "保存（未保存）" : "保存"),
							h("button", { key: "c", "data-testid": "dp-r4-note-clear", style: S.btn, onClick: clearNote }, "清除"),
							h("span", {
								key: "st", "data-testid": "dp-r4-note-state",
								style: { ...S.muted, marginLeft: "auto" }
							}, noteSaved ? ("已保存 " + noteSaved.length + " 字") : "尚未补充")
						])
					])
					: h("div", { key: "n", style: { ...S.muted, marginTop: 7 }, "data-testid": "dp-r4-note-locked" },
						"已完成任务不提供补充说明（只读留痕）。")
			])
		]);
	}

	/* ── R5 的「对话」视图（第 6 批需求 7）──────────────────────────────
	 * 用户原话：「点击对话的时候, r5总监消息, 变成对话的消息, **历史信息也要在**」。
	 * 🔴 数据源就是宿主自己的消息列表（`bridge/chat-bridge.js#readConversationItems`
	 *    复用既有下钻，不另造一份）；读不到时**必须把原因显示出来**
	 *    （纪律 19：降级可以，无声不行）—— 空列表和"读不到"长得一样，不许混。 */
	function renderChatView() {
		const snap = chatSnap;
		if (!snap) return h("div", { key: "c0", style: S.muted, "data-testid": "dp-r5-chat-loading" }, "正在读取对话消息…");
		if (!snap.ok) {
			return h("div", {
				key: "c1", "data-testid": "dp-r5-chat-degraded",
				style: { ...S.muted, color: "#d29922", border: "1px solid rgba(210,153,34,.45)", borderRadius: 5, padding: "5px 7px" }
			}, "读不到对话消息（原因）：" + (snap.reason || "未知") + " —— 未静默显示空列表");
		}
		const age = snap.at ? Math.max(0, Math.round((Date.now() - snap.at) / 1000)) : null;
		return h("div", {
			key: "c2", "data-testid": "dp-r5-chat", "data-total": snap.total, "data-shown": snap.items.length,
			/* 数据来源与新鲜度都要可断言（闸门读这个属性，不解析中文） */
			"data-live": snap.live ? "1" : "0", "data-at": String(snap.at || 0)
		}, [
			h("div", { key: "h", style: { ...S.muted, marginBottom: 4 }, "data-testid": "dp-r5-chat-count" },
				"对话消息 " + snap.total + " 条 · 显示最后 " + snap.items.length + " 条（含历史）"),
			h("div", {
				key: "s", "data-testid": "dp-r5-chat-source",
				style: { ...S.muted, marginBottom: 5, fontSize: "calc(10.5px * var(--dp-font,1))" }
			}, snap.live
				? ("来源：宿主对话页签实时读取 · 已同步 " + snap.syncs + " 次")
				: ("来源：后台镜像快照（" + (age === null ? "未知" : age + " 秒前") + "）—— " + (snap.reason || "宿主对话页签未激活，消息列表不在 DOM"))),
			...snap.items.map((it) => h("div", {
				key: "m" + it.i, "data-testid": "dp-chat-msg", "data-i": it.i,
				style: {
					border: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-2, #212429)",
					borderRadius: "var(--dp-radius-sm, 5px)", padding: "5px 7px", marginBottom: 5,
					fontSize: "calc(11.5px * var(--dp-font,1))", lineHeight: 1.5, wordBreak: "break-word"
				}
			}, it.text || "（空消息）"))
		]);
	}

	function renderR7Body() {
		if (r7tab === "files") {
			const pr = projectRoot();
			/* 第 6 批（V20 需求 4）：关键文件**三行** —— 描述 / 名称 / 路径。
			 * 🔴 名称与路径都做成按钮，但**做不到"进入文件 / 打开文件夹"** ——
			 *    渲染进程没有文件系统与外壳通道（见 `copyText` 的注释）⇒ 降级为**复制绝对路径**，
			 *    并把降级原因同时写进 `title` 与点击后的 toast（纪律 19：降级可以，无声不行）。 */
			const linkBtn = (extra) => ({
				display: "block", width: "100%", textAlign: "left", background: "transparent",
				border: "none", padding: 0, cursor: "pointer", font: "inherit", lineHeight: 1.4,
				overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
				...extra
			});
			return h("div", {
				key: "f", "data-testid": "dp-r7-body-files", "data-count": KEY_FILES.length,
				/* 项目根的来源（`env` = 运行时注入 / `fallback` = 本仓库既知根）——
				 * 闸门据此断言"用的是哪一个"，不靠猜（纪律 29）。 */
				"data-root-src": pr.src, "data-root": pr.root
			}, [
				h("div", { key: "s", style: { ...S.muted, marginBottom: 4 } },
					KEY_FILES.length + " 个模块 · " + KEY_FILES_TOTAL.lines + " 行 · " + Math.round(KEY_FILES_TOTAL.bytes / 1024) + " KB（生成式）"),
				...KEY_FILES.map((k) => {
					const abs = pr.root + "\\" + String(k.f).split("/").join("\\");
					const dir = abs.slice(0, abs.lastIndexOf("\\"));
					return h("div", {
						key: k.f, style: { ...S.row, display: "block" },
						"data-testid": "dp-keyfile", "data-file": k.f, "data-bytes": k.bytes, "data-lines": k.lines,
						"data-abs": abs, "data-dir": dir,
						title: "职责：" + k.duty + "\n上游：" + k.up + "\n下游：" + (k.down || "（无）")
							+ "\n\n文件：" + abs + "\n目录：" + dir
					}, [
						/* ① 描述 —— 占满整行、可换行（改前是"名称 + 描述·行数/B"两行，路径根本没露出来） */
						h("div", { key: "d", style: { ...S.muted, wordBreak: "break-word", lineHeight: 1.45 } },
							clampText(k.duty || "（@map 未写职责）", 90)),
						/* ② 名称 —— 点击复制**文件绝对路径** */
						h("button", {
							key: "n", "data-testid": "dp-keyfile-name", "data-abs": abs,
							style: linkBtn({ fontFamily: "ui-monospace,Consolas,monospace", color: "var(--dp-t1, #e8eaed)", fontWeight: 600 }),
							title: "点击复制文件绝对路径：" + abs + "（本插件无文件系统权限，无法直接打开文件）",
							onClick: () => copyPath(abs, "文件路径")
						}, k.f),
						/* ③ 路径 —— 点击复制**所在文件夹**（用户：「点击路径打开文件夹」） */
						h("button", {
							key: "p", "data-testid": "dp-keyfile-path", "data-dir": dir,
							style: linkBtn({ fontFamily: "ui-monospace,Consolas,monospace", fontSize: "calc(10px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", wordBreak: "break-all", whiteSpace: "normal" }),
							title: "点击复制所在文件夹路径：" + dir + "（本插件无文件系统权限，无法直接打开文件夹）",
							onClick: () => copyPath(dir, "文件夹路径")
						}, abs)
					]);
				}),
				h("div", { key: "x", style: S.src }, "数据源：src/** 的 @map 头（scripts/gen-key-files.mjs 生成）"
					+ " ｜ 项目根来源：" + (pr.src === "env" ? "运行时注入" : "本仓库既知根"))
			]);
		}
		/* 产出物：沿用原「详情 / 产出物」的内容原地保留 */
		return h("div", { key: "o", style: S.muted, "data-testid": "dp-r7-body-outputs" }, [
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
		]);
	}

	/* 消息左右分栏的归属判据：
	 *   · plugin-db 的 `role` 是唯一真相源（`user` = 你发的，其余 = 总监）
	 *   · 另外把"你刚在原生框里登记过的那句话"也标成你的（`onUserText`）——
	 *     宿主投递过来的消息在库里同样记 user，这里只是把"当轮"标得更明确。 */
	function msgIsMine(m) {
		if (!m) return false;
		if (m.role === "user") return true;
		return Boolean(onUserText) && String(m.text || "").trim() === onUserText;
	}

	return h("div", {
		id: DIRECTOR_PAGE_ID, style: S.root, "data-testid": "dp-root", className: "dp-textured",
		"data-focus-target": st.focusTarget, "data-composer": composerOk ? "1" : "0",
		/* `data-flow-session`：**宿主当前会话**（既有语义，verify-flow 的会话复原判据用它，勿改）。
		 * 作用域另开两个属性——两者在"作用域=该会话"时相等，在"作用域=文件夹/全局"时**必须不同**，
		 * 若混用一个属性，闸门就分不清"看的是文件夹"还是"会话漂了"（2026-09-14 第 4 批）。 */
		"data-flow-session": (curId || flowSession) || "",
		"data-scope": scopeKey, "data-scope-kind": scopeKind,
		"data-texture": pz.texture,
		/* 第 5 批：缩回栏状态进 DOM（闸门据此断言"展开/钉住"，不靠目测） */
		"data-rail-r4": railOpen.r4 ? "open" : "in", "data-rail-r7": railOpen.r7 ? "open" : "in",
		"data-rail-pinned": (pinned.r4 ? "r4" : "") + (pinned.r7 ? (pinned.r4 ? "+r7" : "r7") : ""),
		/* 第 6 批：把"环境的量"交给环境自己声明（纪律 29）——
		 *   `verify-v17-sync.mjs` 的 A5 段改前写死 `sleep(5400)` 等"悬停 5 秒"，本轮把闸门时长压到
		 *   500ms 后它**仍然是绿的**，只是白等 5 秒 ⇒ 典型的"闸门写死、产品改了照绿"（纪律 14）。
		 *   把两个时长与项目根来源放进 DOM，闸门读这里即可自我校准。 */
		"data-rail-hover-ms": RAIL_HOVER_MS, "data-rail-retract-ms": RAIL_RETRACT_MS,
		"data-file-root": projectRoot().root, "data-file-root-src": projectRoot().src,
		"data-ledger-ok": ledgerView.ok ? "1" : "0",
		/* 执行链路的**可断言面**（界面只显示短词，归因走属性 —— 用户要求「不用多余的解释」） */
		"data-deliver-mode": deliverMode, "data-deliver-via": deliverVia,
		"data-busy": busy ? "1" : "0", "data-run-grade": runGrade || ""
	}, [
		/* ⚠️ R1 独立顶栏：**整行已取消**（2026-09-14 第 4 批 · 用户原话）
		 *   「取消 R1 独立顶栏，两控件并入 R2.5」
		 *   「这个就是这一列 只保留一个文档的切换，和设置放在 2.5 上，其他的都不要」
		 * ⇒ 只留两个控件：作用域下拉（`dp-level`）+ 设置（`dp-personalize`），并入 R2.5 **标题行**。
		 * 🔴 `dp-r1` 随之消失 ⇒ `verify-flow.mjs` 的"页面已挂载"哨兵改用 `dp-root`。
		 * 🔴 **高度不增**：标题行原本是 `10.5px 文字 + 6px 下边距`（≈21px）；新控件取 18px 高、
		 *    下边距收到 3px ⇒ 合计仍是 ≈21px，R2.5 的对外高度与改前一致。 */

		/* ── R2.5 对话控制台（标题行承载"作用域 + 设置"；动作行结构不变） ──
		 * ⚠️ 右内边距接替原 R1 的 `readInset()` 避让：R1 取消后**本行成了页面最上面一行**，
		 *    右端的「⚙ 设置」正落在窗口控件（最小化/最大化/关闭）下面。
		 *    环境量必须由环境读、不能写死（纪律 29）—— inset 由 `safe-area.js` 现取。 */
		h("div", { key: "r2", style: { padding: "7px " + Math.max(9, inset + 9) + "px 0 9px", display: "flex", flexDirection: "column", gap: 7 } }, [
			h("div", { key: "b", style: S.sec, "data-testid": "dp-r25" }, [
				h("div", { key: "t", style: { ...S.blkT, marginBottom: 3 } }, [
					/* ① 作用域下拉 —— 全页**唯一**的"现在在看谁"（原 R1 最左位置，用户不用改肌肉记忆） */
					h("select", {
						key: "sel", "data-testid": "dp-level", "aria-label": "切换作用域（全局 / 文件夹 / 对话）",
						value: nodeId,
						onChange: (e) => { directorLayoutStore.setActiveNode(e.target.value); },
						/* 面包屑信息挪进 title：去掉 `dp-crumb` 后"完整路径"仍可悬停查到 */
						title: "切换作用域：全局总管 / 文件夹 / 对话"
							+ (crumbs.length ? "。当前路径：" + crumbs.map((c) => c.name).join(" / ") : ""),
						style: {
							maxWidth: 190, height: 18, fontSize: "calc(10.5px * var(--dp-font,1))",
							borderRadius: "var(--dp-radius-sm, 5px)", border: "1px solid var(--dp-line, #3d4148)",
							background: "var(--dp-bg-2, #212429)", color: "var(--dp-t1, #e8eaed)"
						}
					}, buildOptions(tree)),
					/* ② 折叠开关 —— **只有这一小块可点**。
					 * 🔴 下拉与设置**绝不能**放进它里面：点下拉切换选项会顺带把整个控制台折叠掉
					 *    （事件冒泡），这是"点一下坏两件事"的典型。 */
					h("span", {
						key: "tg", style: { cursor: "pointer", whiteSpace: "nowrap" },
						onClick: () => toggleCollapse("r2"), "data-testid": "dp-r2-toggle"
					}, (collapsed.r2 ? "▶ " : "▼ ") + "R2.5 对话控制台"),
					/* ③ 右端状态：作用域种类（+ 无对话标记）+ 血缘 */
					h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)", whiteSpace: "nowrap" } },
						scopeKindLabel + (scopeHasChat ? "" : " · 无对话")
						+ " ｜ 血缘：" + (branch.lineage ? "已连接" : "降级")),
					/* ④ 设置（原 R1 最右位置；`data-testid` 原样 —— 既有闸门锚点，纪律 7 不可改名） */
					h("button", {
						key: "p", "data-testid": "dp-personalize",
						style: { ...S.btn, height: 18, padding: "0 7px", fontSize: "calc(10.5px * var(--dp-font,1))" },
						title: "个性化设定：主色 / 质感 / 密度 / 字号 / 圆角（与导图 / 弹窗 / 设计图共用同一份）",
						onClick: () => { setPOpen((v) => !v); setOOpen(false); }
					}, "⚙ 设置"),
					/* ⑤ 编排体系（2026-09-14 架构补全）：四层组织 / 执行图 / 策略预算 / 验收标准。
					 *    与 ⚙ 设置互斥（同时只开一个浮层）。 */
					h("button", {
						key: "o", "data-testid": "dp-orchestrate",
						style: { ...S.btn, height: 18, padding: "0 7px", fontSize: "calc(10.5px * var(--dp-font,1))" },
						title: "编排体系：四层组织（治理/编排/执行/合规）· 执行图 · 策略与预算 · 验收标准",
						onClick: () => { setOOpen((v) => !v); setPOpen(false); }
					}, "⧉ 编排")
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

			/* ── R2 项目总览（定位 / 目标 / 当前阶段 + 四指标卡 + 库计数） ──
			 * 🔴 第 5 批：原 R6 记忆面板的 节点 / 消息 / 问题 三数**并入此处**，
			 *    并**保留原 testid**（`dp-db-nodes` / `dp-db-msgs` / `dp-db-problems`）——
			 *    锚点是冻结契约：数据可以搬家，名字不能改（纪律 7）。 */
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
				/* R6 并入行（原「总监记忆 · 三层记忆 + 独立库统计」的有效数据）*/
				h("div", { key: "db", style: { ...S.muted, display: "flex", gap: 12, flexWrap: "wrap", marginTop: 7, paddingTop: 5, borderTop: "1px dashed var(--dp-line, #31343a)" } }, [
					h("span", { key: "n", "data-testid": "dp-db-nodes" }, "节点 " + ((stats && stats.nodes) || 0)),
					h("span", { key: "c", "data-testid": "dp-db-msgs" }, "消息 " + ((stats && stats.conversations) || 0)),
					h("span", { key: "r" }, "审核 " + ((stats && stats.reviews) || 0)),
					h("span", { key: "d" }, "决策 " + ((stats && stats.decisions) || 0)),
					h("span", {
						key: "pb", "data-testid": "dp-db-problems",
						style: { color: problems ? "#e5534b" : "inherit" },
						title: "问题记录：未通过的审核 + 节点风险"
					}, "问题 " + problems),
					h("span", { key: "lib", style: { marginLeft: "auto" }, title: "数据落在插件独立库（IndexedDB）" },
						"库 " + ((stats && stats.name) || "—"))
				]),
				h("div", { key: "s", style: S.src }, "数据源：" + metrics.map((m) => m.k + " ← " + m.src).join(" ｜ ")
					+ " ｜ 库计数 ← pluginDbStats()")
			])
		]),

		/* ── R4 / R5 / R7 三栏（R4 / R7 为**缩回栏**：默认 26px，hover 5s 或点击展开）──
		 * 🔴 第 5 批 · 用户原话：「r4,r7没有占据整列, 也没有弹窗」
		 *    实测真实根因**有两半**：
		 *      ① 盒子没有 `flex:1` ⇒ 只有内容高度、下方留白（R5 的盒子有 flex:1，所以只有它占满）；
		 *      ② 根本没有"缩回 → 弹出 → 固定"这个中间态（R4=200px、R7=210px 恒宽常驻）。
		 *    ⇒ 这一版两半一起修：`S.cols` 加 `alignItems:stretch` + 每栏 `flex:1` ⇒ 占满整列；
		 *      并加缩回栏（默认 26px）。 */
		h("div", {
			key: "cols", "data-testid": "dp-cols",
			/* 第 6 批：栏宽取自 store（可拖拽 · 持久化）。
			 * 🔴 这里若继续写死 `COL_R4_W`，拖动就变成"改了 store 但不生效"的静默缺陷 ⇒
			 *    两个宽度**同时进 DOM**（`data-w-*`），闸门可直接对账"拖 N px ⇒ 属性变 N"。 */
			"data-w-r4": directorLayoutStore.getRailWidth("r4"), "data-w-r7": directorLayoutStore.getRailWidth("r7"),
			"data-gap": 0,
			style: { ...S.cols, gridTemplateColumns: (railOpen.r4 ? directorLayoutStore.getRailWidth("r4") + "px" : RAIL_WIDTH + "px") + " 1fr " + (railOpen.r7 ? directorLayoutStore.getRailWidth("r7") + "px" : RAIL_WIDTH + "px") }
		}, [
			/* R4 项目导航 */
			railOpen.r4
				? h("div", {
					key: "r4", style: S.col, "data-testid": "dp-r4",
					onMouseEnter: () => railEnter("r4"), onMouseLeave: () => railLeave("r4")
				}, [
					h("div", { key: "s", style: { ...S.sec, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } }, [
						renderPanelHead("r4", "R4 项目导航"),
						h("div", { key: "seg", style: { display: "flex", border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius-sm, 5px)", overflow: "hidden", marginBottom: 6 } },
							R4_TABS.map((tb) => h("button", {
								key: tb.key, style: S.seg(r4tab === tb.key), "data-testid": "dp-r4-" + tb.key,
								"aria-selected": r4tab === tb.key, role: "tab",
								onClick: () => setR4tab(tb.key)
							}, tb.label))),
						h("div", { key: "b", style: { ...S.muted, flex: 1, minHeight: 0, overflowY: "auto" }, className: "dp-scroll" }, renderR4Body())
					]),
					/* 宽度拖拽条（绝对定位，不参与 flex 流） */
					renderResizer("r4")
				])
				: renderRail("r4"),

			/* R5 当前会话的流转 + 总监消息 */
			h("div", { key: "r5", style: S.col, "data-testid": "dp-r5", "data-view": r5view },
				h("div", { key: "s", style: { ...S.sec, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } }, [
					h("div", { key: "t", style: S.blkT }, [
						r5view === "chat" ? "R5 对话消息" : "R5 总监对话区",
						h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } },
							r5view === "chat" ? "宿主原文 · 含历史" : "只治理 · 不执行")
					]),

					/* ── 第 6 批（V20 需求 3）：条目详情**占用** R5 ──────────────────
					 *  「每一项点开的时候占用总监对话区，缩回去的时候再显示总监对话区」
					 *  ⇒ 详情卡与 R5 常规内容**互斥**：一个 `selectedItem` 同时管住
					 *    「现在在做的事 / 分段 / 正文」三块，缩回即原样恢复。
					 *  ⚠️ 用 `null` 占位而不是条件展开数组 —— 数组下标变了下方的
					 *     `key` 重排会让 React 重建整块（滚动位置与 focus 一起丢）。 */
					selectedItem ? renderR4Detail() : null,
					/* ① 现在在做的事（固定在最上面；「对话」视图下隐藏 —— 那块的语义是"总监在做什么"） */
					(selectedItem || r5view === "chat") ? null : h("div", {
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
						/* 作用域脚注：会话作用域说"哪个会话"；文件夹/全局作用域**明说没有对话** ——
						 * 项目纪律：读不到/不存在就如实写出来，不编一个会话名顶替（需求 ②）。 */
						h("div", { key: "f", style: { ...S.muted, marginTop: 4 } },
							scopeHasChat
								? ("会话 …" + String(scopeKey).slice(-8) + " · 流转 " + sessionFlows.length + " 条"
									+ (latest ? (" · " + flowLine(latest)) : ""))
								: ("该作用域没有对话（" + scopeKindLabel + "：" + (node ? node.name : "—") + "）· 流转 " + sessionFlows.length + " 条"))
					]),

					/* ② 分段：流转 / 总监消息（详情占用期间隐藏 —— 避免"看着详情却在切分段"；
					 *    「对话」视图下也隐藏 —— 那两个 Tab 属"总监侧"内容，留着会与按钮文案打架） */
					(selectedItem || r5view === "chat") ? null : h("div", { key: "seg2", style: { display: "flex", border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius-sm, 5px)", overflow: "hidden", marginBottom: 6, flex: "0 0 auto" } }, [
						h("button", { key: "f", style: S.seg(r5tab === "flow"), "data-testid": "dp-r5-flow", onClick: () => setR5tab("flow") }, "流转 " + sessionFlows.length),
						h("button", { key: "m", style: S.seg(r5tab === "msg"), "data-testid": "dp-r5-msg", onClick: () => setR5tab("msg") }, "总监消息 " + msgs.length)
					]),

					selectedItem ? null : h("div", { key: "b", style: { flex: 1, minHeight: 0, overflowY: "auto" }, className: "dp-scroll", "data-testid": "dp-r5-body", "data-view": r5view },
						r5view === "chat"
							? renderChatView()
							: r5tab === "flow"
							? (sessionFlows.length
								? sessionFlows.slice(-20).reverse().map((f) => h("div", {
									key: f.flowId, "data-testid": "dp-flow-item", "data-flow-id": f.flowId, "data-origin": f.origin, "data-status": f.status,
									/* `data-target`：判定结果落到哪 —— 让"按消息判归属"在 DOM 上可读（第 5 批）*/
									"data-target": f.target || "",
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
										f.target ? h("span", { key: "tg", style: { ...S.muted, color: "var(--dp-ac2, #7fe3e8)" } }, "→ …" + String(f.target).slice(-8)) : null,
										h("span", { key: "a", style: S.muted }, new Date(f.at).toLocaleTimeString())
									])
								]))
								: h("div", { key: "e", style: S.muted, "data-testid": "dp-flow-empty" },
									"该作用域还没有流转。本轮起，输入走**原生对话框**：写完后点 R8 的「登记为流转」，就会出现在这里，" +
									"并同步出现在导图右侧面板与设计图底部。"))
							: (msgs.length
								? msgs.slice(-14).map((m) => {
									const mine = msgIsMine(m);
									return h("div", {
										key: m.messageId || m.at, style: S.msgRow(mine), "data-testid": "dp-dir-msg",
										"data-role": mine ? "user" : "assistant", "data-side": mine ? "right" : "left"
									}, [
										mine ? null : h("div", { key: "a", style: S.av(false) }, "总"),
										h("div", { key: "b", style: S.bub(mine) }, m.text),
										mine ? h("div", { key: "a2", style: S.av(true) }, "你") : null
									]);
								})
								: h("div", { key: "e", style: S.muted, "data-testid": "dp-r5-empty" }, "尚无总监消息")))
				])),

			/* R7 关键文件 / 产出物 */
			railOpen.r7
				? h("div", {
					key: "r7", style: S.col, "data-testid": "dp-r7",
					onMouseEnter: () => railEnter("r7"), onMouseLeave: () => railLeave("r7")
				}, [
					h("div", { key: "s", style: { ...S.sec, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } }, [
						renderPanelHead("r7", "R7 详情 / 产出物"),
						h("div", { key: "seg", style: { display: "flex", border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius-sm, 5px)", overflow: "hidden", marginBottom: 6 } },
							R7_TABS.map((tb) => h("button", {
								key: tb.key, style: S.seg(r7tab === tb.key), "data-testid": "dp-r7-" + tb.key,
								"aria-selected": r7tab === tb.key, role: "tab",
								onClick: () => setR7tab(tb.key)
							}, tb.label))),
						h("div", { key: "b", style: { ...S.muted, flex: 1, minHeight: 0, overflowY: "auto" }, className: "dp-scroll" }, renderR7Body())
					]),
					/* 宽度拖拽条（R7 在右 ⇒ 热区吸附左内侧边） */
					renderResizer("r7")
				])
				: renderRail("r7")
		]),

		/* ── R8 焦点条：**第 6 批需求 9 已整行移除**（用户原话「都完成之后去掉这一行」）──────
		 *  被移除的那一行 = 「目标 总监 ● 对话 定位输入框 登记流转 模型 qwen2:7b ▾ 上下文 0% 会话 …6dcda14e」。
		 *  🔴 不是简单删除 —— 能力**先搬迁、再摘行**（否则等于静默砍功能）：
		 *     · 「总监 / 对话」切换 → 需求 7：搬成**一个按钮**，注入到宿主底部统计行
		 *       「N 轮 · N 步」之前（bridge/host-composer-slot.js 的 #dsh-host-scope-toggle）。
		 *     · 「执行」「登记流转」→ 同一条注入条（dp-host-deliver / dp-host-register）。
		 *     · 「模型 ▾ / 上下文」→ 需求 8 要求并入**标准模型选择**；该条本轮**未达成**
		 *       （宿主标准选择器侧是否有 ollama provider 接入点尚未核实），故本页**不再自建**
		 *       模型菜单 —— 免得出现「两处都能选模型、两处都可能不生效」。
		 *     · 「会话 …xxxx」→ 并入 R5「现在在做的事」的脚注（那里本来就有会话/作用域脚注）。
		 *     · 「定位输入框」→ 撤除：原生输入框就在同一屏底部，属冗余入口。
		 *  ⚠️ 因此依赖 dp-r8 / dp-send / dp-model / dp-route-* / dp-focus-native 的旧闸门
		 *     必须同步改锚点，否则会以「产品坏了」的形态假红（纪律 14：闸门自己会过期）。 */


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

		/* 「执行状态 · 技能 / 智能体调用」（第 6 批需求 6）———————————————
		 * 🔴 **常驻挂载**（改前是「有内容才挂载」，那是用户"还是没有"的直接原因）。
		 * 🔴 两条子区，粒度不同、**不合并**：
		 *     · 执行链（最近一次）——「谁在做、做到第几步、指向哪个入口、什么档」
		 *     · 正在使用（近 N 分钟的单次调用）—— 弹窗里手选调用产生的记录
		 * 右端避让浮动按钮组与窗口 inset（环境量由环境读，纪律 29）。
		 * ⚠️ `data-*` 是闸门锚点，**改名即假红**：dp-running / dp-running-item /
		 *    dp-chain / dp-chain-step / dp-chain-empty。 */
		h("div", {
			key: "running", "data-testid": "dp-running",
			"data-count": running.length,
			"data-chain": chainShow ? "1" : "0",
			"data-chain-status": chainShow ? String(chainShow.status) : "",
			"data-chain-steps": chainShow && Array.isArray(chainShow.steps) ? chainShow.steps.length : 0,
			"data-generating": generating ? "1" : "0",
			"data-runs-persisted": runsState.persisted ? "1" : "0",
			title: "执行状态：真实执行链五步（数据源 store/agent-runs.js）· 「正在使用」＝最近 "
				+ (RUNNING_WINDOW_MS / 60000) + " 分钟内有调用记录的智能体 / 技能",
			style: {
				position: "absolute", top: 6, right: Math.max(9, inset + 9 + dockReserve), zIndex: 15, maxWidth: 316,
				background: "var(--dp-bg-2, #212429)", border: "1px solid var(--dp-ac2-line, rgba(57,197,207,.4))",
				borderRadius: "var(--dp-radius, 8px)", padding: "5px 7px", boxShadow: "0 10px 28px rgba(0,0,0,.45)"
			}
		}, [
			h("div", {
				key: "t", style: { ...S.muted, fontWeight: 600, marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }
			}, [
				h("span", { key: "h" }, "执行状态 · 技能 / 智能体"),
				chainShow ? h("span", {
					key: "b", "data-testid": "dp-chain-badge",
					style: { marginLeft: "auto", color: chainBadge(chainShow.status).c, fontWeight: 600 }
				}, chainBadge(chainShow.status).t + " · " + relTime(chainShow.at)) : null
			]),

			/* 兼容旧锚点：单次调用视图（有内容才出现这一行，不影响窗口本身是否挂载） */
			running.length ? h("div", {
				key: "l", "data-testid": "dp-running-list", style: { display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }
			}, running.map((r) => h("span", {
				key: r.key, "data-testid": "dp-running-item", "data-kind": r.kind, "data-key": r.key,
				style: r.kind === "skill" ? S.chip2 : S.chip, title: r.note || ""
			}, r.label + (r.status === "warn" ? " ⚠" : "")))) : null,

			/* 执行链五步明细 —— 每步给出：状态 · 角色 · 执行入口（指向）· 档位 */
			chainShow ? h("div", {
				key: "c", "data-testid": "dp-chain",
				style: { display: "flex", flexDirection: "column", gap: 2, fontSize: "calc(11px * var(--dp-font,1))" }
			}, (chainShow.steps || []).map((sp) => {
				const mk = stepMark(sp.status);
				const role = sp.roleId ? ROLE_TARGETS[sp.roleId] : null;
				return h("div", {
					key: sp.n, "data-testid": "dp-chain-step", "data-step": sp.n,
					"data-status": sp.status, "data-role": sp.roleId || "", "data-target": sp.target || "",
					"data-grade": sp.grade || "",
					title: (sp.name || "") + "｜承担：" + (sp.roleId || "（无角色）")
						+ "｜执行入口：" + (sp.target || "（未接入）")
						+ (sp.text ? "｜结果：" + sp.text : "")
						+ (role && role.why ? "｜为什么是它：" + role.why : ""),
					style: { display: "flex", gap: 5, alignItems: "baseline" }
				}, [
					h("span", { key: "m", style: { color: mk.c, width: 10, flex: "0 0 10px" } }, mk.t),
					h("span", { key: "n", style: { width: 78, flex: "0 0 78px", color: "var(--dp-t2, #c9cdd4)" } }, (sp.n || "") + " " + (sp.name || "")),
					h("span", {
						key: "g", style: {
							width: 26, flex: "0 0 26px",
							/* G1=本地模型参与（真档），G0=纯规则降级 —— 颜色区分，不许混成一个色 */
							color: sp.grade === "G1" ? "#b794f6" : "var(--dp-t3, #8b9199)"
						}
					}, sp.grade || ""),
					h("span", { key: "t", style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dp-t3, #8b9199)" } }, shortTarget(sp.target))
				]);
			})) : null,

			/* 链条的非步骤环节：投递 + 中断原因（**有链条才出现**） */
			chainShow ? h("div", {
				key: "e", "data-testid": "dp-chain-tail",
				style: { marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", fontSize: "calc(11px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)" }
			}, [
				h("span", {
					key: "d", "data-testid": "dp-chain-deliver",
					"data-mode": chainShow.deliver ? String(chainShow.deliver.mode || "") : "",
					title: "执行入口：" + targetOf(CHAIN_TARGETS.deliver.module, CHAIN_TARGETS.deliver.symbol)
						+ (chainShow.deliver && chainShow.deliver.reason ? "｜原因：" + chainShow.deliver.reason : "")
				}, "投递 " + (chainShow.deliver ? (chainShow.deliver.mode || "—") + (chainShow.deliver.via ? " · " + chainShow.deliver.via : "") : "未投递")),
				chainShow.note ? h("span", { key: "n", "data-testid": "dp-chain-note" }, chainShow.note) : null
			]) : null,

			/* ── 模型行（第 6 批需求 8）─────────────────────────────────
			 * 🔴 **常驻**，不随"有没有执行记录"出现/消失。
			 *    窗口其余部分是执行**结果**（没跑就没有内容），而模型选择是**设置**，
			 *    任何时候都该能改 —— 若跟着结果一起消失，就又回到了这一轮刚修掉的
			 *    "看起来有、实际没有"（死代码残骸那一类）。
			 * 🔴 全页**唯一**的模型入口（上一轮已否决「两处都能选模型」）。
			 *    位置沿用原来的只读标签处 ⇒ **不新增行**（需求 9 刚摘掉一行）。 */
			h("div", {
				key: "m", "data-testid": "dp-chain-model",
				style: { marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: "calc(11px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)" },
				title: "执行入口：" + targetOf(CHAIN_TARGETS.model.module, CHAIN_TARGETS.model.symbol)
					+ "｜本链条五步判定的建议模型：" + ((chainShow && chainShow.model) ? chainShow.model : "（尚无执行）")
					+ "｜此处可直接切换模型（含本地 Ollama），唯一配置源 = dsh.director.config"
			}, [
				h("span", { key: "l" }, "模型"),
				h(ModelSeat, { key: "seat" }),
				(chainShow && chainShow.model)
					? h("span", { key: "n", "data-testid": "dp-chain-model-advice" }, "本次判定 " + chainShow.model)
					: null
			]),

			/* 空态：**明确说明"还没有"，并给出让它有内容的动作** ——
			 * 「空窗常驻看着像坏了」不是靠不挂载解决的，是靠写清空态解决的。 */
			!chainShow ? h("div", {
				key: "z", "data-testid": "dp-chain-empty",
				style: { ...S.muted, fontSize: "calc(11px * var(--dp-font,1))" }
			}, "还没有执行记录。在下方输入框写一句并点「执行」，这里会显示五步的真实状态与调用指向。") : null
		]),

		/* 个性化面板（右上角；四处共用同一组件与同一份设定） */
		h(PersonalizePanel, { key: "pp", open: pOpen, onClose: () => setPOpen(false), inset: inset, top: 40, scope: "总监页" }),

		/* 编排体系面板（2026-09-14 架构补全；与个性化面板互斥） */
		h(OrchestratorPanel, { key: "op", open: oOpen, onClose: () => setOOpen(false), inset: inset, top: 40, scope: "总监页" })
	]);
}

/** R2.5 控制台的七个动作（按钮顺序即此数组顺序；`key` 同时是 `data-testid` 后缀 `dp-act-<key>`）。
 * 🔴 2026-09-14 事故：我对本文件做整体重写时**删掉了这个定义**，但保留了下方第 1023 行的
 *    `...CONSOLE_ACTIONS.map(...)` 引用 ⇒ 真机 `ReferenceError: CONSOLE_ACTIONS is not defined`
 *    ⇒ 宿主错误边界兜底成 `<div data-slot-error="conversation.view">` ⇒ **总监页整页空白**，
 *    而 `window.__dshDirectorView` 仍是 `{registered:true}`（注册成功 ≠ 渲染成功）。
 *    `lint-undefined-symbols` 当时**没报**，因为它的 [1] 只管"引用了**别的文件导出**的符号"，
 *    而本符号从未被任何文件导出 ⇒ 落在口径之外。已补 [4] 号检查（裸引用的大写常量）。
 *    ⚠️ 与下方 `CONSOLE_HINT` 的键**必须一一对应** —— 少一个键 ⇒ `title: undefined`（静默）。 */
const CONSOLE_ACTIONS = Object.freeze([
	{ key: "plan", icon: "🧭", label: "统筹", tone: "accent2" },
	{ key: "new", icon: "＋", label: "新建", tone: "accent" },
	{ key: "del", icon: "🗑", label: "删除", tone: "danger" },
	{ key: "grab", icon: "📥", label: "抓取", tone: "" },
	{ key: "close", icon: "🔚", label: "回结", tone: "warn" },
	{ key: "review", icon: "🎯", label: "审核", tone: "accent2" },
	{ key: "next", icon: "⏭", label: "继续", tone: "" }
]);

/** R2.5 七动作的说明（title 用；写明"能做什么 / 不能做时缺什么"） */
const CONSOLE_HINT = Object.freeze({
	plan: "统筹：读原生输入框里的想法 → 生成 6 阶段计划 + 打分标准自审（空想法会如实报错）",
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
