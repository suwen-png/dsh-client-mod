/**
 * lib/index.js — host face（cordis 插件）
 *
 * 契约来源（实测）：resources/host/node_modules/@fufan/dsh-plugin-llm-wiki/lib/index.js
 *   export const inject = [...];   // 依赖的 host 服务
 *   export function apply(ctx) {}  // 装配入口
 *
 * 本插件是**纯 client 插件**（总监驾驶舱 UI + 浏览器侧持久化），
 * host 侧无需提供服务，故：
 *   - inject 为空数组
 *   - apply 为 no-op，仅做一次加载留痕（便于日志确认通道打通）
 *
 * 为什么仍需要 host face：
 *   loader entry 是 host Loader 扫描本包的入口锚点。提供最小 host face 可确保
 *   本包进入 plugin-set，进而其 client bundle 被 dsh-client-modules 接入 boot graph。
 */

export const name = "@deepseek-ai/dsh-director-plugin";

/** host 侧无依赖服务 */
export const inject = [];

/**
 * 装配本插件的 host face（no-op）。
 * @param {object} ctx cordis 上下文
 */
export function apply(ctx) {
	// 仅留痕：确认 host 侧通道已打通。client face 的装配在 lib/client.js 中完成。
	try {
		ctx?.logger?.("plugin")?.info?.("[dsh-director-plugin] host face loaded");
	} catch {
		/* 日志通道不可用时静默 —— 不影响插件功能 */
	}
}
