/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：逐会话读写通道（第 17 批）
 * 引用：—
 * 上游：logic/director-collect.js, logic/director-dispatch.js
 * 下游：logic/branch-tree.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * bridge/session-io.js — 逐会话读写通道（第 17 批）
 *
 * ── 🔴 这个模块为什么能存在（真机实测，2026-09-16）──────────────────
 *   第 16 批的结论是「总监页签下宿主消息 DOM 整体卸载 ⇒ 读产出只能逐个切页签」。
 *   那个结论**只对 DOM 通道成立**。本轮实测到一条**服务通道**：
 *
 *     `sessions.scope(id).get("conversation")`            ← 宿主 client.js:11572 scopedConversation 同源
 *        └─ `.scopedSession()`  → SessionConversation
 *              ├─ `.history({})`  → { ok:true, value:{ events:[{event:{type,data}}], hasMore, projections } }
 *              └─ `.send(...)`    → 投递
 *
 *   实测读数（`_probe-eval.mjs`，会话 `session-51a74d66…`）：
 *     `history({})` 返回 **23 条事件**，`valueKeys = ["events","hasMore","projections"]`，
 *     事件类型含 `user/message` / `assistant/message` / `assistant/chunk` / `session/title` /
 *     `turn/start` / `turn/end` / `step/start` / `step/end` / `request/*` / `permission/*`。
 *     `assistant/message.data.message.content[0].text === "收到"` —— **正文可读**。
 *
 *   ⇒ 「回流」不需要切页签：**一次拿全部**，8 条分支可以并列读。
 *
 * ── 🔴 必须过滤的两类"假用户消息"────────────────────────────────
 *   `user/message` 里**不只**是用户输入：宿主还会把
 *     · `Current runtime context. This snapshot supersedes…`（实测 457 B）
 *     · `<system-reminder> …`（实测 **48,722 B**）
 *   当成 user 消息推入事件流。若不过滤，产出摘要会被 48 KB 的系统提示淹没，
 *   而且**读数看起来完全正常**（条数对得上、都有 text）。故 `isInjectedUserText()` 是必需的。
 *
 * ── 降级纪律（本模块的硬约束）────────────────────────────────────
 *   · 任何失败都返回 `{ ok:false, reason }`，**不抛**（调用方在渲染链 / 批处理链上）。
 *   · `reason` 必须**可分辨**：拿不到 `history` / 事件为空 / 无助手消息 —— 三者原因不同。
 *   · **不许编摘要**：读不到就是 `""` + 原因，绝不回落到"看起来像摘要"的占位文案。
 */

import { scopedConversationOf } from "../logic/branch-tree.js";

const MAX_ITEMS = 40;

/**
 * 该 `user/message` 文本是否是**宿主注入**的（不是用户真正输入的内容）。
 *
 * 🔴 判据取「开头前缀」而非「包含」：注入文本**从不**出现在用户输入的开头
 *    （用户不会以 `<system-reminder>` 开头），而正文里提到这些词是正常的
 *    —— 用「包含」会把分支写的**讲评书/讲提示词的文章**整段误杀。
 *
 * @param {string} t
 * @returns {boolean}
 */
export function isInjectedUserText(t) {
	const s = String(t == null ? "" : t).replace(/^\s+/, "");
	if (!s) return true;
	return s.indexOf("Current runtime context") === 0
		|| s.indexOf("<system-reminder>") === 0
		|| s.indexOf("<system_reminder>") === 0;
}

/** 从一条事件的 `data.content` / `data.message.content` 里取纯文本 */
function textOfContent(content) {
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (let i = 0; i < content.length; i++) {
		const c = content[i];
		if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
	}
	return parts.join("");
}

