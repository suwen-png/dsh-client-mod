/**
 * verify-walk.mjs — 真机全控件**广度**巡检（四界面：总监页 / 设计图工作室 / 思维导图 / 总监弹窗）
 *
 * 命题：**没有一个可见可交互元素一点就炸**。对每个界面当前可见的可交互元素逐个**真实坐标点击**，
 *   逐点验证：①点后渲染进程仍可求值（没把主线程点挂）②无新增 window.onerror / unhandledrejection
 *   ③点完能 Esc/再点复位，不把界面卡死在某个状态。
 *
 * 与既有「深度」逐交互测试的分工（互补，不重复）：
 *   - cdp-click / cdp-click-dialog：每个功能「点击前→点击→点击后回读」验证**业务结果是否正确**；
 *   - verify-mindmap / verify-design-studio：导图/工作室逐交互（含 hover/选中才出现的条件渲染控件）；
 *   - verify-flow：跨页签/浮层的完整流转；
 *   - 本脚本（verify-walk）：只守**广度与健壮性**——枚举运行时真正渲染出来的可交互元素，
 *     凡 button/select/role=button/可点 chip 与折叠头，都要真点一次且不崩。
 *
 * 数据安全（不污染用户数据）：会**写库/改文档/真实发送/调宿主/改布局**的控件不在广度巡检里真点
 *   （它们已被深度测试覆盖），用 skip / skipPrefix 显式列出并在报告中计数，绝不静默跳过。
 *
 * 退出码（项目约定）：0 全绿 / 1 有控件点后异常（FAIL）/ 2 配置错误（INVALID，如 Harness 未开 9222）。
 *
 * 用法：node scripts/verify-walk.mjs   （前置：Harness 已启动且 CDP 9222，最好已打开一个会话）
 */
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── CDP 连接（与其它真机脚本同构：零依赖原生 fetch+WebSocket，硬超时防主线程挂死拖垮脚本）── */
let targets;
try {
  targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
} catch (e) {
  console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "，Harness 未启动？）");
  process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("IS_PASS: FALSE（INVALID：未找到 page 目标）"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); rej(new Error("EVAL_TIMEOUT")); }, 6000); pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } }); ws.send(JSON.stringify({ id, method, params })); });
