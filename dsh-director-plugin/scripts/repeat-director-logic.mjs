#!/usr/bin/env node
/**
 * repeat-director-logic.mjs —— **反复跑总监逻辑链 N 次**，输出收敛表
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么是"反复跑"而不是"跑一次绿"
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：「重复该流程起码四十次」
 *
 * 🔴 单次绿**证不了**三件事，只有连跑才暴露：
 *   ① **累积缺陷** —— 每跑一次多 8 条会话（第 19 批之前正是如此，跑到 126 条）；
 *   ② **半复用** —— 第 2 次之后 `created` 若不是 0，说明复用索引或存活集口径坏了；
 *   ③ **偶发假红** —— CDP 合成鼠标静默丢事件（U6）表现为"时绿时红"，单次跑不出来。
 *
 * ══════════════════════════════════════════════════════════════════
 * 收敛判据（**先写判据，再跑**）
 * ──────────────────────────────────────────────────────────────────
 *  RU-1 每一轮 `IS_PASS: TRUE`（FAIL / INVALID **都要分开统计** —— 纪律 58）
 *  RU-2 每一轮噪声 ⇒ `kind=noise` 且原因含用例期望（8 类分辨**全对**）
 *  RU-3 每一轮真实需求 ⇒ `kind == 用例期望` 且 `made` == **该用例点名维度数**（语料派生）
 *  RU-4a 🔴 **段内同性质重见 ⇒ `created == 0`**（先复用、没有才建）
 *       ⚠️ 口径按**段**取（第二十四轮更正）：复用索引在 localStorage，app 端口每次变
 *       ⇒ 按含端口 origin 隔离 ⇒ 冷启动后索引为空 ⇒ **新实例内首次派发必然重建**。
 *       详见判据区的理由链与 run05 判别证据。同时要求「段内确有重见轮」⇒ 不是空真。
 *  RU-4b 🔴 **段内**累计新建 ≤ 该段「各性质**维度并集**」之和（语料全跑一遍时恰 11）+ 4
 *       —— 冷启动重建**计入预算**，不豁免；段内重见仍新建一样会超。
 *  RU-4c ⚠️ **U10 读数**：「冷启动后首次派发必然重建 N 条」**如实打印**，不作红 ——
 *       它是**真实的用户可见缺陷**（每次重启 app 后第一次分配都会重建一批会话），
 *       但修法（宿主 `rename` 通道 / cookie 跨启动）属**影响范围大的决策** ⇒ 待裁决。
 *       🔴 **不许把它藏进绿里**（纪律 19/54）。
 *  RU-5 用例覆盖：N ≥ 8 时 8 条用例**全部至少跑到一次**
 *  RU-6 🔴 **跨重启轮次也全绿**（冷启动 + 复用这条路单独算 —— 见下）
 *
 * 用法：node scripts/repeat-director-logic.mjs [次数]   # 默认 40
 *      DL_RESTART_EVERY=N  ⇒ 每 N 轮（含第 1 轮）强制重启 Harness = **跨重启连跑**
 *      CDP_PORT=P          ⇒ 起始端口（每段依次 +1，见下）
 * 退出码：0 全部达标 / 1 有未达标项 / 2 用法错
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { CORPUS, caseAt } from "./_corpus-director.mjs";
import { ensureHarness, freePort, cdpAlive } from "./_harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const GATE = resolve(HERE, "verify-director-logic.mjs");
const LOGDIR = resolve(ROOT, "logs");

const N = Number(process.argv[2] || 40);
if (!Number.isFinite(N) || N < 1) { console.log("用法：node scripts/repeat-director-logic.mjs [次数]"); process.exit(2); }

/* 🔴 新建阈值 = 「每个维度组首次建一次」的理论值 + 余量。
 *    语料里小说用例统一《墟海》⇒ 同一批维度；通用用例作品名为空 ⇒ 另一批。
 *    余量 4 用于吸收"运行中宿主自己产生的会话"（不是本套件建的）。
 *    ⚠️ 19 号文 N1 后 `made` **不再**是"小说恒 8" —— 见 `wantMade()`。
 *       但**并集**仍是 11（小说并集 8 + 通用并集 3），故此处数值不变。 */
