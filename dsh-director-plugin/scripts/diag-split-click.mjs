#!/usr/bin/env node
/**
 * diag-split-click.mjs —— 「点派发 ⇒ 零后果」的**分段计时**诊断（纪律 39）
 *
 * ══════════════════════════════════════════════════════════════════
 * 已知事实（来自 2026-09-17 真机第一波日志，**不是推测**）
 * ──────────────────────────────────────────────────────────────────
 *   · A 段起点**全部 ✅**（`dp-root` 已挂载、会话 122 条）⇒ 与起点无关；
 *   · **噪声**输入那次**读数成功**（`data-kind=noise`）⇒ 点击通道通、判定链通；
 *   · **真实需求**那次**零后果**：台账 `__dshDispatchLog.at` 恒 0、零会话、
 *     **页面零未捕获异常**（`DL-8b` OK）；
 *   · `visibilityState=visible` ⇒ 不是纪律 90 的鼠标吞事件；
 *   · 离线 `plan(该串)` = 8 维、零抛错 ⇒ 纯逻辑层没问题。
 *
 * ⇒ 差异只剩一个：真实路径要经过 `dispatchBranches()`（异步、多 await、写台账），
 *    噪声路径在 `plan()` 里就 return 了 ⇒ **断点必在 `dispatchBranches` 内部**。
 *    两种可能必须分开（纪律 58）：
 *      (a) **挂住**（某个 await 永不 resolve）⇒ 无异常、无台账、无读数；
 *      (b) **静默返回**（提前 return，未写台账）⇒ 同样无异常。
 *
 * ══════════════════════════════════════════════════════════════════
 * 本脚本怎么分
 * ──────────────────────────────────────────────────────────────────
 *   点一次 → 在 t=1s/4s/10s/20s/35s **各读一遍**同一组读数：
 *     `dispatchLog.at` ｜ `dp-flow-split` 的 data-* ｜ 存活会话数 ｜
 *     `#dsh-director-page` 里含「分流/未派发/中断」的状态行
 *   ⇒ 读数**在某个 t 之后出现** = 只是慢 / 前置有阻塞；
 *     读数**一路为空** = 真挂住或静默返回（再靠状态行区分）。
 *   `plan()` 结果由**产品自己的状态行**间接确认（不自己复算，避免两套口径）。
 *
 * 用法：node scripts/diag-split-click.mjs [需求串] ｜ 退出码 0=出读数 / 1=零读数
 */

import { makeClicker } from "./_cdp-click-until.mjs";
import { ensureDirectorPage } from "./_cdp-startup.mjs";
import { ensureHarness } from "./_harness.mjs";

const PORT0 = Number(process.env.CDP_PORT || 9222);
const REQ = process.argv[2] || "帮我写一个小说《灵能修仙》，这次要全流程走一遍：先搭世界观再做剧情，最后写正文并做一致性审查";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(s);

const h = await ensureHarness({ port: PORT0, budgetMs: 180000 });
if (!h.ok) { console.log("IS_PASS: FALSE（INVALID · Harness 未就绪：" + (h.why || "") + "）"); process.exit(2); }
console.log("[diag] Harness port=" + h.port + " reused=" + h.reused);

