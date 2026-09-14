/**
 * shot-studio.mjs —— 设计图工作室「视觉复验」截图
 *
 * 为什么单独一个脚本：审美调优（配色 / 间距 / 按钮位置）**只能靠看图判定**，
 * 而 e2e 断言只能证明"点了会变"，证明不了"好看且分得清"。
 * 故本脚本负责「打开工作室 → 选中一个元素 → 抓全屏 PNG → 回读实际计算样式」
 * 这条固定动作，每次改样式后跑一次，与上一版 PNG 并排比对。
 *
 * 用法: node scripts/shot-studio.mjs <输出路径.png> [要选中的 el- id]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PORT = 9222;
const OUT = process.argv[2] || "logs/studio.png";
const WANT_ID = process.argv[3] || null;

/* 2026-09-14 补（纪律 17）：Harness 未启动时原先崩栈成 `TypeError: fetch failed`，
 * 读起来像脚本坏了 ⇒ 判 INVALID(2)，不判 FAIL(1)。 */
let targets;
try {
	targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=9222 启动。");
	console.error("  正确用法：powershell -File scripts/restart-harness.ps1  然后 node scripts/shot-studio.mjs");
	process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
await send("Page.enable");

const js = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	if (r.exceptionDetails) throw new Error("JS异常: " + r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
	return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ① 打开工作室（优先点浮动按钮；按钮不在则走 store 兜底）
const opened = await js([
	"(() => {",
	"  if (document.querySelector('[data-testid=\"ds-root\"]')) return \"already\";",
	"  const btn = document.getElementById(\"dsh-design-studio-launcher\")",
	"    || [].slice.call(document.querySelectorAll(\"button\")).find(function(b){ return /设计图/.test(b.textContent || \"\"); });",
	"  if (btn) { btn.click(); return \"clicked\"; }",
	"  try {",
	"    if (window.__dshLayout && window.__dshLayout.setDesignStudio) { window.__dshLayout.setDesignStudio(true); return \"via-store\"; }",
	"  } catch (e) { return \"store-fail:\" + e.message; }",
	"  return \"no-launcher\";",
	"})()"
].join("\n"));
await sleep(800);

// ② 选中一个元素（让左栏逻辑面板与选中态配色都进入画面）
const picked = await js([
	"(() => {",
	"  const els = [].slice.call(document.querySelectorAll('[data-testid=\"ds-el\"]'));",
	"  if (!els.length) return null;",
	"  const want = " + (WANT_ID ? JSON.stringify(WANT_ID) : "null") + ";",
	"  const el = (want && els.find(function(e){ return e.getAttribute(\"data-el-id\") === want; })) || els[0];",
	"  const r = el.getBoundingClientRect();",
	"  const opt = { bubbles: true, clientX: r.left + 6, clientY: r.top + 6, pointerId: 1, isPrimary: true };",
	"  el.dispatchEvent(new PointerEvent(\"pointerdown\", opt));",
	"  el.dispatchEvent(new PointerEvent(\"pointerup\", opt));",
	"  return el.getAttribute(\"data-el-id\");",
	"})()"
].join("\n"));
await sleep(500);

// ③ 抓图
mkdirSync(dirname(OUT), { recursive: true });
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const buf = Buffer.from(shot.data, "base64");
writeFileSync(OUT, buf);

// ④ 回读**实际计算样式**：断言"视觉真的分组了"，而不是断言"代码里有常量"
const diag = await js([
	"(() => {",
	"  const els = [].slice.call(document.querySelectorAll('[data-testid=\"ds-el\"]'));",
	"  const byKind = {};",
	"  els.forEach(function(e) {",
	"    const k = e.getAttribute(\"data-el-kind\");",
	"    if (byKind[k]) return;",
	"    const st = getComputedStyle(e);",
	"    byKind[k] = { border: st.borderTopColor, bg: st.backgroundColor, color: st.color };",
	"  });",
	"  const labels = [].slice.call(document.querySelectorAll('[data-testid^=\"ds-kglabel-\"]'))",
	"    .map(function(s){ return { t: s.textContent, c: getComputedStyle(s).color }; });",
	"  return { count: els.length, byKind: byKind, kglabels: labels };",
	"})()"
].join("\n"));

console.log("已保存:", OUT, buf.length, "B");
console.log("打开方式:", opened, "| 选中:", picked);
console.log(JSON.stringify(diag, null, 2));
ws.close();
