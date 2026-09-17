#!/usr/bin/env node
/**
 * test-harness-ctrl.mjs —— Harness 控制面 + 真机起点自举的**离线契约**（第二十四轮新增）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 第二十四轮为跨重启连跑新增了两块代码，它们都**没有任何断言**（违反纪律 52）：
 *   ① `scripts/_harness.mjs` —— `portBusy` / `freePort` / `listenersOn` / `netOn` /
 *      `appLogLines` / `imageProcs` / `waitCdpReady`（端口顺移与幽灵检测全靠它们）；
 *   ② `scripts/_cdp-startup.mjs` —— `ensureDirectorPage()` 的**可分辨归因**。
 *
 * 🔴 为什么这两块必须单独测（都是本轮真金白银踩出来的）：
 *    · **端口顺移的判据只有 `portBusy`**：它若恒 `false`，`ensureHarness()` 就不会顺移，
 *      幽灵占着端口 ⇒ 新实例 `bind()` 失败 ⇒ CDP 永不就绪 ⇒ 套件**全 INVALID**（本轮首跑 15 轮）。
 *      所以「空闲 ⇒ false」必须配**反例校准**「被占 ⇒ true」，否则只是空真（纪律 23）。
 *    · **`freePort` 不许"回退"**：返回值必须是**第一个真正空闲**的端口。
 *      返回被占端口 = 换了个端口继续撞幽灵，比不换更难查。
 *    · **归因可分辨**（纪律 58）：四种起点失败（无环 / 无「总监」/ 已选中但没渲染 / 抛错）
 *      对应四种**完全不同的修法**；若都返回同一句话，等于没归因（纪律 18 的"跳过比红更危险"）。
 *
 * 🔴 三处最容易"看起来对"的地方（本测试的重点）：
 *    · `portBusy` 的**两个方向**都必须测。只测"空闲 ⇒ false"，一个 `return false` 的桩也能过。
 *    · `appLogLines` 是**幽灵问题的唯一铁证通道**（`bind() returned an error` 只在应用自己的
 *      stdout 里）。它若把该行滤掉，"CDP 起不来"就退化成不可解释 —— 纪律 54「静默半成功更坏」。
 *    · `_cdp-startup` 的失败路径**不许抛穿**（执行链上的模块一律不许抛穿）；
 *      但它也**不允许**把"我不认识的表达式"静默当成成功，故本测试对每种归因做**精确串比对**。
 *
 * ── 虚拟时钟（可复现理由，纪律 41）────────────────────────────────
 * `ensureDirectorPage()` 的等待预算是 **15s + 10s + 90s**（硬编码，为冷启动实测 58–120s 而设）。
 * 离线跑真实时钟要 2 分钟/例 × 5 例。故 F 组把 `Date.now` 换成"由 `sleep` 驱动的虚拟时钟"
 * （`sleep(ms)` 只推进偏移、不真等）⇒ 全组毫秒级完成、且**边界完全确定**（无 flake）。
 * 真实等待语义由真机 `repeat-director-logic.mjs` 验收覆盖，不在这里重复。
 *
 * ── 明确**不测**的三项（"跳过"必须带可分辨原因 —— 纪律 18）──────────
 * `spawnHarness()` / `stopHarness()` / `ensureHarness()` **会真起、真杀宿主进程**。
 * 在离线单测里调用它们会破坏**正在跑的真机会话**（纪律 83：破坏性动作必须自带退路）。
 * 它们由真机验收覆盖：`DL_RESTART_EVERY=3 node scripts/repeat-director-logic.mjs 6`
 * —— 该跑程的读数（停机是否干净 / 实际端口 / 是否顺移 / `appLog`）就是这三者的验收面。
 *
 *  | 编号  | 被测行为 | 期望结果 |
 *  |:------|:---------|:---------|
 *  | HT-1  | 空闲端口 ⇒ `portBusy` | `false` |
 *  | HT-2  | 🔴 **反例校准**：自己 bind 后 | `true`（否则 HT-1 是空真） |
 *  | HT-2b | 关掉 server 后 | 回到 `false`（读数跟随真实状态，非一次性） |
 *  | HT-3  | `listenersOn` 解析出的是**纯数字 pid** | `/^\d+$/` 全通过 |
 *  | HT-4  | 🔴 `portBusy` 与 `listenersOn` **方向一致** | busy ⇒ 至少一行 LISTENING |
 *  | HT-5  | `listenersOn` 含**本进程** pid（跨读数源一致） | 命中 |
 *  | HT-6  | 起始端口空闲 ⇒ `freePort` **原样返回** | = start（不自增） |
 *  | HT-7  | 🔴 起始端口被占 ⇒ **顺移** | = start+1（不是被占那个） |
 *  | HT-8  | 连续 3 个被占 | = start+3 |
 *  | HT-9  | 🔴 全被占（预算耗尽）⇒ 可分辨的失败 | `null`（不是 0 / undefined / 被占端口） |
 *  | HT-10 | `cdpAlive` 对空闲端口 | `false` 且**不抛** |
 *  | HT-11 | `waitCdpReady` 超预算 | 回 `false`（纪律 55：不崩栈） |
 *  | HT-12 | `waitCdpReady` 有界 | 实际耗时 ≤ 预算 + 单次探测上限 |
 *  | HT-13 | `appLogLines` 文件不存在 | `[]`（不抛） |
 *  | HT-14 | 只挑有诊断价值的行 | 普通行被丢弃、ERROR 行保留 |
 *  | HT-15 | `max` 生效 | 截断到 N |
 *  | HT-16 | 🔴 **真因行可被认出** | 含 `bind() returned an error` |
 *  | HT-17 | `HARNESS.args` 含遮挡开关（环境事实） | `--disable-features=CalculateNativeWinOcclusion` |
 *  | HT-18 | 另两个节流开关 | 各命中一次 |
 *  | HT-19 | 含 `--remote-debugging-port=` 项 | 否则顺移改不动端口 |
 *  | HT-20 | 🔴 **与 `restart-harness.ps1` 同源** | exe / workDir / 三个开关逐字一致 |
 *  | HT-21 | `imageProcs()` | 返回数组（不抛 / 不是 null） |
 *  | HT-22 | 🔴 `dp-root` 已在 ⇒ 立即 ok 且**零点击** | 起点是"看到"的，不是"点出来"的 |
 *  | HT-23 | 🔴 四种归因**互不相同** | 4 个不同字符串 |
 *  | HT-24 | 无环 ⇒ 归因 = 宿主没渲染会话视图 | 精确串 |
 *  | HT-25 | 环在、无「总监」⇒ 归因 = 视图未注册 | 精确串 |
 *  | HT-26 | 环在、「总监」已选中但没渲染 | 串含「宿主未渲染视图内容」 |
 *  | HT-27 | 🔴 **抛穿防护**：`js` 抛错 | 不向上抛，`ok:false` + `自举抛错：` |
 *  | HT-28 | 浮层清理真的发生（有浮层 ⇒ 发 Esc） | `send` 被调用（正对照） |
 *  | HT-29 | `steps` 非空（证据留痕） | 每例都 > 0 |
 *
 * 用法：node scripts/test-harness-ctrl.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const { portBusy, freePort, listenersOn, netOn, appLogLines, imageProcs, cdpAlive, waitCdpReady, HARNESS,
	harnessWindows, mainWindowPids, MAIN_WINDOW_TITLE,
	classifyLaunchOutcome, verdictAdvice, LAUNCH_VERDICTS } =
	await import("./_harness.mjs");
const { ensureDirectorPage } = await import("./_cdp-startup.mjs");

const ROOT = path.resolve(import.meta.dirname, "..");

/* ══════════════════════════════════════════════════════════════════
 * 断言框架（与既有套件同风格：唯一编号自检 + 证据行 + 可分辨跳过）
 * ══════════════════════════════════════════════════════════════════ */
