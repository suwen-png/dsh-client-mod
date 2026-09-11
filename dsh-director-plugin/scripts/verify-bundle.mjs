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

/* ── 4. 执行 factory（模拟 require 提供平台模块）─────────────── */

let exportsObj = null;
let factoryError = null;
if (captured) {
	try {
		exportsObj = captured.factory((name) => {
			throw new Error(`本插件不应 require 平台模块，却被请求: ${name}`);
		});
	} catch (e) {
		factoryError = e;
	}
}
check("factory 可执行（不 require 任何平台模块）", factoryError === null,
	factoryError ? "异常: " + factoryError.message : "require 未被调用 ✓");
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

/* ── 6. 全局契约断言（批次 1 + 批次 2）───────────────────────── */

console.log("\n  ── 全局契约实际挂载检查 ──");
const CONTRACTS = [
	"__dshDebug", "__dshV9Log", "__directorLayoutStore", "__dshTheme", "__directorConfig",
	"__dshCheckOllama", "__dshLayoutProbe",
	"__dshMemory", "__dshCreateBranch", "__dshSwitchMemoryTab", "__dshShowToast",
];
const w = windowStub;
for (const k of CONTRACTS) {
	const v = w[k];
	const ok = v !== undefined;
	check(`window.${k}`, ok, ok ? typeof v : "未挂载");
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

/* ── 汇总 ─────────────────────────────────────────────────── */

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log("\n=== 汇总 ===");
console.log(`  总计 ${results.length} 项  |  通过 ${passed}  |  失败 ${failed}`);
console.log(failed === 0 ? "  IS_PASS = true\n" : "  IS_PASS = false\n");
process.exit(failed === 0 ? 0 : 1);
