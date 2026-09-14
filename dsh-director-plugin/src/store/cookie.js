/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：V10 Cookie 同步存储（分块）
 * 引用：—
 * 上游：store/persist.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/cookie.js — V10 Cookie 同步存储（分块）
 *
 * 迁移源：client.js 5499 ~ 5560
 *
 * 职责：因 cookie 是同步持久化的（Electron 下最可靠），实现大对象分块存入 cookie。
 *      单条 cookie 限约 4KB → 每块 3KB，用 `<key>_meta` 记录块数与原长度。
 *
 * ⚠️ 完整性校验：dshCookieLoad 会比对 `json.length !== meta.len`，不匹配即视为损坏返回 null。
 *    **此校验不可省** —— 分块存储最易发生静默截断。
 *
 * ── 🔴 2026-09-14 补：总体积预算（否则「应用打不开」）──────────────────────
 * 实证故障：用户报「打不开软件」= 窗口全白。根因链：
 *   ① 本模块按 key 分块写 cookie，**只保证单条 < 4KB，从不看总量**；
 *   ② 宿主内嵌 HTTP 服务用 Node 默认 `--max-http-header-size = 16384 B`；
 *   ③ 累积到 **16779 B** 时，文档请求的 Cookie 头越限 ⇒ 服务回 **431** + 空体
 *      ⇒ 渲染进程把响应当 `text/plain` ⇒ `document.documentElement` 只有 39 字节
 *      ⇒ **白屏，且主进程日志一行错都没有**（最难查的那种）。
 *
 * 于是本模块新增：写入后按**最旧优先**裁到 `COOKIE_TOTAL_BUDGET` 以内，
 * 并且**每次淘汰都告警**（降级可以，无声不行）。
 * 注：淘汰只影响 cookie 这一层「同步兜底层」；OPFS/文件适配器仍是主存储。
 */

/** 每块字符数（cookie 单条限约 4KB，留安全余量） */
export const COOKIE_CHUNK_SIZE = 3000;
/** 清除旧块时的最大扫描数（原实现硬编码 100） */
export const COOKIE_MAX_CHUNKS = 100;
/** 默认有效期（天） — 10 年 */
export const COOKIE_DEFAULT_DAYS = 3650;

/**
 * 本插件 cookie 的**总预算（字节）**，按 `name=value` 逐条累加计。
 *
 * 🔴 取值依据（不要随手调大）：宿主服务是 Node，请求头硬上限 16384 B；
 *    实测 16779 B ⇒ 431 ⇒ 白屏。留 12288（= 75%）给 UA / Accept / Sec-Fetch-* 等
 *    其它请求头约 4KB 余量 —— 这些头是**浏览器决定送的**，我们控制不了。
 */
export const COOKIE_TOTAL_BUDGET = 12288;

/** 本插件 cookie 名统一前缀（🔴 冻结契约，不可改名） */
export const COOKIE_PREFIX = "dsh_director_";

/** 统一的告警出口：有 __dshDebug 就走它，没有也要落到 console（不许无声） */
function cookieWarn(msg) {
	try {
		if (typeof window !== "undefined" && window.__dshDebug && window.__dshDebug.warn) window.__dshDebug.warn("persist", msg);
		else if (typeof console !== "undefined" && console.warn) console.warn("[dsh-cookie] " + msg);
	} catch (e) { /* 告警本身不许抛 */ }
}

export function dshCookieSet(name, value, days) {
	try {
		const expires = new Date(Date.now() + (days || COOKIE_DEFAULT_DAYS) * 86400000).toUTCString();
		document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/";
		return true;
	} catch (e) { return false; }
}

export function dshCookieGet(name) {
	try {
		const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\/+^])/g, "\$1") + "=([^;]*)"));
		return match ? decodeURIComponent(match[1]) : null;
	} catch (e) { return null; }
}

/**
 * 统计本插件（`dsh_director_` 前缀）全部 cookie 的体积占用，按**组**（去掉 `_数字` / `_meta` 后缀）归类。
 * 计量口径 = `name + "=" + value` 的长度再加分隔符 2 字节，与请求头里的实际开销同阶。
 * 供预算裁剪与闸门诊断使用；任何异常都退化为空统计并带上 `degraded` 原因。
 */
export function dshCookieUsage() {
	try {
		const raw = typeof document !== "undefined" ? String(document.cookie || "") : "";
		const parts = raw.split(";");
		let total = 0;
		const byKey = {};
		for (let i = 0; i < parts.length; i++) {
			const s = parts[i].replace(/^\s+/, "");
			if (!s || s.indexOf(COOKIE_PREFIX) !== 0) continue;
			const eq = s.indexOf("=");
			const name = eq < 0 ? s : s.slice(0, eq);
			const bytes = s.length + 2;
			total += bytes;
			const key = name.replace(/_\d+$/, "").replace(/_meta$/, "");
			byKey[key] = (byKey[key] || 0) + bytes;
		}
		return { total: total, byKey: byKey, degraded: null };
	} catch (e) {
		return { total: 0, byKey: {}, degraded: String((e && e.message) || e) };
	}
}

