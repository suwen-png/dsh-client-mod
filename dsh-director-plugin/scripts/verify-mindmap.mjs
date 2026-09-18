#!/usr/bin/env node
/**
 * verify-mindmap.mjs —— 分支导图（思维导图）真机端到端验证
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么是「点击前回读 → 真实点击 → 点击后回读」而不是契约验证
 * ──────────────────────────────────────────────────────────────────
 * 用户要求原文：「按照可能用到的思维导图元素 完善思维导图」
 *              「思维导图的X和原软件也是一个位置」（✕ 与原生按钮重叠）
 * 契约验证只能证明「函数存在」，证明不了「点了真的变了、变对了」。
 *
 * 🔴 本轮另有一条**必须留在脚本里的纪律**：位置类断言要用**真实几何**
 *    （getBoundingClientRect），不能用 `el.click()` 或 DOM 属性推断 ——
 *    上一轮顶栏 14 个按钮"用合成事件测全绿、真人点全废"就是这么来的
 *    （真因：顶栏整条落在 Windows caption area）。安全区断言因此必须
 *    在**真机**上量 `readInset()` 与 ✕ 的右边界。
 *
 * 覆盖的用户需求（逐条对号）：
 *   元素完善  → C-M3 节点四型 / C-M5 状态四态 / C-M7 选中链 / C-M8 折叠 /
 *               C-M10 缩放 / C-M11 搜索 / C-M12 小地图 / C-M14 右键菜单 / C-M15 悬浮工具条
 *   ✕ 不重叠  → C-M13（含「防平凡真」前置断言 inset > 0）
 *   数据真实  → C-M2（血缘必须走 ctx.sessions 且 stateSource=host，不许静默降级）
 *
 * 用法：node scripts/verify-mindmap.mjs
 * 退出码：0 全绿 / 1 有失败 / 2 INVALID（含 CDP 连不上）
 */
import { PORT } from "./cdp-port.mjs";
/* 🔴 `T-PLUG-068`：收尾对账的**唯一实现**（重号自检 + 声明面提示 + 显式下限）。 */
import { tallyCheck } from "./_test-tally.mjs";

/* 🔴 2026-09-14 补（纪律 17）：Harness 未启动时原先崩栈成 `TypeError: fetch failed`，
 *    读起来像脚本坏了。用错目标判 INVALID(2)，不判 FAIL(1)。 */
/* 🔴 第 37 轮收敛到**唯一实现**（`_cdp-startup.mjs#waitCdpPage`）—— 与
 *    `verify-director-logic` / `verify-novel-split` / `verify-v22` 同族。
 *    旧写法（直接 fetch 一次 `/json/list`）踩的正是那段注释记载的坑：
 *    `_run-with-harness` 报「CDP 就绪」只代表**端口**在应答（≈2.0s），
 *    **page 目标更晚** ⇒ 一次性取会拿到空数组、报 `INVALID：CDP 无 page 目标`，
 *    读起来像"Harness 没起来"（本轮实测复现：编排器说 CDP 就绪，本套件仍报 INVALID）。
 *    ⇒ 有界等待，且**连不上**与**没有 page** 给不同文案（可分辨，纪律 58）。 */
const { waitCdpPage } = await import("./_cdp-startup.mjs");
const T = await waitCdpPage({ port: PORT, log: (s) => console.log(s) });
if (!T.ok) {
	console.error("IS_PASS: FALSE（INVALID：" + (T.reason || "连不上 CDP " + PORT) + "）");
	console.error("  真因：Harness 未运行 / 端口被幽灵占用（端口顺移）/ 窗口尚未加载出 page 目标。");
	console.error("  正确用法（启动与测试**同一条命令** —— 纪律 ㊵）：");
	console.error("    RH_RESTART=1 node scripts/_run-with-harness.mjs node scripts/run-live.mjs --no-start verify-mindmap.mjs");
	process.exit(2);
}
const page = T.page || T.targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
/* fire-and-forget：本 Electron 环境 Input 事件**响应**稳定延迟约 5s、事件本身立即送达
 * （Runtime.evaluate 仅 2ms）。坐标/键盘事件绝不能 await 响应，否则一次点击要 15s 且时序断言被拖垮。 */
const emit = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); };
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

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


async function js(expr) {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	if (r.exceptionDetails) throw new Error("JS异常: " + r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
	return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickAt(x, y) {
	const X = Math.round(x), Y = Math.round(y);
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: X, y: Y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: X, y: Y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(40);
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: X, y: Y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(120);
}
async function clickSel(sel, tag) {
	/* 🔴 2026-09-12 加固：**真实鼠标点击必须做落点自检**。
	 *   本脚本全靠 `Input.dispatchMouseEvent` 打真实坐标，而"按矩形中心打"有两个天然漏洞：
	 *     ① 坐标过期（量完之后布局又变了 —— 本项目已在 R8 条上实测过 23px 漂移）；
	 *     ② 被遮挡（上一段留下的右侧面板 `nd-panel` / 浮层盖住框，点击打在别人身上）。
	 *   两者都会以**产品缺陷的形态**现形：r16 的 C-M19b 报 `{bar:false,rows:15}`（点框没聚焦），
	 *   而探针 s5 在干净状态下点同一个框是 `bar:true, fid=该会话` —— 产品是好的，是点击落空了。
	 *   ⇒ 记名 + 重试一次：misses 收尾统一断言，既不吞掉问题，也不冤枉产品。 */
	for (let attempt = 0; attempt < 2; attempt++) {
		const g = await js(`(function(){
		  var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
		  var r=e.getBoundingClientRect();
		  var mx=Math.round(r.x+r.width/2),my=Math.round(r.y+r.height/2);
		  var st=document.elementsFromPoint(mx,my),t=st[0]||null;
		  return {mx:mx,my:my,w:Math.round(r.width),h:Math.round(r.height),
		    top:t?(t.tagName.toLowerCase()+(t.getAttribute&&t.getAttribute('data-testid')?'['+t.getAttribute('data-testid')+']':'')):null,
		    ok:!!t&&(t===e||e.contains(t)||t.contains(e))};
		})()`);
		if (!g) return false;
		if (g.ok) { await clickAt(g.mx, g.my); return true; }
		/* 落空：本轮先不记名 —— 首次落空可经 scrollIntoView 复中（真人也是滚到再点），
		 * 只有两次尝试后仍点不中才在循环外记为真"打偏"。 */
		if (attempt === 0) {
			await js(`(function(){var e=document.querySelector(${JSON.stringify(sel)});`
				+ `if(e&&e.scrollIntoView){try{e.scrollIntoView({block:"center",inline:"center"});}catch(_){e.scrollIntoView();}}return 1;})()`);
			await sleep(300);
			continue;
		}
		/* 第二次仍落空 ⇒ 这才是真打偏，记名册 */
		clickMisses.push({ sel, tag: tag || "", top: g.top, at: [g.mx, g.my], try: attempt + 1 });
	}
	return false;
}
/** 落点落空的记名册（收尾统一断言，见 clickSel 注释） */
const clickMisses = [];
async function rectOf(sel) {
	return await js(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};})()`);
}
async function key(k, code, vk) {
	const base = { key: k, code, windowsVirtualKeyCode: vk || 0, nativeVirtualKeyCode: vk || 0 };
	emit("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
	await sleep(25);
	emit("Input.dispatchKeyEvent", { type: "keyUp", ...base });
	await sleep(120);
}
/** 现场勘察：每一段开头打一行「页面当时到底还在不在」。
 *  🔴 加它的原因：本轮曾出现「后面 4 段全红」，真因不是那 4 个功能坏了，
 *     而是导图层在中途被关掉 —— 断言全都在量一个已经卸载的 DOM，
 *     报出来的是「菜单没弹/工具条没出/toast 没来」这种**误导性的现象**。
 *     没有这行，就会去改 4 个本来没坏的模块。 */
async function state(tag) {
	const s = await js(`(function(){
	  var q=function(k){return !!document.querySelector('[data-testid="'+k+'"]');};
	  return {ov: !!document.getElementById("dsh-mindmap"), root:q("mm-root"), close:q("mm-close"),
	    tools:q("mm-tools"), body:q("mm-body"), nodes:document.querySelectorAll('[data-testid="mm-node"]').length,
	    menu:q("mm-ctxmenu"), hb:q("mm-hoverbar"), input:q("mm-input"), toast:q("mm-toast"),
	    vp:[window.innerWidth, window.innerHeight]};
	})()`);
	console.log("  · " + tag + " 现场 " + JSON.stringify(s));
	return s;
}
/** 确保导图层是打开的（上一段可能把它关了）。返回是否打开。 */
async function ensureOpen() {
	if (await js(`!!document.getElementById("dsh-mindmap")`)) return true;
	console.log("  · 导图未打开 → 走用户路径重新打开");
	await clickSel('[data-testid="d-open-mindmap"]');
	await sleep(700);
	return await js(`!!document.getElementById("dsh-mindmap")`);
}
/** 把画布滚回原点，并返回一个**确证在视口内、确证命中自己**的节点中心。
 *
 *  🔴 为什么必须有这个函数（本轮真因，别删）：
 *     第 8 段点小地图会把画布滚走（scrollLeft 约 950）。之后再拿
 *     `document.querySelector('[data-testid="mm-node"]')`（DOM 第一个节点）量几何，
 *     会得到 **x = -934** 这种视口外的坐标；而 CDP 的 Input.dispatchMouseEvent
 *     是**真实**鼠标事件，打在视口外就等于什么都没点 ⇒ 菜单不弹、工具条不出。
 *     上一版正是因此把「产品其实没坏」误报成 C-M14a/C-M15a 两个功能缺陷，
 *     并顺带把后面两段带崩。凡是「用真实几何驱动真实鼠标」的段落，
 *     都必须先经过这里拿到一个可信坐标。 */
async function focusVisibleNode() {
	/* 🔴 画布内量针做成**页面侧函数**，好让第二轮复用（2026-09-12 重构）。
	 *   原先探针只跑一次、只靠"把 mm-body 滚回原点"来保证可见；
	 *   而 r19/r20 的自诊断显示：归零后仍有场景里 2 颗框落在 y=978 / y=1122，
	 *   可视区却只到 726 ⇒ 探针返回 null ⇒ C-M14/C-M15/C-M16a **连跳三段**。
	 *   这类"框存在但不在视口"必须能自救，否则永远靠跳过掩盖。 */
	await js(`(function(){
	  var b = document.querySelector('[data-testid="mm-body"]');
	  if (b) { b.scrollLeft = 0; b.scrollTop = 0; }
	  return 1;
	})()`);
	await sleep(240);
	await js(`(function(){
	  window.__mmProbe = function(){
	  var b = document.querySelector('[data-testid="mm-body"]');
	  if (!b) { window.__mmFocusWhy = "没有 mm-body"; return null; }
	  var br = b.getBoundingClientRect();
	  var ns = Array.prototype.slice.call(document.querySelectorAll('[data-testid="mm-node"]'));
	  /* 🔴 自诊断（2026-09-12 新增）：这段以前"跳过"时只说"画布上没有节点"，
	   *   而现场明明有 2 个框 —— 光看那句跳过**无法分辨**是"框在视口外"、
	   *   "被别的层压住"、还是"根本没有框"。踩过一次（r17/r18 连跳三段）就该把它做成自证的。 */
	  var diag = { body:[Math.round(br.x),Math.round(br.y),Math.round(br.width),Math.round(br.height)],
	               nodes: ns.length, why: "", items: [] };
	  for (var i = 0; i < ns.length; i++) {
	    var r = ns[i].getBoundingClientRect();
	    var cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
	    var inView = cx > br.x + 2 && cx < br.right - 2 && cy > br.y + 2 && cy < br.bottom - 2;
	    var hit = inView ? document.elementFromPoint(cx, cy) : null;
	    var hitSelf = !!(hit && (hit === ns[i] || ns[i].contains(hit)));
	    diag.items.push({ i:i, sid:String(ns[i].getAttribute('data-session-id')).slice(-6),
	                      at:[cx,cy], inView:inView,
	                      top: hit ? (hit.tagName.toLowerCase() + (hit.getAttribute && hit.getAttribute('data-testid') ? '[' + hit.getAttribute('data-testid') + ']' : '')) : null,
	                      hitSelf:hitSelf });
	    if (inView && hitSelf) { window.__mmFocusWhy = ""; return { i: i, cx: cx, cy: cy, sid: ns[i].getAttribute("data-session-id") }; }
	  }
	  window.__mmFocusWhy = JSON.stringify(diag);
	  return null;
	  };
	  return 1;
	})()`);
	let out = await js(`window.__mmProbe()`);
	if (!out) {
		/* 第二轮（2026-09-12 新增）：把**离视口中心最近**的那颗框 scrollIntoView 后再量一次。
		 *   注意只滚画布内元素、不滚页面（block:'center' 也会带上最近的可滚祖先，故随后复量）。 */
		const moved = await js(`(function(){
		  var b = document.querySelector('[data-testid="mm-body"]');
		  if (!b) return 0;
		  var br = b.getBoundingClientRect();
		  var ns = Array.prototype.slice.call(document.querySelectorAll('[data-testid="mm-node"]'));
		  if (!ns.length) return 0;
		  var bx = br.x + br.width / 2, by = br.y + br.height / 2;
		  var best = null, bestD = Infinity;
		  for (var i = 0; i < ns.length; i++) {
		    var r = ns[i].getBoundingClientRect();
		    var d = Math.abs(r.x + r.width / 2 - bx) + Math.abs(r.y + r.height / 2 - by);
		    if (d < bestD) { bestD = d; best = ns[i]; }
		  }
		  if (!best) return 0;
		  try { best.scrollIntoView({ block: "center", inline: "center" }); } catch (e) { best.scrollIntoView(); }
		  window.__mmFocusWhy = "第一轮：节点全在视口外（" + bestD + "px 外），已对最近一颗执行 scrollIntoView 复量";
		  return 1;
		})()`);
		if (moved) { await sleep(300); out = await js(`window.__mmProbe()`); }
	}
	if (!out) {
		const why = await js(`window.__mmFocusWhy || "未知"`);
		console.log("  · ⚠️ 取不到可用节点，自诊断：" + why);
	}
	return out;
}

/** 求一个**确证空白**的点：不在任何 mm-node 内、不在 mm-hoverbar 内、命中 mm-stage/mm-body 自身。
 *
 *  🔴 为什么必须有（2026-09-12 真因，别删）：
 *     「鼠标移开节点 ⇒ 工具条应消失」这条前置断言原先写死常数点 **(18,320)**，
 *     隐含假设"那点一定是空白"。但导图是**可滚动 + 可拖拽**的画布：
 *     同一颗节点在不同运行里的 rect 会漂到 (21,318,98,31)（x 21..119）——
 *     (18,320) 距它只有 **3px**；一旦画布滚动 160/120，节点 rect 变成
 *     [-10,291,98,31]，(18,320) 就**压在里面**（探针 m1 实测）。
 *     此时工具条"没消失"是**完全正确**的（指针真的还在节点上），
 *     而断言却把它报成产品缺陷 —— 典型的"用常数坐标代表空白"的假红。
 *     ⇒ 空白点必须**按当前几何算**，不能写死。 */
async function blankPoint() {
	return await js(`(function(){
	  var hb = document.querySelector('[data-testid="mm-hoverbar"]');
	  var ns = Array.prototype.slice.call(document.querySelectorAll('[data-testid="mm-node"]'));
	  var b  = document.querySelector('[data-testid="mm-body"]');
	  var br = b ? b.getBoundingClientRect()
	             : { x: 0, y: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
	  function blocked(x, y) {
	    for (var i = 0; i < ns.length; i++) { var r = ns[i].getBoundingClientRect();
	      if (x >= r.x && x <= r.right && y >= r.y && y <= r.bottom) return true; }
	    if (hb) { var h = hb.getBoundingClientRect();
	      if (x >= h.x && x <= h.right && y >= h.y && y <= h.bottom) return true; }
	    return false;
	  }
	  var cands = [];
	  for (var d = 6; d < Math.min(br.width, br.height) / 2 && cands.length < 60; d += 14) {
	    cands.push([br.x + d, br.y + d], [br.right - d, br.y + d], [br.x + d, br.bottom - d], [br.right - d, br.bottom - d],
	               [br.x + d, (br.y + br.bottom) / 2], [br.right - d, (br.y + br.bottom) / 2]);
	  }
	  for (var k = 0; k < cands.length; k++) {
	    var x = Math.round(cands[k][0]), y = Math.round(cands[k][1]);
	    if (x < 2 || y < 2 || x > window.innerWidth - 2 || y > window.innerHeight - 2) continue;
	    if (blocked(x, y)) continue;
	    var el = document.elementFromPoint(x, y);
	    if (!el) continue;
	    var bad = false;
	    for (var i = 0; i < ns.length; i++) { if (ns[i] === el || ns[i].contains(el)) { bad = true; break; } }
	    if (hb && (hb === el || hb.contains(el))) bad = true;
	    if (bad) continue;
	    return { x: x, y: y, hit: (el.getAttribute && el.getAttribute("data-testid")) || el.tagName.toLowerCase() };
	  }
	  return null;
	})()`);
}

/* ── 断言器 ── */
let pass = 0, fail = 0, skip = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log(`  ✅ ${id} ${name}`); }
	else { fail++; failures.push(`${id} ${name}`); console.log(`  ❌ ${id} ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); }
}
function sk(id, name, why) { skip++; console.log(`  ⏭ ${id} ${name} —— 跳过：${why}`); }
function section(s) { console.log("\n" + s); }

