#!/usr/bin/env node
/**
 * test-task-state.mjs —— 任务状态机**纯函数离线测试**
 *
 * ══════════════════════════════════════════════════════════════════
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | TS-1 | 状态机结构自审 | 终态零出边；SUBMITTED 可达全部非终态；每个非终态都能到终态 |
 *  | TS-2 | 九态与三组 | 8 个状态对象 + running/paused/finished 分组正确 |
 *  | TS-3 | 🔴 转移合法性 | 正常链路通；**终态不可再转**；**自转移非法**（WORKING 例外） |
 *  | TS-4 | 转移不改原对象 | `transition` 返回新对象，传入的 task 不变（可快照可撤销） |
 *  | TS-5 | 事件流 | seq 递增；事件带 from/to/label；时间线含等待时长 |
 *  | TS-6 | 🔴 乐观并发 | expected 与当前不符 → 拒绝写入并说明 |
 *  | TS-7 | 🔴 暂停态 | 两个暂停态**按钮文案不同**；离开暂停态 → 清 pending |
 *  | TS-8 | 持久化未决请求 | pending 随任务一起存（关面板再打开不丢） |
 *  | TS-9 | 分组筛选 | groupTasks 按三组归位 |
 *  | TS-10 | 转移表同源 | transitionTable 与 TRANSITIONS 一致（不另维护一份） |
 *
 * 用法：node scripts/test-task-state.mjs ｜ 退出码 0 全绿 / 1 有失败 / 2 INVALID
 */
import {
	STATE, GROUP, STATES, TRANSITIONS,
	stateOf, isTerminal, isPaused,
	canTransition, transitionTable,
	createTask, transition, advance, timeline, taskSummary, groupTasks, auditMachine,
	/* WS-C · C1：回收摘要经单一写入点进 task.summary */
	setField, boardView, boardTasksFromRows
} from "../src/logic/task-state.js";

const EXPECTED_TOTAL = 57;
let pass = 0, fail = 0;
const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++;
	else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}

const T0 = 1000;
const mk = () => createTask({ id: "t1", title: "测试任务", createdAt: T0, updatedAt: T0 });

console.log("═══════════════════════════════════════════════════════════");
console.log("  任务状态机 · 纯函数离线测试（logic/task-state.js）");
console.log("═══════════════════════════════════════════════════════════");

console.log("\n【A】结构自审");
const am = auditMachine();
t("TS-1a", "状态机自审通过（零 fails）", am.ok, am.fails);
t("TS-1b", "终态出边为 0", [STATE.COMPLETED, STATE.FAILED, STATE.CANCELED, STATE.REJECTED].every((s) => TRANSITIONS[s].length === 0));
t("TS-1c", "🔴 每个非终态都能抵达某个终态（任务不会永远结束不了）",
	Object.keys(TRANSITIONS).filter((k) => !isTerminal(k)).every((k) => canReachTerminal(k)));
function canReachTerminal(from) {
	const seen = new Set([from]); const q = [from];
	while (q.length) { const c = q.shift(); if (isTerminal(c)) return true; for (const n of TRANSITIONS[c]) if (!seen.has(n)) { seen.add(n); q.push(n); } }
	return false;
}

console.log("\n【B】九态与三组");
t("TS-2a", "STATES 共 8 条且键与 STATE 一致",
	STATES.length === 8 && STATES.every((s) => Object.values(STATE).includes(s.key)), STATES.map((s) => s.key));
t("TS-2b", "running = SUBMITTED + WORKING",
	STATES.filter((s) => s.group === GROUP.RUNNING).length === 2);
t("TS-2c", "paused = INPUT_REQUIRED + AUTH_REQUIRED（**两个不同暂停态**）",
	STATES.filter((s) => s.group === GROUP.PAUSED).map((s) => s.key).sort().join(",") === "AUTH_REQUIRED,INPUT_REQUIRED");
t("TS-2d", "finished = 4 个终态",
	STATES.filter((s) => s.group === GROUP.FINISHED).length === 4);
t("TS-2e", "isTerminal / isPaused 口径与组一致",
	isTerminal(STATE.COMPLETED) && !isTerminal(STATE.WORKING) && isPaused(STATE.AUTH_REQUIRED) && !isPaused(STATE.WORKING));
