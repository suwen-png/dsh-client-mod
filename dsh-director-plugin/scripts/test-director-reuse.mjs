#!/usr/bin/env node
/**
 * test-director-reuse.mjs —— 「派发前先复用已有会话」的**纯函数**离线测试（无需 Harness）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：
 *   「现在会话有问题, 重复创建了一百多个会话,
 *     我需要的是总监确认完需求之后**先考虑目前存在的会话,然后没有才是新建会话**」
 *
 * ⇒ 被测对象是 `logic/director-reuse.js` 的 `planReuse()`：**每维度给出 reuse / create 的决定**。
 *
 * 🔴 本测试的**重点在负对照**（`execution-standards` 纪律 23）：
 *    每条判据都要问"**反例上会不会也通过**"。最容易假通过的三处：
 *      · 只查索引不查宿主存活 ⇒ 会去复用一条**已经不存在的**会话（RU-3）
 *      · 不同作品/不同维度混在一起匹配 ⇒ 会把 A 作品的会话接给 B 作品（RU-8/RU-9）
 *      · 读不到宿主列表时照常判孤儿 ⇒ **一次读取失败清空整份索引**（RU-12，最危险）
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | RU-1  | 索引命中 + 会话存活 | 三条全部 `reuse` |
 *  | RU-2  | 复用取到的 id | 与索引一致（且不复用别的维度那条） |
 *  | RU-3  | 🔴 **负对照**：索引有、宿主没有 | **不复用**，`why="orphan-only"` |
 *  | RU-4  | 孤儿要**报出来** | `orphans` 含它（供清理，不是静默丢） |
 *  | RU-5  | 索引里根本没有 | `why="no-match"`（与 `orphan-only` **可分**） |
 *  | RU-6  | 同组多条 | 取 `at` **最新**（接续最近的工作，不接早期脏数据） |
 *  | RU-7  | 同组未被选中的存活条目 | 进 `surplus`（**报告 ≠ 删除**） |
 *  | RU-8  | 🔴 **负对照**：不同作品 | 不互相命中（哪怕别的作品 `at` 更大） |
 *  | RU-9  | 🔴 **负对照**：作品名为空 | 只与**空名**匹配，不命中有名条目 |
 *  | RU-10 | 🔴 同批次内**一个会话只接一个维度** | 重复维度第二条 `why="already-used"` |
 *  | RU-11 | 🔴 读不到宿主存活集 | 全部 `create` + `why="alive-unknown"` + `degraded` |
 *  | RU-12 | 🔴🔴 降级时**不产孤儿** | `orphans` 为空 —— 否则上游会清空整份索引 |
 *  | RU-13 | 纯函数性质 | 同输入同输出；不改入参；`null` 不抛 |
 *  | RU-14 | `reuseSummary` | **显式报出复用条数**（用户看不见复用 = 以为还在重复建） |
 *  | RU-15 | `directorRoleOf` | 由维度 `label` 推角色名（**不新造命名表**） |
 *  | RU-16 | `directorRoleOf` 取不到 label | 退化为通用「总监」（**不编**职能名） |
 *
 * 用法：node scripts/test-director-reuse.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

const { planReuse, directorRoleOf, reuseSummary } = await import("../src/logic/director-reuse.js");

let pass = 0, fail = 0; const failures = [];
const seen = new Set();
function t(id, name, cond, detail) {
	/* 🔴 断言编号必须唯一（纪律 ㉑ 同型）：重号会让"某条红了"无法定位到源码 */
	if (seen.has(id)) {
		console.log("  ❌ 断言编号重号：" + id + " —— 本测试文件内部冲突，先修编号再跑");
		fail++; failures.push(id + " 编号重号");
		return;
	}
	seen.add(id);
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  test-director-reuse · 派发前先复用已有会话（纯函数）");
console.log("═══════════════════════════════════════════════════════════");

const DIMS = [
	{ key: "world", label: "A1 世界观" },
	{ key: "plot", label: "A3 剧情" },
	{ key: "chars", label: "A4 人物" }
];
/* 真机形态的索引条目（`readSplitIndex()` 的 normalizeEntry 产物：dim/label/name/at） */
const idx3 = {
	"s-world": { dim: "world", label: "A1 世界观", name: "墟海", at: 100 },
	"s-plot": { dim: "plot", label: "A3 剧情", name: "墟海", at: 200 },
	"s-chars": { dim: "chars", label: "A4 人物", name: "墟海", at: 300 }
};

