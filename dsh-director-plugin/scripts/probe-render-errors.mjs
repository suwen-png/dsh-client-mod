#!/usr/bin/env node
/**
 * probe-render-errors.mjs — 抓「组件渲染抛错」的**错误原文**（诊断用，不改任何产品状态）
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么必须有这个工具（2026-09-14 真实教训）
 * ──────────────────────────────────────────────────────────────────
 *  现象：真机 verify-flow 从 A2「总监页已挂载（dp-root 出现）」起大面积红（18/34/4），
 *        但 `window.__dshDirectorView` 明确是 `{registered:true,...}`，注册**成功**。
 *  现场：视图区 DOM 是
 *          <div data-slot="conversation.view"><div data-slot-error="conversation.view"></div></div>
 *        —— `data-slot-error` 是**宿主错误边界的兜底产物**，说明本方组件**在渲染期抛了**。
 *  难点：① 错误发生在页面加载早期，比任何"进页面再装钩子"的探针都早；
 *        ② React 错误边界会把错误**缓存**住 —— 事后切换页签**不会重抛**，
 *           于是「再点一次」这个直觉动作**永远抓不到东西**（实测 probe 计数恒为 0）。
 *  ⇒ 唯一可行的取法：**在文档创建之前**注入钩子（`Page.addScriptToEvaluateOnNewDocument`），
 *    再 `Page.reload`，让错误第一次发生时就落在钩子里。
 *
 * ══════════════════════════════════════════════════════════════════
 *  用法
 * ──────────────────────────────────────────────────────────────────
 *    node scripts/probe-render-errors.mjs                 # 注入钩子 + 重载 + 采集（默认）
 *    node scripts/probe-render-errors.mjs --wait 12000     # 自定义采集时长（默认 9000ms）
 *    node scripts/probe-render-errors.mjs --no-reload      # 只装钩子不重载（页面自己再抛时才有效）
 *
 *  退出码：0 = 无渲染错误（dp-root 正常） / 1 = 抓到渲染错误 / 2 = INVALID（CDP 连不上或用法错）
 *
 * ══════════════════════════════════════════════════════════════════
 *  三条纪律（踩过才写的）
 * ──────────────────────────────────────────────────────────────────
 *  ① 每个 CDP 调用都有硬超时。渲染进程挂死时浏览器进程仍正常回 HTTP，
 *     没有超时的等待会把"挂死"伪装成"正在跑"（cdp-eval.mjs 头注有完整记录）。
 *  ② 采到的错误**原样打印、不截断到看不清栈**（栈的前 8 行足够定位，故保留 8 行）。
 *  ③ 本工具**只读**：不点保存、不写 localStorage、不改 store。重载页面属宿主的正常操作。
 */
const PORT = 9222;
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
	const i = argv.indexOf(name);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
if (argv.some((a) => a === "--help" || a === "-h")) {
	console.log("用法: node scripts/probe-render-errors.mjs [--wait 9000] [--no-reload]");
	process.exit(0);
}
const WAIT_MS = Math.max(1000, Number(argOf("--wait", "9000")) || 9000);
const DO_RELOAD = !argv.includes("--no-reload");
const CALL_TIMEOUT = 8000;
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 1. CDP 接线（连不上判 INVALID，不判产品坏 —— 纪律 17） ── */
let pages;
try {
	pages = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=9222 启动。");
	console.error("  正确用法（必须后台启动，且清掉两个环境变量）：");
	console.error("    powershell -File scripts/restart-harness.ps1");
	console.error("    node scripts/probe-render-errors.mjs");
	process.exit(2);
}
const page = pages.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) {
	console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）");
	console.error("  无 page 型目标通常意味着 Harness 只剩主进程，渲染进程已退出。");
	console.error("  正确用法：powershell -File scripts/restart-harness.ps1");
	process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const collected = []; // {kind, text}
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.method === "Runtime.consoleAPICalled" && /error|warning/.test(String(m.params.type))) {
		const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.preview?.description ?? "").join(" ");
		collected.push({ kind: "console." + m.params.type, text: String(text) });
	}
	if (m.method === "Runtime.exceptionThrown") {
		const d = m.params.exceptionDetails || {};
		const stack = (d.stackTrace && d.stackTrace.callFrames || [])
			.slice(0, 8)
			.map((f) => "      at " + (f.functionName || "<anon>") + " (" + (f.url || "") + ":" + f.lineNumber + ":" + f.columnNumber + ")")
			.join("\n");
		collected.push({ kind: "exception", text: (d.exception && (d.exception.description || d.exception.value)) || d.text || "?", stack });
	}
	if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
		collected.push({ kind: "log." + m.params.entry.source, text: String(m.params.entry.text || "") });
	}
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id);
		pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	const timer = setTimeout(() => {
		pending.delete(id);
		rej(new Error("CDP_TIMEOUT " + method + "（渲染进程 " + CALL_TIMEOUT + "ms 内未响应 ⇒ 主线程可能被同步循环占住）"));
	}, CALL_TIMEOUT);
	pending.set(id, {
		res: (v) => { clearTimeout(timer); res(v); },
		rej: (err) => { clearTimeout(timer); rej(err); }
	});
	ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
	if (r.exceptionDetails) throw new Error("eval 抛错: " + (r.exceptionDetails.text || "") + " " + ((r.exceptionDetails.exception || {}).description || ""));
	return r.result && r.result.value;
};

