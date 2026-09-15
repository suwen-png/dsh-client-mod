#!/usr/bin/env node
/**
 * test-dag.mjs —— 声明式步骤图（DAG）**纯函数离线测试**
 *
 * ══════════════════════════════════════════════════════════════════
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | DG-1 | 归一化 | 缺 id 自动命名；依赖去重；非法 type 回落 task；loop 上限夹到 1..10 |
 *  | DG-2 | 🔴 硬错误必须报红 | 空图 / id 重复 / id 非法 / 悬空依赖 / 自依赖 / **成环** 全部报红 |
 *  | DG-3 | 软告警 | any_completed 多上游 / 闸门缺 prompt / 被依赖却无 output / 循环缺 exit_condition |
 *  | DG-4 | 拓扑序 | 顺序正确；**成环返回 null**（不返回半张图） |
 *  | DG-5 | 分层 | 互不依赖者同层 |
 *  | DG-6 | 波次 | concurrency 上限**真的生效**（2 → 三层切两批；1 → 全串行） |
 *  | DG-7 | 就绪集 | 初始/满足后/any_completed/cap 四种口径 |
 *  | DG-8 | 图统计 | steps/edges/levels/waves/maxParallel/gates/loops |
 *  | DG-9 | 🔴 条件求值 | 四种形式正确；变量缺失 → **false 且说明**；语法不支持 → false |
 *  | DG-10 | shouldRun | 无条件 → 跑；条件假 → 不跑并给理由 |
 *  | DG-11 | 🔴 模板填充 | 未命中的占位**原样保留**并记 missing（不替换成空串） |
 *  | DG-12 | 产出引用 | refsOf 收集 task/condition/acceptance 里的 {{}} |
 *
 * 用法：node scripts/test-dag.mjs ｜ 退出码 0 全绿 / 1 有失败 / 2 INVALID
 */
import {
	STEP_TYPE, DEP_MODE, GATE_TYPES, DEFAULT_CONCURRENCY, MAX_LOOP,
	normalizeStep, normalizeGraph, validateGraph, findCycle,
	topoSort, topoLevels, planWaves, readySteps, graphStats,
	evalCondition, shouldRun, fillTemplate, refsOf
} from "../src/logic/dag.js";

const EXPECTED_TOTAL = 60;
let pass = 0, fail = 0;
const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++;
	else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 一张标准四步图：a → (b, c) → d */
const G = [
	{ id: "a", role: "doc-writer", output: "doc" },
	{ id: "b", role: "blueprint-architect", depends_on: ["a"] },
	{ id: "c", role: "test-planner", depends_on: ["a"] },
	{ id: "d", role: "output-reviewer", depends_on: ["b", "c"] }
];

console.log("═══════════════════════════════════════════════════════════");
console.log("  声明式步骤图 · 纯函数离线测试（logic/dag.js）");
console.log("═══════════════════════════════════════════════════════════");

console.log("\n【A】归一化");
const n1 = normalizeStep({}, 0);
t("DG-1a", "缺 id 自动命名 step-1", n1.id === "step-1", n1.id);
t("DG-1b", "缺 depends_on → 空数组（**不按数组顺序推断依赖**）", eq(n1.depends_on, []));
t("DG-1c", "非法 type 回落 task", normalizeStep({ type: "???" }).type === STEP_TYPE.TASK);
const n2 = normalizeStep({ id: "x", depends_on: ["a", "a", " b ", null, ""] });
t("DG-1d", "依赖去重 + 去空白 + 丢空值", eq(n2.depends_on, ["a", "b"]), n2.depends_on);
const n3 = normalizeStep({ id: "x", loop: { back_to: "a", max_iterations: 99 } });
t("DG-1e", "loop 上限夹到 " + MAX_LOOP, n3.loop.max_iterations === MAX_LOOP, n3.loop);
t("DG-1f", "没有 back_to 的 loop → null（不造半个循环）", normalizeStep({ id: "x", loop: { max_iterations: 3 } }).loop === null);
t("DG-1g", "depends_on_mode 只认 any_completed，其余回落 all",
	normalizeStep({ depends_on_mode: "zzz" }).depends_on_mode === DEP_MODE.ALL
	&& normalizeStep({ depends_on_mode: "any_completed" }).depends_on_mode === DEP_MODE.ANY);
t("DG-1h", "默认并发 = " + DEFAULT_CONCURRENCY, DEFAULT_CONCURRENCY === 2);

console.log("\n【B】🔴 硬错误（图不可执行）必须报红");
t("DG-2a", "空图 → 报红", validateGraph([]).ok === false, validateGraph([]).errors);
t("DG-2b", "id 重复 → 报红",
	validateGraph([{ id: "a" }, { id: "a" }]).errors.some((e) => e.indexOf("id 重复") >= 0));
