#!/usr/bin/env node
/**
 * test-mindmap-logic.mjs —— 思维导图数据层**纯函数离线测试**（无需 Harness / 浏览器）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有一层离线测试（而不是全靠真机 e2e）
 * ──────────────────────────────────────────────────────────────────
 * 本轮改动的核心是「导图终于读到了宿主真值」这件事，而它有两个**离线就能钉死**的点：
 *   ① `normalizeSummary` 必须同时吃下宿主两种会话形状
 *      （`byId` 用 `id/parentId/displayTitle`，内部 `summaries` 用
 *       `sessionId/parentSessionId/title`）—— 只认一种的话真机上是**空树**，
 *      而空树在界面上看起来"只是没数据"，不像 bug。
 *   ② 状态必须随宿主字段**变化**（正负对照）：同一行 `running:true` → 执行中，
 *      把宿主字段拿掉 → 状态源变为「推断」。若两边结果一样，说明它又变回了
 *      那个"恒定不变的装饰"。
 * 真机 e2e（verify-mindmap.mjs）负责证明接线与命中；逻辑正确性在这里兜住。
 *
 * ══════════════════════════════════════════════════════════════════
 * 覆盖范围
 * ──────────────────────────────────────────────────────────────────
 *  A. 元素库完整性（节点四型 / 状态四态 + 一条显式不支持的「出错」/ 连线四类 / 控件 10 项 / 覆盖度 23 条）
 *  B. normalizeSummary：两种宿主形状 + 「没有这个事实」必须留 undefined
 *  C. buildBranchTree：血缘 / 深度 / 坐标 / 分类 / 状态（含**正负对照**）
 *  D. visibleRows / ancestorChain / treeBounds / matchRows
 *  E. 渲染辅助纯函数：edgePathFor / edgeStyleOf / metaLineOf / stateTitleOf
 *  F. 产物自证：`exports.inject` 必须含 sessions（静默降级的根因修复）
 *
 * 用法：node scripts/test-mindmap-logic.mjs
 * 退出码：0 全绿 / 1 有失败（可直接做 CI 闸门）
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	NODE_KINDS, STATE_KINDS, STATE_ORDER, EDGE_KINDS, CONTROL_KINDS, MM_COVERAGE, MM_SHORTCUTS,
	NODE_CONTROLS, controlsOfRow,
	kindOfNode, stateOfRow, hasHostState, marksOfRow, supportedStates, coverageStats, elementsByGroup, mmColor
} from "../src/store/mindmap-schema.js";
import {
	LAYOUT, normalizeSummary, buildBranchTree, visibleRows, ancestorChain, treeBounds, matchRows
} from "../src/logic/branch-tree.js";
import {
	edgePathFor, edgeStyleOf, metaLineOf, stateTitleOf, applyNodePos, draggedPos, nodeBtnStyle
} from "../src/logic/mindmap-render.js";

let pass = 0, fail = 0; const failures = [];
/* ══ 覆盖度总账的**期望值单点声明** ══════════════════════════════════
 * 🔴 为什么抽成常量：原先 A11 / A15 各硬写了一个 `18`，本轮总账从 18 条扩到 23 条
 *    （新增 E19–E23：单框折叠控件 / 框可拖动 / 点框开右侧面板 / 「现在在做的事」/ 四维流转）
 *    ⇒ 两个断言同时变红，而它们**表达的其实是同一个事实**。
 *    抽成常量后，以后扩账只改这一行，且 A11（结构：条数 + id 唯一）与
 *    A15（统计：done+todo+na=total 且 = 声明值）仍然各测一个维度，不会双双失真。 */
const COVERAGE_EXPECT = Object.freeze({ total: 23, done: 19, todo: 1, na: 3 });
function t(id, name, cond, detail) {
	if (cond) { pass++; } else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}
function section(s) { console.log("\n" + s); }

console.log("═══════════════════════════════════════════════════════════");
console.log(" 思维导图数据层 · 离线纯函数测试");
console.log("═══════════════════════════════════════════════════════════");

/* ══ A. 元素库完整性 ══ */
section("【A】思维导图元素库完整性");
t("A1", "节点四型齐备（中心主题 / 主分支 / 子分支 / 叶子）",
	Object.keys(NODE_KINDS).length === 4 && ["topic", "branch", "sub", "leaf"].every((k) => NODE_KINDS[k]), Object.keys(NODE_KINDS));
