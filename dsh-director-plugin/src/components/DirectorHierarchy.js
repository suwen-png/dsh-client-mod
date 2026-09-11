/**
 * components/DirectorHierarchy.js — 多层级总监面板（方案 C：层级树 + 主内容区）
 *
 * 需求来源：`docs/04-多层级总监结构设计与方案选型.md` §三（结构说明）
 *   左栏：三级树（全局 → 文件夹 → 会话）
 *   右栏：当前节点 meta + 总结 + 子级摘要 + 操作区
 *
 * 依赖层级数据：store/hierarchy.js（03号文 §1.3 / 17号文 §2.1）
 * 依赖总结逻辑：logic/summarize.js（17号文 §1A.13 / 03号文 §4.3 降级）
 *
 * ⚠️ 构建约束（同 DirectorFlow）：
 *   - `react` / `react/jsx-runtime` 为**平台冻结模块**，构建期外置为 `require(...)`
 *     （ADR-001：严禁把 React 打进产物，否则双实例崩溃）
 *   - 宿主为编译后 `jsx()` 调用形态，本文件用 **`.js` 而非 `.jsx`**，不经 JSX 编译
 */

import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import {
	LEVEL, LEVEL_LABEL, GLOBAL_NODE_ID,
	loadTree, getNode, saveNode, removeNode,
	createChild, attachSession, getBreadcrumb
} from "../store/hierarchy.js";
import { summarizeNode, summarizeTree, propagateUp, GRADE } from "../logic/summarize.js";
import { syncFromSource, auditCoverage } from "../logic/sync.js";
import { onHierarchyChange } from "../util/bus.js";
import { DirectorWorkbench } from "./DirectorWorkbench.js";
import { dshLog } from "../util/debug.js";

