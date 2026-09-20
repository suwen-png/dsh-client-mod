#!/usr/bin/env node
/**
 * `_ensure-page.mjs` —— **批内起点守卫**：把页面恢复到「总监页已挂载」这个**共享起点**（幂等）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须存在（第 41 轮真机实测 · 一次连跑里 **38 条假红**）
 * ──────────────────────────────────────────────────────────────────
 * `run-live.mjs` 的既定分工是「**首套负责自举起点**，后续套件秒过起点判定」。
 * 这个分工里藏着一个未设防的假设：**每个套件跑完都把页面留在总监页上**。
 * 本批实测把它打破了：
 *   · `verify-design-studio`（第 3 套）**自己就红了**（工作室没挂载，42 项未通过），
 *     而且它**没有复原**页面 ⇒ 总监页不在 DOM；
 *   · 紧随其后的 `verify-director-logic`（第 4 套）读到 `DL-1a 起点：dp-root 在 DOM` **红**
 *     ⇒ 后面 **21 条全部级联**，整轮判 **INVALID**；
 *   · 再后面的 `verify-flow`（第 5 套）⇒ **17 条红**。
 *   ⚠️ 而这两个套件在**上一批里都是绿的**（13 套那批：`verify-director-logic` 69s OK、
 *     `verify-flow` 唯一红只有 C6）⇒ 本批那 38 条红**没有一条是产品缺陷**。
 *
 * `run-live.mjs` 自己其实**早就在警告**这件事（"该实例可能是另一个会话开的 ⇒ 两边会互相改
 * 页面状态，结果不可信"）—— 但它**只警告、不防御**。本脚本就是那条防御。
 *
 * ⇒ 纪律（第 41 轮新增）：**一个套件的失败不许改变下一个套件的起点。**
 *   否则"本轮跑了哪些套件、按什么顺序"也成了输入 ⇒ 与纪律 107
 *   （"构建面内不许有随跑程变化的输入"）同族，只是发生在**测试面**。
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么是"薄壳"而不是第二份自举实现
 * ──────────────────────────────────────────────────────────────────
 * 起点自举**只允许一个实现** —— `_cdp-startup.mjs#ensureDirectorPage`（纪律 98：
 * 「同一事实只留一份真相源」；本项目已因两份实现连吃两次级联假红）。
 * 本文件**只做接线**：连 CDP → 调那一个实现 → 把结论压成一行给人看 + 用退出码表态。
 *
 * ── 退出码（**分工写在退出码里**，调用方不必解析文字）────────────────────
 *   0 = 起点在位（本来就>在，或本次恢复成功）
 *   1 = 起点**无法恢复**（`dp-root` 仍不在 DOM）⇒ 调用方必须把后续套件标成
 *       「**起点未恢复**」，而不是让它们的红看起来像产品坏了（纪律 58）
 *   2 = **环境**不可用（CDP 连不上 / 没有 page 目标）⇒ 与"产品坏"是两件事
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node scripts/_ensure-page.mjs            # 幂等：在位就直接返回
 *   CDP_PORT=9223 node scripts/_ensure-page.mjs
 */
import { PORT } from "./cdp-port.mjs";
import { waitCdpPage, ensureDirectorPage } from "./_cdp-startup.mjs";
import { makeClicker } from "./_cdp-click-until.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (s) => console.log("[起点守卫] " + s);

const T = await waitCdpPage({ port: PORT, log: () => {} });
if (!T.ok || !T.page) {
	line("环境不可用：" + (T.reason || "连不上 CDP " + PORT));
	process.exit(2);
}

const ws = new WebSocket(T.page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id);
		pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	const timer = setTimeout(() => { pending.delete(id); rej(new Error("EVAL_TIMEOUT")); }, 12000);
	pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (x) => { clearTimeout(timer); rej(x); } });
	ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
try { await send("Runtime.enable"); } catch (e) { /* Runtime.enable 未确认不影响 */ }

async function js(expr) {
	try {
		const o = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
		if (o && o.exceptionDetails) return { __exc: String(o.exceptionDetails.text || "exception") };
		return o ? (o.result ? o.result.value : null) : null;
	} catch (e) { return null; }
}
const hasRoot = async () => (await js("!!document.querySelector('[data-testid=\"dp-root\"]')")) === true;
/* 🔴 「在位」必须包含**宿主正在显示它**（第四十一轮 · 新增纪律 148）。
 *   只查 `dp-root` 在 DOM 会让"挂着但盒为 0×0"（宿主显示的是别的视图）被读成「在位」，
 *   而下一个套件会从 `dp-act-split` 零盒开始 —— 本轮实测：一次连跑产生 **11 条假红 + 整轮 INVALID**
 *   （`logs/_r41j-ns.out`，读起来完全是"产品坏了"）。
 *   ⇒ 这里取的判据 = **有盒**（宽高都 > 0）；至于「遮罩/忙态」等更强的就绪契约，
 *     由 `ensureDirectorPage` 内部负责（它会在不满足时**转「点总监」把视图显示出来**）。 */
