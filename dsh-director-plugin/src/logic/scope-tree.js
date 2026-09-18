/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：**作用域**（文件夹 / 项目 / 全局）与血缘树的交叉运算（纯函数）
 * 引用：—
 * 上游：components/DirectorDialog.js, components/MindMap.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/scope-tree.js — **作用域**（文件夹 / 项目 / 全局）与血缘树的交叉运算（纯函数）
 *
 * ── 为什么单开一个模块 ─────────────────────────────────────────────
 *   第 38 轮两条需求都落在"**只看这个文件夹里的东西**"上：
 *     · 需求 6 「如果文件夹的嵌套, 仅显示这个文件夹中的作用」
 *     · 需求 18「只显示当前文件夹下面的这些对话的导图 除非我点击上一级」
 *   两处若各写一遍过滤，就是纪律 126 的形态（同一语义两个标识符 ⇒ 隐式断链，
 *   且**不报错**）。故把判据收在这一份纯函数里，总监侧与导图侧**共用**。
 *
 * ── 零依赖契约 ─────────────────────────────────────────────────────
 *   本模块**不 import 任何东西**（含 store / bridge）：
 *     · 要它 Node 里能直接跑（离线闸门的前提）；
 *     · 要它不被 `store/hierarchy.js` ↔ `logic/*` 的循环牵连。
 *   故节点形状用**结构约定**而不是 import 来的常量 —— 见下方 `LEVEL_SESSION`。
 */

/** 会话级节点名（与 `store/hierarchy.js#LEVEL.SESSION` **同值**）。
 *  ⚠️ 这里写死字面量是为了保住零依赖契约；值的一致性由离线闸门 `test-scope-tree.mjs`
 *     的 `SC-1` 断言守着（它会 import store 侧常量做对拍 ⇒ 两处不等就红）。
 *     这比"import 进来"更好：import 会让本模块**依赖 store**，从而在 Node 里跑不起来。 */
const LEVEL_SESSION = "session";

/** 取节点 id（容错：不同来源的节点可能叫 id / nodeId） */
function idOf(n) { return n && (n.id || n.nodeId) ? String(n.id || n.nodeId) : ""; }

/**
 * 在树里按 id 找节点（返回节点**引用**，便于取子树）
 * @param {object|object[]} root 根节点或根数组
 * @param {string} id
 * @returns {object|null}
 */
export function findInTree(root, id) {
	const want = String(id == null ? "" : id);
	if (!want) return null;
	let found = null;
	const walk = (n) => {
		if (!n || found) return;
		if (idOf(n) === want) { found = n; return; }
		for (const c of (n.childNodes || [])) walk(c);
	};
	for (const r of (Array.isArray(root) ? root : [root])) walk(r);
	return found;
}

/**
 * 取某节点**及其子树**下的所有会话节点（DFS 前序 —— 父在子前，与渲染序一致）
 * @param {object} node
 * @returns {object[]}
 */
export function scopeSessions(node) {
	const out = [];
	const walk = (n) => {
		if (!n) return;
		if (n.level === LEVEL_SESSION) out.push(n);
		for (const c of (n.childNodes || [])) walk(c);
	};
	walk(node);
	return out;
}

/**
 * 作用域内的**真实会话 id 集合**
 *
 * 取会话节点挂载的 `conversations[].conversationId`（与宿主 sessionId 同值）。
 * ⚠️ 节点自身的 `id` **不是**宿主会话 id —— 用它去比血缘 `sessionId` 会**恒不命中**，
 *    且**不报错**（正是纪律 126 的形态）。故这里只认 `conversations[]`。
 * @param {object|object[]} root
 * @param {string} scopeId 作用域节点 id；空/找不到 ⇒ 返回 `null`（**表示"不限"**，不是"空集"）
 * @returns {Set<string>|null}
 */
export function scopeSessionIdSet(root, scopeId) {
	if (!scopeId) return null;
	const node = findInTree(root, scopeId);
	if (!node) return null;
	const set = new Set();
	for (const s of scopeSessions(node)) {
		const convs = Array.isArray(s.conversations) ? s.conversations : [];
		for (const c of convs) {
			const cid = c && (c.conversationId || c.sessionId);
			if (cid) set.add(String(cid));
		}
	}
	return set;
}

