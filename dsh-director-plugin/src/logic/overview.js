/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总览弹窗的数据整形（纯函数）
 * 引用：—
 * 上游：client-entry.js, components/OverviewDialog.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/overview.js — 总览弹窗的数据整形（纯函数）
 *
 * ── 需求（用户原话）─────────────────────────────────────────────
 *   「思维导图最上面加一个弹窗，分为左右列。左列是目前所有完成的功能，
 *     右列是所有待完成的，按照文件夹、对话进行分类。这样我们随时[掌握]所有项目的情况。
 *     同时这个允许点击，每一条点击的时候在左侧显示具体执行完成或者正在执行的情况，
 *     我可以随时针对点击的部分发送消息进行修正。」
 *
 * ── 分类口径（必须写死在这里，不许各组件各判一次）────────────────
 *   已完成 = `state === "done"`                 ← 导图节点态（宿主/推断都算）
 *          或 `completed === true`              ← 宿主显式真值
 *   待完成 = 其余
 *
 * 🔴 为什么要单列口径：本项目已栽过一次「一个语义标在两个元素上」导致计数翻倍
 *   （`data-collapsed`）。分类若散落在 UI 里，两列之和 ≠ 总条数 这类错误
 *   会以「看起来挺合理」的形态长期存在。
 */

/** 单条会话的展示态（UI 与测试共用一份判据） */
export function isDoneRow(row) {
	if (!row) return false;
	return row.state === "done" || row.completed === true;
}

/** 运行中（"正在执行"）—— 与 `isDoneRow` 互斥优先：运行中优先显示为进行中 */
export function isRunningRow(row) {
	if (!row) return false;
	if (isDoneRow(row)) return false;
	return row.state === "running" || row.running === true || Boolean(row.pending);
}

/** 进行中标签（详情区显示用） */
export function statusLabelOf(row) {
	if (!row) return "未知";
	if (isDoneRow(row)) return "已完成";
	if (isRunningRow(row)) return row.pending ? "待确认" : "执行中";
	return "待开始";
}

function groupPush(map, folder, item) {
	const arr = map.get(folder);
	if (arr) arr.push(item); else map.set(folder, [item]);
}

function toGroups(map) {
	return [...map.entries()]
		.sort((a, b) => a[0].localeCompare(b[0], "zh"))
		.map(([folder, items]) => ({
			folder,
			items: items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || String(a.title).localeCompare(String(b.title), "zh"))
		}));
}

/**
 * 把「会话行 + 数据源映射」整理成两列分组。
 *
 * @param {object} input
 * @param {Array} input.rows `buildBranchTree().rows`
 * @param {Array} [input.sessions] `discover().sessions`（sessionId ↔ workspaceId）
 * @param {Array} [input.workspaces] `discover().workspaces`（workspaceId ↔ 显示名）
 * @returns {{done:Array<{folder:string,items:Array}>, todo:Array<{folder:string,items:Array}>,
 *            counts:{done:number,todo:number,total:number}, folders:string[]}}
 */
export function buildOverview(input = {}) {
	const rows = Array.isArray(input.rows) ? input.rows : [];
	const sessions = Array.isArray(input.sessions) ? input.sessions : [];
	const workspaces = Array.isArray(input.workspaces) ? input.workspaces : [];

	const wsName = new Map();
	for (const w of workspaces) if (w && w.id !== undefined) wsName.set(w.id, w.name || String(w.id));
	const seWs = new Map();
	for (const s of sessions) if (s && s.id) seWs.set(String(s.id), s.workspaceId);

	const doneMap = new Map();
	const todoMap = new Map();
	let done = 0;
	let todo = 0;

	for (const r of rows) {
		if (!r || !r.sessionId) continue;
		const wsId = seWs.get(String(r.sessionId));
		const folder = (wsId !== undefined && wsName.get(wsId)) || (wsId ? "工作区 " + String(wsId).slice(0, 8) : "未分组");
		const item = {
			sessionId: r.sessionId,
			title: r.title || r.sessionId,
			folder,
			state: r.state,
			statusLabel: statusLabelOf(r),
			depth: r.depth,
			childrenCount: r.childrenCount || 0,
			updatedAt: r.updatedAt || 0,
			running: isRunningRow(r),
			done: isDoneRow(r)
		};
		if (item.done) { groupPush(doneMap, folder, item); done++; }
		else { groupPush(todoMap, folder, item); todo++; }
	}

	return {
		done: toGroups(doneMap),
		todo: toGroups(todoMap),
		counts: { done, todo, total: done + todo },
		folders: [...new Set([...doneMap.keys(), ...todoMap.keys()])].sort()
	};
}

/** 安装全局契约（供真机脚本比对） */
export function installOverviewApi() {
	if (typeof window === "undefined") return null;
	const api = { buildOverview, isDoneRow, isRunningRow, statusLabelOf };
	window.__dshOverview = api;
	return api;
}
