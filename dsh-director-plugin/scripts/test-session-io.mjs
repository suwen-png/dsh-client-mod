#!/usr/bin/env node
/**
 * test-session-io.mjs —— 「会话 IO 桥」**离线测试**（无需 Harness）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * `bridge/session-io.js` 是回收链的第一段：**不切页签**从宿主事件流里取出
 * 「用户说了什么 / 助手回了什么 / 标题 / 结束原因」，并给出**状态判定**。
 * 它一旦读错，下游 `verdictOf` 的"8 条里几条有产出"就是错的 ——
 * 而那是用户唯一能看到的结论（第 17 批需求：总裁要给出裁定）。
 *
 * 🔴 本套件的重点在**负对照**：注入文本必须**只按开头**判（含 `<system-reminder>`
 *    开头的才叫注入），否则分支里写"如何写系统提示词"的文章会被**整段误杀**。
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | SIO-1 | `isInjectedUserText` 注入识别 | 三种注入前缀 ⇒ `true`；空/纯空白 ⇒ `true` |
 *  | SIO-2 | 🔴 `isInjectedUserText` **负对照** | 正文里**提到**这些词（非开头）⇒ `false`（防"包含"式误杀） |
 *  | SIO-3 | `extractTurns` 取两类事件 | `user/message` + `assistant/message` 各成一条，顺序保持 |
 *  | SIO-4 | 🔴 `extractTurns` **负对照**：流式块不入条目 | `assistant/chunk` / `turn/*` / `step/*` **不产生**对话条目 |
 *  | SIO-5 | `extractTurns` 侧信道 | `session/title` ⇒ `title`；`turn/end` ⇒ `endReason` |
 *  | SIO-6 | `extractTurns` 过滤注入 | 注入的 user/message **不进** items（正负对照：紧随其后的真消息**必须进**） |
 *  | SIO-7 | `extractTurns` 容错 | 非数组 / 空 / 坏元素 ⇒ 不抛，返回空结构 |
 *  | SIO-8 | `stateOfSummary` 五态 | `running` / `blank` / `done` / `partial` / `unknown` 各命中 |
 *  | SIO-9 | 🔴 `stateOfSummary` 优先级 | `running=true` 压过 `blank=true` 与 `turns>0`（宿主说在跑就是在跑） |
 *  | SIO-10 | 🔴 `stateOfSummary` 负对照 | `turns>0` 但**无正文** ⇒ `partial`（**不是** `done`）—— 这是"跑过但没拿到回复"的唯一来源 |
 *  | SIO-11 | `stateOfSummary` 空值 | `null` / 非对象 ⇒ `unknown` 且字段全 `null` |
 *  | SIO-12 | `findSummary` | 按 id 匹配（**字符串/数字混用也命中**）；找不到 ⇒ `null`；非数组 ⇒ `null` |
 *
 * 用法：node scripts/test-session-io.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

/* ── 桩：`session-io.js` 顶部 import 了 `branch-tree.js`，后者会摸 window/localStorage ── */
const store = new Map();
globalThis.localStorage = {
	getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
	setItem(k, v) { store.set(String(k), String(v)); },
	removeItem(k) { store.delete(String(k)); }
};

