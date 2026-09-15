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
	ELEMENT_KINDS, ELEMENT_KIND_KEYS, LOGIC_FIELDS, createElement, normalizeElement, isRenderable,
	createDesignDoc, normalizeDoc, docStats, buildStandardFrame, CANVAS_W, CANVAS_H, MIN_SIZE,
	// 版本快照（2026-09-12 新增 · 需求「保存 + 不同版本的选择」）
	createVersion, versionSummary, cloneElements, VERSION_LIMIT, syncSeqFrom,
	/* 画面 / 层（2026-09-14 新增 · 需求「元素层层堆叠、不知道该从哪改」）
	 * 见 docs/50-信息中心/V20-设计图分层与AI可读规格.html */
	SCREENS, SCREEN_KEYS, SCREEN_ORDER, LAYERS, LAYER_KEYS, LAYER_ORDER,
	screenOf, layerOf, layerOrderOf, layerCollisions, sortForPaint
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
 * 逐元素比对两份 elements 是否等价（id/几何/标签/逻辑/画面/层）。
 * 只比**会影响图的样子**的字段：
 *   · `props` 不参与（它是预留扩展位，未接线，比它会造成假"脏"）。
 *   · `hidden` / `locked` **刻意不参与**：它们是**工作态**而不是"图的内容"。
 *     反例（若不排除会怎样）：用户在改浮层前把底图锁上，这是**正确的操作习惯**，
 *     却会让顶栏立刻显示「未保存改动」，保存后又多出一个内容完全相同的版本 ——
 *     版本列表被"我按规矩操作"这件事污染。而 `screen` / `layer` **必须参与**：
 *     把元素搬到另一幅画面、或换个层，是**结构改动**，理应进版本。
 */
