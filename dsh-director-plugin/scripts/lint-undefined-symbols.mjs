#!/usr/bin/env node
/**
 * lint-undefined-symbols.mjs —— 「跨文件导出符号未 import 就使用」静态检查器
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要这个检查器（2026-09-12 真机事故复盘 · 第二次同类）
 * ──────────────────────────────────────────────────────────────────
 * 事故一（本轮）：`src/client-entry.js` 的 `installDirectorView()` 调用 `dshLog(...)`，
 *   但该文件**从未 import 它** ⇒ 运行时 ReferenceError。
 *   更致命的二阶效应：catch 块内部**也**调用了 `dshLog`，
 *   而 catch 块里的抛错**不在 try 的保护范围内** ⇒ 异常直接逃出函数
 *   ⇒ 函数末行的 `window.__dshDirectorView = out` 永不执行
 *   ⇒ 真机上连「注册失败原因」这个诊断字段都拿不到，排查被多耗掉一整轮。
 * 事故二（同日早些时候）：`export { ... }` 块里引用了未 import 的标识符
 *   ⇒ 构建产物 `SyntaxError: Export 'X' is not defined`。
 *
 * 共同根因：**JS 的动态性让「未定义标识符」只能等到运行时/链接期才暴露**，
 * 而打包器（本项目的 build.mjs）只解析 `import` 边，**不会**校验裸标识符。
 * ⇒ 必须有一道静态闸门，在构建前把它挡住。
 *
 * ══════════════════════════════════════════════════════════════════
 * 检查的三类目标
 * ──────────────────────────────────────────────────────────────────
 *  [1] 跨文件导出符号被引用但未 import   （本次事故）
 *  [2] `export { X }` 块中的 X 未定义/未 import（本日早先事故）
 *  [3] import 了但**从未使用**的符号     （不报错，仅提示，防死代码累积）
 *
 * 已知误报边界（刻意接受的保守取舍，宁可少报不错报）：
 *   - 属性访问 `a.b` / `a?.b` 一律跳过（b 不算引用）
 *   - 字符串 / 注释内的内容会先被剥离
 *   - 对象字面量的简写属性 `{ dshLog }` 会被当作引用（**这是对的**，简写属性确会求值）
 *   - 全局环境注入（window / document / React…）不在导出表内，天然不参与检查
 *
 * 用法：
 *   node scripts/lint-undefined-symbols.mjs          # 报告模式（有 [1]/[2] 则 exit 1）
 *   node scripts/lint-undefined-symbols.mjs --json   # 机器可读输出
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");
const AS_JSON = process.argv.includes("--json");

/** 递归收集 src 下的 .js */
function walk(dir, acc = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, acc);
		else if (name.endsWith(".js")) acc.push(p);
	}
	return acc;
}

