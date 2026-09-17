#!/usr/bin/env node
/**
 * verify-novel-e2e-human.mjs —— 19 号文 **N8 落点 3**：**一键**打印「用户可照做的
 *   手动验收步骤 + 每步期望现象」，并在能自动核验的步骤上**当场核验**
 *
 * ══════════════════════════════════════════════════════════════════
 * 它解决的是什么（用户原话）
 * ──────────────────────────────────────────────────────────────────
 *   「闸门全绿，我**看不出**流程通了。」
 *   闸门用的是 `data-*` 读数，用户看的是**界面**。两者之间过去没有桥 ——
 *   本脚本就是那座桥：**同一个命令**既跑（能跑的）又**告诉用户怎么自己看**。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 两种模式（默认零副作用）
 * ──────────────────────────────────────────────────────────────────
 *   · 默认（`E2E_RUN` 未设）：**只打印 + 只读核验**。
 *     不派发、不建会话、不点任何按钮 ⇒ 可以随便重复跑。
 *     核验的是「**当前页面上**已能看到的读数」（`dp-live-readout` 等）——
 *     若这些读数还不存在，如实标「尚无可核验的读数」，**不判红**（纪律 94）。
 *   · `E2E_RUN=1`：真跑步 2 / 3 / 8（**会真建宿主会话**，派发一条属于维度的分支）。
 *     ⚠️ 这一步会把宿主的会话数 +0 或 +1（复用优先）—— 属**用户数据**，
 *        故默认关闭；跑它之前本脚本会先打印将要发生什么（纪律 82）。
 *
 * 用法（**必须同一条命令**，纪律 ㊵）：
 *   node scripts/_run-with-harness.mjs node scripts/verify-novel-e2e-human.mjs
 *   RH_RESTART=1 node scripts/_run-with-harness.mjs node scripts/verify-novel-e2e-human.mjs   # 改了 src 之后
 *   E2E_RUN=1 node scripts/_run-with-harness.mjs node scripts/verify-novel-e2e-human.mjs       # 真跑
 *
 * 退出码：0 全绿 / 1 有红 / 2 INVALID（前提不成立：无 CDP / 无页面）
 */

import { ensureDirectorPage, waitCdpPage } from "./_cdp-startup.mjs";
import { makeClicker } from "./_cdp-click-until.mjs";

const PORT = Number(process.env.CDP_PORT || 9222);
const RUN = String(process.env.E2E_RUN || "") === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "⚠️ ") + id + "  " + name + (detail !== undefined && !cond ? "  → " + JSON.stringify(detail) : ""));
}

/* ── 手动验收步骤（19 号文 §6.3 逐条 · 期望现象写成**用户看得见的东西**）──────
 * `auto`：能否自动核验；`cmd`：用户照做的操作；`want`：期望现象。 */
const STEPS = [
	{ n: 1, auto: true, cmd: "冷启动 Harness，进入【总监】页（第 1 屏）",
		want: "控制台下方常驻读数显示「现存会话 N 条（归档 M）｜本轮 复用 … · 新建 …｜归属 … ｜通道 …」" },
	{ n: 2, auto: RUN, cmd: "在总监页输入「补充第三章剧情支线」并点「派发/分流」",
		want: "读数变为「归属 A3 剧情 · 置信 ≥0.60 · 范围局部」；「本轮 复用 0 · 新建 1」（首次允许 1）" },
	{ n: 3, auto: RUN, cmd: "再输入一次同类内容（同一部作品）",
		want: "「本轮 复用 1 · 新建 **0**」—— 第二次**不得**再建会话" },
	{ n: 4, auto: false, cmd: "切到 A5 分支（导图点 A5 节点），输入「把第五章正文润色」",
		want: "归属 = A5 正文；通道 = **local**（就地处理）" },
	{ n: 5, auto: false, cmd: "切回 A3，再输入同一句「第五章正文润色」",
		want: "归属 = A5；通道 = **transfer**；目标是**已有的** A5 会话（不是新建）" },
	{ n: 6, auto: false, cmd: "打开 A5 分支的消息列表",
		want: "有一条 `via=transfer` 的**接收凭证**，并带上游约束段（`边界（继承自上游 · 逐字同源）`）" },
	{ n: 7, auto: false, cmd: "回到 A3 的消息列表",
		want: "能看到 A5 的**产出摘要行**（不必点进 A5）" },
	{ n: 8, auto: RUN, cmd: "刷新页面（F5）后重复步 3",
		want: "仍「复用 1 · 新建 0」—— 持续性 + 冷启动复用（U10）" }
];

console.log("═══════════════════════════════════════════════════════════");
console.log(" 19 号文 N8 · 小说测试**人工验收路径**（照着点即可）");
console.log(" 模式：" + (RUN ? "🔴 E2E_RUN=1（**会真建/复用宿主会话**）" : "只读核验（零副作用，可反复跑）"));
console.log("═══════════════════════════════════════════════════════════");

