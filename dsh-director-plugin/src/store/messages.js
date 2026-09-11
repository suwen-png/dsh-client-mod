/**
 * store/messages.js — A1 总监消息 store（内存层）
 *
 * 迁移源：client.js 5495 ~ 5498
 *   区块标记：`// ========== 总监对话模式 - 消息store ==========`
 *
 * 职责：按 sessionId 分桶的内存消息缓存层。
 *   - `directorStores` 是 `Map<sessionId, store>`，**进程内单例**
 *   - `DIRECTOR_STORE_PREFIX` 是 localStorage 回退层的 key 前缀（IDB 为主，此为兜底）
 *
 * ⚠️ 兼容约束（R5）：`DIRECTOR_STORE_PREFIX = "dsh.director.store."` **不可改名**，
 *    用户存量数据的 localStorage key 依赖此前缀。
 *
 * 与 store/idb.js 的关系：
 *   - 内存 Map（本模块）→ 一级缓存，读写同步、最快
 *   - IndexedDB（idb.js）→ 持久化主层
 *   - localStorage/cookie（cookie.js + 本模块 prefix）→ 降级兜底
 *   组装逻辑在 A9 `createDirectorStore`（批次 3）。
 */

export const DIRECTOR_STORE_PREFIX = "dsh.director.store.";

/** sessionId → store 的内存注册表（原 client.js 的 `directorStores`） */
export const directorStores = new Map();

/** 取（或按需创建）某 session 的 store */
export function getDirectorStore(sessionId, factory) {
	if (directorStores.has(sessionId)) return directorStores.get(sessionId);
	if (typeof factory !== "function") return null;
	const store = factory(sessionId);
	directorStores.set(sessionId, store);
	return store;
}

/** 判断是否已有该 session 的 store（不触发创建） */
export function hasDirectorStore(sessionId) { return directorStores.has(sessionId); }

/** 移除某 session 的 store（会话关闭/清理） */
export function removeDirectorStore(sessionId) { return directorStores.delete(sessionId); }

/** 清空全部内存 store（登出/重置；不影响 IDB） */
export function clearDirectorStores() { directorStores.clear(); }

/** localStorage 回退层的 key */
export function directorStoreLsKey(sessionId) { return DIRECTOR_STORE_PREFIX + sessionId; }
