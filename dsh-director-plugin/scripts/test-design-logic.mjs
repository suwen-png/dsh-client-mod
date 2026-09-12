#!/usr/bin/env node
/**
 * test-design-logic.mjs —— 设计图数据层**纯函数离线测试**（无需 Harness / 浏览器）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有一层离线测试（而不是全靠真机 e2e）
 * ──────────────────────────────────────────────────────────────────
 * 真机 e2e（verify-design-studio.mjs）能证明"点了有用"，但**慢且重**（要重启 Harness）。
 * 而本轮抓到的三个缺陷里有两个属于**纯逻辑**，离线一秒就能测出来：
 *   ① `parseDesignCommand` 把「左 30」算成 600px（魔法系数 STEP=20）
 *   ② 标准框架七元组不全（20/20 个元素缺字段）
 * 真机测试的价值在于"接线正确"；逻辑正确性用离线测试兜住，两者互补。
 *
 * ══════════════════════════════════════════════════════════════════
 * 覆盖范围
 * ──────────────────────────────────────────────────────────────────
 *  A. schema 完整性（18 类 / 七元组 / 标准框架 20 元素 / 可渲染）
 *  B. 元素操作：纯函数 + 不修改入参（不可变性）
 *  C. parseDesignCommand：七种指令 + 单位 + 多条 + 未识别
 *  D. applyOps：单次遍历语义
 *
 * 用法：node scripts/test-design-logic.mjs
 * 退出码：0 全绿 / 1 有失败（可直接做 CI 闸门）
 */
import {
	ELEMENT_KINDS, ELEMENT_KIND_KEYS, LOGIC_FIELDS,
	buildStandardFrame, createElement, normalizeElement, isRenderable, hitTest,
	MIN_SIZE, CANVAS_W, CANVAS_H, emptyLogic,
	normalizeDoc, docStats   // 注意：这两个在 schema 层，design.js 只消费不转发
} from "../src/store/design-schema.js";
import {
	addElement, updateElement, moveElement, nudgeElement, resizeElement,
	removeElement, duplicateElement, reorderElement, updateLogic,
	visibleElements, parseDesignCommand, applyOps
} from "../src/store/design.js";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; } else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}
function section(s) { console.log("\n" + s); }

/* 构造一个测试用 doc（标准框架，20 元素） */
const baseDoc = normalizeDoc({
	docId: "test-doc", title: "测试图", revision: 0, thread: [],
	elements: buildStandardFrame("threeTab")
});
const KEYS = LOGIC_FIELDS.map((f) => f.key);
const firstOf = (kind) => baseDoc.elements.find((e) => e.kind === kind);

console.log("═══════════════════════════════════════════════════════════");
console.log(" 设计图数据层 · 离线纯函数测试");
console.log("═══════════════════════════════════════════════════════════");

/* ══ A. schema 完整性 ══ */
section("【A】schema 完整性");
t("A1", "ELEMENT_KINDS 共 18 类", ELEMENT_KIND_KEYS.length === 18, ELEMENT_KIND_KEYS.length);
t("A2", "LOGIC_FIELDS 为七元组", KEYS.length === 7, KEYS);
t("A3", "七元组键序固定", JSON.stringify(KEYS) === JSON.stringify(["trigger", "action", "state", "data", "fallback", "shortcut", "code"]), KEYS);
const kindIncomplete = ELEMENT_KIND_KEYS.filter((k) => !KEYS.every((f) => String((ELEMENT_KINDS[k].logic || {})[f] || "").trim()));
t("A4", "18 类默认逻辑七元组**均不留空**（fallback 亦不可空）", kindIncomplete.length === 0, kindIncomplete);
t("A5", "标准框架 = 20 个预置元素", baseDoc.elements.length === 20, baseDoc.elements.length);
const frameIncomplete = baseDoc.elements.filter((e) => !KEYS.every((f) => String((e.logic || {})[f] || "").trim()));
t("A6", "标准框架每元素七元组均不留空", frameIncomplete.length === 0, frameIncomplete.map((e) => e.id));
t("A7", "标准框架每元素可渲染", baseDoc.elements.every(isRenderable));
t("A8", "统计：逻辑缺口 = 0", docStats(baseDoc).missingLogic === 0, docStats(baseDoc));
t("A9", "几何常量自洽 (MIN_SIZE < CANVAS)", MIN_SIZE === 8 && CANVAS_W === 1180 && CANVAS_H === 644, [MIN_SIZE, CANVAS_W, CANVAS_H]);
t("A10", "createElement 未知 kind 返回 null（调用方须判空）", createElement("__nope__") === null);
t("A11", "normalizeElement 拒绝非法 kind", normalizeElement({ kind: "__nope__" }) === null);
t("A12", "emptyLogic 产出 7 个空字段", Object.keys(emptyLogic()).length === 7);

