/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：显示层裁剪宿主残留区块
 * 引用：—
 * 上游：bridge/host-director-column.js, client-entry.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * bridge/host-panel-trim.js — 显示层裁剪宿主残留区块
 *
 * ══════════════════════════════════════════════════════════════════
 *  需求来源
 * ══════════════════════════════════════════════════════════════════
 *  第 4 批（2026-09-14）：「去掉，那目前只在页面上不显示就行，如果有后端逻辑就保留，没有不用管」
 *  第 5 批（2026-09-14）：「对话 tap 上面这一行也去掉」
 *                     「对话 tap 的总监没有最小化了 加上」
 *                     「之前总监智能体的那个刚点开对话的页面还会一闪而逝 查一下原因」
 *
 *  目标区块在**宿主**里：`workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`
 *     · 7337–7340  「总监对话」标题行（标题文字 + 一枚 `—` 折叠按钮）
 *     · 7342–7357  「智能体 · 点击创建分支」标签 + 5 颗智能体按钮
 *     · 7407–7422  对话页**蓝色「对话」标题栏** + 5 颗分支按钮（在 viewArea 内、总监面板之外）
 *
 * ── 🔴 为什么是"显示层裁剪"而不是删那段宿主代码 ────────────────────
 *   ① `workspace/**` 被 `.gitignore` 排除 ⇒ 改它**git 无法回滚**（本项目已列为高风险操作）；
 *   ② 用户明确说「只在页面上不显示就行」—— 目标是**用户看不到**，不是"代码不存在"；
 *   ③ 「如果有后端逻辑就保留」：
 *      · 「智能体 · 点击创建分支」那 5 颗按钮的 onClick 调 `handleAgentClick`，
 *        该函数在当前构建里**已无定义**（`DirectorView` 随 MOD-B 退坡时被删，
 *        如今全文件只剩 7347 行一个悬空引用）⇒ 点击必抛，**无后端逻辑可保留**。
 *      · 蓝色标题栏那 5 颗按钮调 `window.__dshCreateBranch`，**运行时确实存在**
 *        （宿主 5838 一份 + 插件 `src/store/branch.js` 一份，后者覆盖）⇒ **只隐不删**，
 *        分支创建入口仍在导图 / 总监页。
 *
 * ── 第 5 批两处 bug 的根治点（都在本文件）────────────────────────
 *  🔴 bug ①「刚点开对话一闪而逝」——**根因是裁剪延迟 300ms**：
 *     原实现给 MutationObserver 回调套了 `setTimeout(…, 300)` 做"代价控制"。
 *     首次安装时是立即裁的（不闪）；但宿主**切页签 / 重挂载**时节点被重建，
 *     新节点**先以可见状态渲染**，300ms 后才被我们隐藏 ⇒ 用户看到的就是那 300ms 的闪。
 *     ⇒ 现在：回调**同步**处理 `mutation.addedNodes`（微任务阶段，早于浏览器绘制帧）。
 *        代价控制改为**按新增子树做范围扫描**（不全文扫描），不是靠延迟。
 *
 *  🔴 bug ②「对话 tap 的总监没有最小化了」——**根因是 `up:1` 把整行隐了**：
 *     宿主 `client.js:7337–7340` 写明该行 = **标题文字 + 一枚 `—` 折叠按钮**，
 *     而 `up: 1` 定位到"行"再整块 `display:none` ⇒ **折叠按钮陪葬**。
 *     ⇒ 现在 `up: 0`：只隐标题**文字本身**，行与按钮都留着。
 *        （该按钮调的是宿主自己的 `directorLayoutStore.toggleDirectorCollapsed()`，
 *          是**有效**的逻辑，不是 `handleAgentClick` 那条死链 —— 首版归因错了，已纠正。）
 *
 * ── 裁剪口径（只隐"块"或"字"，不误伤）────────────────────────────
 *   两类别：
 *     · `text` + `up`  —— 按**叶子元素的完整文本全等**定位，再上溯 `up` 层
 *     · `match(el)`    —— 结构判据（用于**高频词**文案，如「对话」二字全页到处都是，纯文本判据必误伤）
 *
 * ── 护栏（缺一条就会误伤）──────────────────────────────────────────
 *   ① **不得落在插件自挂容器内**（先判这条）：判据 = 目标节点能 `closest(PLUGIN_GUARD_SELECTOR)`
 *      ⇒ 直接跳过。⚠️ 顺序很重要：插件自己的视图**也渲染在 `.RWZidW_viewArea` 里**，
 *      若只判 viewArea 就等于没判。
 *   ② 文本类目标**必须落在宿主"总监面板"内**（由 `resolvePanelRoot()` 解析出面板元素后做
 *      **包含测试**；面板的三层判据见 `PANEL_MARK` 注释）。面板之外的同名文字一律不碰。
 *   ③ 只对**叶子**元素生效（`children.length === 0`），不会命中外层大容器。
 *   ④ `display:none` 不会被 React 还原：该属性从来不在宿主组件的 style prop 里，
 *      而 React 的 style diff 只增删**自己写过的**键 ⇒ 我们的隐藏是"外来且稳定"的。
 *
 * ── 可逆（负向对照纪律）────────────────────────────────────────────
 *   `restoreHostPanelTrim()` 把 `display` 还原成裁剪前的原值（不是一律删 —— 纪律 26：
 *   动别人状态前先读原值，恢复按"原来怎么设的"）。有了它才能做"裁剪→还原→再裁剪"
 *   的正负对照，而不是只能目测一次。
 *
 * 诊断：`window.__dshHostPanelTrim`（调试与验证脚本用）
 */

