#!/usr/bin/env node
/**
 * verify-flow.mjs — 真机验证：总监页（原生对话框）/ 右上角个性化 / 导图单框控件与拖动 / 四维流转跟随
 *
 * ══════════════════════════════════════════════════════════════════
 *  这个脚本对应的是用户本轮的**五组原话**，逐组落到可判定的动作上
 * ──────────────────────────────────────────────────────────────────
 *  「总监 tab 页面下面你加了一个对话框，不要这个对话框，用原本的对话框」
 *      → A 段：R8 里不许有自建 input；**原生 composer 必须仍在且可见**；
 *        点「⌨ 聚焦原生对话框」后 `document.activeElement` 必须真的落到它身上。
 *  「对话逻辑就是点到哪里往哪里输入和沟通」
 *      → A 段：焦点条三键（目标=总监 / 目标=对话 / 聚焦原生）逐个**真实点击**并验状态迁移。
 *  「都在右上角加自定义个性化设定」
 *      → B 段：总监页 / 导图 / 设计图三处逐个真实点击开面板，`data-scope` 必须各自正确；
 *        并断言 `--dp-ac`、`data-dp-texture`、`.dp-textured` 的 computed background-image
 *        ——**最后这条才是"质感真的显示了"的判据**（只看属性变没变会被"改了但没渲染"骗过）。
 *  「思维导图的单个框没有展开和折叠的选项」/「框不能动需要可以移动」
 *      → C 段：每个框都必有 toggle 元素（含无子框，只是 enabled=0）；真实点击折叠；
 *        真实拖动框 ⇒ 位置变 **且连线起点跟着变**（只验位置会漏掉"线脱节"）。
 *  「点击框在右侧展开对话，对话的最上面是现在正在做的事情」
 *      → C 段：真实点击 💬 ⇒ 面板出现；并用**文档序 + 真实几何**双判据断言
 *        `nd-now` 排在流转条目 / 输入条之前（不是"存在"就行，也不是比"第一个直接子节点"）。
 *  「保证同一个消息能在上面几个维度进行流转」/「点击左侧切进去就是和当前对话有关的流转信息」
 *      → D 段：**走真实界面路径**（往原生输入框写标记 → 真实点注入条「登记流转」）⇒
 *        R5 里必须出现那段标记；再 `move` 到导图维 ⇒ R5 徽标两个都亮；
 *        导图右侧面板里也要读得到同一条；最后**真实点左侧另一个会话** ⇒ MARK 从 R5 消失。
 *  「总监tap页面的背景采用原软件的背景 保持风格统一」
 *      → F 段：判据不是「看起来像」而是**同一个令牌** —— 总监页根节点的 backgroundColor
 *        计算值必须等于宿主原生页签 .RWZidW_root；再用**正负对照**（临时改宿主
 *        --dsw-alias-bg-base ⇒ 总监页立刻跟着变 ⇒ 恢复后回原值）证明二者读的是同一个
 *        变量，而不是各写一份色值抄了个像的。另加客观亮度扫描，防「改了一半」的深色漏网。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 三条纪律（本项目反复吃亏后定下的）
 * ──────────────────────────────────────────────────────────────────
 *  ① **坐标现取现用**：每次点击前重新量 rect。一次采集全部坐标会在"点一下布局就变"的
 *     界面上产生**假故障**（按钮跑了，不是坏了）——cdp-mouse.mjs 头注里有完整记录。
 *  ② **点击前先做命中测试**：`document.elementFromPoint` 必须落在目标或其子孙上。
 *     `element.click()` 不看遮挡，本脚本全程用 `Input.dispatchMouseEvent`。
 *  ③ **负向断言也要精确**：A3「R8 里没有自建输入框」限定在 `dp-r8` 子树内，
 *     不是全页搜 —— 全页搜会把原生 composer 本身当成"自建输入框"而误判。
 *  ④ **CDP 派发超时要记账，不能抛穿**：渲染进程被顶死时 `Input.dispatchMouseEvent`
 *     会挂住 8s 后超时。第 7 次真机跑就因为没兜底，异常抛穿顶层 await，
 *     已经跑出来的 45 条断言**全丢**。现在统一记进 `cdpTimeouts`，收尾由 E2 断言，
 *     非零即判 INVALID（渲染进程无响应 ≠ 产品失败），退出码 2。
 *  ⑤ **拖动步间留间隔**：8 个指针事件零间隔连发比真人"拖"硬得多。
 *
 * 用法：node scripts/verify-flow.mjs        # 需要 Harness 已启动且开着 --remote-debugging-port=9222
 * 退出码：0 全绿 / 1 有失败 / 2 INVALID（含 CDP 连不上 —— 判目标错，不判产品错）
 */
const PORT = 9222;
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══ CDP 连接 ══
 * 🔴 2026-09-14 补（纪律 17：用错目标必须自诊断，不许崩成"产品坏了"）：
 *    原先 Harness 未启动时这里直接抛 `TypeError: fetch failed` + ECONNREFUSED 崩栈，
 *    读起来像脚本/产品坏了，实际只是**目标没开**。⇒ 判 INVALID(2)，不判 FAIL(1)。 */
let pages;
try {
	pages = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=9222 启动。");
	console.error("  正确用法（必须后台启动，且清掉两个环境变量）：");
	console.error("    powershell -File scripts/restart-harness.ps1");
	console.error("    node scripts/verify-flow.mjs");
	process.exit(2);
}
const page = pages.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const pageErrors = [];
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
		pageErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
	}
	if (m.method === "Log.entryAdded" && m.params.entry.level === "error") pageErrors.push(String(m.params.entry.text).slice(0, 200));
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
/** CDP 调用硬超时（毫秒）。
 * 🔴 为什么必须有：本脚本第一次真机跑**把渲染进程挂死了** ——
 *    浏览器进程还能回 HTTP（/json/list 正常），但 `Runtime.evaluate` 永不返回，
 *    于是脚本静默跑了 8 分 47 秒、一个断言都没输出。
 *    没有超时的"等待"等于**把挂死伪装成正在跑**；加上之后，挂死会立刻变成一条可读的失败。 */
const CALL_TIMEOUT = 8000;
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	const timer = setTimeout(() => {
		pending.delete(id);
		rej(new Error("CDP_TIMEOUT " + method + "（渲染进程 ${CALL_TIMEOUT}ms 内未响应 ⇒ 主线程可能被同步循环占住）".replace("${CALL_TIMEOUT}", String(CALL_TIMEOUT))));
	}, CALL_TIMEOUT);
	pending.set(id, {
		res: (v) => { clearTimeout(timer); res(v); },
		rej: (e) => { clearTimeout(timer); rej(e); }
	});
	ws.send(JSON.stringify({ id, method, params }));
});
/* fire-and-forget（不等 CDP 响应）。
 * 🔴 实测本 Electron 环境 Input.dispatchMouseEvent/KeyEvent 的**响应**稳定延迟约 5s，而事件本身
 * 立即送达页面（对照 Runtime.evaluate 仅 2ms）。若每次指针事件都 await 响应：一次 click 串行
 * moved/pressed/released 要 15s，F10/F11 这类时序敏感断言必被拖垮，渲染繁忙时还会堆出 CDP_TIMEOUT
 * 假 INVALID。故所有 Input 派发只发不等（WebSocket 保序），事件是否生效一律由后续 ev() 回读验证；
 * 渲染进程是否真卡死也由 ev()（Runtime.evaluate 8s 超时）来探测，不依赖 Input 响应。 */
const emit = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); };
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
await send("Log.enable");

const J = JSON.stringify;
async function ev(expr) {
	try {
		const out = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
		if (out.exceptionDetails) return { __err: out.exceptionDetails.text + " " + (out.exceptionDetails.exception?.description || "") };
		return out.result?.value;
	} catch (e) {
		/* 渲染进程挂死时不抛穿整个脚本：记成可读错误，让后续断言继续报（而不是一个断言都没有） */
		return { __err: String((e && e.message) || e) };
	}
}
/** 交互原语的兜底：任何 CDP 超时都不应该让整段静默终止 */
async function safe(fn, ...a) {
	try { return await fn(...a); } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
}

/* ══ 结果收集 ══ */
let pass = 0, fail = 0, skip = 0; const failures = [], skips = [];
function check(id, name, cond, detail) {
	if (cond === "SKIP") { skip++; skips.push(id + " " + name + (detail ? " —— " + detail : "")); console.log("  ⏭  " + id + " " + name + (detail ? "  |  " + detail : "")); return; }
	if (cond) { pass++; console.log("  ✅ " + id + " " + name + (detail !== undefined ? "  |  " + detail : "")); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + "  |  " + (detail === undefined ? "(无详情)" : detail)); }
}
function section(s) { console.log("\n" + s); }

/* ══ 交互原语（全部走真实鼠标） ══ */
async function rectOf(sel) {
	return ev("(()=>{const e=document.querySelector(" + J(sel) + ");if(!e)return null;const r=e.getBoundingClientRect();"
		+ "if(r.width<1||r.height<1)return {zero:true,w:Math.round(r.width),h:Math.round(r.height)};"
		+ "return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2)};})()");
}
async function rectOfText(sel, text) {
	return ev("(()=>{const L=Array.from(document.querySelectorAll(" + J(sel) + "));"
		+ "const e=L.find(x=>String(x.textContent||'').trim()===" + J(text) + ");if(!e)return null;"
		+ "const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return {zero:true};"
		+ "return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2)};})()");
}
/** 命中测试：返回该点上最上层的元素，以及它是否属于目标 */
async function hitAt(sel, x, y) {
	return ev("(()=>{const t=document.querySelector(" + J(sel) + ");const e=document.elementFromPoint(" + x + "," + y + ");"
		+ "if(!e)return {ok:false,top:null};"
		+ "return {ok: Boolean(t) && (t===e || t.contains(e)), top:(e.getAttribute&&e.getAttribute('data-testid'))||e.tagName};})()");
}
/* ══ CDP 调用超时账本 ══
 * 🔴 为什么要有这本账：第 7 次真机跑时渲染进程卡死，`Input.dispatchMouseEvent` 抛了
 *    CDP_TIMEOUT —— 但 `mouse()` 当时没有兜底，异常直接抛穿顶层 await，
 *    **整轮 45 条断言已经跑出来的结果全部丢失**，进程只留一个堆栈。
 *    "静默卡住"和"结果丢失"是同一类事故：都不能让它们伪装成正常结束。
 *    ⇒ 所有指针/键盘派发统一记账：超时记一条、继续跑；收尾用 E2 断言"零超时"，
 *      并在超时非零时把整轮判为 INVALID（渲染进程无响应 ⇒ 结果不可信，不是产品失败）。 */
const cdpTimeouts = [];

/* ══════════════════════════════════════════════════════════════════════════
 *  闸门自身异常兜底（2026-09-14 补，与 `verify-mindmap` / `verify-v20` **同一套约定**）
 *
 *  为什么必须补（本轮实测踩到，且**是本项目登记过的同类事故的第 2 次**）：
 *    渲染进程主线程被占住时，`ev()` 不再抛错，而是**返回 `{__err: "CDP_TIMEOUT …"}`**。
 *    调用方若把它当数组用，就会在**深层**炸出 `TypeError: arr.filter is not a function`，
 *    而顶层没有兜底 ⇒ 进程只留一个堆栈，**后面所有断言一条都没跑，也没人知道**。
 *    现场：本轮 D5 之后直接崩在 L1143，其后 D6/D7 + 收尾段全部丢失。
 *    台账（二）真因 #1 记的就是同类（`null` 解引用把 600 行处打哑，其后 100+ 条断言丢失）。
 *
 *  ⇒ 兜住任何未捕获异常 / 未处理拒绝：把**已经跑出来的**结果 + "其后未跑"明确打出来，
 *     并以 **exit 2（INVALID）** 收尾。「脚本自己死了 ≠ 产品不合格」（纪律 17）。
 *     `cdpTimeouts` 的非零检查保不住这种情况 —— 崩溃时根本走不到收尾段。 */
let reachedFlowFinal = false;
const dieReport = (why) => {
	console.error("\n───────────────────────────────────────────────");
	console.error(" ❌ INVALID：脚本异常终止 —— " + why);
	console.error(` 已跑出：通过 ${pass} / 失败 ${fail} / 跳过 ${skip}（合计 ${pass + fail + skip}）`);
	console.error(` 是否已到达收尾段：${reachedFlowFinal}`);
	console.error(` CDP 派发超时累计：${cdpTimeouts.length} 次（非 0 高度提示"渲染进程被占住"是根因）`);
	if (failures.length) console.error(" 期间失败项：\n   - " + failures.join("\n   - "));
	console.error(" 其后段落**一条都没跑** ⇒ 不得据此判定产品好坏。");
	console.error(" 处置：重启 Harness 重跑（本工具会话下须**同一条命令内**先启动再测）。");
	console.error("───────────────────────────────────────────────");
	process.exit(2);
};
process.on("uncaughtException", (e) => dieReport("uncaughtException：" + ((e && e.stack) || e)));
process.on("unhandledRejection", (e) => dieReport("unhandledRejection：" + ((e && (e.stack || e.message)) || e)));

