#!/usr/bin/env node
/**
 * test-r42-req.mjs —— 第 42 轮四条需求的**离线判据**（断言前缀 `R42-`）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须离线（而不是只跑真机）
 * ──────────────────────────────────────────────────────────────────
 *   本轮四条需求里有三条的**正确性**是"取值口径"问题，真机只能证明"接上了"：
 *     · 需求 2 —— 会话显示文本：真机上恰好都有 `displayTitle`，
 *       证明不了"没有 title 时会回落而不是显示空白"；
 *     · 需求 4 —— 工作区真实名：真机只覆盖**当前这台机器**的工作区形态
 *       （title 有值），覆盖不到"title 为空 ⇒ 回落 basename""尾部斜杠""反斜杠"；
 *     · 需求 3 —— 血缘链：真机上不会有**成环**的脏数据，而环正是最容易死循环的地方。
 *   ⇒ 取值规则一律用**构造样本**穷举（纪律 32 / 108：改了判据必须能红能绿）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 覆盖
 * ──────────────────────────────────────────────────────────────────
 *   R42-1 会话显示文本（需求 2）· R42-2 工作区真实名（需求 4）
 *   R42-3 别名集（需求 4 匹配面）· R42-4 侧栏匹配（nav-hook）
 *   R42-5 分支血缘链（需求 3）· R42-6 干跑开关（需求 1）
 *
 * 校准（纪律 32）：改 `src/logic/host-ctx.js` 让 `workspaceDisplayName` 变成
 *   "basename 优先" ⇒ `R42-2a` 必须红；让 `sessionDisplayName` 忽略 displayTitle
 *   ⇒ `R42-1a` 必须红。**套件本身不做校准分支**（校准要改被测实现，不是改判据）。
 *
 * 用法：node scripts/test-r42-req.mjs ｜ 退出码 0 全绿 / 1 有红
 */

import {
	setHostCtx, sessionIndex, sessionDisplayName, sessionParentId, sessionChain,
	workspaceDisplayName, workspaceAliases, pathBasename, workspaceNameById, workspaceEntities
} from "../src/logic/host-ctx.js";
import { directorScopeChain } from "../src/logic/director-inherit.js";
import { matchRowToNode, flattenTree } from "../src/bridge/nav-hook.js";
import { setDryRun, isDryRun } from "../src/bridge/chat-bridge.js";
import { readFileSync } from "node:fs";

let pass = 0;
const fails = [];
const ok = (id, cond, note) => {
	if (cond) { pass++; console.log("  ✅ " + id + (note ? "  " + note : "")); }
	else { fails.push(id); console.log("  ❌ " + id + "  " + (note || "")); }
};
const eq = (id, got, want, note) => ok(id, got === want, (note ? note + " ｜ " : "") + "实测=" + JSON.stringify(got) + " 期望=" + JSON.stringify(want));

/* ── 构造样本（**假 ctx** —— 真实形状按宿主源码取证，见 host-ctx.js 头注）── */
const SESSIONS = {
	x1: { id: "x1", displayTitle: "修复登录问题", parentId: null },
	x2: { id: "x2", displayTitle: "", parentId: "x1" },
	x3: { id: "x3", displayTitle: "分支 B", parentId: "x2" },
	c1: { id: "c1", displayTitle: "环 A", parentId: "c2" },
	c2: { id: "c2", displayTitle: "环 B", parentId: "c1" }
};
/* ⚠️ 样本设计：`w1` 的 **title 与 path 的 basename 必须不同名** ——
 *    否则"title 优先"与"basename 兜底"两种实现都得到同一结果，判据失去分辨力
 *    （本轮首版就踩了这个：`title` 与末段都叫 `dsh-client-mod` ⇒ 去重后只剩 2 个别名，
 *      两条断言假红。**是样本的错，不是实现的错** —— 记下来避免下次重犯）。 */
