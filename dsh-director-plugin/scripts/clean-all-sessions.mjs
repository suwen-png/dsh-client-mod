#!/usr/bin/env node
/**
 * clean-all-sessions.mjs —— **一条命令**清空会话的四个落点
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它（优化建议 5.7）
 * ──────────────────────────────────────────────────────────────────
 * 会话清理的问题**至少复发三次**（第 16 / 19 / 21 批），每次都要重新摸"会话到底存哪几处"。
 * 本批补出**第四落点**（`localStorage` 里按会话 id 的残留）之后，清理已经分散到三个脚本：
 *   ① `purge-host-sessions.mjs`     宿主内存（官方 `workspace.archiveSession`）
 *   ② `clean-sessions.mjs`          盘上三处（磁盘 / workspace.json / projcache）
 *   ③ `clean-session-ui-state.mjs`  UI 第四落点（localStorage）
 * ⇒ 合成一条入口，**顺序固定**（先下架宿主、再清盘、最后清 UI 并 reload），
 *    并把"下一步要用户做什么"打印出来（清盘后**必须重启宿主**才会在界面上落定）。
 *
 * 🔴 安全边界：
 *    · 默认 **DRY-RUN**（只列候选，不动任何东西）；`--apply` 才真写。
 *    · 三个子脚本各自都带**可回滚**（盘上移入 `.trash-<ts>`，不删）。
 *    · 任何一步失败即**停**并如实报出（纪律 18：不许"跳过了"还报成功）。
 *
 * 用法：node scripts/clean-all-sessions.mjs            # dry-run（预览三段候选）
 *       node scripts/clean-all-sessions.mjs --apply    # 真清 + reload
 * 退出码：0 成功 / 1 有失败 / 2 用法错
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const argv = process.argv.slice(2);
const apply = argv.indexOf("--apply") >= 0;
for (const a of argv) {
	if (a !== "--apply") { console.log("未知参数：" + a + "（只支持 --apply）"); process.exit(2); }
}

function step(label, script, extra) {
	console.log("\n──────── " + label + " ────────");
	const args = [resolve(HERE, script)].concat(extra || []);
	const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
	const out = String(r.stdout || "") + String(r.stderr || "");
	process.stdout.write(out.split("\n").filter((l) => l.trim()).slice(-16).join("\n") + "\n");
	return r.status === 0;
}

console.log("═══ clean-all-sessions · 四个落点 " + (apply ? "（APPLY）" : "（DRY-RUN）") + " ═══");

const mode = apply ? ["--apply"] : [];
const ok1 = step("① 宿主内存：下架（官方 workspace.archiveSession）", "purge-host-sessions.mjs", mode);
if (!ok1) { console.log("\n❌ ① 失败 ⇒ 停（后续步骤在没有 ① 的情况下会得出误导性读数）"); process.exit(1); }

const ok2 = step("② 盘上三处：磁盘 / workspace.json / projcache", "clean-sessions.mjs", mode);
if (!ok2) { console.log("\n❌ ② 失败 ⇒ 停"); process.exit(1); }

/* ③ 只在 apply 时真写；dry-run 时也跑（它自己是 dry-run 默认） */
const ok3 = step("③ UI 第四落点：localStorage 会话残留与索引孤儿", "clean-session-ui-state.mjs", mode);
if (!ok3) { console.log("\n⚠️ ③ 未全绿（有失败或仍有候选）—— 见上"); }

if (apply) {
	const ok4 = step("④ 让页面重新读宿主状态", "reload-client.mjs", []);
	if (!ok4) { console.log("\n⚠️ ④ reload 未成功 —— 界面可能仍显示旧状态"); }
}

console.log("\n═══════════════════════════════════════════════════════════");
if (!apply) {
	console.log("  DRY-RUN 结束。确认候选无误后加 --apply 执行。");
	process.exit(0);
}
console.log("  清理完成。**下一步（人工）**：");
console.log("    · 宿主主进程会在退出时把内存态**回写磁盘** ⇒ 「三口径 0」只在**宿主重启后**才稳定；");
console.log("    · 需要彻底归零就重启 Harness（本仓库的进程通常以管理员运行，脚本无权结束）；");
console.log("    · 重启后再跑一次本命令，应看到四个落点全 0。");
console.log("  IS_PASS: " + (ok1 && ok2 && ok3 ? "TRUE" : "FALSE"));
process.exit(ok1 && ok2 && ok3 ? 0 : 1);
