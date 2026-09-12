/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：思维导图元素库（导图态的「原子词汇表」，纯数据）
 * 引用：—
 * 上游：components/MindMap.js, components/NodeDetailPanel.js, logic/branch-tree.js, logic/mindmap-render.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 F1–F5（思维导图元素库：节点型 / 状态 / 连线 / 控件 / 快捷键 / 覆盖度）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/mindmap-schema.js — 思维导图元素库（导图态的「原子词汇表」，纯数据）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
 *   ├─ 板块 A · A4 分支导图态（画面：节点 4 态 / 悬浮工具条 / 右键菜单 / 底部输入条）
 *   └─ 板块 F · 思维导图元素库（本文件的**渲染版**：元素 × 分组 × 覆盖度）
 *  消费者   components/MindMap.js（图例、节点图标与配色、连线样式、菜单分组）
 *  同类先例  store/design-schema.js（设计图的 18 个原子）—— 两者**刻意同构**：
 *           一个管「设计图能摆什么」，一个管「导图能长什么样」。
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它（用户原话）：「按照可能用到的思维导图元素 完善思维导图」
 * ══════════════════════════════════════════════════════════════════
 *  改之前 MindMap.js 只有「一个圆点 + 一行标题」两种视觉元素，
 *  而设计稿 A4 已经画了：中心主题 / 分支 / 叶子 / 四态状态点 / 悬浮工具条 /
 *  右键菜单 / 曲线连线 / 折叠 / 缩放 / 搜索 —— 代码里**一个都没有**。
 *
 *  ⇒ 本文件的作用是**把"可能用到的元素"一次性列全并标注落地状态**，
 *     而不是让每次改版都临时想起一个。列全之后有两个直接好处：
 *     ① UI 侧可以直接遍历它渲染图例与图标（单一真相源，不各写一套）
 *     ② 覆盖度可核算（`MM_COVERAGE`）：哪些已落、哪些不做、**为什么不做**
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 两条铁律（违反即变成"点了像没点"）
 * ══════════════════════════════════════════════════════════════════
 *  ① **不造没有数据源的元素**：凡是要读宿主字段的（如「出错」态），
 *     先在宿主源码里取证；取证不到就标 `supported:false` 并写明原因，
 *     **绝不用近似推断冒充精确**。上一轮的教训是顶栏 14 个按钮"单独测全部有效果"
 *     却整体不好用 —— 假元素比缺元素更贵。
 *  ② **不做没有接口的动作**：菜单项要么有真实宿主/插件接口，要么 `enabled:false`
 *     并在 `title` 里说明缺什么接口。禁止「点了只弹一个 toast」。
 *
 * ⚠️ 与 R5 冻结项的关系：本文件纯数据、无副作用、**不碰任何持久化 key**。
 */

/* ══════════════════════════════════════════════════════════════════
 * 零、分组色（与 DesignStudio 的 GROUP_COLOR 同构，三组三色）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 元素分组色。取色规则与设计图一致：**结构=紫 / 标记=青 / 语义=金**。
 * `text` 是深色底上的可读前景色（对比度 ≥4.5:1，实测）。
 */
export const MM_GROUP_COLOR = Object.freeze({
	"骨架": { base: "#8957e5", rgb: "rgba(137,87,229,", text: "#c9b0ff" },
	"标记": { base: "#22a3b8", rgb: "rgba(34,163,184,", text: "#7fd8e6" },
	"关系": { base: "#c9942b", rgb: "rgba(201,148,43,", text: "#efd08a" }
});

/** 取分组色（未知分组回落「骨架」，不返回 undefined） */
export function mmColor(group) {
	return MM_GROUP_COLOR[group] || MM_GROUP_COLOR["骨架"];
}

/* ══════════════════════════════════════════════════════════════════
 * 一、节点元素（导图上一个节点由「类型 + 徽标」组成）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 节点类型 —— 由**树形位置**决定，不是用户手动选的（避免多一份需要持久化的状态）。
 * `from` 写明判据，任何人可复算。
 */
