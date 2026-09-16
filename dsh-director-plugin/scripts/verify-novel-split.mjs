#!/usr/bin/env node
/**
 * verify-novel-split.mjs —— 第 16 批真机验收：**按维度自动分流 + 导图可见 + 清除对话消息**
 *
 * ══════════════════════════════════════════════════════════════════
 * 对应用户原话（逐条落点）
 * ──────────────────────────────────────────────────────────────────
 *  「按照一个流程跑一遍 写小说吧,调用小说技能」
 *  「然后按照世界观剧情等应该自动分到不同的对话分支 然后思维导图应该能看出来」
 *  「清除所有的对话消息」
 *
 * ──────────────────────────────────────────────────────────────────
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 段 | 编号 | 被测行为 | 期望结果 |
 *  |:--:|:-----|:---------|:---------|
 *  | A | NS-1a–d | 起点显式建立（纪律 51） | `dp-root` 在 DOM（**只认 dp-root**，不认注册句柄）；控制台行可显形；分流前读数**打印出来** |
 *  | A | NS-2a | 需求文本注入 | 写入后**逐字回读一致**（纪律 21 先证前提） |
 *  | B | NS-3a–d | 分流结果读数 | `data-made=8` / `data-failed=0` / `data-kind=novel` / `data-dims` **集合相等** A1–A8（不是计数） / `data-sent=8`（简报真送出去了） |
 *  | B | NS-4a–b | 分支树净增 | 净增 **恰为 8**；这批新行的标题含 A1–A8 之一（**不是宿主默认标题**） |
 *  | B | NS-4c | 🔴 负对照 | 净增**不等于** 1（防"只建了一个却说 8 个"）且**不等于** 9（防重复触发） |
 *  | C | NS-5a–e | 导图能看出来 | 打开导图 → `[data-split]` 非空**恰 8 个** → 这 8 个的可见文本集合 **= A1–A8 标签集合** → 每框 `data-title-origin=plugin:split` → 🔴 无标记框 `data-split` 是**空串**（防"顺手全打标"） |
 *  | D | NS-6a–c | 清除的**二次确认** | 首点进 `data-armed=1`；**超时自动撤防**回 `0`（正负对照：不能永久停在待删态） |
 *  | D | NS-6d–g | 清除的真实效果 | 二击窗口内 `armed=1` → 结果读数出现（`dp-maint-result`）→ `removed === before > 0` → `ok=1` |
 *  | D | NS-6h–l | 🔴 **正对照 + 四项"未被动"** | 插件侧消息数**必须下降**（没有这条，"什么都没做"也能过下面四条）；宿主对话项 / 层级节点 / 设计图元素 / 持久化键组**前后逐项相等** |
 *  | D | NS-6m–o | 🔴 **复位与自述**（第 4 轮加固 · 台账 T-PLUG-039） | **有界等待** `data-armed → 0`（不是"读一次"）；且 toast **自己说清**「已清除…N 条」+ **宿主侧边界**（纪律 19：降级可以，无声不行） |
 *  | E | NS-7a–c | 收尾复原 + 健康度 | 导图关闭、原生框还原、CDP 零超时（超时判 INVALID 而非 FAIL） |
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 跑这一套会发生什么（**必须先知道**）
 * ──────────────────────────────────────────────────────────────────
 *  1. 它会**真的新建 8 个宿主会话**（`sessions.create`）并向每个投一份简报。
 *     宿主公开的 `sessions` 服务**没有删除契约**（成员表已逐条核对）⇒ **这 8 条会话删不掉**。
 *     ⇒ 本套件是**验收套件**，不是可以随便连跑的回归套件；不要放进"每次改动都跑"的集合。
 *  2. 它会在 D 段**真的清空总监对话消息**（插件库内），跑完这些消息不会回来。
 *     这是本轮需求本身要求的能力；四项外部读数会证明它**没有**越界删别人的数据。
 *
 * 用法：node scripts/verify-novel-split.mjs ｜ 退出码 0 全绿 / 1 FAIL / 2 INVALID
 */
/* 🔴 端口可由 `CDP_PORT` 覆盖：重启 Harness 时端口会换（纪律 12：判"是否新实例"看端口），
 *    写死 9222 会在"起在 9228、连 9222"时静默报 INVALID，读起来像"Harness 没起来"。 */
const PORT = Number(process.env.CDP_PORT || 9222);

let targets;
try {
	targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=9222 启动。");
	console.error("  正确用法（必须后台启动，且清掉两个环境变量）：");
	console.error("    cd \"D:/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness\"");
	console.error("    env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \"./DeepSeek Harness.exe\" --remote-debugging-port=9222");
	console.error("    node scripts/verify-novel-split.mjs");
	process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
/* 🔴 页面侧未捕获异常的**唯一出口**：
 *    本轮第一次真机跑，8 条会话建出来了但读数从未出现 —— 而 `onClick` 是 async，
 *    抛错只会变成未处理的 Promise 拒绝，**界面上与"什么都没发生"完全一样**。
 *    闸门必须自己把这类异常抓住并判红（否则"产品静默抛错"会被记成 PASS）。 */
const pageErrors = [];
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.method === "Runtime.exceptionThrown") {
		const d = m.params && m.params.exceptionDetails;
		pageErrors.push(String((d && (d.exception && (d.exception.description || d.exception.value))) || (d && d.text) || "unknown").split("\n").slice(0, 3).join(" ↵ "));
	}
	if (m.method === "Runtime.consoleAPICalled" && m.params && m.params.type === "error") {
		pageErrors.push("[console.error] " + (m.params.args || []).map((a) => String(a.value !== undefined ? a.value : (a.description || ""))).join(" ").slice(0, 200));
	}
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
/* 本 Electron 环境 Input 事件的**响应**稳定延迟约 5s（事件本身立即送达）⇒ 指针事件一律 fire-and-forget，
 * 绝不 await 响应，否则一次点击要 5s、时序全塌（既有套件的同一结论）。 */
