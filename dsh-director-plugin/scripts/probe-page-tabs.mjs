#!/usr/bin/env node
/**
 * `probe-page-tabs.mjs` —— **只读**取证探针：宿主页签环到底有几套、「总监」为什么尺寸为 0
 *
 * 背景（第四十一轮 · 批 #3 `logs/_r41l-ns.out`）：
 *   `ensureDirectorPage` 第④段「点总监」**每一轮都**回报
 *   `{"ok":false,"why":"尺寸为 0"}`，而 `ringOf()` 又能读到
 *   `["总监","对话","轨迹","关键文件","产出物"]`（5 个，批起点时只有 3 个）
 *   ⇒ `clickByText` 取的是 `.filter(text==="总监")[0]`（**候选集第一个**），
 *     若第一个匹配落在**隐藏的那套**上，就会「环读得到、点不下去」。
 *
 * 本探针**只读**（不派发任何鼠标/键盘事件、不改 DOM），用来把下列问题一次问清：
 *   ① `[role="tab"]` 共几个？每套分别是什么、各自 rect 多少？
 *   ② 5 个环是「同一套的 5 个」还是「两套拼起来的」？
 *   ③ `dp-root` 的盒是多少？宿主窗口/视口多大？
 *   ④ 当前 `aria-selected=true` 的是哪一个、它可见吗？
 *
 * 用法：`node logs/probe-page-tabs.mjs [标签]`
 */
import { PORT } from "./cdp-port.mjs";
import { waitCdpPage } from "./_cdp-startup.mjs";

const TAG = process.argv[2] || "probe";

const T = await waitCdpPage({ port: PORT, log: () => {} });
if (!T.ok || !T.page) { console.log("[probe] 环境不可用：" + (T.reason || "连不上 " + PORT)); process.exit(2); }

const ws = new WebSocket(T.page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id);
		pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	const timer = setTimeout(() => { pending.delete(id); rej(new Error("EVAL_TIMEOUT")); }, 12000);
	pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (x) => { clearTimeout(timer); rej(x); } });
	ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
try { await send("Runtime.enable"); } catch (e) { /* 未确认不影响 */ }

async function js(expr) {
	try {
		const o = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
		if (o && o.exceptionDetails) return { __exc: String(o.exceptionDetails.text || "exception") };
		return o ? (o.result ? o.result.value : null) : null;
	} catch (e) { return null; }
}

/* ── 读一：视口 + dp-root ─────────────────────────────────────────── */
const ENV = "(function(){var r=document.querySelector('[data-testid=\"dp-root\"]');"
	+ "var b=r?r.getBoundingClientRect():null;"
	+ "return JSON.stringify({vw:window.innerWidth,vh:window.innerHeight,"
	+ "dpr:window.devicePixelRatio,vis:document.visibilityState,"
	+ "root:r?{w:Math.round(b.width),h:Math.round(b.height),x:Math.round(b.x),y:Math.round(b.y)}:null,"
	+ "bodyDisp:getComputedStyle(document.body).display});})()";
console.log("[" + TAG + "] 环境 = " + String(await js(ENV)));

/* ── 读二：全部 [role=tab]，逐项带**可见性证据** ───────────────────── */
const TABS = "(function(){var L=[].slice.call(document.querySelectorAll('[role=\"tab\"]'));"
	+ "return JSON.stringify(L.map(function(e,i){"
	+ "var b=e.getBoundingClientRect();var cs=getComputedStyle(e);"
	+ "var par=e.parentElement;var pcs=par?getComputedStyle(par):null;"
	+ "return {i:i,t:String(e.textContent||'').trim(),"
	+ "w:Math.round(b.width),h:Math.round(b.height),x:Math.round(b.x),y:Math.round(b.y),"
	+ "sel:e.getAttribute('aria-selected'),"
	+ "disp:cs.display,vis:cs.visibility,op:cs.opacity,"
	+ "offsetParentNull:e.offsetParent===null,"
	+ "parent:par?String(par.tagName)+'.'+String(par.className||'').slice(0,28):null,"
	+ "pdisp:pcs?pcs.display:null,pvis:pcs?pcs.visibility:null,"
	+ "hidAnc:!!e.closest('[hidden],[aria-hidden=\"true\"]')};}));})()";