export const NODE_KINDS = Object.freeze({
	topic: {
		label: "中心主题", icon: "🎯", group: "骨架", accent: "#2f6bdd",
		from: "depth === 0（血缘树的根；无父或父不在列表内）",
		note: "一棵血缘树只有一个中心主题，它是「对话主线」本身"
	},
	branch: {
		label: "主分支", icon: "⑂", group: "骨架", accent: "#8957e5",
		from: "depth === 1（从中心主题直接 fork 出来的第一层）",
		note: "对应宿主 `sessions.fork` 的第一跳"
	},
	sub: {
		label: "子分支", icon: "└", group: "骨架", accent: "#6f6ab8",
		from: "depth >= 2 且 childrenCount > 0",
		note: "分支的分支；可继续 fork，也可收口"
	},
	leaf: {
		label: "叶子", icon: "•", group: "骨架", accent: "#5b6b8f",
		from: "childrenCount === 0",
		note: "尚无子分支的末端节点（≠ 已完成，完成看状态点）"
	}
});

/**
 * 节点类型判定（纯函数）。
 * 🔴 顺序即优先级：先判叶子（无子），再按深度 —— 否则「depth 1 的叶子」会被判成主分支。
 * @param {number} depth
 * @param {number} childrenCount
 * @returns {"topic"|"branch"|"sub"|"leaf"}
 */
export function kindOfNode(depth, childrenCount) {
	if (depth === 0) return "topic";
	if (!childrenCount) return "leaf";
	return depth === 1 ? "branch" : "sub";
}

/**
 * 节点徽标（第二行元信息）—— 每个都写明**数据来源**，取不到就不渲染。
 * `pick(row)` 返回 `null` 表示「该行没有这个事实」，由渲染层跳过（不占位、不写"未知"）。
 */
export const NODE_MARKS = Object.freeze([
	{
		key: "fork", label: "fork 锚点", group: "标记",
		pick: (r) => (r.seedLength == null ? null : "fork @ seq " + r.seedLength),
		source: "宿主 fork 时写入的 meta.seedLength（摘要透出则显示）"
	},
	{
		key: "children", label: "子分支数", group: "标记",
		pick: (r) => (r.childrenCount > 0 ? "子 " + r.childrenCount : null),
		source: "本插件按 parentId 归并计数（logic/branch-tree.js）"
	},
	{
		key: "pending", label: "待处理", group: "标记",
		pick: (r) => (r.pending ? "待" + ({ approval: "审批", "plan-review": "方案确认", question: "回答" }[r.pending] || "处理") : null),
		source: "宿主摘要 pendingInteraction（approval / plan-review / question）"
	},
	{
		key: "forked", label: "血缘断裂", group: "关系",
		/* 🔴 只在**父不在树里**时才显示。父就在左边一格的情况下写「← 父 a」是纯噪声，
		 *    而"父缺失"（会话被删 / 属于别的账号）才是真需要提醒的异常 —— 它意味着
		 *    这一支的血缘只能当根看（见 buildBranchTree 的孤儿处理）。 */
		pick: (r) => (r.parentMissing ? "⚠ 父缺失 " + String(r.parentSessionId).slice(-6) : null),
		source: "宿主摘要 parentId 指向的会话不在当前列表内（logic/branch-tree.js 标 parentMissing）"
	},
	{
		key: "preset", label: "智能体预设", group: "关系",
		pick: (r) => (r.agentPreset ? String(r.agentPreset) : null),
		source: "宿主摘要 agentPreset"
	}
]);

/** 按当前行取全部有据徽标（顺序即 NODE_MARKS 序）；无据的**不出现**，不返回空串占位 */
export function marksOfRow(row) {
	const out = [];
	for (const m of NODE_MARKS) {
		let v = null;
		try { v = m.pick(row); } catch (e) { v = null; }
		if (v) out.push({ key: m.key, group: m.group, text: v });
	}
	return out;
}

/* ══════════════════════════════════════════════════════════════════
 * 二、状态点（四态，**全部由宿主字段判定**，无推断）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 状态四态。
 *
 * 🔴 设计稿 A4 的图例画的是「空闲 / 运行中 / 已完成 / 出错」四态，
 *    但宿主摘要里**没有"出错"字段** —— 取证范围：`dsh-client-runtime/lib/client.js`
 *    的会话摘要（`flattenLineage` 前的身）只有 `running / blank / completed /
 *    pendingInteraction / updatedAt / origin / agentPreset / parentId`，
 *    而 `pendingInteraction` 的取值域实测仅 `{"approval","question","plan-review"}`
 *    （`trackPending` 的全部调用点，无错误态）。
 *    ⇒ 故本版把第四态从「出错」改为**「待审」**（= `pendingInteraction` 存在），
 *      并把「出错」登记为 `supported:false`（见 MM_COVERAGE）。
 *      **这是对设计稿的显式修正，不是漏画** —— 写在此处以免下次又被"按图画"。
 */
