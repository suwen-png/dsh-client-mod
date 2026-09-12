/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总监工作台（方案 E · 文档 06 §五）
 * 引用：—
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorHierarchy.js
 * 下游：logic/duties.js, store/duty-config.js, logic/director-run.js, store/create-store.js, store/use-store.js, store/hierarchy.js, config/model.js, util/debug.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/DirectorWorkbench.js — 总监工作台（方案 E · 文档 06 §五）
 *
 * 依据
 *   §3.1 执行逻辑项（5 项 + 开关 + prompt 模板）→ 执行逻辑面板
 *   §3.2 继承制（默认→项目→会话，可覆盖、可向上提交）→ 继承徽标 + 三个按钮
 *   §2.2 总监tab内部布局 → 对话流 + 输入栏
 *   §2.3 完整消息流 ②③④ → 预处理 / 过程展示 / 自动转发
 *   §4.3 降级策略 → 梯度徽标 G0/G1
 *
 * ⚠️ 构建约束（同 DirectorHierarchy）
 *   - `react` / `react/jsx-runtime` 为平台冻结模块，外置为 `require(...)`（ADR-001）
 *   - 用 `.js` 而非 `.jsx`，不经 JSX 编译
 */

import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import { DUTY_KEYS } from "../logic/duties.js";
import { resolveDuties, setOwnDuties, clearOwnDuties, submitUp, ORIGIN } from "../store/duty-config.js";
import { runDirector } from "../logic/director-run.js";
import { directorStoreFactory } from "../store/create-store.js";
import { useDirectorStore } from "../store/use-store.js";
import { GLOBAL_NODE_ID, LEVEL_LABEL } from "../store/hierarchy.js";
import { loadDirectorConfig } from "../config/model.js";
import { dshLog } from "../util/debug.js";