/* ── 场景 1：正常复用 ── */
const p1 = planReuse(DIMS, { index: idx3, aliveIds: ["s-world", "s-plot", "s-chars"], name: "墟海" });
t("RU-1", "索引命中且会话存活 ⇒ 三条全部 `reuse`、`create` 为 0",
	p1.reuse === 3 && p1.create === 0 && p1.decisions.every((d) => d.action === "reuse"),
	{ reuse: p1.reuse, create: p1.create, actions: p1.decisions.map((d) => d.action) });
t("RU-2", "复用取到的 id 与**各自维度**对应（不复用别的维度那条）",
	p1.decisions[0].sessionId === "s-world" && p1.decisions[1].sessionId === "s-plot"
	&& p1.decisions[2].sessionId === "s-chars",
	p1.decisions.map((d) => d.sessionId));

/* ── 场景 2：孤儿（索引有、宿主没有）—— **最容易假通过的一处** ── */
const p2 = planReuse(DIMS, { index: idx3, aliveIds: [], name: "墟海" });
t("RU-3", "🔴 **负对照**：索引有、宿主已无 ⇒ **不复用**，三条 `why` 全为 `orphan-only`",
	p2.reuse === 0 && p2.decisions.every((d) => d.action === "create" && d.why === "orphan-only"),
	{ reuse: p2.reuse, whys: p2.decisions.map((d) => d.why) });
t("RU-4", "孤儿 id **被报出来**（供清理入口用，不是静默丢弃）；`orphanKeys` = 涉及到的 (作品,维度) 分组数",
	p2.orphans.length === 3 && p2.orphans.indexOf("s-world") >= 0
	&& p2.orphanKeys.length === 3 && new Set(p2.orphanKeys).size === 3,
	{ orphans: p2.orphans, orphanKeys: p2.orphanKeys });

/* ── 场景 3：索引里根本没有 ── */
const p3 = planReuse(DIMS, { index: {}, aliveIds: [], name: "墟海" });
t("RU-5", "索引里根本没有这个 (作品,维度) ⇒ `why=\"no-match\"`（与 `orphan-only` **可分**）",
	p3.decisions.every((d) => d.why === "no-match") && p3.orphans.length === 0,
	{ whys: p3.decisions.map((d) => d.why), orphans: p3.orphans });

/* ── 场景 4：同组多条 ⇒ 取最新 ── */
const idx4 = {
	"old-1": { dim: "world", label: "A1 世界观", name: "墟海", at: 100 },
	"new-9": { dim: "world", label: "A1 世界观", name: "墟海", at: 900 }
};
const p4 = planReuse([DIMS[0]], { index: idx4, aliveIds: ["old-1", "new-9"], name: "墟海" });
t("RU-6", "🔴 同组多条 ⇒ 取 `at` **最新**（接续最近的工作，不接早期脏数据）",
	p4.decisions[0].sessionId === "new-9", { got: p4.decisions[0].sessionId, at: p4.decisions[0].at });
t("RU-7", "同组未被选中的存活条目进 `surplus`（**报告 ≠ 删除**）",
	p4.surplus.length === 1 && p4.surplus[0] === "old-1", p4.surplus);

/* ── 场景 5：作品隔离 ── */
const idx5 = {
	"a-xuhai": { dim: "world", label: "A1 世界观", name: "墟海", at: 1 },
	"b-other": { dim: "world", label: "A1 世界观", name: "另一部", at: 999 }
};
const p5 = planReuse([DIMS[0]], { index: idx5, aliveIds: ["a-xuhai", "b-other"], name: "墟海" });
t("RU-8", "🔴 **负对照**：不同作品**不互相命中**（哪怕别的作品 `at` 更大）",
	p5.decisions[0].sessionId === "a-xuhai", { got: p5.decisions[0].sessionId });
const p5b = planReuse([DIMS[0]], { index: idx5, aliveIds: ["a-xuhai", "b-other"], name: "" });
t("RU-9", "🔴 **负对照**：作品名为空 ⇒ 只与**空名**匹配，不命中任何有名条目",
	p5b.decisions[0].action === "create" && p5b.decisions[0].why === "no-match",
	{ action: p5b.decisions[0].action, why: p5b.decisions[0].why });

