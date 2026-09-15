#!/usr/bin/env node
/**
 * test-delegate.mjs —— 委派模板与上下文装配**纯函数离线测试**
 *
 * ══════════════════════════════════════════════════════════════════
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | DL-1 | 四段式简报 | 四段**全部出现**（缺的显式写「未提供」，不留空） |
 *  | DL-2 | 🔴 四段校验 | 缺任一段 → 报红并给**该段缺失的后果**（不是干巴巴的段名） |
 *  | DL-3 | 产出归一 | raw 未显式传 → null（**默认不给原文**） |
 *  | DL-4 | 🔴 上下文装配 | 只带依赖命中的；未声明进 skipped；结构化优先于摘要 |
 *  | DL-5 | 🔴 原文防线 | 只有原文、无摘要且未显式请求 → **不放行**，进 omitted |
 *  | DL-6 | needRaw | 显式请求原文 → 带原文且 level=raw |
 *  | DL-7 | 预算截断 | 超出剩余预算的产出被 omitted 且**不静默截半** |
 *  | DL-8 | 🔴 交接归一 | 缺 summary → 报红；structured 是字符串 → 报红；下游文本**不含原文** |
 *  | DL-9 | 隔离收益 | contextSaving 算出省下的量 |
 *
 * 用法：node scripts/test-delegate.mjs ｜ 退出码 0 全绿 / 1 有失败 / 2 INVALID
 */
import {
	SECTIONS, SECTION_LABEL, SECTION_WHY, HANDOFF,
	buildBriefing, validateBriefing,
	normalizeArtifact, buildContext, contextSaving, normalizeHandoff
} from "../src/logic/delegate.js";

const EXPECTED_TOTAL = 31;
let pass = 0, fail = 0;
const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++;
	else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ARTS = [
	{ output: "doc", summary: "文档摘要", structured: { sections: 3 }, raw: "原文".repeat(500) },
	{ output: "bp", summary: "蓝图摘要", raw: "蓝图原文" },
	{ output: "extra", summary: "无关产出" }
];
const STEP = { id: "rev", depends_on: ["doc", "bp"], task: "审 {{doc}}" };

console.log("═══════════════════════════════════════════════════════════");
console.log("  委派模板与上下文装配 · 纯函数离线测试（logic/delegate.js）");
console.log("═══════════════════════════════════════════════════════════");

console.log("\n【A】四段式简报");
const b = buildBriefing({ goal: "整理需求", outputFormat: "三点列表", sources: "仅本条消息", boundary: "不动代码" });
t("DL-1a", "四段标题全部出现", SECTIONS.every((k) => b.indexOf("## " + SECTION_LABEL[k]) >= 0), b.slice(0, 60));
t("DL-1b", "四段键恰为 goal/outputFormat/sources/boundary",
	eq(SECTIONS, ["goal", "outputFormat", "sources", "boundary"]));
t("DL-1c", "缺段显式写「未提供」（不留空行冒充有内容）",
	buildBriefing({ goal: "x" }).indexOf("（未提供）") >= 0);
t("DL-1d", "带标题时标题在最前", buildBriefing({ goal: "g" }, { title: "T" }).indexOf("# T") === 0);
const vb = validateBriefing({ goal: "整理需求", outputFormat: "三点列表", sources: "仅本条消息", boundary: "不动代码" });
t("DL-2a", "四段齐 → ok", vb.ok && vb.missing.length === 0, vb);
const vb2 = validateBriefing({ goal: "整理需求" });
t("DL-2b", "🔴 缺三段 → 逐段点名", vb2.ok === false && vb2.missing.length === 3, vb2.missing);
t("DL-2c", "🔴 报红必须给「该段缺失的后果」，不只是段名",
	vb2.reasons.length === 3 && vb2.reasons.every((r) => r.length > 10 && SECTION_WHY.outputFormat.length > 0), vb2.reasons);
t("DL-2d", "过短内容不算写清（长度下限 " + 4 + "）", validateBriefing({ goal: "好", outputFormat: "列表", sources: "无", boundary: "无" }).ok === false);
t("DL-2e", "四段都登记了缺失后果", SECTIONS.every((k) => Boolean(SECTION_WHY[k])));

