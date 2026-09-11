/**
 * bridge/split.js — 「左栏分屏」通道（要求 5：左侧总监 / 右侧对话数据）
 *
 * ── 要解决的问题 ────────────────────────────────────────────────
 *   要求 5 要「右侧对话数据**完全与对话 tab 保持一致**」，要求 4 要「对话保持原有逻辑不变」。
 *   若把原生对话区**遮住**再画一个副本，两条要求立刻冲突（副本必然"只是长得像"）。
 *
 * ── 通道选型（docs/11 §三：方案 C，57 分居首）──────────────────
 *   **布局分屏**：不移动任何节点，只在弹窗开启期间注入一段 `<style>`，
 *   把原生应用根节点**向右挤**，腾出的左侧空间由插件的总监面板占用。
 *   ⇒ 右栏**就是**原生对话区本身（同一节点、同一渲染器、同一 store）
 *     ⇒ "完全一致"从"需要保证的性质"退化为**同义反复**；
 *     ⇒ 消息交互（查看调用详情 / 分叉 / 打开文件 / 选择复制）**原样可用**，零转发代码。
 *
 *   | 状态 | `.RWZidW_viewArea`（真机实测） |
 *   |:--|:--|
 *   | 基线 | `x=280, w=1154` |
 *   | 注入 `padding-left:300px` | `x=580, w=854` |
 *   | 移除注入 | `x=280, w=1154`（**逐值复原**） |
 *
 * ── 🔴 三条硬边界（防止"悄悄改宿主"，docs/11 §三 3.3）───────────
 *   允许：注入 `<style id="dsh-director-split-style">`；给**已存在**的原生节点加 `data-*` 属性。
 *   禁止：增删改**任何**节点；改原生事件监听；改原生数据/store；改原生节点的 `style` 属性。
 *   判据：弹出前后对宿主做 全量 DOM diff，差异必须**只有** `<style>` 标签与 `data-*` 属性。
 *
 * ── 🔴 可复用教训（本轮实测踩中，docs/11 §三 3.2）────────────────
 *   注入 `!important` 样式的探针**必须在同一表达式内移除**。
 *   本轮的一次异步探针（`requestAnimationFrame` 等待后移除）因 CDP 会话超时被后台化，
 *   **样式残留在页面里**，于是"基线"就已经是偏移态（第二次探测 `x=580` 才暴露）。
 *   故本模块：**同步注入 + 同步移除**，并且 `applySplit` 内部用 `try/finally` 兜底。
 */

import { dshLog } from "../util/debug.js";

export const SPLIT_STYLE_ID = "dsh-director-split-style";
/** 被打上「应用根」标记的属性（样式选择器完全依赖它，不依赖宿主的 hash 类名） */
export const ROOT_ATTR = "data-dsh-split-root";
/** 折叠态标记（值：`none` | `left` | `right` | `both`），供样式分支 */
export const STATE_ATTR = "data-dsh-split-collapsed";

const hasDom = () => typeof window !== "undefined" && typeof document !== "undefined";

/**
 * 插件自有 UI 的根节点 id 清单（**严禁**被当成宿主节点）。
 *
 * 🔴 为什么必须硬编码而不是 import：
 *   `split.js` 被 `DirectorDialog.js` 与 `mount.js` 引用，反向 import 会成环。
 *   漂移风险由离线断言兜住 —— `verify-dialog.mjs` C 段校验本清单与
 *   `DirectorDialog.DIALOG_ID` / `mount.DIALOG_HOST_ID|LAUNCHER_ID|OVERLAY_HOST_ID` 逐一相等。
 */
export const PLUGIN_UI_IDS = Object.freeze([
	"dsh-director-dialog",       // DirectorDialog.DIALOG_ID
	"dsh-director-dialog-host",  // mount.DIALOG_HOST_ID
	"dsh-director-hierarchy-launcher", // mount.LAUNCHER_ID
	"dsh-director-hierarchy-overlay"   // mount.OVERLAY_HOST_ID
]);
const PLUGIN_UI_SELECTOR = PLUGIN_UI_IDS.map((i) => "#" + i).join(",") + ",[data-dsh-plugin-ui]";