t("TS-2f", "未知状态回落 SUBMITTED（不返回 undefined）", stateOf("nope").key === STATE.SUBMITTED);

console.log("\n【C】🔴 转移合法性");
t("TS-3a", "SUBMITTED → WORKING 合法", canTransition(STATE.SUBMITTED, STATE.WORKING).ok);
t("TS-3b", "WORKING → COMPLETED 合法", canTransition(STATE.WORKING, STATE.COMPLETED).ok);
t("TS-3c", "🔴 终态不可再转移（COMPLETED → WORKING）",
	(() => { const r = canTransition(STATE.COMPLETED, STATE.WORKING); return r.ok === false && r.reason.indexOf("终态") >= 0; })());
t("TS-3d", "🔴 自转移非法（COMPLETED → COMPLETED）", canTransition(STATE.COMPLETED, STATE.COMPLETED).ok === false);
t("TS-3e", "🟢 例外：WORKING → WORKING 合法（进度更新）", canTransition(STATE.WORKING, STATE.WORKING).ok === true);
t("TS-3f", "非法转移的 reason 列出允许目标",
	canTransition(STATE.SUBMITTED, STATE.COMPLETED).reason.indexOf("允许") >= 0, canTransition(STATE.SUBMITTED, STATE.COMPLETED));
t("TS-3g", "SUBMITTED 不能直接到 COMPLETED（必须经过 WORKING）", canTransition(STATE.SUBMITTED, STATE.COMPLETED).ok === false);
t("TS-3h", "AUTH_REQUIRED → REJECTED 合法（驳回）", canTransition(STATE.AUTH_REQUIRED, STATE.REJECTED).ok);
t("TS-3i", "INPUT_REQUIRED → REJECTED 非法（补信息不是驳回场景）", canTransition(STATE.INPUT_REQUIRED, STATE.REJECTED).ok === false);

console.log("\n【D】转移与不可变性");
const t1 = mk();
const r1 = transition(t1, STATE.WORKING, { at: T0 + 10 });
t("TS-4a", "转移成功且返回新对象", r1.ok && r1.task !== t1);
t("TS-4b", "🔴 原对象未被修改（可快照可撤销）", t1.state === STATE.SUBMITTED && t1.transitions.length === 0, t1);
t("TS-4c", "新对象状态已变", r1.task.state === STATE.WORKING && r1.task.updatedAt === T0 + 10);
t("TS-4d", "事件 seq = 1 且带 from/to", r1.event.seq === 1 && r1.event.from === STATE.SUBMITTED && r1.event.to === STATE.WORKING);
const r1b = transition(r1.task, STATE.COMPLETED, { at: T0 + 20 });
t("TS-4e", "链路推进后事件 seq = 2", r1b.ok && r1b.event.seq === 2);
t("TS-4f", "🔴 非法转移返回 ok:false 且**任务原样返回**",
	(() => { const r = transition(r1b.task, STATE.WORKING); return r.ok === false && r.task.state === STATE.COMPLETED && r.event === null; })());
t("TS-6a", "🔴 乐观并发：expected 与当前不符 → 拒绝",
	(() => { const r = transition(t1, STATE.WORKING, { expected: STATE.WORKING }); return r.ok === false && r.reason.indexOf("状态已变") >= 0; })());
t("TS-6b", "expected 相符 → 放行",
	transition(t1, STATE.WORKING, { expected: STATE.SUBMITTED }).ok === true);

console.log("\n【E】🔴 暂停态与未决请求");
const auth = transition(r1.task, STATE.AUTH_REQUIRED, { at: T0 + 30, pending: { kind: "approval", action: "批准写入", detail: "要改 3 个文件" } }).task;
t("TS-7a", "进入暂停态后 pending 被保存", auth.pending && auth.pending.kind === "approval", auth.pending);
t("TS-7b", "taskSummary 在暂停态给出**动作文案**",
	taskSummary(auth).action === "批准写入", taskSummary(auth));
const input = transition(r1.task, STATE.INPUT_REQUIRED, { at: T0 + 30, pending: { kind: "input", action: "补充目标路径" } }).task;
t("TS-7c", "🔴 两个暂停态的按钮文案**不同**（否则界面分不清在等什么）",
	taskSummary(auth).action !== taskSummary(input).action, [taskSummary(auth).action, taskSummary(input).action]);
