/**
 * `_rm-run.mjs` — 真机闸门批量运行器（临时工具，与 _offline-run.mjs 配对）
 *
 * 用途：顺序跑给定的 CDP 真机闸门（一次一个进程，共享同一页面），
 * 日志落 `logs/_rm-run-<ts>.log`（UTF-8，node 原样写盘，避开 PS 重定向编码坑），
 * 控制台只打印每套的 tail 摘要。
 *
 * 用法：node scripts/_rm-run.mjs verify-v22.mjs verify-flow.mjs ...
 * 退出码：0 / 1（任一红）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const gates = process.argv.slice(2);
if (!gates.length) { console.log("usage: node scripts/_rm-run.mjs <gate.mjs>..."); process.exit(2); }

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = path.join(root, "logs", "_rm-run-" + ts + ".log");
const blocks = [];
let fails = 0;

for (const g of gates) {
	const fp = path.join(root, "scripts", g);
	if (!fs.existsSync(fp)) { console.log("!! missing: " + g); fails++; continue; }
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [fp], { cwd: root, encoding: "utf8", timeout: 20 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 });
	const dt = ((Date.now() - t0) / 1000).toFixed(1);
	const out = (r.stdout || "") + "\n" + (r.stderr || "");
	const code = r.status == null ? "null" : r.status;
	blocks.push("========== " + g + " (exit=" + code + ", " + dt + "s) ==========\n" + out);
	const tail = out.split(/\r?\n/).filter((l) => l.trim()).slice(-8).join("\n  ");
	console.log("──── " + g + "  exit=" + code + "  " + dt + "s ────");
	console.log("  " + tail + "\n");
	if (r.status !== 0) fails++;
}

fs.writeFileSync(logPath, blocks.join("\n\n"), "utf8");
console.log("全量日志: " + path.relative(root, logPath));
console.log("汇总: " + (gates.length - fails) + "/" + gates.length + " 套 exit=0");
process.exit(fails ? 1 : 0);
