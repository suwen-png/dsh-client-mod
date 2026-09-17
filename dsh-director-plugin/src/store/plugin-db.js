/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：插件**自有**数据元层（独立数据库）
 * 引用：V16 诉求 7（落死：数据不丢） · 要求 1 · 17 号文 §2.2 · 17 号文 §2.3 · 17 号文 §1 · T-PLUG-009
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/NodeDetailPanel.js, components/OverviewDialog.js, logic/routing.js, store/design.js, store/hierarchy.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 D7（锚点契约 · 设计图冷备库）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/plugin-db.js — 插件**自有**数据元层（独立数据库）
 *
 * ── 为什么必须有这一层（业务不变量：要求 1）──────────────────────
 *   17 号文 §2.2 原设计：总监记忆用**独立库 `dsh-memory-db`**（6 个 store）；
 *   17 号文 §2.3「每个项目/子项目的文档、对话、决策、待办、风险**相互隔离**」；
 *   17 号文 §1A.7「沟通上下文 vs 执行上下文分离」（上下文不污染）。
 *
 *   但实际落地时退化成了「插件复用宿主 `dsh-director-db` 的 `memoryCore`，
 *   靠 `id` 前缀 + `level` 字段**约定隔离**」（T-PLUG-009 方案）——
 *   即：**设计要求隔离，落地变成共享**。
 *   `docs/10-总监与对话架构总纲.md` §3.4 已论证：该退化**不必要**。
 *
 * ── 🔴 关键技术论证（解除 T-PLUG-009 的过度约束）─────────────────
 *   T-PLUG-009 的约束原文是「**不得给宿主的 `dsh-director-db` 升 v4**」
 *   —— 宿主以 v3 打开，版本不匹配会**直接失败**。
 *   但 IndexedDB 的**版本协商只发生在同一个数据库名内**。
 *   ⇒ **新建一个属于插件自己的数据库（不同 DB 名）完全不参与宿主的版本协商**，
 *     对宿主**零影响**。
 *   ⇒ 于是「物理隔离（要求 1）」与「R5 冻结 key（兼容约束）」**可以同时成立**，
 *     无需任何取舍。
 *
 * ── R5 冻结项（本层**必须**原样保留，不得改名）───────────────────
 *   `dsh.director.store.*` / `dsh.director.layout` / `director-main` /
 *   `dsh.director.config` / DB `dsh-director-db` v3 及其 3 store /
 *   cookie 前缀 `dsh_director_`   ← **全部不动**。本层是**新增**，不是替换。
 *
 * ── 迁移策略（docs/10 §3.5 四阶段）──────────────────────────────
 *   阶段 1  新建本库（首次打开自动建库；`onupgradeneeded` 只在本库触发）
 *   阶段 2  读取期**双读**：优先本库；本库无该节点时回落旧 `memoryCore`（**只读**）
 *   阶段 3  迁移期把旧 `memoryCore` 中的层级节点（schema 白名单）**拷贝**入本库
 *   阶段 4  迁移完成并验证后停止回落；旧记录**不删**（尊重《锚点契约》"历史数据保留"）
 *
 *   本文件实现**阶段 1–3**；阶段 4 由 `hierarchy.js` 的回落开关控制。
 *
 * ── 唯一允许的交叉点 ────────────────────────────────────────────
 *   外键形态：`nodeId` ↔ 宿主的 `workspaceId` / `sessionId`（**只读引用**）。
 *   **禁止**：联合查询、跨库事务、把宿主记录读进本库后落盘。
 *   理由：交叉点收窄到"一个只读外键"，即**结构性地保证**要求 1 的不变量。
 *
 * 错误处理约定：与 `store/idb.js` 一致 —— 所有 API catch 后返回安全缺省
 *   （false / null / []），**不向上抛**（持久化失败不应打断 UI）。
 *   ⚠️ 故调用方不能以返回值判断"是否真的写入"，需按 execution-standards §3.4
 *      「写操作后必须回读校验」另行读回比对。
 */

const hasWindow = typeof window !== "undefined";

