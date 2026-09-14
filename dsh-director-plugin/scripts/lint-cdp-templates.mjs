/**
 * lint-cdp-templates.mjs — 真机脚本「页内代码被反引号截断」静态检查
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 *   真机脚本的页内代码写在**模板字面量**里（`evalExpr(...)` / `ev(...)` / `js(...)` /
 *   甚至 `const ENUM = (sel) => \`...\``）。若模板内容（**哪怕是注释**）出现反引号，
 *   模板会提前闭合 ⇒ 整脚本无法解析，且报错行指向模板**起始行**，定位极反直觉。
 *   2026-09-12 同一坑连踩 4 次。
 *
 * ── 🔴 2026-09-14 加固（本闸门自己过期了，两次实证）──────────────
 *   过期形态①**覆盖面写死**：原实现 `FILES = [cdp-click-dialog, cdp-click]` 只有 2 个文件
 *     ⇒ `verify-walk.mjs` 第 91 行的注释反引号把模板串截断，**整脚本自第 4 批起无法解析**
 *     却没有任何闸门报警（是我跑真机套件时才撞上 SyntaxError）。
 *   过期形态②**只认一种写法**：原实现只匹配 `evalExpr(`。而模板字面量到处都有。
 *   ⇒ 现在：① 文件清单**动态枚举**（scripts/*.mjs + src/**\/*.js），新增文件自动纳入；
 *           ② 保留并**加宽**模板启发式（evalExpr / ev / js / ENUM 等）；
 *           ③ 增加**真语法扫描**（等价 `node --check`）—— 覆盖"提前闭合 ⇒ 直接不合法"这一整类，
 *              与启发式互补：启发式抓"改完仍能解析但模板内容已错"（更隐蔽的那种）。
 *
 * ── 判据 ──────────────────────────────────────────────────────
 *   A. 语法扫描：文件必须能被 Node 解析（ESM 顶层 await 也支持）。
 *   B. 模板启发式：对每个已知页内代码模板，扫描到**第一个未转义反引号**（=实际闭合点），
 *      其后继字符必须是 `,` `)` `;` `]` 或空白/行尾。若注释里的反引号提前闭合，
 *      后继会是 `*` / `/` / 字母 ⇒ 判非法。
 *
 * ── 自证灵敏度（防"防线空转"）────────────────────────────────
 *   ① 内置坏样本 / 好样本自检：坏样本必须被拦、好样本不得误报。
 *   ② 语法扫描自检：临时写一个**已知含语法错**的文件，必须被判红。
 *   ③ 枚举自检：必须真的枚举到文件（数量为 0 即视为防线空转 ⇒ INVALID）。
 *
 * 用法：node scripts/lint-cdp-templates.mjs        → exit 0 = 通过；1 = 有违规；2 = 自检/用法失败
 */
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BT = String.fromCharCode(96);

/* ── 动态枚举：不再写死清单（新增文件自动纳入，杜绝"闸门过期"） ── */
function walk(dir, exts, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === ".git") continue;
		const p = join(dir, name);
		let st;
		try { st = statSync(p); } catch (e) { continue; }
		if (st.isDirectory()) walk(p, exts, out);
		else if (exts.some((e) => name.endsWith(e))) out.push(p);
	}
	return out;
}
/* 只查**手写源**：lib/ 是构建产物，行尾/内容不守恒，查它没有意义还会噪声 */
const FILES = [
	...walk(join(ROOT, "scripts"), [".mjs"]),
	...walk(join(ROOT, "src"), [".js"])
].sort()
	/* 本文件自身含有用于自检的字面反引号样本，跳过（否则自检样本会被当成违规） */
	.filter((f) => relative(ROOT, f).replace(/\\/g, "/") !== "scripts/lint-cdp-templates.mjs");

/**
 * 从 i（= 开引号之后）跳到本模板字面量的**闭合反引号**，返回其下标；找不到返回 src.length。
 * 🔴 必须理解 `${...}` 插值：插值里边还可以再嵌模板（实测 `js(...${JSON.stringify(\`移动 ${x}\`)}...)`
 *    这种写法是**合法**的）。第一版直接"找下一个反引号" ⇒ 把嵌套模板的内层开引号当成了外层闭合处，
 *    于是把一段正确代码报成违规（假红）。闸门红在合法代码上比漏报更糟 —— 会逼人去削弱闸门。
 */
function endOfTemplate(src, i) {
	let depth = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === "\\") { i += 2; continue; }
		if (depth === 0 && ch === BT) return i;
		if (ch === "$" && src[i + 1] === "{") { depth++; i += 2; continue; }
		if (depth > 0) {
			if (ch === "}") { depth--; i++; continue; }
			if (ch === BT) { i = endOfTemplate(src, i + 1) + 1; continue; }  // 插值里的嵌套模板
			i++; continue;
		}
		i++;
	}
	return src.length;
}

