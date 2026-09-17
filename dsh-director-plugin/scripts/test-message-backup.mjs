#!/usr/bin/env node
/**
 * test-message-backup.mjs —— 「清除过的东西还能不能拿回来」纯离线测试
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：「总监消息没有持久化么 为什么一个消息都没有」
 *
 * 真机取证结论（2026-09-16 第二十二轮）：
 *   · **通道是好的** —— 点一次「统筹」，页签「总监消息 0 → 1」、库计数 0 → 1（2.5s 内）；
 *   · **库却是空的** —— `directorConversations` 全表 0 条，而 `directorNodes` 有 458 条；
 *   · 凶手 = **验收闸门自己的 D 段**：它测的「清除」是**无参全表清除**，
 *     跑完没人把数据放回去 ⇒ 跑一轮验收 = 用户总监消息清零一次。
 *
 * ⇒ 被测对象是 `store/plugin-db.js` 新增的安全网：
 *   `backupDirectorMessages` / `readMessageBackup` / `pickRestorableRows` / `clearMessageBackup`。
 *   （`restoreDirectorMessages` 需要真 IndexedDB ⇒ 其核心规则抽到纯函数 `pickRestorableRows` 里测。）
 *
 * 🔴 三处最容易"看起来对"的地方（本测试的重点）：
 *   · **幂等**：重复点「恢复」若不去重，会把 1 条变成 2 条 —— 那是**新的数据事故**；
 *   · **超限静默**：备份写不进去却返回 ok ⇒ 用户以为有退路（**假安全网比没有更坏**）；
 *   · **损坏备份抛错**：读备份抛穿会把「恢复」按钮直接打崩（读侧必须收敛成 null）。
 *
 *  | 编号  | 被测行为 | 期望结果 |
 *  |:------|:---------|:---------|
 *  | MB-1  | `pickRestorableRows` 空备份 | `{rows:[], skipped:0}` |
 *  | MB-2  | 🔴 全部已在库 | 一条不写（`rows:[]`），`skipped === N` |
 *  | MB-3  | 🔴 **混合** | 只返回库里没有的那些，其余计入 `skipped` |
 *  | MB-4  | 脏行 | `null` / 无 `messageId` / 空串 **逐条丢弃**，好行保留 |
 *  | MB-5  | 🔴 负对照 | `Set` 与数组两种入参结果**完全一致**（防"只支持一种就假绿"） |
 *  | MB-6  | `backupDirectorMessages` 正常路径 | `ok:true` 且**写后读回一致** |
 *  | MB-7  | 空列表 | `ok:true` / `count:0` / reason 说明"本次没有可备份的消息" |
 *  | MB-8  | 🔴 **超限** | `ok:false` + reason 含「上限」 **且不覆盖旧备份** |
 *  | MB-9  | `readMessageBackup` 无备份 | 返回 `null` |
 *  | MB-10 | 🔴 备份**损坏**（非法 JSON） | 返回 `null` **且不抛**（读侧必须收敛） |
 *  | MB-11 | `clearMessageBackup` | 清后读回 `null` |
 *  | MB-12 | 🔴 **反例校准**（纪律 32） | 把「跳过已存在」这条规则去掉后，结果与 MB-3 必须**不同** |
 *
 * 用法：node scripts/test-message-backup.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

/* ── localStorage stub（与本仓其它单测同写法）──────────────────────── */
const mem = new Map();
globalThis.localStorage = {
	getItem: (k) => (mem.has(k) ? mem.get(k) : null),
	setItem: (k, v) => { mem.set(k, String(v)); },
	removeItem: (k) => { mem.delete(k); },
	clear: () => mem.clear(),
	key: (i) => Array.from(mem.keys())[i] ?? null,
	get length() { return mem.size; }
};

const mod = await import("../src/store/plugin-db.js");
const {
	MSG_BACKUP_KEY, MSG_BACKUP_MAX_BYTES,
	backupDirectorMessages, readMessageBackup, pickRestorableRows, clearMessageBackup
} = mod;

let pass = 0, fail = 0;
const t = (id, desc, cond, extra) => {
	if (cond) { pass += 1; console.log("  ✔ " + id + " " + desc); }
	else {
		fail += 1;
		console.log("  ✘ " + id + " " + desc + (extra === undefined ? "" : "  ← " + JSON.stringify(extra)));
	}
};
const J = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };

console.log("══ test-message-backup · 总监消息备份/恢复（清除的退路）══");

/* ── MB-1..MB-5：恢复挑选规则（纯函数）────────────────────────────── */
const r1 = pickRestorableRows([], []);
t("MB-1", "空备份 ⇒ 不挑任何东西", r1.rows.length === 0 && r1.skipped === 0, r1);

const rows3 = [
	{ messageId: "m1", nodeId: "n", text: "甲" },
	{ messageId: "m2", nodeId: "n", text: "乙" },
	{ messageId: "m3", nodeId: "n", text: "丙" }
];
const r2 = pickRestorableRows(["m1", "m2", "m3"], rows3);
t("MB-2", "🔴 全部已在库 ⇒ 一条不写（幂等的上半）", r2.rows.length === 0 && r2.skipped === 3, r2);

const r3 = pickRestorableRows(["m1", "m3"], rows3);
t("MB-3", "🔴 混合 ⇒ 只写回库里没有的那条",
	r3.rows.length === 1 && r3.rows[0].messageId === "m2" && r3.skipped === 2, r3);

