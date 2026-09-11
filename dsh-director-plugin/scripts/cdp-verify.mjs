/**
 * cdp-verify.mjs — 通过 CDP 核查插件在 Harness 渲染进程中的真实加载状态
 *
 * 前置：Harness 以 `--remote-debugging-port=9222` 启动
 *       （注意：必须清除 ELECTRON_RUN_AS_NODE，否则 Electron 退化为 Node 并拒绝该开关）
 *
 * 用法：node scripts/cdp-verify.mjs [port]
 * 退出码：0 = 全通过；1 = 存在失败项
 *
 * 零依赖：Node 22 原生 fetch + 全局 WebSocket。
 */
const PORT = Number(process.argv[2] || 9222);
const PLUGIN_PKG = "@deepseek-ai/dsh-director-plugin";

let pass = 0;
let fail = 0;
const failures = [];
function check(label, ok, detail = "") {
	if (ok) { pass++; console.log(`  ✓ ${label}${detail ? "  — " + detail : ""}`); }
	else { fail++; failures.push(label); console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}

/** 打开一个目标页的 CDP 会话。 */
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
						setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); rej(new Error(method + " timeout")); } }, 15000);
					});
				},
				close() { try { ws.close(); } catch {} }
			});
		});
	});
}

console.log("========================================");
console.log(" 插件运行时核查（CDP）");
console.log(` 端口: ${PORT}`);
console.log("========================================\n");

// ── 0. 连接 ──
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
console.log("[0] 浏览器");
check("CDP 可达", Boolean(version.Browser), version.Browser);
check("是 DSH 桌面端", String(version["User-Agent"] || "").includes("dsh-desktop"),
	(version["User-Agent"] || "").split(" ").slice(-2).join(" "));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = targets.filter((t) => t.type === "page");
console.log(`  · 目标 ${targets.length} 个，页面 ${pages.length} 个`);
pages.forEach((p) => console.log(`     - ${(p.title || "").slice(0, 40)} | ${(p.url || "").slice(0, 70)}`));