await new Promise((r) => ws.addEventListener("open", r));

/* ── 2. 页面加载前注入钩子 ──
 * 必须在 new document 阶段执行：错误边界缓存 + 早期抛错两个特性共同决定"事后装钩子"没用。 */
const HOOK_SRC = [
	"(function(){",
	"  if (window.__dshRenderProbe) return;",
	"  window.__dshRenderProbe = [];",
	"  function push(kind, parts) {",
	"    try { window.__dshRenderProbe.push({ kind: kind, text: parts.join(' ') }); } catch (e) {}",
	"  }",
	"  function fmt(x) {",
	"    try {",
	"      if (typeof x === 'string') return x;",
	"      if (x && x.stack) return String(x.stack);",
	"      if (x && x.message) return String(x.message);",
	"      return JSON.stringify(x);",
	"    } catch (e) { return String(x); }",
	"  }",
	"  var oe = console.error;",
	"  console.error = function () {",
	"    var a = [].slice.call(arguments);",
	"    push('console.error', a.map(fmt));",
	"    return oe.apply(console, arguments);",
	"  };",
	"  window.addEventListener('error', function (e) {",
	"    push('window.onerror', [String((e.error && e.error.stack) || e.message || '')]);",
	"  });",
	"  window.addEventListener('unhandledrejection', function (e) {",
	"    push('unhandledrejection', [String((e.reason && e.reason.stack) || e.reason || '')]);",
	"  });",
	"})();"
].join("\n");

let hookId = null;
try {
	await send("Runtime.enable");
	await send("Log.enable");
	await send("Page.enable");
	const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK_SRC });
	hookId = r && r.identifier;
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：CDP 域启用失败）");
	console.error("  真因：" + String((e && e.message) || e));
	console.error("  正确用法：powershell -File scripts/restart-harness.ps1 后重跑本脚本。");
	process.exit(2);
}

console.log("探针已挂载（hook=" + (hookId || "?") + "）· 目标端口 " + PORT + " · 页面 " + page.url);
if (DO_RELOAD) {
	try {
		await send("Page.reload", { ignoreCache: false });
		console.log("已重载页面，开始采集 " + WAIT_MS + "ms …\n");
	} catch (e) {
		console.error("IS_PASS: FALSE（INVALID：Page.reload 失败）");
		console.error("  真因：" + String((e && e.message) || e));
		process.exit(2);
	}
} else {
	console.log("未重载（--no-reload）；仅当页面**再次**抛错时钩子才会记录。\n");
}

await WAIT(WAIT_MS);

/* ── 3a. 准备「能渲染」的现场 ──
 * 🔴 为什么必须补这一步（本工具首版就是这么误导自己的）：
 *    ① 宿主 `conversation.view` 是 **list slot**，渲染条件是 `renderSlot(..., { only: active.id })`
 *       ⇒ **非激活页签根本不渲染组件**。新会话默认停在「对话」。
 *    ② 更前一步：**没有打开任何会话时**（欢迎页）连 tab 环都不存在
 *       ⇒ 连"激活页签"这个动作都无从谈起。
 *    首版在"欢迎页 + 页签未选中"的状态下判 `dp-root 缺失`，读起来像"组件挂载失败"，
 *    实际是**根本没轮到渲染**。⇒ 先把两件前置做好，再判渲染；做不到就报**可分辨的原因**
 *    （纪律 18：「跳过」必须带可分辨原因，不许用不可证伪的话收尾）。
 *
 * ⚠️ 本步骤会**打开一个会话**（真实点击左栏的会话行）——这是宿主的正常用户操作，
 *    不写任何插件 store、不动 localStorage 里的 dsh_director_* 持久化内容。 */
