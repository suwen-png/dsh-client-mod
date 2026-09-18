/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：多层级总监结构（对话级 / 文件夹级 / 全局级）
 * 引用：要求 1 · 17 号文 §2.1 · T-PLUG-009
 * 上游：bridge/nav-hook.js, client-entry.js, components/DirectorDialog.js, components/DirectorHierarchy.js, components/DirectorPage.js, components/DirectorWorkbench.js, components/MindMap.js, logic/dim-branch.js, logic/summarize.js, logic/sync.js, store/duty-config.js
 * 下游：store/idb.js, store/plugin-db.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
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
 * 存储决策（🔴 已按 docs/10 §3.4 订正 —— 独立库论证）
 *
 *   **T-PLUG-009 的旧结论（过度约束）**：宿主与插件共享 DB `dsh-director-db` v3，
 *   插件若升 v4，宿主再以 v3 打开会失败 ⇒ 故"全部层级节点只能存 `memoryCore`"。
 *
 *   **订正**：IndexedDB 的**版本协商只发生在同一个数据库名内**。
 *   `dsh-director-plugin-db` v1 是**另一个库**，完全不参与宿主的版本协商 ⇒ 对宿主零影响。
 *   ⇒ 「物理隔离（要求 1）」与「R5 冻结 key」**可以同时成立**，无需取舍。
 *
 *   现行策略（docs/10 §3.5 四阶段迁移）：
 *     ① 写入：**主写** `dsh-director-plugin-db/directorNodes`，
 *        **镜像** `memoryCore`（阶段 2 的兼容镜像，保证既有面板/脚本/存量不破）
 *     ② 读取：**先新库**；新库无该节点 → 回落旧 `memoryCore`（只读）
 *     ③ 迁移：`listAllNodes` 发现新库为空而旧库有条目时，**自动搬迁**（幂等，按 nodeId upsert）
 *     ④ 旧记录**不删**（尊重《锚点契约》"历史数据保留"）
 *
 * 全局契约：`window.__dshHierarchy`（供宿主/调试/验证脚本调用）
 */

import { openIDB, IDB_MEMORY_CORE_STORE } from "./idb.js";
import {
	saveDirectorNode as pdbSaveNode,
	getDirectorNode as pdbGetNode,
	listDirectorNodes as pdbListNodes,
	deleteDirectorNode as pdbDeleteNode,
	PLUGIN_DB_NAME
} from "./plugin-db.js";

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

/** 合法层级的**白名单**（由 LEVEL 单一真相源派生，勿另写字面量） */
const LEVEL_WHITELIST = Object.freeze(Object.keys(LEVEL).map((k) => LEVEL[k]));

/**
 * 判定一条 IDB 记录是否为「本模块的层级节点」。
 *
 * 🔴 为何必须是**白名单**而不是「有 level 就算」：
 *    `memoryCore` 是**与宿主共享**的 store（见文件头：不能升 v4 ⇒ 无法新增独立 store），
 *    插件记录与宿主记忆记录**同处一个 keyPath 命名空间**，只能靠字段形态区分。
 *    若写成 `n.level` 真值判断，则宿主记忆记录**只要哪天带上一个 `level` 字段**，
 *    就会被当成层级节点静默混入树中 —— 不报错、不崩溃，只是树里多出莫名其妙的节点，
 *    属「**约定失效即静默**」类缺陷（与 2026-09-12 那批「构建通过但运行时报错」同源）。
 *    故收紧为：`id` 必须是非空字符串 **且** `level` 必须**恰为**三值之一。
 *
 *    对既有记录**零行为差异**（现有 11 条全部通过），已由
 *    `scripts/verify-data-safe.mjs` 的「隔离性动态反证」实测覆盖。
 * @param {*} n
 * @returns {boolean}
 */
export function isHierarchyNode(n) {
	return Boolean(n)
		&& typeof n.id === "string" && n.id.length > 0
		&& LEVEL_WHITELIST.indexOf(n.level) >= 0;
}