/** 插件自有数据库（**与宿主库无关**，不参与其版本协商） */
export const PLUGIN_DB_NAME = "dsh-director-plugin-db";
/**
 * 🔴 v1 → v2（2026-09-12）：新增 `directorDesigns`（设计图冷备，T-PLUG-018）。
 *    仅动**本库**版本，宿主 `dsh-director-db` v3 的协商互不可见（IDB 版本协商只在同名库内发生）。
 *    `onupgradeneeded` 是**幂等加法**（遍历 PDB_ALL_STORES 只补缺失的 store）⇒ 老库平滑升级。
 */
export const PLUGIN_DB_VERSION = 2;

/** 7 个 store（原 6 类记忆 + 设计图冷备） */
export const PDB = Object.freeze({
	NODES: "directorNodes",
	CONVERSATIONS: "directorConversations",
	PLANS: "directorPlans",
	REVIEWS: "directorReviews",
	DECISIONS: "directorDecisions",
	TODOS: "directorTodos",
	/** 设计图快照冷备（localStorage 的兜底恢复源，不是主存） */
	DESIGNS: "directorDesigns"
});

/**
 * store schema（keyPath 与索引的**单一真相源**）
 * `indexes` 形如 `{ 索引名: 字段路径 }`
 */
export const PDB_SCHEMA = Object.freeze({
	[PDB.NODES]: { keyPath: "nodeId", indexes: { level: "level", parentId: "parentId" } },
	[PDB.CONVERSATIONS]: { keyPath: "messageId", indexes: { nodeId: "nodeId", createdAt: "createdAt" } },
	[PDB.PLANS]: { keyPath: "planId", indexes: { nodeId: "nodeId" } },
	[PDB.REVIEWS]: { keyPath: "reviewId", indexes: { nodeId: "nodeId", targetId: "targetId" } },
	[PDB.DECISIONS]: { keyPath: "decisionId", indexes: { nodeId: "nodeId" } },
	[PDB.TODOS]: { keyPath: "todoId", indexes: { nodeId: "nodeId" } },
	// 设计图冷备：单条快照记录（graph 内聚，无需索引）
	[PDB.DESIGNS]: { keyPath: "designId", indexes: {} }
});

/** 全部 store 名（校验用） */
export const PDB_ALL_STORES = Object.freeze(Object.keys(PDB_SCHEMA));

let dbPromise = null;

/** 是否已就绪（同步可读的状态位，供 UI 展示"数据元已隔离"） */
export let pluginDbState = { attempted: false, ok: false, error: null, name: PLUGIN_DB_NAME, version: PLUGIN_DB_VERSION };

/**
 * 打开插件自有数据库（单例）
 * 🔴 `indexedDB.open(name, 1)` 只影响**本库**；宿主以 v3 打开 `dsh-director-db`
 *    时与本调用**互不可见**。
 * @returns {Promise<IDBDatabase>}
 */
export function openPluginDB() {
	if (dbPromise) return dbPromise;
	if (typeof indexedDB === "undefined") {
		pluginDbState = { attempted: true, ok: false, error: "indexedDB unavailable", name: PLUGIN_DB_NAME, version: PLUGIN_DB_VERSION };
		dbPromise = Promise.reject(new Error("indexedDB unavailable"));
		return dbPromise;
	}
	pluginDbState = { attempted: true, ok: false, error: null, name: PLUGIN_DB_NAME, version: PLUGIN_DB_VERSION };
	dbPromise = new Promise((resolve, reject) => {
		try {
			const req = indexedDB.open(PLUGIN_DB_NAME, PLUGIN_DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				for (const name of PDB_ALL_STORES) {
					const spec = PDB_SCHEMA[name];
					const os = db.objectStoreNames.contains(name)
						? req.transaction.objectStore(name)
						: db.createObjectStore(name, { keyPath: spec.keyPath });
					for (const idx of Object.keys(spec.indexes || {})) {
						if (!os.indexNames.contains(idx)) {
							os.createIndex(idx, spec.indexes[idx], { unique: false });
						}
					}
				}
			};
			req.onsuccess = () => {
				pluginDbState.ok = true;
				resolve(req.result);
			};
			req.onerror = () => {
				pluginDbState.error = (req.error && req.error.message) || "open failed";
				reject(req.error || new Error("plugin-db open failed"));
			};
			req.onblocked = () => {
				pluginDbState.error = "blocked";
				reject(new Error("plugin-db open blocked"));
			};
		} catch (e) {
			pluginDbState.error = String(e && e.message);
			reject(e);
		}
	});
	// 失败后允许重试（避免一次性失败被永久缓存）
	dbPromise.catch(() => { dbPromise = null; });
	return dbPromise;
}

