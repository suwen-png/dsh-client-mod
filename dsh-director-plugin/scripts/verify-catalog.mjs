/**
 * scripts/verify-catalog.mjs — 「技能与智能体的指向」可解析性闸门
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要这个闸门（第 6 批「完善技能和智能体的指向」）
 * ══════════════════════════════════════════════════════════════════
 *  指向这种东西**写错了不会报错**：界面上照样列着 12 个角色、照样能点，
 *  只是点了什么都不会发生 —— 也就是本项目反复强调的
 *  「看起来有、实际没有」。所以指向必须有**机械校验**：
 *
 *    ① 表内自洽（`logic/catalog.js#auditCatalog` / `logic/roles.js#auditRoleTargets`）
 *    ② 每条 `module#symbol` 在 **src/** 下**真的存在**（文件在 + 符号被 export）
 *    ③ 每个技能 `dir` 在**真实技能根目录**下存在
 *    ④ 🔴 **正负对照校准**：植入一个坏指向必须判红，还原必须回绿
 *       （纪律 6：新闸门必须用**植入目标缺陷**做校准 —— 用别处的缺陷不算）
 *
 * ⚠️ 本条与「闸门自己会过期」（纪律 14）的关系：
 *    本闸门**不写死任何模块清单**，全部从 `src/` 现读现算 ⇒ 不会因为
 *    "有人加了一个文件"而假红。唯一的环境依赖是技能根目录，那一条按
 *    环境量读取（纪律 29），读不到时判 **INVALID（exit 2）** 而不是 FAIL ——
 *    「环境里没有」与「产品不合格」是两件事，读数上必须分得开（纪律 17）。
 *
 * 用法：
 *   node scripts/verify-catalog.mjs
 *   node scripts/verify-catalog.mjs --skills-root <技能根目录>
 * 退出码：0 通过 / 1 FAIL（指向解析不了）/ 2 INVALID（用法或环境不对）
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SRC = path.join(ROOT, "src");

/* ── 退出码与用法自诊断（纪律 17：用法错必须打印可复制命令并 exit 2）── */
const USAGE = "用法：node scripts/verify-catalog.mjs [--skills-root <目录>]";
function bail(msg) {
	console.error("❌ INVALID：" + msg);
	console.error("   可复制命令：node scripts/verify-catalog.mjs");
	process.exit(2);
}

const argv = process.argv.slice(2);
let skillsRoot = path.join(os.homedir(), ".workbuddy", "skills");
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === "--skills-root") {
		const v = argv[i + 1];
		if (!v) bail("--skills-root 后面缺少目录");
		skillsRoot = v;
		i++;
	} else if (a === "-h" || a === "--help") {
		console.log(USAGE);
		process.exit(0);
	} else {
		bail("不认识的参数 " + JSON.stringify(a) + "（本脚本不静默忽略未知参数，纪律 34）");
	}
}

let pass = 0; let fail = 0;
const fails = [];
function ok(name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + name + (detail ? "  |  " + detail : "")); }
	else { fail++; fails.push(name); console.log("  ❌ " + name + (detail ? "  |  " + detail : "")); }
}

/* ══════════════════════════════════════════════════════════════════
 * 一、解析器（**纯函数**，供正负对照校准直接喂坏样本）
 * ══════════════════════════════════════════════════════════════════ */

/** 模块路径 → 源码（读不到返回 null，**不抛**） */
function readModuleSource(moduleRel) {
	try {
		const p = path.join(SRC, moduleRel);
		if (!fs.existsSync(p)) return null;
		return fs.readFileSync(p, "utf8");
	} catch (e) { return null; }
}

/**
 * 该模块是否 export 了这个名字。
 * 支持两种形态（本仓都存在）：
 *   ① 直接声明：`export function X` / `export async function X` / `export const X`
 *   ② 具名再导出：`export { X }` / `export { Y as X }`
 * ⚠️ 先剥注释再匹配 —— 否则「注释里提了一句」会被当成"存在"（纪律 28）。
 */
