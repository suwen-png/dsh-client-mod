/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：分支血缘树（导图态的数据源）
 * 引用：—
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js, components/NodeDetailPanel.js, components/OverviewDialog.js, logic/mindmap-render.js
 * 下游：logic/discover.js, store/mindmap-schema.js, store/split-index.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 C2（分支生命周期状态机）· F1 / F5（导图行模型与宿主真值透传）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/branch-tree.js — 分支血缘树（导图态的数据源）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
 *   ├─ 板块 A · A4 分支导图态（画面）
 *   ├─ 板块 C · C2 分支生命周期状态机（节点状态与流转）
 *   └─ 板块 F · 思维导图元素库（本文件产出的行 → 元素渲染）
 *  使用者   components/MindMap.js（导图覆盖层）
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 关键事实：血缘数据**一直都在**，本文件只做「消费」不做「新建模型」
 * ══════════════════════════════════════════════════════════════════
 *   ① 写入方：宿主 `dsh-session/lib/index.js:1841` 在 fork 时写
 *        `meta.parentSession = <源会话 id>` + `seedLength`
 *   ② 暴露方：`dsh-client-runtime/lib/client.js` 把 `parentSessionId` 放进会话摘要
 *   ③ 已有投影：同文件 `flattenLineage(summaries, …)` **已实现**
 *        children 映射 + `depth` 缩进 + **环检测**（`visited` 集合，遇环打 warning）
 *   ④ 标题递增：`increasedForkTitle()`（支持全角括号）
 *   ⇒ 故本文件是②③④的**插件侧等价实现**（宿主函数不可直接 import），
 *     并额外产出导图需要的**像素坐标**（findings 见 docs/10 §4.4）。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 2026-09-12 修正两条**曾被写错的事实**（真机 + 宿主源码取证）
 * ══════════════════════════════════════════════════════════════════
 *  ① **"宿主摘要无执行中字段"是错的**。摘要一直带着
 *     `running / blank / completed / pendingInteraction / updatedAt / origin / agentPreset`：
 *        · `ctx.sessions.list.getSnapshot()` → `{ids, current, byId}`
 *        · `byId[id]` 身 = `{id, displayTitle, running, completed?, blank, updatedAt,
 *          pendingInteraction?, title?, cwd?, parentId?, origin?, agentPreset?}`
 *          （取证：`dsh-client-runtime/lib/client.js` `projectList` 的 byId 构造段）
 *     ⇒ 状态从此**读真值**，不再靠 childrenCount/depth 猜（旧猜测在真机上恒定不变）。
 *
 *  ② **读不到 `ctx.sessions` 的真因是 inject 少了一项**，不是"宿主版本差异"。
 *     `ctx.slots` 能用而 `ctx.sessions` 恒 undefined，差别只在产物里
 *     `exports.inject = ["slots"]` —— 宿主 app-shell 自己就是
 *     `inject = ["slots","sessions","layout"]`（取证：`dsh-client-web/lib/index.js`）。
 *     少声明 ⇒ 访问抛错 ⇒ 被本文件的 try/catch 吞掉 ⇒ **静默降级成"按工作区分组的平铺树"**，
 *     界面上只显示"血缘不可用"，看不出是**我们没声明**。
 *     ⇒ 修法：`build/build.mjs` 的 inject 列表补 `"sessions"`；
 *        且本文件把降级原因写进 `cache.diag`，**降级不再无声**。
 *
 * ══════════════════════════════════════════════════════════════════
 *  两条数据通道（按可用性降级，不抛错）
 * ══════════════════════════════════════════════════════════════════
 *   A. `ctx.sessions.list.getSnapshot()` —— 完整（含 parentId + running/completed）
 *   B. `discover()`（localStorage `dsh.workspace.view*`）—— 只有分组，**无血缘**
 *      ⇒ 此时导图退化为「按工作区分组的平铺树」，并在 UI 上标明"血缘数据不可用"
 *         + **具体原因**（diag）。
 */

import { discover, sessionLabel } from "./discover.js";
import { kindOfNode, stateOfRow, hasHostState } from "../store/mindmap-schema.js";
/* 分流标签索引（第 16 批）：宿主不给 rename ⇒ 显示名由插件侧补，且**只有一处真相源** */
import { readSplitIndex, applySplitLabels } from "../store/split-index.js";

