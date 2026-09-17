/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：分流标签索引
 * 引用：—
 * 上游：components/DirectorDialog.js, components/DirectorPage.js, logic/branch-tree.js, logic/director-dispatch.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/split-index.js — 分流标签索引
 *
 * ═══════════════════════════════════════════════════════════════════
 * 🔴 为什么必须有这个模块（不这样做就**看不见**分流）
 * ───────────────────────────────────────────────────────────────────
 *  分流落地是「宿主 `sessions.create()` 建空白会话」。空白会话的标题由**宿主**决定
 *  （`normalizeSummary` 读 `raw.title || raw.displayTitle || sessionLabel(id)`）。
 *
 *  🔴 **第十九轮实测更正**（原文写的是"宿主没有 rename，rename 只存在于会话实体、插件拿不到"）：
 *     · 事实①：`sessions.rename({sessionId,title})` 这个 **RPC 确实存在**
 *       （宿主 `api.sessions` 成员表：`attachment/cancel/create/fork/history/list/models/prompt/rename/search/selectModel/updateQueue`）。
 *     · 事实②：**插件拿得到会话实体** —— `scopedConversationOf(id).scopedSession()` 就是它，
 *       `probeSessionIo` 正是靠这个实体读 `history()` 的。所以"拿不到那个实体"**不成立**。
 *     ⇒ 原文的结论（"只能插件侧覆盖"）**在能力判断上是错的**。
 *     ⇒ 但**当前实现仍走插件侧覆盖**，这是**已知的待改项**，不是"宿主做不到"：
 *       应改为**优先调 `rename`**（宿主侧生效，用户在宿主自己的列表/搜索里也能认出），
 *       失败再回落插件侧覆盖且降级可见。见 `docs/00-统筹入口/14-…20260916.md` §八 8.2。
 *       🔴 未完成前**不许**把这一段读成"已按宿主能力做过了"。
 *
 *  ⇒ 后果（若不补偿）：一次分出 8 条线，导图上 8 个节点**标题一模一样**，
 *     用户说的「思维导图应该能看出来」**完全落空** —— 而且因为是"建成功了"，
 *     不会报任何错（假成功）。
 *
 *  ⇒ 处置：插件侧留一份 `会话 id → 维度标签` 的索引，在**血缘树刷新那一刻**
 *     覆盖显示标题，并打上 `titleOrigin = "plugin:split"`（**覆盖必须可追**，
 *     不许无声改标题 —— 这是纪律 19「降级可以，无声不行」的同型要求）。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 契约
 * ═══════════════════════════════════════════════════════════════════
 *  · 持久化键 `dsh.director.split` —— 在**冻结命名空间** `dsh.director` 之内
 *    （R5 只冻结"既有键不得改名"，**新增是允许的**；命名空间越界由闸门 `cdp-click-dialog` R5c 拦）
 *  · 只存**能显示**的条目：`label` 为空的条目直接丢弃（留空壳 = 导图上多一个无名节点）
 *  · 容量上限 `SPLIT_MAX`（按 `at` 保新）—— 防长期使用把 localStorage 撑爆
 *  · `applySplitLabels()` 是**就地覆盖**（有意）：tree 每次 `refreshBranchTree()` 重建，
 *    不存在"改到陈旧的树"；且**只改显示字段**，宿主真值（running/blank/updatedAt）一个不动
 */

/** 持久化键（命名空间 `dsh.director` 内；**不可改名**） */
export const SPLIT_INDEX_KEY = "dsh.director.split";

/** 条目上限（按 `at` 保新裁掉多余）—— localStorage 是全站共享预算，不能无界增长 */
export const SPLIT_MAX = 200;

/** 标题来源标记：读者的"这个标题是谁给的"判据 */
export const SPLIT_TITLE_ORIGIN = "plugin:split";

let mem = null;

function storage() {
	try { return typeof localStorage === "undefined" ? null : localStorage; } catch (e) { return null; }
}

/** 归一化一条索引项；不可显示的返回 null（调用方据此丢弃） */
function normalizeEntry(raw) {
	if (!raw || typeof raw !== "object") return null;
	const label = String(raw.label == null ? "" : raw.label).trim();
	if (!label) return null;
	return {
		dim: String(raw.dim == null ? "" : raw.dim),
		label,
		name: String(raw.name == null ? "" : raw.name),
		at: Number.isFinite(Number(raw.at)) ? Number(raw.at) : 0
	};
}

/**
 * 读全量索引（带内存缓存）。**脏数据逐条丢弃**，绝不整体抛错
 * （一条坏记录把整份索引清空 = 所有分流标签一起消失，比"少一条"糟得多）。
 * @returns {Object<string, {dim:string,label:string,name:string,at:number}>}
 */
