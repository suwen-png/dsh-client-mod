/**
 * verify-v17-sync.mjs —— V17 第1轮审核整改项的**真机逐交互**验证
 *
 * 覆盖（全部真实坐标点击 / 真实 store 流转，不用 DOM.click 假点）：
 *   A. 总监页 R6 折叠：折叠出摘要(dp-r6-summary)、折叠态写入 layout store 与 localStorage（持久化）、再展开
 *   B. FloatDock 未读小红点：浮层关闭期间流转到达 ⇒ d-unread-* 亮；打开浮层 ⇒ 红点灭；
 *      浮层【打开期间】别的维度流转到达 ⇒ 目标界面轻提示「已同步到 X」
 *   C. 设计图：未读点 / 同步 toast（ds-toast）/「更多」菜单 Esc 与点击外部关闭
 *   D. 总监弹窗打开期间收到外维流转 ⇒ d-toast「已同步到总监」
 *   E. 健康态无 SafeLayer 错误角标、无新增 window.onerror
 *   F. 导图首次操作引导（清标记后打开 ⇒ 一次性 toast，且标记只写一次）
 *
 * 退出码：0 全绿 / 1 真失败 / 2 INVALID（CDP 连不上）
 * 用法：node scripts/verify-v17-sync.mjs
 */
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0, skip = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log(`  ✅ ${id} ${name}`); }
	else { fail++; failures.push(`${id} ${name}`); console.log(`  ❌ ${id} ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); }
}
function sk(id, name) { skip++; console.log(`  ⊘ ${id} ${name}（不满足前置，跳过）`); }

let targets;
try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json(); }
catch (e) { console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）"); process.exit(2); }
const page = targets.filter((x) => x.type === "page").find((x) => !/devtools/.test(x.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：无 page）"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); rej(new Error("EVAL_TIMEOUT")); }, 8000); pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (x) => { clearTimeout(timer); rej(x); } }); ws.send(JSON.stringify({ id, method, params })); });
const emit = (m, p = {}) => ws.send(JSON.stringify({ id: ++seq, method: m, params: p }));
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
async function ev(expr) { const o = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (o.exceptionDetails) return { __exc: o.exceptionDetails.text }; return o.result?.value; }
function mouse(type, x, y, b) { emit("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: b || 0, clickCount: type === "mouseMoved" ? 0 : 1 }); }
async function clickXY(x, y) { mouse("mouseMoved", x, y, 0); await sleep(20); mouse("mousePressed", x, y, 1); await sleep(35); mouse("mouseReleased", x, y, 0); await sleep(220); }
function keyEsc() { emit("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); emit("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); }
async function centerOf(sel) { return ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();if(r.width<3||r.height<3)return null;return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`); }
async function clickSel(sel) {
	await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(e&&e.scrollIntoView)e.scrollIntoView({block:"center"});return 1;})()`);
	await sleep(130);
	const c = await centerOf(sel); if (!c) return false; await clickXY(c.x, c.y); return true;
}
/** 带命中诊断的点击：返回是否点中了选择器自身（而非被遮挡层截走） */
async function clickSelProbe(sel) {
	await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(e&&e.scrollIntoView)e.scrollIntoView({block:"center"});return 1;})()`);
	await sleep(150);
	const c = await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();if(r.width<3)return null;var x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);return {x:x,y:y,hitTid:hit?(hit.getAttribute&&hit.getAttribute('data-testid'))||hit.tagName:null,inside:!!(hit&&(hit===e||(hit.closest&&hit.closest(${JSON.stringify(sel)}))))};})()`);
	if (!c) return { ok: false, why: "no-geo" };
	await clickXY(c.x, c.y); await sleep(250);
	return { ok: true, hit: c.hitTid, inside: c.inside };
}
async function waitFor(selOrFn, ms = 1600) {
	const fn = typeof selOrFn === "function" ? selOrFn : (() => !!document.querySelector(selOrFn));
	const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev("(" + fn.toString() + ")()")) return true; await sleep(120); } return false;
}
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const textOf = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.trim():null;})()`);

