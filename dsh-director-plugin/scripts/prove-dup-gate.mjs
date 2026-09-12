// 反证：新闸门 lintDuplicateFnDecl 真的会红（注入重复声明 → 期望构建失败 → 字节级还原）
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const NODE = process.execPath;
const FILE = "src/components/DirectorPage.js";
const orig = readFileSync(FILE);
const md5 = (b) => createHash("md5").update(b).digest("hex");

const anchor = "\treturn h(\"div\", {\n\t\tid: DIRECTOR_PAGE_ID";
const idx = orig.toString("utf8").indexOf(anchor);
if (idx < 0) { console.log("❌ 未找到注入锚点，放弃"); process.exit(1); }

const dup = "\t/* 反证注入：与上方 flatNodes 同作用域同名 */\n\tfunction flatNodes() { return []; }\n";
const injected = Buffer.concat([
	Buffer.from(orig.toString("utf8").slice(0, idx), "utf8"),
	Buffer.from(dup, "utf8"),
	Buffer.from(orig.toString("utf8").slice(idx), "utf8"),
]);
console.log("原文 md5=" + md5(orig) + " size=" + orig.length);
writeFileSync(FILE, injected);
console.log("已注入重复声明，md5=" + md5(readFileSync(FILE)));

const r = spawnSync(NODE, ["build/build.mjs"], { encoding: "utf8", cwd: process.cwd() });
const out = (r.stdout || "") + (r.stderr || "");
const red = r.status !== 0 && /重复的函数声明/.test(out);
console.log("构建 exit=" + r.status + " ｜ 报出「重复的函数声明」=" + /重复的函数声明/.test(out));
console.log((out.split("\n").filter((l) => /重复的函数声明|第 \d+ 行|修正：/.test(l)).join("\n") || "(无相关输出)"));
console.log(red ? "✅ 反证成立：闸门可红" : "❌ 反证失败：闸门没拦住");

writeFileSync(FILE, orig);
const back = readFileSync(FILE);
console.log("已还原 md5=" + md5(back) + " size=" + back.length
	+ " ｜ 字节级一致=" + (md5(back) === md5(orig))
	+ " ｜ flatNodes 声明数=" + (back.toString("utf8").split("function flatNodes(").length - 1));

const r2 = spawnSync(NODE, ["build/build.mjs"], { encoding: "utf8", cwd: process.cwd() });
console.log("还原后重建 exit=" + r2.status + (r2.status === 0 ? " ✅ 恢复绿" : " ❌ 仍未通过"));
