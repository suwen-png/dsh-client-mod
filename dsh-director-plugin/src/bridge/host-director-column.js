/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：对话页**宿主左栏（总监列）**的几何接管 + 记忆面板时序
 * 引用：—
 * 上游：client-entry.js
 * 下游：store/layout.js, util/dom-style.js, bridge/host-panel-trim.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * bridge/host-director-column.js — 对话页**宿主左栏（总监列）**的几何接管 + 记忆面板时序
 *
 * ══════════════════════════════════════════════════════════════════
 *  需求来源（第 6 批，2026-09-14）
 * ══════════════════════════════════════════════════════════════════
 *  需求 1（用户原话）：
 *    「对话的 tap 页面 [图1] 总监和下面哪一个 - 这两列不要,
 *      在 [图2] 现在总监列的最右侧增加最小化, 左右的宽度要允许调整,
 *      [图3] 最小化这个空白还是存在的, 最小化之后旁边的对话要占满」
 *  需求 2（用户原话 · 三条澄清之一）：
 *    「增加一个秒数, 目前太灵敏了 …把这边部分逻辑完善掉, 这个固定也不好用需要修正,
 *      还要可以上下调整高度」
 *
 * ── 🔴 为什么必须走「DOM 几何接管」而不是改宿主 store ────────────────
 *   实测三连（脚本留在 `scripts/` 下，可复跑）：
 *     ① `_probe-panel-geometry.mjs`：把 `window.__directorLayoutStore` 的
 *        `directorPanelCollapsed` 从 false 翻到 true ⇒ 宿主左栏**纹丝不动**
 *        （仍 `w=301` / inline `width:300px; min-width:180px`）。
 *     ② `_probe-store-identity.mjs`：`window.__directorLayoutStore` 上是**插件**那份 store
 *        （含 `railPinned/todoNotes/activeTasks` 等插件独有字段 + 插件独有方法）。
 *     ③ 读宿主源码 `workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`：
 *        · 6442 起 `createDirectorLayoutStore()`，6478 把**它自己**那份写到
 *          `window.__directorLayoutStore`（被插件 `src/store/layout.js:478` 后加载覆盖）；
 *        · 6479 `useDirectorLayoutStore()` 是**模块内闭包** —— 订阅的是宿主自己那份，
 *          **从不读 window**。
 *     ⇒ 结论：插件**够不到**宿主左栏的 store。翻全局 store 是"看起来在改，其实零效果"。
 *
 * ── 宿主左栏自身的两个缺陷（也是 [图3] 的直接成因）──────────────────
 *   ⚠️ 折叠分支（client.js:7321）渲染的占位条**仍用 `width: layout.directorPanelWidth`**
 *      （=300）⇒ 即便真折叠了，那 300px 的**空白照样在**。用户 [图3] 说的就是这个。
 *   ⚠️ 拖拽手柄（client.js:7298 `onDirectorResizerMouseDown`）调宿主
 *      `setDirectorWidth`，而它 clamp 到 **[180, 600]**（6465）⇒ **永远回不到 0**。
 *
 * ── 本模块的做法（三层，均可逆）──────────────────────────────────
 *   L1 **几何接管**：`directorPanelCollapsed` / `directorPanelWidth` 由**插件 store** 当
 *      唯一真相源（复用既有冻结键，不新开 —— R5）。store 变 ⇒ 直接把几何落到宿主列的
 *      inline style 上：折叠 = `display:none` + `width/minWidth:0` + `flex:0 0 0`；
 *      展开 = 按 store 宽度还原。**动之前先读原值**，`restore()` 能逐字还回去（纪律 26）。
 *   L2 **插件侧控件**：宿主列的最右侧注入一枚**最小化按钮** + 一条**宽度拖拽条**
 *      （摆脱 180–600 的 clamp）。宿主自带手柄被隐藏 ⇒ 宽度只留**一处真相源**。
 *   L3 **记忆面板时序接管**：宿主 `onMouseEnter` 是**零延迟**展开（7357）⇒ 鼠标扫过就弹。
 *      本模块在 `document` 捕获相拦下**进入/离开该块**的 `mouseover/mouseout`，
 *      改由可配秒数驱动，并**调用宿主自己的 `onMouseEnter/onMouseLeave`** 去开合
 *      （不重写开合逻辑 ⇒ 不制造第二份真相）。
 *
 * ── 🔴 为什么记忆面板必须在 `document` 上捕获拦，而不是在块上拦 ────────
 *   React 18 用 `registerTwoPhaseEvent` 把**捕获相**监听也挂在 root 容器上
 *   ⇒ 在块上做 capture 拦，root 的 capture 已经先跑过（React 已合成 onMouseEnter）；
 *      在块上做 bubble 拦，事件的 bubble 到达块时 root 的 capture 同样早跑过了。
 *   只有在 `document`（root 容器的**祖先**）上做 capture，才能保证**先于 React**。
 *
 *   🔴 两条**踩过才写**的补充（2026-09-14，本模块同一个坑踩了两次）：
 *     ① **「先判后拦」等于没拦**：旧写法把「区内→区内不算进入」的 `early-return` 放在
 *        `stopPropagation()` 之前 ⇒ 这些事件继续传播到 root，React 自己合成 `onMouseEnter`
 *        ⇒ 宿主立刻展开，可配延迟被完全旁路。取证 `scripts/_probe-evtypes.mjs`：
 *        进入一次就发现 `document` **冒泡相**仍收到 `mouseover`（拦截生效的话它到不了冒泡相）。
 *     ② **`mouseover` 拦不住 `mouseenter`**：二者是**两次独立派发**（后者不冒泡，进入链上每层各一次）。
 *        实测一次进入 `cap.mouseenter=14 / cap.mouseleave=10` ⇒ 对落在记忆区的 enter/leave
 *        也一并拦死。
 *   代价：被拦下的那几次事件别的组件看不到 —— 只在"目标落在记忆区"时拦，
 *   影响面可枚举（闸门 `verify-v22` 的 F 段对此有正负对照）。
 *
 * ── 护栏与铁律 ───────────────────────────────────────────────────
 *   · **绝不抛**：本模块在 `installBatch1` 执行链上，抛一次会让其后几十项能力全丢
 *     （纪律 C）。所有 DOM 操作各自 try/catch，失败写进 `hostColumnState.reason`（纪律 19）。
 *   · 注入的节点一律带 `data-dsh-plugin` **且** `data-testid="dp-*"`
 *     ⇒ 被 `host-panel-trim.js` 的 `PLUGIN_GUARD_SELECTOR` 护住，不会被自己人裁掉。
 *   · 宿主列会被打上 `data-dsh-host-col` —— 因为折叠后它**不再匹配**
 *     `[style*="min-width: 180px"]`，只靠选择器找会在折叠态**找不回自己**。
 *
 * 诊断：`window.__dshHostDirectorColumn`（调试与验证脚本用）
 */

import { directorLayoutStore } from "../store/layout.js";
import { pxOf } from "../util/dom-style.js";
import { PLUGIN_GUARD_SELECTOR, resolvePanelRoot } from "./host-panel-trim.js";

/* ══════════════════════════════════════════════════════════════════
 *  常量
 * ══════════════════════════════════════════════════════════════════ */

/** 宿主列被我方接管后打的标记（既是"这是我的责任区"，也是折叠后唯一能找到它的凭据） */
export const COL_MARK = "data-dsh-host-col";
/** 宿主行的 inline style 备份属性（我们给它加 `position:relative` 才能绝对定位控件） */
const ROW_MARK = "data-dsh-host-row-prev";
/** 几何原值备份属性（逐个 CSS 属性记账，还原时逐字写回 —— 纪律 26） */
const GEOM_MARK = "data-dsh-col-prev-geom";
/** 记忆块"已绑定监听"标记（防重复绑定；宿主重挂载后新节点没有它 ⇒ 会重新绑） */
const MEM_BOUND = "data-dsh-mem-bound";

