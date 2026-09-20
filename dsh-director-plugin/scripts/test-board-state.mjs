#!/usr/bin/env node
/**
 * test-board-state.mjs —— 看板层（B2）纯函数离线测试（无需 Harness）
 *
 * ════════════════════════════════════════════════════════════
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | BS-1  | 九态→六档：COMPLETED→done | boardBucketOf 映射正确 |
 *  | BS-2  | WORKING/暂停态→running | 两个暂停态也算进行中 |
 *  | BS-3  | SUBMITTED→draft | 待办 |
 *  | BS-4  | FAILED→blocked | 红角标 |
 *  | BS-5  | CANCELED/REJECTED→aborted | 中止 |
 *  | BS-6  | 🔴 partial 优先于 COMPLETED | 部分完成不被绿勾盖住 |
 *  | BS-7  | 看板组：pinned 跨组抽出 | pinned 的进 pinned 段 |
 *  | BS-8  | boardGroupOf：draft→todo、running→running、其余→done | 四组归位 |
 *  | BS-9  | setPinned 单一写入点返回新对象、不改入参 | 原任务 pinned 不变 |
 *  | BS-10 | setField 只写白名单四字段 | 其余字段不被借道写 |
 *  | BS-11 | setField 归一类型（pinned→bool、summary→string） | 类型不漂移 |
 *  | BS-12 | createTask 保留看板字段 | pinned/summary/projectRoot/partial 不丢 |
 *  | BS-13 | boardView 四组齐全且 counts 对账 | total == 各组条数和 |
 *  | BS-14 | boardView 组内按 updatedAt 倒序 | 新的在前 |
 *  | BS-15 | 🔴 看板只读：boardView 不就地改入参 tasks | 原数组不变 |
 *  | BS-16 | boardView 输出带 sessionId/bucket/角标字段 | UI 直接消费 |
 *
 * 用法：
 *   node scripts/test-board-state.mjs            ｜ 全绿 exit 0
 *   BOARD_NEG=1 node scripts/test-board-state.mjs ｜ 植入缺陷（必须红 exit≠0）
 * 退出码：0 全绿 / 1 有失败 / 2 对账 INVALID
 */
import {
	STATE, BOARD_STATE, BOARD_GROUP,
	createTask, transition, boardBucketOf, boardGroupOf, boardBucketOfNode, boardVisualOfNode, boardTasksFromRows,
	setField, setPinned, boardView
} from "../src/logic/task-state.js";
import { tallyCheck } from "./_test-tally.mjs";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + name); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + "\n       " + JSON.stringify(detail)); }
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  看板层（B2）· 纯函数离线测试（logic/task-state.js 看板段）");
console.log("═══════════════════════════════════════════════════════════");

const mk = (over = {}) => createTask(Object.assign({ id: "t", sessionId: "sess-1", title: "任务", createdAt: 100, updatedAt: 100 }, over));

t("BS-1", "COMPLETED → done", boardBucketOf(mk({ state: STATE.COMPLETED })) === BOARD_STATE.DONE);
t("BS-2", "WORKING / 两个暂停态 → running",
	boardBucketOf(mk({ state: STATE.WORKING })) === BOARD_STATE.RUNNING
		&& boardBucketOf(mk({ state: STATE.INPUT_REQUIRED })) === BOARD_STATE.RUNNING
		&& boardBucketOf(mk({ state: STATE.AUTH_REQUIRED })) === BOARD_STATE.RUNNING);
t("BS-3", "SUBMITTED → draft（待办）", boardBucketOf(mk({ state: STATE.SUBMITTED })) === BOARD_STATE.DRAFT);
t("BS-4", "FAILED → blocked（红角标）", boardBucketOf(mk({ state: STATE.FAILED })) === BOARD_STATE.BLOCKED);
t("BS-5", "CANCELED / REJECTED → aborted",
	boardBucketOf(mk({ state: STATE.CANCELED })) === BOARD_STATE.ABORTED
		&& boardBucketOf(mk({ state: STATE.REJECTED })) === BOARD_STATE.ABORTED);
