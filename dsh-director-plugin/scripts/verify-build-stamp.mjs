#!/usr/bin/env node
/**
 * verify-build-stamp.mjs —— 产物内容指纹守卫的**闸门**（含正负对照）
 *
 * 纪律 ⑥：新闸门必须**正负对照**；纪律 32：新检查必须**植入目标缺陷**证明会红。
 * 本套件盯的是第十九轮真机踩出来的那类缺陷：
 *   **`DirectorPage.js` 的改动写在 build 之后 ⇒ 产物陈旧，而"逐字节一致"照样报 ✅。**
 *
 * | 编号 | 被测行为 | 期望 |
 * |:--|:--|:--|
 * | BS-1 | 产物内有指纹 | 形如 16 位十六进制 |
 * | BS-2 | 🔴 产物指纹 **=** 当前 `src/**` 重算的指纹 | 相等（否则产物不是当前 src 构建的） |
 * | BS-3 | 指纹覆盖面**非空且成规模** | ≥ 50 个文件（防"只哈希了一个文件"的退化实现） |
 * | BS-4 | 🔴 **负对照**：把 src 里任一文件改一个字节 ⇒ 指纹**必须变** | 变（否则守卫是空跑） |
 * | BS-5 | 🔴 **负对照**：改文件**名**（内容相同）⇒ 指纹也必须变 | 变（防"只哈希内容不哈希路径" ⇒ 重命名漏检） |
 * | BS-6 | `checkStale()` 与 `readStampIn()` 口径一致 | 产物内能读到的指纹 = `checkStale` 报告的 artifactStamp |
 * | BS-7 | 🔴 正对照：未改动时 `checkStale().stale === false` | false（防"永远报陈旧"那种同样无用的实现） |
 *
 * 🔴 BS-4/BS-5 在**临时目录**里做（复制一份 src），**不碰真 src** —— 会写盘的闸门段必须
 *    自我隔离（纪律 ⑮：快照→还原→还原断言 的等价做法：干脆不在原地改）。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, copyFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { computeSrcStamp, readStampIn, listSrcFiles } from "./build-stamp.mjs";
import { checkStale } from "./check-stale-build.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ART = join(ROOT, "lib/client.js");

let pass = 0, fail = 0; const failures = [];
const t = (id, title, cond, detail) => {
	const ok = !!cond;
	if (ok) pass++; else { fail++; failures.push(id + " " + title); }
	console.log("  " + (ok ? "✅" : "❌") + " " + id + " " + title + (detail !== undefined ? "  ｜ " + JSON.stringify(detail) : ""));
};

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  产物内容指纹守卫 · 正负对照");
console.log("═══════════════════════════════════════════════════════════\n");

console.log("【A 产物与当前 src 的指纹一致性】");
if (!existsSync(ART)) {
	console.log("  ❌ 产物不存在：" + relative(ROOT, ART) + "（先跑 node build/build.mjs）");
	process.exit(1);
}
const artText = readFileSync(ART, "utf8");
const inArt = readStampIn(artText);
const srcStamp = computeSrcStamp(ROOT);
const files = listSrcFiles(ROOT);

t("BS-1", "产物内有指纹（16 位十六进制）", typeof inArt === "string" && /^[0-9a-f]{16}$/.test(inArt), inArt);
t("BS-2", "🔴 产物指纹 **=** 当前 `src/**` 重算指纹（否则产物不是当前 src 构建的）",
	inArt === srcStamp, { artifact: inArt, src: srcStamp });
t("BS-3", "指纹覆盖面成规模（≥ 50 个文件，防退化实现）", files.length >= 50, { files: files.length });

const st = checkStale(ROOT);
t("BS-7", "🔴 正对照：未改动时 `checkStale().stale === false`（防「永远报陈旧」）",
	st.stale === false, { stale: st.stale, reason: st.reason });
t("BS-6", "`checkStale().artifactStamp` 与 `readStampIn(产物)` 口径一致",
	st.artifactStamp === inArt, { checkStale: st.artifactStamp, readStampIn: inArt });

console.log("\n【B 负对照：在**临时副本**里植入缺陷（不动真 src —— 纪律 ⑮）】");
const tmp = mkdtempSync(join(tmpdir(), "dsh-stamp-"));
try {
	const dstSrc = join(tmp, "src");
	mkdirSync(dstSrc, { recursive: true });
	const copyDir = (from, to) => {
		mkdirSync(to, { recursive: true });
		for (const k of readdirSync(from, { withFileTypes: true })) {
			const f = join(from, k.name), g = join(to, k.name);
			if (k.isDirectory()) copyDir(f, g); else copyFileSync(f, g);
		}
	};
	copyDir(join(ROOT, "src"), dstSrc);
	const base = computeSrcStamp(tmp);

	/* BS-4：改一个字节 */
	const victim = files[Math.floor(files.length / 2)];
	const vp = join(dstSrc, victim.split("/").join("\\"));
	const orig = readFileSync(vp);
	writeFileSync(vp, Buffer.concat([orig, Buffer.from("\n/* defect */\n")]));
	const afterEdit = computeSrcStamp(tmp);
	t("BS-4", "🔴 负对照：改一个文件的内容 ⇒ 指纹**必须变**", afterEdit !== base, { file: victim, before: base, after: afterEdit });
	writeFileSync(vp, orig);

	/* BS-5：改名（内容不变） */
	const rp = join(dstSrc, victim.split("/").join("\\"));
	const rp2 = rp + ".renamed";
	writeFileSync(rp2, orig);
	rmSync(rp);
	const afterRename = computeSrcStamp(tmp);
	t("BS-5", "🔴 负对照：只改**文件名**（内容相同）⇒ 指纹也必须变（防「只哈希内容不哈希路径」）",
		afterRename !== base, { before: base, afterRename: afterRename });
	t("BS-5b", "还原后指纹回到原值（证明上面的变化确实来自注入的缺陷）",
		(function () { writeFileSync(rp, orig); rmSync(rp2); return computeSrcStamp(tmp) === base; })() === true, null);
} finally {
	try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 临时目录清理失败不影响结论 */ }
}

console.log("\n═══════════════════════════════════════════════════════════");
console.log(`  PASS ${pass} / FAIL ${fail} / 总计 ${pass + fail}`);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log(`  IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
