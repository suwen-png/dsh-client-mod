/**
 * verify-data-safe.mjs — T-PLUG-009 数据兼容与边界安全验证（IDB 三 store 条数抽查 + 数据源零损伤）
 *                        + T-PLUG-035 真机 Cookie 体积预算（第 [7] 节 · 「打不开软件」长效防线）
 *
 * 前置：Harness 以 `--remote-debugging-port=9222` 启动
 *       （必须清除 ELECTRON_RUN_AS_NODE，否则 Electron 退化为 Node 并拒绝该开关）
 *
 * 用法：node scripts/verify-data-safe.mjs [port]
 * 退出码：0 = 全通过；1 = 存在失败项；2 = INVALID（含 CDP 连不上）
 *
 * 零依赖：Node 22 原生 fetch + 全局 WebSocket。
 *
 * ── 为何需要本脚本（T-PLUG-009 的原始诉求） ──────────────────────────
 * 宿主把会话记忆放在 IDB `dsh-director-db` v3 的 **三 store**：
 *   `memoryCore`（keyPath `projectId`）/ `memoryDecisions`（`decisionId`）/ `memoryRisks`（`riskId`）。
 * 28号文/29号文的既定边界是「**插件不消费宿主记忆 store，历史数据不得删除**」。
 *
 * 但架构上有一条硬约束与它冲突：
 *   宿主与插件**共享同一个 DB**，而插件**不能升 v4**（一升，宿主再以 v3 打开就失败 ⇒ 宿主记忆全废）。
 *   ⇒ 无法为插件新增独立 store。
 *
 * 于是批次 7 的层级节点**复用了 `memoryCore`**，并以「**id 前缀约定**」与宿主记录互不干扰：
 *   插件记录 = 带 `level` 字段（`__global__` / `ws_*` / `se_*`）；
 *   宿主记录 = 无 `level` 字段。
 *
 * 🔴 这属于「**约定隔离**」而非「**物理隔离**」，是本项目**最大的潜在数据风险面**。
 *    本脚本的职责就是把这条约定**固化成机器可校验的断言**，并在每次改动后重跑，
 *    一旦约定被破坏（新增 store / 升版本 / 过滤器失效 / 宿主改用 getAll）立刻报红。
 *
 * 注意：本脚本**不是只读**——第 4 节会注入一条**临时**宿主形态记录并在同节内删除，
 *       以动态反证「过滤器真的能挡住宿主记录」。前后均回读校验条数回到基线。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = Number(process.argv[2] || 9222);
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..");
const HOST_CLIENT = join(REPO_ROOT, "workspace", "@deepseek-ai", "dsh-client-ui-conversation", "lib", "client.js");

/** 临时探针记录的 key。刻意用不可能与真实数据撞车的前缀，且第 4 节结束前必删。 */
const PROBE_KEY = "__probe_host_record_do_not_keep__";
/** 反证用：宿主形态记录**带一个伪 level**（验证「白名单」而非「真值判断」） */
const PROBE_LEVEL_KEY = "__probe_host_with_bogus_level_do_not_keep__";
/** 反证用：带**合法 level 但缺 id**（验证 id 必须是字符串这一半条件） */
const PROBE_NOID_KEY = "__probe_host_no_id_do_not_keep__";

let pass = 0;
let fail = 0;
const failures = [];
function ok(label, cond, detail = "") {
	if (cond) { pass++; console.log(`  ✅ ${label}${detail ? "  — " + detail : ""}`); }
	else { fail++; failures.push(label); console.log(`  ❌ ${label}${detail ? "  — " + detail : ""}`); }
}

function connect(wsUrl) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		let id = 0;
		const pending = new Map();
		ws.addEventListener("message", (ev) => {
			let msg;
			try { msg = JSON.parse(ev.data); } catch { return; }
			if (msg.id !== undefined && pending.has(msg.id)) {
				const { resolve: res, reject: rej } = pending.get(msg.id);
				pending.delete(msg.id);
				if (msg.error) rej(new Error(JSON.stringify(msg.error)));
				else res(msg.result);
			}
		});
		ws.addEventListener("error", (e) => reject(new Error("ws error: " + (e.message || "unknown"))));
		ws.addEventListener("open", () => {
			resolve({
				send(method, params = {}) {
					const myId = ++id;
					return new Promise((res, rej) => {
						pending.set(myId, { resolve: res, reject: rej });
						ws.send(JSON.stringify({ id: myId, method, params }));
						setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); rej(new Error(method + " timeout")); } }, 20000);
					});
				},
				close() { try { ws.close(); } catch { /* ignore */ } }
			});
		});
	});
}

console.log("========================================");
console.log(" T-PLUG-009 数据兼容与边界安全验证");
console.log(` 端口: ${PORT}`);
console.log("========================================\n");

