/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：设计图数据层（文档 CRUD + 元素操作 + 专用临时对话）
 * 引用：V16 诉求 2 · 5（逻辑全实现 + 指令过确认闸门）+ 2026-09-12 诉求 10（保存与版本） · 要求 1
 * 上游：client-entry.js, components/DesignStudio.js, mount.js
 * 下游：store/design-schema.js, store/plugin-db.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 D5 · D6（元素操作 + 指令解析）· E3（版本 API）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/design.js — 设计图数据层（文档 CRUD + 元素操作 + 专用临时对话）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 D】
 *   ├─ D1 全屏工作室布局     → components/DesignStudio.js
 *   ├─ D2/D4 元素原子与模板   → store/design-schema.js
 *   ├─ D5 元素操作（本文件）   → add/update/move/resize/remove/duplicate/reorder
 *   └─ D6 设计图专用对话（本文件 thread）
 *
 * ══════════════════════════════════════════════════════════════════
 *  三条隔离（用户要求「属于新开的临时对话 只处理设计图」）
 * ══════════════════════════════════════════════════════════════════
 *   ① **不与宿主会话共用**：设计图 thread 存在本文件自己的 key，
 *      既不写宿主的 session store，也不调 `sendToChat`。
 *   ② **不与总监对话共用**：总监消息在 `plugin-db/directorConversations`，
 *      设计图 thread 在 `dsh.director.design`。两者互不可见。
 *   ③ **一图一线程**：每份设计图文档自带 `thread`，删图即删线
 *      （临时对话的字面含义：它只服务于这一份图）。
 *
 * ══════════════════════════════════════════════════════════════════
 *  持久化：localStorage 主 + plugin-db 备份（双写）
 * ══════════════════════════════════════════════════════════════════
 *   为什么不是只用 IDB：
 *     设计图数据量小（几十元素 ≈ 20KB），而 IDB 是**异步**的 —— 拖拽过程中每帧都
 *     落库会产生竞态。localStorage 同步写可保证「拖完即存」。
 *   为什么还要 IDB：
 *     符合要求 1「独立数据元」，且 IDB 容量不受 5MB 限制，便于后续存大图。
 *   读取以 localStorage 为准（同步、必定最新）；IDB 为冷备。
 *
 *  🔴 R5 冻结项：本文件**不碰** `dsh.director.store.*` / `dsh.director.layout` /
 *     `director-main` / `dsh.director.config` / `dsh-director-db` / cookie 前缀。
 *     `dsh.director.design` 是**新增键**（冻结清单之外），安全。
 *
 * 错误处理：所有持久化 API catch 后返回安全缺省，不向上抛（与 store/idb.js 一致）。
 */

import {
	ELEMENT_KINDS, createElement, normalizeElement, isRenderable,
	createDesignDoc, normalizeDoc, docStats, buildStandardFrame, CANVAS_W, CANVAS_H, MIN_SIZE,
	// 版本快照（2026-09-12 新增 · 需求「保存 + 不同版本的选择」）
	createVersion, versionSummary, cloneElements, VERSION_LIMIT, syncSeqFrom
} from "./design-schema.js";
// 冷备通道（兑现文件头「localStorage 主 + plugin-db 备份（双写）」的承诺）
import { pPut, pGet, PDB } from "./plugin-db.js";

/* ══════════════════════════════════════════════════════════════════
 * 存储键与内存态
 * ══════════════════════════════════════════════════════════════════ */

/** localStorage 键（新增键，不在 R5 冻结清单内） */
export const DESIGN_KEY = "dsh.director.design";
/** 设计图专用对话的角色（区别于总监的 user/director） */
export const DESIGN_ROLE = Object.freeze({ USER: "user", STUDIO: "studio" });

let state = { docs: [], activeDocId: null, loaded: false };

/** 冷备快照在 `directorDesigns` 里的固定主键（整图集一条，读写都简单） */
const BACKUP_ID = "snapshot";

