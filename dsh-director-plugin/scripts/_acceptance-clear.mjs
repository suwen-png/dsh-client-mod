#!/usr/bin/env node
/**
 * _acceptance-clear.mjs —— 「清除所有对话消息」的**干净取证**（不建会话；会真的清空插件库内总监消息）
 *
 * 为什么单独一个脚本：整轮验收里那两张图（`07a`/`07b`）的读数**自相矛盾** ——
 * 消息数 `1 → 0`（说明清了），但 toast 与按钮都停在「再点一次」的待确认态。
 * 已定位真因：`CLEAR_ARM_MS = 3000`，而脚本在两次点击之间插了一次**整屏截图**（1~3s）
 * ⇒ 第二次点击时撤防窗口已过，**被当成第一次点击**。
 * ⇒ 本脚本把"点两次"压进 3 秒内，并且**先取全读数、后截图**（截图慢，不能插在流程中间）。
 *
 * 顺序（关键，不许调）：
 *   ① 种 3 条可数的总监消息 → 读 before
 *   ② 点 #1 → 读 armed + toast（不截图）
 *   ③ **立即**点 #2 → 读 armed + toast + `已清 x/y` + after
 *   ④ 截图「已清除」（此刻 toast 才是执行后的文案）
 *   ⑤ 再点一次 → 截图「待确认」（armed 态，最后拍，不影响任何读数）
 *
 * 用法：node scripts/_acceptance-clear.mjs [输出目录]
 */
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9222);
const OUTDIR = process.argv[2] || "logs/acceptance16";
mkdirSync(OUTDIR, { recursive: true });
const SEL = '[data-testid="dp-maint-clear"]';

let targets;
try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json(); }
catch (e) { console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）"); process.exit(2); }
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const cdpTimeouts = [];
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}, timeoutMs = 8000) => new Promise((res, rej) => {
	const id = ++seq;
	const t = setTimeout(() => { pending.delete(id); cdpTimeouts.push(method); rej(new Error("CDP 超时：" + method)); }, timeoutMs);
	pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
	ws.send(JSON.stringify({ id, method, params }));
});
const emit = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); pending.set(id, { res: () => {}, rej: () => {} }); };
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
await send("Page.enable");
const js = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	if (r.exceptionDetails) throw new Error("JS异常: " + r.exceptionDetails.text);
	return r.result && r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);

async function shot(name, note) {
	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			const r = await send("Page.captureScreenshot", { format: "png" }, 25000);
			const buf = Buffer.from(String(r.data || ""), "base64");
			if (!buf.length) throw new Error("空图");
			writeFileSync(OUTDIR + "/" + name + ".png", buf);
			console.log("  📷 " + name + ".png  (" + buf.length + " B)  " + (note || ""));
			return true;
		} catch (e) { console.log("  ⚠ 第 " + attempt + " 次截图失败：" + e.message); await sleep(600); }
	}
	return false;
}
async function clickSel(sel) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const g = await js("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return null;" +
			"var r=e.getBoundingClientRect();if(r.width<2||r.height<2)return {skip:'zero-box'};" +
			"return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
		if (!g || g.skip) return { ok: false, why: g ? g.skip : "no-el" };
		emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: g.x, y: g.y });
		emit("Input.dispatchMouseEvent", { type: "mousePressed", x: g.x, y: g.y, button: "left", clickCount: 1, buttons: 1 });
		await sleep(30);
		emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: g.x, y: g.y, button: "left", clickCount: 1, buttons: 0 });
		await sleep(120);
		const hit = await js("(function(){var e=document.elementFromPoint(" + g.x + "," + g.y + ");if(!e)return 'none';" +
			"var t=document.querySelector(" + JSON.stringify(sel) + ");return (t&&(e===t||t.contains(e)))?'self':'other:'+e.tagName;})()");
		if (hit === "self") return { ok: true, x: g.x, y: g.y };
	}
	return { ok: false, why: "落点未命中" };
}
/** 一次取全「清除」相关的所有可读状态（**分多次取会让两次点击之间的时序塌掉**） */
const clearState = async () => await js("(function(){var b=document.querySelector(" + JSON.stringify(SEL) + ");" +
	"var t=document.querySelector('[data-testid=\"dp-toast\"]');" +
	"var c=document.querySelector('[data-ok]');" +
	"return {exists:!!b, armed:b?b.getAttribute('data-armed'):null, label:b?String(b.textContent).trim():''," +
	"toast:t?String(t.textContent).trim().slice(0,120):'', clearInfo:c?(function(){var o={};for(var i=0;i<c.attributes.length;i++){var a=c.attributes[i];if(a.name.indexOf('data-')===0)o[a.name.slice(5)]=a.value;}return o;})():null};})()");