const cdpTimeouts = [];
const emit = (method, params = {}) => {
	const id = ++seq;
	ws.send(JSON.stringify({ id, method, params }));
	const timer = setTimeout(() => { cdpTimeouts.push(method + "#" + id); }, 8000);
	pending.set(id, { res: () => clearTimeout(timer), rej: () => clearTimeout(timer) });
};
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

const js = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	if (r.exceptionDetails) throw new Error("JS异常: " + r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
	return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* 注：本套件**不使用** keyboard / touch，只发 mouseMoved/Pressed/Released ⇒ 不会命中 8000ms 超时口径。 */
const MOUSE_EMIT_MS = 8000;

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : (detail !== undefined && typeof detail === "string" ? "" : "")}`);
}
function section(s) { console.log("\n" + "─".repeat(60) + "\n【" + s + "】"); }
const J = (v) => JSON.stringify(v);

async function clickAt(x, y) {
	const X = Math.round(x), Y = Math.round(y);
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: X, y: Y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: X, y: Y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(40);
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: X, y: Y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(150);
}
/** 真实鼠标点一个选择器：**落点自检**（视口内 + `elementsFromPoint` 命中自己），落空记名不入断言（打偏 ≠ 产品坏） */
const misses = [];
async function clickSel(sel, tag) {
	for (let attempt = 0; attempt < 2; attempt++) {
		const g = await js(`(function(){
		  var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
		  var r=e.getBoundingClientRect();
		  if(r.width<2||r.height<2)return {skip:'zero-box',w:Math.round(r.width),h:Math.round(r.height)};
		  var mx=Math.round(r.x+r.width/2),my=Math.round(r.y+r.height/2);
		  var inside=mx>=0&&my>=0&&mx<=innerWidth&&my<=innerHeight;
		  var st=document.elementsFromPoint(mx,my),tp=st[0]||null;
		  return {mx:mx,my:my,inside:inside,w:Math.round(r.width),h:Math.round(r.height),
		    top:tp?(tp.tagName.toLowerCase()+(tp.getAttribute&&tp.getAttribute('data-testid')?'['+tp.getAttribute('data-testid')+']':'')):null,
		    ok:inside&&!!tp&&(tp===e||e.contains(tp)||tp.contains(e))};
		})()`);
		if (!g) return { ok: false, why: "元素不存在 " + sel };
		if (g.skip) return { ok: false, why: g.skip + " " + J(g) };
		if (g.ok) { await clickAt(g.mx, g.my); return { ok: true, x: g.mx, y: g.my }; }
		if (attempt === 0) {
			await js(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(e&&e.scrollIntoView)e.scrollIntoView({block:'center',inline:'center'});})()`);
			await sleep(260);
			continue;
		}
		misses.push(tag + " 落空(" + sel + ")：视口内=" + g.inside + " 命中=" + g.top);
		return { ok: false, why: "落点未命中自己（命中 " + g.top + "）", x: g.mx, y: g.my };
	}
	return { ok: false, why: "unreachable" };
}
const exists = async (sel) => (await js(`!!document.querySelector(${JSON.stringify(sel)})`)) === true;
async function waitFor(fn, tries, gapMs, tag) {
	for (let i = 0; i < tries; i++) {
		const v = await fn();
		if (v) return v;
		await sleep(gapMs);
	}
	return null;
}

/* ── 需求文本：**含书名号**，以便顺带验"书名被带进分支名" ── */
const NOVEL_REQ = "帮我写一个小说《灵能修仙》，先搭世界观再做剧情，最后写正文并做一致性审查";
const DIM_KEYS = ["world", "power", "plot", "chars", "prose", "polish", "review", "distill"];
const DIM_LABELS = ["A1 世界观", "A2 力量体系", "A3 剧情", "A4 人物", "A5 正文", "A6 打磨", "A7 审查", "A8 蒸馏"];

console.log("═══════════════════════════════════════════════════════════");
console.log("  真机验收 · 按维度自动分流 + 导图可见 + 清除对话消息");
console.log("  ⚠️ 本套件会真的新建 8 个宿主会话（宿主无删除契约，删不掉）");
console.log("═══════════════════════════════════════════════════════════");

/* ══════════════ A · 起点显式建立（纪律 51：起点不只是"打开"，还要满足后续断言的前提） ══════════════ */
section("A 起点：把总监页真的立起来（只认 dp-root）");

/* A0：关掉可能残留的浮层（上一轮留下的设计图/导图会吃掉点击） */
for (let i = 0; i < 4; i++) {
	const anyOverlay = await js("!!document.querySelector('#dsh-mindmap,#dsh-design-studio,#dsh-director-dialog')");
	if (!anyOverlay) break;
	await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await sleep(320);
}
console.log("  · 浮层清理后残留：" + J(await js("['#dsh-mindmap','#dsh-design-studio','#dsh-director-dialog'].filter(s=>document.querySelector(s))")));

