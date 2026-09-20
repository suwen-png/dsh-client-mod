#!/usr/bin/env node
/**
 * test-layers.mjs —— 三层职责边界 + 跨层信封 · 纯函数离线测试（无需 Harness）
 *
 * ════════════════════════════════════════════════════════════
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | LY-1  | 治理层可派到编排层 | ok:true |
 *  | LY-2  | 编排层可派到执行层 | ok:true |
 *  | LY-3  | 执行层不可派（出边为空） | ok:false |
 *  | LY-4  | 合规层不可派（只读） | ok:false |
 *  | LY-5  | 执行层不能反派治理层（架构倒灌） | ok:false |
 *  | LY-6  | 同层不跨层 | ok:false |
 *  | LY-7  | layerOfRole 查到角色所属层 | 返回治理层/编排层 |
 *  | LY-8  | 未知角色回落治理层且标 unknown | 不抛 |
 *  | LY-9  | 跨层信封带 fromLayer/toLayer 且合法 | ok:true |
 *  | LY-10 | 架构倒灌的跨层信封 ok:false | 不抛、带 reason |
 *  | LY-11 | 有 srcEnv 时继承 root/parent/round | 信封延续血缘 |
 *  | LY-12 | layerEnvOf 从行取跨层信封 | 字段齐全 |
 *  | LY-13 | 四层链回放全合法 ⇒ ok:true | violations=0 |
 *  | LY-14 | 链中含倒灌步 ⇒ ok:false 且违规步带 reason | violations≥1 |
 *  | LY-15 | 回放纯函数不改入参 | 原 steps 不变 |
 *  | LY-16 | 结构自检：execution/compliance 出边为 0 | audit ok:true |
 *  | LY-17 | 空链回放 ok:true（无违规） | violations=0 |
 *
 * 用法：
 *   node scripts/test-layers.mjs              ｜ 全绿 exit 0
 *   LAYERS_NEG=1 node scripts/test-layers.mjs ｜ 植入缺陷（必须红 exit≠0）
 * 退出码：0 全绿 / 1 有失败 / 2 对账 INVALID
 */
import {
	LAYER, DELEGATE_TARGETS, canDelegate, layerOfRole,
	buildCrossLayerEnvelope, layerEnvOf, replayLayerChain, auditLayerBoundaries
} from "../src/logic/layers.js";
import { tallyCheck } from "./_test-tally.mjs";

const ROLES = [
	{ id: "director", layer: LAYER.GOVERNANCE },
	{ id: "organizer", layer: LAYER.ORCHESTRATION },
	{ id: "worker", layer: LAYER.EXECUTION },
	{ id: "auditor", layer: LAYER.COMPLIANCE }
];

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + name); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + "\n       " + JSON.stringify(detail)); }
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  三层职责边界 + 跨层信封 · 纯函数离线测试（logic/layers.js）");
console.log("═══════════════════════════════════════════════════════════");

t("LY-1", "治理层可派到编排层",
	canDelegate(LAYER.GOVERNANCE, LAYER.ORCHESTRATION).ok === true,
	canDelegate(LAYER.GOVERNANCE, LAYER.ORCHESTRATION));
t("LY-2", "编排层可派到执行层",
	canDelegate(LAYER.ORCHESTRATION, LAYER.EXECUTION).ok === true,
	canDelegate(LAYER.ORCHESTRATION, LAYER.EXECUTION));
t("LY-3", "执行层不可派（出边为空）",
	canDelegate(LAYER.EXECUTION, LAYER.ORCHESTRATION).ok === false
		&& (DELEGATE_TARGETS[LAYER.EXECUTION] || []).length === 0,
	canDelegate(LAYER.EXECUTION, LAYER.ORCHESTRATION));
t("LY-4", "合规层不可派（只读）",
	canDelegate(LAYER.COMPLIANCE, LAYER.EXECUTION).ok === false
		&& (DELEGATE_TARGETS[LAYER.COMPLIANCE] || []).length === 0,
	canDelegate(LAYER.COMPLIANCE, LAYER.EXECUTION));
t("LY-5", "🔴 执行层不能反派治理层（架构倒灌必拒）",
	canDelegate(LAYER.EXECUTION, LAYER.GOVERNANCE).ok === false,
	canDelegate(LAYER.EXECUTION, LAYER.GOVERNANCE));
t("LY-6", "同层不跨层（governance→governance 拒）",
	canDelegate(LAYER.GOVERNANCE, LAYER.GOVERNANCE).ok === false,
	canDelegate(LAYER.GOVERNANCE, LAYER.GOVERNANCE));

t("LY-7", "layerOfRole 查到角色所属层（director=治理、organizer=编排）",
	layerOfRole("director", ROLES).key === LAYER.GOVERNANCE
		&& layerOfRole("organizer", ROLES).key === LAYER.ORCHESTRATION
		&& layerOfRole("worker", ROLES).key === LAYER.EXECUTION,
	{ director: layerOfRole("director", ROLES).key });