console.log("═══════════════════════════════════════════════════════════");
console.log("  清除所有对话消息 · 干净取证（两次点击压进 3 秒撤防窗口内）");
console.log("═══════════════════════════════════════════════════════════\n【A 起点】");
/* 🔴 冷启动先**等页面就绪**：本脚本连续两次 `dp-root: false`，真因不是产品也不是点击，
 *    而是 `sleep(20)` 那一刻侧栏/tab 环**还没渲染**（应用在跑更新检查）⇒
 *    "点侧栏会话 → 点总监页签"两步全部打空，且**打空的表现与"产品没挂载"完全一样**。
 *    与纪律 51 同型：起点不等到位，后面全是假红。 */
let warm = false;
for (let i = 0; i < 40; i++) {
	warm = await js("!!(document.querySelectorAll('[role=\"treeitem\"]').length || document.querySelectorAll('[role=\"tab\"]').length)");
	if (warm) { console.log("  · 页面就绪（冷启动后 " + (i + 1) + "s）"); break; }
	await sleep(1000);
}
if (!warm) console.log("  · ⚠ 40s 内侧栏与 tab 环都没出现 —— 后续必然失败，先查应用是否卡在启动态");
for (let i = 0; i < 4; i++) {
	if (!(await js("!!document.querySelector('#dsh-mindmap,#dsh-design-studio,#dsh-director-dialog')"))) break;
	await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await sleep(320);
}
let tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent).trim();})")) || [];
if (!tabRing.length) {
	const n = (await js("document.querySelectorAll('[role=\"treeitem\"]').length")) || 0;
	for (let i = 0; i < Math.min(n, 4); i++) {
		const r = await js("(function(){var e=document.querySelectorAll('[role=\"treeitem\"]')[" + i + "];if(!e)return null;var b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()");
		if (r) { emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y }); emit("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1, buttons: 1 }); await sleep(40); emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1, buttons: 0 }); await sleep(1500); }
		tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent).trim();})")) || [];
		if (tabRing.length) break;
	}
}
let rootUp = false;
for (let attempt = 0; attempt < 3 && !rootUp; attempt++) {
	const dirTab = await js("(function(){var L=[].slice.call(document.querySelectorAll('[role=\"tab\"]'));var e=L.filter(function(x){return String(x.textContent||'').trim()==='总监';})[0];if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
	if (dirTab) { emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: dirTab.x, y: dirTab.y }); emit("Input.dispatchMouseEvent", { type: "mousePressed", x: dirTab.x, y: dirTab.y, button: "left", clickCount: 1, buttons: 1 }); await sleep(40); emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: dirTab.x, y: dirTab.y, button: "left", clickCount: 1, buttons: 0 }); }
	for (let i = 0; i < 15 && !rootUp; i++) { rootUp = await js("!!document.querySelector('[data-testid=\"dp-root\"]')"); if (!rootUp) await sleep(400); }
}
console.log("  · 侧栏项 " + ((await js("document.querySelectorAll('[role=\"treeitem\"]').length")) || 0) + " 个 ｜ tab 环 " + J(tabRing));
console.log("  · dp-root：" + rootUp);
if (!rootUp) { console.error("IS_PASS: FALSE（INVALID：dp-root 未挂载）"); process.exit(2); }
/* 控制台行显形（清除按钮在 R2 行里，折叠时不在 DOM） */
for (let i = 0; i < 3; i++) {
	if (await js("(function(){var e=document.querySelector(" + JSON.stringify(SEL) + ");if(!e)return false;var r=e.getBoundingClientRect();return r.width>2&&r.height>2;})()")) break;
	const tg = await js("(function(){var e=document.querySelector('[data-testid=\"dp-r2-toggle\"]');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
	if (tg) { emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: tg.x, y: tg.y }); emit("Input.dispatchMouseEvent", { type: "mousePressed", x: tg.x, y: tg.y, button: "left", clickCount: 1, buttons: 1 }); await sleep(40); emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: tg.x, y: tg.y, button: "left", clickCount: 1, buttons: 0 }); }
	await sleep(420);
}

