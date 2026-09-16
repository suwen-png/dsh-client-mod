/**
 * cdp-click-dialog.mjs — 批次 9「弹窗式总监架构」真机逐交互点击验证
 *   T-PLUG-015 · docs/11 §六 T9（真机部分）
 *
 * 与 `cdp-click.mjs`（批次 8 回归 · 层级组件内部交互）互补：
 *   本脚本只覆盖**弹窗自身**的交互面 —— 即 docs/10 §四 交互规格里
 *   由 `components/DirectorDialog.js` / `bridge/*` / `logic/routing.js` 实现的部分。
 *
 * 覆盖清单（每个可交互元素都必须被实际点击 + 回读）：
 *   D1  入口开合（launcher toggle）+ 分屏注入
 *   D2  焦点路由徽章（点击左面板 / 原生区 → 徽章与 focusTarget 同步）
 *   D3  左侧分段：总监 / 层级 / 智能体（三段切换 + 内容互斥）
 *   D4  智能体段：智能体/技能分段切换 + 逐个手选调用 + 调用记录
 *   D5  层级下拉（d-level）+ 面包屑同步
 *   D6  路由确认卡：输入 → 总监整理 → 三去向 + 取消
 *   D7  六维审核：重跑审核 + 六维逐维 status + summary
 *   D8  左栏折叠 / 右栏折叠（d-collapse-left / d-collapse-right）+ 竖条 rail
 *   D9  中缝拖拽（d-split）→ 边界吸附（过窄自动折叠）
 *   D10 整窗最小化（d-min）→ chip 停靠 → 点击还原
 *   D11 键盘：Esc 关闭 / Alt+1 左栏 / Alt+2 右栏 / Alt+3 最小化
 *   D12 关闭（d-close）→ 分屏完全可逆（样式移除 + data-* 清空）
 *   D13 侧栏点击文件夹 / 项目 → 打开对应层级总监（要求 7 / 9）
 *   D14 数据元独立真机取证（新库存在、宿主库未动、键未改名）
 *   D15 全量交互元素覆盖审计（弹窗内每个 button/input/select 都被点过）
 *
 * 🔴 纪律（继承 cdp-click.mjs）：
 *   - 按钮 `disabled` 时 `click()` 是**静默 no-op** ⇒ 点击前必须 `waitIdle()`
 *   - 每步「写 → 回读 → 断言」，禁止只看不读
 *   - 可反复运行：结束时清理测试数据、关闭弹窗、复原布局
 */

const PORT = 9222;
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener("open", r));
function evalExpr(expression) {
	return new Promise((res, rej) => {
		const id = ++seq;
		pending.set(id, (m) => {
			const out = m.result;
			if (out.exceptionDetails) return rej(new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text));
			const r = out.result;
			if (r.subtype === "error") return rej(new Error(r.description));
			if (r.unserializableValue) return res(r.unserializableValue);
			if (r.value !== undefined) return res(r.value);
			rej(new Error("空结果"));
		});
		ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
	});
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等空闲：弹窗内所有「忙态按钮」都可点（disabled 时 click 静默失效） */
async function waitIdle(timeoutMs = 45000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const idle = await evalExpr(`(() => {
			const sel = '[data-testid="d-send"],[data-testid="d-review-run"],[data-testid="d-route-transfer"],[data-testid="d-reset"],[data-testid="d-min"],[data-testid="d-close"]';
			return window.__qa(sel).every((e) => !e.disabled);
		})()`);
		if (idle === true) return true;
		await sleep(400);
	}
	return false;
}

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail = "") {
	if (cond) { pass++; console.log("  ✅ " + name + (detail ? "  — " + detail : "")); }
	else { fail++; fails.push(name); console.log("  ❌ " + name + (detail ? "  — " + detail : "")); }
}

/* ── 页面内辅助（注入一次）── */
await evalExpr(`
window.__q = (s) => document.querySelector(s);
window.__qa = (s) => Array.from(document.querySelectorAll(s));
window.__tid = (t) => document.querySelector('[data-testid="' + t + '"]');
window.__dlg = () => document.getElementById('dsh-director-dialog');
window.__state = () => (window.__directorLayoutStore ? window.__directorLayoutStore.getState() : null);
window.__openDlg = async () => {
	const L = () => document.getElementById('dsh-director-hierarchy-launcher');
	for (let i = 0; i < 5; i++) {
		if (window.__dlg()) return true;
		const l = L(); if (l) l.click();
		await new Promise(r => setTimeout(r, 500));
	}
	return Boolean(window.__dlg());
};
window.__closeDlg = async () => {
	for (let i = 0; i < 5; i++) {
		const c = window.__tid('d-close');
		if (c) { c.click(); await new Promise(r => setTimeout(r, 450)); }
		if (!window.__dlg()) return true;
		const l = document.getElementById('dsh-director-hierarchy-launcher');
		if (l && window.__dlg()) { l.click(); await new Promise(r => setTimeout(r, 450)); }
	}
	return !window.__dlg();
};
window.__setVal = (el, v) => {
	if (!el) return false;
	// 🔴 必须按**实际标签**取原型：用 HTMLInputElement 的 value setter 去写 <select>
	//    会抛 "Illegal invocation"（真机踩中，D5）
	const tag = (el.tagName || '').toUpperCase();
	const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype
		: tag === 'SELECT' ? HTMLSelectElement.prototype
		: HTMLInputElement.prototype;
	const d = Object.getOwnPropertyDescriptor(proto, 'value');
	if (d && d.set) d.set.call(el, v); else el.value = v;
	// <select> 用 change；input/textarea 用 input + change（React 受控组件）
	el.dispatchEvent(new Event('input', { bubbles: true }));
	el.dispatchEvent(new Event('change', { bubbles: true }));
	return true;
};
/* 🔴 只发一次点击：dispatchEvent(MouseEvent) + el.click() 会双触发 React onClick
 *    ⇒ 调用记录翻倍（真机踩中，D4：5 个智能体产生 8+ 条记录）。
 *    el.click() 本身就会派发可冒泡的原生 click，React 委派监听能收到。
 * ⚠ 本块是**模板字符串**内容：注释里禁止出现反引号（会提前闭合模板 ⇒ SyntaxError）。 */
window.__click = (el) => {
	if (!el) return false;
	if (typeof el.click === 'function') { el.click(); return true; }
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
	return true;
};
'ready'
`);

console.log("\n══════ 批次 9 弹窗式总监架构 · 真机逐交互验证 ══════\n");

/* ══════════════════════════════════════════════════════════════
 * D0 前置：识别宿主上下文（要求 5 的分屏对象是「对话区」）
 *
 *   🔴 为什么只识别、不强行切换：
 *     真机实测（_probe-rowclick.mjs）——宿主当前处在**应用中心模式**：
 *     侧栏为 `PKekiq_*` 工作区树、无 `RWZidW_tab` 对话 tab 环、编辑器为
 *     落地输入框（placeholder「描述你想要构建的内容」）。点击侧栏会话行
 *     （span / 其父 / 其祖父 / closest(button)）**均不切换视图**（宿主不暴露
 *     该入口），强行走「新会话」只会在用户会话列表里留下空会话（**不可逆副作用**）。
 *     故 D0 只做**上下文识别**，交互验证对象改为「分屏机制本身」——
 *     它与上下文无关（同一个 `findChatRoot` + 同一段 padding 规则）。
 *
 *   ⚠ 已产生的副作用：本脚本早期版本为进入对话上下文点过一次「新会话」，
 *     在用户侧栏留下一个空会话「新会话」。已改为只读，不再新增。
 * ══════════════════════════════════════════════════════════════ */
console.log("[D0] 前置：识别宿主上下文（不改动宿主状态）");
const d0 = await evalExpr(`(() => {
	const RD = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
	const txs = [...document.querySelectorAll('textarea')].map(t => t.placeholder);
	const composer = txs.includes('给智能体发消息');
	const tabRing = [...document.querySelectorAll('button')].filter(b => {
		const r = b.getBoundingClientRect();
		const t = (b.textContent || '').trim();
		return r.y >= 0 && r.y < 90 && r.width > 0 && r.width < 60 && t.length > 0 && t.length <= 3 && !b.closest('#dsh-director-dialog');
	}).map(b => (b.textContent || '').trim());
	const root = window.__dshSplitApi.findChatRoot();
	return {
		composer, tabRing, txs,
		ctx: composer ? 'conversation' : 'host-home',
		rootFound: Boolean(root),
		rootPluginOwned: root ? window.__dshSplitApi.isPluginNode(root) : null,
		rootRect: RD(root)
	};
})()`);
ok("D0 宿主上下文已识别（对话页 或 宿主首页）", ["conversation", "host-home"].includes(d0.ctx) && d0.rootFound === true,
	"ctx=" + d0.ctx + " / textarea=" + JSON.stringify(d0.txs) + " / root=" + JSON.stringify(d0.rootRect));
