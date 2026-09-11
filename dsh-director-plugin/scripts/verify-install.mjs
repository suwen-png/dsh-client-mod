/**
 * verify-install.mjs — 插件安装链路离线验证（T-PLUG-005 批次 1+2）
 *
 * 目的：在**不启动 Harness** 的前提下，用官方模块真跑一遍安装链路，
 *       提前暴露「声明不合规 / bundle 路径解析失败 / bundle 缺失」三类致命错误，
 *       避免带病启动导致 Harness FAIL LOUD 无法启动。
 *
 * 验证链路（全部使用官方实现，非自研复刻）：
 *   ① @deepseek-ai/dsh-app-boot  → loadProfile / composeEntries
 *   ② @deepseek-ai/dsh-client-modules → ClientModuleRegistry / injectBootManifest
 *   ③ 本包 host face → 动态 import 并执行 apply()
 *   ④ 本包 client bundle → 在 __ModuleLoader__ 桩中执行 factory
 *
 * 用法：node scripts/verify-install.mjs
 * 退出码：0 = 全通过；1 = 存在失败项
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || "", ".dsh");
const HOST = process.env.DSH_HOST_ANCHOR || "D:/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness/resources/host";
const PROFILE_NAME = "web";
const PLUGIN_ID = "deepseek-ai.director";
const PLUGIN_PKG = "@deepseek-ai/dsh-director-plugin";

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail = "") {
	if (ok) {
		pass++;
		console.log(`  ✓ ${label}${detail ? "  — " + detail : ""}`);
	} else {
		fail++;
		failures.push(label);
		console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`);
	}
}

console.log("========================================");
console.log(" 插件安装链路离线验证");
console.log(` HOME    : ${HOME}`);
console.log(` HOST    : ${HOST}`);
console.log(` PROFILE : ${PROFILE_NAME}`);
console.log("========================================\n");

// ── 0. 静态文件面 ──
console.log("[0] 静态文件面");
const profileDir = join(HOME, "profiles", PROFILE_NAME);
const profilePkg = join(profileDir, "package.json");
const profilePatch = join(profileDir, "cordis.patch.yml");
const installedPkg = join(HOST, "node_modules", PLUGIN_PKG, "package.json");
const installedClient = join(HOST, "node_modules", PLUGIN_PKG, "lib", "client.js");
const installedHost = join(HOST, "node_modules", PLUGIN_PKG, "lib", "index.js");
const assetsJson = join(HOST, "node_modules", PLUGIN_PKG, "assets", "docs-index.json");

check("profile package.json 存在", existsSync(profilePkg));
check("profile cordis.patch.yml 存在", existsSync(profilePatch));
check("插件包已安装到 host node_modules", existsSync(installedPkg));
check("host face lib/index.js 存在", existsSync(installedHost));
check("client bundle lib/client.js 存在", existsSync(installedClient));
check("A14 资源 assets/docs-index.json 存在", existsSync(assetsJson));

if (!existsSync(profilePkg) || !existsSync(installedPkg)) {
	console.log("\n致命：基础文件缺失，后续验证无法进行。");
	process.exit(1);
}

// profile 侧可解析（Node 解析链：profiles/web/node_modules → profiles/node_modules）
const rq = createRequire(join(profileDir, "index.js"));
let resolvedPkg = null;
let resolvedClient = null;
try {
	resolvedPkg = rq.resolve(`${PLUGIN_PKG}/package.json`);
} catch { /* 下文断言 */ }
try {
	resolvedClient = rq.resolve(`${PLUGIN_PKG}/client`);
} catch { /* 下文断言 */ }
check("profile 可解析插件包 (Node 解析链)", Boolean(resolvedPkg), resolvedPkg || "解析失败");
check("profile 可解析 ./client 子路径导出", Boolean(resolvedClient), resolvedClient || "解析失败");