/**
 * 落盘 —— **双写**（兑现文件头承诺）
 *   主：localStorage（同步、拖完即存、必定最新）
 *   冷备：plugin-db/directorDesigns（异步、失败不影响主流程、容量不受 5MB 限制）
 *
 * 🔴 为什么必须真的写 IDB（2026-09-12 教训）：
 *   文件头原本已写「双写」，但 `persist()` 只写了 localStorage —— **注释与代码背离**。
 *   而真机实测：Harness 每次启动的本地 HTTP 端口会变（2606 → 28931 → 32196），
 *   localStorage 又是**按 origin（含端口）分区**的 ⇒ 主存有丢失风险。
 *   故冷备不是"以后可能有用"，而是**当前就有实际价值的兜底**。
 */
function persist() {
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(DESIGN_KEY, JSON.stringify({ docs: state.docs, activeDocId: state.activeDocId }));
		}
	} catch (e) { /* 隐私模式 / 配额满：不影响内存态 */ }
	try {
		// 不 await：拖拽路径上不能引入异步抖动；失败静默（冷备允许落后）
		pPut(PDB.DESIGNS, {
			designId: BACKUP_ID,
			docs: state.docs,
			activeDocId: state.activeDocId,
			savedAt: Date.now()
		});
	} catch (e) { /* IDB 不可用：降级为仅 localStorage */ }
}

let backupTried = false;
/**
 * 冷备恢复 —— **仅当主存为空时**执行一次。
 * 触发时机：`installDesignApi()`（插件装载早期），异步补齐并 notify。
 * @returns {Promise<{restored:number, savedAt:number}|null>}
 */
export function hydrateDesignBackup() {
	if (backupTried) return Promise.resolve(null);
	backupTried = true;
	try {
		load();
		if (typeof localStorage !== "undefined" && localStorage.getItem(DESIGN_KEY)) return Promise.resolve(null); // 主存有数据，无需恢复
		if (state.docs.length) return Promise.resolve(null);
	} catch (e) { return Promise.resolve(null); }
	return pGet(PDB.DESIGNS, BACKUP_ID).then((rec) => {
		if (!rec || !(rec.docs || []).length) return null;
		const docs = (rec.docs || []).map(normalizeDoc).filter(Boolean);
		if (!docs.length) return null;
		state = { docs, activeDocId: rec.activeDocId || (docs[0] && docs[0].docId) || null, loaded: true };
		persist();   // 回灌主存，下一轮不必再走冷备
		notify();
		return { restored: docs.length, savedAt: rec.savedAt || null };
	}).catch(() => null);
}
function load() {
	if (state.loaded) return;
	state.loaded = true;
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DESIGN_KEY) : null;
		if (!raw) return;
		const parsed = JSON.parse(raw);
		const docs = (parsed && parsed.docs ? parsed.docs : []).map(normalizeDoc).filter(Boolean);
		state = { docs, activeDocId: parsed.activeDocId || (docs[0] && docs[0].docId) || null, loaded: true };
	} catch (e) { /* 解析失败 → 空库，不抛 */ }
}

/* ══════════════════════════════════════════════════════════════════
 * 订阅（React 侧 useSyncExternalStore 可用；也供真机测试观察变更）
 * ══════════════════════════════════════════════════════════════════ */

