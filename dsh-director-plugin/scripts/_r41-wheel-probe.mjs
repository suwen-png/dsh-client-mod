/**
 * _r41-wheel-probe.mjs — 第 41 轮：`Ctrl + 滚轮缩放` 派发链的**对照实验**（纪律 130）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  为什么要有这个探针（别再"猜归因"了）
 * ══════════════════════════════════════════════════════════════════════
 *  `verify-mindmap.mjs` 的【13.10】/【13.10b】五条断言连红两轮：
 *
 *    C-M25a  before:0 → after:0        （Ctrl+滚轮，计数不动）
 *    C-M25b  "100%"  → "100%"          （读数不动）
 *    C-M27a  base:100 up:100 down:92   （5 次派发只有 1 次生效）
 *    C-M27b  裸滚轮居然**也缩放了**（92 → 84，计数 1 → 2）—— 与规范正好相反
 *
 *  第 41 轮我做了一次**错误归因**并已证伪：把 `emit` 改成 `await send`，
 *  理由是"`emit` 不保证送达"。重跑后五条**原样全红** ⇒ 该假设不成立。
 *  （另：`verify-mindmap.mjs:59-61` 明文写着本环境 `Input.dispatchMouseEvent`
 *   的 **CDP 响应稳定延迟约 5s、而事件本身立即送达** —— 改成 `await send`
 *   只让我每次派发多等 5 秒，压根没碰到"事件没到"这件事。）
 *
 *  所以必须做**对照实验**把下面三种可能**分开**，而不是继续赌：
 *
 *    ① 产品侧处理器坏了：`MindMap.js#onWheel` 的 `root.contains(t)` / `ctrlKey`
 *       判断有问题 ⇒ 事件到了也不响应。
 *       ⇒ 判别法 = **合成 `WheelEvent` 正对照**（事件 100% 到达，且 `isTrusted=false`；
 *          该处理器不看 `isTrusted` ⇒ 若合成能缩放，处理器就是好的）。
 *    ② 派发侧（harness/CDP）问题：坐标落点被别的层盖住、或 `modifiers` 没生效、
 *       或事件根本没送达 ⇒ 处理器再好也不响应。
 *       ⇒ 判别法 = 边长**记录每个到达的 wheel 事件**（`__wheelLog`，capture 阶段）
 *          边看 `elementFromPoint` 落点，再用**计时版 send** 量 CDP 响应延迟。
 *    ③ 我的**读法**问题：事件确实到了，但我在它落地之前就读了状态（固定 sleep）。
 *       ⇒ 判别法 = **轮询直到计数变化**，而不是睡 200ms 就读。
 *
 *  三问一次跑完 ⇒ 无论结果如何都能**收敛到唯一结论**。
 *
 * ── 顺带回答的第二个问题（同一实例、零额外启停 —— 用户纪律 T2「非必要不关软件」）
 *   `C-M13a`（原生窗口控件覆盖层 WCO）两轮读数**互相矛盾**：
 *     第一次跑（复用已有实例）wcoVisible=**true**、inset>0 ⇒ 绿；
 *     强重启后        wcoVisible=**false**、inset:0 ⇒ 红。
 *   本探针一并打印 `navigator.windowControlsOverlay` 与**合成可用性**
 *   （`Page.captureScreenshot` 能不能出帧），供归因用。
 *
 * 用法（必须与启动同一条命令 · 纪律 ㊵；且**不自启**，附着到已跑实例上）：
 *   node scripts/_r41-wheel-probe.mjs
 * 退出码：0 = 三问都取到读数；2 = 环境不成立（无 page / 导图打不开）
 */
const PORT = Number(process.env.CDP_PORT || process.env.DSH_CDP_PORT || 9222);

const { waitCdpPage } = await import("./_cdp-startup.mjs");
const T = await waitCdpPage({ port: PORT, log: (s) => console.log(s) });
if (!T.ok) {
	console.error("IS_PASS: FALSE（INVALID：" + (T.reason || "连不上 CDP " + PORT) + "）");
	process.exit(2);
}
const page = T.page || (T.targets || []).filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
let wsErr = "";
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
ws.addEventListener("error", (e) => { wsErr = String((e && e.message) || e); });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
/* `emit` = fire-and-forget（套件里"坐标/键盘"类派发用的就是它）*/
const emit = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); };
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function js(expr) {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
	if (r.exceptionDetails) throw new Error("JS异常: " + r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
	return r.result?.value;
}
/* 🔴 计时版派发：**量出 CDP 响应延迟**（本环境疑似 ~5s），并让错误可见。
 *    超时上限 8s —— 探针本身不许挂死。 */
const timedSend = async (method, params) => {
	const t0 = Date.now();
	try {
		await Promise.race([
			send(method, params),
			sleep(8000).then(() => { throw new Error("等待 CDP 响应超时(8s)"); }),
		]);
		return { ok: true, ms: Date.now() - t0 };
	} catch (e) { return { ok: false, ms: Date.now() - t0, err: String((e && e.message) || e) }; }
};

/* ══════════ ① 环境真相（可见性 / WCO / 合成） ══════════ */
const { ensurePageFocus } = await import("./_cdp-focus.mjs");
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true }); return r && r.result ? r.result.value : undefined; };
const fp = await ensurePageFocus({ send, ev, log: (s) => console.log(s) });

