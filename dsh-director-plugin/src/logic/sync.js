/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：自动同步：让**每一个**对话 / 文件夹都拥有总监
 * 引用：—
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorHierarchy.js
 * 下游：store/hierarchy.js, logic/discover.js, logic/host-ctx.js, store/idb.js, store/persist.js, logic/conv-snapshot.js, util/debug.js, util/bus.js
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
/* 🔴 第 42 轮（需求 2/3）：会话**显示文本**与**分支父级**一律从唯一实现取
 *    （宿主 `ctx.sessions` 快照：`displayTitle` / `parentId`）。 */
import { sessionIndex, sessionDisplayName, sessionParentId } from "./host-ctx.js";
import { idbLoad } from "../store/idb.js";
import { directorStorageKey } from "../store/persist.js";
import { mergeSnapshot } from "./conv-snapshot.js";
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
		/* 🔴 第 42 轮（需求 4）：别名（侧栏可能显示的其它写法）随节点落库 ——
		 *    `bridge/nav-hook.js` 只读得到**点击到的行文本**，没有别名就只能猜一种写法。 */
		const wsMeta = {
			sourceId: ws.rawId ?? ws.id, source: "workspace", autoName: true, order: ws.__order,
			aliases: Array.isArray(ws.aliases) ? ws.aliases.slice() : [],
			nameSource: ws.nameSource || "legacy"
		};
		let node = await getNode(id);
		if (!node) {
			node = makeNode({ id, name: ws.name, level: LEVEL.PROJECT, parentId: GLOBAL_NODE_ID, meta: wsMeta });
			stats.created++;
		} else {
			if (node.meta && node.meta.autoName !== false && node.name !== ws.name) node.name = ws.name;
			node.parentId = GLOBAL_NODE_ID;
			node.meta = { ...(node.meta || {}), ...wsMeta };
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
	/* 🔴 第 42 轮：**循环外**建一次会话快照索引（避免循环内 N 次全量扫描）。
	 *    `sessionIndex()` 读不到（未注入 / 版本差异）⇒ 空 Map ⇒ 全部退回 `sessionLabel`，
	 *    行为与改动前一致（降级可见、不假装成功）。 */
	const sessMeta = sessionIndex();
	for (const s of disc.sessions) {
		const id = s.nodeId || sessionNodeId(s.id);
		const parentId = workspaceNodeId(s.workspaceId);
		// 父级不存在（如数据源只有会话没有 workspace）→ 归到全局根，绝不丢弃
		const parentOk = folderNodeIds.indexOf(parentId) >= 0;
		const realParent = parentOk ? parentId : GLOBAL_NODE_ID;
		if (!parentOk) rootChildren.add(id);

		/* ── 会话快照 ──────────────────────────────────────────────────────
		 * 🔴 2026-09-18（第 40 轮）**真缺陷修复**：原实现读 `idbLoad(s.id)`
		 *    —— **裸会话 id**；而写入侧（`store/persist.js#save`）用的是
		 *    `directorStorageKey(sid)` = `"dsh.director.store." + safeDirectorKey(sid)`。
		 *    ⇒ **两端键不同源** ⇒ 读取**必然 miss** ⇒ `store === null`
		 *      ⇒ `messageCount / lastMessage` **恒 0 / 空**，**且不抛、不告警（静默）**。
		 *    用户可见后果：需求 5 的「对话概况」**恒显示"未采集"**
		 *      ⇒ 用户实测判定"我上面描述的要求并没有完成，差很多"。
		 *    修法 = **复用同一键构造**（`directorStorageKey`），不另写第二份（纪律 126）。
		 *
		 * ⚠️ 口径：这里读到的是**总监侧**消息（`state.messages`），**不是**用户与 AI 的对话
		 *    ⇒ UI 必须标「总监：」，**不许**标成「最后：」（两件事不同源，混标即误导）。
		 *    「最后一个**我发的** + 结果」由**对话镜像**采集，经 `mergeSnapshot` 落到本节点。
		 */
		let messageCount = 0;
		let lastMessage = "";
		let storeHit = false;
		try {
			const store = await idbLoad(directorStorageKey(s.id));
			if (store && Array.isArray(store.messages)) {
				storeHit = true;
				messageCount = store.messages.length;
				const last = store.messages[store.messages.length - 1];
				if (last) {
					const raw = last.text != null ? last.text : (last.content == null ? "" : last.content);
					lastMessage = String(raw).slice(0, 200);
				}
			}
		} catch (e) { /* 无该会话的本地 store，属正常（不是缺陷） */ }
		if (storeHit) stats.snapshotHit = (stats.snapshotHit || 0) + 1;

		/* 🔴 第 42 轮（需求 2）：「在总监中的文档选择 现在里面的是会话ID ⇒ 改成会话文本」。
		 *    会话节点名原先**恒为** `sessionLabel(sessionId)`（= `"会话 " + id 前 8 位`）——
		 *    那是**兜底标签**，不是会话文本 ⇒ 总监弹窗的层级下拉（`d-level`）、面包屑、
		 *    导图行显示的全是 id。宿主自己显示的是 `displayTitle`
		 *    （取证 `dsh-client-ui-workspace/lib/client.js` 的 `sessionTitle()`）
		 *    ⇒ 这里取**同一个量**；只有宿主读不到时才退回 `sessionLabel`。
		 *    ⚠️ 同时落 `meta.parentSessionId`（宿主 `parentId` = **分支血缘**）——
		 *       需求 3「同一分支迁移出来的总监对话要一样」靠它上溯。 */
		const realTitle = sessionDisplayName(s.id, sessionLabel, sessMeta);
		const hostParent = sessionParentId(s.id) || "";
		let node = await getNode(id);
		if (!node) {
			node = makeNode({
				id,
				name: realTitle,
				level: LEVEL.SESSION,
				parentId: realParent,
				meta: { sourceId: s.id, source: "session", autoName: true, order: sIdx, parentSessionId: hostParent }
			});
			stats.created++;
		} else {
			if (node.meta && node.meta.autoName !== false) node.name = realTitle;
			node.parentId = realParent;
			node.meta = { ...(node.meta || {}), sourceId: s.id, source: "session", order: sIdx, parentSessionId: hostParent };
			stats.updated++;
		}
		/* 🔴 **接住**对话镜像写入的快照（`lastUser`/`lastResult`/`snapAt`）——
		 *    本函数每轮都**整体重写** `node.conversations`；若不接住，
		 *    用户点开对话刚采集到的东西会被**下一次同步静默抹掉**
		 *    （症状："刚点开有内容，过一会儿又变未采集" ⇒ 无法归因）。 */
		const prevConv = (Array.isArray(node.conversations) && node.conversations[0]) || null;
		node.conversations = [mergeSnapshot({
			conversationId: s.id,
			title: node.name,
			lastMessage,
			lastTime: s.updatedAt || 0,
			messageCount
		}, prevConv ? {
			lastUser: prevConv.lastUser,
			lastResult: prevConv.lastResult,
			pending: prevConv.lastPending,
			count: prevConv.messageCount
		} : null, prevConv ? prevConv.snapAt : 0)];
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