/** 删掉一整组（`_meta` + 所有 `_i` 块）。容忍块号不连续 —— 不 break 在第一个空洞处。 */
function dshCookieDropKey(key) {
	let dropped = 0;
	for (let i = 0; i < COOKIE_MAX_CHUNKS; i++) {
		if (dshCookieGet(key + "_" + i) !== null) { dshCookieSet(key + "_" + i, "", -1); dropped++; }
	}
	dshCookieSet(key + "_meta", "", -1);
	return dropped;
}

/** 按「最旧优先」列出各组的写入时间（meta.t）；旧格式没有 t 视为最旧（0） */
function dshCookieKeysByAge() {
	const usage = dshCookieUsage();
	const out = [];
	for (const key of Object.keys(usage.byKey)) {
		let t = 0;
		try {
			const m = JSON.parse(dshCookieGet(key + "_meta") || "null");
			if (m && typeof m.t === "number") t = m.t;
		} catch (e) { t = 0; }
		out.push({ key: key, t: t, bytes: usage.byKey[key] });
	}
	out.sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : 1));
	return out;
}

/**
 * 把本插件 cookie 总量裁到预算内。**永不淘汰 `keepKey`**（刚写入的那组必须可读回）。
 * @returns {{evicted:string[], before:number, total:number, degraded:?string}}
 */
export function dshCookieEnforceBudget(keepKey) {
	const usage = dshCookieUsage();
	const before = usage.total;
	if (usage.degraded) return { evicted: [], before: 0, total: 0, degraded: usage.degraded };
	if (before <= COOKIE_TOTAL_BUDGET) return { evicted: [], before: before, total: before, degraded: null };

	const victims = dshCookieKeysByAge().filter((v) => v.key !== keepKey);
	const evicted = [];
	let now = before;
	for (let i = 0; i < victims.length; i++) {
		if (now <= COOKIE_TOTAL_BUDGET) break;
		dshCookieDropKey(victims[i].key);
		evicted.push(victims[i].key);
		now -= victims[i].bytes;
	}
	const after = dshCookieUsage().total;
	if (evicted.length) {
		cookieWarn("cookie 预算淘汰：" + before + " → " + after + " B（预算 " + COOKIE_TOTAL_BUDGET + "），"
			+ "删除 " + evicted.length + " 组最旧 = " + evicted.join(", ") + "（主存储不受影响）");
	}
	if (after > COOKIE_TOTAL_BUDGET) {
		cookieWarn("cookie 仍超预算：" + after + " > " + COOKIE_TOTAL_BUDGET + "（keep=" + keepKey
			+ " 单组即超出）—— 继续增长会让宿主返回 431 并白屏，请缩减该档内容");
	}
	return { evicted: evicted, before: before, total: after, degraded: null };
}

export function dshCookieSave(key, data) {
	try {
		const json = JSON.stringify(data);
		// 分块存储，每块3KB（cookie单条限制约4KB）
		const chunkSize = COOKIE_CHUNK_SIZE;
		const chunks = [];
		for (let i = 0; i < json.length; i += chunkSize) {
			chunks.push(json.substring(i, i + chunkSize));
		}
		// 先清除旧的块
		for (let i = 0; i < COOKIE_MAX_CHUNKS; i++) {
			const old = dshCookieGet(key + "_" + i);
			if (old === null) break;
			dshCookieSet(key + "_" + i, "", -1);
		}
		// 存储元数据（t = 写入时刻，供「最旧优先」淘汰；缺 t 的旧记录视为最旧）
		dshCookieSet(key + "_meta", JSON.stringify({ chunks: chunks.length, len: json.length, t: Date.now() }), COOKIE_DEFAULT_DAYS);
		// 存储每个块
		for (let i = 0; i < chunks.length; i++) {
			dshCookieSet(key + "_" + i, chunks[i], COOKIE_DEFAULT_DAYS);
		}
		// 🔴 写完立刻对总量做预算裁剪（否则累积超请求头上限 ⇒ 宿主 431 ⇒ 白屏）
		const budget = dshCookieEnforceBudget(key);
		const back = dshCookieGet(key + "_meta");
		if (back === null) {
			cookieWarn("cookie 自检失败：刚写入的 " + key + "_meta 读不回（可能被预算裁剪误伤）");
			return false;
		}
		if (budget && budget.degraded) cookieWarn("cookie 预算裁剪已降级（原因：" + budget.degraded + "）");
		return true;
	} catch (e) {
		if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "cookie save failed: " + e.message);
		else if (typeof console !== "undefined" && console.warn) console.warn("[dsh-cookie] cookie save failed: " + e.message);
		return false;
	}
}

export function dshCookieLoad(key) {
	try {
		const metaStr = dshCookieGet(key + "_meta");
		if (!metaStr) return null;
		const meta = JSON.parse(metaStr);
		if (!meta.chunks || meta.chunks <= 0) return null;
		let json = "";
		for (let i = 0; i < meta.chunks; i++) {
			const chunk = dshCookieGet(key + "_" + i);
			if (chunk === null) return null;
			json += chunk;
		}
		if (json.length !== meta.len) {
			if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "cookie load length mismatch: expected=" + meta.len + " actual=" + json.length);
			return null;
		}
		return JSON.parse(json);
	} catch (e) {
		if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "cookie load failed: " + e.message);
		return null;
	}
}
