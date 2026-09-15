/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：不可变快照链
 * 引用：—
 * 上游：client-entry.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 七（不可变快照链 · 分叉保主干 · 断点重放）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/checkpoint.js — 不可变快照链
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它
 * ══════════════════════════════════════════════════════════════════
 *  ① **断点续跑**：agency-orchestrator 的 `--resume last` 只重跑失败的步骤，
 *     并把每轮输出存进独立目录、**所有版本都保留**。
 *  ② **时间旅行 / Fork**：LangGraph 的结论是「可以从旧 checkpoint 分叉出
 *     新分支，原历史保留」。这对应到一个很具体的用户动作 ——
 *     「回到第 3 步，改一下那个输入，重新往下跑」，且**旧的不要丢**。
 *
 *  ⇒ 本文件是那条链的纯函数实现：**追加即新建，绝不就地改**。
 *
 * ══════════════════════════════════════════════════════════════════
 *  两条来自上游的工程教训（照抄，因为它们是踩出来的）
 * ══════════════════════════════════════════════════════════════════
 *   ① **只能在「回合边界」建恢复点**：LangGraph 的 checkpoint 存的是
 *      super-step 边界，同一 step 内各节点的中间写入**不可**作为
 *      time-travel 起点。故本文件只提供 `append()`，且调用方约定在
 *      **一波（wave）跑完**时调用 —— 不在波次中间建点。
 *   ② **Replay 会真的重跑有副作用的操作**：官方论坛的警告原话是
 *      「replay to debug 可能重复扣一次信用卡」。故本文件要求每个步骤
 *      显式声明 `idempotent`；重放时**非幂等步骤默认跳过**（读记录，不重跑），
 *      除非调用方显式 `force:true`。
 *
 * ⚠️ 本文件**零 import**（同规，便于离线单测）。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、链与快照
 * ══════════════════════════════════════════════════════════════════ */

/** 快照原因（写清楚「为什么在这里存一个点」） */
export const REASON = Object.freeze({
	WAVE: "wave",           // 一波跑完（默认粒度）
	GATE: "gate",           // 人工闸门停住
	FAILURE: "failure",     // 失败
	MANUAL: "manual",       // 用户手动存
	FORK: "fork"            // 分叉点
});

/** 新建一条链 */
export function createChain(threadId = "") {
	return { threadId: String(threadId), nodes: [], nextSeq: 1 };
}

/**
 * 追加一个快照（**返回新链**，原链不变）。
 *
 * @param {object} chain
 * @param {object} p
 *   { snapshot:object, done:string[], reason?:string, at?:number,
 *     nonIdempotent?:string[], note?:string, branchOf?:number }
 * @returns {{ok:boolean, chain:object, node:object|null, reason:string}}
 */
export function append(chain, p = {}) {
	const c = chain && typeof chain === "object" && Array.isArray(chain.nodes) ? chain : createChain();
	if (!p || typeof p !== "object") return { ok: false, chain: c, node: null, reason: "缺少快照内容" };

	const done = Array.isArray(p.done) ? p.done.map(String) : [];
	const node = {
		seq: c.nextSeq,
		parentSeq: c.nodes.length ? c.nodes[c.nodes.length - 1].seq : 0,
		at: Number.isFinite(p.at) ? p.at : Date.now(),
		reason: Object.values(REASON).includes(p.reason) ? p.reason : REASON.WAVE,
		done,
		snapshot: p.snapshot && typeof p.snapshot === "object" ? shallowCopy(p.snapshot) : {},
		nonIdempotent: Array.isArray(p.nonIdempotent) ? p.nonIdempotent.map(String) : [],
		note: p.note ? String(p.note) : "",
		branchOf: Number.isFinite(p.branchOf) ? Number(p.branchOf) : 0,
		branch: c.nodes.filter((n) => n.branchOf === (Number.isFinite(p.branchOf) ? Number(p.branchOf) : 0)).length + 1
	};

	return {
		ok: true,
		chain: { threadId: c.threadId, nodes: c.nodes.concat(node), nextSeq: c.nextSeq + 1 },
		node,
		reason: "已存 seq=" + node.seq + "（" + node.reason + "，完成 " + done.length + " 步）"
	};
}

function shallowCopy(o) {
	const out = {};
	for (const [k, v] of Object.entries(o)) {
		out[k] = Array.isArray(v) ? v.slice() : (v && typeof v === "object" ? { ...v } : v);
	}
	return out;
}

