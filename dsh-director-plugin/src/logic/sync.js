/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：自动同步：让**每一个**对话 / 文件夹都拥有总监
 * 引用：—
 * 上游：client-entry.js, components/DirectorHierarchy.js
 * 下游：store/hierarchy.js, logic/discover.js, store/idb.js, util/debug.js, util/bus.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/sync.js — 自动同步：让**每一个**对话 / 文件夹都拥有总监
 *
 * 需求（用户原话）：「每一个对话都有一个总监 · 每一个文件夹都有总监 · 最上层有总监负责」
 *
 * 设计要点
 *   1. **稳定 id 幂等**：节点 id 由数据源主键派生（`ws_`/`se_` 前缀，见 discover.js），
 *      故重复同步**只会更新、不会重复新建**。这是「每一个都有」能被验证的前提。
 *   2. **全局总管单例**：`__global__`，永远存在，所有文件夹级挂其下。
 *   3. **文件夹级 = workspace**（宿主 `groupBy:"workspace"`），**对话级 = session**。
 *   4. **不覆盖用户改名**：同步写入时打 `meta.autoName = true`；用户改名后该标记被清除，
 *      此后同步不再覆盖 `name`。
 *   5. **孤儿软标记**：数据源中已消失（被删除）的会话不删除节点（避免误删用户沉淀的
 *      总结/决策），只标 `meta.orphaned = true`，UI 可筛选。
 *
 * 全局契约：`window.__dshSync`
 */

import {
	LEVEL, GLOBAL_NODE_ID, makeNode, getNode, saveNode,
	ensureGlobal, listAllNodes
} from "../store/hierarchy.js";
import { discover, workspaceNodeId, sessionNodeId, shortId, sessionLabel } from "./discover.js";
import { idbLoad } from "../store/idb.js";
import { dshLog } from "../util/debug.js";
import { emitHierarchyChange } from "../util/bus.js";

/**
 * 从真实数据源同步层级结构（幂等）
 * @param {object} [opts]
 * @param {boolean} [opts.includeOrphanScan=true] 是否扫描并软标记已消失的会话
 * @returns {Promise<{source:string, created:number, updated:number, orphaned:number,
 *                    folders:number, sessions:number, total:number, coverage:object}>}
 */
