/**
 * baseline-check.mjs —— 「落死基线」指纹校验（V16）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它（这是用户"把这一版落死"诉求的技术落地）
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：
 *   「把这一版落死 —— 我希望无论再怎么改、多开多少对话，还是能读到现在的代码和设计图」
 *
 * 光写一份"基线文档"是不够的：文档会**悄悄过期** —— 代码改了、文档没改，
 * 下一个对话读到的是**描述**而不是**事实**，于是又开始"重画界面"的历史循环。
 * 所以这里把基线做成**指纹**：源码 + 构建脚本 + 设计稿 + 契约文件逐文件 md5，
 * 落在 `BASELINE.lock.json`。任何对话只要跑一次本脚本，就能得到两种确定结论之一：
 *   ✅ 与落死基线**逐字节一致** ⇒ 文档里写的就是代码里的事实，可以放心照读；
 *   ❌ 已漂移 ⇒ 直接列出**哪几个文件**变了，必须同步更新基线文档后才算完。
 *
 * 用法：
 *   node scripts/baseline-check.mjs            # 校验（漂移 → 退出码 1）
 *   node scripts/baseline-check.mjs --write    # 重新封存（明确知道在改基线时用）
 *   node scripts/baseline-check.mjs --json     # 机器可读输出
 *
 * 覆盖范围（刻意**不含** scripts/*.mjs 与 docs/*.md）：
 *   scripts/ 会随每个新闸门增长、docs/ 是叙述 —— 把叙述纳入指纹会让"改文档"也报漂移，
 *   反而逼人绕过校验。**指纹只锁"会决定运行行为的东西"**：
 *     src/**            —— 全部运行时代码
 *     build/**          —— 构建脚本（决定产物）
 *     package.json      —— 包身份（host Loader 靠它发现本包）
 *     cordis.patch.yml  —— 用户补丁层 entry（决定插件是否被装载）
 *     lib/client.js     —— 构建产物（证明"源码 → 产物"可复现）
 *     ../docs/50-信息中心/V16-*.html —— 设计图本体（本次落死的另一半）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");                 // dsh-director-plugin/
const ROOT = join(PKG, "..");                 // dsh-client-mod/
const LOCK = join(PKG, "BASELINE.lock.json");

const WRITE = process.argv.includes("--write");
const JSON_OUT = process.argv.includes("--json");

/** 逐文件指纹范围：目录 → 扩展名过滤（null = 全收） */
const SCOPE = [
	["src", ".js"],
	["build", null],
	["..docs/50-信息中心", ".html", /^V16-.*\.html$/],  // 设计图本体，按前缀白名单
	["__files", null]  // 下面单独补的单文件
];
/** 单文件（路径相对 PKG） */
const SINGLE_FILES = [
	"package.json",
	"cordis.patch.yml",
	"lib/client.js"
];

const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const norm = (p) => p.split("\\").join("/");

/** 递归收集目录内文件（相对 PKG 的 posix 路径） */
function walk(absDir, ext, nameRe, out) {
	if (!existsSync(absDir)) return out;
	for (const name of readdirSync(absDir).sort()) {
		const abs = join(absDir, name);
		const st = statSync(abs);
		if (st.isDirectory()) {
			if (name === "node_modules" || name === ".git") continue;
			walk(abs, ext, nameRe, out);
			continue;
		}
		if (ext && !name.endsWith(ext)) continue;
		if (nameRe && !nameRe.test(name)) continue;
		out.push(abs);
	}
	return out;
}

function collect() {
	const abs = [];
	for (const [dir, ext, nameRe] of SCOPE) {
		if (dir === "__files") continue;
		walk(join(PKG, dir), ext, nameRe, abs);
	}
	for (const f of SINGLE_FILES) abs.push(join(PKG, f));
	const map = {};
	for (const a of abs) {
		if (!existsSync(a)) continue;
		const buf = readFileSync(a);
		// 键用「相对 PKG」的正斜杠路径，保证跨机器/跨平台可比
		map[norm(relative(PKG, a))] = { bytes: buf.length, md5: md5(buf) };
	}
	return map;
}

const now = collect();
const keys = Object.keys(now).sort();

