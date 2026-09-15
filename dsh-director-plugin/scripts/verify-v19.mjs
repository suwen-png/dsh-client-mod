/* offline-gate: verify-v19 —— 第 5 批（T-PLUG-036）离线判据
 *
 * 覆盖两处**没有真机就查不出来**的东西：
 *   [1] `src/logic/ledger.js` 台账解析（R4 三个 Tab 的数据源，纯函数，反例可穷举）
 *   [2] `src/bridge/host-panel-trim.js` 四个裁剪目标的判据与护栏（DOM 桩可完整复现）
 *
 * 为什么必须离线也有一份：
 *   这两个模块分别属于「界面上看不出来错」与「错误表现是误伤宿主 UI」两类风险 ——
 *   真机 e2e 只能证实「我构造的那个态」，无法穷举反例（错按钮文案 / 面板外同名文字 /
 *   非叶子元素 / 缺 DOM 能力）。离线上桩才能把**反例**真的跑一遍。
 *
 * 本闸门同时是**两处 bug 的回归防线**（第 5 批）：
 *   · bug ①「刚点开对话一闪而逝」= MutationObserver 回调套了 `setTimeout(…, 300)`
 *   · bug ②「对话页的总监没有最小化了」= 「总监对话」目标 `up: 1` 把整行（含 `—` 按钮）隐了
 *   两者都写成「改回去就立刻红」的判据，而不是只写在文档里。
 *
 * 🔴 2026-09-14 **第 6 批更新**（闸门自己会过期 —— 纪律 14）：
 *   需求 1 用户原话「总监和下面那一个，**这两列不要**」⇒
 *     ① 目标 3 → **4** 个（新增「总监」标题条 `host-director-panel-title`）；
 *     ② 「总监对话」由 `up:0` **改回 `up:1`** —— 第 5 批留 `up:0` 是为了保住行内那枚 `—`，
 *        本轮该按钮的职责已由插件侧 `#dsh-host-col-min` **顶替**（`bridge/host-director-column.js`）；
 *     ③ 「总监」标题条必须是 `up:0` —— 写成 `up:1` 会**上溯到整个总监列**并把它
 *        `display:none`，而"两条已不可见"的断言因此**假绿**（真机 `verify-v22` 的 A2/B3/B4 抓到）。
 *   旧判据会把"按新需求做对了"读成"功能坏了" ⇒ 这里整体改成新事实，并把
 *   「职责已迁移、不是砍掉功能」写成正面判据（见 [3.3]）。
 *
 * 退出码：0 全通过 / 1 有 FAIL / 2 INVALID（用法错或环境不具备）
 * 负向校准（零改动产品源码）：
 *   HP_SRC=<另一个 .js> node scripts/verify-v19.mjs
 *   LEDGER_SRC=<另一个 .js> node scripts/verify-v19.mjs
 */

const HP_SRC = process.env.HP_SRC
	? new URL("file:///" + String(process.env.HP_SRC).replace(/\\/g, "/")).href
	: new URL("../src/bridge/host-panel-trim.js", import.meta.url).href;
const LEDGER_SRC = process.env.LEDGER_SRC
	? new URL("file:///" + String(process.env.LEDGER_SRC).replace(/\\/g, "/")).href
	: new URL("../src/logic/ledger.js", import.meta.url).href;

function usage(why) {
	console.error("INVALID：" + why);
	console.error("  正确用法（默认测真源码，无需参数）：");
	console.error("    node scripts/verify-v19.mjs");
	console.error("  负向校准（可指定样本，路径必须指向存在的 .js 文件）：");
	console.error("    HP_SRC=C:/path/to/defect-host-panel-trim.js node scripts/verify-v19.mjs");
	console.error("    LEDGER_SRC=C:/path/to/defect-ledger.js node scripts/verify-v19.mjs");
	process.exit(2);
}

/* ══════════════════════════════════════════════════════════════════
 * 自校准（--selftest）：规则 F —— 新闸门必须**正负对照校准**
 *   植入缺陷 → 必须红；还原 → 必须绿。否则「永远绿」的闸门等于没有。
 *
 * 为什么用"样本就地生成 + 子进程跑"而不是在本进程里改判据后自测：
 *   本进程已经 import 过被测模块（ESM 缓存），改文件不会重新加载
 *   ⇒ 只能换进程重跑，才真正验证了「闸门对这份源码会怎么判」。
 *   样本文件写在**与原文件同目录**（相对 import 才能解析），名字前缀 `._calib-`，
 *   用完在 `finally` 里删掉并复核"确实删干净了"。
 * ══════════════════════════════════════════════════════════════════ */