export function sameElements(a, b) {
	const A = a || [], B = b || [];
	if (A.length !== B.length) return false;
	for (let i = 0; i < A.length; i++) {
		const x = A[i], y = B[i];
		if (!x || !y) return false;
		if (x.id !== y.id || x.kind !== y.kind) return false;
		if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h || x.z !== y.z) return false;
		if (screenOf(x) !== screenOf(y) || layerOf(x) !== layerOf(y)) return false;
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
 * N3 锁定守卫 —— **唯一实现点**（改"锁定到底拦什么"只改这里）。
 *
 * 🔴 为什么锁定必须落在 **store 层**，而不是只在组件里拦指针事件：
 *    设计图有**两条**改动通道 —— ① 鼠标拖拽/缩放；② 设计图对话指令 / DSL 回灌。
 *    通道② 最终也走本文件的 `moveElement` / `resizeElement` 等函数，**根本不经过组件**。
 *    只在组件拦 ⇒ 用户锁定底图后，一句「移动 Harness 主窗口 左 30」仍能把它挪走，
 *    于是"锁定"变成一个**看起来生效、实际半失效**的开关 —— 比没有更糟
 *    （用户会开始不信任锁定，进而反复核对，正好抵消了它省下的时间）。
 *    放在这里之后，两条通道共用同一个判定，且**离线闸门可以直接测**。
 *
 * ⚠️ 锁定**不拦**：改文案（`updateElement`）、改七元组逻辑（`updateLogic`）、
 *    隐藏/解锁本身（`setElementFlags`）、改变归属（`setElementPlacement`）。
 *    理由：锁定的语义是"别把它挪走/删掉"，不是"只读"。若连文案都改不了，
 *    用户改标题就得先解锁再锁回 —— 那是给自己加步骤。
 *
 * @param {object} doc @param {string} id @returns {boolean}
 */
function isLockedEl(doc, id) {
	const els = (doc && doc.elements) || [];
	for (const e of els) if (e.id === id) return e.locked === true;
	return false;
}

/**
 * 增加元素（用户要求「允许…增加元素」）。
 * @param {object} doc
 * @param {string} kind ELEMENT_KINDS key
 * @param {{x?:number,y?:number}} [at] 落点；缺省放在画布中上部并做层叠偏移
 * @param {{screen?:string}} [opts] 归属画面（组件在"聚焦某画面"时传入）
 *
 * 🔴 落点与 z 的算法**逐字保持不变**（`maxZ(doc)+1` ⇒ 新元素压在最上，便于立刻抓住）：
 *    这是既有真机断言（C3.2/C3.3/C4.x）建立的基准，改了会让 C4 段的拖拽目标
 *    落到别的元素下面，表现为"拖不动"的假红。`layer` 给 content 是为了让新元素
 *    在**新的三层绘制序**下仍然压在同画面 base 层之上（否则新加的元素会被底板盖住）。
 *    `screen` 仅在显式传入时使用；不传则维持原行为（由 z 推断），保证默认路径零变化。
 */
export function addElement(doc, kind, at = {}, opts = {}) {
	if (!doc) return null;
	const n = (doc.elements || []).length;
	const o = opts || {};
	const el = createElement(kind, {
		x: at.x != null ? at.x : 40 + (n % 12) * 18,
		y: at.y != null ? at.y : 40 + (n % 12) * 16,
		z: maxZ(doc) + 1,
		layer: "content",
		...(SCREENS[o.screen] ? { screen: o.screen } : {})
	});
	if (!el) return null;
	return withElements(doc, (doc.elements || []).concat([el]));
}

/** 更新元素字段（label / props / logic 等） */
export function updateElement(doc, id, patch) {
	if (!doc) return null;
	return withElements(doc, (doc.elements || []).map((e) => (e.id === id ? { ...e, ...patch, props: { ...e.props, ...(patch.props || {}) }, logic: { ...e.logic, ...(patch.logic || {}) } } : e)));
}

/** 移动（拖拽）—— 边界钳制，不允许拖出画布外丢失；**锁定元素原样返回**（N3） */
export function moveElement(doc, id, x, y) {
	if (!doc) return null;
	if (isLockedEl(doc, id)) return doc;
	return withElements(doc, (doc.elements || []).map((e) => {
		if (e.id !== id) return e;
		return { ...e, x: Math.round(clampTo(x, 0, CANVAS_W - MIN_SIZE)), y: Math.round(clampTo(y, 0, CANVAS_H - MIN_SIZE)) };
	}));
}

/** 平移（拖拽增量的语义化包装；Δ 由指针位移算出）—— 锁定元素原样返回（N3，由 moveElement 兜住） */
export function nudgeElement(doc, id, dx, dy) {
	const el = (doc && doc.elements || []).find((e) => e.id === id);
	if (!el) return doc;
	return moveElement(doc, id, el.x + dx, el.y + dy);
}

/** 改尺寸（拖右下角手柄）—— 锁定元素原样返回（N3） */
export function resizeElement(doc, id, w, h) {
	if (!doc) return null;
	if (isLockedEl(doc, id)) return doc;
	return withElements(doc, (doc.elements || []).map((e) => (e.id === id
		? { ...e, w: Math.round(clampTo(w, MIN_SIZE, CANVAS_W)), h: Math.round(clampTo(h, MIN_SIZE, CANVAS_H)) }
		: e)));
}

/** 删除元素 —— 锁定元素原样返回（N3：锁定的首要意义就是"删不掉"） */
export function removeElement(doc, id) {
	if (!doc) return null;
	if (isLockedEl(doc, id)) return doc;
	return withElements(doc, (doc.elements || []).filter((e) => e.id !== id));
}

/** 复制元素（原位右下偏移 16px，便于看见） */
export function duplicateElement(doc, id) {
	const el = (doc && doc.elements || []).find((e) => e.id === id);
	if (!el) return doc;
	const copy = createElement(el.kind, { ...el, id: undefined, x: el.x + 16, y: el.y + 16, z: maxZ(doc) + 1 });
	return withElements(doc, (doc.elements || []).concat([copy]));
}

/** 改层级（置顶 / 置底）—— 锁定元素原样返回（N3：改压盖次序也算"挪动"） */
export function reorderElement(doc, id, where) {
	if (!doc) return null;
	if (isLockedEl(doc, id)) return doc;
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

/**
 * 可渲染元素（按**绘制序**排好，供画布绘制）。
 * 🔴 2026-09-14 起排序键从裸 z 改为 `画面重叠序 → 层序 → z`（见 design-schema.js paintOrderKey）。
 * 为什么必须改：本项目画布的压盖靠 **DOM 顺序**实现（元素是 position:absolute 且未设 z-index），
 * 而 reorderInScreen 会把本画面 z 规范化为 1..n ⇒ 总监页的 z 会爬进浮层/模态区间，
 * 若仍按裸 z 排序，**导图态的画布会被总监页的方块盖住**（全景视图错乱）。
 * `hidden` 的元素不返回 —— 它不在画面上（但仍在大纲与 DSL 里，见 outlineOf / toDesignDSL）。
 */
export function visibleElements(doc) {
	return sortForPaint(((doc && doc.elements) || []).filter((e) => isRenderable(e) && !e.hidden));
}

/**
 * 画面聚焦视图 —— **N6（聚焦后跨画面遮挡 = 0）的唯一实现点**。
 *
 * 🔴 为什么把它做成数据层的纯函数，而不是留在组件里算：
 *    组件里那段 `filter` 无法被离线闸门验证，只能靠真机 e2e 逐个点 —— 而这条不变量
 *    一旦破了（比如有人顺手把 ghost 的 `pointerEvents` 删掉），表现是
 *    "**点了上面的按钮没反应**"，那是本项目最难查的一类现象（读到的是"功能坏了"，
 *    真因是"被一个看不见的浮层吃了事件"）。放进数据层后，闸门可以逐画面断言
 *    "可交互集合恰好只有这一幅画面的元素"，并且**能与产品同源**。
 *
 * 语义：
 *   · `interactive` = 当前画面（或全部，未聚焦时）的元素 → 正常渲染、可命中；
 *   · `ghost`       = 其余画面的元素 → 画成淡影（`pointerEvents:none`，**不带** `ds-el` 锚点）；
 *   · 未聚焦（screen 非法 / "all"）时 `screen` 返回 `null`，`ghost` 为空
 *     —— 此时**不声明** N6（全景视图本来就允许互相遮挡，这是语义而不是缺陷）。
 *     闸门据此区分"零遮挡"与"未聚焦"，避免把"没聚焦"读成"遮挡归零"（平凡真）。
 *
 * @param {object} doc
 * @param {string|null} screen 画面 key，或 "all" / null（全景）
 * @returns {{screen:string|null, interactive:Array, ghost:Array}}
 */
export function focusView(doc, screen) {
	const els = visibleElements(doc);
	if (!SCREENS[screen]) return { screen: null, interactive: els, ghost: [] };
	return {
		screen,
		interactive: els.filter((e) => screenOf(e) === screen),
		ghost: els.filter((e) => screenOf(e) !== screen)
	};
}

/** 重新加载标准框架（丢弃现元素；调用方负责确认） */
export function loadStandardFrame(doc, frameKey = "threeTab") {
	if (!doc) return null;
	return withElements({ ...doc, frameKey }, buildStandardFrame(frameKey));
}

/* ══════════════════════════════════════════════════════════════════
 * 结构视图：画面 → 层 → 元素（2026-09-14 · V20 §B/§D）
 *
 * 存在的理由（用户原话）：「当前页面的元素层层堆叠，我不知道该从哪些部分、
 * 按什么顺序去修改。」根因是**层级只能靠 z 数字反推**，而 z 在画布上不可见。
 * 这一组函数把层级算出来、排好序、交给左栏的结构大纲去显示 ——
 * 于是"有哪些元素、谁在哪一层、该先改谁"从**猜**变成**读**。
 * ══════════════════════════════════════════════════════════════════ */

/** 单画面统计（状态栏与大纲共用；与渲染同源，避免"角标说 13、大纲列 12"） */
export function screenStats(doc, screen) {
	const els = ((doc && doc.elements) || []).filter((e) => screenOf(e) === screen);
	return {
		screen,
		label: (SCREENS[screen] || {}).label || screen,
		overlap: (SCREENS[screen] || {}).overlap || 0,
		total: els.length,
		visible: els.filter((e) => !e.hidden).length,
		hidden: els.filter((e) => e.hidden).length,
		locked: els.filter((e) => e.locked).length
	};
}

/**
 * 结构大纲 —— 三层树（左栏「结构大纲」的数据源）。
 *
 * 🔴 排序必须**完全确定**，否则同一份图两次渲染的行序可能不同，
 *    用户会以为"我没动它，它自己变了"（本项目对"状态提示骗人"零容忍）：
 *    画面按 SCREEN_ORDER（重叠序＝修改顺序）→ 层按 LAYER_ORDER（base→content→deco）
 *    → 元素按 z → y → id（末位用 id 兜底，保证全序，不会因 z/y 相同而不稳定）。
 * 返回的是**新对象**：不把 doc.elements 里的元素本体交出去，避免调用方顺手改到真数据。
 */
export function outlineOf(doc) {
	const els = (doc && doc.elements) || [];
	return SCREEN_ORDER.map((sk) => {
		const layers = LAYER_ORDER.map((lk) => ({
			layer: lk,
			label: LAYERS[lk].label,
			hint: LAYERS[lk].hint,
			items: els
				.filter((e) => screenOf(e) === sk && layerOf(e) === lk)
				.slice()
				.sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0)
					|| (Number(a.y) || 0) - (Number(b.y) || 0)
					|| String(a.id).localeCompare(String(b.id)))
				.map((e) => ({
					id: e.id, kind: e.kind, label: e.label,
					x: e.x, y: e.y, w: e.w, h: e.h,
					hidden: Boolean(e.hidden), locked: Boolean(e.locked), note: e.note || ""
				}))
		})).filter((g) => g.items.length);
		return {
			screen: sk, label: (SCREENS[sk] || {}).label || sk,
			hint: (SCREENS[sk] || {}).hint || "", overlap: (SCREENS[sk] || {}).overlap || 0,
			stats: screenStats(doc, sk), layers
		};
	});
}

