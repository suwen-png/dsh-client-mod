/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：窗口控件安全区（Windows 原生标题栏按钮的避让计算）
 * 引用：2026-09-12 诉求 9（关闭按钮与标准软件关闭按钮重叠）
 * 上游：components/DesignStudio.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 E5（窗口控件安全区三级读取）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * util/safe-area.js — 窗口控件安全区（Windows 原生标题栏按钮的避让计算）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 D1 · 顶栏】
 *  被谁用   components/DesignStudio.js（全屏工作室顶栏 padding-right）
 *  解决什么 用户报「设计图的关闭按钮和标准软件的关闭按钮重叠了」
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么它必须存在（真机取证，不是猜的）
 * ══════════════════════════════════════════════════════════════════
 *  Harness 桌面端是**自绘标题栏 + 原生窗口控件覆盖层**。实测（1536×816 视口）：
 *
 *      navigator.windowControlsOverlay.visible = true
 *      getTitlebarAreaRect() = { x:0, y:0, w:1399, h:44 }
 *      ⇒ 右侧 1536 - 1399 = 137px 被**最小化/最大化/关闭**三个按钮独占
 *
 *  这个覆盖层是**原生图层，永远绘制在网页内容之上**（z-index 无效）。
 *  而工作室是 `position:fixed; inset:0` 的全屏层，顶栏内容直排到右边距 10px
 *  ⇒ 关掉按钮 `✕`（实测位于 x=1495，距右仅 41px）**必然被压住**，
 *     连状态文字「修订记录 2」也被压掉一截。
 *
 *  ⇒ 结论：**不是"把 ✕ 左移几像素"能解决的**，那是把 137px 的洞挪个位置。
 *     正确做法是让顶栏知道"右边这一条不归我"，把内容整体收进安全区。
 *
 * ══════════════════════════════════════════════════════════════════
 *  三级读取（从准到糙，逐级降级；都不命中时**返回 0 而不是瞎留白**）
 * ══════════════════════════════════════════════════════════════════
 *   ① Window Controls Overlay API —— 权威值，且能监听 `geometrychange`
 *   ② CSS `env(titlebar-area-width)` —— 同一数据的 CSS 侧投影
 *   ③ 桌面平台兜底常量 —— 仅当"确认是桌面壳"但前两级都读不到时启用
 *
 *  ⚠️ 为什么普通浏览器里要返回 0：浏览器没有原生窗口控件覆盖层，
 *     若也返回 138，工作室右侧会凭空多出一条空白 —— 那是把 bug 换成另一个 bug。
 */

/** Windows 三个窗口按钮的实测总宽（46×3）。只在确认桌面壳、且 API 全失效时用。 */
export const FALLBACK_INSET = 138;

/** 是否运行在桌面壳里（判断依据是 URL 参数与 UA，二者取或） */
function isDesktopShell() {
	try {
		if (typeof location !== "undefined" && /dsh-desktop-platform=/.test(String(location.search || ""))) return true;
		if (typeof navigator !== "undefined" && /Electron/i.test(String(navigator.userAgent || ""))) return true;
	} catch (e) { /* 无 location/navigator（离线测试）→ 视为非桌面 */ }
	return false;
}

/**
 * 读取"右侧不可用宽度"（px）。
 * @param {object} [win] 可注入的 window（离线测试用；缺省用全局）
 * @returns {number} 0 = 无窗口控件覆盖（浏览器 / 已隐藏）；>0 = 需要避让的像素
 */
export function readInset(win) {
	const w = win || (typeof window !== "undefined" ? window : null);
	const d = w && w.document ? w.document : (typeof document !== "undefined" ? document : null);

	/* ① 权威 API。注意 `visible=false` 时**必须返回 0** ——
	 *    有些平台 API 存在但覆盖层被隐藏（如 macOS 的交通灯），此时不占宽度。 */
	try {
		const wco = w && w.navigator ? w.navigator.windowControlsOverlay : null;
		if (wco) {
			if (wco.visible === false) return 0;
			if (typeof wco.getTitlebarAreaRect === "function") {
				const r = wco.getTitlebarAreaRect();
				if (r && r.width > 0 && w.innerWidth > 0) {
					return Math.max(0, Math.round(w.innerWidth - r.width));
				}
			}
		}
	} catch (e) { /* 继续降级 */ }

	/* ② CSS env() 投影。`-1px` 作为 fallback ⇒ 不支持时量到负数，天然识别"不支持"。 */
	try {
		if (d && d.body) {
			const probe = d.createElement("div");
			probe.style.cssText = "position:fixed;top:0;left:0;height:1px;visibility:hidden;pointer-events:none;width:env(titlebar-area-width, -1px)";
			d.body.appendChild(probe);
			const pw = probe.getBoundingClientRect().width;
			probe.remove();
			if (pw > 0 && w.innerWidth > 0) return Math.max(0, Math.round(w.innerWidth - pw));
		}
	} catch (e) { /* 继续降级 */ }

	/* ③ 桌面兜底 —— 宁可多留 138px，也不要让按钮压在原生控件下面（前者是空间浪费，后者是功能失效） */
	return isDesktopShell() ? FALLBACK_INSET : 0;
}

/**
 * 监听安全区变化（窗口缩放 / 最大化 / 全屏切换都会改它）。
 * @param {(inset:number)=>void} onChange 仅在**值真的变了**时回调（避免 resize 风暴里反复 setState）
 * @param {object} [win]
 * @returns {()=>void} 取消监听
 */
export function watchInset(onChange, win) {
	const w = win || (typeof window !== "undefined" ? window : null);
	if (!w || typeof onChange !== "function") return () => { /* noop */ };

	let last = -1;
	const emit = () => {
		const v = readInset(w);
		if (v !== last) { last = v; onChange(v); }
	};

	emit();
	w.addEventListener("resize", emit);
	// WCO 专属事件：最大化/退出全屏时**不一定**触发 window.resize，必须单独挂
	let wco = null;
	try {
		wco = w.navigator ? w.navigator.windowControlsOverlay : null;
		if (wco && typeof wco.addEventListener === "function") wco.addEventListener("geometrychange", emit);
	} catch (e) { wco = null; }

	// 布局late后才定下来的情形（首帧 innerWidth 为 0 等），补测一次
	const t = setTimeout(emit, 350);

	return () => {
		try { w.removeEventListener("resize", emit); } catch (e) { /* noop */ }
		try { if (wco && typeof wco.removeEventListener === "function") wco.removeEventListener("geometrychange", emit); } catch (e) { /* noop */ }
		clearTimeout(t);
	};
}
