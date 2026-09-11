/**
 * util/bus.js — 层级数据变更事件总线（极简，零依赖）
 *
 * 为什么需要（🔴 实测缺陷，2026-09-12）
 *   面板组件在**插件启动时**即挂载并渲染首帧，而此时自动同步
 *   （`syncFromSource`，异步）**尚未完成**。组件拿到的是"同步前"的陈旧快照：
 *     实测现象：真机覆盖度已是 会话 8/8 · 文件夹 2/2 · 全局 1/1，
 *               面板却显示「⚠️ 存在未覆盖 · 会话 0/8 · 文件夹 0/2」，
 *               且树上只有「全局总管」一个节点。
 *   根因：缺少"数据已变更"的通知通道，组件首帧之后不再刷新。
 *
 * 用法
 *   数据写入方（sync / summarize / CRUD）：`emitHierarchyChange()`
 *   视图消费方（组件 / 浮层）      ：`onHierarchyChange(cb)` → 返回取消订阅函数
 */

const listeners = new Set();

/**
 * 订阅层级数据变更
 * @param {() => void} fn
 * @returns {() => void} 取消订阅
 */
export function onHierarchyChange(fn) {
	if (typeof fn !== "function") return () => {};
	listeners.add(fn);
	return () => { listeners.delete(fn); };
}

/** 广播层级数据变更（所有订阅者按注册顺序调用，单个抛错不影响其他） */
export function emitHierarchyChange() {
	for (const fn of Array.from(listeners)) {
		try { fn(); } catch (e) { /* 单个订阅者失败不影响其他 */ }
	}
}

/** 当前订阅数（调试/验证用） */
export function hierarchyListenerCount() {
	return listeners.size;
}