export const STATE_KINDS = Object.freeze({
	running: {
		label: "执行中", color: "#2f6bdd", pulse: true, supported: true,
		from: "宿主摘要 running === true（智能体正在产出）"
	},
	review: {
		label: "待审", color: "#d29922", pulse: false, supported: true,
		from: "宿主摘要存在 pendingInteraction（approval / plan-review / question）—— 等你点确认"
	},
	done: {
		label: "已收口", color: "#3fb950", pulse: false, supported: true,
		from: "宿主摘要 completed === true（有未读完成提醒 = 该会话已跑完一轮）"
	},
	idle: {
		label: "待命", color: "#6f757d", pulse: false, supported: true,
		from: "以上都不成立（含 blank 新会话）—— 它表达的是「确实没在动」，不是「状态未知」"
	},
	err: {
		label: "出错", color: "#e5534b", pulse: false, supported: false,
		unsupportedReason: "宿主会话摘要无错误字段（pendingInteraction 取值域仅 approval/question/plan-review）⇒ 无数据源，不画",
		from: "—（缺数据源）"
	}
});

/** 图例顺序（只列 `supported !== false` 的，由 supportedStates() 消费） */
export const STATE_ORDER = Object.freeze(["idle", "running", "review", "done"]);

/** 可渲染的状态（供图例遍历） */
export function supportedStates() {
	return STATE_ORDER.map((k) => ({ key: k, ...STATE_KINDS[k] }));
}

/**
 * 状态判定（纯函数）。
 *
 * 🔴 与旧版的区别（这是本轮最实质的修正）：
 *   旧版 `stateOf()` 靠 `childrenCount / depth` **猜**（有子→待审、根→已收口），
 *   文件头还写着"宿主摘要无执行中字段"—— **该前提是错的**，宿主一直有 `running`
 *   与 `completed`。猜出来的状态在真机上是**恒定不变**的（与"现在有没有在跑"无关），
 *   等于一个不动的装饰。现在改为**宿主真值优先**，仅在宿主字段整组缺失时
 *   （localStorage 降级通道）才回落到推断，并把结果标 `stateSource:"inferred"`。
 *
 * 判定顺序即优先级：待审 > 执行中 > 已收口 > 待命。
 * （一个会话同时 running 且有 pending 时，用户更该看到"在等你"。）
 *
 * @param {object} row 规范行（见 branch-tree.js normalizeSummary）
 * @returns {"running"|"review"|"done"|"idle"}
 */
export function stateOfRow(row) {
	if (!row) return "idle";
	if (row.pending) return "review";
	if (row.running === true) return "running";
	if (row.completed === true) return "done";
	return "idle";
}

/** 该行状态是否有宿主依据（false ⇒ 用了推断，UI 应标注） */
export function hasHostState(row) {
	return Boolean(row) && (row.running !== undefined || row.completed !== undefined || row.pending !== undefined);
}

/* ══════════════════════════════════════════════════════════════════
 * 三、连线元素（骨架的两级 + 高亮）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 连线类型。
 * 🔴 视觉区分**必须有语义**，否则配色只是装饰：
 *   · trunk（中心主题 → 第一层）**实线** —— 这是"主线分叉"，永久存在
 *   · child（第一层以后）**虚线** —— 这是"分支再生分支"，可继续延伸
 *   · chain（选中节点的祖先链）**加粗高亮** —— 回答"我在树里的哪一条上"
 *   · ghost（被折叠隐藏的子树的入口）**点线** —— 提示"下面还有，点开看"
 */
export const EDGE_KINDS = Object.freeze({
	trunk: { label: "主干", stroke: "#2f6bdd", width: 2, dash: null, opacity: 0.5, group: "关系" },
	child: { label: "分支", stroke: "#39c5cf", width: 1.5, dash: "5 4", opacity: 0.7, group: "关系" },
	chain: { label: "选中链", stroke: "#8957e5", width: 2.5, dash: null, opacity: 0.95, group: "关系" },
	ghost: { label: "折叠入口", stroke: "#4c525c", width: 1.5, dash: "1 4", opacity: 0.6, group: "关系" }
});

/* ══════════════════════════════════════════════════════════════════
 * 四、控件元素（导图态的操作面 —— 每项都对应真实实现）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 控件元素登记表。`testid` 与真实 DOM 的 `data-testid` **同名**（供 e2e 反查，
 * 防止"登记了但没实现"）。
 */
