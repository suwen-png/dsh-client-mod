/**
 * util/debug.js — D3 DSH 统一调试日志工具（**A3+D3 合并后的权威实现**）
 *
 * 迁移源：client.js 6854 ~ 6968（115 行）
 *   区块标记：`// ========== DSH 统一调试日志工具 ==========`
 *
 * 职责：统一日志（scope 分级）+ 滚动状态探针 + 页面状态 dump + 日志导出 + 容器诊断。
 * 这是 director 全部业务代码的**基础依赖**，几乎所有块都用 `window.__dshDebug`。
 *
 * 全局契约（不可改名，宿主与业务大量直接调用）：
 *   - `window.__dshDebug` — 完整 API：
 *       .log(scope,msg,data) / .warn(scope,msg,data)
 *       .setScrollState(id,state) / .getScrollState(id)
 *       .exportLogs() → string ／ .clear()
 *       .scrollProbe(id,el) → state
 *       .findScrollContainers(id,fromEl) → chain[]（诊断滚动容器链，最多 15 层）
 *       .dumpState() → {page, scrollStates, logCount, enabled}
 *       .scrollAllToBottom() → count
 *       .toggle() → boolean
 *
 * 注意（原宿主实现的两处特点，迁移时保留）：
 *   1. 原实现用 `if (!window.__dshDebug)` 守卫，意味着**宿主已有实例时不覆盖**。
 *      迁移后改为幂等安装，行为一致（宿主 boot 早于插件时以宿主为准，反之亦然）。
 *   2. `dumpState()` 读 `window.__directorCurrentView/__directorFocusTarget`，
 *      这两个变量由 A11 layout store 与宿主 G1/G4 写入 —— 跨块契约。
 */

export const DSH_DEBUG_MAX_LOGS = 2000;
export const DSH_SCROLL_CHAIN_MAX_DEPTH = 15;
/** 判定"已触底"的像素容差（原实现硬编码 25） */
export const DSH_AT_BOTTOM_TOLERANCE = 25;

export function installDshDebug() {
	if (typeof window === "undefined") return null;
	if (window.__dshDebug) return window.__dshDebug;
	window.__dshDebug = {
		logs: [],
		scrollStates: {},
		enabled: true,
		log: function(scope, message, data) {
			if (!this.enabled) return;
			const entry = { time: new Date().toISOString(), scope: scope, message: message, data: data !== void 0 ? data : null };
			this.logs.push(entry);
			if (this.logs.length > DSH_DEBUG_MAX_LOGS) this.logs.shift();
			console.log("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
		},
		warn: function(scope, message, data) {
			const entry = { time: new Date().toISOString(), scope: scope, message: message, data: data !== void 0 ? data : null, level: "WARN" };
			this.logs.push(entry);
			if (this.logs.length > DSH_DEBUG_MAX_LOGS) this.logs.shift();
			console.warn("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
		},
		setScrollState: function(id, state) {
			this.scrollStates[id] = Object.assign({ time: Date.now() }, state);
		},
		getScrollState: function(id) { return this.scrollStates[id] || null; },
		exportLogs: function() {
			const lines = this.logs.map((e) => "[" + e.time + "] [" + (e.level || "INFO") + "] [" + e.scope + "] " + e.message + (e.data ? " " + JSON.stringify(e.data) : ""));
			const text = lines.join("\n");
			const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url; a.download = "dsh-debug-" + new Date().toISOString().replace(/[:.]/g, "-") + ".log";
			document.body.appendChild(a); a.click(); document.body.removeChild(a);
			URL.revokeObjectURL(url);
			return text;
		},
		clear: function() { this.logs = []; this.scrollStates = {}; },
		scrollProbe: function(id, el) {
			if (!el) return null;
			const state = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= DSH_AT_BOTTOM_TOLERANCE };
			this.setScrollState(id, state);
			return state;
		},
		findScrollContainers: function(id, fromEl) {
			if (!fromEl) { this.log("diag", id + ": fromEl is null"); return []; }
			const chain = [];
			let el = fromEl;
			let depth = 0;
			while (el && depth < DSH_SCROLL_CHAIN_MAX_DEPTH) {
				const style = window.getComputedStyle(el);
				const overflowY = style.overflowY;
				const isScrollable = el.scrollHeight > el.clientHeight + 1 && (overflowY === "auto" || overflowY === "scroll");
				const info = {
					depth: depth,
					tag: el.tagName,
					id: el.id || null,
					cls: (el.className && typeof el.className === "string") ? el.className.slice(0, 60) : null,
					"data-conversation-scroll": el.hasAttribute("data-conversation-scroll"),
					overflowY: overflowY,
					scrollTop: el.scrollTop,
					scrollHeight: el.scrollHeight,
					clientHeight: el.clientHeight,
					offsetHeight: el.offsetHeight,
					isScrollable: isScrollable,
					atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= DSH_AT_BOTTOM_TOLERANCE
				};
				chain.push(info);
				if (isScrollable) {
					this.log("diag", id + ": SCROLLABLE at depth " + depth + " tag=" + el.tagName + " overflowY=" + overflowY + " scrollTop=" + el.scrollTop + " scrollHeight=" + el.scrollHeight + " clientHeight=" + el.clientHeight);
				}
				el = el.parentElement;
				depth++;
			}
			this.log("diag", id + ": chain length=" + chain.length + " scrollables=" + chain.filter(function(c) { return c.isScrollable; }).length);
			return chain;
		},
		dumpState: function() {
			const page = {
				url: location.href,
				directorCurrentView: window.__directorCurrentView || null,
				directorFocusTarget: window.__directorFocusTarget || null,
				activeTab: document.querySelector("[role=tab][aria-selected=true]")?.textContent || null,
				timestamp: new Date().toISOString()
			};
			const scrolls = {};
			for (const [id, s] of Object.entries(this.scrollStates)) {
				scrolls[id] = { scrollTop: s.scrollTop, scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, atBottom: s.atBottom, ageMs: Date.now() - s.time };
			}
			const result = { page: page, scrollStates: scrolls, logCount: this.logs.length, enabled: this.enabled };
			console.log("[DSH] State dump:", result);
			return result;
		},
		scrollAllToBottom: function() {
			const containers = document.querySelectorAll("[data-conversation-scroll], .director-view [style*=overflowY], [style*=overflow-y]");
			let count = 0;
			containers.forEach((el) => {
				if (el.scrollHeight > el.clientHeight) {
					el.scrollTop = el.scrollHeight;
					count++;
				}
			});
			this.log("debug", "scrollAllToBottom: scrolled " + count + " containers");
			return count;
		},
		toggle: function() {
			this.enabled = !this.enabled;
			console.log("[DSH] Debug logging " + (this.enabled ? "ENABLED" : "DISABLED"));
			return this.enabled;
		}
	};
	console.log("[DSH] Debug tool initialized. API: __dshDebug.log(scope,msg,data), .dumpState(), .exportLogs(), .scrollAllToBottom(), .scrollProbe(id,el), .toggle(), .clear()");
	return window.__dshDebug;
}

// ── 便捷包装（原 client.js :6964-6966 同名导出，业务代码直接调用）──
export const dshLog = (scope, message, data) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log(scope, message, data); };
export const dshWarn = (scope, message, data) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn(scope, message, data); };
export const dshScrollProbe = (id, el) => { if (typeof window !== "undefined" && window.__dshDebug) return window.__dshDebug.scrollProbe(id, el); return null; };