/* ── 场景 6：同一批次内一个会话只接一个维度 ── */
const dupDims = [{ key: "world", label: "A1 世界观" }, { key: "world", label: "A1 世界观（重复）" }];
const p6 = planReuse(dupDims, {
	index: { "w-1": { dim: "world", label: "A1 世界观", name: "墟海", at: 5 } },
	aliveIds: ["w-1"], name: "墟海"
});
t("RU-10", "🔴 同批次内**一个会话只接一个维度**：第二条 `why=\"already-used\"`（不许两条抢同一条）",
	p6.decisions[0].action === "reuse" && p6.decisions[1].action === "create"
	&& p6.decisions[1].why === "already-used",
	{ d0: p6.decisions[0], d1: p6.decisions[1] });

/* ── 场景 7：降级（读不到宿主存活集）—— **最危险的一处** ── */
const p7 = planReuse(DIMS, { index: idx3, aliveIds: [], name: "墟海", aliveKnown: false });
t("RU-11", "🔴 读不到宿主存活集 ⇒ 全部 `create` + `why=\"alive-unknown\"` + `degraded`（**如实报降级，不静默**）",
	p7.create === 3 && p7.degraded === true && p7.aliveKnown === false
	&& p7.decisions.every((d) => d.why === "alive-unknown"),
	{ create: p7.create, degraded: p7.degraded, whys: p7.decisions.map((d) => d.why) });
t("RU-12", "🔴🔴 降级时**不产孤儿** —— 否则上游会对它们调 `forgetSplits()` ⇒ **一次读取失败清空整份复用索引**",
	p7.orphans.length === 0 && p7.orphanKeys.length === 0 && p7.surplus.length === 0,
	{ orphans: p7.orphans, orphanKeys: p7.orphanKeys, surplus: p7.surplus });

/* ── 场景 8：纯函数性质 ── */
const idxCopy = JSON.stringify(idx3);
const aliveCopy = ["s-world", "s-plot", "s-chars"];
const aliveSnap = JSON.stringify(aliveCopy);
const r1 = planReuse(DIMS, { index: idx3, aliveIds: aliveCopy, name: "墟海" });
const r2 = planReuse(DIMS, { index: idx3, aliveIds: aliveCopy, name: "墟海" });
t("RU-13", "纯函数性质：同输入必同输出；不改入参；`null`/`undefined` 不抛",
	JSON.stringify(r1) === JSON.stringify(r2)
	&& JSON.stringify(idx3) === idxCopy && JSON.stringify(aliveCopy) === aliveSnap
	&& (() => {
		try {
			planReuse(null, null); planReuse(undefined, undefined);
			planReuse(DIMS, { index: null, aliveIds: null, name: null });
			planReuse([{}], { index: { a: {} }, aliveIds: ["a"], name: "" });
			return true;
		} catch (e) { return false; }
	})(),
	{ r1: r1.decisions.length, r2: r2.decisions.length });

/* ── 场景 9：读数文案与角色名 ── */
const sum1 = reuseSummary({ reuse: 6, create: 2 });
t("RU-14", "`reuseSummary` **显式报出复用条数**（用户看不见复用 = 仍以为它在重复建会话）",
	sum1.indexOf("复用已有 6 条") >= 0 && sum1.indexOf("新建 2 条") >= 0, sum1);
const sum2 = reuseSummary({ reuse: 0, create: 3, aliveKnown: false, orphans: ["a"], surplus: ["b", "c"] });
t("RU-14b", "`reuseSummary` 降级时**明写「读不到宿主会话列表」**（不许把降级写成正常）",
	sum2.indexOf("读不到宿主会话列表") >= 0 && sum2.indexOf("降级") >= 0, sum2);
t("RU-15", "`directorRoleOf` 由维度 `label` 推角色名（**不新造命名表**，与导图标签同源）",
	directorRoleOf(DIMS[0]) === "A1 世界观 总监" && directorRoleOf({ label: "A3 剧情" }) === "A3 剧情 总监",
	{ a: directorRoleOf(DIMS[0]) });
t("RU-16", "`directorRoleOf` 取不到 label ⇒ 退化为通用「总监」（**不编**具体职能名）",
	directorRoleOf({}) === "总监" && directorRoleOf(null) === "总监" && directorRoleOf("x") === "总监",
	{ a: directorRoleOf({}), b: directorRoleOf(null) });

