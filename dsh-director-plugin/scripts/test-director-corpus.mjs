#!/usr/bin/env node
/**
 * test-director-corpus.mjs —— **测试语料池本身**的离线闸门（第二十四轮新增）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要给"语料"单独写一份测试（纪律 79 的同型问题）
 * ──────────────────────────────────────────────────────────────────
 * 第二十四轮新增了 `scripts/_corpus-director.mjs`（8 类输入轮转，供 40 轮连跑用）。
 * 但**语料写好了 ≠ 接进去了**：
 *   · 若 `verify-director-logic` 没读它，40 轮仍只测一句话 —— **没人会发现**；
 *   · 若某条语料的期望值写错（比如把"乱敲"写成"寒暄"），真机会红，
 *     但**红在真机**意味着要花 40s 才能看到，且会污染连跑收敛表。
 *
 * ⇒ 本套件把「语料 ↔ 纯函数判据」的一致性**前移到离线**（秒级），
 *    真机只负责验证"界面真的这么跑"。
 *
 * ══════════════════════════════════════════════════════════════════
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | CP-1a–e | 语料池完整性 | **13 条** / id 唯一 / 字段齐 / **真实项目路径在磁盘上存在** / 负对照齐 |
 *  | CP-2a–m | 每条噪声 ⇒ `noiseReasonOf` 命中**期望的原因类别** | 13/13 全中（分辨**对不对**，不只是"拦没拦"） |
 *  | CP-3a–m | 每条真实需求 ⇒ `plan()` 的**维度集合** == 期望集合（19 号文 N1 归属判定后的精确取集） | 13/13 全中 |
 *  | CP-3n | 🔴 **集合对账的负对照校准**：从期望集合里去掉一条 ⇒ 必须判红（否则本节是空真对账） | 判红 ✓ |
 *  | CP-4a–m | `organize()` 剔除噪声行 ≥ 期望（C6 混合用例必须 ≥ 2） | 13/13 全中 |
 *  | CP-5a | 🔴 原因**类别数 ≥ 6**（判据退化成"一律返回同一句"⇒ 红） | 实测 7 类 |
 *  | CP-5b | 🔴 **负对照**：真实需求喂给 `noiseReasonOf` ⇒ 必须 `null`（**不许误杀**） | 13/13 全 null |
 *  | CP-5c | 🔴 **负对照**：噪声喂给 `plan()` ⇒ `kind=noise` 且 `dims=[]`（**一条分支都不建**） | 13/13 全中 |
 *  | CP-6 | 轮转函数 `caseAt` 越界回绕（连跑 N 次不受语料条数限制） | `caseAt(13) === caseAt(0)` |
 *  | CP-7a–b | 🔴 `NEGATIVE` 负对照（边界组 4 + 校准组 4）**全部 `null`** | 8/8 全 null |
 *
 * 🔴 **CP-7 是规则 ⑤·5 的正负对照**（纪律 32）：只做正对照（"纯数字被拦"）会漏掉误杀风险，
 *    必须同时证明「**含数字的真需求没被拦**」—— 校准组 4 条专为此设。
 *
 * 用法：node scripts/test-director-corpus.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { noiseReasonOf, plan, organize } from "../src/logic/split-dimensions.js";
import { CORPUS, NEGATIVE, KNOWN_ESCAPE, caseAt, REAL_PROJECTS } from "./_corpus-director.mjs";

/* 🔴 闸门自检：断言编号必须唯一（重号让报告失去可归因性） */
{
	const selfSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
	const ids = [...selfSrc.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]);
	const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
	if (dup.length) {
		console.error("IS_PASS: FALSE（INVALID：断言编号重号：" + dup.join(", ") + "）");
		process.exit(2);
	}
	console.log("  [自检] 断言编号唯一：" + ids.length + " 条，零重号");
}

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  总监测试语料池 · 离线一致性测试（scripts/_corpus-director.mjs）");
console.log("═══════════════════════════════════════════════════════════");

/* ── CP-1 语料池完整性 ─────────────────────────────────────────────── */
t("CP-1a", "语料条数 = 25（19 号文 **P7 N7** 扩容 13 → 25，覆盖 **7 种**噪声原因 × 4 个真实项目）", CORPUS.length === 25, CORPUS.length);