/**
 * 从某个快照**分叉**（Fork）：原链保留，返回一条带新分支标记的新链。
 *
 * 用途 = 「回到第 3 步，改一下输入，重新往下跑」。原历史**不删**，
 * 便于对照「改了之后到底有没有变好」。
 *
 * @param {object} chain
 * @param {number} fromSeq 分叉点的 seq
 * @param {object} [p] { snapshot?:object, note?:string, at?:number }
 * @returns {{ok:boolean, chain:object, node:object|null, reason:string}}
 */
export function fork(chain, fromSeq, p = {}) {
	const c = chain && Array.isArray(chain.nodes) ? chain : createChain();
	const base = c.nodes.find((n) => n.seq === Number(fromSeq));
	if (!base) return { ok: false, chain: c, node: null, reason: "分叉点不存在：seq=" + fromSeq };

	/* 新分支从分叉点之后**砍掉**，再把分叉点本身作为新分支的起点 */
	const kept = c.nodes.filter((n) => n.seq <= base.seq);
	const forked = {
		threadId: c.threadId,
		nodes: kept,
		nextSeq: c.nextSeq
	};
	return append(forked, {
		snapshot: p.snapshot || base.snapshot,
		done: base.done,
		reason: REASON.FORK,
		branchOf: base.seq,
		note: p.note ? String(p.note) : ("从 seq=" + base.seq + " 分叉"),
		at: p.at,
		nonIdempotent: base.nonIdempotent
	});
}

/** 分支列表（同一分叉点下的多条尝试） */
export function branches(chain) {
	const c = chain && Array.isArray(chain.nodes) ? chain : createChain();
	return c.nodes
		.filter((n) => n.reason === REASON.FORK)
		.map((n) => ({ seq: n.seq, from: n.branchOf, branch: n.branch, at: n.at, note: n.note }));
}

/** 取某代的快照（不存在返回 null，不抛错） */
export function at(chain, seq) {
	const c = chain && Array.isArray(chain.nodes) ? chain : createChain();
	return c.nodes.find((n) => n.seq === Number(seq)) || null;
}

/** 最新快照 */
export function latest(chain) {
	const c = chain && Array.isArray(chain.nodes) ? chain : createChain();
	return c.nodes.length ? c.nodes[c.nodes.length - 1] : null;
}

/** 版本清单（UI 直接渲染） */
export function listVersions(chain) {
	const c = chain && Array.isArray(chain.nodes) ? chain : createChain();
	return c.nodes.map((n) => ({
		seq: n.seq,
		at: n.at,
		reason: n.reason,
		steps: n.done.length,
		branch: n.branch,
		branchOf: n.branchOf,
		note: n.note,
		/* 分支点标出来：界面上它是"你从这里改过一次" */
		isFork: n.reason === REASON.FORK
	}));
}

/* ══════════════════════════════════════════════════════════════════
 * 二、重放计划（断点续跑）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 生成重放计划。
 *
 * 🔴 语义（`--resume last` 的口径）：**已完成的默认不重跑**，只执行没完成的。
 *    改这一版之前它是反的 —— 已完成的会被塞进 `from` 一起重跑，
 *    于是「断点续跑」退化成「从头再来一遍」，只是恰好结果一样所以没人发现。
 *
 * 🔴 `idempotent: false` 的步骤若已完成，**跳过并告警** —— 官方警告的
 *    「重复扣一次信用卡」就是这个坑。要重跑必须显式 `force` 或列进 `forceSteps`。
 *
 * @param {object} chain
 * @param {string[]} allSteps 全部步骤 id（顺序即执行顺序）
 * @param {object} [opts] { fromSeq?, nonIdempotent?, force?, forceSteps? }
 * @returns {{ok:boolean, from:string[], skip:string[], warnings:string[], reason:string}}
 */