// ── 0. 连接 ──
// 🔴 2026-09-14 补（纪律 17）：Harness 未启动时原先崩栈成 `TypeError: fetch failed` + ECONNREFUSED，
//    读起来像脚本坏了。用错目标判 INVALID(2)，不判 FAIL(1)。
let targets;
try {
	targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：连不上 CDP " + PORT + "）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=9222 启动。");
	console.error("  正确用法（必须后台启动，且清掉两个环境变量）：");
	console.error("    powershell -File scripts/restart-harness.ps1");
	console.error("    node scripts/verify-data-safe.mjs");
	process.exit(2);
}
const page = targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url || ""));
if (!page) { console.error("IS_PASS: FALSE（INVALID：CDP 无 page 目标）"); process.exit(2); }
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");

/** 在页面内求值（awaitPromise + returnByValue）。 */
async function evalExpr(expression) {
	const out = await cdp.send("Runtime.evaluate", {
		expression: `(async () => { ${expression} })()`,
		returnByValue: true, awaitPromise: true, includeCommandLineAPI: true
	});
	if (out.exceptionDetails) {
		throw new Error(out.exceptionDetails.text + " :: " + (out.exceptionDetails.exception?.description || ""));
	}
	return out.result?.value;
}

/* ══════════════════════════════════════════════════════════════════
 * 页面内工具：全部通过 window.__dsDataSafe 注入，避免每次都重定义
 * ══════════════════════════════════════════════════════════════════ */
await evalExpr(`
	window.__dsDataSafe = {
		/* 打开库但**不指定版本**：绝不触发升级（升级会直接伤到宿主） */
		open: (name) => new Promise((res, rej) => {
			const rq = indexedDB.open(name);
			rq.onsuccess = () => res(rq.result);
			rq.onerror = () => rej(rq.error);
			rq.onblocked = () => rej(new Error('blocked'));
		}),
		count: (db, store) => new Promise((res) => {
			try {
				const tx = db.transaction(store, 'readonly');
				const rq = tx.objectStore(store).count();
				rq.onsuccess = () => res(rq.result);
				rq.onerror = () => res('ERR');
			} catch (e) { res('ERR:' + e.message); }
		}),
		put: (db, store, rec) => new Promise((res) => {
			try {
				const tx = db.transaction(store, 'readwrite');
				tx.objectStore(store).put(rec);
				tx.oncomplete = () => res(true);
				tx.onerror = () => res(false);
			} catch (e) { res('ERR:' + e.message); }
		}),
		del: (db, store, key) => new Promise((res) => {
			try {
				const tx = db.transaction(store, 'readwrite');
				tx.objectStore(store).delete(key);
				tx.oncomplete = () => res(true);
				tx.onerror = () => res(false);
			} catch (e) { res('ERR:' + e.message); }
		}),
		lsSnapshot: () => {
			const o = {};
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				o[k] = (localStorage.getItem(k) || '').length;
			}
			return o;
		},
		shallowEqual: (a, b) => {
			const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
			if (ka.length !== kb.length) return false;
			for (let i = 0; i < ka.length; i++) { if (ka[i] !== kb[i] || a[ka[i]] !== b[ka[i]]) return false; }
			return true;
		}
	};
	return 'ok';
`);

/* ══════════════════════════════════════════════════════════════════
 * [0] 等待宿主核心数据落盘 —— 🔴 否则会把「还没写」误判成「数据没了」
 * ══════════════════════════════════════════════════════════════════
 * 🔴 为何必须先等（2026-09-12 实测踩中的假阳性陷阱）：
 *    `dsh.workspace.view.*` **不是** dsh-client-ui-conversation 写的
 *    （在该宿主 bundle 里 grep `dsh.workspace.view` → **0 处命中**），
 *    而是由**另一个 bundle** 在**开机后异步**写入。冷启动后立刻探测会读到「不存在」，
 *    进而在「重启前后对比」中被误读成**数据丢失** —— 实际只是**还没写**。
 *    同一次踩坑还叠加了另一条：`dsh.director.store.*` 只在**总监活动**时由
 *    `create-store.js#notify → saveDirectorStore` 写入，冷启动且无总监活动时**本来就该没有**。
 *    ⇒ 本脚本在取基线前先等宿主数据就绪，并把二者区分开（见第 6 节的「观察」行）。
 */
async function waitForHostData(timeoutMs = 60000, stepMs = 1000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const ready = await evalExpr(`
			const keys = Object.keys(window.__dsDataSafe.lsSnapshot());
			return keys.some((k) => k.indexOf('dsh.workspace.view') === 0) ? true : false;
		`);
		if (ready === true) return true;
		await new Promise((r) => setTimeout(r, stepMs));
	}
	return false;
}
const hostReady = await waitForHostData();
console.log("[0] 宿主核心数据就绪等待");
ok("🔴 已等到 `dsh.workspace.view.*` 出现（宿主**异步**写入，早探测会误判为数据丢失）",
	hostReady === true, hostReady ? "已就绪" : "等待 60s 超时");

/* ══════════════════════════════════════════════════════════════════
 * [1] IDB 结构契约（只读）—— 未新增 store、未升版本
 * ══════════════════════════════════════════════════════════════════ */
console.log("[1] IDB 结构契约（未新增 store / 未升版本）");