t("A2", "每个节点型都有 icon / accent / 判据 from（不可留空）",
	Object.values(NODE_KINDS).every((n) => n.icon && n.accent && String(n.from).trim()), Object.keys(NODE_KINDS));
t("A3", "状态共 5 条登记，其中「出错」显式标注 supported:false",
	Object.keys(STATE_KINDS).length === 5 && STATE_KINDS.err.supported === false, Object.keys(STATE_KINDS));
t("A4", "「出错」必须写明为什么不画（unsupportedReason 非空）",
	String(STATE_KINDS.err.unsupportedReason || "").length > 10, STATE_KINDS.err.unsupportedReason);
t("A5", "可渲染状态 = STATE_ORDER 四态，且**不含** err",
	supportedStates().length === 4 && !supportedStates().some((s) => s.key === "err"), supportedStates().map((s) => s.key));
t("A6", "每个可渲染状态都有 from（判据）与 color",
	supportedStates().every((s) => s.color && String(s.from).trim()), null);
t("A7", "连线四类齐备且各有语义（trunk/child/chain/ghost）",
	Object.keys(EDGE_KINDS).length === 4 && EDGE_KINDS.trunk.dash === null && EDGE_KINDS.child.dash, Object.keys(EDGE_KINDS));
t("A8", "主干实线 / 分支虚线（视觉区分必须有语义）",
	EDGE_KINDS.trunk.dash === null && typeof EDGE_KINDS.child.dash === "string", [EDGE_KINDS.trunk.dash, EDGE_KINDS.child.dash]);
t("A9", "控件登记 10 项且 testid 唯一",
	CONTROL_KINDS.length === 10 && new Set(CONTROL_KINDS.map((c) => c.testid)).size === 10, CONTROL_KINDS.length);
t("A10", "每个控件都有 desc（不能只有名字）",
	CONTROL_KINDS.every((c) => String(c.desc).trim().length > 6), null);
t("A11", "覆盖度总账 " + COVERAGE_EXPECT.total + " 条 / id 唯一",
	MM_COVERAGE.length === COVERAGE_EXPECT.total && new Set(MM_COVERAGE.map((c) => c.id)).size === COVERAGE_EXPECT.total, MM_COVERAGE.length);
t("A12", "覆盖度每条都有 evidence（打勾必须能给证据）",
	MM_COVERAGE.every((c) => String(c.evidence).trim().length > 6), null);
t("A13", "每条 na（明确不做）的 evidence 里必须出现理由关键词",
	MM_COVERAGE.filter((c) => c.state === "na").every((c) => /无|未暴露|不能|缺数据源|取证/.test(c.evidence)),
	MM_COVERAGE.filter((c) => c.state === "na").map((c) => c.id));
t("A14", "快捷键表非空且每条有 desc", MM_SHORTCUTS.length >= 5 && MM_SHORTCUTS.every((s) => s.key && s.desc), MM_SHORTCUTS.length);
const cvg = coverageStats();
t("A15", "覆盖面统计自洽（done + todo + na = total，且与声明值一致）",
	cvg.done + cvg.todo + cvg.na === cvg.total && cvg.total === COVERAGE_EXPECT.total
	&& cvg.done === COVERAGE_EXPECT.done && cvg.todo === COVERAGE_EXPECT.todo && cvg.na === COVERAGE_EXPECT.na, cvg);
t("A16", "分组聚合三组非空且总数 = 节点 4 + 控件 10 + 连线 4",
	(() => { const g = elementsByGroup(); const n = Object.values(g).reduce((a, b) => a + b.length, 0); return n === 18 && Object.keys(g).every((k) => g[k].length > 0); })(),
	Object.entries(elementsByGroup()).map(([k, v]) => k + ":" + v.length));
t("A17", "未知分组取色回落「骨架」而不是 undefined", mmColor("__nope__") === mmColor("骨架"), mmColor("__nope__"));

