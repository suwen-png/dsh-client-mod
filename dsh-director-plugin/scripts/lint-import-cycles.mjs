#!/usr/bin/env node
/**
 * lint-import-cycles.mjs —— **模块循环依赖**静态闸门（19 号文执行中发现缺陷后新增）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须有它（2026-09-17 真机铁证，**离线套件测不出来**）
 * ──────────────────────────────────────────────────────────────────
 *  `attribution.js` 与 `split-dimensions.js` 互为循环依赖，且**两侧都是顶层命名解构**：
 *     `import { noiseReasonOf } from "./split-dimensions.js"`
 *   · **Node 原生 ESM** 跑离线套件：60/60 全绿（求值时机恰好没踩到）；
 *   · **打包产物**（`lib/client.js` 的 `__m()` 工厂：先注册空对象、再 `def(ex)` 填充）
 *     在真机上直接暴露：`data-error = "noiseReasonOf is not a function"`
 *     ⇒ 派发在 `plan()` 第一步中断、台账 `at` 恒 0、界面「派发中断」——
 *     **闸门全绿而界面用不了**（纪律 57 的典型）。
 *
 * ⇒ 判据不是"有没有环"（ESM 允许环），而是"**环里有没有危险形态**"：
 *     · `import { a, b } from` 顶层**命名解构** ⇒ 循环求值时可能是 `undefined` ⇒ **FAIL**
 *     · `import * as NS from` 命名空间活绑定 ⇒ 取值在函数体内时安全 ⇒ 允许（记为提示）
 *     · `import Default from` 默认导入 ⇒ 同理危险 ⇒ **FAIL**
 *
 * 用法：node scripts/lint-import-cycles.mjs ｜ 退出码 0 通过 / 1 有危险环
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "src");

/* ── 收集 src/**\/*.js（项目级简单递归；零第三方依赖）── */
import { readdirSync } from "node:fs";
function walk2(dir, out) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) walk2(p, out);
		else if (/\.js$/.test(e.name)) out.push(p);
	}
	return out;
}

const files = walk2(SRC, []);
const rel = (p) => relative(SRC, p).split("\\").join("/");
const known = new Set(files.map(rel));

/** 解析一个文件的依赖：{ to, kind: "named" | "namespace" | "default" | "side", line } */
function importsOf(abs) {
	const src = readFileSync(abs, "utf8");
	const lines = src.split(/\r?\n/);
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i].trim();
		let m = t.match(/^import\s*\{[\s\S]*?\}\s*from\s*["']([^"']+)["']/);
		if (m) { out.push({ to: m[1], kind: "named", line: i + 1 }); continue; }
		m = t.match(/^import\s*\*\s*as\s+[\w$]+\s+from\s*["']([^"']+)["']/);
		if (m) { out.push({ to: m[1], kind: "namespace", line: i + 1 }); continue; }
		m = t.match(/^import\s+[\w$]+\s+from\s*["']([^"']+)["']/);
		if (m) { out.push({ to: m[1], kind: "default", line: i + 1 }); continue; }
		m = t.match(/^export\s*\{[\s\S]*?\}\s*from\s*["']([^"']+)["']/);
		if (m) { out.push({ to: m[1], kind: "reexport", line: i + 1 }); continue; }
		m = t.match(/^import\s*["']([^"']+)["']/);
		if (m) { out.push({ to: m[1], kind: "side", line: i + 1 }); }
	}
	return out;
}

/** 解析相对路径 → src 内的相对 id */
function resolveId(fromAbs, spec) {
	if (!spec.startsWith(".")) return null;              // 外部依赖（react 等）不参与
	const p = resolve(dirname(fromAbs), spec);
	if (!/\.js$/.test(p)) return null;
	const r = rel(p);
	return known.has(r) ? r : null;
}

const graph = new Map();
for (const f of files) {
	const me = rel(f);
	const deps = [];
	for (const im of importsOf(f)) {
		const id = resolveId(f, im.to);
		if (id) deps.push({ to: id, kind: im.kind, line: im.line });
	}
	graph.set(me, deps);
}

/* ── 找环（Tarjan 简化版：DFS + 栈）── */
const cycles = [];
const state = new Map();      // id → 0 未访问 / 1 在栈 / 2 完成
const stack = [];
function dfs(id) {
	state.set(id, 1);
	stack.push(id);
	for (const d of graph.get(id) || []) {
		const s = state.get(d.to) || 0;
		if (s === 1) {
			const i = stack.indexOf(d.to);
			cycles.push(stack.slice(i).concat([d.to]));
		} else if (s === 0) dfs(d.to);
	}
	stack.pop();
	state.set(id, 2);
}
for (const id of graph.keys()) if (!state.get(id)) dfs(id);

/* 去重（同一环可能被多次发现）*/
const seen = new Set();
const uniq = [];
for (const c of cycles) {
	const key = [...c].sort().join("|");
	if (seen.has(key)) continue;
	seen.add(key);
	uniq.push(c);
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  模块循环依赖闸门（" + graph.size + " 个模块 · " + uniq.length + " 个环）");
console.log("═══════════════════════════════════════════════════════════");

const dangerous = [];
for (const c of uniq) {
	/* 环上每条边的形态：把环内相关边收集起来 */
	const edges = [];
	for (let i = 0; i < c.length - 1; i++) {
		const from = c[i];
		for (const d of graph.get(from) || []) {
			if (d.to === c[i + 1]) edges.push({ from: from, to: d.to, kind: d.kind, line: d.line });
		}
	}
	const bad = edges.filter((e) => e.kind === "named" || e.kind === "default" || e.kind === "reexport");
	console.log("  " + (bad.length ? "🔴" : "✅") + " 环：" + c.join(" → "));
	edges.forEach((e) => console.log("        " + e.from + ":" + e.line + "  [" + e.kind + "]"));
	if (bad.length) dangerous.push({ cycle: c, bad: bad });
}

console.log("───────────────────────────────────────────────────────────");
if (dangerous.length) {
	console.log("  🔴 危险环 " + dangerous.length + " 个：**环内存在顶层命名解构/默认导入**");
	console.log("     循环求值时对方 exports 可能尚未填充 ⇒ 拿到 undefined");
	console.log("     （真机形态：「xxx is not a function」，闸门全绿但界面不可用）");
	console.log("     修法：改成 `import * as NS from` 并把取值挪进函数体；");
	console.log("           或把共同依赖抽到第三个模块（彻底消环）。");
	console.log("IS_PASS: FALSE");
	process.exit(1);
}
console.log("  ✅ 无危险环" + (uniq.length ? "（" + uniq.length + " 个环全部为 `import * as` 活绑定 —— 允许）" : ""));
console.log("IS_PASS: TRUE");
process.exit(0);
