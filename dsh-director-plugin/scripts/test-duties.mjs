#!/usr/bin/env node
/**
 * test-duties.mjs —— 19 号文 **P7 / N7**：总监 **5 项职能 × 逐项正负对照**
 * （断言前缀 `DU-`）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它治的是什么
 * ──────────────────────────────────────────────────────────────────
 *   `logic/duties.js` 的 5 项职责**全部 `enabled: true`**，
 *   但此前**没有任何逐项功能验证** —— 只验过"开关状态是不是 true"。
 *   ⇒ 「总监真的在做这五件事吗」这个问题，在闸门里是**空白**。
 *
 *   本套件把 §5.3 矩阵的每一行拆成**两条**：
 *     ① 开启时该职能**真的发生**（有可观测的产物差异）
 *     ② 关闭时该职能**真的不发生**（负对照 —— 产物**回落到没有它**）
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 最容易写错的地方（纪律 23：先证前提再断结果）
 * ──────────────────────────────────────────────────────────────────
 *   `modelRouting` 的"关闭时不发生"**天然是真**的 —— 但那是**回落逻辑**造成的，
 *   不是"开关生效"造成的。更糟的是：`TASK_MODEL` 里 `research` / `writing`
 *   本来就映射到 `deepseek-chat`，**与回落值完全相同** ⇒
 *   若拿这类输入做判据，**开着与关着同形** ⇒ 空真绿。
 *   ⇒ 判据必须落在**可分辨**的输入上（`code → deepseek-coder` /
 *     `design → deepseek-reasoner`），并**先断言这一点**（`DU-4a`）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 就地更正 §5.3 的一处措辞（纪律 99：判据生命周期须与数据生命周期一致）
 * ──────────────────────────────────────────────────────────────────
 *   §5.3 写 `languagePolish`「整理后的文本**保真**原文要点**且去噪**」。
 *   实测（读 `config/model.js#polishLanguage`）：该职能**只做语言规范化**
 *   （压缩空白 / 清理标点前后空格 / 补句末标点），**不做去噪** ——
 *   去噪由 `logic/split-dimensions.js#organize()` 承担（简报的「需求整理」段）。
 *   ⇒ 本套件按**真实职责**判：规范化差异 + 原要点保真；
 *     「去噪」另立判据（`DU-2c`）指向 `organize()`，并核对语料池的去噪覆盖（`CP-4x`）。
 *     **不改产品去迎合文档** —— 那是把判据变成需求。
 *
 * 校准（纪律 32）：`DU_NEG=1` ⇒ 「关掉开关」实际仍按全开执行（等价于
 *   `if (d.X.enabled)` 恒真）⇒ **必须精确红 5 条关闭侧判据**
 *   （`DU-2b` / `DU-3b` / `DU-4c` / `DU-5c` / `DU-6b`）。
 *
 * 用法：node scripts/test-duties.mjs ｜ 退出码 0 全绿 / 1 有红
 */

import { DUTY_KEYS, DEFAULT_DUTIES, cloneDefaultDuties, normalizeDuties } from "../src/logic/duties.js";
import { runDirector, TASK_MODEL, judgeBranch, reviewOutput } from "../src/logic/director-run.js";
import { DIRECTOR_CHAIN } from "../src/logic/director-chain.js";
import { polishLanguage, classifyTask } from "../src/config/model.js";
import { REVIEW_DIMS, review6 } from "../src/logic/routing.js";
import { organize } from "../src/logic/split-dimensions.js";
import { CORPUS, KNOWN_ESCAPE } from "./_corpus-director.mjs";

const NEG = String(process.env.DU_NEG || "").trim();