export const MIN_BTN_ID = "dsh-host-col-min";
export const COL_RESIZER_ID = "dsh-host-col-resizer";
export const MEM_BAR_ID = "dsh-mem-bar";
export const MEM_HEIGHT_HANDLE_ID = "dsh-mem-height";

/** 我们托管的 CSS 属性清单（备份/还原**严格按这张表**走，不多不少） */
const GEOM_KEYS = Object.freeze(["width", "minWidth", "flex", "borderRight", "display", "overflow"]);
/** 行需要托管的属性（只为让绝对定位的子节点有参照物） */
const ROW_KEYS = Object.freeze(["position"]);

/** 宽度拖拽的自由区间（**不复用**宿主的 [180,600] —— 那正是"回不到 0"的根因） */
export const COL_WIDTH_MIN = 0;
export function colWidthMax(rowWidth) {
	const w = Number(rowWidth);
	if (!Number.isFinite(w) || w <= 0) return 560;
	/* 给右侧对话区至少留 320px，否则"最小化让对话占满"就无从谈起 */
	return Math.max(160, Math.min(720, Math.round(w) - 320));
}

/** 诊断状态（供断言读；不编 —— 只有真的做了才计数） */
export const hostColumnState = {
	/** 是否处于最小化（= 插件 store 的 directorPanelCollapsed） */
	minimized: false,
	/** 几何落地次数 / 还原次数（幂等性判据：无变化不该累加） */
	geomApplied: 0, geomRestored: 0,
	/** 最小化按钮 / 拖拽条 / 记忆工具条 / 高度手柄 是否已注入 */
	minBtn: false, resizer: false, memBar: false, memHeight: false,
	/** 宿主自带拖拽手柄是否被我们藏起来（缺口："藏"必须能还） */
	hostHandleHidden: false,
	/** 记忆面板：延迟开关次数 / 被拦下的 mouseover、mouseout 次数 / 锁定语义修正次数 */
	memOpen: 0, memClose: 0, memOverBlocked: 0, memOutBlocked: 0, memEnterBlocked: 0, memLockFix: 0,
	/** 生效中的延迟（毫秒） */
	hoverDelayMs: 0,
	/** 记忆内容区被我们覆盖的高度（px；null = 没接管） */
	memHeight: null,
	/** 观察到的宿主重挂载次数（列被重建 ⇒ 控件要重注入） */
	remounts: 0,
	/** observer 回调次数 / 快路径跳过次数 */
	scans: 0, skipped: 0,
	observer: false,
	/** 降级原因（null = 一切正常）。**降级可以，无声不行**（纪律 19） */
	reason: null, degraded: false
};

/** 把降级原因记下来（可见、可断言），而不是静默 return */
function degrade(reason) {
	hostColumnState.degraded = true;
	hostColumnState.reason = String(reason);
	return false;
}

/** 宿主列的缓存引用（廉价判据用；`isConnected=false` 时自动失效） */
let colRef = null;


/** 清掉降级态（成功一次就应恢复"正常"，否则一次偶发会永久污染后续断言） */
function heal() { hostColumnState.degraded = false; hostColumnState.reason = null; }

const hasDom = () => typeof window !== "undefined" && typeof document !== "undefined"
	&& typeof document.querySelector === "function";
const hasEl = () => hasDom() && typeof document.createElement === "function";

/* ══════════════════════════════════════════════════════════════════
 *  查找（三个目标 + 一个通道）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 宿主左栏（总监列）。
 * 🔴 先认标记、再认选择器：折叠后我方已把 `min-width` 改成 0px，
 *    元素**不再匹配** `[style*="min-width: 180px"]` —— 只靠选择器会在折叠态**找不到自己**，
 *    于是"展开"这个动作永远执行不到（表现：最小化之后再也回不来）。
 */
export function findHostDirectorColumn() {
	if (!hasDom()) return null;
	try {
		/* 缓存优先：`getElementById` 级代价，避免每次 sync 都跑属性子串选择器 */
		if (colRef && colRef.isConnected) return colRef;
		colRef = null;
		const marked = document.querySelector("[" + COL_MARK + "]");
		if (marked && marked.isConnected) { colRef = marked; return marked; }
		/* 🔴 2026-09-14：改用 **`host-panel-trim` 的解析器**，不再自己写一遍
		 *    `[style*="min-width: 180px"]`。原因（本模块自己就是肇事者）：
		 *    展开分支在下面**显式**把宿主列的 `minWidth` 写成 `0px` 好让宽度能拖到 180 以下，
		 *    而 `host-panel-trim` 的护栏当时正是靠这个字符串 ⇒ 列几何一落地，
		 *    对方的文本类护栏就**恒 false、静默不再裁剪**（用户要求删的宿主残留又露出来了）。
		 *    两个模块各自写一份"看起来一样"的选择器 = 纪律 27「看起来相等 ≠ 同源」的教科书案例。
		 *    ⇒ 现在共用一个解析器（三层降级），并且我们找到后**同时贴上对方的面板标记**。 */
		const el = resolvePanelRoot();
		if (!el) return null;
		/* 护栏：别把插件自己的东西当成宿主的（插件视图也渲染在同一片视图区里） */
		if (el.closest(PLUGIN_GUARD_SELECTOR)) return null;
		el.setAttribute(COL_MARK, "1");
		colRef = el;
		return el;
	} catch (e) { return null; }
}

/** 宿主行的容器（列的父；我们注入的绝对定位控件挂在它下面，随行一起生灭） */
function findRow(col) {
	try {
		const row = col && col.parentElement;
		if (!row) return null;
		if (row.closest(PLUGIN_GUARD_SELECTOR)) return null;
		return row;
	} catch (e) { return null; }
}

/**
 * 宿主自带的宽度拖拽手柄。
 * 判据走 **React props**（`onMouseDown` 存在）+ 几何（宽度 4–12px、高度 > 150）
 * ⇒ 比"第 N 个孩子"稳（宿主插一个兄弟节点就会错位）。
 */
export function findHostResizer(col) {
	try {
		const row = findRow(col);
		if (!row) return null;
		for (let i = 0; i < row.children.length; i++) {
			const c = row.children[i];
			if (c === col) continue;
			if (c.getAttribute("data-dsh-plugin")) continue;
			const r = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
			if (!r) continue;
			if (r.width > 12 || r.width < 3 || r.height < 120) continue;
			const pr = reactPropsOf(c);
			if (pr && typeof pr.onMouseDown === "function") return c;
		}
		return null;
	} catch (e) { return null; }
}

/** 宿主「总监记忆」块（列内、文本以「总监记忆」开头、孩子 ≤ 2 层） */
export function findHostMemoryBlock(col) {
	if (!col) return null;
	try {
		const kids = col.children;
		for (let i = 0; i < kids.length; i++) {
			const k = kids[i];
			if (!k || !k.getAttribute) continue;
			if (k.children.length < 1 || k.children.length > 2) continue;
			const txt = String(k.textContent || "").trim();
			if (/^总监记忆/.test(txt)) return k;
		}
		return null;
	} catch (e) { return null; }
}

/** 宿主记忆块的表头（点它 = 宿主原逻辑的"锁定"入口） */
function findMemoryHeader(block) {
	try { return block && block.children && block.children[0] ? block.children[0] : null; } catch (e) { return null; }
}

/** 宿主记忆块的内容容器（宿主 `.style.maxHeight = 160` 写在它身上） */
export function findMemoryContentWrap() {
	if (!hasDom()) return null;
	try {
		const inner = document.getElementById("dsh-memory-content");
		if (!inner || !inner.parentElement) return null;
		if (inner.closest(PLUGIN_GUARD_SELECTOR)) return null;
		return inner.parentElement;
	} catch (e) { return null; }
}

