#!/usr/bin/env node
/**
 * test-split-index.mjs —— 「分流标签索引」**离线测试**（无需 Harness）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 *  第 16 批需求：「自动分到不同的对话分支 然后思维导图应该能看出来」——
 *  宿主 `sessions.create()` 建的空白会话在导图上**标题相同**（宿主无 rename），
 *  故显示名由本模块补。这里的断言就是"补得对不对"。
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | SI-1 | 写入 / 读回 | 条数与内容一致；落盘形状是 `{v:1, items}` |
 *  | SI-2 | 内存缓存 | 二次读不再打 localStorage（**可分辨**：改底层 raw 后仍读缓存） |
 *  | SI-3 | 🔴 无 label 的条目 | **丢弃**（负对照：留空壳 ⇒ 导图多一个无名节点） |
 *  | SI-4 | 🔴 坏 JSON | 不抛，回落空表（含**正对照** SI-4c：同通道喂合法数据必须读得回 ——
 *  |      |            | 否则"空"可能只是"这个通道压根读不到"，属平凡真） |
 *  | SI-5 | 🔴 单条脏记录 | **只丢那一条**，其他条完好（正负对照） |
 *  | SI-6 | 容量裁剪 | 超过 `SPLIT_MAX` 时保 `at` 最新的 |
 *  | SI-7 | `forgetSplits` | 返回 `{removed, missed}` 且**真的删了** |
 *  | SI-8 | `clearSplitIndex` | 返回被清条数，且落盘为空 |
 *  | SI-9 | 🔴 `applySplitLabels` 计数口径 | `applied` **只数 rows** —— 同一会话在 `byId` 里再现**不重复计数** |
 *  | SI-10 | 🔴 只改显示字段 | 宿主真值（running / blank / parentSessionId / updatedAt）**一个不动** |
 *  | SI-11 | 覆盖可追 | 被覆盖的行带 `titleOrigin = "plugin:split"` |
 *  | SI-12 | 🔴 无索引的会话 | 标题**原样**（负对照：不许"顺手都改一遍"） |
 *  | SI-13 | `dims` | 去重且稳定序（同输入必同输出） |
 *  | SI-14 | 空索引 | `applied = 0`，且不抛 |
 *
 * 用法：node scripts/test-split-index.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

/* ── 伪造 localStorage（必须在**第一次读写之前**装好）────────────────────── */
const store = new Map();
let getCount = 0, setCount = 0;
globalThis.localStorage = {
	getItem(k) { getCount += 1; return store.has(String(k)) ? store.get(String(k)) : null; },
	setItem(k, v) { setCount += 1; store.set(String(k), String(v)); },
	removeItem(k) { store.delete(String(k)); }
};

const {
	SPLIT_INDEX_KEY, SPLIT_MAX, SPLIT_TITLE_ORIGIN,
	readSplitIndex, writeSplitIndex, recordSplits, forgetSplits, clearSplitIndex,
	splitEntryOf, applySplitLabels
} = await import("../src/store/split-index.js");

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}
const raw = () => store.get(SPLIT_INDEX_KEY);

console.log("═══════════════════════════════════════════════════════════");
console.log("  分流标签索引 · 离线测试（store/split-index.js）");
console.log("═══════════════════════════════════════════════════════════");

/* ── SI-1 写入 / 读回 ─────────────────────────────────────────────────── */
const n1 = recordSplits([
	{ sessionId: "s-a1", dim: "world", label: "「A1 世界观」《X》", name: "X" },
	{ sessionId: "s-a2", dim: "power", label: "「A2 力量体系」《X》", name: "X" }
]);
t("SI-1a", "recordSplits 返回真实写入条数（= 2）", n1 === 2, n1);
const idx1 = readSplitIndex();
t("SI-1b", "读回条数正确", Object.keys(idx1).length === 2, Object.keys(idx1));
t("SI-1c", "字段完整（dim / label / name / at 都在）",
	idx1["s-a1"] && idx1["s-a1"].dim === "world" && idx1["s-a1"].label === "「A1 世界观」《X》" && idx1["s-a1"].name === "X" && idx1["s-a1"].at > 0,
	idx1["s-a1"]);
const parsed = JSON.parse(raw());
t("SI-1d", "落盘形状 = {v:1, items}", parsed && parsed.v === 1 && parsed.items && typeof parsed.items === "object", Object.keys(parsed || {}));
t("SI-1e", "键名 = dsh.director.split（冻结命名空间内，R5 允许新增）", SPLIT_INDEX_KEY === "dsh.director.split", SPLIT_INDEX_KEY);
t("SI-1f", "splitEntryOf 取单条", splitEntryOf("s-a2") && splitEntryOf("s-a2").dim === "power", splitEntryOf("s-a2"));
t("SI-1g", "splitEntryOf 未知 id ⇒ null", splitEntryOf("nope") === null);

/* ── SI-2 内存缓存 ────────────────────────────────────────────────────── */
/* 判据：缓存存在 ⇒ 二次读**不再**打 localStorage 的 getItem。
 * 🔴 只断言"值相等"是**平凡真**（缓存坏了值也可能碰巧一样）⇒ 必须用"调用次数没涨"。 */