t("BS-6", "🔴 partial 优先于 COMPLETED（部分完成不被绿勾盖住）",
	boardBucketOf(mk({ state: STATE.COMPLETED, partial: true })) === BOARD_STATE.PARTIAL,
	{ bucket: boardBucketOf(mk({ state: STATE.COMPLETED, partial: true })) });

t("BS-7", "pinned 跨组抽出（任何档只要 pinned 就进 pinned 段）",
	boardGroupOf(mk({ state: STATE.DRAFT, pinned: true })) === BOARD_GROUP.PINNED
		&& boardGroupOf(mk({ state: STATE.COMPLETED, pinned: true })) === BOARD_GROUP.PINNED);
t("BS-8", "boardGroupOf：draft→todo、running→running、done/blocked→done",
	boardGroupOf(mk({ state: STATE.SUBMITTED })) === BOARD_GROUP.TODO
		&& boardGroupOf(mk({ state: STATE.WORKING })) === BOARD_GROUP.RUNNING
		&& boardGroupOf(mk({ state: STATE.COMPLETED })) === BOARD_GROUP.DONE
		&& boardGroupOf(mk({ state: STATE.FAILED })) === BOARD_GROUP.DONE,
	{ draft: boardGroupOf(mk({ state: STATE.SUBMITTED })) });

/* 单一写入点：不改入参 */
const before = mk({ id: "t1", pinned: false });
const after = setPinned(before, true);
t("BS-9", "🔴 setPinned 返回新对象、原任务 pinned 不变（单一写入点）",
	after !== before && after.pinned === true && before.pinned === false,
	{ before: before.pinned, after: after.pinned });

/* setField 白名单：借道写 state/title 必须无效 */
const base = mk({ id: "t2", state: STATE.SUBMITTED, title: "原标题" });
const patched = setField(base, { pinned: true, summary: "摘要", projectRoot: "D:\\proj", partial: true, state: STATE.WORKING, title: "篡改" });
t("BS-10", "🔴 setField 只写白名单四字段（借道写 state/title 无效）",
	patched.pinned === true && patched.summary === "摘要" && patched.projectRoot === "D:\\proj" && patched.partial === true
		&& patched.state === STATE.SUBMITTED && patched.title === "原标题",
	{ state: patched.state, title: patched.title });

const typed = setField(mk(), { pinned: 1, summary: null, projectRoot: undefined, partial: "yes" });
t("BS-11", "setField 归一类型（pinned→bool、summary→string、partial→bool）",
	typed.pinned === true && typed.summary === "" && typed.projectRoot === "" && typed.partial === true,
	typed);

const kept = mk({ id: "t3", pinned: true, summary: "保留", projectRoot: "D:\\p", partial: true });
t("BS-12", "createTask 保留看板四字段（归一不丢）",
	kept.pinned === true && kept.summary === "保留" && kept.projectRoot === "D:\\p" && kept.partial === true, kept);

/* boardView 对账 */
const tasks = [
	mk({ id: "a", state: STATE.WORKING, pinned: true, updatedAt: 300, sessionId: "sa" }),
	mk({ id: "b", state: STATE.SUBMITTED, updatedAt: 100, sessionId: "sb" }),
	mk({ id: "c", state: STATE.COMPLETED, updatedAt: 200, sessionId: "sc" }),
	mk({ id: "d", state: STATE.FAILED, updatedAt: 150, sessionId: "sd" })
];
const origJson = JSON.stringify(tasks.map((x) => x.id));
const view = boardView(tasks);
t("BS-13", "boardView 四组齐全且 counts 对账（total==pinned+running+todo+done）",
	view.pinned.length === 1 && view.running.length === 0 && view.todo.length === 1 && view.done.length === 2
		&& view.total === 4 && view.counts.pinned === 1,
	{ counts: view.counts, total: view.total });

