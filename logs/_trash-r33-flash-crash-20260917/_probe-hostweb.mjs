/**
 * 探针：直接跑宿主的 web profile（不经过壳），加载 hcc 插件，抓它的异常。
 * 关键：这次让**全量**插件树加载（含 director + hcc），看宿主是否 code 1。
 * 用完即删。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HOST = "D:\\软件安装\\DeepSeek-Harness-Desktop\\DeepSeek Harness\\resources\\host";
const CLI = HOST + "\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const HOME = "C:\\Users\\15142";
const PRESET = path.join(HOME, ".dsh", "preset-runtime");

const uniq = (v) => [...new Set(v.flatMap((x) => (x || "").split(";")).filter(Boolean))].join(";");
const base = { ...process.env };
delete base.ELECTRON_RUN_AS_NODE;
const env = {
  ...base,
  DSH_DESKTOP: "1",
  HOME,
  USERPROFILE: HOME,
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
  fs.writeFileSync("logs/_r33-hostweb.txt", body, "utf8");
  console.log(body.slice(0, 8000));
  process.exit(0);
};
c.on("exit", (code, sig) => finish("EXIT", code, sig));
c.on("error", (e) => finish("SPAWNERR " + e.message, "n/a", "n/a"));
console.log("pid=" + c.pid + "（web profile，含 director + hcc）");
setTimeout(() => finish("ALIVE-40s", "n/a", "n/a"), 40000);
