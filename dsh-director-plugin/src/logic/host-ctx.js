/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：宿主 cordis 服务读取的**唯一实现**
 * 引用：—
 * 上游：bridge/nav-hook.js, client-entry.js, logic/branch-tree.js, logic/director-inherit.js, logic/discover.js, logic/sync.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/host-ctx.js — 宿主 cordis 服务读取的**唯一实现**
 *
 * ── 为什么必须收在一处（纪律 126）────────────────────────────────
 *   「会话显示名」「会话父级（分支血缘）」「工作区真实名」这三件事，
 *   原先是**三处各自实现、且两处错**：
 *     · `logic/sync.js` 用 `sessionLabel(sessionId)`（截断的**会话 id**）
 *       当会话节点名 ⇒ 总监弹窗的层级下拉里显示的是**会话 id**，不是会话文本。
 *     · `logic/discover.js` 用 `"工作区 " + shortId(workspaceId)`（截断的 **uuid**）
 *       当工作区名 ⇒ 与宿主侧栏显示的真实文件夹名**对不上** ⇒
 *       `bridge/nav-hook.js` 的名称匹配只有「未分组」能命中（用户实测症状）。
 *     · 「谁 fork 了谁」只有 `logic/branch-tree.js` 读过。
 *   三处只要有一处口径变了，另一处必然静默过期 ⇒ 全部收敛到本模块。
 *
 * ── 数据源（宿主源码取证，非猜）──────────────────────────────────
 *   · `ctx.sessions.list.getSnapshot()` → `{ ids, current, byId }`
 *       `byId[id] = { id, displayTitle, running, blank, updatedAt, parentId? }`
 *       取证：`workspace/@deepseek-ai/dsh-client-runtime/lib/client.js`（`sessions.list`）
 *   · `ctx.workspaces.list()` → 工作区实体数组，实体含 `id` / `path` / `title`
 *       取证：`resources/host/node_modules/@deepseek-ai/dsh-workspace/lib/index.js`
 *              `list()`（同步投影，**不做持久化读**）· `types/entity.js` 的 `get title()` / `path`
 *   · 宿主侧栏显示的**就是 `workspace.title`**（不是 basename）——
 *       取证：`dsh-client-ui-workspace/lib/client.js:159`
 *             `buildGroup(workspace.workspaceId, …, workspace.title, …)`
 *       （`workspaceLabel(cwd)` = basename 只用于 title 缺失的兜底面）
 *
 * ── 🔴 inject 与 ctx.get 的差别（别删任何一条路径）────────────────
 *   cordis 的 `ctx.<service>` 是 Proxy 陷阱：**未在 `inject` 声明的服务直接抛**
 *   `cannot get property "x" without inject`；而 `ctx.get("x")` 是
 *   「不要求 inject 的读取口」⇒ 两级都试，并把失败原因写进 `diag`（降级不再无声）。
 *
 * ⚠️ 但 **`ctx.get` 不是万能的兜底**——2026-09-19 真机实证（`_probe-r42.mjs`）：
 *   `ctx.get("workspaces")` 返回的对象**没有 `list` 方法**
 *   （diag: `hasService=true / viaGet=true / "ctx.workspaces.list 不是函数"`），
 *   即那不是该服务本身 ⇒ **只声明 inject 不够、只靠 ctx.get 也不够**。
 *   凡"读到对象但形状不对"的，一律由**调用方**校验形状并写 `diag.error`
 *   （见 `workspaceEntities` —— 它显式检查 `typeof svc.list === "function"`），
 *   这样降级有据、不会被当成"读到了"。
 */

/** 宿主 cordis ctx（由 `installBranchTreeApi(ctx)` 一并写入 —— 构建模板已传） */
let hostCtx = null;

/** 写入 host ctx（幂等；`apply(ctx)` 时调用一次） */
export function setHostCtx(ctx) {
	hostCtx = ctx || null;
	return hostCtx;
}

/** 读 host ctx（未装载时为 null —— 所有读取函数都必须能容忍） */
export function getHostCtx() { return hostCtx; }

/**
 * 取一个 cordis 服务（两级：直读 → `ctx.get`）。
 * @returns {object|null}
 */
