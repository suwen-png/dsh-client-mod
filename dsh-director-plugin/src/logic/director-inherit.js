/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：「总监对话」按分支血缘**继承读**
 * 引用：—
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/NodeDetailPanel.js
 * 下游：store/plugin-db.js, logic/host-ctx.js, logic/discover.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/director-inherit.js — 「总监对话」按分支血缘**继承读**
 *
 * ── 需求原话（第 42 轮）────────────────────────────────────────
 *   「同一个分支迁移出来的总监对话需要是一样的 比如我从 1 新建了分支 2，
 *     那么 2 中的总监对话信息和 1 要是一样的，这样我能在任意对话中看到同样的总监信息」
 *
 * ── 为什么会"不一样"（根因，不是猜）──────────────────────────────
 *   总监消息按 **sessionId 分桶**存（`store/plugin-db.js` 的 `PDB.CONVERSATIONS`，
 *   索引键 `nodeId`）。宿主「从会话 1 新建分支 2」会产生一个**新的 sessionId**
 *   ⇒ 分支 2 的桶天然是空的 ⇒ 在分支 2 里打开总监只能看到"尚无总监消息"。
 *   注意：宿主自己在 `ctx.sessions` 里**明确记录了 `parentId`**
 *   （= 分支 2 派生自会话 1），只是插件从没读过它。
 *
 * ── 为什么是「继承读」而不是「复制一份」──────────────────────────
 *   复制（fork 时把父桶整份写进子桶）有三个坏处：
 *     ① 写放大 —— N 层分支链会留下 N 份越来越大的副本；
 *     ② **不一致** —— 复制只保证"那一刻一样"，父之后新增的上游信息子看不到，
 *        恰恰违背用户要的"在任意对话中看到同样的总监信息"；
 *     ③ 不可逆 —— 一旦写入就无法区分"这是父亲的消息"还是"我在这个分支发的"。
 *   ⇒ 采用**只读上溯**：子桶自己有消息就用自己的；自己为空（且它确有分支父）
 *     才去读父链上**最近的非空桶**。零写入、零膨胀、天然一致。
 *
 * ── 三条边界（不许越过）──────────────────────────────────────────
 *   ① 只用于**读展示**。维护类操作（清空 / 备份 / 孤儿桶回收）必须走
 *      `store/plugin-db.js` 的**原始** `listDirectorMessages(nodeId)` ——
 *      拿继承结果去做删除，会把父对话的消息当成子对话的删掉。
 *   ② **必须可分辨**：返回 `{ inherited, from }`，UI 据此**明确标注**来源
 *      （纪律 146：用户看不见的信息等于没做；也不能让用户误以为是自己发的）。
 *   ③ 链路有界（`sessionChain` 上限 8 环 + 环检测），脏数据不成死循环。
 */

import { listDirectorMessages } from "../store/plugin-db.js";
import { sessionChain } from "./host-ctx.js";
import { ID_PREFIX } from "./discover.js";

/** 继承链最多上溯几环（含自身）—— 与 `host-ctx#sessionChain` 的上限一致 */
export const INHERIT_MAX_DEPTH = 8;

/**
 * 作用域「总监对话继承链」：`[本节点, 父会话节点, 祖父会话节点, …]`（节点 id 形态）。
 *
 * 只有**会话级**节点（`se_*`）才谈得上分支血缘；文件夹 / 全局节点返回 `[自身]`
 * （它们的"总监对话"就是自己那一条，不做跨节点继承）。
 *
 * @param {string} nodeId
 * @returns {string[]}
 */
export function directorScopeChain(nodeId) {
	const id = String(nodeId || "");
	if (!id) return [];
	if (id.indexOf(ID_PREFIX.session) !== 0) return [id];
	const sid = id.slice(ID_PREFIX.session.length);
	if (!sid) return [id];
	return sessionChain(sid, INHERIT_MAX_DEPTH).map((s) => ID_PREFIX.session + s);
}

/**
 * 继承读：沿链取**第一个非空桶**的总监消息。
 *
 * @param {string} nodeId
 * @returns {Promise<{rows:Array, from:string, inherited:boolean, chain:string[]}>}
 *   `from`     = 实际取到数据的节点 id（`inherited` 为真时即祖先节点）
 *   `inherited`= 数据是否来自祖先（UI 必须据此标注来源）
 *   `chain`    = 本次解析出的链（诊断用：能回答"为什么没继承到"）
 */
export async function readDirectorMessages(nodeId) {
	const chain = directorScopeChain(nodeId);
	if (!chain.length) return { rows: [], from: String(nodeId || ""), inherited: false, chain: [] };
	for (let i = 0; i < chain.length; i++) {
		let rows = [];
		try {
			rows = (await listDirectorMessages(chain[i])) || [];
		} catch (e) {
			rows = [];   // 单桶读失败**不中断**上溯（可能只是该桶不存在）
		}
		if (rows.length) return { rows, from: chain[i], inherited: i > 0, chain };
	}
	return { rows: [], from: chain[0], inherited: false, chain };
}

/** 安装全局契约（真机套件零猜测读取；**只读**，不改任何桶） */
export function installDirectorInheritApi() {
	if (typeof window === "undefined") return null;
	window.__dshDirectorInherit = {
		INHERIT_MAX_DEPTH, directorScopeChain, readDirectorMessages,
		/** 诊断：某节点为什么读到/读不到（把链路与每一环的行数摊开） */
		probe: async (nodeId) => {
			const chain = directorScopeChain(nodeId);
			const per = [];
			for (const id of chain) {
				let n = -1;
				try { n = ((await listDirectorMessages(id)) || []).length; } catch (e) { n = -1; }
				per.push({ nodeId: id, rows: n });
			}
			const res = await readDirectorMessages(nodeId);
			return { chain, per, from: res.from, inherited: res.inherited, rows: res.rows.length };
		}
	};
	return window.__dshDirectorInherit;
}