t("BS-14", "boardView 组内按 updatedAt 倒序（done 段 c(200) 在前 d(150) 在后）",
	view.done.length === 2 && view.done[0].id === "c" && view.done[1].id === "d",
	view.done.map((x) => x.id));

t("BS-15", "🔴 boardView 只读：不就地改入参 tasks（看板不自拼、不改 store）",
	JSON.stringify(tasks.map((x) => x.id)) === origJson
		&& tasks[0].pinned === true && typeof tasks[0].bucket === "undefined",
	{ orig: origJson });

t("BS-16", "boardView 输出带 sessionId/bucket/pinned/角标字段（UI 直接消费）",
	view.done[0].sessionId === "sc" && (view.done[1].bucket === BOARD_STATE.BLOCKED)
		&& typeof view.done[0].pinned === "boolean" && typeof view.done[0].summary === "string",
	view.done[1]);

/* ── B4 导图节点 ↔ 看板同源（唯一翻译点） ── */
t("BS-17", "B4：dispatchState→看板六档翻译（running/done/failed/partial 各归其位）",
	boardBucketOfNode({ dispatchState: "running" }) === "running"
		&& boardBucketOfNode({ dispatchState: "done" }) === "done"
		&& boardBucketOfNode({ dispatchState: "failed" }) === "blocked"
		&& boardBucketOfNode({ dispatchState: "partial" }) === "partial",
	{ r: boardBucketOfNode({ dispatchState: "running" }) });
t("BS-18", "B4：blank/unknown/空 ⇒ 待办（draft）；aborted/canceled ⇒ aborted",
	boardBucketOfNode({ dispatchState: "blank" }) === "draft"
		&& boardBucketOfNode({ dispatchState: "unknown" }) === "draft"
		&& boardBucketOfNode({}) === "draft"
		&& boardBucketOfNode({ dispatchState: "canceled" }) === "aborted",
	{ blank: boardBucketOfNode({ dispatchState: "blank" }) });
t("BS-19", "B4：boardVisualOfNode 给 icon/color（pinned 盖成 ⭐ 黄）",
	boardVisualOfNode({ dispatchState: "failed" }).icon === "⚠"
		&& boardVisualOfNode({ dispatchState: "failed", pinned: true }).icon === "⭐"
		&& boardVisualOfNode({ dispatchState: "done" }).color === "#2e7d32",
	boardVisualOfNode({ dispatchState: "failed", pinned: true }));
/* ── B3 适配器：分支行 → 看板任务（主键挂会话 id） ── */
t("BS-20", "B3：boardTasksFromRows 主键挂 sessionId、四态归六档",
	(() => {
		const tasks = boardTasksFromRows([
			{ sessionId: "s1", state: "running", title: "R" },
			{ sessionId: "s2", state: "done", title: "D" },
			{ sessionId: "s3", state: "idle", title: "I" },
			{ sessionId: "s4", state: "review", title: "P" }
		]);
		const view = boardView(tasks);
		return tasks.length === 4
			&& tasks.every((x) => x.sessionId === x.id)
			&& view.total === 4
			&& view.running.length >= 1 && view.todo.length >= 1 && view.done.length >= 1;
	})(),
	{ sample: boardTasksFromRows([{ sessionId: "s1", state: "running" }]) });
/* 植入缺陷校准：BOARD_NEG=1 ⇒ 断言「FAILED 竟然不是 blocked」（与 BS-4 真值相反） */
if (process.env.BOARD_NEG === "1") {
	console.log("  [注入缺陷] BOARD_NEG=1 ⇒ 期望 FAILED 竟然不是 blocked（与 BS-4 真值相反）");
	t("BS-NEG", "🔴 校准·FAILED 竟然不是 blocked？",
		boardBucketOf(mk({ state: STATE.FAILED })) !== BOARD_STATE.BLOCKED);
}

const ran = pass + fail;
const MIN_ASSERTIONS = 20;
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "test-board-state（纯离线）" });
if (!tally.ok) process.exit(2);

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + ran);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