export function readSplitIndex() {
	if (mem) return mem;
	const s = storage();
	if (!s) { mem = {}; return mem; }
	try {
		const raw = s.getItem(SPLIT_INDEX_KEY);
		const obj = raw ? JSON.parse(raw) : null;
		const items = obj && obj.items && typeof obj.items === "object" ? obj.items : {};
		const out = {};
		for (const k of Object.keys(items)) {
			if (!k) continue;
			const e = normalizeEntry(items[k]);
			if (e) out[k] = e;
		}
		mem = out;
	} catch (e) { mem = {}; }
	return mem;
}

/** 写全量索引（裁剪到 `SPLIT_MAX`；写失败不抛 —— 隐私模式下退化为"本次会话内有效"） */
export function writeSplitIndex(map) {
	const src = map && typeof map === "object" ? map : {};
	const keys = Object.keys(src).filter((k) => src[k] && src[k].label);
	keys.sort((a, b) => (src[b].at || 0) - (src[a].at || 0));
	const keep = {};
	for (const k of keys.slice(0, SPLIT_MAX)) keep[k] = src[k];
	mem = keep;
	const s = storage();
	if (s) {
		try { s.setItem(SPLIT_INDEX_KEY, JSON.stringify({ v: 1, items: keep })); } catch (e) { /* 隐私模式 / 超预算：内存内仍生效 */ }
	}
	return Object.keys(keep).length;
}

/**
 * 登记若干条分流标签（分流动作逐条落地时调用）。
 * @param {Array<{sessionId:string, dim?:string, label:string, name?:string}>} entries
 * @returns {number} 真正写入的条数（`label` 为空 / 无 id 的不计）
 */
export function recordSplits(entries) {
	const arr = Array.isArray(entries) ? entries : [];
	const cur = { ...readSplitIndex() };
	const now = Date.now();
	let n = 0;
	for (const e of arr) {
		if (!e || !e.sessionId) continue;
		const norm = normalizeEntry({ dim: e.dim, label: e.label, name: e.name, at: now });
		if (!norm) continue;
		cur[String(e.sessionId)] = norm;
		n += 1;
	}
	if (n) writeSplitIndex(cur);
	return n;
}

/** 忘掉若干条（清空对话消息 / 分支被删时用；不存在的 id 静默跳过并计入 `missed`） */
export function forgetSplits(ids) {
	const arr = Array.isArray(ids) ? ids : [];
	const cur = { ...readSplitIndex() };
	let removed = 0, missed = 0;
	for (const id of arr) {
		const k = String(id == null ? "" : id);
		if (!k) continue;
		if (cur[k]) { delete cur[k]; removed += 1; } else missed += 1;
	}
	if (removed) writeSplitIndex(cur);
	return { removed, missed };
}

/** 清空整份索引（返回被清掉的条数，供调用方如实汇报） */
export function clearSplitIndex() {
	const n = Object.keys(readSplitIndex()).length;
	writeSplitIndex({});
	return n;
}

/** 取单条 */
export function splitEntryOf(sessionId) {
	const k = String(sessionId == null ? "" : sessionId);
	if (!k) return null;
	return readSplitIndex()[k] || null;
}

/**
 * 把分流标签**覆盖到血缘树上**（就地改显示字段）。
 *
 * 🔴 只覆盖 `title` 与新增的 `splitDim` / `titleOrigin`：
 *    宿主真值（`running` / `blank` / `updatedAt` / `parentSessionId` …）**一个不动** ——
 *    否则"导图说在跑、总监页说没跑"这类双口径问题会立刻出现。
 * 🔴 `applied` **只数 rows**（不把 byId 那份算进去）：同一个会话在 rows 与 byId 里
 *    是**两个对象**，两边都数会让读数翻倍，而闸门会拿它当真值断言。
 *
 * @param {{rows?:Array, byId?:Object}} tree `refreshBranchTree()` 产出的树
 * @param {Object} [index] 省略则读当前索引
 * @returns {{applied:number, dims:string[]}} 覆盖条数 + 覆盖到的维度 key（去重、稳定序）
 */
export function applySplitLabels(tree, index) {
	const idx = index && typeof index === "object" ? index : readSplitIndex();
	if (!tree) return { applied: 0, dims: [] };
	const byId = tree.byId && typeof tree.byId === "object" ? tree.byId : {};
	let applied = 0;
	const dims = [];
	const patch = (row, countIt) => {
		if (!row || !row.sessionId) return;
		const hit = idx[String(row.sessionId)];
		if (!hit) return;
		row.title = hit.label;
		row.splitDim = hit.dim;
		row.titleOrigin = SPLIT_TITLE_ORIGIN;
		if (countIt) { applied += 1; if (hit.dim && dims.indexOf(hit.dim) < 0) dims.push(hit.dim); }
	};
	(Array.isArray(tree.rows) ? tree.rows : []).forEach((r) => patch(r, true));
	Object.keys(byId).forEach((k) => patch(byId[k], false));
	return { applied, dims };
}
