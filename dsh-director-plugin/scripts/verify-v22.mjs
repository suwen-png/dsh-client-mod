/**
 * `verify-v22.mjs` — 第 6 批（V22）专属真机闸门：宿主左栏几何接管 + 记忆面板时序 + 需求 7/9
 *
 * ── 覆盖的需求（用户原话）─────────────────────────────────────────
 *   需求 1：「对话的 tap 页面 总监和下面哪一个 - 这两列不要,
 *            在现在总监列的最右侧增加最小化, 左右的宽度要允许调整,
 *            [图3] 最小化这个空白还是存在的, 最小化之后旁边的对话要占满」
 *   需求 2：「增加一个秒数, 目前太灵敏了 …这个固定也不好用需要修正, 还要可以上下调整高度」
 *   需求 7：「总监和对话切换的部分, 放到最下面 "58 轮 · 58 步" 之前,
 *            只用一个按钮位置, 点击切换 …点击对话的时候, r5 总监消息变成对话的消息, 历史信息也要在」
 *   需求 9：「都完成之后去掉这一行」（R8 整行）
 *
 * ── 纪律（本文件按项目 36 条逐条落实，关键处在断言旁写明）──────────────
 *   · **绝不抛穿**：`ev()` 重试一次；失败先探"页面还在不在"，页面没了 ⇒ INVALID(exit 2)
 *     并报"已跑到第几条"；页面还在 ⇒ 返回 null 让断言**如实报红**（纪律 B/C）。
 *   · **先证前提、再断结果**（纪律 23）：每条断言前先确认它依赖的起点（页签 / 列在不在 /
 *     面板当前是否收起），起点不成立时用 `sk()` 记**跳过并写明原因**，不用"本机数据如此"糊。
 *   · **几何对账 > 存在性断言**（纪律 A）：最小化的判据是"列宽**精确等于 0** 且
 *     右侧宽度**增量等于**列让出的宽度（±2px）"，不是"按钮点了"。
 *   · **动别人状态前先读原值、收尾按原样还**（纪律 26）：列宽 / 页签 / 延迟 / 高度 / 锁定
 *     全部在 A 段快照，G 段逐项还原并断言 `after === before`。
 *   · **反例意识**（纪律 32）：记忆面板延迟用**同一事件、两个时间点**做正负对照
 *     （早读必须"还没展开"、晚读必须"已展开"）—— 只测"晚读展开"在零延迟下也会通过。
 *
 * 用法：node scripts/verify-v22.mjs
 * 退出码：0 全通过 / 1 FAIL / 2 INVALID（环境不满足，不是产品缺陷）
 */
/* 🔴 端口取自环境量，且**两个名字都认**（2026-09-17 第 35 轮实测缺陷）：
 *   本仓存在**两个**端口环境变量名 —— `CDP_PORT`（46 处，主流）与 `DSH_CDP_PORT`（24 处）。
 *   `run-live.mjs` 与 `_cdp-startup.mjs` 用的是 `CDP_PORT`，而本文件原先只认 `DSH_CDP_PORT`
 *   ⇒ 带 `CDP_PORT=9333` 跑时，启动器把 Harness 拉在 9333，本套件却仍去连 9222
 *   ⇒ 读数 `INVALID：连不上 CDP 9222`（**看起来像产品/环境坏，其实是两个名字没对齐**）。
 *   ⚠️ 顺序必须是 `CDP_PORT` 优先：它是启动器真正用的那个。
 *   完整排查见 §八 纪律 126（同一语义两个标识符 = 隐式断链）。 */
import { PORT } from "./cdp-port.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══════════ 结果记账 ══════════ */
const R = { pass: 0, fail: 0, skip: 0, rows: [], executed: 0 };
function ok(name, cond, detail) {
	R.executed++;
	if (cond) { R.pass++; R.rows.push("  ✅ " + name + (detail ? "  " + detail : "")); }
	else { R.fail++; R.rows.push("  ❌ " + name + (detail ? "  " + detail : "")); }
}
/** 跳过必须带**可分辨原因**（纪律 18：跳过比红更危险，且不许用不可证伪的收尾） */
function sk(name, why) {
	R.executed++;
	R.skip++;
	R.rows.push("  ⏭️ " + name + "  （跳过原因：" + why + "）");
}
function sect(t) { R.rows.push("\n── " + t + " ──"); }

/* ══════════ CDP 连接 ══════════ */
let targets = null;
for (let k = 1; k <= 10; k++) {
	try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json(); break; }
	catch (e) { await sleep(2500); }
}
if (!targets) { console.log("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）"); process.exit(2); }
const page = targets.filter((x) => x.type === "page").find((x) => !/devtools/.test(x.url));
if (!page) { console.log("IS_PASS: FALSE（INVALID：无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pend = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pend.has(m.id)) {
		const { res, rej } = pend.get(m.id); pend.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}, ms = 12000) => new Promise((res, rej) => {
	const id = ++seq;
	const h = setTimeout(() => { pend.delete(id); rej(new Error("timeout " + method)); }, ms);
	pend.set(id, { res: (v) => { clearTimeout(h); res(v); }, rej: (e) => { clearTimeout(h); rej(e); } });
	ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));

/* 全局兜底：未捕获异常**不许**把脚本打哑（那会让其后断言静默消失） */
let fatal = null;
process.on("uncaughtException", (e) => { fatal = e; });
process.on("unhandledRejection", (e) => { fatal = e; });

async function enable() { try { await send("Runtime.enable"); return true; } catch (e) { return false; } }

/* 🔴 真实鼠标的**可见性前提**（第二十四轮统一加装 · 纪律 29/54）
 *    CDP 的 `mousePressed/Released` 在 `document.visibilityState !== "visible"`
 *    （Electron 窗口被遮挡/最小化/停在后台）时会被**整条吞掉**，而 `mouseMoved` 照常送达
 *    ⇒ 表现是「拖不动 / 点了没反应」，读起来完全是**产品坏了**。
 *    🔴 `document.hasFocus()` 在 hidden 时**仍为 true** ⇒ 不能拿它当判据，只认 `visibilityState`。
 *    实测对照：hidden ⇒ 只送达 pointermove；visible ⇒ pointerdown/mousedown/pointerup/click 全到。
 *    不成立 ⇒ 后续鼠标断言**不可信**，应判 INVALID（纪律 24），不判产品红。 */
const FOCUS_PRE = await (async () => {
	const { ensurePageFocus } = await import("./_cdp-focus.mjs");
	const ev = async (e) => {
		const r = await send("Runtime.evaluate", { expression: e, returnByValue: true });
		return r && r.result ? r.result.value : undefined;
	};
	const fp = await ensurePageFocus({ send, ev, log: (s) => console.log(s) });
	console.log("  [鼠标前提] visibility=" + JSON.stringify(fp.visibility)
		+ " ｜ hasFocus=" + JSON.stringify(fp.hasFocus)
		+ " ｜ bringToFront=" + fp.broughtToFront + " ｜ focusEmulated=" + fp.focusEmulated
		+ (fp.reasons.length ? " ｜ 降级：" + fp.reasons.join(" / ") : ""));
	return fp;
})();

if (!(await enable())) { console.log("IS_PASS: FALSE（INVALID：Runtime.enable 超时 —— 渲染进程无响应）"); process.exit(2); }

/** 页面是否还活着（用极廉价的表达式探，不复用业务选择器） */
async function pageAlive() {
	try {
		const o = await send("Runtime.evaluate", { expression: "1+1", returnByValue: true }, 6000);
		return o && o.result && o.result.value === 2;
	} catch (e) { return false; }
}

/** 求值：不抛穿。页面没了 ⇒ 返回哨兵；页面在但表达式错 ⇒ 返回 {__exc} */
const GONE = { __gone: true };
async function ev(expr) {
	for (let i = 0; i < 2; i++) {
		try {
			const o = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, 12000);
			if (o.exceptionDetails) return { __exc: (o.exceptionDetails.exception && o.exceptionDetails.exception.description) || o.exceptionDetails.text };
			return o.result && o.result.value;
		} catch (e) {
			if (i === 0) { await sleep(600); continue; }
			if (!(await pageAlive())) return GONE;
			return null;
		}
	}
	return null;
}
const evJSON = async (expr) => { const v = await ev(expr); if (v === GONE) return GONE; if (v == null || v.__exc) return null; try { return JSON.parse(v); } catch (e) { return null; } };

