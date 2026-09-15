#!/usr/bin/env node
/**
 * test-roles.mjs —— 角色注册表（Agent Card）**纯函数离线测试**
 *
 * ══════════════════════════════════════════════════════════════════
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | RS-1 | 内置表自审 | `auditRoles().ok === true`；四层**都有人**（`auditOrg().empty` 为空） |
 *  | RS-2 | 三要素齐备 | 每个角色 role / goal / backstory / description / summary / body / triggers / modelTier 均非空 |
 *  | RS-3 | 🔴 缺字段**必须报红** | 逐个删字段 → `validateRole().ok === false` 且 fails **点名**缺哪个 |
 *  | RS-4 | 🔴 层约束**必须报红** | 合规层声明 readOnly:false → 红；执行层声明 allowDelegation:true → 红 |
 *  | RS-5 | id 唯一 | 复制一份同 id → `auditRoles()` 报"id 重复" |
 *  | RS-6 | triggers 二义 | 两个角色挂同一个触发词 → 报"triggers 二义" |
 *  | RS-7 | 路由命中 | 5 个真实输入各命中**预期角色**；无信号输入 → `role === null`（**不硬塞**） |
 *  | RS-8 | 路由过滤 | allowLayers / exclude 生效 |
 *  | RS-9 | 三层披露 | L1 极短且**不含 body**；L2 含三要素；L3 含 refs |
 *  | RS-10 | 上下文预算 | L1 全部角色合计 < 1500 字符（防角色膨胀压爆上下文） |
 *  | RS-11 | 档位落模型 | resolveTierModel 正确；inherit 走 fallback |
 *  | RS-12 | auditOrg 缺层 | 抽掉编排层 → `auditOrg().ok === false` 且空层**点名** |
 *
 * 用法：node scripts/test-roles.mjs ｜ 退出码 0 全绿 / 1 有失败 / 2 INVALID
 */
import {
	LAYER, LAYERS, MODEL_TIER, DISCLOSE,
	BUILTIN_ROLES, validateRole, auditRoles, auditOrg,
	routeRole, contextFor, l1Manifest, l1Budget,
	rolesInLayer, primaryOf, roleById, resolveTierModel, tokenize, layerOf
} from "../src/logic/roles.js";

const EXPECTED_TOTAL = 45;
let pass = 0, fail = 0;
const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++;
	else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}
const clone = (o) => JSON.parse(JSON.stringify(o));

console.log("═══════════════════════════════════════════════════════════");
console.log("  角色注册表 · 纯函数离线测试（logic/roles.js）");
console.log("═══════════════════════════════════════════════════════════");

console.log("\n【A】注册表自审与组织成形");
const audit = auditRoles();
t("RS-1a", "内置角色表自审通过（零 fails）", audit.ok, audit.fails);
t("RS-1b", "四层都有人（无空层）", auditOrg().ok, auditOrg().empty);
t("RS-1c", "层定义共 4 层且键与 LAYER 一致",
	LAYERS.length === 4 && LAYERS.every((l) => Object.values(LAYER).includes(l.key)));

console.log("\n【B】三要素与三层披露字段齐备");
const needKeys = ["role", "goal", "backstory", "description", "summary", "body", "triggers", "modelTier"];
const missingAny = [];
for (const r of BUILTIN_ROLES) {
	for (const k of needKeys) {
		const v = r[k];
		if (v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length)) {
			missingAny.push(r.id + "." + k);
		}
	}
}
t("RS-2a", "全部角色字段齐备（" + BUILTIN_ROLES.length + " 个）", missingAny.length === 0, missingAny);
t("RS-2b", "每个角色都有 refs（证据来源可追）", BUILTIN_ROLES.every((r) => Array.isArray(r.refs) && r.refs.length > 0));
t("RS-2c", "每个角色都记录了 src（启发来源）", BUILTIN_ROLES.every((r) => Boolean(r.src)));

