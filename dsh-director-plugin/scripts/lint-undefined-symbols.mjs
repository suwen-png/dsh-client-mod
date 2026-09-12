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
	const codeForRefs = code.replace(/^[ \t]*import\s+[^;]*;/gm, (s) => " ".repeat(s.length));
	const referenced = new Set();
	for (const m of codeForRefs.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)/gm)) referenced.add(m[2]);

	return { exported, exportBlockNames, imported, declared, referenced, importUnusedCandidates, code };
}

const files = walk(SRC);
const parsedByRel = new Map();
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

	// [3] import 未使用（仅提示）
	for (const { name, from } of p.importUnusedCandidates) {
		let hits = 0;
		const re = new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, "\\$")}`, "gm");
		const body = strip(readFileSync(join(ROOT, rel), "utf8"));
		while (re.exec(body)) hits++;
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
	console.log("SELFTEST: " + (bad === 0 ? "PASS（" + cases.length + "/" + cases.length + "）" : "FAIL（" + (cases.length - bad) + "/" + cases.length + "）"));
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