/* 🔴 工作区实体的**字段名照宿主**：宿主是 `workspaceId`（不是 `id`）——
 *   见 `dsh-client-runtime`：`buildGroup(workspace.workspaceId, workspace.workspaceId,
 *   workspace.path, Date.parse(workspace.createdAt), workspace.title, members, "account")`。
 *   首版样本写成 `id` ⇒ 离线全绿，而真机 `count` 恒为 0（实现读 `ws.id` 读不到、
 *   被 `continue` 跳过）—— **这是本轮第二次"样本形状失真导致假绿"**
 *   （第一次是 `workspaces.list` 被当成方法）。教训：**样本字段必须先照源码核对再写**。 */
const WS = [
	{ workspaceId: "w1", title: "总监驾驶舱", path: "D:\\hermes-data\\dsh-client-mod" },
	{ workspaceId: "w2", title: "", path: "D:/work/novels/虚海/" },
	{ workspaceId: "w3", title: "   ", path: "C:/a/b\\末段" }
];
/* 🔴 工作区服务的**形状必须照宿主真实形状造** —— 这是本轮最贵的教训之一：
 *   首版按 `{ list: () => WS }`（把 `list` 当方法）造样本 ⇒ 离线 36/36 全绿，
 *   而真机恒红（`ctx.workspaces.list 不是函数`）。**判据测了一个不存在的形状**，
 *   等于没测（与纪律 63「逐字节一致 ≠ 是新的」同族：形状错了，绿灯是假的）。
 *   真实形状（宿主源码 `WorkspaceRuntime`）：`list` 是 `createSnapshotStore(...)`
 *   的**字段**，数据在 `list.getSnapshot().items`。 */
const wsStore = (items) => ({
	list: {
		getSnapshot: () => ({
			items, archivedSessionIds: [], state: "ready", phase: "ready",
			error: null, baselinesReady: true, recentWorkspaceId: undefined
		})
	}
});
const fakeCtx = {
	get: (k) => (k === "sessions"
		? { list: { getSnapshot: () => ({ ids: Object.keys(SESSIONS), current: "x1", byId: SESSIONS }) } }
		: undefined),
	workspaces: wsStore(WS)
};

console.log("════ R42-1 会话显示文本（需求 2：会话ID ⇒ 会话文本）════");
setHostCtx(fakeCtx);
eq("R42-1a", sessionDisplayName("x1", () => "兜底"), "修复登录问题", "有 displayTitle ⇒ 用它");
ok("R42-1b", sessionDisplayName("x2", () => "会话 死8位") === "会话 死8位", "displayTitle 为空 ⇒ 回落 fallback（不得显示空白）");
eq("R42-1c", sessionDisplayName("x2", () => ""), "", "无 fallback ⇒ 空串（调用方自己决定）");
{
	const idx = sessionIndex();
	eq("R42-1d", sessionDisplayName("x3", () => "兜底", idx), "分支 B", "预建 index 生效（批量场景 O(N)）");
	eq("R42-1e", idx.size, 5, "index 覆盖全部会话");
}
setHostCtx(null);
eq("R42-1f", sessionDisplayName("x1", () => "兜底"), "兜底", "无 ctx ⇒ 回落（降级可见，不抛）");
eq("R42-1g", sessionIndex().size, 0, "无 ctx ⇒ 空 Map（不抛）");

