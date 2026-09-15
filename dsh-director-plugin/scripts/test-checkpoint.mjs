#!/usr/bin/env node
/**
 * test-checkpoint.mjs —— 不可变快照链**纯函数离线测试**
 *
 * ══════════════════════════════════════════════════════════════════
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | CP-1 | 🔴 不可变性 | `append` 返回**新链**，原链的 nodes 长度不变 |
 *  | CP-2 | seq 链 | seq 递增；parentSeq 指向上一节点 |
 *  | CP-3 | 🔴 Fork | 原链保留；新链从分叉点续（后面的被砍掉）；branchOf 记录来源 |
 *  | CP-4 | 链自审 | 正常链 ok；seq 重复报红；**done 非单调报红** |
 *  | CP-5 | 🔴 重放计划 | 只跑没完成的；**非幂等默认跳过**；force 才重跑 |
 *  | CP-6 | 差异 | 识别 changed / added / removed；相同 → same:true |
 *  | CP-7 | 版本清单 | listVersions / latest / at / branches 口径 |
 *  | CP-8 | 边界 | 空链 / 不存在的 seq / 非法输入 不抛穿透 |
 *
 * 用法：node scripts/test-checkpoint.mjs ｜ 退出码 0 全绿 / 1 有失败 / 2 INVALID
 */
import {
	REASON, createChain, append, fork, branches,
	at, latest, listVersions, replayPlan, diff, auditChain
} from "../src/logic/checkpoint.js";

const EXPECTED_TOTAL = 44;
let pass = 0, fail = 0;
const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++;
	else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  不可变快照链 · 纯函数离线测试（logic/checkpoint.js）");
console.log("═══════════════════════════════════════════════════════════");

const c0 = createChain("thread-1");
const a1 = append(c0, { snapshot: { stage: "plan" }, done: ["s1"], reason: REASON.WAVE, at: 100 });
const a2 = append(a1.chain, { snapshot: { stage: "doc", doc: "v1" }, done: ["s1", "s2"], reason: REASON.WAVE, at: 200 });

console.log("\n【A】🔴 不可变性");
t("CP-1a", "append 返回新链对象", a1.chain !== c0);
t("CP-1b", "🔴 原链 nodes 长度不变（0 → 1 不是就地改）", c0.nodes.length === 0 && a1.chain.nodes.length === 1, c0.nodes.length);
t("CP-1c", "连续 append 不污染前一版", a1.chain.nodes.length === 1 && a2.chain.nodes.length === 2);
t("CP-1d", "快照内容是**浅拷贝**（改快照对象不影响已存版本）",
	(() => { const snap = { stage: "x", list: [1] }; const r = append(createChain("t"), { snapshot: snap }); snap.stage = "改了"; snap.list.push(2); return r.node.snapshot.stage === "x" && r.node.snapshot.list.length === 1; })());

console.log("\n【B】seq 链");
t("CP-2a", "seq 从 1 递增", a1.node.seq === 1 && a2.node.seq === 2, [a1.node.seq, a2.node.seq]);
t("CP-2b", "parentSeq 指向上一节点（首条为 0）", a1.node.parentSeq === 0 && a2.node.parentSeq === 1);
t("CP-2c", "node 记录 reason 与 done 数", a2.node.reason === REASON.WAVE && a2.node.done.length === 2);
t("CP-2d", "非法 reason 回落 wave（不写入脏值）", append(c0, { done: [], reason: "???" }).node.reason === REASON.WAVE);
t("CP-2e", "缺少快照内容 → ok:false（不抛穿透）", append(c0, null).ok === false);

console.log("\n【C】🔴 Fork（时间旅行）");
const fk = fork(a2.chain, 1, { at: 300 });
t("CP-3a", "从 seq=1 分叉成功", fk.ok, fk.reason);
t("CP-3b", "🔴 原链保留（2 个节点仍都在）", a2.chain.nodes.length === 2, a2.chain.nodes.length);
t("CP-3c", "新链从分叉点续（seq=1 之后的被砍掉）",
	fk.chain.nodes.length === 2 && fk.chain.nodes[1].reason === REASON.FORK, fk.chain.nodes.map((n) => n.seq + ":" + n.reason));
t("CP-3d", "分叉节点记录 branchOf = 分叉点", fk.node.branchOf === 1);
t("CP-3e", "分叉沿用分叉点的快照（可在此基础上改）", JSON.stringify(fk.node.snapshot) === JSON.stringify(at(a2.chain, 1).snapshot));
t("CP-3f", "branches 列出分叉点", branches(fk.chain).length === 1 && branches(fk.chain)[0].from === 1);
t("CP-3g", "分叉点不存在 → ok:false 并报 seq", fork(a2.chain, 99).ok === false);

console.log("\n【D】链自审");
t("CP-4a", "正常链 → ok", auditChain(a2.chain).ok, auditChain(a2.chain).fails);
t("CP-4b", "空链 → ok（没有节点就没有矛盾）", auditChain(c0).ok);
t("CP-4c", "🔴 seq 重复 → 报红",
	(() => { const bad = { threadId: "t", nodes: [a1.node, { ...a2.node, seq: 1, parentSeq: 1 }], nextSeq: 3 }; return auditChain(bad).fails.some((f) => f.indexOf("seq 重复") >= 0); })());
t("CP-4d", "🔴 seq 非递增 → 报红",
	auditChain({ threadId: "t", nodes: [{ ...a1.node, seq: 5 }, a2.node], nextSeq: 9 }).fails.some((f) => f.indexOf("非递增") >= 0));
