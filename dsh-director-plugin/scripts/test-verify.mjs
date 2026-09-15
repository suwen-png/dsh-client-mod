#!/usr/bin/env node
/**
 * test-verify.mjs —— 双层验收与评审去偏**纯函数离线测试**
 *
 * ══════════════════════════════════════════════════════════════════
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | VF-1 | 机械断言 | 五种断言各自的正例通过 |
 *  | VF-2 | 🔴 五种断言的**反例** | 全部报红，且 fails **点名是哪条** |
 *  | VF-3 | 规格自相矛盾 | min > max → 出 `spec` 检查项（**不是产出不合格**） |
 *  | VF-4 | 文件块计数 | marker 优先；fence 兜底；都没有 → 0 |
 *  | VF-5 | 字节长度 | 中文 3 字节（不是"字符数"） |
 *  | VF-6 | 🔴 判 FAIL 必须举证 | 无证据 → **降级为 CANNOT_JUDGE**；缺 dim → 报红 |
 *  | VF-7 | 跨族 | 跨族 ok；同族不 ok；**族未知也不 ok**（无法证明） |
 *  | VF-8 | 🔴 位置交换 | 两序一致 → 取该结论；**翻转 → CANNOT_JUDGE**；抛错 → CANNOT_JUDGE |
 *  | VF-9 | 多评委聚合 | all / majority / any 三种口径 |
 *  | VF-10 | 风险定聚合模式 | 高风险 → all；低风险 → any |
 *  | VF-11 | 🔴 合议顺序 | 机械断言不过 → FAIL 且 trace 写明**不问模型**；PASS 链路完整 |
 *  | VF-12 | 判据自检 | 已知答案样本全对 → ok；有一个错 → misses 点名 |
 *
 * 用法：node scripts/test-verify.mjs ｜ 退出码 0 全绿 / 1 有失败 / 2 INVALID
 */
import {
	ASSERT_KEYS, LABEL, VERDICT,
	runAssert, countFiles, byteLen,
	validateJudgment, isCrossFamily, familyOf,
	pairWithSwap, aggregateVotes, modeForRisk,
	decideVerdict, selfCheck
} from "../src/logic/verify.js";

const EXPECTED_TOTAL = 60;
let pass = 0, fail = 0;
const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++;
	else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DOC = "## 验收清单\n## 结论\n通过\n" + "正".repeat(700);

console.log("═══════════════════════════════════════════════════════════");
console.log("  双层验收与去偏 · 纯函数离线测试（logic/verify.js）");
console.log("═══════════════════════════════════════════════════════════");

console.log("\n【A】机械断言 · 正例");
const good = runAssert(DOC, { min_bytes: 200, max_bytes: 99999, contains: ["## 验收清单", "## 结论"], matches: { "^## ": 2 } });
t("VF-1a", "五种断言齐配且全过", good.ok && good.fails.length === 0, good.fails);
t("VF-1b", "checks 条数 = 5（contains 有 2 个串各计 1）", good.checks.length === 5, good.checks.map((c) => c.key));
t("VF-1c", "未配断言的 spec → 恒通过并说明「直接进入语义评审」",
	runAssert(DOC, {}).ok === true && runAssert(DOC, {}).note.indexOf("语义评审") >= 0);
t("VF-1d", "ASSERT_KEYS 恰为五种", eq(ASSERT_KEYS, ["emits_files", "min_bytes", "max_bytes", "matches", "contains"]));

console.log("\n【B】🔴 反例：五种断言都必须报红");
t("VF-2a", "min_bytes 不足 → 红", runAssert("短", { min_bytes: 200 }).ok === false);
t("VF-2b", "max_bytes 超出 → 红", runAssert("x".repeat(300), { max_bytes: 100 }).ok === false);
t("VF-2c", "contains 缺串 → 红**且点名缺哪条**",
	runAssert(DOC, { contains: ["找不到的串"] }).fails.some((f) => f.indexOf("找不到的串") >= 0), runAssert(DOC, { contains: ["找不到的串"] }).fails);
t("VF-2d", "matches 数量不符 → 红且报实得/期望",
	(() => { const r = runAssert(DOC, { matches: { "^## ": 9 } }); return r.ok === false && r.fails[0].indexOf("9") >= 0; })());
t("VF-2e", "emits_files 不符 → 红", runAssert(DOC, { emits_files: 3 }).ok === false);
t("VF-2f", "正则非法 → 红且报「正则非法」（不抛穿透）",
	runAssert(DOC, { matches: { "[": 1 } }).fails.some((f) => f.indexOf("正则非法") >= 0));
t("VF-3", "min > max → 出 spec 检查项（规格矛盾，非产出不合格）",
	(() => { const r = runAssert(DOC, { min_bytes: 500, max_bytes: 100 }); return r.ok === false && r.checks.some((c) => c.key === "spec" && !c.ok); })());

console.log("\n【C】计数与字节");
t("VF-4a", "marker 优先：--- FILE: x --- 计 1",
	(() => { const r = countFiles("--- FILE: a.md ---\n正文"); return r.count === 1 && r.by === "marker"; })());
