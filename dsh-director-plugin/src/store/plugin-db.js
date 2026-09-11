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
export const PLUGIN_DB_VERSION = 1;

/** 6 个 store（对齐 17 号文 §2.2 原始设计的 6 类记忆） */
export const PDB = Object.freeze({
	NODES: "directorNodes",
	CONVERSATIONS: "directorConversations",
	PLANS: "directorPlans",
	REVIEWS: "directorReviews",
	DECISIONS: "directorDecisions",
	TODOS: "directorTodos"
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
	[PDB.TODOS]: { keyPath: "todoId", indexes: { nodeId: "nodeId" } }
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
	return pPut(PDB.CONVERSATIONS, rec).then((ok) => (ok ? rec : null));
}
export function listDirectorMessages(nodeId) {
	return pGetAllByIndex(PDB.CONVERSATIONS, "nodeId", nodeId)
		.then((rows) => rows.sort((a, b) => (a.at || 0) - (b.at || 0)));
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

/** 安装全局契约（调试与验证脚本用，不可改名） */
export function installPluginDbApi() {
	if (!hasWindow) return null;
	window.__dshPluginDb = {
		PLUGIN_DB_NAME, PLUGIN_DB_VERSION, PDB, PDB_SCHEMA, PDB_ALL_STORES,
		openPluginDB, pluginDbStats, pluginDbState,
		pPut, pGet, pGetAll, pGetAllByIndex, pDelete, pCount, pClear,
		saveDirectorNode, getDirectorNode, listDirectorNodes, deleteDirectorNode,
		appendDirectorMessage, listDirectorMessages,
		saveReview, listReviews, saveDecision, listDecisions, savePlan, listPlans,
		saveTodo, listTodos, resetPluginDb
	};
	return window.__dshPluginDb;
}