const listeners = new Set();
let version = 0;
function notify() {
	version += 1;
	for (const fn of listeners) { try { fn(state, version); } catch (e) { /* 单订阅者异常不影响其他 */ } }
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getVersion() { return version; }
export function getState() { load(); return state; }
export function getActiveDoc() {
	load();
	return state.docs.find((d) => d.docId === state.activeDocId) || null;
}

/* ══════════════════════════════════════════════════════════════════
 * 文档 CRUD
 * ══════════════════════════════════════════════════════════════════ */

/** 列出全部设计图（摘要，不含 elements，避免大对象外泄） */
export function listDocs() {
	load();
	return state.docs.map((d) => ({
		docId: d.docId, title: d.title, revision: d.revision,
		count: (d.elements || []).length, updatedAt: d.updatedAt
	}));
}

export function getDoc(docId) {
	load();
	return state.docs.find((d) => d.docId === docId) || null;
}

/** 新建设计图（默认铺标准框架），并设为当前图 */
export function newDoc(patch = {}) {
	load();
	const doc = createDesignDoc(patch);
	state = { docs: state.docs.concat([doc]), activeDocId: doc.docId, loaded: true };
	persist();
	notify();
	return doc;
}

/**
 * 写回一份文档到库 —— **统一出口**（替换 + persist + notify）。
 * 🔴 抽出来的理由：`saveDoc` 与版本 API（saveVersion / restoreVersion / renameDoc / deleteVersion）
 *    做的是同一件事。若各写一遍，就有 5 处可能漏 `persist()` 或漏 `notify()` ——
 *    而**漏 notify 的表现是"数据存了但界面不动"**，最难查（数据是对的，看起来像 UI bug）。
 *    此处只做"替换 + 双写 + 广播"，不含任何业务判断。
 */
function putDoc(next) {
	if (!next || !next.docId) return null;
	load();
	const i = state.docs.findIndex((d) => d.docId === next.docId);
	const docs = i >= 0
		? state.docs.slice(0, i).concat([next], state.docs.slice(i + 1))
		: state.docs.concat([next]);
	state = { ...state, docs };
	persist();
	notify();
	return next;
}

/** 保存（整体替换该图，revision +1） */
export function saveDoc(doc) {
	if (!doc || !doc.docId) return null;
	load();
	const next = { ...doc, updatedAt: Date.now(), revision: Number(doc.revision || 0) + 1 };
	const i = state.docs.findIndex((d) => d.docId === doc.docId);
	const docs = i >= 0 ? state.docs.slice(0, i).concat([next], state.docs.slice(i + 1)) : state.docs.concat([next]);
	state = { ...state, docs };
	persist();
	notify();
	return next;
}

export function deleteDoc(docId) {
	load();
	const docs = state.docs.filter((d) => d.docId !== docId);
	const activeDocId = state.activeDocId === docId ? ((docs[0] && docs[0].docId) || null) : state.activeDocId;
	state = { docs, activeDocId, loaded: true };
	persist();
	notify();
	return true;
}

export function setActiveDoc(docId) {
	load();
	state = { ...state, activeDocId: docId || null };
	persist();
	notify();
	return state.activeDocId;
}

/* ══════════════════════════════════════════════════════════════════
 * 版本快照 API（2026-09-12 新增 · 用户需求「也没有保存 和不同版本的选择」）
 *
 *   语义分工（这是本组函数存在的理由）：
 *     `revision`  —— **自动落盘代数**，每次写库 +1（拖拽也 +1）。证明"存过"，不证明"留过"。
 *     `versions[]`—— **用户显式保存的版本**。只在点【保存】时生成，可命名、可回滚。
 *   所以顶栏显示的不是 revision，而是"未保存 / 已保存 v3"。
 * ══════════════════════════════════════════════════════════════════ */

/** logic 七元组做稳定序列化（键排序）—— 否则 `{a,b}` 与 `{b,a}` 会被误判为"有改动" */
function stableLogic(l) {
	const o = l || {};
	return Object.keys(o).sort().map((k) => k + "=" + String(o[k] == null ? "" : o[k])).join("\u0001");
}

/**
 * 逐元素比对两份 elements 是否等价（id/几何/标签/逻辑）。
 * 只比**会影响图的样子**的字段：props 不参与（它是预留扩展位，未接线，比它会造成假"脏"）。
 */
export function sameElements(a, b) {
	const A = a || [], B = b || [];
	if (A.length !== B.length) return false;
	for (let i = 0; i < A.length; i++) {
		const x = A[i], y = B[i];
		if (!x || !y) return false;
		if (x.id !== y.id || x.kind !== y.kind) return false;
		if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h || x.z !== y.z) return false;
		if (String(x.label) !== String(y.label)) return false;
		if (stableLogic(x.logic) !== stableLogic(y.logic)) return false;
	}
	return true;
}

/**
 * 找出「内容与当前工作副本一致」的版本（**从新到旧**找，命中即返回）；没有则 null。
 * 它是脏判定的真正基准 —— 见 isDirty 的说明。
 */
export function matchVersion(doc) {
	if (!doc) return null;
	const vs = doc.versions || [];
	const els = doc.elements || [];
	for (let i = vs.length - 1; i >= 0; i--) {
		if (sameElements(vs[i].elements, els)) return vs[i];
	}
	return null;
}