async function mouse(type, x, y, buttons) {
	// fire-and-forget：Input 事件立即送达、响应却延迟约 5s（理由见 emit 定义），绝不 await 响应。
	// 渲染进程是否卡死由后续 ev()（Runtime.evaluate）探测，不再靠 Input 响应记账。
	emit("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: buttons || 0, clickCount: type === "mouseMoved" ? 0 : 1 });
}
/** 真实点击（含命中测试；坐标现取现用） */
async function click(sel) {
	let r = await rectOf(sel);
	if (!r || r.zero) return { ok: false, why: "未找到或零尺寸 " + sel };
	let hit = await hitAt(sel, r.cx, r.cy);
	/* 🔴 2026-09-12 加固：**落点必须在视口内且命中自己**（真实鼠标事件打在视口外＝什么都没点）。
	 *   真机实测（r21 C12）：导图里框被前一段的拖动/小地图滚走 ⇒ 💬 按钮的坐标落在视口外
	 *   ⇒ `elementsFromPoint` 返回空、点击打在空气上 ⇒ C12–C17 **六条级联红**，
	 *   而它们报的是"面板没出现 / Esc 把导图关了"这类**看起来像产品坏了**的现象。
	 *   （导图那一套脚本早就有 `focusVisibleNode()` 处理同一件事，这里之前漏了。）
	 *   做法：先把元素滚进可视区再量一次；`scrolled` 打进明细，便于和"真的点不中"区分。 */
	let scrolled = false;
	if (!hit.ok || !hit.top) {
		const did = await ev("(()=>{const e=document.querySelector(" + J(sel) + ");if(!e)return false;"
			+ "try{ e.scrollIntoView({block:'center',inline:'center'}); }catch(err){ try{e.scrollIntoView();}catch(e2){} }"
			+ "return true;})()");
		if (did) {
			await WAIT(320);
			const r2 = await rectOf(sel);
			if (r2 && !r2.zero) { r = r2; hit = await hitAt(sel, r.cx, r.cy); scrolled = true; }
		}
	}
	await mouse("mouseMoved", r.cx, r.cy, 0);
	await WAIT(15);
	await mouse("mousePressed", r.cx, r.cy, 1);
	await WAIT(30);
	await mouse("mouseReleased", r.cx, r.cy, 0);
	await WAIT(15);
	return { ok: true, x: r.cx, y: r.cy, occluded: !hit.ok, top: hit.top, scrolled: scrolled };
}
async function clickText(sel, text) {
	const r = await rectOfText(sel, text);
	if (!r || r.zero) return { ok: false, why: "未找到文案为 " + text + " 的 " + sel };
	await mouse("mouseMoved", r.cx, r.cy, 0);
	await WAIT(15);
	await mouse("mousePressed", r.cx, r.cy, 1);
	await WAIT(30);
	await mouse("mouseReleased", r.cx, r.cy, 0);
	await WAIT(15);
	return { ok: true, x: r.cx, y: r.cy };
}
/** 真实拖动：按下 → 多步移动 → 抬起（单步跳跃不会触发 pointermove 阈值判定）
 * ⚠️ 步与步之间留一点间隔：原来 8 个事件零间隔连发，比真人"拖"更硬，
 *    实测第 7 次真机跑就是在这条路径上把渲染进程顶死的。真人拖动每步都有几毫秒间隔。 */
async function drag(sel, dx, dy) {
	const r = await rectOf(sel);
	if (!r || r.zero) return { ok: false, why: "未找到或零尺寸 " + sel };
	const hit = await hitAt(sel, r.cx, r.cy);
	await mouse("mouseMoved", r.cx, r.cy, 0);
	await WAIT(15);
	await mouse("mousePressed", r.cx, r.cy, 1);
	await WAIT(15);
	for (let i = 1; i <= 6; i++) {
		await mouse("mouseMoved", Math.round(r.cx + (dx * i) / 6), Math.round(r.cy + (dy * i) / 6), 1);
		await WAIT(18);
	}
	await mouse("mouseReleased", Math.round(r.cx + dx), Math.round(r.cy + dy), 0);
	await WAIT(15);
	return { ok: true, from: r, occluded: !hit.ok, timeouts: cdpTimeouts.length };
}
async function pressEsc() {
	// fire-and-forget（理由同 emit 定义）；keydown/keyUp 间留极短间隔
	emit("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
	await WAIT(20);
	emit("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
	await WAIT(40);
}
/** 原生输入：先聚焦再 insertText（走 Input 通道，与真人敲键一致；不用 el.value= 直写） */
async function typeInto(sel, text) {
	const r = await rectOf(sel);
	if (!r || r.zero) return false;
	await click(sel);
	emit("Input.insertText", { text });
	await WAIT(60);
	return true;
}
/** 第 i 个匹配元素的坐标（用于"同选择器多条、只点其中一条"的场景，例如侧栏会话项） */
async function rectOfIndex(sel, i) {
	return ev("(()=>{const L=document.querySelectorAll(" + J(sel) + ");const e=L[" + i + "];if(!e)return null;"
		+ "const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return {zero:true};"
		+ "return {cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2),txt:String(e.textContent||'').trim().slice(0,24)};})()");
}
async function clickIndex(sel, i) {
	const r = await rectOfIndex(sel, i);
	if (!r || r.zero) return { ok: false, why: "index " + i + " 无可用几何" };
	await mouse("mouseMoved", r.cx, r.cy, 0);
	await mouse("mousePressed", r.cx, r.cy, 1);
	await mouse("mouseReleased", r.cx, r.cy, 0);
	return { ok: true, x: r.cx, y: r.cy, txt: r.txt };
}
const count = (sel) => ev("document.querySelectorAll(" + J(sel) + ").length");
const attr = (sel, name) => ev("(()=>{const e=document.querySelector(" + J(sel) + ");return e?e.getAttribute(" + J(name) + "):null;})()");
const exists = async (sel) => (await count(sel)) > 0;

/* ── 前置：让「原生 composer 可见」这件事成立（不靠运气）───────────────────────
 * 🔴 实测根因（2026-09-12，本轮 r2/r4 连续两轮踩到）：
 *    宿主在**生成中**会隐藏 composer —— 判据是 `button[aria-label="停止生成"]` 在场，
 *    此时 `textarea[placeholder=…]` 仍在 DOM 里但被外层 `display:none` 压成 0×0。
 *    而**本脚本自己的投递就会触发一次真实生成**（host-send → 智能体真的开始回答）
 *    ⇒ 紧接着跑下一轮时 composer 还在隐藏中 ⇒ A5/A6/G 段级联变红，
 *    读起来像"功能坏了"，实际是"上一轮的活儿还没干完"。
 *
 * 分级建立（每级都有明确依据，不静默）：
 *    ① 直接可见                        → 成立
 *    ② 正在生成 ⇒ **换一个会话**        → 那个会话未必在生成，最快拿到 composer
 *    ③ 等（生成可能自然结束）           → 成立
 *    ④ 点回「总监」tab（视图被切走）    → 成立
 *    ⑤ 都不行                          → 返回 false，由调用方**如实报因**
 */
async function composerVisible() {
	return ev("(()=>!!(window.__dshChatBridge&&window.__dshChatBridge.findComposer()))()");
}
async function generating() {
	return ev("(()=>!!document.querySelector('button[aria-label=\"停止生成\"]'))()");
}
async function waitComposer(ms) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		if (await composerVisible()) return true;
		await WAIT(600);
	}
	return false;
}
async function ensureComposer() {
	if (await composerVisible()) return { ok: true, how: "直接可见" };
	const busy = await generating();
	if (busy) {
		/* ①' 测试不需要宿主把 AI 回答写完：先主动「停止生成」，最快拿回 composer
		 *     （比换会话/干等几十秒更确定；与收尾复原成对，治"上一轮残留生成中"） */
		await ev("(()=>{const b=document.querySelector('button[aria-label=\"停止生成\"]');if(b)b.click();return 1;})()");
		if (await waitComposer(8000)) return { ok: true, how: "停止生成后可见" };
		/* ② 换会话：挑一个"不是当前选中"的会话行真实点击 */
		const other = await ev("(()=>{const L=[...document.querySelectorAll('[role=treeitem]')];"
			+ "const i=L.findIndex(e=>e.getAttribute('aria-selected')==='true');"
			+ "const cands=L.map((e,k)=>({k:k,t:String(e.textContent||'').trim()})).filter(x=>x.k!==i&&/分钟|小时|天|刚刚/.test(x.t));"
			+ "return cands.length?cands[0].k:-1;})()");
		if (other >= 0) {
			await clickIndex('[role="treeitem"]', other);
			if (await waitComposer(9000)) return { ok: true, how: "生成中 ⇒ 换会话" };
		}
	}
	/* ③ 等生成结束（LLM 回合可能几十秒） */
	if (await waitComposer(busy ? 60000 : 12000)) return { ok: true, how: busy ? "等生成结束" : "等待后可见" };
	/* ④ 视图被切走 ⇒ 点回总监 tab */
	await clickText('[role="tab"]', "总监");
	if (await waitComposer(6000)) return { ok: true, how: "点回总监 tab" };
	return { ok: false, how: "⑤ 五级都不成立（生成中=" + busy + "）" };
}

/* ── 起点会话复原 / 钉住（本项目既有纪律 C17.2）─────────────────────────────
 * 🔴 为什么必须复原：D8 会真实点到"**另一个**会话"，而不同会话的布局未必相同 ——
 *    真机实测（2026-09-12）：起点会话的 composer 在底部（top≈690，浮动组 bottom≈137.6），
 *    而某个其它会话的 composer 落在 **y≈390 的分屏中段**（浮动组 bottom=438）。
 *    不复原 ⇒ F（浮动组跟随 composer）与 G（执行=读原生框）会在**两种布局之间漂移**：
 *    同一份代码时红时绿，读起来像"功能坏了"，实际是**起点没复原**。
 * 🔴 2026-09-12 第二轮补漏：**D 段自己也需要它**（不只是 F/G 的前置）——
 *    D5 往原生框写 MARK、点「登记流转」时，页面认的会话若已经漂到别处，
 *    R5 就会按**另一个会话**过滤 ⇒ 条数 0，而库里那条其实好好地存在（D7 还能查到它）。
 *    这正是 r5/r6 的 D5/D6 假红的成因。⇒ 把复原函数**上提**，D 段开头与结尾都用它。
 * ⚠️ 只有**一处**声明：同名 `function` 重复声明会静默覆盖前者（本项目已因此翻过一次车）。 */
async function restoreStartSession() {
	if (!(await composerVisible())) {
		const e = await ensureComposer();
		if (!e.ok) {
			if (openedSessionIndex === null) return { ok: false, how: "composer 未建立且无起点下标" };
			await clickIndex('[role="treeitem"]', openedSessionIndex);
			if (!(await waitComposer(6000))) {
				/* 下标漂移（侧栏增删项）时的兜底：按**文案**再点一次 */
				if (openedSessionLabel) await clickText('[role="treeitem"]', openedSessionLabel);
				if (!(await waitComposer(8000))) return { ok: false, how: "按文案也没等到 composer" };
			}
		}
	}
	/* 🔴 关键一步（r11/r12/r13 实测的真因）：「composer 在场」**不等于**"回到了起点会话" ——
	 *   任何会话都有输入框。D8 会真实点到另一个会话，若只判 composer，就会一直留在那个会话上，
	 *   下一轮的起点随之漂移（C 段的分支树从 16 个框退化成 1 个框）。
	 *   ⇒ 必须比对 **sessionId**，不一致就按起点下标/文案切回去，并等它真的对上。 */
	let back = true;
	if (startSessionId) {
		let cur = await dpSession();
		if (cur !== startSessionId) {
			back = false;
			for (let i = 0; i < 2 && !back; i++) {
				if (openedSessionIndex !== null) { await clickIndex('[role="treeitem"]', openedSessionIndex); await WAIT(900); }
				cur = await dpSession();
				if (cur === startSessionId) { back = true; break; }
				if (openedSessionLabel) { await clickText('[role="treeitem"]', openedSessionLabel); await WAIT(900); }
				cur = await dpSession();
				if (cur === startSessionId) back = true;
			}
			if (!back) {   // 下标/文案都漂了 ⇒ 如实记"未能复原"，不编一条假成功
				await WAIT(400);
				back = (await dpSession()) === startSessionId;
			}
		}
	}
	return { ok: true, how: "composer 在场" + (startSessionId ? (back ? " + 会话已复原" : " + ⚠️ 会话未能复原") : "（未记起点 id）"), sess: await dpSession(), back: back };
}
/** 读「总监页认的当前会话」（= R5 的过滤依据） */
async function dpSession() {
	return await ev("(()=>{const e=document.querySelector('[data-testid=dp-root]');"
		+ "return e?e.getAttribute('data-flow-session'):null;})()");
}
/** 关掉所有可能盖住页面的浮层（跨段污染的通用清扫；C17.2 的延伸）。
 *  🔴 为什么要有它：r8/r9 实测 —— D7 走 SKIP 分支时没关导图，导图就一直盖着，
 *     紧接着的 F 段量到"三颗药丸被 `mm-stage` / `mm-minimap` / `nd-input` 挡住" ⇒ F8 报红，
 *     读起来像"浮动组坏了"，其实是**上一段的残留**。跨段污染与假绿灯同罪。 */
async function closeOverlays(log) {
	const closed = [];
	/* ⚠️ 选择器必须写全 `[data-testid=...]`：本脚本的 `exists()` 只做 `querySelectorAll(sel)`，
	 *    传裸名（如 `mm-root`）匹配的是 `<mm-root>` 标签 ⇒ 恒 0 ⇒ **静默什么都不关**。
	 *    r15 实测踩到：阶段 0 的"清场"没生效 ⇒ 导图盖着 ⇒ A6（焦点进不去原生框）、
	 *    B2-B8（个性化面板点不开）一起红，读起来像"功能坏了"，其实是**残留浮层**。 */
	for (const [sel, closer, label] of [
		['[data-testid="nd-panel"]', null, "节点详情"],
		['[data-testid="mm-root"]', '[data-testid="mm-close"]', "分支导图"],
		['#dsh-design-studio', '[data-testid="ds-close"]', "设计图工作室"]
	]) {
		if (!(await exists(sel))) continue;
		if (closer) await click(closer); else await pressEsc();
		await WAIT(400);
		closed.push(label);
	}
	for (let i = 0; i < 3; i++) {           // Esc 是"只关最上层"：依次退
		if (!(await exists('[data-testid="nd-panel"]'))) break;
		await pressEsc(); await WAIT(250);
	}
	/* 清场后自检：确认真的一层都不剩（"以为关了"是这类事故的常见形态） */
	const left = await ev("['[data-testid=\"mm-root\"]','#dsh-design-studio','[data-testid=\"nd-panel\"]']"
		+ ".filter(s=>document.querySelector(s)).map(s=>s.slice(0,20))");
	if (log) console.log("  · 清浮层（" + log + "）：关了 " + (closed.length ? closed.join(" / ") : "（无残留）")
		+ " ｜ 自检残留 " + JSON.stringify(left));
	return closed;
}

console.log("═══════════════════════════════════════════════════════════");
console.log(" 真机验证 · 总监页 / 个性化 / 导图控件与拖动 / 四维流转");
console.log("═══════════════════════════════════════════════════════════");



/* ══════════════════════════════════════════════════════════════════
 * 阶段 0 —— 干净起点：关掉所有浮层，确保有一个会话，再激活总监 tab
 * ══════════════════════════════════════════════════════════════════ */
console.log("── 阶段 0：准备起点 ──");
await ev("(()=>{ if(window.__dshFlow) window.__dshFlow.store.reset(); return 1; })()");
/* 先关导图/工作室（若开着），保证起点干净 */
await closeOverlays("阶段 0");
/* 🔴 同时把 R5 页签归位到「流转」：本脚本自己会在 G3b 切到「总监消息」，
 *   而 `r5tab` 是组件内部状态、**跨轮次存活**（同一份 Harness 实例连跑多轮时不会重置）。
 *   上一轮没切回 ⇒ 下一轮 D5/D6/D7 三红（详见 G3b 后"环境复原"的注释）。
 *   ⇒ 阶段 0 无条件归位：让每轮的**起点**与"刚重启"完全一致，不靠上一轮自觉。 */
if (await exists('[data-testid="dp-r5-flow"]')) { await click('[data-testid="dp-r5-flow"]'); await WAIT(250); }
/* 🔴 重启后的 Harness 停在欢迎页 ⇒ **没有会话就没有 tab 环**，后面全部断言会以
 *   「找不到总监 tab」的形式级联变红，读起来像五组需求全没做。
 *   ⇒ 先真实点一个侧栏会话把会话视图打开。
 *   ⚠️ `[role=treeitem]` 里**既有分组头（workspace）也有真会话**；点分组头只会折叠分组，
 *      `cdp-mouse` 那次实测就是「点击后页面无任何状态变化」。
 *      ⇒ 按文案挑出带时间戳的项（如「16小时」「5天」），逐个真实点击直到 tab 环出现。 */
let tabRing = (await ev("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(e=>String(e.textContent).trim())")) || [];
/* 记下"我们点开的是哪个会话"—— D 段要**真实点到另一个会话**做对照，得先知道自己现在在哪一个 */
let openedSessionLabel = null;
/* 记下起点会话的**侧栏下标** —— D 段收尾要按它复原（见 D 段末尾的复原块） */
let openedSessionIndex = null;
/* 起点会话的 **sessionId** —— 只有它能在"composer 可见"之后继续判"是不是同一个会话"。
 * 🔴 2026-09-12 r11/r12/r13 实测：`restoreStartSession()` 原先只要 composer 可见就返回 true，
 *    于是 D8 切到"另一个会话"之后**从没被切回来**，下一轮的起点会话一路漂移
 *    （r7 的起点带 16 个框的分支树，r11 起退化成 1 个框）⇒ C 段四条断言失去前提。
 *    ⇒ 复原必须比"能看见输入框"更强：**是同一个会话**。 */
let startSessionId = null;
if (tabRing.length === 0) {
	const readItems = async () => (await ev("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map((e,i)=>({i,t:String(e.textContent||'').trim().slice(0,26)}))")) || [];
	let items = await readItems();
	/* 🔴 2026-09-14 补（**实测踩到，代价已付**）：侧栏可能处在**折叠**状态 —— 那时
	 *    `[role=treeitem]` 里只有工作区根节点（实测唯一一项文案 = "workspace"、
	 *    `aria-expanded="false"`），**会话根本不在 DOM 里**。
	 *    原实现直接按 `/分钟|小时|天|刚刚/` 过滤 ⇒ 0 个候选 ⇒ 打不开任何会话
	 *    ⇒ 后面整轮级联失败（F1「总监页已挂载」false、F2/F3 取不到、F4 汇总崩栈），
	 *    读起来像"功能坏了"，其实是**起点没建立**（本项目的经典误判形态）。
	 *    ⇒ 先展开工作区根节点再找会话。 */
	if (!items.some((x) => /分钟|小时|天|刚刚/.test(x.t))) {
		const marked = await ev("(()=>{const w=document.querySelector('[role=treeitem][aria-expanded=\"false\"]');if(!w)return false;w.setAttribute('data-probe','ws-root');return true;})()");
		if (marked) {
			await click('[data-probe="ws-root"]');
			await WAIT(1300);
			await ev("document.querySelectorAll('[data-probe=\"ws-root\"]').forEach(function(e){e.removeAttribute('data-probe');})");
			items = await readItems();
			console.log("  · 侧栏原为折叠态 ⇒ 已展开工作区根节点，项数 " + items.length);
		}
	}
	const sessions = items.filter((x) => /分钟|小时|天|刚刚/.test(x.t));
	console.log("  侧栏项 " + items.length + " 个，其中像会话的 " + sessions.length + " 个：" + JSON.stringify(sessions.map((s) => s.t)));
	for (const s of sessions.slice(0, 4)) {
		const c = await clickIndex('[role="treeitem"]', s.i);
		await WAIT(1500);
		tabRing = (await ev("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(e=>String(e.textContent).trim())")) || [];
		if (tabRing.length) { openedSessionLabel = s.t; openedSessionIndex = s.i; console.log("  ✅ 已打开会话：" + s.t + " ⇒ tab 环 " + JSON.stringify(tabRing)); break; }
		console.log("  · 点了「" + s.t + "」仍无 tab 环");
	}
}
if (tabRing.length === 0) console.log("  ⚠️ 始终没能打开会话视图 ⇒ 后续断言会级联失败（这是阻塞，不是「功能没做」）");

/* 🔴 无论"起点会话是我们自己打开的、还是它本来就在"——都必须记下它是谁。
 *    r4 实测：启动时 tab 环已存在 ⇒ 走不到上面的打开分支 ⇒ `openedSessionIndex` 恒为 null
 *    ⇒ D 段收尾的"环境复原"无对象可复原（日志里显示成「切回起点会话『?』」）。
 *    侧栏以 `aria-selected="true"` 标记当前会话，据此回填。 */
if (openedSessionIndex === null) {
	const cur = await ev("(()=>{const L=[...document.querySelectorAll('[role=treeitem]')];"
		+ "const i=L.findIndex(e=>e.getAttribute('aria-selected')==='true');"
		+ "return i>=0?{i:i,t:String(L[i].textContent||'').trim().slice(0,26)}:null;})()");
	if (cur) { openedSessionIndex = cur.i; openedSessionLabel = cur.t; }
	console.log("  · 起点会话（按 aria-selected 回填）：" + (openedSessionLabel || "?"));
}

/* ── 前置：composer 可见（见 ensureComposer 的分级说明）──
 * 放在 A 段之前：A5/A6/G/F 全依赖它，前置不成立时后面的红都不是"功能坏了"。 */
const preComposer = await ensureComposer();
console.log("  · 前置 composer：" + (preComposer.ok ? "已建立（" + preComposer.how + "）" : "未建立（" + preComposer.how + "）"));

const tabClick = await clickText('[role="tab"]', "总监");
check("A1", "宿主 tab 环里真实点击「总监」tab", tabClick.ok, tabClick.ok ? "坐标 " + tabClick.x + "," + tabClick.y + " ｜ tab 环 " + JSON.stringify(tabRing) : tabClick.why);
await WAIT(900);

section("【A】总监页 · 用原生对话框（用户：「不要这个对话框，用原本的对话框」）");
const hasPage = await exists('[data-testid="dp-root"]');
check("A2", "总监页已挂载（dp-root 出现）", hasPage, hasPage ? "已挂载" : "未找到 dp-root");
/* 🔴 记下**起点会话的 sessionId**（总监页挂载后才有 `data-flow-session` 可读）。
 *   `openedSessionIndex/Label` 只够"点回去"，判"是不是同一个会话"必须靠 id ——
 *   见 restoreStartSession 的注释（r11/r12/r13 跨轮漂移的真因）。 */
if (hasPage) {
	startSessionId = await dpSession();
	console.log("  · 起点会话 id = " + (startSessionId || "（取不到）")
		+ " ｜ 侧栏下标 " + openedSessionIndex + " ｜ 文案「" + (openedSessionLabel || "?") + "」");
}
if (!hasPage) {
	console.log("\n⚠️ 总监页未挂载，后续 A/B/D 段跳过（这不是通过，是阻塞）。");
}
/* ══ 第 6 批 · 需求 9：用户明确要求删掉**整条 R8** ══════════════════════════════
 * 原话：「[图8]… 都完成之后去掉这一行」，澄清为
 *   「目标 总监 ● 对话 定位输入框 登记流转 模型 qwen2:7b ▾上下文 0% 会话 …6dcda14e 这一行」。
 * ⇒ 原 A3（"R8 里零 input"）/ A4（"R8 五键齐备"）/ A6（"点 ⌨ 聚焦原生对话框"）
 *   三条断言的**对象已不存在**。按纪律 18（跳过比红更危险、禁用不可证伪收尾）：
 *   不是"删了断言就算"，而是**双向改造**：
 *     ① 负向：R8 与它的六个旧锚点**确实全部消失**（防"只删了外壳、半截还在"）；
 *     ② 正向：被删能力**确实搬到了宿主底部注入条**（防"顺手把能力一起砍了"）。
 *   `⌨ 聚焦原生对话框` 这个键**没有搬迁**（用户要求连整行一起去掉）
 *   ⇒ 原 A6 整条**删除并在此留痕**，不再以任何形式断言它；A5（原生 composer 仍在且可见）保留，
 *     它才是「用原本的对话框」这一诉求的物理前提。 */
const r8Gone = await count('[data-testid="dp-r8"]');
check("A3", "🔴 需求 9：整条 R8 已从 DOM 移除", r8Gone === 0, "dp-r8 命中 = " + r8Gone);
const r8Keys = ["dp-route-director", "dp-route-chat", "dp-focus-native", "dp-register-flow", "dp-send", "dp-model"];
const keyCounts = {};
for (const k of r8Keys) keyCounts[k] = await count('[data-testid="' + k + '"]');
check("A4", "R8 内部六个旧锚点**全部**消失（不是只删了外壳）", r8Keys.every((k) => keyCounts[k] === 0), JSON.stringify(keyCounts));
const barKeys = ["dp-host-scope-toggle", "dp-host-deliver", "dp-host-register"];
const barCounts = {};
for (const k of barKeys) barCounts[k] = await count('[data-testid="' + k + '"]');
check("A4b", "🔴 被删 R8 的能力**确已搬到宿主底部注入条**（总监/对话切换 · 执行 · 登记流转）",
	barKeys.every((k) => barCounts[k] === 1), JSON.stringify(barCounts));
const barInputs = await ev("(()=>{const b=document.getElementById('dsh-host-scope-bar');if(!b)return -1;"
	+ "return b.querySelectorAll('input,textarea,select').length;})()");
check("A4c", "🔴 注入条里**零** input/textarea（我们不自建输入框，沿用宿主原生 composer）",
	barInputs === 0, "注入条内表单元素数 = " + barInputs);

/* 原生 composer：必须存在、可见、且不是零尺寸 */
const composer = await ev("(()=>{const L=Array.from(document.querySelectorAll('textarea')).filter(e=>{const r=e.getBoundingClientRect();return r.width>60&&r.height>8;});"
	+ "if(!L.length)return null;const e=L[L.length-1];const r=e.getBoundingClientRect();"
	+ "return {ph:e.getAttribute('placeholder')||'',x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2)};})()");
check("A5", "🔴 总监 tab 下**原生对话框仍在且可见**（这是「用原本的对话框」的物理前提）",
	Boolean(composer) && composer.w > 60, composer ? "placeholder=" + J(composer.ph) + " 矩形 " + composer.w + "×" + composer.h : "未找到可见 textarea");

/* ⚠️ 原 A6「点 ⌨ 聚焦原生对话框 ⇒ 焦点落到原生 composer」**已随需求 9 删除该键而移除**。
 *   留痕：该键属于被整行删掉的 R8，没有搬迁到任何位置 ⇒ 断言的**对象不存在**。
 *   不改成"改点别处"（那会变成另一件事被记在这个标题下，属口径污染）。 */
console.log("  ⓘ A6 已随需求 9 移除（『⌨ 聚焦原生对话框』键连同 R8 整行一起删除，无搬迁目标）");

/* 空内容不登记（正负对照）
 * 🔴 上一版为什么红：这个"负向"对照**没有建立前提**。原生输入框里可能留着上一轮跑
 *   C15 写入的草稿（`sendToChat({autoSend:false})` 只写入、不发送、也不清空，这是产品
 *   设计：文本留在原生框里等用户自己回车）⇒ 点「登记为流转」会**正确地**登记出一条。
 *   ⇒ 先显式清空并**回读确认为空**，再做负向断言；跑完把用户原本的草稿还原回去。 */
const flowLen = () => ev("window.__dshFlow ? window.__dshFlow.store.getState().flows.length : -1");
let userDraft = null;
try { userDraft = await ev("(()=>{try{return String(window.__dshChatBridge.readComposerText()||'');}catch(e){return null;}})()"); } catch (e) { userDraft = null; }
await ev("(()=>{try{window.__dshChatBridge.setComposerText('');}catch(e){}return 1;})()");
await WAIT(250);
const draftNow = await ev("(()=>{try{return String(window.__dshChatBridge.readComposerText()||'');}catch(e){return 'ERR';}})()");
await ev("(()=>{ window.__dshFlow.store.setActiveSession(null); return 1; })()");
const n0 = await flowLen();
/* 🔴 前提自证 ②：按钮**当时确实可点**。
 *   不然「点了没反应」也会让这条负向断言变绿 —— 死按钮与"正确地拒绝空输入"
 *   在结果上无法区分（A7 原本就是这个弱点：它删掉 disabled 前后都是绿的）。
 *   这里不重复产品判据，只记事实，供人分辨。 */
const aClickable = await ev("(()=>{const b=document.querySelector('[data-testid=dp-host-register]');"
	+ "if(!b)return {there:false};const r=b.getBoundingClientRect();"
	+ "return {there:true,disabled:Boolean(b.disabled),aria:b.getAttribute('aria-disabled'),"
	+ " w:Math.round(r.width),h:Math.round(r.height)};})()");
const aClick = await click('[data-testid="dp-host-register"]'); await WAIT(350);
const n1 = await flowLen();
check("A7", "【负】原生框**确为空**时点注入条「登记流转」⇒ 不产生空流转（含前提自证）",
	draftNow === "" && n1 === n0,
	"前置清空后读到 " + J(draftNow) + "（原草稿 " + (userDraft ? userDraft.length + " 字" : "空") + "）"
	+ " ｜ 按钮可点自证=" + J(aClickable) + " ｜ 命中=" + (aClick && aClick.ok ? (aClick.occluded ? "被遮" : "命中") : "失败")
	+ " ｜ 前 " + n0 + " → 后 " + n1);
if (userDraft) await ev("(()=>{try{window.__dshChatBridge.setComposerText(" + J(userDraft) + ");}catch(e){}return 1;})()");

/* ══ 「⓪ 先摆平起点」—— 四处 ⚙ 共用一个**单例 + 开合型**面板 ═══════════════════════
 * 🔴 真机实测（2026-09-14）：同一份代码跑两次，`verify-flow` 交替出 **74/74** 与 **73/74**；
 *    红的那次**不是崩溃、也不是产品缺陷**，读数就一行：`scope=null`（同一条里的 bgImage 完全正常）。
 *    根因：`#dsh-personalize-panel` 是**开合控件**（点一下 = 切换），四处 ⚙ 共用同一个 id。
 *    真机 e2e **不重载页面** ⇒ 状态**跨运行保留**：上一轮（或本轮上一段）把面板留在**打开态**
 *    ⇒ 本段这一下点击是「**关**」不是「开」⇒ `querySelector('#dsh-personalize-panel')` 为 null
 *    ⇒ `data-scope` 读成 null。这是本仓第 N 次踩同一条：**偶发红先查"起点是否等价"，别先查产品**。
 * ⇒ 对策（三段式，缺一不可）：
 *    ① 点之前**归零**：已在场就先 `pp-close` 关掉；
 *    ② **回读确认"确实没了"**（`=== false` 才算归零成功，不能只看"我点过了"）；
 *    ③ 点之后再**证前提**（面板真的在场）—— 前提不成立时后续断言是**无从判定**，不是"产品坏了"。
 *    （与 C 段「聚焦态先归零」、C12「💬 是开关、先归零」、G3b 后「页签切回」是同一条纪律。） */
const panelId = "dsh-personalize-panel";
const panelShut = async () => {
	if (await exists("#" + panelId)) { await click('[data-testid="pp-close"]'); await WAIT(250); }
	return !(await exists("#" + panelId));
};

section("【B】右上角个性化（用户：「都在右上角加自定义个性化设定」）");
const pBtn = await rectOf('[data-testid="dp-personalize"]');
check("B1", "总监页右上角有 ⚙ 设置按钮且**未被原生窗口控件遮挡**", Boolean(pBtn) && !pBtn.zero, pBtn && !pBtn.zero ? "矩形 " + pBtn.w + "×" + pBtn.h + " @ " + pBtn.x : JSON.stringify(pBtn));
const bShut = await panelShut();
const opened = pBtn && !pBtn.zero ? await click('[data-testid="dp-personalize"]') : { ok: false };
await WAIT(350);
const panelOpen = await exists("#" + panelId);
check("B2", "真实点击后个性化面板出现（#dsh-personalize-panel）—— 含「起点已归零」前置（开合控件：起点不复位则这一下是「关」）",
	bShut && panelOpen, (bShut ? "" : "起点未归零（pp-close 关不掉）/ ") + (panelOpen ? "已出现" : "未出现"));
check("B3", "面板 data-scope 标出这是哪一处", (await attr("#" + panelId, "data-scope")) === "总监页", await attr("#" + panelId, "data-scope"));
const swat = await count('[data-testid^="pp-accent-"]');
const tex = await count('[data-testid^="pp-texture-"]');
check("B4", "面板里主色 4 档 / 质感 4 档都真的渲染了（不是空面板）", swat === 4 && tex === 4, "主色 " + swat + " / 质感 " + tex);
const insetAttr = await attr("#" + panelId, "data-inset");
check("B5", "面板带上安全区 inset（右侧不会被原生窗口按钮压住）", insetAttr !== null && Number(insetAttr) >= 0, "inset=" + insetAttr);

/* 真实点「青」：:root 变量必须真的变 */
const acBefore = await ev("getComputedStyle(document.documentElement).getPropertyValue('--dp-ac').trim()");
await click('[data-testid="pp-accent-39c5cf"]'); await WAIT(300);
const acAfter = await ev("getComputedStyle(document.documentElement).getPropertyValue('--dp-ac').trim()");
check("B6", "🔴 真实点「青」⇒ :root 的 --dp-ac 变成 #39c5cf（DOM 级证据，不是内存里改改）",
	acBefore === "#2f6feb" && acAfter === "#39c5cf", acBefore + " → " + acAfter);

/* 🔴 质感：不仅要看属性，还要看**真的渲染出来没有** */
await click('[data-testid="pp-texture-dots"]'); await WAIT(350);
const texAttr = await ev("document.documentElement.getAttribute('data-dp-texture')");
const bi = await ev("(()=>{const e=document.querySelector('.dp-textured');if(!e)return null;"
	+ "const s=getComputedStyle(e);return {img:s.backgroundImage, size:s.backgroundSize};})()");
check("B7", "🔴 切「点阵」⇒ html[data-dp-texture]=dots", texAttr === "dots", String(texAttr));
check("B8", "🔴 且 .dp-textured 的 computed background-image **真的不是 none**（质感真的显示了 —— 这是本轮 background 简写坑的判据）",
	Boolean(bi) && bi.img !== "none" && /radial-gradient/.test(bi.img), bi ? String(bi.img).slice(0, 60) : "未找到 .dp-textured");

/* 复位 */
await click('[data-testid="pp-reset"]'); await WAIT(300);
const acReset = await ev("getComputedStyle(document.documentElement).getPropertyValue('--dp-ac').trim()");
const texReset = await ev("document.documentElement.getAttribute('data-dp-texture')");
check("B9", "「恢复默认」⇒ 主色与质感都回到默认", acReset === "#2f6feb" && texReset === "grid", acReset + " / " + texReset);

/* Esc 逐层退：先关面板，总监页不能被一起关掉 */
await pressEsc(); await WAIT(300);
const panelGone = !(await exists("#" + panelId));
const pageAlive = await exists('[data-testid="dp-root"]');
check("B10", "🔴 Esc 只关最上层：面板消失而总监页仍在（防「按 Esc 把整页关掉」）", panelGone && pageAlive, "面板 " + (panelGone ? "已关" : "仍在") + " / 总监页 " + (pageAlive ? "在" : "没了"));

/* ══════════════════════════════════════════════════════════════════
 * 阶段 C —— 分支导图：单框控件 / 拖动 / 右侧对话面板
 * ══════════════════════════════════════════════════════════════════ */
section("【C】分支导图 · 单框展开折叠 / 框可拖动 / 点框开右侧对话");
const om = await click('[data-testid="dp-open-mindmap"]');
await WAIT(800);
const mmOpen = await exists('[data-testid="mm-root"]');
check("C1", "真实点击「🧠 打开分支导图」⇒ 导图出现", mmOpen, mmOpen ? "已出现" : "未出现" + (om.why || ""));
if (mmOpen) {
	/* 🔴 前置归零：导图可能**带着聚焦态**被打开（点过分支就进聚焦，聚焦态下只剩该链路）。
	 *   真机实测（2026-09-12）：带着聚焦态打开时是 **1 个框 / 0 条连线**，
	 *   归零后同一份数据是 **17 个框 / 5 条连线** —— r11~r18 那 4 条「跳过」
	 *   （C4/C6/C7/C10 因"没有有子节点的框"）就是被这个状态骗的，**不是数据缺失**。
	 *   ⇒ 判据必须自己把前置摆到"全量树"上，不依赖进来时的状态。
	 *     （与 C12 的"💬 是开关、先归零"、G3b 后的"页签切回"是同一条纪律。） */
	const cFocusPre = await ev("(()=>{const fb=document.querySelector('[data-testid=\"mm-focusbar\"]');"
		+ "return {focusbar:Boolean(fb),focusId:fb?fb.getAttribute('data-focus-id'):null,"
		+ " nodes:document.querySelectorAll('[data-testid=\"mm-node\"]').length};})()");
	if (cFocusPre && cFocusPre.focusbar) { await click('[data-testid="mm-focus-exit"]'); await WAIT(500); }
	const cFocusNow = await ev("(()=>{const fb=document.querySelector('[data-testid=\"mm-focusbar\"]');"
		+ "return {focusbar:Boolean(fb),nodes:document.querySelectorAll('[data-testid=\"mm-node\"]').length,"
		+ " edges:document.querySelectorAll('[data-testid=\"mm-edges\"] path').length};})()");
	console.log("  · 导图聚焦态归零：前 " + J(cFocusPre) + " ⇒ 后 " + J(cFocusNow));

	await ev("(()=>{const b=document.querySelector('[data-testid=\"mm-fit\"]');return 1;})()");

	const nNodes = await count('[data-testid="mm-node"]');
	const nCtrls = await count('[data-testid="mm-node-controls"]');
	const nToggle = await count('[data-testid="mm-node-toggle"]');
	const nEdges = await count('[data-testid="mm-edges"] path');
	check("C2", "每个可见框都有控件行（数量 = 框数）", nNodes > 0 && nCtrls === nNodes, "框 " + nNodes + " / 控件行 " + nCtrls);
	check("C3", "🔴 每个框都有折叠按钮（用户原话：「单个框没有展开和折叠的选项」⇒ 含无子框也必须**存在**）",
		nNodes > 0 && nToggle === nNodes, "框 " + nNodes + " / 折叠钮 " + nToggle);
	/* 🔴 C 段前提 = **树里存在父子分支**（判据：连线数 > 0）。
	 *   真机实测（2026-09-12 r11/r12/r13）：当前工作区里所有会话都是**孤立根**
	 *   （没有 parentSessionId、也没有子会话）⇒ 树里只有 1 个框、0 条连线，
	 *   于是 C4 拿到 ["0"]、C6/C7 无处可点、C10 连线条数恒 0。
	 *   这不是产品缺陷，是**前提不成立** —— 必须与"判据坏了"分开报：
	 *     · 连线 0 条 ⇒ 前提缺失 ⇒ **跳过**（并给出如何建立前提）；
	 *     · 连线 > 0 条却没有任何 enabled=1 ⇒ 判据/渲染真的坏了 ⇒ **失败**。
	 *   ⚠️ 不自动建分支：宿主 `sessions` 没有删除/合并能力（`hostCapabilities().remove === false`），
	 *      建出来的会话**删不掉**、会永久留在侧栏 —— 属于不可逆写操作，必须由人决定。 */
	const cHasEdge = nEdges > 0;
	if (!cHasEdge) {
		console.log("  ⚠️ C 段前提缺失：树里 " + nNodes + " 个框 / **0 条父子连线**（当前会话没有下挂分支）");
		console.log("     受影响：C4 / C6 / C7 / C10 记为「跳过」（不等于通过，也不等于失败）。");
		console.log("     建立前提的办法：在导图里对任一框点「＋ 新建分支」，侧栏会真的多出一条会话");
		console.log("     （宿主 SessionRuntime 不提供删除/合并 ⇒ 该会话删不掉），然后重跑本脚本。");
	}

	const enabledList = await ev("Array.from(document.querySelectorAll('[data-testid=\"mm-node-toggle\"]')).map(e=>e.getAttribute('data-enabled'))");
	const enabled1 = (enabledList || []).filter((v) => v === "1").length;
	check("C4", "【正负对照】有子框 enabled=1 / 无子框 enabled=0（同一页面两种取值都出现 ⇒ 判据接了真值）",
		cHasEdge ? (enabled1 > 0 && enabled1 < nNodes) : "SKIP",
		cHasEdge
			? JSON.stringify(enabledList)
			: "树里 0 条父子连线 ⇒ 没有「有子框」可对照（判据未被检验）；" + JSON.stringify(enabledList));
	const disTitle = await ev("(()=>{const e=Array.from(document.querySelectorAll('[data-testid=\"mm-node-toggle\"]')).find(x=>x.getAttribute('data-enabled')==='0');return e?String(e.getAttribute('title')):null;})()");
	check("C5", "禁用态的折叠钮写明原因（不是静默不可点）", Boolean(disTitle) && /没有子会话/.test(disTitle), String(disTitle).slice(0, 48));

	/* 真实点击折叠：可见框数必须减少 */
	const foldSel = "[data-toggle-id]";
	const foldId = await ev("(()=>{const e=Array.from(document.querySelectorAll('[data-testid=\"mm-node-toggle\"]')).find(x=>x.getAttribute('data-enabled')==='1');return e?e.getAttribute('data-toggle-id'):null;})()");
	if (foldId) {
		const before = await count('[data-testid="mm-node"]');
		await click('[data-toggle-id="' + foldId + '"]'); await WAIT(400);
		const after = await count('[data-testid="mm-node"]');
		const col = await attr('[data-toggle-id="' + foldId + '"]', "data-collapsed");
		check("C6", "🔴 真实点击折叠 ⇒ data-collapsed=1 且可见框数**减少**", col === "1" && after < before, "框 " + before + " → " + after + " / data-collapsed=" + col);
		await click('[data-toggle-id="' + foldId + '"]'); await WAIT(400);
		const back = await count('[data-testid="mm-node"]');
		check("C7", "再点一次 ⇒ 展开复原（正负对照，证明不是单向坏掉）", back === before, "框 " + after + " → " + back + "（原 " + before + "）");
	} else {
		check("C6", "🔴 真实点击折叠 ⇒ 可见框数减少", "SKIP", cHasEdge ? "当前树里没有有子节点的框（但存在连线 ⇒ 值得追查）" : "树里 0 条父子连线 ⇒ 无可折叠对象（前提缺失，见上方 ⚠️）");
		check("C7", "再点一次 ⇒ 展开复原", "SKIP", "同上（随 C6 一起跳过）");
	}
	void foldSel;

	/* 🔴 真实拖动：位置变 + 连线跟着走 */
	/* 🔴 拖哪个框：必须挑**连着线**的，而且**手柄不能被别的元素压住**。
	 *  两个坑都在这里踩过：
	 *   ① 第一版拖"第一个框" —— 它是孤立框（全图 12 框只有 3 条连线）；拖它对任何 path
	 *      都没影响，"变化 0 条"是**正确**的渲染结果，红的是断言挑错了对象。
	 *   ② 第二版改成挑"连线框" —— 挑中的那个框手柄正好被压住，`pointerdown` 落到了压住它的
	 *      元素身上，于是框纹丝不动（`occluded:true` 说的就是这个，不是拖动坏了）。
	 *  ⇒ 先算候选（父端 / 子端落在某条 path 端点 ±2px 上 + 在画布可视区内），
	 *    再逐个做**手柄命中测试**，用第一个没被压住的；被压住的把"谁压的"记下来打出来
	 *    （下次再出这种问题，日志里直接有答案，不用再猜）。 */
	const cands = await ev("(()=>{"
		+ "const body=document.querySelector('[data-testid=\"mm-body\"]');"
		+ "const br=body?body.getBoundingClientRect():null;"
		+ "const nodes=Array.from(document.querySelectorAll('[data-testid=\"mm-node\"]')).map(e=>{const r=e.getBoundingClientRect();"
		+ "return {id:e.getAttribute('data-session-id'),l:parseFloat(e.style.left)||0,t:parseFloat(e.style.top)||0,"
		+ "w:e.offsetWidth,h:e.offsetHeight,cx:r.x+r.width/2,cy:r.y+r.height/2};});"
		+ "const paths=Array.from(document.querySelectorAll('[data-testid=\"mm-edges\"] path')).map(p=>p.getAttribute('d'));"
		+ "const numsOf=(d)=>(String(d).match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);"
		+ "const near=(a,b)=>Math.abs(a-b)<=2;"
		+ "const onScreen=(n)=>br? (n.cx>br.left+6&&n.cx<br.right-6&&n.cy>br.top+6&&n.cy<br.bottom-6):true;"
		+ "const seen={};const out=[];"
		+ "for(const d of paths){const n=numsOf(d);if(n.length<8)continue;"
		+ "const s={x:n[0],y:n[1]},e2={x:n[6],y:n[7]};"
		+ "for(const nd of nodes){if(!onScreen(nd)||seen[nd.id])continue;"
		+ "if(near(nd.l,e2.x)&&near(nd.t+nd.h/2,e2.y)){seen[nd.id]=1;out.push({id:nd.id,role:'child'});}"
		+ "else if(near(nd.l+nd.w,s.x)&&near(nd.t+nd.h/2,s.y)){seen[nd.id]=1;out.push({id:nd.id,role:'parent'});}}}"
		+ "return {cands:out, paths:paths.length, nodes:nodes.length};})()");
	const candList = (cands && cands.cands) || [];
	let chosen = null; const blocked = [];
	for (const c of candList.slice(0, 8)) {
		const hsel = '[data-testid="mm-node-move"][data-move-id="' + c.id + '"]';
		const hr = await rectOf(hsel);
		if (!hr || hr.zero) { blocked.push(c.id + "=无手柄"); continue; }
		const hit = await hitAt(hsel, hr.cx, hr.cy);
		if (hit && hit.ok) { chosen = c; break; }
		blocked.push(c.id + " ← 被 " + (hit ? hit.top : "?") + " 压住");
	}
	const fallbackId = await ev("(()=>{const e=document.querySelector('[data-testid=\"mm-node-move\"]');return e?e.getAttribute('data-move-id'):null;})()");
	const dragId = chosen ? chosen.id : fallbackId;
	const dragSel = '[data-testid="mm-node-move"][data-move-id="' + dragId + '"]';
	console.log("  · 拖动目标：" + (chosen ? "连线框(" + chosen.role + ") " + dragId : "兜底 " + dragId)
		+ " ｜ 图 " + (cands ? cands.paths + " 条连线 / " + cands.nodes + " 个框" : "?")
		+ "，连线框候选 " + candList.length + " 个" + (blocked.length ? "；手柄被压住：" + blocked.join(" ／ ") : ""));
	const nodeSel = '[data-session-id="' + dragId + '"]';
	/* 框在**画布坐标系**里的几何（style.left/top + offsetWidth/Height，不受 scale 影响）
	 * —— edgePathFor 就是拿这套坐标算端点的（a.x + nodeW / b.x），所以可以直接对账 */
	const geomOf = () => ev("(()=>{const e=document.querySelector(" + J(nodeSel) + ");if(!e)return null;"
		+ "return {l:parseFloat(e.style.left)||0,t:parseFloat(e.style.top)||0,w:e.offsetWidth,h:e.offsetHeight};})()");
	const allPaths = () => ev("Array.from(document.querySelectorAll('[data-testid=\"mm-edges\"] path')).map(p=>p.getAttribute('d'))");
	const gBefore = await geomOf(); const pathsA = await allPaths();
	const rBefore = await rectOf(nodeSel);
	const dv = await drag(dragSel, 150, 96);
	await WAIT(450);
	const rAfter = await rectOf(nodeSel);
	const movedFlag = await attr(nodeSel, "data-moved");
	const gAfter = await geomOf(); const pathsB = await allPaths();
	const dxReal = rBefore && rAfter ? Math.abs(rAfter.x - rBefore.x) : -1;
	const dyReal = rBefore && rAfter ? Math.abs(rAfter.y - rBefore.y) : -1;
	check("C8", "🔴 真实拖动框（150,96）⇒ 框真的移动了（位移 ≥ 90 / 60）",
		dragId !== null && dv.ok && dxReal >= 90 && dyReal >= 60, "位移 " + dxReal + " / " + dyReal + " px" + (dv.occluded ? "（注意：拖点当时被遮挡）" : ""));
	check("C9", "拖动后打上 data-moved 标记（位置来自插件侧持久化）", movedFlag === "1", String(movedFlag));

	/* 🔴 C10 的判据必须**几何对账**，不能只比「第一条 path」——
	 *  上一版就是栽在这里：`path[0]` 是 `tree.edges[0]`（根 → 第一个子节点的连线），
	 *  它**未必连着被拖的那个框** ⇒ 框真的动了、线也真的跟着动了，断言却是红的。
	 *  正确判据①：至少有一条 path 变了；
	 *  正确判据②：被拖框的锚点必须**出现在**某条变化了的 path 端点上 ——
	 *    作为父节点时锚点 = (left + nodeW, top + nodeH/2)；作为子节点时 = (left, top + nodeH/2)。
	 *  两条同时成立才算"线没脱节"（只验①会被"别的线碰巧变了"骗过）。 */
	const numsOf = (d) => (String(d).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
	let changedIdx = []; let hitAnchor = 0;
	if (Array.isArray(pathsA) && Array.isArray(pathsB) && gAfter) {
		const aR = { x: gAfter.l + gAfter.w, y: gAfter.t + gAfter.h / 2 };   // 作为父：右缘中点
		const aL = { x: gAfter.l, y: gAfter.t + gAfter.h / 2 };             // 作为子：左缘中点
		for (let i = 0; i < pathsB.length; i++) {
			if (pathsA[i] === pathsB[i]) continue;
			changedIdx.push(i);
			const n = numsOf(pathsB[i]);
			if (n.length < 8) continue;
			const s = { x: n[0], y: n[1] }, e2 = { x: n[6], y: n[7] };
			if ((Math.abs(s.x - aR.x) <= 2 && Math.abs(s.y - aR.y) <= 2)
				|| (Math.abs(e2.x - aL.x) <= 2 && Math.abs(e2.y - aL.y) <= 2)) hitAnchor++;
		}
	}
	check("C10", "🔴 拖动后**连线跟着动**（判据：被拖框的锚点落在某条变化了的 path 端点 ±2px 上）",
		cHasEdge ? (changedIdx.length >= 1 && hitAnchor >= 1) : "SKIP",
		(cHasEdge ? "" : "树里 0 条连线 ⇒ 无对象可测（前提缺失，见上方 ⚠️）｜")
		+ "变化 " + changedIdx.length + " 条 / 命中锚点 " + hitAnchor + " 条（共 " + (Array.isArray(pathsB) ? pathsB.length : "?") + " 条）"
		+ "｜框几何 " + J(gBefore) + " → " + J(gAfter));

	const autoOk = await click('[data-testid="mm-auto-layout"]'); await WAIT(450);
	const rBack = await rectOf(nodeSel);
	const backNear = rBefore && rBack ? Math.abs(rBack.x - rBefore.x) <= 8 && Math.abs(rBack.y - rBefore.y) <= 8 : false;
	check("C11", "「▦ 自动布局」把拖过的框归位（有去有回）", autoOk.ok && backNear, rBack ? "回到 " + rBack.x + "," + rBack.y + "（原 " + (rBefore ? rBefore.x + "," + rBefore.y : "?") + "）" : "未量到");

	/* 🔴 点框 ⇒ 右侧面板，且「现在在做的事」必须在**最上面第一个** */
	/* 🔴 幂等前置：`mm-node-detail` 是**开关**（`setDetailId(isOpen ? null : id)`），
	 *   所以"面板已经开着"时再点一次会把它**关掉** —— r14 就是这么红的：
	 *   C12 红（点开变点关）→ C16 的 Esc 没有面板可关、于是把**导图**关掉 → C17 级联红。
	 *   ⇒ 先归零（开着就先 Esc 关掉），再点一次，断言"出现"。
	 *     这样判据只检验"💬 点得开"，不被上一段/上一轮留下的开关态左右。 */
	const ndPre = await exists('[data-testid="nd-panel"]');
	if (ndPre) { await pressEsc(); await WAIT(400); }
	const detOk = await click('[data-testid="mm-node-detail"]'); await WAIT(500);
	let ndOpen = await exists('[data-testid="nd-panel"]');
	/* 布局竞态兜底：面板是异步挂载的，给它第二次机会（不掩盖真缺陷 —— 两次都开不出来才红） */
	if (!ndOpen) { await click('[data-testid="mm-node-detail"]'); await WAIT(600); ndOpen = await exists('[data-testid="nd-panel"]'); }
	check("C12", "真实点击 💬 ⇒ 右侧对话面板出现（#dsh-node-detail）", detOk.ok && ndOpen,
		"点前已开=" + ndPre + "（已归零）｜点击=" + (detOk.ok ? (detOk.occluded ? "被遮(" + detOk.top + ")" : "命中") : "失败")
		+ (detOk.scrolled ? "（已先滚入视口）" : "")
		+ " ｜ 面板 " + (ndOpen ? "已出现" : "未出现"));
	/* 🔴 C13 的判据：上一版只扫 `nd-panel` 的**直接子节点**找 `nd-now`，
	 *  但 `nd-now` 在 `bd` 里（不是直接子）⇒ 循环只扫到 `nd-grip`（左缘拖宽手柄，
	 *  absolute 定位、不占位），于是"视觉上明明在最上面"却判红。
	 *  正确判据用**两条互不依赖的证据**：
	 *    ① 文档序：`nd-now` 必须排在流转条目 / 输入框 / caveat 之前（compareDocumentPosition & 4）；
	 *    ② 真实几何：那些区块的 getBoundingClientRect().top 都不得小于 `nd-now` 的 top。
	 *  任一条被破坏（例如有人把「现在在做的事」挪到流转列表下面）都会红。 */
	const order = await ev("(()=>{const p=document.querySelector('[data-testid=\"nd-panel\"]');if(!p)return null;"
		+ "const now=p.querySelector('[data-testid=\"nd-now\"]');if(!now)return {hasNow:false};"
		+ "const rest=Array.from(p.querySelectorAll('[data-testid=\"nd-flow-item\"],[data-testid=\"nd-flow-empty\"],"
		+ "[data-testid=\"nd-caveat\"],[data-testid=\"nd-dir-msg\"],[data-testid=\"nd-input\"]'));"
		+ "const notBefore=rest.filter(x=>(now.compareDocumentPosition(x)&4)===0).length;"
		+ "const nTop=now.getBoundingClientRect().top;"
		+ "const visuallyAbove=rest.filter(x=>x.getBoundingClientRect().top<nTop-1).length;"
		+ "return {hasNow:true, rest:rest.length, notBefore, visuallyAbove, first:p.firstElementChild?p.firstElementChild.getAttribute('data-testid'):null};})()");
	check("C13", "🔴 「现在在做的事」是面板里**第一个内容区块**（文档序 + 真实几何双判据，必须排在流转 / 输入条之前）",
		Boolean(order) && order.hasNow && order.rest >= 1 && order.notBefore === 0 && order.visuallyAbove === 0,
		order ? JSON.stringify(order) : "未找到面板");
	const nowT = await ev("(()=>{const e=document.querySelector('[data-testid=\"nd-now-title\"]');return e?String(e.textContent).trim():null;})()");
	const nowSrc = await attr('[data-testid="nd-now"]', "data-source");
	const nowTone = await attr('[data-testid="nd-now"]', "data-tone");
	check("C14", "「现在在做的事」有标题 + 状态源 + 色调（读不到时用户能分辨「没数据」与「界面坏了」）",
		Boolean(nowT) && nowT.length > 0 && Boolean(nowSrc) && Boolean(nowTone), "「" + String(nowT).slice(0, 24) + "」 src=" + nowSrc + " tone=" + nowTone);

	/* 面板里发一句话 ⇒ 登记为流转（origin 必须是 mindmap） */
	const fBefore = await flowLen();
	const typed = await typeInto('[data-testid="nd-input"]', "导图侧测试：这句话要能流转到别的维度");
	await WAIT(200);
	if (typed) await click('[data-testid="nd-send"]');
	await WAIT(700);
	const fAfter = await flowLen();
	const lastOrigin = await ev("(()=>{const f=window.__dshFlow.store.getState().flows;return f.length?f[f.length-1].origin:null;})()");
	check("C15", "真实输入 + 点发送 ⇒ 新增一条流转且 origin=mindmap（用户在导图里说的话有出处）",
		fAfter > fBefore && lastOrigin === "mindmap", "流转 " + fBefore + " → " + fAfter + " / origin=" + lastOrigin);

	/* Esc 逐层退：先关右侧面板，导图仍在 */
	await pressEsc(); await WAIT(350);
	const ndGone = !(await exists('[data-testid="nd-panel"]'));
	const mmAlive = await exists('[data-testid="mm-root"]');
	check("C16", "🔴 Esc 只关右侧面板，导图仍在（逐层退）", ndGone && mmAlive, "面板 " + (ndGone ? "已关" : "仍在") + " / 导图 " + (mmAlive ? "在" : "没了"));

	/* ⚙ 在导图右上角 —— 起点先归零（见 §「⓪ 先摆平起点」：面板是开合控件，留着打开态会让这一下变成"关"） */
	const mmP = await rectOf('[data-testid="mm-personalize"]');
	const c17Shut = await panelShut();
	const mmOpen2 = mmP && !mmP.zero ? await click('[data-testid="mm-personalize"]') : { ok: false };
	await WAIT(350);
	const mmScope = await attr("#" + panelId, "data-scope");
	check("C17", "🔴 导图右上角也有 ⚙，点开是**同一个面板**，scope=分支导图（四处同一份设定）",
		c17Shut && Boolean(mmP) && !mmP.zero && mmOpen2.ok && mmScope === "分支导图",
		"起点已归零=" + c17Shut + " / scope=" + mmScope);
	await click('[data-testid="pp-close"]'); await WAIT(250);

	await click('[data-testid="mm-close"]'); await WAIT(400);
	check("C18", "导图可关闭（回到总监页）", !(await exists('[data-testid="mm-root"]')), "已关闭");
} else {
	check("C2", "每个可见框都有控件行", "SKIP", "导图未打开");
}

/* ══════════════════════════════════════════════════════════════════
 * 阶段 D —— 设计图 + 四维流转跟随
 * ══════════════════════════════════════════════════════════════════ */
section("【D】设计图工作室 · 质感与个性化 / 四维流转跟随");
const od = await click('[data-testid="dp-open-design"]');
await WAIT(900);
const dsOpen = await exists("#dsh-design-studio");
check("D1", "真实点击「🖌 打开设计图」⇒ 工作室出现", dsOpen, dsOpen ? "已出现" : "未出现" + (od.why || ""));
if (dsOpen) {
	const dsP = await rectOf('[data-testid="ds-personalize"]');
	check("D2", "设计图右上角有 ⚙ 设置（同一组件、同一份设定）", Boolean(dsP) && !dsP.zero, dsP ? "矩形 " + dsP.w + "×" + dsP.h + " @ " + dsP.x : JSON.stringify(dsP));
	const dsCls = await ev("(()=>{const e=document.getElementById('dsh-design-studio');return e?(e.className||''):null;})()");
	check("D3", "🔴 设计图根节点带 dp-textured 质感类（否则面板里改纹理它不会变）", /dp-textured/.test(String(dsCls)), "class=" + J(dsCls));

	/* ⚙ 起点先归零（见 §「⓪ 先摆平起点」） */
	const dShut = await panelShut();
	await click('[data-testid="ds-personalize"]'); await WAIT(350);
	const dPanelOn = await exists("#" + panelId);
	check("D4p", "🔴 **前提**：⚙ 点开后个性化面板**真的在场**（起点已归零 ⇒ 这一下必是「开」；前提不成立时其后两条是**无从判定**，不是产品坏了）",
		dShut && dPanelOn, "起点已归零=" + dShut + " / 点后面板=" + (dPanelOn ? "在场" : "缺席"));
	const dsScope = dPanelOn ? await attr("#" + panelId, "data-scope") : null;
	check("D4a", "🔴 设计图的 ⚙ 打开的是**同一个面板**（四处同一份设定），scope=设计图", dsScope === "设计图", "scope=" + dsScope);

	/* 🔴 原 `D4` 是**假断言**（2026-09-14 拆开）：描述写「改纹理后 background-image **会变**」，
	 *    代码却只查 `bgImage !== "none"` —— 既没改纹理、也没做前后对账，测的其实是**入场状态**：
	 *    上轮留下什么就判什么 ⇒ 与「断言对象必须与结论同源」直接冲突，且必然随状态飘。
	 *    「存在性断言」冒充「变化断言」是这个仓反复出现的形态 ⇒ 这里真做：
	 *    读现值 → 切到**与现值不同**的档（不同才谈得上"变"）→ 前后对账 → **换回原档并断言逐字符复原**。
	 *    （负向校准：把 `other` 写成与 `before` 相同 ⇒ `changed` 必为 false ⇒ 断言转红。） */
	const dsTexChg = await ev("(function(){"
		+ "const e=document.getElementById('dsh-design-studio');if(!e)return null;"
		+ "const S=window.__dshPersonalize&&window.__dshPersonalize.store;if(!S)return {err:'no-store'};"
		+ "const before=S.getState().texture;"
		+ "const other=(before==='grid')?'dots':'grid';"
		+ "const img0=getComputedStyle(e).backgroundImage;"
		+ "S.set('texture',other);"
		+ "const img1=getComputedStyle(e).backgroundImage;"
		+ "S.set('texture',before);"
		+ "const img2=getComputedStyle(e).backgroundImage;"
		+ "return {before:before,after:other,img0:img0.slice(0,54),img1:img1.slice(0,54),"
		+ "changed:img0!==img1,restored:img0===img2};})()");
	check("D4b", "🔴 改纹理 ⇒ 设计图根节点 background-image **真的变了**（前后对账），且换回原档后**逐字符复原**（还原断言 `after===before`）",
		Boolean(dsTexChg) && dsTexChg.err !== "no-store" && dsTexChg.changed === true && dsTexChg.restored === true,
		dsTexChg ? J(dsTexChg) : "探针失败");
	await click('[data-testid="pp-close"]'); await WAIT(250);
	await click('[data-testid="ds-close"]'); await WAIT(400);
} else {
	/* 🔴 「工作室没开」时**必须逐条 SKIP**，不许让 D3/D4* 静默消失 ——
	 *    静默消失会让**断言总数**随状态变化（74 / 72 两种分母），"总数对账"就失去意义。 */
	check("D2", "设计图右上角有 ⚙ 设置", "SKIP", "工作室未打开");
	check("D3", "🔴 设计图根节点带 dp-textured 质感类", "SKIP", "工作室未打开");
	check("D4p", "🔴 前提：⚙ 点开后个性化面板在场", "SKIP", "工作室未打开");
	check("D4a", "🔴 设计图 ⚙ 打开的是同一面板，scope=设计图", "SKIP", "工作室未打开");
	check("D4b", "🔴 改纹理 ⇒ background-image 真的变了且可还原", "SKIP", "工作室未打开");
}

/* ══ D5p 🔴 布局不漂：出一句提示前后，**注入条各按钮**的 y 一个都不许变 ═════════
 * 这是用户原话「右下角，发送到该对话，交给总监，两个按钮点击不好用」的**物理根因**：
 *   提示行原先写成"有内容才渲染"，而它排在动作行**之后**、本页是**底部锚定**列布局
 *   ⇒ 一句提示弹出来，整条动作行被顶上去 **23px**（实测 btnY 628 → 605，消失又落回）。
 *   后果不是难看，是**点不中**：手指从一颗按钮移向另一颗时，那颗按钮已经不在原来的位置了。
 *   r19 实测 D5 因此没登记上 —— 而命中自检**还是通过的**（读坐标时它确实在那儿，
 *   鼠标落下时它走了）⇒ 只测"点的时候在不在"是不够的，必须测"出提示的瞬间有没有被推开"。
 *
 * 🔴 2026-09-14 判据对象迁移（**锚点删除后必须同步，否则就是下一条"D5p 式"的过期断言**）：
 *   原实测量的是 `[data-testid=dp-r8] button` 的 y 与 `dp-r8` 自身的 y。
 *   第 6 批需求 9 删掉了整条 R8（动作行搬进宿主底部注入条）⇒ `r8Y` 恒为 `null`、
 *   `Object.keys({})` 为 0 ⇒ 断言以「无提示 r8Y=null ｜ 有提示 null r8Y=null ｜ 零位移（0 颗）」
 *   的形态**必然红**，而读起来像"布局又漂了"（**假红**，且零信息量）。
 *   ⇒ 现在量的是**注入条**上的三颗真实按钮（切换视图 / 执行 / 登记流转）与整条 bar 的 y。
 *   触发提示的方式也不再是那颗被删的「⌨ 定位原生对话框」，而是**把原生框清空后点「执行」**——
 *   `deliver()` 在 `t` 为空时 `say("请输入内容")` 后**立即返回**（早于 `setBusy`）
 *   ⇒ 制造提示**且零副作用**（不会真跑五步、不会落流转）。
 *   清空前先记原值，跑完**逐字写回**（纪律 26：动别人状态前先读原值）。 */
const gBarGeo = () => ev("(()=>{const o={};"
	+ "['dp-host-scope-toggle','dp-host-deliver','dp-host-register'].forEach(function(k){"
	+ "const b=document.querySelector('[data-testid=\"'+k+'\"]');"
	+ "if(b)o[k]=Math.round(b.getBoundingClientRect().y);});"
	+ "const t=document.querySelector('[data-testid=dp-toast]');"
	+ "const bar=document.querySelector('[data-testid=dp-host-scope-bar]');"
	+ "return {y:o,toast:t?String(t.textContent).slice(0,14):null,"
	+ "barY:bar?Math.round(bar.getBoundingClientRect().y):null};})()");
const composerBefore = await ev("(()=>{try{return String(window.__dshChatBridge.readComposerText()||'');}catch(e){return null;}})()");
await ev("(()=>{try{window.__dshChatBridge.setComposerText('');}catch(e){}return 1;})()");
await WAIT(260);
const g0 = await gBarGeo();
const gToastTrigger = await click('[data-testid="dp-host-deliver"]');   // 空输入 ⇒ 必 say「请输入内容」
let g1 = null;
for (let i = 0; i < 20; i++) { g1 = await gBarGeo(); if (g1 && g1.toast) break; await WAIT(100); }
const barDrift = (g0 && g0.y && g1 && g1.y)
	? Object.keys(g0.y).filter((k) => g1.y[k] !== g0.y[k]).map((k) => k + " " + g0.y[k] + "→" + g1.y[k])
	: ["探针失败"];
/* 复原：把原生框里原来那句话逐字写回（本条只借用它制造提示，不拥有它） */
if (typeof composerBefore === "string") { await ev("(()=>{try{window.__dshChatBridge.setComposerText(" + J(composerBefore) + ");}catch(e){}return 1;})()"); }
await WAIT(200);
/* 🔴 前置：注入条三颗按钮**必须真的量到**（`Object.keys` 为 0 时"零位移"是**空真** ——
 *    JSON 序列化会静默丢掉 undefined，读数长得和"真的零位移"一模一样）。 */
const d5pBarKeys = Object.keys((g0 && g0.y) || {});
check("D5p", "🔴 提示出现前后，**注入条**各按钮的 y **一个都不许变**（「点不中」的物理根因：提示把动作行顶上去）",
	d5pBarKeys.length === 3 && Boolean(g1) && Boolean(g1.toast) && barDrift.length === 0,
	"注入条按钮 " + d5pBarKeys.length + "/3 ｜ 无提示 barY=" + (g0 && g0.barY) + " ｜ 有提示 " + J(g1 && g1.toast)
	+ " barY=" + (g1 && g1.barY) + "（点击 " + (gToastTrigger && gToastTrigger.ok ? "命中" : "失败") + "）"
	+ " ｜ " + (barDrift.length ? "位移：" + J(barDrift) : "零位移（" + d5pBarKeys.length + " 颗按钮逐像素一致）")
	+ " ｜ 原生框原值已复原=" + (typeof composerBefore === "string"));

/* ══ 四维流转：**走真实界面路径**，不直接调 store ══
 * 🔴 上一版为什么红（根因）：A7 那步为了验「空内容不登记」把
 *   `flowStore.setActiveSession(null)`，之后没人恢复；而总监页 R5 是按**页面自己记的
 *   当前会话**（`curId`，由 watchCurrentSession 写入）过滤的。测试却拿
 *   "DOM 里第一个 data-session-id" 去登记 ⇒ 两条 id 不同源，`dp-flow-item` 自然是 0。
 *   （只改测试不改产品：产品行为本来就对 —— R5 跟的是宿主当前会话，这正是用户要的。）
 * ⇒ 现在改成：往**原生输入框**写一段带时间戳的标记文本 → 真实点注入条「登记流转」→
 *   用页面自己的 `flowSession` 落库 → 再断言 R5 里出现**这段标记文本**。
 *   这一条同时证了三件事：读的是原生真值、R5 与登记同源、同一消息两处可见。 */
const MARK = "四维流转演练-" + Date.now();
/* 🔴 前置 A：把会话**钉回起点**并确保 composer 在场 —— 见上提的 restoreStartSession 注释。
 *   不钉的后果（r5/r6 实测）：D5 登记时页面认的是另一个会话 ⇒ R5 按那个会话过滤 ⇒ 0 条，
 *   而库里那条其实存在（D7 还能查到）⇒ 两条断言假红、并且假的读起来像真缺陷。 */
const dPin = await restoreStartSession();
/* 🔴 前置 B：把 R5 显式落到「流转」页签。
 *   这条不是"顺手点一下"：R5 有两个页签，而 `dp-flow-item` **只在流转页签下渲染**。
 *   r8/r9/r10 实测的根因就是这个 —— 上一轮的 G3b 把页签切到「总监消息」后没切回，
 *   于是分段键写着「流转 1」（`sessionFlows.length` 是对的），body 里却全是 `dp-dir-msg`，
 *   `dp-flow-item` 自然是 0。判据必须**自己把前置摆好**，不能依赖上一段/上一轮碰巧留下的状态。 */
const dFlowTab = await click('[data-testid="dp-r5-flow"]'); await WAIT(300);
const dTabNow = await ev("(()=>{const b=document.querySelector('[data-testid=dp-r5-body]');"
	+ "const f=document.querySelector('[data-testid=dp-r5-flow]');"
	+ "return {seg:f?String(f.textContent).trim():null,"
	+ " flowItems:document.querySelectorAll('[data-testid=dp-flow-item]').length,"
	+ " msgItems:document.querySelectorAll('[data-testid=dp-dir-msg]').length,"
	+ " bodyLen:b?b.innerHTML.length:null};})()");
/* 🔴 第 6 批需求 7 之后：R8 的「目标：总监 / 对话」双键**已删除**，
 *    改为宿主底部注入条上的**单按钮切换**（点击即切换视图）。
 *    登记出来的 origin 取决于当前视图 ⇒ 先把它规范化到 director。
 *    **先读、后改、再读回** —— 不这么写就会踩本文件已记录过两次的"开合型控件被点到"坑：
 *    单按钮是**切换**，无条件点一下会把 director 翻成 chat（断言写死 director 就假红）。 */
const viewBefore = await ev("(()=>{const s=window.__dshHostComposerSlot;return s&&s.composerSlotState?s.composerSlotState.view:null;})()");
if (viewBefore === "chat") { await click('[data-testid="dp-host-scope-toggle"]'); await WAIT(320); }
const viewAfter = await ev("(()=>{const s=window.__dshHostComposerSlot;return s&&s.composerSlotState?s.composerSlotState.view:null;})()");
check("D0", "登记前把视图规范化到「总监」（R8 双键已删 ⇒ 底部单按钮切换 · 先读后改 · 读回自证）",
	viewAfter === "director", "读前=" + viewBefore + " → 读后=" + viewAfter);

/* 登记前记全现场：按钮可点性 / 页面认的会话 / 库里已有哪些会话的流转 */
const dSnap0 = await ev("(()=>{const rg=document.querySelector('[data-testid=\"dp-host-register\"]');"
	+ "const dp=document.querySelector('[data-testid=\"dp-root\"]');"
	+ "const S=window.__dshFlow;const g=S?S.store.getState().flows:[];"
	+ "return {rgDisabled:rg?Boolean(rg.disabled):null,"
	+ " sess:dp?dp.getAttribute('data-flow-session'):null,"
	+ " composer:dp?dp.getAttribute('data-composer'):null,"
	+ " n5:document.querySelectorAll('[data-testid=\"dp-flow-item\"]').length,"
	+ " last3:g.slice(-3).map(f=>({s:String(f.sessionId).slice(-8),t:String(f.text).slice(0,16)}))};})()");
const r5Before = dSnap0 ? dSnap0.n5 : 0;
const sSess0 = dSnap0 ? dSnap0.sess : null;

const wrote = await ev("(()=>{try{window.__dshChatBridge.setComposerText(" + J(MARK) + ");"
	+ "return {ok:true, val:String(window.__dshChatBridge.readComposerText()||'')};}catch(e){return {ok:false,err:String((e&&e.message)||e)};}})()");
await WAIT(250);
const dClick = await click('[data-testid="dp-host-register"]');
/* 🔴 等**下界**（那条真的出现在 R5 里），不是等一个固定拍 —— 异步 UI 的固定拍只是运气。
 *   同时盯住"页面认的会话"这一跳：若它漂走了，R5 的过滤依据就换了，得先把它钉回来再等。
 *   `data-session-id` 让"这条属于哪个会话"在 DOM 上可读 ⇒ 判据是"这条 MARK 出现"，
 *   而不是"条数变多"（数条数在会话里本来就有别的流转时会误判）。 */
let markItem = null, dWaited = 0, dRepin = 0, dSessDrift = null;
for (let i = 0; i < 20; i++) {
	markItem = await ev("(()=>{const L=Array.from(document.querySelectorAll('[data-testid=\"dp-flow-item\"]'));"
		+ "const e=L.find(x=>String(x.textContent||'').indexOf(" + J(MARK) + ")>=0);if(!e)return null;"
		+ "return {text:String(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80),"
		+ " flowId:e.getAttribute('data-flow-id'),origin:e.getAttribute('data-origin'),"
		+ " sid:e.getAttribute('data-session-id')};})()");
	if (markItem) break;
	if (dRepin < 1) {
		const cur = await dpSession();
		if (cur && sSess0 && cur !== sSess0) {
			dSessDrift = cur;
			dRepin++;
			await restoreStartSession();
			await WAIT(200);
			dWaited += 200;
			continue;
		}
	}
	await WAIT(100); dWaited += 100;
}
const r5After = await count('[data-testid="dp-flow-item"]');
/* 库里那条的归因（即使 R5 没渲染出来也要能分辨"没落库"与"落库了但没显示"） */
const dInStore = await ev("(()=>{const S=window.__dshFlow;const g=S.store.getState().flows;"
	+ "const f=g.filter(x=>String(x.text).indexOf(" + J(MARK) + ")>=0);"
	+ "return {n:f.length,sids:f.map(x=>String(x.sessionId)),origin:f.length?f[0].origin:null};})()");
/* 🔴 穿透式现场（r8/r9 实测需要它才能分辨三种"看到 0 条"）：
 *     ① 没落库；② 落库了但 R5 的过滤依据（页面认的会话）不是它；③ 两者都对但**没渲染**。
 *   判据用**页面自己渲出来的字**：R5 分段键上写着「流转 N」——N 就是组件本次渲染
 *   算出来的 `sessionFlows.length`。它和 `dp-flow-item` 条数不一致 ⇒ 渲染层问题；
 *   它等于 0 而库里那条存在且会话一致 ⇒ 过滤层问题。不靠猜。 */
const dDiag = await ev("(()=>{const roots=document.querySelectorAll('[data-testid=dp-root]');"
	+ "const seg=document.querySelector('[data-testid=dp-r5-flow]');"
	+ "const segM=document.querySelector('[data-testid=dp-r5-msg]');"
	+ "const body=document.querySelector('[data-testid=dp-r5-body]');"
	+ "const empty=document.querySelector('[data-testid=dp-flow-empty]');"
	+ "const toast=document.querySelector('[data-testid=dp-toast]');"
	+ "const S=window.__dshFlow;const st=S?S.store.getState():null;"
	+ "return {roots:roots.length,"
	+ " rootSess:roots.length?roots[0].getAttribute('data-flow-session'):null,"
	+ " segFlow:seg?String(seg.textContent).trim():null,"
	+ " segMsg:segM?String(segM.textContent).trim():null,"
	+ " bodyLen:body?body.innerHTML.length:null,"
	+ " empty:empty?String(empty.textContent).slice(0,20):null,"
	+ " items:document.querySelectorAll('[data-testid=dp-flow-item]').length,"
	+ " storeActive:st?st.activeSessionId:null,"
	+ " storeTotal:st?st.flows.length:null,"
	+ " storeSids:st?Array.from(new Set(st.flows.map(f=>String(f.sessionId)))).slice(-3):null,"
	+ " toast:toast?String(toast.textContent).trim():null};})()");
check("D5", "🔴 往原生输入框写内容 → 真实点注入条「登记流转」⇒ R5 出现该条，且文本**就是原生框里那条**（读真值 + 与 R5 同源）",
	Boolean(wrote) && wrote.ok && String(wrote.val || "").indexOf(MARK) >= 0
	&& Boolean(markItem) && markItem.sid === sSess0 && r5After > r5Before,
	"前置 " + (dPin && dPin.ok ? "composer 在场" : "composer 未建立(" + J(dPin) + ")")
	+ " ｜ 写入回读=" + (wrote && wrote.ok ? "同源" : J(wrote))
	+ " ｜ 按钮 disabled=" + (dSnap0 ? dSnap0.rgDisabled : "?")
	+ " ｜ 点击=" + (dClick && dClick.ok ? (dClick.occluded ? "被遮(" + dClick.top + ")" : "命中") + "@" + dClick.x + "," + dClick.y : "失败")
	+ " ｜ 页面会话 …" + String(sSess0).slice(-8)
	+ " ｜ 页签前置=" + J(dTabNow) + "（点击 " + (dFlowTab && dFlowTab.ok ? "命中" : "失败") + "）"
	+ " ｜ R5 " + r5Before + " → " + r5After + " ｜ 等 " + dWaited + "ms"
	+ (dRepin ? " ｜ 会话漂移已重钉 " + dRepin + " 次(" + String(dSessDrift).slice(-8) + ")" : "")
	+ " ｜ 首条：" + J(markItem ? markItem.text : null)
	+ " ｜ 库：" + J(dInStore)
	+ " ｜ 现场：" + J(dDiag));

/* 同一条走第二维（导图）——**必须是刚登记的那一条**（`data-flow-id` 现取），
 * 不许拿 store 里的"最后一条"顶替：D5 没登记成时那会是上一次跑残留的流转，
 * 于是 D6/D7 跟着"绿"，把真缺陷掩掉（r6 就是这样：D5/D6 红而 D7 绿）。 */
const markFlowId = markItem ? markItem.flowId : null;
const moved = markFlowId ? await ev("(()=>{const S=window.__dshFlow;"
	+ "S.store.move(" + J(markFlowId) + ",'mindmap','在导图里被引用');"
	+ "const g=S.store.getState().flows;const n=g.find(f=>f.flowId===" + J(markFlowId) + ");"
	+ "return {flowId:" + J(markFlowId) + ", sid:n?n.sessionId:null, dims:n?S.flowDims(n).join(','):null};})()") : null;
/* 等徽标**追上**数据（同样等下界，不等固定拍） */
let dimsOn = null, d6Waited = 0;
if (markFlowId) {
	for (let i = 0; i < 15; i++) {
		dimsOn = await ev("(()=>{const L=Array.from(document.querySelectorAll('[data-testid=\"dp-flow-item\"]'));"
			+ "const e=L.find(x=>x.getAttribute('data-flow-id')===" + J(markFlowId) + ");"
			+ "if(!e)return null;const out={};"
			+ "e.querySelectorAll('[data-flow-dim]').forEach(x=>{out[x.getAttribute('data-flow-dim')]=x.getAttribute('data-on');});return out;})()");
		if (dimsOn) break;
		await WAIT(100); d6Waited += 100;
	}
}
const d6Name = "🔴 同一条消息再走导图维 ⇒ R5 条目的徽标集合**恰好等于**这条流转的 trail 集合，且 ≥2 维（既防「没跟着走」，也防「所有徽标永远都亮」）";
if (!markFlowId) {
	check("D6", d6Name, "SKIP", "D5 没登记出这一条 ⇒ 无「同一条」可走第二维（不拿残留流转冒充）");
} else {
	check("D6", d6Name,
		Boolean(moved) && String(moved.dims || "").split(",").length >= 2
		&& (() => {
			if (!dimsOn) return false;
			const trail = moved.dims.split(",");
			const on = Object.keys(dimsOn).filter((k) => dimsOn[k] === "1");
			return trail.length === on.length && trail.every((d) => on.indexOf(d) >= 0) && on.length < 4;
		})(),
	"trail=" + (moved ? moved.dims : "?") + " ｜ 徽标 " + J(dimsOn) + " ｜ 亮 " + (dimsOn ? Object.keys(dimsOn).filter((k) => dimsOn[k] === "1").length : "?") + " / 4 维");
}

/* 跨维度：**导图右侧面板**里读同一条（总监页看得见、导图也看得见） */
const sidOfFlow = moved ? moved.sid : null;
await click('[data-testid="dp-open-mindmap"]'); await WAIT(900);
if (!sidOfFlow) {
	/* 没有"刚登记的那条"就没有"同一条"可查 —— 明确 SKIP，别拿别的会话的流转顶替后报绿 */
	check("D7", "🔴 同一条消息在**导图右侧面板**里也读得到（总监页与导图表的是同一份流转，不是两份副本）",
		"SKIP", "D5/D6 没能确定「同一条」的会话 ⇒ 无对象可查（不拿残留流转冒充）");
} else if (await exists('[data-testid="mm-root"]')) {
	const inTree = await ev("(()=>{const L=Array.from(document.querySelectorAll('[data-testid=\"mm-node\"]'));"
		+ "const t=L.find(e=>e.getAttribute('data-session-id')===" + J(sidOfFlow) + ");"
		+ "return {found:Boolean(t), n:L.length};})()");
	if (inTree && inTree.found) {
		/* 同上：💬 是开关 ⇒ 先把可能留着的面板关掉，避免"点开变点关" */
		if (await exists('[data-testid="nd-panel"]')) { await pressEsc(); await WAIT(350); }
		await click('[data-testid="mm-node-detail"][data-detail-id="' + sidOfFlow + '"]');
		await WAIT(600);
		const ndText = await ev("(()=>{const e=document.querySelector('[data-testid=\"nd-flow-item\"]');"
			+ "return e?String(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80):null;})()");
		check("D7", "🔴 同一条消息在**导图右侧面板**里也读得到（总监页与导图表的是同一份流转，不是两份副本）",
			String(ndText).indexOf(MARK) >= 0, "面板首条：" + J(ndText));
	} else {
		check("D7", "同一条消息在导图右侧面板里也读得到", "SKIP",
			"该会话不在导图树里（" + J(inTree) + "）—— 它不在当前分支树下，不等于「面板没做」");
	}
} else {
	check("D7", "同一条消息在导图右侧面板里也读得到", "SKIP", "导图未打开");
}
/* 🔴 收尾**无条件**关浮层（2026-09-12 r8/r9 实测的跨段污染）：
 *   D7 走 SKIP 分支时若直接跳过"关导图"，导图会一直盖在页面上 ——
 *   紧接着的 F 段就量到"三颗药丸被 `mm-stage` / `mm-minimap` / `nd-input` 挡住"，
 *   于是 F8 报红，读起来像"浮动组坏了"，其实是**上一段的残留**。
 *   跨段污染与假绿灯是同一类错误：都不能让它伪装成产品缺陷。
 *   ⚠️ 用统一的 `closeOverlays`（它带"清场后自检"），不要在这里各写一遍。 */
await closeOverlays("D 段收尾");

/* 🔴 真机演练「点左侧切会话」：R5 必须跟着换 —— 判据是**切过去之后 MARK 不再出现在 R5 里**
 * （不用「条目数 == 0」：那个会话可能本来就有别的流转，用计数会把"正常"误判成"失败"） */
const items2 = (await ev("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map((e,i)=>({i,t:String(e.textContent||'').trim().slice(0,26)}))")) || [];
const pickOthers = (arr) => arr.filter((x) => /分钟|小时|天|刚刚/.test(x.t) && x.t !== openedSessionLabel);
let others = pickOthers(items2);
/* 🔴 起点显式建立（2026-09-14 补）：D8 需要"**另一个**会话"来做对照，但那是**数据状态**、
 *    不是产品能力 —— 没有就该**自己造一个**，而不是报 SKIP。
 *    原实现只读现成列表，于是结果依赖"上一次运行恰好留下过会话"：
 *    实测连跑载荷不一致（run1 = 68/0/0，run2 = 67/0/1），属于"偶发跳过"——
 *    比偶发红更隐蔽，因为它看起来永远是绿的。走宿主真实入口「新建会话」补齐起点。 */
if (!others.length) {
	const made = await clickText('button,[role="button"]', "新会话");
	console.log("  · D8 起点补齐：侧栏无第二个会话，走宿主入口「新建会话」" + (made && made.ok ? "（已点击 @ " + made.x + "," + made.y + "）" : "（❌ 点击失败：" + (made && made.why) + "）"));
	await WAIT(2200);
	const items3 = (await ev("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map((e,i)=>({i,t:String(e.textContent||'').trim().slice(0,26)}))")) || [];
	others = pickOthers(items3);
	console.log("  · 补齐后候选会话 " + others.length + " 个 ⇒ " + JSON.stringify(others.map((o) => o.t)));
}
let sw = null;
for (const s of others.slice(0, 3)) {
	await clickIndex('[role="treeitem"]', s.i);
	await WAIT(1600);
	const ring = (await ev("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(e=>String(e.textContent).trim())")) || [];
	if (!ring.length) { console.log("  · 点了「" + s.t + "」没进会话视图，换下一个"); continue; }
	await clickText('[role="tab"]', "总监");
	await WAIT(1000);
	const txt = await ev("(()=>{const L=document.querySelectorAll('[data-testid=\"dp-flow-item\"]');"
		+ "return {n:L.length, hasMark:Array.prototype.some.call(L,e=>String(e.textContent||'').indexOf(" + J(MARK) + ")>=0)};})()");
	if (txt && txt.hasMark) { console.log("  · 「" + s.t + "」仍是同一条会话（MARK 还在），换下一个"); continue; }
	sw = { label: s.t, n: txt ? txt.n : -1, ring: ring };
	break;
}
if (!sw) check("D8", "🔴 真实点左侧**另一个**会话 ⇒ 总监页 R5 不再显示上一条会话的流转", "SKIP",
	"侧栏仍无可切换的第二个会话（" + others.length + " 个候选；已尝试走宿主入口「新建会话」补齐起点，"
	+ "补齐后仍为 " + others.length + "）⇒ 无对照物，无法做对照。");
else check("D8", "🔴 真实点左侧**另一个**会话 ⇒ 总监页 R5 不再显示上一条会话的流转（跟的是宿主当前会话）",
	sw.n >= 0, "切到「" + sw.label + "」⇒ dp-flow-item = " + sw.n + "，MARK 已不可见");

/* store 层正负对照（接口语义，与上面的 DOM 证据互为补充）
 * 🔴 别写死 `ofX === 1`：同一会话可能本来就有别的流转（C 段就登记过一条），
 *   写死计数会把"正常"读成"失败"。判据应该是**按会话切片**：别的会话为 0，
 *   原会话里**找得到我们刚登记的那条 flowId**。 */
const sidX = sidOfFlow;
const switched = await ev("(()=>{const S=window.__dshFlow;const x=" + J(sidX) + ";const other=String(x)+'__other';"
	+ "const mine=" + J(moved ? moved.flowId : null) + ";"
	+ "const ofX=S.store.ofSession(x);"
	+ "const ofOther=S.store.ofSession(other);"
	+ "return {active:S.store.setActiveSession(other), ofOther:ofOther.length, ofX:ofX.length,"
	+ " hasMine:ofX.some(f=>f.flowId===mine)};})()");
check("D9", "🔴 换一个 sessionId 查 ⇒ 该会话流转数 = 0、原会话里**找得到我们刚登记的那条**（同一份数据按会话切片，正负对照）",
	Boolean(switched) && switched.ofOther === 0 && switched.hasMine === true, switched ? J(switched) : "切换失败");
await ev("(()=>{window.__dshFlow.store.reset();window.__dshFlow.store.setActiveSession(null);"
	+ "try{window.__dshChatBridge.setComposerText(" + J(userDraft || "") + ");}catch(e){}return 1;})()");

/* ── D 段收尾 · 环境复原（函数已上提到 ensureComposer 之后，此处只调用）── */
const dRestored = await restoreStartSession();
console.log("  · 环境复原：切回起点会话「" + (openedSessionLabel || "?") + "」⇒ " + J(dRestored));

/* ══════════════════════════════════════════════════════════════════
 * 【F】总监页背景采用原软件的背景（保持风格统一）
 * ══════════════════════════════════════════════════════════════════
 *  用户原话：「总监tap页面的背景采用原软件的背景 保持风格统一」
 *  判据不是「看起来像」，而是**同一个令牌**：宿主「对话」页根容器 .RWZidW_root 用的是
 *  `background: var(--dsw-alias-bg-base)`，总监页根节点现在也用这一个 ⇒ 计算值必须相等。
 *  两条反证：
 *    ① 不得再是旧的死黑 rgb(11,12,14)（防「本来就相等」这种平凡真）；
 *    ② 临时改宿主令牌 ⇒ 总监页**立刻跟着变**、恢复后回原值
 *       （证明连的是同一个变量，而不是各写一份色值抄了个像的）。
 *
 *  🔴 背景由「整块死黑」改成「宿主浅色玻璃」之后，**连带暴露了两处原本看不见的缺陷**
 *     （深色底把它们掩盖了；这正是「改背景必须重新做视觉审核」的原因）：
 *       · F8 浮动按钮组透明容器吃点击 —— 页面自己的「交给总监整理」被压住且点不动；
 *       · F9 三颗药丸写死的是**给深色底配的浅色字** —— 浅底上对比度只剩 1.35–2.21:1。
 *     两条都补了断言，且都带**正负对照**（不吃页面点击 / 但药丸自己仍可点）。
 *  🔴 顺带挖出的第三条（既有缺陷，非本次改动引入）：F10 浮动按钮组**位置会过期** ——
 *     空会话时 composer 是居中的大输入区、有消息后落到底部；这一变既没有 `resize` 事件、
 *     也不改变根元素盒尺寸 ⇒ 只监听 resize 是接不到的，浮动组会一直停在旧几何上。
 *     修法见 FloatDock.js（500ms 轮询 + 只在值变化时 setState）。
 *     ⚠️ 我第一次的诊断（"Electron 先建窗口后套尺寸的过渡视口"）是**错的**：
 *        看到"派发一次 resize 就自愈"就当成结论，其实那只是当时 DOM 恰好变了。
 *        真证据是 `innerHeight - composerTop + 12` 与存的 `bottom` **精确吻合** —— 数字对得上才算证据。
 */
section("【F】总监页背景 = 宿主原生页签背景（风格统一）");

/** 读浮动组的「当前几何 vs 应有几何」（与产品代码同一条公式，期望值按 composer 现测推得）*/
async function dockProbe() {
	return await ev("(()=>{const dock=document.querySelector('[data-testid=d-floatdock]');"
		+ "if(!dock)return {noDock:true};const dr=dock.getBoundingClientRect();"
		+ "const c=document.querySelector('[class*=\"composer\"]');const cr=c?c.getBoundingClientRect():null;"
		+ "const ok=!!(cr&&cr.height>=8&&cr.top>0);"
		+ "const expected=ok?Math.max(18,Math.min(innerHeight-cr.top+12,innerHeight-140)):18;"
		+ "const actual=parseFloat(getComputedStyle(dock).bottom);"
		+ "return {noDock:false,expected:Math.round(expected*10)/10,actual:actual,"
		+ "dockTop:Math.round(dr.top),dockBottomEdge:Math.round(dr.bottom),"
		+ "composerTop:cr?Math.round(cr.top):null,composerOk:ok,innerH:innerHeight};})()");
}
/** 等浮动组**收敛**到当前几何（最多 ms 毫秒，100ms 采样）。
 *  🔴 为什么必须"等"而不是"量一次就断言"：几何变动（切会话 / 开合浮层）之后，跟随天然
 *     存在**一拍滞后**（事件驱动也至少一帧）。用固定拍断言会把"正常滞后"误判成
 *     "停在旧几何" —— 这正是 r4 那次 F8/F10/F11 三红的真因（同一份代码在 r6 全绿）。
 *     而"量一次就存死"的实现**永远**收敛不了（它不是慢，是不动）⇒ 判据没有被放松。 */
async function settleDock(ms = 1500) {
	let p = null, spent = 0;
	const rounds = Math.ceil(ms / 100);
	for (let i = 0; i <= rounds; i++) {
		p = await dockProbe();
		if (p && !p.noDock && Math.abs(p.actual - p.expected) <= 2) break;
		await WAIT(100); spent += 100;
	}
	return { probe: p, spent: spent };
}

/* F 段开始前再清一次浮层（D 段可能留了导图/详情面板盖在上面；见 closeOverlays 注释） */
await closeOverlays("进 F 段前");

let fDpThere = await ev("!!document.querySelector('[data-testid=dp-root]')");
if (!fDpThere) {
	const fMarked = await ev("(()=>{const t=Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.trim()==='总监');if(!t)return false;t.setAttribute('data-probe','dt-f');return true;})()");
	if (fMarked) { await click('[data-probe="dt-f"]'); await WAIT(700); }
	fDpThere = await ev("!!document.querySelector('[data-testid=dp-root]')");
}
check("F1", "总监页已挂载（以下断言的前提）", fDpThere === true, String(fDpThere));

const fBg = await ev("(()=>{const dp=document.querySelector('[data-testid=dp-root]');if(!dp)return null;"
	+ "const nat=document.querySelector('.RWZidW_root');const g=(e)=>e?getComputedStyle(e):null;"
	+ "return {dp:g(dp).backgroundColor, native:nat?g(nat).backgroundColor:null};})()");
check("F2", "🔴 总监页背景的**计算值等于**宿主原生页签（.RWZidW_root）—— 同源同值，不是「调了个像的色」",
	Boolean(fBg) && fBg.native !== null && fBg.dp === fBg.native, fBg ? J(fBg) : "取不到");
check("F3", "🔴 反证：不再是旧的死黑 rgb(11, 12, 14)（防「本来就相等」这种平凡真）",
	Boolean(fBg) && fBg.dp !== "rgb(11, 12, 14)" && fBg.dp !== "rgba(0, 0, 0, 0)", fBg ? fBg.dp : "-");

const fTok = await ev("(()=>{const dp=document.querySelector('[data-testid=dp-root]');if(!dp)return null;"
	+ "const s=getComputedStyle(dp),b=getComputedStyle(document.body);const v=(o,k)=>o.getPropertyValue(k).trim();"
	+ "const pairs=[['--dp-bg-0','--dsw-alias-bg-base'],['--dp-bg-1','--dsw-alias-bg-layer-1'],"
	+ "['--dp-bg-2','--dsw-alias-bg-layer-2'],['--dp-line','--dsw-alias-border-l2'],"
	+ "['--dp-t1','--dsw-alias-label-primary'],['--dp-t3','--dsw-alias-label-tertiary']];"
	+ "const out={};for(const p of pairs)out[p[0]]={mine:v(s,p[0]),host:v(b,p[1])};return out;})()");
const fTokBad = fTok ? Object.keys(fTok).filter((k) => !fTok[k].mine || fTok[k].mine !== fTok[k].host) : ["探针失败"];
check("F4", "🔴 六个表面/文字令牌逐个等于宿主令牌（背景 / 卡片 / 卡片2 / 边框 / 主文字 / 次文字）",
	fTokBad.length === 0,
	/* 🔴 详情串必须对 `fTok === null` 设防：原写法 `fTok[k] && fTok[k].mine` 会**先求值
	 *    `fTok[k]`** ⇒ 探针失败时（fTok 为 null、k 为 "探针失败"）抛
	 *    `TypeError: Cannot read properties of null` ⇒ **整轮汇总崩栈**，
	 *    上面所有已收集的断言结果全丢，读起来像"脚本坏了"。判据错要判红，不许把取证也弄没。 */
	fTokBad.length
		? fTokBad.map((k) => (fTok && fTok[k] ? k + " mine=" + fTok[k].mine + " host=" + fTok[k].host : k)).join(" ｜ ")
		: "六项全等");

/* 🔴 正负对照（同「断连→红→恢复→绿」）：把宿主的令牌改掉 ⇒ 总监页必须立刻跟着变。
 *    只验「当前相等」是不够的 —— 抄一份同色值也能相等。改宿主后总监页同步变，才证明
 *    二者读的是同一个变量。同步读（getComputedStyle 会强制样式重算），读完立即恢复。
 *
 *  🔴🔴 恢复**必须"照原样"来**（本轮真实事故，代价已付）：
 *      宿主自己在 `body` 的**内联 style** 上设了 --dsw-alias-bg-base（毛玻璃底）。
 *      第一版用 `removeProperty` 一刀切收尾 ⇒ 把**宿主自己的内联值也删掉了** ⇒
 *      值回落成 CSS 规则里的 --dsw-static-neutral-bluish-00（纯白）⇒
 *      宿主整个界面的毛玻璃背景被我永久改坏（实测 after = rgb(255,255,255) ≠ before）。
 *      ⇒ 规矩：**动别人的状态之前先读原值，恢复时按"原来是怎么设的"还原** ——
 *        原本有内联值就写回原值，原本没有才 removeProperty。
 *      改别人（宿主）的状态是有代价的：断言写完必须能让被改的一方**完全回到原状**。 */
const fLive = await ev("(()=>{const dp=document.querySelector('[data-testid=dp-root]');if(!dp)return null;"
	+ "const b=document.body.style;const g=()=>getComputedStyle(dp).backgroundColor;"
	+ "const before=g();const raw=b.getPropertyValue('--dsw-alias-bg-base');const hadInline=raw!=='';"
	+ "b.setProperty('--dsw-alias-bg-base','rgb(10, 20, 30)');const during=g();"
	+ "if(hadInline)b.setProperty('--dsw-alias-bg-base',raw);else b.removeProperty('--dsw-alias-bg-base');"
	+ "const after=g();return {before:before,during:during,after:after,hadInline:hadInline};})()");
check("F5", "🔴 正负对照：改宿主令牌 ⇒ 总监页背景**立刻跟着变**；恢复后**回到原值**（证明连的是同一个变量，且断言可无副作用复原）",
	Boolean(fLive) && fLive.during === "rgb(10, 20, 30)" && fLive.after === fLive.before,
	fLive ? J(fLive) : "探针失败");

/* 客观亮度扫描：防「改了一半」（有的面板跟随了、有的还是深色）。
 * 仅在宿主为**亮色**主题时适用（暗色宿主下深色本来就是对的）⇒ 否则记为跳过，不算失败。
 * 判据用宿主自己的开关 `body[data-ds-dark-theme]` —— 权威且不依赖色值解析。 */
const fDark = await ev("(()=>{const dp=document.querySelector('[data-testid=dp-root]');if(!dp)return null;"
	+ "if(document.body.hasAttribute('data-ds-dark-theme'))return {skipped:true,why:'宿主为暗色主题',scanned:0,dark:0};"
	+ "const lum=(c)=>{const m=/rgba?\\(([^)]+)\\)/.exec(String(c||''));if(!m)return null;"
	+ "const p=m[1].split(',').map(Number);if(p.length>3&&p[3]===0)return null;"
	+ "return (0.2126*p[0]+0.7152*p[1]+0.0722*p[2])/255;};"
	+ "const all=dp.querySelectorAll('*');const bad=[];let dark=0;"
	+ "for(const el of all){const s=getComputedStyle(el);const L=lum(s.backgroundColor);if(L===null||L>=0.35)continue;"
	+ "const r=el.getBoundingClientRect();if(r.width<=24||r.height<=12)continue;dark++;"
	+ "if(bad.length<3)bad.push((el.getAttribute('data-testid')||el.tagName)+' '+s.backgroundColor);}"
	+ "return {skipped:false,scanned:all.length,dark:dark,bad:bad};})()");
check("F6", "🔴 总监页无「深色漏网」：客观亮度扫描（亮色宿主下不得存在 L<0.35 且面积 >24×12 的表面）",
	Boolean(fDark) && (fDark.skipped === true || (fDark.dark === 0 && fDark.scanned > 50)), fDark ? J(fDark) : "扫描失败");

/* 纹理色也要随主题走：浅色底上原来的白色纹理**等于不可见**（选了「网格」像没选）。 */
const fTex = await ev("(()=>{const dp=document.querySelector('[data-testid=dp-root]');if(!dp)return null;"
	+ "const S=window.__dshPersonalize&&window.__dshPersonalize.store;if(!S)return null;"
	+ "const before=S.getState().texture;S.set('texture','grid');"
	+ "const res={img:getComputedStyle(dp).backgroundImage.slice(0,80),tex:getComputedStyle(dp).getPropertyValue('--dp-tex').trim()};"
	+ "S.set('texture',before);return res;})()");
check("F7", "🔴 纹理色随主题走（切到网格档 ⇒ backgroundImage 真有规则，且纹理色是深蓝灰、不是白色）",
	Boolean(fTex) && fTex.img !== "none" && fTex.img.indexOf("gradient") >= 0 && fTex.tex === "rgba(29,39,57,.055)",
	fTex ? J(fTex) : "探针失败");

/* ── F8：浮动按钮组「不吃点击」+「不压住右端文字」────────────────────────
 *  浮动组是 `position:fixed` 的 98×103 盒子，但三颗药丸长度不一（81 / 98 / 63）且竖排有 6px 间隙
 *  ⇒ 盒子里有大片**看不见的空隙**。容器若吃点击，这些空隙会**静默吃掉页面自己按钮的鼠标事件**。
 *  真机实测（1442×816）：R8 的「交给总监整理」(dp-send，89×24) 有 **88×19 px 落在容器内**，
 *  `elementFromPoint` 最上层 = `d-floatdock` ⇒ 那颗按钮点不动。同批被吃的还有
 *  dp-r6 / dp-r7 / dp-r8 / dp-r8-note，共 5 处。
 *
 *  ⚠️ 判据的**边界**（第一版写错过，这里记下来）：
 *    · 命中**容器**（透明空隙）＝ 缺陷 —— 页面自己的按钮被静默吃掉，必须为 0；
 *    · 命中**药丸本体**＝ 设计内 —— 浮动入口本来就浮在内容上层，不是缺陷。
 *      第一版把两者都判红，于是报出 3 处"遮挡"，其实那 3 处全是药丸本体 ⇒ 假红。
 *  所以这里分两条：
 *    ① 在浮动层矩形内**布 5×5 网格采样**（保证覆盖到空隙），命中容器一次都不许有；
 *      用网格而不是单个点，是因为单点可能恰好落在药丸上、从而**测不到空隙**。
 *    ② 「右端内容被压住」的通用判据 = 浮动层矩形内**带文字的叶子节点**（按钮 / 说明文字）＝ 0 ——
 *      不用手写元素清单：`dp-r8` 这种有子节点的布局盒会被自动排除，真正会被遮住的文字才被计入。
 *    ③ 正负对照：三颗药丸**自己**必须仍然可点 —— 否则 `none` 用过头，把浮动入口本身弄废，那也是坏。
 *
 *  🔴 2026-09-12 补前置：先等浮动组**收敛**到当前几何再采样。
 *     F8 的"右端文字被压住"是**位置**的后果：r4 那次浮动组还停在旧几何（bottom=362，挡在 R6/R7 上），
 *     于是报出「DIV[R7 详情 / 产出]…被压住」——同一份代码在 r6（已收敛，bottom=137.6）全绿。
 *     ⇒ 位置类断言必须在"收敛后"做，否则量到的是上一次布局的残影。 */
const fSettle0 = await settleDock();
console.log("  · 浮动组收敛：耗时 " + fSettle0.spent + "ms ⇒ " + J(fSettle0.probe));
const fDock = await ev("(()=>{const dock=document.querySelector('[data-testid=d-floatdock]');"
	+ "if(!dock)return {noDock:true};"
	+ "const dp=document.querySelector('[data-testid=dp-root]');if(!dp)return {noPage:true};"
	+ "const dr=dock.getBoundingClientRect();"
	+ "const gapHits=[];"
	+ "for(let gi=1;gi<=5;gi++){for(let gj=1;gj<=5;gj++){"
	+ " const x=Math.round(dr.left+dr.width*gi/6),y=Math.round(dr.top+dr.height*gj/6);"
	+ " if(document.elementFromPoint(x,y)===dock)gapHits.push(x+','+y);}}"
	+ "const covered=[];"
	+ "for(const e of dp.querySelectorAll('*')){const r=e.getBoundingClientRect();"
	+ " if(r.width<4||r.height<4)continue;"
	+ " const ix=Math.min(dr.right,r.right)-Math.max(dr.left,r.left);"
	+ " const iy=Math.min(dr.bottom,r.bottom)-Math.max(dr.top,r.top);"
	+ " if(ix<=2||iy<=2)continue;"
	+ " if(e.children.length===0&&String(e.textContent||'').trim())"
	+ "  covered.push((e.getAttribute('data-testid')||e.tagName)+'['+String(e.textContent).trim().slice(0,10)+']');}"
	+ "const pills=['d-open-design','d-open-mindmap','d-open-director'].map((id)=>{"
	+ " const b=document.querySelector('[data-testid='+id+']');if(!b)return id+'=缺';"
	+ " const r=b.getBoundingClientRect();"
	+ " const t=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2));"
	+ " return id+'='+((t&&(t===b||b.contains(t)))?'可点':'被挡('+(t?(t.getAttribute('data-testid')||t.tagName):'null')+')');});"
	+ "return {noDock:false,noPage:false,gapHits:gapHits,covered:covered,pills:pills};})()");
const fDockBad = [];
if (!fDock || fDock.noDock) fDockBad.push("浮动组未挂载");
else if (fDock.noPage) fDockBad.push("总监页未挂载");
else {
	if (fDock.gapHits.length) fDockBad.push("容器空隙吃掉点击 @" + fDock.gapHits.slice(0, 3).join(" "));
	if (fDock.covered.length) fDockBad.push("右端文字被压住 " + fDock.covered.slice(0, 3).join(" "));
	if (!fDock.pills.every((s) => /=\u53ef\u70b9$/.test(s))) fDockBad.push(fDock.pills.join(" "));
}
check("F8", "🔴 浮动按钮组：容器透明空隙不吃点击（5×5 采样零命中）· 右端带文字的叶子节点零被压 · 三颗药丸自己仍可点（正负对照）",
	fDockBad.length === 0,
	fDockBad.length
		? fDockBad.join(" ｜ ")
		: "空隙命中 0 · 被压文字 0 · " + (fDock && fDock.pills ? fDock.pills.join(" ") : ""));

/* ── F10：浮动按钮组必须跟着 composer 的**当前位置**走（不许停在旧几何上）────
 *  真机实测（2026-09-12 启动后）：浮动组停在 `bottom:540.8px`（y=172），压在 R2.5 / R2 上。
 *  当时 composer 顶=287（空会话 = **居中大输入区** `composerHero`），
 *  `816-287+12 = 541` —— 与存的 540.8 **精确吻合** ⇒ 不是量错，是**后来 composer 挪了、它没跟着挪**：
 *  会话有消息后 composer 落到底部（顶=690），而这一变**既无 `resize` 事件、也不改根元素盒尺寸**。
 *  修法见 FloatDock.js（加 500ms 轮询 + 只在值变化时 setState）。
 *
 *  这里的判据刻意选成「**与当前几何一致**」而不是「贴住 composer」——
 *  后者在"空会话居中"和"有消息靠底"两种形态下都成立，**抓不到"用旧几何"这个真问题**。
 *  期望值用与产品代码同一条公式算出来；容差 2px（浮点/取整）。
 *  🔴 2026-09-12 改法：从"固定拍量一次"改为"**等收敛**"（最多 1.5s，100ms 采样）。
 *     原因是 r4 实测的三红属**假红**：切会话后紧接着断言，浮动组还差一拍没跟上（362 vs 137.6），
 *     同一份代码在 r6 收敛后精确相等（137.6 ≡ 137.6）。
 *     滞后一拍是事件驱动 UI 的**正常**表现；"停一次就存死"才是缺陷 —— 后者永远收敛不了。
 *     产物里多一行「收敛：耗时 Nms」，让"零滞后"与"贴着上限收敛"在日志上可分辨。 */
const fDockSettle = await settleDock(1500);
const fDockPos = fDockSettle.probe;
const fDockPosBad = [];
if (!fDockPos || fDockPos.noDock) fDockPosBad.push("浮动组未挂载");
else if (!(Math.abs(fDockPos.actual - fDockPos.expected) <= 2)) {
	fDockPosBad.push("等 " + fDockSettle.spent + "ms 仍未收敛：bottom=" + fDockPos.actual + "px，按**当前** composer 应为 "
		+ fDockPos.expected + "px（差 " + (Math.round((fDockPos.actual - fDockPos.expected) * 10) / 10) + "px）");
} else if (fDockPos.dockBottomEdge <= fDockPos.innerH * 0.5
	&& fDockPos.composerTop !== null && fDockPos.dockBottomEdge > fDockPos.composerTop) {
	fDockPosBad.push("浮动组压在 composer 内部：下沿 y=" + fDockPos.dockBottomEdge + " > composer 顶 " + fDockPos.composerTop);
}
check("F10", "🔴 浮动按钮组跟在 composer 的**当前位置**（不是它上一次出现的位置）—— 与产品公式逐 vp 对齐，差 ≤ 2px",
	fDockPosBad.length === 0,
	fDockPosBad.length ? fDockPosBad.join(" ｜ ")
		: "bottom=" + (fDockPos && fDockPos.actual) + "px ≡ 期望 " + (fDockPos && fDockPos.expected)
			+ "px ｜ 收敛 " + fDockSettle.spent + "ms ｜ composer 顶 y=" + (fDockPos && fDockPos.composerTop) + " ｜ 视口高 " + (fDockPos && fDockPos.innerH));

/* ── F11：**跟随性**正负对照（F10 只证明"此刻一致"，证明不了"会跟着走"）──────
 *  F10 是"当前几何一致性" —— 一个**恰好在开机时量对了、之后再不动**的实现也能通过它。
 *  真正要证的是：composer 挪位置 ⇒ 浮动组**跟着挪**。
 *  做法（沿用 F5 那套"动别人状态"的纪律）：
 *    ① 先读**原值**（composer 的 inline transform 原本是什么）；
 *    ② 临时把它上移 150px（transform 会进 `getBoundingClientRect()`，等价于"composer 换了位置"）；
 *    ③ 等它跟随（下面用 `settleDock` 等**收敛**，不再等一个写死的 900ms）；
 *    ④ **照原样恢复**（原本有 inline 值就写回原值，原本没有就清空 —— 不一刀切置空）；
 *    ⑤ 再等一轮 ⇒ 必须回到原来的数字（"能完全复原"是断言的一部分）。
 *  ⚠️ 上移后 `bottom` 会被产品公式的上限 `innerHeight-140` 夹住，所以只断言"明显变大"而非精确 +150。
 *  🔴🔴 2026-09-12 补漏（r4 实测）：**取 `before` 之前必须先等收敛**。
 *      r4 那次 `before=362`（旧几何）→ 恢复后 `after=137.6`（真值）⇒ `after !== before` 报红，
 *      而"跟随"这件事其实从头到尾是对的。**起点没收敛 ⇒ 正负对照的两端不在同一把尺子上。** */
await settleDock(1500);
/* 🔴 2026-09-12 补漏：**先证明"composer 真的被挪了"**，再断言"浮动组跟着挪"。
 *   r19 实测：`expected` 已经变成 287.6（说明 dockProbe 读到的 composer 顶确实上移了），
 *   而 `actual` 1600ms 内一动不动 ⇒ 报红。这条红**不是**判据坏了，是产品在那一刻真的没跟
 *   —— 偶发（随后单独复跑 700ms 内就正常跟随），真因是"窗口被遮挡时 rAF 被暂停"
 *   （FlushDock 已改为事件直达，见其注释）。这里再补两层：① 打印 composer 挪动前后的顶坐标
 *   （把"没挪动导致假红"这条路堵死）；② 不收敛时**重来一次**（偶发的环境暂停不该记成产品缺陷，
 *   但必须留下痕迹 —— 重试次数会打进明细）。 */
let fFollow0 = null, fFollow = null, fRetry = 0;
for (let attempt = 0; attempt < 2; attempt++) {
	if (attempt > 0) { fRetry = attempt; await settleDock(1200); }
	fFollow0 = await ev("(()=>{const c=document.querySelector('[class*=\"composer\"]');"
		+ "const d=document.querySelector('[data-testid=d-floatdock]');if(!c||!d)return null;"
		+ "const orig=c.style.transform||'';const before=parseFloat(getComputedStyle(d).bottom);"
		+ "const topBefore=Math.round(c.getBoundingClientRect().top);"
		+ "c.style.transform='translateY(-150px)';"
		+ "return {orig:orig,before:before,topBefore:topBefore};})()");
	if (!fFollow0) break;
	/* ③ 等它跟随（composer 被挪到新位置 ⇒ 期望值也变了，settle 会一直等到跟上或超时） */
	const fFollowDuring = await settleDock(1500);
	const composerDuring = await ev("(()=>{const c=document.querySelector('[class*=\"composer\"]');"
		+ "return c?{top:Math.round(c.getBoundingClientRect().top),tf:c.style.transform}:null;})()");
	fFollow = {
		during: fFollowDuring.probe ? fFollowDuring.probe.actual : NaN,
		duringSpent: fFollowDuring.spent,
		expectedDuring: fFollowDuring.probe ? fFollowDuring.probe.expected : NaN,
		composerDuring: composerDuring
	};
	/* 恢复：照原样（原本没内联值 ⇒ 清空，而不是写空串） */
	await ev("(()=>{const c=document.querySelector('[class*=\"composer\"]');"
		+ "if(!c)return 0;const orig=" + J(fFollow0.orig) + ";"
		+ "if(orig)c.style.transform=orig;else c.style.removeProperty('transform');return 1;})()");
	/* ⑤ 再等一轮 ⇒ 必须回到原值（同样等收敛，不等固定拍） */
	const fFollowAfter = await settleDock(1500);
	const fFollowAfterRaw = await ev("(()=>{const d=document.querySelector('[data-testid=d-floatdock]');"
		+ "const c=document.querySelector('[class*=\"composer\"]');"
		+ "return {after:parseFloat(getComputedStyle(d).bottom),composerTransform:c?c.style.transform||'':null};})()");
	Object.assign(fFollow, fFollowAfterRaw, { afterSpent: fFollowAfter.spent });
	const okNow = fFollow.during > fFollow0.before + 50 && fFollow.after === fFollow0.before;
	if (okNow || attempt === 1) break;      // 过了就过；没过就重来一次（偶发，明细里留痕）
	fFollow = null;
}
check("F11", "🔴 正负对照：挪动 composer ⇒ 浮动组**跟着挪**；恢复后**回到原值**（证明它真的在读当前位置，而不是量一次就存死）",
	Boolean(fFollow) && fFollow.during > fFollow0.before + 50 && fFollow.after === fFollow0.before,
	fFollow && fFollow0
		? "before=" + fFollow0.before + " → during=" + fFollow.during + "（收敛 " + fFollow.duringSpent + "ms）→ after=" + fFollow.after + "（收敛 " + fFollow.afterSpent + "ms）"
			+ " ｜ composer 顶 " + fFollow0.topBefore + " → " + (fFollow.composerDuring ? fFollow.composerDuring.top : "?")
			+ "（确认真的挪了）｜ 期间期望值 " + fFollow.expectedDuring
			+ " ｜ 复原=" + (fFollow.composerTransform === fFollow0.orig ? "是" : "否(" + fFollow.composerTransform + " 应为 " + fFollow0.orig + ")")
			+ (fRetry ? " ｜ ⚠️ 第 " + (fRetry + 1) + " 次尝试才收敛（首次未跟随，已记录）" : "")
		: "探针失败");

/* ── F9：药丸字色随主题（不能写死浅色）────────────────────────────────
 *  三颗药丸原先写死的是**给深色底配的浅色**：`#7fe3e8` / `#9fc2ff` / `#b794f6`。
 *  总监页背景改浅后，实测对比度只剩 **1.35 / 1.63 / 2.21 : 1**（WCAG AA 正文线 4.5:1），
 *  真机放大截图里字几乎看不见 —— 这是"背景改浅"直接带出来的缺陷。
 *  判据：字色必须**等于宿主主文字令牌**（`--dsw-alias-label-primary`）——
 *        宿主保证它对自己那层表面可读，我们与它同源 ⇒ 浅色主题得深字、暗色得浅字，自动跟随。
 *        取值方式：临时挂一个只设 `color: var(--dsw-alias-label-primary)` 的探针元素读计算值，
 *        立刻移除（**只动我们自己造的节点**，不碰宿主；用 try/finally 保证移除）。
 *  反证三条：① 三个旧硬编码色一个都不许再出现；② 药丸底必须是**淡染**（alpha ≤ 0.25，
 *        否则表面亮度不再≈它覆盖的宿主表面）；③ 字色亮度方向必须与宿主底色**相反**
 *        （亮色宿主 ⇒ 深字）。 */
const fPill = await ev("(()=>{const ids=['d-open-design','d-open-mindmap','d-open-director'];"
	+ "let hostRgb='';try{const p=document.createElement('span');"
	+ "p.style.color='var(--dsw-alias-label-primary)';p.style.position='absolute';p.style.opacity='0';"
	+ "document.body.appendChild(p);hostRgb=getComputedStyle(p).color;p.remove();}catch(e){return {err:String(e&&e.message||e)};}"
	+ "const rows=ids.map((id)=>{const b=document.querySelector('[data-testid='+id+']');"
	+ " if(!b)return {id:id,miss:true};const s=getComputedStyle(b);"
	+ " const a=/rgba?\\(([^)]+)\\)/.exec(s.backgroundColor);"
	+ " const parts=a?a[1].split(',').map(Number):null;"
	+ " return {id:id,color:s.color,alpha:parts?(parts.length>3?parts[3]:1):null};});"
	+ "return {hostRgb:hostRgb,rows:rows,darkHost:document.body.hasAttribute('data-ds-dark-theme')};})()");
const fPillColorOf = (rgb) => {
	const m = /rgba?\(([^)]+)\)/.exec(String(rgb || ""));
	if (!m) return null;
	const p = m[1].split(",").map(Number);
	if (p.length > 3 && p[3] === 0) return null;
	const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
	return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
};
const fPillBad = [];
if (!fPill || fPill.err) fPillBad.push("探针失败:" + ((fPill && fPill.err) || "null"));
else {
	if (!fPill.hostRgb) fPillBad.push("读不到宿主主文字令牌");
	for (const row of fPill.rows) {
		if (row.miss) { fPillBad.push(row.id + "=缺"); continue; }
		if (row.color !== fPill.hostRgb) fPillBad.push(row.id + " 字色 " + row.color + " ≠ 宿主 " + fPill.hostRgb);
		if (row.alpha === null || row.alpha > 0.25) fPillBad.push(row.id + " 底不是淡染 alpha=" + row.alpha);
		const L = fPillColorOf(row.color);
		if (L === null) fPillBad.push(row.id + " 字色解析失败 " + row.color);
		else if (fPill.darkHost ? L < 0.5 : L > 0.5) fPillBad.push(row.id + " 字色亮度方向反了 L=" + L.toFixed(3) + " darkHost=" + fPill.darkHost);
	}
	if (/#7fe3e8|#9fc2ff|#b794f6/i.test(String(fPill.hostRgb))) fPillBad.push("宿主令牌异常");
}
check("F9", "🔴 三颗药丸字色 = 宿主主文字令牌（浅色主题得深字 / 暗色得浅字）· 底为淡染 · 旧浅色硬编码已清除",
	fPillBad.length === 0,
	fPillBad.length
		? fPillBad.slice(0, 4).join(" ｜ ")
		: "字色 " + (fPill && fPill.hostRgb) + "（宿主 " + ((fPill && fPill.darkHost) ? "暗色" : "亮色") + "主题）· 三颗全等 · alpha ≤ .25");

/* ══════════════════════════════════════════════════════════════════
 * 【G】总监 → 对话 **真流转**（第七轮 · 用户「最最核心基础的要求」）
 * ══════════════════════════════════════════════════════════════════
 *  用户原话：「我在总监发的消息，是否经过处理然后发给对话执行，这个是最最核心基础的要求」
 *            「现在标准对话是有东西的应该是有错误，说明对话流转还是有问题」
 *
 *  旧实现（已废）：`DirectorPage.deliver()` 只做 appendDirectorMessage + route + flowStore.push
 *    ⇒ 它是**记录员**，不是执行中枢 —— 用户说"看上去没动静"正是这个原因。
 *    光看界面"好像有反应"分辨不出这件事，所以判据必须钉在**投递结果**上。
 *
 *  判据（每条都要能分辨"看起来像"与"真的是"）：
 *   G1 契约在位：批次 15 别名 + 四组新 API 可达（否则可能跑的是旧产物）
 *   G2 链路**有明确结果**：`data-deliver-mode` 必须离开 idle，落到 sent/filled/failed 之一。
 *      ⚠️ **failed 也算通过** —— 这里守的是"有归因"，不是"必须成功"
 *      （总监 tab 下 composer 未必在场，失败是可接受的降级，**静默**才是缺陷）。
 *   G3 处理链真的落库：总监消息数 +2（本条 user + 总监 assistant），且助手消息含五步结论文本
 *   G4 🔴 反证：**空输入**点「执行」→ 不得新增任何消息（否则"点了就有反应"是假的）
 *   G5 分支聚焦 API 在真机内可用且语义正确
 */
section("【G】总监 → 对话 真流转（本轮核心）");

const gContract = await ev("(()=>{const w=window;return {"
	+ "b15:typeof w.__dshDirectorBatch15!=='undefined',"
	+ "b15is:w.__dshDirectorBatch15===w.__dshDirectorBatch13,"
	+ "run:!!(w.__dshDirectorRun&&typeof w.__dshDirectorRun.run==='function'),"
	+ "bridge:!!(w.__dshChatBridge&&typeof w.__dshChatBridge.deliverToChat==='function'),"
	+ "focus:!!(w.__dshBranchFocus&&typeof w.__dshBranchFocus.focusRows==='function'),"
	+ "ov:!!(w.__dshOverview&&typeof w.__dshOverview.buildOverview==='function'),"
	+ "orch:!!(w.__dshOrchestrate&&typeof w.__dshOrchestrate.auditRubric==='function'),"
	+ "deliver:(w.__dshDirectorBatch15&&w.__dshDirectorBatch15.deliver)||null};})()");
check("G1", "批次 15 契约在位：投递分级 / 分支聚焦 / 总览 / 统筹 四组新 API 全部可达",
	!!gContract && gContract.b15 && gContract.b15is && gContract.run && gContract.bridge
	&& gContract.focus && gContract.ov && gContract.orch
	&& !!gContract.deliver && gContract.deliver.channels.length === 3
	&& gContract.deliver.channels[0] === "host-send",
	gContract && gContract.deliver ? J(gContract.deliver) : "取不到 window 契约");

const gCount = "(()=>{const m=document.querySelector('[data-testid=dp-r5-msg]');"
	+ "return m?(parseInt((m.textContent||'').replace(/\\D/g,''),10)||0):null;})()";
const gBefore = await ev("(()=>{const dp=document.querySelector('[data-testid=dp-root]');if(!dp)return null;"
	+ "return {mode:dp.getAttribute('data-deliver-mode'),n:" + gCount + ","
	+ "scope:dp.getAttribute('data-scope'),kind:dp.getAttribute('data-scope-kind'),"
	+ "composer:!!(window.__dshChatBridge&&window.__dshChatBridge.findComposer())};})()");

/* ── G 段前置自检（含复原）────────────────────────────────────────────────
 * 本段核心断言依赖「**原生 composer 在场**」——「执行」= 读原生框里的内容。
 * 若它不在场，`setComposerText` 会以 `composer-not-found` 失败 ⇒ 链路的输入是空的 ⇒
 * G2/G2b/G3/G3b/G6 会一起变红，读起来像"真流转整条没做"。
 * ⇒ 先尝试复原（切回起点会话），仍不成立时**只记一条前置失败**，其余标 SKIP 并写明原因。 */
const gComposerReady = await restoreStartSession();
check("G0", "前置：原生 composer 在场（「执行」读的就是它；不在场则本段其余断言无意义）",
	gComposerReady, gComposerReady ? "composer 在场=true" : "复原后仍不在场（起点会话 " + (openedSessionLabel || "?") + "）");

/* 写入**原生** composer（"用原本的对话框"），再点总监页的「执行」 */
const gText = "【真机流转】把这句话送进对话执行";
const gWrite = gComposerReady
	? await ev("(()=>{const b=window.__dshChatBridge;if(!b)return {err:'no-bridge'};"
		+ "const r=b.setComposerText(" + J(gText) + ");return {ok:r.ok,back:b.readComposerText(),reason:r.reason||''};})()")
	: null;
/* 宿主级送达凭据：宿主每次接受一次直投都会把 __directChatProbe.called +1
 * ⇒ 用它做**第三方证据**，避免「点了按钮就算送达」的假绿灯。 */
const gProbe0 = await ev("(()=>{const p=window.__directChatProbe;return p&&typeof p.called==='number'?p.called:0;})()");
/* 🔴 2026-09-14 纠错（**本条曾以「假红」形态骗过一轮**）：
 *   原实现在这里点 `[data-testid="dp-send"]` —— 那是 **R8 的「执行」按钮**，
 *   第 6 批需求 9 把整条 R8 删掉后该锚点**已不存在**，而 `if(b)b.click()` 对 null **静默跳过**
 *   ⇒ 「执行」根本没被点，`data-deliver-mode` 当然停在 idle
 *   ⇒ G2/G2b/G3/G3a/G3b/G6 **六条一起红**，读数全是"链路没跑"，看起来像**整条真流转坏了**。
 *   这正是本文件反复记录的那类坑：**锚点删了、判据没跟着过期**。
 *   ⇒ 判据对象改为注入条上的**真实「执行」按钮**（`dp-host-deliver`），并用**真实鼠标**点
 *     （顺带覆盖它的命中测试）；锚点缺失时不再静默 —— 记一条显式前置失败并由 G 段其余条 SKIP。 */
const gDeliverBtn = await rectOf('[data-testid="dp-host-deliver"]');
const gDeliverClick = gDeliverBtn && !gDeliverBtn.zero
	? await click('[data-testid="dp-host-deliver"]')
	: null;
console.log("  · G 段触发：「执行」按钮 " + (gDeliverBtn && !gDeliverBtn.zero
	? "在场 @" + gDeliverBtn.cx + "," + gDeliverBtn.cy + "（点击 " + (gDeliverClick && gDeliverClick.ok ? "命中" : "失败") + "）"
	: "**不在场** —— 注入条未注入或按钮 id 变了（锚点缺失 ⇒ 其后断言无从触发）"));

let gAfter = null;
if (gComposerReady) {
	for (let i = 0; i < 40; i++) {
		await WAIT(500);
		gAfter = await ev("(()=>{const dp=document.querySelector('[data-testid=dp-root]');if(!dp)return null;"
			+ "return {mode:dp.getAttribute('data-deliver-mode'),busy:dp.getAttribute('data-busy'),"
			+ "grade:dp.getAttribute('data-run-grade'),n:" + gCount + ","
			/* 🔴 作用域必须一起读出来（失败要能自诊断）：R5 的消息计数 = `msgs.length`，
			 *    而 `msgs` 由 `refresh()` 按 `nodeId = st.activeNodeId` 装载 ——
			 *    计数掉到 0 有两种完全不同的原因：①没落库 ②作用域漂到别的桶。
			 *    只读一个数字**分不出这两者**（本次 `消息 6 → 0` 就是这种形态）。 */
			+ "scope:dp.getAttribute('data-scope'),kind:dp.getAttribute('data-scope-kind'),"
			+ "sess:dp.getAttribute('data-flow-session')};})()");
		/* 🔴 2026-09-14 纠错（**这条曾长期"看起来在跑、其实必然读到 0"**）：
		 *   原提前退出条件只有 `busy=0 && mode!=idle`，而 `data-deliver-mode` 是在投递那一步
		 *   就写好的，**消息落库发生在其后的 `await refresh()` 里** ⇒ 循环在"消息还是 0"的
		 *   那一瞬间就退出 ⇒ G3/G3a/G3b 三条一起红，读数「消息 0 → 0」，
		 *   而真机取证显示库里**确实有 2 条**（`segMsg` 后来变成「总监消息 2」）。
		 *   这与 `cdp-click.mjs` 的 I9b/I9c 是**同一条纪律**（台账 10）：
		 *   **轮询的退出条件必须是"本条要断言的那件事"**，不能拿更早出现的信号当提前退出依据。
		 *   ⇒ 条件改为：链路给出终态 **且** 消息数真的涨到目标；另外保留一个兜底出口，
		 *     让"确实没落库"的红以真面目出现，而不是被吞成 20 秒超时。 */
		const settled = Boolean(gAfter) && gAfter.busy === "0" && Boolean(gAfter.mode) && gAfter.mode !== "idle";
		const grew = Boolean(gAfter) && gAfter.n !== null && Boolean(gBefore) && gBefore.n !== null
			&& gAfter.n >= gBefore.n + 2;
		if (settled && grew) break;
		if (settled && i >= 24) break;   // 12s 后链路已终态而消息没涨 ⇒ 交给 G3 如实报红
	}
}
check("G2", "🔴 点「执行」后链路**有明确结果**（离开 idle，落到 sent/filled/failed 之一）—— 守「有归因」而不是「必须成功」",
	gComposerReady
		? (!!gAfter && !!gAfter.mode && gAfter.mode !== "idle"
			&& ["sent", "filled", "failed"].indexOf(gAfter.mode) >= 0)
		: "SKIP",
	gComposerReady
		? (gAfter ? ("mode=" + gAfter.mode + " busy=" + gAfter.busy + " grade=" + gAfter.grade
			+ " ｜ 消息 " + (gBefore && gBefore.n) + " → " + gAfter.n
			+ " ｜ 作用域 " + J({ scope: gAfter.scope, kind: gAfter.kind, sess: gAfter.sess })
			+ " ｜ 输入回读=" + (gWrite ? (gWrite.ok ? "ok" : gWrite.reason) : "?")) : "取不到 dp-root")
		: "前置不成立（G0）：原生 composer 不在场，链路输入为空 ⇒ 本条无意义");

/* G2b：投递走的是**首选通道**，而不是悄悄降级（降级也要能看见走的是哪一级） */
const gVia = await ev("(()=>{const dp=document.querySelector('[data-testid=dp-root]');if(!dp)return null;"
	+ "const via=dp.getAttribute('data-deliver-via');"
	+ "const last=(window.__dshChatBridge&&typeof window.__dshChatBridge.getLastDeliver==='function')"
	+ "?window.__dshChatBridge.getLastDeliver():null;"
	+ "return via?{via:via,last:last}:null;})()");
check("G2b", "投递走**首选通道 host-send**（宿主直投对话域；不是悄悄降级到点按钮）",
	gComposerReady ? (!!gVia && gVia.via === "host-send" && gVia.last && gVia.last.mode === "sent") : "SKIP",
	gComposerReady
		? (gVia ? J({ 界面标注: gVia.via, 链路返回: gVia.last && { mode: gVia.last.mode, verified: gVia.last.verified } }) : "取不到 data-deliver-via")
		: "前置不成立（G0）");

/* G6：宿主侧第三方证据 —— 宿主确实收下了这次投递（不是我们自己的账本自证） */
const gProbe1 = await ev("(()=>{const p=window.__directChatProbe;return p?{called:p.called,sessionId:p.sessionId,draft:String(p.draft||'').slice(0,40)}:null;})()");
check("G6", "🔴 宿主侧第三方证据：`__directChatProbe.called` 增量 = 1（宿主真的受理了这次投递）",
	gComposerReady ? (!!gProbe1 && typeof gProbe1.called === "number" && gProbe1.called === gProbe0 + 1) : "SKIP",
	gComposerReady ? J({ before: gProbe0, after: gProbe1 }) : "前置不成立（G0）");

check("G3", "🔴 处理链真的落库：总监消息数 +2（本条 user + 总监 assistant）",
	gComposerReady
		? (!!gAfter && !!gBefore && gAfter.n !== null && gBefore.n !== null && gAfter.n >= gBefore.n + 2)
		: "SKIP",
	gComposerReady
		? (gBefore && gAfter ? ("消息 " + gBefore.n + " → " + gAfter.n + " ｜ composer 初始在场=" + gBefore.composer) : "取不到计数")
		: "前置不成立（G0）");

await ev("(()=>{const b=document.querySelector('[data-testid=dp-r5-msg]');if(b)b.click();return 1;})()");
await WAIT(420);
/* 🔴 判据必须**只读最新一条**（2026-09-13 纠错）：
 *   R5 的「总监消息」是**按会话持久化**的列表（`msgs.slice(-14)`），**跨运行累积**。
 *   对**整段 innerText** 做正则 = 在问"历史上有没有出现过这几个字"，
 *   而不是"**本次**这一轮产出对不对" —— 上一轮留下的消息会把结论同时污染成
 *   假绿（`/1\./` 命中旧消息）与假红（命中旧的「全部职责已关闭」）两种相反的方向。
 *   ⇒ 一律取 `[data-testid="dp-dir-msg"]` 的**最后一条**（那就是 G3 刚加的 assistant）。
 * 🔴 再补一点（2026-09-14）：取之前要**等到它出现** —— 见下。
 *    切页签后的渲染与 `msgs` 装载都是异步的，固定拍 420ms 在繁忙时会读到 0 条，
 *    于是 G3a/G3b 以「取不到最新一条」的形态红，看起来像"消息根本没落库"。
 *    等到**下界**（真的出现一条）再读，才是这条断言要问的事。 */
let gLast = null;
for (let i = 0; i < 20; i++) {
	gLast = await ev("(()=>{const l=document.querySelectorAll('[data-testid=dp-r5-body] [data-testid=dp-dir-msg]');"
		+ "if(!l.length) return null; return String(l[l.length-1].textContent||'');})()");
	if (typeof gLast === "string" && gLast.length) break;
	await WAIT(150);
}
const gLastIsAssistant = typeof gLast === "string" && /^总/.test(gLast.trim());
/* 🔴 G3b 的**前置**（2026-09-13 新增）——
 *   `director-run` 的 assistant 正文 = "【总监分析】\n" + **启用步**的逐步结论（`reasoning`）。
 *   若五步职责被**全部关闭**，`reasoning` 为空 ⇒ 正文退化成「（全部职责已关闭，原文直转）」
 *   ⇒ G3b「不含五步结论」**必红**，但红的原因**不在消息内容**，而在"职责配置"这个前提不成立。
 *
 *   真实事故：`cdp-click.mjs` 的 I 段（翻转 5 个开关 → 保存本层 → 向上提交）把「五项全关」
 *   **持久化**写进 `__global__` / `ws_*` 两级且从不还原（本脚本不重载页面 ⇒ 跨运行一直活着）
 *   ⇒ 下次跑本脚本时 G3b 以「助手消息不含五步结论」的形态报红，读起来像**产品坏了**。
 *   ⇒ 此处**先证明前提，再断言结果**（纪律 21 / 34），并把配置来源一并打进现场。 */
const gDuty = await ev("(async () => { const D = window.__dshDuties; if (!D) return null;"
	+ " const r = await D.resolve(null);"
	+ " const on = D.KEYS.filter((k) => r.duties[k] && r.duties[k].enabled);"
	+ " const dflt = D.DEFAULT();"
	+ " return { on: on.length, keys: on, origin: r.origin.languagePolish,"
	+ " defaultOn: D.KEYS.filter((k) => dflt[k] && dflt[k].enabled).length }; })()");
const gOffAll = typeof gLast === "string" && /全部职责已关闭/.test(gLast);
check("G3a", "🔴 前置：**最新一条** assistant 未被判为「全部职责已关闭」（职责配置是 G3b 的前提，不是它的结论）",
	gComposerReady ? (gLastIsAssistant && !gOffAll) : "SKIP",
	!gComposerReady
		? "前置不成立（G0）"
		: (typeof gLast !== "string"
			? "取不到最新一条 dp-dir-msg"
			: (gOffAll
				? "最新一条出现「全部职责已关闭」⇒ 职责配置被关；查 window.__dshDuties（多半是别的脚本留下的持久状态）"
				: "最新一条为 assistant 且非降级" + (gDuty ? "（全局启用 " + gDuty.on + "/5 · 默认 " + gDuty.defaultOn + "/5 · 来源 " + gDuty.origin + "）" : ""))));

check("G3b", "**最新一条**助手消息含**五步结论**（不是一句空回复）",
	gComposerReady
		? (typeof gLast === "string" && /总监分析/.test(gLast) && /整理语言/.test(gLast) && /自动审核产出/.test(gLast))
		: "SKIP",
	gComposerReady
		? (typeof gLast === "string" ? gLast.slice(0, 140) : "取不到最新一条 dp-dir-msg")
		: "前置不成立（G0）");

/* 🔴 环境复原（G3b 用过的页签）：
 *   G3b 需要读 R5 的「总监消息」正文，于是把 R5 切到 `msg` 页签 —— **必须切回来**。
 *   真机实测（2026-09-12 r8/r9/r10）：忘了切回 ⇒ 下一轮 D5 断言 `dp-flow-item` 时
 *   R5 还停在消息页签（分段键写着「流转 1」，而 body 里全是 `dp-dir-msg`，`dp-flow-item` 为 0）
 *   ⇒ D5/D6/D7 三红，读起来像"登记流转坏了"，其实是**上一轮留下的界面状态**。
 *   这与 D 段收尾"切回起点会话"同属一条纪律（C17.2）：**动过的界面状态必须还原**。 */
await ev("(()=>{const b=document.querySelector('[data-testid=dp-r5-flow]');if(b)b.click();return 1;})()");
await WAIT(300);
const gTabBack = await ev("(()=>{const f=document.querySelector('[data-testid=dp-r5-flow]');"
	+ "return {seg:f?String(f.textContent).trim():null,items:document.querySelectorAll('[data-testid=dp-flow-item]').length};})()");
console.log("  · 环境复原：R5 页签切回「流转」⇒ " + J(gTabBack));

/* G4 反证：空输入不该产生任何消息 */
const g4n0 = gComposerReady ? await ev(gCount) : null;
if (gComposerReady) {
	await ev("(()=>{const b=window.__dshChatBridge;if(b)b.setComposerText('');return 1;})()");
	await WAIT(200);
	/* 同 G2：点注入条的**真实「执行」按钮**（`dp-send` 随 R8 一起被删，见上） */
	if (gDeliverBtn && !gDeliverBtn.zero) await click('[data-testid="dp-host-deliver"]');
	await WAIT(1100);
}
const g4n1 = gComposerReady ? await ev(gCount) : null;
check("G4", "🔴 反证：空输入点「执行」→ **不新增任何消息**（若这里也 +2，说明 G3 的通过是「点了就有」而非真跑了链路）",
	gComposerReady ? (g4n0 !== null && g4n1 !== null && g4n1 === g4n0) : "SKIP",
	gComposerReady ? J({ before: g4n0, after: g4n1 }) : "前置不成立（G0）：composer 不在场时空输入本就无从触发，本条会**空转pass**，故跳过");

/* G5 分支聚焦（真机内同源纯函数） */
const g5 = await ev("(()=>{const f=window.__dshBranchFocus;if(!f)return null;"
	+ "const rows=[{sessionId:'1',depth:0,childrenCount:3},"
	+ "{sessionId:'1a',parentSessionId:'1',depth:1,childrenCount:0},"
	+ "{sessionId:'2',depth:0,childrenCount:0},{sessionId:'2a',parentSessionId:'2',depth:1,childrenCount:0}];"
	+ "const a=f.focusRows(rows,'1a');const b=f.focusRows(rows,'1a',{includeParents:true});"
	+ "return {a:a.rows.map(r=>r.sessionId),b:b.rows.map(r=>r.sessionId),applied:a.applied};})()");
check("G5", "分支聚焦真机可用：点分支含祖先链 · 开「含上一层」多出兄弟层",
	!!g5 && g5.applied === true && g5.a.indexOf("1") >= 0 && g5.b.indexOf("2") >= 0, g5 ? J(g5) : "取不到 __dshBranchFocus");

/* ══════════════════════════════════════════════════════════════════
 * 【H】宿主残留区块的**显示层裁剪**（2026-09-14 第 4 批交付，第 5 批扩到三目标）
 * ══════════════════════════════════════════════════════════════════
 *  目标（宿主 `workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`）：
 *    · 7337–7340「总监对话」标题行 —— 第 5 批改为**只隐文字**（同行 `—` 折叠按钮必须活着，bug②）
 *    · 7342–7357「智能体 · 点击创建分支」按钮行
 *    · 7407–7422 对话页蓝色「对话」标题栏（第 5 批新增，结构指纹唯一命中）
 *  🔴 为什么必须真机验：产品侧只能**读 DOM**（那是宿主写的），断言对象与结论同源的要求
 *     在这里意味着"必须量**计算样式**与**是否在被隐的块上**"，不能只断言"函数被调过"。
 *  🔴 为什么要有正负对照：`display:none` 可能是**别人**写的（宿主自己/别的样式）。
 *     故用模块自己的 `restoreHostPanelTrim()` 还原 ⇒ 必须变可见；再 `applyHostPanelTrim()`
 *     ⇒ 必须又变不可见。只看"现在是 hidden"是空真（可能一直就是 hidden）。
 * ⚠️ 用 `window.__dshHostPanelTrim`（该模块自带的调试面）而不是自己写选择器 ——
 *    **单一真相源**：判据与产品实现必须指向同一份目标清单（结构类目标直接用
 *    `api.isHostChatTitleBar`，闸门不另写一份指纹）。 */
section("【H】宿主残留两行显示层裁剪（第 4 批交付 · 本轮补闸门）");
/* 起点显式建立：宿主残留只在**对话页**的总监面板里，先确保在该页（已在则点击是无害的幂等动作） */
const hTabClicked = await clickText('[role="tab"]', "对话");
await WAIT(1200);
console.log("  · H 段起点：切到「对话」页 " + (hTabClicked && hTabClicked.ok ? "（已点击 @ " + hTabClicked.x + "," + hTabClicked.y + "）" : "（未找到对话页签：" + (hTabClicked && hTabClicked.why) + "）"));
const hProbe = await ev(`(async () => {
	const api = window.__dshHostPanelTrim || null;
	if (!api) return { api: false };
	/* 🔴 第 5 批：目标从 **2 个** 扩到 **3 个**（新增对话页蓝色「对话」标题栏），
	 *    且取块方式**逐目标不同**（与产品 TRIM_TARGETS 的 up 一致）：
	 *      · 「智能体 · 点击创建分支」→ 文本全等 + 上溯 1 层（行）
	 *      · 「总监对话」            → 文本全等 + 上溯 0 层（**只隐文字**，同行的折号按钮必须留着）
	 *      · 蓝色「对话」标题栏      → 无文本，用**模块自己的** api.isHostChatTitleBar 判据
	 *        （判据与产品同源；闸门再写一份指纹就等于两处各算各的）
	 * ⚠️ 本段整体在**模板串**里：里面一律不许出现反引号（纪律 9 —— 会把模板串提前闭合）。 */
	const leafByText = (text, up) => {
		const all = [].slice.call(document.querySelectorAll('div,span'));
		const leaf = all.find((e) => e.children.length === 0 && String(e.textContent || '').trim() === text);
		if (!leaf) return null;
		let b = leaf;
		for (let k = 0; k < up && b; k++) b = b.parentElement;
		return b;
	};
	const barEl = () => [].slice.call(document.querySelectorAll('div')).find((e) => {
		try { return api.isHostChatTitleBar(e); } catch (err) { return false; }
	}) || null;
	const info = (b) => b ? {
		display: getComputedStyle(b).display,
		mark: b.getAttribute('data-dsh-trimmed'),
		inPanel: !!(b.closest && b.closest(api.PANEL_GUARD_SELECTOR)),
		inPlugin: !!(b.closest && b.closest(api.PLUGIN_GUARD_SELECTOR))
	} : null;
	const snap = () => {
		const titleSpan = leafByText('总监对话', 0);
		const titleRow = titleSpan ? titleSpan.parentElement : null;
		/* 同一行里的「—」折叠按钮：**没被裁**的那颗（带标记的才是被我们隐的） */
		const foldBtn = titleRow
			? ([].slice.call(titleRow.querySelectorAll('button')).find((x) => !x.getAttribute('data-dsh-trimmed')) || null)
			: null;
		const fb = foldBtn ? foldBtn.getBoundingClientRect() : null;
		/* 🔴 第 6 批需求 1 后，「总监对话」这条的裁剪目标由**文字**改成**整行**（up:1）
		 *    ⇒ 量 display/mark 的对象必须是**行**，不能还是那枚内层 span。
		 *    实测量错时的形态（2026-09-14 真机）：span 的计算 display 是 inline、
		 *    data-dsh-trimmed 为 null ⇒ H1/H3/H5 **齐刷刷红**，
		 *    而读数 titleRow 的 display=none 明明就在同一个对象里 ——
		 *    典型的「尺子量错节点」（本文件已记录过一次同类：称它「尺子量错容器」）。
		 *    ⇒ title 指向**行**（真正的裁剪目标），另留 titleSpan 只作记录。
		 *  ⚠️ 本段在**模板串**里：一律不许出现反引号（纪律 9 —— 会把模板串提前闭合）。 */
		const minBtn = document.getElementById("dsh-host-col-min");
		const mb = minBtn ? minBtn.getBoundingClientRect() : null;
		return {
			agent: info(leafByText('智能体 · 点击创建分支', 1)),
			title: info(titleRow),
			titleSpan: info(titleSpan),
			bar: info(barEl()),
			titleRow: titleRow ? { display: getComputedStyle(titleRow).display } : null,
			fold: foldBtn ? {
				text: String(foldBtn.textContent || '').trim(),
				display: getComputedStyle(foldBtn).display,
				w: fb ? Math.round(fb.width) : 0, h: fb ? Math.round(fb.height) : 0
			} : null,
			/* 插件侧的最小化按钮：bug② 的能力**移交**证据（见 H5） */
			minBtn: minBtn ? { w: mb ? Math.round(mb.width) : 0, h: mb ? Math.round(mb.height) : 0 } : null,
			targetCount: api.TRIM_TARGETS.length
		};
	};
	const before = snap();
	const restoredN = api.restoreHostPanelTrim();
	await new Promise((r) => setTimeout(r, 350));
	const during = snap();
	/* 还原成产品常态（裁剪生效）—— 谁污染谁治理 */
	const applied = api.applyHostPanelTrim();
	await new Promise((r) => setTimeout(r, 350));
	const after = snap();
	/* ── 负向校准（**植入缺陷 ⇒ 护栏必须失效**；第 6 批 H0b 的配套，纪律 6/32）──────
	 *  只读地断言"现在 panelOk=true"是**空真**：它可能在"判据其实早就死了、
	 *  只是没人读"的情况下也为真。故把三层面板判据**全部**抹掉，看 panelOk 会不会转 false：
	 *    · ① 抹掉我方标记（api.PANEL_MARK 那个属性）
	 *    · ② 宿主列的 inline minWidth 在真机上**已经是 0px**（正是本次事故的现场），无需人为改
	 *    · ③ 把两处结构锚文本临时改成占位串
	 *  ⇒ 此时 panelOk 必须为 false 且 panelReason **非空**（降级可以，无声不行）。
	 *  随后逐项还原并回读自证 —— 校准**不许成为产品的破坏者**（纪律 15）。
	 *  ⚠️ 只读 panelOk/panelReason，不去量"目标是没被裁" ——
	 *     锚文本被临时改掉之后，目标查找本身就会失败，那样的读数是**混淆**的（两种原因同形）。
	 *  ⚠️ 本段在**模板串**里：一律不许出现反引号（纪律 9 —— 会把模板串提前闭合）。 */
	const calCol = api.resolvePanelRoot();
	const calAnchors = [];
	if (calCol) {
		calCol.removeAttribute(api.PANEL_MARK);
		['智能体 · 点击创建分支', '总监对话'].forEach(function (txt) {
			const all = [].slice.call(document.querySelectorAll('div,span'));
			const e = all.find(function (x) { return x.children.length === 0 && String(x.textContent || '').trim() === txt; });
			if (e) { calAnchors.push({ e: e, t: e.textContent }); e.textContent = '校准占位'; }
		});
	}
	api.restoreHostPanelTrim();
	await new Promise(function (r) { setTimeout(r, 300); });
	api.applyHostPanelTrim();
	await new Promise(function (r) { setTimeout(r, 300); });
	const calKilled = { panelOk: api.trimState.panelOk, panelReason: api.trimState.panelReason };
	/* 还原（逐项写回原值 + 重新贴标记）*/
	calAnchors.forEach(function (a) { a.e.textContent = a.t; });
	const calRemarked = calCol ? api.markHostPanel(calCol) : false;
	api.restoreHostPanelTrim();
	await new Promise(function (r) { setTimeout(r, 300); });
	api.applyHostPanelTrim();
	await new Promise(function (r) { setTimeout(r, 300); });
	const calBack = { panelOk: api.trimState.panelOk, anchored: calAnchors.length, remarked: calRemarked };
	return {
		api: true, scanCount: api.trimState.scans, degraded: api.trimState.degraded, reason: api.trimState.reason,
		observer: api.trimState.observer, restoredN: restoredN, appliedAfter: applied,
		/* 面板护栏的可断言面（第 6 批）：护栏失效是**静默**的 ⇒ 必须单独读出来 */
		panelOk: api.trimState.panelOk, panelReason: api.trimState.panelReason,
		calKilled: calKilled, calBack: calBack,
		before: before, during: during, after: after
	};
})()`);
const hKeys = ["agent", "title", "bar"];
/* 三个目标各自的"已被裁掉"判据：块为 display:none **且**带着我们贴的标记 */
const hNotTrimmed = (m) => hKeys.filter((k) => !(m && m[k] && m[k].display === "none" && m[k].mark));
const hNotBack = (m) => hKeys.filter((k) => !(m && m[k] && m[k].display !== "none"));
if (!hProbe || !hProbe.api) {
	check("H0", "前置：插件已挂载（含宿主裁剪模块）", false,
		hProbe ? "window.__dshHostPanelTrim 不存在（插件未装载或该能力缺失）" : "探针取不到");
} else {
	/* 前提：三个目标真的在 DOM 里、形态符合预期 —— 否则下面全是空真。
	 *   · 文本类两条必须在宿主总监面板内（护栏②保护的就是它们）
	 *   · 蓝色标题栏必须在面板**之外**（它靠结构指纹唯一，不靠护栏②）
	 *   · 三条都不许落在插件自挂容器内（护栏①） */
	const b0 = hProbe.before || {};
	const hPresent = !!b0.agent && !!b0.title && !!b0.bar
		&& b0.agent.inPanel === true && b0.title.inPanel === true
		&& b0.agent.inPlugin === false && b0.title.inPlugin === false && b0.bar.inPlugin === false
		&& b0.bar.inPanel === false;
	check("H0", "前置：三个目标都在 DOM 里且形态符合预期（文本两条在面板内 · 标题栏在面板外 · 三条都不在插件容器内）",
		hPresent, J({ degraded: hProbe.degraded, reason: hProbe.reason, scanCount: hProbe.scanCount,
			panelOk: hProbe.panelOk, panelReason: hProbe.panelReason,
			agent: b0.agent, title: b0.title, bar: b0.bar }));
	if (hPresent) {
		check("H1", "🔴 三个目标的块计算样式均为 display:none 且带 data-dsh-trimmed 标记（用户看不到）",
			hNotTrimmed(hProbe.before).length === 0, J({ miss: hNotTrimmed(hProbe.before), before: hProbe.before }));
		check("H2", "🔴 正负对照①：调模块自己的 restoreHostPanelTrim() ⇒ 三个目标**必须变回可见**（证明 none 是它写的，不是别人）",
			hProbe.restoredN === b0.targetCount && hNotBack(hProbe.during).length === 0,
			J({ restoredN: hProbe.restoredN, 声明目标数: b0.targetCount, miss: hNotBack(hProbe.during) }));
		check("H3", "🔴 正负对照②：再 applyHostPanelTrim() ⇒ 三个目标**必须又变不可见**（可逆 + 幂等），并复原成产品常态",
			Array.isArray(hProbe.appliedAfter) && hProbe.appliedAfter.length === b0.targetCount && hNotTrimmed(hProbe.after).length === 0,
			J({ appliedAfter: hProbe.appliedAfter, 声明目标数: b0.targetCount, miss: hNotTrimmed(hProbe.after) }));
		/* 🔴 bug② 的**第 6 批形态**（原判据已随需求过期，见下）：
		 *    第 5 批那版断言是"「总监对话」文字被隐、同行 `—` 折叠按钮仍可见"——
		 *    那是因为当时整行保留、只隐文字。第 6 批需求 1 用户原话「这两列不要」，
		 *    该目标已改成 `up:1`（**整行去除**），`—` 随之一起消失
		 *    ⇒ 旧断言在新形态下**必然红**，而且红得毫无信息量（它测的那颗按钮已经不是产品形态了）。
		 *    用户 bug② 的**实质**是「对话 tap 的总监没有最小化了」—— 能力不能消失。
		 *    ⇒ 新判据守住"能力仍在、只是换了主人"：**整行确实不可见**，
		 *      且**插件侧 `#dsh-host-col-min` 在场且有非零盒**（职责已移交到插件列，见
		 *      `bridge/host-director-column.js`）。这比"某颗按钮可见"更接近用户真正在意的事。 */
		check("H5", "🔴 bug② 第 6 批形态：宿主「总监对话」**整行已不可见**，且最小化能力**已移交**到插件侧真实控件（#dsh-host-col-min 在场且有非零盒）",
			!!hProbe.before.titleRow && hProbe.before.titleRow.display === "none"
			&& !!hProbe.before.title && hProbe.before.title.mark === "host-director-chat-title"
			&& !!hProbe.before.minBtn && hProbe.before.minBtn.w > 0 && hProbe.before.minBtn.h > 0,
			J({ row: hProbe.before.titleRow, rowMark: hProbe.before.title && hProbe.before.title.mark, minBtn: hProbe.before.minBtn }));
	}
	/* 🔴 面板护栏本身必须可断言（第 6 批新增）——
	 *   2026-09-14 真机事故：`host-director-column` 为了能拖窄，**显式**把宿主列的
	 *   inline `minWidth` 写成 `0px`，而本模块的护栏当时正是 `[style*="min-width: 180px"]`
	 *   ⇒ 护栏命中数 0、文本类目标**静默不再被裁**（用户要求删的宿主残留又露出来），
	 *   而 `degraded/reason` **全是正常值** ⇒ 完全无声。这条断言就是那次事故的哨兵：
	 *   护栏解析失败时必须**红在这条**上，而不是让 H0/H1 以"目标形态不符"的形态去红。 */
	check("H0b", "🔴 面板护栏解析成功（`trimState.panelOk`）—— 护栏失败会让文本类裁剪**静默失效**（本项目最危险的一种）",
		hProbe.panelOk === true,
		"panelOk=" + hProbe.panelOk + " ｜ panelReason=" + J(hProbe.panelReason));
	/* 🔴 H0b 的**负向校准**（纪律 6/32）：把三层面板判据全部抹掉 ⇒ panelOk 必须转 false
	 *    且必须**说出原因**；还原后必须回绿。没有这条，H0b 可能是"判据早就死了但无人读"的空真。 */
	check("H0c", "🔴 负向校准：抹掉三层面板判据 ⇒ `panelOk` 必须转 false 且**带非空原因**；还原后必须回绿（校准不许留下污染）",
		hProbe.calKilled && hProbe.calKilled.panelOk === false
		&& typeof hProbe.calKilled.panelReason === "string" && hProbe.calKilled.panelReason.length > 0
		&& hProbe.calBack && hProbe.calBack.panelOk === true
		&& hProbe.calBack.anchored === 2 && hProbe.calBack.remarked === true,
		J({ 抹掉后: hProbe.calKilled, 还原后: hProbe.calBack }));
	check("H4", "裁剪未被降级（读不到就必须说清原因，不许无声）",
		hProbe.degraded === false && hProbe.reason === null && hProbe.observer === true,
		J({ degraded: hProbe.degraded, reason: hProbe.reason, observer: hProbe.observer }));
}

/* ══════════════════════════════════════════════════════════════════
 * 收尾：页面级错误
 * ══════════════════════════════════════════════════════════════════ */
section("【E】页面级错误（真机 console.error）+ CDP 健康度");
const realErrors = pageErrors.filter((s) => !/favicon|net::ERR|Failed to load resource/i.test(s));
check("E1", "全程无 console.error / Log.error", realErrors.length === 0, realErrors.length ? realErrors.slice(0, 3).join(" ‖ ") : "零错误");
check("E2", "全程无 CDP 派发超时（渲染进程没被顶死；顶死会记成一条失败，不再无声吞掉整轮）",
	cdpTimeouts.length === 0, cdpTimeouts.length ? cdpTimeouts.slice(0, 2).join(" ‖ ") : "零超时");

/* ── 收尾环境复原（谁污染谁治理，2026-09-13）────────────────────────────────
 * 🔴 本脚本 G 段 host-send 会触发**宿主真实 AI 生成**；脚本只等插件侧 busy=0（≤20s），
 *   不等宿主智能体把流式回答吐完。若离场时它还在生成，宿主会隐藏原生 composer，
 *   下一次运行 preComposer 就落在"生成中"，F/G 段被染成假红（composer-not-found）。
 *   测试只需 G6 证明"投递被受理"，不需要 AI 把回答写完 ⇒ 离场前主动「停止生成」，
 *   并回读确认 composer 真的回来（写操作回读校验，不靠点了就算）。 */
const leavingBusy = await generating();
if (leavingBusy) {
	console.log("  · 收尾复原：宿主仍在生成，主动点「停止生成」…");
	await ev("(()=>{const b=document.querySelector('button[aria-label=\"停止生成\"]');if(b)b.click();return 1;})()");
	for (let i = 0; i < 24; i++) {
		await WAIT(500);
		if (!(await generating())) break;
	}
}
let leavingComposer = false;
for (let i = 0; i < 12; i++) {
	if (await composerVisible()) { leavingComposer = true; break; }
	await WAIT(500);
}
console.log("  · 收尾复原：离场前生成中=" + leavingBusy + " → 复原后 composer 可见=" + leavingComposer
	+ (leavingBusy && !leavingComposer ? "（⚠ 未能复原，下一轮可能需等生成）" : ""));

reachedFlowFinal = true;
console.log("\n───────────────────────────────────────────────");
console.log(" 通过 " + pass + " / 失败 " + fail + " / 跳过 " + skip);
if (failures.length) console.log(" 失败项：\n   - " + failures.join("\n   - "));
if (skips.length) console.log(" 跳过项（非通过）：\n   - " + skips.join("\n   - "));
if (cdpTimeouts.length) {
	console.log(" ⚠ 渲染进程有 " + cdpTimeouts.length + " 次 CDP 派发超时 ⇒ 本轮结果**不可信**，请重启 Harness 重跑。");
	console.log(" IS_PASS: FALSE（INVALID：渲染进程无响应，非产品失败）");
} else {
	console.log(" IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
}
console.log("───────────────────────────────────────────────");
if (cdpTimeouts.length) process.exitCode = 2;
ws.close();
process.exit(fail === 0 ? 0 : 1);