/* ── CP-1f 分类配额（19 号文 §6.1 的**硬指标**，逐项可证伪）─────────────────
 * 🔴 为什么单独立一条：条数够 ≠ 配额够。旧语料 13 条看着不少，
 *    但「单维命中」只有 1 条 —— 而单维命中正是 N1 归属判定**最核心**的能力形态，
 *    配额不达标意味着"归属判定对每一维都成立"这句话**从没被验证过**。 */
(() => {
	const single = CORPUS.filter((c) => c.expectKind === "novel" && c.expectDims.length === 1).length;
	const multi = CORPUS.filter((c) => c.expectKind === "novel" && c.expectDims.length >= 2 && c.expectDims.length < 8).length;
	const full = CORPUS.filter((c) => c.expectDims.length >= 8).length;
	const generic = CORPUS.filter((c) => c.expectKind === "generic").length;
	const withPath = CORPUS.filter((c) => String(c.real).indexOf(":\\") >= 0).length;
	const quota = { 单维: single, 多维: multi, 全量: full, 通用: generic, 噪声: CORPUS.length, 负对照: NEGATIVE.length, 带路径: withPath };
	const want = { 单维: 6, 多维: 3, 全量: 2, 通用: 3, 噪声: 8, 负对照: 8, 带路径: 3 };
	const shortOf = Object.keys(want).filter((k) => quota[k] < want[k]);
	t("CP-1f", "🔴 **分类配额达标**（19 号文 §6.1：单维≥6 / 多维≥3 / 全量≥2 / 通用≥3 / 噪声≥8 / 负对照≥8 / 带路径≥3）",
		shortOf.length === 0, { 实测: quota, 未达标: shortOf.map((k) => k + " " + quota[k] + "<" + want[k]) });
})();
t("CP-1b", "id 唯一", new Set(CORPUS.map((c) => c.id)).size === CORPUS.length, CORPUS.map((c) => c.id));
const fieldBad = CORPUS.filter((c) => !c.id || !c.name || c.noise === undefined
	|| !c.real || !c.expectReasonHas || !c.expectKind || c.expectOrgNoiseMin === undefined
	/* 🔴 19 号文 N1：期望值从「条数」升格为「**集合**」⇒ 缺集合的语料必须在
	 *    完整性检查这一步就红，否则 CP-3 会以 `undefined` 静默退化成"对账跳过"。 */
	|| !Array.isArray(c.expectDims) || c.expectDims.length === 0);
t("CP-1c", "每条字段齐全（id/name/noise/real/expectReasonHas/expectKind/expectOrgNoiseMin/expectDims）",
	fieldBad.length === 0, fieldBad.map((c) => c.id));
/* 🔴 **真实项目路径必须真的存在** —— 编出来的路径会让"项目把控"这条被测能力
 *    失去意义（分支照着假路径去找文件，找不到就静默空转）。 */
const pathBad = Object.keys(REAL_PROJECTS).filter((k) => !existsSync(REAL_PROJECTS[k]));
t("CP-1d", "🔴 声明的真实项目路径**在磁盘上都存在**（" + Object.keys(REAL_PROJECTS).length + " 个）",
	pathBad.length === 0, pathBad.map((k) => [k, REAL_PROJECTS[k]]));

const negBad = NEGATIVE.filter((n) => !n.id || !n.group || !n.text);
t("CP-1e", "负对照 `NEGATIVE` 字段齐全（" + NEGATIVE.length + " 条：边界组 + 校准组）",
	NEGATIVE.length >= 8 && negBad.length === 0, negBad.map((n) => n.id));

/* ── CP-2 噪声分辨：原因类别要对得上 ───────────────────────────────── */
const reasons = [];
CORPUS.forEach((c, i) => {
	const r = noiseReasonOf(c.noise);
	reasons.push(r);
	t("CP-2" + String.fromCharCode(97 + i),
		c.id + " 噪声「" + String(c.noise).slice(0, 18) + "」⇒ 原因含「" + c.expectReasonHas + "」",
		!!r && String(r).indexOf(c.expectReasonHas) >= 0, { id: c.id, reason: r, want: c.expectReasonHas });
});

