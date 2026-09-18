/**
 * verify-v20.mjs —— 第 6 批界面调整（V20 方案）真机逐交互验证 · **A 组：R4 / R7 交互打磨**
 *
 * 覆盖（全部真实坐标事件：真实 hover / 真实按下-移动-抬起拖动，不用 DOM.click 假点）：
 *   A. 悬停闸门时长（用户原话「r4和r7的鼠标移动不好用」）
 *   B. R4 / R7 展开宽度：默认值 · store/DOM 同源 · 拖动对账 · 上下限 clamp · 双击复位 · R7 反向语义
 *   C. R4 / R5 / R7 无缝拼接（`columnGap = 0` 且相邻栏边界相接）
 *   D. R4 条目「两行 + 编号靠右」（用户样张 `T-INIT-0032026-08-24` 靠右）
 *   E. R7 关键文件「三行：描述 / 名称 / 路径」+ 点击名称/路径的**降级**可观测
 *   F. 收尾复原（宽度 / 钉住态归位 + 回读自证）
 *
 * ── 为什么单独开一个闸门而不是塞进 `verify-v17-sync` ──────────────────────────
 *   `verify-v17-sync` 的 A 段锁的是 V18 板块 E「缩回栏三态」（V17 整改项），
 *   本轮改的是**宽度可拖**与**缝宽**，属 V20 新增能力。混在一起会让"哪一版的判据过期"
 *   再也分不清（纪律：同一个锚点只留一处真相源）。
 *
 * ── 判据纪律（本文件逐条遵守）──────────────────────────────────────────────
 *   ① **上下限/默认值从源码读**（`src/store/layout.js`），不写死 ⇒ 产品改了闸门自动跟随；
 *      读不到 ⇒ **INVALID exit 2** + 可复制命令（不是 FAIL）。
 *   ② 拖动是**跑程内对账**：拖前读 → 拖 → 拖后读，**三个面**同时比
 *      （`store.railWidth` / `dp-cols[data-w-*]` / `getBoundingClientRect().width`）——
 *      "看起来相等 ≠ 同源"，只读一个面就可能把"改了 but 没渲染"读成通过。
 *   ③ 几何类断言**先证前提**（元素存在、宽度下限），再断结果 —— 防平凡真。
 *   ④ 收尾**必须还原**并回读自证（纪律 15/26：闸门不许成为产品的破坏者）。
 *
 * 退出码：0 全绿 / 1 真失败 / 2 INVALID（CDP 连不上 · 源码常量读不到 · 页面未挂载）
 * 用法：node scripts/verify-v20.mjs
 */
import fs from "node:fs";
import { ensurePageFocus } from "./_cdp-focus.mjs";
/* 🔴 `T-PLUG-067`：起点自举**只允许一个实现**（`_cdp-startup.mjs#ensureDirectorPage`）——
 *    本套件原先只有"点总监 tab 等 dp-root"的有限重试（**只判不建**），
 *    全批时因"前序套件没建起点"而必然 INVALID。 */
import { makeClicker } from "./_cdp-click-until.mjs";
import { ensureDirectorPage } from "./_cdp-startup.mjs";

/* ── ① 源码常量（不写死）───────────────────────────────────────────────────── */
const SRC_URL = new URL("../src/store/layout.js", import.meta.url);
let SRC_TEXT = "";
try { SRC_TEXT = fs.readFileSync(SRC_URL, "utf8"); } catch (e) { /* 下面统一判 INVALID */ }
const num = (re) => { const m = SRC_TEXT.match(re); return m ? Number(m[1]) : NaN; };
const RAIL_MIN = num(/RAIL_WIDTH_MIN\s*=\s*(\d+)/);
const RAIL_MAX = num(/RAIL_WIDTH_MAX\s*=\s*(\d+)/);
const DEF_M4 = num(/RAIL_WIDTH_DEFAULT\s*=\s*Object\.freeze\(\{\s*r4:\s*(\d+)/);
const DEF_M7 = num(/RAIL_WIDTH_DEFAULT\s*=\s*Object\.freeze\(\{\s*r4:\s*\d+,\s*r7:\s*(\d+)/);
if (![RAIL_MIN, RAIL_MAX, DEF_M4, DEF_M7].every((n) => Number.isFinite(n) && n > 0)) {
	console.error("IS_PASS: FALSE（INVALID：读不到 src/store/layout.js 的 RAIL_WIDTH_* 常量）");
	console.error("  期望形如：export const RAIL_WIDTH_MIN = 140; / RAIL_WIDTH_MAX = 420;");
	console.error("  RAIL_WIDTH_DEFAULT = Object.freeze({ r4: 200, r7: 210 });");
	console.error("  可复制命令：node scripts/verify-v20.mjs");
	process.exit(2);
}
console.log("开场：源码常量 RAIL MIN=" + RAIL_MIN + " MAX=" + RAIL_MAX + " 默认 r4=" + DEF_M4 + " r7=" + DEF_M7);

/* ── ② CDP 骨架（与 verify-v17-sync 同套路）──────────────────────────────── */
import { PORT } from "./cdp-port.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0, skip = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log(`  ✅ ${id} ${name}`); }
	else { fail++; failures.push(`${id} ${name}`); console.log(`  ❌ ${id} ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); }
}
function sk(id, name) { skip++; console.log(`  ⊘ ${id} ${name}（不满足前置，跳过）`); }

/* 🔴 最后一道防线：任何未捕获异常/拒绝都**不许**以裸 Node 栈的形态结束。
 *    裸栈读起来像"闸门坏了"，且**丢掉已跑断言数** —— 无法判断是环境还是产品。
 *    ⇒ 统一转成 INVALID（exit 2）+ 已跑计数，并把原因打出来。 */
const _bail = (why) => (e) => {
	console.error("\nIS_PASS: FALSE（INVALID：" + why + "）");
	console.error("  已跑 " + (pass + fail + skip) + " 条（通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "）");
	console.error("  原因：" + String((e && e.stack) || e).split("\n").slice(0, 3).join(" ｜ "));
	console.error("  重跑：node scripts/verify-v20.mjs");
	process.exit(2);
};
process.on("uncaughtException", _bail("未捕获异常"));
process.on("unhandledRejection", _bail("未处理的 Promise 拒绝"));

/* 🔴 **等待 CDP 就绪**（环境等待，不是放宽判据）。
 *    本机存在**并发工作线**，会反复 kill / 重启 Harness。闸门若"一次连不上即 INVALID"，
 *    就会把「重启窗口」误报成「闸门失败」—— 实测三次连跑全部落在该窗口内、三次全空。
 *    产品缺陷不会因为多等几秒而消失，但"起跑太快"会凭空造出一次 INVALID。
 *    ⇒ 最多等 ~75s，每 5 轮告知一次进度与最后错误；仍不成才 INVALID。 */
let targets = null, lastErr = "";
const _t0 = Date.now();
for (let k = 1; k <= 25; k++) {
	try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json(); break; }
	catch (e) {
		lastErr = String((e && e.message) || e);
		if (k % 5 === 0) console.log("  等待 CDP " + PORT + " 就绪…（已 " + Math.round((Date.now() - _t0) / 1000) + "s，最后错误：" + lastErr + "）");
		await sleep(3000);
	}
}
if (!targets) { console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "，已等 " + Math.round((Date.now() - _t0) / 1000) + "s；最后错误：" + lastErr + "）\n  可复制命令：node scripts/verify-v20.mjs"); process.exit(2); }
/* page 目标同样要等：实例刚起来时 `/json/list` 可能只列到 browser/worker，page 还没出现 */
let page = null;
for (let k = 1; k <= 15 && !page; k++) {
	page = (targets || []).filter((x) => x.type === "page").find((x) => !/devtools/.test(x.url));
	if (!page) { await sleep(1200); try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json(); } catch (e) { /* 保持上一次列表 */ } }
}
if (!page) { console.error("IS_PASS: FALSE（INVALID：无 page）"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); rej(new Error("EVAL_TIMEOUT")); }, 8000); pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (x) => { clearTimeout(timer); rej(x); } }); ws.send(JSON.stringify({ id, method, params })); });
const emit = (m, p = {}) => ws.send(JSON.stringify({ id: ++seq, method: m, params: p }));
await new Promise((r) => ws.addEventListener("open", r));
try { await send("Runtime.enable"); } catch (e) { console.log("      [CDP 诊断] Runtime.enable 未确认（不影响断言）：" + String((e && e.message) || e)); }

/* 🔴 `ev` **绝不抛穿**（纪律 B「CDP 派发一律记账、绝不抛穿」）。
 *    实测 2026-09-14：并发工作线在跑程中途 kill 了 Harness ⇒ `Runtime.evaluate` 超时
 *    ⇒ 未捕获的 `EVAL_TIMEOUT` 直接把脚本**崩掉**，D 段之后 20+ 条断言**静默丢失**
 *    （日志里只剩一段 Node 栈，读起来像"闸门坏了"而不是"断言没跑"）。
 *    比"红"更坏的是"没跑且没人知道"。
 *    ⇒ ① 超时先重试一次；② 仍不成则探测**页面是否还在**：
 *         · 页面已消失（Harness 被重启）⇒ 明确 INVALID（exit 2）并报出已跑断言数；
 *         · 页面还在（只是这一帧慢）⇒ 返回 `null`，让断言以"读数缺失"的形态**如实报红**。 */
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
				console.error("  已跑 " + (pass + fail + skip) + " 条（通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "），最后错误：" + msg);
				console.error("  重跑：node scripts/verify-v20.mjs");
				process.exit(2);
			}
			console.log("      [CDP 诊断] 一次求值失败（页面仍在）⇒ 该断言按读数缺失处理：" + msg);
			return null;
		}
	}
}

/* ── ②-1 页面**焦点前提**（治「鼠标时红时绿」的真因）────────────────────────
 * 🔴 实测：`--disable-features=CalculateNativeWinOcclusion` 已生效（WMI 读到进程命令行），
 *    红仍然复现。真因不是遮挡**降速**，而是**页面未 focused**：
 *    CDP 在未聚焦页面上会把 `mousePressed/Released` 当成"激活窗口"的那一下吞掉
 *    ⇒ 一次运行内所有**真拖/真点**一起失效，而纯 `mouseMoved`（V-A3）恒绿。
 *    读数形态就是「拖动没反应」，极易误判成产品缺陷。
 * ⇒ 显式建立前景 + 开焦点仿真（`_cdp-focus.mjs`，唯一真相源），并**断言** hasFocus。 */
const focusInfo = await ensurePageFocus({ send, ev, log: (s) => console.log(s) });
function mouse(type, x, y, b, cc) { emit("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: b || 0, clickCount: type === "mouseMoved" ? 0 : (cc || 1) }); }
async function clickXY(x, y) { mouse("mouseMoved", x, y, 0); await sleep(20); mouse("mousePressed", x, y, 1); await sleep(35); mouse("mouseReleased", x, y, 0); await sleep(220); }
function keyEsc() { emit("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); emit("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); }
async function waitFor(fnOrSel, ms = 4000) {
	/* 🔴 **选择器分支必须把值字面量内联**，不能靠 `fn.toString()` 捕获：
	 *    写成 `() => !!document.querySelector(fnOrSel)` 再 toString，拿到的是**源码文本**
	 *    （变量名 `fnOrSel`），浏览器端必然 `ReferenceError: fnOrSel is not defined`。
	 *    实测两个方向都撞过：旧版把异常当 truthy ⇒ `waitFor("选择器")` **恒真**（起点断言等于没写）；
	 *    改严之后又恒 false（假红）。⇒ 两种分支各自生成**自包含**表达式。 */
	const expr = (typeof fnOrSel === "function")
		? ("(" + fnOrSel.toString() + ")()")
		: ("!!document.querySelector(" + JSON.stringify(String(fnOrSel)) + ")");
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		const r = await ev(expr);
		/* 🔴 只认**严格 true**：`{__exc:…}` 也是 truthy，绝不能当成"条件成立"。
		 *    命中异常立刻返回 false 并打印原因 —— 起点判定必须"证明前提"（纪律 23）。 */
		if (r === true) return true;
		if (r && r.__exc) { console.log("      [waitFor 诊断] 求值异常 ⇒ 按「未就绪」处理：" + String(r.__exc).slice(0, 140)); return false; }
		await sleep(120);
	}
	return false;
}
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const textOf = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.trim():null;})()`);

/* 几何 + 命中诊断（坐标必须命中选择器自身，否则读数是"事件打空"而非"功能坏了"） */
const geoOf = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();if(r.width<3)return null;var x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);var hit=document.elementFromPoint(x,y);return {x:x,y:y,vw:window.innerWidth,vh:window.innerHeight,hitTid:hit?(hit.getAttribute&&hit.getAttribute('data-testid'))||hit.tagName:null,inside:!!(hit&&(hit===e||(hit.closest&&hit.closest(${JSON.stringify(sel)}))))};})()`);

/** 命中失败 ⇒ **一次**自恢复：关浮层 → 重新滚入视口 → 重探。
 *  🔴 只恢复一次，且把 `recovered` 记进读数：恢复后仍不命中 ⇒ 说明不是浮层罩着，
 *     该报的缺陷照报（不把自恢复写成"永远绿"）。 */
async function reseat(sel) {
	await closeOverlays();
	await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(e&&e.scrollIntoView)e.scrollIntoView({block:"center"});return 1;})()`);
	await sleep(180);
	const c = await geoOf(sel);
	return c ? { ...c, recovered: true } : null;
}

