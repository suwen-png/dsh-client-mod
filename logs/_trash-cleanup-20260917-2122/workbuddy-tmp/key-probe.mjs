/**
 * key-probe.mjs — 临时诊断：连续发 Escape 并逐步读状态（含 keydown 到达记录）
 * 用法: node key-probe.mjs [次数] [键]
 */
const PORT = 9222;
const times = Number(process.argv[2] || 4);
const keyName = process.argv[3] || "Escape";

const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
	.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
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
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq; pending.set(id, { res, rej });
	ws.send(JSON.stringify({ id, method, params }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

/* 只读记录器：capture 阶段记录每次 keydown 的 key / target，不改任何状态 */
await js(`(function(){
  if (window.__probeKeys) return 'already';
  window.__probeKeys = [];
  document.addEventListener('keydown', function(e){
    window.__probeKeys.push({ key: e.key, target: (e.target&&e.target.tagName)||null,
      tid: (e.target&&e.target.getAttribute&&e.target.getAttribute('data-testid'))||null,
      prevented: e.defaultPrevented });
  }, true);
  return 'installed';
})()`);

const snap = () => js(`(function(){
  var s=document.getElementById('dsh-design-studio');
  var lg=document.querySelector('[data-testid=ds-logic]');
  return JSON.stringify({
    studioOpen: !!s && s.getBoundingClientRect().width>0,
    dsRoot: !!document.querySelector('[data-testid=ds-root]'),
    logic: !!lg, logicElId: lg?lg.getAttribute('data-el-id'):null,
    pending: !!document.querySelector('[data-testid=ds-pending]'),
    pp: document.querySelectorAll('[data-testid=pp-panel]').length,
    active: (document.activeElement&&document.activeElement.tagName)||null,
    activeTid: (document.activeElement&&document.activeElement.getAttribute&&document.activeElement.getAttribute('data-testid'))||null,
    els: document.querySelectorAll('[data-testid=ds-el]').length
  });
})()`);

console.log("初始 :", await snap());
for (let i = 1; i <= times; i++) {
	await js(`(function(){ if(document.activeElement&&document.activeElement.blur) document.activeElement.blur(); return 1; })()`);
	const base = { key: keyName, code: keyName, windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, modifiers: 0 };
	await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
	await wait(30);
	await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
	await wait(520);
	console.log(`Esc#${i} :`, await snap());
}
const rec = await js(`JSON.stringify(window.__probeKeys)`);
console.log("keydown 到达记录 :", rec);
try { ws.close(); } catch (e) { /* 忽略 */ }
process.exit(0);