/* ══════════ 真实鼠标 ══════════ */
async function mouse(type, x, y, extra = {}) {
	await send("Input.dispatchMouseEvent", Object.assign({ type, x, y }, extra), 9000);
}
/** 命中测试：该坐标上最顶层元素是不是自己/自己人（纪律 22） */
async function hitAt(x, y, sel) {
	return ev("(function(){var e=document.elementFromPoint(" + x + "," + y + ");if(!e)return 'none';"
		+ "var t=e.closest(" + JSON.stringify(sel) + ");return t?'ok:'+t.tagName+'#'+(t.id||'')+'['+(t.getAttribute('data-testid')||'')+']':'hit:'+e.tagName+'.'+String(e.className||'').slice(0,30);})()");
}
async function realClick(x, y) {
	await mouse("mouseMoved", x, y, { button: "none", clickCount: 0 });
	await sleep(50);
	await mouse("mousePressed", x, y, { button: "left", clickCount: 1 });
	await sleep(35);
	await mouse("mouseReleased", x, y, { button: "left", clickCount: 1 });
}
/** 几何取中心点（视口内 + 命中自己才算数，否则返回 null） */
async function centerOf(sel) {
	return evJSON("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return null;"
		+ "var r=e.getBoundingClientRect();if(r.width<1||r.height<1)return null;"
		+ "var x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);"
		+ "if(x<1||y<1||x>innerWidth-1||y>innerHeight-1)return null;"
		+ "return JSON.stringify({x:x,y:y,w:Math.round(r.width),h:Math.round(r.height)});})()");
}
/** 按结果重试的点击（合成事件不可用时的兜底；调用方必须报出用了哪条路）
 *  🔴 失败时**必须带回诊断**（纪律 24：失败的 e2e 先看"页面还在不在"再看功能，
 *     且不许只回一个 `null` 让人无从下手）—— 回 `fail:<中心点>/<命中结果>`。 */
async function clickWhenReady(sel, tries = 12) {
	let last = "从未取到中心点";
	for (let i = 0; i < tries; i++) {
		const c = await centerOf(sel);
		if (c) {
			const h = await hitAt(c.x, c.y, sel);
			if (typeof h === "string" && h.indexOf("ok:") === 0) { await realClick(c.x, c.y); return "real@" + c.x + "," + c.y; }
			last = "center@" + c.x + "," + c.y + " hit=" + h;
		} else {
			last = "center=null（元素不存在 / 盒子为空 / 在视口外）";
		}
		await sleep(220);
	}
	return "fail:" + last;
}

/* ══════════ 页面状态工具 ══════════ */
/* 🔴 2026-09-16 差异清单 B1：冷启动停在欢迎页 ⇒ 宿主页签环根本不渲染
 * （实测：欢迎页 [role=tab]=0，会话打开后=3 个「总监/对话/轨迹」）。
 * 旧闸门依赖上一轮残留的打开态起跑（跨运行状态污染），冷启动必 INVALID。
 * ⇒ 起点显式建立：无 conversation.view 槽就真实点开第一条会话行（探针判据 /sessionRow/）。 */
/** 当前会话在宿主侧的消息条数。
 *  ⚠️ 必须用 `readConversationItems()`（读宿主消息列表的可见子节点）—— 它**要求当前在「对话」页签**
 *     （页签是"内容互换"：切到总监时消息滚动容器整体卸载）。这也是起点必须先切页签的原因。 */
async function hostMsgCount() {
	return await ev("(function(){try{var b=window.__dshChatBridge;if(!b||!b.readConversationItems)return -1;"
		+ "var r=b.readConversationItems(40);return r&&r.ok?r.total:-1;}catch(e){return -1;}})()");
}

async function ensureSessionOpen() {
	/* 🔴 2026-09-16：起点不只要"会话打开"，还要**满足 F9 的前提**（宿主消息 ≥ 2 条）。
	 *   旧写法"已开着就直接返回" ⇒ 会话列表是真实的、跨运行累积的，
	 *   恰好停在只有 1 条消息的会话上时，F9 会报「宿主总数=1」——
	 *   读起来像"历史信息没搬"，实际是**前提没建立**（本项目已登记两次的同型缺陷）。
	 *   要点①：**先在「对话」页签**（否则消息列表未挂载，读数为 0/1，换会话也白换）；
	 *   要点②：逐个候选会话试开，取第一个达标的；一个都不达标就报错（不静默跳过）。 */
	const NEED = 2;
	await ensureTab("对话");
	const slotOpen = await ev('!!document.querySelector(\'[data-slot="conversation.view"]\')');
	if (slotOpen) {
		const n0 = await hostMsgCount();
		if (n0 >= NEED) return { opened: false, note: "已有打开的会话（宿主消息 " + n0 + " 条，满足 F9 前提）", count: n0 };
	}
	const rows = await evJSON("(function(){var out=[];var all=document.querySelectorAll('div,li');"
		+ "for(var i=0;i<all.length;i++){var e=all[i];"
		+ "if(/sessionRow/.test(String(e.className))){var t=(e.textContent||'').trim();"
		+ "if(t && t!=='新会话'){var r=e.getBoundingClientRect();"
		+ "if(r.width>40&&r.height>10) out.push({x:Math.round(r.left+40),y:Math.round(r.top+r.height/2),label:t.slice(0,18)});"
		+ "if(out.length>=8) break;}}}"
		+ "return JSON.stringify(out);})()");
	if (!rows || !rows.length) return { opened: false, err: "找不到可打开的会话行（会话列表未渲染？）" };
	const tried = [];
	for (const row of rows) {
		await realClick(row.x, row.y);
		for (let i = 0; i < 8; i++) { await sleep(350); if (await ev('!!document.querySelector(\'[data-slot="conversation.view"]\')')) break; }
		const n = await hostMsgCount();
		tried.push(row.label + "=" + n);
		if (n >= NEED) return { opened: true, note: "已真实点击打开会话「" + row.label + "」（宿主消息 " + n + " 条 ≥ " + NEED + "）", count: n };
	}
	return { opened: false, err: "试开 " + rows.length + " 个会话都拿不到 ≥" + NEED + " 条宿主消息（F9 前提无法建立）：" + tried.join(" ／ ") };
}

async function ensureTab(name) {
	const cur = await ev("(function(){var t=document.querySelector('[role=tab][aria-selected=true]');return t?t.textContent.trim():null})()");
	if (cur === name) return { changed: false, cur };
	const r = await evJSON("(function(){var a=[].slice.call(document.querySelectorAll('[role=tab]'));"
		+ "for(var i=0;i<a.length;i++){if(a[i].textContent.trim()===" + JSON.stringify(name) + "){"
		+ "var b=a[i].getBoundingClientRect();return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)});}}return null;})()");
	if (!r) return { changed: false, cur, err: "页签不存在：" + name };
	await realClick(r.x, r.y);
	for (let i = 0; i < 8; i++) { await sleep(250); const now = await ev("(function(){var t=document.querySelector('[role=tab][aria-selected=true]');return t?t.textContent.trim():null})()"); if (now === name) break; }
	return { changed: true, cur };
}

/** 列 / 对话区 / 行 的几何与 inline 记账（一次取全，避免多次往返期间被改） */
const GEO = `(function(){
	function b(e){ if(!e) return null; var r=e.getBoundingClientRect();
		return { x:Math.round(r.left), w:Math.round(r.width), h:Math.round(r.height) }; }
	var col = document.querySelector('[data-dsh-host-col]');
	if (!col) return null;
	var row = col.parentElement;
	var chat = null;
	for (var i=0;i<row.children.length;i++){ var c=row.children[i];
		if (c===col) continue; if (c.getAttribute && c.getAttribute('data-dsh-plugin')) continue;
		var r2=c.getBoundingClientRect(); if (r2.width > (chat?chat.w:300)) chat = {el:c, x:Math.round(r2.left), w:Math.round(r2.width), h:Math.round(r2.height)}; }
	var inl = {};
	['width','minWidth','display','flex','borderRight','overflow','position'].forEach(function(k){ inl[k]=col.style[k]||''; });
	return JSON.stringify({ col:b(col), chat: chat?{x:chat.x,w:chat.w}:null, row:b(row), inline:inl,
		hostHandleHidden: !!document.querySelector('[data-dsh-hidden]'),
		state: window.__dshHostDirectorColumn ? window.__dshHostDirectorColumn.hostColumnState : null });
})()`;