t("CP-4e", "🔴 done 集合非单调（丢了已完成的步骤）→ 报红",
	(() => {
		const x = append(createChain("t"), { snapshot: {}, done: ["s1", "s2"] });
		const y = append(x.chain, { snapshot: {}, done: ["s3"], reason: REASON.WAVE });
		return auditChain(y.chain).fails.some((f) => f.indexOf("非单调") >= 0);
	})());
t("CP-4f", "分叉点 branchOf 不存在 → 报红",
	auditChain({ threadId: "t", nodes: [{ ...a1.node, branchOf: 77 }], nextSeq: 2 }).fails.some((f) => f.indexOf("分叉点") >= 0));

console.log("\n【E】🔴 重放计划（断点续跑：已完成的默认不重跑）");
const STEPS = ["s1", "s2", "s3", "s4"];
const c3 = append(a2.chain, { snapshot: {}, done: ["s1", "s2", "s3"], reason: REASON.GATE, at: 250 });
const rp = replayPlan(a2.chain, STEPS);
t("CP-5a", "只跑没完成的（s1/s2 已完成 → 从 s3 起）", rp.from.join(",") === "s3,s4", rp.from);
t("CP-5b", "🔴 已完成的两步进 skip（**不被重跑**，与断点续跑语义一致）",
	rp.skip.join(",") === "s1,s2", rp.skip);
t("CP-5c", "🔴 非幂等且已完成 → 跳过并告警（防重复副作用）",
	(() => { const r = replayPlan(c3.chain, STEPS, { nonIdempotent: ["s3"] }); return r.skip.indexOf("s3") >= 0 && r.warnings.length > 0; })(),
	replayPlan(c3.chain, STEPS, { nonIdempotent: ["s3"] }));
t("CP-5d", "告警带可分辨原因（不是静默跳过）",
	(() => { const w = replayPlan(c3.chain, STEPS, { nonIdempotent: ["s3"] }).warnings; return w.length > 0 && w[0].indexOf("非幂等") >= 0; })(),
	replayPlan(c3.chain, STEPS, { nonIdempotent: ["s3"] }).warnings);
t("CP-5e", "force:true → 已完成的也重跑（skip 只剩非幂等被显式要求的除外）",
	replayPlan(c3.chain, STEPS, { nonIdempotent: ["s3"], force: true }).from.join(",") === "s1,s2,s3,s4",
	replayPlan(c3.chain, STEPS, { nonIdempotent: ["s3"], force: true }).from);
t("CP-5f", "forceSteps 逐个放行",
	replayPlan(c3.chain, STEPS, { nonIdempotent: ["s3"], forceSteps: ["s3"] }).from.join(",") === "s3,s4",
	replayPlan(c3.chain, STEPS, { nonIdempotent: ["s3"], forceSteps: ["s3"] }).from);
t("CP-5g", "空链 → 全量执行并说明首次运行", replayPlan(c0, STEPS).from.length === 4 && replayPlan(c0, STEPS).reason.indexOf("首次") >= 0);
t("CP-5h", "从指定 seq 续跑（seq=1 的 done 只有 s1）", replayPlan(a2.chain, STEPS, { fromSeq: 1 }).from.join(",") === "s2,s3,s4");
t("CP-5i", "非幂等但**未完成** → 正常执行（risky 只对已完成的生效）",
	replayPlan(a2.chain, STEPS, { nonIdempotent: ["s1"] }).from.indexOf("s1") < 0
	&& replayPlan(a2.chain, STEPS, { nonIdempotent: ["s3"] }).from.indexOf("s3") >= 0);
t("CP-5j", "reason 报出待执行与跳过的条数", rp.reason.indexOf("待执行 2") >= 0 && rp.reason.indexOf("跳过 2") >= 0, rp.reason);

console.log("\n【F】差异对照");
const d1 = diff(a2.chain, 1, 2);
t("CP-6a", "识别出 changed 的键（doc 由无到有 → added）",
	!d1.same && (d1.added.indexOf("doc") >= 0 || d1.changed.some((c) => c.key === "doc")), d1);
t("CP-6b", "标识了比较深度（shallow，不深递归）", d1.depth === "shallow");
const same = diff(a2.chain, 2, 2);
t("CP-6c", "同一 seq 比自身 → same:true", same.same === true, same);
t("CP-6d", "改动同一键 → changed 里带 from/to",
	(() => { const x = append(createChain("t"), { snapshot: { k: 1 } }); const y = append(x.chain, { snapshot: { k: 2 } }); const r = diff(y.chain, 1, 2); return r.changed[0].key === "k" && r.changed[0].from === 1 && r.changed[0].to === 2; })());
t("CP-6e", "seq 不存在 → error 且不抛穿透", diff(a2.chain, 1, 99).error.indexOf("不存在") >= 0);

console.log("\n【G】版本清单与边界");
const lv = listVersions(fk.chain);
t("CP-7a", "listVersions 条数 === 节点数", lv.length === fk.chain.nodes.length);
t("CP-7b", "分叉点被标 isFork", lv.some((v) => v.isFork), lv);
t("CP-7c", "latest 取最后一个", latest(a2.chain).seq === 2);
t("CP-7d", "at 取指定 seq", at(a2.chain, 1).seq === 1);
t("CP-7e", "at 不存在的 seq → null（不抛错）", at(a2.chain, 99) === null);
t("CP-8a", "空链 latest → null", latest(c0) === null);
t("CP-8b", "非法输入不抛穿透（全部走默认空链）",
	at(null, 1) === null && listVersions(undefined).length === 0 && auditChain(null).ok === true);

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