/**
 * 当前工作副本是否有**未保存改动**。
 *
 * 🔴 判据是「当前内容是否**已经存在于某个版本里**」，而**不是**"是否等于最后一版"。
 *    反例是离线测试 C5 抓出来的（真机必现）：
 *      回滚到 v1 时，store 会先把回滚前的内容自动存成 v2（保护用户刚做的东西）⇒
 *      "最新版本"变成了 v2，而当前内容等于 v1
 *      ⇒ 用"等于最后一版"判 ⇒ 刚回滚完的界面被标成「有未保存改动」。
 *      用户看到的是：**内容明明回去了，顶栏却说没存** ⇒ 会怀疑回滚没生效，再点一次。
 *      这属于「状态提示骗人」，比不提示更糟。
 *    改成"是否存在于任一个版本里"后：
 *      · 回滚完 ⇒ 内容 = v1 ⇒ 干净（正确）
 *      · 刚保存 ⇒ 内容 = 刚存的那版 ⇒ 干净（正确）
 *      · 拖了一下 ⇒ 没有任何版本等于它 ⇒ 脏（正确）
 *    代价是 O(版本数 × 元素数)（上限 30×20=600 次字段比较），每帧可忽略。
 *
 * 从未保存过（versions 为空）：有元素就算"未保存"，空图算"干净"（空图没什么可保存的）。
 */
export function isDirty(doc) {
	if (!doc) return false;
	const vs = doc.versions || [];
	if (!vs.length) return ((doc.elements || []).length > 0);
	return matchVersion(doc) === null;
}

/** 顶栏状态一屏取（避免组件里自己拼三处逻辑，出现"角标说 3、按钮说 v2"这类不一致） */
export function getVersionState(doc) {
	if (!doc) return { dirty: false, count: 0, last: null, match: null, label: "无图" };
	const vs = doc.versions || [];
	const last = vs.length ? versionSummary(vs[vs.length - 1]) : null;
	const m = matchVersion(doc);
	const dirty = vs.length ? (m === null) : ((doc.elements || []).length > 0);
	return {
		dirty, count: vs.length, last,
		match: m ? versionSummary(m) : null,
		label: !vs.length ? "未保存" : (dirty ? "未保存改动" : "已保存 " + versionSummary(m).label)
	};
}

/**
 * 保存一个版本（用户点【保存】时调用）。
 * @param {object} doc 当前工作副本
 * @param {string} [note] 版本说明（建议写"改了什么"，日后靠它指称）
 * @returns {{doc:object, version:object, dropped:number}|null}
 */
export function saveVersion(doc, note = "") {
	if (!doc || !doc.docId) return null;
	load();
	const v = createVersion(doc, { note });
	let vs = (doc.versions || []).concat([v]);
	/* 限流：超上限淘汰最旧。**不静默** —— 返回 dropped 让 UI 能提示"已淘汰最早的 1 个版本"。 */
	const dropped = Math.max(0, vs.length - VERSION_LIMIT);
	if (dropped) vs = vs.slice(dropped);
	const next = { ...doc, versions: vs, updatedAt: Date.now() };
	putDoc(next);
	return { doc: next, version: versionSummary(v), dropped };
}

/** 列出某图的版本摘要（**新的在前** —— 列表第一项就是"最近保存的"） */
export function listVersions(docId) {
	load();
	const d = state.docs.find((x) => x.docId === docId);
	if (!d) return [];
	return (d.versions || []).map(versionSummary).reverse();
}

/**
 * 回滚到指定版本 —— **回滚前自动存档**。
 *
 * 🔴 「回滚前自动存档」是硬约束，不是可选优化：
 *    回滚会覆盖工作副本；若不先存档，用户花十分钟拖的布局会被一次误点**不可逆地清掉**。
 *    这与 e2e C 系列断言（回滚后元素恢复）不冲突：存档只**追加**版本，不改回滚目标内容。
 *
 * @returns {{doc:object, from:object, autoSaved:boolean}|null} 目标版本不存在时返回 null
 */
