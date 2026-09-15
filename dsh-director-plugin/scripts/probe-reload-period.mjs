/**
 * probe-reload-period.mjs — 探测 Harness 渲染进程的「自重载周期」与重载诱因
 *
 * 为什么要这个探针（本轮实测踩到）：
 *   `verify-orchestrate.mjs` 连续跑时出现 1/4 概率的整段 null，
 *   心跳记录到 page origin 在跑程中变了 **两次**（间隔 25.2s / 23.7s）。
 *   origin 变化 = 页面真的重载了。那么问题来了：
 *     ⓐ 是 app 自身的周期行为（环境），与插件无关？
 *     ⓑ 还是我们的插件把渲染进程搞崩、Electron 自动 reload（产品缺陷）？
 *   两者读数一样，必须靠**空载对照**分开：
 *     空载（不点任何东西、不开面板）也照周期重载 ⇒ ⓐ 环境
 *     空载稳定、一开面板就重载             ⇒ ⓑ 产品
 *
 * 顺带抓每周期内的 console error / 未捕获异常，重载诱因会留在里面。
 *
 * 用法：
 *   node scripts/probe-reload-period.mjs [观测秒数，默认 60]
 *
 * 退出码：0 正常结束 / 2 连不上页面（INVALID，非产品问题）
 */
const PORT = 9222;
const SECONDS = Number(process.argv[2] || 60);

let targets;
try {
	targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch (e) {
	console.error("连不上 CDP（Harness 未启动或没带 --remote-debugging-port=9222）");
	console.error('  ( cd "/d/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness" && env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./DeepSeek Harness.exe" --remote-debugging-port=9222 & )');
	process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let seq = 0;
const pending = new Map();
const errors = [];
let reloadMark = 0;

ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? {}); pending.delete(m.id); return; }
	if (m.method === "Runtime.exceptionThrown") {
		const d = m.params.exceptionDetails;
		errors.push({ at: Date.now(), origin: reloadMark, kind: "exception", text: (d.text || "") + " " + (d.exception?.description || "").slice(0, 200) });
	}
	if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
		errors.push({ at: Date.now(), origin: reloadMark, kind: m.params.type, text: m.params.args.map((a) => String(a.value ?? a.description ?? "")).join(" ").slice(0, 200) });
	}
});
function send(method, params) {
	const id = ++seq;
	return new Promise((res, rej) => {
		const to = setTimeout(() => { pending.delete(id); rej(new Error("timeout " + method)); }, 8000);
		pending.set(id, (r) => { clearTimeout(to); res(r); });
		ws.send(JSON.stringify({ id, method, params }));
	});
}
const js = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.value;

await send("Runtime.enable");
await send("Log.enable").catch(() => {});

const t0 = Date.now();
let origin = await js("Math.round(performance.timeOrigin)");
const first = origin;
console.log("════════════════════════════════════════════════════════════");
console.log(" Harness 渲染进程自重载周期探测（空载对照）");
console.log("════════════════════════════════════════════════════════════");
console.log(" 起点 origin = " + origin + " · 观测 " + SECONDS + "s · 全程**不做任何交互**");

const spans = [];
let lastChange = t0;
const timer = setInterval(async () => {
	let o = null;
	try { o = await js("Math.round(performance.timeOrigin)"); } catch { /* 重载瞬间可能取不到 */ }
	if (o && o !== origin) {
		spans.push(Date.now() - lastChange);
		reloadMark++;
		console.log(`  ⟳ 重载 #${spans.length}  origin ${origin} → ${o}   （距上次 ${spans[spans.length - 1]} ms）`);
		origin = o;
		lastChange = Date.now();
	}
	if (Date.now() - t0 > SECONDS * 1000) {
		clearInterval(timer);
		console.log("════════════════════════════════════════════════════════════");
		console.log(" 重载次数 = " + spans.length + (spans.length ? " · 间隔 ms = [" + spans.join(", ") + "]" : ""));
		if (spans.length) {
			const avg = Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
			console.log(" 平均间隔 ≈ " + avg + " ms ⇒ 闸门可用窗口 = 距上次重载起算约 " + avg + " ms");
		} else {
			console.log(" 空载期间**无重载** ⇒ 重载与「面板/交互」相关，需按产品缺陷追");
		}
		const mid = errors.filter((e) => e.origin > 0);
		console.log(" 重载周期内捕获的 error/warning 共 " + mid.length + " 条，去重前 8 条：");
		const seen = new Set();
		for (const e of mid) {
			const k = e.kind + e.text.slice(0, 80);
			if (seen.has(k)) continue;
			seen.add(k);
			console.log("   [" + e.kind + "] " + e.text.replace(/\s+/g, " ").slice(0, 170));
		}
		console.log(" 起点 origin = " + first + " · 末次 origin = " + origin);
		console.log("════════════════════════════════════════════════════════════");
		ws.close();
		process.exit(0);
	}
}, 500);
