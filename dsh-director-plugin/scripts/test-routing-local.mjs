#!/usr/bin/env node
/**
 * test-routing-local.mjs —— 19 号文 **N2 跨维度转发**的离线判据（前缀 `RL-`）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它治的是什么（用户原话）
 * ──────────────────────────────────────────────────────────────────
 *   「在 A3 分支里输入属于 A5 的内容，**不会转发到 A5**（也**判不出**这属于 A5）」
 *
 * 根因是**两条平行分流通道互不识别**：
 *   · 通道 A（维度派发）：只判「是不是小说" ⇒ 全 8 维；
 *   · 通道 B（单点路由 `route()`）：候选 = 层级树节点 ⇒ A1–A8 **根本不是它的候选**。
 * ⇒ 本套件锁的是「合并后的语义「：**维度候选进 `route()`，当前维度走 `local`，其他维度走 `transfer`**。
 *
 * ══════════════════════════════════════════════════════════════════
 * 覆盖（N2 四条判据逐条）
 * ──────────────────────────────────────────────────────────────────
 *   RL-1 契约：`DESTINATION.LOCAL` 存在、label 齐（界面不许显示 undefined）
 *   RL-2 **判据 1**：当前在 A3 + A3 话题 ⇒ `local`，**零跨会话投递**（含负对照）
 *   RL-3 **判据 2**：当前在 A3 + A5 话题 ⇒ `transfer`，且 `dimKey` 指向 A5
 *   RL-4 **判据 4**：无匹配 ⇒ `create`（保留既有语义）
 *   RL-5 `dimKey` 透传（没有它，调用方无法定位目标维度 ⇒ 会变成「再解析 name「的第二份真相源）
 *   RL-6 🔴 **内容归属优先于「就近"**（`+1` 就近加权不得压过归属分 —— 实测过的量级冲突）
 *   RL-7 🔴 前提**与契约**（修正版）：`tokenize()` **有 bigram 兜底** ⇒ 中文名**会**被字面命中
 *        （我首版断言"恒不命中"是**漏读 70–81 行**的错误结论，被本套件自己反证）；
 *        契约是：带归属分时**采用归属分**（这关乎"准不准"，不是"能不能"）
 *   RL-8 **判据 3**：转发信封 `via="transfer"` + `ref` 指回源消息（与 `logic/lineage.js` 同一实现）
 *   RL-9 向后兼容：不传 `ctx` ⇒ 不抛穿（旧调用点零改动可跑）
 *   RL-10 `dimensionCandidates()`：归属判定 → 路由候选的**翻译**（两条通道的合并点）
 *   RL-11 `dimBranchContext()`：维度 ↔ 分支节点的**唯一翻译点**（总监页与弹窗共用）
 *   RL-A 编号唯一自检
 *
 * 校准（纪律 32）：`RL_NEG=1` 让维度节点退回「就近加权「（期望 RL-6 红）。
 * 用法：node scripts/test-routing-local.mjs ｜ 退出码 0 全绿 / 1 有红
 */

import { route, suggestDestination, dimensionCandidates, DESTINATION, DESTINATION_LABEL, tokenize } from "../src/logic/routing.js";
import { childEnvelope, makeEnvelope, envOf } from "../src/logic/lineage.js";
import { dimBranchContext } from "../src/logic/dim-branch.js";
import { SPLIT_DIMENSIONS } from "../src/logic/split-dimensions.js";

let pass = 0; let fail = 0;
const t = (id, name, cond, detail) => {
	if (cond) { pass++; console.log("  OK  " + id + "  " + name); }
	else { fail++; console.log("  ❌  " + id + "  " + name + "  ⇒ " + JSON.stringify(detail === undefined ? null : detail)); }
};