export function restoreVersion(docId, vid) {
	load();
	const d = state.docs.find((x) => x.docId === docId);
	if (!d) return null;
	const v = (d.versions || []).find((x) => x.vid === vid);
	if (!v) return null;
	let vs = (d.versions || []).slice();
	let autoSaved = false;
	// 当前状态与最新版本不同才存（相同则存档等于刷一个重复版本）
	if (!sameElements((vs[vs.length - 1] || {}).elements, d.elements)) {
		vs = vs.concat([createVersion(d, { note: "回滚前自动存档" })]);
		if (vs.length > VERSION_LIMIT) vs = vs.slice(vs.length - VERSION_LIMIT);
		autoSaved = true;
	}
	const elements = cloneElements(v.elements);
	syncSeqFrom(elements);   // 版本元素 id 与工作副本同源，此处仅为护栏
	const next = {
		...d, elements, versions: vs, updatedAt: Date.now(),
		revision: Number(d.revision || 0) + 1   // 回滚也是一次内容变更，revision 照常 +1
	};
	putDoc(next);
	return { doc: next, from: versionSummary(v), autoSaved };
}

/** 删除单个版本（删到 0 个属合法：等于回到"未保存"） */
export function deleteVersion(docId, vid) {
	load();
	const d = state.docs.find((x) => x.docId === docId);
	if (!d) return null;
	const vs = (d.versions || []).filter((x) => x.vid !== vid);
	if (vs.length === (d.versions || []).length) return null;   // 没找到，不算成功
	const next = { ...d, versions: vs, updatedAt: Date.now() };
	putDoc(next);
	return next;
}

/** 重命名设计图（标题是"身份"不参与版本快照 ⇒ 回滚不会把名字带走） */
export function renameDoc(docId, title) {
	load();
	const d = state.docs.find((x) => x.docId === docId);
	if (!d) return null;
	const t = String(title == null ? "" : title).trim();
	if (!t) return null;   // 空名拒绝（而不是静默改成"未命名"——空名是用户手滑）
	const next = { ...d, title: t.slice(0, 60), updatedAt: Date.now() };
	putDoc(next);
	return next;
}

/**
 * 复制设计图。
 * **不带版本历史**：副本是"从现在开始"的新图，继承历史版本会让版本号来源含混
 * （副本里出现"回滚前自动存档"这种属于原图的记录）。
 */
export function duplicateDoc(docId) {
	load();
	const d = state.docs.find((x) => x.docId === docId);
	if (!d) return null;
	const copy = createDesignDoc({
		title: d.title + " · 副本",
		frameKey: d.frameKey,
		elements: cloneElements(d.elements),
		thread: []
	});
	state = { docs: state.docs.concat([copy]), activeDocId: copy.docId, loaded: true };
	persist();
	notify();
	return copy;
}

/** 整体重置（仅测试/调试；不碰宿主任何数据） */
export function resetDesignStore() {
	state = { docs: [], activeDocId: null, loaded: true };
	persist();
	notify();
	return true;
}

/* ══════════════════════════════════════════════════════════════════
 * 元素操作 —— 全部是**纯函数**（入参 doc 不被修改，返回新 doc）
 *   纯函数便于 vitest 直接断言，无需渲染 React，也无需 DOM。
 * ══════════════════════════════════════════════════════════════════ */

/** 把 doc 的 elements 换掉并返回新 doc（不落库；由调用方决定何时 saveDoc） */
function withElements(doc, elements) {
	if (!doc) return null;
	return { ...doc, elements: elements.filter(Boolean), updatedAt: Date.now() };
}

const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 增加元素（用户要求「允许…增加元素」）。
 * @param {object} doc
 * @param {string} kind ELEMENT_KINDS key
 * @param {{x?:number,y?:number}} [at] 落点；缺省放在画布中上部并做层叠偏移
 */
export function addElement(doc, kind, at = {}) {
	if (!doc) return null;
	const n = (doc.elements || []).length;
	const el = createElement(kind, {
		x: at.x != null ? at.x : 40 + (n % 12) * 18,
		y: at.y != null ? at.y : 40 + (n % 12) * 16,
		z: maxZ(doc) + 1
	});
	if (!el) return null;
	return withElements(doc, (doc.elements || []).concat([el]));
}

/** 更新元素字段（label / props / logic 等） */
export function updateElement(doc, id, patch) {
	if (!doc) return null;
	return withElements(doc, (doc.elements || []).map((e) => (e.id === id ? { ...e, ...patch, props: { ...e.props, ...(patch.props || {}) }, logic: { ...e.logic, ...(patch.logic || {}) } } : e)));
}