/* 带命中诊断的真实点击 */
async function clickSelProbe(sel) {
	await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(e&&e.scrollIntoView)e.scrollIntoView({block:"center"});return 1;})()`);
	await sleep(140);
	let c = await geoOf(sel);
	if (!c) return { ok: false, why: "no-geo" };
	if (!c.inside) { const c2 = await reseat(sel); if (c2) c = c2; }
	await clickXY(c.x, c.y); await sleep(240);
	return { ok: true, hit: c.hitTid, inside: c.inside, recovered: !!c.recovered };
}

/**
 * 真实拖动：按下 → **分步**移动（每步 18ms，项目的标准步间隔）→ 抬起。
 * 🔴 不用 DOM 事件合成：`setRailWidth` 挂在 `window` 的**捕获阶段** mousemove 上，
 *    CDP 派发的真实事件才能走完整链路；`dispatchEvent(new MouseEvent(...))` 会绕过
 *    Chromium 的命中测试，把"坐标算错"读成"功能坏了"（纪律 22）。
 */
async function dragBy(sel, dx, dy, steps = 6) {
	let c = await geoOf(sel);
	if (!c) return { ok: false, why: "no-geo" };
	if (!c.inside) { const c2 = await reseat(sel); if (c2) c = c2; }
	/* 🔴 落点必须**钳在视口内**：本段故意"超量拖动"（如 -1200px）来验证 clamp，
	 *    而超量后的坐标会跑到视口外 ⇒ Chromium 会丢弃该次派发，
	 *    于是"没 clamp"与"事件根本没送到"读数完全一样（空真）⇒ 先钳位再派发。 */
	const tx = Math.max(2, Math.min(c.x + dx, (c.vw || 1400) - 3));
	const ty = Math.max(2, Math.min(c.y + dy, (c.vh || 900) - 3));
	const rdx = tx - c.x, rdy = ty - c.y;
	mouse("mouseMoved", c.x, c.y, 0); await sleep(30);
	mouse("mousePressed", c.x, c.y, 1); await sleep(45);
	for (let i = 1; i <= steps; i++) {
		mouse("mouseMoved", c.x + Math.round(rdx * i / steps), c.y + Math.round(rdy * i / steps), 1);
		await sleep(18);
	}
	mouse("mouseReleased", tx, ty, 0); await sleep(220);
	return { ok: true, hit: c.hitTid, inside: c.inside, recovered: !!c.recovered, from: { x: c.x, y: c.y }, to: { x: tx, y: ty }, dxWant: dx, dxApplied: rdx };
}

/* 三面对账读数：store / DOM 属性 / 真实盒宽
 * 🔴 第 1 版把 `data-rail-hover-ms` 也从 `dp-cols` 读 —— **它是 `dp-root` 上的属性**，
 *    于是 `getAttribute` 返回 null、`Number(null)` 得 0 ⇒ V-A1/A2 假红，
 *    并连带 V-A3 以 `sleep(0+400)` 跑（不足 500ms 闸门）⇒ V-A4 变成"缩回"的**空真**。
 *    ⇒ 教训：**属性读哪一层必须与它写在哪一层同一**（同一个 DOM 锚点只留一处真相源）。 */
const readRails = () => ev(`(function(){
	var st=window.__directorLayoutStore.getState();
	var p=document.querySelector('[data-testid=dp-cols]');
	var root=document.querySelector('[data-testid=dp-root]');
	var e4=document.querySelector('[data-testid=dp-r4]');
	var e7=document.querySelector('[data-testid=dp-r7]');
	return {
		store:(st.railWidth||{}), attr4:p?Number(p.getAttribute('data-w-r4')):null, attr7:p?Number(p.getAttribute('data-w-r7')):null,
		box4:e4?Math.round(e4.getBoundingClientRect().width*100)/100:null,
		box7:e7?Math.round(e7.getBoundingClientRect().width*100)/100:null,
		open4:!!e4, open7:!!e7, pin:(st.railPinned||{}),
		gap:p?getComputedStyle(p).columnGap:null,
		attrsRoot:root?[...root.attributes].map(function(a){return a.name+"="+a.value;}).filter(function(s){return /rail|file/.test(s);}):null,
		hoverMs:root&&root.getAttribute('data-rail-hover-ms')!==null?Number(root.getAttribute('data-rail-hover-ms')):null,
		retractMs:root&&root.getAttribute('data-rail-retract-ms')!==null?Number(root.getAttribute('data-rail-retract-ms')):null
	};})()`);

/* ── 覆盖层（浮层）前提 ───────────────────────────────────────────────────────
 * 🔴 2026-09-14 实测**真因**：三个浮层（设计图工作室 `ds-root` / 思维导图 / 总监弹窗）
 *    都是**大区域覆盖层**。任一开着 ⇒ `elementFromPoint` 命中浮层内部元素
 *    ⇒ 其下**所有点击与拖动整体打空**，而读数与"功能坏了"**一模一样**
 *    （实测命中：`{ hit: "ds-el", inside: false }`）。
 *    这才是「同一实例连跑时红时绿」的真因 —— 浮层开合随运行变化
 *    （上一轮/并发工作线留下），**不是产品缺陷，也不是焦点问题**
 *    （`--disable-features=CalculateNativeWinOcclusion` 已实测生效，焦点前提 V-S2 也已绿）。
 * ⇒ 两道防线：
 *    ① 起点**显式关闭**所有浮层 —— `closeFloatLayers()` 是唯一真相源；
 *       产物里若还没有该方法（源码已加、尚未重装），**降级到三个 setter 并外露原因**（纪律 19）；
 *    ② 每个鼠标动作**命中失败时自恢复一次**（再关一次浮层 → 重新探测），
 *       并把 `recovered` 记进读数 —— 恢复后仍不命中才判缺陷（不掩盖真问题）。 */
async function closeOverlays() {
	const r = await ev(`(function(){
	var s=window.__directorLayoutStore; if(!s) return "no-store";
	if(typeof s.closeFloatLayers==="function") return s.closeFloatLayers()?"closed-api":"clean-api";
	var st=(typeof s.getState==="function")?s.getState():{};
	var was=!!(st.designStudioOpen||st.mindmapOpen||st.dialogOpen);
	if(typeof s.setDesignStudio==="function")s.setDesignStudio(false);
	if(typeof s.setMindmap==="function")s.setMindmap(false);
	if(typeof s.setDialogOpen==="function")s.setDialogOpen(false);
	return was?"closed-fallback":"clean-fallback";})()`);
	await sleep(360);
	/* 🔴 **并发工作线的 `OrchestratorPanel`（`dp-orch-panel`）也是覆盖层** ——
	 *    它是**组件本地 state** 的浮层，不归 store 管，`closeFloatLayers()` 管不到它。
	 *    实测 2026-09-14：它开着时 R4 缩回栏的探针点被 `dp-orch-role` 接走
	 *    （`{hit:"dp-orch-role", inRail:false}`）⇒ `V-A3p` 读成「悬停事件没送达」
	 *    ⇒ 把**别人的浮层**误判成**我产品的悬停链路坏了**（差点去改产品）。
	 *    ⇒ 起点按它自己的关闭入口（`dp-orch-close`）关掉；是否原本就开着由
	 *      调用侧用 `orchWas` 记录，收尾按其原状处理（纪律 26）。 */
	const orchWas = await exists("[data-testid=dp-orch-panel]");
	if (orchWas) {
		await ev(`(function(){var b=document.querySelector('[data-testid=dp-orch-close]');if(b){b.click();return 1;}return 0;})()`);
		await sleep(320);
	}
	return r + (orchWas ? "+orch-closed" : "");
}

/** 采样三个点：最上层元素必须落在 `dp-root` 内；同时报出浮层锚点是否在 DOM 里 */
const hitProbe = () => ev(`(function(){
	var root=document.querySelector('[data-testid=dp-root]');
	var studio=document.querySelector('[data-testid=ds-root]');
	var dsEls=document.querySelectorAll('[data-testid=ds-el]').length;
	if(!root) return {ok:false, why:"no-root", studio:!!studio, dsEls:dsEls, bad:[]};
	var r=root.getBoundingClientRect();
	var pts=[[r.x+r.width*0.5,r.y+r.height*0.5],[r.x+r.width*0.2,r.y+r.height*0.35],[r.x+r.width*0.8,r.y+r.height*0.65]];
	var bad=[];
	for(var i=0;i<pts.length;i++){
		var x=Math.round(pts[i][0]),y=Math.round(pts[i][1]);
		var e=document.elementFromPoint(x,y);
		var inside=!!(e&&(e===root||(e.closest&&e.closest('[data-testid=dp-root]'))));
		if(!inside)bad.push({x:x,y:y,tid:e?(e.getAttribute&&e.getAttribute("data-testid"))||String(e.tagName):null});
	}
	/* 🔴 **缩回栏采样**：上面三个点量的是"整页有没有被罩住"，
	 *    但真正会被吃掉的交互点是**两栏自己的探针点** —— 只要有一个非本体
	 *    元素（比如并发工作线的 OrchestratorPanel，锚点 dp-orch-panel）压在栏上，
	 *    悬停/拖动就会整条打空，而"整页三点"照样全绿（实测就是这样漏过去的）。
	 *    ⇒ 对每个已存在的缩回栏，取其探针点，最上层必须落在**该栏内部**。 */
	var rails=[];
	["r4","r7"].forEach(function(side){
		var rl=document.querySelector('[data-testid=dp-rail-'+side+']');
		if(!rl) { rails.push({side:side, present:false}); return; }
		var b=rl.getBoundingClientRect();
		if(b.width<3||b.height<3){ rails.push({side:side, present:true, why:"zero-size"}); return; }
		var px=Math.round(b.x+b.width/2), py=Math.round(b.y+26);
		var h=document.elementFromPoint(px,py);
		var inRail=!!(h&&(h===rl||(h.closest&&h.closest('[data-testid=dp-rail-'+side+']'))));
		rails.push({side:side, present:true, x:px, y:py, inRail:inRail,
			hit:h?((h.getAttribute&&h.getAttribute("data-testid"))||String(h.tagName)):null});
	});
	var railBad=rails.filter(function(o){return o.present && o.inRail!==true;});
	return {ok:bad.length===0 && railBad.length===0, studio:!!studio, dsEls:dsEls, bad:bad,
		rails:rails, railBad:railBad, orch:!!document.querySelector('[data-testid=dp-orch-panel]')};})()`);

/* ── ③ 开场：唤醒会话 → 点总监 tab → 等页面**真的可用** ──────────────────── */
async function wake() {
	await ev(`(function(){var e=[...document.querySelectorAll('[role=treeitem]')].find(x=>/分钟|小时|天|刚刚/.test(x.textContent));if(e)e.click();return 1;})()`);
	for (let i = 0; i < 24; i++) {
		const ok = await ev(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='总监');if(!t)return false;var r=t.getBoundingClientRect();return r.width>4&&r.height>4;})()`);
		if (ok) break; await sleep(200);
	}
	const c = await ev(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='总监');if(!t)return null;var r=t.getBoundingClientRect();return r.width>4?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null;})()`);
	if (c) await clickXY(c.x, c.y); else await ev(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='总监');if(t)t.click();return 1;})()`);
}

