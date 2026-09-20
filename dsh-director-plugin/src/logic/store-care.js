/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：存储体检与孤儿桶治理（第 41 轮 · `T-PLUG-048` + `T-PLUG-049`）
 * 引用：T-PLUG-048 · T-PLUG-049
 * 上游：components/DirectorPage.js
 * 下游：store/store-health.js, store/persist.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/store-care.js — 存储体检与孤儿桶治理（第 41 轮 · `T-PLUG-048` + `T-PLUG-049`）
 *
 * ── 治的是什么病（两条待办的原话）───────────────────────────────
 *   `T-PLUG-048`：`localStorage` 里 `dsh.director.store.director-<key>` 桶，
 *     其**所属会话已不在树上**时**没有任何入口能读到它**（实测 `director-d1yi2z`
 *     桶里留着 **2 条**消息，用户在界面上**永远看不见**）—— 既是"消息丢了"的错觉来源，
 *     又是配额只增不减的静默来源。
 *   `T-PLUG-049`：每切一个作用域就多一个桶，**没有任何上限 / 淘汰 / 用量读数**；
 *     配额打满时 `setItem` **抛异常**，而存储层当前只降级不报数（纪律 19）。
 *
 * ── 本模块的边界 ────────────────────────────────────────────────
 *   · **纯逻辑 + 依赖注入**（storage 由调用方给）⇒ 可离线单测 + 坏样本校准；
 *   · **不碰宿主**（本轮约束：只在 `src/**` 内）；
 *   · 破坏性动作一律「**先备份、再执行、删后复核**」（纪律 83），
 *     且备份失败时**拒绝执行**（不允许"没有退路也清"）。
 */

import { scanBuckets, classifyBuckets, planEviction, ageOfPayload, countOfPayload, bucketTagOf, STORE_TOTAL_BUDGET, STORE_BUCKET_WARN } from "../store/store-health.js";
import { safeDirectorKey } from "../store/persist.js";

/**
 * 由存活会话 id 集算出「存活标签集」。
 * @param {string[]|null} ids `null` / 非数组 ⇒ 返回 `null`（**读不到**，下游不得判孤儿）
 * @returns {Set<string>|null}
 */
export function aliveTagsOf(ids) {
	if (!Array.isArray(ids)) return null;
	const s = new Set();
	for (let i = 0; i < ids.length; i++) {
		const id = ids[i];
		if (!id) continue;
		s.add(safeDirectorKey(String(id)));
	}
	/* 🔴 空数组**不等于**"读不到"：真的一个会话都没有时，标签集是**空集**而不是 null。
	 *    两者下游行为完全相反（空集 ⇒ 所有非主桶都是孤儿；null ⇒ 一条都不判）——
	 *    这与 `_ensure-page` 的"没跑成 ≠ 失败"同一条纪律（纪律 58）。 */
	return s;
}

/**
 * 一次体检的**全部读数**（唯一入口：界面、闸门、日志都从这里取）。
 * @param {object} io storage 句柄（见 `store-health.js#scanBuckets`）
 * @param {Set<string>|null} aliveTags
 * @param {{budget?:number}} [opts]
 * @returns {object}
 */
export function healthOf(io, aliveTags, opts) {
	const scan = scanBuckets(io);
	const cls = classifyBuckets(scan.buckets, aliveTags);
	const plan = planEviction(scan.buckets, (opts && opts.budget) || STORE_TOTAL_BUDGET);
	/* 逐桶补上人读字段（年龄 / 消息条数）—— 只给**孤儿**补，live 桶不解析（省一次 JSON.parse） */
	const orphans = cls.orphans.map((b) => ({
		key: b.key, tag: bucketTagOf(b.key), chars: b.chars,
		msgs: countOfPayload(b.raw), age: ageOfPayload(b.raw)
	}));
	return {
		failed: scan.failed,
		total: cls.total, alive: cls.alive, unknown: cls.unknown, orphan: cls.orphan,
		chars: cls.chars, orphanChars: cls.orphanChars, unknownChars: cls.unknownChars,
		nonStore: cls.nonStore,
		judged: cls.judged, why: cls.why,
		overBudget: plan.over, budget: plan.budget,
		evictPlan: plan.victims,
		overBucketWarn: scan.buckets.filter((b) => bucketTagOf(b.key) !== null && b.chars > STORE_BUCKET_WARN)
			.map((b) => ({ key: b.key, chars: b.chars })),
		orphans: orphans
	};
}

