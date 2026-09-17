/**
 * 探针：用**桌面壳一模一样的 env** 直跑宿主，看能否复现 code 1。
 * env = { ...process.env, DSH_DESKTOP:"1" } + PATH/NODE_PATH/PLAYWRIGHT 被 preset 前置。
 * 用完即删。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.USERPROFILE || "C:\\Users\\15142";
const PRESET = path.join(HOME, ".dsh", "preset-runtime");
const HOST = "D:\\软件安装\\DeepSeek-Harness-Desktop\\DeepSeek Harness\\resources\\host";
const CLI = HOST + "\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";
const NODE = "C:\\Program Files\\nodejs\\node.exe";

const uniq = (v) => [...new Set(v.flatMap((x) => (x || "").split(";")).filter(Boolean))].join(";");

const base = { ...process.env };
delete base.ELECTRON_RUN_AS_NODE;
const env = {
  ...base,
  DSH_DESKTOP: "1",
  PATH: uniq([path.join(PRESET, "bin"), base.PATH]),
  NODE_PATH: uniq([path.join(PRESET, "packages", "node_modules"), base.NODE_PATH]),
  PLAYWRIGHT_BROWSERS_PATH: path.join(PRESET, "playwright-browsers"),
};

const t0 = Date.now();
const c = spawn(NODE, ["--expose-internals", CLI, "web", "--host", "127.0.0.1", "--port", "0"], {
  cwd: HOST, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let out = "", err = "";
c.stdout.on("data", (d) => { out += d.toString("utf8"); });
c.stderr.on("data", (d) => { err += d.toString("utf8"); });

let done = false;
const finish = (tag, code, sig) => {
  if (done) return;
  done = true;
  const body = ["tag=" + tag + " exit=" + code + " sig=" + sig + " ms=" + (Date.now() - t0),
    "== STDOUT ==", out, "== STDERR ==", err].join("\n");
  fs.writeFileSync("logs/_r33-hostshellenv.txt", body, "utf8");
  console.log(body.slice(0, 6000));
  process.exit(0);
};
c.on("exit", (code, sig) => finish("EXIT", code, sig));
c.on("error", (e) => finish("SPAWNERR " + e.message, "n/a", "n/a"));
console.log("pid=" + c.pid);
setTimeout(() => finish("ALIVE-35s", "n/a", "n/a"), 35000);
