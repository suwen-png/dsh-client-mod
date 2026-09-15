#!/usr/bin/env node
/**
 * test-design-version.mjs —— 版本快照层**离线纯函数测试**（无需 Harness / 浏览器）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这个脚本守的是什么（一句话）
 * ──────────────────────────────────────────────────────────────────
 * 守「**保存的东西真的能原样回来**」。用户原话是「也没有保存 和不同版本的选择」——
 * 这类功能最典型的失败不是"按钮点不动"，而是：
 *   · 存了，但回滚回来的图**少了几个元素**（共享引用被后续编辑穿透改掉）
 *   · 存了，但**存的是引用**，之后拖一下把历史版本也一起改了
 *   · 超上限后**静默丢弃**，用户以为还在
 *   · 回滚把用户刚做的东西**不可逆地**清掉
 * 以上每一条都写成了断言（见 A3 / B6 / C2）。真机 e2e 证明"点了有用"，
 * 这一层证明"**语义是对的**"。
 *
 * ══════════════════════════════════════════════════════════════════
 * 覆盖范围
 * ──────────────────────────────────────────────────────────────────
 *  A. schema：版本对象结构 / 深拷贝 / 旧数据兼容
 *  B. store：保存 / 脏判定 / 限流淘汰
 *  C. store：回滚（含"回滚前自动存档"这条硬约束）
 *  D. store：版本删除 / 重命名 / 复制图 / 删图
 *  E. 安全区：窗口控件避让计算（Windows 原生按钮重叠的根治逻辑）
 *  F. 正负对照：同一判据在"该报"和"不该报"两侧都必须正确
 *
 * 用法：node scripts/test-design-version.mjs
 * 退出码：0 全绿 / 1 有失败（可直接做 CI 闸门）
 */

import {
	VERSION_LIMIT, createVersion, normalizeVersion, versionSummary,
	cloneElements, normalizeDoc, buildStandardFrame
} from "../src/store/design-schema.js";
import {
	resetDesignStore, newDoc, getActiveDoc, getState, getDoc, saveDoc,
	saveVersion, listVersions, restoreVersion, deleteVersion,
	renameDoc, duplicateDoc, deleteDoc, isDirty, getVersionState, sameElements,
	addElement, moveElement
} from "../src/store/design.js";
import { readInset, watchInset, FALLBACK_INSET } from "../src/util/safe-area.js";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}
function section(s) { console.log("\n" + s); }

console.log("═══════════════════════════════════════════════════════════");
console.log(" 设计图版本层 · 离线纯函数测试（保存 / 回滚 / 限流 / 安全区）");
console.log("═══════════════════════════════════════════════════════════");

/* ══ A. schema 层 ══ */
section("【A】schema · 版本对象与深拷贝");

t("A1", `VERSION_LIMIT = ${VERSION_LIMIT}（限流存在，否则 localStorage 5MB 会被吃满）`, VERSION_LIMIT === 30, VERSION_LIMIT);

const srcDoc = normalizeDoc({ docId: "src-doc", title: "源图", elements: buildStandardFrame("threeTab") });
const v1 = createVersion(srcDoc, { note: "第一版说明" });
t("A2", "createVersion 产出完整字段", !!(v1.vid && v1.label === "v1" && v1.savedAt && v1.elements.length === 20 && v1.count === 20),
	{ vid: v1.vid, label: v1.label, count: v1.count });

/* 🔴 核心断言：版本必须是**深拷贝**。
 * 若与工作副本共享元素对象，之后拖拽工作副本会**穿透改掉历史版本** ——
 * 表现为"回滚到 v1 却是最新的样子"，且不报任何错。 */
const beforeX = v1.elements[0].x;
srcDoc.elements[0].x = 999;
t("A3", "版本 elements 是深拷贝（改源不影响历史版本）", v1.elements[0].x === beforeX, { after: v1.elements[0].x, before: beforeX });

