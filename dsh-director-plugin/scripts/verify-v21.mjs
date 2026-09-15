/* verify-v21.mjs — 第 6 批 **6-B** 专属闸门（V20 需求 3）
 *
 * 覆盖：R4 条目「点开占用总监对话区 / 缩回恢复」+ 未完成项「补充说明」
 *       （`layout.todoNotes` 按作用域 + taskId 单条；执行链 O(1) 注入）
 *
 * 用法：node scripts/verify-v21.mjs
 * 退出码：0 = 全通过 / 1 = FAIL（产品缺陷）/ 2 = INVALID（环境不可判：CDP 不通、
 *         页面不在、跑程中 Harness 被重启 —— **不是**产品问题）
 *
 * 🔴 本文件从 `verify-v20.mjs` 继承了三处**必须保留**的工程纪律：
 *    ① `ev()` 绝不抛穿：CDP 求值超时 ⇒ 先重试，仍不成则探测"页面还在不在"，
 *       页面没了就明确 INVALID（报出已跑断言数），**不许**让裸 Node 栈把整轮断言吞掉。
 *    ② 被测面会**写盘**（补充说明落在 `dsh.director.layout`）⇒ 必须
 *       快照 → 还原 → 还原断言（纪律 15：闸门不许成为产品的破坏者）。
 *    ③ 开合/选中型状态必须**显式建立起点并断言**，收尾复原；
 *       否则第二次跑会以不同起点起跑（本项目"时红时绿"的头号成因）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src");
const PORT = Number(process.env.DSH_CDP_PORT || 9222);

/* ── 源码常量：**从源码读**，不写死（纪律 29）───────────────────────── */
const layoutSrc = fs.readFileSync(path.join(SRC, "store", "layout.js"), "utf8");
const num = (re) => { const m = layoutSrc.match(re); return m ? Number(m[1]) : null; };
const NOTE_MAX = num(/TODO_NOTE_MAX_CHARS\s*=\s*(\d+)/);
if (!Number.isFinite(NOTE_MAX)) {
	console.error("IS_PASS: FALSE（INVALID：源码里读不到 TODO_NOTE_MAX_CHARS —— 判据自己过期了，先对上源码）");
	console.error("  可复制命令：node scripts/verify-v21.mjs");
	process.exit(2);
}
console.log("开场：源码常量 TODO_NOTE_MAX_CHARS=" + NOTE_MAX);