/* A1：确保宿主有会话（重启后停在欢迎页 ⇒ 没有 tab 环 ⇒ 后面全是级联假红） */
let tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(e=>String(e.textContent).trim())")) || [];
if (!tabRing.length) {
	console.log("  · 无 tab 环（欢迎页）⇒ 真实点一个侧栏会话把会话视图打开");
	let items = (await js("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map((e,i)=>({i,t:String(e.textContent||'').trim().slice(0,26),ex:e.getAttribute('aria-expanded')}))")) || [];
	if (!items.some((x) => /分钟|小时|天|刚刚|秒/.test(x.t))) {
		const rootIdx = items.findIndex((x) => x.ex === "false");
		if (rootIdx >= 0) {
			await clickSel(`[role="treeitem"]:nth-of-type(1)`, "侧栏工作区根");
			await sleep(1200);
			items = (await js("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map((e,i)=>({i,t:String(e.textContent||'').trim().slice(0,26),ex:e.getAttribute('aria-expanded')}))")) || [];
		}
	}
	const cands = items.filter((x) => /分钟|小时|天|刚刚|秒/.test(x.t));
	console.log("  · 侧栏 " + items.length + " 项，像会话的 " + cands.length + " 个：" + J(cands.map((c) => c.t)));
	for (const c of cands.slice(0, 4)) {
		const r = await js(`(function(){var L=document.querySelectorAll('[role="treeitem"]');var e=L[${c.i}];if(!e)return null;var b=e.getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})()`);
		if (r) { await clickAt(r.x, r.y); await sleep(1500); }
		tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(e=>String(e.textContent).trim())")) || [];
		if (tabRing.length) { console.log("  · 已打开会话：" + c.t); break; }
	}
}
t("NS-1a", "宿主 tab 环存在（会话视图已打开）", tabRing.length > 0, tabRing);

/* A2：切「总监」页签 → dp-root 必须在 DOM（纪律 30：不认注册句柄） */
const dirTab = (await js(`(function(){var L=[].slice.call(document.querySelectorAll('[role="tab"]'));var e=L.filter(function(x){return String(x.textContent||'').trim()==='总监';})[0];if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),n:L.length};})()`));
if (dirTab) { await clickAt(dirTab.x, dirTab.y); await sleep(900); }
const rootUp = await waitFor(async () => await exists('[data-testid="dp-root"]'), 8, 400);
t("NS-1b", "点「总监」页签后 dp-root 已挂载（**只认 dp-root**）", rootUp === true, { tabRing, dirTab: Boolean(dirTab) });

/* A3：控制台行必须显形（collapsed.r2 折叠时按钮不在 DOM ⇒ 后面的点击会"找不到元素"） */
async function ensureConsoleVisible() {
	for (let i = 0; i < 3; i++) {
		const vis = await js(`(function(){var e=document.querySelector('[data-testid="dp-act-split"]');if(!e)return false;var r=e.getBoundingClientRect();return r.width>2&&r.height>2;})()`);
		if (vis) return true;
		const tg = await clickSel('[data-testid="dp-r2-toggle"]', "R2 折叠头");
		console.log("  · 控制台行不可见 ⇒ 点折叠头（" + (tg.ok ? "命中" : tg.why) + "）");
		await sleep(420);
	}
	return false;
}
const consoleOk = await ensureConsoleVisible();
t("NS-1c", "控制台行可见（`dp-act-split` 有非零盒）", consoleOk === true, consoleOk);

/* A4：起点读数（**打印出来**——模糊的"起点"是纪律 51 的常客） */
const before = await js(`({
  rows: (function(){ try{ var s=window.__dshBranchTree.getBranchSnapshot(); return s&&s.tree? s.tree.rows.length : null; }catch(e){ return null; } })(),
  made: (function(){ var e=document.querySelector('[data-testid="dp-flow-split"]'); return e? e.getAttribute('data-made') : null; })(),
  composer: (function(){ try{ return window.__dshChatBridge.readComposerText(); }catch(e){ return '__err:'+e.message; } })(),
  hostSend: (typeof window.__directChatSubmit === 'function'),
  hostConversation: (function(){ try{ var r=window.__dshChatBridge.readConversationItems(40); return r.ok? r.total : '__fail:'+r.reason; }catch(e){ return '__err:'+e.message; } })()
})`);
console.log("  起点读数：" + J(before));
t("NS-1d", "起点可读（分支树行数拿到真实值，不是 null）", typeof before.rows === "number", before);
t("NS-1e", "宿主直投口在场（`__directChatSubmit`）—— 简报能否真送达的前提", before.hostSend === true, before.hostSend);

/* A5：需求文本注入 + **回读**（纪律 21：先证前提再断结果） */
const inject = await js(`(async function(){
  var b=window.__dshChatBridge;
  if(b && typeof b.setComposerText==='function'){
    var r=b.setComposerText(${JSON.stringify(NOVEL_REQ)});
    if(r && r.ok){ var back=b.readComposerText(); return {via:'composer', ok:back===${JSON.stringify(NOVEL_REQ)}, back:String(back||'').slice(0,40)}; }
  }
  /* 兜底路径：原生框不可见时，功能支持"用本节点总监消息最后一条" —— 这里同样显式种一条。 */
  try{
    var node=(window.__dshHierarchy && window.__dshHierarchy.GLOBAL_NODE_ID)||'__global__';
    await window.__dshPluginDb.appendDirectorMessage(node,{role:'user',text:${JSON.stringify(NOVEL_REQ)}});
    return {via:'director-message', ok:true, back:'(已种入总监消息)'};
  }catch(e){ return {via:'none', ok:false, back:'__err:'+e.message}; }
})()`);
t("NS-2a", "需求文本已注入且**逐字回读一致**（前提成立才继续）", inject && inject.ok === true, inject);
console.log("  · 注入通道：" + (inject && inject.via) + " ｜ 回读：" + J(inject && inject.back));

/* ══════════════ B · 按维度分流 ══════════════ */
section("B 分流：一条需求 → 各维度一条独立分支");
const splitClick = await clickSel('[data-testid="dp-act-split"]', "🌿 分流");
t("NS-3a", "真实鼠标点到「🌿 分流」（落点命中自己）", splitClick.ok === true, splitClick);

