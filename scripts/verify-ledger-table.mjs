#!/usr/bin/env node
/**
 * 台账 Markdown 表格列数校验
 *
 * 解决的问题：单元格内出现**未转义的半角竖线** `|`，会让该行在 Markdown 渲染时
 * 多切出一列 —— 且**不报任何错**，肉眼也极难发现（一行动辄上千字符）。
 *
 * 实测来源（2026-09-12）：`03-待完成任务清单.md` 主表连抓出 2 行破表
 *   · L112 `T-PLUG-013` 有 7 个管道（应为 6）—— **上一轮写入时就已破表，此前无人发现**
 *   · L115 `T-PLUG-016` 有 8 个管道 —— 本轮新增时引入（用了 `R4\|R5\|R7` 转义写法，判据歧义）
 * ⇒ 说明「靠人眼扫台账」不可靠，必须有闸门。
 *
 * 用法：
 *   node scripts/verify-ledger-table.mjs              # 扫默认台账
 *   node scripts/verify-ledger-table.mjs <file...>    # 扫指定文件
 * 退出码 0 = 全绿；1 = 有破表行或自检失败。
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const DEFAULTS = [
  "docs/00-统筹入口/03-待完成任务清单.md",
  "docs/00-统筹入口/04-已完成任务清单.md",
];

/** 统计一行的「未转义竖线」数：`\|` 视为转义，不计入 */
function countPipes(line) {
  return (line.replace(/\\\|/g, "").match(/\|/g) || []).length;
}

/** 判断一行是否为「表头行」：下一行是分隔行 `|:--|--:|` */
function isHeader(lines, k) {
  const next = lines[k + 1];
  return Boolean(next) && /^\|[\s:\-|]+$/.test(next) && /\|/.test(lines[k]);
}

/**
 * 扫描一个 Markdown 文本里的所有表格，按表分组校验列数。
 * 分组很重要：同一文件里多张表列数各不相同，用「全局第一张表的列数」比对会产生大量误报。
 */
export function scanTables(src) {
  const lines = src.split("\n");
  let expect = -1;
  let tables = 0;
  const bad = [];

  for (let k = 0; k < lines.length; k++) {
    const t = lines[k];
    if (!t.startsWith("|")) {
      if (t.trim() === "") expect = -1; // 空行 = 表结束
      continue;
    }
    if (/^\|[\s:\-|]+$/.test(t)) continue; // 分隔行跳过

    if (isHeader(lines, k)) {
      expect = countPipes(t);
      tables += 1;
      continue;
    }
    if (expect > 0) {
      const got = countPipes(t);
      if (got !== expect) {
        bad.push({ line: k + 1, got, want: expect, head: t.slice(0, 60) });
      }
    }
  }
  return { tables, bad };
}

/** 防线自检：坏样本必须被拦、好样本不得误报（防空转） */
function selfTest() {
  const BT = String.fromCharCode(96); // 反引号，避免被当作模板分隔符
  const head = "| a | b | c |\n|:--|:--|:--|\n";

  // 坏样本：行只有 2 格（3 个管道），表头 3 格（4 个管道）
  const badSrc = head + "| 1 | 2 |\n";
  // 好样本：含转义竖线，格数仍为 3
  const goodSrc = head + "| x \\| y | z | w |\n";
  // 好样本 2：行内含行内代码里的未转义竖线也应被拦（这是真缺陷形态）
  const badSrc2 = head + "| " + BT + "a|b" + BT + " | c | d |\n";

  const r1 = scanTables(badSrc);
  const r2 = scanTables(goodSrc);
  const r3 = scanTables(badSrc2);

  const checks = [
    ["坏样本(少一格)必须报红", r1.bad.length === 1],
    ["好样本(转义竖线)不得误报", r2.bad.length === 0],
    ["坏样本(行内代码含裸竖线)必须报红", r3.bad.length === 1],
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    console.log("  [自检] " + (pass ? "✅" : "❌") + " " + name);
    if (!pass) ok = false;
  }
  return ok;
}

function main() {
  console.log("══ 台账表格列数校验 ══");
  console.log("[自检] 防线灵敏度：");
  const selfOk = selfTest();
  if (!selfOk) {
    console.log("[自检] ❌ 防线自身失效，中止");
    process.exit(1);
  }
  console.log("[自检] ✅ 坏样本已拦 / 好样本无误报");

  const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const files = (argv.length ? argv : DEFAULTS).map((f) => resolve(ROOT, f));

  let totalBad = 0;
  let totalTables = 0;
  let checked = 0;

  for (const f of files) {
    const rel = f.slice(ROOT.length + 1).split("\\").join("/");
    if (!existsSync(f)) {
      console.log("  ⏭  未找到（跳过）：" + rel);
      continue;
    }
    const { tables, bad } = scanTables(readFileSync(f, "utf8"));
    checked += 1;
    totalTables += tables;
    totalBad += bad.length;
    if (bad.length === 0) {
      console.log("  ✅ " + rel + "  （表 " + tables + " 张，列数全一致）");
    } else {
      console.log("  ❌ " + rel + "  （表 " + tables + " 张，异常 " + bad.length + " 行）");
      for (const b of bad) {
        console.log("       L" + b.line + "  管道 " + b.got + " ≠ 期望 " + b.want + "   :: " + b.head);
      }
    }
  }

  console.log("");
  console.log("扫描文件 " + checked + " · 表 " + totalTables + " 张 · 破表行 " + totalBad);
  const pass = totalBad === 0;
  console.log("IS_PASS: " + (pass ? "TRUE" : "FALSE"));
  process.exit(pass ? 0 : 1);
}

main();
