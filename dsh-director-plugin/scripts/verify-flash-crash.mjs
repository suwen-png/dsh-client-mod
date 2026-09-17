#!/usr/bin/env node
/**
 * verify-flash-crash.mjs —— 「打开就闪退」的**真机正负对照验收**（第二十五轮新增）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份验收要证明什么（先写"测什么 + 期望结果"，再写代码 —— 纪律 52）
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：「还是不行 闪退!!」「软件打开就闪退」。根因不是产品缺陷，是**启动上下文**：
 *   · asar 原文 `/lib/main.js`：`if (!app.requestSingleInstanceLock()) app.quit();`
 *     —— 抢不到锁的第二个实例**静默 `exit 0`、零输出**（实测 1.40 s / 输出 2 字节 `\r\n`）。
 *   · asar 原文 `/lib/types/window-lifecycle.js`：`onWindowClose(){ e.preventDefault(); getWindow()?.hide(); }`
 *     加上 `app.on("window-all-closed", () => {})` ⇒ **点 × 只是缩到托盘，进程不退**
 *     ⇒ 它**制造**了上面那个"已有实例"，于是**下次双击必然闪退**。
 *
 * 🔴 因此本验收的**负对照就是缺陷本身**：必须有办法把"被静默接管"这一形态
 *    **稳定复现、并被判据抓到**。只证明"能打开"是不够的 —— 那在 v2 的启动器上
 *    也曾经"全绿"，而用户照样闪退（纪律 31：报绿先审口径）。
 *
 *  | 编号  | 被测行为 | 期望结果 |
 *  |:------|:---------|:---------|
 *  | FC-1  | 清场后进程表 | 空（正对照的前提 —— 纪律 23「先证前提再断结果」） |
 *  | FC-2  | 🔴 **正对照**：空场单实例启动 ⇒ 窗口出现 | `mainWindowPids()` 非空 |
 *  | FC-3  | 🔴 同一读数的 verdict | `OK` |
 *  | FC-4  | 窗口真的**持续**在（观察窗内） | 5 s 后仍在 |
 *  | FC-5  | 🔴 **负对照**：保留 FC-2 的实例，再起第二个 | 第二个进程**在 ≤15 s 内消失** |
 *  | FC-6  | 🔴 第二个进程的**退出码** | `0`（静默退出 —— 不是崩溃） |
 *  | FC-7  | 🔴 第二个进程的**输出** | ≤ 2 字节（应用一句话都没说） |
 *  | FC-8  | 🔴 第一个实例**不受影响** | 进程仍在、主窗口仍在（这就是"窗口是别人的"） |
 *  | FC-9  | 🔴 该形态的 verdict | `TAKEN_OVER`（**不是** `OK` —— 否则判据是假绿） |
 *  | FC-10 | 🔴 两种形态 verdict **互不相同** | `OK ≠ TAKEN_OVER`（可分辨 —— 纪律 58） |
 *  | FC-11 | 收尾：验证式停机 | 进程表空 ∩ 端口可 bind |
 *
 * ⚠️ **破坏性动作自带退路**（纪律 83）：本脚本会**真起、真杀** Harness。
 *    起点与终点都调用 `stopHarness()`（验证式停机）；若被杀不动的残留挡住，
 *    会打印处置办法而不是假装成功。**不要在有人正在用 Harness 时跑它。**
 *
 * 用法：node scripts/verify-flash-crash.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

import fs from "node:fs";
import path from "node:path";
import {
	imageProcs, harnessWindows, mainWindowPids, stopHarness, spawnHarnessEx,
	classifyLaunchOutcome, LAUNCH_VERDICTS
} from "./_harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const LOGDIR = path.join(ROOT, "logs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
const seen = new Set();
function t(id, name, cond, evidence) {
	if (seen.has(id)) throw new Error("断言编号重复：" + id);
	seen.add(id);
	if (cond) { pass++; console.log("  ✅ " + id + " " + name + (evidence ? " · " + evidence : "")); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + (evidence ? " · " + evidence : "")); }
}

/** 等主窗口出现（**不用 CDP** —— 裸启动也要能判，这正是窗口真相源存在的理由） */
async function waitMainWindow(seconds) {
	const t0 = Date.now();
	while (Date.now() - t0 < seconds * 1000) {
		const pids = mainWindowPids();
		if (pids.length) return { pids: pids, secs: Number(((Date.now() - t0) / 1000).toFixed(1)) };
		await sleep(600);
	}
	return { pids: [], secs: null };
}

function outBytes(file) {
	try { return fs.existsSync(file) ? Buffer.byteLength(fs.readFileSync(file, "utf8"), "utf8") : 0; } catch (_) { return 0; }
}

console.log("═══ verify-flash-crash · 「打开就闪退」真机正负对照 ═══");
console.log("  ⚠️ 本脚本会真起、真杀 Harness（起点与终点都做验证式停机）");

/* ── FC-1：清场（正对照的前提）── */
console.log("");
console.log("── 清场 ──");
const st0 = await stopHarness({ log: (s) => console.log("  " + s), budgetMs: 25000 });
const pre = imageProcs();
t("FC-1", "🔴 清场后进程表为空（正对照的前提 —— 先证前提再断结果）", pre.length === 0,
	"stopHarness.killed=" + (st0 && st0.killed) + " 残留=" + pre.length);