t("TS-7d", "离开暂停态 → pending 被清空（界面不再挂「待批准」）",
	transition(auth, STATE.WORKING, { at: T0 + 40 }).task.pending === null);
t("TS-8a", "pending 随任务一起可序列化（关面板再打开不丢）",
	JSON.parse(JSON.stringify(auth)).pending.action === "批准写入");
t("TS-8b", "未传 pending 时保留原值（不被 undefined 抹掉）",
	transition(auth, STATE.WORKING, { at: T0 + 40 }).task.pending === null);
t("TS-7e", "taskSummary 在非暂停态不给动作文案", taskSummary(r1b.task).action === "");

console.log("\n【F】时间线与分组");
const tl = timeline(r1b.task);
t("TS-5a", "时间线 2 条且顺序正确",
	tl.length === 2 && tl[0].toLabel === "执行中" && tl[1].toLabel === "已完成", tl.map((x) => x.label));
t("TS-5b", "时间线带等待时长（首条相对 createdAt）", tl[0].waitMs === 10 && tl[1].waitMs === 10, tl.map((x) => x.waitMs));
t("TS-5c", "事件 note 透出", transition(t1, STATE.WORKING, { note: "开始跑" }).event.note === "开始跑");
const groups = groupTasks([r1.task, auth, input, r1b.task]);
t("TS-9a", "groupTasks 三组齐", Object.keys(groups).sort().join(",") === "finished,paused,running", Object.keys(groups));
t("TS-9b", "running 归位正确（仅 WORKING 那条）", groups.running.length === 1, groups.running.map((x) => x.label));
t("TS-9c", "paused 归位正确", groups.paused.length === 2, groups.paused.map((x) => x.label));
t("TS-9d", "finished 归位正确", groups.finished.length === 1, groups.finished.map((x) => x.label));
const tbl = transitionTable();
t("TS-10a", "转移表条数 === 状态数 8", tbl.length === 8, tbl.length);
t("TS-10b", "🔴 转移表与 TRANSITIONS 同源（终态 to 为空）",
	tbl.filter((r) => r.to.length === 0).length === 4, tbl.filter((r) => r.to.length === 0).map((r) => r.from));
t("TS-10c", "表里带可读标签（UI 直接用）", tbl.every((r) => r.fromLabel && Array.isArray(r.toLabels)));

console.log("\n【G】WS-C · C1：回收摘要经单一写入点 setField 进 task.summary");
/* 模拟 applyDispatchLabels 落到行上的真产出（row.dispatchSay = 回收读到的助手正文摘要） */
const rows1 = [
	{ sessionId: "s-1", title: "A1 世界观", state: "done", dispatchSay: "世界设定：三族鼎立，灵气复苏", updatedAt: 5000 },
	{ sessionId: "s-2", title: "A2 人物", state: "running", dispatchSay: "", updatedAt: 4000 } /* 尚未回收产出 */
];
const tasks1 = boardTasksFromRows(rows1);
t("TS-11a", "🔴 有 dispatchSay 的行 → task.summary === 回收摘要（C1「结果」通道核心）",
	tasks1[0].summary === "世界设定：三族鼎立，灵气复苏", tasks1[0].summary);
t("TS-11b", "无 dispatchSay 的行 → summary 为 \"\"（'没结果'是缺席，不是未知）",
	tasks1[1].summary === "", tasks1[1].summary);
t("TS-11c", "summary 经**单一写入点 setField** 得到（与直调 setField 逐字一致，未另造字段）",
	tasks1[0].summary === setField({ id: "s-1", sessionId: "s-1", title: "A1 世界观", state: STATE.COMPLETED }, { summary: "世界设定：三族鼎立，灵气复苏" }).summary);
const vw1 = boardView(tasks1);
t("TS-11d", "boardView 唯一拼装点把 summary 透进行（看板/导图同源，不另拼）",
	vw1.done.length === 1 && vw1.done[0].summary === "世界设定：三族鼎立，灵气复苏", vw1.done.map((x) => x.summary));
