/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：会话档案（第 19 批）
 * 引用：—
 * 上游：client-entry.js, logic/branch-tree.js, logic/director-collect.js, logic/director-dispatch.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/session-dossier.js — 会话档案（第 19 批）
 *
 * ═══════════════════════════════════════════════════════════════════
 * 需求（用户原话，逐字）
 * ───────────────────────────────────────────────────────────────────
 *   「不会话都有自己的总监,存在自己的会话总结文档」
 *
 * 🔴 判为输入误打，实为「**每个会话**都有自己的总监」⇒ 落到数据结构就是**一份会话档案**：
 *      · `director` —— **自己的总监**：这条会话归哪个职能维度管（角色名 + 作品名）
 *      · `summary`  —— **自己的会话总结文档**：这条会话做了什么、产出什么
 *
 *   为什么要独立成一份档案，而不是塞进总监消息流：
 *     · 总监消息流是**一条线**（所有分支的汇报叠在一起），读不出"某条会话自己的状态"；
 *     · 用户要的是"**每个会话**存在自己的…文档" ⇒ 必须以 `sessionId` 为主键独立成档。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 🔴 与 `store/split-index.js` 的分工（**不重复存同一事实**）
 * ───────────────────────────────────────────────────────────────────
 *   · `split-index`（key `dsh.director.split`，**冻结键**）
 *       = 「会话 id → 分流**显示标签**」—— 职责是**覆盖导图标题**（`applySplitLabels`）
 *   · `dossier`（key `dsh.director.dossier`，**新增键**）
 *       = 「会话 id → 总监身份 + 总结文档」—— 职责是**会话自己的档案**
 *   两者以 `sessionId` 关联；档案里**只存 `dim` 作关联键，不重复存 `label`**
 *   （`label` 的真相源仍是 `split-index`，重复存 = 两份真相，迟早不一致）。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 契约
 * ───────────────────────────────────────────────────────────────────
 *   · 持久化键 `dsh.director.dossier` —— 在**冻结命名空间** `dsh.director` 之内。
 *     R5 冻结的是"既有键不得改名/删除"，**新增是允许的**；
 *     但**必须同步登记进 `cdp-click-dialog.mjs` 的白名单**，否则 R5 假红
 *     （第 6 批 `dsh.director.agentRuns.v1` 就是这么红的 —— 见该处补登注释）。
 *   · 脏数据**逐条丢弃**，绝不整体清空（一条坏记录抹掉全部档案比"少一条"糟得多）
 *   · 容量上限 `DOSSIER_MAX`（按 `at` 保新）—— localStorage 是全站共享预算
 *   · 🔴 **不许编摘要**：`summary.source` 只有三态 ——
 *       `collect`（回收读到的事件流正文）/ `host-title`（宿主标题）/ `none`（读不到）
 *     读不到就 `source:"none"` + `ok:false` + 原因，**绝不回落到"看起来像摘要"的占位文案**
 *     （纪律 19 同型：降级可以，无声不行）。
 */

/** 持久化键（命名空间 `dsh.director` 内；新增键，需登记 R5 白名单） */
export const DOSSIER_KEY = "dsh.director.dossier";

/** 条目上限（按 `at` 保新裁掉多余） */
export const DOSSIER_MAX = 200;

/** `summary.source` 的**合法取值**（白名单式校验：非此三态一律归 `none`） */
export const SUMMARY_SOURCES = Object.freeze(["collect", "host-title", "none"]);

let mem = null;

function storage() {
	try { return typeof localStorage === "undefined" ? null : localStorage; } catch (e) { return null; }
}

/**
 * 丢弃内存缓存，强制下次 `readDossiers()` 从 localStorage 重读。
 *
 * 🔴 为什么需要它：`readDossiers()` 带进程内缓存（一次解析、多次复用 ——
 *    导图每次刷新都会调 `applyDossiers()`）。以下两种情况缓存会**过期**：
 *      · 另一个标签页 / 窗口改了同一份档案（localStorage 跨标签共享）
 *      · 诊断脚本直接往 localStorage 塞了数据，要验证解析器对不对
 *    ⇒ 提供**显式**失效出口；**不自动失效**（跨标签监听的成本大于收益，
 *      而档案是"派发时写、回收时写"的低频数据，读到上一次的结果没有危害）。
 */