/* ══════════════════════════════════════════════════════════════════
 * 场景 10：宿主**标题**弱匹配（19 号文 U10/P9 唯一的冷启动退路）
 * ──────────────────────────────────────────────────────────────────
 * 为什么这一段必须有（第 25 批的真教训）：
 *   U10 的机制**上一版一行测试都没有** ⇒ 判据写错了也没人发现，真机读数一直是
 *   `复用 0 · 新建 8`。上一版的错法：拿 `branchTitle()`（`「A1 世界观」《灵能修仙》`，
 *   **角括号**）去和宿主标题（`【A1 世界观】《灵能修仙》 —— …`，**方头括号**，来自
 *   `briefOf()` 的 head）做**全等**比较 ⇒ 恒 0 命中。
 *   ⇒ 这正是纪律 27「看起来相等 ≠ 同源」：拿"看起来一样"的**另一个**串当判据。
 *   RU-T8/RU-T9 就是把它钉成**可执行**的断言（纪律 32：把错误判据喂进去必须精确报红/报 0）。
 * ══════════════════════════════════════════════════════════════════ */
const SD = await import("../src/logic/split-dimensions.js");
const NAME2 = "灵能修仙";
/** 宿主标题真值形态（第 25 批实测）：`briefOf()` 的 head 原样打头 */
const hostTitle = (dim, novel) => SD.briefTitlePrefix(dim, novel === undefined ? NAME2 : novel) + " —— 请按维度产出并回报";
const WANT = {};
for (let i = 0; i < DIMS.length; i++) WANT[DIMS[i].key] = SD.briefTitlePrefix(DIMS[i], NAME2);

/* T1：三条宿主标题（前缀命中）⇒ 全部复用，且 `why` 必须**自报**是标题救回来的 */
const pool1 = [
	{ sessionId: "h-world", title: hostTitle(DIMS[0]), at: 500 },
	{ sessionId: "h-plot", title: hostTitle(DIMS[1]), at: 600 },
	{ sessionId: "h-chars", title: hostTitle(DIMS[2]), at: 700 }
];
const q1 = planReuse(DIMS, {
	index: {}, aliveIds: ["h-world", "h-plot", "h-chars"], name: NAME2,
	hostTitles: pool1, wantTitles: WANT
});
t("RU-T1", "🔴 索引为空（冷启动）但宿主标题命中前缀 ⇒ **全部复用**、`why=\"title-hit\"`、`titleHit=true`",
	q1.reuse === 3 && q1.create === 0 && q1.decisions.every((d) => d.action === "reuse" && d.why === "title-hit")
	&& q1.titleHit === true && q1.titlePoolN === 3,
	{ reuse: q1.reuse, whys: q1.decisions.map((d) => d.why), titleHit: q1.titleHit, poolN: q1.titlePoolN });
/* T1b：全角空格 / 连续空白要能归一化（宿主标题里可能是全角空格） */
const q1b = planReuse(DIMS, {
	index: {}, aliveIds: ["h-w2"], name: NAME2,
	hostTitles: [{ sessionId: "h-w2", title: "【A1　世界观】《灵能修仙》 —— 简报", at: 10 }],
	wantTitles: WANT
});
t("RU-T1b", "归一化：全角空格 / 连续空白 ⇒ 仍命中（判据在 `titleKey`，不在匹配循环里各写一份）",
	q1b.reuse === 1 && q1b.decisions[0].why === "title-hit", { reuse: q1b.reuse, why: q1b.decisions[0].why });

/* T2：🔴 负对照 —— 「A1 世界观」不许被「A10 配角」命中（前缀族，最容易写 `includes` 踩的地方） */
const q2 = planReuse(DIMS, {
	index: {}, aliveIds: ["h-a10"], name: NAME2,
	hostTitles: [{ sessionId: "h-a10", title: hostTitle({ key: "extra", label: "A10 配角" }), at: 999 }],
	wantTitles: WANT
});
t("RU-T2", "🔴 **负对照**：`【A10 配角】《灵能修仙》` **不**命中 `【A1 世界观】《灵能修仙》`（写 `includes` 就会中）",
	q2.reuse === 0 && q2.decisions.every((d) => d.action === "create") && q2.titlePoolN === 1,
	{ reuse: q2.reuse, whys: q2.decisions.map((d) => d.why) });