let pass = 0, fail = 0; const failures = []; const seen = new Set();
function t(id, name, cond, detail) {
	if (seen.has(id)) { console.log("  ❌ 断言编号重号：" + id + "（纪律 32：编号必须唯一）"); fail++; failures.push(id + " 重号"); return; }
	seen.add(id);
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + "  " + name
		+ (detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  19 号文 P7 / N7 —— 总监 5 项职能逐项**正负对照**");
console.log("═══════════════════════════════════════════════════════════");
if (NEG) console.log("  [校准] DU_NEG=" + NEG + " ⇒ 「关闭开关」实际仍按**全开**执行（关的判据应精确变红）");

/* ── 职责构造器 ────────────────────────────────────────────────────────
 * `off(key)` = 只关 `key`，其余保持默认（文档 §3.1 默认表）。
 * 🔴 校准注入点：`DU_NEG=1` ⇒ 把全部改回 `true`（"关不掉"）。
 *    这正是「开关失效」这一类缺陷的等价注入 —— 不是改产品，是**喂给产品一份
 *    「你以为关了、其实没关」的配置**，看判据认不认得出。 */
function dutiesOff(keys) {
	const d = cloneDefaultDuties();
	const off = Array.isArray(keys) ? keys : [keys];
	DUTY_KEYS.forEach((k) => { d[k].enabled = off.indexOf(k) < 0; });
	if (NEG === "1") DUTY_KEYS.forEach((k) => { d[k].enabled = true; });
	return d;
}
const dutiesAllOn = () => {
	const d = cloneDefaultDuties();
	DUTY_KEYS.forEach((k) => { d[k].enabled = true; });
	return d;
};

/** `runDirector` 需要的 store 适配器（每次新建对象 ⇒ 不撞 `running` WeakSet）
 * 🔴 `getState()` 必须返回**快照**（新对象 + 新数组）：产品里 `pageStore().getState()`
 *    读的是 `msgsRef.current`（**本条之前**的上下文），而 `addMessage` 只写库、
 *    不改这个快照。若 mock 让 `addMessage` 改动 `getState()` 返回的同一个数组，
 *    步骤 ② 的 `prev` 就会取到**当前这条自己** ⇒ `judgeBranch(自己, 自己)` 恒判"沿用"
 *    ⇒ `DU-3a` **假红**（而产品其实是对的）。实测踩到过，记录在此。 */
function mkStore(msgs) {
	const state = { messages: (Array.isArray(msgs) ? msgs : []).slice(), status: "idle" };
	return {
		getState: () => ({ messages: state.messages.slice(), status: state.status }),
		addMessage: (m) => { state.messages.push({ role: m.role, content: m.content }); },
		setStatus: (s) => { state.status = s; }
	};
}
/** 离线安全配置：`localModel.enabled = false` ⇒ 五步链全程走 **G0 规则路径**（零网络） */
const CFG = { localModel: { enabled: false } };
const stepOf = (res, id) => (res.steps || []).filter((s) => s.id === id)[0] || null;

/* ══════════════════ DU-1 开关读数 + 前提声明 ══════════════════ */

t("DU-1a", "文档 §3.1 默认表：5 项职能**全部** `enabled: true`（与 `DUTY_KEYS` 顺序一致）",
	DUTY_KEYS.length === 5 && DUTY_KEYS.every((k) => DEFAULT_DUTIES[k] && DEFAULT_DUTIES[k].enabled === true)
	&& DUTY_KEYS.join(",") === "languagePolish,modelRouting,branchSwitch,contextFilter,outputReview", DUTY_KEYS);

t("DU-1b", "`normalizeDuties` 幂等：喂回自己的输出 ⇒ 逐字段不变（否则「开关改了又弹回去」会无法归因）",
	JSON.stringify(normalizeDuties(normalizeDuties(dutiesOff("modelRouting")))) === JSON.stringify(normalizeDuties(dutiesOff("modelRouting"))));

t("DU-1c", "🔴 **前提**：本轮全程 `localModel.enabled === false` ⇒ 五步链只走 **G0 规则路径**（零网络）；下述开/关差异**不可能**来自模型",
	CFG.localModel.enabled === false, CFG);

/* ══════════════════ DU-2 languagePolish（整理语言） ══════════════════ */

const NOISY = "《墟海》帮我继续推进\n今天天气不错哈哈哈\n谢谢啦\n重点是剧情架构";

{
	const on = await runDirector({ sessionId: "DU-2on", userText: NOISY, store: mkStore([]), duties: dutiesAllOn(), config: CFG });
	const sOn = stepOf(on, "polish");
	const wantPolished = polishLanguage(NOISY);
	t("DU-2a", "开：`steps.polish.enabled === true`，且 `instruction` **等于** `polishLanguage()` 的规范化结果（不是原文）",
		sOn && sOn.enabled === true && on.instruction === wantPolished && wantPolished !== NOISY,
		{ enabled: sOn && sOn.enabled, same: on.instruction === wantPolished, changed: wantPolished !== NOISY });

	t("DU-2c", "🔴 **保真**：规范化**只动空白/标点**，原文要点词一个不丢（`剧情架构` 仍在；行数由 4 段压成 1 段 —— 这是**它该做的**）",
		on.instruction.indexOf("剧情架构") >= 0 && on.instruction.indexOf("\n") < 0
		&& wantPolished.replace(/[，。！？；：\s]/g, "").indexOf("帮我继续推进") >= 0, on.instruction);
}
{
	const off = await runDirector({ sessionId: "DU-2off", userText: NOISY, store: mkStore([]), duties: dutiesOff("languagePolish"), config: CFG });
	const sOff = stepOf(off, "polish");
	t("DU-2b", "🔴 **负对照**：关 ⇒ `instruction` **逐字等于原文**（含换行与噪声行，原文直转）",
		sOff && sOff.enabled === false && off.instruction === NOISY, { enabled: sOff && sOff.enabled, same: off.instruction === NOISY });
}

/* 去噪的**真实落点**是 `organize()`（不在 `languagePolish` 里）—— 矩阵里那一格必须指向它，
 * 否则「去噪」这条会挂在**一个不做去噪的职能**上，永远测不出东西。 */
{
	const og = organize(NOISY) || {};
	const rawLines = String(NOISY).split("\n").filter((x) => x.trim()).length;
	t("DU-2d", "🔴 「去噪」归 `organize()`：混合输入 " + rawLines + " 行 ⇒ 剔出噪声行 " + ((og.noiseLines || []).length)
		+ "（> 0 才算真的去噪；`languagePolish` 只做规范化，不承担这一格）",
		(og.noiseLines || []).length > 0 && (og.lines || []).length >= 1, { noise: (og.noiseLines || []).length, keep: (og.lines || []).length });
}

/* ══════════════════ DU-3 branchSwitch（切换分支） ══════════════════ */

const PREV_MSG = [{ role: "user", content: "《墟海》要补齐世界观与地理设定" }];
const UNRELATED = "帮我看一下今天的天气怎么样啊";
const wantBranch = judgeBranch(PREV_MSG[0].content, UNRELATED);

{
	const on = await runDirector({ sessionId: "DU-3on", userText: UNRELATED, store: mkStore(PREV_MSG), duties: dutiesAllOn(), config: CFG });
	const sOn = stepOf(on, "branch");
	t("DU-3a", "🔴 开 + 与上文无实质关联 ⇒ `branch` 判成**建议开新分支**（精确等于 `judgeBranch()` 的结果，不是固定串）",
		sOn && sOn.enabled === true && on.branch === wantBranch && String(on.branch).indexOf("新分支") >= 0,
		{ got: on.branch, want: wantBranch });
}
{
	const off = await runDirector({ sessionId: "DU-3off", userText: UNRELATED, store: mkStore(PREV_MSG), duties: dutiesOff("branchSwitch"), config: CFG });
	const sOff = stepOf(off, "branch");
	t("DU-3b", "🔴 **负对照**：关 ⇒ `branch` 回落成固定串「沿用当前分支」（**不判**，而不是判成别的）",
		sOff && sOff.enabled === false && off.branch === "沿用当前分支", { enabled: sOff && sOff.enabled, branch: off.branch });
}

/* ══════════════════ DU-4 modelRouting（调整模型） ══════════════════ */

const CODE_REQ = "修复 build 脚本里的报错，把这个 bug 改掉";

t("DU-4a", "🔴 **前提**：「" + CODE_REQ + "」判为 `code`，且 `TASK_MODEL.code !== TASK_MODEL.chat` ⇒ 开关**可分辨**（拿 `research`/`writing` 做判据会空真绿 —— 纪律 23）",
	classifyTask(CODE_REQ) === "code" && TASK_MODEL.code !== TASK_MODEL.chat, { task: classifyTask(CODE_REQ), code: TASK_MODEL.code, chat: TASK_MODEL.chat });

{
	const on = await runDirector({ sessionId: "DU-4on", userText: CODE_REQ, store: mkStore([]), duties: dutiesAllOn(), config: CFG });
	const sOn = stepOf(on, "model");
	t("DU-4b", "开：座席**按 tier 选择** ⇒ `model === TASK_MODEL[code]`（= `" + TASK_MODEL.code + "`），且步骤文本如实报告任务类型",
		sOn && sOn.enabled === true && on.model === TASK_MODEL.code && String(sOn.text).indexOf("代码开发") >= 0,
		{ model: on.model, want: TASK_MODEL.code, text: sOn && sOn.text });
}
{
	const off = await runDirector({ sessionId: "DU-4off", userText: CODE_REQ, store: mkStore([]), duties: dutiesOff("modelRouting"), config: CFG });
	const sOff = stepOf(off, "model");
	t("DU-4c", "🔴 **负对照**：关 ⇒ **回落 inherit**（`deepseek-chat`），但步骤文本**仍如实报告**判出的任务类型（不静默）",
		sOff && sOff.enabled === false && off.model === TASK_MODEL.chat && String(sOff.text).indexOf("代码开发") >= 0,
		{ enabled: sOff && sOff.enabled, model: off.model, text: sOff && sOff.text });
}

/* ══════════════════ DU-5 contextFilter（上下文筛选） ══════════════════ */

const MSGS_CTX = [
	{ role: "user", content: "build 脚本的报错先放一放" },
	{ role: "assistant", content: "好的，build 相关的改动我记下了" },
	{ role: "user", content: "修复 build 脚本里的报错，把这个 bug 改掉" }
];
const CTX_NONE = "无需切换 → 传递完整上下文";
const CTX_OFF = "职责未启用 → 不筛选";

{
	/* 全开 + `code` 输入 ⇒ `ctx.model !== "deepseek-chat"` ⇒ `needSwitch` 成立 ⇒ 走筛选分支 */
	const on = await runDirector({ sessionId: "DU-5on", userText: CODE_REQ, store: mkStore(MSGS_CTX), duties: dutiesAllOn(), config: CFG });
	const sOn = stepOf(on, "context");
	const txt = String((sOn && sOn.text) || "");
	t("DU-5a", "🔴 开 + 需切换（模型非默认） ⇒ 产出**筛选后的片段**（既不是「" + CTX_NONE + "」也不是「" + CTX_OFF + "」）",
		sOn && sOn.enabled === true && txt !== CTX_NONE && txt !== CTX_OFF && txt.length > 0, { text: txt.slice(0, 80) });

	const off = await runDirector({ sessionId: "DU-5on2", userText: CODE_REQ, store: mkStore(MSGS_CTX), duties: dutiesOff("contextFilter"), config: CFG });
	t("DU-5c", "🔴 **负对照**：关 ⇒ `context` 恒为「" + CTX_OFF + "」（不自造筛选结果）",
		String((stepOf(off, "context") || {}).text || "") === CTX_OFF, { text: (stepOf(off, "context") || {}).text });
}
{
	/* 不切换的分支：一个 `chat` 类输入 + 上文连续 ⇒ `needSwitch` 不成立 */
	const CHAT_REQ = "好的收到";
	const on = await runDirector({ sessionId: "DU-5on3", userText: CHAT_REQ, store: mkStore([{ role: "user", content: "好的收到" }]), duties: dutiesAllOn(), config: CFG });
	const sOn = stepOf(on, "context");
	t("DU-5b", "开 + **不需要切换** ⇒ `context` 如实说「" + CTX_NONE + "」（二分可分辨，不是同一句话的两种写法）",
		sOn && sOn.enabled === true && String(sOn.text) === CTX_NONE, { text: sOn && sOn.text, model: on.model, branch: on.branch });
}

/* ══════════════════ DU-6 outputReview（自动审核产出） ══════════════════ */

const LONG_REQ = "把总监协作网络的归属判定、跨维度转发、血缘一致性这三件事全部落地并给出可证伪的验收判据";
const SHORT_OUT = "收到";

{
	const r = reviewOutput(LONG_REQ, SHORT_OUT, dutiesAllOn());
	t("DU-6a", "🔴 开：产出过短/丢要点 ⇒ `passed === false` 且 `issues` **非空**（审核真的发生）",
		r && r.passed === false && Array.isArray(r.issues) && r.issues.length > 0, r);
}
{
	const r = reviewOutput(LONG_REQ, SHORT_OUT, dutiesOff("outputReview"));
	const s = await runDirector({ sessionId: "DU-6off", userText: LONG_REQ, store: mkStore([]), duties: dutiesOff("outputReview"), config: CFG });
	const sOff = stepOf(s, "review");
	t("DU-6b", "🔴 **负对照**：关 ⇒ `reviewOutput` **恒通过**（`passed === true` 且 `issues === []`），步骤文本 = 「职责未启用 → 跳过审核」",
		r && r.passed === true && r.issues.length === 0 && sOff && sOff.enabled === false
		&& String(sOff.text) === "职责未启用 → 跳过审核", { passed: r && r.passed, issues: r && r.issues, text: sOff && sOff.text });
}

/* 矩阵里 `outputReview` 那一格写「六维结论非空」⇒ 必须真的指到 `review6`，
 * 且六维**齐备**（不是「返回了对象就算」）。 */
{
	const keys = REVIEW_DIMS.map((d) => d.key);
	const byKey = (r) => {
		const m = {};
		((r && r.dims) || []).forEach((d) => { if (d && d.key) m[String(d.key)] = d; });
		return m;
	};
	const rich = review6({ goal: LONG_REQ, output: "已落地归属判定、跨维度转发、血缘一致性三件事，并给出可证伪的验收判据与证据", evidence: ["e1", "e2"], risks: [] });
	const poor = review6({ goal: LONG_REQ, output: "", evidence: [], risks: [] });
	const richM = byKey(rich); const poorM = byKey(poor);
	const covered = keys.filter((k) => richM[k] && ["ok", "warn", "bad"].indexOf(String(richM[k].status)) >= 0);
	const okRich = ((rich && rich.dims) || []).filter((d) => d.status === "ok").length;
	const okPoor = ((poor && poor.dims) || []).filter((d) => d.status === "ok").length;
	t("DU-6c", "🔴 六维审核齐备：`review6` 返回 **" + keys.length + " 维**、每维都有三态 `status`（不是「有对象就算过」）",
		keys.length === 6 && covered.length === 6, { covered: covered.length, keys: keys, got: Object.keys(richM) });

	t("DU-6d", "🔴 **三态可分辨**：齐备产出 ⇒ `ok` 数 **>** 空产出（若六维恒为同一状态，本条红 —— 纪律 32）",
		!!richM && !!poorM && okRich > okPoor, { richOk: okRich, poorOk: okPoor, summaryRich: rich && rich.summary });
}

/* ══════════════════ DU-7 矩阵完整性（§5.3 逐行可追溯） ══════════════════ */

/** §5.3 矩阵的**本套件负责行**：每项职能必须有「开」「关」两侧断言 id */
const MATRIX = [
	{ key: "languagePolish", on: "DU-2a", off: "DU-2b" },
	{ key: "modelRouting", on: "DU-4b", off: "DU-4c" },
	{ key: "branchSwitch", on: "DU-3a", off: "DU-3b" },
	{ key: "contextFilter", on: "DU-5a", off: "DU-5c" },
	{ key: "outputReview", on: "DU-6a", off: "DU-6b" }
];
const missingIds = MATRIX.filter((m) => !seen.has(m.on) || !seen.has(m.off));
t("DU-7a", "🔴 矩阵完整：5 项职能 **×2**（开/关）**共 10 条断言全部真的执行过**（声明了却不存在 = 矩阵是空的）",
	MATRIX.length === 5 && missingIds.length === 0, missingIds.map((m) => m.key));

/* ══════════════════ DU-8 步骤集与声明图一致（F9 的入口侧复核） ══════════════════ */

{
	const res = await runDirector({ sessionId: "DU-8", userText: CODE_REQ, store: mkStore([]), duties: dutiesAllOn(), config: CFG });
	const gotIds = (res.steps || []).map((s) => String(s.id)).sort();
	const wantIds = DIRECTOR_CHAIN.map((s) => String(s.id)).sort();
	t("DU-8a", "🔴 `runDirector().steps` 的 id 集 **===** `DIRECTOR_CHAIN` 的 id 集（N9/F9：从 duties 入口再证一次单一真相源）",
		gotIds.length === wantIds.length && gotIds.join(",") === wantIds.join(","), { got: gotIds, want: wantIds });

	t("DU-8b", "每条 step 都带 `enabled` + `grade` + `text`（可分辨降级要有读数；缺一个就无法归因）",
		(res.steps || []).every((s) => typeof s.enabled === "boolean" && typeof s.grade === "string" && typeof s.text === "string"),
		(res.steps || []).map((s) => [s.id, s.enabled, s.grade]));
}

/* ══════════════════ DU-9 语料与已知逃逸的职责侧读数 ══════════════════ */

t("DU-9a", "语料池与职责套件**同源**：`CORPUS` " + CORPUS.length + " 条（P7 扩容后，≥20）",
	CORPUS.length >= 20, CORPUS.length);

{
	let threw = 0;
	for (const c of CORPUS) {
		try { await runDirector({ sessionId: "DU-9-" + c.id, userText: c.real, store: mkStore([]), duties: dutiesAllOn(), config: CFG }); }
		catch (e) { threw++; }
	}
	t("DU-9b", "🔴 " + CORPUS.length + " 条真实需求**逐条**跑完五步链**零抛出**（换语料不许把执行链打穿 —— 纪律 100）",
		threw === 0, { threw: threw });
}

t("DU-9c", "已知逃逸登记在场（" + KNOWN_ESCAPE.length + " 条 · 台账 `T-PLUG-061`）：职责侧**不**对其做任何特殊处理 —— 现状由 `test-director-corpus.mjs#CP-8b` 钉住",
	KNOWN_ESCAPE.length >= 2 && KNOWN_ESCAPE.every((e) => e.id && e.text));

/* ══════════════════ DU-10 编号唯一 ══════════════════ */

t("DU-10a", "断言编号唯一（重号 = 静默覆盖，纪律 32）", seen.size === pass + fail, { seen: seen.size, ran: pass + fail });

console.log("");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (fail) console.log("  失败：" + failures.join(" ｜ "));
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
process.exit(fail === 0 ? 0 : 1);