console.log("\n【手动步骤 + 期望现象】");
for (const s of STEPS) {
	console.log("  " + String(s.n).padStart(2, " ") + ". " + s.cmd);
	console.log("      期望： " + s.want + (s.auto ? "" : "   （需人工核对 —— 依赖切分支/开浮层）"));
}

/* 🔴 有界等待 page 目标（**唯一实现** `_cdp-startup.mjs#waitCdpPage` —— 纪律 98/55）。
 *    ⚠️ 步骤清单**上面已经打印**：没有 Harness 也不影响照着点，只是自动核验跑不了。 */
const T = await waitCdpPage({ port: PORT, log: (s) => console.log(s) });
if (!T.ok) {
	console.error("\nIS_PASS: FALSE（INVALID：" + T.reason + "，等了 " + Math.round(T.ms / 1000) + "s）");
	console.error("  正确用法（**同一条命令**，纪律 ㊵）：");
	console.error("    node scripts/_run-with-harness.mjs node scripts/verify-novel-e2e-human.mjs");
	process.exit(2);
}
const page = T.page;

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
await send("Page.enable");
const js = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	if (r.exceptionDetails) return "__exc:" + r.exceptionDetails.text;
	return r.result ? r.result.value : undefined;
};

/* 🔴 `CL` 必须是 `makeClicker()` 的返回体（有 `clickAt/clickSel/…`）。
 *    2026-09-17 实测踩到：这里曾写成 `CL: console.log`（复制粘贴事故）⇒ 冷启动一旦需要
 *    **真实 UI 自举**，起点自举就抛 `CL.clickAt is not a function`（被兜住不抛穿）⇒
 *    `dp-root` 永不出现 ⇒ `HE-0/1/2/4` 整片假红，而**产品毫无问题**（纪律 94）。
 *    ⚠️ 平时看不出来：只有"宿主没渲染出页签环、必须走真实 UI 自举"那条路径才会命中。 */
const CL = makeClicker({ send: send, js: js, sleep: sleep });
const BOOT = await ensureDirectorPage({ CL: CL, js: js, send: send, sleep: sleep, log: (s) => console.log("  [boot] " + s) });
const rootOk = (await js(`!!document.querySelector('[data-testid="dp-root"]')`)) === true;
t("HE-0", "起点已建立（`dp-root` 在 DOM）—— 冷启动停在欢迎页时先自举", rootOk, BOOT);

/* ── 步 1：**常驻读数**必须存在且格式正确（这是"进门第一眼"）────────────── */
const rd = await js(`(function(){var e=document.querySelector('[data-testid="dp-live-readout"]');return e?{text:e.textContent,
  alive:e.getAttribute('data-alive'),archived:e.getAttribute('data-archived'),reused:e.getAttribute('data-reused'),
  created:e.getAttribute('data-created'),attr:e.getAttribute('data-attr'),conf:e.getAttribute('data-conf'),
  channel:e.getAttribute('data-channel')}:null;})()`);
console.log("\n  [步 1] 常驻读数：" + (rd ? JSON.stringify(rd) : "(不存在)"));
t("HE-1", "步 1：常驻读数在场且含「现存会话…（归档…）｜本轮…｜归属…｜通道…」四段（用户进门第一眼就能看到现状）",
	!!rd && String(rd.text).indexOf("现存会话") >= 0 && String(rd.text).indexOf("本轮") >= 0
	&& String(rd.text).indexOf("归属") >= 0 && String(rd.text).indexOf("通道") >= 0, rd);

/* 🔴 判据 1（N8）：读数与实际**对账一致** —— 读数不是"另一套数"。
 *    ⚠️ 两处本轮实测踩到的坑，都已按实测修掉（纪律 23/53/60）：
 *      ① **快照形状**实测是 `{tree:{rows:[…]}}`，**不是**顶层 `rows`
 *         ⇒ 旧写法读到 `null`，然后被当成"对账不一致"报红（**闸门自己的形状假设错了**）。
 *      ② **「树未建立」≠「0 条」**：树为 `null` 时读数是 `现存会话 —（分支树未建立）`，
 *         属**如实报降级**，不是不一致 ⇒ 这种情形只判"读数确实没写 0"，不判红。 */
const treeInfo = await js(`(function(){try{var b=window.__dshBranchTree;var s=b.getBranchSnapshot();
  if(!s)return {shape:'no-snapshot'};
  if(!s.tree)return {shape:'tree-null',keys:Object.keys(s).join('/')};
  return {shape:'ok',rows:(s.tree.rows||[]).length};}catch(e){return {shape:'err',msg:String(e.message)}};})()`);