/** 全文统计（状态栏一行读完：总数 / 隐藏 / 锁定 / 同层重叠） */
export function designStats(doc) {
	const els = (doc && doc.elements) || [];
	const st = docStats(doc);
	return {
		...st,
		hidden: els.filter((e) => e.hidden).length,
		locked: els.filter((e) => e.locked).length,
		collisions: layerCollisions(els).length,
		screens: SCREEN_ORDER.map((s) => screenStats(doc, s)).filter((s) => s.total > 0)
	};
}

/** 同画面同层碰撞明细（状态栏点开时的清单；空数组 = N2 全绿） */
export function layerOverlaps(doc) {
	return layerCollisions((doc && doc.elements) || []);
}

/**
 * 改元素的**工作态**（隐藏 / 锁定 / 备注）。
 *
 * 刻意与 updateElement 分开：这三项**不参与版本比对**（见 sameElements 的说明），
 * 它们是"怎么改这张图"的辅助状态，不是"图长什么样"。
 * 未知 id 返回**原 doc**（不是 null）—— 调用方是 UI 事件，返回 null 会让链式调用炸掉。
 */
export function setElementFlags(doc, id, patch = {}) {
	const p = patch || {};
	if (!doc) return doc;
	return withElements(doc, (doc.elements || []).map((e) => {
		if (e.id !== id) return e;
		const next = { ...e };
		/* 真值判断统一用 `=== true`：字符串 "false" 会被 Boolean() 判成真，
		 * 而"莫名锁住导致拖不动"是这类布尔字段最贵的缺陷。 */
		if ("hidden" in p) next.hidden = p.hidden === true;
		if ("locked" in p) next.locked = p.locked === true;
		if ("note" in p) next.note = String(p.note == null ? "" : p.note).slice(0, 160);
		return next;
	}));
}

