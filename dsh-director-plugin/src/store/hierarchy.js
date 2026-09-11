/**
 * store/hierarchy.js — 多层级总监结构（对话级 / 文件夹级 / 全局级）
 *
 * 需求来源（严格按文档，勿自行改动）：
 *   - 03-总监对话模式开发文档.md §1.3 三层总监体系（:42-52）
 *       全局总管 → 项目总监（文件夹级）→ 会话总监（当前会话）
 *   - 同上 §3.2 继承制：默认（全局）→ 项目级 → 会话级，子级可覆盖、可向上提交（:150-167）
 *   - 17-总监统治架构与项目驾驶舱方案-v9.md §2.1 三层记忆结构 MemoryNode（:365-428）
 *   - 同上 §2.3 隔离 / 共享 / 继承（:443-447）
 *
 * 存储决策（🔴 关键约束：不得新增 IDB store、不得升 DB 版本）
 *   宿主与插件共享 DB `dsh-director-db` v3（R5 兼容约束）。插件若升 v4，
 *   宿主再以 v3 打开会失败 ⇒ 版本冲突。故**全部层级节点统一存 `memoryCore`**
 *   （keyPath `projectId`，这里以 nodeId 作为 projectId），与 17号文
 *   MemoryNode「level: global|project|subproject + parentId + children[]」定义一致。
 *
 * 全局契约：`window.__dshHierarchy`（供宿主/调试/验证脚本调用）
 */

import { openIDB, IDB_MEMORY_CORE_STORE } from "./idb.js";

/** 层级枚举（对齐 17号文 §2.1 `level`） */
export const LEVEL = {
	GLOBAL: "global",
	PROJECT: "project",
	SESSION: "session"
};

/** 层级中文名（UI 用） */
export const LEVEL_LABEL = {
	global: "全局总管",
	project: "项目总监",
	session: "会话总监"
};

/** 全局根节点固定 id（唯一，单例） */
export const GLOBAL_NODE_ID = "__global__";

/** 层级顺序（数字越小越高层） */
const LEVEL_ORDER = { global: 0, project: 1, session: 2 };

