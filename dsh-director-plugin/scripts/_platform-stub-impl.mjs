/**
 * _platform-stub-impl.mjs — 平台模块的最小可用替身（仅离线验证用）
 *
 * 只要能「被 import 且不改变被测行为」即可：
 *   - 组件**不渲染**（createRoot().render() 为 no-op），故 hooks 只需可调用；
 *   - `jsx` / `jsxs` / `createElement` 返回平凡对象，供产出的元素树计数；
 *   - `subscribe` 相关能力由被测 store 自身提供，与 React 无关。
 *
 * 🔴 本文件**不参与构建**（不在 build.mjs 的模块图内），也**不随插件分发**
 *    （package.json 的 files 只声明 lib/ / assets/ 等；scripts/ 不打包）。
 */

export const Fragment = Symbol.for("react.fragment");

/**
 * 🔴 必须提供 `Component`（2026-09-12 补）：
 *   产物里有 `class SafeLayer extends react.Component`（单层错误边界）。
 *   桩里缺这个基类 ⇒ `react.Component` 是 undefined ⇒ factory 立刻抛
 *   `Class extends value undefined is not a constructor or null` ⇒ 之后 44 项断言
 *   **全部级联失败**，报告读起来像「插件整个坏了」，其实只是测试桩少了一个基类。
 *   真机由真 React 提供，插件一直是正常的（同轮 verify-mindmap.mjs 真机 80/80 绿）。
 *   `PureComponent` 一并给出，避免下次换个基类再踩同一个坑。
 */
export class Component {
	constructor(props) { this.props = props || {}; this.state = {}; this.context = {}; }
	setState(partial) {
		const patch = typeof partial === "function" ? partial(this.state, this.props) : partial;
		this.state = Object.assign({}, this.state, patch || {});
	}
	forceUpdate() { /* no-op：离线不渲染 */ }
	render() { return null; }
}
export class PureComponent extends Component { }

export function createElement(type, props, ...children) {
	return { $$el: true, type, props: props || {}, children };
}
export const jsx = (type, props, key) => ({ $$el: true, type, props: props || {}, key });
export const jsxs = jsx;
export const jsxDEV = jsx;

export function useState(init) { return [typeof init === "function" ? init() : init, () => { }]; }
export function useEffect() { /* no-op（离线不渲染，不执行副作用） */ }
export function useLayoutEffect() { /* no-op */ }
export function useRef(v) { return { current: v === undefined ? null : v }; }
export function useMemo(fn) { return fn(); }
export function useCallback(fn) { return fn; }
export function useContext() { return {}; }
export function useReducer(_r, init) { return [typeof init === "function" ? init(init) : init, () => { }]; }
export function useSyncExternalStore(subscribe, getSnapshot) {
	void subscribe;
	return typeof getSnapshot === "function" ? getSnapshot() : undefined;
}
export function memo(c) { return c; }
export function forwardRef(c) { return c; }

export default {
	Fragment, Component, PureComponent, createElement, jsx, jsxs, jsxDEV,
	useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback,
	useContext, useReducer, useSyncExternalStore, memo, forwardRef
};

/** react-dom/client 替身（mount.js 以命名空间导入后直接调 createRoot） */
export function createRoot() {
	return {
		render(node) { this.__rendered = node; },
		unmount() { this.__unmounted = true; }
	};
}
export function hydrateRoot() { return createRoot(); }
