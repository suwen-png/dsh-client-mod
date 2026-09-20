#!/usr/bin/env node
/**
 * test-flow-sids.mjs —— 统一 id 语义（B1）纯函数离线测试（无需 Harness）
 *
 * ════════════════════════════════════════════════════════════
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | FS-1  | normalizeFlowSid 去空白/字符串化 | trim 生效 |
 *  | FS-2  | null/undefined 回落 "" | 不抛 |
 *  | FS-3  | isScopeIdLeak：ws_ 开头判作用域误用 | true |
 *  | FS-4  | 正常会话 id 不判 leak | false |
 *  | FS-5  | 全部 sid ∈ 会话集合 ⇒ ok:true | orphaned=0 |
 *  | FS-6  | 🔴 流转有、会话集合没有 ⇒ orphaned 断链 | ok:false |
 *  | FS-7  | 🔴 ws_ 作用域 id 进流转主键 ⇒ leaks 报错 | ok:false |
 *  | FS-8  | 空主键记 missing（不算断链） | ok 仍 true |
 *  | FS-9  | 认 sid/sessionId/id 三个候选键 | 优先 sid |
 *  | FS-10 | accounted == 入参总数 - orphaned - leaks | 对账守恒 |
 *  | FS-11 | dispatch-log flowSids 只回非空 sessionId | 空 session 被滤 |
 *  | FS-12 | validateLogSids 复用 lineage 判据（同一真相源） | ok 口径一致 |
 *
 * 用法：
 *   node scripts/test-flow-sids.mjs            ｜ 全绿 exit 0
 *   FLOW_SIDS_NEG=1 node scripts/test-flow-sids.mjs ｜ 植入缺陷（必须红 exit≠0）
 * 退出码：0 全绿 / 1 有失败 / 2 对账 INVALID
 */
import {
	SCOPE_ID_PREFIX, normalizeFlowSid, isScopeIdLeak, validateFlowSids
} from "../src/logic/lineage.js";
import { dispatchLog, recordDispatch, flowSids, validateLogSids, clearDispatchLog } from "../src/store/dispatch-log.js";
import { tallyCheck } from "./_test-tally.mjs";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + name); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + "\n       " + JSON.stringify(detail)); }
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  统一 id 语义（B1）· 纯函数离线测试");
console.log("═══════════════════════════════════════════════════════════");

t("FS-1", "normalizeFlowSid 去空白/字符串化",
	normalizeFlowSid("  sess-1  ") === "sess-1", normalizeFlowSid("  sess-1  "));
t("FS-2", "null/undefined 回落空串（不抛）",
	normalizeFlowSid(null) === "" && normalizeFlowSid(undefined) === "",
	{ n: normalizeFlowSid(null) });
t("FS-3", "isScopeIdLeak：ws_ 开头判作用域误用",
	isScopeIdLeak("ws_abc") === true && SCOPE_ID_PREFIX === "ws_", { leak: isScopeIdLeak("ws_abc") });
t("FS-4", "正常会话 id 不判 leak（非空且非 ws_ 开头）",
	isScopeIdLeak("sess-real-1") === false && isScopeIdLeak("") === false,
	{ real: isScopeIdLeak("sess-real-1") });

const sessions = ["sess-a", "sess-b", "sess-c"];
const good = validateFlowSids([{ sid: "sess-a" }, { sid: "sess-b" }], sessions);
t("FS-5", "全部 sid ∈ 会话集合 ⇒ ok:true（orphaned=0）",
	good.ok === true && good.orphaned.length === 0 && good.accounted === 2, good);

const orphaned = validateFlowSids([{ sid: "sess-a" }, { sid: "sess-ghost" }], sessions);
t("FS-6", "🔴 流转有、会话集合没有 ⇒ orphaned 断链（ok:false）",
	orphaned.ok === false && orphaned.orphaned.length === 1 && orphaned.orphaned[0] === "sess-ghost",
	orphaned);

const leak = validateFlowSids([{ sid: "sess-a" }, { sid: "ws_scope1" }], sessions);
t("FS-7", "🔴 ws_ 作用域 id 进流转主键 ⇒ leaks 报错（ok:false）",
	leak.ok === false && leak.leaks.length === 1 && leak.leaks[0] === "ws_scope1", leak);

const withMissing = validateFlowSids([{ sid: "sess-a" }, { sid: "" }, {}], sessions);
t("FS-8", "空主键记 missing（不算断链；ok 仍 true）",
	withMissing.ok === true && withMissing.missing.length === 2, withMissing);

/* 认候选键：sid 优先，其次 sessionId，再次 id */
const keys = validateFlowSids(
	[{ sid: "sess-a" }, { sessionId: "sess-b" }, { id: "sess-c" }], sessions);
t("FS-9", "认 sid / sessionId / id 三个候选键（sid 优先）",
	keys.ok === true && keys.sids.join(",") === "sess-a,sess-b,sess-c", keys.sids);

const acct = validateFlowSids([{ sid: "sess-a" }, { sid: "sess-ghost" }, { sid: "ws_x" }], sessions);
t("FS-10", "🔴 accounted 对账守恒（total - orphaned - leaks == accounted）",
	acct.total === 3 && acct.orphaned.length === 1 && acct.leaks.length === 1 && acct.accounted === 1,
	{ total: acct.total, accounted: acct.accounted });

/* dispatch-log 接线：flowSids / validateLogSids */
clearDispatchLog();
recordDispatch({
	text: "需求", name: "《虚海》", kind: "novel",
	items: [
		{ dim: "world", label: "A1", sessionId: "sess-a" },
		{ dim: "plot", label: "A3", sessionId: "sess-b" },
		{ dim: "none", label: "未建", sessionId: "" }
	]
});
const sids = flowSids();
t("FS-11", "dispatch-log flowSids 只回非空 sessionId（空会话被滤）",
	sids.length === 2 && sids.indexOf("sess-a") >= 0 && sids.indexOf("sess-b") >= 0
		&& sids.indexOf("") < 0, sids);

const logCheck = validateLogSids(sessions);
t("FS-12", "validateLogSids 复用 lineage 判据（同一会话集合 ⇒ ok:true）",
	logCheck.ok === true && logCheck.orphaned.length === 0 && logCheck.accounted === 2,
	{ ok: logCheck.ok, accounted: logCheck.accounted });
clearDispatchLog();

/* 植入缺陷校准：FLOW_SIDS_NEG=1 ⇒ 断言「ws_ 作用域竟然不算 leak」（与 FS-7 相反） */
if (process.env.FLOW_SIDS_NEG === "1") {
	console.log("  [注入缺陷] FLOW_SIDS_NEG=1 ⇒ 期望 ws_ 竟然不算 leak（与 FS-7 真值相反）");
	t("FS-NEG", "🔴 校准·ws_ 作用域 id 竟然不报错？",
		isScopeIdLeak("ws_x") === false);
}

const ran = pass + fail;
const MIN_ASSERTIONS = 12;
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "test-flow-sids（纯离线）" });
if (!tally.ok) process.exit(2);

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + ran);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
