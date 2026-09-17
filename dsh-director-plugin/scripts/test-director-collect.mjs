#!/usr/bin/env node
/**
 * test-director-collect.mjs —— 「分支产出回收 + 总裁定」**离线测试**（无需 Harness）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 第 17 批「总监枢纽闭环」把回收与总裁定放进 `logic/director-collect.js`。
 * 第 18 批在这里踩到一个**口径矛盾**（真机读数里同时出现「📥 回收 8/8」
 * 与「已产出 1/8 条」）—— 根因是 `verdictOf` 用了 `counts.done`（宿主视角
 * "这一轮跑完了"）而读数的 `say` 是**我们的**视角"拿到正文了"。
 * 本套件的核心就是**把这两个量钉死**（DC-9 / DC-10 是一对正负对照）。
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | DC-1 | `digestOf` 空白归一 | 换行/多空格压成单空格并 trim |
 *  | DC-2 | `digestOf` 截断 | 超长 ⇒ 长度**恰为** `max`、末尾是 `…` |
 *  | DC-3 | `digestOf` 非法 `max` | 回落 160（`0` / 负数 / `"x"` / `null`） |
 *  | DC-4 | `digestOf` 空值 | `null`/`undefined` ⇒ `""`，不抛 |
 *  | DC-5 | `countStates` 五态分类 | 各计正确，`total` = 条数，**不新增字段** |
 *  | DC-6 | `countStates` 未知 state | 归入 `unknown`（不是丢弃、不是新增键） |
 *  | DC-7 | `countStates.failed` | **只看** `sentOk === false`，且**不干扰** state 分类 |
 *  | DC-8 | 🔴 `countStates.say` | **只有非空正文**计入（`""` / `"   "` **不算**） |
 *  | DC-9 | 🔴 `verdictOf` 口径 = `say` **不是** `done`（第 18 批修正） | `done=1/running=7/say=8` ⇒ 文案**必须**是「8 条**全部有产出**（其中 7 条仍在跑）」，**不得**出现 `1/8` |
 *  | DC-10 | 🔴 `verdictOf` **负对照** | `done=8/say=0` ⇒ **必须**说"尚无产出"（不许因为 `done` 就报有产出） |
 *  | DC-11 | `verdictOf` 空台账 | 「无分支（还没派发）」 |
 *  | DC-12 | `verdictOf` failed 优先 | `failed>0` ⇒ 文案指向"简报未送达"，且**不再**报产出数 |
 *  | DC-13 | `verdictOf` 部分产出 + 仍在跑 | 同时含 `3/8` 与"仍在运行" |
 *  | DC-14 | `verdictOf` 兜底分支 | `say=3/total=8/running=0/partial=5` ⇒ 含"跑过但未拿到回复" |
 *  | DC-15 | `nextActionOf` 五分支 | 五种输入各命中对应 `key`（含**优先级**顺序） |
 *  | DC-16 | 🔴 `digestMessage` 读不到的条目**也要列** | 8 条里 3 条有产出 ⇒ **5 个未产出 label 逐条可见**（第 23 批改写：旧口径数"产出未读到"次数，只能证明"某串印了 5 遍"，证明不了"印的是那 5 条"） |
 *  | DC-17 | `digestMessage` 结构 | 含「【总监汇总】总评：」与「下一步建议：」两段（第 23 批：首段由「回收产出」改为**归纳式**汇总） |
 *  | DC-18 | 🔴 正负对照：**条目完备性** | 8 个分支 label **全部**出现（8/8），空例 **0 个**（第 23 批改写：旧口径"行数 == items.length"在归并式输出下已不成立，但**意图不变**——不许漏条） |
 *  | DC-23 | 🔴 **同因归并**（第 23 批新增） | 5 条同一原因 ⇒ 该原因**只印 1 次**，且 5 个维度名**全在**（合并的是原因，不是条目） |
 *  | DC-24 | 🔴 **`projectVerdict` 三态可分**（第 23 批新增） | 全无产出+宿主报错 ⇒「未推进…先处置环境」；全有产出 ⇒「全部维度有产出」；部分 ⇒「推进 x/y」 |
 *
 * 用法：node scripts/test-director-collect.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

/* ── 桩（必须在**第一次读写之前**装好）：本模块只用到纯函数，
 *    但 import 链里有 `store/dispatch-log.js`（读 localStorage）与 `logic/branch-tree.js`。 */