// ── 1. 官方 loader：loadProfile + composeEntries ──
console.log("\n[1] @deepseek-ai/dsh-app-boot（官方实现）");
let composed = [];
try {
	const boot = await import(pathToFileURL(join(HOST, "node_modules/@deepseek-ai/dsh-app-boot/lib/index.js")).href);
	const profile = boot.loadProfile("desktop", PROFILE_NAME, join(HOST, "package.json"), HOME);
	check("loadProfile 成功", true, `dir=${profile.dir}`);
	check("profile bundle 层数", profile.layers.length >= 3, `${profile.layers.length} 层: ${profile.layers.map((l) => l.packageName).join(", ")}`);
	check("内置应用 bundle 可解析", profile.layers.some((l) => l.packageName === "@fufan/dsh-plugin-llm-wiki"));

	// 用户补丁层（本插件插单位置）
	check("用户补丁层已加载", profile.patches.length > 0, `${profile.patches.length} 条 patch`);

	const entryTree = boot.composeEntries([...profile.layers.map((l) => l.patches), profile.patches]);
	composed = entryTree;
	check("composeEntries 产出 entry 树", entryTree.length > 0, `${entryTree.length} entries`);

	// 防重：本插件 entry id 必须唯一（重复 insert 会被 loader 判为冲突）
	const flatEntries = JSON.stringify(entryTree);
	const idCount = (flatEntries.match(new RegExp(PLUGIN_ID.replace(/\./g, "\\."), "g")) || []).length;
	check(`本插件 entry id 已进入 entry 树`, flatEntries.includes(PLUGIN_ID), PLUGIN_ID);
	check(`本插件 entry id 无重复`, idCount >= 1, `出现 ${idCount} 次`);
	check(`本插件包名已进入 entry 树`, flatEntries.includes(PLUGIN_PKG), PLUGIN_PKG);
} catch (error) {
	check("loadProfile / composeEntries", false, String(error.message || error));
}

// ── 2. 官方 client-modules：ClientModuleRegistry + injectBootManifest ──
console.log("\n[2] @deepseek-ai/dsh-client-modules（官方实现）");
let manifestHtml = "";
try {
	const cm = await import(pathToFileURL(join(HOST, "node_modules/@deepseek-ai/dsh-client-modules/lib/index.js")).href);
	const cordis = await import(pathToFileURL(join(HOST, "node_modules/@deepseek-ai/cordis/lib/index.js")).href);

	// 用**真实 cordis Context**（Service 基类要求 ctx.reflect.provide）
	const registeredRoutes = [];
	const tappedIndex = [];
	const stubEntries = [{ options: { name: PLUGIN_PKG }, fiber: {}, disabled: false }];

	const ctx = new cordis.Context();
	ctx.logger = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
	ctx.baseUrl = join(profileDir, "package.json");
	ctx.provide("loader", { entries: () => stubEntries });
	ctx.provide("webServer", {
		register: (r) => { registeredRoutes.push(r); return () => {}; },
		tapIndex: (fn) => { tappedIndex.push(fn); return () => {}; }
	});

	const registry = new cm.ClientModuleRegistry(ctx);
	const graph = registry.graph();
	const entry = graph.entries.find((e) => e.id === PLUGIN_PKG);

	check("ClientModuleRegistry 构造未抛错", true);
	check("本插件已进入 client 模块图", Boolean(entry), entry ? `rev=${entry.rev}` : "未发现");
	check("bundle 路由 /plugins 已注册", registeredRoutes.some((r) => r.path === "/plugins"));
	check("index 注入 tap 已挂载", tappedIndex.length > 0, `${tappedIndex.length} 个 tap`);

	if (entry) {
		const clientPath = registry.clientPath(PLUGIN_PKG);
		check("clientPath 解析到实际文件", Boolean(clientPath) && existsSync(clientPath), clientPath || "");
		const bytes = readFileSync(clientPath).length;
		check("bundle 体积合理", bytes > 1000, `${bytes} B`);
	}

	// boot manifest 注入：验证 __DSH_BOOT__ 确实被写进 index HTML
	const out = cm.injectBootManifest("<html><head></head><body></body></html>", graph);
	manifestHtml = out;
	check("injectBootManifest 产出 __DSH_BOOT__", out.includes("__DSH_BOOT__"));
	check("__DSH_BOOT__ 含本插件条目", out.includes(PLUGIN_PKG));
	check("boot 清单含 /plugins/ 路由前缀", out.includes("/plugins/"));
} catch (error) {
	check("ClientModuleRegistry 链路", false, String(error.message || error));
}

