/**
 * _reload-r23.mjs — 重载渲染进程以装载最新 client bundle（免重启 Harness）
 *
 * 背景：本轮 `taskkill /F /IM "DeepSeek Harness.exe"` **被拒绝访问**
 *      （Harness 以管理员权限运行，当前 shell 无提权）⇒ 主进程无法重启。
 *      但 `lib/client.js` 是**渲染进程侧**的 client 插件（`ctx.slots.inject(...)` 在页面里跑）
 *      ⇒ `Page.reload` 应能让页面重新装载最新 bundle。
 *
 * 🔴 判据不能靠"应该生效了"：**必须回读构建指纹** `window.__dshBuildStamp`
 *    与 `build/build.mjs` 输出的指纹逐字符比对（本轮 = 0c43c1d001267747）。
 *    不符 ⇒ 结论是"reload 不足以换 bundle"，必须回退到"提权重启"。
 *
 * 用法：node scripts/_reload-r23.mjs <期望指纹>
 */
const PORT = Number(process.env.CDP_PORT || 9222);
const WANT = String(process.argv[2] || "").trim();

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标"); process.exit(1); }

const before = await (async () => {
	const t2 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
	const p2 = t2.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
	return p2 && p2.url;
})();

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
});
const withTimeout = (p, l) => new Promise((res, rej) => {
	const h = setTimeout(() => rej(new Error("超时 " + l)), 15000); if (h.unref) h.unref();
	p.then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
});
await new Promise((r) => ws.addEventListener("open", r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (e) => {
	try {
		const r = await withTimeout(send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }), "eval");
		return r.result && r.result.value;
	} catch (e2) { return "__ERR:" + e2.message; }
};

console.log("[0] 重载前 url = " + before);
console.log("[0] 重载前 stamp = " + await js("String(window.__dshBuildStamp||'(无)')"));

await withTimeout(send("Page.reload", { ignoreCache: true }), "reload");
console.log("[1] 已发 Page.reload(ignoreCache:true)，等待页面就绪…");

/* 有界等待：页面重新可求值 + 注入句柄出现（纪律 55：等待必须校验返回值 + 有界） */
let ready = false, waited = 0;
for (let i = 0; i < 60; i++) {
	await sleep(1000); waited += 1000;
	const stamp = await js("String(window.__dshBuildStamp||'')");
	if (typeof stamp === "string" && stamp && !stamp.startsWith("__ERR") && stamp !== "(无)") { ready = true; console.log("[2] " + waited + "ms 后可读，stamp = " + stamp); break; }
}
if (!ready) { console.log("[2] ❌ 60s 内页面未就绪"); }

/* 等注入句柄（最长 30s）——第 23 批新增前提：插件注入完成才能挂总监页 */
let vh = null;
for (let i = 0; i < 30; i++) {
	vh = await js("(function(){try{var v=window.__dshDirectorView;return v?JSON.stringify({registered:!!v.registered,id:v.id}):null;}catch(e){return null;}})()");
	if (vh) break;
	await sleep(1000);
}
console.log("[3] 注册句柄 = " + vh + "（等 " + (i => i)(0) + "）");

const stamp = await js("String(window.__dshBuildStamp||'(无)')");
console.log("[4] 重载后 stamp = " + stamp);
if (WANT) {
	console.log("[5] 期望指纹 = " + WANT);
	console.log("[5] 判定：" + (stamp === WANT ? "✅ 一致 —— 新 bundle 已生效" : "❌ 不一致 —— reload 不足以换 bundle，需提权重启 Harness"));
}
console.log("[6] dp-root = " + await js("!!document.querySelector('[data-testid=\"dp-root\"]')")
	+ " · tabs = " + await js("JSON.stringify([].slice.call(document.querySelectorAll('[role=tab]')).map(function(e){return String(e.textContent||'').trim();}))"));

ws.close();
process.exit(0);
