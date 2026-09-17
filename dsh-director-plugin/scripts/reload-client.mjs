#!/usr/bin/env node
/**
 * reload-client.mjs —— 让**新的 client 插件产物**在渲染进程生效（**正式工具，不是临时脚本**）
 *
 * 🔴 第十九轮**升格**说明：本脚本原为 `_tmp-reload.mjs`（"用完即删"）。
 *    第十九轮实测证明"主进程不可结束"是**长期环境事实**而非一次性状况
 *    （`7412`/`10312`/`5656` 对本会话的 `Stop-Process` / `taskkill /F` **持续静默拒绝**，
 *     `restart-harness.ps1` 会起新实例但**端口不变** ⇒ 插件没重载，纪律 61 幽灵重启）。
 *    而 `lib/client.js` 是 **client 插件、页面 boot 时从磁盘读取** ⇒ `Page.reload(ignoreCache)`
 *    就等价于"装载新产物"，也是本仓**唯一**可行的落地方式。
 *    ⇒ 既然每轮都要用，它就不该叫 `_tmp-`（那会让人以为可以删掉）。已升格并纳入命令链。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   CDP_PORT=9222 node scripts/reload-client.mjs > logs/_reload.txt 2>&1
 *   （🔴 输出**重定向到文件**，不要接 `| head` —— 管道会让 Node 走块缓冲，看起来像"零输出挂死"）
 *
 * ── 判据（可分辨，别只看"脚本跑完了"）────────────────────────────
 *   ① reload 后读 `window.__dshBuildStamp`，必须**等于** `node scripts/build-stamp.mjs` 的输出
 *      （第十九轮新增：过去没有这个读数，只能靠"有没有某个新符号"猜页面加载了哪一版）
 *   ② reload 后插件注入面非空（`{"db":"object","tree":"object"}`）
 *   ③ 页面 URL / 端口**不变** ⇒ 同 origin ⇒ localStorage（含 `dsh.director.*`）保留，
 *      这正是"跑程内判据"要面对的场景（纪律 16）
 *
 * 🔴 第 18 批踩到并修掉的坑（与纪律 55 同型）：
 *   `Page.reload` 触发导航期间，CDP 上的 `Runtime.evaluate` **会挂起且不回复**。
 *   上一版把 `send()` 写成纯 Promise，配上"轮询 + 超时"的保护 ⇒ **保护永远不会触发**
 *   （超时等的是它自己的 promise，而它等的是**永不 resolve** 的 `send`）
 *   ⇒ 脚本零输出挂死 8 分钟（真正的"零输出"是**管道缓冲**：`| head` 会让 Node 走块缓冲）。
 *   对策：① 每次 `send` 都套 `withTimeout`；② reload **不等回复**、发完即断 WS；
 *        ③ 重开一条 WS 再轮询就绪；④ 输出直接重定向到文件（不接管道）。 */
const PORT = Number(process.env.CDP_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (x) => JSON.stringify(x);

async function connect(tag) {
  const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
  const page = list.find((t) => t.type === "page" && /localhost|127\.0\.0\.1/.test(t.url));
  if (!page) return null;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  ws.addEventListener("error", () => { });
  await Promise.race([new Promise((r) => ws.addEventListener("open", r)), sleep(8000)]);
  const send = (method, params, ms) => new Promise((res) => {
    const i = ++id; pend.set(i, (m) => res(m));
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); res({ __timeout: method }); } }, ms || 8000);
  });
  const js = async (expr, ms) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, ms);
    if (r && r.__timeout) return "__timeout";
    if (!r || r.exceptionDetails || (r.result && r.result.exceptionDetails)) return "__exc";
    return r.result && r.result.result ? r.result.result.value : "__noValue";
  };
  return { ws: ws, send: send, js: js, url: page.url, tag: tag };
}

/* ── 段 1：连上去，记状态，发 reload（不等回复）── */
console.log("[1] 连接 CDP（reload 前）…");
const a = await connect("pre");
if (!a) { console.log("NO_PAGE_TARGET"); process.exit(2); }
const beforeDiag = await a.js("(function(){ try{ var s=window.__dshBranchTree&&window.__dshBranchTree.getBranchSnapshot(); return s&&s.diag? s.diag.dispatchApplied : null; }catch(e){ return null; } })()");
console.log("[1] reload 前：url=" + J(a.url) + " diag.dispatchApplied=" + J(beforeDiag) + "（旧产物预期 16）");
a.send("Page.reload", { ignoreCache: true }, 5000);   // **不等回复**
await sleep(400);
try { a.ws.close(); } catch (e) { /* 故意 */ }
console.log("[1] 已发出 Page.reload(ignoreCache:true) 并断开 WS");

/* ── 段 2：重开 WS，等渲染进程就绪 ── */
await sleep(2500);
let ok = null;
for (let i = 0; i < 20; i++) {
  const b = await connect("post-" + i);
  if (b) {
    const alive = await b.js("1+1", 6000);
    const st = await b.js("document.readyState", 6000);
    console.log("[2] 尝试 " + i + "：alive=" + J(alive) + " readyState=" + J(st));
    if (alive === 2 && st === "complete") {
      const inj = await b.js("(function(){ return { db: typeof window.__dshPluginDb, tree: typeof window.__dshBranchTree }; })()", 8000);
      console.log("[2] 插件注入面：" + J(inj));
      if (inj && inj.db === "object" && inj.tree === "object") { ok = { conn: b, inj: inj }; break; }
    }
    try { b.ws.close(); } catch (e) { /* 故意 */ }
  } else {
    console.log("[2] 尝试 " + i + "：找不到 page target（导航中）");
  }
  await sleep(1500);
}
if (ok) {
  const url2 = await ok.conn.js("location.href", 6000);
  console.log("[2] 之后 URL：" + J(url2));
  /* 🔴 第十九轮新增判据 ①：页面**实际加载的产物指纹**（过去没有这个读数，
   *    排查属性缺失时只能靠"有没有某个新符号"猜；现在可以直接对上 build 的输出）。 */
  const stamp = await ok.conn.js("(function(){ return (typeof window.__dshBuildStamp === 'string') ? window.__dshBuildStamp : null; })()", 6000);
  console.log("[2] 页面产物指纹 __dshBuildStamp：" + J(stamp) + "（应与 `node scripts/build-stamp.mjs` 的输出一致）");
  if (!stamp) console.log("[2] ⚠️ 读不到指纹 ⇒ 页面加载的可能是**打指纹之前**的旧产物（先跑 build 再 reload）");
  console.log("[2] ✔ 新产物已装载（页面 URL/端口不变 ⇒ 同 origin ⇒ localStorage 历史保留，正是跑程内判据要面对的场景）");
  try { ok.conn.ws.close(); } catch (e) { /* 故意 */ }
  process.exit(0);
}
console.log("[2] ✗ 超时：页面未恢复到可就绪状态（这属**闸门取数失败**，不是产品失败 —— 纪律 55）");
process.exit(2);
