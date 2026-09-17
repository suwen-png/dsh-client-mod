#!/usr/bin/env node
/**
 * test-attribution.mjs —— **归属判定**纯函数离线测试（19 号文 N1 · 断言前缀 `AT-`）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 用户原话（19 号文 §3.3 / N1）：发「补充 A3 剧情第三章支线」，总监仍按 A1–A8 **全 8 维**建/派。
 *
 * | 编号 | 被测行为 | 期望结果 | 来源 |
 * |:-----|:---------|:---------|:-----|
 * | AT-1 | 单维命中 | 「补充第三章剧情支线」⇒ 恰 **1** 维 = `plot` | N1 判据 1 |
 * | AT-2 | 多维命中（分属不同 stage） | 「把世界观和力量体系一起改了」⇒ 含 `world` + `power`，**2** 维 | N1 判据 2 |
 * | AT-3 | 显式全量 | 「从设定到正文全流程走一遍」⇒ `extent="full"`、**8** 维 | N1 判据 3 |
 * | AT-4 | 噪声前置 | 「哈哈哈哈」⇒ `kind="noise"`、**0** 维 | N1 判据 4 |
 * | AT-5 | 通用任务（非小说） | 「帮我写个爬虫脚本」⇒ `kind="generic"`、**3** 维 | N1 判据 5 |
 * | AT-6 | `o.only` 向后兼容 | `plan(x,{only})` 仍按 only 过滤 | N1 判据 6 |
 * | AT-7 | 🔴 **反例**（N1 反例逐字） | 「全局变量改名」**不得**判 full（防"含『全』字"式判据） | N1 反例 |
 * | AT-8 | 🔴 **信号分级**（本轮实测发现的必须项） | 「补充人物档案」⇒ 只有 `chars`，**不含** `prose` | 见下 |
 * | AT-9 | 歧义判定 | stage 相邻对同时命中 ⇒ `ambiguous=true`；同 stage 多命中 ⇒ `false` | §3.3 规则 6 |
 * | AT-10 | 🔴 **连续性驱动归属**（F10） | `continuous:false` ⇒ 候选集**排除** `currentDim`；`true` ⇒ 含 | N9 判据 2 |
 * | AT-11 | 词表**派生于维度表**（非硬编码） | 改维度表 ⇒ 词表跟着变（正对照） | §3.3 规则 2 |
 * | AT-12 | 纯度 | 同输入两次结果全等；不改进参；源码零 DOM/零时钟 | 文件头契约 |
 * | AT-13 | 零命中的小说场景 | 「写小说《墟海》」⇒ `novel` + 8 维（**保留既有行为**，非噪声） | §3.3 规则 7 |
 * | AT-14 | 空输入 | `""` / null ⇒ `kind="none"`、0 维 | 沿用 SD-7 口径 |
 * | AT-15 | 读数与判定同源 | `attributionSummary()` 与判定的 dims/confidence 一致 | N8 前置 |
 *
 * ── 🔴 为什么 AT-8 必须存在（它是我在本轮实测中发现的） ──────────────
 *   `prose.files` = `["03-剧情架构/chapter-outline", "04-人物档案/", "05-正文/"]`
 *   —— **含 `04-人物档案/`**（正文要读人物档案）。若不做**信号分级**，
 *   「补充人物档案」会同时命中 `chars`（label）与 `prose`（目录）
 *   ⇒ 给正文分支也派一条 ⇒ 用户看到"多派了一条不知道干什么的"。
 *   ⇒ 分级（label > 目录 > 职责词）是**功能要求**，不是优化。
 *
 * ── 🔴 植入缺陷校准（纪律 32）：`AT_NEG=1|2|3` ──────────────────────
 *   「新检查必做植入缺陷校准」—— 只跑绿证不了判据有效（可能恒真）。
 *   · `AT_NEG=1` 去掉**信号分级**（改为纯分数排序）⇒ **必须**看到 `AT-8a` 红；
 *   · `AT_NEG=2` 把全量信号退化成"含『全』字" ⇒ **必须**看到 `AT-7a` 红；
 *   · `AT_NEG=3` 忽略 `continuous` ⇒ **必须**看到 `AT-10a` 红。
 *   跑法：`AT_NEG=1 node scripts/test-attribution.mjs`（退出码 1 且**只有**指定那条红）。
 *   ⚠️ 正常跑**不设**该变量；它只改**本套件内的注入实现**，不改产品代码。
 *
 * 用法：node scripts/test-attribution.mjs ｜ 退出码 0 全绿 / 1 有失败 / 2 用法错
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { planAttribution, deriveDimensionTerms, attributionSummary, FULL_SIGNALS } from "../src/logic/attribution.js";
import { SPLIT_DIMENSIONS, GENERIC_DIMENSIONS, plan } from "../src/logic/split-dimensions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const NEG = String(process.env.AT_NEG || "").trim();

/* ══════════════════════════════════════════════════════════════════
 * 被测实现（`AT_NEG` 时换成**故意做坏**的版本 —— 只在本套件内）
 * ══════════════════════════════════════════════════════════════════ */