export function replayPlan(chain, allSteps, opts = {}) {
	const c = chain && Array.isArray(chain.nodes) ? chain : createChain();
	const steps = (Array.isArray(allSteps) ? allSteps : []).map(String);
	const node = opts.fromSeq != null ? at(c, opts.fromSeq) : latest(c);
	const warnings = [];

	if (!node) {
		return { ok: true, from: steps.slice(), skip: [], warnings: ["无快照 → 全量执行"], reason: "首次运行" };
	}

	const done = new Set(node.done);
	const risky = new Set((Array.isArray(opts.nonIdempotent) ? opts.nonIdempotent : node.nonIdempotent).map(String));
	const forceSteps = new Set(Array.isArray(opts.forceSteps) ? opts.forceSteps.map(String) : []);

	const from = [];
	const skip = [];
	for (const s of steps) {
		const forced = Boolean(opts.force) || forceSteps.has(s);
		/* 未完成 ⇒ 必须跑 */
		if (!done.has(s)) { from.push(s); continue; }
		/* 已完成 ⇒ 默认跳过 */
		if (forced) { from.push(s); continue; }
		skip.push(s);
		if (risky.has(s)) {
			warnings.push(s + " 已完成且标记为非幂等 → 不重跑（读记录，避免重复副作用）。要重跑请显式 force");
		}
	}

	return {
		ok: true,
		from, skip, warnings,
		reason: "从 seq=" + node.seq + " 续跑：待执行 " + from.length + " 步，跳过 " + skip.length + " 步"
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 三、差异（对照"改了之后到底有没有变好"）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 两个快照的浅层差异。
 * 🔴 只做浅层（一层）比较并**明确标注深度**，不做深递归 ——
 *    深 diff 在两个大对象上会产出用户读不完的噪声，
 *    而这里要回答的问题只有一个：「这一改，动了什么」。
 *
 * @returns {{same:boolean, changed:Array<{key:string, from:any, to:any}>, added:string[], removed:string[], depth:string}}
 */
export function diff(chain, seqA, seqB) {
	const a = at(chain, seqA);
	const b = at(chain, seqB);
	if (!a || !b) return { same: false, changed: [], added: [], removed: [], depth: "shallow", error: "快照不存在" };

	const sa = a.snapshot || {};
	const sb = b.snapshot || {};
	const changed = [];
	const added = [];
	const removed = [];

	for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
		const hasA = Object.prototype.hasOwnProperty.call(sa, k);
		const hasB = Object.prototype.hasOwnProperty.call(sb, k);
		if (!hasA) { added.push(k); continue; }
		if (!hasB) { removed.push(k); continue; }
		if (JSON.stringify(sa[k]) !== JSON.stringify(sb[k])) changed.push({ key: k, from: sa[k], to: sb[k] });
	}
	return { same: !changed.length && !added.length && !removed.length, changed, added, removed, depth: "shallow" };
}

/* ══════════════════════════════════════════════════════════════════
 * 四、链自检（这套东西自己也要被验）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 链完整性自检。四条：
 *   ① seq 严格递增且无重复
 *   ② parentSeq 指向的快照确实存在（分叉点除外）
 *   ③ done 集合**单调不减**（后一个快照的完成集必须是前一个的超集）——
 *      违反意味着「续跑把已完成的步骤弄丢了」，是最危险的静默失败
 *   ④ 分叉点的 branchOf 指向存在的 seq
 * @returns {{ok:boolean, fails:string[]}}
 */
export function auditChain(chain) {
	const c = chain && Array.isArray(chain.nodes) ? chain : createChain();
	const fails = [];
	const seqs = new Set();

	for (let i = 0; i < c.nodes.length; i++) {
		const n = c.nodes[i];
		if (seqs.has(n.seq)) fails.push("seq 重复：" + n.seq);
		seqs.add(n.seq);
		if (i > 0 && n.seq <= c.nodes[i - 1].seq) fails.push("seq 非递增：" + c.nodes[i - 1].seq + " → " + n.seq);
		if (n.parentSeq && !seqs.has(n.parentSeq) && n.branchOf !== n.parentSeq) {
			fails.push("parentSeq 指向不存在的快照：" + n.seq + " → " + n.parentSeq);
		}
		if (n.branchOf && !seqs.has(n.branchOf)) fails.push("分叉点不存在：" + n.seq + " 的 branchOf=" + n.branchOf);

		/* ③ done 单调性（只在同一分支内比较：分叉后允许"回退"） */
		if (i > 0 && n.reason !== REASON.FORK) {
			const prev = c.nodes[i - 1];
			if (prev.reason !== REASON.FORK) {
				const prevDone = new Set(prev.done);
				const lost = n.done.filter((d) => !prevDone.has(d));
				const dropped = prev.done.filter((d) => !new Set(n.done).has(d));
				if (lost.length && dropped.length) {
					fails.push("done 集合非单调（seq " + prev.seq + " → " + n.seq + "）：新增 " + lost.join("、") + " 同时丢失 " + dropped.join("、"));
				}
			}
		}
	}
	return { ok: fails.length === 0, fails };
}

/* ══════════════════════════════════════════════════════════════════
 * 五、全局契约
 * ══════════════════════════════════════════════════════════════════ */

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installCheckpointApi() {
	if (typeof window === "undefined") return null;
	window.__dshCheckpoint = {
		REASON,
		createChain, append, fork, branches,
		at, latest, listVersions,
		replayPlan, diff, auditChain
	};
	return window.__dshCheckpoint;
}
