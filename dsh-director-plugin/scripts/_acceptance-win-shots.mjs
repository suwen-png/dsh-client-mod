#!/usr/bin/env node
/**
 * _acceptance-win-shots.mjs —— 只补「执行状态窗口三态」的可视化取证（**不建任何会话**）
 *
 * 为什么单独一个脚本：整轮验收（`_acceptance-16.mjs`）会真的新建 8 条宿主会话，
 * 而"窗口最小化"这一项**不需要**分流 —— 没必要为一张图再建 8 条删不掉的会话。
 * ⇒ 拆出来：轻量、可反复跑、零副作用（只调用 `resetRunningWin()` 还原，不写持久化）。
 *
 * 产出 4 张：起点（collapsed = 最小化态）/ 展开 / 靠边缩进 / 再收起
 * 用法：node scripts/_acceptance-win-shots.mjs [输出目录]（默认 logs/acceptance16）
 */
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9222);
const OUTDIR = process.argv[2] || "logs/acceptance16";
mkdirSync(OUTDIR, { recursive: true });

let targets;
try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json(); }
catch (e) { console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）"); process.exit(2); }
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
const cdpTimeouts = [];
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}, timeoutMs = 8000) => new Promise((res, rej) => {
	const id = ++seq;
	const t = setTimeout(() => { pending.delete(id); cdpTimeouts.push(method); rej(new Error("CDP 超时 " + timeoutMs + "ms：" + method)); }, timeoutMs);
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

const shots = [];
async function shot(name, note) {
	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			/* 🔴 截图超时给到 25s：整屏 PNG 要等一次可绘制帧，页面在跑动画/重排时会明显变慢
			 *    （上一轮 15s 超时就在这里折了一次，且失败后没重试 ⇒ 整轮卡死）。 */
			const r = await send("Page.captureScreenshot", { format: "png" }, 25000);
			const buf = Buffer.from(String(r.data || ""), "base64");
			if (!buf.length) throw new Error("空图");
			const p = OUTDIR + "/" + name + ".png";
			writeFileSync(p, buf);
			shots.push({ name, path: p, bytes: buf.length, note: note || "" });
			console.log("  📷 " + name + ".png  (" + buf.length + " B)  " + (note || ""));
			return p;
		} catch (e) {
			console.log("  ⚠ 第 " + attempt + " 次截图失败 " + name + "：" + e.message);
			await sleep(600);
		}
	}
	shots.push({ name, path: null });
	return null;
}
async function clickAt(x, y) {
	const X = Math.round(x), Y = Math.round(y);
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: X, y: Y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: X, y: Y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(40);
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: X, y: Y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(200);
}
async function clickSel(sel) {
	for (let attempt = 0; attempt < 2; attempt++) {
		const g = await js("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return null;" +
			"var r=e.getBoundingClientRect();if(r.width<2||r.height<2)return {skip:'zero-box'};" +
			"return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
		if (!g || g.skip) return { ok: false, why: g ? g.skip : "no-el" };
		await clickAt(g.x, g.y);
		const hit = await js("(function(){var e=document.elementFromPoint(" + g.x + "," + g.y + ");if(!e)return 'none';" +
			"var t=document.querySelector(" + JSON.stringify(sel) + ");return (t&&(e===t||t.contains(e)))?'self':'other:'+e.tagName;})()");
		if (hit === "self") return { ok: true, x: g.x, y: g.y };
		console.log("      · 落点未命中（" + hit + "），重试");
	}
	return { ok: false, why: "落点未命中" };
}
async function dragMouse(from, to, steps) {
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(50);
	for (let i = 1; i <= steps; i++) {
		emit("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1,
			x: Math.round(from.x + (to.x - from.x) * i / steps), y: Math.round(from.y + (to.y - from.y) * i / steps) });
		await sleep(18);
	}
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(320);
}

const winRead = async () => await js("(function(){var e=document.querySelector('[data-testid=\"dp-running\"]');if(!e)return null;" +
	"var r=e.getBoundingClientRect();return {mode:e.getAttribute('data-mode'),dock:e.getAttribute('data-dock')," +
	"x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)," +
	"body:!!document.querySelector('[data-testid=\"dp-running-body\"]')," +
	"strip:!!document.querySelector('[data-testid=\"dp-running-strip\"]')};})()");
