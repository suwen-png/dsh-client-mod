#!/usr/bin/env node
/**
 * start-harness.mjs —— 「把 Harness 打开」的**唯一入口**（治「打开就闪退」）
 *
 * ══════════════════════════════════════════════════════════════════
 * 真因（2026-09-17 第 29/31/32 轮，全部有 code + 实测双证，**都不是产品缺陷**）
 * ──────────────────────────────────────────────────────────────────
 *   ① **环境变量污染**：`ELECTRON_RUN_AS_NODE=1` 一旦存在，那个 exe 会**退化成纯 Node**：
 *      无参数读空 stdin ⇒ **216 ms 静默 exit 0（一个窗口都不出）**；
 *      带 `--remote-debugging-port` ⇒ `bad option` **exit 9**。
 *      ⚠️ agent / 终端会话里**天生带**这个变量 ⇒ 从这种终端启动看上去就是"闪退"。
 *   ② 🔴 **单实例接管**：已有实例在跑（**含托盘里看不见的、调试留下的**）时，第二次启动
 *      **1.0–1.4 s 静默 exit 0、输出只有 2 字节 `\r\n`**，窗口永远不出现 —— 用户看到的就是"闪退"。
 *      asar 原文（`/lib/main.js`）：`if (!app.requestSingleInstanceLock()) app.quit();`
 *      —— 这条路径**不打印任何东西**，所以"没输出"不等于"没发生"。
 *   ③ 🔴 **关窗不退（设计如此）** ⇒ ②的**制造机**。asar 原文
 *      （`/lib/types/window-lifecycle.js`）：`onWindowClose(e){ e.preventDefault(); getWindow()?.hide(); }`
 *      加上 `app.on("window-all-closed", () => {})` ⇒ 点 × 只是 **hide 到托盘**：
 *      进程常驻、只剩托盘图标；用户以为关了 ⇒ **下一个双击必然命中 ②**。
 *      唯一正常退出 = **右键托盘图标 → 退出**（`releaseAppQuit` 才会 `tray.destroy()` + `app.quit()`）。
 *   ④ 🔴 **boot 期窗口唤不醒**：`app.on("second-instance", () => lifecycle?.showWindow())` 里那个 `?.`
 *      是**空操作保护**：boot 在 `await currentHost.start()`（就绪上限 **90 s**）期间 `lifecycle` 尚未赋值
 *      ⇒ 此时新启动被静默接管后，**旧实例也不会把窗口唤出来** ⇒ 纯"闪退"。
 *
 * ══════════════════════════════════════════════════════════════════
 * 对照实验（本机实测，干净环境下的真实条件 —— 逐秒看进程表 + 窗口标题）
 *   · clean env + 仅此一个实例          ⇒ ✅ 90 s 稳定：5 进程 · 主窗口标题 `DeepSeek Harness` 全程在
 *   · `ELECTRON_RUN_AS_NODE=1`          ⇒ 🔴 216 ms exit 0 / bad option exit 9
 *   · 已有实例在跑（同一 spawn 机制）    ⇒ 🔴 1.40 s exit 0，输出 `b'\r\n'`，旧实例不受影响
 *   ⇒ 结论：应用本身健康，**启动上下文**才是变量。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 判据（v3 修正 —— 这是本文件存在的主要理由）
 * ──────────────────────────────────────────────────────────────────
 * v2 在"CDP 出现 page 目标"（≈窗口出现，2.5–4.3 s）就报 ✅ —— 而 ② 的故障形态是
 * **被接管后从此再也不出窗口**，③ 的故障形态是**稍后才被自己关掉**。两者都不在
 * "2.5–4.3 s 有 page 目标"这个窗里 ⇒ **启动器永远报绿，用户永远闪退**（纪律 31「报绿先审口径」）。
 * v3 因此做两件事：
 *   · 窗口出现后**继续观察 `--hold` 秒（默认 15）**：我们起的那个 pid 必须还在、主窗口标题必须还在；
 *   · 结论用 `classifyLaunchOutcome()` **归成 5 个互不相同的 verdict**（`OK / TAKEN_OVER / DIED /
 *     NO_WINDOW / BAD_OPTION`），每个 verdict 配**可分辨的下一步**（纪録 58／112）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法（双击 `Start Harness.cmd` 等价于第一条）
 *   node scripts/start-harness.mjs            # 清残留 → 启动 → 等窗口 → **再观察 15 s** → 结论
 *   node scripts/start-harness.mjs --hold 30  # 观察窗改 30 s（冷启动慢时用）
 *   node scripts/start-harness.mjs --keep     # 已在跑就不动它（只确认窗口在）
 *   node scripts/start-harness.mjs --stop     # 只做验证式停机
 *   node scripts/start-harness.mjs --no-cdp   # 不带调试参数（纯用户视角）
 *   node scripts/start-harness.mjs --diag     # 只打印启动上下文，不启动
 *
 * 退出码：0 = 窗口已出现且观察窗内未退出 · 2 = 前提不成立（exe 缺失 / 预算内没等到窗口 / 起来后又死 / 被接管）
 * 留痕：`logs/harness-launch.log`（每次启动追加一行：verdict / 环境警告 / 残留数 / pid / 端口 / 耗时 / 应用输出字节）
 */

