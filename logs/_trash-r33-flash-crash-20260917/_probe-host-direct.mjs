/**
 * 探针：直接按桌面壳的方式起宿主 CLI（node bin.js web --host 127.0.0.1 --port 0），
 * 抓 exit code + 完整 stderr。目的：复现 code 1 并看它自己怎么说。
 * 用完即删。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const HOST = "D:\\软件安装\\DeepSeek-Harness-Desktop\\DeepSeek Harness\\resources\\host";
const CLI = HOST + "\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";
const NODE = "C:\\Program Files\\nodejs\\node.exe";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.DSH_DESKTOP = "1";

const t0 = Date.now();
const c = spawn(NODE, ["--expose-internals", CLI, "web", "--host", "127.0.0.1", "--port", "0"], {
  cwd: HOST,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let out = "";
let err = "";
c.stdout.on("data", (d) => { out += d.toString("utf8"); });
c.stderr.on("data", (d) => { err += d.toString("utf8"); });

let done = false;
const finish = (tag, code, sig) => {
  if (done) return;
  done = true;
  const body = [
    "tag=" + tag + " exit=" + code + " sig=" + sig + " ms=" + (Date.now() - t0),
    "== STDOUT ==",
    out,
    "== STDERR ==",
    err,
  ].join("\n");
  fs.writeFileSync("logs/_r33-hostdir.txt", body, "utf8");
  console.log(body.slice(0, 6000));
  process.exit(0);
};

c.on("exit", (code, sig) => finish("EXIT", code, sig));
c.on("error", (e) => finish("SPAWNERR " + e.message, "n/a", "n/a"));
console.log("pid=" + c.pid + " cli=" + CLI);
setTimeout(() => finish("ALIVE-30s", "n/a", "n/a"), 30000);
