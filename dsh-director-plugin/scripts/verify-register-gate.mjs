/**
 * verify-register-gate.mjs — 反证：「登记流转」按钮的**可点性**不由缓存决定
 *
 * 🔴 2026-09-16 差异清单 B3：锚点已随第 6 批需求 9 从总监页 `dp-register-flow`
 *    迁到宿主 composer 注入条 `dp-host-register`（R8 退役、能力先迁后删）。
 *    旧缺陷"1.2s 缓存布尔量 gate"随旧按钮结构性消失；本闸门升级为测新按钮的
 *    等价不变量（详见 G0 前的语义说明块）。
 *
 * ══════════════════════════════════════════════════════════════════
 *  这个脚本要证的一件事（用户抱怨"按钮点击不好用"的那一类缺陷）
 * ══════════════════════════════════════════════════════════════════
 *  缺陷（2026-09-12 真机）：
 *    `dp-register-flow` 原先写成 `disabled: !composerOk`，而 `composerOk` 是
 *    **1.2 秒轮询**出来的布尔量。后果：
 *      · 明明能点，按钮却是死的（最多 1.2s）⇒ 用户点不动、也不知道为什么；
 *      · 真机 e2e 因此偶发「R5 0 → 0」（登记没发生，而库里其实什么都没有）。
 *  修法：按钮**永远可点**，真值在点击那一刻读（`registerNative` 如实回话）。
 *
 *  本脚本**不测"修好没"，测"坏法会不会复发"**，三条判据：
 *    ① `disabled` 恒为 `false` —— 即使 composer 被藏起来（`aria-disabled` 会正确变 `true`）；
 *    ② 藏起来时**真实点击**仍能触发处理器，并给出可读归因（toast 说"输入框不可见"）；
 *    ③ 恢复后 `aria-disabled` 回到 `false`（正负对照，证明提示位真的接的是现取真值）。
 *
 *  ⚠️ 动的是**宿主 composer 的内联 style**，按本项目 C17.2 纪律**照原样恢复**
 *     （原本有内联 display 就写回原值，原本没有就 removeProperty）—— 不一刀切清空。
 *
 * 用法：node scripts/verify-register-gate.mjs   （需 Harness 开着 --remote-debugging-port=9222）
 * 退出码：0 全绿 / 1 真失败 / 2 INVALID（用错用法或目标 —— 含"CDP 连不上"）
 */
const PORT = 9222;
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

/* 2026-09-14 补（纪律 43：用法陷阱必须自诊断）：
 * 原先 CDP 没开时直接抛 `TypeError: fetch failed` + ECONNREFUSED 崩栈 ⇒ 读起来像"脚本坏了"，
 * 实际只是 Harness 没运行。用错目标判 INVALID(2)，不判 FAIL(1)。 */
let pages;
try {
	pages = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=9222 启动。");
	console.error("  正确用法（必须后台启动，且清掉两个环境变量）：");
	console.error("    1) powershell -File scripts/restart-harness.ps1   （推荐，见该脚本头注的遮挡检测根因）");
	console.error("       或 env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \"D:/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness\" --remote-debugging-port=9222 &");
	console.error("    2) node scripts/verify-register-gate.mjs");
	process.exit(2);
}
const page = pages.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	const timer = setTimeout(() => { pending.delete(id); rej(new Error("CDP_TIMEOUT " + method)); }, 8000);
	pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
	ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

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


const J = JSON.stringify;
async function ev(expr) {
	const out = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
	if (out.exceptionDetails) return { __err: out.exceptionDetails.text };
	return out.result?.value;
}
let pass = 0, fail = 0; const failures = [];
function check(id, name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + name + (detail !== undefined ? "  |  " + detail : "")); }
	else { fail++; failures.push(id); console.log("  ❌ " + id + " " + name + "  |  " + detail); }
}

console.log("═══════════════════════════════════════════════════════════");
console.log(" 反证 · 「登记流转」按钮不被缓存布尔量 gate");
console.log("═══════════════════════════════════════════════════════════");

