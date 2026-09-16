#!/usr/bin/env node
/**
 * test-split-dimensions.mjs —— 「按维度分流」**纯函数离线测试**（无需 Harness）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 *  第 16 批用户原话：「按照世界观剧情等应该自动分到不同的对话分支 然后思维导图应该能看出来」
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | SD-1 | 维度表完整性 | 恰 **8 条**，key 唯一，label 依次含 A1…A8（与小说技能分工一一对应） |
 *  | SD-2 | 每条维度都带边界与职责 | `files` 非空数组、`brief` 非空（缺了会投出"空简报"） |
 *  | SD-3 | 小说意图判定 | 命中 / 🔴 **不命中** / 🔴 **空文本判 false**（三向，防"默认当小说"） |
 *  | SD-4 | 书名提取 | 《X》⇒ `X`；无书名 ⇒ **空串**（不编名字） |
 *  | SD-5 | 小说场景计划 | `kind="novel"`、8 条、按**工序阶段**排序 |
 *  | SD-6 | 🔴 非小说场景 | `kind="generic"` 且 **3 条**（不硬套 A1–A8 ⇒ 不建 8 个空分支） |
 *  | SD-7 | 🔴 空需求 | `kind="none"` 且 **0 条**（不建空壳） |
 *  | SD-8 | `only` 过滤 | 只留指定 key；不存在的 key 不凭空补 |
 *  | SD-9 | `max` 截断 | 截断到上限，且截的是**排在后面**的（保工序靠前的） |
 *  | SD-10 | 分支名 | **维度名在前** + 书名；无书名只有维度名 |
 *  | SD-11 | 简报文本 | 含角色名 + **文件边界** + 需求原文；无 files 的通用维度给"无文件域"文案 |
 *  | SD-12 | 同 stage 排序可预测 | 按 key 字典序（同输入必同输出，便于断言） |
 *
 * 用法：node scripts/test-split-dimensions.mjs ｜ 退出码 0 全绿 / 1 有失败
 */
import {
	SPLIT_DIMENSIONS, NOVEL_HINTS, GENERIC_DIMENSIONS,
	isNovelIntent, novelNameOf, plan, branchTitle, briefOf
} from "../src/logic/split-dimensions.js";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  按维度分流 · 纯函数离线测试（logic/split-dimensions.js）");
console.log("═══════════════════════════════════════════════════════════");

/* ── SD-1 维度表完整性 ─────────────────────────────────────────────────── */
t("SD-1a", "维度数恰为 8（= 小说技能 A1–A8，一个不落）", SPLIT_DIMENSIONS.length === 8, SPLIT_DIMENSIONS.length);
const keys = SPLIT_DIMENSIONS.map((d) => d.key);
t("SD-1b", "key 唯一", new Set(keys).size === keys.length, keys);
const labelsOk = SPLIT_DIMENSIONS.every((d, i) => String(d.label).indexOf("A" + (i + 1)) === 0);
t("SD-1c", "label 依次为 A1…A8（顺序即技能的分工序）", labelsOk, SPLIT_DIMENSIONS.map((d) => d.label));
t("SD-1d", "key 都是稳定英文标识（进 data-* / 节点 id，不可是中文）",
	keys.every((k) => /^[a-z][a-z0-9_-]*$/.test(k)), keys);

/* ── SD-2 每条都带边界与职责 ───────────────────────────────────────────── */
t("SD-2a", "每条 files 都是非空数组（缺了就没法告知边界）",
	SPLIT_DIMENSIONS.every((d) => Array.isArray(d.files) && d.files.length > 0),
	SPLIT_DIMENSIONS.filter((d) => !Array.isArray(d.files) || !d.files.length).map((d) => d.key));
t("SD-2b", "每条 brief 非空（否则投递出去是空简报）",
	SPLIT_DIMENSIONS.every((d) => typeof d.brief === "string" && d.brief.trim().length > 0),
	SPLIT_DIMENSIONS.filter((d) => !d.brief).map((d) => d.key));
t("SD-2c", "每条 stage 是正整数（排序依据）",
	SPLIT_DIMENSIONS.every((d) => Number.isInteger(d.stage) && d.stage > 0),
	SPLIT_DIMENSIONS.map((d) => [d.key, d.stage]));

