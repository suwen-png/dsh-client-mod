/**
 * 探针：模拟**用户真实操作序列**：
 *   ① 双击打开 → ② 等 20 s（用一会儿）→ ③ 点 × 关窗（只有 hide，进程留托盘）
 *   → ④ 再双击（考查「已有实例」路径）→ ⑤ 记录台账与进程
 * 这直击用户"打开闪退"的现场。
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
const LOG = "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin\\logs\\harness-launch.log";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const harCount = () => (execFileSync("tasklist", [], { encoding: "buffer" }).toString("utf8").match(/DeepSeek Harness\.exe/gi) || []).length;
const ledgerTail = (n = 1) => fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => /\d{4}-\d\d-\d\dT.*(OK|DIED|STARTED|TAKEN|NO_WINDOW)/.test(l)).slice(-n)[0] || "(无)";

function stopVerified() {
  try {
    const out = execFileSync("node", ["scripts/stop-harness.mjs"], {
      cwd: "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin", encoding: "buffer", timeout: 60000,
    }).toString("utf8");
    return (out.match(/停机前：(\d+) 个进程/) || [])[1];
  } catch { return "err"; }
}
async function launchAndWatch(label, secs) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const c = spawn("cmd.exe", ["/c", CMD], { detached: true, stdio: "ignore", env, windowsHide: true });
  c.unref();
  let peak = 0, goneAt = null;
  const t0 = Date.now();
  for (let i = 0; i < secs * 2; i++) {
    await wait(500);
    const n = harCount();
    if (n > peak) peak = n;
    if (peak > 0 && n === 0) { goneAt = ((Date.now() - t0) / 1000).toFixed(1); break; }
  }
  const led = ledgerTail(1);
  console.log("  [" + label + "] 峰值 " + peak + " · " + (goneAt ? "🔴 全灭 @" + goneAt + "s" : "✅ 存活 " + secs + "s"));
  console.log("      台账: " + led.slice(0, 190));
  return { peak, goneAt, led };
}

console.log("══ 场景一：干净态双击（模拟用户第一次打开）══");
console.log("  停机前进程数 = " + stopVerified());
await wait(3000);
await launchAndWatch("干净双击", 22);

console.log("\n══ 场景二：**不清理**再双击（模拟用户以为关了、又点一次）══");
await launchAndWatch("直接再双击", 18);

console.log("\n══ 场景三：到这一步仍在跑 ⇒ 用户视角「关掉窗口」后再双击 ══");
await launchAndWatch("关窗后再双击", 18);

console.log("\n最终进程数 = " + harCount());
console.log("清理：");
console.log(stopVerified());