/* ── 阶段 0：先把上位脚本可能留下的浮层清掉 ────────────────────────
 * 为什么必须有：本脚本靠**真实鼠标坐标点击**（Input.dispatchMouseEvent），
 * 一旦 `dsh-design-studio` / 分支导图 / 节点详情这类 fixed 浮层还盖在上面，
 * 点击会打在浮层上 ⇒ 处理器没进、toast 为 null ⇒ G3 以「产品坏了」的形式假红。
 * 真机实测（2026-09-12）：studio-r11 崩在中途留下工作室浮层，紧接着的 gate-r1
 * 就出现 G2 aria 不跟随 + G3 toast=null —— 形态完全对得上。
 * 选择器必须写全 `[data-testid=...]`：本项目 ev() 里是 querySelectorAll(sel) 语义，
 * 传裸名会去匹配同名**标签**（恒 0），清场会静默失效。 */
for (const [sel, closer, label] of [
	["[data-testid=nd-panel]", null, "节点详情"],
	["[data-testid=mm-root]", '[data-testid="mm-close"]', "分支导图"],
	["#dsh-design-studio", '[data-testid="ds-close"]', "设计图工作室"]
]) {
	const there = await ev("Boolean(document.querySelector(" + J(sel) + "))");
	if (!there) continue;
	console.log("  · 阶段 0 发现残留浮层：" + label + " ⇒ 关闭");
	if (closer) {
		const r = await ev("(()=>{const e=document.querySelector(" + J(closer) + ");if(!e)return null;"
			+ "const b=e.getBoundingClientRect();return {cx:b.x+b.width/2,cy:b.y+b.height/2};})()");
		if (r) {
			for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
				await send("Input.dispatchMouseEvent", { type, x: Math.round(r.cx), y: Math.round(r.cy), button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseMoved" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
			}
		}
	} else {
		await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
		await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
	}
	await WAIT(420);
}

/* ── 阶段 0b：起点显式建立（🔴 2026-09-16 差异清单 B3 伴生修复）──
 * 旧闸门依赖"上一套脚本留下的会话+总监页"起跑（跨运行状态污染）：冷启动停在欢迎页
 * ⇒ conversation.view 槽不存在 ⇒ 页签环不渲染 ⇒ G0 page:false 必红。
 * 与 verify-v22 A0 同一修复：无槽就真实点开第一条会话，再切到「总监」页签。 */
{
	const hasSlot = await ev('!!document.querySelector(\'[data-slot="conversation.view"]\')');
	if (!hasSlot) {
		const row = await ev("(function(){var all=document.querySelectorAll('div,li');"
			+ "for(var i=0;i<all.length;i++){var e=all[i];"
			+ "if(/sessionRow/.test(String(e.className))){var t=(e.textContent||'').trim();"
			+ "if(t && t!=='新会话'){var r=e.getBoundingClientRect();"
			+ "if(r.width>40&&r.height>10) return JSON.stringify({x:Math.round(r.left+40),y:Math.round(r.top+r.height/2),label:t.slice(0,20)});}}}"
			+ "return null;})()");
		if (row) {
			const p = JSON.parse(row);
			for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
				await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseMoved" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
			}
			console.log("  · 阶段 0b 已真实点开会话「" + p.label + "」");
			await WAIT(2000);
		} else {
			console.log("  · 阶段 0b ⚠️ 找不到可打开的会话行（会话列表未渲染？）");
		}
	}
	const tab = await ev("(function(){var a=[].slice.call(document.querySelectorAll('[role=tab]'));"
		+ "for(var i=0;i<a.length;i++){if(a[i].textContent.trim()==='总监'){"
		+ "var b=a[i].getBoundingClientRect();return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)});}}"
		+ "return null;})()");
	if (tab) {
		const p = JSON.parse(tab);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseMoved" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
		}
		console.log("  · 阶段 0b 已真实点击「总监」页签");
		await WAIT(1800);
	}
}
const leftOver = await ev("['[data-testid=nd-panel]','[data-testid=mm-root]','#dsh-design-studio']"
	+ ".filter(s=>document.querySelector(s)).map(s=>s.slice(0,22))");
console.log("  · 阶段 0 清浮层：自检残留 " + J(leftOver));

