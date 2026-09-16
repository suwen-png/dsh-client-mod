#!/usr/bin/env node
/**
 * _acceptance-16.mjs —— 第 16 批**可视化验收取证**（只读 + 截图，不改产品）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它（本轮的直接教训）
 * ──────────────────────────────────────────────────────────────────
 * 上一轮我把用户的四条要求全部做成了「闸门转绿」，`verify-novel-split` 67/67、
 * `cdp-click` 74/74 —— 但**用户一张图都没看到**，也没法验收。
 * 闸门断言证明的是「点了会变」，证明不了「用户看得出来」。二者不能互相替代。
 * ⇒ 本脚本的产出**不是** PASS/FAIL，而是 7 张 PNG + 每张的现场读数。
 *
 * ──────────────────────────────────────────────────────────────────
 * 覆盖用户原话（逐条）
 * ──────────────────────────────────────────────────────────────────
 *  「执行状态的窗口需要可以移动最小化,靠边缩进」      → W 段 3 张（展开 / 贴左 / 收起）
 *  「按照一个流程跑一遍 写小说吧,调用小说技能」        → B 段（真实需求文本 → 8 条分支 + 简报）
 *  「然后按照世界观剧情等应该自动分到不同的对话分支」  → B 段读数（made/failed/dims）
 *  「然后思维导图应该能看出来」                        → C 段 1 张（导图上 8 个 A1–A8 框）
 *  「清除所有的对话消息」                              → D 段 2 张（待确认 → 已清除 + 读数）
 *
 * ⚠️ 会发生什么：**真的新建 8 条宿主会话**（宿主 `sessions` 无删除契约 ⇒ 删不掉），
 *    并**真的清空**插件库内总监对话消息（这是需求本身）。仅作验收，不要连跑。
 *
 * 用法：node scripts/_acceptance-16.mjs [输出目录]（默认 logs/acceptance16）
 * 退出码：0 = 7 张图齐 + 无 CDP 超时；1 = 有图缺失；2 = INVALID（连不上 / 读数为空）
 */
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9222);
const OUTDIR = process.argv[2] || "logs/acceptance16";
mkdirSync(OUTDIR, { recursive: true });

let targets;
try {
	targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）—— Harness 启动与测试必须写在同一条 bash 命令里（纪律 50）。");
	process.exit(2);
}
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
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const emit = (method, params = {}) => {
	const id = ++seq;
	ws.send(JSON.stringify({ id, method, params }));
	const timer = setTimeout(() => { cdpTimeouts.push(method + "#" + id); }, 8000);
	pending.set(id, { res: () => clearTimeout(timer), rej: () => clearTimeout(timer) });
};
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

/** 截图（独立超时 15s：整屏 PNG 比普通 evaluate 慢） */
const shots = [];
async function shot(name, note) {
	try {
		const r = await new Promise((res, rej) => {
			const id = ++seq;
			const t = setTimeout(() => rej(new Error("截图超时")), 15000);
			pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
			ws.send(JSON.stringify({ id, method: "Page.captureScreenshot", params: { format: "png" } }));
		});
		const buf = Buffer.from(String(r.data || ""), "base64");
		if (!buf.length) throw new Error("空图");
		const p = OUTDIR + "/" + name + ".png";
		writeFileSync(p, buf);
		shots.push({ name, path: p, bytes: buf.length, note: note || "" });
		console.log("  📷 " + name + ".png  (" + buf.length + " B)  " + (note || ""));
		return p;
	} catch (e) {
		console.log("  ⚠ 截图失败 " + name + "：" + e.message);
		shots.push({ name, path: null, error: e.message });
		return null;
	}
}

async function clickAt(x, y) {
	const X = Math.round(x), Y = Math.round(y);
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: X, y: Y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: X, y: Y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(40);
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: X, y: Y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(200);
}
/** 真实鼠标点选择器（落点自检：命中自己才算点到；打偏记名，不当作产品缺陷） */
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
	}
	return { ok: false, why: "落点未命中" };
}
async function dragMouse(from, to, steps, onStep) {
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(50);
	for (let i = 1; i <= steps; i++) {
		emit("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1,
			x: Math.round(from.x + (to.x - from.x) * i / steps), y: Math.round(from.y + (to.y - from.y) * i / steps) });
		await sleep(18);
		if (onStep) { const s = await onStep(i); if (s) console.log("      · 拖动中 " + i + "/" + steps + "：" + J(s)); }
	}
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(320);
}

const NOVEL_REQ = "帮我写一个小说《灵能修仙》：先搭世界观与力量体系，再做剧情和人物，然后写正文、打磨、做一致性审查，最后蒸馏记忆";
const DIM_LABELS = ["A1 世界观", "A2 力量体系", "A3 剧情", "A4 人物", "A5 正文", "A6 打磨", "A7 审查", "A8 蒸馏"];

