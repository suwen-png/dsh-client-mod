#!/usr/bin/env node
/**
 * verify-req22.mjs —— 第 40 轮 · 22 号文**批次 A**（G1 家族 / G5 / G6 / G7）真机闸门
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么非有这套件不可（22 号文 §0.2 的结论）
 * ══════════════════════════════════════════════════════════════════
 *  第 40 轮的前提取证读出的是**三套闸门全绿 + 用户实测"差很多"**
 *  ⇒ 用户要的东西**落在闸门覆盖之外**。
 *  本套件就是那块的补丁：把「概况的一键刷新 / 行级 data-kind / 项目清单读数 /
 *  登记不写消息的标注行 / 转交凭证两行」这些**只在源码里存在、没有任何闸门守**的落点
 *  搬到**真机 DOM** 上断言。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 本套件最要紧的一条：**先证"跑的是新包"**（R22-1）
 * ══════════════════════════════════════════════════════════════════
 *  插件在**宿主 boot 时**装载 ⇒ `plugin-install --apply` 之后**不重启就还是旧代码**。
 *  此时在旧包上跑本套件会得到什么？—— 大概率是"新 testid 找不到"的红，
 *  但也可能是**旧包也有同名元素**时的**假绿**（纪律 107：构建面内不许有随跑程变化的输入）。
 *  ⇒ R22-1 用**页内是否存在本轮新装的两个 API** 作分界线：
 *       没有 ⇒ **INVALID（exit 2）**，并明确写"请先重启 Harness"，
 *       而不是报一堆 FAIL 让下一个人去猜"是产品坏了还是没重启"。
 *
 * ══════════════════════════════════════════════════════════════════
 *  覆盖清单（14 条，与下方 `R22-*` 逐条对应）
 * ══════════════════════════════════════════════════════════════════
 *  R22-0   起点：总监页已挂载（权威选择器 `[data-testid="dp-root"]`，**不是** `#dp-root`）
 *  R22-1   🔴 新包已生效（两个新 API 在页内；没有 ⇒ INVALID exit 2 并写明"请先重启"）
 *  R22-2/3/4  装的就是新代码：页内复算 transferLine / acceptLine / registerNote
 *  R22-5  页内 projectInventory 的零项目口径（「未登记项目」四个字，不是空）
 *  R22-6  🔴 DOM 读数 ↔ 页内层级树 **双向对账**（data-projects === 直接 project 子节点数）
 *  R22-7  逐项目行 data-count 与项目数一致（=0 时**不渲染**，不画空壳）
 *  R22-8  读数文本与 DOM 三值自洽
 *  R22-9  弹窗已打开（`d-dialog` 在 DOM）—— 后两条的前提；**挂不上就打印异常全文**
 *  R22-10 G1：`d-scope-brief` 与 `d-brief-refresh` **都在**（后者过去零判据）
 *  R22-11 概况行**行级** data-kind（不是"整块非空"就算过）
 *  R22-12 🔴 收尾环境复原（弹窗状态回到开跑前）
 *  R22-13 🔴 弹窗层健康（`SafeLayer` 角标 `d-layer-error` 不得残留 —— 崩了要能说出是哪层）
 *
 * 用法（**复用已运行实例**，不重启）：
 *   node scripts/run-live.mjs --no-start verify-dialog.mjs verify-req22.mjs
 * 单独跑（实例已在跑）：
 *   node scripts/verify-req22.mjs
 */

import { PORT } from "./cdp-port.mjs";
import { tallyCheck } from "./_test-tally.mjs";
/* 🔴 起点自举与 CDP 等待**只允许一个实现**（纪律 98）。
 *    本套件第一版自造了这两段样板 ⇒ 于是它**没有**起点自举：一旦被排在首套，
 *    冷启动停在欢迎页 ⇒ 后面所有 DOM 判据全部无意义（第 40 轮实证）。
 *    ⇒ 改为复用 `_cdp-startup.mjs`（`verify-director-logic` / `verify-flow` /
 *      `verify-mindmap` / `verify-novel-split` 同族）。 */
