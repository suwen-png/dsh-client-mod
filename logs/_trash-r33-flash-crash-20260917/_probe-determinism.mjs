/**
 * 探针：确定性判定 —— 用**项目自己的**验证式停机做起点，连跑 N 轮，
 * 统计 OK/DIED，并把 outBytes 与结果配对（188=无更新检查, 255+=有）。
 * 这是判「确定性 vs 竞态」的唯一可靠方法。
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
const LOG = "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin\\logs\\harness-launch.log";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const harCount = () => (execFileSync("tasklist", [], { encoding: "buffer" }).toString("utf8").match(/DeepSeek Harness\.exe/gi) || []).length;

function stopVerified() {
  try {
    const out = execFileSync("node", ["scripts/stop-harness.mjs"], {
      cwd: "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin",
      encoding: "buffer", timeout: 60000,
    }).toString("utf8");
    const m = out.match(/停机前：(\d+) 个进程/);
    return m ? Number(m[1]) : -1;
  } catch { return -1; }
}

function lastLedger(n) {
  const lines = fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => /\d{4}-\d\d-\d\dT.*(OK|DIED|STARTED|TAKEN|NO_WINDOW)/.test(l));
  return lines.slice(-n);
}

const N = Number(process.argv[2] || 5);
const results = [];
for (let r = 1; r <= N; r++) {
  const before = stopVerified();
  await wait(3000);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const c = spawn("cmd.exe", ["/c", CMD], { detached: true, stdio: "ignore", env, windowsHide: true });
  c.unref();
  let peak = 0, goneAt = null;
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    await wait(500);
    const n = harCount();
    if (n > peak) peak = n;
    if (peak > 0 && n === 0) { goneAt = ((Date.now() - t0) / 1000).toFixed(1); break; }
  }
  const led = lastLedger(1)[0] || "(无)";
  const ob = (led.match(/outBytes=(\d+)/) || [])[1];
  const verdict = (led.match(/\b(OK|DIED|STARTED_THEN_REAPED)\b/) || [])[1];
  const ap = (led.match(/appeared=([\d.a-z]+)/) || [])[1];
  results.push({ r, peak, goneAt, ob, verdict, ap });
  console.log(
    "第" + r + "轮 [停机前=" + before + "] 峰值 " + peak
    + " · " + (goneAt ? "🔴 全灭 @" + goneAt + "s" : "✅ 存活")
    + " ｜ 台账 verdict=" + verdict + " appeared=" + ap + " outBytes=" + ob
  );
  try { execFileSync("taskkill", ["/F", "/IM", "DeepSeek Harness.exe"], { stdio: "ignore" }); } catch {}
}

console.log("\n════ 汇总 ════");
const ok = results.filter((x) => x.verdict === "OK").length;
console.log("OK=" + ok + " / DIED=" + results.filter((x) => x.verdict === "DIED").length + " / 峰值0=" + results.filter((x) => x.peak === 0).length + " （共 " + N + "）");
console.log("outBytes 配对：" + results.map((x) => x.verdict + "@" + x.ob).join(", "));