export const CONTROL_KINDS = Object.freeze([
	{ key: "fit", label: "适应屏幕", icon: "🔍", testid: "mm-fit", group: "骨架", desc: "把整棵血缘树缩进可视区（幂等：已在视野内时只回文案）" },
	{ key: "zoom", label: "缩放组", icon: "－／＋", testid: "mm-zoom-out", group: "骨架", desc: "－ 100% ＋ 三件一组，数值居中；1:1 回真实像素" },
	{ key: "collapse", label: "折叠 / 展开", icon: "🗂", testid: "mm-collapse-all", group: "骨架", desc: "全局折叠全部子树 / 展开全部；**单框折叠在框内右侧显式按钮**（见 NODE_CONTROLS.toggle）" },
	{ key: "search", label: "搜索定位", icon: "⌕", testid: "mm-search", group: "标记", desc: "按标题 / 会话号过滤并高亮命中；命中数实时显示" },
	{ key: "legend", label: "状态图例", icon: "●", testid: "mm-legend", group: "标记", desc: "四态点 + 文案；**只列有数据源的态**（见 STATE_KINDS）" },
	{ key: "minimap", label: "小地图", icon: "▣", testid: "mm-minimap", group: "标记", desc: "右下角整树缩略 + 当前视野框；点击跳转" },
	{ key: "hoverbar", label: "悬浮工具条", icon: "⋯", testid: "mm-hoverbar", group: "关系", desc: "悬停节点时出现在节点上方：fork / 打开 / 抓取 / 折叠" },
	{ key: "ctxmenu", label: "右键菜单", icon: "▤", testid: "mm-ctxmenu", group: "关系", desc: "节点右键：只有**有接口**的项可点，其余禁用并写明缺什么" },
	{ key: "refresh", label: "刷新血缘", icon: "↻", testid: "mm-refresh", group: "骨架", desc: "重读书缘快照（宿主 sessions 通道，失败降级并标原因）" },
	{ key: "close", label: "关闭", icon: "✕", testid: "mm-close", group: "骨架", desc: "关闭导图（Esc 亦可）；**必须落在窗口控件安全区左侧**" }
]);

/* ══════════════════════════════════════════════════════════════════
 * 五、键盘元素
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 七、**单个框上的控件**（2026-09-12 第三轮新增）
 *
 * 需求原文（用户）：「思维导图的单个框没有展开和折叠的选项」
 *
 * 🔴 定位到的真实缺口（真机取证，不是猜）：
 *   血缘树实测 12 行、其中 **3 行确实有子节点**（`childrenCount > 0`），
 *   但框上只有一个 12px 宽、颜色 `#8b9199` 的三角形 —— 与徽标同行、被标题挤到几乎看不见，
 *   且**没有子的框上什么都没有**（用户俯视整张图 ⇒ 观感是"框上没有任何展开折叠选项"）。
 *
 * ⇒ 本表把"每个框上该有什么"显式登记，由 `controlsOfRow()` 按行与宿主能力算出 elidable 结果，
 *    MindMap.js 照着渲染，**不再各自 if 判断**（避免"有的框有有的框没有"这种不一致）。
 *
 * 纪律：`enabled=false` 的项必须在 UI 上**显示并写明原因**（与本项目右键菜单同一条纪律），
 *       不做"悄悄不渲染"—— 用户已经因为"点了像没点"投诉过三次。
 */
export const NODE_CONTROLS = Object.freeze([
	{
		key: "toggle", icon: "▾", alt: "▸", label: "折叠子树 / 展开子树", group: "结构",
		/** 有子才有意义：没有子节点时"折叠"是空操作 */
		needs: "childrenCount > 0",
		why: "该分支下有子会话（宿主机 sessions 写在 fork 的 meta.parentSession）"
	},
	{
		key: "detail", icon: "💬", label: "在这侧展开对话", group: "内容",
		needs: "总是可用（数据来自插件侧流转 + 宿主快照）",
		why: "右侧面板显示该对话「现在在做的事」与跨维度流转，不依赖宿主写接口"
	},
	{
		key: "fork", icon: "➕", label: "从此处分支", group: "动作",
		needs: "宿主 sessions.fork",
		why: "宿主未暴露 fork 时禁用并在此写明缺什么"
	},
	{
		key: "open", icon: "📂", label: "打开该原生对话", group: "动作",
		needs: "宿主 sessions.open",
		why: "宿主未暴露 open 时禁用"
	},
	{
		key: "move", icon: "✥", label: "拖动移动（自由摆放）", group: "布局",
		needs: "总是可用（位置由插件侧持久化，不改血缘）",
		why: "🔴 只移动**画面位置**，不改 `parentSession` —— 血缘由宿主固化，插件侧无接口可改"
	}
]);

