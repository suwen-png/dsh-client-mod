/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：内联样式的单位归一（**唯一真相源**）
 * 引用：—
 * 上游：bridge/host-composer-slot.js, bridge/host-director-column.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * util/dom-style.js — 内联样式的单位归一（**唯一真相源**）
 *
 * ── 🔴 为什么必须有这个模块（2026-09-14 真机取证）──────────────────
 *   CSSOM 对**无单位数字**是**静默丢弃**的：
 *     `el.style.width = 6`    ⇒ 不生效（应为 `"6px"`）
 *     `el.style.height = 18`  ⇒ 不生效
 *     `el.style.top = 3`      ⇒ 不生效
 *   例外（数字合法）：`0`、以及纯数值型属性 `zIndex` / `opacity` / `lineHeight` /
 *   `flexGrow` / `order` / `zoom` 等。
 *
 *   取证脚本：`scripts/_probe-v22-gaps.mjs`（真机）
 *   实测后果 —— 三处**"元素在 DOM 里、功能却没有"**的假象，全都**不报错**：
 *     · `#dsh-host-col-resizer` 宽 **0px** ⇒ 真实鼠标永远打不到 ⇒ 宽度拖不动（闸门 D1 红）
 *     · `#dsh-mem-height` 高 **0px**       ⇒ 同上 ⇒ 高度拖不动（闸门 E9 只能跳过）
 *     · `#dsh-host-col-min` 20×18 退化成文字撑出的 8×13，`top` 也丢了
 *   这类缺陷的形状特别坏：**闸门看得见"元素存在"**（存在性断言全绿），
 *   只有"真实鼠标命中测试"与几何对账才抓得到 ⇒ 与纪律 22 是同一个道理。
 *
 *   故：凡手写像素值，一律走 `pxOf()`，**不许**再直接往 `style` 里塞数字。
 *   本模块**零依赖、纯函数**，可离线单测。
 */

/** 需要补 `px` 的属性（camelCase，与 `style` 的键一致） */
export const PX_KEYS = Object.freeze(new Set([
	"top", "left", "right", "bottom", "width", "height",
	"minWidth", "maxWidth", "minHeight", "maxHeight",
	"marginTop", "marginRight", "marginBottom", "marginLeft",
	"paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
	"borderRadius",
	"borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
	"borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
	"gap", "rowGap", "columnGap",
	"fontSize", "letterSpacing", "textIndent", "outlineOffset", "inset"
]));

/**
 * 把样式对象里的数值型尺寸补成 `px` 字符串（其它值**原样**返回）。
 * @param {Object} [obj]
 * @returns {Object} 新对象（不改入参 —— 便于断言「输入没被改」）
 */
export function pxOf(obj) {
	const out = {};
	if (!obj || typeof obj !== "object") return out;
	try {
		for (const k in obj) {
			const v = obj[k];
			/* `0` 不必补（CSS 里 0 无单位合法），但补上也合法 ⇒ 统一补，减少分支 */
			out[k] = (typeof v === "number" && PX_KEYS.has(k)) ? v + "px" : v;
		}
	} catch (e) { return obj; }
	return out;
}

/**
 * 一步到位：把（可选的）基础样式与（可选的）覆盖样式一起写进元素。
 * 覆盖在后 ⇒ 与 `Object.assign` 的语义一致。
 * @param {HTMLElement} el
 * @param {Object} [base]
 * @param {Object} [extra]
 * @returns {boolean} 写成功
 */
export function applyStyle(el, base, extra) {
	if (!el || !el.style) return false;
	try {
		Object.assign(el.style, pxOf(base), extra ? pxOf(extra) : {});
		return true;
	} catch (e) { return false; }
}
