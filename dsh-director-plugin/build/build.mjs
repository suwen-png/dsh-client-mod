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

const PLUGIN_ROOT = resolve(import.meta.dirname, "..");
const SRC = join(PLUGIN_ROOT, "src");
const ENTRY = join(SRC, "client-entry.js");
const OUT = join(PLUGIN_ROOT, "lib/client.js");

/** 平台模块冻结表（getStaticModules）—— 出现在 import 中即构建失败 */
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

const moduleId = (abs) => relative(SRC, abs).split("\\").join("/");

function assertNotPlatform(spec, fromId) {
	if (PLATFORM_MODULES.has(spec)) {
		throw new Error(
			`[build] 平台模块 "${spec}" 被 ${fromId} import —— 违反 ADR-001。\n` +
			`  平台模块必须由 factory 的 require 参数提供，严禁打进产物。`
		);
	}
	if (!spec.startsWith(".")) {
		throw new Error(`[build] ${fromId} 引入了非相对模块 "${spec}" —— 本插件不允许外部依赖。`);
	}
}

function resolveModule(abs, spec) {
	const p = resolve(dirname(abs), spec);
	if (!existsSync(p)) throw new Error(`[build] 无法解析 ${spec}（来自 ${moduleId(abs)}）→ ${p}`);
	return p;
}

/** 收集具名导出（供 exports 回填） */
function collectExportNames(code) {
	const names = new Set();
	// 覆盖 export [async] function/class, export const/let/var
	for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) {
		names.add(m[1]);
	}
	for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
		for (const part of m[1].split(",")) {
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
			let stmt = t;
			let j = i;
			// 单行内已闭合（含 from "..." 或裸 "..."）则不再聚拢
			const closed = () => /from\s*["'][^"']+["']\s*;?$/.test(stmt) || /^import\s*["'][^"']+["']\s*;?$/.test(stmt);
			while (!closed() && j + 1 < lines.length) {
				j++;
				stmt += " " + lines[j].trim();
			}
			i = j;

			// import { a, b as c } from "./x.js";
			let m = stmt.match(/^import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']\s*;?$/);
			if (m) {
				const absDep = resolveModule(abs, m[2]);
				assertNotPlatform(m[2], id);
				deps.push({ spec: m[2], abs: absDep });
				const binds = m[1]
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
					.map((s) => {
						const [orig, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
						return alias ? `${orig}: ${alias}` : orig;
					})
					.join(", ");
				out.push(`\t\t\tconst { ${binds} } = __m(${JSON.stringify(moduleId(absDep))});`);
				continue;
			}
			// import defaultName from "./x.js";
			m = stmt.match(/^import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']\s*;?$/);
			if (m) {
				const absDep = resolveModule(abs, m[2]);
				assertNotPlatform(m[2], id);
				deps.push({ spec: m[2], abs: absDep });
				out.push(`\t\t\tconst ${m[1]} = __m(${JSON.stringify(moduleId(absDep))});`);
				continue;
			}
			// import "./x.js";  （副作用导入）
			m = stmt.match(/^import\s*["']([^"']+)["']\s*;?$/);
			if (m) {
				const absDep = resolveModule(abs, m[1]);
				assertNotPlatform(m[1], id);
				deps.push({ spec: m[1], abs: absDep });
				out.push(`\t\t\t__m(${JSON.stringify(moduleId(absDep))});`);
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
		if (/^export\s*\{/.test(t)) {
			let stmt = t;
			let j = i;
			while (!/\}\s*;?\s*$/.test(stmt) && j + 1 < lines.length) { j++; stmt += " " + lines[j].trim(); }
			i = j;
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

/** DFS 后序 → 拓扑序（被依赖者先定义） */
function visit(abs) {
	if (modules.has(abs)) return;
	if (visiting.has(abs)) throw new Error(`[build] 检测到循环依赖：${moduleId(abs)}`);
	visiting.add(abs);

	const raw = readFileSync(abs, "utf8");
	const exportNames = collectExportNames(raw);
	const { code, deps } = transform(abs, raw);

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
	p.push(`\t\t// 平台模块（React / cordis / slots 等）由 require 提供；本插件不依赖它们。`);
	p.push(`\t\tvoid require;`);
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
	p.push(`\t\tvar apply = function apply(ctx) {`);
	p.push(`\t\t\tvoid ctx;`);
	p.push(`\t\t\treturn __entry.installBatch1({});`);
	p.push(`\t\t};`);
	p.push(`\t\tvar inject = [];`);
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

const bundle = emit();
if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bundle, "utf8");
console.log(`[build] 产物: ${relative(PLUGIN_ROOT, OUT).split("\\").join("/")}  ${bundle.length} B`);