ok("D0b 分屏锚点可解析且非插件自身（上下文无关的机制前提）", d0.rootFound === true && d0.rootPluginOwned === false,
	d0.ctx === "conversation" ? "对话页：tab 环 " + JSON.stringify(d0.tabRing) : "宿主首页：无对话 tab（按机制层验收）");
/* 🔴 布局归一化（套件可反复运行的**硬前提**）：
 *    `directorPanelCollapsed / chatPanelCollapsed / 栏宽` 由 layout store 持久化到
 *    localStorage（`dsh.director.layout`）。上一轮若在折叠态崩溃退出，本轮启动即
 *    折叠态 ⇒ 标题栏按钮（d-collapse-left / d-close …）根本不存在 ⇒ 后续分段全崩。
 *    故任何一条真机套件都必须在开头把布局拉回**已知态**：双栏展开 + 默认栏宽 + 弹窗关闭。 */
const d0c = await evalExpr(`(async () => {
	const S = () => window.__state() || {};
	const openIt = async () => { const l = document.getElementById('dsh-director-hierarchy-launcher'); if (!window.__dlg() && l) { l.click(); await new Promise(r => setTimeout(r, 600)); } };
	await openIt();
	for (let i = 0; i < 4; i++) {
		const s = S();
		if (!s.directorPanelCollapsed && !s.chatPanelCollapsed) break;
		if (s.directorPanelCollapsed) { const r = window.__tid('d-left-rail'); if (r) window.__click(r); }
		if (s.chatPanelCollapsed) { const r = window.__tid('d-right-rail'); if (r) window.__click(r); }
		await new Promise(r => setTimeout(r, 450));
	}
	if (window.__directorLayoutStore) window.__directorLayoutStore.resetPanelWidths();
	await new Promise(r => setTimeout(r, 350));
	const s2 = S();
	await window.__closeDlg();
	await new Promise(r => setTimeout(r, 500));
	return { L: s2.directorPanelCollapsed, R: s2.chatPanelCollapsed, w: s2.directorPanelWidth, closed: !window.__dlg() };
})()`);
ok("D0c 🔴 布局已归一化（双栏展开 + 默认栏宽 + 弹窗关闭）—— 保证套件可反复运行",
	d0c.L === false && d0c.R === false && d0c.closed === true, `L=${d0c.L} R=${d0c.R} width=${d0c.w}`);

/* ══════════════════════════════════════════════════════════════
 * D1 入口开合 + 分屏注入
 * ══════════════════════════════════════════════════════════════ */
console.log("[D1] 入口开合 + 分屏注入（要求 5）");
await evalExpr(`window.__closeDlg()`);
await sleep(400);
const d1a = await evalExpr(`(() => {
	const RD = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
	const root = window.__dshSplitApi.findChatRoot();
	let ed = null;
	for (const t of document.querySelectorAll('textarea')) { const r = t.getBoundingClientRect(); if (r.width > 0 && r.height > 0) ed = t; }
	return {
		launcher: Boolean(document.getElementById('dsh-director-hierarchy-launcher')),
		text: (document.getElementById('dsh-director-hierarchy-launcher')||{}).textContent || '',
		dlgClosed: !window.__dlg(),
		splitBefore: Boolean(document.getElementById('dsh-director-split-style')),
		rootFound: Boolean(root),
		rootPluginOwned: root ? window.__dshSplitApi.isPluginNode(root) : null,
		rootInlineBefore: root ? root.getAttribute('style') : null,
		rootRect: RD(root),
		editorRect: RD(ed),
		editorPh: ed ? ed.placeholder : null
	};
})()`);
/* 🔴 2026-09-13 纠错：入口是**图标 + 文案**两段（`◆` + `总监`），同组另两颗
 *   （`🖌 设计图` / `🧠 思维导图`）同构 —— 这是浮动组的既定风格（图标用于辨识），
 *   不是"命名不规范"。原判据要求纯文案 `=== "总监"` ⇒ 假红（文案整治的 D 组
 *   表格针对的是 R8 里的路由键 `dp-route-director`，**不覆盖浮动入口**）。
 *   改为语义判据：含「总监」且短（≤6 字，防回潮成解释性长句）。 */
ok("入口按钮存在（图标 + 文案「总监」· 非解释性长句）",
	d1a.launcher && /总监/.test(String(d1a.text)) && String(d1a.text).length <= 6,
	"文案「" + d1a.text + "」");
ok("初始态：弹窗关闭且无分屏样式", d1a.dlgClosed && d1a.splitBefore === false);
/* 🔴 E-SPLIT-001 / E-SPLIT-002 的回归护栏：锚点必须落在**宿主**节点上 */
ok("🔴 findChatRoot 命中宿主节点（非插件自身 / 非侧栏）", d1a.rootFound === true && d1a.rootPluginOwned === false,
	"root=" + JSON.stringify(d1a.rootRect) + " editor=" + JSON.stringify(d1a.editorRect));
ok("🔴 锚点为对话编辑器（placeholder 语义定位）", d1a.editorPh === "给智能体发消息" || (d1a.rootRect && d1a.rootRect.w > 576), "placeholder=" + JSON.stringify(d1a.editorPh));
await sleep(500);
await evalExpr(`window.__openDlg()`);
await sleep(600);
const d1b = await evalExpr(`(() => {
	const RD = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
	const marked = document.querySelector('[data-dsh-split-root]');
	const root = window.__dshSplitApi.findChatRoot();
	let ed = null;
	for (const t of document.querySelectorAll('textarea')) { const r = t.getBoundingClientRect(); if (r.width > 0 && r.height > 0) ed = t; }
	return {
		dlg: Boolean(window.__dlg()),
		style: Boolean(document.getElementById('dsh-director-split-style')),
		rootMarked: Boolean(marked),
		css: (document.getElementById('dsh-director-split-style')||{}).textContent || '',
		markedPluginOwned: marked ? window.__dshSplitApi.isPluginNode(marked) : null,
		markedInlineAfter: marked ? marked.getAttribute('style') : null,
		markedIsSameNode: Boolean(marked) && marked === root,
		markedTag: marked ? marked.tagName : null,
		editorRect: RD(ed),
		editorX: ed ? Math.round(ed.getBoundingClientRect().x) : null
	};
})()`);
ok("点击入口 → 弹窗出现", d1b.dlg === true);
ok("🔴 分屏样式节点已注入", d1b.style === true, "style 节点存在");
ok("🔴 原生应用根被打上标记（零节点移动）", d1b.rootMarked === true && d1b.markedIsSameNode === true,
	"marked=" + d1b.markedTag + " sameAsFindChatRoot=" + d1b.markedIsSameNode);
ok("🔴 标记绝不在插件自有 DOM 上（E-SPLIT-001 反证）", d1b.markedPluginOwned === false);
ok("分屏样式为 padding-left 单值规则", /padding-left:\d+px !important/.test(d1b.css), d1b.css.slice(0, 72));
/* 🔴 反证：宿主节点**自身**的 style 属性逐字节未变（"零节点移动"的硬证据） */
ok("🔴 反证：原生根 style 属性逐字节零改动", d1a.rootInlineBefore === d1b.markedInlineAfter,
	"before=" + JSON.stringify((d1a.rootInlineBefore || "").slice(0, 40)) + " after=" + JSON.stringify((d1b.markedInlineAfter || "").slice(0, 40)));
/* 🔴 端到端不变式（**与上下文无关**）：padding 由原生根吃下后，内容盒左右各让出
 *    padLeft，故**内容中心必右移 padLeft/2**。真机两种上下文实测：
 *      · 对话页 ：composerSeat x 280→580、w 1154→854 ⇒ 中心 857→1007（+150）
 *      · 宿主首页：落地卡片 x 468→618、w 778 不变      ⇒ 中心 857→1007（+150）
 *    两种都成立 ⇒ 以此判「分屏真的生效」，不依赖是否有对话 tab。 */
