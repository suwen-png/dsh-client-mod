/**
 * scripts/test-scope-tree.mjs — 第 38 轮离线闸门：**导航意图** + **作用域过滤**（纯函数）
 *
 * 守两条用户需求：
 *   · 需求 11「点击文件夹跳出总监；非固定时再点**对话**总监缩回，点**文件夹**刷新总监」
 *   · 需求 6 / 18「**仅显示这个文件夹中的作用**」「只显示当前文件夹下面的这些对话的导图，
 *                除非我点击上一级才由上一级的显示」
 *
 * ── 判据可校准（纪律 ⑥ / ⑫）─────────────────────────────────────
 *   每条核心断言都配**坏样本**，用"看起来对但确实错"的实现产物去撞它 ——
 *   撞不红说明判据是空的（"永远绿"）。
 *
 * 用法：node scripts/test-scope-tree.mjs      （零依赖，不需要 CDP / 应用）
 */

import { navIntent, NAV_INTENT, __LEVEL_SESSION_FOR_TEST as NI_SESSION } from "../src/logic/nav-intent.js";
import {
	findInTree, scopeSessions, scopeSessionIdSet, filterRowsByScope, scopeStats,
	__LEVEL_SESSION_FOR_TEST as ST_SESSION
} from "../src/logic/scope-tree.js";
import { LEVEL } from "../src/store/hierarchy.js";

let pass = 0, fail = 0;
function t(id, desc, cond, ev) {
	if (cond) { pass += 1; console.log("  ✅ " + id + " " + desc); }
	else { fail += 1; console.log("  ❌ " + id + " " + desc + "\n       " + JSON.stringify(ev)); }
}

/* ══════════════════════════════════════════════════════════════════
 * SC · 同值对拍（零依赖契约的代价要用断言补回来）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── SC · 常量同值对拍（跨模块不得各写一套）──");
t("SC-1", "nav-intent 的会话级名与 store/hierarchy 的 LEVEL.SESSION 同值",
	NI_SESSION === LEVEL.SESSION, { nav: NI_SESSION, store: LEVEL.SESSION });
t("SC-2", "scope-tree 的会话级名与 store/hierarchy 的 LEVEL.SESSION 同值",
	ST_SESSION === LEVEL.SESSION, { scope: ST_SESSION, store: LEVEL.SESSION });
t("SC-3", "两个 logic 模块对该常量彼此一致（三处同一真相源）",
	NI_SESSION === ST_SESSION, { a: NI_SESSION, b: ST_SESSION });

/* ══════════════════════════════════════════════════════════════════
 * NI · 导航意图（需求 10 / 11）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── NI · 导航意图四态 ──");
const NI = NAV_INTENT;
t("NI-1", "固定态：点对话 ⇒ hold（用户：「总监页面不会变化」）",
	navIntent({ pinned: true, hasMatch: true, level: "session", dialogOpen: true }) === NI.HOLD,
	{ got: navIntent({ pinned: true, hasMatch: true, level: "session", dialogOpen: true }) });
t("NI-2", "固定态：点文件夹 ⇒ hold（作用域也不许被改，否则「不会变化」不成立）",
	navIntent({ pinned: true, hasMatch: true, level: "project", dialogOpen: true }) === NI.HOLD,
	{ got: navIntent({ pinned: true, hasMatch: true, level: "project", dialogOpen: true }) });
t("NI-3", "固定态：无命中 ⇒ hold（不因「点空」而缩回）",
	navIntent({ pinned: true, hasMatch: false, dialogOpen: true }) === NI.HOLD,
	{ got: navIntent({ pinned: true, hasMatch: false, dialogOpen: true }) });
t("NI-4", "非固定：点文件夹 ⇒ refresh（换作用域）",
	navIntent({ pinned: false, hasMatch: true, level: "project", dialogOpen: true }) === NI.REFRESH,
	{ got: navIntent({ pinned: false, hasMatch: true, level: "project", dialogOpen: true }) });
t("NI-5", "非固定：点对话 ⇒ collapse（缩回）",
	navIntent({ pinned: false, hasMatch: true, level: "session", dialogOpen: true }) === NI.COLLAPSE,
	{ got: navIntent({ pinned: false, hasMatch: true, level: "session", dialogOpen: true }) });
t("NI-6", "非固定：无命中且弹窗开着 ⇒ collapse（「其他对话」未必在树里）",
	navIntent({ pinned: false, hasMatch: false, dialogOpen: true }) === NI.COLLAPSE,
	{ got: navIntent({ pinned: false, hasMatch: false, dialogOpen: true }) });
t("NI-7", "非固定：无命中且弹窗**没开** ⇒ none（绝不误开 —— 保持既有克制）",
	navIntent({ pinned: false, hasMatch: false, dialogOpen: false }) === NI.NONE,
	{ got: navIntent({ pinned: false, hasMatch: false, dialogOpen: false }) });
t("NI-8", "全局级节点（非 session）⇒ refresh，不被当成对话",
	navIntent({ pinned: false, hasMatch: true, level: "global", dialogOpen: true }) === NI.REFRESH,
	{ got: navIntent({ pinned: false, hasMatch: true, level: "global", dialogOpen: true }) });
t("NI-9", "缺参调用不抛，且退到 none（读端兜底）",
	(() => { try { return navIntent() === NI.NONE; } catch (e) { return false; } })(),
	{ got: (() => { try { return navIntent(); } catch (e) { return "THREW"; } })() });
/* 🔴 植入缺陷校准：把"固定态"漏掉的实现（旧行为 = 无论 pinned 一律按未固定走）
 *    拿去撞 NI-1/NI-3 —— 必须红，否则说明这两条断言没在守东西。 */
