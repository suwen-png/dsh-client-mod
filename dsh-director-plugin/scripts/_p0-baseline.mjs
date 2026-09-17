#!/usr/bin/env node
/**
 * _p0-baseline.mjs —— 19 号文 §7 **P0 起点**：启 Harness → 跑**现状**真机套件各 1 次
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须是**一个脚本**而不是"两条 bash 命令"
 * ──────────────────────────────────────────────────────────────────
 * 纪律 ㊵：**Harness 启动与测试必须在同一条命令里** —— 这不是习惯，是环境约束
 * （`_harness.mjs` 头部实测：自动化会话结束时父进程的作业对象会回收整棵进程树）。
 * ⇒ `ensureHarness()` 与 `spawnSync(套件)` 必须在**同一个 Node 进程**内。
 *
 * ══════════════════════════════════════════════════════════════════
 * 它做什么 / 不做什么
 * ──────────────────────────────────────────────────────────────────
 *  · 做：就绪 Harness（复用已在跑的实例；否则拉起；端口被幽灵占则顺移）→ 依次跑套件 →
 *        全量日志落 `logs/acceptance19/` → 打印**可直接引用**的读数行。
 *  · 不做：不改产品、不装包、不判产品红绿（**这是基线读数，不是验收结论**）。
 *    🔴 纪律 31「报绿先审口径」：本脚本只**如实转述**套件自己的 PASS/FAIL/INVALID，
 *       不替它下结论；`INVALID` 与 `FAIL` 必须分开报（纪律 18）。
 *  · 🔴 它**会**触发被跑套件的真实副作用（`verify-novel-split` 真建 8 条宿主会话 +
 *    真清空总监消息，其 D 段自带快照/还原）；这是该套件的既有性质，不是本脚本引入的。
 *
 * 用法：node scripts/_p0-baseline.mjs ｜ 退出码 0 全绿 / 1 有 FAIL / 2 有 INVALID 或 Harness 未就绪
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureHarness } from "./_harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(ROOT, "logs", "acceptance19");
const SUITES = (process.env.SUITES
	? String(process.env.SUITES).split(",").map((s) => s.trim()).filter(Boolean)
	: ["verify-novel-split.mjs", "verify-director-logic.mjs"]
).map((s) => (s.endsWith(".mjs") ? s : s + ".mjs"));

mkdirSync(OUT, { recursive: true });

/**
 * 🔴 「CDP 可达」≠「有页面可连」（本轮实测：`/json/version` 2s 就通，但套件立刻
 *    `INVALID：CDP 无 page 目标` —— Electron 主进程先起、窗口后建）。
 *    套件连接时若 `page` 目标还没出现，它们会**如实**判 INVALID 并退出（这是对的），
 *    但作为**编排者**我们不该在这一步就把 INVALID 当成结论 ⇒ 先有界等到 page 出现。
 * 返 true = 有 page；false = 预算用尽（此时才是真的"环境不成立"）。
 */
function listTargets(port) {
	return new Promise((resolve0) => {
		const req = http.get({ host: "127.0.0.1", port: port, path: "/json/list", timeout: 3000 }, (res) => {
			let b = "";
			res.on("data", (d) => { b += d; });
			res.on("end", () => { try { resolve0(JSON.parse(b)); } catch (_) { resolve0([]); } });
		});
		req.on("error", () => resolve0([]));
		req.on("timeout", () => { req.destroy(); resolve0([]); });
	});
}

async function waitPageTarget(port, budgetMs) {
	const t0 = Date.now();
	let last = [];
	while (Date.now() - t0 < budgetMs) {
		const a = await listTargets(port);
		const pages = a.filter((x) => x && x.type === "page" && x.webSocketDebuggerUrl);
		if (pages.length) {
			console.log("  [P0] page 目标就绪 " + pages.length + " 个，用时 " + (Date.now() - t0) + "ms"
				+ " · title=" + JSON.stringify(String(pages[0].title || "").slice(0, 40)));
			return true;
		}
		last = a.map((x) => x && x.type);
		await new Promise((r) => setTimeout(r, 2000));
	}
	console.log("  [P0] ⚠️ page 目标未在预算内出现（" + budgetMs + "ms）· 末次目标类型=" + JSON.stringify(last));
	return false;
}

