/**
 * 探针：整壳真实双击 + 全程追踪**宿主的父子链与死因**。
 * 手段：WMIC 查进程 CommandLine/ParentProcessId，逐秒记录，直到全灭。
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);

function ps() {
  // 用 PowerShell CIM 拿 PID / Parent / CommandLine（避免 GBK 问题：写文件再读）
  const script = [
    "Get-CimInstance Win32_Process |",
    "Where-Object { $_.Name -match 'DeepSeek|node|cmd' } |",
    "Select-Object ProcessId,ParentProcessId,Name,CommandLine |",
    "ConvertTo-Json -Compress",
  ].join(" ");
  try {
    const raw = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "buffer", timeout: 20000,
    });
    return JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, "") || "[]");
  } catch (e) {
    return [];
  }
}

const rows = [];
const shell = spawn("explorer.exe", [CMD], { detached: true, stdio: "ignore" });
shell.unref();
console.log("== 真实双击 " + CMD);

for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const all = [].concat(ps());
  const har = all.filter((p) => /DeepSeek Harness\.exe/i.test(p.Name || ""));
  const host = all.filter((p) => /dsh/i.test(p.CommandLine || "") && /bin\.js/i.test(p.CommandLine || ""));
  const line = "t=" + stamp() + "s 壳=" + har.length + " 宿主=" + host.length
    + (host.length ? " [hostpid=" + host.map((h) => h.ProcessId + "<-" + h.ParentProcessId).join(",") + "]" : "");
  rows.push(line);
  console.log(line);
  if (/DeepSeek/.test(line) === false && i > 6 && har.length === 0) break;
}
fs.writeFileSync("logs/_r33-track.txt", rows.join("\n"), "utf8");
console.log("\n== 台账末 6 ==");
console.log(fs.readFileSync("logs/harness-launch.log", "utf8").split(/\r?\n/).slice(-6).join("\n"));
