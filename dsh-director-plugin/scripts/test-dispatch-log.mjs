#!/usr/bin/env node
/**
 * test-dispatch-log.mjs —— 「派发台账」**离线测试**（无需 Harness）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 台账是「我这次派出去了哪 8 条」的**唯一作用域来源** ——
 * 第 18 批真机闸门的跑程内判据（`dsh.director.split` 新增 key / 派发台账）
 * 全部建立在它的语义上。它读错，闸门就会把**上一批**当成这一批（真机已踩）。
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | DL-1 | `recordDispatch` 整体替换 + 初值 | items **恰为**传入条数；`state="unknown"`、`stateSource="尚未取样"`、`say=""`、`collect=null` |
 *  | DL-2 | 🔴 **不跨批次混** | 第二次派发 ⇒ items **只有新批**（不累加）—— 这是"跑程内作用域"的前提 |
 *  | DL-3 | 🔴 负对照：`sayReason` 初值可读 | 必须是**非空可读原因**（不许空串 —— 否则界面静默，纪律 19） |
 *  | DL-4 | `refreshStates` 写入状态 | 调用 `stateFn` 的次数 = **有 sessionId** 的条数 |
 *  | DL-5 | 🔴 `refreshStates` 的两种缺失**必须可分辨** | 无 sessionId ⇒ 「无会话 id（未建成）」；快照缺 ⇒ 「宿主快照里没有这条会话」 |
 *  | DL-6 | `patchDispatchItem` | 按 `sessionId` 命中；**不传的字段不动**（正负对照） |
 *  | DL-7 | `dispatchItemOf` | 命中返回同一条；未命中 / 空 id ⇒ `null` |
 *  | DL-8 | `clearDispatchLog` | `items` 空、`collect=null`、`at=0` |
 *  | DL-9 | 🔴 `applyDispatchLabels` 计数口径 | `applied` **只数 rows**（`byId` 再现**不重复计数** —— 否则闸门读数翻倍） |
 *  | DL-10 | 🔴 **只新增字段** | 宿主真值（`running`/`blank`/`parentSessionId`/`updatedAt`）与 `splitDim`/`titleOrigin` **一个不动** |
 *  | DL-11 | 🔴 字段名 | 用 `dispatchState`（**不是** `state`）—— 防与血缘状态同名不同义 |
 *  | DL-12 | `subscribeDispatch` | 变化时收到通知；**退订后不再收到**（正负对照） |
 *  | DL-13 | 🔴 订阅者抛错不打断 | 一个订阅者抛 ⇒ 其余订阅者**仍收到**（不许一个坏订阅把派发链打哑） |
 *
 * 用法：node scripts/test-dispatch-log.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

/* ── 桩：本模块自身只用内存，但 import 链可能摸 localStorage —— 一并装好 ── */
const store = new Map();
globalThis.localStorage = {
	getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
	setItem(k, v) { store.set(String(k), String(v)); },
	removeItem(k) { store.delete(String(k)); }
};

const {
	dispatchLog, subscribeDispatch, readDispatchLog, recordDispatch,
	refreshStates, patchDispatchItem, setDispatchCollect, dispatchItemOf,
	clearDispatchLog, applyDispatchLabels
} = await import("../src/store/dispatch-log.js");

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}` + (detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : ""));
}
const dims = ["world", "power", "plot", "chars", "prose", "polish", "review", "distill"];
const itemsOf = (n) => dims.slice(0, n).map((d, i) => ({
	dim: d, label: "「A" + (i + 1) + "」《墟海》", sessionId: "session-" + d, sentVia: "host-direct", sentOk: true
}));

console.log("═══════════════════════════════════════════════════════════");
console.log("  test-dispatch-log · 派发台账 / 状态刷新 / 导图标签覆盖");
console.log("═══════════════════════════════════════════════════════════");

/* ── recordDispatch ── */
console.log("\n【recordDispatch：记一次派发】");
const r1 = recordDispatch({ text: "帮我写一个小说《墟海》", name: "墟海", kind: "novel", items: itemsOf(8) });
t("DL-1", "整体替换 + 初值：items 恰 8 条；`state=\"unknown\"`、`stateSource=\"尚未取样\"`、`say=\"\"`、`collect=null`",
	r1.items.length === 8 && r1.items.every((x) => x.state === "unknown" && x.stateSource === "尚未取样" && x.say === "")
	&& r1.collect === null && r1.name === "墟海" && r1.kind === "novel",
	{ n: r1.items.length, first: r1.items[0] });
recordDispatch({ text: "第二批", name: "墟海", kind: "novel", items: itemsOf(3) });
t("DL-2", "🔴 **不跨批次混**：第二次派发后 items **只有新批 3 条**（不是 11 条）—— 跑程内作用域的前提",
	readDispatchLog().items.length === 3 && readDispatchLog().text === "第二批",
	{ n: readDispatchLog().items.length });
