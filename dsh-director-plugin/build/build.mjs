/**
 * build.mjs — 零依赖插件 bundler（T-PLUG-005 P1 启用）
 *
 * 为什么不用 esbuild：
 *   本插件 src/ 全部为**本地相对导入**（无第三方 npm 依赖），导入图为单层无环。
 *   为避免引入构建依赖（host 侧无 esbuild，且不应向用户安装环境注入构建工具），
 *   自实现最小 ESM 拼接器。
 *
 * 产物形态（严格对齐 Harness 官方 client bundle 契约，实测自
 *   resources/host/node_modules/@fufan/dsh-plugin-llm-wiki/lib/client.js）：
 *
 *   window.__ModuleLoader__.load({
 *     id: "<包名>",
 *     factory: (require) => {
 *       var module = { exports: {} };
 *       var exports = module.exports;
 *       ...各模块（拓扑序拼接，import/export 改写为局部绑定）...
 *       exports.apply = apply;
 *       exports.inject = inject;
 *       return module.exports;
 *     }
 *   });
 *
 * 约束（ADR-001）：
 *   - **严禁把 React / cordis / 平台模块打进产物** —— 它们由 factory 的 `require`
 *     提供（getStaticModules 冻结表）。本插件批次 1+2 不 import react（纯 DOM/window
 *     操作），故 require 仅用于满足契约签名。
 *   - 平台模块若出现在 src 的 import 中，构建期 fail-loud 报错。
 *
 * 使用：node build/build.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
/* 产物语法自检用（见文件末「语法闸门」）—— 用 vm.Script 只做**语法解析**，
 * 不执行代码，故不会触发 require / module 等运行时依赖。 */
import { Script } from "node:vm";

const PLUGIN_ROOT = resolve(import.meta.dirname, "..");
const SRC = join(PLUGIN_ROOT, "src");
const ENTRY = join(SRC, "client-entry.js");
const OUT = join(PLUGIN_ROOT, "lib/client.js");

/**
 * 平台模块冻结表（getStaticModules）
 *   - 出现在 import 中 → **不打包**，改写为 factory `require("<spec>")`
 *   - 非相对且不在表内 → 构建期 fail-loud（禁止外部 npm 依赖）
 */
const PLATFORM_MODULES = new Set([
	"react", "react/jsx-runtime", "react-dom", "react-dom/client",
	"@deepseek-ai/cordis",
	"@deepseek-ai/dsh-client-ui-slots",
	"@deepseek-ai/dsh-client-web-react",
	"@deepseek-ai/dsh-client-ui-primitives",
	"@deepseek-ai/dsh-client-ui-attachment",
	"@deepseek-ai/dsh-client-schema-form",
]);

const PKG_NAME = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8")).name;

/* ── 解析阶段 ─────────────────────────────────────────────────── */

const modules = new Map(); // absPath -> { id, code, deps, exportNames }
const order = [];
const visiting = new Set();
const externals = new Set(); // 被引用的平台模块（用于生成 require 语句）

const moduleId = (abs) => relative(SRC, abs).split("\\").join("/");

/**
 * 判定一个 import 说明符的类别。
 * @returns {"platform" | "local"}
 * @throws 非相对且非平台模块 → fail-loud（ADR-001 禁止外部依赖进产物）
 */
function classifySpec(spec, fromId) {
	if (PLATFORM_MODULES.has(spec)) return "platform";
	if (spec.startsWith(".")) return "local";
	throw new Error(
		`[build] ${fromId} 引入了未知的非相对模块 "${spec}"。\n` +
		`  仅允许：本地相对导入（./x.js）或平台模块（${[...PLATFORM_MODULES].join(" / ")}）。`
	);
}

function resolveModule(abs, spec) {
	const p = resolve(dirname(abs), spec);
	if (!existsSync(p)) throw new Error(`[build] 无法解析 ${spec}（来自 ${moduleId(abs)}）→ ${p}`);
	return p;
}

