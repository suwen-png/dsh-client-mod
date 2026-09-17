/**
 * verify-design-studio.mjs —— 设计图工作室真机端到端验证（批次 10 · T-PLUG-018）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么是「逐交互点击 + 回读比对」而不是契约验证
 * ──────────────────────────────────────────────────────────────────
 * 用户要求原文：「**所有逻辑都要做，做完按照逻辑测试是否符合预期**」。
 * 契约验证只能证明「函数存在」，不能证明「点了之后真的变了、变对了」。
 * 故本脚本每一项都含三段：**点击前回读 → 真实点击 → 点击后回读**，并断言差值。
 *
 * 设计要点：**以 data-el-id 锚定元素**，不按下标取「最后一个元素」——
 * 因为载入标准框架后元素会重叠，按下标取会随实现细节漂移，
 * 断言必须锚在一个稳定主键上，才能证明"确实是那个元素被移动了"。
 *
 * 覆盖的用户需求（逐条对号）：
 *   D1  总监页单独加一个设计图的插件，按钮形式        → C1
 *   D2  点击铺满全屏                                  → C2
 *   D3  允许调整 / 修改 / 拖拽 / 增加元素              → C3 增加 / C4 拖拽 / C5 缩放
 *   D4  复制 / 删除                                    → C7 + C12
 *   D5  最下面对话保留，处理设计图的修订，只处理设计图  → C8
 *   D6  每一个元素可以点击，点击在左侧显示交互逻辑      → C9
 *   D7  标准设计图框架的映射                          → C10
 *   D8  文档化 / 可持久化                             → C11
 *   D9  键盘 Delete / 方向键 / Ctrl+D / Esc 逐层退      → C12 + C13
 *
 * 用法：node scripts/verify-design-studio.mjs
 * 退出码：0 全绿 / 1 有失败 / 2 INVALID（含 CDP 连不上）
 */
// 单一真相源：标准框架的元素数/逻辑齐备性**从 schema 直接算**，不硬编码。
// （早先硬编码 19，而 FRAME_SEEDS 实为 20 ⇒ 把产品正确误判成 ❌。数字类断言必须可导出。）
import { buildStandardFrame, ELEMENT_KINDS, LOGIC_FIELDS } from "../src/store/design-schema.js";
const FRAME_ELEMENTS = buildStandardFrame("threeTab");

const PORT = 9222;

/* 🔴 2026-09-14 补（纪律 17）：Harness 未启动时原先崩栈成 `TypeError: fetch failed`，
 *    读起来像脚本坏了。用错目标判 INVALID(2)，不判 FAIL(1)。 */
let targets;
try {
	targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=9222 启动。");
	console.error("  正确用法（必须后台启动，且清掉两个环境变量）：");
	console.error("    powershell -File scripts/restart-harness.ps1");
	console.error("    node scripts/verify-design-studio.mjs");
	process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
/* 🔴 连接断掉时**必须**把在飞的调用全部拒绝（2026-09-14 真机事故的真因）。
 *   现象：脚本跑到某一处突然以 `Warning: Detected unsettled top-level await` + **exit 13** 结束，
 *   其后全部断言一条不留；而 `tasklist` 里 Harness 仍在（**是新起的那个进程**）。
 *   真因：Harness 被外部重启/关闭 ⇒ 本 WebSocket 被服务端关闭 ⇒ 所有 `send()` 的 Promise
 *   **永远不会 settle**（没有 close 处理），于是 await 挂到进程结束。
 *   为什么这条比"断言失败"危险得多：它**静默** —— 既不报错也不计入 fail，
 *   汇总里只有一行 Node Warning，看起来像脚本写错了。
 *   ⚠️ 这也解释了本脚本长期"失败集合每次不同（13/9/10/7）"的**假偶发**：
 *   同机另一进程会重启 Harness，掐断点每次都不同 ⇒ 每次丢掉的断言集合都不同。 */
const failPending = (why) => {
	for (const [, { rej }] of pending) rej(Object.assign(new Error(why), { wsClosed: true }));
	pending.clear();
};
ws.addEventListener("close", () => failPending("CDP_WS_CLOSED"));
ws.addEventListener("error", () => failPending("CDP_WS_ERROR"));
const rawSend = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
/* 🔴 每次 CDP 往返都带**硬超时**（2026-09-14 真机事故 · 本项缺失的直接后果）。
 *   渲染进程主线程一旦卡住（例如 `resetDesignStore()` 触发的重挂载风暴），
 *   `Runtime.evaluate` **永不返回**，而浏览器进程仍然正常回 HTTP
 *   （/json/list 有响应、能列出页面）—— 看起来一切正常。
 *   本脚本此前没有超时，于是卡在 C14.0b 的第 736 行，Node 以
 *   `Warning: Detected unsettled top-level await` + **exit 13** 结束：
 *   C14 之后**全部断言一条不留**，而输出里只有一行 Warning，
 *   读起来像"脚本写错了"，完全指不到"渲染进程已卡死"。
 *   超时不是"更宽容"，而是把**挂死**换成**可命名的失败**：
 *   报出是哪一步卡住、并给可复制的处置命令，退出码走 2（INVALID ≠ FAIL）。
 *   ⚠️ 只包 `send`，**不包** `emit` —— Input 事件的响应在本环境稳定延迟约 5s
 *   （见下方注释），给 emit 加 await/超时会把点击串行化，反而打穿 2.5s 上膛窗口。 */
const CDP_TIMEOUT = Number(process.env.CDP_TIMEOUT_MS || 12000);
const send = (method, params = {}) => new Promise((res, rej) => {
	const h = setTimeout(() => rej(Object.assign(new Error("CDP_TIMEOUT"), { cdpTimeout: true, method })), CDP_TIMEOUT);
	if (h.unref) h.unref();
	rawSend(method, params).then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
});
/* fire-and-forget：不等 CDP 响应（响应回来时 pending 无记录会被自动忽略）。
 * 🔴 实测本 Electron 环境 Input.dispatchMouseEvent 的**响应**稳定延迟约 5s，而事件本身立即送达
 * （对照：Runtime.evaluate 往返仅 2ms）。坐标点击绝不能 await Input 响应，否则一次点击串行
 * 3 个事件要 15s，「2.5s 内二次确认删除」这类时序窗口必然被打穿（假失败，非产品缺陷）。 */
const emit = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); };
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