recordDispatch({ text: "t", name: "n", kind: "novel", items: itemsOf(8) });
t("DL-3", "🔴 负对照：`sayReason` 初值必须是**非空可读原因**（不许空串 ⇒ 界面静默）",
	readDispatchLog().items.every((x) => typeof x.sayReason === "string" && x.sayReason.trim().length > 0),
	readDispatchLog().items[0].sayReason);

/* ── refreshStates ── */
console.log("\n【refreshStates：用宿主快照刷状态】");
let stateCalls = 0;
const n1 = refreshStates((id) => { stateCalls++; return { id: id, running: true, projectionValues: { sessionStats: { turns: 1 } } }; },
	(raw, say) => ({ state: raw && raw.running ? "running" : "unknown", turns: 1, outputTokens: 0, title: "T" }));
t("DL-4", "写入状态：调用 `stateFn` 次数 **=** 有 sessionId 的条数（这里 8）",
	n1 === 8 && stateCalls === 8 && readDispatchLog().items.every((x) => x.state === "running" && x.stateSource === "宿主快照（sessions.list）"),
	{ n: n1, calls: stateCalls, s0: readDispatchLog().items[0].stateSource });
recordDispatch({ text: "t", name: "n", kind: "novel", items: [
	{ dim: "world", label: "L1", sessionId: "", sentOk: true },
	{ dim: "power", label: "L2", sessionId: "session-missing", sentOk: true },
	{ dim: "plot", label: "L3", sessionId: "session-ok", sentOk: true }
] });
refreshStates((id) => (id === "session-ok" ? { id: id, running: true } : null),
	() => ({ state: "running", turns: 1, outputTokens: 0, title: null }));
const miss = readDispatchLog().items.map((x) => x.stateSource);
t("DL-5", "🔴 两种缺失**必须可分辨**：无 sessionId ⇒「无会话 id（未建成）」；快照缺 ⇒「宿主快照里没有这条会话」",
	miss[0].indexOf("无会话 id") >= 0 && miss[1].indexOf("宿主快照里没有这条会话") >= 0 && miss[2].indexOf("宿主快照") >= 0,
	miss);

/* ── patchDispatchItem / dispatchItemOf ── */
console.log("\n【patchDispatchItem / dispatchItemOf】");
recordDispatch({ text: "t", name: "n", kind: "novel", items: itemsOf(8) });
const before6 = JSON.parse(JSON.stringify(readDispatchLog().items[0]));
const patched = patchDispatchItem("session-world", { say: "正文一", state: "done" });
t("DL-6", "按 `sessionId` 打补丁；**不传的字段不动**（正负对照：`label` 必须原样）",
	patched && patched.say === "正文一" && patched.state === "done" && patched.label === before6.label,
	{ after: patched, before: before6 });
t("DL-7", "`dispatchItemOf`：命中返回同一条；未命中 / 空 id ⇒ `null`",
	dispatchItemOf("session-world") === patched && dispatchItemOf("session-zz") === null && dispatchItemOf("") === null);
setDispatchCollect({ ok: true, done: 1, say: 8 });
t("DL-8", "`clearDispatchLog`：items 空、collect=null、at=0",
	clearDispatchLog().items.length === 0 && readDispatchLog().collect === null && readDispatchLog().at === 0,
	{ items: readDispatchLog().items.length });

/* ── applyDispatchLabels ── */
console.log("\n【applyDispatchLabels：覆盖到血缘树（只加显示字段）】");
recordDispatch({ text: "t", name: "n", kind: "novel", items: itemsOf(8) });
refreshStates((id) => ({ id: id, running: true }), () => ({ state: "running", turns: 2, outputTokens: 5, title: "T" }));
patchDispatchItem("session-world", { say: "正文一", sayReason: "" });
/* 真树形状：rows 与 byId 是**两个对象**（同一会话各一份） */
const makeTree = () => {
	const rows = itemsOf(8).map((it, i) => ({
		sessionId: it.sessionId, title: it.label, titleOrigin: "plugin:split", splitDim: it.dim,
		running: true, blank: false, updatedAt: 111 + i, parentSessionId: "parent-1"
	}));
	const byId = {};
	rows.forEach((r) => { byId[r.sessionId] = Object.assign({}, r); });
	/* 再加一条**不在台账里**的行（负对照：不许顺手给它打标） */
	rows.push({ sessionId: "session-other", title: "别人的", running: false, blank: true, updatedAt: 9, parentSessionId: "p9" });
	byId["session-other"] = Object.assign({}, rows[rows.length - 1]);
	return { rows: rows, byId: byId };
};
const tree = makeTree();
const snapshotHost = JSON.parse(JSON.stringify(tree.rows.map((r) => ({
	sessionId: r.sessionId, running: r.running, blank: r.blank, updatedAt: r.updatedAt,
	parentSessionId: r.parentSessionId, splitDim: r.splitDim, titleOrigin: r.titleOrigin
}))));
const ap = applyDispatchLabels(tree);
t("DL-9", "🔴 `applied` **只数 rows**（8，不是 16）—— byId 再现**不重复计数**",
	ap.applied === 8, { applied: ap.applied, states: ap.states });
