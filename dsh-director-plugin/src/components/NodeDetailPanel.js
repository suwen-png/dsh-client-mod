/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：导图右侧「该框的对话」面板
 * 引用：—
 * 上游：client-entry.js, components/MindMap.js
 * 下游：logic/flow.js, logic/branch-tree.js, bridge/chat-bridge.js, store/plugin-db.js, store/mindmap-schema.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/NodeDetailPanel.js — 导图右侧「该框的对话」面板
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  需求原文（用户）：「然后点击框在右侧展开对话 对话的最上面是现在正在做的事情，
 *   也就是我发给或者总监发给对话的信息，对话整理出目前自己在做的什么事情，
 *   我要在思维导图界面能看到」
 *
 *  ⇒ 面板自上而下三段，顺序**不可调**：
 *     ① **现在在做的事**（logic/flow.js `currentTaskOf`）—— 必须最上面
 *     ② 跨维度流转时间线（这条消息走过总监 / 对话 / 导图 / 设计图的足迹）
 *     ③ 输入条 —— 「点到哪里往哪里输入」：输入落到**这个框对应的会话**
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 本面板最容易犯的错，以及怎么防
 * ══════════════════════════════════════════════════════════════════
 *  ① **拿"标题"顶替"在做的事"**：`ROUTE` 一类的字段看起来像结论，其实只是路由决策。
 *     ⇒ 一律走 `currentTaskOf()`，它每个分支都带 `source`（host.running /
 *       host.pendingInteraction / flow.trail / plugin-db / none），UI 把 source 显示出来。
 *  ② **假装能读任意会话的对话内容**：宿主只暴露"当前会话"的原生对话 DOM。
 *     非当前会话**读不到** ⇒ 面板明确写"该框不是当前对话，原生内容读不到；
 *     下面是插件侧登记过的流转"，而不是显示空白让人以为没数据。
 *  ③ **输入静默丢失**：非当前会话时先把流转登记 + 打开该会话 + 写入原生输入框，
 *     每一步都有回读校验与可见反馈（`sendToChat` 自带写后回读）。
 *
 * ⚠️ 构建约束：react / react/jsx-runtime 为平台冻结模块（ADR-001），构建期外置。
 */

import * as react from "react";
import { currentTaskOf, DIM, DIM_LABEL, DIM_ICON, FLOW_STATUS_LABEL, clip } from "../logic/flow.js";
import { openSession, currentSessionId } from "../logic/branch-tree.js";
import { sendToChat, findComposer } from "../bridge/chat-bridge.js";
import { listDirectorMessages } from "../store/plugin-db.js";
import { STATE_KINDS, NODE_KINDS } from "../store/mindmap-schema.js";

const h = react.createElement;
export const NODE_DETAIL_ID = "dsh-node-detail";

const TONE = {
	run: { bar: "var(--dp-ac, #2f6feb)", bg: "var(--dp-ac-soft, rgba(47,111,235,.16))", label: "执行中" },
	warn: { bar: "var(--dp-ac2, #8943e5)", bg: "var(--dp-ac2-soft, rgba(137,87,229,.16))", label: "待确认" },
	done: { bar: "#3fb950", bg: "rgba(63,185,80,.12)", label: "已收口" },
	info: { bar: "#d29922", bg: "rgba(210,153,34,.12)", label: "有流转" },
	idle: { bar: "var(--dp-line, #31343a)", bg: "rgba(255,255,255,.03)", label: "待命" }
};

