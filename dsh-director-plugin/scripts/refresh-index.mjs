#!/usr/bin/env node
/**
 * refresh-index.mjs —— **索引一键重建编排器**
 *
 * ══════════════════════════════════════════════════════════════════
 *  它解决什么
 * ──────────────────────────────────────────────────────────────────
 *  项目有 **5 个索引生成器**（3 份索引 + 2 份代码生成物），散在不同目录、
 *  各有各的开关。人记不全 ⇒ 改完代码只跑其中一个 ⇒ 索引互相漂移。
 *  本脚本把"该跑哪些、什么顺序"固化下来，一条命令对齐。
 *
 * ── 三份索引 + 生成器 ─────────────────────────────────────────────
 *   1. 项目全资源确定索引   ├─ scripts/gen-project-index.mjs      （写 `docs/00-统筹入口/`）
 *   2. 源码映射索引         ├─ scripts/gen-source-map.mjs         （🔴 **会写 src/**，见下）
 *   3. 文档索引（运行时）   └─ scripts/gen-docs-index.mjs         （写 `assets/docs-index.json`）
 *
 * ── 🔴 副作用（务必知道）──────────────────────────────────────────
 *  `gen-source-map.mjs` **会向 `src/**` 每个文件顶部注入 `@map:begin/@map:end` 血缘块**
 *  （职责/上下游/设计稿板块）。也就是说：**重建索引会改动源码**。
 *   ⇒ 跑完本脚本（非 `--safe`）后：`src/**` 可能已变 ⇒ **必须重建产物 + 重装**，
 *     否则 `lib/client.js` 与 src 不一致（`check-stale-build.mjs` 会红）。
 *   ⇒ 若正在与其它会话并行改 `src/**`，用 **`--safe`** 跳过该生成器，避免互相覆盖。
 *
 * ── 模式（退出码 0/1/2）───────────────────────────────────────────
 *   （无参数）  重建三份索引（含 gen-source-map ⇒ 可能改 src）
 *   --safe      重建**不碰 src** 的两份（跳过 gen-source-map）
 *   --check     只对账不写（转 `verify-index.mjs`）
 *
 * 用法：
 *   node scripts/refresh-index.mjs
 *   node scripts/refresh-index.mjs --safe
 *   node scripts/refresh-index.mjs --check
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

/* ── 参数契约（纪律 34：不认的参数必须 `exit 2` 自诊断）────────── */
const ARGV = process.argv.slice(2);
const CHECK = ARGV.includes("--check");
const SAFE = ARGV.includes("--safe");
const UNKNOWN = ARGV.filter((a) => a !== "--check" && a !== "--safe");
if (UNKNOWN.length || (CHECK && SAFE)) {
	console.error("用法: node scripts/refresh-index.mjs [--safe | --check]");
	console.error("  （无参数 = 重建三份索引；--safe = 跳过会写 src 的源码映射；--check = 只对账）");
	console.error("退出码: 0 成功 / 1 有索引未对齐 / 2 用法错");
	console.error(UNKNOWN.length ? "收到未知参数: " + UNKNOWN.join(" ") : "参数冲突: --safe 与 --check 互斥");
	process.exit(2);
}

const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(PLUGIN_ROOT, "..");

/* ── 生成器清单（顺序即依赖顺序：先扫描类，再编排入口）────────── */
const GENERATORS = [
	{
		name: "全资源确定索引",
		file: path.join(ROOT, "scripts", "gen-project-index.mjs"),
		cwd: ROOT,
		writesSrc: false,
	},
	{
		name: "源码映射索引",
		file: path.join(PLUGIN_ROOT, "scripts", "gen-source-map.mjs"),
		cwd: PLUGIN_ROOT,
		writesSrc: true, // 🔴 会注入 @map 块到 src/**
	},
	{
		name: "文档索引（运行时）",
		file: path.join(PLUGIN_ROOT, "scripts", "gen-docs-index.mjs"),
		cwd: PLUGIN_ROOT,
		writesSrc: false,
	},
];

const VERIFY = path.join(PLUGIN_ROOT, "scripts", "verify-index.mjs");

/* ── --check：直接把对账交给闸门（同一判据，不复制一份）────────── */
if (CHECK) {
	const r = spawnSync(process.execPath, [VERIFY], { cwd: PLUGIN_ROOT, stdio: "inherit" });
	process.exit(r.status === null ? 2 : r.status);
}

console.log("══ 索引一键重建" + (SAFE ? "（--safe：不碰 src）" : "") + " ══\n");

let failed = 0;
let skipped = 0;
let touchedSrc = false;

for (const g of GENERATORS) {
	if (SAFE && g.writesSrc) {
		console.log("  跳过  " + g.name.padEnd(20) + "（--safe：该生成器会写 src/**）");
		skipped++;
		continue;
	}
	const r = spawnSync(process.execPath, [g.file], {
		cwd: g.cwd,
		encoding: "utf8",
		timeout: 180000,
		maxBuffer: 32 * 1024 * 1024,
	});
	const out = (r.stdout || "") + (r.stderr || "");
	/* 🔴 只回显最后一行要点，不整段回显（成本红线） */
	const tail = out.split(/\r?\n/).filter((x) => x.trim()).slice(-1)[0] || "";
	if (r.status === 0) {
		console.log("  OK    " + g.name.padEnd(20) + tail.slice(0, 100));
		if (g.writesSrc) touchedSrc = true;
	} else {
		console.log("  FAIL  " + g.name.padEnd(20) + "exit=" + r.status + " ⇒ " + tail.slice(0, 90));
		failed++;
	}
}

/* ── 重建后立即对账（重建完还漂移 = 生成器有问题，必须暴露）─────── */
console.log("\n── 重建后对账 ──");
const v = spawnSync(process.execPath, [VERIFY], { cwd: PLUGIN_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const vOut = (v.stdout || "") + (v.stderr || "");
console.log(
	vOut
		.split(/\r?\n/)
		.filter((l) => /OK |FAIL |INVALID |合计|IS_PASS/.test(l))
		.join("\n")
);

console.log("");
if (touchedSrc) {
	console.log("🔴 `src/**` 已被注入 `@map` 血缘块 ⇒ **产物已过期**，请接着跑：");
	console.log("   cd dsh-director-plugin && node scripts/gen-key-files.mjs && node build/build.mjs && node scripts/plugin-install.mjs --apply");
}
if (skipped) console.log("（--safe：跳过 " + skipped + " 个会写 src 的生成器 ⇒ 源码映射索引可能仍漂移）");

const ok = failed === 0 && v.status === 0;
console.log(ok ? "✅ 索引重建完成且三份一致" : "❌ 索引未对齐（见上）");
process.exit(ok ? 0 : 1);
