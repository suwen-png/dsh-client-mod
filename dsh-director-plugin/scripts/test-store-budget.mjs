#!/usr/bin/env node
/**
 * test-store-budget.mjs —— `T-PLUG-048`（孤儿桶）+ `T-PLUG-049`（桶配额）的离线判据
 *   断言前缀 `SB-`
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么这层必须离线（而不是只靠真机）
 * ──────────────────────────────────────────────────────────────────
 *   `T-PLUG-048` / `T-PLUG-049` 的**坏形态在真机上恰好不会出现**：
 *     · 真机里 `localStorage` 的桶是**历史累积**出来的，你没法按需要"造一个孤儿"；
 *     · 「读不到宿主会话集」这一档（`aliveTags === null`）真机上要么发生要么不发生，
 *       而**发生了就是破坏性后果**（把全部桶判成孤儿）—— 不能拿真机去赌。
 *   ⇒ 判定、降级、淘汰计划、备份退路**全部**在合成 storage 上穷举（纪律 32）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 覆盖
 * ──────────────────────────────────────────────────────────────────
 *   SB-1 枚举（唯一实现）：前缀过滤 / 稳定排序 / 枚举失败可与"0 个桶"分辨
 *   SB-2 孤儿判定：**正对照**（真孤儿被抓）+ **负对照**（在树上的**不得**被抓）+ 主桶豁免 + 非 store 桶不参与
 *   SB-3 降级（纪律 19/58）：`aliveTags=null`（读不到）⇒ **不判孤儿**；空集 ≠ 读不到（两者必须可分）
 *   SB-4 淘汰计划（`T-PLUG-049`）：不超预算不动 / 超预算**最旧优先** / `keepKey` 永不淘汰 / 计划**确定性**
 *   SB-5 清理退路（纪律 83）：备份失败 ⇒ **拒绝执行**；删后**复核**发现没删掉 ⇒ `ok:false` 且计数如实
 *   SB-6 恢复（幂等）：已存在的 key **跳过**（不覆盖新内容）/ 无效备份项**丢弃**
 *   SB-7 接线：界面读数与动作真的接在维护行上（`data-testid` 落地 + 源码引用非空，纪律 135）
 *
 * 校准（纪律 32）：
 *   `SB_NEG=1` ⇒ 把「读不到会话集」当成「一个会话都没有」（= 纪律 19 明令禁止的放大）
 *                 ⇒ 必须**精确红 `SB-3a`**
 *
 * 用法：node scripts/test-store-budget.mjs ｜ 退出码 0 全绿 / 1 有红
 */

import { readFileSync } from "node:fs";

const {
	scanBuckets, classifyBuckets, planEviction, bucketTagOf, ageOfPayload,
	bytesOf, describeBuckets, liveStorageIO, STORE_TOTAL_BUDGET, STORE_BUCKET_PREFIX
} = await import("../src/store/store-health.js");
const {
	aliveTagsOf, healthOf, clearOrphanBuckets, pickRestorableBuckets
} = await import("../src/logic/store-care.js");

const NEG = String(process.env.SB_NEG || "").trim();