/** 坏版①：去掉信号分级（纯分数排序）—— AT-8a 必须红 */
function brokenNoGrade(text, opts) {
	const a = planAttribution(text, opts);
	if (a.kind !== "novel" || !a.dims.length) return a;
	/* 重新按"不做分级"的口径算：把三级词全平铺进一个大词表 */
	const terms = deriveDimensionTerms(SPLIT_DIMENSIONS);
	const low = String(text || "").toLowerCase();
	const out = [];
	for (const t of terms) {
		let s = 0;
		if (t.labelTerm.length >= 2 && low.indexOf(t.labelTerm.toLowerCase()) >= 0) s += 3;
		for (const d of t.dirTerms) if (low.indexOf(d.toLowerCase()) >= 0) s += 2.5;
		for (const b of t.briefTerms) if (low.indexOf(b.toLowerCase()) >= 0) s += 1;
		if (s > 0) out.push({ key: t.key, label: t.label, score: s, reason: "broken-no-grade" });
	}
	out.sort((x, y) => (y.score - x.score));
	return Object.assign({}, a, { dims: out.length ? out : a.dims });
}

/** 坏版②：全量信号退化成「含『全』字」**且放在小说判定之前**（N1 反例描述的那个写法）
 *  —— AT-7a 必须红。
 *  🔴 第一版坏版是"先调真实现、若为 novel 再按含全字改判"，结果**完全没被 AT-7a 抓到**：
 *     「全局变量改名」在真实现下走 `generic`（`NOVEL_HINTS` 不含它）⇒ 坏逻辑根本没机会跑。
 *     ⇒ 这暴露了 AT-7a 原输入的**空真**（见该断言的注释）。坏版现在按 N1 反例的**原始场景**
 *     实现（无脑先判全字），才真正复现"全局变量改名被误判 full"。 */
function brokenFullChar(text, opts) {
	if (String(text).indexOf("全") >= 0) {
		return {
			kind: "novel", ambiguous: false, confidence: 0.9, extent: "full",
			signal: "full", excluded: [],
			reason: "broken-full-char（含全字就判全量）",
			dims: SPLIT_DIMENSIONS.map((d) => ({ key: d.key, label: d.label, score: 0, reason: "broken-full-char" }))
		};
	}
	return planAttribution(text, opts);
}

/** 坏版③：忽略 `continuous`（等于 F10 没接上）—— AT-10a 必须红 */
function brokenIgnoreContinuous(text, opts) {
	const o = Object.assign({}, opts || {});
	delete o.continuous;
	return planAttribution(text, o);
}

const impl = NEG === "1" ? brokenNoGrade : (NEG === "2" ? brokenFullChar : (NEG === "3" ? brokenIgnoreContinuous : planAttribution));

/* ══════════════════════════════════════════════════════════════════
 * 断言框架（含**编号唯一自检** —— 重号会让"红 2 条"读成"红 1 条"）
 * ══════════════════════════════════════════════════════════════════ */