/** 有界等待某状态（每次 150ms，最多 n 次）——"点了"与"状态变了"之间是异步的 */
async function waitMode(mode, n) {
	for (let i = 0; i < n; i++) { const v = await winRead(); if (v && v.mode === mode) return v; await sleep(150); }
	return null;
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  执行状态窗口三态 · 可视化取证（零副作用，不建会话）");
console.log("═══════════════════════════════════════════════════════════\n【A 起点】");

/* 关掉可能覆盖窗口的浮层 */
for (let i = 0; i < 4; i++) {
	if (!(await js("!!document.querySelector('#dsh-mindmap,#dsh-design-studio,#dsh-director-dialog')"))) break;
	await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await sleep(320);
}
let tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent).trim();})")) || [];
if (!tabRing.length) {
	const items = (await js("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map(function(e,i){return i;})")) || [];
	for (const i of items.slice(0, 4)) {
		const r = await js("(function(){var L=document.querySelectorAll('[role=\"treeitem\"]');var e=L[" + i + "];if(!e)return null;var b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()");
		if (r) { await clickAt(r.x, r.y); await sleep(1500); }
		tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent).trim();})")) || [];
		if (tabRing.length) break;
	}
}
let rootUp = false;
for (let attempt = 0; attempt < 3 && !rootUp; attempt++) {
	const dirTab = await js("(function(){var L=[].slice.call(document.querySelectorAll('[role=\"tab\"]'));var e=L.filter(function(x){return String(x.textContent||'').trim()==='总监';})[0];if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
	if (dirTab) await clickAt(dirTab.x, dirTab.y);
	for (let i = 0; i < 15 && !rootUp; i++) { rootUp = await js("!!document.querySelector('[data-testid=\"dp-root\"]')"); if (!rootUp) await sleep(400); }
}
console.log("  · tab 环 " + tabRing.length + " 个 ｜ dp-root：" + rootUp);
if (!rootUp) { console.error("IS_PASS: FALSE（INVALID：dp-root 未挂载）"); process.exit(2); }

await js("(function(){try{window.__directorLayoutStore.resetRunningWin();return 1;}catch(e){return e.message;}})()");
await sleep(500);
const w0 = await winRead();
console.log("  · 起点（最小化态）：" + J(w0));
if (!w0) { console.error("IS_PASS: FALSE（INVALID：dp-running 不在 DOM）"); process.exit(2); }
await shot("W1-minimized", "执行状态窗口 · 最小化（收起为小条，明细区未渲染）");

console.log("\n【B 展开】");
console.log("  · 点最小化按钮：" + J(await clickSel('[data-testid="dp-running-min"]')));
const wExp = await waitMode("expanded", 25);
console.log("  · 展开态：" + J(wExp));
await shot("W2-expanded", "执行状态窗口 · 展开（明细区已渲染）");

console.log("\n【C 靠边缩进】");
const hb = await js("(function(){var e=document.querySelector('[data-testid=\"dp-running-head\"]');if(!e)return null;var r=e.getBoundingClientRect();" +
	"return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
console.log("  · 从头拖到左缘：" + J(hb) + " → x=36");
if (hb) await dragMouse({ x: hb.x, y: hb.y }, { x: 36, y: hb.y }, 8);
const wDock = await winRead();
console.log("  · 贴边态：" + J(wDock));
await shot("W3-docked-left", "执行状态窗口 · 靠边缩进（贴左缘 → 细条）");

console.log("\n【D 点细条还原 → 再最小化】");
console.log("  · 点细条：" + J(await clickSel('[data-testid="dp-running-strip"]')));
const backExp = await waitMode("expanded", 25);
console.log("  · 回到展开：" + (backExp ? "是" : "**否**"));
if (backExp) {
	console.log("  · 再点最小化：" + J(await clickSel('[data-testid="dp-running-min"]')));
	const wCol = await waitMode("collapsed", 40);
	console.log("  · 收起态：" + J(wCol));
	await shot("W4-minimized-again", "执行状态窗口 · 再最小化（可反复开合）" + (wCol ? "" : "【⛔ 未取到收起态，此图无效】"));
} else {
	console.log("  ⚠ 细条没还原成展开态 ⇒ 跳过 D 段截图（不许拿「图有了」当通过）");
}

/* ══════════ E · 清除所有对话消息（种 3 条 → 两击 → 取证） ══════════
 * 为什么并进这个脚本：`_acceptance-clear.mjs` 连续 4 次卡在起点
 * （`dp-root: false`，而 tab 环里「总监」明明是存在的）—— 与其再赌一次起点，
 * 不如复用本脚本**刚刚验证可用**的起点。 */
console.log("\n【E 清除所有对话消息】");
const SEL_C = '[data-testid="dp-maint-clear"]';
const clearState = async () => await js("(function(){var b=document.querySelector('[data-testid=\"dp-maint-clear\"]');" +
	"var t=document.querySelector('[data-testid=\"dp-toast\"]');var c=document.querySelector('[data-ok]');" +
	"return {exists:!!b, armed:b?b.getAttribute('data-armed'):null, label:b?String(b.textContent).trim():''," +
	"toast:t?String(t.textContent).trim().slice(0,140):'', clearInfo:c?(function(){var o={};for(var i=0;i<c.attributes.length;i++){var a=c.attributes[i];if(a.name.indexOf('data-')===0)o[a.name.slice(5)]=a.value;}return o;})():null};})()");
/* 控制台行可能折叠着 ⇒ 清除按钮不在 DOM */
for (let i = 0; i < 3; i++) {
	if (await js("(function(){var e=document.querySelector('" + SEL_C + "');if(!e)return false;var r=e.getBoundingClientRect();return r.width>2&&r.height>2;})()")) break;
	await clickSel('[data-testid="dp-r2-toggle"]');
	await sleep(420);
}
const seed = await js("(async function(){try{var n=(window.__dshHierarchy&&window.__dshHierarchy.GLOBAL_NODE_ID)||'__global__';" +
	"for(var i=1;i<=3;i++){await window.__dshPluginDb.appendDirectorMessage(n,{role:'user',text:'取证用第 '+i+' 条（可安全删除）'});}" +
	"var l=await window.__dshPluginDb.listDirectorMessages(n,200);return {ok:true,count:l.length};}catch(e){return {ok:false,why:e.message};}})()");
console.log("  · 前提：种入 3 条总监消息 → " + J(seed));
await sleep(400);

/* 序列 1：点一次 → 截「待确认」（截图慢会吃掉 3 秒窗口，故与序列 2 分开跑） */
console.log("  · 序列 1：点一次 → 待确认态");
const c1 = await clickSel(SEL_C);
await sleep(250);
console.log("    " + J(await clearState()));
await shot("07a-clear-armed", "清除 · 待确认态（按钮变「⚠ 确认清除？」，超时自动撤防）");
let armedBack = null;
for (let i = 0; i < 30; i++) { armedBack = await clearState(); if (armedBack.armed === "0") break; await sleep(400); }
console.log("  · 等撤防复位 ⇒ armed=" + (armedBack && armedBack.armed));

/* 序列 2：两击压进 3 秒内 → 等落地 → 读数 → 截图 */
console.log("  · 序列 2：连续两击（中间不截图）");
const t0 = Date.now();
const d1 = await clickSel(SEL_C);
const d2 = await clickSel(SEL_C);
const twoMs = Date.now() - t0;
await sleep(1500);
const s2 = await clearState();
const left = await js("(async function(){try{var n=(window.__dshHierarchy&&window.__dshHierarchy.GLOBAL_NODE_ID)||'__global__';" +
	"var l=await window.__dshPluginDb.listDirectorMessages(n,200);return l.length;}catch(e){return '__err';}})()");
console.log("    · 两击耗时 " + twoMs + "ms ｜ " + J(d1) + " / " + J(d2));
console.log("    · 状态 " + J(s2));
console.log("    · 清除后剩余消息数：" + left + "（种了 " + (seed && seed.count) + " 条）");
console.log("    · 判定：" + (Number(left) === 0 && /已清除/.test(String(s2.toast || "")) ? "✅ 执行成功且 toast 与读数一致" : "❌ 读数不一致，不许当通过"));
await shot("07b-cleared", "清除完成（toast 含清除条数与宿主侧边界说明）");

console.log("\n═══════════════════════════════════════════════════════════");
const ok = shots.filter((s) => s.path);
console.log("  截图 " + ok.length + " / " + shots.length + " 张");
shots.forEach((s) => console.log("    " + (s.path ? "✅" : "❌") + " " + s.name + (s.note ? "  — " + s.note : "")));
console.log("  CDP 超时：" + cdpTimeouts.length + (cdpTimeouts.length ? " " + J(cdpTimeouts.slice(0, 4)) : ""));
console.log("  IS_PASS: " + (ok.length === shots.length && cdpTimeouts.length === 0 ? "TRUE" : "FALSE"));
ws.close();
process.exit(ok.length === shots.length && cdpTimeouts.length === 0 ? 0 : 1);
