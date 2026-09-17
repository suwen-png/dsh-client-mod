#!/usr/bin/env node
/**
 * _harness.mjs —— Harness（Electron）**启动/就绪/停机/重启**共享助手（第二十四轮新增）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它（本轮踩到的真问题，不是洁癖）
 * ──────────────────────────────────────────────────────────────────
 * ① 🔴 **自动化会话里 `Start-Process` 起的 Harness 活不过本次工具调用。**
 *    实测（2026-09-17）：进程起来了（5 个），但**下一个工具调用**里查到 `count: 0`，
 *    `debug.log` 没有新增任何行；即便用 `spawn(..., {detached:true}) + unref()`，
 *    端口曾短暂 LISTENING，下一个调用里即 `ECONNREFUSED` + 进程归零。
 *    ⇒ 会话结束时父进程的**作业对象**连带回收整棵进程树。
 *      这解释了项目纪律 ㊵ 为什么写「**Harness 启动与测试同一条 bash 命令**」——
 *      那不是习惯，是**环境约束**。
 *
 * ② 🔴 **`taskkill /F /IM` 报"成功"之后，端口仍可能被残留进程占着**（幽灵）。
 *    实测（2026-09-17 · `_tmp-probe-restart3.mjs` 段3）：杀掉旧实例后立刻在同端口起新的，
 *    新实例**进程是活的**，但自己吐出一手证词：
 *      `ERROR:net\socket\tcp_socket_win.cc:530] bind() returned an error:
 *       通常每个套接字地址(协议/网络地址/端口)只允许使用一次。 (0x2740)`
 *      `ERROR:content\browser\devtools\devtools_http_handler.cc:311] Cannot start http server for devtools.`
 *    且 `netstat` 里**旧 pid 仍在 9222 LISTENING**。
 *    ⇒ 症状极其迷惑：进程活着、应用界面可能起来了、**唯独 CDP 永远连不上**；
 *      对上层表现为「重启了但套件全 INVALID」，而根因与产品**毫无关系**。
 *    ⇒ 两条处置（本模块都实现了）：
 *      · `stopHarness()` 改成**验证式停机** —— 结论看**进程表 + 端口**，不看 taskkill 的文案
 *        （中文输出经 utf8 解码是乱码，看文案会假成功 —— 纪律 61）；
 *      · `ensureHarness()` 支持**端口顺移** —— 端口仍被占就换一个，绕开幽灵（纪律 12 的延伸）。
 *
 * ③ 新实例的 stdout/stderr **必须留痕**：上面那句 ERROR 是本轮唯一能一锤定音的证据，
 *    而早期实现用 `stdio:"ignore"` 把它直接扔了 ⇒ `spawnHarness` 现在默认写 `logs/_harness-<port>.out`。
 *
 * ══════════════════════════════════════════════════════════════════
 * 本模块提供的语义
 * ──────────────────────────────────────────────────────────────────
 *  · `spawnHarness()`  —— 按 `restart-harness.ps1` 的**同一组参数**拉起（含遮挡/后台节流三个
 *    开关；注意：它们只解决**降速**，不解决 `visibilityState`），并把应用输出写进日志文件。
 *  · `portBusy()`     —— **主动 bind 探测**端口是否被占（比读 `netstat` 状态更少歧义）。
 *  · `imageProcs()`   —— 当前 `DeepSeek Harness.exe` 的 pid 列表（幽灵检测的真相源）。
 *  · `waitCdpReady()` —— **有界轮询** `/json/version`；超预算返回 `false`（不抛）。
 *  · `ensureHarness()` —— 已在跑就直接复用（**不重复起第二个实例**，纪律 ⑫：单实例锁会静默
 *    复用旧进程，端口不变会骗过"重启了"的判断）；`forceRestart` 时先 `stopHarness()`；
 *    端口被幽灵占着时按 `maxShift` 顺移，并把**实际使用的端口**返回给调用方。
 *  · `stopHarness()`  —— 按镜像名结束 + **轮询验证已干净**；失败可解释（宿主以管理员运行时
 *    杀不动，见纪律 74）。
 *
 * 🔴 **用法约束**：调用方必须把「确保就绪 → 跑套件」放在**同一次 Node 进程**里，
 *    否则 Harness 会被会话回收。见 `repeat-director-logic.mjs` 的 `DL_RESTART_EVERY`。
 */