/** 节点在导图画布上的布局常量（与 MindMap.js 共用，勿各自写死）
 * 🔴 2026-09-12 第三轮放大：节点从 200×56 调到 224×72 —— 用户要求"单个框要有展开
 *    折叠的选项"，而那一行控件（▾ 💬 ✚ 📂 ✥）需要纵向空间；框太矮会把它挤成
 *    第二个"看不见的三角"，等于没加。dx/dy 同步放大以保持间距比例。 */
export const LAYOUT = Object.freeze({
	x0: 48, y0: 44, dx: 272, dy: 96, nodeW: 224, nodeH: 72,
	/** 画布留白（适应视野时留出，避免节点贴边） */
	pad: 32,
	/** 画布最小尺寸（节点超出时由 treeBounds 撑大） */
	minW: 2600, minH: 1600
});

/* ══════════════════════════════════════════════════════════════════
 * 〇、规范行构造（两种宿主形状 → 同一份规范字段）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 把「宿主摘要」或「降级摘要」规范成统一字段。
 *
 * 🔴 为什么必须有这一步：宿主有**两种**会话形状，字段名不同 ——
 *    · `list.getSnapshot().byId[id]`：`id` / `parentId` / `displayTitle`
 *    · 内部 `summaries[]`（`flattenLineage` 的输入）：`sessionId` / `parentSessionId` / `title`
 *   旧实现只认后者 ⇒ 走 ctx 通道时**每一行都因 `sessionId === undefined` 被丢弃**，
 *   于是 rows 为 0 又看不出错（空树照样渲染）。规范层把两者收敛，缺一不可。
 *
 * ⚠️ 取不到的字段**保持 undefined**（不写 null / 不写 0）——
 *    "没有这个事实"与"这个事实是 0"在下游是两种渲染。
 *
 * @param {object} raw
 * @returns {object|null}
 */
export function normalizeSummary(raw) {
	if (!raw || typeof raw !== "object") return null;
	const sessionId = raw.sessionId !== undefined ? raw.sessionId : raw.id;
	if (!sessionId) return null;
	const parentSessionId = raw.parentSessionId !== undefined ? raw.parentSessionId : raw.parentId;
	const out = {
		sessionId: String(sessionId),
		title: raw.title || raw.displayTitle || sessionLabel(sessionId),
		// 宿主真值（可能整组缺失 ⇒ 保持 undefined，由 stateSource 标注）
		running: typeof raw.running === "boolean" ? raw.running : undefined,
		completed: raw.completed === true ? true : undefined,
		blank: typeof raw.blank === "boolean" ? raw.blank : undefined,
		updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
		agentPreset: raw.agentPreset,
		origin: raw.origin,
		seedLength: typeof raw.seedLength === "number" ? raw.seedLength
			: typeof raw.forkSeq === "number" ? raw.forkSeq : undefined
	};
	if (parentSessionId !== undefined && parentSessionId !== null && parentSessionId !== "") {
		out.parentSessionId = String(parentSessionId);
	}
	// 待处理：宿主值是字符串（approval / question / plan-review）；也可能是 Map/Set 展开的布尔
	if (raw.pendingInteraction !== undefined && raw.pendingInteraction !== null) {
		out.pending = typeof raw.pendingInteraction === "string" ? raw.pendingInteraction : "pending";
	}
	return out;
}

/* ══════════════════════════════════════════════════════════════════
 * 一、纯函数：摘要数组 → 树 / 扁平行
 *    与宿主 flattenLineage 同构（含环检测），并补上坐标与元素分类。
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 由会话摘要构建森林。
 * @param {Array<object>} summaries 宿主摘要（两种形状皆可，内部会规范化）
 * @param {object} [opts]
 * @param {string} [opts.currentId] 宿主当前会话 id（用于"当前对话"标记）
 * @returns {{roots:Array, rows:Array, byId:Object, cycles:string[], lineage:boolean}}
 *   rows 为渲染序（深度优先，父在前），每行含 `depth` / `x` / `y` / `kind` / `state` / `stateSource`
 */