const ENV = await js(`(function(){
  var wco = navigator.windowControlsOverlay;
  var r = null; try { r = wco ? wco.getTitlebarAreaRect() : null; } catch (e) {}
  return {
    visibility: document.visibilityState, hidden: document.hidden, hasFocus: document.hasFocus(),
    screenX: window.screenX, screenY: window.screenY,
    innerW: window.innerWidth, innerH: window.innerHeight,
    wcoPresent: !!wco, wcoVisible: wco ? wco.visible : null,
    rectW: r ? Math.round(r.width) : null,
    inset: (wco && wco.visible === true && r && r.width > 0 && window.innerWidth > 0) ? Math.round(window.innerWidth - r.width) : 0
  };
})()`);
let compositing = false;
try { const s = await Promise.race([send("Page.captureScreenshot", { format: "png" }), sleep(6000).then(() => { throw new Error("t"); })]); compositing = !!(s && s.data); }
catch (e) { compositing = false; }

console.log("\n══════════ ① 环境真相 ══════════");
console.log("  focus 前置：" + "visibility=" + JSON.stringify(fp.visibility) + " ｜ bringToFront=" + fp.broughtToFront + " ｜ focusEmulated=" + fp.focusEmulated
	+ (fp.reasons.length ? " ｜ 降级：" + fp.reasons.join(" / ") : ""));
console.log("  " + JSON.stringify(ENV));
console.log("  合成：" + (compositing ? "✅ 可出帧（截图可用）" : "🔴 不出帧（Page.captureScreenshot 挂起 ⇒ 滚轮这种走合成器的事件可能整体失效）"));
console.log("  WCO：" + (ENV.wcoVisible === true ? "✅ 可见 · inset=" + ENV.inset : "⏭️ 不可见 ⇒ 安全区类断言无测试面（依据 probe-window-state.mjs 既有裁定）"));

/* ══════════ ② 前置：导图必须开着（本探针**不自启**，只附着） ══════════ */
let open = await js(`!!document.getElementById("dsh-mindmap")`);
if (!open) {
	console.log("\n  · 导图未打开 → 走用户路径尝试打开");
	const s0 = await js(`(function(){return {dock:!!document.querySelector('[data-testid="d-open-mindmap"]'),dialog:!!document.querySelector('[data-testid="d-dialog"]')};})()`);
	if (s0 && s0.dialog) { await js(`(function(){var s=window.__directorLayoutStore;if(s&&typeof s.setDialogOpen==="function")s.setDialogOpen(false);return 1;})()`); await sleep(350); }
	await js(`(function(){var e=document.querySelector('[data-testid="d-open-mindmap"]');if(e)e.click();return 1;})()`);
	await sleep(700);
	open = await js(`!!document.getElementById("dsh-mindmap")`);
	if (!open) {
		const v = await js(`(function(){try{var s=window.__directorLayoutStore;if(s&&typeof s.setMindmap==="function"){s.setMindmap(true);return "ok";}return "no-api";}catch(e){return "exc:"+e.message;}})()`);
		await sleep(700);
		open = await js(`!!document.getElementById("dsh-mindmap")`);
		console.log("  · store 兜底：" + String(v));
	}
}
if (!open) { console.error("IS_PASS: FALSE（INVALID：导图打不开 ⇒ 无滚轮落点，实验不成立）"); process.exit(2); }
console.log("\n  导图已在场 ✅");

/* ══════════ ③ 装探针：capture 阶段记录**每一个到达的 wheel 事件** ══════════
 *  capture=true ⇒ 即使产品处理器没响应，我也能看见"事件到底有没有到"。 */
await js(`(function(){
  window.__wheelLog = [];
  if (window.__wheelProbeOff) { try { window.__wheelProbeOff(); } catch (e) {} }
  var h = function(e){
    var root = document.getElementById("dsh-mindmap");
    var t = e.target;
    window.__wheelLog.push({
      dy: e.deltaY, mode: e.deltaMode, ctrl: !!e.ctrlKey, meta: !!e.metaKey, trusted: !!e.isTrusted,
      tgt: (t && t.tagName ? t.tagName : "?") + (t && t.id ? "#" + t.id : "") + (t && t.getAttribute && t.getAttribute("data-testid") ? "[" + t.getAttribute("data-testid") + "]" : ""),
      inRoot: !!(root && t && root.contains(t))
    });
  };
  document.addEventListener("wheel", h, true);
  window.__wheelProbeOff = function(){ document.removeEventListener("wheel", h, true); };
  return true;
})()`);

