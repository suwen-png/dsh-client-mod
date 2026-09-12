#!/usr/bin/env node
/**
 * test-branch-focus.mjs —— 分支链路聚焦**纯函数离线测试**（无需 Harness / 浏览器）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码 —— 用户要求）
 * ──────────────────────────────────────────────────────────────────
 *  用户原话：「对话会存在分支。我点击对话那么只默认显示这个分支的链路，
 *             然后可以选是否包含上一层，如果有下一层可以往下一层走。
 *             比如对话 1,2,3,4,5 每个对话分支 a,b,c；
 *             我在 1 的 a 点击思维导图那么就是进入整个 1 的上下游分支；
 *             然后点击上一层才是 1,2,3,4,5 全显示。」
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | BF-1 | 点分支 a（父为 1）默认 | 可见 = `{1, a}` —— **含祖先链**（"整个 1 的上下游"） |
 *  | BF-2 | 再开「含上一层」 | 可见 **必须多出 `2,3,4,5`**（用户点名的四个） |
 *  | BF-3 | 点根 1 默认 | 可见 = `{1, 1a, 1b, 1c}`（该链全部分支） |
 *  | BF-4 | 不可用入参 | `applied=false` 且**返回全量**（不是返回空 —— 空会让画布变白） |
 *  | BF-5 | 兄弟/后代边界 | 兄弟不进"下游"；后代进 |
 *  | BF-6 | 环 / 孤儿父 | 不死循环、不报错 |
 *  | BF-7 | 行序 | 聚焦结果保持与原 rows 同序（否则连线会错位） |
 *
 * 真机 e2e（verify-mindmap.mjs）负责证明"接线与命中"；逻辑正确性在这里兜住。
 *
 * 用法：node scripts/test-branch-focus.mjs ｜ 退出码 0 全绿 / 1 有失败
 */
import { buildBranchTree } from "../src/logic/branch-tree.js";
import {
	indexById, upstreamChain, downstreamIds, siblingIds, upstreamPanorama, focusRows, hasDownstream
} from "../src/logic/branch-focus.js";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => [...a].sort();

console.log("═══════════════════════════════════════════════════════════");
console.log("  分支链路聚焦 · 纯函数离线测试（logic/branch-focus.js）");
console.log("═══════════════════════════════════════════════════════════");

/* ── 样本：**逐字复现用户例子** —— 5 个根对话，每个 3 个分支；另加一条二级分支测"下钻" ── */
const sums = [];
for (const n of ["1", "2", "3", "4", "5"]) {
	sums.push({ sessionId: n, title: "对话 " + n });
	for (const b of ["a", "b", "c"]) sums.push({ sessionId: n + b, title: n + "-" + b, parentSessionId: n });
}
sums.push({ sessionId: "1a1", title: "1-a-1", parentSessionId: "1a" }); // 深一层
const { rows } = buildBranchTree(sums, { currentId: "1a" });

console.log("\n【A】样本与结构");
t("BF-0", "样本构建：5 根 + 15 分支 + 1 二级 = 21 行", rows.length === 21, { got: rows.length });
t("BF-0b", "索引表条目数 = 行数", indexById(rows).size === rows.length);

console.log("\n【B】三种集合的语义（下游 / 祖先 / 兄弟）");
t("BF-1a", "下游含自身与全部后代", eq(sorted(downstreamIds(rows, "1")), sorted(["1", "1a", "1b", "1c", "1a1"])),
	[...downstreamIds(rows, "1")]);
t("BF-1b", "🔴 下游**不含兄弟**（2 不在 1 的下游）", !downstreamIds(rows, "1").has("2"));
t("BF-1c", "祖先链从根到直接父（不含自身）", eq(upstreamChain(rows, "1a1").map((r) => r.sessionId), ["1", "1a"]),
	upstreamChain(rows, "1a1").map((r) => r.sessionId));
t("BF-1d", "根节点的祖先链为空", upstreamChain(rows, "1").length === 0);
t("BF-1e", "同级 = 同父的其他会话", eq(sorted(siblingIds(rows, "1a")), ["1b", "1c"]), siblingIds(rows, "1a"));
t("BF-1f", "根的同级 = 其他根", eq(sorted(siblingIds(rows, "1")), ["2", "3", "4", "5"]), siblingIds(rows, "1"));
t("BF-1g", "可下钻判定：1 有子 ✓ / 1a 有子 ✓ / 1b 无子 ✗",
	hasDownstream(rows, "1") === true && hasDownstream(rows, "1a") === true && hasDownstream(rows, "1b") === false);

console.log("\n【C】聚焦 —— 用户原话逐字复现（本轮最关键的两条）");
const f1a = focusRows(rows, "1a");
t("BF-2a", "🔴 点分支 1-a 默认：祖先链 + 自身 + 后代（用户：「进入整个 1 的上下游分支」）",
	eq(sorted(f1a.rows.map((r) => r.sessionId)), sorted(["1", "1a", "1a1"])), f1a.rows.map((r) => r.sessionId));
t("BF-2b", "  applied=true 且 stats 对账（total = up + down + self = 实际行数）",
	f1a.applied === true && f1a.stats.total === f1a.rows.length
	&& f1a.stats.total === f1a.stats.up + f1a.stats.down + f1a.stats.self, f1a.stats);

