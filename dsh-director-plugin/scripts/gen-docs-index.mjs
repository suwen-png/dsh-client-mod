#!/usr/bin/env node
/**
 * gen-docs-index.mjs — 生成插件侧文档索引 `assets/docs-index.json`
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么新写一个（而不是修 scripts/gen-docs-index.ps1）
 * ══════════════════════════════════════════════════════════════════
 *  旧生成器（`scripts/gen-docs-index.ps1`）是 **A14 剥离改造之前**的形态：
 *    · 它把 `const DSH_DOCS_INDEX = {...}` 用 IndexOf 手术**注入宿主 `workspace/.../client.js`**；
 *    · 它**不产出** `dsh-director-plugin/assets/docs-index.json`。
 *  而 A14 之后运行时的真相源已经是**外部资源** `assets/docs-index.json`
 *  （见 `src/store/docs-index-inject.js` 头注：宿主注入只是①号快路径，②号是 fetch 同级资源）。
 *  ⇒ 旧脚本既改不到宿主（也不该改，`workspace/**` 不可回滚），又产不出真正被读的那个文件。
 *
 *  本脚本只做一件事：**把 `docs/**\/*.md` 编成 `assets/docs-index.json`**。
 *  不碰宿主、不碰 `src/**`、不碰产物 `lib/client.js`。
 *
 * ── 与旧脚本保持一致的口径（避免"同一件事两套标准"）─────────────────
 *    · 单篇正文上限 `MAX_CHARS = 8000`（超出截断并标注 `…(截断)`）—— 与旧脚本同值
 *    · 键 = 相对 `docs/` 的 POSIX 路径（如 `00-统筹入口/03-待完成任务清单.md`）
 *    · `tree` = { 目录名: [文件名…] }（目录名是相对 `docs/` 的路径，顶层直接写目录名）
 *    · JSON 压缩（无缩进）、UTF-8 **无 BOM**、**LF** 行尾
 *
 * ── 判据（退出码 0/1/2；用法错必须能自诊断，不许崩成"产品坏了"）──────
 *   0 = 通过；1 = FAIL（扫描/写入本身失败）；2 = INVALID（用法错/根目录不对）
 *
 * 用法：
 *   node dsh-director-plugin/scripts/gen-docs-index.mjs            # 生成并写入
 *   node dsh-director-plugin/scripts/gen-docs-index.mjs --check    # 只对账，不写（闸门用）
 *   node dsh-director-plugin/scripts/gen-docs-index.mjs --root D:/hermes-data/dsh-client-mod
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 插件根 = scripts/.. */
const PLUGIN_ROOT = path.resolve(HERE, "..");
/** 仓库根 = 插件根/.. */
const DEFAULT_ROOT = path.resolve(PLUGIN_ROOT, "..");

/** 单篇正文上限（与旧 gen-docs-index.ps1 同值） */
export const MAX_CHARS = 8000;
/** 产物路径（相对插件根） */
export const OUT_REL = "assets/docs-index.json";
/** 索引版本号 */
export const INDEX_VERSION = 1;

/* ── 参数解析（用法错 → 打印可复制命令 + exit 2）──────────────────── */
function parseArgs(argv) {
	const o = { check: false, root: DEFAULT_ROOT, quiet: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--check") o.check = true;
		else if (a === "--quiet") o.quiet = true;
		else if (a === "--root") { o.root = argv[++i]; if (!o.root) return { err: "--root 后面缺少路径" }; }
		else if (a === "--help" || a === "-h") return { help: true };
		else return { err: "未知参数：" + a };
	}
	return o;
}

function usage(err) {
	if (err) console.error("✗ " + err);
	console.error("用法：");
	console.error("  node dsh-director-plugin/scripts/gen-docs-index.mjs            # 生成并写入");
	console.error("  node dsh-director-plugin/scripts/gen-docs-index.mjs --check    # 只对账，不写");
	console.error("  node dsh-director-plugin/scripts/gen-docs-index.mjs --root <项目根>");
	console.error("（可直接复制上面任一行运行；默认根 = " + DEFAULT_ROOT + "）");
	process.exit(2);
}

/* ── 扫描 ─────────────────────────────────────────────────────────── */
function walkMd(dir, out) {
	let entries;
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
	catch (e) { return out; }
	/* 排序：保证同一批文件每次生成的字节完全一致（构建可复现） */
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walkMd(full, out);
		else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(full);
	}
	return out;
}

/** 截断（字符数，与旧脚本一致） */
export function clipContent(s) {
	const t = String(s == null ? "" : s);
	return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) + "\n…(截断)" : t;
}

/**
 * 构建索引对象（**纯函数**，便于单测与 --check 对账）
 * @param {string} docsDir 绝对路径 docs/
 * @param {string} [now] generatedAt 覆盖值（测试用，保证可复现）
 */