const store = new Map();
globalThis.localStorage = {
	getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
	setItem(k, v) { store.set(String(k), String(v)); },
	removeItem(k) { store.delete(String(k)); }
};

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const {
	digestOf, countStates, verdictOf, nextActionOf, digestMessage, projectVerdict
} = await import("../src/logic/director-collect.js");

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 **闸门自检**（跑任何断言之前）：断言编号必须唯一。
 *   重号让报告**失去可归因性** —— 读的人分不清红的是哪一条，"全绿"也可能藏着"有一条没跑"。
 *   第 23 批真的踩到了：新增「同因归并」两条时用了 `DC-20`/`DC-21`，
 *   与**第 19 批已占**的两条撞号 ⇒ 输出里出现两个 DC-20、两个 DC-21。
 *   ⇒ 放在最前面：**零副作用**（不读产品状态）⇒ 可廉价校准（种一个重号应立刻 exit 2）。
 * ══════════════════════════════════════════════════════════════════════ */
{
	const selfSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
	const ids = [...selfSrc.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]);
	const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
	if (dup.length) {
		console.error("IS_PASS: FALSE（INVALID：断言编号重号 " + dup.length + " 个 —— " + dup.join(", ") + "）");
		console.error("  真因：同一编号被写两次 ⇒ 报告不可归因；根因常是**头部段号表漏登记**。");
		console.error("  处置：改号为未占用编号，并同步补头部段表。");
		process.exit(2);
	}
	console.log("  [自检] 断言编号唯一：" + ids.length + " 条，零重号");
}

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}` + (detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  test-director-collect · 回收产出 / 总裁定 / next action");
console.log("═══════════════════════════════════════════════════════════");

/* ── digestOf ── */
console.log("\n【digestOf：摘要截断（纯）】");
t("DC-1", "空白归一：换行与连续空格压成单空格并 trim",
	digestOf("  a\n\nb   c \t d  ") === "a b c d", digestOf("  a\n\nb   c \t d  "));
t("DC-2", "截断：超长 ⇒ 长度恰为 max 且末尾是 `…`",
	(digestOf("x".repeat(300), 20).length === 20) && digestOf("x".repeat(300), 20).slice(-1) === "…",
	{ len: digestOf("x".repeat(300), 20).length });
t("DC-3", "非法 max 回落 160（0 / 负数 / 非数字 / null）",
	digestOf("y".repeat(300), 0).length === 160 && digestOf("y".repeat(300), -5).length === 160
	&& digestOf("y".repeat(300), "x").length === 160 && digestOf("y".repeat(300), null).length === 160,
	{ a: digestOf("y".repeat(300), 0).length, b: digestOf("y".repeat(300), "x").length });
t("DC-4", "空值 ⇒ `\"\"`，不抛", digestOf(null) === "" && digestOf(undefined) === "" && digestOf("   ") === "");

/* ── countStates ── */
console.log("\n【countStates：五态分类（纯）】");
const mk = (state, extra) => Object.assign({ state: state, label: "L", say: "" }, extra || {});
const five = [mk("done"), mk("running"), mk("blank"), mk("partial"), mk("unknown", { state: "unknown" })];
/* 🔴 冻结键（第 19 批口径修正）：纪律 ⑦ = **不可改名、不可删除，但新增允许**。
 *    原断言写的是「键集完全相等」，于是本轮新增 `hostFailed` / `hostFailWhy`
 *    被判红 —— 那是**守卫口径过严**（把"冻结"读成了"冻结键集大小"）。
 *    真正要防的是：五态被改名 / total、say、failed 被删（那会让所有下游读数错位）。
 *    ⇒ 改为「冻结键一个不少」+ 显式打印新增键（新增要**看得见**，不是偷偷加）。 */
const FROZEN_COUNTS = ["blank", "done", "failed", "partial", "running", "say", "total", "unknown"];
const missingFrozen = (o) => FROZEN_COUNTS.filter((k) => !Object.prototype.hasOwnProperty.call(o, k));
const extraKeys = (o) => Object.keys(o).filter((k) => FROZEN_COUNTS.indexOf(k) < 0);
const c5 = countStates(five);
t("DC-5", "五态各计 1、total=5、且**冻结键一个不少**（新增允许、改名/删除不允许 —— 纪律 ⑦）",
	c5.done === 1 && c5.running === 1 && c5.blank === 1 && c5.partial === 1 && c5.unknown === 1 && c5.total === 5
	&& missingFrozen(c5).length === 0,
	{ c5: c5, missing: missingFrozen(c5), extra: extraKeys(c5) });