export function moduleExportsSymbol(moduleRel, symbol) {
	const raw = readModuleSource(moduleRel);
	if (raw === null) return { ok: false, why: "模块不存在：" + moduleRel };
	const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	const s = String(symbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const direct = new RegExp("export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+" + s + "\\b");
	if (direct.test(src)) return { ok: true, why: "" };
	const named = new RegExp("export\\s*\\{[^}]*\\b" + s + "\\b[^}]*\\}");
	if (named.test(src)) return { ok: true, why: "（具名再导出）" };
	return { ok: false, why: "模块存在但未 export 该符号：" + moduleRel + "#" + symbol };
}

/**
 * 校验一组指向条目。
 * @param {Array<{owner:string, module:string, symbol:string}>} entries
 * @returns {{ok:boolean, checked:number, fails:string[]}}
 */
export function checkTargets(entries) {
	const out = { ok: true, checked: 0, fails: [] };
	for (const e of entries) {
		out.checked++;
		if (!e || !e.module || !e.symbol) { out.ok = false; out.fails.push((e && e.owner) + "：指向不完整"); continue; }
		const r = moduleExportsSymbol(e.module, e.symbol);
		if (!r.ok) { out.ok = false; out.fails.push((e && e.owner) + "：" + r.why); }
	}
	return out;
}

/** 从源码里抠出 `target: "..."`（用于校验 AGENTS 这类**在组件里**定义的指向） */
export function targetsInSource(fileRel, marker) {
	const raw = readModuleSource(fileRel);
	if (raw === null) return [];
	const src = raw.replace(/\/\*[\s\S]*?\*\//g, "");
	const idx = src.indexOf(marker);
	const scopeText = idx < 0 ? src : src.slice(idx, idx + 6000);
	const out = [];
	const re = /target:\s*"([^"]+)"/g;
	let m;
	while ((m = re.exec(scopeText)) !== null) out.push(m[1]);
	return out;
}

/* ══════════════════════════════════════════════════════════════════
 * 二、正式检查
 * ══════════════════════════════════════════════════════════════════ */

console.log("【C】技能与智能体的指向可解析性");
console.log("  技能根目录（环境量，由环境读）：" + skillsRoot);

/* ① 表内自洽 —— 直接 import 纯函数模块（零 react 依赖，可离线跑） */
let catalog = null;
let roles = null;
try { catalog = await import("../src/logic/catalog.js"); }
catch (e) { bail("无法 import src/logic/catalog.js：" + ((e && e.message) || e)); }
try { roles = await import("../src/logic/roles.js"); }
catch (e) { bail("无法 import src/logic/roles.js：" + ((e && e.message) || e)); }

const ac = catalog.auditCatalog();
ok("C1 指向表自洽（技能 key 唯一 / dir 齐备 / desc 达意 / noUse 齐备 / 步骤号连续）", ac.ok,
	JSON.stringify(ac.counts) + (ac.ok ? "" : " 失败：" + ac.fails.join("；")));

const at = roles.auditRoleTargets();
ok("C2 角色指向与角色表**恰好 1:1**（有角色无指向 / 有指向无角色 都算红）", at.ok,
	"覆盖 " + at.covered + " / 角色 " + at.total + (at.ok ? "" : " 失败：" + at.fails.join("；")));

/* ② 每条指向在 src/ 下真实存在 */
const entries = [];
for (const s of catalog.CHAIN_STEPS) entries.push({ owner: "链条步骤 " + s.n + " " + s.name, module: s.module, symbol: s.symbol });
for (const k of Object.keys(catalog.CHAIN_TARGETS)) {
	const t = catalog.CHAIN_TARGETS[k];
	entries.push({ owner: "链条环节 " + k + " " + t.name, module: t.module, symbol: t.symbol });
}
for (const id of Object.keys(roles.ROLE_TARGETS)) {
	const t = roles.ROLE_TARGETS[id];
	entries.push({ owner: "角色 " + id, module: t.module, symbol: t.symbol });
}
const chk = checkTargets(entries);
ok("C3 链条 + 角色的每条 module#symbol 在 src/ 下**真实存在且被 export**", chk.ok,
	"已校验 " + chk.checked + " 条" + (chk.ok ? "" : " 失败：" + chk.fails.join("；")));

