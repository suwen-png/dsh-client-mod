#!/usr/bin/env node
/**
 * repeat-novel-split.mjs —— 反复跑真机闸门 N 次，输出**收敛表**
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要"反复跑"而不是"跑一次绿"
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：「然后继续反复测试 …… 该流程需要持续重复起码十次」
 *
 * 🔴 单次绿**证不了**「复用优先」：只有**连跑**才暴露两类缺陷 ——
 *    ① **累积**：每跑一次多 8 条会话（第 19 批之前正是如此，跑到 126 条）；
 *    ② **半复用**：第 2 次之后 `reused` 若是 0/部分，说明索引或存活集口径坏了。
 *    判据（与闸门 NS-11c 同源）：首跑 `reused=0 / created=8 / 净增 8`；
 *    之后**每一次**都必须 `reused=8 / created=0 / 净增 0`。
 *
 * 用法：node scripts/repeat-novel-split.mjs [次数]      # 默认 10
 * 退出码：0 全部达标 / 1 有未达标轮次 / 2 用法错
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const GATE = resolve(HERE, "verify-novel-split.mjs");
const LOGDIR = resolve(ROOT, "logs");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const n = Number(process.argv[2] || 10);
if (!Number.isFinite(n) || n < 1) { console.log("用法：node scripts/repeat-novel-split.mjs [次数]"); process.exit(2); }

mkdirSync(LOGDIR, { recursive: true });

function pick(text, re, idx) {
	const m = re.exec(text);
	return m ? m[idx || 1] : null;
}

const rows = [];
console.log("═══ repeat-novel-split · 连跑 " + n + " 次 ═══\n");
for (let i = 1; i <= n; i++) {
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [GATE], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	const text = String(r.stdout || "") + String(r.stderr || "");
	const logFile = resolve(LOGDIR, "_repeat-" + STAMP + "-run" + i + ".txt");
	writeFileSync(logFile, text, "utf8");

	const row = {
		run: i,
		pass: Number(pick(text, /真机验收：PASS (\d+)/)) || 0,
		fail: Number(pick(text, /FAIL (\d+) \/ 总计/)) || 0,
		total: Number(pick(text, /总计 (\d+)/)) || 0,
		reused: pick(text, /复用 (\d+) · 新建/, 1),
		created: pick(text, /复用 \d+ · 新建 (\d+)/, 1),
		before: pick(text, /宿主会话实测 (\d+) →/, 1),
		after: pick(text, /宿主会话实测 \d+ → (\d+)/, 1),
		delta: pick(text, /净增 (-?\d+)）｜索引/, 1),
		orphan: pick(text, /索引孤儿清理 (\d+) 条/, 1),
		treeBefore: pick(text, /分支树：前 (\d+) 行/, 1),
		treeAfter: pick(text, /分支树：前 \d+ 行 → 后 (\d+) 行/, 1),
		isPass: /IS_PASS: TRUE/.test(text),
		invalid: /INVALID/.test(text),
		ms: Date.now() - t0,
		file: logFile
	};
	rows.push(row);
	console.log("  run" + String(i).padStart(2, "0")
		+ "  " + (row.isPass ? "✅ PASS" : (row.invalid ? "⚠️ INVALID" : "❌ FAIL"))
		+ "  " + row.pass + "/" + row.total
		+ "  ｜复用 " + row.reused + " · 新建 " + row.created
		+ " ｜宿主 " + row.before + "→" + row.after + "（净增 " + row.delta + "）"
		+ " ｜树 " + row.treeBefore + "→" + row.treeAfter
		+ " ｜" + Math.round(row.ms / 1000) + "s");
}

/* ── 收敛判据 ── */
const first = rows[0];
const rest = rows.slice(1);
const bad = [];
if (!first.isPass) bad.push("run1 未通过");
if (String(first.created) !== "8" || String(first.reused) !== "0") bad.push("run1 应是首跑（复用 0 / 新建 8），实测 " + first.reused + "/" + first.created);
for (const x of rest) {
	if (!x.isPass) { bad.push("run" + x.run + " 未通过"); continue; }
	if (String(x.reused) !== "8") bad.push("run" + x.run + " 复用数≠8（实测 " + x.reused + "）");
	if (String(x.created) !== "0") bad.push("run" + x.run + " 不该新建（实测 " + x.created + "）");
	if (String(x.delta) !== "0") bad.push("run" + x.run + " 宿主会话净增≠0（实测 " + x.delta + "）");
}
const treeSet = new Set(rows.map((x) => x.treeAfter));
console.log("\n─── 汇总 ───");
console.log("  通过轮次：" + rows.filter((x) => x.isPass).length + " / " + n);
console.log("  宿主会话数轨迹：" + rows.map((x) => x.after).join(" → "));
console.log("  分支树行数轨迹：" + rows.map((x) => x.treeAfter).join(" → "));
console.log("  " + (bad.length ? "❌ 未达标：" + bad.join("；") : "✅ 全部达标：首跑建 8、其后每次复用 8 且净增 0"));
console.log("  日志：" + LOGDIR);
process.exit(bad.length ? 1 : 0);
