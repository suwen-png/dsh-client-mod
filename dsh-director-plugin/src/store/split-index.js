/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：分流标签索引
 * 引用：—
 * 上游：components/DirectorDialog.js, components/DirectorPage.js, logic/branch-tree.js, logic/director-collect.js, logic/director-dispatch.js
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
		try {
			/* 🔴 第 41 轮：**必须把 `quota` 备忘读回来一起写**，否则每次登记分流都会
			 *    静默抹掉 `T-PLUG-043` 的配额备忘（同一记录两个写者 = 隐式断链，纪律 126）。 */
			const rec = readRawRecord(s);
			const out = { v: 1, items: keep };
			if (rec && rec.quota) out.quota = rec.quota;
			s.setItem(SPLIT_INDEX_KEY, JSON.stringify(out));
		} catch (e) { /* 隐私模式 / 超预算：内存内仍生效 */ }
	}
	return Object.keys(keep).length;
}

/* ══════════════════ 第 41 轮 `T-PLUG-043`：配额备忘 ══════════════════
 * 「派发前配额预检」：模型侧 QUOTA 时仍会投出 8 条简报、8 次运行全失败。
 *
 * 🔴 为什么必须**持久化**（而不是只放内存）：
 *    `store/dispatch-log.js` 的台账是**本次运行内单例**（它的头注释写明"不落 localStorage"），
 *    而宿主会话快照里**没有**错误字段（只有 `running` / tokens，见 `session-io.js#stateOfSummary`）
 *    ⇒ 若不落盘，「上一次 `turn/end` 的 failure」在冷启动后**无从预检**。
 *
 * 🔴 为什么写在**本记录**里（不新开 key）：
 *    `dsh.director.split` 已经是"最近一次派发的产物"，配额失败属于**同一次派发的结局**
 *    ⇒ 放一起语义同源；新开 key 会多一条"要跟谁同步清理"的隐式契约。
 *
 * 🔴 为什么带 TTL：备忘**不许**把用户永久锁死。不设过期的话，充值/换模型后仍会
 *    一直拦（而拦的理由已经不成立）；设了 TTL，「上一次失败」最多影响 30 分钟，
 *    且**任何一次成功都会立刻清掉它**（见 `director-collect.js`）。
 */
export const QUOTA_MEMO_TTL_MS = 30 * 60 * 1000;

/** 读原始记录（一次 `JSON.parse`；失败 ⇒ null，绝不抛） */
function readRawRecord(s) {
	try {
		const raw = s.getItem(SPLIT_INDEX_KEY);
		const obj = raw ? JSON.parse(raw) : null;
		return obj && typeof obj === "object" ? obj : null;
	} catch (e) { return null; }
}

/**
 * 判「这次运行失败是不是配额类」（**纯函数**，供离线校准）。
 *
 * 三类判据，**任一命中即算**：
 *   · `code` 含 `QUOTA` / `INSUFFICIENT` / `BALANCE`（实测形态 `code:"QUOTA"`）；
 *   · `status === 402`（Payment Required，实测形态）；
 *   · `message` 匹配 `Insufficient Balance` / 余额 / 配额。
 * ⚠️ 判据**从宽**（false positive 的代价只是"多拦一次、提示充值"；false negative 的代价是
 *    8 条简报白投 + 用户看到 8 个失败框）。
 * @param {{code?:string, status?:number, message?:string}|null} fail
 * @returns {boolean}
 */
export function isQuotaFailure(fail) {
	if (!fail || typeof fail !== "object") return false;
	const code = String(fail.code == null ? "" : fail.code).toUpperCase();
	if (code.indexOf("QUOTA") >= 0 || code.indexOf("INSUFFICIENT") >= 0 || code.indexOf("BALANCE") >= 0) return true;
	if (Number(fail.status) === 402) return true;
	const msg = String(fail.message == null ? "" : fail.message);
	return /insufficient\s+balance|quota/i.test(msg) || msg.indexOf("余额") >= 0 || msg.indexOf("配额") >= 0;
}

/**
 * 落一份配额备忘（由观测到失败的那一处调用）。
 * @param {{code?:string,status?:number,message?:string}} fail
 * @param {number} [at]
 * @returns {object|null} 写入的备忘（无 storage ⇒ null）
 */
export function writeQuotaMemo(fail, at) {
	if (!isQuotaFailure(fail)) return null;
	const s = storage();
	if (!s) return null;
	const memo = {
		code: String(fail.code == null ? "" : fail.code),
		status: Number.isFinite(Number(fail.status)) ? Number(fail.status) : null,
		message: String(fail.message == null ? "" : fail.message),
		at: Number.isFinite(Number(at)) ? Number(at) : Date.now()
	};
	try {
		const rec = readRawRecord(s);
		const items = rec && rec.items && typeof rec.items === "object" ? rec.items : {};
		s.setItem(SPLIT_INDEX_KEY, JSON.stringify({ v: 1, items: items, quota: memo }));
	} catch (e) { return null; }
	return memo;
}

/**
 * 读配额备忘（**带 TTL**：过期 ⇒ 顺手清掉并返回 null）。
 * @param {number} [now]
 * @returns {object|null}
 */
export function readQuotaMemo(now) {
	const s = storage();
	if (!s) return null;
	const rec = readRawRecord(s);
	const q = rec && rec.quota;
	if (!q || typeof q !== "object") return null;
	const t = Number(q.at);
	const cur = Number.isFinite(Number(now)) ? Number(now) : Date.now();
	if (!Number.isFinite(t) || (cur - t) > QUOTA_MEMO_TTL_MS) { clearQuotaMemo(); return null; }
	return { code: String(q.code || ""), status: q.status == null ? null : Number(q.status), message: String(q.message || ""), at: t };
}

/** 清单条备忘（**任何一次成功都必须调它**，否则会拦到 TTL 到期） */
export function clearQuotaMemo() {
	const s = storage();
	if (!s) return false;
	try {
		const rec = readRawRecord(s);
		if (!rec || !rec.quota) return false;
		s.setItem(SPLIT_INDEX_KEY, JSON.stringify({ v: 1, items: (rec.items && typeof rec.items === "object") ? rec.items : {} }));
		return true;
	} catch (e) { return false; }
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
	/* 🔴 第 41 轮：**「清空索引」必须连配额备忘一起清**。
	 *    否则真机闸门/用户"清一下试试"之后，一条陈旧的 `quota` 仍会拦住下一次派发 ——
	 *    而界面上的分流索引看着是**空的**（读数与行为不一致 = 最坏的一类）。 */
	clearQuotaMemo();
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