export function resetDossierCache() { mem = null; return true; }

function str(v) { return String(v == null ? "" : v); }

/** 归一化 `director` 子对象；无有效内容返回 `null` */
function normDirector(raw) {
	if (!raw || typeof raw !== "object") return null;
	const role = str(raw.role).trim();
	const name = str(raw.name).trim();
	const at = Number(raw.at) || 0;
	if (!role && !name) return null;
	return { role, name, at };
}

/**
 * 归一化 `summary` 子对象。
 * 🔴 `source` 只认白名单三态；`text` 为空 ⇒ `ok` **强制 false**
 *    （防"有 ok:true 却没有正文"这种自相矛盾的档案 —— 那会让读数说"有总结"而实际是空的）。
 */
function normSummary(raw) {
	if (!raw || typeof raw !== "object") return null;
	const source = SUMMARY_SOURCES.indexOf(str(raw.source)) >= 0 ? str(raw.source) : "none";
	const text = str(raw.text);
	const at = Number(raw.at) || 0;
	/* 🔴 第 21 批新增 `reason`：「没有总结」必须能说清**为什么没有**。
	 *    旧版读不到产出时根本不写 `summary` ⇒ 档案里恒为 `null`，
	 *    「无产出」与「读不到」**不可分**（纪律 18/58）。
	 *    只在**没有正文**时保留（有正文就不需要理由）；截 300 防超预算。 */
	const reason = text ? "" : str(raw.reason).slice(0, 300);
	if (!text && source === "none" && !at && !reason) return null;
	return { text, at, source, ok: raw.ok === true && Boolean(text), reason };
}

/** 归一化一条档案；`sessionId` 为空 ⇒ `null`（调用方丢弃） */
function normalizeDossier(sessionId, raw) {
	const sid = str(sessionId).trim();
	if (!sid || !raw || typeof raw !== "object") return null;
	const d = {
		sessionId: sid,
		dim: str(raw.dim),
		director: normDirector(raw.director),
		summary: normSummary(raw.summary),
		state: str(raw.state),
		turns: typeof raw.turns === "number" && Number.isFinite(raw.turns) ? raw.turns : null,
		at: Number(raw.at) || 0
	};
	/* 全空的档案没有意义（占额度不承载信息）—— 丢弃 */
	if (!d.dim && !d.director && !d.summary && !d.state) return null;
	return d;
}

/**
 * 读全量档案（带内存缓存）。脏数据逐条丢弃，不整体抛错。
 * @returns {Object<string, object>}
 */
export function readDossiers() {
	if (mem) return mem;
	const s = storage();
	if (!s) { mem = {}; return mem; }
	try {
		const raw = s.getItem(DOSSIER_KEY);
		const obj = raw ? JSON.parse(raw) : null;
		const items = obj && obj.items && typeof obj.items === "object" ? obj.items : {};
		const out = {};
		for (const k of Object.keys(items)) {
			const d = normalizeDossier(k, items[k]);
			if (d) out[k] = d;
		}
		mem = out;
	} catch (e) { mem = {}; }
	return mem;
}

/** 写全量档案（裁剪到 `DOSSIER_MAX`，按 `at` 保新；写失败不抛 —— 隐私模式下退化为"本次会话内有效"） */
export function writeDossiers(map) {	const src = map && typeof map === "object" ? map : {};
	const keys = Object.keys(src).filter((k) => src[k]);
	keys.sort((a, b) => (src[b].at || 0) - (src[a].at || 0));
	const keep = {};
	for (const k of keys.slice(0, DOSSIER_MAX)) keep[k] = src[k];
	mem = keep;
	const s = storage();
	if (s) {
		try { s.setItem(DOSSIER_KEY, JSON.stringify({ v: 1, items: keep })); } catch (e) { /* 隐私模式 / 超预算：内存内仍生效 */ }
	}
	return Object.keys(keep).length;
}