const cUnknown = countStates([mk("wat"), mk("")]);
t("DC-6", "未知 state 归入 `unknown`（不丢弃、不给未知 state **新建键**）",
	cUnknown.unknown === 2 && cUnknown.total === 2
	&& cUnknown["wat"] === undefined && cUnknown[""] === undefined
	&& missingFrozen(cUnknown).length === 0,
	cUnknown);
const cFailed = countStates([mk("done", { sentOk: false }), mk("running", { sentOk: true })]);
t("DC-7", "`failed` 只看 `sentOk === false`，且**不干扰** state 分类",
	cFailed.failed === 1 && cFailed.done === 1 && cFailed.running === 1, cFailed);
t("DC-8", "🔴 `say` **只数非空正文**（`\"\"` 与 `\"   \"` 都不算）",
	countStates([mk("done", { say: "有" }), mk("done", { say: "" }), mk("done", { say: "   " })]).say === 1,
	countStates([mk("done", { say: "有" }), mk("done", { say: "" }), mk("done", { say: "   " })]));

/* ── verdictOf（本轮修正的核心）── */
console.log("\n【verdictOf：总裁定（口径 = say，不是 done）】");
const vReal = verdictOf({ total: 8, done: 1, running: 7, say: 8 });
t("DC-9", "🔴 真机读数复现：`done=1/running=7/**say=8**` ⇒ 必须说「8 条全部有产出（其中 7 条仍在跑）」，**不得**出现 `1/8`",
	vReal.indexOf("8 条") >= 0 && vReal.indexOf("全部有产出") >= 0 && vReal.indexOf("7 条仍在跑") >= 0 && vReal.indexOf("1/8") < 0,
	vReal);
const vNoSay = verdictOf({ total: 8, done: 8, running: 0, say: 0 });
t("DC-10", "🔴 **负对照**：`done=8` 但 `say=0` ⇒ 必须说\"尚无产出\"（不许因 done 就报有产出）",
	vNoSay.indexOf("尚无产出") >= 0 && vNoSay.indexOf("全部有产出") < 0, vNoSay);
t("DC-11", "空台账 ⇒ 「无分支（还没派发）」",
	verdictOf({ total: 0 }) === "无分支（还没派发）" && verdictOf(null) === "无分支（还没派发）");
const vFailed = verdictOf({ total: 8, say: 8, failed: 3 });
t("DC-12", "`failed>0` **优先**报未送达，且**不再**报产出数（防两个口径同时出现）",
	vFailed.indexOf("简报未送达") >= 0 && vFailed.indexOf("有产出") < 0, vFailed);
const vPart = verdictOf({ total: 8, say: 3, running: 5, done: 0, partial: 0 });
t("DC-13", "部分产出 + 仍在跑 ⇒ 同时含 `3/8` 与\"仍在运行\"",
	vPart.indexOf("已产出 3/8") >= 0 && vPart.indexOf("仍在运行") >= 0, vPart);
const vTail = verdictOf({ total: 8, say: 3, running: 0, done: 3, partial: 5 });
t("DC-14", "兜底分支 ⇒ 含\"跑过但未拿到回复\"",
	vTail.indexOf("5 条跑过但未拿到回复") >= 0, vTail);

/* ── nextActionOf ── */
console.log("\n【nextActionOf：下一步建议（纯）】");
const nx = [
	[nextActionOf({ total: 0 }, []), "dispatch"],
	[nextActionOf({ total: 3, failed: 2 }, []), "inspect-failed"],
	[nextActionOf({ total: 3, say: 0 }, [{ state: "partial" }]), "inspect-partial"],
	[nextActionOf({ total: 3, say: 0, running: 2 }, []), "wait"],
	[nextActionOf({ total: 3, say: 3, running: 0 }, []), "review"],
	[nextActionOf({ total: 3, say: 0, running: 0 }, []), "recollect"]
];
t("DC-15", "六种输入各命中对应 `key`（含优先级：failed > partial > running > say）",
	nx.every((p) => p[0].key === p[1]) && nx.every((p) => p[0].label && p[0].why),
	nx.map((p) => p[0].key + "≠" + p[1]));

