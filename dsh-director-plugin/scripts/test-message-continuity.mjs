#!/usr/bin/env node
/**
 * test-message-continuity.mjs —— 19 号文 §3.5 **P1/P2/P3**（N5 对话持续性）
 *   + **N6 会话档案全覆盖** 的离线判据（断言前缀 `MC-`）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么这层必须离线（而不是只靠真机）
 * ──────────────────────────────────────────────────────────────────
 *   N5 的三件事在真机上各自有"看起来也一样"的失败形态：
 *     · P1 触点窄  ⇒ 真机只能看到"消息没涨"，看不出**该不该涨**；
 *                    "登记不写消息"是本版**明确选择的语义**（`T-PLUG-050` 未裁定），
 *                    所以判据必须是「**显式标注存在**」而不是「消息数必须涨」。
 *     · P2 桶隔离  ⇒ 真机读数 = `dp-msg` 条数，但那要真机；**逐桶对账**的恒等式
 *                    （条数 = 库内条数）离线就能穷举，包括 0 条这个边界。
 *     · P3 跨轮    ⇒ 🔴 **反例在真机上不会出现**：真机档案里恰好有正文，
 *                    而"读了但读不到 / 读到了却二次格式化"这两种坏形态
 *                    只在**构造样本**上可分（纪律 32 植入缺陷校准）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 覆盖
 * ──────────────────────────────────────────────────────────────────
 *   MC-1 P3 `briefOf` 第 7 参 `prevSummary`（含**逐字同源** / 负对照 / 向后兼容）
 *   MC-2 N6 判据 3 `dossierStats` **逐会话对账**（两条恒等式 + `missingIds` 逐条核对）
 *   MC-3 N6 判据 1/2 逐会话断言 + 两条路径**同源对账**（纪律 78）
 *   MC-4 P1 触点显式标注 + 接线（源码 + 产物两层）
 *   MC-5 编号唯一（本文件内置重号自检；另附一条汇总读数）
 *
 * 校准（纪律 32）：
 *   `MC_NEG=1` ⇒ `prevSummary` 被**二次格式化**（截断 10 字）⇒ 必须精确红 MC-1b
 *   `MC_NEG=2` ⇒ 不传 `aliveIds` 时也数 `missingAlive` ⇒ 必须精确红 MC-2d
 *
 * 用法：node scripts/test-message-continuity.mjs ｜ 退出码 0 全绿 / 1 有红
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* localStorage stub（与 test-session-dossier.mjs 同写法） */
const store = new Map();
globalThis.localStorage = {
	getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
	setItem(k, v) { store.set(String(k), String(v)); },
	removeItem(k) { store.delete(String(k)); }
};

const { briefOf } = await import("../src/logic/split-dimensions.js");
const {
	putDossier, readDossiers, applyDossiers, dossierStats, clearDossiers, resetDossierCache
} = await import("../src/store/session-dossier.js");

const NEG = String(process.env.MC_NEG || "").trim();