/**
 * **页面还在吗** —— 每个段落的入口都该问一次。
 *
 * 为什么需要：本项目已两次踩到"一条失败把整段打哑"（台账一 第 1 条：null 解引用
 * 让其后 100+ 断言无声丢失）。本闸门还额外有一条**自伤路径**：
 * 某处失败后误派了 Esc ⇒ 总监页被宿主退掉 ⇒ `dp-root` 消失 ⇒
 * 其后所有断言都以 `{why:"no-root"}` 崩掉，而读数看起来像"页面自己没了"。
 *
 * 对策：入口先做**廉价的存活检查**，丢了就用产品自己的入口把页签重新点回来
 * （`wake()`），重试有限次；仍不回来才带着**明确原因**继续（后续断言会各自报 no-root）。
 */
async function ensurePage(tag) {
	for (let k = 1; k <= 3; k++) {
		if (await exists("[data-testid=dp-root]")) return true;
		console.log("      [页面存活] " + tag + "：`dp-root` 不在 DOM，第 " + k + " 次重新唤醒总监页…");
		await wake();
		await waitFor("[data-testid=dp-root]", 6000);
		await sleep(500);
	}
	const ok = await exists("[data-testid=dp-root]");
	if (!ok) console.log("      [页面存活] " + tag + "：`dp-root` 仍未回来（其后断言将以 no-root 呈现，属**前置失败**而非产品缺陷）");
	return ok;
}
/* ── ③-0 开场**有限重试**（治「闸门自己起跑太早」）─────────────────────────────
 * 🔴 旧版是「一次不成即 INVALID」，结果**假红**：新实例起来后页面不是立刻可用的
 *    （实测首帧渲染 ~10s）。同一实例连跑 3 次的实测形态是
 *    「前 2 次 INVALID（挂载=false）→ 第 3 次 33/33 全绿」，差异只在**起点时序**、
 *    不在产品 —— 而这正是纪律 23 说的「先证明前提，再断言结果」。
 *    （同类前科：`verify-v17-sync` 首跑 A0–A4 全红、加起点断言后 27/0/0。）
 * ⇒ 有限重试：每轮 = 派 Esc（收浮层）→ 重新唤醒 tab → 等 `dp-root` 就绪；
 *    末轮仍不成才判 INVALID，并把**每轮诊断**打出来（纪律 19：降级可以，无声不行）。 */
const READY = () => {
	const p = document.querySelector('[data-testid=dp-root]');
	return !!(p && p.getAttribute('data-rail-hover-ms') && p.getAttribute('data-rail-r4'));
};
const REASON = `(function(){
	var root=document.querySelector('[data-testid=dp-root]');
	var tab=[...document.querySelectorAll('[role=tab]')].map(function(t){return t.textContent.trim();});
	var tree=document.querySelectorAll('[role=treeitem]').length;
	return {
		dp_root: !!root,
		hover_ms: root?root.getAttribute('data-rail-hover-ms'):null,
		rail_r4: root?root.getAttribute('data-rail-r4'):null,
		tabs: tab.slice(0,8), treeitems: tree,
		body_len: (document.body&&document.body.textContent)?document.body.textContent.length:0
	};})()`;
/* ── ③-0′ 起点**统一自举**（唯一实现 `_cdp-startup.mjs#ensureDirectorPage`）──────
 *   🔴 `T-PLUG-067`：本闸门原先只有下面那段"派 Esc → 点总监 tab → 等 `dp-root`"的
 *      **有限重试**，它**只判不建**（不会去打开一个会话）⇒ 全批里前序套件没建起起点时
 *      必然 INVALID，而读数长得像"总监页坏了"（纪律 58：没跑成 ≠ 失败）。
 *   ⇒ 先调唯一实现把起点**建**起来（无环时走真实 UI 侧栏自举），再保留下面的重试作第二保险。
 *   🔴 `CL` 必须是 `makeClicker()` 返回体 —— 传 `console.log` 之类会在需要真实 UI 自举时抛
 *      `CL.clickAt is not a function` ⇒ `dp-root` 不出现 ⇒ **整片假红**。 */
const CL = makeClicker({ send: send, js: ev, sleep: sleep });
const BOOT = await ensureDirectorPage({ CL: CL, js: ev, send: send, sleep: sleep, log: (s) => console.log(s) });
console.log("  [起点] 统一自举：" + (BOOT.ok ? "✅ `dp-root` 已挂载" : "❌ " + BOOT.reason));
let dpReady = false;
const rounds = [];
for (let r = 1; r <= 3 && !dpReady; r++) {
	if (r > 1) await sleep(1800);
	keyEsc(); await sleep(260);
	await wake();
	dpReady = await waitFor(READY, 9000);
	const why = dpReady ? null : await ev(REASON);
	rounds.push({ 轮: r, 就绪: dpReady, 诊断: why });
	console.log("开场：第 " + r + " 轮 总监页挂载=" + dpReady + (why ? " ｜ 诊断=" + JSON.stringify(why) : ""));
}
console.log("开场：总监页挂载=" + dpReady + "（共 " + rounds.length + " 轮）");
/* 🔴 **产物身份**：本机有并发工作线会跨线重装 ⇒ 必须先能回答"我测的是哪一版"。
 *    否则"我的改动没生效"与"装的是别人的构建"读数完全一样（2026-09-14 实测踩到）。 */
const buildVer = await ev("(function(){return (typeof window!=='undefined'&&window.__dshPluginVersion)?window.__dshPluginVersion:null;})()");
console.log("被测产物版本（页面自报 `window.__dshPluginVersion`）：" + (buildVer === null ? "（旧产物 · 未暴露该锚点）" : buildVer));

/* ── ③-2 「闲态」起点（挂载 ≠ 闲下来）───────────────────────────────────────
 * 🔴 实测真因（本次连跑的**最后一层**干扰）：
 *    `dp-root` 进了 DOM 只说明**组件挂上了**，而总监页自己的数据
 *    （层级 / 台账 / 会话）还在算。这段窗口里渲染器的定时器被排挤，
 *    500ms 的悬停闸门**可能"时间过了却没触发"**。
 *    读数形态：重启后第 1 次连跑 `V-A3`（实测悬停展开）红，
 *    而 `V-A1/A2`（只读常量）绿 ⇒ 看起来像"链路断了"，实际只是**页面还没闲**。
 *    ⇒ 起点必须用产品**自报**的闲态锚点（`data-busy=0` 且 `data-ledger-ok=1`），
 *      并要求**连续两次读数一致**（quiescence）才放行 A 段（纪律 23 / 29）。 */
const IDLE = () => {
	const p = document.querySelector('[data-testid=dp-root]');
	return !!(p && p.getAttribute('data-busy') === '0' && p.getAttribute('data-ledger-ok') === '1');
};
const IDLE_DIAG = `(function(){var p=document.querySelector('[data-testid=dp-root]');
	return p?{busy:p.getAttribute('data-busy'),ledger:p.getAttribute('data-ledger-ok'),scope:p.getAttribute('data-scope')}:"no-root";})()`;