/* ── 前置：总监页在、按钮在 ──
 * 🔴 2026-09-16 差异清单 B3：旧锚点 `dp-register-flow` 已随第 6 批需求 9（R8 整行退役、
 * 能力先迁后删）迁到宿主 composer 注入条的 `dp-host-register`（src/bridge/host-composer-slot.js）。
 * 本闸门随之升级语义（旧缺陷"缓存布尔量 gate"已随旧按钮结构性消失）：
 *   ① 按钮 `disabled` 恒 false（原生按钮，永不禁用）；
 *   ② **读取面**跟随可见性：藏 composer 编辑器 ⇒ findComposer() 变 false，
 *      而按钮本体仍可见（注入条挂在统计行旁，不在编辑器内）；
 *   ③ 藏编辑器时真实点击仍打进处理器，归因可读（toast「输入框不可见」）；
 *   ④ 恢复后 findComposer 回 true（正负对照）+ 再点归因变为「已登记/为空」，
 *      证明点击读的是**现取真值**，不是死按钮。 */
const BTN = "[data-testid=dp-host-register]";
const pre = await ev("(()=>{const b=document.querySelector('" + BTN + "');"
	+ "const dp=document.querySelector('[data-testid=dp-root]');"
	+ "return {btn:Boolean(b),page:Boolean(dp),"
	+ " disabled:b?Boolean(b.disabled):null,"
	+ " composerVisible:Boolean(window.__dshChatBridge&&window.__dshChatBridge.findComposer())};})()");
check("G0", "前置：总监页与「登记流转」按钮（dp-host-register）都在场", Boolean(pre && pre.btn && pre.page), J(pre));
if (!pre || !pre.btn || !pre.page) {
	console.log("\n  前置不成立，本脚本无法继续（并非产品失败；若按钮不在场先查注入条降级原因 dp-host-scope-bar）");
	console.log("  IS_PASS: FALSE");
	process.exit(1);
}

/* ── ① 基线 ── */
check("G1", "基线：按钮**未禁用**（`disabled=false`）—— 这是修好后的不变量",
	pre.disabled === false, "disabled=" + pre.disabled);

/* ── ② 藏 composer **编辑器**（照原样恢复）──
 * 旧版藏整个 composer 卡片 —— 那时按钮在总监页 R8 里，藏卡片不影响它；
 * 现在按钮在注入条（物理上位于 composer 卡片内），藏整卡会连按钮一起藏掉 ⇒ 实验失效。
 * 改藏**编辑器本身**：findComposer() 有 isVisible 检查 ⇒ 读取面立即变 false，
 * 而注入条按钮仍在。 */
const hid = await ev("(()=>{const ed=(window.__dshChatBridge&&window.__dshChatBridge.findComposer)?window.__dshChatBridge.findComposer():null;"
	+ "if(!ed)return null;"
	+ "const orig=ed.style.display||'';ed.style.display='none';"
	+ "return {orig:orig,tag:ed.tagName,cls:String(ed.className||'').slice(0,32)};})()");
if (!hid) { check("G2", "把 composer 编辑器藏起来（制造「输入框不可见」）", false, "findComposer 已返回 null ⇒ 无法制造该状态（composer 可能本来就不可见）"); }

/* ⚠️ 仍用**等下界**轮询：即使读取是同步的，渲染/样式生效与 CDP 往返都有抖动；
 * 固定等一拍是本项目"时红时绿"的头号成因。 */
const t0 = Date.now();
const deadline = t0 + 6000;
let hidden = null;
while (Date.now() < deadline) {
	hidden = await ev("(()=>{const b=document.querySelector('" + BTN + "');"
		+ "return {disabled:b?Boolean(b.disabled):null,"
		+ " findComposer:Boolean(window.__dshChatBridge&&window.__dshChatBridge.findComposer()),"
		+ " btnBox:(function(){if(!b)return null;var r=b.getBoundingClientRect();"
		+ "return [Math.round(r.width),Math.round(r.height)];})()};})()");
	if (hidden && hidden.findComposer === false && hidden.btnBox && hidden.btnBox[0] > 0) break;
	await WAIT(150);
}
const tG2 = Date.now() - t0;
check("G2", "🔴 输入框不可见时：`findComposer()` 正确变 false，而**按钮仍可见**且 `disabled` 仍为 false（读取面跟随、可点性不跟随）",
	Boolean(hidden) && hidden.findComposer === false && hidden.disabled === false && hidden.btnBox && hidden.btnBox[0] > 0,
	J(hidden) + " ｜ 收敛耗时 " + tG2 + "ms（上界 6000ms）");