/** 剥离注释与字符串 —— 避免把注释里的符号名当成引用 */
function strip(src) {
	let out = "";
	let i = 0;
	const n = src.length;
	while (i < n) {
		const c = src[i], d = src[i + 1];
		if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
		if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
		if (c === '"' || c === "'" || c === "`") {
			const q = c; out += " "; i++;
			while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; }
			i++; continue;
		}
		// 正则字面量（保守：仅当 / 前是 ( , = : [ ! & | ? { ; 或行首）
		if (c === "/" && /[=(:,[!&|?{;]\s*$/.test(out)) {
			i++; let cls = false;
			while (i < n) {
				if (src[i] === "\\") { i += 2; continue; }
				if (src[i] === "[") cls = true;
				else if (src[i] === "]") cls = false;
				else if (src[i] === "/" && !cls) { i++; break; }
				else if (src[i] === "\n") break;
				i++;
			}
			out += " ";
			while (i < n && /[gimsuy]/.test(src[i])) i++;
			continue;
		}
		out += c; i++;
	}
	return out;
}

/** 取某个 { 的配对 } 的结束位置（返回配对 } 的下标） */
function matchBrace(src, open) {
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		if (src[i] === "{") depth++;
		else if (src[i] === "}") { depth--; if (depth === 0) return i; }
	}
	return -1;
}

/** 解析一个文件：导出名 / 导入名 / 局部声明 / 全部标识符引用 / export{} 块 */
/**
 * 把 `import … from "…"` **子句体内**的注释替换成空格（行尾的 `from "…"` 保持原样）。
 *
 * 🔴 为什么必须做（2026-09-12 · 实测假阳性 2 条 + 修完后发现的同类未触发缺陷）：
 *    解析 import 的主正则用 `[^;]*?` 当子句体 —— 那个 `[^;]` 的用意是"防止跨越语句边界"。
 *    可**一旦子句内的注释里出现分号**（例如写「用法: a; b」），`[^;]*?` 就永远走不到 `from`
 *    ⇒ **整条 import 匹配失败 ⇒ 该文件所有 import 符号一次性全丢**
 *    ⇒ 未 import 假阳性洪水（正是本脚本头注里"首版 396 条"那种形态）。
 *    这个坑与"注释把相邻符号吞掉"是**同一条根因的两个出口**：注释参与了语法解析。
 *    ⇒ 正确解法不是逐个绕过，而是**把注释从 import 语法里摘出去**。
 */
function stripImportComments(src) {
	return src.replace(
		/^([ \t]*import\s+)([\s\S]*?)(\s+from\s*["'][^"']+["'])/gm,
		(full, head, body, tail) => head
			+ body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
			+ tail
	);
}

/* ══════════════════════════════════════════════════════════════════════════
 * [4] 号检查：**裸引用的大写常量未定义**
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 为什么要有它（2026-09-14 真机事故 · CONSOLE_ACTIONS）：
 *    对 `DirectorPage.js` 做整体重写时删掉了一个模块级常量定义，却保留了它的引用
 *    ⇒ `ReferenceError: CONSOLE_ACTIONS is not defined`（抛在渲染期）
 *    ⇒ 宿主**错误边界**兜底成 `<div data-slot-error="conversation.view">`
 *    ⇒ **总监页整页空白**，而 `window.__dshDirectorView` 依旧是 `{registered:true}`
 *      （**注册成功 ≠ 渲染成功**，这一点让排查方向误导了很久）。
 *    本脚本当时**一条都没报** —— 因为 [1] 的口径是"引用了**别的文件导出**的符号"，
 *    而该符号从未被任何文件导出 ⇒ 落在口径之外。这就是"闸门盲区"：
 *    **不是判据写错了，而是根本没有这一类判据。**
 *
 * 🔴 为什么只盯「全大写」这一小类（刻意的窄口径，正负对照见 --selftest）：
 *    通用「未定义标识符」检查在本仓会淹在噪声里 —— 该 extractor 是启发式的，
 *    `declared` 靠正则猜（解构 / 参数 / 对象键 / 单参箭头），任何漏猜都变假阳性，
 *    而**假阳性比没有闸门更糟**（会逼人绕过闸门）。
 *    全大写常量（`^[A-Z][A-Z0-9_]{2,}$`）恰好是：①引发本次事故的那一类；
 *    ②本仓作为"模块级常量表"的固定写法；③内建名有限且可枚举 ⇒ **噪声面接近零**。
 *    代价是"只覆盖这一小类"，但这正是要防的那一类。
 * ══════════════════════════════════════════════════════════════════════════ */

/** JS 内建 / 宿主已知全局里的大写名（全大写口径下需要豁免的集合）。
 *  只列**全大写且 ≥3 字符**的：小写开头的（window/document/console/process…）本就不在口径内。
 *
 *  ⚠️ 2026-09-14 第一次全量跑的真实教训：白名单**只写了 ECMAScript 内建**，
 *     于是 `URL`（合法宿主全局，本仓 4 个文件在用）被判成"未定义" —— 4 条假阳性。
 *     教训：这份清单的**正确性边界不在 ECMAScript 规范里，而在运行环境里**。
 *     ⇒ 改成双轨：① 静态表收**浏览器独有**的（Node 里查不到，必须手写）；
 *                ② 运行时从 `globalThis` **自动派生**（Node 自带 / 宿主注入的都自动豁免，
 *                   将来加新内建不必回来改这个文件）。 */
const BUILTIN_UPPER_STATIC = [
	"NaN", "Infinity",
	"JSON", "Math", "Object", "Array", "Number", "String", "Boolean", "Symbol", "Function", "Buffer",
	"Promise", "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Reflect",
	"Date", "RegExp", "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError",
	"EvalError", "URIError", "AggregateError",
	"BigInt", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "WebAssembly", "Intl",
	"Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
	"Int32Array", "Uint32Array", "Float32Array", "Float64Array",
	"BigInt64Array", "BigUint64Array",
	"globalThis",
	// —— 浏览器 / DOM 独有（Node 里不存在，必须显式列出）——
	"URL", "URLSearchParams", "TextEncoder", "TextDecoder",
	"AbortController", "AbortSignal", "Blob", "File", "FileReader", "FormData",
	"Headers", "Request", "Response", "WebSocket", "XMLHttpRequest", "DOMException",
	"HTMLElement", "HTMLDivElement", "HTMLInputElement", "HTMLButtonElement", "HTMLCanvasElement",
	"Element", "Node", "NodeList", "Document", "Window", "Navigator", "Screen", "Storage",
	"Event", "CustomEvent", "EventTarget", "MutationObserver", "ResizeObserver", "IntersectionObserver",
	"MutationRecord", "Range", "Selection", "DOMParser", "XMLSerializer", "Image", "Option",
	"CSS", "CSSStyleSheet", "Notification", "Worker", "SharedWorker", "ServiceWorker",
	"AudioContext", "MediaStream", "RTCPeerConnection", "IDBDatabase", "IDBKeyRange", "IDBTransaction",
	"ImageData", "Path2D", "OffscreenCanvas", "MatchMedia", "MediaQueryList", "PerformanceObserver",
	"WebGLRenderingContext", "ResizeObserverEntry", "ClipboardItem"
];
const BUILTIN_UPPER = new Set(BUILTIN_UPPER_STATIC);
/* ② 运行时派生：把 Node / 宿主真正提供的全大写全局一并豁免（防"白名单漏项"复发） */
try {
	for (const nm of Object.getOwnPropertyNames(globalThis)) {
		if (/^[A-Z][A-Z0-9_]{2,}$/.test(nm)) BUILTIN_UPPER.add(nm);
	}
} catch (_) { /* 极不可能；退化为静态表，不影响主流程 */ }

/** 是否属于"该豁免的全大写名"。抽成函数是为了让 --selftest 能直接校准这份白名单。 */
function isBuiltinUpper(name) {
	return BUILTIN_UPPER.has(name);
}

/**
 * 扫出本文件中「裸引用但无定义」的大写常量名（排序后返回）。
 * @param {{referenced:Set<string>, imported:Set<string>, declared:Set<string>}} p parse() 的产物
 * @param {Map<string,string[]>} globalExports 全局导出表（name -> 文件列表）——
 *        命中它的交给 [1] 号检查，本函数不重复计数。
 * @returns {string[]}
 */
function scanBareUpperConsts(p, globalExports) {
	const out = [];
	for (const name of p.referenced) {
		if (!/^[A-Z][A-Z0-9_]{2,}$/.test(name)) continue; // 全大写（≥3 字符）才入口径
		if (isBuiltinUpper(name)) continue;               // JS 内建 / 宿主全局
		if (p.imported.has(name)) continue;               // 已 import
		if (p.declared.has(name)) continue;               // 本文件已声明
		if (globalExports.has(name)) continue;            // 跨文件导出 → 由 [1] 号报，避免重复
		out.push(name);
	}
	return out.sort();
}

function parse(src) {
	const code = strip(src);

	// ---- 导出 ----
	const exported = new Map(); // name -> { line }
	const addExport = (name) => {
		if (name && !exported.has(name)) {
			const line = src.slice(0, src.indexOf(name)).split("\n").length;
			exported.set(name, { line });
		}
	};
	for (const m of code.matchAll(/export\s+(?:async\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) addExport(m[1]);
	for (const m of code.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) addExport(m[1]);
	for (const m of code.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) addExport(m[1]);

	// export { A, B as C }  —— 记录块内**被引用的源名**（用于检查 [2]）
	const exportBlockSrc = [];
	const exportBlockNames = [];
	for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
		for (const raw of m[1].split(",")) {
			const part = raw.trim();
			if (!part) continue;
			const asM = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
			const localName = asM ? asM[1] : part.replace(/^default\s+/, "").trim();
			const pubName = asM ? asM[2] : localName;
			if (/^[A-Za-z_$][\w$]*$/.test(localName)) exportBlockNames.push(localName);
			if (/^[A-Za-z_$][\w$]*$/.test(pubName)) addExport(pubName);
		}
		if (m[1].includes("\n")) exportBlockSrc.push(m[1]);
	}

	// ---- import ----
	// 🔴 必须在**原始源码**上解析 import：`strip()` 会把字符串字面量抹成空格，
	//    而 `from "./messages.js"` 里的路径正是字符串 ⇒ 用 code 解析必然全军覆没，
	//    导致「已 import 的符号被判为未 import」的**假阳性洪水**（首版实测 396 条）。
	//    教训：剥离注释/字符串的预处理，只能用于「找引用」，不能用于「解析 import 边」。
	const imported = new Set();
	const importUnusedCandidates = [];
	/* 先在"剥掉 import 子句内注释"的副本上解析（见 stripImportComments 头注：注释里的分号会让整条 import 丢失） */
	const srcForImport = stripImportComments(src);
	for (const m of srcForImport.matchAll(/^[ \t]*import\s+([^;]*?)\s+from\s*["']([^"']+)["']/gm)) {
		/* 🔴 必须先剥掉子句内的注释（2026-09-12 修 · 实测假阳性 2 条）：
		 *    `split(",")` 是按逗号切分，而注释会与它**后面紧挨的那个符号**被切进同一项：
		 *         ……, DESIGN_ROLE,
		 *         // 版本快照（2026-09-12 新增）
		 *         saveVersion, listVersions
		 *    该项 trim 后是 "// 版本快照（…）\n\tsaveVersion" ⇒ 不匹配标识符正则
		 *    ⇒ **saveVersion 整条被判为「未 import 就使用」**，报出阻塞级假阳性。
		 *
		 *    根因判定（台账规则 H）：**在检查器一侧**，不在被检代码 ——
		 *    在 import 子句里写一行注释是**完全合法**的写法，而闸门被它骗过。
		 *    故这里修检查器，而**不是**把注释搬走：搬走只让下一个人再踩一次。
		 *    （台账规则 F：本修正已做正负对照校准，见脚本末尾 --selftest。） */
		const clause = m[1]
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/\/\/[^\n]*/g, " ")
			.trim();
		const braces = clause.match(/\{([^}]*)\}/);
		if (braces) {
			for (const raw of braces[1].split(",")) {
				const part = raw.trim();
				if (!part) continue;
				const asM = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
				const local = asM ? asM[2] : part;
				if (/^[A-Za-z_$][\w$]*$/.test(local)) { imported.add(local); importUnusedCandidates.push({ name: local, from: m[2] }); }
			}
		}
		const rest = clause.replace(/\{[^}]*\}/, "").replace(/,\s*,/g, ",").split(",").map((s) => s.trim()).filter(Boolean);
		for (const r of rest) {
			const nm = r.replace(/^\*\s+as\s+/, "");
			if (/^[A-Za-z_$][\w$]*$/.test(nm)) { imported.add(nm); importUnusedCandidates.push({ name: nm, from: m[2] }); }
		}
	}

	// ---- 局部声明 ----
	const declared = new Set();
	for (const m of code.matchAll(/(?:^|[^\w$.])(?:const|let|var|function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) declared.add(m[1]);
	/* 🔴 补齐**同一 const 语句里的后续声明符**（2026-09-14 修 · 假阳性）：
	 *    `const WHITE = 0, GRAY = 1, BLACK = 2;` 只有 WHITE 会被上面那条正则认到，
	 *    GRAY / BLACK 于是被 [4] 号检查报成「裸引用的大写常量未定义」阻塞级 ——
	 *    实测命中 `src/logic/dag.js`（DFS 三色标记），而那行代码**本来就是对的**。
	 *    这是本项目已踩过 5 次的同一个坑（「一行多个声明符」），前几次都是改产品去迎合工具
	 *    （把常量拆成三行）；这次**在检查端修** —— 工具报错就该修工具，让代码迁就工具是反的。
	 *    判据收得很紧：只认「语句起始 或 逗号之后，且**紧跟 `=`**」的名字。
	 *    这样 `const x = f(a, Y = 2)` 顶多多认一个真实局部名（无害），
	 *    而不会把任意实参当成声明 —— 后者会**掩盖真缺陷**，比假阳性危险得多（U-P8 就守这条）。 */
	for (const m of code.matchAll(/(?:^|[^\w$.])(?:const|let|var)\s+([^;\n]*)/gm)) {
		for (const d of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) declared.add(d[1]);
	}
	// 函数/箭头函数参数（粗略但足够：把所有 (...) => 与 function (...) 内的名字都当成本地）
	for (const m of code.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
		for (const nm of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(nm[0]);
	}
	for (const m of code.matchAll(/function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g)) {
		for (const nm of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(nm[0]);
	}
	// 对象字面量方法简写 / getter / setter：`async deleteDoc(docId) {` / `get x() {`
	// 🔴 漏掉这一条会把 docs.js:170 的 `async deleteDoc(docId) {}` 误判为「未 import 就使用」
	//    （实测假阳性：docs.js|deleteDoc）。控制关键字（if/for/while/switch/catch）会一并入表，
	//    但关键字不可能是跨文件导出名，无害。
	for (const m of code.matchAll(/(?:^|[^\w$.])(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) declared.add(m[1]);
	// catch (e)
	for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
	// 单参数箭头 x => 
	for (const m of code.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/gm)) declared.add(m[1]);
	// 解构里的名字
	for (const m of code.matchAll(/(?:const|let|var)\s*[\[{]([^\]}]*)[\]}]/g)) {
		for (const nm of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(nm[0]);
	}
	// 对象字面量键（`{ label: ..., dshLog: ... }` 的键名）——避免把键当引用
	for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) declared.add(m[1]);

	// ---- 全部标识符引用（排除属性访问 .foo）----
	// 🔴 必须先把 import 语句整体抹白再扫引用：`import { saveDirectorNode as pdbSaveNode }`
	//    里的**原始名** saveDirectorNode 会被当成一次"引用"，但它只是别名重命名，
	//    并非真的使用了该符号 ⇒ 实测假阳性：hierarchy.js|saveDirectorNode 等 4 条。
	//
	// 🔴 2026-09-14 又一条（**由 [4] 号检查的正负对照抓出来**，不是靠读代码想出来的）：
	//    排除属性访问的正则用 `[^\w$.]` 当"前一个字符不能是点"，可**展开/剩余运算符 `...`
	//    恰好也是点** ⇒ `...CONSOLE_ACTIONS.map(...)` 里的 CONSOLE_ACTIONS 被当成属性而**整个漏掉**。
	//    后果：本次事故的**原始写法**（正是展开）**加了 [4] 号检查也依然报绿** ——
	//    闸门"看着有了"却对目标缺陷无效，比没有闸门更危险（台账规则 F 的原话）。
	//    ⇒ 扫引用前先把 `...` 抹成等长空格：展开/剩余运算符**不是**属性访问。
	//    这是修 [1] 号的**同一处**盲区（`h(...arr)` 里的 arr 之前也被漏掉），一并修好。
	const codeForRefs = code
		.replace(/\.\.\./g, "   ")
		.replace(/^[ \t]*import\s+[^;]*;/gm, (s) => " ".repeat(s.length));
	const referenced = new Set();
	for (const m of codeForRefs.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)/gm)) referenced.add(m[2]);

	return { exported, exportBlockNames, imported, declared, referenced, importUnusedCandidates, code };
}

