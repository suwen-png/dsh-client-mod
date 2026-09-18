#!/usr/bin/env node
/**
 * test-mindmap-group.mjs —— 导图「分区 + 父居中」离线闸门
 *
 * ══════════════════════════════════════════════════════════════════
 *  它在守什么（用户 2026-09-18 原话）
 * ══════════════════════════════════════════════════════════════════
 *  ①「比如根据 1 创建分支 2.3.4，那么 1 应该在中间」
 *  ②「按照项目分一个组 …… 再按照分支同一个分支的一个维度分组」
 *  ③「所有导图的节点都要允许拖拽」
 *
 *  ③ 由真机套件守（`verify-mindmap` 的 M-DRAG 组）—— 拖拽是真实鼠标事件，
 *  离线判不了；但本闸门守住一条**离线可判**的连带前提（分区框吃指针事件）。
  分区几何必须带 `pointerEvents:"none"` 的语义（见 `mindmap-group.js` 头注），
  否则分区框会吃掉指针事件 ⇒ "有些框拖不动"。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 校准（纪律 ⑥ / ⑫：新闸门必须证明"它真的会红"）
 * ══════════════════════════════════════════════════════════════════
 *  纯函数模块不便"注入缺陷"，所以校准对象是**判据本身**：拿**已知坏样本**
 *  喂同一个判据，必须判红。坏样本取**旧实现的真实形状**（父在最上）与
 *  **人为丢行**，不是凭空捏造 —— 否则校准只是"另一个永远绿的断言"。
 *
 *  用法：node scripts/test-mindmap-group.mjs      （零依赖，不需要 CDP / 应用）
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 C 组（下述）守一条**离线可判**的 ③ 连带前提
 * ══════════════════════════════════════════════════════════════════
 *  第 37 轮真机抓到：**分区平移把用户拖动的位置吸收掉了**。
 *  真机 C8 读数 `{"l":48,"t":44}` 到 `{"l":548,"t":44}`（X 动 500 / **Y 动 0**），
 *  看着像"拖拽只响应横向"，真因是 `shift = cursor - minY` 把用户 y 拉回了分区槽位。
 *  ⇒ 顺序铁律：**先按自动布局分区，再叠加用户位置**（`applyUserPos`）。
 */

import { buildBranchTree } from "../src/logic/branch-tree.js";
import { projectCandidates, projectKeyOf, normKey, UNGROUPED, NODIM, dimLabel } from "../src/logic/grouping.js";
import { buildGroups, applyUserPos } from "../src/logic/mindmap-group.js";

let pass = 0, fail = 0;
function t(id, desc, cond, ev) {
	if (cond) { pass += 1; console.log("  ✅ " + id + " " + desc); }
	else { fail += 1; console.log("  ❌ " + id + " " + desc + "\n       " + JSON.stringify(ev)); }
}

/* ══════════════════════════════════════════════════════════════════
 *  判据（独立成函数 ⇒ 才能拿坏样本校准）
 * ══════════════════════════════════════════════════════════════════ */

/** 拖动被保留：凡在 `posMap` 里的行，其 x/y 必须**等于**用户放置的值 */
function dragKeptOk(outRows, posMap, tol) {
	const e = Number.isFinite(tol) ? tol : 0.51;
	for (const r of (Array.isArray(outRows) ? outRows : [])) {
		const p = posMap && posMap[r.sessionId];
		if (!p) continue;
		if (Math.abs(r.x - p.x) > e || Math.abs(r.y - p.y) > e) return false;
	}
	return true;
}

/** 拖动不外溢：除被拖动的那一行外，其余行的 y 必须与基线**逐条相同**（拖一个不许动一群） */
function dragIsolatedOk(baseRows, outRows, draggedId) {
	const byId = new Map((outRows || []).map((r) => [r.sessionId, r]));
	for (const b of (baseRows || [])) {
		if (b.sessionId === draggedId) continue;
		const a = byId.get(b.sessionId);
		if (!a) return false;
		if (Math.abs(a.y - b.y) > 1e-6) return false;
	}
	return true;
}