async function runSelfTest() {
	const { readFile: rf, writeFile: wf, rm: rmf, stat: stf } = await import("node:fs/promises");
	const { spawnSync: sp } = await import("node:child_process");
	const { fileURLToPath: fup } = await import("node:url");
	const path = await import("node:path");

	const self = fup(import.meta.url);
	const realHp = fup(new URL("../src/bridge/host-panel-trim.js", import.meta.url));
	const realLedger = fup(new URL("../src/logic/ledger.js", import.meta.url));
	const hpSrc = await rf(realHp, "utf8");
	const lgSrc = await rf(realLedger, "utf8");

	/* 三种植入（对应三处真出过问题的写法） */
	const injections = [];

	const d1 = lgSrc.replace("(?:-[A-Z0-9]+)+/;", "(?:-[A-Z0-9]+)+$/;");
	if (d1 !== lgSrc) injections.push({
		name: "缺陷①：台账编号正则**加回行尾 $ 锚点** ⇒ 区间写法 `T-V12-101~104` 被静默丢弃",
		file: path.join(path.dirname(realLedger), "._calib-ledger-anchor.js"), text: d1, env: "LEDGER_SRC"
	});

	const mTitle = /(key:\s*"host-director-chat-title",[\s\S]*?)up:\s*1,/.exec(hpSrc);
	if (mTitle) injections.push({
		name: "缺陷②：整行目标 `up: 1` 改回 `up: 0` ⇒ 这一行重新可见（第 6 批需求 1 未达成；第 5 批的旧语义）",
		file: path.join(path.dirname(realHp), "._calib-trim-up0.js"),
		text: hpSrc.replace(mTitle[0], mTitle[1] + "up: 0,"), env: "HP_SRC"
	});
	injections.push({
		name: "缺陷③：源码里注入 setTimeout ⇒ 裁剪延迟（bug ① 复发）",
		file: path.join(path.dirname(realHp), "._calib-trim-timer.js"),
		text: hpSrc + "\nconst __calibLetTimer = setTimeout;\n", env: "HP_SRC"
	});

	const run = (env) => sp(process.execPath, [self], {
		encoding: "utf8", env: Object.assign({}, process.env, env, { V19_SKIP_SYNTAX: "1" })
	});

	let bad = 0;
	const created = [];
	try {
		console.log("═══════════════════════════════════════════════════════════");
		console.log(" verify-v19 自校准（--selftest）");
		console.log("═══════════════════════════════════════════════════════════");

		const green = run({});
		const isGreen = green.status === 0;
		console.log((isGreen ? "  PASS  " : "  FAIL  ") + "[C0] 还原态（真源码）必须是**绿**的  | exit=" + green.status);
		if (!isGreen) { bad++; console.log(String(green.stdout || "").split("\n").filter((l) => l.indexOf("FAIL") >= 0).slice(0, 8).join("\n")); }

		if (injections.length !== 3) {
			console.error("  INVALID：样本没造出来（期望 3 个植入，实际 " + injections.length + " 个）—— 源码结构变了，请更新植入点");
			process.exit(2);
		}

		for (const inj of injections) {
			await wf(inj.file, inj.text, "utf8");
			created.push(inj.file);
			const r = run({ [inj.env]: inj.file });
			const red = r.status === 1;
			console.log((red ? "  PASS  " : "  FAIL  ") + "[C" + (created.length) + "] " + inj.name + "  | exit=" + r.status + (red ? "（正确判红）" : "（应为 1，未判红）"));
			if (!red) {
				bad++;
				console.log(String(r.stdout || "").split("\n").slice(-14).join("\n"));
			}
		}
	} finally {
		for (const f of created) { try { await rmf(f, { force: true }); } catch (e) { /* 记录在下方复核 */ } }
		const left = [];
		for (const f of created) { try { await stf(f); left.push(f); } catch (e) { /* 已删 = 期望 */ } }
		if (left.length) {
			console.error("  🔴 样本未删干净（必须手工处理）：\n    " + left.join("\n    "));
			process.exit(2);
		}
		console.log("  —— 样本已清理（" + created.length + " 个文件复核不存在）——");
	}

	console.log("\n" + "═".repeat(59));
	console.log("  自校准：通过 " + (3 + 1 - bad) + " / 失败 " + bad);
	console.log("  " + (bad ? "IS_PASS: FALSE（自校准未通过）" : "IS_PASS: TRUE（正负对照成立）"));
	console.log("═".repeat(59));
	process.exit(bad ? 1 : 0);
}

if (process.argv.includes("--selftest")) {
	await runSelfTest();
	process.exit(0);
}

/* ══════════════════════════════════════════════════════════════════
 * 一、最小但语义真实的 DOM 桩
 *
 * 保真度取舍（写下来，免得以后有人当它是真 DOM）：
 *   · `children` 是数组、`parentElement` 单链 —— 够 `closest()` 上溯；
 *   · `textContent` 是 getter（拼接子节点）—— 叶子判据 `children.length === 0` 靠它；
 *   · `style` 是**普通对象**（模块只读写 `.display`），而选择器要匹配的内联样式
 *     单独放在 `attrs.style` 字符串里 —— 因为 `PANEL_GUARD_SELECTOR` 是
 *     `[style*="min-width: 180px"]`，匹配的是**属性文本**，不是 style 对象；
 *   · `isConnected` 是普通布尔，可手动置 false 以模拟「宿主整块重挂载」。
 * ══════════════════════════════════════════════════════════════════ */
