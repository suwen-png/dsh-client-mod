#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeClicker, pressEsc } from "./_cdp-click-until.mjs";
import { ensureDirectorPage, waitCdpPage } from "./_cdp-startup.mjs";
import { until } from "./_cdp-wait.mjs"; /* T-PLUG-053 ⑤：until/settle 唯一实现 */
import { readLastDirectorMessage } from "./_cdp-lastmsg.mjs"; /* T-PLUG-053 ⑤：双通道读消息唯一实现 */
import { caseAt, caseById } from "./_corpus-director.mjs";
/**
 * verify-director-logic.mjs —— 第二十三轮真机验收：**总监逻辑链的四项修复**
 *                            —— 第二十四轮升级：**语料池驱动**（8 类输入轮转）
 *
 * ══════════════════════════════════════════════════════════════════
 * 对应用户原话（逐条落点）
 * ──────────────────────────────────────────────────────────────────
 *  「整个的逻辑测试，我需要的是**总监的分配机制**也是好用的，**整个调试的机制**也是好用的。」
 *  「回复包括**总监对语言的整理**，**对于文字的描述**，**对于整个项目把控**都是要有的。」
 *  「你可以**拿具体实际项目**，然后去发送，然后可以发送一些**无意义的东西**，然后让总监去**分辨**」
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 第二十四轮改动：**输入不再写死**
 * ──────────────────────────────────────────────────────────────────
 *  旧：噪声恒为「今天天气不错 哈哈哈哈」、真实需求恒为同一句 ⇒
 *      连跑 40 次 = **同一组输入跑 40 遍**，只证"这一条不崩"，
 *      **证不了**"分辨"—— 分辨是**对一类输入的泛化能力**（纪律 23 的反例检查）。
 *  新：从 `_corpus-director.mjs` 取用例（`DL_CASE` 指定 id 或下标，默认 C1），
 *      8 类输入轮转；**每条用例自带期望**（噪声原因类别 / 期望 kind / 期望去噪行数）
 *      ⇒ 分辨判据若被写死成"认一句话"，**除 C1 外全落空**。
 *
 * ══════════════════════════════════════════════════════════════════
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 段 | 编号 | 被测行为 | 期望结果 |
 *  |:--:|:-----|:---------|:---------|
 *  | A | DL-0 | 🔴 前置前提：插件已注入就绪 | 不成立 ⇒ 后续红**全部 INVALID**（不算产品缺陷） |
 *  | A | DL-1a–c | 起点显式建立（纪律 51） | `dp-root` 在 DOM；分流/回收按钮**真实鼠标可命中**（视口内 + `elementFromPoint` 命中自己，纪律 22）；派发前读数**打印前提** |
 *  | B | DL-2a–d | 🔴 **D7 噪声分辨**（"让总监去分辨"） | 投用例噪声 ⇒ `data-kind=noise`；`data-made=0`；**会话数前后相等**（正对照） |
 *  | B | **DL-2e** | 🔴 **分辨原因要对得上**（第二十四轮新增） | `data-reason` **非空**且**含用例期望的原因类别**（寒暄/乱敲/标点/重复/注入）—— 只断言 kind 时，8 类噪声里 7 类误判也全绿 |
 *  | B | DL-3a–c | 🔴 **前提正对照**（防"界面没反应也算过"） | 同一按钮紧接着投真实项目 ⇒ `data-kind == 用例期望`（novel/generic）且 `made>0` |
 *  | C | DL-4a | 🔴 **D9 项目把控 + D8 语言整理**（读台账 `brief`） | 派发简报含「项目把控」四步 + 「需求整理」要点块 |
 *  | C | DL-5a–b | 🔴 **D10 界面滞后一条**（"调试的机制"） | 派发后**有界等待**页签 `= 派发前 + 1`（修复前恒不变）；回收后同理再 +1 |
 *  | C | DL-6a–c | 派发读数与实测一致（第 19 批复用能力回归） | `data-made == data-sent`；`reused + created == made`；`DL_ALLOW_CREATE=0` 时 `made>0 ⇒ reused == made` |
 *  | C | **DL-6d/e** | 🔴 **整理读数**（第二十四轮按用例期望） | 要点数 ≥ 1；`data-org-noise ≥ 用例期望`（混合用例 C6 必须 ≥ 2） |
 *  | D | DL-7a–c | 🔴 **D8 归纳式汇总**（"对文字的描述"） | 回收后最新消息含「【总监汇总】」；同因**只印一次** |
 *  | E | DL-8a–b | 收尾复原 | 输入框还原为空；CDP 零超时（超时判 INVALID 而非 FAIL） |
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 跑这一套会发生什么（**必须先知道**）
 * ──────────────────────────────────────────────────────────────────
 *  1. **噪声那一次零副作用**（这正是被测能力）：只跑判定，不建会话、不写索引。
 *  2. 真实需求那一次**会派发分支**（小说 8 条 / 通用 3 条）—— 但走**复用**路径
 *     （同名作品的同一批维度 ⇒ `reused==made`）⇒ 正常情况**不新建会话**。
 *     🔴 **首次**见到某用例的维度组时必然 `created>0`（那是"先复用、没有才建"的正确行为），
 *        连跑脚本用 `DL_ALLOW_CREATE=1` 标注首见轮次；后续轮次必须 `reused == made`。
 *  3. 它**不清除任何总监消息**（与本套件的判据无关）⇒ 不会碰到第二十二轮那条"闸门清空用户数据"的老路。
 *
 * 用法：node scripts/verify-director-logic.mjs ｜ 退出码 0 全绿 / 1 FAIL / 2 INVALID
 * 环境：CDP_PORT（默认 9222）· DL_CASE（用例 id 如 C6，或下标）· DL_ALLOW_CREATE（1=首见允许新建）
 */
/* ══════════════════════════════════════════════════════════════════
 * 🔴 闸门自检（连 CDP 之前先跑）：断言编号必须唯一。
 *    重号让报告**失去可归因性**。放在最前 = 快速失败 + 零副作用（不连 CDP、不建会话）。
 * ══════════════════════════════════════════════════════════════════════ */
{
	const selfSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
	const ids = [...selfSrc.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]);
	const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
	if (dup.length) {
		console.error("IS_PASS: FALSE（INVALID：断言编号重号 " + dup.length + " 个 —— " + dup.join(", ") + "）");
		console.error("  处置：改号为未占用编号；**并同步补头部段号表**（漏登记段是重号的常见根因）。");
		process.exit(2);
	}
	console.log("  [自检] 断言编号唯一：" + ids.length + " 条，零重号");
}

import { PORT } from "./cdp-port.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* ── 用例装载（第二十四轮） ──────────────────────────────────────────
 * `DL_CASE` 支持两种写法：`C6`（用例 id）或 `5`（下标）。未给 ⇒ 默认 C1。
 * `NOISE_REQ` / `NOVEL_REQ` 仍可单独覆盖（**调试单条输入时用**），保留向后兼容。 */
const CASE = (function () {
	const raw = String(process.env.DL_CASE || "").trim();
	const c = raw ? (caseById(raw) || caseAt(Number(raw) - 1)) : caseById("C1");
	return c || caseAt(0);
})();
const NOISE_REQ = process.env.NOISE_REQ !== undefined ? process.env.NOISE_REQ : CASE.noise;
const NOVEL_REQ = process.env.NOVEL_REQ !== undefined ? process.env.NOVEL_REQ : CASE.real;
/* 首见某用例的维度组时**允许新建**（"先复用、没有才建"的正确行为）；
 * 由连跑脚本按"该用例是否已出现过"置 1/0。默认 0 = 严格复用（防"一百多个会话"回归）。 */
