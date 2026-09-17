#!/usr/bin/env node
/**
 * test-session-dossier.mjs —— 「每个会话自己的总监 + 自己的会话总结文档」纯离线测试
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：「（每个会话）都有自己的总监,存在自己的会话总结文档」
 * ⇒ 被测对象是 `store/session-dossier.js`：**每会话一份档案**（`director` + `summary`）。
 *
 * 🔴 三处最容易"看起来对"的地方（本测试的重点）：
 *    · **合并式写入**：派发时写 `director`、回收时写 `summary`，两个写入点相隔很久。
 *      若用整体替换，后写的会把先写的**冲掉**，而两次调用**都返回成功**（无声半成功）。
 *    · **`ok` 与正文的一致性**：`ok:true` 却没有正文 ⇒ 读数说"有总结"而实际是空的。
 *    · **`applied` 计数口径**：`rows` 与 `byId` 是**两个对象**，两边都数会让读数翻倍
 *      （第 18 批真机 `dispatchApplied:16` 而台账只有 8 条 —— 同型坑）。
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | SD-1  | 写入 + 读回 | 字段原样 |
 *  | SD-2  | 🔴 **合并式** | 写 `summary` 不冲掉 `director`，反之亦然 |
 *  | SD-3  | 🔴 脏数据 | **逐条**丢弃（`null` / 空 id），好条目保留（**不许整体清空**） |
 *  | SD-4  | 🔴 `source` 白名单 | 非法值归 `none`（防伪造来源） |
 *  | SD-5  | 🔴 `ok` 与正文一致 | `ok:true` 但无正文 ⇒ `ok` 强制 `false` |
 *  | SD-6  | `forgetDossiers` | `removed`/`missed` 分别计数 |
 *  | SD-7  | `clearDossiers` | 返回被清条数（如实汇报） |
 *  | SD-8  | 上限裁剪 | 205 条 ⇒ 保留 `at` 最新的 200 条 |
 *  | SD-9  | 🔴 `applyDossiers` 计数 | `applied` **只数 rows**（not 2 —— byId 不重复计数） |
 *  | SD-10 | `applyDossiers` 只新增 | 宿主真值 / 标题**一个不动** |
 *  | SD-11 | 🔴 **负对照** | 无档案的行**不挂**任何 dossier 字段 |
 *  | SD-12 | `dossierStats` | 总数 / 有总结 / 有总监 / orphans 四路读数 |
 *  | SD-13 | 空 `sessionId` | `putDossier` 返回 `null` 且**不写入** |
 *  | SD-14 | 缓存失效出口 | `resetDossierCache()` 后能读到直接写进 storage 的数据 |
 *
 * 用法：node scripts/test-session-dossier.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

/* localStorage stub（与 test-director-dispatch.mjs 同写法） */
const store = new Map();
globalThis.localStorage = {
	getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
	setItem(k, v) { store.set(String(k), String(v)); },
	removeItem(k) { store.delete(String(k)); }
};

const M = await import("../src/store/session-dossier.js");
const {
	putDossier, dossierOf, readDossiers, writeDossiers, forgetDossiers, clearDossiers,
	applyDossiers, dossierStats, resetDossierCache, DOSSIER_KEY, DOSSIER_MAX, SUMMARY_SOURCES
} = M;