/**
 * 合并式写入一条档案（**patch 语义**：只覆盖显式给出的字段）。
 *
 * 🔴 为什么是合并而不是整体替换：派发时写 `director`、回收时写 `summary`
 *    —— 若用替换，回收那一次会把派发写的总监身份**冲掉**（两个调用点相隔很久，
 *    谁也不会知道对方写过什么）。合并让两个写入点**各自只管自己那一段**。
 *
 * @param {string} sessionId
 * @param {{dim?:string, director?:object, summary?:object, state?:string, turns?:number, at?:number}} patch
 * @returns {object|null} 写入后的档案；`sessionId` 空 ⇒ `null`
 */
export function putDossier(sessionId, patch) {
	const sid = str(sessionId).trim();
	if (!sid) return null;
	const p = patch && typeof patch === "object" ? patch : {};
	const cur = { ...readDossiers() };
	const old = cur[sid] || {};
	const merged = {
		dim: p.dim !== undefined ? p.dim : old.dim,
		director: p.director !== undefined ? p.director : old.director,
		summary: p.summary !== undefined ? p.summary : old.summary,
		state: p.state !== undefined ? p.state : old.state,
		turns: p.turns !== undefined ? p.turns : old.turns,
		at: Number(p.at) || Date.now()
	};
	const norm = normalizeDossier(sid, merged);
	if (!norm) return null;
	cur[sid] = norm;
	writeDossiers(cur);
	return norm;
}

/** 取单条 */
export function dossierOf(sessionId) {
	const k = str(sessionId).trim();
	if (!k) return null;
	return readDossiers()[k] || null;
}

/** 忘掉若干条（不存在的 id 静默跳过并计入 `missed`） */
export function forgetDossiers(ids) {
	const arr = Array.isArray(ids) ? ids : [];
	const cur = { ...readDossiers() };
	let removed = 0, missed = 0;
	for (let i = 0; i < arr.length; i++) {
		const k = str(arr[i]).trim();
		if (!k) continue;
		if (cur[k]) { delete cur[k]; removed += 1; } else missed += 1;
	}
	if (removed) writeDossiers(cur);
	return { removed, missed };
}

/** 清空全部档案（返回被清掉的条数，供调用方如实汇报） */
export function clearDossiers() {
	const n = Object.keys(readDossiers()).length;
	writeDossiers({});
	return n;
}

/**
 * 把档案**挂到血缘树上**（就地改显示字段，与 `applySplitLabels` 同范式）。
 *
 * 🔴 只**新增**字段（`hasDossier` / `dossierRole` / `dossierSummary` / `dossierSummarySrc`），
 *    宿主真值（`running` / `blank` / `updatedAt` / `parentSessionId` …）与
 *    `split-index` 覆盖的 `title` / `splitDim` **一个不动** —— 否则会出现
 *    "导图标题和总监页不一致"这类双口径问题。
 * 🔴 `applied` **只数 rows**（不把 `byId` 那份算进去）：同一会话在 `rows` 与 `byId` 里
 *    是**两个对象**，两边都数会让读数翻倍，而闸门会拿它当真值断言
 *    （第 18 批 `dispatchApplied:16` 的教训）。
 *
 * @param {{rows?:Array, byId?:Object}} tree `refreshBranchTree()` 产出的树
 * @param {Object} [map] 省略则读当前档案
 * @returns {{applied:number, withSummary:number, roles:string[]}}
 */