const MEM = `(function(){
	function txt(e){ return String(e && e.textContent || '').replace(/\\s+/g,' ').trim(); }
	var col = document.querySelector('[data-dsh-host-col]');
	if (!col) return null;
	var all = col.querySelectorAll('div');
	var block = null;
	for (var i=0;i<all.length;i++){ var e=all[i];
		if (e.children.length>=1 && e.children.length<=2 && /^总监记忆/.test(txt(e))) { block=e; break; } }
	var wrap = document.getElementById('dsh-memory-content');
	wrap = wrap ? wrap.parentElement : null;
	return JSON.stringify({
		found: !!block,
		headerTxt: block ? txt(block.children[0]).slice(0,30) : null,
		kids: block ? [].slice.call(block.children).map(function(k){ return k.tagName+(k.id?'#'+k.id:'')+(k.getAttribute&&k.getAttribute('data-testid')?'['+k.getAttribute('data-testid')+']':''); }) : null,
		expanded: !!(block && block.children.length > 1),
		maxHeight: wrap ? (wrap.style.maxHeight || '') : null,
		computedMax: wrap ? getComputedStyle(wrap).maxHeight : null,
		heightHandle: !!document.getElementById('dsh-mem-height'),
		/* 🔴 第 35 轮：用户「对话 tap 的总监页面下面有一个延迟 5 秒的横向的控制延迟的元素 去掉」
		 *    ⇒ 记忆工具条（dp-mem-bar + dp-mem-delay + dp-mem-lock）**已整条删除**。
		 *    这里留作**负断言**：三者必须**都不在 DOM**（否则 = 删除不干净，或宿主把它画回来了）。
		 * ⚠️ 本段是 CDP 模板串 —— 上面两行注释里**不许出现反引号**（纪律 101）。 */
		bar: !!document.getElementById('dsh-mem-bar'),
		delayInput: !!document.getElementById('dsh-mem-delay'),
		lockBtn: !!document.getElementById('dsh-mem-lock'),
		flag: (typeof window.__dshMemoryLocked === 'undefined') ? 'undef' : window.__dshMemoryLocked,
		store: (function(){ var s=window.__directorLayoutStore; if(!s) return null; var g=s.getState();
			return { delay: s.getMemoryHoverDelay(), h: s.getMemoryPanelHeight(), locked: s.getMemoryLocked() }; })(),
		cs: (function(){ var a=window.__dshHostDirectorColumn; if(!a||!a.hostColumnState) return null; var c=a.hostColumnState;
			return { open: c.memOpen, close: c.memClose, over: c.memOverBlocked, out: c.memOutBlocked, ent: c.memEnterBlocked }; })()
	});
})()`;

function die(why) {
	console.log(R.rows.join("\n"));
	console.log("\nIS_PASS: FALSE（INVALID：" + why + "）");
	console.log("已执行断言 " + R.executed + " 条（pass=" + R.pass + " fail=" + R.fail + " skip=" + R.skip + "）");
	process.exit(2);
}

/* ══════════════════════════════════════════════════════════════════
 *  A 段 · 起点与前提
 * ══════════════════════════════════════════════════════════════════ */
sect("A 段 · 起点与前提（先证前提，再断结果）");
/* 🔴 B1 起点：先建立"会话已打开"，否则页签环不存在（欢迎页 [role=tab]=0） */
const ses = await ensureSessionOpen();
ok("A0 会话已打开（起点显式建立，不依赖跨运行残留）", ses.opened || !ses.err,
	(ses.note || ses.err) + " · 槽=" + JSON.stringify(await ev('!!document.querySelector(\'[data-slot="conversation.view"]\')')));
if (ses.err) die("A0 起点建立失败：" + ses.err);
/* 起点不只要"开着"，还要**满足后面断言的前提**（F9 需要宿主消息 ≥ 2）——
 * 前提单独成条并带数值，避免"F9 红了却以为功能坏"（本项目已登记两次的同型误判）。 */
ok("A0b 起点前提：所选会话宿主消息 ≥ 2 条（不足则逐个换会话）", Number(ses.count) >= 2, "宿主消息 = " + ses.count);
const tab0 = await ev("(function(){var t=document.querySelector('[role=tab][aria-selected=true]');return t?t.textContent.trim():null})()");
if (tab0 === GONE) die("页面不可达（连 CDP 但求值全失败）");
const tset = await ensureTab("对话");
const tabA = await ev("(function(){var t=document.querySelector('[role=tab][aria-selected=true]');return t?t.textContent.trim():null})()");
ok("A1 起点页签=对话（宿主左栏只在该页签存在）", tabA === "对话", "进入时=" + JSON.stringify(tab0) + "，现在=" + JSON.stringify(tabA));

const apiOk = await ev("typeof (window.__dshHostDirectorColumn||{}).applyHostColumnGeometry");
if (apiOk !== "function") die("宿主左栏接管模块未装载（window.__dshHostDirectorColumn 缺失）——插件未生效或未重启");

/* 🔴 2026-09-16：**切页签会重挂对话区** ⇒ 宿主左栏元素被换掉、我方标记随之丢失，
 *   而重新标记是**异步**的（靠 MutationObserver / heal）。旧写法切完页签立刻读 ⇒ 间歇 INVALID
 *   （读起来像"宿主左栏找不到"，实际是"标记还没回补"）。
 *   建立方式：先调模块自己的 `applyHostColumnGeometry()`（幂等）催一次，再有界等待标记出现；
 *   等不到才判 INVALID 并带上读数。 */
let before = await evJSON(GEO);
if (!before) {
	for (let i = 0; i < 24 && !before; i++) {
		await ev("(function(){try{window.__dshHostDirectorColumn.applyHostColumnGeometry();}catch(e){}return 1;})()");
		await sleep(250);
		before = await evJSON(GEO);
	}
}
if (!before) die("A2 找不到宿主左栏（[data-dsh-host-col] 不在 DOM，已催标记 + 等 6s）—— 对话页未挂载或选择器失效");
ok("A2 宿主左栏已接管（打了 data-dsh-host-col 标记）", !!before.col, "col=" + JSON.stringify(before.col));
/* 🔴 我方控件是**异步**就绪的（`scheduleSync` 有 120ms 限流 + 靠 MutationObserver 触发），
 *   而本闸门紧接着 `_tmp-open-session` 的点击就跑 ⇒ 无等待地读 4 个 id 会**间歇红**。
 *   这是"起点还没到"而不是"控件没做"（同一次运行里 E1/E9 都能读到它们）。
 *   ⇒ 有界轮询 + **报出缺哪一个、等了多久**（否则下一个人只看到一句断言名）。 */
async function waitIds(ids, timeoutMs) {
	const t0 = Date.now();
	let missing = ids.slice();
	while (Date.now() - t0 < timeoutMs) {
		missing = [];
		for (const id of ids) {
			const has = await ev("!!document.getElementById(" + JSON.stringify(id) + ")");
			if (!has) missing.push(id);
		}
		if (!missing.length) break;
		await sleep(120);
	}
	return { missing: missing, waited: Date.now() - t0 };
}
/* ⚠️ 第 35 轮：`dsh-mem-bar`（记忆工具条）已从常驻控件清单移除 —— 它**已不存在**，
 *   继续等它 ⇒ 恒超时 3000ms 且 A3 恒红（典型的"尺子量了个不存在的东西"）。 */
const ctrl = await waitIds(["dsh-host-col-min", "dsh-host-col-resizer"], 3000);
ok("A3 常驻控件齐备（最小化 / 宽度拖拽条）", ctrl.missing.length === 0,
	ctrl.missing.length ? ("缺 " + ctrl.missing.join(",") + "（等了 " + ctrl.waited + "ms）") : ("2/2 就绪 · 等待 " + ctrl.waited + "ms"));
/* 同段补一条**负断言**：常驻控件里不该再有工具条（否则"齐备"的口径与第 35 轮的删除自相矛盾） */
ok("A3b 记忆工具条**不在**常驻控件里（`dsh-mem-bar` 已删，等它 = 等一个不存在的东西）",
	!(await ev("!!document.getElementById('dsh-mem-bar')")));