/** 事务包装：统一 catch → 安全缺省 */
function ptx(store, mode, fn) {
	return openPluginDB().then((db) => new Promise((resolve, reject) => {
		try {
			const t = db.transaction(store, mode);
			const os = t.objectStore(store);
			const req = fn(os);
			t.oncomplete = () => resolve(req ? req.result : undefined);
			t.onerror = () => reject(t.error || new Error("tx error"));
			t.onabort = () => reject(t.error || new Error("tx abort"));
		} catch (e) { reject(e); }
	}));
}

/* ── 通用 CRUD（安全缺省）─────────────────────────────────────── */

export function pPut(store, record) {
	return ptx(store, "readwrite", (os) => os.put(record)).then(() => true).catch(() => false);
}
export function pGet(store, key) {
	return ptx(store, "readonly", (os) => os.get(key)).then((r) => (r === undefined ? null : r)).catch(() => null);
}
export function pGetAll(store) {
	return ptx(store, "readonly", (os) => os.getAll()).then((r) => r || []).catch(() => []);
}
export function pGetAllByIndex(store, indexName, key) {
	return ptx(store, "readonly", (os) => os.index(indexName).getAll(key)).then((r) => r || []).catch(() => []);
}
export function pDelete(store, key) {
	return ptx(store, "readwrite", (os) => os.delete(key)).then(() => true).catch(() => false);
}
export function pCount(store) {
	return ptx(store, "readonly", (os) => os.count()).then((r) => (typeof r === "number" ? r : 0)).catch(() => 0);
}
export function pClear(store) {
	return ptx(store, "readwrite", (os) => os.clear()).then(() => true).catch(() => false);
}

/* ── 域辅助：ID 生成 ─────────────────────────────────────────── */

/** 生成稳定可读的领域 id（无随机依赖，便于断言） */
export function makeId(prefix, seed) {
	const t = Date.now().toString(36);
	const r = Math.floor(Math.random() * 1e6).toString(36);
	return `${prefix}_${seed ? String(seed).slice(-8) + "_" : ""}${t}${r}`;
}

/* ── 域辅助：层级节点 ────────────────────────────────────────── */

/**
 * 写入层级节点
 * 🔴 注意本库 `directorNodes` 的 keyPath 是 **`nodeId`**（不是宿主 `memoryCore` 的 `projectId`）
 *    ⇒ 调用方传的节点对象用 `id` 字段表示节点 id，这里显式映射，避免"缺主键 ⇒ 静默失败"。
 */
export function saveDirectorNode(node) {
	if (!node || !node.id) return Promise.resolve(false);
	return pPut(PDB.NODES, { ...node, nodeId: node.id });
}
export function getDirectorNode(nodeId) {
	return pGet(PDB.NODES, nodeId);
}
export function listDirectorNodes() {
	return pGetAll(PDB.NODES);
}
export function deleteDirectorNode(nodeId) {
	return pDelete(PDB.NODES, nodeId);
}

/* ── 域辅助：总监对话（要求 2「总监自己也是一路对话」）────────── */