export function buildBranchTree(summaries, opts = {}) {
	const list = (Array.isArray(summaries) ? summaries : []).map(normalizeSummary).filter(Boolean);
	const byId = new Map();
	for (const s of list) byId.set(s.sessionId, s);

	const children = new Map();
	const roots = [];
	for (const s of list) {
		const pid = s.parentSessionId;
		// 父不存在（父会话被删 / 属于别的账号）⇒ 当成根，而不是丢弃
		if (pid !== undefined && byId.has(pid)) {
			const arr = children.get(pid) || [];
			arr.push(s);
			children.set(pid, arr);
		} else roots.push(s);
	}

	const rows = [];
	const visited = new Set();
	const cycles = [];
	const walk = (s, depth, slotY) => {
		if (visited.has(s.sessionId)) { cycles.push(s.sessionId); return; }
		visited.add(s.sessionId);
		const childrenCount = (children.get(s.sessionId) || []).length;
		const parentMissing = Boolean(s.parentSessionId) && !byId.has(s.parentSessionId);
		const row = {
			sessionId: s.sessionId,
			parentSessionId: s.parentSessionId,
			parentMissing,
			title: s.title,
			depth,
			x: LAYOUT.x0 + depth * LAYOUT.dx,
			y: LAYOUT.y0 + slotY * LAYOUT.dy,
			w: LAYOUT.nodeW, h: LAYOUT.nodeH,
			childrenCount,
			// 宿主真值透传（undefined 表示"宿主没说"，不是 false）
			running: s.running, completed: s.completed, blank: s.blank,
			updatedAt: s.updatedAt, agentPreset: s.agentPreset, origin: s.origin,
			seedLength: s.seedLength, pending: s.pending,
			isCurrent: opts.currentId !== undefined && s.sessionId === opts.currentId
		};
		row.kind = kindOfNode(depth, childrenCount);
		row.state = stateOfRow(row);
		row.stateSource = hasHostState(row) ? "host" : "inferred";
		rows.push(row);
		const kids = children.get(s.sessionId) || [];
		let i = 0;
		for (const kid of kids) { walk(kid, depth + 1, slotY + i + 1); i += 1; }
	};
	let slot = 0;
	for (const root of roots) { walk(root, 0, slot); slot += 1; }
	// 未访问到的（环内节点）也输出，避免"静默消失"
	for (const s of list) if (!visited.has(s.sessionId)) { walk(s, 0, slot); slot += 1; }

	// 边：父 → 子（仅当父在 byId 内）
	const edges = rows
		.filter((r) => r.parentSessionId && byId.has(r.parentSessionId))
		.map((r) => ({ from: r.parentSessionId, to: r.sessionId }));

	// 血缘是否可用：存在任一条真实父子边即为真（降级通道的边是伪造的 ws: 父）
	const lineage = edges.some((e) => !String(e.from).startsWith("ws:"));

	return { roots, rows, edges, byId: Object.fromEntries(byId), cycles, lineage };
}

/**
 * 折叠过滤（纯函数）。
 * @param {Array} rows buildBranchTree().rows
 * @param {Set<string>|Array<string>} collapsed 被折叠的节点 id 集合
 * @returns {Array} 可见行（顺序不变）
 */
export function visibleRows(rows, collapsed) {
	const set = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
	if (!set.size) return rows;
	const hidden = new Set();
	const out = [];
	for (const r of rows) {
		if (r.parentSessionId && hidden.has(r.parentSessionId)) { hidden.add(r.sessionId); continue; }
		if (set.has(r.sessionId)) hidden.add(r.sessionId);
		out.push(r);
	}
	return out;
}

/**
 * 祖先链（纯函数）—— 选中节点到根的路径，用于连线高亮。
 * @returns {Set<string>} 链上节点 id（含自身）
 */
export function ancestorChain(rows, id) {
	const set = new Set();
	if (!id) return set;
	const byId = new Map(rows.map((r) => [r.sessionId, r]));
	let cur = byId.get(id);
	let guard = 0;
	while (cur && guard < 200) {
		set.add(cur.sessionId);
		cur = cur.parentSessionId ? byId.get(cur.parentSessionId) : undefined;
		guard += 1;
	}
	return set;
}

/** 包围盒（纯函数）—— 适应视野与小地图共用 */
export function treeBounds(rows) {
	if (!rows || !rows.length) return { x: 0, y: 0, w: LAYOUT.minW, h: LAYOUT.minH };
	let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
	for (const r of rows) {
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + LAYOUT.nodeW);
		maxY = Math.max(maxY, r.y + LAYOUT.nodeH);
	}
	const x = Math.max(0, minX - LAYOUT.pad);
	const y = Math.max(0, minY - LAYOUT.pad);
	return {
		x, y,
		w: Math.min(LAYOUT.minW, Math.max(maxX + LAYOUT.pad - x, 320)),
		h: Math.min(LAYOUT.minH, Math.max(maxY + LAYOUT.pad - y, 240))
	};
}