/* 🔴 高度手柄**不是常驻控件**：它贴在记忆内容区上沿，而内容区只在**展开态**渲染
 *   （`findMemoryContentWrap()` 找不到 `#dsh-memory-content` 就返回 null ⇒ 不建手柄）。
 *   旧写法把它和另外三个并列成"齐备"，于是：收起态恒红、展开态恒绿 —— 两种结果都不说明问题，
 *   之前能过纯粹是上一轮跑完留下的展开态（跨运行残留 = 平凡真）。
 *   改成**双向判据**：在手柄 ⟺ 面板展开。展开态的存在性由 E8/E9 另行断言。 */
const hHandleNow = !!(await ev("!!document.getElementById('dsh-mem-height')"));
const memNowA = await evJSON(MEM);
ok("A3b 高度手柄**随展开态生灭**（判据：手柄存在 ⟺ 面板展开 —— 双向，防止「存在就过」）",
	hHandleNow === !!(memNowA && memNowA.expanded),
	"手柄=" + hHandleNow + " · expanded=" + (memNowA && memNowA.expanded));
ok("A4 宿主自带拖拽手柄已被隐藏（宽度只留一处真相源）", before.hostHandleHidden === true, "data-dsh-hidden 存在=" + before.hostHandleHidden);
ok("A5 起点不是折叠态（否则 C 段的正负对照失去意义）", before.state && before.state.minimized === false, JSON.stringify(before.state && before.state.minimized));

/* ══════════════════════════════════════════════════════════════════
 *  B 段 · 需求 1：那两条已删
 * ══════════════════════════════════════════════════════════════════ */
sect("B 段 · 需求 1：左栏「总监」标题条与「总监对话—」整行已删");
const trimInfo = await evJSON("(function(){var t=window.__dshHostPanelTrim;if(!t)return null;"
	+ "return JSON.stringify({applied:t.trimState.applied.slice(),keys:t.TRIM_TARGETS.map(function(x){return x.key}),reason:t.trimState.reason});})()");
ok("B1 裁剪目标已含两条新增项（host-director-panel-title / host-director-chat-title）",
	!!trimInfo && trimInfo.keys.indexOf("host-director-panel-title") >= 0 && trimInfo.keys.indexOf("host-director-chat-title") >= 0,
	trimInfo ? JSON.stringify(trimInfo.keys) : "裁剪模块缺失");
ok("B2 这两条**真的贴上了**（applied 里出现，不是「调用过」）",
	!!trimInfo && trimInfo.applied.indexOf("host-director-panel-title") >= 0 && trimInfo.applied.indexOf("host-director-chat-title") >= 0,
	trimInfo ? JSON.stringify(trimInfo.applied) : "");

/* 直接量 DOM：面板内可见的「总监」标题条 / 「总监对话」行必须**都不存在**。
 * 🔴 2026-09-16 补（时红时绿根治）：A 段刚点开会话/切页签 ⇒ 宿主可能**重建左栏节点**，
 *    trim 的观察器有 120ms 限流 ⇒ 重建后的节点要过一小会才重新贴上裁剪。
 *    固定读一拍就会"上一跑绿、这一跑红"。⇒ 有界轮询等 trim 稳定（≤3s），
 *    超时仍不收敛才判红（那是真失效，不是时序）。 */
let twoRows = null;
{
	const tT0 = Date.now();
	for (;;) {
		twoRows = await evJSON(`(function(){
	function vis(e){ if(!e) return false; if(e.style && e.style.display==='none') return false;
		var r=e.getBoundingClientRect(); return r.width>0 && r.height>0; }
	var col=document.querySelector('[data-dsh-host-col]');
	if(!col) return null;
	var a=[], b=[];
	for(var i=0;i<col.children.length;i++){ var k=col.children[i];
		var t=String(k.textContent||'').replace(/\\s+/g,'').trim();
		if(vis(k) && t==='总监') a.push(i);
		/* 🔴 2026-09-16 收紧（语义撞车）：/^总监对话/ 会撞上**空状态占位行**
		 * 「总监对话流为空，输入消息开始」（真机实测 kids[3]，vis:true、非裁剪目标）
		 * ⇒ 假红。目标只是「总监对话 —」标题行 ⇒ 必须带折叠符号（— / -）。 */
		if(vis(k) && /^总监对话[—-]/.test(t)) b.push(i); }
	return JSON.stringify({visibleDirectorTitle:a, visibleChatTitle:b, kidCount:col.children.length});
})()`);
		if (twoRows === GONE) die("B 段求值失败（页面消失）");
		if (twoRows && twoRows.visibleDirectorTitle.length === 0 && twoRows.visibleChatTitle.length === 0) break;
		if (Date.now() - tT0 > 3000) break;
		await sleep(200);
	}
}
ok("B3 面板内**没有可见的**「总监」标题条（按可见性量，不按存在性）", !!twoRows && twoRows.visibleDirectorTitle.length === 0, JSON.stringify(twoRows && twoRows.visibleDirectorTitle));
ok("B4 面板内**没有可见的**「总监对话…」行", !!twoRows && twoRows.visibleChatTitle.length === 0, JSON.stringify(twoRows && twoRows.visibleChatTitle));
ok("B5 反例对照：那两条节点仍**在 DOM**（只隐不删 ⇒ 宿主逻辑不受损）",
	!!(await ev("!!document.querySelector('[data-dsh-trimmed=\"host-director-panel-title\"]')"))
	&& !!(await ev("!!document.querySelector('[data-dsh-trimmed=\"host-director-chat-title\"]')")));

/* ══════════════════════════════════════════════════════════════════
 *  C 段 · 需求 1 图3：最小化 ⇒ 列宽归零 + 对话占满（几何对账）
 * ══════════════════════════════════════════════════════════════════ */
sect("C 段 · 需求 1 图3：最小化后列宽精确归零、右侧对话**增量**铺满");
let clickPath = await clickWhenReady("#dsh-host-col-min");
if (clickPath.indexOf("real@") !== 0) {
	// 兜底：命中测试不通过时走程序化点击，但**必须标注**（否则等于假装走过真实命中）
	const p = await ev("(function(){var b=document.getElementById('dsh-host-col-min');if(!b)return 'missing';b.click();return 'dom-click';})()");
	clickPath = "fallback:" + p + "（真实命中失败：" + clickPath + "）";
}
ok("C1 最小化按钮可点（真实鼠标命中自己）", typeof clickPath === "string" && clickPath.indexOf("real@") === 0, "路径=" + clickPath);
await sleep(420);
const min1 = await evJSON(GEO);
if (min1 === GONE) die("C 段求值失败（页面消失）");
ok("C2 折叠态：列宽**精确等于 0**（不是「变小了」）", !!min1 && min1.col && min1.col.w === 0, min1 && min1.col ? "w=" + min1.col.w : "无数据");
ok("C3 折叠态：store 的 directorPanelCollapsed 与 DOM 同步",
	!!min1 && min1.state && min1.state.minimized === true, JSON.stringify(min1 && min1.state && min1.state.minimized));
if (before.chat && min1 && min1.chat) {
	const delta = min1.chat.w - before.chat.w;
	ok("C4 折叠后右侧对话**占满让出的宽度**（增量 = 列让出宽 ±2px）", Math.abs(delta - before.col.w) <= 2,
		"对话 " + before.chat.w + " → " + min1.chat.w + "（Δ=" + delta + "），列让出 " + before.col.w);
	ok("C5 行总宽不变（没有把布局撑破）", Math.abs(min1.row.w - before.row.w) <= 2, before.row.w + " → " + min1.row.w);
} else { sk("C4/C5 几何对账", "起点或折叠态未取到 chat/row 几何"); }
ok("C6 折叠后**最小化按钮仍在视口内可点**（否则再也展不开）", !!(await centerOf("#dsh-host-col-min")));

/* 展开 → 还原断言 after === before */
const expandPath = await clickWhenReady("#dsh-host-col-min");
await sleep(420);
const back1 = await evJSON(GEO);
ok("C7 再点一次可展开（按钮在折叠态仍可命中）", typeof expandPath === "string" && expandPath.indexOf("real@") === 0, "路径=" + expandPath);
ok("C8 展开后列宽回到起点值（±2px）", !!back1 && !!back1.col && Math.abs(back1.col.w - before.col.w) <= 2, before.col.w + " → " + (back1 && back1.col ? back1.col.w : "?"));
let same = false;
if (back1 && back1.inline && before.inline) {
	const keys = Object.keys(before.inline);
	same = keys.every((k) => back1.inline[k] === before.inline[k]);
}
ok("C9 **几何逐字还原**（inline 各属性 after === before，纪律 26）", same,
	"before=" + JSON.stringify(before.inline) + " / after=" + JSON.stringify(back1 && back1.inline));

