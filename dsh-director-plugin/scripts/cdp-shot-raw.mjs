/**
 * cdp-shot-raw.mjs — 极简 CDP 截图（**不调 Runtime.enable**）
 *
 * 存在意义：渲染进程主线程卡死时，Runtime.enable / Runtime.evaluate 全部 8s 超时，
 * 但 Page.captureScreenshot 走 **合成器**，常常仍能出图 —— 这是"卡死期唯一能看到窗口长什么样"的手段。
 * 同时打印若干**非主线程**域（Target / Page 结构）以判断是「渲染进程已死」还是「主线程被占住」。
 *
 * 用法：node scripts/cdp-shot-raw.mjs <out.png>
 * 退出码：0 = 截到图；1 = 渲染主线程也被占住（真卡死）；2 = 连不上 CDP（用法/环境问题）；
 *         3 = 渲染进程活着但**窗口未被合成**（最小化/隐藏，不是崩溃 —— 见文件末的说明）
 */
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9222);
const OUT = process.argv[2] || "shot.png";

let targets;
try {
	const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
	targets = await r.json();
} catch (e) {
	console.error(`❌ 连不上 CDP（127.0.0.1:${PORT}）：${String(e && e.message || e)}`);
	console.error(`   自检：curl -s http://127.0.0.1:${PORT}/json/version`);
	console.error(`   目标端口不符请设 CDP_PORT=<port>；Harness 未启动请用 scripts/restart-harness.ps1`);
	process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("❌ /json/list 里没有 page 目标（窗口没开？）"); process.exit(2); }
console.log("target:", page.title, "|", page.url.slice(0, 90));

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
const T = Number(process.env.CDP_TIMEOUT_MS || 12000);
const wt = (p, label) => new Promise((res, rej) => {
	const h = setTimeout(() => rej(new Error(`timeout ${label}`)), T);
	if (h.unref) h.unref();
	p.then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
});

await new Promise((r) => ws.addEventListener("open", r));

/* 非主线程域：能答 = 渲染进程活着（至少不是崩溃），答不了 = 更靠底层的问题 */
let rendererAlive = false;
for (const m of ["Target.getTargetInfo", "Page.getFrameTree"]) {
	try { const r = await wt(send(m), m); if (m === "Page.getFrameTree") rendererAlive = true; console.log(`✅ ${m}:`, JSON.stringify(r).slice(0, 260)); }
	catch (e) { console.log(`❌ ${m}: ${String(e.message || e)}`); }
}

let shot = null;
try {
	shot = await wt(send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }), "Page.captureScreenshot");
} catch (e) {
	console.log(`❌ Page.captureScreenshot: ${String(e.message || e)}`);
}
if (shot && shot.data) {
	const buf = Buffer.from(shot.data, "base64");
	writeFileSync(OUT, buf);
	console.log(`✅ 已保存 ${OUT}（${buf.length} B）`);
	try { ws.close(); } catch (e) { /* 忽略 */ }
	process.exit(0);
}

/* 🔴 2026-09-14 修正（**本脚本第一版就是错的**，差点又误诊一轮）：
 *   `Page.captureScreenshot` 超时**不等于**渲染进程死了 —— 它走**合成器**，
 *   而窗口处于隐藏/最小化（`document.visibilityState === "hidden"`，实测 `screenX = -32000`）时
 *   合成器**不出帧** ⇒ 这个调用会一直挂着，可 `Runtime.evaluate` 依然 2ms 返回。
 *   ⇒ 必须用 `Page.getFrameTree`（主线程）的成败把两种情况分开，并给出**下一步该做什么**。
 *   第一版直接打印"渲染进程很可能已死（崩溃）"，会把人赶去重启 Harness —— 那是错的处方。 */
if (rendererAlive) {
	console.error("❌ 未取到截图 —— 但 Page.getFrameTree 正常 ⇒ **渲染进程活着**，是**窗口没被合成**。");
	console.error("   典型原因：窗口被最小化/隐藏（Windows 下最小化时 screenX/screenY 会变成 -32000）。");
	console.error("   查证：node scripts/probe-window-state.mjs");
	console.error("   处置：让 Harness 窗口上屏并置前（最快的办法是**再启动一次 exe** ——");
	console.error("         单实例锁会把 second-instance 交给已运行实例，标准实现即 win.restore() + win.focus()）。");
	process.exit(3);
}
console.error("❌ 未取到截图，且 Page.getFrameTree 也超时 ⇒ 渲染进程**主线程被占住**（或已崩溃），需重启 Harness");
try { ws.close(); } catch (e) { /* 忽略 */ }
process.exit(1);