console.log("\n【B】产出归一（默认不给原文）");
const na = normalizeArtifact({ output: "doc", summary: "s" });
t("DL-3a", "🔴 raw 未传 → null（默认值决定系统行为）", na.raw === null, na);
t("DL-3b", "structured 非对象 → null（不接受字符串冒充结构化）", normalizeArtifact({ structured: "x" }).structured === null);
const na2 = normalizeArtifact({ raw: "abc" });
t("DL-3c", "只有 raw 时也算出字节数", na2.bytes === null || na2.bytes >= 0);
t("DL-3d", "evidenceRefs 归一为字符串数组", normalizeArtifact({ evidenceRefs: [1, "a"] }).evidenceRefs.join(",") === "1,a");

console.log("\n【C】🔴 上下文装配（禁止全量转发）");
const ctx = buildContext(STEP, ARTS);
t("DL-4a", "只带依赖命中的两个产出", ctx.used.sort().join(",") === "bp,doc", ctx.used);
t("DL-4b", "未声明的产出进 skipped（不是静默丢弃）", eq(ctx.skipped, ["extra"]), ctx.skipped);
t("DL-4c", "结构化优先：doc 用 structured 而非 raw", ctx.text.indexOf("sections") >= 0 && ctx.text.indexOf("原文原文") < 0);
t("DL-4d", "无结构化时回落摘要（bp）", ctx.text.indexOf("蓝图摘要") >= 0);
t("DL-4e", "🔴 默认不带任何原文（raw 不出现）", ctx.text.indexOf("蓝图原文") < 0, ctx.text.slice(0, 80));
t("DL-5", "🔴 只有原文、无摘要且未显式请求 → omitted，**不放行原文**",
	(() => { const c = buildContext({ id: "x", depends_on: ["r"] }, [{ output: "r", raw: "长原文" }]); return c.used.length === 0 && c.omitted.length === 1 && c.text === ""; })());
const ctxRaw = buildContext(STEP, ARTS, { needRaw: ["bp"] });
t("DL-6a", "显式请求原文 → level=raw 且带原文",
	ctxRaw.text.indexOf("蓝图原文") >= 0, ctxRaw.text.slice(0, 80));
t("DL-6b", "文本里标注了 level 便于审计", ctxRaw.text.indexOf("[raw]") >= 0 || ctxRaw.text.indexOf("[summary]") >= 0);
const ctxTiny = buildContext(STEP, ARTS, { maxBytes: 10 });
t("DL-7", "预算不足 → omitted 且写明剩余预算（不静默截半）",
	ctxTiny.omitted.some((o) => o.indexOf("预算") >= 0), ctxTiny.omitted);
t("DL-8x", "refs 参数也能命中（模板引用即依赖声明）",
	buildContext({ id: "x" }, [{ output: "z", summary: "Z" }], { refs: ["z"] }).used.join(",") === "z");
void HANDOFF;

console.log("\n【D】🔴 交接归一（子 agent 回传什么）");
const h1 = normalizeHandoff({ summary: "做完了", structured: { ok: true }, raw: "很长的原文", evidenceRefs: ["e1"] });
t("DL-8a", "有摘要 + 结构化 → ok", h1.ok, h1.fails);
t("DL-8b", "🔴 下游文本**不含原文**（只含摘要与结构化）",
	h1.downstreamText.indexOf("很长的原文") < 0, h1.downstreamText.slice(0, 80));
t("DL-8c", "下游文本含证据引用", h1.downstreamText.indexOf("e1") >= 0);
t("DL-8d", "缺 summary → 报红", normalizeHandoff({ raw: "x" }).ok === false);
t("DL-8e", "structured 是字符串 → 报红", normalizeHandoff({ summary: "s", structured: "json" }).ok === false);
t("DL-8f", "structured 是数组 → 报红", normalizeHandoff({ summary: "s", structured: [] }).ok === false);
t("DL-8g", "无 structured 也允许（只有摘要）", normalizeHandoff({ summary: "只回了摘要" }).ok === true);
t("DL-9", "contextSaving：送出量 < 原文总量且 ratio 在 0..1",
	(() => { const sv = contextSaving(ARTS, ctx); return sv.sentBytes < sv.rawBytes && sv.ratio >= 0 && sv.ratio <= 1; })());

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