/* ══════════════════════════════════════════════════════════════════
 *  React props 通道（用宿主自己的逻辑，不改宿主源码）
 * ══════════════════════════════════════════════════════════════════ */

/** 取某 DOM 节点上的 React props（React 16+ 的 `__reactProps$<random>`）。取不到返回 null */
export function reactPropsOf(el) {
	if (!el) return null;
	try {
		const keys = Object.keys(el);
		for (let i = 0; i < keys.length; i++) {
			if (keys[i].indexOf("__reactProps$") === 0) return el[keys[i]];
		}
		return null;
	} catch (e) { return null; }
}

/**
 * 调用宿主自己写好的 handler（普通函数，不是合成事件）。
 * @returns {boolean} 调到了才 true —— 调用方据此区分"宿主没这个处理器"与"调了没用"
 */
export function callHostHandler(el, name, arg) {
	const pr = reactPropsOf(el);
	if (!pr || typeof pr[name] !== "function") return false;
	try { pr[name](arg); return true; } catch (e) { return false; }
}

/* ══════════════════════════════════════════════════════════════════
 *  L1 · 几何接管（可逆）
 * ══════════════════════════════════════════════════════════════════ */

function readGeom(el, keys) {
	const out = {};
	try { for (const k of keys) out[k] = el.style[k] || ""; } catch (e) { /* ignore */ }
	return out;
}
function writeGeom(el, keys, snap) {
	try { for (const k of keys) if (k in snap) el.style[k] = snap[k]; } catch (e) { /* ignore */ }
}

/** 把宿主行改成"有参照物"（绝对定位控件需要），并记账原值 */
function patchRow(row) {
	if (!row || row.getAttribute(ROW_MARK)) return;
	try {
		row.setAttribute(ROW_MARK, JSON.stringify(readGeom(row, ROW_KEYS)));
		row.style.position = "relative";
	} catch (e) { /* ignore */ }
}
function unpatchRow(row) {
	if (!row) return;
	try {
		const raw = row.getAttribute(ROW_MARK);
		if (!raw) return;
		writeGeom(row, ROW_KEYS, JSON.parse(raw));
		row.removeAttribute(ROW_MARK);
	} catch (e) { /* ignore */ }
}

/** 上一次**真正落地**的几何签名（`collapsed:width`）—— 只为让 `geomApplied` 反映"变化次数" */
let lastGeomSig = null;

/**
 * 按**插件 store**把几何落到宿主列上（幂等）。
 * 折叠：`display:none` + 宽/最小宽 0 + `flex:0 0 0` + 无右边框 + 裁溢出
 *   ⇒ 它不再占任何宽度，右侧对话区（flex:1）自动铺满 —— 这就是 [图3] 的修法。
 * 展开：先还回**备份的原值**（若曾折叠过），再按 store 宽度施加我方几何。
 * @returns {boolean} 是否成功找到并处理了宿主列
 */
export function applyHostColumnGeometry() {
	if (!hasDom()) return degrade("无 document（离线桩 / 非浏览器环境）");
	let col = null, st = null;
	try {
		col = findHostDirectorColumn();
		st = directorLayoutStore.getState();
	} catch (e) { return degrade("取列/store 失败：" + ((e && e.message) || e)); }
	if (!col || !st) { return false; } // 总监页没有宿主左栏 —— **不是降级**，是正常缺省

	try {
		const row = findRow(col);
		if (row) patchRow(row);
		const collapsed = Boolean(st.directorPanelCollapsed);
		if (collapsed) {
			if (!col.getAttribute(GEOM_MARK)) col.setAttribute(GEOM_MARK, JSON.stringify(readGeom(col, GEOM_KEYS)));
			col.style.width = "0px";
			col.style.minWidth = "0px";
			col.style.flex = "0 0 0px";
			col.style.borderRight = "none";
			col.style.overflow = "hidden";
			col.style.display = "none";
			hostColumnState.minimized = true;
		} else {
			const raw = col.getAttribute(GEOM_MARK);
			if (raw) {
				writeGeom(col, GEOM_KEYS, JSON.parse(raw));
				col.removeAttribute(GEOM_MARK);
				hostColumnState.geomRestored++;
			}
			const w = Number(st.directorPanelWidth);
			/* 🔴 必须**显式**写 "flex"，不能写 `col.style.display || "flex"`：
			 *    2026-09-14 闸门 C9 抓到 —— 上一轮折叠留下了 `display:none`，
			 *    `"none" || "flex"` 求值仍是 `"none"` ⇒ **展开后列依然是隐的**，
			 *    而 store 显示"未折叠"（状态与几何各说各话，且**不报错**）。
			 *    宿主自己写的就是 `display:"flex"`（client.js:7330）⇒ 直接对齐它。 */
			col.style.display = "flex";
			col.style.width = (Number.isFinite(w) && w > 0 ? Math.round(w) : 300) + "px";
			/* 🔴 `min-width:180px` 是宿主内联写死的（client.js:7330）—— 不清掉它，
			 *    宽度永远下不了 180（"拖不动"的真因之一）。 */
			col.style.minWidth = "0px";
			col.style.flex = "0 0 auto";
			hostColumnState.minimized = false;
		}
		/* 🔴 幂等性判据（注释与代码必须一致，纪律 14）：
		 *    `geomApplied` 记的是"**几何真的变了一次**"，不是"sync 跑过一次"。
		 *    无变化仍重复落地（保持幂等）但不计数，否则"有没有变化"就从读数里看不出来。 */
		const applied = (collapsed ? "c" : "e") + ":" + col.style.width;
		if (applied !== lastGeomSig) { lastGeomSig = applied; hostColumnState.geomApplied++; }
		heal();
		return true;
	} catch (e) {
		return degrade("几何落地失败：" + ((e && e.message) || e));
	}
}

/* ══════════════════════════════════════════════════════════════════
 *  L2 · 插件侧控件（最小化按钮 + 宽度拖拽条）
 * ══════════════════════════════════════════════════════════════════ */

function ensureNode(row, id, testid, tag) {
	let n = document.getElementById(id);
	if (n && n.isConnected) return n;
	if (!hasEl()) return null;
	try {
		n = document.createElement(tag || "div");
		n.id = id;
		n.setAttribute("data-testid", testid);
		n.setAttribute("data-dsh-plugin", "1");
		row.appendChild(n);
		return n;
	} catch (e) { return null; }
}

/* 单位归一（数值型尺寸必须补 px）—— 唯一真相源见 `util/dom-style.js`。
 * 本文件**不再自带一份** `px()`：同一事实抄两份必然漂移（纪律 21）。 */
const px = pxOf;

function styleBtn(n, extra) {
	if (!n) return;
	try {
		Object.assign(n.style, px({
			position: "absolute", zIndex: 74, border: "1px solid var(--dp-line, #3d4148)",
			background: "var(--dp-bg-2, rgba(24,26,30,.92))", color: "var(--dp-t2, #b6bcc6)",
			borderRadius: "var(--dp-radius-sm, 5px)", cursor: "pointer",
			font: "600 11px/1 ui-monospace,Consolas,monospace", padding: 0,
			display: "flex", alignItems: "center", justifyContent: "center"
		}), px(extra || {}));
	} catch (e) { /* ignore */ }
}

/** 列当前占用的宽度（用于把控件摆到"最右侧"）；折叠时为 0 */
function colWidth(col) {
	try {
		if (!col.isConnected) return 0;
		const r = col.getBoundingClientRect();
		return Math.max(0, Math.round(r.width));
	} catch (e) { return 0; }
}