/* ── digestMessage ── */
console.log("\n【digestMessage：回写总监的汇总文本（纯）】");
const eight = [
	{ label: "「A1 世界观」《墟海》", state: "done", stateSource: "宿主快照", say: "正文一" },
	{ label: "「A2 力量体系」《墟海》", state: "done", stateSource: "宿主快照", say: "正文二" },
	{ label: "「A3 剧情」《墟海》", state: "done", stateSource: "宿主快照", say: "正文三" },
	{ label: "「A4 人物」《墟海》", state: "running", stateSource: "宿主快照", say: "", sayReason: "尚未回收（点「回收产出」才读各分支事件流）" },
	{ label: "「A5 正文」《墟海》", state: "running", stateSource: "宿主快照", say: "", sayReason: "尚未回收（点「回收产出」才读各分支事件流）" },
	{ label: "「A6 打磨」《墟海》", state: "running", stateSource: "宿主快照", say: "", sayReason: "尚未回收（点「回收产出」才读各分支事件流）" },
	{ label: "「A7 审查」《墟海》", state: "running", stateSource: "宿主快照", say: "", sayReason: "尚未回收（点「回收产出」才读各分支事件流）" },
	{ label: "「A8 蒸馏」《墟海》", state: "running", stateSource: "宿主快照", say: "", sayReason: "尚未回收（点「回收产出」才读各分支事件流）" }
];
const msg = digestMessage(eight, countStates(eight));
/* 🔴 第 23 批改写（原 DC-16）：旧口径数"产出未读到"出现次数（恰 5 次）。新版措辞变了，
 *    但**意图不变**：未产出的条目必须**逐条可见**。改判据为「5 个未产出 label 全在文案里」——
 *    比数字符串次数**更贴合意图**（数次数只能证明"有个东西印了 5 遍"，证明不了"印的是那 5 条"）。 */
const SILENT5 = ["A4 人物", "A5 正文", "A6 打磨", "A7 审查", "A8 蒸馏"];
const silentVisible = SILENT5.filter((x) => msg.indexOf(x) >= 0).length;
t("DC-16", "🔴 未产出的 5 条**逐条可见**（不许因为归并而吞掉条目名）",
	silentVisible === 5, { visible: silentVisible, of: 5 });
t("DC-17", "结构完整：含「【总监汇总】总评：」与「下一步建议：」两段",
	msg.indexOf("【总监汇总】总评：") >= 0 && msg.indexOf("下一步建议：") >= 0, msg.slice(0, 80));
/* 🔴 第 23 批改写（原 DC-18）：旧口径"条目行数 == items.length"在**归并式**输出下已不成立
 *    （5 条同因会被并成 1 行）。⇒ 换成**更强的意图判据**：每条分支的 label 都必须出现。 */
const LABELS8 = ["A1 世界观", "A2 力量体系", "A3 剧情", "A4 人物", "A5 正文", "A6 打磨", "A7 审查", "A8 蒸馏"];
const shown8 = LABELS8.filter((x) => msg.indexOf(x) >= 0).length;
const msg0 = digestMessage([], countStates([]));
const shown0 = LABELS8.filter((x) => msg0.indexOf(x) >= 0).length;
t("DC-18", "🔴 正负对照：8 个分支 label **全部**出现（8/8）；空例 **0 个** label 且不崩",
	shown8 === 8 && shown0 === 0 && msg0.length > 0, { pos: shown8, neg: shown0 });
/* ══════════════════════════════════════════════════════════════════════
 * 🔴 第 23 批新增：**同因归并**（用户原话「总监对语言的整理，对于文字的描述」）
 *   真机旧行为：8 条全部因 `Insufficient Balance（QUOTA 402）` 无产出
 *     ⇒ 同一原因**重复印 8 遍**（822 B）⇒ 用户读完的信息量 = 4 个字。
 *   🔴 归并的纪律：合并的是**原因**，不是**条目** —— 维度名一条都不许少（DC-16 守着这一点）。
 * ══════════════════════════════════════════════════════════════════════ */
