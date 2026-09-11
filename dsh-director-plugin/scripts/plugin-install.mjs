#!/usr/bin/env node
/**
 * plugin-install.mjs — dsh-director-plugin 安装单元（T-PLUG-008）
 *
 * 把本插件按 Harness 官方 client 插件通道安装到**三处**（缺一不可）：
 *
 *   ① <Harness>/resources/host/node_modules/@deepseek-ai/dsh-director-plugin/
 *        实体包（host face `lib/index.js` + client bundle `lib/client.js` + `assets/`）
 *   ② ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-director-plugin
 *        目录 junction → ①（供 `createRequire(ctx.baseUrl)` 从 profile 侧解析）
 *   ③ ~/.dsh/profiles/web/cordis.patch.yml
 *        用户补丁层，`insert` 一个 entry `deepseek-ai.director` 把 host face 挂进 loader 树
 *
 * 用法
 *   node scripts/plugin-install.mjs                 # 默认：只检查（verify，零写入）
 *   node scripts/plugin-install.mjs --apply         # 实际安装（幂等，不删任何东西）
 *   node scripts/plugin-install.mjs --uninstall     # 卸载 ②③（保留 ①）
 *   node scripts/plugin-install.mjs --uninstall --purge  # 连 ① 一起删
 *   node scripts/plugin-install.mjs --harness "<path>"   # 指定 Harness 根目录
 *   node scripts/plugin-install.mjs --profile-root "<path>"  # 指定 profile 根（默认 ~/.dsh，供干净目录模拟）
 *
 * 干净目录验收（T-PLUG-008「双机模拟：干净目录 → apply → 重启即用」）：
 *   node scripts/verify-install-clean.mjs          # 临时沙箱跑完整生命周期，不触碰真实环境
 *
 * 退出码：0 = 成功/已就绪；1 = 失败
 *
 * ── 设计取舍（为什么是 Node 不是 PowerShell）────────────────────────────
 * 1. 本机 PowerShell 通道无输出（工作区既有记录），脚本无法自证；
 *    Node 版可直接 `node script.mjs --verify` 拿到可 grep 的结果。
 * 2. 仓库既有工具链（build / verify-* / cdp-*）**全部是 `node scripts/*.mjs`**，
 *    安装单元并入同一条通道，避免第二套心智模型。
 * 3. 目录 junction 用 `fs.symlinkSync(target, path, "junction")`，Windows 下**免管理员**。
 *
 * ── 🔴 三条硬纪律 ────────────────────────────────────────────────────
 * A. **默认零写入**。不带 `--apply` / `--uninstall` 时只读检查，任何路径都不改。
 * B. **幂等**。已就绪则报告 "unchanged"，不重写、不重复插入 ③ 的 entry。
 * C. **绝不删第三方内容**。③ 是**共享**的用户补丁层，卸载时只做**外科式**移除
 *    本插件那一个 insert entry，其余原样保留（历史教训：`scripts/deploy.ps1` 会误删
 *    `Network` 缓存目录，属典型的「顺手多删」缺陷）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, lstatSync, rmSync, symlinkSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");

/* ── 常量：与 package.json / cordis.patch.yml 必须一致，改一处要改三处 ── */
const PKG_NAME = "@deepseek-ai/dsh-director-plugin";
const ENTRY_ID = "deepseek-ai.director";
/** 需要安装的文件（= package.json 的 `files` 字段 + `package.json` 自身）
 *  🔴 `package.json` **必须**在内：host Loader 靠它发现本包并读 `dsh.client` 声明
 *     （`dsh-client-modules` 扫描 host Loader entries 中声明 `dsh.client` 的包）。
 *     缺它 ⇒ 干净机器上「① 目录存在但插件不被发现」，且本脚本的 `hostState`
 *     会**永远停在 missing**（状态判据就是该文件），verify 永不通过。 */
const PAYLOAD_FILES = ["package.json", "lib/index.js", "lib/client.js", "cordis.patch.yml", "README.md", "INSTALL.md"];
const PAYLOAD_DIRS = ["assets"];

/* ── 参数 ── */
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const optVal = (f, d) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };

const MODE = has("--uninstall") ? "uninstall" : (has("--apply") ? "apply" : "verify");
const PURGE = has("--purge");
const HARNESS_ROOT = optVal("--harness", process.env.DSH_HARNESS_ROOT
	|| "D:/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness");
/** 🔴 可重定向 profile 根（默认 `~/.dsh`）。**只为干净目录模拟**，让「双机部署」验收
 *    能在临时沙箱里跑完 `--apply` 全链路而**不触碰真实用户环境**。 */