/**
 * 摆放 / 刷新我方控件（幂等）。宿主重挂载后节点被销毁 ⇒ 这里会重建。
 * 三个控件的横坐标都由"列宽"推导 ⇒ 折叠（列宽 0）后最小化按钮自动落到行最左侧，
 * 仍然可点（**这是能再次展开的唯一入口**，不能跟着列一起消失）。
 */
export function syncHostColumnChrome() {
	if (!hasDom()) return false;
	let col = null, row = null;
	try { col = findHostDirectorColumn(); row = col ? findRow(col) : null; } catch (e) { return false; }
	if (!col || !row) return false;

	const w = hostColumnState.minimized ? 0 : colWidth(col);
	/* ① 最小化 / 展开按钮 */
	const min = ensureNode(row, MIN_BTN_ID, "dp-host-col-min", "button");
	if (min) {
		const st = directorLayoutStore.getState();
		const collapsed = Boolean(st.directorPanelCollapsed);
		/* 🔴 命中区纪律（2026-09-14 闸门 C1/C6/C7 抓到"不可命中"）：
		 *    · 按钮必须**完全落在列内**（`w-26`，不是 `w-24`）—— 留出右边给拖拽条，
		 *      两者不重叠 ⇒ 真实鼠标的 `elementFromPoint` 不会互相抢；
		 *    · `zIndex` 比拖拽条**高**：万一极窄宽度下仍重叠，可点的是"能救命的那个"
		 *      （折叠后拖拽条已 `display:none`，但展开态两者并存）。 */
		styleBtn(min, {
			top: 3, left: Math.max(2, w - 26) + "px", width: 20, height: 18, zIndex: 76
		});
		min.textContent = collapsed ? "▶" : "—";
		min.title = collapsed ? "展开总监列" : "最小化总监列（旁边对话会占满）";
		min.setAttribute("aria-label", min.title);
		min.setAttribute("data-collapsed", collapsed ? "1" : "0");
		/* 🔴 点它只改 **插件 store**（唯一真相源），几何由订阅者落地。
		 *    `stopPropagation` 是必需的：宿主列自己有 onClick=setFocusTarget（会改焦点边框）。 */
		if (!min.getAttribute("data-dsh-bound")) {
			min.setAttribute("data-dsh-bound", "1");
			min.addEventListener("click", (e) => {
				try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* ignore */ }
				try { directorLayoutStore.toggleDirectorCollapsed(); } catch (err) { /* ignore */ }
				scheduleSync();
			});
		}
		hostColumnState.minBtn = true;
	}

	/* ② 宽度拖拽条（替代宿主那条被 clamp 到 [180,600] 的手柄） */
	const rz = ensureNode(row, COL_RESIZER_ID, "dp-host-col-resizer", "div");
	if (rz) {
		styleBtn(rz, {
			top: 0, bottom: 0, width: 6, borderRadius: 0, border: "none",
			background: dragOn ? "var(--dp-ac, #2f6feb)" : "transparent",
			cursor: "col-resize", left: Math.max(0, w - 6) + "px", zIndex: 72,
			display: hostColumnState.minimized ? "none" : "flex"
		});
		rz.title = "左右拖动调整总监列宽度（拖到最窄自动最小化；双击复位）";
		rz.setAttribute("role", "separator");
		rz.setAttribute("aria-orientation", "vertical");
		rz.setAttribute("data-dragging", dragOn ? "1" : "0");
		rz.setAttribute("data-width", String(directorLayoutStore.getState().directorPanelWidth));
		if (!rz.getAttribute("data-dsh-bound")) {
			rz.setAttribute("data-dsh-bound", "1");
			rz.addEventListener("mousedown", onResizerDown);
			rz.addEventListener("dblclick", () => {
				try { directorLayoutStore.resetPanelWidths(); } catch (e) { /* ignore */ }
				scheduleSync();
			});
		}
		hostColumnState.resizer = true;
	}

	/* ③ 宿主自带手柄 —— 藏起来（宽度只留一处真相源）。
	 *    ⚠️ 用 `data-dsh-hidden` 记账原值，"还原"要能还回去（不许无条件写回某个想当然的值）。 */
	const hh = findHostResizer(col);
	if (hh) {
		if (!hh.getAttribute("data-dsh-hidden")) {
			hh.setAttribute("data-dsh-hidden", hh.style.display || "");
			hh.style.display = "none";
		}
		hostColumnState.hostHandleHidden = true;
	}

	/* ④ 记忆面板工具条（延迟秒数 + 锁定）—— 贴在记忆表头正上方 */
	syncMemoryBar(col, row);
	syncMemoryHeightHandle(col, row);
	return true;
}

let dragOn = false;

function onResizerDown(e) {
	if (!e) return;
	const col = findHostDirectorColumn();
	const row = col ? findRow(col) : null;
	if (!col || !row) return;
	try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* ignore */ }
	dragOn = true;
	let rowW = 0;
	try { rowW = row.getBoundingClientRect().width; } catch (err) { /* ignore */ }
	const startX = e.clientX;
	let startW = 0;
	try { startW = Math.max(1, Math.round(col.getBoundingClientRect().width)); } catch (err) { /* ignore */ }
	const max = colWidthMax(rowW);
	const onMove = (ev) => {
		const w = Math.max(COL_WIDTH_MIN, Math.min(startW + (ev.clientX - startX), max));
		try {
			/* 🔴 写 **store**（不是直接写 DOM）：store → 订阅 → applyHostColumnGeometry。
			 *    拖到 < PANEL_MIN_WIDTH 时 store 自己会置 collapse=true ⇒ 自动吸附最小化。 */
			if (w < 120) directorLayoutStore.toggleDirectorCollapsed();
			else directorLayoutStore.dragDirectorWidth(w);
		} catch (err) { /* ignore */ }
		scheduleSync();
	};
	const onUp = () => {
		dragOn = false;
		try {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
		} catch (err) { /* ignore */ }
		scheduleSync();
	};
	try {
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	} catch (err) { /* ignore */ }
}

/* ══════════════════════════════════════════════════════════════════
 *  L3 · 记忆面板：延迟展开 / 锁定语义 / 高度可拖
 * ══════════════════════════════════════════════════════════════════ */

let hoverTimer = null;
/** 正在拖高度手柄 —— 拖动期间**不许**因"鼠标离开记忆区"而收起（否则拖到一半面板塌了，E9 红） */
let memDragging = false;
function clearHoverTimer() {
	if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
}

function delayMs() {
	try { return Number(directorLayoutStore.getMemoryHoverDelay()) || 0; } catch (e) { return 0; }
}

/**
 * 🔴 把「是否锁定」写进**宿主自己的** gate 变量 `window.__dshMemoryLocked`。
 *
 * 宿主两个 handler 都是 `if (!window.__dshMemoryLocked) { … }` 形状（client.js:7357/7358）：
 *   onMouseEnter: 未锁 ⇒ setBottomPanelCollapsed(false)
 *   onMouseLeave: 未锁 ⇒ setBottomPanelCollapsed(true)
 * ⇒ 这个变量是**宿主侧唯一的闸门**，我方 store 无论怎么写都影响不到它。
 *
 * 2026-09-14 真机取证（`scripts/_probe-memseq.expr`）：正因为它没被同步，
 * 「点锁定」那一刻它已被写作 `true`，紧接着调用宿主 `onMouseEnter` 就**静默早退**
 *   ⇒ `memOpen++`（handler 确实被调到）却 `children` 仍为 1（面板没展开）
 *   ⇒ 闸门 E6 红。**"调到了"与"起作用了"是两件事**（纪律 23/30）。
 */
function setHostLockFlag(locked) {
	try { if (typeof window !== "undefined") window.__dshMemoryLocked = Boolean(locked); } catch (e) { /* ignore */ }
}