t("A4", "cloneElements 深拷贝且长度一致", cloneElements(srcDoc.elements).length === srcDoc.elements.length);
t("A5", "cloneElements 对 null 安全（返回空数组）", Array.isArray(cloneElements(null)) && cloneElements(null).length === 0);
t("A6", "normalizeVersion 拒绝无 vid 的坏版本", normalizeVersion({ elements: [] }) === null);
t("A7", "versionSummary 不含 elements（防大对象外泄）", versionSummary(v1).elements === undefined && versionSummary(v1).vid === v1.vid);
t("A8", "normalizeDoc 对旧数据（无 versions 字段）补空数组 —— 不伪造版本", (() => {
	const legacy = normalizeDoc({ docId: "legacy", title: "旧图", elements: buildStandardFrame() });
	return Array.isArray(legacy.versions) && legacy.versions.length === 0;
})());
t("A9", "旧数据在顶栏显示为「未保存」（诚实的显示，而不是假装有版本）",
	getVersionState(normalizeDoc({ docId: "legacy2", elements: buildStandardFrame() })).label === "未保存",
	getVersionState(normalizeDoc({ docId: "legacy3", elements: buildStandardFrame() })).label);

/* ══ B. store · 保存与脏判定 ══ */
section("【B】store · 保存 / 脏判定 / 限流");

resetDesignStore();
const d0 = newDoc({ title: "保存图" });
let cur = getActiveDoc();
t("B1", "新建图 versions 为空（= 从未保存）", (cur.versions || []).length === 0, (cur.versions || []).length);
t("B1b", "未保存且非空 ⇒ 脏（顶栏应显示「● 保存」）", isDirty(cur) === true);
t("B1c", "未保存时 getVersionState().label = 未保存", getVersionState(cur).label === "未保存");

const sv1 = saveVersion(cur, "第一次保存");
t("B2", "saveVersion 生成 v1 且落库", sv1 && sv1.version.label === "v1" && getDoc(d0.docId).versions.length === 1, sv1 && sv1.version);
t("B2b", "保存后不再脏", isDirty(sv1.doc) === false);
t("B2c", "已保存标签显示具体版本名", /已保存 v1/.test(getVersionState(sv1.doc).label), getVersionState(sv1.doc).label);

cur = sv1.doc;
/* 🔴 2026-09-14 修正（闸门过期，不是产品坏了 —— 先审尺子）：
 *    原判据 `cur.elements[0].id` 是**位置序**取元素，而 `elements[0]` 现在正是
 *    「整屏底板 window」，它在标准框架里**默认为锁定**（防误拖：拖了它会整图错位且不易察觉）
 *    ⇒ moveElement 是空操作 ⇒ 「改坐标后判为脏」假红。
 *    位置序从来不是判据，**可移动性**才是 ⇒ 显式挑第一个「未锁定且坐标确实会变」的元素。
 *    同时补一条**负对照**（B3c）：锁定元素移动后**不应**变脏 —— 这是锁定生效最直接的证据；
 *    没有它，"移动后变脏"与"锁定失效"两种状态在读数上分不开。 */
const mvTarget = cur.elements.find((e) => !e.locked && (e.x !== 100 || e.y !== 100));
const lockTarget = cur.elements.find((e) => e.locked);
const moved = mvTarget ? moveElement(cur, mvTarget.id, 100, 100) : cur;
t("B3", "改坐标后判为脏（移动对象 = 第一个未锁定且坐标会变的元素）",
	mvTarget !== undefined && isDirty(moved) === true, mvTarget && mvTarget.label);
t("B3b", "脏时标签为「未保存改动」（**不**假称「基于 v1」—— 基准版本可能不唯一）",
	getVersionState(moved).label === "未保存改动", getVersionState(moved).label);
t("B3c", "负对照：锁定元素（整屏底板）移动后**不**变脏 —— 锁定生效的直接证据",
	lockTarget !== undefined && isDirty(moveElement(cur, lockTarget.id, 100, 100)) === false,
	lockTarget && lockTarget.label);