const PROFILE_ROOT = optVal("--profile-root", process.env.DSH_PROFILE_ROOT || join(homedir(), ".dsh"));

let fail = 0;
const log = (s) => console.log(s);
const ok = (s) => log(`  ✅ ${s}`);
const warn = (s) => log(`  ⚠️  ${s}`);
const bad = (s) => { fail++; log(`  ❌ ${s}`); };
const info = (s) => log(`     ${s}`);

/** 三处安装点的绝对路径 */
const T = {
	/** ① 实体包 */
	host: join(HARNESS_ROOT, "resources", "host", "node_modules", ...PKG_NAME.split("/")),
	/** ② profile 侧 junction */
	profile: join(PROFILE_ROOT, "profiles", "node_modules", ...PKG_NAME.split("/")),
	/** ③ 用户补丁层 */
	patch: join(PROFILE_ROOT, "profiles", "web", "cordis.patch.yml")
};

/** 我们期望写入 ③ 的那段 entry（块级匹配用，便于外科式移除） */
const PATCH_BLOCK = `- insert:\n    - id: ${ENTRY_ID}\n      name: '${PKG_NAME}'`;

console.log("========================================");
console.log(" dsh-director-plugin 安装单元（T-PLUG-008）");
console.log(` 模式: ${MODE}${MODE === "uninstall" && PURGE ? " (+purge)" : ""}`);
console.log(` Harness: ${HARNESS_ROOT}`);
console.log("========================================\n");

/* ══════════════════════════════════════════════════════════════════
 * 前置检查
 * ══════════════════════════════════════════════════════════════════ */
log("[1] 前置检查");
ok(`包根目录存在：${PKG_ROOT}`);
if (!existsSync(HARNESS_ROOT)) {
	bad(`Harness 根目录不存在：${HARNESS_ROOT}（用 --harness "<path>" 指定）`);
} else {
	ok("Harness 根目录存在");
}
const missingSrc = [...PAYLOAD_FILES, ...PAYLOAD_DIRS].filter((f) => !existsSync(join(PKG_ROOT, f)));
if (missingSrc.length) bad(`仓库内缺少待安装文件：${missingSrc.join(", ")}（先跑 node build/build.mjs）`);
else ok(`待安装清单齐全（${PAYLOAD_FILES.length} 个文件 + ${PAYLOAD_DIRS.length} 个目录）`);
if (fail) { log("\n前置检查未通过，中止。"); process.exit(1); }

/* ══════════════════════════════════════════════════════════════════
 * 状态探查
 * ══════════════════════════════════════════════════════════════════ */
log("\n[2] 安装点状态");

const hostPkgJson = join(T.host, "package.json");
const hostClient = join(T.host, "lib", "client.js");
const srcClient = join(PKG_ROOT, "lib", "client.js");

/** ① 实体包 */
let hostState = "missing";
if (existsSync(hostPkgJson)) {
	const same = existsSync(hostClient) && readFileSync(hostClient).equals(readFileSync(srcClient));
	hostState = same ? "current" : "stale";
}
info(`① 实体包        ${T.host}  -> ${hostState}`);
if (hostState === "current") ok("① 已就绪且 `lib/client.js` 与仓库**逐字节一致**");
else if (hostState === "stale") warn("① 存在但 `lib/client.js` 与仓库不一致（需 --apply 覆盖）");
else ok("① 尚未安装（属正常，--apply 会创建）");

/** ② profile junction */
let profileState = "missing";
if (existsSync(T.profile)) {
	const lst = lstatSync(T.profile);
	// 注意：junction 在 Node 里 `isSymbolicLink()` 为 true（Windows junction 归入 symlink 类）
	profileState = lst.isSymbolicLink() ? "link" : "dir";
}
info(`② profile 链接  ${T.profile}  -> ${profileState}`);
if (profileState === "link") ok("② 已是指向实体包的链接");
else if (profileState === "dir") warn("② 是**实体目录**而非链接（历史手工安装残留，建议 --apply 时人工确认）");
else ok("② 尚未创建（--apply 会创建 junction）");

/** ③ 用户补丁层 */
let patchState = "missing";
let patchText = "";
if (existsSync(T.patch)) {
	patchText = readFileSync(T.patch, "utf8");
	patchState = patchText.includes(`id: ${ENTRY_ID}`) ? "has-entry" : "no-entry";
}
info(`③ 用户补丁层    ${T.patch}  -> ${patchState}`);
if (patchState === "has-entry") ok(`③ 已含 entry \`${ENTRY_ID}\``);
else if (patchState === "no-entry") warn("③ 存在但**缺**本插件的 insert entry（--apply 会追加）");
else warn("③ 不存在（--apply 会创建；注意 profile 目录需已存在）");