export function hostService(key, ctx, diag) {
	const c = ctx || hostCtx;
	const d = diag || {};
	d.hasCtx = Boolean(c);
	if (!c) { d.error = "apply(ctx) 未收到 ctx"; return null; }
	let svc = null;
	try {
		svc = c[key];                                   // 路径 A：已声明 inject ⇒ 可用
	} catch (e) {
		d.injectMiss = String((e && e.message) || e);    // 记下"未声明 inject"这句话本身
	}
	if (!svc && typeof c.get === "function") {
		try { svc = c.get(key); d.viaGet = true; } catch (e) { d.getError = String((e && e.message) || e); }
	}
	d.hasService = Boolean(svc);
	if (!svc) d.error = d.injectMiss || d.getError || ("ctx." + key + " 不可用（也未通过 ctx.get 取得）");
	return svc || null;
}

/* ══════════════════════════════════════════════════════════════════
 * 一、会话（显示名 / 分支血缘）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 从 cordis `ctx.sessions` 读出会话摘要数组。
 *
 * ⚠️ 本函数**原样迁自** `logic/branch-tree.js`（行为逐字保持 —— 那里的
 *    `window.__dshBranchTree.readSessionsFromCtx` 是既有闸门的契约口，迁走后
 *    仍由 branch-tree **re-export**，调用方零改动）。
 *    迁走的理由：会话标题（本模块需求 2）与血缘（需求 3）也必须读同一份快照，
 *    否则会出现"树上有血缘、下拉里没有"这类两处口径不一致（纪律 126）。
 *
 * @param {object} ctx
 * @param {object} [diag] 出参：逐级失败原因（降级不再无声）
 * @returns {Array|null}
 */
export function readSessionsFromCtx(ctx, diag) {
	const d = diag || {};
	const svc = hostService("sessions", ctx, d);
	if (!svc) return null;
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
}

/** 会话摘要 → sessionId 键的映射（未装载时返回空 Map，**不抛**） */
export function sessionIndex(ctx, diag) {
	const out = new Map();
	const arr = readSessionsFromCtx(ctx || hostCtx, diag);
	if (!arr) return out;
	for (const s of arr) {
		if (!s) continue;
		const id = s.id != null ? String(s.id) : "";
		if (id) out.set(id, s);
	}
	return out;
}

/**
 * 会话**显示文本**（宿主口径：`displayTitle`）。
 *
 * 🔴 需求 2 的正解：「总监中的文档选择 现在里面的是会话ID ⇒ 改成会话文本」。
 *    宿主 `dsh-client-ui-workspace` 的 `sessionTitle(s) = s.blank ? "New Session" : s.displayTitle`
 *    ⇒ 插件侧必须取同一个量；取不到才退回 id 型标签（`fallback`）。
 *
 * @param {string} sessionId
 * @param {(id:string)=>string} [fallback] 缺标题时的兜底（默认返回空串，由调用方决定）
 * @param {Map} [index] 预建的 `sessionIndex()`（**批量场景必须传**：否则 N 次调用 = N 次
 *        全量快照扫描，O(N²)；判据仍是这一处，只是把"读快照"的开销提到循环外）
 * @returns {string}
 */
export function sessionDisplayName(sessionId, fallback, index) {
	const id = String(sessionId || "");
	const idx = index instanceof Map ? index : sessionIndex();
	const s = id ? idx.get(id) : null;
	const t = s && s.displayTitle != null ? String(s.displayTitle).trim() : "";
	if (t) return t;
	return typeof fallback === "function" ? String(fallback(id) || "") : "";
}

/**
 * 会话的**分支父级**（宿主 `parentId`）—— 需求 3 的血缘根基。
 * @returns {string|null}
 */
export function sessionParentId(sessionId) {
	const id = String(sessionId || "");
	if (!id) return null;
	const s = sessionIndex().get(id);
	const p = s && s.parentId != null ? String(s.parentId) : "";
	return p || null;
}

/**
 * 血缘链：`[自身, 父, 祖父, …]`（会话级；长度有界，防脏数据成环死循环）。
 * @param {string} sessionId
 * @param {number} [limit=8]
 * @returns {string[]}
 */
export function sessionChain(sessionId, limit = 8) {
	const out = [];
	const seen = new Set();
	let cur = String(sessionId || "");
	while (cur && out.length < limit && !seen.has(cur)) {
		seen.add(cur);
		out.push(cur);
		const p = sessionParentId(cur);
		if (!p || p === cur) break;
		cur = p;
	}
	return out;
}

