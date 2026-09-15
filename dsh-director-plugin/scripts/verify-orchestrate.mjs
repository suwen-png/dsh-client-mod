#!/usr/bin/env node
/**
 * verify-orchestrate.mjs — 真机端到端：编排面板（V21 多智能体编排架构补全）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这个闸门要证明什么
 * ──────────────────────────────────────────────────────────────────
 *  `OrchestratorPanel` 是新加的**界面**，而界面"逻辑全绿"不等于"点了真有反应"。
 *  故本脚本每一项都走三段：**点击前回读 → 真实坐标点击 → 点击后回读**，并断言差值。
 *
 *  🔴 关键纪律：**数字一律同源对账，不硬编码**
 *    面板上每个数字都应由 `roles.js / dag.js / policy.js / verify.js` 现场算出。
 *    所以闸门也从**同一批模块** import 期望值，再与 DOM 回读值比对：
 *      - 4 层       ← LAYERS.length
 *      - 12 角色    ← BUILTIN_ROLES.length
 *      - 波数/节点数 ← planWaves(normalizeGraph(DIRECTOR_CHAIN))
 *      - L1 字符数  ← l1Budget()
 *      - 5 种机械断言 ← ASSERT_KEYS
 *    硬编码的期望值会随产品改动立刻假红（`verify-design-studio` 曾把 20 个元素写成 19）。
 *
 *  覆盖：
 *    O0 前置（起点等价 / dp-root 挂载）
 *    OA 入口按钮（可视 · 语义 · 未被原生窗口控件遮挡 · 真实点击开面板 · scope）
 *    OB 四页签逐点（真实点击 → data-tab 变）
 *    OC 四层组织（4 层 / 12 角色 / 点角色出角色卡）
 *    OD 执行图（波数 · 节点数 · id 集合 / 并行度差距公开声明）
 *    OE 策略与预算（模式 ∈ MODES / 判定理由 / L1 预算同源）
 *    OF 验收标准（5 种机械断言 / 三态标签）
 *    OG 两个真按钮（导出计划 / 生成简报 —— 反馈不静默 + 自动消失）
 *    OH 互斥与开合（与「个性化设定」互斥 · 可重复开合 · ✕ 关闭）
 *    OI 落点自检 + 收尾复原（起点等价，杜绝跨运行污染）
 *
 * 用法：node scripts/verify-orchestrate.mjs
 * 退出码：0 全绿 / 1 有失败 / 2 INVALID（CDP 连不上 / 总监页未挂载）
 */
import { LAYERS, BUILTIN_ROLES, l1Budget } from "../src/logic/roles.js";
import { normalizeGraph, planWaves } from "../src/logic/dag.js";
import { MODES } from "../src/logic/policy.js";
import { ASSERT_KEYS, LABEL } from "../src/logic/verify.js";
import { DIRECTOR_CHAIN } from "../src/logic/director-chain.js";

const PORT = 9222;

/* ── 期望值：全部从源码算，不写死 ── */
const EXP_LAYERS = LAYERS.map((x) => x.key).sort();
const EXP_ROLES = BUILTIN_ROLES.length;
const EXP_GRAPH = normalizeGraph(DIRECTOR_CHAIN);
const EXP_WAVES = planWaves(EXP_GRAPH, { concurrency: 2 });
const EXP_NODES = EXP_GRAPH.map((s) => s.id).sort();
const EXP_L1 = l1Budget();
const EXP_MODE_KEYS = MODES.map((m) => m.key);

/* 🔴 纪律 17：连不上判 INVALID(2)，不判 FAIL(1) —— "没开环境"和"产品坏了"必须能分开 */
let targets;
try {
	targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=9222 启动。");
	console.error("  正确用法（必须先清掉 ELECTRON_RUN_AS_NODE，否则 Electron 以纯 Node 秒退）：");
	console.error("    env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \"./DeepSeek Harness.exe\" --remote-debugging-port=9222");
	console.error("    node scripts/verify-orchestrate.mjs");
	process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

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
/* 🔴 CDP 调用必须有硬超时 + 断连看门狗（纪律 B / 17）：
 *   实测本工具会话下 Harness **无法常驻**，常在测试中途退出。
 *   此时主流程会卡在 await 上，Node 只丢一句 "unsettled top-level await" 后 exit 13 ——
 *   读起来像"脚本坏了"，完全看不出真因。
 *   ⇒ ① 每次 Runtime 调用带超时，不无限挂；② 连接一断就判 INVALID(2) 并给可复制命令。 */
const send = (method, params = {}, timeoutMs = 8000) => new Promise((res, rej) => {
	const id = ++seq;
	const timer = setTimeout(() => { pending.delete(id); rej(new Error("CDP 调用超时: " + method)); }, timeoutMs);
	pending.set(id, {
		res: (v) => { clearTimeout(timer); res(v); },
		rej: (e) => { clearTimeout(timer); rej(e); }
	});
	ws.send(JSON.stringify({ id, method, params }));
});
/* fire-and-forget：本 Electron 环境 Input.* 的**响应**稳定延迟约 5s，事件本身立即送达。
 * 坐标点击绝不能 await Input 响应，否则一次点击串行 3 个事件要 15s。 */
const emit = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); };
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

/* 断连看门狗：Harness 中途退出 ⇒ 报 INVALID，不当成产品缺陷，也不留无头绪的 exit 13 */
let wsClosed = false;
ws.addEventListener("close", () => { wsClosed = true; });
setInterval(() => {
	if (!wsClosed) return;
	console.error("\nIS_PASS: FALSE（INVALID：测试中途 CDP 连接断开 —— Harness 退出了，属环境问题，非产品缺陷）");
	console.error("  本工具会话下 Harness 无法常驻，须**同一条命令内**先启动再测试：");
	console.error("    ( cd \"/d/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness\" && env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \"./DeepSeek Harness.exe\" --remote-debugging-port=9222 & )");
	console.error("    sleep 14 && node scripts/verify-orchestrate.mjs");
	process.exit(2);
}, 400);