/** 去掉注释（export 块内可能夹注释，按 `,` 切分前必须先剥离，否则注释会被当成导出名） */
function stripComments(s) {
	return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * import 绑定对账记录（每个 import 语句一条）。
 * 用途：构建末尾核对「**原始子句里声明的项数**」与「**实际写进产物的绑定项数**」是否一致。
 * 这是本次事故（产物静默少绑 5 个符号、语法却完全合法）唯一有效的防线 ——
 * 语法闸门判不了它，md5 一致性判不了它，装机 PASS 也判不了它。
 */
const bindAudit = [];

/** 收集具名导出（供 exports 回填） */
function collectExportNames(code) {
	const names = new Set();
	// 覆盖 export [async] function/class, export const/let/var
	for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) {
		names.add(m[1]);
	}
	for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
		for (const part of stripComments(m[1]).split(",")) {
			const t = part.trim();
			if (!t) continue;
			const [orig, alias] = t.split(/\s+as\s+/).map((x) => x.trim());
			names.add(alias || orig);
		}
	}
	return [...names];
}

/**
 * 把 import/export 语句改写为「局部绑定」。
 *
 * 实现说明（为什么不用逐行正则）：
 *   src 中存在多行 import 形态（`import {\n a,\n b\n} from "./x.js";`），
 *   逐行匹配会漏。故先按行扫，遇到以 `import` 开头的行时**向后聚拢**直到
 *   出现 `from "..."` 或 `"..."` 终止符，再整体改写。
 */