console.log("═══════════════════════════════════════════════════════════");
console.log("  第 16 批可视化验收取证（产出 7 张 PNG，不做 PASS/FAIL 判定）");
console.log("═══════════════════════════════════════════════════════════");

/* ══════════ A · 起点：把总监页真的立起来（纪律 30：只认 dp-root） ══════════ */
console.log("\n【A 起点】");
for (let i = 0; i < 4; i++) {
	const anyOverlay = await js("!!document.querySelector('#dsh-mindmap,#dsh-design-studio,#dsh-director-dialog')");
	if (!anyOverlay) break;
	await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await sleep(320);
}
let tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent).trim();})")) || [];
if (!tabRing.length) {
	console.log("  · 无 tab 环（欢迎页）⇒ 点一个侧栏会话把会话视图打开");
	let items = (await js("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map(function(e,i){return {i:i,t:String(e.textContent||'').trim().slice(0,26)};})")) || [];
	for (const c of items.slice(0, 4)) {
		const r = await js("(function(){var L=document.querySelectorAll('[role=\"treeitem\"]');var e=L[" + c.i + "];if(!e)return null;var b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()");
		if (r) { await clickAt(r.x, r.y); await sleep(1500); }
		tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent).trim();})")) || [];
		if (tabRing.length) break;
	}
}
/* 🔴 点页签 → `dp-root` **必须轮询等待**，不能 `sleep(900)` 后一次性读：
 *    第二次真机跑就栽在这里 —— tab 环 3 个、页签点了，但 `dp-root` 还没挂上，
 *    脚本直接判 INVALID 退出，**前 3 张图全没出**。
 *    "点了" 与 "挂载完成" 之间是异步的（宿主重挂对话区 + 插件 boot 装载）。 */