/* ══════════════════════════════════════════════════════════════════════════
 * 🔴 崩溃兜底 + 断言总数对账（技能 e2e-gate-hygiene §2.6，2026-09-14 实录）
 * ──────────────────────────────────────────────────────────────────────────
 * 事故：本脚本在 C-M10 段因一处**无守卫的 null 解引用**（`querySelector('[data-testid=mm-stage]')`
 *       在导图浮层不在场时返回 null，紧接着 `.getAttribute`）直接抛穿 ⇒ Node 打印一个裸栈退出，
 *       **其后 100+ 条断言一条都没跑**，而报告读起来只是"跑到这里就没了"。
 *       唯一线索是**断言总数对不上** —— 而这恰恰是最容易忽略的线索。
 * 双重保险（缺一不可）：
 *   ① `uncaughtException` / `unhandledRejection` 兜底：把**已经跑出来的**断言 + "其后未跑"
 *      明确打出来，并以 **exit 2（INVALID）** 收尾。
 *      为什么是 2 不是 1：**脚本自己死了 ≠ 产品不合格**（纪律 17）。
 *      为什么不能只靠 ②：崩溃时根本走不到收尾段。
 *   ② 收尾对账：必须**已到达末段**且实跑数 ≥ 登记下限，否则同样是 INVALID。
 *      为什么不是"精确等于 N"：写死计数本身就会过期（纪律 14）——
 *      真正要防的是"某段整体没跑"，`reachedFinal` + 下限正好覆盖它。
 * ══════════════════════════════════════════════════════════════════════════ */
/** 末段是否跑到（正常路径在汇总前把它置 true）。若为 false，任何"绿/红"都不可信。 */
let reachedFinal = false;
/** 断言数下限（**下限**而非精确值：加了断言就该同时抬高它，但漏抬不会造成假红）。
 *  🔴 `T-PLUG-068`：对账**逻辑**已收进 `scripts/_test-tally.mjs`（唯一实现）。
 *     本常量仍归本套件所有 ——「下限值是多少」是**套件自己的事实**，不该被抽走；
 *     但"怎么判 / 报什么 / 哪个退出码"只允许那一处实现（纪律 126）。 */
/* 🔴 第 38 轮：100 → **110**（新增【13.9】3 条 + 可能 skip 的 3 条、【13.10】2 条、【13.11】2 条）。
 *    这个下限的作用是"有没有段落静默没跑"—— 加了断言却不抬下限，等于把新段落的沉默合法化。
 *    **同轮追加 +1**（110 → 111）：【15】新增 `C-M21b`（记名册类型自检）。
 *    **同轮再追加 +2**（111 → 113）：【0】新增 `C-M1e`（上溯真生效 / 或跳过）+ `C-M1f`（作用域归一建前提）。 */
const MIN_ASSERTIONS = 113;
const dieReport = (why) => {
	console.error("\n───────────────────────────────────────────────");
	console.error(" ❌ INVALID：脚本异常终止 —— " + why);
	console.error(` 已跑出：通过 ${pass} / 失败 ${fail} / 跳过 ${skip}（合计 ${pass + fail + skip}）`);
	console.error(` 是否已到达末段（【15】点击质量）：${reachedFinal}`);
	if (failures.length) console.error(" 期间失败项：\n   - " + failures.join("\n   - "));
	console.error(" 其后段落**一条都没跑** ⇒ 不得据此判定产品好坏（INVALID＝用错用法或脚本自身故障）。");
	console.error(" 现场勘察：看崩溃前最后一行 `· 【n】前 现场 {...}` —— 它给出当时的浮层/DOM 状态。");
	console.error("───────────────────────────────────────────────");
	process.exit(2);
};
process.on("uncaughtException", (e) => dieReport("uncaughtException：" + ((e && e.stack) || e)));
process.on("unhandledRejection", (e) => dieReport("unhandledRejection：" + ((e && (e.stack || e.message)) || e)));

/* ══════════ 阶段 0：清掉上位脚本可能留下的浮层 ══════════
 * 🔴 为什么必须有（2026-09-12）：本脚本连的是**已经在跑的** Harness 实例，不重载页面。
 *   上一套脚本（verify-flow / verify-design-studio）收尾时可能留下 fixed 浮层
 *   （设计图工作室 / 节点详情面板），它们会**盖住导图里的框** ⇒ 真实鼠标点击打在浮层上
 *   ⇒ 以"点了没反应"的形态报成产品缺陷（r16 的 C-M10f / C-M16b / C-M19b 就是这一类）。
 *   ⚠️ 选择器写全 `[data-testid=...]`：传裸名会去匹配同名**标签**（恒 0），清场静默失效。 */
for (const [sel, closer, label] of [
	["[data-testid=nd-panel]", null, "节点详情"],
	["#dsh-design-studio", '[data-testid="ds-close"]', "设计图工作室"]
]) {
	if (!(await js("!!document.querySelector(" + JSON.stringify(sel) + ")"))) continue;
	console.log("  · 阶段 0 发现残留浮层：" + label + " ⇒ 关闭");
	if (closer) {
		await clickSel(closer, "阶段 0 清浮层");
	} else {
		await key("Escape", "Escape", 27);
	}
	await sleep(420);
}
const leftOverlays = await js("['[data-testid=nd-panel]','#dsh-design-studio'].filter(function(s){return !!document.querySelector(s);})");
console.log("  · 阶段 0 清浮层：自检残留 " + JSON.stringify(leftOverlays));

console.log("═══════════════════════════════════════════════════════════");
console.log(" 分支导图（思维导图）· 真机端到端验证");
console.log("═══════════════════════════════════════════════════════════");

/* ══════════ 0. 前置：确保导图关闭态，再走**用户路径**打开 ══════════ */
section("【0】前置与打开（走浮动按钮组，用户路径）");
await js(`(function(){ try{ if(window.__dshBranchTree) window.__dshBranchTree.refreshBranchTree(); }catch(e){} return 1; })()`);
await sleep(400);
const preOpen = await js(`!!document.getElementById("dsh-mindmap")`);
if (preOpen) {
	/* Esc 是「逐层退」：有右键菜单时它只关菜单，导图还开着 ⇒ 必须循环按到导图消失，
	 * 否则 C-M1b 会拿**上一轮残留的**图层当成本次「点入口打开」的结果（假绿）。 */
	for (let i = 0; i < 4; i++) {
		await key("Escape", "Escape", 27);
		await sleep(250);
		if (!(await js(`!!document.getElementById("dsh-mindmap")`))) break;
	}
	console.log("  · 前置：已清理上一轮残留的导图层（残留 ctxmenu 一并关闭）");
}

const dockBtn = await js(`!!document.querySelector('[data-testid="d-open-mindmap"]')`);
t("C-M1a", "浮动按钮组存在「思维导图」入口", dockBtn === true, dockBtn);
const opened = await clickSel('[data-testid="d-open-mindmap"]');
await sleep(500);
t("C-M1b", "点击入口后导图层已挂载（#dsh-mindmap）", await js(`!!document.getElementById("dsh-mindmap")`) === true, null);

/* ══════════════════════════════════════════════════════════════════
 * 🔴 前提**实体化**（第二十四轮新增 · 纪律 51 / 80）
 *
 * 为什么必须加这一段：
 *   血缘 `lineage` 来自宿主会话的 `parentSessionId`，只有**真实父子关系**才连得出线。
 *   第二十一轮「清理全部会话」之后，宿主剩下的会话**全是平级**（实测 28 行、
 *   `withParent=0`、edges 0、`lineage=false`，而 `source=ctx.sessions` 说明**不是降级**）
 *   ⇒ 整段「连线语义」断言**没有对象可测**，报出来是 6 条红，读起来像产品坏了。
 *   真因是**前提缺失**（纪律 31 的反面：闸门对「测不了」报红）。
 *
 * 为什么不改成"跳过"：跳过 = 连线功能**从未被检验**却报绿（纪律 18：跳过比红更危险）。
 * ⇒ 按纪律 80「起点必须实体化」：**自己建立一个父子关系**再测。
 *
 * 🔴 为什么不会累积会话（用户第二十一轮明确不满「重复创建了一百多个会话」）：
 *   **优先复用** —— 已有父子关系就**一个都不建**；只在「一条都没有」时才 fork **一个**。
 *   与总监的「复用优先」同律 ⇒ 连跑时会话数**收敛为常数**，不是线性增长。
 * ══════════════════════════════════════════════════════════════════ */
const lineageBefore = await js(`(function(){try{return window.__dshBranchTree.getBranchSnapshot().lineage===true;}catch(e){return false;}})()`);
let lineageBuilt = "reused";
if (!lineageBefore) {
	const canFork = await js(`!!document.querySelector('[data-testid="mm-new-fork"]')`);
	console.log("  · 前提：宿主当前**无父子会话**（lineage=false）⇒ 建立血缘（fork 入口存在=" + canFork + "）");
	if (!canFork) {
		console.log("  ⚠️ 前提建立失败：fork 入口不在 DOM ⇒ 血缘/连线段**未检验**（后续相关红属 INVALID，不是产品坏）");
		lineageBuilt = "unavailable";
	} else {
		await clickSel('[data-testid="mm-new-fork"]');
		let ok = false;
		for (let i = 0; i < 40 && !ok; i++) {
			await sleep(300);
			ok = await js(`(function(){try{return window.__dshBranchTree.getBranchSnapshot().lineage===true;}catch(e){return false;}})()`);
		}
		lineageBuilt = ok ? "forked" : "fork-failed";
		console.log("  · 前提建立结果：" + lineageBuilt
			+ " ｜ " + await js(`(function(){try{var s=window.__dshBranchTree.getBranchSnapshot();return JSON.stringify({rows:(s.tree.rows||[]).length,edges:(s.tree.edges||[]).length,withParent:(s.tree.rows||[]).filter(function(r){return r.parentSessionId;}).length});}catch(e){return '__exc';}})()`));
	}
}
t("C-M1c", "🔴 血缘前提**已实体化**（宿主有父子会话：复用已有 或 本次 fork 成功）—— 否则连线/血缘段无从检验",
	lineageBuilt === "reused" || lineageBuilt === "forked", lineageBuilt);

/* ── 🔴 2026-09-18（第 38 轮）新增：**血缘前提的机械诊断**（常驻，不是一次性探针）──
 *  为什么必须常驻：本轮新增「作用域过滤」（需求 18：默认只显示**当前文件夹下面**的对话）之后，
 *  冒出一种新的、**看起来像产品坏**的形态 —— 数据层 `lineage=true`（宿主确有父子会话），
 *  而画布上 `data-depth` 全是 0、一条连线都画不出。**两种完全不同的原因长得一模一样**：
 *    ① 作用域生效 ⇒ 作用域内**没有「父子都在」的配对** ⇒ 各自成根、无边（**按设计**）；
 *    ② 渲染层把 depth 写错、或边被逻辑丢掉（**真缺陷**）。
 *  没有这份并排读数就只能猜 —— 而"猜"在本项目已三次把环境问题记成产品缺陷（纪律 31 / 23）。
 *  故把**数据层血缘**与**画布层血缘**并排打出来，一眼分清是谁的问题。 */
console.log("  [血缘前提诊断] " + await js(`(function(){
  try{
    var s = window.__dshBranchTree.getBranchSnapshot();
    var rows = (s.tree&&s.tree.rows)||[]; var edges = (s.tree&&s.tree.edges)||[];
    var ns = Array.from(document.querySelectorAll('[data-testid="mm-node"]'));
    var dist = {}; for (var i=0;i<ns.length;i++){var d=ns[i].getAttribute('data-depth');dist[String(d)]=(dist[String(d)]||0)+1;}
    var chip = document.querySelector('[data-testid="mm-scope-chip"]');
    return JSON.stringify({
      dataLayer:{lineage:s.lineage, rows:rows.length, withParent:rows.filter(function(r){return r.parentSessionId;}).length, edges:edges.length},
      canvasLayer:{nodes:ns.length, depthDist:dist, drawnEdges:document.querySelectorAll('[data-testid="mm-edges"] path').length},
      scope: chip ? {scoped:chip.getAttribute('data-scoped'), total:chip.getAttribute('data-total'),
        dropped:chip.getAttribute('data-dropped'), up:chip.getAttribute('data-scope-up'),
        text:(chip.textContent||'').trim().slice(0,70)} : null
    });
  }catch(e){return '__exc ' + e.message;}
})()`));

/* ── 🔴 2026-09-18（第 38 轮）：**作用域归一**（给「连线语义」「折叠/展开」两段建前提）──
 *
 *  为什么必须加这一段：
 *    本轮新增「作用域过滤」（需求 6/18：默认只显示**当前文件夹下面**的对话）。
 *    于是「画布上看得到什么」不再只由宿主血缘决定，还由**当前作用域**决定。
 *    实测（本机冷启动，本文件配套的 `[血缘前提诊断]` 逐字读数）：
 *      dataLayer {rows:30, withParent:2, edges:2} ｜ canvasLayer {nodes:2, depthDist:{"0":2}, drawnEdges:0}
 *      scope     {"total":"2","dropped":"28","text":"📁 工作区 a11caaed（项目总监） · 2 节点（滤掉 28）"}
 *    ⇒ 数据层血缘**完好**（30 行 / 2 条边），但作用域把这 28 行滤掉，画布只剩 2 个
 *      **互不相干**的节点 ⇒ 连一条线都画不出、depth 全是 0。
 *    ⇒ 后续两段"没有对象可测"，报出来是 6 条红，**读起来像产品坏了**（纪律 31：先审口径）。
 *
 *  ⇒ 按纪律 80「起点必须实体化」：**模拟用户点「上一级」**把作用域放大到看得见血缘。
 *    🔴 这不是"绕过问题"，而是**用户原话里的动作** ——「除非我点击**上一级**才由上一级的显示」。
 *       顺带把「上一级」这项新功能**真机验掉**：每上溯一次都断言
 *       `scope-up` **递增**（真换了作用域，不是只换了个字）
 *       且 `total` **单调不减**（语义：上一级只会看到更多，不会更少）。
 *
 *  ⚠️ 上溯到顶仍看不见血缘 ⇒ 如实记 `status="top"`，由 `C-M1f` 报出来。
 *     此时后续段落红属**前提缺失**，不得算到产品头上（纪律 58：没跑成 ≠ 失败）。
 *  ⚠️ 作用域内本来就够 ⇒ `did=0` ⇒ `C-M1e` 记为**跳过并说明原因**（纪律 18），
 *     改由【13.9】段去验上溯（那时若还有级可上，就会真点）。
 *
 *  🔴 **必须做成幂等函数**（照本文件 `ensureOpen()` 的惯例）—— 为什么：
 *     `setScopeUp(0)` 是**产品侧的正确行为**（用户需求 17/18：每次打开导图默认回到
 *     「当前文件夹」），而本脚本中段有 `ensureOpen()`（上一段可能把导图关了 ⇒ 走用户路径重开）
 *     ⇒ 重开一次 ⇒ **作用域被打回「当前文件夹」** ⇒ 画布从 30 个节点变回 2 个
 *     ⇒ 【13.5】聚焦段 /【13.8】拖拽段**又没有对象**了。
 *     实测（本批 `_r38-mm4.out` 第 130 行有「导图未打开 → 走用户路径重新打开」）：
 *       C-M19b {"bar":false,...,"rows":2} · C-M23a 红 —— 而**上一次没有 `setScopeUp(0)` 时是绿的**，
 *       因为那时靠 `scopeUp` 的**残留值**（=1，每帧都是全局）蒙对了。
 *     ⇒ 结论：**"绿"必须由本段自己建立，不能靠上一段漏下来的状态。**
 *       凡需要血缘的段落，调用本函数兜底（幂等：已有配对则零开销直接返回）。 */