let pass = 0, fail = 0; const failures = []; const seen = new Set();
function t(id, name, cond, detail) {
	if (seen.has(id)) { console.log("  ❌ 断言编号重号：" + id + "（纪律 32：编号必须唯一）"); fail++; failures.push(id + " 重号"); return; }
	seen.add(id);
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + "  " + name
		+ (detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  19 号文 §3.5 N5（P1/P2/P3 · 对话持续性）+ N6（会话档案全覆盖）");
console.log("═══════════════════════════════════════════════════════════");
if (NEG) console.log("  [校准] MC_NEG=" + NEG + " ⇒ " + (NEG === "1"
	? "`prevSummary` **二次格式化**（截断 10 字）坏版"
	: "**把「不知道」当成「全缺」**坏版"));

/* ══════════════════ MC-1 · P3 跨轮上下文 ══════════════════
 * 判据（19 号文 §3.5 P3）：「第 N 轮简报含第 N−1 轮结论摘要（session-dossier 的总结），
 *   且**逐字同源**」。
 * 🔴 反例：若只断言 `includes("上一轮结论")`，把摘要**改写**（截断/换行重排）也会过
 *    ⇒ 必须断言摘要原文**首字符起**出现（与 test-lineage-msg 的 LM-3b 同范式）。 */

const DIM = { key: "plot", label: "A3 剧情 总监", brief: "剧情线推进", files: ["03-剧情/"] };
const DIM2 = { key: "chars", label: "A2 人物 总监", brief: "角色档案", files: ["02-人物/"] };
const PREV = "上一轮产出：第三章支线 3 条已定，伏笔 F-12 未回收。";

const breakPrev = (s) => String(s || "").slice(0, 10);   // ← 二次格式化（错）
/* 🔴 校准 2：把「读不到存活集」当成「存活集全缺」—— 这是纪律 78 最典型的静默放大形态
 *    （一次读取失败 ⇒ 读数说"97 个会话都没档案" ⇒ 触发一轮补写）。 */
const breakNoAlive = (ids) => {
	const r = dossierStats(ids);
	if (!Array.isArray(ids)) { r.missingAlive = r.total; r.missingIds = Object.keys(readDossiers()).slice(0, 20); }
	return r;
};
const statsFn = NEG === "2" ? breakNoAlive : dossierStats;

/** 统一入口：`MC_NEG=1` 时把摘要截断 ⇒ 逐字同源被破坏 */
function briefWith(dim, text, opts) {
	const o = opts || {};
	const prev = o.prev === undefined ? "" : o.prev;
	const use = NEG === "1" && typeof prev === "string" ? breakPrev(prev) : prev;
	return briefOf(dim, text, "墟海", null, null, o.upstream || null, use);
}

const b1 = briefWith(DIM, "补充第三章剧情支线", { prev: PREV });
t("MC-1a", "P3：给了上一轮摘要 ⇒ 简报出现「上一轮结论」段（**有它的站位**，不是埋在末尾）",
	b1.indexOf("【上一轮结论") >= 0, b1.slice(0, 120));

/* 🔴 核心判据：**逐字同源**。摘要必须首字符起原样出现；任何改写/截断/重排都不算。 */
const MARK = "【上一轮结论 · 逐字同源】";
const at = b1.indexOf(MARK);
const verbatim = at >= 0 && b1.slice(at + MARK.length, at + MARK.length + PREV.length) === PREV;
t("MC-1b", "🔴 **逐字同源**：档案摘要原文**首字符起**全等出现在简报里（改写/截断/重排一律不算 —— 纪律 23 反例）",
	verbatim, { at: at, want: PREV, got: at >= 0 ? b1.slice(at + MARK.length, at + MARK.length + PREV.length) : "(无标记)" });

const b2 = briefWith(DIM, "补充第三章剧情支线", {});
const b2o = briefWith(DIM, "补充第三章剧情支线", { prev: { text: PREV } });
t("MC-1c", "🔴 **负对照**：不传摘要 ⇒ **整段不出现**（且不得写「（无历史）」这类占位）",
	b2.indexOf("上一轮结论") < 0 && b2.indexOf("无历史") < 0 && b2.indexOf("（未指定）") < 0, b2.split("\n")[0]);

t("MC-1d", "空白摘要（`\"\"` / 全空格 / `{text:\"\"}`）与「不传」**同形** —— 摘要为空就是没有，不许产出空标记",
	briefWith(DIM, "x", { prev: "" }) === briefWith(DIM, "x", {}) &&
	briefWith(DIM, "x", { prev: "   " }) === briefWith(DIM, "x", {}) &&
	briefWith(DIM, "x", { prev: { text: "" } }) === briefWith(DIM, "x", {}), "空串/空格/对象三分支");

t("MC-1e", "字符串形态与 `{text}` 对象形态产出**完全相同**（同一事实只有一种渲染）",
	b1 === b2o, { str: b1.length, obj: b2o.length });

/* 🔴 第 6 参（R3 上游约束）与第 7 参（P3 上一轮）**互不吞并**：
 *    两者都在 `filter(Boolean)` 之后拼接，任何一方为空必须只影响自己那一段。 */
const UP = "边界：只读/只写 03-剧情/；不要修改未列出的目录。";
const bBoth = briefWith(DIM, "补充第三章剧情支线", { prev: PREV, upstream: { bound: UP } });
t("MC-1f", "🔴 R3（上游约束）与 P3（上一轮结论）**同时给** ⇒ 两段都在（互不吞并；`filter(Boolean)` 不是覆盖语义）",
	bBoth.indexOf("继承自上游") >= 0 && bBoth.indexOf("上一轮结论 · 逐字同源") >= 0
	&& bBoth.indexOf(UP) >= 0 && bBoth.indexOf(PREV) >= 0, bBoth.length);

/* 向后兼容：旧调用点（只传 5 参）产出必须**逐字不变** —— 否则既有判据会假红。 */
const legacy = briefOf(DIM2, "给主角写人物档案", "墟海", { root: "D:\\workspace\\novels\\墟海" }, null);
t("MC-1g", "向前兼容：只传 5 参的旧调用点 ⇒ 不含上一轮段，但需求原文/技能/项目把控三段**照旧**",
	legacy.indexOf("上一轮结论") < 0 && legacy.indexOf("需求原文：给主角写人物档案") >= 0
	&& legacy.indexOf("加载 multi-agent-novel-brain") >= 0 && legacy.indexOf("项目把控") >= 0,
	legacy.split("\n").length + " 行");

/* ══════════════════ MC-2 · N6 判据 3 逐会话对账 ══════════════════
 * 判据：「`dossierStats(aliveIds)` 读数 = 实际存活代数（对账 `total = with + missing`）」。
 * 🔴 反例：若只断言 `total >= 1`，则「3 条档案覆盖 3 个会话」与「3 条档案 + 97 个会话没档案」
 *    在读数上**完全同形** ⇒ 必须逐会话，并给出可对账的恒等式。 */

clearDossiers(); resetDossierCache();
const ALIVE = ["sa1", "sa2", "sa3", "sa4", "sa5", "sa6", "sa7", "sa8"];
putDossier("sa1", { dim: "world", director: { role: "A1 世界观 总监", name: "墟海" }, summary: { text: "世界观 12 条落地", source: "collect", ok: true }, at: 100 });
putDossier("sa2", { dim: "power", director: { role: "A4 力量体系 总监", name: "墟海" }, summary: { text: "力量体系 8 阶", source: "collect", ok: true }, at: 200 });
putDossier("sa3", { dim: "prose", director: { role: "A8 正文 总监", name: "墟海" }, summary: { text: "", source: "none", ok: false, reason: "回收未读到产出" }, at: 300 });
putDossier("orphan1", { dim: "old", director: { role: "A9 幽灵 总监", name: "墟海" }, at: 400 });

const st = dossierStats(ALIVE);
t("MC-2a", "🔴 恒等式 ①：`aliveCount === withAlive + missingAlive`（存活集被**完整分割**，不重不漏）",
	st.aliveCount === st.withAlive + st.missingAlive && st.aliveCount === ALIVE.length,
	{ aliveCount: st.aliveCount, withAlive: st.withAlive, missingAlive: st.missingAlive });

t("MC-2b", "🔴 恒等式 ②：`total === withAlive + orphans`（档案集 = 存活∩有档 + 孤儿；单一真相源，纪律 78）",
	st.total === st.withAlive + st.orphans && st.orphans === 1,
	{ total: st.total, withAlive: st.withAlive, orphans: st.orphans });

t("MC-2c", "🔴 三路读数与**手工逐条**核对一致（`withAlive=3` / `missingAlive=5` / `missingIds` 逐条真在存活集里且真无档）",
	st.withAlive === 3 && st.missingAlive === 5 && st.missingIds.length === 5
	&& st.missingIds.every((id) => ALIVE.indexOf(id) >= 0 && !readDossiers()[id]),
	{ st: { w: st.withAlive, m: st.missingAlive }, ids: st.missingIds });

/* 🔴 负对照：**不传存活集** ⇒ 三路必须全 0。
 *    "读不到存活集"与"存活集为空"在数字上无法区分，但处置相反
 *    （前者必须说"不知道"，后者才是"一个都没有"）⇒ 不许把"不知道"算成"全缺"。 */
const stNo = statsFn();
t("MC-2d", "负对照：不传存活集 ⇒ `aliveCount/withAlive/missingAlive` **全 0**（不许把「不知道」当成「全缺」）",
	stNo.aliveCount === 0 && stNo.withAlive === 0 && stNo.missingAlive === 0 && stNo.missingIds.length === 0,
	{ aliveCount: stNo.aliveCount, withAlive: stNo.withAlive, missingAlive: stNo.missingAlive });

/* 全覆盖时的读数：**一个都不能缺** */
const ALIVE2 = ["sa1", "sa2", "sa3"];
const stFull = dossierStats(ALIVE2);
t("MC-2e", "全覆盖会话集 ⇒ `missingAlive === 0` 且 `aliveCount === withAlive`（这是 N6 判据 1 的读数形态）",
	stFull.missingAlive === 0 && stFull.aliveCount === stFull.withAlive && stFull.withAlive === 3,
	{ aliveCount: stFull.aliveCount, withAlive: stFull.withAlive, missingAlive: stFull.missingAlive });

/* ══════════════════ MC-3 · N6 判据 1/2 逐会话 ══════════════════ */

let missRole = 0, missSummary = 0;
ALIVE2.forEach((id) => {
	const d = readDossiers()[id];
	if (!d || !d.director || !d.director.role) missRole++;
	if (!d || !d.summary) missSummary++;
});
t("MC-3a", "🔴 **逐会话**（不是「至少有一条」）：每个存活会话都有 `director.role` 与 `summary` 字段",
	missRole === 0 && missSummary === 0, { missRole: missRole, missSummary: missSummary });

/* 🔴 判据 2：档案**挂到树上**的形态 —— 5 个字段必须被 `applyDossiers` 真的写上去
 *    （`MindMap.js` 只做 DOM 投影：4 个 `data-dossier-*` + 1 个独立布尔位 `data-has-dossier`）。
 *    ⚠️ 19 号文写「5 个 `data-dossier-*`」，实测产品是 **4 个 `data-dossier-*` + 1 个 `data-has-dossier`**
 *    —— `data-has-dossier` 是**独立布尔位**（区分「没有档案」与「有档案但角色为空」），
 *    它不是 `data-dossier-` 前缀。判据按**真实口径**锁，文档措辞在 P10 就地更正。 */
const tree = { rows: [{ sessionId: "sa1", running: false, title: "宿主标题" }] };
const ap = applyDossiers(tree, readDossiers());
const r0 = tree.rows[0];
const FIELD5 = ["hasDossier", "dossierRole", "dossierSummary", "dossierSummarySrc", "dossierSummaryReason"];
const present = FIELD5.filter((k) => Object.prototype.hasOwnProperty.call(r0, k));
t("MC-3b", "N6 判据 2：`applyDossiers` 挂上 **5 个档案字段**（`hasDossier` 独立布尔位 + 4 个 `dossier*`）",
	present.length === 5 && r0.hasDossier === true && r0.dossierRole === "A1 世界观 总监", present);

t("MC-3c", "🔴 两条路径**同源对账**（纪律 78）：`applyDossiers.applied` 与 `dossierStats.withAlive` 在**同一输入**下必须相等",
	ap.applied === dossierStats(["sa1"]).withAlive && ap.applied === 1, { applied: ap.applied });

tree.rows[1] = { sessionId: "sa_not_in_dossier" };
applyDossiers(tree, readDossiers());
t("MC-3d", "负对照：树上**没有档案**的行不挂任何字段（不许给每行都打标记 —— 那会让「覆盖」这个读数失去意义）",
	FIELD5.every((k) => !Object.prototype.hasOwnProperty.call(tree.rows[1], k)), null);

/* ══════════════════ MC-4 · P1 触点显式标注 + 接线 ══════════════════
 * P1 的**本版选择**：`T-PLUG-050` 未裁定 ⇒ 「登记为流转」**不写总监消息**，
 *   但必须**显式标注**（纪律 19：降级可以，无声不行）。
 * 判据 = 三处落地同时存在：源码提示文案 / 源码调用点 / **产物接线**。
 * 🔴 为什么读产物：P1–P3 的事故形态正是「src 里写了、产物里没生效」。 */

const srcPage = (() => {
	try { return readFileSync(fileURLToPath(new URL("../src/components/DirectorPage.js", import.meta.url)), "utf8"); }
	catch (e) { return ""; }
})();
const srcDisp = (() => {
	try { return readFileSync(fileURLToPath(new URL("../src/logic/director-dispatch.js", import.meta.url)), "utf8"); }
	catch (e) { return ""; }
})();
const bundle = (() => {
	try { return readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8"); }
	catch (e) { return ""; }
})();

t("MC-4a", "P1：总监页「登记为流转」的提示**显式标注**了「不产生总监消息」（并把可执行替代路径写出来）",
	srcPage.indexOf("不产生总监消息") >= 0 && srcPage.indexOf("要总监回应请用右侧「执行」") >= 0,
	{ bytes: srcPage.length });

t("MC-4b", "P3 接线：`director-dispatch.js` 的 `briefOf` 调用点传了**第 7 参**（`prevSummary`），且 `prevSummaryLen` 读数落地",
	/briefOf\(dim, src, p\.name, project, org, null, prevSummary\)/.test(srcDisp)
	&& srcDisp.indexOf("prevSummaryLen") >= 0, { bytes: srcDisp.length });

t("MC-4c", "🔴 **接线进了产物**：`lib/client.js` 含 `prevSummaryLen` 与 `【上一轮结论` 锚点（`src` 写了不等于产物生效）",
	bundle.indexOf("prevSummaryLen") >= 0 && bundle.indexOf("上一轮结论") >= 0,
	{ bundleBytes: bundle.length });

/* ══════════════════ MC-5 · 编号与读数汇总 ══════════════════ */

t("MC-5a", "断言编号唯一（本文件内置重号自检；重号 = 静默覆盖，纪律 32）", seen.size === pass + fail,
	{ seen: seen.size, ran: pass + fail });

console.log("");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (fail) console.log("  失败：" + failures.join(" ｜ "));
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
process.exit(fail === 0 ? 0 : 1);