/* ══ B. 元素操作：正确性 + 不可变性 ══ */
section("【B】元素操作（纯函数 / 不修改入参）");
const snap = JSON.stringify(baseDoc);

const added = addElement(baseDoc, "button", {});
t("B1", "addElement 元素数 +1", added.elements.length === baseDoc.elements.length + 1);
t("B2", "addElement 不修改入参（不可变性）", JSON.stringify(baseDoc) === snap);
const newEl = added.elements[added.elements.length - 1];
t("B3", "addElement 新元素自带完整七元组", KEYS.every((k) => String(newEl.logic[k] || "").trim().length > 0));

const reg = firstOf("region");
const moved = moveElement(baseDoc, reg.id, 500, 300);
const movedEl = moved.elements.find((e) => e.id === reg.id);
t("B4", "moveElement 设为绝对坐标", movedEl.x === 500 && movedEl.y === 300, { x: movedEl.x, y: movedEl.y });
t("B5", "moveElement 不修改入参", JSON.stringify(baseDoc) === snap);
const nudged = nudgeElement(baseDoc, reg.id, -30, 10);
const nudgedEl = nudged.elements.find((e) => e.id === reg.id);
t("B6", "nudgeElement 是**相对**位移", nudgedEl.x === reg.x - 30 && nudgedEl.y === reg.y + 10, { from: [reg.x, reg.y], to: [nudgedEl.x, nudgedEl.y] });
const tiny = resizeElement(baseDoc, reg.id, 1, 1);
t("B7", "resizeElement 钳到 MIN_SIZE（不可零面积）", tiny.elements.find((e) => e.id === reg.id).w === MIN_SIZE, tiny.elements.find((e) => e.id === reg.id).w);
const neg = moveElement(baseDoc, reg.id, -999, -999);
t("B8", "moveElement 负坐标钳到 0", neg.elements.find((e) => e.id === reg.id).x === 0);
const removed = removeElement(baseDoc, reg.id);
t("B9", "removeElement 元素数 -1 且目标消失", removed.elements.length === baseDoc.elements.length - 1 && !removed.elements.some((e) => e.id === reg.id));
const dup = duplicateElement(baseDoc, reg.id);
const dupNew = dup.elements[dup.elements.length - 1];
t("B10", "duplicateElement 数量 +1 且 id 不撞原元素", dup.elements.length === baseDoc.elements.length + 1 && dupNew.id !== reg.id, dupNew.id);
const front = reorderElement(baseDoc, reg.id, "top");
const frontEl = front.elements.find((e) => e.id === reg.id);
t("B11", "reorderElement top → z 为最大值", frontEl.z >= Math.max(...front.elements.map((e) => e.z)), { z: frontEl.z });
const logicUpdated = updateLogic(baseDoc, reg.id, { action: "改过的行为" });
t("B12", "updateLogic 合并单字段且不动其他字段", logicUpdated.elements.find((e) => e.id === reg.id).logic.action === "改过的行为" && logicUpdated.elements.find((e) => e.id === reg.id).logic.trigger === reg.logic.trigger);
t("B13", "操作链全程不修改入参", JSON.stringify(baseDoc) === snap);
const hit = hitTest(baseDoc.elements, 250, 45);
t("B14", "hitTest 命中 z 最大者", !!hit && hit.id !== undefined, hit && hit.id);

/* ══ C. parseDesignCommand ══ */
section("【C】指令解析（本地规则 · 确定性）");
const P = (txt) => parseDesignCommand(baseDoc, txt);

// 🔴 单位回归断言：这一条正是本轮真机抓到的 600px 缺陷
const c1 = P(`移动 ${reg.id} 左 30`);
t("C1", "「左 30」= **30 像素**（回归：曾是 30×20=600）", c1.ops.length === 1 && c1.ops[0].args.dx === -30 && c1.ops[0].args.dy === 0, c1.ops);

const c2 = P(`移动 ${reg.id} 下`);
t("C2", "省略数字 → 默认 10px", c2.ops[0] && c2.ops[0].args.dy === 10, c2.ops);

const c3 = P(`删除 ${reg.id}`);
t("C3", "「删除」→ op=remove", c3.ops.length === 1 && c3.ops[0].op === "remove", c3.ops);

const c4 = P(`放大 ${reg.id} 50`);
const c4el = c4.ops[0];
t("C4", "「放大 50」→ 绝对尺寸 w+50（不是倍率）", c4el.op === "resize" && c4el.args.w === reg.w + 50, { w: c4el.args.w, orig: reg.w });

const c5 = P(`缩小 ${reg.id} 50`);
t("C5", "「缩小 50」→ w-50", c5.ops[0].args.w === reg.w - 50, c5.ops[0].args);

const c6 = P(`置顶 ${reg.id}`);
t("C6", "「置顶」→ op=reorder where=top", c6.ops[0].op === "reorder" && c6.ops[0].args.where === "top", c6.ops);

