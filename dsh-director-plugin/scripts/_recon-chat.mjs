/**
 * _recon-chat.mjs —— 宿主【对话】页签 DOM 勘察（临时探针，用后即删）
 *
 * 目的：为第 6 批需求（对话页标题栏 / 最小化 / 宽度可调 / 底部切换按钮 / 模型配置）
 *      取得**宿主真实 DOM 结构** —— 不靠截图猜、不靠源码编译产物猜。
 *
 * 用法：node scripts/_recon-chat.mjs
 * 零依赖（Node 22 原生 fetch + WebSocket）。
 */
const PORT = 9222;
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const sendRaw = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const CALL_TIMEOUT = Number(process.env.CDP_TIMEOUT_MS || 10000);
const withTimeout = (p, label) => new Promise((res, rej) => {
	const h = setTimeout(() => rej(new Error("CDP 超时 " + CALL_TIMEOUT + "ms: " + label)), CALL_TIMEOUT);
	if (h.unref) h.unref();
	p.then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
});
const send = (m, p) => withTimeout(sendRaw(m, p), m);
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));
let ev;
const fire = (method, params) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); };

await new Promise((r) => ws.addEventListener("open", r));
ev = async (expr) => {
	try {
		const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
		if (r.exceptionDetails) return "ERR:" + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 200);
		return r.result && r.result.value;
	} catch (e) { return "THROW:" + String(e.message || e).slice(0, 160); }
};
await send("Runtime.enable");

const realClick = async (x, y) => {
	fire("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
	await WAIT(18);
	fire("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
	await WAIT(18);
	fire("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
};
const findBox = async (predJs) => {
	const raw = await ev(
		"(function(){" +
		"  var list = [].slice.call(document.querySelectorAll('*'));" +
		"  for (var i = 0; i < list.length; i++) {" +
		"    var e = list[i];" +
		"    try { if (!(" + predJs + ")) continue; } catch (err) { continue; }" +
		"    var r = e.getBoundingClientRect();" +
		"    if (r.width < 4 || r.height < 4) continue;" +
		"    var cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);" +
		"    if (!(cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight)) continue;" +
		"    var h = document.elementFromPoint(cx, cy);" +
		"    if (!(h && (h === e || e.contains(h) || h.contains(e)))) continue;" +
		"    return JSON.stringify({ cx: cx, cy: cy, w: Math.round(r.width), h: Math.round(r.height), label: (e.textContent || '').trim().slice(0, 26) });" +
		"  } return JSON.stringify(null); })()"
	);
	return raw && !String(raw).startsWith("ERR") && raw !== "null" ? JSON.parse(raw) : null;
};

const log = [];
const hasSlot = async () => ev("!!document.querySelector('[data-slot=\"conversation.view\"]')");
if (!(await hasSlot())) {
	const row = await findBox("e.className && /sessionRow/.test(String(e.className)) && (e.textContent||'').trim() !== '新会话' && (e.textContent||'').trim().length > 0");
	if (row) { await realClick(row.cx, row.cy); await WAIT(2000); log.push("打开会话「" + row.label + "」 ⇒ 槽 " + (await hasSlot())); }
	else log.push("⚠️ 未找到会话行");
} else log.push("已有会话");

/* 点【对话】页签（精确文本，排除浮动入口的 ◆总监） */
const ctab = await findBox("e.tagName === 'BUTTON' && (e.textContent||'').trim() === '对话'");
if (ctab) { await realClick(ctab.cx, ctab.cy); await WAIT(1500); log.push("点【对话】页签 @ " + ctab.cx + "," + ctab.cy); }
else log.push("⚠️ 未找到【对话】页签");

/* ── 勘察 ── */
const dump = await ev(`(function(){
  function desc(e, maxChain){
    if(!e) return null;
    var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    var chain = [], p = e.parentElement, i = 0;
    while(p && p !== document.body && i < (maxChain||4)){
      var pr = p.getBoundingClientRect();
      chain.push(p.tagName + '|' + String(p.className).slice(0,28) + '|' + Math.round(pr.width) + 'x' + Math.round(pr.height));
      p = p.parentElement; i++;
    }
    return { tag:e.tagName, cls:String(e.className).slice(0,50), style:(e.getAttribute('style')||'').slice(0,140),
      rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],
      bg:cs.backgroundColor, display:cs.display, pos:cs.position, text:(e.textContent||'').trim().slice(0,40),
      children:e.children.length, up:chain };
  }
  var out = { url:location.href, innerW:innerWidth, innerH:innerHeight, shots:{} };

  // A. viewArea 与它的直接孩子（宿主三页签的渲染容器）
  var va = document.querySelector('[class*="viewArea"]');
  out.viewArea = desc(va, 2);
  if(va) out.viewAreaKids = [].slice.call(va.children).map(function(c){ return desc(c, 1); });

  // B. 所有"高度 16-48、宽 > 200"的横向条（候选：标题栏 / 工具条 / 统计行）
  out.bars = [];
  [].slice.call(document.querySelectorAll('div')).forEach(function(e){
    var r = e.getBoundingClientRect();
    if(r.width > 200 && r.height >= 14 && r.height <= 48 && r.y > 0){
      var cs = getComputedStyle(e);
      var m = cs.backgroundColor.match(/rgba?\\(([\\d.]+), ([\\d.]+), ([\\d.]+)(?:, ([\\d.]+))?/);
      var alpha = m && m[4] !== undefined ? parseFloat(m[4]) : 1;
      if(alpha < 0.02) return;
      out.bars.push({ rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],
        bg:cs.backgroundColor, text:(e.textContent||'').trim().slice(0,50), kids:e.children.length,
        cls:String(e.className).slice(0,36), style:(e.getAttribute('style')||'').slice(0,80) });
    }
  });
  out.bars.sort(function(a,b){ return a.rect[1]-b.rect[1]; });
  out.bars = out.bars.slice(0, 26);

  // C. 「总监」这两个字出现在哪儿（全部实例 + 几何 + 祖先）
  out.dirTexts = [];
  [].slice.call(document.querySelectorAll('*')).forEach(function(e){
    if(e.children.length !== 0) return;
    var t = (e.textContent||'').trim();
    if(t !== '总监' && t !== '总监对话' && t !== '总监记忆' && t !== '—') return;
    var r = e.getBoundingClientRect();
    if(r.width < 1 || r.height < 1) return;
    out.dirTexts.push(desc(e, 5));
  });

  // D. composer + 统计行
  var ed = document.querySelector('[contenteditable="true"]');
  out.composer = desc(ed, 6);

  // E. 底部 40px 内的所有元素（找「58 轮 · 58 步」这类统计条）
  out.bottom = [];
  [].slice.call(document.querySelectorAll('div,span')).forEach(function(e){
    if(e.children.length !== 0) return;
    var r = e.getBoundingClientRect();
    if(r.height < 6 || r.width < 20) return;
    if(r.y + r.height < innerHeight - 90) return;
    var t = (e.textContent||'').trim();
    if(!t) return;
    out.bottom.push({ rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], text:t.slice(0,60), up:desc(e,3).up });
  });
  out.bottom = out.bottom.slice(0, 30);
  return JSON.stringify(out);
})()`);

console.log("── 准备 ──");
log.forEach((l) => console.log("  " + l));
console.log("\n── 勘察 ──");
try { console.log(JSON.stringify(JSON.parse(dump), null, 1)); }
catch (e) { console.log(String(dump).slice(0, 3000)); }
process.exit(0);