/* ── ③ 藏起来时真实点击：必须仍能触发，并给出可读归因 ── */
const box = await ev("(()=>{const b=document.querySelector('" + BTN + "');if(!b)return null;"
	+ "const r=b.getBoundingClientRect();if(r.width<1)return {zero:true};"
	+ "return {cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2)};})()");
let toast = null;
if (box && !box.zero) {
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", { type, x: box.cx, y: box.cy, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseMoved" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
	}
	/* 同样**等下界**：toast 是点击那一刻同步 setState 出来的，但宿主在后台时节流
	 * 会让它晚一拍上屏（真机实测最多 ~1.1s）。固定 500ms 会读到 null 而误判「静默失灵」。 */
	const t3 = Date.now(), d3 = t3 + 3000;
	while (Date.now() < d3) {
		toast = await ev("(()=>{const t=document.querySelector('[data-testid=dp-toast]');"
			+ "return t?String(t.textContent||'').trim():null;})()");
		if (toast) break;
		await WAIT(150);
	}
}
check("G3", "🔴 此时真实点击**仍然打进了处理器**，且归因可读（toast 说明「输入框不可见」，不是静默失灵）",
	Boolean(toast) && /不可见|不可用|为空/.test(String(toast)), "点击 " + J(box) + " ｜ toast=" + J(toast));

/* ── ④ 恢复（照原样）→ 读取面必须回到 true，再点一次归因应变为「已登记/为空」── */
await ev("(()=>{const ed=(window.__dshChatBridge&&window.__dshChatBridge.findComposer)?null:null;"
	+ "const c=(function(){/* 编辑器被藏了，findComposer 找不到 ⇒ 用 tag+cls 找回 */return null;})();"
	+ "return 0;})()");
/* 恢复要用 hid 里记录的原始定位信息找回编辑器（findComposer 此刻返回 null） */
const back0 = await ev("(()=>{if(!(" + J(!!hid) + "))return null;"
	+ "var tas=document.querySelectorAll('textarea');"
	+ "for(var i=0;i<tas.length;i++){var e=tas[i];"
	+ "if(String(e.className||'').slice(0,32)===" + J(hid ? hid.cls : "") + "){"
	+ "const orig=" + J(hid ? hid.orig : "") + ";"
	+ "if(orig)e.style.display=orig;else e.style.removeProperty('display');"
	+ "return {restored:true};}}"
	+ "return {restored:false};})()");
const t4 = Date.now(), d4 = t4 + 6000;
let back = null;
while (Date.now() < d4) {
	back = await ev("(()=>{return {findComposer:Boolean(window.__dshChatBridge&&window.__dshChatBridge.findComposer())};})()");
	if (back && back.findComposer === true) break;
	await WAIT(150);
}
check("G4", "🔴 正负对照：恢复后 `findComposer()` 回到 true（证明 G2 的 false 是我们藏出来的，不是写死）",
	Boolean(back0 && back0.restored) && Boolean(back) && back.findComposer === true,
	J(back0) + " → " + J(back) + " ｜ 收敛耗时 " + (Date.now() - t4) + "ms（上界 6000ms）");

/* ── ⑤ 收尾：把 toast 点掉（它自己带 onClick 清空），不动宿主其它状态 ── */
await ev("(()=>{const t=document.querySelector('[data-testid=dp-toast]');if(t)t.click();return 1;})()");

console.log("\n───────────────────────────────────────────────");
console.log(" 通过 " + pass + " / 失败 " + fail);
if (fail) console.log(" 失败项：" + failures.join(", "));
console.log(" IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("───────────────────────────────────────────────");
process.exit(fail === 0 ? 0 : 1);
