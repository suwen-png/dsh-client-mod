/**
 * 探针：精确到 0.2 s 的死亡时刻表 —— 判定「宿主先死」还是「壳先退」。
 * 同时探测更新检查（5 s 定时器）是否为扳机。
 * 用法：node scripts/_probe-timeline.mjs [--hold]
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);

/** 用 PowerShell CIM 一次性拿全部相关进程 */
function ps() {
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'DeepSeek|node|cmd' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
  try {
    const raw = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "buffer", timeout: 15000 });
    const txt = raw.toString("utf8").replace(/^\uFEFF/, "").trim();
    return txt ? JSON.parse(txt) : [];
  } catch { return []; }
}

const shell = spawn("explorer.exe", [CMD], { detached: true, stdio: "ignore" });
shell.unref();
console.log("== 双击 " + CMD + " · 0.2s 采样 ==");

const rows = [];
let hostPort = null;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 200));
  const all = [].concat(ps());
  const har = all.filter((p) => /DeepSeek Harness\.exe/i.test(p.Name || ""));
  const host = all.filter((p) => /bin\.js[\s\S]*web|dsh[\s\S]*bin\.js/i.test(p.CommandLine || ""));
  // 从启动器 out 文件里抠宿主端口
  try {
    const out = fs.readFileSync("logs/_harness-launch-9223.out", "utf8");
    const m = out.match(/dsh web: http:\/\/127\.0\.0\.1:(\d+)/);
    if (m && m[1] !== hostPort) { hostPort = m[1]; console.log("t=" + stamp() + "s  ★ 宿主端口 " + hostPort); }
  } catch {}

  let portOk = "n/a";
  if (hostPort) {
    portOk = await new Promise((res) => {
      const s = net.connect({ host: "127.0.0.1", port: Number(hostPort) }, () => { s.destroy(); res("open"); });
      s.on("error", () => res("closed"));
      s.setTimeout(300, () => { s.destroy(); res("timeout"); });
    });
  }
  const line = "t=" + stamp() + "s 壳=" + har.length + " 宿主=" + host.length + " 宿主端口=" + portOk;
  rows.push(line);
  if (har.length || host.length) console.log(line);
  if (i > 15 && !har.length && !host.length) { console.log("t=" + stamp() + "s 全灭，停止采样"); break; }
}
fs.writeFileSync("logs/_r33-timeline.txt", rows.join("\n"), "utf8");
console.log("\n== 台账末 3 ==");
console.log(fs.readFileSync("logs/harness-launch.log", "utf8").split(/\r?\n/).slice(-4).join("\n"));