const CREATE_BUDGET = 11 + 4;

/* 🔴 每轮期望派发条数 = **该用例点名的维度数**（19 号文 N1 规格演进）。
 *    旧口径 `novel ? 8 : 3` 按**项目性质**给常量；N1 落地后 `plan()` 按需求原话
 *    **精确取集**（C1 点名 5 维 / C10 点名 1 维 / C8 显式全量 8 维）
 *    ⇒ 常量口径会在 N≥8 的连跑里大面积假红。
 *    期望值来源 = `c.expectDims`，与离线 `test-director-corpus` 的 `CP-3a–m`
 *    **同一真相源**（🔴 **不是** `plan(c.real)` —— 那是拿被测产品给自己出题，同源空真）。 */
const wantMade = (c) => (Array.isArray(c.expectDims) ? c.expectDims.length : -1);

/* ══════════════════════════════════════════════════════════════════
 * 🔴 跨重启连跑（T-PLUG-057 第二半 · 2026-09-17 新增）
 * ──────────────────────────────────────────────────────────────────
 * 之前的 40 轮**全在热态**：同一个 Harness 实例、同一份渲染进程内存。
 * 那证不了"**冷启动 + 复用**"这条路 —— 而冷启动恰恰是用户真实遇到的入口：
 *   · 冷启动停在欢迎页，侧栏**没有 `[role="tab"]` 环**（套件起点须先点开一个会话）；
 *   · 渲染进程内存归零 ⇒ 复用索引（`store/split-index.js`）必须从**磁盘**恢复；
 *   · 宿主会话列表要重新从磁盘 `workspace.json` 读 ⇒ 复用判据的**输入**换了一份来源。
 *
 * `DL_RESTART_EVERY=N` ⇒ 每 N 轮**在此轮开跑前**强制重启 Harness（N=0 表示不重启）。
 * 🔴 **必须在同一进程内重启** —— 实测：跨工具调用的 Harness 会被会话回收
 *    （`spawn` 后端口短暂 LISTENING，下一调用即 `ECONNREFUSED` + 进程归零）。
 *    这也是项目纪律 ㊵「Harness 启动与测试同一条命令」的由来。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 **首版为什么全红：真因不在"重启"，在"端口"**（2026-09-17 受控对照实测）
 * ──────────────────────────────────────────────────────────────────
 * 首版 15 轮全 INVALID，3 次重启全报「CDP 未在预算内就绪」。现象极具误导性
 * ——「起的进程活着、套件却永远连不上」。真因由新实例**自己的输出**给出：
 *     `ERROR:net\socket\tcp_socket_win.cc:530] bind() returned an error:
 *       通常每个套接字地址(协议/网络地址/端口)只允许使用一次。 (0x2740)`
 *     `ERROR:...devtools_http_handler.cc:311] Cannot start http server for devtools.`
 * 即 **`taskkill /F /IM` 之后 9222 仍被幽灵残留进程占着**（`netstat` 里旧 pid 还在 LISTENING）
 * ⇒ 新实例进程起来了、界面也起来了，**唯独 CDP 端口绑不上** ⇒ `ECONNREFUSED`。
 *
 * ⇒ 两条处置（都已落地）：
 *   ① `_harness.mjs` 的 `stopHarness()` 改为**验证式停机**（结论看进程表 + 能否 bind，
 *      不看 `taskkill` 的文案 —— 中文输出 utf8 解码是乱码，看文案会假成功，纪律 61/76）；
 *   ② **每段换端口**（`BASE + 段序号`，且严格递增）⇒ 彻底绕开幽灵，同时让
 *      「这一段真的是新实例」有**可证伪的读数**（端口不同 ⇒ 不可能是复用旧进程，纪律 ⑫）。
 *      套件本来就读 `CDP_PORT`，所以只需把它传下去。
 */
const RESTART_EVERY = Number(process.env.DL_RESTART_EVERY || 0);
const BASE_PORT = Number(process.env.CDP_PORT || 9222);
const restarts = [];