const ALLOW_CREATE = String(process.env.DL_ALLOW_CREATE || "0") === "1";

let pass = 0, fail = 0, invalid = false;
const failures = [];
const LOG = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	const line = "  " + (cond ? "OK  " : "FAIL") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "  → " + JSON.stringify(detail) : "");
	console.log(line); LOG.push(line);
}
function markInvalid(why) {
	invalid = true;
	console.error("IS_PASS: FALSE（INVALID：" + why + "）");
	console.error("  注：INVALID ≠ FAIL —— 表示**测试前提不成立**，不能据此判产品红。");
}

/* 🔴 有界等待 page 目标（**唯一实现** `_cdp-startup.mjs#waitCdpPage` —— 纪律 98/55）。
 *    第 25 批实测：`_run-with-harness` 报「CDP 就绪」只代表**端口**在应答（≈2.0s），
 *    page 目标更晚 ⇒ 旧写法（端口一就绪就取 targets）会拿到空数组，
 *    报成 `INVALID：CDP 无 page 目标`，读起来像"Harness 没起来"。 */
const T = await waitCdpPage({ port: PORT, log: (s) => console.log(s) });
if (!T.ok) {
	console.error("IS_PASS: FALSE（INVALID：" + T.reason + "，等了 " + Math.round(T.ms / 1000) + "s）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=" + PORT + " 启动。");
	console.error("    node scripts/_run-with-harness.mjs node scripts/verify-director-logic.mjs");
	process.exit(2);
}
const page = T.page;
console.log("  [boot] pid=" + process.pid + " CDP=" + PORT + " page=" + String(page.url).slice(0, 60));
/* 🔴 用例**必须先打印**（纪律 57：闸门全绿 ≠ 能验收；"这一轮到底测了什么"要留在日志里）。
 *    40 轮连跑时，没有这一行就无法回答"哪一轮用的是哪条输入"。 */
console.log("  [语料] 用例 " + CASE.id + "「" + CASE.name + "」｜噪声「" + String(NOISE_REQ).slice(0, 30)
	+ "」期望原因含「" + CASE.expectReasonHas + "」｜需求期望 kind=" + CASE.expectKind
	+ " · 期望去噪≥" + CASE.expectOrgNoiseMin + " · ALLOW_CREATE=" + (ALLOW_CREATE ? 1 : 0));
