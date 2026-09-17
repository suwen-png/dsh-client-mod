#!/usr/bin/env node
/**
 * purge-host-sessions.mjs —— 把**宿主内存里残留的会话**逐条下架（正式工具）
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 为什么需要它（2026-09-16 第十九轮实测）
 * ──────────────────────────────────────────────────────────────────
 *  把 `~/.dsh/sessions/**` 清空、`workspace.json` 与 `session_projcache.json` 归零之后，
 *  **宿主侧栏仍然列着旧会话**（磁盘三口径读 0，DOM `sessionRow` 读 6~7）——
 *  它们活在 **Harness 主进程内存**里：`sessions.list.getSnapshot().byId` 实测 **115 条**。
 *
 *  而主进程**杀不掉**：
 *      `taskkill /F /PID 5656` ⇒ 「拒绝访问」（沙箱内外都拒，说明是权限层级而非沙箱）
 *      `Stop-Process`           ⇒ 同上
 *  只有两个"非主进程"的子 PID（GPT/utility）能被杀，它们一死渲染进程还会 wedged
 *  （`Runtime.evaluate` 只回 `Runtime.enable` 超时，而浏览器端口 `/json/version` 照常回）。
 *   `Page.reload` 也刷不掉：渲染进程重新 boot，仍是主进程那份旧快照。
 *
 *  ⇒ 不重启 Harness 的前提下，唯一能让宿主列表变干净的路是走**宿主官方通道**：
 *      **`api.workspace.archiveSession({ sessionId })`**
 *    它由主进程执行、返回**更新后的归档全集**，并立刻反映到侧栏。
 *    （实测：归档 1 条 ⇒ 侧栏该行当场消失。）
 *
 * 🔴 本轮新测出来的 RPC 面（修正此前"宿主无会话删除能力"的印象）
 *      `api.sessions`  = list / search / create / history / models / selectModel /
 *                        rename / fork / prompt / attachment / updateQueue / cancel
 *                        ⇒ **确无 delete**
 *      `api.workspace` = list / create / rename / **delete** / insertBefore /
 *                        insertSessionBefore / **archiveSession**
 *                        ⇒ 「会话下架」的官方语义在 **workspace 命名空间**下，叫 archiveSession
 *      签名（宿主 `dsh-host-apiproxy/lib/types/api/workspace.schema.js`）：
 *        request  { sessionId: string }
 *        value    { archivedSessionIds: string[] }   ← 更新后的**归档全集**
 *
 * 🔴 判据陷阱（别用错口径）
 *      · `manager.refreshList()` **不会**把 byId 清零（快照只增不减）⇒ **byId 不能当"清干净"的判据**
 *      · 权威判据 = archiveSession 返回的 `archivedSessionIds.length`
 *      · 辅助判据 = 侧栏 `[class*=sessionRow]` 条数（用户视角）+ 磁盘 `workspace.json`
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   CDP_PORT=9222 node scripts/purge-host-sessions.mjs            # dry-run：只报条数
 *   CDP_PORT=9222 node scripts/purge-host-sessions.mjs --apply    # 逐条下架
 *   （🔴 输出建议重定向到文件，不要接 `| head` —— 管道会让 Node 走块缓冲，看起来像挂死）
 *
 * ── 退出码 ────────────────────────────────────────────────────────
 *   0 = 全部成功（failN === 0）｜1 = 有失败 ｜2 = 用法/环境错（取不到 ctx、CDP 超时）
 */

const PORT = Number(process.env.CDP_PORT || 9222);
const APPLY = process.argv.includes("--apply");
const TIMEOUT = Number(process.env.PURGE_TIMEOUT_MS || 240000);
const J = (x) => JSON.stringify(x);

/* ── 最小 CDP 客户端（零依赖；每次 send 都带硬超时 —— 渲染进程 wedged 时必须有出口）── */
async function cdpEval(expression) {
	const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
	const page = list.filter((t) => t.type === "page").find((t) => /localhost|127\.0\.0\.1/.test(t.url));
	if (!page) throw new Error("未找到页面目标（URL 里没有 localhost/127.0.0.1 的 page）");
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let seq = 0; const pend = new Map();
	ws.addEventListener("message", (ev) => {
		const m = JSON.parse(ev.data);
		if (m.id !== undefined && pend.has(m.id)) {
			const { res, rej } = pend.get(m.id); pend.delete(m.id);
			m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
		}
	});
	const send = (method, params = {}) => new Promise((res, rej) => {
		const id = ++seq; pend.set(id, { res, rej });
		ws.send(JSON.stringify({ id, method, params }));
	});
	const withTimeout = (p, label) => new Promise((res, rej) => {
		const h = setTimeout(() => rej(new Error("CDP 调用超时 " + TIMEOUT + "ms：" + label)), TIMEOUT);
		if (h.unref) h.unref();
		p.then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
	});
	await new Promise((r) => ws.addEventListener("open", r, { once: true }));
	await withTimeout(send("Runtime.enable"), "Runtime.enable");
	const out = await withTimeout(send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), "Runtime.evaluate");
	try { ws.close(); } catch (e) { /* 忽略 */ }
	if (out.exceptionDetails) {
		throw new Error("页面表达式抛异常：" + ((out.exceptionDetails.exception && out.exceptionDetails.exception.description) || out.exceptionDetails.text));
	}
	return out.result && out.result.value;
}

