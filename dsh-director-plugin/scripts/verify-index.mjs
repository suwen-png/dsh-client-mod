#!/usr/bin/env node
/**
 * verify-index.mjs —— **索引一致性闸门**（只读，不写任何文件）
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么要有这道闸门
 * ──────────────────────────────────────────────────────────────────
 *  三份自动索引里，`assets/docs-index.json` 是**运行时真相源** ——
 *  `src/store/docs-index-inject.js` 会把它注入前端供总监查阅。
 *  它漂移 = **总监看到的文档不是最新的**，而这件事在界面上**看不出来**
 *  （不报错、不缺页，只是内容旧）。所以必须由闸门拦，不能靠人记得。
 *
 *  另两份（全资源确定索引 / 源码映射索引）漂移的代价是"接手者读到错的事实"，
 *  同属必须拦的一类。
 *
 * ── 判据（退出码 0/1/2）────────────────────────────────────────────
 *   0 = 三份全部一致；1 = 有漂移（打印是哪一份）；2 = 用法错 / 生成器崩了
 *   🔴 三份生成器都必须自带 `--check`；缺它 ⇒ 本闸门判 **2（INVALID）**，
 *     不许把"做不到"报成"通过了"（跳过比红更危险，纪律 18）。
 *
 * 用法：
 *   node scripts/verify-index.mjs
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/* ── 参数契约（纪律 34）─────────────────────────────────────────── */
const ARGV = process.argv.slice(2);
if (ARGV.length) {
	console.error("用法: node scripts/verify-index.mjs");
	console.error("（本脚本无参数；重建请用 `node scripts/refresh-index.mjs`）");
	console.error("收到未知参数: " + ARGV.join(" "));
	process.exit(2);
}

const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(PLUGIN_ROOT, "..");

/* 三份自动索引 → 各自的生成器（`--check` 模式） */
const TARGETS = [
	{
		name: "全资源确定索引",
		cmd: [path.join(ROOT, "scripts", "gen-project-index.mjs"), "--check"],
		cwd: ROOT,
		artifact: path.join(ROOT, "docs", "00-统筹入口", "项目全资源确定索引.md"),
	},
	{
		name: "源码映射索引",
		cmd: [path.join(PLUGIN_ROOT, "scripts", "gen-source-map.mjs"), "--check"],
		cwd: PLUGIN_ROOT,
		artifact: path.join(PLUGIN_ROOT, "docs", "12-源码映射索引.md"),
	},
	{
		name: "文档索引（运行时）",
		cmd: [path.join(PLUGIN_ROOT, "scripts", "gen-docs-index.mjs"), "--check"],
		cwd: PLUGIN_ROOT,
		artifact: path.join(PLUGIN_ROOT, "assets", "docs-index.json"),
	},
];

console.log("══ 索引一致性闸门（三份 · 只读）══\n");

let fail = 0;
let invalid = 0;

for (const t of TARGETS) {
	/* 产物不存在 ⇒ 直接 FAIL（不是 INVALID：生成器在，只是没跑过） */
	if (!existsSync(t.artifact)) {
		console.log("  FAIL  " + t.name.padEnd(20) + " 产物不存在：" + path.relative(ROOT, t.artifact));
		fail++;
		continue;
	}
	const r = spawnSync(process.execPath, t.cmd, {
		cwd: t.cwd,
		encoding: "utf8",
		timeout: 120000,
		maxBuffer: 32 * 1024 * 1024,
	});
	const out = (r.stdout || "") + (r.stderr || "");
	/* 🔴 只回显示意行，不整段回显（成本红线） */
	const tail = out
		.split(/\r?\n/)
		.filter((x) => /IS_PASS|⟹|一致|漂移|错误|Error|用法/.test(x))
		.slice(-1)[0] || "";
	if (r.status === 0) {
		console.log("  OK    " + t.name.padEnd(20) + tail.slice(0, 90));
	} else if (r.status === 2) {
		/* 生成器自己判"用法错/做不到" ⇒ 本闸门也不许报绿 */
		console.log("  INVALID " + t.name.padEnd(19) + "生成器 exit 2 ⇒ " + tail.slice(0, 80));
		invalid++;
	} else {
		console.log("  FAIL  " + t.name.padEnd(20) + "有漂移 ⇒ " + tail.slice(0, 80));
		fail++;
	}
}

console.log("");
if (fail === 0 && invalid === 0) {
	console.log("合计 3 份：✅ 全部一致");
	console.log("IS_PASS: TRUE（fail=0）");
	process.exit(0);
}
console.log("合计 3 份：❌ 漂移 " + fail + " · ⚠️ 无法判定 " + invalid);
console.error("修复：node dsh-director-plugin/scripts/refresh-index.mjs");
console.error("IS_PASS: FALSE");
process.exit(1);