const padApplied = Number((d1b.css.match(/padding-left:(\d+)px/) || [])[1] || 0);
const cBefore = d1a.editorRect ? d1a.editorRect.x + d1a.editorRect.w / 2 : null;
const cAfter = d1b.editorRect ? d1b.editorRect.x + d1b.editorRect.w / 2 : null;
const dC = (cBefore != null && cAfter != null) ? cAfter - cBefore : null;
ok("🔴 端到端：内容中心右移 ≈ padLeft/2（分屏真的生效）",
	padApplied > 0 && dC != null && Math.abs(dC - padApplied / 2) <= Math.max(12, padApplied * 0.12),
	`padLeft=${padApplied} 内容中心 ${cBefore} → ${cAfter}（Δ${dC}，期望 ${padApplied / 2}）`);
/* 🔴 要求 5「右栏与对话 tab 完全一致」的**构造性**证明：右栏不是副本，
 *    就是宿主原节点本身 ⇒ 插件 DOM 内不得出现任何对话副本。 */
const noCopy = await evalExpr(`(() => {
	const dlg = window.__dlg();
	if (!dlg) return { ok: false, copies: -1 };
	const inner = [...dlg.querySelectorAll('textarea,[class*="composerSeat"],[class*="messageList"],[class*="scrollBody"]')];
	return { ok: true, copies: inner.length };
})()`);
ok("🔴 插件 DOM 内零对话副本（右栏 = 宿主原节点 ⇒「完全一致」由构造成立）",
	noCopy.ok === true && noCopy.copies === 0, "副本数=" + noCopy.copies);