/**
 * 改元素的**归属**（画面 / 层）。
 * 🔴 **坐标一个都不动** —— 照 Excalidraw `frameId` 的正交设计：
 *    "认领归属"与"挪位置"是两件事。若顺手偏移坐标，用户聚焦/取消聚焦时会看到
 *    元素自己移动，从而以为"我只是看了看，怎么图就变了"。
 */
export function setElementPlacement(doc, id, patch = {}) {
	const p = patch || {};
	if (!doc) return doc;
	return withElements(doc, (doc.elements || []).map((e) => {
		if (e.id !== id) return e;
		const next = { ...e };
		if (SCREENS[p.screen]) next.screen = p.screen;
		if (LAYERS[p.layer]) next.layer = p.layer;
		return next;
	}));
}

/**
 * 画面内换次序（上移 / 下移一位）。
 *
 * 🔴 实现要点（与"z 加 1"完全不同）：
 *   z 是**稀疏**的（默认框架只有 0/1/2/3/6/8/10/11 八个值，其中 9 个元素 z=2）。
 *   若直接 z±1，会出现**同 z 碰撞** —— 那时谁压谁退化为"看数组下标"
 *   （design-schema.js hitTest 用 `>=`，同 z 后遍历者胜），顺序变得不可预测。
 *   ⇒ 做法：把**本画面**的 z 重新规范化为 1..n（按新的先后顺序），
 *     跨画面一概不碰（z 只在画面内有意义，N5）。
 *   副作用是**正向的**：规范化之后本画面不再有同 z 元素，
 *   绘制序第一次变成全序 —— 这同时修掉了 A2 的"同 z 碰撞"成因。
 *
 * @param {object} doc
 * @param {string} id
 * @param {"up"|"down"} dir
 * @returns {object} 新 doc；已在端点时**原样返回**（不是错误，也不产生脏改动）
 */
export function reorderInScreen(doc, id, dir) {
	const els = (doc && doc.elements) || [];
	const me = els.find((e) => e.id === id);
	if (!me) return doc;
	if (me.locked === true) return doc;   // N3：锁定的元素不参与次序调整
	const sc = screenOf(me);
	// 本画面的完整次序（与 outlineOf 同规则，保证"大纲里看到的顺序"就是"换次序用的顺序"）
	const seq = els.filter((e) => screenOf(e) === sc).slice().sort(
		(a, b) => (Number(a.z) || 0) - (Number(b.z) || 0)
			|| (Number(a.y) || 0) - (Number(b.y) || 0)
			|| String(a.id).localeCompare(String(b.id))
	);
	const i = seq.findIndex((e) => e.id === id);
	const j = dir === "up" ? i - 1 : i + 1;
	if (i < 0 || j < 0 || j >= seq.length) return doc;   // 已在两端：静默不动
	const next = seq.slice();
	const t = next[i]; next[i] = next[j]; next[j] = t;
	const zOf = {};
	next.forEach((e, k) => { zOf[e.id] = k + 1; });
	return withElements(doc, els.map((e) => (zOf[e.id] != null ? { ...e, z: zOf[e.id] } : e)));
}

/** 批量把某画面的全部元素设为隐藏 / 显示（"整幅收起"用） */
export function setScreenHidden(doc, screen, hidden) {
	if (!doc || !SCREENS[screen]) return doc;
	return withElements(doc, (doc.elements || []).map(
		(e) => (screenOf(e) === screen ? { ...e, hidden: hidden === true } : e)
	));
}