let idleOk = false, idleRounds = 0;
for (let r = 1; r <= 4 && !idleOk; r++) {
	idleRounds = r;
	idleOk = await waitFor(IDLE, 6000);
	if (idleOk) { await sleep(700); idleOk = await waitFor(IDLE, 3000); }
	if (!idleOk) { console.log("      [闲态等待] 第 " + r + " 轮仍未闲：" + JSON.stringify(await ev(IDLE_DIAG))); await sleep(900); }
}
const idleDiag = idleOk ? null : await ev(IDLE_DIAG);
if (!dpReady) {
	console.error("IS_PASS: FALSE（INVALID：总监页未挂载 / dp-root 缺 data-rail-hover-ms，A-F 段全部无法判定）");
	console.error("  逐轮诊断：" + JSON.stringify(rounds));
	console.error("  排查：node scripts/probe-render-errors.mjs（渲染期异常的取法）");
	process.exit(2);
}

/* ── ③-1 harness 自校准（纪律 32：新检查必须用**目标缺陷**做正负对照）──────────
 *  `waitFor` 刚从"表达式抛错即判成功"改成"只认严格 true"。
 *  这次加固本身也要能自证，否则下一个人无法区分"防护生效"与"防护写错但恰好看不出"：
 *    · 坏样本 = 非法选择器（正是本次事故的形态）⇒ 必须 **false**（改前是 true）
 *    · 好样本 = 真实存在的元素 ⇒ 必须 true（防"一律返回 false"的过度修正） */
const wfBad = await waitFor("(function(){", 400);
const wfGood = await waitFor("[data-testid=dp-root]", 1500);
const wfDirect = await ev(`!!document.querySelector('[data-testid=dp-root]')`);
t("V-S1", "harness 自校准：`waitFor` 对**非法选择器（本事故原形）**判 false、对**真实元素**判 true —— 双向都成立才算校准完成",
	wfBad === false && wfGood === true, { bad: wfBad, good: wfGood, 直读dp_root: wfDirect });

/* 🔴 焦点前提（纪律 23：先证明前提，再断言结果）。
 * 不判这一条时，后面每一条真拖/真点都可能以「产品坏了」的形态炸掉 —— 而根因是环境。 */
t("V-S2", "🔴 页面**焦点前提**：`document.hasFocus()` 为 true（未聚焦时 CDP 会吞掉 press/release ⇒ 真拖/真点整体失效，且读数伪装成产品缺陷）",
	focusInfo.hasFocus === true, focusInfo);

/* 闸门时长一律**从 DOM 读**（`dp-root[data-rail-hover-ms|data-rail-retract-ms]`），不写死。
 * 后面多处要用它（"等过悬停窗口"、"实测停靠这么久是否真的展开"）。 */
const _h0 = await readRails();
const HOVER_MS = (_h0 && Number.isFinite(_h0.hoverMs) && _h0.hoverMs > 0) ? _h0.hoverMs : 500;
const RETRACT_MS = (_h0 && Number.isFinite(_h0.retractMs) && _h0.retractMs > 0) ? _h0.retractMs : 300;
console.log("闸门时长（从 DOM 读）：悬停 " + HOVER_MS + "ms · 缩回 " + RETRACT_MS + "ms");

/* ── ④ 起点**显式建立** + 快照（收尾按 ORIG 还原）─────────────────────────
 * 🔴 上一版只"快照当前值"，然后收尾还原到该快照 —— 如果快照本身就是**脏的**
 *    （上一轮或用户留下的 r7=260 / pin=true），那"还原"等于把脏值当成目标，
 *    形成**循环空转**：连跑时 V-B1（断言默认宽度）与 V-B5（假定从默认值起拖）
 *    会以"产品坏了"的形态连续红。实测读数：起点快照 {"r4":200,"r7":260,"pin":{true,true}}。
 * ⇒ 正确做法（memory §B）：**起点显式建立并断言** ——
 *      ① 记录用户的真实设置 `ORIG`（收尾要还给他，不是还"默认值"）；
 *      ② 把两栏宽度**写回源码默认值**、钉住态**归零**、两栏**缩回** ⇒ 由此得到干净起点；
 *      ③ 收尾还原到 `ORIG`。
 *    ⚠️ `dir` 用 `setRailWidth` 写：它是**钳制过**的唯一写入口，写别的值会被静默丢弃。 */

/** 把鼠标挪到"无关区域"（R5 中部）：R4/R7 的缩回栏都不在那儿，不会被路过触发悬停 */
async function neutral(settleMs) {
	const a = await ev(`(function(){var e=document.querySelector('[data-testid=dp-r5]');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+Math.round(r.height/2))};})()`);
	if (a) { mouse("mouseMoved", a.x, a.y, 0); }
	await sleep(settleMs == null ? 200 : settleMs);
	return !!a;
}

/* 🔴 `railTogglePin(side)` 是**奇偶翻转**（`next = !railPinned[side]`）：
 *    面板开着但**未钉住**时（鼠标悬停开的那种），直接点面板头会 `next = true`
 *    ⇒ **把它钉住并继续开着** —— 看起来就是"点了没关"。
 *    第 1 版 `closeRail` 正是这么写的：连点 3 次在 true/false 之间来回翻，
 *    面板始终不关，脏状态（两栏都开着 + 被钉住）泄漏给下一次运行 ⇒ 下次 V-S0 起就红。
 *  ⇒ 修法：**先把钉住态钉到点完之后必然为 false 的那一侧**，再点。
 *    closeRail：先 `setRailPinned(true)` ⇒ 点一下 ⇒ `next = !true = false` ⇒ 关。
 *    openRail ：先 `setRailPinned(false)` ⇒ 点一下 ⇒ `next = !false = true` ⇒ 开。
 *    这样开关就与当前 parity 无关，**确定性**。 */
async function setPin(side, v) {
	await ev(`(function(){window.__directorLayoutStore.setRailPinned(${JSON.stringify(side)},${v ? "true" : "false"});return 1;})()`);
	await sleep(110);
}
async function closeRail(side) {
	for (let i = 0; i < 4; i++) {
		if (!(await exists("[data-testid=dp-" + side + "]"))) { await setPin(side, false); return true; }
		await setPin(side, true);            // 保证"点一下 = 关"
		const r = await clickSelProbe("[data-testid=dp-" + side + "-toggle]");
		await sleep(320);
		if (!r.ok) break;
	}
	const ok = !(await exists("[data-testid=dp-" + side + "]"));
	/* 🔴 不论成败都**必须**解除钉住。第 1 版只在 `ok` 时复位，于是"点击偶发未送达"
	 *    会把 `railPinned[side]=true` **永久**写进持久化 store —— 实测 2026-09-14：
	 *    run2 报红后留下 `pin.r4=true`，run3 把**这个脏值**当成"用户原始设置"又还了一遍，
	 *    结果 42/42 全绿、污染被完全掩盖（**闸门既破坏产品又自我掩盖**，纪律 15 的最坏形态）。
	 *    ⇒ 失败路径必须留**干净**状态，让红是真红。 */
	await setPin(side, false);
	return ok;
}

/* 🔴 **不依赖点击送达**的缩回路径（收尾专用）：走产品自己的 `railLeave`。
 *    点击会被"覆盖层 / 焦点 / 派发时序"偶发吃掉（本文件已为此修过 3 轮），
 *    而收尾是**必须成功**的一步 —— 失败就等于把展开态留给用户。
 *    ⇒ 展开态兜底：`setPin(false)` → 鼠标真停到栏上（触发 enter，确保 `railOpen=true`）
 *      → 移开（触发 leave ⇒ 未钉住则 retract）。全程只走真实鼠标，不是绕过产品逻辑。 */
async function forceRetract(side) {
	const railSel = "[data-testid=dp-rail-" + side + "]";
	const panelSel = "[data-testid=dp-" + side + "]";
	for (let k = 0; k < 2; k++) {
		if (!(await exists(panelSel))) return true;
		await setPin(side, false);
		const g = await ev(`(function(){var e=document.querySelector(${JSON.stringify(railSel)})||document.querySelector(${JSON.stringify(panelSel)});
			if(!e)return null;var r=e.getBoundingClientRect();if(r.width<3||r.height<3)return null;
			return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+26)};})()`);
		if (!g) break;
		mouse("mouseMoved", g.x, g.y, 0);
		await sleep(RETRACT_MS + 260);
		await neutral(HOVER_MS + 260);
	}
	return !(await exists(panelSel));
}
async function openRail(side) {
	for (let i = 0; i < 3; i++) {
		if (await exists("[data-testid=dp-" + side + "]")) return true;
		await setPin(side, false);           // 保证"点一下 = 开"
		await clickSelProbe("[data-testid=dp-rail-" + side + "]");
		await sleep(340);
	}
	return await exists("[data-testid=dp-" + side + "]");
}

/** 收尾/起点共用的"把两栏落到指定开合态"—— 幂等，且每次收尾都把鼠标移到无关区并等过悬停窗口 */
async function shapeRails(openWanted) {
	for (const side of ["r4", "r7"]) {
		const want = !!openWanted[side];
		if (want) {
			if (!(await openRail(side))) { await clickSelProbe("[data-testid=dp-rail-" + side + "]"); await sleep(360); }
		} else if (!(await closeRail(side))) {
			/* 点击路径没成 ⇒ 走"真实鼠标 enter→leave"兜底（收尾必须成功，见 forceRetract 注释） */
			await forceRetract(side);
		}
	}
	/* 🔴 关栏时鼠标停在"原面板头"位置 —— 那正好落在缩回栏上 ⇒ 悬停计时器会在
	 *    500ms 后把它重新打开。必须**移开 → 等过悬停窗口**，再断言，
	 *    否则把"刚被路过打开"读成"没关上"（跑第 1 次绿、第 2 次红的经典偶发）。 */
	await neutral(HOVER_MS + 260);
}

const snap = await readRails();
const ORIG = { r4: (snap && snap.store && snap.store.r4) || DEF_M4, r7: (snap && snap.store && snap.store.r7) || DEF_M7, pin: (snap && snap.pin) || { r4: false, r7: false } };
/* 🔴 浮层开合是**持久化**字段 ⇒ 闸门关掉它们属于"写盘"，必须快照 + 收尾还原（纪律 15）。 */
const ORIG_OVERLAY = await ev(`(function(){var s=window.__directorLayoutStore;var st=(s&&typeof s.getState==="function")?s.getState():{};
	return {designStudioOpen:!!st.designStudioOpen, mindmapOpen:!!st.mindmapOpen, dialogOpen:!!st.dialogOpen};})()`);
