/**
 * 探针：整壳启动 → 抓宿主**完整** stdout+stderr → 看 code 1 前它到底说了什么。
 * 用完即删，不入仓。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const EXE = "D:\\软件安装\\DeepSeek-Harness-Desktop\\DeepSeek Harness\\DeepSeek Harness.exe";
const CWD = "D:\\软件安装\\DeepSeek-Harness-Desktop\\DeepSeek Harness";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const t0 = Date.now();
const c = spawn(EXE, ["--remote-debugging-port=9333"], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  cwd: CWD,
  env,
  windowsHide: true,
});
let stdout = "";
let stderr = "";
c.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
c.stderr.on("data", (d) => { stderr += d.toString("utf8"); });

let done = false;
const finish = (tag, code, sig) => {
  if (done) return;
  done = true;
  const ms = Date.now() - t0;
  const body = [
    "tag=" + tag,
    "exit=" + code + " sig=" + sig + " ms=" + ms,
    "== STDOUT (" + stdout.length + " B) ==",
    stdout,
    "== STDERR (" + stderr.length + " B) ==",
    stderr,
  ].join("\n");
  fs.writeFileSync("logs/_r33-host-full.txt", body, "utf8");
  console.log(body);
  process.exit(0);
};

c.on("exit", (code, sig) => finish("EXIT", code, sig));
c.on("error", (e) => { console.log("SPAWN ERROR: " + e.message); finish("ERROR", "n/a", "n/a"); });
console.log("pid=" + c.pid + " argv=[--remote-debugging-port=9333]");
setTimeout(() => finish("TIMEOUT-ALIVE-45s", "n/a", "n/a"), 45000);