mkdirSync(LOGDIR, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const rows = [];
const seen = Object.create(null);      // 用例 id → 已出现次数
const badRunsRaw = [];                 // **没跑成**的轮次（CDP 不可达等）—— 与"跑了但失败"分开（纪律 58）
let totalCreated = 0;
let u10Read = null;                    // U10 读数（冷启动重建）—— 落进 summary JSON 供文档引用
let firstFailRun = 0;
/* 🔴 本段**当前活着的**实例端口 —— 必须**跨轮保持**：
 *    每段重启都换端口（绕开幽灵），所以"不重启的那些轮"要连的**不是**基准端口。
 *    （首版把它写成轮内局部变量 ⇒ run5 去连已经没人监听的 9222 ⇒ 306s 超时 INVALID。） */
let port = BASE_PORT;

console.log("═══ repeat-director-logic · 连跑 " + N + " 次（语料 " + CORPUS.length + " 条轮转）═══");
console.log("    跨重启：" + (RESTART_EVERY > 0
	? "每 " + RESTART_EVERY + " 轮重启一次（**含第 1 轮** ⇒ 首跑即冷启动）· 起始端口 " + BASE_PORT + "（每段严格 +1）"
	: "关闭（DL_RESTART_EVERY=0 ⇒ 全在热态）"));
console.log("");
const tAll = Date.now();

for (let i = 1; i <= N; i++) {
	const t0h = Date.now();          // 本轮**总**计时起点（含重启开销）
	const c = caseAt(i - 1);
	seen[c.id] = (seen[c.id] || 0) + 1;
	const allowCreate = seen[c.id] === 1 ? "1" : "0";   // 首见 ⇒ 允许新建；之后必须全复用

	/* 🔴 跨重启：**第 1 轮也重启**（让首跑即冷启动）+ 之后每 N 轮一次。
	 *    为什么首轮要冷启动：用户真实入口就是冷启动，而 run1 热跑会让"冷启动 + 复用"
	 *    这条路永远没被覆盖过。 */
	let restarted = false;
	if (RESTART_EVERY > 0 && (i === 1 || (i - 1) % RESTART_EVERY === 0)) {
		/* 🔴 端口**严格递增**（不与任何已用端口重合）：
		 *    只要求"空闲"是不够的 —— 上一段的实例刚被杀掉，它的端口也会变"空闲"，
		 *    于是两段抽到同一个端口 ⇒ 既分不清是不是新实例，又回到幽灵风险里。 */
		const usedPorts = restarts.map((r) => r.port).filter(Boolean);
		const floor = Math.max(BASE_PORT + restarts.length, usedPorts.length ? Math.max.apply(null, usedPorts) + 1 : BASE_PORT);
		const want = await freePort(floor, 8);
		console.log("  ── run" + i + " 前强制重启 Harness（DL_RESTART_EVERY=" + RESTART_EVERY
			+ " · 第 " + (restarts.length + 1) + " 段 · 起始端口 " + (want == null ? "无空闲" : want) + "）──");
		if (want == null) {
			restarts.push({ run: i, ok: false, port: null, pid: null, shifted: false, why: "找不到空闲端口（" + floor + " 起 8 个都被占）" });
			console.log("  ⚠️ 无空闲端口 ⇒ 本段不重启，套件会连旧实例（读数里如实标出）");
		} else {
			const h = await ensureHarness({ port: want, forceRestart: true, log: (s) => console.log(s) });
			port = h.port || want;
			restarted = true;
			restarts.push({
				run: i, ok: h.ok, port: port, want: want, pid: h.pid, shifted: !!h.shifted,
				leftover: (h.stopInfo && h.stopInfo.leftover) ? h.stopInfo.leftover : null, why: h.why || ""
			});
			if (h.shifted) console.log("  ℹ️ 端口被幽灵占用 ⇒ 已顺移到 " + port + "（绕开，不影响判据）");
			if (!h.ok) console.log("  ⚠️ 重启后 CDP 未就绪 ⇒ 本轮会以 INVALID 记账（不计产品缺陷）");
		}
		/* 冷启动后插件注入需要时间；套件自身的 DL-0 有 30s 等待，这里再留一段余量 */
		await new Promise((r) => setTimeout(r, 3000));
	}

	/* 🔴 **开跑前先证通道**（纪律 55/58）：目标端口真有人听吗？
	 *    反例（首版实测）：窗口连不上 CDP 时套件会一路等到自己的长预算耗尽 ——
	 *    **306s 才报 INVALID**，把"没跑成"白白拖成 5 分钟，还挤掉了后面轮次的时间。
	 *    ⇒ 这里用**有界 20s 等待**，仍未就绪就**直接记 INVALID 并给出可分辨原因**（不进套件）。 */
	let alive = await cdpAlive(port);
	if (!alive) {
		const tw = Date.now();
		while (!alive && Date.now() - tw < 20000) {
			await new Promise((r) => setTimeout(r, 1500));
			alive = await cdpAlive(port);
		}
	}
	if (!alive) {
		const ms = Date.now() - t0h;
		rows.push({
			run: i, case: c.id, first: allowCreate === "1", restarted: restarted, port: port,
			pass: 0, fail: 0, kind: null, made: null, reused: null, created: null,
			noiseKind: null, orgNoise: null, live: null,
			isPass: false, invalid: true, hasResult: false, ms: ms, file: "(未跑：CDP 不可达)"
		});
		badRunsRaw.push({ run: i, why: "CDP 不可达（port " + port + "）" });
		console.log("  run" + String(i).padStart(2, "0") + " ⚠ INVAL " + c.id
			+ " ｜**CDP 不可达（port " + port + "）⇒ 未跑套件**｜" + Math.round(ms / 1000) + "s");
		continue;
	}

	const t0 = Date.now();
	const r = spawnSync(process.execPath, [GATE], {
		cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, CDP_PORT: String(port), DL_CASE: c.id, DL_ALLOW_CREATE: allowCreate }
	});
	const text = String(r.stdout || "") + String(r.stderr || "");
	const logFile = resolve(LOGDIR, "_r24-repeat-" + STAMP + "-run" + i + ".txt");
	writeFileSync(logFile, text, "utf8");

	const line = (text.split("\n").filter((s) => s.indexOf("RESULT ") === 0)[0] || "").slice(7);
	let o = null;
	try { o = JSON.parse(line); } catch (_) { o = null; }
	/* 🔴 判据来源**只认两处**，不要在整个输出里 grep 关键词：
	 *    实测假阳性 —— 断言名「…后续红**全部 INVALID**」里就含 `INVALID`，
	 *    全文本 grep 会把**每轮**都标成 INVAL，而结论明明是 `IS_PASS: TRUE`
	 *    ⇒ 40 轮跑完会得出一张"全是 INVALID 却又全绿"的自相矛盾的表（纪律 54）。
	 *    ⇒ 改认：① RESULT 行里的 `invalid` 字段；② 结论行 `IS_PASS: INVALID`。 */
	const isPass = r.status === 0 && /IS_PASS: TRUE/.test(text);
	const invalid = (o && o.invalid === true) || /^IS_PASS: INVALID/m.test(text) || r.status === 2;

	const row = {
		run: i, case: c.id, first: allowCreate === "1", restarted: restarted, port: port,
		pass: o ? o.pass : null, fail: o ? o.fail : null,
		kind: o ? o.kind : null, made: o ? o.made : null,
		reused: o ? o.reused : null, created: o ? o.created : null,
		noiseKind: o ? o.noiseKind : null, orgNoise: o ? o.orgNoise : null,
		live: o ? o.liveEnd : null,
		isPass: isPass, invalid: invalid, hasResult: !!o,
		ms: Date.now() - t0, file: logFile
	};
	if (o && typeof o.created === "number") totalCreated += o.created;
	if (!isPass && !firstFailRun) firstFailRun = i;
	rows.push(row);

	console.log("  run" + String(i).padStart(2, "0")
		+ " " + (row.invalid ? "⚠ INVAL" : (row.isPass ? "✅ PASS " : "❌ FAIL "))
		+ " " + c.id + (row.first ? "*" : " ")
		+ " " + String(row.pass) + "/" + (row.pass != null ? row.pass + row.fail : "?")
		+ " ｜噪声 " + String(row.noiseKind).padEnd(6)
		+ " ｜需求 " + String(row.kind).padEnd(7) + " made=" + String(row.made).padEnd(2)
		+ " 复用" + String(row.reused).padStart(2) + "/建" + String(row.created).padStart(2)
		+ " ｜去噪 " + row.orgNoise
		+ " ｜活会话 " + row.live
		+ " ｜" + Math.round(row.ms / 1000) + "s" + (row.hasResult ? "" : "  ⚠无RESULT行")
		+ (RESTART_EVERY > 0 ? " ｜port " + row.port : "")
		+ (row.restarted ? "  🔄冷启动" : ""));
}