console.log("用户原始设置（收尾要还回去）：" + JSON.stringify(ORIG) + " ｜ 浮层：" + JSON.stringify(ORIG_OVERLAY));
/* 🔴 并发工作线的 `OrchestratorPanel` 是**本地 state** 浮层，store 快照拿不到它 ⇒
 *    单独记一次"原本在不在"，收尾按其原状处理（纪律 26：恢复按"原来怎么设的"）。 */
const ORCH_ORIG = await exists("[data-testid=dp-orch-panel]");
console.log("他方浮层 OrchestratorPanel 起始状态：" + (ORCH_ORIG ? "开着（收尾要替他开回去）" : "关着"));

async function establishStart() {
	await closeOverlays();
	await ev(`(function(){var s=window.__directorLayoutStore;s.setRailWidth('r4',${DEF_M4});s.setRailWidth('r7',${DEF_M7});return 1;})()`);
	await sleep(220);
	await shapeRails({ r4: false, r7: false });
	return { rail4: await exists("[data-testid=dp-rail-r4]"), rail7: await exists("[data-testid=dp-rail-r7]"), panel4: await exists("[data-testid=dp-r4]"), panel7: await exists("[data-testid=dp-r7]") };
}
const st0 = await establishStart();
t("V-S0", "🔴 起点**显式建立并断言**：宽度回到源码默认值（r4=" + DEF_M4 + " r7=" + DEF_M7 + "）、钉住归零、两栏都在缩回态（面板不在 DOM 且缩回栏在）",
	st0.rail4 === true && st0.rail7 === true && st0.panel4 === false && st0.panel7 === false, st0);
const startW = await readRails();
t("V-S0b", "起点自证：store 宽度确实等于默认值（不赌 establishStart 的写入成功）",
	!!startW && startW.store.r4 === DEF_M4 && startW.store.r7 === DEF_M7, startW && { store: startW.store });
/* 🔴 起点**覆盖层前提**：三个浮层都会让 `elementFromPoint` 命中它们自己
 *    ⇒ 其下真拖/真点**整体打空**，读数与"产品坏了"完全一样（本次时红时绿的真因）。
 *    ⇒ 必须先证明"起点没有覆盖层"，再谈后面每一条鼠标断言（纪律 23）。 */
const hp0 = await hitProbe();
t("V-S3", "🔴 起点**覆盖层前提**：① `dp-root` 内三个采样点最上层都落在 `dp-root` 内；② **两栏缩回栏的探针点必须命中该栏自身**；③ 浮层根 `ds-root` 与 `dp-orch-panel` 都不在 DOM —— 否则其下所有点击/拖动/悬停被吃掉，读数伪装成产品缺陷",
	!!hp0 && hp0.ok === true && hp0.studio === false && hp0.orch === false, hp0);
t("V-S4", "🔴 起点**闲态前提**：总监页自报 `data-busy=0` 且 `data-ledger-ok=1` 并**连续两次读数一致**（挂载 ≠ 闲下来；未闲时 500ms 悬停闸门会被排挤 ⇒ V-A3 假红）",
	idleOk === true, { idleOk: idleOk, 轮次: idleRounds, diag: idleDiag });

/* ── ③-3 **输入通道可达性**（显式建立 + 可证伪）───────────────────────────────
 * 🔴 实测（同一实例连跑 3 次）：**首跑**整段收不到鼠标事件 ——
 *    `V-A3p` 报 `over=0`（悬停事件一次都没进页面）、B2–B4 真拖一起红；
 *    第 2、3 跑 41/41 全绿。差异不在产品，而在「这一轮是页面激活后的第几次输入」。
 *    若把这段窗口当成产品缺陷查，会得出"拖动时好时坏"的错误结论并改坏产品。
 * ⇒ 在鼠标段之前先**证明输入通道可达**：把 `mousemove` 计数挂在 `dp-root` 上，
 *    连跳几处无害坐标；不通就等一会儿再试（最多 5 轮）。
 *    这一步不判产品，只为让后面每条鼠标断言的读数**同源**（纪律 23 / 29）。
 *    detail 里带上次数与耗时 ⇒ 失败自解释；成功后后面真红就是真红。 */
const inputArmed = await ev(`(function(){var r=document.querySelector('[data-testid=dp-root]');if(!r){window.__inpP=null;return 0;}
	window.__inpP={move:0};
	r.addEventListener('mousemove',function(){window.__inpP.move++;});
	return 1;})()`);
let inputDelivered = 0, inputTries = 0;
for (let k = 1; k <= 5; k++) {
	inputTries = k;
	const box = await ev(`(function(){var r=document.querySelector('[data-testid=dp-root]');if(!r)return null;var b=r.getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height*0.5),h:Math.round(b.height)};})()`);
	if (box) {
		for (const dy of [-40, 8, -20, 26]) { mouse("mouseMoved", box.x, box.y + dy, 0); await sleep(90); }
	}
	inputDelivered = Number((await ev("window.__inpP && window.__inpP.move")) || 0);
	if (inputDelivered > 0) break;
	await sleep(700);
}
t("V-S5", "🔴 起点**输入通道前提**：CDP 派发的 `mousemove` **确实进到页面**（`dp-root` 上原生计数 > 0）—— 为 0 时其后的真拖/真点/悬停读数与「功能坏了」**不同源**（本机首跑实测会为 0）",
	inputArmed === 1 && inputDelivered > 0, { armed: inputArmed, 收到mousemove: inputDelivered, 轮次: inputTries });

/* ══ A. 悬停闸门时长（「鼠标移过去没反应」的验收）══ */
console.log("\n══ A. 悬停闸门时长（用户：r4和r7的鼠标移动不好用）══");
const hv = await readRails();
t("V-A1", "dp-root 自报悬停时长（`data-rail-hover-ms`）为**人类可感知**量级（>0 且 <=1000ms）—— 改前是 5000ms",
	Number.isFinite(hv.hoverMs) && hv.hoverMs > 0 && hv.hoverMs <= 1000, { hoverMs: hv.hoverMs });
t("V-A2", "dp-root 自报缩回时长（`data-rail-retract-ms`）>0 且 <=1000ms",
	Number.isFinite(hv.retractMs) && hv.retractMs > 0 && hv.retractMs <= 1000, { retractMs: hv.retractMs });
/* 🔴 反例保护：光看"两个数很小"不够 —— 必须**实测一次**"停这么久真的开了"，
 *    否则把两个常量都改成 1ms 而 hover 链路整条断掉，上面两条照样绿。
 *
 * 🔴 **本段两级判据**（纪律 23：先证明前提，再断言结果）：
 *    实测本机 `mouseMoved` 的送达**时好时坏**（同一实例、同一坐标，一次 over=1 栏开、
 *    一次 over=0 栏不开）。两者读数都是"栏没开"，但一个是环境、一个是产品 ——
 *    旧写法分不出来，于是被记成"产品时红时绿"，白查了两轮。
 *    ⇒ 先在栏上挂**原生**监听（`mouseover/mouseenter/mousemove` 计数），
 *      · `V-A3p` 前提：事件**确实送达**（over ≥ 1）；
 *      · `V-A3` 结果：送达到位后栏**真的展开**。
 *      前提为 0 时 `V-A3` 的 detail 里 `送达:0` 一眼可见 ⇒ 失败自解释。
 *    ⇒ 另外：**先移到远处再移到栏上**（制造真实的空间过渡）。
 *      实测只把指针"瞬移"到栏上时 Chromium 可能不产生 over 过渡（首帧位置同步）。 */
