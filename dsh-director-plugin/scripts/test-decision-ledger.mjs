#!/usr/bin/env node
/**
 * test-decision-ledger.mjs —— 思维链路决策台账（B7）离线测试（无需 Harness）
 *
 * ════════════════════════════════════════════════════════════
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | DL2-1 | recordDecision 落账 {输入,决策,理由,时间} | 四字段齐全 |
 *  | DL2-2 | 跨批次累积（不被 recordDispatch 清空） | 多批后 decisions 不丢 |
 *  | DL2-3 | seq 自增 | 第 N 条 seq==N |
 *  | DL2-4 | decisionsFor(dim) 按维度过滤 | 只回该维度 |
 *  | DL2-5 | decisionsFor(sessionId) 按会话过滤 | 只回该会话 |
 *  | DL2-6 | 🔴 lastDecisionFor 回最近一条 | 翻「上次为何派给 A4」 |
 *  | DL2-7 | 空过滤回全部（升序） | readDecisions 顺序 |
 *  | DL2-8 | clearDispatchLog 清 decisions | 归零 |
 *  | DL2-9 | 畸形入参不抛（null/字符串） | 安全默认 |
 *  | DL2-10 | via 字段记录模型判 vs 规则降级 | via 可回读 |
 *
 * 用法：
 *   node scripts/test-decision-ledger.mjs            ｜ 全绿 exit 0
 *   DECISION_NEG=1 node scripts/test-decision-ledger.mjs ｜ 植入缺陷（必须红 exit≠0）
 * 退出码：0 全绿 / 1 有失败 / 2 对账 INVALID
 */
import {
	dispatchLog, recordDispatch, recordDecision, readDecisions,
	decisionsFor, lastDecisionFor, clearDispatchLog
} from "../src/store/dispatch-log.js";
import { tallyCheck } from "./_test-tally.mjs";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + name); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + "\n       " + JSON.stringify(detail)); }
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  思维链路决策台账（B7）· 离线测试（store/dispatch-log.js）");
console.log("═══════════════════════════════════════════════════════════");

clearDispatchLog();

const rec = recordDecision({
	input: "帮我写小说《虚海》，先搭世界观",
	decision: "派给 A1 世界观",
	reason: "需求里明确要世界观，命中 knownPool world",
	dim: "world", sessionId: "sess-a", via: "model"
});
t("DL2-1", "recordDecision 落账 {输入,决策,理由,时间} 四字段齐全",
	rec.input.indexOf("虚海") >= 0 && rec.decision.indexOf("A1") >= 0
		&& rec.reason.length > 0 && typeof rec.at === "number" && rec.at > 0, rec);

/* 跨批次累积：再 recordDispatch 一批，decisions 不应被清 */
recordDispatch({ text: "第二批", name: "《虚海》", kind: "novel", items: [{ dim: "plot", label: "A3", sessionId: "sess-b" }] });
t("DL2-2", "🔴 decisions 跨批次累积（recordDispatch 不清决策台账）",
	readDecisions().length === 1, { n: readDecisions().length });

recordDecision({ input: "剧情", decision: "派给 A3", reason: "剧情线", dim: "plot", sessionId: "sess-b", via: "rule" });
recordDecision({ input: "世界观修订", decision: "再派 A1", reason: "补充设定", dim: "world", sessionId: "sess-a", via: "model" });
t("DL2-3", "seq 自增（第 3 条 seq==3）",
	readDecisions().length === 3 && readDecisions()[2].seq === 3, { n: readDecisions().length });

const worldOnly = decisionsFor({ dim: "world" });
t("DL2-4", "decisionsFor(dim) 按维度过滤（只回 world 两条）",
	worldOnly.length === 2 && worldOnly.every((r) => r.dim === "world"), worldOnly.map((r) => r.seq));

const sessOnly = decisionsFor({ sessionId: "sess-b" });
t("DL2-5", "decisionsFor(sessionId) 按会话过滤（只回 sess-b 一条）",
	sessOnly.length === 1 && sessOnly[0].sessionId === "sess-b", sessOnly.map((r) => r.seq));

const lastWorld = lastDecisionFor({ dim: "world" });
t("DL2-6", "🔴 lastDecisionFor 回最近一条（翻「上次为何派给 A4」）",
	lastWorld && lastWorld.reason === "补充设定" && lastWorld.seq === 3,
	{ reason: lastWorld && lastWorld.reason });

t("DL2-7", "空过滤 readDecisions 时间正序（seq 1,2,3）",
	readDecisions().map((r) => r.seq).join(",") === "1,2,3",
	readDecisions().map((r) => r.seq));

t("DL2-10", "via 字段记录模型判 vs 规则降级（可回读）",
	decisionsFor({ dim: "plot" })[0].via === "rule"
		&& decisionsFor({ dim: "world" })[0].via === "model",
	{ plot: decisionsFor({ dim: "plot" })[0].via });

let threw = false;
try {
	recordDecision(null);
	recordDecision("junk");
	lastDecisionFor(null);
} catch (e) { threw = true; }
t("DL2-9", "畸形入参不抛（null/字符串 filter）", threw === false, { threw: threw });

clearDispatchLog();
t("DL2-8", "clearDispatchLog 清 decisions（归零）",
	readDecisions().length === 0 && dispatchLog.decisions.length === 0, { n: readDecisions().length });

/* 植入缺陷校准：DECISION_NEG=1 ⇒ 断言「lastDecisionFor 竟然不是最近一条」 */
if (process.env.DECISION_NEG === "1") {
	console.log("  [注入缺陷] DECISION_NEG=1 ⇒ 期望最近一条竟然是第一条（与 DL2-6 真值相反）");
	recordDecision({ input: "x", decision: "y", reason: "first", dim: "z" });
	recordDecision({ input: "x", decision: "y", reason: "second", dim: "z" });
	t("DL2-NEG", "🔴 校准·最近一条竟然不是后写的？",
		lastDecisionFor({ dim: "z" }).reason === "first");
	clearDispatchLog();
}

const ran = pass + fail;
const MIN_ASSERTIONS = 10;
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "test-decision-ledger（纯离线）" });
if (!tally.ok) process.exit(2);

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + ran);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