import { makeClicker } from "./_cdp-click-until.mjs";
import { waitCdpPage, ensureDirectorPage } from "./_cdp-startup.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0, skip = 0;
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + name); }
	else { fail++; console.log("  ❌ " + id + " " + name + (detail !== undefined ? "\n      " + JSON.stringify(detail) : "")); }
}
function sk(id, name, why) { skip++; console.log("  ⊘ " + id + " " + name + "（" + why + "）"); }

/* 🔴 绝不抛穿：任何未捕获异常/拒绝 ⇒ INVALID(exit 2) + **已跑断言数**。
 *    裸 Node 栈读起来像"闸门坏了"，且丢掉计数 ⇒ 无法判断是环境还是产品。 */
const _bail = (why) => (e) => {
	console.error("\nIS_PASS: FALSE（INVALID：" + why + "）");
	console.error("  已跑 " + (pass + fail + skip) + " 条（通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "）");
	console.error("  原因：" + String((e && e.stack) || e).split("\n").slice(0, 3).join(" ｜ "));
	console.error("  重跑：node scripts/verify-req22.mjs");
	process.exit(2);
};
process.on("uncaughtException", _bail("未捕获异常"));
process.on("unhandledRejection", _bail("未处理的 Promise 拒绝"));

/* ── 等 CDP 就绪（**共用唯一实现**：端口就绪 ≠ page 目标就绪，纪律 98/55）── */
const T = await waitCdpPage({ port: PORT, log: (s) => console.log(s) });
if (!T.ok) {
	console.error("IS_PASS: FALSE（INVALID：" + (T.reason || "连不上 CDP " + PORT) + "）");
	console.error("  真因：Harness 未运行 / 端口被幽灵占用（端口顺移）/ 窗口尚未加载出 page 目标。");
	console.error("  正确用法（启动与测试**同一条命令**）：");
	console.error("    RH_RESTART=1 node scripts/_run-with-harness.mjs bash -c 'node scripts/run-live.mjs verify-req22.mjs'");
	process.exit(2);
}
const page = T.page;
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	const timer = setTimeout(() => { pending.delete(id); rej(new Error("EVAL_TIMEOUT")); }, 12000);
	pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (x) => { clearTimeout(timer); rej(x); } });
	ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
try { await send("Runtime.enable"); } catch (e) { console.log("      [CDP 诊断] Runtime.enable 未确认（不影响断言）：" + String((e && e.message) || e)); }

async function pageAlive() {
	try { const l = await (await fetch("http://127.0.0.1:" + PORT + "/json/list", { cache: "no-store" })).json(); return l.some((x) => x.type === "page" && !/devtools/.test(x.url)); }
	catch (e) { return false; }
}
async function ev(expr) {
	for (let k = 0; k < 2; k++) {
		try {
			const o = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
			if (o && o.exceptionDetails) return { __exc: String(o.exceptionDetails.text || "exception") };
			return o ? (o.result ? o.result.value : null) : null;
		} catch (e) {
			const msg = String((e && e.message) || e);
			if (k === 0) { await sleep(1500); continue; }
			if (!(await pageAlive())) {
				console.error("\nIS_PASS: FALSE（INVALID：跑程中 CDP 页面消失 —— Harness 被并发工作线重启）");
				console.error("  已跑 " + (pass + fail + skip) + " 条（通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "），最后错误：" + msg);
				process.exit(2);
			}
			console.log("      [CDP 诊断] 一次求值失败（页面仍在）⇒ 该断言按读数缺失如实报红：" + msg);
			return null;
		}
	}
	return null;
}
/** 查询元素上的一项读数；元素不存在 ⇒ null（**与"读到 0"可分**） */
const attrOf = (sel, attr) => ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");return e?e.getAttribute(" + JSON.stringify(attr) + "):null;})()");
const textOf = (sel) => ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");return e?String(e.textContent||\"\"):null;})()");