/* ══════════════════════════════════════════════════════════════════
 *  D 段 · 需求 1：宽度允许自由调整（摆脱宿主 [180,600] 的 clamp）
 * ══════════════════════════════════════════════════════════════════ */
sect("D 段 · 需求 1：宽度可自由拖拽（宿主手柄已隐藏，改由插件拖拽条驱动）");
const rzc = await centerOf("#dsh-host-col-resizer");
const rzHit = rzc ? await hitAt(rzc.x, rzc.y, "#dsh-host-col-resizer") : "center=null";
ok("D1 插件拖拽条存在且可命中（真实鼠标打到的是它自己，纪律 22）",
	!!rzc && typeof rzHit === "string" && rzHit.indexOf("ok:") === 0,
	rzc ? ("center=" + rzc.x + "," + rzc.y + " w=" + rzc.w + " h=" + rzc.h + " hit=" + rzHit) : "取不到中心点（元素不存在 / 盒子为空 / 在视口外）");
if (rzc) {
	const target = Math.min(640, (before.row.w - 320));
	await mouse("mouseMoved", rzc.x, rzc.y, { button: "none", clickCount: 0 });
	await sleep(50);
	await mouse("mousePressed", rzc.x, rzc.y, { button: "left", clickCount: 1 });
	const steps = 8;
	for (let i = 1; i <= steps; i++) {
		await mouse("mouseMoved", rzc.x + Math.round(((target - before.col.w) * i) / steps), rzc.y, { button: "left", buttons: 1, clickCount: 0 });
		await sleep(18); // 拖动步间留 18ms（项目纪律 B）
	}
	await mouse("mouseReleased", rzc.x + (target - before.col.w), rzc.y, { button: "left", clickCount: 1 });
	await sleep(420);
	const dw = await evJSON(GEO);
	const stW = await ev("(function(){var s=window.__directorLayoutStore;return s? s.getState().directorPanelWidth : null})()");
	ok("D2 拖动后**列宽跟随**（±6px）", !!dw && !!dw.col && Math.abs(dw.col.w - target) <= 6,
		"目标 " + target + "，实测 " + (dw && dw.col ? dw.col.w : "?"));
	ok("D3 拖动后 store 宽度与 DOM 一致（同一份真相）", Number.isFinite(stW) && !!dw && !!dw.col && Math.abs(stW - dw.col.w) <= 6, "store=" + stW + " dom=" + (dw && dw.col ? dw.col.w : "?"));
	ok("D4 突破了宿主 600 上限 ⇒ 证明不再受宿主 clamp 约束（负向对照：600 是宿主 setDirectorWidth 的上限）",
		target > 600 ? (!!dw && !!dw.col && dw.col.w > 600) : true, "target=" + target + " actual=" + (dw && dw.col ? dw.col.w : "?"));
	/* 复位 */
	const reset = await ev("(function(){var s=window.__directorLayoutStore;s.resetPanelWidths();return true})()");
	await sleep(420);
	const rw = await evJSON(GEO);
	ok("D5 复位后回到默认宽度且与起点一致（±2px）", reset === true && !!rw && !!rw.col && Math.abs(rw.col.w - before.col.w) <= 2, before.col.w + " → " + (rw && rw.col ? rw.col.w : "?"));
} else {
	sk("D2—D5 宽度拖拽", "拖拽条中心点取不到或命中不通过（可能被浮动按钮组遮挡）");
}

/* ══════════════════════════════════════════════════════════════════
 *  E 段 · 需求 2：记忆面板（延迟秒数 / 锁定语义 / 高度可调）
 * ══════════════════════════════════════════════════════════════════ */
sect("E 段 · 需求 2：记忆面板延迟展开 / 锁定语义修正 / 高度可拖");
const mem0 = await evJSON(MEM);
if (!mem0 || !mem0.found) die("E 段前提不成立：找不到宿主「总监记忆」块（左栏未挂载或文案变了）");
/* ── 第 35 轮：工具条已删（负断言，双向）───────────────────────────────
 *  用户原话：「对话 tap 的总监页面下面有一个延迟 5 秒的 一个横向的控制延迟的元素 去掉」。
 *  🔴 判据必须**双向**：
 *     ① 负向 —— 三个元素（工具条 / 秒数输入 / 锁定按钮）**都不在 DOM**；
 *     ② 正向 —— 被删掉的**能力**必须还在（`memoryHoverDelayMs` 仍是"唯一真相源"且可读，
 *        锁定语义仍在 store 上）。否则"删干净了"与"顺手把能力也砍了"**长得一模一样**
 *        —— 本项目反复踩过的「静默砍功能」（纪律 54）。
 *  ⚠️ 不再断言"默认延迟 > 0"的**具体来源**：默认值仍在 `store/layout.js` 的 `memoryHoverDelayMs: 500`，
 *     但界面不再暴露入口 ⇒ 断言只应钉"读得出来且非负"，不该钉死数值（那会变成第二真相源）。 */
ok("E1 记忆工具条已从 DOM 删除（`dp-mem-bar` 不存在 —— 用户要求去掉的那个横向延迟控件）",
	mem0.bar === false, "bar=" + mem0.bar);
ok("E1b 工具条的两个子控件也已删除（`dp-mem-delay` 秒数输入 / `dp-mem-lock` 锁定按钮）",
	mem0.delayInput === false && mem0.lockBtn === false,
	"delayInput=" + mem0.delayInput + " lockBtn=" + mem0.lockBtn);
ok("E2 删除后**能力仍在**：悬停延迟仍是 store 上的可读量（不是把功能一起砍了）",
	mem0.store && Number.isFinite(mem0.store.delay) && mem0.store.delay >= 0,
	JSON.stringify(mem0.store));
ok("E2b 删除后**锁定语义仍在**：`memoryLocked` 可读且为布尔（收合语义未被连带移除）",
	mem0.store && typeof mem0.store.locked === "boolean", "locked=" + (mem0.store && mem0.store.locked));

/* E3 延迟仍由 store 驱动（**驱动源不再是输入框**，改为直接写 store —— 输入框已不存在） */
await ev("(function(){var s=window.__directorLayoutStore;s.setMemoryHoverDelay(900);return true})()");
await sleep(260);
const dAfter = await ev("(function(){var s=window.__directorLayoutStore;return s?s.getMemoryHoverDelay():null})()");
ok("E3 直接写 store 的延迟 → 立即生效（900ms），且**删掉输入框不影响这条链路**",
	dAfter === 900, "store=" + dAfter);

/* E4/E5 延迟的**正负对照**：同一事件，早读必须"还没展开"，晚读必须"已展开" */
/** 记忆表头中心点（真实鼠标要打到它才触发我们拦下的 mouseover）
 *  🔴 声明必须在使用之前（虽然函数声明会被提升，但"先定义后使用"是本地读脚本的人的唯一线索） */
async function centerOfByText() {
	return evJSON(`(function(){
		function txt(e){ return String(e && e.textContent || '').replace(/\\s+/g,' ').trim(); }
		var col=document.querySelector('[data-dsh-host-col]'); if(!col) return null;
		var all=col.querySelectorAll('div'), block=null;
		for(var i=0;i<all.length;i++){ var e=all[i]; if(e.children.length>=1&&e.children.length<=2&&/^总监记忆/.test(txt(e))){ block=e; break; } }
		if(!block) return null;
		var h=block.children[0]; if(!h) return null;
		var r=h.getBoundingClientRect(); if(r.width<1||r.height<1) return null;
		var x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
		if(x<1||y<1||x>innerWidth-1||y>innerHeight-1) return null;
		return JSON.stringify({x:x,y:y});
	})()`);
}
/* 🔴 「移开点」必须**按当前几何算**，并在用之前**断言它在记忆区之外**（纪律 29 / B）。
 *    2026-09-14 真机取证：旧写法写死 `memHead.x - 40`，同一个点在两次运行里分别落在
 *      · 我方工具条 `BUTTON#dsh-mem-lock`（工具条绝对定位在表头附近）
 *      · 记忆块**内部**
 *    两种都**不是"移开"** ⇒ 后续的"进入"是"区内 → 区内"，我们的捕获监听按 `relatedTarget`
 *    判为"不是进入"而早退 ⇒ 延迟展开从未被触发 ⇒ E5 读到 false。**这是尺子写错，不是产品坏了。**
 *    ⇒ 现在：几何找一个真正在区外的点；断言 `outside === true`（既不在块内、也不是我方节点）。 */