/* T3：🔴 负对照 —— 书名是前缀族的另一支（《灵能修仙传》≠《灵能修仙》） */
const q3 = planReuse(DIMS, {
	index: {}, aliveIds: ["h-long"], name: NAME2,
	hostTitles: [{ sessionId: "h-long", title: hostTitle(DIMS[0], "灵能修仙传"), at: 999 }],
	wantTitles: WANT
});
t("RU-T3", "🔴 **负对照**：`《灵能修仙传》` **不**命中 `《灵能修仙》`（收尾的 `》` 就是边界，不需另写规则）",
	q3.reuse === 0 && q3.decisions.every((d) => d.action === "create"),
	{ reuse: q3.reuse, whys: q3.decisions.map((d) => d.why) });

/* T4：同前缀多条 ⇒ 取 `at` 最新（接续最近那条线程，不回到最老的） */
const q4 = planReuse([DIMS[0]], {
	index: {}, aliveIds: ["h-old", "h-new"], name: NAME2,
	hostTitles: [
		{ sessionId: "h-old", title: hostTitle(DIMS[0]), at: 100 },
		{ sessionId: "h-new", title: hostTitle(DIMS[0]), at: 900 }
	],
	wantTitles: WANT
});
t("RU-T4", "同前缀多条 ⇒ 复用 `at` **最新**那条（与索引组的排序同口径）",
	q4.decisions[0].sessionId === "h-new" && q4.decisions[0].why === "title-hit",
	{ picked: q4.decisions[0].sessionId });

/* T5：只有 `no-match` 才退标题 —— `orphan-only` / `already-used` 不许被标题糊过去 */
const q5a = planReuse([DIMS[0]], {
	index: { "gone": { dim: "world", label: "A1 世界观", name: NAME2, at: 50 } }, aliveIds: ["h-w9"],
	name: NAME2, hostTitles: [{ sessionId: "h-w9", title: hostTitle(DIMS[0]), at: 900 }], wantTitles: WANT
});
t("RU-T5", "🔴 `orphan-only`（索引里有、会话已删）**不**退标题 ⇒ 仍旧 `create`（否则索引坏掉会被标题掩盖）",
	q5a.reuse === 0 && q5a.decisions[0].why === "orphan-only",
	{ reuse: q5a.reuse, why: q5a.decisions[0].why });
const q5b = planReuse([DIMS[0], DIMS[0]], {
	index: { "i-1": { dim: "world", label: "A1 世界观", name: NAME2, at: 10 } }, aliveIds: ["i-1", "h-w9"],
	name: NAME2, hostTitles: [{ sessionId: "h-w9", title: hostTitle(DIMS[0]), at: 900 }], wantTitles: WANT
});
t("RU-T5b", "🔴 `already-used` 同理不退标题 ⇒ 第二条 `create`（同批次**一条会话只接一个维度**）",
	q5b.reuse === 1 && q5b.decisions[1].action === "create" && q5b.decisions[1].why === "already-used",
	{ whys: q5b.decisions.map((d) => d.why) });

/* T6：`aliveKnown=false` ⇒ 不做任何标题匹配（读不到存活集时按标题匹配等于凭空造会话） */
const q6 = planReuse(DIMS, {
	index: {}, aliveIds: [], aliveKnown: false, name: NAME2,
	hostTitles: pool1, wantTitles: WANT
});
t("RU-T6", "🔴 读不到宿主存活集 ⇒ **不**按标题匹配（`degraded` + 全部 `alive-unknown`）",
	q6.reuse === 0 && q6.degraded === true && q6.decisions.every((d) => d.why === "alive-unknown"),
	{ reuse: q6.reuse, degraded: q6.degraded, whys: q6.decisions.map((d) => d.why) });

/* T7：不传 `wantTitles` ⇒ 保持旧行为（不猜），且池子读数如实为 0 */
const q7 = planReuse(DIMS, { index: {}, aliveIds: ["h-world", "h-plot", "h-chars"], name: NAME2, hostTitles: pool1 });
t("RU-T7", "不传 `wantTitles` ⇒ **不做**标题匹配（保持旧行为，不猜）且 `titlePoolN=0`（读数可分辨）",
	q7.reuse === 0 && q7.titlePoolN === 0 && q7.titleMissed.length === 0,
	{ reuse: q7.reuse, poolN: q7.titlePoolN, missed: q7.titleMissed });

