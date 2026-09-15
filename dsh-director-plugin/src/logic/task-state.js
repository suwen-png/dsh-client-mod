/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：任务状态机
 * 引用：—
 * 上游：client-entry.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 六（A2A 九态机 · 两种暂停态 · 乐观并发）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/task-state.js — 任务状态机
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它
 * ══════════════════════════════════════════════════════════════════
 *  改之前：任务在界面上只有三种样子 —— 「转圈」「有字了」「报错了」。
 *  用户看到转圈时无法分辨：是在跑？在等我点确认？还是在等我补一句输入？
 *  这三件事在 UI 上**必须不一样**，否则「驾驶舱」这个产品名就落不到实处。
 *
 *  A2A 协议把这件事定成了九态，其中关键的是把暂停拆成两个：
 *    INPUT_REQUIRED（在等你给信息） 与 AUTH_REQUIRED（在等你批准）
 *  ⇒ 界面因此可以给出两种不同的动作按钮，而不是一个笼统的「继续」。
 *
 * ══════════════════════════════════════════════════════════════════
 *  九态与三组
 * ══════════════════════════════════════════════════════════════════
 *   Running   SUBMITTED → WORKING
 *   Paused    INPUT_REQUIRED / AUTH_REQUIRED
 *   Finished  COMPLETED / FAILED / CANCELED / REJECTED
 *
 *  🔴 两条规则（都是「防止静默」）：
 *   ① **终态不可再转移** —— 已完成的活儿被偷偷改回 WORKING，
 *      会让时间线与统计全部失真。
 *   ② **自转移只有 WORKING → WORKING 合法**（表示进度更新）；
 *      其余自转移一律拒绝，因为它们通常是**状态没变却记了一笔**的 bug。
 *
 * ⚠️ 本文件**零 import**（同规，便于离线单测）。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、状态定义
 * ══════════════════════════════════════════════════════════════════ */

/** 九态 */
export const STATE = Object.freeze({
	SUBMITTED: "SUBMITTED",
	WORKING: "WORKING",
	INPUT_REQUIRED: "INPUT_REQUIRED",
	AUTH_REQUIRED: "AUTH_REQUIRED",
	COMPLETED: "COMPLETED",
	FAILED: "FAILED",
	CANCELED: "CANCELED",
	REJECTED: "REJECTED"
});

/** 状态分组 */
export const GROUP = Object.freeze({ RUNNING: "running", PAUSED: "paused", FINISHED: "finished" });

/** 状态元数据：label 给界面，group 给筛选，action 给按钮文案 */
export const STATES = Object.freeze([
	{ key: STATE.SUBMITTED, label: "已提交", group: GROUP.RUNNING, icon: "⏱", action: "" },
	{ key: STATE.WORKING, label: "执行中", group: GROUP.RUNNING, icon: "▶", action: "" },
	{ key: STATE.INPUT_REQUIRED, label: "待补充信息", group: GROUP.PAUSED, icon: "✎", action: "补充信息" },
	{ key: STATE.AUTH_REQUIRED, label: "待批准", group: GROUP.PAUSED, icon: "⛨", action: "批准 / 驳回" },
	{ key: STATE.COMPLETED, label: "已完成", group: GROUP.FINISHED, icon: "✓", action: "" },
	{ key: STATE.FAILED, label: "失败", group: GROUP.FINISHED, icon: "✕", action: "重试" },
	{ key: STATE.CANCELED, label: "已取消", group: GROUP.FINISHED, icon: "⊘", action: "" },
	{ key: STATE.REJECTED, label: "已驳回", group: GROUP.FINISHED, icon: "⊖", action: "重做" }
]);

const BY_KEY = new Map(STATES.map((s) => [s.key, s]));

/** 取状态元数据（未知态回落 SUBMITTED，不返回 undefined） */
export function stateOf(key) {
	return BY_KEY.get(key) || STATES[0];
}

/** 是否终态（不可再转移） */
export function isTerminal(key) {
	return stateOf(key).group === GROUP.FINISHED;
}

/** 是否暂停态（等人） */
export function isPaused(key) {
	return stateOf(key).group === GROUP.PAUSED;
}

/* ══════════════════════════════════════════════════════════════════
 * 二、合法转移表
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 合法转移。
 * 🔴 WORKING → WORKING 合法（进度更新，不会推进时间线但会记一笔事件）；
 *    其余自转移非法（通常是「状态没变却记了一笔」的 bug）。
 */
