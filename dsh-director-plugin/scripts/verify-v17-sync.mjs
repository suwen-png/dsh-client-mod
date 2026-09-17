/**
 * verify-v17-sync.mjs —— V17 第1轮审核整改项的**真机逐交互**验证
 *
 * 覆盖（全部真实坐标点击 / 真实 store 流转，不用 DOM.click 假点）：
 *   A. 总监页 R4/R7 缩回栏：悬停 `RAIL_HOVER_MS` 自动展开 · 点击立即展开并钉住 · 钉住偏好持久化
 *      （🔴 第 5 批改写：原 A 段测的 R6 折叠已随 R6 整块去除，锚点 `dp-r6-*` 不再存在）
 *      （🔴 第 6 批：**两个时长从 DOM 读**（`data-rail-hover-ms` / `data-rail-retract-ms`），
 *        改前写死 5400ms —— 产品把闸门压到 500ms 后断言照绿只是白等，属"闸门会过期"）
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
try { await send("Runtime.enable"); } catch (e) { console.log("      [CDP 诊断] Runtime.enable 未确认（不影响断言）：" + String((e && e.message) || e)); }

/* 🔴 真实鼠标的**可见性前提**（第二十四轮统一加装 · 纪律 29/54）
 *    CDP 的 `mousePressed/Released` 在 `document.visibilityState !== "visible"`
 *    （Electron 窗口被遮挡/最小化/停在后台）时会被**整条吞掉**，而 `mouseMoved` 照常送达
 *    ⇒ 表现是「拖不动 / 点了没反应」，读起来完全是**产品坏了**。
 *    🔴 `document.hasFocus()` 在 hidden 时**仍为 true** ⇒ 不能拿它当判据，只认 `visibilityState`。
 *    实测对照：hidden ⇒ 只送达 pointermove；visible ⇒ pointerdown/mousedown/pointerup/click 全到。
 *    不成立 ⇒ 后续鼠标断言**不可信**，应判 INVALID（纪律 24），不判产品红。 */
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