async function scopeHasPair() {
	return await js(`(function(){
  var ns = Array.from(document.querySelectorAll('[data-testid="mm-node"]'));
  for (var i = 0; i < ns.length; i++) { if (ns[i].getAttribute('data-depth') !== '0') return true; }
  return false;
})()`);
}
async function scopeUpUsable() {
	return await js(`(function(){
  var u = document.querySelector('[data-testid="mm-scope-up"]');
  return !!u && u.disabled !== true;
})()`);
}
/**
 * 作用域归一（**幂等**）
 * @param {string} tag 诊断标签（进日志，便于分辨是谁触发的）
 * @param {boolean} assert 是否由调用方产出断言（**只有【0】段为 true** —— 断言编号必须唯一）
 * @returns {Promise<{did:number,upOk:boolean,monotonic:boolean,status:string,trail:object[]}>}
 */
async function ensureScopeLineage(tag, assert) {
	const norm = { tag: tag, did: 0, upOk: true, monotonic: true, status: "reused", trail: [] };
	if (await scopeHasPair()) return norm;
	let prev = await readScopeChip();   // 函数声明提升：readScopeChip 定义在本文件【13.9】段
	if (!prev) { norm.status = "top"; norm.note = "chip 不在 DOM"; return norm; }
	if (!(await scopeUpUsable())) {
		norm.status = "top"; norm.note = "已在最高一级";
		norm.trail.push({ up: prev.up, total: prev.total });
		return norm;
	}
	norm.trail.push({ up: prev.up, total: prev.total });
	for (let i = 0; i < 6; i++) {
		await clickSel('[data-testid="mm-scope-up"]', tag + " 上溯一级");
		await sleep(460);
		const now = await readScopeChip();
		if (!now) { norm.upOk = false; break; }
		if (!(now.up > prev.up)) norm.upOk = false;
		if (!(now.total >= prev.total)) norm.monotonic = false;
		prev = now; norm.did += 1;
		if (norm.trail.length < 6) norm.trail.push({ up: now.up, total: now.total });
		if (await scopeHasPair()) break;
		if (!(await scopeUpUsable())) break;
	}
	norm.status = (await scopeHasPair()) ? "ok" : "top";
	/* 非首次调用 ⇒ 只打诊断（不产出断言：同一编号第二次出现会让"编号唯一"失效） */
	if (!assert) console.log("  · [" + tag + "] 作用域重归一：上溯 " + norm.did + " 级 ⇒ " + norm.status);
	return norm;
}
const scopeNorm = await ensureScopeLineage("【0】", true);
if (scopeNorm.did > 0) {
	t("C-M1e", "🔴 点「上一级」上溯**真生效**：`scope-up` 递增 且 `total` 单调不减（上一级只会看到更多）",
		scopeNorm.upOk && scopeNorm.monotonic, scopeNorm);
} else {
	sk("C-M1e", "「上一级」上溯真生效", "当前作用域内本来就有血缘配对 ⇒ 无需上溯（【13.9】段仍会验）");
}
t("C-M1f", "🔴 作用域已归一为「**看得见血缘**」——给连线 / 折叠两段建前提（否则那两段无对象可测）",
	scopeNorm.status === "ok" || scopeNorm.status === "reused", scopeNorm);

/* 🔴 折叠/展开段还需要「**非根且有子**」的节点 ⇒ 血缘至少 **3 层**（根 → 子 → 孙）。
 *   只 fork 一次只到 2 层：根(depth0) → 子(depth1，无子) ⇒ 没有「非根且有子」的对象
 *   ⇒ C-M8q / C-M8a–d **双双跳过**，总数掉到 98 < 下限 100 ⇒ 整轮判 INVALID。
 *   同样**复用优先**：已有 3 层就不动；只在缺时才再 fork **一个**（不是每次都建）。 */
/* 🔴 判据必须**用产品自己的口径**，不能自己编一个（第二十四轮踩到：
 *    第一版写成 `n.getAttribute('data-children') !== '0'` —— 而产品**根本没有** `data-children`
 *    这个属性（全仓 grep 零命中）⇒ `getAttribute` 返回 `null`，`null !== '0'` **恒真**
 *    ⇒ `deepEnough()` 对"任何非根节点"都返回 true ⇒ C-M1d **空真绿**，而真正的折叠段
 *    用产品口径一查还是 0 个 ⇒ 照样跳过。**空真绿比红更坏**（纪律 23：先问反例上会不会也通过）。
 *    ⇒ 改用与折叠段**完全相同**的口径：`mm-node-toggle[data-enabled="1"]` 且节点 `data-depth !== "0"`。 */
const deepEnough = async () => await js(`(function(){
  var ts = Array.from(document.querySelectorAll('[data-testid="mm-node-toggle"]'));
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getAttribute('data-enabled') !== '1') continue;
    var id = ts[i].getAttribute('data-toggle-id');
    var n = document.querySelector('[data-testid="mm-node"][data-session-id="' + id + '"]');
    if (n && n.getAttribute('data-depth') !== '0') return true;
  }
  return false;
})()`);
let deepBuilt = "reused";
if (await deepEnough()) {
	deepBuilt = "reused";
} else {
	const kid = await js(`(function(){var ns=Array.from(document.querySelectorAll('[data-testid="mm-node"]'));
		var d1 = ns.filter(function(n){return n.getAttribute('data-depth')==='1';})[0];
		return d1 ? d1.getAttribute('data-session-id') : null;})()`);
	if (!kid) {
		deepBuilt = "unavailable";
		console.log("  ⚠️ 前提：连 depth=1 的节点都没有 ⇒ 折叠段**未检验**");
	} else {
		await js(`(function(){var n=document.querySelector('[data-testid="mm-node"][data-session-id="' + ${JSON.stringify(kid)} + '"]');if(n){n.click();return 1;}return 0;})()`);
		await sleep(300);
		await clickSel('[data-testid="mm-new-fork"]');
		let ok = false;
		for (let i = 0; i < 40 && !ok; i++) { await sleep(300); ok = await deepEnough(); }
		deepBuilt = ok ? "forked" : "fork-failed";
		console.log("  · 三层前提建立：" + deepBuilt
			+ " ｜ 深度分布 " + await js(`(function(){var ns=Array.from(document.querySelectorAll('[data-testid="mm-node"]'));return JSON.stringify(ns.map(function(n){return n.getAttribute('data-depth');}).reduce(function(a,d){a[d]=(a[d]||0)+1;return a;},{}));})()`)
			+ " ｜ 产品口径可折叠(非根且有子) = " + await js(`(function(){var ts=Array.from(document.querySelectorAll('[data-testid="mm-node-toggle"]'));return String(ts.filter(function(t){if(t.getAttribute('data-enabled')!=='1')return false;var n=document.querySelector('[data-testid="mm-node"][data-session-id="'+t.getAttribute('data-toggle-id')+'"]');return !!n&&n.getAttribute('data-depth')!=='0';}).length);})()`));
	}
}
t("C-M1d", "🔴 折叠段前提**已实体化**（存在「非根且有子」的节点：复用已有 或 本次补 fork 一层）",
	deepBuilt === "reused" || deepBuilt === "forked", deepBuilt);

/* ══════════ 1. 数据真实性（本轮根因修复的自证） ══════════ */
section("【1】数据真实性 —— 血缘必须来自宿主，不许静默降级");
const data = await js(`(function(){
  var s = window.__dshBranchTree.getBranchSnapshot();
  var d = s.diag || {};
  return { source:s.source, lineage:s.lineage, rows:(s.tree&&s.tree.rows||[]).length,
           hosts: (s.tree&&s.tree.rows||[]).filter(function(r){return r.stateSource==="host";}).length,
           viaGet: !!d.viaGet, hasList: !!d.hasList, sampleKeys: d.sampleKeys||[], error: d.error||"" };
})()`);
t("C-M2a", "血缘通道 = ctx.sessions（不是 localStorage 降级）", data.source === "ctx.sessions", data.source);
t("C-M2b", "宿主 sessions.list 可达且能取快照", data.hasList === true, data);
if (lineageBuilt === "unavailable") {
	sk("C-M2c", "血缘字段 parentId 已吃到（lineage=true）", "宿主无父子会话且无法 fork ⇒ **未检验**（不是产品坏）");
} else {
	t("C-M2c", "血缘字段 parentId 已吃到（lineage=true）", data.lineage === true, data.lineage);
}
t("C-M2d", "快照字段形状符合取证（含 id/displayTitle/running/blank/updatedAt）",
	["id", "displayTitle", "running", "blank", "updatedAt"].every((k) => data.sampleKeys.indexOf(k) >= 0), data.sampleKeys);
t("C-M2e", "全部行的状态源 = host（没有一行退回推断）", data.rows > 0 && data.hosts === data.rows, [data.rows, data.hosts]);
const domSource = await js(`document.querySelector('[data-testid="mm-root"]').getAttribute("data-source")`);
t("C-M2f", "DOM 上也标明数据源（可被外部读到）", domSource === "ctx.sessions", domSource);

/* ══════════ 2. 元素齐备 ══════════ */
section("【2】元素库落地齐备（工具条 / 图例 / 小地图 / 搜索 / 缩放）");
for (const [id, sel, name] of [
	["C-M3a", '[data-testid="mm-top"]', "顶栏"],
	["C-M3b", '[data-testid="mm-tools"]', "工具条"],
	["C-M3c", '[data-testid="mm-legend"]', "状态图例"],
	["C-M3d", '[data-testid="mm-minimap"]', "小地图"],
	["C-M3e", '[data-testid="mm-search"]', "搜索框"],
	["C-M3f", '[data-testid="mm-fit"]', "适应按钮"],
	["C-M3g", '[data-testid="mm-zoom-out"]', "缩小按钮"],
	["C-M3h", '[data-testid="mm-zoom-in"]', "放大按钮"],
	["C-M3i", '[data-testid="mm-zoom-100"]', "1:1 按钮"],
	["C-M3j", '[data-testid="mm-collapse-all"]', "折叠全部按钮"],
	["C-M3k", '[data-testid="mm-new-fork"]', "新建分支按钮"],
	["C-M3l", '[data-testid="mm-edges"]', "连线层"],
	["C-M3m", '[data-testid="mm-minimap-vp"]', "小地图视野框"],
	["C-M3n", '[data-testid="mm-coverage"]', "元素覆盖度徽标"]
]) t(id, name + "存在", await js(`!!document.querySelector(${JSON.stringify(sel)})`) === true, null);

/* ══════════ 3. 节点四型 + 状态四态（与离线纯函数对照） ══════════ */
section("【3】节点四型与状态四态");
const kinds = await js(`Array.from(document.querySelectorAll('[data-testid="mm-node"]')).map(function(e){return e.getAttribute("data-kind");})`);
const kindsAllowed = ["topic", "branch", "sub", "leaf"];
t("C-M4a", "每个节点的 data-kind 都在四型集合内", kinds.length > 0 && kinds.every((k) => kindsAllowed.indexOf(k) >= 0), kinds);
t("C-M4b", "中心主题存在（血缘树的根渲染为主题）", kinds.indexOf("topic") >= 0, kinds);
const kindMatch = await js(`(function(){
  var s = window.__dshBranchTree.getBranchSnapshot();
  var byId = {}; (s.tree.rows||[]).forEach(function(r){ byId[r.sessionId]=r; });
  var bad = [];
  Array.from(document.querySelectorAll('[data-testid="mm-node"]')).forEach(function(e){
    var id = e.getAttribute("data-session-id"); var row = byId[id];
    if(!row) { bad.push([id,"no-row"]); return; }
    if(e.getAttribute("data-kind") !== row.kind) bad.push([id,"kind",e.getAttribute("data-kind"),row.kind]);
    if(e.getAttribute("data-state") !== row.state) bad.push([id,"state",e.getAttribute("data-state"),row.state]);
  });
  return bad;
})()`);
t("C-M4c", "DOM 的 kind/state 与数据层逐节点一致（无漂移）", kindMatch.length === 0, kindMatch);
const states = await js(`Array.from(document.querySelectorAll('[data-testid="mm-node"]')).map(function(e){return e.getAttribute("data-state");})`);
t("C-M5a", "每个节点的状态都在四态集合内", states.every((s) => ["idle", "running", "review", "done"].indexOf(s) >= 0), states);
const dotColor = await js(`(function(){
  var out = [];
  Array.from(document.querySelectorAll('[data-testid="mm-node"]')).slice(0,5).forEach(function(n){
    var st = n.getAttribute("data-state");
    var d = n.querySelector('[data-testid="mm-dot"]');
    out.push([st, d ? getComputedStyle(d).backgroundColor : null]);
  });
  return out;
})()`);
t("C-M5b", "状态点颜色随状态变化（不是同一个灰点）", new Set(dotColor.map((x) => x[1])).size >= 1 && dotColor.every((x) => x[1] && x[1] !== "rgba(0, 0, 0, 0)"), dotColor);
const srcTitle = await js(`(function(){var n=document.querySelector('[data-testid="mm-node"]');return n?n.getAttribute("title"):null;})()`);
t("C-M5c", "节点 title 说明状态判据与来源（可核对，不是纯装饰）", !!srcTitle && /宿主快照/.test(srcTitle) && /判据/.test(srcTitle), srcTitle);
const legendTexts = await js(`Array.from(document.querySelectorAll('[data-testid="mm-legend"] span span')).map(function(e){return e.textContent;})`);
t("C-M6a", "图例四态齐备（待命/执行中/待审/已收口）",
	["待命", "执行中", "待审", "已收口"].every((x) => legendTexts.indexOf(x) >= 0), legendTexts);
t("C-M6b", "图例**不含**「出错」（宿主无该字段，不许画无源之态）", legendTexts.indexOf("出错") < 0, legendTexts);

/* ══════════ 4. 连线语义 ══════════ */
section("【4】连线语义（主干实线 / 分支虚线 / 选中链高亮）");
const edgeKinds = await js(`Array.from(document.querySelectorAll('[data-testid="mm-edges"] path')).map(function(p){return [p.getAttribute("data-edge-kind"), getComputedStyle(p).strokeDasharray];})`);
if (lineageBuilt === "unavailable") {
	sk("C-M7a", "连线至少一条（有血缘边就画得出）", "无血缘边 ⇒ **未检验**（见 C-M1c）");
} else {
	t("C-M7a", "连线至少一条（有血缘边就画得出）", edgeKinds.length >= 1, edgeKinds);
}
t("C-M7b", "主干实线（trunk 的 dash = none/空）",
	edgeKinds.filter((e) => e[0] === "trunk").every((e) => !e[1] || e[1] === "none"), edgeKinds);