const { isInjectedUserText, extractTurns, stateOfSummary, findSummary } = await import("../src/bridge/session-io.js");

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}` + (detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  test-session-io · 事件流解析 / 状态判定");
console.log("═══════════════════════════════════════════════════════════");

/* ── isInjectedUserText ── */
console.log("\n【isInjectedUserText：注入识别（纯）】");
t("SIO-1", "三种注入前缀 ⇒ true；空 / 纯空白 ⇒ true（**没有内容就不算用户发言**）",
	isInjectedUserText("Current runtime context: ...") === true
	&& isInjectedUserText("<system-reminder>\nfoo") === true
	&& isInjectedUserText("<system_reminder>x") === true
	&& isInjectedUserText("") === true
	&& isInjectedUserText("   \n  ") === true
	&& isInjectedUserText(null) === true);
t("SIO-2", "🔴 **负对照**：正文里**提到**这些词（非开头）⇒ false（防「包含」式整段误杀）",
	isInjectedUserText("请帮我写一段 <system-reminder> 的使用说明") === false
	&& isInjectedUserText("关于 Current runtime context 这个概念，我的理解是…") === false
	&& isInjectedUserText("帮我写一个小说《墟海》") === false);

/* ── extractTurns ── */
console.log("\n【extractTurns：事件流 → 对话条目（纯）】");
const ev = [
	{ event: { type: "user/message", time: 100, data: { turn: 1, content: [{ type: "text", text: "帮我写一个小说《墟海》" }] } } },
	{ event: { type: "assistant/chunk", time: 120, data: { delta: "正" } } },
	{ event: { type: "assistant/message", time: 200, data: { turn: 1, message: { content: [{ type: "text", text: "好的，先搭世界观。" }] } } } },
	{ event: { type: "turn/end", time: 210, data: { reason: { kind: "completed" } } } },
	{ event: { type: "session/title", time: 220, data: { title: "「A1 世界观」《墟海》" } } },
	{ event: { type: "step/start", time: 230, data: {} } }
];
const e1 = extractTurns(ev);
t("SIO-3", "取两类事件：user/message + assistant/message 各一条，顺序保持",
	e1.items.length === 2 && e1.items[0].role === "user" && e1.items[0].text.indexOf("墟海") >= 0
	&& e1.items[1].role === "assistant" && e1.items[1].text.indexOf("世界观") >= 0,
	e1.items);
t("SIO-4", "🔴 **负对照**：`assistant/chunk` / `turn/*` / `step/*` **不产生**对话条目（只有 2 条，不是 6 条）",
	e1.items.length === 2, { got: e1.items.length, roles: e1.items.map((x) => x.role) });
t("SIO-5", "侧信道：`session/title` ⇒ title；`turn/end` ⇒ endReason",
	e1.title === "「A1 世界观」《墟海》" && e1.endReason === "completed", { title: e1.title, end: e1.endReason });
const ev2 = [
	{ event: { type: "user/message", time: 1, data: { content: [{ type: "text", text: "<system-reminder>注入的" }] } } },
	{ event: { type: "user/message", time: 2, data: { content: [{ type: "text", text: "真正的需求" }] } } }
];
const e2 = extractTurns(ev2);
t("SIO-6", "过滤注入的 user/message（正负对照：紧随其后的**真消息必须进**）",
	e2.items.length === 1 && e2.items[0].text === "真正的需求", e2.items);
const e3 = extractTurns(null), e4 = extractTurns([null, 1, "x", {}]);
t("SIO-7", "容错：非数组 / 空 / 坏元素 ⇒ 不抛，返回空结构",
	e3.items.length === 0 && e3.title === null && e4.items.length === 0);

/* ── stateOfSummary ── */
console.log("\n【stateOfSummary：状态判定（纯）】");
const rawOf = (o) => Object.assign({ id: "s1" }, o || {});
t("SIO-8", "五态各命中：running / blank / done / partial / unknown",
	stateOfSummary(rawOf({ running: true }), "").state === "running"
	&& stateOfSummary(rawOf({ blank: true }), "").state === "blank"
	&& stateOfSummary(rawOf({ projectionValues: { sessionStats: { turns: 2 } } }), "有正文").state === "done"
	&& stateOfSummary(rawOf({ projectionValues: { sessionStats: { turns: 2 } } }), "").state === "partial"
	&& stateOfSummary(rawOf({}), "").state === "unknown",
	["running", "blank", "done", "partial", "unknown"].map((k) => k + "=" + (stateOfSummary(
		{ running: k === "running", blank: k === "blank", projectionValues: { sessionStats: { turns: (k === "done" || k === "partial") ? 2 : 0 } } },
		k === "done" ? "有正文" : "").state)));
