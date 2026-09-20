/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：存储体检（第 41 轮 · `T-PLUG-048` + `T-PLUG-049`）
 * 引用：T-PLUG-048 · T-PLUG-049
 * 上游：components/DirectorPage.js, logic/store-care.js, store/create-store.js, store/persist.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/store-health.js — 存储体检（第 41 轮 · `T-PLUG-048` + `T-PLUG-049`）
 *
 * ── 为什么必须有它（纪律 126：同一语义两处实现 = 隐式断链）─────────────
 *   本仓原有**三处**几乎逐字相同的「枚举 `dsh.director*` 桶」代码：
 *     · `persist.js` 读不到时的 `allKeys` 诊断；
 *     · `persist.js` 保存后的 `lsDump`；
 *     · `create-store.js` 退出前落盘的 dump。
 *   三份都是 `k.indexOf("dsh.director") === 0` + 拼 `(Nbytes)` 字符串，
 *   **只给人眼看日志** ⇒ `T-PLUG-048` 说的那个病：桶总数 / 孤儿数 / 总字节
 *   **在界面上永远不可见**（「消息丢了」的错觉来源，也是配额只增不减的静默来源）。
 *   ⇒ 本模块是**唯一实现**：枚举、字节口径、孤儿判定、淘汰计划全在这里；
 *     调用方只负责「谁渲染」和「谁写盘」。
 *
 * ── 只在 `src/**` 内、不碰宿主（本轮约束）───────────────────────────
 *   全部为**纯函数 + 依赖注入**（`length` / `keyAt` / `getAt` 由调用方给），
 *   故可在 Node 里离线单测与**坏样本校准**（见 `scripts/test-store-budget.mjs`）。
 */

/** 与既有三处 `indexOf("dsh.director") === 0` **逐字一致**（不可改窄：窄了会漏桶） */
export const DIRECTOR_PREFIX = "dsh.director";

/**
 * storage 桶前缀（`DIRECTOR_PREFIX` 的**子集**）。
 * 体检只统计「消息桶」，不统计 `dsh.director.split` / `dsh.director.layout` 这类
 * 单值配置 —— 它们的**语义**是配置不是消息，"孤儿"对它们没有定义。
 * ⚠️ 与 `store/messages.js` 的 `DIRECTOR_STORE_PREFIX` 必须同值（那里是唯一真相源）。
 */
export const STORE_BUCKET_PREFIX = "dsh.director.store.";

/**
 * localStorage 保守总预算（**字符数**口径，非字节）。
 * 🔴 为什么不照抄 `COOKIE_TOTAL_BUDGET`（12288 B）：cookie 单域总限约 4 KB×N，
 *    而 localStorage 常见域限 5 MB（UTF-16 计 ⇒ 约 5 M 字符）。
 *    这里取 **3.5 M 字符**作保守线（留 30% 给宿主自己的 key），
 *    ⚠️ 该值**不照手工计数钉**（纪律 126）—— 它是**说明性阈值**，命中只告警不判死。
 */
export const STORE_TOTAL_BUDGET = 3500000;

/** 单桶告警线（字符）：超过就该看看是不是某条会话堆了太多消息 */
export const STORE_BUCKET_WARN = 400000;

/**
 * 字节估算：localStorage 以 UTF-16 存储 ⇒ 每字符 2 字节。
 * ⚠️ 与 cookie 层的「字节」口径**不同**（cookie 层按 `encodeURIComponent` 后的长度算）
 *    —— 两处数字不可直接比较，见各层自己的头注释。这里给的是**下界**（不含 key 本身）。
 * @param {string|null} text
 * @returns {number}
 */
export function bytesOf(text) {
	return typeof text === "string" ? text.length * 2 : 0;
}

/**
 * 枚举 storage 里所有以 `prefix` 开头的桶（**唯一实现**）。
 * @param {{length:number, keyAt:(i:number)=>string|null, getAt:(k:string)=>string|null, prefix?:string}} io
 *        —— 浏览器里传 `{length: localStorage.length, keyAt: (i)=>localStorage.key(i), getAt: (k)=>localStorage.getItem(k)}`
 * @returns {{keys:string[], buckets:Array<{key:string,chars:number,bytes:number,raw:string|null}>, chars:number, bytes:number, failed:string|null}}
 */
