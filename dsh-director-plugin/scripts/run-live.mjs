#!/usr/bin/env node
/**
 * `run-live.mjs` —— **真机套件批量运行器：只在开头启动一次 Harness**
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有它（2026-09-17 用户裁定："有的是反复打开关闭软件"）
 * ──────────────────────────────────────────────────────────────────
 * 原做法：每个真机套件各自启动一次被测应用、各自等待冷启动、各自自举起点。
 * 实测代价：14 个真机套 × (启动 5–25s + 自举 20–30s) ≈ **6–12 分钟纯开销**，
 * 而且每次开合都在和"另一个并行会话"抢同一个实例（本轮真机跑被切断 5 次）。
 *
 * 本运行器把开销压到**一次**：
 *   ① 产物新鲜度 / 装机就绪 先判（不新鲜就先修，别让一小时后才发现）
 *   ② CDP 已在跑 ⇒ **不重复启动**
 *   ③ 冷启动**只等一次**（只等不点，纪律 98）
 *   ④ 依次跑完 N 套 —— 首套自举后 `dp-root` 已在 DOM，后续套件秒过起点判定
 *   ⑤ 单张汇总表；**单套 INVALID 不拖垮整批**（纪律 54：静默半成功更坏 ⇒ 逐套标状态）
 *
 * 🔴 与测试规划器的分工：`test-plan.mjs` 决定"该跑哪些"，本脚本负责"怎么跑最省"。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node scripts/run-live.mjs                      # 全部真机套（只跑台账里"需跑"的，除非 --all）
 *   node scripts/run-live.mjs verify-flow.mjs ...  # 指定套件
 *   node scripts/run-live.mjs --all --record       # 忽略增量判定 + 写台账
 *   node scripts/run-live.mjs --no-start           # 不自动启动（Harness 自己起好了）
 *
 * 退出码：0 全绿 / 1 有红 / 2 环境不可用（起不来 / 无法判定）
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, openSync, closeSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT, listSuites, artifactStamp, srcStamp, loadLedger, saveLedger, record } from "./_test-ledger.mjs";
import { cdpAlive, portBusy } from "./_harness.mjs";

/* ══ 🔴 `T-PLUG-065`：端口来源必须**能自己找到活端点** ═══════════════════════════
 * 原写法 `Number(process.env.CDP_PORT || 9222)` 有两个洞：
 *   ① **顺序**：本仓唯一口径是 `CDP_PORT` 优先、`DSH_CDP_PORT` 兜底（**纪律 126**，顺序不可反）；
 *   ② **硬编码起点**：目标端口被**幽灵 pid** 占着时（纪律 119），脚本只会去连一个**没人在听**的端口，
 *      症状是整套 `INVALID`「连不上 CDP」—— **看起来像环境坏了**，与产品无关。
 * 修法 = 复用 `_harness.mjs` 已有的 `cdpAlive`（**唯一实现**，纪律 132）在 `base..base+顺移位` 探活：
 *   · 探到 ⇒ 用它，并如实打印"顺移 n 位"；
 *   · 全没探到 ⇒ 保留 base 供**自启**用，但把「已探测范围」写进 INVALID 文案
 *     ⇒ 「**没人在听**」与「**连不上**」在文案层面可分（纪律 140 同族）。 */
const BASE_PORT = Number(process.env.CDP_PORT || process.env.DSH_CDP_PORT || 9222);
const PORT_SHIFT_MAX = Number(process.env.CDP_SHIFT_MAX || 4);
let PORT = BASE_PORT;
let PORT_SHIFTED_BY = -1;
for (let i = 0; i <= PORT_SHIFT_MAX; i++) {
	if (await cdpAlive(BASE_PORT + i)) { PORT = BASE_PORT + i; PORT_SHIFTED_BY = i; break; }
}
const HARNESS_DIR = process.env.HARNESS_DIR || "D:/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness";
const HARNESS_EXE = "DeepSeek Harness.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const named = argv.filter((a) => !a.startsWith("-"));
if (has("--help") || has("-h")) {
	console.log("用法：node scripts/run-live.mjs [--all] [--record] [--no-start] [套件名...]");
	process.exit(0);
}

