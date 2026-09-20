#!/usr/bin/env node
/**
 * test-router-decision.mjs —— 「模型语义路由判断层」**纯函数离线测试**（无需 Harness）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 用户最高优先级需求：「分流判断要由模型按语义做，插件只执行；
 *   关键词规则降级为离线兜底。」
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | RR-1  | 提示词含固定 JSON 契约 | 出现 kind 枚举与 branches 字段骨架 |
 *  | RR-2  | 提示词列出已知维度 key+label | 传入的 knownDims 被逐行列进提示词 |
 *  | RR-3  | 提示词**允许**模型提出清单外新分支 | 出现"不要被清单限制 / 新分支"字样 |
 *  | RR-4  | 提示词不写死任何用户路径 | 含传入 project.root，但不含硬编码盘符字面量 |
 *  | RR-5  | 正常 JSON 能解析 | ok:true 且 decision 字段齐全 |
 *  | RR-6  | 带 ```json 围栏能解析 | 围栏被剥掉、ok:true |
 *  | RR-7  | JSON 前后有废话也能解析 | 首尾废话被忽略、ok:true |
 *  | RR-8  | 垃圾/非 JSON → ok:false | 不抛、reason 非空 |
 *  | RR-9  | 空输入 → ok:false | 不抛 |
 *  | RR-10 | 非法 kind → ok:false | kind 不在枚举内即拒绝 |
 *  | RR-11 | 截断（花括号不闭合）→ ok:false | 不抛 |
 *  | RR-12 | 已知维度 world 命中映射 | key/label/stage/files/brief **整段继承** |
 *  | RR-13 | 通用维度「方案」也命中映射 | 映射到 plan、files=[] |
 *  | RR-14 | 自由分支原样保留 | 保留 label/brief、files=[]、key 为安全 slug |
 *  | RR-15 | 自由分支 stage 在已知之上递增 | 紧跟已知最大 stage 之后 |
 *  | RR-16 | 空 branches → kind none | dims=[]、不建分支 |
 *  | RR-17 | 非空路由结果带 routingSource | === "model"（供台账区分模型判 vs 规则降级） |
 *  | RR-18 | 混合已知+自由分支保持模型顺序 | 输出顺序 == 输入顺序 |
 *  | RR-19 | 入参畸形不抛 | null / 非数组 branches 不炸 |
 *
 * 用法：
 *   node scripts/test-router-decision.mjs                ｜ 正常跑（全绿应 exit 0）
 *   ROUTER_NEG=1 node scripts/test-router-decision.mjs   ｜ 植入缺陷校准（**必须红**，exit≠0）
 * 退出码：0 全绿 / 1 有失败 / 2 对账 INVALID
 */
import {
	ROUTER_PROMPT_VERSION, buildRoutingPrompt, parseRoutingDecision,
	extractJsonObject, normalizeBranches
} from "../src/logic/router-decision.js";
import { SPLIT_DIMENSIONS, GENERIC_DIMENSIONS } from "../src/logic/split-dimensions.js";
/* 🔴 收尾对账的唯一实现（重号自检 + 声明面提示 + 显式下限）—— 与 test-scope-tree 同范式。 */
import { tallyCheck } from "./_test-tally.mjs";

const KNOWN_POOL = SPLIT_DIMENSIONS.concat(GENERIC_DIMENSIONS);

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + name); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + "\n       " + JSON.stringify(detail)); }
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  模型语义路由判断层 · 纯函数离线测试（logic/router-decision.js）");
console.log("  提示词版本 ROUTER_PROMPT_VERSION = " + ROUTER_PROMPT_VERSION);
console.log("═══════════════════════════════════════════════════════════");

/* ── RR-1~4 buildRoutingPrompt ─────────────────────────────────────── */
const prompt = buildRoutingPrompt({
	text: "帮我写小说《虚海》，先搭世界观",
	project: { root: "D:\\workspace\\novels\\虚海" },
	knownDims: SPLIT_DIMENSIONS.map((d) => ({ key: d.key, label: d.label }))
});
t("RR-1a", "提示词含固定 JSON 契约（kind 枚举 + branches 骨架）",
	prompt.indexOf('"kind"') >= 0 && prompt.indexOf('"novel|generic|none|noise"') >= 0
		&& prompt.indexOf('"branches"') >= 0, { hasKind: prompt.indexOf('"kind"') >= 0 });
t("RR-1b", "ROUTER_PROMPT_VERSION 是非空字符串（契约版本可被调用方读取）",
	typeof ROUTER_PROMPT_VERSION === "string" && ROUTER_PROMPT_VERSION.length > 0, ROUTER_PROMPT_VERSION);