const c7 = P(`复制 ${reg.id}`);
t("C7", "「复制」→ op=duplicate", c7.ops[0].op === "duplicate", c7.ops);

const labelToken = reg.label;
const c8 = P(`改文案 ${reg.id} 为 新的名字`);
t("C8", "「改文案 X 为 Y」→ op=relabel", c8.ops[0].op === "relabel" && c8.ops[0].args.label === "新的名字", c8.ops);

const c9 = P(`移动 ${reg.id} 左 30；移动 ${reg.id} 下 20`);
t("C9", "「；」分隔多条 → 2 个 op", c9.ops.length === 2 && c9.ops[1].args.dy === 20, c9.ops);

const c10 = P("移动 不存在的元素 左 10");
t("C10", "指称不到元素 → 进 unresolved（不静默丢弃）", c10.ops.length === 0 && c10.unresolved.length === 1, c10);

const c11 = P("这是一句闲聊");
t("C11", "无法解析 → 全进 unresolved", c11.ops.length === 0 && c11.unresolved.length === 1, c11);

// 用 label（而非 id）指称——用户更可能这么写
const byLabel = P(`移动 ${labelToken} 左 30`);
t("C12", "可用**多词 label** 指称（「R1 顶部栏」这类）", byLabel.ops.length === 1 && byLabel.ops[0].target === reg.id, { label: labelToken, ops: byLabel.ops });

const c15 = P(`移动「${labelToken}」左 30`);
t("C15", "支持**引号包裹**的指称（「…」）", c15.ops.length === 1 && c15.ops[0].target === reg.id, c15.ops);

// 方向字碰撞：label 本身含「右」，不能被误当成分隔的方向
const dialogEl = baseDoc.elements.find((e) => String(e.label).includes("右"));
const c16 = P(`移动 ${dialogEl.label} 左 40`);
t("C16", "label 含方向字（如「右侧…」）不会被误切", c16.ops.length === 1 && c16.ops[0].target === dialogEl.id && c16.ops[0].args.dx === -40, { label: dialogEl.label, ops: c16.ops });

const c17 = P(`删除 ${labelToken}`);
t("C17", "「删除」也支持多词 label", c17.ops.length === 1 && c17.ops[0].target === reg.id, c17.ops);

const c13 = P(`移动 ${reg.id} 右 30；删除 ${reg.id}；置顶 ${reg.id}`);
t("C13", "三条指令 → 3 个 op（顺序保持）", c13.ops.length === 3 && c13.ops[0].op === "move" && c13.ops[1].op === "remove" && c13.ops[2].op === "reorder", c13.ops.map((o) => o.op));

t("C14", "空输入 → 空结果不抛", (() => { const r = P(""); return r.ops.length === 0 && r.unresolved.length === 0; })());

/* ══ D. applyOps ══ */
section("【D】applyOps（单次遍历 / 幂等）");
const d1 = applyOps(baseDoc, [{ op: "move", target: reg.id, args: { dx: 30, dy: 0 } }]);
t("D1", "move 生效", d1.elements.find((e) => e.id === reg.id).x === reg.x + 30);
t("D2", "applyOps 不修改入参", JSON.stringify(baseDoc) === snap);
const d3 = applyOps(baseDoc, [{ op: "resize", target: reg.id, args: { w: 300, h: 200 } }]);
t("D3", "resize 为**绝对值**", d3.elements.find((e) => e.id === reg.id).w === 300, d3.elements.find((e) => e.id === reg.id).w);
const d4 = applyOps(baseDoc, [{ op: "__unknown__", target: reg.id, args: {} }]);
t("D4", "未知 op 被忽略且不破坏文档", d4.elements.length === baseDoc.elements.length, d4.elements.length);
const d5 = applyOps(baseDoc, [null, { op: "move" }, { op: "move", target: reg.id, args: { dx: 5, dy: 0 } }]);
t("D5", "异常 op（null / 无 target）跳过，不抛", d5.elements.find((e) => e.id === reg.id).x === reg.x + 5);
// 端到端：解析 → 应用 走通
const chainDoc = applyOps(baseDoc, P(`移动 ${reg.id} 左 30`).ops);
t("D6", "解析→应用 串联：左移 30 落地", chainDoc.elements.find((e) => e.id === reg.id).x === reg.x - 30, { from: reg.x, to: chainDoc.elements.find((e) => e.id === reg.id).x });

/* ══ 汇总 ══ */
console.log("\n═══════════════════════════════════════════════════════════");
console.log(` 结果：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
if (fail) { console.log(" 未通过："); failures.forEach((f) => console.log("   " + f)); }
console.log("═══════════════════════════════════════════════════════════");
console.log(`IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}（fail=${fail}）`);
process.exit(fail === 0 ? 0 : 1);
