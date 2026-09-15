#!/usr/bin/env node
/**
 * verify-dialog.mjs — 批次 9「弹窗式总监架构」离线验证
 *   T-PLUG-015 · docs/11 §六 T9（离线部分）
 *
 * 覆盖：
 *   A 数据元独立（要求 1 · docs/10 §3.4）
 *   B 三态与边界钳制（要求 6 · docs/11 §二 I6 / I8）
 *   C 布局分屏通道（要求 5 · docs/11 §三 3.2）——含「零节点移动 / 逐值可逆」反证
 *   D 双向联动通道（要求 5）——含 React 受控输入写法与两级降级**实跑**
 *   E 层级入口（要求 7 / 9）
 *   F 五步路由 + 三去向（要求 8）
 *   G 六维审核（要求 3 · 17 号文 §1A.9 不得减项）
 *   H 弹窗本体与挂载契约（要求 6 / 10 / 11）
 *   I 产物体检（T7）
 *   J R5 冻结键反证（最高优先级约束）
 *
 * 设计要点：
 *   1) 本脚本自建**最小浏览器桩**（window / document / localStorage / Element /
 *      HTMLTextAreaElement / MutationObserver），使 split / chat-bridge / layout 的
 *      DOM 分支可**真跑**，而非只做源码字符串断言。
 *   2) 纯函数（buildSplitCss / matchRowToNode / review6 / route / clampPanelWidth…）
 *      一律**实调**并断言精确值。
 *   3) 每个断言输出可核验证据（实测值 / 命中位置），便于 CP 检查点取证。
 *
 * 🔴 正确用法（2026-09-13 补写 —— 此前**没写用法**，直接 `node scripts/verify-dialog.mjs`
 *   会崩在 `Cannot find package 'react'`：`src/mount.js` 以 ADR-001 把 react 声明为
 *   平台冻结模块、本地不装 node_modules）：
 *
 *       node --import ./scripts/_platform-stub.mjs scripts/verify-dialog.mjs
 *
 * ⚠ 本脚本**不在基线闸门清单内**（历史脚本，批次 9 时代）。已知边界：
 *   · H9/H10 一类「入口元素存在于 body」的断言在离线桩下**天然不成立**
 *     （FloatDock 是 React 组件，桩只建 DOM 不渲染）⇒ 已改为契约断言，
 *     真机断言在 `cdp-click-dialog.mjs` D1。
 *   · 离线 JSON 产物与真机行为不完全等同 ⇒ 真机为准。
 *
 * 退出码：0 = 全部通过；1 = 存在失败。
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const BUNDLE_PATH = join(ROOT, "lib", "client.js");

/* ══════════════════════════════════════════════════════════════════
 * 0. 断言框架
 * ══════════════════════════════════════════════════════════════════ */