/**
 * 统计某符号在源码正文里的**使用次数**（[3] 号「import 未使用」的判据）。
 *
 * 🔴 2026-09-14 修：本判据与 [1]/[4] 号**同一处盲区**，当时**只修了那一处** ⇒
 *    `...LAYERS.map(...)`（展开运算符）里的 LAYERS 会被"排除属性访问"的正则
 *    `[^\w$.]` 当成属性前缀而漏掉 ⇒ hits 停在 1（只有 import 那一次）
 *    ⇒ **已被使用的符号被报成"未使用"**（假阳性提示）。
 *    取证：`OrchestratorPanel.js` 第 283 行 `...LAYERS.map(...)` 明确在用 LAYERS。
 *    ⇒ 与 [1] 号同法：扫前把 `...` 抹成等长空格。
 *
 * ⚠️ 与 [1] 号**刻意不同**：这里**不抹白 import 语句** ——
 *    判定基准就是「hits ≤ 1 表示只出现在 import 语句里」，抹白会打掉这个基准。
 *
 * @param {string} body 已 strip 过的源码
 * @param {string} name 符号名
 * @returns {number} 出现次数（含 import 语句里那一次）
 */
export function countUses(body, name) {
	const clean = String(body).replace(/\.\.\./g, "   ");
	const re = new RegExp("(^|[^\\w$.])" + String(name).replace(/\$/g, "\\$"), "gm");
	let hits = 0;
	while (re.exec(clean)) hits++;
	return hits;
}