t("SIO-9", "🔴 优先级：`running=true` 压过 `blank=true` 与 `turns>0`（宿主说在跑就是在跑）",
	stateOfSummary(rawOf({ running: true, blank: true, projectionValues: { sessionStats: { turns: 9 } } }), "有正文").state === "running");
t("SIO-10", "🔴 **负对照**：`turns>0` 但**无正文** ⇒ `partial`（**不是** `done`）—— 「跑过但没拿到回复」的唯一来源",
	stateOfSummary(rawOf({ projectionValues: { sessionStats: { turns: 3 } } }), "   ").state === "partial",
	stateOfSummary(rawOf({ projectionValues: { sessionStats: { turns: 3 } } }), "   "));
const sEmpty = stateOfSummary(null, "x");
t("SIO-11", "空值 / 非对象 ⇒ `unknown` 且字段全 `null`",
	sEmpty.state === "unknown" && sEmpty.turns === null && sEmpty.outputTokens === null && sEmpty.title === null, sEmpty);

/* ── findSummary ── */
console.log("\n【findSummary：按 id 取原始摘要（纯）】");
const raws = [{ id: "session-a", displayTitle: "A" }, { id: "session-b", displayTitle: "B" }];
t("SIO-12", "按 id 命中（**字符串/数字混用也命中**）；找不到 ⇒ null；非数组 ⇒ null",
	findSummary(raws, "session-b") && findSummary(raws, "session-b").displayTitle === "B"
	&& findSummary(raws, "session-zz") === null
	&& findSummary(null, "session-a") === null
	&& findSummary([{ id: 7 }], "7") !== null,
	{ hit: findSummary(raws, "session-b"), miss: findSummary(raws, "session-zz"), num: findSummary([{ id: 7 }], "7") });

/* ── 🔴 第 19 批：turn/end 的失败详情（环境阻塞必须可读 —— 纪律 58）──
 * 真机样本（2026-09-16，逐字取自宿主事件流）：
 *   {"type":"turn/end","data":{"turn":1,"reason":{"kind":"error",
 *     "error":{"message":"Insufficient Balance","code":"QUOTA","status":402}}}}
 * 旧代码只留 `reason.kind="error"` ⇒ 「配额不足」与「模型拒答」在界面上长得一样。 */
console.log("\n【extractTurns · 宿主失败详情（第 19 批）】");
const evFail = [
	{ event: { type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "Insufficient Balance", code: "QUOTA", status: 402 } } } } }
];
const eFail = extractTurns(evFail);
t("SIO-13", "🔴 `turn/end` 的 `reason.error` ⇒ 取出 `message/code/status`（三个字段都不许丢）",
	eFail.endReason === "error" && eFail.endFailure
	&& eFail.endFailure.message === "Insufficient Balance"
	&& eFail.endFailure.code === "QUOTA" && eFail.endFailure.status === 402,
	eFail.endFailure);
const evFail2 = [
	{ event: { type: "turn/end", data: { turn: 1, reason: { kind: "error", failure: { message: "boom" } } } } },
	{ event: { type: "turn/end", data: { turn: 2, reason: { kind: "stop" } } } }
];
const eFail2 = extractTurns(evFail2);
t("SIO-14", "🔴 兼容 `reason.failure` 写法；`code`/`status` 缺失 ⇒ `null`（不编造 0）",
	eFail2.endFailure && eFail2.endFailure.message === "boom"
	&& eFail2.endFailure.code === null && eFail2.endFailure.status === null,
	eFail2.endFailure);
const eOk = extractTurns([{ event: { type: "turn/end", data: { turn: 1, reason: { kind: "stop" } } } }]);
t("SIO-15", "🔴 负对照：**正常结束**（`kind=\"stop\"`、无 `error`）⇒ `endFailure` 为 `null`（否则会把成功报成失败）",
	eOk.endReason === "stop" && eOk.endFailure === null, { endReason: eOk.endReason, endFailure: eOk.endFailure });

console.log("\n═══════════════════════════════════════════════════════════");
console.log(`  PASS ${pass} / FAIL ${fail} / 总计 ${pass + fail}`);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log(`  IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
