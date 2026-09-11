/**
 * verify-bundle.mjs — 插件 bundle 端到端执行验证（无浏览器依赖）
 *
 * 原理：在 Node 中**模拟** Harness 浏览器侧的 __ModuleLoader__ 契约，
 * 提供最小 window/document/localStorage/IDB 桩，加载 lib/client.js，
 * 断言：
 *   1. bundle 可被 __ModuleLoader__.load 接收（id/factory 形态正确）
 *   2. factory 可执行且返回 { apply, inject }
 *   3. apply(ctx) 执行后，批次 1+2 的全局契约全部挂到 window 上
 *   4. installBatch1 的返回值结构正确
 *
 * 这是「不改动宿主、不启动 Harness」即可获得的最高保真验证。
 * 真正的端到端（插件在 Harness 内被加载）仍需安装后重启验证。
 *
 * 用法：node scripts/verify-bundle.mjs
 * 退出码：0 = 全通过；1 = 有失败
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import vm from "node:vm";

const ROOT = resolve(import.meta.dirname, "..");
const BUNDLE = join(ROOT, "lib/client.js");

const results = [];
const check = (name, pass, evidence) => {
	results.push({ name, pass });
	console.log((pass ? "  PASS  " : "  FAIL  ") + name + "  |  " + evidence);
};

console.log("\n=== 插件 bundle 执行验证 ===\n");

if (!existsSync(BUNDLE)) {
	console.error("  FAIL  lib/client.js 不存在 —— 请先运行 node build/build.mjs");
	process.exit(1);
}
const src = readFileSync(BUNDLE, "utf8");
check("lib/client.js 存在", true, statSync(BUNDLE).size + " B");

/* ── 1. 构建最小浏览器环境桩 ─────────────────────────────────── */

const styleTags = [];
const createdEls = [];

const documentStub = {
	head: { appendChild: (el) => styleTags.push(el) },
	body: { appendChild: (el) => createdEls.push(el) },
	getElementById: () => null,
	createElement: (tag) => ({
		tagName: tag.toUpperCase(), id: "", style: { cssText: "", opacity: "" },
		dataset: {}, textContent: "", appendChild: () => {},
	}),
	querySelector: () => null,
};

const windowStub = {
	document: documentStub,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => true,
	location: { href: "http://localhost/", origin: "http://localhost", protocol: "http:", host: "localhost" },
	navigator: { userAgent: "node-verify" },
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (id) => clearTimeout(id),
	console,
	CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
	fetch: () => Promise.reject(new Error("no network in verify")),
	indexedDB: undefined,
	localStorage: undefined,
};

const sandbox = {
	window: windowStub,
	document: documentStub,
	console,
	setTimeout,
	clearTimeout,
	Promise,
	Object,
	Array,
	String,
	Number,
	Boolean,
	Math,
	Date,
	JSON,
	RegExp,
	Error,
	Map,
	Set,
	Symbol,
	CustomEvent: windowStub.CustomEvent,
	// 浏览器全局（插件源码合法使用，Node 沙箱需显式提供）
	URL,
	URLSearchParams,
	location: windowStub.location,
	navigator: windowStub.navigator,
	fetch: windowStub.fetch,
	indexedDB: undefined,
	localStorage: undefined,
	// 让 globalThis 上的自引用也指向 windowStub
	globalThis: undefined,
};
sandbox.globalThis = sandbox;
sandbox.self = windowStub;
sandbox.window.window = windowStub;

/* ── 2. 捕获 __ModuleLoader__.load 调用 ──────────────────────── */

let captured = null;
windowStub.__ModuleLoader__ = {
	load: (def) => {
		captured = def;
		return def;
	},
};

/* ── 3. 执行 bundle ─────────────────────────────────────────── */

let loadError = null;
try {
	const ctx = vm.createContext(sandbox);
	vm.runInContext(src, ctx, { filename: "lib/client.js" });
} catch (e) {
	loadError = e;
}
check("bundle 可执行且调用 __ModuleLoader__.load", loadError === null && captured !== null,
	loadError ? "异常: " + loadError.message : captured ? "已捕获 load 定义" : "未捕获");

if (captured) {
	check("load.id 为包名", captured.id === "@deepseek-ai/dsh-director-plugin", `id = ${captured.id}`);
	check("load.factory 为函数", typeof captured.factory === "function", typeof captured.factory);
}

/* ── 4. 执行 factory（按官方 getStaticModules() 提供平台模块桩）──── */

/**
 * 平台模块桩表 —— 严格对齐 `@deepseek-ai/dsh-client-web/lib/index.js` 的
 * `getStaticModules()`（第 165 行）返回的 10 项。
 * 批次 3 起，`store/use-store.js` 会 `require("react")`，故必须提供。
 */
const platformStub = {
	"react": { useCallback: () => {}, useSyncExternalStore: () => ({}), useState: () => [null, () => {}] },
	"react/jsx-runtime": {},
	"react-dom": {},
	"react-dom/client": {},
	"@deepseek-ai/cordis": {},
	"@deepseek-ai/dsh-client-ui-slots": {},
	"@deepseek-ai/dsh-client-web-react": {},
	"@deepseek-ai/dsh-client-ui-primitives": {},
	"@deepseek-ai/dsh-client-ui-attachment": {},
	"@deepseek-ai/dsh-client-schema-form": {}
};
const requireCalls = [];

