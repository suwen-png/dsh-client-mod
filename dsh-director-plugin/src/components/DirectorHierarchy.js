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
 * @param {() => void} [props.onClose] 关闭回调（浮层形态用）
 */
export function DirectorHierarchy(props = {}) {
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

	const refresh = react.useCallback(async () => {
		const t = await loadTree();
		setTree(t);
		return t;
	}, []);

	react.useEffect(() => { refresh(); }, [refresh]);

	const selected = react.useMemo(() => findNode(tree, selectedId), [tree, selectedId]);

	react.useEffect(() => {
		getBreadcrumb(selectedId).then(setCrumb);
		const n = findNode(tree, selectedId);
		setMeta({
			positioning: n?.meta?.positioning || "",
			goal: n?.meta?.goal || "",
			currentPhase: n?.meta?.currentPhase || ""
		});
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

	const doSaveMeta = guard(async () => {
		const node = await getNode(selectedId);
		if (!node) return;
		node.meta = { ...(node.meta || {}), ...meta };
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

	return (0, react_jsx_runtime.jsxs)("div", { style: S.root, children: [
		/* ── 左：层级树 ── */
		(0, react_jsx_runtime.jsxs)("div", { style: S.side, children: [
			(0, react_jsx_runtime.jsx)("div", { style: { padding: "4px 12px 8px", ...S.muted }, children: "总监层级" }),
			tree
				? (0, react_jsx_runtime.jsx)(TreeItem, { node: tree, depth: 0, selectedId: selectedId, onSelect: setSelectedId })
				: (0, react_jsx_runtime.jsx)("div", { style: { padding: 12, ...S.muted }, children: "加载中…" })
		] }),

		/* ── 右：内容区 ── */
		(0, react_jsx_runtime.jsxs)("div", { style: S.main, children: [
			(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }, children: [
				(0, react_jsx_runtime.jsx)("h3", { style: S.h, children: crumb.map((c) => c.name).join(" / ") || "全局总管" }),
				selected ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: LEVEL_LABEL[selected.level] || selected.level }) : null,
				selected?.summaryGrade ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: "梯度 " + selected.summaryGrade }) : null,
				props.onClose ? (0, react_jsx_runtime.jsx)("button", { style: { ...S.btn, marginLeft: "auto" }, onClick: props.onClose, children: "收起" }) : null
			] }),

			/* 基础信息（meta） */
			(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
				(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "定位 / 目标 / 当前阶段（17号文 §1A.13 核心认知）" }),
				["positioning", "goal", "currentPhase"].map((k) => (0, react_jsx_runtime.jsx)("input", {
					key: k,
					style: { ...S.input, marginBottom: 6 },
					placeholder: { positioning: "定位", goal: "目标", currentPhase: "当前阶段" }[k],
					value: meta[k],
					onChange: (e) => setMeta((m) => ({ ...m, [k]: e.target.value }))
				}, k)),
				(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doSaveMeta, disabled: busy, children: "保存基础信息" })
			] }),

			/* 总结区 */
			(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
				(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", marginBottom: 8 }, children: [
					(0, react_jsx_runtime.jsx)("span", { style: S.label, children: "分层总结" }),
					(0, react_jsx_runtime.jsxs)("span", { style: { marginLeft: "auto", display: "flex", gap: 6 }, children: [
						(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, onClick: doSummarizeOne, disabled: busy, children: "生成本级总结" }),
						(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doPropagate, disabled: busy, children: "向上提交" }),
						(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doSummarizeTree, disabled: busy, children: "整树分层总结" })
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
					(0, react_jsx_runtime.jsx)("input", { style: S.input, placeholder: "名称", value: newName, onChange: (e) => setNewName(e.target.value) }),
					(0, react_jsx_runtime.jsxs)("select", { style: S.btn, value: newLevel, onChange: (e) => setNewLevel(e.target.value), children: [
						(0, react_jsx_runtime.jsx)("option", { value: LEVEL.PROJECT, children: "项目（文件夹级）" }),
						(0, react_jsx_runtime.jsx)("option", { value: LEVEL.SESSION, children: "会话（对话级）" })
					] }),
					(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doCreate, disabled: busy, children: "新建" })
				] }),
				(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
					(0, react_jsx_runtime.jsx)("input", { style: S.input, placeholder: "会话 ID", value: sessId, onChange: (e) => setSessId(e.target.value) }),
					(0, react_jsx_runtime.jsx)("input", { style: S.input, placeholder: "会话标题（可选）", value: sessTitle, onChange: (e) => setSessTitle(e.target.value) }),
					(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doAttach, disabled: busy, children: "挂载会话" })
				] })
			] }),

			/* 提示 + 删除 */
			msg ? (0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, marginBottom: 8 }, children: msg }) : null,
			selectedId !== GLOBAL_NODE_ID
				? (0, react_jsx_runtime.jsx)("button", { style: { ...S.btn, borderColor: "#7a2b2b", color: "#ff8a8a" }, onClick: doRemove, disabled: busy, children: "删除当前节点" })
				: null
		] })
	] });
}

export default DirectorHierarchy;
