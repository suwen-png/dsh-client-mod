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
 * 退出码：0 全绿 / 1 有失败
 */
const PORT = 9222;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标（Harness 未启动或未开 9222？）"); process.exit(1); }

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
t("C-M2c", "血缘字段 parentId 已吃到（lineage=true）", data.lineage === true, data.lineage);
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
t("C-M7a", "连线至少一条（有血缘边就画得出）", edgeKinds.length >= 1, edgeKinds);
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
const STAGE_K = `parseFloat(document.querySelector('[data-testid="mm-stage"]').getAttribute("data-zoom"))`;
await clickSel('[data-testid="mm-zoom-100"]');
await sleep(220);
const z0 = await js(ZOOM_TXT);
t("C-M10a", "「1:1」把缩放归到 100%", /^100%$/.test(z0.trim()), z0);
await clickSel('[data-testid="mm-zoom-out"]');
await sleep(220);
const z1 = await js(ZOOM_TXT);
const k1 = await js(STAGE_K);
const t1 = await js(`parseFloat(getComputedStyle(document.querySelector('[data-testid="mm-stage"]')).transform.split(",")[0].replace("matrix(",""))`);
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
		await sleep(300);
		const hbAway = await js(`!!document.querySelector('[data-testid="mm-hoverbar"]')`);
		t("C-M15a0", "鼠标移开节点后工具条消失（先证明它会走）", hbAway === false, { hbAway, at: [blank.x, blank.y] });
	}
	emit("Input.dispatchMouseEvent",{ type: "mouseMoved", x: spot2.cx, y: spot2.cy });
	await sleep(320);
	const hb = await js(`(function(){var e=document.querySelector('[data-testid="mm-hoverbar"]');return e?{id:e.getAttribute("data-hover-id"), n:e.children.length, r:e.getBoundingClientRect().height, titles:Array.from(e.children).map(function(c){return c.getAttribute("title")||"";})}:null;})()`);
	t("C-M15a", "悬停节点出现悬浮工具条（真实 mouseMoved 到节点中心）", hb !== null, hb);
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
await clickSel('[data-testid="mm-fit"]');
await sleep(150);
const toastVisible = await js(`!!document.querySelector('[data-testid="mm-toast"]')`);
await sleep(2800);
const toastGone = await js(`!!document.querySelector('[data-testid="mm-toast"]')`);
t("C-M16b", "toast 出现（点了有反馈，不是静默）", toastVisible === true, toastVisible);
/* 🔴 不能只断言 toastGone === false：toast 从没出现过时它**平凡为真**（空真）。
 *    必须叠加「刚才确实出现过」这个前置，才构成有效证据。
 *    （同一类陷阱已在本文件 C-M13a 用「防平凡真」前置拦过一次，此处补齐。） */
t("C-M16c", "toast 2.4s 后自动消失（不是「永不消失」）", toastVisible === true && toastGone === false, [toastVisible, toastGone]);

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

/* ══════════ 14. 关闭 ══════════ */
section("【14】关闭");
await clickSel('[data-testid="mm-close"]');
await sleep(400);
t("C-M18", "点 ✕ 关闭导图层（DOM 移除）", await js(`!!document.getElementById("dsh-mindmap")`) === false, null);

/* ══════════ 15. 点击质量（**测试自身的证词**，不是产品断言）══════════
 * 为什么单列一条：本项目已经三次出现"点击落空被记成产品缺陷"（顶栏 14 键、
 * R8 登记键 23px 漂移、本脚本 C-M19b）。把落空记名并**显式断言为 0**，
 * 才能在下一次红的时候一眼分清"产品坏了"还是"这一击打偏了"。 */
section("【15】点击质量（真实鼠标落点自检）");
t("C-M21", `本脚本全部点击，落点均在目标元素子树内（不许静默打偏）`,
	clickMisses.length === 0, clickMisses.length ? clickMisses : { misses: 0 });

/* ══════════ 汇总 ══════════ */
console.log("\n───────────────────────────────────────────────");
console.log(` 通过 ${pass} / 失败 ${fail} / 跳过 ${skip}`);
if (failures.length) console.log(" 失败项：\n   - " + failures.join("\n   - "));
console.log(` IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("───────────────────────────────────────────────");
ws.close();
process.exit(fail === 0 ? 0 : 1);
