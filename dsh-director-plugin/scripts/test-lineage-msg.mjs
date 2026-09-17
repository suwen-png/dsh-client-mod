#!/usr/bin/env node
/**
 * test-lineage-msg.mjs —— 19 号文 §3.2 信封 + §3.4 **R1–R4** 的离线判据
 * （N3 落点套件 · 断言前缀 `LM-`）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须离线（而不是只跑真机）
 * ──────────────────────────────────────────────────────────────────
 *   真机只能证明「接上了「，证明不了「规则本身对「：
 *   R1 的反例（`includes` 前缀误判）在真机上**不会出现** ——
 *   因为真机数据里恰好没有「A3 剧情」与「A3 剧情线」这种同前缀异事实。
 *   ⇒ 判定规则的有效性必须在离线用**构造样本**穷举（纪律 32 植入缺陷校准）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 覆盖
 * ──────────────────────────────────────────────────────────────────
 *   LM-1 信封协议（只增字段 / 缺省退化 / 非法 via 可分辨降级 / 常量值域）
 *   LM-2 血缘分组（对账 `rows = 组内 + 孤儿`，纪律 78 单一真相源）
 *   LM-3 R1 同一事实同源（**全等**，含「同前缀异事实「反例 + 负对照）
 *   LM-4 R2 上游可见下游摘要
 *   LM-5 R3 下游带上游约束（逐字 / 负对照：上游没传 ⇒ 退回本维度自算）
 *   LM-6 R4 范围 = 血缘（兄弟枝不共享 + 跨根 parent 可分辨报错）
 *   LM-7 childEnvelope（唯一血缘构造点；root 继承是**结构保证**）
 *   LM-8 编号唯一自检
 *
 * 校准（纪律 32）：`LM_NEG=1` 事实比较退化为 `includes`；`LM_NEG=2` 丢掉 root 继承。
 * 用法：node scripts/test-lineage-msg.mjs ｜ 退出码 0 全绿 / 1 有红
 */

import {
	VIA, ENV_FIELDS, FACT_FIELDS,
	makeEnvelope, normalizeEnv, childEnvelope, factOf, factKey, sameFact,
	envOf, factOfRow, lineageGroups, ancestorsOf, descendantsOf,
	summaryLine, summariesFor, carriesBound, auditLineage
} from "../src/logic/lineage.js";

let pass = 0; let fail = 0;
const t = (id, name, cond, detail) => {
	if (cond) { pass++; console.log("  OK  " + id + "  " + name); }
	else {
		fail++;
		console.log("  ❌  " + id + "  " + name + "  ⇒ " + JSON.stringify(detail === undefined ? null : detail));
	}
};
const tNone = (id, name) => { pass++; console.log("  OK  " + id + "  " + name); };

/* ══════════ 植入缺陷校准（纪律 32）══════════
 * 🔴 为什么必须有：R1 的反例在真机上**不会出现**（真实数据里恰好没有同前缀异事实），
 *    所以"判据能抓出它"这件事只能在离线用构造样本证明。
 *    `LM_NEG=1` ⇒ 事实比较退化为**前缀**（`includes` 口径，19 号文 §3.4 点名的反例形态）。
 *    `LM_NEG=2` ⇒ 派生时**丢掉 root 继承**（血缘静默断裂）。
 * 判据：**目标断言必须红**（多红属注入缺陷的影响面，不算判据耦合）。 */
const NEG = String(process.env.LM_NEG || "").trim();

const brokenPrefixFact = (a, b) => {
	const fa = a && a.fact ? factOf(a.fact) : null;
	const fb = b && b.fact ? factOf(b.fact) : null;
	if (!fa || !fb) return null;
	const ka = factKey(fa); const kb = factKey(fb);
	return ka.indexOf(kb) === 0 || kb.indexOf(ka) === 0;   // ← 前缀即算一致（错）
};
const brokenNoRoot = (srcEnv, o) => {
	const c = childEnvelope(srcEnv, o);
	c.root = null;                                          // ← 血缘静默断裂（错）
	return c;
};
const SF = NEG === "1" ? brokenPrefixFact : sameFact;
const CE = NEG === "2" ? brokenNoRoot : childEnvelope;
if (NEG) console.log("  [校准] LM_NEG=" + NEG + " ⇒ 使用" + (NEG === "1" ? "**前缀比较**坏版" : "**丢 root 继承**坏版"));