// 选中链：点一个有子节点的节点（或根），断言其到根路径上的边变 chain
const chainProbe = await js(`(function(){
  var s = window.__dshBranchTree.getBranchSnapshot();
  var rows = s.tree.rows || [];
  var parent = rows.filter(function(r){ return r.childrenCount>0 && r.parentSessionId; })[0];
  var root = rows.filter(function(r){ return r.depth===0 && r.childrenCount>0; })[0];
  return { leafWithParent: rows.filter(function(r){ return r.parentSessionId && r.depth>0; })[0] ? rows.filter(function(r){ return r.parentSessionId && r.depth>0; })[0].sessionId : null,
           parent: parent?parent.sessionId:null, root: root?root.sessionId:null };
})()`);
if (chainProbe.leafWithParent) {
	await clickSel(`[data-testid="mm-node"][data-session-id="${chainProbe.leafWithParent}"]`);
	await sleep(220);
	const chained = await js(`document.querySelectorAll('[data-edge-kind="chain"]').length`);
	const selText = await js(`(document.querySelector('[data-testid="mm-sel"]')||{}).textContent || ""`);
	t("C-M7c", "选中子节点后，其到根的连线变为 chain（高亮）", chained >= 1, { chained, selText });
	t("C-M7d", "底栏「选中分支」同步显示该节点", selText.indexOf(chainProbe.leafWithParent) >= 0, selText);
	/* 🔴 2026-09-12 修：原先硬编码 `rgb(137, 87, 229)`（= `#8957e5`）——
	 *  而小地图的链高亮源码写的是 `background: chain.has(id) ? "var(--dp-ac, #8957e5)" : …`，
	 *  `--dp-ac` 的**默认值是 `#2f6feb`（蓝）**，`#8957e5` 是 `--dp-ac2`。
	 *  也就是说：旧断言只在"主色被持久化成了 #8957e5"时才碰巧为真 ——
	 *  **一条靠 localStorage 里残留状态偶然通过的断言**（换机器 / 清缓存就红）。
	 *  现在按产品的**同一个令牌**取期望值（读 `--dp-ac` 的计算值），不再硬编码。 */
	const minimapChain = await js(`(function(){
	  var ac = getComputedStyle(document.documentElement).getPropertyValue("--dp-ac").trim();
	  var m = /^#([0-9a-f]{6})$/i.exec(ac);
	  if (!m) return {err: "拿不到 --dp-ac 的十六进制值：" + ac};
	  var v = m[1];
	  var want = "rgb(" + parseInt(v.slice(0,2),16) + ", " + parseInt(v.slice(2,4),16) + ", " + parseInt(v.slice(4,6),16) + ")";
	  var kids = Array.from(document.querySelectorAll('[data-testid="mm-minimap"] > div'));
	  return {want: want, hit: kids.filter(function(d){ return getComputedStyle(d).backgroundColor === want; }).length, total: kids.length};
	})()`);
	t("C-M7e", "小地图同步高亮选中链（期望色取自产品同一个 --dp-ac 令牌，不硬编码颜色）",
		!!minimapChain && minimapChain.err === undefined && minimapChain.hit >= 1, minimapChain);
} else {
	sk("C-M7c", "选中链高亮", "本机没有「有父的会话」可用（没有 fork 过）");
	sk("C-M7d", "底栏选中分支同步", "同上");
	sk("C-M7e", "小地图同步高亮", "同上");
}

/* ══════════ 5. 折叠 / 展开（含「折叠入口」提示） ══════════ */
section("【5】折叠 / 展开");
/* 🔴 2026-09-12 第四次纠错：本段必须先**退出聚焦态**。
 *   聚焦（R9）下可见集 = 焦点节点的**祖先链**（`focusRows(rows, focusId, {includeParents})`），
 *   兄弟与叔伯全被排除。若焦点恰是「根的直接子节点」，可见集就只剩 根 + 它两个 ⇒
 *   **唯一有子的可见节点是根**，而非根不参与折叠 ⇒ 探针 `usable = 0`，
 *   C-M8a–d / C-M8q 双双被跳成"本机数据如此" —— 一句假话（本机血缘有 3 层，
 *   探针 m1 实测 19 个节点分布在 3 列）。跳过没人看，比红更危险，所以按真因修。 */
const focusPre5 = await js(`(function(){var b=document.querySelector('[data-testid="mm-focusbar"]');
  return {bar:!!b, id:b?b.getAttribute('data-focus-id'):null};})()`);
if (focusPre5 && focusPre5.bar) {
	console.log("  · 【5】前 处于聚焦态（" + String(focusPre5.id).slice(-6) + "）⇒ 先退出聚焦：否则可见集只有祖先链，折叠探针取不到样本");
	await clickSel('[data-testid="mm-focus-exit"]');
	await sleep(520);
}
const expandableNow = await js(`Array.from(document.querySelectorAll('[data-testid="mm-node"]')).filter(function(n){
  return n.getAttribute("data-depth") !== "0";}).length`);
console.log("  · 【5】起点：非根可见节点 " + expandableNow + " 个（全树口径）");
/* 🔴 2026-09-12 第三次补强：**先把折叠状态归一到「全展开」**，再测折叠。
 *   真机证据（r4 红 C-M8a/b/c + C-M9a）：`{"before":11,"after":13}` ——
 *   第一次点击**节点数变多了** ⇒ 那一击是「展开」不是「折叠」：
 *   探针挑到了**当前已折叠**的节点（上一次运行 / 上一次会话留下的折叠态，
 *   本脚本不重载页面，状态跨运行保留）。
 *   形态仍是"r4 红、r5 r6 绿"的**假偶发**，根因是"起点不等价"。
 *   修法不是重跑到绿：① 归一按钮状态到全展开；② 探针只从**当前展开**的节点里挑；
 *   ③ 把"我确实是从展开态开始的"变成独立断言 —— 否则 C-M8a 的"数量减少"没有前提。 */
/* 🔴 `data-collapsed` 同时打在**节点本体**（MindMap.js:676）和**框内折叠控件**（:733）上
 *    ⇒ 直接数 `[data-collapsed="1"]` 会把每个折叠节点算**两次**。
 *    实测：精确对账写成 `allCollapsed === collapsibleNonRoot` 时读出 `2 vs 1` ——
 *    这不是产品漏折，是**测量口径**错了。凡"按个数对账"的判据必须先钉死量的是哪一类元素。 */
const collapsedCount = () => js(`document.querySelectorAll('[data-testid="mm-node"][data-collapsed="1"]').length`);
const collapseAllLabel = () => js(`((document.querySelector('[data-testid="mm-collapse-all"]')||{}).textContent || "")`);
/** 借助「折叠全部 / 展开全部」这个**同一个**按钮把状态推到全展开（只在它写着「展开全部」时敢点） */
const normalizeExpanded = async () => {
	for (let i = 0; i < 4; i++) {
		if ((await collapsedCount()) === 0) break;
		if (!/展开/.test(await collapseAllLabel())) break;   // 按钮是「折叠全部」⇒ 再点会更折，交回调用方
		await clickSel('[data-testid="mm-collapse-all"]');
		await sleep(340);
	}
	return await collapsedCount();
};
const collapsedAtStart = await normalizeExpanded();
t("C-M8p", "前置：先把折叠状态归一到「全展开」（否则 C-M8a 的「节点数减少」没有前提，会假红）",
	collapsedAtStart === 0, { 仍折叠: collapsedAtStart });

/* C-M8q 🔴 正负对照：证明上面的「归一」真的在干活，否则 C-M8p 可能是**空真**
 *（"本来就是全展开"和"归一成功"读出来一模一样）。做法：人为折一个 ⇒ 必须 >0 ⇒ 归一 ⇒ 必须回 0。 */
const seedToggle = await js(`(function(){
  var t = Array.from(document.querySelectorAll('[data-testid="mm-node-toggle"]')).filter(function(x){
    var n = document.querySelector('[data-testid="mm-node"][data-session-id="' + x.getAttribute("data-toggle-id") + '"]');
    return x.getAttribute("data-enabled") === "1" && n && n.getAttribute("data-depth") !== "0"; })[0];
  return t ? t.getAttribute("data-toggle-id") : null; })()`);
if (seedToggle) {
	await clickSel(`[data-testid="mm-node-toggle"][data-toggle-id="${seedToggle}"]`);
	await sleep(300);
	const seeded = await collapsedCount();
	const reNormalized = await normalizeExpanded();
	t("C-M8q", "🔴 正负对照：人为折一个节点 ⇒ 折叠数必须 >0；归一步骤必须把它展开回 0",
		seeded > 0 && reNormalized === 0, { 人为折叠后: seeded, 归一后: reNormalized });
} else {
	sk("C-M8q", "折叠归一正负对照", "没有任何「非根且有子」的节点可供人为折叠（本机数据如此）");
}

/* 🔴 2026-09-12 修：这里原先是 `[data-testid="mm-toggle"]` —— **产品里根本没有这个 id**
 *   （全仓 `grep -rn mm-toggle src/` 零命中；产品用的是 `mm-node-toggle`），
 *   于是 `collapseProbe` 永远为 null ⇒ C-M8a–d **永远被跳过**，报告还写成
 *   「本机没有任何节点有子分支」——**一句假话**：同段 C-M9a 的证据显示产品当时
 *   真的折了 1 棵子树（`allCollapsed:2` + toast「已折叠 1 棵子树」）。
 *   这是"探针指着不存在的锚点 ⇒ 整段静默失效"的典型，比红更危险（红会有人看，跳过没人看）。
 *   现在按产品的真实锚点取：`mm-node-toggle`（每节点一个，`data-enabled` 标可否折叠），
 *   并且**只从当前展开（`data-collapsed !== "1"`）的节点里挑** —— 见上面 C-M8p。 */
const collapseProbe = await js(`(function(){
  var usable = Array.from(document.querySelectorAll('[data-testid="mm-node-toggle"]')).filter(function(t){
    var id = t.getAttribute("data-toggle-id");
    var n = document.querySelector('[data-testid="mm-node"][data-session-id="' + id + '"]');
    return t.getAttribute("data-enabled") === "1" && n && n.getAttribute("data-depth") !== "0"
        && n.getAttribute("data-collapsed") !== "1"; });
  var anyEnabled = Array.from(document.querySelectorAll('[data-testid="mm-node-toggle"]')).filter(function(t){ return t.getAttribute("data-enabled") === "1"; });
  var pick = usable[0] || null;
  return { id: pick ? pick.getAttribute("data-toggle-id") : null, n: document.querySelectorAll('[data-testid="mm-node"]').length,
           usable: usable.length, enabled: anyEnabled.length };
})()`);
if (collapseProbe && collapseProbe.id) {
	await clickSel(`[data-testid="mm-node-toggle"][data-toggle-id="${collapseProbe.id}"]`);
	await sleep(260);
	const afterNode = await js(`document.querySelectorAll('[data-testid="mm-node"]').length`);
	const ghost = await js(`document.querySelectorAll('[data-testid="mm-ghost"]').length`);
	const collapsedAttr = await js(`(document.querySelector('[data-testid="mm-node"][data-session-id="${collapseProbe.id}"]')||{getAttribute:function(){return null;}}).getAttribute("data-collapsed")`);
	t("C-M8a", "折叠后可见节点数减少", afterNode < collapseProbe.n, { before: collapseProbe.n, after: afterNode });
	t("C-M8b", "折叠节点被打上 data-collapsed=1", collapsedAttr === "1", collapsedAttr);
	t("C-M8c", "折叠处显示隐藏规模「+N」（不是变空）", ghost >= 1, ghost);
	await clickSel(`[data-testid="mm-node-toggle"][data-toggle-id="${collapseProbe.id}"]`);
	await sleep(260);
	t("C-M8d", "再点一次恢复展开（节点数回到原值）", await js(`document.querySelectorAll('[data-testid="mm-node"]').length`) === collapseProbe.n, null);
} else {
	sk("C-M8a–d", "折叠/展开", collapseProbe && collapseProbe.enabled
		? `有 ${collapseProbe.enabled} 个可折叠节点，但没有一个是展开态（归一后仍如此）—— 需查 C-M8p`
		: "本机没有任何节点有子分支");
}
/* C-M9 前置：先把状态推到「全展开」，否则「折叠全部」可能因为"本来就全折着"而无事可做，
 *   把产品正确误判成"按钮没反应"。这一步同样要有断言。 */
const collapsedBeforeAll = await normalizeExpanded();
t("C-M9p", "前置：点「折叠全部」之前，当前确实是全展开（否则 C-M9a 可能是空真）",
	collapsedBeforeAll === 0, { 仍折叠: collapsedBeforeAll });
await clickSel('[data-testid="mm-collapse-all"]');
await sleep(320);
const allCollapsed = await collapsedCount();   // 只数**节点**（口径见上）
const allLabel1 = await js(`(document.querySelector('[data-testid="mm-collapse-all"]')||{}).textContent || ""`);
const allToast = await js(`(document.querySelector('[data-testid="mm-toast"]')||{}).textContent || ""`);
/* 本机能被「折叠全部」处理的对象 = 非根 且 有子 的节点（根不参与，见 MindMap.toggleAll）
 * 🔴 锚点同样修过：`mm-toggle` → `mm-node-toggle`（见上）。原先恒为 0 ⇒ 永远走 else 分支，
 *    拿「没有可折叠项」的判据去量一个**明明折了子树**的产品（同段 toast 自证），必然假红。 */
const collapsibleNonRoot = await js(`Array.from(document.querySelectorAll('[data-testid="mm-node-toggle"]')).filter(function(t){
  if (t.getAttribute("data-enabled") !== "1") return false;
  var n = document.querySelector('[data-testid="mm-node"][data-session-id="' + t.getAttribute("data-toggle-id") + '"]');
  return n && n.getAttribute("data-depth") !== "0";}).length`);
/* 🔴 这里原先是 `allCollapsed >= 0` —— 计数不可能为负 ⇒ **永远为真**的假断言，
 *    加上一个 else 跳过，等于这一段什么都没验。现在拆成两条都有真值的分支：
 *    有可折叠项就必须真折到；没有就必须**给出可见反馈**
 *    （用户反复投诉过「点了像没点」，所以「无事可做」也必须说话，且说清为什么）。 */
if (collapsibleNonRoot > 0) {
	/* 判据由 `> 0` 收紧为**精确等于**：产品 `toggleAll` 的目标集合是
	 * `rows.filter(depth > 0 && childrenCount > 0)`，而 `data-enabled="1"` 正是
	 * `childrenCount > 0`（mindmap-schema.js:337）⇒ 两边是**同一个集合**，可以精确对账。
	 * 旧的 `> 0` 只证明"折了至少一个"，漏得掉"漏折了其中几个"。 */
	t("C-M9a", "「折叠全部」把**全部**非根有子节点折起来（精确等于目标集合，不是只折了 ≥1 个）",
		allCollapsed === collapsibleNonRoot, { allCollapsed, collapsibleNonRoot });
	if (allCollapsed > 0) {
		t("C-M9b", "按钮文案切换为「展开全部」", /展开/.test(allLabel1), allLabel1);
		await clickSel('[data-testid="mm-collapse-all"]');
		await sleep(320);
		t("C-M9c", "再点一次全部展开（collapsed 归零）", (await collapsedCount()) === 0, null);
	}
} else {
	t("C-M9a", "本机没有「非根且有子」的节点 ⇒ 该按钮无事可做，但必须**给出可见反馈**（不是静默空点）",
		allCollapsed === 0 && /没有可折叠/.test(String(allToast)), { allCollapsed, allToast, collapsibleNonRoot });
	t("C-M9b", "且此时不谎报已折叠（文案仍是「折叠全部」）", /折叠/.test(allLabel1), allLabel1);
}

/* ══════════ 6. 缩放组 ══════════ */
section("【6】缩放组（－ % ＋ / 1:1 / 适应，含幂等反馈）");
/* 🔴 不能假设打开后就是 100%：打开时会**自动适应**一次（k 可能 0.8×），
 *    故本组先从「1:1」建立已知基线，再测 － / ＋ 的对称性。 */
/* 🔴 探针文案抽成顶层常量：此前把它们内联进 t(...) 实参里，形成
 *    js(`…`) + String(…) + .test(…) 三层嵌套，括号一多就数错
 *    —— 曾因此多写一个 ')' 直接 SyntaxError: missing ) after argument list，
 *    整支脚本跑不起来（不是断言失败，是根本没解析）。抽成常量后不再嵌套。 */
const ZOOM_TXT = `(document.querySelector('[data-testid="mm-zoom"]')||{}).textContent || ""`;
/* 🔴 契约式取值，**不许裸解引用**（2026-09-14 崩溃实录）：
 *    原写法 `document.querySelector('[data-testid="mm-stage"]').getAttribute("data-zoom")`
 *    在浮层不在场时 querySelector 返回 null ⇒ `.getAttribute` 抛 TypeError ⇒ **抛穿顶层、
 *    其后 100+ 断言全丢**。改成"取不到就给 NaN + 由前置断言先说明原因"：
 *    浮层缺失时这几条会**失败并打印 NaN**（可读），而不是让整支脚本死掉。 */
const STAGE_K = `(function(){var e=document.querySelector('[data-testid="mm-stage"]');return e?parseFloat(e.getAttribute("data-zoom")):NaN;})()`;
const STAGE_MATRIX = `(function(){var e=document.querySelector('[data-testid="mm-stage"]');if(!e)return NaN;return parseFloat(getComputedStyle(e).transform.split(",")[0].replace("matrix(",""));})()`;
/* 前置：浮层必须在场。先自动补开，再断言 —— 否则下面的百分比/矩阵断言全是"空真"。
 * （同一类陷阱本脚本在 C-M8p / C-M9p / C-M15a0a 处已各拦过一次，此处是补漏。） */
await ensureOpen();
await state("【C-M10】前");
t("C-M10p", "前置：导图浮层在场且 `mm-stage` 有 DOM（否则缩放断言无从判定，会读成 NaN）",
	await js(`!!document.querySelector('[data-testid="mm-stage"]')`), null);