LOG.push("  [语料] " + CASE.id + " " + CASE.name);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let wsNote = "";
ws.addEventListener("error", (e) => { wsNote = "ws error: " + String((e && (e.message || e.type)) || "unknown"); });
ws.addEventListener("close", (e) => { if (!wsNote) wsNote = "ws close: code=" + (e && e.code); });
let seq = 0; const pending = new Map();
const pageErrors = [];
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.method === "Runtime.exceptionThrown") {
		pageErrors.push(String((m.params && m.params.exceptionDetails && m.params.exceptionDetails.text) || ""));
	}
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}, timeoutMs = 25000) => new Promise((res, rej) => {
	const id = ++seq;
	const tm = setTimeout(() => { pending.delete(id); rej(new Error("CDP 超时：" + method)); }, timeoutMs);
	pending.set(id, { res: (v) => { clearTimeout(tm); res(v); }, rej: (e) => { clearTimeout(tm); rej(e); } });
	ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", () => j(new Error(wsNote || "WS 连接失败"))); });
await send("Runtime.enable", {}).catch(() => { });
/* 🔴 真实鼠标的**可见性前提**（第二十四轮统一加装 · 纪律 29/54）
 *    CDP 的 `mousePressed/Released` 在 `document.visibilityState !== "visible"` 时会被
 *    **整条吞掉**（`mouseMoved` 照常送达）⇒ 表现是「点了没反应」，读起来完全是产品坏了。
 *    🔴 `document.hasFocus()` 在 hidden 时**仍为 true** ⇒ 不能拿它当判据，只认 `visibilityState`。
 *    实测：hidden ⇒ 只送达 pointermove；visible ⇒ pointerdown/mousedown/pointerup/click 全到。 */
const FOCUS_PRE = await (async () => {
	const { ensurePageFocus } = await import("./_cdp-focus.mjs");
	const ev = async (e) => {
		const r = await send("Runtime.evaluate", { expression: e, returnByValue: true });
		return r && r.result ? r.result.value : undefined;
	};
	const fp = await ensurePageFocus({ send, ev, log: (s) => console.log(s) });
	console.log("  [鼠标前提] visibility=" + JSON.stringify(fp.visibility)
		+ " ｜ hasFocus=" + JSON.stringify(fp.hasFocus)
		+ " ｜ bringToFront=" + fp.broughtToFront + " ｜ focusEmulated=" + fp.focusEmulated
		+ (fp.reasons.length ? " ｜ 降级：" + fp.reasons.join(" / ") : ""));
	return fp;
})();
const _origSend = send;
const sendX = send;
async function js(expr, ms = 25000) {
	const r = await sendX("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, ms);
	if (r.exceptionDetails) throw new Error("JS: " + r.exceptionDetails.text);
	return r.result && r.result.value;
}
/* ── 点击层：走**共享模块**（第二十四轮 · 落地 U6） ──────────────────
 * 本套件第 23 批就地写的 `clickSel/clickJs/clickByText/clickUntil` 已抽到
 * `scripts/_cdp-click-until.mjs`，供**所有**真机套件复用 —— U6 记的是：
 * 另外 5 套真机闸门共 **31 处裸 `Input.dispatchMouseEvent`** 会吃同一个坑
 * （合成鼠标在 Electron 下**静默丢事件** ⇒ 表现为"时绿时红"的偶发假红）。
 * 这里保留同名薄封装 ⇒ **调用点零改动**，几何自检与后果校验的证据一条不少。 */
const CL = makeClicker({ send: sendX, js, sleep });
const clickAt = (x, y) => CL.clickAt(x, y);
const clickSel = (sel, tag) => CL.clickSel(sel);
/** 🔴 第 23 批：**JS 直点**（`el.click()`）—— 不依赖浏览器命中测试与合成事件管线。
 *  实测（2026-09-16 夜）：同一个 `dp-act-split`、同一坐标 `(784,124)`、`elementFromPoint`
 *  **命中自己**，CDP `Input.dispatchMouseEvent` **连丢 6 轮**（"已命中但无后果"），
 *  而同一时刻 `el.click()` **一次生效**（`data-kind=noise` 立刻出现）。
 *  ⇒ CDP 合成鼠标在 Electron 下的可靠性**不归产品负责**，闸门不能把它的丢失算成产品红。
 *  🔴 但纪律 22 **不放松**：本函数仍回报 `self`（是否命中自己）与 `at`，
 *     "按钮在视口内、可被命中"这条证据照样留痕。 */
const clickJs = (sel, tag) => CL.clickJs(sel);
/** 🔴 第 23 批：**「点了」≠「生效了」** ─────────────────────────────
 *  CDP 合成鼠标（`Input.dispatchMouseEvent`）在 Electron 下**不是 100% 可靠**：
 *  同一坐标、同一事件序列，实测**时绿时红** —— 本轮场景是手工探针连中 4 次、
 *  闸门连红 2 轮（`DL-3b0` 报"几何命中自己"= OK，而 `DL-3b` 等 54s 都等不到后果）。
 *  ⇒ 凡"点击**必须**产生可观测后果"的地方，一律：点击 → **校验后果** → 未达成就重试。
 *
 *  **这不是把红洗成绿**：`verifyFn` 由调用方给出（例如"派发读数出现且 `kind=novel`"），
 *  产品真坏了 ⇒ 每轮都无后果 ⇒ 预算耗尽照样判红；它只把
 *  「合成事件偶发丢失」与「产品坏了」**分开**（纪律 58：「没跑成」必须与「失败」可分）。
 *  @param {string} sel 目标 CSS 选择器
 *  @param {string} tag 日志用中文名
 *  @param {() => Promise<any>} verifyFn 返回真值 = 后果已发生
 *  @param {number} rounds 最大轮数（默认 5）
 *  @returns {Promise<{ok:boolean, rounds:number, info?:any, why?:string}>} */
const clickUntil = (sel, tag, verifyFn, rounds = 6) => CL.clickUntil({ sel: sel }, verifyFn, { rounds: rounds });
/** 🔴 纪律 55：有界等待 + 校验返回值（超预算 ⇒ 由调用方判红，不静默当成"还没到"） */
/* T-PLUG-053 ⑤ until() 推广：本套件原先**手写**了一份轮询循环，与 _cdp-wait#until 同义两处实现。
 *    改为薄壳委托共享 until —— 语义不变（tries×gap 预算、stepMs=gap、首个真值即返回、超时回 null），
 *    但循环只此一份。 */
async function waitFor(fn, tries, gap) {
	const r = await until(fn, (v) => !!v, { budgetMs: tries * gap, stepMs: gap, tag: "waitFor" });
	return r.val;
}
function pick(sel) {
	return js("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e) return null;"
		+ "var o={text:String(e.textContent||'').trim().slice(0,200)};"
		+ "for(var i=0;i<e.attributes.length;i++){var a=e.attributes[i];if(a.name.indexOf('data-')===0)o[a.name]=a.value;}"
		+ "return o;})()");
}
/* 会话数（活会话，排除归档）—— 噪声前后必须相等 */
const LIVE_N = "(async function(){try{var b=window.__dshBranchTree;if(!b)return null;"
	+ "var raws=b.rawSessionSummaries()||[];var arch=await b.archivedSessionIds();"
	+ "if(!Array.isArray(arch))return raws.length;var st={};arch.forEach(function(a){st[String(a)]=1;});"
	+ "return raws.filter(function(s){return !st[String(s.id||s.sessionId)];}).length;}catch(e){return null;}})()";
/* 消息页签计数 + 当前作用域库条数（一次读全） */
const MSG_STATE = "(async function(){"
	+ "var t=document.querySelector('[data-testid=\"dp-r5-msg\"]');var tab=t?String(t.textContent).trim():null;"
	+ "var m=tab?tab.match(/(\\d+)/):null;var tabN=m?Number(m[1]):null;"
	+ "function cnt(){return new Promise(function(res){var r=indexedDB.open('dsh-director-plugin-db');"
	+ "r.onerror=function(){res(-1)};r.onsuccess=function(){var db=r.result;"
	+ "var tx=db.transaction(['directorConversations'],'readonly');"
	+ "var q=tx.objectStore('directorConversations').getAll();"
	+ "q.onsuccess=function(){var all=q.result||[];var byN={};var last=0,lastNode=null;"
	+ "all.forEach(function(x){var k=String(x.nodeId||'');byN[k]=(byN[k]||0)+1;if((x.at||0)>last){last=x.at||0;lastNode=k;}});"
	+ "res({total:all.length,cur:lastNode?byN[lastNode]:0,curNode:lastNode});};"
	+ "q.onerror=function(){res(-2)};};});}"
	+ "var c=await cnt();var rendered=document.querySelectorAll('[data-testid=\"dp-dir-msg\"]').length;"
	+ "return JSON.stringify({tab:tabN,rendered:rendered,db:c});})()";

/* 🔴 第二十五轮新增：**UI 存在性状态**（一次读全）—— 为什么必须有：
 *    `DL-5a` / `DL-7a` 报红时只打印「超预算未达成」，**一个读数都没有** ⇒
 *    无法区分「产品没更新读数」与「**整块 UI 已经不在 DOM**」（纪律 54：读数先落地）。
 *    本轮实测正是后者：`[D] 回收点击 结果=false · 未命中：{"ok":false,"why":"不在 DOM"}`
 *    —— 派发成功后「📥 回收」与 `dp-r5-msg` **一起消失**，读起来像"回收链坏了"，
 *    实则要问的是"**总监页还在不在**"。读三样：① 根节点 ② 宿主页签环与当前选中 ③ 投递通道。 */
const UI_STATE = "(function(){"
	+ "var q=function(s){return !!document.querySelector(s);};"
	+ "var r5=document.querySelector('[data-testid=\"dp-r5\"]');"
	+ "var fl=document.querySelector('[data-testid=\"dp-flow-split\"]');"
	+ "var ts=[].slice.call(document.querySelectorAll('[role=\"tab\"]'));"
	+ "return JSON.stringify({root:q('[data-testid=\"dp-root\"]'),"
	+ "r5:!!r5,r5view:r5?r5.getAttribute('data-view'):null,"
	+ "msgTab:q('[data-testid=\"dp-r5-msg\"]'),flowTab:q('[data-testid=\"dp-r5-flow\"]'),"
	+ "r5body:q('[data-testid=\"dp-r5-body\"]'),detail:q('[data-testid=\"dp-r4-detail\"]'),now:q('[data-testid=\"dp-now\"]'),"
	+ "collect:q('[data-testid=\"dp-act-collect\"]'),split:q('[data-testid=\"dp-act-split\"]'),"
	+ "deliver:fl?fl.getAttribute('data-deliver-mode'):null,"
	+ "ring:ts.map(function(e){return String(e.textContent||'').trim();}),"
	+ "sel:ts.filter(function(e){return e.getAttribute('aria-selected')==='true';}).map(function(e){return String(e.textContent||'').trim();})});})()";

/* ── A 段：起点 ─────────────────────────────────────────────────── */
console.log("\n【A 起点显式建立】");
/* 🔴 纪律 41 / 第 23 批：**起点必须显式建立**，否则后面十几条断言全部级联假红。
 *    实测一轮（2026-09-16）：`dp-root` 不在 DOM ⇒「🌿 派发」按钮"不在 DOM"
 *    ⇒ **18 条红全由这一个起点问题产生**。
 *
 * 🔴 两类 `[role="tab"]` **撞名**（本轮踩到的真陷阱）：
 *    ① 宿主**页签环**（会话视图顶部：总监 / 对话 / 轨迹）—— 点其中的「总监」才会挂载 `dp-root`
 *    ② 总监页**内部子页签**（同样 `role="tab"`，名字也含"总监"）
 *    ⇒ 旧写法 `clickSel('[role="tab"]')` 点的**恰好也是**第一个「总监」，但它**不检查命中结果**
 *      （被浮层遮挡时静默失败）⇒ 起点没立起来而脚本继续跑 ⇒ 18 条级联红。
 *
 * 🔴 另：**浮层会吃掉点击**（打开的导图/设计图/弹窗盖在页签行上）⇒ 起点前先按 Esc 清场。
 */
const esc = () => pressEsc(sendX, sleep);
/** 按**可见文本**找元素并真实点击（严格命中检查 · 纪律 22）—— `clickSel` 只吃 CSS 选择器，不够用。
 *  实现见共享模块 `_cdp-click-until.mjs`（同 `clickSel`）。 */
const clickByText = (sel, text) => CL.clickByText(sel, text);
/** 🔴 第 23 批：按文本 **JS 直点**（`el.click()`）—— 与 `clickJs` 同理，但用于"同一选择器
 *  下有多个候选、只点文本匹配的那个"（宿主页签环）。仍回报 `self`/`at` 作为纪律 22 的证据。 */
const clickJsByText = (sel, text) => CL.clickJsByText(sel, text);

/* T-PLUG-059 幂等回总监页：派发/回收会让宿主切走（打开对话 => 宿主落到「对话」tab），
 *    而 MSG_STATE.tab 读的是总监页内部子页签 dp-r5-msg 的计数 —— 不在总监页时它是 null，
 *    waitFor(tab===before+1) 永不到达 => DL-5a/5b/7a 间歇红（约 1/5，正是派发把视角切走那一轮）。
 *    => 每次测总监页读数前幂等回总监页：已在则不动，不在则点环上的「总监」并等 dp-root。 */
const backToDirectorPage = async (tag) => {
	let st = { sel: [], hasDir: false };
	try { st = JSON.parse(await js("(function(){var ts=[].slice.call(document.querySelectorAll('[role=\"tab\"']));"
		+"var sel=ts.filter(function(e){return e.getAttribute('aria-selected')==='true';}).map(function(e){return String(e.textContent||'').trim();});"
		+"var hasDir=ts.some(function(e){return String(e.textContent||'').trim()==='总监';});"
		+"return JSON.stringify({sel:sel,hasDir:hasDir});})()")); } catch (_) {}
	const alreadyOn = Array.isArray(st.sel) && st.sel.indexOf('总监') >= 0;
	if (!alreadyOn && st.hasDir) {
		LOG.push("  [" + tag + "] 宿主已切走（sel=" + JSON.stringify(st.sel) + "）=> 幂等回总监页");
		await clickJsByText('[role="tab"]', "总监");
	}
	for (let i = 0; i < 15; i++) {
		if (await js("(function(){return !!(document.querySelector('[data-testid=\"dp-root\"]')"
			+"&&document.querySelector('[data-testid=\"dp-r5-msg\"]'));})()")) return true;
		await sleep(300);
	}
	return false;
};
let stats = JSON.parse(await js(MSG_STATE));
/* ① 浮层清场 */
const ovl0 = await js("['#dsh-mindmap','#dsh-design-studio','#dsh-director-dialog'].filter(function(s){return !!document.querySelector(s);})");
if (ovl0 && ovl0.length) {
	LOG.push("  [起点] 浮层未清理：" + JSON.stringify(ovl0) + " ⇒ 按 Esc");
	await esc();
	LOG.push("  [起点] Esc 后残留：" + JSON.stringify(await js("['#dsh-mindmap','#dsh-design-studio','#dsh-director-dialog'].filter(function(s){return !!document.querySelector(s);})")));
}
/* ①.5 🔴 第 23 批：**"插件就绪"是起点的前置前提，必须先证** ────────────────
 *    实测（2026-09-16 23:11）：Harness 重启后**页面 HTML 已渲染**（页签环 3 个在），
 *    但插件注入**尚未完成** ⇒ 点「总监」tab 无处挂载 ⇒ `dp-root` 恒 false
 *    ⇒ **18 条级联红，读起来完全像"产品坏了"**，实际是**前提不成立**。
 *    纪律 55/58：**「没跑成」必须与「失败」可分**。
 *    ⇒ 先有界等待注册句柄 `__dshDirectorView.registered`；超预算判 INVALID。
 *    反例检查：若产品真的没注册（`registered:false`），本断言会红 ⇒ 不会被"等待"掩盖。 */
const VIEW_HANDLE = "(function(){try{var v=window.__dshDirectorView;"
	+ "return v?JSON.stringify({registered:!!v.registered,id:v.id,order:v.order,reason:v.reason}):null;}catch(e){return null;}})()";
let viewHandle = await js(VIEW_HANDLE);
LOG.push("  [起点] 注册句柄 = " + viewHandle);
if (!viewHandle) {
	const tv = Date.now();
	while (Date.now() - tv < 30000) {
		await sleep(1000);
		viewHandle = await js(VIEW_HANDLE);
		if (viewHandle) break;
	}
	LOG.push("  [起点] 等待 " + (Date.now() - tv) + "ms 后注册句柄 = " + viewHandle);
}
let pluginReady = false;
try { pluginReady = !!(viewHandle && JSON.parse(viewHandle).registered); } catch (_) { pluginReady = false; }
t("DL-0", "🔴 前置前提：插件已注入并就绪（`__dshDirectorView.registered`）—— 不成立则后续红**全部 INVALID**",
	pluginReady === true, viewHandle);
if (!pluginReady) {
	markInvalid("插件未就绪（Harness 可能刚重启，注入未完成）—— DL-1a 及之后的红**不计入产品缺陷**");
}

/* ①.6 🔴 第二十四轮：**统一起点自举**（共享模块 `_cdp-startup.mjs`）
 *    为什么必须共享：`verify-novel-split` 用**真实 UI 点侧栏会话行**能起来，
 *    而本套件原先只靠内部口 `__directChatSubmit` ⇒ **跨重启连跑冷启动时 8/29**
 *    （21 条红全由一个起点问题级联产生）。四个探针已把机制查清：
 *    冷启动后宿主可能 58–120s 都没有页签环；用内部口"凑"出来的会话视图里
 *    「总监」虽已是 `aria-selected`，但**宿主始终不渲染视图内容** ⇒ `dp-root` 永不出现。
 *    ⇒ 起点只认这一条路：**真实 UI 自举 → 点「总监」→ 只认 `dp-root`**。
 *    失败时由下方 `markInvalid` 判 INVALID（前提不成立 ⇒ 不构成产品红 —— 纪律 58）。 */
const BOOT = await ensureDirectorPage({ CL: CL, js: js, send: sendX, sleep: sleep, log: (s) => LOG.push(s) });
console.log("  [起点] 统一自举：" + (BOOT.ok ? "✅ dp-root 已挂载" : "❌ " + BOOT.reason));
LOG.push("  [起点] 统一自举 = " + (BOOT.ok ? "true" : "false") + (BOOT.ok ? "" : " ｜ " + BOOT.reason));

/* ② 立起 dp-root */
let dpRoot = await js("!!document.querySelector('[data-testid=\"dp-root\"]')");
LOG.push("  [起点] 初查 dp-root=" + dpRoot);
if (!dpRoot) {
	let ring = await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent||'').trim();})") || [];
	if (!ring.length) {
		const mat = await js("(async function(){var b=window.__dshBranchTree;if(!b)return {ok:false,reason:'无 __dshBranchTree'};"
			+ "var raws=b.rawSessionSummaries()||[];var arch=await b.archivedSessionIds();"
			+ "if(!Array.isArray(arch))return {ok:false,reason:'归档集读不到'};var st={};arch.forEach(function(a){st[String(a)]=1;});"
			+ "var live=raws.filter(function(s){return !st[String(s.id||s.sessionId)];});"
			+ "if(!live.length)return {ok:false,reason:'无活会话'};var id=String(live[0].id||live[0].sessionId);"
			+ "if(typeof window.__directChatSubmit!=='function')return {ok:false,reason:'无 __directChatSubmit'};"
			+ "try{window.__directChatSubmit(id,'起点自举：请回复 OK');}catch(e){return {ok:false,reason:String(e&&e.message)};}"
			+ "return {ok:true,id:id};})()");
		LOG.push("  [起点] 无页签环 ⇒ 实体化：" + JSON.stringify(mat));
		const t1 = Date.now();
		while (Date.now() - t1 < 10000) {
			await sleep(500);
			ring = await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent||'').trim();})") || [];
			if (ring.length) break;
		}
		LOG.push("  [起点] 实体化后页签环：" + JSON.stringify(ring));
	}
	/* 🔴 第 23 批：**起点建立必须可重试**（本轮实测根因）。
	 *    现象：`__dshDirectorView.registered === true`（插件的 inject 回调已跑完），
	 *    但**宿主尚未消费该注册**时，页签环的「总监」按钮**已渲染却点不动** ——
	 *    几何命中成功（ok:true）、`aria-selected` **不变**、`dp-root` 不出现。
	 *    ⇒ 旧写法"点一次 + 等 4.8s"只要跑在注入完成之前就必失败，
	 *      而且失败形态与"产品坏了"**完全一样**（连报 25 条红，查了半小时）。
	 *    注入完成时刻不确定（`Page.reload` 后尤其）⇒ 起点只认**反复点 + 有界等待**，
	 *    直到挂载成功或总预算（40s / 8 轮）耗尽。
	 *    依据：纪律 41（起点显式建立，否则后续级联假红）+ 55（有界等待且校验返回值）。 */
	let ok = false;
	let tries = 0;
	const tStart = Date.now();
	while (!ok && tries < 8 && (Date.now() - tStart) < 40000) {
		tries++;
		/* 第 1 轮真实鼠标（保住"用户真的点得动页签"的语义）；之后 JS 直点保底。
		 * 页签切换是**幂等**的 ⇒ 重复点不会造成副作用（与"派发"不同）。 */
		const c = tries === 1
			? await clickByText('[role="tab"]', "总监")
			: await clickJsByText('[role="tab"]', "总监");
		if (!c.ok) {
			LOG.push("  [起点] 第 " + tries + " 轮：点击未命中 " + JSON.stringify(c.info));
			await sleep(700);
			continue;
		}
		ok = !!(await waitFor(async () => {
			await sleep(350);
			return await js("!!document.querySelector('[data-testid=\"dp-root\"]')");
		}, 5, 250));
		if (!ok) {
			const st = await js("JSON.stringify([].slice.call(document.querySelectorAll('[role=tab]')).map(function(e){return String(e.textContent||'').trim()+':'+e.getAttribute('aria-selected');}))");
			LOG.push("  [起点] 第 " + tries + " 轮未挂载（累计 " + (Date.now() - tStart) + "ms）页签=" + st
				+ " · 几何=" + JSON.stringify({ at: c.info && c.info.at, hit: c.info && c.info.hit }));
			await sleep(900);
		}
	}
	LOG.push("  [起点] 主路点击 " + tries + " 轮 · 耗时 " + (Date.now() - tStart) + "ms · 挂载=" + ok);
	if (!ok) {
		const c2 = await clickSel('[data-testid="d-open-director"]', "浮动组·打开总监");
		LOG.push("  [起点] 退路点「打开总监」：" + JSON.stringify({ ok: c2.ok, info: c2.info }));
		if (c2.ok) {
			ok = !!(await waitFor(async () => {
				await sleep(400);
				return await js("!!document.querySelector('[data-testid=\"dp-root\"]')");
			}, 12, 400));
		}
	}
	dpRoot = ok;
	LOG.push("  [起点] 终局 dp-root=" + dpRoot);
	if (!dpRoot) {
		/* 🔴 第 23 批：起点失败必须**报出可分辨原因**（纪律 58）—— 三种归因修法完全不同：
		 *   ① 选中态没变 ⇒ 点击链路问题（浮层吃点击 / 命中错元素 / tab 不是可点元素）
		 *   ② 选中态变了但内容没挂载 ⇒ 插件注册或 slot 渲染问题
		 *   ③ 页签环里根本没有「总监」⇒ 视图未注册
		 *   旧写法三者都只印一句"dp-root=false"，查了半小时才排除点击链路。 */
		const diag = await js("(function(){var ts=[].slice.call(document.querySelectorAll('[role=tab]'));"
			+ "var sel=ts.filter(function(e){return e.getAttribute('aria-selected')==='true';}).map(function(e){return String(e.textContent||'').trim();});"
			+ "return JSON.stringify({ring:ts.map(function(e){return String(e.textContent||'').trim();}),selected:sel,"
			+ "hasDirector:ts.some(function(e){return String(e.textContent||'').trim()==='总监';}),"
			+ "handle:window.__dshDirectorView?!!window.__dshDirectorView.registered:null,"
			+ "idPresent:!!document.getElementById('dsh-director-page'),"
			+ "textured:document.querySelectorAll('.dp-textured').length});})()");
		LOG.push("  [起点] 🔴 失败归因 = " + diag);
	}
	/* 🔴 第二十四轮：起点两次都立不起来 ⇒ **判 INVALID，不判产品红**（纪律 58/94）。
	 *    理由：`dp-root` 不在 DOM ⇒ 后面 20+ 条断言读的都是"元素不存在"，
	 *    红得一模一样却归因不到产品 —— 这正是"级联假红"的形态。
	 *    可分辨原因由共享模块给出（无环 / 无「总监」/ 已选中但未渲染 / 点了没切）。 */
	if (!dpRoot) {
		markInvalid("起点建立失败：" + (BOOT.reason || "未知") + "（DL-1a 及之后的红**不计入产品缺陷**）");
	}
}
t("DL-1a", "起点：`dp-root` 在 DOM（纪律 30：只认 dp-root，不认注册句柄）", dpRoot === true, dpRoot);
const splitBtn = await js("!!document.querySelector('[data-testid=\"dp-act-split\"]')");
const collectBtn = await js("!!document.querySelector('[data-testid=\"dp-act-collect\"]')");
t("DL-1b", "「🌿 派发」「📥 回收」按钮都在 DOM", splitBtn === true && collectBtn === true, { splitBtn: splitBtn, collectBtn: collectBtn });
const liveBefore = await js(LIVE_N);
t("DL-1c", "🔴 前提：活会话数**可读**（否则「前后相等」是空真 —— 纪律 23）", typeof liveBefore === "number" && liveBefore >= 0, liveBefore);
LOG.push("  [前提] 活会话=" + liveBefore + " · 消息页签=" + stats.tab + " · 库(" + JSON.stringify(stats.db) + ") · 页面异常=" + pageErrors.length);
console.log("  [前提] 活会话=" + liveBefore + " · 消息页签=" + stats.tab);