export const TRANSITIONS = Object.freeze({
	SUBMITTED: [STATE.WORKING, STATE.FAILED, STATE.CANCELED, STATE.REJECTED],
	WORKING: [STATE.WORKING, STATE.INPUT_REQUIRED, STATE.AUTH_REQUIRED, STATE.COMPLETED, STATE.FAILED, STATE.CANCELED],
	INPUT_REQUIRED: [STATE.WORKING, STATE.CANCELED, STATE.FAILED],
	AUTH_REQUIRED: [STATE.WORKING, STATE.COMPLETED, STATE.REJECTED, STATE.CANCELED, STATE.FAILED],
	COMPLETED: [],
	FAILED: [],
	CANCELED: [],
	REJECTED: []
});

/**
 * 能否从 from 转到 to。
 * @returns {{ok:boolean, reason:string}}
 */
export function canTransition(from, to) {
	const a = stateOf(from).key;
	const b = stateOf(to).key;
	const allowed = TRANSITIONS[a] || [];
	if (isTerminal(a)) return { ok: false, reason: "「" + stateOf(a).label + "」是终态，不可再转移" };
	if (a === b && a !== STATE.WORKING) return { ok: false, reason: "自转移非法（" + stateOf(a).label + " → 自身）；只有执行中→执行中（进度更新）允许" };
	if (!allowed.includes(b)) {
		return { ok: false, reason: "非法转移：" + stateOf(a).label + " → " + stateOf(b).label + "（允许：" + (allowed.map((x) => stateOf(x).label).join("、") || "无") + "）" };
	}
	return { ok: true, reason: stateOf(a).label + " → " + stateOf(b).label };
}

/** 所有合法转移（UI 上画状态机图用；来自同一真相源，不单独维护一份） */
export function transitionTable() {
	return Object.entries(TRANSITIONS).map(([from, tos]) => ({
		from,
		fromLabel: stateOf(from).label,
		to: tos.slice(),
		toLabels: tos.map((t) => stateOf(t).label)
	}));
}

/* ══════════════════════════════════════════════════════════════════
 * 三、任务对象与事件流
 * ══════════════════════════════════════════════════════════════════ */

/** 新建一个任务 */
export function createTask(init = {}) {
	const t = init && typeof init === "object" ? init : {};
	return {
		id: t.id ? String(t.id) : ("task-" + Date.now().toString(36)),
		title: t.title ? String(t.title) : "",
		sessionId: t.sessionId ? String(t.sessionId) : "",
		state: Object.values(STATE).includes(t.state) ? t.state : STATE.SUBMITTED,
		createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
		updatedAt: Number.isFinite(t.updatedAt) ? t.updatedAt : Date.now(),
		/* 未决的人工请求：**必须跟着任务一起持久化** ——
		 * 否则用户关掉面板再打开，那个待审批项就丢了（AutoGen/MAF 的 checkpoint 教训） */
		pending: t.pending && typeof t.pending === "object" ? { ...t.pending } : null,
		transitions: Array.isArray(t.transitions) ? t.transitions.slice() : [],
		error: t.error ? String(t.error) : ""
	};
}

/**
 * 执行一次状态转移。**不做就地修改**（返回新对象），便于快照与撤销。
 *
 * @param {object} task
 * @param {string} to
 * @param {object} [meta] { at?:number, expected?:string, note?:string, pending?:object }
 * @returns {{ok:boolean, task:object, event:object|null, reason:string}}
 */
export function transition(task, to, meta = {}) {
	const t = createTask(task);
	const chk = canTransition(t.state, to);
	const at = Number.isFinite(meta.at) ? meta.at : Date.now();

	if (!chk.ok) {
		return {
			ok: false, task: t, event: null,
			reason: chk.reason
		};
	}

	/* 乐观并发：调用方声明的 expected 与当前不符 ⇒ 拒绝（防止基于陈旧状态写入） */
	if (meta.expected && meta.expected !== t.state) {
		return {
			ok: false, task: t, event: null,
			reason: "状态已变（期望 " + stateOf(meta.expected).label + "，实际 " + stateOf(t.state).label + "）⇒ 拒绝写入"
		};
	}

	const event = {
		seq: t.transitions.length + 1,
		from: t.state,
		to: stateOf(to).key,
		at,
		note: meta.note ? String(meta.note) : ""
	};

	const next = {
		...t,
		state: event.to,
		updatedAt: at,
		transitions: t.transitions.concat(event),
		error: event.to === STATE.FAILED ? (meta.note || t.error || "未说明原因") : t.error,
		pending: Object.prototype.hasOwnProperty.call(meta, "pending") ? meta.pending : t.pending
	};
	/* 离开暂停态 ⇒ 清掉未决请求（否则界面上会一直挂着"待批准"） */
	if (isPaused(t.state) && !isPaused(event.to)) next.pending = null;

	return { ok: true, task: next, event, reason: chk.reason };
}

