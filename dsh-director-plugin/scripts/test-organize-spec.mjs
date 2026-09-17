#!/usr/bin/env node
/**
 * test-organize-spec.mjs —— 「AI 可执行规格」整理套件
 *                            （**19 号文 P3 · N4** · 前缀 `OS-`）
 *
 * ══════════════════════════════════════════════════════════════════
 * 被测的是用户第 9 条：「**去掉多余对人的解释，只要 AI 能看懂**」。
 * `organize()` 产出的"需求整理 N 条"是**给人看**的；下游 AI 还得二次解读。
 * `organizeSpec()` 在同一份去噪结果上再分一层结构，让下游可以直接照着做。
 *
 * 🔴 四条判据（19 号文 N4）+ 各配一条负对照：
 *   1. 含「不要写第 3 章」⇒ `forbidden` 收录，且 `origin` **逐字**含原文（不得改写语义）；
 *   2. 含路径 ⇒ `refs` 收录（负对照：中文「世界观/力量体系」的斜杠**不得**被当成路径）；
 *   3. 结构化字段**不含对人类的敬语**（负对照：`origin` 仍须**保真**含它）；
 *   4. 无内容 ⇒ 空数组，**不写「（未指定）」占位**（且 `reason` 要能说清为什么没东西）。
 *
 * 🧪 植入缺陷校准（纪律 32）：
 *   · `OS_NEG=1` ⇒ 把**未剥离敬语的原文行**塞回 `scope` ⇒ **`OS-4a` 必红**
 *   · `OS_NEG=2` ⇒ 把**含裸斜杠**的行塞进 `refs`        ⇒ **`OS-3b` 必红**
 *
 * 用法：node scripts/test-organize-spec.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { organizeSpec, SPEC_KEYS } from "../src/logic/split-dimensions.js";

let pass = 0, fail = 0;
const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (cond || detail === undefined ? "" : "  → " + JSON.stringify(detail)));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  AI 可执行规格整理（organizeSpec）｜ 19 号文 N4 · 用户第 9 条");
console.log("═══════════════════════════════════════════════════════════");

/* ── 闸门自检：断言编号唯一 ── */
{
	const selfSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
	const ids = [...selfSrc.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]);
	const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
	if (dup.length) {
		console.error("IS_PASS: FALSE（INVALID：断言编号重号 " + dup.length + " 个 —— " + dup.join(", ") + "）");
		process.exit(2);
	}
	console.log("  [自检] 断言编号唯一：" + ids.length + " 条，零重号");
}

/* 🧪 校准开关（**只在校准时生效**，正常跑不设） */
const NEG = String(process.env.OS_NEG || "").trim();
/* 坏版 1：把**原文首行（含敬语）**塞回 `scope` —— 等价于"忘了剥离敬语"。
 *   ⚠️ 只在**真结果非空**时才污染：否则连"纯噪声 ⇒ 空数组"（OS-5d）也会跟着红，
 *      那次红属"注入缺陷影响面"，会把校准从**精确**变**模糊**（纪律 32 要的是分辨力）。 */