const sv2 = saveVersion(moved, "移动后");
t("B4", "第二次保存生成 v2", sv2.version.label === "v2", sv2.version.label);
t("B4b", "listVersions 新的在前（列表第一项 = 最近保存）", listVersions(d0.docId)[0].label === "v2", listVersions(d0.docId).map((v) => v.label));

/* 限流：连存 31 次 → 封顶 30 且**报出淘汰数**（不静默） */
resetDesignStore();
const dl = newDoc({ title: "限流图" });
let cl = getActiveDoc();
let lastDrop = 0;
for (let i = 0; i < VERSION_LIMIT + 1; i++) {
	const r = saveVersion(cl, "n" + i);
	cl = r.doc;
	lastDrop = r.dropped;
}
t("B5", `连存 ${VERSION_LIMIT + 1} 次后版本数封顶 ${VERSION_LIMIT}`, getDoc(dl.docId).versions.length === VERSION_LIMIT, getDoc(dl.docId).versions.length);
t("B5b", "淘汰数如实上报（dropped = 1，不静默丢弃）", lastDrop === 1, lastDrop);
t("B5c", "被淘汰的是最旧的（保留的最后一版 note = n30）", getDoc(dl.docId).versions[VERSION_LIMIT - 1].note === "n30",
	getDoc(dl.docId).versions[VERSION_LIMIT - 1].note);

/* ══ C. store · 回滚 ══ */
section("【C】store · 回滚（含「回滚前自动存档」硬约束）");

resetDesignStore();
const dr = newDoc({ title: "回滚图" });
let cr = getActiveDoc();
const sA = saveVersion(cr, "底版");           // v1，20 元素
cr = sA.doc;
const idsInV1 = cr.elements.map((e) => e.id).join(",");
cr = saveDoc(addElement(cr, "button", {}));   // 21 元素（**未保存**的改动）
t("C1", "回滚前工作副本已是 21 元素（确有东西会被覆盖）", cr.elements.length === 21, cr.elements.length);

const rr = restoreVersion(dr.docId, sA.version.vid);
t("C2", "回滚把内容恢复为 v1 的 20 元素", rr && rr.doc.elements.length === 20, rr && rr.doc.elements.length);
t("C3", "回滚后元素 id 与版本完全一致（选中态/对话指称不飘）", rr.doc.elements.map((e) => e.id).join(",") === idsInV1);
t("C4", "🔴 回滚前自动存档（autoSaved = true）—— 否则用户刚做的 21 元素被不可逆清掉", rr.autoSaved === true, rr.autoSaved);
t("C4b", "自动存档的说明写明是它", rr.doc.versions[rr.doc.versions.length - 1].note === "回滚前自动存档",
	rr.doc.versions[rr.doc.versions.length - 1].note);
t("C4c", "存档后版本数 1 → 2（只追加，不覆盖回滚目标）", rr.doc.versions.length === 2, rr.doc.versions.length);
/* 🔴 C5 是真缺陷回归点（本测试第一次跑出 60/61，唯一红的就是它）：
 *    `restoreVersion` 会把回滚前的内容自动存成新版本（保护用户刚做的东西），
 *    于是"最后一个版本"不再是回滚目标 ⇒ 用"等于最后一版"判脏 ⇒
 *    **刚回滚完的界面被标成「有未保存改动」** ⇒ 用户以为回滚没生效，会再点一次。
 *    已把判据改为「当前内容是否存在于任一个版本里」。
 *    此处同时断言"内容对"和"提示对"两件事 —— 只断内容会漏掉提示骗人的那一半。 */
const afterRestore = getDoc(dr.docId);
t("C5a", "回滚后不再脏（内容 == 目标版本 v1）", isDirty(afterRestore) === false);
t("C5b", "🔴 回滚后顶栏显示「已保存 v1」，而非「未保存改动」（自动存档顶掉基准的回归）",
	/已保存 v1/.test(getVersionState(afterRestore).label), getVersionState(afterRestore).label);