/** 生成节点 id（层级前缀 + 时间戳 + 随机，避免碰撞） */
export function makeNodeId(level) {
	const p = level === LEVEL.GLOBAL ? "g" : level === LEVEL.PROJECT ? "p" : "s";
	return p + "_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * 创建层级节点（17号文 §2.1 MemoryNode 形态）
 * @param {object} p
 * @param {string} [p.id] 指定节点 id（自动同步必须用**数据源派生的稳定 id**，见 logic/discover.js）
 * @param {string} p.name 节点名
 * @param {"global"|"project"|"session"} p.level
 * @param {string|null} p.parentId 父节点 id（全局级为 null）
 */
export function makeNode({ id, name, level, parentId = null, meta = {} }) {
	const now = Date.now();
	return {
		id: level === LEVEL.GLOBAL ? GLOBAL_NODE_ID : (id || makeNodeId(level)),
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

/* ── IDB 读写 ────────────────────────────────────────────────
 * 主存：`dsh-director-plugin-db/directorNodes`（插件自有，物理隔离 —— 要求 1）
 * 镜像：旧 `dsh-director-db/memoryCore`（兼容镜像，阶段 2；旧记录不删 —— 阶段 4 前）
 * 兼容镜像开关（阶段 2→4）：置 false 即停止写旧库，届时旧库仅剩历史数据。
 * ------------------------------------------------------------------------- */
export const MIRROR_LEGACY_MEMORY_CORE = true;

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

/* ── 旧库（memoryCore）读写：仅用于回落与镜像 ── */
function legacyGet(id) {
	return tx("readonly", (s) => s.get(id)).then((r) => r || null).catch(() => null);
}
function legacyPut(node) {
	const next = { ...node, projectId: node.id, meta: { ...(node.meta || {}), updatedAt: Date.now() } };
	return tx("readwrite", (s) => s.put(next)).then(() => true).catch(() => false);
}
function legacyDel(id) {
	return tx("readwrite", (s) => s.delete(id)).then(() => true).catch(() => false);
}
function legacyList() {
	return tx("readonly", (s) => s.getAll())
		.then((r) => (r || []).filter(isHierarchyNode))
		.catch(() => []);
}

/**
 * 读取单个节点（双读：先插件自有库，再回落旧 memoryCore）
 * 回落到的记录**不会自动写回**（读路径保持只读语义），搬迁由 `listAllNodes` 统一负责。
 */
export async function getNode(id) {
	const hit = await pdbGetNode(id);
	if (hit) return hit;
	return legacyGet(id);
}

/**
 * 写入单个节点（**主写新库 + 镜像旧库**）
 *
 * 🔴 旧库 `memoryCore` 的 keyPath 是 **`projectId`**，而节点主键字段是 `id`。
 *    若不注入 `projectId`，`put()` 的 key 为 `undefined` → IndexedDB 抛 DataError，
 *    **写入静默失败**（catch 吞掉）。实测症状：createChild 返回节点但 loadTree 查不到、
 *    kids 为空。故镜像写入**必须**把 `projectId` 设为 `node.id`。
 *    （插件自有库的 keyPath 是 `nodeId`，由 `plugin-db.js` 内部映射，见其 JSDoc。）
 */
export async function saveNode(node) {
	if (!node || !node.id) return Promise.resolve(false);
	const okPrimary = await pdbSaveNode(node);
	if (MIRROR_LEGACY_MEMORY_CORE) await legacyPut(node);
	if (!okPrimary && typeof window !== "undefined" && window.__dshDebug) {
		window.__dshDebug.warn("hierarchy", "saveNode: 插件自有库写入失败，已回退镜像库（" + PLUGIN_DB_NAME + " 不可用？）");
	}
	return okPrimary || MIRROR_LEGACY_MEMORY_CORE;
}

/** 删除节点（同时把其从父级 children 摘除；新旧两库同删） */
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
	await pdbDeleteNode(id);
	return legacyDel(id);
}

/**
 * 全量拉取所有节点
 * ① 读插件自有库（**主真相源**）
 * ② 若为空而旧库有条目 ⇒ **自动搬迁**（阶段 3：把旧 memoryCore 的层级节点拷贝入新库，幂等）
 * ③ 过滤走 schema 白名单 `isHierarchyNode`（见其 JSDoc）
 */
export async function listAllNodes() {
	const primary = (await pdbListNodes()).filter(isHierarchyNode);
	if (primary.length) return primary;

	// 阶段 3：自动搬迁（幂等 —— 按 nodeId upsert，重复执行不会重复新建）
	const legacy = await legacyList();
	if (!legacy.length) return [];
	for (const n of legacy) {
		try { await pdbSaveNode(n); } catch (e) { /* 单条失败不阻断整体搬迁 */ }
	}
	const after = (await pdbListNodes()).filter(isHierarchyNode);
	// 搬迁未生效（自有库不可用）时，直接返回旧库结果，保证功能不因迁移而中断
	return after.length ? after : legacy;
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
	// 🔴 排序依据 `meta.order` 优先：自动同步的节点在同一毫秒内批量创建，
	//    若按 createdAt 排序则顺序不确定（每次刷新树都在抖）。
	//    同步时写入数据源中的序号 ⇒ 树顺序与宿主会话列表一致。
	const rank = (n) => (n.meta && typeof n.meta.order === "number") ? n.meta.order : (n.meta?.createdAt || 0);
	const sortRec = (node) => {
		node.childNodes.sort((a, b) => rank(a) - rank(b));
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

/* ══════════════════════════════════════════════════════════════════
 * 作用域（scope）—— **单一真相源**（2026-09-14 第 4 批 · 用户原话）
 * ══════════════════════════════════════════════════════════════════
 *  需求原文：
 *   ② 「我在下列表切换的时候，我下面的总监和对话数据也要一起变，就是相当于切对话了；
 *        切换文件夹的时候不需要对话，因为没有」
 *   ③ 「总监没有持久对话信息，比如总监信息和消息流转。总监是[和]文件夹对话绑定的，
 *        每一个文件夹和对话的总监数据理论上都不一样」
 *
 *  ⇒ 落地口径：**scope = 下拉选中的那个层级节点**（`directorLayoutStore.activeNodeId`）。
 *     全页只有这一处决定"现在在看谁"，其它地方一律调 `scopeKeyOf()` 取，不得各算各的。
 *
 *  scopeKey 的三态（**决定数据落到哪个桶**）：
 *     · 会话节点   → 该节点的 `conversations[0].conversationId`（真实会话 id）
 *     · 文件夹节点 → 节点 id 本身（`project` 级 = 文件夹级，**没有对话**）
 *     · 全局节点   → `__global__`（**没有对话**）
 *
 *  ⚠️ 为什么复用 nodeId 而不是每次都 `conversationId || nodeId` 就地算：
 *     就地算会散落到 5 处（DirectorPage / DirectorWorkbench / DirectorDialog /
 *     flow 写入 / 断言读属性），任何一处写漏都表现为"数据串桶"——
 *     正是用户这次报的"总监数据不跟着切"。收敛成一处才有唯一真相。
 */

/** 作用域种类（UI 上决定"要不要显示对话"，断言上读 `data-scope-kind`） */
export const SCOPE_KIND = Object.freeze({
	SESSION: "session",
	FOLDER: "folder",
	GLOBAL: "global"
});

/** 该节点挂载的真实会话 id（没有则 null）—— 文件夹/全局节点天然为 null */
export function nodeConversationId(node) {
	const c = node && Array.isArray(node.conversations) ? node.conversations[0] : null;
	return (c && c.conversationId) ? String(c.conversationId) : null;
}

/** 作用域种类：会话 / 文件夹(项目) / 全局 */
export function scopeKindOf(node) {
	if (!node) return SCOPE_KIND.GLOBAL;
	if (node.level === LEVEL.SESSION) return SCOPE_KIND.SESSION;
	if (node.level === LEVEL.PROJECT) return SCOPE_KIND.FOLDER;
	return SCOPE_KIND.GLOBAL;
}

/**
 * 作用域键 —— **数据分桶用的那一个字符串**。
 * 会话节点落到真实会话 id（与宿主 `sessionId` 同名同值 ⇒ 既有"点左侧切对话、
 * 插件跟随"的能力不变）；文件夹/全局落到节点 id（各自一份总监数据）。
 * @param {string} nodeId
 * @param {object|null} node
 * @returns {string}
 */
export function scopeKeyOf(nodeId, node) {
	return nodeConversationId(node) || String(nodeId || GLOBAL_NODE_ID);
}

/** 该作用域下"有没有对话"（文件夹/全局没有 ⇒ UI 不显示对话区，不编空对话） */
export function scopeHasConversation(node) {
	return scopeKindOf(node) === SCOPE_KIND.SESSION && Boolean(nodeConversationId(node));
}

/** 树里按 id 找节点（深度优先；找不到返回 null） */
export function findNodeById(root, id) {
	if (!root || !id) return null;
	let found = null;
	const walk = (n) => {
		if (found) return;
		if (n.id === id) { found = n; return; }
		(n.childNodes || []).forEach(walk);
	};
	walk(root);
	return found;
}

/**
 * 树里按**真实会话 id** 反查节点 —— 宿主侧切了会话时用它把下拉切过去
 * （这样"点左侧切对话 ⇒ 插件跟着切"仍在，且 scope 仍是唯一真相源）。
 * @returns {object|null}
 */
export function findNodeBySessionId(root, sessionId) {
	if (!root || !sessionId) return null;
	let found = null;
	const walk = (n) => {
		if (found) return;
		if (nodeConversationId(n) === String(sessionId)) { found = n; return; }
		(n.childNodes || []).forEach(walk);
	};
	walk(root);
	return found;
}

/** 安装全局契约 */
export function installHierarchyApi() {
	if (typeof window === "undefined") return null;
	window.__dshHierarchy = {
		LEVEL, LEVEL_LABEL, GLOBAL_NODE_ID,
		makeNode, makeNodeId, getNode, saveNode, removeNode,
		listAllNodes, loadTree, ensureGlobal, createChild, attachSession,
		resolveConfig, getBreadcrumb, countByLevel, isHigher,
		// 作用域单一真相源（2026-09-14 第 4 批）
		SCOPE_KIND, nodeConversationId, scopeKindOf, scopeKeyOf, scopeHasConversation,
		findNodeById, findNodeBySessionId,
		// 数据元归属（要求 1 的可核验锚点）
		PLUGIN_DB_NAME, MIRROR_LEGACY_MEMORY_CORE
	};
	return window.__dshHierarchy;
}