/* ── 0. 前置：产物新鲜 + 装机就绪（**先判前提，别让一小时后才发现前提不成立**） ── */
const stamp = artifactStamp(), src = srcStamp();
console.log("══ 真机批次 ══");
console.log("  产物指纹: " + (stamp || "(无)") + " ｜ src 指纹: " + (src || "(无)"));
if (PORT_SHIFTED_BY > 0) console.log("  端口: 起始 " + BASE_PORT + " **无 CDP** ⇒ 顺移 " + PORT_SHIFTED_BY + " 位到 **" + PORT + "**（T-PLUG-065）");
else if (PORT_SHIFTED_BY === 0) console.log("  端口: " + PORT + "（CDP 已在跑）");
else console.log("  端口: " + BASE_PORT + "–" + (BASE_PORT + PORT_SHIFT_MAX) + " **均无 CDP 端点**（尚未启动 ⇒ 待自启）");
if (!stamp) { console.error("INVALID：产物不存在 ⇒ 先跑 node build/build.mjs"); process.exit(2); }
if (src && stamp !== src) {
	if (has("--plan")) {
		console.log("  ⚠️ 产物陈旧（指纹不一致）—— --plan 仍列清单；**实跑前必须先 node build/build.mjs**");
	} else {
		console.error("INVALID：产物**陈旧**（指纹不一致）⇒ 先跑 node build/build.mjs 再跑本脚本");
		console.error("  （真机结果会按「可疑」对待，所以这里直接拒绝，不给「跑了但不作数」的结果）");
		process.exit(2);
	}
}
/* `--plan` 是**纯只读**：产物陈旧也照列清单（否则"想先看看跑什么"都要先构建一轮） */
if (!has("--plan")) {
	const inst = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "plugin-install.mjs")], { cwd: PLUGIN_ROOT, encoding: "utf8" });
	const instOut = (inst.stdout || "") + (inst.stderr || "");
	if (!/IS_PASS: TRUE/.test(instOut)) {
		console.log("  装机未就绪 ⇒ 自动 --apply");
		const ap = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "plugin-install.mjs"), "--apply"], { cwd: PLUGIN_ROOT, encoding: "utf8" });
		if (!/IS_PASS: TRUE/.test((ap.stdout || "") + (ap.stderr || ""))) {
			console.error("INVALID：装机失败 ⇒ 装机链路本身有问题，先修它（真机结果不可信）");
			console.error(((ap.stdout || "") + (ap.stderr || "")).split(/\r?\n/).slice(-12).join("\n"));
			process.exit(2);
		}
		console.log("  装机已就绪（本轮做了 --apply）");
	} else { console.log("  装机已就绪"); }
} else {
	console.log("  装机检查：--plan 模式跳过（只读规划）");
}

/* ── 1. 选套件 ─────────────────────────────────────────────────── */
const ledger = loadLedger();
const all = listSuites().filter((s) => s.live).map((s) => s.name);
let suites = named.length ? named : all;
for (const n of suites) if (!existsSync(join(PLUGIN_ROOT, "scripts", n))) { console.error("INVALID：找不到套件 " + n); process.exit(2); }

/* 增量：台账里在**同一产物指纹**上已通过的真机套，默认跳过（--all 覆盖） */
const skipped = [];
if (!named.length && !has("--all")) {
	suites = suites.filter((n) => {
		const e = (ledger.suites || {})[n];
		if (e && e.lastResult === "PASS" && e.passStamp === stamp) { skipped.push(n); return false; }
		return true;
	});
}
console.log("  真机套件: 跑 " + suites.length + " 套" + (skipped.length ? "，按台账跳过 " + skipped.length + " 套（同指纹已绿）" : ""));
if (!suites.length) { console.log("\n（无真机套件需跑。要强制全跑加 --all）"); process.exit(0); }

/* 🔴 `--plan` 干跑：只列要跑什么就退出。
 *   为什么必须有：本脚本"不带套件名 = 跑全部"，一旦 CDP 已经在跑就会**直接开跑**
 *   十几套真机 —— 如果那个实例是**另一个并行会话**的，两边会互相改页面状态、
 *   结果全不可信（本轮真机被切断 5 次就是这么来的）。
 *   所以：先能看、再能跑。 */
if (has("--plan")) {
	console.log("\n（--plan 只列清单，不执行）待跑：");
	for (const n of suites) console.log("   · " + n);
	if (skipped.length) console.log("  跳过（同指纹已绿）：" + skipped.join(" / "));
	console.log("\n实跑：node scripts/run-live.mjs " + (named.length ? named.join(" ") : "") + (has("--all") ? " --all" : ""));
	process.exit(0);
}