async function outsideMemoryPoint() {
	return evJSON(`(function(){
		function txt(e){ return String(e && e.textContent || '').replace(/\\s+/g,' ').trim(); }
		var col=document.querySelector('[data-dsh-host-col]'); if(!col) return null;
		var all=col.querySelectorAll('div'), block=null;
		for(var i=0;i<all.length;i++){ var e=all[i]; if(e.children.length>=1&&e.children.length<=2&&/^总监记忆/.test(txt(e))){ block=e; break; } }
		if(!block) return null;
		var br=block.getBoundingClientRect(), h=block.children[0];
		if(!h) return null;
		var hr=h.getBoundingClientRect();
		var y=Math.round(hr.top+hr.height/2);
		/* 记忆区 = 宿主块 ∪ 高度手柄（与产品侧 memoryZoneContains 同口径）
		 * ⚠️ 第 35 轮：dsh-mem-bar 已删 ⇒ 从并集里去掉（留着只会是个恒 null 的项）。
		 * 🔴 CDP 模板串内禁反引号（纪律 101）。 */
		var zone=function(el){ if(!el) return null;
			if(block.contains(el)) return 'block';
			var ids=['dsh-mem-height'];
			for(var k=0;k<ids.length;k++){ var n=document.getElementById(ids[k]); if(n&&n.contains(el)) return 'ours'; }
			return null; };
		/* 以块中心为基准，先量"块内"这一侧，再向左/向右找一个 zone 为 null 的点 */
		var cands=[];
		for(var d=6; d<=240; d+=6){
			cands.push({x:Math.round(br.left)-d, y:y, dir:'left'});
			cands.push({x:Math.round(br.right)+d, y:y, dir:'right'});
		}
		cands.push({x:Math.round(br.left+br.width/2), y:Math.round(br.top)-60, dir:'above'});
		for(var i2=0;i2<cands.length;i2++){
			var p=cands[i2];
			if(p.x<2||p.y<2||p.x>innerWidth-2||p.y>innerHeight-2) continue;
			var el=document.elementFromPoint(p.x,p.y); if(!el) continue;
			/* 不合格的候选：仍在记忆区 / 落在我方控件上（含最小化按钮、工具条、手柄） */
			if(zone(el)!==null) continue;
			if(el.closest&&el.closest('[data-dsh-plugin]')) continue;
			return JSON.stringify({x:p.x,y:p.y,dir:p.dir,hit:el.tagName+(el.id?'#'+el.id:''),inZone:false,ours:false,outside:true});
		}
		return null;
	})()`);
}
/* 🔴 「现在浏览器到底认为鼠标悬在谁身上」—— 用 `:hover` 反查，作为"进入"的**前提**。
 *   2026-09-14 教训：真机 e2e **不重载页面** ⇒ 鼠标停在上一段（D 段拖动）留下的位置；
 *   只"派发一次 mouseMoved 到区外"并不等于"起点真的在区外"（派发失败/被吞都看不出来）。
 *   没有这条前提，"进入后 160ms 还开着"无法区分「延迟没生效」与「起点本来就在区内」。 */
async function hoverInMemoryZone() {
	return evJSON(`(function(){
		function txt(e){ return String(e && e.textContent || '').replace(/\\s+/g,' ').trim(); }
		var col=document.querySelector('[data-dsh-host-col]'); if(!col) return JSON.stringify({inside:null,reason:'no-col'});
		var all=col.querySelectorAll('div'), block=null;
		for(var i=0;i<all.length;i++){ var e=all[i]; if(e.children.length>=1&&e.children.length<=2&&/^总监记忆/.test(txt(e))){ block=e; break; } }
		if(!block) return JSON.stringify({inside:null,reason:'no-block'});
		var zone=function(el){ if(!el) return false;
			if(block.contains(el)) return true;
			/* ⚠️ 第 35 轮：dsh-mem-bar 已删 ⇒ 这里只剩高度手柄。
			 *   若继续把已删的 id 列进来，getElementById 恒 null ⇒ 判据**空真**（纪律 93）。
			 * 🔴 本段是 CDP 模板串 —— 注释里**不许出现反引号**（纪律 101）。 */
			var ids=['dsh-mem-height'];
			for(var k=0;k<ids.length;k++){ var n=document.getElementById(ids[k]); if(n&&n.contains(el)) return true; }
			return false; };
		var hov=document.querySelectorAll(':hover'), inside=false, who=null;
		for(var j=0;j<hov.length;j++){ if(zone(hov[j])){ inside=true; who=hov[j].tagName+(hov[j].id?'#'+hov[j].id:''); break; } }
		return JSON.stringify({inside:inside,who:who,hoverCount:hov.length});
	})()`);
}
/* 🔴 起点必须**显式建立**（纪律 B）：先把延迟设成 900ms、并把面板**确保收起**，
 *    否则 E4 的"还没展开"会被上一轮遗留的展开态污染（真机 e2e 不重载页面）。 */
await ev("(function(){var s=window.__directorLayoutStore;s.setMemoryHoverDelay(900);s.setMemoryLocked(false);return true})()");
await ev("window.__dshHostDirectorColumn.collapseMemoryNow()");
await sleep(400);
const preOpen = await evJSON(MEM);
if (preOpen && preOpen.expanded) {
	await ev("window.__dshHostDirectorColumn.collapseMemoryNow()");
	await sleep(350);
}
ok("E4-前置 起点成立：延迟=900ms 且面板当前是收起态（否则 E4/E5 的正负对照不成立）",
	!!preOpen && !preOpen.expanded && preOpen.store && preOpen.store.delay === 900,
	JSON.stringify(preOpen && { expanded: preOpen.expanded, delay: preOpen.store && preOpen.store.delay }));
const memHead = await centerOfByText();
const memAway = await outsideMemoryPoint();
ok("E4-前置2 「移开点」确实在记忆**区外**（按当前几何算 · 不写死坐标 —— 纪律 29/B）",
	!!memAway && memAway.outside === true,
	JSON.stringify(memAway));
if (memHead && memAway) {
	/* 先把指针真正挪到区外（连派两次，避免"第一次被宿主重渲染吞掉"） */
	await mouse("mouseMoved", memAway.x, memAway.y, { button: "none", clickCount: 0 });
	await sleep(120);
	await mouse("mouseMoved", memAway.x, memAway.y, { button: "none", clickCount: 0 });
	await sleep(260);
	const hz0 = await hoverInMemoryZone();
	await ev("window.__dshHostDirectorColumn.collapseMemoryNow()");
	await sleep(300);
	const preSnap = await evJSON(MEM);
	ok("E4-前置3 起点成立：指针**确实已不在**记忆区（`:hover` 反查，不是「派发过就算」）",
		!!hz0 && hz0.inside === false, JSON.stringify({ hz0: hz0, expanded: preSnap && preSnap.expanded }));
	/* 从**区外**真实移动到表头上 —— 这一步才叫"进入" */
	await mouse("mouseMoved", memHead.x, memHead.y, { button: "none", clickCount: 0 });
	await sleep(160);
	const early = await evJSON(MEM);
	await sleep(1100);
	const late = await evJSON(MEM);
	/* 诊断载荷：孩子是谁 + 计数增量 —— 否则下一个人只能看到"expanded=true"却无从下手 */
	const dlt = (a, b) => { const o = {}; if (!a || !b) return o; Object.keys(b).forEach((k) => { if (b[k] !== a[k]) o[k] = a[k] + "→" + b[k]; }); return o; };
	ok("E4 延迟生效（负向）：鼠标进入后 160ms 时**尚未展开**（延迟 900ms）", !!early && early.expanded === false,
		"expanded=" + (early && early.expanded) + " flag=" + (early && early.flag) + " kids=" + JSON.stringify(early && early.kids)
		+ " 计数Δ=" + JSON.stringify(dlt(preSnap && preSnap.cs, early && early.cs)));
	ok("E5 延迟生效（正向）：进入后 >1100ms 时**已展开** —— 两条合起来才是「延迟」的完整证据",
		!!late && late.expanded === true, "expanded=" + (late && late.expanded));
} else { sk("E4/E5 悬停延迟对照", "记忆表头中心点取不到（列被折叠 / 视口外 / 被遮挡）"); }

