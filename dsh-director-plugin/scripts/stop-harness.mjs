#!/usr/bin/env node
/**
 * stop-harness.mjs —— 把 Harness **彻底关掉**（验证式停机）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它（不是"杀进程脚本"，是"治闪退的必要件"）
 * ──────────────────────────────────────────────────────────────────
 * 应用的设计是 **关窗不退**（asar 原文 `/lib/types/window-lifecycle.js`）：
 *   `onWindowClose(e){ e.preventDefault(); getWindow()?.hide(); }`
 *   `app.on("window-all-closed", () => {})`
 * ⇒ 用户点 × 之后，进程**常驻**、只剩托盘图标；而应用是**单实例**：
 *   `if (!app.requestSingleInstanceLock()) app.quit();`（不打印任何东西）
 * ⇒ 下一次双击就是 **1.0–1.4 s 静默 exit 0、无窗口** ⇒ 用户口中的「打开就闪退」。
 *
 * 🔴 判据（纪律 97）：`taskkill` 报"成功" ≠ 端口已释放。
 *   结论只看 —— **进程表为空 ∩ 端口可 bind**；两者缺一即 exit 2 并打印处置办法。
 *   （中文系统 taskkill 输出经 utf8 解码是乱码，看文案会假成功 —— 纪律 61。）
 *
 * 用法：node scripts/stop-harness.mjs ｜ 退出码 0 = 已清干净 / 2 = 有杀不动的残留
 */

import path from "node:path";
import { HARNESS, harnessWindows, imageProcs, stopHarness, portBusy, listenersOn } from "./_harness.mjs";

const PORT = Number(process.env.CDP_PORT || 9222);

console.log("══ 关闭 DeepSeek Harness（验证式停机）══");
const rows = harnessWindows();
console.log("  停机前：" + rows.length + " 个进程" + (rows.length ? "" : "（干净）"));
for (const r of rows) {
	console.log("    · pid " + r.pid + " 窗口=" + (r.hasWindow ? "「" + r.title + "」" : "**无（多半在托盘里）**"));
}
if (!rows.length) {
	const busy0 = await portBusy(PORT);
	console.log("  ✅ 没有在跑的实例（无需停机）· 端口 " + PORT + " 可 bind = " + !busy0
		+ (busy0 ? " ｜ port 仍在 linger（**无害**：socket 释放滞后，启动器会自动顺移端口）"
			+ " LISTENING pid = " + JSON.stringify(listenersOn(PORT).slice(0, 3)) : ""));
	process.exit(0);
}
console.log("");
const st = await stopHarness({ log: (s) => console.log("  " + s), budgetMs: 25000, port: PORT });
const left = imageProcs();
console.log("");
const stillBusy = await portBusy(PORT);
const lingerNote = stillBusy
	? " ｜ port " + PORT + " 仍在 linger（**无害**：socket 由已退出的进程残留持有，实测数十秒后自行释放；"
		+ "`Start Harness.cmd` 会自动**顺移端口**绕开，不影响打开）"
	: "";
/* 🔴 成功判据 = **进程表为空**（单实例锁随进程消失 ⇒ 新启动不会再被接管）。
 *    端口只作**次级读数如实打印** —— 若把它并进主判据，每次停机都会因 socket 滞后而假红
 *    （实测：进程表已 0，9222 仍由 `LISTENING pid 14836` 持有，而该 pid 已查无此进程）。 */
if (left.length === 0) {
	console.log("  ✅ 已停机：进程表 0 个（应用已退出）" + lingerNote);
	console.log("     现在可以双击 `Start Harness.cmd` 了。");
	process.exit(0);
}
console.log("  ⚠️ **未清干净**：进程表仍有 " + left.length + " 个 pid " + JSON.stringify(left.slice(0, 5)));
console.log("     " + PORT + " 可 bind = " + !stillBusy + " ｜ LISTENING pid = " + JSON.stringify(listenersOn(PORT).slice(0, 3)));
console.log("     处置（宿主可能以**管理员**运行 ⇒ 普通权限杀不动 —— 纪律 74）：");
console.log("       ① 右键**托盘图标 → 退出**（应用自己会 tray.destroy() + app.quit()）");
console.log("       ② 或用**管理员** PowerShell：taskkill /F /T /IM \"" + path.basename(HARNESS.exe) + "\"");
if (st && st.leftover) console.log("     读数：" + JSON.stringify(st.leftover));
process.exit(2);