/**
 * 对话编辑器 placeholder（定位锚点首选）。
 * 🔴 与 `chat-bridge.COMPOSER_PLACEHOLDER` **必须相等**；`chat-bridge` 已 import 本模块，
 *    反向 import 会成环 ⇒ 本地声明，等值关系由离线断言（verify-dialog C 段）锁定。
 */
export const CHAT_COMPOSER_PLACEHOLDER = "给智能体发消息";

/** 是否落在插件自有 UI 内（含自身） */
export function isPluginNode(el) {
	if (!el || !el.closest) return false;
	try { return Boolean(el.closest(PLUGIN_UI_SELECTOR)); } catch (e) { return false; }
}

/** 是否滚动容器（`overflow-x` 为 auto/scroll/hidden 时不可挂 padding —— 见下方硬约束） */
function isScrollContainer(el) {
	if (!hasDom() || !window.getComputedStyle) return false;
	try {
		const ox = String(window.getComputedStyle(el).overflowX || "").toLowerCase();
		return ox === "auto" || ox === "scroll" || ox === "hidden";
	} catch (e) { return false; }
}

function isVisible(el) {
	if (!el || !el.getBoundingClientRect) return false;
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0;
}

/**
 * 定位「原生对话应用根」——**不使用宿主 hash 类名**（`RWZidW_*` 会随宿主构建变化）。
 *
 * 判据（语义定位，三步）：
 *   ① 锚点优先级：**对话编辑器**（`textarea[placeholder="给智能体发消息"]`）
 *      → **tab 环**（`<button>` 且 `y < 90`、宽 < 60、文本 ≤ 3 字）
 *      → 任一可见 `<textarea>`
 *   ② 自锚点**向上**找第一个（最深）满足「应用根」判据的祖先
 *   ③ 返回它；找不到返回 `null`（调用方须优雅降级，不得硬塞标记）
 *
 * ── 🔴 两条真机踩坑（本轮实测，docs/11 §八 E-SPLIT-001/002）──────────
 *   E-SPLIT-001  **未排除插件自身** ⇒ ① 步扫全页 `<button>` 时，插件标题栏按钮
 *     （`⇤` `⇥` `–` `▢` `✕`，y=8 / w=24 / 文本 1 字）先于宿主 tab 环命中，
 *     于是 `findChatRoot()` 返回**插件自己的面板** `.d-panel`，
 *     分屏把 `padding-left` 加到自己头上 —— 右栏「完全一致」全程是假的。
 *   E-SPLIT-002  **兜底锚点用 `input[type=text]`** ⇒ 命中侧栏**搜索框**
 *     （`.PKekiq_search`），向上爬到 `.aFw_Oq_root`（280×816）——
 *     尺寸恰好也满足「应用根」判据 ⇒ 把**侧栏**当成对话根。
 *     修正：兜底只用 `<textarea>`（对话编辑器是 textarea，侧栏搜索是 input）。
 *     另加宽度下限 `> 40% 视口宽`（侧栏 280/1442=19% ⇒ 被拒）。
 *
 * ── 🔴 硬约束：不选滚动容器（真机逐层实测 `scripts/_probe-pad.mjs`）──────
 *   | 候选 | padding 后 `.composerSeat` | 横向溢出 |
 *   |:--|:--|:--|
 *   | `RWZidW_scrollBody` | x 280→580, w 1154→854 | ❌ `overflowX=true` |
 *   | `RWZidW_root` | x 280→580, w 1154→854 | ✅ 无 |
 *   | `OrjXgq_centerSurface` | 同上 | ✅ 无 |
 *   | `OrjXgq_centerCol` | 同上 | ✅ 无 |
 *   四者视觉结果一致，但滚动容器挂 padding 会让**可滚区域内**多出 300px
 *   ⇒ 出现横向滚动条。故跳过 `overflow-x ∈ {auto,scroll,hidden}` 的祖先。
 *   取「最深的合法祖先」而非「最外层」：更外层可能是同时含**侧栏**的容器
 *   （本轮 `.OrjXgq_frame` 1442 宽，靠 `width < 0.98vw` 拒绝）。
 *
 * @returns {HTMLElement|null}
 */
