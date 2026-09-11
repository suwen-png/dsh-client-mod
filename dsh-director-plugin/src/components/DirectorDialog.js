/**
 * components/DirectorDialog.js — 总监弹窗（要求 5 / 6 / 7 / 8 / 9 / 10 / 11 的落位）
 *
 * ── 形态（docs/10 §4.1 + docs/11 §二 I1/I2）────────────────────
 *   **非模态覆盖层**：不锁原生交互（右区必须可点，因为右区就是原生对话区）。
 *   层次用 **spotlight 遮罩**表达：一个恰好覆盖原生应用根的空矩形，用
 *   `box-shadow: 0 0 0 9999px rgba(...)` 在它"之外"整体压暗 ⇒ 原生区保持全亮可交互，
 *   其余部分被压暗 ⇒ 视觉层次清晰，且**不需要**任何点击拦截。
 *
 *   左＝总监面板（插件）｜右＝原生对话区（被 `bridge/split.js` 向右挤，**同一节点**）
 *   ⇒ 要求 5 的"完全一致"是**同义反复**，不是"同步努力"。
 *
 * ── 三态（要求 6 + docs/11 §二 I6）──────────────────────────────
 *   `⇤` 左栏折叠（`directorPanelCollapsed`）
 *   `⇥` 右栏折叠（`chatPanelCollapsed`）
 *   `–` 整窗最小化（`dialogCollapsed`，🆕 本轮新增字段）→ 收成右下角 chip
 *   `✕` 关闭（`dialogOpen=false`，同时 `clearSplit()` 完全复原原生布局）
 *   chip 点击还原；`Alt+1/2/3` 键盘等价；`Esc` 关闭
 *
 * ── 焦点路由（要求 11 · R8 / docs/11 §二 I7）────────────────────
 *   `document` 捕获阶段 `pointerdown`：命中左面板矩形 → `director`；
 *   命中原生应用根矩形 → `chat`。**不 preventDefault** ⇒ 原生交互不受影响。
 *   底部输入框按 `focusTarget` 决定去向，并有**目标徽章**防止误发。
 *
 * ⚠️ 构建约束：`react` / `react/jsx-runtime` 为**平台冻结模块**（ADR-001），
 *    构建期外置为 `require(...)`；本文件用 `.js` 而非 `.jsx`（宿主为编译后 `jsx()` 形态）。
 */

import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import {
	directorLayoutStore, LEFT_TAB, PANEL_RAIL_WIDTH, PANEL_MIN_WIDTH
} from "../store/layout.js";
import { loadTree, getBreadcrumb, LEVEL_LABEL, GLOBAL_NODE_ID, countByLevel } from "../store/hierarchy.js";
import { onHierarchyChange } from "../util/bus.js";
import { applySplit, clearSplit, getSplitRootRect } from "../bridge/split.js";
import { sendToChat, observeConversation, readConversation, installChatBridgeApi } from "../bridge/chat-bridge.js";
import { route, confirmRoute, review6, reviewAndSave, DESTINATION, DESTINATION_LABEL } from "../logic/routing.js";
import { appendDirectorMessage, listDirectorMessages, pluginDbStats, PLUGIN_DB_NAME } from "../store/plugin-db.js";
import { DirectorWorkbench } from "./DirectorWorkbench.js";
import { DirectorHierarchy } from "./DirectorHierarchy.js";
import { dshLog } from "../util/debug.js";

export const DIALOG_ID = "dsh-director-dialog";
export const CHIP_ID = "dsh-director-chip";

/* ── 5 类标准智能体（17 号文 §1A.8，含执行标准 + 检查清单）── */
export const AGENTS = Object.freeze([
	{ key: "code", label: "代码", mode: "auto", desc: "实现 / 重构 / 修复，产出可运行代码", checks: ["可编译", "有测试", "零硬编码密钥"] },
	{ key: "doc", label: "文档", mode: "auto", desc: "需求 / 设计 / 交付文档编写", checks: ["结构完整", "含出处", "有反证"] },
	{ key: "research", label: "调研", mode: "manual", desc: "外部资料检索与交叉比对", checks: ["来源可追溯", "交叉验证", "结论明确"] },
	{ key: "test", label: "测试", mode: "auto", desc: "用例编写与执行", checks: ["可重复", "覆盖边界", "结果可核验"] },
	{ key: "review", label: "审核", mode: "manual", desc: "六维审核与纠偏", checks: ["六维齐备", "含证据", "打回可追溯"] }
]);

/** 可调用技能（R3 第二段；`mode` 表示默认调用方式） */
export const SKILLS = Object.freeze([
	{ key: "execution-standards", label: "执行标准规范", mode: "auto", desc: "L1–L4 链路 / 检查点 / 终止条件" },
	{ key: "codebase-inspection", label: "代码库勘察", mode: "manual", desc: "行数 / 语言 / 结构盘点" },
	{ key: "mermaid-diagram", label: "图表生成", mode: "manual", desc: "流程图 / 时序图 / 架构图" },
	{ key: "browser-skill", label: "浏览器操作", mode: "manual", desc: "自动化导航与抓取" }
]);

/* ── 调用记录（R3「调用情况」的数据源；内存态，会话级）── */
/** 面板「调用情况」一屏最多渲染条数（超出部分由 `data-run-total` 反映真实总数） */
export const RUNS_SHOWN = 8;
/** 内存中最多保留条数 */
export const RUNS_KEEP = 30;
const agentRuns = [];
export function recordAgentRun(key, status, note) {
	agentRuns.unshift({ key, status: status || "ok", note: note || "", at: Date.now() });
	if (agentRuns.length > RUNS_KEEP) agentRuns.length = RUNS_KEEP;
}
/**
 * 列出调用记录（最新在前）。
 * 🔴 无参调用返回**全量**（供 `data-run-total` 反映真实条数）；
 *    渲染截断由面板自己做（`RUNS_SHOWN`）——「列表 API 静默截断」曾使
 *    「5 智能体 + 4 技能 = 9 条」时最旧一条被挤出，验证脚本据此误判为缺记录。
 * @param {number} [limit]
 */
export function listAgentRuns(limit) {
	return typeof limit === "number" && limit >= 0 ? agentRuns.slice(0, limit) : agentRuns.slice();
}

