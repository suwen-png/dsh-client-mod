/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 引用：—
 * 上游：client-entry.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 E8（Windows 标题栏拖拽带穿透：可交互元素必须 no-drag）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * 桌面壳「窗口拖拽带」穿透 —— 把可交互元素从 OS caption area 里救出来
 *
 * ── 这份文件在整体里的位置 ───────────────────────────────────────────────
 *   由 `client-entry.js` 在 boot 时调用一次（幂等）。
 *   解决的问题**只存在于桌面壳**，浏览器里完全不复现。
 *
 * 🔴 现象（用户连续反馈三次的那件事）
 *   设计图工作室铺满整个窗口 ⇒ 顶栏（CSS y ≈ 7~33）整条落在
 *   **Windows 的 caption area**（本机 `navigator.windowControlsOverlay
 *   .getTitlebarAreaRect().height` = 44）里。
 *   鼠标落在该带内，系统返回 `HTCAPTION`，消息被当作**拖动窗口**处理，
 *   **渲染进程永远收不到** —— 保存/改名/新建图/复制/重载框架/导出/删除/
 *   版本/缩放 全部点不动，**连 mousemove 都进不来**。
 *
 * 🔴 为什么此前所有闸门都是绿的（2026-09-12 实测）
 *   · CDP `Input.dispatchMouseEvent` **直接注入渲染进程**，绕过窗口消息循环
 *     ⇒ 它看不见这个拦截，反而一路报绿；
 *   · `document.elementsFromPoint()` 只会说"没遮挡"（DOM 层确实没遮挡）。
 *   ⇒ 静态闸门 / 离线单测 / CDP e2e **原理上**都测不到这一类故障。
 *   ⇒ 唯一判据是 **OS 级真实鼠标**：`python scripts/_osm.py click <物理x> <物理y>`。
 *
 * 🔴 修复依据（宿主自己早就踩过）
 *   宿主样式表里有 `.Y4b3va_topbar => drag` 与
 *   `.Y4b3va_topbar button => no-drag` 成对出现 ——
 *   **拖拽区里的可交互元素必须显式 no-drag**，否则永远点不到。
 *
 * 设计取舍：**只给可交互元素加 no-drag，容器保持默认**。
 *   这样顶栏的空白处仍然可以拖动窗口（符合"标题栏"的直觉），
 *   而不是把整个铺满的工作室变成一块拖不动的死板。
 */
const STYLE_ID = "dsh-no-drag-style";

/** 选择器：插件自有容器（id 以 `dsh-` 开头）内的所有可交互元素 */
export const NO_DRAG_SELECTOR = [
	'[id^="dsh-"] button',
	'[id^="dsh-"] input',
	'[id^="dsh-"] select',
	'[id^="dsh-"] textarea',
	'[id^="dsh-"] a',
	'[id^="dsh-"] [role="button"]'
].join(",");

/** 规则正文（普通字符串 —— 构建器对模板字符串有反引号限制，这里刻意不用） */
export const NO_DRAG_RULE =
	NO_DRAG_SELECTOR + "{-webkit-app-region:no-drag !important;}";

/**
 * 注入（或刷新）no-drag 样式。幂等：重复调用只更新同一个 style 节点。
 * @returns {boolean} 是否注入成功（无 document 时返回 false，浏览器里也安全）
 */
export function installNoDrag() {
	try {
		if (typeof document === "undefined" || !document) return false;
		let el = document.getElementById(STYLE_ID);
		if (!el) {
			el = document.createElement("style");
			el.id = STYLE_ID;
			el.setAttribute("data-dsh-purpose", "no-drag:escape-window-caption-area");
			(document.head || document.documentElement).appendChild(el);
		}
		if (el.textContent !== NO_DRAG_RULE) el.textContent = NO_DRAG_RULE;
		return true;
	} catch (e) {
		return false;
	}
}

export default installNoDrag;