const S = {
	wrap: {
		borderLeft: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-1, #141519)",
		display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, flex: "0 0 auto"
	},
	hd: {
		display: "flex", alignItems: "center", gap: 6, padding: "calc(7px * var(--dp-density,1)) 9px",
		borderBottom: "1px solid var(--dp-line, #31343a)", flex: "0 0 auto"
	},
	body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 9, display: "flex", flexDirection: "column", gap: 8 },
	now: (tone) => ({
		border: "1px solid var(--dp-line, #31343a)", borderLeft: "3px solid " + TONE[tone].bar,
		background: TONE[tone].bg, borderRadius: "var(--dp-radius, 8px)", padding: "7px 9px"
	}),
	nowT: { fontSize: "calc(12px * var(--dp-font,1))", fontWeight: 650, marginBottom: 3, wordBreak: "break-word", lineHeight: 1.5 },
	nowD: { fontSize: "calc(11px * var(--dp-font,1))", color: "var(--dp-t2, #c3c8ce)", lineHeight: 1.55, wordBreak: "break-word" },
	badge: {
		fontSize: "calc(9.5px * var(--dp-font,1))", padding: "0 5px", borderRadius: "var(--dp-radius-sm, 5px)",
		border: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-2, #1c1e23)", color: "var(--dp-t3, #8b9199)"
	},
	secT: {
		fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", letterSpacing: ".4px",
		display: "flex", alignItems: "center", gap: 5, marginBottom: 5
	},
	item: {
		border: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-2, #1c1e23)",
		borderRadius: "var(--dp-radius, 8px)", padding: "6px 8px", marginBottom: 5
	},
	itemT: { fontSize: "calc(11.5px * var(--dp-font,1))", lineHeight: 1.5, wordBreak: "break-word", color: "var(--dp-t1, #e8eaed)" },
	itemM: { fontSize: "calc(9.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
	ft: {
		flex: "0 0 auto", borderTop: "1px solid var(--dp-line, #31343a)", padding: 9,
		display: "flex", flexDirection: "column", gap: 6, background: "var(--dp-bg-0, #0b0c0e)"
	},
	inp: {
		boxSizing: "border-box", width: "100%", minHeight: 34, maxHeight: 96, resize: "vertical",
		borderRadius: "var(--dp-radius-sm, 5px)", border: "1px solid var(--dp-line, #31343a)",
		background: "var(--dp-bg-1, #141519)", color: "var(--dp-t1, #e8eaed)",
		fontFamily: "inherit", fontSize: "calc(11.5px * var(--dp-font,1))", padding: "6px 8px", lineHeight: 1.5
	},
	btn: {
		height: 26, padding: "0 10px", borderRadius: "var(--dp-radius-sm, 5px)", cursor: "pointer",
		fontSize: "calc(11.5px * var(--dp-font,1))", border: "1px solid var(--dp-line, #31343a)",
		background: "var(--dp-bg-2, #1c1e23)", color: "var(--dp-t2, #c3c8ce)", whiteSpace: "nowrap"
	},
	btnPri: { background: "var(--dp-ac, #2f6feb)", borderColor: "var(--dp-ac, #2f6feb)", color: "#fff" },
	note: { fontSize: "calc(10px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", lineHeight: 1.55 }
};

/** 维度足迹小标签（四个维度都在，走过的点亮 —— "同一消息在几个维度流转"一眼可见） */
function DimTrail({ flow }) {
	const seen = new Set(((flow && flow.trail) || []).map((t) => t.dim));
	return h("span", { style: { display: "inline-flex", gap: 3, alignItems: "center" }, "data-testid": "nd-trail" },
		[DIM.DIRECTOR, DIM.CHAT, DIM.MINDMAP, DIM.DESIGN].map((d, i) => h("span", {
			key: d, "data-dim": d, "data-on": seen.has(d) ? "1" : "0",
			title: DIM_LABEL[d] + (seen.has(d) ? "：走过" : "：未走"),
			style: {
				fontSize: 9.5, padding: "0 4px", borderRadius: 3,
				border: "1px solid " + (seen.has(d) ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "var(--dp-line, #31343a)"),
				background: seen.has(d) ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "transparent",
				color: seen.has(d) ? "var(--dp-t1, #e8eaed)" : "var(--dp-t3, #8b9199)",
				opacity: seen.has(d) ? 1 : 0.6
			}
		}, DIM_ICON[d] + DIM_LABEL[d].slice(0, 2))))
}

