#!/usr/bin/env node
/**
 * _run-with-harness.mjs —— 纪律 ㊵ 的**产品化**：把「启动 Harness」与「跑被测脚本」
 * 放进**同一条命令**（工具调用结束 ⇒ 会话进程树被回收，分两条必然 INVALID）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有它（不是"方便"，是**必须**）
 * ──────────────────────────────────────────────────────────────────
 *   本项目所有真机套件都靠 CDP 连宿主的渲染进程。而 Harness 一旦由**上一条** Bash
 *   命令启动，那条命令结束时整棵进程树就被回收 ⇒ 下一条命令里套件必然
 *   `INVALID：连不上 CDP`。这个坑本项目踩过多次（纪律 ㊵ 就是这么来的）。
 *   ⇒ 正确的调用形态固定为：
 *       node scripts/_run-with-harness.mjs node scripts/<套件>.mjs [参数...]
 *
 * ══════════════════════════════════════════════════════════════════
 * 环境变量
 * ──────────────────────────────────────────────────────────────────
 *   · `CDP_PORT`（默认 9222）—— 起始端口；被幽灵占用时会**顺移**并把实际端口
 *     回填给子进程（`CDP_PORT=<实际>`）⇒ 套件永远连的是**真在跑**的那个端口。
 *   · `RH_RESTART=1` —— **强制重启**。⚠️ 改了 `src/**` 之后必须置 1：
 *     产物虽已装进插件目录，但**运行中的宿主不会热加载** ⇒ 复用旧实例 = 跑旧代码
 *     （症状是"改了没生效"，而闸门全绿）。
 *   · `RH_STOP=1` —— 跑完停机（默认**不停**：留着给用户看界面、给下一轮复用）。
 *   · `RH_BUDGET_MS`（默认 90000）—— CDP 就绪预算。
 *
 * 退出码：**原样透传子进程的退出码**（0 通过 / 1 FAIL / 2 INVALID）——
 *   包装层绝不改写结论，否则"套件红但包装绿"会成为新的静默点。
 */

import { spawnSync } from "node:child_process";
import { ensureHarness, stopHarness } from "./_harness.mjs";

const argv = process.argv.slice(2);
if (!argv.length) {
	console.error("用法：node scripts/_run-with-harness.mjs <命令> [参数...]");
	console.error("例：  node scripts/_run-with-harness.mjs node scripts/verify-novel-split.mjs");
	process.exit(2);
}

const base = Number(process.env.CDP_PORT || 9222);
const forceRestart = String(process.env.RH_RESTART || "") === "1";
const budgetMs = Number(process.env.RH_BUDGET_MS || 90000);

console.log("═══════════════════════════════════════════════════════════");
console.log(" _run-with-harness · 纪律 ㊵（启动与测试同一条命令）");
console.log(" 命令：" + argv.join(" "));
console.log(" 起始端口 " + base + " ｜ 强制重启 " + (forceRestart ? "是" : "否")
	+ " ｜ 就绪预算 " + budgetMs + " ms ｜ 跑完停机 " + (String(process.env.RH_STOP || "") === "1" ? "是" : "否"));
console.log("═══════════════════════════════════════════════════════════");

const H = await ensureHarness({ port: base, forceRestart: forceRestart, maxShift: 4, budgetMs: budgetMs, log: (s) => console.log(s) });
if (!H || !H.ok) {
	console.error("❌ Harness 未能就绪：" + String((H && H.why) || "未知"));
	console.error("   真因见上一行的应用输出（纪律 65：宿主失败原因必须落地）。");
	console.error("   ⚠️ 这一条**不是产品缺陷** ⇒ 退出码 2（INVALID），不判 FAIL。");
	process.exit(2);
}
const port = Number(H.port || base);
console.log("  [harness] CDP 就绪 · port " + port + " · " + (H.reused ? "复用现有实例" : "新启动 pid " + H.pid)
	+ (H.shifted ? "（端口顺移 " + H.shiftedBy + " 位）" : ""));
console.log("  __PORT__=" + port);

/* 🔴 实际端口回填给子进程：套件里一律 `Number(process.env.CDP_PORT || 9222)`
 *    —— 顺移之后若还用起始端口，套件会去连一个**没人在听**的端口，
 *      症状是"重启了但全 INVALID"，与产品毫无关系（纪律 97）。 */
const r = spawnSync(argv[0], argv.slice(1), {
	stdio: "inherit",
	env: { ...process.env, CDP_PORT: String(port) }
});

const code = r.status == null ? 1 : r.status;
console.log("");
console.log("  [harness] 子进程退出码 " + code + "（原样透传，包装层不改写结论）");

if (String(process.env.RH_STOP || "") === "1") {
	await stopHarness({ log: (s) => console.log("  " + s), port: port });
}
process.exit(code);