/* ── B 段：D7 噪声分辨 ──────────────────────────────────────────── */
console.log("\n【B · 🔴 D7 噪声分辨（「让总监去分辨」）】");
const fillNoise = await js("(function(){try{window.__dshChatBridge.setComposerText(" + JSON.stringify(NOISE_REQ) + ");"
	+ "return window.__dshChatBridge.readComposerText();}catch(e){return 'ERR:'+e.message;}})()");
t("DL-2a", "噪声文本注入并**逐字回读一致**（纪律 21：先证前提）", String(fillNoise) === NOISE_REQ, String(fillNoise).slice(0, 40));
const clickNoise = await clickUntil('[data-testid="dp-act-split"]', "🌿 派发（噪声）", async () => {
	const v = await pick('[data-testid="dp-flow-split"]');
	return (v && v["data-kind"] === "noise") ? v : null;
}, 6);
t("DL-2b0", "噪声派发按钮**真实鼠标命中**（视口内 + elementFromPoint 命中自己）",
	!!(clickNoise.info && clickNoise.info.ok === true), clickNoise.info);
LOG.push("  [B] 噪声派发点击轮数 = " + clickNoise.rounds + " · 结果=" + clickNoise.ok + (clickNoise.why ? " · " + clickNoise.why : ""));
const noiseInfo = clickNoise.ok ? clickNoise.val : null;
t("DL-2b", "🔴 噪声 ⇒ `data-kind=noise`（**判定真的跑了**；若判据失效会是 generic）",
	!!noiseInfo && noiseInfo["data-kind"] === "noise",
	noiseInfo ? noiseInfo["data-kind"] : ("无派发读数（" + (clickNoise.why || "点击未生效") + "，已重试 " + clickNoise.rounds + " 轮）"));