function matchesOne(sel, node) {
	if (!node || !node.tagName) return false;
	if (sel.charAt(0) === "#") return String(node._attrs.id || "") === sel.slice(1);
	if (sel.charAt(0) === "[") {
		const m = /^\[([A-Za-z0-9_-]+)(?:([*^]?)=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/.exec(sel);
		if (!m) return false;
		const name = m[1];
		const value = m[3] != null ? m[3] : (m[4] != null ? m[4] : (m[5] != null ? m[5] : null));
		const has = Object.prototype.hasOwnProperty.call(node._attrs, name);
		if (m[2] === undefined && value === null) return has;
		if (!has) return false;
		const actual = String(node._attrs[name]);
		if (m[2] === "*") return actual.indexOf(value) >= 0;
		if (m[2] === "^") return actual.indexOf(value) === 0;
		return actual === value;
	}
	return node.tagName === sel.toUpperCase();
}
function matchesAny(sel, node) {
	const list = String(sel).split(",");
	for (const one of list) if (one.trim() && matchesOne(one.trim(), node)) return true;
	return false;
}

function makeDom() {
	const all = [];
	function el(tag, opts = {}) {
		const node = {
			tagName: String(tag).toUpperCase(),
			/* nodeType 必须给：模块的回调用 `n.nodeType !== 1` 过滤"文本节点/注释"，
			 * 桩里缺这个字段会让**每一颗**新增节点都被 continue 掉，慢路径永远走不到
			 * （第 5 批实测：正是这条让 [3.12]/[3.13] 变成"看起来产品不动"的假红）。 */
			nodeType: 1,
			children: [],
			parentElement: null,
			style: Object.assign({}, opts.style || {}),
			_attrs: Object.assign({}, opts.attrs || {}),
			_text: opts.text == null ? "" : String(opts.text),
			isConnected: true
		};
		Object.defineProperty(node, "textContent", {
			get() {
				let s = this._text;
				for (const c of this.children) s += c.textContent;
				return s;
			}
		});
		node.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; };
		node.setAttribute = function (k, v) { this._attrs[k] = String(v); };
		node.removeAttribute = function (k) { delete this._attrs[k]; };
		node.appendChild = function (c) { c.parentElement = this; this.children.push(c); all.push(c); return c; };
		node.querySelectorAll = function (sel) {
			const out = [];
			const walk = (n) => { for (const c of n.children) { if (matchesAny(sel, c)) out.push(c); walk(c); } };
			walk(this);
			return out;
		};
		node.closest = function (sel) {
			let n = this;
			while (n) { if (matchesAny(sel, n)) return n; n = n.parentElement; }
			return null;
		};
		all.push(node);
		return node;
	}
	const body = el("body");
	const doc = {
		body,
		querySelectorAll(sel) { return matchesAny(sel, body) ? [body] : body.querySelectorAll(sel); }
	};
	return { body, document: doc, el, all };
}

/* MutationObserver 桩：记下回调，供手动触发（模拟宿主切页签重挂载） */
let moCallback = null;
let moObservations = 0;
class FakeMutationObserver {
	constructor(cb) { moCallback = cb; }
	observe() { moObservations++; }
	disconnect() { moCallback = null; }
}

/* ══════════════════════════════════════════════════════════════════
 * 二、构造宿主侧「对话页」的最小复原（结构照 client.js 三处残留抄）
 *   · 总监面板列（7330，内联 `min-width: 180px`）
 *       ├─ 7337–7340「总监对话」标题行 = <span>总监对话</span> + <button>—</button>
 *       └─ 7342–7357「智能体 · 点击创建分支」标签 + 5 颗按钮
 *   · viewArea（8714）└─ 7407–7422 蓝色「对话」标题栏 = <span>对话</span> + <div>5 颗按钮</div>
 * ══════════════════════════════════════════════════════════════════ */
const BATON = ["代码", "文档", "调研", "测试", "审核"];

function buildHostDom(dom, opts = {}) {
	const { body, el } = dom;
	const o = Object.assign({ panelInsidePlugin: false, titleOutsidePanel: false, agentRowHasChild: false, barButtons: BATON }, opts);

	const pluginRoot = el("div", { attrs: { id: "dsh-director-page" } });
	const viewArea = el("div", { attrs: { class: "RWZidW_viewArea" } });
	viewArea.appendChild(pluginRoot);
	body.appendChild(viewArea);
	o.pluginRoot = pluginRoot;
	o.viewArea = viewArea;

	const panel = el("div", { attrs: { style: "width: 240px; min-width: 180px; display: flex" } });
	(o.panelInsidePlugin ? pluginRoot : viewArea).appendChild(panel);
	o.panel = panel;

	/* 🔴 第 6 批新增的第 4 个目标：宿主总监面板的**标题条**（`isHostDirectorPanelTitle` 命中的那一行）。
	 *    形态与真机一致：一个 `<div>` **恰 2 个孩子**、整块文本恰为「总监」、且落在 `PANEL_GUARD_SELECTOR`
	 *    （`[style*="min-width: 180px"]`）之内 —— 少任何一条都会不命中（判据是结构指纹，不是纯文本）。 */
	const panelTitleRow = el("div", { attrs: { style: "display: flex; align-items: center" } });
	panelTitleRow.appendChild(el("span", { text: "总监" }));
	panelTitleRow.appendChild(el("span", { text: "" }));
	panel.appendChild(panelTitleRow);
	o.panelTitleRow = panelTitleRow;

	const titleRow = el("div", { attrs: { style: "padding: 6px 10px; display: flex" } });
	const titleSpan = el("span", { text: "总监对话", style: { display: "inline" } });
	const foldBtn = el("button", { text: "—", attrs: { title: "折叠总监面板" } });
	titleRow.appendChild(titleSpan);
	titleRow.appendChild(foldBtn);
	panel.appendChild(titleRow);
	o.titleRow = titleRow; o.titleSpan = titleSpan; o.foldBtn = foldBtn;

	const agentRow = el("div", { attrs: { style: "padding: 6px 10px" } });
	const agentLabel = el("div", { text: "智能体 · 点击创建分支" });
	if (o.agentRowHasChild) agentLabel.appendChild(el("em", { text: "（子元素 ⇒ 非叶子，不该被命中的反例）" }));
	agentRow.appendChild(agentLabel);
	for (const b of BATON) agentRow.appendChild(el("button", { text: b }));
	panel.appendChild(agentRow);
	o.agentRow = agentRow; o.agentLabel = agentLabel;

	const bar = el("div", { attrs: { style: "background-color: #1976d2; display: flex" } });
	bar.appendChild(el("span", { text: "对话" }));
	const group = el("div", { attrs: { style: "display: flex; gap: 4px" } });
	for (const b of o.barButtons) group.appendChild(el("button", { text: b }));
	bar.appendChild(group);
	(o.titleOutsidePanel ? body : viewArea).appendChild(bar);
	o.bar = bar; o.barGroup = group;

	const outside = el("div", { text: "总监对话" });
	body.appendChild(outside);
	o.outsideTitle = outside;

	return o;
}

/** 造一个"对话页标题栏"形态的新节点（模拟宿主切页签时重建的那棵树） */
function makeBarNode(d, buttons = BATON) {
	const bar = d.el("div", { attrs: { style: "background-color: #1976d2" } });
	bar.appendChild(d.el("span", { text: "对话" }));
	const g = d.el("div");
	for (const b of buttons) g.appendChild(d.el("button", { text: b }));
	bar.appendChild(g);
	return bar;
}

/** 把一棵子树**真的摘出文档**（宿主重挂载时旧节点就是这样消失的） */
function detach(node) {
	const p = node.parentElement;
	if (p) {
		const i = p.children.indexOf(node);
		if (i >= 0) p.children.splice(i, 1);
	}
	node.parentElement = null;
	const mark = (n) => { n.isConnected = false; for (const c of n.children) mark(c); };
	mark(node);
}

/**
 * 把当前已贴标记的节点**摘掉**，模拟"宿主切页签 ⇒ 旧子树被卸载"。
 * ⚠️ 只翻 `isConnected` 是不够保真的：那样旧节点仍留在树里，
 *    兜底的全量扫描会先命中旧节点（它带标记 ⇒ 被 continue）并把它占进 `seen`
 *    ⇒ **新节点永远轮不到** ⇒ 产生"产品没反应"的假红。
 *    真实宿主里旧节点是**离开文档**的，所以这里必须真摘。
 */
function disconnectMarked(doc) {
	let n = 0;
	for (const el of doc.querySelectorAll("[data-dsh-trimmed]")) { detach(el); n++; }
	return n;
}

/* ══════════════════════════════════════════════════════════════════
 * 三、断言框架
 * ══════════════════════════════════════════════════════════════════ */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
	if (cond) { pass++; console.log("  PASS  " + name + (detail ? "  | " + detail : "")); }
	else { fail++; failures.push(name); console.log("  FAIL  " + name + "  | " + (detail || "")); }
}
function section(t) { console.log("\n── " + t + " ──"); }
function stripComments(src) {
	return String(src)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/* 建立全局桩 —— 🔴 必须在 import 被测模块**之前**（`hasWindow` 在模块加载时求值） */
let dom = makeDom();
globalThis.window = { MutationObserver: FakeMutationObserver };
globalThis.document = dom.document;

if (typeof globalThis.document === "undefined" || typeof globalThis.document.querySelectorAll !== "function") {
	usage("未能建立 document 桩");
}

console.log("═══════════════════════════════════════════════════════════");
console.log(" verify-v19 —— 第 5 批离线判据（台账解析 + 宿主残留裁剪）");
console.log("═══════════════════════════════════════════════════════════");

let HP, LG;
try { HP = await import(HP_SRC); } catch (e) {
	console.error("IS_PASS: FALSE（INVALID：加载 host-panel-trim 失败）");
	console.error("  目标：" + HP_SRC);
	console.error("  真因：" + String((e && e.message) || e));
	usage("被测模块加载失败");
}
try { LG = await import(LEDGER_SRC); } catch (e) {
	console.error("IS_PASS: FALSE（INVALID：加载 ledger 失败）");
	console.error("  目标：" + LEDGER_SRC);
	console.error("  真因：" + String((e && e.message) || e));
	usage("被测模块加载失败");
}

const HP_API = ["TRIM_MARK", "TRIM_TARGETS", "PANEL_GUARD_SELECTOR", "PLUGIN_GUARD_SELECTOR", "trimState",
	"isHostChatTitleBar", "findTrimTargets", "applyHostPanelTrim", "restoreHostPanelTrim",
	"installHostPanelTrim", "uninstallHostPanelTrim"];
const LG_API = ["LEDGER_KEYS", "stripMd", "parseLedgerRows", "buildLedgerView", "readDocContent"];
const missingHP = HP_API.filter((k) => HP[k] === undefined);
const missingLG = LG_API.filter((k) => LG[k] === undefined);
if (missingHP.length || missingLG.length) {
	console.error("IS_PASS: FALSE（INVALID：被测模块契约不全）");
	if (missingHP.length) console.error("  host-panel-trim 缺导出：" + missingHP.join(", "));
	if (missingLG.length) console.error("  ledger 缺导出：" + missingLG.join(", "));
	usage("契约自检失败（换错文件了？）");
}

/* ══════════════════════════════════════════════════════════════════
 * [0] 全量源码语法自检
 *
 * 为什么放这里（第 5 批实证）：`host-panel-trim.js` 的 `why` 字符串里用 ASCII 双引号做
 * 中文引用（`要求"最小化加上"`）⇒ 字符串提前闭合 ⇒ **整个文件 SyntaxError**。而：
 *   · `lint-undefined-symbols.mjs` 只扫导入/导出符号，**不解析语法** ⇒ 照样报绿；
 *   · 构建期「产物语法自检」要等打包后才炸，且行号指向产物、不是源码。
 * ⇒ 加一条逐文件 `node --check`，把这类错误暴露在"离线阶段"（分钟级，而不是装机后）。
 * ══════════════════════════════════════════════════════════════════ */
section("[0] 全量源码语法自检（src/**/*.js）");

const { spawnSync } = await import("node:child_process");
const { readdirSync } = await import("node:fs");
const { readFile } = await import("node:fs/promises");
const { fileURLToPath } = await import("node:url");

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const scriptsDir = fileURLToPath(new URL("./", import.meta.url));
function walkExt(dir, ext) {
	const out = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const full = dir + (dir.endsWith("\\") || dir.endsWith("/") ? "" : "/") + e.name;
		if (e.isDirectory()) out.push(...walkExt(full, ext));
		else if (e.isFile() && e.name.endsWith(ext)) out.push(full);
	}
	return out;
}
/* 两条腿一起扫：产品源码（src 下全部 .js）+ 闸门自己（scripts 下全部 .mjs）。
 * ⚠️ 注释里别写通配路径（`src` + 斜杠 + 星花会**提前闭合块注释** —— 本次实测踩到）。
 * 🔴 为什么闸门也要扫：第 5 批实测 —— `verify-flow.mjs` 的**模板串注释里写了反引号**，
 *    把模板串提前闭合 ⇒ 整个文件 SyntaxError。这种错要到"启动 Harness + 跑真机"时才暴露，
 *    一轮就是好几分钟；而它本来在毫秒级就能查出来。 */
