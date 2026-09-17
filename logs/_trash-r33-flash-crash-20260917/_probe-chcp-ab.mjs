/**
 * 探针：A/B —— 真实双击（explorer.exe）下，`chcp 65001` 有无 对崩溃率的影响。
 * A = 桌面 Start Harness.cmd（含 chcp）
 * B = scripts/_r33-nocp.cmd（去掉 chcp）
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const A = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
const B = "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin\\scripts\\_r33-nocp.cmd";
const BLOG = "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin\\logs\\_r33-nocp.log";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const harCount = () => (execFileSync("tasklist", [], { encoding: "buffer" }).toString("utf8").match(/DeepSeek Harness\.exe/gi) || []).length;

function killAll() {
  try { execFileSync("taskkill", ["/F", "/IM", "DeepSeek Harness.exe"], { stdio: "ignore" }); } catch {}
}

async function trial(cmd, tag, rounds) {
  const res = [];
  for (let r = 1; r <= rounds; r++) {
    killAll();
    await wait(2500);
    const shell = spawn("explorer.exe", [cmd], { detached: true, stdio: "ignore" });
    shell.unref();
    let peak = 0, goneAt = null;
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) {
      await wait(500);
      const n = harCount();
      if (n > peak) peak = n;
      if (peak > 0 && n === 0) { goneAt = ((Date.now() - t0) / 1000).toFixed(1); break; }
    }
    const ok = goneAt === null;
    res.push(ok);
    console.log("  [" + tag + "] 第 " + r + " 轮：峰值 " + peak + " · " + (ok ? "✅ 存活" : "🔴 全灭 @" + goneAt + "s"));
  }
  killAll();
  return res;
}

console.log("== A 组：真实双击桌面 Start Harness.cmd（含 chcp 65001）==");
const a = await trial(A, "A含chcp", 3);
console.log("\n== B 组：真实双击 _r33-nocp.cmd（已去掉 chcp）==");
const b = await trial(B, "B无chcp", 3);

console.log("\n════ 汇总 ════");
console.log("A（含 chcp 65001）：存活 " + a.filter(Boolean).length + "/" + a.length);
console.log("B（无 chcp）     ：存活 " + b.filter(Boolean).length + "/" + b.length);
if (fs.existsSync(BLOG)) {
  console.log("\nB 组台账末 6 行：");
  console.log(fs.readFileSync(BLOG, "utf8").split(/\r?\n/).slice(-7).join("\n"));
}