/* ── 收敛判据 ─────────────────────────────────────────────────────── */
console.log("\n═══ 收敛判据 ═══");
const fails = [];
const ok = (name, cond, detail) => {
	console.log("  " + (cond ? "✅" : "❌") + " " + name + (cond ? "" : "  → " + JSON.stringify(detail)));
	if (!cond) fails.push(name);
};

const badRuns = rows.filter((x) => !x.isPass);
const invalidRuns = rows.filter((x) => x.invalid);
const noResult = rows.filter((x) => !x.hasResult);
/* 🔴 **INVALID 轮不计产品判据**（纪律 58：「没跑成」与「失败」必须可分）。
 *    否则"前提不成立"的那几轮会把 RU-2/RU-3 一起染红，真正的失败反而被淹掉。 */
const validRows = rows.filter((x) => !x.invalid);
if (invalidRuns.length) {
	console.log("  ℹ️ INVALID 轮 " + invalidRuns.length + " 个（**不计产品判据**）：" + JSON.stringify(invalidRuns.map((x) => x.run)));
}
ok("RU-1 每轮 IS_PASS=TRUE（共 " + N + " 轮）", badRuns.length === 0,
	{ 失败轮: badRuns.map((x) => x.run), INVALID轮: invalidRuns.map((x) => x.run), 无读数轮: noResult.map((x) => x.run), 未跑成: badRunsRaw });