const f1aUp = focusRows(rows, "1a", { includeParents: true });
t("BF-3a", "🔴 再开「含上一层」：**必须多出 2,3,4,5**（用户点名的四个）",
	["2", "3", "4", "5"].every((x) => f1aUp.rows.some((r) => r.sessionId === x)), f1aUp.rows.map((r) => r.sessionId));
t("BF-3b", "🔴 且**不**把 1-b / 1-c 拉进来（用户列的是「1,2,3,4,5」，不是全部分支）",
	!f1aUp.rows.some((r) => r.sessionId === "1b" || r.sessionId === "1c"), f1aUp.rows.map((r) => r.sessionId));
t("BF-3c", "  上一层全景 = {1,2,3,4,5}（不含自身）", eq(sorted(upstreamPanorama(rows, "1a")), ["1", "2", "3", "4", "5"]),
	upstreamPanorama(rows, "1a"));
t("BF-3d", "  正负对照：关掉开关后那四个**必须消失**（否则开关是装饰）",
	!["2", "3", "4", "5"].some((x) => f1a.rows.some((r) => r.sessionId === x)));

const f1 = focusRows(rows, "1");
t("BF-4a", "点根 1 默认：只见 1 这条链（含其全部分支）",
	eq(sorted(f1.rows.map((r) => r.sessionId)), sorted(["1", "1a", "1b", "1c", "1a1"])), f1.rows.map((r) => r.sessionId));
const f1Up = focusRows(rows, "1", { includeParents: true });
t("BF-4b", "点根 1 含上一层：并上 2,3,4,5（各自分支不在其中）",
	["2", "3", "4", "5"].every((x) => f1Up.rows.some((r) => r.sessionId === x))
	&& !f1Up.rows.some((r) => r.sessionId === "2a"), f1Up.rows.map((r) => r.sessionId));

console.log("\n【D】不可用入参必须**返回全量**（不是返回空）");
const fNone = focusRows(rows, "不存在的会话");
const fEmpty = focusRows(rows, "");
const fNull = focusRows(rows, null);
t("BF-5a", "未知 id → applied=false 且 rows 仍为全部 21 行",
	fNone.applied === false && fNone.rows.length === 21, { applied: fNone.applied, n: fNone.rows.length });
t("BF-5b", "空字符串 / null 同上（防止「没选就变白」）",
	fEmpty.applied === false && fEmpty.rows.length === 21 && fNull.applied === false && fNull.rows.length === 21);
t("BF-5c", "rows 非数组时不抛错", (() => {
	try { const r = focusRows(null, "1"); return r.applied === false && r.rows.length === 0; } catch (e) { return false; }
})());

console.log("\n【E】边界：环 / 孤儿父 / 空树");
t("BF-6a", "🔴 环（a→b→a）下 downstreamIds 不死循环", (() => {
	const cyc = [
		{ sessionId: "a", parentSessionId: "b", title: "a", depth: 0, childrenCount: 1 },
		{ sessionId: "b", parentSessionId: "a", title: "b", depth: 1, childrenCount: 1 }
	];
	const d = downstreamIds(cyc, "a");
	return eq(sorted([...d]), ["a", "b"]);
})(), "见 detail");
t("BF-6b", "🔴 环下 focusRows 也不死循环", (() => {
	const cyc = [
		{ sessionId: "a", parentSessionId: "b", title: "a", depth: 0, childrenCount: 1 },
		{ sessionId: "b", parentSessionId: "a", title: "b", depth: 1, childrenCount: 1 }
	];
	const r = focusRows(cyc, "a");
	return r.applied === true && r.rows.length === 2;
})());
t("BF-6c", "孤儿父（parentSessionId 指向不存在）→ 祖先链止步、不报错", (() => {
	const orph = [{ sessionId: "x", parentSessionId: "gone", title: "x", depth: 0, childrenCount: 0 }];
	return upstreamChain(orph, "x").length === 0 && focusRows(orph, "x").applied === true;
})());
t("BF-6d", "空树：未知 id → applied=false、rows=[]", (() => {
	const r = focusRows([], "1"); return r.applied === false && r.rows.length === 0;
})());

console.log("\n【F】行序与幂等（改错序会让连线错位）");
t("BF-7a", "聚焦结果保持与原 rows 相同的相对顺序", (() => {
	const got = f1Up.rows.map((r) => r.sessionId);
	const want = rows.map((r) => r.sessionId).filter((id) => got.indexOf(id) >= 0);
	return eq(got, want);
})(), { got: f1Up.rows.map((r) => r.sessionId) });
t("BF-7b", "同一入参两次调用结果一致（幂等）", eq(focusRows(rows, "1a", { includeParents: true }).rows.map((r) => r.sessionId),
	focusRows(rows, "1a", { includeParents: true }).rows.map((r) => r.sessionId)));

/* ══ 汇总 ══ */
console.log("\n───────────────────────────────────────────────");
console.log(` 通过 ${pass} / 失败 ${fail}`);
if (fail) console.log(" 失败项：\n   - " + failures.join("\n   - "));
console.log(` IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("───────────────────────────────────────────────");
process.exit(fail === 0 ? 0 : 1);