const before = getCount;
readSplitIndex(); readSplitIndex();
t("SI-2a", "二次读走内存缓存（getItem 调用次数不增）", getCount === before, { before, after: getCount });

/* ── SI-3 / SI-5 脏数据（含负对照）────────────────────────────────────── */
const n3 = recordSplits([
	{ sessionId: "s-ok", dim: "plot", label: "「A3 剧情」《X》" },
	{ sessionId: "s-bad", dim: "chars", label: "   " },
	{ sessionId: "", dim: "prose", label: "「A5 正文」《X》" },
	{ sessionId: "s-null", dim: "polish", label: null }
]);
t("SI-3a", "🔴 label 全空白 ⇒ 不计入（返回 1）", n3 === 1, n3);
t("SI-3b", "🔴 无 sessionId 的条目 ⇒ 丢弃", !Object.prototype.hasOwnProperty.call(readSplitIndex(), ""), Object.keys(readSplitIndex()));
t("SI-3c", "🔴 label=null ⇒ 丢弃（不写成 \"null\" 字符串）",
	!Object.keys(readSplitIndex()).some((k) => readSplitIndex()[k].label === "null"), readSplitIndex());
t("SI-5a", "合法的那一条**在**（单条脏记录不许连坐）", Boolean(readSplitIndex()["s-ok"]), Object.keys(readSplitIndex()));

/* ── 脏数据用例需要一个**全新模块实例** ──────────────────────────────────
 * 🔴 为什么不能在本实例里测（自查发现的**平凡真**）：
 *    `writeSplitIndex({})` 会把内存缓存置成 `{}`，而 `readSplitIndex()` 是"有缓存即返回"
 *    ⇒ 之后再往 localStorage 塞脏数据也**读不到**（根本没走存储）⇒ 断言"坏 JSON ⇒ 空表"
 *    会**因为缓存是空而通过**，与"坏 JSON 处理对不对"毫无关系。
 *  ⇒ 用查询串打破 ESM 模块缓存，拿一个**没有缓存**的新实例来读。 */
let freshSeq = 0;
async function freshModule() {
	freshSeq += 1;
	return import("../src/store/split-index.js?fresh=" + freshSeq);
}

/* ① 负向：坏 JSON ⇒ 空表且不抛 */
store.set(SPLIT_INDEX_KEY, "{ 坏数据 [");
const mBad = await freshModule();
let threw = false, idxBad = null;
try { idxBad = mBad.readSplitIndex(); } catch (e) { threw = true; }
t("SI-4a", "🔴 坏 JSON 不抛", threw === false);
t("SI-4b", "🔴 坏 JSON ⇒ 空表（不是 undefined，也不是半截对象）",
	idxBad && typeof idxBad === "object" && Object.keys(idxBad).length === 0, idxBad);

/* ② **正对照**：同样走 freshModule 通道，喂**合法**数据必须读得回来 ——
 *    否则 SI-4b 的"空"可能只是"这个通道压根读不到东西"（平凡真）。 */
store.set(SPLIT_INDEX_KEY, JSON.stringify({ v: 1, items: { ok1: { dim: "d", label: "合法", at: 1 } } }));
const mGood = await freshModule();
const idxGood = mGood.readSplitIndex();
t("SI-4c", "🔴 正对照：同通道喂合法数据 ⇒ 读得回 1 条（证明 SI-4b 不是平凡真）",
	Object.keys(idxGood).join(",") === "ok1", Object.keys(idxGood));

/* ③ 一条字段类型不对的记录 ⇒ 只丢那一条 */
store.set(SPLIT_INDEX_KEY, JSON.stringify({ v: 1, items: { good: { label: "好" }, bad: 42, bad2: { label: "" } } }));
const mMix = await freshModule();
const idxMix = mMix.readSplitIndex();
t("SI-5b", "🔴 只有 good 留下（bad=数字 / bad2=空 label 各自被丢）",
	Object.keys(idxMix).join(",") === "good", Object.keys(idxMix));

/* ── SI-6 容量裁剪 ────────────────────────────────────────────────────── */
writeSplitIndex({});
const many = {};
for (let i = 0; i < SPLIT_MAX + 20; i++) {
	many["k" + i] = { dim: "d", label: "L" + i, name: "", at: 1000 + i };
}
const keptN = writeSplitIndex(many);
t("SI-6a", "超过上限时裁到 SPLIT_MAX", keptN === SPLIT_MAX, { keptN, SPLIT_MAX });
t("SI-6b", "保的是 at **最新**的那批（k2019 在、k0 不在）",
	Boolean(readSplitIndex()["k" + (SPLIT_MAX + 19)]) && !readSplitIndex()["k0"], Object.keys(readSplitIndex()).slice(0, 3));

/* ── SI-7 forgetSplits ────────────────────────────────────────────────── */
writeSplitIndex({ a: { label: "A", at: 1 }, b: { label: "B", at: 2 }, c: { label: "C", at: 3 } });
const fg = forgetSplits(["a", "zzz", "c"]);
t("SI-7a", "removed / missed 分别计数（2 / 1）", fg.removed === 2 && fg.missed === 1, fg);
t("SI-7b", "**真的删了**（只剩 b）", Object.keys(readSplitIndex()).join(",") === "b", Object.keys(readSplitIndex()));

