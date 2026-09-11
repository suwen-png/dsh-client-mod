/**
 * logic/discover.js — 真实会话 / 文件夹（workspace）数据源发现层
 *
 * 需求来源：「每一个对话都有一个总监 · 每一个文件夹都有总监 · 最上层全局总管负责」
 *   要让**每一个**对话/文件夹都有总监，节点就不能靠手工创建 ——
 *   必须从宿主真实数据源**自动发现**会话与文件夹，再逐一定向生成总监节点。
 *
 * ── 数据源（实测，2026-09-12 真机 Harness 渲染进程）────────────────
 *   ① `localStorage["dsh.workspace.view.v5"]`
 *        {"groupBy":"workspace",
 *         "sessionOrderByAccount":{ "<workspaceId>": ["session-xxx", ...], "": [...] },
 *         "sessionUpdatedAtByAccount":{ "<workspaceId>": {"session-xxx": ts, ...} }}
 *        ⇒ **workspace = 文件夹级**（groupBy 明确为 workspace），
 *          **session   = 对话级**，且自带更新时间。
 *   ② `localStorage["dsh.sessions.current"]` → {"sessionId":"session-xxx"} 当前会话
 *   ③ 兜底：IDB `directorFolders`（keyPath folderId）/ `directorStores`（会话 store）
 *
 * ⚠️ ① 的 key 带版本号（v5），宿主升级后会变。故用**前缀模糊匹配**
 *    `dsh.workspace.view`，而非写死 v5 —— 否则宿主一升级就全量失联。
 *
 * 🔴 稳定 id 约定（幂等的根基）
 *    节点 id 必须由**数据源主键**派生，不能用随机 id：
 *      workspace → `ws_<workspaceId>`（未分组为 `ws__ungrouped__`）
 *      session   → `se_<sessionId>`
 *    否则每次同步都会新建一套节点（重复膨胀），且无法判定「已覆盖」。
 */

import { idbListFolders } from "../store/idb.js";

/** 稳定 id 前缀 */
export const ID_PREFIX = { workspace: "ws_", session: "se_" };
/** 未分组 workspace 的占位 id（数据源中 key 为空串） */
export const UNGROUPED_ID = "__ungrouped__";

/** 通用短码（标题缺失时的兜底显示名） */
export function shortId(id, keep = 8) {
	const s = String(id || "");
	return s.length <= keep ? s : s.slice(0, keep);
}

/**
 * 会话显示名（标题缺失时的兜底）
 * 🔴 必须先剥离 `session-` 前缀再截断 —— 会话 id 形如
 *    `session-4e8e9e49-0a8c-...`，直接取前 8 位得到的是常量前缀 `session-`，
 *    导致**所有会话同名**（实测 8 个会话全部显示为「会话 session-」，无法区分）。
 */
export function sessionLabel(sessionId, keep = 8) {
	return "会话 " + shortId(String(sessionId || "").replace(/^session-/, ""), keep);
}

function safeLS() {
	try {
		return typeof localStorage !== "undefined" ? localStorage : null;
	} catch (e) {
		return null; // 隐私模式 / 禁用存储
	}
}

/**
 * 前缀模糊匹配 localStorage key（应对宿主版本升级，如 v5 → v6）
 * @returns {string|null} 命中的 key
 */
export function findWorkspaceViewKey() {
	const ls = safeLS();
	if (!ls) return null;
	let best = null;
	for (let i = 0; i < ls.length; i++) {
		const k = ls.key(i);
		if (k && k.indexOf("dsh.workspace.view") === 0) best = k; // 取最后一个（版本号最大）
	}
	return best;
}

/** 读取并解析 workspace 视图（宿主真实分组数据） */
export function readWorkspaceView() {
	const ls = safeLS();
	if (!ls) return null;
	const key = findWorkspaceViewKey();
	if (!key) return null;
	let raw = null;
	try { raw = ls.getItem(key); } catch (e) { return null; }
	if (!raw) return null;
	let obj = null;
	try { obj = JSON.parse(raw); } catch (e) { return null; }
	if (!obj || typeof obj !== "object") return null;
	return { key, data: obj };
}

/** 当前会话 id */
export function readCurrentSessionId() {
	const ls = safeLS();
	if (!ls) return null;
	try {
		const raw = ls.getItem("dsh.sessions.current");
		if (!raw) return null;
		const o = JSON.parse(raw);
		return (o && o.sessionId) || null;
	} catch (e) { return null; }
}

/** workspace 节点 id（稳定） */
export function workspaceNodeId(workspaceId) {
	return ID_PREFIX.workspace + (workspaceId || UNGROUPED_ID);
}

/** session 节点 id（稳定） */
export function sessionNodeId(sessionId) {
	return ID_PREFIX.session + sessionId;
}

/**
 * 发现真实层级：workspaces（文件夹级） + sessions（对话级）
 *
 * @returns {Promise<{source:string, workspaces:Array, sessions:Array, currentSessionId:string|null}>}
 *   workspaces: [{ id, nodeId, sessionIds: string[] }]
 *   sessions  : [{ id, nodeId, workspaceId, updatedAt }]
 *   source    : "localStorage" | "idb-folders" | "none"
 */
export async function discover() {
	const view = readWorkspaceView();
	if (view && view.data.sessionOrderByAccount) {
		const order = view.data.sessionOrderByAccount || {};
		const times = view.data.sessionUpdatedAtByAccount || {};
		const workspaces = [];
		const sessions = [];
		for (const wsId of Object.keys(order)) {
			const ids = Array.isArray(order[wsId]) ? order[wsId] : [];
			const tmap = times[wsId] || {};
			workspaces.push({
				id: wsId || UNGROUPED_ID,
				rawId: wsId,
				nodeId: workspaceNodeId(wsId),
				name: wsId ? ("工作区 " + shortId(wsId)) : "未分组",
				sessionIds: ids.slice()
			});
			for (const sid of ids) {
				sessions.push({
					id: sid,
					nodeId: sessionNodeId(sid),
					workspaceId: wsId || UNGROUPED_ID,
					updatedAt: tmap[sid] || 0
				});
			}
		}
		return {
			source: "localStorage",
			workspaceViewKey: view.key,
			workspaces, sessions,
			currentSessionId: readCurrentSessionId()
		};
	}

	// ── 兜底：IDB directorFolders（文件夹级）+ directorStores（会话级）──
	const folders = await idbListFolders();
	if (folders && folders.length) {
		const workspaces = folders.map((f) => ({
			id: f.folderId,
			rawId: f.folderId,
			nodeId: workspaceNodeId(f.folderId),
			name: f.name || f.title || ("文件夹 " + shortId(f.folderId)),
			sessionIds: []
		}));
		return {
			source: "idb-folders",
			workspaces,
			sessions: [],
			currentSessionId: readCurrentSessionId()
		};
	}

	return { source: "none", workspaces: [], sessions: [], currentSessionId: readCurrentSessionId() };
}

/** 安装全局契约 */
export function installDiscoverApi() {
	if (typeof window === "undefined") return null;
	window.__dshDiscover = {
		ID_PREFIX, UNGROUPED_ID,
		shortId, sessionLabel, findWorkspaceViewKey, readWorkspaceView, readCurrentSessionId,
		workspaceNodeId, sessionNodeId, discover
	};
	return window.__dshDiscover;
}