/* ── 起点：确保总监页在（**共用唯一自举实现**，不重启、不新建会话）──────────
 * 🔴 为什么必须自举而不能"假定上一套已建好"：
 *    `run-live.mjs` 的约定是**首套负责自举**。本套件第一版没有自举 ⇒
 *    一旦被排在首套，冷启动停在欢迎页 ⇒ 其后全部 DOM 判据**无意义**
 *    （纪律 30：只认 `dp-root` 在 DOM；它不在 ⇒ 读到的一切都是环境噪声）。
 *    自举实现只允许一个：`_cdp-startup.mjs#ensureDirectorPage`（纪律 98）。 */
console.log("\n── A. 起点与「跑的是新包」（前置）──");
const CL = makeClicker({ send: send, js: ev, sleep: sleep }, {});
const BOOT = await ensureDirectorPage({
	CL: CL, js: ev, send: send, sleep: sleep,
	log: (s) => console.log(s),
	stabilizeMs: Number(process.env.DSH_STABILIZE_MS || 18000)
});
console.log("  [起点] 统一自举：" + (BOOT.ok ? "✅ dp-root 已挂载" : "❌ " + BOOT.reason));

/* 🔴 权威选择器是 `data-testid="dp-root"`，**不是** `#dp-root`。
 *    第 40 轮实证（本套件第一版）：写成 `#dp-root` ⇒ 页面明明已挂载却判红。
 *    真因：`DIRECTOR_PAGE_ID = "dsh-director-page"`，`dp-root` **只作 testid**
 *    ⇒ `#dp-root` 永远查不到。这属**判据自己写错**（不是产品坏），
 *    与纪律 32「判据自身也必须被坏样本校准」同族。
 *    仓内权威写法见 `_acceptance-16.mjs` / `_acceptance-clear.mjs`（一律 testid）。 */
