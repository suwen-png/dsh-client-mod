/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：任务状态机
 * 引用：—
 * 上游：client-entry.js, components/Board.js, components/DirectorPage.js, components/MindMap.js
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
		error: t.error ? String(t.error) : "",
		/* 看板层字段（WS-B · B2；createTask 必须保留，否则 setField 一归一就丢） */
		pinned: t.pinned === true,
		summary: t.summary ? String(t.summary) : "",
		projectRoot: t.projectRoot ? String(t.projectRoot) : "",
		partial: t.partial === true
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
 * D3 执行逻辑：幂等推进薄壳（**复用** transition/canTransition，不另造转移表 —— 纪律126）。
 *  ① 幂等：已是目标态 ⇒ 原样返回、不记新事件、不报错（WORKING 进度心跳是唯一例外：meta.heartbeat 才记一笔）。
 *  ② blocked 必带因：to 落到失败态（看板 BLOCKED）时 meta.reason/note 必须非空，否则拒绝 —— 失败不静默。
 *  ③ 可回放：成功仍走 transition 追加事件，timeline() 可完整重放。
 * @returns {{ok:boolean, task:object, event:object|null, reason:string}}
 */
export function advance(task, to, meta = {}) {
	const t = createTask(task);
	const toKey = stateOf(to).key;
	const reason = meta.reason ? String(meta.reason) : "";
	/* ① 幂等：已是目标态 ⇒ 无副作用返回 */
	if (t.state === toKey) {
		if (t.state === STATE.WORKING && meta.heartbeat === true) return transition(t, to, meta);
		return { ok: true, task: t, event: null, reason: "幂等：已是「" + stateOf(t.state).label + "」，不重复推进" };
	}
	/* ② blocked 必带因 */
	if (toKey === STATE.FAILED) {
		const why = (reason || (meta.note ? String(meta.note) : "")).trim();
		if (!why) return { ok: false, task: t, event: null, reason: "blocked 必带因：转「失败」必须给 meta.reason（失败不静默）" };
	}
	/* reason 兜底进 note，让 transition 把原因写进 task.error */
	const merged = (meta.note || !reason) ? meta : Object.assign({}, meta, { note: reason });
	return transition(t, to, merged);
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
 * 六、看板层（WS-B · B2：board 只读视图 + 单一写入点）
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它：
 *    上面九态机是 **A2A 执行态**（SUBMITTED/WORKING/INPUT_REQUIRED…）；
 *    看板要给人看的是 **六档结果态**（草稿/进行中/完成/部分/阻塞/中止）。
 *    两者**不是一一对应**，且看板还要带「置顶/摘要/项目根」三个 UI 字段。
 *
 *  🔴 两条铁律（贯穿 B2/B3/B4）：
 *    ① **单一写入点**：pin/summary/projectRoot/partial 一律走 `setPinned()` /
 *       `setField()` 等纯函数（返回新对象，**绝不就地改**）。
 *       UI 组件不得自己 `task.pinned = true` —— 那是纪律 126 的隐式断链。
 *    ② **看板只读 store**：`boardView()` 是**唯一**的分组拼装点。
 *       Board.js / MindMap.js 只**消费**它的返回值，不自己再 group/sort ——
 *       否则「看板分组」与「导图分组」又会各长各的。
 */

/** 看板六档结果态（人读；与九态机解耦，但由它派生） */
export const BOARD_STATE = Object.freeze({
	DRAFT: "draft",       // 待办（SUBMITTED：派了还没跑）
	RUNNING: "running",   // 进行中（WORKING 或暂停态：在跑/在等人）
	DONE: "done",         // 已完成（COMPLETED）
	PARTIAL: "partial",   // 部分完成（partial 标记：一部分分支成了一部分没成）
	BLOCKED: "blocked",   // 阻塞（FAILED：红角标）
	ABORTED: "aborted"    // 已中止（CANCELED / REJECTED）
});

/** 看板组（Board.js 的四个折叠段；与 BOARD_STATE 的对应写死在这里，UI 不另推） */
export const BOARD_GROUP = Object.freeze({
	PINNED: "pinned",     // 置顶（跨组：任何档只要 pinned 就进这里，显示在最上）
	RUNNING: "running",   // 进行中
	TODO: "todo",         // 待完成（draft）
	DONE: "done"          // 已完成（done/partial；blocked/aborted 仍归原档但带角标）
});

/**
 * 九态 → 看板六档（**唯一派生点**）。
 * 🔴 partial 优先级高于 COMPLETED：一个任务部分分支成、部分没成，
 *    就该挂「部分」而不是绿勾（否则用户以为全成了）。
 */
export function boardBucketOf(task) {
	const t = createTask(task);
	if (t.partial === true) return BOARD_STATE.PARTIAL;
	switch (t.state) {
		case STATE.COMPLETED: return BOARD_STATE.DONE;
		case STATE.FAILED: return BOARD_STATE.BLOCKED;
		case STATE.CANCELED:
		case STATE.REJECTED: return BOARD_STATE.ABORTED;
		case STATE.WORKING:
		case STATE.INPUT_REQUIRED:
		case STATE.AUTH_REQUIRED: return BOARD_STATE.RUNNING;
		case STATE.SUBMITTED:
		default: return BOARD_STATE.DRAFT;
	}
}

/** 看板组归位（pinned 单独抽出；其余按六档映射到四个折叠段） */
export function boardGroupOf(task) {
	const t = createTask(task);
	if (t.pinned === true) return BOARD_GROUP.PINNED;
	const bucket = boardBucketOf(t);
	if (bucket === BOARD_STATE.RUNNING) return BOARD_GROUP.RUNNING;
	if (bucket === BOARD_STATE.DRAFT) return BOARD_GROUP.TODO;
	return BOARD_GROUP.DONE; // done / partial / blocked / aborted 都进「已完成」段（带角标）
}

/**
 * 单一写入点：改任务的任意可选字段（pin/summary/projectRoot/partial）。
 * 🔴 返回**新对象**，不改入参（与 `transition` 同范式：可快照可撤销）。
 * 只允许改这四个白名单字段，其余字段不许借这个口子写（纪律 126）。
 */
export function setField(task, patch = {}) {
	const t = createTask(task);
	const p = (patch && typeof patch === "object") ? patch : {};
	const next = { ...t, transitions: t.transitions.slice() };
	if (Object.prototype.hasOwnProperty.call(p, "pinned")) next.pinned = Boolean(p.pinned);
	if (Object.prototype.hasOwnProperty.call(p, "summary")) next.summary = p.summary == null ? "" : String(p.summary);
	if (Object.prototype.hasOwnProperty.call(p, "projectRoot")) next.projectRoot = p.projectRoot == null ? "" : String(p.projectRoot);
	if (Object.prototype.hasOwnProperty.call(p, "partial")) next.partial = Boolean(p.partial);
	return next;
}

/** 单一写入点：置顶开关（语义糖，走 setField） */
export function setPinned(task, pinned) {
	return setField(task, { pinned: pinned });
}

/**
 * 看板只读视图（**唯一分组拼装点**）。
 * Board.js / MindMap.js 只消费它，不自己 group/sort。
 *
 * @param {Array} tasks
 * @returns {{pinned:Array, running:Array, todo:Array, done:Array,
 *            counts:Object, total:number}}  每元素 = taskSummary + bucket/group
 */
export function boardView(tasks) {
	const all = Array.isArray(tasks) ? tasks : [];
	const out = {
		[BOARD_GROUP.PINNED]: [],
		[BOARD_GROUP.RUNNING]: [],
		[BOARD_GROUP.TODO]: [],
		[BOARD_GROUP.DONE]: []
	};
	const counts = { pinned: 0, running: 0, todo: 0, done: 0, blocked: 0, aborted: 0, partial: 0 };
	for (const raw of all) {
		const t = createTask(raw);
		const bucket = boardBucketOf(t);
		const grp = boardGroupOf(t);
		counts[bucket] = (counts[bucket] || 0) + 1;
		counts[grp] = (counts[grp] || 0) + 1;
		out[grp].push({
			id: t.id,
			title: t.title,
			sessionId: t.sessionId,
			state: t.state,
			bucket: bucket,
			pinned: t.pinned === true,
			partial: t.partial === true,
			summary: t.summary || "",
			projectRoot: t.projectRoot || "",
			updatedAt: t.updatedAt
		});
	}
	/* 组内排序：置顶/进行中按 updatedAt 倒序（新的在前）；已完成同 */
	for (const k of Object.keys(out)) {
		out[k].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
	}
	return {
		pinned: out[BOARD_GROUP.PINNED],
		running: out[BOARD_GROUP.RUNNING],
		todo: out[BOARD_GROUP.TODO],
		done: out[BOARD_GROUP.DONE],
		counts: counts,
		total: all.length
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 七、导图节点 ↔ 看板同源（WS-B · B4：导图任务态语义与看板同一真相源）
 * ══════════════════════════════════════════════════════════════════
 *  导图节点上的 `dispatchState`（来自 store/dispatch-log.js#applyDispatchLabels）
 *  与看板六档不是同一份字符串：导图用 running/done/failed/blank/partial，
 *  看板用 draft/running/done/blocked/partial/aborted。
 *  这个翻译必须只有一处（纪律 126），否则导图和看板又各长各的。
 */

/** 导图 dispatchState → 看板六档（唯一翻译点；B4 同源渲染的真相源） */
export function boardBucketOfNode(node) {
	const n = (node && typeof node === "object") ? node : {};
	const ds = String(n.dispatchState || "").toLowerCase();
	if (ds === "done" || ds === "completed" || ds === "success") return BOARD_STATE.DONE;
	if (ds === "partial") return BOARD_STATE.PARTIAL;
	if (ds === "failed" || ds === "error" || ds === "blocked") return BOARD_STATE.BLOCKED;
	if (ds === "running" || ds === "working" || ds === "submitted") return BOARD_STATE.RUNNING;
	if (ds === "aborted" || ds === "canceled" || ds === "cancelled") return BOARD_STATE.ABORTED;
	return BOARD_STATE.DRAFT;
}

/** 导图节点视觉（icon + 颜色；与 Board.js 同语义，B4 同源） */
export function boardVisualOfNode(node) {
	const bucket = boardBucketOfNode(node);
	const n = (node && typeof node === "object") ? node : {};
	const pinned = n.pinned === true;
	const V = {
		done: { icon: "\u2713", color: "#2e7d32" },
		running: { icon: "\u25b6", color: "#1565c0" },
		draft: { icon: "\u2610", color: "#8a8a8a" },
		partial: { icon: "\u25d0", color: "#ef6c00" },
		blocked: { icon: "\u26a0", color: "#c62828" },
		aborted: { icon: "\u2298", color: "#6b6b6b" }
	};
	const v = V[bucket] || V.draft;
	return { bucket: bucket, icon: pinned ? "\u2b50" : v.icon, color: pinned ? "#f9a825" : v.color, pinned: pinned };
}
/* ══════════════════════════════════════════════════════════════════
 * 五、全局契约
 * ══════════════════════════════════════════════════════════════════ */

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
/** 分支行（mindmap-schema#stateOfRow：running/review/done/idle）→ 看板任务（唯一适配器）。
 *  主键挂会话 id（row.sessionId）；UI 不许再各自造 task。
 *
 *  🔴 WS-C · C1（G1「结果」采集通道）：L1 回收产出经 `dispatch-log#applyDispatchLabels`
 *     落到 `row.dispatchSay`（唯一来源 = `it.say`，真读到的助手正文摘要）。
 *     本适配器把它**经单一写入点 `setField` 写进 task.summary** —— 不另造字段、不另开 store
 *     （纪律 126）。没有 `dispatchSay` 的行 summary 保持 ""（"没结果"是缺席，不是未知）。 */
export function boardTasksFromRows(rows) {
	const arr = Array.isArray(rows) ? rows : [];
	return arr.map((r) => {
		const row = r || {};
		const sid = row.sessionId != null ? String(row.sessionId) : (row.id != null ? String(row.id) : "");
		let st = STATE.SUBMITTED;
		if (row.state === "running" || row.running === true) st = STATE.WORKING;
		else if (row.state === "review" || row.pending === true) st = STATE.INPUT_REQUIRED;
		else if (row.state === "done" || row.completed === true) st = STATE.COMPLETED;
		const base = { id: sid, sessionId: sid, title: row.title || row.displayTitle || sid || "(未命名)", state: st, pinned: row.pinned === true, updatedAt: row.updatedAt || 0 };
		const summary = String(row.dispatchSay || "");
		/* 🔴 经单一写入点写 summary（即使为空也走同一口子，保持"唯一写入点"承诺） */
		return setField(base, { summary: summary });
	});
}
export function installTaskStateApi() {
	if (typeof window === "undefined") return null;
	window.__dshTaskState = {
		STATE, GROUP, STATES, TRANSITIONS,
		stateOf, isTerminal, isPaused,
		canTransition, transitionTable,
		createTask, transition, advance, timeline, taskSummary, groupTasks,
		auditMachine,
		/* 看板层（B2） */
		BOARD_STATE, BOARD_GROUP, boardBucketOf, boardGroupOf,
		setField, setPinned, boardView, boardBucketOfNode, boardVisualOfNode, boardTasksFromRows
	};
	return window.__dshTaskState;
}