const railBox = await ev(`(function(){var e=document.querySelector('[data-testid=dp-rail-r4]');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+26)};})()`);
if (railBox && Number.isFinite(hv.hoverMs)) {
	/* 🔴 监听**每轮重挂**（第 1 版只挂一次，实测 run2 报 `over=0` 而 `V-S5` 的
	 *    `dp-root` 计数 > 0 —— 说明**输入通道是通的**，是**监听所在的节点被 React 重建
	 *    成了孤儿**（缩回栏随 store 变更重建）⇒ 计数恒 0。
	 *    两种情况的读数都是 `over=0`，把"节点被重建"误报成"事件没送达"（纪律 23）。
	 * ⇒ 每轮：重挂监听 → **命中检查**（探针点最上层是否就是缩回栏，区分"覆盖层"）
	 *    → 取当轮真实几何 → 远处过渡 → 停靠 → 采样。最多 3 轮，取**各轮最大值**。 */
	let after = false, tries = 0, armed = 0, hov = { over: 0, enter: 0, move: 0, out: 0 };
	let hitInfo = null;
	const ARM = `(function(){var e=document.querySelector('[data-testid=dp-rail-r4]');if(!e){window.__hovP=null;return 0;}
		window.__hovP={over:0,enter:0,move:0,out:0};
		e.addEventListener('mouseover',function(){window.__hovP.over++;});
		e.addEventListener('mouseenter',function(){window.__hovP.enter++;});
		e.addEventListener('mousemove',function(){window.__hovP.move++;});
		e.addEventListener('mouseout',function(){window.__hovP.out++;});
		return 1;})()`;
	const HIT = `(function(){var e=document.querySelector('[data-testid=dp-rail-r4]');if(!e)return null;
		var r=e.getBoundingClientRect();if(r.width<3||r.height<3)return null;
		var x=Math.round(r.x+r.width/2),y=Math.round(r.y+26),h=document.elementFromPoint(x,y);
		return {x:x,y:y,hit:h?((h.getAttribute&&h.getAttribute('data-testid'))||h.tagName):null,
			inRail:!!(h&&h.closest&&h.closest('[data-testid=dp-rail-r4]'))};})()`;
	for (let k = 1; k <= 3 && !after; k++) {
		tries = k;
		armed = await ev(ARM);
		hitInfo = await ev(HIT);
		/* 前提不成立（命中不是缩回栏）⇒ 换几何重来，别把"覆盖层/几何变了"读成"没送达" */
		const pt = (hitInfo && hitInfo.inRail) ? hitInfo : null;
		if (!pt) { await sleep(500); continue; }
		const rst = await ev(`(function(){var e=document.querySelector('[data-testid=dp-r5]');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+Math.round(r.height/2))};})()`);
		if (rst) { mouse("mouseMoved", rst.x, rst.y, 0); await sleep(240); }
		mouse("mouseMoved", pt.x, pt.y, 0);
		await sleep(hv.hoverMs + 400 + (k - 1) * 520);
		after = (await exists("[data-testid=dp-r4]")) === true;
		const cur = armed === 1 ? await ev("window.__hovP") : null;
		if (cur && Number(cur.over) >= Number(hov.over)) hov = cur;
	}
	t("V-A3p", "前提：悬停事件**确实送进页面**（缩回栏上原生 `mouseover` ≥ 1）—— 为 0 说明输入没送达（环境），此时「栏没开」与「功能坏了」**不同源**",
		armed === 1 && Number(hov.over) >= 1, { armed: armed, 计数: hov, 命中: hitInfo, 轮次: tries });
	t("V-A3", "🔴 实测：鼠标停靠 " + hv.hoverMs + "ms 后 R4 **真的展开**（防「只改常量、链路已断」的假绿）",
		after === true, { after: after, 尝试次数: tries, 送达: hov.over, 计数: hov });
	/* 🔴 **这里原本有一句无条件 `keyEsc()`，已删除** —— 它是本闸门最严重的一处自伤：
	 *    本机 Esc 的语义是**逐层退**，退无可退时**交给宿主**。
	 *    实测形态：A3 若失败（悬停没把栏展开）⇒ 此刻**无任何浮层可退**
	 *    ⇒ 这一句 Esc 把**整个总监页**退掉 ⇒ `dp-root` 从 DOM 消失
	 *    ⇒ 其后 30+ 条断言全部以 `{why:"no-root"}` 崩掉。
	 *    危害等级高于"红"：**一条失败把整段打哑**，而且读数看起来像"页面自己没了"
	 *    （实测确实被误判成"并发工作线在捣乱"，白查了一轮）。
	 *    ⇒ 收尾只用**产品的正常路径**：把钉住态归零 + 鼠标移开 ⇒ 由自动缩回接管，
	 *      这恰好就是 V-A4 要验的行为，不需要 Esc 参与。 */
	await ev(`(function(){var s=window.__directorLayoutStore;s.setRailPinned('r4',false);return 1;})()`);
	await sleep(120);
	/* 🔴 V-A4 的前提是"R4 此刻确实开着"。A3 没开成时，这里量的是"本来就是关的" ——
	 *    写成断言就是**平凡真**（纪律 29 的"断言防平凡真"）。⇒ 前提不成立就带原因跳过。 */
	if (!after) {
		sk("V-A4", "V-A3 未能展开 R4 ⇒「移开是否缩回」的前提不成立（不是产品缺陷）");
	} else {
		const away = await ev(`(function(){var e=document.querySelector('[data-testid=dp-root]');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height-8)};})()`);
		let closedAt = null;
		if (away) {
			mouse("mouseMoved", away.x, away.y, 0);
			/* 采样而不是只等一次：缩回是 `setTimeout(retractMs)`，实测偶发被渲染排队推迟
			 * ⇒ 单点等待会把"慢了一拍"读成"不缩回"（假红）。 */
			for (const w of [(hv.retractMs || 300) + 260, 700, 1400]) {
				await sleep(w);
				if ((await exists("[data-testid=dp-r4]")) === false) { closedAt = closedAt || w; break; }
			}
		}
		t("V-A4", "实测：移开后 R4 自动缩回（用户需求「移走缩回」；收尾复原，不把展开态留给 B 段）",
			closedAt !== null, { 缩回耗时_ms: closedAt, 移开点: away });
	}
} else {
	sk("V-A3p", "缩回栏取不到几何");
	sk("V-A3", "缩回栏取不到几何");
	sk("V-A4", "缩回栏取不到几何");
}

await ensurePage("B");
/* ══ B. 宽度：默认值 / 拖动对账 / clamp / 复位 / 反向语义 ══ */
console.log("\n══ B. R4/R7 展开宽度（用户：宽度都要允许自由拖拽）══");
/* 🔴 中段守卫：浮层可能在本轮**运行期间**被打开（并发工作线 / 上一段遗留）。
 *    这里再关一次并采样；后续真拖若仍打空，读数里会带 `recovered`。 */
await closeOverlays();
const hpB = await hitProbe();
t("V-B0b", "B 段前置：鼠标段开始前**无覆盖层**（浮层会吃掉真拖 —— 本次时红时绿的真因）",
	!!hpB && hpB.ok === true && hpB.studio === false, hpB);