/* 有界等待：`dp-flow-split` 出现且**已出结果**（成功 `made>=8` 或失败带 `data-error`）
 * 🔴 轮询条件必须是两路的：只等 `made>=8` 时，**一旦产品抛错就永远等不到**，
 *    闸门只会报"读数没出现"，而真因（异常文本）被丢掉。
 * 🔴 同时不接受"上一轮留下的读数"：本轮起点是刚重启的页面（`splitInfo` 为 null），
 *    但重跑同页时必须靠 `made/error` 变化判别 —— 故条件是数值达标或 error 非空。 */
const readSplit = async () => await js(`(function(){var e=document.querySelector('[data-testid="dp-flow-split"]');if(!e)return null;
  return {made:+e.getAttribute('data-made'), failed:+e.getAttribute('data-failed'), sent:+e.getAttribute('data-sent'),
          dims:String(e.getAttribute('data-dims')||''), kind:String(e.getAttribute('data-kind')||''),
          error:String(e.getAttribute('data-error')||''), text:String(e.textContent||'').slice(0,40)};})()`);
const splitInfo = await waitFor(async () => {
	const v = await readSplit();
	return v && (v.made >= DIM_KEYS.length || v.error) ? v : null;
}, 60, 400);
console.log("  分流读数：" + J(splitInfo));
t("NS-3b", "读到分流结果读数（`dp-flow-split` 出现且已出结果）", splitInfo !== null, splitInfo);
t("NS-3c", "🔴 分流**没有静默失败**（`data-error` 为空 —— 失败必须有出口）",
	splitInfo !== null && !splitInfo.error, splitInfo && splitInfo.error);
t("NS-3d", "`data-made` 恰为 8（一条需求 → 八条分支）", splitInfo && splitInfo.made === 8, splitInfo && splitInfo.made);
t("NS-3e", "`data-failed` 为 0（没有「建了一半」）", splitInfo && splitInfo.failed === 0, splitInfo && splitInfo.failed);
t("NS-3f", "`data-kind` = novel（走的是**小说技能 A1–A8 分工**，不是通用三段）", splitInfo && splitInfo.kind === "novel", splitInfo && splitInfo.kind);
/* 🔴 集合相等，不是计数相等 —— 计数 8 也可能是 8 个 plan/build/verify 加 5 个空的 */
const gotDims = (splitInfo && splitInfo.dims ? splitInfo.dims.split(",").filter(Boolean) : []).sort();
t("NS-3g", "`data-dims` **集合相等** 于 A1–A8 八个维度",
	gotDims.length === 8 && gotDims.slice().sort().join("|") === DIM_KEYS.slice().sort().join("|"),
	{ got: gotDims, want: DIM_KEYS });
t("NS-3h", "`data-sent` = 8（简报**真的投递出去**，不只是建了空会话）", splitInfo && splitInfo.sent === 8, splitInfo && splitInfo.sent);

/* ── 分支树净增 ── */
const afterRows = await (async () => {
	await js("window.__dshBranchTree.refreshBranchTree()");
	await sleep(500);
	return await js("(function(){var s=window.__dshBranchTree.getBranchSnapshot();return s&&s.tree?s.tree.rows.length:null;})()");
})();
const delta = (typeof before.rows === "number" && typeof afterRows === "number") ? afterRows - before.rows : null;
console.log("  分支树：前 " + before.rows + " 行 → 后 " + afterRows + " 行（净增 " + delta + "）");
t("NS-4a", "分支树净增**恰为 8**", delta === 8, { before: before.rows, after: afterRows, delta });
t("NS-4b", "🔴 负对照：净增不是 1（防「只建了一个却说八个」）", delta !== 1, delta);
t("NS-4c", "🔴 负对照：净增不是 16/9（防重复触发或一次建两批）", delta !== 16 && delta !== 9, delta);

/* 新行的标题必须带维度名（走插件侧标签覆盖，不是宿主默认标题） */
const newTitles = await js(`(function(){
  var s=window.__dshBranchTree.getBranchSnapshot(); if(!s||!s.tree) return null;
  return s.tree.rows.filter(function(r){ return r.titleOrigin==='plugin:split'; })
    .map(function(r){ return {t:String(r.title||''), dim:String(r.splitDim||'')}; });
})()`);
console.log("  带分流标记的行：" + J(newTitles));
/* 诊断（只在异常时才有信息量，但**永远打印**）：索引到底写进去没有 */
if (!Array.isArray(newTitles) || newTitles.length !== 8) {
	const diag = await js(`(function(){
	  var raw=null; try{ raw=localStorage.getItem('dsh.director.split'); }catch(e){ raw='__err'; }
	  var d=null; try{ d=window.__dshBranchTree.getBranchSnapshot().diag; }catch(e){ d='__err:'+e.message; }
	  return {indexRaw: raw===null?'(null)':String(raw).slice(0,160), diag:d};
	})()`);
	console.log("  🔎 诊断：分流索引 = " + J(diag.indexRaw));
	console.log("  🔎 诊断：血缘 diag = " + J(diag.diag));
}
t("NS-4d", "分支树里带 `titleOrigin=plugin:split` 的行**恰 8 行**", Array.isArray(newTitles) && newTitles.length === 8, newTitles && newTitles.length);
t("NS-4e", "这 8 行标题**逐条含对应维度标签**（A1–A8 各一次，不是宿主默认标题）",
	Array.isArray(newTitles) && DIM_LABELS.every((lb, i) => newTitles.some((r) => r.dim === DIM_KEYS[i] && r.t.indexOf(lb) >= 0)),
	newTitles);