/**
 * 记忆「悬停区」= 宿主记忆块 ∪ 我方记忆工具条 ∪ 高度拖拽手柄。
 *
 * 🔴 为什么必须把后两者算进来（真机取证 2026-09-14）：
 *   我方工具条是**绝对定位贴在表头附近**的，真实鼠标落在它上面时，
 *   `block.contains(target)` 为 **false** ⇒ 这次"进入"不被识别 ⇒ 既不延迟展开、
 *   也不拦事件。用户要的是「鼠标移过来就展开」，**压在表头上的自家工具条不能变成一块死区**。
 *   高度手柄同理（它贴在内容区上沿）。
 */
function memoryZoneContains(node) {
	if (!node || node.nodeType !== 1) return false;
	try {
		const block = findHostMemoryBlock(findHostDirectorColumn());
		if (block && block.contains(node)) return true;
		for (const id of [MEM_BAR_ID, MEM_HEIGHT_HANDLE_ID]) {
			const el = document.getElementById(id);
			if (el && el.contains(node)) return true;
		}
	} catch (e) { /* ignore */ }
	return false;
}

/** 立刻用**宿主自己的** handler 展开记忆面板 */
export function expandMemoryNow() {
	const col = findHostDirectorColumn();
	const block = findHostMemoryBlock(col);
	if (!block) return false;
	clearHoverTimer();
	/* 🔴 加锁态下宿主 handler 会早退 ⇒ 想在"锁定的同时展开"必须把闸门临时摆成"未锁"，
	 *    调完立刻置回锁定值：宿主 handler 是**同步**读闸门并同步调 store 的，
	 *    所以这一次读到的就是它该读到的值。 */
	const locked = isMemoryLocked();
	if (locked) setHostLockFlag(false);
	const ok = callHostHandler(block, "onMouseEnter");
	if (locked) setHostLockFlag(true);
	if (ok) hostColumnState.memOpen++;
	/* `true`：展开的是**宿主自己的 state**，不在我方 store 的几何签名里 ⇒
	 *    必须强制绕过 `cheapOk()`，否则记忆工具条与高度手柄永远不刷新（闸门 E8 抓到）。 */
	scheduleSync(true);
	return ok;
}

/** 立刻用**宿主自己的** handler 收起记忆面板（锁定时不动作） */
export function collapseMemoryNow() {
	const col = findHostDirectorColumn();
	const block = findHostMemoryBlock(col);
	if (!block) return false;
	if (isMemoryLocked()) return false;
	clearHoverTimer();
	setHostLockFlag(false);
	const ok = callHostHandler(block, "onMouseLeave");
	if (ok) hostColumnState.memClose++;
	scheduleSync(true);
	return ok;
}

/**
 * 锁定开关的唯一入口（表头点击 / 工具条锁按钮 / 任何程序化调用都走这里）。
 *
 * 语义（用户第 6 批需求 2 的澄清"固定也不好用，需要修正"）：
 *   · **加锁 = 立即展开 + 移动鼠标不再收起**
 *   · **解锁 = 立即收起**（不再靠"当前是否展开"猜，也不再翻转）
 * 🔴 加锁时"展开"这一步必须走 `expandMemoryNow()`（它会临时松开宿主的闸门），
 *    否则宿主 handler 早退 ⇒ 锁上了却看不见内容。
 */
export function toggleMemoryLock() {
	const was = isMemoryLocked();
	directorLayoutStore.setMemoryLocked(!was);
	hostColumnState.memLockFix++;
	if (!was) expandMemoryNow(); else collapseMemoryNow();
	scheduleSync(true);
	return !was;
}

function isMemoryLocked() {
	try { return Boolean(directorLayoutStore.getMemoryLocked()); } catch (e) { return false; }
}

/**
 * 廉价前置门：节点是否落在**宿主总监列**之内（祖先链 `closest` 一次，深度 ~20）。
 *
 * 为什么要它：本模块现在挂了 `mouseover/mouseout/mouseenter/mouseleave` **四类**文档级监听，
 * 一次"鼠标从列外移入"实测会产生 `mouseenter × 14 / mouseleave × 10`。
 * 若每次都直接进 `memoryZoneContains`（要 `findHostDirectorColumn` + `findHostMemoryBlock` +
 * 两次 `getElementById`），绝大多数与记忆区无关的移动都白跑一遍。
 * ⇒ 先用 `closest` 把"根本不在总监列里"的事件挡在门外，热路径开销降到一次祖先链查找。
 * （不是"提前返回就算通过"—— 真正的判据仍是 `memoryZoneContains`，这里只是分流。）
 */
function nearHostColumn(node) {
	if (!node || node.nodeType !== 1) return false;
	try {
		if (colRef && colRef.contains && colRef.contains(node)) return true;
		return !!(node.closest && node.closest("[" + COL_MARK + "]"));
	} catch (e) { return false; }
}

/**
 * 🔴 记忆区事件的**统一判据：`target` 或 `relatedTarget` 任一落在区内，就算"与记忆区有关"**。
 *
 * 为什么不能只看 `target`（2026-09-14 最终定位 · 闸门 E4 的最后一根钉子）：
 *   React 的 `EnterLeaveEventPlugin` **同时**注册 `mouseout` 与 `mouseover` 两个顶层事件，
 *   并从**任一**事件里用 `(relatedTarget → target)` 这一对去合成 `onMouseEnter` / `onMouseLeave`。
 *   ⇒ 「从区外移入区内」这一次跨越会产生**两个**事件：
 *       · `mouseout`：target = **区外**元素，relatedTarget = 区内元素
 *       · `mouseover`：target = 区内元素，relatedTarget = 区外元素
 *     旧实现只拦「target 在区内」的那一半 ⇒ 第一条 `mouseout` **被放行**，
 *     React 由它合成了宿主的 `onMouseEnter` ⇒ 宿主立刻展开。
 *     而那一刻 `window.__dshMemoryLocked` 恰好还是 `collapseMemoryNow()` 留下的 `false`
 *     ⇒ 闸门也拦不住。实测读数：`expanded=true · flag=true · kids=["DIV","DIV"]`，
 *     而我们的 `memOpen` **没涨**（不是我们的代码开的）。
 *   ⇒ 结论：跨越方向的两个事件都必须拦；只拦一半 = 没拦。
 */
function memZoneTouched(e) {
	const t = e && e.target;
	const r = e && e.relatedTarget;
	if (!nearHostColumn(t) && !nearHostColumn(r)) return false;   /* 廉价前置门 */
	return memoryZoneContains(t) || memoryZoneContains(r);
}

/** 文档级捕获监听：拦下"进入/离开记忆块"的那一次事件 */
function onDocMouseOverCapture(e) {
	try {
		if (!e || e.target == null) return;
		if (!memZoneTouched(e)) return;                 /* 与记忆区无关：一律不碰 */
		/* 🔴 **先拦，再判** —— 顺序不能换（本模块第三次踩同型坑）
		 *   把「区内→区内不算进入」的 early-return 放在 stopPropagation 之前，
		 *   那些事件会继续传播到 React root 并被合成出 enter/leave。 */
		e.stopPropagation();
		/* 本事件只负责「进入」方向：target 必须在区内 */
		if (!memoryZoneContains(e.target)) return;
		if (memoryZoneContains(e.relatedTarget)) return;   /* 区内 → 区内：不是进入 */
		hostColumnState.memOverBlocked++;
		if (memDragging) return;                       /* 拖高中：不因悬停改变开合 */
		const d = delayMs();
		clearHoverTimer();
		if (isMemoryLocked()) return;
		if (d <= 0) { expandMemoryNow(); return; }
		/* 额外把宿主闸门摆成"已锁"：双保险（拦事件 + 宿主自己的开关） */
		setHostLockFlag(true);
		hoverTimer = setTimeout(() => {
			hoverTimer = null;
			setHostLockFlag(isMemoryLocked());
			/* 定时器到点时可能已经被锁上/已经被别处展开 ⇒ 交给 expandMemoryNow 统一处理 */
			expandMemoryNow();
			scheduleSync(true);
		}, d);
		scheduleSync(true);
	} catch (err) { /* 拦截失败不影响任何功能 */ }
}