const fire = (method, params) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); };
/** 真实鼠标点击（坐标现取现用；命中自检通过才点）。Input 的**响应**在本机约 5s 才回
 *  （见 verify-flow 头注），故一律 fire-and-forget，事件本身立即送达，成败由随后 ev() 回读判定。 */
const realClick = async (x, y) => {
	fire("Input.dispatchMouseEvent", { type: "mouseMoved", x: x, y: y, button: "none" });
	await WAIT(18);
	fire("Input.dispatchMouseEvent", { type: "mousePressed", x: x, y: y, button: "left", clickCount: 1, buttons: 1 });
	await WAIT(18);
	fire("Input.dispatchMouseEvent", { type: "mouseReleased", x: x, y: y, button: "left", clickCount: 1, buttons: 0 });
};
/** 找到第一个"满足谓词 + 视口内 + elementFromPoint 命中自己"的元素的中心坐标（纪律 22）。
 *  @param {string} predJs 谓词体，可用变量 e；不得含反引号（会提前闭合本字符串）。 */
const findBox = async (predJs) => {
	const raw = await ev(
		"(function(){" +
		"  var list = [].slice.call(document.querySelectorAll('*'));" +
		"  for (var i = 0; i < list.length; i++) {" +
		"    var e = list[i];" +
		"    try { if (!(" + predJs + ")) continue; } catch (err) { continue; }" +
		"    var r = e.getBoundingClientRect();" +
		"    if (r.width < 4 || r.height < 4) continue;" +
		"    var cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);" +
		"    if (!(cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight)) continue;" +
		"    var h = document.elementFromPoint(cx, cy);" +
		"    if (!(h && (h === e || e.contains(h) || h.contains(e)))) continue;" +
		"    return JSON.stringify({ cx: cx, cy: cy, w: Math.round(r.width), h: Math.round(r.height)," +
		"      label: (e.textContent || '').trim().slice(0, 24) });" +
		"  }" +
		"  return JSON.stringify(null);" +
		"})()"
	);
	return raw ? JSON.parse(raw) : null;
};
const hasSlot = async () => ev("!!document.querySelector('[data-slot=\"conversation.view\"]')");

const prep = [];
/* 3a-1 若还停在欢迎页（无 conversation.view 槽），先打开一个**真实**会话 */
if (!(await hasSlot())) {
	const row = await findBox(
		"e.className && /sessionRow/.test(String(e.className)) && (e.textContent || '').trim() !== '新会话' && (e.textContent || '').trim().length > 0"
	);
	if (!row) {
		prep.push("未能在左栏找到可打开的会话行（会话列表可能尚未渲染完）");
	} else {
		await realClick(row.cx, row.cy);
		await WAIT(1800);
		prep.push("已打开会话「" + row.label + "」@ " + row.cx + "," + row.cy + (await hasSlot() ? "（conversation.view 槽已出现）" : "（⚠️ 点击后槽仍未出现）"));
	}
} else {
	prep.push("已有打开的会话（conversation.view 槽在场）");
}
/* 3a-2 激活「总监」页签（精确文本匹配，天然排除浮动入口的 `◆总监`） */
let actNote;
const tab = await findBox("e.tagName === 'BUTTON' && (e.textContent || '').trim() === '总监'");
if (!tab) {
	actNote = "未找到「总监」页签（宿主 tab 环未渲染 ⇒ 先看上一行的会话是否打开成功）";
} else {
	await realClick(tab.cx, tab.cy);
	await WAIT(1500);
	const sel = await ev(
		"(function(){var bs=[].slice.call(document.querySelectorAll('button')).filter(function(b){return (b.textContent||'').trim()==='总监';});" +
		"return bs.length ? String(bs[0].getAttribute('aria-selected')) : 'none';})()"
	);
	actNote = "已真实点击「总监」页签 @ " + tab.cx + "," + tab.cy + "（" + tab.w + "×" + tab.h + "）· aria-selected=" + sel;
}