// ── 3. host face 动态加载 + apply() ──
console.log("\n[3] host face（cordis 插件契约）");
try {
	const mod = await import(pathToFileURL(installedHost).href);
	check("host face 可动态 import", true, Object.keys(mod).join(", "));
	check("导出 apply 为函数", typeof mod.apply === "function");
	check("导出 inject 为数组", Array.isArray(mod.inject));
	let applied = false;
	let logs = [];
	mod.apply({ logger: () => ({ info: (m) => { applied = true; logs.push(m); } }) });
	check("apply() 执行成功", applied, logs.join(" | "));
} catch (error) {
	check("host face 加载", false, String(error.message || error));
}

// ── 4. client bundle 在 __ModuleLoader__ 桩中执行 ──
console.log("\n[4] client bundle（__ModuleLoader__ 契约）");
try {
	const code = readFileSync(installedClient, "utf8");
	const win = globalThis;
	const loaded = [];
	win.window = win;
	win.__ModuleLoader__ = { load: (rec) => loaded.push(rec) };
	// 提供浏览器全局
	win.URL = win.URL || URL;
	win.location = win.location || { href: "http://localhost/", origin: "http://localhost" };
	/* 提供浏览器全局。
	 * 🔴 桩必须覆盖 bundle 求值期真正会用到的 API：批次 9 的 `installSplitApi()`
	 *    → `isSplitActive()` → `document.getElementById`，`mountHierarchy()` →
	 *    `getElementById` + `createElement().appendChild` + `document.body`。
	 *    缺任一 API 会使「bundle 执行」这条断言以 `xxx is not a function` 假失败
	 *    （与插件实现无关，属桩的覆盖面不足）。 */
	win.document = win.document || (() => {
		const mkEl = () => ({
			style: {}, children: [], attrs: {},
			setAttribute: () => { }, getAttribute: () => null, removeAttribute: () => { },
			appendChild: () => { }, remove: () => { },
			addEventListener: () => { }, removeEventListener: () => { },
			querySelector: () => null, querySelectorAll: () => []
		});
		const head = { appendChild: () => { }, children: [], querySelector: () => null, querySelectorAll: () => [] };
		const body = { appendChild: () => { }, children: [], querySelector: () => null, querySelectorAll: () => [] };
		return {
			head, body, documentElement: mkEl(), readyState: "complete",
			createElement: mkEl,
			createTextNode: () => ({}),
			getElementById: () => null,
			querySelector: () => null,
			querySelectorAll: () => [],
			addEventListener: () => { }, removeEventListener: () => { }
		};
	})();
	win.getComputedStyle = win.getComputedStyle || (() => ({ overflowX: "visible" }));
	win.matchMedia = win.matchMedia || (() => ({ matches: false, addEventListener: () => { }, removeEventListener: () => { } }));
	win.CustomEvent = win.CustomEvent || class CustomEvent { constructor(t, i) { this.type = t; this.detail = i?.detail; } };
	// 事件桩：批次 3 的 installBeforeUnloadSave() 会注册 window "beforeunload"
	// （宿主 client.js:6409 同款行为），离线环境须补该浏览器全局。
	const winListeners = new Map();
	win.addEventListener = (type, fn) => {
		if (!winListeners.has(type)) winListeners.set(type, []);
		winListeners.get(type).push(fn);
	};
	win.removeEventListener = (type, fn) => {
		const arr = winListeners.get(type) || [];
		const i = arr.indexOf(fn);
		if (i >= 0) arr.splice(i, 1);
	};
	win.dispatchEvent = () => true;

	// 执行 bundle（顶层只调用 __ModuleLoader__.load）
	new Function("window", "document", "URL", code)(win, win.document, win.URL);

	check("bundle 调用了 __ModuleLoader__.load", loaded.length === 1);
	if (loaded.length === 1) {
		const rec = loaded[0];
		check("bundle id 正确", rec.id === PLUGIN_PKG, rec.id);
		check("bundle factory 为函数", typeof rec.factory === "function");
		// 平台模块桩：严格对齐官方 getStaticModules()（dsh-client-web/lib/index.js:165 的 10 项）
		const platformStub = {
			"react": { useCallback: () => {}, useSyncExternalStore: () => ({}) },
			"react/jsx-runtime": {}, "react-dom": {}, "react-dom/client": {},
			"@deepseek-ai/cordis": {},
			"@deepseek-ai/dsh-client-ui-slots": {},
			"@deepseek-ai/dsh-client-web-react": {},
			"@deepseek-ai/dsh-client-ui-primitives": {},
			"@deepseek-ai/dsh-client-ui-attachment": {},
			"@deepseek-ai/dsh-client-schema-form": {}
		};
		const requireCalls = [];
		const requireStub = (name) => {
			requireCalls.push(name);
			if (!(name in platformStub)) throw new Error(`require 请求了平台表外模块: ${name}`);
			return platformStub[name];
		};
		const exportsObj = rec.factory(requireStub);
		check("factory 执行成功", Boolean(exportsObj));
		check("factory 仅 require 平台表内模块", requireCalls.every((n) => n in platformStub),
			`请求: [${requireCalls.join(", ") || "无"}]`);
		check("factory 请求了 react 系列平台模块（批次 3+5）",
			requireCalls.includes("react") && requireCalls.includes("react/jsx-runtime"),
			`[${requireCalls.join(", ")}]`);
		check("factory 导出 apply", typeof exportsObj?.apply === "function");

		// factory（模块求值）阶段即挂载的契约：store/config 在构造时自挂 window
		const moduleScope = ["__directorLayoutStore", "__dshTheme", "__directorConfig"];
		const missMod = moduleScope.filter((k) => win[k] === undefined);
		check("模块求值期契约已挂载", missMod.length === 0,
			missMod.length ? "缺: " + missMod.join(", ") : `${moduleScope.length} 项`);

		// ★ 关键修正：apply() 才会装配批次 1 的调试/日志/探针层
		//   （先前版本漏调 apply，导致误判为失败）
		if (typeof exportsObj?.apply === "function") {
			exportsObj.apply({});
			const applyScope = ["__dshDebug", "__dshV9Log", "__dshLayoutProbe", "__dshDirectorBatch1"];
			const missApp = applyScope.filter((k) => win[k] === undefined);
			check("apply() 后契约已挂载", missApp.length === 0,
				missApp.length ? "缺: " + missApp.join(", ") : `${applyScope.length} 项`);

			// 异步层：__dshDocsIndex 走 fetch（离线环境应优雅降级，不得抛错）
			await new Promise((r) => setTimeout(r, 300));
			check("离线降级：__dshDocsIndex 缺省不报错",
				win.__dshDocsIndex === undefined || typeof win.__dshDocsIndex === "object",
				win.__dshDocsIndex === undefined ? "未注入（预期，离线）" : "已注入");

			// ── 批次 3（持久化层）──
			const b3 = ["__directorPersistState", "__dshDirectorBatch3"];
			const miss3 = b3.filter((k) => win[k] === undefined);
			check("批次 3 全局契约已挂载", miss3.length === 0,
				miss3.length ? "缺: " + miss3.join(", ") : `${b3.length} 项`);
			const inst = win.__dshDirectorBatch3;
			check("installed.persistState / storeFactory / hook",
				Boolean(inst && inst.persistState && inst.storeFactory && inst.hook),
				inst ? `persistState=${inst.persistState} storeFactory=${inst.storeFactory} hook=${inst.hook}` : "无");
			check("legacyRequire 实测为空（T5 结论）",
				Boolean(inst && Array.isArray(inst.legacyRequire) && inst.legacyRequire.length === 0),
				inst ? `[${(inst.legacyRequire || []).join(", ")}]` : "无");
			// beforeUnload 双语义：离线环境无宿主抢占同名守卫 → 新注册应为 true，
			// 且「能力就绪」判据 beforeUnloadRegistered 必为 true。
			check("installed.beforeUnload（离线新注册）",
				Boolean(inst && inst.beforeUnload === true), inst ? String(inst.beforeUnload) : "无");
			check("installed.beforeUnloadRegistered（能力就绪）",
				Boolean(inst && inst.beforeUnloadRegistered === true), inst ? String(inst.beforeUnloadRegistered) : "无");
			check("文件通道三字段已定性（fileChannel/opfs/fsa）",
				Boolean(inst && typeof inst.fileChannel === "boolean" && typeof inst.opfs === "boolean" && typeof inst.fsa === "boolean"),
				inst ? `fileChannel=${inst.fileChannel} opfs=${inst.opfs} fsa=${inst.fsa}` : "无");
			check("beforeunload 监听器已注册到 window",
				(winListeners.get("beforeunload") || []).length >= 1,
				`beforeunload handler = ${(winListeners.get("beforeunload") || []).length}`);

			// ── 批次 4（逻辑层）──
			const b4 = ["__dshDirectorBatch4", "__dshDirectorProcess", "__dshDirectorReviewReturn"];
			const miss4 = b4.filter((k) => win[k] === undefined);
			check("批次 4 全局契约已挂载", miss4.length === 0,
				miss4.length ? "缺: " + miss4.join(", ") : `${b4.length} 项`);
			check("installed.directorProcess / directorReview",
				Boolean(inst && inst.directorProcess === true && inst.directorReview === true),
				inst ? `process=${inst.directorProcess} review=${inst.directorReview}` : "无");
			check("D2 有意不接线（directorReviewWired === false）",
				Boolean(inst && inst.directorReviewWired === false),
				inst ? String(inst.directorReviewWired) : "无");
			check("window.__dshDirectorProcess 为函数", typeof win.__dshDirectorProcess === "function",
				typeof win.__dshDirectorProcess);
			check("window.__dshDirectorReviewReturn 为函数", typeof win.__dshDirectorReviewReturn === "function",
				typeof win.__dshDirectorReviewReturn);
			// D1 契约可调用性抽查：并发锁分支（status=processing 时应早退且不抛错）
			if (typeof win.__dshDirectorProcess === "function") {
				let lockOk = false, lockErr = null;
				try {
					const fakeStore = {
						getState: () => ({ config: {}, status: "processing", messages: [] }),
						addMessage: () => {},
						setStatus: () => {}
					};
					await win.__dshDirectorProcess("s1", "测试", fakeStore, null, null);
					lockOk = true;
				} catch (e) { lockErr = e; }
				check("D1 并发锁分支可执行（processing 时早退）", lockOk,
					lockErr ? "异常: " + lockErr.message : "早退无异常");
			}

			// ── 批次 5（组件层）──
			const b5 = ["__dshDirectorBatch5", "__dshDirectorFlow"];
			const miss5 = b5.filter((k) => win[k] === undefined);
			check("批次 5 全局契约已挂载", miss5.length === 0,
				miss5.length ? "缺: " + miss5.join(", ") : `${b5.length} 项`);
			check("installed.directorFlow",
				Boolean(inst && inst.directorFlow === true), inst ? String(inst.directorFlow) : "无");
			check("directorFlowWired === false（批次 6 接线）",
				Boolean(inst && inst.directorFlowWired === false), inst ? String(inst.directorFlowWired) : "无");
			check("🔴 迁移期修正标记已置位",
				Boolean(inst && inst.directorFlowFixedFilteredMessages === true),
				inst ? String(inst.directorFlowFixedFilteredMessages) : "无");
			check("window.__dshDirectorFlow 为函数（组件）",
				typeof win.__dshDirectorFlow === "function", typeof win.__dshDirectorFlow);
			// 🔴 反证：组件源码不得含越界引用（**不实际调用** —— 组件含 hooks，需 React 渲染上下文）
			//    ⚠️ toString() 会连注释一起返回，注释中刻意引用了宿主原代码 → 先剥离注释
			const flowFnSrc = typeof win.__dshDirectorFlow === "function" ? win.__dshDirectorFlow.toString() : "";
			const flowFnCode = String(flowFnSrc).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
			check("🔴 组件源码零 filteredMessages 引用（剥离注释后）", !/filteredMessages\s*\./.test(flowFnCode), "零命中");
			check("组件源码含 state.messages.map（修正已落地）", flowFnCode.includes("state.messages.map"), "已改用 state.messages");
			// 🔴 关键不变量：空 sessionId → 固定 key（V9 修复点）
			const entryMod = exportsObj.__entry;
			check("safeDirectorKey(空) === 'director-main'",
				entryMod?.safeDirectorKey && entryMod.safeDirectorKey() === "director-main",
				entryMod?.safeDirectorKey ? entryMod.safeDirectorKey() : "无导出");
		}
	}
} catch (error) {
	check("client bundle 执行", false, String(error.message || error));
}

// ── 汇总 ──
console.log("\n========================================");
console.log(` 总计: ${pass + fail}  通过: ${pass}  失败: ${fail}`);
if (fail > 0) console.log(` 失败项: ${failures.join(" / ")}`);
console.log(` IS_PASS: ${fail === 0 ? "YES" : "NO"}`);
console.log("========================================");

process.exit(fail === 0 ? 0 : 1);
