/**
 * `_offline-run.mjs` — 离线闸门批量运行器（临时工具）
 *
 * 用途：一条命令跑完全部**离线**闸门（自动跳过需要 CDP 的真机套），
 * 输出逐套 tail 摘要 + 总表，日志落 `logs/_offline-run-<ts>.log`。
 *
 * 用法：node scripts/_offline-run.mjs
 * 退出码：0（全部绿或已跳过真机套） / 1（有套件红）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const scriptsDir = path.join(root, "scripts");

const files = fs.readdirSync(scriptsDir).filter((f) =>
	/^(lint-|verify-|test-|prove-).*\.mjs$/.test(f) && !f.startsWith("_")
).sort();

const isRealMachine = (fp) => {
	const s = fs.readFileSync(fp, "utf8");
	return /webSocketDebuggerUrl|\/json\/list|connectOverCDP/.test(s);
};

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = path.join(root, "logs", "_offline-run-" + ts + ".log");
fs.mkdirSync(path.dirname(logPath), { recursive: true });
const logLines = [];

const results = [];
for (const f of files) {
	const fp = path.join(scriptsDir, f);
	if (isRealMachine(fp)) { results.push({ name: f, status: "SKIP-RM" }); continue; }
	const args = [fp];
	if (f === "verify-dialog.mjs") args.push("--import", "./scripts/_platform-stub.mjs");
	// 注意：--import 必须放 node 参数位，重排
	let cmd, cmdArgs;
	if (f === "verify-dialog.mjs") {
		cmd = process.execPath; cmdArgs = ["--import", "./scripts/_platform-stub.mjs", fp];
	} else { cmd = process.execPath; cmdArgs = [fp]; }
	let r;
	try {
		r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
	} catch (e) {
		results.push({ name: f, status: "ERROR", tail: String(e && e.message) });
		continue;
	}
	const out = (r.stdout || "") + "\n" + (r.stderr || "");
	const code = r.status == null ? "null" : r.status;
	const lines = out.split(/\r?\n/).filter((l) => l.trim().length > 0);
	const tail = lines.slice(-4).join(" ｜ ");
	const passM = out.match(/通过\s*(\d+)\s*[\/／]\s*失败\s*(\d+)/) || out.match(/通过\s*(\d+)[^\d]+失败\s*(\d+)[^\d]+跳过\s*(\d+)/);
	// 兼容：找 "IS_PASS: TRUE/FALSE"
	const isPass = /IS_PASS:\s*TRUE/.test(out) ? "TRUE" : /IS_PASS:\s*FALSE/.test(out) ? "FALSE" : "?";
	results.push({ name: f, status: code === 0 ? "PASS" : code === 2 ? "INVALID" : "FAIL", code, isPass, tail });
	logLines.push("\n\n========== " + f + " (exit=" + code + ") ==========\n" + out);
}
fs.writeFileSync(logPath, logLines.join("\n"), "utf8");

console.log("离线闸门批量结果（" + ts + "）");
console.log("日志：" + path.relative(root, logPath));
console.log("");
let nPass = 0, nFail = 0, nOther = 0, nSkip = 0;
for (const r of results) {
	if (r.status === "SKIP-RM") { nSkip++; continue; }
	if (r.status === "PASS") nPass++; else if (r.status === "FAIL" || r.status === "ERROR") nFail++; else nOther++;
	console.log(
		(r.status === "PASS" ? "  OK   " : r.status === "SKIP-RM" ? "  --   " : "  !!   ") +
		r.name.padEnd(30) + " exit=" + r.code + " IS_PASS=" + (r.isPass || "-")
	);
	if (r.status !== "PASS" && r.status !== "SKIP-RM") console.log("        tail: " + String(r.tail).slice(0, 300));
}
console.log("");
console.log("汇总：PASS=" + nPass + "  FAIL/ERR=" + nFail + "  INVALID/其他=" + nOther + "  真机套跳过=" + nSkip + "  总计=" + results.length);
process.exit(nFail > 0 ? 1 : 0);