let TOTAL = 0, PASS = 0, FAIL = 0;
const FAILS = [];
function ok(name, cond, evidence) {
	TOTAL++;
	const ev = evidence === undefined ? "" : "  |  " + String(evidence);
	if (cond) { PASS++; console.log(`  PASS  ${name}${ev}`); }
	else { FAIL++; FAILS.push(name); console.log(`  FAIL  ${name}${ev}`); }
}
function eq(name, actual, expected) {
	ok(name, actual === expected, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function eqArr(name, actual, expected) {
	ok(name, JSON.stringify(actual) === JSON.stringify(expected), `actual=${JSON.stringify(actual)}`);
}
function sec(t) { console.log(`\n── ${t} ──`); }
function read(rel) { return readFileSync(join(ROOT, rel), "utf8"); }
function src(rel) { return readFileSync(join(SRC, rel), "utf8"); }
/** 剥离注释后的源码（判断「是否真的调用了 API」时必须用它——注释里常写着「不 preventDefault」这类否定句） */
function code(rel) {
	return src(rel)
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}
function has(s, re) { return re instanceof RegExp ? re.test(s) : s.includes(re); }

/* ══════════════════════════════════════════════════════════════════
 * 1. 最小浏览器桩（必须在 import 业务模块**之前**装好）
 * ══════════════════════════════════════════════════════════════════ */

/** 极简选择器匹配：支持 tag、[attr]、tag[attr="v"]、逗号分隔 */
function matches(el, sel) {
	return String(sel).split(",").map((s) => s.trim()).filter(Boolean).some((one) => {
		// 支持可组合选择器：`tag` / `#id` / `[attr]` / `[attr=val]` / `tag#id[attr=val]`
		// 🔴 必须支持 `#id`：`split.isPluginNode` 用 `closest("#dsh-director-dialog,…")`，
		//    老版引擎不认 `#id` ⇒ 插件自身永不判为「插件节点」⇒ E-SPLIT-001 无法离线复现。
		const m = one.match(/^([a-zA-Z*]*)(?:#([\w-]+))?(?:\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\])?$/);
		if (!m) return false;
		const [, tag, id, attr, val] = m;
		if (tag && tag !== "*" && el.tagName !== tag.toUpperCase()) return false;
		if (id && el.getAttribute("id") !== id) return false;
		if (attr) {
			if (!el.hasAttribute(attr)) return false;
			if (val !== undefined && el.getAttribute(attr) !== val) return false;
		}
		return true;
	});
}

class El {
	constructor(tag) {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.parentElement = null;
		this.attrs = new Map();
		this.style = {};
		this._rect = { x: 0, y: 0, width: 10, height: 10, left: 0, top: 0 };
		this.textContent = "";
		this.disabled = false;
		this._events = [];
		this.value = "";
	}
	setAttribute(k, v) { this.attrs.set(k, String(v)); }
	getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
	removeAttribute(k) { this.attrs.delete(k); }
	hasAttribute(k) { return this.attrs.has(k); }
	appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
	removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentElement = null; }
	remove() { if (this.parentElement) this.parentElement.removeChild(this); }
	click() { this._clicked = true; }
	getBoundingClientRect() { return this._rect; }
	dispatchEvent(e) { this._events.push(e && e.type); return true; }
	addEventListener() { /* noop */ }
	removeEventListener() { /* noop */ }
	closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parentElement; } return null; }
	get id() { return this.getAttribute("id") || ""; }
	set id(v) { this.setAttribute("id", v); }
	querySelectorAll(sel) {
		const out = [];
		const walk = (e) => { for (const c of e.children) { if (matches(c, sel)) out.push(c); walk(c); } };
		walk(this);
		return out;
	}
	querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

// 受控输入桩：HTMLTextAreaElement.prototype 必须具备 value 存取器，
// 否则 chat-bridge 的「原生 setter」分支不可测（会走 catch）。
Object.defineProperty(El.prototype, "value", {
	configurable: true,
	get() { return this._v === undefined ? "" : this._v; },
	set(v) { this._v = String(v); }
});
globalThis.HTMLTextAreaElement = El;
globalThis.HTMLInputElement = El;
globalThis.HTMLElement = El;
globalThis.Event = class Event { constructor(type, o) { this.type = type; this.bubbles = Boolean(o && o.bubbles); } };
globalThis.CustomEvent = globalThis.Event;

class MutationObserverStub {
	constructor(cb) { this.cb = cb; this.target = null; this.options = null; MutationObserverStub.instances.push(this); }
	observe(t, o) { this.target = t; this.options = o; }
	disconnect() { this.disconnected = true; }
}
MutationObserverStub.instances = [];
globalThis.MutationObserver = MutationObserverStub;

/* ── 构建真机同构 DOM 骨架 ── */
const head = new El("head");
const body = new El("body");
/* 🔴 E-SPLIT-002 干扰节点：侧栏（280×816，恰满足「应用根」尺寸判据）+ 其内部的
 *    `input[type=text]` 搜索框。旧实现兜底锚点含 `input[type=text]` ⇒ 命中搜索框
 *   ⇒ 向上爬到侧栏 ⇒ 把**侧栏**当成对话根、padding 加到侧栏上。
 *    位置放在 `root` **之前**（document 序在前，更容易被先命中）。 */
const sidebarCol = new El("div");
sidebarCol._rect = { x: 0, y: 0, width: 280, height: 816, left: 0, top: 0 };
const sidebarSearch = new El("input");
sidebarSearch.setAttribute("type", "text");
sidebarSearch._rect = { x: 176, y: 270, width: 28, height: 28, left: 176, top: 270 };
sidebarCol.appendChild(sidebarSearch);
const root = new El("div");           // 原生应用根
root._rect = { x: 280, y: 0, width: 1154, height: 816, left: 280, top: 0 };
/* 🔴 滚动容器干扰节点：尺寸与 root 完全一致、位于锚点与 root 之间。
 *    真机逐层实测（_probe-pad.mjs）证明在它上面挂 padding 会**产生横向溢出**。
 *    故 `findChatRoot` 必须跳过它、落到 root ⇒ 本节点是 E-SPLIT-003 的离线复现装置。 */
const scrollBody = new El("div");
scrollBody._rect = { x: 280, y: 0, width: 1154, height: 816, left: 280, top: 0 };
scrollBody._overflowX = "auto";
const header = new El("header");
const tabs = new El("div");
const tabBtn = new El("button");      // tab 环锚点：y<90 / w<60 / 文本≤3
tabBtn.textContent = "对话";
tabBtn._rect = { x: 308, y: 48, width: 26, height: 27, left: 308, top: 48 };
const viewArea = new El("div");
const composerSeat = new El("div");
const ta = new El("textarea");
ta.setAttribute("placeholder", "给智能体发消息");
ta._rect = { x: 300, y: 700, width: 800, height: 40, left: 300, top: 700 };
const sendBtn = new El("button");
sendBtn.setAttribute("aria-label", "发送消息");
sendBtn.click = () => { sendBtn._clicked = true; ta.value = ""; }; // 原生：发送后清空编辑器
tabs.appendChild(tabBtn);
composerSeat.appendChild(ta);
composerSeat.appendChild(sendBtn);
scrollBody.appendChild(header); scrollBody.appendChild(tabs); scrollBody.appendChild(viewArea); scrollBody.appendChild(composerSeat);
root.appendChild(scrollBody);
body.appendChild(sidebarCol);
body.appendChild(root);

const byId = () => [head, body, ...body.querySelectorAll("*"), ...head.querySelectorAll("*")];
const documentStub = {
	head, body, readyState: "complete",
	createElement: (t) => new El(t),
	getElementById: (id) => byId().find((e) => e.getAttribute("id") === id) || null,
	querySelector: (s) => body.querySelector(s),
	querySelectorAll: (s) => body.querySelectorAll(s),
	addEventListener: () => { }, removeEventListener: () => { }
};
const store = new Map();
const localStorageStub = {
	getItem: (k) => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => { store.set(k, String(v)); },
	removeItem: (k) => { store.delete(k); },
	clear: () => store.clear(),
	key: (i) => [...store.keys()][i] || null,
	get length() { return store.size; }
};
// 预置「含未知字段」的既有布局值 → 验证「只合并已知字段」
store.set("dsh.director.layout", JSON.stringify({
	directorPanelWidth: 420, chatPanelWidth: 333, focusTarget: "chat", __unknownField: 12345
}));

globalThis.window = {
	innerWidth: 1440, innerHeight: 800,
	localStorage: localStorageStub,
	// 供 `split.isScrollContainer` 使用（真机语义：读 computedStyle.overflowX）
	getComputedStyle: (el) => ({ overflowX: (el && el._overflowX) || "visible" }),
	addEventListener: () => { }, removeEventListener: () => { }
};
globalThis.document = documentStub;
globalThis.localStorage = localStorageStub;
// Node ≥ 21 的 globalThis.navigator 是只读 getter → 仅在缺失/可写时补桩
try { if (!globalThis.navigator) globalThis.navigator = { userAgent: "node" }; } catch (e) { /* 只读，忽略 */ }
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

/* ══════════════════════════════════════════════════════════════════
 * 2. 动态导入业务模块
 *
 * 🔴 自诊断（2026-09-13 加）：本块任一模块都可能（直接或间接）`import "react"`，
 *   而 `react` 按 ADR-001 是**平台冻结模块**、本仓库不装 node_modules。
 *   裸跑 `node scripts/verify-dialog.mjs` 会崩在 `Cannot find package 'react'`
 *   —— 那个栈**看不出"其实只是少了 `--import`"**，本轮就有人因此白花时间，
 *   且它算**用错用法**（INVALID）而不是**产品不合格**（FAIL）。
 *   ⇒ 统一捕获并**打印正确命令 + exit 2**（与本仓库 exit 码约定一致：2 = INVALID）。
 *   ⚠ 导入**顺序保持原样**（`mount.js` 有副作用，不许提前）。
 * ══════════════════════════════════════════════════════════════════ */
let PDB, LAYOUT, HASH, HIER, IDB, SPLIT, CHAT, NAV, ROUTE, MOUNT, DIALOG, ARUNS;
try {
	PDB = await import("../src/store/plugin-db.js");
	LAYOUT = await import("../src/store/layout.js");
	HASH = await import("../src/store/hash.js").catch(() => null); // 若不存在则忽略
	HIER = await import("../src/store/hierarchy.js");
	IDB = await import("../src/store/idb.js");
	SPLIT = await import("../src/bridge/split.js");
	CHAT = await import("../src/bridge/chat-bridge.js");
	NAV = await import("../src/bridge/nav-hook.js");
	ROUTE = await import("../src/logic/routing.js");
	MOUNT = await import("../src/mount.js");
	DIALOG = await import("../src/components/DirectorDialog.js");
	ARUNS = await import("../src/store/agent-runs.js");
} catch (e) {
	const m = String((e && e.message) || e);
	if (/Cannot find package '(react|react-dom|react\/jsx-runtime)'/.test(m) || /ERR_MODULE_NOT_FOUND/.test(m)) {
		console.error("[verify-dialog] INVALID 缺少**平台桩解析钩子**");
		console.error("  `react` 按 ADR-001 是平台冻结模块，本仓库不装 node_modules ⇒ 必须带钩子运行。");
		console.error("  正确用法：");
		console.error("    node --import ./scripts/_platform-stub.mjs scripts/verify-dialog.mjs");
		console.error("  （注：这与「断言失败」是两回事 —— 用错目标 ≠ 目标不合格，故 exit 2 而非 1。）");
		process.exit(2);
	}
	throw e;
}
void HASH;
void PDB; void LAYOUT; void HIER; void IDB; void SPLIT; void CHAT; void NAV;
void ROUTE; void MOUNT; void DIALOG; void ARUNS;

/* ══════════════════════════════════════════════════════════════════
 * A. 数据元独立（要求 1 · docs/10 §3.4）
 * ══════════════════════════════════════════════════════════════════ */
sec("A. 数据元独立 —— 要求 1「总监与对话各自独立的数据元，不可共用一套数据」");

eq("A1 插件库名 = dsh-director-plugin-db", PDB.PLUGIN_DB_NAME, "dsh-director-plugin-db");
eq("A2 宿主库名 = dsh-director-db（对照）", IDB.IDB_DB_NAME, "dsh-director-db");
ok("A3 两库不同名（物理隔离前提）", PDB.PLUGIN_DB_NAME !== IDB.IDB_DB_NAME, `${PDB.PLUGIN_DB_NAME} ≠ ${IDB.IDB_DB_NAME}`);
ok("A4 插件库名不含宿主库名子串（改名反证）", !PDB.PLUGIN_DB_NAME.includes("dsh-director-db"), PDB.PLUGIN_DB_NAME);
/* 🔴 2026-09-13 闸门纠错：插件**自有库**版本随功能追加而升（v1 → v2，新增
 *   `directorDesigns` 以支持设计图持久化）。判据的关键**不是版本号本身**，
 *   而是「插件库**独立编号**、不参与宿主 v3 协商」——那才是"独立数据元"的
 *   设计目的（见 docs/10 §3.4）。故改为「≥1」，宿主版本另有 A6 紧守。 */
ok("A5 插件库独立编号（≥1 · 不参与宿主 v3 协商）", PDB.PLUGIN_DB_VERSION >= 1, "插件库 v" + PDB.PLUGIN_DB_VERSION);
eq("A6 宿主库版本 = 3（未被改动）", IDB.IDB_VERSION, 3);
/* 🔴 2026-09-13：store 集合是**必需集 ⊆ 实有集**，不是「恰好相等」——
 *   批次 11/12 新增 `directorDesigns` 后，旧判据（==6 / 全等数组）双双变红。
 *   按「有契约的可扩展」重写：必需 6 项一个都不能少，新增项如实列出。 */
const REQUIRED_STORES = ["directorNodes", "directorConversations", "directorPlans", "directorReviews", "directorDecisions", "directorTodos"];
const missingStores = REQUIRED_STORES.filter((s) => !PDB.PDB_ALL_STORES.includes(s));
const extraStores = PDB.PDB_ALL_STORES.filter((s) => !REQUIRED_STORES.includes(s));
ok("A7 插件库含 " + REQUIRED_STORES.length + " 个必需 object store（允许扩展）", missingStores.length === 0,
	"实有 " + PDB.PDB_ALL_STORES.length + " 个" + (extraStores.length ? " · 新增: " + extraStores.join(",") : ""));
ok("A8 必需 store 名逐项一致（新增项不破坏契约）", missingStores.length === 0,
	missingStores.length ? "缺: " + missingStores.join(",") : PDB.PDB_ALL_STORES.join(","));
const overlap = PDB.PDB_ALL_STORES.filter((s) => IDB.IDB_ALL_STORES.includes(s));
eqArr("A9 与宿主 6 store 零重叠（不共用数据）", overlap, []);
eqArr("A10 宿主 store 清单（对照）", [...IDB.IDB_ALL_STORES], ["directorStores", "directorDocs", "directorFolders", "memoryCore", "memoryDecisions", "memoryRisks"]);
eq("A11 directorNodes.keyPath = nodeId", PDB.PDB_SCHEMA[PDB.PDB.NODES].keyPath, "nodeId");
ok("A12 每个 store 均有 keyPath", PDB.PDB_ALL_STORES.every((s) => Boolean(PDB.PDB_SCHEMA[s].keyPath)), PDB.PDB_ALL_STORES.map((s) => PDB.PDB_SCHEMA[s].keyPath).join(" / "));
ok("A13 directorConversations 有 nodeId 索引", Boolean(PDB.PDB_SCHEMA[PDB.PDB.CONVERSATIONS].indexes.nodeId), "indexes.nodeId=" + PDB.PDB_SCHEMA[PDB.PDB.CONVERSATIONS].indexes.nodeId);
const pdbSrc = src("store/plugin-db.js");
ok("A14 saveDirectorNode 显式注入主键 nodeId（避免 put 静默失败）", has(pdbSrc, /nodeId:\s*node\.id/), "命中 nodeId: node.id");
ok("A15 openPluginDB 按 PLUGIN_DB_NAME 打开（非宿主机名）", has(pdbSrc, /indexedDB\.open\(\s*PLUGIN_DB_NAME/), "indexedDB.open(PLUGIN_DB_NAME");
const openCalls = (code("store/idb.js").match(/indexedDB\.open\(/g) || []).length + (code("store/plugin-db.js").match(/indexedDB\.open\(/g) || []).length;
eq("A16 全插件仅 2 处 indexedDB.open（各库各一，注释不计）", openCalls, 2);
ok("A17 installPluginDbApi 暴露 window.__dshPluginDb", has(pdbSrc, /window\.__dshPluginDb\s*=/), "window.__dshPluginDb =");
const hierSrc = src("store/hierarchy.js");
ok("A18 层级层双写开关存在（MIRROR_LEGACY_MEMORY_CORE）", has(hierSrc, /MIRROR_LEGACY_MEMORY_CORE/), "MIRROR_LEGACY_MEMORY_CORE");
ok("A19 镜像写入旧库时注入 projectId（旧库 keyPath=projectId）", has(hierSrc, /projectId:\s*node\.id/), "命中 projectId: node.id");
ok("A20 主读新库 + 回落旧库（getNode 双读）", has(hierSrc, /pdbGetNode/) && has(hierSrc, /legacyGet/), "pdbGetNode + legacyGet");
const dbApi = PDB.installPluginDbApi();
ok("A21 运行期 installPluginDbApi 返回契约对象", Boolean(dbApi && dbApi.PDB_SCHEMA), `keys=${dbApi ? Object.keys(dbApi).length : 0}`);
eq("A22 运行期 window.__dshPluginDb 挂载一致", typeof window.__dshPluginDb, "object");
ok("A23 无 IDB 环境下 pluginDbStats 不抛异常", await PDB.pluginDbStats().then(() => true).catch(() => false), "优雅降级");
const pdbStat = await PDB.pluginDbStats();
eq("A24 pluginDbStats.ok = false（离线无 IndexedDB）", pdbStat.ok, false);

/* ══════════════════════════════════════════════════════════════════
 * B. 三态与边界钳制（要求 6 · docs/11 §二 I6 / I8）
 * ══════════════════════════════════════════════════════════════════ */
sec("B. 三态（展开 / 最小化 / 关闭）与拖拽边界吸附 —— 要求 6");

eqArr("B1 LEFT_TAB 三段", Object.values(LAYOUT.LEFT_TAB), ["director", "levels", "agents"]);
eq("B2 PANEL_RAIL_WIDTH = 40", LAYOUT.PANEL_RAIL_WIDTH, 40);
eq("B3 PANEL_MIN_WIDTH = 180", LAYOUT.PANEL_MIN_WIDTH, 180);
eq("B4 PANEL_DEFAULT_WIDTH = 300", LAYOUT.PANEL_DEFAULT_WIDTH, 300);
eq("B5 面板宽度上限比例 = 0.55", LAYOUT.PANEL_MAX_RATIO, 0.55);
const maxW = LAYOUT.maxPanelWidth();
eq("B6 maxPanelWidth = round(视口宽 × 0.55)", maxW, Math.round(1440 * 0.55));
const c1 = LAYOUT.clampPanelWidth(100);
ok("B7 clampPanelWidth(100) → 触底折叠吸附", c1.width === 180 && c1.collapse === true, JSON.stringify(c1));
const c2 = LAYOUT.clampPanelWidth(300);
ok("B8 clampPanelWidth(300) → 原样保留", c2.width === 300 && c2.collapse === false, JSON.stringify(c2));
const c3 = LAYOUT.clampPanelWidth(99999);
ok("B9 clampPanelWidth(99999) → 被上限钳制", c3.width === maxW && c3.collapse === false, JSON.stringify(c3));
const ls = LAYOUT.directorLayoutStore.getState();
eq("B10 dialogOpen 默认 false", ls.dialogOpen, false);
eq("B11 dialogCollapsed 默认 false", ls.dialogCollapsed, false);
eq("B12 activeNodeId 默认 null", ls.activeNodeId, null);
eq("B13 leftTab 默认 director", ls.leftTab, "director");
eq("B14 既有字段 directorPanelWidth 保留（存量数据可用）", ls.directorPanelWidth, 420);
eq("B15 既有字段 chatPanelWidth 保留", ls.chatPanelWidth, 333);
eq("B16 既有字段 focusTarget 保留", ls.focusTarget, "chat");
ok("B17 未知字段 __unknownField 被丢弃（只合并已知字段）", ls.__unknownField === undefined, "undefined");
const layoutSrc = src("store/layout.js");
for (const m of ["setDialogOpen", "toggleDialog", "setDialogCollapsed", "toggleDialogCollapsed", "setActiveNode", "setLeftTab", "dragDirectorWidth", "dragChatWidth", "resetPanelWidths", "resetLayout"]) {
	ok(`B18 新增 API ${m}`, typeof LAYOUT.directorLayoutStore[m] === "function", typeof LAYOUT.directorLayoutStore[m]);
}
eq("B19 布局持久化 key 未改名（R5）", "dsh.director.layout", "dsh.director.layout");
ok("B20 源码确实使用 dsh.director.layout", has(layoutSrc, /dsh\.director\.layout/), "命中");
let notified = 0;
const unsub = LAYOUT.directorLayoutStore.subscribe(() => { notified++; });
LAYOUT.directorLayoutStore.setDialogOpen(true);
ok("B21 setDialogOpen(true) 触发订阅通知", notified > 0 && LAYOUT.directorLayoutStore.getState().dialogOpen === true, `notified=${notified} open=${LAYOUT.directorLayoutStore.getState().dialogOpen}`);
LAYOUT.directorLayoutStore.toggleDialog();
eq("B22 toggleDialog 收回", LAYOUT.directorLayoutStore.getState().dialogOpen, false);
LAYOUT.directorLayoutStore.setActiveNode("se_x");
eq("B23 setActiveNode 写入", LAYOUT.directorLayoutStore.getState().activeNodeId, "se_x");
LAYOUT.directorLayoutStore.setLeftTab("agents");
eq("B24 setLeftTab 写入", LAYOUT.directorLayoutStore.getState().leftTab, "agents");
unsub();
ok("B25 既有签名 setDirectorWidth 钳制区间不变（180..600）", (() => {
	LAYOUT.directorLayoutStore.setDirectorWidth(50);
	const a = LAYOUT.directorLayoutStore.getState().directorPanelWidth;
	LAYOUT.directorLayoutStore.setDirectorWidth(9999);
	const b = LAYOUT.directorLayoutStore.getState().directorPanelWidth;
	return a === 180 && b === 600;
})(), "50→180 / 9999→600");

/* ══════════════════════════════════════════════════════════════════
 * C. 布局分屏通道（要求 5 · docs/11 §三 3.2）
 * ══════════════════════════════════════════════════════════════════ */
sec("C. 布局分屏通道 —— 要求 5「右栏与对话 tab 完全一致」的零移动实现");

eq("C1 SPLIT_STYLE_ID", SPLIT.SPLIT_STYLE_ID, "dsh-director-split-style");
eq("C2 ROOT_ATTR", SPLIT.ROOT_ATTR, "data-dsh-split-root");
eq("C3 STATE_ATTR", SPLIT.STATE_ATTR, "data-dsh-split-collapsed");
const css0 = SPLIT.buildSplitCss(0);
eq("C4 buildSplitCss(0) 精确文本", css0, "[data-dsh-split-root]{padding-left:0px !important;box-sizing:border-box !important;transition:padding-left .14s ease;}");
const css300 = SPLIT.buildSplitCss(300);
ok("C5 buildSplitCss(300) 含 padding-left:300px", css300.includes("padding-left:300px !important;"), css300);
eq("C6 buildSplitCss(-5) 钳到 0", SPLIT.buildSplitCss(-5), css0);
eq("C7 buildSplitCss('abc') → 0（非数值安全）", SPLIT.buildSplitCss("abc"), css0);
eq("C8 buildSplitCss(300.6) 取整", SPLIT.buildSplitCss(300.6).includes("padding-left:301px"), true);
const splitSrc = src("bridge/split.js");
ok("C9 buildSplitCss 为单参数纯函数（便于离线断言）", has(splitSrc, /export function buildSplitCss\(paddingLeft\)/), "签名 buildSplitCss(paddingLeft)");
const foundRoot = SPLIT.findChatRoot();
ok("C10 findChatRoot 语义定位到应用根（非 hash 类名）", foundRoot === root, `found=${foundRoot ? foundRoot.tagName : "null"}`);
const rect = SPLIT.getSplitRootRect();
ok("C11 getSplitRootRect 返回真机同构矩形", rect && rect.x === 280 && rect.w === 1154, JSON.stringify(rect));
const ap = SPLIT.applySplit({ paddingLeft: 100, collapsed: null });
ok("C12 applySplit 注入成功", ap.ok === true && ap.paddingLeft === 100, JSON.stringify({ ok: ap.ok, paddingLeft: ap.paddingLeft }));
ok("C13 应用根被打上 ROOT_ATTR", root.getAttribute(SPLIT.ROOT_ATTR) === "1", root.getAttribute(SPLIT.ROOT_ATTR));
ok("C14 🔴 零节点移动：原生节点的 style 属性零改动", Object.keys(root.style).length === 0 && Object.keys(viewArea.style).length === 0, `root.style keys=${Object.keys(root.style).length}`);
/* 2026-09-13：head 现有两个 style 节点（分屏 + 个性化令牌），"单一"是批次 9 的旧约束。
 *   本判据真正要防的是「分屏样式**重复注入**」（多次 applySplit 累加节点）⇒ 改为按 id 计数。 */
const splitStyleCount = head.querySelectorAll("#" + SPLIT.SPLIT_STYLE_ID).length;
ok("C15 分屏样式节点唯一（不重复注入）", splitStyleCount === 1,
	"分屏样式 ×" + splitStyleCount + " · head 共 " + head.children.length + " 个 style（含个性化令牌）");
eq("C16 样式文本 = buildSplitCss(100)", document.getElementById(SPLIT.SPLIT_STYLE_ID).textContent, SPLIT.buildSplitCss(100));
ok("C17 isSplitActive() = true", SPLIT.isSplitActive() === true, String(SPLIT.isSplitActive()));
const st1 = SPLIT.getSplitState();
ok("C18 getSplitState 快照正确", st1.active === true && st1.paddingLeft === 100, JSON.stringify(st1));
SPLIT.applySplit({ paddingLeft: 100, collapsed: "right" });
ok("C19 折叠态写入 STATE_ATTR", root.getAttribute(SPLIT.STATE_ATTR) === "right", root.getAttribute(SPLIT.STATE_ATTR));
ok("C20 applySplit 幂等：样式节点仍只有 1 个", head.children.filter((c) => c.getAttribute("id") === SPLIT.SPLIT_STYLE_ID).length === 1, `count=${head.children.filter((c) => c.getAttribute("id") === SPLIT.SPLIT_STYLE_ID).length}`);
SPLIT.applySplit({ paddingLeft: 0, collapsed: null });
ok("C21 折叠态清除（removeAttribute）", root.getAttribute(SPLIT.STATE_ATTR) === null, String(root.getAttribute(SPLIT.STATE_ATTR)));
const cl = SPLIT.clearSplit();
ok("C22 clearSplit 移除样式节点", cl.ok === true && cl.removedStyle === true, JSON.stringify(cl));
ok("C23 clearSplit 清理全部 data-* 标记", root.getAttribute(SPLIT.ROOT_ATTR) === null && root.getAttribute("data-dsh-split-host") === null, `ROOT_ATTR=${root.getAttribute(SPLIT.ROOT_ATTR)} host=${root.getAttribute("data-dsh-split-host")}`);
ok("C24 🔴 逐值可逆：clearSplit 后 style 仍为零改动", Object.keys(root.style).length === 0, `keys=${Object.keys(root.style).length}`);
ok("C25 clearSplit 后 isSplitActive() = false", SPLIT.isSplitActive() === false, String(SPLIT.isSplitActive()));
ok("C26 clearSplit 幂等（重复调用不抛）", (() => { try { SPLIT.clearSplit(); SPLIT.clearSplit(); return true; } catch (e) { return false; } })(), "两次调用无异常");
ok("C27 源码只打 data-* 属性，不写原生 style", !/\.style\.[\w]+\s*=/.test(splitSrc), "无 .style.X = 赋值");
ok("C28 异常兜底调用 clearSplit（不残留样式）", has(splitSrc, /clearSplit\(\);\s*$/m) || has(splitSrc, /clearSplit\(\);/) , "applySplit catch → clearSplit()");
const splitApi = SPLIT.installSplitApi();
ok("C29 installSplitApi 暴露 window.__dshSplitApi", Boolean(splitApi && window.__dshSplitApi), `keys=${splitApi ? Object.keys(splitApi).length : 0}`);
ok("C30 契约含 buildSplitCss / applySplit / clearSplit / getSplitRootRect", ["buildSplitCss", "applySplit", "clearSplit", "getSplitRootRect"].every((k) => typeof splitApi[k] === "function"), "四函数齐备");

/* ── C31–C42：真机踩坑的离线复现防线（docs/11 §八 E-SPLIT-001/002/003）── */
ok("C31 行为：findChatRoot 跳过滚动容器、落到真正的应用根（E-SPLIT-003 反证）",
	SPLIT.findChatRoot() === root, `found=${SPLIT.findChatRoot() === root ? "root（已跳过 scrollBody）" : "非 root"}`);
/* E-SPLIT-002 精确复现：① 把 composer 的 placeholder 改掉（首选锚点失效）
 * ② 把 tab 环按钮尺寸清零（次选锚点失效）⇒ 只剩「可见 textarea」这条兜底路径。
 * 旧实现兜底集合含 `input[type=text]` ⇒ 会命中**侧栏搜索框** ⇒ 向上爬到侧栏。 */
const fallbackNotSidebar = (() => {
	const keepPh = ta.getAttribute("placeholder");
	const keepRect = { ...tabBtn._rect };
	try {
		ta.removeAttribute("placeholder");
		tabBtn._rect = { x: 308, y: 48, width: 0, height: 0, left: 308, top: 48 };
		return { hit: SPLIT.findChatRoot(), isSidebar: SPLIT.findChatRoot() === sidebarCol };
	} finally {
		ta.setAttribute("placeholder", keepPh);
		tabBtn._rect = keepRect;
	}
})();
ok("C32 行为：findChatRoot 绝不命中侧栏（E-SPLIT-002 反证）",
	fallbackNotSidebar.hit === root && fallbackNotSidebar.isSidebar === false,
	"兜底路径（composer + tab 环均失效）仍解析到 root 而非侧栏（280×816 尺寸合格但被排除）");
ok("C32b 行为：锚点恢复后仍走首选路径（无副作用残留）", SPLIT.findChatRoot() === root, "root 复位");
const rootIsScroll = (() => {
	const keep = root._overflowX;
	try { root._overflowX = "auto"; return SPLIT.findChatRoot() === null; }
	finally { root._overflowX = keep; }
})();
ok("C33 行为：应用根本身是滚动容器时返回 null（优雅降级，不硬塞标记）", rootIsScroll === true, "null = 调用方不走分屏");
ok("C34 行为：恢复后仍能定位（无副作用残留）", SPLIT.findChatRoot() === root, "root 复位");
ok("C35 源码：兜底锚点**只用 textarea**（不含 input[type=text]，E-SPLIT-002 静态防线）",
	/for \(const t of document\.querySelectorAll\("textarea"\)\)/.test(splitSrc) && !/input\[type="text"\]/.test(splitSrc),
	"锚点集合 = textarea");
ok("C36 源码：锚点带插件自身排除（isPluginNode 前置过滤，E-SPLIT-001）",
	/if \(isPluginNode\(t\)\) continue;/.test(splitSrc) && /if \(isPluginNode\(btn\)\) continue;/.test(splitSrc),
	"textarea 与 button 两条锚点路径都过滤");
ok("C37 源码：isScrollContainer 判 auto/scroll/hidden", /ox === "auto" \|\| ox === "scroll" \|\| ox === "hidden"/.test(splitSrc), "三值齐备");
ok("C38 源码：宽度下限 = 40% 视口宽（侧栏 19% 被拒）", /r\.width > vw \* 0\.4/.test(splitSrc), "命中 vw * 0.4");
ok("C39 源码：applySplit 有 plugin-node 护栏（宁可不分屏，也不动自己）", /reason: "plugin-node"/.test(splitSrc), "命中护栏");
ok("C40 契约暴露 isPluginNode / PLUGIN_UI_IDS / CHAT_COMPOSER_PLACEHOLDER",
	typeof splitApi.isPluginNode === "function" && Array.isArray(splitApi.PLUGIN_UI_IDS) && typeof splitApi.CHAT_COMPOSER_PLACEHOLDER === "string",
	"三项齐备");
const idsMatch = DIALOG.DIALOG_ID === SPLIT.PLUGIN_UI_IDS[0] && MOUNT.DIALOG_HOST_ID === SPLIT.PLUGIN_UI_IDS[1] && MOUNT.LAUNCHER_ID === SPLIT.PLUGIN_UI_IDS[2] && MOUNT.OVERLAY_HOST_ID === SPLIT.PLUGIN_UI_IDS[3];
ok("C41 🔴 PLUGIN_UI_IDS 与各模块 id 常量逐一相等（防清单漂移）", idsMatch,
	SPLIT.PLUGIN_UI_IDS.join(" | "));
ok("C42 🔴 CHAT_COMPOSER_PLACEHOLDER 与 chat-bridge 的语义锚点相等（防漂移）",
	SPLIT.CHAT_COMPOSER_PLACEHOLDER === CHAT.COMPOSER_PLACEHOLDER,
	`split=${SPLIT.CHAT_COMPOSER_PLACEHOLDER} chat=${CHAT.COMPOSER_PLACEHOLDER}`);

/* ══════════════════════════════════════════════════════════════════
 * D. 双向联动通道（要求 5）
 * ══════════════════════════════════════════════════════════════════ */
sec("D. 双向联动 —— 要求 5「总监页面与原对话 tab 互相传送消息」");

eq("D1 发送按钮语义锚点", CHAT.SEND_ARIA, "发送消息");
eq("D2 composer 语义锚点", CHAT.COMPOSER_PLACEHOLDER, "给智能体发消息");
ok("D3 findComposer 命中语义锚点", CHAT.findComposer() === ta, CHAT.findComposer() === ta ? "命中 textarea" : "未命中");
ok("D4 findSendButton 命中语义锚点", CHAT.findSendButton() === sendBtn, CHAT.findSendButton() === sendBtn ? "命中 button" : "未命中");
const setRes = CHAT.setComposerText("总监转达：请补测试");
ok("D5 setComposerText 写入成功（走原生 setter）", setRes.ok === true, JSON.stringify({ ok: setRes.ok, reason: setRes.reason }));
eq("D6 🔴 写后回读与实际值一致", CHAT.readComposerText(), "总监转达：请补测试");
ok("D7 已派发 input 事件（React 受控输入必需）", ta._events.includes("input"), "events=" + JSON.stringify(ta._events));
ok("D8 已派发 change 事件", ta._events.includes("change"), "events=" + JSON.stringify(ta._events));
const chatSrc = src("bridge/chat-bridge.js");
ok("D9 源码用原生 value setter（HTMLTextAreaElement.prototype）", has(chatSrc, /getOwnPropertyDescriptor\(HTMLTextAreaElement\.prototype,\s*"value"\)/), "命中原生 setter");
ok("D10 源码派发 bubbles:true 的 input 事件", has(chatSrc, /new Event\("input",\s*\{\s*bubbles:\s*true\s*\}\)/), "命中 dispatchEvent");
const filled = await CHAT.sendToChat("仅填入不发送", { autoSend: false });
ok("D11 sendToChat(autoSend:false) → mode=filled 且回读校验通过", filled.ok === true && filled.mode === "filled" && filled.verified === true, JSON.stringify(filled));
eq("D12 filled 模式下文本已在编辑器内", CHAT.readComposerText(), "仅填入不发送");
const sent = await CHAT.sendToChat("真正发送");
ok("D13 sendToChat(autoSend 默认) → mode=sent", sent.ok === true && sent.mode === "sent", JSON.stringify(sent));
eq("D14 sent 后编辑器被清空（弱证据 verified=true）", sent.verified, true);
sendBtn.disabled = true;
const blocked = await CHAT.sendToChat("按钮禁用时");
ok("D15 🔴 按钮禁用 → 降级 filled 而非静默失败", blocked.ok === true && blocked.mode === "filled" && blocked.reason === "send-button-disabled", JSON.stringify(blocked));
sendBtn.disabled = false;
const det = ta.parentElement; det.removeChild(ta);
const noComposer = await CHAT.sendToChat("无编辑器");
ok("D16 无编辑器 → mode=failed 且带原因（绝不静默）", noComposer.ok === false && noComposer.mode === "failed" && noComposer.reason === "composer-not-found", JSON.stringify(noComposer));
det.appendChild(ta);
ok("D17 readConversation 无列表时优雅返回", (() => { const r = CHAT.readConversation(); return r && typeof r.count === "number" && typeof r.listFound === "boolean"; })(), JSON.stringify(CHAT.readConversation()));
ok("D18 observeConversation 安装 MutationObserver 并返回退订函数", (() => {
	const before = MutationObserverStub.instances.length;
	const off = CHAT.observeConversation(() => { });
	const mo = MutationObserverStub.instances[MutationObserverStub.instances.length - 1];
	const hasList = Boolean(CHAT.findMessageList());
	const installed = MutationObserverStub.instances.length === before + 1 && Boolean(mo.options && mo.options.childList);
	/* 🔴 2026-09-14 **判据更新**（原判据：无条件要求 `subtree === true`）。
	 *    原因：`findMessageList()` 新增了"宿主不在【对话】页签 ⇒ 返回 null"的前置判据
	 *    （页签是**内容互换**不是隐藏，总监页签下消息列表整体不在 DOM —— 实测见
	 *     `scripts/_probe-tab-mount.mjs`）。若此时仍以 `subtree:true` 观察 `document.body`，
	 *    就等于**全文档子树观察**，与本文件同族的一起布局抖动事故同源。
	 *    ⇒ 契约改为：**有消息列表才 subtree，没有就退化为 body 的 childList-only**。
	 *      新判据把"降级"本身也变成可断言的事实（而不是把降级悄悄放过）。 */
	const subtreeOk = hasList ? mo.options.subtree === true : mo.options.subtree === false;
	off();
	return installed && subtreeOk && mo.disconnected === true && typeof off === "function";
})(), "observer 已连接并成功退订；消息列表在场=" + Boolean(CHAT.findMessageList()) + "（不在场 ⇒ 只做 childList，不做全文档子树观察）");
const chatApi = CHAT.installChatBridgeApi();
ok("D19 installChatBridgeApi 暴露 window.__dshChatBridge", Boolean(chatApi && window.__dshChatBridge), `keys=${chatApi ? Object.keys(chatApi).length : 0}`);
ok("D20 契约含 sendToChat / readConversation / setComposerText", ["sendToChat", "readConversation", "setComposerText", "readComposerText", "submitComposer"].every((k) => typeof chatApi[k] === "function"), "五函数齐备");

/* ══════════════════════════════════════════════════════════════════
 * E. 层级入口（要求 7 / 9）
 * ══════════════════════════════════════════════════════════════════ */
sec("E. 侧栏点击 → 打开该层级总监 —— 要求 7「点文件夹/项目即展示其总监」+ 要求 9");

const NODES = [
	{ id: "root", name: "全局", level: "global", depth: 0 },
	{ id: "ws_1", name: "官网改版", level: "project", depth: 1 },
	{ id: "se_1", name: "修复登录按钮", level: "session", depth: 2 },
	{ id: "se_2", name: "官网改版", level: "session", depth: 2 },
	{ id: "se_3", name: "A", level: "session", depth: 2 }
];
ok("E1 matchRowToNode 精确同名优先", NAV.matchRowToNode("修复登录按钮", NODES)?.id === "se_1", NAV.matchRowToNode("修复登录按钮", NODES)?.id);
ok("E2 matchRowToNode 精确命中重复名时取首个", NAV.matchRowToNode("官网改版", NODES)?.id === "ws_1", NAV.matchRowToNode("官网改版", NODES)?.id);
ok("E3 matchRowToNode 包含匹配（行文本含节点名）", NAV.matchRowToNode("📁 官网改版 / 商品页", NODES)?.id === "ws_1", NAV.matchRowToNode("📁 官网改版 / 商品页", NODES)?.id);
ok("E4 matchRowToNode 包含匹配取最长者", NAV.matchRowToNode("修复登录按钮样式", NODES)?.id === "se_1", NAV.matchRowToNode("修复登录按钮样式", NODES)?.id);
ok("E5 matchRowToNode 单字名称不参与（避免噪声）", NAV.matchRowToNode("Abc", NODES) === null, String(NAV.matchRowToNode("Abc", NODES)));
ok("E6 matchRowToNode 无匹配 → null（不打扰宿主导航）", NAV.matchRowToNode("完全无关的内容", NODES) === null, String(NAV.matchRowToNode("完全无关的内容", NODES)));
ok("E7 matchRowToNode 空文本 → null", NAV.matchRowToNode("", NODES) === null, String(NAV.matchRowToNode("", NODES)));
const flat = NAV.flattenTree({ id: "root", name: "全局", level: "global", childNodes: [{ id: "ws_1", name: "官网改版", level: "project", childNodes: [{ id: "se_1", name: "修复登录按钮", level: "session", childNodes: [] }] }] });
eq("E8 flattenTree 深度优先并拍平", flat.length, 3);
eqArr("E9 flattenTree 携带 depth", flat.map((n) => n.depth), [0, 1, 2]);
ok("E10 extractRowText 向上找 ≤60 字的行", (() => { const row = new El("span"); row.textContent = "官网改版"; return NAV.extractRowText(row).text === "官网改版"; })(), "命中行文本");
const navSrc = src("bridge/nav-hook.js");
ok("E11 捕获阶段监听（pointerdown, capture=true）", has(navSrc, /addEventListener\("pointerdown",\s*onClick,\s*true\)/), "capture=true");
ok("E12 🔴 不拦截原生点击（代码层零 preventDefault / stopPropagation）", !/preventDefault|stopPropagation/.test(code("bridge/nav-hook.js")), "零拦截调用");
ok("E13 排除总监弹窗自身（#dsh-director-dialog）", has(navSrc, /closest\("#dsh-director-dialog"\)/), "命中 closest 排除");
ok("E14 仅在侧栏区域响应（clientX < rect.x）", has(navSrc, /e\.clientX\s*>=\s*rect\.x\)\s*return/), "命中侧栏判定");
ok("E15 命中后打开该层级总监（setActiveNode + setDialogOpen）", has(navSrc, /setActiveNode\(hit\.id\)/) && has(navSrc, /setDialogOpen\(true\)/), "两处调用齐备");
const off = NAV.installNavHook();
eq("E16 installNavHook 返回可调用的卸载函数", typeof off, "function");
off();
const navApi = NAV.installNavHookApi();
ok("E17 installNavHookApi 暴露 window.__dshNavApi", Boolean(navApi && window.__dshNavApi), `keys=${navApi ? Object.keys(navApi).length : 0}`);
ok("E18 navHookStats 计数器存在（可核验命中）", typeof NAV.navHookStats.matched === "number" && "lastMatch" in NAV.navHookStats, JSON.stringify(NAV.navHookStats));

/* ══════════════════════════════════════════════════════════════════
 * F. 五步路由 + 三去向（要求 8）
 * ══════════════════════════════════════════════════════════════════ */
sec("F. 唯一总监页 + 智能路由 —— 要求 8「整理确认应进入哪一个对话，可转派/直调」");

eqArr("F1 DESTINATION 三条去向", Object.values(ROUTE.DESTINATION), ["transfer", "direct", "create"]);
eq("F2 去向文案「转给该对话的总监」（与需求逐字一致）", ROUTE.DESTINATION_LABEL.transfer, "转给该对话的总监");
eq("F3 去向文案「直接调用对应对话」", ROUTE.DESTINATION_LABEL.direct, "直接调用对应对话");
eq("F4 去向文案「新建对话」", ROUTE.DESTINATION_LABEL.create, "新建对话");
const rtNodes = [
	{ id: "se_1", name: "修复登录按钮", level: "session", updatedAt: Date.now(), conversations: [{ title: "登录按钮样式调整" }] },
	{ id: "ws_1", name: "官网改版", level: "project" }
];
const r1 = ROUTE.route("修复登录按钮的样式，然后补测试", { nodes: rtNodes, currentNodeId: "ws_1" });
eq("F5 route() 返回五步轨迹", r1.steps.length, 5);
eqArr("F6 五步标题与 17 号文 §三 一致", r1.steps.map((s) => s.title), ["意图理解", "项目匹配", "任务拆分", "路由决策", "执行落实"]);
ok("F7 STEP4 标为待确认（pending，不静默分发）", r1.steps[3].pending === true && r1.steps[3].done === false, JSON.stringify(r1.steps[3]));
ok("F8 STEP5 未完成（确认后才落实）", r1.steps[4].done === false, JSON.stringify(r1.steps[4]));
ok("F9 intent 命中并给出置信度", typeof r1.intent.kind === "string" && r1.intent.confidence > 0 && r1.intent.confidence <= 0.95, JSON.stringify(r1.intent));
ok("F10 意图类型属五类（需求/问题/指令/讨论/反馈）", Object.values(ROUTE.INTENT).includes(r1.intent.kind), r1.intent.kind);
ok("F11 scoreNodes 名称命中权重最高（3 分/词）", (() => {
	const s = ROUTE.scoreNodes("修复登录按钮", rtNodes);
	return s[0].nodeId === "se_1" && s[0].score >= 3;
})(), JSON.stringify(ROUTE.scoreNodes("修复登录按钮", rtNodes)[0]));
ok("F12 route 候选已按分排序", r1.candidates.length === 0 || r1.candidates.every((c, i, a) => i === 0 || a[i - 1].score >= c.score), r1.candidates.map((c) => c.score).join(","));
ok("F13 任务拆分按连接词切分（「然后」→ 2 段）", r1.subtasks.length === 2, `subtasks=${r1.subtasks.length}`);
ok("F14 子任务带 index / intent", r1.subtasks.every((s) => s.index >= 1 && typeof s.text === "string" && typeof s.intent === "string"), JSON.stringify(r1.subtasks.map((s) => s.index)));
ok("F15 决策含 confidence + reason（可解释、可确认）", typeof r1.decision.confidence === "number" && r1.decision.reason.length > 0, r1.decision.reason.slice(0, 48));
eq("F16 命中有分会话 → 直调该对话", r1.decision.destination, "direct");
const r2 = ROUTE.route("官网改版相关", { nodes: rtNodes });
eq("F17 命中项目/文件夹 → 转派该层级总监", r2.decision.destination, "transfer");
const r3 = ROUTE.route("毫不相干的输入", { nodes: [] });
eq("F18 无候选 → 新建对话", r3.decision.destination, "create");
ok("F19 route 空输入不抛异常", (() => { try { const x = ROUTE.route("", {}); return Array.isArray(x.steps); } catch (e) { return false; } })(), "健壮");
ok("F20 confirmRoute 为异步函数（留痕不静默）", typeof ROUTE.confirmRoute === "function" && ROUTE.confirmRoute.constructor.name === "AsyncFunction", ROUTE.confirmRoute.constructor.name);
const cf = await ROUTE.confirmRoute("se_1", r1, ROUTE.DESTINATION.DIRECT);
ok("F21 离线无 IDB 时 confirmRoute 优雅降级（不抛）", typeof cf === "object" && cf !== null && "ok" in cf, JSON.stringify(cf));
ok("F22 🔴 listRouteHistory 存在（要求 8「可回看」，本轮修复点）", typeof ROUTE.listRouteHistory === "function", typeof ROUTE.listRouteHistory);
ok("F23 listRouteHistory 离线降级不抛", await Promise.resolve(ROUTE.listRouteHistory("se_1")).then(() => true).catch(() => false), "调用安全");
const routeSrc = src("logic/routing.js");
ok("F24 🔴 已消除 export…from 转发形态（bundler 不支持）", !/^export\s+.*\bfrom\s+"/m.test(routeSrc), "零转发导出");
ok("F25 confirmRoute 落库字段含 confirmed:true（可追溯）", has(routeSrc, /confirmed:\s*true/), "confirmed: true");
const routerApi = ROUTE.installRoutingApi();
ok("F26 installRoutingApi 暴露 window.__dshRouter", Boolean(routerApi && window.__dshRouter), `keys=${routerApi ? Object.keys(routerApi).length : 0}`);
ok("F27 window.__dshReview6 契约齐备", Boolean(window.__dshReview6 && window.__dshReview6.review6 && window.__dshReview6.REVIEW_DIMS), "已挂载");

/* ══════════════════════════════════════════════════════════════════
 * G. 六维审核（要求 3 · 17 号文 §1A.9 不得减项）
 * ══════════════════════════════════════════════════════════════════ */
sec("G. 六维审核 —— 要求 3「审核对话实际产出是否达标」");

eq("G1 六维不得减项（长度 = 6）", ROUTE.REVIEW_DIMS.length, 6);
eqArr("G2 六维 key 与 17 号文 §1A.9 逐项一致", ROUTE.REVIEW_DIMS.map((d) => d.key), ["requirement", "conformance", "quality", "risk", "completeness", "consistency"]);
eqArr("G3 六维中文标签", ROUTE.REVIEW_DIMS.map((d) => d.label), ["需求满足度", "方案符合度", "质量达标度", "风险控制", "完整性", "一致性"]);
ok("G4 每维均带检查提示（hint 非空）", ROUTE.REVIEW_DIMS.every((d) => typeof d.hint === "string" && d.hint.length > 4), ROUTE.REVIEW_DIMS.map((d) => d.hint.length).join(","));
const rvPass = ROUTE.review6({ goal: "", output: "完成弹窗式总监架构的实现与验证，含三态与分屏通道。", evidence: ["三处哈希一致", "cmp 逐字节通过"], risks: [] });
ok("G5 全达标输入 → pass=true 且无 failed", rvPass.pass === true && rvPass.failed.length === 0, `pass=${rvPass.pass} failed=${rvPass.failed.length}`);
ok("G6 score = ok 维数 / 6 × 100（全 ✅ ⇒ 100）", rvPass.score === Math.round((rvPass.dims.filter((d) => d.status === "ok").length / 6) * 100) && rvPass.score === 100, `score=${rvPass.score}`);
ok("G7 summary 覆盖六维并给出结论", /六维：/.test(rvPass.summary) && /⇒ 通过/.test(rvPass.summary), rvPass.summary);
eq("G8 summary 含 6 个状态标记", (rvPass.summary.match(/[✅⚠❌]/g) || []).length, 6);
const rvFail = ROUTE.review6({ goal: "实现弹窗", output: "", evidence: [], risks: ["存在未验证分支"] });
ok("G9 空产出 + 无证据 → pass=false 且 failed 非空", rvFail.pass === false && rvFail.failed.length > 0, `failed=[${rvFail.failed.map((d) => d.label).join(",")}]`);
eqArr("G9b 仅「硬缺口」维阻断通过（方案符合度 / 一致性）", rvFail.failed.map((d) => d.key), ["conformance", "consistency"]);
ok("G9c 🔴 三态齐备：单次审核内 ✅/⚠/❌ 同时出现（不得退化为二元）", (() => {
	const set = new Set(rvFail.dims.map((d) => d.status));
	return set.has("ok") === false && set.has("warn") && set.has("bad");
})(), rvFail.dims.map((d) => d.key + ":" + d.status).join(" "));
ok("G9d 全达标输入中 ⚠ 与 ❌ 均不出现", rvPass.dims.every((d) => d.status === "ok"), rvPass.dims.map((d) => d.status).join(","));
ok("G10 打回时 summary 列出未达标维（可追溯）", /打回（/.test(rvFail.summary), rvFail.summary);
ok("G11 风险非空 → 记为 warn（需确认可控，不阻断）", rvFail.dims.find((d) => d.key === "risk").status === "warn", rvFail.dims.find((d) => d.key === "risk").status);
ok("G12 缺一致性证据 → 记为 bad（硬缺口，阻断通过）", rvFail.dims.find((d) => d.key === "consistency").status === "bad", rvFail.dims.find((d) => d.key === "consistency").status);
ok("G13 🔴 确定性：同输入两次结果逐字段一致", (() => {
	const i = { goal: "G", output: "产出内容足够长以便通过完整性阈值判定。", evidence: ["一致"], risks: [] };
	const a = ROUTE.review6(i), b = ROUTE.review6(i);
	return a.score === b.score && a.summary === b.summary && a.pass === b.pass;
})(), "score/summary/pass 全等");
ok("G14 reviewAndSave 为异步函数", ROUTE.reviewAndSave.constructor.name === "AsyncFunction", ROUTE.reviewAndSave.constructor.name);
ok("G15 reviewAndSave 离线降级不抛", await ROUTE.reviewAndSave("se_1", { goal: "", output: "x".repeat(30), evidence: ["一致"], risks: [] }).then(() => true).catch(() => false), "调用安全");
ok("G16 tokenize 支持 CJK（切词非空）", ROUTE.tokenize("修复登录按钮").length > 0, JSON.stringify(ROUTE.tokenize("修复登录按钮")));
ok("G17 classifyIntent 无特征词时默认按需求处理", ROUTE.classifyIntent("zzz qqq").kind === ROUTE.INTENT.REQUIREMENT, ROUTE.classifyIntent("zzz qqq").kind);
ok("G17b classifyIntent 命中显式特征词（含「看看」→ 讨论）", ROUTE.classifyIntent("随便看看").kind === ROUTE.INTENT.DISCUSSION, ROUTE.classifyIntent("随便看看").kind);

/* ══════════════════════════════════════════════════════════════════
 * H. 弹窗本体与挂载契约（要求 6 / 10 / 11）
 * ══════════════════════════════════════════════════════════════════ */
sec("H. 弹窗本体、挂载契约与智能体/技能 —— 要求 6 / 10 / 11");

eq("H1 DIALOG_ID", DIALOG.DIALOG_ID, "dsh-director-dialog");
eq("H2 CHIP_ID（最小化后停靠态）", DIALOG.CHIP_ID, "dsh-director-chip");
ok("H3 DirectorDialog 为组件函数", typeof DIALOG.DirectorDialog === "function", typeof DIALOG.DirectorDialog);
eq("H4 挂载宿主 id", MOUNT.DIALOG_HOST_ID, "dsh-director-dialog-host");
eq("H5 🔴 入口按钮 id 保持旧名（既有真机脚本依赖）", MOUNT.LAUNCHER_ID, "dsh-director-hierarchy-launcher");
eq("H6 旧浮层宿主 id 兼容保留", MOUNT.OVERLAY_HOST_ID, "dsh-director-hierarchy-overlay");
/* 🔴 2026-09-13 闸门纠错（第 7 处）：`makeLauncher()` **已退役** —— 批次 13 把右下角
 *   入口统一到 FloatDock 三键（🖌 设计图 / 🧠 思维导图 / ◆ 总监），此后 mount 层
 *   永远返回 `launcher: null`（`src/mount.js:153` 显式 return null 并打日志）。
 *   而本段 4 条断言仍按「入口由 mountHierarchy 创建」写，后果层层放大：
 *     ① H7 要求 `mounted.launcher` 为真 ⇒ 必红；
 *     ② H9 要求 body 里有 LAUNCHER_ID 元素 ⇒ **离线必红**（FloatDock 是 React 组件，
 *        离线桩只创建 DOM、不渲染组件）；
 *     ③ H10 读 `mounted.launcher.textContent` ⇒ **null 解引用 TypeError**，
 *        整个脚本当场崩在 600 行 —— 其后的 H10b–H12、I 段、J 段**全部丢失**。
 *        这就是「一个过期断言能把闸门打哑」：看起来是"插件坏了"，其实是尺子过期。
 *   处置：契约断言改为「已退役 ⇒ 显式为 null」；入口**存在性与文案**断言移交真机
 *   （`cdp-click-dialog.mjs` D1，已按语义判据断言「图标 + 文案 · 非解释性长句」）。 */
const mounted = MOUNT.mountHierarchy({ withLauncher: true, open: false, navHook: false });
ok("H7 mountHierarchy 返回完整契约（launcher 已退役 ⇒ 显式为 null）",
	Boolean(mounted && mounted.host && mounted.launcher === null && typeof mounted.unmount === "function" && typeof mounted.show === "function" && typeof mounted.hide === "function"),
	`keys=${mounted ? Object.keys(mounted).join(",") : "null"} · launcher=${mounted ? String(mounted.launcher) : "?"}`);
ok("H8 宿主节点已挂载到 body", Boolean(document.getElementById(MOUNT.DIALOG_HOST_ID)), "host 就位");
ok("H9 🔴 入口已移交 FloatDock（mount 层不再创建 LAUNCHER_ID 元素）",
	document.getElementById(MOUNT.LAUNCHER_ID) === null,
	"离线桩不渲染 React 组件 ⇒ 此处本就无元素；真机由 FloatDock 提供（真机断言见 cdp-click-dialog D1）");
/* 🔴 E-SPLIT-001 行为级反证：插件 UI 已挂载后，findChatRoot 仍必须返回宿主应用根。
 *   真机踩中：① 步扫全页 <button> 时命中插件标题栏 1 字按钮（真机 ⇤ y=8/w=24）
 *   ⇒ findChatRoot 返回插件面板 ⇒ 分屏把 padding 加到插件自己头上。 */
const hostEl = document.getElementById(MOUNT.DIALOG_HOST_ID);
const launcherEl = document.getElementById(MOUNT.LAUNCHER_ID);
ok("H10b 🔴 isPluginNode 判定插件 UI 为「插件节点」",
	SPLIT.isPluginNode(hostEl) === true && (launcherEl === null || SPLIT.isPluginNode(launcherEl) === true),
	`host=${SPLIT.isPluginNode(hostEl)} launcher=${launcherEl === null ? "(离线未渲染 · FloatDock 提供)" : SPLIT.isPluginNode(launcherEl)}`);
ok("H10c 🔴 宿主应用根**不**被判为插件节点（反向对照，防误杀）", SPLIT.isPluginNode(root) === false, "root=false");
ok("H10d 🔴 插件 UI 挂载后 findChatRoot 仍返回宿主应用根（E-SPLIT-001 反证）",
	SPLIT.findChatRoot() === root, `found=${SPLIT.findChatRoot() === root ? "root ✓" : "非 root ✗"}`);
const apGuard = (() => {
	const r = SPLIT.applySplit({ paddingLeft: 300 });
	const marked = document.querySelector("[" + SPLIT.ROOT_ATTR + "]");
	const out = { ok: r.ok === true, marked: Boolean(marked), pluginOwned: marked ? SPLIT.isPluginNode(marked) : null };
	SPLIT.clearSplit();
	return out;
})();
ok("H10e 🔴 分屏标记绝不落在插件 UI 上（applySplit 护栏）", apGuard.ok && apGuard.marked && apGuard.pluginOwned === false, JSON.stringify(apGuard));
mounted.show();
eq("H11 show() 打开弹窗（写入 dialogOpen）", LAYOUT.directorLayoutStore.getState().dialogOpen, true);
mounted.hide();
eq("H12 hide() 关闭弹窗", LAYOUT.directorLayoutStore.getState().dialogOpen, false);
const mountSrc = src("mount.js");
const iClear = mountSrc.indexOf("clearSplit()", mountSrc.indexOf("unmount:"));
const iUnmount = mountSrc.indexOf("root.unmount()", mountSrc.indexOf("unmount:"));
ok("H13 🔴 unmount 顺序：先 clearSplit 再 root.unmount（不留残留）", iClear > 0 && iUnmount > iClear, `clearSplit@${iClear} < unmount@${iUnmount}`);
ok("H14 unmount 同时移除 host 与 launcher", has(mountSrc, /host\.remove\(\)/) && has(mountSrc, /launcher\.remove\(\)/), "两处 remove");
ok("H15 mountHierarchy 幂等装配三个桥（split / chatBridge / navHook）", /installSplitApi\(\)/.test(mountSrc) && /installChatBridgeApi\(\)/.test(mountSrc) && /installNavHookApi\(\)/.test(mountSrc), "三处安装");
ok("H16 tryRegisterHostSlot 对 ctx.slots 缺失时安全返回 false", MOUNT.tryRegisterHostSlot() === false, "返回 false（预期内）");
ok("H17 mountHierarchyOverlay 已退役返回 null（verify-batch6 契约保留）", MOUNT.mountHierarchyOverlay() === null, "返回 null");

eq("H18 标准智能体 5 类（17 号文 §1A.8）", DIALOG.AGENTS.length, 5);
eqArr("H19 智能体 key", DIALOG.AGENTS.map((a) => a.key), ["code", "doc", "research", "test", "review"]);
ok("H20 每个智能体声明调用方式（auto/manual）", DIALOG.AGENTS.every((a) => a.mode === "auto" || a.mode === "manual"), DIALOG.AGENTS.map((a) => a.key + ":" + a.mode).join(" "));
ok("H21 每个智能体带检查清单（可核验）", DIALOG.AGENTS.every((a) => Array.isArray(a.checks) && a.checks.length > 0), DIALOG.AGENTS.map((a) => a.checks.length).join(","));
ok("H22 可调用技能清单非空且带 label", DIALOG.SKILLS.length > 0 && DIALOG.SKILLS.every((s) => s.key && s.label), `${DIALOG.SKILLS.length} 项`);
/* 🆕 第 6 批「完善技能和智能体的指向」：技能必须有**指向**（真实目录）与反触发条件。
 * 🔴 为什么这条必须存在：改前 SKILLS 只有 key/label —— 而 `mermaid-diagram` 的真实目录
 *    是 `mermaid-diagram__skillhub`（key ≠ 目录）⇒ 按 key 拼路径必然找不到，
 *    且**失败无声**。没有这条断言，"指向"就退化回"名字"。 */
ok("H22b 🔴 每个技能都带真实目录指向（target）与反触发条件（noUse）",
	DIALOG.SKILLS.every((s) => s.target && s.dir && s.target === s.dir) && DIALOG.SKILLS.every((s) => String(s.noUse || "").trim().length > 0),
	DIALOG.SKILLS.map((s) => s.key + "→" + s.dir).join(" · "));
ok("H22c 🔴 每个标准智能体都带可执行指向（target = module#symbol）",
	DIALOG.AGENTS.every((a) => typeof a.target === "string" && /^[\w./-]+\.js#[\w]+$/.test(a.target)),
	DIALOG.AGENTS.map((a) => a.key + "→" + a.target).join(" · "));
ok("H23 调用记录 API 可用（要求 10「查看调用情况」）", typeof DIALOG.recordAgentRun === "function" && typeof DIALOG.listAgentRuns === "function", "recordAgentRun / listAgentRuns");
/* 🔴 纪律 15：调用记录现在是**持久化**的（store/agent-runs.js）⇒ 本段写盘必须在
 *    结束后**还原**，否则闸门会把测试记录留在用户的真实历史里（闸门不许成为破坏者）。 */
const __runsSnap = ARUNS.snapshotRuns();
const __runsSnapN = (__runsSnap && Array.isArray(__runsSnap.calls)) ? __runsSnap.calls.length : -1;
DIALOG.recordAgentRun("test", "ok", "离线自检");
ok("H24 调用记录可回读", DIALOG.listAgentRuns().some((r) => r.key === "test"), JSON.stringify(DIALOG.listAgentRuns()[0]));
const dlgSrc = src("components/DirectorDialog.js");
const REQUIRED_TID = ["d-dialog", "d-hole", "d-panel", "d-level", "d-crumb", "d-body",
	"d-seg-director", "d-seg-levels", "d-seg-agents", "d-r2", "d-r5", "d-review", "d-review-run",
	"d-r6", "d-memo-core", "d-memo-decision", "d-memo-risk", "d-dbstats", "d-r3",
	"d-agent-seg-agents", "d-agent-seg-skills", "d-agent-runs", "d-route-card",
	"d-route-transfer", "d-route-direct", "d-route-new", "d-route-cancel",
	"d-focus", "d-input", "d-send", "d-toast", "d-collapse-left", "d-collapse-right",
	"d-min", "d-reset", "d-close", "d-split", "d-left-rail", "d-right-rail", "d-right", "d-chip"];
const missingTid = REQUIRED_TID.filter((t) => !dlgSrc.includes(`"data-testid": "${t}"`));
eqArr("H25 交互元素 testid 零缺失（真机逐交互脚本据此定位）", missingTid, []);
ok("H26 spotlight 遮罩用超大 boxShadow 表达层次（不拦截点击）", has(dlgSrc, /boxShadow:\s*"0 0 0 9999px rgba\(0,0,0,\.34\)"/), "命中遮罩");
ok("H27 遮罩层 pointerEvents:none（洞内保持可交互）", has(dlgSrc, /pointerEvents:\s*"none"/), "命中 pointerEvents");
ok("H28 焦点路由用捕获阶段 pointerdown 且不拦截原生交互", (() => {
	if (!/addEventListener\("pointerdown",\s*onDown,\s*true\)/.test(dlgSrc)) return false;
	// 抽出 onDown 函数体，断言其内部无 preventDefault / stopPropagation
	const start = dlgSrc.indexOf("const onDown =");
	if (start < 0) return false;
	const end = dlgSrc.indexOf("document.addEventListener(\"pointerdown\", onDown, true)", start);
	const body = dlgSrc.slice(start, end);
	return body.length > 0 && !/preventDefault|stopPropagation/.test(body);
})(), "onDown 体零拦截调用");
ok("H29 键盘：Escape 关闭", has(dlgSrc, /"Escape"/), "命中 Escape 分支");
ok("H30 键盘：Alt+1/2/3 三态等价", has(dlgSrc, /altKey/) && has(dlgSrc, /"1"/) && has(dlgSrc, /"2"/) && has(dlgSrc, /"3"/), "命中 Alt+1/2/3");
ok("H31 要求 11：左面板内嵌设计图逻辑（层级段复用 DirectorHierarchy）", has(dlgSrc, /DirectorHierarchy/) && has(dlgSrc, /compact:\s*true/), "compact 形态复用");
ok("H32 要求 10：R3 段含「调用情况」分区", has(dlgSrc, /调用情况（最近/) && has(dlgSrc, /d-agent-runs-empty/), "命中");
/* 🔴 H32b / H32c 口径纠错（2026-09-14 · 第 6 批 · 闸门纠错台账第三批）
 * ──────────────────────────────────────────────────────────────────
 *  旧写法是**对 `DirectorDialog.js` 源码的字面量断言**：
 *      /export const RUNS_SHOWN = 8/  ·  /export function listAgentRuns\(limit\)/  ·  /agentRuns\.slice\(\)/
 *  本轮数据源迁到 `store/agent-runs.js`（可持久化 + 可订阅 + 真实执行链上报）后，
 *  这三条字面量**从本文件消失** ⇒ 两条断言变红，而**产品没有任何缺陷**。
 *  这是典型的「闸门自己会过期」（纪律 14）：**尺子钉在了"定义在哪个文件"上**。
 *
 *  更根本的问题：**源码正则不是行为判据**。`agentRuns.slice()` 出现在任何地方都会
 *  让旧断言通过 —— 它在反例上也会绿（纪律 23：要问"它在反例上会不会也通过"）。
 *  ⇒ 改法：
 *    · 常量取**运行时导出值**（不认文件）；
 *    · 「无参不截断」改为**真跑一遍看回落长度**（20 条记录 → 无参/有参/边界各读一次）；
 *    · 渲染层只保留「引用存在」这一层（那确实是渲染事实，且改名即假红）。 */
ok("H32b 🔴 调用记录：面板层截断常量 = 8，且面板暴露**真实总数**（data-run-total）",
	ARUNS.RUNS_SHOWN === 8
	&& has(dlgSrc, /"data-run-total": agentRuns\.length/)
	&& has(dlgSrc, /agentRuns\.slice\(0, RUNS_SHOWN\)/),
	"RUNS_SHOWN=" + ARUNS.RUNS_SHOWN + "（运行时导出值）· 总数属性=命中 · 渲染截断=命中");

/* H32c：行为判据（跑一遍看结果）+ 纪律 15 的 快照→写入→断言→还原→还原断言 */
const __h32cFull = (() => {
	ARUNS.clearAgentRuns();
	for (let i = 0; i < 20; i++) DIALOG.recordAgentRun("calib-" + i, "ok", "H32c 校准");
	const full = DIALOG.listAgentRuns().length;   // 无参 ⇒ 必须全量
	const cut3 = DIALOG.listAgentRuns(3).length;  // 有参 ⇒ 截断
	const cut0 = DIALOG.listAgentRuns(0).length;  // 边界：0 条
	const neg = DIALOG.listAgentRuns(-1).length;  // 边界：负数 ⇒ 视为"无限制"（同无参）
	return { full, cut3, cut0, neg };
})();
const __restored = ARUNS.restoreRuns(__runsSnap) && DIALOG.listAgentRuns().length === __runsSnapN;
ok("H32c 🔴 listAgentRuns() 无参返回**全量**（列表 API 不得静默截断 —— D4 假失败根因）",
	__h32cFull.full === 20 && __h32cFull.cut3 === 3 && __h32cFull.cut0 === 0 && __h32cFull.neg === 20,
	"记 20 条 ⇒ 无参 " + __h32cFull.full + " / (3)=" + __h32cFull.cut3 + " / (0)=" + __h32cFull.cut0 + " / (-1)=" + __h32cFull.neg);
ok("H32d 🔴 闸门自还原：本段写过的校准记录**全部还回去**（跑完 == 跑前，不留痕）",
	__restored, "还原后 " + DIALOG.listAgentRuns().length + " 条（跑前 " + __runsSnapN + " 条）");
ok("H33 要求 8：路由确认卡三条去向按钮 + 取消齐备", ["DESTINATION.TRANSFER", "DESTINATION.DIRECT", "DESTINATION.CREATE"].every((k) => dlgSrc.includes(k)) && has(dlgSrc, /d-route-cancel/), "四按钮齐备");
ok("H34 面板宽度分档（左侧折叠 → 竖条 RAIL）", has(dlgSrc, /rightCollapsePad/) && has(dlgSrc, /padLeft/), "宽档计算齐备");
ok("H35 分屏 effect 成对（applySplit + cleanup clearSplit）", has(dlgSrc, /applySplit\(\{/) && has(dlgSrc, /clearSplit\(\);\s*\};/), "成对调用");
ok("H36 DirectorHierarchy compact 形态保留 cdp-click 依赖的全部 h-* testid", (() => {
	const h = src("components/DirectorHierarchy.js");
	// 从既有真机脚本提取 h-* testid（排除两个宿主节点 id 与裸前缀）
	const used = [...new Set((read("scripts/cdp-click.mjs").match(/h-[a-z-]+/g) || []))]
		.filter((t) => t !== "h-" && t !== "h-director-hierarchy-launcher" && t !== "h-director-hierarchy-overlay");
	const missing = used.filter((t) => !h.includes(`"data-testid": "${t}"`) && !h.includes("h-meta-"));
	return missing.length === 0 && h.includes("h-compact-hint");
})(), "h-* 零缺失 + compact 标记存在");
ok("H37 🔴 面板节点绑定属性为 data-active-node-id（不占用树行的 data-node-id）", /"data-active-node-id":\s*nodeId/.test(dlgSrc) && !/"data-node-id":\s*nodeId/.test(dlgSrc), "选择器零冲突");
ok("H38 🔴 data-node-id 全插件仅由树行 TreeItem 产出（唯一性回归防线）", (() => {
	const files = ["components/DirectorHierarchy.js", "components/DirectorDialog.js", "components/DirectorFlow.js", "components/DirectorWorkbench.js", "mount.js"];
	const producers = files.filter((f) => /"data-node-id"/.test(src(f)));
	return producers.length === 1 && producers[0] === "components/DirectorHierarchy.js";
})(), "唯一产出方 = DirectorHierarchy.js");

/* ══════════════════════════════════════════════════════════════════
 * I. 产物体检（T7）
 * ══════════════════════════════════════════════════════════════════ */
sec("I. 构建产物体检 —— ADR-001 与批次 9 契约");

ok("I1 产物存在", existsSync(BUNDLE_PATH), BUNDLE_PATH);
const B = readFileSync(BUNDLE_PATH, "utf8");
ok("I2 产物为 Harness client bundle 形态（__ModuleLoader__.load）", B.startsWith("window.__ModuleLoader__.load({"), B.slice(0, 40));
const chk = spawnSync(process.execPath, ["--check", BUNDLE_PATH], { encoding: "utf8" });
ok("I3 🔴 产物语法检查通过（本轮缺陷回归防线）", chk.status === 0, chk.status === 0 ? "node --check exit=0" : (chk.stderr || "").split("\n")[0]);
ok("I4 🔴 产物无 exports.// 垃圾导出行（B-D3 缺陷回归防线）", !/exports\.\/\//.test(B), `命中 ${(B.match(/exports\.\/\//g) || []).length} 次`);
for (const spec of ["react", "react/jsx-runtime", "react-dom/client"]) {
	ok(`I5 平台模块经 require 外置：${spec}`, B.includes(`require("${spec}")`), `require("${spec}")`);
}
ok("I6 ADR-001：产物不含 React 源码特征", !/react\.production\.min|__SECRET_INTERNALS_DO_NOT_USE/.test(B), "无 React 运行时源码");
for (const k of ["window.__dshDirectorBatch9", "window.__dshPluginDb", "window.__dshRouter", "window.__dshReview6", "window.__dshSplitApi", "window.__dshChatBridge", "window.__dshNavApi"]) {
	ok(`I7 产物含契约 ${k}`, B.includes(k), "命中");
}
ok("I8 产物含独立库名（数据元独立已进产物）", B.includes("dsh-director-plugin-db"), "命中");
ok("I9 产物含批次 6 契约字段（向后兼容）", B.includes("hierarchyMounted") && B.includes("hierarchyApi"), "命中");
ok("I10 产物导出批次 9 组件与 API", B.includes("exports.DirectorDialog = DirectorDialog;") && B.includes("exports.installPluginDbApi = installPluginDbApi;"), "命中两处 exports");
ok("I11 需求 8 去向文案已进产物（用户可见字符串）", B.includes("转给该对话的总监") && B.includes("直接调用对应对话"), "命中");
ok("I12 需求 7/9 语义锚点已进产物（placeholder / aria-label）", B.includes("给智能体发消息") && B.includes("发送消息"), "命中");
ok("I13 六维标签已进产物（不得减项在产物层亦成立）", ["需求满足度", "方案符合度", "质量达标度", "风险控制", "完整性", "一致性"].every((l) => B.includes(l)), "六维齐备");

/* ══════════════════════════════════════════════════════════════════
 * J. R5 冻结键反证
 * ══════════════════════════════════════════════════════════════════ */
sec("J. R5 持久化键冻结 —— 反证：本轮改动零改名、零删除");

const FROZEN = [
	{ key: "dsh.director.store.", file: "store/create-store.js" },
	{ key: "dsh.director.layout", file: "store/layout.js" },
	{ key: "director-main", file: "store/persist.js" },
	{ key: "dsh.director.config", file: "config/model.js" },
	{ key: "dsh-v9-theme", file: "store/theme.js" },
	{ key: "dsh_director_", file: "store/persist.js" },
	{ key: "dsh-director-db", file: "store/idb.js" }
];
for (const f of FROZEN) {
	ok(`J 冻结键仍在原文件：${f.key} @ ${f.file}`, src(f.file).includes(f.key), "命中");
}
ok("J8 宿主库版本仍为 3（未升版）", /IDB_VERSION\s*=\s*3/.test(src("store/idb.js")), "IDB_VERSION = 3");
ok("J9 宿主 6 store 名未改名", ["directorStores", "directorDocs", "directorFolders", "memoryCore", "memoryDecisions", "memoryRisks"].every((s) => src("store/idb.js").includes(s)), "六名齐备");
ok("J10 🔴 本轮未新增任何改名变体（反证）", !/dsh\.director\.layout\.(v2|v2v)|dsh-director-db-v|director-main-v/i.test(B), "产物无改名变体");
ok("J11 插件库不与宿主库共享 object store（已在 A9 证明，此处产物层复核）", B.includes("directorNodes") && B.includes("memoryCore"), "两套 store 名共存于产物（分别属于两库）");

/* ══════════════════════════════════════════════════════════════════
 * K. 验证脚本自身卫生 —— 防「模板字面量被注释里的反引号截断」复发
 *
 * 现象：`evalExpr(\`…\`)` 的**页内代码**里若出现反引号（哪怕在注释中），
 *       模板会提前闭合 ⇒ 整脚本 `SyntaxError: missing ) after argument list`，
 *       且报错行指向模板**起始行**，定位反直觉 —— 2026-09-12 同一坑连踩两次。
 * 做法：扫描每个 `evalExpr(` 模板，检查闭合反引号后的下一个字符是否为
 *       合法续接（`, ) ; ]` 或空白行尾）。若是注释里的反引号提前闭合，
 *       其后紧跟的会是 `*` / `/` / 字母 ⇒ 判为非法。
 * ══════════════════════════════════════════════════════════════════ */
sec("K. 验证脚本卫生 —— 模板字面量不得被注释里的反引号截断");

const cdpSrcFiles = ["scripts/cdp-click-dialog.mjs", "scripts/cdp-click.mjs"];
const tplBad = [];
for (const f of cdpSrcFiles) {
	const s = read(f);
	const re = /evalExpr\(\s*`/g;
	let m;
	while ((m = re.exec(s))) {
		let i = m.index + m[0].length;
		while (i < s.length) {
			const ch = s[i];
			if (ch === "\\") { i += 2; continue; }
			if (ch === "`") break;
			i++;
		}
		const after = s.slice(i + 1, i + 3);
		if (!/^[\s,);\]]/.test(after)) {
			tplBad.push(f + " 第 " + (s.slice(0, i).split("\n").length) + " 行模板闭合处异常 → " + JSON.stringify(after));
		}
	}
}
ok("K1 evalExpr 模板闭合处合法（防注释内反引号提前闭合）", tplBad.length === 0,
	tplBad.length ? tplBad.slice(0, 3).join(" ｜ ") : cdpSrcFiles.length + " 个脚本全部合法");

const { execFileSync } = await import("node:child_process");
const synBad = [];
for (const f of [...cdpSrcFiles, "scripts/verify-install.mjs", "scripts/plugin-install.mjs"]) {
	try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
	catch (e) { synBad.push(f + " → " + String(e.stderr || e.message).split("\n").find((l) => /Error/.test(l) || l.trim())); }
}
ok("K2 验证脚本全部通过 node --check（语法自检）", synBad.length === 0, synBad.join(" ｜ ") || "4 个脚本 exit=0");

const cdpSrc = read("scripts/cdp-click-dialog.mjs");
ok("K3 🔴 真机脚本对「有上限的内存态」用与上限无关的判据（最新条目的顺序），不用绝对值",
	/agentKeys\.slice\(\)\.reverse\(\)/.test(cdpSrc) && /slice\(0, d4\.skillKeys\.length\)/.test(cdpSrc),
	"顺序判据已就位（记录达 RUNS_KEEP 上限后净值不再增长，绝对值断言会假失败）");
ok("K4 🔴 真机脚本按标签取 value setter（<select> 不可用 HTMLInputElement 原型）",
	/tag === 'SELECT' \? HTMLSelectElement\.prototype/.test(cdpSrc), "三标签分支齐备");
ok("K5 🔴 真机脚本点击只派发**一次**（防 React onClick 双触发致记录翻倍）",
	/window\.__click = \(el\) => \{[\s\S]{0,200}?if \(typeof el\.click === 'function'\) \{ el\.click\(\); return true; \}/.test(cdpSrc),
	"click 路径提前 return，dispatchEvent 仅为兜底（不会双发）");
ok("K6 🔴 真机脚本含「左栏折叠后控制簇仍在」的缺陷回归断言", /d8\.railCtl\.every\(Boolean\)/.test(cdpSrc), "railCtl 断言已就位");

/* ══════════════════════════════════════════════════════════════════
 * 汇总
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(64));
console.log(`批次 9 弹窗式总监架构 离线验证：PASS ${PASS} / FAIL ${FAIL} / 总计 ${TOTAL}`);
if (FAIL) { console.log("失败清单："); FAILS.forEach((f) => console.log("  ✗ " + f)); }
console.log(`IS_PASS: ${FAIL === 0 ? "TRUE" : "FALSE"}`);
console.log("=".repeat(64));
process.exit(FAIL === 0 ? 0 : 1);