console.log("════ R42-2 工作区真实名（需求 4：其他文件夹也要有总监弹窗）════");
setHostCtx(fakeCtx);
eq("R42-2a", workspaceDisplayName(WS[0]), "总监驾驶舱", "title 优先（宿主侧栏显示的就是它）");
eq("R42-2b", workspaceDisplayName(WS[1]), "虚海", "title 空 ⇒ 回落 basename（尾部斜杠已剥）");
eq("R42-2c", workspaceDisplayName(WS[2]), "末段", "title 只有空格 ⇒ 视为空 ⇒ basename（反斜杠也认）");
eq("R42-2d", workspaceDisplayName(null), null, "空实体 ⇒ null");
eq("R42-2e", pathBasename("D:\\a\\b\\"), "b", "pathBasename 剥尾部斜杠");
eq("R42-2f", pathBasename(""), "", "空路径 ⇒ 空串");
{
	const m = workspaceNameById();
	eq("R42-2g", m.get("w1"), "总监驾驶舱", "workspaceId ⇒ 真实名");
	eq("R42-2h", m.get("w2"), "虚海", "无 title 的也进映射");
}
setHostCtx(null);
eq("R42-2i", workspaceNameById().size, 0, "无 ctx ⇒ 空 Map（调用方回落旧名）");
/* R42-2i2 🔴 字段名以宿主为准 `workspaceId`；只有 `id` 的老形状仍作兼容回落 */
setHostCtx({ workspaces: wsStore([{ id: "legacy-id", title: "旧字段名", path: "C:/x/y" }]) });
eq("R42-2i2", workspaceNameById().get("legacy-id"), "旧字段名", "兼容：只有 `id` 的实体仍可读（回落分支）");
setHostCtx(null);
/* R42-2i3 🔴 **反证**：实体既无 `workspaceId` 也无 `id` ⇒ 必须**跳过**（不许退化成空串键） */
setHostCtx({ workspaces: wsStore([{ title: "无 id 实体", path: "C:/x/z" }]) });
eq("R42-2i3", workspaceNameById().size, 0, "无 id 字段 ⇒ 跳过（不得写入空串键污染映射）");
setHostCtx(null);
/* R42-2j 兼容分支：万一某版本 `list` 真是方法（老假设），仍要能读 —— 两条路径都不许删 */
setHostCtx({ workspaces: { list: () => WS } });
eq("R42-2j", workspaceNameById().get("w1"), "总监驾驶舱", "兼容：list 是函数的老形状仍可读");
setHostCtx(null);
/* R42-2k 🔴 反证：形状既不是快照 store 也不是函数 ⇒ 必须**降级且留因**（不许静默）
 *   —— 真机就是这么红的（`ctx.workspaces.list 不是函数`），当时降级**没有**出现在任何读数里，
 *      而是表现为"工作区名悄悄退回旧名"。这条专防那种静默。 */
{
	const d = {};
	const r = workspaceEntities({ workspaces: { list: {} } }, d);
	ok("R42-2k", r === null && !!d.error, "形状不对 ⇒ 降级返回 null 且 diag 留因：" + JSON.stringify(d));
}

console.log("════ R42-3 别名集（需求 4 的匹配面）════");
eq("R42-3a", workspaceAliases(WS[0], "工作区 dsh-clie").length, 3, "title + basename + 旧名");
ok("R42-3b", workspaceAliases(WS[1], "工作区 w2").indexOf("虚海") >= 0, "无 title 时仍含 basename");
ok("R42-3c", workspaceAliases(WS[0], "dsh-client-mod").length === 2, "别名去重（legacy 与 title 相同时不重复）");
eq("R42-3d", workspaceAliases(null, null).length, 0, "空实体 + 空旧名 ⇒ 空数组");