/* ── 3b. 采集收尾：读钩子数组 + 现场 DOM 判据 ──
 * 两条判据互不替代：钩子给"为什么错"，DOM 给"错成了什么样"。 */
let hookEntries = [];
let dom = null;
try {
	hookEntries = (await ev("JSON.stringify(window.__dshRenderProbe || [])")) || "";
	hookEntries = JSON.parse(hookEntries);
} catch (e) {
	hookEntries = [{ kind: "probe-unreadable", text: "读 window.__dshRenderProbe 失败：" + String((e && e.message) || e) }];
}
try {
	const raw = await ev(
		"JSON.stringify({" +
		"  dpRoot: !!document.querySelector('[data-testid=dp-root]')," +
		"  slotError: !!document.querySelector('[data-slot-error]')," +
		"  slotErrorSlot: (function(){var e=document.querySelector('[data-slot-error]');return e?e.getAttribute('data-slot-error'):null;})()," +
		"  viewReg: (function(){try{return JSON.stringify(window.__dshDirectorView||null);}catch(e){return 'err';}})()," +
		"  active: [].slice.call(document.querySelectorAll('[aria-selected=true]')).map(function(e){return (e.textContent||'').trim();})," +
		"  viewAreaHTML: (function(){var v=document.querySelector('[class*=viewArea]');return v?v.innerHTML.slice(0,400):null;})()" +
		"})"
	);
	dom = JSON.parse(raw);
} catch (e) {
	dom = { error: String((e && e.message) || e) };
}

/* ── 4. 汇报 ── */
console.log("═══ 现场 DOM ═══");
for (const s of prep) console.log("  现场准备         : " + s);
console.log("  页签激活         : " + actNote);
console.log("  dp-root          : " + (dom.dpRoot ? "存在 ✅" : "缺失 ❌"));
console.log("  宿主错误边界残留 : " + (dom.slotError ? "有（data-slot-error=\"" + dom.slotErrorSlot + "\"）" : "无"));
console.log("  注册句柄         : " + dom.viewReg);
console.log("  当前激活页签     : " + JSON.stringify(dom.active));
if (dom.viewAreaHTML) console.log("  视图区 HTML      : " + dom.viewAreaHTML);

const all = collected
	.map((c) => ({ kind: c.kind, text: c.text, stack: c.stack }))
	.concat(hookEntries.map((h) => ({ kind: "hook:" + h.kind, text: h.text })));

/* 过滤与产品无关的噪声（网络层 / favicon）—— 与 verify-flow E1 同口径 */
const noise = /favicon|net::ERR|Failed to load resource|DevTools/i;
const real = all.filter((c) => !noise.test(c.text));

console.log("\n═══ 采到的错误（原始 " + all.length + " 条 / 去噪后 " + real.length + " 条）═══");
if (!real.length) {
	console.log("  （无）");
} else {
	real.slice(0, 8).forEach((c, i) => {
		console.log("\n  [" + (i + 1) + "] " + c.kind);
		console.log("      " + String(c.text).split("\n").slice(0, 8).join("\n      "));
		if (c.stack) console.log(c.stack);
	});
}

const ok = real.length === 0 && dom.dpRoot;
/* 🔴 三种"红"必须给**三种不同的**结论与退出码 —— 否则"前提没做到"会被读成"渲染炸了"，
 *    排查方向直接跑偏（本工具首版就是这么误导自己的：停在欢迎页 / 页签未选中，
 *    根本没轮到渲染，却一律报"dp-root 缺失"）。
 *    INVALID(2) 与 FAIL(1) 必须分开 —— 纪律 17。 */
let verdict, code;
if (ok) { verdict = "TRUE（无渲染错误，dp-root 正常挂载）"; code = 0; }
else if (real.length) { verdict = "FALSE（有 " + real.length + " 条错误 ⇒ 见上方原文）"; code = 1; }
else if (!tab) { verdict = "INVALID（前提未满足：未进入可判定状态 ⇒ 见上方「现场准备」）"; code = 2; }
else { verdict = "FALSE（**零错误**但 dp-root 未挂载 ⇒ 组件未被渲染到；先看上方「页签激活」那一行）"; code = 1; }
console.log("\nIS_PASS: " + verdict);
console.log("退出码：" + code);
process.exit(code);