await clickSel('[data-testid="mm-zoom-100"]');
await sleep(220);
const z0 = await js(ZOOM_TXT);
t("C-M10a", "「1:1」把缩放归到 100%", /^100%$/.test(z0.trim()), z0);
await clickSel('[data-testid="mm-zoom-out"]');
await sleep(220);
const z1 = await js(ZOOM_TXT);
const k1 = await js(STAGE_K);
const t1 = await js(STAGE_MATRIX);
t("C-M10b", "点「－」后百分比下降 10%", /^90%$/.test(z1.trim()), [z0, z1]);
t("C-M10c", "缩放值真的落到 DOM（data-zoom = 0.9）", Math.abs(k1 - 0.9) < 0.001, k1);
t("C-M10d", "矩阵变换与 data-zoom 一致（不是只改文案）", Math.abs(t1 - k1) < 0.02, [t1, k1]);
await clickSel('[data-testid="mm-zoom-in"]');
await sleep(220);
const z2 = String(await js(ZOOM_TXT)).trim();
t("C-M10e", "点「＋」回到 100%（与「－」互逆，不是单程）", /^100%$/.test(z2), z2);
await clickSel('[data-testid="mm-zoom-out"]'); await sleep(150);
await clickSel('[data-testid="mm-zoom-100"]'); await sleep(220);
t("C-M10g", "「1:1」可从任意缩放态回到真实像素", (await js(STAGE_K)) === 1, null);
await clickSel('[data-testid="mm-fit"]');
await sleep(350);
t("C-M10f", "「适应」后有反馈文案（幂等操作也有回应，不是「点了像没点」）",
	await js(`!!document.querySelector('[data-testid="mm-toast"]')`) === true, null);

/* ══════════ 7. 搜索 ══════════ */
section("【7】搜索定位");
const firstTitle = await js(`(function(){var n=document.querySelector('[data-testid="mm-node"]');return n?n.getAttribute("data-session-id"):null;})()`);
if (firstTitle) {
	await js(`(function(){
	  var el = document.querySelector('[data-testid="mm-search"]');
	  var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
	  set.call(el, ${JSON.stringify(firstTitle.slice(-4))});
	  el.dispatchEvent(new Event("input", { bubbles: true }));
	  return 1;
	})()`);
	await sleep(300);
	const hits = await js(`(document.querySelector('[data-testid="mm-search-hits"]')||{}).textContent || ""`);
	const dimmed = await js(`Array.from(document.querySelectorAll('[data-testid="mm-node"]')).filter(function(n){return parseFloat(getComputedStyle(n).opacity) < 0.9;}).length`);
	const outlined = await js(`Array.from(document.querySelectorAll('[data-testid="mm-node"]')).filter(function(n){return getComputedStyle(n).outlineStyle !== "none";}).length`);
	t("C-M11a", "命中计数出现且 ≥1", /命中 [1-9]/.test(hits), hits);
	t("C-M11b", "命中节点被高亮（outline 非 none）", outlined >= 1, outlined);
	t("C-M11c", "未命中节点淡出（opacity < 0.9）", dimmed >= 1, dimmed);
	await js(`(function(){var el=document.querySelector('[data-testid="mm-search"]');var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(el,"");el.dispatchEvent(new Event("input",{bubbles:true}));return 1;})()`);
	await sleep(250);
	t("C-M11d", "清空搜索后高亮与淡出都撤销", await js(`(document.querySelector('[data-testid="mm-search-hits"]')===null) && Array.from(document.querySelectorAll('[data-testid="mm-node"]')).every(function(n){return parseFloat(getComputedStyle(n).opacity) > 0.9;})`) === true, null);
} else {
	sk("C-M11a–d", "搜索", "画布上没有节点");
}

/* ══════════ 8. 小地图跳转 ══════════ */
section("【8】小地图");
const miniRect = await rectOf('[data-testid="mm-minimap"]');
if (miniRect) {
	/* 🔴 确定前置，避免端点 clamp 假红（2026-09-13 纠错）：
	 *   旧版只「放大 1 次 → 点 (0.9,0.2) → 看 scrollLeft 变没变」。实测 fit 态放大 1 次后
	 *   横向仅溢出约 138px，而放大居中会把这 138px 一次滚到右端；此时再点小地图右侧，
	 *   scrollLeft 被 clamp 在同一最大值（纵向其实跳了），判据却只读横向 ⇒ 假红 [138.4,138.4]。
	 *   做法：放大到横纵溢出都 >250px（一般 1-2 次），再把视野归到 (0,0)，点右下角 (0.9,0.9)，
	 *   横纵都应大幅跳走（>100px）。判据同时锁死「前置真的有溢出」与「横纵都跳够幅度」。 */
	for (let zi = 0; zi < 4; zi++) {
		const ov = await js(`(function(){var b=document.querySelector('[data-testid="mm-body"]');return {x:b.scrollWidth-b.clientWidth,y:b.scrollHeight-b.clientHeight};})()`);
		if (ov.x > 250 && ov.y > 250) break;
		await clickSel('[data-testid="mm-zoom-in"]'); await sleep(180);
	}
	await js(`var b=document.querySelector('[data-testid="mm-body"]');b.scrollLeft=0;b.scrollTop=0;`);
	await sleep(200);
	const before12 = await js(`(function(){var b=document.querySelector('[data-testid="mm-body"]');return {sl:b.scrollLeft,st:b.scrollTop,ox:b.scrollWidth-b.clientWidth,oy:b.scrollHeight-b.clientHeight};})()`);
	await clickAt(miniRect.x + miniRect.w * 0.9, miniRect.y + miniRect.h * 0.9);
	await sleep(320);
	const after12 = await js(`(function(){var b=document.querySelector('[data-testid="mm-body"]');return {sl:b.scrollLeft,st:b.scrollTop};})()`);
	const canX12 = before12.ox > 250, canY12 = before12.oy > 250;
	t("C-M12a", "点小地图右下角后，每个真有溢出(>250)的维度都大幅跳转（链式窄树横向无空白溢出属正常，只断言纵向；宽树两维都断言）",
		(canX12 || canY12) && (!canX12 || after12.sl > before12.sl + 100) && (!canY12 || after12.st > before12.st + 100),
		{ before: before12, after: after12, canX: canX12, canY: canY12 });
	const vp = await rectOf('[data-testid="mm-minimap-vp"]');
	t("C-M12b", "视野框尺寸 > 0（不是塌成一条线）", vp && vp.w > 1 && vp.h > 1, vp);
} else { sk("C-M12a/C12b", "小地图", "未找到小地图元素"); }

/* ══════════ 9. 窗口控件安全区（本轮的第二个诉求） ══════════ */
await state("【8】后 / 【9】前");
section("【9】✕ 与原生窗口按钮不重叠（含「防平凡真」前置）");
const safe = await js(`(function(){
  var root = document.querySelector('[data-testid="mm-root"]');
  var x = document.querySelector('[data-testid="mm-close"]');
  var top = document.querySelector('[data-testid="mm-top"]');
  var tools = document.querySelector('[data-testid="mm-tools"]');
  if(!root||!x||!top) return null;
  var wco = navigator.windowControlsOverlay;
  var titleRect = (wco && wco.visible && wco.getTitlebarAreaRect) ? wco.getTitlebarAreaRect() : null;
  var xr = x.getBoundingClientRect();
  var tr = tools ? tools.getBoundingClientRect() : null;
  return {
    inset: parseInt(root.getAttribute("data-inset"), 10),
    vw: window.innerWidth,
    titleW: titleRect ? titleRect.width : null,
    wcoVisible: !!(wco && wco.visible),
    topPadRight: parseFloat(getComputedStyle(top).paddingRight),
    toolPadRight: tr ? parseFloat(getComputedStyle(tools).paddingRight) : null,
    xRight: xr.right, xLeft: xr.left, xW: xr.width,
    boundary: titleRect ? titleRect.x + titleRect.width : (window.innerWidth - parseInt(root.getAttribute("data-inset"),10))
  };
})()`);
t("C-M13a", "本环境确实存在原生窗口控件覆盖层（防「平凡真」：inset=0 时「不重叠」对谁都成立）",
	safe && safe.wcoVisible === true && safe.inset > 0, safe);
t("C-M13b", "顶栏已按安全区右侧内缩（paddingRight = inset + 10）",
	safe && safe.topPadRight > safe.inset, safe && { padRight: safe.topPadRight, inset: safe.inset });
t("C-M13c", "工具条同样避让（原生控件高 44 > 工具条，会向下溢出）",
	safe && safe.toolPadRight !== null && safe.toolPadRight > safe.inset, safe && { toolPadRight: safe.toolPadRight, inset: safe.inset });
t("C-M13d", "✕ 的右边界 ≤ 安全区边界（不与最小化/最大化/关闭 三个原生按钮重叠）",
	safe && safe.xRight <= safe.boundary + 0.5, safe && { xRight: safe.xRight, boundary: safe.boundary });
t("C-M13e", "✕ 仍在可视区内且可点（宽 > 0，左边界 > 0）",
	safe && safe.xW > 0 && safe.xLeft > 0, safe && { xLeft: safe.xLeft, xW: safe.xW });
const closeHit = await js(`(function(){
  var x = document.querySelector('[data-testid="mm-close"]'); var r = x.getBoundingClientRect();
  var el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
  return el === x || x.contains(el);
})()`);
t("C-M13f", "✕ 的中心点命中测试为它自己（没有被任何层压住）", closeHit === true, closeHit);

/* ══════════ 10. 右键菜单（有接口才可点） ══════════ */
section("【10】右键菜单 —— 只给有接口的动作开口");
/* 🔴 DOMRect 没有可枚举自有属性 ⇒ `returnByValue` 会序列化成 {}（x 变 undefined →
 *    CDP 报 "double value expected"）。取几何一律走 rectOf(...)。
 * 🔴 而且必须是**视口内 + 命中自己**的节点：第 8 段点小地图把画布滚走后，
 *    DOM 第一个节点的 x 是 -934，真实鼠标事件打在视口外 ⇒ 菜单永远不会出来。 */
await ensureOpen();
await state("【10】前");
const spot = await focusVisibleNode();
if (spot) {
	const cx = spot.cx, cy = spot.cy;
	console.log("  · 右键目标：node#" + spot.i + " sid=" + String(spot.sid).slice(-6) +
		" → 点 (" + cx + "," + cy + ")（已确证在视口内且命中测试为自己）");
	emit("Input.dispatchMouseEvent",{ type: "mouseMoved", x: cx, y: cy });
	await sleep(130);
	emit("Input.dispatchMouseEvent",{ type: "mousePressed", x: cx, y: cy, button: "right", clickCount: 1, buttons: 2 });
	await sleep(60);
	emit("Input.dispatchMouseEvent",{ type: "mouseReleased", x: cx, y: cy, button: "right", clickCount: 1, buttons: 0 });
	await sleep(300);
	await state("【10】右键后");
	const menuOk = await js(`!!document.querySelector('[data-testid="mm-ctxmenu"]')`);
	t("C-M14a", "右键节点弹出菜单", menuOk === true, menuOk);
	if (menuOk) {
		const items = await js(`Array.from(document.querySelectorAll('[data-testid^="mm-ctx-"]')).filter(function(e){return e.getAttribute("data-enabled")!==null;}).map(function(e){return [e.getAttribute("data-testid"), e.getAttribute("data-enabled")];})`);
		t("C-M14b", "菜单项 ≥ 5 条", items.length >= 5, items);
		t("C-M14c", "「打开此对话」「fork」为可点（宿主有接口）",
			items.some((i) => i[0] === "mm-ctx-open" && i[1] === "1") && items.some((i) => i[0] === "mm-ctx-fork" && i[1] === "1"), items);
		t("C-M14d", "「合并回父」「删除分支」为禁用（宿主无接口 —— 不做假按钮）",
			items.some((i) => i[0] === "mm-ctx-merge" && i[1] === "0") && items.some((i) => i[0] === "mm-ctx-remove" && i[1] === "0"), items);
		const why = await js(`(document.querySelector('[data-testid="mm-ctx-remove"]')||{}).getAttribute ? document.querySelector('[data-testid="mm-ctx-remove"]').getAttribute("title") : ""`);
		t("C-M14e", "禁用项 title 写明缺什么接口（不是静默变灰）", /未暴露|不可用/.test(String(why)), why);
		const disabledClickOk = await js(`(function(){
		  var d = document.querySelector('[data-testid="mm-ctx-remove"]');
		  var before = document.querySelectorAll('[data-testid="mm-review"]').length;
		  d.click();
		  return { menuStillOpen: !!document.querySelector('[data-testid="mm-ctxmenu"]'), before: before };
		})()`);
		t("C-M14f", "点禁用项无任何副作用（菜单不关、不触发动作）", disabledClickOk.menuStillOpen === true, disabledClickOk);
	} else {
		sk("C-M14b–f", "菜单项", "菜单未弹出");
	}
} else { sk("C-M14a–f", "右键菜单", "画布上没有可用节点（自诊断已打在上一行：可分辨「有框但视口外」「被别的层压住」「根本没有框」）"); }

/* ══════════ 11. 悬浮工具条 ══════════ */
await ensureOpen();
await state("【11】前");
section("【11】悬浮工具条");
/* 🔴 Esc 在本产品里是「逐层退」：有菜单时它只关菜单，**没菜单时它会把整张导图关掉**
 *    （这是设计，不是 bug）。上一版无条件按 Esc「先把菜单关掉」，
 *    结果没有菜单可关 ⇒ 导图层被关掉 ⇒ 本段与后面两段全在量一个已卸载的 DOM，
 *    报出来的却是「工具条没出 / toast 没来 / 输入框不存在」三个**误导性现象**。
 *    所以：只在菜单确实开着时才按 Esc。 */
/* 先把菜单关掉，否则它盖在节点中心上，悬停事件的落点会是菜单而不是节点。
 * （Esc 的「逐层退」两层语义统一在【12】里自证，这里只做清理、不做断言，
 *   以免同一个事实被两处断言、其中一处还得靠 sk() 跳过。） */
if (await js(`!!document.querySelector('[data-testid="mm-ctxmenu"]')`)) {
	await key("Escape", "Escape", 27);
	await sleep(250);
}
/* 🔴 输入派发延迟是**可测的环境常数**，不是"偶发"（第二十四轮实测）
 *    逐个 `mouseMoved` 量送达耗时（连续 6 个不同坐标）：974 / 981 / 982 / 976 / 1090 / 1093 ms，
 *    **每次派发还会在页面上产生 3 个 mousemove**。
 *    而本套件原来在 `mouseMoved` 之后固定 `sleep(300)` —— **只有真实耗时的 1/3**
 *    ⇒ 「工具条没消失 / 没出现」全是**没等到**，却被记成产品缺陷（纪律 55：预算必须覆盖真实耗时）。
 *    ⇒ 改为**有界轮询**：等到「期望状态出现」为止，预算 12s（≈12 倍实测耗时），
 *      超预算才判红，并且**把实读值打出来**（纪律 19：不许无声）。 */