const srcFiles = walkExt(srcDir, ".js").concat(walkExt(scriptsDir, ".mjs")).sort();
const syntaxBad = [];
/* 自校准子进程要跑 4 遍本闸门，语法自检（63 次 node --check）太贵 ⇒ 允许显式跳过，
 * 但**必须打印可分辨原因**（纪律 18：跳过比红更危险，不许无声跳）。 */
const SKIP_SYNTAX = process.env.V19_SKIP_SYNTAX === "1";
if (SKIP_SYNTAX) {
	console.log("  SKIP  [0] 源码语法自检 —— 原因：V19_SKIP_SYNTAX=1（仅 --selftest 的子进程会设）");
} else {
	for (const f of srcFiles) {
		const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
		if (r.status !== 0) syntaxBad.push({ f, msg: String(r.stderr || "").split("\n").find((l) => l.indexOf("Error") >= 0) || "" });
	}
	ok("[0.1] " + srcFiles.length + " 个文件（src/**/*.js + scripts/**/*.mjs）全部通过 node --check",
		syntaxBad.length === 0,
		syntaxBad.length === 0 ? "全部通过" : syntaxBad.map((b) => pathTail(b.f) + "：" + b.msg).join(" / "));
	if (syntaxBad.length) {
		console.log("        ⛔ 语法错误文件：");
		for (const b of syntaxBad) console.log("           " + b.f + "\n             " + b.msg);
	}
}
function pathTail(p) { return String(p).split(/[\\/]/).slice(-2).join("/"); }

/* ══════════════════════════════════════════════════════════════════
 * [1] ledger.js —— 台账解析
 * ══════════════════════════════════════════════════════════════════ */
section("[1] 台账解析（logic/ledger.js）");

const SAMPLE = [
	"# 待完成任务清单",
	"",
	"> 当前 **2 组 / 3 条**：进行中 1 · 待排期 2。",
	"",
	"| 编号 | 任务 | 优先级 | 关联文档 | 状态 |",
	"|:-----|:-----|:------:|:---------|:-----|",
	"| T-PLUG-036 | 🔴 **第 5 批**（10 条） | P1 | `V19.html` | 🟡 设计稿已出 |",
	"| T-V12-101~104 | 后优化 4 项（a \\| b 转义竖线） | 🟡 backlog | — | 🟡 P3 |",
	"| 说明行 | 编号列不是 ID，必须跳过 | — | — | — |",
	"| T-AESTH-002 | 待用户确认 | P2 | `40/19` | 🟡 待确认 |",
	"",
	"完成时间：2026-09-13",
	"| T-COG-004 | 台账复核 | P3 | — | 2026-09-14 完成 |"
].join("\n");

