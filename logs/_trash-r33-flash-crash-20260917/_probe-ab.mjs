/**
 * 探针：把 electron-updater 的更新源**指向黑洞**，验证「5s 更新检查 ⇒ 宿主 code 1」。
 * 手法：在壳的用户级 updater 缓存目录写一张覆盖用的 app-update.yml？不可行。
 * 改用更可靠的路径：设置代理环境变量让 checkForUpdates 失败，
 * 同时用 unhandledRejection 钩子抓宿主的诊断。
 * 对照：连跑 3 次，看 DIED 是否复现。
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
const HOOK = "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin\\logs\\_r33-hook2.mjs";

fs.writeFileSync(HOOK, `
import fs from "node:fs";
const LOG = "D:\\\\hermes-data\\\\dsh-client-mod\\\\dsh-director-plugin\\\\logs\\\\_r33-rejection2.txt";
const rec = (tag, err) => {
  const body = "[" + tag + "] " + new Date().toISOString() + " pid=" + process.pid + "\\n"
    + (err && err.stack ? err.stack : String(err)) + "\\n\\n";
  try { fs.appendFileSync(LOG, body); } catch {}
};
process.on("unhandledRejection", (e) => rec("REJECTION", e));
process.on("uncaughtException", (e) => rec("EXCEPTION", e));
`, "utf8");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function harCount() {
  const raw = execFileSync("tasklist", [], { encoding: "buffer" }).toString("utf8");
  return (raw.match(/DeepSeek Harness\.exe/gi) || []).length;
}

const ROUNDS = Number(process.argv[2] || 3);
for (let r = 1; r <= ROUNDS; r++) {
  try { fs.unlinkSync("logs/_r33-rejection2.txt"); } catch {}
  // 每一轮：先停机
  try { execFileSync("taskkill", ["/F", "/IM", "DeepSeek Harness.exe"], { stdio: "ignore" }); } catch {}
  await wait(2500);

  const env = { ...process.env, NODE_OPTIONS: "--import " + HOOK.replace(/\\/g, "/") };
  delete env.ELECTRON_RUN_AS_NODE;
  const c = spawn("cmd.exe", ["/c", CMD], { detached: true, stdio: "ignore", env, windowsHide: true });
  c.unref();

  let peak = 0, goneAt = null;
  const t0 = Date.now();
  for (let i = 0; i < 22; i++) {
    await wait(500);
    const n = harCount();
    if (n > peak) peak = n;
    if (peak > 0 && n === 0 && goneAt === null) goneAt = ((Date.now() - t0) / 1000).toFixed(1);
    if (goneAt !== null && i > 3) break;
  }
  const rej = fs.existsSync("logs/_r33-rejection2.txt")
    ? fs.readFileSync("logs/_r33-rejection2.txt", "utf8").slice(0, 2500) : "(无 rejection)";
  console.log("── 第 " + r + " 轮：峰值 " + peak + " 进程 · " + (goneAt ? "全灭 @" + goneAt + "s" : "活着(未灭)"));
  if (rej !== "(无 rejection)") { console.log("   🔴 捕获："); console.log(rej); }
  console.log("");
}
