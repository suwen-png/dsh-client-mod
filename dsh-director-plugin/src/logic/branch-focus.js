/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：分支链路聚焦（纯函数）
 * 引用：—
 * 上游：client-entry.js, components/MindMap.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/branch-focus.js — 分支链路聚焦（纯函数）
 *
 * ── 需求（用户原话）─────────────────────────────────────────────
 *   「对话会存在分支。我点击对话，那么只默认显示这个分支的链路，
 *     然后可以选是否包含上一层，如果有下一层可以往下一层走。
 *     比如对话 1,2,3,4,5 每个对话分支 a,b,c；
 *     我在 1 的 a 点击思维导图，那么就是进入整个 1 的上下游分支；
 *     然后点击上一层才是 1,2,3,4,5 全显示。」
 *
 * ── 语义拆解（三种集合，别混）────────────────────────────────
 *   `upstreamChain`  祖先链（**不含自身**，从根到直接父）—— 即用户说的"上一层"
 *   `downstreamIds`  自身 + **全部后代** —— 即用户说的"往下一层走"（可继续下钻）
 *   `focusRows`      最终可见行 = 下游 ∪ （可选）上游，**保持原行序**
 *
 * ── 为什么是纯函数 ──────────────────────────────────────────────
 *   导图渲染依赖 DOM 几何，`verify-mindmap` 只能真机跑（慢）。
 *   把判定逻辑抽成纯函数 ⇒ `test-branch-focus.mjs` 可离线穷举边界
 *   （空 id / 环 / 孤儿父 / 兄弟不在链上），真机只负责"接没接上"。
 *
 * ── 边界（每条都有离线样本）──────────────────────────────────
 *   · `sessionId` 为空或不在 rows 内 → **返回全部行**（不聚焦，而不是返回空 ——
 *     返回空会让导图突然变白，属"看起来像坏了"）
 *   · 环（a→b→a）→ 用 seen 集截断，不无限循环
 *   · 父不在 rows（父会话被删）→ 祖先链止于此，**不报错**
 *   · 兄弟会话（同父不同枝）→ **不属于**上下游，不含在内
 */

/** sessionId → 行 的索引 */
export function indexById(rows) {
	const m = new Map();
	for (const r of rows || []) if (r && r.sessionId) m.set(r.sessionId, r);
	return m;
}

/**
 * 祖先链（**不含自身**），从根 → 直接父排序。
 * @param {Array<{sessionId:string,parentSessionId?:string}>} rows
 * @param {string} sessionId
 * @returns {Array} 祖先行（远 → 近）
 */
export function upstreamChain(rows, sessionId) {
	const byId = indexById(rows);
	const out = [];
	const seen = new Set([sessionId]);
	let cur = byId.get(sessionId);
	while (cur && cur.parentSessionId && byId.has(cur.parentSessionId) && !seen.has(cur.parentSessionId)) {
		const pid = cur.parentSessionId;
		seen.add(pid);
		cur = byId.get(pid);
		out.unshift(cur);
	}
	return out;
}

/**
 * 自身 + 全部后代（不含祖先、不含兄弟）。
 * @returns {Set<string>}
 */
export function downstreamIds(rows, sessionId) {
	const kids = new Map();
	for (const r of rows || []) {
		if (!r || !r.parentSessionId) continue;
		const arr = kids.get(r.parentSessionId) || [];
		arr.push(r.sessionId);
		kids.set(r.parentSessionId, arr);
	}
	const out = new Set();
	const stack = [sessionId];
	while (stack.length) {
		const id = stack.pop();
		if (out.has(id)) continue; // 环保护
		out.add(id);
		for (const k of kids.get(id) || []) stack.push(k);
	}
	return out;
}

/**
 * 同级节点（同一个父下的**其他**会话）。
 *
 * 🔴 为什么需要它 —— 用户原话的语义修正：
 *   最初把「含上一层」实现成「并入祖先链」，但用户的例子否掉了它：
 *   「对话 1,2,3,4,5 每个对话分支 a,b,c；我在 1 的 a 点击…然后点击上一层才是 1,2,3,4,5 全显示」
 *   —— 1..5 是**根**，a 是 1 的子。并入祖先链只会得到 `1, a`，
 *   **得不到 2,3,4,5**。用户要的是「上**一层**」＝那一层的**全景**。
 *   ⇒ 「含上一层」= 祖先链 ∪ 链上每一环的同级节点。
 */
