#!/usr/bin/env node
/**
 * shot-dialog-bg.mjs —— 总监弹窗背景改造的**真机视觉验收**（截图 + 对比度实测）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有它（纪律 57「全绿 ≠ 能验收」）
 * ──────────────────────────────────────────────────────────────────
 * 离线闸门只能证明「变量写对了」，证明不了**看起来对不对**。用户的原话是
 * 「按照人眼最舒服温馨的风格调整背景和文字的颜色 同时增加自定义背景颜色的选项,
 *   可以上传图片作为背景 默认的话可以跟随软件的背景主题」——
 * 这四条里三条是**主观视觉**，必须给可看的图 + 客观读数（WCAG 对比度）。
 *
 * ── 做法 ────────────────────────────────────────────────────────────
 *   对四档背景（follow / warm / dim / custom）各做一次：
 *     ① 应用设定 → ② 打开弹窗 → ③ 截图 → ④ 回读面板底色与文字色、算对比度
 *   收尾**逐字节还原**用户的个性化设置（纪律 82：闸门不许把用户数据当耗材）。
 *
 * 用法：
 *   node scripts/shot-dialog-bg.mjs                 # 输出到 logs/dialog-bg/
 *   node scripts/shot-dialog-bg.mjs <输出目录>
 *   CDP_PORT=9222 node scripts/shot-dialog-bg.mjs
 *
 * 退出码：0 通过（四档截图齐 + 对比度全 ≥4.5） / 1 FAIL / 2 INVALID
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
/* 🔴 起点自举**只允许一份实现**（纪律 98）：本脚本不自己写"点侧栏会话行"那套，
 *   直接调 `_cdp-startup.mjs`，与 verify-novel-split / verify-director-logic 同源。 */
import { makeClicker } from "./_cdp-click-until.mjs";
import { ensureDirectorPage } from "./_cdp-startup.mjs";

const PORT = Number(process.env.CDP_PORT || 9222);
const OUT_DIR = resolve(process.argv[2] || "logs/dialog-bg");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 连接 ───────────────────────────────────────────────────────── */
/* 🔴 连不上必须报 **INVALID(2)** 而不是抛穿（纪律 99/100：执行链不许抛穿，
 *   "没跑成"与"失败"要可分）。裸跑的 `fetch failed / ECONNREFUSED` 栈里
 *   看不出"只是 Harness 没开"，会被误读成产品坏。 */
let targets;
try {
	targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
} catch (e) {
	console.error("INVALID：连不上 CDP 127.0.0.1:" + PORT + "（" + ((e && e.cause && e.cause.code) || (e && e.message) || e) + "）");
	console.error("  ⇒ Harness 没在跑（或端口变了）。启动：");
	console.error('     cd "D:/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness" && env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./DeepSeek Harness.exe" --remote-debugging-port=' + PORT);
	process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("INVALID：CDP 通了但没有页面目标（只有 devtools 目标）"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener("open", r));
const CALL_TIMEOUT = Number(process.env.CDP_TIMEOUT_MS || 15000);
function sendRaw(method, params = {}) {
	return new Promise((res, rej) => {
		const id = ++seq;
		pending.set(id, (m) => { m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); });
		ws.send(JSON.stringify({ id, method, params }));
	});
}
function send(method, params = {}) {
	return new Promise((res, rej) => {
		const h = setTimeout(() => rej(new Error("CDP 超时 " + CALL_TIMEOUT + "ms：" + method)), CALL_TIMEOUT);
		if (h.unref) h.unref();
		sendRaw(method, params).then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
	});
}
async function js(expression) {
	const out = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
	const r = out.result;
	if (r.subtype === "error") throw new Error(r.description);
	if (r.unserializableValue) return r.unserializableValue;
	return r.value;
}

/* ── 0. 前置：确认页面加载的就是**当前产物**（纪律：改完必须重启） ── */
const pre = await js("JSON.stringify({stamp:window.__dshBuildStamp||null,api:!!(window.__dshPersonalize&&window.__dshPersonalize.P_DIALOG_BG),dpRoot:!!document.querySelector(\"[data-testid='dp-root']\"),tabs:Array.from(document.querySelectorAll(\"[role='tab']\")).map(function(e){return String(e.textContent||'').trim();})})");
const P = JSON.parse(pre);
console.log("构建戳: " + P.stamp + " / 弹窗皮肤 API: " + P.api + " / dp-root: " + P.dpRoot + " / 页签: " + JSON.stringify(P.tabs));
if (!P.api) { console.error("INVALID：页面加载的产物**不含**弹窗皮肤 API ⇒ 装完没重启（先重启 Harness 再跑本脚本）"); process.exit(2); }

