#!/usr/bin/env node
/**
 * lint-syntax.mjs —— 全仓 **ESM 语法自检**（第十九批 · 2026-09-17）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它治的是什么（**同一坑踩了三次**）
 * ──────────────────────────────────────────────────────────────────
 *   症状：改完闸门脚本，跑起来直接
 *     `SyntaxError: missing ) after argument list`
 *   而**发现它的时刻**已经很晚 —— 一次是构建过后、一次是真机跑到第 3 分钟。
 *
 *   🔴 根因（有据）：**在中文引语里写了 ASCII 双引号**。
 *     例：`t("NS-13b", "…必须等于"挂上树 + 没挂上"）",`
 *     这里的 `"挂上树` 提前**终止了字符串** ⇒ 后面变成野表达式 ⇒ 语法错。
 *     ⚠️ 为什么"数引号奇偶"抓不到它：该行的引号总数**仍是偶数**（错误的引号成对出现）。
 *
 *   🔴 为什么现有的检查都漏了它：
 *     · `build/build.mjs` 的 `vm.Script` 自检只验**产物**（`lib/client.js`），
 *       而**闸门脚本不进产物** ⇒ 脚本里的语法错误它永远看不到；
 *     · `lint-undefined-symbols` 只管符号，不解析语法；
 *     · 于是唯一能发现它的地方就是"真机跑一遍" —— 用 3 分钟换 1 秒能查出的错。
 *
 * ══════════════════════════════════════════════════════════════════
 * 判据（**只做一件事：语法能不能解析**）
 * ──────────────────────────────────────────────────────────────────
 *   · `scripts/*.mjs` → 直接 `node --check`（Node 按 ESM 解析 `.mjs`）
 *   · `src/**\/*.js`   → 复制成同内容 `.mjs` 再 `node --check`
 *     （本仓 `src/**` 是 ESM 但后缀是 `.js` —— `node --check` 会按 CommonJS 解析
 *      而把 `import` 判成语法错 ⇒ 必须换后缀，**不能**直接对 `.js` 跑 `--check`）
 *
 * 🔴 本脚本**只解析、不执行**：零副作用、不连 CDP、不写盘（临时文件落在系统 temp 并在收尾删除）。
 * 🔴 它**不检查**"引号该用全角还是半角"这类风格问题 —— 那只在**字符串内部**才有意义，
 *    而"字符串内部出现未转义的双引号"**本身就是语法错**，会被 `--check` 直接抓出。
 *    ⇒ 不做正则启发式（启发式会误报 `'他说"你好"'` 这种**合法**写法，闸门一旦误报就没人信了）。
 *
 * 退出码：0 全通过 / 1 有语法错 / 2 用法错
 *   `--only=a,b` 只查名字含 a 或 b 的文件（排障用）
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ONLY = (() => {
	const a = process.argv.slice(2).find((x) => x.startsWith("--only="));
	return a ? a.slice("--only=".length).split(",").filter(Boolean) : [];
})();

/** 递归收集指定后缀的文件（跳过 .trash-* 与 node_modules） */
function collect(dir, ext, out = []) {
	let ents = [];
	try { ents = readdirSync(dir); } catch (e) { return out; }
	for (const name of ents) {
		if (name === "node_modules" || name.startsWith(".trash-") || name === "lib" || name === "build") continue;
		const p = join(dir, name);
		let st = null;
		try { st = statSync(p); } catch (e) { continue; }
		if (st.isDirectory()) collect(p, ext, out);
		else if (name.endsWith(ext)) out.push(p);
	}
	return out;
}

const targets = [
	...collect(join(ROOT, "scripts"), ".mjs"),
	...collect(join(ROOT, "src"), ".js")
].filter((p) => !ONLY.length || ONLY.some((k) => p.indexOf(k) >= 0));

const tmp = mkdtempSync(join(tmpdir(), "dsh-lint-syntax-"));

/**
 * 单文件语法检查。
 * 🔴 行号必须能取到 —— 这是本脚本存在的**唯一理由**（同一坑第四次踩时才发现：
 *    `.mjs` 直接对原文件 `--check` ⇒ stderr 里是 `verify-novel-split.mjs:1234`
 *    而不是 `probe-N.mjs:1234`，旧正则只认后者 ⇒ 行号恒为 null，等于没有）。
 * @returns {{ok:boolean, why?:string, line?:number|null, text?:string}}
 */