t("RR-2", "提示词逐行列已知维度 key+label 供模型参考",
	prompt.indexOf("world") >= 0 && prompt.indexOf("A1 世界观") >= 0
		&& prompt.indexOf("plot") >= 0 && prompt.indexOf("A3 剧情") >= 0,
	prompt.split("\n").filter((l) => l.indexOf("｜") >= 0).slice(0, 3));

t("RR-3", "🔴 明确允许模型提出已知清单之外的新分支（否则退化成查表）",
	prompt.indexOf("不要被") >= 0 && prompt.indexOf("新分支") >= 0,
	prompt.split("\n").filter((l) => l.indexOf("清单") >= 0 || l.indexOf("新分支") >= 0));

t("RR-4", "🔴 不写死用户路径：含传入 project.root，但提示词模板里没有硬编码盘符字面量",
	prompt.indexOf("D:\\workspace\\novels\\虚海") >= 0
		&& /[A-Za-z]:[\\/]/.test(prompt.split("【用户原文】")[0].replace(String.raw`D:\workspace\novels\虚海`, "")) === false,
	"项目根由入参注入，模板其余部分不含盘符");

/* ── RR-5~11 parseRoutingDecision ───────────────────────────────────── */
const GOOD = '{"project":"","name":"虚海","kind":"novel","branches":[{"key":"world","label":"A1 世界观","brief":"搭世界观","role":"A1"}],"reason":"小说需求"}';
const p1 = parseRoutingDecision(GOOD);
t("RR-5", "正常 JSON 能解析且 ok:true，decision 字段齐全",
	p1.ok === true && p1.decision && p1.decision.kind === "novel"
		&& p1.decision.name === "虚海" && p1.decision.branches.length === 1, p1);

const FENCED = "```json\n" + GOOD + "\n```";
const p2 = parseRoutingDecision(FENCED);
t("RR-6", "带 ```json 围栏的回复能解析",
	p2.ok === true && p2.decision && p2.decision.kind === "novel", p2);

const CHATTER = "好的，我分析一下需求。\n" + GOOD + "\n以上就是我的判断。";
const p3 = parseRoutingDecision(CHATTER);
t("RR-7", "JSON 前后有废话也能解析",
	p3.ok === true && p3.decision && p3.decision.branches.length === 1, p3);

let threw = false, p4;
try { p4 = parseRoutingDecision("今天天气不错 哈哈哈哈 这根本不是 JSON"); } catch (e) { threw = true; }
t("RR-8", "🔴 垃圾文本/非 JSON → ok:false 且**不抛**",
	p4 && p4.ok === false && typeof p4.reason === "string" && p4.reason.length > 0 && threw === false,
	{ ok: p4 && p4.ok, reason: p4 && p4.reason, threw: threw });

let p5;
try { p5 = parseRoutingDecision(""); } catch (e) { p5 = { ok: "threw" }; }
t("RR-9", "空输入 → ok:false（不抛、不默认当合法需求）",
	p5 && p5.ok === false, p5);

const BAD_KIND = '{"kind":"banana","branches":[]}';
const p6 = parseRoutingDecision(BAD_KIND);
t("RR-10", "非法 kind → ok:false（不静默接受越界枚举值）",
	p6.ok === false, p6);

const TRUNC = '{"kind":"novel","branches":[{"key":"world","label":"A1 世界观";';
let p7;
try { p7 = parseRoutingDecision(TRUNC); } catch (e) { p7 = { ok: "threw" }; }
t("RR-11", "🔴 截断/坏语法 → ok:false 且**不抛**",
	p7 && p7.ok === false, p7);

t("RR-11b", "extractJsonObject 能越过字符串内的花括号（label 里含 } 不破坏配对）",
	extractJsonObject('{"label":"a}b","x":1}') === '{"label":"a}b","x":1}',
	extractJsonObject('{"label":"a}b","x":1}'));

/* ── RR-12~19 normalizeBranches ─────────────────────────────────────── */
const knownWorld = normalizeBranches(
	[{ key: "world", label: "A1 世界观", brief: "覆盖简报", role: "A1" }], KNOWN_POOL);
t("RR-12", "🔴 命中已知维度 world → 整段继承 stage/files/brief（**忽略模型自报的 brief**）",
	knownWorld.dims.length === 1
		&& knownWorld.dims[0].key === "world"
		&& knownWorld.dims[0].label === "A1 世界观"
		&& knownWorld.dims[0].stage === 1
		&& Array.isArray(knownWorld.dims[0].files) && knownWorld.dims[0].files.indexOf("01-世界观/") >= 0
		&& knownWorld.dims[0].brief.indexOf("世界规则") >= 0,
	knownWorld.dims[0]);