const rows = LG.parseLedgerRows(SAMPLE);
ok("[1.1] 只认「编号列是可识别 ID」的行（表头/分隔行/说明行全跳过）",
	rows.length === 4, "解析出 " + rows.length + " 行（期望 4）");
ok("[1.2] 表头「编号」不被当成条目",
	!rows.some((r) => r.id === "编号"), "");
ok("[1.3] 非 ID 的说明行不被当成条目",
	!rows.some((r) => r.id.indexOf("说明") === 0), "");
ok("[1.4] 编号形状：T-PLUG-036 / T-V12-101~104 / T-AESTH-002 / T-COG-004 都认",
	rows.map((r) => r.id).join(",") === "T-PLUG-036,T-V12-101~104,T-AESTH-002,T-COG-004",
	rows.map((r) => r.id).join(","));
const pipeRow = rows.find((r) => String(r.cols[0] || "").indexOf("|") >= 0);
ok("[1.5] `\\|` 转义竖线**不**当分隔符（切格后仍是同一格内的一根竖线）",
	Boolean(pipeRow), "含竖线的列 = " + JSON.stringify(pipeRow ? pipeRow.cols[0] : null));
ok("[1.6] cols 是「编号之后」的各列（不含编号自己）",
	rows[0].cols.length === 4 && rows[0].cols[0].indexOf("第 5 批") >= 0,
	"cols.length=" + rows[0].cols.length);
ok("[1.7] stripMd 去 `**` 与反引号、压空白、trim",
	LG.stripMd("  🔴 **第 5 批**（10 条） · `V19.html`  ") === "🔴 第 5 批（10 条） · V19.html",
	JSON.stringify(LG.stripMd("  🔴 **第 5 批**（10 条） · `V19.html`  ")));

const DONE_MD = "| 编号 | 任务 | 完成时间 |\n|:--|:--|:--|\n| T-PLUG-001 | 已做 | 2026-09-11 |";
const idxMap = {
	docCount: 103,
	docs: {},
	tree: { "00-统筹入口": ["a.md", "b.md"], "50-信息中心": ["c.md"] }
};
idxMap.docs[LG.LEDGER_KEYS.roadmap] = { content: SAMPLE };
idxMap.docs[LG.LEDGER_KEYS.done] = { content: DONE_MD };

const vMap = LG.buildLedgerView(idxMap);
ok("[1.8] docs 是 **map** 时能读到（宿主/插件副本都曾把 map 当数组 —— T-PLUG-030 同源缺陷）",
	vMap.ok === true, "ok=" + vMap.ok + " reason=" + JSON.stringify(vMap.reason));
ok("[1.9] docCount / roadmap / done / tree 四个量都来自索引本身",
	vMap.docCount === 103 && vMap.roadmap.length === 4 && vMap.done.length === 1 && vMap.tree.length === 2,
	"docCount=" + vMap.docCount + " roadmap=" + vMap.roadmap.length + " done=" + vMap.done.length + " tree=" + vMap.tree.length);
ok("[1.10] done 的日期列被挑出来（不是把整列当日期）",
	(vMap.done[0] || {}).date === "2026-09-11", "date=" + JSON.stringify((vMap.done[0] || {}).date));

const idxArr = {
	docCount: 2,
	docs: [
		{ path: LG.LEDGER_KEYS.roadmap, content: SAMPLE },
		{ path: LG.LEDGER_KEYS.done, content: DONE_MD }
	],
	tree: { "00-统筹入口": ["a.md"] }
};
const vArr = LG.buildLedgerView(idxArr);
ok("[1.11] docs 退化成**数组**时也容忍（生成器改形态不会静默取空）",
	vArr.ok === true && vArr.roadmap.length === 4, "ok=" + vArr.ok + " roadmap=" + vArr.roadmap.length);

const noIdx = LG.buildLedgerView(null);
ok("[1.12] 索引未加载 ⇒ ok:false 且 reason 点名「文档索引未加载」",
	noIdx.ok === false && noIdx.reason.indexOf("文档索引未加载") >= 0, JSON.stringify(noIdx.reason));

const lackDoc = { docCount: 1, docs: {}, tree: { "00-统筹入口": ["a.md"] } };
lackDoc.docs[LG.LEDGER_KEYS.roadmap] = { content: SAMPLE };
const vLack = LG.buildLedgerView(lackDoc);
ok("[1.13] 缺「已完成清单」⇒ ok:false + reason **含该文档路径**（不静默落空数组）",
	vLack.ok === false && vLack.reason.indexOf(LG.LEDGER_KEYS.done) >= 0 && vLack.done.length === 0,
	JSON.stringify(vLack.reason));

const lackTree = { docCount: 2, docs: {}, tree: {} };
lackTree.docs[LG.LEDGER_KEYS.roadmap] = { content: SAMPLE };
lackTree.docs[LG.LEDGER_KEYS.done] = { content: DONE_MD };
const vTree = LG.buildLedgerView(lackTree);
ok("[1.14] 缺 tree 分组 ⇒ ok:false + reason 点名「文档树」",
	vTree.ok === false && vTree.reason.indexOf("文档树") >= 0, JSON.stringify(vTree.reason));

ok("[1.15] readDocContent：map/数组两形态都能取到正文，读不到返回 null（不编）",
	LG.readDocContent(idxMap, LG.LEDGER_KEYS.roadmap) === SAMPLE
	&& LG.readDocContent(idxArr, LG.LEDGER_KEYS.roadmap) === SAMPLE
	&& LG.readDocContent(idxMap, "不存在.md") === null, "");

ok("[1.16] LEDGER_KEYS 与索引键同源（写死的是**相对 docs/ 的路径**，可被生成器对账）",
	LG.LEDGER_KEYS.roadmap === "00-统筹入口/03-待完成任务清单.md"
	&& LG.LEDGER_KEYS.done === "00-统筹入口/04-已完成任务清单.md",
	LG.LEDGER_KEYS.roadmap + " | " + LG.LEDGER_KEYS.done);

/* ── [1.17–1.19] 用**真实台账文件**对账 ─────────────────────────────
 * 为什么必须跑真文件：上面 [1.1–1.16] 用的是我自己的样本 —— 样本与判据同源，
 * 判据退窄时样本会跟着一起退窄（假绿）。真实台账里的编号写法五花八门：
 *   `T-V12-101~104`（区间）· `T-P1-001..006` · `T-PLUG-001/002/003/004` · `T-CONV-P2（重复行）`
 * 加行尾 `$` 锚点会把它们**整行静默丢弃**（第 5 批实测：03 少 1 条、04 少若干条）。 */