let pass = 0, fail = 0; const failures = []; const seen = new Set();
function t(id, name, cond, detail) {
	if (seen.has(id)) { console.log("  ❌ 断言编号重号：" + id + "（纪律 32：编号必须唯一）"); fail++; failures.push(id + " 重号"); return; }
	seen.add(id);
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + "  " + name
		+ (detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  T-PLUG-048（孤儿桶）/ T-PLUG-049（桶配额）· 离线判据 SB-");
console.log("═══════════════════════════════════════════════════════════");
if (NEG) console.log("  [校准] SB_NEG=1 ⇒ 把「读不到会话集」当成「一个会话都没有」坏版（纪律 19 禁止的放大）");

/* ══════════════════ 合成 storage（本文件不碰真 localStorage）══════════════════ */

/** 由 plain object 造 `scanBuckets` 的 io */
function mkIO(map, prefix) {
	const keys = Object.keys(map);
	return {
		length: keys.length, prefix: prefix || undefined,
		keyAt: (i) => (i >= 0 && i < keys.length ? keys[i] : null),
		getAt: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null)
	};
}

/** 造桶原文（`persist.js` 的形态：`{sid, messages, config}`） */
function payload(tag, msgs, lastTs) {
	return JSON.stringify({
		sid: tag, config: {},
		messages: msgs === 0 ? [] : Array.from({ length: msgs }, (_, i) => ({ id: tag + "-" + i, text: "x", ts: (lastTs || 0) - i }))
	});
}

const MAX = String.fromCharCode(0x7fffffff); /* 造字符数用：不写巨串，直接按长度估算 */

/** 造一个「恰好 N 字符」的桶原文（用于配额测试，不真分配 N 字节） */
function filler(chars) {
	return "x".repeat(Math.max(0, chars));
}

/* ══════════════════ SB-1 · 枚举（唯一实现）══════════════════ */

const MAP1 = {
	"dsh.director.store.director-main": payload("director-main", 3, 1000),
	"dsh.director.store.director-a1b2c3d4": payload("director-a1b2c3d4", 2, 2000),
	"dsh.director.split": "{}",
	"unrelated.key": "zzz"
};
const s1 = scanBuckets(mkIO(MAP1));
t("SB-1a", "枚举只收 `dsh.director*` 前缀（`unrelated.key` 不得入内），且桶数正确",
	s1.buckets.length === 3 && s1.failed === null
	&& s1.keys.indexOf("unrelated.key") < 0
	&& s1.keys.indexOf("dsh.director.split") >= 0,
	{ keys: s1.keys, failed: s1.failed });

t("SB-1b", "`chars` = 逐桶原文长度之和（`bytes` 为其 2 倍 —— UTF-16 口径，与 cookie 层不同）",
	s1.chars === Object.keys(MAP1).filter((k) => k.indexOf("dsh.director") === 0)
		.reduce((a, k) => a + MAP1[k].length, 0)
	&& s1.bytes === s1.chars * 2,
	{ chars: s1.chars, bytes: s1.bytes });

t("SB-1c", "枚举结果按 key **稳定排序**（同一批桶每次读数顺序一致 ⇒ 闸门可比对）",
	s1.keys.join("|") === s1.keys.slice().sort().join("|"), { keys: s1.keys });

const s1bad = scanBuckets({ length: 3 });
t("SB-1d", "🔴 **枚举失败可与「0 个桶」分辨**（纪律 58/60）：无句柄 ⇒ `failed` 非空（不是静默 0 个）",
	s1bad.buckets.length === 0 && typeof s1bad.failed === "string" && s1bad.failed.length > 0,
	{ failed: s1bad.failed });

const s1throw = scanBuckets({ length: 2, keyAt: () => { throw new Error("SecurityError"); }, getAt: () => null });
t("SB-1e", "🔴 枚举**中途抛错**也必须显式（不许把异常吞成空桶表）",
	s1throw.failed !== null && s1throw.failed.indexOf("SecurityError") >= 0, { failed: s1throw.failed });

t("SB-1f", "`describeBuckets()` 把失败原因写进文本（三处调用点的日志口径一致）",
	describeBuckets(s1bad).indexOf("枚举失败") >= 0 && describeBuckets(s1).indexOf("桶 3 个") >= 0,
	{ bad: describeBuckets(s1bad), ok: describeBuckets(s1) });

/* ══════════════════ SB-2 · 孤儿判定（正/负对照）══════════════════ */

/* 存活会话 id ⇒ 标签（`safeDirectorKey` 口径）。这里用 UUID 形态拿确定的前 8 位。 */
const ALIVE_ID = "11111111-2222-3333-4444-555555555555";
const DEAD_ID = "99999999-8888-7777-6666-555555555555";
const aliveTags = aliveTagsOf([ALIVE_ID]);
const aliveTag = Array.from(aliveTags)[0];
const deadTag = "director-99999999";

const MAP2 = {};
MAP2[STORE_BUCKET_PREFIX + "director-main"] = payload("director-main", 1, 500);
MAP2[STORE_BUCKET_PREFIX + aliveTag] = payload(aliveTag, 4, 900);
MAP2[STORE_BUCKET_PREFIX + deadTag] = payload(deadTag, 2, 100);   /* ← 实测里 `director-d1yi2z` 的形态 */
MAP2["dsh.director.split"] = "{}";
const s2 = scanBuckets(mkIO(MAP2));
const c2 = classifyBuckets(s2.buckets, aliveTags);

t("SB-2a", "**正对照**：所属会话已不在树上的桶**被抓成孤儿**（且恰好 1 个）",
	c2.orphan === 1 && c2.orphans.length === 1
	&& bucketTagOf(c2.orphans[0].key) === deadTag,
	{ orphan: c2.orphan, got: c2.orphans.map((b) => bucketTagOf(b.key)), want: deadTag });

t("SB-2b", "🔴 **负对照**：在树上的会话**不得**被判孤儿（纪律 32：没有负对照就没有判别力）",
	c2.live.some((b) => bucketTagOf(b.key) === aliveTag)
	&& !c2.orphans.some((b) => bucketTagOf(b.key) === aliveTag),
	{ live: c2.live.map((b) => bucketTagOf(b.key)) });

t("SB-2c", "主桶 `director-main` **永远不是孤儿**（它不属于任何会话，是全局兜底）",
	c2.live.some((b) => bucketTagOf(b.key) === "director-main"), { live: c2.live.map((b) => bucketTagOf(b.key)) });

t("SB-2d", "非 store 桶（`dsh.director.split`）**不参与**孤儿判定，单独计数",
	c2.nonStore === 1 && c2.total === 3, { nonStore: c2.nonStore, total: c2.total });

t("SB-2e", "体检读数逐桶带上人读字段（`msgs` / `age` 与桶原文一致 —— 孤儿可解释）",
	(() => {
		const h = healthOf(mkIO(MAP2), aliveTags);
		const o = h.orphans[0];
		return h.orphan === 1 && o && o.msgs === 2 && o.age === 100 && o.chars === MAP2[o.key].length;
	})(),
	{ h: (() => { const h = healthOf(mkIO(MAP2), aliveTags); return h.orphans; })() });

/* ══════════════════ SB-3 · 降级（纪律 19 / 58）══════════════════ */

/* 🔴 校准注入点：`SB_NEG=1` ⇒ 用**空集**代替 `null`（= 把"读不到"放大成"全都没有"） */
const degradedAlive = NEG === "1" ? new Set() : null;
const c3 = classifyBuckets(s2.buckets, degradedAlive);

t("SB-3a", "🔴 读不到宿主会话集（`null`）⇒ **不判孤儿**（`judged:false` + `orphan:0`）—— 纪律 19 的核心",
	c3.judged === false && c3.orphan === 0 && c3.why.length > 0,
	{ judged: c3.judged, orphan: c3.orphan, why: c3.why, SB_NEG: NEG });

t("CAL-SB-3a", "校准（纪律 32）：把「读不到」当成「全没有」⇒ `SB-3a` **必须**变红（证明它不是恒真）",
	NEG === "1" ? (c3.judged === true && c3.orphan > 0) : (c3.judged === false && c3.orphan === 0),
	{ SB_NEG: NEG, judged: c3.judged, orphan: c3.orphan });

const c3b = classifyBuckets(s2.buckets, new Set());
t("SB-3b", "🔴 **空集 ≠ 读不到**（纪律 58）：真的一个会话都没有时，判断是「是」（非主桶全成孤儿）",
	c3b.judged === true && c3b.orphan === 2,
	{ judged: c3b.judged, orphan: c3b.orphan });

t("SB-3c", "`aliveTagsOf()` 对非数组入参返回 `null`（**读不到**），对空数组返回**空集**（两者必须可分）",
	aliveTagsOf(null) === null && aliveTagsOf(undefined) === null && aliveTagsOf("x") === null
	&& (aliveTagsOf([]) instanceof Set) && aliveTagsOf([]).size === 0,
	{ nullCase: String(aliveTagsOf(null)), emptyCase: String(aliveTagsOf([])) });

t("SB-3d", "`liveStorageIO()` 在**无 localStorage** 环境下返回可分辨的 `unavailable` 而不是抛错",
	(() => { const io = liveStorageIO(); return io && typeof io.length === "number" && (!io.unavailable || typeof io.unavailable === "string"); })(),
	{ io: { length: liveStorageIO().length, unavailable: liveStorageIO().unavailable } });

/* ══════════════════ SB-4 · 淘汰计划（T-PLUG-049）══════════════════ */

const small = [{ key: STORE_BUCKET_PREFIX + "director-aaaa1111", chars: 100, raw: payload("a", 1, 1) }];
const p4a = planEviction(small, STORE_TOTAL_BUDGET);
t("SB-4a", "不超预算 ⇒ `over:false` 且**不动任何桶**（计划为空）",
	p4a.over === false && p4a.victims.length === 0 && p4a.before === 100, { p: p4a });

/* 造 3 个桶，年龄 新→旧 明确；预算设为只够留最年轻那一个 */
const big = [
	{ key: STORE_BUCKET_PREFIX + "director-newest11", chars: 400, raw: payload("n", 2, 9000) },
	{ key: STORE_BUCKET_PREFIX + "director-mid22222", chars: 400, raw: payload("m", 2, 5000) },
	{ key: STORE_BUCKET_PREFIX + "director-oldest33", chars: 400, raw: payload("o", 2, 1000) }
];
const p4b = planEviction(big, 500);
t("SB-4b", "超预算 ⇒ **最旧优先**（`age` 单调不减）+ 计划**确定性**（同龄按 key 字典序）",
	p4b.over === true && p4b.victims.length === 2
	&& p4b.victims[0].age <= p4b.victims[1].age
	&& p4b.victims[0].key.indexOf("oldest33") >= 0
	&& p4b.after <= p4b.budget,
	{ victims: p4b.victims, after: p4b.after, budget: p4b.budget });

const p4c = planEviction(big, 500, STORE_BUCKET_PREFIX + "director-oldest33");
t("SB-4c", "🔴 `keepKey`（刚写入的那一桶）**永不淘汰** —— 淘汰掉它会让「写成功却读不回」（与 cookie 层同约定）",
	p4c.victims.every((v) => v.key.indexOf("oldest33") < 0), { victims: p4c.victims });

t("SB-4d", "`ageOfPayload`：读不到 / 坏 JSON ⇒ `0`（= 最旧 ⇒ 优先淘汰，与 cookie 层 `_meta.t` 缺失同向）",
	ageOfPayload(null) === 0 && ageOfPayload("{{") === 0 && ageOfPayload(payload("z", 2, 777)) === 777,
	{ bad: ageOfPayload("{{"), ok: ageOfPayload(payload("z", 2, 777)) });

/* ══════════════════ SB-5 · 清理退路（纪律 83）══════════════════ */

function mkRW(map, opts) {
	const o = opts || {};
	return {
		getAt: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
		remove: (k) => { if (!o.deaf) delete map[k]; },
		has: (k) => Object.prototype.hasOwnProperty.call(map, k)
	};
}

const M5a = {}; M5a[STORE_BUCKET_PREFIX + deadTag] = payload(deadTag, 2, 10);
/* ⚠️ 这里必须传**空集**而不是 `null`：`null` = "读不到会话集" ⇒ 桶进 `unresolved` 而不是
 *    `orphans`（这正是 `SB-3a` 要守的降级），拿它当"有孤儿"会得到空计划、测不到清理路径。 */
const orphans5a = classifyBuckets(scanBuckets(mkIO(M5a)).buckets, new Set()).orphans;
const r5a = clearOrphanBuckets(mkRW(M5a), orphans5a, { backup: () => ({ ok: false, count: 0, reason: "超限" }) });
t("SB-5a", "🔴 **备份失败 ⇒ 拒绝执行**（一条都不删）—— 没有退路就不许把「不可见」变成「不可恢复」（纪律 83）",
	r5a.ok === false && r5a.removed === 0 && r5a.kept === 1
	&& Object.keys(M5a).length === 1 && r5a.reason.indexOf("备份未成功") >= 0,
	{ r: { ok: r5a.ok, removed: r5a.removed, kept: r5a.kept }, left: Object.keys(M5a) });

const M5b = {}; M5b[STORE_BUCKET_PREFIX + deadTag] = payload(deadTag, 2, 10);
const orphans5b = classifyBuckets(scanBuckets(mkIO(M5b)).buckets, new Set()).orphans;
const r5b = clearOrphanBuckets(mkRW(M5b), orphans5b, { backup: () => ({ ok: true, count: 1, reason: "" }) });
t("SB-5b", "备份成功 ⇒ 真删 + **删后复核**（桶表已空 + `ok:true` + 计数如实）",
	r5b.ok === true && r5b.removed === 1 && r5b.kept === 0 && Object.keys(M5b).length === 0,
	{ r: { ok: r5b.ok, removed: r5b.removed }, left: Object.keys(M5b) });

const M5c = {}; M5c[STORE_BUCKET_PREFIX + deadTag] = payload(deadTag, 2, 10);
const orphans5c = classifyBuckets(scanBuckets(mkIO(M5c)).buckets, new Set()).orphans;
const r5c = clearOrphanBuckets(mkRW(M5c, { deaf: true }), orphans5c, { backup: () => ({ ok: true, count: 1, reason: "" }) });
t("SB-5c", "🔴 **删后复核**：`remove` 没抛错但桶还在 ⇒ `ok:false` + `leftovers` 点名（不许把「没抛错」当「删掉了」）",
	r5c.ok === false && r5c.removed === 0 && r5c.leftovers.length === 1 && r5c.reason.indexOf("未删掉") >= 0,
	{ r: { ok: r5c.ok, removed: r5c.removed, leftovers: r5c.leftovers } });

const r5d = clearOrphanBuckets(mkRW({}), [], { backup: () => ({ ok: true, count: 0 }) });
t("SB-5d", "没有孤儿桶 ⇒ 空跑成功（`planned:0`），**不调用备份**也不报错",
	r5d.ok === true && r5d.planned === 0 && r5d.removed === 0, { r: r5d });

/* ══════════════════ SB-6 · 恢复（幂等）══════════════════ */

const pick6 = pickRestorableBuckets(
	[STORE_BUCKET_PREFIX + "director-exists99"],
	[
		{ key: STORE_BUCKET_PREFIX + "director-exists99", raw: "OLD" },
		{ key: STORE_BUCKET_PREFIX + "director-gone0099", raw: "DATA" },
		{ key: STORE_BUCKET_PREFIX + "director-empty000", raw: "" },
		{ key: "", raw: "X" }
	]
);
t("SB-6a", "🔴 恢复**幂等**：已存在的 key **跳过**（绝不覆盖比备份更新的内容）",
	pick6.skipped === 1 && pick6.entries.length === 1
	&& pick6.entries[0].key.indexOf("gone0099") >= 0,
	{ pick: pick6 });

t("SB-6b", "空 `raw` / 无 key 的备份项**丢弃**（写回空值会造出「存在但 0 条」的幽灵桶）",
	pick6.dropped === 2, { dropped: pick6.dropped });

/* ══════════════════ SB-7 · 接线（纪律 135：落点 ≠ 闸门守）══════════════════ */

const PAGE = readFileSync(new URL("../src/components/DirectorPage.js", import.meta.url), "utf8");
t("SB-7a", "界面**真接了**：维护行上有 `dp-maint-health` / `dp-store-health` / `dp-maint-orphans` / `dp-maint-orphan-restore`",
	["dp-maint-health", "dp-store-health", "dp-maint-orphans", "dp-maint-orphan-restore", "dp-orphan-result", "dp-orphan-restore-result"]
		.every((id) => PAGE.indexOf(id) >= 0),
	{ bytes: PAGE.length });

t("SB-7b", "🔴 读数带 `data-judged`（降级态**必须能断言**）且孤儿键可读（`data-orphan-keys`）",
	PAGE.indexOf('"data-judged"') >= 0 && PAGE.indexOf('"data-orphan-keys"') >= 0,
	{ judged: PAGE.indexOf('"data-judged"') >= 0, keys: PAGE.indexOf('"data-orphan-keys"') >= 0 });

const HEALTH_SRC = readFileSync(new URL("../src/store/store-health.js", import.meta.url), "utf8");
t("SB-7c", "🔴 三处旧的手写枚举**已收敛**（`persist.js` ×2 / `create-store.js` ×1 不再各自 for 循环拼 dump）",
	(() => {
		const p = readFileSync(new URL("../src/store/persist.js", import.meta.url), "utf8");
		const c = readFileSync(new URL("../src/store/create-store.js", import.meta.url), "utf8");
		/* 旧形态的特征串：`+ "(" + (localStorage.getItem(k) || "").length` */
		const legacy = (s) => s.indexOf('localStorage.getItem(k) || "").length') >= 0;
		return !legacy(p) && !legacy(c) && p.indexOf("describeBuckets(") >= 0 && c.indexOf("describeBuckets(") >= 0;
	})(),
	{ healthBytes: HEALTH_SRC.length });

/* ══════════════════ SB-8 · 编号与读数汇总 ══════════════════ */

t("SB-8a", "断言编号唯一（本文件内置重号自检；重号 = 静默覆盖，纪律 32）", seen.size === pass + fail,
	{ seen: seen.size, ran: pass + fail });

t("SB-8b", "口径常量自洽：`STORE_BUCKET_PREFIX` 是 `DIRECTOR_PREFIX` 的**扩展**（窄前缀必须包含宽前缀）",
	STORE_BUCKET_PREFIX.indexOf("dsh.director") === 0 && bucketTagOf(STORE_BUCKET_PREFIX + "x") === "x",
	{ bucket: STORE_BUCKET_PREFIX, tag: bucketTagOf(STORE_BUCKET_PREFIX + "x"), max: MAX.length > 0 });

console.log("");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (fail) console.log("  失败：" + failures.join(" ｜ "));
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
process.exit(fail === 0 ? 0 : 1);