let pass = 0, fail = 0, nSkip = 0;
const failures = [], skips = [];
const seen = new Set();
function t(id, name, cond, evidence) {
	if (seen.has(id)) throw new Error("断言编号重复：" + id);
	seen.add(id);
	if (cond) { pass++; console.log("  ✅ " + id + " " + name + (evidence ? " · " + evidence : "")); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + (evidence ? " · " + evidence : "")); }
}
/** "跳过"必须带**可分辨原因**（纪律 18）—— 不许静默跳过、也不许把跳过算成通过 */
function tSkip(id, name, reason) {
	if (seen.has(id)) throw new Error("断言编号重复：" + id);
	seen.add(id);
	nSkip++; skips.push(id + " " + name + " ← " + reason);
	console.log("  ⏭ " + id + " " + name + " · **未跑成**：" + reason);
}

console.log("═══ test-harness-ctrl · Harness 控制面 + 起点自举离线契约（第二十四轮）═══");

/* ══════════════════════════════════════════════════════════════════
 * 一、端口读数（HT-1 ~ HT-5）
 * ══════════════════════════════════════════════════════════════════ */
const holders = [];
function hold(port) {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.once("error", reject);
		srv.listen(port, "127.0.0.1", () => { holders.push(srv); resolve(srv); });
	});
}
function releaseAll() {
	for (const s of holders.splice(0)) { try { s.close(); } catch (_) { /* 已关 */ } }
}
/** 找一个**连续 n 个都空闲**的端口段（避开 9222 系与真机会话在用端口） */
async function pickRun(start, n) {
	let p = Number(start);
	for (let attempt = 0; attempt < 12; attempt++) {
		p = await freePort(p, 60);
		if (p == null) return null;
		let ok = true;
		for (let i = 1; i < n; i++) {
			if (await portBusy(p + i)) { ok = false; p = p + i + 1; break; }
		}
		if (ok) return p;
	}
	return null;
}

const BASE = 19100 + (process.pid % 80) * 5;
console.log("");
console.log("── A 组 · 端口读数（基址 " + BASE + "，避开 9222 系）──");
const base = await pickRun(BASE, 6);
if (base == null) {
	tSkip("HT-1", "空闲端口 ⇒ portBusy=false", "本机 " + BASE + " 起 60 个端口内找不到连续 6 个空闲端口（环境异常）");
} else {
	/* HT-1 + HT-2：**两个方向都要测**（只测一侧 = 空真） */
	const freeP = base + 5;
	t("HT-1", "空闲端口 ⇒ portBusy=false", (await portBusy(freeP)) === false, "port=" + freeP);
	await hold(base);
	t("HT-2", "🔴 反例校准：自己 bind 后 ⇒ portBusy=true", (await portBusy(base)) === true,
		"port=" + base + "（若这里不为 true，HT-1 就是空真）");

	/* HT-5：跨读数源一致 —— 幽灵检测的基础 */
	const lis = listenersOn(base);
	const netRows = netOn(base);
	if (!netRows.length) {
		tSkip("HT-3", "listenersOn 解析出纯数字 pid", "netstat 读数为空（该命令在本环境不可用）⇒ 解析逻辑未跑成");
		tSkip("HT-4", "🔴 portBusy 与 listenersOn 方向一致", "同上：netstat 不可用 ⇒ 第二读数源缺失");
		tSkip("HT-5", "listenersOn 含本进程 pid", "同上：netstat 不可用 ⇒ 无法验证跨源一致");
	} else {
		t("HT-3", "listenersOn 解析出纯数字 pid", lis.length > 0 && lis.every((x) => /^\d+$/.test(x)),
			"listeners=" + JSON.stringify(lis.slice(0, 3)));
		t("HT-4", "🔴 portBusy=true 与 listenersOn 非空**方向一致**",
			(await portBusy(base)) === true && lis.length > 0,
			"busy=true ｜ LISTENING 行=" + lis.length);
		t("HT-5", "listenersOn 含本进程 pid（跨读数源一致）", lis.indexOf(String(process.pid)) >= 0,
			"本进程 pid=" + process.pid + " ｜ netstat LISTENING=" + JSON.stringify(lis.slice(0, 3)));
	}

	/* HT-2b：读数跟随真实状态（关掉就回到 false —— 不是"一次性"读数） */
	releaseAll();
	await new Promise((r) => setTimeout(r, 250));
	t("HT-2b", "关掉 server 后 portBusy 回到 false（读数跟随真实状态）",
		(await portBusy(base)) === false, "port=" + base);
}

/* ══════════════════════════════════════════════════════════════════
 * 二、freePort 的顺移语义（HT-6 ~ HT-9）
 * ══════════════════════════════════════════════════════════════════ */