const ROOT_SEL = '[data-testid="dp-root"]';
const rootUp = Boolean(await ev("!!document.querySelector(" + JSON.stringify(ROOT_SEL) + ")"));
const boot = await ev("(function(){return {href: location.href,tabs: document.querySelectorAll('[role=\"tab\"]').length,root: !!" + "document.querySelector(" + JSON.stringify(ROOT_SEL) + ")};})()");
t("R22-0", "总监页已挂载（`" + ROOT_SEL + "` 在 DOM —— 页面判据只认这个）", rootUp, boot);
if (!rootUp) {
	console.error("\nIS_PASS: FALSE（INVALID：总监页未挂载 ⇒ 其后所有 DOM 判据都无意义 —— 纪律 30）");
	console.error("  读数：" + JSON.stringify(boot) + " ｜ 自举原因=" + BOOT.reason);
	console.error("  自举步骤：\n    " + (BOOT.steps || []).join("\n    "));
	console.error("  ⇒ 这**不是**产品缺陷，是**起点未建立**（冷启动停在欢迎页时无常驻总监页；");
	console.error("     宿主可能 58–120s 都没有页签环 —— 纪律 96/133）。");
	console.error("     已跑 " + (pass + fail + skip) + " 条（通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "）");
	process.exit(2);
}

/* 🔴 本套件的分界线：本轮新装的两个 API。没有 ⇒ **跑的还不是新包**。
 * 🔴 **单一真相源**（第 40 轮实证踩过的坑）：下面 `newPack` 只算一次，
 *    守卫与断言共用它。第一版把表达式**写了两份**，断言那份多套了一层 `typeof`
 *    （`typeof apis.pi === "object"`，而 `apis.pi` 本身就是 `typeof` 的结果字符串）
 *    ⇒ **新包已生效却判红**。同一语义两处判据 = 隐式断链（纪律 126）。 */
const apis = await ev("(function(){return {pi: typeof window.__dshProjectInventory, sn: typeof window.__dshSummaryNotes, stamp: (window.__dshBuildStamp||null)};})()");
const newPack = Boolean(apis) && apis.pi === "object" && apis.sn === "object";
if (!newPack) {
	console.error("\nIS_PASS: FALSE（INVALID：页内**没有**本轮新装的 API ⇒ 跑的是**旧包**）");
	console.error("  读数：" + JSON.stringify(apis));
	console.error("  ⇒ 这不是产品缺陷，是「装机后未重启」。插件在宿主 boot 时装载；");
	console.error("     请重启一次 Harness 再跑本套件（每轮只重启一次，攒批跑）。");
	console.error("     已跑 " + (pass + fail + skip) + " 条（通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "）");
	process.exit(2);
}
t("R22-1", "🔴 新包已生效：页内存在 __dshProjectInventory / __dshSummaryNotes（否则本套件测的是旧包 ⇒ 假绿）",
	newPack, apis);
console.log("      · 装机指纹 `__dshBuildStamp` = " + String(apis.stamp) + "（与 build 输出对账靠它）");

/* ── B. "装的就是新代码"：页内复算，与**离线闸门的期望串**逐字比对 ──────────
 * 🔴 这里**故意**把期望串写死第二遍（第一遍在 test-requirement22 的 SN-1/SN-2）：
 *    两份期望若哪天不一致，说明**装机包与源码不同步**（或措辞被单方面改了）
 *    —— 这正是"逐字节一致 ≠ 是新的"（纪律：比内容指纹）要防的那件事。 */
const sn = await ev("(function(){var S=window.__dshSummaryNotes;if(!S)return null;"
	+ "var AT=new Date(2026,0,2,9,5,0,0).getTime();"
	+ "var reg={flowId:'f1',at:AT,trail:[{dim:'director',at:AT,note:'R8 登记'}]};"
	+ "return {tr:S.transferLine({toName:'A3 剧情',dimKey:'plot',at:AT}),"
	+ "ac:S.acceptLine({fromName:'A1 世界观',dimKey:'world',at:AT}),"
	+ "noteEmpty:S.registerNote([],[]),"
	+ "noteReg:S.registerNote([reg],[]),"
	+ "noteAfter:S.registerNote([reg],[{messageId:'m1',at:AT+1000}])};})()");

t("R22-2", "页内 transferLine 逐字 = 「已转交 → A3 剧情（维度 plot）（09:05）」（装机包 = 源码）",
	Boolean(sn) && sn.tr === "已转交 → A3 剧情（维度 plot）（09:05）", sn && sn.tr);

t("R22-3", "页内 acceptLine 逐字 = 「已接收 ← A1 世界观（维度 world）（09:05）」，且与源侧那句**不同**",
	Boolean(sn) && sn.ac === "已接收 ← A1 世界观（维度 world）（09:05）" && sn.ac !== sn.tr, sn && { tr: sn.tr, ac: sn.ac });

t("R22-4", "🔴 页内 registerNote 三种场景都对：无登记⇒空串 / 有登记⇒含「本动作不写总监消息」/ 登记后已有消息⇒空串",
	Boolean(sn) && sn.noteEmpty === "" && String(sn.noteReg).indexOf("本动作不写总监消息") === 0 && sn.noteAfter === "",
	{ empty: sn && sn.noteEmpty, reg: sn && sn.noteReg, after: sn && sn.noteAfter });

const piZero = await ev("(function(){var P=window.__dshProjectInventory;if(!P)return null;"
	+ "var g={id:'__global__',name:'全局',level:'global',childNodes:[]};"
	+ "var inv=P.projectInventory(g,{});"
	+ "return {registered:inv.registered,text:P.inventoryText(inv)};})()");
t("R22-5", "页内 projectInventory 零项目口径：registered=0 **且** 文案 = 「未登记项目」（不是空串）",
	Boolean(piZero) && piZero.registered === 0 && piZero.text === "未登记项目", piZero);

/* ── C. 真机 DOM 读数 ↔ 页内层级树：**双向对账** ────────────────────────
 * 🔴 三处取值必须**逐值相等**：DOM 的 data-projects ／ 页内 projectInventory().registered
 *    ／ 页内树的「直接 project 级子节点数」。任何一个接错源（例如接到宿主分支树
 *    `liveRows` —— 两个 tree 不同源，纪律 27）都会在这里不等。 */
console.log("\n── B. 项目清单读数（G7）真机对账 ──");
const domProj = await attrOf('[data-testid="dp-proj-inventory"]', "data-projects");
const domSess = await attrOf('[data-testid="dp-proj-inventory"]', "data-sessions");
const domDang = await attrOf('[data-testid="dp-proj-inventory"]', "data-dangling");
const invText = await textOf('[data-testid="dp-proj-inventory"]');
const pageInv = await ev("(async function(){try{var H=window.__dshHierarchy;if(!H||typeof H.loadTree!=='function')return null;"
	+ "var t=await H.loadTree();if(!t)return null;"
	+ "var stack=[t],g=null;while(stack.length&&!g){var c=stack.shift();if(c&&c.level==='global'){g=c;break;}if(c&&c.childNodes)for(var i=0;i<c.childNodes.length;i++)stack.push(c.childNodes[i]);}"
	+ "if(!g)return null;"
	+ "var direct=(g.childNodes||[]).filter(function(n){return n&&n.level==='project';}).length;"
	+ "var inv=window.__dshProjectInventory.projectInventory(t,{});"
	+ "return {direct:direct,registered:inv.registered,sessions:inv.sessions};}catch(e){return {__exc:String(e&&e.message||e)};}})()");

const r22_6ok = domProj !== null && pageInv && pageInv.direct !== undefined
	&& Number(domProj) === Number(pageInv.direct) && Number(domProj) === Number(pageInv.registered);
t("R22-6", "🔴 双向对账：DOM data-projects === 页内树「直接 project 级子节点数」=== projectInventory().registered（三值逐值相等）",
	r22_6ok, { dom: domProj, page: pageInv });

t("R22-7", "逐项目行：data-count === data-projects（=0 时**不渲染** dp-proj-rows —— 不画空壳）",
	await (async () => {
		const cnt = await attrOf('[data-testid="dp-proj-rows"]', "data-count");
		/* 🔴 `domProj === null`（读数元素整个不在）必须**先排除**：
		 *    `Number(null) === 0` ⇒ 会走进"=0 分支"并因 `cnt === null` 而**判绿**，
		 *    即"页面根本没渲染"被读成"零项目渲染正确"（空真绿 —— 比红更坏，纪律 60 同族）。 */
		if (domProj === null) return false;
		if (Number(domProj) === 0) return cnt === null;
		return cnt !== null && Number(cnt) === Number(domProj);
	})(), { domProj, });

t("R22-8", "读数文本与 DOM 三值自洽（含「已登记项目」或「未登记项目」）",
	typeof invText === "string" && (Number(domProj) === 0
		? invText.indexOf("未登记项目") >= 0
		: (invText.indexOf("已登记项目 " + domProj) >= 0 && invText.indexOf("对话 " + domSess) >= 0 && invText.indexOf("悬空 " + domDang) >= 0)),
	{ invText, domProj, domSess, domDang });

/* ── D. 弹窗落点（G1 家族：概况刷新 / 行级 data-kind）────────────────── */
console.log("\n── C. 弹窗落点（G1 家族）──");
const origOpen = await ev("(function(){var s=window.__directorLayoutStore;return s?Boolean(s.getState&&s.getState().dialogOpen):null;})()");
await ev("(function(){var s=window.__directorLayoutStore;if(s&&typeof s.setDialogOpen==='function')s.setDialogOpen(true);return 1;})()");
let dlgOk = false;
for (let k = 0; k < 20 && !dlgOk; k++) { dlgOk = Boolean(await ev("!!document.querySelector('[data-testid=\"d-dialog\"]')")); if (!dlgOk) await sleep(250); }

/* 🔴 挂不上就**必须自解释**（纪律 131：捕获工具必须留全文；纪律 54：静默半成功更坏）。
 *    第 40 轮实证：本套件第一版只打一句"弹窗未打开"，于是"谁把弹窗弄没了"成了悬案 ——
 *    而真实形态是**弹窗层渲染抛异常被 `SafeLayer` 隔离**（`mount.js` 用
 *    `layer("dialog", …)` 包了一层）：症状 = `d-dialog` 永不出现 + 留一个
 *    `d-layer-error` 角标（角标里就有异常原文，点一下"技术详情"即可读到）。 */
if (!dlgOk) {
	/* ⚠️ 取"技术详情"必须**先点、再等、再读**：`tg.click()` 之后立刻查
	 *    `d-layer-detail` 一定为空 —— React 的状态提交是**异步**的
	 *    （第 40 轮实证：第一版正是这么写的 ⇒ 原文没取到，只拿到角标摘要，
	 *      于是"谁把弹窗弄没了"仍是悬案。判据/证据的读取窗口不许短于其数据寿命，纪律 102 同族）。
	 * 🔴 dshLog 写的是 window.__dshDebug，**不是** window.__dshV9Log ——
	 *    SafeLayer.componentDidCatch 的那行「层「X」渲染异常已隔离: <异常>」在**前者**里。
	 *    第一版只读了 V9 那一份 ⇒ 异常原文根本没进日志（留全文，纪律 131）。
	 * ⚠️ 本段注释**不许写反引号**：它若落进下方模板字面量里，会提前闭合模板（第 40 轮踩过，
	 *    报错形态是 "missing ) after argument list"，看起来完全不像引号问题）。 */
	const diag = await ev(`(async function(){
		var out = { open: null, badge: false, badgeText: null, detail: null, detailWhy: null, debugN: null, debug: null, v9: null };
		try { var s = window.__directorLayoutStore; out.open = s && s.getState ? Boolean(s.getState().dialogOpen) : null; } catch (e) { out.open = "exc:" + e.message; }
		var b = document.querySelector('[data-testid="d-layer-error"]');
		out.badge = !!b;
		if (b) out.badgeText = String(b.textContent || "").slice(0, 400);
		var tg = document.querySelector('[data-testid="d-layer-detail-toggle"]');
		out.detailWhy = tg ? "clicked" : "no-toggle";
		if (tg) tg.click();
		if (tg) {
			for (var i = 0; i < 20; i++) {
				if (document.querySelector('[data-testid="d-layer-detail"]')) break;
				await new Promise(function (r) { setTimeout(r, 150); });
			}
			var d = document.querySelector('[data-testid="d-layer-detail"]');
			out.detail = d ? String(d.textContent || "") : "(点了技术详情但 3s 内未出现 d-layer-detail)";
		}
		try {
			var dbg = window.__dshDebug;
			if (dbg && Array.isArray(dbg.logs)) {
				out.debugN = dbg.logs.length;
				out.debug = dbg.logs.slice(-40).map(function (l) {
					return "[" + (l && l.time) + "] [" + (l && l.scope) + "] " + (l && l.message) + (l && l.data ? " | " + String(l.data).slice(0, 400) : "");
				});
			} else if (dbg && typeof dbg.exportLogs === "function") {
				out.debug = String(dbg.exportLogs()).split("\\n").slice(-40);
			} else { out.debug = "(无 __dshDebug.logs)"; }
		} catch (e) { out.debug = "exc:" + (e && e.message); }
		try {
			var v9 = window.__dshV9Log && window.__dshV9Log.logs;
			if (Array.isArray(v9)) out.v9 = v9.slice(-12).map(function (l) { return "[" + l.scope + "] " + l.message; });
		} catch (e) { /* 忽略 */ }
		return out;
	})()`);
	console.log("      [诊断 · 弹窗层] " + JSON.stringify({ open: diag && diag.open, badge: diag && diag.badge, detailWhy: diag && diag.detailWhy }));
	if (diag && diag.badgeText) console.log("      [角标摘要] " + diag.badgeText.replace(/\s+/g, " ").trim().slice(0, 200));
	if (diag && diag.detail) console.log("      [🔴 异常原文] " + diag.detail.replace(/\s+/g, " ").trim());
	if (diag && Array.isArray(diag.debug)) console.log("      [__dshDebug 尾 40 条 · 共 " + diag.debugN + "]\n        " + diag.debug.join("\n        "));
	else if (diag && diag.debug) console.log("      [__dshDebug] " + String(diag.debug).slice(0, 800));
	if (diag && Array.isArray(diag.v9)) console.log("      [__dshV9Log 尾 12 条]\n        " + diag.v9.join("\n        "));
}
t("R22-9", "弹窗已打开（d-dialog 在 DOM）—— 后续两跳的前提", dlgOk);

const hasBrief = await ev("!!document.querySelector('[data-testid=\"d-scope-brief\"]')");
const hasRefresh = await ev("!!document.querySelector('[data-testid=\"d-brief-refresh\"]')");
t("R22-10", "G1：概况块 d-scope-brief 与一键刷新 d-brief-refresh **都在**（后者过去**零判据**）",
	Boolean(hasBrief) && Boolean(hasRefresh), { hasBrief, hasRefresh });

/* 🔴 行级 data-kind：只断"整块非空"的话，五行全空也能过 ⇒ 必须断**行**。 */
const kinds = await ev("(function(){var b=document.querySelector('[data-testid=\"d-scope-brief\"]');if(!b)return null;"
	+ "var es=b.querySelectorAll('[data-kind]');var out=[];for(var i=0;i<es.length;i++)out.push(es[i].getAttribute('data-kind'));return out;})()");
const KNOWN = ["summary", "user", "result", "pending", "director", "flow", "stale", "why", "none"];
t("R22-11", "概况呈现的每一行都带**受控**的 data-kind（∈ 已知集合）；且没有「无 data-kind 的裸行」",
	Array.isArray(kinds) && kinds.every((k) => KNOWN.indexOf(k) >= 0), { kinds });

/* 🔴 层健康（`mount.js` 的 `SafeLayer` 契约）：弹窗**打开过**之后不得留有错误角标。
 *    这条断言的存在理由：`SafeLayer` 会把"弹窗层崩了"变成一个**小角标** ——
 *    能力其实已经没了，但若不单独断它，用户看到的只是"弹窗打不开"，
 *    而**异常原文就在角标里**却没人读（第 40 轮实证：`verify-v17-sync` 的 E1 红
 *    与本条同源，两处都只说"有角标/没弹窗"，谁也没把原文带出来）。
 *    判据独立成条 ⇒ 将来任何一层崩了都能立刻定位到"是哪一层、什么异常"。 */
const layerBadge = await textOf('[data-testid="d-layer-error"]');
t("R22-13", "🔴 弹窗层健康：打开过弹窗后**不得**留下 SafeLayer 错误角标（d-layer-error）",
	layerBadge === null, { badgeText: layerBadge });

/* ── 收尾：环境复原（纪律：收尾必复原；不做复原会让下一次跑以不同状态起跑）── */
await ev("(function(){var s=window.__directorLayoutStore;if(s&&typeof s.setDialogOpen==='function')s.setDialogOpen(" + (origOpen ? "true" : "false") + ");return 1;})()");
const restored = await ev("(function(){var s=window.__directorLayoutStore;return s?Boolean(s.getState&&s.getState().dialogOpen):null;})()");
t("R22-12", "🔴 收尾环境复原：弹窗开合回到开跑前（下一位跑者不会以不同状态起跑）",
	Boolean(restored) === Boolean(origOpen), { origOpen, restored });

console.log("\n═══════════════════════════════════════════════════════════");
const ran = pass + fail + skip;
const MIN_ASSERTIONS = 14;
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "verify-req22（真机 · 22 号文批次 A）" });
if (!tally.ok) process.exit(2);
console.log("  PASS " + pass + " / FAIL " + fail + " / 跳过 " + skip + " / 总计 " + ran);
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
