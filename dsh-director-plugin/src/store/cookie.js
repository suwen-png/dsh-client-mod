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
 */

/** 每块字符数（cookie 单条限约 4KB，留安全余量） */
export const COOKIE_CHUNK_SIZE = 3000;
/** 清除旧块时的最大扫描数（原实现硬编码 100） */
export const COOKIE_MAX_CHUNKS = 100;
/** 默认有效期（天） — 10 年 */
export const COOKIE_DEFAULT_DAYS = 3650;

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
		// 存储元数据
		dshCookieSet(key + "_meta", JSON.stringify({ chunks: chunks.length, len: json.length }), COOKIE_DEFAULT_DAYS);
		// 存储每个块
		for (let i = 0; i < chunks.length; i++) {
			dshCookieSet(key + "_" + i, chunks[i], COOKIE_DEFAULT_DAYS);
		}
		return true;
	} catch (e) {
		if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "cookie save failed: " + e.message);
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