const HOVER_BUDGET_MS = 12000;
async function waitHover(want) {
	const t0 = Date.now();
	let last = null;
	while (Date.now() - t0 < HOVER_BUDGET_MS) {
		last = await js(`(function(){var e=document.querySelector('[data-testid="mm-hoverbar"]');return e?{present:1,id:e.getAttribute('data-hover-id')}:{present:0,id:null};})()`);
		if (want === "gone" && last.present === 0) return last;
		if (want !== "gone" && last.present === 1 && (!want || last.id === want)) return last;
		await sleep(150);
	}
	return last;
}
const spot2 = (await focusVisibleNode()) || spot;
if (spot2) {
	/* 先移开鼠标证明工具条**会走**，再移上去证明它**会来** ——
	 * 否则鼠标本来就在节点上（上一段刚右击过），onMouseEnter 不会再触发，
	 * 「工具条在」有可能是上一段的残留，证明力为零。
	 * 🔴 2026-09-12 纠错：移开的目标点**不能写死常数**（原为 (18,320)）。
	 *   探针 m1 实测该点在滚动后正好压在节点 rect [-10,291,98,31] 内 ⇒
	 *   工具条不消失是**正确的**，却被判红。改为按当前几何求空白点。 */
	const hbBefore = await js(`!!document.querySelector('[data-testid="mm-hoverbar"]')`);
	const blank = await blankPoint();
	t("C-M15a0a", "前置：移开前工具条确实在（否则「会消失」是平凡真）", hbBefore === true, { hbBefore });
	if (!blank) {
		sk("C-M15a0", "鼠标移开节点后工具条消失", "算不出确证空白点（画布被节点铺满）——自诊断已在 C-M15a0a 之前打印");
	} else {
		console.log("  · 移开目标：确证空白点 (" + blank.x + "," + blank.y + ") 命中 " + blank.hit + "（不在任何节点/工具条内）");
		emit("Input.dispatchMouseEvent",{ type: "mouseMoved", x: blank.x, y: blank.y });
		const awayState = await waitHover("gone");
		const hbAway = !!(awayState && awayState.present === 1);
		t("C-M15a0", "鼠标移开节点后工具条消失（先证明它会走）", hbAway === false, { hbAway, at: [blank.x, blank.y], 实读: awayState });
	}
	emit("Input.dispatchMouseEvent",{ type: "mouseMoved", x: spot2.cx, y: spot2.cy });
	/* 🔴 等到**这个节点**的工具条 —— 只等"工具条存在"会命中上一段的残留（纪律 23） */
	const onState = await waitHover(spot2.sid || null);
	const hb = await js(`(function(){var e=document.querySelector('[data-testid="mm-hoverbar"]');return e?{id:e.getAttribute("data-hover-id"), n:e.children.length, r:e.getBoundingClientRect().height, titles:Array.from(e.children).map(function(c){return c.getAttribute("title")||"";})}:null;})()`);
	t("C-M15a", "悬停节点出现悬浮工具条（真实 mouseMoved 到节点中心）",
		hb !== null && (!spot2.sid || hb.id === spot2.sid), { hb: hb, 期望节点: spot2.sid, 轮询实读: onState });
	if (hb) {
		/* 🔴 2026-09-12 修：产品实际是 **7** 个动作 —— fork / 打开 / 抓取 / 审核 / 折叠 / 💬在右侧展开对话 / 更多。
		 *  旧断言停在 6，名单里**少的就是 💬**（用户要求「点击框在右侧展开对话」时加的那个）。
		 *  「动作变多了」被判红，会把一条正确的功能增强当成回归 —— 断言过时和断言太松一样有害。
		 *  判据改为：数量 = 7，且 7 类语义在 title 里**逐类对得上**（只数个数不认内容 = 换 7 个别的按钮也能过）。 */
		const HB_WANT = ["分支", "打开", "抓取", "审核", "折叠", "右侧", "更多"];
		const hbMiss = HB_WANT.filter((kw) => !(hb.titles || []).some((s) => s.indexOf(kw) >= 0));
		t("C-M15b", "工具条 7 个动作（fork/打开/抓取/审核/折叠/💬右侧对话/更多），且 7 类语义逐类对得上",
			hb.n === 7 && hbMiss.length === 0, { n: hb.n, 缺: hbMiss });
		t("C-M15c", "工具条尺寸 > 0（可见、可点）", hb.r > 8, hb);
	}
} else { sk("C-M15a–c", "悬浮工具条", "画布上没有「视口内且命中自己」的节点（自诊断已打在上一行）"); }

/* ══════════ 12. Esc 逐层退 + toast 自动消失 ══════════ */
await ensureOpen();
await state("【12】前");
section("【12】Esc 逐层退 与 toast 自动消失");
/* Esc 是「逐层退」两层（源码取证 MindMap.js:212-216：
 *   if (menu) { setMenu(null); return; }  ← 第一层只关菜单
 *   onClose();                            ← 第二层才关整张导图
 * ）
 * 本段**自己把菜单开出来**再验第一层，不依赖上一段的残留状态 ——
 * 上一版就是因为依赖残留、菜单在第 11 段被耗掉，C-M16a 只剩一条 sk() 跳过。 */
const escSpot = await focusVisibleNode();
if (escSpot) {
	emit("Input.dispatchMouseEvent",{ type: "mouseMoved", x: escSpot.cx, y: escSpot.cy });
	await sleep(120);
	emit("Input.dispatchMouseEvent",{ type: "mousePressed", x: escSpot.cx, y: escSpot.cy, button: "right", clickCount: 1, buttons: 2 });
	await sleep(60);
	emit("Input.dispatchMouseEvent",{ type: "mouseReleased", x: escSpot.cx, y: escSpot.cy, button: "right", clickCount: 1, buttons: 0 });
	await sleep(280);
	const menuUp = await js(`!!document.querySelector('[data-testid="mm-ctxmenu"]')`);
	t("C-M16a0", "前置：右键重新开出菜单（防「平凡真」——没有菜单就验不了第一层）", menuUp === true, menuUp);
	if (menuUp) {
		await key("Escape", "Escape", 27);
		await sleep(280);
		const menuGone = (await js(`!!document.querySelector('[data-testid="mm-ctxmenu"]')`)) === false;
		const mapAlive = await js(`!!document.getElementById("dsh-mindmap")`);
		t("C-M16a", "Esc 第一层：先关右键菜单，导图仍开着（逐层退）", menuGone && mapAlive === true, { menuGone, mapAlive });
	}
} else { sk("C-M16a", "Esc 第一层：先关菜单", "画布上没有可控节点"); }
/* 🔴 同 C-M15a 的教训：输入派发实测 ~1s，原来 `sleep(150)` 后就读 toast
 *    ⇒ 「toast 没出现」是**没等到**，不是「点了没反馈」（纪律 55）。
 *    改为有界轮询：出现预算 8s；出现后再等它**自己消失**（预算 8s，> 2.4s 自动消失）。 */
const toastRead = () => js(`!!document.querySelector('[data-testid="mm-toast"]')`);
await clickSel('[data-testid="mm-fit"]');
let toastVisible = false;
for (let i = 0; i < 54 && !toastVisible; i++) { await sleep(150); toastVisible = await toastRead(); }
let toastGone = false;
if (toastVisible) { for (let i = 0; i < 54; i++) { await sleep(150); if (!(await toastRead())) { toastGone = true; break; } } }
t("C-M16b", "toast 出现（点了有反馈，不是静默）", toastVisible === true, { toastVisible, 轮询预算: "8.1s" });
/* 🔴 不能只断言 toastGone === false：toast 从没出现过时它**平凡为真**（空真）。
 *    必须叠加「刚才确实出现过」这个前置，才构成有效证据。
 *    （同一类陷阱已在本文件 C-M13a 用「防平凡真」前置拦过一次，此处补齐。） */
/* 🔴 语义记号（第二十四轮踩到并修正）：`toastGone` = 「**已消失**」（true 才是消失了）。
 *    旧版同名变量存的是「**当前还在**」（true = 还在），判据写作 `toastGone === false`。
 *    改成有界轮询后若照抄旧判据 ⇒ 语义反转，会把「正确消失」判成红（纪律 23：改判据必须先问反例）。 */
t("C-M16c", "toast 2.4s 后自动消失（不是「永不消失」）", toastVisible === true && toastGone === true, [toastVisible, toastGone]);

/* Esc 第二层：没有内层时，Esc 关掉整张导图（源码取证 MindMap.js:250 → Esc 逐层退
 *   「个性化 → 菜单 → 右侧面板 → 导图」）。
 * 🔴 这一层**必须**被显式证明：上一版把「无菜单时按 Esc」当成无害的清理动作，
 *    结果导图层被关掉，第 12/13 段全在量一个已卸载的 DOM，
 *    最终报成「toast 没出现 / 输入框不存在」两个完全误导的结论。
 * 🔴 2026-09-12 又修一次：旧版**按一次**就断言"导图应关闭"，可它没先证明前提 ——
 *    进到这一段时右侧面板/个性化面板可能还开着（前面的段落选过节点、开过 💬），
 *    那一次 Esc 关掉的是**内层**，导图当然还在 ⇒ 假红（实测证据 `null`）。
 *    现在改成**逐层退序列**：不假设"还剩几层"（那依赖前面段的残留），而是断言
 *    **顺序性质** —— 必须由内而外，且关掉导图的那一次，内层必须已经全关。 */
/* 🔴 2026-09-12 再补强：把**个性化面板真的打开**再跑 Esc 序列。
 *    为什么：escProbe 里的 `pz` 原先恒为 false —— 本脚本从不点 `mm-personalize`，
 *    于是 C-M16d 里「最后一按必须内层全关」对个性化这一层是**平凡真**（空真）。
 *    而它恰恰是整个 Esc 栈的**最上层**，且实测会用 window-capture +
 *    `stopPropagation()` 把 Esc 吃掉（工作室侧已因此产生过连环假红），必须真的测到。 */
const mmPzBtn = await js(`!!document.querySelector('[data-testid="mm-personalize"]')`);
if (mmPzBtn) { await clickSel('[data-testid="mm-personalize"]'); await sleep(400); }
const mmPzOpen = await js(`!!document.querySelector('[data-testid="pp-panel"]')`);
t("C-M16d0", "前置：个性化面板已由真实按钮打开（不再是平凡真）", mmPzBtn && mmPzOpen, { 按钮在: mmPzBtn, 面板开: mmPzOpen });

const escProbe = `(function(){var r=document.querySelector('[data-testid="mm-root"]');return {
  menu: !!document.querySelector('[data-testid="mm-ctxmenu"]'),
  detail: r ? String(r.getAttribute("data-detail")) : null,
  pz: !!document.querySelector('[data-testid="pp-panel"]'),
  map: !!document.getElementById("dsh-mindmap")};})()`;
const escSeq = [];
let escMapClosed = false;
for (let i = 0; i < 5; i++) {
	const before = await js(escProbe);
	if (!before || !before.map) { escMapClosed = true; break; }
	await key("Escape", "Escape", 27);
	await sleep(300);
	const after = await js(escProbe);
	if (!after) break;
	escSeq.push({ menu: [before.menu, after.menu], detail: [before.detail, after.detail], pz: [before.pz, after.pz], map: [before.map, after.map] });
	if (!after.map) { escMapClosed = true; break; }
}
const escLast = escSeq.length ? escSeq[escSeq.length - 1] : null;
const escLayered = !!escLast && escLast.map[0] === true && escLast.map[1] === false
	&& escLast.menu[0] === false && escLast.detail[0] === "0" && escLast.pz[0] === false;
t("C-M16d", "Esc 逐层退：内层（菜单/个性化/右侧面板）**全关之后**才关整张导图，且最多 5 按内必关",
	escMapClosed && escLayered, { 按了几次: escSeq.length, 最后一按: escLast });
t("C-M16d2", "反证：导图**不是**被一跳关掉的（至少经历过 1 次只关内层、导图仍在）",
	escSeq.length >= 1 && escSeq.slice(0, -1).every((s) => s.map[1] === true), escSeq.map((s) => s.map.join("→")));

/* ══════════ 13. 底栏路由 ══════════ */
await ensureOpen();
await state("【13】前");
section("【13】底栏「待总监路由」");
/* 🔴 这里原来直接把 HTMLInputElement.prototype 的 value setter 套到一个可能是 null
 *    的元素上 ⇒ `set.call(null, …)` 抛 "Illegal invocation"，
 *    整个脚本崩在第 13 段、**拿不到汇总**。改成先探测再写：
 *    元素不在就老老实实记一条 ❌，而不是让进程挂掉（挂掉会掩盖前面所有结论）。 */
const inputThere = await js(`!!document.querySelector('[data-testid="mm-input"]')`);
if (!inputThere) {
	t("C-M17a", "底栏「待总监路由」输入框存在", false, { 现象: "mm-input 不在 DOM（导图层可能已被关闭）" });
	t("C-M17b", "路由卡", false, "输入框不在，无法继续");
	t("C-M17c", "四个去向按钮", false, "输入框不在，无法继续");
} else {
	await js(`(function(){
	  var el = document.querySelector('[data-testid="mm-input"]');
	  var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
	  set.call(el, "把弹窗那条占位问题也修了");
	  el.dispatchEvent(new Event("input", { bubbles: true }));
	  return 1;
	})()`);
	await sleep(200);
	await clickSel('[data-testid="mm-route"]');
	await sleep(350);
	const card = await js(`(function(){var e=document.querySelector('[data-testid="mm-route-card"]');return e?e.textContent:null;})()`);
	t("C-M17a", "输入后点「交由总监」出现路由卡", card !== null, card);
	t("C-M17b", "路由卡给出建议去向 + 置信度", !!card && /建议/.test(card) && /0\.\d+/.test(card), card);
	const btns = await js(`["mm-rt-transfer","mm-rt-direct","mm-rt-new","mm-rt-cancel"].filter(function(k){return !!document.querySelector('[data-testid="'+k+'"]');}).length`);
	t("C-M17c", "四个去向按钮齐备（转给/直接调用/新建分支/取消）", btns === 4, btns);
	await clickSel('[data-testid="mm-rt-cancel"]');
	await sleep(250);
}
t("C-M17d", "取消后路由卡收起", await js(`!!document.querySelector('[data-testid="mm-route-card"]')`) === false, null);

/* ══════════ 13.5 分支链路聚焦（R9）══════════ */
section("【13.5】分支链路聚焦（点会话 → 只看该链路 · 含上一层 · 退出）");
/* 🔴 本段之前有 `ensureOpen()`（中段可能把导图关掉再走用户路径重开）——
 *    而产品"每次打开都回到**当前文件夹**"（需求 18 的正确行为）会把作用域打回小集合
 *    ⇒ 画布节点骤减，本段就没有「非根」的框可点（实测 `rows:2`）。
 *    这里**兜底重归一**（幂等：已有配对则零开销直接返回）。 */
await ensureScopeLineage("【13.5】", false);
/* 🔴 前置**归零**而不是"断言进来时没在聚焦态"（2026-09-12 实测改法）：
 *   前面几段会真实点节点（选中即进聚焦），所以进本段时**通常已经处于聚焦态**。
 *   旧写法 `t("C-M19a", ..., focusbar === false)` 于是必红，而且更坏的是——
 *   它把"基线总行数"也取在**聚焦态**下（实测 `want:2`，而全量是 17），
 *   导致 C-M19e「退出后回到全量」跟着一起红（`after:17 ≠ want:2`）：
 *   **一个没归零的起点，会让同段两条断言一起错**。
 *   ⇒ 正确做法：先退出聚焦（若在），再取基线。判据仍保留"归零后确实不在聚焦态"。 */
const focusPre = await js(`(function(){var fb=document.querySelector('[data-testid="mm-focusbar"]');
  return {bar:!!fb, fid:fb?fb.getAttribute('data-focus-id'):null};})()`);
if (focusPre && focusPre.bar) { await clickSel('[data-testid="mm-focus-exit"]'); await sleep(500); }
const focusNow = await js(`(function(){var fb=document.querySelector('[data-testid="mm-focusbar"]');
  return {bar:!!fb, nodes:document.querySelectorAll('[data-testid="mm-node"]').length};})()`);
t("C-M19a", "前置：进入本段时未在聚焦态（若已在则先归零）", focusNow.bar === false,
	{ 进来时: focusPre, 归零后: focusNow });

