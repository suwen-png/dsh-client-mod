/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：IndexedDB 持久化层（主要机制）
 * 引用：—
 * 上游：logic/discover.js, logic/sync.js, store/branch.js, store/docs.js, store/hierarchy.js, store/memory.js, store/persist.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/idb.js — IndexedDB 持久化层（主要机制）
 *
 * 迁移源：client.js 5562 ~ 5723
 *
 * 职责：director 的**主持久化层**（Electron 下比 localStorage 更可靠）。
 *      单例连接（`idbPromise` 缓存），版本 3，6 个 object store。
 *
 * 🔴 兼容约束（R5 — **最高优先级**）
 *   DB 名 / 版本 / store 名 / keyPath **全部不可改名或降版**：
 *     DB      `dsh-director-db`  v3
 *     stores  `directorStores`   （无 keyPath，外部传 key）
 *             `directorDocs`     （keyPath docId）
 *             `directorFolders`  （keyPath folderId）
 *             `memoryCore`       （keyPath projectId）
 *             `memoryDecisions`  （keyPath decisionId）
 *             `memoryRisks`      （keyPath riskId）
 *   改 store 名 = 用户存量数据全丢；**降 version = onupgradeneeded 不触发，新 store 不创建**。
 *
 * 错误处理约定（原实现一致）：所有 API **catch 后返回安全缺省**（false/null/[]），
 * 不向上抛 —— 持久化失败不应打断 UI。
 * ⚠️ 故调用方**不能以返回值判断"是否真的写入"**，需按 execution-standards §3.4
 *    「写操作后必须回读校验」另行读回比对。
 */

export const IDB_DB_NAME = "dsh-director-db";
export const IDB_VERSION = 3;

export const IDB_STORE_NAME = "directorStores";
export const IDB_DOCS_STORE = "directorDocs";
export const IDB_FOLDERS_STORE = "directorFolders";
// V9: 记忆体系 stores
export const IDB_MEMORY_CORE_STORE = "memoryCore";
export const IDB_MEMORY_DECISIONS_STORE = "memoryDecisions";
export const IDB_MEMORY_RISKS_STORE = "memoryRisks";

/** 全部 store 清单（校验与迁移用） */
export const IDB_ALL_STORES = [
	IDB_STORE_NAME, IDB_DOCS_STORE, IDB_FOLDERS_STORE,
	IDB_MEMORY_CORE_STORE, IDB_MEMORY_DECISIONS_STORE, IDB_MEMORY_RISKS_STORE
];

let idbPromise = null;

export function openIDB() {
	if (idbPromise) return idbPromise;
	if (typeof indexedDB === "undefined") {
		if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "indexedDB不可用");
		idbPromise = Promise.reject(new Error("indexedDB unavailable"));
		return idbPromise;
	}
	if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "开始打开数据库: " + IDB_DB_NAME + " v" + IDB_VERSION);
	idbPromise = new Promise((resolve, reject) => {
		try {
			const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "onupgradeneeded, 现有stores: " + Array.from(db.objectStoreNames));
				if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
					db.createObjectStore(IDB_STORE_NAME);
					if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "创建store: " + IDB_STORE_NAME);
				}
				if (!db.objectStoreNames.contains(IDB_DOCS_STORE)) {
					db.createObjectStore(IDB_DOCS_STORE, { keyPath: "docId" });
				}
				if (!db.objectStoreNames.contains(IDB_FOLDERS_STORE)) {
					db.createObjectStore(IDB_FOLDERS_STORE, { keyPath: "folderId" });
				}
				// V9: 记忆体系 stores
				if (!db.objectStoreNames.contains(IDB_MEMORY_CORE_STORE)) {
					db.createObjectStore(IDB_MEMORY_CORE_STORE, { keyPath: "projectId" });
					if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "创建store: " + IDB_MEMORY_CORE_STORE);
				}
				if (!db.objectStoreNames.contains(IDB_MEMORY_DECISIONS_STORE)) {
					db.createObjectStore(IDB_MEMORY_DECISIONS_STORE, { keyPath: "decisionId" });
					if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "创建store: " + IDB_MEMORY_DECISIONS_STORE);
				}
				if (!db.objectStoreNames.contains(IDB_MEMORY_RISKS_STORE)) {
					db.createObjectStore(IDB_MEMORY_RISKS_STORE, { keyPath: "riskId" });
					if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "创建store: " + IDB_MEMORY_RISKS_STORE);
				}
			};
			req.onsuccess = () => {
				if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "数据库打开成功, stores: " + Array.from(req.result.objectStoreNames));
				resolve(req.result);
			};
			req.onerror = () => {
				if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "数据库打开失败: " + req.error);
				reject(req.error);
			};
		} catch (e) { reject(e); }
	});
	return idbPromise;
}