function transform(abs, code) {
	const id = moduleId(abs);
	const deps = [];
	const out = [];
	const lines = code.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const t = lines[i].trim();

		// ── import 语句（含多行形态）：聚拢直到闭合 ──
		if (/^import\s/.test(t)) {
			let stmt = stripComments(t).trim();
			/* stmtRaw：**保留注释的原始子句**。用途只有一个 —— 构建末尾拿它做
			 * 「声明项数 vs 绑定项数」双路对账（见 bindAudit）。
			 * 为什么必须留一份原文：本次事故的形态是"产物少绑 5 个符号但语法合法"，
			 * 任何只看**剥完注释之后**的字符串的检查都看不出少了东西（少了就是少了，
			 * 剩下的每一项都长得合法）⇒ 必须有一份不受剥注释影响的参照。 */
			let stmtRaw = t.trim();
			let j = i;
			// 单行内已闭合（含 from "..." 或裸 "..."）则不再聚拢
			const closed = () => /from\s*["'][^"']+["']\s*;?$/.test(stmt) || /^import\s*["'][^"']+["']\s*;?$/.test(stmt);
			while (!closed() && j + 1 < lines.length) {
				j++;
				/* 🔴 注释必须**逐行剥掉**（在拼接成单行之前）—— 2026-09-12 真机事故的**第二层**根因。
				 *    第一层：注释被当成了绑定名（已由 stripComments 修）。
				 *    第二层（更隐蔽，且第一层修完仍会踩）：
				 *      下面的聚拢把多行**拼成一个单行字符串**（`stmt += " " + lines[j].trim()`），
				 *      而 stripComments 的行注释正则是 `//[^\n]*` —— 在单行里**没有 `\n` 可停**，
				 *      于是一行 `// 说明` 会一路**吃到整个字符串末尾**：
				 *          const { a, b, // 说明  c, d } = __m("x.js");
				 *                          ^^^^^^^^^^^^^^^ 全被替换成空格
				 *      ⇒ **产物语法完全合法**（`const { a, b } = ...` 是对的），
				 *        只是**静默少绑定了 5 个符号** ⇒ 运行期才炸 `X is not defined`，
				 *        而且**语法闸门抓不到**（它只判"是不是合法 JS"，不判"绑全了没有"）。
				 *      实测后果：Harness 重启后 `batch1:ERR VERSION_LIMIT is not defined`，
				 *      浮动按钮组与设计图 API 全部不挂载，而 build / install 三道关都报成功。
				 *    ⇒ 解法是**顺序**问题：注释要在"还没有跨行"时剥掉。 */
				stmt += " " + stripComments(lines[j].trim()).trim();
				/* 🔴 stmtRaw **必须用换行拼接**（而不是空格）——
				 *    写这段对账逻辑时我在这里**又踩了同一个坑**：stmtRaw 若也用空格拼成单行，
				 *    下面的 declaredItems 逐项剥注释时，`//` 会因为"没有换行可停"而吃掉该行后的项，
				 *    于是**参照物自己少算**，反而报出"声明 15 / 绑定 16"的假失败。
				 *    教训：只要还有任何一处把带注释的文本压成单行，
				 *    "注释吃行尾"就会在那里复活 —— 这个 bug 在同一文件里已出现三次。 */
				stmtRaw += "\n" + lines[j].trim();
			}
			i = j;

			// import { a, b as c } from "./x.js" | "react";
			let m = stmt.match(/^import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']\s*;?$/);
			if (m) {
				/* 绑定名提取 —— **三道防线的最后一关**（前两道：聚拢处逐行剥注释 + 上方语法闸门）。
				 *
				 * 🔴 这里**绝不能静默丢弃"无法识别的项"**。
				 *    本次事故正是以**静默**形态出现的：注释吃掉了 5 个绑定名，
				 *    产物语法完全合法、build 报成功、install 报 IS_PASS，
				 *    直到重启 Harness 才炸 `VERSION_LIMIT is not defined`。
				 *    原先的写法（split → trim → **filter(Boolean)** → map）把无法识别的项
				 *    悄悄过滤掉，等于给这类缺陷开了一条无声通道。
				 *    ⇒ 改为：不匹配「标识符」或「标识符 as 标识符」的项一律**抛错**，
				 *      让"注释污染绑定名"这一族问题在**构建期**断掉。 */
				const items = m[1]
					.split(",")
					.map((s) => stripComments(s).trim())
					.filter(Boolean);
				const bad = items.filter((s) => !/^[A-Za-z_$][\w$]*(\s+as\s+[A-Za-z_$][\w$]*)?$/.test(s));
				if (bad.length) {
					throw new Error(
						`[build] ${id}: import 子句里有无法识别的项 → ${JSON.stringify(bad)}\n` +
						`   疑似注释未被剥离（历史事故：注释吞掉后续绑定名，产物**静默少绑定** 5 个符号）。\n` +
						`   原始子句：${m[1].slice(0, 160)}`
					);
				}
				/* 🔴 双路对账：从**保留注释的原始子句**（stmtRaw）按逗号切分，再**逐项**剥注释，
				 *    得到"声明项"。正常实现下它与 items 完全相同。
				 *    但若哪天有人把"剥注释"挪回**跨行拼接之后**（历史 bug 的形态），
				 *    `//` 会吃到行尾 ⇒ items 少若干项，而 declaredItems 由 stmtRaw 得来、**不会少**
				 *    ⇒ 两者数量不等 ⇒ 当场抛错。
				 *    这是唯一能抓住「静默少绑定」的检查：产物语法合法、绑定名合法，
				 *    只有"数量对不上"这一个可观测差异。 */
				const declaredItems = ((stmtRaw.match(/\{([\s\S]*?)\}/) || [null, ""])[1])
					.split(",")
					.map((s) => stripComments(s).trim())
					.filter(Boolean);
				bindAudit.push({ id, spec: m[2], declared: declaredItems.length, bound: items.length });
				if (declaredItems.length !== items.length) {
					throw new Error(
						`[build] ${id}: import 绑定对账失败 —— 声明 ${declaredItems.length} 项，产物只绑 ${items.length} 项\n` +
						`   声明：${declaredItems.join(", ")}\n` +
						`   绑定：${items.join(", ")}\n` +
						`   ⇒ 极可能是"剥注释发生在跨行拼接之后"，注释吃掉了后续绑定名。`
					);
				}
				const binds = items
					.map((s) => {
						const [orig, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
						return alias ? `${orig}: ${alias}` : orig;
					})
					.join(", ");
				if (classifySpec(m[2], id) === "platform") {
					externals.add(m[2]);
					out.push(`\t\t\tconst { ${binds} } = require(${JSON.stringify(m[2])});`);
				} else {
					const absDep = resolveModule(abs, m[2]);
					deps.push({ spec: m[2], abs: absDep });
					out.push(`\t\t\tconst { ${binds} } = __m(${JSON.stringify(moduleId(absDep))});`);
				}
				continue;
			}
			// import * as NS from "./x.js" | "react";
			m = stmt.match(/^import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']\s*;?$/);
			if (m) {
				if (classifySpec(m[2], id) === "platform") {
					externals.add(m[2]);
					out.push(`\t\t\tconst ${m[1]} = require(${JSON.stringify(m[2])});`);
				} else {
					const absDep = resolveModule(abs, m[2]);
					deps.push({ spec: m[2], abs: absDep });
					out.push(`\t\t\tconst ${m[1]} = __m(${JSON.stringify(moduleId(absDep))});`);
				}
				continue;
			}
			// import defaultName from "./x.js" | "react";
			m = stmt.match(/^import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']\s*;?$/);
			if (m) {
				if (classifySpec(m[2], id) === "platform") {
					externals.add(m[2]);
					// ESM 默认导入语义：优先取 .default，退回模块对象本身
					out.push(`\t\t\tconst ${m[1]} = (function (m) { return (m && m.default !== void 0) ? m.default : m; })(require(${JSON.stringify(m[2])}));`);
				} else {
					const absDep = resolveModule(abs, m[2]);
					deps.push({ spec: m[2], abs: absDep });
					out.push(`\t\t\tconst ${m[1]} = __m(${JSON.stringify(moduleId(absDep))});`);
				}
				continue;
			}
			// import "./x.js";  （副作用导入，平台模块无副作用导入意义）
			m = stmt.match(/^import\s*["']([^"']+)["']\s*;?$/);
			if (m) {
				if (classifySpec(m[1], id) === "platform") {
					externals.add(m[1]);
					out.push(`\t\t\trequire(${JSON.stringify(m[1])});`);
				} else {
					const absDep = resolveModule(abs, m[1]);
					deps.push({ spec: m[1], abs: absDep });
					out.push(`\t\t\t__m(${JSON.stringify(moduleId(absDep))});`);
				}
				continue;
			}
			throw new Error(`[build] ${id}: 无法改写的 import 语句 → ${stmt.slice(0, 120)}`);
		}

		// ── export 语句 ──
		// export [async] function/class, export const/let/var  →  去前缀
		if (/^export\s+(async\s+)?(const|let|var|function\*?|class)\s/.test(t)) {
			out.push("\t\t\t" + t.replace(/^export\s+/, ""));
			continue;
		}
		// export { ... };  →  留注释占位（回填期统一处理）
		//
		// 🔴 聚合终止判据必须是「花括号配平」，**不能**用 `/\}\s*;?\s*$/`：
		//    后者在 `export { X as Y } from "…";`（花括号后还有 `from "…"`）时判不出结束，
		//    会一路吞到下一个以 `}` 结尾的行 —— 2026-09-12 实测把 20 行代码并成一条注释，
		//    产物 `SyntaxError: Unexpected token ']'`。见 docs/11 §八 反模式 E-BLD-001。
		if (/^export\s*\{/.test(t)) {
			let stmt = t;
			let j = i;
			const balanced = (s) => {
				const clean = stripComments(s);
				let d = 0;
				for (const ch of clean) { if (ch === "{") d++; else if (ch === "}") d--; }
				return d === 0 && clean.includes("}");
			};
			while (!balanced(stmt) && j + 1 < lines.length) { j++; stmt += " " + lines[j].trim(); }
			i = j;
			// 转发导出 `export { a as b } from "./x.js"` → 必须真正建立本地绑定，
			// 否则该导出**静默消失**（B-D1）。此处展开为 __m(dep) + 逐名取值。
			let fw = stmt.match(/^export\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']\s*;?$/);
			if (fw) {
				const absDep = resolveModule(abs, fw[2]);
				deps.push({ spec: fw[2], abs: absDep });
				const depId = JSON.stringify(moduleId(absDep));
				out.push(`\t\t\t__m(${depId});`);
				for (const part of stripComments(fw[1]).split(",")) {
					const p = part.trim();
					if (!p) continue;
					const [orig, alias] = p.split(/\s+as\s+/).map((x) => x.trim());
					out.push(`\t\t\tvar ${alias || orig} = __m(${depId}).${orig};`);
				}
				continue;
			}
			if (/\bfrom\b/.test(stmt)) {
				throw new Error(`[build] ${id}: 无法改写的转发导出 → ${stmt.slice(0, 120)}`);
			}
			out.push(`\t\t\t// ${stmt}`);
			continue;
		}
		// export default X  →  __defaults[id] = X
		let md = t.match(/^export\s+default\s+([\s\S]+?);?$/);
		if (md) {
			out.push(`\t\t\t__defaults[${JSON.stringify(id)}] = ${md[1].replace(/;$/, "")};`);
			continue;
		}

		out.push("\t\t\t" + lines[i]);
	}

	return { code: out.join("\n"), deps };
}

/**
 * 静态检查：模块内引用的 JSX 组件必须在本模块有绑定。
 *
 * 为何必须有：打包器把每个模块包成 `__defs[id] = function (exports) { ... }`，
 * 模块间靠 `const { X } = __m("...")` 绑定。若源码**用了组件却漏写 import**，
 * 打包器无从知晓（它只跟着 import 走）→ 产物语法合法、构建通过，
 * 直到**运行时渲染**才抛 `X is not defined`（React 会把整棵子树卸载 → 面板空白）。
 * 该缺陷 2026-09-12 真实发生过（DirectorWorkbench），排查成本高，故前移到构建期拦截。
 */
function lintUndefinedComponents(id, code) {
	// 1) 收集本模块所有可能的绑定名（过度收集是安全的，只会减少误报）
	const bound = new Set();
	const add = (n) => { const s = String(n || "").trim().replace(/^.*:\s*/, ""); if (s) bound.add(s); };
	for (const m of code.matchAll(/\bfunction\s+([A-Za-z0-9_$]+)/g)) add(m[1]);
	for (const m of code.matchAll(/\bclass\s+([A-Za-z0-9_$]+)/g)) add(m[1]);
	for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g)) add(m[1]);
	for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) m[1].split(",").forEach(add);
	for (const m of code.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) m[1].split(",").forEach(add);
	// 函数参数/解构（局部组件常来自 props 解构，如 `function Foo({ Bar }) {}`）
	for (const m of code.matchAll(/function\s*[A-Za-z0-9_$]*\s*\(\s*\{([^}]*)\}/g)) m[1].split(",").forEach(add);
	for (const m of code.matchAll(/function\s*[A-Za-z0-9_$]*\s*\(\s*([^)]*)\)/g)) m[1].split(",").forEach(add);
	for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) add(m[1]);

	// 2) 找出所有 JSX 组件引用（仅首字母大写 = 组件；含 `.` 的成员表达式跳过）
	const missing = new Map();
	const JSX = /react_jsx_runtime\.j(?:sx|sxs)\)\(\s*([A-Za-z0-9_$]+)\s*[,)]/g;
	for (const m of code.matchAll(JSX)) {
		const name = m[1];
		if (bound.has(name)) continue;
		if (!missing.has(name)) missing.set(name, m.index);
	}
	if (missing.size === 0) return;

	const detail = [...missing.keys()].map((n) => {
		const idx = missing.get(n);
		const line = code.slice(0, idx).split("\n").length;
		return `  - ${n}（模块内第 ${line} 行附近）`;
	}).join("\n");
	throw new Error(
		`[build] ${id}: 使用了未绑定的 JSX 组件（源码缺少 import）：\n${detail}\n` +
		`  提示：在源文件顶部补 \`import { X } from "./X.js";\``
	);
}