export function siblingIds(rows, sessionId) {
	const byId = indexById(rows);
	const self = byId.get(sessionId);
	if (!self) return [];
	const key = self.parentSessionId || "";
	const out = [];
	for (const r of rows || []) {
		if (!r || r.sessionId === sessionId) continue;
		if ((r.parentSessionId || "") === key) out.push(r.sessionId);
	}
	return out;
}

/**
 * 「上一层」全景 = **祖先链** ∪ 链上每一环的同级。
 *
 * 🔴 语义由用户例子逐字校准（两处都踩过）：
 *   例子：「对话 1,2,3,4,5 每个对话分支 a,b,c；我在 1 的 a 点击思维导图
 *          那么就是进入整个 1 的上下游分支；然后点击上一层才是 1,2,3,4,5 全显示。」
 *   ① 第一版实现成「并入祖先链」—— 点 a 只得 `1, a`，**拿不到 2,3,4,5** ⇒ 错；
 *   ② 第二版对「自身 + 祖先」都取同级 —— 会把 `1-b, 1-c` 也拉进来，
 *      与用户列的「1,2,3,4,5」不符 ⇒ 过宽；
 *   ③ 现版：只对**祖先链**取同级；祖先链为空（点的就是根）时，取**自身所在层**的同级。
 *      ⇒ 点 a（子在 1 下）→ 上一层 = {1, 2,3,4,5}；
 *      ⇒ 点 1（就是根）→ 上一层 = {2,3,4,5}，与 1 的分支合并即"全显示"。
 *
 * @returns {string[]} 不含自身
 */
export function upstreamPanorama(rows, sessionId) {
	const byId = indexById(rows);
	const anc = upstreamChain(rows, sessionId);
	const self = byId.get(sessionId);
	// 祖先链为空 = 点的就是根 ⇒ 用自身所在层去找同级
	const chain = anc.length ? anc : (self ? [self] : []);
	const out = new Set(anc.map((r) => r.sessionId));
	for (const a of chain) for (const s of siblingIds(rows, a.sessionId)) out.add(s);
	out.delete(sessionId);
	return [...out];
}

/**
 * 聚焦后的可见行。
 *
 * 可见 = **祖先链**（默认就含 —— 用户说点 a 要看到「整个 1 的上下游分支」，
 *        所以 1 必须在场）∪ **自身 + 全部后代** ∪ （`includeParents` 时）**上一层全景**
 *
 * @param {Array} rows `buildBranchTree().rows`
 * @param {string} sessionId 被点击的会话
 * @param {{includeParents?:boolean}} [opts]
 * @returns {{rows:Array, applied:boolean, stats:{self:number,up:number,down:number,total:number}}}
 *   `applied=false` 表示"没聚焦"（入参不合法 ⇒ 返回全量，调用方据此不显示聚焦开关）
 */
export function focusRows(rows, sessionId, opts = {}) {
	const all = Array.isArray(rows) ? rows : [];
	const byId = indexById(all);
	const fallback = { rows: all, applied: false, stats: { self: 0, up: 0, down: 0, total: all.length } };
	if (!sessionId || !byId.has(sessionId)) return fallback;

	const down = downstreamIds(all, sessionId);
	const anc = upstreamChain(all, sessionId).map((r) => r.sessionId);
	const extra = opts.includeParents ? upstreamPanorama(all, sessionId) : [];
	const upSet = new Set([...anc, ...extra]);
	const keep = new Set([...down, ...upSet]);
	return {
		rows: all.filter((r) => keep.has(r.sessionId)),
		applied: true,
		stats: {
			self: 1,
			up: upSet.size,
			down: down.size - 1, // 不含自身
			total: keep.size
		}
	};
}

/**
 * 某会话是否有**可下钻**的下一层（导图据此决定「下钻」是否可用）。
 */
export function hasDownstream(rows, sessionId) {
	const byId = indexById(rows);
	for (const r of rows || []) if (r && r.parentSessionId === sessionId && byId.has(r.sessionId)) return true;
	return false;
}

/** 安装全局契约（供真机脚本调用） */
export function installBranchFocusApi() {
	if (typeof window === "undefined") return null;
	const api = { indexById, upstreamChain, downstreamIds, siblingIds, upstreamPanorama, focusRows, hasDownstream };
	window.__dshBranchFocus = api;
	return api;
}