const hasWindow = typeof window !== "undefined" && typeof document !== "undefined";

/** 被隐掉的块打的标记（既是幂等判据，也是"这块是被我们隐的"的证据） */
export const TRIM_MARK = "data-dsh-trimmed";

/** 蓝色标题栏里那 5 颗按钮的文案（顺序即宿主源码顺序，client.js:7416） */
const CHAT_BAR_BUTTONS = Object.freeze(["代码", "文档", "调研", "测试", "审核"]);

/**
 * 结构判据：是不是对话页的**蓝色「对话」标题栏**。
 *
 * 🔴 为什么不能像另两条那样"按文本全等定位"：
 *     「对话」是全页**最高频**的词之一 —— 宿主页签、插件 R5 分栏、R8 的「目标：对话」都含它。
 *     纯文本判据 + 上溯层数在这里**必然误伤**（会隐掉页签或插件自己的按钮）。
 *     ⇒ 改用结构指纹：`<div>` 恰好 2 个孩子 = [`<span>对话`] + [`<div>` 内含**恰 5 个**按钮，
 *        文案依次为 代码/文档/调研/测试/审核]。这个组合在宿主里**唯一**。
 *     （宿主总监面板内另有一组同样文案的 5 按钮，但它被护栏②挡在外面 —— 它在面板里。）
 *
 * 纯读、不抛：任何异常都按"不匹配"处理（判据失败只意味着"这项工作没做"，不应该炸安装链）。
 */