const docsRoot = fileURLToPath(new URL("../../docs/", import.meta.url));
for (const [label, rel] of [
	["03-待完成任务清单.md", "00-统筹入口/03-待完成任务清单.md"],
	["04-已完成任务清单.md", "00-统筹入口/04-已完成任务清单.md"]
]) {
	let text;
	try { text = await readFile(docsRoot + rel, "utf8"); } catch (e) { text = null; }
	if (text === null) {
		ok("[1.17] 真实台账 " + label + "：文件可读", false, "读不到 " + docsRoot + rel);
		continue;
	}
	const realRows = LG.parseLedgerRows(text);
	const ids = realRows.map((r) => r.id);
	const declared = text.split(/\r?\n/).map((l) => l.trim())
		.filter((l) => /^\|\s*T-/.test(l))
		.map((l) => l.replace(/^\|/, "").split("|")[0].trim());
	const missed = declared.filter((d) => ids.indexOf(d) < 0);
	ok("[1.17] 真实台账 " + label + "：解析 " + realRows.length + " 条 · `| T-` 起始的 " + declared.length + " 条一条不落",
		declared.length > 0 && missed.length === 0,
		missed.length === 0 ? "无遗漏" : "漏掉 " + JSON.stringify(missed.slice(0, 5)));
	ok("[1.18] 真实台账 " + label + "：解析出的编号都符合编号约定（`T-` 前缀）",
		ids.length > 0 && ids.every((i) => i.indexOf("T-") === 0),
		ids.filter((i) => i.indexOf("T-") !== 0).slice(0, 5).join(",") || "全部符合");
}
ok("[1.19] 区间写法的编号 `T-V12-101~104` 能被解析（去掉行尾锚点后才成立）",
	LG.parseLedgerRows("| T-V12-101~104 | 后优化 4 项 | P3 | — | 🟡 backlog |").length === 1,
	JSON.stringify(LG.parseLedgerRows("| T-V12-101~104 | 后优化 4 项 | P3 | — | 🟡 backlog |").map((r) => r.id)));

/* ══════════════════════════════════════════════════════════════════
 * [2] 四个裁剪目标的判据与护栏
 * ══════════════════════════════════════════════════════════════════ */
section("[2] 裁剪目标判据与双重护栏（bridge/host-panel-trim.js）");

/* 🔴 2026-09-14 **判据更新**（原判据：恰好 3 个目标）。
 *    第 6 批需求 1 用户原话：「总监和下面那一个，**这两列不要**」
 *    ⇒ 目标由 3 个变为 4 个（新增「总监」标题条），且「总监对话」由 `up:0` 改回 `up:1`
 *      （第 5 批留 `up:0` 是为了保住行内那枚 `—` 折叠按钮；本轮该按钮的职责**已由插件侧
 *        `#dsh-host-col-min` 顶替**，见 `bridge/host-director-column.js`）
 *    ⇒ 旧判据会把"按新需求做对了"读成"功能坏了"，属典型**闸门过期**（纪律 14）。 */
ok("[2.1] 恰好四个目标，key 依次为 智能体行 / 总监标题条 / 总监对话行 / 对话页标题栏",
	HP.TRIM_TARGETS.length === 4
	&& HP.TRIM_TARGETS.map((t) => t.key).join(",") === "host-agent-row,host-director-panel-title,host-director-chat-title,host-chat-titlebar",
	HP.TRIM_TARGETS.map((t) => t.key).join(","));
ok("[2.2] 每个目标都写了 why（可解释，不是黑箱名单）",
	HP.TRIM_TARGETS.every((t) => typeof t.why === "string" && t.why.length > 10), "");

dom = makeDom();
globalThis.document = dom.document;
const host = buildHostDom(dom);
const hits0 = HP.findTrimTargets();
ok("[2.3] 正例：完整宿主残留 ⇒ 四个目标全命中",
	hits0.length === 4, "命中 " + JSON.stringify(hits0.map((h) => h.key)));
ok("[2.4] 「智能体行」的目标元素上溯到**行**（agentRow），不是那枚文字 div",
	hits0.some((h) => h.key === "host-agent-row" && h.node === host.agentRow), "");
/* 🔴 第 6 批关键判据（这条防的是本批真踩到的一次事故）：
 *    该目标曾写成 `up:1` ⇒ 上溯到**整个宿主总监列** ⇒ 整列 display:none，
 *    而"两条已不可见"的断言因此**假绿**（列都没了当然看不见 —— 判据越宽越像通过）。 */
ok("[2.5] 🔴 「总监」标题条的目标元素是**那一行本身**（up:0），**不是整个总监列**",
	hits0.some((h) => h.key === "host-director-panel-title" && h.node === host.panelTitleRow)
	&& !hits0.some((h) => h.key === "host-director-panel-title" && h.node === host.panel),
	"命中节点=" + (hits0.find((h) => h.key === "host-director-panel-title") ? "行" : "无"));
ok("[2.6] 「总监对话」的目标元素上溯到**整行**（up:1）—— 第 6 批要求这一行整行去掉",
	hits0.some((h) => h.key === "host-director-chat-title" && h.node === host.titleRow), "");
ok("[2.7] 「对话页标题栏」的目标元素是那个蓝色 div，不是 viewArea 或 group",
	hits0.some((h) => h.key === "host-chat-titlebar" && h.node === host.bar), "");

let d1 = makeDom();
globalThis.document = d1.document;
buildHostDom(d1, { panelInsidePlugin: true });
const guardOne = HP.findTrimTargets();
ok("[2.8] 护栏①（面板落在插件自挂容器内 ⇒ 文本/结构类面板目标一个都不命中）",
	!guardOne.some((h) => h.key === "host-agent-row" || h.key === "host-director-chat-title" || h.key === "host-director-panel-title"),
	JSON.stringify(guardOne.map((h) => h.key)));
ok("[2.9] 护栏①的**正对照**：结构判据类目标在插件容器之外，仍然命中 —— 证明不是「扫描整体失效」",
	guardOne.some((h) => h.key === "host-chat-titlebar"),
	JSON.stringify(guardOne.map((h) => h.key)));

let d2 = makeDom();
globalThis.document = d2.document;
const away = buildHostDom(d2, { titleOutsidePanel: true });
const guardTwo = HP.findTrimTargets();
const g2hit = guardTwo.find((h) => h.key === "host-director-chat-title");
ok("[2.10] 护栏②（面板外的同名「总监对话」文字不被命中）",
	Boolean(g2hit) && g2hit.node !== away.outsideTitle,
	"命中节点 " + (g2hit ? (g2hit.node === away.outsideTitle ? "面板外那枚（错）" : "面板内那行（对）") : "无"));