export function scanBuckets(io) {
	const prefix = (io && io.prefix) || DIRECTOR_PREFIX;
	const out = { keys: [], buckets: [], chars: 0, bytes: 0, failed: null };
	if (!io || typeof io.length !== "number" || typeof io.keyAt !== "function") {
		out.failed = "无 storage 句柄（未注入 length/keyAt）";
		return out;
	}
	try {
		for (let i = 0; i < io.length; i++) {
			const k = io.keyAt(i);
			if (!k || k.indexOf(prefix) !== 0) continue;
			let raw = null;
			try { raw = typeof io.getAt === "function" ? io.getAt(k) : null; } catch (e) { raw = null; }
			const chars = typeof raw === "string" ? raw.length : 0;
			out.keys.push(k);
			out.buckets.push({ key: k, chars: chars, bytes: bytesOf(raw), raw: raw });
			out.chars += chars;
			out.bytes += bytesOf(raw);
		}
	} catch (e) {
		/* 🔴 枚举失败必须**显式**（纪律 19：降级可以无声不行）——
		 *    否则「0 个桶」与「枚举炸了」不可分（纪律 58/60）。 */
		out.failed = String((e && e.message) || e);
	}
	/* 稳定排序：按 key 字典序 ⇒ 同一批桶每次读数顺序一致（闸门可比对） */
	out.buckets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	out.keys = out.buckets.map((b) => b.key);
	return out;
}

/**
 * 从桶 key 取回它的**归属标签**（= `safeDirectorKey(sessionId)` 的产物）。
 * `dsh.director.store.director-abc12345` → `director-abc12345`
 * 不属于 store 桶（如 `dsh.director.split`）⇒ 返回 `null`（**不参与**孤儿判定）。
 * @param {string} key
 * @returns {string|null}
 */
export function bucketTagOf(key) {
	const k = String(key == null ? "" : key);
	if (k.indexOf(STORE_BUCKET_PREFIX) !== 0) return null;
	const tag = k.substring(STORE_BUCKET_PREFIX.length);
	return tag || null;
}

/**
 * 桶的**年龄**（用于「最旧优先」淘汰）：取桶内**最后一条消息**的时间戳。
 * 读不到 / 无消息 / JSON 坏 ⇒ `0`（视为最旧 ⇒ **优先被淘汰**，与 cookie 层
 * `_meta.t` 缺失时的处置**同向**）。
 * @param {string|null} raw
 * @returns {number}
 */
export function ageOfPayload(raw) {
	try {
		const o = JSON.parse(raw);
		const ms = o && Array.isArray(o.messages) ? o.messages : [];
		let t = 0;
		for (let i = 0; i < ms.length; i++) {
			const m = ms[i];
			const v = m && (m.ts || m.timestamp || m.at);
			if (typeof v === "number" && v > t) t = v;
		}
		return t;
	} catch (e) { return 0; }
}

/** 桶内消息条数（读不到 ⇒ `-1`，与「有桶但 0 条」可分） */
export function countOfPayload(raw) {
	try {
		const o = JSON.parse(raw);
		return o && Array.isArray(o.messages) ? o.messages.length : -1;
	} catch (e) { return -1; }
}

/**
 * 体检**分类**：谁是孤儿。
 *
 * 🔴 孤儿 = 「这个桶的归属会话**已经不在树上**」（`T-PLUG-048` 原话）。
 *    判定只用**归属标签 ∉ 存活标签集**，不做任何"猜"。
 *
 * 🔴 `aliveTags === null`（宿主服务读不到）⇒ **绝不判孤儿**（`judged:false`）。
 *    把"读不到"当成"全都不在树上"= 一次列出一堆孤儿并诱导用户清理 ⇒ 与
 *    `director-dispatch.js` 里 `archivedSet === null` 的处置**同一条纪律**
 *    （纪律 19：降级可以无声不行，且**不许**把读不到放大成破坏性结论）。
 *
 * @param {Array<{key:string, chars?:number, bytes?:number, raw?:string|null}>} buckets
 * @param {Set<string>|null} aliveTags 存活会话的 `safeDirectorKey` 集
 * @returns {{judged:boolean, why:string, total:number, alive:number, unknown:number, orphan:number,
 *            chars:number, orphanChars:number, unknownChars:number,
 *            orphans:Array<object>, live:Array<object>, unresolved:Array<object>, nonStore:number}}
 */
export function classifyBuckets(buckets, aliveTags) {
	const list = Array.isArray(buckets) ? buckets : [];
	/* 🔴 能不能判，**先定下来**：`aliveTags` 缺失 ⇒ 一条都不判（见 `judged` 说明）。
	 *    不先定这个，下面 `else` 会把"读不到"的桶全塞进 `orphans`
	 *    —— 界面就会在一个**判不了的**状态下报出「孤儿 N」（纪律 19 明令禁止的放大）。 */
	const canJudge = !!(aliveTags && typeof aliveTags.has === "function");
	const live = [];
	const orphans = [];
	const unresolved = [];
	let nonStore = 0;
	let chars = 0;
	let orphanChars = 0;
	let unknownChars = 0;
	for (let i = 0; i < list.length; i++) {
		const b = list[i];
		const tag = bucketTagOf(b && b.key);
		const c = (b && typeof b.chars === "number") ? b.chars : 0;
		if (tag === null) { nonStore++; continue; }
		chars += c;
		/* 主桶（空 sessionId）**永远不是孤儿** —— 它不属于任何会话，是全局兜底 */
		if (tag === "director-main") { live.push(b); continue; }
		if (!canJudge) { unresolved.push(b); unknownChars += c; continue; }
		if (aliveTags.has(tag)) live.push(b);
		else { orphans.push(b); orphanChars += c; }
	}
	return {
		judged: canJudge,
		why: canJudge ? "" : "读不到宿主会话集 ⇒ 不判孤儿（纪律 19：降级可以无声不行）",
		total: live.length + orphans.length + unresolved.length,
		alive: live.length,
		unknown: unresolved.length,
		orphan: orphans.length,
		chars: chars,
		orphanChars: orphanChars,
		unknownChars: unknownChars,
		orphans: orphans,
		live: live,
		unresolved: unresolved,
		nonStore: nonStore
	};
}