/* ══════════ ① 种 3 条可数的消息（**前提显式建立**：上一轮已清空，不种就测不出 3→0） ══════════ */
console.log("\n【B 前提：种 3 条总监消息】");
const seed = await js("(async function(){try{var n=(window.__dshHierarchy&&window.__dshHierarchy.GLOBAL_NODE_ID)||'__global__';" +
	"for(var i=1;i<=3;i++){await window.__dshPluginDb.appendDirectorMessage(n,{role:'user',text:'取证用第 '+i+' 条消息（可安全删除）'});}" +
	"var l=await window.__dshPluginDb.listDirectorMessages(n,200);return {ok:true,count:l.length};}catch(e){return {ok:false,why:e.message};}})()");
console.log("  · 种植结果：" + J(seed));
if (!seed || !seed.ok) { console.error("IS_PASS: FALSE（INVALID：种不进去，后续读数无意义）"); process.exit(2); }
await js("(function(){try{window.dispatchEvent(new Event('dsh-director-refresh'));return 1;}catch(e){return 0;}})()");
await sleep(400);

/* ══════════ ② 序列 1：点一次 → 截「待确认」图（截图慢，会吃掉 3 秒撤防窗口，故单列） ══════════ */
console.log("\n【C 序列 1：点一次 → 待确认态取证】");
const c1 = await clickSel(SEL);
await sleep(250);
const s1 = await clearState();
console.log("  · 点击 " + J(c1));
console.log("  · 状态 " + J(s1));
await shot("07a-clear-armed", "清除 · 待确认态（按钮变「⚠ 确认清除？」，超时自动撤防）");
/* 等撤防复位（`CLEAR_ARM_MS = 3000`）—— 序列 2 必须从 armed=0 起跑，
 * 否则第一击会直接落进"执行"分支、第二击又变成第一击（读数全错位）。 */
let armedBack = null;
for (let i = 0; i < 30; i++) { armedBack = await clearState(); if (armedBack.armed === "0") break; await sleep(400); }
console.log("  · 等撤防复位 ⇒ armed=" + (armedBack && armedBack.armed) + " ｜ toast=" + J(armedBack && armedBack.toast));

/* ══════════ ③ 序列 2：两击压进 1 秒内 → 拿真实的「已清除 3 条」 ══════════ */
console.log("\n【D 序列 2：连续两击（<3 秒，中间不截图）】");
const t1 = Date.now();
const d1 = await clickSel(SEL);
const d2 = await clickSel(SEL);
const twoClickMs = Date.now() - t1;
/* 🔴 有界等待，**不用固定 sleep**（第 4 轮修正）：产品侧顺序是
 *    `setClearArm(0)` → `clearDirectorMessages()`（IndexedDB 写）→ `refresh()` → `setClearInfo()` → `say()`，
 *    **toast 排在最后**，耗时随库大小浮动 ⇒ 固定 1500ms 是"赌"，赌输就会把正确行为报成撕裂态。
 *    （读数竞态要修读数，不是修产品 —— 纪律 31。） */
let s2 = null;
for (let i = 0; i < 40; i++) {
	s2 = await clearState();
	if (s2 && /已清除/.test(String(s2.toast || ""))) break;
	await sleep(150);
}
console.log("  · 两击耗时 " + twoClickMs + "ms（必须 < 3000ms）｜ 点击 " + J(d1) + " / " + J(d2));
console.log("  · 状态 " + J(s2));
const after = await js("(async function(){try{var n=(window.__dshHierarchy&&window.__dshHierarchy.GLOBAL_NODE_ID)||'__global__';" +
	"var l=await window.__dshPluginDb.listDirectorMessages(n,200);return l.length;}catch(e){return '__err:'+e.message;}})()");
console.log("  · 清除后实际消息数：" + after + "（种了 " + seed.count + " 条）");
const okClear = Number(after) === 0 && /已清除/.test(String(s2.toast || ""));
console.log("  · 判定：" + (okClear ? "✅ 清除执行且 toast 与读数一致" : "❌ 读数仍不一致 —— 必须继续查，不许当通过"));

/* ══════════ ④ 截图：执行后的态（toast 此刻才是「已清除 N 条」+ 宿主侧边界） ══════════ */
await shot("07b-cleared", "清除完成（toast 含清除条数与宿主侧边界说明）");

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  CDP 超时：" + cdpTimeouts.length);
console.log("  IS_PASS: " + (okClear && cdpTimeouts.length === 0 ? "TRUE" : "FALSE"));
ws.close();
process.exit(okClear && cdpTimeouts.length === 0 ? 0 : 1);