export function findChatRoot() {
	if (!hasDom()) return null;
	const vh = window.innerHeight || 800;
	const vw = window.innerWidth || 1440;
	const isAppLike = (el) => {
		if (!el || el === document.body || el === document.documentElement) return false;
		if (isPluginNode(el)) return false;                                  // ① 绝不选插件自身
		const r = el.getBoundingClientRect();
		if (!(r.height >= vh * 0.9 && r.width > vw * 0.4 && r.width < vw * 0.98)) return false;
		if (isScrollContainer(el)) return false;                              // ② 绝不选滚动容器
		return true;
	};

	// ① 锚点（插件自身一律排除；兜底只用 textarea）
	let anchor = null;
	for (const t of document.querySelectorAll("textarea")) {
		if (isPluginNode(t)) continue;
		if (t.placeholder === CHAT_COMPOSER_PLACEHOLDER && isVisible(t)) { anchor = t; break; }
	}
	if (!anchor) {
		for (const btn of document.querySelectorAll("button")) {
			if (isPluginNode(btn)) continue;
			const r = btn.getBoundingClientRect();
			if (r.y >= 0 && r.y < 90 && r.width > 0 && r.width < 60) {
				const t = (btn.textContent || "").trim();
				if (t.length > 0 && t.length <= 3) { anchor = btn; break; }
			}
		}
	}
	if (!anchor) {
		for (const t of document.querySelectorAll("textarea")) {
			if (isPluginNode(t)) continue;
			if (isVisible(t)) { anchor = t; break; }
		}
	}
	if (!anchor) return null;

	// ② 取最深的合法祖先
	let el = anchor.parentElement;
	while (el && el !== document.body) {
		if (isAppLike(el)) return el;
		el = el.parentElement;
	}
	return null;
}

/** 应用根的位置尺寸（弹窗据此对齐；返回 null 表示未找到） */
export function getSplitRootRect() {
	const root = findChatRoot();
	if (!root) return null;
	const r = root.getBoundingClientRect();
	return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) };
}

/**
 * 构造样式文本（**纯函数**，便于离线断言）
 *
 * 只做一件事：把原生应用根向右挤 `paddingLeft` px。
 * 折叠态（`collapsed`）不加额外规则 —— 排布完全由父组件算出的 `paddingLeft` 决定
 * （右栏折叠 = paddingLeft 推到 `宽-40`，原生内容自然成为右侧 40px 竖条）。
 * 保持"样式文本是 paddingLeft 的单值函数"这一性质，离线断言才好写。
 *
 * @param {number} paddingLeft
 * @returns {string}
 */
export function buildSplitCss(paddingLeft) {
	const pad = Math.max(0, Math.round(Number(paddingLeft) || 0));
	return [
		`[${ROOT_ATTR}]{`,
		`padding-left:${pad}px !important;`,
		`box-sizing:border-box !important;`,
		`transition:padding-left .14s ease;`,
		`}`
	].join("");
}

/** 当前分屏状态（同步可读；`window.__dshSplit` 亦暴露） */
let state = {
	active: false,
	rootMarked: false,
	paddingLeft: 0,
	collapsed: null,
	updatedAt: 0
};

export function getSplitState() {
	return { ...state };
}

/**
 * 应用分屏（幂等）
 * @param {object} opts
 * @param {number} opts.paddingLeft 原生内容左侧留白（= 左栏占宽）
 * @param {"none"|"left"|"right"|"both"|null} [opts.collapsed] 折叠态，仅用于样式分支
 * @returns {{ok:boolean, reason?:string, root?:HTMLElement}}
 */
