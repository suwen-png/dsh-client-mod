#!/usr/bin/env node
/**
 * test-flow-logic.mjs —— 四维流转**纯函数离线测试** + 总监页折叠持久化（无需 Harness / 浏览器）
 *
 * ──────────────────────────────────────────────────────────────────
 * 为什么单独有一层（而不是全靠真机 verify-flow）
 *   V17 P3 新增「跨界面流转同步反馈」：FloatDock 未读小红点、目标浮层打开时的
 *   「已同步到 X」轻提示，全部依赖三个纯函数判定 —— lastFlowIdFor / hasNewFlowFor /
 *   flowOrigin。判定错（把自己发起的也算未读、把历史旧账当新消息）在真机上只是
 *   「红点莫名亮 / 不该弹提示」，不像崩溃那样扎眼，故离线钉死。
 *   同批：总监页 R2/R4/R6 折叠偏好从易失本地 state 迁到 layout store 持久化，
 *   这里验证 setSectionCollapsed 的合法/非法键与不串键。
 *
 * 用法：node scripts/test-flow-logic.mjs
 * 退出码：0 全绿 / 1 有失败（CI 闸门）/ 2 配置错误
 */
import {
	DIM, makeFlow, hopFlow, flowDims, flowLine,
	flowOrigin, lastFlowIdFor, hasNewFlowFor
} from "../src/logic/flow.js";
import { createDirectorLayoutStore } from "../src/store/layout.js";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; } else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}

/* 构造两条不同 id 的流转（at 不同 ⇒ flowId 不同） */
const f1 = makeFlow({ text: "第一条", origin: DIM.DIRECTOR, at: 1000 });
const f1m = hopFlow(f1, DIM.MINDMAP, "送到导图", { at: 1100 });
const f2 = makeFlow({ text: "第二条", origin: DIM.MINDMAP, at: 2000 });
const f2d = hopFlow(f2, DIM.DESIGN, "送到设计图", { at: 2100 });
const f3 = makeFlow({ text: "第三条只在总监", origin: DIM.DIRECTOR, at: 3000 });

console.log("A. flowOrigin（发起维度 = trail 第一跳，hop 不改）");
t("A1", "makeFlow 的 origin 即第一跳维度", flowOrigin(f1) === DIM.DIRECTOR, flowOrigin(f1));
t("A2", "hop 到导图后 origin 仍是发起方总监", flowOrigin(f1m) === DIM.DIRECTOR, flowOrigin(f1m));
t("A3", "空/坏输入返回 null 不抛", flowOrigin(null) === null && flowOrigin({}) === null);

console.log("B. flowDims / flowLine 足迹");
t("B1", "f1m 走过 总监→导图 两维", (() => { const d = flowDims(f1m); return d.length === 2 && d[0] === DIM.DIRECTOR && d[1] === DIM.MINDMAP; })(), flowDims(f1m));
t("B2", "流转线人类可读", flowLine(f1m) === "总监 → 思维导图", flowLine(f1m));
t("B3", "坏输入 flowDims 返回空数组、flowLine 回落 —", Array.isArray(flowDims(null)) && flowDims(null).length === 0 && flowLine(null) === "—");

console.log("C. lastFlowIdFor（最新一条到达某维的 id）");
t("C1", "空数组返回 null", lastFlowIdFor([], DIM.MINDMAP) === null);
t("C2", "非数组也安全返回 null", lastFlowIdFor(null, DIM.MINDMAP) === null);
t("C3", "取最新一条到达导图的 id = f1m（f2 也起源导图，但列表顺序 f1m 在前 f2 在后 ⇒ 应是 f2）",
	lastFlowIdFor([f1m, f2d, f3], DIM.MINDMAP) === f2.flowId, lastFlowIdFor([f1m, f2d, f3], DIM.MINDMAP));
t("C4", "只到过总监的列表，问设计图返回 null", lastFlowIdFor([f1, f3], DIM.DESIGN) === null);
t("C5", "f2d 足迹含设计图，问设计图命中 f2d", lastFlowIdFor([f1m, f2d], DIM.DESIGN) === f2d.flowId);

console.log("D. hasNewFlowFor（未读判定：比 seenId 新且到达该维）");
t("D1", "seenId 已是最新 ⇒ 无未读", hasNewFlowFor([f1m, f2d], DIM.MINDMAP, f2.flowId) === false);
t("D2", "seenId 停在 f1 ⇒ 导图有更新（f2 更新）", hasNewFlowFor([f1m, f2d], DIM.MINDMAP, f1.flowId) === true);
t("D3", "seenId=null 且存在该维流转 ⇒ 有未读", hasNewFlowFor([f1m], DIM.MINDMAP, null) === true);
t("D4", "该维从无流转 ⇒ 无未读", hasNewFlowFor([f3], DIM.MINDMAP, null) === false);
t("D5", "空列表 ⇒ 无未读不抛", hasNewFlowFor([], DIM.MINDMAP, null) === false);
t("D6", "🔴 自己发起不算别人的未读由调用方按 flowOrigin 过滤 —— 本函数只看足迹，f2 起源导图也命中导图维",
	hasNewFlowFor([f2], DIM.MINDMAP, f1.flowId) === true);

console.log("E. 总监页折叠偏好持久化（layout store，只增键不违反 R5）");
const store = createDirectorLayoutStore();
t("E1", "默认 sectionCollapsed 全展开（r2/r4/r6 皆 false）",
	(() => { const c = store.getState().sectionCollapsed; return c && c.r2 === false && c.r4 === false && c.r6 === false; })(), store.getState().sectionCollapsed);
const okR6 = store.setSectionCollapsed("r6", true);
t("E2", "setSectionCollapsed(r6,true) 返回 true 且仅 r6 折叠",
	okR6 === true && store.getState().sectionCollapsed.r6 === true
	&& store.getState().sectionCollapsed.r2 === false && store.getState().sectionCollapsed.r4 === false,
	store.getState().sectionCollapsed);
store.setSectionCollapsed("r2", true);
store.setSectionCollapsed("r2", false);
t("E3", "可反复切换回展开", store.getState().sectionCollapsed.r2 === false);
t("E4", "🔴 非法键被拒（返回 false 且不写入脏键）",
	store.setSectionCollapsed("r9", true) === false && !("r9" in store.getState().sectionCollapsed));
t("E5", "非布尔入参被 Boolean 归一", (() => { store.setSectionCollapsed("r4", 1); return store.getState().sectionCollapsed.r4 === true; })());
// 订阅者应被通知（驱动 UI 重渲染）
let notified = 0; const unsub = store.subscribe(() => { notified++; });
store.setSectionCollapsed("r4", false);
unsub();
t("E6", "折叠变更通知订阅者（UI 才能即时刷新）", notified === 1, notified);

/* ══ 汇总 ══ */
console.log("\n───────────────────────────────────────────────");
console.log(` 通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log(" 失败项：\n   - " + failures.join("\n   - ")); }
console.log(` IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("───────────────────────────────────────────────");
process.exit(fail === 0 ? 0 : 1);
