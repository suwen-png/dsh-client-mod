#!/usr/bin/env node
/**
 * gen-key-files.mjs — 由 `src/**` 的 `@map:` 头生成 `src/logic/key-files.js`
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么要有它（用户原话 · 2026-09-14 第 5 批）
 * ══════════════════════════════════════════════════════════════════
 *  「r4的关键文件放到r7, 变成 关键文件/产出物」
 *  「r4和r7对应的功能完善掉, 指向的文档逻辑固定」
 *
 *  改前 R7 没有「关键文件」；改前 R4 的「关键文件」是**一句写死的说明文字**：
 *    「直接指向改代码时最常动的文件（client-entry / mount / DirectorDialog / DesignStudio / MindMap）」
 *    —— 不可点、不随项目变化、**无法验证**（三个名字硬编码在 JSX 里）。
 *
 *  ⇒ 本脚本把「关键文件」**固定**为一份**生成式**数据：
 *      来源 = `src/**\/*.js` 各自的 `@map:` 头（职责 / 上游 / 下游）+ 真实 `bytes` / `lines`。
 *      产物 = `src/logic/key-files.js`（纯数据模块，被 DirectorPage 消费）。
 *    这样"名单"与"数字"都不再是手写的，而是**从源码现算**。
 *
 * ── 判据（退出码 0/1/2）────────────────────────────────────────────
 *   0 = 通过（默认：生成并写入；`--check`：与磁盘一致）
 *   1 = FAIL（磁盘上的 @map 与产物不一致 / 扫描或写入失败）
 *   2 = INVALID（用法错 —— 打印可复制命令，不崩栈）
 *
 * 用法：
 *   node dsh-director-plugin/scripts/gen-key-files.mjs           # 生成并写入
 *   node dsh-director-plugin/scripts/gen-key-files.mjs --check   # 只对账，不写
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..");
const SRC_DIR = path.join(PLUGIN_ROOT, "src");
const OUT_PATH = path.join(SRC_DIR, "logic", "key-files.js");

/** 只收录带 @map 的模块（没有 @map 的说明它没纳入源码映射，收了反而误导） */
function walkJs(dir, out) {
	let entries;
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walkJs(full, out);
		else if (e.isFile() && e.name.endsWith(".js")) out.push(full);
	}
	return out;
}

/** 从源码文本里取 @map 头的四个字段 */
export function readMapHeader(text) {
	const block = String(text).match(/@map:begin[\s\S]*?@map:end/);
	if (!block) return null;
	const grab = (k) => {
		const m = block[0].match(new RegExp("\\*\\s*" + k + "：(.+)"));
		return m ? m[1].trim() : "";
	};
	return { duty: grab("职责"), up: grab("上游"), down: grab("下游") };
}