/** 重置连接缓存（测试与错误恢复用；原实现无此口，迁移新增） */
export function resetIDBConnection() { idbPromise = null; }

// ── directorStores（消息 store 主表）──

export function idbSave(key, value) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_STORE_NAME, "readwrite");
			tx.objectStore(IDB_STORE_NAME).put(value, key);
			tx.oncomplete = () => {
				if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "idbSave complete: key=" + key + " msgs=" + (value.messages ? value.messages.length : "N/A"));
				resolve(true);
			};
			tx.onerror = () => reject(tx.error);
		} catch (e) { reject(e); }
	})).catch((e) => {
		if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "idbSave failed: " + e.message);
		return false;
	});
}

export function idbLoad(key) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_STORE_NAME, "readonly");
			const req = tx.objectStore(IDB_STORE_NAME).get(key);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		} catch (e) { reject(e); }
	})).catch((e) => {
		if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "idbLoad failed: " + e.message);
		return null;
	});
}

// ── V8: 总监文档 CRUD ──

export function idbSaveDoc(doc) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_DOCS_STORE, "readwrite");
			tx.objectStore(IDB_DOCS_STORE).put({ ...doc, updatedAt: Date.now() });
			tx.oncomplete = () => resolve(true);
			tx.onerror = () => reject(tx.error);
		} catch (e) { reject(e); }
	})).catch((e) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs", "idbSaveDoc failed: " + e.message); return false; });
}

export function idbGetDoc(docId) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_DOCS_STORE, "readonly");
			const req = tx.objectStore(IDB_DOCS_STORE).get(docId);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		} catch (e) { reject(e); }
	})).catch((e) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs", "idbGetDoc failed: " + e.message); return null; });
}

export function idbListDocs(filter) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_DOCS_STORE, "readonly");
			const req = tx.objectStore(IDB_DOCS_STORE).getAll();
			req.onsuccess = () => {
				let docs = req.result || [];
				if (filter) {
					if (filter.folderId !== undefined) docs = docs.filter(d => d.folderId === filter.folderId);
					if (filter.docType) docs = docs.filter(d => d.docType === filter.docType);
				}
				resolve(docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
			};
			req.onerror = () => reject(req.error);
		} catch (e) { reject(e); }
	})).catch((e) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs", "idbListDocs failed: " + e.message); return []; });
}

export function idbDeleteDoc(docId) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_DOCS_STORE, "readwrite");
			tx.objectStore(IDB_DOCS_STORE).delete(docId);
			tx.oncomplete = () => resolve(true);
			tx.onerror = () => reject(tx.error);
		} catch (e) { reject(e); }
	})).catch(() => false);
}

export function idbSaveFolder(folder) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_FOLDERS_STORE, "readwrite");
			tx.objectStore(IDB_FOLDERS_STORE).put({ ...folder, updatedAt: Date.now() });
			tx.oncomplete = () => resolve(true);
			tx.onerror = () => reject(tx.error);
		} catch (e) { reject(e); }
	})).catch(() => false);
}

export function idbListFolders(docType) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_FOLDERS_STORE, "readonly");
			const req = tx.objectStore(IDB_FOLDERS_STORE).getAll();
			req.onsuccess = () => {
				let folders = req.result || [];
				if (docType) folders = folders.filter(f => f.docType === docType);
				resolve(folders.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
			};
			req.onerror = () => reject(req.error);
		} catch (e) { reject(e); }
	})).catch(() => []);
}