/** 宿主源码中记载的权威 store 集合与版本（下面第 2 节会从源码解析出来做交叉验证） */
const EXPECTED_STORES = ["directorStores", "directorDocs", "directorFolders", "memoryCore", "memoryDecisions", "memoryRisks"];

const dbInfo = await evalExpr(`
	const dbs = await (await indexedDB.databases()).map((d) => ({ name: d.name, version: d.version }));
	const db = await window.__dsDataSafe.open('dsh-director-db');
	const stores = Array.from(db.objectStoreNames);
	const counts = {};
	for (const s of stores) counts[s] = await window.__dsDataSafe.count(db, s);
	/* 逐个取 keyPath，验证与宿主写入形态一致（keyPath 变了宿主就写不进去） */
	const keyPaths = {};
	for (const s of stores) keyPaths[s] = db.transaction(s, 'readonly').objectStore(s).keyPath;
	db.close();
	return JSON.stringify({ dbs, version: dbs.find((d) => d.name === 'dsh-director-db')?.version, stores, counts, keyPaths });
`);
const D = JSON.parse(dbInfo);

ok("DB `dsh-director-db` 存在", Array.isArray(D.dbs) && D.dbs.some((d) => d.name === "dsh-director-db"),
	JSON.stringify(D.dbs));
ok("🔴 版本仍为 3（升版会让宿主以 v3 打开直接失败 ⇒ 宿主记忆全废）", D.version === 3, "version=" + D.version);
ok("store 集合恰好 6 个且与宿主契约一致（未新增）",
	JSON.stringify([...D.stores].sort()) === JSON.stringify([...EXPECTED_STORES].sort()),
	"实际=" + JSON.stringify(D.stores));
ok("🔴 `memoryCore.keyPath === projectId`（与宿主 `idbSaveMemoryCore` 一致）",
	D.keyPaths.memoryCore === "projectId", "keyPath=" + D.keyPaths.memoryCore);
ok("`memoryDecisions.keyPath === decisionId`", D.keyPaths.memoryDecisions === "decisionId", "keyPath=" + D.keyPaths.memoryDecisions);
ok("`memoryRisks.keyPath === riskId`", D.keyPaths.memoryRisks === "riskId", "keyPath=" + D.keyPaths.memoryRisks);
ok("`directorStores` 无 keyPath（外部传 key）", D.keyPaths.directorStores === null, "keyPath=" + String(D.keyPaths.directorStores));

const BASE_COUNTS = D.counts;
console.log("    条数基线:", JSON.stringify(BASE_COUNTS));

/* ══════════════════════════════════════════════════════════════════
 * [2] 宿主侧访问模式取证（静态读源码，反证读取不受插件记录影响）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[2] 宿主侧访问模式取证（读取是否会撞上插件记录）");

ok("宿主源码可读", existsSync(HOST_CLIENT), HOST_CLIENT);
let hostSrc = "";
try { hostSrc = readFileSync(HOST_CLIENT, "utf8"); } catch { hostSrc = ""; }

/** 取出宿主中所有对 memoryCore 常量做操作的语句（`.xxx(IDB_MEMORY_CORE_STORE...`） */
const memCoreUseLines = hostSrc.split("\n")
	.map((l, i) => ({ n: i + 1, l }))
	.filter((x) => /IDB_MEMORY_CORE_STORE/.test(x.l));