t("NS-4f", "分支名带出书名《灵能修仙》（需求里的书名被带进分支名）",
	Array.isArray(newTitles) && newTitles.every((r) => r.t.indexOf("《灵能修仙》") >= 0), newTitles);

/* ══════════════ C · 思维导图能看出来（用户原话） ══════════════ */
section("C 导图：这 8 条分支要**看得出来**");

/* 归零前置：先确认导图没开着（避免"点入口=关"） */
if (await exists("#dsh-mindmap")) { await clickSel('[data-testid="mm-close"]', "导图关闭"); await sleep(500); }
const openMm = await clickSel('[data-testid="d-open-mindmap"]', "浮动组·思维导图入口");
await sleep(800);
const mmUp = await waitFor(async () => await exists('[data-testid="mm-root"]'), 10, 400);
t("NS-5a", "导图层已打开（`mm-root` 挂载）", mmUp === true, { openMm, mmUp });

const mmNodes = await js(`(function(){
  var all=[].slice.call(document.querySelectorAll('[data-testid="mm-node"]'));
  return all.map(function(e){ return {sid:String(e.getAttribute('data-session-id')||''),
    split:String(e.getAttribute('data-split')||''), origin:String(e.getAttribute('data-title-origin')||''),
    text:String(e.textContent||'')}; });
})()`);
const marked = Array.isArray(mmNodes) ? mmNodes.filter((n) => n.split) : [];
console.log("  导图节点 " + (mmNodes ? mmNodes.length : 0) + " 个，其中带 data-split 的 " + marked.length + " 个：" + J(marked.map((m) => m.split)));
t("NS-5b", "导图节点总数 > 0（导图不是空树）", Array.isArray(mmNodes) && mmNodes.length > 0, mmNodes && mmNodes.length);
t("NS-5c", "🔴 `[data-split]` 非空的节点**恰 8 个**", marked.length === 8, marked.length);
t("NS-5d", "这 8 个节点的维度 key **集合相等** 于 A1–A8",
	marked.length === 8 && marked.map((m) => m.split).slice().sort().join("|") === DIM_KEYS.slice().sort().join("|"),
	marked.map((m) => m.split));
/* 关键一条：**看得见** —— 节点文本里必须真的出现维度标签（用户说的是"看得出来"） */
t("NS-5e", "🔴 这 8 个节点的可见文本里**逐条出现**对应维度标签（A1 世界观 … A8 蒸馏）",
	DIM_LABELS.every((lb, i) => marked.some((m) => m.split === DIM_KEYS[i] && m.text.indexOf(lb) >= 0)),
	marked.map((m) => [m.split, m.text.slice(0, 26)]));
t("NS-5f", "每个被覆盖的框都带 `data-title-origin=plugin:split`（覆盖来源可追）",
	marked.length > 0 && marked.every((m) => m.origin === "plugin:split"), marked.map((m) => m.origin));
/* 🔴 负对照：不许"顺手给所有节点都打标" */
const unmarked = Array.isArray(mmNodes) ? mmNodes.filter((n) => !n.split) : [];
t("NS-5g", "🔴 负对照：非分流节点的 `data-split` 是**空串**（不是「全都打标」）",
	unmarked.length === 0 || unmarked.every((n) => n.split === ""), unmarked.map((n) => n.split).slice(0, 5));

/* 收尾：关掉导图（开合型控件必须当场还原） */
await clickSel('[data-testid="mm-close"]', "导图关闭");
await sleep(600);
t("NS-5h", "导图层已关闭（开合型控件当场还原）", (await exists("#dsh-mindmap")) === false, null);

/* ══════════════ D · 清除对话消息 ══════════════ */
section("D 清除对话消息：二次确认 + 只清自己 + 不越界");

const externalReadouts = async () => await js(`({
  hostConversation: (function(){ try{ var r=window.__dshChatBridge.readConversationItems(40); return r.ok? r.total : '__fail:'+r.reason; }catch(e){ return '__err:'+e.message; } })(),
  hierarchyNodes: (function(){ try{ return window.__dshHierarchy? null : null; }catch(e){ return null; } })(),
  designEls: document.querySelectorAll('[data-testid^="ds-el-"]').length,
  persistKeys: Object.keys(localStorage).filter(function(k){ return /^(dsh\\.director|dsh_director_|dsh-v9-theme)/.test(k); }).length,
  cookieKeys: String(document.cookie||'').split(';').filter(function(s){ return /dsh_director/.test(s); }).length
})`);
const pluginMsgs = async () => await js(`(async function(){ try{ var st=await window.__dshPluginDb.pluginDbStats(); return st? st.conversations : null; }catch(e){ return '__err:'+e.message; } })()`);
const hierarchyCount = async () => await js(`(async function(){ try{ var a=await window.__dshHierarchy.listAllNodes(); return a.length; }catch(e){ return null; } })()`);

const clearBtn = await clickSel('[data-testid="dp-maint-clear"]', "🧹 清除消息");
t("NS-6a", "真实鼠标点到「🧹 清除消息」（先确保它在视口内且命中自己）", clearBtn.ok === true, clearBtn);
const armed1 = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-clear"]');return e?e.getAttribute('data-armed'):null;})()`);
t("NS-6b", "首点**只进入待确认**（`data-armed=1`），不立刻删", armed1 === "1", armed1);

/* 🔴 正负对照：自动撤防必须真的存在（否则按钮永久停在待删态，用户"以为是第一次点"就删了） */
console.log("  · 等 4.2s 观察自动撤防…");
await sleep(4200);
const armed2 = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-clear"]');return e?e.getAttribute('data-armed'):null;})()`);
t("NS-6c", "🔴 超时**自动撤防**：4.2s 后 `data-armed` 回到 0", armed2 === "0", armed2);