const rectOfRoot = async () => await js("(function(){var r=document.querySelector('[data-testid=\"dp-root\"]');"
	+ "if(!r)return null;var b=r.getBoundingClientRect();"
	+ "return JSON.stringify({w:Math.round(b.width),h:Math.round(b.height)});})()");
const shownNow = async () => {
	const s = await rectOfRoot();
	try {
		const o = JSON.parse(String(s));
		return !!(o && o.w > 0 && o.h > 0);
	} catch (e) { return false; }
};

/** 跑一次共享自举，并把**逐步取证**收下来。
 *  🔴 纪律 131（捕获子进程/内部输出的工具**必须留全文**）：本文件原先给
 *     `ensureDirectorPage` 传的是 `log: () => {}` —— 于是「恢复失败」只剩一行结论，
 *     **逐轮读数全丢**（批 #3 `logs/_r41l-ensure.out` 里那句"恢复失败"因此永远无法归因：
 *     直到单独写探针去现场取证，才查出真因是"页签环全在隐藏容器里 ⇒ 点不动"）。
 *     ⇒ 输出**收进数组**：成功路径只报计数（不刷屏），失败路径**全部打印**。 */
async function runBootstrap() {
	const steps = [];
	const r = await ensureDirectorPage({
		CL: makeClicker({ send, js, sleep }, {}), js, send, sleep,
		log: (s) => steps.push(String(s)),
		stabilizeMs: Number(process.env.DSH_STABILIZE_MS || 18000)
	});
	return { r: r, steps: steps };
}
/** 失败时把逐步取证全部落盘 —— 没有它，"恢复失败"就是一个无法归因的悬案 */
function dumpSteps(tag, steps) {
	line("── " + tag + " · 逐步取证 " + steps.length + " 条 ──");
	for (const s of steps) console.log("       " + s.trim());
}

/* 🔴 第 42 轮（需求 1）：**测试干跑**。
 * 本脚本是「批内起点守卫」，`run-live.mjs` 在**每套之前**都会跑它 ⇒ 在这里开一次，
 * 整批的"流转"就**只填不发** —— 不再消耗用户的模型额度。
 * 真因：插件的"流转"最终落到 `submitComposer()`（点宿主原生发送按钮）或
 * `sendToHost()`，宿主收到就**真的发起一次模型调用**（用户原话：「你测试流转的时候
 * 没有标注测试或者其他的么，把我的额度跑没了」）。
 * ⚠️ 只关"发送"这一个动作 —— 界面、DOM、判据全部照旧。
 * 需要真发的场合：① 套件内显式 `window.__dshDirectorDryRun = false`；
 *   ② 整批层面置 `RH_ALLOW_REAL_SEND=1`（本脚本据此**不开**干跑，并显式警告）。
 *   —— ② 存在的理由：`verify-flow.mjs` 的 G2b/G6 断言的是"真投递通道"，
 *      干跑下它们**必然**不成立（已被显式标 SKIP）。要真验那两条时必须能开关。 */
const allowRealSend = String(process.env.RH_ALLOW_REAL_SEND || "") === "1";
/* 🔴 第 42 轮补丁：干跑开关**同时写 `sessionStorage`**（键 `dsh.director.testDryRun`）。
 *   真因：`verify-v17-sync.mjs` / `verify-director-logic.mjs` 等套件会在**套件内部**
 *    `location.reload()` 复位起点 —— 页面全局 `window.__dshDirectorDryRun` 随之丢失，
 *    该套件 reload 之后的"流转"就会**真发**（批内守卫只管"每套之前"，管不到套件内部）。
 *   `sessionStorage` **同标签存活、关标签/重启宿主即清** ⇒ 恰好覆盖一次测试会话，
 *    既补上 reload 缺口，又不会像 `localStorage` 那样把测试痕迹长期留进产品（纪律 99）。
 *   ⚠️ 真发模式（`RH_ALLOW_REAL_SEND=1`）**必须清键**：否则上一次批的残留会让"真验"
 *    悄悄退化成干跑 ⇒ 假绿（纪律 63/64）。两侧对称：干跑=写键，真发=清键。 */