/**
 * 算出一行上实际可用的控件（**纯函数**，可离线断言）。
 * @param {object} row buildBranchTree().rows[i]
 * @param {{fork?:boolean, open?:boolean}} [caps] hostCapabilities()
 * @returns {Array<{key:string, icon:string, label:string, enabled:boolean, why:string, kind:"structure"|"content"|"action"|"layout"}>}
 */
export function controlsOfRow(row, caps) {
	const c = caps || {};
	const hasKids = Boolean(row && row.childrenCount > 0);
	const kindOf = (g) => (g === "结构" ? "structure" : g === "内容" ? "content" : g === "布局" ? "layout" : "action");
	return NODE_CONTROLS.map((n) => {
		let enabled = true;
		let why = n.why;
		if (n.key === "toggle") {
			enabled = hasKids;
			why = hasKids ? n.why : "该框下没有子会话 ⇒ 无可折叠内容（不是坏了）";
		} else if (n.key === "fork") {
			enabled = Boolean(c.fork);
			why = c.fork ? n.why : "宿主 sessions 服务未暴露 fork（取证：SessionRuntime 成员表）";
		} else if (n.key === "open") {
			enabled = Boolean(c.open);
			why = c.open ? n.why : "宿主 sessions 服务未暴露 open";
		}
		return {
			key: n.key,
			icon: n.icon,
			/* 折叠态替换图标（只有 toggle 有；未声明则与 icon 同）。
			 * 🔴 透出它与 MindMap 直接写死 "▸"/"▾" 的区别：**符号表只有一份**。
			 *    否则以后改图标要改两处，且"元素库说什么"与"界面渲染什么"会悄悄分叉。 */
			alt: n.alt || n.icon,
			label: n.label,
			enabled,
			why,
			kind: kindOf(n.group)
		};
	});
}

export const MM_SHORTCUTS = Object.freeze([
	{ key: "Esc", desc: "关闭导图（仅退最上层浮出物：先关菜单 → 再关导图）" },
	{ key: "Ctrl/⌘ + 0", desc: "缩放回 100%（1:1）" },
	{ key: "Ctrl/⌘ + -", desc: "缩小 10%" },
	{ key: "Ctrl/⌘ + =", desc: "放大 10%" },
	{ key: "Ctrl/⌘ + F", desc: "聚焦搜索框" },
	{ key: "Enter", desc: "底栏输入 → 交总监路由（Shift+Enter 不提交）" }
]);

/* ══════════════════════════════════════════════════════════════════
 * 六、覆盖度总账（把"列全了"变成可核算的事实）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 每条登记一个元素族的落地状态。
 *   `done` = 本轮已实现且 e2e 覆盖 · `todo` = 登记但未实现 · `na` = 明确不做（附原因）
 * 🔴 只写"已实现"必须有 testid 或纯函数测试对应，禁止凭印象打勾。
 */