/* 四项外部读数（在"真删"之前取一次） */
const extBefore = await externalReadouts();
const hierBefore = await hierarchyCount();
const msgBefore = await pluginMsgs();
console.log("  清除前：外部读数 " + J(extBefore) + " ｜ 层级节点 " + hierBefore + " ｜ 插件消息数 " + msgBefore);

/* 真删：连点两次（间隔远小于 3s 窗口） */
await clickSel('[data-testid="dp-maint-clear"]', "确认清除(第 1 点)");
await sleep(260);
const armed3 = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-clear"]');return e?e.getAttribute('data-armed'):null;})()`);
t("NS-6d", "再点前的 armed 状态为 1（确认窗口内）", armed3 === "1", armed3);
await clickSel('[data-testid="dp-maint-clear"]', "确认清除(第 2 点)");
const result = await waitFor(async () => {
	const v = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-result"]');if(!e)return null;
	  return {before:+e.getAttribute('data-before'), removed:+e.getAttribute('data-removed'), ok:e.getAttribute('data-ok'), text:String(e.textContent||'')};})()`);
	return v;
}, 40, 300);
console.log("  清除读数：" + J(result));
t("NS-6e", "清除结果读数出现（`dp-maint-result`）", result !== null, result);
t("NS-6f", "`data-removed === data-before`（**全部**删除成功，不是删了一半）",
	result && result.removed === result.before && result.before > 0, result);
t("NS-6g", "`data-ok` = 1", result && result.ok === "1", result && result.ok);

/* 🔴 正对照：插件侧消息数**必须下降** —— 没有这条，下面四条"未被动"在"什么都没做"时也会通过 */
const msgAfter = await pluginMsgs();
console.log("  插件消息数：" + msgBefore + " → " + msgAfter);
t("NS-6h", "🔴 正对照：插件侧消息数**确实下降**（证明「清空」真的发生了）",
	typeof msgBefore === "number" && typeof msgAfter === "number" && msgAfter < msgBefore,
	{ before: msgBefore, after: msgAfter });

/* 四项"未被动"：逐项相等 */
const extAfter = await externalReadouts();
const hierAfter = await hierarchyCount();
console.log("  清除后：外部读数 " + J(extAfter) + " ｜ 层级节点 " + hierAfter);
t("NS-6i", "🔴 未被动 ①：宿主对话项总数**不变**（不越界删宿主的消息）",
	extBefore.hostConversation === extAfter.hostConversation, { before: extBefore.hostConversation, after: extAfter.hostConversation });
t("NS-6j", "🔴 未被动 ②：层级节点数**不变**（没顺手 resetPluginDb）",
	hierBefore === hierAfter && typeof hierBefore === "number", { before: hierBefore, after: hierAfter });
t("NS-6k", "🔴 未被动 ③：设计图元素数**不变**",
	extBefore.designEls === extAfter.designEls, { before: extBefore.designEls, after: extAfter.designEls });
t("NS-6l", "🔴 未被动 ④：插件命名空间下的持久化键组数**不变**（含本轮新增的 `dsh.director.split`）",
	extBefore.persistKeys === extAfter.persistKeys, { before: extBefore.persistKeys, after: extAfter.persistKeys });
/* 🔴 第 4 轮加固（台账 T-PLUG-039 的真实缺口）：
 *    原版是**读一次** —— 若此刻 React 还没 flush，会把**正确行为判红**（假红）；
 *    而"读一次就过"又说不清是"真复位"还是"恰好还没进入待删态"。
 *    ⇒ 改成**有界等待 + 失败时给出实读值**，把隐性时序前提变成显式断言。
 *  📌 产品侧顺序（已核源码 `purgeMessages`）：`setClearArm(0)` **先于** `setClearInfo(...)`，
 *    而 `say()` 排在**最后** ⇒ 「结果读数出现」时 armed 必已复位，但 **toast 可能还没出现**
 *    ⇒ 两者必须**各自有界等待**，不能合并成一次读。 */
const armedAfter = await waitFor(async () => {
	const v = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-clear"]');return e?e.getAttribute('data-armed'):null;})()`);
	return v === "0" ? v : null;
}, 20, 150);
t("NS-6m", "清除后按钮已复位（`data-armed=0`，不留待删态）", armedAfter === "0", "armed=" + armedAfter);

/* toast 必须**自己说出**发生了什么（条数 + 边界）—— 否则"清了多少、清的是谁的"无从复核（纪律 18） */
const clearToast = await waitFor(async () => {
	const v = await js(`(function(){var e=document.querySelector('[data-testid="dp-toast"]');return e?String(e.textContent||''):null;})()`);
	return v && /已清除总监对话消息\s*\d+\s*条/.test(v) ? v : null;
}, 30, 150);
t("NS-6n", "🔴 清除后 toast **自己说明**「已清除总监对话消息 N 条」（不是只把按钮状态变回去）",
	!!clearToast, clearToast ? clearToast.slice(0, 100) : "（4.5s 内未出现含条数的清除提示）");
t("NS-6o", "🔴 该 toast 同时含**宿主侧边界**说明（降级/边界可以，无声不行 —— 纪律 19）",
	!!clearToast && /宿主/.test(clearToast), clearToast ? clearToast.slice(0, 100) : null);

/* ══════════════ W · 执行状态窗口：可移动 / 最小化 / 靠边缩进 ══════════════
 * 对应用户原话「执行状态的窗口需要可以移动最小化,靠边缩进」。
 * 🔴 为什么单列一段：`verify-flow` 的 F 段量的是**另一组**浮动按钮药丸（composer 旁的三颗），
 *    与本窗口（`dp-running`）**零交集** —— 全仓 `grep -l dp-running scripts/*.mjs` 只命中 `_probe-*`。
 *    ⇒ 需求 1 此前只有纯函数单测（`test-running-window.mjs` 50/50），**没有真机断言**；
 *      而"纯函数对 ≠ 界面能用"（纪律 5）。 */