let pass = 0, fail = 0;
const failures = [];
const seen = new Set();
function t(id, name, cond, detail) {
	if (seen.has(id)) { fail++; failures.push(id + " 编号重复"); console.log("  ❌ " + id + " **编号重复**（断言编号必须唯一）"); return; }
	seen.add(id);
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  归属判定 · 纯函数离线测试（logic/attribution.js）"
	+ (NEG ? "  🔴 **植入缺陷校准模式 AT_NEG=" + NEG + "**" : ""));
console.log("═══════════════════════════════════════════════════════════");

/* ── AT-1 单维命中（N1 判据 1）───────────────────────────────────────── */
const a1 = impl("补充第三章剧情支线");
t("AT-1a", "🔴 单维命中：dims 长度 = **1**", a1.dims.length === 1, a1.dims.map((d) => d.key));
t("AT-1b", "🔴 命中的是 `plot`（A3 剧情）", a1.dims[0] && a1.dims[0].key === "plot", a1.dims[0]);
t("AT-1c", "kind = novel", a1.kind === "novel", a1.kind);
t("AT-1d", "命中词给出可读理由（不静默）", !!a1.dims[0] && String(a1.dims[0].reason).length > 0, a1.dims[0]);
/* §6.3 步 2 的人工验收期望「置信 ≥0.6」 */
t("AT-1e", "置信 ≥ 0.6（人工验收步 2 的口径）", a1.confidence >= 0.6, a1.confidence);

/* ── AT-2 多维命中（N1 判据 2）───────────────────────────────────────── */
const a2 = impl("把世界观和力量体系一起改了");
const k2 = a2.dims.map((d) => d.key);
t("AT-2a", "🔴 多维命中：**恰 2** 维", a2.dims.length === 2, k2);
t("AT-2b", "🔴 含 `world`", k2.indexOf("world") >= 0, k2);
t("AT-2c", "🔴 含 `power`", k2.indexOf("power") >= 0, k2);
t("AT-2d", "🔴 负对照：**不是 8 维**（防止出现保险起见就返回全量的写法 —— 那正是本条需求要治的病）",
	a2.dims.length !== 8, a2.dims.length);

/* ── AT-3 显式全量（N1 判据 3）──────────────────────────────────────── */
const a3 = impl("从设定到正文全流程走一遍");
t("AT-3a", "🔴 `extent === \"full\"`", a3.extent === "full", a3.extent);
t("AT-3b", "🔴 **8** 维（A1–A8 全套）", a3.dims.length === 8, a3.dims.map((d) => d.key));
t("AT-3c", "全量集合 = SPLIT_DIMENSIONS 的 key 集（**不是**随便 8 个）",
	a3.dims.map((d) => d.key).sort().join(",") === SPLIT_DIMENSIONS.map((d) => d.key).sort().join(","),
	a3.dims.map((d) => d.key));

/* ── AT-4 噪声前置（N1 判据 4）──────────────────────────────────────── */
const a4 = impl("哈哈哈哈");
t("AT-4a", "🔴 噪声 ⇒ `kind=\"noise\"`", a4.kind === "noise", a4.kind);
t("AT-4b", "🔴 噪声 ⇒ **0** 维（不建任何分支）", a4.dims.length === 0, a4.dims.length);
t("AT-4c", "噪声时给可读原因（不静默）", String(a4.reason).length > 0, a4.reason);
/* 负对照：**动作动词放行**必须在噪声规则之前（否则 1 个字的"写"被误杀） */
t("AT-4d", "🔴 负对照：含动作动词的短输入**不得**判噪声（「写」放行）",
	impl("写小说").kind !== "noise", impl("写小说").kind);

/* ── AT-5 通用任务（N1 判据 5）──────────────────────────────────────── */
const a5 = impl("帮我写个爬虫脚本");
t("AT-5a", "🔴 非小说 ⇒ `kind=\"generic\"`", a5.kind === "generic", a5.kind);
t("AT-5b", "🔴 通用**恰 3** 维（通用三段）", a5.dims.length === 3, a5.dims.map((d) => d.key));
t("AT-5c", "通用维度的 key = GENERIC_DIMENSIONS（**不是** A1–A8 的 key）",
	a5.dims.map((d) => d.key).sort().join(",") === GENERIC_DIMENSIONS.map((d) => d.key).sort().join(","),
	a5.dims.map((d) => d.key));