/* ── 样式（内联，与宿主编译产物同形态；尽量使用 Harness 主题变量并给 fallback）── */
const S = {
	root: { display: "flex", height: "100%", minHeight: 0, background: "var(--dsw-alias-bg-base, #16171a)", color: "var(--dsw-alias-label-primary, #e6e6e6)", fontSize: 13, fontFamily: "inherit" },
	side: { width: 240, flex: "0 0 240px", borderRight: "1px solid var(--dsw-alias-border-l2, #2a2c30)", overflowY: "auto", minHeight: 0, padding: "8px 0" },
	main: { flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: 16 },
	row: (active) => ({
		display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", cursor: "pointer",
		background: active ? "var(--dsw-alias-interactive-bg-hover, #23252a)" : "transparent",
		borderLeft: active ? "2px solid #4c8dff" : "2px solid transparent",
		whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
	}),
	badge: { marginLeft: "auto", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #8b8f96)", background: "var(--dsw-alias-bg-sunken, #1e2024)", borderRadius: 8, padding: "0 6px" },
	btn: { padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #33363b)", background: "var(--dsw-alias-bg-base, #202227)", color: "var(--dsw-alias-label-primary, #e6e6e6)", cursor: "pointer" },
	btnPrimary: { padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #2f6bdd", background: "#2f6bdd", color: "#fff", cursor: "pointer" },
	input: { width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #33363b)", background: "var(--dsw-alias-bg-sunken, #1b1d21)", color: "var(--dsw-alias-label-primary, #e6e6e6)", boxSizing: "border-box" },
	card: { border: "1px solid var(--dsw-alias-border-l2, #2a2c30)", borderRadius: 8, padding: 12, marginBottom: 12, background: "var(--dsw-alias-bg-sunken, #1a1c20)" },
	label: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #a0a4aa)", marginBottom: 4 },
	pre: { whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 12, lineHeight: "18px", fontFamily: "var(--ds-font-family-code, ui-monospace, Menlo, Consolas, monospace)" },
	h: { fontSize: 14, fontWeight: 600, margin: "0 0 10px" },
	muted: { color: "var(--dsw-alias-label-tertiary, #8b8f96)", fontSize: 12 }
};

const ICON = { global: "🌐", project: "📁", session: "💬" };

/* ── 递归树节点 ── */
function TreeItem({ node, depth, selectedId, onSelect }) {
	const kids = node.childNodes || [];
	return (0, react_jsx_runtime.jsxs)("div", { children: [
		(0, react_jsx_runtime.jsxs)("div", {
			style: S.row(selectedId === node.id),
			onClick: () => onSelect(node.id),
			title: node.name,
			// 🔴 稳定定位标识：真机交互验证与用户脚本依赖它精确点击**本行**。
			//    仅靠「textContent 前缀」匹配会命中祖先包裹 div（点击不冒泡向下 → 选中失败）。
			"data-node-id": node.id,
			"data-node-level": node.level,
			"data-selected": selectedId === node.id ? "true" : "false",
			children: [
				(0, react_jsx_runtime.jsx)("span", { style: { paddingLeft: depth * 12 }, children: (ICON[node.level] || "•") + " " + node.name }),
				kids.length ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: String(kids.length) }) : null
			]
		}),
		kids.map((c) => (0, react_jsx_runtime.jsx)(TreeItem, { node: c, depth: depth + 1, selectedId: selectedId, onSelect: onSelect }, c.id))
	] });
}

/** 在树中按 id 查找节点 */
function findNode(root, id) {
	if (!root) return null;
	if (root.id === id) return root;
	for (const c of root.childNodes || []) {
		const hit = findNode(c, id);
		if (hit) return hit;
	}
	return null;
}

/**
 * 多层级总监面板根组件
 * @param {object} props
 * @param {() => void} [props.onClose] 关闭回调
 * @param {boolean} [props.compact] 紧凑形态（弹窗左栏内嵌用）——
 *   侧栏 240px 固定列改为**顶部可折叠块**（240px 在 300px 左栏里放不下主内容），
 *   其余逻辑、页签、`h-*` 定位标识**完全不变**（既有真机逐交互脚本可原样复用）。
 */
export function DirectorHierarchy(props = {}) {
	const compact = props.compact === true;
	const [tree, setTree] = react.useState(null);
	const [selectedId, setSelectedId] = react.useState(GLOBAL_NODE_ID);
	const [crumb, setCrumb] = react.useState([]);
	const [busy, setBusy] = react.useState(false);
	const [msg, setMsg] = react.useState("");
	// 新建表单
	const [newName, setNewName] = react.useState("");
	const [newLevel, setNewLevel] = react.useState(LEVEL.PROJECT);
	const [sessTitle, setSessTitle] = react.useState("");
	const [sessId, setSessId] = react.useState("");
	// meta 编辑
	const [meta, setMeta] = react.useState({ positioning: "", goal: "", currentPhase: "" });
	const [nodeName, setNodeName] = react.useState("");
	// 覆盖度：是否每一个对话 / 文件夹都已配总监
	const [coverage, setCoverage] = react.useState(null);
	// 右栏页签：overview=层级概览（原内容） / director=总监工作台（文档 06 方案 E）
	const [tab, setTab] = react.useState("overview");

	const refresh = react.useCallback(async () => {
		const t = await loadTree();
		setTree(t);
		// 覆盖度自检与树同步刷新（直接回答「每一个对话/文件夹是否都有总监」）
		try { setCoverage(await auditCoverage()); } catch (e) { /* 静默 */ }
		return t;
	}, []);

	react.useEffect(() => { refresh(); }, [refresh]);

	// 🔴 订阅层级变更：面板首帧早于自动同步完成（实测显示「会话 0/8」），
	//    必须在同步/总结/CRUD 完成后收到通知并重新拉取，否则停留在陈旧快照。
	react.useEffect(() => onHierarchyChange(() => { refresh(); }), [refresh]);

	const selected = react.useMemo(() => findNode(tree, selectedId), [tree, selectedId]);

	react.useEffect(() => {
		getBreadcrumb(selectedId).then(setCrumb);
		const n = findNode(tree, selectedId);
		setMeta({
			positioning: n?.meta?.positioning || "",
			goal: n?.meta?.goal || "",
			currentPhase: n?.meta?.currentPhase || ""
		});
		setNodeName(n?.name || "");
	}, [selectedId, tree]);

	const guard = (fn) => async (...a) => {
		if (busy) return;
		setBusy(true);
		try { await fn(...a); } finally { setBusy(false); }
	};

	const doCreate = guard(async () => {
		const name = newName.trim();
		if (!name) { setMsg("请输入名称"); return; }
		// 全局级下只能建项目级；项目级下建会话或子项目
		const parentId = selectedId || GLOBAL_NODE_ID;
		const node = await createChild(parentId, { name, level: newLevel });
		setNewName("");
		await refresh();
		setSelectedId(node.id);
		setMsg("已创建：" + name);
	});

	const doAttach = guard(async () => {
		const sid = sessId.trim();
		if (!sid) { setMsg("请输入会话 ID"); return; }
		const node = await attachSession(selectedId, { sessionId: sid, title: sessTitle.trim() || sid });
		setSessId(""); setSessTitle("");
		await refresh();
		setSelectedId(node.id);
		setMsg("已挂载会话：" + sid);
	});

	const doSummarizeOne = guard(async () => {
		const node = await getNode(selectedId);
		if (!node) return;
		const res = await summarizeNode(node, selected?.childNodes || []);
		const { childNodes, ...flat } = { ...node, summary: res.text, summaryGrade: res.grade, summaryAt: res.at };
		await saveNode(flat);
		await refresh();
		setMsg("已生成总结（梯度 " + res.grade + "）" + (res.degraded ? " · " + (res.reason || "已降级") : ""));
	});

	const doSummarizeTree = guard(async () => {
		const stats = await summarizeTree(await refresh(), {});
		setMsg("整树总结完成：" + stats.count + " 个节点，G0=" + stats.grades.G0 + " / G1=" + stats.grades.G1 + " / G2=" + stats.grades.G2 + "，降级 " + stats.degraded + " 个");
	});

	const doPropagate = guard(async () => {
		const r = await propagateUp(selectedId);
		if (!r) { setMsg("该节点无父级，无需向上提交"); return; }
		await refresh();
		setMsg("已向上提交到「" + r.node.name + "」（梯度 " + r.result.grade + "）");
	});

	/**
	 * 同步真实会话 / 文件夹 → 为每一个会话和文件夹建立总监（幂等）
	 * 数据源：宿主 localStorage `dsh.workspace.view.*`（workspace=文件夹级，session=对话级）
	 */
	const doSync = guard(async () => {
		const s = await syncFromSource();
		await refresh();
		setMsg("同步完成（数据源：" + s.source + "）：新建 " + s.created + " / 更新 " + s.updated
			+ " / 孤儿 " + s.orphaned + "；文件夹 " + s.folders + " · 会话 " + s.sessions);
	});

	const doSaveMeta = guard(async () => {
		const node = await getNode(selectedId);
		if (!node) return;
		node.meta = { ...(node.meta || {}), ...meta };
		// 用户主动改名 → 清 autoName，此后自动同步不再覆盖该名称
		if (nodeName.trim() && nodeName !== node.name) {
			node.name = nodeName.trim();
			node.meta.autoName = false;
		}
		await saveNode(node);
		await refresh();
		setMsg("已保存基础信息");
	});

	const doRemove = guard(async () => {
		if (selectedId === GLOBAL_NODE_ID) { setMsg("全局根节点不可删除"); return; }
		await removeNode(selectedId);
		await refresh();
		setSelectedId(GLOBAL_NODE_ID);
		setMsg("已删除节点");
	});

	return (0, react_jsx_runtime.jsxs)("div", { style: compact ? { ...S.root, flexDirection: "column" } : S.root, children: [
		/* ── 左：层级树（compact 时改为顶部可折叠块）── */
		(0, react_jsx_runtime.jsxs)("div", {
			style: compact
				? { flex: "0 0 auto", maxHeight: 168, overflowY: "auto", borderBottom: "1px solid var(--dsw-alias-border-l2, #2a2c30)", padding: "6px 0" }
				: S.side,
			children: [
				(0, react_jsx_runtime.jsxs)("div", { style: { padding: "4px 12px 8px", ...S.muted, display: "flex", alignItems: "center", gap: 6 }, children: [
					"总监层级",
					compact ? (0, react_jsx_runtime.jsx)("span", { style: { ...S.badge, marginLeft: "auto" }, "data-testid": "h-compact-hint", children: "紧凑" }) : null
				] }),
				tree
					? (0, react_jsx_runtime.jsx)(TreeItem, { node: tree, depth: 0, selectedId: selectedId, onSelect: setSelectedId })
					: (0, react_jsx_runtime.jsx)("div", { style: { padding: 12, ...S.muted }, children: "加载中…" })
			]
		}),

		/* ── 右：内容区 ── */
		(0, react_jsx_runtime.jsxs)("div", { style: compact ? { ...S.main, padding: 8 } : S.main, children: [
			(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }, children: [
				(0, react_jsx_runtime.jsx)("h3", { style: S.h, children: crumb.map((c) => c.name).join(" / ") || "全局总管" }),
				selected ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: LEVEL_LABEL[selected.level] || selected.level }) : null,
				selected?.summaryGrade ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: "梯度 " + selected.summaryGrade }) : null,
				props.onClose ? (0, react_jsx_runtime.jsx)("button", { style: { ...S.btn, marginLeft: "auto" }, "data-testid": "h-close", onClick: props.onClose, children: "收起" }) : null
			] }),

			/* 页签：[概览] [总监] */
			(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6, marginBottom: 10 }, children: [
				(0, react_jsx_runtime.jsx)("button", {
					style: { ...(tab === "overview" ? S.btnPrimary : S.btn) }, "data-tab": "overview",
					"data-testid": "h-tab-overview", onClick: () => setTab("overview"), children: "概览"
				}),
				(0, react_jsx_runtime.jsx)("button", {
					style: { ...(tab === "director" ? S.btnPrimary : S.btn) }, "data-tab": "director",
					"data-testid": "h-tab-director", onClick: () => setTab("director"), children: "总监"
				})
			] }),

			/* 总监工作台（03号文 §3.1 职责 / §3.2 继承 / §2.3 消息流） */
			tab === "director"
				? (0, react_jsx_runtime.jsx)("div", { "data-panel": "director", children: (0, react_jsx_runtime.jsx)(DirectorWorkbench, { node: selected }) })
				: null,

			/* 概览内容（总监页签时隐藏，保留内部状态不卸载） */
			(0, react_jsx_runtime.jsxs)("div", { style: { display: tab === "overview" ? "" : "none" }, children: [

			/* 覆盖度自检：是否每一个对话 / 文件夹都有总监 */
			(0, react_jsx_runtime.jsxs)("div", {
				style: {
					...S.card,
					borderColor: coverage && coverage.ok ? "#2f6bdd" : "#6b5320",
					background: coverage && coverage.ok ? "rgba(47,107,221,.10)" : "rgba(160,120,30,.10)"
				},
				children: [
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }, children: [
						(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 13, fontWeight: 600 }, children: coverage && coverage.ok ? "✅ 总监已全覆盖" : "⚠️ 存在未覆盖" }),
						(0, react_jsx_runtime.jsxs)("span", { style: { ...S.muted, marginLeft: "auto" }, children: [
							"会话 ", coverage ? coverage.sessions.covered + "/" + coverage.sessions.total : "-",
							" · 文件夹 ", coverage ? coverage.folders.covered + "/" + coverage.folders.total : "-",
							" · 全局 ", coverage ? coverage.global.covered + "/1" : "-"
						] }),
						(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, "data-testid": "h-sync", onClick: doSync, disabled: busy, children: "同步真实会话" })
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: S.muted, children: "数据源：" + (coverage ? coverage.source : "检测中…")
						+ "（workspace=文件夹级，session=对话级）。节点 id 由数据源主键派生，重复同步幂等、不会重复新建。" })
				]
			}),

			/* 基础信息（meta） */
			(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
				(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "定位 / 目标 / 当前阶段（17号文 §1A.13 核心认知）" }),
				(0, react_jsx_runtime.jsx)("input", {
					style: { ...S.input, marginBottom: 6 },
					"data-testid": "h-meta-name",
					placeholder: "节点名称（修改后自动同步不再覆盖）",
					value: nodeName,
					onChange: (e) => setNodeName(e.target.value)
				}),
				["positioning", "goal", "currentPhase"].map((k) => (0, react_jsx_runtime.jsx)("input", {
					key: k,
					style: { ...S.input, marginBottom: 6 },
					"data-testid": "h-meta-" + k,
					placeholder: { positioning: "定位", goal: "目标", currentPhase: "当前阶段" }[k],
					value: meta[k],
					onChange: (e) => setMeta((m) => ({ ...m, [k]: e.target.value }))
				}, k)),
				(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-save-meta", onClick: doSaveMeta, disabled: busy, children: "保存基础信息" })
			] }),

			/* 总结区 */
			(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
				(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", marginBottom: 8 }, children: [
					(0, react_jsx_runtime.jsx)("span", { style: S.label, children: "分层总结" }),
					(0, react_jsx_runtime.jsxs)("span", { style: { marginLeft: "auto", display: "flex", gap: 6 }, children: [
						(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, "data-testid": "h-sum-one", onClick: doSummarizeOne, disabled: busy, children: "生成本级总结" }),
						(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-prop-up", onClick: doPropagate, disabled: busy, children: "向上提交" }),
						(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-sum-tree", onClick: doSummarizeTree, disabled: busy, children: "整树分层总结" })
					] })
				] }),
				selected?.summary
					? (0, react_jsx_runtime.jsx)("pre", { style: S.pre, children: selected.summary })
					: (0, react_jsx_runtime.jsx)("div", { style: S.muted, children: "暂无总结。点击「生成本级总结」或「整树分层总结」。" })
			] }),

			/* 子级摘要 */
			selected?.childNodes?.length ? (0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
				(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "子级摘要（共 " + selected.childNodes.length + " 项）" }),
				selected.childNodes.map((c) => (0, react_jsx_runtime.jsxs)("div", { key: c.id, style: { marginBottom: 8 }, children: [
					(0, react_jsx_runtime.jsxs)("div", { style: { fontSize: 12, fontWeight: 500 }, children: [
						ICON[c.level] + " " + c.name,
						c.summaryGrade ? "（" + c.summaryGrade + "）" : ""
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, whiteSpace: "pre-wrap" }, children: c.summary ? String(c.summary).slice(0, 200) : "（未总结）" })
				] }))
			] }) : null,

			/* 新建节点 */
			(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
				(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "在当前节点下新建" }),
				(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6, marginBottom: 6 }, children: [
					(0, react_jsx_runtime.jsx)("input", { style: S.input, "data-testid": "h-new-name", placeholder: "名称", value: newName, onChange: (e) => setNewName(e.target.value) }),
					(0, react_jsx_runtime.jsxs)("select", { style: S.btn, "data-testid": "h-new-level", value: newLevel, onChange: (e) => setNewLevel(e.target.value), children: [
						(0, react_jsx_runtime.jsx)("option", { value: LEVEL.PROJECT, children: "项目（文件夹级）" }),
						(0, react_jsx_runtime.jsx)("option", { value: LEVEL.SESSION, children: "会话（对话级）" })
					] }),
					(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-create", onClick: doCreate, disabled: busy, children: "新建" })
				] }),
				(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
					(0, react_jsx_runtime.jsx)("input", { style: S.input, "data-testid": "h-attach-sid", placeholder: "会话 ID", value: sessId, onChange: (e) => setSessId(e.target.value) }),
					(0, react_jsx_runtime.jsx)("input", { style: S.input, "data-testid": "h-attach-title", placeholder: "会话标题（可选）", value: sessTitle, onChange: (e) => setSessTitle(e.target.value) }),
					(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-attach", onClick: doAttach, disabled: busy, children: "挂载会话" })
				] })
			] }),

			/* 提示 + 删除 */
			msg ? (0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, marginBottom: 8 }, children: msg }) : null,
			selectedId !== GLOBAL_NODE_ID
				? (0, react_jsx_runtime.jsx)("button", { style: { ...S.btn, borderColor: "#7a2b2b", color: "#ff8a8a" }, "data-testid": "h-remove", onClick: doRemove, disabled: busy, children: "删除当前节点" })
				: null
			] })
		] })
	] });
}

export default DirectorHierarchy;