/* ── 0b. 起点自举（冷启动停在欢迎页 ⇒ `dp-root` 不在 DOM ⇒ 弹窗无从打开） ──
 * 纪律 24/94：**「前提缺失」≠「产品坏」**，前提问题必须报 INVALID 并说清原因，
 * 不能让它级联成一片红。 */
if (!P.dpRoot) {
	console.log("dp-root 不在 DOM ⇒ 调统一起点自举（_cdp-startup.mjs）…");
	const CL = makeClicker({ send, js, sleep });
	const boot = await ensureDirectorPage({
		CL, js, send, sleep, log: (s) => console.log(s),
		tabBudgetMs: Number(process.env.TAB_BUDGET_MS || 120000), useRealUi: true
	});
	if (!boot.ok) {
		console.error("INVALID：起点自举失败 ⇒ " + boot.reason);
		process.exit(2);
	}
	console.log("起点已立：dp-root=true · 页签环 " + JSON.stringify(boot.tabRing));
}

/* ── 1. 快照用户的个性化设置（收尾要逐字节还原） ───────────────── */
const KEY = await js("window.__dshPersonalize.PERSONALIZE_KEY");
const snap = await js("(function(){try{return localStorage.getItem(" + JSON.stringify(KEY) + ");}catch(e){return null;}})()");
console.log("已快照用户个性化设置: " + (snap === null ? "(无，说明是默认档)" : snap.length + " B"));

/* ── 2. 四档背景逐档截图 + 实测对比度 ─────────────────────────── */
mkdirSync(OUT_DIR, { recursive: true });

/* 自定义档用**中间灰**做样本：它是"明暗二分法会选反边"的经典陷阱色
 * （luma 0.17，白字对比度 4.22 < 黑字 12.0）⇒ 顺带当一次真机反证。 */
const CASES = [
	{ id: "follow", patch: { dialogBg: "follow" }, note: "跟随主题（零变量产出 ⇒ 落到宿主令牌）" },
	{ id: "warm", patch: { dialogBg: "warm" }, note: "暖白（默认档 · 用户抱怨的黑色背景已换掉）" },
	{ id: "dim", patch: { dialogBg: "dim" }, note: "暖夜（刻意不是纯黑）" },
	{ id: "custom", patch: { dialogBg: "custom", dialogBgColor: "#7a7262" }, note: "自定义中间灰（对比度择优反证）" }
];

const shotExpr = (function () {
	/* 在页内读“弹窗面板”的**真实渲染色**。用 getComputedStyle 而不是读变量：
	 * 变量只证明“写对了”，计算样式才证明“画出来了”。
	 *
	 * 🔴 两处量法纠错（2026-09-17，本脚本第一版就踩了 —— 尺子比产品更容易错）：
	 *   ① 取样点必须取**正文**：第一版取“面板内第一个有文字的叶子节点”，
	 *      结果取到标题栏那个**强调色** `#8ab4f8`（accent 本来就不保证 4.5:1，
	 *      large text 门槛是 3:1）⇒ 得出一堆"对比度不足"的**假红**。
	 *      改为**按出现次数取众数色** = 正文色。
	 *   ② 底色可能**半透明**（follow 档宿主令牌是 `rgba(...,0.4)`；有图时卡片也是半透明）
	 *      ⇒ 直接拿 alpha<1 的颜色算对比度毫无意义。改为**沿祖先链合成到第一个不透明底**。 */
	return "(() => {"
		+ " var p=document.querySelector(\"[data-testid='d-panel']\");"
		+ " if(!p) return JSON.stringify({err:'no-panel'});"
		+ " var cs=getComputedStyle(p);"
		+ " var r=p.getBoundingClientRect();"
		+ " var rgb=function(s){var m=String(s).match(/(\\d+(?:\\.\\d+)?)/g)||[];return [Number(m[0]||0),Number(m[1]||0),Number(m[2]||0),m[3]===undefined?1:Number(m[3])];};"
		+ " var over=function(fg,bg){var a=fg[3];return [Math.round(fg[0]*a+bg[0]*(1-a)),Math.round(fg[1]*a+bg[1]*(1-a)),Math.round(fg[2]*a+bg[2]*(1-a)),1];};"
		+ " /* 合成：沿祖先链把半透明底铺到第一个不透明底上 */"
		+ " var solidBg=function(el){var acc=null;var n=el;while(n&&n.nodeType===1){var c=rgb(getComputedStyle(n).backgroundColor);if(c[3]>0){acc=acc?over(acc,c):c;if(c[3]===1)break;}n=n.parentElement;}return acc||[255,255,255,1];};"
		+ " var base=solidBg(p);"
		+ " var lum=function(c){var f=function(v){v=v/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};"
		+ " var cr=function(a,b){var L1=lum(a),L2=lum(b),hi=Math.max(L1,L2),lo=Math.min(L1,L2);return Number(((hi+0.05)/(lo+0.05)).toFixed(2));};"
		+ " /* 正文色 = 面板内所有「叶子文字节点」计算色的**众数** */"
		+ " var tally={},order=[],all=p.querySelectorAll('*');"
		+ " for(var i=0;i<all.length;i++){var e=all[i];"
		+ "  if(e.children.length!==0) continue;"
		+ "  var t=String(e.textContent||'').trim(); if(t.length<2) continue;"
		+ "  var c=getComputedStyle(e).color;"
		+ "  if(!(c in tally)){tally[c]=0;order.push(c);} tally[c]++;}"
		+ " order.sort(function(a,b){return tally[b]-tally[a];});"
		+ " var main=order[0]||'rgb(0,0,0)';"
		+ " var mfg=rgb(main);"
		+ " /* 若正文本身半透明，同样合成到底色上 */"
		+ " var fgSolid=mfg[3]<1?over(mfg,base):mfg;"
		+ " var worst=1e9,worstC=null;"
		+ " for(var j=0;j<order.length;j++){ if(tally[order[j]]<2) continue; var q=rgb(order[j]); var q2=q[3]<1?over(q,base):q; var v=cr(q2,base); if(v<worst){worst=v;worstC=order[j];} }"
		+ " var bgRaw=cs.backgroundColor;"
		+ " return JSON.stringify({"
		+ "  rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],"
		+ "  bgRaw:bgRaw, bgSolid:'rgb('+base[0]+','+base[1]+','+base[2]+')',"
		+ "  fg:main, fgSolid:'rgb('+fgSolid[0]+','+fgSolid[1]+','+fgSolid[2]+')',"
		+ "  cr:cr(fgSolid,base), crWorst:worst, crWorstColor:worstC, paletteN:order.length,"
		+ "  vars:{bg:getComputedStyle(document.documentElement).getPropertyValue('--dp-dlg-bg').trim(),"
		+ "        t1:getComputedStyle(document.documentElement).getPropertyValue('--dp-dlg-t1').trim()},"
		+ "  attr:[document.documentElement.getAttribute('data-dp-dlgbg'),document.documentElement.getAttribute('data-dp-dlgimg')],"
		+ "  nodes:all.length });"
		+ " })()";
})();