let pass = 0, fail = 0; const failures = [];
const seen = new Set();
function t(id, name, cond, detail) {
	if (seen.has(id)) { console.log("  ❌ 断言编号重号：" + id); fail++; failures.push(id + " 编号重号"); return; }
	seen.add(id);
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name
		+ (detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  test-session-dossier · 每会话自己的总监 + 自己的总结文档");
console.log("═══════════════════════════════════════════════════════════");

clearDossiers();

/* ── SD-1 基本写入读回 ── */
putDossier("s1", { dim: "world", director: { role: "A1 世界观 总监", name: "墟海", at: 1000 }, at: 1000 });
const d1 = dossierOf("s1");
t("SD-1", "写入后能读回：`dim` + `director.role` + `director.name` 原样",
	d1 && d1.dim === "world" && d1.director && d1.director.role === "A1 世界观 总监" && d1.director.name === "墟海",
	d1);

/* ── SD-2 🔴 合并式写入（两个写入点相隔很久，谁也不知道对方写过什么） ── */
putDossier("s1", { summary: { text: "正文摘要一", at: 2000, source: "collect", ok: true }, at: 2000 });
const d2 = dossierOf("s1");
t("SD-2", "🔴 **合并式**：回收写 `summary` **不冲掉**派发写的 `director`（反之亦然）",
	d2.director && d2.director.role === "A1 世界观 总监" && d2.summary && d2.summary.text === "正文摘要一",
	{ director: d2.director, summary: d2.summary });
putDossier("s1", { state: "done", turns: 3, at: 3000 });
const d2b = dossierOf("s1");
t("SD-2b", "🔴 只更新 `state` 时，`director` 与 `summary` **都还在**（patch 语义，不是替换）",
	d2b.director.role === "A1 世界观 总监" && d2b.summary.text === "正文摘要一" && d2b.state === "done",
	{ director: d2b.director && d2b.director.role, summary: d2b.summary && d2b.summary.text, state: d2b.state });

/* ── SD-3 🔴 脏数据逐条丢弃 ── */
localStorage.setItem(DOSSIER_KEY, JSON.stringify({
	v: 1,
	items: { good: { dim: "plot", at: 7 }, bad: null, "": { dim: "x", at: 1 }, empt: { at: 0 } }
}));
resetDossierCache();
const all3 = readDossiers();
t("SD-3", "🔴 脏数据**逐条丢弃**（`null` 条目 / 空 id / 全空条目），好条目保留 —— **不许整体清空**",
	all3.good && all3.good.dim === "plot" && !all3.bad && !all3[""] && !all3.empt,
	{ keys: Object.keys(all3) });

/* ── SD-4 🔴 source 白名单 ── */
clearDossiers();
putDossier("s4", { summary: { text: "x", source: "伪造来源", ok: true }, at: 1 });
t("SD-4", "🔴 `source` 只认白名单 " + JSON.stringify(SUMMARY_SOURCES) + "；非法值归 `none`（防伪造来源上线）",
	dossierOf("s4").summary.source === "none", dossierOf("s4").summary);

/* ── SD-5 🔴 ok 与正文必须一致 ── */
putDossier("s5", { summary: { text: "", source: "collect", ok: true }, at: 1 });
const d5 = dossierOf("s5");
t("SD-5", "🔴 **负对照**：`ok:true` 却**无正文** ⇒ `ok` 强制 `false`（防「读数说有总结、实际是空的」）",
	d5.summary.ok === false && d5.summary.text === "", d5.summary);

/* ── SD-6 / SD-7 删除与清空 ── */
const f6 = forgetDossiers(["s4", "s5", "不存在"]);
t("SD-6", "`forgetDossiers` 分别计 `removed` / `missed`（不存在的静默跳过但**计入 missed**）",
	f6.removed === 2 && f6.missed === 1, f6);
/* 🔴 先**显式建立前提**（此刻库里为空 —— SD-6 把 s4/s5 都删了），
 *    否则"清空返回 0"会被当成通过，而它其实什么都没证明（纪律 41：起点必须满足后续断言前提） */
putDossier("s7", { dim: "world", at: 1 });
const pre7 = Object.keys(readDossiers()).length;
const cleared = clearDossiers();
t("SD-7", "`clearDossiers` 返回被清条数（如实汇报，不是空口「已清空」）",
	pre7 === 1 && cleared === 1 && Object.keys(readDossiers()).length === 0,
	{ pre7, cleared, left: Object.keys(readDossiers()).length });

/* ── SD-8 上限裁剪 ── */
const big = {};
for (let i = 0; i < 205; i++) big["k" + i] = { dim: "world", at: i + 1 };
writeDossiers(big);
const after8 = readDossiers();
t("SD-8", "上限裁剪：205 条 ⇒ 保留 `at` **最新**的 " + DOSSIER_MAX + " 条（最旧的 `k0` 被裁掉）",
	Object.keys(after8).length === DOSSIER_MAX && !after8.k0 && Boolean(after8.k204),
	{ len: Object.keys(after8).length, k0: Boolean(after8.k0), k204: Boolean(after8.k204) });

/* ── SD-9/10/11 挂到树上 ── */
clearDossiers();
putDossier("s1", {
	dim: "world",
	director: { role: "A1 世界观 总监", name: "墟海", at: 1 },
	summary: { text: "正文摘要一", at: 2, source: "collect", ok: true },
	at: 3
});
const tree = {
	rows: [{ sessionId: "s1", title: "原标题", running: false, blank: false, updatedAt: 111 },
		{ sessionId: "s9", title: "无档案的行", running: true }],
	byId: { s1: { sessionId: "s1", title: "原标题", running: false } }
};
const ap = applyDossiers(tree, readDossiers());
t("SD-9", "🔴 `applied` **只数 rows**（1，**不是** 2 —— byId 那份不重复计数；第 18 批 `dispatchApplied:16` 的同型坑）",
	ap.applied === 1, ap);
t("SD-10", "只**新增**字段：宿主真值（`running`/`blank`/`updatedAt`）与标题**一个不动**",
	tree.rows[0].running === false && tree.rows[0].blank === false && tree.rows[0].updatedAt === 111
	&& tree.rows[0].title === "原标题"
	&& tree.rows[0].hasDossier === true && tree.rows[0].dossierRole === "A1 世界观 总监",
	{ row: { running: tree.rows[0].running, title: tree.rows[0].title, role: tree.rows[0].dossierRole } });
t("SD-11", "🔴 **负对照**：无档案的行**不挂**任何 dossier 字段（不许给每行都打标记）",
	!tree.rows[1].hasDossier && tree.rows[1].dossierRole === undefined && tree.rows[1].dossierSummary === undefined
	&& tree.rows[1].title === "无档案的行",
	tree.rows[1]);

/* ── SD-12 读数 ── */
const st = dossierStats(["s1"]);           // s1 存活；此外没有别的档案
t("SD-12", "`dossierStats` 四路读数：total / withSummary / withDirector / orphans",
	st.total === 1 && st.withSummary === 1 && st.withDirector === 1 && st.orphans === 0
	&& st.sources.collect === 1,
	st);
const st2 = dossierStats(["别的会话"]);
t("SD-12b", "🔴 传存活集 ⇒ 能数出 `orphans`（档案在、宿主已无 ⇒ 该清理的对象）",
	st2.orphans === 1, st2);
const st3 = dossierStats();
t("SD-12c", "🔴 **不传存活集** ⇒ `orphans` 恒 0（**不许**把「不知道」当成「都是孤儿」）",
	st3.orphans === 0, st3);

/* ── SD-13 空 id ── */
const beforeN = Object.keys(readDossiers()).length;
const nullRes = putDossier("", { dim: "world", at: 1 });
const nullRes2 = putDossier(null, { dim: "world", at: 1 });
t("SD-13", "空 `/`null` `sessionId` ⇒ `putDossier` 返回 `null` 且**不写入**（不许产生无名档案）",
	nullRes === null && nullRes2 === null && Object.keys(readDossiers()).length === beforeN,
	{ nullRes, len: Object.keys(readDossiers()).length });

/* ── SD-14 缓存失效出口 ── */
localStorage.setItem(DOSSIER_KEY, JSON.stringify({ v: 1, items: { zz: { dim: "chars", at: 42 } } }));
const cached = readDossiers();
resetDossierCache();
const fresh = readDossiers();
t("SD-14", "`resetDossierCache()` 后能读到**直接写进 storage** 的数据（缓存有显式失效出口，不是只进不出）",
	!cached.zz && Boolean(fresh.zz) && fresh.zz.dim === "chars",
	{ cachedHasZz: Boolean(cached.zz), freshHasZz: Boolean(fresh.zz) });

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