import fs, { existsSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import {
	HARNESS, imageProcs, harnessWindows, mainWindowPids, portBusy, stopHarness,
	spawnHarnessEx, appLogLines, classifyLaunchOutcome, verdictAdvice, LAUNCH_VERDICTS
} from "./_harness.mjs";

const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const STOP = argv.includes("--stop");
const NO_CDP = argv.includes("--no-cdp");
const DIAG = argv.includes("--diag");
/** 窗口出现后的**持续观察窗**（秒）—— 判据的主要修正（v2 只看"出现"） */
const HOLD = (() => {
	const i = argv.indexOf("--hold");
	if (i >= 0) { const n = Number(argv[i + 1]); if (Number.isFinite(n) && n >= 0) return n; }
	const hit = argv.find((a) => /^--hold=\d+$/.test(a));
	if (hit) return Number(hit.split("=")[1]);
	return 15;
})();
const WANT_PORT = Number(process.env.CDP_PORT || 9222);
const ROOT = path.join(import.meta.dirname, "..");
const LAUNCH_LOG = path.join(ROOT, "logs", "harness-launch.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 🔴 启动上下文自检：这两个变量就是"闪退"的第①因（**只看有值的** —— 空值无害） */
const POLLUTED = ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].filter((k) => process.env[k]);

function logLine(s) { console.log("  " + s); }
function writeLaunchLog(s) {
	try {
		mkdirSync(path.dirname(LAUNCH_LOG), { recursive: true });
		appendFileSync(LAUNCH_LOG, s + "\n", "utf8");
	} catch (e) { /* 留痕失败不影响启动 */ }
}
/** 读应用输出（证词的原文） */
function readOut(file) {
	try { return existsSync(file) ? fs.readFileSync(file, "utf8") : ""; } catch (_) { return ""; }
}

/* ── 残留清单：**pid + 窗口标题**（可分辨"可见实例"与"托盘里的不可见实例"）── */
function dumpInstances(prefix) {
	const rows = harnessWindows();
	console.log("  " + prefix + "：" + rows.length + " 个" + (rows.length ? "" : "（干净）"));
	for (const r of rows) {
		console.log("    · pid " + r.pid + " 窗口=" + (r.hasWindow ? "「" + r.title + "」" : "**无（多半在托盘里）**"));
	}
	return rows;
}

/** CDP 上的**页面目标**（= 窗口已渲染）；没有目标说明窗口还没出来 */
function pageTargets(port) {
	return new Promise((resolve) => {
		const req = http.get({ host: "127.0.0.1", port: port, path: "/json/list", timeout: 3000 }, (r) => {
			let s = "";
			r.on("data", (d) => { s += d; });
			r.on("end", () => { try { resolve(JSON.parse(s).filter((t) => t.type === "page")); } catch (e) { resolve([]); } });
		});
		req.on("error", () => resolve([]));
		req.on("timeout", () => { req.destroy(); resolve([]); });
	});
}

/** 端口自选：被占就顺移（**幽灵占用**会让 CDP 绑不上，见 T-PLUG-040） */
async function pickPort(start) {
	for (let p = start; p < start + 12; p++) if (!(await portBusy(p))) return p;
	return start;
}

console.log("══ 启动 DeepSeek Harness（治闪退版 v3 · 判据含 " + HOLD + " s 观察窗）══");
console.log("  启动上下文：" + (POLLUTED.length
	? "🔴 本终端带 " + POLLUTED.join(" / ") + " —— 直接点 exe 会**退化成纯 Node 而静默退出**；本脚本已清掉"
	: "✅ 干净（无 ELECTRON_RUN_AS_NODE / NODE_OPTIONS）"));
if (!existsSync(HARNESS.exe)) {
	console.log("  ❌ 可执行文件不存在：" + HARNESS.exe);
	writeLaunchLog(new Date().toISOString() + " FAIL exe-missing");
	process.exit(2);
}
const beforeRows = dumpInstances("当前实例");
const before = beforeRows.map((r) => r.pid);
if (DIAG) {
	console.log("  端口 " + WANT_PORT + " 被占 = " + (await portBusy(WANT_PORT)));
	console.log("  exe = " + HARNESS.exe);
	console.log("  用法：--stop 只停机 / --keep 不动已在跑的 / --no-cdp 无调试参数 / --hold N 观察窗");
	process.exit(0);
}

/* ── ① 先做验证式停机（除非 --keep）── */
if (!KEEP) {
	if (before.length) logLine("↳ 先停机（残留实例会让新窗口**永远不出现** —— 这就是「闪退」）");
	const st = await stopHarness({ log: logLine, budgetMs: 25000 });
	const left = imageProcs();
	logLine("停机结果：进程表 " + left.length + " 个 · 端口 " + WANT_PORT + " 可 bind = " + !(await portBusy(WANT_PORT)));
	if (st && st.leftover && st.leftover.length) {
		logLine("⚠️ 杀不动的残留（宿主可能以管理员运行，需提权）：" + JSON.stringify(st.leftover));
		logLine("   处置：右键**托盘图标 → 退出**，或用**管理员** PowerShell 跑 taskkill /F /IM \"" + path.basename(HARNESS.exe) + "\"");
	}
}
if (STOP) {
	console.log("  ✅ 仅停机完成（未启动）");
	writeLaunchLog(new Date().toISOString() + " STOP 完成 · 残留 " + imageProcs().length);
	process.exit(imageProcs().length ? 1 : 0);
}
if (KEEP && before.length) {
	console.log("  --keep：不动已在跑的实例（若窗口看不见，去掉 --keep 重跑会自动清残留）");
	const winPids = mainWindowPids();
	console.log("  " + (winPids.length ? "✅ 主窗口在（pid " + winPids.join(",") + "）" : "⚠️ 进程在但**没有主窗口**（托盘里？boot 未完成？）—— 去掉 --keep 重跑"));
	process.exit(0);
}

/* ══════════════════════════════════════════════════════════════════
 * ② 启动 + **等待窗口 + 持续观察**（判据的核心修正）
 * ══════════════════════════════════════════════════════════════════ */
/**
 * 拉起一次并完成「窗口出现 → 观察 HOLD 秒 → 结论」。
 * 返回的**全是观测**，不做判断（判断交给 `classifyLaunchOutcome` —— 纯函数，可离线测）。
 */
async function launchOnce(port, tag, holdSec) {
	const OUT = path.join(ROOT, "logs", "_harness-launch" + (port ? "-" + port : "-nocdp") + tag + ".out");
	const t0 = Date.now();
	const rec = spawnHarnessEx(port
		? { port: port, log: logLine, outFile: OUT }
		: { port: 0, log: logLine, outFile: OUT, args: [] });
	if (!rec || !rec.pid) return { rec: null, out: OUT, appearedSecs: null, diedSecs: null, heldSecs: 0 };
	const mine = String(rec.pid);
	const secs = () => Number(((Date.now() - t0) / 1000).toFixed(1));

	/* 阶段一：等窗口出现（最长 120 s —— 冷启动实测 58–120 s 也能出） */
	let appearedSecs = null, diedSecs = null, seenTick = -1;
	const deadline = Date.now() + 120000;
	while (Date.now() < deadline) {
		const alive = imageProcs().indexOf(mine) >= 0;
		if (!alive) { diedSecs = secs(); break; }
		const winOk = port ? (await pageTargets(port)).length > 0 : mainWindowPids().length > 0;
		if (winOk) { appearedSecs = secs(); break; }
		const t = Math.round((Date.now() - t0) / 1000);
		if (t > 0 && t % 10 === 0 && t !== seenTick) {
			seenTick = t;
			console.log("    t+" + t + "s 等窗口出现…（进程 " + imageProcs().length + " 个）");
		}
		await sleep(1200);
	}

	/* 阶段二：🔴 窗口出现后**继续观察** —— v2 缺的就是这一步 */
	let heldSecs = 0;
	if (appearedSecs !== null && holdSec > 0) {
		const hT0 = Date.now();
		console.log("    ✅ 窗口出现（" + appearedSecs + " s）⇒ **继续观察 " + holdSec + " s** …");
		while (Date.now() - hT0 < holdSec * 1000) {
			await sleep(1200);
			if (imageProcs().indexOf(mine) < 0) { diedSecs = secs(); break; }
		}
		heldSecs = Number(((Date.now() - hT0) / 1000).toFixed(1));
	}
	return { rec: rec, out: OUT, appearedSecs: appearedSecs, diedSecs: diedSecs, heldSecs: heldSecs };
}

/** 把一次 `launchOnce` 的观测归成 verdict + 上下文（**只读观测，不抛**） */
function judge(r) {
	const procs = imageProcs();
	const mineGone = r.rec == null ? true : procs.indexOf(String(r.rec.pid)) < 0;
	const others = r.rec == null ? procs.length : procs.filter((p) => p !== String(r.rec.pid)).length;
	const txt = readOut(r.out);
	/* 🔴 **窗口出现过**是一个**独立的、比"进程还在"更耐环境回收**的读数（纪律 118）。
	 * 为什么必须把它并进判据（第三十二轮实测）：
	 *   本环境（会话作业对象）会回收**任何**由它拉起的 GUI —— 实测 `notepad.exe` 同样
	 *   在**下一个工具调用**里归零。于是「应用启动成功了没有」与「此刻进程还在没有」
	 *   是**两个不同的问题**：前者由 `appearedSecs`（启动期观测）+ 应用输出共同回答，
	 *   后者只反映"谁在等我"。把后者当唯一判据 ⇒ 每次双击都报红（**假红**），
	 *   而用户那边窗口其实**真的出来了**。
	 *   ⇒ 口径：**窗口在观察窗内出现过** 且 应用输出**没有致命行** ⇒ 启动是成功的。 */
	const appeared = r.appearedSecs !== null;
	const hostFatal = /Host exited unexpectedly|bad option/i.test(txt);
	const verdict = classifyLaunchOutcome({
		pidGone: mineGone,
		exitCode: r.rec && r.rec.exit ? r.rec.exit.code : null,
		outBytes: Buffer.byteLength(txt, "utf8"),
		othersAlive: others,
		mainWindow: mainWindowPids().length > 0,
		badOption: /bad option/i.test(txt),
		appeared: appeared,
		hostFatal: hostFatal
	});
	return {
		verdict: verdict, procs: procs.length, others: others, mineGone: mineGone,
		appeared: appeared, hostFatal: hostFatal,
		exit: r.rec ? r.rec.exit : null, outBytes: Buffer.byteLength(txt, "utf8"), text: txt
	};
}

let PORT = NO_CDP ? 0 : await pickPort(WANT_PORT);
if (PORT !== WANT_PORT && PORT) logLine("端口 " + WANT_PORT + " 被占 ⇒ 改用 " + PORT + "（幽灵占用会让 CDP 绑不上）");
let r = await launchOnce(PORT, "", HOLD);
console.log("");
console.log("  已拉起 pid=" + (r.rec ? r.rec.pid : "null") + (PORT ? "（调试端口 " + PORT + "）" : "（无调试参数）"));

/* 🔴 起来后又死 ⇒ **自动重试一次**（去掉调试参数，排除"端口/参数"这一路）；仍死才判失败。
 *    ⚠️ 但**已经出过窗口**的不重试：那是环境回收，重试只会把一次成功启动变成一次失败（第三十二轮）。 */
let j = judge(r);
if (j.verdict === LAUNCH_VERDICTS.DIED && j.others === 0 && !j.appeared) {
	console.log("  ⚠️ 进程起来后 " + r.diedSecs + " s 就没了（**窗口从未出现**）⇒ 自动重试一次（**不带调试参数**）…");
	await sleep(1500);
	r = await launchOnce(0, "-retry", Math.min(HOLD, 10));
	if (PORT) PORT = 0;
	j = judge(r);
} else if (j.verdict === LAUNCH_VERDICTS.DIED && j.appeared) {
	console.log("  ℹ️ 窗口出现过、随后进程表归零 ⇒ 判为**环境回收**（见下），不重试。");
}
const { verdict } = j;
/** 观测摘要（`null` 要写成"没出现"，不要打印 "null s"） */
const fmtSecs = (v) => (v == null ? "未出现" : v + " s");

console.log("");
if (verdict === LAUNCH_VERDICTS.OK) {
	console.log("  ✅ 窗口已在（" + r.appearedSecs + " s）· 进程 " + j.procs + " 个 · 观察窗 " + r.heldSecs + " s 内未退出"
		+ (PORT ? " · CDP http://127.0.0.1:" + PORT : ""));
	console.log("     （本脚本已退出，应用继续运行；关掉这个终端不会关掉应用）");
} else if (verdict === LAUNCH_VERDICTS.STARTED_THEN_REAPED) {
	console.log("  ✅ 启动成功（窗口在 " + r.appearedSecs + " s 出现）—— 此刻进程表为空属**本会话回收**，非产品问题");
	console.log("     实证：无关第三方 notepad.exe 同会话拉起后同样在下一个调用里归零；同调用内应用可稳活 100 s+");
} else {
	console.log("  ❌ verdict=" + verdict + " ｜ 窗口出现=" + fmtSecs(r.appearedSecs) + " ｜ 进程消失=" + fmtSecs(r.diedSecs)
		+ " ｜ 观察至 " + r.heldSecs + " s");
	console.log("     进程 " + j.procs + " 个 · 别的实例 " + j.others + " 个 · 应用输出 " + j.outBytes + " 字节"
		+ (j.exit ? " · 本进程退出码 " + j.exit.code : " · 本进程仍在"));
}
console.log("");
console.log("  ⇒ " + verdictAdvice(verdict));
const lines = appLogLines(r.out, 12);
if (lines.length) {
	console.log("");
	console.log("     应用自己的输出（**真因在这里，别去猜产品**）：");
	for (const l of lines) console.log("       ‣ " + l);
}
if (verdict !== LAUNCH_VERDICTS.OK) {
	console.log("");
	console.log("  排查顺序（按实测概率）：");
	console.log("    ① 上一轮留下的实例还在（托盘里也可能）⇒ 先跑 `node scripts/stop-harness.mjs`，或右键托盘图标 → 退出");
	console.log("    ② 本终端带 ELECTRON_RUN_AS_NODE ⇒ 已自动清掉；日志里有 `bad option` 说明没清干净");
	console.log("    ③ 有杀不动的残留（宿主以管理员运行）⇒ 用**管理员** PowerShell：taskkill /F /IM \"" + path.basename(HARNESS.exe) + "\"");
	console.log("    ④ 把 `" + path.relative(ROOT, r.out).replace(/\\/g, "/") + "` 与 `logs/harness-launch.log` 发给 AI");
}
writeLaunchLog(new Date().toISOString() + " " + verdict + " env-polluted=" + JSON.stringify(POLLUTED)
	+ " before=" + before.length + " pid=" + (r.rec ? r.rec.pid : "null") + " port=" + PORT
	+ " appeared=" + r.appearedSecs + " died=" + r.diedSecs + " held=" + r.heldSecs
	+ " exitCode=" + (j.exit ? j.exit.code : "n/a") + " outBytes=" + j.outBytes
	+ " out=" + path.relative(ROOT, r.out).replace(/\\/g, "/")
	+ " logBytes=" + (existsSync(r.out) ? statSync(r.out).size : 0));

/* ══════════════════════════════════════════════════════════════════
 * ③ 🔴 续保：**本脚本不能一走了之**（第三十二轮真因）
 * ══════════════════════════════════════════════════════════════════
 * 实测（同一条 exe、同一台机器）：
 *   · `explorer.exe` 真实双击 `.cmd` ⇒ 宿主就绪后报 `Host exited unexpectedly (code 1)`
 *     而应用随之退出 ⇒ 用户看到「闪退」。
 *   · 同一份 `.cmd`，只要 **node 父进程还在**（`--hold 20` 停在观察窗里）⇒ `OK`、窗口稳定。
 *   · 宿主 CLI 单独在终端里跑 ⇒ **活 296 s** 纹丝不动。
 * ⇒ 差异**只有一个**：**启动器进程还在不在**。宿主是桌面壳的子进程，桌面壳又是本脚本的子进程；
 *    本脚本一 `exit`，整条链就被回收 ⇒ 应用跟着没。
 *   （这与纪律 113 同源：**本会话回收它拉起的整棵 GUI 进程树**。）
 * ⇒ 处置：观测定论之后**默认不退**，改为**守着**（同 `--hold` 的语义），
 *    让「双击 `Start Harness.cmd` ⇒ 窗口留住」这条**用户路径**真正成立。
 *    要它能自己退（自动化场景）用 `--no-keepalive`。
 * ⚠️ 但**结论与退出码必须在守之前就定好**（不能因为"守着"就把红说成绿）。
 */
const NO_KEEPALIVE = argv.includes("--no-keepalive");
/* 退出码：0 = **启动成功**（含"起过、被会话回收"）；2 = 真失败（DIED / TAKEN_OVER / NO_WINDOW / BAD_OPTION） */
const SUCCESS_KEEP = [LAUNCH_VERDICTS.OK, LAUNCH_VERDICTS.STARTED_THEN_REAPED];
const succeeded = SUCCESS_KEEP.indexOf(verdict) >= 0;
if (succeeded && !NO_KEEPALIVE && !process.env.CI) {
	console.log("");
	console.log("  🔒 **保持常驻**：本脚本会一直守着，直到你关闭 Harness 或按 Ctrl+C。");
	console.log("     （宿主是它的子进程 —— 本脚本一退，应用就会被连带回收 ⇒ 这才是一直以来“闪退”的最后一段真因）");
	console.log("     若要让脚本自己退出（自动化/CI）：加 --no-keepalive");
	/* 守到应用自己消失为止；期间只做**只读**轮询 */
	let ticks = 0;
	const guard = setInterval(() => {
		ticks++;
		const alive = r.rec ? imageProcs().indexOf(String(r.rec.pid)) >= 0 : false;
		if (!alive) {
			console.log("  ℹ️ 应用已退出（" + ticks + " s 后检测到）⇒ 本脚本随之结束。");
			clearInterval(guard);
			process.exit(succeeded ? 0 : 2);
		}
	}, 1000);
	/* Ctrl+C 优雅退出 */
	for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { clearInterval(guard); process.exit(0); });
	/* 🔴 永不 resolve：把事件循环挂在 interval 上，脚本不退出 */
	await new Promise(() => {});
}
process.exit(succeeded ? 0 : 2);