/**
 * 删除孤儿桶：**先备份、再执行、删后复核**（纪律 83）。
 *
 * 🔴 备份失败 ⇒ **一条都不删** 且 `ok:false` + `reason`。
 *    理由：本动作的**唯一**目的就是"清掉用户看不见的残留"，若连退路都没建立就清，
 *    把"不可见"变成"不可恢复" —— 比不做更坏（纪律 83）。
 *
 * @param {{getAt:(k:string)=>string|null, remove:(k:string)=>void, has:(k:string)=>boolean}} io
 * @param {Array<{key:string}>} orphans 待清桶（通常来自 `healthOf().orphans`）
 * @param {{note?:string, backup:(entries:Array<{key:string,raw:string}>, note:string)=>{ok:boolean,count:number,reason:string}}} deps
 * @returns {{ok:boolean, planned:number, removed:number, kept:number, backup:object, leftovers:string[], reason:string}}
 */
export function clearOrphanBuckets(io, orphans, deps) {
	const list = (Array.isArray(orphans) ? orphans : []).filter((b) => b && b.key);
	if (!list.length) {
		return { ok: true, planned: 0, removed: 0, kept: 0, backup: { ok: true, count: 0, reason: "本次没有孤儿桶" }, leftovers: [], reason: "" };
	}
	const entries = [];
	for (let i = 0; i < list.length; i++) {
		let raw = null;
		try { raw = io.getAt(list[i].key); } catch (e) { raw = null; }
		entries.push({ key: list[i].key, raw: raw });
	}
	const backup = deps && typeof deps.backup === "function"
		? deps.backup(entries, (deps && deps.note) || "")
		: { ok: false, count: 0, reason: "未提供备份函数" };
	if (!backup || backup.ok !== true) {
		return { ok: false, planned: list.length, removed: 0, kept: list.length, backup: backup || { ok: false, reason: "无备份函数" }, leftovers: list.map((b) => b.key), reason: "备份未成功 ⇒ 拒绝执行（纪律 83）" };
	}
	let removed = 0;
	const leftovers = [];
	for (let i = 0; i < list.length; i++) {
		const k = list[i].key;
		try {
			io.remove(k);
			/* 🔴 **删后复核**：不复核就报数 = 把 `remove` 的"没抛错"当成"真没了"（纪律 58）。 */
			if (io.has(k)) { leftovers.push(k); } else { removed++; }
		} catch (e) { leftovers.push(k); }
	}
	return {
		ok: leftovers.length === 0,
		planned: list.length, removed: removed, kept: leftovers.length,
		backup: backup, leftovers: leftovers,
		reason: leftovers.length ? ("有 " + leftovers.length + " 个桶未删掉（删后复核仍在）") : ""
	};
}

/**
 * 挑出「需要写回」的桶（**纯函数**，便于离线单测）。
 *
 * 规则（与 `plugin-db.js#pickRestorableRows` 同构，都是"不做就会出新事故"的）：
 *   · 备份里 `raw` 为空 / 非字符串 ⇒ **丢弃**（写回空值会把一个桶变成"存在但 0 条"的幽灵）；
 *   · **当前已存在**的 key ⇒ **跳过** ⇒ 恢复**幂等**，且**绝不覆盖**比备份更新的内容。
 *
 * @param {Iterable<string>|string[]} existingKeys 当前仍存在的桶 key
 * @param {Array<{key:string, raw:string}>} backupBuckets
 * @returns {{entries:Array<{key:string, raw:string}>, skipped:number, dropped:number}}
 */
export function pickRestorableBuckets(existingKeys, backupBuckets) {
	const have = new Set();
	if (existingKeys) {
		if (typeof existingKeys[Symbol.iterator] === "function") {
			for (const k of existingKeys) have.add(String(k));
		}
	}
	const entries = [];
	let skipped = 0, dropped = 0;
	const list = Array.isArray(backupBuckets) ? backupBuckets : [];
	for (let i = 0; i < list.length; i++) {
		const b = list[i];
		if (!b || !b.key) { dropped++; continue; }
		if (typeof b.raw !== "string" || !b.raw) { dropped++; continue; }
		if (have.has(String(b.key))) { skipped++; continue; }
		entries.push({ key: String(b.key), raw: b.raw });
	}
	return { entries: entries, skipped: skipped, dropped: dropped };
}