/** 命中过滤（纯函数）：标题 / 会话号 子串匹配（大小写不敏感） */
export function matchRows(rows, q) {
	const s = String(q || "").trim().toLowerCase();
	if (!s) return null;
	return new Set(rows.filter((r) => {
		const t = String(r.title || "").toLowerCase();
		const id = String(r.sessionId || "").toLowerCase();
		return t.indexOf(s) >= 0 || id.indexOf(s) >= 0;
	}).map((r) => r.sessionId));
}

/* ══════════════════════════════════════════════════════════════════
 * 二、数据源读取（A: ctx.sessions 优先 → B: discover 降级）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 从 cordis `ctx.sessions` 读出会话摘要数组 + 当前会话。
 *
 * 🔴 形状按宿主源码取证（`dsh-client-runtime/lib/client.js`）：
 *    `ctx.sessions.list.getSnapshot()` → `{ ids, current, byId }`，
 *    `byId[id] = { id, displayTitle, running, completed?, blank, updatedAt, parentId?, … }`。
 *
 * 🔴 **为什么有两级读取**（2026-09-12 定位到的静默降级根因）：
 *    cordis 的 `ctx.<service>` 是 Proxy 陷阱，**未在 `inject` 声明的服务会直接抛错**
 *    （`@deepseek-ai/cordis/lib/index.js:675` → `cannot get property "sessions" without inject`）。
 *    旧实现外层一个 try/catch 把这句话吞了并返回 null，于是**降级无声** ——
 *    界面上只看到"血缘不可用"，看不出是"我们自己没声明注入"。
 *    ⇒ 修法三层：① 产物 `exports.inject` 补 `"sessions"`（声明真实依赖）；
 *       ② 这里先试 `ctx.sessions`，再退到 `ctx.get("sessions")`
 *          （cordis 的 `get()` 是**不要求 inject** 的读取口，
 *           见同文件 `:755` "Read a service from the store without the inject requirement"）；
 *       ③ 逐级写 `diag`，让原因能显示在 UI 的 title 上。
 *
 * @param {object} ctx
 * @param {object} [diag] 出参：逐级失败原因（降级不再无声）
 * @returns {Array|null}
 */
export function readSessionsFromCtx(ctx, diag) {
	const d = diag || {};
	d.hasCtx = Boolean(ctx);
	if (!ctx) { d.error = "apply(ctx) 未收到 ctx"; return null; }
	try {
		let svc = null;
		try {
			svc = ctx.sessions;                     // 路径 A：已声明 inject ⇒ 可用
		} catch (e) {
			d.injectMiss = String((e && e.message) || e);   // 记下"未声明 inject"这句话本身
		}
		if (!svc && typeof ctx.get === "function") {
			try { svc = ctx.get("sessions"); d.viaGet = true; } catch (e) { d.getError = String((e && e.message) || e); }
		}
		d.hasSessions = Boolean(svc);
		if (!svc) { d.error = d.injectMiss || d.getError || "ctx.sessions 不可用（也未通过 ctx.get 取得）"; return null; }
		const list = svc.list;
		d.hasList = Boolean(list);
		if (!list) { d.error = "ctx.sessions.list 不可用"; return null; }
		d.hasGetSnapshot = typeof list.getSnapshot === "function";
		if (!d.hasGetSnapshot) { d.error = "ctx.sessions.list.getSnapshot 不是函数"; return null; }
		const snap = list.getSnapshot();
		d.snapKeys = snap && typeof snap === "object" ? Object.keys(snap).slice(0, 8) : null;
		if (!snap) { d.error = "getSnapshot() 返回空"; return null; }
		d.currentId = snap.current;
		let arr = null;
		if (snap.byId && typeof snap.byId === "object") arr = Object.keys(snap.byId).map((k) => snap.byId[k]).filter(Boolean);
		else if (Array.isArray(snap.list)) arr = snap.list;
		else if (Array.isArray(snap)) arr = snap;
		d.rawCount = arr ? arr.length : 0;
		if (!arr || !arr.length) { d.error = "快照里没有会话"; return null; }
		d.sampleKeys = arr[0] ? Object.keys(arr[0]).slice(0, 12) : null;
		return arr;
	} catch (e) {
		d.error = "读取 ctx.sessions 抛错：" + ((e && e.message) || e);
		return null;
	}
}