console.log("");
console.log("── B 组 · freePort 顺移语义 ──");
if (base == null) {
	for (const id of ["HT-6", "HT-7", "HT-8", "HT-9"]) {
		tSkip(id, "freePort 顺移语义", "A 组未拿到连续空闲端口段 ⇒ 顺移场景无法搭台");
	}
} else {
	t("HT-6", "起始端口空闲 ⇒ freePort 原样返回（不自增）", (await freePort(base, 8)) === base,
		"start=" + base + " ⇒ " + (await freePort(base, 8)));

	await hold(base);
	t("HT-7", "🔴 起始端口被占 ⇒ 顺移到 start+1（**不是**返回被占端口）",
		(await freePort(base, 8)) === base + 1,
		"start=" + base + "（占） ⇒ " + (await freePort(base, 8)) + " 期望=" + (base + 1));

	await hold(base + 1);
	await hold(base + 2);
	t("HT-8", "连续 3 个被占 ⇒ 顺移到 start+3", (await freePort(base, 8)) === base + 3,
		"start=" + base + "（占 3 个） ⇒ " + (await freePort(base, 8)) + " 期望=" + (base + 3));

	/* HT-9：预算耗尽必须是**可分辨的失败**（null），且不得回退成被占端口 */
	const r9 = await freePort(base, 3);
	t("HT-9", "🔴 全被占（预算耗尽）⇒ null（不是 0/undefined/被占端口）",
		r9 === null && r9 !== base && r9 !== base + 1,
		"freePort(start,3)=" + JSON.stringify(r9) + "（被占 3 个：base..base+2）");
	releaseAll();
}

/* ══════════════════════════════════════════════════════════════════
 * 三、就绪探测的**有界**语义（HT-10 ~ HT-12）
 * ══════════════════════════════════════════════════════════════════ */
console.log("");
console.log("── C 组 · 就绪探测有界 ──");
const quiet = base == null ? 19222 : base + 5;
t("HT-10", "cdpAlive 对空闲端口 ⇒ false 且不抛", (await cdpAlive(quiet)) === false, "port=" + quiet);
{
	const logs = [];
	const t0 = Date.now();
	let threw = false, ok = true;
	try { ok = await waitCdpReady({ port: quiet, budgetMs: 900, gapMs: 250, log: (s) => logs.push(s) }); }
	catch (_) { threw = true; }
	const ms = Date.now() - t0;
	t("HT-11", "waitCdpReady 超预算 ⇒ 返回 false（**不崩栈** —— 纪律 55）", threw === false && ok === false,
		"threw=" + threw + " ok=" + ok);
	t("HT-12", "waitCdpReady 有界：耗时 ≤ 预算 + 单次探测上限(2500ms) + 余量",
		ms <= 900 + 2500 + 1500, ms + "ms（预算 900ms）");
	t("HT-12b", "超预算时**打印了末次错误**（降级可以，无声不行 —— 纪律 19/54）",
		logs.some((s) => /CDP 未就绪/.test(s)), JSON.stringify(logs.slice(-1)));
}

/* ══════════════════════════════════════════════════════════════════
 * 四、应用输出留痕（HT-13 ~ HT-16）—— 幽灵问题的唯一铁证通道
 * ══════════════════════════════════════════════════════════════════ */
console.log("");
console.log("── D 组 · appLogLines（新实例自己的证词）──");
{
	const bad = path.join(os.tmpdir(), "dsh-harness-ctrl-none-" + process.pid + ".out");
	if (fs.existsSync(bad)) fs.unlinkSync(bad);
	t("HT-13", "appLogLines 文件不存在 ⇒ [] 且不抛", deepEq(appLogLines(bad, 5), []), JSON.stringify(appLogLines(bad, 5)));

	const tmp = path.join(os.tmpdir(), "dsh-harness-ctrl-" + process.pid + ".out");
	fs.writeFileSync(tmp, [
		"some normal line",
		"ERROR:net\\socket\\tcp_socket_win.cc:530] bind() returned an error: 0x2740",
		"another normal line",
		"ERROR:content\\browser\\devtools\\devtools_http_handler.cc:311] Cannot start http server for devtools.",
		"WARN: something noisy",
		"dsh web listening on 38500",
		"tail noise"
	].join("\n"), "utf8");
	const got = appLogLines(tmp, 6);
	const got1 = appLogLines(tmp, 1);
	t("HT-14", "只挑有诊断价值的行（普通行被丢弃）",
		got.length === 4 && got.every((s) => !/normal line|tail noise/.test(s)),
		"命中 " + got.length + " 行：" + JSON.stringify(got.map((s) => s.slice(0, 34))));
	t("HT-15", "max 生效（截断到 N）", got1.length === 1, "max=1 ⇒ " + got1.length);
	t("HT-16", "🔴 真因行可被认出（本轮幽灵问题的唯一铁证）",
		got.some((s) => /bind\(\) returned an error/.test(s)) && got.some((s) => /Cannot start http server/.test(s)),
		"含 bind() 行 = " + got.filter((s) => /bind\(\)/.test(s)).length);
	fs.unlinkSync(tmp);
}

/* ══════════════════════════════════════════════════════════════════
 * 五、启动参数 + 与 ps1 同源（HT-17 ~ HT-21）
 * ══════════════════════════════════════════════════════════════════ */