// ── 1. 页面内核查 ──
console.log("\n[1] 页面运行时");
if (pages.length === 0) {
	check("存在页面目标", false, "无 page 目标");
} else {
	// 选 DSH 应用页（非 devtools）
	const page = pages.find((p) => !/devtools/.test(p.url)) || pages[0];
	const cdp = await connect(page.webSocketDebuggerUrl);
	await cdp.send("Runtime.enable");

	const evaluate = async (expr, awaitPromise = false) => {
		const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
		if (r.exceptionDetails) return { __err: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || "") };
		return r.result?.value;
	};

	check("页面 URL", true, page.url);

	// ① boot 清单
	const bootRaw = await evaluate("JSON.stringify(window.__DSH_BOOT__ ? window.__DSH_BOOT__.entries.map(e=>e.id) : null)");
	let bootIds = null;
	try { bootIds = bootRaw ? JSON.parse(bootRaw) : null; } catch {}
	check("__DSH_BOOT__ 已注入", Array.isArray(bootIds), Array.isArray(bootIds) ? `${bootIds.length} entries` : String(bootRaw));
	check(`boot 清单含 ${PLUGIN_PKG}`, Array.isArray(bootIds) && bootIds.includes(PLUGIN_PKG));

	// ② 批次 1~3 全局契约
	const contracts = ["__dshDebug", "__dshV9Log", "__dshDirectorBatch1", "__directorLayoutStore", "__dshTheme", "__directorConfig", "__directorPersistState"];
	for (const k of contracts) {
		const v = await evaluate(`typeof window.${k}`);
		check(`契约 window.${k}`, v !== "undefined", String(v));
	}

	// ③ installBatch1 返回结构（含批次 3 字段）
	const batch = await evaluate("window.__dshDirectorBatch1 ? JSON.stringify(window.__dshDirectorBatch1) : null");
	console.log(`     __dshDirectorBatch1 = ${batch}`);
	if (batch) {
		let b = null;
		try { b = JSON.parse(batch); } catch {}
		check("批次 1+2 各层均已装载", Boolean(b && b.debug && b.v9Log && b.layoutStore && b.themeStore && b.config
			&& b.messageStore && b.branchApi && b.docsStore));
		// beforeUnload 判定口径：宿主内联代码用同名守卫且先执行，故「未新注册」属幂等守卫
		// 按设计生效（假阴性）。能力就绪判据 = beforeUnload || beforeUnloadRegistered。
		check("批次 3 持久化层已装载", Boolean(b && b.persistState && b.storeFactory && b.hook
			&& (b.beforeUnload || b.beforeUnloadRegistered)),
			b ? `persistState=${b.persistState} storeFactory=${b.storeFactory} hook=${b.hook} beforeUnload=${b.beforeUnload} beforeUnloadRegistered=${b.beforeUnloadRegistered}` : "");
		check("legacyRequire 实测为空（T5）", Boolean(b && Array.isArray(b.legacyRequire) && b.legacyRequire.length === 0),
			b ? `[${(b.legacyRequire || []).join(", ")}]` : "");
		check("beforeunload 兜底保存已注册（宿主或插件）", Boolean(b && b.beforeUnloadRegistered === true),
			b ? `guard=${b.beforeUnloadRegistered}` : "");
		check("文件通道探测已定性（fileChannel/opfs/fsa 三字段存在）",
			Boolean(b && typeof b.fileChannel === "boolean" && typeof b.opfs === "boolean" && typeof b.fsa === "boolean"),
			b ? `fileChannel=${b.fileChannel} opfs=${b.opfs} fsa=${b.fsa}` : "");
	}

	// ④ 持久化通道真实能力（真机值，非桩）
	const channels = await evaluate(`JSON.stringify({
		opfs: typeof navigator.storage?.getDirectory === "function",
		fsa: typeof window.showSaveFilePicker === "function" && typeof window.showOpenFilePicker === "function",
		showDirectoryPicker: typeof window.showDirectoryPicker === "function",
		dshDesktop: typeof window.dshDesktop,
		dshDesktopWorkspace: typeof window.dshDesktop?.workspace?.pickDirectory,
		legacyWindowRequire: typeof window.require
	})`);
	console.log(`     持久化通道 = ${channels}`);
	if (channels) {
		let c = null;
		try { c = JSON.parse(channels); } catch {}
		check("OPFS 可用（免手势持久层）", c?.opfs === true);
		check("FSA 可用（showSaveFilePicker + showOpenFilePicker）", c?.fsa === true);
		check("dshDesktop 桌面桥存在", c?.dshDesktop === "object");
		check("legacy window.require 不可达（T5 反证）", c?.legacyWindowRequire === "undefined", String(c?.legacyWindowRequire));
	}

	// ④ docs 索引（A14 外置资源经插件加载）
	const docCount = await evaluate("window.__dshDocsIndex ? (window.__dshDocsIndex.docCount || Object.keys(window.__dshDocsIndex.docs||{}).length) : -1");
	check("__dshDocsIndex 已由插件注入（A14 外置资源）", Number(docCount) > 0, `docCount=${docCount}`);

	// ⑤ bundle 资源可达性
	const bundleStatus = await evaluate(
		`(async () => { try { const r = await fetch("/plugins/${PLUGIN_PKG}/client.js"); return r.status; } catch (e) { return -1; } })()`,
		true
	);
	check("client bundle 路由可访问", bundleStatus === 200, `HTTP ${bundleStatus}`);

	// ⑥ 宿主原实现是否仍在（未破坏）
	const hostIntact = await evaluate("typeof window.__dshShowToast");
	check("宿主既有契约未被破坏 (__dshShowToast)", hostIntact !== "undefined", String(hostIntact));

	cdp.close();
}

console.log("\n========================================");
console.log(` 总计: ${pass + fail}  通过: ${pass}  失败: ${fail}`);
if (fail > 0) console.log(` 失败项: ${failures.join(" / ")}`);
console.log(` IS_PASS: ${fail === 0 ? "YES" : "NO"}`);
console.log("========================================");

process.exit(fail === 0 ? 0 : 1);