/* ── 2. CDP：已在跑就不重复启动；冷启动**只等一次** ─────────────── */
async function cdpUp() {
	try { const r = await fetch("http://127.0.0.1:" + PORT + "/json/version", { signal: AbortSignal.timeout(2500) }); return r.ok; }
	catch (e) { return false; }
}
async function pageUp() {
	try {
		const r = await fetch("http://127.0.0.1:" + PORT + "/json/list", { signal: AbortSignal.timeout(2500) });
		const list = await r.json();
		return list.some((t) => t.type === "page" && !/devtools/.test(t.url));
	} catch (e) { return false; }
}
if (!(await cdpUp())) {
	if (has("--no-start")) {
		const ghost = await portBusy(BASE_PORT);
		console.error("INVALID：CDP 未就绪（已探测 " + BASE_PORT + "–" + (BASE_PORT + PORT_SHIFT_MAX) + "，**均无端点**）");
		console.error("  ⇒ 这不是「连不上」，是**没人在听**"
			+ (ghost ? "；且 " + BASE_PORT + " 端口**被占用但非 CDP** ⇒ 幽灵 pid / 其它进程（纪律 119）" : "")
			+ "。**与产品无关**（T-PLUG-065）。");
		console.error("  处置：先 `node scripts/stop-harness.mjs`（验证式停机），再 `RH_RESTART=1` 重跑。");
		process.exit(2);
	}
	/* 🔴 自启端口必须是**空位**：`base` 被幽灵 pid 占着时直接起会失败，且报错很难读 */
	let startPort = BASE_PORT;
	while (startPort <= BASE_PORT + PORT_SHIFT_MAX && (await portBusy(startPort))) startPort++;
	if (startPort !== BASE_PORT) console.log("  ⚠️ " + BASE_PORT + " 已被占用（非 CDP）⇒ **自启改用 " + startPort + "**");
	PORT = startPort;
	console.log("  启动 Harness（只启动这一次）…");
	const { spawn } = await import("node:child_process");
	const child = spawn(HARNESS_EXE, ["--remote-debugging-port=" + String(PORT)], {
		cwd: HARNESS_DIR, detached: true, stdio: "ignore",
		env: (() => { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; delete e.NODE_OPTIONS; return e; })()
	});
	child.unref();
} else {
	console.log("  CDP 已在跑 ⇒ 复用（不重复启动）");
	console.log("  ⚠️ 该实例可能是**另一个会话**开的 ⇒ 两边会互相改页面状态，结果不可信。");
	console.log("     若本轮结果出现难以解释的红，先怀疑这里（换时间/换端口再跑）。");
}

let ready = false;
for (let i = 0; i < 90; i++) { if (await cdpUp() && await pageUp()) { ready = true; console.log("  页面就绪（等待 " + (i * 2) + "s）"); break; } await sleep(2000); }
if (!ready) { console.error("INVALID：Harness 起来了但页面目标一直不出现（90×2s 预算用尽）"); process.exit(2); }
/* devtools HTTP 端点刚起时会抖（UND_ERR_HEADERS_TIMEOUT）⇒ 先探活再放行 */
for (let i = 0; i < 20; i++) {
	try { const r = await fetch("http://127.0.0.1:" + PORT + "/json/list", { signal: AbortSignal.timeout(8000) }); if (r.ok) break; } catch (e) { /* 继续等 */ }
	await sleep(1500);
}

/* ── 3. 依次跑完（首套自举后 dp-root 已在 DOM，后续套件起点判定秒过） ── */
console.log("\n════ 依次执行（首套负责自举起点）════");
const results = [];
/* 🔴 子进程输出**直写文件**（`T-PLUG-066`）—— 两条独立理由，**都不是"防 EPIPE"**：
 *   ① **保留完整证据**（纪律 57）：原先只打印 tail 3 行 ⇒ 套件一旦崩，当场**没有任何上下文**可查。
 *      `T-PLUG-066` 那次的栈只剩 3 行（`at onwrite` / `at Zlib.cb` / `Node.js`），
 *      连"崩在哪一步、跑了几秒"都还原不出来 —— **这正是它变成悬案的原因**。
 *   ② **归因更正（重要）**：原写"一次跑写 486 KB 截图、被本脚本捕获输出时触发 EPIPE" ——
 *      已被**对照实验证伪**：5 MB stdout 经 `pipe` 同步捕获**正常返回**（`status=0` / 5,120,026 B / 157ms），
 *      读端提前关闭同样不崩。且那次崩溃 `exit=1` 只跑 **4s**，而正常跑 **66s**、截图在**最后一步** ⇒ 时间线对不上。
 *      ⇒ 真因**未定位**；本改动是"**让下一次可定位**"，不是"修好了它"。
 *   ③ 附带：大输出不再进内存，也不再依赖 pipe 行为。 */
