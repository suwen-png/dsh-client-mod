/**
 * cdp-shot.mjs —— 真机截图（Page.captureScreenshot → PNG）
 * 用法: node scripts/cdp-shot.mjs <输出路径.png>
 */
import { writeFileSync } from "node:fs";
const PORT = 9222;
const OUT = process.argv[2] || "logs/shot.png";

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const sendRaw = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
/* 🔴 CDP 调用必须有硬超时（详注见 cdp-eval.mjs 同名段）—— 否则渲染进程卡死时
 *   本脚本会静默挂住，截图"看起来没生成"，却没有任何可读线索。 */
const CALL_TIMEOUT = Number(process.env.CDP_TIMEOUT_MS || 8000);
const withTimeout = (p, label) => new Promise((res, rej) => {
	const h = setTimeout(() => rej(new Error("CDP 调用超时 " + CALL_TIMEOUT + "ms：" + label + " —— 渲染进程可能已无响应")), CALL_TIMEOUT);
	if (h.unref) h.unref();
	p.then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
});
const send = (method, params = {}) => withTimeout(sendRaw(method, params), method);
let r;
try {
	await new Promise((res) => ws.addEventListener("open", res));
	await send("Page.enable");
	r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
} catch (e) {
	console.error("❌ 截图失败：" + String((e && e.message) || e));
	console.error("   自检：node scripts/cdp-eval.mjs \"1+1\" —— 若也失败，就是渲染进程无响应，需重启 Harness。");
	process.exit(2);
}
writeFileSync(OUT, Buffer.from(r.data, "base64"));
console.log("已保存:", OUT, Buffer.from(r.data, "base64").length, "B");
ws.close();