function checkFile(f, asmjs) {
	let probe = f;
	if (f.endsWith(".js")) {
		probe = join(tmp, "probe-" + Math.random().toString(36).slice(2) + ".mjs");
		try { writeFileSync(probe, readFileSync(f), "utf8"); }
		catch (e) { return { ok: false, why: "读取失败：" + String(e && e.message), line: null }; }
	}
	const r = spawnSync(process.execPath, ["--check", probe], { encoding: "utf8" });
	if (r.status === 0) return { ok: true };
	const txt = String(r.stderr || "").split("\n").filter(Boolean);
	const head = txt.find((s) => /SyntaxError/.test(s)) || txt[0] || "未知语法错";
	/* 🔴 认**任意** `.mjs:<行>`（probe-xxx.mjs 与直接检查的 .mjs 都覆盖） */
	const m = String(r.stderr || "").match(/\.mjs:(\d+)/);
	const line = m ? Number(m[1]) : null;
	/* 出错行的**原文**（闸门要能一眼看到是哪一句，而不是只知道一个行号） */
	let text = "";
	try {
		if (line) text = String(readFileSync(f, "utf8").split(/\r?\n/)[line - 1] || "").trim().slice(0, 180);
	} catch (e) { /* 读不到原文不影响"有语法错"这个结论 */ }
	return { ok: false, why: head.trim(), line: line, text: text, asmjs: !!asmjs };
}

/* ══════════ 植入缺陷自校准（纪律 32：新检查必植入缺陷校准）══════════
 * 🔴 为什么**默认就跑**：本检查的价值全在**行号可用**上。
 *    上一版因正则只认 `probe-N.mjs` ⇒ `.mjs` 的报错**永远没有行号**，
 *    而"没有行号"这件事**从成功输出里看不出来**（全绿时它只是没出现）。
 *    ⇒ 每次运行先自己对一个**已知坏样本**校准一次：必须报红 **且行号 == 3**。 */
const CAL_SRC = "const a = 1;\nconst b = [\n  \"他说\"你好\"\",\n];\n";
let calOk = false; let calWhy = "";
try {
	const calPath = join(tmp, "calib.mjs");
	writeFileSync(calPath, CAL_SRC, "utf8");
	const cr = checkFile(calPath, true);
	calOk = cr.ok === false && cr.line === 3;
	calWhy = cr.ok ? "坏样本被判为通过（检查失效）" : ("行号=" + cr.line + "（期望 3）");
} catch (e) { calWhy = "校准异常：" + String(e && e.message); }

const bad = [];
let checked = 0;
try {
	for (const f of targets) {
		const c = checkFile(f, f.endsWith(".js"));
		checked++;
		if (!c.ok) bad.push({ f: relative(ROOT, f).split(sep).join("/"), why: c.why, line: c.line, text: c.text });
	}
} finally {
	try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 临时目录清理失败不影响结论 */ }
}

console.log("═══════════════════════════════════════════════════════════");
console.log(" lint-syntax —— ESM 语法自检（只解析，不执行；零副作用）");
console.log(" 检查 " + checked + " 个文件（scripts/*.mjs + src/**/*.js）");
console.log(" 自校准（植入缺陷）：" + (calOk ? "✅ 坏样本被精确抓出" : "❌ " + calWhy));
console.log("═══════════════════════════════════════════════════════════");
if (!calOk) {
	console.log("\n❌ **自校准失败** —— 本检查已失效，结论不可信（纪律 32）");
	console.log("   " + calWhy);
	console.log("\nIS_PASS: FALSE");
	process.exit(1);
}
if (bad.length) {
	console.log("\n❌ 发现 " + bad.length + " 处**语法错**（跑到真机才炸的那一类）：\n");
	for (const b of bad) {
		console.log("  · " + b.f + (b.line ? "  行 " + b.line : "  ⚠️ 行号不可用"));
		if (b.text) console.log("      " + b.text);
		console.log("      " + b.why);
		console.log("      ⚠️ 最常见真因：**中文引语里写了 ASCII 双引号** ⇒ 提前终止字符串。");
		console.log("         修法：把引语引号换成「」或全角引号（数引号奇偶**抓不到**这种错）。");
	}
	console.log("\nIS_PASS: FALSE");
	process.exit(1);
}
console.log("\n✅ 全部解析通过（零语法错）");
console.log("IS_PASS: TRUE");
process.exit(0);