export function isHostChatTitleBar(el) {
	try {
		if (!el || el.tagName !== "DIV") return false;
		if (el.children.length !== 2) return false;
		const label = el.children[0];
		const group = el.children[1];
		if (!label || label.tagName !== "SPAN") return false;
		if (String(label.textContent || "").replace(/\s+/g, "") !== "对话") return false;
		if (!group || group.tagName !== "DIV") return false;
		const btns = group.querySelectorAll("button");
		if (btns.length !== CHAT_BAR_BUTTONS.length) return false;
		for (let i = 0; i < CHAT_BAR_BUTTONS.length; i++) {
			if (String(btns[i].textContent || "").trim() !== CHAT_BAR_BUTTONS[i]) return false;
		}
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * 宿主总监面板的**标题条**（对话页左栏那条蓝底「总监」）—— 第 6 批需求 1 要删的第一条。
 *
 * 为什么用结构判据而不是文本：纯文本「总监」在页面里**不止一处**（页签、插件自己的标题…）。
 * 实测（2026-09-14，真机 DOM）：该节点 = `DIV` + 恰好 2 个孩子 + 整块文本恰为「总监」，
 * 且位于宿主总监面板内（面板解析见 `resolvePanelRoot()` / `PANEL_MARK`）。
 * 三重条件叠加后在本页唯一。
 *
 * ⚠️ `match` 类目标在 `guardOk()` 里**不走**"必须在宿主面板内"那条分支（因为结构判据
 *    被认为自带唯一性）⇒ 面板归属必须**在判据内部自己断言**，否则一旦哪天页面上
 *    出现同构的插件节点，就会被误隐。这里显式带上。
 */
export function isHostDirectorPanelTitle(el) {
	try {
		if (!el || el.tagName !== "DIV") return false;
		if (el.children.length !== 2) return false;
		if (String(el.textContent || "").trim() !== "总监") return false;
		/* 🔴 面板归属必须用**解析出来的面板**判（不能用 `closest(PANEL_GUARD_SELECTOR)`）——
		 *    那个选择器依赖的 inline 值会被 `host-director-column.js` 改写，见 `PANEL_MARK` 注释。
		 *    判据形式与 `guardOk()` 一致：上溯到**带我方面板标记**的祖先（不用 `Element.contains`，
		 *    原因见 `guardOk()` 的注释）。 */
		const panel = resolvePanelRoot();
		trimState.panelOk = Boolean(panel);
		if (!panel) return false;
		if (!el.closest("[" + PANEL_MARK + "]")) return false;
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * 裁剪目标（**唯一真相源**：文本 / 上溯层数 / 结构判据 / 为什么）。
 * ⚠️ 文本按宿主当前构建抄录；宿主改文案 ⇒ 这里失效（表现为"那几行又回来了"，
 *    不会静默误伤别的块 —— 因为判据是全等或结构指纹 + 双重护栏）。
 */
export const TRIM_TARGETS = Object.freeze([
	{
		key: "host-agent-row",
		text: "智能体 · 点击创建分支",
		up: 1,
		why: "宿主残留的智能体按钮行；其 onClick 指向的 handleAgentClick 已无定义（点击必抛），无后端逻辑可保留"
	},
	{
		key: "host-director-panel-title",
		/* 结构判据而不是文本：纯文本「总监」会撞上**页签**（也是一种"总监"）。
		 * 实测宿主面板头部 = `<div>` 恰 2 个孩子、整块文本恰为「总监」、
		 * 且带蓝色底（`background-color: var(--dsh-ac…`）。 */
		match: isHostDirectorPanelTitle,
		/* 🔴 `up: 1` 是**错的**，2026-09-14 真机闸门 `verify-v22` 的 A2 抓到：
		 *    `isHostDirectorPanelTitle` 命中的**就是"那一行"本身**（它有 2 个子 span），
		 *    再上溯 1 层 = **整个宿主总监列** ⇒ 整列被 `display:none`。
		 *    而 B3/B4（"两条已不可见"）因此**假绿** —— 列都没了，那两条当然看不见。
		 *    ⚠️ 这正是「断言在反例上也会通过」的典型形态：判据越宽，越像通过。
		 *    ⇒ `up: 0`：隐的就是标题条本身。 */
		up: 0,
		why: "对话页左栏宿主总监面板的**标题条**（第 6 批需求 1：用户原话「总监和下面那一个，这两列不要」⇒ 两条全删）"
	},
	{
		key: "host-director-chat-title",
		text: "总监对话",
		/* 🔴 第 6 批需求 1 **改回 `up: 1`**（此前是 0，第 5 批为了留住那枚 `—` 折叠按钮）。
		 *    用户本轮明确「这两列**全删**」，且**最小化改由插件侧提供**（总监列最右侧，
		 *    见 DirectorPage 的 `renderRail` / `renderResizer`）⇒ 宿主那枚 `—` 不再需要，
		 *    留着反而在已删的标题条下面挂一颗孤零零的按钮（截图里就是那个形态）。 */
		up: 1,
		/* 🔴 中文字符串里**禁用 ASCII 双引号**做引用（第 5 批踩到：`要求"最小化加上"）`
		 *    会让字符串提前闭合 ⇒ 整个文件 SyntaxError，而符号级 lint 查不出来）。 */
		why: "对话页左栏的「总监对话 —」**整行**（第 6 批需求 1：与上面的标题条一起全删；最小化移到插件侧的总监列）"
	},
	{
		key: "host-chat-titlebar",
		/* 无 text：纯文本「对话」会误伤页签与插件自己的按钮 ⇒ 走结构判据 */
		match: isHostChatTitleBar,
		up: 0,
		why: "对话页蓝色「对话」标题栏（含 5 颗分支按钮，client.js:7407–7422）。按钮的 __dshCreateBranch 有后端逻辑 ⇒ 只隐不删；分支入口仍在导图 / 总监页"
	}
]);

/**
 * 宿主总监面板的**自有标记**（唯一真相源）。
 *
 * 🔴 2026-09-14 真机抓到的一处**跨模块自伤**（本模块最严重的一条）：
 *    `PANEL_GUARD_SELECTOR` 原先只有 `[style*="min-width: 180px"]` 一个条件，
 *    而这个值**会被我们自己改掉** —— `bridge/host-director-column.js:361`
 *    为了让列宽能拖到 180 以下，**显式**把宿主列的 inline `minWidth` 写成 `0px`
 *    （那里的注释写着"不清掉它，宽度永远下不了 180"）。
 *    后果（真机取证）：列几何落地一次之后
 *      · `PANEL_GUARD_SELECTOR` 命中数 **0**
 *      · `guardOk()` 的护栏②对**文本类目标**恒 false ⇒ 「智能体 · 点击创建分支」
 *        与「总监对话」两条**静默不再被裁** ⇒ 用户要求删掉的宿主残留**又回到界面上**
 *      · 而 `trimState` 一切正常（`degraded:false`、`reason:null`）⇒ **完全无声**
 *    ⇒ 教训不是"选择器写错了"，而是**两个模块共用一个"会被其中一方主动破坏"的事实**。
 *      本项目纪律 27「看起来相等 ≠ 同源」的同一族：**护栏不能寄生在他方会改写的值上**。
 *
 *  ⇒ 现在护栏走**我们自己贴的标记**（贴在宿主列上，与控制列模块共用同一个属性名，
 *    但**常量只在本文档定义**，由列模块 import 使用 ⇒ 仍然一份真相源）；
 *    标记之外保留内联样式作为**冷启动兜底**（首次扫描时宿主还没被改写过），
 *    再加一层**结构兜底**（见 `resolvePanelRoot()` 第③层），三层任一成立即可。
 */
export const PANEL_MARK = "data-dsh-host-panel";

/**
 * 宿主总监面板的作用域护栏选择器。
 * 三层（**顺序即优先级**）：
 *   ① `[data-dsh-host-panel]` —— 我们自己贴的标记（宿主列被改写过也还在）
 *   ② `[style*="min-width: 180px"]` —— 冷启动兜底（宿主 `client.js:7330` 的原值）
 *   ③ 由 `resolvePanelRoot()` 的结构兜底补齐（选择器表达不了"文本锚 + 祖先形态"）
 */
export const PANEL_GUARD_SELECTOR =
	'[' + PANEL_MARK + '],[style*="min-width: 180px"],[style*="min-width:180px"]';

/** 插件自挂容器的护栏选择器（**先判这条**，见文件头「护栏」） */
export const PLUGIN_GUARD_SELECTOR = '#dsh-director-page,[data-testid^="dp-"],[data-testid^="d-"],[data-dsh-plugin]';

/** 把某个元素认作"宿主总监面板"（标记是幂等的；列模块与本文档共用同一个属性名） */
export function markHostPanel(el) {
	try {
		if (!el || typeof el.setAttribute !== "function") return false;
		if (el.closest && el.closest(PLUGIN_GUARD_SELECTOR)) return false;
		el.setAttribute(PANEL_MARK, "1");
		panelRef = el;
		panelDoc = el.ownerDocument || document;
		return true;
	} catch (e) { return false; }
}

/** 面板引用缓存（`getElementById` 级代价）+ **它所属的 document** */
let panelRef = null;
/** 🔴 缓存必须连带记"属于哪个 document"：真机上 `document` 恒定（缓存有效），
 *  而 `verify-v19` 每段都 `makeDom()` 造**新 document**、且桩里 `isConnected` 恒为 true
 *  ⇒ 只判 `isConnected` 会让上一段的面板被当成当前段的面板
 *  （表现为"护栏②把好目标也挡了"的假红，或"护栏①空转 pass"的**假绿**）。 */
let panelDoc = null;

/** 兜底③的结构锚文本 —— 这两句**只可能出现在宿主总监列里**（宿主自己写的文案） */
const PANEL_ANCHOR_TEXTS = Object.freeze(["智能体 · 点击创建分支", "总监对话"]);

/**
 * 按选择器取第一个命中元素 —— **只依赖 `querySelectorAll`**。
 *
 * 🔴 本模块的能力自检是 `domUsable(doc)`，它声明需要的唯一 DOM 能力就是
 *    `doc.querySelectorAll`。因此模块内**不得**使用其它未声明的选择器 API。
 *    2026-09-14 真踩一次：`resolvePanelRoot()` 初版用了 `document.querySelector`，
 *    而 `verify-v19` 的手写 DOM 桩**只实现了 `querySelectorAll`**（它的 `document`
 *    对象上没有 `querySelector`）⇒ 抛错被 catch 吞成"面板解析失败"
 *    ⇒ 护栏②恒 false ⇒ 四条目标只剩结构判据那条命中
 *    （`[2.3]~[2.15]` 一片红，读起来像"隔离护栏把好目标也挡了"，其实是**桩没有那个 API**）。
 *    ⇒ 统一走本函数：先用 `querySelectorAll`（能力自检声明过的），取第一个。
 */
function queryFirst(sel) {
	try {
		const list = document.querySelectorAll(sel);
		return list && list.length ? list[0] : null;
	} catch (e) { return null; }
}

/**
 * 解析"宿主总监面板"的根元素（三层，逐层降级；**绝不抛**）。
 *
 * ⚠️ 本函数**对外导出**：`bridge/host-director-column.js` 也用它来定位宿主总监列 ——
 *    两个模块**共用同一个解析器**，不再各自写一份"看起来一样"的选择器
 *    （原先两份都写 `[style*="min-width: 180px"]`，一处被改写两边一起瞎）。
 * @returns {Element|null} 找不到时返回 null，并把原因写进 `trimState.panelReason`
 */
export function resolvePanelRoot() {
	try {
		/* 缓存判据必须**同时**含"还带着标记"与"还是本文档的" —— 否则标记被抹掉、
		 * 或换了一份 document（离线桩每段新建），缓存仍命中 ⇒ 负向校准与护栏判据都成空真。 */
		if (panelRef && panelDoc === document && panelRef.isConnected && panelRef.getAttribute(PANEL_MARK)) {
			/* 缓存命中也要把上一次的失败原因清掉 —— 否则读数会**自相矛盾**
			 * （`panelOk:true` 却带着一句"三层都找不到"），闸门与人都无法据此判断。 */
			trimState.panelReason = null;
			return panelRef;
		}
		panelRef = null;
		/* ① 我方标记 */
		let el = queryFirst("[" + PANEL_MARK + "]");
		/* ② 宿主内联原值（冷启动；列几何落地后这个条件会消失） */
		if (!el) el = queryFirst('[style*="min-width: 180px"],[style*="min-width:180px"]');
		/* ③ 结构兜底：从锚文本叶子往上找"宿主列形态"（flex column + 右边框，≤6 层）
		 *    这一层让护栏在**宿主值已被改写、且我方标记也丢了**（新页面首次扫描竞态）时仍成立。 */
		if (!el) el = structuralPanelCandidate();
		if (!el) { trimState.panelReason = "三层都找不到宿主总监面板（标记 / 内联原值 / 结构锚）"; return null; }
		if (el.closest && el.closest(PLUGIN_GUARD_SELECTOR)) {
			trimState.panelReason = "命中的面板落在插件自挂容器内（判据被污染）";
			return null;
		}
		el.setAttribute(PANEL_MARK, "1");
		panelRef = el;
		panelDoc = document;
		trimState.panelReason = null;
		return el;
	} catch (e) {
		trimState.panelReason = "解析面板失败：" + ((e && e.message) || e);
		return null;
	}
}

/** 层③：锚文本叶子 → 上溯到最近的"flex 纵向 + 有右边框"祖先 */
function structuralPanelCandidate() {
	const all = document.querySelectorAll("div,span");
	for (let i = 0; i < all.length; i++) {
		const e = all[i];
		if (e.children.length !== 0) continue;
		if (PANEL_ANCHOR_TEXTS.indexOf(String(e.textContent || "").trim()) < 0) continue;
		let b = e.parentElement;
		for (let k = 0; k < 6 && b && b !== document.body; k++) {
			const s = b.getAttribute ? (b.getAttribute("style") || "") : "";
			if (/flex-direction:\s*column/.test(s) && /border-right/.test(s)) return b;
			b = b.parentElement;
		}
	}
	return null;
}

/** 裁剪状态（供断言读；不编 —— 只有真的贴上去了才计数） */
export const trimState = {
	applied: [], restored: 0, scans: 0, observer: false, skipped: 0,
	/** 增量扫描次数（第 5 批：同步扫 addedNodes 的次数） */
	scopedScans: 0,
	/** 降级原因（null = 一切正常）。**降级可以，无声不行**（纪律 19）：读不到就在这里说清 */
	reason: null,
	/** 是否已降级（离线桩环境 / body 未就绪 / DOM 接口缺失） */
	degraded: false,
	/** 🔴 面板护栏的解析结果（第 6 批新增）：`true` 表示护栏有效。
	 *  它是"护栏②能不能生效"的**可断言面** —— 上面那次静默失效就是因为没有这个读数。 */
	panelOk: false,
	/** 护栏解析失败的原因（null = 正常）。失败时**必须**能被断言看见 */
	panelReason: "尚未解析"
};

/** 把降级原因记下来（可见、可断言），而不是静默 return */
function degrade(reason) {
	trimState.degraded = true;
	trimState.reason = String(reason);
	return [];
}

/** 文档是否具备裁剪所需的 DOM 能力（离线桩常缺 querySelectorAll / body） */
function domUsable(doc) {
	return Boolean(doc && typeof doc.querySelectorAll === "function");
}

/** 元素是否是"文本全等且无子元素"的叶子 */
function isLeafWithText(el, text) {
	if (!el || el.children.length !== 0) return false;
	return String(el.textContent || "").trim() === text;
}

/** 目标条目与元素是否匹配（结构判据优先于文本判据） */
function entryMatches(el, t) {
	if (typeof t.match === "function") {
		try { return Boolean(t.match(el)); } catch (e) { return false; }
	}
	return isLeafWithText(el, t.text);
}

/** 双重护栏：不在插件容器内 + （文本类目标）在宿主总监面板内 */
function guardOk(node, t) {
	try {
		/* ① 先判"是不是我们自己的东西" —— 顺序不可反（插件视图也在 viewArea 内） */
		if (node.closest(PLUGIN_GUARD_SELECTOR)) return false;
		/* ② 文本类目标必须落在宿主总监面板内；结构判据类目标自带唯一性，只需排除插件容器。
		 *    🔴 判据用**解析出来的面板元素**做包含测试，而不是 `closest(选择器)` ——
		 *       原因见 `PANEL_MARK` 的注释：那个选择器依赖的 inline 值**会被我们自己改写**，
		 *       一旦改写，`closest()` 恒 null ⇒ 护栏恒 false ⇒ **静默不裁**（已真机踩过）。
		 *       面板解析失败时 `panelOk=false` 会被断言看见（降级可以，无声不行）。 */
		if (typeof t.match !== "function") {
			const panel = resolvePanelRoot();
			trimState.panelOk = Boolean(panel);
			if (!panel) return false;
			/* 归属判据 = 节点能上溯到**带我方面板标记**的祖先。
			 * ⚠️ 不用 `panel.contains(node)`：`Element.contains` 是标准 API，但本模块要在
			 *    `verify-v19` 的**手写 DOM 桩**里跑，而那个桩只实现了 `closest`（未实现 `contains`）
			 *    ⇒ 裸调会抛，被这里的外层 catch 吞成"护栏不通过" ⇒ 四条目标只剩 bar 命中
			 *    （真机取证外的一次**假红**，读起来像"隔离护栏把好目标也挡了"）。
			 *    用标记做判据既等价、又**自解释**（标记就是身份），还少一个 DOM API 依赖。 */
			if (!node.closest("[" + PANEL_MARK + "]")) return false;
		}
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * 扫一遍给定范围，找出该隐的块。
 * @param {Document|Element} [root] 扫描范围（默认 document）；传 Element 时**含它自己**
 * @returns {Array<{key:string, node:Element}>}
 */
export function findTrimTargets(root) {
	const doc = hasWindow ? document : null;
	/* 🔴 2026-09-14 实战教训（本模块第一版就是因此把整条安装链打断的）：
	 *   `verify-bundle.mjs` 的离线桩里 **`document` 存在但 `querySelectorAll` 不存在**
	 *   ⇒ 原来的裸调用直接抛穿 `installBatch1()`，被 apply 的外层 try/catch 吞掉后
	 *   表现为「apply 返回 null + 后面 60 多项级联 FAIL」，**看起来像插件整体坏了**。
	 *   故：入口先验能力，不可用就**带着原因降级**，绝不抛。 */
	if (!domUsable(doc)) return degrade("document.querySelectorAll 不可用（离线桩 / 无 DOM 环境）");

	/* 扫描范围：显式传 Element ⇒ 只扫该子树（增量路径用）；否则扫全文（首次/重挂载路径） */
	const isScoped = root && root !== doc && typeof root.querySelectorAll === "function";
	const scope = isScoped ? root : doc;

	/* 🔴 每次**全文扫描**先把"面板护栏"解析一次并落进 `trimState.panelOk` ——
	 *   这一步是**可断言面**：没有它，"护栏静默失效导致没裁"与"页面上本来就没有可裁的块"
	 *   在读数上完全一样（本次事故正是后者那种假绿）。增量路径沿用缓存，不重复解析。 */
	if (!isScoped) { const p = resolvePanelRoot(); trimState.panelOk = Boolean(p); }

	const out = [];
	const seen = new Set();
	let nodes;
	try {
		nodes = scope.querySelectorAll("div,span" + (isScoped ? ",button" : ""));
	} catch (e) {
		return degrade("querySelectorAll 抛错：" + ((e && e.message) || e));
	}

	/** 单个元素 → 若命中某目标就收集 */
	const consider = (el) => {
		for (const t of TRIM_TARGETS) {
			if (seen.has(t.key)) continue;
			if (!entryMatches(el, t)) continue;
			let node = el;
			for (let k = 0; k < (t.up || 0) && node; k++) node = node.parentElement;
			if (!node) continue;
			if (!guardOk(node, t)) continue;
			seen.add(t.key);
			out.push({ key: t.key, node });
		}
	};

	/* 增量路径下 Element 自身不在 querySelectorAll 结果里，单独考虑一次 */
	if (isScoped && scope.tagName) consider(scope);
	for (let i = 0; i < nodes.length; i++) {
		consider(nodes[i]);
		if (seen.size === TRIM_TARGETS.length) break;
	}
	return out;
}

/**
 * 应用裁剪（幂等）。已隐过的块**先读原值**再隐，供 restore 精确还原。
 * ⚠️ 本函数**绝不抛** —— 它是安装链上的一环，抛一次会让后面几十个能力全丢。
 * @param {Document|Element} [root] 扫描范围（默认 document）
 * @returns {string[]} 本次贴上的 key 列表
 */
export function applyHostPanelTrim(root) {
	/* 🔴 不可静默返回（纪律 19「降级可以，无声不行」）：缺 DOM 能力时必须留下原因，
	 *    否则闸门读到的是"0 个命中"，与"真的没有可裁的块"长得一模一样（最坏的假绿）。 */
	if (!hasWindow || !domUsable(document)) return degrade("apply：document.querySelectorAll 不可用（离线桩 / 无 DOM 环境）");
	trimState.scans++;
	let hits;
	try {
		hits = findTrimTargets(root);
	} catch (e) {
		return degrade("扫描失败：" + ((e && e.message) || e));
	}
	for (const h of hits) {
		try {
			if (h.node.getAttribute(TRIM_MARK)) continue; // 已隐，别覆盖原值备份
			h.node.setAttribute("data-dsh-trim-prev-display", h.node.style.display || "");
			h.node.style.display = "none";
			h.node.setAttribute(TRIM_MARK, h.key);
			trimState.applied.push(h.key);
		} catch (e) {
			degrade("贴标记失败：" + ((e && e.message) || e));
		}
	}
	return hits.map((h) => h.key);
}

/**
 * 还原裁剪（负向对照用）：把 `display` 写回**裁剪前读到的原值**。
 * @returns {number} 还原了几个节点
 */
export function restoreHostPanelTrim() {
	if (!hasWindow || !domUsable(document)) { degrade("restore：document.querySelectorAll 不可用"); return 0; }
	let marked;
	try {
		marked = document.querySelectorAll("[" + TRIM_MARK + "]");
	} catch (e) {
		degrade("还原扫描失败：" + ((e && e.message) || e));
		return 0;
	}
	let n = 0;
	for (let i = 0; i < marked.length; i++) {
		const el = marked[i];
		el.style.display = el.getAttribute("data-dsh-trim-prev-display") || "";
		el.removeAttribute(TRIM_MARK);
		el.removeAttribute("data-dsh-trim-prev-display");
		n++;
	}
	trimState.restored += n;
	return n;
}

/**
 * 已贴上的标记是否**都还挂在文档里**（宿主整块重挂载 ⇒ 标记丢失 ⇒ 需要重扫）。
 *
 * 🔴 第 5 批修正（这是「一闪而逝」之外的第二处隐患，设计稿首版没看出来）：
 *    旧判据是 `marked.length < TRIM_TARGETS.length ⇒ false` ——
 *    它要求"标记数与目标数**相等**"。但目标数现在是 3，其中「对话页标题栏」
 *    **只在对话页存在**（总监页压根没有 ChatView）⇒ 在总监页该条件**永远为 false**，
 *    于是每次 DOM 变动都走全量扫描（原本想省的代价一点没省，还每帧都做）。
 *    正解：判据只管"**我贴过的那些**标记还在不在"，与"还有几个目标没找到"无关。
 *    ⚠️ 一个都没贴上时返回 false（需要再试一次），这是有意的。
 */
function markersAlive() {
	if (!domUsable(document)) return true; // 无 DOM ⇒ 不重扫（也不报"丢了"）
	const marked = document.querySelectorAll("[" + TRIM_MARK + "]");
	if (marked.length === 0) return false;
	for (let i = 0; i < marked.length; i++) if (!marked[i].isConnected) return false;
	return true;
}

let observer = null;

/**
 * 安装裁剪（挂 MutationObserver 持续保持）。
 *
 * 🔴 bug ① 根治 —— 回调**同步**处理新增节点，**不再有 setTimeout(300)**。
 *    为什么同步安全：只为 `record.addedNodes` 的**每棵新增子树**做范围扫描
 *      （`findTrimTargets(subtree)`），新增节点通常只有几个 ⇒ 代价与"全文扫描"不是一个量级；
 *      而"快路径"（标记都还在 ⇒ 直接 return）依然保留，宿主常规重渲染零扫描。
 *    为什么必须同步：异步延后 300ms ⇒ 新节点**先可见一帧再被隐** = 用户看到的"一闪而逝"。
 *
 * 🔴 **绝不抛**：本函数在 `installBatch1` 的执行链上，抛一次就会让其后几十项能力全部丢失
 *    （2026-09-14 已实测踩到一次）。任何失败都只记 `trimState.reason` 并降级。
 * @returns {boolean} 是否新装（幂等）
 */
export function installHostPanelTrim() {
	if (!hasWindow || typeof window.MutationObserver !== "function") {
		degrade("无 window / MutationObserver（离线桩或非浏览器环境）");
		if (typeof window !== "undefined") window.__dshHostPanelTrim = api();
		return false;
	}
	try {
		applyHostPanelTrim();
	} catch (e) {
		degrade("首次应用失败：" + ((e && e.message) || e));
	}
	if (observer) return false;
	try {
		observer = new window.MutationObserver((records) => {
			try {
				/* 快路径：我贴的标记都还在 ⇒ 这次变动与我无关，零扫描 */
				if (markersAlive()) { trimState.skipped++; return; }
				/* 慢路径：只扫**本次新增的子树**（同步，早于绘制帧 ⇒ 不闪） */
				let didScope = false;
				if (records && records.length) {
					for (const rec of records) {
						const added = rec && rec.addedNodes;
						if (!added || !added.length) continue;
						for (let i = 0; i < added.length; i++) {
							const n = added[i];
							if (!n || n.nodeType !== 1 || !n.isConnected) continue;
							trimState.scopedScans++;
							applyHostPanelTrim(n);
							didScope = true;
						}
					}
				}
				/* 兜底：新增节点里没找到（例如目标所在的祖先被整体替换、新增点在外层）⇒ 全文扫一次 */
				if (!didScope) applyHostPanelTrim();
			} catch (e) { /* 裁剪失败不影响宿主与插件任何功能 */ }
		});
		observer.observe(document.body, { childList: true, subtree: true });
		trimState.observer = true;
	} catch (e) {
		/* body 未就绪 / 观察失败 —— 降级为"一次性裁剪"，不阻断安装链 */
		observer = null;
		degrade("MutationObserver 挂载失败：" + ((e && e.message) || e));
	}
	if (typeof window !== "undefined") window.__dshHostPanelTrim = api();
	return true;
}

/** 卸载（测试/排障用） */
export function uninstallHostPanelTrim() {
	if (observer) { observer.disconnect(); observer = null; }
	trimState.observer = false;
	return true;
}

function api() {
	return {
		TRIM_MARK, TRIM_TARGETS, PANEL_GUARD_SELECTOR, PLUGIN_GUARD_SELECTOR, trimState,
		isHostChatTitleBar,
		findTrimTargets, applyHostPanelTrim, restoreHostPanelTrim,
		installHostPanelTrim, uninstallHostPanelTrim,
		/* 面板护栏的调试面（第 6 批）：让"护栏失效"这种**静默**故障可以被负向校准。
		 * 校准做法（见 `verify-flow.mjs` 的 H0c）：抹掉标记 + 抹掉两处结构锚文本
		 * ⇒ `panelOk` 必须转 false 且文本类目标**不再被裁**；还原后必须回绿。 */
		PANEL_MARK, markHostPanel, resolvePanelRoot
	};
}

/** 全局契约（调试 / 验证脚本用，不可改名） */
export function installHostPanelTrimApi() {
	if (!hasWindow) return null;
	window.__dshHostPanelTrim = api();
	return window.__dshHostPanelTrim;
}