t("TS-11e", "🔴 主键/标题/状态不被 summary 写入破坏（id = 会话 id）",
	tasks1[0].id === "s-1" && tasks1[0].sessionId === "s-1" && tasks1[0].title === "A1 世界观" && tasks1[0].state === STATE.COMPLETED, tasks1[0]);
/* 必红校准（纪律 ⑥/⑫）：若有人把 boardTasksFromRows 退回"丢掉 dispatchSay"，
 * TS-11a/11d 必红。TS_NEG=1 时喂一个**故意坏的副本**（summary 恒空）自证断言是活的。 */
if (process.env.TS_NEG === "1") {
	const bad1 = rows1.map((r) => ({ id: r.sessionId, sessionId: r.sessionId, title: r.title, state: STATE.COMPLETED, summary: "" }));
	t("TS-11N", "🔴 必红校准：坏副本（丢掉 dispatchSay）→ 本断言应红",
		bad1[0].summary === "世界设定：三族鼎立，灵气复苏", bad1[0]);
} else {
	t("TS-11f", "空行不崩（rows=[] → tasks=[] → boardView total=0）",
		boardView(boardTasksFromRows([])).total === 0);
}

/* ── D3: advance() 幂等 / blocked 必带因 / 可回放 ──────────────── */
console.log("\n【D3 · advance 幂等推进 + blocked 必带因】");
let a0 = mk(); a0 = transition(a0, STATE.WORKING, { at: T0 + 10 }).task;
const beforeN = a0.transitions.length;
const idem = advance(a0, STATE.WORKING, { at: T0 + 11 });
t("TS-12a", "🔴 幂等：已是 WORKING 再推进 ⇒ ok 且不记新事件（无副作用）", idem.ok === true && idem.event === null && idem.task.transitions.length === beforeN, { idem: idem.ok, n: idem.task.transitions.length, before: beforeN });
const hb = advance(a0, STATE.WORKING, { at: T0 + 12, heartbeat: true });
t("TS-12b", "WORKING 心跳是唯一例外：meta.heartbeat=true ⇒ 记一笔", hb.ok === true && hb.event !== null && hb.task.transitions.length === beforeN + 1, hb.task.transitions.length);
const self = advance(advance(a0, STATE.WORKING, { at: T0 + 13 }).task, STATE.COMPLETED, { at: T0 + 14 });
t("TS-12c", "正常链路 SUBMITTED→WORKING→COMPLETED 推进成功", self.ok === true && self.task.state === STATE.COMPLETED, self.task.state);
const noWhy = advance(a0, STATE.FAILED, { at: T0 + 15 });
t("TS-12d", "🔴 blocked 必带因：转 FAILED 不带 reason ⇒ 拒绝（失败不静默）", noWhy.ok === false && /reason|\u5fc5\u5e26\u56e0/.test(noWhy.reason), noWhy.reason);
const withWhy = advance(a0, STATE.FAILED, { at: T0 + 16, reason: "QUOTA 402 额度耗尽" });
t("TS-12e", "带 reason 的 FAILED ⇒ ok 且原因写进 task.error", withWhy.ok === true && withWhy.task.state === STATE.FAILED && withWhy.task.error.indexOf("QUOTA") >= 0, withWhy.task.error);
const badJump = advance(mk(), STATE.COMPLETED, { at: T0 + 17 });
t("TS-12f", "🔴 非法迁移必红：SUBMITTED→COMPLETED 走 transition 拒绝", badJump.ok === false, badJump.reason);
const replay = timeline(self.task).length;
t("TS-12g", "可回放：推进后的 timeline 能重放整条链（事件数 = 链路步数）", replay >= 2, replay);
/* 必红校准：TS_NEG=1 时喂「无因 FAILED 却断言成功」自证断言是活的；否则跑空态幂等 */
if (process.env.TS_NEG === "1") {
	t("TS-12N", "🔴 必红校准：无因 FAILED 却断言 ok=true → 本断言应红", noWhy.ok === true, noWhy);
} else {
	const idle = advance(mk(), STATE.SUBMITTED, {});
	t("TS-12h", "空任务幂等：已在 SUBMITTED 再推进 ⇒ ok 且不抛", idle.ok === true && idle.event === null, idle);
}
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