/* ── 开/关弹窗：一律走**产品路径**（真实点击 `d-open-director` 药丸）────────────
 *   🔴 药丸是**开合型**（点击切换）⇒ 必须先确认当前态再点，且点完要**等状态真的翻转**。
 *      第一版直接"点一下就当开了"，结果 warm / dim 两档读到 `no-panel`
 *      —— 那不是产品坏，是**量法把"正在关闭的动画"当成了"已经关好"**。 */
const panelNow = () => js("!!document.querySelector(\"[data-testid='d-panel']\")");
const pillRect = () => js("(function(){var b=document.querySelector(\"[data-testid='d-open-director']\");if(!b)return null;var r=b.getBoundingClientRect();if(r.width<2)return null;return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()");
async function clickPill(tag) {
	const at = await pillRect();
	if (!at) throw new Error("入口药丸不可见（" + tag + "）");
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1] });
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", clickCount: 1 });
	await sleep(45);
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "left", clickCount: 1 });
}
/** 等到「面板在/不在」稳定成立；超时返回 false（**不抛**） */
async function waitPanel(want, budgetMs) {
	const t = Date.now();
	while (Date.now() - t < (budgetMs || 4000)) {
		if ((await panelNow()) === want) return true;
		await sleep(220);
	}
	return (await panelNow()) === want;
}
async function ensureOpen() {
	if (await panelNow()) return "already-open";
	for (let i = 0; i < 4; i++) {
		await clickPill("open#" + (i + 1));
		if (await waitPanel(true, 3500)) return "real-click";
	}
	/* 兜底只作**诊断通道**并留痕（纪律 96：兜底会盖住真因，必须计数） */
	await js("window.__openDlg&&window.__openDlg()");
	const ok = await waitPanel(true, 3000);
	return ok ? "internal(兜底)" : "failed";
}
async function ensureClosed() {
	if (!(await panelNow())) return "already-closed";
	for (let i = 0; i < 3; i++) {
		await clickPill("close#" + (i + 1));
		if (await waitPanel(false, 3000)) return "real-click";
	}
	await js("window.__closeDlg&&window.__closeDlg()");
	return (await waitPanel(false, 2500)) ? "internal(兜底)" : "failed";
}