const tabsRaw = await js(TABS);
let tabs = [];
try { tabs = JSON.parse(String(tabsRaw)); } catch (e) { tabs = []; }
console.log("[" + TAG + "] [role=tab] 共 " + tabs.length + " 个：");
for (const t of tabs) {
	console.log("   #" + String(t.i).padStart(2) + " 「" + t.t + "」 " + t.w + "x" + t.h
		+ " @" + t.x + "," + t.y
		+ " ｜ sel=" + t.sel
		+ " ｜ disp=" + t.disp + " vis=" + t.vis + " op=" + t.op
		+ " ｜ offsetParentNull=" + t.offsetParentNull
		+ " ｜ parent=" + t.parent + "(disp=" + t.pdisp + ",vis=" + t.pvis + ")"
		+ " ｜ hidAnc=" + t.hidAnc);
}

/* ── 读三：「总监」的**全部候选**，以及命中函数的实际行为复刻 ───────── */
const PICK = "(function(){var L=[].slice.call(document.querySelectorAll('[role=\"tab\"]'));"
	+ "var m=L.filter(function(x){return String(x.textContent||'').trim()==='总监';});"
	+ "return JSON.stringify({n:L.length,hit:m.length,"
	+ "pick0:m.length?(function(){var b=m[0].getBoundingClientRect();"
	+ "return {w:Math.round(b.width),h:Math.round(b.height)};})():null,"
	+ "visiblePick:m.map(function(x){var b=x.getBoundingClientRect();"
	+ "return (b.width>=2&&b.height>=2)?{w:Math.round(b.width),h:Math.round(b.height)}:null;})});})()";
console.log("[" + TAG + "] 「总监」候选 = " + String(await js(PICK)));

/* ── 读四：可见 tab 分组（按 parent 归类）─────────────────────────── */
const GROUPS = "(function(){var L=[].slice.call(document.querySelectorAll('[role=\"tab\"]'));"
	+ "var g={};L.forEach(function(e){var b=e.getBoundingClientRect();"
	+ "var k=String(e.parentElement?e.parentElement.className:'(no-parent)').slice(0,32);"
	+ "g[k]=g[k]||{n:0,visN:0,texts:[]};g[k].n++;"
	+ "if(b.width>=2&&b.height>=2)g[k].visN++;g[k].texts.push(String(e.textContent||'').trim());});"
	+ "return JSON.stringify(g);})()";
console.log("[" + TAG + "] 按 parent 分组 = " + String(await js(GROUPS)));

/* ── 读五：**祖先链**（从「总监」tab 一路到 body）—— 定位"是哪一层把内容藏起来的" ── */
const CHAIN = "(function(){var L=[].slice.call(document.querySelectorAll('[role=\"tab\"]'));"
	+ "var e=L.filter(function(x){return String(x.textContent||'').trim()==='总监';})[0];"
	+ "if(!e)return 'no-tab';var out=[];var c=e;var n=0;"
	+ "while(c&&n<14){var b=c.getBoundingClientRect();var cs=getComputedStyle(c);"
	+ "out.push({tag:c.tagName,id:String(c.id||''),cls:String(c.className||'').slice(0,38),"
	+ "disp:cs.display,vis:cs.visibility,hid:c.hasAttribute('hidden'),ah:c.getAttribute('aria-hidden'),"
	+ "w:Math.round(b.width),h:Math.round(b.height),inline:String(c.style.display||'')});"
	+ "c=c.parentElement;n++;}return JSON.stringify(out);})()";
const chainRaw = await js(CHAIN);
let chain = [];
try { chain = JSON.parse(String(chainRaw)); } catch (e) { chain = []; }
console.log("[" + TAG + "] 「总监」的祖先链（自下而上，" + chain.length + " 层）：");
for (let i = 0; i < chain.length; i++) {
	const c = chain[i];
	console.log("   " + (i === 0 ? "▪" : "↑") + " <" + c.tag + (c.id ? "#" + c.id : "") + ">"
		+ (c.cls ? "." + c.cls : "") + "  " + c.w + "x" + c.h
		+ " ｜ disp=" + c.disp + " vis=" + c.vis
		+ " ｜ hidden=" + c.hid + " aria-hidden=" + c.ah
		+ (c.inline ? " ｜ inline display=" + c.inline : ""));
}