/* ── 综合判定 ── */
const allReady = hostState === "current" && profileState === "link" && patchState === "has-entry";
log(`\n  ⇒ 总判定：${allReady ? "✅ 已完整就绪" : "⚠️ 未就绪（见上）"}`);

if (MODE === "verify") {
	log("\n（verify 模式：零写入。要安装请加 --apply）");
	log(`\nIS_PASS: ${allReady && fail === 0 ? "TRUE" : "FALSE"}（fail=${fail}）`);
	process.exit(allReady && fail === 0 ? 0 : 1);
}

/* ══════════════════════════════════════════════════════════════════
 * 卸载
 * ══════════════════════════════════════════════════════════════════ */
if (MODE === "uninstall") {
	log("\n[3] 卸载");

	// ③ 先做（外科式移除 entry，保留其余内容）
	if (patchState === "has-entry") {
		/* 🔴 只移除**本插件那一个 entry**，其余补丁层内容原样保留。
		 *    优先整块精确匹配（--apply 写入的就是这个字面量）；
		 *    不匹配（用户手工改过缩进/引号）则退化为行级移除：
		 *    删 `- insert:` + `- id: <ENTRY_ID>` + 紧随的 `name:` 三行。 */
		let out = patchText;
		let removed = 0;
		if (out.includes(PATCH_BLOCK)) {
			out = out.replace(PATCH_BLOCK, "");
			removed = 1;
		} else {
			const lines = patchText.split(/\r?\n/);
			const kept = [];
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].trim() === "- insert:" && (lines[i + 1] || "").trim() === `- id: ${ENTRY_ID}`) {
					i += 1;                                                        // 跳过 id 行
					if ((lines[i + 1] || "").trim().startsWith("name:")) i += 1;   // 跳过 name 行（若有）
					removed++;
					continue;
				}
				kept.push(lines[i]);
			}
			out = kept.join("\n");
		}
		out = out.replace(/\n{3,}/g, "\n\n");
		/* 🔴 移除后若已无任何实质条目，必须留一个**显式空列表** `[]`：
		 *    YAML 中「只有注释」会解析成 `null`，而本文件顶层契约是**数组**
		 *    （见文件头注释「语法：顶层 YAML 数组」）⇒ 留 `null` 有被 loader 拒绝的风险。
		 *    `[]` 才是「零个 patch」的正确表达。
		 *    该缺陷由 uninstall → apply 往返测试**实测发现**（改前实测：非注释非空行数 = 0）。 */
		const meaningful = out.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
		if (meaningful.length === 0) {
			out = out.replace(/\s*$/, "\n") + "[]\n";
			ok("③ 移除后已无条目 → 留显式空列表 `[]`（顶层契约为数组；纯注释会被解析成 null）");
		}
		writeFileSync(T.patch, out, "utf8");
		const back = readFileSync(T.patch, "utf8");
		if (!back.includes(`id: ${ENTRY_ID}`)) ok(`③ 已移除 entry \`${ENTRY_ID}\`（${removed} 处）并回读校验通过，其余内容原样保留`);
		else bad("③ 移除后回读仍能找到 entry");
	} else {
		ok("③ 无需处理（本无 entry）");
	}

	// ② 仅移除链接，绝不递归删实体包
	if (profileState === "link") {
		rmSync(T.profile, { force: true });
		ok("② 已移除 profile 链接（**未**触碰指向的实体包）");
	} else {
		ok("② 无需处理");
	}

	// ① 仅在显式 --purge 时删
	if (PURGE) {
		if (existsSync(T.host)) { rmSync(T.host, { recursive: true, force: true }); ok("① 已删除实体包（--purge）"); }
		else ok("① 本就不存在");
	} else {
		info(`① 保留实体包（未加 --purge）。如需删除：node scripts/plugin-install.mjs --uninstall --purge`);
	}

	log("\n卸载完成。**重启 Harness 后生效**。");
	log(`IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}（fail=${fail}）`);
	process.exit(fail === 0 ? 0 : 1);
}

/* ══════════════════════════════════════════════════════════════════
 * 安装（--apply）
 * ══════════════════════════════════════════════════════════════════ */
log("\n[3] 安装");