const badPinnedIgnored = (o = {}) => (o.hasMatch
	? (String(o.level || "") === "session" ? "collapse" : "refresh")
	: (o.dialogOpen ? "collapse" : "none"));
t("NI-10", "🔴 校准：忽略 pinned 的坏实现**必须**撞红 NI-1 的判据",
	badPinnedIgnored({ pinned: true, hasMatch: true, level: "session", dialogOpen: true }) !== NI.HOLD,
	{ bad: badPinnedIgnored({ pinned: true, hasMatch: true, level: "session", dialogOpen: true }) });

/* ══════════════════════════════════════════════════════════════════
 * ST · 作用域 ∩ 血缘
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── ST · 作用域集合与多层过滤 ──");

/** 造一棵层级树：全局 → 项目A → {会话a1, 子文件夹A2 → 会话a2}；项目B → 会话b1 */
const mkSession = (id, cid, title) => ({
	id, level: "session", name: title, conversations: [{ conversationId: cid, title, lastMessage: "x" }], childNodes: []
});
let tree = {
	id: "root", level: "global", name: "全局总管", childNodes: [
		{
			id: "projA", level: "project", name: "项目A", childNodes: [
				mkSession("n-a1", "sa1", "会话A1"),
				{ id: "projA2", level: "project", name: "子文件夹A2", childNodes: [mkSession("n-a2", "sa2", "会话A2")] }
			]
		},
		{ id: "projB", level: "project", name: "项目B", childNodes: [mkSession("n-b1", "sb1", "会话B1")] }
	]
};

t("ST-1", "findInTree 能按 id 找到深层节点",
	(findInTree(tree, "projA2") || {}).name === "子文件夹A2",
	{ got: (findInTree(tree, "projA2") || {}).name });
t("ST-2", "scopeSessions 只取 session 级（不含文件夹自身）",
	scopeSessions(findInTree(tree, "projA")).length === 2 && scopeSessions(findInTree(tree, "projA")).every((s) => s.level === "session"),
	{ n: scopeSessions(findInTree(tree, "projA")).length });
t("ST-3", "作用域含**子文件夹**（需求 6：嵌套时仍显示本文件夹的作用）",
	scopeSessionIdSet(tree, "projA").has("sa2"),
	{ set: Array.from(scopeSessionIdSet(tree, "projA")) });
t("ST-4", "🔴 集合取 conversations[].conversationId，**不是**节点 id",
	!scopeSessionIdSet(tree, "projA").has("n-a1") && scopeSessionIdSet(tree, "projA").has("sa1"),
	{ set: Array.from(scopeSessionIdSet(tree, "projA")) });
t("ST-5", "作用域互不串味：项目A 不含 B 的会话",
	!scopeSessionIdSet(tree, "projA").has("sb1"),
	{ set: Array.from(scopeSessionIdSet(tree, "projA")) });
t("ST-6", "scopeId 为空 ⇒ 返回 null（「不限」，**不是空集**）",
	scopeSessionIdSet(tree, "") === null, { got: String(scopeSessionIdSet(tree, "")) });
t("ST-7", "scopeId 找不到 ⇒ 返回 null（同样表示「不限」，避免误滤成空）",
	scopeSessionIdSet(tree, "no-such-node") === null, { got: String(scopeSessionIdSet(tree, "no-such-node")) });

/* ── 多层结构（用户原话：「注意多层结构的实现」）─────────────────────
 * 血缘：A → B → C → D（四层）。
 * 情况一：集合 = {A,B,C,D} ⇒ depth 0/1/2/3（原样）
 * 情况二：集合 = {A,C,D}（B 被滤掉）⇒ C 最近保留祖先是 A ⇒ depth 1；D ⇒ depth 2
 *        🔴 用"看直接父"的实现会得 C=0、D=0 ⇒ 与 A 同级 ⇒ 支链断开（用户会看到"关系断了"）
 * 情况三：集合 = {D} ⇒ D 成根 ⇒ depth 0
 */
const lineage = [
	{ sessionId: "A", parentSessionId: "", depth: 0, title: "A" },
	{ sessionId: "B", parentSessionId: "A", depth: 1, title: "B" },
	{ sessionId: "C", parentSessionId: "B", depth: 2, title: "C" },
	{ sessionId: "D", parentSessionId: "C", depth: 3, title: "D" }
];

const all = filterRowsByScope(lineage, new Set(["A", "B", "C", "D"]));
t("ST-8", "全保留 ⇒ depth 原样 0/1/2/3",
	all.rows.map((r) => r.depth).join(",") === "0,1,2,3",
	{ got: all.rows.map((r) => r.depth).join(",") });