/** 生成节点 id（层级前缀 + 时间戳 + 随机，避免碰撞） */
export function makeNodeId(level) {
	const p = level === LEVEL.GLOBAL ? "g" : level === LEVEL.PROJECT ? "p" : "s";
	return p + "_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * 创建层级节点（17号文 §2.1 MemoryNode 形态）
 * @param {object} p
 * @param {string} p.name 节点名
 * @param {"global"|"project"|"session"} p.level
 * @param {string|null} p.parentId 父节点 id（全局级为 null）
 */
export function makeNode({ name, level, parentId = null, meta = {} }) {
	const now = Date.now();
	return {
		id: level === LEVEL.GLOBAL ? GLOBAL_NODE_ID : makeNodeId(level),
		name: name || "未命名",
		level,
		parentId: level === LEVEL.GLOBAL ? null : parentId,
		children: [],
		meta: {
			positioning: "",
			goal: "",
			currentPhase: "",
			...meta,
			createdAt: now,
			updatedAt: now
		},
		docs: [],
		conversations: [],
		decisions: [],
		todos: [],
		risks: [],
		/** 分层总结产物（由 logic/summarize.js 写入） */
		summary: null,
		/** 总结梯度：G0 规则 / G1 本地模型 / G2 上层汇总 */
		summaryGrade: null,
		summaryAt: 0,
		/** 配置继承（03号文 §3.2）：null = 继承父级；非 null = 本级覆盖 */
		configOverride: null
	};
}

/* ── IDB 读写（统一走 memoryCore） ───────────────────────────── */

function tx(mode, fn) {
	return openIDB().then((db) => new Promise((resolve, reject) => {
		try {
			const t = db.transaction(IDB_MEMORY_CORE_STORE, mode);
			const req = fn(t.objectStore(IDB_MEMORY_CORE_STORE));
			t.oncomplete = () => resolve(req ? req.result : undefined);
			t.onerror = () => reject(t.error);
		} catch (e) { reject(e); }
	}));
}

/** 读取单个节点 */
export function getNode(id) {
	return tx("readonly", (s) => s.get(id)).then((r) => r || null).catch(() => null);
}

/**
 * 写入单个节点（自动维护 updatedAt）
 *
 * 🔴 关键：`memoryCore` 的 keyPath 是 **`projectId`**（见 store/idb.js），
 *    而层级节点的主键字段是 `id`。若不注入 `projectId`，`put()` 的 key 为
 *    `undefined` → IndexedDB 抛 DataError，**写入静默失败**（catch 吞掉）。
 *    实测症状：createChild 返回节点但 loadTree 查不到、kids 为空。
 *    故此处**必须**把 `projectId` 设为 `node.id`（即以 nodeId 作为 projectId）。
 */
export function saveNode(node) {
	if (!node || !node.id) return Promise.resolve(false);
	const next = { ...node, projectId: node.id, meta: { ...(node.meta || {}), updatedAt: Date.now() } };
	return tx("readwrite", (s) => s.put(next)).then(() => true).catch((e) => {
		if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("hierarchy", "saveNode failed: " + (e && e.message));
		return false;
	});
}

/** 删除节点（同时把其从父级 children 摘除） */
export async function removeNode(id) {
	const node = await getNode(id);
	if (!node) return false;
	if (node.parentId) {
		const parent = await getNode(node.parentId);
		if (parent) {
			parent.children = (parent.children || []).filter((c) => c !== id);
			await saveNode(parent);
		}
	}
	// 子级升到祖父，避免孤儿
	for (const cid of node.children || []) {
		const child = await getNode(cid);
		if (child) { child.parentId = node.parentId; await saveNode(child); }
	}
	return tx("readwrite", (s) => s.delete(id)).then(() => true).catch(() => false);
}

/** 全量拉取所有节点 */
export function listAllNodes() {
	return tx("readonly", (s) => s.getAll())
		.then((r) => (r || []).filter((n) => n && n.level))
		.catch(() => []);
}

/**
 * 构建层级树（返回根节点数组，节点带 `childNodes`）
 * 注意：全局级为单例根；游离节点的 parentId 若不存在则挂到全局根下（自愈）。
 */
export async function loadTree() {
	const all = await listAllNodes();
	const byId = new Map();
	for (const n of all) byId.set(n.id, { ...n, childNodes: [] });

	let root = byId.get(GLOBAL_NODE_ID);
	if (!root) {
		root = { ...makeNode({ name: "全局总管", level: LEVEL.GLOBAL }), childNodes: [] };
		byId.set(GLOBAL_NODE_ID, root);
		await saveNode(root);
	}

	for (const n of byId.values()) {
		if (n.id === GLOBAL_NODE_ID) continue;
		const parent = n.parentId ? byId.get(n.parentId) : null;
		(parent || root).childNodes.push(n);
	}
	const sortRec = (node) => {
		node.childNodes.sort((a, b) => (a.meta?.createdAt || 0) - (b.meta?.createdAt || 0));
		node.childNodes.forEach(sortRec);
	};
	sortRec(root);
	return root;
}

/** 确保全局根存在 */
export async function ensureGlobal() {
	const root = await getNode(GLOBAL_NODE_ID);
	if (root) return root;
	const node = makeNode({ name: "全局总管", level: LEVEL.GLOBAL });
	await saveNode(node);
	return node;
}

/**
 * 创建子节点并挂到父级（自动维护父级 children）
 * @returns {Promise<object>} 新建节点
 */
export async function createChild(parentId, { name, level, meta }) {
	const parent = await getNode(parentId);
	const node = makeNode({ name, level, parentId, meta });
	await saveNode(node);
	if (parent) {
		parent.children = [...(parent.children || []), node.id];
		await saveNode(parent);
	}
	return node;
}

/** 登记/挂载一个会话到文件夹级节点（03号文 §1.3「会话总监」） */
export async function attachSession(folderId, { sessionId, title, messageCount = 0, lastMessage = "" }) {
	const folder = await getNode(folderId);
	const node = makeNode({
		name: title || sessionId,
		level: LEVEL.SESSION,
		parentId: folder ? folderId : GLOBAL_NODE_ID
	});
	node.conversations = [{
		conversationId: sessionId,
		title: title || sessionId,
		lastMessage,
		lastTime: Date.now(),
		messageCount
	}];
	await saveNode(node);
	const parent = folder || (await getNode(GLOBAL_NODE_ID));
	if (parent) {
		parent.children = [...(parent.children || []), node.id];
		await saveNode(parent);
	}
	return node;
}

/**
 * 配置继承解析（03号文 §3.2 + 17号文 §2.3「继承但可覆盖」）
 * 从根向下依次覆盖，返回最终生效配置 + 每一项的来源层级。
 * @param {string} nodeId
 * @param {object} defaultConfig 全局默认配置
 */
export async function resolveConfig(nodeId, defaultConfig) {
	const chain = [];
	let cur = await getNode(nodeId);
	while (cur) {
		chain.unshift(cur);
		cur = cur.parentId ? await getNode(cur.parentId) : null;
	}
	let merged = { ...(defaultConfig || {}) };
	const origin = {};
	for (const n of chain) {
		if (n.configOverride && typeof n.configOverride === "object") {
			for (const k of Object.keys(n.configOverride)) {
				merged[k] = n.configOverride[k];
				origin[k] = n.level;
			}
		}
	}
	return { config: merged, origin, chain: chain.map((n) => ({ id: n.id, name: n.name, level: n.level })) };
}

/** 面包屑（根 → 当前） */
export async function getBreadcrumb(nodeId) {
	const out = [];
	let cur = await getNode(nodeId);
	let guard = 0;
	while (cur && guard++ < 20) {
		out.unshift({ id: cur.id, name: cur.name, level: cur.level });
		cur = cur.parentId ? await getNode(cur.parentId) : null;
	}
	return out;
}

/** 按层级计数（含自身） */
export function countByLevel(root) {
	const acc = { global: 0, project: 0, session: 0, total: 0 };
	const walk = (n) => {
		acc[n.level] = (acc[n.level] || 0) + 1;
		acc.total++;
		(n.childNodes || []).forEach(walk);
	};
	if (root) walk(root);
	return acc;
}

/** 层级比较：a 是否高于 b */
export function isHigher(a, b) {
	return (LEVEL_ORDER[a] ?? 99) < (LEVEL_ORDER[b] ?? 99);
}

/** 安装全局契约 */
export function installHierarchyApi() {
	if (typeof window === "undefined") return null;
	window.__dshHierarchy = {
		LEVEL, LEVEL_LABEL, GLOBAL_NODE_ID,
		makeNode, makeNodeId, getNode, saveNode, removeNode,
		listAllNodes, loadTree, ensureGlobal, createChild, attachSession,
		resolveConfig, getBreadcrumb, countByLevel, isHigher
	};
	return window.__dshHierarchy;
}