/* ── CP-3 真实需求的分线口径（**集合对账** · 19 号文 N1）─────────────
 * 原口径 = `p.dims.length === (novel ? 8 : 3)`。
 * N1 归属判定落地后，`plan()` 改为「按需求原话**精确取集**」—— 用户在需求里点名
 * 了哪些维度就只分哪几条线 ⇒ "条数"不再是常量，**只有集合才是判据**。
 * 🔴 集合对账要同时拦两个方向：**多给**（硬套全量、建出没人要的分支）
 *    与**少给**（漏线 ⇒ 该干的活没人干）。数量口径对后者是瞎的。 */
const dimsOf = (p) => p.dims.map((d) => d.key).slice().sort();
const sameSet = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
CORPUS.forEach((c, i) => {
	const p = plan(c.real);
	const got = dimsOf(p);
	const want = c.expectDims.slice().sort();
	t("CP-3" + String.fromCharCode(97 + i),
		c.id + " 真实需求 ⇒ kind=" + c.expectKind + " · dims={" + c.expectDims.join(",") + "}（实测 " + p.kind + " / {" + p.dims.map((d) => d.key).join(",") + "}）",
		p.kind === c.expectKind && sameSet(got, want),
		{ id: c.id, kind: p.kind, got: got, want: want, name: p.name });
});
/* 🔴 **本节自己的负对照校准**（纪律 32 / 99：改口径必配校准）——
 *    取一条实测集，**故意去掉一个元素**再与原期望集合对账，必须判红。
 *    若 `sameSet` 被写成恒真（只比长度、比错方向、拿同一个数组自比），
 *    下面这条就会绿 ⇒ 立刻暴露 CP-3 是空真闸门。
 *    反向的空真（恒假）由 CP-3a–m **全绿**证伪 ⇒ 两者合起来才算双向证成。 */
{
	const cRef = CORPUS.filter((c) => c.expectDims.length >= 3)[0];
	const p = plan(cRef.real);
	const got = dimsOf(p);
	const missing = got.slice(1);                 // 实测集去掉首元素
	const wantMinusOne = cRef.expectDims.slice().sort();
	wantMinusOne.pop();                           // 期望集去掉末元素
	t("CP-3n", "🔴 集合对账的负对照校准：" + cRef.id + " 去掉一条后对账必须判红"
		+ "（got={" + missing.join(",") + "} vs want={" + wantMinusOne.join(",") + "}）",
		sameSet(missing, wantMinusOne) === false,
		{ got: missing, want: wantMinusOne, full: got });
}

/* ── CP-4 整理去噪达到期望 ─────────────────────────────────────────── */
CORPUS.forEach((c, i) => {
	const og = organize(c.real);
	const n = (og.noiseLines || []).length;
	t("CP-4" + String.fromCharCode(97 + i),
		c.id + " 整理：要点 " + og.lines.length + " 条 · 剔除噪声行 " + n + "（期望 ≥ " + c.expectOrgNoiseMin + "）",
		og.lines.length >= 1 && n >= Number(c.expectOrgNoiseMin),
		{ id: c.id, lines: og.lines.length, noise: n, want: c.expectOrgNoiseMin });
});

/* ── CP-5 负对照 / 反例校准（纪律 32）───────────────────────────────── */
/* 🔴 若分辨判据退化成 `return "无意义输入"`（不看内容、一律同一句），
 *    CP-2 会**全绿**（因为每条都含同一句）⇒ 必须再断言"原因**分得出类别**"。 */
const uniqReasons = new Set(reasons.filter(Boolean));
t("CP-5a", "🔴 " + CORPUS.length + " 条噪声至少分出 **6 类不同原因**（判据退化成同一句 ⇒ 本条红）",
	uniqReasons.size >= 6, { 类别数: uniqReasons.size, 原因: [...uniqReasons] });
/* 🔴 反过来：**真需求一条都不许被误杀**（误杀比漏拦更贵 —— 用户以为插件坏了）。 */
const killBad = CORPUS.filter((c) => noiseReasonOf(c.real) !== null);
t("CP-5b", "🔴 负对照：" + CORPUS.length + " 条**真实需求**喂给噪声判据 ⇒ 全部 `null`（不许误杀）",
	killBad.length === 0, killBad.map((c) => [c.id, noiseReasonOf(c.real)]));
