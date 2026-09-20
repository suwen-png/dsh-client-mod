/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：左侧常驻看板（WS-B · B3）
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js
 * 下游：logic/task-state.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/Board.js — 左侧常驻看板（WS-B · B3）
 *
 * ── 它治的是什么 ────────────────────────────────────────────────────
 *   用户要一个「一眼看到全部活干到哪一步」的常驻看板：
 *     置顶 ⭐ / 进行中 ▶ / 待完成 ☐ / 已完成 ✓（折叠四段），
 *     阻塞 ⚠ 红角标、部分 ◐、中止 ⊘。
 *
 * ── 🔴 两条铁律（贯穿 B2/B3/B4，纪律 126）──────────────────────────
 *   · **看板只读 store、不自拼**：本组件**不**自己 group/sort。
 *     所有分组/排序都交给 `logic/task-state.js#boardView()`（唯一拼装点），
 *     本组件只**渲染**它的返回值 —— 这样看板与导图（B4）必然同源。
 *   · **主键挂会话 id**：每行的 `onSelect` 回调回传 `sessionId`
 *     （不是 `ws_…` 作用域 id；见 lineage.js#validateFlowSids）。
 *
 * @param {object} props
 * @param {Array}  props.tasks  任务数组（boardView 的入参；调用方喂 dispatchLog.items / 导图行）
 * @param {(sessionId:string)=>void} [props.onSelect] 点条目回调（定位导图节点）
 * @param {boolean} [props.compact] 紧凑模式（窄列时用）
 * @returns {object} React 元素
 */
import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import { boardView } from "../logic/task-state.js";

/** 各档的视觉（icon + 颜色；唯一一份，B4 导图同源复用同一套语义） */
const BUCKET_VISUAL = {
	done:    { icon: "✓", color: "#2e7d32", label: "已完成" },
	running: { icon: "▶", color: "#1565c0", label: "进行中" },
	draft:   { icon: "☐", color: "#8a8a8a", label: "待完成" },
	partial: { icon: "◐", color: "#ef6c00", label: "部分" },
	blocked: { icon: "⚠", color: "#c62828", label: "阻塞" },
	aborted: { icon: "⊘", color: "#6b6b6b", label: "中止" }
};

/** 一个折叠段（头 + 可折叠体；默认展开，点头折叠） */
function BoardSection({ title, icon, color, rows, onSelect, compact }) {
	const [open, setOpen] = (0, react.useState)(true);
	const h = compact ? 24 : 28;
	return (0, react_jsx_runtime.jsxs)("div", {
		"data-board-section": title,
		style: { borderBottom: "1px solid rgba(128,128,128,0.15)" },
		children: [
			(0, react_jsx_runtime.jsx)("div", {
				onClick: () => setOpen(!open),
				style: {
					display: "flex", alignItems: "center", gap: 6, height: h,
					padding: "0 8px", cursor: "pointer", userSelect: "none",
					fontSize: compact ? 11 : 12, fontWeight: 600, color: "#333"
				},
				children: (open ? "▾ " : "▸ ") + icon + " " + title + " (" + rows.length + ")"
			}),
			open ? (0, react_jsx_runtime.jsx)("div", {
				style: { padding: compact ? "2px 4px 6px" : "2px 8px 8px" },
				children: rows.length === 0
					? (0, react_jsx_runtime.jsx)("div", { style: { fontSize: compact ? 10 : 11, color: "#aaa", padding: "2px 4px" }, children: "（空）" })
					: rows.map((r) => {
						const v = BUCKET_VISUAL[r.bucket] || BUCKET_VISUAL.draft;
						/* 🔴 WS-C · C1：回收摘要（task.summary，经 setField 单一写入点）作次行展示 —— G1「结果」可见落点 */
						const hasSummary = Boolean(r.summary && String(r.summary).trim());
						return (0, react_jsx_runtime.jsx)("div", {
							"data-board-row": "1",
							"data-session-id": r.sessionId || "",
							"data-board-bucket": r.bucket,
							"data-pinned": r.pinned ? "1" : "0",
							"data-board-summary": hasSummary ? "1" : "0",
							onClick: () => { if (r.sessionId && onSelect) onSelect(r.sessionId); },
							style: {
								display: "flex", alignItems: "center", gap: 6,
								padding: compact ? "3px 4px" : "4px 6px", borderRadius: 4,
								fontSize: compact ? 11 : 12, color: "#222", cursor: r.sessionId ? "pointer" : "default"
							},
							children: [
								(0, react_jsx_runtime.jsx)("span", { style: { color: r.pinned ? "#f9a825" : v.color, width: 14, flex: "0 0 auto" }, children: r.pinned ? "⭐" : v.icon }),
								(0, react_jsx_runtime.jsxs)("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }, children: [
									(0, react_jsx_runtime.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: r.title || "(未命名)" }),
									hasSummary ? (0, react_jsx_runtime.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: compact ? 9 : 10, color: "#888" }, children: r.summary }) : null
								] })
							]
						}, r.id || r.sessionId || (r.title + Math.random()));
					})
			}) : null
		]
	});
}

export function Board({ tasks = [], onSelect = null, compact = false }) {
	/* 🔴 唯一拼装点：不自拼，全交给 boardView()（B2 的只读视图） */
	const view = boardView(tasks);
	return (0, react_jsx_runtime.jsxs)("div", {
		"data-board": "1",
		"data-board-total": view.total,
		style: { display: "flex", flexDirection: "column", width: "100%", height: "100%", overflowY: "auto" },
		children: [
			(0, react_jsx_runtime.jsx)(BoardSection, {
				title: "置顶", icon: "⭐", color: "#f9a825", rows: view.pinned,
				onSelect: onSelect, compact: compact
			}),
			(0, react_jsx_runtime.jsx)(BoardSection, {
				title: "进行中", icon: "▶", color: "#1565c0", rows: view.running,
				onSelect: onSelect, compact: compact
			}),
			(0, react_jsx_runtime.jsx)(BoardSection, {
				title: "待完成", icon: "☐", color: "#8a8a8a", rows: view.todo,
				onSelect: onSelect, compact: compact
			}),
			(0, react_jsx_runtime.jsx)(BoardSection, {
				title: "已完成", icon: "✓", color: "#2e7d32", rows: view.done,
				onSelect: onSelect, compact: compact
			})
		]
	});
}

export default Board;