/* ══════════════════════════════════════════════════════════════════
 * AI 可读结构语言（DSL v1）—— 2026-09-14 · V20 §E
 *
 * 为什么需要它：用户的工作流是「我提想法 → AI 生成设计图 → 我改」。
 * 现状下 AI 只能拿到 elements[] 的 JSON —— 一堆**没有从属关系的坐标**，
 * 于是每次都要重新推断"这图里有几幅画面、哪几个属同一幅"，
 * 每次推断结果都可能不同 ⇒ 这正是"三次改版改出来三版完全不一样"的机制。
 * ⇒ 另立一种**给人看层级、给 AI 读结构**的行式格式（存储仍走 dsh.director.design，不动契约）。
 *
 * 六条规则（V20 §E2，逐条可校验）：
 *   R1 一行一条语句，禁止 {} [] 等嵌套      → 无方言、可逐行解析
 *   R2 首个非空行必须是「图 <id> 「标题」」  → 唯一入口，消除"从哪儿读"的歧义
 *   R3 元素行固定 5 列：层 类型 「标签」 x,y wxh
 *   R4 缩进 = 归属（画面 0 / 元素 2 空格）
 *   R5 可选标记挂**行尾**：| hidden | locked | note=…
 *   R6 幂等：导出→导入→再导出 逐字节一致
 * ══════════════════════════════════════════════════════════════════ */

/** 列宽（定长列便于逐行 diff 与按列解析；改这里必须同步改 parseDesignDSL）
 * 🔴 一个 `const` 只声明一个名字（不写成 `const A = 1, B = 2;`）：
 *    lint-undefined-symbols 的「裸引用大写常量」检查只认**首个**声明符，
 *    写成一行会让 B 被报成"无任何文件声明"的阻塞级缺陷 —— 那是闸门的已知保守行为，
 *    但在这里**没必要去撞它**：写成三行既不损失可读性，也让闸门保持全绿可信。
 *
 * 🔴 标签列宽 30 是**按标准框架的最长标签定的**（`浮动组 · 🧠思维导图 / ◆总监` 含引号 30 格）：
 *    这样"基准数据"导出后**逐行整齐**，人一眼能扫出三幅画面各有几块；
 *    若取得比它小，20 行里会有 7 行几何列右移，读起来像排版坏了（而内容其实没错）。
 *    超宽（用户自己起的长名字）仍**不截断**，只补一个空格 —— 见 dslPad。 */
const DSL_LAYER_W = 8;
const DSL_KIND_W = 9;
const DSL_LABEL_W = 30;

/**
 * 显示宽度（CJK 按 2 格算）—— **只影响观感，不影响解析**。
 * 为什么要算：只按 `length` 补齐时中文标签会短算一半，整列看起来像没对齐，
 * 而人读这份 DSL 的目的正是"一眼扫出三幅画面各有几块"。
 * 解析端按空白正则读，所以即使这里算错也不会读错数据（宽容设计）。
 */
function dslWidth(s) {
	let w = 0;
	for (const ch of String(s == null ? "" : s)) {
		const c = ch.codePointAt(0);
		w += (c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a
			|| (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
			|| (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f)
			|| (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6))) ? 2 : 1;
	}
	return w;
}

/** 按**显示宽度**补齐到 n 格；超宽不截断（截断会静默改内容）。
 *
 * 🔴 本函数**只负责补齐，不负责分隔** —— 列与列之间的空格由调用处**显式**写出。
 *    这个拆分不是洁癖，是 2026-09-14 由 `test-design-layers` 抓出来的真缺陷：
 *    原实现把「补齐」和「分隔」合成一件事（`w >= n ? t + " " : t + " ".repeat(n - w)`），
 *    于是同一个边界情形（值**恰好填满**一列）会走两条互斥的错路 ——
 *      · 若返回 `t`（不多补空格）⇒ 少了分隔符，`「浮动组…」900,590` 粘成一坨，
 *        元素行直接解析失败（连带 D5/D9/D12/D14 四条连锁红）；
 *      · 若返回 `t + " "`（多补一个空格）⇒ 该行整列右移一格，
 *        在 20 行里**只有这两行**错开，读起来像"我哪里看错了"（D6 红）。
 *    两条路都错 —— 因为**对齐**与**可解析**本来就是两件事，不该由同一个返回值兼任。
 *    拆开之后：补齐管对齐（同列等宽），显式空格管可解析（任何宽度下都有分隔）。 */
const dslPad = (s, n) => {
	const t = String(s == null ? "" : s);
	const w = dslWidth(t);
	return w >= n ? t : t + " ".repeat(n - w);
};

