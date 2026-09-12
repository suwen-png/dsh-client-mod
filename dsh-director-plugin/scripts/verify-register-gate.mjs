/**
 * verify-register-gate.mjs — 反证：「登记流转」按钮的**可点性**不由缓存决定
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
 * 退出码：0 全绿 / 1 有失败
 */
const PORT = 9222;
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

const pages = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
const page = pages.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标（Harness 是否开着 9222？）"); process.exit(1); }

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
const leftOver = await ev("['[data-testid=nd-panel]','[data-testid=mm-root]','#dsh-design-studio']"
	+ ".filter(s=>document.querySelector(s)).map(s=>s.slice(0,22))");
console.log("  · 阶段 0 清浮层：自检残留 " + J(leftOver));

/* ── 前置：总监页在、按钮在 ── */
const pre = await ev("(()=>{const b=document.querySelector('[data-testid=dp-register-flow]');"
	+ "const dp=document.querySelector('[data-testid=dp-root]');"
	+ "return {btn:Boolean(b),page:Boolean(dp),"
	+ " disabled:b?Boolean(b.disabled):null,aria:b?b.getAttribute('aria-disabled'):null,"
	+ " composerVisible:Boolean(window.__dshChatBridge&&window.__dshChatBridge.findComposer())};})()");
check("G0", "前置：总监页与「登记流转」按钮都在场", Boolean(pre && pre.btn && pre.page), J(pre));
if (!pre || !pre.btn || !pre.page) {
	console.log("\n  前置不成立，本脚本无法继续（并非产品失败）");
	console.log("  IS_PASS: FALSE");
	process.exit(1);
}

/* ── ① 基线 ── */
check("G1", "基线：按钮**未禁用**（`disabled=false`）—— 这是修好后的不变量",
	pre.disabled === false, "disabled=" + pre.disabled + " ｜ aria-disabled=" + pre.aria);

/* ── ② 把 composer 藏起来（照原样恢复）── */
const hid = await ev("(()=>{const c=document.querySelector('[class*=\"composer\"]');if(!c)return null;"
	+ "const orig=c.style.display||'';c.style.display='none';"
	+ "return {orig:orig,cls:String(c.className).slice(0,32)};})()");
if (!hid) { check("G2", "把 composer 藏起来（制造「输入框不可见」）", false, "找不到 composer 元素"); }

/* ⚠️ 这里**不能固定等一拍**。
 *   提示位由 `setInterval(..., 400)` 刷新，而 Harness 窗口在后台时
 *   Chromium 会把定时器节流到 ≥1s（甚至更多）⇒ 固定 700ms 会读到**上一拍**的旧值。
 *   真机实测（2026-09-12 gate-r1）：固定 700ms 时读到 aria="false"（旧值），
 *   而且 G4 会**假绿**（恢复后本来就该是 false，冻结的旧值恰好也是 false）。
 *   正确做法：**等下界**——轮询到条件成立或超时，超时才判红，并把实际耗时打出来。 */
const t0 = Date.now();
const deadline = t0 + 6000;
let hidden = null;
while (Date.now() < deadline) {
	hidden = await ev("(()=>{const b=document.querySelector('[data-testid=dp-register-flow]');"
		+ "const c=document.querySelector('[class*=\"composer\"]');"
		+ "return {disabled:b?Boolean(b.disabled):null,aria:b?b.getAttribute('aria-disabled'):null,"
		+ " findComposer:Boolean(window.__dshChatBridge&&window.__dshChatBridge.findComposer()),"
		+ " composerDisplay:c?getComputedStyle(c).display:null};})()");
	if (hidden && hidden.aria === "true") break;
	await WAIT(150);
}
const tG2 = Date.now() - t0;
check("G2", "🔴 输入框不可见时：`aria-disabled` 正确变 true，而 `disabled` **仍为 false**（提示位跟随、可点性不跟随）",
	Boolean(hidden) && hidden.aria === "true" && hidden.disabled === false && hidden.findComposer === false,
	J(hidden) + " ｜ 收敛耗时 " + tG2 + "ms（上界 6000ms）");

/* ── ③ 藏起来时真实点击：必须仍能触发，并给出可读归因 ── */
const box = await ev("(()=>{const b=document.querySelector('[data-testid=dp-register-flow]');if(!b)return null;"
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

/* ── ④ 恢复（照原样）→ 提示位必须回到 false ── */
await ev("(()=>{const c=document.querySelector('[class*=\"composer\"]');if(!c)return 0;"
	+ "const orig=" + J(hid ? hid.orig : "") + ";"
	+ "if(orig)c.style.display=orig;else c.style.removeProperty('display');return 1;})()");
const t4 = Date.now(), d4 = t4 + 6000;
let back = null;
while (Date.now() < d4) {
	back = await ev("(()=>{const b=document.querySelector('[data-testid=dp-register-flow]');"
		+ "const c=document.querySelector('[class*=\"composer\"]');"
		+ "return {disabled:b?Boolean(b.disabled):null,aria:b?b.getAttribute('aria-disabled'):null,"
		+ " findComposer:Boolean(window.__dshChatBridge&&window.__dshChatBridge.findComposer()),"
		+ " composerDisplay:c?getComputedStyle(c).display:null};})()");
	if (back && back.aria === "false" && back.composerDisplay !== "none") break;
	await WAIT(150);
}
check("G4", "🔴 正负对照：恢复后 `aria-disabled` 回到 false（证明提示位读的是**现取真值**，不是写死）",
	Boolean(back) && back.aria === "false" && back.disabled === false && back.findComposer === true && back.composerDisplay !== "none",
	J(back) + " ｜ 收敛耗时 " + (Date.now() - t4) + "ms（上界 6000ms；G2 已证提示位**真的翻到过 true**，故本条是有效对照）");

/* ── ⑤ 收尾：把 toast 点掉（它自己带 onClick 清空），不动宿主其它状态 ── */
await ev("(()=>{const t=document.querySelector('[data-testid=dp-toast]');if(t)t.click();return 1;})()");

console.log("\n───────────────────────────────────────────────");
console.log(" 通过 " + pass + " / 失败 " + fail);
if (fail) console.log(" 失败项：" + failures.join(", "));
console.log(" IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("───────────────────────────────────────────────");
process.exit(fail === 0 ? 0 : 1);