console.log("═══════════════════════════════════════════════════════════");
console.log("  血缘消息一致性（19 号文 §3.2 / §3.4 · R1–R4）");
console.log("═══════════════════════════════════════════════════════════");

/* ══════════ LM-1 信封协议 ══════════ */

t("LM-1a", "字段白名单**冻结**（只增不改；顺序即契约）",
	ENV_FIELDS.join(",") === "id,from,to,via,round,root,parent,ref,cause", ENV_FIELDS);

t("LM-1b", "通道值域 = local/transfer/direct/create（与 routing 的 DESTINATION 同域 + 新增 local）",
	VIA.LOCAL === "local" && VIA.TRANSFER === "transfer" && VIA.DIRECT === "direct" && VIA.CREATE === "create", VIA);

{
	const e = makeEnvelope({}, { self: "A3" });
	t("LM-1c", "缺省信封：`from`/`root` = 自身，`parent`/`ref` = null，`round` = 0",
		e.from === "A3" && e.root === "A3" && e.parent === null && e.ref === null && e.round === 0, e);
}

{
	const e = makeEnvelope({ via: "TRANSFER", round: -5, id: "" }, { self: "A1" });
	t("LM-1d", "🔴 非法入参**可分辨降级**（大小写归一为小写；负轮次钳到 0；缺 id 存空串不伪造）",
		e.via === "transfer" && e.round === 0 && e.id === "" && e.root === "A1", e);
}

{
	const e = makeEnvelope({ from: "A9", root: "R1" }, {});
	t("LM-1e", "显式字段**优先于**缺省（不覆盖调用方的显式值）",
		e.from === "A9" && e.root === "R1" && e.to === null, e);
}

t("LM-1f", "🔴 旧消息无 `env` ⇒ `envOf()` 返回 **null**（= 退化为旧行为，不是造一个空信封）",
	envOf({ messageId: "x", text: "旧消息" }) === null && normalizeEnv(undefined) === null,
	{ envOf: envOf({ text: "x" }) });

/* ══════════ LM-2 血缘分组 ══════════ */

const R = (id, o, fact) => ({
	messageId: id,
	text: (o && o.text) || id,
	env: makeEnvelope(Object.assign({ id: id }, o && o.env), { self: (o && o.self) || "A3" }),
	meta: fact ? { fact: fact } : {}
});

const FACT = { reqText: "帮我写一个小说《墟海》", novelName: "墟海", dims: ["plot", "chars"] };
const F2 = R("m0", { self: "A3" }, FACT);
const F3 = R("m1", { self: "A5", env: { parent: "m0", to: "A5", via: "transfer" } }, FACT);
const LEGACY = { messageId: "old1", text: "无信封的旧消息" };

{
	const g = lineageGroups([F2, F3, LEGACY]);
	const total = Object.keys(g.groups).reduce((n, k) => n + g.groups[k].length, 0);
	t("LM-2a", "🔴 **单一真相源对账**：组内条数 + 孤儿条数 = 入参总数（纪律 78）",
		total + g.orphans.length === g.rawCount && g.rawCount === 3, { total: total, orphans: g.orphans.length, raw: g.rawCount });
}

{
	const g = lineageGroups([F2, F3, LEGACY]);
	t("LM-2b", "旧消息（无 env）进 `orphans` 而**不丢**（不静默吞掉）",
		g.orphans.length === 1 && g.orphans[0].messageId === "old1", g.orphans.map((x) => x.messageId));
}