/**
 * 导出为 DSL 文本（确定性：同 doc 任意次导出逐字节一致）。
 *
 * 两种模式：
 *   · 默认（logic:false）= **纯结构视图**，约 1.1 KB —— 给"看层级/改布局"用。
 *   · logic:true        = **全量视图**，附逻辑七元组 —— 给"AI 生成整张图/整图交接"用。
 *
 * 🔴 为什么 logic 模式必须列**全部 7 个字段（含空值）**，而不能"非空才写"：
 *    回读时 createElement 会用**该图元的类型默认逻辑**补空缺（这是"每个元素都有逻辑可显示"的
 *    实现基础）。于是"用户把某字段清空"与"该字段本来就是类型默认值"这两种状态，
 *    在"非空才写"的导出下**长得一模一样** —— 回读时清空过的字段会被类型默认值**填回来**，
 *    表现为「我明明清空了，怎么又有了」。空值统一写成 `∅` 才让往返真正无损。
 *    （实测代价：全量模式约 5 KB，仍显著小于同内容的 JSON，见 V20 §E1。）
 */
const DSL_EMPTY = "∅";

/**
 * @param {object} doc
 * @param {{logic?:boolean}} [opts]
 * @returns {string} 以 LF 结尾的文本（无 CRLF）
 */