const dirty = [null, { text: "无主键" }, { messageId: "" }, { messageId: null }, { messageId: "good", text: "好行" }];
const r4 = pickRestorableRows([], dirty);
t("MB-4", "脏行逐条丢弃、好行保留（不许整体清空）",
	r4.rows.length === 1 && r4.rows[0].messageId === "good" && r4.skipped === 4, r4);

const r5a = pickRestorableRows(new Set(["m1"]), rows3);
const r5b = pickRestorableRows(["m1"], rows3);
t("MB-5", "🔴 负对照：Set 与数组两种入参结果完全一致",
	J(r5a) === J(r5b) && r5a.rows.length === 2, { set: r5a, arr: r5b });

/* ── MB-6..MB-8：备份写入 ─────────────────────────────────────────── */
mem.clear();
const b1 = backupDirectorMessages(rows3, "单测：正常备份");
const back1 = readMessageBackup();
t("MB-6", "正常路径：`ok:true` 且**写后读回一致**（条数/内容都对）",
	b1.ok === true && b1.count === 3 && !!back1 && back1.count === 3
	&& back1.rows.length === 3 && back1.rows[1].messageId === "m2" && back1.note === "单测：正常备份", { b1: b1, back: back1 && back1.count });

const b2 = backupDirectorMessages([], "单测：空列表");
t("MB-7", "空列表 ⇒ `ok:true`/`count:0`，并**说明原因**（不是静默成功）",
	b2.ok === true && b2.count === 0 && /没有可备份/.test(String(b2.reason)), b2);

/* 🔴 MB-8：超限**必须失败并且不覆盖旧备份** ——
 * "写不进去却报成功"会让用户以为有退路，比没有备份更坏。 */
const huge = [];
const chunk = "x".repeat(4000);
const need = Math.ceil(MSG_BACKUP_MAX_BYTES / 4000) + 5;
for (let i = 0; i < need; i++) huge.push({ messageId: "h" + i, text: chunk });
const b3 = backupDirectorMessages(huge, "单测：超限");
const backAfterHuge = readMessageBackup();
t("MB-8", "🔴 超限 ⇒ `ok:false` + reason 含「上限」**且旧备份原样保留**（没被半截数据覆盖）",
	b3.ok === false && /上限/.test(String(b3.reason))
	&& !!backAfterHuge && backAfterHuge.count === 3 && backAfterHuge.note === "单测：正常备份",
	{ b3: { ok: b3.ok, bytes: b3.bytes, reason: b3.reason }, after: backAfterHuge && backAfterHuge.note });

/* ── MB-9..MB-11：读 / 清 ─────────────────────────────────────────── */
mem.clear();
t("MB-9", "无备份 ⇒ `readMessageBackup()` 返回 null", readMessageBackup() === null);

mem.set(MSG_BACKUP_KEY, "{ 这不是合法 JSON ");
let threw = null, corrupt = "unset";
try { corrupt = readMessageBackup(); } catch (e) { threw = e; }
t("MB-10", "🔴 备份损坏（非法 JSON）⇒ 返回 null **且不抛**（抛穿会把「恢复」按钮打崩）",
	threw === null && corrupt === null, { threw: threw && String(threw.message), ret: corrupt });

mem.set(MSG_BACKUP_KEY, J({ v: 1, rows: "不是数组" }));
let threw2 = null, bad2 = "unset";
try { bad2 = readMessageBackup(); } catch (e) { threw2 = e; }
t("MB-10b", "🔴 结构错（`rows` 不是数组）⇒ 同样返回 null 且不抛",
	threw2 === null && bad2 === null, { threw: threw2 && String(threw2.message), ret: bad2 });

mem.clear();
backupDirectorMessages(rows3, "单测：待清除");
const c1 = clearMessageBackup();
t("MB-11", "`clearMessageBackup()` 清后读回 null", c1 === true && readMessageBackup() === null, { ok: c1 });

/* ── MB-12：反例校准（纪律 32）───────────────────────────────────────
 * 光看 MB-3「只写回 1 条」还不够 —— 得证明**这条判据真的在判**：
 * 把「跳过已存在」这条规则拿掉（模拟"没做幂等"的实现），同一批数据结果必须不同。
 * 否则 MB-3 在"实现根本没做去重"时也可能碰巧通过。 */
const badPick = (existing, rows) => {
	const have = new Set(Array.isArray(existing) ? existing : []);
	const out = (Array.isArray(rows) ? rows : []).filter((r) => r && r.messageId);
	// 故意**不跳过**已存在的（= 会产生副本的实现）
	return { rows: out.filter((r) => !have.has("__never__" + r.messageId)), skipped: 0 };
};
const badR = badPick(["m1", "m3"], rows3);
t("MB-12", "🔴 反例校准：去掉「跳过已存在」后结果与 MB-3 **必然不同**（证明判据不是空真）",
	badR.rows.length === 3 && badR.rows.length !== r3.rows.length,
	{ bad: badR.rows.length, good: r3.rows.length });

console.log("\n" + (fail === 0 ? "IS_PASS: TRUE" : "IS_PASS: FALSE") + "  ｜  PASS " + pass + " / FAIL " + fail);
process.exit(fail === 0 ? 0 : 1);