console.log("");
console.log("── E 组 · 启动参数与同源 ──");
{
	const args = HARNESS.args.join(" ");
	t("HT-17", "args 含遮挡开关（缺了派发会慢 ~60 倍 —— 环境事实）",
		args.indexOf("--disable-features=CalculateNativeWinOcclusion") >= 0, args);
	t("HT-18", "args 含另两个节流开关",
		args.indexOf("--disable-backgrounding-occluded-windows") >= 0 && args.indexOf("--disable-renderer-backgrounding") >= 0);
	t("HT-19", "args 含 --remote-debugging-port= 项（顺移端口靠替换它）",
		HARNESS.args.some((a) => a.indexOf("--remote-debugging-port=") === 0),
		JSON.stringify(HARNESS.args.filter((a) => a.indexOf("--remote-debugging-port=") === 0)));

	/* HT-20：**同一事实只留一份真相源** —— 改了 mjs 忘了 ps1 是最典型的漂移 */
	const ps1Path = path.join(ROOT, "scripts", "restart-harness.ps1");
	if (!fs.existsSync(ps1Path)) {
		tSkip("HT-20", "🔴 HARNESS 常量与 restart-harness.ps1 同源", "restart-harness.ps1 不存在 ⇒ 无第二份可比");
	} else {
		const ps = fs.readFileSync(ps1Path, "utf8");
		const exe = (ps.match(/\[string\]\$ExePath\s*=\s*"([^"]+)"/) || [])[1] || "";
		const wd = (ps.match(/\[string\]\$WorkDir\s*=\s*"([^"]+)"/) || [])[1] || "";
		const flags = ["--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];
		const flagOk = flags.every((f) => ps.indexOf(f) >= 0);
		t("HT-20", "🔴 HARNESS 常量与 restart-harness.ps1 逐字同源",
			exe === HARNESS.exe && wd === HARNESS.workDir && flagOk,
			"exe同源=" + (exe === HARNESS.exe) + " workDir同源=" + (wd === HARNESS.workDir) + " 三开关同源=" + flagOk);
	}
	t("HT-21", "imageProcs() 返回数组（不抛 / 不是 null）", Array.isArray(imageProcs()),
		"当前 Harness 进程数=" + imageProcs().length);
}

/* ══════════════════════════════════════════════════════════════════
 * 六、起点自举（HT-22 ~ HT-29）—— 虚拟时钟，见文件头说明
 * ══════════════════════════════════════════════════════════════════ */
console.log("");
console.log("── F 组 · ensureDirectorPage（虚拟时钟；真实等待由真机验收覆盖）──");

const REAL_NOW = Date.now;
let clockOffset = 0;
function installClock() { Date.now = () => REAL_NOW.call(Date) + clockOffset; }
function uninstallClock() { Date.now = REAL_NOW; }
/** 虚拟 sleep：只推进时钟，不真等 —— 让 15s+10s+90s 的预算毫秒级跑完且边界确定 */
const vSleep = async (ms) => { clockOffset += Number(ms) || 0; };

function fakeCL(sink) {
	const rec = (name) => async (a, b) => { sink.push(name); return { ok: true, info: "fake" }; };
	return {
		clickAt: rec("clickAt"), clickSel: rec("clickSel"), clickJs: rec("clickJs"),
		clickByText: rec("clickByText"), clickJsByText: rec("clickJsByText")
	};
}
/**
 * `js` 桩：按**特征子串**分派到配置。
 * 🔴 兜底**故意抛错**（不是返回 null）：不认识的表达式必须**响亮地**暴露，
 *    否则会被 `ensureDirectorPage` 的 catch 吞成"自举抛错"，让某条用例**因为错的理由通过**（纪律 23）。
 *    为此 F 组每条用例都对 `reason` 做**精确串比对**（抛错路径的 reason 是 `自举抛错：…`，不可能撞上）。
 */
function makeJs(cfg) {
	const calls = [];
	let overlayN = 0;
	const js = async (expr) => {
		const e = String(expr);
		calls.push(e.slice(0, 48));
		if (cfg.throwOn && cfg.throwOn.test(e)) throw new Error("模拟：CDP 目标已失效");
		if (/dp-root/.test(e)) return cfg.root ? cfg.root() : false;
		if (/dsh-mindmap/.test(e)) return cfg.overlays ? cfg.overlays(overlayN++) : [];
		if (/rawSessionSummaries/.test(e)) return cfg.materialize ? cfg.materialize() : { ok: false, reason: "无 __dshBranchTree（插件未装载）" };
		if (/新会话/.test(e)) return cfg.newSession === undefined ? null : cfg.newSession;
		if (/treeitem/.test(e)) return cfg.tree ? cfg.tree() : [];
		if (/role="tab"/.test(e)) return cfg.ring ? cfg.ring() : [];
		if (/role=tab/.test(e)) return cfg.diag ? cfg.diag() : JSON.stringify({ ring: [], selected: [], hasDirector: false, handle: null, idPresent: false, textured: 0 });
		throw new Error("F 组 js 桩不认识这个表达式：" + e.slice(0, 70));
	};
	return { js: js, calls: calls };
}

const RE_RING = "宿主始终没有页签环（会话视图未打开 —— 冷启动未就绪）";
const RE_NO_DIR = "页签环里没有「总监」（视图未注册到宿主）";
const reasons = {};

/* ── HT-22：`dp-root` 已在 ⇒ 立即 ok + **零点击**（正对照：起点是"看到"的）── */
{
	installClock(); clockOffset = 0;
	const clicks = [];
	const stub = makeJs({ root: () => true, ring: () => ["总监", "对话", "轨迹"], overlays: () => [] });
	const r = await ensureDirectorPage({
		CL: fakeCL(clicks), js: stub.js, send: async () => ({}), sleep: vSleep, log: () => {}
	});
	uninstallClock();
	t("HT-22", "🔴 dp-root 已在 ⇒ 立即 ok 且**零点击**", r.ok === true && clicks.length === 0 && r.dpRoot === true,
		"ok=" + r.ok + " 点击次数=" + clicks.length + " ring=" + JSON.stringify(r.tabRing));
	t("HT-22b", "已在 DOM 时**不进入**等待/自举（steps 含「已在 DOM」）",
		r.steps.length > 0 && r.steps.some((s) => /已在 DOM/.test(s)), "steps=" + r.steps.length);
	t("HT-29", "steps 非空（证据留痕；静默失败不可接受 —— 纪律 54）", r.steps.length > 0, "steps=" + r.steps.length);
}

/* ── HT-24：无环 ⇒ 归因 = 宿主没渲染会话视图 ── */
{
	installClock(); clockOffset = 0;
	const clicks = [];
	const stub = makeJs({ root: () => false, ring: () => [], overlays: () => [], tree: () => [] });
	const r = await ensureDirectorPage({
		CL: fakeCL(clicks), js: stub.js, send: async () => ({}), sleep: vSleep, log: () => {}, tabBudgetMs: 4000
	});
	uninstallClock();
	reasons.noRing = r.reason;
	t("HT-24", "无环 ⇒ 归因 = 「宿主始终没有页签环…」", r.ok === false && r.reason === RE_RING, r.reason);
}

/* ── HT-25：环在、无「总监」 ⇒ 视图未注册 ── */
{
	installClock(); clockOffset = 0;
	const clicks = [];
	const stub = makeJs({
		root: () => false, ring: () => ["对话", "轨迹"], overlays: () => [], tree: () => [],
		diag: () => JSON.stringify({ ring: ["对话", "轨迹"], selected: ["对话"], hasDirector: false, handle: false, idPresent: false, textured: 0 })
	});
	const r = await ensureDirectorPage({
		CL: fakeCL(clicks), js: stub.js, send: async () => ({}), sleep: vSleep, log: () => {}, tabBudgetMs: 4000
	});
	uninstallClock();
	reasons.noDirector = r.reason;
	t("HT-25", "环在、无「总监」⇒ 归因 = 「页签环里没有『总监』…」", r.ok === false && r.reason === RE_NO_DIR, r.reason);
}

/* ── HT-26：环在、「总监」已选中但宿主没渲染（本轮冷启动的真实形态）── */
{
	installClock(); clockOffset = 0;
	const clicks = [];
	const stub = makeJs({
		root: () => false, ring: () => ["总监"], overlays: () => [], tree: () => [],
		diag: () => JSON.stringify({ ring: ["总监"], selected: ["总监"], hasDirector: true, handle: true, idPresent: false, textured: 0 })
	});
	const r = await ensureDirectorPage({
		CL: fakeCL(clicks), js: stub.js, send: async () => ({}), sleep: vSleep, log: () => {}, tabBudgetMs: 4000
	});
	uninstallClock();
	reasons.notMounted = r.reason;
	t("HT-26", "🔴 环在、「总监」已选中、宿主未渲染 ⇒ 归因含「宿主未渲染视图内容」",
		r.ok === false && /宿主未渲染视图内容/.test(r.reason) && /idPresent=false/.test(r.reason), r.reason);
	t("HT-26b", "该形态下**点击确实发生过**（正对照：不是「压根没点」）", clicks.length > 0, "点击次数=" + clicks.length);
}

/* ── HT-27：抛穿防护 ── */
{
	installClock(); clockOffset = 0;
	const stub = makeJs({ root: () => { throw new Error("x"); }, throwOn: /dp-root/, overlays: () => [] });
	let threw = false, r = null;
	try {
		r = await ensureDirectorPage({
			CL: fakeCL([]), js: stub.js, send: async () => ({}), sleep: vSleep, log: () => {}, tabBudgetMs: 4000
		});
	} catch (_) { threw = true; }
	uninstallClock();
	reasons.threw = r && r.reason;
	t("HT-27", "🔴 抛穿防护：js 抛错时**不向上抛**，返回 ok:false + 「自举抛错：」",
		threw === false && r && r.ok === false && /^自举抛错：/.test(String(r.reason)),
		"threw=" + threw + " ok=" + (r && r.ok) + " reason=" + (r && r.reason));
}

/* ── HT-23：四种归因**互不相同** ── */
{
	const vals = ["noRing", "noDirector", "notMounted", "threw"].map((k) => reasons[k]);
	const uniq = vals.filter((v, i) => v && vals.indexOf(v) === i);
	t("HT-23", "🔴 四种归因互不相同（四个字符串）", uniq.length === 4,
		JSON.stringify(vals.map((v) => String(v).slice(0, 22))));
}

/* ── HT-28：浮层清理真的发生（正对照）+ 浮层会被"点击被吃" ── */
{
	installClock(); clockOffset = 0;
	let esc = 0;
	const stub = makeJs({
		root: () => false, ring: () => [], tree: () => [],
		overlays: (n) => (n === 0 ? ["#dsh-mindmap"] : [])
	});
	const r = await ensureDirectorPage({
		CL: fakeCL([]), js: stub.js, send: async () => { esc++; return {}; }, sleep: vSleep, log: () => {}, tabBudgetMs: 4000
	});
	uninstallClock();
	t("HT-28", "有浮层 ⇒ 真的发了 Esc 清理（浮层会吃掉全部点击）", esc > 0,
		"Esc 次数=" + esc + " ｜ 清理后残留读数已落 steps=" + r.steps.some((s) => /浮层清理后残留/.test(s)));
}

/* ══════════════════════════════════════════════════════════════════
 * F 组 · 调用点契约自证（**源码级** —— 真机断言只抓一次，源码断言每次跑都抓，纪律 106）
 * ══════════════════════════════════════════════════════════════════
 * 治什么：2026-09-17 真机实测踩到 `verify-novel-e2e-human.mjs` / `link-shots.mjs` 里
 *   `ensureDirectorPage({ CL: console.log, … })` —— **复制粘贴事故**。
 *   平时看不出来：`dp-root` 已在 DOM 时走"零点击"早返回，`CL` 根本用不到；
 *   一旦宿主冷启动没渲染出页签环、必须走**真实 UI 自举**，就抛
 *   `CL.clickAt is not a function`（被兜住、不抛穿）⇒ `dp-root` 永不出现
 *   ⇒ `HE-0/1/2/4` 整片假红，而**产品毫无问题**（纪律 94：前提缺失 ≠ 产品坏）。
 * 判据：`ensureDirectorPage({...})` 的 `CL` 实参**不得**是 `console.*`。 */
const SCRIPT_DIR = path.join(ROOT, "scripts");

/** 纯函数：从源码文本里挑出 `CL:` 传成 `console.*` 的调用点（可单独用合成串校准） */
function scanClConsole(src) {
	const out = [];
	const re = /ensureDirectorPage\(\s*\{[\s\S]{0,500}?\bCL\s*:\s*([^,\n}]+)/g;
	let m;
	while ((m = re.exec(src)) !== null) {
		const expr = String(m[1]).trim();
		if (/^console\b/.test(expr)) out.push(expr);
	}
	return out;
}

let scanned = 0, skippedSelf = 0;
const badCalls = [];
for (const f of fs.readdirSync(SCRIPT_DIR)) {
	if (!/\.mjs$/.test(f)) continue;
	/* 🔴 **自指豁免**（纪律 104 家族：生成物/判据不得把自己算进去）：
	 *    本文件为了**校准**必须逐字写出缺陷字面量（`CL: console.log`）⇒ 扫自己必然命中。
	 *    豁免**只允许 1 个**，且由 HT-33b 断言 —— 防止"豁免名单"悄悄变长把判据架空。 */
	if (f === "test-harness-ctrl.mjs") { skippedSelf++; continue; }
	const src = fs.readFileSync(path.join(SCRIPT_DIR, f), "utf8");
	if (src.indexOf("ensureDirectorPage(") < 0) continue;
	scanned++;
	for (const bad of scanClConsole(src)) badCalls.push(f + " → CL: " + bad);
}
console.log("");
console.log("── F 组 · 调用点契约自证（扫 " + scanned + " 个引用起点的脚本 · 自指豁免 " + skippedSelf + " 个）──");
t("HT-33", "🔴 `ensureDirectorPage({CL})` 的 `CL` 不得是 `console.*`（必须是 `makeClicker()` 返回体或桩）",
	badCalls.length === 0, JSON.stringify(badCalls));
t("HT-33b", "自指豁免**恰好 1 个**（本套件自身）—— 豁免名单不许悄悄变长（否则判据被架空）",
	skippedSelf === 1, { skippedSelf: skippedSelf, scanned: scanned });
/* 🧪 植入缺陷校准（纪律 32）：同一个谓词判**合成缺陷源** ⇒ 必须抓到 */
t("HT-33c", "🧪 校准态：同一谓词对合成缺陷源（`CL: console.log`）**必须报出**（否则 HT-33 是恒真的空判据）",
	deepEq(scanClConsole("await ensureDirectorPage({ CL: console.log, js, send, sleep });"), ["console.log"])
	&& scanClConsole("await ensureDirectorPage({ CL: makeClicker({ send, js, sleep }), js });").length === 0,
	JSON.stringify(scanClConsole("await ensureDirectorPage({ CL: console.log, js });")));

/* ══════════════════════════════════════════════════════════════════
 * 八、启动结论判定（HT-34 ~ HT-46）—— 纯函数 + 源码接线自证
 * ══════════════════════════════════════════════════════════════════
 * 治什么（2026-09-17 第三十一/三十二轮，**用户报"还是闪退"的直接产物**）：
 *   v2 的启动器在"CDP 出现 page 目标"（≈窗口出现，2.5–4.3 s）就报 ✅。
 *   而「打开就闪退」的故障形态是 **被单实例锁静默接管后从此再也不出窗口**
 *   —— 它**不在** "2.5–4.3 s 有 page 目标"这个时间窗里 ⇒ **启动器永远报绿、用户永远闪退**。
 *   （asar 原文：`if (!app.requestSingleInstanceLock()) app.quit();` —— 这条路径不打印任何东西。）
 *
 * 🔴 本组最容易被写"假绿"的一处（因此必须配校准）：
 *   若 `classifyLaunchOutcome` 在"我们的进程没了、但**别的实例的窗口还在**"时
 *   先看 `mainWindow` 就返回 `OK` —— 而那正是**本轮的核心故障形态**。
 *   所以 HT-35 专门构造这个输入，HT-40 再用 `() => "OK"` 这种恒真实现做**植入缺陷校准**：
 *   同一输入下恒真实现必然判错 ⇒ 证明 HT-35 **不是空判据**（纪律 32/108：能红 ⇒ 必然红）。
 */
console.log("");
console.log("── H 组 · 启动结论判定（纯函数；治「打开就闪退」的报绿口径）──");
{
	/* 六个 verdict 的**最小可分辨输入** */
	const IN = {
		ok: { pidGone: false, mainWindow: true, othersAlive: 0 },
		/* 🔴 故障形态（第二十九轮）：我们起的进程没了、**别的实例还在**、窗口是**别人的** */
		takeover: { pidGone: true, exitCode: 0, outBytes: 2, othersAlive: 4, mainWindow: true },
		died: { pidGone: true, exitCode: 0, outBytes: 0, othersAlive: 0, mainWindow: false },
		noWindow: { pidGone: false, mainWindow: false, othersAlive: 0 },
		badOption: { pidGone: true, exitCode: 9, outBytes: 80, othersAlive: 0, mainWindow: false, badOption: true },
		/* 🔴 环境回收形态（第三十二轮）：窗口**真的出现过**、应用无致命行，随后被会话回收 */
		reaped: { pidGone: true, exitCode: null, outBytes: 256, othersAlive: 0, mainWindow: false, appeared: true, hostFatal: false }
	};
	const got = {
		ok: classifyLaunchOutcome(IN.ok),
		takeover: classifyLaunchOutcome(IN.takeover),
		died: classifyLaunchOutcome(IN.died),
		noWindow: classifyLaunchOutcome(IN.noWindow),
		badOption: classifyLaunchOutcome(IN.badOption),
		reaped: classifyLaunchOutcome(IN.reaped)
	};
	t("HT-34", "进程活着 + 主窗口在 ⇒ OK", got.ok === LAUNCH_VERDICTS.OK, got.ok);
	t("HT-35", "🔴 我们的进程没了 + 别的实例还在 ⇒ **TAKEN_OVER**（不是 OK —— 窗口是别人的）",
		got.takeover === LAUNCH_VERDICTS.TAKEN_OVER,
		"输入=别的实例 4 个 + 窗口在（**正是第二十九轮假绿的形态**）⇒ " + got.takeover);
	t("HT-36", "我们的进程没了 + 无别的实例 ⇒ DIED（应用自己退出）", got.died === LAUNCH_VERDICTS.DIED, got.died);
	t("HT-37", "进程活着 + 无主窗口 ⇒ NO_WINDOW（boot 未完成/卡住）", got.noWindow === LAUNCH_VERDICTS.NO_WINDOW, got.noWindow);
	t("HT-38", "🔴 badOption 优先级最高（即使其它读数都「正常」）",
		classifyLaunchOutcome({ pidGone: false, mainWindow: true, othersAlive: 0, badOption: true }) === LAUNCH_VERDICTS.BAD_OPTION,
		"输入=窗口在+进程在+但输出含 bad option ⇒ " + classifyLaunchOutcome({ pidGone: false, mainWindow: true, othersAlive: 0, badOption: true }));
	/* 🔴 第三十二轮（**修假红**）：窗口出现过 + 无致命行 ⇒ 判"启动成功后被回收"，**不是** DIED。
	 *    为什么这条必须存在：本环境的会话作业对象会回收**任何**它拉起的 GUI
	 *    （实测无关第三方 `notepad.exe` 同样在下一个调用里归零）⇒ 拿"此刻进程还在"
	 *    当唯一判据，**每次双击都报红**，而用户那边窗口其实真的出来了（纪律 31/118）。 */
	t("HT-47", "🔴 窗口**出现过** + 应用无致命行 + 进程没了 ⇒ STARTED_THEN_REAPED（不是 DIED）",
		got.reaped === LAUNCH_VERDICTS.STARTED_THEN_REAPED,
		"输入=appeared:true + hostFatal:false ⇒ " + got.reaped);
	t("HT-47b", "🔴 **反例校准**：窗口出现过但应用吐了 `Host exited unexpectedly` ⇒ 仍判 DIED（真崩溃不许被兜底吞掉）",
		classifyLaunchOutcome({ pidGone: true, exitCode: 1, outBytes: 120, othersAlive: 0, mainWindow: false, appeared: true, hostFatal: true }) === LAUNCH_VERDICTS.DIED,
		"输入=appeared:true + hostFatal:true ⇒ " + classifyLaunchOutcome({ pidGone: true, exitCode: 1, outBytes: 120, othersAlive: 0, mainWindow: false, appeared: true, hostFatal: true }));
	t("HT-47c", "🔴 **反例校准**：窗口**从未出现**且无别的实例 ⇒ 仍判 DIED（「起都没起」不许被漏报）",
		classifyLaunchOutcome({ pidGone: true, exitCode: 0, outBytes: 0, othersAlive: 0, mainWindow: false, appeared: false, hostFatal: false }) === LAUNCH_VERDICTS.DIED,
		"输入=appeared:false ⇒ " + classifyLaunchOutcome({ pidGone: true, exitCode: 0, outBytes: 0, othersAlive: 0, mainWindow: false, appeared: false, hostFatal: false }));
	const uniqV = Object.values(got).filter((v, i, a) => a.indexOf(v) === i);
	t("HT-39", "🔴 六个 verdict **互不相同**（归因不可分辨 = 等于没归因 —— 纪律 58）",
		uniqV.length === 6, JSON.stringify(got));

	/* 🧪 植入缺陷校准（纪律 32/108）：恒真实现必须在 HT-35 的输入上被判为错 */
	const defect = () => LAUNCH_VERDICTS.OK;
	t("HT-40", "🧪 校准态：恒真实现 `() => \"OK\"` 对 TAKEN_OVER 输入**必然判错**（否则 HT-35 是空判据）",
		defect(IN.takeover) !== LAUNCH_VERDICTS.TAKEN_OVER,
		"缺陷实现输出=" + defect(IN.takeover) + " 期望=" + LAUNCH_VERDICTS.TAKEN_OVER);

	/* verdict ⇒ 下一步（每条都必须可执行、且互不相同） */
	const advices = Object.values(LAUNCH_VERDICTS).map((v) => verdictAdvice(v));
	const uniqA = advices.filter((v, i, a) => a.indexOf(v) === i);
	t("HT-41", "🔴 每个 verdict 的「下一步」互不相同且非空（不许「未知错误」这种废话）",
		uniqA.length === 6 && advices.every((s) => typeof s === "string" && s.length >= 12),
		"唯一建议数=" + uniqA.length + " 最短=" + Math.min.apply(null, advices.map((s) => s.length)));
	t("HT-41b", "TAKEN_OVER 的建议里点名了**托盘**与**停机脚本**（可执行，不是「请重试」）",
		/托盘/.test(verdictAdvice(LAUNCH_VERDICTS.TAKEN_OVER)) && /stop-harness/.test(verdictAdvice(LAUNCH_VERDICTS.TAKEN_OVER)),
		verdictAdvice(LAUNCH_VERDICTS.TAKEN_OVER).slice(0, 60) + "…");

	/* 窗口真相源的形状（裸启动没有 CDP，判"窗口在不在"只能靠它） */
	const rows = harnessWindows();
	t("HT-42", "harnessWindows() 返回数组且元素形状正确（pid 数字串 / title 字符串 / hasWindow 布尔）",
		Array.isArray(rows) && rows.every((r) => /^\d+$/.test(String(r.pid)) && typeof r.title === "string" && typeof r.hasWindow === "boolean"),
		"当前 " + rows.length + " 行：" + JSON.stringify(rows.slice(0, 3)));
	const mw = mainWindowPids();
	t("HT-43", "🔴 mainWindowPids() 是 harnessWindows() 的子集，且只含标题恰为「" + MAIN_WINDOW_TITLE + "」的行",
		mw.every((p) => rows.some((r) => r.pid === p && r.title === MAIN_WINDOW_TITLE)) && mw.length <= rows.length,
		"主窗口 pid=" + JSON.stringify(mw) + " ｜ 总行=" + rows.length);

	/* 🔴 源码接线自证（纪律 79「写好了 ≠ 接进去了」+ 纪律 106 离线源码断言） */
	const startSrc = fs.readFileSync(path.join(SCRIPT_DIR, "start-harness.mjs"), "utf8");
	t("HT-44", "🔴 start-harness.mjs **真的调用**了 classifyLaunchOutcome（只 import 不算接进去）",
		/classifyLaunchOutcome\s*\(/.test(startSrc), "调用点 " + (startSrc.match(/classifyLaunchOutcome\s*\(/g) || []).length + " 处");
	/* 启动器的「观察窗」必须**真的在盯进程消失** —— 提取成**可校准的谓词**（纪律 32）。
	 * 🔴 为什么不写死变量名：第一版写成 `diedSecs = heldSecs; break;`，实现里改个变量名
	 *    判据就假红（纪律 ⑭「判据会过期」的现场重演）。这里只认**语义**：
	 *    观察窗存在 + 有"进程不在就 break"的循环体。 */
	const hasHoldWatchLoop = (src) => /--hold/.test(src)
		&& /holdSec > 0/.test(src)
		&& /indexOf\(mine\) < 0\)\s*\{[^}]{0,80}break;/.test(src);
	t("HT-45", "🔴 启动器**不再**以「窗口出现」单独作为成功判据：存在观察窗且真的在盯进程消失",
		hasHoldWatchLoop(startSrc),
		"含 --hold=" + /--hold/.test(startSrc) + " ｜ 含观察窗循环=" + /indexOf\(mine\) < 0\)/.test(startSrc));
	t("HT-45c", "🧪 校准态：同一谓词对**去掉观察窗**的合成源必须报 false（否则 HT-45 恒真）",
		hasHoldWatchLoop("if (winOk) { appearedSecs = secs(); break; }\nreturn { ok: true };") === false
		&& hasHoldWatchLoop("const HOLD=5;\nwhile (1) {\n  if (imageProcs().indexOf(mine) < 0) { diedSecs = 1; break; }\n}") === false,
		"合成源（无 --hold / 无 holdSec>0）⇒ false");
	/* 观察窗默认值必须**覆盖故障时间窗**：接管在 1.0–1.4 s 发生、boot 可到 90 s ⇒ 默认 ≥ 15 s */
	const dm = startSrc.match(/\n\treturn (\d+);\n\}\)\(\);/);
	if (dm === null) {
		tSkip("HT-45b", "观察窗默认值 ≥ 15 s", "未能从源码里解析出 HOLD 的默认值（写法变了 ⇒ 判据需同步改）");
	} else {
		t("HT-45b", "观察窗默认值 ≥ 15 s（接管 1.0–1.4 s / boot 90 s —— 太小就漏报）",
			Number(dm[1]) >= 15, "源码默认 " + dm[1] + " s");
	}
	const stopPath = path.join(SCRIPT_DIR, "stop-harness.mjs");
	t("HT-46", "🔴 stop-harness.mjs 存在且调用 stopHarness + 端口判据（治闪退的必要件接线）",
		fs.existsSync(stopPath)
		&& /stopHarness\(/.test(fs.readFileSync(stopPath, "utf8"))
		&& /portBusy\(/.test(fs.readFileSync(stopPath, "utf8")),
		"文件存在=" + fs.existsSync(stopPath));
	/* 🔴 第三十二轮：「写好了」≠「接进去了」（纪律 79）——
	 *   新 verdict 必须**真的**被启动器当成功、且退出码为 0，否则修了等于没修。 */
	const successRe = /SUCCESS\w*\s*=\s*\[[^\]]*OK[^\]]*STARTED_THEN_REAPED[^\]]*\]/;
	/* 退出码：成功集合 ⇒ 0；失败 ⇒ 2（接受两种等价写法：直接三元，或先落 `succeeded` 再判） */
	const exitRe = /SUCCESS\w*\.indexOf\(verdict\)\s*>=\s*0/;
	t("HT-48", "🔴 启动器把 STARTED_THEN_REAPED **真的**当成功（进 SUCCESS 集合 + 退出码 0）",
		/STARTED_THEN_REAPED/.test(startSrc) && successRe.test(startSrc) && exitRe.test(startSrc),
		"含 verdict=" + /STARTED_THEN_REAPED/.test(startSrc)
		+ " ｜ SUCCESS 集合=" + successRe.test(startSrc)
		+ " ｜ 退出码接线=" + exitRe.test(startSrc));
	t("HT-48b", "🧪 校准态：同一谓词对**只 import 不接线**的合成源必须报 false（否则 HT-48 恒真）",
		!successRe.test("const v = LAUNCH_VERDICTS.STARTED_THEN_REAPED;\nprocess.exit(v === LAUNCH_VERDICTS.OK ? 0 : 2);"),
		"合成源（无 SUCCESS 集合 / 退出码仍只认 OK）⇒ false");
	/* 起过窗口的不再重试（否则一次成功启动会被重试判成失败） */
	t("HT-48c", "🔴 启动器**不再对「窗口出现过」的启动做重试**（重试会把成功变成假失败）",
		/!\s*j\.appeared/.test(startSrc),
		"含 !j.appeared 守卫=" + /!\s*j\.appeared/.test(startSrc));
	/* 🔴 第三十二轮：**启动器必须守着**（host 是它子进程 —— 它一退，应用就被连带回收 ⇒ 用户看到"闪退"）。
	 *   默认常驻 + `--no-keepalive` 可关；且**必须在守之前就定好结论与退出码**（不许因"守着"把红说成绿）。 */
	t("HT-49", "🔴 启动器**默认守着**应用（host 是它的子进程；它一退应用就被回收 ⇒ 这才是「闪退」的最后一段真因）",
		/--no-keepalive/.test(startSrc)
		&& /await new Promise\(\(\)\s*=>\s*\{\}\)/.test(startSrc)
		&& /setInterval\(/.test(startSrc),
		"含 --no-keepalive=" + /--no-keepalive/.test(startSrc) + " ｜ 永不 resolve=" + /await new Promise\(\(\)\s*=>\s*\{\}\)/.test(startSrc));
	t("HT-49b", "🧪 校准态：同一谓词对**退出即散**的合成源必须报 false（否则 HT-49 恒真）",
		!(/--no-keepalive/.test("process.exit(v ? 0 : 2);") && /await new Promise\(\(\)\s*=>\s*\{\}\)/.test("process.exit(v ? 0 : 2);")),
		"合成源（无 keepalive / 直接 exit）⇒ false");
}

/* ══════════════════════════════════════════════════════════════════
 * 七、明确不测的三项（可分辨跳过 —— 不是"忘了测"）
 * ══════════════════════════════════════════════════════════════════ */
console.log("");
console.log("── G 组 · 需真机过程的三项（**不在此测**，理由可分辨）──");
const RM = "会真起/真杀宿主进程 ⇒ 离线调用会破坏正在跑的验收会话（纪律 83）：由 DL_RESTART_EVERY=3 node scripts/repeat-director-logic.mjs 6 验收覆盖（读数 = 停机是否干净 / 实际端口 / 是否顺移 / appLog）";
tSkip("HT-30", "spawnHarness() 拉起 + 应用输出落盘", RM);
tSkip("HT-31", "stopHarness() 验证式停机（结论看进程表 + 端口，不看 taskkill 文案）", RM);
tSkip("HT-32", "ensureHarness() 端口顺移 + 复用语义", RM);

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ══════════════════════════════════════════════════════════════════ */
console.log("═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 跳过 " + nSkip + " / 总计 " + (pass + fail + nSkip));
if (fail) console.log("  失败项：" + failures.join(" | "));
if (nSkip) console.log("  跳过项（含原因）：" + skips.join(" ； "));
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