const setDryJs = (on) => "(function(){try{window.__dshDirectorDryRun=" + (on ? "true" : "false")
	+ ";try{if(window.sessionStorage){" + (on ? "window.sessionStorage.setItem('dsh.director.testDryRun','1')" : "window.sessionStorage.removeItem('dsh.director.testDryRun')")
	+ "}}catch(e2){}return window.__dshDirectorDryRun===" + (on ? "true" : "false") + ";}catch(e){return false;}})()";
const dryOn = await js(setDryJs(!allowRealSend));
/* 🔴 交叉校验（纪律 126）：本文下面的直写与插件侧 `isDryRun()` 是**两处实现** ——
 *   直写必须保留（桥的安装时机是 `DirectorDialog` 渲染，可能**晚于**本脚本，
 *   依赖桥会导致"置位失败 ⇒ 真发"），但**必须回读桥上唯一实现**确认两边口径一致。
 *   不一致（插件侧读回 false）⇒ 本轮**会真发**、有额度风险 ⇒ **显式告警，绝不静默**（纪律 54）。 */
const dryRead = await js("(function(){try{var b=window.__dshChatBridge;return b&&typeof b.isDryRun==='function'?(b.isDryRun()===true):null;}catch(e){return null;}})()");
line(allowRealSend
	? "测试干跑：⚠️ **已显式关闭（RH_ALLOW_REAL_SEND=1）** —— 本次流转会**真实发送**，会消耗模型额度"
	: "测试干跑：" + (dryOn === true ? "已开启（只填不发 ⇒ 不消耗额度 · 跨 reload 由 sessionStorage 兜底）" : "⚠️ 未能开启（页面异常，本次可能真发）"));
if (!allowRealSend && dryRead === false) {
	line("   🔴 **口径不一致**：CDP 侧已置干跑，但插件 `isDryRun()` 回读 false ⇒ 本轮**可能真发**（额度风险）！");
} else if (!allowRealSend && dryRead === null) {
	line("   （插件桥尚未安装 ⇒ `isDryRun()` 暂无法回读；已写 sessionStorage 键，套件跑起来后即生效）");
}

/* ── 快路径：起点本来就在 ⇒ 什么都不做（**不打扰正在跑的页面**）──────
 * 🔴 为什么必须先探再调：`ensureDirectorPage` 的第 ① 步是"关掉残留浮层"（连发 Esc）。
 *    对一个**已经就绪**的页面连发 Esc 会关掉用户/上一段有意的浮层状态 —— 幂等的前提是
 *    "**先看，再动手**"。这一步让正常路径的开销降到 ≈0.4s（一次求值）。 */
const before = await hasRoot();
const beforeShown = before ? await shownNow() : false;
if (before && beforeShown) {
	/* 仍然跑一次 `ensureDirectorPage` —— 但**只是为了就绪稳定期**（连续两次读数一致 +
	 * 就绪契约）。这是 `T-PLUG-067` 第二层的要求：`dp-root` 在 DOM **不等于**页面可以测了。
	 * 契约一满足就提前返回（正常 ≈0.45s）。 */
	const a = await runBootstrap();
	const okA = a.r.ok && a.r.dpRoot;
	line("在位（无需恢复）｜ dp-root=" + a.r.dpRoot + " ｜ 可见环=" + JSON.stringify(a.r.tabRing || []));
	/* 🔴 用 `r.ok` 表态，不再只看 `dpRoot`（`dpRoot` 只说明"在 DOM"）—— 见文件头退出码分工。 */
	if (!okA && a.r.reason) line("⚠️ 在位判定未通过：" + a.r.reason);
	if (!okA) dumpSteps("在位判定失败", a.steps);
	process.exit(okA ? 0 : 1);
}

if (before && !beforeShown) {
	line("dp-root **已挂载但未显示**（盒=" + String(await rectOfRoot()) + "）⇒ 转共享自举把它显示出来"
		+ "（宿主当前显示的**不是**总监视图 —— 旧判据只看 DOM，故会误判为「在位」，纪律 148）");
} else {
	line("dp-root 不在 DOM ⇒ 走共享自举（唯一实现 ensureDirectorPage）");
}
const b = await runBootstrap();
const okB = b.r.ok && b.r.dpRoot;
line("恢复" + (okB ? "成功" : "失败") + "｜ ok=" + b.r.ok + " dp-root=" + b.r.dpRoot
	+ " ｜ 盒=" + String(await rectOfRoot())
	+ " ｜ 原因=" + (b.r.reason || "(无)") + " ｜ 可见环=" + JSON.stringify(b.r.tabRing || []));
if (!okB) dumpSteps("恢复失败", b.steps);
process.exit(okB ? 0 : 1);
