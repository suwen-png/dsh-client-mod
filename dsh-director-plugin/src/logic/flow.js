/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：四维消息流转（总监 / 对话 / 思维导图 / 设计图 的**同一条消息**）
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js, components/MindMap.js, components/NodeDetailPanel.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/flow.js — 四维消息流转（总监 / 对话 / 思维导图 / 设计图 的**同一条消息**）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  需求原文（用户）：「最后打通总监和正常对话还有思维导图还有设计图之间的关联，
 *   保证同一个消息能在上面几个维度进行流转。我点击左侧，点入不同的对话切进去
 *   就是和当前对话有关的流转信息」
 *
 *  ⇒ 落地口径：
 *     一条**流转条目**（flow）= 一条消息 + 它走过哪些维度的足迹（`trail`）。
 *     四个界面**读写同一份数据**，于是"同一消息在四个维度流转"是可查证的，
 *     而不是四份互相不知道的影子状态。
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么必须有这一层（而不是各界面各存一份）
 * ══════════════════════════════════════════════════════════════════
 *  已有三份状态，但它们**互不相通**：
 *    · `store/plugin-db.js`  总监消息（按 nodeId 存，只有总监维度的）
 *    · 宿主原生会话          真实对话（在宿主里，插件只能读不能写历史）
 *    · 设计图底部对话（D6）  只处理设计图
 *  ⇒ 用户"发一句话"这件事在三个地方各记各的，看不出"这句话后来去哪了"。
 *  本层把「谁发的 / 发到哪 / 走到第几维 / 现在是什么状态」收敛成一份可追踪的轨迹。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 两条纪律
 * ══════════════════════════════════════════════════════════════════
 *  ① **不静默分发**：`push()` 只登记"这句话产生了"，`move()` 才记"被送往某维"，
 *     且 UI 必须在该维度**给出可见反馈**（与 logic/routing.js 的确认闸门同一条纪律）。
 *  ② **不编内容**：`currentTaskOf()` 的每个分支都在 `source` 字段里写明
 *     "这个结论来自哪里"（host.running / host.pendingInteraction / flow.trail /
 *     plugin-db / none）。读不到就说读不到，不拿标题或深度顶替。
 *
 * ⚠️ 本文件**不 import react**（纯函数 + 持久化 store）⇒ 离线单测可直接 import。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、四个维度（顺序即界面顺序：总监 | 对话 | 思维导图 | 设计图）
 * ══════════════════════════════════════════════════════════════════ */

export const DIM = Object.freeze({
	DIRECTOR: "director",
	CHAT: "chat",
	MINDMAP: "mindmap",
	DESIGN: "design"
});

/** 维度顺序（与用户口中的顺序一致："总监和正常对话还有思维导图还有设计图"） */
export const DIM_ORDER = Object.freeze([DIM.DIRECTOR, DIM.CHAT, DIM.MINDMAP, DIM.DESIGN]);

export const DIM_LABEL = Object.freeze({
	[DIM.DIRECTOR]: "总监",
	[DIM.CHAT]: "对话",
	[DIM.MINDMAP]: "思维导图",
	[DIM.DESIGN]: "设计图"
});

export const DIM_ICON = Object.freeze({
	[DIM.DIRECTOR]: "◆",
	[DIM.CHAT]: "💬",
	[DIM.MINDMAP]: "🧠",
	[DIM.DESIGN]: "🖌"
});

/** 落点（这条消息最终被送去哪；与 logic/routing.js 的 DESTINATION 语义对齐但独立计数） */
export const FLOW_STATUS = Object.freeze({
	OPEN: "open",        // 已登记，尚未确认去向
	ROUTED: "routed",    // 已确认去向，已送达
	BLOCKED: "blocked",  // 有阻塞（宿主接口不可用 / 目标不存在）
	DONE: "done"         // 已收口（对应任务已完成）
});

export const FLOW_STATUS_LABEL = Object.freeze({
	[FLOW_STATUS.OPEN]: "待确认去向",
	[FLOW_STATUS.ROUTED]: "已送达",
	[FLOW_STATUS.BLOCKED]: "有阻塞",
	[FLOW_STATUS.DONE]: "已收口"
});

/** 宿主的三种 pendingInteraction（与 store/mindmap-schema.js 的取值域一致） */
export const PENDING_LABEL = Object.freeze({
	approval: "等待批准",
	question: "等待回答",
	"plan-review": "等待方案评审"
});

/* ══════════════════════════════════════════════════════════════════
 * 二、纯函数（可离线断言）
 * ══════════════════════════════════════════════════════════════════ */