/* ── 校准：把「维度节点不做就近加权「这条规则去掉 ⇒ 期望 RL-6 红 ── */
const NEG = String(process.env.RL_NEG || "").trim();
const doRoute = (text, ctx) => {
	if (NEG !== "1") return route(text, ctx);
	/* 坏版：还原成「对所有候选一律 +1「（收敛前的行为） */
	const r = route(text, ctx);
	const cands = (r.candidates || []).map((c) => ({
		...c,
		score: c.nodeId === (ctx && ctx.currentNodeId) ? Math.round((c.score + 1) * 100) / 100 : c.score
	})).sort((a, b) => b.score - a.score);
	return Object.assign({}, r, { candidates: cands, decision: suggestDestination(cands, ctx) });
};
if (NEG) console.log("  [校准] RL_NEG=" + NEG + " ⇒ 维度节点也参与「就近 +1」加权（坏版）");

console.log("═══════════════════════════════════════════════════════════");
console.log("  跨维度转发 · 就地处理 vs 转派（19 号文 N2）");
console.log("═══════════════════════════════════════════════════════════");

const KEY = "plot";        // A3 剧情
const KEY2 = "prose";      // A5 正文
const dim = (k) => SPLIT_DIMENSIONS.filter((d) => d.key === k)[0] || {};
const nA3 = { id: "dim:plot", name: dim("plot").label || "A3 剧情", level: "dimension", dimKey: KEY, score: 0.9, reason: "归属判定命中 A3" };
const nA5 = { id: "dim:prose", name: dim("prose").label || "A5 正文", level: "dimension", dimKey: KEY2, score: 0.2, reason: "归属判定命中 A5" };
const CUR = { currentNodeId: "dim:plot", nodes: [nA3, nA5] };

/* ── RL-1 契约 ── */
t("RL-1a", "`DESTINATION.LOCAL === \"local\"`（冻结契约**只增不改**：既有三值原样保留）",
	DESTINATION.LOCAL === "local" && DESTINATION.TRANSFER === "transfer" && DESTINATION.DIRECT === "direct" && DESTINATION.CREATE === "create",
	{ local: DESTINATION.LOCAL, transfer: DESTINATION.TRANSFER, direct: DESTINATION.DIRECT, create: DESTINATION.CREATE });

t("RL-1b", "🔴 四个去向**都有 label**（否则界面显示 `undefined` —— 新增枚举最常见的漏）",
	["local", "transfer", "direct", "create"].every((k) => typeof DESTINATION_LABEL[k] === "string" && DESTINATION_LABEL[k].length > 0),
	DESTINATION_LABEL);

/* ── RL-2 判据 1：当前维度 ⇒ local ── */
{
	const r = doRoute("补充第三章剧情支线", CUR);
	t("RL-2a", "🔴 **判据 1**：当前在 A3 + A3 话题 ⇒ `destination === \"local\"`（就地处理）",
		r.decision.destination === DESTINATION.LOCAL, { dest: r.decision.destination, why: r.decision.reason });
	t("RL-2b", "🔴 **负对照**：判 `local` 时**不得**给出任何目标会话（零跨会话投递的前提）",
		r.decision.destination === DESTINATION.LOCAL && !r.decision.targetSession, r.decision);
}

/* ── RL-3 判据 2：其他维度 ⇒ transfer ── */
{
	const r = doRoute("把正文润色一遍", { currentNodeId: "dim:plot", nodes: [{ ...nA3, score: 0.2 }, { ...nA5, score: 0.9 }] });
	t("RL-3a", "🔴 **判据 2**：当前在 A3 + A5 话题 ⇒ `destination === \"transfer\"`（转给该维度分支）",
		r.decision.destination === DESTINATION.TRANSFER, { dest: r.decision.destination, why: r.decision.reason });
	t("RL-3b", "🔴 转派**带上 `dimKey`** ⇒ 调用方可据此经 `planReuse().picked` 定位目标会话（不需再解析 name）",
		r.decision.dimKey === KEY2, { dimKey: r.decision.dimKey, want: KEY2 });
}

/* ── RL-4 判据 4：无匹配 ⇒ create ── */
{
	const r = doRoute("随便聊聊", { currentNodeId: "dim:plot", nodes: [] });
	t("RL-4a", "🔴 **判据 4**：无候选 ⇒ `create`（既有语义**原样保留**）",
		r.decision.destination === DESTINATION.CREATE, r.decision);
}