t("DL-2c", "🔴 噪声 ⇒ `data-made=0`（**一条分支都不建**；修复前 = 3）",
	!!noiseInfo && String(noiseInfo["data-made"]) === "0", noiseInfo && noiseInfo["data-made"]);
const liveAfterNoise = await js(LIVE_N);
t("DL-2d", "🔴 **正对照**：噪声前后活会话数**相等**（配合 DL-2b 才有意义 —— 否则「点击失效」也会相等）", typeof liveAfterNoise === "number" && liveAfterNoise === liveBefore, { before: liveBefore, after: liveAfterNoise });
/* 🔴 第二十四轮新增：**光有 kind=noise 证不了"分辨对了"**。
 *    8 类噪声里哪怕 7 类被误判成同一类，只要都返回 `noise`，DL-2b/c/d 照样全绿
 *    （纪律 23：每条断言都要问"反例上会不会也通过"）。
 *    ⇒ 断言 `data-reason`：① 非空（**原因必须报出来**，不是一句"无意义"打发）；
 *       ② 含用例期望的原因类别（寒暄/乱敲/标点/重复/注入）。
 *    反例：若分辨判据退化成 `return "无意义"`（不看内容），本条**立刻红**。 */
const noiseReason = noiseInfo ? String(noiseInfo["data-reason"] || "") : "";
t("DL-2e", "🔴 **分辨原因可读且对得上**（`data-reason` 非空且含「" + CASE.expectReasonHas + "」）",
	!!noiseInfo && noiseReason.length > 0 && noiseReason.indexOf(CASE.expectReasonHas) >= 0,
	noiseInfo ? { reason: noiseReason.slice(0, 80), want: CASE.expectReasonHas, case: CASE.id } : "无派发读数");