const brokenNoStrip = (text, dim) => {
	const r = organizeSpec(text, dim);
	const first = String(text == null ? "" : text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || "";
	if (first && r.lines > 0) r.scope = [first].concat(r.scope.slice(1));
	return r;
};
/* 坏版 2：把**任何含裸斜杠**的行也塞进 `refs` —— 等价于"refs 规则认了裸斜杠" */
const brokenLooseRefs = (text, dim) => {
	const r = organizeSpec(text, dim);
	const loose = String(text == null ? "" : text).split(/\r?\n/).map((s) => s.trim())
		.filter((s) => /[\/\\]/.test(s));
	r.refs = r.refs.concat(loose.filter((x) => r.refs.indexOf(x) < 0));
	return r;
};
const SPEC = NEG === "1" ? brokenNoStrip : (NEG === "2" ? brokenLooseRefs : organizeSpec);
if (NEG) console.log("  🧪 校准模式 OS_NEG=" + NEG + "（期望**仅目标断言**红）");

/* 独立写的敬语表（**不复用产品常量** —— 判据要能与产品分辨，复用就成自证） */
const POLITE_PROBE = /请您|请帮忙|麻烦您|麻烦你|建议您|希望你|希望您|烦请|劳驾/;

/* ══════════════ OS-1 · 输出契约 ══════════════ */
const R1 = SPEC("请您帮我把《墟海》的世界观补完\n不要写第 3 章\n项目根在 D:\\workspace\\novels\\墟海\n验收标准：术语一致", null);
t("OS-1a", "返回 `" + SPEC_KEYS.join("/") + "` + origin/dim/lines 等字段",
	SPEC_KEYS.every((k) => R1[k] !== undefined) && R1.origin !== undefined && R1.lines !== undefined,
	Object.keys(R1));
t("OS-1b", "🔴 `origin` **逐字**等于原文（整理不得改写语义 —— 判据 1 的后半）",
	R1.origin === "请您帮我把《墟海》的世界观补完\n不要写第 3 章\n项目根在 D:\\workspace\\novels\\墟海\n验收标准：术语一致",
	R1.origin);
t("OS-1c", "`lines` 与实际收录条数一致（= 各类之和；防「字段有值但没进任何类」）",
	R1.lines === R1.scope.length + R1.outOfScope.length + R1.acceptance.length + R1.forbidden.length + R1.refs.length,
	{ lines: R1.lines, sum: R1.scope.length + R1.outOfScope.length + R1.acceptance.length + R1.forbidden.length + R1.refs.length });

/* ══════════════ OS-2 · 判据 1：禁止项 + 原文保真 ══════════════ */
t("OS-2a", "🔴 判据1：含「不要写第 3 章」⇒ `forbidden` 收录该项",
	R1.forbidden.some((x) => x.indexOf("不要写第 3 章") >= 0), R1.forbidden);
t("OS-2b", "🔴 判据1：`origin` **逐字包含**原文（不是摘要、不是改写）",
	R1.origin.indexOf("不要写第 3 章") >= 0 && R1.origin.indexOf("请您") >= 0, R1.origin);
t("OS-2c", "🔴 反例要求：**至少一项非空**（只测「字段存在」会让空数组也过）",
	R1.scope.length + R1.acceptance.length + R1.refs.length >= 1,
	{ scope: R1.scope, acceptance: R1.acceptance, refs: R1.refs });
t("OS-2d", "`outOfScope` 收录「本期不做」类表述",
	SPEC("本期不做封面，先把正文写完", null).outOfScope.length >= 1,
	SPEC("本期不做封面，先把正文写完", null).outOfScope);

/* ══════════════ OS-3 · 判据 2：refs 认路径、**不认裸斜杠** ══════════════ */
{
	const r = SPEC("项目根在 D:\\workspace\\novels\\墟海，参考 docs/19-规格.md", null);
	t("OS-3a", "🔴 判据2：含盘符路径 ⇒ `refs` 收录该路径",
		r.refs.some((x) => x.indexOf("D:\\workspace\\novels\\墟海") >= 0), r.refs);
}
{
	/* 负对照：中文里「A/B」极常见（世界观/力量体系），**认裸斜杠会把整句误判成路径** */
	const r = SPEC("把世界观/力量体系这两块对齐一下", null);
	t("OS-3b", "🔴 判据2 负对照：「世界观/力量体系」的斜杠**不得**被当成路径（否则 refs 全是噪声）",
		r.refs.length === 0 && r.scope.length >= 1, { refs: r.refs, scope: r.scope });
}

/* ══════════════ OS-4 · 判据 3：结构化字段不含敬语 ══════════════ */
{
	const specText = [R1.goal].concat(R1.scope, R1.outOfScope, R1.acceptance, R1.forbidden, R1.refs).join("\n");
	t("OS-4a", "🔴 判据3：结构化字段**不含**对人类的敬语（请您/建议您/希望…）",
		!POLITE_PROBE.test(specText), specText);
	t("OS-4b", "🔴 判据3 负对照：`origin` **仍保真**含敬语（证明是「只清结构化字段」，不是把原文改了）",
		POLITE_PROBE.test(R1.origin), R1.origin);
	t("OS-4c", "去掉敬语后**实义仍在**（不得连内容一起删掉）",
		R1.scope.some((x) => x.indexOf("世界观") >= 0) || R1.goal.indexOf("世界观") >= 0,
		{ goal: R1.goal, scope: R1.scope });
}

/* ══════════════ OS-5 · 判据 4：空 ⇒ 空数组、不写占位 ══════════════ */
{
	const empty = SPEC("", null);
	/* 🔴 `goal` 是**字符串**（一句话目标），其余 5 个是**数组** —— 判据要按各自类型断言，
	 *    否则会出现"拿数组检查套字符串"的自造红（本条第一版正是这么红的）。 */
	const arrKeys = SPEC_KEYS.filter((k) => k !== "goal");
	const allEmpty = empty.goal === "" && arrKeys.every((k) => Array.isArray(empty[k]) && empty[k].length === 0);
	t("OS-5a", "🔴 判据4：空输入 ⇒ `goal` 空串 + 其余字段**空数组**（不是 undefined、不是 null）", allEmpty, empty);
	t("OS-5b", "🔴 判据4：**不写占位**（全字段里不得出现「（未指定）」「未指定」「N/A」）",
		!/(未指定|N\/A|待补充|TODO)/.test(JSON.stringify(empty)), JSON.stringify(empty));
	t("OS-5c", "空输入 ⇒ `reason` 非空（「为什么没东西」要说得出 —— 纪律 19）",
		typeof empty.reason === "string" && empty.reason.length > 0, empty.reason);
	t("OS-5d", "纯噪声输入（「哈哈哈哈」）⇒ 同样为空数组 + `reason` 非空（**降级有声音**）",
		(() => { const r = SPEC("哈哈哈哈", null); return SPEC_KEYS.every((k) => r[k].length === 0) && String(r.reason).length > 0; })(),
		SPEC("哈哈哈哈", null));
}

/* ══════════════ OS-6 · goal / dim / 归类优先级 ══════════════ */
{
	const r = SPEC("不要写第 3 章\n把第 4 章的正文补完", null);
	t("OS-6a", "`goal` 取**第一条正向要点**（不把「不要写…」当成目标）",
		r.goal.indexOf("不要写") < 0 && r.goal.indexOf("第 4 章") >= 0, { goal: r.goal, forbidden: r.forbidden });
}
{
	const r = SPEC("补充第三章剧情支线", "plot");
	t("OS-6b", "`dim` 原样透传（下游据此知道这条规格属于哪条线）", r.dim === "plot", r.dim);
	t("OS-6c", "`dim` 不传 ⇒ 空串（**不编维度的名字**）", SPEC("补充第三章剧情支线", null).dim === "", SPEC("x", null).dim);
}
{
	/* 归类优先级：「不得低于 3 章」同时含"不得"（禁止）与"低"；禁止类词应优先判中 */
	const r = SPEC("正文不得低于 3 章", null);
	t("OS-6d", "归类优先级：含「不得」的句子进 `forbidden`（**先判负向要求**，不被验收类词抢走）",
		r.forbidden.length >= 1, { forbidden: r.forbidden, acceptance: r.acceptance });
}
t("OS-6e", "`acceptance` 收录「验收/必须」类表述",
	SPEC("必须保证术语一致\n验收要看到三章", null).acceptance.length >= 1,
	SPEC("必须保证术语一致\n验收要看到三章", null).acceptance);

/* ══════════════ 汇总 ══════════════ */
console.log("═══════════════════════════════════════════════════════════");
if (fail) {
	console.log("  失败项：" + failures.join(" ｜ "));
	console.log("  IS_PASS: FALSE");
} else {
	console.log("  IS_PASS: TRUE");
}
console.log("  通过 " + pass + " / 失败 " + fail);
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