/* ── SD-3 意图判定（三向，含负对照）────────────────────────────────────── */
t("SD-3a", "命中：「帮我写一个小说，先做世界观」", isNovelIntent("帮我写一个小说，先做世界观") === true);
t("SD-3b", "命中：英文 chapter / novel", isNovelIntent("write chapter 3 of the novel") === true);
t("SD-3c", "🔴 不命中：「帮我部署一个服务」（这是通用需求，不能当小说）", isNovelIntent("帮我部署一个服务") === false);
t("SD-3d", "🔴 空文本 ⇒ false（不许「默认当小说」）", isNovelIntent("") === false && isNovelIntent(null) === false);
t("SD-3e", "自定义 hints 可覆盖默认表", isNovelIntent("写点东西", ["写点东西"]) === true);
t("SD-3f", "NOVEL_HINTS 非空且为字符串数组", Array.isArray(NOVEL_HINTS) && NOVEL_HINTS.length > 0 && NOVEL_HINTS.every((h) => typeof h === "string"));

/* ── SD-4 书名提取 ─────────────────────────────────────────────────────── */
t("SD-4a", "《灵能修仙》⇒ 灵能修仙", novelNameOf("帮我写《灵能修仙》的世界观") === "灵能修仙", novelNameOf("帮我写《灵能修仙》的世界观"));
t("SD-4b", "🔴 无书名 ⇒ 空串（**不编名字**）", novelNameOf("写个小说") === "");
t("SD-4c", "空/非串入参不抛", novelNameOf(null) === "" && novelNameOf(undefined) === "");

/* ── SD-5 小说场景计划 ─────────────────────────────────────────────────── */
const pNovel = plan("帮我写一个小说《灵能修仙》，先搭世界观再做剧情");
t("SD-5a", "kind = novel", pNovel.kind === "novel", pNovel.kind);
t("SD-5b", "分 8 条线（A1–A8 全量）", pNovel.dims.length === 8, pNovel.dims.length);
t("SD-5c", "带出书名", pNovel.name === "灵能修仙", pNovel.name);
const stages = pNovel.dims.map((d) => d.stage);
t("SD-5d", "按工序阶段**非降序**排列（设定 → 剧情/人物 → 正文 → 打磨/审查 → 蒸馏）",
	stages.every((s, i) => i === 0 || stages[i - 1] <= s), stages);
t("SD-5e", "A1 世界观排在最前（工序第一步）", pNovel.dims[0].key === "world", pNovel.dims[0].key);
t("SD-5f", "A5 正文排在 A3 剧情之后（先有章纲才写正文）",
	pNovel.dims.findIndex((d) => d.key === "prose") > pNovel.dims.findIndex((d) => d.key === "plot"),
	pNovel.dims.map((d) => d.key));

/* ── SD-6 非小说（负对照）──────────────────────────────────────────────── */
const pGeneric = plan("把线上服务部署到测试环境并跑一遍冒烟");
t("SD-6a", "🔴 非小说 ⇒ kind=generic", pGeneric.kind === "generic", pGeneric.kind);
t("SD-6b", "🔴 非小说 ⇒ 只 3 条通用维度（**不硬套** A1–A8 ⇒ 不建 8 个空分支）",
	pGeneric.dims.length === GENERIC_DIMENSIONS.length && pGeneric.dims.length === 3, pGeneric.dims.map((d) => d.key));
t("SD-6c", "generic 的 key 与小说维度的 key 不冲突（避免 data-* 撞车）",
	pGeneric.dims.every((d) => keys.indexOf(d.key) < 0), pGeneric.dims.map((d) => d.key));

/* ── SD-7 空需求 ───────────────────────────────────────────────────────── */
const pEmpty = plan("   ");
t("SD-7a", "🔴 空需求 ⇒ kind=none", pEmpty.kind === "none", pEmpty);
t("SD-7b", "🔴 空需求 ⇒ **0 条**（不建空壳分支）", pEmpty.dims.length === 0, pEmpty.dims.length);
t("SD-7c", "none 时给出可读原因（不静默）", typeof pEmpty.reason === "string" && pEmpty.reason.length > 0, pEmpty.reason);

/* ── SD-8 only 过滤 ────────────────────────────────────────────────────── */
const pOnly = plan("写小说《X》", { only: ["world", "prose"] });
t("SD-8a", "only 只留指定两条", pOnly.dims.length === 2, pOnly.dims.map((d) => d.key));
t("SD-8b", "only 结果仍按工序排序（prose 在 world 之后）",
	pOnly.dims[0].key === "world" && pOnly.dims[1].key === "prose", pOnly.dims.map((d) => d.key));
const pOnlyBad = plan("写小说《X》", { only: ["nope-xyz"] });
t("SD-8c", "🔴 only 全是不存在的 key ⇒ 0 条（不凭空补默认项）", pOnlyBad.dims.length === 0, pOnlyBad.dims.length);