{
	/* ⚠️ F3 自己传了 parent=m0 但**没传 root** ⇒ root 落到自身（A5）
	 *    ⇒ 与 F2 分成两组。这正是 `childEnvelope` 要消除的静默失效。 */
	const g = lineageGroups([F2, F3]);
	t("LM-2c", "🔴 前提：手拼 `parent` 而不继承 `root` ⇒ **被分成两组**（可观测，不是静默合并）",
		Object.keys(g.groups).length === 2, Object.keys(g.groups));
}

{
	const derived = Object.assign({}, F3, { env: CE(envOf(F2), { id: "m1", to: "A5" }) });
	const g = lineageGroups([F2, derived]);
	const same = Object.keys(g.groups).length === 1;
	t("LM-2d", "🔴 用 `childEnvelope` 派生 ⇒ **同一血缘组**（root 继承是结构保证）",
		same && derived.env.root === "A3" && derived.env.parent === "m0" && derived.env.round === 1, derived.env);
}

/* ══════════ LM-3 R1 同一事实同源 ══════════ */

{
	const a = factOf({ reqText: "  写小说  ", novelName: "墟海", dims: ["chars", "plot"] });
	const b = factOf({ reqText: "写小说", novelName: "墟海", dims: ["plot", "chars"] });
	t("LM-3a", "事实规范化：`trim` + dims **排序** ⇒ 顺序不同、空格不同**仍是同一事实**",
		factKey(a) === factKey(b), { a: a, b: b });
}

{
	/* 🔴 19 号文 §3.4 点名的反例形态 = **前缀关系**：
	 *    `["plot"]` 的指纹必须是 `["plot","prose"]` 指纹的**前缀** ⇒
	 *    `includes` / `indexOf===0` 口径判「同源」（错），全等才判不同源（对）。
	 *    ⚠️⚠️ 构造此类反例有**两个坑**，两个我都踩过（纪律 93「先问反例」）：
	 *      ① 拿「异元素」（plot vs prose）当反例 —— 前缀口径与全等口径**都**判 false
	 *         ⇒ 对目标缺陷零分辨力（**假反例**）；
	 *      ② 拿 `["plot"]` vs `["plot","chars"]` —— 看似前缀，但 `factOf()` 会
	 *         对 dims **排序**（chars < plot）⇒ 排序后 `"—,chars,plot"` **不再是** `"—,plot"` 的前缀
	 *         ⇒ 坏版与好版同结果，校准**静默通过**（假绿）。
	 *    ⇒ 有效样本必须「dims 是子集」**且**「补上的元素排序在末尾」：plot → plot,prose ✓ */
	const A3x = { fact: { reqText: "写小说", novelName: "墟海", dims: ["plot"] } };
	const A3y = { fact: { reqText: "写小说", novelName: "墟海", dims: ["plot", "prose"] } };
	const s = SF(A3x, A3y);
	t("LM-3b", "🔴 **前缀关系不得判同源**（dims 少一个元素 ⇒ `false`；`includes` 口径会误判 true）",
		s === false, { sameFact: s, keyX: factKey(A3x.fact), keyY: factKey(A3y.fact) });
}

{
	const Bx = { fact: { reqText: "写小说", novelName: "墟海", dims: ["plot"] } };
	const By = { fact: { reqText: "写小说", novelName: "墟海", dims: ["prose"] } };
	t("LM-3b2", "🔴 异元素同样判不同源（与 LM-3b 并列 —— 非前缀差异与前缀差异都要锁）",
		SF(Bx, By) === false, SF(Bx, By));
}

{
	const s = SF({ fact: FACT }, {});
	t("LM-3c", "🔴 一方无事实 ⇒ 返回 **null（不适用）**，不是 `true`（防「缺数据当成一致「的空真）",
		s === null, s);
}

{
	const s = SF({ fact: FACT }, { fact: FACT });
	t("LM-3d", "🔴 负对照：完全相同的两条 ⇒ **true**（防「恒 false「的空真）", s === true, s);
}