let d3 = makeDom();
globalThis.document = d3.document;
buildHostDom(d3, { agentRowHasChild: true });
const leafHits = HP.findTrimTargets();
ok("[2.11] 护栏③（目标文字带子元素 ⇒ 不是叶子 ⇒ 不命中；防误伤外层大容器）",
	!leafHits.some((h) => h.key === "host-agent-row"),
	JSON.stringify(leafHits.map((h) => h.key)));

const barCases = [
	["按钮文案错一个", { barButtons: ["代码", "文档", "调研", "测试", "审校"] }],
	["按钮少一颗", { barButtons: ["代码", "文档", "调研", "测试"] }],
	["按钮多一颗", { barButtons: BATON.concat(["多"]) }]
];
let barCaseIdx = 0;
for (const [label, opts] of barCases) {
	barCaseIdx++;
	const dd = makeDom();
	const oo = buildHostDom(dd, opts);
	ok("[2.12." + barCaseIdx + "] 结构判据负例（" + label + "）⇒ isHostChatTitleBar=false",
		HP.isHostChatTitleBar(oo.bar) === false, "");
}
{
	const dd = makeDom();
	const notSpanFirst = dd.el("div");
	notSpanFirst.appendChild(dd.el("em", { text: "对话" }));
	const g = dd.el("div");
	for (const b of BATON) g.appendChild(dd.el("button", { text: b }));
	notSpanFirst.appendChild(g);
	ok("[2.13] 结构判据负例：首孩子不是 <span> ⇒ false", HP.isHostChatTitleBar(notSpanFirst) === false, "");
	ok("[2.14] 结构判据负例：孩子数不是 2 / 标签不是 DIV / 入参 null ⇒ 全 false 且不抛",
		HP.isHostChatTitleBar(dd.el("div")) === false
		&& HP.isHostChatTitleBar(dd.el("span", { text: "对话" })) === false
		&& HP.isHostChatTitleBar(null) === false, "");
	/* 「总监」标题条的判据同样要「结构指纹」而不是纯文本：页签也叫「总监」。 */
	const tabLike = dd.el("div", { attrs: { style: "min-width: 180px" } });
	tabLike.appendChild(dd.el("span", { text: "总监" }));
	ok("[2.15] 🔴 结构判据负例：孩子**只有 1 个**的「总监」（页签形态）不命中",
		HP.isHostDirectorPanelTitle(tabLike) === false, "");
	const twoKidsNoPanel = dd.el("div");
	twoKidsNoPanel.appendChild(dd.el("span", { text: "总监" }));
	twoKidsNoPanel.appendChild(dd.el("span", { text: "" }));
	ok("[2.16] 🔴 结构判据负例：孩子数对了但**不在宿主面板内**（护栏）⇒ 不命中",
		HP.isHostDirectorPanelTitle(twoKidsNoPanel) === false, "");
}

/* ══════════════════════════════════════════════════════════════════
 * [3] 两处 bug 的回归防线
 * ══════════════════════════════════════════════════════════════════ */
section("[3] 第 5 批两处 bug 的回归（第 6 批按新需求更新）");

dom = makeDom();
globalThis.document = dom.document;
const b2 = buildHostDom(dom);
const appliedA = HP.applyHostPanelTrim();
const appliedDeltaA = HP.trimState.applied.length;
ok("[3.1] apply 返回本次贴上的 key（4 个）",
	appliedA.length === 4 && appliedDeltaA === 4, JSON.stringify(appliedA));
ok("[3.2] 「总监对话」**整行**被隐（display === none）—— 第 6 批需求 1：这一行整行去掉",
	b2.titleRow.style.display === "none", "row.display=" + JSON.stringify(b2.titleRow.style.display));
ok("[3.3] 🔴 只动**一个节点**：行内 `—` 按钮自身**没被单独裁剪**（无裁剪标记）",
	(b2.foldBtn.getAttribute(HP.TRIM_MARK) === null), "mark=" + JSON.stringify(b2.foldBtn.getAttribute(HP.TRIM_MARK)));
ok("[3.4] 🔴 「总监」标题条那一行也被隐（display === none），但**整列仍在**（不越级上溯）",
	b2.panelTitleRow.style.display === "none" && (b2.panel.style.display || "") !== "none",
	"row=" + JSON.stringify(b2.panelTitleRow.style.display) + " panel=" + JSON.stringify(b2.panel.style.display || ""));
ok("[3.5] 反例守护：源码里 up 必须为 1（改回 0 立刻红 —— 那样这一行会重新可见，verify-v22 的 B4 会报出可见的「总监对话」行）",
	HP.TRIM_TARGETS.find((t) => t.key === "host-director-chat-title").up === 1,
	"up=" + HP.TRIM_TARGETS.find((t) => t.key === "host-director-chat-title").up);
ok("[3.5b] 反例守护：源码里「总监」标题条的 up 必须为 0（改成 1 会把**整列**隐掉，2026-09-14 真机踩到过）",
	HP.TRIM_TARGETS.find((t) => t.key === "host-director-panel-title").up === 0,
	"up=" + HP.TRIM_TARGETS.find((t) => t.key === "host-director-panel-title").up);

const restoredN = HP.restoreHostPanelTrim();
ok("[3.6] restore 还原 4 个节点", restoredN === 4, "restored=" + restoredN);
ok("[3.7] 🔴 还原成**原值**（不是把 display 删掉 —— 纪律 26）",
	b2.titleSpan.style.display === "inline" && (b2.titleRow.style.display || "") === "" && (b2.panelTitleRow.style.display || "") === "",
	"span=" + JSON.stringify(b2.titleSpan.style.display) + " row=" + JSON.stringify(b2.titleRow.style.display || "") + " pRow=" + JSON.stringify(b2.panelTitleRow.style.display || ""));
ok("[3.8] 还原后标记全部摘除", b2.titleSpan.getAttribute(HP.TRIM_MARK) === null && b2.titleRow.getAttribute(HP.TRIM_MARK) === null, "");
const appliedB = HP.applyHostPanelTrim();
ok("[3.9] 还原 → 再 apply 能重新命中（正负对照闭环，不是「一次性生效」）",
	appliedB.length === 4 && b2.titleRow.style.display === "none" && b2.panelTitleRow.style.display === "none", JSON.stringify(appliedB));