export function buildIndex(docsDir, now) {
	const files = walkMd(docsDir, []);
	const docs = {};
	const tree = {};
	let totalBytes = 0;
	let newest = 0;
	for (const full of files) {
		const rel = path.relative(docsDir, full).split(path.sep).join("/");
		const dir = path.dirname(rel) === "." ? "." : path.dirname(rel).split(path.sep).join("/");
		const content = clipContent(fs.readFileSync(full, "utf8"));
		const st = fs.statSync(full);
		totalBytes += st.size;
		if (st.mtimeMs > newest) newest = st.mtimeMs;
		docs[rel] = { name: path.basename(full), dir, size: st.size, content };
		if (!tree[dir]) tree[dir] = [];
		tree[dir].push(path.basename(full));
	}
	return {
		index: {
			/* 🔴 generatedAt 取**源文件最新 mtime**（不是"当前时刻"）：
			 *    本文件在基线里（`baseline-check` 逐文件哈希）⇒ 若写"当前时刻"，
			 *    每次重跑都会改字节、基线无意义地漂移，且"同样输入产出同样字节"这条
			 *    （构建可复现性）就不成立。用 mtime 既仍能表达"索引的新鲜度"，
			 *    又保证**输入相同 ⇒ 输出逐字节相同**。 */
			generatedAt: now || fmtTime(newest),
			version: INDEX_VERSION,
			docCount: files.length,
			tree,
			docs
		},
		sourceFiles: files.length,
		sourceBytes: totalBytes
	};
}

/** 把 mtime（ms）格式化成 `YYYY-MM-DD HH:mm:ss`（本地时区） */
export function fmtTime(ms) {
	const d = new Date(ms || 0);
	const p = (n) => String(n).padStart(2, "0");
	return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
		+ " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

/* ── 主流程 ───────────────────────────────────────────────────────── */
function main() {
	const o = parseArgs(process.argv.slice(2));
	if (o.help) usage(null);
	if (o.err) usage(o.err);

	const root = path.resolve(o.root);
	const docsDir = path.join(root, "docs");
	const outPath = path.join(PLUGIN_ROOT, OUT_REL);

	if (!fs.existsSync(docsDir) || !fs.statSync(docsDir).isDirectory()) {
		usage("找不到 docs/ 目录：" + docsDir + "（用 --root 指定项目根）");
	}

	let built;
	try {
		built = buildIndex(docsDir);
	} catch (e) {
		console.error("✗ FAIL 扫描失败：" + ((e && e.message) || e));
		process.exit(1);
	}

	const json = JSON.stringify(built.index);
	const buf = Buffer.from(json, "utf8"); // 无 BOM

	if (o.check) {
		/* 只对账：把"磁盘实况"与"产物现状"摆在一起，不写盘 */
		let cur = null;
		try { cur = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch (e) { cur = null; }
		const curCount = cur && typeof cur.docCount === "number" ? cur.docCount : -1;
		const curKeys = cur && cur.docs && !Array.isArray(cur.docs) ? Object.keys(cur.docs).length : -1;
		console.log("══ 文档索引对账（只读）══");
		console.log("  磁盘 docs/**/*.md   : " + built.sourceFiles + " 篇 / " + built.sourceBytes + " B");
		console.log("  产物 docCount       : " + curCount);
		console.log("  产物 docs map 键数   : " + curKeys);
		const ok = curCount === built.sourceFiles && curKeys === built.sourceFiles;
		if (!ok) {
			console.log("  ⟹ **不一致**（差 " + (built.sourceFiles - curCount) + " 篇）");
			console.log("    修复：node dsh-director-plugin/scripts/gen-docs-index.mjs");
		} else {
			console.log("  ⟹ 一致 ✅");
		}
		console.log("IS_PASS: " + (ok ? "TRUE" : "FALSE"));
		process.exit(ok ? 0 : 1);
	}

	try {
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, buf);
	} catch (e) {
		console.error("✗ FAIL 写入失败：" + ((e && e.message) || e));
		process.exit(1);
	}

	if (!o.quiet) {
		console.log("══ 文档索引已生成 ══");
		console.log("  " + OUT_REL);
		console.log("  文档 " + built.index.docCount + " 篇 · 分组 " + Object.keys(built.index.tree).length + " 个"
			+ " · JSON " + json.length + " B · 源文件 " + built.sourceBytes + " B");
		console.log("  generatedAt " + built.index.generatedAt);
	}
	process.exit(0);
}

/* 仅在被直接执行时跑主流程（被 import 时不跑，便于测试复用 buildIndex） */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE, "gen-docs-index.mjs")) {
	main();
}