/* 用 `openRail`（确定性）而不是直接点缩回栏：直接点会撞上 `railTogglePin` 的奇偶翻转 */
const p1 = await openRail("r4");
const p2 = await openRail("r7");
if (!p1 || !p2) console.log("      [B 诊断] 展开结果：r4=" + p1 + " r7=" + p2);
const mid = await readRails();
const bOpen = !!(mid && mid.open4 && mid.open7);
t("V-B0", "前置：R4 与 R7 均已展开（两栏真实在 DOM）", bOpen, mid && { open4: mid.open4, open7: mid.open7 });
if (bOpen) {
	t("V-B1", "展开宽度 = 源码默认值（r4=" + DEF_M4 + " r7=" + DEF_M7 + "）且 **store / DOM 属性 / 真实盒宽 三面同源**",
		mid.store.r4 === DEF_M4 && mid.attr4 === DEF_M4 && Math.abs(mid.box4 - DEF_M4) <= 1
			&& mid.store.r7 === DEF_M7 && mid.attr7 === DEF_M7 && Math.abs(mid.box7 - DEF_M7) <= 1,
		{ store: mid.store, attr4: mid.attr4, box4: mid.box4, attr7: mid.attr7, box7: mid.box7 });
	/* ① R4 右拖 +40 ⇒ 变宽 40 */
	/* 🔴 拖动前先证**前提**：按下点必须命中拖拽条自身（纪律 22）。
	 *    与 A 段同理 —— "按空了"与"拖动没实现"读数一样，拆成两条才自解释。 */
	const rszPre = await geoOf("[data-testid=dp-r4-resizer]");
	t("V-B2p", "前提：R4 拖拽条存在、可命中（按下点 `elementFromPoint` 命中自身）—— 不成立时下面的拖动读数是「事件打空」而非「拖动坏了」",
		!!rszPre && rszPre.inside === true, rszPre && { hit: rszPre.hitTid, inside: rszPre.inside, x: rszPre.x, y: rszPre.y });
	const dg1 = await dragBy("[data-testid=dp-r4-resizer]", 40, 0);
	if (!dg1.ok || !dg1.inside) console.log("      [B 诊断] R4 拖拽条命中：" + JSON.stringify(dg1));
	const w1 = await readRails();
	const want1 = Math.min(RAIL_MAX, DEF_M4 + 40);
	t("V-B2", "🔴 真拖 R4 拖拽条 +40px ⇒ store 与真实盒宽**同时**变为 " + want1 + "（跑程内对账，拖前 " + DEF_M4 + "）",
		!!w1 && w1.store.r4 === want1 && Math.abs(w1.box4 - want1) <= 1 && w1.attr4 === want1,
		w1 && { store: w1.store.r4, attr: w1.attr4, box: w1.box4, want: want1, hit: dg1.hit, dxApplied: dg1.dxApplied });
	/* ② 超上限拖动 ⇒ clamp 到 RAIL_MAX（不是"随便多宽"） */
	const dg2 = await dragBy("[data-testid=dp-r4-resizer]", 900, 0);
	const w2 = await readRails();
	t("V-B3", "🔴 一次性右拖 900px ⇒ 被 clamp 到上限 " + RAIL_MAX + "（上下限是真的，不是装饰）",
		!!w2 && w2.store.r4 === RAIL_MAX && Math.abs(w2.box4 - RAIL_MAX) <= 1, w2 && { store: w2.store.r4, box: w2.box4, max: RAIL_MAX, dxWant: dg2.dxWant, dxApplied: dg2.dxApplied });
	/* ③ 超下限拖动 ⇒ clamp 到 RAIL_MIN */
	const dg3 = await dragBy("[data-testid=dp-r4-resizer]", -1200, 0);
	const w3 = await readRails();
	t("V-B4", "🔴 一次性左拖 1200px ⇒ 被 clamp 到下限 " + RAIL_MIN + "（下限同样是真的）",
		!!w3 && w3.store.r4 === RAIL_MIN && Math.abs(w3.box4 - RAIL_MIN) <= 1, w3 && { store: w3.store.r4, box: w3.box4, min: RAIL_MIN, dxWant: dg3.dxWant, dxApplied: dg3.dxApplied });
	/* ④ R7 方向语义：在右 ⇒ 左移变宽 */
	const dg4 = await dragBy("[data-testid=dp-r7-resizer]", -50, 0);
	const w4 = await readRails();
	const want4 = Math.max(RAIL_MIN, DEF_M7 + 50);
	t("V-B5", "🔴 R7 在右侧 ⇒ **左拖 50px 变宽**到 " + want4 + "（方向语义与 R4 相反，不是同向复制）",
		!!w4 && w4.store.r7 === want4 && Math.abs(w4.box7 - want4) <= 1, w4 && { store: w4.store.r7, box: w4.box7, want: want4, hit: dg4.hit, dxApplied: dg4.dxApplied });
	/* ⑤ 双击复位（🔴 第二次点击必须带 `clickCount:2` —— 只发两对 clickCount:1
	 *     的 press/release 在 Chromium 里**不会**合成 `dblclick`，
	 *     会让"双击没接上"与"复位没实现"读数一样） */
	const rs = await ev(`(function(){var e=document.querySelector('[data-testid=dp-r4-resizer]');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
	if (rs) {
		mouse("mouseMoved", rs.x, rs.y, 0); await sleep(30);
		mouse("mousePressed", rs.x, rs.y, 1, 1); mouse("mouseReleased", rs.x, rs.y, 0, 1); await sleep(40);
		mouse("mousePressed", rs.x, rs.y, 1, 2); mouse("mouseReleased", rs.x, rs.y, 0, 2); await sleep(320);
		const w5 = await readRails();
		t("V-B6", "双击拖拽条 ⇒ R4 宽度复位为默认 " + DEF_M4 + "（「拖歪了想回默认值」的确定场景）",
			!!w5 && w5.store.r4 === DEF_M4 && Math.abs(w5.box4 - DEF_M4) <= 1, w5 && { store: w5.store.r4, box: w5.box4 });
	} else { sk("V-B6", "拖拽条取不到几何"); }
} else {
	["V-B1", "V-B2", "V-B3", "V-B4", "V-B5", "V-B6"].forEach((k) => sk(k, "R4/R7 未同时展开，宽度段"));
}

await ensurePage("C");
/* ══ C. 无缝拼接 ══ */
console.log("\n══ C. R4/R5/R7 无缝（用户：中间拼接改成无缝的，靠在一起就行）══");
const seam = await ev(`(function(){
	var p=document.querySelector('[data-testid=dp-cols]');
	var a=document.querySelector('[data-testid=dp-r4]'), b=document.querySelector('[data-testid=dp-r5]'), c=document.querySelector('[data-testid=dp-r7]');
	if(!p||!a||!b||!c)return null;
	var ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect(), rc=c.getBoundingClientRect();
	var cs=getComputedStyle(p);
	return {gap:cs.columnGap, padL:cs.paddingLeft, padR:cs.paddingRight,
		raRight:Math.round(ra.right*100)/100, rbLeft:Math.round(rb.left*100)/100, rbRight:Math.round(rb.right*100)/100, rcLeft:Math.round(rc.left*100)/100,
		w4:Math.round(ra.width), w5:Math.round(rb.width), w7:Math.round(rc.width)};})()`);
if (seam) {
	t("V-C1", "`dp-cols` 的 `columnGap` 为 0（改前 7px）", seam.gap === "0px", { gap: seam.gap });
	t("V-C2", "🔴 相邻边界真的相接：|R4.right − R5.left| <= 1 且 |R5.right − R7.left| <= 1（含三栏宽度下限，防「某栏没渲染」的平凡真）",
		seam.w4 >= RAIL_MIN && seam.w5 > 100 && seam.w7 >= RAIL_MIN
			&& Math.abs(seam.raRight - seam.rbLeft) <= 1 && Math.abs(seam.rbRight - seam.rcLeft) <= 1,
		{ 缝1: Math.round((seam.raRight - seam.rbLeft) * 100) / 100, 缝2: Math.round((seam.rbRight - seam.rcLeft) * 100) / 100, w4: seam.w4, w5: seam.w5, w7: seam.w7 });
	t("V-C3", "整组外缘仍保留左右内边距（无缝只针对「栏之间」，不是把整组贴边）",
		parseFloat(seam.padL) > 0 && parseFloat(seam.padR) > 0, { padL: seam.padL, padR: seam.padR });
} else { ["V-C1", "V-C2", "V-C3"].forEach((k) => sk(k, "三栏未同时渲染，无缝段")); }

await ensurePage("D");
/* ══ D. R4 条目「两行 + 编号靠右」══ */
console.log("\n══ D. R4 条目两行 + 编号靠右（用户样张 T-INIT-0032026-08-24 靠右）══");
await ev(`(function(){var b=document.querySelector('[data-testid=dp-r4-roadmap]');if(b)b.click();return 1;})()`);
await sleep(260);
const r4row = await ev(`(function(){
	var body=document.querySelector('[data-testid=dp-r4-body-roadmap]');
	if(!body)return null;
	var it=body.querySelector('[data-testid=dp-r4-item]');
	if(!it)return null;
	var task=it.querySelector('[data-testid=dp-r4-item-task]');
	var meta=it.querySelector('[data-testid=dp-r4-item-meta]');
	var id=it.querySelector('[data-testid=dp-r4-item-id]');
	if(!task||!meta||!id)return {missing:true, hasTask:!!task, hasMeta:!!meta, hasId:!!id, dirs:[...it.children].map(function(c){return c.getAttribute('data-testid');})};
	var ri=it.getBoundingClientRect(), rt=task.getBoundingClientRect(), rm=meta.getBoundingClientRect(), rd=id.getBoundingClientRect();
	return {count:body.getAttribute('data-count'), idText:(id.textContent||'').trim(),
		rows:it.children.length,
		taskY:Math.round(rt.top), metaY:Math.round(rm.top), idY:Math.round(rd.top),
		itemRight:Math.round(ri.right*100)/100, idRight:Math.round(rd.right*100)/100,
		taskW:Math.round(rt.width), itemW:Math.round(ri.width), metaJustify:getComputedStyle(meta).justifyContent};})()`);
if (r4row && !r4row.missing) {
	t("V-D1", "一条待办 = **恰好两行**（描述行 + 元信息行）—— 改前是单行 flex（窄栏下描述被压成逐字竖排）",
		r4row.rows === 2, r4row);
	t("V-D2", "🔴 编号在**第二行**（`编号.y > 描述.y`），且两行**不重叠**",
		r4row.idY > r4row.taskY && r4row.metaY > r4row.taskY, { taskY: r4row.taskY, metaY: r4row.metaY, idY: r4row.idY });
	t("V-D3", "🔴 编号**靠右对齐**：|编号.right − 条目.right| <= 2（用户样张的「靠右」）",
		Math.abs(r4row.idRight - r4row.itemRight) <= 2, { idRight: r4row.idRight, itemRight: r4row.itemRight });
	t("V-D4", "🔴 描述行**占满整行**（宽度接近条目宽度，防「描述被挤到窄条」）",
		r4row.itemW > 100 && r4row.taskW >= r4row.itemW - 6, { taskW: r4row.taskW, itemW: r4row.itemW });
	t("V-D5", "编号取自台账真实条目（形如 `T-*`，非空占位）", /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+/.test(r4row.idText), { idText: r4row.idText });
	const dn = await ev(`(function(){var b=document.querySelector('[data-testid=dp-r4-done]');if(b)b.click();return 1;})()`);
	await sleep(280);
	const doneRow = await ev(`(function(){
		var body=document.querySelector('[data-testid=dp-r4-body-done]');if(!body)return null;
		var it=body.querySelector('[data-testid=dp-r4-item]');if(!it)return null;
		var id=it.querySelector('[data-testid=dp-r4-item-id]'), dt=it.querySelector('[data-testid=dp-r4-item-date]');
		if(!id||!dt)return {missing:true,hasId:!!id,hasDate:!!dt,dirs:[...it.children].map(function(c){return c.getAttribute('data-testid');})};
		var task=it.querySelector('[data-testid=dp-r4-item-task]');
		var ri=it.getBoundingClientRect(), rid=id.getBoundingClientRect(), rdt=dt.getBoundingClientRect(), rt=task?task.getBoundingClientRect():null;
		return {count:body.getAttribute('data-count'), rows:it.children.length,
			idText:(id.textContent||'').trim(), dateText:(dt.textContent||'').trim(),
			itemRight:Math.round(ri.right*100)/100, dateRight:Math.round(rdt.right*100)/100, idRight:Math.round(rid.right*100)/100,
			idY:Math.round(rid.top), dateY:Math.round(rdt.top), taskY:rt?Math.round(rt.top):null};})()`);
	if (doneRow && !doneRow.missing) {
		/* 🔴 **判据修正：这是本闸门自己的缺陷，第 1 次跑被它自己抓了出来。**
		 *    「已完成」行的靠右顺序是 **编号 → 日期** ⇒ 贴着右边缘的是**日期**，不是编号。
		 *    第一版断言 `|编号.right − 条目.right| <= 26` 把"整组靠右"误读成"编号在最右"
		 *    ⇒ 实测 idRight=411 / itemRight=471（差 60px，正好是日期宽度）直接假红。
		 *    正确判据：**整组靠右** = 最右元素（日期）贴边；且编号与日期**同一行**、编号在左。
		 *    （路线图那侧没有日期，最右元素就是编号 ⇒ V-D3 判 "编号贴边" 是对的。） */
		t("V-D6", "「已完成任务」用**同一套两行 + 靠右**逻辑（用户：代办使用一样逻辑）—— 日期贴右边缘、编号在其左同排、描述在上一行",
			doneRow.rows === 2 && Math.abs(doneRow.dateRight - doneRow.itemRight) <= 2
				&& Math.abs(doneRow.idY - doneRow.dateY) <= 2 && doneRow.idRight <= doneRow.dateRight
				&& doneRow.taskY !== null && doneRow.idY > doneRow.taskY
				&& /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+/.test(doneRow.idText),
			doneRow);
	} else { sk("V-D6", "已完成列表取不到条目" + (doneRow && doneRow.missing ? "（诊断：" + JSON.stringify(doneRow) + "）" : "")); }
	await ev(`(function(){var b=document.querySelector('[data-testid=dp-r4-roadmap]');if(b)b.click();return 1;})()`);
	await sleep(220);
} else {
	["V-D1", "V-D2", "V-D3", "V-D4", "V-D5"].forEach((k) => sk(k, "路线图条目取不到（或本机台账为空）"));
	if (r4row && r4row.missing) console.log("      [D 诊断] 行内结构：" + JSON.stringify(r4row));
}

await ensurePage("E");
/* ══ E. R7 关键文件「三行」+ 点击降级可观测 ══ */
console.log("\n══ E. R7 关键文件三行（描述 / 名称 / 路径）+ 点击降级 ══");
/* 🔴 点击段前置：同 B0b —— 覆盖层会把真点吃掉，先证明没有 */
await closeOverlays();
const hpE = await hitProbe();
t("V-E0b", "E 段前置：点击段开始前**无覆盖层**（浮层会吃掉真点 —— 本次 V-E6/E7 时红时绿的真因）",
	!!hpE && hpE.ok === true && hpE.studio === false, hpE);
await ev(`(function(){var b=document.querySelector('[data-testid=dp-r7-files]');if(b)b.click();return 1;})()`);
await sleep(300);
const r7row = await ev(`(function(){
	var body=document.querySelector('[data-testid=dp-r7-body-files]');if(!body)return null;
	var it=body.querySelector('[data-testid=dp-keyfile]');if(!it)return null;
	var nm=it.querySelector('[data-testid=dp-keyfile-name]'), pt=it.querySelector('[data-testid=dp-keyfile-path]');
	var kids=[...it.children].map(function(c){return c.getAttribute('data-testid')||c.tagName;});
	var ri=it.getBoundingClientRect();
	var desc=it.children[0];
	return {count:body.getAttribute('data-count'), root:body.getAttribute('data-root'), rootSrc:body.getAttribute('data-root-src'),
		kids:kids, hasName:!!nm, hasPath:!!pt,
		descY:Math.round(desc.getBoundingClientRect().top), nameY:nm?Math.round(nm.getBoundingClientRect().top):null, pathY:pt?Math.round(pt.getBoundingClientRect().top):null,
		file:it.getAttribute('data-file'), abs:it.getAttribute('data-abs'), dir:it.getAttribute('data-dir'),
		nameText:nm?(nm.textContent||'').trim():null, pathText:pt?(pt.textContent||'').trim():null,
		nameInside:nm?nm.getBoundingClientRect().width<=ri.width+1:null, itemW:Math.round(ri.width)};})()`);
if (r7row && r7row.count !== "0") {
	t("V-E1", "一个关键文件 = **恰好三行**：描述(div) / 名称(button) / 路径(button)，顺序即用户要求",
		r7row.kids.length === 3 && r7row.hasName && r7row.hasPath, { kids: r7row.kids });
	t("V-E2", "🔴 三行纵向**依次排列**：描述.y < 名称.y < 路径.y（真换行，不是挤在一行）",
		r7row.descY < r7row.nameY && r7row.nameY < r7row.pathY, { descY: r7row.descY, nameY: r7row.nameY, pathY: r7row.pathY });
	t("V-E3", "第二行是**名称**（= 仓库相对路径 `src/...`），不是绝对路径",
		/^src\//.test(r7row.nameText || "") && r7row.nameText === r7row.file, { name: r7row.nameText, file: r7row.file });
	t("V-E4", "🔴 第三行是**绝对路径**且与 `data-abs` 同源（「看起来相等 ≠ 同源」：两处都由同一次计算得出）",
		r7row.pathText === r7row.abs && /^[A-Za-z]:\\/.test(r7row.pathText || "") && r7row.pathText.endsWith((r7row.file || "").replace(/\//g, "\\")),
		{ path: r7row.pathText, abs: r7row.abs });
	t("V-E5", "项目根来源被如实标注（`data-root-src` ∈ {env, fallback}）—— 降级来源不隐藏（纪律 19）",
		r7row.rootSrc === "env" || r7row.rootSrc === "fallback", { rootSrc: r7row.rootSrc, root: r7row.root });
	/* 点击名称 ⇒ 真实发生的动作 = 复制路径 + 必然出现的 toast（成功/失败两种文案之一）
	 *  🔴 先清空残留 toast 并**断言已清空**：否则读到的可能是上一条文案（前置不成立就下结论）。 */
	await ev(`(function(){var e=document.querySelector('[data-testid=dp-toast]');if(e)e.click();return 1;})()`);
	await sleep(260);
	const beforeToast = await textOf("[data-testid=dp-toast]");
	const c1 = await clickSelProbe("[data-testid=dp-keyfile-name]");
	await sleep(180);
	const toast1 = await textOf("[data-testid=dp-toast]");
	t("V-E6", "🔴 点「名称」⇒ 真的触发了动作（命中自身）且**给出可读反馈**：文案必须含「已复制」或「复制失败」，不许两者皆无（降级可以，无声不行）",
		beforeToast === null && !!c1.inside && typeof toast1 === "string" && /已复制|复制失败/.test(toast1) && /路径/.test(toast1),
		{ beforeToast: beforeToast, inside: c1.inside, hit: c1.hit, toast: toast1 });
	/* 🔴 点之前**先清掉上一条 toast**：toast 是 2600ms 自动消失的，
	 *    若 E6 的文案还在，E7 读到的可能仍是「文件路径」那条 ⇒ 把"没触发"读成"触发了旧的"。
	 *    清法用产品自己给的入口（`dp-toast` 的 title 写着"点击可清除"）。 */
	await ev(`(function(){var e=document.querySelector('[data-testid=dp-toast]');if(e)e.click();return 1;})()`);
	await sleep(260);
	const t2Before = await textOf("[data-testid=dp-toast]");
	const c2 = await clickSelProbe("[data-testid=dp-keyfile-path]");
	await sleep(180);
	const toast2 = await textOf("[data-testid=dp-toast]");
	t("V-E7", "🔴 点「路径」⇒ 反馈文案指向**文件夹**（与点名称的文案可区分）",
		t2Before === null && !!c2.inside && typeof toast2 === "string" && /文件夹路径/.test(toast2),
		{ beforeCleared: t2Before, inside: c2.inside, hit: c2.hit, toast: toast2 });
	await ev(`(function(){var e=document.querySelector('[data-testid=dp-toast]');if(e)e.click();return 1;})()`);
	await sleep(200);
} else {
	["V-E1", "V-E2", "V-E3", "V-E4", "V-E5", "V-E6", "V-E7"].forEach((k) => sk(k, "R7 关键文件列表取不到（或生成式清单为空）"));
}

await ensurePage("F");
/* ══ F. 收尾复原（闸门不许成为产品的破坏者）══ */
console.log("\n══ F. 收尾复原（闸门不许成为产品的破坏者）══");
/* 🔴 收尾必须**分两步**，顺序不能颠倒（第 1 版把它写成一步，实测假红）：
 *    `setRailPinned(false)` 之后一旦鼠标移开，两栏会**缩回** ⇒ `dp-r4/dp-r7` 从 DOM 消失
 *    ⇒ `box4/box7` 读成 `null` ⇒ `Math.abs(null − 210)` 得 210 直接判失败，
 *    而读数里 store 明明已经正确 —— 是"判据把缩回当成了没还原"。
 *    ⇒ ① 先只还原**宽度**，趁栏还开着读**三面**（store / DOM 属性 / 真实盒宽）；
 *       ② 再还原**钉住态**并让栏按用户的偏好收尾。 */
await ev(`(function(){var s=window.__directorLayoutStore;s.setRailWidth('r4',${ORIG.r4});s.setRailWidth('r7',${ORIG.r7});return 1;})()`);
await sleep(260);
const finW = await readRails();
const boxOk = (r) => !!(r && r.open4 && r.open7)
	&& Math.abs(r.box4 - ORIG.r4) <= 1 && Math.abs(r.box7 - ORIG.r7) <= 1;
t("V-F1", "🔴 收尾①：宽度已还原为**用户原始设置**（不是默认值），且 **store / dp-cols 属性 / 真实盒宽** 三面一致",
	!!finW && finW.store.r4 === ORIG.r4 && finW.store.r7 === ORIG.r7
		&& finW.attr4 === ORIG.r4 && finW.attr7 === ORIG.r7 && boxOk(finW),
	finW && { store: finW.store, attr4: finW.attr4, attr7: finW.attr7, box4: finW.box4, box7: finW.box7, open4: finW.open4, open7: finW.open7, orig: { r4: ORIG.r4, r7: ORIG.r7 } });

/* ② 还原钉住态 + 让栏按用户偏好收尾 */
await ev(`(function(){var s=window.__directorLayoutStore;
	s.setRailPinned('r4',${ORIG.pin.r4 ? "true" : "false"});s.setRailPinned('r7',${ORIG.pin.r7 ? "true" : "false"});return 1;})()`);
await sleep(240);
/* 🔴 只改 store 的 `railPinned` **不会**让已经开着的栏缩回 ——
 *    `railOpen` 是**组件本地 state**，只在鼠标进出时重算。
 *    实测：R4 早在 D 段就被鼠标离开过，当时 `pinned=true` 故 `railLeave` 直接 return；
 *    F 段把 pinned 改成 false 之后**不会再有新的 leave 事件** ⇒ 面板一直开着 ⇒ V-F3 假红。
 *    ⇒ 开合型控件必须**当场显式**开到/关到目标态（点面板头＝同一个 `railTogglePin` 开关）。 */
await shapeRails({ r4: ORIG.pin.r4, r7: ORIG.pin.r7 });
const fin = await readRails();
t("V-F2", "🔴 收尾②：钉住态已还原为**用户原始设置**，不把「两栏都钉住」留给下一套闸门",
	!!fin && fin.pin.r4 === ORIG.pin.r4 && fin.pin.r7 === ORIG.pin.r7,
	fin && { pin: fin.pin, orig: ORIG.pin });
t("V-F3", "🔴 收尾③：栏的收尾形态与用户偏好一致（未钉住 ⇒ 两栏确实缩回；钉住 ⇒ 面板仍在）—— 防「宽度还了、开合没还」",
	!!fin && (ORIG.pin.r4 ? fin.open4 === true : fin.open4 === false)
		&& (ORIG.pin.r7 ? fin.open7 === true : fin.open7 === false),
	fin && { orig: ORIG.pin, open4: fin.open4, open7: fin.open7 });

/* ④ 还原**浮层开合**（闸门为建立干净起点关过它们 ⇒ 必须还回去）—— 纪律 15：
 *    「会写盘/落库」的闸门段必须 快照 → 还原 → 还原断言。`designStudioOpen` 等是持久化字段，
 *    不还的话用户下次打开会少一层（而且浮层是**用户可见的大件**）。 */
await ev(`(function(){var s=window.__directorLayoutStore;
	if(typeof s.setDesignStudio==="function")s.setDesignStudio(${ORIG_OVERLAY && ORIG_OVERLAY.designStudioOpen ? "true" : "false"});
	if(typeof s.setMindmap==="function")s.setMindmap(${ORIG_OVERLAY && ORIG_OVERLAY.mindmapOpen ? "true" : "false"});
	if(typeof s.setDialogOpen==="function")s.setDialogOpen(${ORIG_OVERLAY && ORIG_OVERLAY.dialogOpen ? "true" : "false"});
	return 1;})()`);
await sleep(320);
const finOv = await ev(`(function(){var s=window.__directorLayoutStore;if(!s)return null;var st=s.getState();
	return {designStudioOpen:!!st.designStudioOpen, mindmapOpen:!!st.mindmapOpen, dialogOpen:!!st.dialogOpen};})()`);
t("V-F4", "🔴 收尾④：浮层开合已还原为**用户原始设置**（闸门关过它们 ⇒ 必须还；否则用户下次打开就少一层）",
	!!finOv && !!ORIG_OVERLAY
		&& finOv.designStudioOpen === (ORIG_OVERLAY.designStudioOpen === true)
		&& finOv.mindmapOpen === (ORIG_OVERLAY.mindmapOpen === true)
		&& finOv.dialogOpen === (ORIG_OVERLAY.dialogOpen === true),
	{ after: finOv, orig: ORIG_OVERLAY });

/* ⑤ 把他方浮层 `OrchestratorPanel` 按其**起始状态**放回 ——
 *    闸门为了建立干净起点关过它（本地 state，非 store），**必须还**；
 *    不还就是"闸门改了别人的界面"（纪律 15 的同一条道理）。 */
if (ORCH_ORIG) {
	await ev(`(function(){var b=document.querySelector('[data-testid=dp-orchestrate]');if(b){b.click();return 1;}return 0;})()`);
	await sleep(340);
}
const finOrch = await exists("[data-testid=dp-orch-panel]");
t("V-F5", "🔴 收尾⑤：他方浮层 `OrchestratorPanel` 已按其**起始状态**放回（闸门关过它就必须还；不还＝改了别人的界面）",
	finOrch === ORCH_ORIG, { now: finOrch, orig: ORCH_ORIG });

/* ── 汇总 ── */
console.log("\n───────────────────────────────────────────────");
console.log(" 通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip);
if (failures.length) { console.log(" 失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log(" IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("───────────────────────────────────────────────");
process.exit(fail === 0 ? 0 : 1);