const midFiltered = filterRowsByScope(lineage, new Set(["A", "C", "D"]));
const dOf = (r, id) => (r.rows.find((x) => x.sessionId === id) || {}).depth;
t("ST-9", "🔴 中间层被滤 ⇒ 孙节点挂**最近保留祖先**（C=1，不是 0）",
	dOf(midFiltered, "C") === 1, { got: dOf(midFiltered, "C"), rows: midFiltered.rows.map((r) => r.sessionId + ":" + r.depth) });
t("ST-10", "🔴 四层链同理（D=2，不是 0）",
	dOf(midFiltered, "D") === 2, { got: dOf(midFiltered, "D") });
t("ST-11", "被滤掉的 B **不在**结果里，且 dropped 计数正确",
	midFiltered.dropped === 1 && !midFiltered.rows.some((r) => r.sessionId === "B"),
	{ dropped: midFiltered.dropped, ids: midFiltered.rows.map((r) => r.sessionId) });

const onlyLeaf = filterRowsByScope(lineage, new Set(["D"]));
t("ST-12", "只留叶子 ⇒ 它成根（depth 0）",
	dOf(onlyLeaf, "D") === 0, { got: dOf(onlyLeaf, "D") });

t("ST-13", "idSet 为 null ⇒ 原样返回（「不限」，不是「全滤掉」）",
	filterRowsByScope(lineage, null).rows.length === 4,
	{ got: filterRowsByScope(lineage, null).rows.length });
t("ST-14", "空集 ⇒ 全滤掉（dropped = 全部），不抛",
	(() => { const r = filterRowsByScope(lineage, new Set()); return r.rows.length === 0 && r.dropped === 4; })(),
	{ got: JSON.stringify(filterRowsByScope(lineage, new Set())) });
t("ST-15", "环（A→B→A）不会死循环（guard 生效）",
	(() => {
		const cyc = [
			{ sessionId: "A", parentSessionId: "B", depth: 0, title: "A" },
			{ sessionId: "B", parentSessionId: "A", depth: 1, title: "B" }
		];
		const r = filterRowsByScope(cyc, new Set(["A", "B"]));
		return r.rows.length === 2;
	})(), { got: "见断言" });

/* 🔴 植入缺陷校准：**正是用户说的那个坑** —— 只看直接父
 *    （父不在集合 ⇒ depth 归零，不再往上找） */
const badDirectParent = (rows, idSet) => {
	const list = rows || [];
	if (!idSet) return { rows: list };
	const byId = new Map(list.map((r) => [r.sessionId, r]));
	return {
		rows: list.filter((r) => idSet.has(r.sessionId)).map((r) => {
			const pid = r.parentSessionId;
			const p = pid ? byId.get(pid) : null;
			const keepParent = pid && idSet.has(pid);
			return { ...r, depth: keepParent && p ? p.depth + 1 : 0 };
		})
	};
};
const badRes = badDirectParent(lineage, new Set(["A", "C", "D"]));
t("ST-16", "🔴 校准：「只看直接父」的坏实现**必须**撞红 ST-9（否则 ST-9 是空判据）",
	(badRes.rows.find((r) => r.sessionId === "C") || {}).depth !== 1,
	{ badC: (badRes.rows.find((r) => r.sessionId === "C") || {}).depth });

/* ── 概况统计 ── */
const st = scopeStats([
	{ sessionId: "A", parentSessionId: "", depth: 0, title: "A" },
	{ sessionId: "B", parentSessionId: "A", depth: 1, title: "B" },
	{ sessionId: "C", parentSessionId: "A", depth: 1, title: "C" }
]);
t("ST-17", "scopeStats：total=3 / roots=1 / 有子者=1 / maxDepth=1",
	st.total === 3 && st.roots === 1 && st.branched === 1 && st.maxDepth === 1,
	{ st });

console.log("\n═══════════════════════════════════════════════════════════");
/* 🔴 收尾对账（纪律「跳过比红更危险」+「加了断言却不抬下限 = 把沉默合法化」）：
 *  本套件是**纯离线**（不碰 CDP、没有 skip 分支），所以唯一能让它"静默少跑"的形态
 *  就是**中途抛穿** —— 那时 Node 打印一个裸栈退出，报告读起来只是"跑到这里就没了"。
 *  ⇒ 用一个总数下限把它钉住：实跑 < 下限 ⇒ **INVALID（exit 2）**，
 *    与"产品坏"（exit 1）在**退出码层面**就分开（本项目退出码约定 0/1/2）。
 *  ⚠️ 下限是**下限**不是精确值：以后新增断言**必须**同步抬高它。 */
const ran = pass + fail;
const MIN_ASSERTIONS = 30;
if (ran < MIN_ASSERTIONS) {
	console.log("  ❌ INVALID：断言总数对账不通过（实跑 " + ran + " < 下限 " + MIN_ASSERTIONS + "）");
	console.log("     ⇒ 有段落**静默没跑**（多半是中途抛穿），本次结果不可用作产品判定。");
	process.exit(2);
}
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