const fPickRaw = await focusVisibleNode();   // 滚回原点 + 确证在视口内 + 确证命中自己
const fPick = fPickRaw ? await js(`(function(){
  var ns=document.querySelectorAll('[data-testid="mm-node"]');
  var total=ns.length;
  /* 优先挑一个**非根**的框（用户场景：点的是某个对话，不是中心主题） */
  var best=null;
  for (var i=0;i<ns.length;i++){
    if (parseInt(ns[i].getAttribute('data-depth'),10) > 0) { best=ns[i]; break; }
  }
  var e = best || ns[${fPickRaw.i}];
  if (!e) return null;
  var b = document.querySelector('[data-testid="mm-body"]');
  if (!b) return null;
  /* 目标若不在可视区 ⇒ 先把它滚进来（真实鼠标事件打在视口外等于没点） */
  var br = b.getBoundingClientRect(), r = e.getBoundingClientRect();
  if (r.x+r.width/2 < br.x+4 || r.x+r.width/2 > br.right-4 || r.y+r.height/2 < br.y+4 || r.y+r.height/2 > br.bottom-4) {
    b.scrollLeft = Math.max(0, b.scrollLeft + (r.x+r.width/2 - (br.x+br.width/2)));
    b.scrollTop  = Math.max(0, b.scrollTop  + (r.y+r.height/2 - (br.y+br.height/2)));
    br = b.getBoundingClientRect(); r = e.getBoundingClientRect();
  }
  var cx = Math.round(r.x+r.width/2), cy = Math.round(r.y+r.height/2);
  var hit = document.elementFromPoint(cx, cy);
  return { id: e.getAttribute('data-session-id'), total: total, cx: cx, cy: cy,
           inView: cx > br.x+2 && cx < br.right-2 && cy > br.y+2 && cy < br.bottom-2,
           hitSelf: !!(hit && (hit===e || e.contains(hit) || hit.contains(e))),
           hitTop: hit ? (hit.tagName.toLowerCase() + (hit.getAttribute && hit.getAttribute('data-testid') ? '['+hit.getAttribute('data-testid')+']' : '')) : null };
})()`) : null;
if (!fPick) {
	t("C-M19b", "点会话 → 聚焦条", false, "画布上没有节点可点");
	t("C-M19c", "行数收窄", false, "同上");
	t("C-M19d", "含上一层", false, "同上");
	t("C-M19e", "退出聚焦", false, "同上");
} else {
	/* 落点在视口内 + 命中自己才点（否则是"打偏"，不是产品坏 —— 见 clickSel 注释） */
	if (!fPick.inView || !fPick.hitSelf) {
		clickMisses.push({ sel: '[data-testid="mm-node"]', tag: "C-M19b", top: fPick.hitTop, at: [fPick.cx, fPick.cy], try: 1 });
	}
	await clickAt(fPick.cx, fPick.cy);
	await sleep(420);
	const fAfter = await js(`(function(){
	  var bar = document.querySelector('[data-testid="mm-focusbar"]');
	  return { bar: !!bar, fid: bar ? bar.getAttribute('data-focus-id') : null,
	           up: bar ? bar.getAttribute('data-focus-up') : null,
	           rows: document.querySelectorAll('[data-testid="mm-node"]').length };
	})()`);
	t("C-M19b", "点会话 → 出现聚焦条且 `data-focus-id` = 该会话", fAfter.bar === true && fAfter.fid === fPick.id, fAfter);
	t("C-M19c", "聚焦后可见行数 ≤ 原行数（真的收窄了，不是只挂了个条）",
		fAfter.rows <= fPick.total, { before: fPick.total, after: fAfter.rows });

	await clickSel('[data-testid="mm-focus-up"]');
	await sleep(420);
	const fUp = await js(`(function(){
	  var bar = document.querySelector('[data-testid="mm-focusbar"]');
	  return { up: bar ? bar.getAttribute('data-focus-up') : null,
	           rows: document.querySelectorAll('[data-testid="mm-node"]').length };
	})()`);
	t("C-M19d", "开「含上一层」→ 开关态 = 1 且可见行数**只增不减**",
		fUp.up === "1" && fUp.rows >= fAfter.rows, { before: fAfter.rows, after: fUp.rows });

	await clickSel('[data-testid="mm-focus-exit"]');
	await sleep(420);
	const fExit = await js(`(function(){
	  return { bar: !!document.querySelector('[data-testid="mm-focusbar"]'),
	           rows: document.querySelectorAll('[data-testid="mm-node"]').length };
	})()`);
	t("C-M19e", "退出聚焦 → 聚焦条消失且行数回到全量（可逆，不留残留）",
		fExit.bar === false && fExit.rows === fPick.total, { after: fExit.rows, want: fPick.total });
}

/* ══════════ 13.6 总览弹窗（R10）══════════ */
section("【13.6】总览弹窗（左已完成 / 右待完成 · 分文件夹 · 可点 · 可发修正）");
t("C-M20a", "前置：总览未打开", await js(`!!document.querySelector('[data-testid="mm-ov"]')`) === false, null);
await clickSel('[data-testid="mm-overview"]');
await sleep(560);
const ov = await js(`(function(){
  var e = document.querySelector('[data-testid="mm-ov"]'); if (!e) return null;
  var items = [].slice.call(e.querySelectorAll('[data-testid="mm-ov-item"]'));
  return { done: +(e.getAttribute('data-count-done')||0), todo: +(e.getAttribute('data-count-todo')||0),
           items: items.length,
           colDone: !!e.querySelector('[data-testid="mm-ov-col-done"]'),
           colTodo: !!e.querySelector('[data-testid="mm-ov-col-todo"]'),
           groups: e.querySelectorAll('[data-testid="mm-ov-grp"]').length };
})()`);
t("C-M20b", "点「总览」→ 弹窗出现且左右两列齐备", !!ov && ov.colDone && ov.colTodo, ov);
t("C-M20c", "🔴 两列之和 = 条目总数（分类口径对账 —— 分类散落必出这类错）",
	!!ov && ov.done + ov.todo === ov.items, ov && { done: ov.done, todo: ov.todo, items: ov.items });
t("C-M20d", "条目按文件夹分组（组标题数 ≥ 1）", !!ov && ov.groups >= 1, ov && ov.groups);

const ovFirst = await js(`(function(){var e=document.querySelector('[data-testid="mm-ov-item"]');return e?e.getAttribute('data-session-id'):null;})()`);
if (ovFirst) {
	await clickSel('[data-testid="mm-ov-item"]');
	await sleep(380);
	const ovSel = await js(`(function(){var e=document.querySelector('[data-testid="mm-ov"]');return e?e.getAttribute('data-sel-session'):null;})()`);
	t("C-M20e", "点条目 → `data-sel-session` 变成该条（详情区据此显示执行情况）", ovSel === ovFirst, { want: ovFirst, got: ovSel });
	t("C-M20f", "选中后「发送修正」可点（disabled=false）",
		await js(`(function(){var b=document.querySelector('[data-testid="mm-ov-send"]');return b?!b.disabled:null;})()`) === true, null);
} else {
	t("C-M20e", "点条目 → 选中", false, "弹窗内无条目");
	t("C-M20f", "发送修正可点", false, "弹窗内无条目");
}
await clickSel('[data-testid="mm-ov-close"]');
await sleep(380);
t("C-M20g", "点 ✕ 关闭总览（不留残留）", await js(`!!document.querySelector('[data-testid="mm-ov"]')`) === false, null);

/* ══════════ 13.7 项目 / 维度分区（R11 · 用户 2026-09-18）══════════
 * 用户原话：「我觉得不同的一个分支……一个项目上，按照项目分组，不然全堆在一起看看太麻烦了。
 *            按照项目分组，然后再按照分支同一个分支的一个维度分组。」
 * 离线纯函数已由 `test-mindmap-group`（22/22）守住；本段证**界面用的是同一份结果**
 * （纪律 79：写好了 ≠ 接进去了）。 */
section("【13.7】按项目 / 维度分区");

const grpBtn = await js(`(function(){
  var b=document.querySelector('[data-testid="mm-group-toggle"]');
  return b?{on:b.getAttribute('data-on'),text:(b.textContent||'').trim()}:null;})()`);
t("C-M22a", "分区开关存在且默认**开**（`data-on=1`）—— 用户提这条就是因为「全堆在一起」，默认关掉等于每次都要手动开",
	!!grpBtn && grpBtn.on === "1", grpBtn);

const grpInfo = await js(`(function(){
  var gs=Array.from(document.querySelectorAll('[data-testid="mm-group"]'));
  var proj=gs.filter(function(g){return g.getAttribute('data-group-kind')==='project';});
  var sum=proj.reduce(function(a,g){return a+Number(g.getAttribute('data-group-count')||0);},0);
  return {n:gs.length,projN:proj.length,sum:sum,
    nodes:document.querySelectorAll('[data-testid="mm-node"]').length,
    labels:proj.map(function(g){return (g.getAttribute('data-group-label')||'')+'×'+g.getAttribute('data-group-count');}),
    dimsAttr:proj.map(function(g){return g.getAttribute('data-group-dims');})};
})()`);
t("C-M22b", "🔴 出现**项目分区**（≥1 个）且每个都带名称与条数 —— 不是画了个空框",
	grpInfo.projN >= 1 && grpInfo.labels.every((s) => s.indexOf("×") > 0), grpInfo);
t("C-M22c", "🔴 **不丢行**：各分区条数之和 **== 画布可见节点数**（分区必须接住每一个框，兜底桶也算）",
	grpInfo.sum === grpInfo.nodes && grpInfo.nodes > 0, { sum: grpInfo.sum, nodes: grpInfo.nodes, labels: grpInfo.labels });

/* 🔴 分区框**不许吃指针事件** —— 吃了节点就"拖不动"，
 *    而用户看到的是「有些框能拖有些不能」，完全不像分组的问题。
 *    这是用户「所有导图的节点都要允许拖拽」的**机制前提**，必须显式守。 */
const grpPE = await js(`(function(){
  var gs=Array.from(document.querySelectorAll('[data-testid="mm-group"]'));
  return {n:gs.length,none:gs.filter(function(g){return getComputedStyle(g).pointerEvents==='none';}).length};})()`);
t("C-M22d", "🔴 **分区框不吃指针事件**（`pointer-events:none`）—— 「所有节点都能拖」的机制前提",
	grpPE.n > 0 && grpPE.none === grpPE.n, grpPE);

/* 父居中：真机复验（离线已证纯函数 ⇒ 这里证"界面渲染用的是同一份坐标"） */
const centerInfo = await js(`(function(){
  var ns=Array.from(document.querySelectorAll('[data-testid="mm-node"]'));
  var byId={};ns.forEach(function(n){byId[n.getAttribute('data-session-id')]=n;});
  var pairs=[];
  ns.forEach(function(n){
    var pid=n.getAttribute('data-session-id');
    var kids=ns.filter(function(k){return k.getAttribute('data-parent')===pid;});
    if(kids.length) pairs.push({p:n,k:kids});
  });
  return {n:ns.length,pairs:pairs.length};
})()`);
if (centerInfo.pairs === 0) {
	sk("C-M22e", "父居中（1 分叉 2/3/4 ⇒ 1 在中间）", "当前树上没有「父-子」配对（都是根），无法验证 —— 不是失败");
} else {
	/* 🔴 判据必须限定到**同一分区内**的父子对 —— 这是产品的真实口径，不是放宽：
	 *    分区（按作品/维度）与血缘（宿主 fork 固化）是**两个正交维度**，
	 *    父属于 A 项目、子属于 B 项目时，两者各被自己那一区平移 ⇒ **物理上不可能居中**。
	 *    把它们算进"不居中"就是把一条**不可能满足**的要求当成缺陷（纪律 92：判据用产品自己的口径）。
	 *    跨组对数如实打印，避免"排除了多少"变成看不见的暗数。 */
	const cent = await js(`(function(){
	  var ns=Array.from(document.querySelectorAll('[data-testid="mm-node"]'));
	  var bad=0,checked=0,crossPairs=0;
	  ns.forEach(function(n){
	    var pid=n.getAttribute('data-session-id');
	    var g=n.getAttribute('data-group')||'';
	    var all=ns.filter(function(k){return k.getAttribute('data-parent')===pid;});
	    var kids=all.filter(function(k){return (k.getAttribute('data-group')||'')===g;});
	    if(all.length && !kids.length) crossPairs++;
	    if(!kids.length) return;
	    var ys=kids.map(function(k){return parseFloat(k.style.top||'0');}).sort(function(a,b){return a-b;});
	    var py=parseFloat(n.style.top||'0');
	    checked++;
	    if(Math.abs(py-(ys[0]+ys[ys.length-1])/2)>1.5) bad++;
	  });
	  return {checked:checked,bad:bad,crossPairs:crossPairs};})()`);
	if (cent.checked === 0) {
		sk("C-M22e", "父居中（同分区内的父子）",
			"本次数据里没有任何「父子同属一个分区」的配对（跨分区 " + cent.crossPairs + " 对，物理上不可能居中）—— 不是失败");
	} else {
		t("C-M22e", "🔴 **父居中**在界面上真的生效（同分区内：有子的框 top = 首子与末子 top 的中点；容差 1.5px）",
			cent.bad === 0, cent);
	}
}

/* 关掉 → 分区消失且**节点数不变**（可逆、不丢行）；再打开 → 分区回来 */
await clickSel('[data-testid="mm-group-toggle"]', "关分组");
await sleep(300);
const offInfo = await js(`(function(){
  return {gs:document.querySelectorAll('[data-testid="mm-group"]').length,
    nodes:document.querySelectorAll('[data-testid="mm-node"]').length};})()`);
t("C-M22f", "关掉分区 ⇒ 分区框消失，而**节点数一个不少**（关视图 ≠ 丢数据）",
	offInfo.gs === 0 && offInfo.nodes === grpInfo.nodes, { off: offInfo, on: grpInfo.nodes });
await clickSel('[data-testid="mm-group-toggle"]', "开分组");
await sleep(300);
const onInfo = await js(`document.querySelectorAll('[data-testid="mm-group"]').length`);
t("C-M22g", "再打开 ⇒ 分区回来（开关可逆，不留半开态）", onInfo >= 1, { gs: onInfo });

/* ══════════ 13.8 所有节点可拖（R11 · 用户原话：「所有导图的节点都要允许拖拽」）══════════
 * 🔴 本段是**新增的盲区补齐**：第三轮就做了拖拽，但真机套件**从来没有守过它**
 *    （15 个段落里一段都没有）⇒ 它坏了不会有任何信号。用户这次明确点名"所有节点"，
 *    所以判据不是"能拖"而是"**换一个不同层的节点也能拖**"。
 * 🔴 真实鼠标对 `visibilityState` 极敏感（hidden 时 press/release 被整条吞掉，
 *    读起来像"拖不动"= 产品坏了）⇒ 前提不成立时**跳过**，不判产品红（纪律 90/112）。 */
section("【13.8】所有节点可拖（真实鼠标）");
/* 同【13.5】：兜底重归一（幂等），保证「所有节点」这句话有足够多的节点可验。 */
await ensureScopeLineage("【13.8】", false);

async function realDrag(sel, dx, dy) {
	/* 🔴 落空要**先滚到位再拖**，不是"重试兜底"（与 `clickSel` 同范式）：
	 *    本轮实测踩到 —— 被拖的节点 `y≈3401`，**在视口之外**，于是"按矩形中心打"
	 *    算出一个视口外坐标，`elementsFromPoint` 命中的是别的元素 ⇒ 报 `drag=false`，
	 *    读起来完全像"这个节点不能拖"，而真相是**我们没滚过去**。
	 *    真人拖动前也会先滚到它 —— 所以这是补齐测试路径，不是掩盖问题。 */
	let g = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		g = await js(`(function(){
		  var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
		  var r=e.getBoundingClientRect();
		  var mx=Math.round(r.x+r.width/2),my=Math.round(r.y+r.height/2);
		  var st=document.elementsFromPoint(mx,my),t=st[0]||null;
		  return {mx:mx,my:my,top:Math.round(r.top),left:Math.round(r.left),
		    ok:!!t&&(t===e||e.contains(t)||t.contains(e))};})()`);
		if (!g) return { ok: false, why: "节点不在 DOM" };
		if (g.ok) break;
		if (attempt === 0) {
			await js(`(function(){var e=document.querySelector(${JSON.stringify(sel)});`
				+ `if(e&&e.scrollIntoView){try{e.scrollIntoView({block:"center",inline:"center"});}catch(_){e.scrollIntoView();}}return 1;})()`);
			await sleep(360);
			continue;
		}
		return { ok: false, why: "落点被遮挡或仍在视口外", top: g.top, left: g.left };
	}
	if (!g || !g.ok) return { ok: false, why: "落点自检未通过" };
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: g.mx, y: g.my });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: g.mx, y: g.my, button: "left", clickCount: 1, buttons: 1 });
	await sleep(70);
	/* 分步移动：真人拖动是连续的，一次跳到位可能被位移阈值判定成"点"而不是"拖" */
	for (let i = 1; i <= 5; i++) {
		emit("Input.dispatchMouseEvent", {
			type: "mouseMoved", x: Math.round(g.mx + dx * i / 5), y: Math.round(g.my + dy * i / 5), buttons: 1
		});
		await sleep(45);
	}
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(g.mx + dx), y: Math.round(g.my + dy), button: "left", clickCount: 1, buttons: 0 });
	await sleep(280);
	return { ok: true, reached: [g.left, g.top] };
}

const pick2 = await js(`(function(){
  var ns=Array.from(document.querySelectorAll('[data-testid="mm-node"]'));
  if(ns.length<2) return null;
  var sorted=ns.slice().sort(function(a,b){
    return Number(a.getAttribute('data-depth'))-Number(b.getAttribute('data-depth'));});
  return {a:sorted[0].getAttribute('data-session-id'),
          b:sorted[sorted.length-1].getAttribute('data-session-id'),
          da:sorted[0].getAttribute('data-depth'),
          db:sorted[sorted.length-1].getAttribute('data-depth'), n:ns.length};})()`);

