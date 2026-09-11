/**
 * lint-cdp-templates.mjs — 真机脚本「模板字面量被注释里的反引号截断」静态检查
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 *   `cdp-*.mjs` 的页内代码写在 `evalExpr(\`…\`)` 模板字面量里。若模板内容
 *   （**哪怕是注释**）出现反引号，模板会提前闭合 ⇒ 整脚本
 *   `SyntaxError: missing ) after argument list`，且报错行指向模板**起始行**，
 *   定位极反直觉。2026-09-12 同一坑连踩 4 次（每次浪费一整轮真机迭代）。
 *
 * ── 判据 ──────────────────────────────────────────────────────
 *   对每个 `evalExpr(` 后的模板：扫描到**第一个未转义反引号**（=实际闭合点），
 *   检查其后继字符是否合法（`,` `)` `;` `]` 或空白/行尾）。
 *   若注释里的反引号提前闭合，后继会是 `*` / `/` / 字母 ⇒ 判非法。
 *
 * ── 自证灵敏度 ────────────────────────────────────────────────
 *   内置坏样本 / 好样本自检：坏样本必须被拦、好样本不得误报。
 *   防「防线空转」（写了检查却永远通过）。
 *
 * 用法：node scripts/lint-cdp-templates.mjs        → exit 0 = 通过
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BT = String.fromCharCode(96);

/** @returns {string[]} 违规描述（空数组 = 通过） */
export function scan(src) {
	const bad = [];
	const re = new RegExp("evalExpr\\(\\s*" + BT, "g");
	let m;
	while ((m = re.exec(src))) {
		let i = m.index + m[0].length;
		while (i < src.length) {
			const ch = src[i];
			if (ch === "\\") { i += 2; continue; }
			if (ch === BT) break;
			i++;
		}
		const after = src.slice(i + 1, i + 3);
		const line = src.slice(0, i).split("\n").length;
		if (!/^[\s,);\]]/.test(after)) bad.push("第 " + line + " 行模板闭合处异常 → 后继 " + JSON.stringify(after));
	}
	return bad;
}

/* ── 0. 自检：防线必须真的会拦 ── */
const badSample = ["const a = await evalExpr(" + BT, "/* 见 " + BT + "d-x" + BT + " 说明 */", "})()" + BT + ");", ""].join("\n");
const goodSample = "const a = await evalExpr(" + BT + "\n/* 见 d-x 说明 */\n})()" + BT + ");\n";
const selfBad = scan(badSample).length > 0;
const selfGood = scan(goodSample).length === 0;
if (!selfBad || !selfGood) {
	console.error("[lint] ❌ 自检失败：防线空转或误报（bad=" + selfBad + " good=" + selfGood + "）");
	process.exit(2);
}

/* ── 1. 扫描真实脚本 ── */
const FILES = ["scripts/cdp-click-dialog.mjs", "scripts/cdp-click.mjs"];
let fail = 0;
for (const rel of FILES) {
	const bad = scan(readFileSync(join(ROOT, rel), "utf8"));
	if (bad.length) { fail++; console.error("[lint] ❌ " + rel + "\n    " + bad.join("\n    ")); }
	else console.log("[lint] ✅ " + rel);
}
console.log("[lint] 自检：坏样本已拦 / 好样本无误报");
console.log(fail === 0 ? "[lint] IS_PASS: TRUE" : "[lint] IS_PASS: FALSE");
process.exit(fail === 0 ? 0 : 1);