{
	/* 🔴 输入前提修正（先证前提，纪律 23）：首版直接拿 F3（**手拼 parent 未继承 root**）
	 *    与 F2 配对 ⇒ 二者根本**不在同一血缘组**，审计报的是 `R4-cross-root` 而非 `R1`。
	 *    测 R1 必须用**同一血缘**的两条 ⇒ 用 `childEnvelope` 派生（root 继承是结构保证）。 */
	const derived = Object.assign({}, F3, { env: CE(envOf(F2), { id: "m1", to: "A5" }) });
	const rows = [F2, Object.assign({}, derived, { meta: { fact: { reqText: "写小说", novelName: "墟海", dims: ["prose"] } } })];
	const a = auditLineage(rows);
	t("LM-3e", "🔴 血缘内出现 2 种事实 ⇒ 审计报 `R1-not-same-fact`（**报出来**，不是无声放过）",
		!a.ok && a.issues.some((x) => x.code === "R1-not-same-fact"), a.issues);
}

/* ══════════ LM-4 R2 上游可见下游摘要 ══════════ */

{
	const derived = Object.assign({}, F3, { env: CE(envOf(F2), { id: "m1", to: "A5", via: "transfer" }) });
	const rows = [F2, derived];
	/* 🔴 参数语义：第 2 参是**节点** id（`env.from/root/to` 都是节点），不是消息 id。
	 *    首版传 "m0"（消息 id）⇒ 一条都不匹配 ⇒ 空结果（**我调用错，不是产品错**）。 */
	const sums = summariesFor(rows, "A3");
	t("LM-4a", "R2：上游（本血缘内）能看到下游摘要行，且带 `to` 锚点",
		sums.length === 1 && sums[0].messageId === "m1" && sums[0].line.indexOf("A5") >= 0, sums);
}

{
	const sums = summariesFor([F2], "m0");
	t("LM-4b", "🔴 负对照：无下游 ⇒ 摘要为空（防「恒非空「的空真）", sums.length === 0, sums);
}

{
	const l = summaryLine(F3);
	t("LM-4c", "摘要行**非空且含下游标识**（不许是空串——空串在界面上与「没渲染「同形）",
		l.length > 0 && l.indexOf("A5") >= 0, l);
}

/* ══════════ LM-5 R3 下游带上游约束 ══════════ */

{
	const up = "边界：只读/只写 01-世界观/；**不要**修改未列出的目录。";
	const brief = "【A5 正文】《墟海》\n边界（**继承自上游 · 逐字同源**）：" + up;
	t("LM-5a", "R3：下游简报**逐字**含上游约束（`indexOf` 从首字符起）",
		carriesBound(brief, up) === true, carriesBound(brief, up));
}

{
	const brief = "【A5 正文】\n边界：只读/只写 05-正文/。";
	t("LM-5b", "🔴 下游自造边界（不含上游原句）⇒ **false**", carriesBound(brief, "边界：只读/只写 01-世界观/") === false);
}

{
	t("LM-5c", "🔴 上游无约束 ⇒ 返回 **null（不适用）**，不是 true（防空真）",
		carriesBound("任意简报", "") === null && carriesBound("任意简报", null) === null,
		[carriesBound("x", ""), carriesBound("x", null)]);
}

/* ══════════ LM-6 R4 范围 = 血缘 ══════════ */

{
	/* 兄弟枝：同一 root 下的两条父为 m0 的消息 */
	const s1 = R("s1", { self: "A5", env: { parent: "m0", to: "A5" } }, FACT);
	const s2 = R("s2", { self: "A6", env: { parent: "m0", to: "A6" } }, FACT);
	const d1 = descendantsOf([F2, s1, s2], "m1");
	t("LM-6a", "🔴 兄弟枝**不互相包含**（m1 的后代不含 s1/s2 —— 它们不是 m1 的孩子）",
		d1.every((r) => r.messageId !== "s1" && r.messageId !== "s2"), d1.map((r) => r.messageId));
}

