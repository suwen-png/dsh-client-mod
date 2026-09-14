/**
 * shot-all.mjs — 四界面「视觉审美复验」一次性截图（总监页 / 设计图工作室 / 思维导图 / 总监弹窗）
 *
 * 为什么需要：e2e 断言只能证明「点了会变」，证明不了「好看、分得清、四界面风格一致」。
 * 本脚本依次把四个界面切到「有内容」的代表性状态，各抓一张全屏 PNG，
 * 并回读每个界面的**实际计算样式**（主色/字号/圆角/背景层级），输出风格一致性 JSON，
 * 供人（或审核）并排比对。改任何样式后跑一次。
 *
 * 用法：node scripts/shot-all.mjs [输出目录，默认 logs/audit]
 */
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = 9222;
const OUTDIR = process.argv[2] || "logs/audit";
mkdirSync(OUTDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标（Harness 未启动？）"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); rej(new Error("TIMEOUT")); }, 7000); pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } }); ws.send(JSON.stringify({ id, method, params })); });
const emit = (m, p = {}) => ws.send(JSON.stringify({ id: ++seq, method: m, params: p }));
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable"); await send("Page.enable");
const js = async (expr) => { const o = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (o.exceptionDetails) return { __exc: o.exceptionDetails.text }; return o.result?.value; };
function mouse(type, x, y, b) { emit("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: b || 0, clickCount: type === "mouseMoved" ? 0 : 1 }); }
async function clickXY(x, y) { mouse("mouseMoved", x, y, 0); await sleep(20); mouse("mousePressed", x, y, 1); await sleep(35); mouse("mouseReleased", x, y, 0); await sleep(240); }
async function clickTestId(tid) {
  const c = await js(`(function(){var e=document.querySelector(${JSON.stringify('[data-testid="' + tid + '"]')});if(!e)return null;var r=e.getBoundingClientRect();return r.width>0?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null;})()`);
  if (c) await clickXY(c.x, c.y); return !!c;
}
function esc() { emit("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); emit("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); }
async function waitFor(sel, n = 24) { for (let i = 0; i < n; i++) { if (await js("!!document.querySelector(" + JSON.stringify(sel) + ")")) return true; await sleep(250); } return false; }
async function shot(name) { const o = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const buf = Buffer.from(o.data, "base64"); const p = OUTDIR + "/" + name + ".png"; writeFileSync(p, buf); console.log("截图 " + p + "  " + buf.length + " B"); return buf.length; }

/* 回读某容器内实际计算样式：字号集合 / 圆角集合 / 主色（带蓝紫青的色值）出现次数 / 背景层级数 */
const styleProbe = (rootSel) => `(function(){var root=document.querySelector(${JSON.stringify(rootSel)});if(!root)return null;
 var fs={},rad={},colors={},bgs={};
 var all=[root].concat([...root.querySelectorAll('*')]);
 all.forEach(function(e){var s=getComputedStyle(e);
   var f=parseFloat(s.fontSize);if(f>=9&&f<=28)fs[f.toFixed(1)]=(fs[f.toFixed(1)]||0)+1;
   var rd=parseFloat(s.borderRadius);if(rd>=2&&rd<=24)rad[rd.toFixed(0)]=(rad[rd.toFixed(0)]||0)+1;
   [s.color,s.borderTopColor,s.backgroundColor].forEach(function(c){
     if(/^rgb/.test(c)){colors[c]=(colors[c]||0)+1;} });
   if(s.backgroundColor&&s.backgroundColor!=='rgba(0, 0, 0, 0)')bgs[s.backgroundColor]=(bgs[s.backgroundColor]||0)+1;
 });
 /* 设计令牌主色命中：蓝 #2f6feb=rgb(47,111,235) 紫 #8957e5=rgb(137,87,229) 青 #39c5cf=rgb(57,197,207) */
 var brand={blue:0,purple:0,cyan:0};Object.keys(colors).forEach(function(c){
   if(c.indexOf('47, 111, 235')>=0)brand.blue+=colors[c];
   if(c.indexOf('137, 87, 229')>=0)brand.purple+=colors[c];
   if(c.indexOf('57, 197, 207')>=0)brand.cyan+=colors[c];});
 var minFs=Math.min.apply(null,Object.keys(fs).map(Number));
 return {fontSizes:fs,radii:rad,brand:brand,bgLevels:Object.keys(bgs).length,minFont:minFs};})()`;

// ── 开场：唤醒会话 → 总监 tab ──
esc(); await sleep(200);
await js(`(function(){var it=[...document.querySelectorAll('[role=treeitem]')].find(e=>/分钟|小时|天|刚刚/.test(e.textContent));if(it)it.click();return 1;})()`);
await sleep(900);
for (let i = 0; i < 24; i++) { const g = await js(`(function(){var t=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()==='总监');if(!t)return null;var r=t.getBoundingClientRect();return r.width>4?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null;})()`); if (g) { await clickXY(g.x, g.y); break; } await sleep(250); }
await waitFor('[data-testid="dp-root"]');
await sleep(800);

const report = {};

// ① 总监页
report.director = { bytes: await shot("1-director"), style: await js(styleProbe('[data-testid="dp-root"]')) };

// ② 设计图工作室（选中第一个元素，让左栏逻辑面板入镜）
esc(); await clickTestId("d-open-design"); await waitFor('[data-testid="ds-root"]'); await sleep(700);
await js(`(function(){var c=document.querySelector('[data-testid=ds-ver-close]');if(c)c.click();return 1;})()`);  // 收起可能残留的版本历史面板
await sleep(300);
await js(`(function(){var e=document.querySelector('[data-testid=ds-el]');if(!e)return 0;var r=e.getBoundingClientRect();var o={bubbles:true,clientX:r.left+6,clientY:r.top+6,pointerId:1,isPrimary:true};e.dispatchEvent(new PointerEvent('pointerdown',o));e.dispatchEvent(new PointerEvent('pointerup',o));return 1;})()`);
await sleep(500);
report.design = { bytes: await shot("2-design"), style: await js(styleProbe('[data-testid="ds-root"]')) };
esc(); await sleep(200); await clickTestId("ds-close"); await sleep(500);

// ③ 思维导图（先点「适应」让血缘树铺满视口，避免截到缩小态/大片空白）
await clickTestId("d-open-mindmap"); await waitFor('[data-testid="mm-root"]'); await sleep(700);
await clickTestId("mm-fit"); await sleep(900);
report.mindmap = { bytes: await shot("3-mindmap"), style: await js(styleProbe('[data-testid="mm-root"]')) };
esc(); await sleep(200); await clickTestId("mm-close"); await sleep(500);

// ④ 总监弹窗
await clickTestId("d-open-director"); await waitFor('[data-testid="d-panel"]'); await sleep(800);
report.dialog = { bytes: await shot("4-dialog"), style: await js(styleProbe('[data-testid="d-dialog"]')) };
esc(); await sleep(200); await clickTestId("d-close"); await sleep(300); esc();

writeFileSync(OUTDIR + "/style-report.json", JSON.stringify(report, null, 2));
console.log("\n===== 风格一致性回读 =====");
for (const [k, v] of Object.entries(report)) {
  const s = v.style || {};
  console.log(`【${k}】最小字号 ${s.minFont}px｜字号档 ${Object.keys(s.fontSizes || {}).length}｜圆角档 ${Object.keys(s.radii || {}).length}｜背景层级 ${s.bgLevels}｜主色命中 蓝${s.brand?.blue||0} 紫${s.brand?.purple||0} 青${s.brand?.cyan||0}`);
}
console.log("\n样式明细已写 " + OUTDIR + "/style-report.json");
ws.close();