/* ══════════════════════════════════════════════════════════════════
 * 二、工作区（真实显示名）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 工作区实体数组（失败返回 null —— 调用方按降级处理）。
 *
 * 🔴 形状来自**宿主源码实证**（`dsh-client-runtime/lib/client.js` 的
 *   `var WorkspaceRuntime = class { /** UI-facing immutable projection *\/ list; ... }`）：
 *   `ctx.workspaces.list` 是 `createSnapshotStore({ items, archivedSessionIds, state,
 *   phase, error, baselinesReady, recentWorkspaceId })` 的**字段**，**不是方法**。
 *   ⇒ 正确读法 = `ctx.workspaces.list.getSnapshot().items`，与 `ctx.sessions.list`
 *      **同款口径**（sessions 侧也走 `getSnapshot()`）。
 *
 * ⚠️ 踩过的坑（2026-09-19 真机铁证，别再回去）：曾按 `svc.list()` 调用 ⇒
 *   `typeof svc.list !== "function"` ⇒ **每次都在第一行降级返回 null** ⇒ 需求 4
 *   「所有文件夹都要有总监弹窗」静默退回旧名「工作区 <uuid8>」⇒ 侧栏匹配必然失配。
 *   读数形态：`diag: { hasService:true, error:"ctx.workspaces.list 不是函数" }`。
 */
export function workspaceEntities(ctx, diag) {
	const svc = hostService("workspaces", ctx, diag);
	if (!svc) {
		if (diag && !diag.error) diag.error = "无 workspaces 服务（inject 缺失或宿主未提供）";
		return null;
	}
	/* ① 正式口径：list 是快照 store ⇒ 取 getSnapshot().items */
	const store = svc.list;
	if (store && typeof store.getSnapshot === "function") {
		try {
			const snap = store.getSnapshot();
			/* 🔴 diag 必须带上 `itemsLen`：曾出现"走上这条分支、却没报 error、count 仍为 0"
			 *   的情形 —— 没有这个数字就**分不清**"items 真空"与"实体字段读不出"，
			 *   只能靠再猜一轮（本仓纪律：降级/异常必须自带可分辨的读数）。 */
			const raw = snap && Array.isArray(snap.items) ? snap.items : null;
			if (diag) diag.itemsLen = raw ? raw.length : -1;
			const items = raw;
			if (items) {
				if (diag) diag.via = "list.getSnapshot().items";
				if (diag) diag.phase = snap.phase;
				if (diag) diag.firstKeys = items.length && items[0] ? Object.keys(items[0]).slice(0, 12) : [];
				return items;
			}
			if (diag) diag.error = "workspaces.list 快照里没有 items 数组";
			return null;
		} catch (e) {
			if (diag) diag.error = "workspaces.list.getSnapshot() 抛错：" + ((e && e.message) || e);
			return null;
		}
	}
	/* ② 兼容：万一某版本把 list 做成方法（旧假设），仍可读 —— 但不能只留这一条 */
	if (typeof store === "function") {
		try {
			const list = store.call(svc);
			if (diag) diag.via = "list()";
			return Array.isArray(list) ? list : null;
		} catch (e) {
			if (diag) diag.error = "workspaces.list() 抛错：" + ((e && e.message) || e);
			return null;
		}
	}
	if (diag) diag.error = "ctx.workspaces.list 既不是快照 store 也不是函数";
	return null;
}

/** 路径 basename（两种分隔符都收；与宿主 `workspaceLabel` 同规则） */
export function pathBasename(p) {
	const s = String(p == null ? "" : p).replace(/[/\\]+$/, "");
	if (!s) return "";
	const parts = s.split(/[/\\]/);
	const base = parts[parts.length - 1];
	return base || s;
}

/**
 * 工作区的**显示名**：`title` → `basename(path)` → null。
 * 🔴 与宿主同规则（`title` 优先，`basename` 兜底）—— 顺序不可反：
 *    宿主侧栏渲染的是 `workspace.title`，拿 basename 当主名会让
 *    "同名不同路径"的两种情况张冠李戴（宿主文档明说 *Different canonical paths
 *    may share a display title*）。
 */