/** 移动（拖拽）—— 边界钳制，不允许拖出画布外丢失 */
export function moveElement(doc, id, x, y) {
	if (!doc) return null;
	return withElements(doc, (doc.elements || []).map((e) => {
		if (e.id !== id) return e;
		return { ...e, x: Math.round(clampTo(x, 0, CANVAS_W - MIN_SIZE)), y: Math.round(clampTo(y, 0, CANVAS_H - MIN_SIZE)) };
	}));
}

/** 平移（拖拽增量的语义化包装；Δ 由指针位移算出） */
export function nudgeElement(doc, id, dx, dy) {
	const el = (doc && doc.elements || []).find((e) => e.id === id);
	if (!el) return doc;
	return moveElement(doc, id, el.x + dx, el.y + dy);
}

/** 改尺寸（拖右下角手柄） */
export function resizeElement(doc, id, w, h) {
	if (!doc) return null;
	return withElements(doc, (doc.elements || []).map((e) => (e.id === id
		? { ...e, w: Math.round(clampTo(w, MIN_SIZE, CANVAS_W)), h: Math.round(clampTo(h, MIN_SIZE, CANVAS_H)) }
		: e)));
}

/** 删除元素 */
export function removeElement(doc, id) {
	if (!doc) return null;
	return withElements(doc, (doc.elements || []).filter((e) => e.id !== id));
}

/** 复制元素（原位右下偏移 16px，便于看见） */
export function duplicateElement(doc, id) {
	const el = (doc && doc.elements || []).find((e) => e.id === id);
	if (!el) return doc;
	const copy = createElement(el.kind, { ...el, id: undefined, x: el.x + 16, y: el.y + 16, z: maxZ(doc) + 1 });
	return withElements(doc, (doc.elements || []).concat([copy]));
}

/** 改层级（置顶 / 置底） */
export function reorderElement(doc, id, where) {
	if (!doc) return null;
	const els = doc.elements || [];
	const top = Math.max(1, ...els.map((e) => e.z || 1));
	return withElements(doc, els.map((e) => (e.id === id ? { ...e, z: where === "bottom" ? 0 : top + 1 } : e)));
}

/** 批量设置交互逻辑（左侧面板的「编辑」写入点） */
export function updateLogic(doc, id, patch) {
	const el = (doc && doc.elements || []).find((e) => e.id === id);
	if (!el) return doc;
	return updateElement(doc, id, { logic: { ...(el.logic || {}), ...(patch || {}) } });
}

function maxZ(doc) {
	const els = (doc && doc.elements) || [];
	return els.length ? Math.max(...els.map((e) => Number(e.z) || 1)) : 0;
}

/** 可渲染元素（按 z 升序，供画布绘制） */
export function visibleElements(doc) {
	return ((doc && doc.elements) || []).filter(isRenderable).sort((a, b) => (a.z || 0) - (b.z || 0));
}

/** 重新加载标准框架（丢弃现元素；调用方负责确认） */
export function loadStandardFrame(doc, frameKey = "threeTab") {
	if (!doc) return null;
	return withElements({ ...doc, frameKey }, buildStandardFrame(frameKey));
}

/* ══════════════════════════════════════════════════════════════════
 * 设计图专用临时对话（**只处理设计图**）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 追加一条线程消息。消息是**纯记录**：本函数不调用任何模型、不写宿主会话。
 * 真正的"处理"由上层（DesignStudio）决定 —— 它只能产生对**本图元素**的操作。
 * @param {object} doc
 * @param {{role?:string,text:string,ops?:Array}} msg
 */
export function appendThread(doc, msg) {
	if (!doc || !msg) return doc;
	const rec = {
		id: "tm_" + Date.now().toString(36) + "_" + ((doc.thread || []).length + 1),
		role: msg.role === DESIGN_ROLE.USER ? DESIGN_ROLE.USER : DESIGN_ROLE.STUDIO,
		text: String(msg.text == null ? "" : msg.text),
		ops: Array.isArray(msg.ops) ? msg.ops : [],
		at: Date.now()
	};
	return { ...doc, thread: (doc.thread || []).concat([rec]), updatedAt: Date.now() };
}