/**
 * 事件流 → 可读对话条目（纯函数）。
 *
 * 只取两类事件：
 *   · `user/message`      → `data.content[]`（过滤宿主注入）
 *   · `assistant/message` → `data.message.content[]`（助手正文）
 * 其余（`assistant/chunk` 流式块、`turn/*`、`step/*`、`request/*`、`session/title`）
 * 不产生"对话条目"，但 `session/title` 单独取出来当**机器可读的产出标题**。
 *
 * @param {Array} events `history().value.events`
 * @returns {{items:Array<{role:string,text:string,at:number,turn:number|null}>, title:string|null, endReason:string|null,
 *            endFailure:{kind:string|null,message:string|null,code:string|null,status:number|null}|null}}
 */
export function extractTurns(events) {
	const out = { items: [], title: null, endReason: null, endFailure: null };
	const list = Array.isArray(events) ? events : [];
	for (let i = 0; i < list.length; i++) {
		const row = list[i];
		const e = row && row.event ? row.event : row;
		if (!e || typeof e !== "object") continue;
		const d = e.data || {};
		if (e.type === "user/message") {
			const t = textOfContent(d.content);
			if (t && !isInjectedUserText(t)) {
				out.items.push({ role: "user", text: t, at: Number(e.time) || 0, turn: typeof d.turn === "number" ? d.turn : null });
			}
		} else if (e.type === "assistant/message") {
			const msg = d.message || {};
			const t = textOfContent(msg.content);
			if (t) {
				out.items.push({ role: "assistant", text: t, at: Number(e.time) || 0, turn: typeof d.turn === "number" ? d.turn : null });
			}
		} else if (e.type === "session/title") {
			if (d.title) out.title = String(d.title);
		} else if (e.type === "turn/end") {
			const k = d.reason && d.reason.kind ? String(d.reason.kind) : null;
			if (k) out.endReason = k;
			/* 🔴 第 19 批：把宿主自己给出的**失败详情**取出来。
			 *    宿主在 `reason.kind==="error"` 时把真因放在 `reason.error` / `reason.failure`：
			 *      `{ message:"Insufficient Balance", code:"QUOTA", status:402 }`（实测 2026-09-16）
			 *    只留 `kind="error"` ⇒ 「模型配额不足」「模型拒答」「网络断了」在界面上
			 *    **长得一模一样**，用户只看到"没产出"，无从处置。
			 *    纪律 58：「没跑成」必须与「失败」可分，且**必须先落地读数**。
			 *    🔴 取**最后**一次（循环覆盖）＝本轮最近一次运行的结局，正是回收要的。 */
			const f = (d.reason && (d.reason.error || d.reason.failure)) || null;
			if (f && typeof f === "object") {
				const fs2 = Number(f.status);
				out.endFailure = {
					kind: k,
					message: f.message ? String(f.message).slice(0, 160) : null,
					code: f.code ? String(f.code) : null,
					status: Number.isFinite(fs2) ? fs2 : null
				};
			}
		}
	}
	return out;
}

/**
 * 读某会话的**事件流**（宿主 `SessionConversation.history`）。
 *
 * @param {string} sessionId
 * @returns {Promise<{ok:boolean, events:Array, projections:object|null, hasMore:boolean|null, reason:string|null}>}
 */
export async function readSessionEvents(sessionId) {
	if (!sessionId) return { ok: false, events: [], projections: null, hasMore: null, reason: "缺 sessionId" };
	const conv = scopedConversationOf(sessionId);
	if (!conv) {
		return { ok: false, events: [], projections: null, hasMore: null,
			reason: "取不到会话作用域下的 conversation 服务（sessions.scope(id).get('conversation') 为空）" };
	}
	let ss = null;
	try { ss = typeof conv.scopedSession === "function" ? conv.scopedSession() : null; }
	catch (e) { return { ok: false, events: [], projections: null, hasMore: null, reason: "scopedSession() 抛出：" + String((e && e.message) || e) }; }
	if (!ss || typeof ss.history !== "function") {
		return { ok: false, events: [], projections: null, hasMore: null, reason: "会话对象没有 history()（宿主契约变化）" };
	}
	let h = null;
	try { h = await ss.history({}); }
	catch (e) { return { ok: false, events: [], projections: null, hasMore: null, reason: "history() 抛出：" + String((e && e.message) || e) }; }
	const v = h && h.result && h.result.ok ? h.result.value : null;
	if (!v) {
		const err = h && h.result && h.result.error ? JSON.stringify(h.result.error).slice(0, 200) : "返回体无 value";
		return { ok: false, events: [], projections: null, hasMore: null, reason: "history() 未返回 ok：真 " + err };
	}
	return {
		ok: true,
		events: Array.isArray(v.events) ? v.events : [],
		projections: v.projections || null,
		hasMore: typeof v.hasMore === "boolean" ? v.hasMore : null,
		reason: null
	};
}