export const MM_COVERAGE = Object.freeze([
	{ id: "E01", name: "中心主题节点（🎯 主线标识）", state: "done", evidence: "kindOfNode(depth=0) → topic；e2e C-M3" },
	{ id: "E02", name: "主分支 / 子分支 / 叶子三型", state: "done", evidence: "kindOfNode；节点左边框色随型变化；e2e C-M4" },
	{ id: "E03", name: "状态点四态（宿主真值）", state: "done", evidence: "stateOfRow 读 running/completed/pendingInteraction；e2e C-M5 正负对照" },
	{ id: "E04", name: "节点徽标（fork 锚点 / 子数 / 待办 / 血缘 / 预设）", state: "done", evidence: "marksOfRow + NODE_MARKS，取不到不渲染" },
	{ id: "E05", name: "曲线连线（主干实线 / 分支虚线）", state: "done", evidence: "edgePath 三次贝塞尔；EDGE_KINDS 五行语义表" },
	{ id: "E06", name: "选中链高亮（祖先路径）", state: "done", evidence: "ancestorChain 纯函数；e2e C-M7" },
	{ id: "E07", name: "折叠 / 展开（单节点 + 全局）", state: "done", evidence: "visibleRows 纯函数；折叠后隐藏子树并改点线；e2e C-M8" },
	{ id: "E08", name: "悬浮工具条", state: "done", evidence: "data-testid=mm-hoverbar，悬停出现，上移 4px 展开" },
	{ id: "E09", name: "右键菜单（有接口才可点）", state: "done", evidence: "mm-ctx-*；无接口项 disabled + title 说明" },
	{ id: "E10", name: "缩放组（－ 100% ＋ / 1:1 / 适应）", state: "done", evidence: "mm-zoom-*；适应对全树包围盒计算" },
	{ id: "E11", name: "搜索定位", state: "done", evidence: "mm-search；命中高亮 + 计数" },
	{ id: "E12", name: "小地图 + 视野框", state: "done", evidence: "mm-minimap；缩略点按比例，点击跳转" },
	{ id: "E13", name: "状态图例（只列有据的态）", state: "done", evidence: "supportedStates() 驱动；「出错」态标 unsupported 不渲染" },
	{ id: "E14", name: "窗口控件安全区避让（✕ 不与原生按钮重叠）", state: "done", evidence: "readInset/watchInset；e2e C-M13 断言 ✕ 右边界 ≤ 安全区边界" },
	{ id: "E15", name: "「出错」状态点", state: "na", evidence: "宿主摘要无错误字段（取证见 STATE_KINDS.err）⇒ 无数据源不画" },
	{ id: "E16", name: "节点自由文本备注 / 标签", state: "todo", evidence: "需要新的持久化模型（用户可编辑的注释），**本轮不做**：无需求依据且会引入第四份持久化 key" },
	{ id: "E17", name: "合并回父 / 删除分支", state: "na", evidence: "宿主 `sessions` 服务仅暴露 create/fork/open/search/refresh（取证：SessionRuntime 成员表），**无合并与删除接口** ⇒ 菜单里禁用并写明" },
	{ id: "E18", name: "跨会话拖拽改血缘", state: "na", evidence: "血缘由宿主 fork 时固化（meta.parentSession），插件侧无接口可改 ⇒ 拖拽只能是视觉欺骗" },
	/* ── 第三轮新增（用户：单框要能展开折叠 / 框要能移动 / 点框在右侧展开对话）── */
	{ id: "E19", name: "单框显式「展开 / 折叠」控件", state: "done", evidence: "NODE_CONTROLS.toggle + controlsOfRow（纯函数）；框内右侧按钮 mm-node-toggle，有子才可点，无子写明原因" },
	{ id: "E20", name: "框可拖动自由移动（位置持久化）", state: "done", evidence: "pointer 拖动 → 位置写进既有 layout store 的 mmPos 字段（不新增持久化 key）；「自动布局」一键归位" },
	{ id: "E21", name: "点框在右侧展开该对话面板", state: "done", evidence: "components/NodeDetailPanel.js；点框即开，面板含「现在在做的事」+ 跨维流转时间线" },
	{ id: "E22", name: "面板最上方「现在在做的事」", state: "done", evidence: "logic/flow.js currentTaskOf（纯函数），五个优先级分支**各自标明 source**，读不到不编" },
	{ id: "E23", name: "四维流转（总监 / 对话 / 导图 / 设计图 同一条消息）", state: "done", evidence: "logic/flow.js（trail 足迹 + flowLine）；四界面共用同一 store；切会话跟随" }
]);

/** 覆盖度统计（供设计稿与 UI 的"总账"显示） */
export function coverageStats() {
	const total = MM_COVERAGE.length;
	const done = MM_COVERAGE.filter((c) => c.state === "done").length;
	const todo = MM_COVERAGE.filter((c) => c.state === "todo").length;
	const na = MM_COVERAGE.filter((c) => c.state === "na").length;
	return { total, done, todo, na, doneRate: total ? done / total : 0 };
}

/* ══════════════════════════════════════════════════════════════════
 * 八、按分组聚合（UI 遍历用；顺序即 MM_GROUP_COLOR 的键序）
 * ══════════════════════════════════════════════════════════════════ */

/** 全部元素（节点型 + 控件 + 连线）按分组聚合，供图例/文档渲染 */
export function elementsByGroup() {
	const groups = { "骨架": [], "标记": [], "关系": [] };
	for (const k of Object.keys(NODE_KINDS)) {
		const n = NODE_KINDS[k];
		groups[n.group].push({ key: k, label: n.label, icon: n.icon, kind: "node" });
	}
	for (const c of CONTROL_KINDS) {
		groups[c.group].push({ key: c.key, label: c.label, icon: c.icon, kind: "control" });
	}
	for (const k of Object.keys(EDGE_KINDS)) {
		const e = EDGE_KINDS[k];
		groups[e.group].push({ key: k, label: e.label, icon: "—", kind: "edge" });
	}
	return groups;
}
