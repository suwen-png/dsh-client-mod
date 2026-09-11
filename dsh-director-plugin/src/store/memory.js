/**
 * store/memory.js — A2 V9 记忆体系 CRUD
 *
 * 迁移源：client.js 5724 ~ 5798（75 行）
 *   区块标记：`// ========== V9: 记忆体系 CRUD ==========`
 *
 * 职责：V9 记忆体系的三个维度持久化：
 *   - memoryCore      核心记忆（按 projectId，含 conversationHistory / decisions / risks 摘要）
 *   - memoryDecisions 决策记录
 *   - memoryRisks     风险记录
 *
 * 全局契约：`window.__dshMemory = { idbSaveMemoryCore, idbGetMemoryCore, idbSaveDecision, idbListDecisions, idbSaveRisk, idbListRisks }`
 *   **宿主 client.js:11784 直接调用**（`__directChatSubmit` 内持久化用户消息到 conversationHistory，
 *   见 F4 / client.js:11787 起） —— 该契约不可改名。
 *
 * 错误处理：与原实现一致 —— catch 后返回安全缺省（false / null / []），不向上抛。
 * ⚠️ 故调用方不能以返回值判断"是否真的写入"（需回读校验）。
 */

import {
	openIDB,
	IDB_MEMORY_CORE_STORE,
	IDB_MEMORY_DECISIONS_STORE,
	IDB_MEMORY_RISKS_STORE
} from "./idb.js";

/** 核心记忆默认 projectId（原实现硬编码 "default"） */
export const MEMORY_DEFAULT_PROJECT_ID = "default";

export function idbSaveMemoryCore(core) {
	if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "保存核心记忆: projectId=" + (core && core.projectId) + " keys=" + (core ? Object.keys(core).join(",") : "null"));
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_MEMORY_CORE_STORE, "readwrite");
			tx.objectStore(IDB_MEMORY_CORE_STORE).put({ ...core, updatedAt: Date.now() });
			tx.oncomplete = () => { if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "核心记忆保存成功"); resolve(true); };
			tx.onerror = () => { if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "核心记忆保存失败: " + tx.error); reject(tx.error); };
		} catch (e) { if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "核心记忆保存异常: " + e.message); reject(e); }
	})).catch((e) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("memory", "idbSaveMemoryCore failed: " + e.message); return false; });
}

export function idbGetMemoryCore(projectId) {
	if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "读取核心记忆: projectId=" + (projectId || MEMORY_DEFAULT_PROJECT_ID));
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_MEMORY_CORE_STORE, "readonly");
			const req = tx.objectStore(IDB_MEMORY_CORE_STORE).get(projectId || MEMORY_DEFAULT_PROJECT_ID);
			req.onsuccess = () => { if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "核心记忆读取结果: " + (req.result ? "有数据 keys=" + Object.keys(req.result).join(",") : "无数据")); resolve(req.result || null); };
			req.onerror = () => reject(req.error);
		} catch (e) { reject(e); }
	})).catch(() => null);
}

export function idbSaveDecision(decision) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_MEMORY_DECISIONS_STORE, "readwrite");
			tx.objectStore(IDB_MEMORY_DECISIONS_STORE).put({ ...decision, updatedAt: Date.now() });
			tx.oncomplete = () => resolve(true);
			tx.onerror = () => reject(tx.error);
		} catch (e) { reject(e); }
	})).catch(() => false);
}

export function idbListDecisions(projectId) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_MEMORY_DECISIONS_STORE, "readonly");
			const req = tx.objectStore(IDB_MEMORY_DECISIONS_STORE).getAll();
			req.onsuccess = () => {
				let list = req.result || [];
				if (projectId) list = list.filter(d => d.projectId === projectId);
				resolve(list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
			};
			req.onerror = () => reject(req.error);
		} catch (e) { reject(e); }
	})).catch(() => []);
}

export function idbSaveRisk(risk) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_MEMORY_RISKS_STORE, "readwrite");
			tx.objectStore(IDB_MEMORY_RISKS_STORE).put({ ...risk, updatedAt: Date.now() });
			tx.oncomplete = () => resolve(true);
			tx.onerror = () => reject(tx.error);
		} catch (e) { reject(e); }
	})).catch(() => false);
}

export function idbListRisks(projectId) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_MEMORY_RISKS_STORE, "readonly");
			const req = tx.objectStore(IDB_MEMORY_RISKS_STORE).getAll();
			req.onsuccess = () => {
				let list = req.result || [];
				if (projectId) list = list.filter(r => r.projectId === projectId);
				resolve(list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
			};
			req.onerror = () => reject(req.error);
		} catch (e) { reject(e); }
	})).catch(() => []);
}

/** 安装全局契约 `window.__dshMemory`（宿主 F4 依赖） */
export function installMemoryApi() {
	if (typeof window === "undefined") return null;
	window.__dshMemory = { idbSaveMemoryCore, idbGetMemoryCore, idbSaveDecision, idbListDecisions, idbSaveRisk, idbListRisks };
	return window.__dshMemory;
}