/**
 * 读某会话的**可读产出**（对话条目 + 宿主标题 + 结束原因）。
 *
 * @param {string} sessionId
 * @param {number} [limit=40] 最多回多少条（取**最后** N 条：摘要在尾部）
 * @returns {Promise<{ok:boolean, items:Array, count:number, title:string|null, endReason:string|null,
 *                    endFailure:{kind:string|null,message:string|null,code:string|null,status:number|null}|null,
 *                    lastText:string, reason:string|null}>}
 */
export async function readSessionOutput(sessionId, limit) {
	const n = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.round(Number(limit)) : MAX_ITEMS;
	const r = await readSessionEvents(sessionId);
	if (!r.ok) {
		return { ok: false, items: [], count: 0, title: null, endReason: null, endFailure: null, lastText: "", reason: r.reason };
	}
	const ex = extractTurns(r.events);
	const all = ex.items;
	const start = Math.max(0, all.length - n);
	return {
		ok: true,
		items: all.slice(start),
		count: all.length,
		title: ex.title,
		endReason: ex.endReason,
		/* 🔴 第 19 批：宿主侧失败详情随产出一起上交（null = 本轮没有失败事件） */
		endFailure: ex.endFailure || null,
		lastText: all.length ? all[all.length - 1].text : "",
		reason: null
	};
}

/**
 * 会话**状态**（纯函数）—— 由宿主原始摘要推导，**不切页签**。
 *
 * 真机摘要字段（实测，纪律 53）：
 *   `{ id, displayTitle, running, blank, updatedAt, projectionValues, cwd, agentPreset }`
 *   `projectionValues.sessionStats = { turns, steps, llmMs, toolMs, ttftMs, decodeMs, decodeTokens }`
 *
 * 状态判定顺序（**先证前提再断结果**，纪律 23）：
 *   ① `running === true`            → `"running"`（宿主明说在跑，优先）
 *   ② `blank === true`              → `"blank"`（宿主明说空白会话：简报还没进去 / 还没跑）
 *   ③ `stats.turns > 0` 且有助手产出 → `"done"`
 *   ④ `stats.turns > 0` 但无助手产出 → `"partial"`（跑了但没拿到回复 ⇒ 可能与"正常"混同，必须分开）
 *   ⑤ 其余                          → `"unknown"`（**不猜**）
 *
 * @param {object} raw `rawSessionSummaries()` 的一条
 * @param {string|null} [assistantText] 已读到的助手正文（有则用于 ③/④ 判别）
 * @returns {{state:string, turns:number|null, steps:number|null, outputTokens:number|null, title:string|null}}
 */
export function stateOfSummary(raw, assistantText) {
	const empty = { state: "unknown", turns: null, steps: null, outputTokens: null, title: null };
	if (!raw || typeof raw !== "object") return empty;
	const pv = raw.projectionValues || {};
	const st = pv.sessionStats || null;
	const turns = st && typeof st.turns === "number" ? st.turns : null;
	const steps = st && typeof st.steps === "number" ? st.steps : null;
	const outputTokens = st && typeof st.decodeTokens === "number" ? st.decodeTokens : null;
	const title = pv.title ? String(pv.title) : (raw.displayTitle ? String(raw.displayTitle) : null);
	let state;
	if (raw.running === true) state = "running";
	else if (raw.blank === true) state = "blank";
	else if (turns !== null && turns > 0) state = (assistantText && String(assistantText).trim()) ? "done" : "partial";
	else state = "unknown";
	return { state, turns, steps, outputTokens, title };
}

