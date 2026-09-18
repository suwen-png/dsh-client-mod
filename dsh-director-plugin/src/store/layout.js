/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：A11 布局 store（弹窗三态扩展版）
 * 引用：T-PLUG-015
 * 上游：bridge/host-director-column.js, bridge/nav-hook.js, client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/FloatDock.js, components/MindMap.js, mount.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/layout.js — A11 布局 store（弹窗三态扩展版）
 *
 * 迁移源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
 *   行范围：6439 ~ 6483（45 行）
 *   区块标记：`// ========== 总监对话模式 - 布局store（小窗宽度/折叠/焦点） ==========`
 *
 * 职责：小窗宽度 / 折叠状态 / 焦点目标 / 上下伸缩面板高度 / **弹窗三态** 的集中状态层。
 *
 * ⚠️ 兼容约束（R5）：持久化 key `dsh.director.layout` **必须原样保留**，
 *    改名将导致用户存量布局数据全部丢失。
 *
 * ── 本轮扩展（T-PLUG-015 弹窗形态，docs/10 §四 4.3）──────────────
 *   新增字段（**只增不改**，存量数据无这些键 ⇒ 读取端必须做默认值兜底）：
 *     `dialogOpen`      弹窗是否打开
 *     `dialogCollapsed` 整窗最小化（收成右下角 chip）—— 05 号文只设计了左右两栏折叠，
 *                       整窗最小化是**本轮新增**的第三态（docs/10 §4.3 标注 🆕）
 *     `activeNodeId`    当前展示的层级节点（全局 / 项目·文件夹 / 会话）
 *     `leftTab`         左面板分段：director（总监）/ levels（层级）/ agents（智能体）
 *   **既有字段语义不变**：`directorPanelCollapsed`（左栏）/ `chatPanelCollapsed`（右栏）/
 *     `directorPanelWidth` / `chatPanelWidth` / `focusTarget`。
 *
 *   边界与吸附（docs/11 §二 I8）：宽度 `clamp(180, 55%×视口)`；拖到 <180 自动吸附折叠；
 *   双击中缝复位 300/300。
 *
 * 全局契约（宿主 G1/G4 依赖，**不可改名**）：
 *   - `window.__directorLayoutStore` — 宿主 ChatView（client.js:7111）与 view-sync（client.js:9146）调用
 *   - `window.__directorFocusTarget` — setFocusTarget 同步写入（client.js:6469）
 */

export const DIRECTOR_LAYOUT_KEY = "dsh.director.layout";

/** 左/右栏宽度的边界（docs/10 §4.1） */
export const PANEL_MIN_WIDTH = 180;
/** 单栏最大占比（相对视口宽） */
export const PANEL_MAX_RATIO = 0.55;
/** 默认栏宽 */
export const PANEL_DEFAULT_WIDTH = 300;
/** 折叠后的竖条宽度 */
export const PANEL_RAIL_WIDTH = 40;

/* ── 第 6 批（V20 需求 5）：「R4 / R7 宽度自由拖拽」的边界 ──────────────────
 *  用户原话：「r4和r7的宽度都要允许自由拖拽」。
 *  改前 `COL_R4_W = 200` / `COL_R7_W = 210` 是写死在 DirectorPage 里的常量 ⇒ 拖不动。
 *  ⇒ 宽度搬进本 store（**与"在哪"同属一个语义域**，不新开持久化 key —— 理由同 mmPos）。
 *  ⚠️ 上下限不是"越小越好"：R4 里一行要放「描述 + 编号+日期靠右」两行文本，
 *     低于 140 会把编号挤成逐字竖排（第 6 批实测截图里就是那个形态）。 */
export const RAIL_WIDTH_MIN = 140;
export const RAIL_WIDTH_MAX = 420;
export const RAIL_WIDTH_DEFAULT = Object.freeze({ r4: 200, r7: 210 });

/* ── 第 6 批（V20 需求 3）：「未完成项可展开补说明」的存储 ─────────────────
 *  用户原话：「未完成任务我可以展开，增加补充说明之类的，在执行的时候读取尽量不影响上下文？
 *             不确定具体执行逻辑，怎么添加可以不影响上下文，如果可行的话」
 *
 *  🔴 **"不影响上下文"就是 O(1) 注入**：`director-run` 跑到某一步时**只读那一条**，
 *     不把整张补充说明表拼进 prompt。⇒ 键必须**能由 (作用域, 任务号) 直接算出**
 *     （不做全表扫描、不做模糊匹配），`scopeKey` 出自 `store/hierarchy.js` 的
 *     `scopeKeyOf()`（**唯一真相源**，总监页与工作台都调它，不许各算各的）。
 *
 *  ⚠️ 上限不是"防手滑"，是**防一条说明把五步 prompt 顶爆**：超长直接截断
 *     并把"已截断"事实告诉调用方（`truncated`），不静默丢字（纪律 19）。 */
export const TODO_NOTE_MAX_CHARS = 600;

/** 单条补充说明的键：`<scopeKey>::<taskId>`（纯函数，读写两端共用，避免各拼各的） */
export function todoNoteKey(scopeKey, taskId) {
	const s = String(scopeKey == null ? "" : scopeKey).trim();
	const t = String(taskId == null ? "" : taskId).trim();
	if (!s || !t) return "";
	return s + "::" + t;
}

/** 左面板分段（单一真相源，勿另写字面量）
 *
 * ── 第 38 轮：`LEVELS` → `MINDMAP`（用户原话：「**层级 tap 感觉没什么用, 隐藏掉,
 *    现在层级部分加上思维导图**」「按照点击的文件夹下的对话信息整理出的思维导图」）
 *
 * 🔴 `LEVELS` 常量**保留、不删**，理由二：
 *   ① 存量 localStorage 里可能有 `leftTab: "levels"` —— 删常量会让归一化无处可比；
 *   ② 层级管理（`DirectorHierarchy`：同步真实会话 / 整树分层总结 / 节点增删改）
 *      **是有真实能力的**，用户要的是"隐藏这个 tap"，不是"砍掉能力"（纪律 54）。
 *      它的入口降级到**导图段内的二级视图**，组件与 testid 全套保留。
 *   ⇒ 三段新序：**总监 / 导图 / 智能体**。`levels` 不是合法分段值了，读入时迁移。 */
export const LEFT_TAB = Object.freeze({
	DIRECTOR: "director", MINDMAP: "mindmap", AGENTS: "agents",
	/** @deprecated 仅用于**存量数据迁移**与旧闸门取值，不再是可设置的分段 */
	LEVELS: "levels"
});

/** 合法的分段值（`LEVELS` 不在其中 —— 它只作为迁移输入存在） */
export const LEFT_TABS_VALID = Object.freeze([LEFT_TAB.DIRECTOR, LEFT_TAB.MINDMAP, LEFT_TAB.AGENTS]);

/**
 * 分段值归一化（**纯函数**，读入与写入共用同一份判据）
 * @param {string} t
 * @returns {string} 合法分段值；`levels` 迁移为 `mindmap`；其余非法值退 `director`
 */