/* ══ B. normalizeSummary ══ */
section("【B】会话摘要规范化（宿主两种形状）");
const byIdShape = { id: "s-1", displayTitle: "设计稿评审", running: true, blank: false, updatedAt: 123, parentId: "s-0" };
const internalShape = { sessionId: "s-2", title: "评审 (1)", parentSessionId: "s-1", running: false, completed: true };
const n1 = normalizeSummary(byIdShape);
const n2 = normalizeSummary(internalShape);
t("B1", "byId 形状：id → sessionId", n1 && n1.sessionId === "s-1", n1);
t("B2", "byId 形状：parentId → parentSessionId", n1 && n1.parentSessionId === "s-0", n1);
t("B3", "byId 形状：displayTitle → title", n1 && n1.title === "设计稿评审", n1);
t("B4", "byId 形状：running 真值透传", n1 && n1.running === true, n1);
t("B5", "内部形状：sessionId / parentSessionId 原样", n2 && n2.sessionId === "s-2" && n2.parentSessionId === "s-1", n2);
t("B6", "内部形状：completed 真值透传", n2 && n2.completed === true, n2);
t("B7", "缺失的宿主字段**留 undefined**（不是 false / 不是 null）",
	n2 && n2.running === false && n2.blank === undefined && n2.pending === undefined, n2);
t("B8", "无 id 的输入返回 null（调用方须判空）", normalizeSummary({ title: "x" }) === null && normalizeSummary(null) === null);
t("B9", "根节点不产出 parentSessionId 字段（避免被当成有父）",
	!("parentSessionId" in normalizeSummary({ id: "r", parentId: undefined })), normalizeSummary({ id: "r" }));
t("B10", "pendingInteraction 字符串 → pending 原值；非字符串 → 占位 pending",
	normalizeSummary({ id: "p", pendingInteraction: "approval" }).pending === "approval" &&
	normalizeSummary({ id: "p", pendingInteraction: {} }).pending === "pending", null);

/* ══ C. buildBranchTree ══ */
section("【C】血缘树构建（含正负对照）");
const hostRows = [
	{ id: "root", displayTitle: "主线", running: false, blank: false, updatedAt: 10 },
	{ id: "a", displayTitle: "评审 (1)", parentId: "root", running: true, blank: false, updatedAt: 20 },
	{ id: "b", displayTitle: "评审 (2)", parentId: "root", running: false, completed: true, blank: false, updatedAt: 30 },
	{ id: "a1", displayTitle: "测试子分支", parentId: "a", running: false, blank: false, updatedAt: 40 },
	{ id: "orphan", displayTitle: "孤儿", parentId: "ghost", running: false, blank: false, updatedAt: 50 }
];
const T = buildBranchTree(hostRows, { currentId: "a" });
const rowOf = (id) => T.rows.find((r) => r.sessionId === id);
t("C1", "行数 = 输入会话数（含父不存在的孤儿，不丢行）", T.rows.length === 5, T.rows.map((r) => r.sessionId));
t("C2", "血缘可用（存在非 ws: 父边）", T.lineage === true, T.lineage);
t("C3", "深度正确：root 0 / a 1 / a1 2", rowOf("root").depth === 0 && rowOf("a").depth === 1 && rowOf("a1").depth === 2,
	[rowOf("root").depth, rowOf("a").depth, rowOf("a1").depth]);
/* 🔴 第 37 轮就地更正：本断言原先还要求 `a1.y !== a.y`，那是**旧布局的实现细节**
 *   （旧实现 y 随深度全局递增）。而设计稿《统一方案文档》§2.3 原定的是
 *   「**后序遍历，叶子分配纵向槽位，父节点居中于子节点**」—— 父居中下
 *   **单子链的父子必然同 y**（唯一子即中点），所以那句断言与设计直接冲突。
 *   ⇒ 保留真正有效的那半（**x 随深度线性递增**），y 的语义交给新闸门
 *     `test-mindmap-group`（MM-G1/G3/G4：父居中、单子链同 y、同深度不重叠）——
 *     即"把断言精确限定到它该管的那一层"，而不是放宽或删掉它。 */
t("C4", "坐标随深度递增（x = x0 + depth*dx；y 的语义见 test-mindmap-group 的 MM-G1/G3/G4）",
	rowOf("a1").x === LAYOUT.x0 + 2 * LAYOUT.dx && rowOf("a1").x === rowOf("a").x + LAYOUT.dx,
	[rowOf("a1").x, rowOf("a").x, rowOf("a").y, rowOf("a1").y]);
t("C5", "节点分类：root=topic / a=branch / a1=leaf", rowOf("root").kind === "topic" && rowOf("a").kind === "branch" && rowOf("a1").kind === "leaf",
	[rowOf("root").kind, rowOf("a").kind, rowOf("a1").kind]);