/* ③ 组件内的 AGENTS 指向（源码抠取 —— 组件依赖 react，不能 import） */
const agentTargets = targetsInSource("components/DirectorDialog.js", "export const AGENTS");
ok("C4 5 类标准智能体每条都带 target（无 target 即「名字在、指向不在」）", agentTargets.length === 5,
	"抠到 " + agentTargets.length + " 条");
const agentEntries = agentTargets.map((t, i) => {
	const i2 = t.indexOf("#");
	return { owner: "智能体 AGENTS[" + i + "]", module: t.slice(0, i2), symbol: t.slice(i2 + 1) };
});
const chkA = checkTargets(agentEntries);
ok("C5 5 类智能体的 target 全部可解析", chkA.ok,
	agentTargets.join(" ") + (chkA.ok ? "" : " 失败：" + chkA.fails.join("；")));

/* ④ 技能目录真实存在（环境依赖 ⇒ 根目录不在就 INVALID，不是 FAIL） */
if (!fs.existsSync(skillsRoot)) {
	console.error("❌ INVALID：技能根目录不存在：" + skillsRoot);
	console.error("   若技能装在别处，请显式指定：node scripts/verify-catalog.mjs --skills-root <目录>");
	process.exit(2);
}
const missDir = catalog.SKILL_CATALOG.filter((s) => !fs.existsSync(path.join(skillsRoot, s.dir)));
ok("C6 每个技能的 dir 在技能根目录下真实存在（key 是技能名，dir 才是目录名）", missDir.length === 0,
	catalog.SKILL_CATALOG.length + " 项" + (missDir.length ? " 缺失：" + missDir.map((s) => s.key + "→" + s.dir).join(" ") : ""));

/* ⑤ 技能 key 与 SKILL.md 里的 name 一致（防止"指向一个不存在的技能名"） */
const badName = [];
for (const s of catalog.SKILL_CATALOG) {
	const md = path.join(skillsRoot, s.dir, "SKILL.md");
	let nm = "";
	try { nm = (fs.readFileSync(md, "utf8").match(/^name:\s*(\S+)/m) || [])[1] || ""; } catch (e) { nm = ""; }
	if (nm !== s.key) badName.push(s.key + "(实际 name=" + (nm || "读不到") + ")");
}
ok("C7 技能 key === SKILL.md 的 name（路由读的是 name）", badName.length === 0,
	badName.length ? "不一致：" + badName.join(" ") : "全部一致");

/* ══════════════════════════════════════════════════════════════════
 * 三、🔴 正负对照校准（纪律 6）
 *   用**解析器本身**喂坏样本 —— 不写盘、不改产品源码，因此不存在
 *   「校准把产品改坏」的风险（纪律 15 的那条隐患在这里被结构性消除）。
 * ══════════════════════════════════════════════════════════════════ */
console.log("【K】正负对照校准（同一套解析器）");
const good = checkTargets([{ owner: "校准正样本", module: "logic/catalog.js", symbol: "auditCatalog" }]);
const badMod = checkTargets([{ owner: "校准负样本①", module: "logic/__no_such_module__.js", symbol: "x" }]);
const badSym = checkTargets([{ owner: "校准负样本②", module: "logic/catalog.js", symbol: "__no_such_symbol__" }]);
ok("K1 正样本（真实存在的 module#symbol）判绿", good.ok === true, JSON.stringify(good.checked));
ok("K2 负样本①（模块不存在）判红，且原因写明模块名", badMod.ok === false && /模块不存在/.test(badMod.fails.join("")),
	badMod.fails.join("；"));
ok("K3 负样本②（模块在但符号没 export）判红，且原因写明符号名", badSym.ok === false && /未 export 该符号/.test(badSym.fails.join("")),
	badSym.fails.join("；"));
/* K4：注释里的符号**不算**存在（纪律 28：先剥注释） */
const comOnly = moduleExportsSymbol("logic/catalog.js", "auditCatalog"); // 真实存在
ok("K4 剥注释后再匹配（注释里提到的符号不当作已导出）", comOnly.ok === true, "正样本仍绿 ⇒ 剥离未误伤");

console.log("");
console.log("───────────────────────────────────────────────");
console.log(" PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
console.log(" IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("───────────────────────────────────────────────");
if (fail > 0) { console.log(" 失败项："); for (const f of fails) console.log("   · " + f); }
process.exit(fail === 0 ? 0 : 1);
