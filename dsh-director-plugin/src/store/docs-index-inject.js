/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：A13 + A14 DSH_DOCS_INDEX 注入壳（**剥离改造版**）
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js, logic/ledger.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/docs-index-inject.js — A13 + A14 DSH_DOCS_INDEX 注入壳（**剥离改造版**）
 *
 * 迁移源：
 *   - A13 注入壳：client.js 6538 ~ 6541（4 行）
 *       `// __DSH_DOCS_INDEX_START__`
 *       `const DSH_DOCS_INDEX = {...}`   ← A14，单行 541,312 B
 *       `// __DSH_DOCS_INDEX_END__`
 *       `if (typeof window !== "undefined") window.__dshDocsIndex = DSH_DOCS_INDEX;`
 *   - A14：client.js 6539，**541,312 字节单行常量**（占 client.js 36.6%）
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 剥离改造（T4）
 * ─────────────────────────────────────────────────────────────
 * 原实现把整个 docs/ 目录快照（90 篇文档**全文**）内联进编译产物。
 * 本模块改为**运行时按需加载**外部资源 `assets/docs-index.json`。
 *
 * 收益：宿主 client.js 立减 541,312 B（1,479,577 → ~938,265 B，-36.6%）。
 *
 * 全局契约（**必须保持接口形态不变**，宿主 2 处引用点依赖）：
 *   - `window.__dshDocsIndex` — 对象 `{generatedAt, version, docCount, tree, docs}`
 *     ・宿主 client.js:6541 挂载
 *     ・宿主 client.js:6583 读 `.generatedAt`（仅用于显示"索引未注入"占位）
 *     ・业务 client.js:6754-6755 读 `.docs`
 *
 * 加载策略（三级降级，任一成功即止）：
 *   ① 宿主已注入（window.__dshDocsIndex 已存在）→ 直接用，零开销
 *   ② fetch 同级 `assets/docs-index.json`（插件 bundle 随包分发）
 *   ③ 全部失败 → **不写 window**，宿主侧 `DSH_DOCS_INDEX.generatedAt` 判定
 *      走 `typeof` 守卫回落为 "索引未注入"，**与剥离前行为一致，不报错**
 */

/** 打包产物中本模块的目录（由构建期注入或运行时从 import.meta.url 推导） */
export const DOCS_INDEX_ASSET_PATH = "assets/docs-index.json";
/** 加载超时（ms） */
export const DOCS_INDEX_FETCH_TIMEOUT_MS = 10000;

let loaded = null;
let loading = null;

/** 同步读取已加载的索引（未加载则返回 null） */
export function getDocsIndexSync() {
	if (typeof window !== "undefined" && window.__dshDocsIndex) return window.__dshDocsIndex;
	return loaded;
}

/** 从外部资源加载 docs 索引（幂等，可并发调用共享同一 Promise） */
export function loadDocsIndex(baseUrl) {
	if (loaded) return Promise.resolve(loaded);
	if (loading) return loading;

	// ① 宿主已注入 → 直接采用
	if (typeof window !== "undefined" && window.__dshDocsIndex) {
		loaded = window.__dshDocsIndex;
		return Promise.resolve(loaded);
	}

	const url = new URL(DOCS_INDEX_ASSET_PATH, baseUrl || guessBaseUrl()).href;

	loading = (async () => {
		try {
			const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
			const timer = ctrl ? setTimeout(() => ctrl.abort(), DOCS_INDEX_FETCH_TIMEOUT_MS) : null;
			const resp = await fetch(url, { signal: ctrl ? ctrl.signal : undefined });
			if (timer !== null) clearTimeout(timer);
			if (!resp.ok) {
				if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs-index", "HTTP " + resp.status + " @ " + url);
				return null;
			}
			const data = await resp.json();
			loaded = data;
			if (typeof window !== "undefined") {
				window.__dshDocsIndex = data;
				if (window.__dshDebug) window.__dshDebug.log("docs-index", "已加载 " + (data.docCount || 0) + " 篇文档索引 @ " + (data.generatedAt || "?"));
			}
			return data;
		} catch (e) {
			if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs-index", "加载失败: " + (e && e.message ? e.message : String(e)));
			return null;
		} finally {
			loading = null;
		}
	})();

	return loading;
}

/**
 * 推导资源基准 URL。
 * 优先用本模块自身的 script URL（宿主路由为 `GET /plugins/<id>/client.js`），
 * 退回 `location.origin`。
 */
function guessBaseUrl() {
	try {
		if (typeof document !== "undefined" && document.currentScript && document.currentScript.src) {
			return new URL(".", document.currentScript.src).href;
		}
	} catch (e) {}
	try {
		if (typeof location !== "undefined") return new URL("plugins/dsh-director-plugin/", location.origin).href;
	} catch (e) {}
	return "/";
}