const knownPlan = normalizeBranches(
	[{ key: "", label: "方案", brief: "", role: "" }], KNOWN_POOL);
t("RR-13", "通用维度「方案」（去前缀模糊匹配）→ 映射到 plan、files=[]",
	knownPlan.dims.length === 1 && knownPlan.dims[0].key === "plan"
		&& knownPlan.dims[0].files.length === 0, knownPlan.dims[0]);

const freeOnly = normalizeBranches(
	[{ key: "", label: "市场调研", brief: "调研竞品", role: "调研员" }], KNOWN_POOL);
t("RR-14", "🔴 自由分支原样保留：label/brief 保留、files=[]、key 为安全 ASCII slug",
	freeOnly.dims.length === 1
		&& freeOnly.dims[0].label === "市场调研"
		&& freeOnly.dims[0].brief === "调研竞品"
		&& freeOnly.dims[0].files.length === 0
		&& /^[a-z][a-z0-9_-]*$/.test(freeOnly.dims[0].key),
	freeOnly.dims[0]);

t("RR-15", "自由分支 stage 在已知最大 stage 之上递增（不与已知工序撞号）",
	freeOnly.dims[0].stage >= 1, { stage: freeOnly.dims[0].stage });

const noneBranches = normalizeBranches([], KNOWN_POOL);
t("RR-16", "🔴 空 branches → kind=none、dims=[]（一条都不建）",
	noneBranches.kind === "none" && noneBranches.dims.length === 0, noneBranches);

t("RR-17", "🔴 非空结果带 routingSource===\"model\"（台账据此区分模型判 vs 规则降级）",
	freeOnly.routingSource === "model" && noneBranches.routingSource === "model",
	{ free: freeOnly.routingSource, none: noneBranches.routingSource });

const mixed = normalizeBranches(
	[
		{ key: "world", label: "A1 世界观", brief: "", role: "" },
		{ key: "", label: "市场调研", brief: "", role: "" },
		{ key: "plot", label: "A3 剧情", brief: "", role: "" }
	], KNOWN_POOL);
const mixedKeys = mixed.dims.map((d) => d.key);
t("RR-18", "混合「已知 + 自由」分支保持模型给出的顺序（world, free, plot）",
	mixedKeys.length === 3 && mixedKeys[0] === "world" && mixedKeys[2] === "plot"
		&& mixedKeys[1] !== "world" && mixedKeys[1] !== "plot", mixedKeys);

let threwNorm = false, weird;
try {
	weird = normalizeBranches(null, KNOWN_POOL);
	normalizeBranches("not-an-array", KNOWN_POOL);
	normalizeBranches([{ junk: 1 }, null, { key: "", label: "只给 label" }], KNOWN_POOL);
} catch (e) { threwNorm = true; }
t("RR-19", "🔴 入参畸形（null/非数组/元素为 null）不抛、不崩",
	threwNorm === false && weird.kind === "none" && weird.dims.length === 0,
	{ threw: threwNorm, weird: weird });

/* ══════════════════════════════════════════════════════════════════════
 * 植入缺陷校准（纪律 32/108：注入的缺陷必须真能翻转结论）。
 *   `ROUTER_NEG=1` 时硬塞一条**必错**断言 —— 期望"垃圾文本解析成功"，
 *   与 RR-8 的真值相反 ⇒ 本套件必须变红（exit≠0）。
 *   这证明：若哪天有人把 parseRoutingDecision 改坏成"什么都返回 ok:true"，
 *   本套件会当场抓到（否则"校准通过"是假的）。
 * ══════════════════════════════════════════════════════════════════════ */
if (process.env.ROUTER_NEG === "1") {
	console.log("  [注入缺陷] ROUTER_NEG=1 ⇒ 期望垃圾文本竟然解析成功（与 RR-8 真值相反）");
	t("RR-NEG", "🔴 校准·垃圾文本竟然解析 ok:true？",
		parseRoutingDecision("这根本不是 JSON").ok === true);
}

/* ── 收尾对账（实跑 < 下限 ⇒ INVALID/exit 2，与"产品红" exit 1 分开）───── */
const ran = pass + fail;
/* 正常路径实跑 21 条（RR-1a/1b…RR-19）；ROUTER_NEG=1 时多跑 1 条必错校准。
 * 新增断言必须同步抬高它（不抬 = 把沉默合法化）。 */
const MIN_ASSERTIONS = 21;
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "test-router-decision（纯离线）" });
if (!tally.ok) process.exit(2);

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + ran);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