function onDocMouseOutCapture(e) {
	try {
		if (!e || e.target == null) return;
		if (!memZoneTouched(e)) return;
		e.stopPropagation();                            /* 同上：先拦，再判 */
		/* 本事件只负责「离开」方向：target 必须在区内 */
		if (!memoryZoneContains(e.target)) return;
		if (memoryZoneContains(e.relatedTarget)) return;   /* 区内 → 区内：不是离开 */
		hostColumnState.memOutBlocked++;
		clearHoverTimer();
		if (memDragging) return;                       /* 拖高中：不许收起 */
		if (isMemoryLocked()) { setHostLockFlag(true); return; }
		const d = delayMs();
		const fire = () => {
			const b2 = findHostMemoryBlock(findHostDirectorColumn());
			if (!b2) return;
			setHostLockFlag(isMemoryLocked());          /* 先还原闸门，再按我方语义收起 */
			const ok = callHostHandler(b2, "onMouseLeave");
			if (ok) hostColumnState.memClose++;
			scheduleSync(true);
		};
		if (d <= 0) { fire(); return; }
		/* 与"进入"对称：离开也由我方延迟决定 ⇒ 期间把宿主闸门摆成"已锁"，压住它的即时收起 */
		setHostLockFlag(true);
		hoverTimer = setTimeout(() => { hoverTimer = null; fire(); }, d);
		scheduleSync(true);
	} catch (err) { /* ignore */ }
}

/**
 * `mouseenter` / `mouseleave` 是**不冒泡**的独立派发（进入链上每层各来一次），
 * 走的是与 `mouseover` 不同的一次 dispatch。
 * 真机取证：一次"进入记忆区"事件计数是 `cap.mouseenter=14 / cap.mouseleave=10`。
 * 只要宿主（或将来某个宿主版本）用**原生** mouseenter 直连监听，光拦 mouseover 是拦不住的
 * ⇒ 这里对**落在记忆区内**的 enter/leave 也一并拦死，把开合时机的唯一真相源收在我方。
 * （不拦区外事件：那是宿主别处的正常交互，动不得。）
 */
function onDocEnterLeaveCapture(e) {
	try {
		if (!e || !e.target || e.target.nodeType !== 1) return;
		if (!memZoneTouched(e)) return;
		e.stopPropagation();
		hostColumnState.memEnterBlocked++;
	} catch (err) { /* ignore */ }
}

/**
 * 文档级捕获监听：接管记忆表头的**点击**（锁定开关）。
 * 🔴 宿主原逻辑（client.js:7367）：`__dshMemoryLocked = !locked; toggleBottomPanel();`
 *    —— 锁定时**仍然翻转面板** ⇒「点锁定反而收起」。
 *    新语义：**加锁 = 保持展开；解锁 = 收起**（不再翻转，也不再靠"当前是否展开"猜）。
 *    实现收敛到 `toggleMemoryLock()` 一处（表头点击与工具条锁按钮共用同一真相源）。
 */
function onDocClickCapture(e) {
	try {
		if (!e || !e.target || e.target.nodeType !== 1) return;
		const col = findHostDirectorColumn();
		const block = findHostMemoryBlock(col);
		const header = findMemoryHeader(block);
		if (!header || !header.contains(e.target)) return;
		e.stopPropagation();
		e.preventDefault();
		toggleMemoryLock();
	} catch (err) { /* ignore */ }
}

/** 记忆工具条：延迟秒数输入 + 锁定指示（贴在记忆表头正上方，随表头走） */
function syncMemoryBar(col, row) {
	const block = findHostMemoryBlock(col);
	const header = findMemoryHeader(block);
	if (!block || !header) return false;
	const bar = ensureNode(row, MEM_BAR_ID, "dp-mem-bar", "div");
	if (!bar) return false;
	let top = 0, left = 0;
	try {
		const rr = row.getBoundingClientRect();
		const hr = header.getBoundingClientRect();
		top = Math.max(0, Math.round(hr.top - rr.top) - 21);
		left = Math.max(2, Math.round(hr.left - rr.left));
	} catch (e) { /* ignore */ }
	try {
		Object.assign(bar.style, px({
			position: "absolute", zIndex: 74, top: top + "px", left: left + "px",
			display: "flex", alignItems: "center", gap: 4,
			padding: "0 3px", height: 18, border: "1px solid var(--dp-line, #3d4148)",
			background: "var(--dp-bg-2, rgba(24,26,30,.94))",
			borderRadius: "var(--dp-radius-sm, 5px)",
			font: "600 10px/1 ui-monospace,Consolas,monospace", color: "var(--dp-t3, #8b9199)"
		}));
	} catch (e) { /* ignore */ }
	if (!bar.getAttribute("data-dsh-built")) {
		bar.setAttribute("data-dsh-built", "1");
		bar.innerHTML = "";
		const lab = document.createElement("span");
		lab.textContent = "延迟";
		const inp = document.createElement("input");
		inp.id = "dsh-mem-delay";
		inp.setAttribute("data-testid", "dp-mem-delay");
		inp.setAttribute("data-dsh-plugin", "1");
		inp.type = "number";
		inp.step = "0.1"; inp.min = "0"; inp.max = "3";
		Object.assign(inp.style, px({
			width: 42, height: 14, border: "1px solid var(--dp-line, #3d4148)", borderRadius: 3,
			background: "transparent", color: "var(--dp-t1, #e8eaed)",
			font: "600 10px/1 ui-monospace,Consolas,monospace", padding: "0 2px", textAlign: "right"
		}));
		const unit = document.createElement("span");
		unit.textContent = "s";
		const lock = document.createElement("button");
		lock.id = "dsh-mem-lock";
		lock.setAttribute("data-testid", "dp-mem-lock");
		lock.setAttribute("data-dsh-plugin", "1");
		Object.assign(lock.style, px({
			border: "1px solid var(--dp-line, #3d4148)", borderRadius: 3, background: "transparent",
			color: "var(--dp-t3, #8b9199)", cursor: "pointer", padding: "0 4px",
			font: "600 10px/1 ui-monospace,Consolas,monospace", height: 14
		}));
		/* 输入即生效（`input` 而非 `change`：闸门/probe 直接派发 input 事件就能验） */
		inp.addEventListener("input", () => {
			try { directorLayoutStore.setMemoryHoverDelay(Math.round(Number(inp.value) * 1000)); } catch (e) { /* ignore */ }
			syncMemoryBar(findHostDirectorColumn(), findRow(findHostDirectorColumn()));
		});
		/* 表头点击已被我们接管；工具条上的锁按钮走**同一条语义**（同一真相源 `toggleMemoryLock`） */
		lock.addEventListener("click", (e) => {
			try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* ignore */ }
			toggleMemoryLock();
			syncMemoryBar(findHostDirectorColumn(), findRow(findHostDirectorColumn()));
		});
		bar.appendChild(lab); bar.appendChild(inp); bar.appendChild(unit); bar.appendChild(lock);
	}
	try {
		const inp2 = bar.querySelector("#dsh-mem-delay");
		const lock2 = bar.querySelector("#dsh-mem-lock");
		const secs = (delayMs() / 1000);
		if (inp2 && document.activeElement !== inp2) inp2.value = String(Math.round(secs * 10) / 10);
		if (lock2) {
			const lk = isMemoryLocked();
			lock2.textContent = lk ? "🔒" : "🔓";
			lock2.title = lk ? "已锁定：鼠标移出也不收回。点击解锁并收起" : "未锁定：鼠标移出即收回。点击锁定";
			lock2.setAttribute("data-locked", lk ? "1" : "0");
		}
		bar.setAttribute("data-delay-ms", String(delayMs()));
		bar.setAttribute("data-locked", isMemoryLocked() ? "1" : "0");
	} catch (e) { /* ignore */ }
	hostColumnState.memBar = true;
	return true;
}