const emit = (m, p = {}) => ws.send(JSON.stringify({ id: ++seq, method: m, params: p }));
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
async function ev(expr) { const o = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (o.exceptionDetails) return { __exc: o.exceptionDetails.text }; return o.result?.value; }
function mouse(type, x, y, b) { emit("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: b || 0, clickCount: type === "mouseMoved" ? 0 : 1 }); }
async function clickXY(x, y) { mouse("mouseMoved", x, y, 0); await sleep(20); mouse("mousePressed", x, y, 1); await sleep(35); mouse("mouseReleased", x, y, 0); await sleep(220); }
function esc() { emit("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); emit("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); }

// 注入全局错误收集器（每次运行重置，避免读到历史错误）
await ev("window.__walkErr=[];window.addEventListener('error',e=>window.__walkErr.push(String(e.message||e.error)));window.addEventListener('unhandledrejection',e=>window.__walkErr.push('rej:'+String(e.reason)));1");

/* ── 开场准备：关掉浮层 → 确保有选中会话（tab 环出现）→ 真实点击「总监」tab → 轮询等 dp-root ── */
async function realClickByEval(selectorFinder) {
  const c = await ev(`(function(){var e=(${selectorFinder});if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  if (!c) return false;
  await clickXY(c.x, c.y); return true;
}
esc(); await sleep(300);
// ① 先确保选中一个真实会话：连跑结束后会话视图可能失焦，此时三页签虽在 DOM 但几何塌缩为 0×0，
//    坐标点击必落空。点侧栏一个含时间词的真实会话，把主视图唤醒。
await realClickByEval("[...document.querySelectorAll('[role=treeitem]')].find(e=>/分钟|小时|天|刚刚/.test(e.textContent))");
// ② 轮询等「总监」tab 恢复非 0 几何（最多 6 秒）
let tabGeo = null;
for (let i = 0; i < 24; i++) {
  tabGeo = await ev(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()==='总监');if(!t)return null;var r=t.getBoundingClientRect();return r.width>4&&r.height>4?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null;})()`);
  if (tabGeo) break;
  // 还没尺寸就再点一次会话唤醒
  await realClickByEval("[...document.querySelectorAll('[role=treeitem]')].find(e=>/分钟|小时|天|刚刚/.test(e.textContent))");
  await sleep(250);
}
// ③ 真实点击「总监」tab
if (tabGeo) { await clickXY(tabGeo.x, tabGeo.y); }
else { // 坐标路径失败时兜底用 DOM click
  await ev("(function(){var t=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()==='总监');if(t)t.click();return 1;})()");
}
// ④ 轮询等总监页挂载（最多 6 秒）
let dpReady = false;
for (let i = 0; i < 24; i++) {
  if (await ev("!!document.querySelector('[data-testid=dp-root]')")) { dpReady = true; break; }
  await sleep(250);
}
console.log("开场准备：总监页挂载=" + dpReady + (dpReady ? "" : "（本轮总监页记缺失，浮层仍巡检）"));

/* 枚举某容器内**可见**且**可交互**的元素（运行时真值，不依赖静态清单） */
const ENUM = (rootSel) => `(function(){var root=document.querySelector(${JSON.stringify(rootSel)});if(!root)return null;
 var els=[...root.querySelectorAll('button,[role=button],select,[data-testid]')];
 var out=[];var seen={};
 els.forEach(function(e){
   var s=getComputedStyle(e),r=e.getBoundingClientRect();
   if(s.display==='none'||s.visibility==='hidden'||r.width<3||r.height<3)return;
   var tid=e.getAttribute('data-testid')||('TAG:'+e.tagName);
   var interactive=e.tagName==='BUTTON'||e.tagName==='SELECT'||e.getAttribute('role')==='button';
   var clickableDiv=/toggle|chip|^dp-k-|agent-|^dp-lv-|^dp-model|^dp-now-title|^d-seg/.test(tid);
   if(!interactive&&!clickableDiv)return;
   if(seen[tid])return;seen[tid]=1;
   out.push({tid:tid,tag:e.tagName,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),
     disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',txt:(e.textContent||'').trim().slice(0,14)});
 });
 return out;})()`;

const errCount = () => ev("window.__walkErr.length") || 0;
const errTail = (n) => ev("window.__walkErr.slice(" + n + ")") || [];

let passN = 0, failN = 0, skipN = 0;
const failures = [];

/* 巡检一个界面：枚举 → 逐个真实点击 → 健康断言 → 复位 */
async function walkSurface(name, rootSel, opts) {
  const items = await ev(ENUM(rootSel));
  if (!items) { console.log(`\n[${name}] 容器 ${rootSel} 未找到（记为缺失）`); return { name, missing: true }; }
  const skip = new Set(opts.skip || []);
  const skipPrefix = opts.skipPrefix || [];
  const toggle = new Set(opts.toggle || []);
  console.log(`\n========== 巡检【${name}】可见可交互 ${items.length} 个 ==========`);
  for (const it of items) {
    const isSkip = skip.has(it.tid) || skipPrefix.some((p) => it.tid.startsWith(p));
    if (isSkip) { skipN++; console.log(`  ⊘ ${it.tid.padEnd(22)} 跳过（深度测试已覆盖）`); continue; }
    const e0 = await errCount();
    let st = "OK", detail = "";
    try {
      await clickXY(it.x, it.y);
      const alive = await ev("1+1");
      const e1 = await errCount();
      if (alive !== 2) { st = "FAIL"; detail = "点后渲染进程无响应（主线程挂起）"; }
      else if (e1 > e0) { st = "FAIL"; detail = "新增 JS 错误: " + JSON.stringify(await errTail(e0)); }
      else detail = it.disabled ? "disabled（安全忽略）" : "已响应、无错误";
    } catch (e) { st = "FAIL"; detail = String(e.message).slice(0, 60); }
    /* 复位：折叠头再点一次收起；其余 Esc 关掉可能弹出的浮层 */
    try {
      if (toggle.has(it.tid)) {
        const r2 = await ev(`(function(){var e=document.querySelector(${JSON.stringify('[data-testid="' + it.tid + '"]')});if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
        if (r2) await clickXY(r2.x, r2.y);
      }
      esc(); await sleep(110);
    } catch (_) {}
    if (st === "OK") { passN++; console.log(`  ✓ ${it.tid.padEnd(22)} [${it.tag}] ${detail}`); }
    else { failN++; failures.push({ surf: name, tid: it.tid, detail }); console.log(`  ✗ ${it.tid.padEnd(22)} [${it.tag}] ${detail}`); }
  }
  return { name, missing: false, count: items.length };
}

/* 打开浮层 → 巡检 → 关闭 */
const surfaces = [];
async function walkOverlay(name, openTid, rootSel, opts, closeTid) {
  esc(); await sleep(200);
  const oc = await ev(`(function(){var e=document.querySelector(${JSON.stringify('[data-testid="' + openTid + '"]')});if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  if (!oc) { console.log(`\n[${name}] 入口 ${openTid} 未找到（记为缺失）`); surfaces.push({ name, missing: true }); failN++; failures.push({ surf: name, tid: openTid, detail: "浮层入口缺失" }); return; }
  await clickXY(oc.x, oc.y); await sleep(900);
  surfaces.push(await walkSurface(name, rootSel, opts));
  esc(); await sleep(250);
  const cc = await ev(`(function(){var e=document.querySelector(${JSON.stringify('[data-testid="' + closeTid + '"]')});if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  if (cc) await clickXY(cc.x, cc.y);
  await sleep(350); esc(); await sleep(180);
}

// ① 总监页（已尝试切到总监 tab）
surfaces.push(await walkSurface("总监页", '[data-testid="dp-root"]', {
  // 会真实发送/删除/导航/改职责链路的：cdp-click(I段)/verify-flow(G段) 已深度覆盖，广度不重复触发
  skip: ["dp-act-del", "dp-send", "dp-act-next", "dp-sync", "dp-focus-native", "dp-register-flow", "dp-route-director", "dp-route-chat"],
  toggle: ["dp-r2-toggle", "dp-r4-toggle", "dp-r6-toggle"]
}));
// ② 设计图工作室（添加/保存/新建/改名/删除/发送会改文档，verify-design-studio 深度覆盖；广度只点纯视图控件）
await walkOverlay("设计图工作室", "d-open-design", '[data-testid="ds-root"]', {
  skip: ["ds-save", "ds-new", "ds-rename", "ds-del-doc", "ds-send", "ds-more", "ds-doclist", "ds-ver-restore", "ds-ver-del"],
  skipPrefix: ["ds-add-"],
  toggle: ["ds-ver-toggle"]   // 版本面板开关：点完再点一次收起，避免展开态泄漏到枚举（restore/del 改数据已 skip）
}, "ds-close");
// ③ 思维导图（调宿主/改布局/复杂流程由 verify-mindmap 深度覆盖）
await walkOverlay("思维导图", "d-open-mindmap", '[data-testid="mm-root"]', {
  skip: ["mm-new-fork", "mm-route", "mm-collapse-all", "mm-auto-layout", "mm-overview", "mm-refresh"]
}, "mm-close");
// ④ 总监弹窗（路由去向会改 flow，cdp-click-dialog 深度覆盖）
await walkOverlay("总监弹窗", "d-open-director", '[data-testid="d-panel"]', {
  skip: ["d-route-transfer", "d-route-direct", "d-route-new", "d-route-cancel", "d-review-run"]
}, "d-close");

// 收尾：确保所有浮层关闭，回到干净态
esc(); await sleep(200);

console.log("\n───────────────────────────────────────────────");
for (const s of surfaces) {
  if (!s.missing) console.log(`【${s.name}】枚举 ${s.count} 个可见可交互元素`);
}
if (failures.length) {
  console.log("异常控件：");
  failures.forEach((f) => console.log("  ✗ [" + f.surf + "] " + f.tid + " :: " + f.detail));
}
console.log(`通过 ${passN} / 失败 ${failN} / 跳过(深度测试覆盖) ${skipN}`);
console.log("IS_PASS: " + (failN === 0 ? "TRUE" : "FALSE"));
console.log("───────────────────────────────────────────────");
ws.close();
process.exit(failN === 0 ? 0 : 1);
