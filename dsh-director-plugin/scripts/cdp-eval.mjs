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

/* 🔴 端口口径必须与本仓一致（纪律 126）：`CDP_PORT` 优先、`DSH_CDP_PORT` 兜底（**顺序不可反**）。
 * 原写法硬编码 9222 —— 而 `run-live.mjs` 在 9222 被**幽灵 pid** 占用时会改用 9223+
 * ⇒ 本工具会连到"没人在听"的端口，或更糟：**另一个并行会话**的实例（静默跑错目标）。 */
const PORT = Number(process.env.CDP_PORT || process.env.DSH_CDP_PORT || 9222);
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

/* 🔴 CDP 调用必须有硬超时（本轮真实教训，已两次踩到）
 *   渲染进程主线程卡死时，**浏览器进程仍然正常回 HTTP**（/json/list 有响应、能列出页面），
 *   但 Runtime.evaluate 永不返回。此时若没有超时，本工具会一直挂着；被外层 shell 的
 *   `timeout` 杀掉后表现为「**空输出 + exit 0**」——
 *   读起来像"表达式写错了 / 没输出"，完全指不到"渲染进程已死"。
 *   实测就是这么被误导过一次（对着一个写错的探针查了半天，其实探针没跑）。
 *   ⇒ 任何"等待"都必须有硬超时；没有超时的等待等于**把挂死伪装成正在跑**。 */
const CALL_TIMEOUT = Number(process.env.CDP_TIMEOUT_MS || 8000);
const withTimeout = (p, label) => new Promise((res, rej) => {
	const h = setTimeout(() => rej(new Error("CDP 调用超时 " + CALL_TIMEOUT + "ms：" + label + " —— 渲染进程可能已无响应（**不是表达式写错**）")), CALL_TIMEOUT);
	if (h.unref) h.unref();
	p.then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
});

await new Promise((r) => ws.addEventListener("open", r));
let out;
try {
	await withTimeout(send("Runtime.enable"), "Runtime.enable");
	out = await withTimeout(send("Runtime.evaluate", {
		expression: expr,
		returnByValue: true,
		awaitPromise: true,
		includeCommandLineAPI: true
	}), "Runtime.evaluate");
} catch (e) {
	console.error("❌ " + String((e && e.message) || e));
	console.error("   自检：node scripts/cdp-eval.mjs \"1+1\" —— 若也失败，就是渲染进程无响应，需重启 Harness。");
	try { ws.close(); } catch (e2) { /* 忽略 */ }
	process.exit(2);
}

if (out.exceptionDetails) {
	console.log("异常:", out.exceptionDetails.text);
	console.log(out.exceptionDetails.exception?.description || "");
	ws.close();
	process.exit(1);
}
const v = out.result?.value;
console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
ws.close();