/* ① 实体包：逐文件复制，逐文件回读校验（🔴 写后必回读） */
mkdirSync(join(T.host, "lib"), { recursive: true });
let copied = 0;
let unchanged = 0;
const verifyList = [];
for (const rel of PAYLOAD_FILES) {
	const s = join(PKG_ROOT, rel);
	const d = join(T.host, rel);
	const same = existsSync(d) && readFileSync(d).equals(readFileSync(s));
	mkdirSync(dirname(d), { recursive: true });
	copyFileSync(s, d);
	if (same) unchanged++; else copied++;
	verifyList.push([rel, readFileSync(d).equals(readFileSync(s))]);
}
for (const dir of PAYLOAD_DIRS) {
	const s = join(PKG_ROOT, dir);
	const d = join(T.host, dir);
	mkdirSync(d, { recursive: true });
	for (const f of readdirSync(s)) {
		const sp = join(s, f);
		if (!statSync(sp).isFile()) continue;
		const dp = join(d, f);
		const same = existsSync(dp) && readFileSync(dp).equals(readFileSync(sp));
		copyFileSync(sp, dp);
		if (same) unchanged++; else copied++;
		verifyList.push([`${dir}/${f}`, readFileSync(dp).equals(readFileSync(sp))]);
	}
	verifyList.push([`${dir}/`, true]);
}
const badVerify = verifyList.filter(([, okv]) => !okv);
if (badVerify.length) bad(`① 回读校验失败：${badVerify.map(([f]) => f).join(", ")}`);
else ok(`① 实体包已写入并**逐文件回读校验通过**（新写入 ${copied} / 内容未变 ${unchanged}）`);

/* ② profile junction */
mkdirSync(dirname(T.profile), { recursive: true });
if (profileState === "link") {
	// 校验链接是否真的可解析到实体包（读 package.json，避免「链接存在但指错」的假就绪）
	if (existsSync(join(T.profile, "package.json"))) ok("② profile 链接已存在且可解析到实体包（未改动）");
	else warn("② 链接存在但无法解析到 package.json，请人工检查指向");
} else if (profileState === "dir") {
	warn("② 已存在**实体目录**，为避免误删用户数据**不自动处理**；请人工确认后删除再重跑 --apply");
} else {
	try {
		symlinkSync(T.host, T.profile, "junction");
		ok("② profile junction 已创建（junction 免管理员）");
	} catch (e) {
		bad(`② 创建 junction 失败：${e.message}（可改用管理员 mklink /J）`);
	}
}

/* ③ 用户补丁层：幂等追加 */
if (patchState === "has-entry") {
	ok(`③ 已含 entry \`${ENTRY_ID}\`（未改动）`);
} else {
	const exists = existsSync(T.patch);
	const header = exists ? "" : [
		"# dsh web profile — 用户补丁层",
		"#",
		"# 应用顺序：所有 bundle 层的 patch 依次应用后，才应用本文件。",
		"# 语法：顶层 YAML 数组，元素为 loader patch entry。",
		""
	].join("\n");
	/* 🔴 必须**替换**而非在其后追加：卸载终态会留下一个空的 `[]` 占位，
	 *    若直接追加会得到 `[]` 紧跟 `- insert:` 的**非法 YAML**
	 *    （顶层标量之后又出现列表项）。故先把独立的 `[]` 行剔除。 */
	let base = exists ? patchText : "";
	base = base.split(/\r?\n/).filter((l) => l.trim() !== "[]").join("\n").replace(/\s*$/, "\n");
	const body = `${header}\n# ── 追加：总监驾驶舱插件（${PKG_NAME}）────────────────\n` +
		`# 由 dsh-client-mod 项目 T-PLUG-005 迁移产出。\n` +
		`# host face 通过 insert 挂载；\n` +
		`# client face 由 dsh-client-modules 依据该包 package.json 的 dsh.client 声明自动接入 boot graph。\n` +
		PATCH_BLOCK + "\n";
	writeFileSync(T.patch, base + body, "utf8");
	const back = readFileSync(T.patch, "utf8");
	// 回读校验：既要含本 entry，也不能残留 `[]` 占位（否则 YAML 非法）
	if (back.includes(`id: ${ENTRY_ID}`) && !/^\s*\[\]\s*$/m.test(back)) ok(`③ 已追加 entry \`${ENTRY_ID}\` 并回读校验通过（无残留 \`[]\` 占位）`);
	else bad("③ 追加后回读校验失败（缺 entry 或残留 `[]` 占位）");
}

log("\n[4] 收尾");
log("  安装完成。**必须重启 Harness 才生效**（插件在 boot 时装载）：");
log(`    cd "${HARNESS_ROOT}"`);
log(`    env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./DeepSeek Harness.exe" --remote-debugging-port=9222`);
log("  然后自检：node scripts/plugin-install.mjs   （应输出 已完整就绪）");
log("  真机级验证：node scripts/cdp-verify.mjs    （应 39/39）");

log(`\nIS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}（fail=${fail}）`);
process.exit(fail === 0 ? 0 : 1);