const wheelN = async () => await js(`(function(){var s=window.__mmStats;return (s&&s.wheel)?s.wheel.zoomed:-1;})()`);
const zoomPct = async () => { const s = await js(`(function(){var v=document.querySelector('[data-testid="mm-zoom"]');return v?(v.textContent||'').trim():null;})()`); const n = parseFloat(String(s).replace("%", "")); return Number.isFinite(n) ? n : NaN; };
const drainLog = async () => { const l = await js(`window.__wheelLog.slice()`); await js(`window.__wheelLog.length = 0`); return l; };
const resetCounter = async () => { await js(`(function(){var s=window.__mmStats;if(s&&s.wheel)s.wheel.zoomed=0;return 1;})()`); };

/* 归位 1:1 ⇒ 两个方向都有空间（ZOOM_MIN=0.1 / ZOOM_MAX=3），读数与起点无关 */
await js(`(function(){var b=document.querySelector('[data-testid="mm-zoom-100"]');if(b)b.click();return 1;})()`);
await sleep(300);

const GEOM = await js(`(function(){
  var r = document.getElementById("dsh-mindmap"); if(!r) return null;
  var b = r.getBoundingClientRect();
  var cx = Math.round(b.x + b.width/2), cy = Math.round(b.y + b.height/2);
  var e1 = document.elementFromPoint(cx, cy);
  var node = document.querySelector('[data-testid="mm-node"]'); var e2 = null, ncx=null, ncy=null;
  if (node) { var nb = node.getBoundingClientRect(); if (nb.width>0 && nb.height>0) { ncx = Math.round(nb.x+nb.width/2); ncy = Math.round(nb.y+nb.height/2); e2 = document.elementFromPoint(ncx, ncy); } }
  var d = function(e){ return e ? ((e.tagName||"?") + (e.id ? "#"+e.id : "") + (e.getAttribute&&e.getAttribute("data-testid") ? "["+e.getAttribute("data-testid")+"]" : "")) : null; };
  return { cx: cx, cy: cy, atCenter: d(e1), centerInRoot: !!(e1 && (e1===r || r.contains(e1))),
           nodePt: ncx===null?null:{x:ncx,y:ncy}, atNode: d(e2), nodeInRoot: !!(e2 && (e2===r || r.contains(e2))) };
})()`);
console.log("\n  落点几何：" + JSON.stringify(GEOM));

/* ══════════ ④ 四组实验 ══════════
 *  A 合成 WheelEvent（**正对照**：事件 100% 到达）—— 证明「处理器本身是否可用」
 *  B CDP 真派发 @ 画布中心 + Ctrl（复刻套件里的失败样本）
 *  C CDP 真派发 @ 节点中心 + Ctrl（排除"落点被盖住"）
 *  D CDP 真派发 @ 画布中心 + 无修饰键（**负对照**：不该缩放）
 *  每组都：归零计数 → 记录起点 → 动作 → **轮询**最多 6s → 记录到达的 wheel 事件。 */
const results = [];
async function runCase(name, act, note) {
	await resetCounter();
	const p0 = await zoomPct();
	const t0 = Date.now();
	const actRet = await act();
	let landedAt = null, p1 = p0, n1 = 0;
	for (let i = 0; i < 24; i++) {          // 24 × 250ms = 6s
		await sleep(250);
		n1 = await wheelN(); p1 = await zoomPct();
		if (n1 > 0 || p1 !== p0) { landedAt = Date.now() - t0; break; }
	}
	const log = await drainLog();
	results.push({ name, note, p0, p1, counterAfter: n1, landedAt, cdp: actRet, events: log });
	console.log("\n  ── " + name + " ──");
	console.log("     落点/动作：" + note);
	if (actRet && actRet.cdp) console.log("     CDP 响应：" + (actRet.cdp.ok ? "ok " : "❌ " + actRet.cdp.err + " ") + actRet.cdp.ms + " ms");
	console.log("     缩放：" + p0 + "% → " + p1 + "% ｜ 计数=" + n1 + " ｜ 落地耗时=" + (landedAt === null ? "**6s 内未落地**" : landedAt + "ms"));
	console.log("     到达的 wheel 事件（" + log.length + " 个）：" + (log.length ? JSON.stringify(log) : "**一个都没到**"));
	return results[results.length - 1];
}