export function workspaceDisplayName(ws) {
	if (!ws) return null;
	const t = ws.title != null ? String(ws.title).trim() : "";
	if (t) return t;
	const b = pathBasename(ws.path);
	return b || null;
}

/**
 * `workspaceId → 显示名`（需求 4 的正解）。
 * @returns {Map<string,string>} 读不到时返回**空 Map**（调用方据此走兜底，不静默错）
 */
export function workspaceNameById(ctx, diag) {
	const out = new Map();
	const list = workspaceEntities(ctx, diag);
	if (!list) return out;
	for (const ws of list) {
		if (!ws) continue;
		/* 🔴 **字段名以宿主为准：`workspaceId`**（`dsh-client-runtime` 的
		 *   `buildGroup(workspace.workspaceId, workspace.workspaceId, workspace.path,
		 *    Date.parse(workspace.createdAt), workspace.title, members, "account")`）。
		 *   真机铁证（`logs/_r42y-probe.out`）：服务里确有 2 条、`via` 也走通了，
		 *   但 `count` 恒为 0 —— 因为这里原写 `ws.id`，而实体**没有 `id` 字段**
		 *   ⇒ 每条都被 `if (!id) continue` 跳过 ⇒ 空 Map ⇒ 需求 4 静默退回旧名。
		 *   `id` 仅作**兼容回落**（万一某版本改了字段名），不得反过来。 */
		const rawId = ws.workspaceId != null && String(ws.workspaceId) ? ws.workspaceId : ws.id;
		const id = rawId != null ? String(rawId) : "";
		if (!id) continue;
		const n = workspaceDisplayName(ws);
		if (n) out.set(id, n);
	}
	return out;
}

/**
 * 工作区节点的**别名集**（name 之外还能被侧栏点击文本命中的写法）。
 *
 * 🔴 为什么需要别名：`bridge/nav-hook.js` 靠**点击行文本**匹配节点。
 *    侧栏显示 `title`，而 title 可能为空（那时宿主回落 basename）—— 只认一个
 *    写法就会在"另一种情况"下静默失配（正是本轮用户症状的成因）。
 *    别名把**所有可能显示的写法**都列上，匹配面变宽但**判据不变窄**
 *    （仍然要求"行文本与节点有确定对应"，不是模糊猜测）。
 *
 * @param {{id:string, title?:string, path?:string}} ws
 * @param {string} [legacyName] 旧命名（`工作区 <id前8>`）—— 保住既有脚本/存量引用
 * @returns {string[]}
 */
export function workspaceAliases(ws, legacyName) {
	const out = [];
	const push = (v) => {
		const s = String(v == null ? "" : v).trim();
		if (s && out.indexOf(s) < 0) out.push(s);
	};
	if (ws) {
		push(workspaceDisplayName(ws));
		push(pathBasename(ws.path));
		if (ws.title != null) push(ws.title);
	}
	push(legacyName);
	return out;
}

/** 安装全局契约（供真机套件零猜测读取；纯只读） */
export function installHostCtxApi(ctx) {
	if (ctx) setHostCtx(ctx);
	if (typeof window === "undefined") return null;
	window.__dshHostCtx = {
		setHostCtx, getHostCtx, hostService, readSessionsFromCtx, sessionIndex,
		sessionDisplayName, sessionParentId, sessionChain,
		workspaceEntities, workspaceDisplayName, workspaceNameById, workspaceAliases, pathBasename,
		/* 诊断快照：一次性把"读到没有 / 为什么没有"摊开（真机套件不必逐函数试） */
		probe: () => {
			const sdiag = {}; const wdiag = {};
			const idx = sessionIndex(null, sdiag);
			const wm = workspaceNameById(null, wdiag);
			const sample = [];
			idx.forEach((v, k) => { if (sample.length < 3) sample.push({ id: k, displayTitle: v && v.displayTitle, parentId: v && v.parentId }); });
			const wsSample = [];
			wm.forEach((v, k) => { if (wsSample.length < 3) wsSample.push({ id: k, name: v }); });
			return {
				hasCtx: Boolean(hostCtx),
				sessions: { count: idx.size, diag: sdiag, sample },
				workspaces: { count: wm.size, diag: wdiag, sample: wsSample }
			};
		}
	};
	return window.__dshHostCtx;
}