const hostTouched = tree.rows.some((r, i) => {
	const b = snapshotHost[i];
	return b && (r.running !== b.running || r.blank !== b.blank || r.updatedAt !== b.updatedAt
		|| r.parentSessionId !== b.parentSessionId || r.splitDim !== b.splitDim || r.titleOrigin !== b.titleOrigin);
});
t("DL-10", "🔴 **只新增字段**：宿主真值与 `splitDim`/`titleOrigin` **一个不动**",
	!hostTouched, tree.rows.slice(0, 2));
const w = tree.rows[0];
t("DL-11", "🔴 字段名用 `dispatchState`（**不是** `state`）—— 防与血缘状态同名不同义；且 byId 侧**也**打了补丁",
	w.dispatchState === "running" && w.dispatchDim === "world" && w.dispatchId === "session-world"
	&& w.state === undefined && tree.byId["session-world"].dispatchState === "running",
	{ row: w, byId: tree.byId["session-world"] });
const other = tree.rows[8];
t("DL-11b", "🔴 **负对照**：不在台账里的行 `dispatchState` 为 `undefined`（不是「都打标」）",
	other && other.dispatchState === undefined, other);

/* ── subscribeDispatch ── */
console.log("\n【subscribeDispatch：变化通知】");
recordDispatch({ text: "t", name: "n", kind: "novel", items: itemsOf(3) });
let hits = 0;
const off = subscribeDispatch(() => { hits++; });
patchDispatchItem("session-world", { say: "x" });
const hitsBeforeOff = hits;
off();
patchDispatchItem("session-power", { say: "y" });
t("DL-12", "变化时收到通知；**退订后不再收到**（正负对照）",
	hitsBeforeOff >= 1 && hits === hitsBeforeOff, { hits: hits, beforeOff: hitsBeforeOff });
let a = 0, b = 0;
const offA = subscribeDispatch(() => { a++; throw new Error("订阅者 A 故意抛错"); });
const offB = subscribeDispatch(() => { b++; });
patchDispatchItem("session-plot", { say: "z" });
t("DL-13", "🔴 一个订阅者抛错**不打断**其余订阅者（派发链不许被一个坏订阅打哑）",
	a >= 1 && b >= 1, { a: a, b: b });
offA(); offB();

/* ── 🔴 第 23 批：简报进台账 ──────────────────────────────────────
 * 动机：`logic/director-dispatch.js` 的 `info` **本来就带 `brief`**（`briefOf(...)` 的返回值），
 *      但 `recordDispatch` 的白名单 map 没带 ⇒ 简报在进台账那一刻被丢。
 *      后果不是"少一个字段"：D8（需求整理）/ D9（项目把控）改的正是简报内容，
 *      改完**没有观测面** —— 真机闸门只能读到 `""`，看起来像功能没落地（本轮实测）。 */
console.log("\n【第 23 批 · 简报进台账】");
recordDispatch({ text: "t", name: "n", kind: "novel", items: [
	{ dim: "A1", label: "世界观", sessionId: "s-b1", brief: "【需求整理】\n要点：世界观\n需求原文：写《墟海》" },
	{ dim: "A2", label: "剧情", sessionId: "s-b2" }
] });
t("DL-14", "🔴 **简报保真进台账**：`item.brief` 含「【需求整理】」+「需求原文：」（D8/D9 的唯一观测面）",
	dispatchLog.items[0].brief.indexOf("【需求整理】") >= 0 && dispatchLog.items[0].brief.indexOf("需求原文：") >= 0,
	{ len: dispatchLog.items[0].brief.length, head: dispatchLog.items[0].brief.slice(0, 30) });
t("DL-14b", "🔴 **负对照**：未传 brief 的条目落空串（**不是 undefined、也不是上一条串进去**）",
	dispatchLog.items[1].brief === "" && typeof dispatchLog.items[1].brief === "string",
	{ v: dispatchLog.items[1].brief, t: typeof dispatchLog.items[1].brief });

console.log("\n═══════════════════════════════════════════════════════════");
console.log(`  PASS ${pass} / FAIL ${fail} / 总计 ${pass + fail}`);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log(`  IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