const LOG_DIR = join(PLUGIN_ROOT, "logs");
try { mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* 已存在 */ }

let _idx = 0;
for (const n of suites) {
	/* ══ 🔴 批内**起点守卫**（第 41 轮新增 · 一次连跑里救回 38 条假红）══════════════
	 * 本批真机实测的故障链（无一条是产品缺陷，但读起来全是"产品坏了"）：
	 *   `verify-design-studio`（第 3 套）自己红了（工作室没挂载）**且没有复原页面**
	 *   ⇒ `verify-director-logic`（第 4 套）`DL-1a 起点：dp-root 在 DOM` 红 ⇒ **21 条级联 + INVALID**
	 *   ⇒ `verify-flow`（第 5 套）**17 条红**。
	 *   ⚠️ 而这两套在上一批**都是绿的** ⇒ 它们的红全是"**起点被前一套改了**"。
	 *
	 * 本脚本原先的分工是"**首套负责自举起点**，后续套件秒过判定" —— 这个分工里
	 * 藏着一个未设防的假设：**每个套件跑完都把页面留在总监页上**。警告早就写在下面
	 * （"两边会互相改页面状态，结果不可信"），但**只警告、不防御**。
	 *
	 * ⇒ 纪律（第 41 轮）：**一个套件的失败不许改变下一个套件的起点。**
	 *   否则"本轮跑哪些套件、按什么顺序"也成了输入 ⇒ 与纪律 107（构建面内不许有
	 *   随跑程变化的输入）同族，只是发生在**测试面**。
	 *
	 * 实现：复用**唯一实现** `_cdp-startup.mjs#ensureDirectorPage`（纪律 98，
	 * 不新写第二份自举）。薄壳 `_ensure-page.mjs` 只做接线 + 用**退出码**表态：
	 *   0 起点在位/已恢复 · 1 起点**无法恢复** · 2 环境不可用。
	 * ⚠️ 恢复失败时**不静默**、也**不改写套件自己的结论** —— 只在状态行上打
	 *    `⚠️起点未恢复`，让人一眼知道这一行**不可信**（纪律 54）。 */
	let _guardNote = "";
	if (_idx > 0) {
		const g = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "_ensure-page.mjs")], {
			cwd: PLUGIN_ROOT, encoding: "utf8", timeout: 300000,
			env: { ...process.env, CDP_PORT: String(PORT) }
		});
		const gOut = String((g.stdout || "") + (g.stderr || "")).split(/\r?\n/).filter((l) => l.trim());
		const gLine = gOut.length ? gOut[gOut.length - 1].trim() : "(无输出)";
		if (g.status === 0) console.log("  · " + gLine);
		else {
			_guardNote = "⚠️起点未恢复 ";
			console.log("  ⚠️ 起点守卫 exit=" + g.status + "：" + gLine);
			console.log("     ⇒ 本套结果**不可信**（起点被前一套改变了，不是产品坏）—— 见 logs/_ensure-page 的逐步输出");
		}
	}
	_idx++;
	const fp = join(PLUGIN_ROOT, "scripts", n);
	const outFile = join(LOG_DIR, "_run-live-" + n.replace(/\.mjs$/, "") + ".out");
	const t0 = Date.now();
	let fd = -1;
	try { fd = openSync(outFile, "w"); } catch (e) { fd = -1; }
	/* 打不开就退回 pipe 捕获 —— **降级不静默**，把原因打出来（纪律 19） */
	if (fd < 0) console.log("  ⚠️ 日志文件打不开（" + outFile + "）⇒ 本次退回 pipe 捕获");
	const r = spawnSync(process.execPath, [fp], fd >= 0
		? { cwd: PLUGIN_ROOT, stdio: ["ignore", fd, fd], timeout: 600000, env: { ...process.env, CDP_PORT: String(PORT) } }
		: { cwd: PLUGIN_ROOT, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CDP_PORT: String(PORT) } });
	if (fd >= 0) { try { closeSync(fd); } catch (e) { /* 已关 */ } }
	let out = "";
	if (fd >= 0) { try { out = readFileSync(outFile, "utf8"); } catch (e) { out = ""; } }
	else { out = (r.stdout || "") + "\n" + (r.stderr || ""); }
	const code = r.status == null ? -1 : r.status;
	const isPass = /IS_PASS:?\s*TRUE/.test(out);
	const invalid = code === 2 || /INVALID/.test(out.slice(-600));
	const okFlag = code === 0;
	const tail = out.split(/\r?\n/).filter((l) => l.trim()).slice(-3).join(" ｜ ");
	console.log("  " + _guardNote + (okFlag ? "OK     " : invalid ? "INVALID" : "FAIL   ") + " " + n.padEnd(30)
		+ " exit=" + String(code).padEnd(2) + " " + String(isPass ? "IS_PASS" : "-").padEnd(8) + Math.round((Date.now() - t0) / 1000) + "s ｜ " + tail.slice(0, 110));
	/* 非绿时把**完整输出**的位置直接指出来（查的时候才有用；绿的时候不必占一行） */
	if (!okFlag) console.log("          └ 完整输出：" + outFile + "（" + out.length + " B）");
	results.push({ name: n, code: code, ok: okFlag, invalid: invalid });
	if (has("--record") && !invalid) record(ledger, n, okFlag, stamp);
}
if (has("--record")) { saveLedger(ledger); console.log("\n  台账已更新（INVALID 的套件不记 —— 没跑成不能算通过）"); }

