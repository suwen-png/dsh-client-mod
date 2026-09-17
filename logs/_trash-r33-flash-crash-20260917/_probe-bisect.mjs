/**
 * 探针：二分定位 —— 依次屏蔽 director / hcc 插件，真实双击看崩溃是否消失。
 * 每轮：备份 patch → 写入变体 → 真实双击（explorer） → 记录 → 还原。
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PATCH = "C:\\Users\\15142\\.dsh\\profiles\\web\\cordis.patch.yml";
const BAK = "C:\\Users\\15142\\.dsh\\profiles\\web\\cordis.patch.yml._r33bak";
const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const harCount = () => (execFileSync("tasklist", [], { encoding: "buffer" }).toString("utf8").match(/DeepSeek Harness\.exe/gi) || []).length;
const killAll = () => { try { execFileSync("taskkill", ["/F", "/IM", "DeepSeek Harness.exe"], { stdio: "ignore" }); } catch {} };

const FULL = fs.readFileSync(PATCH, "utf8");
fs.writeFileSync(BAK, FULL, "utf8");
console.log("已备份 patch → " + BAK);
console.log("原内容:\n" + FULL);

const NONE = "[]\n";
const ONLY_DIRECTOR = "- insert:\n    - id: deepseek-ai.director\n      name: '@deepseek-ai/dsh-director-plugin'\n";
const ONLY_HCC = "- insert:\n    - id: deepseek-ai.hcc\n      name: '@deepseek-ai/hermes-command-center'\n";

const variants = [
  ["全开（基线）", FULL],
  ["全关（[]）", NONE],
  ["只留 director", ONLY_DIRECTOR],
  ["只留 hcc", ONLY_HCC],
];

for (const [label, content] of variants) {
  fs.writeFileSync(PATCH, content, "utf8");
  killAll();
  await wait(2500);
  const s = spawn("explorer.exe", [CMD], { detached: true, stdio: "ignore" });
  s.unref();
  let peak = 0, goneAt = null;
  const t0 = Date.now();
  for (let i = 0; i < 34; i++) {
    await wait(500);
    const n = harCount();
    if (n > peak) peak = n;
    if (peak > 0 && n === 0) { goneAt = ((Date.now() - t0) / 1000).toFixed(1); break; }
  }
  console.log("【" + label + "】峰值 " + peak + " · " + (goneAt ? "🔴 全灭 @" + goneAt + "s" : "✅ 存活"));
  killAll();
  await wait(1500);
}

fs.writeFileSync(PATCH, FULL, "utf8");
console.log("\n✅ 已还原 patch（" + Buffer.byteLength(FULL) + " B）");