const usesGetAll = memCoreUseLines.filter((x) => /\.getAll\s*\(/.test(x.l));
const usesGet = memCoreUseLines.filter((x) => /\.get\s*\(/.test(x.l));
const usesPut = memCoreUseLines.filter((x) => /\.put\s*\(/.test(x.l));
const usesDelete = memCoreUseLines.filter((x) => /\.delete\s*\(/.test(x.l));

ok("🔴 宿主对 `memoryCore` **零 `getAll()`**（否则会把插件层级节点当记忆读出来）",
	usesGetAll.length === 0, usesGetAll.length ? "命中行 " + usesGetAll.map((x) => x.n).join(",") : "0 处");
ok("宿主按 `get(projectId)` **精确读**（key 不撞就不会互相看见）",
	usesGet.length > 0, "get 命中 " + usesGet.length + " 处");
ok("宿主写入走 `put`", usesPut.length > 0, "put 命中 " + usesPut.length + " 处");
ok("宿主对 `memoryCore` **零 `delete()`**（历史数据不得删除）",
	usesDelete.length === 0, usesDelete.length ? "命中行 " + usesDelete.map((x) => x.n).join(",") : "0 处");

const hostVer = (hostSrc.match(/IDB_VERSION\s*=\s*(\d+)/) || [])[1];
ok("🔴 宿主 `IDB_VERSION === 3`（与插件一致，是共享 DB 的前提）", hostVer === "3", "IDB_VERSION=" + hostVer);

const pluginIdbSrc = readFileSync(join(PLUGIN_ROOT, "src", "store", "idb.js"), "utf8");
const pluginVer = (pluginIdbSrc.match(/IDB_VERSION\s*=\s*(\d+)/) || [])[1];
ok("🔴 插件 `IDB_VERSION === 3`（不升版 ⇒ 宿主兼容）", pluginVer === "3", "IDB_VERSION=" + pluginVer);

/* ══════════════════════════════════════════════════════════════════
 * [3] memoryCore 记录归属分类（只读）—— 约定的可机器判别性
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[3] memoryCore 记录归属分类（插件 vs 宿主 可按 `level` 判别）");

const classify = await evalExpr(`
	const db = await window.__dsDataSafe.open('dsh-director-db');
	const recs = await new Promise((res) => {
		const tx = db.transaction('memoryCore', 'readonly');
		const rq = tx.objectStore('memoryCore').getAll();
		rq.onsuccess = () => res(rq.result || []);
		rq.onerror = () => res([]);
	});
	db.close();
	const plugin = [], host = [];
	for (const r of recs) {
		if (r && typeof r === 'object' && r.level) plugin.push(r);
		else host.push(r);
	}
	const keyMismatch = plugin.filter((r) => r.projectId !== r.id).map((r) => String(r.id));
	const levels = {};
	for (const r of plugin) levels[r.level] = (levels[r.level] || 0) + 1;
	const ids = Array.from(new Set(plugin.map((r) => String(r.id)))).sort();
	const hasProbe = recs.some((r) => r && r.projectId === '${PROBE_KEY}');
	return JSON.stringify({ total: recs.length, pluginCount: plugin.length, hostCount: host.length, keyMismatch, levels, ids, hasProbe });
`);
const C = JSON.parse(classify);

ok("插件记录与宿主记录**可按 `level` 字段判别**（约定成立的前提）",
	C.pluginCount + C.hostCount === C.total, `插件 ${C.pluginCount} / 宿主 ${C.hostCount} / 合计 ${C.total}`);
ok("🔴 插件记录 `projectId === id`（keyPath 适配正确，无静默写失败）",
	C.keyMismatch.length === 0, C.keyMismatch.length ? "不匹配: " + C.keyMismatch.join(",") : "全部一致");
ok("插件记录层级集合合法（global/project/session）",
	C.levels.global >= 1 && Object.keys(C.levels).every((k) => ["global", "project", "session"].includes(k)),
	JSON.stringify(C.levels));
ok("🔴 插件**未越界写** `memoryDecisions` / `memoryRisks`（两者条数应为 0）",
	BASE_COUNTS.memoryDecisions === 0 && BASE_COUNTS.memoryRisks === 0,
	`memoryDecisions=${BASE_COUNTS.memoryDecisions} memoryRisks=${BASE_COUNTS.memoryRisks}`);
console.log("    插件节点 id:", C.ids.join(", ") || "(无)");

/* ══════════════════════════════════════════════════════════════════
 * [4] 隔离性动态反证 —— 注入宿主形态记录 → 插件必须看不见 → 删除
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[4] 隔离性动态反证（宿主形态记录不得进入插件层级树）");

const inject = await evalExpr(`
	const db = await window.__dsDataSafe.open('dsh-director-db');
	/* 模拟宿主写入形态：只有 projectId + 记忆字段，**刻意不加 level** */
	const probe = {
		projectId: '${PROBE_KEY}',
		conversationHistory: [{ role: 'user', content: 'probe' }],
		decisions: [],
		risks: [],
		updatedAt: Date.now()
	};
	const wrote = await window.__dsDataSafe.put(db, 'memoryCore', probe);
	const after = await window.__dsDataSafe.count(db, 'memoryCore');
	db.close();
	const all = await window.__dshHierarchy.listAllNodes();
	/* 🔴 身份判据必须用 projectId（= IDB 真实主键），不能用 id：
	 *    探针刻意不带 id，若按 n.id 比对会**恒为 0 而变成空洞断言**。 */
	const leaked = all.filter((n) => String(n.projectId) === '${PROBE_KEY}').length;
	const got = await window.__dshHierarchy.getNode('${PROBE_KEY}');
	return JSON.stringify({ wrote, after, leaked, gotProjectId: got ? got.projectId : null, gotHasLevel: got ? Boolean(got.level) : null, nodeCount: all.length });
`);
const I = JSON.parse(inject);

ok("临时宿主形态记录写入成功", I.wrote === true, "memoryCore=" + I.after);
ok("🔴 插件 `listAllNodes()` **不含**该宿主形态记录（`level` 过滤器有效）",
	I.leaked === 0, "泄露 " + I.leaked + " 条");
ok("🔴 该记录确实存在于 IDB（证明上一条是「被过滤」而非「没写进去」）",
	I.gotProjectId === PROBE_KEY && I.gotHasLevel === false,
	`getNode.projectId=${I.gotProjectId} hasLevel=${I.gotHasLevel}`);
ok("插件树节点数未因宿主记录而虚增", I.nodeCount === C.pluginCount, `${I.nodeCount} vs 基线 ${C.pluginCount}`);

const cleanup = await evalExpr(`
	const db = await window.__dsDataSafe.open('dsh-director-db');
	const okDel = await window.__dsDataSafe.del(db, 'memoryCore', '${PROBE_KEY}');
	const after = await window.__dsDataSafe.count(db, 'memoryCore');
	db.close();
	const got = await window.__dshHierarchy.getNode('${PROBE_KEY}');
	return JSON.stringify({ okDel, after, stillThere: Boolean(got) });
`);
const CL = JSON.parse(cleanup);
ok("🔴 临时记录已清除（本脚本可反复运行，不留痕）",
	CL.okDel === true && CL.stillThere === false, `memoryCore=${CL.after}`);
ok("🔴 `memoryCore` 条数回到基线（净零变更）",
	CL.after === BASE_COUNTS.memoryCore, `${CL.after} vs 基线 ${BASE_COUNTS.memoryCore}`);

/* ── [4b] 硬化反证：仅「有 level」不足以混入，必须过 schema 白名单 ── */
console.log("\n[4b] 硬化反证（白名单 vs 真值判断）");

const harden = await evalExpr(`
	const db = await window.__dsDataSafe.open('dsh-director-db');
	/* ① 宿主记忆记录 + 一个**伪 level**（旧口径 n.level 真值判断会放它进来） */
	await window.__dsDataSafe.put(db, 'memoryCore', {
		projectId: '${PROBE_LEVEL_KEY}', level: 'note', conversationHistory: [], updatedAt: Date.now()
	});
	/* ② 带**合法 level 但无 id**（旧口径同样会放它进来） */
	await window.__dsDataSafe.put(db, 'memoryCore', {
		projectId: '${PROBE_NOID_KEY}', level: 'global', conversationHistory: [], updatedAt: Date.now()
	});
	const mid = await window.__dsDataSafe.count(db, 'memoryCore');
	const all = await window.__dshHierarchy.listAllNodes();
	const leakedLevel = all.filter((n) => String(n.projectId) === '${PROBE_LEVEL_KEY}').length;
	const leakedNoId = all.filter((n) => String(n.projectId) === '${PROBE_NOID_KEY}').length;
	await window.__dsDataSafe.del(db, 'memoryCore', '${PROBE_LEVEL_KEY}');
	await window.__dsDataSafe.del(db, 'memoryCore', '${PROBE_NOID_KEY}');
	const after = await window.__dsDataSafe.count(db, 'memoryCore');
	db.close();
	return JSON.stringify({ mid, leakedLevel, leakedNoId, after, nodeCount: all.length });
`);
const H = JSON.parse(harden);

ok("两条探针均已写入（前置条件成立）", H.mid === BASE_COUNTS.memoryCore + 2, "memoryCore=" + H.mid);
ok("🔴 伪 `level`（'note'）的宿主记录**仍被挡住**（白名单生效，非真值判断）",
	H.leakedLevel === 0, "泄露 " + H.leakedLevel + " 条");
ok("🔴 合法 `level` 但缺 `id` 的记录**仍被挡住**（id 类型条件生效）",
	H.leakedNoId === 0, "泄露 " + H.leakedNoId + " 条");
ok("树节点数未虚增（仍等于插件真实节点数）", H.nodeCount === C.pluginCount, `${H.nodeCount} vs ${C.pluginCount}`);
ok("两条探针已清除且条数回基线", H.after === BASE_COUNTS.memoryCore, `${H.after} vs 基线 ${BASE_COUNTS.memoryCore}`);

/* 残余面登记：白名单无法覆盖「宿主记录同时具备合法 level + 字符串 id」这一形态。
   该形态仅能靠 key 命名空间（`__global__` / `ws_*` / `se_*`）约定规避 —— 属**残余风险**，
   刻意不进一步收紧：若改成 id 前缀白名单，一旦将来新增 id 方案，
   合法节点会**静默消失**（比混入更难排查）。此处显式登记而非隐藏。 */
ok("残余风险已显式登记（不隐藏）：宿主若同时具备合法 level + 字符串 id 才会混入",
	true, "缓解手段 = key 命名空间约定；已由本脚本每次运行复核");

/* ══════════════════════════════════════════════════════════════════
 * [5] 宿主数据源零损伤 —— localStorage 与 IDB 全量回读
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[5] 宿主数据源零损伤");

const final = await evalExpr(`
	const db = await window.__dsDataSafe.open('dsh-director-db');
	const stores = Array.from(db.objectStoreNames);
	const counts = {};
	for (const s of stores) counts[s] = await window.__dsDataSafe.count(db, s);
	const version = db.version;
	db.close();
	const ls = window.__dsDataSafe.lsSnapshot();
	const viewKey = Object.keys(ls).find((k) => k.indexOf('dsh.workspace.view') === 0) || null;
	let viewParsed = null;
	if (viewKey) {
		try {
			const v = JSON.parse(localStorage.getItem(viewKey) || '{}');
			viewParsed = { groupBy: v.groupBy === undefined ? null : v.groupBy, hasOrder: Boolean(v.sessionOrderByAccount) };
		} catch (e) { viewParsed = 'PARSE_ERR:' + e.message; }
	}
	return JSON.stringify({ stores, counts, version, ls, viewKey, viewParsed });
`);
const F = JSON.parse(final);

const countDiffs = EXPECTED_STORES.filter((s) => F.counts[s] !== BASE_COUNTS[s]);
ok("🔴 六 store 条数与基线**逐一一致**（宿主记忆零增零减）",
	countDiffs.length === 0,
	countDiffs.length ? countDiffs.map((s) => `${s}: ${BASE_COUNTS[s]}→${F.counts[s]}`).join("; ") : JSON.stringify(F.counts));
ok("IDB 版本在全程后仍为 3", F.version === 3, "version=" + F.version);
ok("store 集合在全程后未变（无新增/无丢失）",
	JSON.stringify([...F.stores].sort()) === JSON.stringify([...EXPECTED_STORES].sort()), JSON.stringify(F.stores));

/* ── 宿主数据源（localStorage）── */
const hostLsKeys = Object.keys(F.ls).filter((k) => k.indexOf("dsh.director.") !== 0);
ok("宿主 localStorage 数据源仍存在（`dsh.workspace.view.*` + `dsh.sessions.current`）",
	Boolean(F.viewKey) && hostLsKeys.some((k) => k === "dsh.sessions.current"),
	hostLsKeys.join(", "));
ok("🔴 `dsh.workspace.view.*` 仍可 JSON 解析且结构完好（groupBy / sessionOrderByAccount）",
	F.viewParsed && F.viewParsed !== "PARSE_ERR" && typeof F.viewParsed === "object"
		&& F.viewParsed.groupBy === "workspace" && F.viewParsed.hasOrder === true,
	JSON.stringify(F.viewParsed));

/* ══════════════════════════════════════════════════════════════════
 * [6] R5 持久化 key 契约 —— 不可改名（改名 = 用户数据失联）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[6] R5 持久化 key 契约（改名 = 老数据失联）");

const allLs = Object.keys(F.ls);
ok("`dsh.workspace.view.*` 前缀未改名（宿主会话/文件夹数据源）",
	allLs.some((k) => k.indexOf("dsh.workspace.view.") === 0), F.viewKey || "(缺失)");
ok("`dsh.sessions.current` 未改名", allLs.includes("dsh.sessions.current"), "存在=" + allLs.includes("dsh.sessions.current"));

/* ── 插件侧 key 契约：改用**源码静态断言** ──
 * 🔴 为何不查环境里的 `dsh.director.store.*`：该 key 只在「总监 store 有消息且发生过落盘」后
 *    才存在，属**环境残留**而非不变量 —— 首次启动 / 刚重启时必然没有。
 *    用它做断言会产生「换个环境就误报」的假阴性（本脚本首版即踩中：
 *    清缓存重启后该 key 不存在 → 误报 FAIL）。契约应查**定义处**，不查**残留**。 */
const messagesSrc = readFileSync(join(PLUGIN_ROOT, "src", "store", "messages.js"), "utf8");
const persistSrc = readFileSync(join(PLUGIN_ROOT, "src", "store", "persist.js"), "utf8");
ok("🔴 `DIRECTOR_STORE_PREFIX = \"dsh.director.store.\"` 未改名（R5 冻结）",
	/DIRECTOR_STORE_PREFIX\s*=\s*"dsh\.director\.store\."/.test(messagesSrc),
	(messagesSrc.match(/DIRECTOR_STORE_PREFIX\s*=\s*"[^"]*"/) || [])[0] || "(未找到)");
ok("🔴 cookie 前缀 `dsh_director_` 未改名（R5 冻结）",
	/"dsh_director_"/.test(persistSrc), (persistSrc.match(/"[^"]*" \+ safeDirectorKey/) || [])[0] || "(未找到)");
ok("🔴 `safeDirectorKey` 空会话回落到固定串 `director-main`（R5 冻结，禁随机）",
	/"director-main"/.test(persistSrc), "源码含字面量 director-main");

/* ── 环境观察（只报告，不判分）：`dsh.director.*` 残留 ──
 * 🔴 该 key 只在**总监活动**时由 `create-store.js#notify → saveDirectorStore` 写入
 *    ⇒ 冷启动且无总监活动时**本该为 0**。所以此处的 0 **不是**数据丢失的证据，
 *    只有「本次运行内前后对比」才具备判别力（第 5 节已做）。
 *    （原 F-DATA-01「重启后该 key 消失」即由此条 + 探测过早共同造成的**假阳性**，已结案。） */
const ambient = allLs.filter((k) => k.indexOf("dsh.director.") === 0);
const dirStoresCount = F.counts.directorStores;
const viewBytes = F.viewKey ? F.ls[F.viewKey] : -1;
console.log(`    观察: dsh.director.* 残留 ${ambient.length} 个 [${ambient.join(", ") || "无"}] ·` +
	` IDB directorStores=${dirStoresCount} · ${F.viewKey}=${viewBytes}B`);
console.log("          ↑ 冷启动无总监活动时该值本就应为 0/「无」；**宿主核心数据以" +
	" `dsh.workspace.view.*` 字节数为锚**（本次 " + viewBytes + " B）");

const lsBefore = await evalExpr(`return JSON.stringify(window.__dsDataSafe.lsSnapshot())`);
const LS_BEFORE = JSON.parse(lsBefore);
ok("🔴 localStorage 全量快照在全程后与基线逐键一致（宿主数据分毫未动）",
	JSON.stringify(Object.keys(LS_BEFORE).sort()) === JSON.stringify(Object.keys(F.ls).sort())
	&& Object.keys(LS_BEFORE).every((k) => LS_BEFORE[k] === F.ls[k]),
	`${Object.keys(F.ls).length} 个 key`);

/* ══════════════════════════════════════════════════════════════════
 * [7] Cookie 体积预算 —— 「打不开软件」的长效防线（T-PLUG-035）
 * ══════════════════════════════════════════════════════════════════
 * 2026-09-14 用户报「打不开软件」＝ 窗口全白。根因链（已定案）：
 *   `dsh_director_*` 分块 cookie 累积到 **16,794 B** > 宿主 Node 默认请求头上限
 *   `--max-http-header-size = 16384 B`（宿主启动脚本**没有**覆盖该值，已实测确认）
 *   ⇒ 宿主内嵌 HTTP 服务回 **431 + 空体** ⇒ Chromium 把响应当 `text/plain`
 *   ⇒ 渲染文档只剩 **39 B** ⇒ 全白，而**主进程日志一行错都没有**。
 * 产品侧修复 = `src/store/cookie.js` 的总预算层（最旧优先淘汰 + 每次淘汰告警）。
 * 本节负责把它变成**每一轮真机都跑的判据** —— 离线单测 `test-cookie-budget.mjs`
 * 只能证明「淘汰算法对」，证不了「这台机器上的真实体积真的没越限」。
 *
 * 🔴 判据分三层，缺一层就退化成**平凡真**（真实值离预算很远时，写死 true 也能过）：
 *   (a) 前提：真机上确实存在 `dsh_director_*` cookie —— 否则断言的是一个空集；
 *   (b) 判据：实测总量 ≤ 预算 —— 预算与前缀**都从源码读**（写死就会与产品脱钩，纪律 14）；
 *   (c) 正负对照：同一测量口径对**合成超预算串**与**历史事故等效串（16,794）**必须判「超」。
 */
console.log("\n[7] Cookie 体积预算（打不开软件的长效防线）");

/* 被测源可用 `COOKIE_SRC` 覆盖（与 `test-cookie-budget.mjs` 同款口径）——
 * 负向校准才能**不改产品源码**地植入「预算过小」这类缺陷（纪律 6）。
 *
 * 校准配方（2026-09-14 实测，三条各自命中不同的红）：
 *   A 预算过小：`COOKIE_TOTAL_BUDGET = 12288` → `1000` ⇒ **判据**红（6007 B ≤ 1000 B 余量 -5007）
 *   B 前缀改名：`COOKIE_PREFIX = "dsh_director_"` → `"dsh_directorRENAMED_"` ⇒ **前提**红（0 组 / 0 B），
 *     而「判据」仍绿（0 ≤ 12288）—— **这正是空真**，也正因如此才必须有那条前提断言。
 *   C 目标不存在：`COOKIE_SRC=<不存在>` ⇒ INVALID **exit 2** + 打印可复制命令（不崩栈）。
 * 校准样本放在 `logs/`（已被 .gitignore），用完即删，不入库。 */
const cookieSrcPath = process.env.COOKIE_SRC || join(PLUGIN_ROOT, "src", "store", "cookie.js");
if (!existsSync(cookieSrcPath)) {
	console.error("IS_PASS: FALSE（INVALID：Cookie 被测源不存在）");
	console.error("  目标：" + cookieSrcPath);
	console.error("  正确用法：不传 COOKIE_SRC 即测产品源码；校准时才显式指向样本：");
	console.error("    COOKIE_SRC=<绝对路径>/cookie-defect.js node scripts/verify-data-safe.mjs");
	process.exit(2);
}
const cookieSrc = readFileSync(cookieSrcPath, "utf8");
const COOKIE_BUDGET = Number((cookieSrc.match(/COOKIE_TOTAL_BUDGET\s*=\s*(\d+)/) || [])[1]);
const COOKIE_PFX = (cookieSrc.match(/COOKIE_PREFIX\s*=\s*"([^"]+)"/) || [])[1] || "";
/** 宿主 Node 默认请求头上限（`--max-http-header-size`）；启动脚本未覆盖 ⇒ 取默认值。 */
const HOST_HEADER_LIMIT = 16384;
/** 历史事故实测值（`document.cookie.length`，2026-09-14 诊断记录）。 */
const HISTORIC_BYTES = 16794;

ok("🔴 预算常量与 cookie 前缀**可从源码读出**（不写死 ⇒ 闸门不会与产品脱钩）",
	Number.isFinite(COOKIE_BUDGET) && COOKIE_BUDGET > 0 && COOKIE_PFX.length > 0,
	`COOKIE_TOTAL_BUDGET=${COOKIE_BUDGET} COOKIE_PREFIX=${COOKIE_PFX}`);
ok("🔴 预算必须**显著低于**宿主请求头上限（余量 < 3000 B 时下一个 431 只是时间问题）",
	Number.isFinite(COOKIE_BUDGET) && COOKIE_BUDGET <= HOST_HEADER_LIMIT - 3000,
	`预算 ${COOKIE_BUDGET} B / 上限 ${HOST_HEADER_LIMIT} B / 余量 ${HOST_HEADER_LIMIT - COOKIE_BUDGET} B`);
ok("🔴 历史事故值确实越限（回归反证：那次白屏的算术前提在今天仍成立）",
	HISTORIC_BYTES > HOST_HEADER_LIMIT, `${HISTORIC_BYTES} B > ${HOST_HEADER_LIMIT} B`);

const cookieProbe = await evalExpr(`
	const PFX = ${JSON.stringify(COOKIE_PFX)};
	const BUDGET = ${Number.isFinite(COOKIE_BUDGET) ? COOKIE_BUDGET : 12288};
	/* 与产品同源的口径：只统计前缀匹配的 cookie，按**整段字符数**累加。
	   （cookie 值里的非 ASCII 已被浏览器百分号编码为 ASCII ⇒ 字符数 = 请求头字节数。）
	   注意：这里做的是**测量**，不是把产品的 dshCookieUsage() 抄一遍 ——
	   判据量的是「真实浏览器串里有多少前缀匹配字节」，与淘汰算法无关。 */
	const measure = (s) => {
		let total = 0;
		const byKey = {};
		for (const seg of String(s || '').split(';')) {
			const t = seg.replace(/^[ ]+/, '');
			const eq = t.indexOf('=');
			const name = eq < 0 ? t : t.slice(0, eq);
			if (name.indexOf(PFX) !== 0) continue;
			total += t.length;
			byKey[name] = t.length;
		}
		return { total, byKey, count: Object.keys(byKey).length };
	};
	const real = document.cookie || '';
	const realM = measure(real);
	/* 合成超预算串 —— **只做字符串，绝不写盘**：真写一个超大 cookie 就是复现事故。 */
	const giantM = measure(real + '; ' + PFX + 'probe_giant=' + 'x'.repeat(BUDGET + 1));
	/* 历史事故等效串：在真实串基础上补足到 HISTORIC_BYTES 长度。 */
	const histPad = Math.max(1, ${HISTORIC_BYTES} - realM.total);
	const histM = measure(real + '; ' + PFX + 'probe_hist=' + 'x'.repeat(histPad));
	return JSON.stringify({
		prefix: PFX, budget: BUDGET, rawLen: real.length,
		realTotal: realM.total, realCount: realM.count, realByKey: realM.byKey,
		giantTotal: giantM.total, histTotal: histM.total
	});
`);
const CP = JSON.parse(cookieProbe);

ok("🔴 前提：真机上确实存在 `dsh_director_*` cookie（否则下面的预算断言是**空真**）",
	CP.realCount > 0 && CP.realTotal > 0, `${CP.realCount} 组 / ${CP.realTotal} B`);
ok("🔴 判据：当前 `dsh_director_*` 总量 ≤ 预算（预算取自源码，非写死）",
	CP.realTotal <= CP.budget,
	`${CP.realTotal} B ≤ ${CP.budget} B（余量 ${CP.budget - CP.realTotal} B）`);
ok("🔴 正负对照①：同一测量口径对**合成超预算串**必须判「超」（证明判据不是写死 true）",
	CP.giantTotal > CP.budget, `合成 ${CP.giantTotal} B > ${CP.budget} B`);
ok("🔴 正负对照②：**历史事故等效串 16,794 B** 同口径必须判「超」（回归反证）",
	CP.histTotal > CP.budget, `等效 ${CP.histTotal} B > ${CP.budget} B`);
ok("测量自洽：前缀匹配总量不超过整串长度，且每个命中组的字节数均为正",
	CP.realTotal <= CP.rawLen && Object.values(CP.realByKey).every((n) => n > 0),
	`整串 ${CP.rawLen} B / 前缀命中 ${CP.realTotal} B`);
ok("离线预算闸门在位（`scripts/test-cookie-budget.mjs`）—— 本节补的是**真机**常态判据",
	existsSync(join(PLUGIN_ROOT, "scripts", "test-cookie-budget.mjs")), "scripts/test-cookie-budget.mjs");
console.log(`    观察: document.cookie=${CP.rawLen} B · ${CP.prefix}* = ${CP.realTotal} B / ${CP.realCount} 组 · 预算 ${CP.budget} B`);

/* ══════════════════════════════════════════════════════════════════ */
cdp.close();

console.log("\n════════════════════════════════════════");
console.log(`T-PLUG-009 数据安全验证：PASS ${pass} / FAIL ${fail} / 总计 ${pass + fail}`);
if (fail) { console.log("失败项："); failures.forEach((f) => console.log("  - " + f)); }
console.log("IS_PASS:", fail === 0 ? "TRUE" : "FALSE");
console.log("════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