/* 🔴 第 42 轮收尾：**清掉测试干跑键**（`sessionStorage['dsh.director.testDryRun']`）。
 *   为什么必须在这一步做：干跑键为了**跨 reload 存活**而落进 `sessionStorage`，而它同标签
 *   存活 ⇒ 若不清，用户**不重启宿主**直接用同一个窗口时，插件会"填了不发"（像产品坏了）。
 *   停机（`stop-harness.mjs`）也能清，但**不能假设调用方一定停机** ⇒ 在批结束处显式清。
 *   ⚠️ 清键失败**不当作套件失败**（这是清理，不是判据）—— 只提示一行，不改变退出码。 */
{
	const c = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "cdp-eval.mjs"),
		"(function(){try{var k='dsh.director.testDryRun';var had=window.sessionStorage.getItem(k);window.sessionStorage.removeItem(k);window.__dshDirectorDryRun=false;return 'cleared:'+had;}catch(e){return 'ERR:'+e.message;}})()"],
		{ cwd: PLUGIN_ROOT, encoding: "utf8", timeout: 30000, env: { ...process.env, CDP_PORT: String(PORT) } });
	const o = String((c.stdout || "") + (c.stderr || "")).split(/\r?\n/).filter((l) => l.trim()).slice(-1)[0] || "";
	console.log("\n  收尾：测试干跑键清除" + (c.status === 0 ? "（" + o.trim().slice(0, 60) + "）" : "**未确认**（⚠️ 请确认已 `stop-harness.mjs` 停机）"));
}

/* ── 4. 汇总（逐套标状态，INVALID 单独一列 —— 「没跑成」与「失败」必须可分） ── */
const okN = results.filter((r) => r.ok).length;
const invN = results.filter((r) => !r.ok && r.invalid).length;
const failN = results.filter((r) => !r.ok && !r.invalid).length;
console.log("\n════ 汇总 ════");
console.log("  OK=" + okN + "  FAIL=" + failN + "  INVALID=" + invN + "  总计=" + results.length);
if (failN) console.log("  红：" + results.filter((r) => !r.ok && !r.invalid).map((r) => r.name).join(" / "));
if (invN) console.log("  没跑成（≠失败，先查前提）：" + results.filter((r) => !r.ok && r.invalid).map((r) => r.name).join(" / "));
if (failN) process.exit(1);
if (invN) console.log("  ⚠️ 有套件没跑成 ⇒ 这轮真机结论**不完整**");
process.exit(0);