/** 高度手柄：贴在记忆内容区上沿，向上拖 = 变高 */
function syncMemoryHeightHandle(col, row) {
	const wrap = findMemoryContentWrap();
	if (!wrap) { hostColumnState.memHeight = false; return false; }
	try { wrap.style.maxHeight = directorLayoutStore.getMemoryPanelHeight() + "px"; } catch (e) { /* ignore */ }
	hostColumnState.memHeight = directorLayoutStore.getMemoryPanelHeight();
	const h = ensureNode(row, MEM_HEIGHT_HANDLE_ID, "dp-mem-height", "div");
	if (!h) return false;
	let top = 0, left = 0, wid = 0;
	try {
		const rr = row.getBoundingClientRect();
		const wr = wrap.getBoundingClientRect();
		top = Math.max(0, Math.round(wr.top - rr.top) - 3);
		left = Math.max(2, Math.round(wr.left - rr.left));
		wid = Math.max(20, Math.round(wr.width));
	} catch (e) { /* ignore */ }
	try {
		Object.assign(h.style, px({
			position: "absolute", zIndex: 73, top: top + "px", left: left + "px", width: wid + "px",
			height: 6, cursor: "row-resize", background: "transparent", borderRadius: 3
		}));
	} catch (e) { /* ignore */ }
	h.title = "上下拖动调整记忆面板高度（当前 " + directorLayoutStore.getMemoryPanelHeight() + "px）";
	h.setAttribute("data-height", String(directorLayoutStore.getMemoryPanelHeight()));
	if (!h.getAttribute("data-dsh-bound")) {
		h.setAttribute("data-dsh-bound", "1");
		h.addEventListener("mousedown", (e) => {
			try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* ignore */ }
			/* 拖高期间：面板**不许**因为鼠标离开记忆区而收起（否则拖到一半就塌了）。
			 * 真机取证：E9 拖动过程中指针上移出区 ⇒ 延迟收起触发 ⇒ 内容区被卸载
			 * ⇒ `maxHeight` 读成 null（"store 变了但 DOM 没跟随"的假象）。 */
			memDragging = true;
			clearHoverTimer();
			const startY = e.clientY;
			const startH = directorLayoutStore.getMemoryPanelHeight();
			const onMove = (ev) => {
				try { directorLayoutStore.setMemoryPanelHeight(startH - (ev.clientY - startY)); } catch (err) { /* ignore */ }
				scheduleSync();
			};
			const onUp = () => {
				memDragging = false;
				try {
					document.removeEventListener("mousemove", onMove);
					document.removeEventListener("mouseup", onUp);
				} catch (err) { /* ignore */ }
				scheduleSync(true);
			};
			try {
				document.addEventListener("mousemove", onMove);
				document.addEventListener("mouseup", onUp);
			} catch (err) { /* ignore */ }
		});
	}
	return true;
}

/* ══════════════════════════════════════════════════════════════════
 *  安装 / 卸载
 * ══════════════════════════════════════════════════════════════════ */

let observer = null;
let unsubscribe = null;
let docBound = false;
let syncTimer = null;

/**
 * 合并 + **限流**到一次同步。
 *
 * 🔴 2026-09-14 实测事故（本模块第一版就是这么把渲染进程打哑的）：
 *    第一版用 `Promise.resolve().then(sync)`（微任务）做合并 ⇒ 宿主在**流式输出**期间
 *    每秒产生成百上千次 mutation，每次都把一个微任务排在当前任务之后 ⇒
 *    `sync()` 里的 `document.querySelector` 属性子串选择器（`[style*="min-width: 180px"]`）
 *    与若干次 `getBoundingClientRect()`（**强制同步布局**）被连续执行 ⇒
 *    **布局抖动（layout thrashing）**，`Runtime.enable` 8s 超时、整页无响应。
 *    表征极具误导性：看起来像"插件把应用弄崩了"，而不是"回调写重了"。
 *    ⇒ 两条硬要求（缺一不可）：
 *      ① **时间限流**（不是微任务合并）：最快 120ms 才跑一次，代价与 mutation 频率**解耦**；
 *      ② **廉价前置判据**（`cheapOk()`）：不查全文档、不做几何测量，
 *         只认"我自己的节点还在不在" ⇒ 常规重渲染零开销。
 */
function scheduleSync(force) {
	if (force) forceSync = true;
	if (syncTimer) return;
	syncTimer = setTimeout(() => { syncTimer = null; sync(); }, 120);
}

/**
 * 强制下一次 sync 绕过 `cheapOk()`。
 * 🔴 为什么需要它（闸门 E8 抓到）：`cheapOk()` 只认"列 / 按钮还在不在、折叠态对不对"。
 *    记忆面板的**展开/收起**与**内容区高度**不在它的观察范围里 ⇒
 *    `expandMemoryNow()` 之后的 sync 会被廉价路径提前 return，
 *    记忆工具条与高度手柄**永远不刷新**（表现：展开后没有高度手柄，但没人报错）。
 *    ⇒ 凡"改的是记忆面板状态"的动作，一律 `scheduleSync(true)`。
 */
let forceSync = false;


/**
 * **几何签名**：把所有会改变"我方要落地的几何/控件形态"的 store 值拼成一个短字符串。
 *
 * 🔴 为什么需要它（2026-09-14 自查抓到）：`cheapOk()` 原先只看「列 / 按钮还在不在 +
 *    折叠态与 DOM 是否一致」。但 **`hostColumnState.minimized` 是"上一次落地的结果"**，
 *    不是"store 现在的说法" ⇒ 两者在"store 刚变、DOM 还没落地"的那一瞬间**恰好相等**
 *    ⇒ 快路径判定"无事可做"并 **return** ⇒ `applyHostColumnGeometry()` 永远不执行。
 *    表现：点了最小化**零反应**（既有断言 C2/C3 之所以还能过，是因为那一轮列被上游
 *    裁剪规则整列隐掉了 ⇒ 宽度天然为 0 —— **假绿**）。
 *    修法：让签名参与判据 —— store 一动，快路径必然失效，无需在每个调用点手写 `force`。
 *
 * 代价：一次 store 取值 + 5 个数字/布尔拼接，**零 DOM 访问、零几何测量**（仍满足廉价）。
 */
function geomSig() {
	try {
		const st = directorLayoutStore.getState();
		return [
			st.directorPanelCollapsed ? 1 : 0,
			Number(st.directorPanelWidth) || 0,
			Number(st.memoryPanelHeight) || 0,
			Number(st.memoryHoverDelayMs) || 0,
			st.memoryLocked ? 1 : 0
		].join("|");
	} catch (e) { return null; } // 取不到 ⇒ 让快路径失效，走完整同步（宁多一次，不少一次）
}
/** 上一次**完整同步**时落地的签名（只在 `sync()` 真正跑完时更新） */
let lastSig = null;

/**
 * 廉价前置判据：**不查全文档、不做任何几何测量**。
 * 全用 `getElementById`（哈希查找）与已缓存的列引用 —— 这是限流之外的第二道保险。
 */