t("C6", "无父（父不存在）⇒ 当根而不是丢弃", rowOf("orphan").depth === 0 && rowOf("orphan").kind === "topic", rowOf("orphan"));
t("C7", "边数 = 3（root→a / root→b / a→a1；孤儿无父边）", T.edges.length === 3, T.edges);
t("C8", "当前会话标记只落在 currentId 上", rowOf("a").isCurrent === true && rowOf("b").isCurrent === false, null);

/* ── C 正负对照：宿主真值 vs 拿掉宿主字段 ── */
const hostStateRow = rowOf("a");     // running: true
const hostDoneRow = rowOf("b");      // completed: true
const hostIdleRow = rowOf("a1");     // 都没设 → idle，但 stateSource 是 host
t("C9", "【正】running:true → 执行中，状态源 = host",
	hostStateRow.state === "running" && hostStateRow.stateSource === "host", [hostStateRow.state, hostStateRow.stateSource]);
t("C10", "【正】completed:true → 已收口，状态源 = host",
	hostDoneRow.state === "done" && hostDoneRow.stateSource === "host", [hostDoneRow.state, hostDoneRow.stateSource]);
const noHost = buildBranchTree([{ sessionId: "x", title: "无字段" }, { sessionId: "y", title: "子", parentSessionId: "x" }]);
const noHostRows = noHost.rows;
t("C11", "【负】整组宿主字段缺失 → 状态源降为 inferred（不冒充真值）",
	noHostRows.every((r) => r.stateSource === "inferred"), noHostRows.map((r) => r.stateSource));
t("C12", "【负】同一份树：有真值 vs 无真值，stateSource 必须不同（证明真的在读）",
	hostStateRow.stateSource !== noHostRows[0].stateSource, [hostStateRow.stateSource, noHostRows[0].stateSource]);
const pendRow = buildBranchTree([{ id: "p", displayTitle: "等确认", running: true, pendingInteraction: "approval" }]).rows[0];
t("C13", "待审优先于执行中（同时成立时显示「在等你」）", pendRow.state === "review", pendRow.state);
t("C14", "环检测：自环不无限递归且被计数",
	(() => { const c = buildBranchTree([{ id: "c1", parentId: "c2" }, { id: "c2", parentId: "c1" }]); return c.cycles.length >= 1 && c.rows.length === 2; })(), null);
t("C15", "byId 形状整链可用（不是空树）—— 旧实现只认 sessionId 会得 0 行",
	buildBranchTree([byIdShape]).rows.length === 1, buildBranchTree([byIdShape]).rows.length);
t("C16", "空输入 / 非数组输入不抛错，返回空树",
	buildBranchTree(null).rows.length === 0 && buildBranchTree(undefined).edges.length === 0);

/* ══ D. 可见性 / 链 / 包围盒 / 搜索 ══ */
section("【D】可见性 · 祖先链 · 包围盒 · 搜索");
const collapsedRoot = visibleRows(T.rows, new Set(["root"]));
t("D1", "折叠 root ⇒ 后代全部隐藏（root + orphan 留下）",
	collapsedRoot.length === 2 && collapsedRoot.every((r) => r.sessionId === "root" || r.sessionId === "orphan"),
	collapsedRoot.map((r) => r.sessionId));
const collapsedA = visibleRows(T.rows, new Set(["a"]));
t("D2", "折叠中间节点 ⇒ 只隐藏它的子树（b 仍可见）",
	collapsedA.length === 4 && collapsedA.some((r) => r.sessionId === "b"), collapsedA.map((r) => r.sessionId));
t("D3", "折叠集合为空 ⇒ 返回原数组（零成本快路径）", visibleRows(T.rows, new Set()) === T.rows, null);
t("D4", "祖先链含自身与全部父（a1 → a1/a/root）",
	["a1", "a", "root"].every((k) => ancestorChain(T.rows, "a1").has(k)) && !ancestorChain(T.rows, "a1").has("b"),
	Array.from(ancestorChain(T.rows, "a1")));
t("D5", "祖先链对未知 id 返回空集（不抛）", ancestorChain(T.rows, "__nope__").size === 0);
t("D6", "包围盒覆盖全部行且含 pad",
	(() => { const b = treeBounds(T.rows); const maxX = Math.max(...T.rows.map((r) => r.x + LAYOUT.nodeW)); return b.w >= maxX - b.x && b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0; })(), treeBounds(T.rows));
