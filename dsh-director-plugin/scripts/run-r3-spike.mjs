/**
 * run-r3-spike.mjs — 在真实 Harness 渲染进程中执行 R3 文件通道可达性探测（T5）
 *
 * 原理：插件 bundle 由 <script src="/plugins/<id>/client.js"> 注入，
 *       与宿主内联代码**同属渲染进程主 realm**；
 *       故在页面默认执行上下文求值 = 与插件代码同环境，结论可直接外推。
 *
 * 直接复用 src/bridge/spike-fs-probe.js 源码（避免复刻导致漂移）。
 *
 * 用法：node scripts/run-r3-spike.mjs [port]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number(process.argv[2] || 9222);
const SPIKE_SRC = resolve(import.meta.dirname, "../src/bridge/spike-fs-probe.js");

// 把 ESM 源码降级为可求值的脚本：剥掉 export 前缀 + 追加调用
let code = readFileSync(SPIKE_SRC, "utf8")
	.replace(/^export\s+(function|const|let|var|class)\s/gm, "$1 ")
	.replace(/^export\s*\{[^}]*\};?\s*$/gm, "");
code += "\n;JSON.stringify(runFsProbe());";

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) {
	console.error("未找到页面目标（Harness 是否以 --remote-debugging-port 启动？）");
	process.exit(1);
}

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
	expression: code,
	includeCommandLineAPI: true,
	returnByValue: true,
	awaitPromise: false
});

console.log("========================================");
console.log(" R3 文件通道可达性探测（真实渲染进程）");
console.log(` 目标: ${page.url}`);
console.log("========================================\n");

if (out.exceptionDetails) {
	console.log("探测抛错:", out.exceptionDetails.text);
	console.log(out.exceptionDetails.exception?.description || "");
	process.exit(1);
}

const report = out.result?.value;
if (typeof report === "string") {
	// 页面内 console.log 已输出明细；这里再打印结构化结果
	try {
		const r = JSON.parse(report);
		console.log("通道明细:");
		for (const c of r.channels) console.log(`  ${c.ok ? "✅" : "❌"} ${c.name} → ${c.detail}`);
		console.log("\nfs 模块:", r.fs ? JSON.stringify(r.fs) : "未尝试");
		console.log("\n判定:", r.verdict);
		console.log("\n※ 页面控制台已输出 [R3-spike] 明细日志");
	} catch {
		console.log(report);
	}
} else {
	console.log(JSON.stringify(report, null, 2));
}

ws.close();