console.log("═══ P0 起点读数（19 号文 §7）═══");
const h = await ensureHarness({ port: Number(process.env.CDP_PORT || 9222), budgetMs: 180000 });
console.log("  [P0] Harness ⇒ " + JSON.stringify({ ok: h.ok, port: h.port, reused: h.reused, shifted: h.shifted, why: h.why || "" }));
if (!h.ok) {
	console.log("  [P0] 🔴 Harness 未就绪 ⇒ 真机判据**当前不可执行**（纪律 18：可分辨跳过，不静默）");
	console.log("IS_PASS: FALSE（INVALID · Harness 未就绪：" + (h.why || "未知") + "）");
	process.exit(2);
}

const env = Object.assign({}, process.env, { CDP_PORT: String(h.port) });

/* 🔴 先等 page（否则套件会立刻 INVALID，把"还没建窗口"读成"环境不成立"） */
const pageOk = await waitPageTarget(h.port, 180000);
if (!pageOk) {
	console.log("IS_PASS: FALSE（INVALID · 有 CDP 但无 page 目标）");
	process.exit(2);
}

const rows = [];
let anyInvalid = false;
let anyFail = false;

for (const s of SUITES) {
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [join(HERE, s)], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: env });
	const text = String(r.stdout || "") + String(r.stderr || "");
	const file = join(OUT, "_p0-" + s.replace(/\.mjs$/, "") + ".txt");
	writeFileSync(file, text, "utf8");

	const g = (re) => { const m = re.exec(text); return m ? m[1] : "-"; };
	/* 🔴 状态判据 = **退出码**（纪律 31「报绿先审口径」· 本轮实测踩到）：
	 *    首版用 `/INVALID/.test(text)` ⇒ `verify-novel-split` 明明 108/108 且 exit 0，
	 *    却被判成 INVALID —— 因为套件输出里**合法地**出现「超时属 INVALID，不是产品失败」
	 *    这类**文档性提及**（NS-7d 的断言名）。
	 *    ⇒ 全局搜索关键字当状态 = 把"提到了这个词"读成"就是这个状态"。
	 *    权威顺序：退出码（0/1/2）> 尾部 `IS_PASS` 行（须**行首锚定**）。 */
	const invalid = r.status === 2 || /^IS_PASS: FALSE（INVALID/m.test(text);
	const pass = r.status === 0;
	if (invalid) anyInvalid = true;
	if (!invalid && !pass) anyFail = true;

	const row = {
		suite: s,
		pass: g(/真机验收：PASS (\d+)/),
		fail: g(/FAIL (\d+)/),
		total: g(/总计 (\d+)/),
		reused: g(/复用 (\d+) · 新建/),
		created: g(/复用 \d+ · 新建 (\d+)/),
		hostBefore: g(/宿主会话实测 (\d+) →/),
		hostAfter: g(/宿主会话实测 \d+ → (\d+)/),
		delta: g(/净增 (-?\d+)）/),
		treeAfter: g(/前 \d+ 行 → 后 (\d+) 行/),
		state: invalid ? "INVALID" : (pass ? "PASS" : "FAIL"),
		exit: r.status,
		ms: Date.now() - t0,
		file: file
	};
	rows.push(row);
	console.log("  " + s.padEnd(26)
		+ " " + row.state
		+ "  " + row.pass + "/" + row.total + (row.fail !== "-" ? "（FAIL " + row.fail + "）" : "")
		+ " ｜复用 " + row.reused + " · 新建 " + row.created
		+ " ｜宿主 " + row.hostBefore + "→" + row.hostAfter + "（净增 " + row.delta + "）"
		+ " ｜树 " + row.treeAfter
		+ " ｜exit " + row.exit + " ｜" + Math.round(row.ms / 1000) + "s");

	/* 红/INVALID 时把套件自己的失败行原样带出来（**不替它解释**，纪律 65） */
	if (!pass) {
		const lines = text.split(/\r?\n/).filter((l) => /^\s*(❌|⚠️|FAIL|INVALID)/.test(l) || /INVALID|超预算|无法/.test(l));
		lines.slice(0, 14).forEach((l) => console.log("      | " + l.trim().slice(0, 200)));
	}
}

console.log("\n─── P0 汇总 ───");
console.log("  Harness 端口：" + h.port + (h.reused ? "（复用现有实例）" : "（本脚本拉起）"));
console.log("  日志目录：" + OUT);
console.log("  " + (anyInvalid ? "⚠️ 存在 INVALID —— 属**环境不成立**，非产品失败（纪律 18）"
	: (anyFail ? "❌ 存在 FAIL —— 见上方套件原始失败行" : "✅ 两套件均全绿")));
console.log(anyInvalid || anyFail ? "IS_PASS: FALSE" : "IS_PASS: TRUE");
process.exit(anyInvalid ? 2 : (anyFail ? 1 : 0));