export function toDesignDSL(doc, opts = {}) {
	const o = opts || {};
	if (!doc) return "";
	const els = (doc.elements || []).filter((e) => e && e.id);
	const L = [];
	L.push("图 " + doc.docId + " 「" + String(doc.title || "未命名设计图") + "」");
	for (const sk of SCREEN_ORDER) {
		const group = els.filter((e) => screenOf(e) === sk);
		if (!group.length) continue;
		const sc = SCREENS[sk] || {};
		/* 🔴 排序只算**一次**，元素行与逻辑块共用同一个数组。
		 * 踩过的坑（2026-09-14 实测）：原先逻辑块直接遍历未排序的 `group`
		 * ⇒ 元素行按「层序→z」排、逻辑块按**数组原序**排，两者顺序不同；
		 * 而解析会按文件行序重编 z ⇒ 第二次导出的逻辑块顺序变了
		 * ⇒ R6「逐字节幂等」被判假绿（无逻辑时通过、带逻辑时不通过）。
		 * 同一份真相（这一屏的元素次序）必须只在一处算出来。 */
		const ordered = group.slice().sort((a, b) => (layerOrderOf(a) - layerOrderOf(b))
			|| ((Number(a.z) || 0) - (Number(b.z) || 0)));
		L.push("");
		L.push("画面 " + sk + " 「" + (sc.label || sk) + "」 重叠序 " + (sc.overlap || 0));
		// 画面内按绘制序输出 —— 与画布所见顺序一致，人读起来能对上画面
		for (const e of ordered) {
			/* 先拼定长列并**去掉尾随空格**，再追加可选标记 ——
			 * 顺序反了会在 `|` 前面留一串补齐用的空格（看着像排版坏了）。
			 * 列间空格**显式写出**（不靠补齐函数附带）—— 见 dslPad 的说明。 */
			const core = "  " + dslPad(layerOf(e), DSL_LAYER_W) + " "
				+ dslPad(e.kind, DSL_KIND_W) + " "
				+ dslPad("「" + String(e.label == null ? "" : e.label) + "」", DSL_LABEL_W) + " "
				+ (e.x + "," + e.y + " " + e.w + "x" + e.h);
			/* `id=` 排在最前：它是元素在图内的**稳定身份**，逻辑块靠它配对，
			 * 也是"改完交回来"时让 AI 能逐条对准的唯一凭据（不靠标签猜）。 */
			const marks = ["id=" + e.id];
			if (e.hidden) marks.push("hidden");
			if (e.locked) marks.push("locked");
			if (e.note) marks.push("note=" + String(e.note).replace(/[\r\n]+/g, " "));
			L.push(core.replace(/\s+$/, "") + " | " + marks.join(" "));
		}
		if (o.logic) {
			for (const e of ordered) {
				const lg = e.logic || {};
				L.push("");
				L.push("逻辑 " + e.id + ":");
				for (const f of LOGIC_FIELDS) {
					const v = String(lg[f.key] == null ? "" : lg[f.key]).replace(/[\r\n]+/g, " ").trim();
					L.push("  " + f.label + " " + (v || DSL_EMPTY));
				}
			}
		}
	}
	return L.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * 解析 DSL → 元素数组（**纯解析，不落库**；调用方拿到结果自行决定是否提交）。
 *
 * 三条纪律：
 *   ① **全有或全无**：任何一行解析失败 ⇒ ops 为 null 并逐行报错，**一个字都不改图**
 *      （不做"部分应用"—— 半张图比原图更难收拾，且用户无法判断哪半是新的）。
 *   ② 报错必须**带行号与行内容**：只说"格式错"等于没说。
 *   ③ 不认识的层/画面名一律**拒收**（而不是回落默认）—— 回落会让笔误静默变成另一种结构。
 * @returns {{ok:boolean, title:string, elements:Array|null, errors:Array<{line:number,text:string,why:string}>}}
 */
export function parseDesignDSL(text) {
	const errors = [];
	const raw = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
	let title = "", screen = null, seen = 0, logicTarget = null;
	const els = [];
	raw.forEach((line, i) => {
		const ln = i + 1;
		const t = line.trim();
		if (!t) { logicTarget = null; return; }
		if (t.startsWith("图 ")) {                     // R2 唯一入口
			seen++;
			logicTarget = null;
			const m = /^图\s+(\S+)\s*「(.*)」\s*$/.exec(t);
			if (!m) { errors.push({ line: ln, text: t, why: "「图」行格式应为：图 <id> 「标题」（R2）" }); return; }
			if (seen > 1) errors.push({ line: ln, text: t, why: "「图」行只能出现一次（R2）" });
			title = m[2];
			return;
		}
		if (t.startsWith("画面 ")) {
			logicTarget = null;
			const m = /^画面\s+(\S+)\s*(「.*」)?\s*(重叠序\s+\d+)?\s*$/.exec(t);
			if (!m) { errors.push({ line: ln, text: t, why: "「画面」行格式应为：画面 <key> 「名」 重叠序 n（R2）" }); return; }
			if (!SCREENS[m[1]]) { errors.push({ line: ln, text: t, why: "未知画面 " + m[1] + "（已知：" + SCREEN_KEYS.join("/") + "）—— 拒收而非回落（纪律 ③）" }); screen = null; return; }
			screen = m[1];
			return;
		}
		if (t.startsWith("逻辑 ")) {
			const m = /^逻辑\s+(\S+):\s*$/.exec(t);
			if (!m) { errors.push({ line: ln, text: t, why: "逻辑块头格式应为：逻辑 <元素id>:（R3）" }); return; }
			const target = els.find((e) => e.id === m[1]);
			if (!target) { errors.push({ line: ln, text: t, why: "逻辑块指向的元素 " + m[1] + " 在图中不存在" }); return; }
			target.logic = target.logic || {};
			logicTarget = target;
			return;
		}
		/* 逻辑块内的字段行：以七元组的**标签**开头（标签不含空格 ⇒ 可作列首识别） */
		if (logicTarget) {
			const f = LOGIC_FIELDS.find((x) => t === x.label || t.startsWith(x.label + " "));
			if (f) {
				const v = t.slice(f.label.length).trim();
				logicTarget.logic[f.key] = v === DSL_EMPTY ? "" : v;
				return;
			}
			// 不是字段行 ⇒ 落到下面按元素行处理（元素行的 `层` 不会是七元组标签）
		}
		/* 元素行（R3）：层 类型 「标签」 x,y wxh [| 标记…] */
		const m = /^(\S+)\s+(\S+)\s+「(.*?)」\s+(-?\d+),(-?\d+)\s+(\d+)x(\d+)\s*(?:\|\s*(.*))?$/.exec(t);
		if (!m) { errors.push({ line: ln, text: t, why: "元素行应为 5 列：层 类型 「标签」 x,y wxh（R3）" }); return; }
		if (!LAYERS[m[1]]) { errors.push({ line: ln, text: t, why: "未知层 " + m[1] + "（已知：" + LAYER_KEYS.join("/") + "）" }); return; }
		if (!ELEMENT_KINDS[m[2]]) { errors.push({ line: ln, text: t, why: "未知图元 " + m[2] + "（共 " + ELEMENT_KIND_KEYS.length + " 类，见 ELEMENT_KINDS）" }); return; }
		if (!screen) { errors.push({ line: ln, text: t, why: "元素行出现在任何「画面」行之前 —— 无归属" }); return; }
		const marks = (m[8] || "").trim();
		const idM = /\bid=(\S+)/.exec(marks);
		const noteM = /\bnote=([\s\S]*)$/.exec(marks);
		els.push(createElement(m[2], {
			// 带 id 则沿用（往返时选中态、对话里的 id 指称都还认得出），否则新编
			...(idM ? { id: idM[1] } : {}),
			label: m[3],
			x: Number(m[4]), y: Number(m[5]), w: Number(m[6]), h: Number(m[7]),
			// z 按出现顺序编号 —— DSL 里**行序即次序**，不单独占一列（少一列就少一类笔误）
			z: els.length + 1,
			screen, layer: m[1],
			hidden: /\bhidden\b/.test(marks),
			locked: /\blocked\b/.test(marks),
			note: noteM ? noteM[1].trim() : ""
		}));
	});
	if (!seen) errors.push({ line: 1, text: "(文件首)", why: "缺少入口行「图 <id> 「标题」」（R2）" });
	if (errors.length) return { ok: false, title: "", elements: null, errors };
	return { ok: true, title, elements: els, errors: [] };
}

/**
 * 把 DSL 应用到一份 doc —— **全有或全无**的唯一实现点。
 *
 * 🔴 为什么不让调用方（组件）自己做「解析 → 写回」两步：
 *    那样每多一个调用点就多一次"忘了判 errors"的机会，而漏判的后果是
 *    **半张图被静默替换**。把纪律收在这一个函数里，调用点只需看返回值。
 * 幂等保证：对同一份图 `toDesignDSL` 再 `applyDesignDSL`，结果与原文逐字节一致（R6）。
 *
 * @returns {{doc:object, ok:boolean, errors:Array, title:string}} 失败时 doc 为**原 doc**（未改一字）
 */
export function applyDesignDSL(doc, text, opts = {}) {
	if (!doc) return { doc, ok: false, errors: [{ line: 0, text: "", why: "无设计图" }], title: "" };
	const r = parseDesignDSL(text);
	if (!r.ok || !r.elements) return { doc, ok: false, errors: r.errors, title: "" };
	/* 同步 id 序号水位：DSL 里带回了 el-18-pan 这类既有 id，
	 * 若不同步，下一个新建元素可能又发一个 el-3-xxx 撞上已有的 —— 撞了不会报错，
	 * 只会让"指哪改哪"指到另一个元素上。 */
	syncSeqFrom(r.elements);
	let next = withElements(doc, r.elements);
	// 标题只在显式要求时同步（默认不动 —— 用户的图名是他起的，不该被交换格式覆盖）
	if ((opts || {}).applyTitle && r.title) next = { ...next, title: String(r.title).slice(0, 60) };
	return { doc: next, ok: true, errors: [], title: r.title };
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
		{ op: "relabel", re: /改文案\s*(.+?)\s*为\s*(.+)$/ },
		/* ── 2026-09-14 新增四级动词：归属与工作态（V20 §B/§D）
		 * 为什么必须能"说"出来：左栏大纲的按钮只解决"看得见"，而用户真正的修改入口
		 * 是底栏那句自然语言（"把 R6 隐藏"）。大纲点了能做的事，指令里说不出，
		 * 就等于把一半能力锁在鼠标上。
		 * 🔴 `置底` 必须排在 `置顶` **之后**：两者前缀不同（置顶/置底），无冲突风险，
		 *    但保持"先精确后宽泛"的顺序是既有约定，别打乱。
		 */
		{ op: "reorderBottom", re: /置底\s*(.+)$/ },
		{ op: "hide", re: /隐藏\s*(.+)$/ },
		{ op: "show", re: /显示\s*(.+)$/ },
		{ op: "lock", re: /锁定\s*(.+)$/ },
		{ op: "unlock", re: /解锁\s*(.+)$/ }
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
				/* `置底` 与 `置顶` 是同一个底层操作，只是 where 不同 ⇒ 归一成 reorder，
				 * 免得 applyOps 里出现两个几乎一样的分支（重复即漂移）。 */
				if (p.op === "reorderBottom") ops.push({ op: "reorder", target: el.id, args: { where: "bottom" } });
				else if (p.op === "reorder") ops.push({ op: "reorder", target: el.id, args: { where: "top" } });
				else ops.push({ op: p.op, target: el.id, args: {} });
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
		/* 工作态（2026-09-14 新增）：隐藏 / 显示 / 锁定 / 解锁 —— 走同一入口，
		 * 保证"左栏按钮"与"底栏指令"改的是同一份状态（一处真相源）。 */
		else if (o.op === "hide") d = setElementFlags(d, o.target, { hidden: true });
		else if (o.op === "show") d = setElementFlags(d, o.target, { hidden: false });
		else if (o.op === "lock") d = setElementFlags(d, o.target, { locked: true });
		else if (o.op === "unlock") d = setElementFlags(d, o.target, { locked: false });
		else if (o.op === "note") d = setElementFlags(d, o.target, { note: o.args.note });
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
		/* 画面 / 层 / 结构视图（2026-09-14 · V20）：大纲、统计、工作态、归属、换序、DSL */
		SCREENS, SCREEN_KEYS, SCREEN_ORDER, LAYERS, LAYER_KEYS, LAYER_ORDER,
		screenOf, layerOf, outlineOf, screenStats, designStats, layerOverlaps,
		setElementFlags, setElementPlacement, setScreenHidden, reorderInScreen,
		toDesignDSL, parseDesignDSL, applyDesignDSL,
		hydrateDesignBackup   // 冷备恢复（装载期调用；仅主存为空时生效）
	};
	// 装载即尝试冷备恢复：主存为空（换端口 / 清缓存）时把设计图找回来
	try { hydrateDesignBackup(); } catch (e) { /* 冷备失败不影响主流程 */ }
	return window.__dshDesign;
}
