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

/* 🔴 剥注释 —— **扫源码的断言（无论正负）都必须先过这一道**。
 *  原因：注释里写"旧写法是 `#7fe3e8` 所以对比度不够"是**好注释**，
 *  但裸扫源码会把它当成"旧色还在"判红 ⇒ **注释写得越清楚，闸门越红** ⇒ 逼人删注释、丢信息。
 *  同向的假绿更隐蔽：正向断言"产物里有 `pointerEvents:"none"`"也可能只是**注释里提过**而通过。
 *  （同一个坑在 test-personalize.mjs 的 C6 已经吃过一次，这次在产物层又踩到 ——
 *   所以做成显式工具，而不是靠"下次注意"。）
 *
 *  ⚠️ 实现用**行级过滤**，不用字符串/正则状态机 —— 这里有个实证教训：
 *     第一版是逐字符扫描（跳过字符串内部的 `//`），加进 888KB 产物后**静默失步**了：
 *     产物里有正则字面量（如 `/["']/`），扫描器遇到其中的引号会"进入字符串"并一路吞到很远，
 *     从此把后面**所有**注释都当成代码 ⇒ 负断言把一条纯注释判成"旧色还在"（真机上就是这么红的）。
 *     失步比漏剥危险得多：**漏剥只影响一条断言，失步会让全文件的所有扫描断言一起假绿**。
 *     行级过滤没有状态，不会失步；代价是"块注释里不以 `*` 开头的行"剥不掉 ——
 *     但本项目块注释体一律以 `*` 开头（可 grep 校验），所以充分。
 */
const stripJsComments = (s) => String(s).split("\n").map((line) => {
	const t = line.trim();
	if (t.startsWith("/*") || t.startsWith("*") || t.startsWith("//")) return "";
	const i = line.indexOf("/*");
	return i >= 0 ? line.slice(0, i) : line;
}).join("\n");
/** 去注释后的产物源码 —— 所有"扫源码"断言都用它，不用 `src` */
const SRC_NC = stripJsComments(src);

/* 🔴 按**模块**取源码片段 —— 产物是 `__defs["<模块路径>"] = function (exports) {…}`
 *  顺序拼接的。为什么不能全文件搜字符串：同一个色值/写法在别的模块里可能是**正当**的
 *  （例：`#b794f6` 在 DesignStudio / DirectorPage 里是 `var(--dp-ac, …)` 的**兜底色**，
 *   即用户个性化主色的默认值 —— 那是设计意图，不是缺陷）。
 *  全文件搜会把"别处的正当用法"误判成本模块的问题 ⇒ 断言必须**按块取文本**。 */
const moduleSlice = (name) => {
	const marker = '__defs["' + name + '"]';
	const i = SRC_NC.indexOf(marker);
	if (i < 0) return "";
	const j = SRC_NC.indexOf('__defs["', i + marker.length);
	return SRC_NC.slice(i, j < 0 ? SRC_NC.length : j);
};

/* ── 1. 构建最小浏览器环境桩 ─────────────────────────────────── */

const styleTags = [];
const createdEls = [];
/* :root 变量与 html 属性的**记录桩**（批次 11 新增）。
 * 为什么必须补 `documentElement`：此前桩里没有它 ⇒ `applyPersonalize()` 在
 * `document.documentElement.style.setProperty(...)` 处抛错并被自身 try 吞掉，
 * 于是"个性化设定到底有没有真的写进 DOM"在产物层**完全测不到**
 * （样式表因 appendChild 在前而侥幸留下，变量与 data-* 全丢）。
 * 补上之后，闸门可以断言：① 样式表已注入 ② `--dp-*` 变量已写 ③ `data-dp-texture` 已落。 */
const rootStyleVars = {};
/* 🔴 必须是**对象**而不是数组：数组上挂 `data-dp-texture` 这类非索引键虽然能读出来，
 * 但 `JSON.stringify` 会输出 `[]` ⇒ 断言虽然是对的，证据却是误导性的
 * （闸门打印出来的东西本身也是证据，不能自相矛盾）。 */
const rootAttrs = {};