const sameWhy = [1, 2, 3, 4, 5].map((i) => ({
	label: "「D" + i + "」", state: "partial", stateSource: "宿主快照", say: "",
	sayReason: "宿主本轮运行失败：Insufficient Balance（QUOTA 402）"
}));
const msgSame = digestMessage(sameWhy, countStates(sameWhy));
const whyTimes = (msgSame.match(/Insufficient Balance/g) || []).length;
t("DC-23", "🔴 同因归并：5 条同一原因 ⇒ 该原因**只印 1 次**（旧版 5 次），且 5 个维度名**全在**",
	whyTimes === 1 && [1, 2, 3, 4, 5].every((i) => msgSame.indexOf("D" + i) >= 0),
	{ whyTimes: whyTimes, lines: msgSame.split("\n").length });
t("DC-24", "🔴 `projectVerdict` 三态可分（环境阻塞 / 全部有产出 / 部分推进）",
	projectVerdict({ total: 8, say: 0, hostFailed: 8, hostFailWhy: "Insufficient Balance（QUOTA）" }).indexOf("未推进") >= 0
	&& projectVerdict({ total: 8, say: 0, hostFailed: 8 }).indexOf("先处置环境") >= 0
	&& projectVerdict({ total: 8, say: 8, running: 0 }).indexOf("全部维度有产出") >= 0
	&& projectVerdict({ total: 8, say: 3, running: 1 }).indexOf("推进 3/8") >= 0,
	[projectVerdict({ total: 8, say: 0, hostFailed: 8 }), projectVerdict({ total: 8, say: 8 }), projectVerdict({ total: 8, say: 3, running: 1 })]);

/* ── 🔴 第 19 批：宿主自报的运行失败（环境阻塞 vs 产品失败必须可分 —— 纪律 58）──
 * 真机背景（2026-09-16）：8 条分支简报**全部投达**且运行**真的启动了**，
 * 但宿主 `turn/end.reason.error = {message:"Insufficient Balance", code:"QUOTA", status:402}`。
 * 旧读数是「只有用户侧条目，没有助手回复（跑了但没产出，或还在跑）」——
 * 与"插件根本没投出去"**长得一样**，用户会去查插件而不是去充值。 */
console.log("\n【宿主自报失败：环境阻塞与产品失败必须可分（第 19 批）】");
const hostErr = [
	mk("partial", { runFailure: { message: "Insufficient Balance", code: "QUOTA", status: 402 } }),
	mk("partial", { runFailure: { message: "Insufficient Balance", code: "QUOTA", status: 402 } }),
	mk("partial", { runFailure: { message: "network timeout", code: null, status: null } })
];
const cErr = countStates(hostErr);
t("DC-19", "🔴 `hostFailed` 数出宿主报错的条数，且 `hostFailWhy` 带出**第一条**可读原因（含 code）",
	cErr.hostFailed === 3 && cErr.hostFailWhy === "Insufficient Balance（QUOTA）" && cErr.total === 3
	&& missingFrozen(cErr).length === 0,
	cErr);
const cNoErr = countStates([mk("partial"), mk("done", { say: "有正文" })]);
t("DC-20", "🔴 负对照：没有 `runFailure` 的条目**不计入** `hostFailed`（否则会把「还没跑完」误报成「宿主报错」）",
	cNoErr.hostFailed === 0 && cNoErr.hostFailWhy === "", cNoErr);
const vErr = verdictOf(cErr);
const vNoErr = verdictOf(countStates([mk("running"), mk("running")]));
t("DC-21", "🔴 总裁定在宿主报错时**必须**说明「简报已送达、是模型侧没出结果」并带出原因；**不得**再说「可能都在跑」",
	vErr.indexOf("宿主侧报错 3 条") >= 0 && vErr.indexOf("Insufficient Balance") >= 0
	&& vErr.indexOf("已送达") >= 0 && vErr.indexOf("可能都在跑") < 0,
	vErr);
t("DC-22", "🔴 负对照：**没有**宿主报错时沿用原文案（防「有原因」分支被滥用到「没原因」的场合）",
	vNoErr.indexOf("尚无产出可回收（可能都在跑，或简报未生效）") >= 0 && vNoErr.indexOf("宿主侧报错") < 0,
	vNoErr);

console.log("\n═══════════════════════════════════════════════════════════");
console.log(`  PASS ${pass} / FAIL ${fail} / 总计 ${pass + fail}`);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log(`  IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