/* ── 读六：body 直下各顶层容器（谁大谁就是用户当前真正看到的东西）──────── */
const TOP = "(function(){var out=[];[].slice.call(document.body.children).forEach(function(c){"
	+ "var b=c.getBoundingClientRect();"
	+ "out.push({tag:c.tagName,id:String(c.id||''),cls:String(c.className||'').slice(0,38),"
	+ "w:Math.round(b.width),h:Math.round(b.height),disp:getComputedStyle(c).display,"
	+ "kids:c.children.length});});return JSON.stringify(out);})()";
console.log("[" + TAG + "] body 直下顶层容器 = " + String(await js(TOP)));

/* ── 读七：页面上**面积最大**的元素们（= 用户此刻实际看到的界面）──────── */
const BIG = "(function(){var all=[].slice.call(document.querySelectorAll('body *'));"
	+ "var vis=all.filter(function(e){var b=e.getBoundingClientRect();return b.width>260&&b.height>180;});"
	+ "return JSON.stringify(vis.slice(0,10).map(function(e){var b=e.getBoundingClientRect();"
	+ "return {tag:e.tagName,id:String(e.id||''),cls:String(e.className||'').slice(0,34),"
	+ "w:Math.round(b.width),h:Math.round(b.height),txt:String(e.textContent||'').trim().slice(0,40)};}));})()";
console.log("[" + TAG + "] 面积最大的可见元素 = " + String(await js(BIG)));

/* ── 读八：「关键文件」那个 tab 属于谁（它和「总监」不同组，parent 无名）── */
const CHAIN2 = "(function(){var L=[].slice.call(document.querySelectorAll('[role=\"tab\"]'));"
	+ "var e=L.filter(function(x){return String(x.textContent||'').trim()==='关键文件';})[0];"
	+ "if(!e)return 'no-tab';var out=[];var c=e;var n=0;"
	+ "while(c&&n<12){var b=c.getBoundingClientRect();var cs=getComputedStyle(c);"
	+ "out.push({tag:c.tagName,id:String(c.id||''),cls:String(c.className||'').slice(0,38),"
	+ "disp:cs.display,hid:c.hasAttribute('hidden'),w:Math.round(b.width),h:Math.round(b.height)});"
	+ "c=c.parentElement;n++;}return JSON.stringify(out);})()";
const chain2Raw = await js(CHAIN2);
let chain2 = [];
try { chain2 = JSON.parse(String(chain2Raw)); } catch (e) { chain2 = []; }
console.log("[" + TAG + "] 「关键文件」的祖先链（" + chain2.length + " 层）：");
for (let i = 0; i < chain2.length; i++) {
	const c = chain2[i];
	console.log("   " + (i === 0 ? "▪" : "↑") + " <" + c.tag + (c.id ? "#" + c.id : "") + ">"
		+ (c.cls ? "." + c.cls : "") + "  " + c.w + "x" + c.h
		+ " ｜ disp=" + c.disp + " hidden=" + c.hid);
}

/* ── 读九：`hcc-launcher`（另一插件 hermes-command-center 的启动条）现状 ── */
const HCC = "(function(){var e=document.getElementById('hcc-launcher');if(!e)return 'absent';"
	+ "var b=e.getBoundingClientRect();var cs=getComputedStyle(e);"
	+ "return JSON.stringify({w:Math.round(b.width),h:Math.round(b.height),x:Math.round(b.x),y:Math.round(b.y),"
	+ "disp:cs.display,vis:cs.visibility,z:cs.zIndex,pe:cs.pointerEvents,"
	+ "html:String(e.outerHTML||'').slice(0,300)});})()";
console.log("[" + TAG + "] hcc-launcher = " + String(await js(HCC)));

/* ── 读十：`centerSurface` 的 hidden 是不是**唯一**一处被隐藏的中心容器 ── */
const ALLC = "(function(){var L=[].slice.call(document.querySelectorAll('[class*=\"centerSurface\"],[class*=\"centerCol\"]'));"
	+ "return JSON.stringify(L.map(function(e){var b=e.getBoundingClientRect();"
	+ "return {cls:String(e.className||'').slice(0,44),w:Math.round(b.width),h:Math.round(b.height),"
	+ "hid:e.hasAttribute('hidden'),disp:getComputedStyle(e).display};}));})()";
console.log("[" + TAG + "] 中心容器们 = " + String(await js(ALLC)));

try { ws.close(); } catch (e) { /* ignore */ }
process.exit(0);
