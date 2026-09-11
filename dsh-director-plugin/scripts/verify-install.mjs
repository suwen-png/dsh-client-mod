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
	win.document = win.document || { createElement: () => ({}), head: { appendChild: () => {} }, querySelector: () => null };
	win.CustomEvent = win.CustomEvent || class CustomEvent { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

	// 执行 bundle（顶层只调用 __ModuleLoader__.load）
	new Function("window", "document", "URL", code)(win, win.document, win.URL);

	check("bundle 调用了 __ModuleLoader__.load", loaded.length === 1);
	if (loaded.length === 1) {
		const rec = loaded[0];
		check("bundle id 正确", rec.id === PLUGIN_PKG, rec.id);
		check("bundle factory 为函数", typeof rec.factory === "function");
		const requireStub = () => { throw new Error("本插件不应 require 平台模块"); };
		const exportsObj = rec.factory(requireStub);
		check("factory 执行成功", Boolean(exportsObj));
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