/* ── 表达式一：只读清点 ── */
const EXPR_COUNT =
	"(function(){var c=window.__cordis_ctx__;if(!c)return JSON.stringify({err:\"取不到 __cordis_ctx__（宿主/插件未就绪）\"});" +
	"var s=c.get(\"sessions\");if(!s)return JSON.stringify({err:\"取不到 sessions 服务\"});" +
	"var snap=s.list.getSnapshot();var ids=Object.keys(snap.byId||{});" +
	"var dom=document.querySelectorAll(\"[class*=sessionRow]\").length;" +
	"return JSON.stringify({byId:ids.length,dom:dom,current:snap.current||null,phase:snap.phase||null})})()";

/* ── 表达式二：逐条归档（串行，浏览器侧循环 —— 避免 115 次 CDP 往返）── */
const EXPR_PURGE =
	"(async function(){" +
	"var c=window.__cordis_ctx__;if(!c)return JSON.stringify({err:\"取不到 __cordis_ctx__\"});" +
	"var s=c.get(\"sessions\");var m=s.manager;var snap=s.list.getSnapshot();var ids=Object.keys(snap.byId||{});" +
	"var domBefore=document.querySelectorAll(\"[class*=sessionRow]\").length;" +
	"var done=0,failN=0,firstFail=null,archN=-1;" +
	"for(var i=0;i<ids.length;i++){" +
	"  try{" +
	"    var r=await m.api.workspace.archiveSession({sessionId:ids[i]});" +
	"    var bad=(r&&r.result&&r.result.ok===false);" +
	"    if(bad){failN++;if(!firstFail)firstFail=String(ids[i]).slice(0,40)+\" => \"+JSON.stringify(r&&r.result).slice(0,140);}" +
	"    else{done++;}" +
	"    var v=r&&r.result&&r.result.value;" +
	"    if(v&&v.archivedSessionIds){archN=v.archivedSessionIds.length;}" +
	"  }catch(e){failN++;if(!firstFail)firstFail=String(ids[i]).slice(0,40)+\" => \"+String((e&&e.message)||e).slice(0,140);}" +
	"}" +
	"await new Promise(function(z){setTimeout(z,1500)});" +
	"var domAfter=document.querySelectorAll(\"[class*=sessionRow]\").length;" +
	"var snap2=s.list.getSnapshot();" +
	"return JSON.stringify({attempted:ids.length,done:done,failN:failN,firstFail:firstFail," +
	"archivedSetN:archN,domBefore:domBefore,domAfter:domAfter,byIdAfter:Object.keys(snap2.byId||{}).length})})()";

async function main() {
	console.log("═══ 宿主残留会话下架（archiveSession）═══");
	console.log("  CDP 端口 " + PORT + "｜模式 " + (APPLY ? "**APPLY（会改宿主状态）**" : "dry-run（只清点）"));

	let pre;
	try {
		pre = JSON.parse(await cdpEval(EXPR_COUNT));
	} catch (e) {
		console.error("❌ 无法读取宿主状态：" + ((e && e.message) || e));
		console.error("   自检：node scripts/cdp-eval.mjs \"1+1\" —— 失败说明渲染进程 wedged（可先跑 reload-client.mjs）");
		process.exit(2);
	}
	if (pre.err) { console.error("❌ " + pre.err); process.exit(2); }

	console.log("  下架前：宿主内存快照 byId = " + J(pre.byId) + " 条｜侧栏 sessionRow = " + J(pre.dom) + " 行｜phase=" + J(pre.phase));
	if (pre.byId === 0) {
		console.log("✔ 宿主内存已无残留会话（byId=0）—— 无需下架。");
		process.exit(0);
	}
	if (!APPLY) {
		console.log("");
		console.log("（dry-run：**没有改任何东西**。确认后加 --apply 执行逐条下架）");
		console.log("  下架走宿主官方 RPC `workspace.archiveSession` —— 主进程执行、立刻反映到侧栏、可复原（归档而非删除）。");
		process.exit(0);
	}

	let r;
	try {
		r = JSON.parse(await cdpEval(EXPR_PURGE));
	} catch (e) {
		console.error("❌ 下架过程中失败：" + ((e && e.message) || e));
		process.exit(1);
	}
	if (r.err) { console.error("❌ " + r.err); process.exit(2); }

	console.log("");
	console.log("  尝试 " + J(r.attempted) + " 条 ⇒ 成功 " + J(r.done) + " · 失败 " + J(r.failN));
	if (r.firstFail) console.log("  首个失败样本：" + r.firstFail);
	console.log("  归档全集 archivedSessionIds = " + J(r.archivedSetN) + " 条（**权威判据**）");
	console.log("  侧栏 sessionRow：" + J(r.domBefore) + " → " + J(r.domAfter) + " 行（用户视角）");
	console.log("  宿主内存快照 byId：" + J(r.byIdAfter) + " 条（⚠ 该数只增不减，**不作判据**，仅记录）");

	if (r.failN > 0) {
		console.log("");
		console.log("⚠ 有 " + J(r.failN) + " 条未成功 —— 重跑一次通常可清尾（已归档的会幂等返回 ok）。");
		process.exit(1);
	}
	console.log("");
	console.log("✔ 下架完成。后续：");
	console.log("  · 磁盘 `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds` 会随之增长 ——");
	console.log("    若希望磁盘也归零，可再跑 `node scripts/clean-sessions.mjs --apply`（它会清这一项）。");
	console.log("  · **彻底干净的唯一方式是重启 Harness**：磁盘已 0 ⇒ 重启后主进程重建索引 ⇒ 列表 0 条。");
	process.exit(0);
}

main().catch((e) => { console.error("❌ 未捕获异常：" + ((e && e.stack) || e)); process.exit(2); });
