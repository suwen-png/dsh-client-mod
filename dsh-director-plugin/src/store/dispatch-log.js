/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：本次「总监派发」台账（第 17 批）
 * 引用：—
 * 上游：components/DirectorPage.js, logic/branch-tree.js, logic/director-collect.js, logic/director-dispatch.js
 * 下游：logic/lineage.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/dispatch-log.js — 本次「总监派发」台账（第 17 批）
 *
 * ── 定位 ────────────────────────────────────────────────────────
 *   第 16 批只记了「建了几条会话」（`store/split-index.js` 的 `dsh.director.split`）。
 *   本批要回答的是**另外三问**：派给谁 / 干到哪一步 / 产出了什么。
 *   这三问的答案是**运行内数据**（状态与产出会变），所以：
 *
 *   · **持久化沿用现有 key**（`dsh.director.split`，由 `recordSplits` 写）—— **不新开 key**；
 *   · 台账本身**只活在本次运行**，与 `bridge/chat-bridge.js` 的 `conversationMirror` 同策略
 *     （既有先例，见那里的注释：镜像只累积到本次运行）。
 *
 * ── 🔴 为什么状态与摘要**分开存**（纪律 19：降级可以无声不行）──────
 *   状态来自宿主会话快照（**一条 RPC 全拿到，永不缺**）；
 *   摘要来自逐会话 `history()`（**要读事件流，可能失败**）。
 *   若合成一个字段，界面就只能二选一：要么把"读不到摘要"显示成"没产出"，要么反过来撒谎。
 *   ⇒ `state` 与 `say` **各自带自己的来源与原因**：`stateSource` / `sayReason`。
 *
 * ── 🔴 空摘要不许拿标题充数 ────────────────────────────────────
 *   宿主会自动给会话起标题（实测 `session/title` 事件，来源
 *   `provider:"session-title-first-prompt-llm"`），它**不是分支的产出**。
 *   若把 `title` 当成 `say` 显示，界面上会出现"看起来有产出、其实是用户原话/模型起的名"。
 *   ⇒ `title` 单独放 `title` 字段，`say` **只**放真读到的助手正文（读不到就是 `""`）。
 */

import { validateFlowSids, normalizeFlowSid } from "../logic/lineage.js";

const listeners = new Set();

/** 本次运行内的派发台账（**内存单例**；不改 localStorage 冻结契约） */
export const dispatchLog = {
	/** 派发时刻（ms） */
	at: 0,
	/** 派发用的需求原文 */
	text: "",
	/** 作品名（从原文提取，可能为空） */
	name: "",
	/** "novel" | "generic" */
	kind: "",
	/** 维度维度台账：[{ dim, label, sessionId, sentVia, sentAt, state, stateSource, turns, outputTokens, say, sayReason, title, collectedAt }] */
	items: [],
	/** 最近一次「回收产出」的总读数：{at, ok, done, running, blank, partial, failed, nextAction} */
	collect: null,
	/** 🔴 WS-B · B7：思维链路决策台账（**不新建 store**，落这里）。
	 *   每次 L0 决策留 { 输入, 决策, 理由, 时间, dim/sessionId } ——
	 *   用户能翻「上次为何派给 A4」。跨批次累积（轨迹页签要翻历史）。 */
	decisions: []
};

/** 订阅台账变化（返回退订函数） */
export function subscribeDispatch(fn) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/** 通知（**逐层 try**：一个订阅者抛错不许打哑其余订阅者） */
function emit() {
	listeners.forEach((fn) => { try { fn(dispatchLog); } catch (e) { /* 订阅者自己的问题，不许打哑派发链 */ } });
}

/** 读台账（返回**同一对象**：调用方只读；需要 React 重渲染请走订阅） */
export function readDispatchLog() { return dispatchLog; }

/**
 * 记一次派发（**整体替换** items —— 每次派发是一个新批次，不跨批次混）。
 * @param {{text?:string, name?:string, kind?:string, items?:Array}} entry
 * @returns {typeof dispatchLog}
 */
export function recordDispatch(entry) {
	const e = entry || {};
	dispatchLog.at = Date.now();
	dispatchLog.text = String(e.text == null ? "" : e.text);
	dispatchLog.name = String(e.name == null ? "" : e.name);
	dispatchLog.kind = String(e.kind == null ? "" : e.kind);
	dispatchLog.items = (Array.isArray(e.items) ? e.items : []).map((it) => ({
		dim: String(it.dim || ""),
		label: String(it.label || ""),
		sessionId: String(it.sessionId || ""),
		/* 🔴 第 23 批补：**简报必须进台账**。
		 *    `info.brief` 在 `logic/director-dispatch.js` 里**本来就构造了**（`briefOf(...)` 的
		 *    返回值），但本白名单式 map 没带它 ⇒ 简报**在进台账那一刻被丢掉**。
		 *    后果不是"少一个字段"，而是：**「总监到底给分支说了什么」完全无从核对**
		 *    —— D8（需求整理）/ D9（项目把控）改的正是简报内容，改完却**没有观测面**，
		 *    真机闸门只能读到一个 `""`（本轮实测），看起来像功能没落地。
		 *    ⇒ 台账是运行内调试数据的唯一通道（不持久化、不进 localStorage 冻结契约），
		 *      在这里补上零成本、零契约风险。 */
		brief: String(it.brief || ""),
		sentVia: String(it.sentVia || ""),
		sentOk: it.sentOk === true,
		sentReason: String(it.sentReason || ""),
		attachFail: it.attachFail === true,
		/* 状态初值：**未知**，不是"待处理" —— 派发那一刻我们确实还不知道宿主怎么看它 */
		state: "unknown",
		stateSource: "尚未取样",
		turns: null,
		outputTokens: null,
		say: "",
		sayReason: "尚未回收（点「回收产出」才读各分支事件流）",
		title: null,
		collectedAt: 0
	}));
	dispatchLog.collect = null;
	emit();
	return dispatchLog;
}

