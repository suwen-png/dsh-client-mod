/**
 * _cdp-lastmsg.mjs —— 「双通道读最新总监消息」的唯一实现（T-PLUG-053 ⑤）
 *
 * 🔴 为什么必须双通道（纪律 126：同一语义两处实现 = 隐式断链）：
 *    `dp-dir-msg` **只在「总监消息」子页签激活时渲染** —— 宿主把视角切走后，
 *    DOM 里一条消息都没有，但消息**已经写进** IndexedDB `directorConversations`
 *    （`store/plugin-db.js#appendDirectorMessage`，键 messageId/nodeId/role/kind/text/at）。
 *    只读 DOM ⇒ 把"没切视图"误判成"消息没写"（第二十三轮就这么红了两条）。
 *
 * 双通道口径（与界面一致）：
 *    DOM 优先 —— `[data-testid="dp-dir-msg"]` 最后一条（界面正在看的那一条）。
 *    库兜底 —— 取「最新动作所在节点」的最新一条；节点内按 at 排序取最后。
 *    双通道都读不到 ⇒ 返回 text:null（那才是真的没写，让判据如实红）。
 *
 * 用法：`import { readLastDirectorMessage } from "./_cdp-lastmsg.mjs";`
 *       `const m = await readLastDirectorMessage(ev);` // ev = (expr)=>Promise<value>
 * 返回：`{ text, src, node, n }` ｜ text 可能为 null；src ∈ {"dom","db(node/n)",null}
 */

/* IndexedDB 侧读取（自包含 async IIFE；由调用方的 ev 注入执行）。 */
const DB_READ = "(async function(){return new Promise(function(res){var r=indexedDB.open('dsh-director-plugin-db');"
+ "r.onerror=function(){res(null)};r.onsuccess=function(){var db=r.result;"
+ "var tx=db.transaction(['directorConversations'],'readonly');"
+ "var q=tx.objectStore('directorConversations').getAll();"
+ "q.onsuccess=function(){var all=q.result||[];if(!all.length)return res(null);"
+ "var best=null;all.forEach(function(x){if(!best||(x.at||0)>=(best.at||0))best=x;});"
+ "var node=String(best.nodeId||'');"
+ "var arr=all.filter(function(x){return String(x.nodeId||'')===node;}).sort(function(a,b){return (a.at||0)-(b.at||0);});"
+ "var rec=arr[arr.length-1]||best;"
+ "res(JSON.stringify({node:node,n:arr.length,at:rec.at,role:String(rec.role||''),kind:String(rec.kind||''),"
+ "text:String(rec.text||'').replace(/\\s+/g,' ').trim()}));};"
+ "q.onerror=function(){res(null)};};});})()";

/* DOM 侧读取：最后一条 dp-dir-msg 的可见文本。 */
const DOM_READ = "(function(){var rows=document.querySelectorAll('[data-testid=\"dp-dir-msg\"]');"
+ "if(!rows.length)return null;var e=rows[rows.length-1];"
+ "return String(e.textContent||'').replace(/\\s+/g,' ').trim();})()";

/**
 * @param {(expr:string)=>Promise<any>} ev CDP 求值（Runtime.evaluate, awaitPromise:true）
 * @returns {Promise<{text:string|null, src:string|null, node:string|null, n:number|null}>}
 */
export async function readLastDirectorMessage(ev) {
	const dom = await ev(DOM_READ);
	if (typeof dom === "string" && dom) return { text: dom, src: "dom", node: null, n: null };
	const db = await ev(DB_READ);
	if (!db) return { text: null, src: null, node: null, n: null };
	try {
		const o = typeof db === "string" ? JSON.parse(db) : db;
		const text = String(o.text || "");
		return { text: text || null, src: "db(" + o.node + "/" + o.n + ")", node: o.node, n: o.n };
	} catch (_) {
		return { text: null, src: null, node: null, n: null };
	}
}

export default { readLastDirectorMessage, DB_READ, DOM_READ };