const documentStub = {
	head: { appendChild: (el) => styleTags.push(el) },
	body: { appendChild: (el) => createdEls.push(el) },
	getElementById: () => null,
	createElement: (tag) => ({
		tagName: tag.toUpperCase(), id: "", style: { cssText: "", opacity: "" },
		dataset: {}, textContent: "", appendChild: () => {},
	}),
	querySelector: () => null,
	documentElement: {
		style: { setProperty: (k, v) => { rootStyleVars[k] = v; } },
		setAttribute: (k, v) => { rootAttrs[k] = v; }
	},
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
 * 平台模块桩表 —— **唯一真相源**是 `_platform-modules.mjs`（2026-09-13 抽出）。
 *
 * 本段历史（保留，防再犯）：这里原先**另写了一份**极简 react
 *   （只有 useCallback / useSyncExternalStore / useState），与共享桩长期漂移，
 *   缺了 `Component`。后果极具误导性：产物里有
 *   `class SafeLayer extends react.Component`（单层错误边界）⇒ `react.Component`
 *   为 undefined ⇒ factory 抛 `Class extends value undefined is not a constructor or null`
 *   ⇒ 其后 44 项断言**全部级联失败**，报告读起来像「插件整个坏了」，
 *   真因只是**第二份桩少了一个基类**（真机一直正常）。
 *   2026-09-12 只修了本文件一处；同日 `verify-install.mjs` 那份**内联桩**
 *   又踩了**同一个坑** ⇒ 故抽成单文件，并加守护闸门
 *   `lint-platform-stub.mjs`（断言「零内联 react 桩」）。
 */
const { platformStub } = await import("./_platform-modules.mjs");
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
//    （`stripJsComments` 统一在上面定义，本处不再重复声明 —— 同一事实只留一份真相源）
const flowFnSrc = typeof windowStub.__dshDirectorFlow === "function" ? windowStub.__dshDirectorFlow.toString() : "";
const flowFnCode = stripJsComments(flowFnSrc);
check("🔴 bundle 反证：组件源码零 filteredMessages 引用（剥离注释后）", !/filteredMessages\s*\./.test(flowFnCode), "零命中");
check("bundle 组件源码含 state.messages.map", flowFnCode.includes("state.messages.map"), "已改用 state.messages");
check("__entry 导出批次 5 组件", typeof entryExports?.DirectorFlow === "function", typeof entryExports?.DirectorFlow);

/* ── 6f. 批次 11：个性化设定 + 四维流转（2026-09-12 第三轮） ──── */

console.log("\n  ── 批次 11（个性化 + 四维流转）契约 ──");
check("installed.personalizeApi", applied?.personalizeApi === true, String(applied?.personalizeApi));
check("installed.personalize 为合法设定（默认质感 = grid）", applied?.personalize?.texture === "grid", JSON.stringify(applied?.personalize));
check("installed.flowApi", applied?.flowApi === true, String(applied?.flowApi));
check("installed.flowDimensions 四维且顺序与用户原话一致",
	Array.isArray(applied?.flowDimensions) && applied.flowDimensions.join(",") === "director,chat,mindmap,design",
	JSON.stringify(applied?.flowDimensions));
check("installed.nodeDetailPanel", applied?.nodeDetailPanel === true, String(applied?.nodeDetailPanel));
check("installed.personalizePanelId 稳定（e2e 靠它找面板）", applied?.personalizePanelId === "dsh-personalize-panel", String(applied?.personalizePanelId));
check("installed.nodeDetailId 稳定", applied?.nodeDetailId === "dsh-node-detail", String(applied?.nodeDetailId));
check("window.__dshDirectorBatch11 === installed（别名一致，不是另一个对象）",
	typeof windowStub.__dshDirectorBatch11 === "object" && windowStub.__dshDirectorBatch11 === windowStub.__dshDirectorBatch1,
	windowStub.__dshDirectorBatch11 === windowStub.__dshDirectorBatch1 ? "同一引用" : "引用不同");
check("__entry 导出批次 11 六项",
	typeof entryExports?.installPersonalizeApi === "function" && typeof entryExports?.installFlowApi === "function"
	&& typeof entryExports?.PersonalizePanel === "function" && typeof entryExports?.NodeDetailPanel === "function"
	&& typeof entryExports?.personalizeStore === "object" && typeof entryExports?.flowStore === "object",
	`pers=${typeof entryExports?.installPersonalizeApi} flow=${typeof entryExports?.installFlowApi} panel=${typeof entryExports?.PersonalizePanel} nd=${typeof entryExports?.NodeDetailPanel}`);

check("window.__dshPersonalize 契约可调用（store.set / pCssText / pVarsFor）",
	typeof windowStub.__dshPersonalize?.store?.set === "function"
	&& typeof windowStub.__dshPersonalize?.pCssText === "function"
	&& typeof windowStub.__dshPersonalize?.pVarsFor === "function", null);
check("window.__dshFlow 契约可调用（store.push / currentTaskOf / DIM）",
	typeof windowStub.__dshFlow?.store?.push === "function"
	&& typeof windowStub.__dshFlow?.currentTaskOf === "function"
	&& typeof windowStub.__dshFlow?.DIM === "object", null);
check("🔴 反证：产物内样式表真的含三档纹理规则（不是空壳函数）",
	(() => { const css = String(windowStub.__dshPersonalize?.pCssText?.() || "");
		return css.indexOf('data-dp-texture="grid"') >= 0 && css.indexOf('data-dp-texture="dots"') >= 0 && css.indexOf('data-dp-texture="glass"') >= 0; })(), null);
check("🔴 apply() 真的把样式表注入 DOM（<style id=dsh-personalize-css> 出现在 head）",
	styleTags.some((s) => s && s.id === "dsh-personalize-css" && String(s.textContent || "").length > 200),
	styleTags.map((s) => s && s.id).filter(Boolean).join(","));
check("🔴 apply() 真的把 --dp-* 变量写到 :root（个性化能生效的物理证据）",
	rootStyleVars["--dp-ac"] !== undefined && rootStyleVars["--dp-font"] !== undefined && rootStyleVars["--dp-radius"] !== undefined,
	"--dp-ac=" + rootStyleVars["--dp-ac"] + " / --dp-font=" + rootStyleVars["--dp-font"] + " / --dp-radius=" + rootStyleVars["--dp-radius"]);
check("🔴 apply() 真的写了 html[data-dp-texture]（纹理选择器要靠它命中）",
	rootAttrs["data-dp-texture"] === "grid" && rootAttrs["data-dp-motion"] === "1", JSON.stringify(rootAttrs));
check("🔴 反证：改主色 ⇒ :root 的 --dp-ac 立刻变（证明 set 真的重写到 DOM，不是只改内存）",
	(() => { const before = rootStyleVars["--dp-ac"];
		windowStub.__dshPersonalize.store.set("accent", "#39c5cf");
		const after = rootStyleVars["--dp-ac"];
		windowStub.__dshPersonalize.store.reset();
		return before === "#2f6feb" && after === "#39c5cf" && after !== before; })(),
	rootStyleVars["--dp-ac"]);
/* ── 6g 批次 12：总监页背景改走宿主令牌（风格统一） ── */

check("window.__dshDirectorBatch12 === installed（别名一致，不是另一个对象）",
	typeof windowStub.__dshDirectorBatch12 === "object" && windowStub.__dshDirectorBatch12 === windowStub.__dshDirectorBatch1,
	windowStub.__dshDirectorBatch12 === windowStub.__dshDirectorBatch1 ? "同一引用" : "引用不同");
check("installed.uiTheme 六项令牌映射齐备（总监页表面/卡片/文字/边框都指到宿主 --dsw-alias-*）",
	(() => { const u = applied?.uiTheme || {};
		return u.scope === '[data-testid="dp-root"]' && u.source === "host --dsw-alias-*"
		&& u.surface === "--dsw-alias-bg-base" && u.card === "--dsw-alias-bg-layer-1"
		&& u.card2 === "--dsw-alias-bg-layer-2" && u.text === "--dsw-alias-label-primary"
		&& u.border === "--dsw-alias-border-l2"; })(),
	JSON.stringify(applied?.uiTheme));

check("🔴 产物内样式表真的含 dp-root 宿主令牌桥接（≥6 个 --dsw-alias-*）",
	(() => { const css = String(windowStub.__dshPersonalize?.pCssText?.() || "");
		const i = css.indexOf('[data-testid="dp-root"]{');
		if (i < 0) return false;
		const blk = css.slice(i, css.indexOf("}", i) + 1);
		return (blk.match(/--dsw-alias-[a-z0-9-]+/g) || []).length >= 6; })(), null);
check("🔴 反证：桥接**不得**写在 :root 上（var() 在定义处求值；宿主令牌在 body 上，:root 取不到 ⇒ 静默失效）",
	(() => { const css = String(windowStub.__dshPersonalize?.pCssText?.() || "");
		const i = css.indexOf(":root{");
		if (i < 0) return false;
		const blk = css.slice(i, css.indexOf("}", i) + 1);
		return blk.indexOf("--dsw-alias-") < 0; })(), null);
check("🔴 纹理色走变量（--dp-tex），不再是写死的白色 —— 浅色底下白纹理等于不可见",
	(() => { const css = String(windowStub.__dshPersonalize?.pCssText?.() || "");
		return /--dp-tex:/.test(css) && css.indexOf("background-image:linear-gradient(var(--dp-tex)") >= 0
		&& css.indexOf("rgba(255,255,255,.035) 1px") < 0; })(), null);
/* ── 6h 批次 13：浮动按钮组不吃点击 + 药丸配色随主题 ──
 *  批次 12 把总监页背景改成宿主浅色玻璃后**连带暴露**的两处缺陷（深色底把它们掩盖了）：
 *   ① 浮动组容器是 98×103 但有透明空隙，默认吃点击 ⇒ 页面自己的「交给总监整理」点不动；
 *   ② 三颗药丸写死的是给深色底配的浅色 ⇒ 浅底上对比度只剩 1.35–2.21:1。
 *  这里只验"产物真的带了改动"；运行期行为由 verify-flow.mjs 的 F8 / F9 在真机上验。 */

check("window.__dshDirectorBatch13 === installed（别名一致，不是另一个对象）",
	typeof windowStub.__dshDirectorBatch13 === "object" && windowStub.__dshDirectorBatch13 === windowStub.__dshDirectorBatch1,
	windowStub.__dshDirectorBatch13 === windowStub.__dshDirectorBatch1 ? "同一引用" : "引用不同");
check("installed.floatDock 五项契约齐备（容器不吃点击 / 药丸吃点击 / 字色取宿主令牌 / 横向占位数 / 消费者名单）",
	(() => { const f = applied?.floatDock || {};
		/* 消费者名单随 R6 去除而更新（第 5 批）：R6 已整块删除，其数据并入 R2。
		 * 只剩 dp-r8（底部动作行）与 dp-personalize（右端浮标）两处真的在用。 */
		return f.containerPointerEvents === "none" && f.pillPointerEvents === "auto"
		&& f.pillColorToken === "--dsw-alias-label-primary" && f.reserve === 108
		&& Array.isArray(f.reserveConsumers) && f.reserveConsumers.join(",") === "dp-r8,dp-personalize"; })(),
	JSON.stringify(applied?.floatDock));
const dockSrc = moduleSlice("components/FloatDock.js");
const pageSrc = moduleSlice("components/DirectorPage.js");
check("🔴 浮动组模块内真的有 pointer-events：容器 none + 药丸 auto（容器保留 auto 时会吃掉页面按钮的点击）",
	dockSrc.length > 0 && /pointerEvents:\s*"none"/.test(dockSrc) && /pointerEvents:\s*"auto"/.test(dockSrc),
	"FloatDock 片段 " + dockSrc.length + " 字符");
check("🔴 横向占位常量确实定义在浮动组模块、并被总监页消费（不留白 ⇒ 浮动组压住页面按钮）",
	/FLOAT_DOCK_RESERVE/.test(dockSrc) && /export/.test(dockSrc) && /dockReserve/.test(pageSrc),
	"FloatDock 有常量=" + /FLOAT_DOCK_RESERVE/.test(dockSrc) + " / DirectorPage 有 dockReserve=" + /dockReserve/.test(pageSrc));
check("🔴 反证：浮动组模块内三颗药丸的旧浅色硬编码（#7fe3e8 / #9fc2ff / #b794f6）已清除（已剥注释 + 已按模块取块）",
	dockSrc.length > 0 && !/#7fe3e8|#9fc2ff|#b794f6/i.test(dockSrc), null);
/* ⚠️ 判据写成「不低于」而不是 `=== batch13`：版本号会随批次单调前推，
 *    钉死字面量会让**每一次新批次**都把这条老断言弄红（假红），与它要守的
 *    「版本确实被升过、没有停在旧批次」这层意思也无关。 */
check("PLUGIN_VERSION 不低于批次 13（版本号单调、不回退）",
	(() => { const m = /batch(\d+)/.exec(String(entryExports?.PLUGIN_VERSION || "")); return !!m && Number(m[1]) >= 13; })(),
	String(entryExports?.PLUGIN_VERSION));

/* ── 6i 批次 15：真流转 / 分支聚焦 / 总览 / 统筹打分 ──
 *  本批次对应「我在总监发的消息，是否经过处理然后发给对话执行」这个**最核心基础要求**。
 *  这里只验"产物真的带了改动与契约"；运行期行为由 verify-flow.mjs 的 G 段、
 *  verify-mindmap.mjs 的 13.5/13.6 段在真机上验。 */
check("window.__dshDirectorBatch15 === installed（别名一致，不是另一个对象）",
	typeof windowStub.__dshDirectorBatch15 === "object" && windowStub.__dshDirectorBatch15 === windowStub.__dshDirectorBatch1,
	windowStub.__dshDirectorBatch15 === windowStub.__dshDirectorBatch1 ? "同一引用" : "引用不同");
check("installed.deliver 三通道且首选项 = host-send（宿主直投，避开 InputBar 的总监劫持）",
	(() => { const d = applied?.deliver || {};
		return Array.isArray(d.channels) && d.channels.length === 3 && d.channels[0] === "host-send"
		&& d.attr === "data-deliver-mode" && Array.isArray(d.modes) && d.modes.length === 4; })(),
	JSON.stringify(applied?.deliver));
check("installed.branchFocus / overview / orchestrate 三组契约齐备",
	!!applied?.branchFocus?.bar && Array.isArray(applied?.overview?.columns)
	&& Array.isArray(applied?.orchestrate?.stages) && applied.orchestrate.stages.length === 6
	&& Array.isArray(applied?.orchestrate?.rubricDims) && applied.orchestrate.rubricDims.length === 6
	&& applied?.orchestrate?.rubricSelfAudit === true,
	JSON.stringify({ branchFocus: applied?.branchFocus, overview: applied?.overview, orchestrate: applied?.orchestrate }));

const bridgeSrc = moduleSlice("bridge/chat-bridge.js");
const focusSrc = moduleSlice("logic/branch-focus.js");
const ovSrc = moduleSlice("logic/overview.js");
const orchSrc = moduleSlice("logic/orchestrate.js");
check("🔴 桥接模块真的实现了 host-send 通道（引用宿主 __directChatSubmit + 有送达凭据）",
	bridgeSrc.length > 0 && /__directChatSubmit/.test(bridgeSrc) && /sendToHost/.test(bridgeSrc)
	&& /__directChatProbe/.test(bridgeSrc),
	"chat-bridge 片段 " + bridgeSrc.length + " 字符");
check("🔴 三个新纯函数模块都在产物内且导出了 public API",
	/focusRows/.test(focusSrc) && /buildOverview/.test(ovSrc) && /auditRubric/.test(orchSrc)
	&& /RUBRIC_MAX/.test(orchSrc),
	JSON.stringify({ focus: focusSrc.length, overview: ovSrc.length, orchestrate: orchSrc.length }));
check("🔴 反证（回归防护）：总监页模块内 `deliver` **只有一处函数声明**",
	/* 背景：同一作用域重复 `function` 声明是合法语法、后声明静默覆盖前者 ——
	 * 本轮真机上正是"新版真流转被旧版记录员顶掉"，产物语法自检完全看不到。
	 * 构建期已加 lintDuplicateFnDecl；这里再从**产物**上做一次回归反证。 */
	(() => { const n = (pageSrc.match(/(?:async\s+)?function\s+deliver\s*\(/g) || []).length;
		return n === 1; })(),
	"deliver 声明数 = " + ((pageSrc.match(/(?:async\s+)?function\s+deliver\s*\(/g) || []).length));
/* 版本号「不低于批次 15」：与上面「不低于批次 13」同属单调性闸门。
 * 2026-09-12 纠错：原断言写死 `/batch15/`，下次升批次必假红（本日已因同类写法修掉两处）。
 * 语义改为「batchN 数值 ≥ 15」，并交叉校验产物与源码 PLUGIN_VERSION 同源。 */
check("PLUGIN_VERSION 不低于批次 15（单调不回退）",
	(() => { const m = /batch(\d+)/.exec(String(entryExports?.PLUGIN_VERSION || "")); return !!m && Number(m[1]) >= 15; })(),
	String(entryExports?.PLUGIN_VERSION));

/* ── 汇总 ─────────────────────────────────────────────────── */

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log("\n=== 汇总 ===");
console.log(`  总计 ${results.length} 项  |  通过 ${passed}  |  失败 ${failed}`);
console.log(failed === 0 ? "  IS_PASS = true\n" : "  IS_PASS = false\n");
process.exit(failed === 0 ? 0 : 1);
