/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：「点击文件夹 / 项目 → 展示该层级总监」（要求 7 / 9）
 * 引用：要求 7/9
 * 上游：client-entry.js, mount.js
 * 下游：bridge/split.js, store/hierarchy.js, store/layout.js, util/debug.js, logic/nav-intent.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
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
/* 🔴 第 38 轮：判定"点侧栏会怎样"的**纯函数**搬到了 `logic/`。
 *    理由：留在本文件（bridge 层，带副作用）就只能靠真机验；而这条判据最容易写错
 *    （"该缩不缩 / 点了没反应"都是这一族）。搬走后**离线闸门与真机用同一份实现**。
 *    这里 `export` 一次，保持既有 `window.__dshNavApi.navIntent` 契约逐字不变。 */
import { navIntent } from "../logic/nav-intent.js";
export { navIntent };

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

			/* ── 固定态：**判据同源**的短路 ────────────────────────────────
			 *  用户原话「总监跳出来之后，我在点击左侧的对话，这个总监页面不会变化」。
			 *  🔴 这里**不另写** if (pinned) return —— 那样会变成"两处判据"：
			 *     一处 `navIntent`、一处短路，日后改一处必然漏另一处（纪律 126 同族）。
			 *     改为**先问 navIntent，再由它决定**；`pinned` 为真时它返回 `hold`，
			 *     于是连 `loadTree()` 都不必调用（省掉一次可能读盘的操作）。 */
			const pinnedNow = typeof directorLayoutStore.isDialogPinned === "function"
				&& directorLayoutStore.isDialogPinned();
			if (navIntent({ pinned: pinnedNow }) === "hold") { navHookStats.held++; return; }

			const { text } = extractRowText(e.target);
			const openNow = typeof directorLayoutStore.isDialogOpen === "function"
				&& directorLayoutStore.isDialogOpen();
			/* 取不到行文本（点到侧栏空隙）⇒ 不读树，直接按"无命中"判 */
			const tree = text ? await loadTree() : null;
			const hit = text ? matchRowToNode(text, flattenTree(tree)) : null;

			const intent = navIntent({
				pinned: pinnedNow, hasMatch: Boolean(hit),
				level: hit ? hit.level : "", dialogOpen: openNow
			});

			if (intent === "refresh") {
				navHookStats.matched++;
				navHookStats.lastMatch = { text, nodeId: hit.id, name: hit.name, level: hit.level, intent };
				directorLayoutStore.setActiveNode(hit.id);
				directorLayoutStore.setDialogOpen(true);
				// 刷新作用域的同时**解除缩回** —— 点文件夹的语义是"我要看这个文件夹"
				directorLayoutStore.setDialogCollapsed(false);
				dshLog("nav", "侧栏点击 → 打开总监：" + hit.name + "（" + hit.level + "）");
				return;
			}

			if (intent === "collapse") {
				navHookStats.collapsed++;
				navHookStats.lastCollapse = { text, nodeId: hit ? hit.id : "", reason: hit ? "session" : "no-match" };
				directorLayoutStore.setDialogCollapsed(true);
				dshLog("nav", "侧栏点击对话 → 总监缩回" + (hit ? "（" + hit.name + "）" : "（无匹配行）"));
				return;
			}
			// intent === "none"：弹窗本来就没开 ⇒ 什么都不做，**绝不误开**（保持原三级匹配策略的克制）
		} catch (err) {
			navHookStats.errors++;
		}
	};

	document.addEventListener("pointerdown", onClick, true);
	if (typeof window !== "undefined") window.__dshNavHook = navHookStats;
	return () => { disposed = true; document.removeEventListener("pointerdown", onClick, true); };
}

/** 统计（供验证脚本断言"真的命中过"） */
export const navHookStats = { matched: 0, collapsed: 0, held: 0, errors: 0, lastMatch: null, lastCollapse: null };

/** 安装全局契约 */
export function installNavHookApi() {
	if (!hasDom()) return null;
	window.__dshNavApi = {
		extractRowText, flattenTree, matchRowToNode, navIntent, installNavHook, navHookStats,
		/* 第 38 轮：给真机套件一个**免猜测**的固定态读写口（不是新功能，是让闸门能设前提） */
		setPinned: (v) => directorLayoutStore.setDialogPinned(v),
		isPinned: () => Boolean(directorLayoutStore.isDialogPinned && directorLayoutStore.isDialogPinned())
	};
	return window.__dshNavApi;
}