function cheapOk() {
	if (!hasDom()) return false;
	const btn = document.getElementById(MIN_BTN_ID);
	if (!btn || !btn.isConnected) return false;
	if (!colRef || !colRef.isConnected) return false;
	/* store 一有变化 ⇒ 必然要重新落地几何 / 控件（见 `geomSig` 的事故说明） */
	const sig = geomSig();
	if (sig === null || sig !== lastSig) return false;
	if (hostColumnState.minimized !== (colRef.style.display === "none")) return false;
	return true;
}


function sync() {
	if (!hasDom()) { degrade("无 document"); return false; }
	hostColumnState.scans++;
	const col = findHostDirectorColumn();
	if (!col) {
		/* 总监页 / 设计图全屏层覆盖时：宿主左栏本就不存在，**不是降级**。
		 * 把控件收掉（留在 DOM 里会挂在一个已卸载的行上，成为孤儿）。 */
		removeChrome();
		hostColumnState.skipped++;
		return false;
	}
	if (!forceSync && cheapOk()) { hostColumnState.skipped++; return true; }
	forceSync = false;
	hostColumnState.hoverDelayMs = delayMs();
	applyHostColumnGeometry();
	syncHostColumnChrome();
	/* 记账"这一次落地时 store 是什么样" ⇒ 下次只有 store **再变**才会走完整同步 */
	lastSig = geomSig();
	return true;
}

function removeChrome() {
	try {
		for (const id of [MIN_BTN_ID, COL_RESIZER_ID, MEM_BAR_ID, MEM_HEIGHT_HANDLE_ID]) {
			const n = document.getElementById(id);
			if (n && n.parentElement) n.parentElement.removeChild(n);
		}
	} catch (e) { /* ignore */ }
	hostColumnState.minBtn = hostColumnState.resizer = hostColumnState.memBar = hostColumnState.memHeight = false;
}

/**
 * 安装（幂等）。**绝不抛**（在 `installBatch1` 执行链上）。
 * @returns {boolean} 是否新装
 */
export function installHostDirectorColumn() {
	if (!hasDom() || !hasEl()) {
		degrade("无 document / createElement（离线桩或非浏览器环境）");
		if (typeof window !== "undefined") window.__dshHostDirectorColumn = api();
		return false;
	}
	/* 记账：boot 时把持久化的锁定态回填给宿主那个全局变量（宿主自己读它） */
	setHostLockFlag(isMemoryLocked());

	/* store 一变就重新落地几何 + 刷新控件（唯一真相源 → 执行层的单向流动） */
	if (!unsubscribe) {
		try {
			unsubscribe = directorLayoutStore.subscribe(() => { scheduleSync(); });
		} catch (e) { unsubscribe = null; }
	}

	/* 文档级捕获监听（见文件头「为什么必须挂在 document 上」）。只绑一次。 */
	if (!docBound) {
		try {
			document.addEventListener("mouseover", onDocMouseOverCapture, true);
			document.addEventListener("mouseout", onDocMouseOutCapture, true);
			document.addEventListener("mouseenter", onDocEnterLeaveCapture, true);
			document.addEventListener("mouseleave", onDocEnterLeaveCapture, true);
			document.addEventListener("click", onDocClickCapture, true);
			docBound = true;
		} catch (e) { degrade("文档级监听挂载失败：" + ((e && e.message) || e)); }
	}

	let fresh = false;
	if (!observer && typeof window.MutationObserver === "function") {
		try {
			/* 🔴 回调里**只做廉价判断**（见 `scheduleSync` 的事故说明）：
			 *    绝不在 mutation 回调里查全文档 / 量几何 —— 宿主流式输出期间那等于布局抖动。 */
			observer = new window.MutationObserver(() => {
				if (cheapOk()) { hostColumnState.skipped++; return; }
				scheduleSync();
			});
			/* 只观察"行"所在这一层：宿主切页签/重挂载会替换子树，控件的生灭都在这里。
			 * 比观察整个 body 便宜得多（且不会每次全文扫描）。 */
			const col0 = findHostDirectorColumn();
			const scope = (col0 && col0.parentElement && col0.parentElement.parentElement) || document.body;
			observer.observe(scope, { childList: true, subtree: true });
			hostColumnState.observer = true;
			fresh = true;
		} catch (e) { observer = null; degrade("MutationObserver 挂载失败：" + ((e && e.message) || e)); }
	}
	try { applyHostColumnGeometry(); syncHostColumnChrome(); heal(); } catch (e) { degrade("首装失败：" + ((e && e.message) || e)); }
	if (typeof window !== "undefined") window.__dshHostDirectorColumn = api();
	return fresh;
}

/** 全量还原（负向对照用）：几何、行、宿主手柄、我方控件、监听、观察器 —— 全部回到"从没来过" */
export function restoreHostDirectorColumn() {
	clearHoverTimer();
	try { if (observer) { observer.disconnect(); observer = null; hostColumnState.observer = false; } } catch (e) { /* ignore */ }
	try { if (unsubscribe) { unsubscribe(); unsubscribe = null; } } catch (e) { /* ignore */ }
	try {
		if (docBound) {
			document.removeEventListener("mouseover", onDocMouseOverCapture, true);
			document.removeEventListener("mouseout", onDocMouseOutCapture, true);
			document.removeEventListener("click", onDocClickCapture, true);
			docBound = false;
		}
	} catch (e) { /* ignore */ }
	removeChrome();
	try {
		const col = document.querySelector("[" + COL_MARK + "]");
		if (col) {
			const raw = col.getAttribute(GEOM_MARK);
			if (raw) { writeGeom(col, GEOM_KEYS, JSON.parse(raw)); col.removeAttribute(GEOM_MARK); }
			col.removeAttribute(COL_MARK);
			hostColumnState.geomRestored++;
			unpatchRow(col.parentElement);
		}
	} catch (e) { degrade("还原几何失败：" + ((e && e.message) || e)); }
	try {
		const hidden = document.querySelectorAll("[data-dsh-hidden]");
		for (let i = 0; i < hidden.length; i++) {
			const el = hidden[i];
			el.style.display = el.getAttribute("data-dsh-hidden") || "";
			el.removeAttribute("data-dsh-hidden");
		}
		hostColumnState.hostHandleHidden = false;
	} catch (e) { /* ignore */ }
	try {
		const wrap = findMemoryContentWrap();
		if (wrap) wrap.style.maxHeight = "";
		hostColumnState.memHeight = null;
	} catch (e) { /* ignore */ }
	hostColumnState.minimized = false;
	hostColumnState.degraded = false;
	hostColumnState.reason = null;
	colRef = null;
	lastSig = null;
	lastGeomSig = null;
	if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
	forceSync = false;
	/* 🔴 悬停延迟期间我们会把宿主闸门临时摆成"已锁"来抑制它的即时开合；
	 *    还原时若不清干净，宿主面板会**永久**不再响应鼠标（无声故障）。 */
	clearHoverTimer();
	memDragging = false;
	setHostLockFlag(false);
	return true;
}

export function uninstallHostDirectorColumn() { return restoreHostDirectorColumn(); }

function api() {
	return {
		COL_MARK, MIN_BTN_ID, COL_RESIZER_ID, MEM_BAR_ID, MEM_HEIGHT_HANDLE_ID,
		hostColumnState, colWidthMax,
		findHostDirectorColumn, findHostResizer, findHostMemoryBlock, findMemoryContentWrap,
		reactPropsOf, callHostHandler,
		applyHostColumnGeometry, syncHostColumnChrome,
		expandMemoryNow, collapseMemoryNow, toggleMemoryLock, memoryZoneContains,
		installHostDirectorColumn, restoreHostDirectorColumn, uninstallHostDirectorColumn
	};
}

/** 全局契约（调试 / 验证脚本用，不可改名） */
export function installHostDirectorColumnApi() {
	if (!hasDom()) return null;
	window.__dshHostDirectorColumn = api();
	return window.__dshHostDirectorColumn;
}
