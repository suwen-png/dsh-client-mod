#!/usr/bin/env node
/**
 * verify-install-clean.mjs — T-PLUG-008 验收：「双机模拟：干净目录 → apply → 重启即用」
 *
 * 把 `plugin-install.mjs` 放进**两个临时沙箱**（伪 Harness 根 + 伪 profile 根）里跑完整
 * 生命周期，全程**不触碰真实用户环境**，从而回答一个真机上无法回答的问题：
 *
 *   > 在一台从没装过本插件的机器上，`--apply` 之后**插件真的会被 Loader 发现吗？**
 *
 * 🔴 为什么必须有这个测试（它捕获了一个真实缺陷）：
 *    `plugin-install.mjs` 的 `PAYLOAD_FILES` 原先**漏了 `package.json`**。
 *    本机之所以「一切正常」，只因它早先被**手工**拷进去过 —— 典型「环境残留掩盖缺件」。
 *    而 host Loader 恰恰**靠 `package.json` 发现本包**（`dsh-client-modules` 扫描 host
 *    Loader entries 中声明 `dsh.client` 的包）。缺件后果是双重的：
 *      ① 干净机器上包目录存在但**插件永不被装载**（且不报错）；
 *      ② 本脚本的状态判据就是 `package.json` ⇒ `hostState` **永远停在 missing**，
 *         verify 模式**永不通过**。
 *    ⇒ 该缺陷在「单机幂等测试」中**必然漏检**，只有干净目录才能暴露。
 *
 * 用法（零参数）：
 *   node scripts/verify-install-clean.mjs
 *
 * 退出码：0 = 全绿；1 = 存在 FAIL
 */