/* ── B′ 段：正对照 —— 同一按钮投真需求必须仍然工作 ───────────────── */
console.log("\n【B′ · 🔴 正对照：同一按钮投真实项目必须仍然派发】");
const fillNovel = await js("(function(){try{window.__dshChatBridge.setComposerText(" + JSON.stringify(NOVEL_REQ) + ");"
	+ "return window.__dshChatBridge.readComposerText();}catch(e){return 'ERR:'+e.message;}})()");
t("DL-3a", "真实需求注入并逐字回读一致", String(fillNovel) === NOVEL_REQ, String(fillNovel).slice(0, 40));
const msgBeforeDispatch = JSON.parse(await js(MSG_STATE));
/* 🔴 期望 kind **来自用例**（小说项目 ⇒ novel；游戏/插件项目 ⇒ generic）。
 *    旧写法写死 `novel` ⇒ **非小说项目永远测不到**，且会误导：把"通用分线"当成失败。 */
const clickNovel = await clickUntil('[data-testid="dp-act-split"]', "🌿 派发（真实项目）", async () => {
	const v = await pick('[data-testid="dp-flow-split"]');
	return (v && v["data-kind"] === CASE.expectKind && Number(v["data-made"]) > 0) ? v : null;
}, 6);
t("DL-3b0", "真实需求派发按钮真实鼠标命中", !!(clickNovel.info && clickNovel.info.ok === true), clickNovel.info);
LOG.push("  [B′] 真实派发点击轮数 = " + clickNovel.rounds + " · 结果=" + clickNovel.ok + (clickNovel.why ? " · " + clickNovel.why : ""));
const novelInfo = clickNovel.ok ? clickNovel.val : null;
t("DL-3b", "🔴 **正对照**：真实项目 ⇒ `data-kind=" + CASE.expectKind + "` 且 `made>0`（证明 B 段的「0 条」是**判定生效**，不是点击失效）",
	!!novelInfo, novelInfo ? { kind: novelInfo["data-kind"], made: novelInfo["data-made"] } : ("无派发读数（" + (clickNovel.why || "点击未生效") + "，已重试 " + clickNovel.rounds + " 轮）"));
/* 🔴 期望数 = **用例自己的期望维度集合大小**（19 号文 N1 规格演进）。
 *    旧写法 `=== 8` 隐含"小说 ⇒ 恒 8 条"，N1 落地后 `plan()` 按需求原话精确取集
 *    （默认用例 C1 点名 5 维 ⇒ 实测 made=5）⇒ 硬编码 8 会**假红**。
 *    ⚠️ 这里**不能**改成 `plan(CASE.real).dims.length` —— 那是拿被测产品给自己出题（同源空真）；
 *       `CASE.expectDims` 是**人审过的期望集合**，属独立真相源。 */
const WANT_MADE = Array.isArray(CASE.expectDims) ? CASE.expectDims.length : 0;
t("DL-3c", "🔴 **分线口径与需求取集一致**（用例 " + CASE.id + " 点名 " + WANT_MADE + " 维 ⇒ `data-made` 恰为该数）",
	!!novelInfo && WANT_MADE > 0 && Number(novelInfo["data-made"]) === WANT_MADE,
	novelInfo ? { kind: novelInfo["data-kind"], made: novelInfo["data-made"], dims: novelInfo["data-dims"], want: WANT_MADE, case: CASE.id } : "无派发读数");

/* ── C 段：D10 界面滞后 + D8 整理 + D9 项目把控 ─────────────────── */
console.log("\n【C · 🔴 D10 界面滞后 / D8 语言整理 / D9 项目把控】");
/* 🔴 派发后的 UI 存在性读数（纪律 54）—— 下面 DL-5a 报红时**必须**能看出"是没更新还是整块没了" */
await backToDirectorPage("C"); /* T-PLUG-059：测总监页计数前幂等回总监页 */
const uiAfterSplit = await js(UI_STATE);
LOG.push("  [C] 派发后 UI 状态 = " + uiAfterSplit);
console.log("  [C] 派发后 UI 状态 = " + uiAfterSplit);
const msgAfterDispatch = novelInfo ? await waitFor(async () => {
	const v = await js(MSG_STATE);
	const st = JSON.parse(v);
	return (st.tab === msgBeforeDispatch.tab + 1) ? st : null;
}, 30, 400) : null;
t("DL-5a", "🔴 **D10**：派发后**有界等待**页签 = 派发前 + 1（修复前恒不变 ⇒ 界面滞后一条）",
	!!msgAfterDispatch && msgAfterDispatch.tab === msgBeforeDispatch.tab + 1,
	msgAfterDispatch ? { before: msgBeforeDispatch.tab, after: msgAfterDispatch.tab }
		: ("超预算未达成 ｜ 派发前 tab=" + msgBeforeDispatch.tab + " · 派发后 UI=" + String(uiAfterSplit).slice(0, 220)));