t("D7", "空行集 ⇒ 包围盒回落画布最小尺寸（不是 0×0）",
	treeBounds([]).w === LAYOUT.minW && treeBounds([]).h === LAYOUT.minH, treeBounds([]));
t("D8", "搜索空串 ⇒ 返回 null（表示「未过滤」，而非「命中 0」）", matchRows(T.rows, "") === null && matchRows(T.rows, "  ") === null);
t("D9", "搜索按标题命中（大小写不敏感）", (() => { const m = matchRows(T.rows, "评审"); return m && m.size === 2; })(), matchRows(T.rows, "评审") && Array.from(matchRows(T.rows, "评审")));
t("D10", "搜索按会话号命中", (() => { const m = matchRows(T.rows, "a1"); return m && m.has("a1"); })(), null);

/* ══ E. 渲染辅助纯函数 ══ */
section("【E】渲染辅助纯函数");
const eTrunk = edgePathFor(rowOf("root"), rowOf("a"), 1, false);
const eChild = edgePathFor(rowOf("a"), rowOf("a1"), 2, false);
const eChain = edgePathFor(rowOf("root"), rowOf("a"), 1, true);
t("E1", "连线是三次贝塞尔（d 里含 C 命令）", /^M[\d.,]+ C/.test(eTrunk.d), eTrunk.d);
t("E2", "深度 1 → 主干（trunk）", eTrunk.kind === "trunk", eTrunk.kind);
t("E3", "深度 ≥2 → 分支（child）", eChild.kind === "child", eChild.kind);
t("E4", "在选中链上 → chain（高亮压倒主干/分支）", eChain.kind === "chain", eChain.kind);
t("E5", "主干实线 / 分支虚线（样式的 dash 与语义表一致）",
	edgeStyleOf("trunk").strokeDasharray === undefined && edgeStyleOf("child").strokeDasharray === EDGE_KINDS.child.dash,
	[edgeStyleOf("trunk").strokeDasharray, edgeStyleOf("child").strokeDasharray]);
t("E6", "未知连线类型回落 child 而不是崩",
	edgeStyleOf("__nope__").stroke === EDGE_KINDS.child.stroke, edgeStyleOf("__nope__"));
t("E7", "起点贴父节点右缘 / 终点贴子节点左缘",
	eTrunk.d.indexOf("M" + (rowOf("root").x + LAYOUT.nodeW)) === 0 && eTrunk.d.indexOf(" " + rowOf("a").x + ",") > 0, eTrunk.d);
t("E8", "metaLineOf 有据徽标优先（含「子 N」）", /子 2/.test(metaLineOf(rowOf("root"))), metaLineOf(rowOf("root")));
t("E9", "metaLineOf 无任何徽标时退回「层 N」（不写「未知」）", /^层 2$/.test(metaLineOf(rowOf("a1"))), metaLineOf(rowOf("a1")));
t("E10", "stateTitleOf 标注状态源（host ⇒ 宿主快照）",
	/宿主快照/.test(stateTitleOf(hostStateRow)) && /推断/.test(stateTitleOf(noHostRows[0])), [stateTitleOf(hostStateRow)]);
t("E11", "stateOfRow 对 null 安全（返回 idle）", stateOfRow(null) === "idle" && hasHostState(null) === false);

/* ══ F. 产物自证（静默降级的根因修复） ══ */
section("【F】产物自证 —— inject 必须声明 sessions");
let bundle = "";
try { bundle = readFileSync(resolve(import.meta.dirname, "../lib/client.js"), "utf8"); } catch (e) { bundle = ""; }
t("F1", "产物存在（lib/client.js）", bundle.length > 100000, bundle.length);
t("F2", "exports.inject 含 sessions（缺它 ⇒ ctx.sessions 抛错 ⇒ 血缘静默降级）",
	/var inject = \["slots", "sessions"\];/.test(bundle), (bundle.match(/var inject = \[[^\]]*\]/) || [])[0]);
const mmSource = readFileSync(resolve(import.meta.dirname, "../src/logic/branch-tree.js"), "utf8");
t("F3", "读取 sessions 走两级兜底（ctx.sessions → ctx.get）",
	/ctx\.sessions/.test(mmSource) && /ctx\.get\("sessions"\)/.test(mmSource), null);
