/**
 * 探针：真实双击 vs cmd-spawn —— 同时追踪【壳 / 宿主 / 启动器 node / 控制台 cmd】四条线，
 * 判定"谁先死"。这是分辨「应用崩溃」与「启动器被回收」的关键。
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function all() {
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'DeepSeek|node|cmd' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
  try {
    const raw = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "buffer", timeout: 15000 });
    const t = raw.toString("utf8").replace(/^\uFEFF/, "").trim();
    return t ? [].concat(JSON.parse(t)) : [];
  } catch { return []; }
}
function classify(list) {
  const har = list.filter((p) => /DeepSeek Harness\.exe/i.test(p.Name || ""));
  const host = list.filter((p) => /@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js/i.test(p.CommandLine || ""));
  const launcher = list.filter((p) => /start-harness\.mjs/i.test(p.CommandLine || ""));
  const cmdsh = list.filter((p) => /^cmd\.exe$/i.test(p.Name || ""));
  return { har, host, launcher, cmdsh };
}

function killAll() { try { execFileSync("taskkill", ["/F", "/IM", "DeepSeek Harness.exe"], { stdio: "ignore" }); } catch {} }

async function trace(mode, label) {
  killAll();
  await wait(2500);
  const t0 = Date.now();
  if (mode === "shell") {
    const s = spawn("explorer.exe", [CMD], { detached: true, stdio: "ignore" });
    s.unref();
  } else {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const c = spawn("cmd.exe", ["/c", CMD], { detached: true, stdio: "ignore", env, windowsHide: true });
    c.unref();
  }
  const rows = [];
  console.log("\n──── " + label + " ────");
  for (let i = 0; i < 40; i++) {
    await wait(500);
    const c = classify(all());
    const sec = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
    const line = "t=" + sec + "s 壳=" + c.har.length + " 宿主=" + c.host.length + " 启动器=" + c.launcher.length + " cmd=" + c.cmdsh.length;
    rows.push(line);
    if (c.har.length || c.launcher.length) console.log(line);
    if (i > 8 && c.har.length === 0 && c.launcher.length === 0) { console.log("t=" + sec + "s （壳与启动器均无）停止"); break; }
  }
  killAll();
  fs.appendFileSync("logs/_r33-whodied.txt", "\n──── " + label + " ────\n" + rows.join("\n") + "\n");
}

try { fs.unlinkSync("logs/_r33-whodied.txt"); } catch {}
await trace("shell", "A · explorer.exe 真实双击");
await trace("cmdspawn", "B · spawn cmd.exe /c");
console.log("\n== 已写入 logs/_r33-whodied.txt ==");