const briefInfo = await js("(function(){var d=window.__dshDispatchLog;if(!d||!d.items||!d.items.length)return null;"
	+ "var it=d.items[d.items.length-1];return JSON.stringify({label:it.label,brief:String(it.brief||''),len:String(it.brief||'').length});})()");
let brief = null;
try { brief = JSON.parse(briefInfo); } catch (e) { brief = null; }
t("DL-4a", "🔴 **D9 项目把控**：派发简报含「项目把控」四步（总监把项目现状变成**必须回报**的指令）",
	!!brief && brief.brief.indexOf("项目把控") >= 0 && brief.brief.indexOf("回报") >= 0,
	brief ? { briefLen: brief.brief.length, hasProject: brief.brief.indexOf("项目把控") >= 0, hasReport: brief.brief.indexOf("回报") >= 0, head: brief.brief.slice(0, 90) } : "读不到台账 brief（台账 item 无 brief 字段 ⇒ 简报未进台账）");
t("DL-4b", "🔴 **D8 语言整理**：派发简报含「需求整理」要点块 + 原文保真",
	!!brief && brief.brief.indexOf("【需求整理】") >= 0 && brief.brief.indexOf("需求原文：") >= 0,
	brief ? { briefLen: brief.brief.length, hasOrg: brief.brief.indexOf("【需求整理】") >= 0, hasRaw: brief.brief.indexOf("需求原文：") >= 0, tail: brief.brief.slice(-120) } : "读不到台账 brief（台账 item 无 brief 字段 ⇒ 简报未进台账）");
t("DL-6a", "派发读数自洽：`made == sent`（简报真的投出去了，不只是建了空会话）",
	!!novelInfo && novelInfo["data-made"] === novelInfo["data-sent"],
	novelInfo && { made: novelInfo["data-made"], sent: novelInfo["data-sent"] });
t("DL-6b", "🔴 复用/新建**可分**且**守恒**：`reused + created == made`（第 19 批能力回归）",
	!!novelInfo && (Number(novelInfo["data-reused"]) + Number(novelInfo["data-created"]) === Number(novelInfo["data-made"])),
	novelInfo && { reused: novelInfo["data-reused"], created: novelInfo["data-created"], made: novelInfo["data-made"] });
/* 🔴 **首见允许新建**：同一批维度组第一次出现时 `created>0` 是**正确行为**
 *    （"先考虑目前存在的会话，没有才建"）。连跑脚本按用例是否已出现过置 `DL_ALLOW_CREATE`。
 *    默认 `0` = 严格复用 ⇒ 若哪一轮又开始建新会话，本条**立刻红**
 *    （第二十一轮「一百多个会话」的防回归）。 */
t("DL-6c", "🔴 **先复用再新建**：`made>0` 时 `reused == made`" + (ALLOW_CREATE ? "（本轮=首见该维度组 ⇒ 允许 `created>0`）" : "（**严格复用**，不允许新建）"),
	!!novelInfo && Number(novelInfo["data-made"]) > 0
	&& (ALLOW_CREATE ? true : novelInfo["data-reused"] === novelInfo["data-made"]),
	novelInfo && { reused: novelInfo["data-reused"], made: novelInfo["data-made"], created: novelInfo["data-created"], allowCreate: ALLOW_CREATE });
t("DL-6d", "整理读数落盘：`data-org-lines ≥ 1`（真实需求整理出要点）",
	!!novelInfo && Number(novelInfo["data-org-lines"]) >= 1,
	novelInfo && { lines: novelInfo["data-org-lines"], noise: novelInfo["data-org-noise"] });
/* 🔴 第二十四轮新增：**混合输入必须真去噪**（用例 C6：真实需求里混 2 行噪声）。
 *    只断言"整理出要点"时，"把噪声行也当成要点一起投"同样能通过 ⇒ 必须断言剔除行数。 */
t("DL-6e", "🔴 **整理去噪达到用例期望**：剔除噪声行 `≥ " + CASE.expectOrgNoiseMin + "`",
	!!novelInfo && Number(novelInfo["data-org-noise"]) >= Number(CASE.expectOrgNoiseMin),
	novelInfo && { noise: novelInfo["data-org-noise"], want: CASE.expectOrgNoiseMin, case: CASE.id });

/* ── D 段：回收 + D8 归纳式汇总 ────────────────────────────────── */
console.log("\n【D · 🔴 D8 归纳式汇总】");
const msgBeforeCollect = JSON.parse(await js(MSG_STATE));
/* 🔴 回收**点击前**的 UI 读数：`clickUntil` 只会说"不在 DOM"，不问"为什么不在" */
const uiBeforeCollect = await js(UI_STATE);
LOG.push("  [D] 回收前 UI 状态 = " + uiBeforeCollect);
console.log("  [D] 回收前 UI 状态 = " + uiBeforeCollect);
await backToDirectorPage("D-pre"); /* T-PLUG-059：回收按钮在总监页上，先回总监页 */
const clickCollect = await clickUntil('[data-testid="dp-act-collect"]', "📥 回收", async () => {
	return await pick('[data-testid="dp-flow-collect"]');
}, 6);
LOG.push("  [D] 回收点击轮数 = " + clickCollect.rounds + " · 结果=" + clickCollect.ok + (clickCollect.why ? " · " + clickCollect.why : ""));
const collectInfo = clickCollect.ok ? clickCollect.val : null;
t("DL-7a", "回收读数出现且 `total>0`（回收链跑通）",
	!!collectInfo && Number(collectInfo["data-total"]) > 0,
	collectInfo && collectInfo["data-total"]
		|| ("无回收读数 ｜ 命中=" + JSON.stringify(clickCollect.info || null) + " · 回收前 UI=" + String(uiBeforeCollect).slice(0, 220)));
await backToDirectorPage("D-post"); /* T-PLUG-059：回收后再读计数前幂等回总监页 */
const msgAfterCollect = await waitFor(async () => {
	const st = JSON.parse(await js(MSG_STATE));
	return (st.tab === msgBeforeCollect.tab + 1) ? st : null;
}, 30, 400);
t("DL-5b", "🔴 **D10 第二处**：回收后页签 = 回收前 + 1（同一根因，两处都要修）",
	!!msgAfterCollect && msgAfterCollect.tab === msgBeforeCollect.tab + 1,
	msgAfterCollect ? { before: msgBeforeCollect.tab, after: msgAfterCollect.tab }
		: ("超预算未达成 ｜ 回收前 tab=" + msgBeforeCollect.tab + " · 回收后 UI=" + String(await js(UI_STATE)).slice(0, 220)));