/* bug ①：新节点必须在**同一帧内**（回调同步结束前）被隐 */
HP.uninstallHostPanelTrim();
dom = makeDom();
globalThis.document = dom.document;
const b3 = buildHostDom(dom);
moObservations = 0;
const installed = HP.installHostPanelTrim();
ok("[3.10] install 返回 true 且 observer 已挂（observe 被调用一次）",
	installed === true && moObservations === 1 && HP.trimState.observer === true,
	"installed=" + installed + " observe=" + moObservations + " observer=" + HP.trimState.observer);

/** 模拟宿主切页签：旧节点脱离文档（标记丢失），新节点先以可见态插入 */
const gone = disconnectMarked(dom.document);
const newBar = makeBarNode(dom);
b3.viewArea.appendChild(newBar);
ok("[3.11] 重挂载现场：旧标记节点已脱离（" + gone + " 个）且新节点此刻**仍可见**（这就是「一闪而逝」那一帧）",
	gone === 4 && (newBar.style.display || "") === "",
	"gone=" + gone + " newBar.display=" + JSON.stringify(newBar.style.display || ""));

const scopedBefore = HP.trimState.scopedScans;
if (typeof moCallback === "function") moCallback([{ addedNodes: [newBar] }]);
ok("[3.12] 🔴 bug① 回归：回调**同步**结束的那一刻新节点已被隐（无 300ms 可见窗口）",
	newBar.style.display === "none", "display=" + JSON.stringify(newBar.style.display));
ok("[3.13] 代价控制 = 按新增子树做范围扫描（scopedScans 有增量，不是全靠全文扫）",
	HP.trimState.scopedScans > scopedBefore, "scopedScans " + scopedBefore + " → " + HP.trimState.scopedScans);

/* 快路径：标记都还在 ⇒ 本次变动与本模块无关 ⇒ 零扫描 */
HP.uninstallHostPanelTrim();
dom = makeDom();
globalThis.document = dom.document;
buildHostDom(dom);
HP.installHostPanelTrim();
const scansBefore = HP.trimState.scans;
const skippedBefore = HP.trimState.skipped;
if (typeof moCallback === "function") moCallback([{ addedNodes: [dom.el("div", { text: "无关节点" })] }]);
ok("[3.14] 快路径：标记都在 ⇒ 跳过扫描（scans 不变）、且不重复贴（幂等）",
	HP.trimState.scans === scansBefore && HP.trimState.skipped === skippedBefore + 1,
	"scans " + scansBefore + " → " + HP.trimState.scans + " / skipped " + skippedBefore + " → " + HP.trimState.skipped);

/* 标记丢失 ⇒ 不能"以为还在"，必须重扫 */
const scansBefore2 = HP.trimState.scans;
const gone2 = disconnectMarked(dom.document);
if (typeof moCallback === "function") moCallback([{ addedNodes: [] }]);
ok("[3.15] 标记丢了（" + gone2 + " 个）⇒ 走慢路径重扫（scans+1），而不是以为「还活着」",
	gone2 === 4 && HP.trimState.scans === scansBefore2 + 1,
	"gone=" + gone2 + " scans " + scansBefore2 + " → " + HP.trimState.scans);

HP.uninstallHostPanelTrim();
ok("[3.16] uninstall 后 observer=false（可反复装卸，不泄漏）",
	HP.trimState.observer === false, "");

const hpSrc = await readFile(new URL(HP_SRC), "utf8");
const hpBare = stripComments(hpSrc);
ok("[3.17] 🔴 源码（剥注释后）**不得**出现 setTimeout（bug ① 的根因就是它）",
	hpBare.indexOf("setTimeout") < 0,
	hpBare.indexOf("setTimeout") < 0 ? "0 次" : hpBare.slice(0, hpBare.indexOf("setTimeout")).split("\n").length + " 行附近命中");

/* ══════════════════════════════════════════════════════════════════
 * [4] 降级必须可见（纪律 19：降级可以，无声不行）
 * ══════════════════════════════════════════════════════════════════ */
section("[4] 降级可见性");

const savedDoc = globalThis.document;
globalThis.document = {};
HP.trimState.degraded = false;
HP.trimState.reason = null;
const none = HP.findTrimTargets();
ok("[4.1] document 缺 querySelectorAll ⇒ findTrimTargets 返回空**且** reason 非空",
	Array.isArray(none) && none.length === 0 && HP.trimState.degraded === true
	&& String(HP.trimState.reason || "").indexOf("querySelectorAll") >= 0,
	"reason=" + JSON.stringify(HP.trimState.reason));

HP.trimState.reason = null;
const none2 = HP.applyHostPanelTrim();
ok("[4.2] apply 在同样环境下**也**要留下原因（不许静默返回 []）",
	Array.isArray(none2) && none2.length === 0 && String(HP.trimState.reason || "").indexOf("querySelectorAll") >= 0,
	"reason=" + JSON.stringify(HP.trimState.reason));

HP.trimState.reason = null;
const none3 = HP.restoreHostPanelTrim();
ok("[4.3] restore 在同样环境下也要留下原因",
	none3 === 0 && String(HP.trimState.reason || "").indexOf("querySelectorAll") >= 0,
	"reason=" + JSON.stringify(HP.trimState.reason));

globalThis.document = savedDoc;
/* 正对照必须在一棵**完好的**宿主树上做（上一节 [3.15] 把带标记的节点摘掉了，
 * 若直接复用那棵残树，"命中 0" 是现场如此、不是函数坏了 —— 那是假红）。 */
dom = makeDom();
globalThis.document = dom.document;
buildHostDom(dom);
const afterRecover = HP.findTrimTargets();
ok("[4.4] 正对照：DOM 恢复后同一函数立刻能正常命中 4 个（证明 [4.1–4.3] 不是「函数整体坏了」）",
	afterRecover.length === 4, "命中 " + afterRecover.length);

ok("[4.5] trimState 的降级信息可被真机脚本读到（window.__dshHostPanelTrim.trimState）",
	typeof HP.trimState.reason === "string" && typeof HP.trimState.degraded === "boolean", "");

/* ══════════════════════════════════════════════════════════════════
 * 汇总
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n" + "═".repeat(59));
console.log("  通过 " + pass + " / 失败 " + fail);
if (fail) {
	console.log("  失败项：");
	for (const f of failures) console.log("    - " + f);
	console.log("  IS_PASS: FALSE（fail=" + fail + "）");
	console.log("═".repeat(59));
	process.exit(1);
}
console.log("  IS_PASS: TRUE（fail=0）");
console.log("═".repeat(59));
process.exit(0);