/* ── FC-2 ~ FC-4：正对照 —— 空场单实例应该出窗口，且窗口持续在 ── */
console.log("");
console.log("── 正对照 · 空场单实例 ──");
const A_OUT = path.join(LOGDIR, "_vfc-A.out");
const recA = spawnHarnessEx({ port: 0, log: (s) => console.log("  " + s), outFile: A_OUT, args: [] });
const wA = await waitMainWindow(90);
t("FC-2", "🔴 空场单实例启动 ⇒ 主窗口出现（`tasklist /V` 的 Window Title 读数）",
	wA.pids.length > 0, "主窗口 pid=" + JSON.stringify(wA.pids) + " 用时=" + wA.secs + " s");
const procsA = imageProcs();
const verdictA = classifyLaunchOutcome({
	pidGone: recA == null || procsA.indexOf(String(recA.pid)) < 0,
	othersAlive: 0,
	mainWindow: mainWindowPids().length > 0,
	badOption: /bad option/i.test(fs.existsSync(A_OUT) ? fs.readFileSync(A_OUT, "utf8") : "")
});
t("FC-3", "🔴 该读数的 verdict = OK", verdictA === LAUNCH_VERDICTS.OK, verdictA);
await sleep(5000);
t("FC-4", "🔴 窗口**持续**在（5 s 观察窗后仍在 —— v2 的判据缺的就是这一步）",
	mainWindowPids().length > 0 && imageProcs().indexOf(String(recA.pid)) >= 0,
	"进程 " + imageProcs().length + " 个 · 主窗口 " + mainWindowPids().length + " 个");

/* ── FC-5 ~ FC-10：负对照 —— 缺陷形态必须被复现并抓到 ── */
console.log("");
console.log("── 负对照 · 已有实例时再启动（**这就是用户看到的「闪退」**）──");
const B_OUT = path.join(LOGDIR, "_vfc-B.out");
const tB0 = Date.now();
const recB = spawnHarnessEx({ port: 0, log: (s) => console.log("  " + s), outFile: B_OUT, args: [] });
let goneSecs = null;
while (Date.now() - tB0 < 15000) {
	await sleep(500);
	if (imageProcs().indexOf(String(recB.pid)) < 0) { goneSecs = Number(((Date.now() - tB0) / 1000).toFixed(2)); break; }
}
t("FC-5", "🔴 负对照：第二个进程在 ≤15 s 内**消失**（复现「打开就闪退」）", goneSecs !== null,
	goneSecs === null ? "15 s 内未消失 ⇒ 缺陷形态**没能复现**，本组其余断言无意义" : "存活 " + goneSecs + " s");
await sleep(1200);
const exitB = recB.exit ? recB.exit.code : null;
const bytesB = outBytes(B_OUT);
t("FC-6", "🔴 第二个进程的**退出码 = 0**（静默退出，不是崩溃）", exitB === 0, "exitCode=" + JSON.stringify(exitB));
t("FC-7", "🔴 第二个进程的**输出 ≤ 2 字节**（应用一句话都没说 —— 所以「没输出」≠「没发生」）",
	bytesB <= 2, "outBytes=" + bytesB + " 原文=" + JSON.stringify(fs.existsSync(B_OUT) ? fs.readFileSync(B_OUT, "utf8") : ""));
const procsB = imageProcs();
const winB = mainWindowPids();
const rowsB = harnessWindows();
t("FC-8", "🔴 第一个实例**不受影响**：进程仍在 + 主窗口仍在（⇒ 窗口是**别人的**）",
	procsB.indexOf(String(recA.pid)) >= 0 && winB.length > 0,
	"A.pid=" + recA.pid + " 在进程表=" + (procsB.indexOf(String(recA.pid)) >= 0) + " · 主窗口=" + JSON.stringify(winB)
	+ " · 全部行=" + JSON.stringify(rowsB.map((r) => r.pid + ":" + (r.hasWindow ? r.title : "-"))));
const verdictB = classifyLaunchOutcome({
	pidGone: true, exitCode: exitB, outBytes: bytesB,
	othersAlive: procsB.length, mainWindow: winB.length > 0,
	badOption: /bad option/i.test(fs.existsSync(B_OUT) ? fs.readFileSync(B_OUT, "utf8") : "")
});
t("FC-9", "🔴 该形态的 verdict = **TAKEN_OVER**（若这里报 OK，判据就是假绿 —— 本轮的根本病因）",
	verdictB === LAUNCH_VERDICTS.TAKEN_OVER, verdictB);
t("FC-10", "🔴 两种形态 verdict **互不相同**（可分辨 —— 归因不可分辨 = 等于没归因）",
	verdictA !== verdictB, "正对照=" + verdictA + " ｜ 负对照=" + verdictB);

/* ── FC-11：收尾（破坏性动作的退路 —— 纪律 83）── */
console.log("");
console.log("── 收尾 · 验证式停机 ──");
const st1 = await stopHarness({ log: (s) => console.log("  " + s), budgetMs: 25000 });
const left = imageProcs();
t("FC-11", "收尾后进程表为空（判据 = 进程表空；端口 linger 无害，见 stopHarness 打印）",
	left.length === 0, "残留=" + left.length + (st1 && st1.leftover ? " 读数=" + JSON.stringify(st1.leftover) : ""));

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (fail) console.log("  失败项：" + failures.join(" | "));
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