/**
 * 状态时间线（UI 直接渲染）：每条带可读文案。
 * @returns {Array<{seq:number, at:number, label:string, fromLabel:string, toLabel:string, note:string, waitMs:number}>}
 */
export function timeline(task) {
	const t = createTask(task);
	return t.transitions.map((e, i) => {
		const prevAt = i > 0 ? t.transitions[i - 1].at : t.createdAt;
		return {
			seq: e.seq,
			at: e.at,
			fromLabel: stateOf(e.from).label,
			toLabel: stateOf(e.to).label,
			label: stateOf(e.from).label + " → " + stateOf(e.to).label,
			note: e.note,
			waitMs: Math.max(0, e.at - prevAt)
		};
	});
}

/** 任务摘要（给列表用） */
export function taskSummary(task) {
	const t = createTask(task);
	const meta = stateOf(t.state);
	const paused = isPaused(t.state);
	return {
		id: t.id,
		title: t.title,
		state: t.state,
		label: meta.label,
		group: meta.group,
		icon: meta.icon,
		/* 暂停态时告诉界面该显示什么按钮 —— 两个暂停态的按钮**不一样** */
		action: paused ? (t.pending && t.pending.action ? String(t.pending.action) : meta.action) : "",
		pending: paused ? t.pending : null,
		elapsedMs: Math.max(0, (t.updatedAt || t.createdAt) - t.createdAt),
		steps: t.transitions.length,
		error: t.error
	};
}

/**
 * 按组筛选（界面上的三个筛选页签）。
 * @param {Array} tasks
 */
export function groupTasks(tasks) {
	const out = { [GROUP.RUNNING]: [], [GROUP.PAUSED]: [], [GROUP.FINISHED]: [] };
	for (const t of (Array.isArray(tasks) ? tasks : [])) {
		const s = taskSummary(t);
		out[s.group].push(s);
	}
	return out;
}

/* ══════════════════════════════════════════════════════════════════
 * 四、一致性检查（这套状态机自己也要被验）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 状态机结构自检。四条：
 *   ① 每个状态的转移目标都是**已定义的状态**
 *   ② 终态出边为 0
 *   ③ 从 SUBMITTED 可达全部**非终态**（否则有些状态永远进不去 = 死代码）
 *   ④ 每个非终态都能抵达至少一个终态（否则任务永远结束不了）
 * @returns {{ok:boolean, fails:string[]}}
 */
export function auditMachine() {
	const fails = [];
	const keys = Object.keys(TRANSITIONS);

	for (const [from, tos] of Object.entries(TRANSITIONS)) {
		for (const to of tos) {
			if (!BY_KEY.has(to)) fails.push(from + " 指向未定义状态：" + to);
		}
		if (isTerminal(from) && tos.length > 0) fails.push(from + " 是终态却仍有出边：" + tos.join("、"));
	}

	/* ③ 可达性 */
	const seen = new Set([STATE.SUBMITTED]);
	const q = [STATE.SUBMITTED];
	while (q.length) {
		const cur = q.shift();
		for (const nxt of (TRANSITIONS[cur] || [])) {
			if (!seen.has(nxt)) { seen.add(nxt); q.push(nxt); }
		}
	}
	for (const k of keys) {
		if (!seen.has(k)) fails.push("状态不可达（死代码）：" + k);
	}

	/* ④ 每个非终态必须能到某个终态 */
	for (const k of keys) {
		if (isTerminal(k)) continue;
		const seen2 = new Set([k]);
		const q2 = [k];
		let canFinish = false;
		while (q2.length) {
			const cur = q2.shift();
			if (isTerminal(cur)) { canFinish = true; break; }
			for (const nxt of (TRANSITIONS[cur] || [])) {
				if (!seen2.has(nxt)) { seen2.add(nxt); q2.push(nxt); }
			}
		}
		if (!canFinish) fails.push("非终态无法抵达任何终态（任务永远结束不了）：" + k);
	}

	return { ok: fails.length === 0, fails };
}

/* ══════════════════════════════════════════════════════════════════
 * 五、全局契约
 * ══════════════════════════════════════════════════════════════════ */

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installTaskStateApi() {
	if (typeof window === "undefined") return null;
	window.__dshTaskState = {
		STATE, GROUP, STATES, TRANSITIONS,
		stateOf, isTerminal, isPaused,
		canTransition, transitionTable,
		createTask, transition, timeline, taskSummary, groupTasks,
		auditMachine
	};
	return window.__dshTaskState;
}