console.log("\n【C】🔴 负例：缺字段必须报红（且点名缺什么）");
const base = clone(roleById("polisher"));
for (const k of ["role", "goal", "backstory", "summary", "body"]) {
	const bad = clone(base); delete bad[k];
	const r = validateRole(bad);
	t("RS-3-" + k, "缺 " + k + " → 报红且点名", r.ok === false && r.fails.some((f) => f.indexOf(k) >= 0), r.fails);
}
const shortDesc = clone(base); shortDesc.description = "太短";
t("RS-3-desc", "description 过短 → 报红（路由无有效信号）",
	validateRole(shortDesc).ok === false, validateRole(shortDesc).fails);
const noTrig = clone(base); noTrig.triggers = [];
t("RS-3-trig", "triggers 为空 → 报红", validateRole(noTrig).ok === false, validateRole(noTrig).fails);
const badId = clone(base); badId.id = "Bad_ID";
t("RS-3-id", "id 不合规（大写/下划线）→ 报红", validateRole(badId).ok === false, validateRole(badId).fails);
const badTier = clone(base); badTier.modelTier = "ultra";
t("RS-3-tier", "modelTier 非法 → 报红", validateRole(badTier).ok === false, validateRole(badTier).fails);
const badLayer = clone(base); badLayer.layer = "nope";
t("RS-3-layer", "layer 非法 → 报红", validateRole(badLayer).ok === false, validateRole(badLayer).fails);

console.log("\n【D】🔴 负例：层约束（合规层与执行层的硬边界）");
const comp = clone(roleById("output-reviewer"));
comp.readOnly = false;
t("RS-4a", "合规层声明 readOnly:false → 报红（必须只读）",
	validateRole(comp).ok === false, validateRole(comp).fails);
const exec = clone(roleById("doc-writer"));
exec.allowDelegation = true;
t("RS-4b", "执行层声明 allowDelegation:true → 报红（不得再委派）",
	validateRole(exec).ok === false, validateRole(exec).fails);
t("RS-4c", "正对照：合规层只读 + 不委派 → 通过",
	validateRole(roleById("output-reviewer")).ok, validateRole(roleById("output-reviewer")).fails);

console.log("\n【E】🔴 负例：跨角色的两条约束");
const dup = clone(BUILTIN_ROLES); dup.push(clone(roleById("director")));
const dupRes = auditRoles(dup);
t("RS-5", "id 重复 → 报红", dupRes.ok === false && dupRes.fails.some((f) => f.indexOf("id 重复") >= 0), dupRes.fails);

const amb = clone(BUILTIN_ROLES);
amb.find((r) => r.id === "test-planner").triggers.push("审核");
const ambRes = auditRoles(amb);
t("RS-6", "同一触发词挂两个角色 → 报红（路由二义）",
	ambRes.ok === false && ambRes.fails.some((f) => f.indexOf("triggers 二义") >= 0), ambRes.fails);

console.log("\n【F】路由（选谁干活）");
const cases = [
	["帮我审核一下这个产出，看看符不符合需求", "output-reviewer"],
	["这件事要拆解成几步来做", "organizer"],
	["换个话题吧，重新开一个新分支", "branch-judge"],
	["把上下文精简一下，历史太长了", "context-picker"],
	["检查一下格式和字数，缺件没有", "assert-runner"]
];
for (const [input, want] of cases) {
	const r = routeRole(input);
	t("RS-7-" + want, "「" + input.slice(0, 10) + "…」→ " + want,
		Boolean(r.role) && r.role.id === want, r.role ? r.role.id + "(" + r.score + ")" : "null");
}
const noise = routeRole("嗯");
t("RS-7-none", "无信号输入 → role === null（**不硬塞角色**）", noise.role === null, noise.role && noise.role.id);
const govOnly = routeRole("帮我审核一下这个产出", BUILTIN_ROLES, { allowLayers: [LAYER.GOVERNANCE] });
t("RS-8a", "allowLayers 限定治理层 → 不会选出合规层角色",
	govOnly.role === null || govOnly.role.layer === LAYER.GOVERNANCE, govOnly.role && govOnly.role.id);