/* A · 正对照：合成事件打在 elementFromPoint 命中的元素上 */
await runCase("A 合成 WheelEvent（正对照）", async () => ({
	cdp: null,
	synth: await js(`(function(){
    var r = document.getElementById("dsh-mindmap"); var b = r.getBoundingClientRect();
    var el = document.elementFromPoint(Math.round(b.x+b.width/2), Math.round(b.y+b.height/2)) || r;
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
    return (el.tagName||"?") + (el.getAttribute&&el.getAttribute("data-testid") ? "["+el.getAttribute("data-testid")+"]" : "");
  })()`),
}), "`new WheelEvent('wheel',{deltaY:120,ctrlKey:true})` 派发到画布中心元素（不看 isTrusted ⇒ 处理器好就会响应）");

/* B · CDP 真派发 @ 画布中心 + Ctrl */
await runCase("B CDP 真派发 @画布中心 +Ctrl", async () => ({
	cdp: await timedSend("Input.dispatchMouseEvent", { type: "mouseWheel", x: GEOM.cx, y: GEOM.cy, deltaX: 0, deltaY: 120, modifiers: 2 }),
}), "`emit` 等价写法（不 await 响应）改用计时版，量 CDP 响应延迟");

/* C · CDP 真派发 @ 节点中心 + Ctrl（排除"落点被别的层盖住"） */
if (GEOM.nodePt) {
	await runCase("C CDP 真派发 @节点中心 +Ctrl", async () => ({
		cdp: await timedSend("Input.dispatchMouseEvent", { type: "mouseWheel", x: GEOM.nodePt.x, y: GEOM.nodePt.y, deltaX: 0, deltaY: 120, modifiers: 2 }),
	}), "落点 " + JSON.stringify(GEOM.atNode) + "（inRoot=" + GEOM.nodeInRoot + "）");
} else { console.log("\n  ── C 跳过：画布上没有坐标可用的节点 ──"); }

/* D · 负对照：无修饰键 ⇒ 不该缩放 */
await runCase("D CDP 真派发 @画布中心 无修饰键（负对照）", async () => ({
	cdp: await timedSend("Input.dispatchMouseEvent", { type: "mouseWheel", x: GEOM.cx, y: GEOM.cy, deltaX: 0, deltaY: 120, modifiers: 0 }),
}), "负对照：`MindMap.js#onWheel` 里 `if(!(e.ctrlKey||e.metaKey))return;` ⇒ 计数与读数都**不该**变");

/* ══════════ ⑤ 结论收敛 ══════════ */
console.log("\n══════════ ⑤ 结论矩阵 ══════════");
const A = results.find((r) => r.name.startsWith("A"));
const B = results.find((r) => r.name.startsWith("B"));
const D = results.find((r) => r.name.startsWith("D"));
const aOk = !!(A && A.counterAfter > 0);
const bOk = !!(B && B.counterAfter > 0);
const dOk = !!(D && D.counterAfter === 0);
console.log("  A 合成事件能缩放（处理器本身好） ：" + (aOk ? "✅ 是" : "❌ 否"));
console.log("  B CDP 真派发能缩放               ：" + (bOk ? "✅ 是" : "❌ 否"));
console.log("  D 裸滚轮不缩放（负对照）         ：" + (dOk ? "✅ 成立" : "❌ 不成立"));
console.log("  ── 唯一结论 ──");
if (aOk && !bOk) {
	console.log("  ⇒ **产品处理器是好的**；坏在 **CDP/派发链**（或落点/修饰键未生效）。");
	console.log("     下一步：查 B 组 `到达的 wheel 事件` 是否为 0 ——");
	console.log("       为 0 ⇒ 事件没送达（合成器/可见性问题）⇒ 先修环境（bringToFront/可见性），不要改产品；");
	console.log("       >0 但 ctrl=false ⇒ **`modifiers` 没传到事件上** ⇒ 改用 `Input.dispatchKeyEvent` 真按 Ctrl 或改判据口径。");
} else if (!aOk) {
	console.log("  ⇒ 合成事件都不响应 ⇒ 问题在**落点/containment**（事件到了但 `e.target` 不在 `#dsh-mindmap` 内）");
	console.log("     或处理器根本没挂上（看 A 组的 events[].inRoot / tgt）。");
} else if (aOk && bOk) {
	console.log("  ⇒ 两者都行 ⇒ 之前是**读法问题**（固定 sleep 读太早）⇒ 套件里改成「轮询直到计数变化」。");
} else {
	console.log("  ⇒ 两者都不行且 D 也不成立 ⇒ 处理器/计数链整体可疑，回看 MindMap.js#onWheel。");
}
try { await js(`(function(){if(window.__wheelProbeOff)window.__wheelProbeOff();return 1;})()`); } catch (e) { /* 收尾 */ }
if (wsErr) console.log("  ⚠️ WebSocket 错误：" + wsErr);
ws.close();
console.log("\nIS_PASS: TRUE（诊断探针 · 无断言）");
process.exit(0);
