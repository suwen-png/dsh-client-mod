#!/usr/bin/env node
/**
 * _r37-shot.mjs —— 第 37 轮**一次性**取证截图：导图分区 + 父居中，1:1 真实像素
 *
 * 为什么单独写：`shot-all.mjs` 的导图那张按「适应屏幕」fit 到 30%（28 节点、画布高 3000+）
 * ⇒ 分区标题与节点文字**都看不清**，作不了"可看验收证据"（纪律 57）。
 * 本脚本打开导图后点「1:1」再截，出一张能看清标题/节点/连线细节的局部图。
 *
 * 用法（须 Harness 已就绪，用 _run-with-harness 包装）：
 *   node scripts/_r37-shot.mjs [输出目录，默认 logs/audit-r37]
 */
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || process.env.DSH_CDP_PORT || 9222);
const OUTDIR = process.argv[2] || "logs/audit-r37";
mkdirSync(OUTDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标（Harness 未启动？）"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	const timer = setTimeout(() => { pending.delete(id); rej(new Error("TIMEOUT " + method)); }, 8000);
	pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
	ws.send(JSON.stringify({ id, method, params }));
});
const emit = (m, p = {}) => ws.send(JSON.stringify({ id: ++seq, method: m, params: p }));
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable"); await send("Page.enable");
const js = async (expr) => {
	const o = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
	if (o.exceptionDetails) return { __exc: o.exceptionDetails.text };
	return o.result && o.result.value;
};
function mouse(type, x, y, b) {
	emit("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: b || 0, clickCount: type === "mouseMoved" ? 0 : 1 });
}
async function clickXY(x, y) { mouse("mouseMoved", x, y, 0); await sleep(24); mouse("mousePressed", x, y, 1); await sleep(40); mouse("mouseReleased", x, y, 0); await sleep(300); }
async function clickSel(sel) {
	const r = await js("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return null;"
		+ "var b=e.getBoundingClientRect();if(b.width<1||b.height<1)return {zero:true};"
		+ "return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})()");
	if (!r || r.zero) return false;
	await clickXY(r.x, r.y); return true;
}
async function shot(file) {
	const o = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
	writeFileSync(OUTDIR + "/" + file, Buffer.from(o.data, "base64"));
	console.log("截图 " + OUTDIR + "/" + file + "  " + Buffer.from(o.data, "base64").length + " B");
}

/* 1. 打开导图（浮动按钮组 → 思维导图） */
const opened = await clickSel('[data-testid="d-open-mindmap"]');
if (!opened) {
	console.log("⚠️ 未找到浮动入口 d-open-mindmap —— 打印候选给下一步定位");
	const cands = await js("Array.from(document.querySelectorAll('[data-testid]')).map(function(e){return e.getAttribute('data-testid');}).filter(function(s){return /fab|mm-|mind/i.test(String(s));})");
	console.log(JSON.stringify(cands));
}
await sleep(1200);
const inDom = await js("!!document.getElementById('dsh-mindmap')");
console.log("导图层在 DOM：" + inDom);
if (!inDom) { console.log("导图未打开 ⇒ 退出（不做无效截图）"); process.exit(2); }

/* 2. 确保分区开着 */
const onNow = await js("(function(){var e=document.querySelector('[data-testid=\"mm-group-toggle\"]');return e?e.getAttribute('data-on'):null;})()");
console.log("分组开关 data-on = " + onNow);
if (onNow !== "1") { await clickSel('[data-testid="mm-group-toggle"]'); await sleep(500); }

/* 3. 回到 1:1 真实像素 */
await clickSel('[data-testid="mm-zoom-100"]');
await sleep(700);
const zk = await js("(function(){var e=document.querySelector('[data-testid=\"mm-stage\"]');return e?e.getAttribute('data-zoom'):null;})()");
console.log("缩放 data-zoom = " + zk);
await shot("3-mindmap-100.png");

/* 4. 分区几何取证（供报告引用） */
const geo = await js("Array.from(document.querySelectorAll('[data-testid=\"mm-group\"]')).map(function(e){"
	+ "return {kind:e.getAttribute('data-group-kind'),label:e.getAttribute('data-group-label'),count:e.getAttribute('data-group-count'),"
	+ "dims:e.getAttribute('data-group-dims'),hidden:e.getAttribute('data-group-hidden'),"
	+ "x:parseFloat(e.style.left)||0,y:parseFloat(e.style.top)||0,w:parseFloat(e.style.width)||0,h:parseFloat(e.style.height)||0};})");
console.log("分区几何：" + JSON.stringify(geo));
const cnt = await js("document.querySelectorAll('[data-testid=\"mm-node\"]').length");
console.log("节点数：" + cnt);
ws.close();
process.exit(0);