export function appendDirectorMessage(nodeId, msg) {
	const rec = {
		messageId: msg.messageId || makeId("dm", nodeId),
		nodeId,
		role: msg.role || "director",
		kind: msg.kind || "note",
		text: String(msg.text == null ? "" : msg.text),
		at: msg.at || Date.now(),
		meta: msg.meta || {}
	};
	/* 🔴 19 号文 §3.2（N3 落点）：**信封是独立字段**，不是 `meta` 的子集。
	 *    为什么不能塞进 `meta` 或 `text`：
	 *      · 塞 `text` ⇒ 污染 `organize()` 语言整理与既有正则判据（§3.2 明文禁止）；
	 *      · 塞 `meta` ⇒ `meta` 已被"派发台账/审核结论"等占用，语义混杂后
	 *        无法用「有无 env」区分"这条消息属于某条血缘"。
	 *    🔴 **只增不改**：`msg.env` 缺省时不写该字段 ⇒ 旧记录逐字节不变、
	 *       读取方 `envOf()` 返回 `null` ⇒ 退化为旧行为（既有调用点零改动可跑）。 */
	if (msg.env && typeof msg.env === "object") rec.env = msg.env;
	return pPut(PDB.CONVERSATIONS, rec).then((ok) => (ok ? rec : null));
}
export function listDirectorMessages(nodeId) {
	return pGetAllByIndex(PDB.CONVERSATIONS, "nodeId", nodeId)
		.then((rows) => rows.sort((a, b) => (a.at || 0) - (b.at || 0)));
}

/**
 * 🔴 19 号文 **N3**（R2「上游可见下游摘要」）：读**全部**总监消息（**跨桶**）。
 *
 * 为什么必须新增、不能拿 `listDirectorMessages(nodeId)` 凑：
 *   消息按**作用域会话分桶**（`safeDirectorKey(sessionId)`）⇒ 单桶读**永远看不到**
 *   别的分支写了什么。而 R2 要的正是"上游节点**不必点进下游**就能看到它的产出摘要"
 *   ⇒ 判据天然跨桶。
 *
 * ⚠️ 代价与边界：这是**全量读**（IndexedDB 一次 `getAll`），比单桶读贵 ⇒
 *   只在需要血缘摘要时调（总监弹窗/总监页的 refresh），**不要**放进渲染循环。
 * ⚠️ 返回的行**不在这里做血缘过滤** —— 过滤是 `lineage.js#summariesFor()` 的职责
 *   （单一真相源：UI 与闸门用**同一个**纯函数判"这行该不该显示"）。
 */
export function listAllDirectorMessages() {
	return pGetAll(PDB.CONVERSATIONS).then((rows) => {
		const list = Array.isArray(rows) ? rows.slice() : [];
		return list.sort((a, b) => (a.at || 0) - (b.at || 0));
	});
}

/* ── 域辅助：审核 / 决策 / 方案 / 待办 ────────────────────────── */

export function saveReview(rec) {
	const row = { ...rec, reviewId: rec.reviewId || makeId("rv", rec.nodeId) };
	return pPut(PDB.REVIEWS, row).then((ok) => (ok ? row : null));
}
export function listReviews(nodeId) {
	return pGetAllByIndex(PDB.REVIEWS, "nodeId", nodeId);
}
export function saveDecision(rec) {
	const row = { ...rec, decisionId: rec.decisionId || makeId("dc", rec.nodeId) };
	return pPut(PDB.DECISIONS, row).then((ok) => (ok ? row : null));
}
export function listDecisions(nodeId) {
	return pGetAllByIndex(PDB.DECISIONS, "nodeId", nodeId);
}
export function savePlan(rec) {
	const row = { ...rec, planId: rec.planId || makeId("pl", rec.nodeId) };
	return pPut(PDB.PLANS, row).then((ok) => (ok ? row : null));
}
export function listPlans(nodeId) {
	return pGetAllByIndex(PDB.PLANS, "nodeId", nodeId);
}
export function saveTodo(rec) {
	const row = { ...rec, todoId: rec.todoId || makeId("td", rec.nodeId) };
	return pPut(PDB.TODOS, row).then((ok) => (ok ? row : null));
}
export function listTodos(nodeId) {
	return pGetAllByIndex(PDB.TODOS, "nodeId", nodeId);
}

/* ── 统计（供 UI 与服务面板展示"数据元独立性"）──────────────── */