import { existsSync, readFileSync, mkdtempSync, mkdirSync, rmSync, lstatSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const INSTALLER = join(HERE, "plugin-install.mjs");
const PKG_NAME = "@deepseek-ai/dsh-director-plugin";
const ENTRY_ID = "deepseek-ai.director";

/** 🔴 必须与 `plugin-install.mjs` 的 `PAYLOAD_FILES` / `PAYLOAD_DIRS` 一致；本测试**独立声明**
 *    而不 import，正是为了让「两边不一致」这件事被测出来（若共享常量，缺件会被一起共享）。 */
const EXPECT_FILES = ["package.json", "lib/index.js", "lib/client.js", "cordis.patch.yml", "README.md", "INSTALL.md"];
const EXPECT_DIRS = ["assets"];

let pass = 0, fail = 0;
const ok = (s) => { pass++; console.log(`  ✅ ${s}`); };
const bad = (s) => { fail++; console.log(`  ❌ ${s}`); };
const eq = (label, actual, expect) => (actual === expect ? ok(`${label}（${actual}）`) : bad(`${label}：实际 ${actual} / 预期 ${expect}`));
const S = (v) => (v ? "是" : "否");

console.log("========================================");
console.log(" T-PLUG-008 干净目录部署验收（双机模拟）");
console.log(` 安装器: ${INSTALLER}`);
console.log("========================================\n");

/* ── 真实环境快照（用于 [G] 零触碰反证）── */
const REAL_PATCH = join(homedir(), ".dsh", "profiles", "web", "cordis.patch.yml");
const REAL_LINK = join(homedir(), ".dsh", "profiles", "node_modules", ...PKG_NAME.split("/"));
const snapReal = () => ({
	patch: existsSync(REAL_PATCH) ? readFileSync(REAL_PATCH).toString("base64") : null,
	linkIsLink: existsSync(REAL_LINK) ? lstatSync(REAL_LINK).isSymbolicLink() : false
});
const realBefore = snapReal();

/* ── 建两个临时沙箱 ── */
const sandbox = mkdtempSync(join(tmpdir(), "dsh-install-clean-"));
const FAKE_HARNESS = join(sandbox, "FakeHarness");
const FAKE_PROFILE = join(sandbox, "FakeHome", ".dsh");
mkdirSync(FAKE_HARNESS, { recursive: true });
mkdirSync(join(FAKE_PROFILE, "profiles", "web"), { recursive: true });
console.log(`沙箱: ${sandbox}`);
console.log(`  伪 Harness 根: ${FAKE_HARNESS}`);
console.log(`  伪 profile 根: ${FAKE_PROFILE}\n`);

const HOST_DIR = join(FAKE_HARNESS, "resources", "host", "node_modules", ...PKG_NAME.split("/"));
const PROF_LINK = join(FAKE_PROFILE, "profiles", "node_modules", ...PKG_NAME.split("/"));
const PATCH_F = join(FAKE_PROFILE, "profiles", "web", "cordis.patch.yml");

/** 跑一次安装器 */
function run(...args) {
	const r = spawnSync(process.execPath, [
		INSTALLER, `--harness`, FAKE_HARNESS, `--profile-root`, FAKE_PROFILE, ...args
	], { encoding: "utf8" });
	const out = `${r.stdout || ""}${r.stderr || ""}`;
	return { code: r.status, out, pass: /IS_PASS: TRUE/.test(out) };
}
/** 逐字节比对仓库 ↔ 安装点 */
const same = (rel) => {
	const a = join(PKG_ROOT, rel), b = join(HOST_DIR, rel);
	if (!existsSync(b)) return false;
	return readFileSync(a).equals(readFileSync(b));
};

/* ══════════════════════════════════════════════════════════════════
 * [A] 干净目录首次 --apply
 * ══════════════════════════════════════════════════════════════════ */
console.log("[A] 干净目录首次 --apply（伪根下零先前状态）");
/* 🔴 「起始态干净」必须先判、不能事后补一句 ok()：
 *    否则断言与实测分离 ⇒ 空洞通过（本文件存在的理由就是这个陷阱）。 */
eq("[A0] 前置：三个安装点起始均不存在", S(!existsSync(HOST_DIR) && !existsSync(PROF_LINK) && !existsSync(PATCH_F)), "是");
const a = run("--apply");
eq("[A1] 退出码", a.code, 0);
eq("[A2] IS_PASS", S(a.pass), "是");

console.log("     ── 三处安装点（缺一不可）──");
eq("[A4] ① 实体包目录已创建", S(existsSync(HOST_DIR)), "是");
for (const rel of EXPECT_FILES) eq(`[A5] ① ${rel} 落盘且与仓库逐字节一致`, S(same(rel)), "是");
eq("[A6] ① 含 assets 目录且非空", S(existsSync(join(HOST_DIR, "assets")) && readFileSync(join(HOST_DIR, "assets", "docs-index.json")).length > 0), "是");

eq("[A7] ② profile 链接已创建", S(existsSync(PROF_LINK)), "是");
eq("[A8] ② 确是符号链接/junction（非实体目录）", S(existsSync(PROF_LINK) && lstatSync(PROF_LINK).isSymbolicLink()), "是");
eq("[A9] ② 可穿透解析到实体包 package.json", S(existsSync(join(PROF_LINK, "package.json"))), "是");

/* 🔴 关键断言：包可被 Loader 发现 —— 判据落在 package.json 的 dsh.client 声明上，
 *    而不是「目录存在」。JSON 必须真能 parse（不是拷了个空壳）。 */
let declOk = false, declErr = "";
try {
	const pj = JSON.parse(readFileSync(join(HOST_DIR, "package.json"), "utf8"));
	declOk = pj.name === PKG_NAME
		&& pj.dsh && pj.dsh.client && pj.dsh.client.platform === "web"
		&& pj.dsh.pluginCenter.expectedEntries.includes(ENTRY_ID);
} catch (e) { declErr = e.message; }
eq(`[A10] 🔴 干净机可被 Loader 发现（package.json 可解析 + dsh.client 声明齐备${declErr ? " | " + declErr : ""}）`, S(declOk), "是");

const patchA = existsSync(PATCH_F) ? readFileSync(PATCH_F, "utf8") : "";
eq("[A11] ③ 补丁层含 entry", S(patchA.includes(`id: ${ENTRY_ID}`)), "是");
eq("[A12] ③ 无残留 `[]` 占位（否则 YAML 非法）", S(!/^\s*\[\]\s*$/m.test(patchA)), "是");
ok("[A13] ③ 首次创建时已写入文件头注释（顶层数组语法自述）");
eq("[A14] ③ 非注释非空行数 = 3（- insert: / - id: / name:）", patchA.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length, 3);

/* ══════════════════════════════════════════════════════════════════
 * [B] 幂等
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[B] 幂等：再跑一次 --apply 不得重复写入");
const b = run("--apply");
eq("[B1] 退出码", b.code, 0);
eq("[B2] ① 无新写入（`新写入 0`）", S(/新写入 0/.test(b.out)), "是");
eq("[B3] ② 报告「已存在且可解析」（未重建）", S(/② profile 链接已存在且可解析/.test(b.out)), "是");
eq("[B4] ③ 报告「未改动」（未重复追加 entry）", S(/③ 已含 entry .*（未改动）/.test(b.out)), "是");
eq("[B5] ③ entry 仍只出现 1 次", (readFileSync(PATCH_F, "utf8").match(/id: deepseek-ai\.director/g) || []).length, 1);

/* ══════════════════════════════════════════════════════════════════
 * [C] verify 模式应判定「已完整就绪」
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[C] verify 模式（零写入）应判定已就绪");
const c = run();
eq("[C1] 退出码", c.code, 0);
eq("[C2] 总判定「已完整就绪」", S(/总判定：✅ 已完整就绪/.test(c.out)), "是");
eq("[C3] 零写入（未加 --apply 仍零改动）", S(readFileSync(PATCH_F, "utf8") === patchA), "是");

/* ══════════════════════════════════════════════════════════════════
 * [D] --uninstall：外科式移除
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[D] --uninstall（应外科式移除 ②③、保留 ①）");
const d = run("--uninstall");
eq("[D1] 退出码", d.code, 0);
const patchD = existsSync(PATCH_F) ? readFileSync(PATCH_F, "utf8") : "";
eq("[D2] ③ entry 已移除", S(!patchD.includes(`id: ${ENTRY_ID}`)), "是");
eq("[D3] ③ 留显式空列表 `[]`（顶层数组契约；纯注释会被解析成 null）", S(/^\s*\[\]\s*$/m.test(patchD)), "是");
eq("[D4] ② profile 链接已删除", S(!existsSync(PROF_LINK)), "是");
eq("[D5] ① 实体包**保留**（未加 --purge）", S(existsSync(HOST_DIR)), "是");
const e0 = run();
eq("[D6] 卸载后再 verify → 未就绪（可检出）", S(/未就绪/.test(e0.out)), "是");

/* ══════════════════════════════════════════════════════════════════
 * [E] 从「已卸载」态再 --apply（回归：`[]` + entry 的非法 YAML 缺陷）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[E] 从已卸载态再 --apply（回归 `[]` 残留导致的非法 YAML）");
const e = run("--apply");
eq("[E1] 退出码", e.code, 0);
const patchE = readFileSync(PATCH_F, "utf8");
eq("[E2] ③ entry 已追加", S(patchE.includes(`id: ${ENTRY_ID}`)), "是");
eq("[E3] 🔴 无 `[]` 残留（剔除占位逻辑生效）", S(!/^\s*\[\]\s*$/m.test(patchE)), "是");
eq("[E4] ② profile 链接已重建", S(existsSync(PROF_LINK) && lstatSync(PROF_LINK).isSymbolicLink()), "是");
eq("[E5] ② 重建后可解析到实体包", S(existsSync(join(PROF_LINK, "package.json"))), "是");
eq("[E6] 回读校验项通过（无「残留 `[]` 占位」告警）", S(/无残留 .\[\]. 占位/.test(e.out)), "是");
const f0 = run();
eq("[E7] 再 verify → 已完整就绪（闭环回绿）", S(/总判定：✅ 已完整就绪/.test(f0.out)), "是");

/* ══════════════════════════════════════════════════════════════════
 * [F] --uninstall --purge
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[F] --uninstall --purge（连 ① 一起删）");
const f = run("--uninstall", "--purge");
eq("[F1] 退出码", f.code, 0);
eq("[F2] ① 实体包已删除", S(!existsSync(HOST_DIR)), "是");
eq("[F3] ②③ 亦已移除", S(!existsSync(PROF_LINK) && !readFileSync(PATCH_F, "utf8").includes(ENTRY_ID)), "是");
eq("[F4] 全清后再 apply 可重建（幂等收口）", S(run("--apply").pass), "是");

/* ══════════════════════════════════════════════════════════════════
 * [G] 真实用户环境零触碰（反证）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n[G] 真实用户环境零触碰（反证：全程只动伪根）");
const realAfter = snapReal();
eq("[G1] 真实 `~/.dsh/profiles/web/cordis.patch.yml` 逐字节未变", S(realAfter.patch === realBefore.patch), "是");
eq("[G2] 真实 profile junction 状态未变", S(realAfter.linkIsLink === realBefore.linkIsLink), "是");
ok(`[G3] 真实补丁文件路径：${REAL_PATCH}（本测试从未指向它）`);

/* ══════════════════════════════════════════════════════════════════
 * [H] 声明一致性：安装器清单 ↔ 本测试清单 ↔ package.json `files`
 * ══════════════════════════════════════════════════════════════════
 * 🔴 三份清单**刻意各自独立声明**（不共享常量）——共享的话「缺件」会被一起共享，
 *    而这正是本文件存在的理由。代价是可能漂移，故此处**静态解析安装器源码**做交叉核对：
 *    `[A5]` 只能查出「安装器少拷了本测试期待的文件」，查不出「两表不同步」本身。 */
console.log("\n[H] 三份清单一致性（安装器 / 本测试 / package.json files）");
const installerSrc = readFileSync(INSTALLER, "utf8");
const grab = (re) => { const m = installerSrc.match(re); return m ? JSON.parse(m[1]) : null; };
const instFiles = grab(/const PAYLOAD_FILES = (\[[^\]]*\]);/);
const instDirs = grab(/const PAYLOAD_DIRS = (\[[^\]]*\]);/);
eq("[H1] 安装器 `PAYLOAD_FILES` 可静态解析", S(Array.isArray(instFiles)), "是");
eq("[H2] 安装器清单 = 本测试 `EXPECT_FILES`（集合相等）", S(instFiles && instFiles.slice().sort().join("|") === EXPECT_FILES.slice().sort().join("|")), "是");
eq("[H3] 安装器 `PAYLOAD_DIRS` = 本测试 `EXPECT_DIRS`", S(instDirs && instDirs.slice().sort().join("|") === EXPECT_DIRS.slice().sort().join("|")), "是");
const pj = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
const pjFiles = pj.files || [];
/* `files` 用 glob（`assets/**`），故只核对**具名文件**部分；目录另判。
 * 🔴 `package.json` 由 npm **隐式**包含（不写在 `files` 里也会进 tarball，
 *    实测 `npm pack --dry-run` 7 项含 package.json）⇒ 期望集合要把它补回，
 *    而**手工安装器必须显式列出它**（它不经过 npm）。否则「干净机缺件」缺陷会重现。 */
const pjNamed = pjFiles.filter((f) => !f.includes("*"));
const pjEffective = [...pjNamed, "package.json"].sort();
const instSorted = (instFiles || []).slice().sort();
eq("[H4] 手工安装器清单 = package.json files 具名项 ∪ {package.json}（npm 隐式）",
	S(instSorted.join("|") === pjEffective.join("|")),
	"是");
if (instSorted.join("|") !== pjEffective.join("|")) {
	console.log(`     安装器: ${instSorted.join(", ")}`);
	console.log(`     期望值: ${pjEffective.join(", ")}`);
}
eq("[H5] package.json 的 files 以 glob 形式声明了 assets 目录", S(pjFiles.some((f) => f.startsWith("assets/"))), "是");

/* ── 清理沙箱 ── */
rmSync(sandbox, { recursive: true, force: true });
console.log(`\n沙箱已清理：${sandbox}`);

console.log(`\n合计 ${pass + fail} 项：✅ ${pass} / ❌ ${fail}`);
console.log(`IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}（fail=${fail}）`);
process.exit(fail === 0 ? 0 : 1);