/* 🔴 T8：**植入缺陷校准**（纪律 32）—— 把**上一版的错判据**喂进去，必须精确 0 命中。
 *    这不是"再测一遍"，而是证明本断言**真的能抓到那个缺陷**：改正之前这里是红的。 */
const WRONG_WANT = {};
for (let i = 0; i < DIMS.length; i++) WRONG_WANT[DIMS[i].key] = SD.branchTitle(DIMS[i], NAME2);
const q8 = planReuse(DIMS, {
	index: {}, aliveIds: ["h-world", "h-plot", "h-chars"], name: NAME2,
	hostTitles: pool1, wantTitles: WRONG_WANT
});
t("RU-T8", "🔴 **植入缺陷校准**：喂 `branchTitle()`（角括号「」）当判据 ⇒ **必须 0 命中**（上一版的真实缺陷；本断言在修正前是红的）",
	q8.reuse === 0 && q8.titleHit === false && q8.titleMissed.length === 3,
	{ reuse: q8.reuse, hit: q8.titleHit, missed: q8.titleMissed, wrong: WRONG_WANT.world });

/* 🔴 T9：**同源守卫**（纪律 27）—— 匹配串必须是 `briefOf()` head 的**逐字前缀**。
 *    这一条把"两份真相"变成机器可判：以后谁把 head 的括号改了而没改匹配串，这里立刻红。 */
const head0 = SD.briefOf(DIMS[0], "需求原文", NAME2, null, null, null, null);
const pref0 = SD.briefTitlePrefix(DIMS[0], NAME2);
t("RU-T9", "🔴 **同源守卫**：`briefOf()` 的 head 以 `briefTitlePrefix()` **逐字开头**（改一处另一处不同步就红）",
	head0.indexOf(pref0 + " —— ") === 0, { head: head0.slice(0, 40), prefix: pref0 });
t("RU-T9b", "🔴 **同源守卫（反面）**：`branchTitle()` 与 `briefTitlePrefix()` **不相同** —— 「看起来相等」的反例本身要留证",
	SD.branchTitle(DIMS[0], NAME2) !== pref0,
	{ branch: SD.branchTitle(DIMS[0], NAME2), prefix: pref0 });

/* T10：0 命中时必须能分辨「没读到标题」与「标题形态变了」（纪律 60） */
const q10 = planReuse(DIMS, { index: {}, aliveIds: [], name: NAME2, hostTitles: [], wantTitles: WANT });
t("RU-T10", "🔴 0 命中时读数可分：池子为空 ⇒ `titlePoolN=0`（**读不到**）；池子非空仍 0 命中 ⇒ `missed` 有值（**形态变了**）",
	q10.titlePoolN === 0 && q10.titleMissed.length === 3 && q2.titlePoolN === 1 && q2.titleMissed.length === 3,
	{ empty: { pool: q10.titlePoolN, missed: q10.titleMissed.length }, nonEmpty: { pool: q2.titlePoolN, missed: q2.titleMissed.length } });

/* 🔴 T11：**接线自证**（纪律 35/79：「函数写好了」≠「接进去了」）。
 *    纯函数 30 条全绿也可能**没人调**（本项目真实发生过：`applyDossiers` 全仓零调用）。
 *    ⇒ 直接读源码断言"派发侧取的是同源前缀，不是 `branchTitle`"。 */