/**
 * 静态检查：**同一作用域内重复的函数声明**。
 *
 * 为何必须有：同名 `function` 声明落在同一作用域是**合法语法** —— 后声明的**静默覆盖**前一个。
 * 打包器只跟着 import 走、语法自检也只验合法性，因此这类缺陷**一路放行到运行时**，
 * 表现却是「点按钮没反应 / 数据不对」这种最难归因的形态。
 * 该缺陷 2026-09-12 真实发生过：`DirectorPage` 里 `async function deliver` 被声明两次，
 * 新增的「五步处理 → 真投递」版被旧版「记录员」整条顶掉 ⇒ 真机 G 段三红（mode 恒 idle、
 * 消息只 +1、正文是 user 原文）。排查成本高，故与 `lintUndefinedComponents` 同法前移到构建期。
 *
 * 实现：单遍扫描，跳过注释 / 字符串 / 模板 / 正则字面量后按 `{}` 维护**作用域栈**；
 * 每个 `function NAME` 记 `(当前作用域 id, NAME)`，重复即失败。
 * 注意作用域 id 用「入栈序号」而非缩进 —— 缩进相同但分属兄弟作用域的同名函数是合法的，
 * 按缩进判会误报。
 */
function lintDuplicateFnDecl(id, code) {
	const seen = new Map(); // `${scopeId}|${name}` → 首次声明所在行
	const stack = [0];
	let scopeSeq = 0;
	let i = 0;
	let prev = ""; // 上一个有效字符：用来判定 `/` 是正则字面量还是除号
	const n = code.length;
	const regexAllowed = "(,=:[!&|?{};+-*%^~<>";

	while (i < n) {
		const c = code[i];
		if (c === "/" && code[i + 1] === "/") { const j = code.indexOf("\n", i); i = j < 0 ? n : j; continue; }
		if (c === "/" && code[i + 1] === "*") { const j = code.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; }
		if (c === "\"" || c === "'" || c === "`") {
			i++;
			while (i < n) { if (code[i] === "\\") { i += 2; continue; } if (code[i] === c) { i++; break; } i++; }
			prev = c; continue;
		}
		if (c === "/" && (prev === "" || regexAllowed.indexOf(prev) >= 0)) {
			i++;
			while (i < n) { if (code[i] === "\\") { i += 2; continue; } if (code[i] === "/") { i++; break; } i++; }
			while (i < n && /[a-z]/.test(code[i])) i++; // 正则标志位
			prev = "/"; continue;
		}
		if (c === "{") { scopeSeq++; stack.push(scopeSeq); prev = c; i++; continue; }
		if (c === "}") { if (stack.length > 1) stack.pop(); prev = c; i++; continue; }
		if (code.startsWith("function", i) && !/[A-Za-z0-9_$]/.test(code[i - 1] || "")) {
			const m = /^function\s*\*?\s*([A-Za-z0-9_$]+)/.exec(code.slice(i, i + 96));
			if (m) {
				const key = stack[stack.length - 1] + "|" + m[1];
				const line = code.slice(0, i).split("\n").length;
				if (seen.has(key)) {
					throw new Error(
						`[build] ${id}: 同一作用域内**重复的函数声明** \`${m[1]}\`（第 ${seen.get(key)} 行 与 第 ${line} 行）\n` +
						`  后者会静默覆盖前者 ⇒ 运行时行为与预期不符，而语法自检不会报错。\n` +
						`  修正：删掉或重命名其中一个（通常是「旧版已废」的那份没删干净）。`
					);
				}
				seen.set(key, line);
			}
			i += 8; prev = "n"; continue;
		}
		if (!/\s/.test(c)) prev = c;
		i++;
	}
}