/* 🔴 `ev` **绝不抛穿**（纪律 B）。实测 2026-09-14：并发工作线在跑程中途 kill 掉 Harness
 *    ⇒ `Runtime.evaluate` 超时 ⇒ 未捕获的 `EVAL_TIMEOUT` 把脚本**崩掉**，
 *    其后所有断言**静默丢失**（日志里只剩一段 Node 栈，读起来像"闸门坏了"）。
 *    ⇒ ① 超时重试一次；② 仍不成则探测页面是否还在：
 *         · 页面没了（Harness 被重启）⇒ 明确 INVALID（exit 2）并报出已跑断言数；
 *         · 页面还在（这一帧慢）⇒ 返回 `null`，让断言以"读数缺失"如实报红。 */
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
				console.error("  重跑：node scripts/verify-v17-sync.mjs");
				process.exit(2);
			}
			console.log("      [CDP 诊断] 一次求值失败（页面仍在）⇒ 该断言按读数缺失处理：" + msg);
			return null;
		}
	}
}
const _bail = (why) => (e) => {
	console.error("\nIS_PASS: FALSE（INVALID：" + why + "）");
	console.error("  已跑 " + (pass + fail + skip) + " 条（通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip + "）");
	console.error("  原因：" + String((e && e.stack) || e).split("\n").slice(0, 3).join(" ｜ "));
	console.error("  重跑：node scripts/verify-v17-sync.mjs");
	process.exit(2);
};
process.on("uncaughtException", _bail("未捕获异常"));
process.on("unhandledRejection", _bail("未处理的 Promise 拒绝"));
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
	/* 🔴 第 6 批加固（本函数**从未真正生效过**，本轮实测抓出）：
	 *    旧写法 `(() => !!document.querySelector(fnOrSel))()` 里的 `fnOrSel` 是 Node 侧闭包变量名，
	 *    `toString()` 只拿到源码文本 ⇒ 浏览器端 `ReferenceError` ⇒ `ev` 返回 `{__exc:…}`（truthy）
	 *    ⇒ `waitFor("任意选择器")` **恒真**。也就是说：所有"等某元素出现"的起点断言一直是空的。
	 *    ⇒ 选择器分支改为把值**字面量内联**，且只认**严格 true**（异常按"未就绪"处理并打印原因）。 */
	const expr = (typeof selOrFn === "function")
		? ("(" + selOrFn.toString() + ")()")
		: ("!!document.querySelector(" + JSON.stringify(String(selOrFn)) + ")");
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		const r = await ev(expr);
		if (r === true) return true;
		if (r && r.__exc) { console.log("      [waitFor 诊断] 求值异常 ⇒ 按「未就绪」处理：" + String(r.__exc).slice(0, 140)); return false; }
		await sleep(120);
	}
	return false;
}
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const textOf = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.trim():null;})()`);

/** 从 origin 维度登记一条流转并 hop 到 target 维度（返回 flowId） */
/* 🔴 `pushHop` 必须**自诊断**：原版只 `await ev(...)` 后丢掉返回值。
 *    实测事故：B1/C1 连红，诊断显示 `lastDims:["director"]` —— 流转建了、但
 *    `store.move()` 的足迹**没写进去**。原版在这里完全静默（`ev` 命中异常只返回
 *    `{__exc}` 而不抛），于是"move 抛了 / move 不存在 / 目标维度非法"三种原因
 *    读数一样，全都被记成"未读点没亮"（产品）。
 *    ⇒ 改为一律回读并回报：push 是否成、move 是否回对象、足迹最终含不含目标维度。
 *      异常也当结果带回来（`try/catch`），**永不静默**（纪律 19）。 */
async function pushHop(origin, target, tag) {
	const r = await ev(`(function(){
		try{
			var A=window.__dshFlow; if(!A) return {err:"no-flow-api"};
			var f=A.store.push(${JSON.stringify(tag + " " + Date.now())},{origin:${JSON.stringify(origin)},note:"v17-sync"});
			if(!f) return {err:"push-null"};
			if(typeof A.store.move!=="function") return {err:"no-move-api",pushed:f.flowId};
			var mv=A.store.move(f.flowId,${JSON.stringify(target)},"送"+${JSON.stringify(target)});
			return {id:f.flowId,moved:mv?mv.flowId:null,dims:mv?A.flowDims(mv):null};
		}catch(e){ return {err:String(e&&e.message)}; }
	})()`);
	if (!r || r.err || !r.dims || r.dims.indexOf(target) < 0) {
		console.log("      [pushHop 诊断] " + JSON.stringify({ origin: origin, target: target, tag: tag, 结果: r }));
	}
	return r;
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
/* 🔴 第 6 批加固（真机实测的**假红**，不是产品缺陷）：`dp-root` **出现** ≠ 缩回栏链路**就绪**。
 *    重启后首跑实测 A0–A4 集体红、A5–A8 却绿；随后 3 连跑 27/0/0 全绿。
 *    ⇒ 典型「起点未等价」（纪律：偶发红**先查起点**，不要先查产品）。
 *    开 A 段前多等一手：第 6 批新增的 `data-rail-hover-ms`（渲染期必在）与
 *    `data-rail-r4` 同时可读，才认为页面真的可用。
 *  🔴 这里**必须传函数**：`waitFor` 的第二参只认函数，传字符串会被当 CSS 选择器塞进
 *    `querySelector` ⇒ 非法选择器抛异常 ⇒ `ev` 返回 `{__exc:…}`（truthy）⇒ **立刻判成功**，
 *    等于这个起点断言从来没生效。 */
const dpReady = await waitFor("[data-testid=dp-root]", 8000)
	&& await waitFor(() => {
		const p = document.querySelector('[data-testid=dp-root]');
		return !!(p && p.getAttribute('data-rail-hover-ms') && p.getAttribute('data-rail-r4'));
	}, 4000);
console.log("开场：总监页挂载=" + dpReady);

console.log("\n══ A. 总监页 R4/R7 缩回栏（悬停展开 · 点击钉住 · 持久化）══");
/* 🔴 第 5 批整段改写：原 A 段测 R6 折叠（`dp-r6-toggle` / `dp-r6-summary`）
 *    —— R6 已整块去除（有效数据并入 R2），两个锚点都不再存在。
 *    新 A 段锁 R4/R7 缩回栏这条**新链路**的三件事：悬停自动展开 / 点击钉住 / 偏好持久化。
 *    判据同时落在 DOM 属性（`data-rail-*`）、store（`railPinned`）与 localStorage 三处，
 *    且显式要求"store 与 localStorage **同源**"，而不是各读一个数就下结论。 */
if (dpReady) {
	const railState = () => ev(`(function(){var r=window.__directorLayoutStore.getState();var p=document.querySelector('[data-testid=dp-root]');
		return {pin:(r.railPinned||{}),ra4:p?p.getAttribute('data-rail-r4'):null,ra7:p?p.getAttribute('data-rail-r7'):null,pa:p?p.getAttribute('data-rail-pinned'):null};})()`);
	/* 起点显式建立：先把 r4/r7 都归零（不赌上一轮留下什么）。
	 * ⚠️ 钉住时缩回栏 `dp-rail-*` **不在 DOM**（面板取代了它）⇒ 只能用面板头 `dp-r4-toggle` 取消。 */
	let s = await railState();
	for (let i = 0; i < 4 && s && (s.pin.r4 || s.pin.r7); i++) {
		if (s.pin.r4) { await clickSelProbe("[data-testid=dp-r4-toggle]"); await sleep(240); }
		if (s.pin.r7) { await clickSelProbe("[data-testid=dp-r7-toggle]"); await sleep(240); }
		s = await railState();
	}
	t("A0", "起点显式建立：r4/r7 均未钉住，两栏都在缩回态（data-rail-*=in）",
		!!s && s.pin.r4 === false && s.pin.r7 === false && s.ra4 === "in" && s.ra7 === "in", s);

	const probeA = await clickSelProbe("[data-testid=dp-rail-r4]");
	if (!probeA.ok || !probeA.inside) console.log("      [A 诊断] 缩回栏点击命中：" + JSON.stringify(probeA));
	const s1 = await railState();
	t("A1", "点缩回栏 ⇒ 立即展开并钉住（railPinned.r4=true 且 data-rail-r4=open）",
		!!s1 && s1.pin.r4 === true && s1.ra4 === "open" && s1.pa === "r4", s1);
	t("A2", "🔴 钉住偏好已持久化到 localStorage，且与 store **同源**（两处读同一个值）",
		await ev(`(function(){try{var l=JSON.parse(localStorage.getItem('dsh.director.layout'));var q=window.__directorLayoutStore.getState();return l.railPinned.r4===true&&l.railPinned.r4===q.railPinned.r4;}catch(e){return false;}})()`));
	t("A3", "R4/R7 各自独立：钉住 r4 不连带 r7",
		!!s1 && s1.pin.r7 === false && s1.ra7 === "in", s1);

	/* 面板头 `dp-r4-toggle` 与缩回栏 `dp-rail-r4` 必须是**同一个开关**（都走 railTogglePin） */
	const probeB = await clickSelProbe("[data-testid=dp-r4-toggle]");
	if (!probeB.ok || !probeB.inside) console.log("      [A 诊断] 面板头点击命中：" + JSON.stringify(probeB));
	const s2 = await railState();
	t("A4", "点面板头 dp-r4-toggle ⇒ 取消钉住并缩回（与缩回栏同一开关，不是两套状态）",
		!!s2 && s2.pin.r4 === false && s2.ra4 === "in" && s2.pa === "", s2);

	/* ── 悬停自动展开 / 移开自动缩回 ────────────────────────────────────────────
	 *  🔴 第 6 批：**两个时长都从 DOM 读**（`data-rail-hover-ms` / `data-rail-retract-ms`），
	 *     不再写死 `sleep(5400)` / `sleep(1000)`。
	 *     改前写死 5400ms 而产品是 5000ms —— 本轮产品把悬停闸压到 500ms 后，这条断言
	 *     **仍然是绿的**，只是白等 5 秒（且注释还写着"悬停 5 秒"）。
	 *     这正是纪律 14「闸门自己会过期」的温床：**产品改多少，闸门就该等多少**。
	 *     读不到两个数 ⇒ 判 SKIP 并**报出原因**（纪律 18：跳过必须带可分辨原因，不许静默）。 */
	const railBox = await ev(`(function(){var e=document.querySelector('[data-testid=dp-rail-r4]');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+26)};})()`);
	const railMs = await ev(`(function(){var p=document.querySelector('[data-testid=dp-root]');if(!p)return null;return {hover:Number(p.getAttribute('data-rail-hover-ms')),retract:Number(p.getAttribute('data-rail-retract-ms'))};})()`);
	if (railBox && railMs && Number.isFinite(railMs.hover) && railMs.hover > 0 && Number.isFinite(railMs.retract) && railMs.retract > 0) {
		mouse("mouseMoved", railBox.x, railBox.y, 0);
		await sleep(railMs.hover + 400);
		const s3 = await railState();
		t("A5", "🔴 悬停 " + railMs.hover + "ms（**从 DOM `data-rail-hover-ms` 读**，不写死）自动展开，且期间**未**钉住（悬停与钉住是两件事）",
			!!s3 && s3.ra4 === "open" && s3.pin.r4 === false, s3);
		const away = await ev(`(function(){var e=document.querySelector('[data-testid=dp-root]');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height-8)};})()`);
		if (away) { mouse("mouseMoved", away.x, away.y, 0); await sleep(railMs.retract + 400); }
		const s4 = await railState();
		t("A6", "移开后 " + railMs.retract + "ms（**从 DOM `data-rail-retract-ms` 读**）自动缩回（收尾复原，不把展开态留给下一段）",
			!!s4 && s4.ra4 === "in" && s4.pin.r4 === false, s4);
	} else if (!railBox) {
		sk("A5", "缩回栏取不到几何，悬停段");
		sk("A6", "缩回栏取不到几何，悬停段");
	} else {
		sk("A5", "dp-root 未给出可用的 data-rail-hover-ms，悬停段**无法自我校准**（不赌默认值）");
		sk("A6", "dp-root 未给出可用的 data-rail-retract-ms，缩回段**无法自我校准**");
	}

	/* ── A7 / A8：V18 板块 E1 的两半判据（第 5 批收口）─────────────────────────
	 *  E1 目标原文：「R4 / R7 向右/向左缩回，**只留一个箭头**；展开时 height:100% 上下占满」，
	 *  配图注：「缩进后只剩一个箭头按钮；展开态与对话区等高（align-items:stretch）」。
	 *  🔴 A7 为什么用**等值断言**而不是"不含竖排文字"：后者是负向断言，写不好会变成空真
	 *     （rail 整个没渲染出来也"不含竖排文字"）。写成"可见文本恰好等于箭头这一个字符"
	 *     就自带反例保护 —— 空 rail、多字 rail、错字符 rail 全都会红。
	 *  🔴 A8 为什么必须配**下限**：两个都取到 0 高度时"相等"对谁都成立（平凡真）⇒
	 *     先要求 `R5 > 100` 且 `rail > 100`，再比差值。 */
	const railE1 = await ev(`(function(){
		var rail=document.querySelector('[data-testid=dp-rail-r4]');
		var r5=document.querySelector('[data-testid=dp-r5]');
		if(!rail||!r5)return null;
		var arrow=document.querySelector('[data-testid=dp-rail-r4-arrow]');
		var rb=rail.getBoundingClientRect(), qb=r5.getBoundingClientRect();
		var cs=getComputedStyle(rail);
		return {text:(rail.textContent||'').trim(), textLen:(rail.textContent||'').trim().length,
			arrowText:arrow?(arrow.textContent||'').trim():null,
			childEls:rail.children.length,
			writingMode:cs.writingMode||'', display:cs.display,
			railH:Math.round(rb.height), r5H:Math.round(qb.height)};
	})()`);
	if (!railE1) {
		sk("A7", "缩回栏或 R5 取不到，E1 段");
		sk("A8", "缩回栏或 R5 取不到，E1 段");
	} else {
		t("A7", "🔴 E1：缩回栏**只剩一个箭头**（可见文本恰为 1 个箭头字符 · 无竖排标题文字）",
			railE1.textLen === 1 && railE1.text === "›" && railE1.arrowText === "›"
				&& railE1.writingMode !== "vertical-rl" && railE1.writingMode !== "vertical-lr",
			railE1);
		t("A8", "🔴 E1：缩回栏与 R5 对话区**等高**（对齐靠 stretch 撑满，非写死高度）—— 含下限防平凡真",
			railE1.railH > 100 && railE1.r5H > 100 && Math.abs(railE1.railH - railE1.r5H) <= 2,
			{ railH: railE1.railH, r5H: railE1.r5H, 差: Math.abs(railE1.railH - railE1.r5H) });
	}
} else { sk("A*", "总监页未挂载，缩回栏段"); }

console.log("\n══ B. 思维导图：关闭期未读点 + 打开期同步 toast ══");
/* 🔴 本段（B1/C1/F1/F2）在 2026-09-14 第 6 批**首次真正生效**：
 *    `waitFor` 修好之前它**恒真**，所以「等某元素出现」这类断言一直没在判分。
 *    加固后立刻报红 ⇒ 必须能回答"是产品坏了还是前置不成立"。故此处把
 *    FloatDock 的**未读点前置条件**一次读全：dock 是否在、浮层开合、流转条数、
 *    最近一条 mindmap 流转的 id（`seenRef` 只认"比它更新"的流转）。 */
/* 🔴 口径必须用**产品自己的函数**（`A.flowDims` / `A.hasNewFlowFor`）。
 *    上一版用 `f.to` / `f.dims` 字段自己算 —— 而 `flowDims` 认的是 `flow.trail[].dim`
 *    ⇒ 读出 `lastMM:null` 是**假读数**（尺子量错容器），差点据此去改产品。 */
const FLOWSNAP = `(function(){
	var st=window.__directorLayoutStore.getState();
	var A=window.__dshFlow; var flows=A?A.store.getState().flows:[];
	var dims=function(f){try{return A.flowDims(f);}catch(e){return ["ERR"];}};
	var last=flows.length?flows[flows.length-1]:null;
	var lastMM=null;
	for(var i=flows.length-1;i>=0;i--){ if(lastMM===null && dims(flows[i]).indexOf('mindmap')>=0) lastMM=flows[i].flowId; }
	return {dockMM:!!document.querySelector('[data-testid=d-open-mindmap]'),
		dockDS:!!document.querySelector('[data-testid=d-open-design]'),
		mmOpen:!!st.mindmapOpen, dsOpen:!!st.designStudioOpen, dlgOpen:!!st.dialogOpen,
		flows:flows.length, lastMM:lastMM,
		lastDims:last?dims(last):null,
		hasNewAsNull:last?A.hasNewFlowFor(flows,'mindmap',null):null,
		hasNewAsLastMM:last?A.hasNewFlowFor(flows,'mindmap',lastMM):null};})()`;
await closeAllOverlays();
await sleep(200);
/* 🔴 **未读点的前提是 FloatDock 已完成首次挂载**（2026-09-14 实证，非产品缺陷）：
 *    `FloatDock` 首挂时把"**当时已有**的流转"全部视为已读（不为旧数据亮点）。
 *    本闸门开头 `localStorage.removeItem('dsh.director.flow') + location.reload()`，
 *    而 dock 是**量到宿主 composer 之后**才挂的（自适应避让），比 reload 晚若干秒。
 *    实测对照：
 *      · reload 后 +3.5s 立刻 push ⇒ 点**不亮**（push 的这条被当成"历史"）；2.5s 后再 push ⇒ 点亮。
 *      · 不 reload 时同一段代码 ⇒ 点亮。
 *    ⇒ 本段起点必须**显式等 dock 就位**并断言，否则量到的是"起点没建立"而不是产品（纪律 23）。
 *    ⚠️ 这也解释了 B1/C1 曾经的"绿"：旧 `waitFor` 恒真，这条前提从来没被真的判过。 */
const dockReady = await waitFor("[data-testid=d-open-mindmap]", 9000);
await sleep(700);
t("B0p", "前提：FloatDock **已完成首次挂载**（未读点判据的基线在挂载时建立；太早 push 会被当成历史流转）",
	dockReady === true, { dockReady: dockReady });
const b0snap = await ev(FLOWSNAP);
t("B0", "干净基线：当前无导图未读点", !(await exists("[data-testid=d-unread-mindmap]")), b0snap);
await pushHop("director", "mindmap", "B-关闭期到达");
const b1 = await waitFor("[data-testid=d-unread-mindmap]", 1600);
t("B1", "导图关闭期间流转到达 ⇒ FloatDock 导图按钮亮未读点", b1, await ev(FLOWSNAP));
/* 🔴 用**带命中诊断**的点击 + 一次重试：本机 CDP 的按下/抬起偶发被"页面激活"那一下吃掉
 *    （实测同一实例同一坐标一次成一次不成）。旧写法 `clickSel` 不校验命中也不重试
 *    ⇒ 失败读数只有 `mmReady:false`，**分不出"按钮被遮住"与"事件没送达"与"产品坏了"**
 *    （纪律 23：前提与结果不能混在一条里）。 */
let mmHit = null, mmReady = false;
for (let k = 1; k <= 2 && !mmReady; k++) {
	mmHit = await clickSelProbe("[data-testid=d-open-mindmap]");
	mmReady = await waitFor("[data-testid=mm-root]", 2400);   // 按**结果**重试，不按命中
	if (!mmReady) await sleep(420);
}
await sleep(650);
t("B2", "打开导图后未读点清除（已读）", mmReady && !(await exists("[data-testid=d-unread-mindmap]")), { mmReady: mmReady, 命中: mmHit });
// 打开期间再从别的维度流转到导图 ⇒ 应轻提示
const b3info = await ev(`(function(){var A=window.__dshFlow;if(!A)return {noApi:true};var f=A.store.push(${JSON.stringify("B-打开期到达 ")}+Date.now(),{origin:"director",note:"v17-sync"});if(!f)return {nullFlow:true};A.store.move(f.flowId,"mindmap","送mindmap");var g=A.store.getState().flows.find(x=>x.flowId===f.flowId);return {id:f.flowId,found:!!g,dims:g?A.flowDims(g):null,total:A.store.getState().flows.length};})()`);
if (!b3info || !b3info.found) console.log("      [B3 push] " + JSON.stringify(b3info));
const idB3 = b3info && b3info.id;
const toastB = await waitFor(() => /已同步到思维导图/.test(document.querySelector("[data-testid=mm-toast]")?.textContent || ""), 2200);
if (!toastB) console.log("      [B3 诊断] " + await ev(`(function(){var t=document.querySelector('[data-testid=mm-toast]');var A=window.__dshFlow;var f=A.store.getState().flows.find(x=>x.flowId===${JSON.stringify(idB3)});return JSON.stringify({toast:t?t.textContent:null,hitDims:f?A.flowDims(f):'FLOW_NOT_FOUND',mmRoot:!!document.querySelector('[data-testid=mm-root]')});})()`));
t("B3", "导图打开期间外维流转到达 ⇒ mm-toast「已同步到思维导图」", toastB);
await clickSel("[data-testid=mm-close]"); await sleep(650);
/* 🔴 B2 没打开时，"关掉之后导图不在 DOM"是**平凡真**（纪律 29）⇒ 前提不成立就带原因跳过。 */
if (!mmReady) sk("B4", "B2 未打开导图 ⇒「mm-close 是否生效」的前提不成立（不是产品缺陷）");
else t("B4", "mm-close 关闭导图", !(await exists("[data-testid=mm-root]")));

console.log("\n══ C. 设计图：未读点 + 同步 toast + 更多菜单 Esc/外部关闭 ══");
await closeAllOverlays();
/* C 段沿用 B 段同一前提（FloatDock 已挂载 ⇒ 未读基线已建立）。B 段末尾关过导图，
 * 这里再断一次，防"上一段把 dock 搞没了"这类串扰。 */
await waitFor("[data-testid=d-open-design]", 6000);
await sleep(400);
await pushHop("director", "design", "C-关闭期到达");
const c1 = await waitFor("[data-testid=d-unread-design]", 1600);
t("C1", "设计图关闭期间流转到达 ⇒ 设计图按钮亮未读点", c1, await ev(FLOWSNAP));
let dsHit = null, dsReady = false;
for (let k = 1; k <= 2 && !dsReady; k++) {
	dsHit = await clickSelProbe("[data-testid=d-open-design]");
	dsReady = await waitFor("[data-testid=ds-root]", 2400);
	if (!dsReady) await sleep(420);
}
await sleep(650);
t("C2", "打开设计图后未读点清除", dsReady && !(await exists("[data-testid=d-unread-design]")), { dsReady: dsReady, 命中: dsHit });
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