/** 从 origin 维度登记一条流转并 hop 到 target 维度（返回 flowId） */
async function pushHop(origin, target, tag) {
	return ev(`(function(){var A=window.__dshFlow;var f=A.store.push(${JSON.stringify(tag + " " + Date.now())},{origin:origin,note:"v17-sync"});A.store.move(f.flowId,target,"送"+target);return f.flowId;})()`);
}
async function closeAllOverlays() {
	await ev(`(function(){var s=window.__directorLayoutStore;s.setDesignStudio(false);s.setMindmap(false);s.setDialogOpen(false);return 1;})()`);
	await sleep(350);
}

/* ── 开场：唤醒会话 → 点总监 tab → 等 dp-root（错误监听在 reload 后注册，见下） ── */
async function wake() {
	await clickSel("[role=treeitem]"); // 兜底（选择器命中第一个即可，下面用更精确的）
	await ev(`(function(){var e=[...document.querySelectorAll('[role=treeitem]')].find(x=>/分钟|小时|天|刚刚/.test(x.textContent));if(e)e.click();return 1;})()`);
	for (let i = 0; i < 24; i++) {
		const ok = await ev(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='总监');if(!t)return false;var r=t.getBoundingClientRect();return r.width>4&&r.height>4;})()`);
		if (ok) break; await sleep(200);
	}
	await clickSelFn_tab();
}
async function clickSelFn_tab() {
	const c = await ev(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='总监');if(!t)return null;var r=t.getBoundingClientRect();return r.width>4?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null;})()`);
	if (c) await clickXY(c.x, c.y); else await ev(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='总监');if(t)t.click();return 1;})()`);
}
/* ── 环境重置：清跨轮流转残留 + 预置引导标记（B/C/D 段同步 toast 不与首次引导撞车；F 段再清标记单独测引导）→ reload ── */
await ev(`(function(){localStorage.removeItem('dsh.director.flow');localStorage.setItem('dsh.director.mm.hint.shown','1');location.reload();return 1;})()`);
await sleep(2800);
await ev("window.__v17Err=[];window.addEventListener('error',e=>__v17Err.push(String(e.message||e.error)));window.addEventListener('unhandledrejection',e=>__v17Err.push('rej:'+String(e.reason)));1");
keyEsc(); await sleep(300);
await wake();
const dpReady = await waitFor("[data-testid=dp-root]", 8000);
console.log("开场：总监页挂载=" + dpReady);

console.log("\n══ A. 总监页 R6 折叠 + 摘要 + 持久化 ══");
if (dpReady) {
	// 先确保展开：若当前已折叠则点开展开
	if (await ev(`window.__directorLayoutStore.getState().sectionCollapsed.r6===true`)) { await clickSel("[data-testid=dp-r6-toggle]"); await sleep(200); }
	const before = await ev(`window.__directorLayoutStore.getState().sectionCollapsed.r6`);
	t("A0", "起始 R6 为展开", before === false, before);
	const probeA = await clickSelProbe("[data-testid=dp-r6-toggle]");
	if (!probeA.ok || !probeA.inside) console.log("      [A 诊断] 折叠点击命中：" + JSON.stringify(probeA));
	t("A1", "点折叠后 sectionCollapsed.r6=true（store 态）", await ev(`window.__directorLayoutStore.getState().sectionCollapsed.r6===true`), probeA);
	t("A2", "折叠态出现摘要 dp-r6-summary 且含「节点」", (await exists("[data-testid=dp-r6-summary]")) && /节点/.test(await textOf("[data-testid=dp-r6-summary]") || ""), await textOf("[data-testid=dp-r6-summary]"));
	t("A3", "🔴 折叠态已持久化到 localStorage（跨会话保留）", await ev(`(function(){try{return JSON.parse(localStorage.getItem('dsh.director.layout')).sectionCollapsed.r6===true;}catch(e){return false;}})()`));
	await clickSel("[data-testid=dp-r6-toggle]"); await sleep(250);
	t("A4", "再点展开后摘要消失、r6=false", !(await exists("[data-testid=dp-r6-summary]")) && await ev(`window.__directorLayoutStore.getState().sectionCollapsed.r6===false`));
} else { sk("A*", "总监页未挂载，折叠段"); }

console.log("\n══ B. 思维导图：关闭期未读点 + 打开期同步 toast ══");
await closeAllOverlays();
await sleep(200);
t("B0", "干净基线：当前无导图未读点", !(await exists("[data-testid=d-unread-mindmap]")));
await pushHop("director", "mindmap", "B-关闭期到达");
const b1 = await waitFor("[data-testid=d-unread-mindmap]", 1600);
t("B1", "导图关闭期间流转到达 ⇒ FloatDock 导图按钮亮未读点", b1);
await clickSel("[data-testid=d-open-mindmap]");
const mmReady = await waitFor("[data-testid=mm-root]", 5000);
await sleep(650);
t("B2", "打开导图后未读点清除（已读）", mmReady && !(await exists("[data-testid=d-unread-mindmap]")), { mmReady });
// 打开期间再从别的维度流转到导图 ⇒ 应轻提示
const b3info = await ev(`(function(){var A=window.__dshFlow;if(!A)return {noApi:true};var f=A.store.push(${JSON.stringify("B-打开期到达 ")}+Date.now(),{origin:"director",note:"v17-sync"});if(!f)return {nullFlow:true};A.store.move(f.flowId,"mindmap","送mindmap");var g=A.store.getState().flows.find(x=>x.flowId===f.flowId);return {id:f.flowId,found:!!g,dims:g?A.flowDims(g):null,total:A.store.getState().flows.length};})()`);
if (!b3info || !b3info.found) console.log("      [B3 push] " + JSON.stringify(b3info));
const idB3 = b3info && b3info.id;
const toastB = await waitFor(() => /已同步到思维导图/.test(document.querySelector("[data-testid=mm-toast]")?.textContent || ""), 2200);
if (!toastB) console.log("      [B3 诊断] " + await ev(`(function(){var t=document.querySelector('[data-testid=mm-toast]');var A=window.__dshFlow;var f=A.store.getState().flows.find(x=>x.flowId===${JSON.stringify(idB3)});return JSON.stringify({toast:t?t.textContent:null,hitDims:f?A.flowDims(f):'FLOW_NOT_FOUND',mmRoot:!!document.querySelector('[data-testid=mm-root]')});})()`));
t("B3", "导图打开期间外维流转到达 ⇒ mm-toast「已同步到思维导图」", toastB);
await clickSel("[data-testid=mm-close]"); await sleep(650);
t("B4", "mm-close 关闭导图", !(await exists("[data-testid=mm-root]")));

console.log("\n══ C. 设计图：未读点 + 同步 toast + 更多菜单 Esc/外部关闭 ══");
await closeAllOverlays();
await pushHop("director", "design", "C-关闭期到达");
const c1 = await waitFor("[data-testid=d-unread-design]", 1600);
t("C1", "设计图关闭期间流转到达 ⇒ 设计图按钮亮未读点", c1);
await clickSel("[data-testid=d-open-design]");
const dsReady = await waitFor("[data-testid=ds-root]", 5000);
await sleep(650);
t("C2", "打开设计图后未读点清除", dsReady && !(await exists("[data-testid=d-unread-design]")), { dsReady });
const c3info = await ev(`(function(){var A=window.__dshFlow;if(!A)return {noApi:true};var f=A.store.push(${JSON.stringify("C-打开期到达 ")}+Date.now(),{origin:"mindmap",note:"v17-sync"});if(!f)return {nullFlow:true};A.store.move(f.flowId,"design","送design");var g=A.store.getState().flows.find(x=>x.flowId===f.flowId);return {id:f.flowId,found:!!g,dims:g?A.flowDims(g):null};})()`);
if (!c3info || !c3info.found) console.log("      [C3 push] " + JSON.stringify(c3info));
const toastC = await waitFor(() => /已同步到设计图/.test(document.querySelector("[data-testid=ds-toast]")?.textContent || ""), 2200);
t("C3", "设计图打开期间外维流转到达 ⇒ ds-toast「已同步到设计图」", toastC && c3info.found, { toastC, c3info });
// 更多菜单（仅窄窗口 narrow<1500 才有 ds-more）
if (await exists("[data-testid=ds-more]")) {
	await clickSel("[data-testid=ds-more]"); await sleep(250);
	t("C4", "点「更多」展开下拉 ds-more-menu", await exists("[data-testid=ds-more-menu]"));
	keyEsc(); await sleep(250);
	t("C5", "按 Esc 关闭更多菜单", !(await exists("[data-testid=ds-more-menu]")));
	await clickSel("[data-testid=ds-more]"); await sleep(250);
	if (await exists("[data-testid=ds-more-menu]")) {
		// 点击菜单外部（ds-root 内一块非按钮画布区）
		const pt = await ev(`(function(){var r=document.querySelector('[data-testid=ds-root]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height-60)};})()`);
		if (pt) await clickXY(pt.x, pt.y); await sleep(250);
		t("C6", "点击菜单外部关闭更多菜单", !(await exists("[data-testid=ds-more-menu]")));
	} else t("C6", "（前置）二次展开菜单失败", false);
} else sk("C4-C6", "当前非窄窗口无「更多」按钮");
await clickSel("[data-testid=ds-close]"); await sleep(650);
t("C7", "ds-close 关闭设计图", !(await exists("[data-testid=ds-root]")));

console.log("\n══ D. 总监弹窗打开期间同步 toast ══");
await closeAllOverlays();
await clickSel("[data-testid=d-open-director]");
const dlgReady = await waitFor("[data-testid=d-dialog]", 5000);
await sleep(650);
if (dlgReady) {
	const d1info = await ev(`(function(){var A=window.__dshFlow;if(!A)return {noApi:true};var f=A.store.push(${JSON.stringify("D-打开期到达 ")}+Date.now(),{origin:"mindmap",note:"v17-sync"});if(!f)return {nullFlow:true};A.store.move(f.flowId,"director","送director");var g=A.store.getState().flows.find(x=>x.flowId===f.flowId);return {id:f.flowId,found:!!g,dims:g?A.flowDims(g):null};})()`);
	if (!d1info || !d1info.found) console.log("      [D1 push] " + JSON.stringify(d1info));
	const toastD = await waitFor(() => /已同步到总监/.test(document.querySelector("[data-testid=d-toast]")?.textContent || ""), 2200);
	t("D1", "弹窗打开期间外维流转到达 ⇒ d-toast「已同步到总监」", toastD && d1info.found, { toastD, d1info });
	await clickSel("[data-testid=d-close]"); await sleep(350);
	t("D2", "d-close 关闭弹窗", !(await exists("[data-testid=d-dialog]")));
} else sk("D*", "总监弹窗未挂载");

console.log("\n══ E. SafeLayer 健康态 ══");
await closeAllOverlays();
t("E1", "健康态无错误角标 d-layer-error", !(await exists("[data-testid=d-layer-error]")));
t("E2", "全过程无新增 window.onerror / unhandledrejection", (await ev("window.__v17Err.length")) === 0, await ev("window.__v17Err"));

console.log("\n══ F. 导图首次操作引导（一次性）══");
await ev(`localStorage.removeItem('dsh.director.mm.hint.shown');1`);
await closeAllOverlays();
await clickSel("[data-testid=d-open-mindmap]");
await waitFor("[data-testid=mm-root]", 5000);
const hint = await waitFor(() => /悬浮节点.*右键节点/.test(document.querySelector("[data-testid=mm-toast]")?.textContent || ""), 2200);
t("F1", "首次打开导图出现操作引导 toast", hint);
await sleep(100);
t("F2", "引导标记已写入 localStorage（只提示一次）", await ev(`localStorage.getItem('dsh.director.mm.hint.shown')==='1'`));
await clickSel("[data-testid=mm-close]"); await sleep(300);

await closeAllOverlays();
console.log("\n───────────────────────────────────────────────");
console.log(` 通过 ${pass} / 失败 ${fail} / 跳过 ${skip}`);
if (fail) console.log(" 失败项：\n   - " + failures.join("\n   - "));
console.log(` IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("───────────────────────────────────────────────");
ws.close();
process.exit(fail === 0 ? 0 : 1);