/* ── RL-5 dimKey 透传 ── */
{
	const r = doRoute("把正文润色一遍", { currentNodeId: "dim:plot", nodes: [{ ...nA3, score: 0.2 }, { ...nA5, score: 0.9 }] });
	const top = (r.candidates || [])[0] || {};
	t("RL-5a", "候选里 `dimKey` 被透传（`scoreNodes` 不许把它丢掉）",
		top.dimKey === KEY2, { top: top });
}

/* ── RL-6 内容归属优先于「就近」 ── */
{
	/* 当前维度只拿 0.2、另一维度拿 0.9 ⇒ 若给当前维度 +1（=1.2）会**反超** ⇒ 必须不加 */
	const r = doRoute("把正文润色一遍", { currentNodeId: "dim:plot", nodes: [{ ...nA3, score: 0.2 }, { ...nA5, score: 0.9 }] });
	const top = (r.candidates || [])[0] || {};
	t("RL-6a", "🔴 **内容归属优先**：归属分 0.9 的 A5 必须压过「当前维度 +1」后的 A3（1.2）",
		top.nodeId === "dim:prose", { top: top.nodeId, score: top.score, cands: (r.candidates || []).map((c) => c.nodeId + ":" + c.score) });
	t("RL-6b", "🔴 同一条的另一面：`local` 只应在**当前维度分最高**时出现（不是只要在场就算）",
		r.decision.destination === DESTINATION.TRANSFER, r.decision.destination);
}

/* ── RL-7 前提与契约（**修正过**：我最初的前提是错的，见下）── */
{
	/* 🔴 前提证据：`tokenize()` 有 **bigram 兜底**（`pushBigrams`）⇒ 中文二元组**会**被字面命中。
	 *   首版我只看 58–68 行就断言「中文维度名恒不命中」⇒ 该断言**反证了它自己**
	 *   （实测 `reason:"名称命中 剧情"`、`score:3.2`）。这是纪律 23「先证前提」的又一次价值。 */
	const toks = tokenize("补充第三章剧情支线");
	t("RL-7a", "前提证据：`tokenize()` 的 **bigram 兜底**让中文二元组可被命中（`剧情` ∈ tokens）",
		toks.indexOf("剧情") >= 0, toks.slice(0, 12));
}
{
	const bare = { id: "dim:plot", name: "A3 剧情", level: "dimension", dimKey: KEY };
	const r0 = route("补充第三章剧情支线", { currentNodeId: "dim:plot", nodes: [bare] });
	const top0 = (r0.candidates || [])[0];
	const r1 = route("补充第三章剧情支线", { currentNodeId: "dim:plot", nodes: [{ ...bare, score: 0.42, reason: "归属判定命中 A3" }] });
	const top1 = (r1.candidates || [])[0];
	t("RL-7b", "🔴 带归属分 ⇒ **采用它**（`0.42` 原样透出，不被字面匹配的 3.2 覆盖）",
		!!top1 && Math.abs(Number(top1.score) - 0.42) < 0.001, { attrScore: top1 && top1.score, why: top1 && top1.reason });
	t("RL-7c", "🔴 同一条的负对照：**不带**归属分 ⇒ 仍走原字面匹配（既有行为零改动）",
		!!top0 && Number(top0.score) > 1, top0);
	t("RL-7d", "🔴 归属分路径的 `reason` 来自**归属判定**（不是「名称命中…」——调用方要能分辨用了哪条路）",
		!!top1 && !/名称命中/.test(String(top1.reason)), top1 && top1.reason);
}