import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const IMAGE = "DeepSeek Harness.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 与 `restart-harness.ps1` 保持同源（改一处必须改两处，故在此注明来源） */
export const HARNESS = Object.freeze({
	exe: "D:\\软件安装\\DeepSeek-Harness-Desktop\\DeepSeek Harness\\DeepSeek Harness.exe",
	workDir: "D:\\软件安装\\DeepSeek-Harness-Desktop\\DeepSeek Harness",
	args: [
		"--remote-debugging-port=9222",
		"--disable-features=CalculateNativeWinOcclusion",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding"
	]
});

/* ══════════════════════════════════════════════════════════════════
 * 一、基础读数
 * ══════════════════════════════════════════════════════════════════ */

/** 单个 HTTP GET（只用 Node 内置模块，避免依赖 fetch 在本环境的可用性） */
function httpGet(port, p, timeoutMs) {
	return new Promise((resolve) => {
		const req = http.get({ host: "127.0.0.1", port: port, path: p, timeout: timeoutMs || 3000 }, (res) => {
			let body = "";
			res.on("data", (d) => { body += d; });
			res.on("end", () => resolve({ ok: true, body: body }));
		});
		req.on("error", (e) => resolve({ ok: false, err: String(e && e.message) }));
		req.on("timeout", () => { req.destroy(); resolve({ ok: false, err: "timeout" }); });
	});
}

/** CDP 是否可达（一次探测，不重试） */
export async function cdpAlive(port) {
	const p = Number(port || 9222);
	const r = await httpGet(p, "/json/version", 2500);
	return r.ok === true;
}

