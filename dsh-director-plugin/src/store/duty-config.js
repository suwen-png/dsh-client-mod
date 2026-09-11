/**
 * store/duty-config.js — 职责三级继承（03号文 §3.2「继承制」）
 *
 * 依据：`docs/20-任务文档/03-总监对话模式开发文档.md` §3.2（:150-165）
 * ```
 * 默认配置（全局一套）
 *     ↓ 继承
 * 项目级配置（可单独修改，覆盖默认）
 *     ↓ 继承
 * 会话级配置（可单独修改，覆盖项目级）
 *     ↑ 可向上提交
 * 会话中修改可「提交到项目」/「提交到全局」覆盖上层
 * ```
 *
 * 设计要点
 * 1. **逐项继承**：继承粒度是「单个职责」而非整个配置对象 ——
 *    会话可只覆盖「整理语言」，其余四项仍继承项目级。
 *    （复用 `hierarchy.js#getBreadcrumb` 构建链，避免重复遍历）
 * 2. **来源可溯源**：每项返回 `origin`，UI 直接显示「继承/本层/项目级」。
 * 3. **向上提交**：把本节点**解析后的生效配置**写到父节点（可再往上到全局）。
 * 4. **恢复继承**：清空本节点 `duties`，重新完全继承。
 *
 * ⚠️ 写操作后必须回读校验（执行标准 §3.4）：`saveNode()` 返回成功 ≠ 落库正确。
 */

import { getNode, saveNode, getBreadcrumb, GLOBAL_NODE_ID } from "./hierarchy.js";
import { DUTY_KEYS, cloneDefaultDuties, normalizeDuties, readOwnDuties } from "../logic/duties.js";
import { dshLog } from "../util/debug.js";

/** 来源层级标签 */
export const ORIGIN = {
	DEFAULT: "default", // 无任何节点配置 → 文档默认值
	GLOBAL: "global",
	PROJECT: "project",
	SESSION: "session",
	OWN: "own" // 本层显式配置
};

const LEVEL_TO_ORIGIN = { global: ORIGIN.GLOBAL, project: ORIGIN.PROJECT, session: ORIGIN.SESSION };

/**
 * 解析某节点**生效**的职责配置（自顶向下逐项覆盖 —— 越靠近本节点优先级越高）
 *
 * @param {string} nodeId
 * @returns {Promise<{duties: object, origin: Record<string,string>, own: object|null, chain: Array}>}
 *          duties  生效配置
 *          origin  每项来源（"default" | "global" | "project" | "session" | "own"）
 *          own     本节点自身配置（null = 完全继承）
 *          chain   继承链（根 → 本节点），供 UI 展示
 */
export async function resolveDuties(nodeId) {
	const chain = await getBreadcrumb(nodeId || GLOBAL_NODE_ID);
	// 根 → 本节点；链为空（节点不存在）时退化为纯默认
	const duties = cloneDefaultDuties();
	const origin = Object.fromEntries(DUTY_KEYS.map((k) => [k, ORIGIN.DEFAULT]));

	for (const link of chain) {
		// getBreadcrumb 只返回 {id,name,level} —— 需取完整节点拿 duties
		const node = await getNode(link.id);
		const own = readOwnDuties(node);
		if (!own) continue;
		for (const k of DUTY_KEYS) {
			duties[k] = { ...duties[k], ...own[k] };
			origin[k] = link.id === nodeId ? ORIGIN.OWN : (LEVEL_TO_ORIGIN[link.level] || ORIGIN.OWN);
		}
	}

	const self = await getNode(nodeId);
	return { duties, origin, own: readOwnDuties(self), chain };
}

/**
 * 写入本节点职责配置（覆盖模式）
 * @param {string} nodeId
 * @param {object} duties 职责表（会被 normalizeDuties 归一化）
 * @returns {Promise<object>} 回读后的节点（§3.4 写后回读）
 */
export async function setOwnDuties(nodeId, duties) {
	const node = await getNode(nodeId);
	if (!node) throw new Error("节点不存在: " + nodeId);
	node.duties = normalizeDuties(duties);
	await saveNode(node);
	const back = await getNode(nodeId); // 🔴 回读校验
	if (!back || !back.duties) {
		dshLog("duty", "写后回读失败: nodeId=" + nodeId);
		throw new Error("职责配置写入未落库: " + nodeId);
	}
	return back;
}

/** 恢复继承：清空本节点自身职责配置 */
export async function clearOwnDuties(nodeId) {
	const node = await getNode(nodeId);
	if (!node) return null;
	delete node.duties;
	await saveNode(node);
	const back = await getNode(nodeId); // 🔴 回读校验
	if (back && back.duties) throw new Error("恢复继承未落库: " + nodeId);
	return back;
}

/**
 * 向上提交（§3.2「会话中修改可提交到项目 / 提交到全局」）
 * 把本节点**解析后的生效配置**写入父节点。
 *
 * @param {string} nodeId 来源节点
 * @param {number} [levels=1] 向上几层（1=项目级，2=全局级）
 * @returns {Promise<{target: object, duties: object}|null>} null = 已在根、无可提交
 */
export async function submitUp(nodeId, levels = 1) {
	const crumb = await getBreadcrumb(nodeId);
	const idx = crumb.length - 1 - levels;
	if (idx < 0) return null; // 已到顶
	const target = crumb[idx];
	if (!target || target.id === nodeId) return null;

	const { duties } = await resolveDuties(nodeId);
	const written = await setOwnDuties(target.id, duties);
	dshLog("duty", "向上提交: " + nodeId + " → " + target.id + " (" + target.name + ")");
	return { target: written, duties };
}

/** 安装全局契约（供 CDP 真机验证与控制台排查） */
export function installDutyApi() {
	if (typeof window === "undefined") return null;
	window.__dshDuties = {
		KEYS: DUTY_KEYS,
		DEFAULT: cloneDefaultDuties,
		resolve: resolveDuties,
		set: setOwnDuties,
		clear: clearOwnDuties,
		submitUp: submitUp
	};
	return window.__dshDuties;
}