/**
 * @param {object} props
 * @param {object|null} props.row 选中的导图行（含 sessionId / title / kind / state / isCurrent）
 * @param {Array} props.flows 该会话的流转（logic/flow.js flowsOf）
 * @param {number} [props.width] 面板宽度（px）
 * @param {() => void} props.onClose
 * @param {(payload:object)=>void} [props.onFlow] 流转回调。**两种载荷**：
 *        · 有 `hopTo` → 让已登记的流转"走到"该维度（`{hopTo, text, note}`）
 *        · 无 `hopTo` → 登记一条新流转（`{text, origin, sessionId}`）
 * @param {(msg:string, tone?:string)=>void} [props.onSay] 让外层弹 toast
 * @param {(sessionId:string)=>void} [props.onOpenSession] 打开该原生对话
 */
export function NodeDetailPanel(props) {
	const { row, flows = [], width = 330, onClose, onFlow, onSay } = props;
	const [draft, setDraft] = react.useState("");
	const [msgs, setMsgs] = react.useState([]);
	const [busy, setBusy] = react.useState(false);
	const [isCurrent, setIsCurrent] = react.useState(() => currentSessionId());
	const sid = row ? row.sessionId : null;

	/* 该会话的总监消息（plugin-db，异步；失败静默为空） */
	react.useEffect(() => {
		let alive = true;
		if (!sid) { setMsgs([]); return () => { alive = false; }; }
		listDirectorMessages(sid).then((list) => { if (alive) setMsgs(list || []); }).catch(() => { if (alive) setMsgs([]); });
		return () => { alive = false; };
	}, [sid]);

	/* 跟一次"当前会话"（决定原生内容能不能读、输入能不能直达） */
	react.useEffect(() => {
		setIsCurrent(currentSessionId());
		const t = setInterval(() => setIsCurrent(currentSessionId()), 900);
		return () => clearInterval(t);
	}, [sid]);

	/* 拖宽（用户："框不能动需要可以移动" 的同族诉求：面板也要能调宽） */
	const [w, setW] = react.useState(width);
	react.useEffect(() => { setW(width); }, [width]);
	const dragRef = react.useRef(null);
	react.useEffect(() => {
		const onMove = (e) => {
			if (!dragRef.current) return;
			const delta = dragRef.current.x - e.clientX;
			setW(Math.max(260, Math.min(620, dragRef.current.w + delta)));
		};
		const onUp = () => { dragRef.current = null; };
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
	}, []);

	if (!row) return null;

	const flow = flows.length ? flows[flows.length - 1] : null;
	const now = currentTaskOf({ node: row, flow, flowList: flows, msgs });
	const tone = TONE[now.tone] ? now.tone : "idle";
	const kind = NODE_KINDS[row.kind] || NODE_KINDS.leaf;
	const stateK = STATE_KINDS[row.state] || STATE_KINDS.idle;

	/** 送到该会话：登记流转 → （非当前则先打开）→ 写入原生输入框 */
	async function send() {
		const text = draft.trim();
		if (!text) return;
		setBusy(true);
		try {
			if (props.onFlow) props.onFlow({ text, origin: DIM.MINDMAP, sessionId: sid });
			let opened = true;
			if (!isCurrent) {
				const r = await openSession(sid);
				opened = Boolean(r && r.ok);
				if (opened) await new Promise((res) => setTimeout(res, 450));
			}
			const focused = findComposer();
			const res = focused ? await sendToChat(text, { autoSend: false }) : { ok: false, mode: "failed", reason: "composer-not-found" };
			if (props.onFlow) {
				props.onFlow({
					hopTo: DIM.CHAT, text,
					note: res && res.ok ? "已写入原生输入框（" + (res.mode || "filled") + "）" : "未送达：" + ((res && res.reason) || "未知")
				});
			}
			if (onSay) {
				if (res && res.ok) onSay("已带入该对话的原生输入框，回车即发（" + (isCurrent ? "当前对话" : (opened ? "已切到该对话" : "⚠ 未能切到该对话")) + "）");
				else onSay("未送达：还需打开一个对话（" + ((res && res.reason) || "composer 不可用") + "）", "warn");
			}
			setDraft("");
		} finally { setBusy(false); }
	}

	return h("aside", {
		id: NODE_DETAIL_ID, "data-testid": "nd-panel", "data-session-id": sid || "",
		"data-is-current": isCurrent && sid && String(isCurrent) === String(sid) ? "1" : "0",
		style: { ...S.wrap, width: w, position: "relative", maxWidth: "46vw" }, role: "complementary", "aria-label": "该框的对话"
	}, [
		/* 拖宽手柄（面板左缘） */
		h("div", {
			key: "grip", "data-testid": "nd-grip", title: "拖动调宽",
			style: { position: "absolute", left: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 3 },
			onPointerDown: (e) => { e.preventDefault(); dragRef.current = { x: e.clientX, w: w }; }
		}),

		/* 头：类型 / 标题 / 状态 / 关闭 */
		h("div", { key: "hd", style: S.hd }, [
			h("span", { key: "i", style: { color: (NODE_KINDS[row.kind] || NODE_KINDS.leaf).accent } }, kind.icon),
			h("span", {
				key: "t", style: { fontWeight: 650, fontSize: "calc(12px * var(--dp-font,1))", minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
				title: (row.title || "") + " ｜ " + sid
			}, row.title),
			h("span", { key: "s", style: { ...S.badge, color: stateK.color } }, "● " + stateK.label),
			h("button", {
				key: "x", style: S.btn, "data-testid": "nd-close", "aria-label": "关闭该框的对话", title: "关闭该框的对话（Esc 逐层退）",
				onClick: onClose
			}, "✕")
		]),

		h("div", { key: "bd", style: S.body, className: "dp-scroll" }, [
			/* ① 现在在做的事 —— 必须在最上面 */
			h("div", { key: "now", style: S.now(tone), "data-testid": "nd-now", "data-tone": tone, "data-source": now.source }, [
				h("div", { key: "h", style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 } }, [
					h("span", { key: "l", style: { fontSize: "calc(10.5px * var(--dp-font,1))", color: TONE[tone].bar, fontWeight: 700, letterSpacing: ".4px" } }, "现在在做的事"),
					h("span", { key: "b", style: S.badge }, TONE[tone].label),
					h("span", { key: "s", style: { ...S.badge, marginLeft: "auto" }, title: "这个结论的依据来源（不编内容）" }, "来源 " + now.source)
				]),
				h("div", { key: "t", style: S.nowT, "data-testid": "nd-now-title" }, now.title),
				now.detail ? h("div", { key: "d", style: S.nowD, "data-testid": "nd-now-detail" }, now.detail) : null,
				h("div", { key: "m", style: { ...S.itemM, marginTop: 5 } }, [
					flow ? DimTrail({ flow }) : h("span", { key: "none", style: S.note }, "（该会话尚无跨维度流转）"),
					h("span", { key: "h", style: S.note }, "流转 " + flows.length + " 条"),
					now.at ? h("span", { key: "at", style: S.note }, "最后更新 " + new Date(now.at).toLocaleTimeString()) : null
				])
			]),

			/* ② 跨维度流转时间线 */
			h("div", { key: "fl", style: { marginTop: 2 } }, [
				h("div", { key: "t", style: S.secT }, [
					h("span", { key: "l" }, "跨维度流转（总监 / 对话 / 导图 / 设计图）"),
					h("span", { key: "c", style: { marginLeft: "auto" } }, flows.length + " 条")
				]),
				flows.length
					? flows.slice(-14).reverse().map((f) => h("div", {
						key: f.flowId, style: S.item, "data-testid": "nd-flow-item", "data-flow-id": f.flowId, "data-origin": f.origin,
						"data-status": f.status
					}, [
						h("div", { key: "t", style: S.itemT }, clip(f.text, 120) || "（空文本）"),
						h("div", { key: "m", style: S.itemM }, [
							DimTrail({ flow: f }),
							h("span", { key: "s", style: S.note }, FLOW_STATUS_LABEL[f.status] || f.status),
							h("span", { key: "a", style: S.note }, new Date(f.at).toLocaleTimeString()),
							h("span", { key: "o", style: S.note }, "起于 " + DIM_LABEL[f.origin])
						]),
						((f.trail || []).length > 1) ? h("div", {
							key: "tr", style: { ...S.itemM, marginTop: 2 },
							title: (f.trail || []).map((t) => DIM_LABEL[t.dim] + "：" + (t.note || "-")).join("\n")
						}, (f.trail || []).map((t, i) => h("span", {
							key: i, style: { fontSize: "calc(9.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)" }
						}, (i ? " → " : "") + DIM_ICON[t.dim] + (t.note ? clip(t.note, 22) : DIM_LABEL[t.dim])))) : null
					]))
					: h("div", { key: "e", style: S.note, "data-testid": "nd-flow-empty" },
						"该会话还没有流转记录。下面输入框发出的内容会**先登记**在这里，再按你选的动作送往对应维度。")
			]),

			/* ③ 总监消息（plugin-db）—— 让你看得到"总监对这个对话说过什么" */
			msgs.length ? h("div", { key: "dm", style: { marginTop: 2 } }, [
				h("div", { key: "t", style: S.secT }, "总监对这个对话说过的话（插件侧记录）"),
				msgs.slice(-6).reverse().map((m) => h("div", {
					key: m.messageId || m.at, style: S.item, "data-testid": "nd-dir-msg"
				}, [
					h("div", { key: "t", style: S.itemT }, clip(m.text, 120)),
					h("div", { key: "m", style: S.itemM }, [
						h("span", { key: "k", style: { ...S.badge, color: m.role === "user" ? "var(--dp-ac, #2f6feb)" : "var(--dp-ac2, #8957e5)" } }, m.role === "user" ? "你" : "总监"),
						h("span", { key: "n", style: S.note }, m.kind || "note"),
						h("span", { key: "a", style: S.note }, new Date(m.at || 0).toLocaleTimeString())
					])
				]))
			]) : null,

			/* 读不到原生内容时**明确说清**，不留空白让人以为坏了 */
			!isCurrent || String(isCurrent) !== String(sid) ? h("div", {
				key: "caveat", style: { ...S.note, borderTop: "1px dashed var(--dp-line, #31343a)", paddingTop: 6 }, "data-testid": "nd-caveat"
			}, "⚠ 该框不是宿主当前对话 ⇒ 它的**原生消息内容读不到**（宿主只暴露当前会话的对话 DOM）。" +
				"下面输入框会先打开该对话、再把内容写进它的原生输入框。") : null
		]),

		/* ④ 输入条 —— 「点到哪里往哪里输入」 */
		h("div", { key: "ft", style: S.ft }, [
			h("div", { key: "l", style: { display: "flex", alignItems: "center", gap: 5 } }, [
				h("span", { key: "c", style: { ...S.badge, color: "var(--dp-ac, #2f6feb)", borderColor: "var(--dp-ac-line, rgba(47,111,235,.45))" } },
					"输入到：" + clip(row.title, 16)),
				h("span", { key: "s", style: S.note }, isCurrent && String(isCurrent) === String(sid) ? "（当前对话，直达）" : "（非当前，会先切过去）")
			]),
			h("textarea", {
				key: "i", style: S.inp, "data-testid": "nd-input", value: draft, disabled: busy,
				placeholder: "对这个对话说点什么 —— 回车带入它的原生输入框…",
				onChange: (e) => setDraft(e.target.value),
				onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
			}),
			h("div", { key: "b", style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } }, [
				h("button", { key: "s", style: { ...S.btn, ...S.btnPri, opacity: busy ? 0.6 : 1 }, "data-testid": "nd-send", disabled: busy, onClick: send },
					busy ? "处理中…" : "送到该对话 ▸"),
				props.onRoute ? h("button", {
					key: "r", style: S.btn, "data-testid": "nd-route", disabled: busy,
					title: "把这条内容交给总监判断该由哪个对话执行（路由结果在底栏确认，不静默分发）",
					onClick: () => { const t = draft.trim(); if (!t) return; props.onRoute(t); setDraft(""); }
				}, "交给总监判断") : null,
				h("span", { key: "n", style: S.note }, "登记流转 → " + (isCurrent && String(isCurrent) === String(sid) ? "写入原生输入框" : "打开该对话 → 写入原生输入框"))
			])
		])
	]);
}

export default NodeDetailPanel;