/** DFS 后序 → 拓扑序（被依赖者先定义） */function visit(abs) {
	if (modules.has(abs)) return;
	if (visiting.has(abs)) throw new Error(`[build] 检测到循环依赖：${moduleId(abs)}`);
	visiting.add(abs);

	const raw = readFileSync(abs, "utf8");
	const exportNames = collectExportNames(raw);
	const { code, deps } = transform(abs, raw);
	lintUndefinedComponents(moduleId(abs), code);
	lintDuplicateFnDecl(moduleId(abs), code);

	modules.set(abs, { id: moduleId(abs), code, deps, exportNames });
	for (const d of deps) visit(d.abs);
	visiting.delete(abs);
	order.push(abs);
}

/* ── 生成阶段 ─────────────────────────────────────────────────── */

function emit() {
	const p = [];
	p.push(`window.__ModuleLoader__.load({`);
	p.push(`\tid: ${JSON.stringify(PKG_NAME)},`);
	p.push(`\tfactory: (require) => {`);
	p.push(`\t\t// 平台模块（React / cordis / slots 等）由 factory 的 require 提供，不打包（ADR-001）。`);
	if (externals.size === 0) p.push(`\t\tvoid require;`);
	p.push(`\t\tvar module = { exports: {} };`);
	p.push(`\t\tvar exports = module.exports;`);
	p.push(`\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`);
	p.push(``);
	p.push(`\t\t// ── 模块运行时 ──`);
	p.push(`\t\tvar __reg = Object.create(null);`);
	p.push(`\t\tvar __defs = Object.create(null);`);
	p.push(`\t\tvar __defaults = Object.create(null);`);
	p.push(`\t\tfunction __m(id) {`);
	p.push(`\t\t\tif (__reg[id] !== void 0) return __reg[id];`);
	p.push(`\t\t\tvar def = __defs[id];`);
	p.push(`\t\t\tif (def === void 0) throw new Error("[dsh-director-plugin] unknown module: " + id);`);
	p.push(`\t\t\tvar ex = {};`);
	p.push(`\t\t\t__reg[id] = ex;`);
	p.push(`\t\t\tdef(ex);`);
	p.push(`\t\t\treturn ex;`);
	p.push(`\t\t}`);
	p.push(``);

	for (const abs of order) {
		const mod = modules.get(abs);
		p.push(`\t\t// ── ${mod.id} ──`);
		p.push(`\t\t__defs[${JSON.stringify(mod.id)}] = function (exports) {`);
		p.push(mod.code);
		for (const n of mod.exportNames) {
			p.push(`\t\t\texports.${n} = ${n};`);
		}
		p.push(`\t\t};`);
		p.push(``);
	}

	p.push(`\t\t// ── Harness client 插件契约导出 ──`);
	p.push(`\t\tvar __entry = __m(${JSON.stringify(moduleId(ENTRY))});`);
	p.push(`\t\t// 🔴 ctx 必须**透传**给 installBatch1 —— 且槽位注册要用到它。`);
	p.push(`\t\t//    历史缺陷：旧模板写 void ctx;（把 ctx 丢弃），导致插件拿不到 ctx.slots，`);
	p.push(`\t\t//    总监 tab 无法注册进宿主原生 tab 环（只能退回浮层），这是"三页签做不出来"的真根因。`);
	p.push(`\t\tvar apply = function apply(ctx) {`);
	p.push(`\t\t\t// 逐步痕迹：任一步失败都能在真机上 window.__dshApplyTrace 里看到断点（诊断用，勿删）`);
	p.push(`\t\t\tvar trace = [];`);
	p.push(`\t\t\ttry { if (typeof window !== "undefined") window.__dshApplyTrace = trace; } catch (_) {}`);
	p.push(`\t\t\tvar installed = null;`);
	p.push(`\t\t\ttry { trace.push("batch1:start"); installed = __entry.installBatch1({ ctx: ctx }); trace.push("batch1:ok"); }`);
	p.push(`\t\t\tcatch (e) { trace.push("batch1:ERR " + ((e && e.message) || e)); }`);
	p.push(`\t\t\ttry { trace.push("branch:" + typeof __entry.installBranchTreeApi); __entry.installBranchTreeApi(ctx); trace.push("branch:ok"); }`);
	p.push(`\t\t\tcatch (e) { trace.push("branch:ERR " + ((e && e.message) || e)); }`);
	p.push(`\t\t\ttry {`);
	p.push(`\t\t\t\ttrace.push("view:" + typeof __entry.installDirectorView);`);
	p.push(`\t\t\t\tvar reg = __entry.installDirectorView(ctx);`);
	p.push(`\t\t\t\ttrace.push("view:" + JSON.stringify(reg));`);
	p.push(`\t\t\t\tif (installed && typeof installed === "object") installed.directorView = reg;`);
		p.push(`\t\t\t} catch (e) { trace.push("view:ERR " + ((e && e.message) || e)); }`);
		p.push(`\t\t\ttry {`);
		p.push(`\t\t\t\ttrace.push("modelseat:" + typeof __entry.installModelSeat);`);
		p.push(`\t\t\t\tvar seat = __entry.installModelSeat(ctx);`);
		p.push(`\t\t\t\ttrace.push("modelseat:" + JSON.stringify(seat));`);
		p.push(`\t\t\t\tif (installed && typeof installed === "object") installed.modelSeat = seat;`);
		p.push(`\t\t\t} catch (e) { trace.push("modelseat:ERR " + ((e && e.message) || e)); }`);
		p.push(`\t\t\treturn installed;`);
	p.push(`\t\t};`);
		// 声明依赖的服务：slots 是 slot 注册的前置（同族先例 dsh-client-ui-trajectory 同款写法）。
		// 🔴 sessions 是**分支血缘导图**的前置：cordis 的 ctx 服务访问是 Proxy 陷阱，
		//    未声明的服务读一次就抛 cannot get property "sessions" without inject
		//    （@deepseek-ai/cordis/lib/index.js:675）。旧产物只声明了 slots ⇒
		//    ctx.sessions 恒抛错 → 被 logic/branch-tree.js 的 try/catch 吞掉 →
		//    **静默降级**成"按工作区分组的平铺树"，界面上只显示"血缘不可用"，
		//    看不出是我们少写了一个词。宿主 app-shell 自己就是
		//    inject = ["slots","sessions","layout"]（dsh-client-web/lib/index.js），同款。
		// ⚠️ 本段是模板字面量，**禁写反引号**（见文件头约束）。
		p.push(`\t\t// 依赖服务：slots（slot 注册前置）+ sessions（分支血缘导图前置）。`);
		p.push(`\t\t// 少声明 sessions 会让 ctx.sessions 抛 cannot get property ... without inject，`);
		p.push(`\t\t// 而旧代码用 try/catch 吞掉该错 → 血缘静默降级成"按工作区分组的平铺树"。`);
		p.push(`\t\tvar inject = ["slots", "sessions"];`);
	p.push(`\t\texports.apply = apply;`);
	p.push(`\t\texports.inject = inject;`);
	p.push(`\t\texports.__entry = __entry;`);
	p.push(`\t\treturn module.exports;`);
	p.push(`\t}`);
	p.push(`});`);
	p.push(``);
	return p.join("\n");
}