t("DG-2c", "id 非法 → 报红",
	validateGraph([{ id: "A_B" }]).errors.some((e) => e.indexOf("id 非法") >= 0));
t("DG-2d", "悬空依赖 → 报红**并点名缺失的 id**",
	validateGraph([{ id: "a", depends_on: ["zz"] }]).errors.some((e) => e.indexOf("zz") >= 0));
t("DG-2e", "自依赖 → 报红",
	validateGraph([{ id: "a", depends_on: ["a"] }]).ok === false);
const cyc = [{ id: "a", depends_on: ["b"] }, { id: "b", depends_on: ["a"] }];
const cycRes = validateGraph(cyc);
t("DG-2f", "🔴 成环 → 硬错误（不是告警）", cycRes.ok === false && cycRes.errors.some((e) => e.indexOf("成环") >= 0), cycRes.errors);
t("DG-2g", "正对照：标准四步图 → 通过", validateGraph(G).ok, validateGraph(G).errors);

console.log("\n【C】软告警（可执行但有风险）");
const w1 = validateGraph([{ id: "a" }, { id: "b" }, { id: "c", depends_on: ["a", "b"], depends_on_mode: "any_completed" }]);
t("DG-3a", "any_completed 且多上游 → 告警", w1.ok && w1.warnings.some((w) => w.indexOf("any_completed") >= 0), w1.warnings);
const w2 = validateGraph([{ id: "g", type: STEP_TYPE.APPROVAL }]);
t("DG-3b", "人工闸门缺 prompt → 告警", w2.warnings.some((w) => w.indexOf("prompt") >= 0), w2.warnings);
const w3 = validateGraph([{ id: "a" }, { id: "b", depends_on: ["a"] }]);
t("DG-3c", "被依赖却无 output → 告警（下游拿不到产出）", w3.warnings.some((w) => w.indexOf("output") >= 0), w3.warnings);
const w4 = validateGraph([{ id: "a" }, { id: "b", loop: { back_to: "a" } }]);
t("DG-3d", "循环缺 exit_condition → 告警", w4.warnings.some((w) => w.indexOf("exit_condition") >= 0), w4.warnings);
t("DG-3e", "loop.back_to 指向不存在 → **硬错误**",
	validateGraph([{ id: "a", loop: { back_to: "zz" } }]).errors.some((e) => e.indexOf("back_to") >= 0));

console.log("\n【D】拓扑序与分层");
t("DG-4a", "拓扑序：a 在最前、d 在最后",
	(() => { const o = topoSort(G); return o[0] === "a" && o[o.length - 1] === "d"; })(), topoSort(G));
t("DG-4b", "🔴 成环 → 返回 null（**不返回半张图**）", topoSort(cyc) === null);
t("DG-4c", "拓扑序长度 === 步骤数", topoSort(G).length === G.length);
t("DG-5a", "分层：[[a],[b,c],[d]]", eq(topoLevels(G), [["a"], ["b", "c"], ["d"]]), topoLevels(G));
t("DG-5b", "成环 → 分层为空数组", eq(topoLevels(cyc), []));

console.log("\n【E】波次（concurrency 必须真的生效）");
const wv2 = planWaves(G, { concurrency: 2 });
t("DG-6a", "concurrency=2 → 3 波：[[a],[b,c],[d]]", eq(wv2.map((w) => w.ids), [["a"], ["b", "c"], ["d"]]), wv2);
t("DG-6b", "波次序号连续", wv2.every((w, i) => w.index === i));
const wv1 = planWaves(G, { concurrency: 1 });
t("DG-6c", "concurrency=1 → 全串行（4 波，每波 1 个）",
	wv1.length === 4 && wv1.every((w) => w.ids.length === 1), wv1.map((w) => w.ids));
t("DG-6d", "🔴 每波内步骤数不超过 concurrency",
	planWaves(G, { concurrency: 2 }).every((w) => w.ids.length <= 2));
t("DG-6e", "concurrency=0/非法 → 夹到 1（不静默变无穷）",
	planWaves(G, { concurrency: 0 }).every((w) => w.ids.length === 1));
const flat = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
t("DG-6f", "全独立 4 步 + 并发 2 → 2 波", planWaves(flat, { concurrency: 2 }).length === 2);

