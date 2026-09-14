/**
 * probe-window-state.mjs — 窗口可见性 / 原生窗口控件覆盖层（WCO）/ 合成可用性 三合一诊断
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它（2026-09-14 用一整轮真机迭代换来的）
 * ══════════════════════════════════════════════════════════════════
 *  真机 e2e 出现"摸不着头脑"的失败时，**第一件事是分清下面三种状态**，否则会朝错方向修：
 *
 *   ① 渲染进程**主线程被占住**（真卡死）：`Runtime.enable` / `Page.getFrameTree` 全超时，
 *      `document.visibilityState` 通常仍是 "visible"。
 *   ② 渲染进程正常，但**窗口没被合成**（最小化/隐藏）：`Runtime.evaluate` 2ms 就返回，
 *      而 `Page.captureScreenshot` **永久挂起**（合成器不出帧）。
 *      实测 `screenX = screenY = -32000`（Windows 最小化约定）、`visibilityState = "hidden"`。
 *      ⚠️ 这一种最容易被误诊成 ① —— 处方完全不同（① 要重启，② 只要把窗口弄回前台）。
 *   ③ 窗口可见但**没有原生窗口控件覆盖层**（WCO `visible === false`，`getTitlebarAreaRect()`
 *      回 `{width:0}`）：此时"右侧 137px 被系统按钮独占"这一物理事实**不存在**，
 *      任何"避开安全区"的越界断言都会**恒真/恒假**（平凡真/假）⇒ 该判 SKIP 而不是判红。
 *
 *  三种状态的副作用各不相同，务必分清：
 *   · 状态②下 Chromium 会把隐藏页的 `setTimeout` **对齐到 1s 桶**
 *     ⇒ 2500ms 的定时器实测 +3329ms 才触发 ⇒「2.5s 内二次确认」这类闸门会**假红**。
 *   · 状态②下 `Page.captureScreenshot` 不可用 ⇒ 视觉复验（纪律 5）做不了。
 *   · 状态③下安全区类断言失去测试面。
 *
 * ── 处置（状态②：给窗口"弄回前台"）─────────────────────────────
 *   最省事且只用本项目工具的办法：**再启动一次 exe**。Electron 单实例锁会把
 *   second-instance 交给已运行实例，标准实现就是 `win.restore(); win.focus();`
 *   ⇒ 窗口从最小化恢复、并成为前台窗口（实测 `screenX=232, screenY=56, visibility=visible`）。
 *   （`Page.bringToFront` **无效**：它不改窗口的最小化状态。Win32/COM 方案已被本机策略拦。）
 *   ⚠️ 另一条死路（别再试）：本 Electron 构建**没有** `Browser.getWindowForTarget` /
 *      `Browser.setWindowBounds`（连浏览器级 endpoint 也回 `-32601 wasn't found`），
 *      所以"用 CDP 把窗口恢复正常"这条路走不通 —— 只能靠第二次启动触发 restore。
 *
 * 用法：node scripts/probe-window-state.mjs
 * 退出码：0 = 窗口可合成（三种状态都打印，供人判断）；2 = 连不上 CDP（用法/环境问题）
 */
const PORT = Number(process.env.CDP_PORT || 9222);

let targets;
try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
catch (e) {
	console.error(`❌ 连不上 CDP（127.0.0.1:${PORT}）：${String((e && e.message) || e)}`);
	console.error(`   自检：curl -s http://127.0.0.1:${PORT}/json/version   目标端口不符请设 CDP_PORT=<port>`);
	console.error(`   未启动请用：powershell -ExecutionPolicy Bypass -File scripts/restart-harness.ps1`);
	process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("❌ /json/list 里没有 page 目标（窗口没开？）"); process.exit(2); }

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
const T = Number(process.env.CDP_TIMEOUT_MS || 10000);
const wt = (p, l) => new Promise((res, rej) => {
	const h = setTimeout(() => rej(new Error("timeout " + l)), T);
	if (h.unref) h.unref();
	p.then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
});

await new Promise((r) => ws.addEventListener("open", r));
await wt(send("Runtime.enable"), "Runtime.enable");

const VIS = `(function(){
  var wco = navigator.windowControlsOverlay;
  var r = null; try { r = wco ? wco.getTitlebarAreaRect() : null; } catch (e) {}
  return {
    visibility: document.visibilityState, hidden: document.hidden, focus: document.hasFocus(),
    screenX: window.screenX, screenY: window.screenY,
    innerW: window.innerWidth, innerH: window.innerHeight,
    outerW: window.outerWidth, outerH: window.outerHeight,
    wcoPresent: !!wco, wcoVisible: wco ? wco.visible : null,
    rectW: r ? Math.round(r.width) : null, rectH: r ? Math.round(r.height) : null,
    inset: (wco && wco.visible === true && r && r.width > 0 && window.innerWidth > 0)
      ? Math.round(window.innerWidth - r.width) : 0
  };
})()`;

let vis = null;
try { vis = (await wt(send("Runtime.evaluate", { expression: VIS, returnByValue: true }), "vis")).result.value; }
catch (e) {
	/* 只有这一条也超时，才说明是状态 ① */
	console.error("① Runtime.evaluate 超时 ⇒ 渲染进程**主线程被占住**（真卡死，不是窗口问题）。");
	console.error("   处置：taskkill /F /IM \"DeepSeek Harness.exe\" 后重新用 restart-harness.ps1 启动，再重跑。");
	process.exit(1);
}
console.log("窗口与渲染进程：", JSON.stringify(vis));

/* 合成可用性：captureScreenshot 走合成器，是"窗口有没有真的在出帧"的唯一硬证据 */
let compositing = false;
try { const s = await wt(send("Page.captureScreenshot", { format: "png" }), "shot"); compositing = !!(s && s.data); }
catch (e) { compositing = false; }

console.log("──────────────────────────────────────────────");
if (vis.screenX <= -30000 && vis.screenY <= -30000) {
	console.log("🔴 状态②：**窗口最小化**（screenX/screenY = -32000，Windows 约定）");
} else if (vis.hidden) {
	console.log("🔴 状态②：**窗口隐藏/未上屏**（visibilityState = hidden）");
} else {
	console.log("✅ 窗口可见（visibilityState = " + vis.visibility + "）");
}
console.log((compositing ? "✅" : "🔴") + " 合成：" + (compositing ? "可出帧（截图可用 ⇒ 视觉复验能做）" : "不出帧（Page.captureScreenshot 挂起）"));
console.log((vis.wcoVisible === true ? "✅" : "⏭️") + " WCO 覆盖层：" + (vis.wcoVisible === true
	? "可见，安全区 inset = " + vis.inset + "px（安全区类断言有判别力）"
	: "不可见 ⇒ 无原生窗口控件需避让，安全区类断言应判 SKIP（否则是平凡真/假）"));
if (!compositing || vis.hidden) {
	console.log("──────────────────────────────────────────────");
	console.log("处置（状态②）：**再启动一次 exe** 即可 —— 单实例锁会把 second-instance 交给");
	console.log("已运行实例，标准实现即 win.restore() + win.focus()，窗口会从最小化恢复并置前。");
	console.log("  cd \"D:\\软件安装\\DeepSeek-Harness-Desktop\\DeepSeek Harness\" && \"./DeepSeek Harness.exe\"");
	console.log("（Page.bringToFront 无效：它不改最小化状态。）");
}
ws.close();
process.exit(0);
