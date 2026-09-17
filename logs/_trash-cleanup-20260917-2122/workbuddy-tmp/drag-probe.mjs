/**
 * drag-probe.mjs — 临时诊断：真实鼠标拖拽 + 前后选中态读数
 * 用法: node drag-probe.mjs <sel> <dx> <dy> [steps]
 * 只连 CDP，不改产品源码。拖拽前后各读一次选中元素 id 与命中栈。
 */
const PORT = 9222;
const [sel, dxs, dys, stepsS] = process.argv.slice(2);
if (!sel) { console.error("用法: node drag-probe.mjs <css-sel> <dx> <dy> [steps]"); process.exit(2); }
const dx = Number(dxs || 120), dy = Number(dys || 70), steps = Number(stepsS || 8);

const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
	.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id);
		pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	pending.set(id, { res, rej });
	ws.send(JSON.stringify({ id, method, params }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

const read = () => js(`(function(){
	var p=document.querySelector('[data-testid=ds-logic]');
	var el=document.querySelector(${JSON.stringify(sel)});
	var r=el?el.getBoundingClientRect():null;
	return JSON.stringify({ sel:p?p.getAttribute('data-el-id'):null, els:document.querySelectorAll('[data-testid=ds-el]').length,
		rect:r?{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}:null });
})()`);

const before = await read();
const rect = JSON.parse(before || "{}").rect;
if (!rect) { console.error("目标不可见：", before); process.exit(1); }
const x1 = rect.x + rect.w / 2, y1 = rect.y + rect.h / 2;

/* 落点自检：按下点必须命中目标（自己/后代/祖先），否则这一拖打在别人身上 */
const hit = await js(`(function(){
	var e=document.querySelector(${JSON.stringify(sel)});
	var s=document.elementsFromPoint(${Math.round(x1)},${Math.round(y1)});
	var t=s[0]||null;
	return (t===e||(t&&e.contains(t))||(t&&t.contains(e)))?'self':'other:'+(t?t.tagName.toLowerCase()+ (t.getAttribute&&t.getAttribute('data-testid')?'['+t.getAttribute('data-testid')+']':''):'null');
})()`);

await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(x1), y: Math.round(y1) });
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(x1), y: Math.round(y1), button: "left", clickCount: 1, buttons: 1 });
await wait(35);
for (let i = 1; i <= steps; i++) {
	await send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: Math.round(x1 + (dx * i) / steps), y: Math.round(y1 + (dy * i) / steps), buttons: 1
	});
	await wait(18);
}
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(x1 + dx), y: Math.round(y1 + dy), button: "left", clickCount: 1, buttons: 0 });
await wait(500);

const after = await read();
console.log("落点自检 :", hit);
console.log("拖前     :", before);
console.log("拖后     :", after);
try { ws.close(); } catch (e) { /* 忽略 */ }
process.exit(0);