t("F4", "降级原因写入 diag（不再无声）", /d\.error\s*=/.test(mmSource) && /degradationReason/.test(mmSource), null);
t("F5", "菜单禁止出现「无接口的假动作」：合并 / 删除必须 enabled:false",
	/merge: false/.test(mmSource) && /remove: false/.test(mmSource), null);

/* ══ G. 单框控件 / 自由拖动 / 连线跟随（2026-09-12 第三轮新增） ══
 *  用户三条原话逐条对应：
 *   ①「思维导图的单个框没有展开和折叠的选项」→ G1–G8
 *   ②「思维导图的框不能动需要可以移动」      → G9–G16
 *   ③（隐含）移动之后**连线不能脱节**        → G17–G19
 *  每条都做**正负对照**：能力给足 / 抽掉，结果必须不同（否则等于没接线）。 */
section("【G】单框控件 · 自由拖动 · 连线跟随");
t("G1", "单框控件表 5 项且 key 唯一",
	NODE_CONTROLS.length === 5 && new Set(NODE_CONTROLS.map((c) => c.key)).size === 5, NODE_CONTROLS.map((c) => c.key));
t("G2", "每个控件都声明 needs（说明「什么时候才可用」）",
	NODE_CONTROLS.every((c) => String(c.needs || "").trim().length > 3), null);
const rowNoKids = { sessionId: "x_", title: "叶子", childrenCount: 0, x: 0, y: 0 };
const rowKids = { sessionId: "y_", title: "有子", childrenCount: 3, x: 0, y: 0 };
const cNoKids = controlsOfRow(rowNoKids, { fork: false, open: false });
const cKids = controlsOfRow(rowKids, { fork: true, open: true });
const pick = (list, k) => list.find((c) => c.key === k);
t("G3", "【负】无子节点的框：toggle 仍然渲染但 enabled=false（不是「悄悄不渲染」）",
	pick(cNoKids, "toggle").enabled === false, pick(cNoKids, "toggle"));
t("G4", "【负】禁用时必须写明原因（含「没有子会话」字样，用户才知道这不是坏了）",
	/没有子会话/.test(pick(cNoKids, "toggle").why), pick(cNoKids, "toggle").why);
t("G5", "【正】有子节点的框：toggle enabled=true（同一份数据两种输入 → 证明判据接了真值）",
	pick(cKids, "toggle").enabled === true, pick(cKids, "toggle"));
t("G6", "【正负对照】fork / open 随宿主能力变化（给足=可用 / 抽掉=禁用且写明缺什么）",
	pick(cKids, "fork").enabled === true && pick(cNoKids, "fork").enabled === false
	&& /未暴露/.test(pick(cNoKids, "fork").why), null);
t("G7", "toggle 有独立的折叠态图标（alt !== icon，否则折叠了也看不出来）",
	(() => { const tg = NODE_CONTROLS.find((c) => c.key === "toggle"); const out = controlsOfRow(rowKids, {});
		return Boolean(tg.alt) && tg.alt !== tg.icon && pick(out, "toggle").alt === tg.alt; })(), null);
t("G8", "detail（右侧展开对话）与 move（拖动）永远可用 —— 不依赖宿主任何写接口",
	pick(controlsOfRow(rowNoKids, {}), "detail").enabled === true
	&& pick(controlsOfRow(rowNoKids, {}), "move").enabled === true, null);

/* 拖动：位置由插件侧持久化（layout.mmPos），**绝不改血缘** —— 这是「能移动」与「别把树搞坏」的边界 */
const before = T.rows;
t("G9", "没拖过任何节点时 applyNodePos 返回原数组引用（零成本快路径，不是逐行拷贝）",
	applyNodePos(before, {}) === before && applyNodePos(before, null) === before, null);
const movedRows = applyNodePos(before, { a: { x: 999.5, y: 888.5 } });
const movedARow = movedRows.find((r) => r.sessionId === "a");
t("G10", "拖过的节点：x / y 被替换且打上 moved 标记",
	movedARow.x === 999.5 && movedARow.y === 888.5 && movedARow.moved === true, [movedARow.x, movedARow.y, movedARow.moved]);
t("G11", "🔴 拖动不动血缘：sessionId / parentSessionId / childrenCount 全部原样",
	movedARow.sessionId === "a" && movedARow.parentSessionId === rowOf("a").parentSessionId
	&& movedARow.childrenCount === rowOf("a").childrenCount, null);