let rootUp = false;
for (let attempt = 0; attempt < 3 && !rootUp; attempt++) {
	const dirTab = await js("(function(){var L=[].slice.call(document.querySelectorAll('[role=\"tab\"]'));var e=L.filter(function(x){return String(x.textContent||'').trim()==='总监';})[0];if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
	if (dirTab) await clickAt(dirTab.x, dirTab.y);
	for (let i = 0; i < 15 && !rootUp; i++) {
		rootUp = await js("!!document.querySelector('[data-testid=\"dp-root\"]')");
		if (!rootUp) await sleep(400);
	}
	console.log("  · 第 " + (attempt + 1) + " 次点「总监」页签（落点 " + J(dirTab) + "）⇒ dp-root " + rootUp);
}
console.log("  · tab 环 " + tabRing.length + " 个 ｜ dp-root 在 DOM：" + rootUp);
if (!rootUp) { console.error("IS_PASS: FALSE（INVALID：dp-root 未挂载，后续截图无意义）"); process.exit(2); }

/* 控制台行显形（折叠时按钮不在 DOM ⇒ 分流点不到） */
for (let i = 0; i < 3; i++) {
	const vis = await js("(function(){var e=document.querySelector('[data-testid=\"dp-act-split\"]');if(!e)return false;var r=e.getBoundingClientRect();return r.width>2&&r.height>2;})()");
	if (vis) break;
	await clickSel('[data-testid="dp-r2-toggle"]');
	await sleep(420);
}
await shot("01-director-start", "总监页起点（分流前）");

/* ══════════ B · 真跑一遍「写小说」→ 按维度自动分流 ══════════ */
console.log("\n【B 分流】用户需求：" + NOVEL_REQ);
const inject = await js("(async function(){var b=window.__dshChatBridge;if(b&&typeof b.setComposerText==='function'){" +
	"var r=b.setComposerText(" + JSON.stringify(NOVEL_REQ) + ");if(r&&r.ok){var back=b.readComposerText();return {via:'composer',ok:back===" + JSON.stringify(NOVEL_REQ) + ",back:String(back||'').slice(0,30)};}}" +
	"try{var n=(window.__dshHierarchy&&window.__dshHierarchy.GLOBAL_NODE_ID)||'__global__';" +
	"await window.__dshPluginDb.appendDirectorMessage(n,{role:'user',text:" + JSON.stringify(NOVEL_REQ) + "});return {via:'director-message',ok:true};}" +
	"catch(e){return {via:'none',ok:false,back:e.message};}})()");
console.log("  · 需求注入：" + J(inject));
if (!inject || !inject.ok) { console.error("IS_PASS: FALSE（INVALID：需求没进到产品里，后续读数不可信）"); process.exit(2); }
await shot("01b-director-need", "需求已注入输入框");

const splitClick = await clickSel('[data-testid="dp-act-split"]');
console.log("  · 点「🌿 分流」：" + J(splitClick));
/* 等待 `made + failed` 收敛到 8（有界等待：60 × 500ms = 30s） */
let info = null;
for (let i = 0; i < 60; i++) {
	info = await js("(function(){var e=document.querySelector('[data-testid=\"dp-flow-split\"]');if(!e)return null;" +
		"return {made:e.getAttribute('data-made'),failed:e.getAttribute('data-failed'),sent:e.getAttribute('data-sent')," +
		"dims:e.getAttribute('data-dims'),kind:e.getAttribute('data-kind'),attachFail:e.getAttribute('data-attachfail')," +
		"via:e.getAttribute('data-via'),err:e.getAttribute('data-error')};})()");
	if (info && info.made != null && (Number(info.made) + Number(info.failed)) >= 8) break;
	await sleep(500);
}
console.log("  · 分流读数：" + J(info));
await shot("02-director-split", "分流完成（读数栏 + 分支列表）");

/* ══════════ C · 思维导图：8 个维度框能看出来 ══════════ */
console.log("\n【C 导图】");
const mmClick = await clickSel('[data-testid="dp-open-mindmap"]');
await sleep(1200);
/* 「总览」先把整棵树 fit 进视野：否则看到的是放大的局部，八个分支看不出挂在谁下面。
 * （截图的目的是「用户能不能一眼看出结构」，不是「元素在不在」——后者由闸门负责。） */
const ov = await clickSel('[data-testid="mm-overview"]');
await sleep(900);
console.log("  · 点「总览」：" + J(ov));
const mm = await js("(function(){var r=document.querySelector('#dsh-mindmap');if(!r)return {open:false};" +
	"var boxes=[].slice.call(document.querySelectorAll('[data-split]')).filter(function(e){return e.getAttribute('data-split');});" +
	"return {open:true,count:boxes.length,labels:boxes.map(function(e){return String(e.textContent||'').trim().slice(0,18);})," +
	"origins:Array.from(new Set(boxes.map(function(e){return e.getAttribute('data-title-origin');})))," +
	"countText:(function(){var c=document.querySelector('[data-testid=\"mm-count\"]');return c?String(c.textContent).trim():'';})()};})()");
console.log("  · 打开导图：" + J(mmClick) + " ｜ 读数：" + J(mm));
const covered = (mm.labels || []).filter((t) => DIM_LABELS.some((d) => t.indexOf(d) >= 0));
console.log("  · 导图上能看出 A1–A8 的框：" + covered.length + " / 8");
await shot("03-mindmap-split", "分支导图：按维度分流后的 8 个分支");
/* 🔴 顺手核一件事：8 条分流分支是否**都挂在同一个父节点**下。
 *    导图计数是「分支 129 · 连线 7」—— 129 个节点只有 7 条边，与「8 条新分支」对不上，
 *    必须当场把它读出来（是"连线懒生成"还是"真有一条没挂上"）。 */
const wiring = await js("(function(){var t=null;try{t=window.__dshBranchTree.getBranchSnapshot().tree;}catch(e){return {err:String(e.message)};}" +
	"var rows=t.rows||[];var sp=rows.filter(function(r){return r.titleOrigin==='plugin:split';});" +
	"var edges=(t.edges||[]);var idSet={};sp.forEach(function(r){idSet[r.id]=1;});" +
	"return {splitRows:sp.length,splitParents:Array.from(new Set(sp.map(function(r){return r.parentId;})))," +
	"edgesAll:edges.length,edgesTouchingSplit:edges.filter(function(e){return idSet[e.from]||idSet[e.to];}).length," +
	"roots:rows.filter(function(r){return !r.parentId;}).map(function(r){return {id:r.id,lv:r.level,t:String(r.title||'').slice(0,14)};})};})()");
console.log("  · 接线核查：" + J(wiring));
await clickSel('[data-testid="mm-close"]');
await sleep(600);

/* ══════════ W · 执行状态窗口：可移动 / 最小化 / 靠边缩进 ══════════ */
console.log("\n【W 执行状态窗口】");
const winRead = async () => await js("(function(){var e=document.querySelector('[data-testid=\"dp-running\"]');if(!e)return null;" +
	"var r=e.getBoundingClientRect();return {mode:e.getAttribute('data-mode'),dock:e.getAttribute('data-dock')," +
	"x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)," +
	"body:!!document.querySelector('[data-testid=\"dp-running-body\"]')," +
	"strip:!!document.querySelector('[data-testid=\"dp-running-strip\"]')};})()");
await js("(function(){try{window.__directorLayoutStore.resetRunningWin();return 1;}catch(e){return e.message;}})()");
await sleep(400);
const w0 = await winRead();
console.log("  · 起点：" + J(w0));
/* 展开 → 截图 */
await clickSel('[data-testid="dp-running-min"]');
let wExp = null;
for (let i = 0; i < 20; i++) { const v = await winRead(); if (v && v.mode === "expanded") { wExp = v; break; } await sleep(150); }
console.log("  · 展开态：" + J(wExp));
await shot("04-window-expanded", "执行状态窗口 · 展开（明细可见）");
/* 拖到左缘 → 贴边 */
const hb = await js("(function(){var e=document.querySelector('[data-testid=\"dp-running-head\"]');if(!e)return null;var r=e.getBoundingClientRect();" +
	"return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
if (hb) {
	console.log("  · 从头部拖动：" + J(hb) + " → x=36");
	await dragMouse({ x: hb.x, y: hb.y }, { x: 36, y: hb.y }, 8, null);
}
const wDock = await winRead();
console.log("  · 贴边态：" + J(wDock));
await shot("05-window-docked", "执行状态窗口 · 靠边缩进（贴左缘 → 细条）");
/* 点细条回展开 → 再收起 → 截图 */
/* 点细条回展开 → 再收起 → 截图。
 * 🔴 两步之间必须**各自等到位**再走：第一轮我把这两次点击间隔 600ms 直接连做，
 *    第二次点击落在"细条刚消失、明细区还没挂上"的空档里 ⇒ 静默无效，
 *    截图拍到的仍是展开态（读数 `收起态：null` 已经给了线索，但图还是会骗人）。 */
const stripClick = await clickSel('[data-testid="dp-running-strip"]');
let backExp = null;
for (let i = 0; i < 25; i++) { const v = await winRead(); if (v && v.mode === "expanded") { backExp = v; break; } await sleep(150); }
console.log("  · 点细条（" + J(stripClick) + "）⇒ 回到展开：" + (backExp ? "是" : "**否（后续收起会打空）**"));
const colClick = await clickSel('[data-testid="dp-running-min"]');
let wCol = null;
for (let i = 0; i < 40; i++) { const v = await winRead(); if (v && v.mode === "collapsed") { wCol = v; break; } await sleep(150); }
console.log("  · 点最小化（" + J(colClick) + "）⇒ 收起态：" + J(wCol));
if (!wCol) console.log("  ⚠ 收起态没读到 —— 下面那张图**不作数**，必须修脚本重跑（不许拿「图有了」当通过）");
await shot("06-window-collapsed", "执行状态窗口 · 最小化（明细区真卸载）" + (wCol ? "" : "【⛔ 未取到收起态，此图无效】"));

/* ══════════ D · 清除所有对话消息 ══════════ */
console.log("\n【D 清除对话消息】");
const beforeMsgs = await js("(async function(){try{var n=(window.__dshHierarchy&&window.__dshHierarchy.GLOBAL_NODE_ID)||'__global__';" +
	"var l=await window.__dshPluginDb.listDirectorMessages(n,200);return l.length;}catch(e){return '__err:'+e.message;}})()");
console.log("  · 清除前总监消息数：" + beforeMsgs);
const armed = await clickSel('[data-testid="dp-maint-clear"]');
await sleep(250);
const armState = await js("(function(){var e=document.querySelector('[data-testid=\"dp-maint-clear\"]');return e?e.getAttribute('data-armed'):null;})()");
console.log("  · 第一次点（" + J(armed) + "）⇒ data-armed=" + armState);
await shot("07a-clear-armed", "清除 · 待确认态（再点一次才真删）");
await clickSel('[data-testid="dp-maint-clear"]');
await sleep(900);
const afterMsgs = await js("(async function(){try{var n=(window.__dshHierarchy&&window.__dshHierarchy.GLOBAL_NODE_ID)||'__global__';" +
	"var l=await window.__dshPluginDb.listDirectorMessages(n,200);return l.length;}catch(e){return '__err:'+e.message;}})()");
const toast = await js("(function(){var e=document.querySelector('[data-testid=\"dp-toast\"]');return e?String(e.textContent).trim().slice(0,90):'';})()");
console.log("  · 清除后总监消息数：" + afterMsgs + " ｜ toast：" + J(toast));
await shot("07b-cleared", "清除完成（读数 + toast）");

/* ══════════ 收尾 ══════════ */
console.log("\n═══════════════════════════════════════════════════════════");
const okShots = shots.filter((s) => s.path);
console.log("  截图 " + okShots.length + " / " + shots.length + " 张落在 " + OUTDIR + "/");
shots.forEach((s) => console.log("    " + (s.path ? "✅" : "❌") + " " + s.name + (s.note ? "  — " + s.note : "")));
console.log("  CDP 超时事件：" + cdpTimeouts.length + (cdpTimeouts.length ? " " + J(cdpTimeouts.slice(0, 4)) : ""));
console.log("  IS_PASS: " + (okShots.length === shots.length && cdpTimeouts.length === 0 ? "TRUE" : "FALSE"));
ws.close();
process.exit(okShots.length === shots.length && cdpTimeouts.length === 0 ? 0 : 1);