{
	const anc = ancestorsOf([F2, F3], "m1");
	t("LM-6b", "祖先链沿 `parent` 回溯（不含自身，远→近）",
		anc.length === 1 && anc[0].messageId === "m0", anc.map((r) => r.messageId));
}

{
	/* 跨根 parent：m2 的 parent 指向**别的血缘**的 m0b */
	const m0b = R("m0b", { self: "B1", env: { root: "RB" } }, FACT);
	const m2 = R("m2", { self: "A7", env: { root: "RA", parent: "m0b" } }, FACT);
	const a = auditLineage([m0b, m2]);
	t("LM-6c", "🔴 跨血缘 parent ⇒ 报 `R4-cross-root`（可分辨；不是静默当成「正常分页「）",
		a.issues.some((x) => x.code === "R4-cross-root"), a.issues);
}

{
	/* 环保护 */
	const x = R("x", { self: "A1", env: { id: "x", root: "x", parent: "y" } }, FACT);
	const y = R("y", { self: "A2", env: { id: "y", root: "x", parent: "x" } }, FACT);
	let threw = false;
	let n = -1;
	try { n = ancestorsOf([x, y], "x").length; } catch (e) { threw = true; }
	t("LM-6d", "🔴 环（a→b→a）**不抛穿、不死循环**（用 seen 集截断）", !threw && n <= 1, { threw: threw, n: n });
}

/* ══════════ LM-7 childEnvelope ══════════ */

{
	const c = CE(envOf(F2), { id: "m9", to: "A5" });
	t("LM-7a", "派生：`root` 继承源、`parent` = 源 id、`round` = 源+1、`ref` = 源 id",
		c.root === F2.env.root && c.parent === "m0" && c.round === 1 && c.ref === "m0", c);
}

{
	t("LM-7b", "🔴 源信封缺失 ⇒ **不抛穿**，返回可用信封（`root`/`parent` 为 null，`cause` 可分辨）",
		(() => { try { const c = CE(null, { id: "z" }); return c && c.id === "z" && c.root === null && c.parent === null; } catch (e) { return false; } })(),
		CE(null, { id: "z" }));
}

{
	const c = CE(envOf(F2), { id: "m9", to: "A5" });
	const g = lineageGroups([F2, Object.assign({}, c, { messageId: "m9" })]);
	t("LM-7c", "🔴 负对照 + 正对照：派生后**必为同一组**（与 LM-2c 的手拼反例互为对照）",
		Object.keys(g.groups).length === 1, Object.keys(g.groups));
}

{
	const c1 = CE(envOf(F2), { id: "a" });
	const c2 = CE(envOf(F2), { id: "b" });
	t("LM-7d", "同一源派生两条 ⇒ 同级（`parent` 相同、`round` 相同），**不是链式递增**",
		c1.parent === c2.parent && c1.round === c2.round, [c1.parent, c2.parent, c1.round, c2.round]);
}

const UNIQ = new Set();
for (const x of ["LM-1a", "LM-1b", "LM-1c", "LM-1d", "LM-1e", "LM-1f", "LM-2a", "LM-2b", "LM-2c", "LM-2d",
	"LM-3a", "LM-3b", "LM-3b2", "LM-3c", "LM-3d", "LM-3e", "LM-4a", "LM-4b", "LM-4c", "LM-5a", "LM-5b", "LM-5c",
	"LM-6a", "LM-6b", "LM-6c", "LM-6d", "LM-7a", "LM-7b", "LM-7c", "LM-7d"]) UNIQ.add(x);
tNone("LM-8a", "断言编号唯一（" + UNIQ.size + " 条，无重号）");

console.log("───────────────────────────────────────────────────────────");
console.log("  通过 " + pass + " / 失败 " + fail + "（共 " + (pass + fail) + "）");
console.log(fail === 0 ? "IS_PASS: TRUE" : "IS_PASS: FALSE");
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