console.log("\n【F】就绪集");
t("DG-7a", "初始就绪 = [a]", eq(readySteps(G, []), ["a"]), readySteps(G, []));
t("DG-7b", "a 完成 → 就绪 [b,c]（顺序稳定）", eq(readySteps(G, ["a"]), ["b", "c"]), readySteps(G, ["a"]));
t("DG-7c", "b,c 完成 → 就绪 [d]", eq(readySteps(G, ["a", "b", "c"]), ["d"]));
t("DG-7d", "any_completed：任一上游完成即就绪",
	eq(readySteps([{ id: "x", depends_on: ["p", "q"], depends_on_mode: "any_completed" }], ["q"]), ["x"]));
t("DG-7e", "all 模式：只满足一个上游 → 不就绪",
	eq(readySteps([{ id: "x", depends_on: ["p", "q"] }], ["q"]), []));
t("DG-7f", "cap 生效（并发 1 → 只给 1 个）", readySteps(G, ["a"], { concurrency: 1 }).length === 1);

console.log("\n【G】图统计");
const st = graphStats(G);
t("DG-8a", "steps=4 / edges=4", st.steps === 4 && st.edges === 4, st);
t("DG-8b", "levels=3 / waves=3 / maxParallel=2", st.levels === 3 && st.waves === 3 && st.maxParallel === 2, st);
const st2 = graphStats([{ id: "g", type: STEP_TYPE.APPROVAL }, { id: "h", loop: { back_to: "g" } }]);
t("DG-8c", "gates=1 / loops=1", st2.gates === 1 && st2.loops === 1, st2);
t("DG-8d", "GATE_TYPES 含 approval 与 human_input",
	GATE_TYPES.indexOf(STEP_TYPE.APPROVAL) >= 0 && GATE_TYPES.indexOf(STEP_TYPE.HUMAN_INPUT) >= 0);

console.log("\n【H】🔴 条件求值（不用 eval）");
t("DG-9a", "exists 真", evalCondition("{{k}} exists", { k: "有" }).ok === true);
t("DG-9b", "exists 假（空串）", evalCondition("{{k}} exists", { k: "  " }).ok === false);
t("DG-9c", "contains 命中", evalCondition("{{k}} contains 技术", { k: "这是技术方案" }).ok === true);
t("DG-9d", "contains 未命中", evalCondition("{{k}} contains 技术", { k: "这是运营方案" }).ok === false);
t("DG-9e", "equals 全等（不是包含）", evalCondition("{{k}} equals 甲", { k: "甲" }).ok === true
	&& evalCondition("{{k}} equals 甲", { k: "甲乙" }).ok === false);
t("DG-9f", "取反 !", evalCondition("!{{k}} exists", { k: "" }).ok === true);
t("DG-9g", "🔴 变量缺失 → false 且 reason 说明（不静默当 true）",
	(() => { const r = evalCondition("{{nope}} exists", {}); return r.ok === false && r.reason.indexOf("不存在") >= 0; })(),
	evalCondition("{{nope}} exists", {}));
t("DG-9h", "变量缺失 + 取反 → true", evalCondition("!{{nope}} exists", {}).ok === true);
t("DG-9i", "空条件 → 执行", evalCondition("", {}).ok === true);
t("DG-9j", "语法不支持 → false 且指路支持的三种", evalCondition("{{k}} 大约等于 5", { k: "5" }).reason.indexOf("contains") >= 0);
t("DG-10a", "shouldRun：无条件 → 跑", shouldRun({ id: "a" }, {}).run === true);
t("DG-10b", "shouldRun：条件假 → 不跑并给理由",
	shouldRun({ id: "a", condition: "{{k}} contains 技术" }, { k: "运营" }).run === false);

console.log("\n【I】模板填充与引用");
const f1 = fillTemplate("分析 {{a}} 与 {{b}}", { a: "需求" });
t("DG-11a", "已命中占位被替换", f1.text.indexOf("需求") >= 0);
t("DG-11b", "🔴 未命中占位**原样保留**（不替换成空串）", f1.text.indexOf("{{b}}") >= 0, f1.text);
t("DG-11c", "未命中记进 missing", eq(f1.missing, ["b"]), f1.missing);
t("DG-11d", "null 模板 → 空串（不抛错）", fillTemplate(null, {}).text === "");
t("DG-12a", "refsOf 收 task 里的引用", eq(refsOf({ id: "a", task: "看 {{x}} 与 {{y}}" }), ["x", "y"]));
t("DG-12b", "refsOf 也收 condition 与 acceptance 里的引用",
	refsOf({ id: "a", task: "t", condition: "{{c}} exists", acceptance: "满足 {{d}}" }).sort().join(",") === "c,d");
t("DG-12c", "无引用 → 空数组", eq(refsOf({ id: "a", task: "纯文本" }), []));

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