/* E6 锁定语义：加锁时**不得收起**（宿主原实现是 toggleBottomPanel ⇒ 会翻转 = 缺陷）
 * 🔴 起点显式建立：先**收起**再上锁 —— 否则"上锁后仍展开"可能只是"本来就展开着"（平凡真）。
 * ⚠️ 第 35 轮起**工具条上的锁定按钮已删** ⇒ 改走 `toggleMemoryLock()`（**同一真相源**：
 *    删除前按钮的 click 也是调它，所以这不是"换了一条路"，而是"去掉了一层点击壳"）。
 *    🔴 断言里**必须**同时钉"按钮真的不在了"—— 否则这条测试会在"按钮被删"与"按钮还在"两种
 *    世界里都绿，等于对本次改动零分辨力。 */
await ev("(function(){var s=window.__directorLayoutStore;s.setMemoryLocked(false);return true})()");
await ev("window.__dshHostDirectorColumn.collapseMemoryNow()");
await sleep(400);
const beforeLock = await evJSON(MEM);
ok("E6-前置 起点成立：上锁之前面板是**收起**的（这样「仍展开」才不是平凡真）",
	!!beforeLock && beforeLock.expanded === false && beforeLock.store.locked === false
	&& beforeLock.lockBtn === false,
	JSON.stringify(beforeLock && { expanded: beforeLock.expanded, locked: beforeLock.store.locked, lockBtn: beforeLock.lockBtn }));
const lockRes = await ev(`(function(){
	if (document.getElementById('dsh-mem-lock')) return 'btn-still-present';
	var a = window.__dshHostDirectorColumn; if (!a || !a.toggleMemoryLock) return 'missing-api';
	a.toggleMemoryLock(); return 'called';
})()`);
await sleep(420);
const memLocked = await evJSON(MEM);
ok("E6 上锁 → locked=true 且**面板展开**（修正了宿主「点锁定反而收起」）",
	lockRes === "called" && !!memLocked && memLocked.store && memLocked.store.locked === true && memLocked.expanded === true,
	"via=" + lockRes + " locked=" + (memLocked && memLocked.store && memLocked.store.locked) + " expanded=" + (memLocked && memLocked.expanded));
const unlocked = await ev(`(function(){
	var a = window.__dshHostDirectorColumn; if (!a || !a.toggleMemoryLock) return 'missing-api';
	a.toggleMemoryLock(); return 'called';
})()`);
await sleep(420);
const memUnlocked = await evJSON(MEM);
ok("E7 再上锁一次 → 解锁并收起（语义闭环，不是翻转）",
	unlocked === "called" && !!memUnlocked && memUnlocked.store && memUnlocked.store.locked === false && memUnlocked.expanded === false,
	"locked=" + (memUnlocked && memUnlocked.store && memUnlocked.store.locked) + " expanded=" + (memUnlocked && memUnlocked.expanded));

/* E8/E9 高度可拖 */
await ev("window.__dshHostDirectorColumn.expandMemoryNow()");
await sleep(350);
const h0 = await evJSON(MEM);
ok("E8 高度手柄存在，且内容区 maxHeight 由 store 驱动（不再是宿主写死的 160）",
	!!h0 && h0.heightHandle === true && h0.maxHeight === (h0.store.h + "px"), JSON.stringify({ maxHeight: h0 && h0.maxHeight, h: h0 && h0.store && h0.store.h }));
const hh = await centerOf("#dsh-mem-height");
if (hh) {
	await mouse("mouseMoved", hh.x, hh.y, { button: "none", clickCount: 0 });
	await sleep(40);
	await mouse("mousePressed", hh.x, hh.y, { button: "left", clickCount: 1 });
	for (let i = 1; i <= 6; i++) { await mouse("mouseMoved", hh.x, hh.y - i * 12, { button: "left", buttons: 1, clickCount: 0 }); await sleep(18); }
	await mouse("mouseReleased", hh.x, hh.y - 72, { button: "left", clickCount: 1 });
	await sleep(420);
	const h1 = await evJSON(MEM);
	ok("E9 向上拖高度手柄 → store 高度变大且 DOM maxHeight 跟随", !!h1 && h1.store.h > h0.store.h && h1.maxHeight === (h1.store.h + "px"),
		h0.store.h + " → " + (h1 && h1.store && h1.store.h) + "，maxHeight=" + (h1 && h1.maxHeight));
	await ev("(function(){var s=window.__directorLayoutStore;s.setMemoryPanelHeight(" + h0.store.h + ");return true})()");
} else { sk("E9 高度拖拽", "高度手柄中心点取不到（被遮挡 / 内容区未展开）"); }

/* ══════════════════════════════════════════════════════════════════
 *  F 段 · 需求 7 / 9：底部单按钮切换 + R8 整行已删
 * ══════════════════════════════════════════════════════════════════ */
sect("F 段 · 需求 7/9：R8 整行已删；单按钮切换落在「N 轮 · N 步」之前");
ok("F1 R8 整行已从 DOM 消失（dp-r8 不存在）", !(await ev("!!document.querySelector('[data-testid=\"dp-r8\"]')")));
ok("F2 R8 内部的旧锚点也都没了（dp-send / dp-model / dp-route-* / dp-focus-native / dp-register-flow）",
	!(await ev("!!document.querySelector('[data-testid=\"dp-send\"],[data-testid=\"dp-model\"],[data-testid=\"dp-route-director\"],[data-testid=\"dp-route-chat\"],[data-testid=\"dp-focus-native\"],[data-testid=\"dp-register-flow\"]')")));
const barPos = await evJSON(`(function(){
	var bar=document.getElementById('dsh-host-scope-bar'); if(!bar) return null;
	var nx=bar.nextElementSibling;
	var statRe=/^\\d+\\s*轮\\s*·\\s*\\d+\\s*步$/;
	return JSON.stringify({
		toggles: document.querySelectorAll('#dsh-host-scope-toggle').length,
		nextTag: nx?nx.tagName:null, nextTxt: nx?String(nx.textContent||'').trim():null,
		nextIsStats: !!(nx && statRe.test(String(nx.textContent||'').trim())),
		buttons: [].slice.call(bar.querySelectorAll('button')).map(function(b){return b.getAttribute('data-testid')||b.id}),
		plugins: !!bar.getAttribute('data-dsh-plugin')
	});
})()`);
ok("F3 注入条只含**一个**切换按钮（用户：「只用一个按钮位置」）", !!barPos && barPos.toggles === 1, "toggles=" + (barPos && barPos.toggles));
ok("F4 注入条的**下一个兄弟**就是统计行「N 轮 · N 步」（位置就是用户说的「之前」）",
	!!barPos && barPos.nextIsStats === true, barPos ? ("next=" + barPos.nextTag + " 「" + barPos.nextTxt + "」") : "注入条不在 DOM");
ok("F5 搬迁过来的能力都在（执行 / 登记流转），不是静默砍掉", !!barPos && barPos.buttons.indexOf("dp-host-deliver") >= 0 && barPos.buttons.indexOf("dp-host-register") >= 0,
	barPos ? JSON.stringify(barPos.buttons) : "");
ok("F6 注入条带 data-dsh-plugin（被自己人的裁剪护栏护住）", !!barPos && barPos.plugins === true);

