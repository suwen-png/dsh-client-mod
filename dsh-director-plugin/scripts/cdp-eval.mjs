/**
 * cdp-eval.mjs — 在 Harness 渲染进程中执行任意表达式（调试/探测用）
 *
 * 用法：
 *   node scripts/cdp-eval.mjs "<js 表达式>"
 *   node scripts/cdp-eval.mjs --file <path-to-js>
 *
 * 零依赖（Node 22 原生 fetch + WebSocket）。
 */
import { readFileSync } from "node:fs";

const PORT = 9222;
const args = process.argv.slice(2);
let expr;
if (args[0] === "--file") expr = readFileSync(args[1], "utf8");
else expr = args.join(" ");

if (!expr) {
	console.error('用法: node scripts/cdp-eval.mjs "<表达式>"  或  --file <path>');
	process.exit(2);
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
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
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

const out = await send("Runtime.evaluate", {
	expression: expr,
	returnByValue: true,
	awaitPromise: true,
	includeCommandLineAPI: true
});

if (out.exceptionDetails) {
	console.log("异常:", out.exceptionDetails.text);
	console.log(out.exceptionDetails.exception?.description || "");
	ws.close();
	process.exit(1);
}
const v = out.result?.value;
console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
ws.close();