const noiseBad = validRows.filter((x) => x.noiseKind !== "noise");
ok("RU-2 每轮噪声都被分辨为 noise（" + (validRows.length - noiseBad.length) + "/" + validRows.length + "）",
	validRows.length > 0 && noiseBad.length === 0, noiseBad.map((x) => ({ run: x.run, kind: x.noiseKind })));

const kindBad = validRows.filter((x) => {
	const c = caseAt(x.run - 1);
	return x.kind !== c.expectKind || x.made !== wantMade(c);
});
ok("RU-3 每轮派发条数 = 该用例**点名维度数**（语料 " + CORPUS.map((c) => wantMade(c)).join("/") + "）",
	validRows.length > 0 && kindBad.length === 0,
	kindBad.map((x) => ({ run: x.run, case: x.case, kind: x.kind, made: x.made, want: wantMade(caseAt(x.run - 1)) })));

/* 🔴 前提显式化（纪律 23：先证前提再断结果）——
 *    RU-3 与 RU-4b 的期望值都派生自语料。若语料被改成"某条 novel 用例少点名一维"，
 *    两条判据会跟着变松而**没人发现**。⇒ 先把前提钉住：
 *      · novel 用例的维度**并集**必须仍是 A1–A8 全套（8 维）；
 *      · generic 用例的并集必须仍是通用三段（3 维）。 */
{
	const novelPool = new Set();
	const genericPool = new Set();
	for (const c of CORPUS) {
		const tgt = c.expectKind === "novel" ? novelPool : genericPool;
		for (const d of (c.expectDims || [])) tgt.add(d);
	}
	ok("RU-3b 🔴 前提：语料 novel 并集 = 8 维 且 generic 并集 = 3 维（否则 RU-3/4b 期望值本身错）",
		novelPool.size === 8 && genericPool.size === 3,
		{ novel: [...novelPool].sort(), generic: [...genericPool].sort() });
}