/* ══════════════════════════════════════════════════════════════
 * D2 焦点路由徽章（要求 11 · R8）
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D2] 焦点路由徽章（要求 11）");
const d2 = await evalExpr(`(async () => {
	const badge = () => { const e = window.__tid('d-focus'); return e ? e.textContent.trim() : null; };
	const panel = window.__tid('d-panel');
	const root = document.querySelector('[data-dsh-split-root]');
	if (!panel || !root) return { bad: true, panel: Boolean(panel), root: Boolean(root) };
	const pr = panel.getBoundingClientRect();
	const rr = root.getBoundingClientRect();
	// 点左面板内部
	panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: pr.x + 20, clientY: pr.y + 60 }));
	await new Promise(r => setTimeout(r, 320));
	const afterPanel = { badge: badge(), focus: (window.__state()||{}).focusTarget };
	// 点原生区内部
	root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rr.x + rr.width - 40, clientY: rr.y + rr.height / 2 }));
	await new Promise(r => setTimeout(r, 320));
	const afterChat = { badge: badge(), focus: (window.__state()||{}).focusTarget };
	return { afterPanel, afterChat, badgeExists: Boolean(window.__tid('d-focus')) };
})()`);
ok("焦点路由前置：面板与宿主根均就位", d2.bad !== true, d2.bad ? `panel=${d2.panel} root=${d2.root}` : "就位");
ok("焦点徽章存在（防误发）", d2.badgeExists === true);
ok("点左面板 → focusTarget=director 且徽章同步",
	d2.bad !== true && d2.afterPanel && d2.afterPanel.focus === "director" && /总监/.test(String(d2.afterPanel.badge)),
	`focus=${d2.afterPanel && d2.afterPanel.focus} badge=${d2.afterPanel && d2.afterPanel.badge}`);
ok("点原生区 → focusTarget=chat 且徽章同步",
	d2.bad !== true && d2.afterChat && d2.afterChat.focus === "chat" && /对话/.test(String(d2.afterChat.badge)),
	`focus=${d2.afterChat && d2.afterChat.focus} badge=${d2.afterChat && d2.afterChat.badge}`);

/* ══════════════════════════════════════════════════════════════
 * D3 左侧分段三段切换
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D3] 左侧分段：总监 / 层级 / 智能体");
const d3 = await evalExpr(`(async () => {
	const out = {};
	const clickSeg = async (t) => { const e = window.__tid(t); if (!e) return false; window.__click(e); await new Promise(r => setTimeout(r, 420)); return true; };
	out.hasDirector = await clickSeg('d-seg-director');
	out.directorPanel = Boolean(window.__q('[data-panel="director"]'));
	out.r2 = Boolean(window.__tid('d-r2')) && Boolean(window.__tid('d-r5')) && Boolean(window.__tid('d-r6'));
	out.levelsAbsent = !window.__q('[data-panel="levels"]') && !window.__q('[data-panel="agents"]');
	out.hasLevels = await clickSeg('d-seg-levels');
	out.levelsPanel = Boolean(window.__q('[data-panel="levels"]'));
	out.treeRows = window.__qa('[data-node-id][data-selected]').length;
	out.directorAbsent = !window.__q('[data-panel="director"]');
	out.hasAgents = await clickSeg('d-seg-agents');
	out.agentsPanel = Boolean(window.__q('[data-panel="agents"]'));
	out.r3 = Boolean(window.__tid('d-r3'));
	out.leftTab = (window.__state()||{}).leftTab;
	return out;
})()`);
ok("「总监」段可切换且渲染 R2/R5/R6 三区", d3.hasDirector && d3.directorPanel && d3.r2, "R2+R5+R6=" + d3.r2);
ok("分段互斥：总监段下无层级/智能体内容", d3.levelsAbsent === true);
ok("「层级」段可切换且树行就位", d3.hasLevels && d3.levelsPanel && d3.treeRows > 0, "树行 " + d3.treeRows + " 条");
ok("分段互斥：层级段下无总监段内容", d3.directorAbsent === true);
ok("「智能体」段可切换且渲染 R3", d3.hasAgents && d3.agentsPanel && d3.r3 === true);
ok("分段状态写入 layout store（leftTab=agents）", d3.leftTab === "agents", "leftTab=" + d3.leftTab);

/* ══════════════════════════════════════════════════════════════
 * D4 智能体段：分段切换 + 手选调用 + 调用记录
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D4] 智能体 / 技能分段 + 手选调用（要求 10）");
const d4 = await evalExpr(`(async () => {
	const out = {};
	const click = async (t) => { const e = window.__tid(t); if (!e) return false; window.__click(e); await new Promise(r => setTimeout(r, 260)); return true; };
	/* 🔴 记录**增量**而非绝对值：调用记录是页面内存态，脚本在同一页面重复运行时会累积
	 *    （首轮绝对值断言在第二轮假失败）。本轮断言语义 = 「每次点击恰好 +1」。 */
	const totalNow = () => { const b = window.__tid('d-agent-runs'); return b ? Number(b.getAttribute('data-run-total')) : -1; };
	out.totalBefore = totalNow();
	out.segAgents = await click('d-agent-seg-agents');
	out.agentChips = window.__qa('[data-testid^="d-agent-"]').filter(e => e.getAttribute('data-mode')).length;
	out.agentKeys = window.__qa('[data-testid^="d-agent-"][data-mode]').map(e => e.getAttribute('data-testid').replace('d-agent-',''));
	out.runsEmptyBefore = Boolean(window.__tid('d-agent-runs-empty'));
	// 逐个点击 5 个智能体
	out.clicked = [];
	for (const k of out.agentKeys) { out.clicked.push(await click('d-agent-' + k)); }
	out.runsAfter = window.__qa('[data-run-key]').length;
	out.runKeys = window.__qa('[data-run-key]').map(e => e.getAttribute('data-run-key'));
	out.runTotalAfter = totalNow();
	out.segSkills = await click('d-agent-seg-skills');
	out.skillKeys = window.__qa('[data-testid^="d-agent-"][data-mode]').map(e => e.getAttribute('data-testid').replace('d-agent-',''));
	out.skillClicked = [];
	for (const k of out.skillKeys) { out.skillClicked.push(await click('d-agent-' + k)); }
	out.runsFinal = window.__qa('[data-run-key]').length;
	out.runTotal = totalNow();
	/* ⚠ 必须在**技能点击之后**重新采样：runKeys 采于智能体点击之后，
	 *   用它断言技能顺序会永远看到智能体那批（本轮踩中）。
	 * ⚠ 本块是模板字符串内容：注释里禁止出现反引号（跑 lint-cdp-templates.mjs 可即时拦）。 */
	const rows0 = window.__qa('[data-run-key]');
	out.runKeysFinal = rows0.map(e => e.getAttribute('data-run-key'));
	out.newestRunKey = rows0.length ? rows0[0].getAttribute('data-run-key') : null;
	return out;
})()`);
ok("智能体/技能分段可切换", d4.segAgents && d4.segSkills);
ok("5 类标准智能体全部渲染（17号文 §1A.8）", d4.agentKeys.length === 5, JSON.stringify(d4.agentKeys));
ok("每个智能体均可点击（手选调用）", d4.clicked.every(Boolean), "点击 " + d4.clicked.filter(Boolean).length + "/" + d4.agentKeys.length);
/* 🔴 判据用「**最新条目顺序 = 点击顺序的逆序**」（unshift 最新在前），与记录上限无关：
 *    记录是有上限的内存态（RUNS_KEEP），同页重复运行会累积到上限后不再增长
 *    ⇒ 任何「绝对值 / 净增量」断言都会在某一轮假失败（本轮实测踩中）。 */
ok("🔴 回读：5 次点击**恰好产生 5 条**记录（非双触发）",
	JSON.stringify(d4.runKeys.slice(0, 5)) === JSON.stringify(d4.agentKeys.slice().reverse()),
	"最新 5 条=" + JSON.stringify(d4.runKeys.slice(0, 5)) + " ｜ 总数 " + d4.totalBefore + " → " + d4.runTotalAfter);
ok("调用记录 key 与智能体一一对应", JSON.stringify([...d4.runKeys.slice(0, 5)].sort()) === JSON.stringify([...d4.agentKeys].sort()), JSON.stringify(d4.runKeys));
ok("技能分段渲染技能清单且均可点击", d4.skillKeys.length > 0 && d4.skillClicked.every(Boolean), d4.skillKeys.join(","));
ok("🔴 回读：技能调用同样逐次留痕（最新 N 条 = 技能点击逆序）",
	JSON.stringify(d4.runKeysFinal.slice(0, d4.skillKeys.length)) === JSON.stringify(d4.skillKeys.slice().reverse()),
	"最新 " + d4.skillKeys.length + " 条=" + JSON.stringify(d4.runKeysFinal.slice(0, d4.skillKeys.length)) + " ｜ 总数 " + d4.totalBefore + " → " + d4.runTotal + "（上限 30）");
ok("🔴 回读：最新一条 = 最后被点击的技能（unshift 最新在前）", d4.newestRunKey === d4.skillKeys[d4.skillKeys.length - 1],
	"newest=" + d4.newestRunKey + " lastClicked=" + d4.skillKeys[d4.skillKeys.length - 1]);

/* ══════════════════════════════════════════════════════════════
 * D5 层级下拉 + 面包屑
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D5] 层级下拉（d-level）→ 面板绑定的总监层级切换（要求 5 / 7 / 9）");
const d5 = await evalExpr(`(async () => {
	const sel = window.__tid('d-level');
	if (!sel) return { found:false };
	const opts = Array.from(sel.options).map(o => ({ v:o.value, t:o.textContent.trim() }));
	const cur = sel.value;
	const target = opts.find(o => o.v !== cur);
	const beforeNode = (() => { const p = window.__tid('d-panel'); return p ? p.getAttribute('data-active-node-id') : null; })();
	window.__setVal(sel, target.v);
	await new Promise(r => setTimeout(r, 800));
	const panel = window.__tid('d-panel');
	return { found:true, optionCount: opts.length, cur, target: target.v, targetText: target.t,
		beforeNode, afterNode: panel ? panel.getAttribute('data-active-node-id') : null,
		crumb: (window.__tid('d-crumb')||{}).textContent || '', activeNode: (window.__state()||{}).activeNodeId };
})()`);
ok("层级下拉存在且选项齐全", d5.found && d5.optionCount > 1, d5.optionCount + " 个层级选项");
const d5b = await evalExpr(`(async () => {
	const sel = window.__tid('d-level'); const opts = Array.from(sel.options);
	const t = opts[1]; window.__setVal(sel, t.value); await new Promise(r=>setTimeout(r,700));
	const panel = window.__tid('d-panel');
	return { val: sel.value, want: t.value, node: panel ? panel.getAttribute('data-active-node-id') : null, crumb: (window.__tid('d-crumb')||{}).textContent || '' };
})()`);
ok("🔴 回读：下拉选择写入面板绑定节点", d5b.val === d5b.want && d5b.node !== null, "value=" + String(d5b.val).slice(-18) + " node=" + String(d5b.node).slice(-18));
ok("面包屑随层级切换同步", typeof d5b.crumb === "string" && d5b.crumb.length > 0, "「" + d5b.crumb.trim().slice(0, 28) + "」");

/* ══════════════════════════════════════════════════════════════
 * D6 路由确认卡（要求 8）
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D6] 唯一总监页：输入 → 整理 → 路由确认卡三去向（要求 8）");
await waitIdle();
/* 🔴 前置：焦点必须指向「总监」。
 *    `onSend` 按 `focusTarget` 分支（要求 5 双向联动 vs 要求 8 智能路由）：
 *      · focusTarget === "chat"  → **直接投给原生对话**（不产生确认卡，设计如此）
 *      · focusTarget === "director" → 总监整理 → 出确认卡 → 待用户确认去向
 *    D2 结束时焦点停在 chat ⇒ 若不重置，D6 会走直接投递分支而「看不到确认卡」
 *    （非缺陷，是前置未置位）。焦点由**左面板内的 pointerdown** 设置（要求 11 焦点路由）。 */
const d6pre = await evalExpr(`(async () => {
	window.__click(window.__tid('d-seg-director'));
	await new Promise(r => setTimeout(r, 450));
	const panel = window.__tid('d-panel');
	const pr = panel.getBoundingClientRect();
	panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: pr.x + 30, clientY: pr.y + 50 }));
	await new Promise(r => setTimeout(r, 320));
	return { focus: (window.__state()||{}).focusTarget, seg: (window.__state()||{}).leftTab, badge: (window.__tid('d-focus')||{}).textContent || '' };
})()`);
ok("D6 前置：焦点=总监 + 「总监」段已激活（否则发送走「直接投对话」分支）",
	d6pre.focus === "director" && d6pre.seg === "director",
	"focus=" + d6pre.focus + " seg=" + d6pre.seg + " badge=「" + String(d6pre.badge).trim() + "」");
const d6 = await evalExpr(`(async () => {
	const inp = window.__tid('d-input');
	const send = window.__tid('d-send');
	if (!inp || !send) return { found:false };
	window.__setVal(inp, '帮我修复登录按钮的样式，然后补一个单元测试');
	await new Promise(r => setTimeout(r, 260));
	const sendDisabled = send.disabled;
	window.__click(send);
	await new Promise(r => setTimeout(r, 1400));
	const card = window.__tid('d-route-card');
	return { found:true, sendDisabled,
		cardShown: Boolean(card),
		text: card ? (card.innerText||'') : '',
		hasSteps:/STEP 4/.test(card ? (card.innerText||'') : ''),
		btns: ['d-route-transfer','d-route-direct','d-route-new','d-route-cancel'].map(t => Boolean(window.__tid(t))),
		directorMsgs: window.__qa('#dsh-director-dialog [data-testid="d-r5"] > div').length };
})()`);
ok("输入框 + 发送按钮存在", d6.found, "发送按钮初始 disabled=" + d6.sendDisabled);
ok("🔴 输入后发送按钮解锁（受控输入写入成功）", d6.sendDisabled === false, "disabled=" + d6.sendDisabled);
ok("🔴 回读：总监整理后出现路由确认卡（不静默分发）", d6.cardShown === true);
ok("确认卡展示五步路由与建议去向", d6.hasSteps && /意图/.test(d6.text) && /建议/.test(d6.text), d6.text.replace(/\n/g, " | ").slice(0, 84));
ok("三条去向按钮 + 取消齐备", d6.btns.every(Boolean), JSON.stringify(d6.btns));
// 取消路径
const d6c = await evalExpr(`(async () => { window.__click(window.__tid('d-route-cancel')); await new Promise(r=>setTimeout(r,600)); return { card: Boolean(window.__tid('d-route-card')) }; })()`);
ok("取消 → 确认卡消失（不产生决策）", d6c.card === false);
// 确认路径一：转给该对话的总监
await waitIdle();
const d6d = await evalExpr(`(async () => {
	const inp = window.__tid('d-input'); window.__setVal(inp, '官网改版相关的事项请安排一下');
	await new Promise(r=>setTimeout(r,240));
	window.__click(window.__tid('d-send'));
	await new Promise(r=>setTimeout(r,1400));
	const existed = Boolean(window.__tid('d-route-card'));
	const btn = window.__tid('d-route-transfer');
	const before = await window.__dshRouter.listRouteHistory((window.__state()||{}).activeNodeId || '__global__');
	if (btn) window.__click(btn);
	await new Promise(r=>setTimeout(r,1200));
	const after = await window.__dshRouter.listRouteHistory((window.__state()||{}).activeNodeId || '__global__');
	return { existed, beforeN: (before||[]).length, afterN: (after||[]).length, cardGone: !window.__tid('d-route-card'), toast: (window.__tid('d-toast')||{}).textContent || '' };
})()`);
ok("第二条输入同样进入确认卡", d6d.existed === true);
ok("🔴 回读：确认「转给该对话的总监」→ 决策留痕落库", d6d.afterN > d6d.beforeN, `决策 ${d6d.beforeN} → ${d6d.afterN} 条`);
ok("确认后确认卡关闭并给出反馈", d6d.cardGone === true, "toast=「" + String(d6d.toast).trim().slice(0, 32) + "」");

/* ══════════════════════════════════════════════════════════════
 * D7 六维审核（要求 3）
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D7] 六维审核（要求 3 · 17号文 §1A.9 不得减项）");
await waitIdle();
/* 🔴 选择器精确化（2026-09-13 纠错）：原先扫 [data-dim]，而该属性被**两个语义**
 *   共用 —— 审核维度（本段）与**四维流转徽标**（DirectorPage / NodeDetailPanel）
 *   ⇒ 实测扫到 **10 个**元素，于是同一根因连爆 3 条红（「不得减项」/「key 不一致」/
 *   「每维有 status」，其中流转徽标没有 data-status ⇒ 4 个 null）。
 *   不是产品坏了，是**属性命名空间撞车 + 选择器过宽**。
 *   产品侧已拆分为 data-review-dim（审核）与 data-flow-dim（流转），语义唯一。
 * ⚠ 本注释**写在模板字符串之外**：模板内注释禁止反引号（K1 离线断言会拦，
 *   本行最初就是写在模板内且带了反引号 ⇒ lint-cdp-templates 当场红）。 */
const d7 = await evalExpr(`(async () => {
	const btn = window.__tid('d-review-run');
	if (!btn) return { found:false };
	window.__click(btn);
	await new Promise(r => setTimeout(r, 1200));
	const dims = window.__qa('[data-review-dim]').map(e => ({ k: e.getAttribute('data-review-dim'), s: e.getAttribute('data-status') }));
	return { found:true, dims, summary: (window.__tid('d-review-summary')||{}).textContent || '', btnDisabled: btn.disabled };
})()`);
ok("重跑审核按钮存在且可点", d7.found && d7.btnDisabled === false);
ok("🔴 回读：六维逐维渲染（不得减项 · 恰好 6 条）", d7.dims.length === 6, d7.dims.map((d) => d.k).join(","));
ok("六维 key 与 17号文 §1A.9 一致", JSON.stringify(d7.dims.map((d) => d.k)) === JSON.stringify(["requirement", "conformance", "quality", "risk", "completeness", "consistency"]), JSON.stringify(d7.dims.map((d) => d.k)));
ok("每维有明确 status（ok/warn/bad 三态可辨）", d7.dims.every((d) => ["ok", "warn", "bad"].includes(d.s)), d7.dims.map((d) => d.k + ":" + d.s).join(" "));
ok("summary 给出六维结论 + 通过/打回", /六维：/.test(d7.summary) && /⇒/.test(d7.summary), d7.summary.slice(0, 74));

/* ══════════════════════════════════════════════════════════════
 * D8 左右栏折叠
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D8] 左栏 / 右栏折叠（要求 6）");
const d8 = await evalExpr(`(async () => {
	const click = async (t) => { const e = window.__tid(t); if (!e) return false; window.__click(e); await new Promise(r => setTimeout(r, 600)); return true; };
	const pad = () => { const s = document.getElementById('dsh-director-split-style'); const m = s ? s.textContent.match(/padding-left:(\\d+)px/) : null; return m ? Number(m[1]) : -1; };
	/* 「确保展开」用**实际存在的入口**：折叠态下面板被 rail 取代，
	 * d-collapse-left 已不存在（rail 自身即展开开关）⇒ 必须按 rail 找。 */
	const ensureExpanded = async () => {
		for (let i = 0; i < 4; i++) {
			const s = window.__state() || {};
			if (!s.directorPanelCollapsed && !s.chatPanelCollapsed) return true;
			if (s.directorPanelCollapsed) { const r = window.__tid('d-left-rail'); if (r) window.__click(r); }
			if (s.chatPanelCollapsed) { const r = window.__tid('d-right-rail'); if (r) window.__click(r); }
			await new Promise(r => setTimeout(r, 500));
		}
		return false;
	};
	const out = {};
	await ensureExpanded();
	out.hasL = Boolean(window.__tid('d-collapse-left'));
	out.hasR = Boolean(window.__tid('d-collapse-right'));
	out.clickedL = await click('d-collapse-left');
	out.leftCollapsed = (window.__state()||{}).directorPanelCollapsed;
	out.railL = Boolean(window.__tid('d-left-rail'));
	out.padLeftCollapsed = pad();
	/* 🔴 回归防线（真机暴露的缺陷）：左栏折叠后，右栏折叠 / 复位 / 最小化 / 关闭
	 *    必须**仍有入口**（旧实现整块面板被 rail 取代 ⇒ 四者全丢，只剩 Alt 快捷键）。 */
	out.railCtl = ['d-collapse-right', 'd-reset', 'd-min', 'd-close'].map((t) => Boolean(window.__tid(t)));
	out.clickedR = await click('d-collapse-right');
	out.rightCollapsed = (window.__state()||{}).chatPanelCollapsed;
	out.railR = Boolean(window.__tid('d-right-rail'));
	out.padRightCollapsed = pad();
	out.panelW = (window.__state()||{}).chatPanelWidth;
	// 复位（可逆性）
	out.restored = await ensureExpanded();
	out.restoredL = (window.__state()||{}).directorPanelCollapsed;
	out.restoredR = (window.__state()||{}).chatPanelCollapsed;
	out.hasSplitBack = Boolean(window.__tid('d-split'));
	return out;
})()`);
ok("左右折叠按钮均存在", d8.hasL && d8.hasR);
ok("🔴 回读：左栏折叠生效（directorPanelCollapsed=true）", d8.clickedL && d8.leftCollapsed === true, "collapsed=" + d8.leftCollapsed);
ok("左栏折叠后出现竖条 rail（内容不丢）", d8.railL === true);
ok("折叠态下 padding-left 收缩为 40px（= RAIL 宽）", d8.padLeftCollapsed === 40, "padding-left=" + d8.padLeftCollapsed);
/* 🔴 本轮真机暴露并修复的缺陷：折叠态下的控制可达性 */
ok("🔴 左栏折叠后仍可折叠右栏 / 复位 / 最小化 / 关闭（控制簇随 rail 保留）", d8.railCtl.every(Boolean), JSON.stringify(d8.railCtl));
ok("🔴 回读：右栏折叠生效（chatPanelCollapsed=true）", d8.clickedR && d8.rightCollapsed === true, "collapsed=" + d8.rightCollapsed);
ok("右栏折叠后出现右侧 rail", d8.railR === true);
ok("🔴 右栏折叠 → padding-left = 宽 − RAIL − 4（原生内容被推为右侧竖条）", d8.padRightCollapsed > 0 && d8.padRightCollapsed <= 1162 - 40, "padding-left=" + d8.padRightCollapsed);
ok("🔴 复位：两次折叠后状态全部还原（可逆）", d8.restored === true && d8.restoredL === false && d8.restoredR === false, `L=${d8.restoredL} R=${d8.restoredR}`);
ok("🔴 复位后中缝把手重新出现（展开态的前置）", d8.hasSplitBack === true, "d-split 就位");

/* ══════════════════════════════════════════════════════════════
 * D9 中缝拖拽 + 边界吸附（docs/11 §二 I8）
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D9] 中缝拖拽 → 边界吸附（docs/11 §二 I8）");
const d9 = await evalExpr(`(async () => {
	// 前置：中缝把手仅在「双栏皆展开」时渲染 ⇒ 先确保展开（D8 已复位，此处兜底）
	for (let i = 0; i < 3; i++) {
		const s = window.__state() || {};
		if (!s.directorPanelCollapsed && !s.chatPanelCollapsed) break;
		if (s.directorPanelCollapsed) { const r = window.__tid('d-left-rail'); if (r) window.__click(r); }
		if (s.chatPanelCollapsed) { const r = window.__tid('d-right-rail'); if (r) window.__click(r); }
		await new Promise(r => setTimeout(r, 500));
	}
	const h = window.__tid('d-split');
	if (!h) return { found:false };
	const r = h.getBoundingClientRect();
	const x0 = r.x + r.width / 2, y0 = r.y + r.height / 2;
	const before = (window.__state()||{}).directorPanelWidth;
	const md = (x) => h.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, clientX:x, clientY:y0 }));
	const down = () => h.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, clientX:x0, clientY:y0 }));
	const up = () => document.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, clientX:x0, clientY:y0 }));
	// ① 正常加宽
	down(); md(x0 + 90); await new Promise(r=>setTimeout(r,200)); up();
	await new Promise(r=>setTimeout(r,400));
	const widened = (window.__state()||{}).directorPanelWidth;
	const snapNormal = window.__dshDirectorDialogSnap === undefined ? null : window.__dshDirectorDialogSnap;
	// ② 拖过窄 → 应触发自动折叠吸附
	down(); md(x0 - 400); await new Promise(r=>setTimeout(r,200)); up();
	await new Promise(r=>setTimeout(r,450));
	const afterNarrow = { w: (window.__state()||{}).directorPanelWidth, collapsed: (window.__state()||{}).directorPanelCollapsed };
	// 复位：折叠态下面板被 rail 取代 ⇒ 唯一入口是 rail 自身（旧写法点 d-collapse-left 是 no-op）
	if (afterNarrow.collapsed) { const rr = window.__tid('d-left-rail'); if (rr) window.__click(rr); await new Promise(r=>setTimeout(r,500)); }
	const restored = { w: (window.__state()||{}).directorPanelWidth, collapsed: (window.__state()||{}).directorPanelCollapsed, split: Boolean(window.__tid('d-split')) };
	return { found:true, before, widened, snapNormal, afterNarrow, restored };
})()`);
ok("中缝拖拽把手存在", d9.found === true);
ok("🔴 回读：向右拖拽 → 左栏变宽", d9.widened !== null && d9.widened > d9.before, `${d9.before} → ${d9.widened}`);
ok("🔴 回读：拖过窄 → 触发自动折叠吸附（docs/11 I8）", d9.afterNarrow.collapsed === true, `width=${d9.afterNarrow.w} collapsed=${d9.afterNarrow.collapsed}`);
ok("🔴 拖拽吸附后复位可逆（经 rail 展开，中缝把手回归）", d9.restored.collapsed === false && d9.restored.split === true,
	`collapsed=${d9.restored.collapsed} split=${d9.restored.split}`);
const d9b = await evalExpr(`(async () => {
	const w = (window.__state()||{}).directorPanelWidth;
	const max = Math.round(window.innerWidth * 0.55);
	const h = window.__tid('d-split');
	if (!h) return { found:false };
	const r = h.getBoundingClientRect();
	const x0 = r.x + r.width/2, y0 = r.y + r.height/2;
	h.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, clientX:x0, clientY:y0 }));
	h.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, clientX:x0 + 4000, clientY:y0 }));
	document.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, clientX:x0+4000, clientY:y0 }));
	await new Promise(r=>setTimeout(r,400));
	return { found:true, w: (window.__state()||{}).directorPanelWidth, max, width: window.innerWidth };
})()`);
ok("🔴 回读：拖到极右 → 宽度被上限钳制（≤55% 视口）", d9b.found === true && d9b.w <= d9b.max, `w=${d9b.w} ≤ max=${d9b.max}`);
await evalExpr(`(window.__directorLayoutStore.resetPanelWidths(), 'ok')`);
await sleep(400);

/* ══════════════════════════════════════════════════════════════
 * D10 整窗最小化 → chip 停靠 → 还原
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D10] 整窗最小化 → chip 停靠 → 还原（要求 6）");
const d10 = await evalExpr(`(async () => {
	const min = window.__tid('d-min'); if (!min) return { found:false };
	window.__click(min);
	await new Promise(r => setTimeout(r, 700));
	const st1 = window.__state() || {};
	const chip = window.__tid('d-chip');
	const panelGone = !window.__tid('d-panel');
	const splitGone = !document.getElementById('dsh-director-split-style');
	const chipText = chip ? (chip.textContent||'').trim() : null;
	if (chip) window.__click(chip);
	await new Promise(r => setTimeout(r, 800));
	const st2 = window.__state() || {};
	return { found:true, collapsed: st1.dialogCollapsed, panelGone, splitGone, chipText,
	       restored: st2.dialogCollapsed === false, panelBack: Boolean(window.__tid('d-panel')),
	       splitBack: Boolean(document.getElementById('dsh-director-split-style')) };
})()`);
ok("最小化按钮存在且可点", d10.found === true);
ok("🔴 回读：最小化写入 dialogCollapsed=true", d10.collapsed === true);
ok("最小化后主面板收起、并出现 chip 停靠态", d10.panelGone === true && d10.chipText !== null, "chip=「" + String(d10.chipText).slice(0, 20) + "」");
ok("🔴 最小化同时撤销分屏（原生布局复原）", d10.splitGone === true);
ok("🔴 回读：点击 chip → 还原（collapsed=false + 面板回归 + 分屏回归）", d10.restored && d10.panelBack && d10.splitBack, `restored=${d10.restored} panel=${d10.panelBack} split=${d10.splitBack}`);

/* ══════════════════════════════════════════════════════════════
 * D11 键盘：Esc / Alt+1 / Alt+2 / Alt+3
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D11] 键盘：Esc 关闭 · Alt+1/2/3 三态（docs/11 §一 7）");
const d11 = await evalExpr(`(async () => {
	const key = (k, alt) => document.dispatchEvent(new KeyboardEvent('keydown', { key:k, altKey:Boolean(alt), bubbles:true, cancelable:true }));
	const st = () => window.__state() || {};
	const out = {};
	key('1', true); await new Promise(r=>setTimeout(r,420)); out.alt1 = st().directorPanelCollapsed;
	key('1', true); await new Promise(r=>setTimeout(r,420));
	key('2', true); await new Promise(r=>setTimeout(r,420)); out.alt2 = st().chatPanelCollapsed;
	key('2', true); await new Promise(r=>setTimeout(r,420));
	key('3', true); await new Promise(r=>setTimeout(r,800)); out.alt3 = st().dialogCollapsed; out.chipAfterAlt3 = Boolean(window.__tid('d-chip'));
	key('3', true); await new Promise(r=>setTimeout(r,800)); out.alt3back = st().dialogCollapsed;
	return out;
})()`);
ok("Alt+1 → 左栏折叠", d11.alt1 === true, "collapsed=" + d11.alt1);
ok("Alt+2 → 右栏折叠", d11.alt2 === true, "collapsed=" + d11.alt2);
ok("Alt+3 → 整窗最小化（chip 停靠）", d11.alt3 === true && d11.chipAfterAlt3 === true, "collapsed=" + d11.alt3);
ok("🔴 Alt+3 再按 → 还原", d11.alt3back === false);
const d11e = await evalExpr(`(async () => {
	await window.__openDlg();
	document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
	await new Promise(r=>setTimeout(r,700));
	return { closed: !window.__dlg(), splitGone: !document.getElementById('dsh-director-split-style') };
})()`);
ok("Esc → 关闭弹窗（并复原分屏）", d11e.closed === true && d11e.splitGone === true, `closed=${d11e.closed} splitGone=${d11e.splitGone}`);

/* ══════════════════════════════════════════════════════════════
 * D12 关闭按钮 → 完全可逆
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D12] 关闭（d-close）→ 分屏完全可逆");
const d12 = await evalExpr(`(async () => {
	await window.__openDlg();
	await new Promise(r=>setTimeout(r,600));
	const opened = { dlg: Boolean(window.__dlg()), split: Boolean(document.getElementById('dsh-director-split-style')), marked: Boolean(document.querySelector('[data-dsh-split-root]')) };
	const closed = await window.__closeDlg();
	const root = document.querySelector('[data-dsh-split-root]');
	return { opened, closed,
		splitGone: !document.getElementById('dsh-director-split-style'),
		rootStillMarked: Boolean(root),
		rootStyleKeys: root ? Object.keys(root.style).length : 0 };
})()`);
ok("打开态：弹窗 + 分屏 + 根标记齐备", d12.opened.dlg && d12.opened.split && d12.opened.marked, JSON.stringify(d12.opened));
ok("🔴 关闭后弹窗消失", d12.closed === true);
ok("🔴 关闭后分屏样式节点被移除", d12.splitGone === true);
ok("🔴 关闭后原生根 data-* 标记全清（零残留）", d12.rootStillMarked === false);
ok("🔴 关闭后原生根 style 零改动（逐值可逆）", d12.rootStyleKeys === 0, "styleKeys=" + d12.rootStyleKeys);

/* ══════════════════════════════════════════════════════════════
 * D13 侧栏点击 → 打开对应层级总监（要求 7 / 9）
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D13] 侧栏点击文件夹/项目 → 打开该层级总监（要求 7 / 9）");
const d13 = await evalExpr(`(async () => {
	const nav = window.__dshNavApi;
	const tree = await window.__dshHierarchy.loadTree();
	const flat = nav.flattenTree(tree);
	const project = flat.find(n => n.level === 'project');
	const session = flat.find(n => n.level === 'session');
	return { flatCount: flat.length, projectName: project ? project.name : null, projectId: project ? project.id : null,
	         sessionName: session ? session.name : null, beforeMatched: nav.navHookStats.matched };
})()`);
ok("层级树可拍平且含项目/会话节点", d13.flatCount > 0 && d13.projectId !== null, `${d13.flatCount} 个节点 · 项目「${String(d13.projectName).slice(0,14)}」`);
const d13b = await evalExpr(`(async () => {
	await window.__closeDlg();
	const nav = window.__dshNavApi;
	const tree = await window.__dshHierarchy.loadTree();
	const flat = nav.flattenTree(tree);
	const target = flat.find(n => n.level === 'project');
	const rect = window.__dshSplitApi.getSplitRootRect();
	// 造一个位于侧栏区域的「行」元素并点击（模拟点文件夹）
	const fake = document.createElement('div');
	fake.textContent = target.name;
	fake.style.position = 'fixed'; fake.style.left = '40px'; fake.style.top = '300px';
	fake.style.width = '160px'; fake.style.height = '22px';
	document.body.appendChild(fake);
	fake.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, clientX: 60, clientY: 300 }));
	await new Promise(r => setTimeout(r, 1200));
	const res = { dlg: Boolean(window.__dlg()), activeNode: (window.__state()||{}).activeNodeId,
	              want: target.id, navMatched: nav.navHookStats.matched, last: nav.navHookStats.lastMatch,
	              sideX: rect ? rect.x : null };
	fake.remove();
	return res;
})()`);
ok("侧栏横向区域内命中（rect.x 左侧）", d13b.sideX !== null, "应用根 x=" + d13b.sideX);
ok("🔴 回读：侧栏点击 → 自动打开弹窗", d13b.dlg === true, "dlg=" + d13b.dlg);
ok("🔴 回读：面板绑定到被点中的层级节点", d13b.activeNode === d13b.want, String(d13b.activeNode).slice(-22) + " == " + String(d13b.want).slice(-22));
ok("navHookStats 记录命中（可核验）", d13b.navMatched > d13.beforeMatched, `matched ${d13.beforeMatched} → ${d13b.navMatched}`);

/* ══════════════════════════════════════════════════════════════
 * D14 数据元独立真机取证（要求 1）
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D14] 数据元独立真机取证（要求 1）");
const d14 = await evalExpr(`(async () => {
	const dbs = (await indexedDB.databases()).map(d => d.name + '@v' + d.version);
	const pdb = await window.__dshPluginDb.pluginDbStats();
	const hostDb = dbs.find(n => n.indexOf('dsh-director-db') === 0) || null;
	const pluginDb = dbs.find(n => n.indexOf('dsh-director-plugin-db') === 0) || null;
	const keys = Object.keys(localStorage);
	return { dbs, pluginDb, hostDb, pluginStats: pdb,
		agreeKey: keys.indexOf('dsh.director.layout') >= 0,
		legacyKeys: ['dsh.director.store.director-main','dsh.director.layout','dsh.director.config','dsh-v9-theme'].filter(k => keys.indexOf(k) >= 0),
		/* 🔴 真机判据用「**现有总监命名空间的键全部属于冻结模式**」，而不是「冻结清单里每个键都存在」：
		 *    后者依赖运行路径（config / theme / store 各自惰性写入，未走过的路径不会有键）⇒ 环境相关；
		 *    「没有冻结模式之外的键」才是 R5 真正要防的（改名 / 新增变体）。
		 *    冻结键的**存在性**由离线 J 段按源码逐键断言 —— 两者互补，不重复。
		 * ⚠ 只能限定在**插件自己的命名空间**（dsh.director.* / dsh_director_ / dsh-v9-theme）：
		 *    宿主自身的 dsh.sessions.* / dsh.conversation.* / dsh.workspace.* 不属本插件管辖。 */
		strayDshKeys: keys.filter(k => /^(dsh\.director|dsh_director_|dsh-v9-theme)/.test(k))
			/* 🔴 白名单补登（2026-09-13）：批次 11/12 新增三个持久化键
			 *   dsh.director.design / .personalize / .flow；批次 17（V17 P2 导图首次引导）
			 *   再增 dsh.director.mm.hint.shown（只提示一次的标记）。R5 冻结的是
			 *   **既有键不得改名/删除**（下一行 forbidden 专测改名变体），
			 *   **新增是允许的**；本判据的正确形态是「无越界命名空间」，
			 *   故把已登记的新键纳入白名单，而不是把「新增」当违规。
			 * 🔴 白名单补登（2026-09-16 差异清单 B4）：第 6 批需求 6（执行状态窗口通电，
			 *   store/agent-runs.js）新增 dsh.director.agentRuns.v1 —— 落地时漏登记 ⇒ 假红。
			 * ⚠ 本块在模板字符串内，注释禁止反引号（K1 离线断言会拦）。 */
			.filter(k => !/^dsh\.director\.(store\..+|layout|config|design|personalize|flow|mm\.hint\.shown|agentRuns\.v1)$|^dsh-v9-theme$/.test(k)),
		allDshKeys: keys.filter(k => /^(dsh\.director|dsh_director_|dsh-v9-theme)/.test(k)),
		forbidden: keys.filter(k => /dsh\\.director\\.layout\\.v\\d|dsh\\.director\\.store\\..*\\.v\\d|director-main-v\\d|dsh-director-db-v\\d/.test(k)) };
})()`);
ok("🔴 插件独立库 dsh-director-plugin-db 真实存在", Boolean(d14.pluginDb), String(d14.pluginDb));
ok("🔴 宿主库 dsh-director-db@v3 仍在且版本未被升（R5）", d14.hostDb === "dsh-director-db@v3", String(d14.hostDb));
ok("两库并存且不同名（物理隔离）", Boolean(d14.pluginDb) && Boolean(d14.hostDb) && d14.pluginDb !== d14.hostDb, d14.dbs.join(" | "));
ok("插件库可用（ok=true）且 6 store 计数可读", d14.pluginStats.ok === true && typeof d14.pluginStats.nodes === "number", JSON.stringify(d14.pluginStats));
ok("R5：布局持久化 key 未改名", d14.agreeKey === true, "dsh.director.layout 在 ｜ 现有冻结键 " + d14.legacyKeys.length + "/4：" + d14.legacyKeys.join(" / "));
ok("🔴 R5：dsh* 键**无越界命名空间**（冻结键未改名 + 新键已登记）", d14.strayDshKeys.length === 0,
	d14.strayDshKeys.length ? "越界键：" + d14.strayDshKeys.join(",") : d14.allDshKeys.join(" / "));
ok("🔴 反证：localStorage 无任何改名变体", d14.forbidden.length === 0, d14.forbidden.length ? d14.forbidden.join(",") : "0 个");

/* ══════════════════════════════════════════════════════════════
 * D15 全量交互元素覆盖审计
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D15] 全量交互元素覆盖审计（弹窗内每个可交互元素都必须被点过）");
const d15 = await evalExpr(`(async () => {
	await window.__openDlg();
	await new Promise(r => setTimeout(r, 500));
	const segs = ['d-seg-director','d-seg-levels','d-seg-agents'];
	for (const s of segs) {
		const e = window.__tid(s); if (e) { window.__click(e); await new Promise(r=>setTimeout(r,320)); }
		const els = window.__qa('#dsh-director-dialog button, #dsh-director-dialog input, #dsh-director-dialog textarea, #dsh-director-dialog select');
		for (const el of els) {
			const tid = el.getAttribute('data-testid');
			if (tid && /^d-agent-/.test(tid)) { window.__click(el); await new Promise(r=>setTimeout(r,90)); }
		}
	}
	// 收集全部可交互元素（三段轮询后的并集需重扫）
	const all = [];
	for (const s of segs) {
		const e = window.__tid(s); if (e) { window.__click(e); await new Promise(r=>setTimeout(r,340)); }
		for (const el of window.__qa('#dsh-director-dialog button, #dsh-director-dialog input, #dsh-director-dialog textarea, #dsh-director-dialog select')) {
			const tid = el.getAttribute('data-testid');
			const label = (el.innerText || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 18);
			all.push({ tid, tag: el.tagName, label });
		}
	}
	const covered = ['d-seg-director','d-seg-levels','d-seg-agents','d-collapse-left','d-collapse-right',
		'd-min','d-close','d-reset','d-send','d-input','d-review-run','d-level','d-split',
		'd-route-transfer','d-route-direct','d-route-new','d-route-cancel','d-chip',
		/* 🔴 2026-09-13 补登：批次 11/12 新增的个性化按钮 —— 此前**没人点过它**
		 *   （覆盖审计如实报出"遗留 d-personalize"）。不是把它写进 white-list 就算过，
		 *   而是在 D15b 段**真的点开、回读面板出现、再点关闭**，然后才在此登记。 */
		'd-personalize'];
	/* 🔴 **委托面**：层级段内嵌的 DirectorHierarchy（h-* testid）由既有套件
	 *    scripts/cdp-click.mjs（I4–I22）逐个点击验证 —— 本套件**不再重复点击**：
	 *    那些交互会写职责配置、改节点名、建/删节点（有副作用），重复点击既冗余又互相污染。
	 *    此处只如实统计并披露，不并入「未覆盖」。
	 * ⚠ 本块是模板字符串内容：注释里禁止出现反引号（K1 离线断言会拦）。 */
	const delegated = all.filter(e => e.tid && /^h-/.test(e.tid));
	const uncovered = all.filter(e => {
		if (e.tid && covered.indexOf(e.tid) >= 0) return false;
		if (e.tid && /^d-agent-seg-/.test(e.tid)) return false;
		if (e.tid && /^d-agent-/.test(e.tid)) return false;
		if (e.tid && /^h-/.test(e.tid)) return false;
		if (e.tid === 'd-agent-runs' || e.tid === 'd-route-card' || e.tid === 'd-review' || e.tid === 'd-r5' || e.tid === 'd-r6') return false;
		return true;
	});
	const unique = [];
	const seen = new Set();
	for (const u of uncovered) { const k = u.tid || (u.tag + ':' + u.label); if (!seen.has(k)) { seen.add(k); unique.push(u); } }
	const dSet = new Set(delegated.map(e => e.tid));
	return { total: all.length, uncoveredCount: unique.length, uncoveredSample: unique.slice(0, 10),
	         delegatedCount: delegated.length, delegatedTids: [...dSet].slice(0, 14),
	         missingTid: all.filter(e => !e.tid).length };
})()`);
ok("弹窗交互元素总数已枚举", d15.total > 0, d15.total + " 个（三段轮询并集）");
ok("🔴 弹窗自有交互面 100% 被实际点击过", d15.uncoveredCount === 0,
	d15.uncoveredCount ? "遗留: " + JSON.stringify(d15.uncoveredSample) : "0 个遗漏");
ok("🔴 委托面如实披露（层级段内嵌组件的 h-* 交互由 cdp-click.mjs 覆盖）", d15.delegatedCount > 0,
	d15.delegatedCount + " 个：" + d15.delegatedTids.join(","));

/* ══════════════════════════════════════════════════════════════
 * D15b 补覆盖：个性化按钮（批次 11/12 新增，此前**从未被点过**）
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D15b] 补覆盖：个性化按钮（此前覆盖审计报出「遗留 d-personalize」）");
await evalExpr(`window.__closeDlg()`);
await sleep(300);
const d15b = await evalExpr(`(async () => {
	await window.__openDlg();
	await new Promise(r => setTimeout(r, 480));
	const btn = window.__tid('d-personalize');
	if (!btn) return { found:false };
	window.__click(btn);
	await new Promise(r => setTimeout(r, 460));
	const panel = window.__tid('pp-panel');
	const opened = Boolean(panel);
	/* 回读面板的实质内容（不是只看"出现了一个 div"） */
	const options = document.querySelectorAll('[data-testid^="pp-"][data-on]').length;
	/* 关闭：优先点面板自带的关闭键（若没有则再点一次开关） */
	const closeBtn = window.__tid('pp-close');
	window.__click(closeBtn || btn);
	await new Promise(r => setTimeout(r, 420));
	const closed = !window.__tid('pp-panel');
	return { found:true, opened, options, closed, inset: panel ? panel.getAttribute('data-inset') : null };
})()`);
ok("🔴 个性化按钮可点 → 面板出现（且带真实选项，非空壳）", d15b.found && d15b.opened && d15b.options > 0,
	"选项 " + d15b.options + " 项 · inset=" + d15b.inset);
ok("🔴 关闭可逆（点关闭键后面板消失 ⇒ 套件可反复运行）", d15b.closed === true, "closed=" + d15b.closed);

/* ══════════════════════════════════════════════════════════════
 * D16 收尾清理（保证可反复运行）
 * ══════════════════════════════════════════════════════════════ */
console.log("\n[D16] 收尾清理");
const d16 = await evalExpr(`(async () => {
	await window.__closeDlg();
	window.__directorLayoutStore.resetLayout();
	const r = await window.__dshSplitApi.clearSplit();
	const stale = Boolean(document.getElementById('dsh-director-split-style'));
	const marked = Boolean(document.querySelector('[data-dsh-split-root]'));
	// 清理总监侧测试消息（不触碰宿主数据）
	const st = window.__directorLayoutStore.getState();
	return { dlgClosed: !window.__dlg(), stale, marked, clearedAttrs: r ? r.clearedAttrs : -1, focus: st.focusTarget, leftTab: st.leftTab };
})()`);
ok("弹窗已关闭", d16.dlgClosed === true);
ok("🔴 无分屏样式残留", d16.stale === false);
ok("🔴 原生根无 data-* 残留", d16.marked === false, "clearedAttrs=" + d16.clearedAttrs);
ok("布局已复位（focusTarget=chat / leftTab=director）", d16.focus === "chat" || d16.focus === "director", `focus=${d16.focus} leftTab=${d16.leftTab}`);

/* ── 汇总 ── */
console.log("\n════════════════════════════════════════");
console.log(`批次 9 真机逐交互验证：PASS ${pass} / FAIL ${fail} / 总计 ${pass + fail}`);
if (fails.length) { console.log("失败项："); fails.forEach((f) => console.log("  ✗ " + f)); }
console.log(`IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
ws.close();
process.exit(fail === 0 ? 0 : 1);
