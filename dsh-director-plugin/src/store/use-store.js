/**
 * store/use-store.js — A10 `useDirectorStore` React hook 绑定
 *
 * 迁移源：client.js **6404 ~ 6407**（4 行）
 *
 * 宿主原实现（在同 realm 内、已实测可用）：
 *   ```js
 *   function useDirectorStore(store) {
 *     const subscribe = (0, react.useCallback)((fn) => store.subscribe(fn), [store]);
 *     return (0, react.useSyncExternalStore)(subscribe, store.getState, store.getState);
 *   }
 *   ```
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 平台模块 external 契约（ADR-001）
 * ─────────────────────────────────────────────────────────────────────────
 * `react` **必须 external**，由 bundle factory 的 `require` 提供，严禁打进产物
 * （否则产生第二个 React 实例 → hooks 失效 / 崩溃）。
 *
 * 权威依据：`@deepseek-ai/dsh-client-web/lib/index.js` 的 `getStaticModules()`
 * （第 165 行）返回的平台单例表**明确包含** `"react": React`：
 *   react / react/jsx-runtime / react-dom / react-dom/client / @deepseek-ai/cordis /
 *   dsh-client-ui-slots / dsh-client-web-react / dsh-client-ui-primitives /
 *   dsh-client-ui-attachment / dsh-client-schema-form
 *
 * 本模块是插件中**首个使用平台模块**的模块，故也是 bundler「平台外置」能力的
 * 首个使用者（`build/build.mjs` 会把它改写为 `require("react")`，
 * 并在构建日志的「平台外置」行列出）。
 *
 * 说明：`useSyncExternalStore` 需要 React ≥ 18。宿主原内联代码在同一 realm 内
 * 一直使用它并正常工作，故此处等价迁移无版本风险。
 */

import { useCallback, useSyncExternalStore } from "react";

/**
 * 把总监 store 绑成 React hook（宿主 6404-6407 等价迁移）。
 * @param {object} store `createDirectorStore` 产出的 store 实例
 * @returns {object} 当前 state（`store.getState()` 的返回值）
 */
export function useDirectorStore(store) {
	const subscribe = useCallback((fn) => store.subscribe(fn), [store]);
	return useSyncExternalStore(subscribe, store.getState, store.getState);
}

/**
 * 便捷变体：由 sessionId 直接取 store 并订阅（宿主无此形态，为本插件新增便利方法）。
 * ⚠️ 属**新增 API**，非迁移项；宿主侧调用点仍走 `useDirectorStore(store)`。
 * @param {(sessionId:string)=>object} factory 通常是 `directorStoreFactory`
 * @param {string} [sessionId]
 */
export function useDirectorStoreBySession(factory, sessionId) {
	const store = factory(sessionId);
	return useDirectorStore(store);
}
