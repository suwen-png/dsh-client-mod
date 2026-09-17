/**
 * 探针：统计纯 env（无钩子）下的崩溃率。用完即删。
 */
import { execFileSync, spawn } from "node:child_process";

const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const harCount = () => (execFileSync("tasklist", [], { encoding: "buffer" }).toString("utf8").match(/DeepSeek Harness\.exe/gi) || []).length;

const N = Number(process.argv[2] || 6);
let died = 0, alive = 0;
for (let r = 1; r <= N; r++) {
  try { execFileSync("taskkill", ["/F", "/IM", "DeepSeek Harness.exe"], { stdio: "ignore" }); } catch {}
  await wait(2500);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const c = spawn("cmd.exe", ["/c", CMD], { detached: true, stdio: "ignore", env, windowsHide: true });
  c.unref();
  let peak = 0, goneAt = null;
  const t0 = Date.now();
  for (let i = 0; i < 26; i++) {
    await wait(500);
    const n = harCount();
    if (n > peak) peak = n;
    if (peak > 0 && n === 0) { goneAt = ((Date.now() - t0) / 1000).toFixed(1); break; }
  }
  if (goneAt) { died++; console.log("第 " + r + " 轮：峰值 " + peak + " · 🔴 全灭 @" + goneAt + "s"); }
  else { alive++; console.log("第 " + r + " 轮：峰值 " + peak + " · ✅ 存活"); }
  try { execFileSync("taskkill", ["/F", "/IM", "DeepSeek Harness.exe"], { stdio: "ignore" }); } catch {}
}
console.log("\n== 汇总：存活 " + alive + " / 崩溃 " + died + " (共 " + N + ") ==");
