/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：导图渲染派生（**纯函数，不依赖 React**）
 * 引用：—
 * 上游：components/MindMap.js
 * 下游：logic/branch-tree.js, store/mindmap-schema.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/mindmap-render.js — 导图渲染派生（**纯函数，不依赖 React**）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 F（思维导图元素库）】
 *  上游     components/MindMap.js（渲染层只做布局，不做几何与文案运算）
 *  下游     store/mindmap-schema.js（元素词汇表）· logic/branch-tree.js（LAYOUT）
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 为什么把这几行从组件里搬出来（不是洁癖，是**可测性**）
 * ══════════════════════════════════════════════════════════════════
 *  组件文件 import 了 `react`，而 react 是**平台外置模块**（ADR-001，不进 bundle、
 *  Node 侧也不装）⇒ 只要这些纯函数留在组件里，离线测试就 import 不进组件文件，
 *  于是"连线是主干还是分支""徽标取不到时写什么"这类**纯逻辑**只能靠真机 e2e 验，
 *  慢且脆。搬到这里之后，`scripts/test-mindmap-logic.mjs` 可以一秒跑完。
 *
 *  ⚠️ 本文件**不得** import react / react-dom（会破坏上面的可测性）。
 */

import { LAYOUT } from "./branch-tree.js";
import { EDGE_KINDS, NODE_KINDS, STATE_KINDS, marksOfRow } from "../store/mindmap-schema.js";

/**
 * 连线路径（三次贝塞尔 / 直角折线两种，由个性化设定切换）。
 * 🔴 用曲线而不是直线：血缘树的子节点在纵向上是**阶梯**排列的，直线会在分叉处
 *    互相穿插（三条线挤在一个交点），曲线让"哪条线进哪个节点"一眼可辨。
 *    「折线」档是为偏好工程感的用户准备的（个性化设定里的 edge=elbow）。
 * ⚠️ 两个端点**必须从实际行列坐标算**（节点可被用户拖动），不能再用 LAYOUT 常量拼 ——
 *    否则拖动之后连线还挂在原位。
 * @param {object} a 父行（含 x / y）
 * @param {object} b 子行
 * @param {number} depth 子行深度（≤1 = 主干，其余 = 分支）
 * @param {boolean} chain 是否在选中链上
 * @param {"curve"|"elbow"} [style] 个性化设定里的连线样式
 * @returns {{d:string, kind:string, x1:number, y1:number, x2:number, y2:number}}
 */
export function edgePathFor(a, b, depth, chain, style) {
	const x1 = a.x + LAYOUT.nodeW;
	const y1 = a.y + LAYOUT.nodeH / 2;
	const x2 = b.x;
	const y2 = b.y + LAYOUT.nodeH / 2;
	const mx = x1 + (x2 - x1) / 2;
	const kind = chain ? "chain" : (depth <= 1 ? "trunk" : "child");
	const d = style === "elbow"
		? "M" + x1 + "," + y1 + " L" + mx + "," + y1 + " L" + mx + "," + y2 + " L" + x2 + "," + y2
		: "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2;
	return { d, kind, x1, y1, x2, y2 };
}

/**
 * 把用户拖动的位置叠加到行上（**纯函数**）。
 * 🔴 拖动只改**画面位置**，绝不改 `parentSessionId` ——
 *    血缘由宿主 fork 时固化，插件侧无接口可改（元素库 E18 明确登记为不做）。
 * @param {Array} rows buildBranchTree().rows
 * @param {Object<string,{x:number,y:number}>} posMap 用户摆放的位置（按 sessionId）
 * @returns {Array} 新行数组（未摆放的行原样返回，不复制也安全）
 */
export function applyNodePos(rows, posMap) {
	if (!posMap || !Object.keys(posMap).length) return rows;
	return (rows || []).map((r) => {
		const p = posMap[r.sessionId];
		if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return r;
		return { ...r, x: p.x, y: p.y, moved: true };
	});
}

/** 拖动位移 → 新坐标（把屏幕像素位移换算回画布坐标；含边界夹紧，防拖出画布丢失） */
export function draggedPos(origin, dxScreen, dyScreen, zoom, bounds) {
	const k = Number(zoom) > 0 ? Number(zoom) : 1;
	const w = (bounds && bounds.w) || 4000, h = (bounds && bounds.h) || 3000;
	const x = Math.max(0, Math.min(w, Math.round((origin.x + dxScreen / k) * 10) / 10));
	const y = Math.max(0, Math.min(h, Math.round((origin.y + dyScreen / k) * 10) / 10));
	return { x, y };
}

/** 框上的小控件样式（用 CSS 变量消费个性化设定；禁用态给明确视觉） */
export function nodeBtnStyle(enabled, tone) {
	return {
		flex: "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center",
		width: 17, height: 17, borderRadius: "var(--dp-radius-sm, 5px)", cursor: enabled ? "pointer" : "not-allowed",
		fontSize: 10.5, lineHeight: 1, opacity: enabled ? 1 : 0.4,
		border: "1px solid " + (tone ? "var(--dp-ac2-line, rgba(137,87,229,.45))" : "var(--dp-line, #31343a)"),
		background: tone ? "var(--dp-ac2-soft, rgba(137,87,229,.16))" : "rgba(255,255,255,.05)",
		color: tone ? "var(--dp-ac2, #8957e5)" : "var(--dp-t2, #c3c8ce)"
	};
}

/** 连线样式（从 EDGE_KINDS 取，单一真相源；未知类型回落 child） */
export function edgeStyleOf(kind) {
	const e = EDGE_KINDS[kind] || EDGE_KINDS.child;
	return {
		stroke: e.stroke, strokeWidth: e.width, opacity: e.opacity, fill: "none",
		strokeDasharray: e.dash || undefined, strokeLinecap: "round"
	};
}

/**
 * 节点第二行文案。
 * 🔴 取不到任何有据徽标时**不写"未知"**，退回「层 N」——
 *    深度是从血缘算出来的事实，而"未知"是一句没有信息量的话。
 */
export function metaLineOf(row) {
	const marks = marksOfRow(row).map((m) => m.text);
	if (marks.length) return marks.join(" · ");
	return "层 " + row.depth;
}

/** 节点类型显示名（未知类型回落叶子，不抛） */
export function kindLabelOf(row) {
	return (NODE_KINDS[row && row.kind] || NODE_KINDS.leaf).label;
}

/** 状态点的可读说明（挂 title —— 否则用户只看到一个颜色点，不知道它是什么意思） */
export function stateTitleOf(row) {
	const s = STATE_KINDS[row.state] || STATE_KINDS.idle;
	const src = row.stateSource === "host" ? "宿主快照" : "推断（血缘降级）";
	return s.label + " —— 判据：" + s.from + " ｜ 来源：" + src;
}

/** 悬浮工具条按钮样式（小方块，hover 由宿主浏览器默认态承担） */
export const HOVER_BTN_STYLE = Object.freeze({
	fontSize: 11.5, color: "#c3c8ce", cursor: "pointer", padding: "1px 4px", borderRadius: 3,
	background: "rgba(255,255,255,.05)", lineHeight: 1.4
});