/**
 * 用宿主快照刷新**状态**（不切页签、不读事件流 —— 这一路**不该失败**）。
 * @param {(id:string)=>object|null} summaryOf 由调用方给出的"取该会话原始摘要"函数
 * @param {(raw:object, say:string)=>object} stateFn `stateOfSummary`
 * @returns {number} 刷新条数
 */
export function refreshStates(summaryOf, stateFn) {
	let n = 0;
	dispatchLog.items.forEach((it) => {
		if (!it.sessionId) { it.state = "unknown"; it.stateSource = "无会话 id（未建成）"; return; }
		const raw = summaryOf(it.sessionId);
		if (!raw) { it.state = "unknown"; it.stateSource = "宿主快照里没有这条会话"; return; }
		const s = stateFn(raw, it.say);
		/* 🔴 `running` 只从宿主读，不从我们的调用推断 —— 推断出来的"应该在跑"
		 *    会掩盖"投递其实没生效"（第 16 批就是这么漏掉的）。 */
		it.state = s.state;
		it.turns = s.turns;
		it.outputTokens = s.outputTokens;
		it.title = s.title;
		it.stateSource = "宿主快照（sessions.list）";
		n++;
	});
	if (n) emit();
	return n;
}

/** 逐条打补丁（回收时用；不传的字段不动） */
export function patchDispatchItem(sessionId, patch) {
	const it = dispatchLog.items.filter((x) => x.sessionId === String(sessionId))[0];
	if (!it || !patch) return null;
	Object.keys(patch).forEach((k) => { it[k] = patch[k]; });
	emit();
	return it;
}

/** 记回收总读数 */
export function setDispatchCollect(summary) {
	dispatchLog.collect = summary ? Object.assign({ at: Date.now() }, summary) : null;
	emit();
	return dispatchLog.collect;
}

/** 取某会话对应的派发条目 */
export function dispatchItemOf(sessionId) {
	const id = String(sessionId || "");
	if (!id) return null;
	for (let i = 0; i < dispatchLog.items.length; i++) {
		if (dispatchLog.items[i].sessionId === id) return dispatchLog.items[i];
	}
	return null;
}

/**
 * 🔴 WS-B · B7：记一条 L0 决策（思维链路）。
 * 「插件只执行、模型做语义判断」⇒ 每次判断都要留痕：{ 输入, 决策, 理由, 时间 }。
 * 这是**唯一写入点**（UI/闸门不许自己 push 进 decisions）。
 *
 * @param {{input?:string, decision?:string, reason?:string, dim?:string, sessionId?:string, via?:string}} d
 * @returns {object} 落账后的决策记录
 */
export function recordDecision(d = {}) {
	const raw = d && typeof d === "object" ? d : {};
	const rec = {
		seq: dispatchLog.decisions.length + 1,
		at: Date.now(),
		input: String(raw.input == null ? "" : raw.input),
		decision: String(raw.decision == null ? "" : raw.decision),
		reason: String(raw.reason == null ? "" : raw.reason),
		dim: String(raw.dim == null ? "" : raw.dim),
		sessionId: String(raw.sessionId == null ? "" : raw.sessionId),
		via: String(raw.via == null ? "unknown" : raw.via)
	};
	dispatchLog.decisions.push(rec);
	emit();
	return rec;
}

/** 读全部决策（时间正序；轨迹页签直接渲染） */
export function readDecisions() {
	return dispatchLog.decisions.slice();
}

/** 某维度/会话的决策（升序）；用户问「上次为何派给 A4」走这里 */
export function decisionsFor(filter = {}) {
	const f = filter && typeof filter === "object" ? filter : {};
	const dim = f.dim == null ? null : String(f.dim);
	const sid = f.sessionId == null ? null : String(f.sessionId);
	return dispatchLog.decisions.filter((r) =>
		(dim == null || r.dim === dim) && (sid == null || r.sessionId === sid));
}

/** 某维度/会话的**最近一条**决策（空数组返回 null） */
export function lastDecisionFor(filter = {}) {
	const list = decisionsFor(filter);
	return list.length ? list[list.length - 1] : null;
}