t("VF-4b", "fence 兜底：一对 ``` 计 1",
	(() => { const r = countFiles("```js\ncode\n```"); return r.count === 1 && r.by === "fence"; })());
t("VF-4c", "都没有 → 0 且 by=none", (() => { const r = countFiles("纯文本"); return r.count === 0 && r.by === "none"; })());
t("VF-4d", "两个 marker 计 2", countFiles("--- FILE: a ---\n--- FILE: b ---").count === 2);
t("VF-5a", "ASCII 1 字符 = 1 字节", byteLen("abc") === 3);
t("VF-5b", "中文 1 字 = 3 字节（不是字符数）", byteLen("正") === 3, byteLen("正"));
t("VF-5c", "null → 0", byteLen(null) === 0);

console.log("\n【D】🔴 judge 结论的结构合法性");
const okJ = validateJudgment({ label: "PASS", evidence: ["有证据"], dim: "purpose" });
t("VF-6a", "合法 PASS → ok", okJ.ok, okJ.fails);
t("VF-6b", "🔴 判 FAIL 但无举证 → 报红且**降级为 CANNOT_JUDGE**",
	(() => { const r = validateJudgment({ label: "FAIL", dim: "purpose" }); return r.ok === false && r.normalized.label === LABEL.CANNOT_JUDGE && r.normalized.downgraded; })(),
	validateJudgment({ label: "FAIL", dim: "purpose" }).normalized);
t("VF-6c", "判 FAIL 且有举证 → 保留 FAIL",
	validateJudgment({ label: "FAIL", dim: "purpose", evidence: ["第 3 条未满足"] }).normalized.label === LABEL.FAIL);
t("VF-6d", "label 非法 → 报红", validateJudgment({ label: "MAYBE", dim: "x" }).ok === false);
t("VF-6e", "evidence 非数组 → 报红", validateJudgment({ label: "PASS", dim: "x", evidence: "一条" }).fails.some((f) => f.indexOf("数组") >= 0));
t("VF-6f", "缺 dim → 报红（一条评审只能判一个维度）",
	validateJudgment({ label: "PASS" }).fails.some((f) => f.indexOf("dim") >= 0));
t("VF-6g", "evidence 里的空白串被剔除",
	validateJudgment({ label: "FAIL", dim: "x", evidence: ["  ", "真证据"] }).normalized.evidence.length === 1);
t("VF-6h", "三态常量就三个", Object.keys(LABEL).length === 3 && LABEL.CANNOT_JUDGE === "CANNOT_JUDGE");

console.log("\n【E】跨族评审");
t("VF-7a", "familyOf：deepseek-reasoner → deepseek", familyOf("deepseek-reasoner") === "deepseek");
t("VF-7b", "familyOf：claude-3-5 → anthropic", familyOf("claude-3-5-sonnet") === "anthropic");
t("VF-7c", "familyOf：未知 → unknown", familyOf("") === "unknown");
t("VF-7d", "跨族 → ok", isCrossFamily("deepseek-chat", "claude-3-5").ok === true);
t("VF-7e", "🔴 同族 → 违规且写明偏差量级",
	(() => { const r = isCrossFamily("deepseek-chat", "deepseek-reasoner"); return r.ok === false && r.reason.indexOf("同族") >= 0; })());
t("VF-7f", "🔴 族未知 → 也判违规（无法证明跨族，按违规处理）",
	(() => { const r = isCrossFamily("unknown-model", "claude"); return r.ok === false && r.reason.indexOf("未知") >= 0; })());

console.log("\n【F】🔴 位置交换（去位置偏差）");
const stable = pairWithSwap(() => ({ label: "PASS" }));
t("VF-8a", "两序一致 → 取该结论", stable.label === LABEL.PASS && stable.flip === false, stable);
t("VF-8b", "确实跑了两次且第二次顺序相反", (() => { const seen = []; pairWithSwap((o) => { seen.push(o.join("")); return { label: "PASS" }; }); return seen[0] === "AB" && seen[1] === "BA"; })());
let n = 0;
const flaky = pairWithSwap(() => ({ label: (++n === 1 ? "PASS" : "FAIL") }));
t("VF-8c", "🔴 结论翻转 → 判 CANNOT_JUDGE（平局，不取其一）",
	flaky.label === LABEL.CANNOT_JUDGE && flaky.flip === true, flaky);
t("VF-8d", "原因写明「位置偏差」", flaky.reason.indexOf("位置") >= 0, flaky.reason);
t("VF-8e", "评审函数抛错 → CANNOT_JUDGE（不抛穿透）",
	pairWithSwap(() => { throw new Error("boom"); }).label === LABEL.CANNOT_JUDGE);
t("VF-8f", "未提供函数 → CANNOT_JUDGE", pairWithSwap(null).label === LABEL.CANNOT_JUDGE);