let pass = 0, fail = 0, skip = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log(`  ✅ ${id} ${name}`); }
	else { fail++; failures.push(`${id} ${name}`); console.log(`  ❌ ${id} ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); }
}
function sk(id, name) { skip++; console.log(`  ⊘ ${id} ${name}（不满足前置，跳过）`); }
const _bail = (why) => (e) => {
	console.error("\nIS_PASS: FALSE（INVALID：" + why + "）");
	console.error("  已跑 " + (pass + fail + skip) + " 条（通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "）");
	console.error("  原因：" + String((e && e.stack) || e).split("\n").slice(0, 3).join(" ｜ "));
	console.error("  重跑：node scripts/verify-v21.mjs");
	process.exit(2);
};
process.on("uncaughtException", _bail("未捕获异常"));
process.on("unhandledRejection", _bail("未处理的 Promise 拒绝"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── CDP 连接（等就绪：本机存在并发工作线会反复重启 Harness）───────── */
let targets = null, lastErr = "";
const _t0 = Date.now();
for (let k = 1; k <= 25; k++) {
	try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list", { cache: "no-store" })).json(); break; }
	catch (e) {
		lastErr = String((e && e.message) || e);
		if (k % 5 === 0) console.log("  等待 CDP " + PORT + " 就绪…（已 " + Math.round((Date.now() - _t0) / 1000) + "s）");
		await sleep(3000);
	}
}
if (!targets) { console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "，已等 " + Math.round((Date.now() - _t0) / 1000) + "s；最后错误：" + lastErr + "）\n  可复制命令：node scripts/verify-v21.mjs"); process.exit(2); }
let page = targets.filter((x) => x.type === "page").find((x) => !/devtools/.test(x.url));
for (let k = 0; k < 12 && !page; k++) { await sleep(1200); try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json(); } catch (e) { /* 保持上次列表 */ } page = targets.filter((x) => x.type === "page").find((x) => !/devtools/.test(x.url)); }
if (!page) { console.error("IS_PASS: FALSE（INVALID：无 page）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq; const timer = setTimeout(() => { pending.delete(id); rej(new Error("EVAL_TIMEOUT")); }, 8000);
	pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (x) => { clearTimeout(timer); rej(x); } });
	ws.send(JSON.stringify({ id, method, params }));
});
const emit = (m, p = {}) => ws.send(JSON.stringify({ id: ++seq, method: m, params: p }));
await new Promise((r) => ws.addEventListener("open", r));
try { await send("Runtime.enable"); } catch (e) { console.log("      [CDP 诊断] Runtime.enable 未确认（不影响断言）"); }

async function pageAlive() {
	try {
		const l = await (await fetch("http://127.0.0.1:" + PORT + "/json/list", { cache: "no-store" })).json();
		return l.some((x) => x.type === "page" && !/devtools/.test(x.url));
	} catch (e) { return false; }
}
async function ev(expr) {
	for (let k = 0; k < 2; k++) {
		try {
			const o = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
			if (o && o.exceptionDetails) return { __exc: o.exceptionDetails.text };
			return o ? o.result?.value : null;
		} catch (e) {
			const msg = String((e && e.message) || e);
			if (k === 0) { await sleep(1500); continue; }
			if (!(await pageAlive())) {
				console.error("\nIS_PASS: FALSE（INVALID：跑程中 CDP 页面消失 —— Harness 被并发工作线重启）");
				console.error("  已跑 " + (pass + fail + skip) + " 条（通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "）");
				console.error("  重跑：node scripts/verify-v21.mjs");
				process.exit(2);
			}
			console.log("      [CDP 诊断] 一次求值失败（页面仍在）⇒ 按读数缺失处理：" + msg);
			return null;
		}
	}
}
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
function mouse(type, x, y, b) { emit("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: b || 0, clickCount: type === "mouseMoved" ? 0 : 1 }); }
async function clickXY(x, y) { mouse("mouseMoved", x, y, 0); await sleep(20); mouse("mousePressed", x, y, 1); await sleep(35); mouse("mouseReleased", x, y, 0); await sleep(240); }
async function waitFor(fnOrSel, ms) {
	const end = Date.now() + (ms || 3000);
	while (Date.now() < end) {
		const v = await ev(`(function(){
			var hit = document.querySelector(${JSON.stringify(fnOrSel)});
			return !!hit;})()`);
		if (v === true) return true;
		await sleep(180);
	}
	return false;
}
/** 带命中诊断的真实点击（**选择器字面量内联** —— 传函数进浏览器会 ReferenceError ⇒ 假绿） */
async function clickSelProbe(sel) {
	await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(e&&e.scrollIntoView)e.scrollIntoView({block:"center"});return 1;})()`);
	await sleep(140);
	const c = await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();if(r.width<3||r.height<3)return null;var x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),h=document.elementFromPoint(x,y);return {x:x,y:y,hit:(h&&h.getAttribute&&h.getAttribute('data-testid'))||(h?h.tagName:null),inside:!!(h&&(h===e||(h.closest&&h.closest(${JSON.stringify(sel)}))))};})()`);
	if (!c) return { ok: false, why: "no-geo" };
	await clickXY(c.x, c.y);
	return { ok: true, hit: c.hit, inside: c.inside, x: c.x, y: c.y };
}
/** 按**结果**重试的点击（输入派发偶发被吃掉；重试记录次数进读数，不掩盖真缺陷） */
async function clickUntil(sel, okFn, tries = 3, waitMs = 1200) {
	let r = null, k = 0;
	for (k = 1; k <= tries; k++) {
		r = await clickSelProbe(sel);
		if (await okFn()) return { ok: true, tries: k, hit: r };
		await sleep(320);
	}
	return { ok: false, tries: k, hit: r };
}

/* ── 页面存活守卫（本闸门有"点错了把页退掉"的历史，段首要问一次）──── */
async function ensurePage(tag) {
	for (let k = 1; k <= 3; k++) {
		if (await exists("[data-testid=dp-root]")) return true;
		const t2 = await ev(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='总监');if(t){t.click();return 1;}return 0;})()`);
		await sleep(700);
		if (t2 === 1) continue;
	}
	console.log("  ⚠ " + tag + " 段首：dp-root 不在 DOM（后续断言会各自报 no-root）");
	return false;
}