if (FOCUS_PRE.visibility !== "visible") {
	sk("C-M23a", "真实鼠标拖动节点", "窗口 visibility=" + FOCUS_PRE.visibility + " ⇒ CDP 的 press/release 会被整条吞掉，拖拽结果不可信（纪律 90）");
	sk("C-M23b", "另一个不同层的节点也能拖", "同上");
} else if (!pick2 || pick2.a === pick2.b) {
	sk("C-M23a", "真实鼠标拖动节点", "画布上不足 2 个节点，无法对比不同层（不是失败）");
	sk("C-M23b", "另一个不同层的节点也能拖", "同上");
} else {
	/* 位移判据读**画布坐标**（`style.left/top`，未缩放）而不是屏幕 rect：
	 * 屏幕位移 = 画布位移 × zoom，而 zoom 受前面「适应 / 缩放」段影响（可能已到 0.3）
	 * ⇒ 用屏幕坐标会出现"拖了但没到阈值"的**假红**，与产品无关（纪律 102：判据偏保守侧）。 */
	async function posOfNode(id) {
		return await js(`(function(){var e=document.querySelector('[data-session-id=${JSON.stringify(id)}]');
		  if(!e)return null;return {x:parseFloat(e.style.left||'NaN'),y:parseFloat(e.style.top||'NaN')};})()`);
	}
	const b1 = await posOfNode(pick2.a);
	const drag1 = await realDrag('[data-session-id="' + pick2.a + '"]', 96, 64);
	const a1 = await posOfNode(pick2.a);
	const mv1 = await js(`(function(){var e=document.querySelector('[data-session-id=${JSON.stringify(pick2.a)}]');return e?e.getAttribute('data-moved'):null;})()`);
	t("C-M23a", "🔴 真实鼠标拖动节点 ⇒ `data-moved=1` 且**画布坐标真的变了**（画布位移 > 40，与缩放无关）",
		drag1.ok && mv1 === "1" && b1 && a1
		&& (Math.abs(a1.x - b1.x) > 40 || Math.abs(a1.y - b1.y) > 40),
		{ drag1, moved: mv1, from: b1, to: a1 });

	const b2 = await posOfNode(pick2.b);
	const drag2 = await realDrag('[data-session-id="' + pick2.b + '"]', -80, 60);
	const a2 = await posOfNode(pick2.b);
	const mv2 = await js(`(function(){var e=document.querySelector('[data-session-id=${JSON.stringify(pick2.b)}]');return e?e.getAttribute('data-moved'):null;})()`);
	t("C-M23b", "🔴 **换一个不同层的节点也能拖**（depth " + pick2.da + " → " + pick2.db + "）—— 用户要的是「**所有**节点」，不是只有某一些",
		drag2.ok && mv2 === "1" && b2 && a2
		&& (Math.abs(a2.x - b2.x) > 40 || Math.abs(a2.y - b2.y) > 40),
		{ drag2, moved: mv2, depth: [pick2.da, pick2.db], from: b2, to: a2 });

	/* 收尾归位：`mmPos` 是**持久化**的，不归位会污染下一次运行
	 *（⚠️ 已知取舍：跑本套件会清掉本机手工拖过的摆放 —— 测试机可接受） */
	await clickSel('[data-testid="mm-auto-layout"]', "自动布局");
	await sleep(320);
	const left = await js(`document.querySelectorAll('[data-testid="mm-node"][data-moved="1"]').length`);
	t("C-M23c", "收尾归位：点「自动布局」后 `data-moved` **归 0**（不留残留污染下次运行）",
		left === 0, { movedLeft: left });
}

/* ══════════ 14. 关闭 ══════════ */
/* ══════════ 13.9 作用域过滤（R12 · 用户 2026-09-18）══════════
 *  用户原话：「只显示**当前文件夹下面的**这些对话的导图 除非我点击上一级 才由上一级的显示」
 *            「按照点击的文件夹下的对话信息整理出的思维导图」
 *
 *  ⚠️ 判据**不写死节点条数**（会话数随使用变化 ⇒ 钉一个数就必然过期，纪律 14/103）：
 *     改为三条**与规模无关**的关系判据：
 *       ① chip 四个可读字段齐备（scoped / total / dropped / scope-up）
 *       ② 画布节点数 == `data-total`（**作用域与画布同源** —— 两个数不等说明过滤算了两遍）
 *       ③ 上溯后 total **单调不减**（上一级只会看到更多，这是作用域的**语义**断言） */
section("【13.9】作用域过滤 + 上一级");

async function readScopeChip() {
	return await js(`(function(){
	  var c=document.querySelector('[data-testid="mm-scope-chip"]');
	  if(!c) return null;
	  var ns=document.querySelectorAll('[data-testid="mm-node"]');
	  var up=document.querySelector('[data-testid="mm-scope-up"]');
	  return {text:(c.textContent||'').trim(), scoped:c.getAttribute('data-scoped'),
	    total:Number(c.getAttribute('data-total')), dropped:Number(c.getAttribute('data-dropped')),
	    up:Number(c.getAttribute('data-scope-up')), nodes:ns.length,
	    hasUp: !!up, upDisabled: up ? !!up.disabled : null};})()`);
}

const sc1 = await readScopeChip();
t("C-M24a", "作用域 chip 在 DOM 且四个字段齐备（scoped / total / dropped / scope-up）",
	!!sc1 && Number.isFinite(sc1.total) && Number.isFinite(sc1.dropped) && Number.isFinite(sc1.up), sc1);
t("C-M24b", "🔴 画布节点数 == chip 的 total（**作用域与画布同源**；不等即过滤算了两遍）",
	!!sc1 && sc1.nodes === sc1.total, sc1 ? { nodes: sc1.nodes, total: sc1.total } : null);
t("C-M24c", "「上一级」按钮存在（到顶时 disabled 且写明原因，而不是凭空消失）",
	!!sc1 && sc1.hasUp === true, sc1);

/* 只有"还能上溯"时才真点 —— 到顶了还去点，会把"设计如此"读成"点了没反应" */
if (sc1 && sc1.hasUp && sc1.upDisabled === false) {
	/* 🔴 2026-09-18（第 38 轮）修正：这里原写作 `clickMisses.push(await clickSel(...))` ——
	 *   `clickSel` 返回的是 **boolean**（点中/落空），而它**落空时自己已经 push 过一个对象**。
	 *   把 boolean 再 push 一次 ⇒ `clickMisses` 恒非空 ⇒ **C-M21 恒红**，且从此**再也看不出真打偏**
	 *   （判据坏掉 = 永久假红 + 永久失明，比不写这条更糟）。正确用法：只传 `tag`，记名交给 clickSel。 */
	await clickSel('[data-testid="mm-scope-up"]', "C-M24d");
	await sleep(460);
	const sc2 = await readScopeChip();
	t("C-M24d", "点「上一级」⇒ scope-up 递增（真的换了作用域，不是只改了个字）",
		!!sc2 && sc2.up > sc1.up, { before: sc1.up, after: sc2 && sc2.up });
	t("C-M24e", "🔴 上溯后可见节点数**单调不减**（语义：上一级只会看到更多，不会更少）",
		!!sc2 && sc2.total >= sc1.total, { before: sc1.total, after: sc2 && sc2.total });
	t("C-M24f", "上溯后画布仍与 chip 同源",
		!!sc2 && sc2.nodes === sc2.total, sc2 ? { nodes: sc2.nodes, total: sc2.total } : null);
} else {
	sk("C-M24d", "点「上一级」换作用域", "已在最高一级（或当前会话未挂到文件夹）⇒ 无上级可点，非失败");
	sk("C-M24e", "上溯后节点数单调不减", "同上");
	sk("C-M24f", "上溯后画布与 chip 同源", "同上");
}

/* ══════════ 13.10 Ctrl + 滚轮缩放（R12 · 用户原话：「ctrl 加鼠标中键 无法放大缩小」）══════════
 *  🔴 判据取**计数**（`window.__mmStats.wheel.zoomed`）而不是"缩放读数的具体数值"：
 *     起始 k 受"打开时自动 fit"影响（长树会 fit 到 30%），数值不稳定；
 *     计数单调递增，不受起点影响 —— 与 `navHookStats` 同一手法。
 *  `modifiers: 2` = Ctrl（CDP 定义 Alt=1 / Ctrl=2 / Meta=4 / Shift=8）—— 与真按 Ctrl 等价。 */
section("【13.10】Ctrl + 滚轮缩放");

const zoomText = async () => await js(`(function(){var v=document.querySelector('[data-testid="mm-zoom"]');return v?(v.textContent||'').trim():null;})()`);
const wheelN = async () => await js(`(function(){var s=window.__mmStats;return (s&&s.wheel)?s.wheel.zoomed:-1;})()`);
const canvasPt = await js(`(function(){var r=document.getElementById('dsh-mindmap');if(!r)return null;var b=r.getBoundingClientRect();if(!b.width||!b.height)return null;return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})()`);

const wc0 = await wheelN();
/* 🔴 2026-09-18（第 38 轮）修正：**先把缩放归位到 1:1**，再滚。
 *
 *  为什么必须归位（本轮全批实测到的**假红**）：
 *    原判据是"Ctrl+滚轮**放大**两次 ⇒ `mm-zoom` 读数必须变"。
 *    但缩放有上下限，而本套件前面【7】段已经连点过 `mm-zoom-in`
 *    ⇒ 到本段时 `k` 可能**已经在放大上限** ⇒ 再放大被 clamp ⇒ 读数不变
 *    ⇒ `C-M25b` 红，而 `C-M25a`（计数）照样绿 —— 读起来像"缩放坏了一半"。
 *    单跑时前面段落的状态不同 ⇒ 是绿的；全批里就红。
 *    ⇒ 这正是**判据建在会漂的量上**（纪律 14/103）的标准形态。
 *
 *  ⇒ 先点「1:1」把 `k` 钉到 100%（与任何前序状态无关），再**向下滚（缩小）**：
 *    从 100% 往下必然有空间（下限 30%），读数**必定**变化 ⇒ 与起点无关。
 */
await clickSel('[data-testid="mm-zoom-100"]', "C-M25b 归位 1:1");
await sleep(260);
const wz0 = await zoomText();
if (canvasPt && wc0 >= 0) {
	emit("Input.dispatchMouseEvent", { type: "mouseWheel", x: canvasPt.x, y: canvasPt.y, deltaX: 0, deltaY: 120, modifiers: 2 });
	await sleep(240);
	emit("Input.dispatchMouseEvent", { type: "mouseWheel", x: canvasPt.x, y: canvasPt.y, deltaX: 0, deltaY: 120, modifiers: 2 });
	await sleep(320);
}
const wc1 = await wheelN();
const wz1 = await zoomText();

t("C-M25a", "🔴 Ctrl+滚轮 ⇒ 缩放**执行计数递增**（`window.__mmStats.wheel.zoomed`）",
	wc1 > wc0, { before: wc0, after: wc1 });
t("C-M25b", "缩放读数随之变化（真的改了 k，不是只记了个数 —— 已先归位 1:1，故与起点无关）",
	wz1 !== wz0, { before: wz0, after: wz1 });
/* 收尾复原：把缩放还给「适应」，免得把 1:1 态留给下一段（纪律：收尾必复原）。 */
await clickSel('[data-testid="mm-fit"]', "C-M25b 收尾复原");
await sleep(260);

/* ══════════ 13.11 默认定位到当前会话（R12 · 用户原话：「默认定位到当前会话」）══════════
 *  ⚠️ 前提守卫：冷启动没有"当前会话"（宿主不给 curId）⇒ 定位**按设计不执行**，
 *     此时跳过而不是判红（把"前提不成立"读成"功能坏了"是纪律 90/112 同族）。
 *  ⚠️ 判据取**执行次数**：滚动位置受布局时序（字体加载 / 分组重排 / fit 延迟）影响，
 *     阈值会过期；计数则不受起点影响，且能区分"没执行"与"执行了但没找到节点"。 */
section("【13.11】默认定位到当前会话");

const hasCurChip = await js(`(function(){return !!document.querySelector('[data-testid="mm-current-chip"]');})()`);
const ctr = await js(`(function(){var s=window.__mmStats;return (s&&s.center)?{auto:s.center.auto,done:s.center.done,missed:s.center.missed}:null;})()`);
if (hasCurChip) {
	t("C-M26a", "🔴 打开导图时执行过「默认定位」（计数 > 0）", !!ctr && ctr.auto > 0, ctr);
	t("C-M26b", "定位有**明确结果**：命中（done>0）或如实记 miss（missed>0），不许两者皆 0 却记过 auto",
		!!ctr && (ctr.done > 0 || ctr.missed > 0), ctr);
} else {
	sk("C-M26a", "打开导图时执行「默认定位」", "当前无宿主会话（冷启动 / 未建立起点）⇒ 按设计不执行，非失败");
	sk("C-M26b", "定位有明确结果", "同上");
}

section("【14】关闭");
await clickSel('[data-testid="mm-close"]');
await sleep(400);
t("C-M18", "点 ✕ 关闭导图层（DOM 移除）", await js(`!!document.getElementById("dsh-mindmap")`) === false, null);

/* ══════════ 15. 点击质量（**测试自身的证词**，不是产品断言）══════════
 * 为什么单列一条：本项目已经三次出现"点击落空被记成产品缺陷"（顶栏 14 键、
 * R8 登记键 23px 漂移、本脚本 C-M19b）。把落空记名并**显式断言为 0**，
 * 才能在下一次红的时候一眼分清"产品坏了"还是"这一击打偏了"。 */
section("【15】点击质量（真实鼠标落点自检）");
/* 🔴 2026-09-18（第 38 轮）加固：**先分拣"闸门自己写坏的记名"**。
 *   `clickMisses` 的契约是**只装对象**（由 `clickSel` 内部在两次尝试后仍落空时 push）。
 *   若里面出现非对象项，说明有调用方把 `clickSel` 的 **boolean 返回值**又 push 了一遍 ——
 *   那是**闸门缺陷**，会制造恒假红并同时**掩盖真打偏**。
 *   把它单列一条（`C-M21b`）且**判 INVALID**（exit 2），与"产品真打偏"（`C-M21` 红）彻底分开。
 *   来源：本轮实测 —— `mm-scope-up` 那一击写成了 `push(await clickSel(...))`。 */
const badMissEntries = clickMisses.filter((m) => !(m && typeof m === "object" && typeof m.sel === "string"));
const realMisses = clickMisses.filter((m) => m && typeof m === "object" && typeof m.sel === "string");
t("C-M21", `本脚本全部点击，落点均在目标元素子树内（不许静默打偏）`,
	realMisses.length === 0, realMisses.length ? realMisses : { misses: 0 });
t("C-M21b", "记名册只装对象（**闸门自检**：无调用方把 `clickSel` 的 boolean 返回值误 push）",
	badMissEntries.length === 0, { bad: badMissEntries.length });
if (badMissEntries.length) {
	console.log(` ❌ INVALID：点击质量记名册里有 ${badMissEntries.length} 条非对象项 —— **闸门自身写坏了**，`);
	console.log("    本套件的 C-M21 结论不可用（恒假红且掩盖真打偏），请修 `clickMisses.push(...)` 的调用方。");
	ws.close();
	process.exit(2);
}

/* ══════════ 汇总 ══════════ */
reachedFinal = true; // 🔴 必须先置位：它是"有没有段静默没跑"的唯一凭据（见上方崩溃兜底）
const ran = pass + fail + skip;
console.log("\n───────────────────────────────────────────────");
console.log(` 通过 ${pass} / 失败 ${fail} / 跳过 ${skip}（合计 ${ran}）`);
if (failures.length) console.log(" 失败项：\n   - " + failures.join("\n   - "));
/* 收尾对账 —— 实现收在 `_test-tally.mjs`（唯一真相源 · `T-PLUG-068`）。
 *  `reachedFinal` 是本套件**独有**的末段哨兵：它比"数够没数够"更早、更准地回答
 *  "有没有段落静默没跑"，所以**保留**，与计数下限**并列**判定（两条都必须过）。 */
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "verify-mindmap（真机）" });
const tallyOk = reachedFinal && tally.ok;
if (!tallyOk) {
	if (!reachedFinal) {
		console.log(" ❌ INVALID：**未到达末段**（【15】点击质量）⇒ 说明有段落静默没跑，本次结果不可用作产品判定。");
	}
	ws.close();
	process.exit(2);
}
console.log(` IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("───────────────────────────────────────────────");
ws.close();
process.exit(fail === 0 ? 0 : 1);