console.log("════ R42-4 侧栏匹配（nav-hook：点行文本 ⇒ 节点）════");
{
	const nodes = flattenTree({
		id: "root", name: "全局", level: "global", meta: {},
		childNodes: [{
			id: "ws_w1", name: "dsh-client-mod", level: "project", meta: { aliases: ["dsh-client-mod", "工作区 a11caaed"] },
			childNodes: []
		}, {
			id: "ws__ungrouped__", name: "未分组", level: "project", meta: { aliases: ["未分组", "Ungrouped"] },
			childNodes: []
		}]
	});
	eq("R42-4a", (matchRowToNode("dsh-client-mod", nodes) || {}).id, "ws_w1", "按 title 命中");
	eq("R42-4b", (matchRowToNode("工作区 a11caaed", nodes) || {}).id, "ws_w1", "按**旧名别名**命中（存量引用不破）");
	eq("R42-4c", (matchRowToNode("Ungrouped", nodes) || {}).id, "ws__ungrouped__", "未分组按宿主英文常量命中");
	eq("R42-4d", matchRowToNode("完全不相关的行文本", nodes), null, "负对照：无关文本**不**命中（判据没被放松）");
	eq("R42-4e", nodes.filter((n) => n.id === "ws_w1")[0].aliases.length, 2, "flattenTree 带出 aliases");
	/* ── 🔴 R42-4f/4g/4h/4i：**落库名过期、宿主名是此刻的**（第 42 轮决定性补丁）──
	 *  真机取证（`logs/_r42w-ws.out`）：页面就绪后宿主 `items` = `novels` / `workspace`，
	 *  而冷启动早期该服务是 `phase:"pending"`/空 ⇒ `discover()` 只能落库旧名
	 *  `工作区 a11caaed`。若匹配只认落库名，用户点侧栏的 `novels` **永远失配**
	 *  —— 这正是「只有『未分组』点得出弹窗」的成因（未分组是字面量常量，与时机无关）。 */
	setHostCtx({
		workspaces: wsStore([{ id: "a11caaed-1926-4572-85c2-889744833227", title: "novels", path: "D:\\workspace\\novels" }])
	});
	const nodes2 = flattenTree({
		id: "root", name: "全局", level: "global", meta: {},
		childNodes: [{
			id: "ws_a11caaed-1926-4572-85c2-889744833227", name: "工作区 a11caaed", level: "project",
			meta: { aliases: ["工作区 a11caaed"] }, childNodes: []
		}]
	});
	ok("R42-4f", (nodes2[1].aliases || []).indexOf("novels") >= 0,
		"拍平时并入**宿主当前名**（落库名过期也能命中）：" + JSON.stringify(nodes2[1].aliases));
	eq("R42-4g", (matchRowToNode("novels", nodes2) || {}).id, "ws_a11caaed-1926-4572-85c2-889744833227",
		"点宿主侧栏行文本 ⇒ 命中工作区节点（需求 4 的正解路径）");
	setHostCtx(null);
	/* 负对照：没有宿主 ctx ⇒ 不并入任何东西（行为与改动前**逐字一致**，零回归） */
	const nodes3 = flattenTree({
		id: "root", name: "全局", level: "global", meta: {},
		childNodes: [{ id: "ws_a11caaed", name: "工作区 a11caaed", level: "project", meta: {}, childNodes: [] }]
	});
	eq("R42-4h", (nodes3[1].aliases || []).length, 0, "无宿主 ctx ⇒ aliases 不被污染");
	eq("R42-4i", matchRowToNode("novels", nodes3), null, "无宿主 ctx ⇒ 该名不命中（不是无脑放行）");
}

console.log("════ R42-5 分支血缘链（需求 3：分支继承总监对话）════");
setHostCtx(fakeCtx);
eq("R42-5a", sessionParentId("x3"), "x2", "父子关系可读");
{
	const c = directorScopeChain("se_x3");
	eq("R42-5b", c.join(">"), "se_x3>se_x2>se_x1", "会话节点链 = 自身 → 父 → 祖父");
}
eq("R42-5c", directorScopeChain("ws_w1").join(">"), "ws_w1", "非会话节点 ⇒ 只有自身（不谈分支血缘）");
{
	const c = directorScopeChain("se_c1");
	ok("R42-5d", c.length <= 8 && c.indexOf("se_c1") >= 0, "**成环不死循环**（实测链=" + c.join(">") + "）");
}
setHostCtx(null);
eq("R42-5e", directorScopeChain("se_x3").join(">"), "se_x3", "无 ctx ⇒ 只有自身（降级可见）");
eq("R42-5f", sessionChain("nope").join(">"), "nope", "未知会话 ⇒ 自身");