export async function syncFromSource(opts = {}) {
	const disc = await discover();
	const stats = {
		source: disc.source, created: 0, updated: 0, orphaned: 0,
		folders: 0, sessions: 0, total: 0
	};

	// ── 1. 全局总管（单例，必须有）──
	const root = await ensureGlobal();

	if (!disc.workspaces.length && !disc.sessions.length) {
		dshLog("sync", "数据源为空（source=" + disc.source + "），仅确保全局总管存在");
		stats.total = 1;
		stats.coverage = await auditCoverage();
		emitHierarchyChange();
		return stats;
	}

	// ── 2. 文件夹级（workspace）→ 项目总监 ──
	const rootChildren = new Set(root.children || []);
	const folderNodeIds = [];
	disc.workspaces.forEach((ws, idx) => {
		const id = ws.nodeId || workspaceNodeId(ws.id);
		folderNodeIds.push(id);
		rootChildren.add(id);
		ws.__nodeId = id;
		ws.__order = idx;
	});

	for (const ws of disc.workspaces) {
		const id = ws.__nodeId;
		let node = await getNode(id);
		if (!node) {
			node = makeNode({
				id, name: ws.name, level: LEVEL.PROJECT, parentId: GLOBAL_NODE_ID,
				meta: { sourceId: ws.rawId ?? ws.id, source: "workspace", autoName: true, order: ws.__order }
			});
			stats.created++;
		} else {
			if (node.meta && node.meta.autoName !== false && node.name !== ws.name) node.name = ws.name;
			node.parentId = GLOBAL_NODE_ID;
			node.meta = { ...(node.meta || {}), sourceId: ws.rawId ?? ws.id, source: "workspace", order: ws.__order };
			stats.updated++;
		}
		await saveNode(node);
		stats.folders++;
	}

	// ── 3. 对话级（session）→ 会话总监 ──
	const folderChildMap = new Map(); // folderNodeId -> [sessionNodeId]
	const aliveSessionIds = new Set();
	for (const s of disc.sessions) {
		const parentId = workspaceNodeId(s.workspaceId);
		if (!folderChildMap.has(parentId)) folderChildMap.set(parentId, []);
		folderChildMap.get(parentId).push(s.nodeId || sessionNodeId(s.id));
		aliveSessionIds.add(s.id);
	}

	let sIdx = 0;
	for (const s of disc.sessions) {
		const id = s.nodeId || sessionNodeId(s.id);
		const parentId = workspaceNodeId(s.workspaceId);
		// 父级不存在（如数据源只有会话没有 workspace）→ 归到全局根，绝不丢弃
		const parentOk = folderNodeIds.indexOf(parentId) >= 0;
		const realParent = parentOk ? parentId : GLOBAL_NODE_ID;
		if (!parentOk) rootChildren.add(id);

		// 会话消息统计（宿主 directorStores 有则取，无则为 0；失败静默）
		let messageCount = 0;
		let lastMessage = "";
		try {
			const store = await idbLoad(s.id);
			if (store && Array.isArray(store.messages)) {
				messageCount = store.messages.length;
				const last = store.messages[store.messages.length - 1];
				if (last) lastMessage = String(last.content || last.text || "").slice(0, 200);
			}
		} catch (e) { /* 无该会话的本地 store，属正常 */ }

		let node = await getNode(id);
		if (!node) {
			node = makeNode({
				id,
				name: sessionLabel(s.id),
				level: LEVEL.SESSION,
				parentId: realParent,
				meta: { sourceId: s.id, source: "session", autoName: true, order: sIdx }
			});
			stats.created++;
		} else {
			if (node.meta && node.meta.autoName !== false) node.name = sessionLabel(s.id);
			node.parentId = realParent;
			node.meta = { ...(node.meta || {}), sourceId: s.id, source: "session", order: sIdx };
			stats.updated++;
		}
		node.conversations = [{
			conversationId: s.id,
			title: node.name,
			lastMessage,
			lastTime: s.updatedAt || 0,
			messageCount
		}];
		node.meta.orphaned = false;
		await saveNode(node);
		stats.sessions++;
		sIdx++;
	}

	// ── 4. 维护父子关系（幂等：用 Set 去重，不会重复 push）──
	root.children = Array.from(rootChildren);
	await saveNode(root);
	for (const [fid, kids] of folderChildMap.entries()) {
		const f = await getNode(fid);
		if (!f) continue;
		f.children = Array.from(new Set([...(f.children || []), ...kids]));
		await saveNode(f);
	}

	// ── 5. 孤儿软标记（数据源中已消失的自动同步会话）──
	if (opts.includeOrphanScan !== false) {
		const all = await listAllNodes();
		for (const n of all) {
			if (n.level !== LEVEL.SESSION) continue;
			const sid = n.meta && n.meta.sourceId;
			if (!sid) continue;                 // 手工创建的节点不参与
			if (aliveSessionIds.has(sid)) continue;
			if (n.meta && n.meta.orphaned) continue;
			n.meta = { ...n.meta, orphaned: true };
			await saveNode(n);
			stats.orphaned++;
		}
	}

	stats.total = stats.folders + stats.sessions + 1;
	stats.coverage = await auditCoverage();
	// 🔴 必须广播：面板首帧早于同步完成，若不通知则一直显示陈旧快照（实测 0/8）
	emitHierarchyChange();
	dshLog("sync", "同步完成: 新建 " + stats.created + " / 更新 " + stats.updated
		+ " / 孤儿 " + stats.orphaned + " / 覆盖度 " + JSON.stringify(stats.coverage.rate));
	return stats;
}

/**
 * 覆盖度自检 —— 直接回答「是否每一个对话 / 文件夹都有总监」
 *
 * @returns {Promise<{sessions:object, folders:object, global:object, rate:string, ok:boolean}>}
 */
export async function auditCoverage() {
	const disc = await discover();
	const all = await listAllNodes();
	const byId = new Map(all.map((n) => [n.id, n]));

	const sessionTotal = disc.sessions.length;
	const sessionCovered = disc.sessions.filter((s) => byId.has(s.nodeId || sessionNodeId(s.id))).length;
	const sessionMissing = disc.sessions
		.filter((s) => !byId.has(s.nodeId || sessionNodeId(s.id)))
		.map((s) => s.id);

	const folderTotal = disc.workspaces.length;
	const folderCovered = disc.workspaces.filter((w) => byId.has(w.nodeId || workspaceNodeId(w.id))).length;
	const folderMissing = disc.workspaces
		.filter((w) => !byId.has(w.nodeId || workspaceNodeId(w.id)))
		.map((w) => w.id);

	const globalOk = byId.has(GLOBAL_NODE_ID);
	const pct = (a, b) => (b === 0 ? "n/a" : Math.round((a / b) * 100) + "%");

	return {
		source: disc.source,
		sessions: { total: sessionTotal, covered: sessionCovered, missing: sessionMissing, rate: pct(sessionCovered, sessionTotal) },
		folders: { total: folderTotal, covered: folderCovered, missing: folderMissing, rate: pct(folderCovered, folderTotal) },
		global: { total: 1, covered: globalOk ? 1 : 0, rate: globalOk ? "100%" : "0%" },
		rate: "会话 " + pct(sessionCovered, sessionTotal) + " / 文件夹 " + pct(folderCovered, folderTotal) + " / 全局 " + (globalOk ? "100%" : "0%"),
		ok: globalOk && sessionCovered === sessionTotal && folderCovered === folderTotal
	};
}

/** 安装全局契约 */
export function installSyncApi() {
	if (typeof window === "undefined") return null;
	window.__dshSync = { syncFromSource, auditCoverage };
	return window.__dshSync;
}