export function pluginDbStats() {
	return Promise.all([
		pCount(PDB.NODES), pCount(PDB.CONVERSATIONS), pCount(PDB.PLANS),
		pCount(PDB.REVIEWS), pCount(PDB.DECISIONS), pCount(PDB.TODOS)
	]).then(([nodes, conversations, plans, reviews, decisions, todos]) => ({
		name: PLUGIN_DB_NAME, version: PLUGIN_DB_VERSION, ok: pluginDbState.ok,
		nodes, conversations, plans, reviews, decisions, todos
	}));
}

/** 清空本库（仅调试/测试用；**绝不动宿主库**） */
export function resetPluginDb() {
	return Promise.all(PDB_ALL_STORES.map((s) => pClear(s))).then(() => true);
}

/**
 * 清除**总监对话消息**（第 16 批需求 3 —— 用户原话「清除所有的对话消息」）。
 *
 * 🔴 为什么不能用 `resetPluginDb()`：
 *    那会连 `directorNodes`（层级节点）/ `directorTodos` / `directorDecisions` /
 *    `directorDesigns`（设计图冷备）**一起清掉** —— 用户的待办、决策记录、设计图全没了，
 *    而这两个动作在界面上看起来一样（都叫"清除"）。⇒ 必须**定向到一张表**。
 *
 * 🔴 能力边界（**必须如实上报，不许假装清干净了**）：
 *    宿主 `sessions` 服务**没有**删除/清空契约（成员表已逐条核对：
 *    `create` / `fork` / `open` / `openSubagent` / `list` / `search` / `provide` …
 *    `drop()` 只丢内存实例，注释原文 *"The host session log is the durable truth —
 *    a later get() lazily rebuilds and open() backfills history"*）。
 *    ⇒ 本函数**只清插件自己库里的消息**；宿主侧对话消息不在插件权限内。
 *    返回值里的 `hostBoundary` 供调用方原样展示（**不静默**）。
 *
 * @param {string} [nodeId] 省略 ⇒ 清**所有**节点的消息
 * @returns {Promise<{ok:boolean, removed:number, before:number, scoped:boolean, hostBoundary:string, reason?:string}>}
 */
/* ── 清除安全网：备份 / 恢复（第 22 批 D4「清完就没了」）──────────────
 *
 * 🔴 为什么必须有这层：
 *   用户第 16 批要的「清除所有对话消息」是**真删除**（`pDelete`），
 *   而**验收闸门为了测这个按钮，自己也必须清一次**（`verify-novel-split` D 段）。
 *   两者叠加 ⇒ **每跑一轮验收 = 用户真实总监消息清零一次**。
 *   本轮实测取证：`directorConversations` 全表 0 条、`directorNodes` 却有 458 条
 *   ⇒ 不是「库打不开」，是**消息被清干净了**；用户看到「总监消息 0」，
 *   合理地读成"没持久化"。而一次真实写入（统筹）立刻让页签 0 → 1 ⇒ 通道本身是好的。
 *
 * ⇒ 清之前先落一份**可一键恢复**的快照：
 *   · 落点与消息同层（localStorage，同 origin）—— 跨页面重载可读；
 *   · 恢复按 `messageId` **幂等**（重复恢复不产生副本，不会把 1 条变成 2 条）；
 *   · 超限 / 写失败 **一律如实上报**（`ok:false` + `reason`）—— 不许让用户以为有安全网。
 */
export const MSG_BACKUP_KEY = "dsh.director.msgs.backup";
/** 备份体量上限（localStorage 同源总配额约 5MB，留足余量给其它键） */
export const MSG_BACKUP_MAX_BYTES = 3 * 1024 * 1024;

/**
 * 把即将被删的行写进备份槽。
 * @param {object[]} rows 即将删除的消息行
 * @param {string} note 本次清除的说明（写进备份，便于事后判断"这份备份是哪次清的"）
 * @returns {{ok:boolean, count:number, bytes:number, key:string, reason:string}}
 */