let threwUnknown = false, unk;
try { unk = layerOfRole("nobody", ROLES); } catch (e) { threwUnknown = true; }
t("LY-8", "未知角色回落治理层且标 unknown（不抛）",
	threwUnknown === false && unk && unk.key === LAYER.GOVERNANCE && unk.unknown === true,
	{ threw: threwUnknown, unk: unk });

const envOk = buildCrossLayerEnvelope({ fromLayer: LAYER.GOVERNANCE, toLayer: LAYER.ORCHESTRATION, id: "m1", to: "organizer" });
t("LY-9", "跨层信封带 fromLayer/toLayer 且合法 ok:true",
	envOk.ok === true && envOk.env.fromLayer === LAYER.GOVERNANCE && envOk.env.toLayer === LAYER.ORCHESTRATION,
	envOk);

const envBad = buildCrossLayerEnvelope({ fromLayer: LAYER.EXECUTION, toLayer: LAYER.GOVERNANCE, id: "m2" });
t("LY-10", "🔴 架构倒灌的跨层信封 ok:false 且带 reason（不抛）",
	envBad.ok === false && typeof envBad.reason === "string" && envBad.reason.length > 0,
	envBad);

/* 有 srcEnv ⇒ 继承 root/parent/round（跨层不切断血缘） */
const srcEnv = { id: "m0", from: "director", to: "organizer", root: "r1", parent: null, round: 0 };
const child = buildCrossLayerEnvelope({ fromLayer: LAYER.ORCHESTRATION, toLayer: LAYER.EXECUTION, id: "m3", to: "worker" }, srcEnv);
t("LY-11", "有 srcEnv 时跨层信封延续血缘（root/parent/round+1）",
	child.env.root === "r1" && child.env.parent === "m0" && child.env.round === 1,
	child.env);

const row = { nodeId: "worker", env: { id: "m3", from: "organizer", to: "worker", root: "r1", parent: "m0", round: 1, fromLayer: "orchestration", toLayer: "execution" } };
const le = layerEnvOf(row);
t("LY-12", "layerEnvOf 从行取跨层信封（fromLayer/toLayer 齐全）",
	le && le.fromLayer === LAYER.ORCHESTRATION && le.toLayer === LAYER.EXECUTION && le.root === "r1",
	le);

const goodChain = [
	{ fromLayer: LAYER.GOVERNANCE, toLayer: LAYER.ORCHESTRATION, at: 100, note: "派活" },
	{ fromLayer: LAYER.ORCHESTRATION, toLayer: LAYER.EXECUTION, at: 200, note: "拆给工人" }
];
const rep = replayLayerChain(goodChain);
t("LY-13", "四层链回放全合法 ⇒ ok:true（violations=0）",
	rep.ok === true && rep.violations === 0 && rep.layersTouched === 3,
	{ violations: rep.violations, layers: rep.layersTouched });

const badChain = [
	{ fromLayer: LAYER.GOVERNANCE, toLayer: LAYER.ORCHESTRATION },
	{ fromLayer: LAYER.EXECUTION, toLayer: LAYER.GOVERNANCE, note: "倒灌" }
];
const repBad = replayLayerChain(badChain);
t("LY-14", "🔴 链中含倒灌步 ⇒ ok:false 且违规步带 reason",
	repBad.ok === false && repBad.violations === 1
		&& repBad.steps[1].ok === false && repBad.steps[1].reason.length > 0,
	{ violations: repBad.violations });

/* 纯函数不改入参 */
const orig = goodChain.map((s) => Object.assign({}, s));
replayLayerChain(goodChain);
const unchanged = JSON.stringify(goodChain) === JSON.stringify(orig);
t("LY-15", "回放纯函数不改入参（同输入必同输出）", unchanged, { unchanged: unchanged });

const audit = auditLayerBoundaries();
t("LY-16", "结构自检：execution/compliance 出边为 0、治理层源头合法",
	audit.ok === true && audit.fails.length === 0, audit);

const empty = replayLayerChain([]);
t("LY-17", "空链回放 ok:true（无违规、layersTouched=0）",
	empty.ok === true && empty.violations === 0 && empty.layersTouched === 0,
	{ violations: empty.violations });

/* 植入缺陷校准：LAYERS_NEG=1 ⇒ 断言「执行层竟然能派到治理层」（与 LY-5 相反） */
if (process.env.LAYERS_NEG === "1") {
	console.log("  [注入缺陷] LAYERS_NEG=1 ⇒ 期望执行层竟然能派到治理层（与 LY-5 真值相反）");
	t("LY-NEG", "🔴 校准·执行层竟然能反派治理层？",
		canDelegate(LAYER.EXECUTION, LAYER.GOVERNANCE).ok === true);
}

const ran = pass + fail;
const MIN_ASSERTIONS = 17;
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "test-layers（纯离线）" });
if (!tally.ok) process.exit(2);

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + ran);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
