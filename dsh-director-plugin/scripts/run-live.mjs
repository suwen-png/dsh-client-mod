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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT, listSuites, artifactStamp, srcStamp, loadLedger, saveLedger, record } from "./_test-ledger.mjs";

const PORT = Number(process.env.CDP_PORT || 9222);
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
	if (has("--no-start")) { console.error("INVALID：CDP 未就绪且指定了 --no-start"); process.exit(2); }
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
for (const n of suites) {
	const fp = join(PLUGIN_ROOT, "scripts", n);
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [fp], {
		cwd: PLUGIN_ROOT, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, CDP_PORT: String(PORT) }
	});
	const out = (r.stdout || "") + "\n" + (r.stderr || "");
	const code = r.status == null ? -1 : r.status;
	const isPass = /IS_PASS:?\s*TRUE/.test(out);
	const invalid = code === 2 || /INVALID/.test(out.slice(-600));
	const okFlag = code === 0;
	const tail = out.split(/\r?\n/).filter((l) => l.trim()).slice(-3).join(" ｜ ");
	console.log("  " + (okFlag ? "OK     " : invalid ? "INVALID" : "FAIL   ") + " " + n.padEnd(30)
		+ " exit=" + String(code).padEnd(2) + " " + String(isPass ? "IS_PASS" : "-").padEnd(8) + Math.round((Date.now() - t0) / 1000) + "s ｜ " + tail.slice(0, 120));
	results.push({ name: n, code: code, ok: okFlag, invalid: invalid });
	if (has("--record") && !invalid) record(ledger, n, okFlag, stamp);
}
if (has("--record")) { saveLedger(ledger); console.log("\n  台账已更新（INVALID 的套件不记 —— 没跑成不能算通过）"); }

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