if (WRITE || !existsSync(LOCK)) {
	const firstTime = !existsSync(LOCK);
	const prevLock = firstTime ? null : JSON.parse(readFileSync(LOCK, "utf8"));
	let diffNote = "";
	if (prevLock && prevLock.files) {
		const pf = prevLock.files;
		const add = keys.filter((k) => !pf[k]);
		const rem = Object.keys(pf).filter((k) => !now[k]);
		const chg = keys.filter((k) => pf[k] && pf[k].md5 !== now[k].md5);
		diffNote = "\n   本次相对上一锁：新增 " + add.length + " · 删除 " + rem.length + " · 修改 " + chg.length +
			"\n   上一锁封存于 " + prevLock.sealedAt;
	}
	const lock = {
		sealedAt: new Date().toISOString(),
		version: "V16",
		title: "总监驾驶舱 · 三页签 + 设计图工作室（落死基线）",
		policy: "指纹只锁会决定运行行为的东西（src/build/package.json/cordis.patch.yml/产物/设计图）。scripts/*.mjs 与 docs/*.md 属叙述层，不纳入。",
		command: "node scripts/baseline-check.mjs   # 校验；--write 重新封存",
		fileCount: keys.length,
		totalBytes: keys.reduce((s, k) => s + now[k].bytes, 0),
		files: now
	};
	writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n", "utf8");
	if (JSON_OUT) { console.log(JSON.stringify({ sealed: true, fileCount: lock.fileCount, totalBytes: lock.totalBytes })); }
	else {
		console.log("🔒 " + (firstTime ? "已封存基线指纹（首次）" : "已重新封存基线指纹") + " → " + norm(relative(ROOT, LOCK)));
		console.log("   文件数 " + lock.fileCount + " · 合计 " + lock.totalBytes + " B" + diffNote);
		console.log("   ⚠️ 重新封存 = 基线已前移 —— 请确认 docs/00-统筹入口/10-当前基线-落死锚点-V16.md 已同步更新。");
	}
	process.exit(0);
}

const lock = JSON.parse(readFileSync(LOCK, "utf8"));
const old = lock.files || {};
const added = keys.filter((k) => !old[k]);
const removed = Object.keys(old).filter((k) => !now[k]);
const changed = keys.filter((k) => old[k] && old[k].md5 !== now[k].md5);
const same = keys.filter((k) => old[k] && old[k].md5 === now[k].md5);
const drift = added.length + removed.length + changed.length;

const payload = {
	pass: drift === 0,
	sealedAt: lock.sealedAt,
	version: lock.version,
	fileCount: { sealed: lock.fileCount, now: keys.length },
	same: same.length, added, removed,
	changed: changed.map((k) => ({ file: k, bytes: old[k].bytes + " → " + now[k].bytes, md5: old[k].md5.slice(0, 8) + " → " + now[k].md5.slice(0, 8) }))
};

if (JSON_OUT) { console.log(JSON.stringify(payload, null, 2)); }
else {
	console.log("════════════════════════════════════════════════════════════");
	console.log(" 落死基线指纹校验（" + lock.version + " · 封存于 " + lock.sealedAt + "）");
	console.log("════════════════════════════════════════════════════════════");
	console.log("  一致 " + same.length + " / " + keys.length + " 个文件");
	if (added.length) console.log("  ➕ 新增 " + added.length + "：" + added.join("、"));
	if (removed.length) console.log("  ➖ 删除 " + removed.length + "：" + removed.join("、"));
	if (changed.length) {
		console.log("  ✏️  修改 " + changed.length + "：");
		for (const c of payload.changed) console.log("       " + c.file + "   " + c.bytes + " B   " + c.md5);
	}
	console.log("");
	if (drift === 0) {
		console.log("  ⇒ 与落死基线**逐字节一致**：文档所述即代码事实，可放心照读。");
	} else {
		console.log("  ⇒ 已偏离落死基线。**必须同步更新**基线文档后才算完成：");
		console.log("     docs/00-统筹入口/10-当前基线-落死锚点-V16.md");
		console.log("     确认无误后重新封存：node scripts/baseline-check.mjs --write");
	}
	console.log("IS_PASS: " + (drift === 0 ? "TRUE" : "FALSE") + "（漂移=" + drift + "）");
}
process.exit(drift === 0 ? 0 : 1);