const files = walk(SRC);const parsedByRel = new Map();
for (const f of files) {
	const rel = relative(ROOT, f).replace(/\\/g, "/");
	parsedByRel.set(rel, parse(readFileSync(f, "utf8")));
}

// ---- 全局导出表：name -> [file, ...] ----
const globalExports = new Map();
for (const [rel, p] of parsedByRel) {
	for (const name of p.exported.keys()) {
		if (!globalExports.has(name)) globalExports.set(name, []);
		globalExports.get(name).push(rel);
	}
}

const problems = [];   // [1]/[2] 阻塞级
const notices = [];    // 未使用 import，仅提示

for (const [rel, p] of parsedByRel) {
	// [1] 引用了「别的文件导出」的符号，却没 import、也没本地声明
	for (const [name, defs] of globalExports) {
		if (!p.referenced.has(name)) continue;
		if (p.imported.has(name) || p.declared.has(name)) continue;
		const others = defs.filter((d) => d !== rel);
		if (!others.length) continue; // 自己导出的，本地必然可用
		problems.push({
			kind: "[1] 未 import 就使用",
			file: rel,
			symbol: name,
			definedIn: others.join(", "),
			detail: `引用了 ${name}，但它由 ${others.join(" / ")} 导出，本文件既未 import 也无本地声明 ⇒ 运行期 ReferenceError`
		});
	}
	// [2] export{} 块里的名字必须有定义或 import
	for (const name of p.exportBlockNames) {
		if (p.imported.has(name) || p.declared.has(name)) continue;
		problems.push({
			kind: "[2] export{} 引用未定义符号",
			file: rel,
			symbol: name,
			definedIn: (globalExports.get(name) || []).join(", ") || "(无任何文件导出)",
			detail: `export{} 块导出 ${name}，但本文件未 import 也未声明 ⇒ 构建期 SyntaxError: Export '${name}' is not defined`
		});
	}
	// [3] `h(x.bind(...), ...)` —— 把 bind 结果当组件类型
	// 🔴 2026-09-12 实测踩坑：`h(layer.bind(null,"dialog"), {key:"dialog"}, child)`
	//    会把**整个 props 对象**作为第 3 个实参传给 layer ⇒ SafeLayer.children 变成普通对象
	//    ⇒ React error #31「Objects are not valid as a React child」⇒ 整个 Shell 根空白。
	//    正确写法是普通函数调用 `layer(name, key, el)`。
	{
		const re = /\bh\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.bind\(/g;
		let m;
		while ((m = re.exec(p.code))) {
			problems.push({
				kind: "[3] 把 bind 结果当组件类型",
				file: rel,
				symbol: m[1] + ".bind",
				definedIn: "—",
				detail: `h(${m[1]}.bind(...), props, child) 会把 props 对象一并当作实参传入 ⇒ children 变成普通对象 ⇒ React error #31，整棵 Shell 根空白。改为普通函数调用。`
			});
		}
	}

	// [4] 裸引用的大写常量未定义（见上方 scanBareUpperConsts 头注：2026-09-14 CONSOLE_ACTIONS 事故）
	for (const name of scanBareUpperConsts(p, globalExports)) {
		problems.push({
			kind: "[4] 裸引用的大写常量未定义",
			file: rel,
			symbol: name,
			definedIn: "(无任何文件导出，本文件也未声明)",
			detail: `引用了 ${name}，但它既非 JS 内建、本文件未声明/import、也无任何文件导出它`
				+ ` ⇒ 运行期 ReferenceError。典型后果（2026-09-14 实录）：抛在渲染期 ⇒ 宿主错误边界`
				+ ` 兜底成 data-slot-error ⇒ **整页空白**，而注册句柄仍显示 registered:true。`
		});
	}

	// [3] import 未使用（仅提示）
	for (const { name, from } of p.importUnusedCandidates) {
		const hits = countUses(strip(readFileSync(join(ROOT, rel), "utf8")), name);
		// 至少 2 次才算"用过"（1 次就是 import 语句本身）
		if (hits <= 1) notices.push({ file: rel, symbol: name, from });
	}
}

/* ── --selftest：本检查器的「正负对照校准」（台账规则 F）─────────────────────
 * 为什么闸门要自带校准：**这个闸门本身会骗人**。
 *   2026-09-12 它因为 import 子句里的一行**合法注释**，报出 2 条阻塞级假阳性
 *   （saveVersion / createVersion 被判"未 import 就使用"）。
 *   假阳性比没有闸门更糟 —— 它会淹没真信号、逼人绕过闸门（台账规则 F 的原话）。
 *   ⇒ 校验器自身必须有校验器。
 *
 * 样本用完即弃，不落盘。
 *   N* = 负对照（合法边缘写法）→ **必须不报**
 *   P* = 正对照（貌似合法实则有坑）→ **必须按预期取舍**
 */
if (process.argv.includes("--selftest")) {
	const cases = [
		{ name: "N1 基线（无注释）", src: 'import { a, b } from "./x.js";\nconst r = b;', want: ["a", "b"], nope: [] },
		{ name: "N2 块注释夹在符号之间", src: 'import {\n\ta,\n\t/* 版本快照（2026-09-12 · 需求「保存」） */\n\tb\n} from "./x.js";\nconst r = b;', want: ["a", "b"], nope: [] },
		{ name: "N3 行注释夹在符号之间", src: 'import {\n\ta,\n\t// 版本快照（2026-09-12 新增）\n\tb\n} from "./x.js";\nconst r = b;', want: ["a", "b"], nope: [] },
		{ name: "N4 注释含分号（修前会整条 import 丢失）", src: 'import {\n\ta,\n\t/* 用法: x; y, z */\n\tb\n} from "./x.js";\nconst r = b;', want: ["a", "b"], nope: [] },
		{ name: "N5 as 别名 + 注释", src: 'import {\n\ta as A,\n\t// 说明\n\tb as B\n} from "./x.js";\nconst r = B;', want: ["A", "B"], nope: [] },
		{ name: "P1 注释里的假符号不得入表", src: 'import {\n\t/* fakeSymbol */\n\ta\n} from "./x.js";\nconst r = a;', want: ["a"], nope: ["fakeSymbol"] },
		{ name: "P2 副作用 import 不得吞掉下一条的符号", src: 'import "side.js";\nimport { a } from "./x.js";\nconst r = a;', want: ["a"], nope: [] }
	];
	let bad = 0;
	for (const c of cases) {
		const p = parse(c.src);
		const miss = (c.want || []).filter((s) => !p.imported.has(s));
		const extra = (c.nope || []).filter((s) => p.imported.has(s));
		const ok = !miss.length && !extra.length;
		if (!ok) bad += 1;
		console.log((ok ? "  ✅ " : "  ❌ ") + c.name
			+ (miss.length ? "  ← 缺失符号: " + miss.join(",") : "")
			+ (extra.length ? "  ← 不该入表: " + extra.join(",") : ""));
	}

	/* ── [4] 号检查的专属校准 ──
	 * 🔴 没有校准的新闸门不算交付：要证明它**在该报时报**（正对照），
	 *    也要证明它**在合法边缘写法上不报**（负对照）——后者才是它敢进 CI 的理由。
	 * 样本用最小可判定的片段；`exports` 模拟"别的文件导出了它"。 */
	const upperCases = [
		// —— 负对照：必须不报 ——
		{ name: "U-N1 本文件已声明（const）", src: 'const CONSOLE_HINT = {};\nconst r = CONSOLE_HINT;', exports: [], want: [] },
		{ name: "U-N2 已 import", src: 'import { COOKIE_BUDGET } from "./x.js";\nconst r = COOKIE_BUDGET;', exports: [], want: [] },
		{ name: "U-N3 JS 内建（JSON/Object/NaN）", src: 'const r = JSON.stringify({}) + Object.keys({}).length + (NaN ? 1 : 0);', exports: [], want: [] },
		{ name: "U-N4 由别的文件导出 ⇒ 交给 [1] 号，不重复计数", src: 'const r = SOME_EXPORTED_CONST;', exports: ["SOME_EXPORTED_CONST"], want: [] },
		{ name: "U-N5 字符串里出现的大写词", src: 'const r = "CONSOLE_ACTIONS";', exports: [], want: [] },
		{ name: "U-N6 属性访问（window.X / a.B）", src: 'const r = window.FOO_BAR + a.BAZ_QUX;', exports: [], want: [] },
		{ name: "U-N7 对象字面量的键", src: 'const m = { R4_RAIL: 1, R7_RAIL: 2 };\nconst r = m.R4_RAIL;', exports: [], want: [] },
		{ name: "U-N8 非全大写（React/DirectorPage）", src: 'const r = React.createRef() + String(DirectorPage);', exports: [], want: [] },
		{ name: "U-N9 注释里的大写词", src: '// 说明 CONSOLE_ACTIONS 的用途\nconst r = 1;', exports: [], want: [] },
		{ name: "U-N10 解构声明", src: 'const { ID_RE, NAME_RE } = X;\nconst r = ID_RE + NAME_RE;', exports: [], want: [] },
		// ↓ 这三条是"白名单自身的校准"——第一次全量跑就因漏写 URL 产生 4 条假阳性
		{ name: "U-N11 宿主全局 URL（曾漏项致 4 条假阳性）", src: 'const r = URL.createObjectURL(new Blob());', exports: [], want: [] },
		{ name: "U-N12 浏览器独有全局（Node 里查不到）", src: 'const r = new MutationObserver(() => {});', exports: [], want: [] },
		{ name: "U-N13 剩余参数（...REST_ARG 属声明）", src: 'function f(...REST_ARG) { return REST_ARG.length; }', exports: [], want: [] },
		{ name: "U-N14 同一 const 语句的后续声明符（曾致 dag.js 假阳性）", src: 'const WHITE = 0, GRAY = 1, BLACK = 2;\nconst r = WHITE + GRAY + BLACK;', exports: [], want: [] },
		{ name: "U-P5 名字像内建但环境里并不存在 ⇒ 仍须报", src: 'const r = NOT_A_REAL_GLOBAL_XYZ;', exports: [], want: ["NOT_A_REAL_GLOBAL_XYZ"] },
		// ↓ 这条对应**事故的原始写法**：展开运算符会让"排除属性访问"的正则整个漏掉该符号。
		//   第一版 [4] 号检查就是栽在这里 —— 植入缺陷后仍报绿，是正负对照把它抓出来的。
		{ name: "U-P6 展开运算符后的常量（本事故原始写法）", src: 'const r = [...CONSOLE_ACTIONS];', exports: [], want: ["CONSOLE_ACTIONS"] },
		{ name: "U-P7 展开运算符在调用实参里", src: 'const r = h("div", {}, ...CONSOLE_ACTIONS.map((a) => a.key));', exports: [], want: ["CONSOLE_ACTIONS"] },
		// —— 正对照：必须报（本次事故的类） ——
		{ name: "U-P1 事故原形（引用了但没定义）", src: 'const r = CONSOLE_ACTIONS.map((a) => a.key);', exports: [], want: ["CONSOLE_ACTIONS"] },
		{ name: "U-P2 删掉定义后残留引用", src: 'const CONSOLE_HINT = {};\nconst r = CONSOLE_HINT.a + CONSOLE_ACTIONS.length;', exports: [], want: ["CONSOLE_ACTIONS"] },
		{ name: "U-P3 多个裸大写常量", src: 'const r = A_B_C + D_E_F;', exports: [], want: ["A_B_C", "D_E_F"] },
		{ name: "U-P4 内建豁免不得外溢到自定义名", src: 'const r = JSON + MY_MISSING_ONE;', exports: [], want: ["MY_MISSING_ONE"] },
		// 守「补多声明符」那次修正**不得顺手把实参也当声明**（那会掩盖真缺陷）
		{ name: "U-P8 多声明符语句里仍有未定义常量 ⇒ 仍须报", src: 'const A_ONE = 1, B_TWO = A_ONE + MISSING_TRIPLE;', exports: [], want: ["MISSING_TRIPLE"] }
	];
	let upperBad = 0;
	for (const c of upperCases) {
		const ex = new Map();
		for (const nm of c.exports || []) ex.set(nm, ["other.js"]);
		const got = scanBareUpperConsts(parse(c.src), ex);
		const miss = (c.want || []).filter((s) => !got.includes(s));      // 该报没报
		const extra = got.filter((s) => !(c.want || []).includes(s));     // 不该报却报了
		const ok = !miss.length && !extra.length;
		if (!ok) upperBad += 1;
		console.log((ok ? "  ✅ " : "  ❌ ") + c.name
			+ (miss.length ? "  ← 该报未报: " + miss.join(",") : "")
			+ (extra.length ? "  ← 假阳性: " + extra.join(",") : ""));
	}
	bad += upperBad;

	// ── [3] 号「import 未使用」的校准样本 ──────────────────────────────
	//   这条检查**此前一直没有正负对照**，于是它的同类盲区（展开运算符）
	//   在被 [1]/[4] 号修掉之后**仍然留着**，并当场把一个在用符号报成未使用。
	//   判据：hits ≤ 1 ⇒ 判未使用（1 = 只出现在 import 语句里）。
	const useCases = [
		{ name: "U3-N1 import 后从未使用（仅 import 一次）", body: 'import { FOO } from "./x.js";\nconst r = 1;', sym: "FOO", want: 1 },
		{ name: "U3-N2 普通引用算已使用", body: 'import { FOO } from "./x.js";\nconst r = FOO;', sym: "FOO", want: 2 },
		{ name: "U3-N3 属性访问不算使用（a.FOO）", body: 'import { FOO } from "./x.js";\nconst r = a.FOO;', sym: "FOO", want: 1 },
		{ name: "U3-P1 展开运算符后的使用（🔴 原盲区）", body: 'import { FOO } from "./x.js";\nconst r = [...FOO.map((x) => x)];', sym: "FOO", want: 2 },
		{ name: "U3-P2 展开在调用实参里", body: 'import { FOO } from "./x.js";\nconst r = h("div", {}, ...FOO);', sym: "FOO", want: 2 }
	];
	let useBad = 0;
	for (const c of useCases) {
		const got = countUses(c.body, c.sym);
		const ok = got === c.want;
		if (!ok) useBad += 1;
		console.log((ok ? "  ✅ " : "  ❌ ") + c.name + (ok ? "" : "  ← 实得 " + got + " 期望 " + c.want));
	}
	bad += useBad;

	const total = cases.length + upperCases.length + useCases.length;
	const passed = total - bad;
	console.log("SELFTEST: " + (bad === 0 ? "PASS（" + passed + "/" + total + "）" : "FAIL（" + passed + "/" + total + "）")
		+ "  [import 解析 " + cases.length + " 例 / [4] 号检查 " + upperCases.length + " 例 / [3] 号检查 " + useCases.length + " 例]");
	process.exit(bad === 0 ? 0 : 1);
}

// ---- 输出 ----
if (AS_JSON) {
	console.log(JSON.stringify({ problems, notices, fileCount: files.length }, null, 2));
} else {
	console.log("═══════════════════════════════════════════════════════════");
	console.log(" lint-undefined-symbols —— 跨文件导出符号静态检查");
	console.log(` 扫描 ${files.length} 个文件 / 全局导出符号 ${globalExports.size} 个`);
	console.log("═══════════════════════════════════════════════════════════");
	if (!problems.length) {
		console.log("\n✅ 无阻塞级问题（[1] 未 import 就使用 / [2] export{} 未定义符号）");
	} else {
		console.log(`\n❌ 发现 ${problems.length} 处阻塞级问题：\n`);
		for (const p of problems) {
			console.log(`  ${p.kind}`);
			console.log(`    文件   ${p.file}`);
			console.log(`    符号   ${p.symbol}`);
			console.log(`    定义于 ${p.definedIn}`);
			console.log(`    说明   ${p.detail}\n`);
		}
	}
	if (notices.length) {
		console.log(`ℹ️  未使用的 import（提示，不阻塞）：${notices.length} 处`);
		for (const n of notices.slice(0, 20)) console.log(`    ${n.file}  ←  ${n.symbol}  (from ${n.from})`);
		if (notices.length > 20) console.log(`    … 其余 ${notices.length - 20} 处省略`);
	}
	console.log("\n-----------------------------------------------");
	console.log(`IS_PASS: ${problems.length === 0 ? "TRUE" : "FALSE"}（阻塞级=${problems.length}，提示级=${notices.length}）`);
}

process.exit(problems.length === 0 ? 0 : 1);