async function js(expr) {
	let r;
	try {
		r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	} catch (e) {
		if (e && (e.cdpTimeout || e.wsClosed)) {
			const why = e.wsClosed
				? "CDP 连接被关闭 —— Harness 已被关闭或被外部重启（不是断言失败）"
				: ("CDP 调用超时 " + CDP_TIMEOUT + "ms —— 渲染进程已卡死（不是断言失败）");
			console.error("\nIS_PASS: FALSE（INVALID：" + why + "）");
			console.error("  已跑完：" + pass + " 通过 / " + fail + " 失败；**其后断言未被评估**（不计入通过数）。");
			console.error("  卡住的表达式：" + String(expr).slice(0, 180).replace(/\s+/g, " "));
			console.error("  自检：node scripts/cdp-eval.mjs \"1+1\" —— 若也失败，就是渲染进程无响应/进程已退出。");
			console.error("  处置（必须后台启动，且清掉两个环境变量）：");
			console.error("    powershell -File scripts/restart-harness.ps1");
			console.error("    node scripts/verify-design-studio.mjs");
			try { ws.close(); } catch (e2) { /* 忽略 */ }
			process.exit(2);
		}
		throw e;
	}
	if (r.exceptionDetails) throw new Error("JS异常: " + r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
	return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══ 点击命中自检表 ══════════════════════════════════════════════════
 * 由来（实测 2026-09-12）：本脚本**从不点击** `ds-personalize`（⚙ 设置），
 * 但真机探测发现它 `data-on="1"`（个性化面板开着）且跨脚本运行一直留着 ——
 * 后果有两层，都是"静默"的：
 *   ① Esc 被个性化面板的 window-capture 监听 stopPropagation 吃掉
 *      ⇒ C13 的三次 Esc 全部零效果（r1 绿 / r2 r3 红，形态是"偶发"）；
 *   ② 该面板是 fixed 浮层，罩住顶栏部分按钮
 *      ⇒ C16.11 报 `ds-add-progress ← div`，看着像产品按钮被遮挡。
 * 也就是说：**一次打偏的点击，能让后面两段断言以"产品坏了"的形式炸掉**。
 * 故这里给每次点击加落点自检：命中栈顶必须落在目标子树内，否则记名。
 * 不在此处直接 assert（那会因一处打偏而中断后续取证），改为收尾统一判定。 */
const clickMisses = [];
const clickLog = [];
/* 🔴 「点不成」也要留痕（纪律 18：跳过必须带可分辨原因）。
 * 为什么单列一张台账：`clickTestId` 的两条早退分支（目标不存在 / 尺寸为 0）**既不进
 * `clickMisses`、也不进任何断言**，于是 C17.1 那句"全部 N 次点击落点均在目标子树内"
 * 把"有几次压根没点成"整个漏掉 —— 计数只统计了**点成了的**那些。
 * 现场后果与"打偏"同形：后续断言以"产品坏了"的形态炸掉，而真实原因是那一击**没发生**。
 * 判据分开定：`元素不存在` 可能是**有意探测**（如判定菜单是否收起），只报不判；
 * `元素尺寸为 0` 一定是异常（元素在 DOM 里却不可点），单列一条硬断言。 */
const clickFails = [];

async function clickAt(x, y) {
	const X = Math.round(x), Y = Math.round(y);
	// Input 事件 fire-and-forget（理由见 emit 定义）；WebSocket 保序，短 sleep 等页面处理即可
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: X, y: Y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: X, y: Y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(35);
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: X, y: Y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(20);
}
async function drag(x1, y1, x2, y2, steps = 8) {
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(x1), y: Math.round(y1) });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(x1), y: Math.round(y1), button: "left", clickCount: 1, buttons: 1 });
	for (let i = 1; i <= steps; i++) {
		const x = x1 + ((x2 - x1) * i) / steps, y = y1 + ((y2 - y1) * i) / steps;
		emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(x), y: Math.round(y), buttons: 1 });
		await sleep(18);
	}
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(x2), y: Math.round(y2), button: "left", clickCount: 1, buttons: 0 });
	await sleep(20);
}
async function key(k, code, extra = {}) {
	const base = { key: k, code, windowsVirtualKeyCode: extra.vk || 0, nativeVirtualKeyCode: extra.vk || 0, modifiers: extra.mod || 0 };
	emit("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
	await sleep(25);
	emit("Input.dispatchKeyEvent", { type: "keyUp", ...base });
	await sleep(60);
}
async function rectOf(sel) {
	return await js(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};})()`);
}
async function clickTestId(tid) {
	const r = await rectOf(`[data-testid="${tid}"]`);
	if (!r) { clickFails.push({ tid, why: "元素不存在" }); return { ok: false, why: "元素不存在" }; }
	if (r.w < 1 || r.h < 1) { clickFails.push({ tid, why: "元素尺寸为 0", w: Math.round(r.w), h: Math.round(r.h) }); return { ok: false, why: "元素尺寸为 0" }; }
	/* 落点自检：读**点击前**该点的命中栈顶。必须落在目标子树内（自己/后代/祖先），
	 * 否则这一击打在别人身上 —— 记名，不中断（要保留后续取证）。 */
	const hit = await js(`(function(){
		var e = document.querySelector('[data-testid=${JSON.stringify(tid)}]');
		if (!e) return { top: null };
		var stack = document.elementsFromPoint(${r.cx}, ${r.cy});
		var top = stack[0] || null;
		var okSelf = !!top && (top === e || e.contains(top) || top.contains(e));
		return { top: top ? (top.tagName.toLowerCase() + (top.getAttribute && top.getAttribute('data-testid') ? '[' + top.getAttribute('data-testid') + ']' : '')) : null,
		         chain: stack.slice(0, 3).map(function(t){ return t.tagName.toLowerCase() + (t.getAttribute && t.getAttribute('data-testid') ? '[' + t.getAttribute('data-testid') + ']' : ''); }),
		         okSelf: okSelf };
	})()`);
	clickLog.push({ tid, top: hit?.top, at: [Math.round(r.cx), Math.round(r.cy)] });
	if (!hit?.okSelf) clickMisses.push({ target: tid, landedOn: hit?.top, chain: hit?.chain, at: [Math.round(r.cx), Math.round(r.cy)] });
	await clickAt(r.cx, r.cy);
	return { ok: true, rect: r, hit };
}
/**
 * 点击顶栏动作按钮（V17 P2-2 响应式适配）。
 * 窄窗口（<1500）下「复制 / 重载框架 / 导出」收入「更多 ▾」下拉菜单，
 * 菜单关闭时这些按钮不在可见布局中（坐标点击会落空）⇒ 先探测，
 * 若目标不可见则先点 ds-more 展开菜单，再点目标。这与真人路径一致。
 */
async function clickTopAction(tid) {
	const visible = await js(`(function(){
		var e = document.querySelector('[data-testid=${JSON.stringify(tid)}]');
		if (!e) return false;
		var r = e.getBoundingClientRect();
		return r.width >= 1 && r.height >= 1;
	})()`);
	if (!visible) {
		const more = await clickTestId("ds-more");
		if (!more.ok) return more;
		await sleep(220);
	}
	return await clickTestId(tid);
}
/** 当前选中元素 id（从逻辑面板的 data-el-id 读，这是唯一可靠来源） */
async function selectedId() {
	return await js(`(function(){var p=document.querySelector('[data-testid=ds-logic]');return p?p.getAttribute('data-el-id'):null;})()`);
}
/** 按 id 读元素屏幕位置 */
async function posOfId(id) {
	return await js(`(function(){var e=document.querySelector('[data-testid=ds-el][data-el-id=${JSON.stringify(id)}]');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()`);
}
/**
 * 把元素滚进可视区，返回滚动后的屏幕位置。
 *
 * 🔴 为什么必须有它（测试自身的教训 · 与"产品坏了"长得一模一样）：
 *   C4 系列会把元素往右下拖 200+ 模型像素，而 1:1 时画布宽 1180 > 可视区约 810，
 *   且 `ds-canvas-wrap` 是 `overflow:auto` ⇒ 元素可能落到**视口之外**。
 *   此后所有基于 `getBoundingClientRect()` 的坐标派发鼠标事件都会**打空**
 *   （CDP 把事件投到视口外的坐标，页面收不到）⇒ 表现为"拖不动、点了没反应"，
 *   与产品缺陷完全同形。故每次动作前先把它拉回画面中央。
 */
async function ensureVisible(id) {
	await js(`(function(){var e=document.querySelector('[data-testid=ds-el][data-el-id=${JSON.stringify(id)}]');if(e&&e.scrollIntoView)e.scrollIntoView({block:'center',inline:'center'});})()`);
	await sleep(220);
	return await posOfId(id);
}
/**
 * 按 id 读元素的**模型坐标**（落盘态）。
 *
 * 为什么位置断言必须以模型为准：`getBoundingClientRect()` 是**屏幕**坐标，
 *   会被画布滚动（`ds-canvas-wrap` 是 `overflow:auto`）、缩放、左右栏宽度变化影响
 *   ⇒ 实测出现过「模型只左移 30，屏幕却差 240」的假失败（C8.4）。
 *   屏幕坐标只用于**辅助**证明「视图跟随模型」，不作断言基准。
 */
const modelPos = (id) => js(`(function(){
	var o=JSON.parse(localStorage.getItem('dsh.director.design')||'{}');
	var d=(o.docs||[]).filter(function(x){return x.docId===o.activeDocId;})[0]||(o.docs||[])[0];
	if(!d) return null;
	var e=(d.elements||[]).filter(function(x){return x.id===${JSON.stringify(id)};})[0];
	return e? {x:e.x,y:e.y,w:e.w,h:e.h} : null;
})()`);
const elCount = () => js(`document.querySelectorAll('[data-testid=ds-el]').length`);
/** 当前画布缩放（读顶栏百分比 → 数值）。断言"非 1 缩放"场景时必须有它。 */
const readScale = () => js(`(function(){var e=document.querySelector('[data-testid=ds-zoom]');if(!e)return null;return parseInt(e.textContent,10)/100;})()`);
/** 焦点挪出输入框 —— 键盘处理器显式忽略 INPUT/TEXTAREA/SELECT（DesignStudio.js:321） */
const blurAll = () => js(`(function(){try{if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();}catch(e){}return document.activeElement?document.activeElement.tagName:null;})()`);

/**
 * 保证「有一个元素处于选中态」，并返回它的 id。
 *
 * 为什么需要它（测试自身的教训）：Delete 删除后 `commit` 会**自动清空选中**
 *   ⇒ 逻辑面板切回空分支 ⇒ `ds-dup` / `ds-del` 消失、`selectedId()` 返回 null。
 *   早先版本正是因此把「产品正确」误判成 ❌（C7.1 / C8.3）。
 * 点选时要求该元素在自身中心点**处于最上层**，否则会选中压在上面的别的元素。
 */
async function ensureSelected() {
	let id = await selectedId();
	if (id) return id;
	const rect = await js(`(function(){
		var els=[].slice.call(document.querySelectorAll('[data-testid=ds-el]'));
		for (var i=0;i<els.length;i++){
			var e=els[i], r=e.getBoundingClientRect();
			if (r.width<12||r.height<12) continue;
			var cx=r.x+r.width/2, cy=r.y+r.height/2;
			var top=document.elementFromPoint(cx,cy);
			if (top===e || (top && e.contains(top))) return {x:cx,y:cy,id:e.getAttribute('data-el-id')};
		}
		return null;
	})()`);
	if (!rect) return null;
	await clickAt(rect.x, rect.y);
	await sleep(500);
	return await selectedId();
}

/* 🔴 2026-09-16 差异清单 C1：「移动 <目标> 左 30」这类断言必须先证前提 ——
 * **目标要有左移空间**（模型 x ≥ minRoom）。实测 C8.4 选中 el-4-sid（「侧栏 · 会话树」）
 * 模型 x=0 已贴画布左边界，moveElement 的边界钳制（"不允许拖出画布外丢失"）正确生效
 * ⇒ 实际位移 0 被断成"产品缺陷"。改为：已选中元素无空间时，从模型里挑一个
 * 有空间且可被真实点击的元素点选（点击另一元素会自动切换选中，无需先取消）。 */
async function ensureSelectedWithRoom(minRoom) {
	const room = (minRoom == null) ? 40 : minRoom;
	const cur = await selectedId();
	if (cur) {
		const p = await modelPos(cur);
		if (p && p.x >= room) return cur;
	}
	const cand = await js(`(function(){
		var o=JSON.parse(localStorage.getItem('dsh.director.design')||'{}');
		var d=(o.docs||[]).filter(function(x){return x.docId===o.activeDocId;})[0]||(o.docs||[])[0];
		if(!d) return null;
		var ids=(d.elements||[]).filter(function(e){return !e.hidden && !e.locked && e.x>=${room};})
			.map(function(e){return e.id;});
		if(!ids.length) return null;
		var els=[].slice.call(document.querySelectorAll('[data-testid=ds-el]'));
		for (var i=0;i<els.length;i++){
			var el=els[i], eid=el.getAttribute('data-el-id');
			if (ids.indexOf(eid)<0) continue;
			var r=el.getBoundingClientRect();
			if (r.width<12||r.height<12) continue;
			var cx=r.x+r.width/2, cy=r.y+r.height/2;
			var top=document.elementFromPoint(cx,cy);
			if (top===el || (top && el.contains(top))) return {x:cx,y:cy,id:eid};
		}
		return null;
	})()`);
	if (!cand) return null;
	await clickAt(cand.x, cand.y);
	await sleep(500);
	return await selectedId();
}

let pass = 0, fail = 0, skipped = 0; const rows = [];

/* ══════════════════════════════════════════════════════════════════════════
 *  闸门自身异常兜底（2026-09-14 补，与 `verify-mindmap` / `verify-v20` **同一套约定**）
 *
 *  为什么必须补（本轮实测踩到，且**是本项目登记过的同类事故的第 2 次**）：
 *    渲染进程主线程被占住时，`ev()` 不再抛错，而是**返回 `{__err: "CDP_TIMEOUT …"}`**。
 *    调用方若把它当数组/对象常规使用，就会在**深层**炸出 TypeError，
 *    而顶层没有兜底 ⇒ 进程只留一个堆栈，**后面所有断言一条都没跑，也没人知道**。
 *    现场（同日 `verify-flow.mjs`）：崩在 1143 行，其后 D6/D7 + 收尾段全部丢失。
 *
 *  ⇒ 兜住任何未捕获异常 / 未处理拒绝：把**已经跑出来的**结果 + "其后未跑"明确打出来，
 *     并以 **exit 2（INVALID）** 收尾。「脚本自己死了 ≠ 产品不合格」（纪律 17）。 */
let reachedFinal = false;
const dieReport = (why) => {
	console.error("\n───────────────────────────────────────────────");
	console.error(" ❌ INVALID：脚本异常终止 —— " + why);
	console.error(` 已跑出：通过 ${pass} / 失败 ${fail} / 跳过 ${skipped}（合计 ${pass + fail + skipped}）`);
	console.error(` 是否已到达收尾段：${reachedFinal}`);
	const shown = rows.filter((r) => r.ok === false).map((r) => r.id + " " + r.name);
	if (shown.length) console.error(" 期间失败项：\n   - " + shown.join("\n   - "));
	console.error(" 其后段落**一条都没跑** ⇒ 不得据此判定产品好坏。");
	console.error(" 处置：重启 Harness 重跑（本工具会话下须**同一条命令内**先启动再测）。");
	console.error("───────────────────────────────────────────────");
	process.exit(2);
};
process.on("uncaughtException", (e) => dieReport("uncaughtException：" + ((e && e.stack) || e)));
process.on("unhandledRejection", (e) => dieReport("unhandledRejection：" + ((e && (e.stack || e.message)) || e)));
function assert(id, name, ok, detail) {
	rows.push({ id, name, ok, detail }); ok ? pass++ : fail++;
	console.log(`  ${ok ? "✅" : "❌"} ${id} ${name}`);
	if (detail !== undefined) console.log(`      ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}
/* 🔴 2026-09-14 补（纪律 18）：**"跳过"比"红"更危险** —— 所以跳过必须
 *   ① 有**可分辨、可证伪**的原因（不是"本机数据如此"这种没法反驳的收尾）；
 *   ② 单独计数并进汇总，绝不算进 pass（否则跳过会伪装成通过）。
 *   用途：某些断言需要**环境测试面**（如 Windows 原生窗口控件覆盖层存在），
 *   而测试面不成立时断言恒真/恒假 —— 此时报 SKIP + 原因，并另加一条**契约断言**
 *   覆盖"测试面不存在时产品应当怎么做"，保证这一组不是白跑的。 */
function skip(id, name, reason, detail) {
	rows.push({ id, name, ok: null, reason, detail }); skipped++;
	console.log(`  ⏭️ ${id} ${name}`);
	console.log(`      跳过原因：${reason}`);
	if (detail !== undefined) console.log(`      ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

console.log("════════════════════════════════════════════════════════════");
console.log(" 设计图工作室 · 真机逐交互验证（批次 10）");
console.log("════════════════════════════════════════════════════════════");

/* ══ C1 入口按钮 ══ */
console.log("\n【C1】入口按钮（总监页设计图插件 · 按钮形式）");
const btn = await js(`(function(){
	var b=document.getElementById('dsh-design-studio-launcher'); if(!b) return null;
	var r=b.getBoundingClientRect();
	return { txt:(b.textContent||'').trim(), cx:r.x+r.width/2, cy:r.y+r.height/2, w:Math.round(r.width), h:Math.round(r.height),
	         inDock: !!b.closest('#dsh-director-floatdock'), visible: r.width>10&&r.height>10 };
})()`);
assert("C1.1", "设计图入口按钮存在且可见", !!(btn && btn.visible), btn);
assert("C1.2", "按钮归属总监域浮动按钮组", !!(btn && btn.inDock), btn ? "text=" + btn.txt : "n/a");

if (btn) { await clickAt(btn.cx, btn.cy); await sleep(1000); }

/* ══ C2 铺满全屏 ══ */
console.log("\n【C2】点击后铺满全屏");
/* 🔴 开启动画**必须等它真的播完**再量几何（第二十四轮实测）
 *    产品挂在 `.dp-overlay-in`（`animation: dp-overlay-in .14s`，from `scale(.985)`）。
 *    duration 只有 140ms，但本环境存在**帧节流**：实测 t=1.2s / 2.7s 时
 *    `transform` 仍是 `matrix(0.985,...)`（rect 11,6,1420,804 —— 四边各差 11/6px），
 *    到 t=5.7s 才归位成 `none`（0,0,1442,816 完全贴合）。
 *    ⇒ 「固定 sleep(1000) 后量几何」会把**动画没播完**读成「工作室没铺满」（产品缺陷的形态），
 *      而且是**时绿时红** —— 取决于量的时候动画走到哪，这正是最难查的一类假红。
 *    处置：**有界轮询**等到动画归位（transform 归位 且 四边贴合），预算 15s，并把等待时长打出来。
 *    （同族：本环境 CDP 输入派发实测 ~1s 送达延迟 —— verify-mindmap 已用同一条处置修掉 3 红。） */
let animWaited = 0;
for (let i = 0; i < 100; i++) {
	const animDone = await js(`(function(){
		var s=document.getElementById('dsh-design-studio'); if(!s) return false;
		var r=s.getBoundingClientRect(), cs=getComputedStyle(s);
		var flush = Math.abs(r.x)<2 && Math.abs(r.y)<2 && Math.abs(r.width-innerWidth)<6 && Math.abs(r.height-innerHeight)<6;
		return (cs.transform === 'none' || cs.transform === 'matrix(1, 0, 0, 1, 0, 0)') && flush;
	})()`);
	animWaited = i * 150;
	if (animDone) break;
	await sleep(150);
}
console.log("  · 开启动画归位等待：" + animWaited + "ms（预算 15000ms）");
const full = await js(`(function(){
	var s=document.getElementById('dsh-design-studio'); if(!s) return {mounted:false};
	var r=s.getBoundingClientRect(), cs=getComputedStyle(s);
	var maxZ=0; [].slice.call(document.querySelectorAll('body *')).forEach(function(e){var z=parseInt(getComputedStyle(e).zIndex||'0',10); if(z>maxZ)maxZ=z;});
	return { mounted:true, x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
	         vw:innerWidth, vh:innerHeight, pos:cs.position, z:cs.zIndex, maxZ:maxZ,
	         covers: Math.abs(r.x)<2 && Math.abs(r.y)<2 && Math.abs(r.width-innerWidth)<6 && Math.abs(r.height-innerHeight)<6 };
})()`);
assert("C2.1", "工作室已挂载", !!(full && full.mounted), full);
assert("C2.2", "position:fixed 且四边贴合视口", !!(full && full.covers), full ? `${full.w}x${full.h} vs 视口 ${full.vw}x${full.vh} · position=${full.pos} · z=${full.z}` : "n/a");

/* ══ C2b 缩放归一到 1:1（后续位移断言的基准）══
 * 🔴 为什么必须先做这一步：工作室打开时**自动适应容器**（新行为）——
 *    标准框架是固定 1180×644 的画布，而可视区宽约 800–1100px，
 *    不缩放就必然右侧被裁、要用户自己发现右下角还有内容。
 *    ⇒ 于是打开后 k≠1，而"屏幕 Δ ≈ 模型 Δ"这类断言**只在 k=1 时成立**。
 *    先把基准钉在 100%，再在 C4.3/C4.4 专门验证 k≠1 下的一致性。 */
await clickTestId("ds-zoom-100");
await sleep(320);
const scaleBase = await readScale();
assert("C2.3", "缩放可归一到 1:1（作为位移断言的基准）", scaleBase === 1, "缩放 = " + (scaleBase === null ? "n/a" : Math.round(scaleBase * 100) + "%"));

/* ══ C2c 审美审核回归（2026-09-12）══
 * 这三条都是**只看截图才发现**的缺陷，之前 38 项全绿却全都漏过 ——
 * 因为它们不破坏任何"逻辑"，只破坏"看得见 / 点得到"：
 *   (1) 画布网格被不透明底层盖死 ⇒ 名字叫 grid 但肉眼没有刻度；
 *   (2) toast `bottom:12` 正压在底栏输入框上（底栏高度可变，固定 bottom 绕不开）；
 *   (3) toast 只有 onClick 才清 ⇒ **永不自动消失**，一直压在画布上。
 * 教训：**逻辑断言全绿 ≠ 界面可用**。"可见性/遮挡/自愈"必须单独断言。 */
const gridVis = await js(`(function(){
  var g=document.querySelector('[data-testid=ds-canvas]'); if(!g) return null;
  var cs=getComputedStyle(g);
  return { hasRepeating: /repeating-linear-gradient/.test(cs.backgroundImage||''), layerCount:(cs.backgroundImage||'').split('repeating-linear-gradient').length-1,
           bgColor: cs.backgroundColor, firstIsOpaque: /^linear-gradient/.test((cs.backgroundImage||'').trim()) };
})()`);
assert("C2.4", "画布有可见网格（网格层未被不透明底层遮死）",
	!!(gridVis && gridVis.hasRepeating && gridVis.layerCount === 2 && !gridVis.firstIsOpaque),
	gridVis);

// toast：新增元素会弹提示 ⇒ 立刻检查位置不压输入框，并在 2.6s 后检查已自动消失
await clickTestId("ds-add-badge");
await sleep(320);
const toastNow = await js(`(function(){
  var t=document.querySelector('[data-testid=ds-toast]'), i=document.querySelector('[data-testid=ds-input]');
  if(!t) return {shown:false};
  var tr=t.getBoundingClientRect(), ir=i?i.getBoundingClientRect():null;
  var overlap = ir ? !(tr.bottom<ir.top||tr.top>ir.bottom||tr.right<ir.left||tr.left>ir.right) : false;
  return { shown:true, y:Math.round(tr.y), inputY: ir?Math.round(ir.y):null, overlap:overlap, pe:getComputedStyle(t).pointerEvents,
           text:(t.textContent||'').slice(0,20) };
})()`);
assert("C2.5", "提示浮层不遮挡底栏输入框（且不拦截点击）",
	!!(toastNow && toastNow.shown && !toastNow.overlap && toastNow.pe === "none"), toastNow);
await sleep(2600);
const toastGone = await js(`!document.querySelector('[data-testid=ds-toast]')`);
assert("C2.6", "提示浮层 2.2s 后自动消失（不长期压住画布）", toastGone === true, "2.2s 后仍存在 = " + !toastGone);

/* ══ C3 增加元素 ══ */
console.log("\n【C3】增加元素（工具栏 18 类 → 画布新增）");
const kinds = await js(`(function(){
	var bar=document.querySelector('[data-testid=ds-kinds]'); if(!bar) return null;
	var bs=[].slice.call(bar.querySelectorAll('[data-testid^=ds-add-]'));
	return { count:bs.length, kinds:bs.map(function(b){return b.getAttribute('data-testid').replace('ds-add-','');}) };
})()`);
assert("C3.1", "工具栏渲染 18 类元素按钮", !!(kinds && kinds.count === 18), kinds);
const c0 = await elCount();
const addRes = await clickTestId("ds-add-button");
await sleep(500);
const c1 = await elCount();
assert("C3.2", "点击「按钮」类 → 元素数 +1", c1 === c0 + 1, `${c0} → ${c1}` + (addRes.ok ? "" : " (" + addRes.why + ")"));
const newId = await selectedId();
assert("C3.3", "新增后自动选中（左栏切到该元素）", !!newId, "selected id = " + newId);

/* ══ C9 逻辑面板（七元组） ══ */
console.log("\n【C9】点击元素 → 左侧显示交互逻辑（七元组）");
const logic = await js(`(function(){
	var panel=document.querySelector('[data-testid=ds-logic]');
	var fields=[].slice.call(document.querySelectorAll('[data-testid^=ds-logic-]'));
	var label=document.querySelector('[data-testid=ds-el-label]');
	return { panelPresent: !!panel, elId: panel?panel.getAttribute('data-el-id'):null,
	         fieldCount: fields.length,
	         keys: fields.map(function(f){return f.getAttribute('data-testid').replace('ds-logic-','');}),
	         hasLabelInput: !!label, labelTag: label?label.tagName:null,
	         fieldsVisible: fields.length? fields[0].getBoundingClientRect().width>0 : false,
	         allEditable: fields.length===7 && fields.every(function(f){return f.tagName==='TEXTAREA'||f.tagName==='INPUT';}) };
})()`);
const EXPECT_KEYS = ["trigger", "action", "state", "data", "fallback", "shortcut", "code"];
assert("C9.1", "左栏逻辑面板已切到选中元素", logic.panelPresent, logic.elId);
assert("C9.2", "七元组字段齐备（触发/行为/状态/数据/退化/快捷键/代码）", JSON.stringify(logic.keys) === JSON.stringify(EXPECT_KEYS), logic.keys);
assert("C9.3", "七元组字段均可编辑 + 名称可改", logic.allEditable && logic.hasLabelInput, "editable=" + logic.allEditable + " labelInput=" + logic.labelTag);

/* 编辑一个逻辑字段并回读（证明"可修改"而非只读展示） */
const editRes = await js(`(function(){
	var ta=document.querySelector('[data-testid=ds-logic-action]'); if(!ta) return {ok:false};
	var setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
	setter.call(ta,'E2E：点击后打开弹窗'); ta.dispatchEvent(new Event('input',{bubbles:true}));
	return {ok:true};
})()`);
await sleep(400);
const editBack = await js(`(function(){var o=JSON.parse(localStorage.getItem('dsh.director.design')||'{}');var d=(o.docs||[]).filter(function(x){return x.docId===o.activeDocId;})[0];if(!d)return null;var el=(d.elements||[]).filter(function(e){return e.id===${JSON.stringify(newId)};})[0];return el? (el.logic&&el.logic.action):null;})()`);
assert("C9.4", "编辑逻辑字段 → 落库回读一致", editBack === "E2E：点击后打开弹窗", "回读 action = " + JSON.stringify(editBack));

/* ══ C4 拖拽 ══ */
console.log("\n【C4】拖拽（真实鼠标 按下-移动-抬起）");
const b4 = await modelPos(newId);
const b4dom = await ensureVisible(newId);
if (b4dom) { await drag(b4dom.x + b4dom.w / 2, b4dom.y + b4dom.h / 2, b4dom.x + b4dom.w / 2 + 120, b4dom.y + b4dom.h / 2 + 70, 8); await sleep(500); }
const a4 = await modelPos(newId);
const a4dom = await posOfId(newId);
const mdx = a4 && b4 ? a4.x - b4.x : 0, mdy = a4 && b4 ? a4.y - b4.y : 0;
const ddx = a4dom && b4dom ? a4dom.x - b4dom.x : 0, ddy = a4dom && b4dom ? a4dom.y - b4dom.y : 0;
assert("C4.1", "拖拽后**模型**位移符合预期（≈ +120,+70）", Math.abs(mdx - 120) <= 14 && Math.abs(mdy - 70) <= 14, b4 && a4 ? `模型 Δ=(${mdx},${mdy})` : "n/a");
assert("C4.2", "视图跟随模型（DOM 位移与模型一致）", Math.abs(ddx - mdx) <= 2 && Math.abs(ddy - mdy) <= 2, `DOM Δ=(${ddx},${ddy}) vs 模型 Δ=(${mdx},${mdy})`);

/* ══ C4.3 / C4.4 非 1 缩放下的拖拽一致性 ══
 * 🔴 这是 2026-09-12 审美审核时**新发现的逻辑缺陷**的回归闸门：
 *   画布用 `transform: scale(k)` 呈现，鼠标位移是**屏幕像素**、元素坐标是**模型像素**，
 *   原实现把屏幕位移直接当模型位移用 ⇒ k=0.5 时"拖一格跑两格"（视觉与手感背离），
 *   k=1（默认）时恰好正确，所以此前所有断言都是绿的 —— **只在非 1 缩放才暴露**。
 *   修正：位移一律 `÷k`（k 在 pointerdown 时冻结进 ref，避免闭包读旧值）。
 *   断言设计：拖 d 屏幕像素 ⇒ 模型 Δ 应 ≈ d/k，且 DOM 屏幕位移仍 ≈ d（手感不背离）。 */
await clickTestId("ds-zoom-out");
await clickTestId("ds-zoom-out");
await sleep(380);
const kScale = await readScale();
const b4b = await modelPos(newId);
const b4bdom = await ensureVisible(newId);
if (b4bdom && kScale) { await drag(b4bdom.x + b4bdom.w / 2, b4bdom.y + b4bdom.h / 2, b4bdom.x + b4bdom.w / 2 + 80, b4bdom.y + b4bdom.h / 2 + 40, 8); await sleep(500); }
const a4b = await modelPos(newId);
const a4bdom = await posOfId(newId);
const md2x = a4b && b4b ? a4b.x - b4b.x : 0, md2y = a4b && b4b ? a4b.y - b4b.y : 0;
const dd2x = a4bdom && b4bdom ? a4bdom.x - b4bdom.x : 0, dd2y = a4bdom && b4bdom ? a4bdom.y - b4bdom.y : 0;
const expX = kScale ? 80 / kScale : 0, expY = kScale ? 40 / kScale : 0;
assert("C4.3", "非 1 缩放下：模型位移 = 屏幕位移 ÷ 缩放", Math.abs(md2x - expX) <= 8 && Math.abs(md2y - expY) <= 8,
	kScale ? `k=${kScale} · 拖(80,40) ⇒ 模型 Δ=(${md2x},${md2y}) · 期望≈(${Math.round(expX)},${Math.round(expY)})` : "缩放读取失败");
assert("C4.4", "非 1 缩放下：屏幕位移 ≈ 手感位移（视图不背离）", Math.abs(dd2x - 80) <= 8 && Math.abs(dd2y - 40) <= 8,
	`屏幕 Δ=(${dd2x},${dd2y}) · 拖了 (80,40)`);
await clickTestId("ds-zoom-100");
await sleep(320);

/* ══ C5 缩放（resize handle） ══ */
console.log("\n【C5】缩放（右下把手拖拽）");
// 先把目标元素拉回可视区，再读把手 —— 否则把手会在视口外，拖拽静默打空
const selForHandle = await selectedId();
assert("C5.0", "目标元素仍处于选中态（把手才存在）", selForHandle === newId, "selected = " + selForHandle + " · 期望 " + newId);
await ensureVisible(newId);
const h5 = await rectOf('[data-testid="ds-handle"]');
const b5 = await modelPos(newId);
if (h5 && b5) { await drag(h5.cx, h5.cy, h5.cx + 60, h5.cy + 40, 6); await sleep(500); }
const a5 = await modelPos(newId);
assert("C5.1", "拖把手 → **模型**尺寸变大", !!(b5 && a5 && a5.w > b5.w + 20 && a5.h > b5.h + 10), b5 && a5 ? `${b5.w}x${b5.h} → ${a5.w}x${a5.h}` : "n/a");
const a5dom = await posOfId(newId);
assert("C5.2", "视图跟随模型（DOM 尺寸与模型一致）", !!(a5 && a5dom && Math.abs(a5dom.w - a5.w) <= 2 && Math.abs(a5dom.h - a5.h) <= 2), a5 && a5dom ? `DOM ${a5dom.w}x${a5dom.h} vs 模型 ${a5.w}x${a5.h}` : "n/a");

/* ══ C12 键盘 ══ */
console.log("\n【C12】键盘（方向键微移 / Ctrl+D 复制 / Delete 删除）");
let cur = await ensureSelected();
assert("C12.0", "存在选中元素可作键盘作用对象", !!cur, "selected = " + cur);

await blurAll();
const k0 = await elCount();
await key("d", "KeyD", { vk: 68, mod: 2 });
await sleep(400);
const k1 = await elCount();
assert("C12.1", "Ctrl+D 复制元素（数量 +1）", k1 === k0 + 1, `${k0} → ${k1}`);

// 复制可能改变选中对象 ⇒ 每次测量前**重新读一次选中 id**（不假定还是老的）
cur = (await selectedId()) || cur;
await blurAll();
const r0 = await modelPos(cur);
await key("ArrowRight", "ArrowRight", { vk: 39 });
await sleep(300);
const r1 = await modelPos(cur);
assert("C12.2", "→ 键**模型**微移 10px", !!(r0 && r1 && r1.x - r0.x === 10), r0 && r1 ? `Δx=${r1.x - r0.x}（${cur}）` : `n/a（${cur} 未找到）`);

await blurAll();
await key("ArrowRight", "ArrowRight", { vk: 39, mod: 8 }); // Shift+→ = 1px
await sleep(300);
const r2 = await modelPos(cur);
assert("C12.3", "Shift+→ **模型**微移 1px（精细档）", !!(r1 && r2 && r2.x - r1.x === 1), r1 && r2 ? `Δx=${r2.x - r1.x}` : "n/a");

await blurAll();
await key("Delete", "Delete", { vk: 46 });
await sleep(400);
const k2 = await elCount();
assert("C12.4", "Delete 删除选中元素（数量 -1）", k2 === k1 - 1, `${k1} → ${k2}`);

/* ══ C7 逻辑面板操作按钮 ══ */
console.log("\n【C7】逻辑面板操作按钮（复制 / 删除）");
// 🔴 必须先恢复选中：C12.4 的 Delete 会清空选中，逻辑面板随之切回空分支
const sel7 = await ensureSelected();
assert("C7.0", "恢复选中以便操作按钮可见", !!sel7, "selected = " + sel7);
const c7 = await js(`(function(){var o={};['ds-dup','ds-del'].forEach(function(i){var e=document.querySelector('[data-testid='+i+']');o[i]=!!e;});return o;})()`);
const c7n = Object.values(c7).filter(Boolean).length;
assert("C7.1", "含元素复制 / 删除按钮", c7n === 2, c7);
const k3 = await elCount();
await clickTestId("ds-dup");
await sleep(400);
const k4 = await elCount();
assert("C7.2", "点击「复制」→ 元素数 +1", k4 === k3 + 1, `${k3} → ${k4}`);

/* ══ C8 设计图专用对话 ══ */
console.log("\n【C8】底部设计图专用对话（只处理本图修订）");
const th = await js(`(function(){
	return { bar:!!document.querySelector('[data-testid=ds-thread]'),
	         input:!!document.querySelector('[data-testid=ds-input]'),
	         send:!!document.querySelector('[data-testid=ds-send]'),
	         emptyHint:!!document.querySelector('[data-testid=ds-thread-empty]'),
	         isolation: (function(){var t=document.querySelector('[data-testid=ds-thread]');return t? /三向隔离/.test(t.textContent||'') : false;})(),
	         ph:(document.querySelector('[data-testid=ds-input]')||{}).placeholder||null };
})()`);
assert("C8.1", "底栏对话保留（输入 + 发送）", th.bar && th.input && th.send, th);
assert("C8.2", "明示「只处理本图 / 三向隔离」", th.isolation, "isolation note=" + th.isolation);

// 发送一条本地可解析指令（ds-input 是 <input>，须用 HTMLInputElement 的 setter）
// 🔴 目标必须**确实存在**：早先版本沿用了已被 Delete 掉的 id，导致解析出 0 项操作、
//    待确认区不出现（pending.ops.length === 0 时该区块本就不渲染）⇒ 误判为产品缺陷。
const tgt = await ensureSelectedWithRoom(40);
assert("C8.0", "存在可被指令指称的目标元素", !!tgt, "target = " + tgt);
assert("C8.0c", "🔴 目标有左移空间（模型 x ≥ 40 —— 先证前提，防边界钳制把「左 30」吞成 0）",
	!!tgt && (await modelPos(tgt)).x >= 40, tgt ? "x=" + (await modelPos(tgt)).x : "无目标");
// 🔴 用**多词 label** 指称（而不是 id）—— 这才是用户真实写法，
//    同时回归「label 含空格就指称不到」的缺陷（离线测试 C12 同源）
const tgtLabel = await js(`(function(){
	var o=JSON.parse(localStorage.getItem('dsh.director.design')||'{}');
	var d=(o.docs||[]).filter(function(x){return x.docId===o.activeDocId;})[0]||(o.docs||[])[0];
	if(!d) return null;
	var e=(d.elements||[]).filter(function(x){return x.id===${JSON.stringify(tgt)};})[0];
	return e? e.label : null;
})()`);
const cmd = `移动 ${tgtLabel} 左 30`;
assert("C8.0b", "目标元素带可读 label（供多词指称）", !!tgtLabel, "label = " + tgtLabel + " / 指令 = " + cmd);
const typed = await js(`(function(){
	var ta=document.querySelector('[data-testid=ds-input]'); if(!ta) return {ok:false};
	var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
	setter.call(ta, ${JSON.stringify(cmd)}); ta.dispatchEvent(new Event('input',{bubbles:true}));
	return {ok:true, value:ta.value};
})()`);
await sleep(300);
await clickTestId("ds-send");
await sleep(800);
const pd = await js(`(function(){
	var p=document.querySelector('[data-testid=ds-pending]');
	return { visible: !!(p && p.getBoundingClientRect().width>0), text: p?(p.textContent||'').trim().slice(0,150):null,
	         hasApply:!!document.querySelector('[data-testid=ds-apply]'), hasDrop:!!document.querySelector('[data-testid=ds-drop]') };
})()`);
assert("C8.3", "发送指令 → 进入待确认区（不静默改图）", !!(pd.visible && pd.hasApply && pd.hasDrop), { typed: typed.ok, pending: pd });

const preX = await modelPos(tgt);
await clickTestId("ds-apply");
await sleep(800);
const postX = await modelPos(tgt);
const moved = preX && postX ? preX.x - postX.x : 0;
assert("C8.4", "确认应用 → 目标元素**模型**左移 30px", Math.abs(moved - 30) <= 2, `Δx=-${moved}（目标 ${tgt}）`);
const threadMsg = await js(`(function(){var t=document.querySelector('[data-testid=ds-thread]');return t? /你：/.test(t.textContent||'') : false;})()`);
assert("C8.5", "修订留痕进对话流", threadMsg, "thread 含「你：」= " + threadMsg);

/* ══ C10 标准框架映射 ══ */
console.log("\n【C10】标准设计图框架映射");
await clickTopAction("ds-frame");
await sleep(1000);
const fr = await js(`(function(){
	var n=document.querySelectorAll('[data-testid=ds-el]').length;
	var s=document.querySelector('[data-testid=ds-stats]');
	return { elementCount:n, stats:s?(s.textContent||'').trim():null };
})()`);
assert("C10.1", `载入标准框架 = ${FRAME_ELEMENTS.length} 个预置元素（取自 schema 真值）`, fr.elementCount === FRAME_ELEMENTS.length, fr);
assert("C10.2", "统计条回显「元素 / 逻辑缺口 / 修订记录」", !!(fr.stats && /元素\s*\d+/.test(fr.stats)), fr.stats);
const seedLogic = await js(`(function(){var o=JSON.parse(localStorage.getItem('dsh.director.design')||'{}');var d=(o.docs||[]).filter(function(x){return x.docId===o.activeDocId;})[0];if(!d)return null;var els=d.elements||[];return {total:els.length, withAction:els.filter(function(e){return e.logic&&e.logic.action;}).length, withCode:els.filter(function(e){return e.logic&&e.logic.code;}).length, fullTuple:els.filter(function(e){var l=e.logic||{};return ${JSON.stringify(LOGIC_FIELDS.map((f) => f.key))}.every(function(k){return String(l[k]||'').trim().length>0;});}).length};})()`);
assert("C10.3", "标准框架每元素自带行为与代码指向", !!(seedLogic && seedLogic.withAction === seedLogic.total && seedLogic.withCode === seedLogic.total), seedLogic);
// 更强的业务不变量：七元组**不留空**（设计图要当"可执行规格"用，空字段等于没写）
const schemaFullTuple = FRAME_ELEMENTS.filter((e) => LOGIC_FIELDS.every((f) => String((e.logic || {})[f.key] || "").trim().length > 0)).length;
assert("C10.4", `七元组无空字段（schema 侧 ${schemaFullTuple}/${FRAME_ELEMENTS.length}）`, schemaFullTuple === FRAME_ELEMENTS.length, "缺口 = " + (FRAME_ELEMENTS.length - schemaFullTuple));

/* ══ C11 持久化 / 多文档 ══ */
console.log("\n【C11】存盘 / 多文档");
const st1 = await js(`(function(){
	var raw=null; try{raw=localStorage.getItem('dsh.director.design');}catch(e){}
	if(!raw) return {hasKey:false};
	var o=JSON.parse(raw);
	return { hasKey:true, bytes:raw.length, docCount:(o.docs||[]).length, activeId:o.activeId||null,
	         optionCount: document.querySelectorAll('[data-testid=ds-doclist] option').length };
})()`);
assert("C11.1", "已写入 localStorage 主存", st1.hasKey, st1);
await clickTestId("ds-new");
await sleep(800);
const st2 = await js(`(function(){
	var o=JSON.parse(localStorage.getItem('dsh.director.design')||'{}');
	return { docCount:(o.docs||[]).length, optionCount: document.querySelectorAll('[data-testid=ds-doclist] option').length };
})()`);
assert("C11.2", "新建图 → 文档数 +1（文档选择器同步）", st2.docCount === (st1.docCount || 0) + 1 && st2.optionCount === st2.docCount, `${st1.docCount} → ${st2.docCount}`);

/* ══ C13 Esc 逐层退（**四层栈**：个性化 → 待确认 → 选中 → 关工作室）══ */
console.log("\n【C13】Esc 逐层退（四层栈 · 不清空就关窗）");

/* 浮层归零（本轮新增 · 全脚本共用一处真相源）
 * 覆盖两类**有意打开**的浮层：
 *   ① 版本历史面板（`ds-ver-panel`）—— 用它的开合按钮 `ds-ver-toggle` 自己关；
 *   ② 个性化面板（`pp-panel`）—— 四个界面共用一个组件，可能有多个实例挂着，逐个走 `pp-close`。
 *
 * ── 为什么必须共用一处（真机实测的完整因果链，数字全部对得上）──────────
 * 真凶是 **C16.2**：它"逐个真实点击顶栏按钮"，`ds-personalize`（⚙ 设置）也在列表里
 *   （只排除了 `ds-close`）。可 ⚙ 是**开合按钮** —— 点开之后没有人关它。于是：
 *     r1：C13 跑在 C16.2 **之前** ⇒ 绿；C16.2 点开 ⚙ ⇒ 同一次运行的 C16.11
 *         报 `ds-add-progress ← div`，覆盖者就是这个面板（它恰好只罩这一个按钮，
 *         看着特别像"这一个按钮实现错了"）；面板留到运行结束。
 *     r2/r3：C13 一开始就带着 r1 的残留 ⇒ Esc#1 被该面板 window-capture 的
 *         `stopPropagation()` 吃掉 ⇒ 待确认没清 ⇒ C13.1/C13.2 红。
 *         现场形态是"r1 绿 r2 r3 红"的**假偶发**，真相是**跨运行污染**
 *         （本脚本不重载页面，连的是已运行的 Harness 实例）。
 * 教训（两条，都值得记）：
 *   ① **开合型按钮**被"逐个点击"类测试碰到时必须还原，且还原要有断言；
 *   ② 一次**没归还的状态**可以伪装成"偶发失败"，比直接红更难查 ——
 *      所以每次运行的起点必须**显式**建立，而不是"上次应该关了吧"。
 * 先前 C13 与 C16.11 各写各的关闭逻辑、C16.2 则根本没关 ⇒ 统一到这里。 */ 
const closeFloatLayers = async () => {
	for (let i = 0; i < 3; i++) {
		if (!(await js("!!document.querySelector('[data-testid=ds-ver-panel]')"))) break;
		await clickTestId("ds-ver-toggle");
		await sleep(300);
	}
	for (let i = 0; i < 4; i++) {
		if (!(await js("!!document.querySelector('[data-testid=pp-panel]')"))) break;
		await clickTestId("pp-close");
		await sleep(280);
	}
	/* ③ 导出兜底面板（剪贴板被系统拒绝时展开的可复制文本域）—— 同属"有意打开"的浮层 */
	for (let i = 0; i < 3; i++) {
		if (!(await js("!!document.querySelector('[data-testid=ds-export-panel]')"))) break;
		await clickTestId("ds-export-close");
		await sleep(260);
	}
	return await js(`(function(){ return {
		ver: !!document.querySelector('[data-testid=ds-ver-panel]'),
		pp:  document.querySelectorAll('[data-testid=pp-panel]').length,
		exp: !!document.querySelector('[data-testid=ds-export-panel]') }; })()`);
};
/** 三类浮层是否全部归零 —— 只留一处判据，避免"各段各写一遍、漏一类" */
const floatsClean = (f) => !!f && f.pp === 0 && f.ver === false && f.exp === false;

const f0 = await closeFloatLayers();
assert("C13.0", "前置：先把个性化 / 版本 / 导出浮层归零（⚙ 面板开着会 stopPropagation 吃掉 Esc，把 C13 变成假红）",
	floatsClean(f0), f0);

/* Esc 栈四层 + 按钮态的一次性快照（单次求值，避免四次读之间状态漂移） */
const escStack = () => js(`(function(){
	var s  = document.getElementById('dsh-design-studio');
	var pp = document.querySelector('[data-testid=ds-root] [data-testid=pp-panel]') || document.querySelector('[data-testid=pp-panel]');
	var pz = document.querySelector('[data-testid=ds-personalize]');
	return {
		studioOpen:  !!s && s.getBoundingClientRect().width > 0,
		personalize: !!pp && pp.getBoundingClientRect().width > 0,
		pzBtn:       pz ? pz.getAttribute('data-on') : null,
		pending:     !!document.querySelector('[data-testid=ds-pending]'),
		selected:    !!document.querySelector('[data-testid=ds-logic]')
	};
})()`);

/* 造一个**可解析**的待确认（命令里的目标必须能命中，否则 ops=0 ⇒ 待确认区不出现）。
 * 抽成函数是因为下面的反证要**重造一次**同一个前提。 */
const makePending = async () => {
	const tgt = await ensureSelected();
	await js(`(function(){var ta=document.querySelector('[data-testid=ds-input]');if(!ta)return;var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(ta,${JSON.stringify(`移动 ${tgt} 下 20`)});ta.dispatchEvent(new Event('input',{bubbles:true}));})()`);
	await sleep(250);
	await clickTestId("ds-send");
	await sleep(700);
	return await escStack();
};
const s13a = await makePending();
assert("C13.0b", "前置：待确认区已建立（否则「第 2 层吃待确认」无从谈起）", s13a.pending === true && s13a.studioOpen === true, s13a);

/* ── C13.1n 🔴 反证（本轮新增 · 先做对照，再测分层）────────────────────
 * 目的：证明**在这个状态下 Esc 确实能到达 handler**。
 * 为什么非要它：C13.1 断言的是「个性化层吃掉 Esc 之后，待确认**没动**」——
 *   如果 Esc 整体失效（例如被某个 capture 监听吃掉、或焦点在输入框里被守卫拦掉），
 *   这条断言会**照样绿**，但它绿的原因完全不同（"没动"≠"被正确挡住"）。
 *   所以必须在**同一状态、紧接着**先跑一次正对照：个性化未开时按一次 Esc，
 *   待确认**必须**被吃掉。对照绿了，C13.1 的"没动"才排除了"Esc 根本进不来"。 */
await blurAll();
await key("Escape", "Escape", { vk: 27 });
await sleep(500);
const ctrl13 = await escStack();
assert("C13.1n", "🔴 正对照：个性化未开时，按 1 次 Esc 待确认**必须**被吃掉（否则 C13.1 的「没动」不可信）",
	ctrl13.pending === false && ctrl13.studioOpen === true, ctrl13);

// 重造前提：待确认 + 个性化打开（4 层栈就位）
const s13a2 = await makePending();
const s13b = await (async () => {
	await clickTestId("ds-personalize");
	await sleep(460);
	return await escStack();
})();
assert("C13.0c", "前置：待确认 + 个性化面板均已就位（4 层 Esc 栈齐）",
	s13a2.pending === true && s13b.personalize === true && s13b.pzBtn === "1" && s13b.pending === true,
	{ afterPending: s13a2, afterPersonalize: s13b });

await blurAll();
await key("Escape", "Escape", { vk: 27 });
await sleep(540);
const L1 = await escStack();
assert("C13.1", "第 1 层 Esc：只关个性化面板；工作室 / 待确认 / 选中**都没动**（旧版把这一层漏成了假红）",
	L1.personalize === false && L1.pzBtn === "0" && L1.studioOpen === true && L1.pending === true && L1.selected === true,
	{ before: s13b, after: L1 });

await blurAll();
await key("Escape", "Escape", { vk: 27 });
await sleep(520);
const L2 = await escStack();
assert("C13.2", "第 2 层 Esc：吃掉待确认；工作室仍在、选中仍在", L2.studioOpen === true && L2.pending === false && L2.selected === true, L2);

await blurAll();
await key("Escape", "Escape", { vk: 27 });
await sleep(480);
const L3 = await escStack();
assert("C13.3", "第 3 层 Esc：清选中；工作室**仍活着**（「不清空就关窗」的正面证据）", L3.studioOpen === true && L3.selected === false, L3);

await blurAll();
await key("Escape", "Escape", { vk: 27 });
await sleep(700);
const L4 = await escStack();
assert("C13.4", "第 4 层 Esc：**才**关工作室", L4.studioOpen === false, L4);

/* C13.5 🔴 反证：证明"逐层退"不是一跳关掉（否则 C13.1–C13.3 可以是平凡真）。
 * 办法：重开后连按 3 次 Esc，工作室**必须还开着**；第 4 次才关。
 * 上面 L2/L3 已经含了这一点，这里再补一条独立的、与具体层数无关的形态断言。 */
assert("C13.5", "🔴 反证：工作室不是「一跳关掉」 —— 第 2、3 次 Esc 后它都还活着",
	L2.studioOpen === true && L3.studioOpen === true && L4.studioOpen === false,
	{ esc2: L2.studioOpen, esc3: L3.studioOpen, esc4: L4.studioOpen });

/* ══ C14 顶栏（用户报「最上面这一列功能未实现」）══ */
console.log("\n【C14】顶栏功能：保存 / 版本 / 重命名 / 复制 / 删除 / 导出");

/* C13 的第三层 Esc 把工作室关掉了 —— 顶栏功能必须在开态下测，先开回来。
 * 走**用户真实路径**（点右下角浮动按钮里的「设计图」），而不是直接调 store：
 * 这样 C14 整组的前提也就顺带验证了"入口按钮好用"这件事。
 * ⚠️ 本条最初写成 `window.__dshLayout.setDesignStudio(true)`，但真机上 __dshLayout
 *    并未挂在 window 上 ⇒ 那句话静默什么都没做 ⇒ C14/C15 共 17 项连带全红。
 *    教训：测试里**不要用内部 store 抄近路**去建立前置条件 —— 抄近路失败时是静默的。 */
const reopenPath = await js(`(function(){
	if (document.querySelector('[data-testid=ds-root]')) return "already-open";
	var b = document.getElementById('dsh-design-studio-launcher');
	if (!b) return "no-launcher";
	var r = b.getBoundingClientRect();
	if (r.width < 1 || r.height < 1) return "launcher-zero-size";
	return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
})()`);
/* 🔴 必须走**真实鼠标**（2026-09-14 修正）。
 *   旧写法是 `b.click()` —— 程序化派发：不看 z-index、不看遮挡、
 *   祖先 `pointer-events:none` 也照样派发（`cdp-mouse.mjs` 文件头已把这条列为「假点击」）。
 *   而浮动按钮组正好是 `containerPointerEvents:"none"` + `pillPointerEvents:"auto"` 的结构，
 *   `.click()` 的成败与"用户点得到吗"**根本不是一回事**：它绿，不代表真人能点开。
 *   改用与 C1.1 一致的 `clickAt(rect.cx, rect.cy)` —— 同一个入口按钮，两条断言同一种点法。
 * 🔴 并且把固定 `sleep(1100)` 换成**带截止期的轮询**：工作室挂载是异步的，
 *   固定等待在机器变慢时就是假失败（"点了没反应"），而真因只是还没挂完。
 *   轮询窗口 4000ms、步长 150ms —— 与 C16.7 的 ARM_DEADLINE_MS 同一套写法。 */
let reopened = false;
if (reopenPath && typeof reopenPath === "object") {
	await clickAt(reopenPath.cx, reopenPath.cy);
	const reopenT0 = Date.now();
	while (Date.now() - reopenT0 < 4000) {
		await sleep(150);
		if (await js(`Boolean(document.querySelector('[data-testid=ds-root]'))`)) { reopened = true; break; }
	}
}
assert("C14.0", "点浮动按钮重新打开工作室（C13 收尾时已关闭）", reopened === true,
	{ reopenPath, reopened, 轮询截止ms: 4000 });

/* ── C14 前置（**可重复性**）：把设计图数据重置为「一张干净的标准框架图」 ──
 * 为什么必须做：C16 会**真实点击**「保存 / 新建图 / 复制 / 重载框架」——
 * 这些恰恰是必须测的高危操作（它们才是会改变布局的），
 * 于是每跑一次 e2e 就会留下新版本与新图。
 * 不重置的话，下一次运行 C14 的「列出 1 个版本」「元素数恢复 20」会因累积状态**假失败**
 * ——实测：第三次运行时 docCount 已累积到 9，C14.3 / C14.5 / C14.5b 三项转红。
 * 测试必须能**重复运行**，否则"全绿"只说明第一次碰巧成立。
 * 🔴 只用数据层做**清理**；建图仍走用户路径点「＋ 新建图」
 *    —— “用内部 store 抄近路建立前置条件”是明确禁止的（抄近路失败时是静默的）。 */
const resetOk = await js("!!(window.__dshDesign && window.__dshDesign.resetDesignStore) && window.__dshDesign.resetDesignStore()");
await sleep(700);
const newDocHit = await clickTestId("ds-new");
await sleep(850);
const fresh = await js(`(function(){
	var sel = document.querySelector('[data-testid=ds-doclist]');
	var st = document.querySelector('[data-testid=ds-stats]');
	return {
		docs: sel ? sel.options.length : null,
		els: st ? st.textContent : null,
		save: (document.querySelector('[data-testid=ds-save]') || {}).textContent,
		ver: (document.querySelector('[data-testid=ds-ver-toggle]') || {}).textContent
	};
})()`);
assert("C14.0b", "前置：重置为**单张**干净标准框架图（每跑一次都从同一状态开始，测试这才可重复）",
	resetOk === true && !!newDocHit.ok && !!fresh && fresh.docs === 1 && fresh.ver === "版本 0",
	{ resetOk, newDocPath: newDocHit.ok ? "clicked" : newDocHit.why, fresh });

const readTop = () => js(`(function(){
	var s = document.querySelector('[data-testid=ds-save]');
	var v = document.querySelector('[data-testid=ds-ver-toggle]');
	var sel = document.querySelector('[data-testid=ds-doclist]');
	return {
		save: s ? s.textContent : null,
		ver: v ? v.textContent : null,
		docs: document.querySelectorAll('[data-testid=ds-doclist] option').length,
		options: sel ? Array.prototype.map.call(sel.options, function(o){ return o.textContent; }) : [],
		els: document.querySelectorAll('[data-testid=ds-el]').length
	};
})()`);

// 干净起点：新建一张图（标准框架 20 元素、无版本）
await clickTestId("ds-new");
await sleep(800);
const top0 = await readTop();
assert("C14.1", "顶栏「保存」按钮存在（原先整条顶栏没有保存入口）", !!top0.save, top0.save);
assert("C14.1b", "新建图未保存 ⇒ 按钮为「● 保存」（脏态）", /保存/.test(top0.save || "") && !/已保存/.test(top0.save || ""), top0.save);
assert("C14.1c", "版本角标为「版本 0」", /版本\s*0/.test(top0.ver || ""), top0.ver);

await clickTestId("ds-save");
await sleep(700);
const top1 = await readTop();
assert("C14.2", "点保存 ⇒ 按钮变为「✓ 已保存 v1」", /已保存\s*v1/.test(top1.save || ""), top1.save);
assert("C14.2b", "版本角标 +1 ⇒「版本 1」", /版本\s*1/.test(top1.ver || ""), top1.ver);

await clickTestId("ds-ver-toggle");
await sleep(600);
const panel = await js(`(function(){
	var p = document.querySelector('[data-testid=ds-ver-panel]');
	return { open: !!p, rows: document.querySelectorAll('[data-testid=ds-ver-row]').length,
	         count: (document.querySelector('[data-testid=ds-ver-count]')||{}).textContent || null };
})()`);
assert("C14.3", "点「版本 N」拉起版本历史面板且列出 1 个版本", !!(panel.open && panel.rows === 1), panel);

// 改内容 ⇒ 应变脏
await clickTestId("ds-add-button");
await sleep(600);
const top2 = await readTop();
assert("C14.4", "改动后按钮回到「● 保存」（元素 20 → 21）",
	/保存/.test(top2.save || "") && !/已保存/.test(top2.save || "") && top2.els === 21, { save: top2.save, els: top2.els });

// 回滚（面板此刻仍开着）
/* 🔴 T-PLUG-037 加固（2026-09-16 本轮 · 台账方向：补点击前几何/命中取证 + 一次有界重试，再断言）
 *   背景：回滚三连（C14.5 / 5b / 5c）曾**偶发红**（1 红 1 绿）。产品侧已由独立正控
 *   scripts/_probe-studio-restore.mjs 走用户路径证伪（21 → 20 · 文案「✓ 已保存 v1」· 面板自动收起 三条全中），
 *   闸门自身 45/45 点击落点也都在目标子树内 ⇒ 归因为**闸门侧**的时序/起点问题，按台账方向加固三点：
 *   ① 点击前取证：把命中自检（okSelf / 落点 / 几何）写进三条断言读数 —— "打偏"从此显式可核对；
 *   ② 有界轮询替代固定 sleep(800)：收敛判据 = els=20 且「已保存 v1」且面板已收（一起等），
 *      窗口 3000ms / 步长 150ms（固定等待在机器变慢时就是假红）；
 *   ③ 一次有界重试：仅当"命中确认过（hitSelf）+ 按钮仍在 + 尺寸>0"却未收敛时才补点一次，
 *      且把 retried 写进读数 —— 重试发生过这件事本身必须可见（防"重试到绿"）。 */
const readRestoreState = () => js("(function(){ var r = document.querySelector('[data-testid=ds-ver-restore]'); var s = document.querySelector('[data-testid=ds-save]'); var rect = null, hitSelf = false; if (r) { var b = r.getBoundingClientRect(); rect = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; if (b.width >= 1 && b.height >= 1) { var t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); hitSelf = !!t && (t === r || r.contains(t)); } } return { hasBtn: !!r, rect: rect, hitSelf: hitSelf, save: s ? s.textContent : null, els: document.querySelectorAll('[data-testid=ds-el]').length, panel: !!document.querySelector('[data-testid=ds-ver-panel]') }; })()");
const coreRestored = (st) => !!(st && st.els === 20 && /已保存\s*v1/.test(st.save || ""));
const fullRestored = (st) => !!(coreRestored(st) && st.panel === false);
const preRestore = await readRestoreState();
const restoreHit = await clickTestId("ds-ver-restore");
let top3 = await readRestoreState();
let restoreRetried = false;
for (let t = 0; t < 3000 && !fullRestored(top3); t += 150) { await sleep(150); top3 = await readRestoreState(); }
if (!coreRestored(top3) && preRestore.hitSelf && top3.hasBtn && top3.rect && top3.rect.w >= 1 && top3.rect.h >= 1) {
	restoreRetried = true; // 一次有界重试（事实写进断言读数，不许静默）
	await clickTestId("ds-ver-restore");
	for (let t = 0; t < 2500 && !fullRestored(top3); t += 150) { await sleep(150); top3 = await readRestoreState(); }
}
assert("C14.5", "回滚到 v1 ⇒ 元素数恢复 20", top3.els === 20, { before: top2.els, after: top3.els, retried: restoreRetried, preHit: preRestore.hitSelf, clickOkSelf: !!(restoreHit && restoreHit.hit && restoreHit.hit.okSelf), preRect: preRestore.rect });
/* 🔴 这条守的是离线测试 C5 抓到的那类缺陷在真机上的表现：
 *    回滚会先把当前内容自动存档 ⇒ 若用"等于最后一版"判脏，界面会显示"有未保存改动"，
 *    用户以为回滚没生效。此处从**真机 DOM 文案**验证提示是正确的。 */
assert("C14.5b", "回滚后按钮显示「✓ 已保存 v1」而非「● 保存」（提示不骗人）",
	/已保存\s*v1/.test(top3.save || ""), { save: top3.save, retried: restoreRetried });
assert("C14.5c", "版本面板回滚后自动收起（避免看着旧列表以为没回）",
	top3.panel === false, { panel: top3.panel, retried: restoreRetried });

// 重命名（✎ → 输入 → 失焦提交）
await clickTestId("ds-rename");
await sleep(400);
const typedName = await js(`(function(){
	var el = document.querySelector('[data-testid=ds-docname]');
	if (!el) return "no-input";
	var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
	s.call(el, 'C14 改名验证');
	el.dispatchEvent(new Event('input', { bubbles: true }));
	return "ok";
})()`);
await sleep(300);
await blurAll();
await sleep(700);
const top4 = await readTop();
assert("C14.6", "重命名生效（文档选择器出现新名）",
	typedName === "ok" && top4.options.some((o) => /C14 改名验证/.test(o)), { typedName, options: top4.options });

// 复制图
await clickTopAction("ds-dup-doc");
await sleep(800);
const top5 = await readTop();
assert("C14.7", "复制图 ⇒ 文档数 +1 且新图名带「副本」",
	top5.docs === top4.docs + 1 && top5.options.some((o) => /副本/.test(o)), { before: top4.docs, after: top5.docs, options: top5.options });

// 删除图：**二次点击确认**（不可逆操作不上膛即删）
// 🔴 两次点击必须落在产品的 2.5s 防误删上膛窗口内：原写法两击之间插 sleep500 + readTop，
// 叠加 clickTestId 自身的 CDP 往返，实测两击间隔可达 5.6s > 2.5s ⇒ 第二击时已自动泄压、
// 重新走了上膛分支（假失败，非产品缺陷）。故两击之间只做最轻量读取、sleep 压到 150ms。
await clickTestId("ds-del-doc");
await sleep(150);
const afterArmDocs = await js(`document.querySelectorAll('[data-testid=ds-doclist] option').length`);
/* 🔴 必须判空再读属性。旧写法是 `document.querySelector('[data-testid=ds-del-doc]').getAttribute(...)`
 *    —— **裸解引用**：一旦此刻删图按钮不在 DOM（工作室被 Esc 关掉、或上膛态把它换走了），
 *    这一句抛 `Cannot read properties of null`，而 `js()` 的异常会**打断整个脚本**：
 *    其后 H/I/J 各段 100+ 条断言**全部丢失且无人知晓**（汇总里看不出少了什么）。
 *    同一形状的坑本仓库已第三次踩到（AGENTS.md 台账（二）第 1 条）。
 *    修法不是加 `?.` 让它静默变 null，而是 **判空 + 把"按钮不在"变成一条显式前置断言** ——
 *    这样"没测到"会以红的形式出现，而不是以"脚本少了半截"的形式消失。 */
const afterArmFlag = await js(`(function(){
	var b = document.querySelector('[data-testid=ds-del-doc]');
	return b ? b.getAttribute('data-armed') : null;
})()`);
assert("C14.8p", "前置：上膛瞬间删图按钮仍在 DOM（旧写法在此裸解引用，会把其后 100+ 条断言静默吞掉）",
	afterArmFlag !== null, { afterArmFlag, docs: afterArmDocs });
await clickTestId("ds-del-doc");
await sleep(800);
const afterDel = await readTop();
assert("C14.8", "🔴 删图需二次点击：首次只上膛（data-armed=1），图仍在",
	afterArmFlag === "1" && afterArmDocs === top5.docs, { armed: afterArmFlag, docs: afterArmDocs, was: top5.docs });
assert("C14.8b", "第二次点击才真删 ⇒ 文档数 -1", afterDel.docs === top5.docs - 1, { before: top5.docs, after: afterDel.docs });

// 导出（剪贴板在无头环境可能不可用 —— 只断言"有入口且给出反馈，不静默"）
// V17 P2-2：窄窗口下 ds-export 收入「更多」菜单（菜单关闭时不在 DOM）⇒ 先展开菜单
const expClicked = await js(`(function(){
		var b = document.querySelector('[data-testid=ds-export]');
		if (!b) { var m = document.querySelector('[data-testid=ds-more]'); if (m) m.click(); }
		return "need-recheck";
	})()`);
if (expClicked === "need-recheck") await sleep(220);
const expClicked2 = await js(`(function(){
		var b = document.querySelector('[data-testid=ds-export]');
		if (!b) return "no-btn";
		b.click();
		return "clicked";
	})()`);
await sleep(700);
const expToast = await js(`(function(){var t=document.querySelector('[data-testid=ds-toast]');return t?t.textContent:null;})()`);
assert("C14.9", "导出有入口且点击后给出反馈（成功/失败都不静默）",
	expClicked2 === "clicked" && !!expToast, { expClicked: expClicked2, expToast });

/* ══ C15 窗口控件安全区（用户报「关闭按钮和标准软件的关闭按钮重叠了」）══ */
console.log("\n【C15】窗口控件安全区（✕ 与原生窗口按钮重叠的根治）");

const safe = await js(`(function(){
	var w = window.innerWidth;
	var wco = navigator.windowControlsOverlay;
	var overlayVisible = wco ? wco.visible : null;
	var ins = 0, src = "none", rectW = null;
	try {
		if (wco && typeof wco.getTitlebarAreaRect === "function") {
			var r = wco.getTitlebarAreaRect();
			rectW = r ? Math.round(r.width) : null;
			if (wco.visible === true && r && r.width > 0 && w > 0) { ins = Math.max(0, Math.round(w - r.width)); src = "wco"; }
			else { src = "wco-not-visible"; }
		}
	} catch (e) { src = "err"; }
	var top = document.querySelector('[data-testid=ds-top]');
	var padRight = top ? Math.round(parseFloat(getComputedStyle(top).paddingRight) || 0) : -1;
	return { w: w, inset: ins, src: src, overlayVisible: overlayVisible, rectW: rectW,
	         boundary: w - ins, padRight: padRight, topFound: !!top };
})()`);
/* 🔴 2026-09-14 修（**本条曾是假红**，务必别改回去）：
 *   原实现 `ins = Math.max(0, Math.round(w - r.width))` **不判 `wco.visible`**。
 *   覆盖层不可见时 `getTitlebarAreaRect()` 返回 `{x:0,y:0,width:0,height:44}`
 *   ⇒ `ins = w - 0 = ` **整个窗宽**（实测 1440）⇒ `boundary = 0`
 *   ⇒「✕ 在安全区内」这类断言对任何元素都**必然失败**（4 条假红同时出现）。
 *   而产品侧 `src/util/safe-area.js` 第 73 行明确写着 `if (wco.visible === false) return 0;`
 *   —— 产品是对的（此时**没有**原生窗口控件要避让，留白反而是新 bug），
 *      错的是闸门把"读不到"当成了"读到一个巨大的值"。
 *   ⇒ 现在：inset 只在 `visible === true` 时才由矩形反推；否则恒为 0。
 *      再据此分成「契约断言（任何环境都必须过）」+「测试面断言（不成立则 SKIP）」。 */
assert("C15.1", "顶栏右内边距 = 安全区 inset + 10（inset 仅在覆盖层可见时由矩形反推，否则必须是 0）",
	safe.topFound && safe.padRight === safe.inset + 10, safe);

/* 🔴 防"平凡真/平凡假"（纪律 23）：若覆盖层不可见，`boundary = w`，
 *    下面的越界断言对任何元素都恒真 —— 等于没测。
 *    故先要求"本次环境确实存在原生窗口控件覆盖层"，且 inset 落在开区间 (0, w) 内。 */
const overlayTestable = safe.overlayVisible === true && safe.inset > 0 && safe.boundary < safe.w;
if (overlayTestable) {
	assert("C15.2", "🔴 测试面：覆盖层可见且 inset ∈ (0, w) 内 —— C15.3~5 的越界断言才有判别力",
		true, safe);
} else {
	/* 测试面不成立时**不能什么都不测**：改测产品在"无覆盖层"下的正确契约 ——
	 * 「不许凭空留白」= paddingRight 必须恰好是 10（inset 0 + 10），而不是 147 之类。 */
	skip("C15.2", "🔴 测试面：覆盖层可见且 inset ∈ (0, w) 内（C15.3~5 的前提）",
		"本环境 windowControlsOverlay.visible = " + String(safe.overlayVisible)
		+ "、矩形宽 = " + String(safe.rectW)
		+ " ⇒ 当前窗口**没有**原生窗口控件覆盖层，'右侧 137px 被系统按钮独占'这一物理事实不存在，"
		+ "越界断言对任何元素都恒真。测试面由宿主的窗口状态决定，闸门无法伪造；"
		+ "复现路径：让 Harness 窗口上屏并置前后重跑本脚本。", safe);
	assert("C15.2b", "🔴 测试面不存在时的契约：顶栏**不许凭空留白** —— paddingRight 必须 = 0 + 10",
		safe.topFound && safe.inset === 0 && safe.padRight === 10, safe);
}

const runOverlapChecks = overlayTestable;
if (runOverlapChecks) {
	const closeR = await rectOf('[data-testid="ds-close"]');
	const statsR = await rectOf('[data-testid="ds-stats"]');
	assert("C15.3", "🔴 关闭按钮 ✕ 完全在安全区内（原位置被原生窗口按钮压住）",
		!!closeR && Math.round(closeR.x + closeR.w) <= safe.boundary,
		{ closeRight: closeR && Math.round(closeR.x + closeR.w), boundary: safe.boundary });
	assert("C15.4", "状态文字也未被压（ds-stats 右边界 ≤ 安全区左边界）",
		!!statsR && Math.round(statsR.x + statsR.w) <= safe.boundary,
		{ statsRight: statsR && Math.round(statsR.x + statsR.w), boundary: safe.boundary });
} else {
	skip("C15.3", "🔴 关闭按钮 ✕ 完全在安全区内（原位置被原生窗口按钮压住）",
		"覆盖层不可见 ⇒ boundary = 窗宽，「✕ 越界」不可能为真（恒真断言）", safe);
	skip("C15.4", "状态文字也未被压（ds-stats 右边界 ≤ 安全区左边界）",
		"覆盖层不可见 ⇒ boundary = 窗宽，同上恒真", safe);
}

const over = await js(`(function(){
	var w = window.innerWidth, ins = 0;
	try {
		var wco = navigator.windowControlsOverlay;
		if (wco && wco.visible === true && typeof wco.getTitlebarAreaRect === 'function') {
			var r = wco.getTitlebarAreaRect();
			if (r && r.width > 0 && w > 0) ins = Math.max(0, Math.round(w - r.width));
		}
	} catch(e) {}
	var b = w - ins, bad = [];
	document.querySelectorAll('[data-testid=ds-top] button, [data-testid=ds-top] select, [data-testid=ds-top] input').forEach(function(e){
		var r = e.getBoundingClientRect(); if (r.width < 1) return;
		if (Math.round(r.right) > b) bad.push((e.getAttribute('data-testid')||e.tagName)+"@"+Math.round(r.right));
	});
	return { ins: ins, bad: bad };
})()`);
if (runOverlapChecks) {
	assert("C15.5", "顶栏**所有**可点元素均不越界（不是只把 ✕ 挪了一下）",
		Array.isArray(over && over.bad) && over.bad.length === 0, over);
} else {
	skip("C15.5", "顶栏**所有**可点元素均不越界（不是只把 ✕ 挪了一下）",
		"覆盖层不可见 ⇒ 边界即窗宽，'越界'恒为假", over);
}

/* C15.6 🔴 正负对照（纪律 6：新判据必须能分辨，否则是平凡真）——
 *   把顶栏 paddingRight 人为改成**错误值**（= 正确值 + 37），同一个判据必须**转假**；
 *   还原后必须**回真**。这条证明 C15.1 / C15.2b 真的在测东西。
 * 🔴 反例取值必须**相对**正确值构造，不能写死 —— 第一版写死 147，结果在
 *    "覆盖层可见（inset=137 ⇒ 正确值就是 147）"的环境里，反例恰好等于正确值，
 *    判据当然不转假 ⇒ **自检自己假红**。与"断言对象必须与结论同源"是同一条纪律。 */
const ctrl = await js(`(function(){
	var top = document.querySelector('[data-testid=ds-top]');
	if (!top) return null;
	var computeIns = function(){
		var w = window.innerWidth, ins = 0;
		try {
			var wco = navigator.windowControlsOverlay;
			if (wco && wco.visible === true && typeof wco.getTitlebarAreaRect === 'function') {
				var r = wco.getTitlebarAreaRect();
				if (r && r.width > 0 && w > 0) ins = Math.max(0, Math.round(w - r.width));
			}
		} catch(e) {}
		return ins;
	};
	var judge = function(){
		var pad = Math.round(parseFloat(getComputedStyle(top).paddingRight) || 0);
		return pad === computeIns() + 10;
	};
	var before = judge();
	var correct = computeIns() + 10;
	var wrongPad = correct + 37;
	var prev = top.style.paddingRight;
	top.style.paddingRight = wrongPad + "px";
	var during = judge();
	top.style.paddingRight = prev;
	var after = judge();
	return { before: before, during: during, after: after, prev: prev, correctPad: correct, wrongPad: wrongPad };
})()`);
assert("C15.6", "🔴 正负对照：人为把 paddingRight 改成（正确值 + 37）⇒ 判据必须转假；还原 ⇒ 必须回真",
	!!ctrl && ctrl.before === true && ctrl.during === false && ctrl.after === true,
	ctrl);

/* ══════════════════════════════════════════════════════════════════
 * C16 顶栏「连续点击可用性」
 * 用户报：「上面所有按钮的交互和实现是否测试 / 目前点击都不好用」
 * ──────────────────────────────────────────────────────────────────
 * 为什么要新增这一组：C14 已经逐项验证了每个顶栏按钮"点得动、有效果"，
 * 但它对每个按钮都是**独立的**「现取坐标 → 点击 → 回读自己」。
 * 于是有个致命盲区始终没人管：**点完 A 之后，B 跑到别处去了**。
 * 而真人是连续操作的 —— 点「保存」→ 按钮文字变长 → 整条顶栏右移 27px
 * → 手指接着落到下一个按钮的原位置 ⇒ 点空 ⇒ 结论"按钮都不好用"。
 * 实测（2026-09-12 首次取证）：保存按钮 57px↔84px（差 27）、
 * 改名 <select> 146px ↔ <input> 200px（差 54）、缩放标签 "95%"↔"100%"（差 6）。
 * 故本组断言的是**位移**与**命中**，而非"按钮自己有没有反应"。
 *
 * 判据只比 `left`：
 *   - 元素自己变宽但位置没动 → 不报（那是允许的）
 *   - 邻居被推走 → left 变 → 报（这才是用户点空的原因）
 *   - 若"某元素变宽把邻居推走"，邻居一定会报 —— 单比 left 已足够，无需比 width。
 * 只统计 button/select/input（可点的）；纯文本 span（统计条等）位移无害、且它右对齐本来就向左膨胀。
 * ══════════════════════════════════════════════════════════════════ */

const topFingerprint = () => js(`(function(){
	var out = {};
	document.querySelectorAll('[data-testid=ds-top] button, [data-testid=ds-top] select, [data-testid=ds-top] input').forEach(function(e){
		var t = e.getAttribute('data-testid'); if (!t) return;
		out[t] = Math.round(e.getBoundingClientRect().left);
	});
	return out;
})()`);
const fpDiff = (a, b) => Object.keys(a).filter((k) => b[k] !== undefined && a[k] !== b[k]).map((k) => k + " " + a[k] + "→" + b[k]);

/* C16.0 前置：工作室必须在打开状态（走用户真实入口，不用内部 store 抄近路 —— 那招曾静默失败过） */
if (!(await js("!!document.querySelector('[data-testid=ds-root]')"))) {
	const lb = await rectOf("#dsh-design-studio-launcher");
	if (lb) { await clickAt(lb.cx, lb.cy); await sleep(900); }
}
assert("C16.0", "前置：工作室已打开（走用户真实入口 dsh-design-studio-launcher）",
	await js("!!document.querySelector('[data-testid=ds-root]')"));

/* C16.1 命中测试：鼠标落点上的"栈顶"必须就是目标自己。
 * 旧 e2e 用 el.click() / 单点坐标，不看遮挡 —— 元素被盖住时它照样"通过"。 */
const hitRows = await js(`(function(){
	var out = [];
	document.querySelectorAll('[data-testid=ds-top] button, [data-testid=ds-top] select').forEach(function(e){
		var r = e.getBoundingClientRect(); if (r.width < 1) return;
		var stack = document.elementsFromPoint(r.left + r.width/2, r.top + r.height/2), top = stack[0];
		if (!(top === e || e.contains(top) || top.contains(e))) {
			out.push((e.getAttribute('data-testid') || e.tagName) + " ← " + (top ? top.tagName.toLowerCase() : "null"));
		}
	});
	return out;
})()`);
assert("C16.1", "顶栏每个可点元素，鼠标落下时接收事件的必须是自己（命中测试栈位 0 · 排除被遮挡）",
	Array.isArray(hitRows) && hitRows.length === 0, hitRows);

/* C16.2 🔴 核心：逐个真实点击，断言**其他**按钮的 left 一个都不变。
 * 跳过 ds-close：点它工作室就关了，"下一个按钮点空"的场景不存在（关闭本身由 C14 覆盖）。
 *
 * 🔴 本轮修正（这是 C13/C16.11 连环红的**根因**）：循环里点到的 `ds-personalize`（⚙ 设置）
 *    与 `ds-ver-toggle`（版本）都是**开合按钮** —— 点开之后必须还原。
 *    旧版点开就不管了，后果见上面 `closeFloatLayers` 的因果链注释。
 *    故每轮末尾调用一次归零，且**循环后单独断言归零成功**（还原也要有证据）。 */
const topIds = (await js(`(function(){
	var a = [];
	document.querySelectorAll('[data-testid=ds-top] button, [data-testid=ds-top] select, [data-testid=ds-top] input').forEach(function(e){
		var t = e.getAttribute('data-testid'); if (t) a.push(t);
	});
	return a;
})()`)).filter((t) => t !== "ds-close");
const shifts = [];
const togglesMet = [];
for (const tid of topIds) {
	const before = await topFingerprint();
	const clicked = await clickTestId(tid);
	if (!clicked.ok) { shifts.push(tid + " 点不到：" + clicked.why); continue; }
	await sleep(330);
	const after = await topFingerprint();
	const d = fpDiff(before, after);
	if (d.length) shifts.push(tid + " ⇒ " + d.join(" | "));
	/* 开合按钮点开后立刻还原 —— 不这样做，后面的段与后面的**运行**都会被污染 */
	const fl = await closeFloatLayers();
	if (!floatsClean(fl)) togglesMet.push(tid + " 点开后关不回去 ⇒ " + JSON.stringify(fl));
}
assert("C16.2", "🔴 连续点击任一顶栏按钮后，其他按钮的 left **一个都不许变**（抓「按钮跑了 ⇒ 用户点空」）",
	shifts.length === 0, shifts);
assert("C16.2p", "🔴 C16.2 逐点顶栏后，开合型按钮（⚙ 设置 / 版本）点开的浮层必须**当场归零**（防跨段 / 跨运行污染）",
	togglesMet.length === 0, togglesMet.length ? togglesMet : { topIds, clicks: clickLog.length });

/* C16.3 直接证据：保存按钮两态宽度恒等（曾 57 vs 84，差 27px ⇒ 点一次保存整栏右移 27px） */
const saveW = await js(`(function(){
	var b = document.querySelector('[data-testid=ds-save]'); if (!b) return null;
	var orig = b.textContent;
	var m = function(t){ b.textContent = t; var w = Math.round(b.getBoundingClientRect().width); b.textContent = orig; return w; };
	return { now: Math.round(b.getBoundingClientRect().width), dirty: m('● 保存'), saved1: m('✓ 已保存 v1'), saved30: m('✓ 已保存 v30') };
})()`);
assert("C16.3", "保存按钮「● 保存」/「✓ 已保存 v1」/「✓ 已保存 v30」三者宽度完全一致（minWidth 锁宽）",
	!!saveW && saveW.dirty === saveW.saved1 && saveW.saved1 === saveW.saved30, saveW);

/* C16.4 改名：<select> 与替换它的 <input> 必须同宽（曾 146 vs 200，差 54px ⇒ 点改名整栏右移 54px） */
const selW = await js(`(function(){ var e = document.querySelector('[data-testid=ds-doclist]'); return e ? Math.round(e.getBoundingClientRect().width) : null; })()`);
if (selW == null) await clickTestId("ds-rename");          // 万一当前就在编辑态，先退出来
await sleep(180);
const selW2 = await js(`(function(){ var e = document.querySelector('[data-testid=ds-doclist]'); return e ? Math.round(e.getBoundingClientRect().width) : null; })()`);
await clickTestId("ds-rename"); await sleep(260);
const inpW = await js(`(function(){ var e = document.querySelector('[data-testid=ds-docname]'); return e ? Math.round(e.getBoundingClientRect().width) : null; })()`);
await clickTestId("ds-rename"); await sleep(260);          // 取消，回到 select 态
assert("C16.4", "改名时 <select> 与替换它的 <input> 同宽（select 曾被 maxWidth 自适应成 146px）",
	selW2 != null && inpW != null && selW2 === inpW, { select: selW2, input: inpW });

/* C16.5 导出必须真的能把数据交到手上（曾固定在"复制失败：剪贴板不可用"⇒ 功能等于没有） */
await clickTopAction("ds-export"); await sleep(500);
const exp = await js(`(function(){
	var t = document.querySelector('[data-testid=ds-toast]');
	return { toast: t ? t.textContent.trim() : null, panel: !!document.querySelector('[data-testid=ds-export-panel]') };
})()`);
assert("C16.5", "导出：剪贴板成功 或 展开可复制文本域（不得停在「复制失败」—— 三级降级兜底）",
	!!exp && (exp.panel || /已复制/.test(exp.toast || "")), exp);
if (exp && exp.panel) { await clickTestId("ds-export-close"); await sleep(200); }

/* C16.6/C16.7 删除：上膛必须在**按钮自身**可见（此前只有 toast 变，用户以为按钮坏了） */
await clickTestId("ds-del-doc"); await sleep(280);
const armed = await js(`(function(){ var e = document.querySelector('[data-testid=ds-del-doc]'); return e ? { armed: e.getAttribute('data-armed'), text: e.textContent.trim(), w: Math.round(e.getBoundingClientRect().width) } : null; })()`);
assert("C16.6", "点「删除」后按钮自身可见变化（data-armed=1 · 文字变「确认」）",
	!!armed && armed.armed === "1" && armed.text === "确认", armed);
const delW = await js(`(function(){ var e = document.querySelector('[data-testid=ds-del-doc]'); return e ? Math.round(e.getBoundingClientRect().width) : null; })()`);
/* 🔴 2026-09-14 修（**本条曾是假红**）：原来是 `await sleep(2700)` 死等 —— 而产品定时器是 **2500ms**，
 *    余量只有 200ms，**没有任何容忍度**。实测（真机时间线探针 .probe-disarm.mjs）：
 *    点击 → +47ms 上膛 → **+3329ms 才泄压**。多出的 ~830ms 不是产品慢，而是
 *    **隐藏窗口（document.visibilityState === "hidden"）下 Chromium 会把 setTimeout
 *    对齐到 1s 桶**（2500ms ⇒ 落在 2500~3500ms 之间）—— 环境特性，不是缺陷。
 *    ⇒ 正确判据是「**有截止期的轮询**」：在 6s 内等到泄压即为真，并报出**实际耗时**。
 *    这样仍然会抓到真缺陷（永不泄压 / 泄压超过 6s），但不把 1s 对齐误判成失败。 */
const ARM_DEADLINE_MS = 6000;
const disarmT0 = Date.now();
let disarmed = null;
while (Date.now() - disarmT0 < ARM_DEADLINE_MS) {
	await sleep(150);
	disarmed = await js(`(function(){ var e = document.querySelector('[data-testid=ds-del-doc]'); return e ? { armed: e.getAttribute('data-armed'), text: e.textContent.trim(), w: Math.round(e.getBoundingClientRect().width) } : null; })()`);
	if (disarmed && disarmed.armed === "0") break;
}
const disarmMs = Date.now() - disarmT0;
assert("C16.7", "上膛后自动泄压回「删除」（带截止期轮询；两态同宽 —— 「确认」曾因 padding 差 1px×2 推动 8 个按钮）",
	/* 🔴 负向对照就藏在条件里：必须**先证明起点是上膛的**（C16.6 的回读），
	 *    否则"读到一个 0"可能只是"本来就没上膛" —— 那 C16.7 就是空真。 */
	!!disarmed && !!armed && armed.armed === "1" && disarmed.armed === "0" && disarmed.text === "删除" && delW === disarmed.w,
	{ armed: disarmed, 起点armed: armed && armed.armed, widthArmed: delW, widthIdle: disarmed && disarmed.w, 泄压耗时ms: disarmMs, 截止期ms: ARM_DEADLINE_MS });

/* C16.8 🔴 正负对照（台账规则 F：新闸门必须校准，否则 C16.2 的"零位移"可能是平凡真）——
 * 人为把保存按钮加宽 44px，位移检测器**必须**报出来。 */
const negative = await js(`(function(){
	var fp = function(){
		var o = {};
		document.querySelectorAll('[data-testid=ds-top] button, [data-testid=ds-top] select, [data-testid=ds-top] input').forEach(function(e){
			var t = e.getAttribute('data-testid'); if (!t) return;
			o[t] = Math.round(e.getBoundingClientRect().left);
		});
		return o;
	};
	var b = document.querySelector('[data-testid=ds-save]');
	/* 🔴 判空：本条是"人为改样式做正负对照"，工作室若已关掉 ds-save 就是 null，
	 *    旧写法紧跟 b.style.minWidth ⇒ 裸解引用抛错 ⇒ **整个脚本在这一行死掉**，
	 *    其后 C16.9–C17.2（含"测试自身可信度"两条）全部丢失。
	 *    本条已经在 2026-09-14 真机 run C 上实际发生过（Error: Cannot read properties of null (reading 'style')）。
	 *    ⚠️ 注意本段在**模板字符串**内：注释里**不许出现反引号**（纪律 9）—— 这里写错一次就炸构建。 */
	if (!b) return { err: "no-save-btn（工作室未打开：本对照无从做起）" };
	var before = fp(), old = b.style.minWidth;
	b.style.minWidth = "140px";
	var after = fp();
	b.style.minWidth = old;
	var moved = Object.keys(before).filter(function(k){ return after[k] !== undefined && before[k] !== after[k]; });
	return { movedCount: moved.length, moved: moved.slice(0, 4) };
})()`);
assert("C16.8", "🔴 正负对照：人为把保存按钮加宽 44px，「其他按钮 left 不变」的检测器必须报出位移",
	!!negative && negative.movedCount > 0, negative);

/* C16.9 文字会变的按钮，宽度必须在**极值文案**下恒定。
 * 为什么 C16.2 不够：C16.2 只在"点击时"比较 left，而像「版本 1 → 版本 30」这种
 * 宽度变化**只在内容真的变长时才出现** —— 一次验证里版本号不可能涨到 30，
 * 于是这类缺陷永远测不到（本轮「版本」按钮的锁宽就差点这样漏过去：
 * 第一版 new_string 把 minWidth 写丢了，真机 computed 仍是 auto / 53.95px，
 * 而当时所有断言全绿）。
 * 办法：**临时替换文字**直接量宽度，不依赖运行中真的出现那个数字。 */
const widthProbe = await js(`(function(){
	var cases = [
		["ds-save", ["● 保存", "✓ 已保存 v1", "✓ 已保存 v30"]],
		["ds-ver-toggle", ["版本 0", "版本 30", "版本 300"]],
		["ds-zoom", ["20%", "100%", "200%"]],
		["ds-del-doc", ["删除", "确认"]],
		["ds-stats", ["元素 0 · 逻辑缺口 0", "元素 120 · 逻辑缺口 30"]]
	];
	var bad = [];
	cases.forEach(function(c){
		var e = document.querySelector('[data-testid="' + c[0] + '"]');
		if (!e) { bad.push(c[0] + " 不存在"); return; }
		var orig = e.textContent, ws = [];
		c[1].forEach(function(t){ e.textContent = t; ws.push(Math.round(e.getBoundingClientRect().width)); });
		e.textContent = orig;
		var uniq = ws.filter(function(v, i){ return ws.indexOf(v) === i; });
		if (uniq.length !== 1) bad.push(c[0] + " 宽度随文案变化 → " + c[1].map(function(t, i){ return t + "=" + ws[i]; }).join(" / "));
	});
	return bad;
})()`);
assert("C16.9", "文字会变的按钮（保存/版本/缩放/删除/统计），在极值文案下宽度必须恒定 —— 抓「内容一变长就推移邻居」",
	Array.isArray(widthProbe) && widthProbe.length === 0, widthProbe);

/* C16.10 🔴 正负对照：证明 C16.9 的"宽度测量器"**真的测得出差异**。
 * 办法：临时解除版本按钮的锁宽（≈ 修复前的状态），同一套测量法必须报出「版本 0」≠「版本 30」。 */
const widthProbeNeg = await js(`(function(){
	var e = document.querySelector('[data-testid="ds-ver-toggle"]');
	if (!e) return null;
	var orig = e.textContent, oldMin = e.style.minWidth;
	e.style.minWidth = "0px";
	var ws = [];
	["版本 0", "版本 30"].forEach(function(t){ e.textContent = t; ws.push(Math.round(e.getBoundingClientRect().width)); });
	e.textContent = orig; e.style.minWidth = oldMin;
	return { w0: ws[0], w30: ws[1], differs: ws[0] !== ws[1] };
})()`);
assert("C16.10", "🔴 正负对照：解除版本按钮锁宽后，同一测量法必须测出「版本 0」≠「版本 30」（否则 C16.9 是平凡真）",
	!!widthProbeNeg && widthProbeNeg.differs === true, widthProbeNeg);

/* C16.11 命中测试扩到**整个工作室**（用户说的是"上面所有按钮"，不只顶栏）。
 * 前置：先关掉**有意打开的浮层** —— 版本历史面板、个性化面板本就该盖住下面的工具栏，
 * 那是预期行为，不能算"按钮被遮挡"；否则就是把正确设计误判成故障。
 *
 * 🔴 本轮修正：旧版只关了版本面板，漏了**个性化面板** ⇒ 实测报 `ds-add-progress ← div`，
 *    真机取证该 `div` 的祖先链是 `div < div[pp-panel]#dsh-personalize-panel < div[ds-root]`
 *    ⇒ 覆盖者是工作室**自己的**个性化面板，而它未被归零（该面板矩形恰好只罩住这一个按钮，
 *    所以只报了一处，看着特别像"这一个按钮实现错了"）。
 *    判据也一并收紧：关完**必须断言两个浮层都不在**，不能"关一下就当它关了"。 */
const f16 = await closeFloatLayers();
assert("C16.11p", "前置：版本 / 个性化 / 导出浮层均已关闭（否则下面那条是把正确浮层误判成遮挡）",
	floatsClean(f16), f16);
const studioHit = await js(`(function(){
	var bad = [];
	document.querySelectorAll('[data-testid=ds-root] button').forEach(function(e){
		var r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
		if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;   // 滚出可视区的不算
		var stack = document.elementsFromPoint(r.left + r.width/2, r.top + r.height/2), top = stack[0];
		if (!top) return;
		if (!(top === e || e.contains(top) || top.contains(e))) {
			bad.push((e.getAttribute('data-testid') || e.textContent.trim().slice(0, 8)) + " ← " + top.tagName.toLowerCase()
				+ (top.getAttribute && top.getAttribute('data-testid') ? "[" + top.getAttribute("data-testid") + "]" : ""));
		}
	});
	return bad;
})()`);
assert("C16.11", "工作室**全部**按钮（含工具栏 18 类 + 画布 + 底栏，浮层关闭后）命中测试栈位 0",
	Array.isArray(studioHit) && studioHit.length === 0, studioHit);

/* ══ C17 测试自身的可信度（本轮新增）══ */
console.log("\n【C17】测试自身可信度：点击落点自检 + 环境复原");

/* C17.1 🔴 本脚本每次 clickTestId 的落点必须落在**目标子树内**。
 * 为什么单列一条：一次打偏的点击是**静默**的 —— 它不会报"我点错了"，
 * 而是让后面若干条断言以"产品坏了"的形态炸掉（本轮 C13+C16.11 就是这么来的：
 * 打偏点到 ⚙ 设置 ⇒ 个性化面板一直开着 ⇒ Esc 被 stopPropagation 吃掉）。
 * 这一条把"静默打偏"变成点名。 */
assert("C17.1", `本脚本全部 ${clickLog.length} 次点击，落点均在目标元素子树内（不许静默打偏）`,
	clickMisses.length === 0, clickMisses.length ? clickMisses : { clicks: clickLog.length, fails: clickFails });

/* C17.1b 「点不成」也必须点名。
 * 为什么单列：`clickTestId` 的早退分支此前不留任何痕迹 ⇒ 汇总里的"共 N 项"是**静态**的，
 *   少点了几次根本看不出来，而后续断言会以"产品坏了"的形态炸掉。
 * `元素不存在` 可能是**有意探测**（判菜单是否收起），故只随详情上报、不判分；
 * `元素尺寸为 0` 没有正当理由 —— 元素在 DOM 里却不可点，一定是布局/遮挡缺陷。 */
const zeroSize = clickFails.filter((f) => f.why === "元素尺寸为 0");
assert("C17.1b", "不存在「目标在 DOM 里但尺寸为 0」的点击（有则说明布局塌了，而不是按钮没了）",
	zeroSize.length === 0, { zeroSize, allFails: clickFails });

/* C17.2 环境复原：把本次运行开出来的浮层 / 工作室关回去。
 * 为什么必须做：本脚本**不重载页面**（连的是已运行的 Harness 实例），
 * 状态跨脚本运行保留 ⇒ 上一次跑完留下的"个性化面板开着"会污染下一次，
 * 表现为"同一条断言 r1 绿 r2 红"的假偶发。**让每次运行的起点等价**，
 * 比"重跑到绿"可靠。 */
const restored = await js(`(function(){
	var out = { pp: document.querySelectorAll('[data-testid=pp-panel]').length,
	            ver: !!document.querySelector('[data-testid=ds-ver-panel]') };
	var s = document.querySelector('[data-testid=ds-root]');
	out.studioOpen = !!s;
	return out;
})()`);
if (restored.studioOpen) { await clickTestId("ds-close"); await sleep(700); }
const f17 = await closeFloatLayers();
const restored2 = await js(`(function(){ return {
	studio: !!document.querySelector('[data-testid=ds-root]') }; })()`);
assert("C17.2", "环境复原：跑完把工作室 / 个性化面板 / 版本面板 / 导出面板都关回去（起点等价，杜绝跨运行污染）",
	restored2.studio === false && floatsClean(f17),
	{ before: restored, after: { ...f17, ...restored2 } });

/* ══ 汇总 ══ */
console.log("\n════════════════════════════════════════════════════════════");
console.log(` 结果：${pass} 通过 / ${fail} 失败 / ${skipped} 跳过 / 共 ${pass + fail + skipped} 项`);
const failed = rows.filter((r) => !r.ok && r.ok !== null);
if (failed.length) { console.log(" 未通过项："); failed.forEach((f) => console.log(`   ${f.id} ${f.name}`)); }
const skippedRows = rows.filter((r) => r.ok === null);
/* 🔴 跳过必须**逐条列出原因**（纪律 18）：只报个数等于把"没测"藏进汇总里 */
if (skippedRows.length) {
	console.log(" 跳过项（含可证伪原因 —— 测试面不成立，非产品问题）：");
	skippedRows.forEach((s) => console.log(`   ⏭️ ${s.id} ${s.name}\n       原因：${s.reason}`));
}
console.log("════════════════════════════════════════════════════════════");
reachedFinal = true;
console.log(`\nIS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}（fail=${fail}${skipped ? " / 跳过=" + skipped : ""}）`);
ws.close();
process.exit(fail === 0 ? 0 : 1);