/**
 * 把一句设计图修订指令翻译成**元素操作**（本地规则，不依赖模型）。
 *
 * ⚠️ 设计取舍：这里刻意只做**可解释的规则解析**（引用元素 id/标签 + 动词）。
 *    理由：设计图修订必须是**确定性**的 —— 模型幻觉一个不存在的元素会让图变坏，
 *    而"指哪改哪"正是这个功能存在的意义。模型只在需要生成**新元素建议**时参与。
 *
 * 支持指令（可组合）：
 *   移动 <元素> 左/右/上/下 [N]      删除 <元素>
 *   放大/缩小 <元素> [N]             置顶 <元素>
 *   复制 <元素>                      改文案 <元素> 为 <文本>
 * @param {object} doc
 * @param {string} text
 * @returns {{ops:Array<{op:string,target:string,args:object}>, unresolved:string[]}}
 */
export function parseDesignCommand(doc, text) {
	const els = (doc && doc.elements) || [];
	const raw = String(text || "").trim();
	const ops = [];
	const unresolved = [];
	if (!raw) return { ops, unresolved };

	/**
	 * 元素指称：id 精确 → label 精确 → label 包含。
	 * 🔴 必须剥掉中英文引号（2026-09-12）：用户很自然会写「移动「R1 顶部栏」左 30」，
	 *    若把引号算进名字里就永远找不到元素。
	 */
	const find = (token) => {
		let t = String(token == null ? "" : token).trim();
		t = t.replace(/^[「『"'[\s]+/, "").replace(/[」』"'\]]+$/, "").trim();
		if (!t) return null;
		return els.find((e) => e.id === t)
			|| els.find((e) => String(e.label || "") === t)
			|| els.find((e) => String(e.label || "").includes(t))
			|| null;
	};

	/* 🔴 指令数字的单位 = **像素**（2026-09-12 修正 · 真机暴露）
	 *   原实现：`const STEP = 20; const n = Number(m[3] || 1) * STEP;`
	 *   ⇒ 用户说「移动 R1 顶部栏 左 30」，实际位移 30×20 = **600px**，
	 *     超出画布左边界后被 `moveElement` clamp 到 0 ⇒ 表现为"元素整个贴到最左边没了"，
	 *     且**没有任何报错**。真机上被 e2e 的位移断言（期望 30）抓出。
	 *   修正原则：**数字的含义必须与直觉、以及与同族交互一致** ——
	 *     方向键微移 10px、拖拽按 px、几何字段 x/y/w/h 全是 px
	 *     ⇒ 指令里的数字也必须就是 px，不能悄悄乘一个魔法系数。
	 */
	const DEFAULT_NUDGE_PX = 10;   // 省略数字时的默认一档（与方向键同量纲）
	const asPx = (raw, dflt) => {
		const v = Number(raw);
		return Number.isFinite(v) && v > 0 ? v : dflt;
	};
	const DIR = { 左: [-1, 0], 右: [1, 0], 上: [0, -1], 下: [0, 1] };

	/* 🔴 名字必须支持**多词**（2026-09-12 实测缺陷）：
	 *   原用 `([^\s，,]+)` 取名字 ⇒ 名字里一旦有空格就截断，
	 *   而标准框架的 label 恰恰全是多词（「R1 顶部栏」「R6 记忆面板」「右侧「对话」弹窗」）
	 *   ⇒ **用户最想指称的那批元素全都指称不到**，报"认不出"。
	 *   修正：改用惰性 `(.+?)` 吃到分隔词为止（`$` 或方向字 / 「为」）。
	 *   move 的方向字需要 lookahead `(?=\s|\d|$)`，否则 label 里含方向字的元素会误切
	 *   （如「右侧「对话」弹窗」里的"右"后面跟着"侧"，不是一个方向的写法）。
	 *   两种写法都支持：「移动 R1 顶部栏 左 30」/「移动「R1 顶部栏」左 30」。 */
	const patterns = [
		{ op: "move", re: /移动\s*(.+?)\s*([左右上下])(?=\s|\d|$)\s*(\d+)?/ },
		{ op: "remove", re: /删除\s*(.+)$/ },
		{ op: "scale", re: /(放大|缩小)\s*(.+?)\s*(\d+)?$/ },
		{ op: "reorder", re: /置顶\s*(.+)$/ },
		{ op: "duplicate", re: /复制\s*(.+)$/ },
		{ op: "relabel", re: /改文案\s*(.+?)\s*为\s*(.+)$/ }
	];

	for (const seg of raw.split(/[；;\n]/).map((s) => s.trim()).filter(Boolean)) {
		let hit = false;
		for (const p of patterns) {
			const m = p.re.exec(seg);
			if (!m) continue;
			hit = true;
			if (p.op === "move") {
				const el = find(m[1]);
				if (!el) { unresolved.push(m[1]); break; }
				const [sx, sy] = DIR[m[2]] || [1, 0];
				const n = asPx(m[3], DEFAULT_NUDGE_PX);   // 数字即像素
				ops.push({ op: "move", target: el.id, args: { dx: sx * n, dy: sy * n } });
			} else if (p.op === "scale") {
				const el = find(m[2]);
				if (!el) { unresolved.push(m[2]); break; }
				const n = asPx(m[3], 20);                 // 数字即像素（省略时 20px）
				const sign = m[1] === "放大" ? 1 : -1;
				ops.push({ op: "resize", target: el.id, args: { w: el.w + sign * n, h: el.h + sign * n } });
			} else if (p.op === "reorder") {
				const el = find(m[1]);
				if (!el) { unresolved.push(m[1]); break; }
				ops.push({ op: "reorder", target: el.id, args: { where: "top" } });
			} else if (p.op === "relabel") {
				const el = find(m[1]);
				if (!el) { unresolved.push(m[1]); break; }
				ops.push({ op: "relabel", target: el.id, args: { label: String(m[2]).trim() } });
			} else {
				const el = find(m[1]);
				if (!el) { unresolved.push(m[1]); break; }
				ops.push({ op: p.op, target: el.id, args: {} });
			}
			break;
		}
		if (!hit) unresolved.push(seg);
	}
	return { ops, unresolved };
}

/** 应用一组操作（来自 parseDesignCommand 或手工构造）—— **单次遍历，幂等安全** */
export function applyOps(doc, ops) {
	let d = doc;
	for (const o of ops || []) {
		if (!o || !o.target) continue;
		if (o.op === "move") d = nudgeElement(d, o.target, o.args.dx || 0, o.args.dy || 0);
		else if (o.op === "resize") d = resizeElement(d, o.target, o.args.w, o.args.h);
		else if (o.op === "remove") d = removeElement(d, o.target);
		else if (o.op === "duplicate") d = duplicateElement(d, o.target);
		else if (o.op === "reorder") d = reorderElement(d, o.target, o.args.where || "top");
		else if (o.op === "relabel") d = updateElement(d, o.target, { label: o.args.label });
	}
	return d;
}

/* ══════════════════════════════════════════════════════════════════
 * 全局契约（调试 / 验证脚本用；不可改名）
 * ══════════════════════════════════════════════════════════════════ */

export function installDesignApi() {
	if (typeof window === "undefined") return null;
	window.__dshDesign = {
		DESIGN_KEY, DESIGN_ROLE, ELEMENT_KINDS, CANVAS_W, CANVAS_H,
		getState, getActiveDoc, subscribe, getVersion,
		listDocs, getDoc, newDoc, saveDoc, deleteDoc, setActiveDoc, resetDesignStore,
		addElement, updateElement, moveElement, nudgeElement, resizeElement,
		removeElement, duplicateElement, reorderElement, updateLogic, visibleElements,
		loadStandardFrame, appendThread, parseDesignCommand, applyOps,
		docStats, buildStandardFrame,
		/* 版本快照（2026-09-12）：保存 / 版本列表 / 回滚 / 删版本 / 重命名 / 复制图 / 脏判定 */
		saveVersion, listVersions, restoreVersion, deleteVersion,
		renameDoc, duplicateDoc, isDirty, getVersionState, matchVersion, sameElements, VERSION_LIMIT,
		hydrateDesignBackup   // 冷备恢复（装载期调用；仅主存为空时生效）
	};
	// 装载即尝试冷备恢复：主存为空（换端口 / 清缓存）时把设计图找回来
	try { hydrateDesignBackup(); } catch (e) { /* 冷备失败不影响主流程 */ }
	return window.__dshDesign;
}