section("W 执行状态窗口：拖动移动 / 最小化 / 靠边缩进");

/** 一次 evaluate 取全窗口三态 + 几何（分多次取会让"取值之间"的状态漂移污染断言） */
const winRead = async () => await js(`(function(){
  var e=document.querySelector('[data-testid="dp-running"]');
  if(!e)return null;
  var r=e.getBoundingClientRect();
  return { mode:e.getAttribute('data-mode'), dock:e.getAttribute('data-dock'), floating:e.getAttribute('data-floating'),
    x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height),
    body:!!document.querySelector('[data-testid="dp-running-body"]'),
    strip:!!document.querySelector('[data-testid="dp-running-strip"]'),
    head:!!document.querySelector('[data-testid="dp-running-head"]'),
    pe:(function(){try{return getComputedStyle(e).pointerEvents;}catch(x){return '__err';}})() };})()`);
const headBox = async () => await js(`(function(){
  var e=document.querySelector('[data-testid="dp-running-head"]');if(!e)return null;
  var r=e.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),
    inView:(r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight)});})()`);
/** 真实鼠标拖动（多步 move，步间 18ms —— 太快的单步会被 3px 抖动阈值或原生节流吞掉）
 * 🔴 `onStep` 用于**拖动过程中**采样：`winDragEnd` 一松手就可能把 expanded 改成 docked，
 *    只在松手后读 mode 会把「拖到边缘」这个正确行为读成「拖动没展开」（本闸门第一版就是这样写错的）。 */
async function dragMouse(from, to, steps, onStep) {
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(50);
	const traced = [];
	for (let i = 1; i <= steps; i++) {
		emit("Input.dispatchMouseEvent", {
			type: "mouseMoved", button: "left", buttons: 1,
			x: Math.round(from.x + (to.x - from.x) * i / steps),
			y: Math.round(from.y + (to.y - from.y) * i / steps)
		});
		await sleep(18);
		if (onStep) { const s = await onStep(i); if (s) traced.push(s); }
	}
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(300);
	return traced;
}

/* W 起点**显式建立**（纪律 51）：上一轮可能把窗口拖到别处/停在贴边态，
 * 不重置的话"默认是 collapsed"这类断言会以**上一次运行的状态**为起点 ⇒ 假红。 */
await js("(function(){try{window.__directorLayoutStore.resetRunningWin();return 1;}catch(e){return '__err:'+e.message;}})()");
await sleep(220);
const w0 = await winRead();
const vp = await js("(function(){return {vw:innerWidth,vh:innerHeight};})()");
console.log("  · 视口 " + J(vp) + " ｜ W 起点：" + J(w0));
t("NS-8a", "起点已建立：`dp-running` 在 DOM 且回到默认 `collapsed` / 未浮动",
	w0 && w0.mode === "collapsed" && w0.floating === "0", w0);
t("NS-8b", "🔴 窗口**可交互**（`pointer-events=auto`）—— 上一轮的 `pointer-events:none` 已撤除",
	w0 && w0.pe === "auto", w0 && w0.pe);
t("NS-8b2", "环境量由环境读：视口宽高是真实数（不是写死的 1440×900 — 纪律 29）",
	vp && vp.vw > 400 && vp.vh > 300 && !(vp.vw === 1440 && vp.vh === 900), vp);

/* ① 最小化 ⇄ 展开：按钮在 collapsed 态是「▣」= 展开 */
const minClick1 = await clickSel('[data-testid="dp-running-min"]', "▣ 展开");
t("NS-8c", "真实鼠标点到最小化按钮（落点命中自己）", minClick1.ok === true, minClick1);
const w1 = await waitFor(async () => { const v = await winRead(); return v && v.mode === "expanded" ? v : null; }, 20, 150);
t("NS-8d", "点一下 ⇒ `data-mode=expanded`", w1 !== null, w1 && w1.mode);
t("NS-8e", "🔴 展开态**明细区真的渲染了**（`dp-running-body` 在 DOM）—— 不是「看起来没展开」",
	w1 && w1.body === true, w1 && w1.body);

const minClick2 = await clickSel('[data-testid="dp-running-min"]', "— 最小化");
t("NS-8f", "再点一下 ⇒ `data-mode=collapsed`", minClick2.ok === true && (await waitFor(async () => { const v = await winRead(); return v && v.mode === "collapsed" ? v : null; }, 20, 150)) !== null, null);
t("NS-8g", "🔴 收起是**真的卸载**（`dp-running-body` 不在 DOM），不是视觉藏起来",
	(await winRead()).body === false, (await winRead()).body);

/* ② 拖动移动：目标落点取**视口正中**（远离四边 ⇒ 不会被吸附成贴边态，才能单独断言"移动"） */
const w0b = await winRead();
const hb1 = JSON.parse(await headBox());
t("NS-8h", "拖动前提：头部手柄在视口内（否则事件打空会伪装成「拖不动」）", hb1 && hb1.inView === true, hb1);
const aimX = Math.round(vp.vw / 2 - w0b.w / 2);
const aimY = Math.round(vp.vh / 2);
const traced = await dragMouse(
	{ x: hb1.x, y: hb1.y },
	{ x: hb1.x + (aimX - w0b.x), y: hb1.y + (aimY - w0b.y) },
	8,
	async () => await winRead()
);
const mid = traced.find((s) => s.mode === "expanded");
t("NS-8i", "🔴 拖动**过程中**就是 `expanded`（采样取自松手之前 —— 拖到哪看得见）",
	traced.length > 0 && traced.every((s) => s.mode === "expanded"), traced.map((s) => s.mode + "@" + s.x + "," + s.y));