const rows = [];
const problems = [];
for (const c of CASES) {
	/* 应用该档（走 store ⇒ 同时写 localStorage + :root，与用户手点完全同路径） */
	await js("(function(){var A=window.__dshPersonalize;A.store.patch(" + JSON.stringify(c.patch) + ");return true;})()");
	await sleep(300);
	const opened = await ensureOpen();
	if (opened === "internal(兜底)") problems.push(c.id + "：真实点击入口未能开窗（走了兜底 ⇒ 先查前提）");
	if (opened === "failed") { problems.push(c.id + "：弹窗打不开"); }
	await sleep(500);
	const st = JSON.parse(await js(shotExpr));
	if (st.err) problems.push(c.id + "：读不到面板（" + opened + "）");
	/* 截图：整窗 + 面板裁剪（面板裁剪更便于看配色） */
	const full = await send("Page.captureScreenshot", { format: "png" });
	const fullPath = join(OUT_DIR, "dialog-" + c.id + "-full.png");
	writeFileSync(fullPath, Buffer.from(full.data, "base64"));
	let panelPath = null;
	if (!st.err) {
		panelPath = join(OUT_DIR, "dialog-" + c.id + "-panel.png");
		await send("Page.captureScreenshot", { format: "png", clip: { x: st.rect[0], y: st.rect[1], width: st.rect[2], height: st.rect[3], scale: 1 } })
			.then((cr2) => writeFileSync(panelPath, Buffer.from(cr2.data, "base64")))
			.catch(() => { panelPath = null; });
	}
	if (st.cr !== undefined && st.cr < 4.5) problems.push(c.id + "：正文对比度 " + st.cr + " < 4.5");
	if (st.crWorst !== undefined && st.crWorst < 3) problems.push(c.id + "：最差文字色 " + st.crWorstColor + " 对比度 " + st.crWorst + " < 3");
	if (st.cr !== undefined && c.id === "follow" && st.vars && st.vars.bg !== "") {
		problems.push("follow 档本应零变量产出，实测 --dp-dlg-bg=" + st.vars.bg);
	}
	rows.push({ id: c.id, note: c.note, opened, bg: st.bgSolid, fg: st.fg, cr: st.cr, attr: st.attr, shot: fullPath });
	console.log("");
	console.log("── " + c.id + "（" + c.note + "）──");
	console.log("   开窗: " + opened + " ｜ attr=" + JSON.stringify(st.attr) + " ｜ 节点 " + st.nodes);
	console.log("   面板底色: " + st.bgRaw + " → 合成 " + st.bgSolid);
	console.log("   正文色: " + st.fg + " ｜ **对比度 " + st.cr + ":1** ｜ 最差 " + st.crWorst + ":1（" + st.crWorstColor + "）｜ 调色板 " + st.paletteN + " 色");
	console.log("   --dp-dlg-bg=" + JSON.stringify(st.vars && st.vars.bg) + " / t1=" + JSON.stringify(st.vars && st.vars.t1));
	console.log("   截图: " + fullPath + (panelPath ? "  +  " + panelPath : ""));
	await ensureClosed();
	await sleep(260);
}

/* ── 3. 逐字节还原用户设置（纪律 82） ──────────────────────────── */
const restored = await js("(function(){var K=" + JSON.stringify(KEY) + ",V=" + JSON.stringify(snap) + ";"
	+ "try{ if(V===null){localStorage.removeItem(K);} else {localStorage.setItem(K,V);} }catch(e){return 'ERR:'+e.message;}"
	+ " if(window.__dshPersonalize){window.__dshPersonalize.applyPersonalize(window.__dshPersonalize.loadPersonalize());}"
	+ " return localStorage.getItem(K); })()");
const okRestore = (snap === null) ? (restored === null) : (restored === snap);
await js("window.__closeDlg&&window.__closeDlg()");

console.log("");
console.log("══════════════════ 汇总 ══════════════════");
console.log("  四档截图: " + rows.map((r) => r.id).join(" / ") + "  →  " + OUT_DIR);
console.log("  对比度: " + rows.map((r) => r.id + "=" + r.cr).join("  "));console.log("  用户设置还原: " + (okRestore ? "✅ 逐字节一致" : "❌ 未还原（原=" + (snap === null ? "null" : snap.length + "B") + " 现=" + (restored === null ? "null" : restored.length + "B") + "）"));
console.log("  弹窗已关闭: " + String(await js("!window.__dlg||!window.__dlg()")));
if (problems.length) { console.log("  问题：" + problems.join(" ; ")); console.log("IS_PASS: FALSE"); process.exit(1); }
if (!okRestore) { console.log("IS_PASS: FALSE（用户设置未还原）"); process.exit(1); }
console.log("IS_PASS: TRUE（四档截图齐备 · 对比度全 ≥4.5 · 设置逐字节还原）");
ws.close();
