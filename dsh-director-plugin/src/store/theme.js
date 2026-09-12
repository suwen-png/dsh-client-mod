/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：A12 V9-Design D-01 主题变量体系
 * 引用：—
 * 上游：client-entry.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/theme.js — A12 V9-Design D-01 主题变量体系
 *
 * 迁移源：client.js 6484 ~ 6537（54 行）
 *   区块标记：`// ========== V9-Design D-01: 主题变量体系 ==========`
 *
 * 职责：主题令牌集中定义 + localStorage 持久化 + CSS 变量注入 documentElement。
 *
 * ⚠️ 兼容约束（R5）：持久化 key `dsh-v9-theme` **必须原样保留**。
 * ⚠️ V9.5 桥接：`--dsh-bg0/bg1/--border` 桥接到 Harness 原生暗色令牌
 *    （`--dsw-alias-bg-base` / `--dsw-alias-border-l2`），使面板跟随原生主题。
 *    这些 CSS 变量名是宿主样式表的契约，**不可改名**。
 */

export const DSH_THEME_KEY = "dsh-v9-theme";
export const DSH_THEME_DEFAULTS = { ac: "#2f6feb", ac2: "#38bdf8", mem: "#a78bfa", density: 1 };

/** 十六进制 → rgba，alpha 由调用方给定；解析失败回落到默认蓝 */
export function dshHexSoft(hex, alpha) {
	try {
		const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
		if (!m) return "rgba(47,111,235,0.14)";
		const n = parseInt(m[1], 16);
		return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + alpha + ")";
	} catch (e) { return "rgba(47,111,235,0.14)"; }
}

export function dshLoadTheme() {
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DSH_THEME_KEY) : null;
		if (raw) return { ...DSH_THEME_DEFAULTS, ...JSON.parse(raw) };
	} catch (e) {}
	return { ...DSH_THEME_DEFAULTS };
}

export function dshApplyThemeVars(theme) {
	if (typeof document === "undefined") return;
	try {
		const r = document.documentElement.style;
		r.setProperty("--dsh-ac", theme.ac);
		r.setProperty("--dsh-ac-soft", dshHexSoft(theme.ac, 0.14));
		r.setProperty("--dsh-ac2", theme.ac2);
		r.setProperty("--dsh-mem", theme.mem);
		r.setProperty("--dsh-density", String(theme.density || 1));
		// V9.5: 面板底色/边框令牌桥接到 Harness 原生暗色令牌（a1/z-tab 通用，跟随原生主题）
		r.setProperty("--dsh-bg0", "var(--dsw-alias-bg-base)");
		r.setProperty("--dsh-bg1", "var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-base))");
		r.setProperty("--border", "var(--dsw-alias-border-l2)");
	} catch (e) {}
}

export const dshThemeStore = (function() {
	let theme = dshLoadTheme();
	const listeners = new Set();
	function notify(persist) {
		if (persist) { try { if (typeof localStorage !== "undefined") localStorage.setItem(DSH_THEME_KEY, JSON.stringify(theme)); } catch (e) {} }
		dshApplyThemeVars(theme);
		for (const fn of listeners) fn(theme);
	}
	return {
		getTheme: () => theme,
		subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
		setTheme: (patch) => { theme = { ...theme, ...patch }; notify(true); },
		reset: () => { theme = { ...DSH_THEME_DEFAULTS }; try { if (typeof localStorage !== "undefined") localStorage.removeItem(DSH_THEME_KEY); } catch (e) {} notify(false); }
	};
})();

if (typeof window !== "undefined") { window.__dshTheme = dshThemeStore; dshApplyThemeVars(dshThemeStore.getTheme()); }