/** 降级：由 discover 的 workspaces/sessions 造"无血缘"的平铺树 */
async function fallbackFromDiscover() {
	try {
		const d = await discover();
		const summaries = [];
		for (const ws of d.workspaces || []) {
			const wsId = "ws:" + ws.id;
			summaries.push({ sessionId: wsId, title: ws.name, parentSessionId: undefined, isWorkspace: true });
			for (const sid of ws.sessionIds || []) {
				summaries.push({ sessionId: sid, title: sessionLabel(sid), parentSessionId: wsId });
			}
		}
		return { summaries, source: d.source, lineage: false };
	} catch (e) {
		return { summaries: [], source: "none", lineage: false };
	}
}

/* ══════════════════════════════════════════════════════════════════
 * 三、状态与订阅
 * ══════════════════════════════════════════════════════════════════ */

let ctxRef = null;
let cache = { tree: null, source: "none", lineage: false, at: 0, diag: { error: "尚未刷新" } };
const listeners = new Set();

function notify() { for (const fn of listeners) { try { fn(cache); } catch (e) { /* 忽略单个订阅者异常 */ } } }
export function subscribeBranch(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getBranchSnapshot() { return cache; }

/** 降级说明（给 UI 挂 title 用；成功时返回空串） */
export function degradationReason() {
	if (cache.source === "none") return "尚无数据（未刷新）";
	if (cache.lineage) return "";
	const d = cache.diag || {};
	return d.error ? String(d.error) : "宿主未提供 parentId（该工作区确实没有分支）";
}

/**
 * 刷新血缘树。
 * @returns {Promise<{tree:object, source:string, lineage:boolean, diag:object}>}
 */
export async function refreshBranchTree() {
	const diag = {};
	let tree = null;
	let source = "none";
	let lineage = false;
	const fromCtx = readSessionsFromCtx(ctxRef, diag);
	if (fromCtx && fromCtx.length) {
		tree = buildBranchTree(fromCtx, { currentId: diag.currentId });
		source = "ctx.sessions";
		lineage = tree.lineage;
	} else {
		const fb = await fallbackFromDiscover();
		tree = buildBranchTree(fb.summaries);
		source = fb.source;
	}
	/* 🔴 分流标签覆盖**必须在这里做**（唯一摄取点）：
	 *    血缘每一份都从宿主重新读，标题每一份都由宿主决定；插件侧给分流分支起的名字
	 *    若不在这一处补上，导图 / 右侧详情 / 总监页就会**各显示一套**（重复即漂移）。
	 *    `diag.splitApplied` 如实上报覆盖条数 —— 0 条也要能看出来（例如索引被清空）。 */
	const split = applySplitLabels(tree, readSplitIndex());
	diag.splitApplied = split.applied;
	diag.splitDims = split.dims;
	cache = { tree, source, lineage, at: Date.now(), diag };
	notify();
	return cache;
}

/**
 * 读"宿主当前会话 id"（**不重建树**，只读快照的一个字段）。
 *
 * 🔴 为什么需要它（用户原文）：「我点击左侧，点入不同的对话切进去就是和当前对话
 *    有关的流转信息」—— 宿主在左栏点会话时**不会**通知插件（没有事件通道），
 *    而 `buildBranchTree` 的 `isCurrent` 只在构建那一刻成立。
 *    ⇒ 只能轮询这一个字段（同步、单字段读取，代价可忽略），
 *      变化时通知订阅者，让右侧面板与流转列表跟着切。
 * @returns {string|null}
 */
export function currentSessionId() {
	const svc = sessionsService();
	if (!svc || !svc.list || typeof svc.list.getSnapshot !== "function") return null;
	try {
		const s = svc.list.getSnapshot();
		return s && s.current ? String(s.current) : null;
	} catch (e) { return null; }
}

let currentTimer = null;
const currentWatchers = new Set();

/**
 * 观察"宿主当前会话"变化（**唯一的跟随通道**）。
 * 首次订阅立即回调一次当前值（订阅者不必自己先读一次 —— 这是上一轮
 * "先 refresh 后 subscribe ⇒ 永远停在初始快照"那类事故的固化防线）。
 * @param {(id:string|null)=>void} cb
 * @param {number} [ms] 轮询间隔，默认 800ms
 * @returns {() => void} 取消订阅（最后一个订阅者退出时自动停表）
 */
export function watchCurrentSession(cb, ms) {
	if (typeof cb !== "function") return () => { };
	currentWatchers.add(cb);
	if (!currentTimer) {
		let last = currentSessionId();
		currentTimer = setInterval(() => {
			const cur = currentSessionId();
			if (cur === last) return;
			last = cur;
			for (const fn of currentWatchers) { try { fn(cur); } catch (e) { /* 单个订阅者异常不影响其他 */ } }
		}, Math.max(300, Number(ms) || 800));
		if (currentTimer && typeof currentTimer.unref === "function") currentTimer.unref();
	}
	try { cb(currentSessionId()); } catch (e) { /* 首次回调异常不阻断订阅 */ }
	return () => {
		currentWatchers.delete(cb);
		if (!currentWatchers.size && currentTimer) { clearInterval(currentTimer); currentTimer = null; }
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 四、动作面（只在有真实宿主接口时暴露 —— 不做"点了只弹 toast"）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 取 sessions 服务（两级：`ctx.sessions` 优先 → `ctx.get("sessions")` 兜底）。
 * 失败返回 null，**不抛** —— 调用方一律以"能力不可用"处理并给出原因。
 * （为什么必须两级：见 readSessionsFromCtx 的 🔴 段）
 */
function sessionsService() {
	if (!ctxRef) return null;
	try { const s = ctxRef.sessions; if (s) return s; } catch (e) { /* 未声明 inject ⇒ 落到 ctx.get */ }
	try {
		if (typeof ctxRef.get === "function") return ctxRef.get("sessions") || null;
	} catch (e) { /* 两级都不可用 */ }
	return null;
}

/**
 * 宿主能力探测（供 UI 决定菜单项 enabled）。
 * 🔴 判据写在返回值里，UI 直接照用，不各自 `typeof` 猜。
 */
export function hostCapabilities() {
	const svc = sessionsService();
	return {
		available: Boolean(svc),
		open: Boolean(svc && typeof svc.open === "function"),
		fork: Boolean(svc && typeof svc.fork === "function"),
		create: Boolean(svc && typeof svc.create === "function"),
		// 取证：SessionRuntime 成员表里**没有**合并 / 删除 ⇒ 恒 false，菜单据此禁用
		merge: false,
		remove: false
	};
}

/** 打开某分支的原生对话（宿主 sessions.open） */
export async function openSession(sessionId) {
	const svc = sessionsService();
	if (!svc || typeof svc.open !== "function") return { ok: false, reason: "宿主未提供 sessions.open" };
	try {
		svc.open(sessionId);
		return { ok: true };
	} catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
}

/** 从某分支 fork 出新分支（宿主 sessions.fork），成功后立即刷新血缘 */
export async function forkBranch(sessionId) {
	const svc = sessionsService();
	if (!svc || typeof svc.fork !== "function") return { ok: false, reason: "宿主未提供 sessions.fork" };
	try {
		const res = await svc.fork({ sessionId });
		await refreshBranchTree();
		const childId = res && res.ok && res.value ? res.value.sessionId : undefined;
		if (childId) return { ok: true, sessionId: childId };
		return { ok: false, reason: (res && res.error && res.error.message) || "宿主未返回子会话 id" };
	} catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
}

/**
 * 新建一个**空白会话**（宿主 `sessions.create`）—— 第 16 批「自动分到不同对话分支」的落地口。
 *
 * 🔴 与 `forkBranch` 的分工（**别混用**，两者语义不同）：
 *    · `forkBranch(id)` —— 从某条会话**分叉**：新会话带 `parentId` 血缘 ⇒ 导图上挂在父节点之下
 *    · `createSession()` —— 建**独立**空白会话：无父 ⇒ 导图上是一条新根
 *    「按世界观 / 剧情分到不同对话分支」要的是**后者**：A1 世界观 与 A3 剧情 是**并列**的
 *    分工，不是"从某条消息分叉出来"。若用 fork，血缘会把它们串成一条链，
 *    读图的人会以为"剧情是从世界观分叉来的" —— **那是错的信息**。
 *
 * 🔴 宿主契约（`original/@deepseek-ai/dsh-client-runtime/lib/client.js:8144-8185`）：
 *    `create(opts = {})`，`opts` 支持三种形态 —— `{ workspaceId }` / `{ cwd }` / `{ cwd, sessionId? }`；
 *    注释原文：*"on success merge into summaries immediately (no wait for the next refresh).
 *    A created session is blank by definition"* ⇒ 返回即可读到，不必等刷新。
 *    🔴 **`opts` 一律不猜**：不传 `workspaceId` / `cwd` 时直接给 `{}`（宿主自行决定）。
 *      曾用 `workspaces.list` 快照去猜当前工作区 ⇒ 实测 `ok:false` 且拿不到 id（见下方注释）。
 *    🔴 **返回形态以实测为准**，不照抄注释 —— 本机实测是**裸字符串**会话 id，
 *      取值统一走 `resolveCreateId()`（注释里的 `{ok:true,value:{sessionId}}` 也要能认）。
 *
 * @param {{workspaceId?:string, cwd?:string, sessionId?:string}} [opts] 目标工作区 / 工作目录
 * @returns {Promise<{ok:boolean, sessionId?:string, attached?:boolean|null, reason?:string, via?:string, raw?:string}>}
 */
export async function createSession(opts = {}) {
	const svc = sessionsService();
	if (!svc || typeof svc.create !== "function") {
		return { ok: false, reason: "宿主未提供 sessions.create（能力探测见 hostCapabilities().create）" };
	}
	/* 入参分层（**不猜**）：
	 *   ① 调用方显式给了 `workspaceId` / `cwd` ⇒ 用它；
	 *   ② 否则一律传 `{}`，**由宿主自行决定**落到哪个工作区。
	 * 🔴 这里曾用 `currentWorkspaceId()` 去"猜"当前工作区并塞进 `workspaceId`。
	 *    真机实测（`_probe-create-raw.mjs`）：`via=current-workspace` 时
	 *    `sessions.create` 返回 `ok:false`、**且连 error.message / error.code 都没有**
	 *    （我们的 reason 只能退化成"宿主未返回新会话 id"），
	 *    而**会话照样被建出来**（分支树净增恰为 8）⇒ 8 条分支全被记成"失败"。
	 *    `workspaces.list` 快照里的 "current" 不保证是 `create` RPC 认可的 `workspaceId`；
	 *    猜错的入参会让宿主失败/建到别处，**比不传更难查**。 */
	const payload = {};
	let via = "host-decides";
	if (opts && opts.workspaceId) { payload.workspaceId = opts.workspaceId; via = "workspaceId"; }
	else if (opts && opts.cwd) { payload.cwd = opts.cwd; via = "cwd"; }
	if (opts && opts.sessionId) payload.sessionId = opts.sessionId;
	try {
		const res = await svc.create(payload);
		await refreshBranchTree();
		/* 🔴🔴 宿主 `create` 到底返回什么 —— **只信实测，不信注释**。
		 *    源码 `original/@deepseek-ai/dsh-client-runtime/lib/client.js:8159-8185` 的
		 *    注释与实现都写着"成功 ⇒ `{ ok:true, value:{ sessionId } }`"，
		 *    但**真机实测拿到的是裸字符串**：
		 *      `_probe-create-raw.mjs` ⇒ `{"ok":false,"reason":"宿主未返回新会话 id","via":"current-workspace"}`
		 *      `_probe-split-trace.mjs` ⇒ `宿主原始返回 "session-08b83f34-53ab-4faa-8bbc-3031036afa8b"`
		 *    后果：8 条会话**真的建出来了**（分支树净增恰为 8），却因为"形状不符"被逐条记成
		 *    「宿主未返回新会话 id」⇒ 读数 `made=0 / failed=8`、索引不写、导图无标记，
		 *    界面上与"什么都没发生"完全一样，而且**页面零异常**（最坏的一类：静默半成功）。
		 *    ⇒ 取值一律走 `resolveCreateId()`：**已知形态全收**，形状不明才如实报失败。 */
		const id = resolveCreateId(res);
		if (id) {
			/* `attached` 三态（true 挂上了 / false 宿主明说没挂上 / null 裸 id 无从判断）。
			 * 🔴 未知不许当成功也不许当失败 —— 写成 null，由调用侧决定要不要报（纪律 19）。 */
			const attached = typeof res === "string"
				? null
				: (res && res.ok ? true
					: (res && res.error && res.error.code === "workspace-attach-failed" ? false : null));
			return {
				ok: true, sessionId: id, via, attached,
				reason: attached === false ? "宿主 code=workspace-attach-failed：会话已建出，未挂到工作区" : ""
			};
		}
		const why = (res && res.error && (res.error.message || res.error.code))
			|| (res && res.reason) || "宿主未返回新会话 id";
		/* 🔴 失败原因必须**可证伪**（纪律 18）：曾出现"宿主返回 ok:false 但 message/code 全空"，
		 *    界面上只剩一句"建会话失败"，查不到任何线索。⇒ 把**原始返回**一并带出来。 */
		return { ok: false, reason: String(why), via, raw: safeJson(res) };
	} catch (e) {
		return { ok: false, reason: String((e && e.message) || e), via };
	}
}

/**
 * 从宿主 `sessions.create` / `sessions.fork` 的返回里取出**新会话 id**。
 *
 * 🔴 为什么不能只判一种形状：宿主实现在不同链路（Host 契约 / client 工程）下返回不同形态，
 *    而**注释与实现都可能不是调用端真正拿到的那个**。本轮真机实测（2026-09-16）：
 *      · `_probe-create-raw.mjs`      ⇒ `createSession({})` 拿到 `ok:false` + 「宿主未返回新会话 id」
 *      · `_probe-split-trace.mjs`     ⇒ 宿主**原始返回**是**裸字符串** `"session-08b83f34-…"`
 *    只认注释里的 `{ok:true,value:{sessionId}}` ⇒ 8 条会话建出来了却被记成失败。
 *    ⇒ 已知形态**全收**；全不匹配才返回空串（**不猜**，也不伪造 id）。
 *
 * 收下的形态（按实测出现频率排序）：
 *   ① 裸字符串 `"session-…"`（**本机实际形态**）
 *   ② `{ ok:true, value:"session-…" }`
 *   ③ `{ ok:true, value:{ sessionId } }`（源码注释所写形态）
 *   ④ `{ ok:false, error:{ code:"workspace-attach-failed", details:{ sessionId } } }`
 *      —— 会话已建出、未挂到工作区（宿主自己就把它当成功并入列表，见 `client.js:8631`）
 *   ⑤ `{ sessionId }` / `{ id }`
 *
 * @param {*} res 宿主原始返回
 * @returns {string} 新会话 id；取不到返回 `""`
 */
function resolveCreateId(res) {
	if (typeof res === "string") return res.trim();
	if (!res || typeof res !== "object") return "";
	if (res.ok && typeof res.value === "string") return res.value.trim();
	if (res.ok && res.value && res.value.sessionId) return String(res.value.sessionId);
	if (res.ok && res.sessionId) return String(res.sessionId);
	if (res.error && res.error.code === "workspace-attach-failed" && res.error.details && res.error.details.sessionId) {
		return String(res.error.details.sessionId);
	}
	if (res.sessionId) return String(res.sessionId);
	if (res.id) return String(res.id);
	return "";
}

/** 安全 JSON 化：循环引用 / 不可序列化时退化为 `String()` —— **绝不为了记日志再抛一次**。 */
function safeJson(v) {
	try {
		const s = JSON.stringify(v);
		if (s === undefined) return String(v);
		return s.length > 400 ? s.slice(0, 400) + "…" : s;
	} catch (e) { return String(v); }
}

/* ══════════════════════════════════════════════════════════════════
 * 五、全局契约
 * ══════════════════════════════════════════════════════════════════ */

/** 安装全局契约并绑定 ctx（由 client-entry 的 apply 调用） */
export function installBranchTreeApi(ctx) {
	ctxRef = ctx || null;
	const api = {
		LAYOUT, buildBranchTree, normalizeSummary, visibleRows, ancestorChain, treeBounds, matchRows,
		readSessionsFromCtx, refreshBranchTree, subscribeBranch, getBranchSnapshot,
		degradationReason, hostCapabilities, openSession, forkBranch, createSession,
		currentSessionId, watchCurrentSession
	};
	if (typeof window !== "undefined") window.__dshBranchTree = api;
	return api;
}