/** 构建关键文件表（纯函数：输入 src 目录，输出数组 + 合计） */
export function buildKeyFiles(srcDir) {
	const rows = [];
	for (const full of walkJs(srcDir, [])) {
		/* 🔴 排除自身：本生成器的产物也在 src/** 下，若把自己收进去，
		 *    则"文件字节数"会因为"记了自己多大"而每次生成都变 ⇒
		 *    `--check` **永远报不一致**（自指悖论，不是漂移）。 */
		if (path.resolve(full) === path.resolve(OUT_PATH)) continue;
		const text = fs.readFileSync(full, "utf8");
		const h = readMapHeader(text);
		if (!h) continue;
		rows.push({
			f: "src/" + path.relative(srcDir, full).split(path.sep).join("/"),
			bytes: Buffer.byteLength(text, "utf8"),
			lines: text.split("\n").length,
			duty: h.duty,
			up: h.up,
			down: h.down
		});
	}
	/* 排序：字节降序（"最常动 / 最重"的模块排前面）；同字节按路径升序保证可复现 */
	rows.sort((a, b) => (b.bytes - a.bytes) || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
	const total = rows.reduce((acc, r) => ({ modules: acc.modules + 1, bytes: acc.bytes + r.bytes, lines: acc.lines + r.lines }), { modules: 0, bytes: 0, lines: 0 });
	return { rows, total };
}

/** 渲染成 ES 模块源码（**禁反引号**：项目纪律 —— 构建模板串内禁反引号） */
export function renderModule(built) {
	const L = [];
	L.push("/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）");
	L.push(" * 职责：关键文件表（R7「关键文件」Tab 的唯一数据源，**生成式**，勿手改）");
	L.push(" * 引用：—");
	L.push(" * 上游：components/DirectorPage.js");
	L.push(" * 下游：（无）");
	L.push(" * 设计稿：docs/50-信息中心/V19-界面调整设计稿.html（板块 H / I）");
	L.push(" * 索引：dsh-director-plugin/docs/12-源码映射索引.md");
	L.push(" * @map:end */");
	L.push("/**");
	L.push(" * logic/key-files.js — 关键文件表（**生成式**）");
	L.push(" *");
	L.push(" * 🔴 本文件由脚本生成，**不要手改** —— 手改会被下一次生成覆盖，而且它是");
	L.push(" *    \"数字与事实同源\"这条纪律的载体：名单/字节/行数全部来自 src/** 的 @map 头。");
	L.push(" *");
	L.push(" * 重新生成：");
	L.push(" *   node dsh-director-plugin/scripts/gen-key-files.mjs");
	L.push(" * 只对账（不写盘，闸门用）：");
	L.push(" *   node dsh-director-plugin/scripts/gen-key-files.mjs --check");
	L.push(" *");
	L.push(" * 字段：");
	L.push(" *   f     相对插件根的源码路径");
	L.push(" *   bytes 文件真实字节数（UTF-8）");
	L.push(" *   lines 行数（按 \\n 切）");
	L.push(" *   duty  该模块的职责（抄自它自己的 @map 头）");
	L.push(" *   up    上游（谁引用它）");
	L.push(" *   down  下游（它引用谁）");
	L.push(" */");
	L.push("");
	L.push("/** 关键文件表（字节降序） */");
	L.push("export const KEY_FILES = Object.freeze([");
	L.push("\t// prettier-ignore");
	for (const r of built.rows) {
		L.push("\t{ f: " + JSON.stringify(r.f) + ", bytes: " + r.bytes + ", lines: " + r.lines
			+ ", duty: " + JSON.stringify(r.duty) + ", up: " + JSON.stringify(r.up) + ", down: " + JSON.stringify(r.down) + " },");
	}
	L.push("]);");
	L.push("");
	L.push("/** 合计（闸门据此对账，避免各自为政） */");
	L.push("export const KEY_FILES_TOTAL = Object.freeze({ modules: " + built.total.modules
		+ ", bytes: " + built.total.bytes + ", lines: " + built.total.lines + " });");
	L.push("");
	L.push("export default KEY_FILES;");
	L.push("");
	return L.join("\n");
}

function parseArgs(argv) {
	const o = { check: false };
	for (const a of argv) {
		if (a === "--check") o.check = true;
		else if (a === "--help" || a === "-h") return { help: true };
		else return { err: "未知参数：" + a };
	}
	return o;
}

function usage(err) {
	if (err) console.error("✗ " + err);
	console.error("用法：");
	console.error("  node dsh-director-plugin/scripts/gen-key-files.mjs           # 生成并写入");
	console.error("  node dsh-director-plugin/scripts/gen-key-files.mjs --check   # 只对账，不写");
	process.exit(2);
}

function main() {
	const o = parseArgs(process.argv.slice(2));
	if (o.help) usage(null);
	if (o.err) usage(o.err);
	if (!fs.existsSync(SRC_DIR)) usage("找不到 src/：" + SRC_DIR);

	let built;
	try { built = buildKeyFiles(SRC_DIR); }
	catch (e) { console.error("✗ FAIL 扫描失败：" + ((e && e.message) || e)); process.exit(1); }

	const next = renderModule(built);

	if (o.check) {
		let cur = null;
		try { cur = fs.readFileSync(OUT_PATH, "utf8"); } catch (e) { cur = null; }
		if (cur === null) {
			console.log("══ 关键文件表对账 ══");
			console.log("  产物不存在：" + path.relative(PLUGIN_ROOT, OUT_PATH));
			console.log("  修复：node dsh-director-plugin/scripts/gen-key-files.mjs");
			console.log("IS_PASS: FALSE");
			process.exit(1);
		}
		const same = cur === next;
		console.log("══ 关键文件表对账（只读）══");
		console.log("  磁盘 src/** 带 @map 模块 : " + built.total.modules + " 个 / " + built.total.bytes + " B / " + built.total.lines + " 行");
		if (!same) {
			/* 逐条指出差在哪 —— 只说"不一致"等于没说 */
			const curLines = cur.split("\n"), nextLines = next.split("\n");
			let diff = 0;
			for (let i = 0; i < Math.max(curLines.length, nextLines.length); i++) {
				if (curLines[i] !== nextLines[i]) { diff++; if (diff <= 3) console.log("  差异行 " + (i + 1) + ":\n    产物: " + String(curLines[i]).slice(0, 120) + "\n    磁盘: " + String(nextLines[i]).slice(0, 120)); }
			}
			console.log("  ⟹ **不一致**（" + diff + " 行差异）");
			console.log("    修复：node dsh-director-plugin/scripts/gen-key-files.mjs");
		} else {
			console.log("  ⟹ 一致 ✅");
		}
		console.log("IS_PASS: " + (same ? "TRUE" : "FALSE"));
		process.exit(same ? 0 : 1);
	}

	try { fs.writeFileSync(OUT_PATH, next); }
	catch (e) { console.error("✗ FAIL 写入失败：" + ((e && e.message) || e)); process.exit(1); }
	console.log("══ 关键文件表已生成 ══");
	console.log("  src/logic/key-files.js");
	console.log("  模块 " + built.total.modules + " 个 · " + built.total.bytes + " B · " + built.total.lines + " 行 · 产物 " + Buffer.byteLength(next, "utf8") + " B");
	process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE, "gen-key-files.mjs")) main();
