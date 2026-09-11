window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-director-plugin",
	factory: (require) => {
		// 平台模块（React / cordis / slots 等）由 require 提供；本插件不依赖它们。
		void require;
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
			 * ── 待迁入（批次 3~6）───────────────────────────────────────
			 *   ⬜ A6 文件通道    ⬜ A7~A10 持久化+store
			 *   ⬜ D1 directorProcess  ⬜ D2 审核
			 *   ⬜ E1 DirectorFlow
			 *   ⬜ F3+F4 全局 API  ⬜ F1/F2 + G1/G4 宿主注入点改造
			 *   ⛔ E2 DirectorView — 已废弃（2026-09-08 P2 清理，墓志铭 client.js:8897）
			 *
			 * ⚠️ 关键约束
			 *   - 平台模块（react / cordis / web-react 等）**必须 external**，严禁打进产物（ADR-001）
			 *   - 加载顺序：debug → log-collector（后者依赖前者）→ layout / theme / config → docs-index
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
			
			const PLUGIN_VERSION = "0.2.0-batch2";
			
			/** 批次 1 安装器：装配零依赖基础层。返回已安装的能力清单（供宿主与调试读取） */
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
					docsIndex: false // 异步，稍后就绪
				};
			
				docsIndexPromise.then((d) => { installed.docsIndex = Boolean(d); });
			
				if (typeof window !== "undefined") {
					window.__dshDirectorBatch1 = installed;
					window.__dshDirectorBatch2 = installed; // 批次 2 别名：便于逐批次排查
				}
				return installed;
			}
			
			// export { directorLayoutStore, dshThemeStore, directorConfig, directorDocsStore };
			
			exports.PLUGIN_VERSION = PLUGIN_VERSION;
			exports.installBatch1 = installBatch1;
			exports.directorLayoutStore = directorLayoutStore;
			exports.dshThemeStore = dshThemeStore;
			exports.directorConfig = directorConfig;
			exports.directorDocsStore = directorDocsStore;
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