const RAIL = PANEL_RAIL_WIDTH;

/* ── 样式（尽量使用 Harness 主题变量并给 fallback）── */
const S = {
	layer: { position: "fixed", inset: 0, zIndex: 2147483000, pointerEvents: "none" },
	hole: { position: "absolute", pointerEvents: "none", borderRadius: 8 },
	panel: {
		position: "absolute", pointerEvents: "auto", display: "flex", flexDirection: "column",
		background: "var(--dsw-alias-bg-base, #16171a)", color: "var(--dsw-alias-label-primary, #e8eaed)",
		border: "1px solid rgba(137,87,229,.42)", borderRadius: 10, overflow: "hidden",
		boxShadow: "0 24px 70px rgba(0,0,0,.62)", fontFamily: "inherit", fontSize: 12.5
	},
	head: { display: "flex", alignItems: "center", gap: 6, height: 36, flex: "0 0 36px", padding: "0 8px", borderBottom: "1px solid var(--dsw-alias-border-l2, #31343a)", background: "var(--dsw-alias-bg-sunken, #1c1e22)" },
	headTitle: { fontWeight: 620, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" },
	lvchip: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, padding: "2px 6px", borderRadius: 4, background: "rgba(137,87,229,.18)", border: "1px solid rgba(137,87,229,.4)", color: "#b794f6", whiteSpace: "nowrap" },
	btns: { marginLeft: "auto", display: "flex", gap: 3 },
	btn: { width: 24, height: 22, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-sunken, #212429)", color: "var(--dsw-alias-label-secondary, #c3c8ce)", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: 0 },
	seg: { display: "flex", border: "1px solid var(--dsw-alias-border-l2, #3d4148)", borderRadius: 6, overflow: "hidden", margin: "6px 8px 0", flex: "0 0 auto" },
	segItem: (on) => ({ flex: 1, textAlign: "center", fontSize: 11.5, padding: "5px 0", cursor: "pointer", border: "none", color: on ? "#c9a9ff" : "var(--dsw-alias-label-tertiary, #8b9199)", background: on ? "rgba(137,87,229,.20)" : "var(--dsw-alias-bg-sunken, #212429)", fontWeight: on ? 600 : 400 }),
	body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 8 },
	blk: { border: "1px solid var(--dsw-alias-border-l2, #31343a)", borderRadius: 7, background: "var(--dsw-alias-bg-sunken, #1c1e22)", padding: "8px 9px" },
	blkT: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", letterSpacing: ".4px", marginBottom: 7, display: "flex", alignItems: "center", gap: 6 },
	kv: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 },
	kvc: { background: "var(--dsw-alias-bg-base, #212429)", border: "1px solid var(--dsw-alias-border-l2, #31343a)", borderRadius: 5, padding: "5px 7px" },
	kvV: { fontSize: 14, fontWeight: 650 },
	kvK: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", marginTop: 1 },
	chips: { display: "flex", flexWrap: "wrap", gap: 5 },
	chip: (mode, on) => ({
		fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
		border: "1px solid " + (mode === "auto" ? "rgba(137,87,229,.42)" : "rgba(210,153,34,.42)"),
		background: on ? "rgba(137,87,229,.16)" : "var(--dsw-alias-bg-base, #212429)",
		color: mode === "auto" ? "#b794f6" : "#e0b341", fontWeight: on ? 600 : 400
	}),
	dot: (c) => ({ width: 5, height: 5, borderRadius: "50%", background: c || "#39c5cf", display: "inline-block" }),
	input: { flex: 1, minWidth: 0, height: 28, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-sunken, #141619)", color: "var(--dsw-alias-label-primary, #e8eaed)", padding: "0 9px", fontSize: 11.5, boxSizing: "border-box" },
	btnPrimary: { height: 28, padding: "0 11px", borderRadius: 6, border: "1px solid #2f6bdd", background: "#2f6bdd", color: "#fff", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" },
	btnGhost: { height: 24, padding: "0 9px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-sunken, #212429)", color: "var(--dsw-alias-label-secondary, #c3c8ce)", cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap" },
	rail: (side) => ({
		position: "absolute", pointerEvents: "auto", display: "flex", flexDirection: "column", alignItems: "center",
		justifyContent: "flex-start", gap: 8, paddingTop: 10, cursor: "pointer",
		background: "var(--dsw-alias-bg-sunken, #1b1e23)", border: "1px solid var(--dsw-alias-border-l2, #31343a)",
		color: side === "left" ? "#b794f6" : "#79a8ff", fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, letterSpacing: 1
	}),
	muted: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #8b9199)", lineHeight: 1.6 },
	msg: { display: "flex", gap: 6, marginBottom: 6 },
	av: (kind) => ({ width: 18, height: 18, flex: "0 0 18px", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "ui-monospace,Consolas,monospace", fontSize: 9.5, fontWeight: 700, background: kind === "user" ? "rgba(47,111,235,.18)" : "rgba(137,87,229,.22)", color: kind === "user" ? "#79a8ff" : "#b794f6", border: "1px solid " + (kind === "user" ? "rgba(47,111,235,.4)" : "rgba(137,87,229,.4)") }),
	bub: { background: "var(--dsw-alias-bg-base, #212429)", border: "1px solid var(--dsw-alias-border-l2, #31343a)", borderRadius: 6, padding: "5px 8px", fontSize: 11.5, lineHeight: 1.55, flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }
};

/* ── 小工具 ── */
const h = react.createElement;
function useStore(store) {
	const [s, set] = react.useState(store.getState());
	react.useEffect(() => store.subscribe(set), [store]);
	return s;
}

/** 六维状态色 */
const DIM_COLOR = { ok: "#3fb950", warn: "#d29922", bad: "#f85149" };
const DIM_MARK = { ok: "✅", warn: "⚠", bad: "❌" };

/* ══════════════════════════════════════════════════════════════════
 * 子组件：路由确认卡（要求 8 STEP4「必须可确认」）
 * ══════════════════════════════════════════════════════════════════ */
function RouteCard({ result, onConfirm, onCancel, busy }) {
	if (!result) return null;
	const d = result.decision;
	return h("div", { style: { ...S.blk, borderColor: "rgba(137,87,229,.5)" }, "data-testid": "d-route-card" }, [
		h("div", { key: "t", style: S.blkT }, ["路由决策（STEP 4）— 待你确认，不静默分发"]),
		h("div", { key: "s", style: { ...S.muted, marginBottom: 6 } }, [
			h("div", { key: "1" }, "意图：" + result.intent.kind + "（置信 " + result.intent.confidence.toFixed(2) + "）"),
			h("div", { key: "2" }, "候选：" + (result.candidates.length ? result.candidates.slice(0, 3).map((c) => c.name + "(" + c.score + ")").join(" / ") : "无")),
			h("div", { key: "3" }, "子任务：" + result.subtasks.length + " 个"),
			h("div", { key: "4", style: { color: "#b794f6" } }, "建议：" + DESTINATION_LABEL[d.destination] + "（置信 " + d.confidence.toFixed(2) + "）"),
			h("div", { key: "5" }, "理由：" + d.reason)
		]),
		h("div", { key: "b", style: { display: "flex", gap: 5, flexWrap: "wrap" } }, [
			h("button", { key: "tr", style: S.btnGhost, "data-testid": "d-route-transfer", disabled: busy, onClick: () => onConfirm(DESTINATION.TRANSFER) }, "转给该对话的总监"),
			h("button", { key: "di", style: { ...S.btnGhost, borderColor: "#2f6bdd", color: "#79a8ff" }, "data-testid": "d-route-direct", disabled: busy, onClick: () => onConfirm(DESTINATION.DIRECT) }, "直接调用对应对话"),
			h("button", { key: "cr", style: S.btnGhost, "data-testid": "d-route-new", disabled: busy, onClick: () => onConfirm(DESTINATION.CREATE) }, "新建对话"),
			h("button", { key: "cx", style: S.btnGhost, "data-testid": "d-route-cancel", disabled: busy, onClick: onCancel }, "取消")
		])
	]);
}

/* ══════════════════════════════════════════════════════════════════
 * 子组件：六维审核卡（要求 3）
 * ══════════════════════════════════════════════════════════════════ */
function ReviewCard({ result, onRun, busy }) {
	return h("div", { style: S.blk, "data-testid": "d-review" }, [
		h("div", { key: "t", style: S.blkT }, [
			"R6 六维审核（17号文 §1A.9，不得减项）",
			h("button", { key: "r", style: { ...S.btnGhost, marginLeft: "auto" }, "data-testid": "d-review-run", disabled: busy, onClick: onRun }, "重跑审核")
		]),
		result
			? h("div", { key: "b" }, result.dims.map((d) => h("div", { key: d.key, style: { display: "flex", gap: 6, alignItems: "baseline", marginBottom: 3 }, "data-dim": d.key, "data-status": d.status }, [
				h("span", { key: "m", style: { color: DIM_COLOR[d.status], width: 14, flex: "0 0 14px" } }, DIM_MARK[d.status]),
				h("span", { key: "l", style: { width: 62, flex: "0 0 62px", color: "#c3c8ce" } }, d.label),
				h("span", { key: "n", style: { ...S.muted, flex: 1, minWidth: 0 } }, d.note)
			])).concat([h("div", { key: "s", style: { ...S.muted, marginTop: 5, color: result.pass ? "#6fd388" : "#f0877f" }, "data-testid": "d-review-summary" }, result.summary)]))
			: h("div", { key: "e", style: S.muted, "data-testid": "d-review-summary" }, "尚未审核。点「重跑审核」或等待对话产出变化自动触发。")
	]);
}

/* ══════════════════════════════════════════════════════════════════
 * 子组件：左面板（R2 / R3 / R5 / R6 + 层级管理）
 * ══════════════════════════════════════════════════════════════════ */
function DirectorPanel({ node, tree, messages, reviewResult, onReview, agentRuns, onCallAgent, engineStats, seg, setSeg }) {
	const counts = react.useMemo(() => countByLevel(tree), [tree]);
	const [agentSeg, setAgentSeg] = react.useState("agents");
	const [called, setCalled] = react.useState({});

	return h("div", { style: S.body, "data-testid": "d-body" }, [
		/* 分段：总监 / 层级 / 智能体 */
		h("div", { key: "seg", style: { ...S.seg, margin: "0 0 2px" }, role: "tablist" }, [
			h("button", { key: "d", role: "tab", style: S.segItem(seg === LEFT_TAB.DIRECTOR), "data-testid": "d-seg-director", "aria-selected": seg === LEFT_TAB.DIRECTOR, onClick: () => setSeg(LEFT_TAB.DIRECTOR) }, "总监"),
			h("button", { key: "l", role: "tab", style: S.segItem(seg === LEFT_TAB.LEVELS), "data-testid": "d-seg-levels", "aria-selected": seg === LEFT_TAB.LEVELS, onClick: () => setSeg(LEFT_TAB.LEVELS) }, "层级"),
			h("button", { key: "a", role: "tab", style: S.segItem(seg === LEFT_TAB.AGENTS), "data-testid": "d-seg-agents", "aria-selected": seg === LEFT_TAB.AGENTS, onClick: () => setSeg(LEFT_TAB.AGENTS) }, "智能体")
		]),

		/* ── 总监段 ── */
		seg === LEFT_TAB.DIRECTOR ? h("div", { key: "dir", style: { display: "flex", flexDirection: "column", gap: 8 }, "data-panel": "director" }, [
			/* R2 项目总览 */
			h("div", { key: "r2", style: S.blk, "data-testid": "d-r2" }, [
				h("div", { key: "t", style: S.blkT }, ["R2 项目总览"]),
				h("div", { key: "k", style: S.kv }, [
					h("div", { key: "p", style: S.kvc }, [h("div", { key: "v", style: S.kvV }, String(counts.project)), h("div", { key: "k", style: S.kvK }, "项目 / 文件夹")]),
					h("div", { key: "s", style: S.kvc }, [h("div", { key: "v", style: S.kvV }, String(counts.session)), h("div", { key: "k", style: S.kvK }, "对话")]),
					h("div", { key: "r", style: S.kvc }, [h("div", { key: "v", style: { ...S.kvV, color: "#e0b341" } }, String((node && node.risks ? node.risks.length : 0))), h("div", { key: "k", style: S.kvK }, "风险")]),
					h("div", { key: "td", style: S.kvc }, [h("div", { key: "v", style: S.kvV }, String((node && node.todos ? node.todos.length : 0))), h("div", { key: "k", style: S.kvK }, "待办")])
				]),
				h("div", { key: "m", style: { ...S.muted, marginTop: 6 } }, "阶段：" + ((node && node.meta && node.meta.currentPhase) || "未设置") + " · 目标：" + ((node && node.meta && node.meta.goal) || "未设置"))
			]),

			/* R5 总监流（只治理不执行） */
			h("div", { key: "r5", style: S.blk, "data-testid": "d-r5" }, [
				h("div", { key: "t", style: S.blkT }, ["R5 总监对话区", h("span", { key: "x", style: { marginLeft: "auto", color: "#8b9199" } }, "只治理 · 不执行")]),
				messages.length
					? messages.slice(-6).map((m) => h("div", { key: m.messageId || m.at, style: S.msg }, [
						h("div", { key: "a", style: S.av(m.role) }, m.role === "user" ? "你" : "总"),
						h("div", { key: "b", style: S.bub }, [
							m.kind ? h("div", { key: "k", style: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10, color: "#b794f6", marginBottom: 3 } }, m.kind) : null,
							h("span", { key: "t2" }, m.text)
						])
					]))
					: h("div", { key: "e", style: S.muted, "data-testid": "d-r5-empty" }, "尚无总监消息。在下方输入框输入，由总监整理并确认去向。")
			]),

			/* 六维审核 */
			h(ReviewCard, { key: "rv", result: reviewResult, onRun: onReview }),

			/* R6 记忆面板 */
			h("div", { key: "r6", style: S.blk, "data-testid": "d-r6" }, [
				h("div", { key: "t", style: S.blkT }, ["R6 总监记忆面板"]),
				h("div", { key: "m", style: S.muted }, [
					h("div", { key: "1", "data-testid": "d-memo-core" }, "核心记忆 · 双层数据元独立（" + PLUGIN_DB_NAME + " v1）"),
					h("div", { key: "2", "data-testid": "d-memo-decision" }, "决策记录 · " + (engineStats && engineStats.decisions ? engineStats.decisions + " 条" : "0 条")),
					h("div", { key: "3", "data-testid": "d-memo-risk" }, "审核记录 · " + (engineStats && engineStats.reviews ? engineStats.reviews + " 条" : "0 条") + " · 总监消息 · " + (engineStats && engineStats.conversations ? engineStats.conversations : 0) + " 条")
				]),
				engineStats ? h("div", { key: "st", style: { ...S.muted, marginTop: 5, fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5 }, "data-testid": "d-dbstats" },
					"自有库 " + PLUGIN_DB_NAME + "：" + engineStats.nodes + " 节点 / " + engineStats.conversations + " 消息 / " + engineStats.reviews + " 审核 / " + engineStats.decisions + " 决策") : null
			])
		]) : null,

		/* ── 层级段（复用 DirectorHierarchy，compact 形态；保留 h-* testid 全套）── */
		seg === LEFT_TAB.LEVELS ? h("div", { key: "lv", style: { minHeight: 0 }, "data-panel": "levels" },
			h(DirectorHierarchy, { compact: true })) : null,

		/* ── 智能体段（R3：分段切换 + 调用情况 + 手选调用）── */
		seg === LEFT_TAB.AGENTS ? h("div", { key: "ag", style: { display: "flex", flexDirection: "column", gap: 8 }, "data-panel": "agents" }, [
			h("div", { key: "r3", style: S.blk, "data-testid": "d-r3" }, [
				h("div", { key: "t", style: S.blkT }, ["R3 智能体 ｜ 技能", h("span", { key: "x", style: { marginLeft: "auto", color: "#8b9199" } }, "总监自动 / 客户手选")]),
				h("div", { key: "seg", style: { ...S.seg, margin: "0 0 7px" } }, [
					h("button", { key: "a", style: S.segItem(agentSeg === "agents"), "data-testid": "d-agent-seg-agents", onClick: () => setAgentSeg("agents") }, "智能体"),
					h("button", { key: "s", style: S.segItem(agentSeg === "skills"), "data-testid": "d-agent-seg-skills", onClick: () => setAgentSeg("skills") }, "技能")
				]),
				h("div", { key: "c", style: S.chips }, (agentSeg === "agents" ? AGENTS : SKILLS).map((a) =>
					h("button", {
						key: a.key, style: S.chip(a.mode, Boolean(called[a.key])), title: a.desc + "｜检查项：" + ((a.checks || ["—"]).join(" / ")),
						"data-testid": "d-agent-" + a.key, "data-mode": a.mode,
						onClick: () => { setCalled((c) => ({ ...c, [a.key]: true })); onCallAgent(a); }
					}, [h("i", { key: "d", style: S.dot(a.mode === "auto" ? "#b794f6" : "#e0b341") }), h("span", { key: "l" }, a.label)])
				)
			)]),
			h("div", { key: "run", style: S.blk, "data-testid": "d-agent-runs", "data-run-total": agentRuns.length }, [
				h("div", { key: "t", style: S.blkT }, ["调用情况（最近" + (agentRuns.length > RUNS_SHOWN ? " " + RUNS_SHOWN + "/" + agentRuns.length : "") + "）"]),
				agentRuns.length
					? agentRuns.slice(0, RUNS_SHOWN).map((r, i) => h("div", { key: i, style: { ...S.muted, display: "flex", gap: 6 }, "data-run-key": r.key }, [
						h("i", { key: "d", style: S.dot(r.status === "ok" ? "#3fb950" : "#d29922") }),
						h("span", { key: "k", style: { width: 54, flex: "0 0 54px" } }, r.key),
						h("span", { key: "s", style: { flex: 1, minWidth: 0 } }, r.status + (r.note ? " · " + r.note : ""))
					]))
					: h("div", { key: "e", style: S.muted, "data-testid": "d-agent-runs-empty" }, "尚无调用记录。点击上方任一智能体/技能即产生一条。")
			])
		]) : null
	]);
}

/* ══════════════════════════════════════════════════════════════════
 * 主组件：弹窗外壳
 * ══════════════════════════════════════════════════════════════════ */
export function DirectorDialog(props = {}) {
	installChatBridgeApi(); // 幂等
	const st = useStore(directorLayoutStore);
	const open = Boolean(st.dialogOpen) && props.open !== false;
	const collapsed = Boolean(st.dialogCollapsed);
	const leftCollapsed = Boolean(st.directorPanelCollapsed);
	const rightCollapsed = Boolean(st.chatPanelCollapsed);
	const leftWidth = Number(st.directorPanelWidth) || PANEL_MIN_WIDTH;

	const [geo, setGeo] = react.useState(() => getSplitRootRect());
	const [tree, setTree] = react.useState(null);
	const [crumbs, setCrumbs] = react.useState([]);
	const [messages, setMessages] = react.useState([]);
	const [stats, setStats] = react.useState(null);
	const [reviewResult, setReviewResult] = react.useState(null);
	const [routeResult, setRouteResult] = react.useState(null);
	const [runs, setRuns] = react.useState([]);
	const [draft, setDraft] = react.useState("");
	const [busy, setBusy] = react.useState(false);
	const [toast, setToast] = react.useState("");
	const [dragW, setDragW] = react.useState(null);
	const [unread, setUnread] = react.useState(0);
	const panelRef = react.useRef(null);
	const dragRef = react.useRef(null);
	const convRef = react.useRef({ count: 0, lastText: "" });

	const nodeId = st.activeNodeId || GLOBAL_NODE_ID;
	const seg = st.leftTab || LEFT_TAB.DIRECTOR;

	/** 当前层级节点（值，非函数 —— 供各 effect 与渲染共用） */
	const node = react.useMemo(() => {
		if (!tree) return null;
		let found = null;
		const walk = (n) => {
			if (found) return;
			if (n.id === nodeId) { found = n; return; }
			(n.childNodes || []).forEach(walk);
		};
		walk(tree);
		return found;
	}, [tree, nodeId]);

	/* ── 布局计算（须在下方分屏 effect 之前，`padLeft` 为其依赖）── */
	const W = geo ? geo.w : 1162;
	const H = geo ? geo.h : 816;
	const rightCollapsePad = Math.max(RAIL, W - RAIL - 4);
	const padLeft = rightCollapsed ? rightCollapsePad : (leftCollapsed ? RAIL : leftWidth);
	const panelWidth = leftCollapsed ? RAIL : (rightCollapsed ? Math.max(PANEL_MIN_WIDTH, W - RAIL - 8) : leftWidth);

	/* ── 几何跟随 + 分屏注入 / 撤销（**必须成对**，见 docs/11 §三 3.2 教训）──
	 * 🔴 两者合并成一个 effect：宿主每次重渲染都可能**丢掉 `data-dsh-split-root` 标记**
	 *    （标记挂在宿主节点上，不在 React 树里），只同步几何不重挂标记 ⇒ 分屏**静默失效**
	 *    （样式节点还在、`isSplitActive()` 仍 true，但选择器命中不到任何元素）。
	 *    故按 900ms 心跳 + resize 一并「重挂标记 + 重算几何」；`applySplit` 幂等。
	 */
	react.useEffect(() => {
		if (!open || collapsed) { clearSplit(); return undefined; }
		const sync = () => {
			setGeo(getSplitRootRect());
			applySplit({ paddingLeft: padLeft, collapsed: rightCollapsed ? "right" : (leftCollapsed ? "left" : null) });
		};
		sync();
		window.addEventListener("resize", sync);
		const t = setInterval(sync, 900);
		return () => { window.removeEventListener("resize", sync); clearInterval(t); clearSplit(); };
	}, [open, collapsed, padLeft, leftCollapsed, rightCollapsed]);

	/* ── 数据：层级树 / 消息 / 统计 ── */
	const refresh = react.useCallback(async () => {
		try {
			const t = await loadTree();
			setTree(t);
			setCrumbs(await getBreadcrumb(nodeId));
			const [msgs, s] = await Promise.all([listDirectorMessages(nodeId), pluginDbStats()]);
			setMessages(msgs || []);
			setStats(s);
			setRuns(listAgentRuns());
		} catch (e) { /* 数据层异常不影响 UI */ }
	}, [nodeId]);

	react.useEffect(() => { if (open) refresh(); }, [open, refresh]);
	react.useEffect(() => onHierarchyChange(() => { if (open) refresh(); }), [open, refresh]);

	/* ── 右 → 左：产出变化 → 六维审核 + 未读 ── */
	react.useEffect(() => {
		if (!open || collapsed) return undefined;
		convRef.current = readConversation();
		const off = observeConversation((info) => {
			if (info.delta > 0) {
				setUnread((u) => u + info.delta);
				// 自动触发六维审核（要求 3：审核对话实际产出是否达标）
				const r = review6({
					goal: String((node && node.name) || "") + " " + ((node && node.meta && node.meta.goal) || ""),
					output: info.lastText,
					evidence: info.lastText ? ["对话产出片段 " + info.lastText.slice(0, 60)] : [],
					risks: []
				});
				setReviewResult(r);
				recordAgentRun("review", r.pass ? "ok" : "warn", "自动审核 " + r.score + " 分");
				setRuns(listAgentRuns());
			}
		});
		return off;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, collapsed, node, nodeId]);

	/* ── 焦点路由（要求 11 · R8；非拦截，仅观测）── */
	react.useEffect(() => {
		if (!open || collapsed) return undefined;
		const onDown = (e) => {
			const t = e.target;
			if (panelRef.current && panelRef.current.contains(t)) { directorLayoutStore.setFocusTarget("director"); return; }
			const g = getSplitRootRect();
			if (!g) return;
			const x = e.clientX, y = e.clientY;
			if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) directorLayoutStore.setFocusTarget("chat");
		};
		document.addEventListener("pointerdown", onDown, true);
		return () => document.removeEventListener("pointerdown", onDown, true);
	}, [open, collapsed]);

	/* ── 键盘：Esc 关闭，Alt+1/2/3 三态（docs/11 §一 7）── */
	react.useEffect(() => {
		if (!open) return undefined;
		const onKey = (e) => {
			if (e.key === "Escape") { directorLayoutStore.setDialogOpen(false); return; }
			if (e.altKey && (e.key === "1" || e.key === "2" || e.key === "3")) {
				e.preventDefault();
				if (e.key === "1") directorLayoutStore.toggleDirectorCollapsed();
				if (e.key === "2") directorLayoutStore.toggleChatCollapsed();
				if (e.key === "3") directorLayoutStore.toggleDialogCollapsed();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	/* ── 拖拽中缝 ── */
	const dragWRef = react.useRef(null);
	react.useEffect(() => { dragWRef.current = dragW; }, [dragW]);

	const calcDragW = react.useCallback((clientX) => {
		if (!dragRef.current || typeof clientX !== "number") return null;
		return Math.max(RAIL, dragRef.current.w0 + (clientX - dragRef.current.x0));
	}, []);

	const onDragMove = react.useCallback((e) => {
		const next = calcDragW(e.clientX);
		if (next == null) return;
		setDragW(next);
	}, [calcDragW]);
	const onDragEnd = react.useCallback((e) => {
		if (!dragRef.current) return;
		/* 🔴 `dragWRef.current` 可能为 null：pointerdown → pointermove → pointerup 若落在
		 *    **同一个 task**（用户快速甩动 / 自动化脚本连发），React 尚未提交 `setDragW`
		 *    ⇒ ref 仍是 null ⇒ 位移被**静默丢弃**，拖拽"没反应"。
		 *    故以 pointerup 的坐标**兜底重算**（两者取幂等值，无副作用）。 */
		const w = dragWRef.current != null ? dragWRef.current : calcDragW(e && e.clientX);
		document.removeEventListener("pointermove", onDragMove);
		document.removeEventListener("pointerup", onDragEnd);
		dragRef.current = null;
		// 提交到 store：`dragDirectorWidth` 内部做边界钳制与"过窄自动折叠"吸附（docs/11 §二 I8）
		if (w != null) lastDragSnap = directorLayoutStore.dragDirectorWidth(w);
		setDragW(null);
	}, [onDragMove, calcDragW]);

	const startDrag = (e) => {
		dragRef.current = { x0: e.clientX, w0: panelWidth };
		document.addEventListener("pointermove", onDragMove);
		document.addEventListener("pointerup", onDragEnd);
	};

	/* ── 行为 ── */
	const pushMsg = async (kind, text, role) => {
		const rec = await appendDirectorMessage(nodeId, { kind, text, role: role || "director" });
		await refresh();
		return rec;
	};

	const doReview = async () => {
		setBusy(true);
		try {
			const conv = readConversation();
			const r = await reviewAndSave(nodeId, {
				goal: (node && node.meta && node.meta.goal) || (node && node.name) || "",
				output: conv.lastText,
				evidence: conv.lastText ? ["对话产出 " + conv.count + " 条，末条 " + conv.lastText.slice(0, 50)] : [],
				risks: (node && node.risks) || []
			});
			setReviewResult(r);
			recordAgentRun("review", r.pass ? "ok" : "warn", "六维 " + r.score + " 分");
			setRuns(listAgentRuns());
			setToast("六维审核完成：" + (r.pass ? "通过" : "打回"));
		} finally { setBusy(false); }
	};

	const onSend = async () => {
		const text = draft.trim();
		if (!text) { setToast("请输入内容"); return; }
		setBusy(true);
		try {
			if (st.focusTarget === "chat") {
				// 目标＝对话：直接投给原生对话（要求 5「互相传送消息」）
				const r = await sendToChat(text, { autoSend: true });
				await pushMsg("转投对话", r.ok ? (r.mode === "sent" ? "已发送到对话域：" + text : "已填入对话输入框（发送按钮不可用，请手动确认）：" + text) : "发送失败（" + r.reason + "）：" + text, "user");
				recordAgentRun("code", r.ok ? "ok" : "warn", r.mode || r.reason);
				setToast(r.mode === "sent" ? "已发送到对话" : "已填入对话输入框");
			} else {
				// 目标＝总监：走智能路由（要求 8），先出确认卡，**不静默分发**
				await pushMsg("需求澄清", text, "user");
				const flat = [];
				const walk = (n) => { flat.push({ id: n.id, name: n.name, level: n.level, meta: n.meta, conversations: n.conversations }); (n.childNodes || []).forEach(walk); };
				if (tree) walk(tree);
				const r = route(text, { nodes: flat, currentNodeId: nodeId });
				setRouteResult(r);
				recordAgentRun("doc", "ok", "路由候选 " + r.candidates.length);
				setRuns(listAgentRuns());
				setToast("总监已整理，待你确认去向");
			}
			setDraft("");
		} finally { setBusy(false); }
	};

	const onConfirmRoute = async (dest) => {
		if (!routeResult) return;
		setBusy(true);
		try {
			const r = await confirmRoute(nodeId, routeResult, dest);
			const cand = (routeResult.candidates || [])[0];
			const summary = DESTINATION_LABEL[dest] + (cand ? " → " + cand.name : "");
			if (dest === DESTINATION.DIRECT || dest === DESTINATION.TRANSFER) {
				const sent = await sendToChat(routeResult.subtasks.map((s) => s.text).join("\n"), { autoSend: dest === DESTINATION.DIRECT });
				await pushMsg("方案 · 派活", "路由已落实：" + summary + "（" + (sent.mode === "sent" ? "已发送" : "已填入输入框") + "）");
			} else {
				await pushMsg("方案 · 派活", "路由已落实：" + summary + "（由总监新建对话并初始化其总监节点）");
			}
			setRouteResult(null);
			await refresh();
			setToast("已落实：" + summary + (r.ok ? "" : "（留痕失败）"));
		} finally { setBusy(false); }
	};

	const onCallAgent = async (a) => {
		recordAgentRun(a.key, "ok", "客户手选调用");
		setRuns(listAgentRuns());
		await pushMsg("方案 · 派活", "手选调用「" + a.label + "」（" + a.desc + "）");
		setToast("已调用：" + a.label);
	};

	/* ── 渲染 ── */
	if (!open) return null;

	/* 整窗最小化：只留 chip（并让原生布局完全复原） */
	if (collapsed) {
		return h("div", { style: S.layer }, h("div", {
			id: CHIP_ID, "data-testid": "d-chip", role: "button", tabIndex: 0,
			onClick: () => directorLayoutStore.setDialogCollapsed(false),
			onKeyDown: (e) => { if (e.key === "Enter") directorLayoutStore.setDialogCollapsed(false); },
			style: {
				position: "absolute", right: 18, bottom: 18, pointerEvents: "auto", cursor: "pointer",
				display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 20,
				background: "var(--dsw-alias-bg-sunken, #23262c)", border: "1px solid rgba(137,87,229,.45)",
				color: "#b794f6", fontFamily: "ui-monospace,Consolas,monospace", fontSize: 11.5
			}
		}, [
			h("span", { key: "i" }, "◆"),
			h("span", { key: "t" }, "总监 · " + ((node && node.name) || "全局总管")),
			unread > 0 ? h("span", { key: "c", style: { background: "#f85149", color: "#fff", borderRadius: 9, padding: "1px 6px", fontSize: 10 } }, String(unread)) : null
		]));
	}

	const g = geo || { x: 280, y: 0, w: W, h: H };

	return h("div", { id: DIALOG_ID, style: S.layer, "data-testid": "d-dialog" }, [
		/* spotlight 遮罩：覆盖原生应用根的"洞"，在洞之外整体压暗；pointer-events:none 不拦截 */
		h("div", {
			key: "hole", "data-testid": "d-hole",
			style: { ...S.hole, left: g.x, top: g.y, width: g.w, height: g.h, boxShadow: "0 0 0 9999px rgba(0,0,0,.34)" }
		}),

		/* 左：总监面板 */
		leftCollapsed
			? h("div", {
				key: "lrail", "data-testid": "d-left-rail", role: "button", tabIndex: 0, title: "展开总监面板",
				style: { ...S.rail("left"), left: g.x, top: g.y, width: RAIL, height: g.h },
				onClick: () => directorLayoutStore.toggleDirectorCollapsed()
			}, [
				h("span", { key: "i" }, "◆"), h("span", { key: "t" }, "总"), h("span", { key: "a" }, "▸"),
				/* 🔴 折叠左栏后**必须仍可达**的控制簇（真机逐交互暴露的缺陷）：
				 *    旧实现把「整块面板」替换成 rail ⇒ 标题栏一并消失 ⇒
				 *    折叠态下**右栏折叠 / 复位 / 最小化 / 关闭全部无入口**，
				 *    只剩 Alt 快捷键（要求 6 要「弹窗形式 + 允许最小化」——任一时刻都要能最小化）。
				 *    ⇒ rail 内置竖排图标簇（⇥ ▢ – ✕）。
				 *    ⚠ 点击须 `stopPropagation`：否则冒泡到 rail 的 onClick 会立刻把左栏重新展开。 */
				h("div", {
					key: "ctl", style: { display: "flex", flexDirection: "column", gap: 5, marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(49,52,58,.9)" },
					onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); }
				}, [
					h("button", { key: "r", style: S.btn, title: "折叠右栏（Alt+2）", "aria-label": "折叠右栏", "data-testid": "d-collapse-right", onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); directorLayoutStore.toggleChatCollapsed(); } }, "⇥"),
					h("button", { key: "z", style: S.btn, title: "复位栏宽", "aria-label": "复位栏宽", "data-testid": "d-reset", onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); directorLayoutStore.resetPanelWidths(); } }, "▢"),
					h("button", { key: "m", style: S.btn, title: "整窗最小化（Alt+3）", "aria-label": "整窗最小化", "data-testid": "d-min", onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); directorLayoutStore.setDialogCollapsed(true); } }, "–"),
					h("button", { key: "c", style: { ...S.btn, borderColor: "rgba(248,81,73,.4)", color: "#f0877f" }, title: "关闭（Esc）", "aria-label": "关闭总监", "data-testid": "d-close", onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); directorLayoutStore.setDialogOpen(false); } }, "✕")
				])
			])
			: h("div", {
				key: "panel", ref: panelRef, style: { ...S.panel, left: g.x, top: g.y, width: dragW != null ? dragW : panelWidth, height: g.h },
				// 🔴 面板绑定节点用 `data-active-node-id`，**不可**写成 `data-node-id`：
				//    后者是全插件「树行」的唯一选择器（`components/DirectorHierarchy.js` TreeItem），
				//    面板若占用同名属性，`[data-node-id]` 的首个命中会变成面板本身，
				//    使既有逐交互脚本「点第一行 → 选中态迁移」失效（2026-09-12 真机实测踩中）。
				role: "dialog", "aria-label": "总监面板", "data-testid": "d-panel", "data-active-node-id": nodeId
			}, [
				/* mhead：R1 顶部栏 + 层级切换器（I5）*/
				h("div", { key: "h", style: S.head }, [
					h("span", { key: "t", style: S.headTitle }, "◆ 总监"),
					h("select", {
						key: "sel", "data-testid": "d-level", "aria-label": "切换层级",
						value: nodeId,
						onChange: (e) => directorLayoutStore.setActiveNode(e.target.value),
						style: { maxWidth: 132, height: 22, fontSize: 11, borderRadius: 5, border: "1px solid #3d4148", background: "#212429", color: "#c3c8ce" }
					}, buildOptions(tree)),
					h("span", { key: "c", style: S.lvchip, "data-testid": "d-level-chip" }, (node ? (LEVEL_LABEL[node.level] || node.level) : "—")),
					h("div", { key: "b", style: S.btns }, [
						h("button", { key: "1", style: S.btn, title: "折叠左栏（Alt+1）", "aria-label": "折叠左栏", "data-testid": "d-collapse-left", onClick: () => directorLayoutStore.toggleDirectorCollapsed() }, "⇤"),
						h("button", { key: "2", style: S.btn, title: "折叠右栏（Alt+2）", "aria-label": "折叠右栏", "data-testid": "d-collapse-right", onClick: () => directorLayoutStore.toggleChatCollapsed() }, "⇥"),
						h("button", { key: "3", style: S.btn, title: "整窗最小化（Alt+3）", "aria-label": "整窗最小化", "data-testid": "d-min", onClick: () => directorLayoutStore.setDialogCollapsed(true) }, "–"),
						h("button", { key: "4", style: S.btn, title: "复位栏宽（双击中缝同效）", "aria-label": "复位栏宽", "data-testid": "d-reset", onClick: () => directorLayoutStore.resetPanelWidths() }, "▢"),
						h("button", { key: "5", style: { ...S.btn, borderColor: "rgba(248,81,73,.4)", color: "#f0877f" }, title: "关闭（Esc）", "aria-label": "关闭总监", "data-testid": "d-close", onClick: () => directorLayoutStore.setDialogOpen(false) }, "✕")
					])
				]),

				/* 面包屑（当前层级路径） */
				h("div", { key: "crumb", style: { ...S.muted, padding: "4px 9px 0", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, "data-testid": "d-crumb" },
					crumbs.length ? crumbs.map((c) => c.name).join(" / ") : "全局总管"),

				/* 面板主体 */
				h(DirectorPanel, {
					key: "body", node, tree, messages, reviewResult, onReview: doReview,
					agentRuns: runs, onCallAgent, engineStats: stats,
					seg, setSeg: (s) => directorLayoutStore.setLeftTab(s)
				}),

				/* 路由确认卡（要求 8 STEP4）*/
				routeResult ? h("div", { key: "route", style: { padding: "0 8px 8px" } },
					h(RouteCard, { result: routeResult, onConfirm: onConfirmRoute, onCancel: () => setRouteResult(null), busy })) : null,

				/* mfoot：R8 全局输入框 + 焦点路由（I3/I7/I10）*/
				h("div", { key: "f", style: { borderTop: "1px solid var(--dsw-alias-border-l2, #31343a)", background: "var(--dsw-alias-bg-sunken, #1b1e23)", padding: "7px 8px", display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" } }, [
					h("span", {
						key: "fc", "data-testid": "d-focus", "data-target": st.focusTarget,
						style: {
							fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10, padding: "4px 7px", borderRadius: 5, whiteSpace: "nowrap",
							border: "1px solid " + (st.focusTarget === "director" ? "rgba(137,87,229,.45)" : "rgba(47,111,235,.5)"),
							background: st.focusTarget === "director" ? "rgba(137,87,229,.16)" : "rgba(47,111,235,.16)",
							color: st.focusTarget === "director" ? "#b794f6" : "#79a8ff", cursor: "pointer"
						},
						title: "点击切换提交目标",
						onClick: () => directorLayoutStore.setFocusTarget(st.focusTarget === "director" ? "chat" : "director")
					}, "目标：" + (st.focusTarget === "director" ? "总监" : "对话")),
					h("input", {
						key: "i", style: S.input, "data-testid": "d-input", "data-input-scope": "director",
						placeholder: st.focusTarget === "director" ? "输入后由总监整理确认，再路由到对应对话…" : "输入后直接发送到对话…",
						value: draft, onChange: (e) => setDraft(e.target.value),
						onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } },
						disabled: busy
					}),
					h("button", { key: "s", style: S.btnPrimary, "data-testid": "d-send", onClick: onSend, disabled: busy }, "↑")
				]),

				/* 提示条 */
				toast ? h("div", { key: "toast", style: { ...S.muted, padding: "0 9px 7px", color: "#79a8ff" }, "data-testid": "d-toast", onClick: () => setToast("") }, toast) : null
			]),

		/* 中缝拖拽手柄（双击复位）*/
		!leftCollapsed && !rightCollapsed ? h("div", {
			key: "split", "data-testid": "d-split", "aria-label": "拖拽调宽",
			style: { position: "absolute", left: g.x + (dragW != null ? dragW : panelWidth) - 4, top: g.y, width: 8, height: g.h, pointerEvents: "auto", cursor: "col-resize", zIndex: 2 },
			onPointerDown: startDrag, onDoubleClick: () => directorLayoutStore.resetPanelWidths()
		}) : null,

		/* 右栏折叠竖条（点击展开）*/
		rightCollapsed ? h("div", {
			key: "rrail", "data-testid": "d-right-rail", role: "button", tabIndex: 0, title: "展开对话数据",
			style: { ...S.rail("right"), left: g.x + g.w - RAIL, top: g.y, width: RAIL, height: g.h },
			onClick: () => directorLayoutStore.toggleChatCollapsed()
		}, [h("span", { key: "i" }, "▣"), h("span", { key: "t" }, "对"), h("span", { key: "a" }, "◂")]) : null,

		/* 右栏装饰（透明，不拦截；原生对话区透过它显示）*/
		!rightCollapsed ? h("div", {
			key: "rchrome", "data-testid": "d-right", "data-same-source": "1",
			style: {
				position: "absolute", left: g.x + (dragW != null ? dragW : panelWidth), top: g.y, width: Math.max(0, g.w - (dragW != null ? dragW : panelWidth)),
				height: g.h, pointerEvents: "none", borderLeft: "1px solid rgba(47,111,235,.35)", borderRadius: "0 8px 8px 0"
			}
		}, h("div", {
			style: {
				position: "absolute", right: 8, bottom: 8, fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10,
				color: "#6fd388", background: "rgba(22,23,26,.82)", border: "1px solid rgba(63,185,80,.35)", borderRadius: 4, padding: "2px 6px"
			}
		}, "● 与「对话 tab」同源（同一渲染节点）")) : null
	]);
}

/** 层级下拉项（扁平遍历树）*/
function buildOptions(tree) {
	const out = [];
	const walk = (n, d) => {
		out.push(h("option", { key: n.id, value: n.id }, "　".repeat(d) + (LEVEL_LABEL[n.level] || n.level) + " · " + n.name));
		(n.childNodes || []).forEach((c) => walk(c, d + 1));
	};
	if (tree) walk(tree, 0);
	return out;
}

/** 供调试/验证：最近一次拖拽是否触发了"过窄自动折叠"吸附 */
let lastDragSnap = false;
export function getLastDragSnap() { return lastDragSnap; }

export default DirectorDialog;