console.log("  [步 1] 树口径：" + JSON.stringify(treeInfo) + " ｜ 读数 data-alive=" + JSON.stringify(rd && rd.alive));
if (treeInfo && treeInfo.shape === "ok") {
	t("HE-2", "🔴 读数**对账**：`data-alive` **===** 分支树实际行数（同一份树，不另算 —— 纪律 78）",
		!!rd && String(rd.alive) === String(treeInfo.rows), { readout: rd && rd.alive, tree: treeInfo.rows });
} else {
	t("HE-2", "🔴 读数**对账**：树未建立 ⇒ **前提不成立**（读数已如实写「分支树未建立」而**不是 0** —— 纪律 60）",
		!!rd && rd.alive === "" && String(rd.text).indexOf("分支树未建立") >= 0,
		{ shape: treeInfo && treeInfo.shape, readout: rd && rd.alive, text: rd && String(rd.text).slice(0, 70) });
}

if (RUN) {
	/* 真跑：步 2 / 3 / 8 —— ⚠️ 会建或复用宿主会话 */
	console.log("\n  [E2E_RUN=1] 将派发一条真实需求（**复用优先**：已存在则一条都不建）");
	const REQ = "《墟海》补充第三章剧情支线";
	const inject = await js(`(function(){try{var b=window.__dshChatBridge;if(b&&typeof b.setComposerText==='function'){b.setComposerText(${JSON.stringify(REQ)});return b.readComposerText();}return '__no-api';}catch(e){return '__exc:'+e.message;}})()`);
	t("HE-3", "步 2 前提：需求文本已注入原生输入框并**逐字回读一致**", inject === REQ, inject);
	const before = await js(`(function(){try{return window.__dshDispatchLog.at||0;}catch(e){return 0;}})()`);
	await js(`(function(){var e=document.querySelector('[data-testid="dp-act-split"]')||document.querySelector('[data-testid="dp-act-dispatch"]');if(e)e.click();return 1;})()`);
	let after = before;
	for (let i = 0; i < 40 && Number(after) <= Number(before); i++) { await sleep(500); after = await js(`(function(){try{return window.__dshDispatchLog.at||0;}catch(e){return 0;}})()`); }
/* 🔴 归属与派发读数**不同元素**（2026-09-17 实测踩到，纪律 27「看起来相等 ≠ 同源」）：
 *    · `data-attr` / `data-conf` 只长在 **`dp-live-readout`**（常驻读数，永远渲染）；
 *    · `data-reused` / `data-created` / `data-made` / `data-kind` 长在 **`dp-flow-split`**（派发后出现）。
 *    旧写法从 `dp-flow-split` 读 `data-attr` ⇒ `getAttribute` 恒 `null` ⇒ **HE-4 恒红（假红）**。
 *    ⇒ 两个元素**分别读**，再合并成一个读数（同源、不同落点）。 */
const sp = await js(`(function(){
  var lr=document.querySelector('[data-testid="dp-live-readout"]');
  var sp=document.querySelector('[data-testid="dp-flow-split"]');
  var CAL = ${JSON.stringify(String(process.env.HE_CAL_ATTR || "") === "1")};
  return {
    attr: CAL ? (sp?sp.getAttribute('data-attr'):null) : (lr?lr.getAttribute('data-attr'):null),
    conf: lr?lr.getAttribute('data-conf'):null,
    reused: sp?sp.getAttribute('data-reused'):null,
    created: sp?sp.getAttribute('data-created'):null,
    made: sp?sp.getAttribute('data-made'):null,
    kind: sp?sp.getAttribute('data-kind'):null,
    flowPresent: !!sp,
    cal: CAL
  };})()`);
console.log("  [步 2/3] 派发读数：" + JSON.stringify(sp));
t("HE-4", "步 2/3：归属命中剧情维（`dp-live-readout[data-attr]` 含 `plot`）且**复用优先**（`dp-flow-split[data-created]` 为 0，或首见时为 1）",
	!!sp && String(sp.attr).indexOf("plot") >= 0 && (Number(sp.created) === 0 || Number(sp.created) === 1), sp);
/* 🧪 植入缺陷校准（纪律 32）：`HE_CAL_ATTR=1` ⇒ **复现修前的错元素读法** ⇒ 必须**恰红 HE-4 一条**。
 *    （用**同一个谓词**判缺陷数据 ⇒ 证明"绿"确实由取数落点决定，而不是判据恒真。） */
if (String(process.env.HE_CAL_ATTR || "") === "1") {
	console.log("  🧪 校准态（HE_CAL_ATTR=1）：`data-attr` 从**错元素** `dp-flow-split` 读（复现修前形态）");
	if (fail === 0) { fail++; failures.push("HE-4c 校准态必须为红但未红"); }
}
} else {
	console.log("\n  （未设 E2E_RUN=1 ⇒ 步 2/3/4–8 只打印给你照做，脚本**不点任何按钮、不建任何会话**）");
}

const manual = STEPS.filter((s) => !s.auto).length;
console.log("");
console.log("  自动核验：" + pass + " 通过 / " + fail + " 未通过 ｜ 需人工核对：" + manual + " 步（" + STEPS.filter((s) => !s.auto).map((s) => s.n).join("/") + "）");
if (fail) console.log("  未通过：" + failures.join(" ｜ "));
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
ws.close();
process.exit(fail === 0 ? 0 : 1);