console.log("════ R42-6 干跑开关（需求 1：测试不烧模型额度）════");
eq("R42-6a", isDryRun(), false, "默认关闭（绝不影响正常使用）");
eq("R42-6b", setDryRun(true), true, "开启返回生效值");
eq("R42-6c", isDryRun(), true, "开启后 isDryRun 为真");
eq("R42-6d", setDryRun(false), false, "关闭");
eq("R42-6e", isDryRun(), false, "关闭后恢复");
/* ── R42-6f..6j：**跨页面重载存活**（第 42 轮补丁 · sessionStorage 兜底）────────
 * 真因（本轮取证）：`verify-v17-sync.mjs` / `verify-director-logic.mjs` 会在**套件内部**
 *   `location.reload()` 复位起点 —— 页面全局 `window.__dshDirectorDryRun` 随之丢失，
 *   该套件 reload 之后的"流转"就会**真发**。批内守卫只管"每套之前"，管不到套件内部。
 *   ⇒ 干跑开关必须落进 `sessionStorage`（**同标签 reload 存活、关标签/重启宿主即清**；
 *     不用 `localStorage` 是因为它会长期残留 ⇒ 用户正常使用时会"发不出去"却查不出原因）。 */
const mkSS = (init) => {
	const m = new Map(Object.entries(init || {}));
	return {
		getItem: (k) => (m.has(k) ? m.get(k) : null),
		setItem: (k, v) => { m.set(k, String(v)); },
		removeItem: (k) => { m.delete(k); }
	};
};
const withWin = (ss, fn) => {
	const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
	const saved = globalThis.window;
	try { globalThis.window = { sessionStorage: ss }; return fn(); }
	finally { if (had) globalThis.window = saved; else delete globalThis.window; }
};
/* 6f：**reload 之后**（全局标记没了，只剩 sessionStorage 键）⇒ 仍然干跑 */
eq("R42-6f", withWin(mkSS({ "dsh.director.testDryRun": "1" }), () => isDryRun()), true,
	"reload 后靠 sessionStorage 仍干跑（补上套件内部真发的缺口）");
/* 6g：无键 ⇒ 默认不干跑（产品正常使用不受影响 —— 与 6a 同源，这里是**带 window** 的复现） */
eq("R42-6g", withWin(mkSS({}), () => isDryRun()), false, "无键默认不干跑（正常使用不受影响）");
/* 6h/6i：写键 / 清键 —— 两侧**必须对称**（真发模式要能清掉上一次批的残留，否则"真验"退化成假绿） */
const ssX = mkSS({});
withWin(ssX, () => setDryRun(true));
eq("R42-6h", ssX.getItem("dsh.director.testDryRun"), "1", "开启时写入 sessionStorage 键");
withWin(ssX, () => setDryRun(false));
eq("R42-6i", ssX.getItem("dsh.director.testDryRun"), null, "关闭时清除 sessionStorage 键");
/* 6j：**结构自证（只防"全删"）** —— 读源码确认 sessionStorage 读写**文本存在**。
 *   🔴 本轮校准暴露的边界（**如实标注，不许夸大**）：把 `isDryRun` 的 sessionStorage 分支
 *     用 `return false` **短路**（代码文本还在、只是不可达）时，**6j 仍绿** —— 因为正则
 *     只能证明"写在那儿了"，**证明不了"能走到"**（这正是纪律 79/135「写好了 ≠ 接进去了」
 *     的下一跳：**接进去了 ≠ 能走到**）。
 *   ⇒ 分工必须写清：**"可达性"由行为断言 R42-6f 守**（短路时它精确变红，已实测），
 *     6j 只补一个"不许把整段删掉/token 改名"的兜底。 */
const cbSrc = readFileSync(new URL("../src/bridge/chat-bridge.js", import.meta.url), "utf8");
ok("R42-6j", /isDryRun\(\)\s*\{[\s\S]{0,700}sessionStorage/.test(cbSrc)
	&& /setDryRun\(v\)\s*\{[\s\S]{0,700}sessionStorage/.test(cbSrc)
	&& /sessionStorage\.removeItem/.test(cbSrc),
	"chat-bridge 源码内**存在** sessionStorage 读写（只防全删；可达性见 R42-6f）");
setDryRun(false);

console.log("");
console.log("通过 " + pass + " / 失败 " + fails.length + (fails.length ? "（" + fails.join(", ") + "）" : ""));
console.log("IS_PASS: " + (fails.length === 0 ? "TRUE" : "FALSE"));
process.exit(fails.length === 0 ? 0 : 1);