const excl = routeRole("帮我审核一下这个产出", BUILTIN_ROLES, { exclude: ["output-reviewer"] });
t("RS-8b", "exclude 生效 → 不返回被排除的角色",
	!excl.role || excl.role.id !== "output-reviewer", excl.role && excl.role.id);

console.log("\n【G】三层渐进式披露");
const rev = roleById("output-reviewer");
const l1 = contextFor(rev, DISCLOSE.L1);
const l2 = contextFor(rev, DISCLOSE.L2);
const l3 = contextFor(rev, DISCLOSE.L3);
t("RS-9a", "L1 极短（< 80 字符）", l1.length < 80, l1.length);
t("RS-9b", "L1 不含 body 正文（常驻段不塞流程）", l1.indexOf(rev.body.slice(0, 12)) < 0);
t("RS-9c", "L2 含三要素（身份/目标/行为先验）",
	l2.indexOf(rev.role) >= 0 && l2.indexOf(rev.goal) >= 0 && l2.indexOf(rev.backstory) >= 0);
t("RS-9d", "L3 比 L2 多出 refs 段", l3.indexOf("参考") >= 0 && l3.length > l2.length);
t("RS-9e", "L2 含约束行（档位/只读/可委派/温度）",
	l2.indexOf(rev.modelTier) >= 0 && l2.indexOf("只读") >= 0);
t("RS-9f", "未知角色 → 空串（不抛错）", contextFor(null, DISCLOSE.L3) === "");
const budget = l1Budget();
t("RS-10", "全角色 L1 合计 < 1500 字符（当前 " + budget + "）", budget < 1500, budget);
t("RS-10b", "L1 清单条数 === 角色数", l1Manifest().length === BUILTIN_ROLES.length);

console.log("\n【H】档位与层工具");
t("RS-11a", "strong → reasoner", resolveTierModel(MODEL_TIER.STRONG) === "deepseek-reasoner");
t("RS-11b", "cheap → chat", resolveTierModel(MODEL_TIER.CHEAP) === "deepseek-chat");
t("RS-11c", "inherit → 走 fallback", resolveTierModel(MODEL_TIER.INHERIT, "my-model") === "my-model");
t("RS-11d", "未知档位 → fallback（不返回 undefined）", resolveTierModel("nope", "fb") === "fb");
t("RS-12a", "抽掉编排层 → auditOrg 报红且点名",
	(() => { const r = BUILTIN_ROLES.filter((x) => x.layer !== LAYER.ORCHESTRATION); const a = auditOrg(r); return a.ok === false && a.empty.indexOf(LAYER.ORCHESTRATION) >= 0; })());
t("RS-12b", "rolesInLayer / primaryOf 一致",
	rolesInLayer(LAYER.COMPLIANCE).length === 2 && primaryOf(LAYER.ORCHESTRATION).id === "organizer");
t("RS-12c", "layerOf 未知层回落治理层（不返回 undefined）", layerOf("nope").key === LAYER.GOVERNANCE);
t("RS-12d", "tokenize 对中文切词非空（CJK 二字组）", tokenize("修复登录按钮").size > 0);

console.log("\n───────────────────────────────────────────────────────────");
const total = pass + fail;
console.log("  断言总数 " + total + "（声明 " + EXPECTED_TOTAL + "）· 通过 " + pass + " · 失败 " + fail);
if (total !== EXPECTED_TOTAL) {
	console.log("  ⚠ 断言总数与声明不符 ⇒ INVALID（防止加/删断言后分母悄悄漂移）");
	process.exit(2);
}
if (fail) { console.log("  失败项：" + failures.join(" | ")); process.exit(1); }
console.log("  IS_PASS: TRUE");
process.exit(0);