/**
 * 按作用域过滤血缘行，并**重算 depth**
 *
 * ── 这是"多层结构"的关键（用户原话：「注意多层结构的实现」）────────────
 *   不能简单地"父不在集合里就把 depth 归零"。反例（三层）：
 *     A → B → C，若集合 = {C}（只留 C），把 C 的 depth 归零是对的；
 *     但集合 = {A, C}（B 被排除）时，C 的**最近在集合内的祖先**是 A ⇒ depth 应为 1；
 *     若按"看直接父"算，C 的直接父 B 不在集合 ⇒ depth 归零 ⇒ C 与 A **同级**，
 *     画面上 C 会脱离 A 的支链，用户看到"父子关系断了"。
 *   ⇒ 故用**递归求最近保留祖先**：不命中就往上看，直到命中或到顶。
 *
 * @param {object[]} rows 血缘行（至少含 `sessionId` 与 `parentSessionId`）
 * @param {Set<string>|null} idSet 保留集合；`null` ⇒ 原样返回（"不限"，不是"全滤掉"）
 * @returns {{rows:object[], kept:number, dropped:number, depthFixed:number}}
 */
export function filterRowsByScope(rows, idSet) {
	const list = Array.isArray(rows) ? rows : [];
	if (!idSet) return { rows: list, kept: list.length, dropped: 0, depthFixed: 0 };

	const byId = new Map();
	for (const r of list) if (r && r.sessionId) byId.set(String(r.sessionId), r);

	const kept = list.filter((r) => r && r.sessionId && idSet.has(String(r.sessionId)));
	const keptIds = new Set(kept.map((r) => String(r.sessionId)));

	/**
	 * 求"**过滤后**子图里，自己上面还有几层保留祖先"（= 重算后的 depth）
	 *
	 * 🔴 这里**不能用行上原有的 `depth`**（第一版就是这么写的，被闸门 `ST-10` 抓到）：
	 *    原 depth 是**未过滤**时的层号。反例 A→B→C→D，集合 = {A,C,D}：
	 *      · C 的父 B 被滤 ⇒ 往上找到 A ⇒ C.depth = 1 ✅
	 *      · D 的父 C **保留** ⇒ 若取"C 的**原** depth（2）再 +1" ⇒ 3 ❌
	 *        正确是 **C 重算后的 depth（1）+ 1 = 2**。
	 *    ⇒ 两个分支都必须**递归**：被滤的父不增加层数，保留的父加 1。
	 *    （这也是"多层结构"与"两层结构"唯一的实质差别 —— 只测两层看不出这个错。）
	 */
	const walkUp = (r, guard) => {
		const g = guard || 0;
		if (g > 40) return 0;                       // 环 / 异常链兜底
		const pid = r && r.parentSessionId ? String(r.parentSessionId) : "";
		if (!pid) return 0;                          // 到顶 ⇒ 自己是根
		const p = byId.get(pid);
		if (!p) return 0;                            // 父不在本批数据里 ⇒ 同样视作到顶
		if (!keptIds.has(pid)) return walkUp(p, g + 1);        // 父**被滤掉** ⇒ 不增加层数
		return walkUp(p, g + 1) + 1;                            // 父**保留** ⇒ 层数 +1
	};

	let depthFixed = 0;
	const out = kept.map((r) => {
		const nd = walkUp(r, 0);
		const changed = !Number.isFinite(r.depth) || Number(r.depth) !== nd;
		if (changed) depthFixed += 1;
		return { ...r, depth: nd, scopeRoot: r.depth !== nd || !r.parentSessionId };
	});

	return { rows: out, kept: out.length, dropped: list.length - out.length, depthFixed };
}

/**
 * 概况统计（需求 5 的"快速了解"用）
 * @param {object[]} rows 血缘行
 * @returns {{total:number, roots:number, branched:number, maxDepth:number, byRoot:object[]}}
 */
export function scopeStats(rows) {
	const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.sessionId);
	const roots = list.filter((r) => !r.parentSessionId || !list.some((x) => String(x.sessionId) === String(r.parentSessionId)));
	let maxDepth = 0;
	for (const r of list) maxDepth = Math.max(maxDepth, Number.isFinite(r.depth) ? Number(r.depth) : 0);
	return {
		total: list.length,
		roots: roots.length,
		branched: list.filter((r) => list.some((x) => String(x.parentSessionId) === String(r.sessionId))).length,
		maxDepth,
		byRoot: roots.map((r) => ({
			sessionId: String(r.sessionId),
			title: String(r.title || r.sessionId),
			descendants: list.filter((x) => String(x.parentSessionId) === String(r.sessionId)).length
		}))
	};
}

/** 供离线闸门做"同值对拍"用（见模块头注的零依赖说明） */
export const __LEVEL_SESSION_FOR_TEST = LEVEL_SESSION;