/**
 * 往某会话投递一段文本（**不碰 DOM**）。
 *
 * 通道优先级（**如实标注走的是哪一级**，纪律 19）：
 *   ① `window.__directChatSubmit(sessionId, text)` —— 宿主 `client.js` 暴露的直投
 *      （实测：投递后 3s 内 `running` 由 false→true→false、`turns` 1、正文可读回）
 *   ② 会话作用域下的 `conversation.send(...)`
 *   ③ 都没有 ⇒ `ok:false` + 原因（**不假装已派发**）
 *
 * ⚠️ ①是**fire-and-forget**（返回 `undefined`）⇒ "投递成功"这一读数**只能**由
 *    "会话真的开始跑"反推，不能由返回值给出。本函数只报"调用是否发出"，
 *    真伪由调用方用 `stateOfSummary()` 的 `turns/running` 复核。
 *
 * @param {string} sessionId
 * @param {string} text
 * @returns {Promise<{ok:boolean, via:string, reason:string|null}>}
 */
export async function sendToSession(sessionId, text) {
	if (!sessionId) return { ok: false, via: "none", reason: "缺 sessionId" };
	if (typeof window !== "undefined" && typeof window.__directChatSubmit === "function") {
		try {
			window.__directChatSubmit(sessionId, text);
			return { ok: true, via: "host-direct", reason: null };
		} catch (e) {
			/* 掉到下一级，但**记下**这一级失败的原因 */
			const conv = scopedConversationOf(sessionId);
			if (conv && typeof conv.send === "function") {
				try { conv.send(text); return { ok: true, via: "conversation-send", reason: "直投抛出后转 send：" + String((e && e.message) || e) }; }
				catch (e2) { return { ok: false, via: "none", reason: "直投与 send 都抛出：" + String((e2 && e2.message) || e2) }; }
			}
			return { ok: false, via: "none", reason: "__directChatSubmit 抛出：" + String((e && e.message) || e) };
		}
	}
	const conv = scopedConversationOf(sessionId);
	if (conv && typeof conv.send === "function") {
		try { conv.send(text); return { ok: true, via: "conversation-send", reason: null }; }
		catch (e) { return { ok: false, via: "none", reason: "conversation.send 抛出：" + String((e && e.message) || e) }; }
	}
	return { ok: false, via: "none", reason: "宿主未提供 __directChatSubmit，会话作用域也没有 send（能力探测见 probeSessionApi）" };
}

/**
 * 取某会话的**原始摘要**（`rawSessionSummaries()` 里的一条）。
 * @param {Array<object>} raws
 * @param {string} sessionId
 * @returns {object|null}
 */
export function findSummary(raws, sessionId) {
	const list = Array.isArray(raws) ? raws : [];
	for (let i = 0; i < list.length; i++) {
		if (list[i] && String(list[i].id) === String(sessionId)) return list[i];
	}
	return null;
}

/**
 * 诊断：把逐会话读通道的**每一条**分别报出来（供 CDP 探针与降级显示用）。
 * @param {string} sessionId
 * @returns {Promise<object>}
 */
export async function probeSessionIo(sessionId) {
	const out = { sessionId: sessionId || null };
	out.scoped = Boolean(scopedConversationOf(sessionId || ""));
	const r = await readSessionEvents(sessionId || "");
	out.eventsOk = r.ok;
	out.eventCount = r.ok ? r.events.length : 0;
	out.reason = r.reason;
	if (r.ok) {
		const types = {};
		r.events.forEach((row) => {
			const t = row && row.event && row.event.type ? row.event.type : "?";
			types[t] = (types[t] || 0) + 1;
		});
		out.types = types;
		const ex = extractTurns(r.events);
		out.turns = { count: ex.items.length, title: ex.title, endReason: ex.endReason, last: ex.items.length ? ex.items[ex.items.length - 1].text.slice(0, 120) : "" };
	}
	return out;
}
