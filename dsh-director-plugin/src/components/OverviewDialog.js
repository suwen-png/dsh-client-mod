/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总览弹窗（R10：左已完成 / 右待完成 · 按文件夹+对话分组 · 可点击 · 可发消息修正）
 * 引用：用户原话（2026-09-12 第七轮）
 * 上游：components/MindMap.js
 * 下游：logic/overview.js, logic/discover.js, bridge/chat-bridge.js, logic/branch-tree.js, store/personalize.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 J）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/OverviewDialog.js — 总览弹窗（R10）
 *
 * ── 需求（用户原话）─────────────────────────────────────────────
 *   「思维导图最上面加一个弹窗，分为左右列。左列是目前所有完成的功能，
 *     右列是所有待完成的，按照文件夹、对话进行分类……
 *     这个允许点击，每一条点击的时候在左侧显示具体执行完成或者正在执行的情况，
 *     我可以随时针对点击的部分发送消息进行修正。」
 *
 * ── 三个设计决定（都不是随手定的）──────────────────────────────
 *  ① **分类口径只定义一次**（`logic/overview.js`）——
 *     本项目栽过「一个语义标在两个元素上 ⇒ 计数翻倍」，分类散落必出同类错。
 *  ② **点条目 = 选中，不是跳转** —— 用户要的是"在左侧显示执行情况"，
 *     跳走会让用户丢失全局面。选中态写进 `data-sel-session` 供断言。
 *  ③ **发送走 `deliverToChat`** —— 与总监页/节点面板同一条投递通道，
 *     避免"总览这里能发、别处发不出去"的多套真相源。
 */

import * as react from "react";
import { buildOverview } from "../logic/overview.js";
import { discover } from "../logic/discover.js";
import { deliverToChat } from "../bridge/chat-bridge.js";
import { openSession } from "../logic/branch-tree.js";
import { listDirectorMessages } from "../store/plugin-db.js";

const h = react.createElement;
export const OVERVIEW_ID = "dsh-mm-overview";

const S = {
	backdrop: {
		position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.42)",
		display: "flex", alignItems: "flex-start", justifyContent: "center"
	},
	panel: {
		marginTop: 54, width: "min(1080px, 94vw)", maxHeight: "78vh", display: "flex", flexDirection: "column",
		background: "var(--dsw-alias-bg-layer-2, var(--dp-bg-1, #141519))",
		color: "var(--dsw-alias-label-primary, var(--dp-t1, #e6e8eb))",
		border: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))",
		borderRadius: 12, boxShadow: "var(--dsw-shadow-lv2, 0 18px 48px rgba(0,0,0,.5))",
		fontFamily: "inherit", overflow: "hidden"
	},
	hd: {
		display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
		borderBottom: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))", flex: "0 0 auto"
	},
	cols: { display: "flex", gap: 0, flex: "1 1 auto", minHeight: 0 },
	col: { flex: "1 1 50%", minWidth: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))" },
	colLast: { flex: "1 1 50%", minWidth: 0, display: "flex", flexDirection: "column" },
	colHd: { padding: "7px 10px", fontSize: 12.5, fontWeight: 650, borderBottom: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))" },
	body: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "6px 8px" },
	grp: { margin: "6px 0 10px" },
	grpT: { fontSize: 11.5, fontWeight: 650, opacity: 0.72, margin: "0 2px 4px" },
	item: (sel) => ({
		display: "flex", alignItems: "center", gap: 6, padding: "5px 7px", borderRadius: 7, cursor: "pointer",
		fontSize: 12, background: sel ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "transparent",
		border: "1px solid " + (sel ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "transparent")
	}),
	dot: (c) => ({ width: 7, height: 7, borderRadius: "50%", background: c, flex: "0 0 auto" }),
	ft: { flex: "0 0 auto", borderTop: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))", padding: "8px 10px" },
	inp: {
		width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 44, padding: "6px 8px",
		borderRadius: 7, border: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #3d4148))",
		background: "var(--dsw-alias-bg-layer-1, rgba(255,255,255,.03))",
		color: "inherit", fontFamily: "inherit", fontSize: 12
	},
	btn: {
		padding: "4px 10px", fontSize: 12, borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
		border: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #3d4148))",
		background: "transparent", color: "inherit"
	},
	btnPri: { border: "1px solid var(--dp-ac, #2f6feb)", background: "var(--dp-ac, #2f6feb)", color: "#fff" },
	muted: { opacity: 0.6, fontSize: 11.5 }
};

const STATE_COLOR = { done: "#3fb950", running: "#2f6feb", warn: "#d29922", idle: "#8b9199", info: "#d29922" };

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {Array} props.rows 会话行（`buildBranchTree().rows`）
 * @param {(m:string, tone?:string) => void} [props.onSay]
 */