/* ── AT-6 `o.only` 向后兼容（N1 判据 6）────────────────────────────── */
const pOnly = plan("写小说《X》", { only: ["world", "prose"] });
t("AT-6a", "🔴 `only` 仍最高优先：恰 2 条", pOnly.dims.length === 2, pOnly.dims.map((d) => d.key));
t("AT-6b", "`only` 路径下 `attribution` 为 null（如实标注为：未走归属判定；不冒充）",
	pOnly.attribution === null, pOnly.attribution);
const pOnlyBad = plan("写小说《X》", { only: ["nope-xyz"] });
t("AT-6c", "🔴 `only` 全是不存在的 key ⇒ 0 条（不凭空补默认项）", pOnlyBad.dims.length === 0, pOnlyBad.dims.length);

/* ── AT-7 🔴 反例：全量信号必须是**词组**（N1 反例逐字）────────────── */
/* 🔴 输入必须选「**小说场景 + 含『全』字**」，否则本断言是**空真**：
 *    「全局变量改名」在真实现下走 `generic`（`NOVEL_HINTS` 不含它）⇒ 任何实现都不会
 *    返回 8 个小说维度 ⇒ 「不 full」恒真、抓不到「含全字就判全量」这个缺陷。
 *    ⚠️ 这一点是 `AT_NEG=2` 校准**跑出来的**（首版坏版没被它抓到 ⇒ 首版断言无效）。
 *    ⇒ 现在的输入带小说词（世界观），使断言真的可证伪；`AT-7z` 则保留原反例输入作记录。 */
const a7 = impl("把世界观全局重构一遍");
t("AT-7a", "🔴 **反例**：含「全」字但**无全量词组**的小说输入 ⇒ 不得判 full（防「含全字就判全量」）",
	a7.extent !== "full" && a7.dims.length !== 8,
	{ extent: a7.extent, n: a7.dims.length, dims: a7.dims.map((d) => d.key) });
const a7z = impl("全局变量改名");
t("AT-7z", "顺带记录：非小说输入（含「全」字）⇒ 走通用三段，与 full 无关",
	a7z.kind === "generic" && a7z.extent !== "full", { kind: a7z.kind, extent: a7z.extent });
const a7b = impl("端到端测试一下这个链路");
t("AT-7b", "🔴 **反例**：非小说场景含「端到端」⇒ 不得返回 8 维小说维度",
	a7b.kind === "generic" && a7b.dims.length === 3, { kind: a7b.kind, n: a7b.dims.length });
t("AT-7c", "🔴 全量信号表**不含单字**（单字会让「全局变量改名」这类输入误判全量）",
	FULL_SIGNALS.every((s) => String(s).length >= 2) && FULL_SIGNALS.indexOf("全") < 0,
	FULL_SIGNALS.filter((s) => String(s).length < 2));

/* ── AT-8 🔴 信号分级（本轮实测发现的**功能要求**）───────────────── */
const a8 = impl("补充人物档案");
const k8 = a8.dims.map((d) => d.key);
t("AT-8a", "🔴 只有 `chars`（**不含** `prose`）—— 分级生效，否则 prose 因 files 含 `04-人物档案/` 也命中",
	k8.length === 1 && k8[0] === "chars", k8);
t("AT-8b", "🔴 其它目录类误命中也被压住（不含 `review`/`prose`）",
	k8.indexOf("review") < 0 && k8.indexOf("prose") < 0, k8);
/* 正对照：**该用目录命中时仍然可用**（分级不是"只留 label ⇒ 目录白填了"） */
const a8c = impl("润色一下这段文字");
t("AT-8c", "正对照：无 label 命中时**职责词仍生效**（「润色」⇒ `polish`）",
	a8c.dims.length === 1 && a8c.dims[0].key === "polish", a8c.dims.map((d) => d.key));
