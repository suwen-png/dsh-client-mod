#!/usr/bin/env node
/**
 * test-generators.mjs —— **生成器收敛闸门**（两个生成器不得互相覆盖同一个文件的头）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有这一套（2026-09-17 第二十五轮 · 真因修复的守卫）
 * ──────────────────────────────────────────────────────────────────
 *  症状（很像"构建不稳定"，其实是**输入在跑程内会变**）：
 *    · 同一份 `src/**` 连续两次 `node build/build.mjs` 得到**不同**产物
 *      （实测 `2008557 B / 2085f97c…` 与 `2008511 B / cfd2c7df…`）；
 *    · 两次 `check-stale-build.mjs` **都报 TRUE** ⇒ 判据没有分辨力；
 *    · 于是 `plugin-install` 装进去的那一份，与"我以为的那一份"**不是同一份**。
 *
 *  真因：`src/logic/key-files.js` 是**生成物**，而它的 `@map` 头有**两个写者**、口径不同：
 *    · `gen-key-files.mjs`（第 97 行）→ `设计稿：…V19-界面调整设计稿.html（板块 H / I）`；
 *    · `gen-source-map.mjs`（按人工小表）→ `…V16-设计图·需求图·交互逻辑.html（板块 —）`。
 *    ⇒ 谁最后跑谁赢 ⇒ `gen-source-map --check` 与本套件守的 `刷新 0` **永远不可能同时成立**。
 *
 *  为什么危险：两个生成器的产物**都在构建面（`src/**`）内**，且**离线套件会跑它们**
 *    （`build-stamp.mjs` 的注释里就写了）⇒「我构建的是哪一份 src」在**跑程内会变**。
 *    这是纪律 99 的形态：**判据的生命周期必须与数据的生命周期一致**。
 *
 *  第二层缺陷（同轮修掉）：`gen-source-map.mjs --check` 旧版**无条件**打印
 *    `IS_PASS: TRUE`，而 `verify-index.mjs` **只看退出码** ⇒ 振荡在闸门层面**完全不可见**
 *    （纪律 31「报绿先审口径」）。⇒ 本套件**不以退出码为唯一判据**，直接断言输出里的 `刷新 0`。
 *
 * ══════════════════════════════════════════════════════════════════
 * 植入缺陷校准（纪律 32 · 已实测，**留证**）
 * ──────────────────────────────────────────────────────────────────
 *  把 `gen-source-map.mjs` 里的 `if (OWNED_BY_OTHER.has(r)) continue;` 换成注释（= 恢复旧行为）：
 *    · `gen-source-map --check` ⇒ `刷新 1` · `IS_PASS: FALSE` · **exit 1**
 *    · `verify-index.mjs`       ⇒ `合计 3 份：❌ 漂移 1`（此前它报**全绿**）
 *  还原后 ⇒ `刷新 0` · `IS_PASS: TRUE` · exit 0，且脚本**逐字节一致**（17,831 B）。
 *  ⇒ 判据**精确命中**，不是空真。
 *
 * 用法：node scripts/test-generators.mjs        ｜ 退出码 0 通过 / 1 失败
 * ══════════════════════════════════════════════════════════════════
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let pass = 0, fail = 0;
const failures = [];
function t(id, title, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + title); }
	else {
		fail++; failures.push(id + " " + title);
		console.log("  ❌ " + id + " " + title);
		if (detail !== undefined) console.log("       实测：" + JSON.stringify(detail));
	}
}

console.log("══ 生成器收敛闸门（两个生成器不得互相覆盖同一个文件的 @map 头）══");

const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 180000 });
const J = (o) => JSON.stringify(o);

/* ── 1. `gen-source-map --check`：不只是"没崩"，而是 **刷新 0** ────────────── */
const sm = run([path.join(HERE, "gen-source-map.mjs"), "--check"]);
const smOut = (sm.stdout || "") + (sm.stderr || "");
const smRefresh = (/刷新\s*(\d+)/.exec(smOut) || [])[1];
const smInjected = (/新增注入\s*(\d+)/.exec(smOut) || [])[1];
const smPass = /IS_PASS:\s*TRUE/.test(smOut);

t("GEN-1", "🔴 `gen-source-map --check` 报 **刷新 0 / 新增注入 0**（只看退出码会漏掉振荡 —— 纪律 31）",
	sm.status === 0 && smInjected === "0" && smRefresh === "0" && smPass,
	{ exit: sm.status, injected: smInjected, refreshed: smRefresh, isPass: smPass });

/* ── 2. `gen-key-files --check`：内容一致 ─────────────────────────────────── */
const kf = run([path.join(HERE, "gen-key-files.mjs"), "--check"]);
const kfOut = (kf.stdout || "") + (kf.stderr || "");
const kfPass = /IS_PASS:\s*TRUE/.test(kfOut);
t("GEN-2", "🔴 `gen-key-files --check` 报一致（两个 `--check` 必须**同时** TRUE —— 它们曾互斥）",
	kf.status === 0 && kfPass, { exit: kf.status, isPass: kfPass });

/* ── 3. 单一写者自证（纪律 78/79：一个文件的头只由一个生成器写） ───────────── */
const smSrc = readFileSync(path.join(HERE, "gen-source-map.mjs"), "utf8");
const kfSrc = readFileSync(path.join(HERE, "gen-key-files.mjs"), "utf8");
const ownsSet = /OWNED_BY_OTHER\s*=\s*new Set\(\[[^\]]*"logic\/key-files\.js"/.test(smSrc);
const hasSkip = /OWNED_BY_OTHER\.has\(r\)\)\s*continue;/.test(smSrc);
const kfSkipsSelf = /path\.resolve\(full\)\s*===\s*path\.resolve\(OUT_PATH\)\)\s*continue;/.test(kfSrc);
t("GEN-3", "🔴 **单一写者自证**：`gen-source-map` 跳过 `logic/key-files.js`（它的头归 `gen-key-files`）",
	ownsSet && hasSkip && kfSkipsSelf, { ownsSet: ownsSet, hasSkip: hasSkip, kfSkipsSelf: kfSkipsSelf });

/* ── 4. 口径自证：`--check` 发现需要写盘 ⇒ 必须报红 + exit 1 ──────────────── */
const hasDirty = /const dirty\s*=\s*injected\s*>\s*0\s*\|\|\s*refreshed\s*>\s*0/.test(smSrc);
const hasExit1 = /IS_PASS: FALSE（--check 发现/.test(smSrc) && /process\.exit\(1\)/.test(smSrc);
t("GEN-4", "🔴 **口径自证**：`--check` 的判据是「是否需要写盘」（刷新>0 ⇒ FALSE + exit 1），不是「没崩」",
	hasDirty && hasExit1, { hasDirty: hasDirty, hasExit1: hasExit1 });

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