/** 当前 `DeepSeek Harness.exe` 的 pid 列表（空数组 = 一个都不在） */
export function imageProcs() {
	try {
		const out = execFileSync("tasklist", ["/FO", "CSV", "/FI", "IMAGENAME eq " + IMAGE],
			{ encoding: "utf8", timeout: 15000 });
		return out.trim().split(/\r?\n/)
			.filter((l) => l.indexOf("DeepSeek") >= 0)
			.map((l) => l.split('","')[1].replace(/"/g, ""));
	} catch (_) { return []; }
}

/* ══════════════════════════════════════════════════════════════════
 * 一之二、窗口真相源 + 启动结论判定（第二十五轮新增）
 * ══════════════════════════════════════════════════════════════════
 * 🔴 为什么还需要窗口真相源（CDP 已能证明"有 page 目标"）
 * ──────────────────────────────────────────────────────────────────
 * `--remote-debugging-port` 是**我们自己加的**参数；裸启动（用户双击开始菜单 lnk）
 * 没有 CDP ⇒ 判"窗口在不在"就没了读数。而本轮"打开就闪退"的判定需要
 * **任何启动方式下都成立的**窗口读数 ⇒ 用 `tasklist /V` 的 `Window Title` 列。
 * 实测（2026-09-17，90 s 长观察）：5 个 Harness 进程里**只有主进程**带标题
 * `DeepSeek Harness`，其余是 `N/A` 或输入法窗口标题 ⇒ 匹配标题即判"主窗口在"。
 */

/** 主窗口标题 —— 应用 `createMainWindow` 里 `title: APP_NAME` 的实测值 */
export const MAIN_WINDOW_TITLE = "DeepSeek Harness";

/**
 * 当前 Harness 进程的 **pid + 窗口标题**（`tasklist /V`）。
 * 返回 `[{pid,title,hasWindow}]`；`title==="N/A"` 或空 ⇒ `hasWindow=false`。
 * 不抛：读不到就返回 `[]`（调用方按"无读数"处理，纪律 19 的降级要可分辨）。
 */
export function harnessWindows() {
	const out = [];
	try {
		const raw = execFileSync("tasklist", ["/V", "/FO", "CSV", "/NH", "/FI", "IMAGENAME eq " + IMAGE],
			{ encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
		for (const line of raw.split(/\r?\n/)) {
			const l = line.trim();
			if (l.indexOf("DeepSeek Harness.exe") < 0) continue;
			const cols = l.split('","').map((s) => s.replace(/^"|"$/g, ""));
			const pid = cols[1] || "";
			const title = String(cols.length >= 9 ? cols[8] : (cols[cols.length - 1] || "")).replace(/^"|"$/g, "").trim();
			out.push({ pid: pid, title: title, hasWindow: title.length > 0 && title !== "N/A" });
		}
	} catch (_) { /* 读不到 ⇒ 空数组（不是"没有进程"，是"没有读数"） */ }
	return out;
}

/** 带主窗口（标题 = `DeepSeek Harness`）的 pid 列表 —— 「窗口真的在」的判据 */
export function mainWindowPids() {
	return harnessWindows().filter((p) => p.title === MAIN_WINDOW_TITLE).map((p) => p.pid);
}

/* ── 启动结论：**纯函数**（离线可测、可植入缺陷校准，纪律 32/108）────── */

/** 五个**互不相同**的结论码（纪律 58：归因必须可分辨，否则等于没归因） */
export const LAUNCH_VERDICTS = Object.freeze({
	/** 我们起的进程还活着，且主窗口标题在 */
	OK: "OK",
	/** 我们起的进程**没了**，但**别的实例还在** ⇒ 单实例锁把它静默接管了 */
	TAKEN_OVER: "TAKEN_OVER",
	/** 我们起的进程没了，且**没有别的实例** ⇒ 应用自己退出了 */
	DIED: "DIED",
	/** 进程活着但**没有主窗口**（可能仍在 boot，也可能卡住） */
	NO_WINDOW: "NO_WINDOW",
	/** 应用输出了 `bad option`（`ELECTRON_RUN_AS_NODE` 没清干净，退化成纯 Node） */
	BAD_OPTION: "BAD_OPTION",
	/** 🔴 **启动成功过**（窗口在观察窗内出现过），但**此刻进程已被回收** —— 见下方长注释 */
	STARTED_THEN_REAPED: "STARTED_THEN_REAPED"
});

/**
 * 把**一次启动的观测**归成可分辨结论。
 *
 * 🔴 顺序即优先级，三条都不能挪：
 *   ① `badOption` 最先判 —— 它有自己的独特修法（清环境变量），被后面的分支吞掉就无法归因；
 *   ② `othersAlive` 优先于 `mainWindow` —— 单实例接管时**窗口是别的实例的**，
 *      若先看 `mainWindow` 就会把"被接管"误报成 OK（这正是第二十九轮假绿的形态）；
 *   ③ 🔴 `appeared && !hostFatal` 优先于裸的 `DIED`（**第三十二轮新增**）——
 *      本环境（会话作业对象）会回收**任何**由它拉起的 GUI：实测无关第三方
 *      `notepad.exe` 同样在**下一个工具调用**里归零，而**同一次调用内**能稳定活 100 s。
 *      因此「**启动成功了吗**」与「**此刻进程还在吗**」是**两个不同的问题**：
 *      · 前者看 `appeared`（启动期已观测到的窗口）＋ 应用输出有无致命行；
 *      · 后者只反映"**谁还在等我**"——父进程一退，判据就归零，与产品无关。
 *      把后者当唯一判据 ⇒ **每次双击都报红**，而用户那边窗口其实真的出来了。
 *
 * @param {{pidGone?:boolean,exitCode?:number|null,outBytes?:number,othersAlive?:number,mainWindow?:boolean,badOption?:boolean,appeared?:boolean,hostFatal?:boolean}} o
 * @returns {string} `LAUNCH_VERDICTS` 之一
 */
export function classifyLaunchOutcome(o) {
	const opt = o || {};
	if (opt.badOption === true) return LAUNCH_VERDICTS.BAD_OPTION;
	const pidGone = opt.pidGone === true;
	const othersAlive = Number(opt.othersAlive || 0) > 0;
	const mainWindow = opt.mainWindow === true;
	if (!pidGone) return mainWindow ? LAUNCH_VERDICTS.OK : LAUNCH_VERDICTS.NO_WINDOW;
	if (othersAlive) return LAUNCH_VERDICTS.TAKEN_OVER;
	/* 🔴 进程没了、也没有别的实例。只有当**它压根没起来过**时才叫 DIED；
	 *   若窗口在观察窗内出现过且应用没吐致命行，那是**环境回收**，不是崩溃。 */
	if (opt.appeared === true && opt.hostFatal !== true) return LAUNCH_VERDICTS.STARTED_THEN_REAPED;
	return LAUNCH_VERDICTS.DIED;
}

/** 结论 ⇒ **下一步该做什么**（可分辨、可测；不许返回"未知错误"这种废话） */
export function verdictAdvice(v) {
	switch (v) {
	case LAUNCH_VERDICTS.OK:
		return "窗口已在。⚠️ 关掉窗口只是**缩到托盘**（应用设计如此：window-all-closed 空 + close→hide）；"
			+ "要真正退出请**右键托盘图标 → 退出**，否则残留实例会让**以后每次双击都静默退出**。";
	case LAUNCH_VERDICTS.TAKEN_OVER:
		return "🔴 已有另一个实例占着单实例锁，新进程被**静默接管**（rc=0、零输出、无窗口）——"
			+ "这就是「打开就闪退」。处置：点**托盘图标**唤出那个实例，或先跑 `stop-harness.mjs` 清干净再启动。";
	case LAUNCH_VERDICTS.DIED:
		return "🔴 进程起来后自己退出，且没有别的实例。看应用输出："
			+ "含 `bad option` ⇒ ELECTRON_RUN_AS_NODE 没清干净；含 `Host exited unexpectedly` ⇒ 宿主子进程先死。";
	case LAUNCH_VERDICTS.NO_WINDOW:
		return "🔴 进程活着但**没有主窗口**（boot 未完成或卡住）。boot 里 `currentHost.start()` 的就绪上限是 **90 s**，"
			+ "在此期间 `second-instance` 的 `lifecycle?.showWindow()` 是**空操作** ⇒ 再双击也什么都不出。等满 90 s 再看。";
	case LAUNCH_VERDICTS.BAD_OPTION:
		return "🔴 应用输出里有 `bad option` ⇒ 它是被当成**纯 Node** 跑的（`ELECTRON_RUN_AS_NODE=1` 污染了启动上下文），"
			+ "不会出任何窗口。处置：清掉该变量再从 `Start Harness.cmd` 启动（本脚本已自动清）。";
	case LAUNCH_VERDICTS.STARTED_THEN_REAPED:
		return "✅ **启动成功**：窗口在观察窗内出现过（见 appeared 读数）。此刻进程表为空是**本会话在回收它拉起的 GUI**——"
			+ "实测无关第三方 `notepad.exe` 同样如此，**与产品无关**。你在真实桌面上双击 `Start Harness.cmd` 即可正常使用。";
	default:
		return "无法判定（观测不足）：既没拿到进程表，也没拿到窗口标题 —— 先确认 `tasklist` 可用。";
	}
}

/** 端口是否被占 —— **主动 bind 探测**（不读 `netstat`）。
 * 为什么不用 `netstat`：它把 `LISTENING / ESTABLISHED / TIME_WAIT` 混在一起，
 * 判"能不能起"需要自己解释状态；而"能不能 bind"才是我们要问的问题。
 * （`netstat` 仍用于**诊断打印** —— 见 `netOn()`。）
 */
export function portBusy(port, host) {
	return new Promise((resolve) => {
		const srv = net.createServer();
		let done = false;
		const fin = (v) => { if (!done) { done = true; resolve(v); } };
		srv.once("error", (e) => fin(!!(e && e.code === "EADDRINUSE")));
		srv.once("listening", () => { try { srv.close(() => fin(false)); } catch (_) { fin(false); } });
		try { srv.listen(port, host || "127.0.0.1"); } catch (_) { fin(true); }
	});
}

/** `netstat -ano` 里与某端口相关的原始行（**只用于诊断打印**，不参与判据） */
export function netOn(port) {
	try {
		const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
		return out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.indexOf(":" + port) >= 0);
	} catch (_) { return []; }
}

/** 端口上处于 LISTENING 的 pid（幽灵定位用） */
export function listenersOn(port) {
	return netOn(port).filter((l) => /LISTENING/i.test(l)).map((l) => l.split(/\s+/).pop());
}

/* ══════════════════════════════════════════════════════════════════
 * 二、启动 / 就绪
 * ══════════════════════════════════════════════════════════════════ */

/** 有界轮询等 CDP 就绪；超预算返回 false（**不抛** —— 调用方负责判 INVALID） */
export async function waitCdpReady({ port = 9222, budgetMs = 60000, gapMs = 2000, log = console.log } = {}) {
	const t0 = Date.now();
	let last = "";
	while (Date.now() - t0 < budgetMs) {
		const r = await httpGet(port, "/json/version", 2500);
		if (r.ok) {
			log("  [Harness] CDP 就绪，用时 " + (Date.now() - t0) + "ms（port " + port + "）");
			return true;
		}
		last = r.err || "";
		await sleep(gapMs);
	}
	log("  [Harness] CDP 未就绪（预算 " + budgetMs + "ms 用尽）· 末次错误=" + last);
	return false;
}

/**
 * 拉起 Harness（不等待就绪）。返回 pid 或 null。
 * 🔴 `outFile` 默认落 `logs/_harness-<port>.out` —— **应用自己的输出必须留痕**：
 *    「CDP 起不来」的唯一一锤定音证据（`bind() returned an error` / `Cannot start http server`）
 *    就在里面，早期用 `stdio:"ignore"` 等于把证词扔掉。
 */
export function spawnHarness({ port = 9222, log = console.log, outFile = null } = {}) {
	const rec = spawnHarnessEx({ port: port, log: log, outFile: outFile });
	return rec ? rec.pid : null;
}

/**
 * 同 `spawnHarness()`，但返回**可观测记录**而不只是 pid：
 * `{pid, argv, outFile, exit}` —— `exit` 由 `exit` 事件**异步填** `{code,signal,at}`。
 *
 * 🔴 为什么要拿到退出码（纪律 112）：本轮「打开就闪退」的三条证据是
 *   **退出码 + 存活毫秒 + 应用输出**，少一条都无法区分
 *   `TAKEN_OVER`（rc=0 / ~1.4 s / 2 字节）与 `DIED`（rc=0 / ~0.7 s / 0 字节）。
 *   早期实现 `unref()` 后把子进程句柄丢了 ⇒ 退出码永远拿不到，只能靠猜。
 *   （`unref()` 只影响事件循环保活，**不影响** `exit` 事件的投递 —— 只要本进程还活着。）
 *
 * 🔴 第三十二轮：**`detached` 必须配 `windowsHide:false` 的独立控制台**，否则宿主活不过父进程。
 *   实测：同一 exe，直跑（父进程在）`OK`；经 `.cmd` 双击（父进程退出）⇒ `Host exited unexpectedly (code 1)`。
 *   根因是**桌面壳发现自己的子进程随父链一起被回收**。`detached:true` 让进程成为新进程组的组长，
 *   从而**脱离父进程的作业对象**（这是它真正的用处，不只是"后台运行"）。
 */
export function spawnHarnessEx({ port = 9222, log = console.log, outFile = null, args: argsIn = null } = {}) {
	if (!fs.existsSync(HARNESS.exe)) {
		log("  [Harness] 可执行文件不存在：" + HARNESS.exe);
		return null;
	}
	const env = Object.assign({}, process.env);
	delete env.ELECTRON_RUN_AS_NODE;
	delete env.NODE_OPTIONS;
	const args = argsIn !== null ? argsIn
		: HARNESS.args.map((a) => (a.indexOf("--remote-debugging-port=") === 0 ? "--remote-debugging-port=" + port : a));
	const file = outFile === null ? path.join(ROOT, "logs", "_harness-" + port + ".out") : outFile;
	let stdio = "ignore";
	if (file) {
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			const fd = fs.openSync(file, "w");
			stdio = ["ignore", fd, fd];
		} catch (_) { stdio = "ignore"; }
	}
	/* detached + 独立进程组：让应用**脱离父进程的作业对象**（否则父一退，它就被连带回收 —— 纪律 123） */
	const c = spawn(HARNESS.exe, args, { detached: true, stdio: stdio, cwd: HARNESS.workDir, env: env, windowsHide: false });
	const rec = { pid: c.pid || null, argv: args, outFile: file, exit: null };
	c.on("exit", (code, signal) => { rec.exit = { code: code, signal: signal, at: Date.now() }; });
	c.unref();
	log("  [Harness] 已拉起 pid=" + rec.pid + "（port " + port + "）"
		+ (file && stdio !== "ignore" ? " · 应用输出→" + path.relative(ROOT, file).replace(/\\/g, "/") : ""));
	return rec;
}

/** 读应用输出里**有诊断价值**的行（ERROR / DevTools / dsh web） */
export function appLogLines(file, max) {
	try {
		if (!file || !fs.existsSync(file)) return [];
		return fs.readFileSync(file, "utf8").split(/\r?\n/)
			.map((s) => s.trim()).filter((s) => s && /ERROR|WARN|DevTools|dsh web|bind\(\)/i.test(s))
			.slice(0, max || 6);
	} catch (_) { return []; }
}

/* ══════════════════════════════════════════════════════════════════
 * 三、停机（**验证式** —— 结论看进程表 + 端口，不看 taskkill 的文案）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 结束 Harness 进程。
 *
 * 🔴 两条纪律在这里落地：
 *   ① 纪律 61「`taskkill` 静默失败 ⇒ 幽灵重启」：**不许**以 taskkill 的 stdout 文案当结论 ——
 *      中文系统的输出经 utf8 解码是乱码（`����: û���ҵ...`），`/成功/` 这种匹配会**假成功/假失败**；
 *      退出码更可靠（**128 = 没有找到进程**，属"本来就干净"，无害）。
 *   ② 纪律 76「『清盘』≠『清干净』」：停机必须**轮询验证**「进程表为空 **且** 端口可 bind」，
 *      并把残留读数（`leftover`）**带回去** —— **降级可以，无声不行**（纪律 19）。
 */
export async function stopHarness({ log = console.log, budgetMs = 20000, port = null } = {}) {
	let code = 0, out = "";
	try {
		out = execFileSync("taskkill", ["/F", "/IM", IMAGE], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		code = (e && typeof e.status === "number") ? e.status : -1;
		out = String((e && (e.stdout || e.stderr)) || (e && e.message) || "");
	}
	/* 128 = 没有找到进程 ⇒ 本来就干净，不算失败 */
	const noProc = code === 128 || /没有找到|not found|no tasks/i.test(out);
	if (code !== 0 && !noProc) log("  [Harness] 结束进程：taskkill 退出码 " + code + "（可能无权限 —— 纪律 74）");

	const t0 = Date.now();
	let procs = imageProcs();
	while (procs.length && Date.now() - t0 < budgetMs) {
		await sleep(500);
		procs = imageProcs();
	}
	/* 🔴 进程表空了再给端口一点**宽限**（不是主判据）。
	 * 实测（2026-09-17 真机）：杀掉主进程后，9222 会由**已不存在的 pid** 继续
	 * `LISTENING` 数十秒（`Get-Process -Id` 与 `tasklist /FI PID` 都查无此进程，
	 * 而 `Get-NetTCPConnection` 也迟早会消失）⇒ socket 释放滞后。
	 * 若把它当主判据，每次停机都会报假红（纪律 102 的边界：偏保守侧是为了"有人看"，
	 * 不是为了天天喊狼 —— 所以**主判据取进程表**，端口作为**次级读数如实打印**）。 */
	let busy = port == null ? false : await portBusy(port);
	const gT0 = Date.now();
	while (busy && Date.now() - gT0 < 3000) {
		await sleep(300);
		busy = await portBusy(port);
	}
	const clean = procs.length === 0;
	const portLingering = clean && busy;
	const leftover = clean ? null : { procs: procs, port: port, listeners: port == null ? [] : listenersOn(port) };
	log("  [Harness] 结束进程：" + (clean ? "应用已退出（" + (Date.now() - t0) + "ms）"
		: "⚠️ **未干净** —— 残留进程 " + procs.length + " 个 " + JSON.stringify(procs.slice(0, 5)))
		+ (portLingering ? " ｜ port " + port + " 仍在 linger（无害：socket 释放滞后，启动器会自动顺移端口）" : ""));
	return {
		killed: clean, portLingering: portLingering, code: code, waitedMs: Date.now() - t0,
		leftover: leftover,
		why: clean ? (portLingering ? "端口 " + port + " 尚未释放（无害）" : "")
			: ("残留 " + procs.length + " 进程" + (busy ? " + 端口 " + port + " 被占" : ""))
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 四、一键就绪（含**端口顺移**）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 确保 Harness 就绪并 CDP 可达。
 *  · 默认**复用已在运行的实例**（不重复起第二个 —— 单实例锁会让"重启了"变成假象）；
 *  · `forceRestart` 时先**验证式停机**；
 *  · 🔴 停机后端口仍被幽灵占着 ⇒ 按 `maxShift` **顺移端口**（新实例会 `bind` 失败 ⇒ CDP 永不就绪）；
 *  · 返回体带**实际使用的端口** `port`，调用方必须用它去跑套件（`CDP_PORT`）。
 */
export async function ensureHarness({ port = 9222, forceRestart = false, maxShift = 4, budgetMs = 60000, log = console.log } = {}) {
	let p = Number(port || 9222);
	let shifted = 0;
	let stopInfo = null;

	if (!forceRestart && await cdpAlive(p)) {
		log("  [Harness] CDP 已在运行（复用现有实例，未重启）· port " + p);
		return { ok: true, reused: true, port: p, pid: null, shifted: false, stopInfo: null, appLog: null };
	}
	if (forceRestart) stopInfo = await stopHarness({ log: log, port: p });
	else if (await portBusy(p)) stopInfo = await stopHarness({ log: log, port: p });

	/* 🔴 端口顺移：`taskkill` 说成功也可能是幽灵（纪律 61/76）—— 判据是「**能不能 bind**」。 */
	while ((await portBusy(p)) && shifted < maxShift) {
		log("  [Harness] ⚠️ port " + p + " 仍被占（幽灵残留）⇒ 顺移到 " + (p + 1)
			+ "（LISTENING pid " + JSON.stringify(listenersOn(p).slice(0, 3)) + "）");
		p += 1;
		shifted += 1;
	}

	const outFile = path.join(ROOT, "logs", "_harness-" + p + ".out");
	const pid = spawnHarness({ port: p, log: log, outFile: outFile });
	if (!pid) return { ok: false, reused: false, port: p, pid: null, shifted: shifted > 0, stopInfo: stopInfo, appLog: outFile, why: "exe 不存在" };

	const ready = await waitCdpReady({ port: p, budgetMs: budgetMs, log: log });
	let why = "";
	if (!ready) {
		why = "CDP 未在预算内就绪（port " + p + "）";
		const ev = appLogLines(outFile, 4);
		if (ev.length) {
			log("  [Harness] 🔴 新实例自己的输出（**真因在这里，别去猜产品**）：");
			ev.forEach((s) => log("      | " + s.slice(0, 180)));
			if (ev.some((s) => /bind\(\)/.test(s) || /Cannot start http server/.test(s))) {
				why += " · 应用侧 bind 失败（端口被占）";
			}
		}
	}
	return { ok: ready, reused: false, port: p, pid: pid, shifted: shifted > 0, shiftedBy: shifted, stopInfo: stopInfo, appLog: outFile, why: why };
}

/** 从 `start` 起找一个**既空闲、CDP 又连不上**的端口（给跨重启连跑的分段端口用） */
export async function freePort(start, tries) {
	let p = Number(start || 9222);
	const n = Number(tries || 8);
	for (let i = 0; i < n; i++) {
		if (!(await portBusy(p))) return p;
		p += 1;
	}
	return null;
}