let exportsObj = null;
let factoryError = null;
if (captured) {
	try {
		exportsObj = captured.factory((name) => {
			requireCalls.push(name);
			if (!(name in platformStub)) {
				throw new Error(`require 请求了平台表外的模块: ${name}`);
			}
			return platformStub[name];
		});
	} catch (e) {
		factoryError = e;
	}
}
check("factory 可执行", factoryError === null, factoryError ? "异常: " + factoryError.message : "OK");
check("require 仅请求平台表内模块", requireCalls.every((n) => n in platformStub),
	`请求: [${requireCalls.join(", ") || "无"}]`);
check("React 未被误打包（仅经 require 获取）",
	requireCalls.includes("react") || requireCalls.length === 0,
	requireCalls.includes("react") ? "已按 ADR-001 经 require 获取" : "本批次未使用 React");
check("factory 返回 exports.apply", typeof exportsObj?.apply === "function", typeof exportsObj?.apply);
check("factory 返回 exports.inject", Array.isArray(exportsObj?.inject), JSON.stringify(exportsObj?.inject));

/* ── 5. 执行 apply() —— 验证全局契约挂载 ─────────────────────── */

let applied = null;
let applyError = null;
if (exportsObj?.apply) {
	try {
		applied = exportsObj.apply({ logger: () => ({ info: () => {} }) });
	} catch (e) {
		applyError = e;
	}
}
check("apply() 可执行无异常", applyError === null, applyError ? "异常: " + applyError.message : "已执行");
check("apply() 返回 installed 结构", applied !== null && typeof applied === "object", applied ? Object.keys(applied).join(",") : "null");

/* ── 6. 全局契约断言（批次 1 + 2 + 3）────────────────────────── */

console.log("\n  ── 全局契约实际挂载检查 ──");
const CONTRACTS = [
	"__dshDebug", "__dshV9Log", "__directorLayoutStore", "__dshTheme", "__directorConfig",
	"__dshCheckOllama", "__dshLayoutProbe",
	"__dshMemory", "__dshCreateBranch", "__dshSwitchMemoryTab", "__dshShowToast",
	"__directorPersistState", "__dshDirectorBatch3",
	"__dshDirectorBatch4", "__dshDirectorProcess", "__dshDirectorReviewReturn",
	"__dshDirectorBatch5", "__dshDirectorFlow",
];
const w = windowStub;
for (const k of CONTRACTS) {
	const v = w[k];
	const ok = v !== undefined;
	check(`window.${k}`, ok, ok ? typeof v : "未挂载");
}

/* ── 6b. 批次 3 契约与关键不变量 ─────────────────────────────── */

console.log("\n  ── 批次 3（持久化层）契约 ──");
check("installed.persistState", applied?.persistState === true, String(applied?.persistState));
check("installed.storeFactory", applied?.storeFactory === true, String(applied?.storeFactory));
check("installed.hook（useDirectorStore）", applied?.hook === true, String(applied?.hook));
check("installed.beforeUnload 新注册成功（离线无宿主抢占守卫）", applied?.beforeUnload === true, String(applied?.beforeUnload));
check("installed.beforeUnloadRegistered 能力就绪", applied?.beforeUnloadRegistered === true, String(applied?.beforeUnloadRegistered));
check("installed.fileLogBridged", applied?.fileLogBridged === true, String(applied?.fileLogBridged));
check("legacyRequire 实测为空（T5 结论）", Array.isArray(applied?.legacyRequire) && applied.legacyRequire.length === 0,
	`[${(applied?.legacyRequire || []).join(", ")}]`);
check("文件通道能力已判定", typeof applied?.fileChannel === "boolean",
	`fileChannel=${applied?.fileChannel} opfs=${applied?.opfs} fsa=${applied?.fsa}`);

// 🔴 关键不变量（V9 修复点）：空 sessionId 必须映射到固定 key
const entry = exportsObj?.__entry;
check("__entry 导出批次 3 函数", typeof entry?.safeDirectorKey === "function" && typeof entry?.createDirectorStore === "function");
if (typeof entry?.safeDirectorKey === "function") {
	check("safeDirectorKey(空) === 'director-main'", entry.safeDirectorKey() === "director-main", entry.safeDirectorKey());
	check("safeDirectorKey(undefined) === 'director-main'", entry.safeDirectorKey(undefined) === "director-main");
	check("safeDirectorKey(UUID) 取前 8 位",
		entry.safeDirectorKey("12345678-1234-1234-1234-123456789abc") === "director-12345678",
		entry.safeDirectorKey("12345678-1234-1234-1234-123456789abc"));
	const h1 = entry.safeDirectorKey("session-abc"), h2 = entry.safeDirectorKey("session-abc");
	check("safeDirectorKey 对同一输入稳定", h1 === h2, h1);
	check("safeDirectorKey 不同输入不同 key", h1 !== entry.safeDirectorKey("session-xyz"), h1);
}
if (typeof entry?.createDirectorStore === "function") {
	const s1 = entry.createDirectorStore("t1"), s2 = entry.createDirectorStore("t2");
	// ⚠️ 保真度：各 store 的 config 子对象不得共享引用（宿主每次新建字面量）
	check("store 配置未共享引用（深克隆保真）",
		s1.getState().config.duties !== s2.getState().config.duties,
		"duties 引用不同");
	check("store.getState/subscribe 齐备",
		typeof s1.getState === "function" && typeof s1.subscribe === "function"
		&& typeof s1.addMessage === "function" && typeof s1.hydrate === "function");
} else {
	check("store 工厂可创建实例", false, "createDirectorStore 不可用");
}