t("C5c", "匹配到的版本就是回滚目标（matchVersion 从新到旧找，不被自动存档干扰）",
	(getVersionState(afterRestore).match || {}).label === "v1", getVersionState(afterRestore).match);
t("C6", "回滚到不存在的 vid → null（不静默改内容）", restoreVersion(dr.docId, "dv__nope__") === null);
t("C7", "回滚也推进 revision（内容变更就要记一笔）", getDoc(dr.docId).revision > sA.doc.revision, { after: getDoc(dr.docId).revision, before: sA.doc.revision });

/* 内容与最新版本一致时**不重复存档**（否则连点两次回滚会刷出重复版本） */
resetDesignStore();
const dn = newDoc({ title: "无变化回滚" });
let cn = getActiveDoc();
const sN = saveVersion(cn, "唯一版");
const rn = restoreVersion(dn.docId, sN.version.vid);
t("C8", "内容与最新版本一致时回滚不重复存档（autoSaved = false）", rn && rn.autoSaved === false, rn && rn.autoSaved);
t("C8b", "版本数保持 1（没有刷出重复版本）", getDoc(dn.docId).versions.length === 1, getDoc(dn.docId).versions.length);

/* ══ D. store · 图管理 ══ */
section("【D】store · 版本删除 / 重命名 / 复制图 / 删图");

resetDesignStore();
const dd = newDoc({ title: "管理图" });
let cd = getActiveDoc();
cd = saveVersion(cd, "v1").doc;
cd = saveVersion(cd, "v2").doc;
const vidToDel = cd.versions[0].vid;
deleteVersion(dd.docId, vidToDel);
t("D1", "deleteVersion 删掉指定版本", getDoc(dd.docId).versions.length === 1, getDoc(dd.docId).versions.length);
t("D1b", "删除不影响当前图内容（只删记录）", getDoc(dd.docId).elements.length === 20, getDoc(dd.docId).elements.length);
t("D2", "deleteVersion 对不存在的 vid 返回 null", deleteVersion(dd.docId, "dv__nope__") === null);

t("D3", "renameDoc 改名成功", renameDoc(dd.docId, "改过的名字").title === "改过的名字");
t("D4", "renameDoc 拒绝空名（不静默改成「未命名」）", renameDoc(dd.docId, "   ") === null && getDoc(dd.docId).title === "改过的名字", getDoc(dd.docId).title);
t("D5", "重命名**不动**版本（标题是身份，不参与内容快照）", getDoc(dd.docId).versions.length === 1);

const cp = duplicateDoc(dd.docId);
const origDoc = getDoc(dd.docId);
t("D6", "duplicateDoc 产生新 docId", cp && cp.docId !== origDoc.docId);
t("D6b", "副本元素内容与原图一致", cp.elements.length === origDoc.elements.length, [cp.elements.length, origDoc.elements.length]);
t("D6c", "副本**不带**版本历史（版本来源不含混）", (cp.versions || []).length === 0, (cp.versions || []).length);
t("D6d", "副本标题含「副本」", /副本/.test(cp.title), cp.title);
t("D6e", "副本成为当前图（切过去看得见）", getState().activeDocId === cp.docId, getState().activeDocId);

deleteDoc(cp.docId);
t("D7", "deleteDoc 删图后该图消失", getDoc(cp.docId) === null);

/* ══ E. 安全区（窗口控件避让）══ */
section("【E】安全区 · 窗口控件避让（用户报「关闭按钮重叠」的根治逻辑）");

const mockWco = (innerWidth, titlebarWidth, visible) => ({
	innerWidth,
	addEventListener() { /* noop */ },
	removeEventListener() { /* noop */ },
	document: { body: null, createElement: () => ({ style: {}, remove() { /* noop */ }, getBoundingClientRect: () => ({ width: 0 }) }) },
	navigator: {
		windowControlsOverlay: {
			visible,
			getTitlebarAreaRect: () => ({ x: 0, y: 0, width: titlebarWidth, height: 44 })
		}
	}
});