export function normalizeLeftTab(t) {
	const s = String(t == null ? "" : t);
	if (s === LEFT_TAB.LEVELS) return LEFT_TAB.MINDMAP; // 存量迁移
	return LEFT_TABS_VALID.indexOf(s) >= 0 ? s : LEFT_TAB.DIRECTOR;
}

/** 视口宽度（SSR / 测试环境兜底 1440） */
function viewportWidth() {
	try {
		if (typeof window !== "undefined" && window.innerWidth) return window.innerWidth;
	} catch (e) { /* 忽略 */ }
	return 1440;
}

/** 单栏宽度上限（按视口比例，且不低于下限，避免极小视口下 clamp 反向） */
export function maxPanelWidth() {
	return Math.max(PANEL_MIN_WIDTH, Math.round(viewportWidth() * PANEL_MAX_RATIO));
}

/**
 * 宽度钳制 + 吸附判定（docs/11 §二 I8）
 * @param {number} w 期望宽度
 * @returns {{width:number, collapse:boolean}} collapse=true 表示"拖到过窄 ⇒ 应吸附为折叠"
 */
export function clampPanelWidth(w) {
	const n = Number(w);
	if (!Number.isFinite(n) || n <= 0) return { width: PANEL_DEFAULT_WIDTH, collapse: false };
	if (n < PANEL_MIN_WIDTH) return { width: PANEL_MIN_WIDTH, collapse: true };
	return { width: Math.min(Math.round(n), maxPanelWidth()), collapse: false };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 执行状态窗口的**几何纯函数**（第 16 批 · 用户原话：
 *   「执行状态的窗口需要可以移动最小化,靠边缩进」）
 *
 * 🔴 全部是**纯函数**（不碰 DOM、不写 store、无副作用）⇒ 可离线单测，
 *    并且是 UI 与闸门**共用的同一份判据**（各写一份必然漂移）。
 * 🔴 视口与安全区由**调用方传入**，不在这里读 `window` —— 纪律 29：
 *    环境的量必须由环境读；纯函数自己去摸环境，单测就变成"测的是桩"。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 窗口三态（互斥）。`collapsed` 的语义与既有 `dialogCollapsed` 对齐：只剩标题条。 */
export const RUNNING_WIN_MODE = Object.freeze({
	EXPANDED: "expanded",
	COLLAPSED: "collapsed",
	DOCKED: "docked"
});

/** 贴边判定阈值（px）：拖动松手时距任一视口边**小于**它 ⇒ 吸附该边并缩进 */
export const RUNNING_WIN_SNAP_PX = 24;

/** 四边白名单（顺序即优先级：左右优先于上下 —— 竖条更省横向空间） */
export const RUNNING_WIN_DOCKS = Object.freeze(["left", "right", "top", "bottom"]);

/** 夹紧时的最小可见尺寸：保证"拖不出视口"且"头部仍抓得住" */
export const RUNNING_WIN_MIN_W = 180;
export const RUNNING_WIN_MIN_H = 26;

/** 视口可用区（含安全区 inset）—— 左右/上下四边收敛成矩形，供下面两个函数共用 */
function usableBox(view) {
	const vw = Number(view && view.vw) || 0;
	const vh = Number(view && view.vh) || 0;
	const l = Math.max(0, Number(view && view.insetLeft) || 0);
	const r = Math.max(0, Number(view && view.insetRight) || 0);
	const t = Math.max(0, Number(view && view.insetTop) || 0);
	const b = Math.max(0, Number(view && view.insetBottom) || 0);
	/* 极窄视口下 right 可能小于 left（inset 之和超过视口）⇒ 收敛成空区间而不是反向区间，
	 * 否则 max/min 会给出"左边比右边大"的坐标（表现为窗口跳到屏幕外）。 */
	return { L: l, T: t, R: Math.max(l, vw - r), B: Math.max(t, vh - b) };
}

/**
 * 把窗口左上角夹紧到视口可用区内。
 * @param {{x:number,y:number}} pos 期望左上角
 * @param {{w:number,h:number}} box 窗口自身尺寸
 * @param {{vw:number,vh:number,insetLeft?:number,insetRight?:number,insetTop?:number,insetBottom?:number}} view
 * @returns {{x:number,y:number,clampedX:boolean,clampedY:boolean}}
 *   `clamped*` 是给 UI 与断言用的：**"没动"与"被夹住"读数一样**，必须能区分（纪律 23）。
 */
export function clampWinPos(pos, box, view) {
	const { L, T, R, B } = usableBox(view);
	const w = Math.max(RUNNING_WIN_MIN_W, Number(box && box.w) || RUNNING_WIN_MIN_W);
	const h = Math.max(RUNNING_WIN_MIN_H, Number(box && box.h) || RUNNING_WIN_MIN_H);
	let x = Number(pos && pos.x);
	let y = Number(pos && pos.y);
	if (!Number.isFinite(x)) x = L;
	if (!Number.isFinite(y)) y = T;
	const maxX = Math.max(L, R - w);
	const maxY = Math.max(T, B - h);
	const cx = Math.min(Math.max(x, L), maxX);
	const cy = Math.min(Math.max(y, T), maxY);
	return { x: Math.round(cx), y: Math.round(cy), clampedX: cx !== x, clampedY: cy !== y };
}

/**
 * 贴边判定：窗口（pos 左上角 + box 尺寸）距某条视口边 < snapPx ⇒ 返回该边与吸附后坐标。
 * @returns {{dock:string,x:number,y:number}|null} 未贴边 ⇒ `null`（调用方据此**不做**任何吸附）
 */
export function snapWinEdge(pos, box, view, snapPx) {
	const { L, T, R, B } = usableBox(view);
	const snap = Number.isFinite(Number(snapPx)) ? Math.max(0, Number(snapPx)) : RUNNING_WIN_SNAP_PX;
	const w = Math.max(RUNNING_WIN_MIN_W, Number(box && box.w) || RUNNING_WIN_MIN_W);
	const h = Math.max(RUNNING_WIN_MIN_H, Number(box && box.h) || RUNNING_WIN_MIN_H);
	const x = Number(pos && pos.x);
	const y = Number(pos && pos.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	/* 距离按"最近的那条边"算；并列时按 RUNNING_WIN_DOCKS 的顺序（左右优先）。 */
	const cand = [
		{ dock: "left", d: Math.abs(x - L), x: L, y: y },
		{ dock: "right", d: Math.abs((x + w) - R), x: R - w, y: y },
		{ dock: "top", d: Math.abs(y - T), x: x, y: T },
		{ dock: "bottom", d: Math.abs((y + h) - B), x: x, y: B - h }
	];
	cand.sort((a, b) => (a.d - b.d) || (RUNNING_WIN_DOCKS.indexOf(a.dock) - RUNNING_WIN_DOCKS.indexOf(b.dock)));
	const best = cand[0];
	if (!best || best.d >= snap) return null;
	/* 吸附后的坐标仍要过一遍夹紧：贴右边时 `R - w` 可能小于 L（窗口比可用区还宽） */
	const fixed = clampWinPos({ x: best.x, y: best.y }, { w, h }, view);
	return { dock: best.dock, x: fixed.x, y: fixed.y };
}

/**
 * 三态状态机（纯）。**未知 action 一律原样返回**（不猜、不默认成某个态）。
 * @param {string} mode 当前态
 * @param {string} action "drag"（开始拖动 ⇒ 展开）| "min"（最小化）| "toggle"（点条体）| "snap"（松手贴边）
 * @returns {string} 新态
 */
export function nextWinMode(mode, action) {
	const cur = Object.values(RUNNING_WIN_MODE).indexOf(String(mode)) >= 0 ? String(mode) : RUNNING_WIN_MODE.COLLAPSED;
	const a = String(action || "");
	if (a === "drag") return RUNNING_WIN_MODE.EXPANDED;
	if (a === "min") return RUNNING_WIN_MODE.COLLAPSED;
	if (a === "snap") return RUNNING_WIN_MODE.DOCKED;
	if (a === "toggle") {
		return (cur === RUNNING_WIN_MODE.COLLAPSED || cur === RUNNING_WIN_MODE.DOCKED)
			? RUNNING_WIN_MODE.EXPANDED : RUNNING_WIN_MODE.COLLAPSED;
	}
	return cur;
}

const DEFAULTS = Object.freeze({
	// ── 05 号文既有字段（语义不变）──
	directorPanelWidth: PANEL_DEFAULT_WIDTH,
	chatPanelWidth: PANEL_DEFAULT_WIDTH,
	directorPanelCollapsed: false,
	chatPanelCollapsed: false,
	focusTarget: "director",
	// V7: 上下伸缩界面
	bottomPanelHeight: 180,
	bottomPanelCollapsed: true,
	topPanelCollapsed: false,
	// ── 本轮新增（弹窗三态）──
	dialogOpen: false,
	dialogCollapsed: false,
	activeNodeId: null,
	leftTab: LEFT_TAB.DIRECTOR,
	/* ── 第 38 轮新增：「固定」钉住态（用户：「总监页面增加固定」+「总监跳出来之后，
	 *    我在点击左侧的对话，这个总监页面不会变化」）────────────────────────
	 *  语义 = **锁定作用域 + 不缩回**（两件事都要，缺一不成立）：
	 *    · `pin=false`（默认）：侧栏点**文件夹/项目** → 刷新作用域并展开；
	 *                            侧栏点**对话** → 缩回（`dialogCollapsed=true`，作用域保留）。
	 *    · `pin=true`：侧栏点什么**都不动**（作用域逐字不变，也不缩回）。
	 *  ⚠️ 固定态下**弹窗内的作用域下拉照常可用** —— 用户要的是"侧栏点击不改我"，不是
	 *     "我再也没法换作用域"。把两者都锁死会把用户关在里面（死状态）。
	 *  ⚠️ 与 `railPinned`（R4/R7 的钉住）**是两件事**：那个管"面板要不要缩回成竖条"，
	 *     这个管"弹窗要不要跟着侧栏换作用域"。同名不同物 ⇒ 不复用字段（纪律 126 同族）。 */
	dialogPinned: false,
	/* ── 第 38 轮新增：弹窗内三个区块的折叠态（用户：「r2,r5,r6 都加上最小化窗口的功能」）──
	 *  形如 `{ r2:false, r5:false, r6:false }`。
	 *  🔴 与 `sectionCollapsed`（**总监页** R2/R4）**不是同一份** —— 两者是不同界面上的
	 *     不同区块（弹窗左栏 vs 总监页三栏），共用一份会让"在弹窗收起 R2"顺带把总监页的
	 *     R2 也收起来（用户没要求，且看起来像 bug）。故单开一份，键名也取得不一样。 */
	dialogSections: { r2: false, r5: false, r6: false },
	// ── 本轮新增（设计图工作室 · T-PLUG-018）──
	//  📐 设计图是**全屏覆盖层**（用户：「点击铺满全屏」），与弹窗三态无关，
	//     故单开一个布尔。打开时弹窗前端的浮层会让位（避免两层浮层叠着打架）。
	designStudioOpen: false,
	// 分支导图（血缘树）覆盖层。与设计图同为全屏层，但内容不同：
	//   导图 = 真实会话的分支血缘（消费 sessions.fork 写入的 meta.parentSession）
	//   设计图 = 手工编辑的界面稿（元素 + 交互逻辑）
	mindmapOpen: false,
	// 浮动按钮组里「思维导图」在前、「总监」在后（用户明确要求顺序）
	floatDockOpen: true,
	/* ── 本轮新增：导图节点的**用户摆放位置**（用户：思维导图的框不能动 需要可以移动）──
	 * 🔴 放这里而不是新开一个持久化 key：本 store 的语义就是"在哪"（宽度/折叠/焦点），
	 *    节点坐标同属"在哪"。再开第四个 key 只会让"复位"变成半复位。
	 * 🔴 只存**用户拖过的**节点（未拖过的走自动布局）⇒ 数据量最小、自动布局改动仍能生效。
	 *    形如 { "<sessionId>": { x, y } }
	 */
	mmPos: {},
	/* ── 第 37 轮新增：导图**按项目/维度分组**开关（用户：「按照项目分一个组，不然全堆在一起
	 *    看看太麻烦了」）—— 默认 **true**：用户提这条就是因为"全堆在一起"看不下去，
	 *    默认关掉等于让他每次进来都要手动开一次。
	 *    ⚠️ 开着分组时节点的基础 y 由分区重排 ⇒ 拖过的框（`mmPos`）**仍按用户摆放显示**
	 *    （用户意图优先，不做静默归位）；点「▦ 自动布局」才回到分区自动位。 */
	mmGroup: true,
	/* ── V17 P2：总监页 R2/R4 区域折叠偏好（跨会话持久化，首次默认全展开）──
	 *   只新增字段，不动既有键（R5）。形如 { r2:false, r4:false }。
	 *   🔴 2026-09-14 第 5 批：R6 已整块去除（用户：「R6 这一样都不要了」）⇒
	 *      UI 上再无写 `r6` 的入口。但**键仍保留** —— 用户的 localStorage 里可能
	 *      已有 `{r2,r4,r6}` 的存量值，删键会让"整体读入 + 按已知字段合并"这一步
	 *      丢掉一个曾存在的字段（下一轮再加回同名键时旧值就找不回来了）。
	 *      ⇒ 留键、摘入口；`setSectionCollapsed` 的白名单同样保留 r6 并注明原因。 */
	sectionCollapsed: { r2: false, r4: false, r6: false },
	/* ── 第 5 批新增：R4 / R7 的「左右缩回 · 弹出 · 固定」钉住态（V18 板块 E3）──
	 *   设计稿要求三处（对话 tap 的总监列 / 总监页 R4 / 总监页 R7）**共用同一份**，
	 *   不各写一套。`railExpanded` 是**易失**的（鼠标进出），故**不持久化**，
	 *   由组件本地 state 承担；这里只存用户显式"钉住"的偏好。形如 { r4:false, r7:false }。 */
	railPinned: { r4: false, r7: false },
	/* ── 第 6 批新增：R4 / R7 的**展开宽度**（V20 需求 5「允许自由拖拽」）──
	 *   形如 { r4:200, r7:210 }。搬进来之前是 DirectorPage 里的写死常量。
	 *   ⚠️ 与 `railPinned` 一样用「只合并已知字段 + 嵌套兜底」策略读入，
	 *      老用户的 localStorage 里没有这个键 ⇒ 走 DEFAULTS，不报错。 */
	railWidth: { r4: RAIL_WIDTH_DEFAULT.r4, r7: RAIL_WIDTH_DEFAULT.r7 },
	/* ── 第 6 批新增：未完成项的**补充说明**（V20 需求 3）──
	 *   形如 `{ "<scopeKey>::<taskId>": { note:"…", at:<ms> } }`。
	 *   ⚠️ 这是一张**按需增长**的表（每补一条多一个键），不是固定字段；
	 *      读入时**整表原样保留**（合并已知字段策略只适用于固定字段，
	 *      对映射表必须整体接管 —— 否则用户写的说明会在下次启动时被清空）。 */
	todoNotes: {},
	/* ── 第 6 批新增：每个作用域**正在执行的那一条**未完成项（V20 需求 3）──
	 *   形如 `{ "<scopeKey>": "<taskId>" }`。
	 *   🔴 为什么需要它：用户要的是「在执行的时候读取补充说明，**尽量不影响上下文**」。
	 *      要做到 O(1) 注入，执行链必须能**唯一确定**"现在跑的是哪一条任务" ——
	 *      靠标题模糊匹配（"现在在做的事"里出现的字）是不可证的（匹配错就注错）；
	 *      靠 `selectedItem` 也不行（那只是"正在看"，用户随时会点别条）。
	 *      ⇒ 由用户在详情卡里**显式**「设为当前任务」，一处真相源。
	 *   ⚠️ 与 `todoNotes` 同为映射表：整体接管 + 类型兜底。 */
	activeTasks: {},
	/* ── 第 6 批新增：对话页，宿主左栏（宿主渲染的「总监列」）的插件侧几何 ──
	 *   🔴 为什么必须**在插件 store 里**存这两个值，而不是只改宿主 store：
	 *      实测（`scripts/_probe-store-identity.mjs` / `_probe-panel-geometry.mjs`）——
	 *      宿主的 `useDirectorLayoutStore()` 是 `client.js:6479` 的**模块内闭包**，
	 *      订阅的是宿主**自己**那份 store；插件 `layout.js` 虽把同名对象挂到
	 *      `window.__directorLayoutStore`（后加载覆盖宿主 6478 行的赋值），但**宿主根本不读它**。
	 *      故：翻全局 store 的 `directorPanelCollapsed` 对宿主左栏**零影响**（实测宽 301px 不变）。
	 *      ⇒ 折叠/宽度必须由插件的 `bridge/host-director-column.js` **直接落到 DOM 几何**上，
	 *        这里只是那套几何的**唯一真相源**（用户点最小化 = 改这里）。
	 *   ⚠️ 复用既有 `directorPanelWidth` / `directorPanelCollapsed` 两个键（R5 冻结契约：
	 *      既有键**不得改名**），不新开键 —— 语义完全一致，只是执行者从宿主换成了插件。 */
	/* 总监记忆面板的**悬停展开延迟**（毫秒）。用户原话：
	 *   「增加一个秒数,目前太灵敏了 总监及以下面的有不同的记忆索引等 把这边部分逻辑完善掉,
	 *     这个固定也不好用需要修正, 还要可以上下调整高度」
	 *   宿主实现（client.js:7357）是 `onMouseEnter` **立即** `setBottomPanelCollapsed(false)`，
	 *   零延迟 ⇒ 鼠标扫过就弹。改为可配延迟，0 = 恢复宿主原行为（可回退）。 */
	memoryHoverDelayMs: 500,
	/* 总监记忆面板**内容区高度**（px）。宿主写死 `maxHeight:160`（client.js:7396）。
	 *   用户：「这个固定也不好用需要修正, 还要可以上下调整高度」⇒ 由本字段驱动，
	 *   并在面板上沿提供拖拽手柄写回这里。 */
	memoryPanelHeight: 160,
	/* 总监记忆面板是否被**锁定**（锁定 = 鼠标移出也不收回）。
	 *   与宿主全局 `window.__dshMemoryLocked` 是**同一件事的同一份真相**：
	 *   本字段持久化，宿主那个全局变量在 boot 时由我们按本字段回填。
	 *   🔴 宿主原实现（client.js:7367）的锁定点击是 `__dshMemoryLocked = !locked;
	 *      toggleBottomPanel();` —— 锁定时**仍翻转面板** ⇒ 「点锁定反而收起」。
	 *      本字段 + bridge 接管点击后，语义改为：加锁 = 保持展开；解锁 = 收起（不再翻转）。 */
	memoryLocked: false,
	/* ── 第 16 批（2026-09-16）：**执行状态窗口**的摆放与折叠（用户原话：
	 *    「执行状态的窗口需要可以移动最小化,靠边缩进」）────────────────────────
	 *  🔴 为什么进本 store：与 `mmPos` 同一个理由 —— 本 store 的语义就是"窗口/面板在哪、
	 *     什么状态"，窗口坐标同属"在哪"；另开一个 localStorage key 只会让"复位"变成半复位。
	 *  🔴 **只新增键，不动既有键**（R5 冻结契约：改名禁止、新增允许）。
	 *  形态：`{ x:number|null, y:number|null, mode:"expanded"|"collapsed"|"docked", dock:""|"left"|"right"|"top"|"bottom" }`
	 *   · `x/y === null` ⇒ **用默认位**（由组件按 dockReserve + 安全区实算），不写死坐标
	 *     —— 写死坐标会与浮动按钮组/窗口控件打架（浮组预留宽度是环境量，纪律 29）。
	 *   · `mode` 默认 **"collapsed"**：这是对上一轮 **A1 缺陷的根治**。A1 当时用
	 *     `pointer-events:none` 让点击穿透（治标，且使 title tooltip 失效）；
	 *     本批恢复交互能力（要能拖、能点最小化），改用**默认不展开**来保证
	 *     "不压在 R2.5 动作行上"——信息仍可见（collapsed 只收内容区，徽标与计数保留）。 */
	runningWin: { x: null, y: null, mode: "collapsed", dock: "" }
});

export function createDirectorLayoutStore() {
	let state = { ...DEFAULTS };
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DIRECTOR_LAYOUT_KEY) : null;
		if (raw) {
			// 🔴 只合并"已知字段"，忽略未知残留；缺字段由 DEFAULTS 兜底
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object") {
				for (const k of Object.keys(DEFAULTS)) {
					if (parsed[k] !== undefined) state[k] = parsed[k];
				}
			}
		}
	} catch (e) { /* 解析失败 → 用默认值 */ }
	// 嵌套对象兜底：老数据可能缺某个折叠键（未来新增 r8 等），与 DEFAULTS 合并而非整体替换
	state.sectionCollapsed = { ...DEFAULTS.sectionCollapsed, ...(state.sectionCollapsed || {}) };
	state.railPinned = { ...DEFAULTS.railPinned, ...(state.railPinned || {}) };
	/* 第 38 轮：弹窗固定态 + 弹窗内三区块折叠（同策略：嵌套合并 + 布尔值域兜底） */
	state.dialogSections = { ...DEFAULTS.dialogSections, ...(state.dialogSections || {}) };
	if (typeof state.dialogPinned !== "boolean") state.dialogPinned = DEFAULTS.dialogPinned;
	/* 🔴 第 38 轮：`leftTab` 必须**迁移**而不是原样读入。
	 *    存量值 `"levels"` 在新 UI 里**没有对应按钮** ⇒ 原样读入会让用户一打开就停在
	 *    一个"切不回去也点不到"的分段上（死状态，且看起来像坏了）。
	 *    `normalizeLeftTab` 是**纯函数**，读写两侧共用 ⇒ 不会出现两套判据。 */
	state.leftTab = normalizeLeftTab(state.leftTab);
	/* 布尔字段的值域兜底：上面的通用合并**不校验类型**，而 `"false"` 是**真值**
	 * ⇒ 被写坏成字符串的存量数据会让分组开关"打开着却读到开"，且**不报错**（纪律 19）。 */
	if (typeof state.mmGroup !== "boolean") state.mmGroup = DEFAULTS.mmGroup;
	/* 映射表类字段：**整体接管**（不是与 DEFAULTS 合并）—— 见 DEFAULTS 里的说明。
	 * 这里只做"类型兜底"：老数据没有该键 / 被写坏成非对象 ⇒ 退回空表，不抛。 */
	state.todoNotes = (state.todoNotes && typeof state.todoNotes === "object" && !Array.isArray(state.todoNotes))
		? { ...state.todoNotes } : {};
	state.activeTasks = (state.activeTasks && typeof state.activeTasks === "object" && !Array.isArray(state.activeTasks))
		? { ...state.activeTasks } : {};
	state.railWidth = { ...DEFAULTS.railWidth, ...(state.railWidth || {}) };
	/* 第 16 批：执行状态窗口的摆放 —— 与 `railWidth` 同策略（合并已知子键 + 类型兜底），
	 * 但多两步**值域**兜底：老数据里的 `mode` 若是未知字符串，直接塞给 UI 会渲染出
	 * "既不是展开也不是折叠"的第三形态，而且**不报错**（正是纪律 19 说的"无声降级"）。
	 * ⇒ 未知态回落默认态；`dock` 不在四边白名单里则清空。 */
	state.runningWin = { ...DEFAULTS.runningWin, ...(state.runningWin || {}) };
	if (Object.values(RUNNING_WIN_MODE).indexOf(String(state.runningWin.mode)) < 0) {
		state.runningWin = { ...state.runningWin, mode: DEFAULTS.runningWin.mode };
	}
	if (state.runningWin.dock && RUNNING_WIN_DOCKS.indexOf(String(state.runningWin.dock)) < 0) {
		state.runningWin = { ...state.runningWin, dock: "" };
	}
	const listeners = new Set();
	function notify() {
		try { if (typeof localStorage !== "undefined") localStorage.setItem(DIRECTOR_LAYOUT_KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式 */ }
		for (const fn of listeners) { try { fn(state); } catch (e) { /* 单个订阅者异常不影响其他 */ } }
	}
	/** 拖拽调宽：返回是否触发了吸附折叠（供 UI 反馈） */
	function applyWidth(key, w) {
		const { width, collapse } = clampPanelWidth(w);
		state = { ...state, [key]: width };
		if (collapse) {
			const ck = key === "directorPanelWidth" ? "directorPanelCollapsed" : "chatPanelCollapsed";
			state = { ...state, [ck]: true };
		}
		notify();
		return collapse;
	}
	return {
		getState: () => state,
		subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
		setDirectorWidth: (w) => { state = { ...state, directorPanelWidth: Math.max(180, Math.min(w, 600)) }; notify(); },
		setChatWidth: (w) => { state = { ...state, chatPanelWidth: Math.max(180, Math.min(w, 600)) }; notify(); },
		toggleDirectorCollapsed: () => { state = { ...state, directorPanelCollapsed: !state.directorPanelCollapsed }; notify(); },
		toggleChatCollapsed: () => { state = { ...state, chatPanelCollapsed: !state.chatPanelCollapsed }; notify(); },
		setFocusTarget: (target) => { state = { ...state, focusTarget: target }; notify(); if (typeof window !== "undefined") window.__directorFocusTarget = target; },
		// V7: 上下伸缩
		setBottomPanelHeight: (h) => { state = { ...state, bottomPanelHeight: Math.max(60, Math.min(h, 400)) }; notify(); },
		toggleBottomPanel: () => { state = { ...state, bottomPanelCollapsed: !state.bottomPanelCollapsed }; notify(); },
		setBottomPanelCollapsed: (v) => { state = { ...state, bottomPanelCollapsed: v }; notify(); },
		toggleTopPanel: () => { state = { ...state, topPanelCollapsed: !state.topPanelCollapsed }; notify(); },

		/* ── 本轮新增：弹窗三态 ─────────────────────────────── */

		/** 打开/关闭弹窗（关闭时同时解除整窗最小化，避免"关了但还是 chip"的困惑） */
		setDialogOpen: (v) => {
			state = { ...state, dialogOpen: Boolean(v), dialogCollapsed: v ? state.dialogCollapsed : false };
			notify();
		},
		toggleDialog: () => {
			state = { ...state, dialogOpen: !state.dialogOpen, dialogCollapsed: false };
			notify();
		},
		/** 整窗最小化 / 还原 */
		setDialogCollapsed: (v) => { state = { ...state, dialogCollapsed: Boolean(v), dialogOpen: true }; notify(); },
		toggleDialogCollapsed: () => { state = { ...state, dialogCollapsed: !state.dialogCollapsed, dialogOpen: true }; notify(); },
		/** 切换当前层级节点（要求 7 / 9） */
		setActiveNode: (nodeId) => { state = { ...state, activeNodeId: nodeId || null }; notify(); },

		/* ── 第 38 轮新增：弹窗固定态 + 弹窗内区块折叠 ─────────────────────── */

		/** 固定 / 取消固定（用户：「总监页面增加固定」）。
		 *  返回写入后的**实际值**，便于调用方与闸门回读（不假设写成功 —— 纪律 4）。 */
		setDialogPinned: (v) => {
			const next = Boolean(v);
			if (state.dialogPinned === next) return next;
			state = { ...state, dialogPinned: next };
			notify();
			if (typeof window !== "undefined") window.__directorDialogPinned = next;
			return next;
		},
		/** 固定 ⇄ 取消固定（同一个开关，与 `railPinned` 的交互语言一致：点一下切一次）。 */
		toggleDialogPinned: () => {
			const next = !state.dialogPinned;
			state = { ...state, dialogPinned: next };
			notify();
			if (typeof window !== "undefined") window.__directorDialogPinned = next;
			return next;
		},
		/** 第 38 轮：弹窗内 r2 / r5 / r6 三区块折叠（用户：「都加上最小化窗口的功能」）。
		 *  🔴 白名单只认这三个键；与总监页的 `setSectionCollapsed` 是**两份独立状态**
		 *     （见 DEFAULTS.dialogSections 的注释）。返回实际值供回读。 */
		setDialogSection: (key, v) => {
			const k = String(key || "");
			if (["r2", "r5", "r6"].indexOf(k) < 0) return false;
			const prev = state.dialogSections || {};
			const next = Boolean(v);
			if (prev[k] === next) return next;
			state = { ...state, dialogSections: { ...prev, [k]: next } };
			notify();
			return next;
		},
		/** 切换左面板分段 */
		setLeftTab: (t) => {
			state = { ...state, leftTab: normalizeLeftTab(t) };
			notify();
		},
		/** 拖拽调宽（带吸附：过窄自动折叠）。返回是否触发吸附 */
		dragDirectorWidth: (w) => applyWidth("directorPanelWidth", w),
		dragChatWidth: (w) => applyWidth("chatPanelWidth", w),
		/** 双击中缝复位 */
		resetPanelWidths: () => {
			state = { ...state, directorPanelWidth: PANEL_DEFAULT_WIDTH, chatPanelWidth: PANEL_DEFAULT_WIDTH, directorPanelCollapsed: false, chatPanelCollapsed: false };
			notify();
		},
		/** 全部复位（调试/测试用） */
		resetLayout: () => { state = { ...DEFAULTS }; notify(); },

		/* ── 本轮新增：设计图工作室（T-PLUG-018）──────────────── */
		/** 打开/关闭设计图工作室（全屏覆盖层；**不依赖 dialogOpen**） */
		setDesignStudio: (v) => { state = { ...state, designStudioOpen: Boolean(v) }; notify(); },
		toggleDesignStudio: () => { state = { ...state, designStudioOpen: !state.designStudioOpen }; notify(); },
		/** 浮动按钮组显隐 */
		setFloatDock: (v) => { state = { ...state, floatDockOpen: Boolean(v) }; notify(); },

		/* ── 本轮新增：分支导图覆盖层 ─────────────────────────── */
		setMindmap: (v) => { state = { ...state, mindmapOpen: Boolean(v) }; notify(); },
		toggleMindmap: () => { state = { ...state, mindmapOpen: !state.mindmapOpen }; notify(); },
		/**
		 * V17 P1：统一浮层切换入口（FloatDock 三按钮共用）。
		 * 打开目标浮层时关闭其他两个，避免多层浮层叠加；目标已打开则关闭（toggle）。
		 * @param {"design"|"mindmap"|"director"} type
		 */
		toggleOverlay: (type) => {
			const t = String(type || "");
			const next = { ...state, designStudioOpen: false, mindmapOpen: false, dialogOpen: false, dialogCollapsed: false };
			if (t === "design") next.designStudioOpen = !state.designStudioOpen;
			else if (t === "mindmap") next.mindmapOpen = !state.mindmapOpen;
			else if (t === "director") next.dialogOpen = !state.dialogOpen;
			else return false;
			state = next;
			notify();
			return true;
		},
		/**
		 * 关闭**所有**浮层（设计图工作室 / 思维导图 / 总监弹窗）—— 浮层关闭的**唯一真相源**。
		 *
		 * 为什么必须有（2026-09-14 第 6 批实测）：
		 *   三个浮层都是**全屏 / 大区域覆盖层**。任一开着时，它底下的元素全部被
		 *   `elementFromPoint` 判为"没被点到" ⇒ 其下所有点击与拖动**整体打空**，
		 *   而读数与"功能坏了"**一模一样**（实测命中：`hit:"ds-el"` + `inside:false`）。
		 *   这是真机 e2e 的经典假红形态，本次连跑时红时绿就是这么来的。
		 *
		 * 用途：① 自动化闸门**显式建立干净起点**；② 宿主 Esc 逐层退出时的收口。
		 * ⚠️ 会写盘（这四个键是持久化的）⇒ 调用方若需要，必须自行快照 + 还原（纪律 15）。
		 *
		 * @returns {boolean} 是否**确实发生了关闭**；本就全关 ⇒ false（便于断言"起点已干净"）
		 */
		closeFloatLayers: () => {
			if (!state.designStudioOpen && !state.mindmapOpen && !state.dialogOpen) return false;
			state = { ...state, designStudioOpen: false, mindmapOpen: false, dialogOpen: false, dialogCollapsed: false };
			notify();
			return true;
		},
		/** 记录用户把某个框拖到哪（**只改画面位置，不改血缘**） */
		setNodePos: (sessionId, pos) => {
			if (!sessionId || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
			state = { ...state, mmPos: { ...state.mmPos, [String(sessionId)]: { x: Math.round(pos.x), y: Math.round(pos.y) } } };
			notify();
			return true;
		},
		/** 单个框归位（回到自动布局） */
		clearNodePos: (sessionId) => {
			if (!state.mmPos || !(String(sessionId) in state.mmPos)) return false;
			const next = { ...state.mmPos };
			delete next[String(sessionId)];
			state = { ...state, mmPos: next };
			notify();
			return true;
		},
		/** 全部归位（"自动布局"按钮） */
		resetNodePos: () => {
			state = { ...state, mmPos: {} };
			notify();
			return true;
		},
		/** 第 37 轮：导图分组开关（按项目 / 维度分区）。返回**写入后的实际值**，
		 *  便于调用方与闸门回读校验（而不是假设写成功了 —— 纪律 4「写盘后回读」）。 */
		setMmGroup: (on) => {
			const next = Boolean(on);
			if (state.mmGroup === next) return next;
			state = { ...state, mmGroup: next };
			notify();
			return next;
		},
		/** V17 P2：切换/设置总监页区域折叠态（r2/r4/r6），并持久化
		 *  🔴 白名单**保留 r6**：R6 已整块去除（第 5 批），UI 上再无入口，
		 *     但存量 localStorage 里可能仍有该键 —— 保留它只是为了让"已知字段合并"
		 *     不丢字段，**不是还有 R6**。见 DEFAULTS.sectionCollapsed 的注释。 */
		setSectionCollapsed: (key, v) => {
			if (["r2", "r4", "r6"].indexOf(String(key)) < 0) return false;
			const prev = state.sectionCollapsed || {};
			state = { ...state, sectionCollapsed: { ...prev, [String(key)]: Boolean(v) } };
			notify();
			return true;
		},
		/** 第 5 批：钉住 / 取消钉住某一侧的缩回栏（"r4" 左 / "r7" 右）。
		 *  钉住 = 鼠标移出也不缩回（V18 板块 E2）。只接受这两个键，别的键一律 false。 */
		setRailPinned: (side, v) => {
			const k = String(side || "");
			if (k !== "r4" && k !== "r7") return false;
			const prev = state.railPinned || {};
			state = { ...state, railPinned: { ...prev, [k]: Boolean(v) } };
			notify();
			return true;
		},
		/** 读取某侧是否钉住（读端兜底：老数据缺该键 ⇒ false） */
		isRailPinned: (side) => Boolean((state.railPinned || {})[String(side || "")]),

		/* ── 第 38 轮：弹窗状态读取口 ──────────────────────────────────────
		 *  🔴 存在的理由不是"方便"，而是**让判据只有一份**：`nav-hook` 的 `navIntent()`
		 *     需要知道 pinned / dialogOpen，若从 `window` 或 DOM 属性反推，
		 *     就会长出第二套"当前是不是固定/开着"的判据 —— 那正是纪律 126 的形态
		 *     （同一语义两个标识符 ⇒ 隐式断链，且**不报错**）。 */
		isDialogPinned: () => Boolean(state.dialogPinned),
		isDialogOpen: () => Boolean(state.dialogOpen),
		isDialogCollapsed: () => Boolean(state.dialogCollapsed),
		/** 读某区块是否折叠（读端兜底：未知键 ⇒ false，不抛） */
		isDialogSectionCollapsed: (key) => Boolean((state.dialogSections || {})[String(key || "")]),

		/* ── 第 6 批：R4 / R7 宽度（V20 需求 5）───────────────────────────
		 *  🔴 只接受 r4 / r7 两个键（同 `setRailPinned` 的口径）：写进别的键会让
		 *     "整体读入 + 已知字段合并"多出一个**永远不会被用**的字段，属于静默垃圾。
		 *  🔴 clamp 在**写入端**做且返回真实落定值：拖动是高频的，
		 *     让调用方"猜自己拖到哪"必然会与画面不一致（读端兜底只在读端）。 */
		setRailWidth: (side, w) => {
			const k = String(side || "");
			if (k !== "r4" && k !== "r7") return false;
			const n = Number(w);
			const clamped = !Number.isFinite(n) ? RAIL_WIDTH_DEFAULT[k]
				: Math.max(RAIL_WIDTH_MIN, Math.min(Math.round(n), RAIL_WIDTH_MAX));
			const prev = state.railWidth || {};
			if (prev[k] === clamped) return false;
			state = { ...state, railWidth: { ...prev, [k]: clamped } };
			notify();
			return true;
		},
		/** 读取某侧展开宽度（读端兜底：老数据缺该键 ⇒ 默认值） */
		getRailWidth: (side) => {
			const k = String(side || "");
			const cur = (state.railWidth || {})[k];
			return Number.isFinite(cur) ? cur : (RAIL_WIDTH_DEFAULT[k] || RAIL_WIDTH_DEFAULT.r4);
		},

		/* ── 总监记忆面板的三个可配项（第 6 批需求 2）──────────────────────
		 * 🔴 为什么这三项要进 store 而不是散在 bridge 的模块变量里：
		 *    `bridge/host-director-column.js` 是**纯 DOM 执行层**（装监听、改几何），
		 *    它每次重装/重扫都要能读回"用户设置的是什么"。放模块变量 ⇒ 宿主重渲染
		 *    或插件热重载后设置丢失，而且**不报错**（表现为"秒数又变回默认"）。
		 *    放进 store ⇒ 与宽度/折叠一样持久化，且闸门可以直接读 store 交叉校验 DOM。
		 * ⚠️ 三个 setter 都做 clamp + 相等短路（相等不 notify，避免无谓重渲染）。 */
		/** 悬停展开延迟（毫秒）。0 = 立即（等价宿主原行为）。上限 3000 防"设成 1 分钟"。 */
		setMemoryHoverDelay: (ms) => {
			const n = Number(ms);
			const v = !Number.isFinite(n) ? 0 : Math.max(0, Math.min(Math.round(n), 3000));
			if (state.memoryHoverDelayMs === v) return v;
			state = { ...state, memoryHoverDelayMs: v };
			notify();
			return v;
		},
		getMemoryHoverDelay: () => {
			const v = state.memoryHoverDelayMs;
			return Number.isFinite(v) ? v : 0;
		},
		/** 记忆面板内容区高度（px）。下限 60（再小看不见内容）、上限 520（防顶穿整列）。 */
		setMemoryPanelHeight: (px) => {
			const n = Number(px);
			const v = !Number.isFinite(n) ? 160 : Math.max(60, Math.min(Math.round(n), 520));
			if (state.memoryPanelHeight === v) return v;
			state = { ...state, memoryPanelHeight: v };
			notify();
			return v;
		},
		getMemoryPanelHeight: () => {
			const v = state.memoryPanelHeight;
			return Number.isFinite(v) ? v : 160;
		},
		/** 记忆面板锁定态（true = 鼠标移出也不收回）。**同时**回填宿主那个全局变量。 */
		setMemoryLocked: (v) => {
			const b = Boolean(v);
			if (state.memoryLocked === b) return b;
			state = { ...state, memoryLocked: b };
			/* 宿主原实现读的是 `window.__dshMemoryLocked`（client.js:7357/7367）——
			 * 两侧必须同步，否则"插件的开关"与"宿主的行为"各说各话（同源纪律 27）。 */
			try { if (typeof window !== "undefined") window.__dshMemoryLocked = b; } catch (e) { /* 无 window（离线桩） */ }
			notify();
			return b;
		},
		getMemoryLocked: () => Boolean(state.memoryLocked),

		/* ── 第 16 批：执行状态窗口的摆放 / 三态（用户：「可以移动最小化,靠边缩进」）──────
		 * 🔴 三态与坐标**同一个写入端**：分开写会出现"坐标换了但 mode 没换"的中间态，
		 *    UI 上表现为"窗口跳到新位置却还缩着"，而且不报错。
		 * 🔴 相等短路（同 `setRailWidth` 的口径）：拖动是高频的，值没变就**不 notify**
		 *    —— 否则每个 mousemove 都触发一次订阅者重渲染（本项目踩过"每渲染一次重写日志"
		 *    的同型坑，见纪律 48）。 */
		/** 设窗口坐标（拖动中调用）。传 `null` = 回到默认位。返回是否真的变了 */
		setRunningWinPos: (pos) => {
			const cur = state.runningWin || DEFAULTS.runningWin;
			if (pos === null) {
				if (cur.x === null && cur.y === null) return false;
				state = { ...state, runningWin: { ...cur, x: null, y: null } };
				notify();
				return true;
			}
			const x = Number(pos && pos.x);
			const y = Number(pos && pos.y);
			if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
			const nx = Math.round(x);
			const ny = Math.round(y);
			if (cur.x === nx && cur.y === ny) return false;
			state = { ...state, runningWin: { ...cur, x: nx, y: ny } };
			notify();
			return true;
		},
		/** 设三态。`dock` **只在** `mode=docked` 时按四边白名单接受，其余情况一律清空 */
		setRunningWinMode: (mode, dock) => {
			const cur = state.runningWin || DEFAULTS.runningWin;
			const m = Object.values(RUNNING_WIN_MODE).indexOf(String(mode)) >= 0
				? String(mode) : RUNNING_WIN_MODE.COLLAPSED;
			const d = (m === RUNNING_WIN_MODE.DOCKED && RUNNING_WIN_DOCKS.indexOf(String(dock)) >= 0) ? String(dock) : "";
			if (cur.mode === m && String(cur.dock || "") === d) return false;
			state = { ...state, runningWin: { ...cur, mode: m, dock: d } };
			notify();
			return true;
		},
		/** 三态迁移的**唯一入口**（状态机走纯函数 `nextWinMode`，不在 UI 里各写一份 if） */
		applyRunningWinAction: (action) => {
			const cur = state.runningWin || DEFAULTS.runningWin;
			const m = nextWinMode(cur.mode, action);
			/* 离开 docked ⇒ 清掉 dock：不留"展开态却还标着贴左边"的矛盾数据 */
			const d = m === RUNNING_WIN_MODE.DOCKED ? String(cur.dock || "") : "";
			if (cur.mode === m && String(cur.dock || "") === d) return false;
			state = { ...state, runningWin: { ...cur, mode: m, dock: d } };
			notify();
			return true;
		},
		/** 读（返回副本，防调用方改到 store 内部对象） */
		getRunningWin: () => ({ ...(state.runningWin || DEFAULTS.runningWin) }),
		/** 复位：坐标回默认位 + 三态回 collapsed（双击头部"归位"与测试用） */
		resetRunningWin: () => {
			state = { ...state, runningWin: { ...DEFAULTS.runningWin } };
			notify();
			return true;
		},

		/* ── 未完成项补充说明（V20 需求 3）────────────────────────────────
		 * 🔴 三个方法都走 `todoNoteKey()`（**唯一真相源**）——
		 *    读写两端各拼一次键 = 迟早一端口拼错、另一端读不到，
		 *    表现是"写进去了但执行时读不到"，而且**不报错**。 */
		/** 写入一条补充说明。空串 = 删除该条（不是存一条空记录）。返回 {ok, note, at, truncated} */
		setTodoNote: (scopeKey, taskId, text) => {
			const k = todoNoteKey(scopeKey, taskId);
			if (!k) return { ok: false, why: "bad-key" };
			const raw = String(text == null ? "" : text);
			const trimmed = raw.trim();
			const prev = state.todoNotes || {};
			if (!trimmed) {
				if (!(k in prev)) return { ok: false, why: "empty" };
				const next = { ...prev }; delete next[k];
				state = { ...state, todoNotes: next };
				notify();
				return { ok: true, removed: true };
			}
			const truncated = trimmed.length > TODO_NOTE_MAX_CHARS;
			const note = truncated ? trimmed.slice(0, TODO_NOTE_MAX_CHARS) : trimmed;
			const at = Date.now();
			state = { ...state, todoNotes: { ...prev, [k]: { note, at } } };
			notify();
			return { ok: true, note, at, truncated };
		},
		/** 读一条。**执行链只调这个**（O(1)，不看全表） */
		getTodoNote: (scopeKey, taskId) => {
			const k = todoNoteKey(scopeKey, taskId);
			if (!k) return null;
			const row = (state.todoNotes || {})[k];
			return (row && typeof row.note === "string" && row.note) ? { note: row.note, at: row.at || null } : null;
		},
		/** 列某作用域下的全部说明（**只给 UI 用**，执行链不许调 —— 那会变成 O(n) 注入） */
		listTodoNotes: (scopeKey) => {
			const s = String(scopeKey == null ? "" : scopeKey).trim();
			const out = [];
			if (!s) return out;
			const prefix = s + "::";
			const all = state.todoNotes || {};
			for (const k of Object.keys(all)) {
				if (k.indexOf(prefix) === 0) out.push({ taskId: k.slice(prefix.length), note: all[k].note, at: all[k].at || null });
			}
			return out;
		},
		/** 显式删除（与 setTodoNote("") 等价，供 UI 的「清除」按钮用）。
		 *  ⚠️ 不反向调用 `directorLayoutStore.setTodoNote` —— 那会形成对
		 *      "本工厂之外的单例"的隐式依赖（测试里用 createDirectorLayoutStore()
		 *      造第二个实例时，删除会**写到另一个实例上**，且不报错）。 */
		clearTodoNote: (scopeKey, taskId) => {
			const k = todoNoteKey(scopeKey, taskId);
			if (!k) return false;
			const prev = state.todoNotes || {};
			if (!(k in prev)) return false;
			const next = { ...prev }; delete next[k];
			state = { ...state, todoNotes: next };
			notify();
			return true;
		},
		/* ── 每个作用域"正在执行的那一条"（执行链 O(1) 注入的定位依据）──── */
		/** 设为当前任务；传空 = 清除。返回落定后的 taskId（或 null） */
		setActiveTask: (scopeKey, taskId) => {
			const s = String(scopeKey == null ? "" : scopeKey).trim();
			if (!s) return null;
			const t = String(taskId == null ? "" : taskId).trim();
			const prev = state.activeTasks || {};
			if (!t) {
				if (!(s in prev)) return null;
				const next = { ...prev }; delete next[s];
				state = { ...state, activeTasks: next };
				notify();
				return null;
			}
			if (prev[s] === t) return t;
			state = { ...state, activeTasks: { ...prev, [s]: t } };
			notify();
			return t;
		},
		getActiveTask: (scopeKey) => {
			const s = String(scopeKey == null ? "" : scopeKey).trim();
			if (!s) return null;
			const t = (state.activeTasks || {})[s];
			return (typeof t === "string" && t) ? t : null;
		},
		/** **执行链的唯一取数口**：当前任务 + 它的补充说明，一起给出去。
		 *  没设当前任务 / 没有说明 ⇒ `null`（调用方据此**如实说明"没有可注入的补充"**，
		 *  不许编一段占位内容顶替 —— 纪律 19）。 */
		getActiveTaskNote: (scopeKey) => {
			const s = String(scopeKey == null ? "" : scopeKey).trim();
			const taskId = (state.activeTasks || {})[s];
			if (typeof taskId !== "string" || !taskId) return null;
			const row = (state.todoNotes || {})[todoNoteKey(s, taskId)];
			const note = (row && typeof row.note === "string" && row.note) ? row.note : "";
			return { taskId, note, hasNote: !!note };
		}
	};
}

/** 单例 + 挂载全局（宿主依赖 window.__directorLayoutStore） */
export const directorLayoutStore = createDirectorLayoutStore();
if (typeof window !== "undefined") window.__directorLayoutStore = directorLayoutStore;