/* 🔴 第 23 批：`dp-dir-msg` **只在「消息」页签激活时渲染** —— 实测 `msgRows=0`
 *    而页签文案**已经是「总监消息 5」**（说明消息写进去了，只是视图没切）。
 *    ⇒ 只看 DOM 会**把"没切视图"误判成"消息没写"**（本轮就是这么红了两条）。
 *    消息真实落点是 IndexedDB `directorConversations`
 *    （`store/plugin-db.js` 的 `appendDirectorMessage`，键 `messageId/nodeId/role/kind/text/at`）
 *    ⇒ 改**双通道**：DOM 优先，库兜底；库取「最新动作所在节点」的最新一条（与界面口径一致）。
 *    双通道都读不到才判红 —— 那才是真的没写。 */
/* T-PLUG-053 ⑤：双通道实现已抽公共到 _cdp-lastmsg.mjs#readLastDirectorMessage（纪律 126）。
 *    口径不变：DOM 优先（dp-dir-msg 最后一条），IndexedDB directorConversations 兜底（最新节点最新一条）。 */
const _lm = await readLastDirectorMessage(js);
let lastMsg = _lm.text;
let lastMsgSrc = _lm.src;
LOG.push("  [D] 最新总监消息来源=" + lastMsgSrc + " · DOM 行数=" + await js("document.querySelectorAll('[data-testid=\"dp-dir-msg\"]').length")
	+ " · text 头=" + String(lastMsg || "").slice(0, 60));
const dupeWhy = (function () {
	if (!lastMsg) return null;
	/* 同因归并判据：任一句子若在文案里出现 >1 次 ⇒ 未归并（旧版 8 条会各印一遍） */
	const parts = String(lastMsg).split(/[；;·]/).map((s) => s.trim()).filter((s) => s.length > 20);
	const seen = {};
	let maxDup = 1;
	parts.forEach((p) => { seen[p] = (seen[p] || 0) + 1; if (seen[p] > maxDup) maxDup = seen[p]; });
	return { parts: parts.length, maxDup: maxDup };
})();
t("DL-7b", "🔴 最新总监消息是**归纳式**（含「【总监汇总】」；修复前是「【回收产出】」逐条罗列）",
	!!lastMsg && lastMsg.indexOf("【总监汇总】") >= 0, lastMsg ? lastMsg.slice(0, 90) : "读不到消息");
t("DL-7c", "🔴 同因**未重复印**（长句最大重复次数 == 1；旧版同一原因会印 8 遍）",
	!!dupeWhy && dupeWhy.maxDup === 1, dupeWhy);

/* ── E 段：收尾 ────────────────────────────────────────────────── */
console.log("\n【E 收尾复原】");
const cleaned = await js("(function(){try{window.__dshChatBridge.setComposerText('');"
	+ "return window.__dshChatBridge.readComposerText();}catch(e){return 'ERR:'+e.message;}})()");
t("DL-8a", "原生输入框已还原为空（不留测试文本）", cleaned === "" || cleaned === null, cleaned);
t("DL-8b", "🔴 页面**零未捕获异常**（onClick 是 async —— 抛错会变成「什么都没发生」，必须判红）",
	pageErrors.length === 0, pageErrors.slice(0, 3));
/* 🔴 连跑脚本用的**单行机器读数**。
 *    为什么不用正则刮人类可读输出：文案一改（比如把「通过」改成「绿」）就**静默失配**，
 *    连跑 40 轮会得出一张全空却"没报错"的表 —— 那比红更危险（纪律 54：静默半成功更坏）。 */
const liveEnd = await js(LIVE_N);
t("DL-8c", "🔴 收尾仍**读得到**活会话数（否则「净增」判据是空真 —— 纪律 23）",
	typeof liveEnd === "number" && liveEnd >= 0, liveEnd);
console.log("RESULT " + JSON.stringify({
	case: CASE.id, expectKind: CASE.expectKind, allowCreate: ALLOW_CREATE,
	noiseKind: noiseInfo ? noiseInfo["data-kind"] : null,
	noiseReason: noiseReason.slice(0, 60),
	kind: novelInfo ? novelInfo["data-kind"] : null,
	made: novelInfo ? Number(novelInfo["data-made"]) : null,
	reused: novelInfo ? Number(novelInfo["data-reused"]) : null,
	created: novelInfo ? Number(novelInfo["data-created"]) : null,
	orgNoise: novelInfo ? Number(novelInfo["data-org-noise"]) : null,
	orgLines: novelInfo ? Number(novelInfo["data-org-lines"]) : null,
	liveBefore: liveBefore, liveAfterNoise: liveAfterNoise, liveEnd: liveEnd,
	pass: pass, fail: fail, invalid: invalid,
	/* 🔴 T-PLUG-054：**兜底命中数**进 RESULT 机器读数 —— 连跑脚本据此对账
	 *    「本轮是否出现高频兜底」；前提成立时 `diag` 应恒为 **0**。 */
	mouse: CL.stats.mouse, diag: CL.stats.diag, geomFail: CL.stats.geomFail
}));

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  通过 " + pass + " / 失败 " + fail);
/* 🔴 兜底计数（纪律 96）：兜底不是"更可靠"，是"**前提可能有问题**"的信号灯。
 *    第二十四轮已把 `el.click()` 降级为**诊断通道**并记账 —— 前提成立时须为 0。 */
console.log("  点击通道：" + CL.diagSummary()
	+ (CL.stats.diag > 0 ? "   ⚠️ **兜底被走到 ⇒ 先查前提**（纪律 90）" : "   ✅ 零兜底"));
console.log("  IS_PASS: " + (invalid ? "INVALID" : (fail === 0 ? "TRUE" : "FALSE")));
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("═══════════════════════════════════════════════════════════");
try { mkdirSync("logs", { recursive: true }); } catch (e) { /* 已存在 */ }
/* 🔴 第 23 批：**取证产物不许被下一次跑覆盖**（纪律 57：闸门全绿 ≠ 能验收；产物本身也要当真）。
 *    实测教训：本轮「reload 后立刻跑 = 13/25 红」的**完整日志**被紧随其后的绿跑
 *    **直接覆盖**，只能靠终端残留的 8 行 tail 反推 ⇒ 定位假红的证据当场丢失，
 *    白跑一轮（这正是"重复测试"最不该付出的代价）。 */
const _l23at = new Date();
const _l23p2 = (n) => String(n).padStart(2, "0");
const _l23name = "" + _l23at.getFullYear() + _l23p2(_l23at.getMonth() + 1) + _l23p2(_l23at.getDate())
	+ "-" + _l23p2(_l23at.getHours()) + _l23p2(_l23at.getMinutes()) + _l23p2(_l23at.getSeconds());
const _l23verdict = invalid ? "INVALID" : (fail === 0 ? "PASS" : "FAIL" + fail);
LOG.push("  [留痕] 本次结果 " + _l23verdict + " ⇒ logs/_r23-verify-" + _l23name + "-" + _l23verdict + ".txt（latest 另存一份，不带戳）");
writeFileSync("logs/_r23-verify-director-logic.txt", LOG.join("\n"), "utf8");
writeFileSync("logs/_r23-verify-" + _l23name + "-" + _l23verdict + ".txt", LOG.join("\n"), "utf8");
console.log("  留痕：logs/_r23-verify-" + _l23name + "-" + _l23verdict + ".txt");
const shot = await sendX("Page.captureScreenshot", { format: "png" }).catch(() => null);
if (shot && shot.data) writeFileSync("logs/_r23-verify-director-logic.png", Buffer.from(shot.data, "base64"));
ws.close();
process.exit(invalid ? 2 : (fail === 0 ? 0 : 1));