/* ── RL-8 判据 3：转发信封 ── */
{
	const srcRow = { messageId: "m-src", text: "在 A3 里说 A5 的事", env: makeEnvelope({ id: "m-src", from: "dim:plot", root: "dim:plot", via: "local" }, null) };
	const env = childEnvelope(envOf(srcRow), { id: "m-dst", to: "dim:prose", via: "transfer" });
	t("RL-8a", "🔴 **判据 3**：转发消息 `via=\"transfer\"` 且 `ref` 指回**源消息 id**（可追溯）",
		env.via === "transfer" && env.ref === "m-src" && env.to === "dim:prose", env);
	t("RL-8b", "🔴 同一血缘：`root` 继承源、`parent` = 源 id（否则目标分支与源分支分成两组 ⇒ 无血缘）",
		env.root === "dim:plot" && env.parent === "m-src" && env.round === 1, env);
	t("RL-8c", "🔴 通道值**只能是四值之一**（防拼错后静默降级成 local —— 那会让「转发了「与「没转发「同形）",
		["local", "transfer", "direct", "create"].indexOf(env.via) >= 0, env.via);
}

/* ── RL-9 向后兼容 ── */
{
	let threw = false;
	let d = null;
	try { d = route("补充剧情", { nodes: [nA3] }).decision; } catch (e) { threw = true; }
	t("RL-9a", "🔴 不传 `ctx`（旧调用点）⇒ **不抛穿**，且维度候选退化为 `transfer`（无当前位置可比）",
		!threw && !!d && d.destination === DESTINATION.TRANSFER, { threw: threw, d: d });
}

{
	let threw = false;
	try { suggestDestination([{ nodeId: "x", name: "X", level: "session", score: 5 }]); } catch (e) { threw = true; }
	t("RL-9b", "🔴 `suggestDestination` 单参调用（旧签名）仍可用（新参可选）", !threw, threw);
}

{
	/* 🔴 防回归：`makeEnvelope(o, null)` —— 默认参数只对 `undefined` 生效，
	 *   `null` 会穿透 ⇒ 实测曾抛 `Cannot read properties of null (reading 'self')`。
	 *   执行链上的模块抛穿 = 整条链静默失效（纪律 100）⇒ 单列一条锁住。 */
	let threw = false;
	let ok = false;
	try {
		const e = makeEnvelope({ id: "z" }, null);
		ok = !!e && e.id === "z" && e.root === null;
	} catch (e) { threw = true; }
	t("RL-9c", "🔴 `makeEnvelope(o, null)` **不抛穿**（`null` 穿透默认参数 —— 执行链上的模块不许炸）",
		!threw && ok, { threw: threw, ok: ok });
}

/* ── RL-10 归属判定 → 路由候选（`dimensionCandidates` = N2 两条通道的**合并点**）──
 *
 * 🔴 这一段锁的是"接线层会不会把语义用错"，而不是 `suggestDestination` 本身：
 *    候选的 **id 用错了**（比如用会话 id、或用 `"dim:plot"` 这类合成 id）
 *    时 `suggestDestination` **照样返回一个看起来合理的去向** ——
 *    只是 `confirmRoute` 之后 `findNodeById()` 找不到节点 ⇒ 投递静默不发生。
 *    ⇒ 必须逐字段锁"id 是**真节点 id**"。 */
{
	const plan = {
		dims: [
			{ key: "plot", label: "A3 剧情" },
			{ key: "prose", label: "A5 正文" },
			{ key: "chars", label: "A4 人物" }
		],
		attribution: {
			dims: [
				{ key: "plot", label: "A3 剧情", score: 0.9, reason: "职责词命中" },
				{ key: "prose", label: "A5 正文", score: 0.4, reason: "职责词命中" }
			]
		}
	};
	/* 🔴 样本必须**第三种情形齐全**，否则 RL-10c 是空真：
	 *     `plot` 当前维度（有分支，但走"当前维度"那支）、
	 *     `prose` 其他维度 + **有**分支（走 transfer 支）、
	 *     `chars` 其他维度 + **无**分支（必须不进候选）。 */
	const branchOf = { prose: { nodeId: "nA5", sessionId: "sA5", at: 2 } };
	const got = dimensionCandidates(plan, { currentNodeId: "nA3", currentDim: "plot", branchOf: branchOf });
	const byKey = {};
	for (let i = 0; i < got.length; i++) byKey[got[i].dimKey] = got[i];
	t("RL-10a", "🔴 命中**当前维度** ⇒ 候选 id = **当前节点 id**（否则 `suggestDestination` 判不出 `local`）",
		!!byKey.plot && byKey.plot.id === "nA3" && byKey.plot.level === "dimension"
		&& byKey.plot.dimKey === "plot", byKey.plot);
	t("RL-10b", "🔴 命中**其他维度且已有分支** ⇒ 候选 id = 该分支**节点 id**（不是会话 id、不是合成 id）",
		!!byKey.prose && byKey.prose.id === "nA5", byKey.prose);
	t("RL-10c", "🔴 命中其他维度但**该维度还没有分支** ⇒ **不进候选**（让候选退回既有形态 ⇒ 判 `create`，不硬造假目标）",
		!byKey.chars, Object.keys(byKey));
	t("RL-10d", "🔴 归属分**原样透传**（它是「内容归属优先于就近」的量级依据；丢了会静默回退字面匹配 ⇒ 又判不准）",
		!!byKey.plot && byKey.plot.score === 0.9 && byKey.prose.score === 0.4,
		{ plot: byKey.plot && byKey.plot.score, prose: byKey.prose && byKey.prose.score });
}