/** 稳定短 id（不依赖 Math.random —— 项目纪律：禁用非确定性随机） */
export function flowId(seed) {
	const s = String(seed == null ? "" : seed);
	let h1 = 2166136261, h2 = 2246822519;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = (h1 ^ c) >>> 0; h1 = Math.imul(h1, 16777619) >>> 0;
		h2 = (h2 + c * (i + 3)) >>> 0; h2 = Math.imul(h2, 3266489917) >>> 0;
	}
	return "fl" + h1.toString(36) + h2.toString(36).slice(0, 4);
}

/** 文案截断（列表里显示用；不改变原文本） */
export function clip(text, n) {
	const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
	const max = n || 60;
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * 登记一条新流转。
 * @param {{text:string, origin?:string, sessionId?:string, at?:number, target?:string, note?:string}} input
 * @returns {object} flow
 */
export function makeFlow(input = {}) {
	const text = String(input.text == null ? "" : input.text).trim();
	const origin = DIM_ORDER.indexOf(input.origin) >= 0 ? input.origin : DIM.DIRECTOR;
	const sessionId = input.sessionId === undefined || input.sessionId === null ? null : String(input.sessionId);
	const at = typeof input.at === "number" ? input.at : Date.now();
	return {
		flowId: flowId(origin + "|" + text + "|" + at),
		text,
		origin,
		sessionId,
		at,
		status: FLOW_STATUS.OPEN,
		target: input.target || null,
		trail: [{ dim: origin, at, note: input.note || "登记" }]
	};
}

/**
 * 让一条流转"走到"某一维（追加足迹；**不改** origin，保证"从哪来"可追溯）。
 * @param {object} flow
 * @param {string} dim
 * @param {string} [note]
 * @param {object} [extra] 可带 { status, target }
 * @returns {object} 新 flow（不原地改，便于对比）
 */
export function hopFlow(flow, dim, note, extra) {
	if (!flow) return null;
	if (DIM_ORDER.indexOf(dim) < 0) return flow;
	const at = (extra && typeof extra.at === "number") ? extra.at : Date.now();
	const next = {
		...flow,
		status: (extra && extra.status) || flow.status,
		target: (extra && extra.target) !== undefined ? extra.target : flow.target,
		trail: (flow.trail || []).concat([{ dim, at, note: String(note || "") }])
	};
	return next;
}

/** 这条流转走过哪些维度（去重、按界面顺序返回） */
export function flowDims(flow) {
	const seen = new Set((flow && flow.trail ? flow.trail : []).map((t) => t.dim));
	return DIM_ORDER.filter((d) => seen.has(d));
}

/** 人类可读的流转线：「总监 → 对话 → 思维导图」 */
export function flowLine(flow, sep) {
	const dims = flowDims(flow);
	if (!dims.length) return "—";
	return dims.map((d) => DIM_LABEL[d]).join(sep || " → ");
}

/** 最后一次足迹（UI 上"现在在哪一维"） */
export function lastHop(flow) {
	const t = flow && flow.trail ? flow.trail : [];
	return t.length ? t[t.length - 1] : null;
}

/**
 * 最后活动时刻 —— 登记时刻与**全部足迹时刻**取最大。
 *
 * 🔴 为什么需要它（本闸门 B28 暴露的真实语义缺口）：
 *   `flow.at` 只是**登记时刻**（makeFlow 时写下，hopFlow 不再改它，因为它是"从哪来"的一部分）。
 *   于是一条昨天登记、今天才被推进到设计图的流转，
 *   `at` 仍是昨天 ⇒ 它会被排到"更晚登记但早已僵住"的条目**之后**，
 *   而用户看到的是「点左侧切进来、面板最上面写着要干的事」——
 *   他最关心的是**最近有动静的那条**，不是最近新建的那条。
 *   ⇒ 排序与「现在在做的事」的时间戳都改用本函数；`at` 保留原义（登记时刻）不动。
 */
export function lastTouchOf(flow) {
	if (!flow) return 0;
	const t = flow.trail || [];
	let m = typeof flow.at === "number" ? flow.at : 0;
	for (const h of t) if (typeof h.at === "number" && h.at > m) m = h.at;
	return m;
}

/** 某会话的全部流转（按**最后活动**升序；sessionId 为 null 的条目属"全域"） */
export function flowsOf(flows, sessionId) {
	const sid = sessionId === undefined || sessionId === null ? null : String(sessionId);
	return (Array.isArray(flows) ? flows : [])
		.filter((f) => (f.sessionId === null ? sid === null : f.sessionId === sid))
		.slice()
		.sort((a, b) => lastTouchOf(a) - lastTouchOf(b));
}

/** 某会话最新一条流转（无则 null） */
export function latestFlow(flows, sessionId) {
	const list = flowsOf(flows, sessionId);
	return list.length ? list[list.length - 1] : null;
}

/**
 * 「现在在做的事」—— 用户原文：「点击框在右侧展开对话，对话的最上面是
 * 现在正在做的事情，也就是我发给或者总监发给对话的信息，对话整理出目前
 * 自己在做的什么事情，我要在思维导图界面能看到」。
 *
 * 🔴 优先级固定（先"宿主真值"，后"我们自己记的"）：
 *     ① 宿主 `pendingInteraction` → 真的在等人（最强信号）
 *     ② 宿主 `running === true`  → 真的在跑
 *     ③ 最新流转               → 我们确实登记过的那句话
 *     ④ 总监消息（plugin-db）   → 总监维度的最后一句
 *     ⑤ 无                     → 如实报"待命 · 尚无流转"
 *   每个分支都带 `source`，UI 直接显示出来 ⇒ 读不到时用户知道是"没数据"，
 *   而不是以为界面坏了（这是本项目反复吃过亏的地方）。
 *
 * @param {{node?:object, flow?:object, flowList?:Array, msgs?:Array}} input
 * @returns {{title:string, detail:string, dim:string|null, at:number|null, tone:string, source:string, hops:number}}
 */
export function currentTaskOf(input = {}) {
	const node = input.node || null;
	const flow = input.flow || null;
	const flowList = Array.isArray(input.flowList) ? input.flowList : [];
	const msgs = Array.isArray(input.msgs) ? input.msgs : [];
	const hops = flowList.length;
	const last = flow ? lastHop(flow) : null;
	const trailNote = flow ? ("流转 " + hops + " 条 · " + flowLine(flow)) : "";

	if (node && node.pending) {
		return {
			title: "待你确认 —— " + (PENDING_LABEL[node.pending] || node.pending),
			detail: flow ? clip(flow.text, 100) : "宿主报告该会话有待处理交互（pendingInteraction）",
			dim: last ? last.dim : DIM.CHAT, at: last ? last.at : null, tone: "warn",
			source: "host.pendingInteraction", hops
		};
	}
	if (node && node.running === true) {
		return {
			title: "正在执行",
			detail: flow ? clip(flow.text, 100) : "宿主报告该会话 running（插件侧尚无流转记录）",
			dim: last ? last.dim : DIM.CHAT, at: last ? last.at : null, tone: "run",
			source: "host.running", hops
		};
	}
	if (node && node.completed === true && !flow) {
		return {
			title: "该对话已收口",
			detail: "宿主报告 completed，且插件侧无未闭合流转",
			dim: null, at: null, tone: "done", source: "host.completed", hops
		};
	}
	if (flow) {
		return {
			title: clip(flow.text, 90) || "（空文本流转）",
			detail: trailNote + (flow.status === FLOW_STATUS.ROUTED ? " · 已送达" : " · " + (FLOW_STATUS_LABEL[flow.status] || flow.status)),
			/* 时间戳用**最后一次足迹**的时刻（不是登记时刻）——
			 * 面板最上面那句「现在在做的事」旁边显示的时间，若写着几小时前，
			 * 用户会以为界面卡住了。见 lastTouchOf 头注。 */
			dim: last ? last.dim : flow.origin, at: last ? last.at : flow.at, tone: "info",
			source: "flow.trail", hops
		};
	}
	if (msgs.length) {
		const m = msgs[msgs.length - 1];
		return {
			title: clip(m.text, 90) || "（空消息）",
			detail: "最近一条总监消息 · " + (m.kind || "note") + " · " + new Date(m.at || 0).toLocaleTimeString(),
			dim: DIM.DIRECTOR, at: m.at || null, tone: "info", source: "plugin-db", hops
		};
	}
	return {
		title: "待命 · 尚无流转",
		detail: node
			? "宿主未报 running / pending，插件侧也没有该会话的流转记录"
			: "没有选中会话：点左侧会话或导图里的任一个框",
		dim: null, at: null, tone: "idle", source: node ? "host.idle" : "none", hops
	};
}

/** 汇总（给总监页 R2.5 / 顶栏徽章用） */
export function flowStats(flows) {
	const list = Array.isArray(flows) ? flows : [];
	const byDim = {};
	for (const d of DIM_ORDER) byDim[d] = 0;
	let multiDim = 0;
	for (const f of list) {
		const dims = flowDims(f);
		for (const d of dims) byDim[d] += 1;
		if (dims.length > 1) multiDim += 1;
	}
	return {
		total: list.length,
		byDim,
		multiDim,
		open: list.filter((f) => f.status === FLOW_STATUS.OPEN).length,
		routed: list.filter((f) => f.status === FLOW_STATUS.ROUTED).length
	};
}

/** 按会话聚合（给"点左侧切会话 → 只显示该会话的流转"用） */
export function flowsBySession(flows) {
	const map = new Map();
	for (const f of Array.isArray(flows) ? flows : []) {
		const k = f.sessionId === null ? "__global__" : f.sessionId;
		if (!map.has(k)) map.set(k, []);
		map.get(k).push(f);
	}
	return map;
}

/* ══════════════════════════════════════════════════════════════════
 * 三、持久化 store（唯一写入口；订阅式，与 branch-tree 同一套写法）
 * ══════════════════════════════════════════════════════════════════ */

export const FLOW_KEY = "dsh.director.flow";
/** 上限：超出丢弃最旧的（防止 localStorage 无限膨胀） */
export const FLOW_MAX = 200;

function loadFlows() {
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(FLOW_KEY) : null;
		if (!raw) return { flows: [], activeSessionId: null };
		const p = JSON.parse(raw);
		const flows = Array.isArray(p && p.flows) ? p.flows.filter((f) => f && f.flowId && Array.isArray(f.trail)) : [];
		return { flows, activeSessionId: (p && p.activeSessionId) || null };
	} catch (e) { return { flows: [], activeSessionId: null }; }
}

