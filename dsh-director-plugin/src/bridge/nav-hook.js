/**
 * bridge/nav-hook.js — 「点击文件夹 / 项目 → 展示该层级总监」（要求 7 / 9）
 *
 * ── 为什么用"观察 + 名称匹配"而不是给侧栏挂事件 ────────────────
 *   左侧栏由宿主渲染（React 管理其子树）。**给宿主节点挂监听器会把一个外部函数
 *   写进宿主的节点对象**，宿主重渲染后节点被替换 ⇒ 监听器静默消失（且无法察觉）。
 *   故改为：在 `document` **捕获阶段**观察点击 —— 零节点改动、零宿主依赖、天然幂等。
 *
 * ── 匹配策略（三级，全部可解释）────────────────────────────────
 *   ① 精确同名（`node.name === rowText`）
 *   ② 包含匹配（`rowText` 含 `node.name`，或反之；取**最长**匹配，避免"工作区 A"命中"工作区"）
 *   ③ 无匹配 → **不打开**（保持宿主原本的导航行为，绝不误弹）
 *
 * ── 不侵入原则 ──────────────────────────────────────────────────
 *   `pointerdown` 只读、不 `preventDefault`、不 `stopPropagation`
 *   ⇒ 侧栏的原有导航/展开/折叠行为**完全不受影响**，总监弹窗是"伴随打开"。
 *
 * ── 判定"侧栏区域" ─────────────────────────────────────────────
 *   用聊天应用根的左边界 `x` 作为分界：`clientX < rootRect.x` 即侧栏区。
 *   该边界随窗口/侧栏折叠自动跟随，无需硬编码布局常量。
 */

import { getSplitRootRect } from "./split.js";
import { loadTree } from "../store/hierarchy.js";
import { directorLayoutStore } from "../store/layout.js";
import { dshLog } from "../util/debug.js";

const hasDom = () => typeof window !== "undefined" && typeof document !== "undefined";

/** 行文本长度上限（超过说明抓到了容器而非单行） */
const ROW_TEXT_MAX = 60;

/** 从点击目标向上找一个"行"元素并取其文本 */
export function extractRowText(target) {
	let el = target;
	for (let i = 0; i < 5 && el && el !== document.body; i++) {
		const t = String(el.textContent || "").replace(/\s+/g, " ").trim();
		if (t && t.length <= ROW_TEXT_MAX) return { text: t, el };
		el = el.parentElement;
	}
	return { text: "", el: null };
}

/** 拍平层级树为候选列表 */
export function flattenTree(root) {
	const out = [];
	const walk = (n, depth) => {
		out.push({ id: n.id, name: String(n.name || ""), level: n.level, depth });
		(n.childNodes || []).forEach((c) => walk(c, depth + 1));
	};
	if (root) walk(root, 0);
	return out;
}

/**
 * 名称匹配（纯函数，便于离线断言）
 * @returns {{id:string,name:string,level:string}|null}
 */
export function matchRowToNode(rowText, nodes) {
	const text = String(rowText || "").trim();
	if (!text) return null;
	// ① 精确
	const exact = (nodes || []).find((n) => n.name === text);
	if (exact) return exact;
	// ② 包含（取最长匹配；长度 <2 的名称不参与，避免噪声）
	let best = null;
	for (const n of nodes || []) {
		if (!n.name || n.name.length < 2) continue;
		if (text.indexOf(n.name) >= 0 || n.name.indexOf(text) >= 0) {
			if (!best || n.name.length > best.name.length) best = n;
		}
	}
	return best;
}

/**
 * 安装侧栏导航联动
 * @param {object} [opts]
 * @param {() => boolean} [opts.enabled] 动态开关（默认常开）
 * @returns {() => void} 卸载函数
 */
export function installNavHook(opts = {}) {
	if (!hasDom()) return () => {};
	const enabled = opts.enabled || (() => true);
	let disposed = false;

	const onClick = async (e) => {
		try {
			if (disposed || !enabled()) return;
			const rect = getSplitRootRect();
			if (!rect) return;
			// 只在"侧栏区域"响应，且排除总监弹窗自身
			if (e.clientX >= rect.x) return;
			if (e.target && e.target.closest && e.target.closest("#dsh-director-dialog")) return;
			if (e.clientX < 0 || e.clientX > (window.innerWidth || 1440)) return;

			const { text } = extractRowText(e.target);
			if (!text) return;
			const tree = await loadTree();
			const hit = matchRowToNode(text, flattenTree(tree));
			if (!hit) return; // ③ 无匹配 → 不打扰宿主导航
			navHookStats.matched++;
			navHookStats.lastMatch = { text, nodeId: hit.id, name: hit.name, level: hit.level };
			directorLayoutStore.setActiveNode(hit.id);
			directorLayoutStore.setDialogOpen(true);
			dshLog("nav", "侧栏点击 → 打开总监：" + hit.name + "（" + hit.level + "）");
		} catch (err) {
			navHookStats.errors++;
		}
	};

	document.addEventListener("pointerdown", onClick, true);
	if (typeof window !== "undefined") window.__dshNavHook = navHookStats;
	return () => { disposed = true; document.removeEventListener("pointerdown", onClick, true); };
}

/** 统计（供验证脚本断言"真的命中过"） */
export const navHookStats = { matched: 0, errors: 0, lastMatch: null };

/** 安装全局契约 */
export function installNavHookApi() {
	if (!hasDom()) return null;
	window.__dshNavApi = { extractRowText, flattenTree, matchRowToNode, installNavHook, navHookStats };
	return window.__dshNavApi;
}