/**
 * D2: format decisions into a 4-column row list for the thread view (pure; no new store).
 * Columns: input / decision / reason / time. Empty input -> []. UI renders rows directly.
 * @param {Array} list raw decision records (e.g. readDecisions() / decisionsFor(...))
 */
export function decisionRows(list = []) {
	const arr = Array.isArray(list) ? list : [];
	const pad = (n) => String(n).padStart(2, "0");
	return arr.map((r) => {
		const rec = r && typeof r === "object" ? r : {};
		const at = Number(rec.at) || 0;
		let time = "";
		if (at) { const d = new Date(at); time = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
		return {
			seq: Number(rec.seq) || 0,
			input: String(rec.input || ""),
			decision: String(rec.decision || ""),
			reason: String(rec.reason || ""),
			dim: String(rec.dim || ""),
			sessionId: String(rec.sessionId || ""),
			time: time
		};
	});
}

/**
 * WS-B · B1：把台账 items 当作「流转记录」做统一 id 语义校验。
 *
 * 🔴 主键必须是**会话 id**（sid/sessionId），不是 `ws_…` 作用域 id。
 *    这里复用 `logic/lineage.js#validateFlowSids`（唯一判据，纪律 126）——
 *    看板/导图/派发的三方对账都走它，不另写一份"sid 在不在集合里"。
 *
 * @param {Iterable<string>} sessionIds host 快照里的真实会话 id 集合
 * @returns {object} validateFlowSids 的返回体（ok / orphaned / leaks / missing…）
 */
export function validateLogSids(sessionIds) {
	return validateFlowSids(dispatchLog.items || [], sessionIds);
}

/** 取台账里全部流转主键（sessionId），供看板/导图对账「条目数 == 会话数」 */
export function flowSids() {
	return (dispatchLog.items || [])
		.map((it) => normalizeFlowSid(it && it.sessionId))
		.filter(Boolean);
}

/** 清空台账（**只清内存**；宿主里的分支会话不因此消失，这是刻意的） */
export function clearDispatchLog() {
	dispatchLog.at = 0;
	dispatchLog.text = "";
	dispatchLog.name = "";
	dispatchLog.kind = "";
	dispatchLog.items = [];
	dispatchLog.collect = null;
	dispatchLog.decisions = [];
	emit();
	return dispatchLog;
}

/**
 * 把派发状态**覆盖到血缘树上**（就地改显示字段，与 `store/split-index.js` 的
 * `applySplitLabels` 同构、同调用点）。
 *
 * 🔴 只**新增**显示字段，宿主真值（`running` / `blank` / `updatedAt` / `parentSessionId`…）
 *    与 `applySplitLabels` 写过的 `splitDim` / `titleOrigin` **一个不动** ——
 *    两边都写同一批字段就会出现"导图说在跑、总监页说没跑"的双口径。
 * 🔴 新增字段名**刻意避开** `state` / `stateSource`（那两个已被导图占用为**血缘状态**）：
 *    同名不同义会让闸门量错对象（本项目台账（二）#8 就是这么炸的）⇒ 用 `dispatchState`。
 *
 * @param {{rows?:Array, byId?:Object}} tree `refreshBranchTree()` 产出的树
 * @returns {{applied:number, states:Object}} 覆盖条数 + 各状态计数
 */
export function applyDispatchLabels(tree) {
	const out = { applied: 0, states: {} };
	if (!tree) return out;
	const items = dispatchLog.items || [];
	if (!items.length) return out;
	const map = {};
	items.forEach((it) => { if (it.sessionId) map[it.sessionId] = it; });
	const patch = (row, countIt) => {
		if (!row || !row.sessionId) return;
		const it = map[String(row.sessionId)];
		if (!it) return;
		row.dispatchId = String(it.sessionId);
		row.dispatchDim = String(it.dim || "");
		row.dispatchState = String(it.state || "unknown");
		row.dispatchSay = String(it.say || "");
		row.dispatchSayReason = String(it.sayReason || "");
		row.dispatchTurns = typeof it.turns === "number" ? it.turns : null;
		if (countIt) {
			out.applied++;
			out.states[row.dispatchState] = (out.states[row.dispatchState] || 0) + 1;
		}
	};
	(Array.isArray(tree.rows) ? tree.rows : []).forEach((r) => patch(r, true));
	/* byId 与 rows 是**两个对象**（同一会话各一份）⇒ 两边都要打补丁；
	 * 但 `applied` / `states` **只数 rows**（与 `applySplitLabels` 的 `countIt` 同口径）。
	 *
	 * 🔴 第 18 批修正：原实现两边都递增 ⇒ `diag.dispatchApplied` **翻倍**
	 *    （真机日志实测台账只有 8 条，而 `diag` 报 `dispatchApplied:16`；
	 *      `applySplitLabels` 报的 `splitApplied:40` 是正确口径 —— 两者"同口径"的**声明**当时并不成立）。
	 *    由 `scripts/test-dispatch-log.mjs` 的 `DL-9` 抓出（新模块单测的直接收益）。 */
	const byId = tree.byId && typeof tree.byId === "object" ? tree.byId : {};
	Object.keys(byId).forEach((k) => patch(byId[k], false));
	return out;
}