console.log("\n【G】多评委聚合");
const votes = [{ label: "PASS" }, { label: "PASS" }, { label: "FAIL" }];
t("VF-9a", "majority（2/3 通过）→ PASS", aggregateVotes(votes, "majority").label === LABEL.PASS);
t("VF-9b", "all（要求全票）→ FAIL", aggregateVotes(votes, "all").label === LABEL.FAIL);
t("VF-9c", "any（任一通过）→ PASS", aggregateVotes(votes, "any").label === LABEL.PASS);
t("VF-9d", "全 CANNOT_JUDGE → CANNOT_JUDGE", aggregateVotes([{ label: "CANNOT_JUDGE" }, { label: "CANNOT_JUDGE" }]).label === LABEL.CANNOT_JUDGE);
t("VF-9e", "空票 → CANNOT_JUDGE（不判通过）", aggregateVotes([]).label === LABEL.CANNOT_JUDGE);
t("VF-9f", "agree 报最大同意数", aggregateVotes(votes, "majority").agree === 2);
t("VF-10a", "风险 5 → all（全票）", modeForRisk(5) === "all");
t("VF-10b", "风险 0 → any", modeForRisk(0) === "any");
t("VF-10c", "风险 3 → majority", modeForRisk(3) === "majority");

console.log("\n【H】🔴 合议（顺序不可颠倒）");
const assertFail = runAssert("x", { min_bytes: 999 });
const d1 = decideVerdict({ assertResult: assertFail, judgment: { label: LABEL.PASS, evidence: [] } });
t("VF-11a", "机械断言不过 → FAIL（**即使语义评审说 PASS**）", d1.verdict === VERDICT.FAIL, d1);
t("VF-11b", "trace 写明「不再询问模型」", d1.trace.some((x) => x.indexOf("不再询问模型") >= 0), d1.trace);
t("VF-11c", "FAIL 的 evidence 来自断言明细", d1.evidence.length > 0);
const d2 = decideVerdict({ assertResult: runAssert(DOC, { min_bytes: 500, max_bytes: 100 }) });
t("VF-11d", "规格矛盾 → INVALID_SPEC（与 FAIL 区分）", d2.verdict === VERDICT.INVALID_SPEC, d2);
const d3 = decideVerdict({ assertResult: runAssert(DOC, { min_bytes: 10 }) });
t("VF-11e", "只有机械断言、无语义评审 → NEEDS_HUMAN（**不判通过**）", d3.verdict === VERDICT.NEEDS_HUMAN, d3);
const d4 = decideVerdict({
	assertResult: runAssert(DOC, { min_bytes: 10 }),
	judgment: { label: LABEL.PASS, evidence: [] },
	crossFamily: { ok: false, reason: "同族自评" }
});
t("VF-11f", "🔴 跨族不合格 → NEEDS_HUMAN（不采信同族评审）", d4.verdict === VERDICT.NEEDS_HUMAN, d4);
const d5 = decideVerdict({
	assertResult: runAssert(DOC, { min_bytes: 10 }),
	judgment: { label: LABEL.PASS, evidence: ["证据 A"] },
	crossFamily: { ok: true, reason: "跨族：a 产出 / b 评审" }
});
t("VF-11g", "两层都过且跨族 → PASS", d5.verdict === VERDICT.PASS, d5);
t("VF-11h", "PASS 链路 trace 三条齐（断言→跨族→语义）", d5.trace.length >= 3, d5.trace);
const d6 = decideVerdict({
	assertResult: runAssert(DOC, { min_bytes: 10 }),
	judgment: { label: LABEL.CANNOT_JUDGE, evidence: [] },
	crossFamily: { ok: true, reason: "跨族" }
});
t("VF-11i", "语义判不了 → NEEDS_HUMAN（对应 A2A 的 INPUT_REQUIRED）", d6.verdict === VERDICT.NEEDS_HUMAN, d6);
t("VF-11j", "VERDICT 四态齐全", Object.keys(VERDICT).length === 4, Object.keys(VERDICT));

console.log("\n【I】判据自检（校准）");
const sc = selfCheck([
	{ name: "够长", text: DOC, spec: { min_bytes: 100 }, expect: true },
	{ name: "太短", text: "x", spec: { min_bytes: 100 }, expect: false }
]);
t("VF-12a", "已知答案样本全对 → ok", sc.ok && sc.hit === 2, sc);
const sc2 = selfCheck([{ name: "预期错但实际对", text: DOC, spec: { min_bytes: 1 }, expect: false }]);
t("VF-12b", "有样本不符 → misses 点名", sc2.ok === false && sc2.misses[0].name === "预期错但实际对", sc2);
t("VF-12c", "空样本 → 不判 ok（不能靠「没样本」冒充通过）", selfCheck([]).ok === false);

console.log("\n───────────────────────────────────────────────────────────");
const total = pass + fail;
console.log("  断言总数 " + total + "（声明 " + EXPECTED_TOTAL + "）· 通过 " + pass + " · 失败 " + fail);
if (total !== EXPECTED_TOTAL) {
	console.log("  ⚠ 断言总数与声明不符 ⇒ INVALID");
	process.exit(2);
}
if (fail) { console.log("  失败项：" + failures.join(" | ")); process.exit(1); }
console.log("  IS_PASS: TRUE");
process.exit(0);