/* ── 主流程 ───────────────────────────────────────────────────── */

console.log("[build] 入口:", relative(PLUGIN_ROOT, ENTRY).split("\\").join("/"));
visit(ENTRY);
console.log(`[build] 模块图（拓扑序，共 ${order.length} 个）:`);
order.forEach((abs, i) => console.log(`  ${i + 1}. ${moduleId(abs)}`));
console.log(`[build] 平台外置（不打包，由 require 提供）: ${externals.size ? [...externals].join(", ") : "（无）"}`);

const bundle = emit();
if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bundle, "utf8");

/* ── 产物语法闸门（2026-09-12 新增 · 补一次真实漏检）──────────────────────
 * 为什么必须有：当天发生了一次「**三道关都报成功、产物却是坏的**」——
 *   build 打印了产物字节数、install 报 IS_PASS: TRUE、三处安装点 md5 一致，
 *   但产物中有一段**语法非法**的 JS。直到**重启 Harness** 才以
 *   「Failed to load plugins / failed to import loader entry」暴露，插件全灭。
 *
 *   根因不是"漏了一个检查"，而是**检查分布不均**：build 与 install 查的都是
 *   "文件有没有被正确搬运"（字节数、md5、路径），**没有任何一环查过
 *   "搬过去的这串字符是不是合法 JS"**。属台账规则 D「校验器不得跳过自身」的盲区。
 *
 * 为什么用 vm.Script：它只做**语法解析、不执行**，因此不触发 require / module /
 *   indexedDB 等运行时依赖 —— 对"CJS 形态但以 ESM 加载"的产物同样适用，
 *   这里要判的只有语法这一件事。
 *
 * 台账规则 F：本闸门已做正负对照校准（`--selftest-syntax`：好样本必过、坏样本必拦）。
 */