/* ── SD-9 max 截断 ─────────────────────────────────────────────────────── */
const pMax = plan("写小说《X》", { max: 3 });
t("SD-9a", "max=3 ⇒ 恰 3 条", pMax.dims.length === 3, pMax.dims.length);
t("SD-9b", "截断保**工序靠前**的（world / power / plot）",
	pMax.dims.map((d) => d.key).join(",") === "world,power,plot", pMax.dims.map((d) => d.key));

/* ── SD-10 分支名 ──────────────────────────────────────────────────────── */
const title = branchTitle(SPLIT_DIMENSIONS[0], "灵能修仙");
t("SD-10a", "维度名在前", title.indexOf("A1 世界观") === 0 || title.indexOf("「A1 世界观」") === 0, title);
t("SD-10b", "带书名", title.indexOf("《灵能修仙》") >= 0, title);
t("SD-10c", "无书名 ⇒ 只有维度名（不留空书名号）",
	branchTitle(SPLIT_DIMENSIONS[1], "").indexOf("《") < 0, branchTitle(SPLIT_DIMENSIONS[1], ""));
t("SD-10d", "非法 dim 不抛（回落「维度」）", branchTitle(null, "X").indexOf("维度") >= 0, branchTitle(null, "X"));

/* ── SD-11 简报文本 ────────────────────────────────────────────────────── */
const brief = briefOf(SPLIT_DIMENSIONS[0], "帮我写《灵能修仙》的世界观", "灵能修仙");
t("SD-11a", "含角色名（分支里的人要知道自己是谁）", brief.indexOf("A1 世界观") >= 0, brief.slice(0, 60));
t("SD-11b", "🔴 含**文件边界**（越界改动在两个分支间是静默冲突）", brief.indexOf("01-世界观") >= 0, brief);
t("SD-11c", "含需求原文（分支要有上下文）", brief.indexOf("帮我写") >= 0, brief);
t("SD-11d", "含越界告诫", brief.indexOf("不要") >= 0, brief);
const briefGeneric = briefOf(GENERIC_DIMENSIONS[0], "部署服务", "");
t("SD-11e", "通用维度（files 为空）⇒ 给「无文件域」文案，不出现空的项目符号",
	briefGeneric.indexOf("无文件域") >= 0 && briefGeneric.indexOf("边界：只读/只写  " ) < 0, briefGeneric);
t("SD-11f", "无需求原文时不拼出「需求原文：」空行",
	briefOf(SPLIT_DIMENSIONS[2], "", "").indexOf("需求原文") < 0, briefOf(SPLIT_DIMENSIONS[2], "", ""));
/* ── SD-11g/h：用户原话「调用小说技能」的**可见落点** ──────────────────────
 * 插件不能替分支加载技能，只能把技能名与角色写进简报（见 `briefOf` 注释）。
 * 🔴 必须带**负对照**：通用维度不许出现小说技能名 —— 否则"顺手全加"也能过 SD-11g。 */
t("SD-11g", "🔴 小说维度简报含技能名 + 该维度的 A 编号（「调用小说技能」的落点）",
	brief.indexOf("multi-agent-novel-brain") >= 0 && brief.indexOf("担任 A1") >= 0, brief.split("\n")[1]);
t("SD-11g2", "简报含该维度的个人记忆文件路径（否则技能里的记忆机制落空）",
	brief.indexOf("_memory/A1_MEMORY.md") >= 0, brief);
t("SD-11h", "🔴 负对照：通用维度简报**不出现**小说技能名（防「顺手全加」）",
	briefGeneric.indexOf("multi-agent-novel-brain") < 0 && briefGeneric.indexOf("通用维度，不加载小说技能") >= 0, briefGeneric);

/* ── SD-12 同 stage 排序可预测 ─────────────────────────────────────────── */
const a = plan("写小说《X》").dims.map((d) => d.key).join(",");
const b = plan("写小说《X》").dims.map((d) => d.key).join(",");
t("SD-12a", "同输入必同输出（纯函数，顺序稳定）", a === b, [a, b]);
const stage1 = plan("写小说《X》").dims.filter((d) => d.stage === 1).map((d) => d.key);
t("SD-12b", "🔴 同 stage 按**表内原始序**（world 在前，power 在后 = A1→A2）", stage1.join(",") === "world,power", stage1);

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  通过 ${pass} / 失败 ${fail}`);
console.log(`  IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