/* 负对照：不能因为"想让测试过"就把固定值写死 —— 换一组数字必须跟着变 */
const i1 = readInset(mockWco(1536, 1399, true));
const i2 = readInset(mockWco(1920, 1783, true));
t("E1", "WCO API 可用时：inset = 视口宽 − 标题栏宽（1536−1399=137，与真机实测一致）", i1 === 137, i1);
t("E2", "换一组数字仍成立（1920−1783=137，非写死常数）", i2 === 137, i2);
t("E3", "窗口变宽时 inset 跟着变（1600−1399=201）", readInset(mockWco(1600, 1399, true)) === 201, readInset(mockWco(1600, 1399, true)));
t("E4", "visible=false（如 macOS 交通灯隐藏）⇒ 0，不白留空白", readInset(mockWco(1536, 1399, false)) === 0, readInset(mockWco(1536, 1399, false)));
t("E5", "普通浏览器（无 WCO API、无 body）⇒ 0（不该凭空留 138px）", readInset({ innerWidth: 1200, navigator: {}, document: { body: null }, addEventListener() { /* noop */ } }) === 0);
t("E6", "无参数（Node/SSR）不抛错且返回 0", readInset() === 0 && readInset(null) === 0, readInset());
t("E7", "FALLBACK_INSET 为 Windows 三键实测宽（46×3）", FALLBACK_INSET === 138, FALLBACK_INSET);
t("E8", "watchInset 立即回调一次并返回可调用的取消函数", (() => {
	let n = 0, last = -1;
	const off = watchInset((v) => { n++; last = v; }, mockWco(1536, 1399, true));
	const ok = n === 1 && last === 137 && typeof off === "function";
	off();
	return ok;
})());
t("E9", "watchInset 对非法参数安全（不抛错）", typeof watchInset(null) === "function" && typeof watchInset(null, null) === "function");

/* ══ F. 正负对照（同一判据两侧都必须正确）══ */
section("【F】正负对照 · sameElements 判据");

const a1 = [{ id: "el-1-btn", kind: "button", x: 10, y: 20, w: 30, h: 40, z: 1, label: "A", logic: { trigger: "t", action: "a" } }];
const clone = (p) => [Object.assign({}, a1[0], p)];
const withLogic = (l) => [Object.assign({}, a1[0], { logic: l })];

t("F1", "负对照 · 完全相同 ⇒ 不脏", sameElements(a1, clone({})) === true);
t("F2", "负对照 · logic 键序不同 ⇒ 不脏（稳定序列化，否则每次读回都像改过）",
	sameElements(a1, withLogic({ action: "a", trigger: "t" })) === true);
t("F3", "正对照 · 坐标差 1px ⇒ 脏", sameElements(a1, clone({ x: 11 })) === false);
t("F4", "正对照 · label 变化 ⇒ 脏", sameElements(a1, clone({ label: "B" })) === false);
t("F5", "正对照 · logic 值变化 ⇒ 脏", sameElements(a1, withLogic({ trigger: "t", action: "a2" })) === false);
t("F6", "正对照 · 元素增减 ⇒ 脏", sameElements(a1, []) === false);
t("F7", "正对照 · 元素顺序变化 ⇒ 脏（顺序影响 z 观感，必须算差异）",
	sameElements([a1[0], a1[0]], [a1[0], Object.assign({}, a1[0], { x: 99 })]) === false);

/* ══ 汇总 ══ */
console.log("\n-----------------------------------------------");
console.log(`设计图版本层：${pass}/${pass + fail} 通过`);
if (fail) console.log("❌ 失败：" + failures.join(" | "));
console.log(`IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
process.exit(fail === 0 ? 0 : 1);