t("G12", "未拖过的行原样返回（不误伤同批其它行）",
	movedRows.find((r) => r.sessionId === "b").x === rowOf("b").x, null);
t("G13", "【负】坐标脏数据（非数字）⇒ 该行原样保留，不产出 NaN 坐标",
	(() => { const r = applyNodePos(before, { a: { x: "zzz", y: null } }).find((x) => x.sessionId === "a");
		return r.x === rowOf("a").x; })(), null);
t("G14", "拖动位移按缩放换算（zoom=2 ⇒ 屏幕 200px 在画布上只走 100）",
	(() => { const p = draggedPos({ x: 0, y: 0 }, 200, 100, 2); return p.x === 100 && p.y === 50; })(),
	draggedPos({ x: 0, y: 0 }, 200, 100, 2));
t("G15", "拖动边界夹紧：不越左上（夹到 0）也不越右下（夹到边界宽高）—— 防拖出画布丢失",
	(() => { const a = draggedPos({ x: 10, y: 10 }, -500, -500, 1);
		const b = draggedPos({ x: 0, y: 0 }, 999999, 999999, 1, { w: 1000, h: 800 });
		return a.x === 0 && a.y === 0 && b.x === 1000 && b.y === 800; })(), null);
t("G16", "【负】zoom 为 0 时按 1 处理（不产出 Infinity 坐标）",
	(() => { const p = draggedPos({ x: 5, y: 5 }, 10, 10, 0); return Number.isFinite(p.x) && p.x === 15; })(),
	draggedPos({ x: 5, y: 5 }, 10, 10, 0));

/* 连线跟随：edgePathFor 两端**从行的真实坐标算**（若写死指数坐标，拖动后线会脱节） */
t("G17", "连线不为空（否则下面两条是「平凡真」）", T.edges.length > 0, T.edges.length);
t("G18", "🔴 移动后连线端点跟着走（起点 = 移动后那一行的 x + 框宽）",
	(() => {
		const e0 = T.edges[0];
		const r1 = T.rows.find((r) => r.sessionId === e0.from);
		const r2 = T.rows.find((r) => r.sessionId === e0.to);
		const posRows = applyNodePos(T.rows, { [e0.from]: { x: r1.x + 300, y: r1.y + 120 } });
		const r1m = posRows.find((r) => r.sessionId === e0.from);
		const e1 = edgePathFor(r1, r2, 1, false, "curve");
		const e2 = edgePathFor(r1m, r2, 1, false, "curve");
		return (e1.x1 !== e2.x1 || e1.y1 !== e2.y1) && e2.x1 === r1m.x + LAYOUT.nodeW;
	})(), null);
t("G19", "连线两式：elbow 走折线（含 L 不含 C）/ curve 走三次贝塞尔（含 C 不含 L）",
	(() => { const A2 = { x: 0, y: 0 }, B2 = { x: 400, y: 200 };
		const el = edgePathFor(A2, B2, 1, false, "elbow");
		const cv = edgePathFor(A2, B2, 1, false, "curve");
		return /L/.test(el.d) && !/C/.test(el.d) && /C/.test(cv.d) && !/L/.test(cv.d); })(), null);
t("G20", "LAYOUT 已放大到能容纳「标题 + 控件行」（nodeW ≥ 224 / nodeH ≥ 72）",
	LAYOUT.nodeW >= 224 && LAYOUT.nodeH >= 72, [LAYOUT.nodeW, LAYOUT.nodeH]);
t("G21", "框上控件禁用态有明确视觉（opacity < 1 且 cursor 不是 pointer）",
	(() => { const d = nodeBtnStyle(false, false); return d.opacity < 1 && d.cursor !== "pointer"; })(), null);
t("G22", "🔴 框上控件颜色走 CSS 变量（个性化改色能生效，不是硬编码色值）",
	(() => { const s = nodeBtnStyle(true, true);
		return /var\(--dp-/.test(s.border) && /var\(--dp-/.test(s.background) && /var\(--dp-/.test(s.color); })(),
	nodeBtnStyle(true, true));

/* ══ 汇总 ══ */
console.log("\n───────────────────────────────────────────────");
console.log(` 通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log(" 失败项：\n   - " + failures.join("\n   - ")); }
console.log(` IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("───────────────────────────────────────────────");
process.exit(fail === 0 ? 0 : 1);