const a8d = impl("05-正文 里的东西改一下");
t("AT-8d", "正对照：目录名指代可用（「05-正文」⇒ 命中 `prose`）",
	a8d.dims.some((d) => d.key === "prose"), a8d.dims.map((d) => d.key));
t("AT-8e", "🔴 三级权重**真的分级**（label > 目录 > 职责词）",
	deriveDimensionTerms(SPLIT_DIMENSIONS).length === SPLIT_DIMENSIONS.length
		&& String(a8.signal) === "label", { signal: a8.signal });

/* ── AT-9 歧义判定（§3.3 规则 6）──────────────────────────────────── */
/* 🔴 判据是「**有候选被信号分级压制**，且它与入选者工序相邻」，不是「入选两个」。
 *    用户的明确列举（两个都入选）**不是**歧义 —— 那是他自己说的，再问一遍是打扰。
 *    ⚠️ 这条口径变更是 `AT-9a` 在首跑时抓出来的：初版写成「入选≥2 且相邻」
 *    ⇒ 「审查和蒸馏都要」被误判歧义（`AT-9d` 就是它的负对照）。 */
const a9 = impl("正文和风格语料都要改");
t("AT-9a", "🔴 有维度被分级压制且工序相邻 ⇒ `ambiguous=true`（须走确认通道，不得静默选一个）",
	a9.ambiguous === true, { dims: a9.dims.map((d) => d.key), ambiguous: a9.ambiguous });
t("AT-9b", "🔴 歧义时原因**说清被压的是哪个**（纪律 19：降级可以，无声不行）",
	String(a9.reason).indexOf("压制") >= 0, a9.reason);
t("AT-9c", "🔴 **负对照**：用户明确列举两个（`world`+`power`）⇒ **不**判歧义（都入选了，没有被压的候选）",
	a2.ambiguous === false, { dims: k2, ambiguous: a2.ambiguous });
const a9d = impl("正文和打磨都要");
t("AT-9d", "🔴 **负对照**：明确列举的两个相邻工序维度（正文 + 打磨）⇒ **不**判歧义（两个都入选了）",
	a9d.dims.length === 2 && a9d.ambiguous === false,
	{ dims: a9d.dims.map((d) => d.key), ambiguous: a9d.ambiguous });
t("AT-9e", "单维命中且无被压候选 ⇒ 不判歧义", a1.ambiguous === false, a1.ambiguous);

/* ── AT-10 🔴 连续性驱动归属（N9/F10：把"判了不用"接上）────────────── */
const a10 = impl("补充第三章剧情支线", { currentDim: "plot", continuous: false });
t("AT-10a", "🔴 「不连续」⇒ 候选集**排除当前维度**（`plot` 不在结果里）",
	a10.dims.every((d) => d.key !== "plot"), a10.dims.map((d) => d.key));
t("AT-10b", "🔴 且**如实上报**被排除的 key（纪律 19：降级可以，无声不行）",
	a10.excluded.indexOf("plot") >= 0, a10.excluded);
const a10c = impl("补充第三章剧情支线", { currentDim: "plot", continuous: true });
t("AT-10c", "🔴 **负对照**：「连续」⇒ 候选集**含**当前维度",
	a10c.dims.some((d) => d.key === "plot"), a10c.dims.map((d) => d.key));
const a10d = impl("补充第三章剧情支线", { excludeKeys: ["plot"] });
t("AT-10d", "`excludeKeys` 显式排除同样生效", a10d.dims.every((d) => d.key !== "plot"), a10d.dims.map((d) => d.key));
t("AT-10e", "排除后为空 ⇒ `kind=\"none\"` 且原因说明（不静默、也不兜底建分支）",
	a10.kind === "none" && String(a10.reason).length > 0, { kind: a10.kind, reason: a10.reason });