export function OverviewDialog(props) {
	const { open, onClose, rows, onSay } = props;
	const [data, setData] = react.useState(null);
	const [sel, setSel] = react.useState(null);
	const [draft, setDraft] = react.useState("");
	const [busy, setBusy] = react.useState(false);
	const [mode, setMode] = react.useState("idle");
	const [msgs, setMsgs] = react.useState([]);

	/* 数据：discover（文件夹映射）+ buildOverview（分类分组）。open 时才拉，避免常驻开销。 */
	react.useEffect(() => {
		if (!open) return;
		let dead = false;
		(async () => {
			let src = { sessions: [], workspaces: [] };
			try { src = await discover(); } catch (e) { /* 降级：无分组信息，全部归「未分组」 */ }
			if (dead) return;
			setData(buildOverview({ rows, sessions: src.sessions, workspaces: src.workspaces }));
		})();
		return () => { dead = true; };
	}, [open, rows]);

	/* 选中条目的"执行情况"：取该会话的总监消息（有则显示末条） */
	react.useEffect(() => {
		if (!sel) { setMsgs([]); return; }
		let dead = false;
		(async () => {
			try {
				const list = (await listDirectorMessages("se_" + String(sel))) || [];
				if (!dead) setMsgs(list);
			} catch (e) { if (!dead) setMsgs([]); }
		})();
		return () => { dead = true; };
	}, [sel]);

	if (!open) return null;

	const counts = (data && data.counts) || { done: 0, todo: 0, total: 0 };
	const selItem = (() => {
		if (!data || !sel) return null;
		for (const g of [...data.done, ...data.todo]) {
			const hit = g.items.find((x) => String(x.sessionId) === String(sel));
			if (hit) return hit;
		}
		return null;
	})();

	const send = async () => {
		const t = draft.trim();
		if (!t || !sel) return;
		setBusy(true);
		try {
			const r = await deliverToChat(t, { sessionId: sel, opener: openSession, autoSend: true });
			setMode(r.mode === "sent" ? "sent" : (r.ok ? "filled" : "failed"));
			if (onSay) onSay(r.ok ? (r.mode === "sent" ? "已发送修正" : "已填入输入框") : "未送达 · " + r.reason, r.ok ? "" : "warn");
			setDraft("");
		} finally { setBusy(false); }
	};

	const renderCol = (title, groups, key, last) => h("div", {
		key, style: last ? S.colLast : S.col, "data-testid": "mm-ov-col-" + key
	}, [
		h("div", { key: "h", style: S.colHd, "data-testid": "mm-ov-h-" + key },
			title + " · " + (key === "done" ? counts.done : counts.todo)),
		h("div", { key: "b", style: S.body, className: "dp-scroll", "data-testid": "mm-ov-body-" + key },
			groups.length ? groups.map((g) => h("div", { key: g.folder, style: S.grp, "data-testid": "mm-ov-grp" }, [
				h("div", { key: "t", style: S.grpT }, "📁 " + g.folder + "（" + g.items.length + "）"),
				...g.items.map((it) => h("div", {
					key: it.sessionId, style: S.item(String(it.sessionId) === String(sel)),
					"data-testid": "mm-ov-item", "data-session-id": it.sessionId, "data-state": it.state,
					"data-folder": it.folder,
					onClick: () => { setSel(it.sessionId); setMode("idle"); },
					title: it.folder + " · " + it.statusLabel
				}, [
					h("span", { key: "d", style: S.dot(STATE_COLOR[it.state] || STATE_COLOR.idle) }),
					h("span", { key: "t", style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.title),
					h("span", { key: "s", style: S.muted }, it.statusLabel)
				]))
			])) : h("div", { key: "e", style: S.muted, "data-testid": "mm-ov-empty-" + key }, "无"))
	]);

	return h("div", {
		id: OVERVIEW_ID, style: S.backdrop, "data-testid": "mm-ov", "data-open": "1",
		"data-count-done": counts.done, "data-count-todo": counts.todo,
		"data-sel-session": sel || "", "data-deliver-mode": mode,
		onClick: (e) => { if (e.target === e.currentTarget) onClose(); }
	}, [
		h("div", { key: "p", style: S.panel, role: "dialog", "aria-label": "项目总览" }, [
			h("div", { key: "hd", style: S.hd }, [
				h("span", { key: "t", style: { fontWeight: 650, fontSize: 13 } }, "总览"),
				h("span", { key: "c", style: S.muted }, "已完成 " + counts.done + " · 待完成 " + counts.todo + " · 合计 " + counts.total),
				h("span", { key: "f", style: { ...S.muted, marginLeft: "auto" } }, "按文件夹分组"),
				h("button", { key: "x", style: S.btn, "data-testid": "mm-ov-close", "aria-label": "关闭总览", title: "关闭", onClick: onClose }, "✕")
			]),
			h("div", { key: "c", style: S.cols }, [
				renderCol("已完成", (data && data.done) || [], "done", false),
				renderCol("待完成", (data && data.todo) || [], "todo", true)
			]),
			h("div", { key: "ft", style: S.ft, "data-testid": "mm-ov-detail" }, [
				h("div", { key: "s", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" } }, [
					h("span", { key: "k", style: { fontWeight: 650, fontSize: 12 } },
						selItem ? ("执行情况 · " + selItem.title) : "选择左侧任一条目查看执行情况"),
					selItem ? h("span", { key: "st", style: S.muted }, "状态 " + selItem.statusLabel + " · " + selItem.folder + " · 子分支 " + selItem.childrenCount) : null,
					selItem ? h("span", { key: "m", style: S.muted }, "总监消息 " + msgs.length) : null,
					selItem && msgs.length ? h("span", { key: "l", style: { ...S.muted, maxWidth: "46%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
						"末条：" + String((msgs[msgs.length - 1] || {}).text || "").slice(0, 60)) : null
				]),
				h("textarea", {
					key: "i", style: S.inp, "data-testid": "mm-ov-input", value: draft, disabled: busy || !sel,
					placeholder: sel ? "输入修正内容，回车发送" : "先选一条",
					onChange: (e) => setDraft(e.target.value),
					onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
				}),
				h("div", { key: "b", style: { display: "flex", gap: 6, marginTop: 6, alignItems: "center" } }, [
					h("button", { key: "s", style: { ...S.btn, ...S.btnPri, opacity: busy ? 0.6 : 1 }, "data-testid": "mm-ov-send", disabled: busy || !sel, title: "发送修正到该对话", onClick: send },
						busy ? "处理中…" : "发送修正"),
					h("span", { key: "n", style: S.muted }, sel ? "目标 …" + String(sel).slice(-8) : "未选中")
				])
			])
		])
	]);
}

export default OverviewDialog;