/* ══════════════════════════════════════════════════════════════════
 *  判据（独立成函数 ⇒ 才能拿坏样本校准）
 * ══════════════════════════════════════════════════════════════════ */

/** 父居中：每个有子的行，其 y 必须等于「首子与末子 y 的中点」 */
function centeredOk(rows) {
	const list = Array.isArray(rows) ? rows : [];
	for (const r of list) {
		const kids = list.filter((k) => k.parentSessionId === r.sessionId);
		if (!kids.length) continue;
		const mid = (kids[0].y + kids[kids.length - 1].y) / 2;
		if (Math.abs(r.y - mid) > 1e-6) return false;
	}
	return true;
}

/** 同深度 y 严格递增 ⇒ 同列不重叠（父居中不会把两个同深度节点压到同一 y） */
function noOverlapOk(rows) {
	const last = new Map();
	for (const r of (Array.isArray(rows) ? rows : [])) {
		if (last.has(r.depth) && !(r.y > last.get(r.depth))) return false;
		last.set(r.depth, r.y);
	}
	return true;
}

/** 分区守恒：条数相同 且 sessionId 集合逐字相同（不丢不重 —— 兜底桶必须接住每一行） */
function conserveOk(inRows, outRows) {
	const a = (inRows || []).map((r) => String(r.sessionId)).sort();
	const b = (outRows || []).map((r) => String(r.sessionId)).sort();
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/* ══════════════════════════════════════════════════════════════════
 *  A 组 · 父居中（用户原话 ①）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n══ A 组 · 父居中（「1 应该在中间」）══");

const t1 = buildBranchTree([
	{ id: "1", title: "根", parentId: null },
	{ id: "2", title: "子2", parentId: "1" },
	{ id: "3", title: "子3", parentId: "1" },
	{ id: "4", title: "子4", parentId: "1" }
]);
const kids1 = t1.rows.filter((r) => r.depth === 1);
const root1 = t1.rows.find((r) => r.depth === 0);
t("MM-G1", "🔴 **用户原例**：1 分叉出 2/3/4 ⇒ 1 的 y **恰在** 2 与 4 的中点（旧实现它在最上面）",
	root1.y === (kids1[0].y + kids1[kids1.length - 1].y) / 2 && root1.y > kids1[0].y,
	{ root: root1.y, kids: kids1.map((k) => k.y) });
t("MM-G2", "🔴 父居中判据在**真树**上成立（遍历所有有子行，不只是根）",
	centeredOk(t1.rows), { rows: t1.rows.map((r) => [r.sessionId, r.y]) });

const t2 = buildBranchTree([
	{ id: "1", title: "根", parentId: null },
	{ id: "2", title: "A", parentId: "1" }, { id: "3", title: "B", parentId: "1" },
	{ id: "5", title: "A1", parentId: "2" }, { id: "6", title: "A2", parentId: "2" },
	{ id: "7", title: "A11", parentId: "5" }
]);
const a2 = t2.rows.find((r) => r.sessionId === "2");
const a21 = t2.rows.find((r) => r.sessionId === "5");
const a22 = t2.rows.find((r) => r.sessionId === "6");
t("MM-G3", "深层同样居中：A 在两个子 A1/A2 中间；单子链 A→A11 与子同 y（唯一子即中点）",
	Math.abs(a2.y - (a21.y + a22.y) / 2) < 1e-6
	&& Math.abs(t2.rows.find((r) => r.sessionId === "5").y - t2.rows.find((r) => r.sessionId === "7").y) < 1e-6,
	{ A: a2.y, A1: a21.y, A2: a22.y });
t("MM-G4", "🔴 同深度 y **严格递增** ⇒ 同列不重叠（父居中不会撞车）；叶子按 DFS 序占槽位",
	noOverlapOk(t2.rows) && kids1[0].y < kids1[1].y && kids1[1].y < kids1[2].y,
	{ kids: kids1.map((k) => k.y) });

/* ── 校准：旧的"父在最上"实现形状，喂同一判据必须判红 ── */
const LEGACY_ROWS = [
	{ sessionId: "1", parentSessionId: undefined, depth: 0, y: 44 },
	{ sessionId: "2", parentSessionId: "1", depth: 1, y: 140 },
	{ sessionId: "3", parentSessionId: "1", depth: 1, y: 236 },
	{ sessionId: "4", parentSessionId: "1", depth: 1, y: 332 }
];
t("MM-G5", "🔴 **植入缺陷校准**：拿**旧实现产物**（父在最上：根 44 / 子 140·236·332）喂判据 ⇒ **必须判红**",
	centeredOk(LEGACY_ROWS) === false, { centeredOk: centeredOk(LEGACY_ROWS), legacy: LEGACY_ROWS.map((r) => r.y) });

/* ══════════════════════════════════════════════════════════════════
 *  B 组 · 分区（用户原话 ②）—— fixture = 第 37 轮真机普查的**真实标题**
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n══ B 组 · 项目 / 维度分区 ══");

/** 真机 `_probe-session-census` 拿到的真实标题（28 条会话里的 26 条，逐字未改） */
const REAL_TITLES = [
	"灵能修仙全流程创作", "灵能修仙跨对话记忆蒸馏", "《灵能修仙》全流程一致性审查",
	"灵能修仙小说写作", "灵能修仙全流程开发", "灵能修仙全流程创作",
	"灵能修仙力量体系设计", "灵能修仙世界观搭建",
	"能跑么", "墟海项目正文章纲撰写", "15142", "15142",
	"墟海项目分线推进", "《墟海》项目分线推进", "墟海世界观搭建项目",
	"墟海力量体系设计", "墟海小说正文写作与多维推进", "《墟海》项目多线推进",
	"墟海剧情架构规划", "墟海力量体系设计启动", "墟海世界观构建启动",
	"《墟海》多维度创作推进", "《墟海》项目多维度推进", "墟海项目多维度推进",
	"《墟海》力量体系设计", "小说项目《墟海》多维度协作"
];
const realRows = REAL_TITLES.map((title, i) => ({
	sessionId: "s" + i, title, y: i * 96, h: 72, x: 48, depth: 0, parentSessionId: undefined
}));
const realOut = buildGroups(realRows, { width: 1400 });

const cands = projectCandidates(REAL_TITLES);
t("MM-G6", "🔴 候选集从真实措辞推出：**恰为** `灵能修仙` 与 `墟海`（手写清单会过期 —— 纪律 103）",
	cands.length === 2 && cands.indexOf("灵能修仙") >= 0 && cands.indexOf("墟海") >= 0,
	{ cands });

const projSec = realOut.sections.filter((s) => s.kind === "project");
const cnt = {};
for (const s of projSec) cnt[s.label] = s.count;
/* 🔴 判据**不钉总数**（第一版写了 7/4，实际 8/3 —— 而实现是对的，是手数错了）：
 *    "照着手工计数钉阈值"正是本项目刚登记过的坑（纪律 126 同源教训）。
 *    ⇒ 改为**逐条归属断言**（与规模无关）+ 排序关系断言，规模变化不会假红，
 *      而"归错了"仍必红。 */
const keyOf = (title) => projectKeyOf(title, cands);
t("MM-G7", "🔴 **归属正确（逐条，与规模无关）**：书名在**中部**的「小说项目《墟海》多维度协作」归墟海；纯自由文本归未归类",
	keyOf("小说项目《墟海》多维度协作") === "墟海"
	&& keyOf("《墟海》力量体系设计") === "墟海"
	&& keyOf("墟海剧情架构规划") === "墟海"
	&& keyOf("灵能修仙跨对话记忆蒸馏") === "灵能修仙"
	&& keyOf("《灵能修仙》全流程一致性审查") === "灵能修仙"
	&& keyOf("能跑么") === UNGROUPED
	&& keyOf("15142") === UNGROUPED,
	{ cnt, probe: [keyOf("小说项目《墟海》多维度协作"), keyOf("能跑么"), keyOf("15142")] });
t("MM-G21", "分组规模呈信息量降序（墟海 > 灵能修仙 > 未归类）—— 兜底桶不该抢头条",
	cnt["墟海"] > cnt["灵能修仙"] && cnt["灵能修仙"] > cnt["未归类"], { cnt });
t("MM-G8", "🔴 **行数守恒**：26 进 26 出、sessionId 集合逐字相同（兜底桶接住每一行，不静默丢）",
	conserveOk(realRows, realOut.rows) && realOut.rows.length === 26,
	{ in: realRows.length, out: realOut.rows.length, conserve: conserveOk(realRows, realOut.rows) });
t("MM-G9", "兜底桶恒**排最后**（信息量最大的项目在前；未归类不该抢头条）",
	projSec[projSec.length - 1].key === UNGROUPED && projSec[0].key !== UNGROUPED,
	{ order: projSec.map((s) => s.key) });
t("MM-G10", "组内**相对 y 顺序保持**（分区只平移，不重排上下关系）—— 每个项目组内 y 严格递增",
	projSec.every((s) => {
		const inP = realOut.rows.filter((r) => r.groupKey === s.key).map((r) => r.y);
		for (let i = 1; i < inP.length; i++) if (!(inP[i] > inP[i - 1])) return false;
		return true;
	}), {});

t("MM-G11", "🔴 **零维度不画二级**：真实数据 `splitDim` 命中 0 ⇒ 项目框 `dimsN=0` 且不存在可见维度分区（零信息分组 = 噪声）",
	projSec.every((s) => s.dimsN === 0)
	&& realOut.sections.filter((s) => s.kind === "dim" && s.hidden).length > 0
	&& realOut.sections.filter((s) => s.kind === "dim" && !s.hidden).length === 0,
	{ dimsN: projSec.map((s) => s.dimsN), stats: realOut.stats });
t("MM-G12", "「没画二级」与「算不出二级」可分辨：隐藏的维度 section 仍带 `key=NODIM`（纪律 58：没跑成 ≠ 失败）",
	realOut.sections.filter((s) => s.kind === "dim" && s.hidden).every((s) => s.key === NODIM), {});

/* ── 两本书不许互并（与 RU-T3 同源：投错对象比不分组更糟）── */
const twoBooks = projectCandidates(["《灵能修仙》世界观搭建", "《灵能修仙传》人物谱整理"]);
t("MM-G13", "🔴 **两本书不互并**：`《灵能修仙》` 与 `《灵能修仙传》` 必须**同时**留在候选集（RU-T3 同源铁律）",
	twoBooks.indexOf("灵能修仙") >= 0 && twoBooks.indexOf("灵能修仙传") >= 0, { twoBooks });

/* ── 没有书名号时仍要能分组（前缀兜底）── */
const noBook = projectCandidates(["青云志世界观梳理", "青云志人物关系", "山海经考据"]);
const noBookOut = buildGroups(
	["青云志世界观梳理", "青云志人物关系", "山海经考据"].map((title, i) => ({ sessionId: "n" + i, title, y: i * 96, h: 72 })),
	{ width: 800 }
);
const noBookProj = noBookOut.sections.filter((s) => s.kind === "project").map((s) => s.label);
t("MM-G14", "🔴 **一本都没写书名号**时仍能分组：取**最短**前缀 `青云志`（最长前缀会把同一项目按措辞拆散）",
	noBook.indexOf("青云志") >= 0 && noBook.indexOf("青云志世界观") < 0, { noBook });
t("MM-G15", "该场景下也确实分出「青云志 ×2」与「未归类 ×1」（不是全都落一个桶）",
	noBookProj.length === 2 && noBookOut.rows.length === 3, { noBookProj });

/* ── 有 splitDim 真值时，二级分区出现且优先于标题推断 ── */
const withDim = buildGroups([
	{ sessionId: "d1", title: "《墟海》世界观", y: 0, h: 72, splitDim: "A1" },
	{ sessionId: "d2", title: "《墟海》力量体系", y: 96, h: 72, splitDim: "A2" },
	{ sessionId: "d3", title: "《墟海》配角", y: 192, h: 72 }
], { width: 800 });
const visDim = withDim.sections.filter((s) => s.kind === "dim" && !s.hidden);
t("MM-G16", "🔴 **有真值时二级分区出现**：`splitDim` A1/A2 各成一块 + 一条 A 代码都没标的落「未分流」",
	visDim.length === 3 && visDim.some((s) => s.key === "a1") && visDim.some((s) => s.key === NODIM),
	{ visDim: visDim.map((s) => [s.key, s.source, s.count]) });
t("MM-G22", "🔴 **键与显示分离**：内部键恒小写 `a1`（真值与推断必须同键，否则同一维度裂成两块），显示回 `A1`（不让用户看见内部编码）",
	visDim.some((s) => s.key === "a1" && s.label === "A1"),
	{ pairs: visDim.map((s) => [s.key, s.label]) });
t("MM-G17", "维度来源可分辨：`splitDim` 来的标 `source=split`，标题推来的标 `source=title`（纪律 92）",
	withDim.sections.filter((s) => s.kind === "dim" && !s.hidden).some((s) => s.source === "split"),
	{ src: withDim.sections.filter((s) => s.kind === "dim" && !s.hidden).map((s) => s.source) });

/* ── 校准：坏样本必须判红 ── */
t("MM-G18", "🔴 **植入缺陷校准**：人为丢一行 ⇒ **守恒判据必须判红**（否则它只是另一个「永远绿」的空真）",
	conserveOk(realRows, realOut.rows.slice(1)) === false, {});
const emptyOut = buildGroups([], { width: 800 });
t("MM-G19", "🔴 **植入缺陷校准**：「零行 ⇒ 分区为空」与「26 行却不分区」必须**可分** —— 空真值不许冒充通过",
	emptyOut.sections.length === 0 && realOut.sections.length > 0,
	{ emptySections: emptyOut.sections.length, realSections: realOut.sections.length });
t("MM-G20", "归一化前提：`《墟海》` 与 `墟海` 归一化后**同串**（整套匹配能成立的根）",
	normKey("《墟海》") === normKey("墟海") && normKey("墟海项目 分线推进") === normKey("墟海项目分线推进"),
	{ a: normKey("《墟海》"), b: normKey("墟海") });

/* ══════════════════════════════════════════════════════════════════
 *  C 组 · 拖动位置必须被保留（③「所有导图的节点都要允许拖拽」）
 *  —— 第 37 轮真机抓到真缺陷后补的常驻闸门，机理见文件头注
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n══ C 组 · 拖动位置不被分区吸收（「所有节点都要能拖」）══");

/* 数据形状对齐真机：一个「单成员分区」（墟海只有一条未分流会话）
 * + 一个「多成员分区」（灵能修仙三条） */
const DRAG_BASE = [
	{ sessionId: "u1", title: "《墟海》世界观", x: 0, y: 0, w: 200, h: 72 },
	{ sessionId: "L1", title: "《灵能修仙》世界观", x: 0, y: 400, w: 200, h: 72 },
	{ sessionId: "L2", title: "《灵能修仙》人物谱", x: 200, y: 500, w: 200, h: 72 },
	{ sessionId: "L3", title: "《灵能修仙》力量体系", x: 400, y: 600, w: 200, h: 72 }
];
const autoGroups = buildGroups(DRAG_BASE, { width: 900, nodeH: 72 });
const autoY = new Map(autoGroups.rows.map((r) => [r.sessionId, r.y]));
t("MM-G23", "前提先立住：`墟海` 分区**只有一行**（单成员维度组 —— 正是「拖动被吸收」的形态，纪律 23）",
	autoGroups.stats.projN === 2 && autoGroups.rows.filter((r) => r.groupKey === "墟海").length === 1,
	{ stats: autoGroups.stats, keys: autoGroups.rows.map((r) => r.groupKey) });

/* ① 单成员分区：拖到哪就必须留在哪 —— 正是真机 C8 判红的形态 */
const POS1 = { u1: { x: 0, y: 900 } };
const out1 = applyUserPos(autoGroups.rows, POS1);
t("MM-G24", "🔴 **单成员分区拖动必须保留**：拖到 y=900 ⇒ 分区后仍是 y=900（旧实现在此被拉回槽位 ⇒ 「拖不动」）",
	dragKeptOk(out1, POS1),
	{ got: out1.find((r) => r.sessionId === "u1").y, want: 900, auto: autoY.get("u1") });

/* ② 多成员分区：拖一行不许带动同组其他行（拖的是组内 minY 那行 —— 唯一能让旧实现破坏隔离的形态） */
const POS2 = { L1: { x: 0, y: 1500 } };
const out2 = applyUserPos(autoGroups.rows, POS2);
t("MM-G25", "🔴 **拖一个不许动一群**：拖组内最上那行 `L1` ⇒ 同分区 `L2`/`L3` 的 y 与基线**逐条相同**",
	dragIsolatedOk(autoGroups.rows, out2, "L1"),
	{ base: autoGroups.rows.map((r) => r.sessionId + ":" + r.y), out: out2.map((r) => r.sessionId + ":" + r.y) });
t("MM-G26", "同场景下被拖的那行**确实动了**（否则 `dragIsolatedOk` 忽略 draggedId 也能通过 = 空真）",
	Math.abs(out2.find((r) => r.sessionId === "L1").y - autoY.get("L1")) > 100,
	{ got: out2.find((r) => r.sessionId === "L1").y, auto: autoY.get("L1") });

/* ③ 校准：拿**旧实现的真实顺序**（先并位置、再分区）当坏样本 ⇒ 判据必须判红 */
const legacyOrder = (baseRows, posMap) => buildGroups(applyUserPos(baseRows, posMap), { width: 900, nodeH: 72 });
const legacy1 = legacyOrder(DRAG_BASE, POS1);
const legacy2 = legacyOrder(DRAG_BASE, POS2);
const legacy1Y = legacy1.rows.find((r) => r.sessionId === "u1").y;
t("MM-G27", "🔴 **植入缺陷校准**：旧顺序（先并位置再分区）的产物喂同一判据 ⇒ **必须判红**（否则闸门只是另一个空真）",
	dragKeptOk(legacy1.rows, POS1) === false
	&& dragIsolatedOk(autoGroups.rows, legacy2.rows, "L1") === false
	&& Math.abs(legacy1Y - 900) > 100,
	{ legacy1Y, want: 900, legacy2: legacy2.rows.map((r) => r.sessionId + ":" + r.y) });

/* ④ 坏位置值防御：不许把 NaN 灌进渲染坐标（那会让整个画布塌成 0） */
const badPos = { u1: { x: NaN, y: 10 }, L1: { x: 1 }, L2: null, L3: { x: 5, y: "abc" } };
const outBad = applyUserPos(autoGroups.rows, badPos);
t("MM-G28", "🔴 坏位置值防御：`NaN` / 缺字段 / `null` / 非数字串一律**原样返回**，渲染坐标恒为有限数",
	outBad.every((r) => Number.isFinite(r.x) && Number.isFinite(r.y)) && conserveOk(autoGroups.rows, outBad),
	{ ys: outBad.map((r) => r.sessionId + ":" + r.y) });

/* ⑤ 纯函数契约：不改入参、未命中行返回原引用、命中行带 moved 标记 */
const dragBefore = JSON.stringify(DRAG_BASE);
const out3 = applyUserPos(DRAG_BASE, POS1);
t("MM-G29", "契约：`applyUserPos` **不修改入参**；未命中行**返回原引用**；命中行带 `moved:true`",
	JSON.stringify(DRAG_BASE) === dragBefore
	&& out3.find((r) => r.sessionId === "L2") === DRAG_BASE.find((r) => r.sessionId === "L2")
	&& out3.find((r) => r.sessionId === "u1").moved === true,
	{ changed: JSON.stringify(DRAG_BASE) !== dragBefore });

/* ⑥ 分组关闭时（调用方不分区）拖动同样保留 —— 开关只决定组织方式，不决定节点能不能动 */
t("MM-G30", "分组**关闭**时拖动同样保留（开关只决定组织方式，不决定节点能不能动）",
	dragKeptOk(applyUserPos(DRAG_BASE, POS1), POS1)
	&& applyUserPos(DRAG_BASE, null).length === DRAG_BASE.length,
	{});

console.log("\n═══════════════════════════════════════════════════════════");
/* ══════════════════════════════════════════════════════════════════
 *  D 组 · 维度显示名（第 37 轮 · 真机 1:1 截图暴露）
 *  截图实测分区标题写着 `chars · 1` / `plot · 1` —— 用户看到的是**内部英文 key**
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n══ D 组 · 维度显示名用中文（不让用户看见内部键）══");

const DIM_LB = { chars: "A4 人物", plot: "A3 剧情", world: "A1 世界观" };
const withLb = buildGroups([
	{ sessionId: "x1", title: "《墟海》人物线", y: 0, h: 72, splitDim: "chars" },
	{ sessionId: "x2", title: "《墟海》剧情线", y: 96, h: 72, splitDim: "plot" },
	{ sessionId: "x3", title: "《墟海》世界观线", y: 192, h: 72, splitDim: "world" }
], { width: 800, dimLabels: DIM_LB });
const lbs = withLb.sections.filter((s) => s.kind === "dim" && !s.hidden).map((s) => s.label);
t("MM-G31", "🔴 **显示名注入生效**：`splitDim=chars` 的分区标题显示「A4 人物」，不是内部键 `chars`",
	lbs.indexOf("A4 人物") >= 0 && lbs.indexOf("chars") < 0, { lbs });

const noLb = buildGroups([
	{ sessionId: "y1", title: "《墟海》人物线", y: 0, h: 72, splitDim: "chars" }
], { width: 800 });
t("MM-G32", "🔴 不注入时**不崩**且退回原键（这是**降级**，不是静默 —— 注入缺失要看得见）",
	noLb.sections.some((s) => s.kind === "dim" && s.label === "chars"), { n: noLb.sections.length });

t("MM-G33", "注入**不影响**代码式维度：`a1` 仍显示 `A1`（真值与推断同键同显示，纪律 126）",
	dimLabel("a1") === "A1" && dimLabel("a1", DIM_LB) === "A1" && dimLabel("A1", DIM_LB) === "A1",
	{ a: dimLabel("a1"), b: dimLabel("a1", DIM_LB) });

t("MM-G34", "兜底桶标签不受注入影响：仍未分流 `未分流`（不被英文键覆盖）",
	noLb.sections.filter((s) => s.kind === "dim").every((s) => s.key !== NODIM || s.label === "未分流"),
	{});

console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
console.log(fail === 0 ? "  IS_PASS: TRUE" : "  IS_PASS: FALSE");
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