/* ── 段号 + 段内「首见性质」──────────── **改口径前先打印前提**（第二十四轮）
 *
 * 🔴 旧口径「全程累计 ≤ 11+4」隐含前提「**全程同一个 Harness 实例**」，
 *    跨重启连跑（`DL_RESTART_EVERY>0`）**不满足**该前提 ⇒ 必然假红。理由链（每条都有读数）：
 *      ① 复用索引 `dsh.director.split` 存在 **localStorage**（`store/split-index.js`）；
 *      ② app **端口每次启动都变** ⇒ localStorage 按**含端口 origin** 隔离（本项目既有环境事实）；
 *      ③ ⇒ 冷启动后索引为空 ⇒ `planReuse()` 全部落 `no-match` ⇒ **新实例内首次派发必然重建**；
 *      ④ **判别证据（不是推断）**：run05 与 run04 同在 port 9223，宿主里 run01 建的那 8 条
 *         《墟海》分支**都还活着**（`alive` 63→66），维度集完全一致，却仍 `created=8`
 *         —— 若索引跨 origin 存活，这一轮必然 `created=0`。
 *    ⇒ 判据改用**产品自己的口径**（纪律 92）：索引的生命周期 = 实例 ⇒ 判据也按**段**取。
 *    ⇒ 顺带修掉旧 `RU-4a` 的**空真**：它按「用例 id 是否首见」过滤，
 *      而 `N ≤ 语料条数` 时每个用例只出现一次 ⇒ `lateCreate` 恒空 ⇒ 判据恒真（纪律 23）。
 *      新口径按「段内该**性质**是否首见」过滤，`N=6` 下就有 3 个轮次受约束（非空真）。
 *
 *    ⚠️ 改口径**不等于**放行：段内**首见性质**仍要计入预算（RU-4b 用「段内维度数之和」），
 *      真正的病（段内重见仍新建）照样会红 —— 见下面 refireCreate 的反例。 */
let segNo = 0;
for (const r of rows) { if (r.restarted) segNo += 1; r.seg = segNo; }
const segSeenRun = {};     // "seg|性质" → 该段内首见它的 run
/* 🔴 19 号文 N1 口径更正：预算 = 该段内**该性质全部轮次用到的维度并集**，
 *    不再取"首见那一轮的条数"。
 *    旧口径隐含「novel ⇒ 恒 8 条」；N1 后每个用例点名维度数都不同
 *    （C10=1 / C1=5 / C8=8）⇒ 若照首见那轮给预算，段内后续轮次换维度集就**假红**。
 *    ⚠️ 数值上**不是放松**：语料全跑一遍时 novel 并集恰 8、generic 并集恰 3
 *      ⇒ 预算仍是 11，与旧口径同值（变的是**推导方式**，不是松紧度）。 */
const segDimPool = {};     // "seg|性质" → Set(该段该性质用到的维度 key)
for (const r of validRows) {
	const c = caseAt(r.run - 1);
	const k = r.seg + "|" + c.expectKind;
	if (!segDimPool[k]) segDimPool[k] = new Set();
	for (const d of (c.expectDims || [])) segDimPool[k].add(d);
	if (segSeenRun[k] == null) segSeenRun[k] = r.run;
}
const segBudget = {};      // seg → 该段预算 = 段内各性质维度并集大小之和
for (const k of Object.keys(segDimPool)) {
	const seg = k.split("|")[0];
	segBudget[seg] = (segBudget[seg] || 0) + segDimPool[k].size;
}
const refire = [];         // 段内**重见**的轮次（判据的约束面 —— 为 0 就是空真）
const refireCreate = [];   // 重见却仍有新建 ⇒ **违规**
for (const r of validRows) {
	const c = caseAt(r.run - 1);
	if (segSeenRun[r.seg + "|" + c.expectKind] === r.run) continue;
	refire.push(r.run);
	if ((r.created || 0) > 0) refireCreate.push({ run: r.run, case: r.case, kind: c.expectKind, created: r.created, reused: r.reused });
}
ok("RU-4a 🔴 段内同性质重见 ⇒ created=0（先复用、没有才建）",
	refire.length > 0 && refireCreate.length === 0,
	{ 段内重见轮: refire, 违规: refireCreate, 前提: "段数=" + (segNo || 1) + " 每段端口=" + JSON.stringify([...new Set(validRows.map((x) => x.port))]) });