/* F7—F11 切换行为：R5 双视图 */
const had2 = await ensureTab("总监");
await sleep(700);
const dpOn = await ev("!!document.querySelector('[data-testid=\"dp-root\"]')");
if (!dpOn) sk("F7—F11 切换行为", "总监页未挂载（dp-root 不在 DOM），无法验证 R5 视图切换");
else {
	const tgl = await centerOf("#dsh-host-scope-toggle");
	let clicked = null;
	if (tgl) { const h = await hitAt(tgl.x, tgl.y, "#dsh-host-scope-toggle"); if (typeof h === "string" && h.indexOf("ok:") === 0) { await realClick(tgl.x, tgl.y); clicked = "real"; } }
	if (!clicked) { await ev("(function(){var b=document.getElementById('dsh-host-scope-toggle');if(b)b.click();return true})()"); clicked = "fallback:dom-click"; }
	await sleep(700);
	const v1 = await evJSON(`(function(){
		var b=document.querySelector('[data-testid="dp-r5-body"]');
		var tg=document.getElementById('dsh-host-scope-toggle');
		var host=document.getElementById('dsh-host-deliver');
		return JSON.stringify({ view: b?b.getAttribute('data-view'):null, chatMsgs: document.querySelectorAll('[data-testid="dp-chat-msg"]').length,
			total: (function(){var e=document.querySelector('[data-testid="dp-r5-chat"]');return e?Number(e.getAttribute('data-total')):null})(),
			toggleTxt: tg?tg.textContent.trim():null, toggleView: tg?tg.getAttribute('data-view'):null,
			slotView: window.__dshHostComposerSlot? window.__dshHostComposerSlot.composerSlotState.view : null,
			toggleClicks: window.__dshHostComposerSlot? window.__dshHostComposerSlot.composerSlotState.toggleClicks : null,
			deliverBtn: !!host, r5: !!document.querySelector('[data-testid="dp-r5"]') });
	})()`);
	ok("F7 点单按钮 → R5 切到「对话」视图（data-view=chat）", !!v1 && v1.view === "chat", "view=" + (v1 && v1.view) + "，点击方式=" + clicked);
	ok("F8 R5 真的渲染出对话消息（dp-chat-msg 条数 > 0）", !!v1 && v1.chatMsgs > 0, "msgs=" + (v1 && v1.chatMsgs));
	ok("F9 **历史信息也在**（宿主消息总数 ≥ 2 —— 不是只把当前那一条搬过来）", !!v1 && Number.isFinite(v1.total) && v1.total >= 2, "宿主总数=" + (v1 && v1.total));
	ok("F10 按钮文案/状态与 store 同源（按钮写「对话」、slot 记录 view=chat）",
		!!v1 && v1.toggleView === "chat" && v1.slotView === "chat", "toggle=" + (v1 && v1.toggleView) + " slot=" + (v1 && v1.slotView));
	/* F9b/F9c：数据来源必须**可断言、可显示**（纪律 19：降级可以，无声不行）
	 *   ⚠️ 这是本批最关键的一条：宿主页签是"内容互换" ⇒ 总监页签下**消息列表根本不在 DOM**
	 *      ⇒ 视图显示的是**后台镜像快照**，必须把"是什么时候的数据"说出来。
	 *      只断言"有条数"会放过一个"永远显示旧数据且不承认"的实现。 */
	const srcInfo = await evJSON(`(function(){
		var c=document.querySelector('[data-testid="dp-r5-chat"]');
		var s=document.querySelector('[data-testid="dp-r5-chat-source"]');
		if(!c) return null;
		return JSON.stringify({ live:c.getAttribute('data-live'), at:Number(c.getAttribute('data-at')||0),
			srcTxt: s? String(s.textContent||'').trim() : null,
			mirror: (function(){ var m=window.__dshChatBridge&&window.__dshChatBridge.conversationMirror;
				return m? {syncs:m.syncs, misses:m.misses, total:m.total, at:m.at, reason:m.reason, tab:m.tab} : null; })() });
	})()`);
	ok("F9b 视图**标注了数据来源**（dp-r5-chat-source 存在且非空）", !!srcInfo && !!srcInfo.srcTxt && srcInfo.srcTxt.length > 0, srcInfo ? srcInfo.srcTxt : "无来源标注节点");
	ok("F9c 来源与镜像**同源**（data-at 等于镜像最后一次成功同步的时刻，不是各自编一个）",
		!!srcInfo && !!srcInfo.mirror && srcInfo.at > 0 && srcInfo.at === srcInfo.mirror.at,
		srcInfo ? ("data-at=" + srcInfo.at + " mirror.at=" + (srcInfo.mirror && srcInfo.mirror.at) + " syncs=" + (srcInfo.mirror && srcInfo.mirror.syncs) + " reason=" + (srcInfo.mirror && JSON.stringify(srcInfo.mirror.reason))) : "无镜像");
	/* 同一页面上，宿主消息列表条数与 R5 读到的 total 同源 */
	const srcSame = await evJSON(`(function(){
		var t = document.querySelector('[data-testid="dp-r5-chat"]');
		if (!t) return null;
		return JSON.stringify({ total: Number(t.getAttribute('data-total')), shown: Number(t.getAttribute('data-shown')) });
	})()`);
	ok("F11 R5 的 total 与 shown 自洽（shown = min(total, 60) 且 shown ≤ total）",
		!!srcSame && srcSame.shown <= srcSame.total && srcSame.shown === Math.min(srcSame.total, 60), JSON.stringify(srcSame));
	/* 切回总监 */
	await ev("(function(){var b=document.getElementById('dsh-host-scope-toggle');if(b)b.click();return true})()");
	await sleep(600);
	const v2 = await evJSON(`(function(){var b=document.querySelector('[data-testid="dp-r5-body"]');return JSON.stringify({view:b?b.getAttribute('data-view'):null, msgs:document.querySelectorAll('[data-testid="dp-chat-msg"]').length});})()`);
	ok("F12 再点一次切回「总监」视图，且对话消息块被移除（不是叠着）", !!v2 && v2.view === "director" && v2.msgs === 0, JSON.stringify(v2));
	await sleep(200);
	await ensureTab("对话");
}
await sleep(500);

/* ══════════════════════════════════════════════════════════════════
 *  G 段 · 收尾还原（环境复原，纪律 B）
 * ══════════════════════════════════════════════════════════════════ */
sect("G 段 · 收尾还原（把动过的都还回去，并断言还原到位）");
await ev("(function(){var s=window.__directorLayoutStore;" +
	"s.setMemoryLocked(false); s.setMemoryHoverDelay(" + (mem0.store.delay || 500) + "); s.setMemoryPanelHeight(" + (mem0.store.h || 160) + ");" +
	"s.dragDirectorWidth(" + before.col.w + "); s.resetPanelWidths(); return true})()");
await sleep(500);
const fin = await evJSON(GEO);
ok("G1 列宽已还原（±2px）", !!fin && !!fin.col && Math.abs(fin.col.w - before.col.w) <= 2, before.col.w + " → " + (fin && fin.col ? fin.col.w : "?"));
let same2 = false;
if (fin && fin.inline && before.inline) same2 = Object.keys(before.inline).every((k) => fin.inline[k] === before.inline[k]);
ok("G2 inline 几何逐字还原（after === before）", same2, "before=" + JSON.stringify(before.inline) + " / after=" + JSON.stringify(fin && fin.inline));
const finMem = await evJSON(MEM);
ok("G3 记忆面板还原：未锁定 + 延迟/高度回到起点值",
	!!finMem && finMem.store.locked === false && finMem.store.delay === mem0.store.delay && finMem.store.h === mem0.store.h,
	JSON.stringify(finMem && finMem.store) + " / 起点 " + JSON.stringify(mem0.store));
if (tab0 && tab0 !== "对话") { await ensureTab(tab0); await sleep(400); }
const finTab = await ev("(function(){var t=document.querySelector('[role=tab][aria-selected=true]');return t?t.textContent.trim():null})()");
ok("G4 页签还原（与进来时一致 —— 真机 e2e 不重载页面，页签是跨运行保留的状态）", finTab === tab0, "进来时=" + JSON.stringify(tab0) + "，现在=" + JSON.stringify(finTab));
ok("G5 全过程无未捕获异常把脚本打哑", fatal === null, fatal ? String(fatal && fatal.message) : "无");

/* ══════════════════════════════════════════════════════════════════
 *  汇总
 * ══════════════════════════════════════════════════════════════════ */
console.log(R.rows.join("\n"));
console.log("\n════ 汇总 ════");
console.log("  通过 " + R.pass + " / 失败 " + R.fail + " / 跳过 " + R.skip + "（共 " + R.executed + " 条断言）");
const pass = R.fail === 0 && R.skip === 0;
console.log("IS_PASS: " + (pass ? "TRUE（" + R.pass + "/" + R.executed + " · 零跳过）" : "FALSE"));
process.exit(pass ? 0 : 1);
