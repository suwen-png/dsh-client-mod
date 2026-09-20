/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：**G7「总监自己把控项目清单」的读数（纯函数）**
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/project-inventory.js — **G7「总监自己把控项目清单」的读数（纯函数）**
 *
 * ══════════════════════════════════════════════════════════════════
 *  需求原文与缺口
 * ══════════════════════════════════════════════════════════════════
 *  用户（19 号文 F7）要的是**总监自己能把控项目**，不是"让分支去看"。
 *  改前总监页只有 `projectRoot()`（给出 `根 / 根\src` 两个**字符串**）——
 *  那是"把路径交给别人"，总监自己**没有任何一个落点**能回答：
 *    「我手上登记了几个项目？每个项目底下几个对话？有几个是悬空的？」
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 三条口径
 * ══════════════════════════════════════════════════════════════════
 *  ① **数据源 = 插件自有层级树**（`store/hierarchy.js` 的唯一真相源）。
 *     **不新开读盘通道**（22 号文 I12：用户上一轮刚投诉"量太多不一致"）
 *     ⇒ 本模块**只遍历传进来的树**，不 import 任何 IO。
 *
 *  ② **读数必须能双向对账**（纪律 19：不许写死数字）。
 *     `registered` 的定义是**全局根的直接 project 级子节点数** ——
 *     与 UI 上"数框"得到的是同一个量。闸门据此断言
 *     「读数 === 树里 project 级直接子节点数」，而不是"读数 > 0"。
 *
 *  ③ **零 ≠ 空白**（G7 判据的负对照）：一个项目都没登记时，
 *     文案必须是「**未登记项目**」这**四个字**，不能渲染空串或 `undefined`
 *     —— 本项目栽过多次"空着 = 看不出来是没数据还是坏了"（纪律 19/54）。
 */

/** 悬空原因（UI 与闸门都读这两个值，别各写各的字符串） */
export const DANGLING = Object.freeze({
	/** 节点上压根没有 conversationId（没绑定宿主会话） */
	NO_CONVERSATION: "no-conversation",
	/** 绑定的宿主会话已归档 / 已不在宿主列表里 */
	ARCHIVED: "archived"
});

/** 会话节点上的宿主会话 id（无则空串） */
export function conversationIdOf(node) {
	const c = node && Array.isArray(node.conversations) && node.conversations[0];
	return c && c.conversationId ? String(c.conversationId) : "";
}

/** 直接子节点（按 level 过滤） */
function kidsOf(node, level) {
	const list = node && Array.isArray(node.childNodes) ? node.childNodes : [];
	return list.filter((n) => n && n.level === level);
}

/**
 * 项目清单读数。
 *
 * @param {object|null} root 层级树根（全局根；亦容忍传入子树 —— 按 `level === "global"` 自适应）
 * @param {{archivedIds?:Array<string|number>}} [opts] 宿主已归档会话 id（来自 `archivedSessionIds()`）
 * @returns {{
 *   registered:number, sessions:number, dangling:number, emptyProjects:number,
 *   total:number, rows:Array, danglingRows:Array, archivedKnown:boolean
 * }}
 */
export function projectInventory(root, opts) {
	const o = opts || {};
	const archivedRaw = Array.isArray(o.archivedIds) ? o.archivedIds : null;
	const archived = new Set((archivedRaw || []).map(String));
	const archivedKnown = archivedRaw !== null;

	/* 全局根：优先按 level 找；找不到就用传进来的根本身（子树场景） */
	let g = root || null;
	if (g) {
		const stack = [g];
		let hit = null;
		while (stack.length && !hit) {
			const cur = stack.shift();
			if (cur && cur.level === "global") { hit = cur; break; }
			if (cur && Array.isArray(cur.childNodes)) for (const c of cur.childNodes) stack.push(c);
		}
		g = hit || g;
	}

	const projects = kidsOf(g, "project");
	/* 全局根下直接挂的会话（无项目归属的"游离会话"）也算进对话总数 —— 它们同样占配额 */
	const looseSessions = kidsOf(g, "session");

	const sessions = looseSessions.slice();
	for (const p of projects) {
		sessions.push.apply(sessions, kidsOf(p, "session"));
		/* 三层以上（会话下面再挂会话）也遍历到 —— 树的形状由 discover/split 决定，
		 * 这里不假设深度，只是**递归收全**，避免"少算"（少算比多算更难发现）。 */
		const stack = kidsOf(p, "session").slice();
		while (stack.length) {
			const cur = stack.pop();
			const more = kidsOf(cur, "session");
			sessions.push.apply(sessions, more);
			stack.push.apply(stack, more);
		}
	}

	const danglingRows = [];
	for (const s of sessions) {
		const cid = conversationIdOf(s);
		if (!cid) danglingRows.push({ id: s.id, name: s.name, why: DANGLING.NO_CONVERSATION });
		else if (archivedKnown && archived.has(cid)) danglingRows.push({ id: s.id, name: s.name, why: DANGLING.ARCHIVED });
	}

	const emptyProjects = projects.filter((p) => kidsOf(p, "session").length === 0);

	return {
		registered: projects.length,
		sessions: sessions.length,
		dangling: danglingRows.length,
		emptyProjects: emptyProjects.length,
		total: projects.length + sessions.length,
		rows: projects.map((p) => ({ id: p.id, name: p.name, sessions: kidsOf(p, "session").length })),
		danglingRows,
		archivedKnown
	};
}

/**
 * 一行读数（UI 直接渲染这个字符串；闸门断言它**逐字**等于由树算出的值）。
 * 🔴 零项目 ⇒ 「未登记项目」（**不是空串**）。
 * @param {ReturnType<typeof projectInventory>} inv
 * @returns {string}
 */
export function inventoryText(inv) {
	const i = inv || {};
	if (!i.registered) return "未登记项目";
	return "已登记项目 " + i.registered + " / 对话 " + i.sessions + " / 悬空 " + i.dangling
		+ (i.emptyProjects ? " / 空项目 " + i.emptyProjects : "");
}

/** 每个项目的逐行文本（`名称 · N 对话`）—— 与 `inventoryText` 同源，不另拼 */
export function inventoryRows(inv) {
	const rows = (inv && Array.isArray(inv.rows)) ? inv.rows : [];
	return rows.map((r) => String(r.name || "未命名") + " · " + r.sessions + " 对话");
}

/** 离线/调试用 */
export function installProjectInventoryApi() {
	const api = { DANGLING, conversationIdOf, projectInventory, inventoryText, inventoryRows };
	if (typeof window !== "undefined") window.__dshProjectInventory = api;
	return api;
}