/* RU-4b：**段内**累计 ≤ 该段「首见性质」预算 + 余量 —— 冷启动重建**计入预算**，不豁免。 */
{
	const perSeg = {};
	for (const r of validRows) perSeg[r.seg] = (perSeg[r.seg] || 0) + (r.created || 0);
	const over = Object.keys(perSeg).filter((s) => perSeg[s] > (segBudget[s] || 0) + 4);
	ok("RU-4b 🔴 段内累计新建 ≤ 段内首见维度数 + 4（实测 " + JSON.stringify(perSeg) + " 预算 " + JSON.stringify(segBudget) + "）",
		over.length === 0,
		{ 超预算段: over.map((s) => ({ seg: s, created: perSeg[s], budget: (segBudget[s] || 0) + 4 })), 全程累计: totalCreated });
}
/* RU-4b′：**全局天花板**（防止"每轮都新建"这类失控增长）——
 *   每段各有一次"首见"机会 ⇒ 天花板 = 段数 × 单实例预算。
 *   🔴 它**不是**主判据（主判据是上面的段内口径），只兜"任何一段都失控"的极端情形。 */
const globalCeil = (segNo || 1) * CREATE_BUDGET;
ok("RU-4b′ 全局天花板 段数 × " + CREATE_BUDGET + " = " + globalCeil + "（实测 " + totalCreated + "）",
	totalCreated <= globalCeil,
	{ totalCreated: totalCreated, 段数: segNo || 1, 单实例预算: CREATE_BUDGET });

/* ── U10（**已知缺陷读数，不作红** —— 纪律 19：降级可以，无声不行）────────────
 * 「冷启动后首次派发必然重建 N 条」= 复用索引随 origin 丢失 ⇒ 用户每次重启 app 后
 * 第一次让总监分配，都会**重新建一批会话** —— 这正是用户最初抱怨
 * 「重复创建了一百多个会话」的**同一形态**，只是触发条件是"重启"而非"多点几次"。
 * ⇒ 本读数**必须显式出现**（不许藏在绿里），修法待裁决（见过程文档 U10）。 */
{
	const cold = validRows.filter((x) => x.restarted);
	const coldCreated = cold.reduce((a, b) => a + (b.created || 0), 0);
	const u10 = { 冷启动轮: cold.map((x) => x.run), 冷启动重建条数: coldCreated, 次数: cold.length };
	console.log("  ⚠️ U10（**已知缺陷 · 不作红**）冷启动后首次派发必然重建："
		+ (cold.length ? "冷启动 " + cold.length + " 次 ⇒ 多建 " + coldCreated + " 条（" + JSON.stringify(cold.map((x) => ({ run: x.run, created: x.created }))) + "）"
			: "本次跑程无冷启动（DL_RESTART_EVERY=0）⇒ 该路径未被覆盖")
		+ " ｜根因：复用索引 `dsh.director.split` 在 localStorage，app 端口每次变 ⇒ 按 origin 隔离 ⇒ 冷启动为空");
	if (typeof globalThis !== "undefined") globalThis.__U10 = u10;
	u10Read = u10;
}

/* 🔴 RU-6（T-PLUG-057）：**跨重启轮次也必须全绿** ——
 *    冷启动 + 复用的路径与热态完全不同（复用索引要从磁盘恢复、宿主列表要重读）。
 *    只报"总轮数全绿"会把冷启动那几轮的差异淹掉，故单列。 */
