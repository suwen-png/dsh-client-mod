/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：「维度 ↔ 分支节点」绑定的**唯一翻译点**（19 号文 N2 · **纯函数**）
 * 引用：—
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js
 * 下游：store/hierarchy.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/dim-branch.js — 「维度 ↔ 分支节点」绑定的**唯一翻译点**（19 号文 N2 · **纯函数**）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它治的是什么
 * ──────────────────────────────────────────────────────────────────
 *   19 号文 N2 的两条平行通道各自为政：
 *     通道 A（`DirectorPage` 派发）**只认内容** —— `plan()` 命中小说即全 8 维；
 *     通道 B（`route()`）**只认层级树节点** —— 候选集是 `level: "project" | "session"`。
 *   ⇒ 在 A3 分支里说 A5 的话，路由既**判不出**"这属于 A5"，候选里也**没有** A5。
 *   要合并两条通道，先得回答一个问题：**"A5 这条维度，在树上对应哪个节点？"**
 *   本模块就是**这一句话的实现**，且**只有这一份**。
 *
 * ── 🔴 为什么必须只有一份（而不是两个组件各写一遍）────────────────────
 *   总监页与总监弹窗都要用这个映射。两处各写一遍的形态在本项目已经出现过：
 *   `director-chain.js#DIRECTOR_CHAIN` 与 `director-run.js#runDirector()` 就是
 *   **两份真相源**（19 号文 N9），表现为"面板上展示的五步"与"真正跑的五步"不一致，
 *   而**谁都不报错**。所以这里从第一行起就固定成单一实现，两个组件都调它。
 *
 * ── 🔴 为什么从分流索引反查，而不是自己维护一份映射表 ────────────────
 *   `dsh.director.split`（`store/split-index.js`，**冻结键**）**本来就是**
 *   "分支会话 id ↔ 维度 key"的既有绑定：`recordSplits()` 写、`applySplitLabels()` 读来做标签覆盖。
 *   再立一份必然漂移（同一事实两处存储 ⇒ 总有一处先过期）。
 *
 * ── 🔴 为什么是纯函数 ──────────────────────────────────────────────
 *   `tree` 与 `index` 都由调用方传入 ⇒ 无 localStorage / 无 DOM / 无时钟 / 不改入参。
 *   离线套件可以拿**手工构造的树与索引**直接断言（`test-routing-local.mjs` RL-2/3/4），
 *   而不必起 Harness —— 真机只用来验"接线装对了没有"，不重复验逻辑。
 */

import { findNodeBySessionId, scopeHasConversation, scopeKeyOf } from "../store/hierarchy.js";

/** 本模块的绑定来源标记（读数的"这个映射是谁给的"判据） */
export const DIM_BRANCH_ORIGIN = "plugin:split-index";

/**
 * 由「层级树 + 分流索引」算出路由需要的**维度上下文**。
 *
 * @param {object|null} tree 插件层级树的根节点（`loadTree()` 的产物；含 `childNodes`）
 * @param {Object<string,{dim?:string,label?:string,name?:string,at?:number}>} index
 *        分流索引（`readSplitIndex()` 的产物；键 = **分支会话 id**）
 * @param {{nodeId?:string,node?:object}} [opts] 当前所在节点（用它判"我现在属于哪个维度"）
 * @returns {{branchOf:Object, currentDim:string, accounts:{indexKeys:number,dimKeys:number,bound:number,unbound:number}}}
 *   · `branchOf[dimKey] = {nodeId, sessionId, at, label}`（同维度多条 ⇒ 取 `at` **最新**）
 *   · `currentDim` = 当前节点挂的会话在索引里的维度 key（无 ⇒ `""`）
 *   · `accounts` 供调用方对账（纪律 78 单一真相源：`dimKeys = bound + unbound`）
 *
 * ⚠️ **不在这里判"该不该转发"** —— 那是 `routing.js#suggestDestination()` 的职责
 *    （它才持有 `DESTINATION` 契约）。本模块只回答"维度对应哪个节点"。
 */
export function dimBranchContext(tree, index, opts = {}) {
	const o = opts || {};
	const idx = (index && typeof index === "object") ? index : {};
	const keys = Object.keys(idx);
	const branchOf = {};
	let dimKeys = 0;
	let unbound = 0;
	for (let i = 0; i < keys.length; i++) {
		const sid = keys[i];
		const e = idx[sid];
		/* 无 `dim` 的条目**不算错**：分流索引里可能只有标题覆盖（历史条目）。
		 * 它进不了 `dimKeys`，所以不会污染对账。 */
		if (!e || !e.dim) continue;
		const dim = String(e.dim);
		dimKeys++;
		const nd = tree ? findNodeBySessionId(tree, sid) : null;
		/* 🔴 找不到节点**不等于**该维度不存在：会话可能已被归档/清理，
		 *    而索引条目还在（`SPLIT_MAX` 按 `at` 保新，不按存活）。如实计入 `unbound`
		 *    而不是静默丢弃 —— 否则"转发候选少了"会看不出原因（纪律 19）。 */
		if (!nd) { unbound++; continue; }
		const prev = branchOf[dim];
		/* 🔴 同维度多条 ⇒ 取 `at` **最新**：与 `planReuse()` 的"同组取最新"**同口径**
		 *    （两处口径不同会让"复用到 A"与"转发到 B"指向不同会话，且都"成功"）。 */
		if (!prev || Number(e.at || 0) > Number(prev.at || 0)) {
			branchOf[dim] = {
				nodeId: String(nd.id), sessionId: String(sid),
				at: Number(e.at || 0), label: String(e.label || "")
			};
		}
	}
	/* 当前维度：当前节点**真的有对话**（`scopeHasConversation` 是 hierarchy 的单一真相源）
	 * 且该会话在索引里有维度 ⇒ 才算"我在 A3 分支里"。否则 `currentDim` 为空 ——
	 * 空是**诚实的**：在全局根 / 项目文件夹上，本来就不属于任何维度。 */
	const curScope = (o.node && scopeHasConversation(o.node)) ? scopeKeyOf(o.nodeId, o.node) : "";
	const ce = curScope ? (idx[curScope] || null) : null;
	const currentDim = (ce && ce.dim) ? String(ce.dim) : "";
	return {
		branchOf: branchOf,
		currentDim: currentDim,
		accounts: { indexKeys: keys.length, dimKeys: dimKeys, bound: dimKeys - unbound, unbound: unbound }
	};
}

/**
 * 安装全局契约（与 `installRoutingApi` / `installLineageApi` 同风格）——
 * 供真机脚本直接对账"维度↔节点"的映射，**不必**从界面上反推。
 */
export function installDimBranchApi() {
	if (typeof window === "undefined") return null;
	const api = { DIM_BRANCH_ORIGIN, dimBranchContext };
	window.__dshDimBranch = api;
	return api;
}
