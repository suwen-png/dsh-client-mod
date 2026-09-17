/**
 * 探针：真实双击（explorer.exe）路径复现 + 从外部旁路取证。
 * 关键：**不做**任何 spawn 持有 —— 完全复刻用户双击的环境。
 * 旁路：轮询 tasklist（node buffer 读法）+ 端口监听 + 窗口标题。
 * 用完即删。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const CMD = "C:\\Users\\15142\\Desktop\\Start Harness.cmd";
const t0 = Date.now();
const stamp = () => String(((Date.now() - t0) / 1000).toFixed(1)).padStart(5);

function snap() {
  const raw = execFileSync("tasklist", ["/V", "/FO", "CSV"], { encoding: "buffer" }).toString("utf8");
  const rows = raw.split(/\r?\n/).filter((l) => /DeepSeek|Harness/i.test(l));
  const procs = [];
  const titles = [];
  for (const r of rows) {
    const cols = r.split('","').map((s) => s.replace(/^"|"$/g, ""));
    procs.push(cols[1]);
    titles.push(cols[8] || "");
  }
  const nodes = execFileSync("tasklist", ["/FO", "CSV"], { encoding: "buffer" }).toString("utf8")
    .split(/\r?\n/).filter((l) => /node\.exe/i.test(l)).length;
  return { procs, titles, nodes };
}

console.log("== 真实双击：" + CMD);
// ShellExecute 路径 = 真实双击
const shell = spawn("explorer.exe", [CMD], { detached: true, stdio: "ignore" });
shell.unref();

let last = "";
const log = [];
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const s = snap();
  const key = s.procs.length + "|" + s.titles.join(";");
  if (key !== last) {
    const line = "t=" + stamp() + "s har=" + s.procs.length + " node=" + s.nodes + " titles=[" + s.titles.filter(Boolean).join(" | ") + "]";
    console.log(line);
    log.push(line);
    last = key;
  }
  if (i === 39) console.log("t=" + stamp() + "s 轮询结束");
}

fs.writeFileSync("logs/_r33-dblclick.txt", log.join("\n"), "utf8");
console.log("\n== 台账 ==");
console.log(fs.readFileSync("logs/harness-launch.log", "utf8").split(/\r?\n/).slice(-8).join("\n"));