/* 🔴 噪声喂给 `plan()` ⇒ 一条分支都不建（修复前会建 3 条空壳）。 */
const dimBad = CORPUS.filter((c) => { const p = plan(c.noise); return p.kind !== "noise" || p.dims.length !== 0; });
t("CP-5c", "🔴 负对照：" + CORPUS.length + " 条**噪声**喂给 `plan()` ⇒ `kind=noise` 且 `dims=[]`",
	dimBad.length === 0, dimBad.map((c) => [c.id, plan(c.noise).kind, plan(c.noise).dims.length]));

/* ── CP-7 🔴 `NEGATIVE` 负对照（规则 ⑤·5 的正负对照）────────────────────
 * 保守原则是「宁可漏拦，绝不误杀」—— 但**只做正对照证不了这一条**：
 * 若判据写成 `if (/\d/.test(s)) return "..."`（拦"含数字"），
 * CP-2 的纯数字用例**照样绿**，却是**严重误杀**（"帮我算 1+1"也会被拒）。
 * ⇒ 必须有一组"含数字但确属真需求"的输入来证伪它（校准组 G1–G4）。 */
const negKilled = NEGATIVE.filter((n) => noiseReasonOf(n.text) !== null);
t("CP-7a", "🔴 负对照的**边界组**喂给噪声判据 ⇒ 全部 `null`（不含动作动词的合法需求也不许误杀）",
	negKilled.filter((n) => n.group === "边界").length === 0,
	negKilled.filter((n) => n.group === "边界").map((n) => [n.id, noiseReasonOf(n.text)]));
t("CP-7b", "🔴 负对照的**校准组**（含数字的真需求，如「帮我算 1234 + 5678」「版本号 1.2.3→1.2.4」）⇒ 全部 `null`",
	negKilled.filter((n) => n.group === "校准").length === 0,
	negKilled.filter((n) => n.group === "校准").map((n) => [n.id, noiseReasonOf(n.text)]));

/* ── CP-6 轮转函数 ─────────────────────────────────────────────────── */
t("CP-6a", "`caseAt` 越界回绕（连跑 N 次不受语料条数限制）",
	caseAt(0).id === caseAt(CORPUS.length).id && caseAt(1).id === caseAt(CORPUS.length + 1).id,
	{ at0: caseAt(0).id, atN: caseAt(CORPUS.length).id });
t("CP-6b", "`caseAt` 负数/非法输入不抛（回绕到合法下标）",
	!!caseAt(-1) && !!caseAt(null) && !!caseAt("x"), { at_1: caseAt(-1).id, atNull: caseAt(null).id });

/* ── CP-8 已知逃逸（19 号文 P7 实测登记 · 台账 `T-PLUG-061`）─────────────
 * 🔴 这一组**故意断言"坏的现状还在"** —— 它是一枚**哨兵**，不是一条合格判据。
 *    作用：把这个缺口**钉在闸门里**。将来谁修好了（或改坏了）这条会变红并指名道姓，
 *    而不是让缺口继续无声存在（纪律 19：降级可以，无声不行）。
 *    ⚠️ 它**不能**被读成"我们认可这个行为" —— note 里写清了为什么不在 P7 里顺手修。 */
t("CP-8a", "`KNOWN_ESCAPE` 字段齐全（" + KNOWN_ESCAPE.length + " 条已知逃逸，每条带 id/text/note）",
	KNOWN_ESCAPE.length >= 2 && KNOWN_ESCAPE.every((e) => e.id && e.text && e.note), KNOWN_ESCAPE.map((e) => e.id));

const escNow = KNOWN_ESCAPE.map((e) => ({ id: e.id, noise: noiseReasonOf(e.text), dims: plan(e.text).dims.length }));
t("CP-8b", "🔴 **哨兵**：已知逃逸**当前确实会派发**（`noiseReasonOf === null` 且 `dims > 0`）—— 修好后本条应变红，届时**同步删除 `KNOWN_ESCAPE` 条目**",
	escNow.every((x) => x.noise === null && x.dims > 0), escNow);

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  通过 " + pass + " / 失败 " + fail);
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