/** 模板启发式：返回违规描述 */
export function scan(src) {
	const bad = [];
	/* 🔴 刻意**收窄**（第一版加宽到 `(?:ev|js|...)` 后误报 43 处）：
	 *    不加词界会让 `prev(` / `level(` / `foo.js(` 全被当成入口 ⇒ 噪声会逼人把闸门削弱，
	 *    那是比漏报更坏的结局。故只认"**已知页内代码助手 + 实参括号**"这一种确定写法；
	 *    通类（含 `(sel) => \`…\`` 这种箭头返回模板）交给**语法扫描**兜底 ——
	 *    真被反引号截断的文件**根本解析不过**，语法扫描一定会红。 */
	const re = new RegExp("(?:^|[^\\w$.])(evalExpr|ev|js|rectOf)\\(\\s*" + BT, "gm");
	let m;
	while ((m = re.exec(src))) {
		const i = endOfTemplate(src, m.index + m[0].length);
		const after = src.slice(i + 1, i + 3);
		const line = src.slice(0, i).split("\n").length;
		if (!/^[\s,);\]]/.test(after)) bad.push("第 " + line + " 行模板闭合处异常 → 后继 " + JSON.stringify(after));
	}
	return bad;
}

/* ── 真语法扫描（等价 node --check，支持 ESM 顶层 await） ── */
function syntaxCheck(absPath) {
	const r = spawnSync(process.execPath, ["--check", absPath], { encoding: "utf8" });
	return { ok: r.status === 0, msg: String(r.stderr || "").split("\n").filter((l) => /SyntaxError/.test(l))[0] || "" };
}

/* ══ 0. 自检：防线必须真的会拦，且不得误报 ══ */
const badSample = ["const a = await evalExpr(" + BT, "/* 见 " + BT + "d-x" + BT + " 说明 */", "})()" + BT + ");", ""].join("\n");
const goodSample = "const a = await evalExpr(" + BT + "\n/* 见 d-x 说明 */\n})()" + BT + ");\n";
/* 🔴 嵌套模板样本**必须不误报**（第一版就栽在这：把 `${JSON.stringify(\`…\`)}` 的内层开引号
 *    当成了外层闭合处）。这条自检是"不误伤合法代码"的守门人。 */
const nestedSample = "await js(" + BT + "(function(){ s.call(ta,${JSON.stringify(" + BT + "移动 ${tgt} 下 20" + BT + ")}); })()" + BT + ");\n";
const selfBad = scan(badSample).length > 0;
const selfGood = scan(goodSample).length === 0;
const selfNested = scan(nestedSample).length === 0;
if (!selfBad || !selfGood || !selfNested) {
	console.error("[lint] ❌ 自检失败：模板启发式空转或误报（bad=" + selfBad + " good=" + selfGood + " nested=" + selfNested + "）");
	process.exit(2);
}

/* 语法扫描自检：临时造一个**已知非法**的文件，必须判红；再造一个合法的，必须判绿 */
const tmpBad = join(tmpdir(), "dsh-lint-syntaxcheck-bad.mjs");
const tmpGood = join(tmpdir(), "dsh-lint-syntaxcheck-good.mjs");
try {
	writeFileSync(tmpBad, "const x = `a\n/* `b` */\n`;\n", "utf8");
	writeFileSync(tmpGood, "const x = `a`;\nexport default x;\n", "utf8");
	const sb = syntaxCheck(tmpBad), sg = syntaxCheck(tmpGood);
	if (sb.ok || !sg.ok) {
		console.error("[lint] ❌ 自检失败：语法扫描空转或误报（坏样本通过=" + sb.ok + " 好样本失败=" + !sg.ok + "）");
		process.exit(2);
	}
} finally {
	for (const t of [tmpBad, tmpGood]) { try { unlinkSync(t); } catch (e) { /* 忽略 */ } }
}

if (FILES.length === 0) {
	console.error("[lint] ❌ INVALID：枚举到 0 个文件 ⇒ 防线空转（路径或扩展名写错）");
	process.exit(2);
}

/* ══ 1. 扫描真实文件 ══ */
let fail = 0, syntaxChecked = 0;
for (const abs of FILES) {
	const rel = relative(ROOT, abs).replace(/\\/g, "/");
	let src = "";
	try { src = readFileSync(abs, "utf8"); }
	catch (e) { console.error("[lint] ⚠️ 读不到 " + rel + "：" + ((e && e.message) || e)); continue; }

	const bad = scan(src);
	if (bad.length) { fail++; console.error("[lint] ❌ 模板启发式 " + rel + "\n    " + bad.join("\n    ")); }

	const sc = syntaxCheck(abs);
	syntaxChecked++;
	if (!sc.ok) { fail++; console.error("[lint] ❌ 语法 " + rel + "\n    " + sc.msg); }
}
console.log("[lint] 已扫描 " + FILES.length + " 个文件（其中语法扫描 " + syntaxChecked + " 个）");
console.log("[lint] 自检：模板坏样本已拦 / 好样本无误报；语法坏样本已拦 / 好样本无误报；枚举非空");
console.log(fail === 0 ? "[lint] IS_PASS: TRUE" : "[lint] IS_PASS: FALSE（违规 " + fail + " 处）");
process.exit(fail === 0 ? 0 : 1);