export function applyDossiers(tree, map) {
	const idx = map && typeof map === "object" ? map : readDossiers();
	if (!tree) return { applied: 0, withSummary: 0, roles: [] };
	const byId = tree.byId && typeof tree.byId === "object" ? tree.byId : {};
	let applied = 0;
	let withSummary = 0;
	const roles = [];
	const patch = (row, countIt) => {
		if (!row || !row.sessionId) return;
		const d = idx[str(row.sessionId)];
		if (!d) return;
		if (d.dim) row.dossierDim = d.dim;
		if (d.director) row.dossierRole = d.director.role;
		if (d.summary) {
			row.dossierSummary = d.summary.text ? d.summary.text.slice(0, 200) : "";
			row.dossierSummarySrc = d.summary.source;
			row.dossierSummaryOk = d.summary.ok === true;
			/* 第 21 批：读不到产出时的**可读原因**（没有正文才有；有正文恒为空串） */
			row.dossierSummaryReason = d.summary.reason || "";
		}
		row.hasDossier = true;
		if (countIt) {
			applied += 1;
			if (d.summary && d.summary.ok) withSummary += 1;
			if (d.director && d.director.role && roles.indexOf(d.director.role) < 0) roles.push(d.director.role);
		}
	};
	(Array.isArray(tree.rows) ? tree.rows : []).forEach((r) => patch(r, true));
	Object.keys(byId).forEach((k) => patch(byId[k], false));
	return { applied, withSummary, roles };
}

/**
 * 档案读数（供面板/闸门；**纯读数，不改状态**）。
 * @returns {{total:number, withSummary:number, withDirector:number, sources:Object<string,number>, orphans:number}}
 */
export function dossierStats(aliveIds) {
	const map = readDossiers();
	const keys = Object.keys(map);
	const alive = Array.isArray(aliveIds) ? new Set(aliveIds.map(String)) : null;
	const sources = { collect: 0, "host-title": 0, none: 0 };
	let withSummary = 0, withDirector = 0, orphans = 0;
	for (let i = 0; i < keys.length; i++) {
		const d = map[keys[i]];
		if (d.summary) { sources[d.summary.source] = (sources[d.summary.source] || 0) + 1; if (d.summary.ok) withSummary += 1; }
		if (d.director && d.director.role) withDirector += 1;
		if (alive && !alive.has(keys[i])) orphans += 1;
	}
	/* 🔴 19 号文 **N6 判据 3**：读数必须能**逐会话对账**，而不是只给一个总数。
	 *    只有 `total` 时，「3 条档案覆盖了 3 个会话」与「3 条档案 + 97 个会话没档案」
	 *    在读数上**完全同形**（这正是 N6 现象："档案是否全覆盖"看不出来）。
	 *    新增三路：`aliveCount` / `withAlive` / `missingAlive`，并保持两条恒等式：
	 *      ① `aliveCount === withAlive + missingAlive`
	 *      ② `total === withAlive + orphans`（档案集 = 存活∩有档 + 孤儿）
	 *    `missingIds` 给前 20 个**具体是谁**（读数若只有数字，排查时仍要手翻）。 */
	let withAlive = 0, missingAlive = 0;
	const missingIds = [];
	if (alive) {
		alive.forEach((id) => {
			if (map[id]) withAlive += 1;
			else { missingAlive += 1; if (missingIds.length < 20) missingIds.push(id); }
		});
	}
	return {
		total: keys.length, withSummary, withDirector, sources, orphans,
		aliveCount: alive ? alive.size : 0, withAlive, missingAlive, missingIds
	};
}

/**
 * 把档案挂到 `window.__dshDossier`（**诊断出口**，与 `window.__dshDispatchLog`
 * / `window.__dshBranchTree` 同性质）。
 * 🔴 暴露的是**同一个活对象读数**（每次调用重新 `readDossiers()`）⇒ 读完即最新。
 * @returns {object}
 */
export function installDossierApi() {
	const api = {
		key: DOSSIER_KEY, max: DOSSIER_MAX,
		read: () => readDossiers(),
		of: (id) => dossierOf(id),
		put: (id, patch) => putDossier(id, patch),
		forget: (ids) => forgetDossiers(ids),
		clear: () => clearDossiers(),
		resetCache: () => resetDossierCache(),
		stats: (aliveIds) => dossierStats(aliveIds)
	};
	if (typeof window !== "undefined") window.__dshDossier = api;
	return api;
}