/* ── 7. 契约可调用性（抽查）────────────────────────────────── */

console.log("\n  ── 契约可调用性抽查 ──");
check("__dshShowToast 可调用", typeof w.__dshShowToast === "function", "function");
check("__dshCreateBranch 可调用", typeof w.__dshCreateBranch === "function", "function");
check("__dshSwitchMemoryTab 可调用", typeof w.__dshSwitchMemoryTab === "function", "function");

let toastOk = false, toastErr = null;
try {
	if (typeof w.__dshShowToast === "function") {
		w.__dshShowToast("verify");
		toastOk = createdEls.some((e) => e.id === "dsh-toast");
	}
} catch (e) { toastErr = e; }
check("__dshShowToast 实际创建 #dsh-toast", toastOk, toastErr ? "异常: " + toastErr.message : toastOk ? "DOM 节点已创建" : "未创建");

/* ── 6d. 批次 4 逻辑层契约 ─────────────────────────────────── */

console.log("\n  ── 批次 4（逻辑层）契约 ──");
check("installed.directorProcess", applied?.directorProcess === true, String(applied?.directorProcess));
check("installed.directorReview", applied?.directorReview === true, String(applied?.directorReview));
// 🔴 D2 有意不接线（宿主决策「保留不调用」）——断言该状态被**显式声明**，防未来误判
check("installed.directorReviewWired === false（有意不接线）", applied?.directorReviewWired === false, String(applied?.directorReviewWired));
check("installed.directorProcessWired === false（批次 6 接线）", applied?.directorProcessWired === false, String(applied?.directorProcessWired));
check("window.__dshDirectorProcess 可调用", typeof windowStub.__dshDirectorProcess === "function", typeof windowStub.__dshDirectorProcess);
check("window.__dshDirectorReviewReturn 可调用", typeof windowStub.__dshDirectorReviewReturn === "function", typeof windowStub.__dshDirectorReviewReturn);
// 入口导出表包含批次 4 两项
const entryExports = exportsObj?.__entry;
check("__entry 导出批次 4 函数",
	typeof entryExports?.directorProcess === "function" && typeof entryExports?.directorReviewReturn === "function",
	`process=${typeof entryExports?.directorProcess} review=${typeof entryExports?.directorReviewReturn}`);

/* ── 6e. 批次 5 组件层契约 ─────────────────────────────────── */

console.log("\n  ── 批次 5（组件层）契约 ──");
check("installed.directorFlow", applied?.directorFlow === true, String(applied?.directorFlow));
check("installed.directorFlowWired === false（批次 6 接线）", applied?.directorFlowWired === false, String(applied?.directorFlowWired));
check("🔴 迁移期修正标记 directorFlowFixedFilteredMessages", applied?.directorFlowFixedFilteredMessages === true, String(applied?.directorFlowFixedFilteredMessages));
check("window.__dshDirectorFlow 为函数（组件）", typeof windowStub.__dshDirectorFlow === "function", typeof windowStub.__dshDirectorFlow);
// 🔴 反证：bundle 产出的组件源码不得含越界引用，且必须含修正后引用
//    ⚠️ toString() 会**连注释一起返回**，而注释中刻意引用了宿主原代码行（取证链需要）→ 必须先剥离注释
const stripJsComments = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flowFnSrc = typeof windowStub.__dshDirectorFlow === "function" ? windowStub.__dshDirectorFlow.toString() : "";
const flowFnCode = stripJsComments(flowFnSrc);
check("🔴 bundle 反证：组件源码零 filteredMessages 引用（剥离注释后）", !/filteredMessages\s*\./.test(flowFnCode), "零命中");
check("bundle 组件源码含 state.messages.map", flowFnCode.includes("state.messages.map"), "已改用 state.messages");
check("__entry 导出批次 5 组件", typeof entryExports?.DirectorFlow === "function", typeof entryExports?.DirectorFlow);

/* ── 汇总 ─────────────────────────────────────────────────── */

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log("\n=== 汇总 ===");
console.log(`  总计 ${results.length} 项  |  通过 ${passed}  |  失败 ${failed}`);
console.log(failed === 0 ? "  IS_PASS = true\n" : "  IS_PASS = false\n");
process.exit(failed === 0 ? 0 : 1);