if (process.argv.includes("--selftest-syntax")) {
	/* 坏样本精确复刻本次事故形态：行注释吞掉了后续绑定名与闭合括号，下一行又是语句开头 */
	const good = "var a = 1; function f(x) { return x + a; } const { p, q } = g;";
	const bad = "const { a, b, // 说明吞掉了后续\nconst { d } = y;";
	let ok = true;
	try { new Script(good); console.log("  ✅ 负对照 · 合法样本未被误拦"); }
	catch (e) { ok = false; console.log("  ❌ 负对照误报（好样本被拦）：" + e.message); }
	try { new Script(bad); ok = false; console.log("  ❌ 正对照漏报（本次事故形态未被拦）"); }
	catch (e) { console.log("  ✅ 正对照 · 注释吞掉绑定名的形态已被拦：" + e.message); }
	console.log("SELFTEST-SYNTAX: " + (ok ? "PASS" : "FAIL"));
	process.exit(ok ? 0 : 1);
}

let syntaxErr = null;
try { new Script(bundle, { filename: "lib/client.js" }); } catch (e) { syntaxErr = e; }

console.log(`[build] 产物: ${relative(PLUGIN_ROOT, OUT).split("\\").join("/")}  ${Buffer.byteLength(bundle, "utf8")} B（字符 ${bundle.length}）`);
if (syntaxErr) {
	console.error("");
	console.error("[build] ❌ 产物语法自检未通过 —— 该产物**不可装机**");
	console.error("        （装机后的表现是 Harness 启动即 Failed to load plugins，不是运行时偶发）");
	console.error("        语法错误：" + syntaxErr.message);
	console.error("        产物已写出供排查：" + relative(PLUGIN_ROOT, OUT).split("\\").join("/"));
	process.exit(1);
}
console.log("[build] ✅ 产物语法自检通过（vm.Script 解析无错）");

/* import 绑定对账汇总 —— 明细在 bindAudit。
 * 任何一条不等早在 transform 里就抛错了；这里把规模写进日志，
 * 让"这条防线覆盖了多少"每次构建都可核验（不至于悄悄变成空跑）。 */
const declaredTotal = bindAudit.reduce((s, r) => s + r.declared, 0);
const boundTotal = bindAudit.reduce((s, r) => s + r.bound, 0);
console.log(`[build] ✅ import 绑定对账通过（${bindAudit.length} 条 import 语句 · 声明 ${declaredTotal} 项 / 绑定 ${boundTotal} 项）`);
