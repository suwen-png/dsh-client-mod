/**
 * 探针：给宿主注入 unhandledRejection 钩子（通过 NODE_OPTIONS --import），
 * 把它**第一次**未处理拒绝的完整堆栈落盘。
 * 原理：壳 spawn 宿主时全量继承 env ⇒ 我设的 NODE_OPTIONS 会传到宿主。
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const HOOK = "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin\\logs\\_r33-hook.mjs";
fs.writeFileSync(HOOK, `
import fs from "node:fs";
const LOG = "D:\\\\hermes-data\\\\dsh-client-mod\\\\dsh-director-plugin\\\\logs\\\\_r33-rejection.txt";
process.on("unhandledRejection", (err) => {
  const body = "=== unhandledRejection @ " + new Date().toISOString() + " pid=" + process.pid + " ===\\n"
    + (err && err.stack ? err.stack : String(err)) + "\\n";
  try { fs.appendFileSync(LOG, body); } catch {}
  // 不阻止默认行为，让 failLoud 照常 exit(1)
});
`, "utf8");
try { fs.unlinkSync("logs/_r33-rejection.txt"); } catch {}

const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
// 通过环境变量把 NODE_OPTIONS 传给壳（壳全量继承 process.env 给宿主）
const env = { ...process.env, NODE_OPTIONS: "--import " + HOOK.replace(/\\/g, "/") };
delete env.ELECTRON_RUN_AS_NODE;

console.log("== 启动（带 unhandledRejection 钩子注入）==");
const c = spawn("cmd.exe", ["/c", CMD], { detached: true, stdio: "ignore", env, windowsHide: true });
c.unref();

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if (fs.existsSync("logs/_r33-rejection.txt")) {
    console.log("t=" + (i + 1) + "s 🔴 抓到未处理拒绝：");
    console.log(fs.readFileSync("logs/_r33-rejection.txt", "utf8").slice(0, 5000));
    break;
  }
  const raw = execFileSync("tasklist", [], { encoding: "buffer" }).toString("utf8");
  const n = (raw.match(/DeepSeek Harness\.exe/gi) || []).length;
  if (n === 0 && i > 6) { console.log("t=" + (i + 1) + "s 壳已退出，未捕获到 rejection"); break; }
}
if (!fs.existsSync("logs/_r33-rejection.txt")) {
  console.log("\n== 未捕获到 unhandledRejection ==");
  console.log("台账末 3:");
  console.log(fs.readFileSync("logs/harness-launch.log", "utf8").split(/\r?\n/).slice(-4).join("\n"));
}