async function js(expr) {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	if (r.exceptionDetails) throw new Error("JS异常: " + r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
	return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 等一次「刚重载」再开测（本轮新增，实测踩到的最大不稳定源）──
 * 证据链（不是猜的）：
 *   ① `verify-orchestrate` 连跑时 1/4 概率整段取到 null，心跳显示 page origin 变了 **两次**
 *      （间隔 25.2s / 23.7s）；
 *   ② 于是写 `probe-reload-period.mjs` 做**空载对照** —— 全程不点任何东西、不开面板，
 *      70s 内仍重载 1 次（间隔 38.4s），且**捕获到 0 条 error/warning**。
 *   ⇒ 重载是 app 自身的周期性行为（**环境**），不是本插件把渲染进程搞崩（产品）。
 *     两者读数一样，只能靠空载对照分开 —— 这也是为什么必须留下这个探针。
 *
 * 对策：本闸门**不与该周期赛跑**，但也不白等 —— 按「页面年龄」决策：
 *   `performance.timeOrigin` 是导航起点的 Unix 毫秒，`Date.now() - origin` 就是**页面已活了多久**。
 *   ⓐ 年龄 < FRESH_MS ⇒ 页面还新鲜，直接开测（跑程大概率落在窗口内）
 *   ⓑ 年龄 ≥ FRESH_MS ⇒ 已经偏老，等下一次重载再从零开测（只在这一支上花等待）
 * 这样把等待只花在**真正需要**的那一次上 —— 上一版无条件等重载（预算 55s）会把 app 的
 * 剩余寿命吃掉，实测导致后续 3 次运行连不上（app 已退出）。
 * 预算另收到 15s：实测 app 启动后常常**就此安静**（连跑 4 次里 3 次等满 40s 也没等到重载），
 * 等满预算纯属白耗 app 寿命 ⇒ 超时就当作"这次很稳"，直接开测。 */
async function awaitForFreshOrigin(budgetMs = 15000, stepMs = 400) {
	const FRESH_MS = 10000; /* 页面年龄低于此值视为"窗口还够用" */
	const t0 = Date.now();
	let o0 = null;
	for (let i = 0; i < 5 && o0 === null; i++) { try { o0 = await js("Math.round(performance.timeOrigin)"); } catch { await sleep(stepMs); } }
	if (o0 === null) return { got: false, reason: "连 performance.timeOrigin 都读不到" };
	const age = Date.now() - o0;
	if (age < FRESH_MS) return { got: false, fresh: true, to: o0, age, waitedMs: 0 };
	console.log("  起点 origin = " + o0 + "（页面已活 " + age + " ms，偏老）· 等它自重载一次再开测…");
	while (Date.now() - t0 < budgetMs) {
		await sleep(stepMs);
		let o = null;
		try { o = await js("Math.round(performance.timeOrigin)"); } catch { /* 重载瞬间取不到，下一拍再试 */ }
		if (o && o !== o0) return { got: true, from: o0, to: o, age: FRESH_MS, waitedMs: Date.now() - t0 };
	}
	return { got: false, from: o0, waitedMs: Date.now() - t0, reason: "预算内未观测到重载（本次 app 稳定）" };
}

/* ── 计数对账（项目既有机制）── */
let pass = 0, fail = 0, skipped = 0;
const rows = [];

/* ══════════════════════════════════════════════════════════════════════════
 *  闸门自身异常兜底（2026-09-14 补，与 `verify-mindmap` / `verify-v20` **同一套约定**）
 *  同一坑在 `verify-flow`（崩在 1143）与本文件都出现过：环境卡顿时 `js()` 会返回 `{__err}`，
 *  调用方把它当数组用 ⇒ 深层 TypeError ⇒ 顶层无兜底 ⇒ 其后断言**一条不跑且无人知晓**。
 *  ⇒ 兜住未捕获异常/拒绝：打出已跑结果 + "其后未跑"，以 exit 2（INVALID）收尾。 */
let reachedFinal = false;
const dieReport = (why) => {
	console.error("\n───────────────────────────────────────────────");
	console.error(" ❌ INVALID：脚本异常终止 —— " + why);
	console.error(` 已跑出：通过 ${pass} / 失败 ${fail} / 跳过 ${skipped}（合计 ${pass + fail + skipped}）`);
	console.error(` 是否已到达收尾段：${reachedFinal}`);
	const shown = rows.filter((r) => r.ok === false).map((r) => r.id + " " + r.name);
	if (shown.length) console.error(" 期间失败项：\n   - " + shown.join("\n   - "));
	console.error(" 其后段落**一条都没跑** ⇒ 不得据此判定产品好坏。");
	console.error(" 处置：重启 Harness 重跑（本工具会话下须**同一条命令内**先启动再测）。");
	console.error("───────────────────────────────────────────────");
	process.exit(2);
};
process.on("uncaughtException", (e) => dieReport("uncaughtException：" + ((e && e.stack) || e)));
process.on("unhandledRejection", (e) => dieReport("unhandledRejection：" + ((e && (e.stack || e.message)) || e)));
function assert(id, name, ok, detail) {
	rows.push({ id, name, ok });
	ok ? pass++ : fail++;
	console.log(`  ${ok ? "✅" : "❌"} ${id} ${name}`);
	if (detail !== undefined) console.log(`      ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}
function skip(id, name, reason, detail) {
	rows.push({ id, name, ok: null });
	skipped++;
	console.log(`  ⏭️ ${id} ${name}`);
	console.log(`      跳过原因：${reason}`);
	if (detail !== undefined) console.log(`      ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

/* ── 真实鼠标（含落点自检：打偏必须点名，不许静默）── */
const clickLog = [];
const clickMisses = [];

async function clickAt(x, y) {
	const X = Math.round(x), Y = Math.round(y);
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: X, y: Y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: X, y: Y, button: "left", clickCount: 1, buttons: 1 });
	/* down→up 的间隔就是「重排窗口」：期间若元素被换掉，click 会落在共同祖先上，React 收不到。
	 * 本轮由 35ms 收到 10ms —— 仍然是一次真实点击（浏览器不要求最小按压时长），窗口小 3/4。 */
	await sleep(10);
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: X, y: Y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(12);
}
async function rectOf(tid) {
	return await js("(function(){var e=document.querySelector('[data-testid=\"" + tid + "\"]');if(!e)return null;var r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};})()");
}
/** 真实坐标点击一个 data-testid；带落点自检（命中栈顶须落在目标子树内）。
 *
 * 为什么要在投递前**再确认一次几何**（本轮新增，实测踩到）：
 *   `mousedown` 与 `mouseup` 之间留了 35ms（浏览器需要它才认成一次点击），
 *   这 35ms 恰好是重排窗口 —— 若宿主在此期间重渲染，元素被换掉，
 *   `click` 会落到共同祖先上，React 的 onClick 根本不跑。
 *   现场形态：`点击:已派发` 而 `data-tab` 纹丝不动（像"页签坏了"）。
 *   对策：**先证明前提再执行** —— 投递前重读 rect，与命中测试时的不一致就重做命中测试。
 *   连试仍不稳则如实报「几何不稳定」，不静默打偏、也不重试到绿（那会掩掉真缺陷）。 */
const clickTestId = (tid) => clickCss('[data-testid="' + tid + '"]');
/** 同上，但接受**任意 CSS 选择器** —— 归零动作要精确点到"当前选中的那个角色"，
 *  而它是 `[data-testid=dp-orch-role][data-role=xxx]`，不是一个 testid 能表达的。 */
async function clickCss(sel) {
	const q = JSON.stringify(sel);
	const hitExpr = (cx, cy) => "(function(){var e=document.querySelector(" + q + ");if(!e)return {top:null};var st=document.elementsFromPoint(" + cx + "," + cy + ");var top=st[0]||null;var ok=!!top&&(top===e||e.contains(top)||top.contains(e));return {top:top?top.tagName.toLowerCase():null,okSelf:ok,chain:st.slice(0,3).map(function(t){return t.tagName.toLowerCase()+(t.getAttribute&&t.getAttribute('data-testid')?'['+t.getAttribute('data-testid')+']':'');})};})()";
	const rect = async () => await js("(function(){var e=document.querySelector(" + q + ");if(!e)return null;var r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};})()");
	let r = await rect();
	if (!r) return { ok: false, why: "元素不存在" };
	if (r.w < 1 || r.h < 1) return { ok: false, why: "元素尺寸为 0" };
	let hit = null, stable = false;
	for (let attempt = 0; attempt < 3 && !stable; attempt++) {
		hit = await js(hitExpr(r.cx, r.cy));
		const again = await rect();
		if (!again) return { ok: false, why: "元素在命中测试与投递之间消失（几何不稳定）" };
		if (Math.abs(again.cx - r.cx) < 0.5 && Math.abs(again.cy - r.cy) < 0.5) stable = true;
		r = again;
	}
	if (!stable) return { ok: false, why: "元素几何在 3 次采样内仍不稳定（重排未停，拒绝盲点）" };
	clickLog.push({ 目标: sel, top: hit?.top, at: [Math.round(r.cx), Math.round(r.cy)] });
	if (!hit?.okSelf) clickMisses.push({ 目标: sel, landedOn: hit?.top, chain: hit?.chain, at: [Math.round(r.cx), Math.round(r.cy)] });
	await clickAt(r.cx, r.cy);
	return { ok: true, rect: r, hit };
}
const exists = (tid) => js("!!document.querySelector('[data-testid=\"" + tid + "\"]')");
const countOf = (tid) => js("document.querySelectorAll('[data-testid=\"" + tid + "\"]').length");
const textOf = (tid) => js("(function(){var e=document.querySelector('[data-testid=\"" + tid + "\"]');return e?e.textContent.trim():null;})()");
const attrOf = (tid, at) => js("(function(){var e=document.querySelector('[data-testid=\"" + tid + "\"]');return e?e.getAttribute('" + at + "')||null:null;})()");
const allAttrs = (tid, at) => js("Array.prototype.map.call(document.querySelectorAll('[data-testid=\"" + tid + "\"]'),function(e){return e.getAttribute('" + at + "');})");
const panelText = () => js("(function(){var p=document.querySelector('[data-testid=dp-orch-panel]');return p?p.innerText:'';})()");

/* ── 条件轮询读取（取代「固定睡多久、再读一次」）──
 * 为什么必须加：固定 sleep + 单次读取，等于把「等多久」写死成判据的一部分。
 * 实测踩到（本轮）：把点击后等待由 260ms 砍到 182ms 以求更快跑完，
 *   OB4 随即偶发红 —— 点击已派发、读回的 data-tab 仍是旧值。
 *   这是**闸门自造**的不稳定（我上一轮改的），不是产品缺陷；靠"重跑到绿"会掩盖它。
 * 轮询把「什么时候读」交给实际状态，判据本身一个字节没动。
 *
 * 🔴 预算为什么必须 ≥8s（本轮实测再次修正）：失败的形态是 `耗时ms ≈ 3100` 而状态纹丝不动，
 *   即**轮询到 3s 预算用尽**。这不是"点击没生效"，而是 host 后台装载把**渲染进程主线程阻塞了数秒**，
 *   真实输入事件在队列里排队 —— 同一轮里紧邻的下一条点击 `耗时ms: 2` 立刻通过，
 *   正是"队列排空后立刻处理"的指纹。⇒ 预算是**等主线程**的，不是等 React 的。 */
async function untilRead(fn, want, budgetMs = 8000, stepMs = 110) {
	const t0 = Date.now();
	let last = null;
	for (;;) {
		last = await fn();
		if (typeof want === "function" ? want(last) : last === want) return { ok: true, val: last, ms: Date.now() - t0 };
		if (Date.now() - t0 >= budgetMs) return { ok: false, val: last, ms: Date.now() - t0 };
		await sleep(stepMs);
	}
}

/* ── 环境心跳（跨段可见）──
 * 中途出问题时，「产品坏了」与「页面重载了」读数完全一样（都取到 null）。
 * 心跳把两者分开：若 `dp-root` 一并消失、或 timeOrigin 变了，
 *   那是页面重载 / Harness 退出（环境），不是面板自己关了（产品）。
 * timeOrigin 是本页导航起点，页面一重载必变 —— 判「页面还在不在」的硬凭据。 */
const beats = [];
async function beat(tag) {
	let s;
	try {
		s = await js("(function(){return {root:!!document.querySelector('[data-testid=dp-root]'),panel:!!document.querySelector('[data-testid=dp-orch-panel]'),origin:Math.round(performance.timeOrigin),nodes:document.querySelectorAll('*').length};})()");
	} catch (e) { s = { err: String(e && e.message ? e.message : e) }; }
	beats.push({ tag, ...s });
	console.log("      · 环境[" + tag + "] " + JSON.stringify(s));
	return s;
}

/** 浮层归零（只留一处真相源，避免各段各写一遍、漏一类） */
const closeFloatLayers = async () => {
	for (let i = 0; i < 3; i++) {
		if (!(await exists("dp-orch-panel"))) break;
		await clickTestId("dp-orch-close");
		await untilRead(() => exists("dp-orch-panel"), false, 1500);
	}
	for (let i = 0; i < 4; i++) {
		if (!(await exists("pp-panel"))) break;
		await clickTestId("pp-close");
		await untilRead(() => exists("pp-panel"), false, 1500);
	}
	for (let i = 0; i < 3; i++) {
		if (!(await exists("ds-root"))) break;
		await clickTestId("ds-close");
		await untilRead(() => exists("ds-root"), false, 1500);
	}
	for (let i = 0; i < 3; i++) {
		if (!(await exists("mm-root"))) break;
		await clickTestId("mm-close");
		await untilRead(() => exists("mm-root"), false, 1500);
	}
	return await js("(function(){return {orch:!!document.querySelector('[data-testid=dp-orch-panel]'),pp:document.querySelectorAll('[data-testid=pp-panel]').length,ds:!!document.querySelector('[data-testid=ds-root]'),mm:!!document.querySelector('[data-testid=mm-root]')};})()");
};
const floatsClean = (f) => !!f && f.orch === false && f.pp === 0 && f.ds === false && f.mm === false;

/**
 * 显式把起点建立为「总监页已挂载且就绪」。
 *
 * 为什么必须自己做：本脚本**不重载页面**，且新实例启动默认落在别的视图
 * （实测：全新启动后 `dp-root` 不在 DOM ⇒ 直接 INVALID）。起点不能靠
 * "上次应该停在总监页吧" —— 那是跨运行污染的温床（纪律 B）。
 *
 * 实现与 `verify-v17-sync.mjs` 的开场**同源**（同一套选择器），不另造一套心智模型：
 *   ① 点左侧会话树里带时间戳的项，唤醒会话视图；宿主才会渲染页签条
 *   ② 轮询 `[role=tab]` 中文本为「总监」且尺寸 > 4 的那一个，真实坐标点击
 *   ③ 等 `dp-root` **且** `data-rail-hover-ms` / `data-rail-r4` 同时可读 ——
 *      "出现" ≠ "就绪"（verify-v17-sync 上踩过这个假红）
 */
async function wakeDirector() {
	const treelist = "(function(){var a=[].slice.call(document.querySelectorAll('[role=treeitem]'));return a.length;})()";
	const n = await js(treelist);
	if (n > 0) {
		await js("(function(){var e=[].slice.call(document.querySelectorAll('[role=treeitem]')).find(function(x){return /分钟|小时|天|刚刚/.test(x.textContent);});if(e)e.click();return 1;})()");
	}
	let tabRect = null;
	for (let i = 0; i < 24; i++) {
		tabRect = await js("(function(){var t=[].slice.call(document.querySelectorAll('[role=tab]')).find(function(x){return x.textContent.trim()==='总监';});if(!t)return null;var r=t.getBoundingClientRect();return r.width>4&&r.height>4?{cx:r.x+r.width/2,cy:r.y+r.height/2,w:r.width,h:r.height}:null;})()");
		if (tabRect) break;
		await sleep(200);
	}
	if (tabRect) {
		const hit = await js("(function(){var t=[].slice.call(document.querySelectorAll('[role=tab]')).find(function(x){return x.textContent.trim()==='总监';});if(!t)return {ok:false};var st=document.elementsFromPoint(" + tabRect.cx + "," + tabRect.cy + ");var top=st[0]||null;return {ok:!!top&&(top===t||t.contains(top)||top.contains(t)),top:top?top.tagName.toLowerCase():null};})()");
		clickLog.push({ tid: "[role=tab]总监", top: hit?.top, at: [Math.round(tabRect.cx), Math.round(tabRect.cy)] });
		if (!hit?.ok) clickMisses.push({ target: "[role=tab]总监", landedOn: hit?.top, at: [Math.round(tabRect.cx), Math.round(tabRect.cy)] });
		await clickAt(tabRect.cx, tabRect.cy);
	} else {
		await js("(function(){var t=[].slice.call(document.querySelectorAll('[role=tab]')).find(function(x){return x.textContent.trim()==='总监';});if(t)t.click();return 1;})()");
	}
	for (let i = 0; i < 20; i++) {
		const ok = await js("(function(){var p=document.querySelector('[data-testid=dp-root]');return !!(p&&p.getAttribute('data-rail-hover-ms')&&p.getAttribute('data-rail-r4'));})()");
		if (ok) return { ready: true, tabFound: !!tabRect, treeItems: n };
		await sleep(175);
	}
	return { ready: false, tabFound: !!tabRect, treeItems: n, mounted: await exists("dp-root") };
}

/* 起点第 3 关：等宿主**稳定**再开测。
 * 为什么必须加（实测踩到，形态像"产品坏了"）：
 *   本脚本不重载页面，wake() 点了会话 ⇒ 宿主开始异步装载（会话/模型/权限…）。
 *   装载触发的**重渲染/重挂载**会丢掉 `DirectorPage` 的组件内 state，
 *   而编排面板的 open 就是 useState ⇒ 面板像"自己关了"。
 *   现场表现：OC1–OC3（层数/角色数）绿，紧接着 OC4 起整段取到 0/null。
 *   ⇒ 这不是新产品缺陷（「个性化」面板同一生命周期），是**闸门起点不等价**。
 *
 * 🔴 本轮再加一关（正例第 2 次复现，1/3 概率）：**"稳定"是有窗口的**
 *   —— 短暂稳定后异步装载完成还会再来一次重挂载，位置可能在**跑程中段**。
 *   现场形态升级为：OF1/OF2 报"五种断言全部缺失"（读到的其实是空串），
 *   心跳显示 origin **没变**（不是重载）、但 DOM 节点数 1245 → 948 骤降 ⇒ 是重挂载不是重载。
 *   对策两层：① 起始安定窗口拉长（5×400ms）+ 复采样一次，让本闸门**不与 app 启动赛跑**；
 *             ② 段边界埋心跳，使任何残留的"段间静默消失"能被**点名定位**而不是变成一团红。 */
async function waitHostSettled(stableNeeded = 5, stepMs = 400, budgetMs = 14000) {
	let prev = null, stable = 0;
	const t0 = Date.now();
	while (Date.now() - t0 < budgetMs) {
		const sig = await js("(function(){var n=document.querySelectorAll('*').length;var ids=[].slice.call(document.querySelectorAll('[data-testid]')).map(function(e){return e.getAttribute('data-testid');}).join(',');return {n:n,h:ids.length,c:ids.slice(0,200)};})()");
		const s = sig ? JSON.stringify(sig) : "null";
		if (s === prev) { stable++; if (stable >= stableNeeded) return { settled: true, samples: stable, ms: Date.now() - t0, nodes: sig ? sig.n : null }; }
		else stable = 0;
		prev = s;
		await sleep(stepMs);
	}
	return { settled: false, samples: stable, ms: Date.now() - t0 };
}

console.log("════════════════════════════════════════════════════════════");
console.log(" 编排面板 · 真机端到端验证（V21）");
console.log("════════════════════════════════════════════════════════════");
console.log("  期望值（源码算出）：层 " + EXP_LAYERS.length + " · 角色 " + EXP_ROLES + " · 图节点 " + EXP_NODES.length + " · 波 " + EXP_WAVES.length + " · L1 " + EXP_L1 + " 字符");
const T0 = Date.now();

/* ══ O0 前置 ══ */
console.log("\n【O0】前置（起点等价）");
const fresh = await awaitForFreshOrigin();
console.log("  " + (fresh.got
	? "✅ 已等到自重载、从零开测（等 " + fresh.waitedMs + " ms，origin " + fresh.from + " → " + fresh.to + "）"
	: fresh.fresh
		? "✅ 页面尚新鲜（已活 " + fresh.age + " ms < 10000）⇒ 不等待，直接开测"
		: "· 未观测到重载 ⇒ " + fresh.reason + "（等 " + fresh.waitedMs + " ms），直接开测"));
const f0 = await closeFloatLayers();
assert("O0a", "起点等价：四类浮层（编排 / 个性化 / 工作室 / 导图）全部归零", floatsClean(f0), f0);

let dpRoot = await exists("dp-root");
let wake = { ready: dpRoot, tabFound: null, treeItems: null, alreadyMounted: true };
if (!dpRoot) {
	wake = await wakeDirector();
	wake.alreadyMounted = false;
	dpRoot = await exists("dp-root");
}
assert("O0b", "起点自建：总监页已挂载（原本未挂载则走「点会话 → 点总监 tab」路径）",
	dpRoot, { 原本已挂载: wake.alreadyMounted, 会话树项数: wake.treeItems, 命中总监页签: wake.tabFound, 就绪: wake.ready });
assert("O0c", "总监页链路就绪（dp-root 的 data-rail-hover-ms 与 data-rail-r4 同时可读 —— 「出现」≠「就绪」）",
	wake.ready === true, { ready: wake.ready });
if (!dpRoot || !wake.ready) {
	console.error("\nIS_PASS: FALSE（INVALID：总监页未就绪，本闸门的测试面不成立）");
	console.error("  排除顺序：① Harness 是否带 --remote-debugging-port=9222 ② 左侧会话树是否有可点的会话");
	console.error("           ③ 插件是否已装并**重启**（插件在 boot 时才装载）");
	console.error("  手动排查：node scripts/cdp-eval.mjs \"!!document.querySelector('[data-testid=dp-root]')\"");
	ws.close();
	process.exit(2);
}

const settle = await waitHostSettled(6, 500, 20000);
/* 复采样一遍：首遍安定 ≠ 装完。异步装载完成会再来一次重挂载，
 * 而重挂载会冲掉面板的 useState ⇒ 段中段静默消失（本轮实测 1/3 概率）。
 * 心跳实测：宿主"装载中"与"装完"的 DOM 节点数差一倍（632 → 1171），所以窗口要够长。 */
const settle2 = settle.settled ? await waitHostSettled(4, 500, 16000) : settle;
assert("O0d", "宿主已安定（首遍连续 6×500ms + 复采样 4×500ms 均不变 —— 本闸门不与 app 启动赛跑）",
	settle.settled === true && settle2.settled === true, { 首遍: settle, 复采样: settle2 });
const origin0 = (await beat("起点")).origin;

/* ══ OA 入口按钮 ══ */
console.log("\n【OA】入口按钮");
const rBtn = await rectOf("dp-orchestrate");
assert("OA1", "「⧉ 编排」入口存在且可视（宽高 ≥ 1px）",
	!!rBtn && rBtn.w >= 1 && rBtn.h >= 1, rBtn ? { w: Math.round(rBtn.w), h: Math.round(rBtn.h), at: [Math.round(rBtn.x), Math.round(rBtn.y)] } : "未找到");

const btnText = await textOf("dp-orchestrate");
assert("OA2", "入口文案语义正确（含「编排」且不长于 6 字，与同组图标按钮同构）",
	!!btnText && btnText.indexOf("编排") >= 0 && btnText.length <= 6, JSON.stringify(btnText));

/* 原生窗口控件遮挡：只在覆盖层**可见**时判定（否则 rect 为 0 会把整窗算成遮挡） */
const wco = await js("(function(){var w=navigator.windowControlsOverlay;if(!w)return {visible:null,rect:null};var r=null;try{r=w.getTitlebarAreaRect();}catch(e){}return {visible:w.visible===true,rect:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null};})()");
if (!wco.visible || !wco.rect) {
	skip("OA3", "入口未被原生窗口控件遮挡（Windows caption area）",
		"本环境 navigator.windowControlsOverlay 不可见或不可读（visible=" + JSON.stringify(wco.visible) + "）⇒ 无覆盖层可判，测试面不成立",
		wco);
} else {
	const cx = rBtn ? rBtn.cx : -1, cy = rBtn ? rBtn.cy : -1;
	const inRect = cx >= wco.rect.x && cx <= wco.rect.x + wco.rect.w && cy >= wco.rect.y && cy <= wco.rect.y + wco.rect.h;
	assert("OA3", "入口中心点不在原生窗口控件覆盖层内（否则鼠标会被系统当拖窗吃掉）", !inRect, { 入口中心: [Math.round(cx), Math.round(cy)], 覆盖层: wco.rect, 命中: inRect });
}

assert("OA4", "点击前：编排面板**未**挂载（起点干净）", !(await exists("dp-orch-panel")), "dp-orch-panel 不存在");

const c1 = await clickTestId("dp-orchestrate");
const openedR = await untilRead(() => exists("dp-orch-panel"), true);
const opened = openedR.val;
assert("OA5", "真实点击入口 ⇒ 编排面板出现", c1.ok && opened, { click: c1.ok ? "已派发" : c1.why, panel: opened, 耗时ms: openedR.ms });
assert("OA6", "面板 data-scope 标注为「总监页」（四处共用面板时靠它区分来源）",
	(await attrOf("dp-orch-panel", "data-scope")) === "总监页", await attrOf("dp-orch-panel", "data-scope"));
assert("OA7", "默认页签为「四层组织」（org）", (await attrOf("dp-orch-panel", "data-tab")) === "org", await attrOf("dp-orch-panel", "data-tab"));

/* ══ OB 四页签逐点 ══ */
console.log("\n【OB】四页签（逐个真实点击 → 回读 data-tab）");
const TABS = [
	["graph", "执行图"],
	["budget", "策略与预算"],
	["accept", "验收标准"],
	["org", "四层组织"]
];
for (let i = 0; i < TABS.length; i++) {
	const key = TABS[i][0], label = TABS[i][1];
	const tid = "dp-orch-tab-" + key;
	const before = await attrOf("dp-orch-panel", "data-tab");
	const clickRes = await clickTestId(tid);
	const got = await untilRead(() => attrOf("dp-orch-panel", "data-tab"), key);
	const after = got.val;
	assert("OB" + (i + 1), "点「" + label + "」页签 ⇒ data-tab 由 " + before + " 变为 " + key,
		clickRes.ok && after === key, { 点击: clickRes.ok ? "已派发" : clickRes.why, 前: before, 后: after, 耗时ms: got.ms });
}

/* ══ OC 四层组织 ══ */
console.log("\n【OC】四层组织（同源对账：LAYERS / BUILTIN_ROLES）");
await beat("OC前");
await clickTestId("dp-orch-tab-org");
await untilRead(() => attrOf("dp-orch-panel", "data-tab"), "org");
const layerCount = (await untilRead(() => countOf("dp-orch-layer"), (v) => v === EXP_LAYERS.length, 6000)).val;
assert("OC1", "四层卡片数 = LAYERS.length（" + EXP_LAYERS.length + "）", layerCount === EXP_LAYERS.length, { 实测: layerCount, 期望: EXP_LAYERS.length });
const layerKeys = (await allAttrs("dp-orch-layer", "data-layer") || []).slice().sort();
assert("OC2", "四层 data-layer 集合与 LAYERS 完全一致（不是「看着像四层」）",
	JSON.stringify(layerKeys) === JSON.stringify(EXP_LAYERS), { 实测: layerKeys, 期望: EXP_LAYERS });
const roleCount = await countOf("dp-orch-role");
assert("OC3", "角色数 = BUILTIN_ROLES.length（" + EXP_ROLES + "）", roleCount === EXP_ROLES, { 实测: roleCount, 期望: EXP_ROLES });

/* 归零：面板 `open=false` 时只 `return null`、**组件仍挂载** ⇒ `roleId` 等 state 跨"关→开"
 * 甚至**跨运行**存活（实测连跑时第 2/3 次进来 `dp-orch-rolecard` 已经是 true）。
 * 闸门不许假设起点，必须**显式建立**"未选中"；而角色按钮是开关，点错一个会变成"换成另一个"
 * 而不是"取消" ⇒ 必须点回**当前选中的那一个**（靠卡片上的 `data-role` 精确命中）。 */
const curRole = await attrOf("dp-orch-rolecard", "data-role");
let normalised = "本就未选中";
if (curRole) {
	const back = await clickCss('[data-testid="dp-orch-role"][data-role="' + curRole + '"]');
	const gone = await untilRead(() => exists("dp-orch-rolecard"), false, 2500);
	normalised = "点了 " + curRole + " 取消选中 ⇒ 卡片消失=" + gone.val;
}
const firstRole = await js("(function(){var e=document.querySelector('[data-testid=dp-orch-role]');return e?{id:e.getAttribute('data-role'),text:e.textContent.trim()}:null;})()");
const rcBefore = await exists("dp-orch-rolecard");
const rcClick = await clickTestId("dp-orch-role");
const rcR = await untilRead(() => exists("dp-orch-rolecard"), true);
const rcAfter = rcR.val;
assert("OC4", "点一个角色 ⇒ 角色卡出现（点击前 " + rcBefore + " → 点击后 " + rcAfter + "）",
	rcClick.ok && rcBefore === false && rcAfter === true, { 点击: rcClick.ok ? "已派发" : rcClick.why, 前: rcBefore, 后: rcAfter, 归零: normalised, 耗时ms: rcR.ms });
const rcText = await textOf("dp-orch-rolecard");
await beat("OC后");
const rcRole = firstRole ? BUILTIN_ROLES.find((x) => x.id === firstRole.id) : null;
assert("OC5", "角色卡内容与该角色数据同源（含其 name 与层标签）",
	!!rcText && !!rcRole && rcText.indexOf(rcRole.name) >= 0, { 角色: firstRole ? firstRole.id : null, 期望含: rcRole ? rcRole.name : null, 卡片前60字: rcText ? rcText.slice(0, 60) : null });

/* ══ OD 执行图 ══ */
console.log("\n【OD】执行图（同源对账：planWaves(normalizeGraph(DIRECTOR_CHAIN))）");
await beat("OD前");
await clickTestId("dp-orch-tab-graph");
await untilRead(() => attrOf("dp-orch-panel", "data-tab"), "graph");
const waveCount = (await untilRead(() => countOf("dp-orch-wave"), (v) => v === EXP_WAVES.length, 6000)).val;
assert("OD1", "波数 = planWaves 的波数（" + EXP_WAVES.length + "）", waveCount === EXP_WAVES.length, { 实测: waveCount, 期望: EXP_WAVES.length });
const nodeCount = (await untilRead(() => countOf("dp-orch-node"), (v) => v === EXP_NODES.length, 6000)).val;
assert("OD2", "图节点数 = DIRECTOR_CHAIN 节点数（" + EXP_NODES.length + "）", nodeCount === EXP_NODES.length, { 实测: nodeCount, 期望: EXP_NODES.length });
const nodeIds = (await allAttrs("dp-orch-node", "data-node") || []).slice().sort();
assert("OD3", "节点 id 集合与 DIRECTOR_CHAIN 完全一致", JSON.stringify(nodeIds) === JSON.stringify(EXP_NODES), { 实测: nodeIds, 期望: EXP_NODES });
const noteText = await textOf("dp-orch-parallel-note");
const waveNodeTotal = await js("(function(){var w=document.querySelectorAll('[data-testid=dp-orch-wave]');var n=0;for(var i=0;i<w.length;i++){n+=w[i].querySelectorAll('[data-testid=dp-orch-node]').length;}return n;})()");
/* OD4 防「平凡真」：空输入下 0 === 0 会通过 —— 那不是"没有孤儿"，是"根本没有图"。
 * 所以先钉死前提（图非空），再断言无孤儿；否则这条会在产品全坏时反而变绿。 */
assert("OD4", "所有节点都归属某个波次（波浪内节点数合计 = 节点总数，无孤儿）",
	nodeCount > 0 && waveNodeTotal === nodeCount, { 波内合计: waveNodeTotal, 节点总数: nodeCount, 前提图非空: nodeCount > 0 });
assert("OD5", "🔴 并行度差距有**公开声明**（面板必须说明当前仍串行执行，不许假装已并行）",
	!!noteText && noteText.indexOf("串行") >= 0, { 声明: noteText ? noteText.slice(0, 80) : null });

/* ══ OE 策略与预算 ══ */
console.log("\n【OE】策略与预算");
await beat("OE前");
await clickTestId("dp-orch-tab-budget");
await untilRead(() => attrOf("dp-orch-panel", "data-tab"), "budget");
const modeText = (await untilRead(() => textOf("dp-orch-mode"), (v) => !!v && EXP_MODE_KEYS.indexOf(v) >= 0, 6000)).val;
assert("OE1", "执行模式 ∈ MODES 的 key（" + EXP_MODE_KEYS.join(" / ") + "）",
	!!modeText && EXP_MODE_KEYS.indexOf(modeText) >= 0, { 实测: modeText, 期望集: EXP_MODE_KEYS });
const decText = await textOf("dp-orch-decision");
assert("OE2", "判定理由非空（模式不能只给结论不给依据）", !!decText && decText.length > 10, decText ? decText.slice(0, 90) : null);
const l1Text = await textOf("dp-orch-l1");
assert("OE3", "L1 预算读数 = l1Budget()（" + EXP_L1 + " 字符，同源对账，不硬编码）",
	!!l1Text && l1Text.indexOf(String(EXP_L1)) >= 0, { 实测含: l1Text ? l1Text.slice(0, 90) : null, 期望: EXP_L1 });

/* ══ OF 验收标准 ══ */
console.log("\n【OF】验收标准（同源对账：ASSERT_KEYS / LABEL）");
await beat("OF前");
await clickTestId("dp-orch-tab-accept");
await untilRead(() => attrOf("dp-orch-panel", "data-tab"), "accept");
const accText = (await untilRead(() => panelText(), (v) => !!v && Object.values(LABEL).every((k) => v.indexOf(k) >= 0), 6000)).val;
const missKeys = ASSERT_KEYS.filter((k) => accText.indexOf(k) < 0);
assert("OF1", "五种机械断言全部展示（" + ASSERT_KEYS.join(" / ") + "）", missKeys.length === 0, { 缺失: missKeys.length ? missKeys : "(无)" });
const labelVals = Object.values(LABEL);
const missLabels = labelVals.filter((k) => accText.indexOf(k) < 0);
assert("OF2", "语义层三态标签全部展示（" + labelVals.join(" / ") + "）", missLabels.length === 0, { 缺失: missLabels.length ? missLabels : "(无)" });

/* ══ OG 两个真按钮 ══ */
console.log("\n【OG】两个真按钮（反馈不静默 + 自动消失）");
await beat("OG前");
await clickTestId("dp-orch-tab-org");
await untilRead(() => attrOf("dp-orch-panel", "data-tab"), "org");
const t0 = await exists("dp-orch-toast");
const expClick = await clickTestId("dp-orch-export");
const expR = await untilRead(() => textOf("dp-orch-toast"), (v) => !!v, 2500);
const expToast = expR.val;
assert("OG1", "点「导出编排计划」⇒ 给出明确反馈（点击前无 toast → 点击后有）",
	expClick.ok && t0 === false && !!expToast, { 点击: expClick.ok ? "已派发" : expClick.why, 反馈: expToast, 耗时ms: expR.ms });
assert("OG2", "反馈文案是成功或**明确报错**，且**点名是哪一个**（降级可以，无声不行）",
	!!expToast && (expToast.indexOf("已复制：编排计划") === 0 || expToast.indexOf("复制失败（编排计划）") === 0), expToast);

/* 🔴 第三级降级的**双向对照**（本轮新增）。
 * 背景：上一版面板在剪贴板失败时只发一句「请手动复制」，而界面上**没有任何东西可复制** ——
 * 一句话把人指到死路，功能等于没有。补了"把文本摆出来"之后，这条必须钉住，
 * 且**两个方向都要钉**：
 *   剪贴板成功 ⇒ 文本域**不该**出现（否则就是永远挂着一块没用的框）
 *   剪贴板失败 ⇒ 文本域**必须**出现且内容非空（否则"已把文本摆到下方"就是假话）
 * 只钉一个方向就会掉进另一类假红：要么环境好时误报，要么失败时放行空框。 */
const fbShown = await exists("dp-orch-fallback");
const fbText = fbShown ? await textOf("dp-orch-fallback") : null;
const clipOk = !!expToast && expToast.indexOf("已复制") === 0;
const fbGood = clipOk ? fbShown === false : (fbShown === true && !!fbText && fbText.length > 50);
assert("OG5", "第三级降级双向对照：" + (clipOk ? "剪贴板成功 ⇒ 不摆文本域" : "剪贴板失败 ⇒ 必须真把文本交到手上（非空 >50 字）") + "，不许只报一句话",
	fbGood, { 剪贴板成功: clipOk, 文本域在: fbShown, 文本长度: fbText ? fbText.length : null, 文本前40字: fbText ? fbText.slice(0, 40).replace(/\s+/g, " ") : null });
await sleep(2400);
assert("OG3", "反馈自动消失（约 2.2s 后清空，证明定时 effect 真的在跑）", !(await exists("dp-orch-toast")), "2.4s 后 dp-orch-toast 不存在");

/* 生成一份委派简报，验证「按钮 ⇒ 明确反馈」这条链路真的通。
 *
 * 🔴 本轮修掉两处**闸门自身**的错（都是假红，不是产品缺陷）：
 *  ① 角色按钮是**开关**（面板 `onClick: () => setRoleId(roleId === r.id ? null : r.id)`）。
 *     上一版在这里无条件点一次 —— 而 OC4 早已选中该角色，于是这一步实际是**取消选中**，
 *     「简报以该角色为目标」的测试面根本不成立（简报会回落 `doc-writer`）。
 *     ⇒ 先读状态，只在**未选中**时才点。
 *  ② 判据写的是 `toast.indexOf("简报") >= 0`，即把"成功文案含简报"当成唯一通过条件。
 *     而 Chrome 的**瞬时用户激活会被第一次剪贴板写入消耗**（实测：JS 点击两次都必然
 *     `NotAllowedError`），所以第二次复制**合法地**走失败分支，文案是
 *     「复制失败（委派简报）：系统剪贴板不可用，请手动复制」——含标签、不含「简报」二字。
 *     闸门于是把一次**正确的显式降级**读成红，且 `反馈:null`（toast 2.2s 自动清空后轮询读到的末值）。
 *     ⇒ 判据改为：标签必须在**两种结局里都出现**（成功含「已复制：委派简报」，失败含「（委派简报）」）。
 *       这样既不再假红，也不会因为"永远失败"而蒙过 —— 标签与"明确报错"两头都要满足。 */
if (!(await exists("dp-orch-rolecard"))) {
	await clickTestId("dp-orch-role");
	await untilRead(() => exists("dp-orch-rolecard"), true);
}
const roleSelected = await exists("dp-orch-rolecard");
const bfClick = await clickTestId("dp-orch-briefing");
const bfR = await untilRead(() => textOf("dp-orch-toast"), (v) => !!v, 2500);
const bfToast = bfR.val;
const bfOk = !!bfToast && (bfToast.indexOf("已复制：委派简报") === 0 || bfToast.indexOf("复制失败（委派简报）") === 0);
assert("OG4", "点「生成委派简报」⇒ 给出明确反馈（成功或带标签的明确失败，两者都算）",
	bfClick.ok && roleSelected === true && bfOk, { 点击: bfClick.ok ? "已派发" : bfClick.why, 角色已选中: roleSelected, 反馈: bfToast, 耗时ms: bfR.ms });

/* ══ OH 互斥与开合 ══ */
console.log("\n【OH】互斥与开合");
await beat("OH前");
const readFloats = () => js("(function(){return {orch:!!document.querySelector('[data-testid=dp-orch-panel]'),pp:document.querySelectorAll('[data-testid=pp-panel]').length};})()");
const pClick = await clickTestId("dp-personalize");
const pR = await untilRead(readFloats, (v) => !!v && v.orch === false && v.pp > 0, 2500);
const afterP = pR.val;
assert("OH1", "🔴 从编排面板点「⚙ 设置」⇒ 编排面板**自动关闭**（互斥，不叠两个浮层）",
	pClick.ok && afterP.orch === false, { 点击: pClick.ok ? "已派发" : pClick.why, 后: afterP, 耗时ms: pR.ms });
assert("OH2", "…且个性化面板确实开了（互斥的另一半，防「两个都关」也算过）", afterP.pp > 0, afterP);

await closeFloatLayers();
const reopen = await clickTestId("dp-orchestrate");
const reR = await untilRead(() => exists("dp-orch-panel"), true, 2500);
assert("OH3", "可重复开合：关掉后再点入口 ⇒ 面板重新出现",
	reopen.ok && reR.val === true, { 点击: reopen.ok ? "已派发" : reopen.why, panel: reR.val, 耗时ms: reR.ms });

const closeClick = await clickTestId("dp-orch-close");
const clR = await untilRead(() => exists("dp-orch-panel"), false, 2500);
assert("OH4", "点面板 ✕ ⇒ 面板关闭", closeClick.ok && clR.val === false, { 点击: closeClick.ok ? "已派发" : closeClick.why, panel: clR.val, 耗时ms: clR.ms });

/* ══ OI 落点自检 + 收尾复原 ══ */
console.log("\n【OI】落点自检与收尾复原");
assert("OI1", "本脚本全部 " + clickLog.length + " 次点击，落点均在目标元素子树内（不许静默打偏）",
	clickMisses.length === 0, clickMisses.length ? clickMisses : { clicks: clickLog.length });

const fEnd = await closeFloatLayers();
assert("OI2", "环境复原：跑完把编排 / 个性化 / 工作室 / 导图都关回去（起点等价，杜绝跨运行污染）",
	floatsClean(fEnd), fEnd);
assert("OI3", "总监页仍在（收尾不许把整页关掉）", await exists("dp-root"), "dp-root 在 DOM");
await beat("收尾");

/* 🔴 段间静默消失（本轮实测 1/3 概率的真实不稳定）：
 * 从 OA5 打开面板到 OH4 由我们自己关掉它，中途**没有任何一步是"关面板"**。
 * 因此每个段边界的面板都必须还在 —— 若某边界读到 false，
 * 说明面板被**别的东西**关掉了（宿主重挂载冲掉组件内 state），
 * 而它的下游表现会是"某某断言全部缺失"这种**指错方向**的红。
 * 把这条单独提出来断言，红的时候就直指"在哪一段之间消失"，不必再猜。 */
const midBeats = beats.filter((b) => b.tag !== "起点" && b.tag !== "收尾");
const panelGone = midBeats.filter((b) => b.panel !== true);
assert("OI4", "段边界处面板始终在（" + midBeats.length + " 个采样点全为 open —— 抓「段间静默消失」）",
	panelGone.length === 0, panelGone.length ? { 消失于: panelGone.map((b) => b.tag) } : { 采样点: midBeats.map((b) => b.tag) });

/* ══ 汇总 ══ */
/* 43 = 39 条常驻（含 O0c 起点就绪 / O0d 宿主安定两遍 / OG5 三级降级双向对照 / OI4 段间静默消失）+ OB 循环展开 4 条；
 * OA3 的两分支（assert / skip）互斥但都各计 1 行。
 * 算法：静态 assert 调用 40 处，其中 OB 一处展开为 4 ⇒ 40 - 1 + 4 = 43。 */
const EXPECTED_TOTAL = 43;
reachedFinal = true;
const total = pass + fail + skipped;
console.log("\n════════════════════════════════════════════════════════════");
console.log(` 结果：${pass} 通过 / ${fail} 失败 / ${skipped} 跳过 / 共 ${total} 项`);
console.log(` 跑程耗时：${Date.now() - T0} ms（须显著小于 app 自重载周期，否则会撞在窗口尾部）`);
console.log(` 断言总数对账：EXPECTED_TOTAL=${EXPECTED_TOTAL} 实测=${total}`);
const failedRows = rows.filter((r) => !r.ok && r.ok !== null);
if (failedRows.length) { console.log(" 未通过项："); failedRows.forEach((f) => console.log(`   ${f.id} ${f.name}`)); }
const skippedRows = rows.filter((r) => r.ok === null);
/* 🔴 跳过必须逐条列出可分辨原因（纪律 18）：只报个数等于把"没测"藏进汇总里 */
if (skippedRows.length) {
	console.log(" 跳过项（含可证伪原因 —— 测试面不成立，非产品问题）：");
	skippedRows.forEach((s) => console.log(`   ⏭️ ${s.id} ${s.name}\n       原因：${s.reason}`));
}
console.log("════════════════════════════════════════════════════════════");

/* ── 心跳结论：把「产品坏了」与「页面重载了」分开 ──
 * 中途取到 null 有两种成因，读数一模一样：面板自己关了（产品） vs 页面重载/Harness 退出（环境）。
 * timeOrigin 是本页导航起点，页面一重载必变 ⇒ 它是判「页面还在不在」的硬凭据。
 * 判据顺序按纪律 24：**先看页面还在不在，再看功能**。 */
const origins = beats.map((b) => b.origin).filter((x) => typeof x === "number");
const originChanged = origins.length > 1 && new Set(origins).size > 1;
const rootGone = beats.some((b) => b.root === false);
console.log("\n 环境心跳（跨段）：起点 origin=" + origin0 + " · 采样 " + beats.length + " 次 · 全部取值 " + JSON.stringify([...new Set(origins)]));
if (originChanged || rootGone) {
	console.log(" 判定：页面在**测试中途重载过**" + (rootGone ? "（且 dp-root 一度消失）" : "") +
		" ⇒ 中途的 null 属**环境**成因（Harness 退出/重载），不是面板自己关了");
}

if (total !== EXPECTED_TOTAL) {
	console.log(`\nIS_PASS: FALSE（INVALID：断言总数 ${total} ≠ 声明 ${EXPECTED_TOTAL}，闸门自身已漂移）`);
	ws.close();
	process.exit(2);
}
/* 页面重载 ⇒ 后半段断言量的是"新页面"、前半段量的是"旧页面"，两者**不同源** ⇒ 结果一律不可采信。
 * 🔴 判据必须是**无条件**的（不能只在 fail>0 时才报 INVALID）：
 *   重载发生在收尾阶段时可能"零红但页面已换" —— 那是更危险的**假绿**：
 *   绿得好看，可它量的是一个刚重启、状态全空的页面。跳过/不可采信比红更危险（纪律 18）。
 * 报 INVALID（环境）而非 FAIL（产品），并给出可复制的正确命令 —— INVALID ≠ FAIL。 */
if (originChanged) {
	console.log(`\nIS_PASS: FALSE（INVALID：page origin 在跑程中变化 ${JSON.stringify([...new Set(origins)])} —— 页面被重载，` +
		`前后段不同源，本次结果整体不可采信（fail=${fail} 亦不作数），属环境问题非产品缺陷）`);
	console.log("  本工具会话下 Harness 无法常驻，须**同一条命令内**先启动再测试：");
	console.log("    ( cd \"/d/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness\" && env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \"./DeepSeek Harness.exe\" --remote-debugging-port=9222 & )");
	console.log("    sleep 14 && node scripts/verify-orchestrate.mjs");
	ws.close();
	process.exit(2);
}
console.log(`\nIS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}（fail=${fail}${skipped ? " / 跳过=" + skipped : ""}）`);
ws.close();
process.exit(fail === 0 ? 0 : 1);