/* ── SI-8 clearSplitIndex ─────────────────────────────────────────────── */
const cleared = clearSplitIndex();
t("SI-8a", "返回被清掉的条数（= 1）", cleared === 1, cleared);
t("SI-8b", "落盘为空表", Object.keys(readSplitIndex()).length === 0);

/* ── SI-9 ~ SI-13 applySplitLabels ────────────────────────────────────── */
const INDEX = {
	"s-a1": { dim: "world", label: "「A1 世界观」《X》", name: "X", at: 1 },
	"s-a2": { dim: "power", label: "「A2 力量体系」《X》", name: "X", at: 2 }
};
function makeTree() {
	const sA1 = { sessionId: "s-a1", title: "新对话", running: true, blank: false, updatedAt: 12345, parentSessionId: "host-1" };
	const sA2 = { sessionId: "s-a2", title: "新对话", running: undefined, blank: true, updatedAt: 999 };
	const sX = { sessionId: "s-other", title: "别的对话", running: false };
	return {
		rows: [
			{ sessionId: "s-a1", title: "新对话", running: true, blank: false, updatedAt: 12345, parentSessionId: "host-1" },
			{ sessionId: "s-a2", title: "新对话", running: undefined, blank: true, updatedAt: 999 },
			{ sessionId: "s-other", title: "别的对话", running: false }
		],
		byId: { "s-a1": sA1, "s-a2": sA2, "s-other": sX }
	};
}
const tree = makeTree();
const res = applySplitLabels(tree, INDEX);
t("SI-9a", "🔴 applied **只数 rows**（= 2，不把 byId 那份重复算成 4）", res.applied === 2, res);
t("SI-9b", "rows 里两条标题被覆盖",
	tree.rows[0].title === "「A1 世界观」《X》" && tree.rows[1].title === "「A2 力量体系」《X》",
	tree.rows.map((r) => r.title));
t("SI-9c", "byId 里同一会话**也**被覆盖（两个对象都要改，否则两处显示不一致）",
	tree.byId["s-a1"].title === "「A1 世界观」《X》", tree.byId["s-a1"].title);
t("SI-10a", "🔴 宿主真值 running 未动",
	tree.rows[0].running === true && tree.byId["s-other"].running === false, tree.rows.map((r) => r.running));
t("SI-10b", "🔴 宿主真值 blank / updatedAt / parentSessionId 未动",
	tree.rows[1].blank === true && tree.rows[0].updatedAt === 12345 && tree.rows[0].parentSessionId === "host-1",
	tree.rows.map((r) => [r.blank, r.updatedAt, r.parentSessionId]));
t("SI-10c", "被覆盖行的 running **不该被写坏**（undefined 仍是 undefined，不写成 false）",
	tree.rows[1].running === undefined, tree.rows[1].running);
t("SI-11a", "被覆盖行带 titleOrigin 标记（覆盖可追）",
	tree.rows[0].titleOrigin === SPLIT_TITLE_ORIGIN, tree.rows[0].titleOrigin);
t("SI-11b", "被覆盖行带 splitDim", tree.rows[0].splitDim === "world", tree.rows[0].splitDim);
t("SI-12a", "🔴 无索引的会话标题**原样**（负对照）",
	tree.rows[2].title === "别的对话" && tree.rows[2].titleOrigin === undefined, tree.rows[2]);
t("SI-13a", "dims 去重（同维度两条只出现一次）",
	applySplitLabels(makeTree(), { x: { dim: "world", label: "L1" }, y: { dim: "world", label: "L2" } }).dims.join(",") !== "world,world",
	applySplitLabels(makeTree(), { x: { dim: "world", label: "L1" }, y: { dim: "world", label: "L2" } }).dims);
t("SI-13b", "dims 稳定序（同输入必同输出）",
	(() => { const a1 = applySplitLabels(makeTree(), INDEX).dims.join(","); const b1 = applySplitLabels(makeTree(), INDEX).dims.join(","); return a1 === b1; })(),
	applySplitLabels(makeTree(), INDEX).dims);
const emptyRes = applySplitLabels(makeTree(), {});
t("SI-14a", "空索引 ⇒ applied 0 且无 dims", emptyRes.applied === 0 && emptyRes.dims.length === 0, emptyRes);
let threw2 = false;
try { applySplitLabels(null, INDEX); } catch (e) { threw2 = true; }
t("SI-14b", "tree 为 null 不抛（返回 applied 0）", threw2 === false);
const noRows = applySplitLabels({ byId: { "s-a1": { sessionId: "s-a1", title: "T" } } }, INDEX);
t("SI-14c", "只有 byId 没有 rows ⇒ applied 0（计数口径仍是 rows）但 byId 仍被覆盖",
	noRows.applied === 0, noRows);

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  通过 ${pass} / 失败 ${fail}`);
console.log(`  IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