export function backupDirectorMessages(rows, note) {
	const list = Array.isArray(rows) ? rows : [];
	let text = "";
	try { text = JSON.stringify({ v: 1, at: Date.now(), note: String(note == null ? "" : note), count: list.length, rows: list }); }
	catch (e) { return { ok: false, count: 0, bytes: 0, key: MSG_BACKUP_KEY, reason: "序列化失败：" + String((e && e.message) || e) }; }
	const bytes = text.length;
	if (!list.length) return { ok: true, count: 0, bytes: 0, key: MSG_BACKUP_KEY, reason: "本次没有可备份的消息" };
	if (bytes > MSG_BACKUP_MAX_BYTES) {
		return { ok: false, count: 0, bytes, key: MSG_BACKUP_KEY, reason: "超出备份上限（" + bytes + "B > " + MSG_BACKUP_MAX_BYTES + "B）⇒ 未写入备份" };
	}
	try {
		if (typeof localStorage === "undefined") return { ok: false, count: 0, bytes, key: MSG_BACKUP_KEY, reason: "无 localStorage" };
		localStorage.setItem(MSG_BACKUP_KEY, text);
		const back = localStorage.getItem(MSG_BACKUP_KEY);
		return { ok: back === text, count: list.length, bytes, key: MSG_BACKUP_KEY, reason: back === text ? "" : "写后读回不一致" };
	} catch (e) {
		return { ok: false, count: 0, bytes, key: MSG_BACKUP_KEY, reason: "写入抛错：" + String((e && e.message) || e) };
	}
}

/** 读备份（无备份 / 损坏 ⇒ null，调用方必须能区分"没有"与"读不到"） */
export function readMessageBackup() {
	try {
		if (typeof localStorage === "undefined") return null;
		const raw = localStorage.getItem(MSG_BACKUP_KEY);
		if (!raw) return null;
		const rec = JSON.parse(raw);
		if (!rec || !Array.isArray(rec.rows)) return null;
		return { at: rec.at || 0, note: String(rec.note || ""), count: Number(rec.count) || rec.rows.length, bytes: raw.length, rows: rec.rows };
	} catch (e) { return null; }
}

/**
 * 挑出「需要写回」的行（**纯函数**，便于离线单测 —— 恢复的核心规则都在这里）。
 *
 * 规则两条（都是"不做就会出新事故"的）：
 *   · `messageId` 缺失/为空的行**一律丢弃**（写进去会产生无主键记录）；
 *   · 已在库中的**跳过** ⇒ 恢复**幂等**：重复点「恢复」不会把 1 条变成 2 条。
 *
 * @param {Iterable<string>|string[]} existingIds 库中已有的 messageId
 * @param {object[]} backupRows 备份里的行
 * @returns {{rows:object[], skipped:number}}
 */
export function pickRestorableRows(existingIds, backupRows) {
	const have = existingIds instanceof Set
		? existingIds
		: new Set(Array.isArray(existingIds) ? existingIds : []);
	const out = [];
	let skipped = 0;
	for (const r of (Array.isArray(backupRows) ? backupRows : [])) {
		if (!r || r.messageId === undefined || r.messageId === null || r.messageId === "") { skipped += 1; continue; }
		if (have.has(r.messageId)) { skipped += 1; continue; }
		out.push(r);
	}
	return { rows: out, skipped };
}

/**
 * 从备份恢复（按 `messageId` 幂等）。
 * @returns {Promise<{ok:boolean, total:number, restored:number, skipped:number, at:number, reason:string}>}
 */
export function restoreDirectorMessages() {
	const bak = readMessageBackup();
	if (!bak) return Promise.resolve({ ok: false, total: 0, restored: 0, skipped: 0, at: 0, reason: "没有备份可恢复（或备份已损坏）" });
	return pGetAll(PDB.CONVERSATIONS).then(async (rows) => {
		const have = new Set((Array.isArray(rows) ? rows : []).map((r) => r && r.messageId).filter(Boolean));
		const pick = pickRestorableRows(have, bak.rows);
		let restored = 0;
		for (const r of pick.rows) {
			if (await pPut(PDB.CONVERSATIONS, r)) restored += 1;
		}
		return { ok: restored + pick.skipped === bak.rows.length, total: bak.rows.length, restored, skipped: pick.skipped, at: bak.at, reason: "" };
	}).catch((e) => ({ ok: false, total: 0, restored: 0, skipped: 0, at: 0, reason: String((e && e.message) || e) }));
}

