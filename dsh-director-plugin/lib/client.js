window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-director-plugin",
	factory: (require) => {
		// 平台模块（React / cordis / slots 等）由 factory 的 require 提供，不打包（ADR-001）。
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ── 模块运行时 ──
		var __reg = Object.create(null);
		var __defs = Object.create(null);
		var __defaults = Object.create(null);
		function __m(id) {
			if (__reg[id] !== void 0) return __reg[id];
			var def = __defs[id];
			if (def === void 0) throw new Error("[dsh-director-plugin] unknown module: " + id);
			var ex = {};
			__reg[id] = ex;
			def(ex);
			return ex;
		}

		// ── util/debug.js ──
		__defs["util/debug.js"] = function (exports) {
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
			
			const DSH_DEBUG_MAX_LOGS = 2000;
			const DSH_SCROLL_CHAIN_MAX_DEPTH = 15;
			/** 判定"已触底"的像素容差（原实现硬编码 25） */
			const DSH_AT_BOTTOM_TOLERANCE = 25;
			
			function installDshDebug() {
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
			const dshLog = (scope, message, data) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log(scope, message, data); };
			const dshWarn = (scope, message, data) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn(scope, message, data); };
			const dshScrollProbe = (id, el) => { if (typeof window !== "undefined" && window.__dshDebug) return window.__dshDebug.scrollProbe(id, el); return null; };
			
			exports.DSH_DEBUG_MAX_LOGS = DSH_DEBUG_MAX_LOGS;
			exports.DSH_SCROLL_CHAIN_MAX_DEPTH = DSH_SCROLL_CHAIN_MAX_DEPTH;
			exports.DSH_AT_BOTTOM_TOLERANCE = DSH_AT_BOTTOM_TOLERANCE;
			exports.installDshDebug = installDshDebug;
			exports.dshLog = dshLog;
			exports.dshWarn = dshWarn;
			exports.dshScrollProbe = dshScrollProbe;
		};

		// ── util/log-collector.js ──
		__defs["util/log-collector.js"] = function (exports) {
			/**
			 * util/log-collector.js — A3 专用 Log 收集器
			 *
			 * 迁移源：client.js 5799 ~ 5834（36 行）
			 *   区块标记：`// ========== V9: 专用Log收集器（用户无法打开控制台，用这个收集+导出） ==========`
			 *
			 * 职责：因用户无法打开 DevTools，自建环形日志缓冲 + 一键导出为 txt。
			 *
			 * 与 D3（util/debug.js）的关系：
			 *   - A3 是早期雏形，D3 是完整版；本文件**保留 A3 的对外 API 形态**
			 *     （`window.__dshV9Log`），因其在宿主与业务代码中被大量直接调用，
			 *     改名会引发大面积失效。
			 *   - A3 内部已委托 D3：`if (window.__dshDebug) window.__dshDebug.log(...)`，
			 *     故两者天然共振，无需额外桥接。
			 *
			 * 全局契约：`window.__dshV9Log` — 宿主 client.js 多处直接调用（如 11782/11789/11791/11795）
			 */
			
			const V9_LOG_MAX = 2000;
			const V9_LOG_TRIM_TO = 1000;
			
			function installV9Log() {
				if (typeof window === "undefined") return null;
				if (window.__dshV9Log) return window.__dshV9Log;
				window.__dshV9Log = {
					logs: [],
					log: function(scope, message, data) {
						try {
							var entry = { time: new Date().toISOString(), scope: scope, message: message };
							if (data !== undefined) {
								try { entry.data = typeof data === "object" ? JSON.stringify(data).slice(0, 800) : String(data).slice(0, 800); } catch(e) { entry.data = "[unserializable]"; }
							}
							this.logs.push(entry);
							if (this.logs.length > V9_LOG_MAX) this.logs = this.logs.slice(-V9_LOG_TRIM_TO);
							// 同时输出到控制台（如果可用）
							if (window.__dshDebug) window.__dshDebug.log(scope, message, data);
						} catch(e) {}
					},
					export: function() {
						try {
							var text = this.logs.map(function(l) { return "[" + l.time + "] [" + l.scope + "] " + l.message + (l.data ? " | " + l.data : ""); }).join("\n");
							var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
							var url = URL.createObjectURL(blob);
							var a = document.createElement("a");
							a.href = url;
							a.download = "dsh-v9-log-" + Date.now() + ".txt";
							document.body.appendChild(a);
							a.click();
							document.body.removeChild(a);
							URL.revokeObjectURL(url);
							return "已导出 " + this.logs.length + " 条日志";
						} catch(e) { return "导出失败: " + e.message; }
					},
					clear: function() { this.logs = []; return "已清空"; },
					count: function() { return this.logs.length; }
				};
				window.__dshV9Log.log("V9-init", "V9 Log收集器已初始化，调用 window.__dshV9Log.export() 导出日志");
				return window.__dshV9Log;
			}
			
			exports.V9_LOG_MAX = V9_LOG_MAX;
			exports.V9_LOG_TRIM_TO = V9_LOG_TRIM_TO;
			exports.installV9Log = installV9Log;
		};

		// ── store/layout.js ──
		__defs["store/layout.js"] = function (exports) {
			/**
			 * store/layout.js — A11 布局 store
			 *
			 * 迁移源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
			 *   行范围：6439 ~ 6483（45 行）
			 *   区块标记：`// ========== 总监对话模式 - 布局store（小窗宽度/折叠/焦点） ==========`
			 *
			 * 职责：小窗宽度 / 折叠状态 / 焦点目标 / 上下伸缩面板高度的集中状态层。
			 *
			 * ⚠️ 兼容约束（R5）：持久化 key `dsh.director.layout` **必须原样保留**，
			 *    改名将导致用户存量布局数据全部丢失。
			 *
			 * 全局契约（宿主 G1/G4 依赖）：
			 *   - `window.__directorLayoutStore` — 宿主 ChatView（client.js:7111）与 view-sync（client.js:9146）调用
			 *   - `window.__directorFocusTarget` — setFocusTarget 同步写入（client.js:6469）
			 */
			
			const DIRECTOR_LAYOUT_KEY = "dsh.director.layout";
			
			function createDirectorLayoutStore() {
				let state = {
					directorPanelWidth: 300,
					chatPanelWidth: 300,
					directorPanelCollapsed: false,
					chatPanelCollapsed: false,
					focusTarget: "director",
					// V7: 上下伸缩界面
					bottomPanelHeight: 180,
					bottomPanelCollapsed: true,
					topPanelCollapsed: false
				};
				try {
					const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DIRECTOR_LAYOUT_KEY) : null;
					if (raw) state = { ...state, ...JSON.parse(raw) };
				} catch (e) {}
				const listeners = new Set();
				function notify() {
					try { if (typeof localStorage !== "undefined") localStorage.setItem(DIRECTOR_LAYOUT_KEY, JSON.stringify(state)); } catch (e) {}
					for (const fn of listeners) fn(state);
				}
				return {
					getState: () => state,
					subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
					setDirectorWidth: (w) => { state = { ...state, directorPanelWidth: Math.max(180, Math.min(w, 600)) }; notify(); },
					setChatWidth: (w) => { state = { ...state, chatPanelWidth: Math.max(180, Math.min(w, 600)) }; notify(); },
					toggleDirectorCollapsed: () => { state = { ...state, directorPanelCollapsed: !state.directorPanelCollapsed }; notify(); },
					toggleChatCollapsed: () => { state = { ...state, chatPanelCollapsed: !state.chatPanelCollapsed }; notify(); },
					setFocusTarget: (target) => { state = { ...state, focusTarget: target }; notify(); if (typeof window !== "undefined") window.__directorFocusTarget = target; },
					// V7: 上下伸缩
					setBottomPanelHeight: (h) => { state = { ...state, bottomPanelHeight: Math.max(60, Math.min(h, 400)) }; notify(); },
					toggleBottomPanel: () => { state = { ...state, bottomPanelCollapsed: !state.bottomPanelCollapsed }; notify(); },
					setBottomPanelCollapsed: (v) => { state = { ...state, bottomPanelCollapsed: v }; notify(); },
					toggleTopPanel: () => { state = { ...state, topPanelCollapsed: !state.topPanelCollapsed }; notify(); }
				};
			}
			
			/** 单例 + 挂载全局（宿主依赖 window.__directorLayoutStore） */
			const directorLayoutStore = createDirectorLayoutStore();
			if (typeof window !== "undefined") window.__directorLayoutStore = directorLayoutStore;
			
			exports.DIRECTOR_LAYOUT_KEY = DIRECTOR_LAYOUT_KEY;
			exports.createDirectorLayoutStore = createDirectorLayoutStore;
			exports.directorLayoutStore = directorLayoutStore;
		};

		// ── store/theme.js ──
		__defs["store/theme.js"] = function (exports) {
			/**
			 * store/theme.js — A12 V9-Design D-01 主题变量体系
			 *
			 * 迁移源：client.js 6484 ~ 6537（54 行）
			 *   区块标记：`// ========== V9-Design D-01: 主题变量体系 ==========`
			 *
			 * 职责：主题令牌集中定义 + localStorage 持久化 + CSS 变量注入 documentElement。
			 *
			 * ⚠️ 兼容约束（R5）：持久化 key `dsh-v9-theme` **必须原样保留**。
			 * ⚠️ V9.5 桥接：`--dsh-bg0/bg1/--border` 桥接到 Harness 原生暗色令牌
			 *    （`--dsw-alias-bg-base` / `--dsw-alias-border-l2`），使面板跟随原生主题。
			 *    这些 CSS 变量名是宿主样式表的契约，**不可改名**。
			 */
			
			const DSH_THEME_KEY = "dsh-v9-theme";
			const DSH_THEME_DEFAULTS = { ac: "#2f6feb", ac2: "#38bdf8", mem: "#a78bfa", density: 1 };
			
			/** 十六进制 → rgba，alpha 由调用方给定；解析失败回落到默认蓝 */
			function dshHexSoft(hex, alpha) {
				try {
					const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
					if (!m) return "rgba(47,111,235,0.14)";
					const n = parseInt(m[1], 16);
					return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + alpha + ")";
				} catch (e) { return "rgba(47,111,235,0.14)"; }
			}
			
			function dshLoadTheme() {
				try {
					const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DSH_THEME_KEY) : null;
					if (raw) return { ...DSH_THEME_DEFAULTS, ...JSON.parse(raw) };
				} catch (e) {}
				return { ...DSH_THEME_DEFAULTS };
			}
			
			function dshApplyThemeVars(theme) {
				if (typeof document === "undefined") return;
				try {
					const r = document.documentElement.style;
					r.setProperty("--dsh-ac", theme.ac);
					r.setProperty("--dsh-ac-soft", dshHexSoft(theme.ac, 0.14));
					r.setProperty("--dsh-ac2", theme.ac2);
					r.setProperty("--dsh-mem", theme.mem);
					r.setProperty("--dsh-density", String(theme.density || 1));
					// V9.5: 面板底色/边框令牌桥接到 Harness 原生暗色令牌（a1/z-tab 通用，跟随原生主题）
					r.setProperty("--dsh-bg0", "var(--dsw-alias-bg-base)");
					r.setProperty("--dsh-bg1", "var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-base))");
					r.setProperty("--border", "var(--dsw-alias-border-l2)");
				} catch (e) {}
			}
			
			const dshThemeStore = (function() {
				let theme = dshLoadTheme();
				const listeners = new Set();
				function notify(persist) {
					if (persist) { try { if (typeof localStorage !== "undefined") localStorage.setItem(DSH_THEME_KEY, JSON.stringify(theme)); } catch (e) {} }
					dshApplyThemeVars(theme);
					for (const fn of listeners) fn(theme);
				}
				return {
					getTheme: () => theme,
					subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
					setTheme: (patch) => { theme = { ...theme, ...patch }; notify(true); },
					reset: () => { theme = { ...DSH_THEME_DEFAULTS }; try { if (typeof localStorage !== "undefined") localStorage.removeItem(DSH_THEME_KEY); } catch (e) {} notify(false); }
				};
			})();
			
			if (typeof window !== "undefined") { window.__dshTheme = dshThemeStore; dshApplyThemeVars(dshThemeStore.getTheme()); }
			
			exports.DSH_THEME_KEY = DSH_THEME_KEY;
			exports.DSH_THEME_DEFAULTS = DSH_THEME_DEFAULTS;
			exports.dshHexSoft = dshHexSoft;
			exports.dshLoadTheme = dshLoadTheme;
			exports.dshApplyThemeVars = dshApplyThemeVars;
			exports.dshThemeStore = dshThemeStore;
		};

		// ── config/model.js ──
		__defs["config/model.js"] = function (exports) {
			/**
			 * config/model.js — C2 配置与本地模型
			 *
			 * 迁移源：client.js 6612 ~ 6702（91 行）
			 *   区块标记：`// ========== 总监对话模式 - 配置与本地模型 ==========`
			 *
			 * 职责：
			 *   1. 总监配置读写（localStorage `dsh.director.config`）
			 *   2. Ollama 本地模型调用（`POST /api/generate`，60s 超时）
			 *   3. Ollama 可用性探测（`GET /api/tags` + 目标模型匹配）
			 *   4. 语言规范整理（纯函数）
			 *   5. 任务分类（纯函数，5 类：code/design/research/writing/chat）
			 *
			 * ⚠️ 兼容约束（R5）：持久化 key `dsh.director.config` **必须原样保留**。
			 * 全局契约：`window.__directorConfig` / `window.__dshCheckOllama` / `window.__dshOllamaStatus`
			 */
			
			const DIRECTOR_CONFIG_KEY = "dsh.director.config";
			/** Ollama 默认端点与模型（历史值，勿改） */
			const OLLAMA_DEFAULT_ENDPOINT = "http://localhost:11434";
			const OLLAMA_DEFAULT_MODEL = "qwen2:7b";
			/** 本地模型调用超时（ms） — 原实现硬编码 60000 */
			const LOCAL_MODEL_TIMEOUT_MS = 60000;
			
			function loadDirectorConfig() {
				try {
					const raw = localStorage.getItem(DIRECTOR_CONFIG_KEY);
					if (raw) return JSON.parse(raw);
				} catch (e) {}
				return {
					autoForward: false,
					localModel: { enabled: true, endpoint: OLLAMA_DEFAULT_ENDPOINT, model: OLLAMA_DEFAULT_MODEL },
					duties: {
						languagePolish: { enabled: true, name: "语言规范整理" },
						contextMemory: { enabled: true, name: "上下文记忆" },
						executionLogic: { enabled: true, name: "执行逻辑分析" },
						modelRouting: { enabled: false, name: "模型路由" },
						returnReview: { enabled: true, name: "对话返回审核" }
					}
				};
			}
			
			function saveDirectorConfig(config) {
				try { localStorage.setItem(DIRECTOR_CONFIG_KEY, JSON.stringify(config)); } catch (e) {}
			}
			
			const directorConfig = loadDirectorConfig();
			if (typeof window !== "undefined") window.__directorConfig = directorConfig;
			
			/** 本地模型调用（Ollama 兼容）。失败/超时返回 null，不抛异常 */
			async function callLocalModel(prompt, config) {
				if (!config.localModel?.enabled) return null;
				const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
				const timeoutId = controller ? setTimeout(() => controller.abort(), LOCAL_MODEL_TIMEOUT_MS) : null;
				try {
					const endpoint = config.localModel.endpoint.replace(/\/$/, "");
					const resp = await fetch(`${endpoint}/api/generate`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ model: config.localModel.model, prompt: prompt, stream: false }),
						signal: controller ? controller.signal : undefined
					});
					if (!resp.ok) {
						if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("localModel", "Ollama returned HTTP " + resp.status);
						return null;
					}
					const data = await resp.json();
					return data.response || null;
				} catch (e) {
					if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("localModel", "callLocalModel failed: " + e.message);
					return null;
				}
				finally { if (timeoutId !== null) clearTimeout(timeoutId); }
			}
			
			/** Ollama 状态检测：返回 {available, reason, models[, targetModel]} */
			async function checkOllamaStatus(config) {
				if (!config.localModel?.enabled) return { available: false, reason: "disabled", models: [] };
				try {
					const endpoint = config.localModel.endpoint.replace(/\/$/, "");
					const resp = await fetch(`${endpoint}/api/tags`, { method: "GET", signal: AbortController ? new AbortController().signal : undefined });
					if (!resp.ok) return { available: false, reason: "http_" + resp.status, models: [] };
					const data = await resp.json();
					const models = (data.models || []).map(m => m.name);
					const targetModel = config.localModel.model;
					const modelAvailable = models.some(m => m === targetModel || m.startsWith(targetModel.split(":")[0]));
					return { available: modelAvailable, reason: modelAvailable ? "ok" : "model_not_found", models: models, targetModel: targetModel };
				} catch (e) {
					return { available: false, reason: "connection_failed: " + e.message, models: [] };
				}
			}
			
			if (typeof window !== "undefined") {
				window.__dshCheckOllama = checkOllamaStatus;
				window.__dshOllamaStatus = { available: false, reason: "unchecked", models: [], lastCheck: 0 };
			}
			
			// ── 纯函数（无副作用，可直接单测）──
			
			/** 语言规范整理：压缩空白、清理标点前后空格、补句末标点 */
			function polishLanguage(text) {
				let result = text.trim();
				result = result.replace(/\s+/g, " ");
				result = result.replace(/([，。！？；：])\s*/g, "$1");
				result = result.replace(/\s*([，。！？；：])/g, "$1");
				if (!/[。！？]$/.test(result) && result.length > 5) result += "。";
				return result;
			}
			
			/** 任务分类：code / design / research / writing / chat */
			function classifyTask(text) {
				const t = text.toLowerCase();
				if (/代码|bug|函数|变量|报错|错误|实现|开发|写一个|修复/.test(t)) return "code";
				if (/设计|架构|方案|系统|模块|流程|规范/.test(t)) return "design";
				if (/查|搜索|调研|资料|文档|信息|是什么/.test(t)) return "research";
				if (/翻译|整理|总结|摘要|润色/.test(t)) return "writing";
				return "chat";
			}
			
			exports.DIRECTOR_CONFIG_KEY = DIRECTOR_CONFIG_KEY;
			exports.OLLAMA_DEFAULT_ENDPOINT = OLLAMA_DEFAULT_ENDPOINT;
			exports.OLLAMA_DEFAULT_MODEL = OLLAMA_DEFAULT_MODEL;
			exports.LOCAL_MODEL_TIMEOUT_MS = LOCAL_MODEL_TIMEOUT_MS;
			exports.loadDirectorConfig = loadDirectorConfig;
			exports.saveDirectorConfig = saveDirectorConfig;
			exports.directorConfig = directorConfig;
			exports.callLocalModel = callLocalModel;
			exports.checkOllamaStatus = checkOllamaStatus;
			exports.polishLanguage = polishLanguage;
			exports.classifyTask = classifyTask;
		};

		// ── store/docs-index-inject.js ──
		__defs["store/docs-index-inject.js"] = function (exports) {
			/**
			 * store/docs-index-inject.js — A13 + A14 DSH_DOCS_INDEX 注入壳（**剥离改造版**）
			 *
			 * 迁移源：
			 *   - A13 注入壳：client.js 6538 ~ 6541（4 行）
			 *       `// __DSH_DOCS_INDEX_START__`
			 *       `const DSH_DOCS_INDEX = {...}`   ← A14，单行 541,312 B
			 *       `// __DSH_DOCS_INDEX_END__`
			 *       `if (typeof window !== "undefined") window.__dshDocsIndex = DSH_DOCS_INDEX;`
			 *   - A14：client.js 6539，**541,312 字节单行常量**（占 client.js 36.6%）
			 *
			 * ─────────────────────────────────────────────────────────────
			 * 🔴 剥离改造（T4）
			 * ─────────────────────────────────────────────────────────────
			 * 原实现把整个 docs/ 目录快照（90 篇文档**全文**）内联进编译产物。
			 * 本模块改为**运行时按需加载**外部资源 `assets/docs-index.json`。
			 *
			 * 收益：宿主 client.js 立减 541,312 B（1,479,577 → ~938,265 B，-36.6%）。
			 *
			 * 全局契约（**必须保持接口形态不变**，宿主 2 处引用点依赖）：
			 *   - `window.__dshDocsIndex` — 对象 `{generatedAt, version, docCount, tree, docs}`
			 *     ・宿主 client.js:6541 挂载
			 *     ・宿主 client.js:6583 读 `.generatedAt`（仅用于显示"索引未注入"占位）
			 *     ・业务 client.js:6754-6755 读 `.docs`
			 *
			 * 加载策略（三级降级，任一成功即止）：
			 *   ① 宿主已注入（window.__dshDocsIndex 已存在）→ 直接用，零开销
			 *   ② fetch 同级 `assets/docs-index.json`（插件 bundle 随包分发）
			 *   ③ 全部失败 → **不写 window**，宿主侧 `DSH_DOCS_INDEX.generatedAt` 判定
			 *      走 `typeof` 守卫回落为 "索引未注入"，**与剥离前行为一致，不报错**
			 */
			
			/** 打包产物中本模块的目录（由构建期注入或运行时从 import.meta.url 推导） */
			const DOCS_INDEX_ASSET_PATH = "assets/docs-index.json";
			/** 加载超时（ms） */
			const DOCS_INDEX_FETCH_TIMEOUT_MS = 10000;
			
			let loaded = null;
			let loading = null;
			
			/** 同步读取已加载的索引（未加载则返回 null） */
			function getDocsIndexSync() {
				if (typeof window !== "undefined" && window.__dshDocsIndex) return window.__dshDocsIndex;
				return loaded;
			}
			
			/** 从外部资源加载 docs 索引（幂等，可并发调用共享同一 Promise） */
			function loadDocsIndex(baseUrl) {
				if (loaded) return Promise.resolve(loaded);
				if (loading) return loading;
			
				// ① 宿主已注入 → 直接采用
				if (typeof window !== "undefined" && window.__dshDocsIndex) {
					loaded = window.__dshDocsIndex;
					return Promise.resolve(loaded);
				}
			
				const url = new URL(DOCS_INDEX_ASSET_PATH, baseUrl || guessBaseUrl()).href;
			
				loading = (async () => {
					try {
						const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
						const timer = ctrl ? setTimeout(() => ctrl.abort(), DOCS_INDEX_FETCH_TIMEOUT_MS) : null;
						const resp = await fetch(url, { signal: ctrl ? ctrl.signal : undefined });
						if (timer !== null) clearTimeout(timer);
						if (!resp.ok) {
							if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs-index", "HTTP " + resp.status + " @ " + url);
							return null;
						}
						const data = await resp.json();
						loaded = data;
						if (typeof window !== "undefined") {
							window.__dshDocsIndex = data;
							if (window.__dshDebug) window.__dshDebug.log("docs-index", "已加载 " + (data.docCount || 0) + " 篇文档索引 @ " + (data.generatedAt || "?"));
						}
						return data;
					} catch (e) {
						if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs-index", "加载失败: " + (e && e.message ? e.message : String(e)));
						return null;
					} finally {
						loading = null;
					}
				})();
			
				return loading;
			}
			
			/**
			 * 推导资源基准 URL。
			 * 优先用本模块自身的 script URL（宿主路由为 `GET /plugins/<id>/client.js`），
			 * 退回 `location.origin`。
			 */
			function guessBaseUrl() {
				try {
					if (typeof document !== "undefined" && document.currentScript && document.currentScript.src) {
						return new URL(".", document.currentScript.src).href;
					}
				} catch (e) {}
				try {
					if (typeof location !== "undefined") return new URL("plugins/dsh-director-plugin/", location.origin).href;
				} catch (e) {}
				return "/";
			}
			
			exports.DOCS_INDEX_ASSET_PATH = DOCS_INDEX_ASSET_PATH;
			exports.DOCS_INDEX_FETCH_TIMEOUT_MS = DOCS_INDEX_FETCH_TIMEOUT_MS;
			exports.getDocsIndexSync = getDocsIndexSync;
			exports.loadDocsIndex = loadDocsIndex;
		};

		// ── dev/layout-probe.js ──
		__defs["dev/layout-probe.js"] = function (exports) {
			/**
			 * dev/layout-probe.js — C1 V9-Design 布局探针
			 *
			 * 迁移源：client.js 6545 ~ 6614（70 行）
			 *   区块标记：`// ========== V9-Design: 布局探针（让AI能看到页面真实布局） ==========`
			 *
			 * 职责：让 AI「看见」页面真实布局 —— 遍历 DOM（上限 400 节点）采集几何/层叠信息，
			 *      计算重叠对（inter > 30% 较小面积 且 至少一方非 static），输出文本或 JSON。
			 *
			 * 全局契约：`window.__dshLayoutProbe()` + `.text()` + `.export()`
			 *
			 * ── 迁移改造（2 处）─────────────────────────────────────────
			 * ① `dshProbeCollect()` 的 `build` 字段原读 `DSH_DOCS_INDEX.generatedAt`。
			 *    该常量已随 A14 剥离移除 → 改走 `getDocsIndexSync()`（A13 模块），
			 *    无索引时回落到同样的 "索引未注入"。
			 * ② 本模块为 **dev-only 工具**，建议按 `import.meta.env.DEV` 或宿主开关条件加载，
			 *    生产构建可不打包（清单 §一 C 区已标注「可 dev-only 条件加载」）。
			 */
			
			/** DOM 遍历节点上限（原实现硬编码 400） */
			const PROBE_MAX_NODES = 400;
			/** 重叠判定：交集面积须 > 较小面积的 30%（原实现硬编码 0.3） */
			const PROBE_OVERLAP_RATIO = 0.3;
			/** 重叠判定：交集边长须 > 20px（原实现硬编码 20） */
			const PROBE_OVERLAP_MIN_EDGE = 20;
			/** 输出 overlaps 上限（原实现硬编码 50） */
			const PROBE_OVERLAP_OUTPUT_LIMIT = 50;
			
			/** 采集页面布局快照 */
			function dshProbeCollect(getDocsIndex) {
				const root = document.querySelector(".director-view") || document.body;
				const items = [];
				const queue = [root];
				let count = 0;
				while (queue.length && count < PROBE_MAX_NODES) {
					const el = queue.shift();
					if (!el || el.nodeType !== 1) continue;
					count++;
					const r = el.getBoundingClientRect();
					if (r.width > 1 && r.height > 1) {
						const cs = window.getComputedStyle(el);
						items.push({
							i: items.length,
							tag: el.tagName.toLowerCase(),
							cls: (el.className && String(el.className).slice(0, 36)) || "",
							txt: (el.childElementCount === 0 ? (el.textContent || "").trim().slice(0, 22) : ""),
							rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
							pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor,
							disp: cs.display, vis: cs.visibility
						});
					}
					for (let k = 0; k < el.children.length; k++) queue.push(el.children[k]);
				}
				const overlaps = [];
				for (let a = 0; a < items.length; a++) {
					for (let b = a + 1; b < items.length; b++) {
						const A = items[a], B = items[b];
						const ox = Math.min(A.rect[0] + A.rect[2], B.rect[0] + B.rect[2]) - Math.max(A.rect[0], B.rect[0]);
						const oy = Math.min(A.rect[1] + A.rect[3], B.rect[1] + B.rect[3]) - Math.max(A.rect[1], B.rect[1]);
						if (ox > PROBE_OVERLAP_MIN_EDGE && oy > PROBE_OVERLAP_MIN_EDGE) {
							const inter = ox * oy;
							const minArea = Math.min(A.rect[2] * A.rect[3], B.rect[2] * B.rect[3]);
							if (inter > PROBE_OVERLAP_RATIO * minArea && (A.pos !== "static" || B.pos !== "static" || A.z !== "auto" || B.z !== "auto")) {
								overlaps.push({ a: A.i, b: B.i, aDesc: (A.txt || A.cls || A.tag).slice(0, 20), bDesc: (B.txt || B.cls || B.tag).slice(0, 20), aPos: A.pos + "/" + A.z, bPos: B.pos + "/" + B.z });
							}
						}
					}
				}
				// 改造点①：原读 DSH_DOCS_INDEX.generatedAt，现走 A13 模块
				const idx = typeof getDocsIndex === "function" ? getDocsIndex() : null;
				return {
					build: (idx && idx.generatedAt) || "索引未注入",
					ts: new Date().toISOString(),
					viewport: [window.innerWidth, window.innerHeight],
					itemCount: items.length,
					overlapCount: overlaps.length,
					overlaps: overlaps.slice(0, PROBE_OVERLAP_OUTPUT_LIMIT),
					items: items
				};
			}
			
			/** 采集并格式化为可读文本 */
			function dshProbeText(getDocsIndex) {
				const s = dshProbeCollect(getDocsIndex);
				const lines = ["DSH-LAYOUT build=" + s.build + " viewport=" + s.viewport.join("x") + " items=" + s.itemCount + " overlaps=" + s.overlapCount];
				for (const o of s.overlaps) lines.push("OVERLAP #" + o.a + "(" + o.aDesc + " " + o.aPos + ") x #" + o.b + "(" + o.bDesc + " " + o.bPos + ")");
				for (const it of s.items) lines.push("#" + it.i + " " + it.tag + " r=[" + it.rect.join(",") + "] " + it.pos + "/" + it.z + (it.txt ? " \"" + it.txt + "\"" : "") + (it.cls ? " ." + it.cls.split(" ")[0] : ""));
				return lines.join("\n");
			}
			
			/** 安装全局探针 API */
			function installLayoutProbe(getDocsIndex) {
				if (typeof window === "undefined") return null;
				if (window.__dshLayoutProbe) return window.__dshLayoutProbe;
				window.__dshLayoutProbe = function() { const s = dshProbeCollect(getDocsIndex); console.log("DSH-LAYOUT", s); return s; };
				window.__dshLayoutProbe.text = function() { const t = dshProbeText(getDocsIndex); console.log(t); return t; };
				window.__dshLayoutProbe.export = function() {
					const s = dshProbeCollect(getDocsIndex);
					const blob = new Blob([JSON.stringify(s, null, 1)], { type: "application/json" });
					const a = document.createElement("a");
					a.href = URL.createObjectURL(blob);
					a.download = "dsh-layout-" + Date.now() + ".json";
					a.click();
				};
				return window.__dshLayoutProbe;
			}
			
			exports.PROBE_MAX_NODES = PROBE_MAX_NODES;
			exports.PROBE_OVERLAP_RATIO = PROBE_OVERLAP_RATIO;
			exports.PROBE_OVERLAP_MIN_EDGE = PROBE_OVERLAP_MIN_EDGE;
			exports.PROBE_OVERLAP_OUTPUT_LIMIT = PROBE_OVERLAP_OUTPUT_LIMIT;
			exports.dshProbeCollect = dshProbeCollect;
			exports.dshProbeText = dshProbeText;
			exports.installLayoutProbe = installLayoutProbe;
		};

		// ── store/messages.js ──
		__defs["store/messages.js"] = function (exports) {
			/**
			 * store/messages.js — A1 总监消息 store（内存层）
			 *
			 * 迁移源：client.js 5495 ~ 5498
			 *   区块标记：`// ========== 总监对话模式 - 消息store ==========`
			 *
			 * 职责：按 sessionId 分桶的内存消息缓存层。
			 *   - `directorStores` 是 `Map<sessionId, store>`，**进程内单例**
			 *   - `DIRECTOR_STORE_PREFIX` 是 localStorage 回退层的 key 前缀（IDB 为主，此为兜底）
			 *
			 * ⚠️ 兼容约束（R5）：`DIRECTOR_STORE_PREFIX = "dsh.director.store."` **不可改名**，
			 *    用户存量数据的 localStorage key 依赖此前缀。
			 *
			 * 与 store/idb.js 的关系：
			 *   - 内存 Map（本模块）→ 一级缓存，读写同步、最快
			 *   - IndexedDB（idb.js）→ 持久化主层
			 *   - localStorage/cookie（cookie.js + 本模块 prefix）→ 降级兜底
			 *   组装逻辑在 A9 `createDirectorStore`（批次 3）。
			 */
			
			const DIRECTOR_STORE_PREFIX = "dsh.director.store.";
			
			/** sessionId → store 的内存注册表（原 client.js 的 `directorStores`） */
			const directorStores = new Map();
			
			/** 取（或按需创建）某 session 的 store */
			function getDirectorStore(sessionId, factory) {
				if (directorStores.has(sessionId)) return directorStores.get(sessionId);
				if (typeof factory !== "function") return null;
				const store = factory(sessionId);
				directorStores.set(sessionId, store);
				return store;
			}
			
			/** 判断是否已有该 session 的 store（不触发创建） */
			function hasDirectorStore(sessionId) { return directorStores.has(sessionId); }
			
			/** 移除某 session 的 store（会话关闭/清理） */
			function removeDirectorStore(sessionId) { return directorStores.delete(sessionId); }
			
			/** 清空全部内存 store（登出/重置；不影响 IDB） */
			function clearDirectorStores() { directorStores.clear(); }
			
			/** localStorage 回退层的 key */
			function directorStoreLsKey(sessionId) { return DIRECTOR_STORE_PREFIX + sessionId; }
			
			exports.DIRECTOR_STORE_PREFIX = DIRECTOR_STORE_PREFIX;
			exports.directorStores = directorStores;
			exports.getDirectorStore = getDirectorStore;
			exports.hasDirectorStore = hasDirectorStore;
			exports.removeDirectorStore = removeDirectorStore;
			exports.clearDirectorStores = clearDirectorStores;
			exports.directorStoreLsKey = directorStoreLsKey;
		};

		// ── store/idb.js ──
		__defs["store/idb.js"] = function (exports) {
			/**
			 * store/idb.js — IndexedDB 持久化层（主要机制）
			 *
			 * 迁移源：client.js 5562 ~ 5723
			 *
			 * 职责：director 的**主持久化层**（Electron 下比 localStorage 更可靠）。
			 *      单例连接（`idbPromise` 缓存），版本 3，6 个 object store。
			 *
			 * 🔴 兼容约束（R5 — **最高优先级**）
			 *   DB 名 / 版本 / store 名 / keyPath **全部不可改名或降版**：
			 *     DB      `dsh-director-db`  v3
			 *     stores  `directorStores`   （无 keyPath，外部传 key）
			 *             `directorDocs`     （keyPath docId）
			 *             `directorFolders`  （keyPath folderId）
			 *             `memoryCore`       （keyPath projectId）
			 *             `memoryDecisions`  （keyPath decisionId）
			 *             `memoryRisks`      （keyPath riskId）
			 *   改 store 名 = 用户存量数据全丢；**降 version = onupgradeneeded 不触发，新 store 不创建**。
			 *
			 * 错误处理约定（原实现一致）：所有 API **catch 后返回安全缺省**（false/null/[]），
			 * 不向上抛 —— 持久化失败不应打断 UI。
			 * ⚠️ 故调用方**不能以返回值判断"是否真的写入"**，需按 execution-standards §3.4
			 *    「写操作后必须回读校验」另行读回比对。
			 */
			
			const IDB_DB_NAME = "dsh-director-db";
			const IDB_VERSION = 3;
			
			const IDB_STORE_NAME = "directorStores";
			const IDB_DOCS_STORE = "directorDocs";
			const IDB_FOLDERS_STORE = "directorFolders";
			// V9: 记忆体系 stores
			const IDB_MEMORY_CORE_STORE = "memoryCore";
			const IDB_MEMORY_DECISIONS_STORE = "memoryDecisions";
			const IDB_MEMORY_RISKS_STORE = "memoryRisks";
			
			/** 全部 store 清单（校验与迁移用） */
			const IDB_ALL_STORES = [
				IDB_STORE_NAME, IDB_DOCS_STORE, IDB_FOLDERS_STORE,
				IDB_MEMORY_CORE_STORE, IDB_MEMORY_DECISIONS_STORE, IDB_MEMORY_RISKS_STORE
			];
			
			let idbPromise = null;
			
			function openIDB() {
				if (idbPromise) return idbPromise;
				if (typeof indexedDB === "undefined") {
					if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "indexedDB不可用");
					idbPromise = Promise.reject(new Error("indexedDB unavailable"));
					return idbPromise;
				}
				if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "开始打开数据库: " + IDB_DB_NAME + " v" + IDB_VERSION);
				idbPromise = new Promise((resolve, reject) => {
					try {
						const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
						req.onupgradeneeded = () => {
							const db = req.result;
							if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "onupgradeneeded, 现有stores: " + Array.from(db.objectStoreNames));
							if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
								db.createObjectStore(IDB_STORE_NAME);
								if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "创建store: " + IDB_STORE_NAME);
							}
							if (!db.objectStoreNames.contains(IDB_DOCS_STORE)) {
								db.createObjectStore(IDB_DOCS_STORE, { keyPath: "docId" });
							}
							if (!db.objectStoreNames.contains(IDB_FOLDERS_STORE)) {
								db.createObjectStore(IDB_FOLDERS_STORE, { keyPath: "folderId" });
							}
							// V9: 记忆体系 stores
							if (!db.objectStoreNames.contains(IDB_MEMORY_CORE_STORE)) {
								db.createObjectStore(IDB_MEMORY_CORE_STORE, { keyPath: "projectId" });
								if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "创建store: " + IDB_MEMORY_CORE_STORE);
							}
							if (!db.objectStoreNames.contains(IDB_MEMORY_DECISIONS_STORE)) {
								db.createObjectStore(IDB_MEMORY_DECISIONS_STORE, { keyPath: "decisionId" });
								if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "创建store: " + IDB_MEMORY_DECISIONS_STORE);
							}
							if (!db.objectStoreNames.contains(IDB_MEMORY_RISKS_STORE)) {
								db.createObjectStore(IDB_MEMORY_RISKS_STORE, { keyPath: "riskId" });
								if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "创建store: " + IDB_MEMORY_RISKS_STORE);
							}
						};
						req.onsuccess = () => {
							if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "数据库打开成功, stores: " + Array.from(req.result.objectStoreNames));
							resolve(req.result);
						};
						req.onerror = () => {
							if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("IDB", "数据库打开失败: " + req.error);
							reject(req.error);
						};
					} catch (e) { reject(e); }
				});
				return idbPromise;
			}
			
			/** 重置连接缓存（测试与错误恢复用；原实现无此口，迁移新增） */
			function resetIDBConnection() { idbPromise = null; }
			
			// ── directorStores（消息 store 主表）──
			
			function idbSave(key, value) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_STORE_NAME, "readwrite");
						tx.objectStore(IDB_STORE_NAME).put(value, key);
						tx.oncomplete = () => {
							if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "idbSave complete: key=" + key + " msgs=" + (value.messages ? value.messages.length : "N/A"));
							resolve(true);
						};
						tx.onerror = () => reject(tx.error);
					} catch (e) { reject(e); }
				})).catch((e) => {
					if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "idbSave failed: " + e.message);
					return false;
				});
			}
			
			function idbLoad(key) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_STORE_NAME, "readonly");
						const req = tx.objectStore(IDB_STORE_NAME).get(key);
						req.onsuccess = () => resolve(req.result);
						req.onerror = () => reject(req.error);
					} catch (e) { reject(e); }
				})).catch((e) => {
					if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "idbLoad failed: " + e.message);
					return null;
				});
			}
			
			// ── V8: 总监文档 CRUD ──
			
			function idbSaveDoc(doc) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_DOCS_STORE, "readwrite");
						tx.objectStore(IDB_DOCS_STORE).put({ ...doc, updatedAt: Date.now() });
						tx.oncomplete = () => resolve(true);
						tx.onerror = () => reject(tx.error);
					} catch (e) { reject(e); }
				})).catch((e) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs", "idbSaveDoc failed: " + e.message); return false; });
			}
			
			function idbGetDoc(docId) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_DOCS_STORE, "readonly");
						const req = tx.objectStore(IDB_DOCS_STORE).get(docId);
						req.onsuccess = () => resolve(req.result);
						req.onerror = () => reject(req.error);
					} catch (e) { reject(e); }
				})).catch((e) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs", "idbGetDoc failed: " + e.message); return null; });
			}
			
			function idbListDocs(filter) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_DOCS_STORE, "readonly");
						const req = tx.objectStore(IDB_DOCS_STORE).getAll();
						req.onsuccess = () => {
							let docs = req.result || [];
							if (filter) {
								if (filter.folderId !== undefined) docs = docs.filter(d => d.folderId === filter.folderId);
								if (filter.docType) docs = docs.filter(d => d.docType === filter.docType);
							}
							resolve(docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
						};
						req.onerror = () => reject(req.error);
					} catch (e) { reject(e); }
				})).catch((e) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("docs", "idbListDocs failed: " + e.message); return []; });
			}
			
			function idbDeleteDoc(docId) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_DOCS_STORE, "readwrite");
						tx.objectStore(IDB_DOCS_STORE).delete(docId);
						tx.oncomplete = () => resolve(true);
						tx.onerror = () => reject(tx.error);
					} catch (e) { reject(e); }
				})).catch(() => false);
			}
			
			function idbSaveFolder(folder) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_FOLDERS_STORE, "readwrite");
						tx.objectStore(IDB_FOLDERS_STORE).put({ ...folder, updatedAt: Date.now() });
						tx.oncomplete = () => resolve(true);
						tx.onerror = () => reject(tx.error);
					} catch (e) { reject(e); }
				})).catch(() => false);
			}
			
			function idbListFolders(docType) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_FOLDERS_STORE, "readonly");
						const req = tx.objectStore(IDB_FOLDERS_STORE).getAll();
						req.onsuccess = () => {
							let folders = req.result || [];
							if (docType) folders = folders.filter(f => f.docType === docType);
							resolve(folders.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
						};
						req.onerror = () => reject(req.error);
					} catch (e) { reject(e); }
				})).catch(() => []);
			}
			
			exports.IDB_DB_NAME = IDB_DB_NAME;
			exports.IDB_VERSION = IDB_VERSION;
			exports.IDB_STORE_NAME = IDB_STORE_NAME;
			exports.IDB_DOCS_STORE = IDB_DOCS_STORE;
			exports.IDB_FOLDERS_STORE = IDB_FOLDERS_STORE;
			exports.IDB_MEMORY_CORE_STORE = IDB_MEMORY_CORE_STORE;
			exports.IDB_MEMORY_DECISIONS_STORE = IDB_MEMORY_DECISIONS_STORE;
			exports.IDB_MEMORY_RISKS_STORE = IDB_MEMORY_RISKS_STORE;
			exports.IDB_ALL_STORES = IDB_ALL_STORES;
			exports.openIDB = openIDB;
			exports.resetIDBConnection = resetIDBConnection;
			exports.idbSave = idbSave;
			exports.idbLoad = idbLoad;
			exports.idbSaveDoc = idbSaveDoc;
			exports.idbGetDoc = idbGetDoc;
			exports.idbListDocs = idbListDocs;
			exports.idbDeleteDoc = idbDeleteDoc;
			exports.idbSaveFolder = idbSaveFolder;
			exports.idbListFolders = idbListFolders;
		};

		// ── store/memory.js ──
		__defs["store/memory.js"] = function (exports) {
			/**
			 * store/memory.js — A2 V9 记忆体系 CRUD
			 *
			 * 迁移源：client.js 5724 ~ 5798（75 行）
			 *   区块标记：`// ========== V9: 记忆体系 CRUD ==========`
			 *
			 * 职责：V9 记忆体系的三个维度持久化：
			 *   - memoryCore      核心记忆（按 projectId，含 conversationHistory / decisions / risks 摘要）
			 *   - memoryDecisions 决策记录
			 *   - memoryRisks     风险记录
			 *
			 * 全局契约：`window.__dshMemory = { idbSaveMemoryCore, idbGetMemoryCore, idbSaveDecision, idbListDecisions, idbSaveRisk, idbListRisks }`
			 *   **宿主 client.js:11784 直接调用**（`__directChatSubmit` 内持久化用户消息到 conversationHistory，
			 *   见 F4 / client.js:11787 起） —— 该契约不可改名。
			 *
			 * 错误处理：与原实现一致 —— catch 后返回安全缺省（false / null / []），不向上抛。
			 * ⚠️ 故调用方不能以返回值判断"是否真的写入"（需回读校验）。
			 */
			
			const { openIDB, IDB_MEMORY_CORE_STORE, IDB_MEMORY_DECISIONS_STORE, IDB_MEMORY_RISKS_STORE } = __m("store/idb.js");
			
			/** 核心记忆默认 projectId（原实现硬编码 "default"） */
			const MEMORY_DEFAULT_PROJECT_ID = "default";
			
			function idbSaveMemoryCore(core) {
				if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "保存核心记忆: projectId=" + (core && core.projectId) + " keys=" + (core ? Object.keys(core).join(",") : "null"));
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_MEMORY_CORE_STORE, "readwrite");
						tx.objectStore(IDB_MEMORY_CORE_STORE).put({ ...core, updatedAt: Date.now() });
						tx.oncomplete = () => { if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "核心记忆保存成功"); resolve(true); };
						tx.onerror = () => { if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "核心记忆保存失败: " + tx.error); reject(tx.error); };
					} catch (e) { if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "核心记忆保存异常: " + e.message); reject(e); }
				})).catch((e) => { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("memory", "idbSaveMemoryCore failed: " + e.message); return false; });
			}
			
			function idbGetMemoryCore(projectId) {
				if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "读取核心记忆: projectId=" + (projectId || MEMORY_DEFAULT_PROJECT_ID));
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_MEMORY_CORE_STORE, "readonly");
						const req = tx.objectStore(IDB_MEMORY_CORE_STORE).get(projectId || MEMORY_DEFAULT_PROJECT_ID);
						req.onsuccess = () => { if (typeof window !== "undefined" && window.__dshV9Log) window.__dshV9Log.log("Memory", "核心记忆读取结果: " + (req.result ? "有数据 keys=" + Object.keys(req.result).join(",") : "无数据")); resolve(req.result || null); };
						req.onerror = () => reject(req.error);
					} catch (e) { reject(e); }
				})).catch(() => null);
			}
			
			function idbSaveDecision(decision) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_MEMORY_DECISIONS_STORE, "readwrite");
						tx.objectStore(IDB_MEMORY_DECISIONS_STORE).put({ ...decision, updatedAt: Date.now() });
						tx.oncomplete = () => resolve(true);
						tx.onerror = () => reject(tx.error);
					} catch (e) { reject(e); }
				})).catch(() => false);
			}
			
			function idbListDecisions(projectId) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_MEMORY_DECISIONS_STORE, "readonly");
						const req = tx.objectStore(IDB_MEMORY_DECISIONS_STORE).getAll();
						req.onsuccess = () => {
							let list = req.result || [];
							if (projectId) list = list.filter(d => d.projectId === projectId);
							resolve(list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
						};
						req.onerror = () => reject(req.error);
					} catch (e) { reject(e); }
				})).catch(() => []);
			}
			
			function idbSaveRisk(risk) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_MEMORY_RISKS_STORE, "readwrite");
						tx.objectStore(IDB_MEMORY_RISKS_STORE).put({ ...risk, updatedAt: Date.now() });
						tx.oncomplete = () => resolve(true);
						tx.onerror = () => reject(tx.error);
					} catch (e) { reject(e); }
				})).catch(() => false);
			}
			
			function idbListRisks(projectId) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const tx = db.transaction(IDB_MEMORY_RISKS_STORE, "readonly");
						const req = tx.objectStore(IDB_MEMORY_RISKS_STORE).getAll();
						req.onsuccess = () => {
							let list = req.result || [];
							if (projectId) list = list.filter(r => r.projectId === projectId);
							resolve(list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
						};
						req.onerror = () => reject(req.error);
					} catch (e) { reject(e); }
				})).catch(() => []);
			}
			
			/** 安装全局契约 `window.__dshMemory`（宿主 F4 依赖） */
			function installMemoryApi() {
				if (typeof window === "undefined") return null;
				window.__dshMemory = { idbSaveMemoryCore, idbGetMemoryCore, idbSaveDecision, idbListDecisions, idbSaveRisk, idbListRisks };
				return window.__dshMemory;
			}
			
			exports.MEMORY_DEFAULT_PROJECT_ID = MEMORY_DEFAULT_PROJECT_ID;
			exports.idbSaveMemoryCore = idbSaveMemoryCore;
			exports.idbGetMemoryCore = idbGetMemoryCore;
			exports.idbSaveDecision = idbSaveDecision;
			exports.idbListDecisions = idbListDecisions;
			exports.idbSaveRisk = idbSaveRisk;
			exports.idbListRisks = idbListRisks;
			exports.installMemoryApi = installMemoryApi;
		};

		// ── store/branch.js ──
		__defs["store/branch.js"] = function (exports) {
			/**
			 * store/branch.js — A4 分支创建与记忆面板交互
			 *
			 * 迁移源：client.js 5835 ~ 5963（129 行）
			 *   区块标记：`// ========== V9: 分支创建与记忆面板交互 ==========`
			 *
			 * 职责（4 个部分）：
			 *   1. `createBranch()`        —— 创建分支对话（点击智能体时调用），写 memoryCore.branches
			 *   2. `dshEscapeHTML()`       —— XSS 转义（V9.4-P1 修复，**不可省略**）
			 *   3. `switchMemoryTab()`     —— 记忆面板三 Tab 渲染（memory / index / data）
			 *   4. `showToast()`           —— 轻量 Toast 提示
			 *
			 * ═══════════════════════════════════════════════════════════════════
			 * 全局契约（**不可改名**，宿主 / 其他模块直接引用）
			 * ═══════════════════════════════════════════════════════════════════
			 *   window.__dshCreateBranch(agentKey, agentLabel) -> branchInfo | null
			 *   window.__dshCurrentBranch                      -> branchInfo（当前激活分支）
			 *   window.__dshSwitchMemoryTab(tabIndex)          -> void
			 *   window.__dshShowToast(msg)                     -> void（多处调用：branch / 记忆写回等）
			 *
			 * 自定义事件契约（**不可改名**）：
			 *   `dsh-branch-created`  detail = branchInfo —— 通知 DirectorView 追加系统消息
			 *
			 * 依赖（均为本插件模块，非宿主）：
			 *   - `idb.js`    : idbGetMemoryCore / idbSaveMemoryCore / idbListDecisions / idbListRisks
			 *   - `memory.js` : MEMORY_DEFAULT_PROJECT_ID（= "default"）
			 *
			 * 错误处理：与原实现一致 —— createBranch 整体 try-catch，失败 console.error 并返回 null。
			 */
			
			const { idbGetMemoryCore, idbSaveMemoryCore, idbListDecisions, idbListRisks } = __m("store/idb.js");
			const { MEMORY_DEFAULT_PROJECT_ID } = __m("store/memory.js");
			
			/* ── 硬编码值提取为具名常量（原实现为散落的字面量） ────────────────────── */
			
			/** 分支 ID 前缀（原："branch-" + agentKey + "-" + Date.now()） */
			const BRANCH_ID_PREFIX = "branch-";
			
			/** 分支初始状态 */
			const BRANCH_STATUS_ACTIVE = "active";
			
			/** 分支创建通知事件名（宿主 DirectorView 监听，**不可改名**） */
			const BRANCH_CREATED_EVENT = "dsh-branch-created";
			
			/** 记忆面板容器元素 id（原：document.getElementById("dsh-memory-content")） */
			const MEMORY_CONTENT_EL_ID = "dsh-memory-content";
			
			/** Toast 容器元素 id */
			const TOAST_EL_ID = "dsh-toast";
			
			/** Toast 淡出延时（ms，原硬编码 2500） */
			const TOAST_FADE_MS = 2500;
			
			/** 记忆面板 Tab 顺序（原：["memory", "index", "data"]） */
			const MEMORY_TABS = ["memory", "index", "data"];
			
			/** 记忆面板：最近对话展示条数（原 slice(-3)） */
			const MEMORY_HISTORY_TAIL = 3;
			
			/** 记忆面板：单条对话内容截断长度（原 slice(0, 50)） */
			const MEMORY_HISTORY_SNIPPET = 50;
			
			/** 记忆面板：索引 / 风险列表展示条数（原 slice(0, 8)） */
			const MEMORY_LIST_LIMIT = 8;
			
			/** 记忆面板：风险内容截断长度（原 slice(0, 60)） */
			const MEMORY_RISK_SNIPPET = 60;
			
			/** 记忆面板：加载中 / 空态 / 失败 文案（集中管理，避免散落） */
			const TEXT_LOADING = "<div style='color:#999'>加载中...</div>";
			const TEXT_EMPTY_MEMORY = "<div style='color:#999'>暂无记忆，发送对话后自动生成</div>";
			const TEXT_EMPTY_CORE = "<div style='color:#999'>暂无核心记忆</div>";
			const TEXT_EMPTY_DECISIONS = "<div style='color:#999'>暂无决策索引</div>";
			const TEXT_EMPTY_RISKS = "<div style='color:#999'>暂无风险/偏差数据</div>";
			const TEXT_READ_FAIL = "<div style='color:#d32f2f'>读取失败</div>";
			
			/**
			 * V9.4-P1: HTML 转义 —— 记忆面板 innerHTML 拼接的 AI/用户生成内容必须转义，防 XSS 注入。
			 * 覆盖 5 个危险字符：& < > " '
			 * @param {*} s 任意值（null/undefined 归一为空串）
			 * @returns {string} 转义后的安全字符串
			 */
			function dshEscapeHTML(s) {
			  return String(s == null ? "" : s)
			    .replace(/&/g, "&amp;")
			    .replace(/</g, "&lt;")
			    .replace(/>/g, "&gt;")
			    .replace(/"/g, "&quot;")
			    .replace(/'/g, "&#39;");
			}
			
			/**
			 * 创建分支对话（点击智能体时调用）。
			 * ① 生成 branchInfo ② 追加到 memoryCore.branches（异步持久化）
			 * ③ 设置 window.__dshCurrentBranch ④ 派发 dsh-branch-created 事件 ⑤ Toast 提示
			 *
			 * @param {string} agentKey   智能体键（用于生成 branchId）
			 * @param {string} agentLabel 智能体显示名（用于 Toast / 记忆面板展示）
			 * @returns {object|null} branchInfo；失败返回 null
			 */
			function createBranch(agentKey, agentLabel) {
			  try {
			    if (window.__dshV9Log) {
			      window.__dshV9Log.log("Branch", "创建分支: agentKey=" + agentKey + " agentLabel=" + agentLabel);
			    }
			    const branchId = BRANCH_ID_PREFIX + agentKey + "-" + Date.now();
			    const branchInfo = {
			      branchId: branchId,
			      agentKey: agentKey,
			      agentLabel: agentLabel,
			      createdAt: Date.now(),
			      status: BRANCH_STATUS_ACTIVE,
			      task: "",
			      projectCore: null,
			    };
			    // 保存分支信息到 memoryCore
			    idbGetMemoryCore(MEMORY_DEFAULT_PROJECT_ID).then((core) => {
			      const existing = core || { projectId: MEMORY_DEFAULT_PROJECT_ID, branches: [] };
			      existing.branches = existing.branches || [];
			      existing.branches.push(branchInfo);
			      existing.updatedAt = Date.now();
			      idbSaveMemoryCore(existing);
			    });
			    // 设置当前分支上下文
			    window.__dshCurrentBranch = branchInfo;
			    // 触发自定义事件，通知 DirectorView 添加系统消息
			    try {
			      const evt = new CustomEvent(BRANCH_CREATED_EVENT, { detail: branchInfo });
			      window.dispatchEvent(evt);
			    } catch (e) {}
			    // 打印日志
			    if (typeof window !== "undefined" && window.__dshDebug) {
			      window.__dshDebug.log("branch", "创建分支并激活: " + JSON.stringify(branchInfo));
			    }
			    // 显示提示
			    if (window.__dshShowToast) {
			      window.__dshShowToast("已创建并激活" + agentLabel + "分支");
			    }
			    return branchInfo;
			  } catch (e) {
			    console.error("[DSH-Branch] 创建分支失败:", e);
			    return null;
			  }
			}
			
			/**
			 * 记忆面板 Tab 切换与渲染。
			 * Tab 顺序：0 = memory（核心记忆） / 1 = index（决策索引） / 2 = data（风险偏差）
			 *
			 * @param {number} tabIndex 0|1|2，越界回落 "memory"
			 */
			function switchMemoryTab(tabIndex) {
			  if (window.__dshV9Log) window.__dshV9Log.log("Tab", "切换记忆Tab: index=" + tabIndex);
			  const contentEl = document.getElementById(MEMORY_CONTENT_EL_ID);
			  if (!contentEl) {
			    if (window.__dshV9Log) window.__dshV9Log.log("Tab", "错误: 找不到" + MEMORY_CONTENT_EL_ID + "元素");
			    return;
			  }
			  const tab = MEMORY_TABS[tabIndex] || MEMORY_TABS[0];
			  contentEl.innerHTML = TEXT_LOADING;
			
			  if (tab === "memory") {
			    idbGetMemoryCore(MEMORY_DEFAULT_PROJECT_ID)
			      .then((core) => {
			        if (!core) {
			          contentEl.innerHTML = TEXT_EMPTY_MEMORY;
			          return;
			        }
			        let html = "";
			        if (core.positioning) html += "<div style='margin-bottom:3px'><b>定位:</b> " + dshEscapeHTML(core.positioning) + "</div>";
			        if (core.goal) html += "<div style='margin-bottom:3px'><b>目标:</b> " + dshEscapeHTML(core.goal) + "</div>";
			        if (core.currentPhase) html += "<div style='margin-bottom:3px'><b>阶段:</b> " + dshEscapeHTML(core.currentPhase) + "</div>";
			        if (core.conversationHistory && core.conversationHistory.length > 0) {
			          html += "<div style='margin-top:4px;border-top:1px solid #eee;padding-top:4px'><b>最近对话 (" + core.conversationHistory.length + "条):</b></div>";
			          core.conversationHistory.slice(-MEMORY_HISTORY_TAIL).forEach(function (m) {
			            html += "<div style='padding:2px 0;font-size:9px;color:#666'>- " + (m.role === "user" ? "我: " : "总监: ") + dshEscapeHTML((m.content || "").slice(0, MEMORY_HISTORY_SNIPPET)) + "</div>";
			          });
			        }
			        if (core.branches && core.branches.length > 0) {
			          html += "<div style='margin-top:4px;border-top:1px solid #eee;padding-top:4px'><b>活跃分支:</b></div>";
			          core.branches.forEach(function (b) {
			            html += "<div style='padding:1px 0;font-size:9px'>- " + dshEscapeHTML(b.agentLabel) + " (" + dshEscapeHTML(b.status) + ")</div>";
			          });
			        }
			        if (!html) html = TEXT_EMPTY_CORE;
			        contentEl.innerHTML = html;
			      })
			      .catch(function () { contentEl.innerHTML = TEXT_READ_FAIL; });
			  } else if (tab === "index") {
			    idbListDecisions(MEMORY_DEFAULT_PROJECT_ID)
			      .then(function (list) {
			        if (!list || list.length === 0) {
			          contentEl.innerHTML = TEXT_EMPTY_DECISIONS;
			          return;
			        }
			        let html = "";
			        list.slice(0, MEMORY_LIST_LIMIT).forEach(function (d) {
			          html += "<div style='padding:2px 0;border-bottom:1px solid #eee'>";
			          html += "<div style='font-weight:600;font-size:9px'>" + dshEscapeHTML(d.title || "未命名") + "</div>";
			          html += "<div style='color:#888;font-size:8px'>" + new Date(d.createdAt || Date.now()).toLocaleDateString() + "</div>";
			          html += "</div>";
			        });
			        contentEl.innerHTML = html;
			      })
			      .catch(function () { contentEl.innerHTML = TEXT_READ_FAIL; });
			  } else if (tab === "data") {
			    idbListRisks(MEMORY_DEFAULT_PROJECT_ID)
			      .then(function (list) {
			        if (!list || list.length === 0) {
			          contentEl.innerHTML = TEXT_EMPTY_RISKS;
			          return;
			        }
			        let html = "";
			        list.slice(0, MEMORY_LIST_LIMIT).forEach(function (r) {
			          html += "<div style='padding:2px 0;border-bottom:1px solid #eee'>";
			          html += "<div style='font-weight:600;color:#d32f2f;font-size:9px'>" + dshEscapeHTML(r.title || "未命名") + "</div>";
			          html += "<div style='color:#888;font-size:8px'>" + dshEscapeHTML((r.content || "").slice(0, MEMORY_RISK_SNIPPET)) + "</div>";
			          html += "</div>";
			        });
			        contentEl.innerHTML = html;
			      })
			      .catch(function () { contentEl.innerHTML = TEXT_READ_FAIL; });
			  }
			}
			
			/**
			 * 轻量 Toast 提示（惰性创建容器，复用同一 DOM 节点）。
			 * @param {string} msg 提示文案（textContent 写入，无 XSS 风险）
			 */
			function showToast(msg) {
			  let toast = document.getElementById(TOAST_EL_ID);
			  if (!toast) {
			    toast = document.createElement("div");
			    toast.id = TOAST_EL_ID;
			    toast.style.cssText = "position:fixed;top:20px;right:20px;background:#333;color:#fff;padding:8px 16px;border-radius:4px;font-size:12px;z-index:99999;opacity:0;transition:opacity 0.3s;";
			    document.body.appendChild(toast);
			  }
			  toast.textContent = msg;
			  toast.style.opacity = "1";
			  setTimeout(() => { toast.style.opacity = "0"; }, TOAST_FADE_MS);
			}
			
			/**
			 * 幂等安装：把 4 个函数挂到 window 全局契约上。
			 * 顺序与宿主原实现一致（createBranch → switchMemoryTab → showToast）。
			 *
			 * @returns {{createBranch:boolean, switchMemoryTab:boolean, showToast:boolean, escapeHTML:boolean}}
			 */
			function installBranchApi() {
			  const installed = { createBranch: false, switchMemoryTab: false, showToast: false, escapeHTML: false };
			  if (typeof window === "undefined") return installed;
			  window.__dshCreateBranch = createBranch;
			  installed.createBranch = true;
			  window.__dshSwitchMemoryTab = switchMemoryTab;
			  installed.switchMemoryTab = true;
			  window.__dshShowToast = showToast;
			  installed.showToast = true;
			  // dshEscapeHTML 原实现为模块内闭包（未挂 window）；此处保持同口径，仅以导出形式供本插件复用
			  installed.escapeHTML = typeof dshEscapeHTML === "function";
			  return installed;
			}
			
			exports.BRANCH_ID_PREFIX = BRANCH_ID_PREFIX;
			exports.BRANCH_STATUS_ACTIVE = BRANCH_STATUS_ACTIVE;
			exports.BRANCH_CREATED_EVENT = BRANCH_CREATED_EVENT;
			exports.MEMORY_CONTENT_EL_ID = MEMORY_CONTENT_EL_ID;
			exports.TOAST_EL_ID = TOAST_EL_ID;
			exports.TOAST_FADE_MS = TOAST_FADE_MS;
			exports.MEMORY_TABS = MEMORY_TABS;
			exports.MEMORY_HISTORY_TAIL = MEMORY_HISTORY_TAIL;
			exports.MEMORY_HISTORY_SNIPPET = MEMORY_HISTORY_SNIPPET;
			exports.MEMORY_LIST_LIMIT = MEMORY_LIST_LIMIT;
			exports.MEMORY_RISK_SNIPPET = MEMORY_RISK_SNIPPET;
			exports.dshEscapeHTML = dshEscapeHTML;
			exports.createBranch = createBranch;
			exports.switchMemoryTab = switchMemoryTab;
			exports.showToast = showToast;
			exports.installBranchApi = installBranchApi;
		};

		// ── store/docs.js ──
		__defs["store/docs.js"] = function (exports) {
			/**
			 * store/docs.js — A5 总监文档 store（V8）
			 *
			 * 迁移源：client.js 5966 ~ 6035（70 行）
			 *   区块标记：`// V8: 总监文档 store`
			 *
			 * 职责：总监文档库的响应式状态容器 —— docs / folders 的 CRUD + 订阅通知 + 首次初始化种子数据。
			 *
			 * ═══════════════════════════════════════════════════════════════════
			 * 状态契约（subscribe 回调收到的 state 形状，**不可改字段名**）
			 * ═══════════════════════════════════════════════════════════════════
			 *   { docs: Doc[], folders: Folder[], loading: boolean, initialized: boolean }
			 *
			 * Doc    : { docId, docName, docType, folderId|null, content, tags[], createdAt, updatedAt }
			 * Folder : { folderId, folderName, docType, createdAt }
			 *
			 * 对外 API（**与原实现方法名逐一对应**）：
			 *   getState() / subscribe(fn) / init() / createDoc() / updateDoc() / deleteDoc()
			 *   createFolder() / getDocsByType() / getDocsByFolder()
			 *
			 * 依赖（本插件模块）：`idb.js` —— idbListFolders / idbListDocs / idbSaveFolder / idbSaveDoc / idbDeleteDoc
			 *
			 * ⚠️ 注意（原样保留的行为，勿"顺手优化"）：
			 *   1. `init()` 有 `state.initialized` 短路 —— 重复调用不重复加载。
			 *   2. 种子数据创建条件为 `folders.length === 0 && docs.length === 0`（同时为空才播种）。
			 *   3. 种子文档 `doc-sample-2` 的 docType 为 `"requirement_index"`，**不在 DIRECTOR_DOC_TYPES 中**，
			 *      故其 folderId `folder-requirement_index` 指向一个不存在的文件夹 —— 历史遗留，保持原状。
			 *   4. `createDoc` / `createFolder` 的 id 使用 `Math.random()` —— 与设计规范「禁用 Math.random」
			 *      冲突，但此处**非确定性 RNG 场景**（仅用于 id 去重，不做游戏/仿真逻辑），
			 *      为保证与既有持久化数据 id 形态一致，**原样保留**。
			 */
			
			const { idbListFolders, idbListDocs, idbSaveFolder, idbSaveDoc, idbDeleteDoc } = __m("store/idb.js");
			
			/* ── 硬编码值提取为具名常量 ────────────────────────────────────────── */
			
			/** 总监文档类型枚举（原：DIRECTOR_DOC_TYPES） */
			const DIRECTOR_DOC_TYPES = [
			  { key: "core_memory", label: "核心记忆", color: "#e3f2fd" },
			  { key: "project_index", label: "项目索引", color: "#fff3cd" },
			  { key: "execution_constraints", label: "执行约束", color: "#d4edda" },
			];
			
			/** 文件夹 ID 前缀（原："folder-" + t.key） */
			const FOLDER_ID_PREFIX = "folder-";
			
			/** 文档 ID 前缀（原："doc-" + Date.now() + "-" + rand） */
			const DOC_ID_PREFIX = "doc-";
			
			/** 随机后缀长度（原：Math.random().toString(36).slice(2, 6) → 4 字符） */
			const DOC_ID_RAND_LEN = 4;
			
			/** 文档内容 / 文件夹 / 订阅 等公共默认值 */
			const EMPTY_STATE = { docs: [], folders: [], loading: false, initialized: false };
			
			/**
			 * 首次初始化种子文档（原实现内联在 init() 中，此处上提为常量便于核对）。
			 * @param {number} now 时间戳
			 * @returns {Array<object>}
			 */
			function buildSampleDocs(now) {
			  return [
			    {
			      docId: "doc-sample-1",
			      docName: "总监执行规范",
			      docType: "core_memory",
			      folderId: "folder-core_memory",
			      content: "# 总监执行规范\n\n1. 理解用户意图\n2. 拆解任务步骤\n3. 执行并验证\n4. 归档结果",
			      tags: ["规范"],
			      createdAt: now,
			      updatedAt: now,
			    },
			    {
			      docId: "doc-sample-2",
			      docName: "当前项目需求",
			      docType: "requirement_index",
			      folderId: "folder-requirement_index",
			      content: "# 当前项目需求\n\n- 对话滚动定位\n- 总监持久化\n- 本地模型打通",
			      tags: ["需求"],
			      createdAt: now,
			      updatedAt: now,
			    },
			  ];
			}
			
			/** 生成随机 id 后缀（4 字符 base36） */
			function randSuffix() {
			  return Math.random().toString(36).slice(2, 2 + DOC_ID_RAND_LEN);
			}
			
			/**
			 * 创建总监文档 store（工厂函数，原样保留：每次调用产生独立实例）。
			 */
			function createDirectorDocsStore() {
			  let state = { ...EMPTY_STATE };
			  const listeners = /* @__PURE__ */ new Set();
			
			  function notify() {
			    for (const fn of listeners) fn(state);
			  }
			
			  return {
			    getState: () => state,
			
			    subscribe: (fn) => {
			      listeners.add(fn);
			      return () => listeners.delete(fn);
			    },
			
			    async init() {
			      if (state.initialized) return;
			      state = { ...state, loading: true };
			      notify();
			
			      const [folders, docs] = await Promise.all([idbListFolders(), idbListDocs()]);
			
			      // 首次初始化：创建默认文件夹和示例文档
			      if (folders.length === 0 && docs.length === 0) {
			        const now = Date.now();
			        const defaultFolders = DIRECTOR_DOC_TYPES.map((t) => ({
			          folderId: FOLDER_ID_PREFIX + t.key,
			          folderName: t.label,
			          docType: t.key,
			          createdAt: now,
			        }));
			        for (const f of defaultFolders) await idbSaveFolder(f);
			
			        const sampleDocs = buildSampleDocs(now);
			        for (const d of sampleDocs) await idbSaveDoc(d);
			
			        state = { docs: sampleDocs, folders: defaultFolders, loading: false, initialized: true };
			      } else {
			        state = { docs, folders, loading: false, initialized: true };
			      }
			      notify();
			
			      if (typeof window !== "undefined" && window.__dshDebug) {
			        window.__dshDebug.log("docs", "directorDocsStore initialized: " + folders.length + " folders, " + docs.length + " docs");
			      }
			    },
			
			    async createDoc(docName, docType, folderId, content) {
			      const docId = DOC_ID_PREFIX + Date.now() + "-" + randSuffix();
			      const doc = {
			        docId,
			        docName,
			        docType,
			        folderId: folderId || null,
			        content: content || "",
			        tags: [],
			        createdAt: Date.now(),
			        updatedAt: Date.now(),
			      };
			      await idbSaveDoc(doc);
			      state = { ...state, docs: [doc, ...state.docs] };
			      notify();
			      return doc;
			    },
			
			    async updateDoc(docId, patch) {
			      const doc = state.docs.find((d) => d.docId === docId);
			      if (!doc) return null;
			      const updated = { ...doc, ...patch, updatedAt: Date.now() };
			      await idbSaveDoc(updated);
			      state = { ...state, docs: state.docs.map((d) => (d.docId === docId ? updated : d)) };
			      notify();
			      return updated;
			    },
			
			    async deleteDoc(docId) {
			      await idbDeleteDoc(docId);
			      state = { ...state, docs: state.docs.filter((d) => d.docId !== docId) };
			      notify();
			    },
			
			    async createFolder(folderName, docType) {
			      const folderId = FOLDER_ID_PREFIX + Date.now() + "-" + randSuffix();
			      const folder = { folderId, folderName, docType, createdAt: Date.now() };
			      await idbSaveFolder(folder);
			      state = { ...state, folders: [...state.folders, folder] };
			      notify();
			      return folder;
			    },
			
			    getDocsByType(docType) {
			      return state.docs.filter((d) => d.docType === docType);
			    },
			
			    getDocsByFolder(folderId) {
			      return state.docs.filter((d) => d.folderId === folderId);
			    },
			  };
			}
			
			/** 单例（原实现：`const directorDocsStore = createDirectorDocsStore();`） */
			const directorDocsStore = createDirectorDocsStore();
			
			exports.DIRECTOR_DOC_TYPES = DIRECTOR_DOC_TYPES;
			exports.FOLDER_ID_PREFIX = FOLDER_ID_PREFIX;
			exports.DOC_ID_PREFIX = DOC_ID_PREFIX;
			exports.DOC_ID_RAND_LEN = DOC_ID_RAND_LEN;
			exports.createDirectorDocsStore = createDirectorDocsStore;
			exports.directorDocsStore = directorDocsStore;
		};

		// ── store/file-adapter.js ──
		__defs["store/file-adapter.js"] = function (exports) {
			/**
			 * store/file-adapter.js — A6 持久化探测 + 文件通道适配器
			 *
			 * 迁移源：client.js **6036 ~ 6214**（179 行）
			 *   - 6042        `window.__directorPersistState` 初始化
			 *   - 6044-6112   早期 `__dshDebug` 初始化 → ⛔ **不迁移**（已由批次 1 `util/debug.js` 完整取代）
			 *   - 6113-6200   Electron 文件存储探测三法（window.require / global.require / electron.remote.require）
			 *   - 6176-6178   `directorStoreFile` 路径确定（`%APPDATA%/dsh-director/director-store.json`）
			 *   - 6201-6214   `safeDirectorKey` → 已迁入 `store/persist.js`（A7）
			 *
			 * ─────────────────────────────────────────────────────────────────────────
			 * 🔴 T5 实测结论（2026-09-11 真机 CDP，见《插件迁移明细清单》§8.5）
			 * ─────────────────────────────────────────────────────────────────────────
			 *   `window.require` / `global.require` / `electron.remote.require` /
			 *   `process.versions.electron` —— **全部 `undefined`**。
			 *
			 *   ⇒ 宿主 A6 的三法探测链是**死代码**（生产环境恒不可达），其后的
			 *     `directorFs.writeFileSync(...)` 分支从未真正执行。
			 *   ⇒ 故本模块**不端口死代码**，改建为现代三通道：
			 *
			 *     ① File System Access API（`showSaveFilePicker` / `showOpenFilePicker`）
			 *        —— 真文件读写，**需用户手势**，用于「导出/导入」类显式操作
			 *     ② OPFS（`navigator.storage.getDirectory()`）
			 *        —— 免手势的**异步**持久层，最接近原「文件落盘」语义
			 *     ③ IndexedDB / localStorage
			 *        —— 既有主层与兜底层（见 `idb.js` / `persist.js`）
			 *
			 *   legacy 三法仅保留 `typeof` 探测（`probeLegacyRequire`）作回归对照与留痕。
			 *
			 * ⚠️ 同步性约束（关键设计）
			 *   宿主的 `loadDirectorStore` 是**同步**函数，而 OPFS 全异步。
			 *   故本模块提供 `preloadStoreFile()`（异步，安装期调用一次）+ `getCachedPayload()`
			 *   （同步读缓存），使 `loadDirectorStore` 保持同步签名，语义与宿主一致。
			 */
			
			/** OPFS 内目录名（沿用宿主的 `dsh-director` 命名） */
			const DIRECTOR_DIR_NAME = "dsh-director";
			/** store 文件名（沿用宿主的 `director-store.json`） */
			const DIRECTOR_STORE_FILENAME = "director-store.json";
			/** 日志文件名（沿用宿主的 `debug.log`） */
			const DIRECTOR_LOG_FILENAME = "debug.log";
			
			/** 宿主 legacy 路径所用的目录名（`%APPDATA%/dsh-director`）—— 仅作展示对照 */
			const LEGACY_APPDATA_DIR = "dsh-director";
			
			/** 内存缓存：OPFS 预读结果（供同步 `loadDirectorStore` 使用） */
			let __cachedPayload = null;
			/** 缓存是否已尝试过预读（区分「未预读」与「预读后为空」） */
			let __preloadAttempted = false;
			/** OPFS 根句柄缓存 */
			let __opfsRootPromise = null;
			
			/* ── 持久化统计状态（宿主 6042 原样保留字段与语义）────────────────── */
			
			/**
			 * 初始化 `window.__directorPersistState`（宿主 6042 原样迁移）。
			 * 额外新增 `fileChannel` 字段用于暴露本模块的通道判定（向后兼容：只增不改）。
			 */
			function installPersistState() {
				if (typeof window === "undefined") return null;
				if (window.__directorPersistState) return window.__directorPersistState;
				window.__directorPersistState = {
					saveCount: 0,
					loadCount: 0,
					lastSaveTime: null,
					lastLoadTime: null,
					lastError: null,
					savedMessages: 0,
					localStorageAvailable: typeof localStorage !== "undefined",
					idbAvailable: typeof indexedDB !== "undefined",
					// ── 本模块新增（只增不改）──
					opfsAvailable: null, // 异步探测，见 preloadStoreFile
					fileChannel: null // "opfs" | "none"
				};
				return window.__directorPersistState;
			}
			
			/** 取持久化统计状态（可能为 null） */
			function getPersistState() {
				return typeof window !== "undefined" ? window.__directorPersistState || null : null;
			}
			
			/* ── legacy 三法探测（留痕，不参与实际读写）──────────────────────── */
			
			/**
			 * 探测宿主 original 三法是否可达。
			 * **不用于读写** —— 仅用于回归对照：若未来 Harness 开启 Node 集成，可据此重新评估。
			 * @returns {{name:string, ok:boolean, detail:string}[]}
			 */
			function probeLegacyRequire() {
				const g = typeof globalThis !== "undefined" ? globalThis : {};
				const one = (name, getter) => {
					try {
						const v = getter();
						return v == null
							? { name, ok: false, detail: "值为 " + v }
							: { name, ok: true, detail: "类型 " + typeof v };
					} catch (e) {
						return { name, ok: false, detail: "抛错: " + (e && e.message ? e.message : String(e)) };
					}
				};
				return [
					one("window.require", () => (typeof window !== "undefined" ? window.require : undefined)),
					one("global.require", () => g.global && g.global.require),
					one("electron.remote.require", () => g.electron && g.electron.remote && g.electron.remote.require),
					one("process.versions.electron", () => g.process && g.process.versions && g.process.versions.electron)
				];
			}
			
			/* ── 现代通道判定 ─────────────────────────────────────────────── */
			
			/** OPFS 是否可用（同步判定，只查 API 是否存在） */
			function isOpfsAvailable() {
				// ⚠️ 必须用 Boolean() 收口：Node 21+ 内置 `navigator` 全局但无 `navigator.storage`，
				//    `a && b && c` 的短路会返回中间值 `undefined` 而非布尔 false，
				//    导致契约字段 opfs 出现 undefined（已由 verify-install 在离线链路实测捕获）。
				return Boolean(
					typeof navigator !== "undefined"
					&& navigator.storage
					&& typeof navigator.storage.getDirectory === "function"
				);
			}
			
			/** File System Access API 是否可用（同步判定） */
			function isFsaAvailable() {
				return Boolean(
					typeof window !== "undefined"
					&& typeof window.showSaveFilePicker === "function"
					&& typeof window.showOpenFilePicker === "function"
				);
			}
			
			/** 是否存在任意可用的持久化文件通道 */
			function isFileChannelAvailable() {
				return Boolean(isOpfsAvailable() || isFsaAvailable());
			}
			
			/* ── OPFS 读写 ─────────────────────────────────────────────────── */
			
			/** 取 OPFS 根目录句柄（首次调用后缓存 Promise） */
			function getOpfsRoot() {
				if (!isOpfsAvailable()) return Promise.resolve(null);
				if (__opfsRootPromise) return __opfsRootPromise;
				__opfsRootPromise = navigator.storage.getDirectory().catch(() => null);
				return __opfsRootPromise;
			}
			
			/** 取 `dsh-director` 子目录句柄（不存在则创建） */
			async function getDirectorDir(create) {
				const root = await getOpfsRoot();
				if (!root) return null;
				try {
					return await root.getDirectoryHandle(DIRECTOR_DIR_NAME, { create: Boolean(create) });
				} catch {
					return null;
				}
			}
			
			/**
			 * 预读 store 文件到内存缓存（**安装期调用一次**）。
			 * 使后续 `getCachedPayload()` 可同步取值，从而 `loadDirectorStore` 保持同步签名。
			 * @returns {Promise<boolean>} 是否读到非空内容
			 */
			async function preloadStoreFile() {
				__preloadAttempted = true;
				const state = getPersistState();
				if (!isOpfsAvailable()) {
					if (state) { state.opfsAvailable = false; state.fileChannel = "none"; }
					return false;
				}
				if (state) state.opfsAvailable = true;
				try {
					const dir = await getDirectorDir(false);
					if (!dir) { if (state) state.fileChannel = "none"; return false; }
					const fh = await dir.getFileHandle(DIRECTOR_STORE_FILENAME, { create: false });
					const file = await fh.getFile();
					const text = await file.text();
					if (text && text.length > 0) {
						__cachedPayload = text;
						if (state) state.fileChannel = "opfs";
						return true;
					}
				} catch {
					/* 文件不存在或不可读 → 静默，走降级链 */
				}
				if (state) state.fileChannel = "none";
				return false;
			}
			
			/**
			 * 同步取预读缓存。
			 * @returns {string|null} JSON 文本；未预读或为空时返回 null
			 */
			function getCachedPayload() {
				return __preloadAttempted ? __cachedPayload : null;
			}
			
			/** 清空内存缓存（登出/重置用） */
			function clearCachedPayload() {
				__cachedPayload = null;
				__preloadAttempted = false;
			}
			
			/**
			 * 写入 store 到 OPFS，并**读回校验**（沿用宿主 6283-6286 的 save-verify 纪律）。
			 * @param {string} payload JSON 文本
			 * @returns {Promise<boolean>} 写后读回是否一致
			 */
			async function writePayload(payload) {
				if (!isOpfsAvailable()) return false;
				try {
					const dir = await getDirectorDir(true);
					if (!dir) return false;
					const fh = await dir.getFileHandle(DIRECTOR_STORE_FILENAME, { create: true });
					const w = await fh.createWritable();
					await w.write(payload);
					await w.close();
					// 写后读回校验
					const back = await (await fh.getFile()).text();
					const ok = back === payload;
					if (ok) {
						__cachedPayload = payload;
						__preloadAttempted = true;
						const state = getPersistState();
						if (state) state.fileChannel = "opfs";
					}
					return ok;
				} catch {
					return false;
				}
			}
			
			/** 删除 store 文件（重置用） */
			async function deleteStoreFile() {
				clearCachedPayload();
				if (!isOpfsAvailable()) return false;
				try {
					const dir = await getDirectorDir(false);
					if (!dir) return false;
					await dir.removeEntry(DIRECTOR_STORE_FILENAME);
					return true;
				} catch {
					return false;
				}
			}
			
			/**
			 * 追加一行到 OPFS `debug.log`（宿主 6056-6065 / 6072-6081 的文件日志语义）。
			 * ⚠️ 与宿主不同：这里是**异步**的；调用方不该 await（日志失败不影响主流程）。
			 * @param {string} line 已格式化的整行（含换行）
			 */
			function appendLogLine(line) {
				if (!isOpfsAvailable()) return Promise.resolve(false);
				return (async () => {
					try {
						const dir = await getDirectorDir(true);
						if (!dir) return false;
						const fh = await dir.getFileHandle(DIRECTOR_LOG_FILENAME, { create: true });
						const existing = await (await fh.getFile()).text();
						const w = await fh.createWritable();
						await w.write(existing + line);
						await w.close();
						return true;
					} catch {
						return false;
					}
				})();
			}
			
			/** 读取 OPFS `debug.log` 全文（诊断导用） */
			async function readLogFile() {
				if (!isOpfsAvailable()) return null;
				try {
					const dir = await getDirectorDir(false);
					if (!dir) return null;
					const fh = await dir.getFileHandle(DIRECTOR_LOG_FILENAME, { create: false });
					return await (await fh.getFile()).text();
				} catch {
					return null;
				}
			}
			
			/* ── File System Access API（需用户手势的显式导入/导出）──────────── */
			
			/**
			 * 用 FSA 保存任意文本（弹系统保存框，需用户手势）。
			 * @param {string} suggestedName 建议文件名
			 * @param {string} text 内容
			 * @returns {Promise<boolean>}
			 */
			async function exportViaFsa(suggestedName, text) {
				if (!isFsaAvailable()) return false;
				try {
					const handle = await window.showSaveFilePicker({ suggestedName });
					const w = await handle.createWritable();
					await w.write(text);
					await w.close();
					return true;
				} catch {
					return false; // 用户取消或权限拒绝
				}
			}
			
			/**
			 * 用 FSA 读取文本（弹系统打开框，需用户手势）。
			 * @returns {Promise<string|null>}
			 */
			async function importViaFsa() {
				if (!isFsaAvailable()) return null;
				try {
					const [handle] = await window.showOpenFilePicker({
						types: [{ description: "Director Store", accept: { "application/json": [".json"] } }]
					});
					return await (await handle.getFile()).text();
				} catch {
					return null;
				}
			}
			
			/* ── 调试日志 → OPFS 文件桥接 ─────────────────────────────────── */
			
			/**
			 * 把统一调试日志（`window.__dshDebug`）桥接到 OPFS `debug.log`，
			 * 复现宿主 6056-6065 / 6072-6081 的「日志实时落文件」行为。
			 *
			 * 宿主当时是 `directorFs.appendFileSync(logFile, line)`（O(1) 追加）；
			 * OPFS **无追加 API**，只能「读全文 → 拼接 → 覆盖写」，故为 O(n) 每行。
			 * 日志本身有 2000 条上限（见 `util/debug.js` 的 `DSH_DEBUG_MAX_LOGS`），
			 * 实测可行；若后续发现成为热点，改为内存缓冲 + 定时/批量 flush。
			 *
			 * 幂等：重复调用只包装一次（`__fileLogBridged` 守卫）。
			 * @returns {boolean} 是否已完成桥接（或此前已桥接）
			 */
			function bridgeDebugLogToFile() {
				if (typeof window === "undefined" || !window.__dshDebug) return false;
				const dbg = window.__dshDebug;
				if (dbg.__fileLogBridged) return true;
			
				const format = (scope, message, data, level) =>
					"[" + new Date().toISOString() + "] [" + level + "] [" + scope + "] " + message
					+ (data !== undefined && data !== null ? " " + JSON.stringify(data) : "") + "\n";
			
				for (const [name, level] of [["log", "INFO"], ["warn", "WARN"]]) {
					const orig = dbg[name];
					if (typeof orig !== "function") continue;
					dbg[name] = function (scope, message, data) {
						const ret = orig.apply(this, arguments);
						try {
							// 不 await：日志落盘失败不得影响主流程
							appendLogLine(format(scope, message, data, level));
						} catch {
							/* 忽略 */
						}
						return ret;
					};
				}
				dbg.__fileLogBridged = true;
				return true;
			}
			
			exports.DIRECTOR_DIR_NAME = DIRECTOR_DIR_NAME;
			exports.DIRECTOR_STORE_FILENAME = DIRECTOR_STORE_FILENAME;
			exports.DIRECTOR_LOG_FILENAME = DIRECTOR_LOG_FILENAME;
			exports.LEGACY_APPDATA_DIR = LEGACY_APPDATA_DIR;
			exports.installPersistState = installPersistState;
			exports.getPersistState = getPersistState;
			exports.probeLegacyRequire = probeLegacyRequire;
			exports.isOpfsAvailable = isOpfsAvailable;
			exports.isFsaAvailable = isFsaAvailable;
			exports.isFileChannelAvailable = isFileChannelAvailable;
			exports.getOpfsRoot = getOpfsRoot;
			exports.preloadStoreFile = preloadStoreFile;
			exports.getCachedPayload = getCachedPayload;
			exports.clearCachedPayload = clearCachedPayload;
			exports.writePayload = writePayload;
			exports.deleteStoreFile = deleteStoreFile;
			exports.appendLogLine = appendLogLine;
			exports.readLogFile = readLogFile;
			exports.exportViaFsa = exportViaFsa;
			exports.importViaFsa = importViaFsa;
			exports.bridgeDebugLogToFile = bridgeDebugLogToFile;
		};

		// ── store/cookie.js ──
		__defs["store/cookie.js"] = function (exports) {
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
			const COOKIE_CHUNK_SIZE = 3000;
			/** 清除旧块时的最大扫描数（原实现硬编码 100） */
			const COOKIE_MAX_CHUNKS = 100;
			/** 默认有效期（天） — 10 年 */
			const COOKIE_DEFAULT_DAYS = 3650;
			
			function dshCookieSet(name, value, days) {
				try {
					const expires = new Date(Date.now() + (days || COOKIE_DEFAULT_DAYS) * 86400000).toUTCString();
					document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/";
					return true;
				} catch (e) { return false; }
			}
			
			function dshCookieGet(name) {
				try {
					const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\/+^])/g, "\$1") + "=([^;]*)"));
					return match ? decodeURIComponent(match[1]) : null;
				} catch (e) { return null; }
			}
			
			function dshCookieSave(key, data) {
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
			
			function dshCookieLoad(key) {
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
			
			exports.COOKIE_CHUNK_SIZE = COOKIE_CHUNK_SIZE;
			exports.COOKIE_MAX_CHUNKS = COOKIE_MAX_CHUNKS;
			exports.COOKIE_DEFAULT_DAYS = COOKIE_DEFAULT_DAYS;
			exports.dshCookieSet = dshCookieSet;
			exports.dshCookieGet = dshCookieGet;
			exports.dshCookieSave = dshCookieSave;
			exports.dshCookieLoad = dshCookieLoad;
		};

		// ── store/persist.js ──
		__defs["store/persist.js"] = function (exports) {
			/**
			 * store/persist.js — A7 + A8 总监 store 的加载与保存
			 *
			 * 迁移源：
			 *   A7 `loadDirectorStore` + `safeDirectorKey`  → client.js **6215 ~ 6273**（59 行）
			 *   A8 `saveDirectorStore`                      → client.js **6274 ~ 6326**（53 行）
			 *
			 * ─────────────────────────────────────────────────────────────────────────
			 * 持久化层次（与宿主一一对应，仅替换死掉的文件通道）
			 * ─────────────────────────────────────────────────────────────────────────
			 *   加载顺序（同步）：
			 *     ① OPFS 预读缓存（`fileAdapter.getCachedPayload()`）← 替代已死的 `directorFs` 同步读
			 *     ② Cookie（`dsh_director_<key>`，V10 分块）        ← 宿主 6230 原样
			 *     ③ localStorage（`dsh.director.store.<key>`）      ← 宿主 6248 原样
			 *
			 *   保存顺序（异步，全部双写 + 写后读回校验）：
			 *     ① OPFS 写入（`fileAdapter.writePayload`，含 verify）
			 *     ② localStorage 写入 + **读回校验**（宿主 6290-6298 的 `lsOk` 纪律原样保留）
			 *     ③ IndexedDB（`idbSave`，V9.2 起 await 等待落盘）  ← 宿主 6301 原样
			 *     ④ Cookie 同步存储                                 ← 宿主 6303 原样
			 *
			 * 🔴 关键不变量（V9 修复点，**不可回归**）
			 *   `safeDirectorKey` 对空 sessionId 必须返回固定串 `"director-main"`。
			 *   历史上曾用 UUID 作 key 导致持久化全面失效（每次刷新 key 都变）。
			 *
			 * 🔴 兼容约束（R5）
			 *   - localStorage 前缀 `dsh.director.store.`（见 `messages.js`）
			 *   - Cookie key 前缀 `dsh_director_`，且需兼容旧固定 key `dsh_director_cookie`
			 *
			 * 相对宿主的两处**行为差异**（刻意为之，非疏漏）
			 *   1. OPFS 是异步的 → 加载路径改为「安装期预读一次 + 同步读缓存」，
			 *      使 `loadDirectorStore` 保持同步签名（宿主调用方依赖同步返回）。
			 *   2. 因此**首次启动**若 OPFS 里已有数据，而预读尚未完成，加载会走 cookie/localStorage。
			 *      预读在 `installBatch3()` 中 await（见 client-entry），故正常时序下不会发生。
			 */
			
			const { DIRECTOR_STORE_PREFIX } = __m("store/messages.js");
			const { idbSave, idbLoad } = __m("store/idb.js");
			const { dshCookieSave, dshCookieLoad } = __m("store/cookie.js");
			const { getCachedPayload, writePayload, getPersistState, DIRECTOR_DIR_NAME, DIRECTOR_STORE_FILENAME } = __m("store/file-adapter.js");
			
			/**
			 * 总监默认配置（宿主中在 6224 / 6242 / 6266 / 6332 **重复出现 4 次**，此处提取为单一真源）。
			 * ⚠️ 字段与默认值必须与宿主逐字一致，否则存量用户配置合并结果会漂移。
			 */
			const DIRECTOR_DEFAULT_CONFIG = {
				autoForward: true,
				localModel: { enabled: false, endpoint: "http://localhost:11434", model: "qwen2:7b" },
				duties: {
					languagePolish: { enabled: true, name: "语言规范整理" },
					contextMemory: { enabled: true, name: "上下文记忆" },
					executionLogic: { enabled: true, name: "执行逻辑分析" },
					modelRouting: { enabled: false, name: "模型路由" },
					returnReview: { enabled: true, name: "对话返回审核" }
				}
			};
			
			/**
			 * 深克隆默认配置。
			 * ⚠️ **必须克隆**：宿主在 6224/6242/6266/6332 处每次都是**新建对象字面量**，
			 *    故各 store 的 `config.duties` / `config.localModel` 互不共享。
			 *    提取为模块级常量后若直接引用，会导致多个 store 共享同一子对象
			 *    （改 A 的 duties 会串改 B），属真实保真度缺陷。
			 */
			function cloneDirectorDefaultConfig() {
				return JSON.parse(JSON.stringify(DIRECTOR_DEFAULT_CONFIG));
			}
			
			/** 合并默认配置与已存配置（宿主 4 处的 `{...DEFAULT, ...(parsed.config||{})}` 语义） */
			function mergeConfig(saved) {
				return { ...cloneDirectorDefaultConfig(), ...(saved || {}) };
			}
			
			/** 记日志到统一调试通道（scope 固定 "persist"，与宿主一致） */
			function plog(msg, data) {
				if (typeof window !== "undefined" && window.__dshDebug && typeof window.__dshDebug.log === "function") {
					window.__dshDebug.log("persist", msg, data);
				}
			}
			function pwarn(msg, data) {
				if (typeof window !== "undefined" && window.__dshDebug && typeof window.__dshDebug.warn === "function") {
					window.__dshDebug.warn("persist", msg, data);
				}
			}
			
			/* ── A7：key 派生 ─────────────────────────────────────────────── */
			
			const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			
			/**
			 * 由 sessionId 派生稳定的存储 key 后缀（宿主 6201-6214 **逐字等价迁移**）。
			 *   - 空/未传 → `"director-main"`（**V9 修复点，不可改**）
			 *   - UUID     → `director-<前8位>`
			 *   - 其他     → `director-<djb2-ish 32 位哈希的 base36 前8位>`
			 * @param {string} [sessionId]
			 * @returns {string}
			 */
			function safeDirectorKey(sessionId) {
				if (!sessionId) return "director-main";
				const sid = String(sessionId);
				if (UUID_RE.test(sid)) return "director-" + sid.substring(0, 8);
				let hash = 0;
				for (let i = 0; i < sid.length; i++) {
					hash = ((hash << 5) - hash) + sid.charCodeAt(i);
					hash |= 0; // 保持 32 位有符号整数语义（与宿主一致）
				}
				return "director-" + Math.abs(hash).toString(36).substring(0, 8);
			}
			
			/** localStorage / IDB 所用的完整 key */
			function directorStorageKey(sessionId) {
				return DIRECTOR_STORE_PREFIX + safeDirectorKey(sessionId);
			}
			
			/** Cookie 所用的完整 key（V10；前缀 `dsh_director_` 不可改） */
			function directorCookieKey(sessionId) {
				return "dsh_director_" + safeDirectorKey(sessionId);
			}
			
			/* ── A7：加载 ─────────────────────────────────────────────────── */
			
			/**
			 * 同步加载总监 store（宿主 6215-6272 等价迁移，仅把死掉的文件读换成 OPFS 缓存读）。
			 * @param {string} [sessionId]
			 * @returns {{messages:Array, config:object}|null} 无数据时返回 null
			 */
			function loadDirectorStore(sessionId) {
				const st = getPersistState();
				try {
					// ① OPFS 预读缓存（替代宿主 6218 的 directorFs.existsSync + readFileSync）
					const cached = getCachedPayload();
					if (cached) {
						try {
							const parsed = JSON.parse(cached);
							plog("V9.3 load from file(OPFS): msgs=" + (parsed.messages?.length || 0)
								+ " bytes=" + cached.length + " file=OPFS:" + DIRECTOR_DIR_NAME + "/" + DIRECTOR_STORE_FILENAME);
							if (st) {
								st.loadCount++;
								st.lastLoadTime = Date.now();
								st.savedMessages = parsed.messages?.length || 0;
							}
							return { messages: parsed.messages || [], config: mergeConfig(parsed.config) };
						} catch (e) {
							pwarn("V9.3 load from file(OPFS) failed: " + e.message + ", fallback to cookie/localStorage");
						}
					}
			
					// ② Cookie（V10：最可靠，同步持久化）
					let cookieData = dshCookieLoad(directorCookieKey(sessionId));
					// 兼容旧固定 key（宿主 6232-6238 原样）
					if ((!cookieData || !cookieData.messages) && typeof window !== "undefined") {
						const oldData = dshCookieLoad("dsh_director_cookie");
						if (oldData && oldData.messages) {
							cookieData = oldData;
							plog("V10 load from old cookie key (compatibility)");
						}
					}
					if (cookieData && cookieData.messages) {
						plog("V10 load from cookie: msgs=" + cookieData.messages.length);
						if (st) {
							st.loadCount++;
							st.lastLoadTime = Date.now();
							st.savedMessages = cookieData.messages.length;
						}
						return { messages: cookieData.messages || [], config: mergeConfig(cookieData.config) };
					}
			
					// ③ localStorage
					if (typeof localStorage === "undefined") {
						if (st) st.lastError = "load: localStorage unavailable";
						return null;
					}
					const key = directorStorageKey(sessionId);
					const raw = localStorage.getItem(key);
					if (!raw) {
						// V9.2：枚举所有 dsh.director* key 做诊断（宿主 6252-6258 原样）
						let allKeys = "";
						try {
							for (let i = 0; i < localStorage.length; i++) {
								const k = localStorage.key(i);
								if (k && k.indexOf("dsh.director") === 0) {
									allKeys += k + "(" + (localStorage.getItem(k) || "").length + "bytes) ";
								}
							}
						} catch (e) {
							allKeys = "enumerate failed: " + e.message;
						}
						plog("load: no data for key=" + key + " | all director keys: [" + (allKeys || "none") + "]");
						if (st) {
							st.loadCount++;
							st.lastLoadTime = Date.now();
						}
						return null;
					}
					const parsed = JSON.parse(raw);
					plog("load: key=" + key + " msgs=" + (parsed.messages?.length || 0) + " bytes=" + raw.length);
					if (st) {
						st.loadCount++;
						st.lastLoadTime = Date.now();
						st.savedMessages = parsed.messages?.length || 0;
					}
					return { messages: parsed.messages || [], config: mergeConfig(parsed.config) };
				} catch (e) {
					pwarn("load failed: " + e.message);
					if (st) st.lastError = "load: " + e.message;
					return null;
				}
			}
			
			/* ── A8：保存 ─────────────────────────────────────────────────── */
			
			/**
			 * 保存总监 store（宿主 6274-6326 等价迁移；**异步**，宿主原本即 async）。
			 * 四条写入路径全部执行，任一成功即视为成功（返回 `fileOk || lsOk || idbOk`，与宿主一致）。
			 * @param {string} [sessionId]
			 * @param {{messages:Array, config:object}} state
			 * @returns {Promise<boolean>}
			 */
			async function saveDirectorStore(sessionId, state) {
				const st = getPersistState();
				try {
					const key = directorStorageKey(sessionId);
					const payload = JSON.stringify({ messages: state.messages, config: state.config });
			
					// ① OPFS（含写后读回校验，替代宿主 6280-6288）
					let fileOk = false;
					try {
						fileOk = await writePayload(payload);
						plog("V9.3 save to file(OPFS): " + (fileOk ? "OK" : "FAIL")
							+ " msgs=" + state.messages.length + " bytes=" + payload.length);
					} catch (e) {
						pwarn("V9.3 save to file(OPFS) failed: " + e.message);
					}
			
					// ② localStorage + 读回校验（宿主 6290-6298 的 lsOk 纪律原样保留）
					let lsOk = false;
					if (typeof localStorage !== "undefined") {
						try {
							localStorage.setItem(key, payload);
							const verify = localStorage.getItem(key);
							lsOk = (verify === payload);
							plog("save-verify: localStorage " + (lsOk ? "OK" : "FAIL")
								+ " key=" + key + " verifyLen=" + (verify ? verify.length : 0));
						} catch (e) {
							pwarn("localStorage save failed: " + e.message);
						}
					}
			
					// ③ IndexedDB（V9.2 起 await 确保真正落盘）
					const idbOk = await idbSave(key, { messages: state.messages, config: state.config, savedAt: Date.now() });
			
					// ④ Cookie 同步存储（V10）
					const cookieOk = dshCookieSave(directorCookieKey(sessionId), {
						messages: state.messages,
						config: state.config,
						savedAt: Date.now()
					});
					plog("V10 save to cookie: " + (cookieOk ? "OK" : "FAIL") + " msgs=" + state.messages.length);
			
					// V9.2：保存后 dump localStorage（宿主 6306-6314 诊断逻辑原样）
					let lsDump = "";
					try {
						for (let i = 0; i < localStorage.length; i++) {
							const k = localStorage.key(i);
							if (k && k.indexOf("dsh.director") === 0) {
								lsDump += k + "(" + (localStorage.getItem(k) || "").length + "b) ";
							}
						}
					} catch (e) {
						lsDump = "dump failed: " + e.message;
					}
					plog("save: key=" + key + " msgs=" + state.messages.length + " bytes=" + payload.length
						+ " fileOk=" + fileOk + " lsOk=" + lsOk + " idbOk=" + idbOk
						+ " | localStorage dump: [" + (lsDump || "empty") + "]");
			
					if (st) {
						st.saveCount++;
						st.lastSaveTime = Date.now();
						st.savedMessages = state.messages.length;
					}
					return fileOk || lsOk || idbOk;
				} catch (e) {
					pwarn("save failed: " + e.message);
					if (st) st.lastError = "save: " + e.message;
					return false;
				}
			}
			
			/** 供 A9 hydrate 使用的 IDB 读取（宿主 6356 的 `idbLoad(key)`） */
			async function loadDirectorStoreFromIdb(sessionId) {
				try {
					return await idbLoad(directorStorageKey(sessionId));
				} catch {
					return null;
				}
			}
			
			exports.DIRECTOR_DEFAULT_CONFIG = DIRECTOR_DEFAULT_CONFIG;
			exports.cloneDirectorDefaultConfig = cloneDirectorDefaultConfig;
			exports.safeDirectorKey = safeDirectorKey;
			exports.directorStorageKey = directorStorageKey;
			exports.directorCookieKey = directorCookieKey;
			exports.loadDirectorStore = loadDirectorStore;
			exports.saveDirectorStore = saveDirectorStore;
			exports.loadDirectorStoreFromIdb = loadDirectorStoreFromIdb;
		};

		// ── store/create-store.js ──
		__defs["store/create-store.js"] = function (exports) {
			/**
			 * store/create-store.js — A9 `createDirectorStore` store 工厂
			 *
			 * 迁移源：client.js **6327 ~ 6403**（77 行）
			 *   - 6327-6395 `createDirectorStore(sessionId)`：组装 state + dispatch + subscribe
			 *   - 6396-6403 `directorStoreFactory(sessionId)`：按 `safeDirectorKey` 分桶复用（单例注册表）
			 *
			 * 另含与 A9 同区块、语义强耦合的两段（不拆走会让 store 失去退出前保存能力）：
			 *   - 6408-6437 `beforeunload` 注册：退出前把有消息的 store 落盘
			 *
			 * ─────────────────────────────────────────────────────────────────────────
			 * 设计要点
			 * ─────────────────────────────────────────────────────────────────────────
			 * 1. **`notify()` 每次都写盘**（宿主 6335-6338 原样）—— 任何状态变更都触发
			 *    `saveDirectorStore`，这是宿主「永不丢消息」策略的核心，勿优化为 debounce。
			 * 2. **`hydrate()` 的 IDB 合并防竞态**（宿主 6358-6362，V9.4-P1 修复）：
			 *    IDB 异步返回期间用户可能已发新消息，故**只前插缺失消息、不整体覆盖**。
			 *    该逻辑必须原样保留，否则会复现「刷新后消息回退」缺陷。
			 * 3. **`addMessage` 的 id 生成用 `Math.random()`**（宿主 6378 原样）——
			 *    属非确定性 RNG 的历史数据形态，勿改为确定性 RNG（会与存量 id 形态不一致）。
			 * 4. **`reset()` 的 config 只留 `{autoForward:true}`**（宿主 6391 原样）——
			 *    看似与 `DIRECTOR_DEFAULT_CONFIG` 不一致，但属既有行为，勿"顺手修正"。
			 * 5. **配置对象必须深克隆**（见 `cloneDirectorDefaultConfig`），否则多个 store 会共享
			 *    `config.duties` 同一引用。
			 */
			
			const { directorStores } = __m("store/messages.js");
			const { loadDirectorStore, saveDirectorStore, loadDirectorStoreFromIdb, safeDirectorKey, cloneDirectorDefaultConfig, directorStorageKey } = __m("store/persist.js");
			const { writePayload } = __m("store/file-adapter.js");
			
			/** 记日志（scope 固定 "persist"，与宿主一致） */
			function plog(msg, data) {
				if (typeof window !== "undefined" && window.__dshDebug && typeof window.__dshDebug.log === "function") {
					window.__dshDebug.log("persist", msg, data);
				}
			}
			function pwarn(msg, data) {
				if (typeof window !== "undefined" && window.__dshDebug && typeof window.__dshDebug.warn === "function") {
					window.__dshDebug.warn("persist", msg, data);
				}
			}
			
			/**
			 * 创建一个总监 store（宿主 6327-6395 等价迁移）。
			 * @param {string} [sessionId]
			 * @returns {object} store 实例
			 */
			function createDirectorStore(sessionId) {
				const persisted = loadDirectorStore(sessionId);
				let state = {
					messages: persisted ? persisted.messages : [],
					status: "idle",
					config: persisted ? persisted.config : cloneDirectorDefaultConfig()
				};
			
				const listeners = new Set();
			
				/** 状态变更 → 落盘 + 通知订阅者（宿主 6335-6338 原样） */
				function notify() {
					saveDirectorStore(sessionId, state);
					for (const fn of listeners) fn(state);
				}
			
				return {
					sessionId,
					getState: () => state,
					subscribe: (fn) => {
						listeners.add(fn);
						return () => listeners.delete(fn);
					},
					/**
					 * 重新加载（宿主 6346-6374）。
					 * ① 同步：cookie/localStorage/OPFS 缓存
					 * ② 异步：IndexedDB —— **按消息 key 集合 merge，只前插缺失项**（V9.4-P1 防竞态）
					 */
					hydrate: () => {
						// ① 同步层快速初始值
						const reloaded = loadDirectorStore(sessionId);
						if (reloaded) {
							state = { ...state, messages: reloaded.messages, config: reloaded.config };
							notify();
							plog("hydrate(sync): loaded " + state.messages.length + " messages for sessionId=" + sessionId);
						}
						// ② 异步层（IndexedDB，更可靠）
						const key = directorStorageKey(sessionId);
						loadDirectorStoreFromIdb(sessionId).then((idbData) => {
							if (idbData && idbData.messages) {
								// V9.4-P1: 防竞态 —— 只补充 idb 中存在而当前缺失的历史消息（前插），不覆盖现有消息
								const msgKeyOf = (m) => m && (m.id || m.ts || m.timestamp);
								const existingKeys = new Set(state.messages.map(msgKeyOf).filter(Boolean));
								const missing = idbData.messages.filter((m) => {
									const k = msgKeyOf(m);
									return k && !existingKeys.has(k);
								});
								if (missing.length > 0) {
									state = {
										...state,
										messages: [...missing, ...state.messages],
										config: idbData.config || state.config
									};
									notify();
									plog("hydrate(IndexedDB): merged " + missing.length
										+ " missing messages (total=" + state.messages.length + ") for sessionId=" + sessionId);
								} else {
									plog("hydrate(IndexedDB): no missing messages, skipping. idbMsgs="
										+ idbData.messages.length + " localMsgs=" + state.messages.length);
								}
							} else {
								plog("hydrate(IndexedDB): no data for key=" + key);
							}
						});
					},
					/** 追加一条消息（自动补 id/ts；宿主 6375-6381 原样） */
					addMessage: (msg) => {
						state = {
							...state,
							messages: [...state.messages, {
								id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
								ts: Date.now(),
								...msg
							}]
						};
						notify();
					},
					setStatus: (status) => {
						state = { ...state, status };
						notify();
					},
					setConfig: (patch) => {
						state = { ...state, config: { ...state.config, ...patch } };
						notify();
					},
					/** 重置（宿主 6390-6393 原样：config 仅留 autoForward） */
					reset: () => {
						state = { messages: [], status: "idle", config: { autoForward: true } };
						notify();
					}
				};
			}
			
			/**
			 * 按 `safeDirectorKey(sessionId)` 分桶取（或建）store —— 进程内单例注册表
			 * （宿主 6396-6403 等价迁移）。
			 * @param {string} [sessionId]
			 * @returns {object} store 实例
			 */
			function directorStoreFactory(sessionId) {
				const mapKey = safeDirectorKey(sessionId);
				if (!directorStores.has(mapKey)) {
					plog("directorStoreFactory: create new store for key=" + mapKey + " (sessionId type=" + typeof sessionId + ")");
					directorStores.set(mapKey, createDirectorStore(sessionId));
				}
				return directorStores.get(mapKey);
			}
			
			/**
			 * 注册 `beforeunload` 兜底保存（宿主 6408-6437 等价迁移）。
			 * 幂等（`window.__directorBeforeUnloadRegistered` 守卫生效）。
			 *
			 * ⚠️ 与宿主的差异：OPFS 是异步 API，`beforeunload` 中无法 await。
			 *    故此处对 OPFS 采取 **fire-and-forget**，而 localStorage 仍同步写（与宿主一致）。
			 */
			function installBeforeUnloadSave() {
				if (typeof window === "undefined" || window.__directorBeforeUnloadRegistered) return false;
				window.__directorBeforeUnloadRegistered = true;
				window.addEventListener("beforeunload", () => {
					try {
						for (const [key, store] of directorStores.entries()) {
							const state = store.getState();
							if (state.messages.length === 0) continue;
							const lsKey = key.startsWith("dsh.director.store.") ? key : "dsh.director.store." + key;
							const payload = JSON.stringify({ messages: state.messages, config: state.config });
			
							// ① OPFS：异步不可 await，尽力而为
							let fileDispatched = false;
							try {
								writePayload(payload).then(() => {}).catch(() => {});
								fileDispatched = true;
							} catch (e) { /* 忽略 */ }
			
							// ② localStorage：同步写入（与宿主一致）
							try { localStorage.setItem(lsKey, payload); } catch (e) { /* 忽略 */ }
			
							// ③ 诊断 dump
							let lsDump = "";
							try {
								for (let i = 0; i < localStorage.length; i++) {
									const k = localStorage.key(i);
									if (k && k.indexOf("dsh.director") === 0) {
										lsDump += k + "(" + (localStorage.getItem(k) || "").length + "b) ";
									}
								}
							} catch (e) { lsDump = "dump failed: " + e.message; }
							plog("beforeunload save: key=" + lsKey + " msgs=" + state.messages.length
								+ " fileDispatched=" + fileDispatched + " | localStorage dump: [" + (lsDump || "empty") + "]");
						}
					} catch (e) {
						pwarn("beforeunload failed: " + e.message);
					}
				});
				return true;
			}
			
			/**
			 * 查询 `beforeunload` 兜底保存的**最终注册态**（宿主或插件任一注册即为 true）。
			 *
			 * 为何需要：`installBeforeUnloadSave()` 的返回值语义是「**本次调用是否新注册**」，
			 * 而宿主内联代码（client.js:6409）使用了**同一守卫名** `__directorBeforeUnloadRegistered`
			 * 且先于插件执行。因此真机上「未新注册」= 幂等守卫按设计生效，**不代表能力缺失**。
			 * 该函数提供「能力是否就绪」的判据，供验证脚本区分「假阴性」与「真缺失」。
			 *
			 * @returns {boolean}
			 */
			function isBeforeUnloadRegistered() {
				return typeof window !== "undefined" && Boolean(window.__directorBeforeUnloadRegistered);
			}
			
			exports.createDirectorStore = createDirectorStore;
			exports.directorStoreFactory = directorStoreFactory;
			exports.installBeforeUnloadSave = installBeforeUnloadSave;
			exports.isBeforeUnloadRegistered = isBeforeUnloadRegistered;
		};

		// ── store/use-store.js ──
		__defs["store/use-store.js"] = function (exports) {
			/**
			 * store/use-store.js — A10 `useDirectorStore` React hook 绑定
			 *
			 * 迁移源：client.js **6404 ~ 6407**（4 行）
			 *
			 * 宿主原实现（在同 realm 内、已实测可用）：
			 *   ```js
			 *   function useDirectorStore(store) {
			 *     const subscribe = (0, react.useCallback)((fn) => store.subscribe(fn), [store]);
			 *     return (0, react.useSyncExternalStore)(subscribe, store.getState, store.getState);
			 *   }
			 *   ```
			 *
			 * ─────────────────────────────────────────────────────────────────────────
			 * 平台模块 external 契约（ADR-001）
			 * ─────────────────────────────────────────────────────────────────────────
			 * `react` **必须 external**，由 bundle factory 的 `require` 提供，严禁打进产物
			 * （否则产生第二个 React 实例 → hooks 失效 / 崩溃）。
			 *
			 * 权威依据：`@deepseek-ai/dsh-client-web/lib/index.js` 的 `getStaticModules()`
			 * （第 165 行）返回的平台单例表**明确包含** `"react": React`：
			 *   react / react/jsx-runtime / react-dom / react-dom/client / @deepseek-ai/cordis /
			 *   dsh-client-ui-slots / dsh-client-web-react / dsh-client-ui-primitives /
			 *   dsh-client-ui-attachment / dsh-client-schema-form
			 *
			 * 本模块是插件中**首个使用平台模块**的模块，故也是 bundler「平台外置」能力的
			 * 首个使用者（`build/build.mjs` 会把它改写为 `require("react")`，
			 * 并在构建日志的「平台外置」行列出）。
			 *
			 * 说明：`useSyncExternalStore` 需要 React ≥ 18。宿主原内联代码在同一 realm 内
			 * 一直使用它并正常工作，故此处等价迁移无版本风险。
			 */
			
			const { useCallback, useSyncExternalStore } = require("react");
			
			/**
			 * 把总监 store 绑成 React hook（宿主 6404-6407 等价迁移）。
			 * @param {object} store `createDirectorStore` 产出的 store 实例
			 * @returns {object} 当前 state（`store.getState()` 的返回值）
			 */
			function useDirectorStore(store) {
				const subscribe = useCallback((fn) => store.subscribe(fn), [store]);
				return useSyncExternalStore(subscribe, store.getState, store.getState);
			}
			
			/**
			 * 便捷变体：由 sessionId 直接取 store 并订阅（宿主无此形态，为本插件新增便利方法）。
			 * ⚠️ 属**新增 API**，非迁移项；宿主侧调用点仍走 `useDirectorStore(store)`。
			 * @param {(sessionId:string)=>object} factory 通常是 `directorStoreFactory`
			 * @param {string} [sessionId]
			 */
			function useDirectorStoreBySession(factory, sessionId) {
				const store = factory(sessionId);
				return useDirectorStore(store);
			}
			
			exports.useDirectorStore = useDirectorStore;
			exports.useDirectorStoreBySession = useDirectorStoreBySession;
		};

		// ── logic/process.js ──
		__defs["logic/process.js"] = function (exports) {
			/**
			 * logic/process.js — D1 总监对话核心处理函数
			 *
			 * 迁移来源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
			 *   源区间：**6706 ~ 6818**（含区块头注释；函数体 6707~6818）
			 *   迁移方式：**逐字保真**（逻辑与分支、消息文案、时序、锁语义均不改）
			 *
			 * 依赖映射（宿主内联 → 插件模块）
			 *   directorConfig               ← config/model.js（C2）
			 *   classifyTask                 ← config/model.js（C2）
			 *   polishLanguage               ← config/model.js（C2）
			 *   callLocalModel               ← config/model.js（C2）
			 *   saveDirectorStore            ← store/persist.js（A8）
			 *   idbGetMemoryCore             ← store/memory.js（A2）
			 *   window.__dshDebug            ← util/debug.js（D3，全局契约）
			 *   window.__dshDocsIndex        ← store/docs-index-inject.js（A13+A14，全局契约）
			 *
			 * 调用方（**本批次不改接线**）
			 *   宿主 client.js:11763 `window.__directorSubmit` → `directorProcess(sessionId, draft, dStore, t, onForward)`
			 *   宿主侧 F3 区属**批次 6**接线范围；本批次仅提供插件侧实现与全局契约。
			 *
			 * ⚠️ 迁移保真要点（勿顺手优化）
			 *   - V9.4-P1 **并发锁**：`processing` / `calling-local-model` 期间拒绝重入，防止消息交错。
			 *   - 步骤 1~5 的**执行顺序与条件**不得调整；`reasoning` 的三处赋值存在**互斥优先级**。
			 *   - 步骤 5 转发使用 `setTimeout(..., 300)` —— 延迟是刻意的（等 UI 落定），勿改。
			 *   - `t`（i18n 翻译函数）在宿主原实现中**未被使用**，此处保留形参以维持 5 参签名兼容。
			 */
			
			const { directorConfig, classifyTask, polishLanguage, callLocalModel } = __m("config/model.js");
			const { saveDirectorStore } = __m("store/persist.js");
			const { idbGetMemoryCore } = __m("store/memory.js");
			
			/**
			 * 总监消息处理主链路：并发锁 → 语言整理 → 本地模型 → 上下文记忆 → 执行逻辑 → 落盘 → 自动转发。
			 *
			 * @param {string} sessionId 会话 ID
			 * @param {string} userText 用户输入原文
			 * @param {object} store 总监 store（A9 `createDirectorStore` 产物）
			 * @param {Function} t i18n 翻译函数（宿主原实现未使用，保留签名）
			 * @param {(instruction:string)=>void} [onForward] 自动转发回调
			 * @returns {Promise<void>}
			 */
			async function directorProcess(sessionId, userText, store, t, onForward) {
				const config = store.getState().config || directorConfig;
				if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "directorProcess called: userText=" + userText.slice(0, 50) + " msgsBefore=" + store.getState().messages.length);
				// V9.4-P1: 并发锁 —— 上一次处理未结束时拒绝重入，防止消息交错/状态卡死
				const currentStatus = store.getState().status;
				if (currentStatus === "processing" || currentStatus === "calling-local-model") {
					store.addMessage({ role: "system", content: "⏳ 总监正在处理上一条指令，请稍候再发送。" });
					return;
				}
				store.addMessage({ role: "user", content: userText });
				store.setStatus("processing");
				// V9.2: 用户消息立即落盘，确保不丢失
				await saveDirectorStore(sessionId, store.getState());
			
				try {
					const history = store.getState().messages.slice(-10).map(m => `${m.role}: ${m.content}`).join("\n");
					const taskType = classifyTask(userText);
					const taskNames = { code: "代码开发", design: "系统设计", research: "资料调研", writing: "文本整理", chat: "日常对话" };
			
					let polished = userText;
					let reasoning = "";
					let modelSuggestion = "deepseek-chat";
					let branchSuggestion = "沿用当前分支";
			
					// 步骤1：语言规范整理
					if (config.duties?.languagePolish?.enabled) {
						polished = polishLanguage(userText);
					}
			
					// 步骤2：调用本地模型（如果启用）
					if (config.localModel?.enabled) {
						store.setStatus("calling-local-model");
						// V11: 读取项目记忆注入上下文
						let projectMemory = "";
						try {
							// 注：宿主原式为 `typeof idbGetMemoryCore === "function"`；迁移后为静态 import，
							//     该守卫恒真。保留原形态以便与宿主逐行对照（行为等价）。
							if (typeof idbGetMemoryCore === "function") {
								var memCore = await idbGetMemoryCore("default");
								if (memCore) {
									var memParts = [];
									if (memCore.positioning) memParts.push("项目定位: " + memCore.positioning);
									if (memCore.goal) memParts.push("项目目标: " + memCore.goal);
									if (memCore.currentPhase) memParts.push("当前阶段: " + memCore.currentPhase);
									if (memCore.conversationHistory && memCore.conversationHistory.length > 0) memParts.push("历史决策数: " + memCore.conversationHistory.length);
									if (memParts.length > 0) projectMemory = memParts.join("\n");
								}
							}
						} catch (e) { if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("memory", "load project memory failed: " + e.message); }
						// V11: 读取文档索引摘要
						let docsSummary = "";
						try {
							if (typeof window !== "undefined" && window.__dshDocsIndex && window.__dshDocsIndex.docs) {
								var docs = window.__dshDocsIndex.docs;
								docsSummary = "项目文档库: 共" + docs.length + "篇文档";
								// 简单关键词匹配，取最相关的3篇文档标题
								var keywords = userText.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 1; });
								var relevant = docs.filter(function(d) {
									return keywords.some(function(k) { return (d.title || "").toLowerCase().indexOf(k) !== -1 || (d.content || "").toLowerCase().indexOf(k) !== -1; });
								}).slice(0, 3);
								if (relevant.length > 0) {
									docsSummary += "\n相关文档:\n" + relevant.map(function(d) { return "- " + d.title + (d.docType ? " (" + d.docType + ")" : ""); }).join("\n");
								}
							}
						} catch (e) {}
						var memorySection = projectMemory ? "\n\n## 项目记忆\n" + projectMemory : "";
						var docsSection = docsSummary ? "\n\n## " + docsSummary : "";
						const localPrompt = `你是一个AI助手总监，负责管理和指导项目开发。请基于项目记忆和文档上下文，分析以下用户输入，整理语言并给出执行建议。${memorySection}${docsSection}\n\n## 历史对话\n${history}\n\n## 用户输入\n${userText}\n\n请输出：\n1. 整理后的指令（简洁明确）\n2. 任务类型判断（代码开发/系统设计/资料调研/文本整理/日常对话）\n3. 模型建议（deepseek-chat/deepseek-coder等）\n4. 简要推理过程（结合项目记忆和文档上下文）`;
						const localResult = await callLocalModel(localPrompt, config);
						if (localResult) {
							reasoning = localResult;
							const match = localResult.match(/整理后的指令[：:]\s*(.+?)(?:\n|$)/);
							if (match) polished = match[1].trim();
						}
					}
			
					// 步骤3：上下文记忆分析
					if (config.duties?.contextMemory?.enabled && !reasoning) {
						const recentTopics = store.getState().messages.filter(m => m.role === "user").slice(-3).map(m => m.content.slice(0, 30));
						reasoning = `任务类型：${taskNames[taskType]}\n上下文关联：${recentTopics.length > 0 ? "与最近" + recentTopics.length + "条对话相关" : "新话题"}\n语言整理：${polished !== userText ? "已整理" : "无需整理"}\n模型建议：${modelSuggestion}`;
					}
					if (!reasoning) reasoning = `任务类型：${taskNames[taskType]}，直接转发。`;
			
					// 步骤4：执行逻辑分析
					if (config.duties?.executionLogic?.enabled && taskType === "code") {
						reasoning += "\n执行建议：建议分步实现，先确认需求再编码。";
					}
			
					const parsed = {
						instruction: polished,
						model: modelSuggestion,
						branch: branchSuggestion,
						taskType: taskType,
						reasoning: reasoning
					};
			
					store.addMessage({
						role: "assistant",
						content: `【总监分析】\n${reasoning}`,
						parsed: parsed
					});
					store.setStatus("done");
			
					// 步骤5：自动转发
					if (config.autoForward && typeof onForward === "function") {
						setTimeout(() => onForward(parsed.instruction), 300);
					}
				} catch (err) {
					store.addMessage({ role: "system", content: `总监处理失败: ${err.message}` });
					store.setStatus("error");
				}
				// V9.2: 最终确保所有消息落盘
				await saveDirectorStore(sessionId, store.getState());
			}
			
			exports.directorProcess = directorProcess;
		};

		// ── logic/review.js ──
		__defs["logic/review.js"] = function (exports) {
			/**
			 * logic/review.js — D2 对话返回审核（**保留能力，当前无调用点**）
			 *
			 * 迁移来源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
			 *   源区间：**6820 ~ 6855**（含区块头注释）
			 *   迁移方式：**逐字保真**
			 *
			 * 🔴 状态判定：**死代码 —— 「保留不调用」（有意为之，非遗漏）**
			 *   三重证据：
			 *   ① `grep -rn "directorReviewReturn"` 全仓**唯一命中即定义行**（宿主 6821），**零调用点**；
			 *   ② `docs/20-任务文档/10-总监对话模式问题修复开发文档-v2.md:213` —— 「移除 `directorReviewReturn` 函数（或保留但不调用）」；
			 *   ③ 同上 `:219` —— 「**保留 `directorReviewReturn` 函数定义（供未来使用），但不调用**」；
			 *      `docs/30-开发链路/V10-代码修改点映射文档.md:92` F30 行 —— `directorReviewReturn()` / 保留 / 已有 / 「返回审核（AI 化）」。
			 *   → 故本模块**不接入 `client-entry.js` 的自动装配链**，仅在插件内提供实现 + 全局契约，
			 *     待未来明确启用时再由接线层调用。**请勿因「未接线」而判定为迁移遗漏。**
			 *
			 * 依赖映射（宿主内联 → 插件模块）
			 *   directorConfig   ← config/model.js（C2）
			 *   callLocalModel   ← config/model.js（C2）
			 *
			 * ⚠️ 迁移保真要点（勿顺手优化）
			 *   - 首行两个早退：`returnReview` 未启用 → 直接 return；内容 < 10 字 → 记一条 system 消息后 return。
			 *   - 本地模型分支（AI 审核）与规则模板分支（启发式打分）**互斥**，由 `config.localModel.enabled` 决定。
			 *   - 规则模板的 3 条启发式与基础分 `5 - issues.length`（下限 1）**原样保留**。
			 *   - `sessionId` 与 `t` 在宿主原实现中**未被使用**，保留形参以维持 4 参签名兼容。
			 */
			
			const { directorConfig, callLocalModel } = __m("config/model.js");
			
			/**
			 * 审核模型返回内容质量（AI 审核 / 规则模板审核二选一）。
			 *
			 * @param {string} sessionId 会话 ID（宿主原实现未使用，保留签名）
			 * @param {string} returnText 待审核的模型返回文本
			 * @param {object} store 总监 store（A9 `createDirectorStore` 产物）
			 * @param {Function} t i18n 翻译函数（宿主原实现未使用，保留签名）
			 * @returns {Promise<void>}
			 */
			async function directorReviewReturn(sessionId, returnText, store, t) {
				const config = store.getState().config || directorConfig;
				if (!config.duties?.returnReview?.enabled) return;
				if (!returnText || returnText.length < 10) {
					store.addMessage({ role: "system", content: "【返回审核】返回内容过短（" + returnText.length + "字），跳过审核。" });
					return;
				}
				store.addMessage({ role: "system", content: "【返回审核】正在审核模型返回内容（" + returnText.length + "字）..." });
				// 如果本地模型启用，使用模型审核
				if (config.localModel?.enabled) {
					try {
						var reviewPrompt = "你是一位严格的内容审核专家。请审核以下AI模型返回的内容，从以下维度评估：\n1. 准确性：内容是否准确，有无事实错误\n2. 完整性：是否完整回答了问题，有无遗漏\n3. 相关性：是否与问题相关，有无跑题\n4. 格式规范：格式是否清晰，代码块/列表是否正确\n5. 安全性：有无不安全或不当内容\n\n返回内容：\n" + returnText.slice(0, 2000) + (returnText.length > 2000 ? "\n...（内容过长，仅审核前2000字）" : "") + "\n\n请输出审核结论（通过/需改进/不通过）+ 各维度评分（1-5分）+ 具体问题和改进建议。";
						var reviewResult = await callLocalModel(reviewPrompt, config);
						if (reviewResult) {
							store.addMessage({ role: "system", content: "【返回审核结果】\n" + reviewResult });
						} else {
							store.addMessage({ role: "system", content: "【返回审核】本地模型审核未返回结果，已记录内容长度 " + returnText.length + " 字。" });
						}
					} catch (err) {
						store.addMessage({ role: "system", content: "【返回审核】审核出错：" + err.message + "。已记录内容长度 " + returnText.length + " 字。" });
					}
				} else {
					// 本地模型未启用，使用规则模板审核
					var issues = [];
					if (returnText.length < 50) issues.push("内容过短，可能未完整回答");
					if (/TODO|FIXME|待补充|占位/.test(returnText)) issues.push("包含待补充/占位内容");
					if (/```[\s\S]*```/.test(returnText) && returnText.split("```").length % 2 === 0) issues.push("代码块可能未正确闭合");
					var score = 5 - issues.length;
					if (score < 1) score = 1;
					store.addMessage({
						role: "system",
						content: "【返回审核】规则模板审核结果：\n- 内容长度：" + returnText.length + "字\n- 综合评分：" + score + "/5\n" + (issues.length > 0 ? "- 发现问题：\n" + issues.map(function(i) { return "  • " + i; }).join("\n") : "- 未发现明显问题\n- 建议：启用本地模型可获得更深入的AI审核")
					});
				}
			}
			
			exports.directorReviewReturn = directorReviewReturn;
		};

		// ── components/DirectorFlow.js ──
		__defs["components/DirectorFlow.js"] = function (exports) {
			/**
			 * components/DirectorFlow.js — E1 小窗总监对话流组件
			 *
			 * 迁移来源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
			 *   源区间：**6972 ~ 7085**（含区块头注释；组件体 6973~7084）
			 *   迁移方式：**逐字保真**，唯一例外见下方 🔴「迁移期修正」
			 *
			 * 依赖映射（宿主内联 → 插件模块）
			 *   directorStoreFactory ← store/create-store.js（A9）
			 *   useDirectorStore     ← store/use-store.js（A10）
			 *   dshLog / dshScrollProbe ← util/debug.js（D3）
			 *   react / react/jsx-runtime ← **平台模块**（构建期外置为 `require(...)`，不打包；见 ADR-001）
			 *
			 * 调用方（**本批次不改接线**）
			 *   宿主 client.js:7358 —— 小窗（a-2 / b-2）内 `(0, react_jsx_runtime.jsx)(DirectorFlow, {...})`
			 *   宿主侧调用点属**批次 6**接线范围；本批次提供插件侧实现与全局契约。
			 *
			 * 🔴🔴 迁移期修正（唯一偏离「逐字保真」处，务必勿回退）
			 *
			 *   宿主原代码 7050 行（快照实测）：
			 *       `: filteredMessages.map((msg) =>`
			 *   而 `filteredMessages` 在**宿主全文件中从未于 `DirectorFlow` 作用域内定义**：
			 *     · 快照 `snapshot-20260902-103319` 实测：使用点 = 7047；定义点 = **9161**，
			 *       位于 `const filteredMessages = (0, react.useMemo)(...)`，处于**兄弟组件 `DirectorView` 的函数作用域内**；
			 *     · `DirectorFlow` 与 `DirectorView` 是同级兄弟函数，**作用域互不可见** ⇒ 该引用**自诞生即为越界引用**；
			 *     · 2026-09-08 P2 死代码清理删除 `DirectorView`（墓志铭 client.js:8897）后，**连越界定义也消失**，
			 *       该标识符在当前宿主中 **全文件零定义**（`grep -c "filteredMessages"` = 1，仅命中使用点 7050）。
			 *   后果：只要组件被渲染且 `state.messages.length > 0`，必然抛 `ReferenceError: filteredMessages is not defined`。
			 *
			 *   修正：改用 `state.messages`（与本文件 7048 行 `state.messages.length` 的数据源一致）。
			 *   语义：`filteredMessages` 的原意是「按当前分支过滤后」的消息列表；分支过滤能力属于
			 *        `DirectorView` 的状态体系（`currentBranch` / `switchToBranch`），不在 E1 迁移边界内。
			 *        故此处**降级为渲染全部消息** —— 这是最小且语义正确的修复，不越界扩张迁移范围。
			 *   ⚠️ 若未来要恢复分支过滤，应作为**独立需求**实现（先定义 `DirectorFlow` 自身的 currentBranch 状态），
			 *       **禁止**再把 `DirectorView` 的局部变量直接引用过来。
			 *
			 * ⚠️ 其他迁移保真要点（勿顺手优化）
			 *   - `dfFindScroller` 向上最多 15 层寻找可滚动祖先；`V9.2` 的 `minHeight:0` 样式修复必须保留（否则 flex 链高度塌陷）。
			 *   - `V9.4-P1 atBottom 守卫`：用户上翻历史时不抢回底部；但用户自己发消息（`lastMsg.role === "user"`）仍强制滚底。
			 *   - 双 `requestAnimationFrame` 嵌套是刻意的（等布局落定后再滚），勿压成单层。
			 *   - 滚动监听注册在**真实 scroller**（非 ref 元素）上，`{ passive: true }` 保留。
			 */
			
			const react = require("react");
			const react_jsx_runtime = require("react/jsx-runtime");
			const { directorStoreFactory } = __m("store/create-store.js");
			const { useDirectorStore } = __m("store/use-store.js");
			const { dshLog, dshScrollProbe } = __m("util/debug.js");
			
			/**
			 * 小窗总监对话流（紧凑/非紧凑两态）。
			 *
			 * @param {object} props
			 * @param {string} props.sessionId 会话 ID
			 * @param {(instruction:string)=>void|null} [props.onConfirmSend] 手动确认发送回调（autoForward 关闭时显示按钮）
			 * @param {boolean} [props.compact] 紧凑模式（小窗）
			 * @param {Function|null} [props.onContainerClick] 容器点击回调
			 * @returns {object} React 元素
			 */
			function DirectorFlow({ sessionId, onConfirmSend = null, compact = false, onContainerClick = null }) {
				const store = directorStoreFactory(sessionId);
				const state = useDirectorStore(store);
				const messagesEndRef = (0, react.useRef)(null);
				const atBottomRef = (0, react.useRef)(true);
				const dfFindScroller = (fromEl) => {
					let el = fromEl;
					let depth = 0;
					while (el && depth < 15) {
						const style = window.getComputedStyle(el);
						const overflowY = style.overflowY;
						if (el.scrollHeight > el.clientHeight + 1 && (overflowY === "auto" || overflowY === "scroll")) {
							return el;
						}
						el = el.parentElement;
						depth++;
					}
					return fromEl;
				};
				const dfScrollToBottom = (el) => {
					if (!el) return;
					const scroller = dfFindScroller(el);
					scroller.scrollTop = scroller.scrollHeight;
					atBottomRef.current = true;
					dshLog("a2-DirectorFlow", "dfScrollToBottom: scroller found, scrollTop=" + scroller.scrollTop + " scrollHeight=" + scroller.scrollHeight + " clientHeight=" + scroller.clientHeight);
					dshScrollProbe("a2-DirectorFlow", scroller);
				};
				// 初始挂载 + 消息/状态变化时自动滚到底部
				(0, react.useLayoutEffect)(() => {
					const el = messagesEndRef.current;
					if (!el) return;
					// V9.4-P1: atBottom 守卫 —— 用户上翻历史时不抢回底部；用户自己发消息仍强制滚底
					const lastMsg = state.messages[state.messages.length - 1];
					if (!atBottomRef.current && lastMsg?.role !== "user") return;
					dshLog("a2", "DirectorFlow layout effect: msgs=" + state.messages.length + " status=" + state.status + " → force scroll bottom");
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							if (messagesEndRef.current) {
								dfScrollToBottom(messagesEndRef.current);
							}
						});
					});
				}, [state.messages.length, state.status, state.messages]);
				// 滚动事件：更新 atBottom 状态（监听真正的滚动容器）
				(0, react.useEffect)(() => {
					const fromEl = messagesEndRef.current;
					if (!fromEl) return;
					const scroller = dfFindScroller(fromEl);
					dshLog("a2-DirectorFlow", "onScroll: bound to scroller, scrollTop=" + scroller.scrollTop + " scrollHeight=" + scroller.scrollHeight + " clientHeight=" + scroller.clientHeight);
					const onScroll = () => {
						atBottomRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 25;
						dshScrollProbe("a2-DirectorFlow", scroller);
					};
					scroller.addEventListener("scroll", onScroll, { passive: true });
					return () => scroller.removeEventListener("scroll", onScroll);
				}, []);
				// 初始挂载：加载持久化数据 + 滚到底部
				(0, react.useEffect)(() => {
					if (store && typeof store.hydrate === "function") {
						dshLog("a2", "DirectorFlow mount: hydrate store for sessionId=" + sessionId);
						store.hydrate();
					}
					const el = messagesEndRef.current;
					if (el) {
						dshLog("a2", "DirectorFlow mount: scroll to bottom");
						requestAnimationFrame(() => dfScrollToBottom(el));
					}
				}, []);
				return (0, react_jsx_runtime.jsx)("div", {
					ref: messagesEndRef,
					onClick: onContainerClick || undefined,
					// V9.2: 增加minHeight:0，flex column布局中子元素必须min-height:0才能正确收缩并触发overflow滚动
					style: { flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" },
					children: (0, react_jsx_runtime.jsx)("div", {
						style: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: compact ? 8 : 12, padding: compact ? 8 : 16, paddingBottom: compact ? 16 : 24 },
						children: state.messages.length === 0
							? (0, react_jsx_runtime.jsx)("div", { style: { color: "#595959", fontSize: compact ? 11 : 13, textAlign: "center", marginTop: 40 }, children: "总监对话流为空，输入消息开始" })
						// 🔴 迁移期修正：宿主原式为 `filteredMessages.map`（越界引用，见文件头论证）→ 改用 state.messages
						: state.messages.map((msg) =>
							(0, react_jsx_runtime.jsxs)("div", {
								key: msg.id,
								style: {
									alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
									maxWidth: compact ? "90%" : "80%",
									padding: compact ? "6px 10px" : "8px 12px",
									borderRadius: 8,
									background: msg.role === "user" ? "#e3f2fd" : msg.role === "system" ? "#fff3cd" : "#f5f5f5",
									fontSize: compact ? 12 : 13,
									lineHeight: 1.5,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word"
								},
								children: [
									msg.role === "assistant" && msg.parsed && (0, react_jsx_runtime.jsxs)("div", {
										style: { marginBottom: 8, padding: "6px 8px", background: "#fff", borderRadius: 4, border: "1px solid #eee", fontSize: compact ? 10 : 11 },
										children: [
											(0, react_jsx_runtime.jsx)("div", { children: `整理后指令: ${msg.parsed.instruction}` }),
											msg.parsed.model && (0, react_jsx_runtime.jsx)("div", { children: `模型建议: ${msg.parsed.model}` }),
											msg.parsed.branch && (0, react_jsx_runtime.jsx)("div", { children: `分支建议: ${msg.parsed.branch}` })
										]
									}),
									(0, react_jsx_runtime.jsx)("div", { children: msg.content }),
									msg.role === "assistant" && msg.parsed && !state.config.autoForward && onConfirmSend && (0, react_jsx_runtime.jsx)("button", {
										onClick: () => onConfirmSend(msg.parsed.instruction),
										style: { marginTop: 8, padding: "4px 12px", fontSize: compact ? 11 : 12, background: "#1976d2", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" },
										children: "确认发送"
									})
								]
							})
						)
					})
				});
			}
			
			exports.DirectorFlow = DirectorFlow;
		};

		// ── store/hierarchy.js ──
		__defs["store/hierarchy.js"] = function (exports) {
			/**
			 * store/hierarchy.js — 多层级总监结构（对话级 / 文件夹级 / 全局级）
			 *
			 * 需求来源（严格按文档，勿自行改动）：
			 *   - 03-总监对话模式开发文档.md §1.3 三层总监体系（:42-52）
			 *       全局总管 → 项目总监（文件夹级）→ 会话总监（当前会话）
			 *   - 同上 §3.2 继承制：默认（全局）→ 项目级 → 会话级，子级可覆盖、可向上提交（:150-167）
			 *   - 17-总监统治架构与项目驾驶舱方案-v9.md §2.1 三层记忆结构 MemoryNode（:365-428）
			 *   - 同上 §2.3 隔离 / 共享 / 继承（:443-447）
			 *
			 * 存储决策（🔴 关键约束：不得新增 IDB store、不得升 DB 版本）
			 *   宿主与插件共享 DB `dsh-director-db` v3（R5 兼容约束）。插件若升 v4，
			 *   宿主再以 v3 打开会失败 ⇒ 版本冲突。故**全部层级节点统一存 `memoryCore`**
			 *   （keyPath `projectId`，这里以 nodeId 作为 projectId），与 17号文
			 *   MemoryNode「level: global|project|subproject + parentId + children[]」定义一致。
			 *
			 * 全局契约：`window.__dshHierarchy`（供宿主/调试/验证脚本调用）
			 */
			
			const { openIDB, IDB_MEMORY_CORE_STORE } = __m("store/idb.js");
			
			/** 层级枚举（对齐 17号文 §2.1 `level`） */
			const LEVEL = {
				GLOBAL: "global",
				PROJECT: "project",
				SESSION: "session"
			};
			
			/** 层级中文名（UI 用） */
			const LEVEL_LABEL = {
				global: "全局总管",
				project: "项目总监",
				session: "会话总监"
			};
			
			/** 全局根节点固定 id（唯一，单例） */
			const GLOBAL_NODE_ID = "__global__";
			
			/** 层级顺序（数字越小越高层） */
			const LEVEL_ORDER = { global: 0, project: 1, session: 2 };
			
			/** 生成节点 id（层级前缀 + 时间戳 + 随机，避免碰撞） */
			function makeNodeId(level) {
				const p = level === LEVEL.GLOBAL ? "g" : level === LEVEL.PROJECT ? "p" : "s";
				return p + "_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);
			}
			
			/**
			 * 创建层级节点（17号文 §2.1 MemoryNode 形态）
			 * @param {object} p
			 * @param {string} [p.id] 指定节点 id（自动同步必须用**数据源派生的稳定 id**，见 logic/discover.js）
			 * @param {string} p.name 节点名
			 * @param {"global"|"project"|"session"} p.level
			 * @param {string|null} p.parentId 父节点 id（全局级为 null）
			 */
			function makeNode({ id, name, level, parentId = null, meta = {} }) {
				const now = Date.now();
				return {
					id: level === LEVEL.GLOBAL ? GLOBAL_NODE_ID : (id || makeNodeId(level)),
					name: name || "未命名",
					level,
					parentId: level === LEVEL.GLOBAL ? null : parentId,
					children: [],
					meta: {
						positioning: "",
						goal: "",
						currentPhase: "",
						...meta,
						createdAt: now,
						updatedAt: now
					},
					docs: [],
					conversations: [],
					decisions: [],
					todos: [],
					risks: [],
					/** 分层总结产物（由 logic/summarize.js 写入） */
					summary: null,
					/** 总结梯度：G0 规则 / G1 本地模型 / G2 上层汇总 */
					summaryGrade: null,
					summaryAt: 0,
					/** 配置继承（03号文 §3.2）：null = 继承父级；非 null = 本级覆盖 */
					configOverride: null
				};
			}
			
			/* ── IDB 读写（统一走 memoryCore） ───────────────────────────── */
			
			function tx(mode, fn) {
				return openIDB().then((db) => new Promise((resolve, reject) => {
					try {
						const t = db.transaction(IDB_MEMORY_CORE_STORE, mode);
						const req = fn(t.objectStore(IDB_MEMORY_CORE_STORE));
						t.oncomplete = () => resolve(req ? req.result : undefined);
						t.onerror = () => reject(t.error);
					} catch (e) { reject(e); }
				}));
			}
			
			/** 读取单个节点 */
			function getNode(id) {
				return tx("readonly", (s) => s.get(id)).then((r) => r || null).catch(() => null);
			}
			
			/**
			 * 写入单个节点（自动维护 updatedAt）
			 *
			 * 🔴 关键：`memoryCore` 的 keyPath 是 **`projectId`**（见 store/idb.js），
			 *    而层级节点的主键字段是 `id`。若不注入 `projectId`，`put()` 的 key 为
			 *    `undefined` → IndexedDB 抛 DataError，**写入静默失败**（catch 吞掉）。
			 *    实测症状：createChild 返回节点但 loadTree 查不到、kids 为空。
			 *    故此处**必须**把 `projectId` 设为 `node.id`（即以 nodeId 作为 projectId）。
			 */
			function saveNode(node) {
				if (!node || !node.id) return Promise.resolve(false);
				const next = { ...node, projectId: node.id, meta: { ...(node.meta || {}), updatedAt: Date.now() } };
				return tx("readwrite", (s) => s.put(next)).then(() => true).catch((e) => {
					if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("hierarchy", "saveNode failed: " + (e && e.message));
					return false;
				});
			}
			
			/** 删除节点（同时把其从父级 children 摘除） */
			async function removeNode(id) {
				const node = await getNode(id);
				if (!node) return false;
				if (node.parentId) {
					const parent = await getNode(node.parentId);
					if (parent) {
						parent.children = (parent.children || []).filter((c) => c !== id);
						await saveNode(parent);
					}
				}
				// 子级升到祖父，避免孤儿
				for (const cid of node.children || []) {
					const child = await getNode(cid);
					if (child) { child.parentId = node.parentId; await saveNode(child); }
				}
				return tx("readwrite", (s) => s.delete(id)).then(() => true).catch(() => false);
			}
			
			/** 全量拉取所有节点 */
			function listAllNodes() {
				return tx("readonly", (s) => s.getAll())
					.then((r) => (r || []).filter((n) => n && n.level))
					.catch(() => []);
			}
			
			/**
			 * 构建层级树（返回根节点数组，节点带 `childNodes`）
			 * 注意：全局级为单例根；游离节点的 parentId 若不存在则挂到全局根下（自愈）。
			 */
			async function loadTree() {
				const all = await listAllNodes();
				const byId = new Map();
				for (const n of all) byId.set(n.id, { ...n, childNodes: [] });
			
				let root = byId.get(GLOBAL_NODE_ID);
				if (!root) {
					root = { ...makeNode({ name: "全局总管", level: LEVEL.GLOBAL }), childNodes: [] };
					byId.set(GLOBAL_NODE_ID, root);
					await saveNode(root);
				}
			
				for (const n of byId.values()) {
					if (n.id === GLOBAL_NODE_ID) continue;
					const parent = n.parentId ? byId.get(n.parentId) : null;
					(parent || root).childNodes.push(n);
				}
				// 🔴 排序依据 `meta.order` 优先：自动同步的节点在同一毫秒内批量创建，
				//    若按 createdAt 排序则顺序不确定（每次刷新树都在抖）。
				//    同步时写入数据源中的序号 ⇒ 树顺序与宿主会话列表一致。
				const rank = (n) => (n.meta && typeof n.meta.order === "number") ? n.meta.order : (n.meta?.createdAt || 0);
				const sortRec = (node) => {
					node.childNodes.sort((a, b) => rank(a) - rank(b));
					node.childNodes.forEach(sortRec);
				};
				sortRec(root);
				return root;
			}
			
			/** 确保全局根存在 */
			async function ensureGlobal() {
				const root = await getNode(GLOBAL_NODE_ID);
				if (root) return root;
				const node = makeNode({ name: "全局总管", level: LEVEL.GLOBAL });
				await saveNode(node);
				return node;
			}
			
			/**
			 * 创建子节点并挂到父级（自动维护父级 children）
			 * @returns {Promise<object>} 新建节点
			 */
			async function createChild(parentId, { name, level, meta }) {
				const parent = await getNode(parentId);
				const node = makeNode({ name, level, parentId, meta });
				await saveNode(node);
				if (parent) {
					parent.children = [...(parent.children || []), node.id];
					await saveNode(parent);
				}
				return node;
			}
			
			/** 登记/挂载一个会话到文件夹级节点（03号文 §1.3「会话总监」） */
			async function attachSession(folderId, { sessionId, title, messageCount = 0, lastMessage = "" }) {
				const folder = await getNode(folderId);
				const node = makeNode({
					name: title || sessionId,
					level: LEVEL.SESSION,
					parentId: folder ? folderId : GLOBAL_NODE_ID
				});
				node.conversations = [{
					conversationId: sessionId,
					title: title || sessionId,
					lastMessage,
					lastTime: Date.now(),
					messageCount
				}];
				await saveNode(node);
				const parent = folder || (await getNode(GLOBAL_NODE_ID));
				if (parent) {
					parent.children = [...(parent.children || []), node.id];
					await saveNode(parent);
				}
				return node;
			}
			
			/**
			 * 配置继承解析（03号文 §3.2 + 17号文 §2.3「继承但可覆盖」）
			 * 从根向下依次覆盖，返回最终生效配置 + 每一项的来源层级。
			 * @param {string} nodeId
			 * @param {object} defaultConfig 全局默认配置
			 */
			async function resolveConfig(nodeId, defaultConfig) {
				const chain = [];
				let cur = await getNode(nodeId);
				while (cur) {
					chain.unshift(cur);
					cur = cur.parentId ? await getNode(cur.parentId) : null;
				}
				let merged = { ...(defaultConfig || {}) };
				const origin = {};
				for (const n of chain) {
					if (n.configOverride && typeof n.configOverride === "object") {
						for (const k of Object.keys(n.configOverride)) {
							merged[k] = n.configOverride[k];
							origin[k] = n.level;
						}
					}
				}
				return { config: merged, origin, chain: chain.map((n) => ({ id: n.id, name: n.name, level: n.level })) };
			}
			
			/** 面包屑（根 → 当前） */
			async function getBreadcrumb(nodeId) {
				const out = [];
				let cur = await getNode(nodeId);
				let guard = 0;
				while (cur && guard++ < 20) {
					out.unshift({ id: cur.id, name: cur.name, level: cur.level });
					cur = cur.parentId ? await getNode(cur.parentId) : null;
				}
				return out;
			}
			
			/** 按层级计数（含自身） */
			function countByLevel(root) {
				const acc = { global: 0, project: 0, session: 0, total: 0 };
				const walk = (n) => {
					acc[n.level] = (acc[n.level] || 0) + 1;
					acc.total++;
					(n.childNodes || []).forEach(walk);
				};
				if (root) walk(root);
				return acc;
			}
			
			/** 层级比较：a 是否高于 b */
			function isHigher(a, b) {
				return (LEVEL_ORDER[a] ?? 99) < (LEVEL_ORDER[b] ?? 99);
			}
			
			/** 安装全局契约 */
			function installHierarchyApi() {
				if (typeof window === "undefined") return null;
				window.__dshHierarchy = {
					LEVEL, LEVEL_LABEL, GLOBAL_NODE_ID,
					makeNode, makeNodeId, getNode, saveNode, removeNode,
					listAllNodes, loadTree, ensureGlobal, createChild, attachSession,
					resolveConfig, getBreadcrumb, countByLevel, isHigher
				};
				return window.__dshHierarchy;
			}
			
			exports.LEVEL = LEVEL;
			exports.LEVEL_LABEL = LEVEL_LABEL;
			exports.GLOBAL_NODE_ID = GLOBAL_NODE_ID;
			exports.makeNodeId = makeNodeId;
			exports.makeNode = makeNode;
			exports.getNode = getNode;
			exports.saveNode = saveNode;
			exports.removeNode = removeNode;
			exports.listAllNodes = listAllNodes;
			exports.loadTree = loadTree;
			exports.ensureGlobal = ensureGlobal;
			exports.createChild = createChild;
			exports.attachSession = attachSession;
			exports.resolveConfig = resolveConfig;
			exports.getBreadcrumb = getBreadcrumb;
			exports.countByLevel = countByLevel;
			exports.isHigher = isHigher;
			exports.installHierarchyApi = installHierarchyApi;
		};

		// ── util/bus.js ──
		__defs["util/bus.js"] = function (exports) {
			/**
			 * util/bus.js — 层级数据变更事件总线（极简，零依赖）
			 *
			 * 为什么需要（🔴 实测缺陷，2026-09-12）
			 *   面板组件在**插件启动时**即挂载并渲染首帧，而此时自动同步
			 *   （`syncFromSource`，异步）**尚未完成**。组件拿到的是"同步前"的陈旧快照：
			 *     实测现象：真机覆盖度已是 会话 8/8 · 文件夹 2/2 · 全局 1/1，
			 *               面板却显示「⚠️ 存在未覆盖 · 会话 0/8 · 文件夹 0/2」，
			 *               且树上只有「全局总管」一个节点。
			 *   根因：缺少"数据已变更"的通知通道，组件首帧之后不再刷新。
			 *
			 * 用法
			 *   数据写入方（sync / summarize / CRUD）：`emitHierarchyChange()`
			 *   视图消费方（组件 / 浮层）      ：`onHierarchyChange(cb)` → 返回取消订阅函数
			 */
			
			const listeners = new Set();
			
			/**
			 * 订阅层级数据变更
			 * @param {() => void} fn
			 * @returns {() => void} 取消订阅
			 */
			function onHierarchyChange(fn) {
				if (typeof fn !== "function") return () => {};
				listeners.add(fn);
				return () => { listeners.delete(fn); };
			}
			
			/** 广播层级数据变更（所有订阅者按注册顺序调用，单个抛错不影响其他） */
			function emitHierarchyChange() {
				for (const fn of Array.from(listeners)) {
					try { fn(); } catch (e) { /* 单个订阅者失败不影响其他 */ }
				}
			}
			
			/** 当前订阅数（调试/验证用） */
			function hierarchyListenerCount() {
				return listeners.size;
			}
			
			exports.onHierarchyChange = onHierarchyChange;
			exports.emitHierarchyChange = emitHierarchyChange;
			exports.hierarchyListenerCount = hierarchyListenerCount;
		};

		// ── logic/summarize.js ──
		__defs["logic/summarize.js"] = function (exports) {
			/**
			 * logic/summarize.js — 分层总结 + 分梯度调用
			 *
			 * 需求来源（严格按文档，勿自行改动）：
			 *   - 17-总监统治架构与项目驾驶舱方案-v9.md §1A.13 项目核心认知自动提取（:336-359）
			 *       提取流程 1-6 步 →「**汇总为项目核心认知**，存储到记忆体系」
			 *   - 同上 §2.1 `conversations[]`（该记忆层下所有对话）→ 分层总结的数据基础
			 *   - 03-总监对话模式开发文档.md §4.3 降级策略（:236-242）
			 *       Ollama 未启动 → 提示并跳过；超时 → 可重试/跳过；格式异常 → 原样展示
			 *   - 03-总监对话模式开发文档.md §1.3 三层体系 → 总结须**逐层向上汇总**
			 *
			 * ── 分梯度调用（三个梯度，自上而下递进，失败自动回落）────────────
			 *   G0 规则抽取 ：零模型。按 §1A.13「核心认知内容」7 项做结构化抽取
			 *                 （定位/目标/当前阶段/核心需求/决策历史/风险偏差/约束条件）
			 *   G1 本地模型 ：Ollama qwen2:7b（config/model.js callLocalModel），
			 *                 把 G0 结构化文本 + 子级摘要 → 自然语言总结
			 *   G2 上层汇总 ：父级对其下**所有子级 summary** 再汇总（递归向上），
			 *                 实现 §1A.13「分层 → 汇总为上层核心认知」
			 *   降级链：G2 →（Ollama 不可用/超时/格式异常）→ G0，并在结果中标注 `degraded`
			 *
			 * 全局契约：`window.__dshSummarize`
			 */
			
			const { callLocalModel, directorConfig } = __m("config/model.js");
			const { getNode, saveNode, LEVEL, LEVEL_LABEL } = __m("store/hierarchy.js");
			const { dshLog } = __m("util/debug.js");
			const { emitHierarchyChange } = __m("util/bus.js");
			
			/** 梯度定义 */
			const GRADE = { RULE: "G0", LOCAL: "G1", ROLLUP: "G2" };
			
			/** 各梯度的模型超时（ms），03号文 §4.3 规定 >30s 需提示，此处与 callLocalModel 一致取 60s 上限 */
			const GRADE_TIMEOUT_MS = 60000;
			
			/**
			 * G0 —— 规则抽取：不调用任何模型，产出结构化文本。
			 * 字段对齐 17号文 §1A.13「核心认知内容」7 项。
			 */
			function extractByRule(node, childSummaries = []) {
				const m = node?.meta || {};
				const conv = node?.conversations || [];
				const lines = [];
			
				lines.push("【层级】" + (LEVEL_LABEL[node?.level] || node?.level || "未知"));
				lines.push("【名称】" + (node?.name || "未命名"));
				if (m.positioning) lines.push("【定位】" + m.positioning);
				if (m.goal) lines.push("【目标】" + m.goal);
				if (m.currentPhase) lines.push("【当前阶段】" + m.currentPhase);
			
				if (node?.level === LEVEL.SESSION || conv.length) {
					const c = conv[0] || {};
					lines.push("【对话】" + (c.title || "-"));
					lines.push("【消息数】" + (c.messageCount ?? 0));
					if (c.lastMessage) lines.push("【最后消息】" + String(c.lastMessage).slice(0, 200));
				}
			
				lines.push("【决策】" + (node?.decisions || []).length + " 条");
				lines.push("【待办】" + (node?.todos || []).length + " 条");
				lines.push("【风险】" + (node?.risks || []).length + " 条");
				lines.push("【文档】" + (node?.docs || []).length + " 篇");
			
				// 结构化明细（截断，控 token）
				const fmt = (arr, key, n = 5) => (arr || []).slice(0, n)
					.map((x) => "  · " + String(x[key] || x.title || x.decisionId || x.todoId || x.riskId || "").slice(0, 120))
					.join("\n");
				if ((node?.decisions || []).length) lines.push("【决策明细】\n" + fmt(node.decisions, "title"));
				if ((node?.todos || []).length) lines.push("【待办明细】\n" + fmt(node.todos, "title"));
				if ((node?.risks || []).length) lines.push("【风险明细】\n" + fmt(node.risks, "title"));
			
				if (childSummaries.length) {
					lines.push("【子级摘要】共 " + childSummaries.length + " 项");
					lines.push(childSummaries.map((s, i) => "  " + (i + 1) + ". " + String(s.text || "").slice(0, 300)).join("\n"));
				}
				return lines.join("\n");
			}
			
			/** G1 —— 本地模型总结。失败返回 null（由调用方回落 G0） */
			async function summarizeByModel(factsText, level) {
				const prompt = [
					"你是项目总监的总结助手。请基于以下结构化事实，生成一份简洁的核心认知摘要。",
					"要求：① 中文；② 不超过 300 字；③ 分「定位/进展/风险/下一步」四小段；④ 只依据事实，不臆造。",
					"",
					"层级：" + (LEVEL_LABEL[level] || level),
					"",
					factsText
				].join("\n");
				try {
					const out = await callLocalModel(prompt, directorConfig);
					if (typeof out === "string" && out.trim()) return out.trim();
					if (out && typeof out.text === "string" && out.text.trim()) return out.text.trim();
					return null;
				} catch (e) {
					dshLog("summarize", "G1 本地模型调用异常，回落 G0: " + (e && e.message));
					return null;
				}
			}
			
			/**
			 * 对单个节点生成总结（自动选梯度 + 降级）
			 *
			 * @param {object} node 目标节点
			 * @param {object[]} [childNodes] 其子级节点（用于 G2 汇总）；缺省则不汇总子级
			 * @param {object} [opts] { forceGrade?: "G0"|"G1" }
			 * @returns {Promise<{text:string, grade:string, degraded:boolean, reason?:string, at:number}>}
			 */
			async function summarizeNode(node, childNodes = [], opts = {}) {
				if (!node) return { text: "", grade: GRADE.RULE, degraded: false, reason: "无节点", at: Date.now() };
			
				// 收集子级已有摘要（G2 的输入）
				const childSummaries = (childNodes || [])
					.filter((c) => c && c.summary)
					.map((c) => ({ id: c.id, name: c.name, text: c.summary }));
			
				const factsText = extractByRule(node, childSummaries);
				const isParent = childSummaries.length > 0;
				let grade = opts.forceGrade || (isParent ? GRADE.ROLLUP : GRADE.LOCAL);
			
				let text = null;
				let degraded = false;
				let reason;
			
				if (grade !== GRADE.RULE) {
					text = await summarizeByModel(factsText, node.level);
					if (!text) { degraded = true; reason = "本地模型不可用或输出异常（03号文 §4.3 降级）"; }
				}
			
				if (!text) {
					// 回落 G0：规则抽取结果直接作为总结（拼接子级摘要）
					grade = GRADE.RULE;
					const head = "（规则抽取 · 未调用模型）\n";
					text = head + factsText;
				}
			
				const result = { text, grade, degraded, at: Date.now() };
				if (reason) result.reason = reason;
				return result;
			}
			
			/**
			 * 分层总结：自底向上汇总整棵树。
			 * 先叶子（会话级）→ 再文件夹级（汇总其子级）→ 最后全局级。
			 * 每一级把结果写回节点（summary / summaryGrade / summaryAt）并落盘。
			 *
			 * @param {object} root loadTree() 返回的根（含 childNodes）
			 * @param {object} [opts] { forceGrade }
			 * @returns {Promise<{count:number, grades:Record<string,number>, degraded:number}>}
			 */
			async function summarizeTree(root, opts = {}) {
				const stats = { count: 0, grades: { G0: 0, G1: 0, G2: 0 }, degraded: 0 };
				if (!root) return stats;
			
				// 后序遍历：先子后父，保证父级能拿到子级最新 summary
				const walk = async (node) => {
					for (const c of node.childNodes || []) await walk(c);
					const res = await summarizeNode(node, node.childNodes || [], opts);
					node.summary = res.text;
					node.summaryGrade = res.grade;
					node.summaryAt = res.at;
					const { childNodes, ...flat } = node;
					await saveNode(flat);
					stats.count++;
					stats.grades[res.grade] = (stats.grades[res.grade] || 0) + 1;
					if (res.degraded) stats.degraded++;
				};
				await walk(root);
				emitHierarchyChange();
				return stats;
			}
			
			/**
			 * 向上提交（03号文 §3.2「会话中修改可提交到项目/全局」）
			 * 把某节点的当前总结向上冒泡：父级重新汇总一次。
			 */
			async function propagateUp(nodeId, opts = {}) {
				const node = await getNode(nodeId);
				if (!node || !node.parentId) return null;
				const parent = await getNode(node.parentId);
				if (!parent) return null;
				// 拉齐父级所有子级的最新 summary
				const kids = [];
				for (const cid of parent.children || []) {
					const c = await getNode(cid);
					if (c) kids.push(c);
				}
				const res = await summarizeNode(parent, kids, opts);
				parent.summary = res.text;
				parent.summaryGrade = res.grade;
				parent.summaryAt = res.at;
				await saveNode(parent);
				emitHierarchyChange();
				return { node: parent, result: res };
			}
			
			/** 安装全局契约 */
			function installSummarizeApi() {
				if (typeof window === "undefined") return null;
				window.__dshSummarize = {
					GRADE, GRADE_TIMEOUT_MS,
					extractByRule, summarizeNode, summarizeTree, propagateUp
				};
				return window.__dshSummarize;
			}
			
			exports.GRADE = GRADE;
			exports.extractByRule = extractByRule;
			exports.summarizeNode = summarizeNode;
			exports.summarizeTree = summarizeTree;
			exports.propagateUp = propagateUp;
			exports.installSummarizeApi = installSummarizeApi;
		};

		// ── logic/discover.js ──
		__defs["logic/discover.js"] = function (exports) {
			/**
			 * logic/discover.js — 真实会话 / 文件夹（workspace）数据源发现层
			 *
			 * 需求来源：「每一个对话都有一个总监 · 每一个文件夹都有总监 · 最上层全局总管负责」
			 *   要让**每一个**对话/文件夹都有总监，节点就不能靠手工创建 ——
			 *   必须从宿主真实数据源**自动发现**会话与文件夹，再逐一定向生成总监节点。
			 *
			 * ── 数据源（实测，2026-09-12 真机 Harness 渲染进程）────────────────
			 *   ① `localStorage["dsh.workspace.view.v5"]`
			 *        {"groupBy":"workspace",
			 *         "sessionOrderByAccount":{ "<workspaceId>": ["session-xxx", ...], "": [...] },
			 *         "sessionUpdatedAtByAccount":{ "<workspaceId>": {"session-xxx": ts, ...} }}
			 *        ⇒ **workspace = 文件夹级**（groupBy 明确为 workspace），
			 *          **session   = 对话级**，且自带更新时间。
			 *   ② `localStorage["dsh.sessions.current"]` → {"sessionId":"session-xxx"} 当前会话
			 *   ③ 兜底：IDB `directorFolders`（keyPath folderId）/ `directorStores`（会话 store）
			 *
			 * ⚠️ ① 的 key 带版本号（v5），宿主升级后会变。故用**前缀模糊匹配**
			 *    `dsh.workspace.view`，而非写死 v5 —— 否则宿主一升级就全量失联。
			 *
			 * 🔴 稳定 id 约定（幂等的根基）
			 *    节点 id 必须由**数据源主键**派生，不能用随机 id：
			 *      workspace → `ws_<workspaceId>`（未分组为 `ws__ungrouped__`）
			 *      session   → `se_<sessionId>`
			 *    否则每次同步都会新建一套节点（重复膨胀），且无法判定「已覆盖」。
			 */
			
			const { idbListFolders } = __m("store/idb.js");
			
			/** 稳定 id 前缀 */
			const ID_PREFIX = { workspace: "ws_", session: "se_" };
			/** 未分组 workspace 的占位 id（数据源中 key 为空串） */
			const UNGROUPED_ID = "__ungrouped__";
			
			/** 通用短码（标题缺失时的兜底显示名） */
			function shortId(id, keep = 8) {
				const s = String(id || "");
				return s.length <= keep ? s : s.slice(0, keep);
			}
			
			/**
			 * 会话显示名（标题缺失时的兜底）
			 * 🔴 必须先剥离 `session-` 前缀再截断 —— 会话 id 形如
			 *    `session-4e8e9e49-0a8c-...`，直接取前 8 位得到的是常量前缀 `session-`，
			 *    导致**所有会话同名**（实测 8 个会话全部显示为「会话 session-」，无法区分）。
			 */
			function sessionLabel(sessionId, keep = 8) {
				return "会话 " + shortId(String(sessionId || "").replace(/^session-/, ""), keep);
			}
			
			function safeLS() {
				try {
					return typeof localStorage !== "undefined" ? localStorage : null;
				} catch (e) {
					return null; // 隐私模式 / 禁用存储
				}
			}
			
			/**
			 * 前缀模糊匹配 localStorage key（应对宿主版本升级，如 v5 → v6）
			 * @returns {string|null} 命中的 key
			 */
			function findWorkspaceViewKey() {
				const ls = safeLS();
				if (!ls) return null;
				let best = null;
				for (let i = 0; i < ls.length; i++) {
					const k = ls.key(i);
					if (k && k.indexOf("dsh.workspace.view") === 0) best = k; // 取最后一个（版本号最大）
				}
				return best;
			}
			
			/** 读取并解析 workspace 视图（宿主真实分组数据） */
			function readWorkspaceView() {
				const ls = safeLS();
				if (!ls) return null;
				const key = findWorkspaceViewKey();
				if (!key) return null;
				let raw = null;
				try { raw = ls.getItem(key); } catch (e) { return null; }
				if (!raw) return null;
				let obj = null;
				try { obj = JSON.parse(raw); } catch (e) { return null; }
				if (!obj || typeof obj !== "object") return null;
				return { key, data: obj };
			}
			
			/** 当前会话 id */
			function readCurrentSessionId() {
				const ls = safeLS();
				if (!ls) return null;
				try {
					const raw = ls.getItem("dsh.sessions.current");
					if (!raw) return null;
					const o = JSON.parse(raw);
					return (o && o.sessionId) || null;
				} catch (e) { return null; }
			}
			
			/** workspace 节点 id（稳定） */
			function workspaceNodeId(workspaceId) {
				return ID_PREFIX.workspace + (workspaceId || UNGROUPED_ID);
			}
			
			/** session 节点 id（稳定） */
			function sessionNodeId(sessionId) {
				return ID_PREFIX.session + sessionId;
			}
			
			/**
			 * 发现真实层级：workspaces（文件夹级） + sessions（对话级）
			 *
			 * @returns {Promise<{source:string, workspaces:Array, sessions:Array, currentSessionId:string|null}>}
			 *   workspaces: [{ id, nodeId, sessionIds: string[] }]
			 *   sessions  : [{ id, nodeId, workspaceId, updatedAt }]
			 *   source    : "localStorage" | "idb-folders" | "none"
			 */
			async function discover() {
				const view = readWorkspaceView();
				if (view && view.data.sessionOrderByAccount) {
					const order = view.data.sessionOrderByAccount || {};
					const times = view.data.sessionUpdatedAtByAccount || {};
					const workspaces = [];
					const sessions = [];
					for (const wsId of Object.keys(order)) {
						const ids = Array.isArray(order[wsId]) ? order[wsId] : [];
						const tmap = times[wsId] || {};
						workspaces.push({
							id: wsId || UNGROUPED_ID,
							rawId: wsId,
							nodeId: workspaceNodeId(wsId),
							name: wsId ? ("工作区 " + shortId(wsId)) : "未分组",
							sessionIds: ids.slice()
						});
						for (const sid of ids) {
							sessions.push({
								id: sid,
								nodeId: sessionNodeId(sid),
								workspaceId: wsId || UNGROUPED_ID,
								updatedAt: tmap[sid] || 0
							});
						}
					}
					return {
						source: "localStorage",
						workspaceViewKey: view.key,
						workspaces, sessions,
						currentSessionId: readCurrentSessionId()
					};
				}
			
				// ── 兜底：IDB directorFolders（文件夹级）+ directorStores（会话级）──
				const folders = await idbListFolders();
				if (folders && folders.length) {
					const workspaces = folders.map((f) => ({
						id: f.folderId,
						rawId: f.folderId,
						nodeId: workspaceNodeId(f.folderId),
						name: f.name || f.title || ("文件夹 " + shortId(f.folderId)),
						sessionIds: []
					}));
					return {
						source: "idb-folders",
						workspaces,
						sessions: [],
						currentSessionId: readCurrentSessionId()
					};
				}
			
				return { source: "none", workspaces: [], sessions: [], currentSessionId: readCurrentSessionId() };
			}
			
			/** 安装全局契约 */
			function installDiscoverApi() {
				if (typeof window === "undefined") return null;
				window.__dshDiscover = {
					ID_PREFIX, UNGROUPED_ID,
					shortId, sessionLabel, findWorkspaceViewKey, readWorkspaceView, readCurrentSessionId,
					workspaceNodeId, sessionNodeId, discover
				};
				return window.__dshDiscover;
			}
			
			exports.ID_PREFIX = ID_PREFIX;
			exports.UNGROUPED_ID = UNGROUPED_ID;
			exports.shortId = shortId;
			exports.sessionLabel = sessionLabel;
			exports.findWorkspaceViewKey = findWorkspaceViewKey;
			exports.readWorkspaceView = readWorkspaceView;
			exports.readCurrentSessionId = readCurrentSessionId;
			exports.workspaceNodeId = workspaceNodeId;
			exports.sessionNodeId = sessionNodeId;
			exports.discover = discover;
			exports.installDiscoverApi = installDiscoverApi;
		};

		// ── logic/sync.js ──
		__defs["logic/sync.js"] = function (exports) {
			/**
			 * logic/sync.js — 自动同步：让**每一个**对话 / 文件夹都拥有总监
			 *
			 * 需求（用户原话）：「每一个对话都有一个总监 · 每一个文件夹都有总监 · 最上层有总监负责」
			 *
			 * 设计要点
			 *   1. **稳定 id 幂等**：节点 id 由数据源主键派生（`ws_`/`se_` 前缀，见 discover.js），
			 *      故重复同步**只会更新、不会重复新建**。这是「每一个都有」能被验证的前提。
			 *   2. **全局总管单例**：`__global__`，永远存在，所有文件夹级挂其下。
			 *   3. **文件夹级 = workspace**（宿主 `groupBy:"workspace"`），**对话级 = session**。
			 *   4. **不覆盖用户改名**：同步写入时打 `meta.autoName = true`；用户改名后该标记被清除，
			 *      此后同步不再覆盖 `name`。
			 *   5. **孤儿软标记**：数据源中已消失（被删除）的会话不删除节点（避免误删用户沉淀的
			 *      总结/决策），只标 `meta.orphaned = true`，UI 可筛选。
			 *
			 * 全局契约：`window.__dshSync`
			 */
			
			const { LEVEL, GLOBAL_NODE_ID, makeNode, getNode, saveNode, ensureGlobal, listAllNodes } = __m("store/hierarchy.js");
			const { discover, workspaceNodeId, sessionNodeId, shortId, sessionLabel } = __m("logic/discover.js");
			const { idbLoad } = __m("store/idb.js");
			const { dshLog } = __m("util/debug.js");
			const { emitHierarchyChange } = __m("util/bus.js");
			
			/**
			 * 从真实数据源同步层级结构（幂等）
			 * @param {object} [opts]
			 * @param {boolean} [opts.includeOrphanScan=true] 是否扫描并软标记已消失的会话
			 * @returns {Promise<{source:string, created:number, updated:number, orphaned:number,
			 *                    folders:number, sessions:number, total:number, coverage:object}>}
			 */
			async function syncFromSource(opts = {}) {
				const disc = await discover();
				const stats = {
					source: disc.source, created: 0, updated: 0, orphaned: 0,
					folders: 0, sessions: 0, total: 0
				};
			
				// ── 1. 全局总管（单例，必须有）──
				const root = await ensureGlobal();
			
				if (!disc.workspaces.length && !disc.sessions.length) {
					dshLog("sync", "数据源为空（source=" + disc.source + "），仅确保全局总管存在");
					stats.total = 1;
					stats.coverage = await auditCoverage();
					emitHierarchyChange();
					return stats;
				}
			
				// ── 2. 文件夹级（workspace）→ 项目总监 ──
				const rootChildren = new Set(root.children || []);
				const folderNodeIds = [];
				disc.workspaces.forEach((ws, idx) => {
					const id = ws.nodeId || workspaceNodeId(ws.id);
					folderNodeIds.push(id);
					rootChildren.add(id);
					ws.__nodeId = id;
					ws.__order = idx;
				});
			
				for (const ws of disc.workspaces) {
					const id = ws.__nodeId;
					let node = await getNode(id);
					if (!node) {
						node = makeNode({
							id, name: ws.name, level: LEVEL.PROJECT, parentId: GLOBAL_NODE_ID,
							meta: { sourceId: ws.rawId ?? ws.id, source: "workspace", autoName: true, order: ws.__order }
						});
						stats.created++;
					} else {
						if (node.meta && node.meta.autoName !== false && node.name !== ws.name) node.name = ws.name;
						node.parentId = GLOBAL_NODE_ID;
						node.meta = { ...(node.meta || {}), sourceId: ws.rawId ?? ws.id, source: "workspace", order: ws.__order };
						stats.updated++;
					}
					await saveNode(node);
					stats.folders++;
				}
			
				// ── 3. 对话级（session）→ 会话总监 ──
				const folderChildMap = new Map(); // folderNodeId -> [sessionNodeId]
				const aliveSessionIds = new Set();
				for (const s of disc.sessions) {
					const parentId = workspaceNodeId(s.workspaceId);
					if (!folderChildMap.has(parentId)) folderChildMap.set(parentId, []);
					folderChildMap.get(parentId).push(s.nodeId || sessionNodeId(s.id));
					aliveSessionIds.add(s.id);
				}
			
				let sIdx = 0;
				for (const s of disc.sessions) {
					const id = s.nodeId || sessionNodeId(s.id);
					const parentId = workspaceNodeId(s.workspaceId);
					// 父级不存在（如数据源只有会话没有 workspace）→ 归到全局根，绝不丢弃
					const parentOk = folderNodeIds.indexOf(parentId) >= 0;
					const realParent = parentOk ? parentId : GLOBAL_NODE_ID;
					if (!parentOk) rootChildren.add(id);
			
					// 会话消息统计（宿主 directorStores 有则取，无则为 0；失败静默）
					let messageCount = 0;
					let lastMessage = "";
					try {
						const store = await idbLoad(s.id);
						if (store && Array.isArray(store.messages)) {
							messageCount = store.messages.length;
							const last = store.messages[store.messages.length - 1];
							if (last) lastMessage = String(last.content || last.text || "").slice(0, 200);
						}
					} catch (e) { /* 无该会话的本地 store，属正常 */ }
			
					let node = await getNode(id);
					if (!node) {
						node = makeNode({
							id,
							name: sessionLabel(s.id),
							level: LEVEL.SESSION,
							parentId: realParent,
							meta: { sourceId: s.id, source: "session", autoName: true, order: sIdx }
						});
						stats.created++;
					} else {
						if (node.meta && node.meta.autoName !== false) node.name = sessionLabel(s.id);
						node.parentId = realParent;
						node.meta = { ...(node.meta || {}), sourceId: s.id, source: "session", order: sIdx };
						stats.updated++;
					}
					node.conversations = [{
						conversationId: s.id,
						title: node.name,
						lastMessage,
						lastTime: s.updatedAt || 0,
						messageCount
					}];
					node.meta.orphaned = false;
					await saveNode(node);
					stats.sessions++;
					sIdx++;
				}
			
				// ── 4. 维护父子关系（幂等：用 Set 去重，不会重复 push）──
				root.children = Array.from(rootChildren);
				await saveNode(root);
				for (const [fid, kids] of folderChildMap.entries()) {
					const f = await getNode(fid);
					if (!f) continue;
					f.children = Array.from(new Set([...(f.children || []), ...kids]));
					await saveNode(f);
				}
			
				// ── 5. 孤儿软标记（数据源中已消失的自动同步会话）──
				if (opts.includeOrphanScan !== false) {
					const all = await listAllNodes();
					for (const n of all) {
						if (n.level !== LEVEL.SESSION) continue;
						const sid = n.meta && n.meta.sourceId;
						if (!sid) continue;                 // 手工创建的节点不参与
						if (aliveSessionIds.has(sid)) continue;
						if (n.meta && n.meta.orphaned) continue;
						n.meta = { ...n.meta, orphaned: true };
						await saveNode(n);
						stats.orphaned++;
					}
				}
			
				stats.total = stats.folders + stats.sessions + 1;
				stats.coverage = await auditCoverage();
				// 🔴 必须广播：面板首帧早于同步完成，若不通知则一直显示陈旧快照（实测 0/8）
				emitHierarchyChange();
				dshLog("sync", "同步完成: 新建 " + stats.created + " / 更新 " + stats.updated
					+ " / 孤儿 " + stats.orphaned + " / 覆盖度 " + JSON.stringify(stats.coverage.rate));
				return stats;
			}
			
			/**
			 * 覆盖度自检 —— 直接回答「是否每一个对话 / 文件夹都有总监」
			 *
			 * @returns {Promise<{sessions:object, folders:object, global:object, rate:string, ok:boolean}>}
			 */
			async function auditCoverage() {
				const disc = await discover();
				const all = await listAllNodes();
				const byId = new Map(all.map((n) => [n.id, n]));
			
				const sessionTotal = disc.sessions.length;
				const sessionCovered = disc.sessions.filter((s) => byId.has(s.nodeId || sessionNodeId(s.id))).length;
				const sessionMissing = disc.sessions
					.filter((s) => !byId.has(s.nodeId || sessionNodeId(s.id)))
					.map((s) => s.id);
			
				const folderTotal = disc.workspaces.length;
				const folderCovered = disc.workspaces.filter((w) => byId.has(w.nodeId || workspaceNodeId(w.id))).length;
				const folderMissing = disc.workspaces
					.filter((w) => !byId.has(w.nodeId || workspaceNodeId(w.id)))
					.map((w) => w.id);
			
				const globalOk = byId.has(GLOBAL_NODE_ID);
				const pct = (a, b) => (b === 0 ? "n/a" : Math.round((a / b) * 100) + "%");
			
				return {
					source: disc.source,
					sessions: { total: sessionTotal, covered: sessionCovered, missing: sessionMissing, rate: pct(sessionCovered, sessionTotal) },
					folders: { total: folderTotal, covered: folderCovered, missing: folderMissing, rate: pct(folderCovered, folderTotal) },
					global: { total: 1, covered: globalOk ? 1 : 0, rate: globalOk ? "100%" : "0%" },
					rate: "会话 " + pct(sessionCovered, sessionTotal) + " / 文件夹 " + pct(folderCovered, folderTotal) + " / 全局 " + (globalOk ? "100%" : "0%"),
					ok: globalOk && sessionCovered === sessionTotal && folderCovered === folderTotal
				};
			}
			
			/** 安装全局契约 */
			function installSyncApi() {
				if (typeof window === "undefined") return null;
				window.__dshSync = { syncFromSource, auditCoverage };
				return window.__dshSync;
			}
			
			exports.syncFromSource = syncFromSource;
			exports.auditCoverage = auditCoverage;
			exports.installSyncApi = installSyncApi;
		};

		// ── components/DirectorHierarchy.js ──
		__defs["components/DirectorHierarchy.js"] = function (exports) {
			/**
			 * components/DirectorHierarchy.js — 多层级总监面板（方案 C：层级树 + 主内容区）
			 *
			 * 需求来源：`docs/04-多层级总监结构设计与方案选型.md` §三（结构说明）
			 *   左栏：三级树（全局 → 文件夹 → 会话）
			 *   右栏：当前节点 meta + 总结 + 子级摘要 + 操作区
			 *
			 * 依赖层级数据：store/hierarchy.js（03号文 §1.3 / 17号文 §2.1）
			 * 依赖总结逻辑：logic/summarize.js（17号文 §1A.13 / 03号文 §4.3 降级）
			 *
			 * ⚠️ 构建约束（同 DirectorFlow）：
			 *   - `react` / `react/jsx-runtime` 为**平台冻结模块**，构建期外置为 `require(...)`
			 *     （ADR-001：严禁把 React 打进产物，否则双实例崩溃）
			 *   - 宿主为编译后 `jsx()` 调用形态，本文件用 **`.js` 而非 `.jsx`**，不经 JSX 编译
			 */
			
			const react = require("react");
			const react_jsx_runtime = require("react/jsx-runtime");
			const { LEVEL, LEVEL_LABEL, GLOBAL_NODE_ID, loadTree, getNode, saveNode, removeNode, createChild, attachSession, getBreadcrumb } = __m("store/hierarchy.js");
			const { summarizeNode, summarizeTree, propagateUp, GRADE } = __m("logic/summarize.js");
			const { syncFromSource, auditCoverage } = __m("logic/sync.js");
			const { onHierarchyChange } = __m("util/bus.js");
			const { dshLog } = __m("util/debug.js");
			
			/* ── 样式（内联，与宿主编译产物同形态；尽量使用 Harness 主题变量并给 fallback）── */
			const S = {
				root: { display: "flex", height: "100%", minHeight: 0, background: "var(--dsw-alias-bg-base, #16171a)", color: "var(--dsw-alias-label-primary, #e6e6e6)", fontSize: 13, fontFamily: "inherit" },
				side: { width: 240, flex: "0 0 240px", borderRight: "1px solid var(--dsw-alias-border-l2, #2a2c30)", overflowY: "auto", minHeight: 0, padding: "8px 0" },
				main: { flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: 16 },
				row: (active) => ({
					display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", cursor: "pointer",
					background: active ? "var(--dsw-alias-interactive-bg-hover, #23252a)" : "transparent",
					borderLeft: active ? "2px solid #4c8dff" : "2px solid transparent",
					whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
				}),
				badge: { marginLeft: "auto", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #8b8f96)", background: "var(--dsw-alias-bg-sunken, #1e2024)", borderRadius: 8, padding: "0 6px" },
				btn: { padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #33363b)", background: "var(--dsw-alias-bg-base, #202227)", color: "var(--dsw-alias-label-primary, #e6e6e6)", cursor: "pointer" },
				btnPrimary: { padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #2f6bdd", background: "#2f6bdd", color: "#fff", cursor: "pointer" },
				input: { width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #33363b)", background: "var(--dsw-alias-bg-sunken, #1b1d21)", color: "var(--dsw-alias-label-primary, #e6e6e6)", boxSizing: "border-box" },
				card: { border: "1px solid var(--dsw-alias-border-l2, #2a2c30)", borderRadius: 8, padding: 12, marginBottom: 12, background: "var(--dsw-alias-bg-sunken, #1a1c20)" },
				label: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #a0a4aa)", marginBottom: 4 },
				pre: { whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 12, lineHeight: "18px", fontFamily: "var(--ds-font-family-code, ui-monospace, Menlo, Consolas, monospace)" },
				h: { fontSize: 14, fontWeight: 600, margin: "0 0 10px" },
				muted: { color: "var(--dsw-alias-label-tertiary, #8b8f96)", fontSize: 12 }
			};
			
			const ICON = { global: "🌐", project: "📁", session: "💬" };
			
			/* ── 递归树节点 ── */
			function TreeItem({ node, depth, selectedId, onSelect }) {
				const kids = node.childNodes || [];
				return (0, react_jsx_runtime.jsxs)("div", { children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: S.row(selectedId === node.id),
						onClick: () => onSelect(node.id),
						title: node.name,
						children: [
							(0, react_jsx_runtime.jsx)("span", { style: { paddingLeft: depth * 12 }, children: (ICON[node.level] || "•") + " " + node.name }),
							kids.length ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: String(kids.length) }) : null
						]
					}),
					kids.map((c) => (0, react_jsx_runtime.jsx)(TreeItem, { node: c, depth: depth + 1, selectedId: selectedId, onSelect: onSelect }, c.id))
				] });
			}
			
			/** 在树中按 id 查找节点 */
			function findNode(root, id) {
				if (!root) return null;
				if (root.id === id) return root;
				for (const c of root.childNodes || []) {
					const hit = findNode(c, id);
					if (hit) return hit;
				}
				return null;
			}
			
			/**
			 * 多层级总监面板根组件
			 * @param {object} props
			 * @param {() => void} [props.onClose] 关闭回调（浮层形态用）
			 */
			function DirectorHierarchy(props = {}) {
				const [tree, setTree] = react.useState(null);
				const [selectedId, setSelectedId] = react.useState(GLOBAL_NODE_ID);
				const [crumb, setCrumb] = react.useState([]);
				const [busy, setBusy] = react.useState(false);
				const [msg, setMsg] = react.useState("");
				// 新建表单
				const [newName, setNewName] = react.useState("");
				const [newLevel, setNewLevel] = react.useState(LEVEL.PROJECT);
				const [sessTitle, setSessTitle] = react.useState("");
				const [sessId, setSessId] = react.useState("");
				// meta 编辑
				const [meta, setMeta] = react.useState({ positioning: "", goal: "", currentPhase: "" });
				const [nodeName, setNodeName] = react.useState("");
				// 覆盖度：是否每一个对话 / 文件夹都已配总监
				const [coverage, setCoverage] = react.useState(null);
			
				const refresh = react.useCallback(async () => {
					const t = await loadTree();
					setTree(t);
					// 覆盖度自检与树同步刷新（直接回答「每一个对话/文件夹是否都有总监」）
					try { setCoverage(await auditCoverage()); } catch (e) { /* 静默 */ }
					return t;
				}, []);
			
				react.useEffect(() => { refresh(); }, [refresh]);
			
				// 🔴 订阅层级变更：面板首帧早于自动同步完成（实测显示「会话 0/8」），
				//    必须在同步/总结/CRUD 完成后收到通知并重新拉取，否则停留在陈旧快照。
				react.useEffect(() => onHierarchyChange(() => { refresh(); }), [refresh]);
			
				const selected = react.useMemo(() => findNode(tree, selectedId), [tree, selectedId]);
			
				react.useEffect(() => {
					getBreadcrumb(selectedId).then(setCrumb);
					const n = findNode(tree, selectedId);
					setMeta({
						positioning: n?.meta?.positioning || "",
						goal: n?.meta?.goal || "",
						currentPhase: n?.meta?.currentPhase || ""
					});
					setNodeName(n?.name || "");
				}, [selectedId, tree]);
			
				const guard = (fn) => async (...a) => {
					if (busy) return;
					setBusy(true);
					try { await fn(...a); } finally { setBusy(false); }
				};
			
				const doCreate = guard(async () => {
					const name = newName.trim();
					if (!name) { setMsg("请输入名称"); return; }
					// 全局级下只能建项目级；项目级下建会话或子项目
					const parentId = selectedId || GLOBAL_NODE_ID;
					const node = await createChild(parentId, { name, level: newLevel });
					setNewName("");
					await refresh();
					setSelectedId(node.id);
					setMsg("已创建：" + name);
				});
			
				const doAttach = guard(async () => {
					const sid = sessId.trim();
					if (!sid) { setMsg("请输入会话 ID"); return; }
					const node = await attachSession(selectedId, { sessionId: sid, title: sessTitle.trim() || sid });
					setSessId(""); setSessTitle("");
					await refresh();
					setSelectedId(node.id);
					setMsg("已挂载会话：" + sid);
				});
			
				const doSummarizeOne = guard(async () => {
					const node = await getNode(selectedId);
					if (!node) return;
					const res = await summarizeNode(node, selected?.childNodes || []);
					const { childNodes, ...flat } = { ...node, summary: res.text, summaryGrade: res.grade, summaryAt: res.at };
					await saveNode(flat);
					await refresh();
					setMsg("已生成总结（梯度 " + res.grade + "）" + (res.degraded ? " · " + (res.reason || "已降级") : ""));
				});
			
				const doSummarizeTree = guard(async () => {
					const stats = await summarizeTree(await refresh(), {});
					setMsg("整树总结完成：" + stats.count + " 个节点，G0=" + stats.grades.G0 + " / G1=" + stats.grades.G1 + " / G2=" + stats.grades.G2 + "，降级 " + stats.degraded + " 个");
				});
			
				const doPropagate = guard(async () => {
					const r = await propagateUp(selectedId);
					if (!r) { setMsg("该节点无父级，无需向上提交"); return; }
					await refresh();
					setMsg("已向上提交到「" + r.node.name + "」（梯度 " + r.result.grade + "）");
				});
			
				/**
				 * 同步真实会话 / 文件夹 → 为每一个会话和文件夹建立总监（幂等）
				 * 数据源：宿主 localStorage `dsh.workspace.view.*`（workspace=文件夹级，session=对话级）
				 */
				const doSync = guard(async () => {
					const s = await syncFromSource();
					await refresh();
					setMsg("同步完成（数据源：" + s.source + "）：新建 " + s.created + " / 更新 " + s.updated
						+ " / 孤儿 " + s.orphaned + "；文件夹 " + s.folders + " · 会话 " + s.sessions);
				});
			
				const doSaveMeta = guard(async () => {
					const node = await getNode(selectedId);
					if (!node) return;
					node.meta = { ...(node.meta || {}), ...meta };
					// 用户主动改名 → 清 autoName，此后自动同步不再覆盖该名称
					if (nodeName.trim() && nodeName !== node.name) {
						node.name = nodeName.trim();
						node.meta.autoName = false;
					}
					await saveNode(node);
					await refresh();
					setMsg("已保存基础信息");
				});
			
				const doRemove = guard(async () => {
					if (selectedId === GLOBAL_NODE_ID) { setMsg("全局根节点不可删除"); return; }
					await removeNode(selectedId);
					await refresh();
					setSelectedId(GLOBAL_NODE_ID);
					setMsg("已删除节点");
				});
			
				return (0, react_jsx_runtime.jsxs)("div", { style: S.root, children: [
					/* ── 左：层级树 ── */
					(0, react_jsx_runtime.jsxs)("div", { style: S.side, children: [
						(0, react_jsx_runtime.jsx)("div", { style: { padding: "4px 12px 8px", ...S.muted }, children: "总监层级" }),
						tree
							? (0, react_jsx_runtime.jsx)(TreeItem, { node: tree, depth: 0, selectedId: selectedId, onSelect: setSelectedId })
							: (0, react_jsx_runtime.jsx)("div", { style: { padding: 12, ...S.muted }, children: "加载中…" })
					] }),
			
					/* ── 右：内容区 ── */
					(0, react_jsx_runtime.jsxs)("div", { style: S.main, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }, children: [
							(0, react_jsx_runtime.jsx)("h3", { style: S.h, children: crumb.map((c) => c.name).join(" / ") || "全局总管" }),
							selected ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: LEVEL_LABEL[selected.level] || selected.level }) : null,
							selected?.summaryGrade ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: "梯度 " + selected.summaryGrade }) : null,
							props.onClose ? (0, react_jsx_runtime.jsx)("button", { style: { ...S.btn, marginLeft: "auto" }, onClick: props.onClose, children: "收起" }) : null
						] }),
			
						/* 覆盖度自检：是否每一个对话 / 文件夹都有总监 */
						(0, react_jsx_runtime.jsxs)("div", {
							style: {
								...S.card,
								borderColor: coverage && coverage.ok ? "#2f6bdd" : "#6b5320",
								background: coverage && coverage.ok ? "rgba(47,107,221,.10)" : "rgba(160,120,30,.10)"
							},
							children: [
								(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }, children: [
									(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 13, fontWeight: 600 }, children: coverage && coverage.ok ? "✅ 总监已全覆盖" : "⚠️ 存在未覆盖" }),
									(0, react_jsx_runtime.jsxs)("span", { style: { ...S.muted, marginLeft: "auto" }, children: [
										"会话 ", coverage ? coverage.sessions.covered + "/" + coverage.sessions.total : "-",
										" · 文件夹 ", coverage ? coverage.folders.covered + "/" + coverage.folders.total : "-",
										" · 全局 ", coverage ? coverage.global.covered + "/1" : "-"
									] }),
									(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, onClick: doSync, disabled: busy, children: "同步真实会话" })
								] }),
								(0, react_jsx_runtime.jsx)("div", { style: S.muted, children: "数据源：" + (coverage ? coverage.source : "检测中…")
									+ "（workspace=文件夹级，session=对话级）。节点 id 由数据源主键派生，重复同步幂等、不会重复新建。" })
							]
						}),
			
						/* 基础信息（meta） */
						(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
							(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "定位 / 目标 / 当前阶段（17号文 §1A.13 核心认知）" }),
							(0, react_jsx_runtime.jsx)("input", {
								style: { ...S.input, marginBottom: 6 },
								placeholder: "节点名称（修改后自动同步不再覆盖）",
								value: nodeName,
								onChange: (e) => setNodeName(e.target.value)
							}),
							["positioning", "goal", "currentPhase"].map((k) => (0, react_jsx_runtime.jsx)("input", {
								key: k,
								style: { ...S.input, marginBottom: 6 },
								placeholder: { positioning: "定位", goal: "目标", currentPhase: "当前阶段" }[k],
								value: meta[k],
								onChange: (e) => setMeta((m) => ({ ...m, [k]: e.target.value }))
							}, k)),
							(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doSaveMeta, disabled: busy, children: "保存基础信息" })
						] }),
			
						/* 总结区 */
						(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", marginBottom: 8 }, children: [
								(0, react_jsx_runtime.jsx)("span", { style: S.label, children: "分层总结" }),
								(0, react_jsx_runtime.jsxs)("span", { style: { marginLeft: "auto", display: "flex", gap: 6 }, children: [
									(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, onClick: doSummarizeOne, disabled: busy, children: "生成本级总结" }),
									(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doPropagate, disabled: busy, children: "向上提交" }),
									(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doSummarizeTree, disabled: busy, children: "整树分层总结" })
								] })
							] }),
							selected?.summary
								? (0, react_jsx_runtime.jsx)("pre", { style: S.pre, children: selected.summary })
								: (0, react_jsx_runtime.jsx)("div", { style: S.muted, children: "暂无总结。点击「生成本级总结」或「整树分层总结」。" })
						] }),
			
						/* 子级摘要 */
						selected?.childNodes?.length ? (0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
							(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "子级摘要（共 " + selected.childNodes.length + " 项）" }),
							selected.childNodes.map((c) => (0, react_jsx_runtime.jsxs)("div", { key: c.id, style: { marginBottom: 8 }, children: [
								(0, react_jsx_runtime.jsxs)("div", { style: { fontSize: 12, fontWeight: 500 }, children: [
									ICON[c.level] + " " + c.name,
									c.summaryGrade ? "（" + c.summaryGrade + "）" : ""
								] }),
								(0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, whiteSpace: "pre-wrap" }, children: c.summary ? String(c.summary).slice(0, 200) : "（未总结）" })
							] }))
						] }) : null,
			
						/* 新建节点 */
						(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
							(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "在当前节点下新建" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6, marginBottom: 6 }, children: [
								(0, react_jsx_runtime.jsx)("input", { style: S.input, placeholder: "名称", value: newName, onChange: (e) => setNewName(e.target.value) }),
								(0, react_jsx_runtime.jsxs)("select", { style: S.btn, value: newLevel, onChange: (e) => setNewLevel(e.target.value), children: [
									(0, react_jsx_runtime.jsx)("option", { value: LEVEL.PROJECT, children: "项目（文件夹级）" }),
									(0, react_jsx_runtime.jsx)("option", { value: LEVEL.SESSION, children: "会话（对话级）" })
								] }),
								(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doCreate, disabled: busy, children: "新建" })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
								(0, react_jsx_runtime.jsx)("input", { style: S.input, placeholder: "会话 ID", value: sessId, onChange: (e) => setSessId(e.target.value) }),
								(0, react_jsx_runtime.jsx)("input", { style: S.input, placeholder: "会话标题（可选）", value: sessTitle, onChange: (e) => setSessTitle(e.target.value) }),
								(0, react_jsx_runtime.jsx)("button", { style: S.btn, onClick: doAttach, disabled: busy, children: "挂载会话" })
							] })
						] }),
			
						/* 提示 + 删除 */
						msg ? (0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, marginBottom: 8 }, children: msg }) : null,
						selectedId !== GLOBAL_NODE_ID
							? (0, react_jsx_runtime.jsx)("button", { style: { ...S.btn, borderColor: "#7a2b2b", color: "#ff8a8a" }, onClick: doRemove, disabled: busy, children: "删除当前节点" })
							: null
					] })
				] });
			}
			
			__defaults["components/DirectorHierarchy.js"] = DirectorHierarchy;
			
			exports.DirectorHierarchy = DirectorHierarchy;
		};

		// ── mount.js ──
		__defs["mount.js"] = function (exports) {
			/**
			 * mount.js — 多层级总监面板的挂载层（方案 C：slot 优先 / DOM 兜底）
			 *
			 * 设计依据：`docs/04-多层级总监结构设计与方案选型.md` §二 选定方案 C
			 *   - **slot 优先**：若宿主暴露了 slots 服务（window.__DSH_SLOTS__），则注册到
			 *     `conversation.view`（03号文 §2.1「[总监][对话][轨迹] 三 tab 同属 conversation.view」），
			 *     与原生 UI 完全一致。
			 *   - **DOM 兜底**（默认路径）：自行 createRoot 渲染浮层面板。
			 *     🔴 为什么兜底是默认：宿主 `conversation.view` 的 slots 实例由 app-shell 通过
			 *     `ctx.slots.install` 注入，**插件侧能否拿到同一实例未经实测**；而本插件当前
			 *     正是因「宿主已退坡 + 插件未注册入口」导致功能不可达（见 memory 2026-09-11 ⑫）。
			 *     兜底通道**零宿主依赖、必定可见**，故作为默认与保底。
			 *
			 * ⚠️ 构建约束：`react-dom/client` 同为平台冻结模块（ADR-001），构建期外置为 `require(...)`。
			 */
			
			const react = require("react");
			const react_jsx_runtime = require("react/jsx-runtime");
			const react_dom_client = require("react-dom/client");
			const { DirectorHierarchy } = __m("components/DirectorHierarchy.js");
			const { dshLog } = __m("util/debug.js");
			const { emitHierarchyChange } = __m("util/bus.js");
			
			const OVERLAY_HOST_ID = "dsh-director-hierarchy-overlay";
			const LAUNCHER_ID = "dsh-director-hierarchy-launcher";
			
			/** 面板尺寸（浮层形态） */
			const PANEL = { width: 880, height: 560, right: 24, bottom: 64 };
			
			function makeLauncher(onToggle) {
				const btn = document.createElement("button");
				btn.id = LAUNCHER_ID;
				btn.textContent = "总监层级";
				Object.assign(btn.style, {
					position: "fixed", right: "24px", bottom: "24px", zIndex: 2147483000,
					padding: "8px 14px", fontSize: "13px", borderRadius: "999px",
					border: "1px solid #2f6bdd", background: "#2f6bdd", color: "#fff",
					cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.35)"
				});
				btn.addEventListener("click", onToggle);
				document.body.appendChild(btn);
				return btn;
			}
			
			/**
			 * 挂载多层级总监面板（浮层兜底通道）
			 * @param {object} [opts]
			 * @param {boolean} [opts.withLauncher=true] 是否创建右下角入口按钮
			 * @param {boolean} [opts.open=false] 初始是否展开
			 * @returns {{overlay: HTMLElement, launcher: HTMLElement|null, root: object, unmount: () => void, show: () => void, hide: () => void}|null}
			 */
			function mountHierarchyOverlay(opts = {}) {
				if (typeof window === "undefined" || typeof document === "undefined") return null;
				if (document.getElementById(OVERLAY_HOST_ID)) return null; // 幂等
			
				const overlay = document.createElement("div");
				overlay.id = OVERLAY_HOST_ID;
				Object.assign(overlay.style, {
					position: "fixed", zIndex: 2147483001,
					right: PANEL.right + "px", bottom: PANEL.bottom + "px",
					width: PANEL.width + "px", height: PANEL.height + "px",
					border: "1px solid #2a2c30", borderRadius: "12px", overflow: "hidden",
					background: "#16171a", boxShadow: "0 12px 40px rgba(0,0,0,.5)",
					display: opts.open ? "block" : "none"
				});
				document.body.appendChild(overlay);
			
				const root = react_dom_client.createRoot(overlay);
				const render = (open) => root.render(
					(0, react_jsx_runtime.jsx)(DirectorHierarchy, { onClose: () => { hide(); } })
				);
				const show = () => { overlay.style.display = "block"; render(true); emitHierarchyChange(); };
				const hide = () => { overlay.style.display = "none"; };
				render(opts.open);
			
				const launcher = opts.withLauncher === false ? null : makeLauncher(() => {
					if (overlay.style.display === "none") show(); else hide();
				});
			
				dshLog("hierarchy", "浮层面板已挂载（DOM 兜底通道）");
				return {
					overlay, launcher, root,
					show, hide,
					unmount: () => {
						try { root.unmount(); } catch { /* 已卸载 */ }
						overlay.remove();
						if (launcher) launcher.remove();
					}
				};
			}
			
			/**
			 * 尝试注册到宿主 slot（可选增强，失败静默）
			 * 仅当宿主在 window 上暴露 slots 服务时生效；否则返回 false。
			 * @returns {boolean} 是否注册成功
			 */
			function tryRegisterHostSlot() {
				try {
					const slots = typeof window !== "undefined" ? window.__DSH_SLOTS__ : null;
					if (!slots || typeof slots.register !== "function") return false;
					slots.register({
						name: "conversation.view",
						id: "director",
						order: -1,
						title: "总监"
					}, DirectorHierarchy);
					dshLog("hierarchy", "已注册到宿主 conversation.view slot（id=director）");
					return true;
				} catch (e) {
					dshLog("hierarchy", "宿主 slot 注册失败，改用浮层兜底: " + (e && e.message));
					return false;
				}
			}
			
			/**
			 * 统一入口：先尝试宿主 slot，无论成功与否都确保浮层兜底可用。
			 * @param {object} [opts] 同 mountHierarchyOverlay
			 */
			function mountHierarchy(opts = {}) {
				const slotOk = tryRegisterHostSlot();
				const overlay = mountHierarchyOverlay(opts);
				if (typeof window !== "undefined") {
					window.__dshHierarchyMount = { slotRegistered: slotOk, overlay: Boolean(overlay), ...(overlay || {}) };
				}
				return { slotRegistered: slotOk, overlay };
			}
			
			__defaults["mount.js"] = mountHierarchy;
			
			exports.OVERLAY_HOST_ID = OVERLAY_HOST_ID;
			exports.LAUNCHER_ID = LAUNCHER_ID;
			exports.mountHierarchyOverlay = mountHierarchyOverlay;
			exports.tryRegisterHostSlot = tryRegisterHostSlot;
			exports.mountHierarchy = mountHierarchy;
		};

		// ── client-entry.js ──
		__defs["client-entry.js"] = function (exports) {
			/**
			 * client-entry.js — 插件浏览器侧入口（批次 1 已落地）
			 *
			 * 迁移来源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
			 *   基准：11,998 行 / 1,479,577 B / mtime 2026-09-08 13:14:11
			 *   施工图：dsh-director-plugin/docs/01-插件迁移明细清单.md（v2）
			 *
			 * ── 当前进度（批次 1 · 零依赖，已迁入）──────────────────────
			 *   ✅ A11 布局 store        → store/layout.js           （client.js 6439~6483）
			 *   ✅ A12 主题 store        → store/theme.js            （client.js 6484~6537）
			 *   ✅ A3  专用 Log 收集器    → util/log-collector.js      （client.js 5799~5834）
			 *   ✅ D3  统一调试日志工具    → util/debug.js             （client.js 6854~6968）
			 *   ✅ C2  配置与本地模型      → config/model.js           （client.js 6615~6705）
			 *   ✅ C1  V9-Design 布局探针  → dev/layout-probe.js       （client.js 6545~6614）
			 *   ✅ A13+A14 文档索引注入壳  → store/docs-index-inject.js（client.js 6538~6544 + 剥离改造）
			 *
			 * ── 批次 2 数据层（已迁入）──────────────────────────────────
			 *   ✅ A1  消息 store（内存层） → store/messages.js         （client.js 5495~5723）
			 *   ✅ A2  记忆 CRUD           → store/memory.js           （client.js 5724~5798）
			 *   ✅ A4  分支创建+记忆面板    → store/branch.js           （client.js 5835~5963）
			 *   ✅ A5  总监文档 store       → store/docs.js             （client.js 5966~6035）
			 *   ✅ V10 Cookie 分块存储      → store/cookie.js           （存储降级兜底层）
			 *   ✅ IndexedDB 持久化主层     → store/idb.js              （6 store / v3）
			 *
			 * ── 批次 3 持久化层（已迁入）──────────────────────────────────
			 *   ✅ A6  文件通道适配器      → store/file-adapter.js      （client.js 6036~6214，按 T5 实测重建）
			 *   ✅ A7  loadDirectorStore   → store/persist.js           （client.js 6215~6273）
			 *   ✅ A8  saveDirectorStore   → store/persist.js           （client.js 6274~6326）
			 *   ✅ A9  createDirectorStore → store/create-store.js      （client.js 6327~6403 + 6408~6437）
			 *   ✅ A10 useDirectorStore    → store/use-store.js         （client.js 6404~6407，**首个平台模块消费者**）
			 *
			 * ── 批次 4 逻辑层（已迁入）─────────────────────────────────────
			 *   ✅ D1 directorProcess      → logic/process.js            （client.js 6706~6818）
			 *   ✅ D2 directorReviewReturn → logic/review.js             （client.js 6820~6855，**保留不调用**）
			 *
			 * ── 批次 5 组件层（已迁入）─────────────────────────────────────
			 *   ✅ E1 DirectorFlow         → components/DirectorFlow.js      （client.js 6972~7085）
			 *      🔴 含一处**迁移期修正**：宿主 `filteredMessages` 属跨作用域越界引用（自诞生即坏，
			 *         P2 清理删除 DirectorView 后沦为完全未定义）→ 改用 `state.messages`。论证见该文件头。
			 *
			 * ── 待迁入（批次 6）─────────────────────────────────────────
			 *   ⬜ F3+F4 全局 API  ⬜ F1/F2 + G1/G4 宿主注入点改造  ⬜ F5 插件侧 tab 注册
			 *   ⛔ E2 DirectorView — 已废弃（2026-09-08 P2 清理，墓志铭 client.js:8897）
			 *
			 * ⚠️ 关键约束
			 *   - 平台模块（react / cordis / web-react 等）**必须 external**，严禁打进产物（ADR-001）；
			 *     构建期由 build/build.mjs 改写为 `require("<spec>")`，构建日志会列出「平台外置」清单
			 *   - 加载顺序：debug → log-collector（后者依赖前者）→ layout / theme / config → docs-index
			 *     → memory → branch → persist（依赖 debug）→ store 工厂
			 */
			
			const { installDshDebug } = __m("util/debug.js");
			const { installV9Log } = __m("util/log-collector.js");
			const { directorLayoutStore } = __m("store/layout.js");
			const { dshThemeStore } = __m("store/theme.js");
			const { directorConfig } = __m("config/model.js");
			const { loadDocsIndex, getDocsIndexSync } = __m("store/docs-index-inject.js");
			const { installLayoutProbe } = __m("dev/layout-probe.js");
			// ── 批次 2 数据层 ──
			const { directorStores } = __m("store/messages.js");
			const { installMemoryApi } = __m("store/memory.js");
			const { installBranchApi } = __m("store/branch.js");
			const { directorDocsStore } = __m("store/docs.js");
			// ── 批次 3 持久化层 ──
			const { installPersistState, probeLegacyRequire, preloadStoreFile, bridgeDebugLogToFile, isFileChannelAvailable, isOpfsAvailable, isFsaAvailable, exportViaFsa, importViaFsa } = __m("store/file-adapter.js");
			const { directorStoreFactory, installBeforeUnloadSave, createDirectorStore, isBeforeUnloadRegistered } = __m("store/create-store.js");
			const { useDirectorStore } = __m("store/use-store.js");
			const { safeDirectorKey, loadDirectorStore, saveDirectorStore, DIRECTOR_DEFAULT_CONFIG } = __m("store/persist.js");
			// ── 批次 4 逻辑层 ──
			const { directorProcess } = __m("logic/process.js");
			const { directorReviewReturn } = __m("logic/review.js");
			// ── 批次 5 组件层 ──
			const { DirectorFlow } = __m("components/DirectorFlow.js");
			// ── 批次 6 多层级总监结构（对话级 / 文件夹级 / 全局级）──
			const { installHierarchyApi, loadTree, ensureGlobal, LEVEL, GLOBAL_NODE_ID } = __m("store/hierarchy.js");
			const { installSummarizeApi, summarizeTree } = __m("logic/summarize.js");
			const { mountHierarchy } = __m("mount.js");
			const { DirectorHierarchy } = __m("components/DirectorHierarchy.js");
			// ── 批次 7 自动同步：让每一个对话 / 文件夹都拥有总监 ──
			const { installDiscoverApi } = __m("logic/discover.js");
			const { installSyncApi, syncFromSource, auditCoverage } = __m("logic/sync.js");
			
			const PLUGIN_VERSION = "0.7.0-batch7";
			
			/** 批次 1 安装器：装配零依赖基础层 + 数据层 + 持久化层。返回已安装的能力清单 */
			function installBatch1(options = {}) {
				// 1. 日志基础设施（顺序敏感：debug 先于 log-collector）
				installDshDebug();
				installV9Log();
			
				// 2. 状态层（构造时即自挂 window，见各模块）
				//    directorLayoutStore → window.__directorLayoutStore
				//    dshThemeStore       → window.__dshTheme
				//    directorConfig      → window.__directorConfig
			
				// 3. 文档索引（异步，失败静默降级为"索引未注入"，与剥离前行为一致）
				const docsIndexPromise = loadDocsIndex(options.docsIndexBaseUrl);
			
				// 4. 布局探针（dev-only，默认开启；生产可传 { layoutProbe: false } 关闭）
				let probeInstalled = false;
				if (options.layoutProbe !== false) {
					probeInstalled = Boolean(installLayoutProbe(getDocsIndexSync));
				}
			
				// 5. 批次 2 数据层：全局契约安装（顺序敏感）
				//    ⚠️ memory 必须先于 branch —— branch 的 switchMemoryTab 依赖 idb 记忆读取，
				//       但更关键的是 __dshMemory 契约需先就位（宿主 F4 在 client.js:11787 直接调用）
				const memoryApi = installMemoryApi();
				const branchApi = installBranchApi();
			
				// 6. 批次 3 持久化层（顺序敏感）
				//    ⚠️ installPersistState 必须先于任何 plog（persist.js 会读它做统计）
				//    ⚠️ bridgeDebugLogToFile 必须在 installDshDebug 之后（依赖 window.__dshDebug）
				const persistState = installPersistState();
				const legacyProbe = probeLegacyRequire();
				const fileLogBridged = bridgeDebugLogToFile();
				const beforeUnload = installBeforeUnloadSave();
				// OPFS 预读：异步。loadDirectorStore 是同步函数，故靠「预读一次 + 同步读缓存」保持签名。
				const preloadPromise = preloadStoreFile();
			
				// 7. 批次 4 逻辑层（D1 核心处理 + D2 返回审核）
				//    ⚠️ D2 属「**保留不调用**」能力（三重证据见 logic/review.js 文件头）——
				//       此处**只挂全局契约、不自动调用**，确保不引入行为变更；
				//       未来启用时由接线层（批次 6 或后续）显式调用。
				//    ⚠️ D1 的宿主调用点（client.js:11763 `window.__directorSubmit`）属**批次 6** 接线范围，
				//       本批次不改宿主，仅提供插件侧实现 + 契约（双份共存期）。
				if (typeof window !== "undefined") {
					window.__dshDirectorProcess = directorProcess;
					window.__dshDirectorReviewReturn = directorReviewReturn;
					// ── 批次 5 组件层 ──
					//    ⚠️ 宿主调用点（client.js:7358 小窗内渲染）属**批次 6** 接线范围，
					//       本批次仅提供组件实现 + 契约（双份共存期）。
					//    ⚠️ 本组件含一处**迁移期修正**（`filteredMessages` 越界引用 → `state.messages`），
					//       论证见 components/DirectorFlow.js 文件头 🔴 段落。**勿回退**。
					window.__dshDirectorFlow = DirectorFlow;
			
					// ── 批次 6 多层级总监结构 ──
					//    需求：03号文 §1.3 三层总监体系（全局总管 / 项目总监（文件夹级）/ 会话总监）
					//          + 17号文 §2.1 三层记忆结构 MemoryNode + §1A.13 分层汇总 + §2.3 继承
					//    全局契约（供宿主/调试/验证脚本调用，不可改名）：
					//      window.__dshHierarchy  层级 CRUD（installHierarchyApi）
					//      window.__dshSummarize  分层总结 + 分梯度调用（installSummarizeApi）
					//      window.__dshHierarchyTree / __dshHierarchyStats  树快照与统计
					window.__dshHierarchy = installHierarchyApi();
					window.__dshSummarize = installSummarizeApi();
					// ── 批次 7 自动同步 ──
					//    window.__dshDiscover  真实会话/文件夹数据源发现（localStorage 为主，IDB 兜底）
					//    window.__dshSync      自动同步 + 覆盖度自检
					window.__dshDiscover = installDiscoverApi();
					window.__dshSync = installSyncApi();
				}
			
				// 8. 批次 6：多层级总监结构（对话级 / 文件夹级 / 全局级）
				//    ⚠️ ensureGlobal 必须先于 loadTree —— 保证全局根节点存在（tree 构建依赖它）
				//    ⚠️ 挂载默认开启（传 { mountHierarchy: false } 可关）；DOM 未就绪时延迟到 DOMContentLoaded
				//    ⚠️ 挂载走「宿主 slot 优先 + 浮层兜底」双通道，兜底零宿主依赖 → 必定可见
				//    ⚠️ 批次 7：ensureGlobal → **自动同步**（把真实会话/文件夹落成总监节点）→ loadTree
				//       自动同步是「每一个对话 / 文件夹都有总监」的实现根基：节点 id 由数据源主键派生
				//       （ws_/se_ 前缀），故重复启动只会更新、不会重复新建（幂等）。
				//       传 { autoSync: false } 可关闭（仅调试用，默认必须开）。
				let syncStats = null;
				const hierarchyReady = ensureGlobal()
					.then(() => (options.autoSync === false ? null : syncFromSource()))
					.then((s) => {
						syncStats = s;
						if (typeof window !== "undefined") window.__dshSyncStats = s;
						return loadTree();
					})
					.then((t) => {
						if (typeof window !== "undefined") window.__dshHierarchyTree = t;
						return t;
					}).catch(() => null); // 层级树异步失败不影响其他能力
			
				let hierarchyMount = null;
				if (options.mountHierarchy !== false) {
					const doMount = () => {
						try {
							hierarchyMount = mountHierarchy({ open: options.openHierarchy === true });
							if (typeof window !== "undefined" && window.__dshHierarchyMount) {
								window.__dshHierarchyMount.mounted = true;
							}
						} catch (e) { /* 挂载失败静默，不阻断插件 */ }
					};
					if (typeof document !== "undefined" && document.readyState === "loading") {
						document.addEventListener("DOMContentLoaded", doMount);
					} else {
						doMount();
					}
				}
			
				const installed = {
					debug: typeof window !== "undefined" ? Boolean(window.__dshDebug) : false,
					v9Log: typeof window !== "undefined" ? Boolean(window.__dshV9Log) : false,
					layoutStore: Boolean(directorLayoutStore),
					themeStore: Boolean(dshThemeStore),
					config: Boolean(directorConfig),
					layoutProbe: probeInstalled,
					// ── 批次 2 ──
					messageStore: Boolean(directorStores),
					memoryApi: memoryApi,
					branchApi: branchApi,
					docsStore: Boolean(directorDocsStore),
					docsIndex: false, // 异步，稍后就绪
					// ── 批次 3 ──
					persistState: Boolean(persistState),
					storeFactory: typeof directorStoreFactory === "function",
					hook: typeof useDirectorStore === "function",
					beforeUnload: beforeUnload,
					// 语义说明：beforeUnload = 「本次调用是否**新注册**」；
					// beforeUnloadRegistered = 「能力是否**最终就绪**（宿主或插件任一注册）」。
					// 真机上宿主内联代码（client.js:6409）先占同名守卫 → beforeUnload=false 属幂等守卫
					// 按设计生效（假阴性），能力本身健全。验证脚本须用 beforeUnloadRegistered 判定。
					beforeUnloadRegistered: isBeforeUnloadRegistered(),
					fileLogBridged: fileLogBridged,
					fileChannel: isFileChannelAvailable(),
					opfs: isOpfsAvailable(),
					fsa: isFsaAvailable(),
					legacyRequire: legacyProbe.filter((p) => p.ok).map((p) => p.name), // 实测为空数组（T5）
					opfsPreloaded: false, // 异步，稍后就绪
					// ── 批次 4 逻辑层 ──
					directorProcess: typeof directorProcess === "function",
					directorReview: typeof directorReviewReturn === "function",
					directorReviewWired: false, // 有意不接线（宿主决策：保留不调用）
					directorProcessWired: false, // 宿主调用点属批次 6 接线范围
					// ── 批次 5 组件层 ──
					directorFlow: typeof DirectorFlow === "function",
					directorFlowWired: false, // 宿主调用点属批次 6 接线范围
					// 🔴 迁移期修正标记：filteredMessages 越界引用已修为 state.messages
					directorFlowFixedFilteredMessages: true,
					// ── 批次 6 多层级总监结构 ──
					hierarchyApi: typeof window !== "undefined" ? Boolean(window.__dshHierarchy) : false,
					summarizeApi: typeof window !== "undefined" ? Boolean(window.__dshSummarize) : false,
					// 语义：hierarchyMounted = 「浮层入口是否已挂载」（默认通道，必定可用）
					//       hierarchySlotRegistered = 「是否额外注册进宿主 conversation.view」
					hierarchyMounted: Boolean(hierarchyMount && hierarchyMount.overlay),
					hierarchySlotRegistered: Boolean(hierarchyMount && hierarchyMount.slotRegistered),
					hierarchyTreeReady: false, // 异步，稍后就绪
					// ── 批次 7 自动同步 ──
					discoverApi: typeof window !== "undefined" ? Boolean(window.__dshDiscover) : false,
					syncApi: typeof window !== "undefined" ? Boolean(window.__dshSync) : false,
					// 覆盖度：回答「是否每一个对话 / 文件夹都有总监」
					coverage: null, // 异步，稍后就绪（{sessions,folders,global,rate,ok}）
					coverageOk: false
				};
			
				hierarchyReady.then((t) => {
					installed.hierarchyTreeReady = Boolean(t);
					installed.coverage = syncStats && syncStats.coverage ? syncStats.coverage : null;
					installed.coverageOk = Boolean(installed.coverage && installed.coverage.ok);
				});
			
				docsIndexPromise.then((d) => { installed.docsIndex = Boolean(d); });
				preloadPromise.then((ok) => { installed.opfsPreloaded = Boolean(ok); });
			
				if (typeof window !== "undefined") {
					window.__dshDirectorBatch1 = installed;
					window.__dshDirectorBatch2 = installed; // 批次 2 别名
					window.__dshDirectorBatch3 = installed; // 批次 3 别名
					window.__dshDirectorBatch4 = installed; // 批次 4 别名
					window.__dshDirectorBatch5 = installed; // 批次 5 别名
					window.__dshDirectorBatch6 = installed; // 批次 6 别名
					window.__dshDirectorBatch7 = installed; // 批次 7 别名
				}
				return installed;
			}
			
			// export { directorLayoutStore, dshThemeStore, directorConfig, directorDocsStore, // ── 批次 3 ── directorStoreFactory, createDirectorStore, useDirectorStore, safeDirectorKey, loadDirectorStore, saveDirectorStore, DIRECTOR_DEFAULT_CONFIG, exportViaFsa, importViaFsa, // ── 批次 4 ── directorProcess, directorReviewReturn, // ── 批次 5 ── DirectorFlow, // ── 批次 6 多层级总监结构 ── installHierarchyApi, installSummarizeApi, mountHierarchy, summarizeTree, loadTree, ensureGlobal, LEVEL, GLOBAL_NODE_ID, DirectorHierarchy, // ── 批次 7 自动同步 ── installDiscoverApi, installSyncApi, syncFromSource, auditCoverage };
			
			exports.PLUGIN_VERSION = PLUGIN_VERSION;
			exports.installBatch1 = installBatch1;
			exports.directorLayoutStore = directorLayoutStore;
			exports.dshThemeStore = dshThemeStore;
			exports.directorConfig = directorConfig;
			exports.directorDocsStore = directorDocsStore;
			exports.// ── 批次 3 ──
	directorStoreFactory = // ── 批次 3 ──
	directorStoreFactory;
			exports.createDirectorStore = createDirectorStore;
			exports.useDirectorStore = useDirectorStore;
			exports.safeDirectorKey = safeDirectorKey;
			exports.loadDirectorStore = loadDirectorStore;
			exports.saveDirectorStore = saveDirectorStore;
			exports.DIRECTOR_DEFAULT_CONFIG = DIRECTOR_DEFAULT_CONFIG;
			exports.exportViaFsa = exportViaFsa;
			exports.importViaFsa = importViaFsa;
			exports.// ── 批次 4 ──
	directorProcess = // ── 批次 4 ──
	directorProcess;
			exports.directorReviewReturn = directorReviewReturn;
			exports.// ── 批次 5 ──
	DirectorFlow = // ── 批次 5 ──
	DirectorFlow;
			exports.// ── 批次 6 多层级总监结构 ──
	installHierarchyApi = // ── 批次 6 多层级总监结构 ──
	installHierarchyApi;
			exports.installSummarizeApi = installSummarizeApi;
			exports.mountHierarchy = mountHierarchy;
			exports.summarizeTree = summarizeTree;
			exports.loadTree = loadTree;
			exports.ensureGlobal = ensureGlobal;
			exports.LEVEL = LEVEL;
			exports.GLOBAL_NODE_ID = GLOBAL_NODE_ID;
			exports.DirectorHierarchy = DirectorHierarchy;
			exports.// ── 批次 7 自动同步 ──
	installDiscoverApi = // ── 批次 7 自动同步 ──
	installDiscoverApi;
			exports.installSyncApi = installSyncApi;
			exports.syncFromSource = syncFromSource;
			exports.auditCoverage = auditCoverage;
		};

		// ── Harness client 插件契约导出 ──
		var __entry = __m("client-entry.js");
		var apply = function apply(ctx) {
			void ctx;
			return __entry.installBatch1({});
		};
		var inject = [];
		exports.apply = apply;
		exports.inject = inject;
		exports.__entry = __entry;
		return module.exports;
	}
});