/* ── AT-11 词表**派生于维度表**（§3.3 规则 2：禁止另立词表）────────── */
const t11 = deriveDimensionTerms(SPLIT_DIMENSIONS);
t("AT-11a", "默认维度表 ⇒ 词表条数 = SPLIT_DIMENSIONS.length", t11.length === SPLIT_DIMENSIONS.length, t11.length);
t("AT-11b", "labelTerm 从 label 派生（去掉 `A1 ` 前缀）：`A1 世界观` ⇒ `世界观`",
	t11[0].labelTerm === "世界观", t11[0].labelTerm);
t("AT-11c", "🔴 **改维度表 ⇒ 词表跟着变**（证明不是硬编码的两份真相源）",
	deriveDimensionTerms([{ key: "zzz", label: "A9 测试维度", stage: 9, files: [], brief: "自造职责词" }])[0].labelTerm === "测试维度",
	deriveDimensionTerms([{ key: "zzz", label: "A9 测试维度", stage: 9, files: [], brief: "自造职责词" }])[0]);
t("AT-11d", "目录名派生去掉排序前缀（`05-正文/` ⇒ `正文`；`_memory/` ⇒ `memory`）",
	t11.find((x) => x.key === "prose").dirTerms.indexOf("正文") >= 0
		&& t11.find((x) => x.key === "distill").dirTerms.indexOf("memory") >= 0,
	{ prose: t11.find((x) => x.key === "prose").dirTerms, distill: t11.find((x) => x.key === "distill").dirTerms });
t("AT-11e", "🔴 职责词**过滤掉整句**（>12 字的不是词，用户不会原样念一句话）",
	t11.every((x) => x.briefTerms.every((b) => b.length <= 12)), t11.find((x) => x.key === "distill").briefTerms);

/* ── AT-12 纯度（文件头契约：无 DOM / 无 store / 无时钟）──────────── */
const raw = readFileSync(resolve(ROOT, "src/logic/attribution.js"), "utf8");
const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
t("AT-12a", "🔴 源码零 DOM 依赖（`document` / `window` / `localStorage` 一处不许有）",
	!/\bdocument\b|\bwindow\b|\blocalStorage\b/.test(codeOnly),
	codeOnly.match(/\bdocument\b|\bwindow\b|\blocalStorage\b/g));
t("AT-12b", "🔴 源码零时钟 / 零随机（`Date.now` / `Math.random` —— 否则同输入不同输出）",
	!/Date\.now|Math\.random|new Date/.test(codeOnly), codeOnly.match(/Date\.now|Math\.random|new Date/g));
t("AT-12c", "🔴 同输入两次 ⇒ 结果**逐字节相等**（纯函数）",
	JSON.stringify(impl("补充第三章剧情支线")) === JSON.stringify(impl("补充第三章剧情支线")));
const frozen = Object.freeze([{ key: "w", label: "A1 世界观", stage: 1, files: Object.freeze(["01-世界观/"]), brief: "世界规则" }]);
let threw = "";
try { deriveDimensionTerms(frozen); } catch (e) { threw = String((e && e.message) || e); }
t("AT-12d", "不修改入参（冻结的维度表不抛）", threw === "", threw);

/* ── AT-13 零命中的小说场景（§3.3 规则 7：保留既有行为，不判噪声）─── */
const a13 = impl("写小说《墟海》");
t("AT-13a", "🔴 说了小说但没指维度 ⇒ `novel`（**不判噪声**：没说维度 ≠ 没有内容）",
	a13.kind === "novel", a13.kind);
t("AT-13b", "🔴 ⇒ 8 维（保留既有行为：技能本身就是 A1–A8 分工）", a13.dims.length === 8, a13.dims.length);
t("AT-13c", "🔴 与显式全量**可分辨**（extent 不同，用户能看出是被要求还是未指明）",
	a13.extent === "partial" && a3.extent === "full", { a13: a13.extent, a3: a3.extent });