/* ── 起点：唤醒会话 → 点总监 tab → 等页面可用 ─────────────────────── */
await ev(`(function(){var e=[...document.querySelectorAll('[role=treeitem]')].find(x=>/分钟|小时|天|刚刚/.test(x.textContent));if(e)e.click();return 1;})()`);
let dpReady = false;
for (let k = 1; k <= 12 && !dpReady; k++) {
	/* 唤醒方式：直接派发页签点击（不经坐标）—— 起跑阶段页面还在排版，
	 * 坐标点击的命中不可靠，而这一段只是"把页签点出来"，不判产品。 */
	await ev(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='总监');if(t)t.click();return 1;})()`);
	await sleep(900);
	dpReady = await exists("[data-testid=dp-root]");
}
console.log("开场：总监页挂载=" + dpReady);
if (!dpReady) {
	console.error("IS_PASS: FALSE（INVALID：总监页未挂载，A–E 段全部无法判定）");
	console.error("  排查：node scripts/probe-render-errors.mjs");
	console.error("  重跑：node scripts/verify-v21.mjs");
	process.exit(2);
}

/* ── 覆盖层前提：他方浮层会吃掉点击（实测 dp-orch-panel / ds-root）──── */
async function closeOverlays() {
	await ev(`(function(){var s=window.__directorLayoutStore;if(!s)return "no-store";if(typeof s.closeFloatLayers==="function")return s.closeFloatLayers()?"closed-api":"clean-api";return "no-api";})()`);
	await sleep(320);
	if (await exists("[data-testid=dp-orch-panel]")) {
		await ev(`(function(){var b=document.querySelector('[data-testid=dp-orch-close]');if(b)b.click();return 1;})()`);
		await sleep(300);
	}
}
const ORCH_ORIG = await exists("[data-testid=dp-orch-panel]");
const hitOk = () => ev(`(function(){
	var root=document.querySelector('[data-testid=dp-root]'); if(!root) return {ok:false,why:"no-root"};
	var r=root.getBoundingClientRect();
	var x=Math.round(r.x+r.width*0.5), y=Math.round(r.y+r.height*0.5);
	var e=document.elementFromPoint(x,y);
	var inside=!!(e&&(e===root||(e.closest&&e.closest('[data-testid=dp-root]'))));
	return {ok:inside, studio:!!document.querySelector('[data-testid=ds-root]'),
		orch:!!document.querySelector('[data-testid=dp-orch-panel]'),
		hit:(e&&e.getAttribute&&e.getAttribute('data-testid'))||(e?e.tagName:null)};})()`);
await closeOverlays();
const hp = await hitOk();
t("V21-S0", "起点**覆盖层前提**：dp-root 中心的最上层元素落在 dp-root 内，且浮层根（`ds-root` / `dp-orch-panel`）都不在 DOM —— 否则下面的真点读数与「功能坏了」不同源",
	!!hp && hp.ok === true && hp.studio === false && hp.orch === false, hp);

/* ══ A. 快照：闸门要写盘（todoNotes / activeTasks），必须先取证 ─────── */
console.log("\n══ A. 写盘快照（纪律 15：闸门不许成为产品的破坏者）══");
const SNAP = await ev(`(function(){var s=window.__directorLayoutStore;var st=s.getState();
	return {todoNotes:JSON.parse(JSON.stringify(st.todoNotes||{})), activeTasks:JSON.parse(JSON.stringify(st.activeTasks||{})),
		scope:(typeof window.__dshDirectorPage!=="undefined")?null:null};})()`);
const ORIG_NOTES = (SNAP && SNAP.todoNotes) || {};
const ORIG_ACTIVE = (SNAP && SNAP.activeTasks) || {};
console.log("  原始 todoNotes 键数=" + Object.keys(ORIG_NOTES).length + " · activeTasks 键数=" + Object.keys(ORIG_ACTIVE).length);
t("V21-A1", "快照可读（拿不到快照就不许继续 —— 后面要写盘）", !!SNAP && typeof ORIG_NOTES === "object");

/* 起点：详情必须**不在**（缩回态） */
async function collapseDetail() {
	for (let k = 0; k < 3; k++) {
		if (!(await exists("[data-testid=dp-r4-detail]"))) return true;
		await clickSelProbe("[data-testid=dp-r4-detail-back]");
		await sleep(300);
	}
	return !(await exists("[data-testid=dp-r4-detail]"));
}
await collapseDetail();
t("V21-S1", "起点**显式建立并断言**：R5 处于常规态（`dp-r4-detail` 不在 DOM 且 `dp-r5-body` 在）",
	(await exists("[data-testid=dp-r4-detail]")) === false && (await exists("[data-testid=dp-r5-body]")) === true);

/* ══ B. 点条目 ⇒ 占用 R5 ══════════════════════════════════════════════ */
console.log("\n══ B. 点 R4 条目 ⇒ 详情占用总监对话区（不新开列）══");
/* 🔴 **R4 必须先展开** —— 缩回态下栏里只有标题，`dp-r4-item` **不在 DOM**
 *    （首跑 11 条全跳过就是这么来的：不是清单空，是栏没开）。
 *    这里显式建立起点并断言；收尾由 F 段恢复。
 *    展开走产品的正常路径：鼠标停到缩回栏上（悬停闸门 `RAIL_HOVER_MS` 后自动展开）。
 *    栏靠 `railLeave` 自动缩回 ⇒ 每段开头都重新确认一次，别赌"上一段没让它合上"。 */
async function ensureR4Panel() {
	for (let k = 1; k <= 4; k++) {
		if (await exists("[data-testid=dp-r4-item]")) return true;
		const g = await ev(`(function(){var e=document.querySelector('[data-testid=dp-rail-r4]');if(!e)return null;
			var r=e.getBoundingClientRect();if(r.width<3||r.height<3)return null;
			return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+26),
				hit:(function(){var h=document.elementFromPoint(Math.round(r.x+r.width/2),Math.round(r.y+26));
					return h?((h.getAttribute&&h.getAttribute('data-testid'))||h.tagName):null;})()};})()`);
		if (g) { mouse("mouseMoved", g.x, g.y, 0); await sleep(1100); }
		else {
			/* 取不到缩回栏几何 ⇒ 直接走 store 的钉住开关（面板头 `railTogglePin`） */
			await ev(`(function(){var b=document.querySelector('[data-testid=dp-r4-toggle]');if(b)b.click();return 1;})()`);
			await sleep(600);
		}
		if (await exists("[data-testid=dp-r4-item]")) return true;
	}
	return await exists("[data-testid=dp-r4-item]");
}
const r4open = await ensureR4Panel();
t("V21-S2", "起点：R4 已展开（`dp-r4-item` 在 DOM）—— 缩回态下条目不在 DOM，不展开就会把「栏没开」误读成「清单为空」（首跑 11 条假跳过就是这么来的）",
	r4open === true, { r4open });
if (!r4open) {
	console.error("IS_PASS: FALSE（INVALID：R4 展不开 ⇒ B–E 段的前提不成立，无法判定；这不是「清单为空」）");
	console.error("  可复制命令：node scripts/verify-v21.mjs");
	process.exit(2);
}
const firstId = await ev(`(function(){var e=document.querySelector('[data-testid=dp-r4-item]');return e?e.getAttribute('data-id'):null;})()`);
if (!firstId) {
	sk("V21-B1", "R4 已展开但取不到条目（03 清单为空或索引不可用 —— 原因见 `dp-r4-degraded`）");
	sk("V21-B2", "同上"); sk("V21-B3", "同上"); sk("V21-B4", "同上");
} else {
	const clk = await clickUntil("[data-testid=dp-r4-item]", () => exists("[data-testid=dp-r4-detail]"));
	t("V21-B1", "点一条未完成项 ⇒ `dp-r4-detail` 出现（前提：点击命中自己，命中读数见 detail）", clk.ok === true, clk);

	const shape = await ev(`(function(){
		var d=document.querySelector('[data-testid=dp-r4-detail]');
		return {detail:!!d, kind:d?d.getAttribute('data-kind'):null, id:d?d.getAttribute('data-id'):null,
			sel:(document.querySelector('[data-testid=dp-r4-item][data-selected="1"]')||{}).getAttribute
				? document.querySelector('[data-testid=dp-r4-item][data-selected="1"]').getAttribute('data-id') : null,
			r5body:!!document.querySelector('[data-testid=dp-r5-body]'),
			now:!!document.querySelector('[data-testid=dp-now]'),
			producedR5:!!document.querySelector('[data-testid=dp-r5]'),
			cols:document.querySelectorAll('[data-testid=dp-cols] > *').length};})()`);
	t("V21-B2", "🔴 详情**占用** R5：`dp-r5-body` 与 `dp-now` 都退场，而 `dp-r5` 这一列**仍在**", 
		!!shape && shape.detail === true && shape.r5body === false && shape.now === false && shape.producedR5 === true, shape);
	t("V21-B3", "🔴 **不新开列**：`dp-cols` 的直接子元素个数与第 6 批验收时一致（R4/R5/R7 三栏）",
		!!shape && shape.cols === 3, shape && { cols: shape.cols });
	t("V21-B4", "详情卡指向的正是被点的那一条（`data-id` 与条目 `data-selected=1` **同源**）",
		!!shape && !!firstId && shape.id === firstId && shape.sel === firstId, { detail: shape && shape.id, selected: shape && shape.sel, first: firstId });
}

/* ══ C. 缩回：再点同一条 + 显式出口 ══════════════════════════════════ */
console.log("\n══ C. 缩回：再点同一条 / 点「← 缩回」—— R5 恢复常规内容 ══");
await ensureR4Panel();
if (!firstId) {
	sk("V21-C1", "B 段未建立详情 ⇒ 缩回前提不成立"); sk("V21-C2", "同上");
} else {
	const again = await clickUntil("[data-testid=dp-r4-item][data-selected='1']", () => ev(`!document.querySelector('[data-testid=dp-r4-detail]')`), 3, 900);
	const back = await ev(`(function(){return {detail:!!document.querySelector('[data-testid=dp-r4-detail]'),r5body:!!document.querySelector('[data-testid=dp-r5-body]'),now:!!document.querySelector('[data-testid=dp-now]')};})()`);
	t("V21-C1", "🔴 再点同一条 = 缩回（同一个开关；用户原话「缩回去的时候再显示总监对话区」）",
		again.ok === true && !!back && back.detail === false && back.r5body === true, { click: again, after: back });

	/* 显式出口 */
	await clickUntil("[data-testid=dp-r4-item]", () => exists("[data-testid=dp-r4-detail]"));
	const backBtn = await clickUntil("[data-testid=dp-r4-detail-back]", () => ev(`!document.querySelector('[data-testid=dp-r4-detail]')`), 3, 900);
	t("V21-C2", "「← 缩回」按钮同样能收回（显式出口：可发现性 + 键盘可达）",
		backBtn.ok === true && (await exists("[data-testid=dp-r4-detail]")) === false, backBtn);
}

/* ══ D. 未完成项：补充说明（写 → 读 → 截断 → 作用域隔离）══════════════ */
console.log("\n══ D. 未完成项「+ 补充说明」（按作用域 + taskId 单条）══");
await ensureR4Panel();
const scopeKey = await ev(`(function(){var r=document.querySelector('[data-testid=dp-root]');return r?r.getAttribute('data-scope'):null;})()`);
const NOTE_TEXT = "v21-闸门写入-" + Date.now();
if (!firstId || !scopeKey) {
	sk("V21-D1", "取不到 scopeKey 或条目 id");
	sk("V21-D2", "同上"); sk("V21-D3", "同上"); sk("V21-D4", "同上"); sk("V21-D5", "同上");
} else {
	await clickUntil("[data-testid=dp-r4-item]", () => exists("[data-testid=dp-r4-detail]"));
	const ui = await ev(`(function(){var d=document.querySelector('[data-testid=dp-r4-detail]');
		return {kind:d?d.getAttribute('data-kind'):null, input:!!document.querySelector('[data-testid=dp-r4-note-input]'),
			active:!!document.querySelector('[data-testid=dp-r4-set-active]'), locked:!!document.querySelector('[data-testid=dp-r4-note-locked]')};})()`);
	t("V21-D1", "未完成项详情里有补充说明输入框 + 「设为当前任务」（已完成项则显示只读说明）",
		!!ui && ((ui.kind === "roadmap" && ui.input === true && ui.active === true && ui.locked === false)
			|| (ui.kind === "done" && ui.input === false && ui.locked === true)), ui);

	/* 写入（走 store 的公开方法 = 与 UI 保存按钮**同一个落点**；UI 层保存见 D3） */
	const wrote = await ev(`(function(){var s=window.__directorLayoutStore;
		var r=s.setTodoNote(${JSON.stringify(scopeKey)},${JSON.stringify(firstId)},${JSON.stringify(NOTE_TEXT)});
		var g=s.getTodoNote(${JSON.stringify(scopeKey)},${JSON.stringify(firstId)});
		return {res:r, read:g, listLen:s.listTodoNotes(${JSON.stringify(scopeKey)}).length};})()`);
	t("V21-D2", "写入一条补充说明 ⇒ **同键读得回**（读写同源；`todoNoteKey` 是唯一真相源）",
		!!wrote && wrote.res && wrote.res.ok === true && !!wrote.read && wrote.read.note === NOTE_TEXT, wrote);

	/* 作用域隔离：换一个作用域，同一条 taskId **读不到**（防"A 作用域写进 B 作用域"） */
	const other = await ev(`(function(){var s=window.__directorLayoutStore;
		return {other:s.getTodoNote(${JSON.stringify(scopeKey + "-__v21_other__")},${JSON.stringify(firstId)}),
			emptyKey:s.getTodoNote("",${JSON.stringify(firstId)})};})()`);
	t("V21-D3", "🔴 **作用域隔离**：别的作用域 + 空作用域都读不到这一条（补说明是**按作用域**存的，不串）",
		!!other && other.other === null && other.emptyKey === null, other);

	/* 超长截断：写 3 倍上限 ⇒ 存下来必须恰好等于上限，且**明确告知**已截断 */
	const big = "x".repeat(NOTE_MAX * 3);
	const trunc = await ev(`(function(){var s=window.__directorLayoutStore;
		var r=s.setTodoNote(${JSON.stringify(scopeKey)},${JSON.stringify(firstId + "__v21_long__")},${JSON.stringify(big)});
		return {truncated:r&&r.truncated, len:r&&r.note?r.note.length:null};})()`);
	t("V21-D4", "超长补充说明被截断到源码上限 " + NOTE_MAX + " 字，且返回值**明说** `truncated`（不静默丢字）",
		!!trunc && trunc.truncated === true && trunc.len === NOTE_MAX, trunc);

	/* UI 层：保存按钮真的把输入框内容落库（不是只改了本地 state） */
	const uiSave = await ev(`(function(){
		var ta=document.querySelector('[data-testid=dp-r4-note-input]'); if(!ta) return {why:"no-input"};
		var setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
		setter.call(ta, ${JSON.stringify(NOTE_TEXT + "-ui")});
		ta.dispatchEvent(new Event('input',{bubbles:true}));
		return {typed:true};})()`);
	await sleep(240);
	const saveBtn = await clickUntil("[data-testid=dp-r4-note-save]", () => ev(`(function(){
		var s=window.__directorLayoutStore;var g=s.getTodoNote(${JSON.stringify(scopeKey)},${JSON.stringify(firstId)});
		return !!(g&&g.note===${JSON.stringify(NOTE_TEXT + "-ui")});})()`), 3, 900);
	const persisted = await ev(`(function(){var s=window.__directorLayoutStore;var g=s.getTodoNote(${JSON.stringify(scopeKey)},${JSON.stringify(firstId)});return g?g.note:null;})()`);
	t("V21-D5", "🔴 UI 的「保存」真的落库（读回 store 而不是只看画面 —— 只改本地 state 的假保存会在这里现形）",
		saveBtn.ok === true && persisted === NOTE_TEXT + "-ui", { typed: uiSave, click: saveBtn, persisted: persisted });
}

/* ══ E. 执行链 O(1) 注入 ════════════════════════════════════════════════ */
console.log("\n══ E. 执行链：只注入「当前任务」那一条（上下文增量 O(1)）══");
if (!firstId || !scopeKey) {
	/* 🔴 前提不成立时**跳过而不是断言失败** —— 拿 "noscope"/"noid" 当输入去断言，
	 *    量的是"假 key 读不到"，与产品无关，属**平凡真/平凡假**（纪律 29）。 */
	sk("V21-E1", "拿不到 scopeKey 或条目 id ⇒ 无法在真作用域上验注入");
	sk("V21-E2", "同上");
} else {
	const inj = await ev(`(function(){var s=window.__directorLayoutStore;var st=s.getState();
	var before=s.getActiveTaskNote(${JSON.stringify(scopeKey)});
	s.setActiveTask(${JSON.stringify(scopeKey)},${JSON.stringify(firstId)});
	var after=s.getActiveTaskNote(${JSON.stringify(scopeKey)});
	return {before:before, after:after, activeKeys:Object.keys(st.activeTasks||{}).length};})()`);
	t("V21-E1", "`getActiveTaskNote()` 是执行链的唯一取数口：设了当前任务 ⇒ 只返回**那一条**（含 `taskId` 与是否真有说明）",
		!!inj && !!inj.after && inj.after.taskId === firstId && typeof inj.after.note === "string", inj);

	const noNote = await ev(`(function(){var s=window.__directorLayoutStore;
		var sc=${JSON.stringify(scopeKey)}+"-__v21_empty__";
		s.setActiveTask(sc,${JSON.stringify(firstId)});
		var r=s.getActiveTaskNote(sc);
		s.setActiveTask(sc,"");
		return r;})()`);
	t("V21-E2", "🔴 设了当前任务但**没写说明** ⇒ `hasNote:false` 且 `note` 为空串（**不编占位**，纪律 19）",
		!!noNote && noNote.taskId === firstId && noNote.hasNote === false && noNote.note === "", noNote);
}

const srcRunTxt = fs.readFileSync(path.join(SRC, "logic", "director-run.js"), "utf8");
const srcPageTxt = fs.readFileSync(path.join(SRC, "components", "DirectorPage.js"), "utf8");
/* 🔴 判据不许写死**标识符名**（2026-09-14 被咬过一次）：
 *   原先这里是 `getActiveTaskNote\(flowSession\)` —— 一个字面量正则。
 *   本轮把宿主注入条四个 handler 从"闭包快照"改成"ref 现读"（修「登记/执行落错桶」的根因）后，
 *   `deliver()` 里的局部变量名由 `flowSession` 变成 `scope`（值语义完全一致）
 *   ⇒ 断言转红而**行为完全正确**，属典型「闸门写死源码文本」过期（纪律 14）。
 *   ⇒ 改为**语义判据**：`getActiveTaskNote(X)` 的 X 必须**就是**喂给
 *     `runDirector({ sessionId: X })` 的那个 X —— 这才是这条断言真正要守的东西
 *     （"任务说明与执行落在同一个作用域"，而不是"某个变量恰好叫这个名字"）。 */
const mNote = /taskNote:\s*directorLayoutStore\.getActiveTaskNote\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(srcPageTxt);
const mSess = /sessionId:\s*([A-Za-z_$][\w$]*)\s*,\s*userText/.exec(srcPageTxt);
const sameScope = Boolean(mNote) && Boolean(mSess) && mNote[1] === mSess[1];
const srcOk = /const noteBlock = noteText/.test(srcRunTxt) && sameScope;
t("V21-E3", "执行链与 UI **真的接上了**（源码里：`director-run` 有注入块、`DirectorPage.deliver` 传 `taskNote`，且 taskNote 的作用域**与 sessionId 同源**）—— 防「模块建好但没人调」的悬空层",
	srcOk === true,
	"注入块=" + /const noteBlock = noteText/.test(srcRunTxt) + " ｜ taskNote 实参=" + (mNote ? mNote[1] : "无")
	+ " ｜ runDirector.sessionId=" + (mSess ? mSess[1] : "无") + " ｜ 同源=" + sameScope);

/* ══ F. 收尾复原（写盘必须还；否则闸门成了产品的破坏者）══════════════ */
console.log("\n══ F. 收尾复原 ══");
const restored = await ev(`(function(){var s=window.__directorLayoutStore;
	var origNotes=${JSON.stringify(ORIG_NOTES)}, origActive=${JSON.stringify(ORIG_ACTIVE)};
	var st=s.getState();
	/* ① 清掉快照里没有的说明（那必然是本次写进去的），② 写回快照里的值 */
	Object.keys(st.todoNotes||{}).forEach(function(k){ if(!(k in origNotes)) s.clearTodoNote(k.split("::")[0],k.slice(k.indexOf("::")+2)); });
	Object.keys(origNotes).forEach(function(k){
		var scope=k.split("::")[0];
	/* 键形如 <scope>::<id>，且 scope 自身可能含 "::" ⇒ 按**最后一个**分隔点切 */
		var i=k.lastIndexOf("::"); scope=k.slice(0,i);
		s.setTodoNote(scope,k.slice(i+2),origNotes[k].note);
	});
	/* activeTasks：整体恢复成快照 */
	Object.keys(st.activeTasks||{}).forEach(function(sc){ s.setActiveTask(sc,""); });
	Object.keys(origActive).forEach(function(sc){ s.setActiveTask(sc,origActive[sc]); });
	return {notes:Object.keys(s.getState().todoNotes||{}).length, active:Object.keys(s.getState().activeTasks||{}).length};})()`);
await sleep(260);
await collapseDetail();
const afterF = await ev(`(function(){var s=window.__directorLayoutStore;var st=s.getState();
	return {notes:Object.keys(st.todoNotes||{}), active:Object.keys(st.activeTasks||{}),
		detail:!!document.querySelector('[data-testid=dp-r4-detail]')};})()`);
const notesEqual = JSON.stringify((afterF && afterF.notes || []).slice().sort()) === JSON.stringify(Object.keys(ORIG_NOTES).slice().sort());
const activeEqual = JSON.stringify((afterF && afterF.active || []).slice().sort()) === JSON.stringify(Object.keys(ORIG_ACTIVE).slice().sort());
t("V21-F1", "🔴 收尾①：`todoNotes` 键集合已还原为**用户原始设置**（快照 → 还原 → 还原断言）",
	notesEqual === true, { after: afterF && afterF.notes, orig: Object.keys(ORIG_NOTES) });
t("V21-F2", "🔴 收尾②：`activeTasks` 已还原为**用户原始设置**（不把「当前任务」留给下一轮）",
	activeEqual === true, { after: afterF && afterF.active, orig: Object.keys(ORIG_ACTIVE) });
t("V21-F3", "🔴 收尾③：详情已缩回（不把展开态留给下一套闸门）", !!(afterF && afterF.detail === false));

/* 他方浮层按其起始状态放回 */
if (ORCH_ORIG) {
	await ev(`(function(){var b=document.querySelector('[data-testid=dp-orchestrate]');if(b){b.click();return 1;}return 0;})()`);
	await sleep(320);
}
t("V21-F4", "🔴 收尾④：他方浮层 OrchestratorPanel 已按其**起始状态**放回（关过就必须还）",
	(await exists("[data-testid=dp-orch-panel]")) === ORCH_ORIG, { orig: ORCH_ORIG });

/* ── 汇总 ── */
const total = pass + fail + skip;
console.log("\n───────────────────────────────────────────────");
console.log(" 通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "（共 " + total + "）");
if (failures.length) { console.log(" 失败项："); failures.forEach((f) => console.log("   - " + f)); }
const unresolved = fail > 0;
console.log(" IS_PASS: " + (unresolved ? "FALSE" : "TRUE"));
console.log("───────────────────────────────────────────────");
fs.writeFileSync(path.join(HERE, "..", ".wb-v21-last.json"), JSON.stringify({ pass, fail, skip, failures, at: Date.now() }, null, 2));
process.exit(unresolved ? 1 : 0);