/* ── RL-11 维度 ↔ 分支节点（`dim-branch.js` = 总监页与弹窗**共用的唯一实现**）── */
{
	const tree = {
		id: "root", name: "全局", level: "global", childNodes: [
			{ id: "nA3", name: "A3 剧情", level: "session", conversations: [{ conversationId: "sA3" }], childNodes: [] },
			{ id: "nA5", name: "A5 正文", level: "session", conversations: [{ conversationId: "sA5" }], childNodes: [] }
		]
	};
	const idx = {
		sA3: { dim: "plot", label: "A3 剧情", at: 10 },
		sA5: { dim: "prose", label: "A5 正文", at: 20 },
		"ghost-1": { dim: "world", label: "A1 世界观", at: 30 }   // 会话已不在树上（归档 / 清理）
	};
	const ctx = dimBranchContext(tree, idx, { nodeId: "nA3", node: tree.childNodes[0] });
	t("RL-11a", "🔴 `currentDim` = 当前节点挂的会话在索引里的维度（在 A3 里 ⇒ `plot`）",
		ctx.currentDim === "plot", ctx.currentDim);
	t("RL-11b", "🔴 `branchOf[dim].nodeId` = **树上的节点 id**（这样 `findNodeById` 与 `scopeKeyOf` 才接得上）",
		!!ctx.branchOf.prose && ctx.branchOf.prose.nodeId === "nA5" && ctx.branchOf.prose.sessionId === "sA5",
		ctx.branchOf.prose);
	t("RL-11c", "🔴 索引里有、树上没有 ⇒ 计入 `unbound`（**不静默丢弃**，否则「候选少了」看不出原因）",
		ctx.accounts.dimKeys === 3 && ctx.accounts.bound === 2 && ctx.accounts.unbound === 1 && !ctx.branchOf.world,
		ctx.accounts);
	t("RL-11d", "🔴 无当前节点（全局根 / 项目文件夹）⇒ `currentDim` **为空**而不是猜一个（那里本来就不属于任何维度）",
		dimBranchContext(tree, idx, {}).currentDim === "", dimBranchContext(tree, idx, {}).currentDim);
}

t("RL-A0", "断言编号唯一（28 条，无重号）",
	new Set(["RL-1a", "RL-1b", "RL-2a", "RL-2b", "RL-3a", "RL-3b", "RL-4a", "RL-5a", "RL-6a", "RL-6b",
		"RL-7a", "RL-7b", "RL-7c", "RL-7d", "RL-8a", "RL-8b", "RL-8c", "RL-9a", "RL-9b", "RL-9c",
		"RL-10a", "RL-10b", "RL-10c", "RL-10d", "RL-11a", "RL-11b", "RL-11c", "RL-11d"]).size === 28, "28");

console.log("───────────────────────────────────────────────────────────");
console.log("  通过 " + pass + " / 失败 " + fail + "（共 " + (pass + fail) + "）");
console.log(fail === 0 ? "IS_PASS: TRUE" : "IS_PASS: FALSE");
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