if (RESTART_EVERY > 0) {
	const rs = rows.filter((x) => x.restarted);
	const rBad = rs.filter((x) => !x.isPass);
	ok("RU-6 🔴 跨重启轮次（" + rs.length + " 轮）也全绿", rBad.length === 0,
		{ 重启轮: rs.map((x) => x.run), 失败轮: rBad.map((x) => ({ run: x.run, invalid: x.invalid, pass: x.pass, fail: x.fail })) });
	const failedRestart = restarts.filter((r) => !r.ok);
	ok("RU-6b 每次重启后 CDP 都就绪", failedRestart.length === 0, failedRestart);
	/* 🔴 RU-6c：**端口必须真的换过** —— 这是"新实例"唯一不可伪造的证据（纪律 ⑫）。
	 *    单实例锁会静默复用旧进程：若两次"重启"落在同一端口上，
	 *    完全可能是**根本没重启**而套件在旧实例上跑绿了 —— 那种绿毫无意义。 */
	const ports = restarts.map((r) => r.port).filter(Boolean);
	ok("RU-6c 🔴 每段端口互不相同（相同 ⇒ 「重启」可能只是复用了旧实例）",
		ports.length === restarts.length && new Set(ports).size === ports.length, { ports: ports });
	/* 🔴 幽灵残留**只作读数不作红**：它是**环境**问题，且已被端口顺移绕开；
	 *    但**必须说出来**（纪律 19：降级可以，无声不行）—— 高频出现时说明 `taskkill` 不可靠。 */
	const dirty = restarts.filter((r) => r.leftover);
	const shifted = restarts.filter((r) => r.shifted);
	console.log("  · 停机读数："
		+ (dirty.length ? "⚠️ " + dirty.length + "/" + restarts.length + " 次**未杀干净**（幽灵）⇒ 已靠端口顺移绕开；"
			+ "残留=" + JSON.stringify(dirty.map((r) => ({ run: r.run, procs: r.leftover.procs, listeners: r.leftover.listeners })))
			: "每次停机都验证到干净")
		+ " ｜顺移段 " + shifted.length + (shifted.length ? " " + JSON.stringify(shifted.map((r) => r.port)) : ""));
}

const covered = new Set(rows.map((x) => x.case));
ok("RU-5 语料覆盖 " + covered.size + "/" + CORPUS.length + " 条",
	N < CORPUS.length || covered.size === CORPUS.length, { covered: [...covered] });

/* 会话趋势（首轮 → 末轮） */
const l0 = rows[0] && rows[0].live;
const l1 = rows[rows.length - 1] && rows[rows.length - 1].live;
console.log("  · 活会话：首轮 " + l0 + " → 末轮 " + l1 + "（净增 " + ((l1 || 0) - (l0 || 0)) + "）");
console.log("  · 累计新建分支会话：" + totalCreated + " ｜总耗时 " + Math.round((Date.now() - tAll) / 1000) + "s"
	+ " ｜单轮均 " + Math.round(rows.reduce((a, b) => a + b.ms, 0) / rows.length / 1000) + "s");
console.log("  · 用例出现次数：" + JSON.stringify(seen));
if (RESTART_EVERY > 0) {
	console.log("  · 跨重启：每 " + RESTART_EVERY + " 轮一次，共 " + restarts.length + " 次"
		+ "（成功 " + restarts.filter((r) => r.ok).length + "）· 轮次 " + JSON.stringify(restarts.map((r) => r.run))
		+ " · 端口 " + JSON.stringify(restarts.map((r) => r.port)));
}

const summary = { N, restartEvery: RESTART_EVERY, restarts: restarts, rows, totalCreated, u10: u10Read, l0, l1, fails, seen };
writeFileSync(resolve(LOGDIR, "_r24-repeat-summary-" + STAMP + ".json"), JSON.stringify(summary, null, 2), "utf8");
writeFileSync(resolve(LOGDIR, "_r24-repeat-latest.txt"),
	rows.map((x) => "run" + x.run + " " + x.case + " " + (x.isPass ? "PASS" : (x.invalid ? "INVAL" : "FAIL"))
		+ " " + x.pass + "/" + (x.pass + x.fail) + " kind=" + x.kind + " made=" + x.made
		+ " reused=" + x.reused + " created=" + x.created + " noise=" + x.noiseKind + " live=" + x.live).join("\n"), "utf8");

console.log("\nIS_PASS: " + (fails.length === 0 ? "TRUE" : "FALSE（未达标 " + fails.length + " 项）"));
if (fails.length) fails.forEach((f) => console.log("   - " + f));
console.log("留痕：logs/_r24-repeat-summary-" + STAMP + ".json");
process.exit(fails.length === 0 ? 0 : 1);