const FS = await import("node:fs");
const srcDispatch = FS.readFileSync(new URL("../src/logic/director-dispatch.js", import.meta.url), "utf8");
const usesPrefix = /wantTitles\[[^\]]*\]\s*=\s*briefTitlePrefix\(/.test(srcDispatch);
const usesBranch = /wantTitles\[[^\]]*\]\s*=\s*branchTitle\(/.test(srcDispatch);
t("RU-T11", "🔴 **接线自证**：`director-dispatch.js` 的 `wantTitles` 取 `briefTitlePrefix()`（**不是** `branchTitle()`）",
	usesPrefix && !usesBranch, { usesPrefix: usesPrefix, usesBranch: usesBranch });

/* T12：`titleHits` 必须是**条数**（不是布尔）—— 上游据此算"索引要补登记几条"：
 *     冷启动下标题命中的那几条**不在索引里**，必须补进去（否则索引永远空着）。 */
t("RU-T12", "🔴 `titleHits` 是**条数**（上游据此补登记进索引；布尔值会让「补几条」无从计算）",
	q1.titleHits === 3 && q2.titleHits === 0 && q1b.titleHits === 1,
	{ q1: q1.titleHits, q2: q2.titleHits, q1b: q1b.titleHits });
/* T13：**补登记接线自证** —— `director-dispatch.js` 的 `recordSplits` 必须排除"索引命中"、
 *     但**包含**"标题命中"（判据取 `why === "index-hit"`，不自己另写一套推断）。 */
const usesIndexHit = /why\s*===\s*"index-hit"/.test(srcDispatch) && /fromIndex\.has/.test(srcDispatch);
const oldOnlyNew = /made\.filter\(\(m\)\s*=>\s*m\.sessionId\s*&&\s*!m\.reused\)/.test(srcDispatch);
t("RU-T13", "🔴 **接线自证**：登记规则 = 「非索引命中」全部补登记（含标题命中）—— 不是上一版的「只登记 `!m.reused`」",
	usesIndexHit && !oldOnlyNew, { usesIndexHit: usesIndexHit, oldOnlyNew: oldOnlyNew });

/* 🔴 T14：**界面接线自证** —— 读数在 `r.reusePlan` 子对象里，界面必须从那里取。
 *    第 25 批真机实测踩到：界面按**顶层**字段读 ⇒ `data-title-pool` 等属性全是空，
 *    而产品侧完全正常（`复用 8`）⇒ 表现成"读数没接线"，闸门 3 条红。
 *    ⇒ 把"从哪儿读"钉成源码断言（纪律 79：写好了 ≠ 接进去了）。 */
const srcPage = FS.readFileSync(new URL("../src/components/DirectorPage.js", import.meta.url), "utf8");
t("RU-T14", "🔴 **界面接线自证**：`DirectorPage.js` 从 `r.reusePlan.*` 读四个读数（不是顶层 `r.titlePoolN`）",
	/r\.reusePlan\s*&&\s*r\.reusePlan\.titlePoolN/.test(srcPage)
	&& /r\.reusePlan\.titleHits/.test(srcPage)
	&& !/r\.titlePoolN\b/.test(srcPage),
	{ hasReusePlanPool: /r\.reusePlan\s*&&\s*r\.reusePlan\.titlePoolN/.test(srcPage), hasTopLevel: /r\.titlePoolN\b/.test(srcPage) });

/* 🔴 T15：**N8 常驻读数的取数对象**（第 25 批第二轮真因 · 纪律 27「看起来相等 ≠ 同源」）；
 *    `DirectorPage` 里有**两棵都叫 tree 的树**：
 *      · `tree`（层级树）—— `loadTree()` 返回**根节点**，字段 `childNodes`，**没有 `rows`**；
 *      · `branch.tree`（分支树）—— 宿主会话血缘，字段 `rows`，与 `getBranchSnapshot()` 同源。
 *    上一版 `data-alive` 接到 `tree.rows` ⇒ 该属性**恒 `undefined`**、文案**恒**「分支树未建立」，
 *    而同一刻宿主快照有 170 行 ⇒ **100% 假读数**（比原来的 `0 条` 更坏：原来只在树没建好时错）。
 *    ⇒ 钉成源码断言（纪律 79：写好了 ≠ 接进去了；纪律 60：三态必须可分）。 */
const aliveFromLive = /"data-alive":\s*liveRows\s*\?/.test(srcPage);
const aliveFromHier = /"data-alive":\s*\(\s*tree\s*&&\s*tree\.rows\s*\)/.test(srcPage);
const liveRowsDef = /const liveRows = \(branch && branch\.tree && Array\.isArray\(branch\.tree\.rows\)\)/.test(srcPage);
t("RU-T15", "🔴 **N8 常驻读数接线自证**：`data-alive` 取**分支树**（`liveRows` 三态），**不是**层级树 `tree.rows`",
	aliveFromLive && liveRowsDef && !aliveFromHier,
	{ aliveFromLive: aliveFromLive, liveRowsDef: liveRowsDef, aliveFromHier: aliveFromHier });

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