const S = {
	card: { border: "1px solid var(--dsw-alias-border-l2, #2a2c30)", borderRadius: 8, padding: 12, marginBottom: 12, background: "var(--dsw-alias-bg-sunken, #1a1c20)" },
	label: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #a0a4aa)", marginBottom: 6 },
	btn: { padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #33363b)", background: "var(--dsw-alias-bg-base, #202227)", color: "var(--dsw-alias-label-primary, #e6e6e6)", cursor: "pointer" },
	btnPrimary: { padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #2f6bdd", background: "#2f6bdd", color: "#fff", cursor: "pointer" },
	input: { width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #33363b)", background: "var(--dsw-alias-bg-sunken, #1b1d21)", color: "var(--dsw-alias-label-primary, #e6e6e6)", boxSizing: "border-box" },
	row: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--dsw-alias-border-l2, #24262a)" },
	badge: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #8b8f96)", background: "var(--dsw-alias-bg-base, #202227)", borderRadius: 8, padding: "0 6px" },
	pre: { whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 12, lineHeight: "18px", fontFamily: "var(--ds-font-family-code, ui-monospace, Menlo, Consolas, monospace)" },
	muted: { color: "var(--dsw-alias-label-tertiary, #8b8f96)", fontSize: 12 }
};

const ORIGIN_LABEL = {
	[ORIGIN.DEFAULT]: "默认",
	[ORIGIN.GLOBAL]: "全局",
	[ORIGIN.PROJECT]: "项目",
	[ORIGIN.SESSION]: "会话",
	[ORIGIN.OWN]: "本层"
};

/**
 * @param {object} props
 * @param {object} props.node 当前层级节点（全局/项目/会话）
 */
export function DirectorWorkbench({ node }) {
	const nodeId = node?.id || GLOBAL_NODE_ID;
	/* ── 职责配置 ── */
	const [duties, setDuties] = react.useState(null);
	const [origin, setOrigin] = react.useState({});
	const [own, setOwn] = react.useState(null);
	const [editing, setEditing] = react.useState(null); // 正在编辑 prompt 的 key
	/* ── 对话流 ── */
	const [input, setInput] = react.useState("");
	const [autoForward, setAutoForward] = react.useState(false);
	const [busy, setBusy] = react.useState(false);
	const [msg, setMsg] = react.useState("");
	const [lastSteps, setLastSteps] = react.useState(null);
	const [forwardLog, setForwardLog] = react.useState([]);

	// 总监 store：会话级用真实 sessionId，其余用节点 id（同 sessionId 共享，切换不丢）
	const sessionId = react.useMemo(() => (
		node?.conversations?.[0]?.conversationId || nodeId
	), [node, nodeId]);
	const store = react.useMemo(() => directorStoreFactory(sessionId), [sessionId]);
	const state = useDirectorStore(store);

	const reload = react.useCallback(async () => {
		const r = await resolveDuties(nodeId);
		setDuties(r.duties);
		setOrigin(r.origin);
		setOwn(r.own);
		return r;
	}, [nodeId]);

	react.useEffect(() => { reload(); }, [reload]);
	react.useEffect(() => { setLastSteps(null); }, [nodeId]);

	const guard = (fn) => async (...a) => {
		if (busy) return;
		setBusy(true);
		try { await fn(...a); } finally { setBusy(false); }
	};

	const toggle = (k) => setDuties((d) => ({ ...d, [k]: { ...d[k], enabled: !d[k].enabled } }));

	const doSave = guard(async () => {
		const back = await setOwnDuties(nodeId, duties); // 内部已回读校验
		setOwn(back.duties);
		await reload();
		setMsg("已保存本层职责配置（已回读校验）");
	});

	const doSubmitUp = guard(async () => {
		const r = await submitUp(nodeId, 1);
		if (!r) { setMsg("已在最上层，无可提交目标"); return; }
		await reload();
		setMsg("已向上提交到「" + r.target.name + "」");
	});

	const doRestore = guard(async () => {
		await clearOwnDuties(nodeId);
		await reload();
		setMsg("已恢复继承（本层配置已清空）");
	});

	const doSend = guard(async () => {
		const text = input.trim();
		if (!text) { setMsg("请输入内容"); return; }
		setInput("");
		const cfg = loadDirectorConfig();
		const eff = (await resolveDuties(nodeId)).duties;
		let r;
		try {
			r = await runDirector({
				sessionId,
				userText: text,
				store,
				duties: eff,
				config: cfg,
				autoForward,
				onForward: (instr) => {
					setForwardLog((l) => [...l, { at: Date.now(), instruction: instr }]);
					dshLog("director", "autoForward -> " + instr.slice(0, 60));
				}
			});
		} catch (e) {
			// runDirector 内部已把【总监异常】写进对话流；此处只补面板提示，避免静默
			setMsg("总监执行失败：" + (e && e.message ? e.message : String(e)));
			return;
		}
		setLastSteps(r.steps);
		setMsg("总监处理完成：" + r.steps.filter((s) => s.enabled).length + " 项职责生效"
			+ " · 任务=" + r.taskType + " · 模型=" + r.model
			+ (r.forward.done ? " · 已自动转发" : ""));
	});

	const messages = state?.messages || [];

	return (0, react_jsx_runtime.jsxs)("div", { children: [
		/* ── 执行逻辑面板（§3.1）── */
		(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
			(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", marginBottom: 6 }, children: [
				(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 13, fontWeight: 600 }, children: "执行逻辑（03号文 §3.1 五项）" }),
				(0, react_jsx_runtime.jsxs)("span", { style: { marginLeft: "auto", display: "flex", gap: 6 }, children: [
					(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, "data-testid": "w-save", onClick: doSave, disabled: busy, children: "保存本层" }),
					(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "w-submit-up", onClick: doSubmitUp, disabled: busy, children: "向上提交" }),
					(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "w-restore", onClick: doRestore, disabled: busy, children: "恢复继承" })
				] })
			] }),
			(0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, marginBottom: 8 }, children:
				"本层状态：" + (own ? "已覆盖（优先于上层）" : "完全继承上层")
				+ " · 节点层级：" + (LEVEL_LABEL[node?.level] || node?.level || "-")
				+ "（§3.2 继承制：默认 → 全局 → 项目 → 会话）" }),

			duties ? DUTY_KEYS.map((k) => (0, react_jsx_runtime.jsxs)("div", { key: k, style: S.row, children: [
				(0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					checked: duties[k].enabled,
					onChange: () => toggle(k),
					"data-duty": k,
					style: { cursor: "pointer" }
				}),
				(0, react_jsx_runtime.jsx)("span", { style: { minWidth: 84 }, children: duties[k].name }),
				(0, react_jsx_runtime.jsxs)("span", { style: { ...S.muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
					"来源 ", ORIGIN_LABEL[origin[k]] || origin[k] || "-"
				] }),
				(0, react_jsx_runtime.jsx)("button", {
					style: S.btn, "data-edit-prompt": k,
					onClick: () => setEditing(editing === k ? null : k),
					children: editing === k ? "收起" : "prompt"
				})
			] }, k)) : (0, react_jsx_runtime.jsx)("div", { style: S.muted, children: "加载中…" }),

			editing && duties ? (0, react_jsx_runtime.jsxs)("div", { style: { marginTop: 8 }, children: [
				(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "prompt 模板：" + duties[editing].name }),
				(0, react_jsx_runtime.jsx)("textarea", {
					style: { ...S.input, minHeight: 64, resize: "vertical" },
					"data-prompt-input": editing,
					value: duties[editing].prompt,
					onChange: (e) => setDuties((d) => ({ ...d, [editing]: { ...d[editing], prompt: e.target.value } }))
				})
			] }) : null
		] }),

		/* ── 总监对话流（§2.3 ③）── */
		(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
			(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", marginBottom: 6 }, children: [
				(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 13, fontWeight: 600 }, children: "总监对话流" }),
				(0, react_jsx_runtime.jsx)("span", { style: { ...S.badge, marginLeft: "auto" }, children: messages.length + " 条" })
			] }),
			(0, react_jsx_runtime.jsx)("div", {
				style: { maxHeight: 220, overflowY: "auto", marginBottom: 8 },
				"data-testid": "director-messages",
				children: messages.length
					? messages.map((m, i) => (0, react_jsx_runtime.jsxs)("div", {
						key: i, style: { marginBottom: 8, paddingLeft: m.role === "user" ? 0 : 8, borderLeft: m.role === "user" ? "none" : "2px solid #2f6bdd" },
						children: [
							(0, react_jsx_runtime.jsx)("div", { style: S.muted, children: m.role === "user" ? "你" : (m.role === "assistant" ? "总监" : "系统") }),
							(0, react_jsx_runtime.jsx)("pre", { style: S.pre, children: m.content })
						]
					}, i))
					: (0, react_jsx_runtime.jsx)("div", { style: S.muted, children: "暂无消息。在下方输入并发送，总监将按 §1.2 五步预处理。" })
			}),

			/* 最近一次五步过程 */
			lastSteps ? (0, react_jsx_runtime.jsxs)("div", { style: { marginBottom: 8 }, children: [
				(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "本次处理过程（§1.2 五步）" }),
				lastSteps.map((s) => (0, react_jsx_runtime.jsxs)("div", { key: s.n, style: { ...S.muted, display: "flex", gap: 6 }, children: [
					(0, react_jsx_runtime.jsx)("span", { style: S.badge, children: s.enabled ? s.grade : "关" }),
					(0, react_jsx_runtime.jsx)("span", { children: s.n + ". " + s.name + "：" + String(s.text).slice(0, 60) })
				] }, s.n))
			] }) : null,

			/* 输入栏（§2.2） */
			(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
				(0, react_jsx_runtime.jsx)("input", {
					style: S.input, "data-testid": "director-input",
					placeholder: "输入需求，总监将预处理…",
					value: input,
					onChange: (e) => setInput(e.target.value),
					onKeyDown: (e) => { if (e.key === "Enter" && !busy) doSend(); }
				}),
				(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, "data-testid": "director-send", onClick: doSend, disabled: busy, children: "发送" }),
				(0, react_jsx_runtime.jsxs)("label", { style: { ...S.muted, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }, children: [
					(0, react_jsx_runtime.jsx)("input", { type: "checkbox", "data-testid": "director-autoforward", checked: autoForward, onChange: (e) => setAutoForward(e.target.checked) }),
					"自动转发"
				] })
			] }),
			forwardLog.length ? (0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, marginTop: 6 }, children:
				"已转发 " + forwardLog.length + " 条，最近：" + forwardLog[forwardLog.length - 1].instruction.slice(0, 40) }) : null
		] }),

		msg ? (0, react_jsx_runtime.jsx)("div", { style: S.muted, children: msg }) : null
	] });
}

export default DirectorWorkbench;