/* 🔴 **已知边界**（如实标注，不假装完美）：`NOVEL_HINTS` 是**窄**表，不含「审查」「蒸馏」
 *    ⇒ 「审查和蒸馏都要」这类**只提 A7/A8** 的输入会落到通用三段（本断言就是它的取证）。
 *    这是**刻意的保守**：把「审查」加进 `NOVEL_HINTS` 会让「审查一下这段代码」被判成
 *    小说需求 ⇒ 误派 8 条小说分支 —— 代价远大于"只提 A7/A8 时走通用三段"。
 *    ⚠️ 若将来要改这条，必须同时给「审查一下这段代码」这类**负对照**。 */
const a13d = impl("审查和蒸馏都要");
t("AT-13d", "🔴 已知边界：只提 A7/A8 词的输入 ⇒ `generic`（窄表不让「审查代码」被误判成小说）",
	a13d.kind === "generic" && a13d.dims.length === 3, { kind: a13d.kind, n: a13d.dims.length });

/* ── AT-14 空输入 ───────────────────────────────────────────────── */
t("AT-14a", "空串 ⇒ `kind=\"none\"` 且 0 维",
	impl("").kind === "none" && impl("").dims.length === 0, impl("").kind);
t("AT-14b", "null / undefined 不抛且判 none", impl(null).kind === "none" && impl(undefined).kind === "none");
t("AT-14c", "只有空白 ⇒ 同 none（不建分支）", impl("   ").kind === "none");

/* ── AT-15 读数与判定**同源**（N8 前置）──────────────────────────── */
const s1 = attributionSummary(a1);
t("AT-15a", "🔴 读数含命中的维度名（与判定同源，不是另算一句）",
	s1.indexOf("A3 剧情") >= 0, s1);
t("AT-15b", "🔴 读数含置信度（人工验收要读的就是这个数）",
	s1.indexOf(a1.confidence.toFixed(2)) >= 0, { s1: s1, conf: a1.confidence });
t("AT-15c", "噪声读数显式说「未建分支」（不让用户以为「没反应」）",
	attributionSummary(a4).indexOf("噪声") >= 0 && attributionSummary(a4).indexOf("未建分支") >= 0,
	attributionSummary(a4));
/* 🔴 AT-15d（N8 接线时新增）：读数里的「范围」**不许**再叫「通道」——
 *    N8 的常驻读数里"通道"专指路由通道（`local`/`transfer`），同一个词指两件事
 *    用户必然读错。`extent` 的取值一字未动，改的只是文案。 */
t("AT-15d", "🔴 读数用「范围」表达 `extent`（局部/全量），**不占用**「通道」一词（通道专指路由 `local`/`transfer`，一词两义必误读）",
	s1.indexOf("范围局部") >= 0 && s1.indexOf("通道") < 0, s1);

/* ══════════════════════════════════════════════════════════════════
 * 汇总（`AT_NEG` 模式下**退出码语义反转**：有红 = 校准成功）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n═══════════════════════════════════════════════════════════");
if (NEG) {
	const want = NEG === "1" ? "AT-8a" : (NEG === "2" ? "AT-7a" : "AT-10a");
	const hit = failures.some((f) => f.indexOf(want) === 0);
	const extra = failures.filter((f) => f.indexOf(want) !== 0);
	console.log("  🔴 植入缺陷校准（AT_NEG=" + NEG + "）：目标断言 **" + want + "** 必须报红");
	console.log("  实测失败项：" + (failures.length ? failures.join("；") : "（无）"));
	console.log("  " + (hit
		? "✅ 校准成功：**" + want + "** 真的抓到了这个缺陷"
			+ (extra.length
				? "（另有 " + extra.length + " 条同因报红 —— 注入的缺陷影响面较大，属预期；判据本身无耦合缺陷）"
				: "（且只有它报红）")
		: "❌ 校准失败：缺陷**未被捕获** ⇒ 该断言恒真（空真绿），必须重写输入或判据"));
	console.log("═══════════════════════════════════════════════════════════");
	/* 🔴 退出码：**目标必须红**才是校准成功（多红不判失败 —— 见上面的说明） */
	process.exit(hit ? 0 : 1);
}
console.log("  通过 " + pass + " / 失败 " + fail);
if (fail) console.log("  失败项：\n   - " + failures.join("\n   - "));
else console.log("  IS_PASS: TRUE");
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