export function applySplit(opts = {}) {
	if (!hasDom()) return { ok: false, reason: "no-dom" };
	try {
		const root = findChatRoot();
		if (!root) return { ok: false, reason: "chat-root-not-found" };
		// 🔴 兜底护栏：宁可不分屏，也绝不把自己的面板当成宿主（E-SPLIT-001）
		if (isPluginNode(root)) return { ok: false, reason: "plugin-node" };
		const pad = Math.max(0, Math.round(Number(opts.paddingLeft) || 0));
		const collapsed = opts.collapsed || null;

		// ① 标记应用根（属性可逆，且不改 style 属性）
		root.setAttribute(ROOT_ATTR, "1");
		if (collapsed) root.setAttribute(STATE_ATTR, collapsed);
		else root.removeAttribute(STATE_ATTR);

		// ② 标记内容区（供后续装饰/折叠使用；只打属性，不动节点）
		const contentRoot = root.querySelector("header") ? root : null;
		if (contentRoot) contentRoot.setAttribute("data-dsh-split-host", "1");

		// ③ 注入/更新样式（单一样式节点，幂等）
		let style = document.getElementById(SPLIT_STYLE_ID);
		if (!style) {
			style = document.createElement("style");
			style.id = SPLIT_STYLE_ID;
			document.head.appendChild(style);
		}
		style.textContent = buildSplitCss(pad);
		state = { active: true, rootMarked: true, paddingLeft: pad, collapsed, updatedAt: Date.now() };
		if (typeof window !== "undefined") window.__dshSplit = getSplitState();
		return { ok: true, root, paddingLeft: pad };
	} catch (e) {
		// 🔴 finally 兜底：任何异常都不能让样式残留在页面里
		clearSplit();
		return { ok: false, reason: "error:" + (e && e.message) };
	}
}

/**
 * 撤销分屏（**完全可逆**）
 * 移除样式节点 + 移除全部 `data-*` 标记；不触碰任何原生节点、不触碰原生 style 属性。
 * @returns {{ok:boolean, removedStyle:boolean, clearedAttrs:number}}
 */
export function clearSplit() {
	if (!hasDom()) return { ok: false, removedStyle: false, clearedAttrs: 0 };
	let clearedAttrs = 0;
	let removedStyle = false;
	try {
		const style = document.getElementById(SPLIT_STYLE_ID);
		if (style) { style.remove(); removedStyle = true; }
		for (const attr of [ROOT_ATTR, STATE_ATTR, "data-dsh-split-host", "data-dsh-split-content"]) {
			let guard = 0;
			while (guard++ < 200) {
				const el = document.querySelector("[" + attr + "]");
				if (!el) break;
				el.removeAttribute(attr);
				clearedAttrs++;
			}
		}
	} catch (e) {
		// 移除失败也不能抛：调用方多为 UI 卸载路径
		dshLog("split", "clearSplit error: " + (e && e.message));
	}
	state = { active: false, rootMarked: false, paddingLeft: 0, collapsed: null, updatedAt: Date.now() };
	if (typeof window !== "undefined") window.__dshSplit = getSplitState();
	return { ok: true, removedStyle, clearedAttrs };
}

/** 分屏是否生效 */
export function isSplitActive() {
	return hasDom() && Boolean(document.getElementById(SPLIT_STYLE_ID));
}

/** 安装全局契约（调试与验证脚本用） */
export function installSplitApi() {
	if (!hasDom()) return null;
	window.__dshSplitApi = {
		SPLIT_STYLE_ID, ROOT_ATTR, STATE_ATTR, PLUGIN_UI_IDS, CHAT_COMPOSER_PLACEHOLDER,
		findChatRoot, isPluginNode, getSplitRootRect, buildSplitCss,
		applySplit, clearSplit, isSplitActive, getSplitState
	};
	window.__dshSplit = getSplitState();
	return window.__dshSplitApi;
}