/**
 * 淘汰计划（`T-PLUG-049`）：总量超预算 ⇒ **最旧优先**给出一批可删桶。
 * 🔴 **只出计划，不执行**（纪律 81：破坏性动作默认 dry-run）。
 * 🔴 **永不淘汰** `keepKey`（刚写入的那一桶必须可读回 —— 与 cookie 层同约定）。
 * @param {Array<object>} buckets
 * @param {number} budget 字符数预算
 * @param {string} [keepKey]
 * @returns {{over:boolean, before:number, after:number, budget:number, victims:Array<{key:string,chars:number,age:number}>}}
 */
export function planEviction(buckets, budget, keepKey) {
	const list = (Array.isArray(buckets) ? buckets : []).filter((b) => bucketTagOf(b && b.key) !== null);
	const before = list.reduce((s, b) => s + ((b && b.chars) || 0), 0);
	const cap = typeof budget === "number" && budget > 0 ? budget : STORE_TOTAL_BUDGET;
	if (before <= cap) return { over: false, before: before, after: before, budget: cap, victims: [] };
	const aged = list
		.filter((b) => b.key !== keepKey)
		.map((b) => ({ key: b.key, chars: (b && b.chars) || 0, tag: bucketTagOf(b.key), age: ageOfPayload(b && b.raw) }))
		/* 最旧优先；同龄按 key 字典序（**确定性**，便于闸门比对计划本身） */
		.sort((a, b) => a.age - b.age || (a.key < b.key ? -1 : 1));
	const victims = [];
	let now = before;
	for (let i = 0; i < aged.length; i++) {
		if (now <= cap) break;
		victims.push({ key: aged[i].key, chars: aged[i].chars, age: aged[i].age });
		now -= aged[i].chars;
	}
	return { over: true, before: before, after: now, budget: cap, victims: victims };
}

/**
 * 从**真实** `localStorage` 构造 io（唯一实现 —— 三处调用点不再各自写 for 循环）。
 * @param {string} [prefix]
 * @returns {{length:number, keyAt:(i:number)=>string|null, getAt:(k:string)=>string|null, prefix:string, unavailable:string|null}}
 */
export function liveStorageIO(prefix) {
	const p = prefix || DIRECTOR_PREFIX;
	const bad = (why) => ({
		length: 0, prefix: p, unavailable: why,
		keyAt: () => null, getAt: () => null
	});
	if (typeof localStorage === "undefined") return bad("localStorage unavailable");
	try {
		/* 触一次 `length` 以暴露 SecurityError（隐私模式 / 被策略禁用） */
		const n = localStorage.length;
		return {
			length: typeof n === "number" ? n : 0, prefix: p, unavailable: null,
			keyAt: (i) => { try { return localStorage.key(i); } catch (e) { return null; } },
			getAt: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }
		};
	} catch (e) { return bad(String((e && e.message) || e)); }
}

/**
 * 一行人读描述（三处日志**共用**；替代原先各自拼的 `k(Nb)` 串）。
 * 例：`桶 12 个 / 合计 34567 字符 ｜ dsh.director.store.director-a1b2c3d4(1200c) …`
 * @param {object} scan `scanBuckets()` 的返回值
 * @param {{max?:number}} [opts] 最多列几个（默认 8；省略号不省略数字本身）
 * @returns {string}
 */
export function describeBuckets(scan, opts) {
	if (!scan) return "(无扫描结果)";
	if (scan.failed) return "枚举失败：" + scan.failed;
	const max = (opts && opts.max) ? opts.max : 8;
	const shown = scan.buckets.slice(0, max).map((b) => b.key + "(" + b.chars + "c)").join(" ");
	const more = scan.buckets.length > max ? " …共 " + scan.buckets.length + " 个" : "";
	return "桶 " + scan.buckets.length + " 个 / 合计 " + scan.chars + " 字符 ｜ "
		+ (shown || "无") + more;
}