let flowState = loadFlows();
const flowListeners = new Set();

function persist() {
	try {
		if (typeof localStorage !== "undefined") localStorage.setItem(FLOW_KEY, JSON.stringify(flowState));
	} catch (e) { /* 隐私模式 / 超配额：流转丢失不阻断功能 */ }
}
function notifyFlow() { for (const fn of flowListeners) { try { fn(flowState); } catch (e) { /* 忽略单个订阅者异常 */ } } }

export const flowStore = {
	getState: () => flowState,
	subscribe: (fn) => { flowListeners.add(fn); return () => flowListeners.delete(fn); },

	/** 登记一条流转（默认落在总监维度：用户先在总监说话） */
	push: (text, opts = {}) => {
		const f = makeFlow({ ...opts, text });
		if (!f.text) return null;
		const next = flowState.flows.concat([f]);
		flowState = { ...flowState, flows: next.length > FLOW_MAX ? next.slice(next.length - FLOW_MAX) : next };
		persist(); notifyFlow();
		return f;
	},

	/** 让某条流转"走到"下一维（并记下谁触发的） */
	move: (id, dim, note, extra) => {
		let moved = null;
		flowState = {
			...flowState,
			flows: flowState.flows.map((f) => {
				if (f.flowId !== id) return f;
				moved = hopFlow(f, dim, note, extra);
				return moved;
			})
		};
		if (moved) { persist(); notifyFlow(); }
		return moved;
	},

	/** 直接改状态（收口 / 阻塞） */
	setStatus: (id, status, target) => flowStore.move(id, (lastHop((flowState.flows.find((f) => f.flowId === id)) || {}) || {}).dim || DIM.DIRECTOR, "状态 → " + status, { status, target }),

	/** UI 当前正在看哪个会话（"点左侧切进去"时由组件写入） */
	setActiveSession: (sessionId) => {
		const sid = sessionId === undefined || sessionId === null ? null : String(sessionId);
		if (flowState.activeSessionId === sid) return sid;
		flowState = { ...flowState, activeSessionId: sid };
		persist(); notifyFlow();
		return sid;
	},

	/** 测试 / 复位用 */
	reset: () => { flowState = { flows: [], activeSessionId: null }; persist(); notifyFlow(); return true; },

	/* ── 查询（包一层，省得组件各自 import 纯函数） ── */
	ofSession: (sessionId) => flowsOf(flowState.flows, sessionId),
	latestOf: (sessionId) => latestFlow(flowState.flows, sessionId),
	stats: () => flowStats(flowState.flows),
	taskOf: (input) => currentTaskOf(input)
};

/** 全局契约（调试 / e2e 用） */
export function installFlowApi() {
	const api = {
		DIM, DIM_ORDER, DIM_LABEL, DIM_ICON, FLOW_STATUS, FLOW_STATUS_LABEL, PENDING_LABEL,
		FLOW_KEY, FLOW_MAX,
		flowId, clip, makeFlow, hopFlow, flowDims, flowLine, lastHop, lastTouchOf,
		flowsOf, latestFlow, currentTaskOf, flowStats, flowsBySession,
		store: flowStore
	};
	if (typeof window !== "undefined") window.__dshFlow = api;
	return api;
}