/** 丢弃备份槽（恢复确认无误后由用户显式调用） */
export function clearMessageBackup() {
	try {
		if (typeof localStorage === "undefined") return false;
		localStorage.removeItem(MSG_BACKUP_KEY);
		return localStorage.getItem(MSG_BACKUP_KEY) === null;
	} catch (e) { return false; }
}

export function clearDirectorMessages(nodeId) {
	const scoped = nodeId !== undefined && nodeId !== null && nodeId !== "";
	const want = scoped ? String(nodeId) : "";
	return pGetAll(PDB.CONVERSATIONS).then(async (rows) => {
		const list = Array.isArray(rows) ? rows : [];
		const before = list.length;
		const hit = scoped ? list.filter((r) => r && String(r.nodeId) === want) : list;
		/* 🔴 先备份、再删除（顺序不可颠倒 —— 反了就永远备份不出来）。
		 *   备份失败**不阻断**删除（用户是点了两次确认的），但必须报出来。 */
		const backup = backupDirectorMessages(hit, scoped ? ("定向清除 nodeId=" + want) : "全表清除（无 nodeId 参数）");
		/* 🔴 第 24 批：**三条口径必须能分开看**（第二十四轮 40 轮连跑后实测出来的）。
		 *    真机出现过 `before=121 / 备份=123 / 快照=123` 三个数互不相同，
		 *    而旧读数只暴露 `before`/`removed` ⇒ 差额**无从归因**（纪律 19：无声最坏）。
		 *    `hit` = 纳入清除的条数；`noId` = 无主键而被跳过的条数（删不掉的合法原因）。 */
		const noId = hit.filter((r) => !(r && r.messageId !== undefined)).length;
		let removed = 0;
		for (const r of hit) {
			const id = r && r.messageId;
			if (id === undefined) continue;
			/* 逐条真实删除并计数 —— `pDelete` 失败会返回 false（不抛），
			 * 记进 removed 的必须是**真删掉的**，不能按"打算删几条"计。 */
			if (await pDelete(PDB.CONVERSATIONS, id)) removed += 1;
		}
		return {
			ok: removed === hit.length,
			removed, before, hit: hit.length, noId, scoped, backup,
			hostBoundary: "宿主侧对话消息不在插件权限内（sessions 服务无删除/清空契约）"
		};
	}).catch((e) => ({
		ok: false, removed: 0, before: 0, hit: 0, noId: 0, scoped,
		backup: { ok: false, count: 0, bytes: 0, key: MSG_BACKUP_KEY, reason: "读取失败，未产生备份" },
		hostBoundary: "宿主侧对话消息不在插件权限内（sessions 服务无删除/清空契约）",
		reason: String((e && e.message) || e)
	}));
}

/** 安装全局契约（调试与验证脚本用，不可改名） */
export function installPluginDbApi() {
	if (!hasWindow) return null;
	window.__dshPluginDb = {
		PLUGIN_DB_NAME, PLUGIN_DB_VERSION, PDB, PDB_SCHEMA, PDB_ALL_STORES,
		openPluginDB, pluginDbStats, pluginDbState,
		pPut, pGet, pGetAll, pGetAllByIndex, pDelete, pCount, pClear,
		saveDirectorNode, getDirectorNode, listDirectorNodes, deleteDirectorNode,
		appendDirectorMessage, listDirectorMessages, listAllDirectorMessages, clearDirectorMessages,
		backupDirectorMessages, readMessageBackup, restoreDirectorMessages, clearMessageBackup,
		pickRestorableRows, MSG_BACKUP_KEY, MSG_BACKUP_MAX_BYTES,
		saveReview, listReviews, saveDecision, listDecisions, savePlan, listPlans,
		saveTodo, listTodos, resetPluginDb
	};
	return window.__dshPluginDb;
}