let page = null;
for (let i = 0; i < 90; i++) {
	const a = await (await fetch("http://127.0.0.1:" + h.port + "/json/list")).json().catch(() => []);
	const ps = a.filter((t) => t.type === "page" && !/devtools/.test(t.url));
	if (ps.length) { page = ps[0]; break; }
	await sleep(1000);
}
if (!page) { console.log("IS_PASS: FALSE（INVALID · 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const exc = [];
const cons = [];
ws.addEventListener("message", (ev) => {
	let m = null;
	try { m = JSON.parse(ev.data); } catch (e) { return; }
	if (m.method === "Runtime.exceptionThrown") {
		const d = (m.params && m.params.exceptionDetails) || {};
		exc.push(String(d.text || "") + " " + String((d.exception && d.exception.description) || "").split("\n")[0]);
	}
	if (m.method === "Runtime.consoleAPICalled") {
		const a = (m.params && m.params.args) || [];
		cons.push((m.params.type || "") + ": " + a.map((x) => String(x.value || x.description || "")).join(" ").slice(0, 160));
	}
	if (m.id !== undefined && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); }
});
const send = (method, params) => new Promise((res) => {
	const id = ++seq;
	pending.set(id, res);
	ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
});
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", () => j(new Error("WS fail"))); });
await send("Runtime.enable", {});
await send("Log.enable", {});
const js = async (expr) => {
	const m = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
	if (m.result && m.result.exceptionDetails) return { __err: String(m.result.exceptionDetails.text).slice(0, 160) };
	return m.result && m.result.result ? m.result.result.value : null;
};

/* ── 起点（复用唯一实现；不自己重造 —— 纪律 98）── */
const diagLog = [];
const CL = makeClicker({ send: send, js: js, sleep: sleep }, {});
const boot = await ensureDirectorPage({
	CL: CL, js: js, send: send, sleep: sleep,
	log: (s) => { diagLog.push(s); },
	tabBudgetMs: 150000, useRealUi: true
});
console.log("[起点] ok=" + boot.ok + " reason=" + JSON.stringify(boot.reason || ""));
if (!boot.ok) {
	diagLog.slice(-12).forEach((s) => console.log("   " + s));
	console.log("IS_PASS: FALSE（INVALID · 起点未建立 ⇒ 点击诊断无意义）");
	process.exit(2);
}
log("  [鼠标前提] visibility=" + await js("document.visibilityState") + " hasFocus=" + await js("document.hasFocus()"));

/* ── 注入需求（走产品自己的 composer，与套件同路）── */
const inj = await js("(function(){var b=window.__dshChatBridge;if(!b||typeof b.setComposerText!=='function')return {ok:false,why:'无 setComposerText'};"
	+ "var r=b.setComposerText(" + JSON.stringify(REQ) + ");var back=b.readComposerText();"
	+ "return {ok:!!(r&&r.ok),back:String(back||'').slice(0,40)};})()");
console.log("[注入] " + JSON.stringify(inj));

/** 一组读数（同一口径，五次要读同样的东西） */
const SNAP = "(function(){"
	+ "var out={};"
	+ "try{out.at=window.__dshDispatchLog?window.__dshDispatchLog.at:0;}catch(e){out.at='__err';}"
	+ "try{out.items=(window.__dshDispatchLog&&window.__dshDispatchLog.items)?window.__dshDispatchLog.items.length:0;}catch(e){out.items='__err';}"
	+ "var e=document.querySelector('[data-testid=\"dp-flow-split\"]');"
	+ "out.flow=!!e;"
	+ "if(e){out.made=e.getAttribute('data-made');out.failed=e.getAttribute('data-failed');out.kind=e.getAttribute('data-kind');out.err=e.getAttribute('data-error');out.note=String(e.getAttribute('data-note')||'').slice(0,60);}"
	+ "try{out.live=window.__dshBranchTree.rawSessionSummaries().length;}catch(e2){out.live='__err';}"
	+ "try{var pg=document.getElementById('dsh-director-page');var t=pg?String(pg.innerText||''):'';"
	+ "out.stateLine=(t.split('\\n').filter(function(x){return /分流|未派发|中断|已分辨/.test(x);})[0]||'').slice(0,80);}catch(e3){out.stateLine='__err';}"
	+ "out.alive=true;"
	+ "return out;})()";

console.log("\n─── 点击前 ───");
const before = await js(SNAP);
console.log("  " + JSON.stringify(before));

/* ── 点击（JS 直点；真实鼠标失效已由前置读数排除，诊断只需通道）── */
const clickR = await js("(function(){var e=document.querySelector('[data-testid=\"dp-act-split\"]');if(!e)return {ok:false,why:'no-el'};"
	+ "var r=e.getBoundingClientRect();if(r.width<2||r.height<2)return {ok:false,why:'invisible'};"
	+ "e.click();return {ok:true,text:String(e.textContent||'').slice(0,20)};})()");
console.log("[点击] " + JSON.stringify(clickR));

/* ── 分段计时：读数在哪个时刻变化 ── */
const T = [1000, 3000, 6000, 10000, 20000, 35000];
let prev = JSON.stringify(before);
let changedAt = null;
for (const ms of T) {
	await sleep(ms - (T[T.indexOf(ms) - 1] || 0));
	const s = await js(SNAP);
	const cur = JSON.stringify(s);
	const same = cur === prev;
	console.log("  t+" + String(ms / 1000).padStart(4) + "s  " + (same ? "（无变化）" : "🔔 变化 ⇒ " + cur));
	if (!same) { changedAt = ms; prev = cur; }
}

console.log("\n─── 页面未捕获异常（" + exc.length + " 条）───");
exc.slice(0, 10).forEach((x) => console.log("  ❗ " + x));
console.log("─── console（末 12 条）───");
cons.slice(-12).forEach((x) => console.log("  · " + x));

const final = await js(SNAP);
const got = Number(final.at) > 0 || final.flow === true;
console.log("\n─── 结论 ───");
console.log("  台账 at=" + final.at + " ｜ dp-flow-split 在=" + final.flow + " ｜ 存活会话=" + final.live);
console.log("  读数变化时刻：" + (changedAt ? "t+" + changedAt / 1000 + "s" : "**全程无变化**"));
console.log("  归因：" + (got
	? "读数出现（曾经慢 ⇒ 等预算问题，不是产品坏）"
	: (exc.length ? "**抛错**（见上方异常）"
		: (final.stateLine ? "静默返回（状态行：`" + final.stateLine + "`）" : "**挂住**（无异常、无读数、无状态行）"))));
try { ws.close(); } catch (e) { }
console.log(got ? "IS_PASS: TRUE" : "IS_PASS: FALSE");
process.exit(got ? 0 : 1);