const w2 = await winRead();
console.log("  · 拖到视口中央后：" + J(w2) + " ｜ 中途采样 " + traced.length + " 次");
t("NS-8j", "🔴 窗口真的**移动了**（位移 ≥ 40px，且朝向目标）—— 防「报 expanded 但坐标没变」",
	Math.abs(w2.x - w0b.x) >= 40, { before: [w0b.x, w0b.y], after: [w2.x, w2.y], aim: [aimX, aimY] });
t("NS-8k", "被搬动过 ⇒ `data-floating=1`（切 `fixed`，坐标是视口坐标，跨容器不漂）", w2.floating === "1", w2.floating);
t("NS-8k2", "拖到视口中央 ⇒ 四边都够远 ⇒ **不吸附**（仍是 expanded，不是 docked）", w2.mode === "expanded", w2.mode);

/* ③ 靠边缩进：拖到视口左缘 ⇒ 夹紧到 0 ⇒ 吸附成 `docked/left` */
const hb2 = JSON.parse(await headBox());
await dragMouse({ x: hb2.x, y: hb2.y }, { x: 40, y: hb2.y }, 8, null);
const w3 = await winRead();
console.log("  · 靠边后：" + J(w3));
t("NS-8l", "🔴 拖到左缘 ⇒ `data-mode=docked`（靠边缩进）", w3.mode === "docked", w3.mode);
t("NS-8m", "🔴 `data-dock=left`（贴的是左边那条边，不是「随便贴一条」）", w3.dock === "left", w3.dock);
t("NS-8n", "贴边态换成**细条**渲染（`dp-running-strip` 在 DOM）", w3.strip === true, w3.strip);
t("NS-8o", "🔴 正对照：贴边态**不渲染**明细区（`dp-running-body` 不在 DOM）—— 与 NS-8e 互为对照",
	w3.body === false, w3.body);
t("NS-8p", "贴边后**没跑出视口**（x ≥ 0）", w3.x >= 0, w3.x);

/* ④ 还原：点细条回展开 → 双击头部归位（开合型控件必须当场还原，纪律 26） */
const stripClick = await clickSel('[data-testid="dp-running-strip"]', "贴边细条");
t("NS-8q", "点细条 ⇒ 回 `expanded`（贴边缩进不是死胡同）", stripClick.ok === true && (await waitFor(async () => { const v = await winRead(); return v && v.mode === "expanded" ? v : null; }, 20, 150)) !== null, null);
const hb3 = JSON.parse(await headBox());
emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: hb3.x, y: hb3.y });
emit("Input.dispatchMouseEvent", { type: "mousePressed", x: hb3.x, y: hb3.y, button: "left", clickCount: 2, buttons: 1 });
await sleep(40);
emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: hb3.x, y: hb3.y, button: "left", clickCount: 2, buttons: 0 });
await sleep(320);
const w4 = await winRead();
console.log("  · 归位后：" + J(w4));
t("NS-8r", "🔴 双击头部归位 ⇒ 回默认位且 `collapsed` / 未浮动（环境复原）",
	w4 && w4.mode === "collapsed" && w4.floating === "0", w4);

/* ══════════════ E · 收尾与健康度 ══════════════ */
section("E 收尾：环境复原 + CDP 健康度");
await js("(function(){var b=window.__dshChatBridge;if(b&&typeof b.setComposerText==='function')b.setComposerText('');return 1;})()");
const cleaned = await js("(function(){try{return window.__dshChatBridge.readComposerText();}catch(e){return '__err';}})()");
t("NS-7a", "原生输入框已还原为空（不留测试文本）", cleaned === "" || cleaned === null, cleaned);
t("NS-7b", "浮层全部关闭（导图 / 工作室 / 弹窗）",
	(await js("['#dsh-mindmap','#dsh-design-studio','#dsh-director-dialog'].filter(s=>document.querySelector(s)).length")) === 0, null);
t("NS-7c", "总监页仍在（收尾没有把页面弄崩）", await exists('[data-testid="dp-root"]') === true, null);
t("NS-7d", "🔴 CDP 零超时（超时属 INVALID，不是产品失败 —— 纪律 24）", cdpTimeouts.length === 0, cdpTimeouts);
t("NS-7e", "点击落空记录（打偏 ≠ 产品坏，但必须为 0）", misses.length === 0, misses);
t("NS-7f", "🔴 **页面零未捕获异常**（产品不许静默抛错 —— 本轮真机第一次跑就是死在这里）",
	pageErrors.length === 0, pageErrors.slice(0, 3));

console.log("\n" + "═".repeat(59));
console.log("  真机验收：PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (cdpTimeouts.length) console.log("  ⚠️ CDP 超时 " + cdpTimeouts.length + " 次：" + J(cdpTimeouts.slice(0, 5)));
if (pageErrors.length) { console.log("  ⚠️ 页面未捕获异常 " + pageErrors.length + " 条："); pageErrors.slice(0, 5).forEach((e) => console.log("     · " + e)); }
console.log("  ℹ️ 本轮真实新建了 " + (splitInfo ? splitInfo.made : "?") + " 个宿主会话（宿主无删除契约，无法回收）");
if (failures.length) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
const invalid = cdpTimeouts.length > 0;
console.log("  IS_PASS: " + (fail === 0 && !invalid ? "TRUE" : "FALSE") + (invalid ? "（INVALID：CDP 超时）" : ""));
console.log("═".repeat(59));
ws.close();
process.exit(invalid ? 2 : (fail === 0 ? 0 : 1));
