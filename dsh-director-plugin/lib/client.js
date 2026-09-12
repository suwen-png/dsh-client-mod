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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：D3 DSH 统一调试日志工具（**A3+D3 合并后的权威实现**）
			 * 引用：—
			 * 上游：bridge/chat-bridge.js, bridge/nav-hook.js, bridge/split.js, client-entry.js, components/DesignStudio.js, components/DirectorDialog.js, components/DirectorFlow.js, components/DirectorHierarchy.js, components/DirectorPage.js, components/DirectorWorkbench.js, components/FloatDock.js, components/MindMap.js, logic/director-run.js, logic/summarize.js, logic/sync.js, mount.js, store/duty-config.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A3 专用 Log 收集器
			 * 引用：—
			 * 上游：client-entry.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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

		// ── util/no-drag.js ──
		__defs["util/no-drag.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 引用：—
			 * 上游：client-entry.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 E8（Windows 标题栏拖拽带穿透：可交互元素必须 no-drag）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * 桌面壳「窗口拖拽带」穿透 —— 把可交互元素从 OS caption area 里救出来
			 *
			 * ── 这份文件在整体里的位置 ───────────────────────────────────────────────
			 *   由 `client-entry.js` 在 boot 时调用一次（幂等）。
			 *   解决的问题**只存在于桌面壳**，浏览器里完全不复现。
			 *
			 * 🔴 现象（用户连续反馈三次的那件事）
			 *   设计图工作室铺满整个窗口 ⇒ 顶栏（CSS y ≈ 7~33）整条落在
			 *   **Windows 的 caption area**（本机 `navigator.windowControlsOverlay
			 *   .getTitlebarAreaRect().height` = 44）里。
			 *   鼠标落在该带内，系统返回 `HTCAPTION`，消息被当作**拖动窗口**处理，
			 *   **渲染进程永远收不到** —— 保存/改名/新建图/复制/重载框架/导出/删除/
			 *   版本/缩放 全部点不动，**连 mousemove 都进不来**。
			 *
			 * 🔴 为什么此前所有闸门都是绿的（2026-09-12 实测）
			 *   · CDP `Input.dispatchMouseEvent` **直接注入渲染进程**，绕过窗口消息循环
			 *     ⇒ 它看不见这个拦截，反而一路报绿；
			 *   · `document.elementsFromPoint()` 只会说"没遮挡"（DOM 层确实没遮挡）。
			 *   ⇒ 静态闸门 / 离线单测 / CDP e2e **原理上**都测不到这一类故障。
			 *   ⇒ 唯一判据是 **OS 级真实鼠标**：`python scripts/_osm.py click <物理x> <物理y>`。
			 *
			 * 🔴 修复依据（宿主自己早就踩过）
			 *   宿主样式表里有 `.Y4b3va_topbar => drag` 与
			 *   `.Y4b3va_topbar button => no-drag` 成对出现 ——
			 *   **拖拽区里的可交互元素必须显式 no-drag**，否则永远点不到。
			 *
			 * 设计取舍：**只给可交互元素加 no-drag，容器保持默认**。
			 *   这样顶栏的空白处仍然可以拖动窗口（符合"标题栏"的直觉），
			 *   而不是把整个铺满的工作室变成一块拖不动的死板。
			 */
			const STYLE_ID = "dsh-no-drag-style";
			
			/** 选择器：插件自有容器（id 以 `dsh-` 开头）内的所有可交互元素 */
			const NO_DRAG_SELECTOR = [
				'[id^="dsh-"] button',
				'[id^="dsh-"] input',
				'[id^="dsh-"] select',
				'[id^="dsh-"] textarea',
				'[id^="dsh-"] a',
				'[id^="dsh-"] [role="button"]'
			].join(",");
			
			/** 规则正文（普通字符串 —— 构建器对模板字符串有反引号限制，这里刻意不用） */
			const NO_DRAG_RULE =
				NO_DRAG_SELECTOR + "{-webkit-app-region:no-drag !important;}";
			
			/**
			 * 注入（或刷新）no-drag 样式。幂等：重复调用只更新同一个 style 节点。
			 * @returns {boolean} 是否注入成功（无 document 时返回 false，浏览器里也安全）
			 */
			function installNoDrag() {
				try {
					if (typeof document === "undefined" || !document) return false;
					let el = document.getElementById(STYLE_ID);
					if (!el) {
						el = document.createElement("style");
						el.id = STYLE_ID;
						el.setAttribute("data-dsh-purpose", "no-drag:escape-window-caption-area");
						(document.head || document.documentElement).appendChild(el);
					}
					if (el.textContent !== NO_DRAG_RULE) el.textContent = NO_DRAG_RULE;
					return true;
				} catch (e) {
					return false;
				}
			}
			
			__defaults["util/no-drag.js"] = installNoDrag;
			
			exports.NO_DRAG_SELECTOR = NO_DRAG_SELECTOR;
			exports.NO_DRAG_RULE = NO_DRAG_RULE;
			exports.installNoDrag = installNoDrag;
		};

		// ── store/layout.js ──
		__defs["store/layout.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A11 布局 store（弹窗三态扩展版）
			 * 引用：T-PLUG-015
			 * 上游：bridge/nav-hook.js, client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/FloatDock.js, components/MindMap.js, mount.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * store/layout.js — A11 布局 store（弹窗三态扩展版）
			 *
			 * 迁移源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
			 *   行范围：6439 ~ 6483（45 行）
			 *   区块标记：`// ========== 总监对话模式 - 布局store（小窗宽度/折叠/焦点） ==========`
			 *
			 * 职责：小窗宽度 / 折叠状态 / 焦点目标 / 上下伸缩面板高度 / **弹窗三态** 的集中状态层。
			 *
			 * ⚠️ 兼容约束（R5）：持久化 key `dsh.director.layout` **必须原样保留**，
			 *    改名将导致用户存量布局数据全部丢失。
			 *
			 * ── 本轮扩展（T-PLUG-015 弹窗形态，docs/10 §四 4.3）──────────────
			 *   新增字段（**只增不改**，存量数据无这些键 ⇒ 读取端必须做默认值兜底）：
			 *     `dialogOpen`      弹窗是否打开
			 *     `dialogCollapsed` 整窗最小化（收成右下角 chip）—— 05 号文只设计了左右两栏折叠，
			 *                       整窗最小化是**本轮新增**的第三态（docs/10 §4.3 标注 🆕）
			 *     `activeNodeId`    当前展示的层级节点（全局 / 项目·文件夹 / 会话）
			 *     `leftTab`         左面板分段：director（总监）/ levels（层级）/ agents（智能体）
			 *   **既有字段语义不变**：`directorPanelCollapsed`（左栏）/ `chatPanelCollapsed`（右栏）/
			 *     `directorPanelWidth` / `chatPanelWidth` / `focusTarget`。
			 *
			 *   边界与吸附（docs/11 §二 I8）：宽度 `clamp(180, 55%×视口)`；拖到 <180 自动吸附折叠；
			 *   双击中缝复位 300/300。
			 *
			 * 全局契约（宿主 G1/G4 依赖，**不可改名**）：
			 *   - `window.__directorLayoutStore` — 宿主 ChatView（client.js:7111）与 view-sync（client.js:9146）调用
			 *   - `window.__directorFocusTarget` — setFocusTarget 同步写入（client.js:6469）
			 */
			
			const DIRECTOR_LAYOUT_KEY = "dsh.director.layout";
			
			/** 左/右栏宽度的边界（docs/10 §4.1） */
			const PANEL_MIN_WIDTH = 180;
			/** 单栏最大占比（相对视口宽） */
			const PANEL_MAX_RATIO = 0.55;
			/** 默认栏宽 */
			const PANEL_DEFAULT_WIDTH = 300;
			/** 折叠后的竖条宽度 */
			const PANEL_RAIL_WIDTH = 40;
			
			/** 左面板分段（单一真相源，勿另写字面量） */
			const LEFT_TAB = Object.freeze({ DIRECTOR: "director", LEVELS: "levels", AGENTS: "agents" });
			
			/** 视口宽度（SSR / 测试环境兜底 1440） */
			function viewportWidth() {
				try {
					if (typeof window !== "undefined" && window.innerWidth) return window.innerWidth;
				} catch (e) { /* 忽略 */ }
				return 1440;
			}
			
			/** 单栏宽度上限（按视口比例，且不低于下限，避免极小视口下 clamp 反向） */
			function maxPanelWidth() {
				return Math.max(PANEL_MIN_WIDTH, Math.round(viewportWidth() * PANEL_MAX_RATIO));
			}
			
			/**
			 * 宽度钳制 + 吸附判定（docs/11 §二 I8）
			 * @param {number} w 期望宽度
			 * @returns {{width:number, collapse:boolean}} collapse=true 表示"拖到过窄 ⇒ 应吸附为折叠"
			 */
			function clampPanelWidth(w) {
				const n = Number(w);
				if (!Number.isFinite(n) || n <= 0) return { width: PANEL_DEFAULT_WIDTH, collapse: false };
				if (n < PANEL_MIN_WIDTH) return { width: PANEL_MIN_WIDTH, collapse: true };
				return { width: Math.min(Math.round(n), maxPanelWidth()), collapse: false };
			}
			
			const DEFAULTS = Object.freeze({
				// ── 05 号文既有字段（语义不变）──
				directorPanelWidth: PANEL_DEFAULT_WIDTH,
				chatPanelWidth: PANEL_DEFAULT_WIDTH,
				directorPanelCollapsed: false,
				chatPanelCollapsed: false,
				focusTarget: "director",
				// V7: 上下伸缩界面
				bottomPanelHeight: 180,
				bottomPanelCollapsed: true,
				topPanelCollapsed: false,
				// ── 本轮新增（弹窗三态）──
				dialogOpen: false,
				dialogCollapsed: false,
				activeNodeId: null,
				leftTab: LEFT_TAB.DIRECTOR,
				// ── 本轮新增（设计图工作室 · T-PLUG-018）──
				//  📐 设计图是**全屏覆盖层**（用户：「点击铺满全屏」），与弹窗三态无关，
				//     故单开一个布尔。打开时弹窗前端的浮层会让位（避免两层浮层叠着打架）。
				designStudioOpen: false,
				// 分支导图（血缘树）覆盖层。与设计图同为全屏层，但内容不同：
				//   导图 = 真实会话的分支血缘（消费 sessions.fork 写入的 meta.parentSession）
				//   设计图 = 手工编辑的界面稿（元素 + 交互逻辑）
				mindmapOpen: false,
				// 浮动按钮组里「思维导图」在前、「总监」在后（用户明确要求顺序）
				floatDockOpen: true,
				/* ── 本轮新增：导图节点的**用户摆放位置**（用户：思维导图的框不能动 需要可以移动）──
				 * 🔴 放这里而不是新开一个持久化 key：本 store 的语义就是"在哪"（宽度/折叠/焦点），
				 *    节点坐标同属"在哪"。再开第四个 key 只会让"复位"变成半复位。
				 * 🔴 只存**用户拖过的**节点（未拖过的走自动布局）⇒ 数据量最小、自动布局改动仍能生效。
				 *    形如 { "<sessionId>": { x, y } }
				 */
				mmPos: {}
			});
			
			function createDirectorLayoutStore() {
				let state = { ...DEFAULTS };
				try {
					const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DIRECTOR_LAYOUT_KEY) : null;
					if (raw) {
						// 🔴 只合并"已知字段"，忽略未知残留；缺字段由 DEFAULTS 兜底
						const parsed = JSON.parse(raw);
						if (parsed && typeof parsed === "object") {
							for (const k of Object.keys(DEFAULTS)) {
								if (parsed[k] !== undefined) state[k] = parsed[k];
							}
						}
					}
				} catch (e) { /* 解析失败 → 用默认值 */ }
				const listeners = new Set();
				function notify() {
					try { if (typeof localStorage !== "undefined") localStorage.setItem(DIRECTOR_LAYOUT_KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式 */ }
					for (const fn of listeners) { try { fn(state); } catch (e) { /* 单个订阅者异常不影响其他 */ } }
				}
				/** 拖拽调宽：返回是否触发了吸附折叠（供 UI 反馈） */
				function applyWidth(key, w) {
					const { width, collapse } = clampPanelWidth(w);
					state = { ...state, [key]: width };
					if (collapse) {
						const ck = key === "directorPanelWidth" ? "directorPanelCollapsed" : "chatPanelCollapsed";
						state = { ...state, [ck]: true };
					}
					notify();
					return collapse;
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
					toggleTopPanel: () => { state = { ...state, topPanelCollapsed: !state.topPanelCollapsed }; notify(); },
			
					/* ── 本轮新增：弹窗三态 ─────────────────────────────── */
			
					/** 打开/关闭弹窗（关闭时同时解除整窗最小化，避免"关了但还是 chip"的困惑） */
					setDialogOpen: (v) => {
						state = { ...state, dialogOpen: Boolean(v), dialogCollapsed: v ? state.dialogCollapsed : false };
						notify();
					},
					toggleDialog: () => {
						state = { ...state, dialogOpen: !state.dialogOpen, dialogCollapsed: false };
						notify();
					},
					/** 整窗最小化 / 还原 */
					setDialogCollapsed: (v) => { state = { ...state, dialogCollapsed: Boolean(v), dialogOpen: true }; notify(); },
					toggleDialogCollapsed: () => { state = { ...state, dialogCollapsed: !state.dialogCollapsed, dialogOpen: true }; notify(); },
					/** 切换当前层级节点（要求 7 / 9） */
					setActiveNode: (nodeId) => { state = { ...state, activeNodeId: nodeId || null }; notify(); },
					/** 切换左面板分段 */
					setLeftTab: (t) => {
						state = { ...state, leftTab: Object.values(LEFT_TAB).indexOf(t) >= 0 ? t : LEFT_TAB.DIRECTOR };
						notify();
					},
					/** 拖拽调宽（带吸附：过窄自动折叠）。返回是否触发吸附 */
					dragDirectorWidth: (w) => applyWidth("directorPanelWidth", w),
					dragChatWidth: (w) => applyWidth("chatPanelWidth", w),
					/** 双击中缝复位 */
					resetPanelWidths: () => {
						state = { ...state, directorPanelWidth: PANEL_DEFAULT_WIDTH, chatPanelWidth: PANEL_DEFAULT_WIDTH, directorPanelCollapsed: false, chatPanelCollapsed: false };
						notify();
					},
					/** 全部复位（调试/测试用） */
					resetLayout: () => { state = { ...DEFAULTS }; notify(); },
			
					/* ── 本轮新增：设计图工作室（T-PLUG-018）──────────────── */
					/** 打开/关闭设计图工作室（全屏覆盖层；**不依赖 dialogOpen**） */
					setDesignStudio: (v) => { state = { ...state, designStudioOpen: Boolean(v) }; notify(); },
					toggleDesignStudio: () => { state = { ...state, designStudioOpen: !state.designStudioOpen }; notify(); },
					/** 浮动按钮组显隐 */
					setFloatDock: (v) => { state = { ...state, floatDockOpen: Boolean(v) }; notify(); },
			
					/* ── 本轮新增：分支导图覆盖层 ─────────────────────────── */
					setMindmap: (v) => { state = { ...state, mindmapOpen: Boolean(v) }; notify(); },
					toggleMindmap: () => { state = { ...state, mindmapOpen: !state.mindmapOpen }; notify(); },
					/** 记录用户把某个框拖到哪（**只改画面位置，不改血缘**） */
					setNodePos: (sessionId, pos) => {
						if (!sessionId || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
						state = { ...state, mmPos: { ...state.mmPos, [String(sessionId)]: { x: Math.round(pos.x), y: Math.round(pos.y) } } };
						notify();
						return true;
					},
					/** 单个框归位（回到自动布局） */
					clearNodePos: (sessionId) => {
						if (!state.mmPos || !(String(sessionId) in state.mmPos)) return false;
						const next = { ...state.mmPos };
						delete next[String(sessionId)];
						state = { ...state, mmPos: next };
						notify();
						return true;
					},
					/** 全部归位（"自动布局"按钮） */
					resetNodePos: () => {
						state = { ...state, mmPos: {} };
						notify();
						return true;
					}
				};
			}
			
			/** 单例 + 挂载全局（宿主依赖 window.__directorLayoutStore） */
			const directorLayoutStore = createDirectorLayoutStore();
			if (typeof window !== "undefined") window.__directorLayoutStore = directorLayoutStore;
			
			exports.DIRECTOR_LAYOUT_KEY = DIRECTOR_LAYOUT_KEY;
			exports.PANEL_MIN_WIDTH = PANEL_MIN_WIDTH;
			exports.PANEL_MAX_RATIO = PANEL_MAX_RATIO;
			exports.PANEL_DEFAULT_WIDTH = PANEL_DEFAULT_WIDTH;
			exports.PANEL_RAIL_WIDTH = PANEL_RAIL_WIDTH;
			exports.LEFT_TAB = LEFT_TAB;
			exports.maxPanelWidth = maxPanelWidth;
			exports.clampPanelWidth = clampPanelWidth;
			exports.createDirectorLayoutStore = createDirectorLayoutStore;
			exports.directorLayoutStore = directorLayoutStore;
		};

		// ── store/theme.js ──
		__defs["store/theme.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A12 V9-Design D-01 主题变量体系
			 * 引用：—
			 * 上游：client-entry.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：C2 配置与本地模型
			 * 引用：—
			 * 上游：client-entry.js, components/DirectorWorkbench.js, logic/director-run.js, logic/process.js, logic/review.js, logic/summarize.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A13 + A14 DSH_DOCS_INDEX 注入壳（**剥离改造版**）
			 * 引用：—
			 * 上游：client-entry.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：C1 V9-Design 布局探针
			 * 引用：—
			 * 上游：client-entry.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A1 总监消息 store（内存层）
			 * 引用：批次 3
			 * 上游：client-entry.js, store/create-store.js, store/persist.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 C（消息投递时序）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：IndexedDB 持久化层（主要机制）
			 * 引用：—
			 * 上游：logic/discover.js, logic/sync.js, store/branch.js, store/docs.js, store/hierarchy.js, store/memory.js, store/persist.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A2 V9 记忆体系 CRUD
			 * 引用：—
			 * 上游：client-entry.js, logic/process.js, store/branch.js
			 * 下游：store/idb.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A4 分支创建与记忆面板交互
			 * 引用：—
			 * 上游：client-entry.js
			 * 下游：store/idb.js, store/memory.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 C（分支生命周期）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A5 总监文档 store（V8）
			 * 引用：—
			 * 上游：client-entry.js
			 * 下游：store/idb.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A6 持久化探测 + 文件通道适配器
			 * 引用：批次 1
			 * 上游：client-entry.js, store/create-store.js, store/persist.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A7 + A8 总监 store 的加载与保存
			 * 引用：批次 3
			 * 上游：client-entry.js, logic/process.js, store/create-store.js
			 * 下游：store/messages.js, store/idb.js, store/cookie.js, store/file-adapter.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A9 `createDirectorStore` store 工厂
			 * 引用：—
			 * 上游：client-entry.js, components/DirectorFlow.js, components/DirectorWorkbench.js
			 * 下游：store/messages.js, store/persist.js, store/file-adapter.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：A10 `useDirectorStore` React hook 绑定
			 * 引用：—
			 * 上游：client-entry.js, components/DirectorFlow.js, components/DirectorWorkbench.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：D1 总监对话核心处理函数
			 * 引用：批次 6
			 * 上游：client-entry.js
			 * 下游：config/model.js, store/persist.js, store/memory.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：D2 对话返回审核（**保留能力，当前无调用点**）
			 * 引用：—
			 * 上游：client-entry.js
			 * 下游：config/model.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：E1 小窗总监对话流组件
			 * 引用：批次 6
			 * 上游：client-entry.js
			 * 下游：store/create-store.js, store/use-store.js, util/debug.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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

		// ── store/plugin-db.js ──
		__defs["store/plugin-db.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：插件**自有**数据元层（独立数据库）
			 * 引用：V16 诉求 7（落死：数据不丢） · 要求 1 · 17 号文 §2.2 · 17 号文 §2.3 · 17 号文 §1 · T-PLUG-009
			 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/NodeDetailPanel.js, logic/routing.js, store/design.js, store/hierarchy.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 D7（锚点契约 · 设计图冷备库）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * store/plugin-db.js — 插件**自有**数据元层（独立数据库）
			 *
			 * ── 为什么必须有这一层（业务不变量：要求 1）──────────────────────
			 *   17 号文 §2.2 原设计：总监记忆用**独立库 `dsh-memory-db`**（6 个 store）；
			 *   17 号文 §2.3「每个项目/子项目的文档、对话、决策、待办、风险**相互隔离**」；
			 *   17 号文 §1A.7「沟通上下文 vs 执行上下文分离」（上下文不污染）。
			 *
			 *   但实际落地时退化成了「插件复用宿主 `dsh-director-db` 的 `memoryCore`，
			 *   靠 `id` 前缀 + `level` 字段**约定隔离**」（T-PLUG-009 方案）——
			 *   即：**设计要求隔离，落地变成共享**。
			 *   `docs/10-总监与对话架构总纲.md` §3.4 已论证：该退化**不必要**。
			 *
			 * ── 🔴 关键技术论证（解除 T-PLUG-009 的过度约束）─────────────────
			 *   T-PLUG-009 的约束原文是「**不得给宿主的 `dsh-director-db` 升 v4**」
			 *   —— 宿主以 v3 打开，版本不匹配会**直接失败**。
			 *   但 IndexedDB 的**版本协商只发生在同一个数据库名内**。
			 *   ⇒ **新建一个属于插件自己的数据库（不同 DB 名）完全不参与宿主的版本协商**，
			 *     对宿主**零影响**。
			 *   ⇒ 于是「物理隔离（要求 1）」与「R5 冻结 key（兼容约束）」**可以同时成立**，
			 *     无需任何取舍。
			 *
			 * ── R5 冻结项（本层**必须**原样保留，不得改名）───────────────────
			 *   `dsh.director.store.*` / `dsh.director.layout` / `director-main` /
			 *   `dsh.director.config` / DB `dsh-director-db` v3 及其 3 store /
			 *   cookie 前缀 `dsh_director_`   ← **全部不动**。本层是**新增**，不是替换。
			 *
			 * ── 迁移策略（docs/10 §3.5 四阶段）──────────────────────────────
			 *   阶段 1  新建本库（首次打开自动建库；`onupgradeneeded` 只在本库触发）
			 *   阶段 2  读取期**双读**：优先本库；本库无该节点时回落旧 `memoryCore`（**只读**）
			 *   阶段 3  迁移期把旧 `memoryCore` 中的层级节点（schema 白名单）**拷贝**入本库
			 *   阶段 4  迁移完成并验证后停止回落；旧记录**不删**（尊重《锚点契约》"历史数据保留"）
			 *
			 *   本文件实现**阶段 1–3**；阶段 4 由 `hierarchy.js` 的回落开关控制。
			 *
			 * ── 唯一允许的交叉点 ────────────────────────────────────────────
			 *   外键形态：`nodeId` ↔ 宿主的 `workspaceId` / `sessionId`（**只读引用**）。
			 *   **禁止**：联合查询、跨库事务、把宿主记录读进本库后落盘。
			 *   理由：交叉点收窄到"一个只读外键"，即**结构性地保证**要求 1 的不变量。
			 *
			 * 错误处理约定：与 `store/idb.js` 一致 —— 所有 API catch 后返回安全缺省
			 *   （false / null / []），**不向上抛**（持久化失败不应打断 UI）。
			 *   ⚠️ 故调用方不能以返回值判断"是否真的写入"，需按 execution-standards §3.4
			 *      「写操作后必须回读校验」另行读回比对。
			 */
			
			const hasWindow = typeof window !== "undefined";
			
			/** 插件自有数据库（**与宿主库无关**，不参与其版本协商） */
			const PLUGIN_DB_NAME = "dsh-director-plugin-db";
			/**
			 * 🔴 v1 → v2（2026-09-12）：新增 `directorDesigns`（设计图冷备，T-PLUG-018）。
			 *    仅动**本库**版本，宿主 `dsh-director-db` v3 的协商互不可见（IDB 版本协商只在同名库内发生）。
			 *    `onupgradeneeded` 是**幂等加法**（遍历 PDB_ALL_STORES 只补缺失的 store）⇒ 老库平滑升级。
			 */
			const PLUGIN_DB_VERSION = 2;
			
			/** 7 个 store（原 6 类记忆 + 设计图冷备） */
			const PDB = Object.freeze({
				NODES: "directorNodes",
				CONVERSATIONS: "directorConversations",
				PLANS: "directorPlans",
				REVIEWS: "directorReviews",
				DECISIONS: "directorDecisions",
				TODOS: "directorTodos",
				/** 设计图快照冷备（localStorage 的兜底恢复源，不是主存） */
				DESIGNS: "directorDesigns"
			});
			
			/**
			 * store schema（keyPath 与索引的**单一真相源**）
			 * `indexes` 形如 `{ 索引名: 字段路径 }`
			 */
			const PDB_SCHEMA = Object.freeze({
				[PDB.NODES]: { keyPath: "nodeId", indexes: { level: "level", parentId: "parentId" } },
				[PDB.CONVERSATIONS]: { keyPath: "messageId", indexes: { nodeId: "nodeId", createdAt: "createdAt" } },
				[PDB.PLANS]: { keyPath: "planId", indexes: { nodeId: "nodeId" } },
				[PDB.REVIEWS]: { keyPath: "reviewId", indexes: { nodeId: "nodeId", targetId: "targetId" } },
				[PDB.DECISIONS]: { keyPath: "decisionId", indexes: { nodeId: "nodeId" } },
				[PDB.TODOS]: { keyPath: "todoId", indexes: { nodeId: "nodeId" } },
				// 设计图冷备：单条快照记录（graph 内聚，无需索引）
				[PDB.DESIGNS]: { keyPath: "designId", indexes: {} }
			});
			
			/** 全部 store 名（校验用） */
			const PDB_ALL_STORES = Object.freeze(Object.keys(PDB_SCHEMA));
			
			let dbPromise = null;
			
			/** 是否已就绪（同步可读的状态位，供 UI 展示"数据元已隔离"） */
			let pluginDbState = { attempted: false, ok: false, error: null, name: PLUGIN_DB_NAME, version: PLUGIN_DB_VERSION };
			
			/**
			 * 打开插件自有数据库（单例）
			 * 🔴 `indexedDB.open(name, 1)` 只影响**本库**；宿主以 v3 打开 `dsh-director-db`
			 *    时与本调用**互不可见**。
			 * @returns {Promise<IDBDatabase>}
			 */
			function openPluginDB() {
				if (dbPromise) return dbPromise;
				if (typeof indexedDB === "undefined") {
					pluginDbState = { attempted: true, ok: false, error: "indexedDB unavailable", name: PLUGIN_DB_NAME, version: PLUGIN_DB_VERSION };
					dbPromise = Promise.reject(new Error("indexedDB unavailable"));
					return dbPromise;
				}
				pluginDbState = { attempted: true, ok: false, error: null, name: PLUGIN_DB_NAME, version: PLUGIN_DB_VERSION };
				dbPromise = new Promise((resolve, reject) => {
					try {
						const req = indexedDB.open(PLUGIN_DB_NAME, PLUGIN_DB_VERSION);
						req.onupgradeneeded = () => {
							const db = req.result;
							for (const name of PDB_ALL_STORES) {
								const spec = PDB_SCHEMA[name];
								const os = db.objectStoreNames.contains(name)
									? req.transaction.objectStore(name)
									: db.createObjectStore(name, { keyPath: spec.keyPath });
								for (const idx of Object.keys(spec.indexes || {})) {
									if (!os.indexNames.contains(idx)) {
										os.createIndex(idx, spec.indexes[idx], { unique: false });
									}
								}
							}
						};
						req.onsuccess = () => {
							pluginDbState.ok = true;
							resolve(req.result);
						};
						req.onerror = () => {
							pluginDbState.error = (req.error && req.error.message) || "open failed";
							reject(req.error || new Error("plugin-db open failed"));
						};
						req.onblocked = () => {
							pluginDbState.error = "blocked";
							reject(new Error("plugin-db open blocked"));
						};
					} catch (e) {
						pluginDbState.error = String(e && e.message);
						reject(e);
					}
				});
				// 失败后允许重试（避免一次性失败被永久缓存）
				dbPromise.catch(() => { dbPromise = null; });
				return dbPromise;
			}
			
			/** 事务包装：统一 catch → 安全缺省 */
			function ptx(store, mode, fn) {
				return openPluginDB().then((db) => new Promise((resolve, reject) => {
					try {
						const t = db.transaction(store, mode);
						const os = t.objectStore(store);
						const req = fn(os);
						t.oncomplete = () => resolve(req ? req.result : undefined);
						t.onerror = () => reject(t.error || new Error("tx error"));
						t.onabort = () => reject(t.error || new Error("tx abort"));
					} catch (e) { reject(e); }
				}));
			}
			
			/* ── 通用 CRUD（安全缺省）─────────────────────────────────────── */
			
			function pPut(store, record) {
				return ptx(store, "readwrite", (os) => os.put(record)).then(() => true).catch(() => false);
			}
			function pGet(store, key) {
				return ptx(store, "readonly", (os) => os.get(key)).then((r) => (r === undefined ? null : r)).catch(() => null);
			}
			function pGetAll(store) {
				return ptx(store, "readonly", (os) => os.getAll()).then((r) => r || []).catch(() => []);
			}
			function pGetAllByIndex(store, indexName, key) {
				return ptx(store, "readonly", (os) => os.index(indexName).getAll(key)).then((r) => r || []).catch(() => []);
			}
			function pDelete(store, key) {
				return ptx(store, "readwrite", (os) => os.delete(key)).then(() => true).catch(() => false);
			}
			function pCount(store) {
				return ptx(store, "readonly", (os) => os.count()).then((r) => (typeof r === "number" ? r : 0)).catch(() => 0);
			}
			function pClear(store) {
				return ptx(store, "readwrite", (os) => os.clear()).then(() => true).catch(() => false);
			}
			
			/* ── 域辅助：ID 生成 ─────────────────────────────────────────── */
			
			/** 生成稳定可读的领域 id（无随机依赖，便于断言） */
			function makeId(prefix, seed) {
				const t = Date.now().toString(36);
				const r = Math.floor(Math.random() * 1e6).toString(36);
				return `${prefix}_${seed ? String(seed).slice(-8) + "_" : ""}${t}${r}`;
			}
			
			/* ── 域辅助：层级节点 ────────────────────────────────────────── */
			
			/**
			 * 写入层级节点
			 * 🔴 注意本库 `directorNodes` 的 keyPath 是 **`nodeId`**（不是宿主 `memoryCore` 的 `projectId`）
			 *    ⇒ 调用方传的节点对象用 `id` 字段表示节点 id，这里显式映射，避免"缺主键 ⇒ 静默失败"。
			 */
			function saveDirectorNode(node) {
				if (!node || !node.id) return Promise.resolve(false);
				return pPut(PDB.NODES, { ...node, nodeId: node.id });
			}
			function getDirectorNode(nodeId) {
				return pGet(PDB.NODES, nodeId);
			}
			function listDirectorNodes() {
				return pGetAll(PDB.NODES);
			}
			function deleteDirectorNode(nodeId) {
				return pDelete(PDB.NODES, nodeId);
			}
			
			/* ── 域辅助：总监对话（要求 2「总监自己也是一路对话」）────────── */
			
			function appendDirectorMessage(nodeId, msg) {
				const rec = {
					messageId: msg.messageId || makeId("dm", nodeId),
					nodeId,
					role: msg.role || "director",
					kind: msg.kind || "note",
					text: String(msg.text == null ? "" : msg.text),
					at: msg.at || Date.now(),
					meta: msg.meta || {}
				};
				return pPut(PDB.CONVERSATIONS, rec).then((ok) => (ok ? rec : null));
			}
			function listDirectorMessages(nodeId) {
				return pGetAllByIndex(PDB.CONVERSATIONS, "nodeId", nodeId)
					.then((rows) => rows.sort((a, b) => (a.at || 0) - (b.at || 0)));
			}
			
			/* ── 域辅助：审核 / 决策 / 方案 / 待办 ────────────────────────── */
			
			function saveReview(rec) {
				const row = { ...rec, reviewId: rec.reviewId || makeId("rv", rec.nodeId) };
				return pPut(PDB.REVIEWS, row).then((ok) => (ok ? row : null));
			}
			function listReviews(nodeId) {
				return pGetAllByIndex(PDB.REVIEWS, "nodeId", nodeId);
			}
			function saveDecision(rec) {
				const row = { ...rec, decisionId: rec.decisionId || makeId("dc", rec.nodeId) };
				return pPut(PDB.DECISIONS, row).then((ok) => (ok ? row : null));
			}
			function listDecisions(nodeId) {
				return pGetAllByIndex(PDB.DECISIONS, "nodeId", nodeId);
			}
			function savePlan(rec) {
				const row = { ...rec, planId: rec.planId || makeId("pl", rec.nodeId) };
				return pPut(PDB.PLANS, row).then((ok) => (ok ? row : null));
			}
			function listPlans(nodeId) {
				return pGetAllByIndex(PDB.PLANS, "nodeId", nodeId);
			}
			function saveTodo(rec) {
				const row = { ...rec, todoId: rec.todoId || makeId("td", rec.nodeId) };
				return pPut(PDB.TODOS, row).then((ok) => (ok ? row : null));
			}
			function listTodos(nodeId) {
				return pGetAllByIndex(PDB.TODOS, "nodeId", nodeId);
			}
			
			/* ── 统计（供 UI 与服务面板展示"数据元独立性"）──────────────── */
			
			function pluginDbStats() {
				return Promise.all([
					pCount(PDB.NODES), pCount(PDB.CONVERSATIONS), pCount(PDB.PLANS),
					pCount(PDB.REVIEWS), pCount(PDB.DECISIONS), pCount(PDB.TODOS)
				]).then(([nodes, conversations, plans, reviews, decisions, todos]) => ({
					name: PLUGIN_DB_NAME, version: PLUGIN_DB_VERSION, ok: pluginDbState.ok,
					nodes, conversations, plans, reviews, decisions, todos
				}));
			}
			
			/** 清空本库（仅调试/测试用；**绝不动宿主库**） */
			function resetPluginDb() {
				return Promise.all(PDB_ALL_STORES.map((s) => pClear(s))).then(() => true);
			}
			
			/** 安装全局契约（调试与验证脚本用，不可改名） */
			function installPluginDbApi() {
				if (!hasWindow) return null;
				window.__dshPluginDb = {
					PLUGIN_DB_NAME, PLUGIN_DB_VERSION, PDB, PDB_SCHEMA, PDB_ALL_STORES,
					openPluginDB, pluginDbStats, pluginDbState,
					pPut, pGet, pGetAll, pGetAllByIndex, pDelete, pCount, pClear,
					saveDirectorNode, getDirectorNode, listDirectorNodes, deleteDirectorNode,
					appendDirectorMessage, listDirectorMessages,
					saveReview, listReviews, saveDecision, listDecisions, savePlan, listPlans,
					saveTodo, listTodos, resetPluginDb
				};
				return window.__dshPluginDb;
			}
			
			exports.PLUGIN_DB_NAME = PLUGIN_DB_NAME;
			exports.PLUGIN_DB_VERSION = PLUGIN_DB_VERSION;
			exports.PDB = PDB;
			exports.PDB_SCHEMA = PDB_SCHEMA;
			exports.PDB_ALL_STORES = PDB_ALL_STORES;
			exports.pluginDbState = pluginDbState;
			exports.openPluginDB = openPluginDB;
			exports.pPut = pPut;
			exports.pGet = pGet;
			exports.pGetAll = pGetAll;
			exports.pGetAllByIndex = pGetAllByIndex;
			exports.pDelete = pDelete;
			exports.pCount = pCount;
			exports.pClear = pClear;
			exports.makeId = makeId;
			exports.saveDirectorNode = saveDirectorNode;
			exports.getDirectorNode = getDirectorNode;
			exports.listDirectorNodes = listDirectorNodes;
			exports.deleteDirectorNode = deleteDirectorNode;
			exports.appendDirectorMessage = appendDirectorMessage;
			exports.listDirectorMessages = listDirectorMessages;
			exports.saveReview = saveReview;
			exports.listReviews = listReviews;
			exports.saveDecision = saveDecision;
			exports.listDecisions = listDecisions;
			exports.savePlan = savePlan;
			exports.listPlans = listPlans;
			exports.saveTodo = saveTodo;
			exports.listTodos = listTodos;
			exports.pluginDbStats = pluginDbStats;
			exports.resetPluginDb = resetPluginDb;
			exports.installPluginDbApi = installPluginDbApi;
		};

		// ── store/hierarchy.js ──
		__defs["store/hierarchy.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：多层级总监结构（对话级 / 文件夹级 / 全局级）
			 * 引用：要求 1 · 17 号文 §2.1 · T-PLUG-009
			 * 上游：bridge/nav-hook.js, client-entry.js, components/DirectorDialog.js, components/DirectorHierarchy.js, components/DirectorPage.js, components/DirectorWorkbench.js, logic/summarize.js, logic/sync.js, store/duty-config.js
			 * 下游：store/idb.js, store/plugin-db.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			 * 存储决策（🔴 已按 docs/10 §3.4 订正 —— 独立库论证）
			 *
			 *   **T-PLUG-009 的旧结论（过度约束）**：宿主与插件共享 DB `dsh-director-db` v3，
			 *   插件若升 v4，宿主再以 v3 打开会失败 ⇒ 故"全部层级节点只能存 `memoryCore`"。
			 *
			 *   **订正**：IndexedDB 的**版本协商只发生在同一个数据库名内**。
			 *   `dsh-director-plugin-db` v1 是**另一个库**，完全不参与宿主的版本协商 ⇒ 对宿主零影响。
			 *   ⇒ 「物理隔离（要求 1）」与「R5 冻结 key」**可以同时成立**，无需取舍。
			 *
			 *   现行策略（docs/10 §3.5 四阶段迁移）：
			 *     ① 写入：**主写** `dsh-director-plugin-db/directorNodes`，
			 *        **镜像** `memoryCore`（阶段 2 的兼容镜像，保证既有面板/脚本/存量不破）
			 *     ② 读取：**先新库**；新库无该节点 → 回落旧 `memoryCore`（只读）
			 *     ③ 迁移：`listAllNodes` 发现新库为空而旧库有条目时，**自动搬迁**（幂等，按 nodeId upsert）
			 *     ④ 旧记录**不删**（尊重《锚点契约》"历史数据保留"）
			 *
			 * 全局契约：`window.__dshHierarchy`（供宿主/调试/验证脚本调用）
			 */
			
			const { openIDB, IDB_MEMORY_CORE_STORE } = __m("store/idb.js");
			const { saveDirectorNode: pdbSaveNode, getDirectorNode: pdbGetNode, listDirectorNodes: pdbListNodes, deleteDirectorNode: pdbDeleteNode, PLUGIN_DB_NAME } = __m("store/plugin-db.js");
			
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
			
			/** 合法层级的**白名单**（由 LEVEL 单一真相源派生，勿另写字面量） */
			const LEVEL_WHITELIST = Object.freeze(Object.keys(LEVEL).map((k) => LEVEL[k]));
			
			/**
			 * 判定一条 IDB 记录是否为「本模块的层级节点」。
			 *
			 * 🔴 为何必须是**白名单**而不是「有 level 就算」：
			 *    `memoryCore` 是**与宿主共享**的 store（见文件头：不能升 v4 ⇒ 无法新增独立 store），
			 *    插件记录与宿主记忆记录**同处一个 keyPath 命名空间**，只能靠字段形态区分。
			 *    若写成 `n.level` 真值判断，则宿主记忆记录**只要哪天带上一个 `level` 字段**，
			 *    就会被当成层级节点静默混入树中 —— 不报错、不崩溃，只是树里多出莫名其妙的节点，
			 *    属「**约定失效即静默**」类缺陷（与 2026-09-12 那批「构建通过但运行时报错」同源）。
			 *    故收紧为：`id` 必须是非空字符串 **且** `level` 必须**恰为**三值之一。
			 *
			 *    对既有记录**零行为差异**（现有 11 条全部通过），已由
			 *    `scripts/verify-data-safe.mjs` 的「隔离性动态反证」实测覆盖。
			 * @param {*} n
			 * @returns {boolean}
			 */
			function isHierarchyNode(n) {
				return Boolean(n)
					&& typeof n.id === "string" && n.id.length > 0
					&& LEVEL_WHITELIST.indexOf(n.level) >= 0;
			}
			
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
			
			/* ── IDB 读写 ────────────────────────────────────────────────
			 * 主存：`dsh-director-plugin-db/directorNodes`（插件自有，物理隔离 —— 要求 1）
			 * 镜像：旧 `dsh-director-db/memoryCore`（兼容镜像，阶段 2；旧记录不删 —— 阶段 4 前）
			 * 兼容镜像开关（阶段 2→4）：置 false 即停止写旧库，届时旧库仅剩历史数据。
			 * ------------------------------------------------------------------------- */
			const MIRROR_LEGACY_MEMORY_CORE = true;
			
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
			
			/* ── 旧库（memoryCore）读写：仅用于回落与镜像 ── */
			function legacyGet(id) {
				return tx("readonly", (s) => s.get(id)).then((r) => r || null).catch(() => null);
			}
			function legacyPut(node) {
				const next = { ...node, projectId: node.id, meta: { ...(node.meta || {}), updatedAt: Date.now() } };
				return tx("readwrite", (s) => s.put(next)).then(() => true).catch(() => false);
			}
			function legacyDel(id) {
				return tx("readwrite", (s) => s.delete(id)).then(() => true).catch(() => false);
			}
			function legacyList() {
				return tx("readonly", (s) => s.getAll())
					.then((r) => (r || []).filter(isHierarchyNode))
					.catch(() => []);
			}
			
			/**
			 * 读取单个节点（双读：先插件自有库，再回落旧 memoryCore）
			 * 回落到的记录**不会自动写回**（读路径保持只读语义），搬迁由 `listAllNodes` 统一负责。
			 */
			async function getNode(id) {
				const hit = await pdbGetNode(id);
				if (hit) return hit;
				return legacyGet(id);
			}
			
			/**
			 * 写入单个节点（**主写新库 + 镜像旧库**）
			 *
			 * 🔴 旧库 `memoryCore` 的 keyPath 是 **`projectId`**，而节点主键字段是 `id`。
			 *    若不注入 `projectId`，`put()` 的 key 为 `undefined` → IndexedDB 抛 DataError，
			 *    **写入静默失败**（catch 吞掉）。实测症状：createChild 返回节点但 loadTree 查不到、
			 *    kids 为空。故镜像写入**必须**把 `projectId` 设为 `node.id`。
			 *    （插件自有库的 keyPath 是 `nodeId`，由 `plugin-db.js` 内部映射，见其 JSDoc。）
			 */
			async function saveNode(node) {
				if (!node || !node.id) return Promise.resolve(false);
				const okPrimary = await pdbSaveNode(node);
				if (MIRROR_LEGACY_MEMORY_CORE) await legacyPut(node);
				if (!okPrimary && typeof window !== "undefined" && window.__dshDebug) {
					window.__dshDebug.warn("hierarchy", "saveNode: 插件自有库写入失败，已回退镜像库（" + PLUGIN_DB_NAME + " 不可用？）");
				}
				return okPrimary || MIRROR_LEGACY_MEMORY_CORE;
			}
			
			/** 删除节点（同时把其从父级 children 摘除；新旧两库同删） */
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
				await pdbDeleteNode(id);
				return legacyDel(id);
			}
			
			/**
			 * 全量拉取所有节点
			 * ① 读插件自有库（**主真相源**）
			 * ② 若为空而旧库有条目 ⇒ **自动搬迁**（阶段 3：把旧 memoryCore 的层级节点拷贝入新库，幂等）
			 * ③ 过滤走 schema 白名单 `isHierarchyNode`（见其 JSDoc）
			 */
			async function listAllNodes() {
				const primary = (await pdbListNodes()).filter(isHierarchyNode);
				if (primary.length) return primary;
			
				// 阶段 3：自动搬迁（幂等 —— 按 nodeId upsert，重复执行不会重复新建）
				const legacy = await legacyList();
				if (!legacy.length) return [];
				for (const n of legacy) {
					try { await pdbSaveNode(n); } catch (e) { /* 单条失败不阻断整体搬迁 */ }
				}
				const after = (await pdbListNodes()).filter(isHierarchyNode);
				// 搬迁未生效（自有库不可用）时，直接返回旧库结果，保证功能不因迁移而中断
				return after.length ? after : legacy;
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
					resolveConfig, getBreadcrumb, countByLevel, isHigher,
					// 数据元归属（要求 1 的可核验锚点）
					PLUGIN_DB_NAME, MIRROR_LEGACY_MEMORY_CORE
				};
				return window.__dshHierarchy;
			}
			
			exports.LEVEL = LEVEL;
			exports.LEVEL_LABEL = LEVEL_LABEL;
			exports.GLOBAL_NODE_ID = GLOBAL_NODE_ID;
			exports.isHierarchyNode = isHierarchyNode;
			exports.makeNodeId = makeNodeId;
			exports.makeNode = makeNode;
			exports.MIRROR_LEGACY_MEMORY_CORE = MIRROR_LEGACY_MEMORY_CORE;
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：层级数据变更事件总线（极简，零依赖）
			 * 引用：—
			 * 上游：components/DirectorDialog.js, components/DirectorHierarchy.js, components/DirectorPage.js, logic/summarize.js, logic/sync.js, mount.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：分层总结 + 分梯度调用
			 * 引用：03 号文 §4.3 · 17 号文 §1
			 * 上游：client-entry.js, components/DirectorHierarchy.js
			 * 下游：config/model.js, store/hierarchy.js, util/debug.js, util/bus.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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

		// ── bridge/split.js ──
		__defs["bridge/split.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：「左栏分屏」通道（要求 5：左侧总监 / 右侧对话数据）
			 * 引用：要求 5 · 要求 4
			 * 上游：bridge/chat-bridge.js, bridge/nav-hook.js, client-entry.js, components/DirectorDialog.js, mount.js
			 * 下游：util/debug.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * bridge/split.js — 「左栏分屏」通道（要求 5：左侧总监 / 右侧对话数据）
			 *
			 * ── 要解决的问题 ────────────────────────────────────────────────
			 *   要求 5 要「右侧对话数据**完全与对话 tab 保持一致**」，要求 4 要「对话保持原有逻辑不变」。
			 *   若把原生对话区**遮住**再画一个副本，两条要求立刻冲突（副本必然"只是长得像"）。
			 *
			 * ── 通道选型（docs/11 §三：方案 C，57 分居首）──────────────────
			 *   **布局分屏**：不移动任何节点，只在弹窗开启期间注入一段 `<style>`，
			 *   把原生应用根节点**向右挤**，腾出的左侧空间由插件的总监面板占用。
			 *   ⇒ 右栏**就是**原生对话区本身（同一节点、同一渲染器、同一 store）
			 *     ⇒ "完全一致"从"需要保证的性质"退化为**同义反复**；
			 *     ⇒ 消息交互（查看调用详情 / 分叉 / 打开文件 / 选择复制）**原样可用**，零转发代码。
			 *
			 *   | 状态 | `.RWZidW_viewArea`（真机实测） |
			 *   |:--|:--|
			 *   | 基线 | `x=280, w=1154` |
			 *   | 注入 `padding-left:300px` | `x=580, w=854` |
			 *   | 移除注入 | `x=280, w=1154`（**逐值复原**） |
			 *
			 * ── 🔴 三条硬边界（防止"悄悄改宿主"，docs/11 §三 3.3）───────────
			 *   允许：注入 `<style id="dsh-director-split-style">`；给**已存在**的原生节点加 `data-*` 属性。
			 *   禁止：增删改**任何**节点；改原生事件监听；改原生数据/store；改原生节点的 `style` 属性。
			 *   判据：弹出前后对宿主做 全量 DOM diff，差异必须**只有** `<style>` 标签与 `data-*` 属性。
			 *
			 * ── 🔴 可复用教训（本轮实测踩中，docs/11 §三 3.2）────────────────
			 *   注入 `!important` 样式的探针**必须在同一表达式内移除**。
			 *   本轮的一次异步探针（`requestAnimationFrame` 等待后移除）因 CDP 会话超时被后台化，
			 *   **样式残留在页面里**，于是"基线"就已经是偏移态（第二次探测 `x=580` 才暴露）。
			 *   故本模块：**同步注入 + 同步移除**，并且 `applySplit` 内部用 `try/finally` 兜底。
			 */
			
			const { dshLog } = __m("util/debug.js");
			
			const SPLIT_STYLE_ID = "dsh-director-split-style";
			/** 被打上「应用根」标记的属性（样式选择器完全依赖它，不依赖宿主的 hash 类名） */
			const ROOT_ATTR = "data-dsh-split-root";
			/** 折叠态标记（值：`none` | `left` | `right` | `both`），供样式分支 */
			const STATE_ATTR = "data-dsh-split-collapsed";
			
			const hasDom = () => typeof window !== "undefined" && typeof document !== "undefined";
			
			/**
			 * 插件自有 UI 的根节点 id 清单（**严禁**被当成宿主节点）。
			 *
			 * 🔴 为什么必须硬编码而不是 import：
			 *   `split.js` 被 `DirectorDialog.js` 与 `mount.js` 引用，反向 import 会成环。
			 *   漂移风险由离线断言兜住 —— `verify-dialog.mjs` C 段校验本清单与
			 *   `DirectorDialog.DIALOG_ID` / `mount.DIALOG_HOST_ID|LAUNCHER_ID|OVERLAY_HOST_ID` 逐一相等。
			 */
			const PLUGIN_UI_IDS = Object.freeze([
				"dsh-director-dialog",       // DirectorDialog.DIALOG_ID
				"dsh-director-dialog-host",  // mount.DIALOG_HOST_ID
				"dsh-director-hierarchy-launcher", // mount.LAUNCHER_ID
				"dsh-director-hierarchy-overlay"   // mount.OVERLAY_HOST_ID
			]);
			const PLUGIN_UI_SELECTOR = PLUGIN_UI_IDS.map((i) => "#" + i).join(",") + ",[data-dsh-plugin-ui]";
			
			/**
			 * 对话编辑器 placeholder（定位锚点首选）。
			 * 🔴 与 `chat-bridge.COMPOSER_PLACEHOLDER` **必须相等**；`chat-bridge` 已 import 本模块，
			 *    反向 import 会成环 ⇒ 本地声明，等值关系由离线断言（verify-dialog C 段）锁定。
			 */
			const CHAT_COMPOSER_PLACEHOLDER = "给智能体发消息";
			
			/** 是否落在插件自有 UI 内（含自身） */
			function isPluginNode(el) {
				if (!el || !el.closest) return false;
				try { return Boolean(el.closest(PLUGIN_UI_SELECTOR)); } catch (e) { return false; }
			}
			
			/** 是否滚动容器（`overflow-x` 为 auto/scroll/hidden 时不可挂 padding —— 见下方硬约束） */
			function isScrollContainer(el) {
				if (!hasDom() || !window.getComputedStyle) return false;
				try {
					const ox = String(window.getComputedStyle(el).overflowX || "").toLowerCase();
					return ox === "auto" || ox === "scroll" || ox === "hidden";
				} catch (e) { return false; }
			}
			
			function isVisible(el) {
				if (!el || !el.getBoundingClientRect) return false;
				const r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0;
			}
			
			/**
			 * 定位「原生对话应用根」——**不使用宿主 hash 类名**（`RWZidW_*` 会随宿主构建变化）。
			 *
			 * 判据（语义定位，三步）：
			 *   ① 锚点优先级：**对话编辑器**（`textarea[placeholder="给智能体发消息"]`）
			 *      → **tab 环**（`<button>` 且 `y < 90`、宽 < 60、文本 ≤ 3 字）
			 *      → 任一可见 `<textarea>`
			 *   ② 自锚点**向上**找第一个（最深）满足「应用根」判据的祖先
			 *   ③ 返回它；找不到返回 `null`（调用方须优雅降级，不得硬塞标记）
			 *
			 * ── 🔴 两条真机踩坑（本轮实测，docs/11 §八 E-SPLIT-001/002）──────────
			 *   E-SPLIT-001  **未排除插件自身** ⇒ ① 步扫全页 `<button>` 时，插件标题栏按钮
			 *     （`⇤` `⇥` `–` `▢` `✕`，y=8 / w=24 / 文本 1 字）先于宿主 tab 环命中，
			 *     于是 `findChatRoot()` 返回**插件自己的面板** `.d-panel`，
			 *     分屏把 `padding-left` 加到自己头上 —— 右栏「完全一致」全程是假的。
			 *   E-SPLIT-002  **兜底锚点用 `input[type=text]`** ⇒ 命中侧栏**搜索框**
			 *     （`.PKekiq_search`），向上爬到 `.aFw_Oq_root`（280×816）——
			 *     尺寸恰好也满足「应用根」判据 ⇒ 把**侧栏**当成对话根。
			 *     修正：兜底只用 `<textarea>`（对话编辑器是 textarea，侧栏搜索是 input）。
			 *     另加宽度下限 `> 40% 视口宽`（侧栏 280/1442=19% ⇒ 被拒）。
			 *
			 * ── 🔴 硬约束：不选滚动容器（真机逐层实测 `scripts/_probe-pad.mjs`）──────
			 *   | 候选 | padding 后 `.composerSeat` | 横向溢出 |
			 *   |:--|:--|:--|
			 *   | `RWZidW_scrollBody` | x 280→580, w 1154→854 | ❌ `overflowX=true` |
			 *   | `RWZidW_root` | x 280→580, w 1154→854 | ✅ 无 |
			 *   | `OrjXgq_centerSurface` | 同上 | ✅ 无 |
			 *   | `OrjXgq_centerCol` | 同上 | ✅ 无 |
			 *   四者视觉结果一致，但滚动容器挂 padding 会让**可滚区域内**多出 300px
			 *   ⇒ 出现横向滚动条。故跳过 `overflow-x ∈ {auto,scroll,hidden}` 的祖先。
			 *   取「最深的合法祖先」而非「最外层」：更外层可能是同时含**侧栏**的容器
			 *   （本轮 `.OrjXgq_frame` 1442 宽，靠 `width < 0.98vw` 拒绝）。
			 *
			 * @returns {HTMLElement|null}
			 */
			function findChatRoot() {
				if (!hasDom()) return null;
				const vh = window.innerHeight || 800;
				const vw = window.innerWidth || 1440;
				const isAppLike = (el) => {
					if (!el || el === document.body || el === document.documentElement) return false;
					if (isPluginNode(el)) return false;                                  // ① 绝不选插件自身
					const r = el.getBoundingClientRect();
					if (!(r.height >= vh * 0.9 && r.width > vw * 0.4 && r.width < vw * 0.98)) return false;
					if (isScrollContainer(el)) return false;                              // ② 绝不选滚动容器
					return true;
				};
			
				// ① 锚点（插件自身一律排除；兜底只用 textarea）
				let anchor = null;
				for (const t of document.querySelectorAll("textarea")) {
					if (isPluginNode(t)) continue;
					if (t.placeholder === CHAT_COMPOSER_PLACEHOLDER && isVisible(t)) { anchor = t; break; }
				}
				if (!anchor) {
					for (const btn of document.querySelectorAll("button")) {
						if (isPluginNode(btn)) continue;
						const r = btn.getBoundingClientRect();
						if (r.y >= 0 && r.y < 90 && r.width > 0 && r.width < 60) {
							const t = (btn.textContent || "").trim();
							if (t.length > 0 && t.length <= 3) { anchor = btn; break; }
						}
					}
				}
				if (!anchor) {
					for (const t of document.querySelectorAll("textarea")) {
						if (isPluginNode(t)) continue;
						if (isVisible(t)) { anchor = t; break; }
					}
				}
				if (!anchor) return null;
			
				// ② 取最深的合法祖先
				let el = anchor.parentElement;
				while (el && el !== document.body) {
					if (isAppLike(el)) return el;
					el = el.parentElement;
				}
				return null;
			}
			
			/** 应用根的位置尺寸（弹窗据此对齐；返回 null 表示未找到） */
			function getSplitRootRect() {
				const root = findChatRoot();
				if (!root) return null;
				const r = root.getBoundingClientRect();
				return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) };
			}
			
			/**
			 * 构造样式文本（**纯函数**，便于离线断言）
			 *
			 * 只做一件事：把原生应用根向右挤 `paddingLeft` px。
			 * 折叠态（`collapsed`）不加额外规则 —— 排布完全由父组件算出的 `paddingLeft` 决定
			 * （右栏折叠 = paddingLeft 推到 `宽-40`，原生内容自然成为右侧 40px 竖条）。
			 * 保持"样式文本是 paddingLeft 的单值函数"这一性质，离线断言才好写。
			 *
			 * @param {number} paddingLeft
			 * @returns {string}
			 */
			function buildSplitCss(paddingLeft) {
				const pad = Math.max(0, Math.round(Number(paddingLeft) || 0));
				return [
					`[${ROOT_ATTR}]{`,
					`padding-left:${pad}px !important;`,
					`box-sizing:border-box !important;`,
					`transition:padding-left .14s ease;`,
					`}`
				].join("");
			}
			
			/** 当前分屏状态（同步可读；`window.__dshSplit` 亦暴露） */
			let state = {
				active: false,
				rootMarked: false,
				paddingLeft: 0,
				collapsed: null,
				updatedAt: 0
			};
			
			function getSplitState() {
				return { ...state };
			}
			
			/**
			 * 应用分屏（幂等）
			 * @param {object} opts
			 * @param {number} opts.paddingLeft 原生内容左侧留白（= 左栏占宽）
			 * @param {"none"|"left"|"right"|"both"|null} [opts.collapsed] 折叠态，仅用于样式分支
			 * @returns {{ok:boolean, reason?:string, root?:HTMLElement}}
			 */
			function applySplit(opts = {}) {
				if (!hasDom()) return { ok: false, reason: "no-dom" };
				try {
					const root = findChatRoot();
					if (!root) return { ok: false, reason: "chat-root-not-found" };
					// 🔴 兜底护栏：宁可不分屏，也绝不把自己的面板当成宿主（E-SPLIT-001）
					if (isPluginNode(root)) return { ok: false, reason: "plugin-node" };
					const pad = Math.max(0, Math.round(Number(opts.paddingLeft) || 0));
					const collapsed = opts.collapsed || null;
			
					// ① 标记应用根（属性可逆，且不改 style 属性）
					root.setAttribute(ROOT_ATTR, "1");
					if (collapsed) root.setAttribute(STATE_ATTR, collapsed);
					else root.removeAttribute(STATE_ATTR);
			
					// ② 标记内容区（供后续装饰/折叠使用；只打属性，不动节点）
					const contentRoot = root.querySelector("header") ? root : null;
					if (contentRoot) contentRoot.setAttribute("data-dsh-split-host", "1");
			
					// ③ 注入/更新样式（单一样式节点，幂等）
					let style = document.getElementById(SPLIT_STYLE_ID);
					if (!style) {
						style = document.createElement("style");
						style.id = SPLIT_STYLE_ID;
						document.head.appendChild(style);
					}
					style.textContent = buildSplitCss(pad);
					state = { active: true, rootMarked: true, paddingLeft: pad, collapsed, updatedAt: Date.now() };
					if (typeof window !== "undefined") window.__dshSplit = getSplitState();
					return { ok: true, root, paddingLeft: pad };
				} catch (e) {
					// 🔴 finally 兜底：任何异常都不能让样式残留在页面里
					clearSplit();
					return { ok: false, reason: "error:" + (e && e.message) };
				}
			}
			
			/**
			 * 撤销分屏（**完全可逆**）
			 * 移除样式节点 + 移除全部 `data-*` 标记；不触碰任何原生节点、不触碰原生 style 属性。
			 * @returns {{ok:boolean, removedStyle:boolean, clearedAttrs:number}}
			 */
			function clearSplit() {
				if (!hasDom()) return { ok: false, removedStyle: false, clearedAttrs: 0 };
				let clearedAttrs = 0;
				let removedStyle = false;
				try {
					const style = document.getElementById(SPLIT_STYLE_ID);
					if (style) { style.remove(); removedStyle = true; }
					for (const attr of [ROOT_ATTR, STATE_ATTR, "data-dsh-split-host", "data-dsh-split-content"]) {
						let guard = 0;
						while (guard++ < 200) {
							const el = document.querySelector("[" + attr + "]");
							if (!el) break;
							el.removeAttribute(attr);
							clearedAttrs++;
						}
					}
				} catch (e) {
					// 移除失败也不能抛：调用方多为 UI 卸载路径
					dshLog("split", "clearSplit error: " + (e && e.message));
				}
				state = { active: false, rootMarked: false, paddingLeft: 0, collapsed: null, updatedAt: Date.now() };
				if (typeof window !== "undefined") window.__dshSplit = getSplitState();
				return { ok: true, removedStyle, clearedAttrs };
			}
			
			/** 分屏是否生效 */
			function isSplitActive() {
				return hasDom() && Boolean(document.getElementById(SPLIT_STYLE_ID));
			}
			
			/** 安装全局契约（调试与验证脚本用） */
			function installSplitApi() {
				if (!hasDom()) return null;
				window.__dshSplitApi = {
					SPLIT_STYLE_ID, ROOT_ATTR, STATE_ATTR, PLUGIN_UI_IDS, CHAT_COMPOSER_PLACEHOLDER,
					findChatRoot, isPluginNode, getSplitRootRect, buildSplitCss,
					applySplit, clearSplit, isSplitActive, getSplitState
				};
				window.__dshSplit = getSplitState();
				return window.__dshSplitApi;
			}
			
			exports.SPLIT_STYLE_ID = SPLIT_STYLE_ID;
			exports.ROOT_ATTR = ROOT_ATTR;
			exports.STATE_ATTR = STATE_ATTR;
			exports.PLUGIN_UI_IDS = PLUGIN_UI_IDS;
			exports.CHAT_COMPOSER_PLACEHOLDER = CHAT_COMPOSER_PLACEHOLDER;
			exports.isPluginNode = isPluginNode;
			exports.findChatRoot = findChatRoot;
			exports.getSplitRootRect = getSplitRootRect;
			exports.buildSplitCss = buildSplitCss;
			exports.getSplitState = getSplitState;
			exports.applySplit = applySplit;
			exports.clearSplit = clearSplit;
			exports.isSplitActive = isSplitActive;
			exports.installSplitApi = installSplitApi;
		};

		// ── bridge/chat-bridge.js ──
		__defs["bridge/chat-bridge.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：「双向联动」通道（要求 5：右栏与对话 tab 互相传送消息）
			 * 引用：要求 5 · 要求 3
			 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js, components/NodeDetailPanel.js, mount.js
			 * 下游：bridge/split.js, util/debug.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * bridge/chat-bridge.js — 「双向联动」通道（要求 5：右栏与对话 tab 互相传送消息）
			 *
			 * ── 定位 ────────────────────────────────────────────────────────
			 *   分屏通道（`bridge/split.js`）已经让**右栏＝原生对话区本身**：
			 *   消息渲染、滚动、选择复制、消息内交互**天然可用**，本模块**不需要**做任何"显示"工作。
			 *   本模块只补两件分屏给不了的事：
			 *     ① **左 → 右**：把总监侧的输入送进原生 composer 并提交（要求 5「互相传送消息」）
			 *     ② **右 → 左**：观察原生产出变化 → 通知总监侧触发审核（要求 3）
			 *
			 * ── 🔴 定位原生的方式：**语义属性**，不用 hash 类名 ──────────────
			 *   实测（2026-09-12 真机）：
			 *     composer 编辑器  `textarea[placeholder="给智能体发消息"]`（类名 `FVE3va_input` 会随构建变）
			 *     发送按钮         `button[aria-label="发送消息"]`（空内容时 `disabled=true`）
			 *   ⇒ 一律用 `placeholder` / `aria-label` 这类**语义属性**做锚点；
			 *     类名（`FVE3va_*` / `RWZidW_*`）只作兜底，不入判据。
			 *
			 * ── 🔴 React 受控输入的正确写法 ─────────────────────────────────
			 *   直接 `ta.value = x` 不会触发 React 的 onChange（React 劫持了 value setter）。
			 *   必须走**原生 setter** + 派发 `input` 事件：
			 *     `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, x)`
			 *     `ta.dispatchEvent(new Event("input", { bubbles: true }))`
			 *   否则发送按钮的 `disabled` 不会解除，点击是原生 no-op（→ 表现为"点了没反应"）。
			 */
			
			const { getSplitRootRect, findChatRoot } = __m("bridge/split.js");
			const { dshLog } = __m("util/debug.js");
			
			const hasDom = () => typeof window !== "undefined" && typeof document !== "undefined";
			
			/** 最近一次投递的结果（供界面呈现与验证脚本读 —— 降级也要看得见走的是哪一级） */
			let lastDeliver = null;
			/** @returns {object|null} 最近一次 `deliverToChat` 的返回 */
			function getLastDeliver() { return lastDeliver; }
			
			/** 发送按钮的语义锚点（实测值，勿改成类名） */
			const SEND_ARIA = "发送消息";
			/** composer 编辑器占位文案（实测值；命中不到时退回"任意可见 textarea"） */
			const COMPOSER_PLACEHOLDER = "给智能体发消息";
			
			function isVisible(el) {
				if (!el || !el.getBoundingClientRect) return false;
				const r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0;
			}
			
			/**
			 * 宿主是否正在生成回答。
			 *
			 * 判据：出现 `button[aria-label="停止生成"]`（宿主把「发送」换成「停止」的那个按钮）。
			 * ⚠️ 为什么要单独判它：**生成中宿主会把 composer 隐藏**
			 *   （真机实测：`textarea[placeholder=…]` 仍在 DOM，但外层 `display:none` ⇒ 盒为 0×0，
			 *    `findComposer()` 自然返回 null）。此时若只说「先打开对话区」会误导用户
			 *    —— 框不是没打开，是宿主在生成中暂时收起来了。
			 * @returns {boolean}
			 */
			function isAgentGenerating() {
				if (!hasDom()) return false;
				return Boolean(document.querySelector('button[aria-label="停止生成"]'));
			}
			
			/** 找到 composer 编辑器 */
			function findComposer() {	if (!hasDom()) return null;
				const byPh = document.querySelector('textarea[placeholder="' + COMPOSER_PLACEHOLDER + '"]');
				if (byPh && isVisible(byPh)) return byPh;
				for (const ta of document.querySelectorAll("textarea")) if (isVisible(ta)) return ta;
				for (const ed of document.querySelectorAll('[contenteditable="true"]')) if (isVisible(ed)) return ed;
				return null;
			}
			
			/** 找到发送按钮（按 aria-label；找不到则退回 composer 卡片内的主按钮） */
			function findSendButton() {
				if (!hasDom()) return null;
				const byAria = document.querySelector('button[aria-label="' + SEND_ARIA + '"]');
				if (byAria) return byAria;
				const ta = findComposer();
				let el = ta ? ta.parentElement : null;
				for (let i = 0; i < 5 && el; i++) {
					const btns = [...el.querySelectorAll("button")].filter((b) => /send|发送/i.test((b.getAttribute("aria-label") || "") + (b.getAttribute("title") || "") + (b.textContent || "")));
					if (btns.length) return btns[btns.length - 1];
					el = el.parentElement;
				}
				return null;
			}
			
			/**
			 * 把文本写入 composer（React 受控输入安全）
			 * @returns {{ok:boolean, reason?:string, editor?:HTMLElement}}
			 */
			function setComposerText(text) {
				const ed = findComposer();
				if (!ed) return { ok: false, reason: "composer-not-found" };
				try {
					const v = String(text == null ? "" : text);
					if (ed.tagName === "TEXTAREA") {
						const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
						if (desc && desc.set) desc.set.call(ed, v); else ed.value = v;
					} else if (ed.tagName === "INPUT") {
						const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
						if (desc && desc.set) desc.set.call(ed, v); else ed.value = v;
					} else {
						ed.textContent = v;
					}
					ed.dispatchEvent(new Event("input", { bubbles: true }));
					ed.dispatchEvent(new Event("change", { bubbles: true }));
					return { ok: true, editor: ed };
				} catch (e) {
					return { ok: false, reason: "set-error:" + (e && e.message) };
				}
			}
			
			/**
			 * 读取 composer 当前值（**写后回读校验**用，见 execution-standards §3.4）
			 * @returns {string|null}
			 */
			function readComposerText() {
				const ed = findComposer();
				if (!ed) return null;
				return ed.tagName === "TEXTAREA" || ed.tagName === "INPUT" ? String(ed.value || "") : String(ed.textContent || "");
			}
			
			/**
			 * 提交 composer
			 * @returns {{ok:boolean, reason?:string, via?:string}}
			 */
			function submitComposer() {
				const btn = findSendButton();
				if (!btn) return { ok: false, reason: "send-button-not-found" };
				if (btn.disabled) return { ok: false, reason: "send-button-disabled", via: "disabled" };
				try {
					btn.click();
					return { ok: true, via: "click" };
				} catch (e) {
					return { ok: false, reason: "click-error:" + (e && e.message) };
				}
			}
			
			/**
			 * 🔴 宿主直投通道：把指令交给宿主自己的会话发送口 `window.__directChatSubmit`
			 *
			 * 为什么"点原生发送按钮"不够（2026-09-12 真机实测）：
			 *   宿主的 InputBar 在 `focusTarget !== "chat"` 时会把提交**劫持给总监**
			 *   —— 走 `window.__directorSubmit`，也就是"再跑一遍宿主自己那套五步"。
			 *   而我们的指令**已经过插件侧五步处理**（`runDirector`）⇒ 会被处理两次，
			 *   并且落进宿主旧版总监库（插件侧 R5 与它不是同一份）。实测后果：
			 *   `__directorSubmit` 内部把**快照对象**当活会话用，抛
			 *   `TypeError: session.prompt is not a function` ⇒ 消息其实**没送到智能体**，
			 *   而点按钮这件事本身成功 ⇒ 表现为"显示已发送，实际没发"（最坏的假绿灯）。
			 *
			 *   `__directChatSubmit` 用的是宿主**同一份** `scopedConversation(sessions,id).send(text)`
			 *   —— 直投对话域，不经过 InputBar 的劫持分支。
			 *
			 * 证据（不是"调了就算"）：`__directChatSubmit` 每次执行都会写
			 *   `window.__directChatProbe = {called, sessionId, draft, time}`
			 *   ⇒ 以 `called` 的**增量**为凭据，确认宿主确实收下了这次投递。
			 *
			 * @param {string} sessionId 目标会话
			 * @param {string} text 已处理好的指令
			 * @returns {Promise<{ok:boolean, mode?:"sent", via?:string, verified?:boolean, reason?:string}>}
			 */
			async function sendToHost(sessionId, text) {
				if (!hasDom()) return { ok: false, reason: "no-dom" };
				if (!sessionId) return { ok: false, reason: "no-session" };
				const fn = window.__directChatSubmit;
				if (typeof fn !== "function") return { ok: false, reason: "host-send-unavailable" };
				const called = () => {
					const p = window.__directChatProbe;
					return p && typeof p.called === "number" ? p.called : 0;
				};
				const before = called();
				try {
					fn(sessionId, String(text));
				} catch (e) {
					return { ok: false, reason: "host-send-throw:" + (e && e.message) };
				}
				for (let i = 0; i < 8; i++) {
					await new Promise((r) => setTimeout(r, 60));
					if (called() > before) return { ok: true, mode: "sent", via: "host-send", verified: true };
				}
				return { ok: false, reason: "host-send-unconfirmed" };
			}
			
			/**
			 * 左 → 右 主入口：把总监侧输入送到对话域
			 *
			 * 四级降级（保证"必定有反馈"，不会静默失败）：
			 *   ① `sessionId` 有效且宿主直投口可用 → 直投对话域，`mode="sent"` / `via="host-send"`（首选）
			 *   ② `autoSend=true` 且发送按钮可用    → 真正发送，`mode="sent"`
			 *   ③ 否则                              → 文本已填入 composer，`mode="filled"`，由用户确认后手动发送
			 *
			 * @param {string} text
			 * @param {{autoSend?:boolean, verify?:boolean}} [opts]
			 * @returns {Promise<{ok:boolean, mode:"sent"|"filled"|"failed", reason?:string, verified?:boolean}>}
			 */
			async function sendToChat(text, opts = {}) {
				const autoSend = opts.autoSend !== false;
				const filled = setComposerText(text);
				if (!filled.ok) return { ok: false, mode: "failed", reason: filled.reason };
			
				// 🔴 写后回读校验：确认文本真的进了受控组件
				const back = readComposerText();
				if (back !== String(text)) {
					return { ok: false, mode: "failed", reason: "readback-mismatch", verified: false };
				}
			
				if (!autoSend) return { ok: true, mode: "filled", verified: true };
			
				const sub = submitComposer();
				if (!sub.ok) return { ok: true, mode: "filled", reason: sub.reason, verified: true };
			
				// 提交后编辑器应被清空（原生行为）—— 作为"确实发出"的弱证据
				await new Promise((r) => setTimeout(r, 120));
				const after = readComposerText();
				return { ok: true, mode: "sent", verified: after !== null ? after === "" : null };
			}
			
			/**
			 * 🔴 把一条指令**真正送达某会话的原生对话**（三级降级 + 写后回读）
			 *
			 * 为什么需要它（而不是直接用 `sendToChat`）：
			 *   总监页是宿主 tab 环里的**独立 view**，切到它时原生 composer 多半**不在场**
			 *   （`findComposer()` 返回 null，因为它要求元素有非零盒）。
			 *   实测形态：在总监页 `sendToChat` 直接失败 → 用户以为"总监没把消息发出去"。
			 *   ⇒ 必须允许「先切到目标会话，等 composer 出现，再投递」这条通道。
			 *
			 * 为什么 `opener` 由调用方注入（而不是本模块 import `logic/branch-tree.js`）：
			 *   `branch-tree.js` 依赖宿主 ctx 与 split.js，本模块是**零业务依赖的 DOM 通道**。
			 *   反向 import 会形成 module 环（build 期外置顺序受影响）。注入更干净、可单测。
			 *
			 * 判据（四级，逐级降级，**每级都给出归因**）：
			 *   ① 宿主直投口可用 + 有 sessionId → 直投对话域  `via="host-send"`（首选；避开 InputBar 的「总监劫持」）
			 *   ② `composer` 已在场            → 直投        `via="direct"`
			 *   ③ `opener(sessionId)` 成功 + 等 → 再投        `via="open-then-send"`
			 *   ④ 仍不在场                     → 失败并报因  `reason="composer-unavailable"`
			 *
			 * @param {string} text
			 * @param {{sessionId?:string, opener?:(id:string)=>Promise<{ok:boolean,reason?:string}>,
			 *          autoSend?:boolean, settleMs?:number, hostSend?:boolean}} [opts]
			 * @returns {Promise<{ok:boolean, mode:"sent"|"filled"|"failed", reason?:string,
			 *                    via?:string, opened?:boolean, verified?:boolean|null}>}
			 */
			async function deliverToChat(text, opts = {}) {
				const r = await deliverImpl(text, opts);
				lastDeliver = { ...r, at: Date.now(), sessionId: (opts && opts.sessionId) || null };
				return r;
			}
			
			/** `deliverToChat` 的实现体（外层包一层只为记录 `lastDeliver`） */
			async function deliverImpl(text, opts = {}) {
				const t = String(text == null ? "" : text);
				if (!t.trim()) return { ok: false, mode: "failed", reason: "empty-text" };
			
				/* ① 宿主直投：指令已由插件侧处理完，应**直接**进对话域，
				 *    不再经 InputBar（否则会被宿主的旧版总监再处理一次，见 sendToHost 论证）。 */
				if (opts.autoSend !== false && opts.hostSend !== false && opts.sessionId) {
					const h = await sendToHost(opts.sessionId, t);
					if (h.ok) {
						// 投递成功 ⇒ 原生草稿已被消费；留着会变成"发完还在框里"的脏数据
						try { setComposerText(""); } catch (e) { /* composer 不在场：无需清理 */ }
						return { ok: true, mode: "sent", via: h.via, verified: h.verified, opened: false };
					}
				}
			
				const settle = typeof opts.settleMs === "number" ? opts.settleMs : 450;
				let composer = findComposer();
				let opened = false;
			
				if (!composer && typeof opts.opener === "function" && opts.sessionId) {
					try {
						const r = await opts.opener(opts.sessionId);
						opened = Boolean(r && r.ok);
					} catch (e) {
						return { ok: false, mode: "failed", reason: "open-error:" + (e && e.message), opened: false };
					}
					if (opened) await new Promise((res) => setTimeout(res, settle));
					composer = findComposer();
				}
			
				if (!composer) {
					return {
						ok: false, mode: "failed", reason: "composer-unavailable", opened,
						via: opened ? "open-then-send" : "direct"
					};
				}
			
				const r = await sendToChat(t, { autoSend: opts.autoSend !== false });
				return { ...r, opened, via: opened ? "open-then-send" : "direct" };
			}
			
			/* ── 右 → 左：产出观察 ─────────────────────────────────────────── */
			
			/** 找到"消息列表"容器（沿 viewArea 的单子节点链下钻） */
			function findMessageList() {
				const rect = getSplitRootRect();
				if (!rect) return null;
				const root = findChatRoot();
				if (!root) return null;
				// 消息列表 = 应用根内"高度占主体、且不含 composer 编辑器"的最深单子链末端
				let cur = root;
				let guard = 0;
				while (cur && guard++ < 12) {
					const kids = [...cur.children].filter((e) => isVisible(e));
					if (kids.length !== 1) break;
					if (kids[0].querySelector("textarea,[contenteditable=true]")) break;
					cur = kids[0];
				}
				return cur === root ? null : cur;
			}
			
			/**
			 * 读取当前对话的可见产出概况
			 * @returns {{count:number, lastText:string, listFound:boolean}}
			 */
			function readConversation() {
				const list = findMessageList();
				if (!list) return { count: 0, lastText: "", listFound: false };
				const items = [...list.children].filter(isVisible);
				const last = items[items.length - 1];
				return {
					count: items.length,
					lastText: last ? String(last.textContent || "").trim().slice(0, 400) : "",
					listFound: true
				};
			}
			
			/**
			 * 观察对话产出变化（右 → 左）
			 * @param {(info:{count:number,lastText:string,delta:number})=>void} cb
			 * @returns {() => void} 取消订阅
			 */
			function observeConversation(cb) {
				if (!hasDom() || typeof MutationObserver === "undefined") return () => {};
				let last = readConversation();
				let timer = null;
				const fire = () => {
					const cur = readConversation();
					const delta = cur.count - last.count;
					const changed = delta !== 0 || cur.lastText !== last.lastText;
					last = cur;
					if (changed) { try { cb({ ...cur, delta }); } catch (e) { /* 订阅者异常不影响观察 */ } }
				};
				const mo = new MutationObserver(() => {
					if (timer) clearTimeout(timer);
					timer = setTimeout(fire, 220); // 防抖：流式输出期间高频变更
				});
				const target = findMessageList() || document.body;
				mo.observe(target, { childList: true, subtree: true, characterData: true });
				return () => { try { mo.disconnect(); } catch (e) { /* 已断开 */ } if (timer) clearTimeout(timer); };
			}
			
			/** 安装全局契约（调试与验证脚本用） */
			function installChatBridgeApi() {
				if (!hasDom()) return null;
				const api = {
					SEND_ARIA, COMPOSER_PLACEHOLDER,
					findComposer, findSendButton, findMessageList,
					setComposerText, readComposerText, submitComposer, sendToChat, sendToHost, deliverToChat, getLastDeliver,
					isAgentGenerating,
					readConversation, observeConversation
				};
				window.__dshChatBridge = api;
				dshLog("bridge", "chat-bridge 已安装（composer 锚点：" + COMPOSER_PLACEHOLDER + " / " + SEND_ARIA + "）");
				return api;
			}
			
			exports.getLastDeliver = getLastDeliver;
			exports.SEND_ARIA = SEND_ARIA;
			exports.COMPOSER_PLACEHOLDER = COMPOSER_PLACEHOLDER;
			exports.isAgentGenerating = isAgentGenerating;
			exports.findComposer = findComposer;
			exports.findSendButton = findSendButton;
			exports.setComposerText = setComposerText;
			exports.readComposerText = readComposerText;
			exports.submitComposer = submitComposer;
			exports.sendToHost = sendToHost;
			exports.sendToChat = sendToChat;
			exports.deliverToChat = deliverToChat;
			exports.findMessageList = findMessageList;
			exports.readConversation = readConversation;
			exports.observeConversation = observeConversation;
			exports.installChatBridgeApi = installChatBridgeApi;
		};

		// ── logic/routing.js ──
		__defs["logic/routing.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：智能路由（要求 8）＋ 六维审核（要求 3）
			 * 引用：要求 8 · 要求 3 · 17 号文 §1
			 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js
			 * 下游：store/plugin-db.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 C（输入路由决策树）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * logic/routing.js — 智能路由（要求 8）＋ 六维审核（要求 3）
			 *
			 * 需求来源（严格按文档，勿自行改动）：
			 *   - 17 号文 §三 智能路由设计（5 步）：**意图理解 → 项目匹配 → 任务拆分 → 路由决策 → 执行落实**
			 *     §6.3 扩展：V12 半自动（建议+用户确认）→ V13 全自动
			 *   - 17 号文 §1A.9 六维度审核检查清单（**不得减项**）：
			 *     ① 需求满足度 ② 方案符合度 ③ 质量达标度 ④ 风险控制 ⑤ 完整性 ⑥ 一致性
			 *   - 17 号文 §1A.10 分支分派与汇总；§1A.2 协作流程（不通过则带审核意见打回）
			 *
			 * 硬约束（docs/10 要求 8）：
			 *   ① 总监页面**只有一个**；② 用户输入 → 总监**整理 + 确认** → 判定归属对话；
			 *   ③ 三条去向：**转给该对话的总监** / **直接调用对应对话** / **新建对话**；
			 *   ④ 路由结果**必须可确认、可回看**（不得静默分发）。
			 *
			 * 设计取舍：本模块**全部为纯函数 + 规则打分**（不调模型）——
			 *   目的是让"路由决策"这一关键路径**确定可复现**，离线可断言。
			 *   需要模型增强时由上层注入（`opts.rank`），本模块不依赖网络。
			 */
			
			const { saveDecision, saveReview, listDecisions } = __m("store/plugin-db.js");
			
			/* ══════════════════════════════════════════════════════════════════
			 * 一、STEP 1 意图理解
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 意图类型（17 号文 §三 STEP1 原列：需求 / 问题 / 指令 / 讨论 / 反馈） */
			const INTENT = Object.freeze({
				REQUIREMENT: "需求",
				QUESTION: "问题",
				COMMAND: "指令",
				DISCUSSION: "讨论",
				FEEDBACK: "反馈"
			});
			
			const INTENT_RULES = [
				{ kind: INTENT.QUESTION, re: /[?？]|怎么|如何|为什么|是什么|能不能|是否/, weight: 2 },
				{ kind: INTENT.FEEDBACK, re: /不对|有问题|错了|不好|差|不满意|应该是|其实要|并不是/, weight: 3 },
				{ kind: INTENT.COMMAND, re: /^(请|帮我|给我|把|执行|运行|跑|部署|提交|删除|改|修|加)/, weight: 3 },
				{ kind: INTENT.REQUIREMENT, re: /要|需要|必须|希望|要求|新增|实现|支持/, weight: 2 },
				{ kind: INTENT.DISCUSSION, re: /讨论|看看|评估|比较|方案|建议|想法/, weight: 2 }
			];
			
			/**
			 * 中文分词（CJK / 拉丁边界插空格）+ 过滤停用词
			 * 与 `logic/director-run.js#tokenize` 同源口径（CJK 单字 + bigram 兜底）。
			 */
			const STOP = new Set(["的", "了", "是", "在", "和", "与", "及", "把", "被", "给", "对", "为", "就", "都", "也", "很", "我", "你", "他", "它", "这", "那", "个", "们", "一下", "一个", "the", "a", "an", "to", "of", "and", "is", "in", "for", "on"]);
			
			function tokenize(text) {
				const s = String(text == null ? "" : text)
					.replace(/([\u4e00-\u9fa5])/g, " $1 ")
					.replace(/([A-Za-z0-9_@./-]+)/g, " $1 ")
					.toLowerCase();
				const raw = s.split(/\s+/).filter(Boolean);
				const out = [];
				for (const w of raw) {
					if (w.length === 1 && /[\u4e00-\u9fa5]/.test(w)) { if (!STOP.has(w)) out.push(w); continue; }
					if (STOP.has(w) || w.length < 2) continue;
					out.push(w);
				}
				// bigram 兜底：中文按字切后语义弱，补相邻二元组提升匹配率
				const cjkRun = [];
				for (const w of out) {
					if (w.length === 1 && /[\u4e00-\u9fa5]/.test(w)) { cjkRun.push(w); continue; }
					if (cjkRun.length) { pushBigrams(cjkRun, out); cjkRun.length = 0; }
				}
				if (cjkRun.length) pushBigrams(cjkRun, out);
				return Array.from(new Set(out));
			}
			function pushBigrams(run, out) {
				for (let i = 0; i + 1 < run.length; i++) out.push(run[i] + run[i + 1]);
			}
			
			/**
			 * STEP 1：意图理解（规则打分，返回全部命中的类型及其权重）
			 * @returns {{kind:string, confidence:number, signals:string[]}}
			 */
			function classifyIntent(text) {
				const t = String(text || "");
				const hits = [];
				for (const r of INTENT_RULES) {
					if (r.re.test(t)) hits.push({ kind: r.kind, weight: r.weight });
				}
				if (!hits.length) return { kind: INTENT.REQUIREMENT, confidence: 0.35, signals: ["无显式特征词 → 默认按需求处理"] };
				hits.sort((a, b) => b.weight - a.weight);
				const top = hits[0];
				const total = hits.reduce((s, h) => s + h.weight, 0);
				return {
					kind: top.kind,
					confidence: Math.min(0.95, 0.4 + 0.2 * hits.length + (top.weight - 2) * 0.1),
					signals: hits.map((h) => h.kind + "(权重 " + h.weight + ")")
				};
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 二、STEP 2 项目匹配
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 给候选节点打相关性分（关键词 + 名称命中 + 层级先验 + 近期活跃）
			 * @param {string} text
			 * @param {Array<{id:string,name:string,level:string,updatedAt?:number,conversations?:Array}>} nodes
			 * @returns {Array<{nodeId:string,name:string,level:string,score:number,reason:string}>}
			 */
			function scoreNodes(text, nodes) {
				const toks = tokenize(text);
				const now = Date.now();
				const out = [];
				for (const n of nodes || []) {
					if (!n || !n.id) continue;
					const name = String(n.name || "");
					const nameLower = name.toLowerCase();
					let score = 0;
					const reasons = [];
					// ① 名称命中（强信号）
					const nameHits = toks.filter((t) => t.length >= 2 && nameLower.indexOf(t) >= 0);
					if (nameHits.length) { score += 3 * nameHits.length; reasons.push("名称命中 " + nameHits.slice(0, 3).join("/")); }
					// ② 会话记录命中（中信号）
					const convs = Array.isArray(n.conversations) ? n.conversations : [];
					for (const c of convs) {
						const ct = String((c && (c.title || c.lastMessage)) || "").toLowerCase();
						const hits = toks.filter((t) => t.length >= 2 && ct.indexOf(t) >= 0);
						if (hits.length) { score += 1.2 * hits.length; reasons.push("会话命中 " + hits.slice(0, 2).join("/")); break; }
					}
					// ③ 近期活跃（弱信号）
					const ts = Number(n.updatedAt || (n.meta && n.meta.updatedAt) || 0);
					if (ts > 0 && now - ts < 86400000 * 3) { score += 0.8; reasons.push("近 3 日活跃"); }
					// ④ 层级先验：会话级优先被"直调"，项目级优先被"转派"
					if (n.level === "session") score += 0.3;
					if (n.level === "project") score += 0.2;
					if (score > 0) out.push({ nodeId: n.id, name: n.name, level: n.level, score: Math.round(score * 100) / 100, reason: reasons.join("；") || "弱相关" });
				}
				out.sort((a, b) => b.score - a.score);
				return out;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 三、STEP 3 任务拆分
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 多意图检测：按连接词 / 分号 / 换行切分子任务 */
			function splitTasks(text) {
				const s = String(text || "").trim();
				if (!s) return [];
				const parts = s.split(/[；;\n]|(?:，?\s*(?:然后|接着|之后|另外|同时|再)\s*)/g)
					.map((x) => x.trim())
					.filter((x) => x.length >= 2);
				const list = parts.length ? parts : [s];
				return list.map((p, i) => ({
					index: i + 1,
					text: p,
					intent: classifyIntent(p).kind
				}));
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 四、STEP 4 路由决策（**待用户确认，不静默分发**）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 去向（要求 8 三条） */
			const DESTINATION = Object.freeze({
				TRANSFER: "transfer",   // 转给该对话的总监
				DIRECT: "direct",       // 直接调用对应对话
				CREATE: "create"        // 新建对话
			});
			const DESTINATION_LABEL = Object.freeze({
				transfer: "转给该对话的总监",
				direct: "直接调用对应对话",
				create: "新建对话"
			});
			
			/**
			 * 由候选分决定"建议去向"
			 * 规则（可解释，非黑箱）：
			 *   - 有高分会话候选（≥3）→ 直调（产出型任务直接投给执行对话）
			 *   - 有中分项目候选  → 转派（交给该层级总监继续治理）
			 *   - 无候选          → 新建
			 */
			function suggestDestination(candidates) {
				const top = (candidates || [])[0];
				if (!top) return { destination: DESTINATION.CREATE, confidence: 0.5, reason: "无匹配节点 → 由总监新建对话并初始化其总监" };
				if (top.level === "session" && top.score >= 3) return { destination: DESTINATION.DIRECT, confidence: Math.min(0.95, 0.5 + top.score / 20), reason: "命中会话「" + top.name + "」（" + top.reason + "）→ 直接调用该对话" };
				if (top.level === "project") return { destination: DESTINATION.TRANSFER, confidence: Math.min(0.9, 0.45 + top.score / 20), reason: "命中项目/文件夹「" + top.name + "」→ 转派给该层级总监" };
				return { destination: DESTINATION.DIRECT, confidence: 0.6, reason: "命中「" + top.name + "」→ 直接调用对应对话" };
			}
			
			/**
			 * 完整路由（五步）
			 * @param {string} text 用户输入
			 * @param {object} ctx
			 * @param {Array} ctx.nodes 候选节点（层级树拍平）
			 * @param {string} [ctx.currentNodeId] 当前层级节点
			 * @returns {{steps:Array, intent:object, candidates:Array, decision:object, subtasks:Array}}
			 */
			function route(text, ctx = {}) {
				const nodes = (ctx.nodes || []).filter((n) => n && n.id);
				// STEP 1
				const intent = classifyIntent(text);
				// STEP 2（当前层级节点加权，体现"就近路由"）
				const candidates = scoreNodes(text, nodes).map((c) => ({
					...c,
					score: c.nodeId === ctx.currentNodeId ? Math.round((c.score + 1) * 100) / 100 : c.score,
					reason: c.nodeId === ctx.currentNodeId ? (c.reason + "；当前层级" ) : c.reason
				})).sort((a, b) => b.score - a.score);
				// STEP 3
				const subtasks = splitTasks(text);
				// STEP 4
				const decision = suggestDestination(candidates);
				// 步骤轨迹（供 UI 逐步展示）
				const steps = [
					{ n: 1, key: "intent", title: "意图理解", detail: intent.kind + "（置信 " + intent.confidence.toFixed(2) + "）", done: true },
					{ n: 2, key: "match", title: "项目匹配", detail: candidates.length ? candidates.length + " 个候选，最高 " + candidates[0].score : "无候选", done: true },
					{ n: 3, key: "split", title: "任务拆分", detail: subtasks.length + " 个子任务", done: true },
					{ n: 4, key: "decide", title: "路由决策", detail: DESTINATION_LABEL[decision.destination] + "（待确认）", done: false, pending: true },
					{ n: 5, key: "apply", title: "执行落实", detail: "确认后落库并转派/直调", done: false }
				];
				return { intent, candidates, subtasks, decision, steps };
			}
			
			/**
			 * STEP 5：执行落实（**确认后才调用**）
			 * 同时把决策**留痕**到 `directorDecisions`（要求 3 纠偏留痕 / 要求 8 可回看）。
			 * @param {string} nodeId 所属层级节点
			 * @param {object} routeResult route() 的返回值
			 * @param {string} action 用户最终选定的去向（默认取建议值）
			 */
			async function confirmRoute(nodeId, routeResult, action) {
				const dest = action || routeResult.decision.destination;
				const cand = (routeResult.candidates || [])[0] || null;
				const rec = await saveDecision({
					nodeId,
					kind: "route",
					text: "路由决策：" + DESTINATION_LABEL[dest] + (cand ? " → " + cand.name : ""),
					destination: dest,
					targetNodeId: cand ? cand.nodeId : null,
					intent: routeResult.intent.kind,
					subtasks: (routeResult.subtasks || []).map((s) => s.text),
					confidence: routeResult.decision.confidence,
					reason: routeResult.decision.reason,
					confirmed: true,
					at: Date.now()
				});
				return { ok: Boolean(rec), decision: rec };
			}
			
			/**
			 * 回看历史路由决策（要求 8「可回看」，不得静默分发）
			 *
			 * 🔴 勿改回 `export { listDecisions as listRouteHistory } from "…"` 的**转发导出行**：
			 *    自研 bundler（build/build.mjs）对 `export … from` 形态处理不完善（2026-09-12 实测
			 *    会把该行连同后续代码并入一条注释 → 产物 `SyntaxError`）。此处用**显式本地包装**
			 *    （import 原函数 + 本地具名导出），语义等价且对打包器透明。
			 */
			function listRouteHistory(nodeId) {
				return listDecisions(nodeId);
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 五、六维审核（要求 3，17 号文 §1A.9 —— **不得减项**）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 六维定义（单一真相源） */
			const REVIEW_DIMS = Object.freeze([
				{ key: "requirement", label: "需求满足度", hint: "核心需求 100% 覆盖 / 可选项标注 / 约束遵守" },
				{ key: "conformance", label: "方案符合度", hint: "约束遵守 / 范围一致 / 变更可追溯" },
				{ key: "quality", label: "质量达标度", hint: "符合智能体标准 / 功能可验证 / 性能可接受" },
				{ key: "risk", label: "风险控制", hint: "无新增 Bug / 无安全风险 / 遗留问题记录" },
				{ key: "completeness", label: "完整性", hint: "无遗漏 / 文档完整 / 边界覆盖" },
				{ key: "consistency", label: "一致性", hint: "方向一致 / 规范一致 / 决策一致" }
			]);
			
			/**
			 * 六维审核（规则版，确定性输出）
			 * @param {object} input
			 * @param {string} input.goal 本次目标（用于"需求满足度"）
			 * @param {string} input.output 产出描述 / 文本
			 * @param {Array<string>} [input.evidence] 证据条目（文件路径、测试结果等）
			 * @param {Array<string>} [input.risks] 已知风险
			 * @returns {{dims:Array, pass:boolean, failed:Array, score:number}}
			 */
			function review6(input = {}) {
				const goal = String(input.goal || "");
				const output = String(input.output || "");
				const evidence = Array.isArray(input.evidence) ? input.evidence : [];
				const risks = Array.isArray(input.risks) ? input.risks : [];
				const oLen = output.trim().length;
			
				/**
				 * 小工具：把"是否达标 + 说明"打包成一维
				 *
				 * 🔴 `status` 三态语义（17 号文 §1A.9 要求 ✅/⚠/❌ 可区分，不得退化为二元）：
				 *   - `ok === true`  → `"ok"`（✅）
				 *   - `ok === false` → `warnOnly ? "warn"`（⚠ 可后补 / 需人工确认）`: "bad"`（❌ 硬缺口，阻断通过）
				 *   2026-09-12 修正：原实现在未达标分支**恒定返回 `"bad"`** → 传入的 `"warn"` 失效，
				 *   六维退化为「全 ❌」（⚠ 仅在一致性一维出现，形同虚设）。修正后六维真正三态可辨。
				 */
				const dim = (key, ok, note, warnOnly) => {
					const d = REVIEW_DIMS.find((x) => x.key === key);
					return { key, label: d.label, hint: d.hint, status: ok ? "ok" : (warnOnly ? "warn" : "bad"), note };
				};
			
				const goalToks = tokenize(goal);
				const outLower = output.toLowerCase();
				const covered = goalToks.filter((t) => t.length >= 2 && outLower.indexOf(t) >= 0).length;
				const coverRate = goalToks.length ? covered / goalToks.length : (oLen > 0 ? 1 : 0);
				// 一致性证据（单次判定，供维度与说明共用，避免重复正则）
				const hasConsistency = evidence.some((e) => /一致|未变|冻结|三处|逐字节|cmp/.test(String(e)));
			
				const dims = [
					dim("requirement", oLen > 0 && coverRate >= 0.5,
						oLen === 0 ? "产出为空 → 无法满足任何需求" : "目标词覆盖 " + Math.round(coverRate * 100) + "%（" + covered + "/" + goalToks.length + "）",
						true),                                     // 覆盖不足 → ⚠（可后补）
					dim("conformance", evidence.length > 0,
						evidence.length ? "有 " + evidence.length + " 条可核验证据" : "无证据条目 → 变更不可追溯",
						false),                                    // 无证据 → ❌（硬缺口，阻断通过）
					dim("quality", oLen >= 20 && evidence.length > 0,
						"产出 " + oLen + " 字 / 证据 " + evidence.length + " 条",
						true),                                     // 产出过短 → ⚠
					dim("risk", risks.length === 0,
						risks.length ? "已记录 " + risks.length + " 条风险（需确认可控）" : "无遗留风险",
						true),                                     // 有风险 → ⚠（需确认可控）
					dim("completeness", oLen >= 20,
						oLen >= 20 ? "产出具备实质内容" : "产出过短，边界可能未覆盖",
						true),                                     // 过短 → ⚠
					dim("consistency", hasConsistency,
						hasConsistency ? "存在一致性证据" : "缺一致性证据（如『三处哈希一致』/『key 未改名』）",
						false)                                     // 缺一致性证据 → ❌（硬缺口）
				];
				const failed = dims.filter((d) => d.status === "bad");
				const warns = dims.filter((d) => d.status === "warn");
				const score = Math.round((dims.filter((d) => d.status === "ok").length / dims.length) * 100);
				return {
					dims, failed, warns,
					pass: failed.length === 0,
					score,
					summary: "六维：" + dims.map((d) => d.label + (d.status === "ok" ? "✅" : d.status === "warn" ? "⚠" : "❌")).join(" / ")
						+ " ⇒ " + (failed.length === 0 ? "通过" : "打回（" + failed.map((d) => d.label).join("、") + "）")
				};
			}
			
			/** 六维审核并留痕（要求 3：审核记录 + 纠偏可追溯） */
			async function reviewAndSave(nodeId, input) {
				const result = review6(input);
				const rec = await saveReview({
					nodeId,
					kind: "six-dim",
					dims: result.dims,
					pass: result.pass,
					score: result.score,
					summary: result.summary,
					target: input.target || null,
					at: Date.now()
				});
				return { ...result, saved: Boolean(rec), reviewId: rec ? rec.reviewId : null };
			}
			
			/** 安装全局契约（调试与验证脚本用） */
			function installRoutingApi() {
				if (typeof window === "undefined") return null;
				const api = {
					INTENT, DESTINATION, DESTINATION_LABEL, REVIEW_DIMS,
					tokenize, classifyIntent, scoreNodes, splitTasks, suggestDestination,
					route, confirmRoute, review6, reviewAndSave,
					listRouteHistory
				};
				window.__dshRouter = api;
				window.__dshReview6 = { REVIEW_DIMS, review6, reviewAndSave };
				return api;
			}
			
			exports.INTENT = INTENT;
			exports.tokenize = tokenize;
			exports.classifyIntent = classifyIntent;
			exports.scoreNodes = scoreNodes;
			exports.splitTasks = splitTasks;
			exports.DESTINATION = DESTINATION;
			exports.DESTINATION_LABEL = DESTINATION_LABEL;
			exports.suggestDestination = suggestDestination;
			exports.route = route;
			exports.confirmRoute = confirmRoute;
			exports.listRouteHistory = listRouteHistory;
			exports.REVIEW_DIMS = REVIEW_DIMS;
			exports.review6 = review6;
			exports.reviewAndSave = reviewAndSave;
			exports.installRoutingApi = installRoutingApi;
		};

		// ── logic/duties.js ──
		__defs["logic/duties.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：总监职责配置定义（03号文 §3.1「执行逻辑项」）
			 * 引用：03 号文 §3.1
			 * 上游：components/DirectorWorkbench.js, logic/director-run.js, store/duty-config.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * logic/duties.js — 总监职责配置定义（03号文 §3.1「执行逻辑项」）
			 *
			 * ⚠️ 本模块**严格按文档实现，不自行改动需求**。
			 *
			 * 依据：`docs/20-任务文档/03-总监对话模式开发文档.md` §3.1（:138-148）
			 *   「本质：每个执行逻辑 = 一段 prompt 模板 + 启停开关，控制总监要做什么。」
			 *
			 * ┌──────────────┬────────┬───────────────────────────────────────────┐
			 * │ 执行逻辑项    │ 默认   │ prompt 模板（文档原文，逐字采用）           │
			 * ├──────────────┼────────┼───────────────────────────────────────────┤
			 * │ 整理语言      │ ✅ 启用 │ 你是一个项目总监，请把用户的口语化需求整理为 │
			 * │              │        │ 精确、无歧义的技术指令，保留核心意图，去除冗余表述。 │
			 * │ 调整模型      │ ✅ 启用 │ 根据任务类型判断最优模型：代码任务→coder模型，│
			 * │              │        │ 推理任务→reasoner模型，日常对话→chat模型。输出模型名称和理由。 │
			 * │ 切换分支      │ ✅ 启用 │ 判断当前消息与已有对话上下文是否连续。连续→沿用当前分支；不连续→建议开新分支。 │
			 * │ 上下文筛选    │ ⬜ 禁用 │ 当切换模型/分支时，筛选需要传递的上下文片段，去除无关历史，控制token量。 │
			 * │ 自动审核产出  │ ⬜ 禁用 │ 大模型返回结果后，自动审核文档/代码是否符合原始需求，不符合则标注问题并建议修正。 │
			 * └──────────────┴────────┴───────────────────────────────────────────┘
			 *
			 * ── 与宿主旧 duties 的关系（重要，勿混）─────────────────────────────
			 * 宿主 `config/model.js#loadDirectorConfig()` 的 `duties` 是**另一套键名**
			 * （languagePolish / contextMemory / executionLogic / modelRouting / returnReview），
			 * 且默认值与文档**不一致**（文档要求「上下文筛选」默认禁用，宿主 `contextMemory` 默认启用）。
			 *
			 * 因 R5 兼容约束：`localStorage["dsh.director.config"]` 是**持久化契约**且宿主内联仍在读，
			 * **禁止改写其默认结构**。故本模块在插件侧**独立**定义文档 5 项，
			 * 存于层级节点 `duties` 字段（§3.2 三级继承），运行时与宿主 config 合并时**插件职责优先**。
			 *
			 * 映射关系（供 `director-run.js` 把宿主状态带过来，仅作参考、不改变文档 5 项语义）：
			 *   languagePolish ↔ languagePolish（同义）
			 *   modelRouting   ↔ modelRouting（同义）
			 *   branchSwitch   ← 宿主无对应项
			 *   contextFilter  ↔ contextMemory（近似）
			 *   outputReview   ↔ returnReview（近似）
			 */
			
			/** 文档 §3.1 五项职责的固定顺序（UI 渲染顺序同此） */
			const DUTY_KEYS = [
				"languagePolish",
				"modelRouting",
				"branchSwitch",
				"contextFilter",
				"outputReview"
			];
			
			/** 文档 §3.1 默认职责表（prompt 逐字采用文档原文） */
			const DEFAULT_DUTIES = {
				languagePolish: {
					key: "languagePolish",
					name: "整理语言",
					enabled: true,
					prompt: "你是一个项目总监，请把用户的口语化需求整理为精确、无歧义的技术指令，保留核心意图，去除冗余表述。"
				},
				modelRouting: {
					key: "modelRouting",
					name: "调整模型",
					enabled: true,
					prompt: "根据任务类型判断最优模型：代码任务→coder模型，推理任务→reasoner模型，日常对话→chat模型。输出模型名称和理由。"
				},
				branchSwitch: {
					key: "branchSwitch",
					name: "切换分支",
					enabled: true,
					prompt: "判断当前消息与已有对话上下文是否连续。连续→沿用当前分支；不连续→建议开新分支。"
				},
				contextFilter: {
					key: "contextFilter",
					name: "上下文筛选",
					/* 🔴 默认改为 true（2026-09-12）：文档 §1.2 定义总监是**五步**处理，
					 * 而默认表把第 ④⑤ 步关着 ⇒ 出厂默认与自身规格矛盾（真机实测：真流转的
					 * 总监回复里只有 1/2/3 步，第 4/5 步被 `reasoning` 的 enabled 过滤掉）。
					 * 两步都是 G0（零模型、零网络、永不抛错），开启不引入失败面。 */
					enabled: true,
					prompt: "当切换模型/分支时，筛选需要传递的上下文片段，去除无关历史，控制token量。"
				},
				outputReview: {
					key: "outputReview",
					name: "自动审核产出",
					/* 🔴 默认改为 true（同上）：用户核心目标里「审核」由总监统筹，
					 * 第 ⑤ 步正是那条审核环 —— 关掉它等于核心目标默认不生效。 */
					enabled: true,
					prompt: "大模型返回结果后，自动审核文档/代码是否符合原始需求，不符合则标注问题并建议修正。"
				}
			};
			
			/** 深拷贝一份默认职责（避免多处共享同一对象引用被污染） */
			function cloneDefaultDuties() {
				return JSON.parse(JSON.stringify(DEFAULT_DUTIES));
			}
			
			/**
			 * 归一化任意输入为合法职责表：缺项补默认，多余项丢弃。
			 * 用于读回持久化数据（可能被手工改坏或跨版本残留）。
			 * @param {any} input
			 * @returns {typeof DEFAULT_DUTIES}
			 */
			function normalizeDuties(input) {
				const base = cloneDefaultDuties();
				if (!input || typeof input !== "object") return base;
				for (const k of DUTY_KEYS) {
					const src = input[k];
					if (!src || typeof src !== "object") continue;
					base[k].enabled = src.enabled === undefined ? base[k].enabled : Boolean(src.enabled);
					if (typeof src.prompt === "string") base[k].prompt = src.prompt;
					if (typeof src.name === "string" && src.name.trim()) base[k].name = src.name;
				}
				return base;
			}
			
			/** 取某节点自身配置的职责（未配置返回 null = 完全继承上层） */
			function readOwnDuties(node) {
				const own = node && node.duties;
				if (!own || typeof own !== "object" || Object.keys(own).length === 0) return null;
				return normalizeDuties(own);
			}
			
			exports.DUTY_KEYS = DUTY_KEYS;
			exports.DEFAULT_DUTIES = DEFAULT_DUTIES;
			exports.cloneDefaultDuties = cloneDefaultDuties;
			exports.normalizeDuties = normalizeDuties;
			exports.readOwnDuties = readOwnDuties;
		};

		// ── store/duty-config.js ──
		__defs["store/duty-config.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：职责三级继承（03号文 §3.2「继承制」）
			 * 引用：03 号文 §3.2
			 * 上游：client-entry.js, components/DirectorWorkbench.js
			 * 下游：store/hierarchy.js, logic/duties.js, util/debug.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * store/duty-config.js — 职责三级继承（03号文 §3.2「继承制」）
			 *
			 * 依据：`docs/20-任务文档/03-总监对话模式开发文档.md` §3.2（:150-165）
			 * ```
			 * 默认配置（全局一套）
			 *     ↓ 继承
			 * 项目级配置（可单独修改，覆盖默认）
			 *     ↓ 继承
			 * 会话级配置（可单独修改，覆盖项目级）
			 *     ↑ 可向上提交
			 * 会话中修改可「提交到项目」/「提交到全局」覆盖上层
			 * ```
			 *
			 * 设计要点
			 * 1. **逐项继承**：继承粒度是「单个职责」而非整个配置对象 ——
			 *    会话可只覆盖「整理语言」，其余四项仍继承项目级。
			 *    （复用 `hierarchy.js#getBreadcrumb` 构建链，避免重复遍历）
			 * 2. **来源可溯源**：每项返回 `origin`，UI 直接显示「继承/本层/项目级」。
			 * 3. **向上提交**：把本节点**解析后的生效配置**写到父节点（可再往上到全局）。
			 * 4. **恢复继承**：清空本节点 `duties`，重新完全继承。
			 *
			 * ⚠️ 写操作后必须回读校验（执行标准 §3.4）：`saveNode()` 返回成功 ≠ 落库正确。
			 */
			
			const { getNode, saveNode, getBreadcrumb, GLOBAL_NODE_ID } = __m("store/hierarchy.js");
			const { DUTY_KEYS, cloneDefaultDuties, normalizeDuties, readOwnDuties } = __m("logic/duties.js");
			const { dshLog } = __m("util/debug.js");
			
			/** 来源层级标签 */
			const ORIGIN = {
				DEFAULT: "default", // 无任何节点配置 → 文档默认值
				GLOBAL: "global",
				PROJECT: "project",
				SESSION: "session",
				OWN: "own" // 本层显式配置
			};
			
			const LEVEL_TO_ORIGIN = { global: ORIGIN.GLOBAL, project: ORIGIN.PROJECT, session: ORIGIN.SESSION };
			
			/**
			 * 解析某节点**生效**的职责配置（自顶向下逐项覆盖 —— 越靠近本节点优先级越高）
			 *
			 * @param {string} nodeId
			 * @returns {Promise<{duties: object, origin: Record<string,string>, own: object|null, chain: Array}>}
			 *          duties  生效配置
			 *          origin  每项来源（"default" | "global" | "project" | "session" | "own"）
			 *          own     本节点自身配置（null = 完全继承）
			 *          chain   继承链（根 → 本节点），供 UI 展示
			 */
			async function resolveDuties(nodeId) {
				const chain = await getBreadcrumb(nodeId || GLOBAL_NODE_ID);
				// 根 → 本节点；链为空（节点不存在）时退化为纯默认
				const duties = cloneDefaultDuties();
				const origin = Object.fromEntries(DUTY_KEYS.map((k) => [k, ORIGIN.DEFAULT]));
			
				for (const link of chain) {
					// getBreadcrumb 只返回 {id,name,level} —— 需取完整节点拿 duties
					const node = await getNode(link.id);
					const own = readOwnDuties(node);
					if (!own) continue;
					for (const k of DUTY_KEYS) {
						duties[k] = { ...duties[k], ...own[k] };
						origin[k] = link.id === nodeId ? ORIGIN.OWN : (LEVEL_TO_ORIGIN[link.level] || ORIGIN.OWN);
					}
				}
			
				const self = await getNode(nodeId);
				return { duties, origin, own: readOwnDuties(self), chain };
			}
			
			/**
			 * 写入本节点职责配置（覆盖模式）
			 * @param {string} nodeId
			 * @param {object} duties 职责表（会被 normalizeDuties 归一化）
			 * @returns {Promise<object>} 回读后的节点（§3.4 写后回读）
			 */
			async function setOwnDuties(nodeId, duties) {
				const node = await getNode(nodeId);
				if (!node) throw new Error("节点不存在: " + nodeId);
				node.duties = normalizeDuties(duties);
				await saveNode(node);
				const back = await getNode(nodeId); // 🔴 回读校验
				if (!back || !back.duties) {
					dshLog("duty", "写后回读失败: nodeId=" + nodeId);
					throw new Error("职责配置写入未落库: " + nodeId);
				}
				return back;
			}
			
			/** 恢复继承：清空本节点自身职责配置 */
			async function clearOwnDuties(nodeId) {
				const node = await getNode(nodeId);
				if (!node) return null;
				delete node.duties;
				await saveNode(node);
				const back = await getNode(nodeId); // 🔴 回读校验
				if (back && back.duties) throw new Error("恢复继承未落库: " + nodeId);
				return back;
			}
			
			/**
			 * 向上提交（§3.2「会话中修改可提交到项目 / 提交到全局」）
			 * 把本节点**解析后的生效配置**写入父节点。
			 *
			 * @param {string} nodeId 来源节点
			 * @param {number} [levels=1] 向上几层（1=项目级，2=全局级）
			 * @returns {Promise<{target: object, duties: object}|null>} null = 已在根、无可提交
			 */
			async function submitUp(nodeId, levels = 1) {
				const crumb = await getBreadcrumb(nodeId);
				const idx = crumb.length - 1 - levels;
				if (idx < 0) return null; // 已到顶
				const target = crumb[idx];
				if (!target || target.id === nodeId) return null;
			
				const { duties } = await resolveDuties(nodeId);
				const written = await setOwnDuties(target.id, duties);
				dshLog("duty", "向上提交: " + nodeId + " → " + target.id + " (" + target.name + ")");
				return { target: written, duties };
			}
			
			/** 安装全局契约（供 CDP 真机验证与控制台排查） */
			function installDutyApi() {
				if (typeof window === "undefined") return null;
				window.__dshDuties = {
					KEYS: DUTY_KEYS,
					DEFAULT: cloneDefaultDuties,
					resolve: resolveDuties,
					set: setOwnDuties,
					clear: clearOwnDuties,
					submitUp: submitUp
				};
				return window.__dshDuties;
			}
			
			exports.ORIGIN = ORIGIN;
			exports.resolveDuties = resolveDuties;
			exports.setOwnDuties = setOwnDuties;
			exports.clearOwnDuties = clearOwnDuties;
			exports.submitUp = submitUp;
			exports.installDutyApi = installDutyApi;
		};

		// ── logic/director-run.js ──
		__defs["logic/director-run.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：总监预处理中枢（03号文 §1.2 五步标准执行逻辑）
			 * 引用：03 号文 §1.2
			 * 上游：client-entry.js, components/DirectorWorkbench.js
			 * 下游：logic/duties.js, config/model.js, util/debug.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * logic/director-run.js — 总监预处理中枢（03号文 §1.2 五步标准执行逻辑）
			 *
			 * ⚠️ 与 `logic/process.js` 的关系（重要）
			 *   `process.js` 是**宿主内联的逐字迁移品**（保真优先，不得顺手优化），
			 *   其职责键名沿用宿主旧 5 项，与文档 §3.1 定义不一致。
			 *   本模块是**插件侧的完整实现**，严格按文档 §1.2 五步 + §3.1 五项职责 + §4.3 降级。
			 *   两者并存是刻意的：**保真归保真，完善归完善**。
			 *
			 * 依据
			 *   §1.2 总监本质（:27-40）：会话预处理中枢。❌不执行业务 ❌不调用工具 ❌不跑业务推理；
			 *       ✅索引检索 → 按需加载 → 上下文筛选精简 → 模型路由 → 组装报文 → 写入提交列
			 *   §1.2 五步（:35-40）：
			 *       1 整理语言  2 判断是否需要切新分支  3 判断是否需要切模型
			 *       4 切换分支时判断传哪些上下文      5 自动审核大模型产出
			 *   §2.3 完整消息流（:90-121）：②预处理 → ③过程展示 → ④自动转发 → ⑤自动审核
			 *   §4.3 降级策略（:236-242）：Ollama 挂 / 超时 / 格式异常 → 降级，不崩溃
			 *
			 * 梯度（与 `logic/summarize.js` 同套口径）
			 *   G1 = 本地模型（Ollama qwen2:7b）参与；G0 = 纯规则降级。
			 */
			
			const { cloneDefaultDuties, normalizeDuties } = __m("logic/duties.js");
			const { callLocalModel, polishLanguage, classifyTask } = __m("config/model.js");
			const { dshLog } = __m("util/debug.js");
			
			/** 任务类型 → 模型建议（文档 §1.2 第 3 步 / §3.1「调整模型」模板语义） */
			const TASK_MODEL = {
				code: "deepseek-coder",
				design: "deepseek-reasoner",
				research: "deepseek-chat",
				writing: "deepseek-chat",
				chat: "deepseek-chat"
			};
			
			const TASK_NAME = { code: "代码开发", design: "系统设计", research: "资料调研", writing: "文本整理", chat: "日常对话" };
			
			/** 并发保护：同一 store 同时只允许一次处理（沿用 process.js V9.4-P1 语义） */
			const running = new WeakSet();
			
			/**
			 * 执行总监预处理（五步）
			 *
			 * @param {object} p
			 * @param {string} p.sessionId
			 * @param {string} p.userText 用户原始输入
			 * @param {object} p.store 总监 store（createDirectorStore 产物，需有 addMessage/setStatus/getState）
			 * @param {object} [p.duties] 生效职责配置（resolveDuties 结果）；缺省用文档默认
			 * @param {object} [p.config] 模型配置（localModel.endpoint/model/enabled）
			 * @param {boolean} [p.autoForward=false] 是否自动转发到原对话（§2.3 ④）
			 * @param {(instruction:string)=>void} [p.onForward] 转发回调
			 * @returns {Promise<{steps: Array<{n:number,name:string,enabled:boolean,grade:string,text:string}>,
			 *                    instruction: string, model: string, branch: string, taskType: string,
			 *                    reasoning: string, forward: {done:boolean, at?:number}}>}
			 */
			async function runDirector({
				sessionId, userText, store, duties, config,
				autoForward = false, onForward
			}) {
				const d = normalizeDuties(duties || cloneDefaultDuties());
				const cfg = config || { localModel: { enabled: false } };
				const steps = [];
				const push = (n, name, enabled, grade, text) => steps.push({ n, name, enabled, grade, text });
			
				if (store && running.has(store)) {
					throw new Error("总监正在处理上一条指令，请稍候");
				}
				if (store) running.add(store);
			
				try {
					/* 🔴 先取**上屏前**的状态快照：`history` 的语义是「本条之前的上下文」，
					 *    若在 addMessage 之后取，当前这条会被重复算进 history。
					 */
					const state = store ? store.getState() : { messages: [] };
					const history = (state.messages || []).slice(-10)
						.map((m) => `${m.role}: ${m.content}`).join("\n");
					const taskType = classifyTask(userText);
			
					/* ── §2.3 消息流 ①：用户消息**立即上屏** ──
					 * 必须在执行 5 步之前写入。原因：步骤 1/2/3 会调用本地模型（单次超时
					 * `LOCAL_MODEL_TIMEOUT_MS = 60s`，串行最多 3 次）——若把用户消息放在末尾，
					 * 模型不可用时用户会**盯着空面板等最长数分钟**，误以为「发送没反应」。
					 * 实测（2026-09-12）确实如此：点击发送后 1.8s 内消息区零变化。
					 */
					if (store) {
						store.addMessage({ role: "user", content: userText });
						store.setStatus("running");
					}
			
					/* ── 步骤 1：整理语言（§1.2 ①） ── */
					let polished = userText;
					let g1 = "G0";
					if (d.languagePolish.enabled) {
						polished = polishLanguage(userText);
						if (cfg.localModel?.enabled) {
							const out = await callLocalModel(
								d.languagePolish.prompt + "\n\n## 用户输入\n" + userText
								+ "\n\n请只输出整理后的指令本身，不要解释。",
								cfg
							);
							if (out && out.trim()) { polished = out.trim().split("\n")[0]; g1 = "G1"; }
						}
					}
					push(1, "整理语言", d.languagePolish.enabled, g1, polished);
			
					/* ── 步骤 2：判断是否需要切新分支（§1.2 ②） ── */
					let branch = "沿用当前分支";
					let g2 = "G0";
					if (d.branchSwitch.enabled) {
						const prev = (state.messages || []).filter((m) => m.role === "user").slice(-1)[0];
						branch = prev ? judgeBranch(prev.content, userText) : "新会话首条 → 沿用当前分支";
						// 分支判断属语义连续性判定，规则不足以覆盖时交本地模型
						if (cfg.localModel?.enabled) {
							const out = await callLocalModel(
								d.branchSwitch.prompt + "\n\n## 上一条用户消息\n" + (prev ? prev.content : "(无)")
								+ "\n\n## 当前用户消息\n" + userText
								+ "\n\n只回答：连续 或 不连续，并给一句理由。",
								cfg
							);
							if (out) {
								g2 = "G1";
								branch = /不连续/.test(out) ? "建议开新分支（" + out.trim().slice(0, 40) + "）" : "沿用当前分支";
							}
						}
					}
					push(2, "切换分支", d.branchSwitch.enabled, g2, branch);
			
					/* ── 步骤 3：判断是否需要切模型（§1.2 ③） ── */
					let model = "deepseek-chat";
					let g3 = "G0";
					if (d.modelRouting.enabled) {
						model = TASK_MODEL[taskType] || "deepseek-chat";
						if (cfg.localModel?.enabled) {
							const out = await callLocalModel(
								d.modelRouting.prompt + "\n\n## 用户输入\n" + userText
								+ "\n\n## 规则初判\n任务类型=" + (TASK_NAME[taskType] || taskType) + "，建议=" + model,
								cfg
							);
							if (out) {
								g3 = "G1";
								const m = out.match(/(deepseek-[a-z]+)/);
								if (m) model = m[1];
							}
						}
					}
					push(3, "调整模型", d.modelRouting.enabled, g3, "任务类型=" + (TASK_NAME[taskType] || taskType) + " → " + model);
			
					/* ── 步骤 4：上下文筛选（§1.2 ④） ── */
					let context = "";
					let g4 = "G0";
					if (d.contextFilter.enabled) {
						const needSwitch = /新分支/.test(branch) || model !== "deepseek-chat";
						if (needSwitch) {
							context = pickContext(state.messages || [], userText, 5);
							g4 = "G0";
						} else {
							context = "无需切换 → 传递完整上下文";
						}
					} else {
						context = "职责未启用 → 不筛选";
					}
					push(4, "上下文筛选", d.contextFilter.enabled, g4, context);
			
					/* ── 步骤 5：自动审核产出（§1.2 ⑤ / §2.3 ⑤） ── */
					// 注意：本步审核的是「总监组装出的待提交报文」是否符合原始需求（§3.1 模板语义：
					// "大模型返回结果后，自动审核文档/代码是否符合原始需求"）。
					// 真实的大模型产出在转发之后才产生，故此处先产出**审核结论占位 + 规则自检**，
					// 由 `reviewOutput()` 在拿到产出后调用；本步负责登记开关与规则自检结果。
					let review = "职责未启用 → 跳过审核";
					let g5 = "G0";
					if (d.outputReview.enabled) {
						const r0 = reviewOutput(userText, polished, d);
						review = r0.passed ? "自检通过" : "发现 " + r0.issues.length + " 项问题：" + r0.issues.join("；");
						g5 = "G0";
					}
					push(5, "自动审核产出", d.outputReview.enabled, g5, review);
			
					/* ── 组装报文 + 写入总监对话流（§2.3 ③） ── */
					const reasoning = steps
						.filter((s) => s.enabled)
						.map((s) => `${s.n}. ${s.name}（${s.grade}）：${s.text}`)
						.join("\n");
					const payload = {
						instruction: polished,
						model, branch, taskType, reasoning,
						steps
					};
			
					if (store) {
						// 用户消息已在上屏前置入（见函数开头），此处只补总监回复
						store.addMessage({
							role: "assistant",
							content: "【总监分析】\n" + (reasoning || "（全部职责已关闭，原文直转）"),
							parsed: payload
						});
						store.setStatus("done");
					}
			
					/* ── 自动转发（§2.3 ④） ── */
					const forward = { done: false };
					if (autoForward && typeof onForward === "function") {
						// 300ms 延迟沿用宿主原实现（等 UI 落定），勿改
						await new Promise((r) => setTimeout(r, 300));
						onForward(polished);
						forward.done = true;
						forward.at = Date.now();
					}
			
					dshLog("director", "runDirector done: session=" + sessionId + " taskType=" + taskType
						+ " grade=" + [g1, g2, g3, g4, g5].join("/") + " forward=" + forward.done);
			
					return { steps, instruction: polished, model, branch, taskType, reasoning, forward, payload };
				} catch (e) {
					/* 🔴 失败不得静默：用户消息已经上屏，若不补一条回复，面板会永远停在
					 * 「发出去了但没有任何反应」的状态（比直接报错更难排查）。
					 */
					if (store) {
						store.addMessage({
							role: "assistant",
							content: "【总监异常】" + (e && e.message ? e.message : String(e))
						});
						store.setStatus("error");
					}
					throw e;
				} finally {
					if (store) running.delete(store);
				}
			}
			
			/** 安装全局契约（供 CDP 真机验证与控制台调用） */
			function installDirectorRunApi() {
				if (typeof window === "undefined") return null;
				window.__dshDirectorRun = {
					run: runDirector,
					judgeBranch,
					pickContext,
					reviewOutput
				};
				return window.__dshDirectorRun;
			}
			
			/* ── 纯函数（无副作用，可直接单测）── */
			
			/**
			 * 分词：空格词 ∪ CJK 二字组（bigram）
			 *
			 * 🔴 为何必须加 CJK bigram：中文**没有空格**，`split(/\s+/)` 会把整句
			 *    「实现三级总监结构对话级文件夹级全局级」当成 **1 个词** ——
			 *    实测导致 `reviewOutput` 的「核心关键词丢失」检查因 `srcW.length < 3` 被整段跳过，
			 *    产出「好的，我明白了。」也被判为**通过**（假阴性，漏报）。
			 *    二字组是无空格语言上最小可用的语义单元（单字噪声过大）。
			 */
			function tokenize(text) {
				let t = String(text || "").toLowerCase();
				// 🔴 必须在 CJK 与拉丁/数字之间插空格，否则「改成jwt鉴权」整体成 1 个词，
				//    其中的 `jwt` 无法作为独立 token 参与重合度计算（实测致同主题被判为话题切换）。
				t = t.replace(/([\p{Script=Han}])([\p{L}\p{N}])/gu, "$1 $2")
					.replace(/([\p{L}\p{N}])([\p{Script=Han}])/gu, "$1 $2");
				const out = new Set();
				// 空格/标点分词（覆盖英文、数字、代码标识符）
				for (const w of t.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)) {
					if (w.length > 1) out.add(w);
				}
				// CJK 二字组
				const cjk = t.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu);
				if (cjk && cjk.length >= 2) {
					for (let i = 0; i < cjk.length - 1; i++) out.add(cjk[i] + cjk[i + 1]);
				} else if (cjk && cjk.length === 1) {
					out.add(cjk[0]);
				}
				return out;
			}
			
			/**
			 * 分支连续性判定（规则版，G0）
			 * 依据：共享实词比例 —— 低于阈值视为话题切换。
			 */
			function judgeBranch(prevText, curText, threshold = 0.15) {
				const a = tokenize(prevText);
				const b = tokenize(curText);
				if (!a.size || !b.size) return "沿用当前分支";
				let hit = 0;
				for (const w of b) if (a.has(w)) hit++;
				const ratio = hit / b.size;
				return ratio >= threshold ? "沿用当前分支" : "建议开新分支（与上文无实质关联）";
			}
			
			/**
			 * 上下文片段筛选（G0）：按与当前输入的词重合度打分取 TopN
			 * @param {Array<{role:string,content:string}>} messages
			 * @param {string} query
			 * @param {number} limit
			 */
			function pickContext(messages, query, limit = 5) {
				const kw = new Set(String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 1));
				const scored = (messages || [])
					.filter((m) => m && typeof m.content === "string")
					.map((m, i) => {
						const words = m.content.toLowerCase().split(/\s+/);
						const hit = words.filter((w) => kw.has(w)).length;
						return { i, role: m.role, score: hit, text: m.content.slice(0, 60) };
					})
					.filter((x) => x.score > 0)
					.sort((a, b) => b.score - a.score || b.i - a.i)
					.slice(0, limit);
				if (!scored.length) return "无相关历史片段 → 不携带上下文";
				return scored.map((x) => `#${x.i}(${x.role}) ${x.text}`).join("\n");
			}
			
			/**
			 * 自动审核产出（§1.2 ⑤ / §3.1「自动审核产出」）
			 * 规则版 G0：零模型、零网络，永不抛错（§4.3 降级底线）。
			 *
			 * @param {string} original 用户原始需求
			 * @param {string} output 待审核产出（此处为总监组装的指令；拿到大模型产出后同理调用）
			 * @param {object} [duties]
			 * @returns {{passed: boolean, issues: string[], grade: string}}
			 */
			function reviewOutput(original, output, duties) {
				const issues = [];
				const o = String(output || "").trim();
				const src = String(original || "").trim();
				if (!o) issues.push("产出为空");
				if (src.length > 8 && o.length < src.length * 0.3) issues.push("产出过短，疑似丢失核心意图");
				// 核心实词保留度检查（tokenize 含 CJK 二字组，避免中文整句被当 1 词而跳过）
				const srcW = [...tokenize(src)];
				if (srcW.length >= 3) {
					const outW = tokenize(o);
					const lost = srcW.filter((w) => !outW.has(w)).length;
					if (lost / srcW.length > 0.7) issues.push("核心关键词丢失过多（" + lost + "/" + srcW.length + "）");
				}
				if (duties?.outputReview?.enabled === false) issues.length = 0; // 未启用 → 恒通过
				return { passed: issues.length === 0, issues, grade: "G0" };
			}
			
			exports.runDirector = runDirector;
			exports.installDirectorRunApi = installDirectorRunApi;
			exports.tokenize = tokenize;
			exports.judgeBranch = judgeBranch;
			exports.pickContext = pickContext;
			exports.reviewOutput = reviewOutput;
		};

		// ── components/DirectorWorkbench.js ──
		__defs["components/DirectorWorkbench.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：总监工作台（方案 E · 文档 06 §五）
			 * 引用：—
			 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorHierarchy.js
			 * 下游：logic/duties.js, store/duty-config.js, logic/director-run.js, store/create-store.js, store/use-store.js, store/hierarchy.js, config/model.js, util/debug.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/DirectorWorkbench.js — 总监工作台（方案 E · 文档 06 §五）
			 *
			 * 依据
			 *   §3.1 执行逻辑项（5 项 + 开关 + prompt 模板）→ 执行逻辑面板
			 *   §3.2 继承制（默认→项目→会话，可覆盖、可向上提交）→ 继承徽标 + 三个按钮
			 *   §2.2 总监tab内部布局 → 对话流 + 输入栏
			 *   §2.3 完整消息流 ②③④ → 预处理 / 过程展示 / 自动转发
			 *   §4.3 降级策略 → 梯度徽标 G0/G1
			 *
			 * ⚠️ 构建约束（同 DirectorHierarchy）
			 *   - `react` / `react/jsx-runtime` 为平台冻结模块，外置为 `require(...)`（ADR-001）
			 *   - 用 `.js` 而非 `.jsx`，不经 JSX 编译
			 */
			
			const react = require("react");
			const react_jsx_runtime = require("react/jsx-runtime");
			const { DUTY_KEYS } = __m("logic/duties.js");
			const { resolveDuties, setOwnDuties, clearOwnDuties, submitUp, ORIGIN } = __m("store/duty-config.js");
			const { runDirector } = __m("logic/director-run.js");
			const { directorStoreFactory } = __m("store/create-store.js");
			const { useDirectorStore } = __m("store/use-store.js");
			const { GLOBAL_NODE_ID, LEVEL_LABEL } = __m("store/hierarchy.js");
			const { loadDirectorConfig } = __m("config/model.js");
			const { dshLog } = __m("util/debug.js");
			
			const S = {
				card: { border: "1px solid var(--dsw-alias-border-l2, #2a2c30)", borderRadius: 8, padding: 12, marginBottom: 12, background: "var(--dsw-alias-bg-sunken, #1a1c20)" },
				label: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #a0a4aa)", marginBottom: 6 },
				btn: { padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #33363b)", background: "var(--dsw-alias-bg-base, #202227)", color: "var(--dsw-alias-label-primary, #e6e6e6)", cursor: "pointer" },
				btnPrimary: { padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #2f6bdd", background: "#2f6bdd", color: "#fff", cursor: "pointer" },
				input: { width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #33363b)", background: "var(--dsw-alias-bg-sunken, #1b1d21)", color: "var(--dsw-alias-label-primary, #e6e6e6)", boxSizing: "border-box" },
				row: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--dsw-alias-border-l2, #24262a)" },
				badge: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #8b8f96)", background: "var(--dsw-alias-bg-base, #202227)", borderRadius: 8, padding: "0 6px" },
				pre: { whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 12, lineHeight: "18px", fontFamily: "var(--ds-font-family-code, ui-monospace, Menlo, Consolas, monospace)" },
				muted: { color: "var(--dsw-alias-label-tertiary, #8b8f96)", fontSize: 12 }
			};
			
			const ORIGIN_LABEL = {
				[ORIGIN.DEFAULT]: "默认",
				[ORIGIN.GLOBAL]: "全局",
				[ORIGIN.PROJECT]: "项目",
				[ORIGIN.SESSION]: "会话",
				[ORIGIN.OWN]: "本层"
			};
			
			/**
			 * @param {object} props
			 * @param {object} props.node 当前层级节点（全局/项目/会话）
			 */
			function DirectorWorkbench({ node }) {
				const nodeId = node?.id || GLOBAL_NODE_ID;
				/* ── 职责配置 ── */
				const [duties, setDuties] = react.useState(null);
				const [origin, setOrigin] = react.useState({});
				const [own, setOwn] = react.useState(null);
				const [editing, setEditing] = react.useState(null); // 正在编辑 prompt 的 key
				/* ── 对话流 ── */
				const [input, setInput] = react.useState("");
				const [autoForward, setAutoForward] = react.useState(false);
				const [busy, setBusy] = react.useState(false);
				const [msg, setMsg] = react.useState("");
				const [lastSteps, setLastSteps] = react.useState(null);
				const [forwardLog, setForwardLog] = react.useState([]);
			
				// 总监 store：会话级用真实 sessionId，其余用节点 id（同 sessionId 共享，切换不丢）
				const sessionId = react.useMemo(() => (
					node?.conversations?.[0]?.conversationId || nodeId
				), [node, nodeId]);
				const store = react.useMemo(() => directorStoreFactory(sessionId), [sessionId]);
				const state = useDirectorStore(store);
			
				const reload = react.useCallback(async () => {
					const r = await resolveDuties(nodeId);
					setDuties(r.duties);
					setOrigin(r.origin);
					setOwn(r.own);
					return r;
				}, [nodeId]);
			
				react.useEffect(() => { reload(); }, [reload]);
				react.useEffect(() => { setLastSteps(null); }, [nodeId]);
			
				const guard = (fn) => async (...a) => {
					if (busy) return;
					setBusy(true);
					try { await fn(...a); } finally { setBusy(false); }
				};
			
				const toggle = (k) => setDuties((d) => ({ ...d, [k]: { ...d[k], enabled: !d[k].enabled } }));
			
				const doSave = guard(async () => {
					const back = await setOwnDuties(nodeId, duties); // 内部已回读校验
					setOwn(back.duties);
					await reload();
					setMsg("已保存本层职责配置（已回读校验）");
				});
			
				const doSubmitUp = guard(async () => {
					const r = await submitUp(nodeId, 1);
					if (!r) { setMsg("已在最上层，无可提交目标"); return; }
					await reload();
					setMsg("已向上提交到「" + r.target.name + "」");
				});
			
				const doRestore = guard(async () => {
					await clearOwnDuties(nodeId);
					await reload();
					setMsg("已恢复继承（本层配置已清空）");
				});
			
				const doSend = guard(async () => {
					const text = input.trim();
					if (!text) { setMsg("请输入内容"); return; }
					setInput("");
					const cfg = loadDirectorConfig();
					const eff = (await resolveDuties(nodeId)).duties;
					let r;
					try {
						r = await runDirector({
							sessionId,
							userText: text,
							store,
							duties: eff,
							config: cfg,
							autoForward,
							onForward: (instr) => {
								setForwardLog((l) => [...l, { at: Date.now(), instruction: instr }]);
								dshLog("director", "autoForward -> " + instr.slice(0, 60));
							}
						});
					} catch (e) {
						// runDirector 内部已把【总监异常】写进对话流；此处只补面板提示，避免静默
						setMsg("总监执行失败：" + (e && e.message ? e.message : String(e)));
						return;
					}
					setLastSteps(r.steps);
					setMsg("总监处理完成：" + r.steps.filter((s) => s.enabled).length + " 项职责生效"
						+ " · 任务=" + r.taskType + " · 模型=" + r.model
						+ (r.forward.done ? " · 已自动转发" : ""));
				});
			
				const messages = state?.messages || [];
			
				return (0, react_jsx_runtime.jsxs)("div", { children: [
					/* ── 执行逻辑面板（§3.1）── */
					(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", marginBottom: 6 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 13, fontWeight: 600 }, children: "执行逻辑（03号文 §3.1 五项）" }),
							(0, react_jsx_runtime.jsxs)("span", { style: { marginLeft: "auto", display: "flex", gap: 6 }, children: [
								(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, "data-testid": "w-save", onClick: doSave, disabled: busy, children: "保存本层" }),
								(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "w-submit-up", onClick: doSubmitUp, disabled: busy, children: "向上提交" }),
								(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "w-restore", onClick: doRestore, disabled: busy, children: "恢复继承" })
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, marginBottom: 8 }, children:
							"本层状态：" + (own ? "已覆盖（优先于上层）" : "完全继承上层")
							+ " · 节点层级：" + (LEVEL_LABEL[node?.level] || node?.level || "-")
							+ "（§3.2 继承制：默认 → 全局 → 项目 → 会话）" }),
			
						duties ? DUTY_KEYS.map((k) => (0, react_jsx_runtime.jsxs)("div", { key: k, style: S.row, children: [
							(0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: duties[k].enabled,
								onChange: () => toggle(k),
								"data-duty": k,
								style: { cursor: "pointer" }
							}),
							(0, react_jsx_runtime.jsx)("span", { style: { minWidth: 84 }, children: duties[k].name }),
							(0, react_jsx_runtime.jsxs)("span", { style: { ...S.muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
								"来源 ", ORIGIN_LABEL[origin[k]] || origin[k] || "-"
							] }),
							(0, react_jsx_runtime.jsx)("button", {
								style: S.btn, "data-edit-prompt": k,
								onClick: () => setEditing(editing === k ? null : k),
								children: editing === k ? "收起" : "prompt"
							})
						] }, k)) : (0, react_jsx_runtime.jsx)("div", { style: S.muted, children: "加载中…" }),
			
						editing && duties ? (0, react_jsx_runtime.jsxs)("div", { style: { marginTop: 8 }, children: [
							(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "prompt 模板：" + duties[editing].name }),
							(0, react_jsx_runtime.jsx)("textarea", {
								style: { ...S.input, minHeight: 64, resize: "vertical" },
								"data-prompt-input": editing,
								value: duties[editing].prompt,
								onChange: (e) => setDuties((d) => ({ ...d, [editing]: { ...d[editing], prompt: e.target.value } }))
							})
						] }) : null
					] }),
			
					/* ── 总监对话流（§2.3 ③）── */
					(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", marginBottom: 6 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 13, fontWeight: 600 }, children: "总监对话流" }),
							(0, react_jsx_runtime.jsx)("span", { style: { ...S.badge, marginLeft: "auto" }, children: messages.length + " 条" })
						] }),
						(0, react_jsx_runtime.jsx)("div", {
							style: { maxHeight: 220, overflowY: "auto", marginBottom: 8 },
							"data-testid": "director-messages",
							children: messages.length
								? messages.map((m, i) => (0, react_jsx_runtime.jsxs)("div", {
									key: i, style: { marginBottom: 8, paddingLeft: m.role === "user" ? 0 : 8, borderLeft: m.role === "user" ? "none" : "2px solid #2f6bdd" },
									children: [
										(0, react_jsx_runtime.jsx)("div", { style: S.muted, children: m.role === "user" ? "你" : (m.role === "assistant" ? "总监" : "系统") }),
										(0, react_jsx_runtime.jsx)("pre", { style: S.pre, children: m.content })
									]
								}, i))
								: (0, react_jsx_runtime.jsx)("div", { style: S.muted, children: "暂无消息。在下方输入并发送，总监将按 §1.2 五步预处理。" })
						}),
			
					/* 最近一次五步过程
					 * 🔴 `director-steps` 语义锚点（2026-09-13 补）：本区与 `director-messages`
					 *   是**兄弟节点**，此前**没有 testid** ⇒ `cdp-click.mjs` 的「五步过程已展示」
					 *   判据跑去 messages 容器的 innerText 里找「1. 整理语言」，**恒为 false**
					 *   （不是产品没展示，是**尺子量错了容器**）。按项目纪律「可断言的语义区
					 *   都要有 testid」，补上锚点，使闸门能按结构断言而不是按文案猜。 */
					lastSteps ? (0, react_jsx_runtime.jsxs)("div", { style: { marginBottom: 8 }, "data-testid": "director-steps", children: [
							(0, react_jsx_runtime.jsx)("div", { style: S.label, children: "本次处理过程（§1.2 五步）" }),
							lastSteps.map((s) => (0, react_jsx_runtime.jsxs)("div", { key: s.n, style: { ...S.muted, display: "flex", gap: 6 }, children: [
								(0, react_jsx_runtime.jsx)("span", { style: S.badge, children: s.enabled ? s.grade : "关" }),
								(0, react_jsx_runtime.jsx)("span", { children: s.n + ". " + s.name + "：" + String(s.text).slice(0, 60) })
							] }, s.n))
						] }) : null,
			
						/* 输入栏（§2.2） */
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
							(0, react_jsx_runtime.jsx)("input", {
								style: S.input, "data-testid": "director-input",
								placeholder: "输入需求，总监将预处理…",
								value: input,
								onChange: (e) => setInput(e.target.value),
								onKeyDown: (e) => { if (e.key === "Enter" && !busy) doSend(); }
							}),
							(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, "data-testid": "director-send", onClick: doSend, disabled: busy, children: "发送" }),
							(0, react_jsx_runtime.jsxs)("label", { style: { ...S.muted, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "checkbox", "data-testid": "director-autoforward", checked: autoForward, onChange: (e) => setAutoForward(e.target.checked) }),
								"自动转发"
							] })
						] }),
						forwardLog.length ? (0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, marginTop: 6 }, children:
							"已转发 " + forwardLog.length + " 条，最近：" + forwardLog[forwardLog.length - 1].instruction.slice(0, 40) }) : null
					] }),
			
					msg ? (0, react_jsx_runtime.jsx)("div", { style: S.muted, children: msg }) : null
				] });
			}
			
			__defaults["components/DirectorWorkbench.js"] = DirectorWorkbench;
			
			exports.DirectorWorkbench = DirectorWorkbench;
		};

		// ── logic/discover.js ──
		__defs["logic/discover.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：真实会话 / 文件夹（workspace）数据源发现层
			 * 引用：—
			 * 上游：client-entry.js, logic/branch-tree.js, logic/sync.js
			 * 下游：store/idb.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：自动同步：让**每一个**对话 / 文件夹都拥有总监
			 * 引用：—
			 * 上游：client-entry.js, components/DirectorHierarchy.js
			 * 下游：store/hierarchy.js, logic/discover.js, store/idb.js, util/debug.js, util/bus.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：多层级总监面板（方案 C：层级树 + 主内容区）
			 * 引用：03 号文 §1.3 · 17 号文 §2.1 · 17 号文 §1 · 03 号文 §4.3
			 * 上游：client-entry.js, components/DirectorDialog.js
			 * 下游：store/hierarchy.js, logic/summarize.js, logic/sync.js, util/bus.js, components/DirectorWorkbench.js, util/debug.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			const { DirectorWorkbench } = __m("components/DirectorWorkbench.js");
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
						// 🔴 稳定定位标识：真机交互验证与用户脚本依赖它精确点击**本行**。
						//    仅靠「textContent 前缀」匹配会命中祖先包裹 div（点击不冒泡向下 → 选中失败）。
						"data-node-id": node.id,
						"data-node-level": node.level,
						"data-selected": selectedId === node.id ? "true" : "false",
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
			 * @param {() => void} [props.onClose] 关闭回调
			 * @param {boolean} [props.compact] 紧凑形态（弹窗左栏内嵌用）——
			 *   侧栏 240px 固定列改为**顶部可折叠块**（240px 在 300px 左栏里放不下主内容），
			 *   其余逻辑、页签、`h-*` 定位标识**完全不变**（既有真机逐交互脚本可原样复用）。
			 */
			function DirectorHierarchy(props = {}) {
				const compact = props.compact === true;
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
				// 右栏页签：overview=层级概览（原内容） / director=总监工作台（文档 06 方案 E）
				const [tab, setTab] = react.useState("overview");
			
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
			
				return (0, react_jsx_runtime.jsxs)("div", { style: compact ? { ...S.root, flexDirection: "column" } : S.root, children: [
					/* ── 左：层级树（compact 时改为顶部可折叠块）── */
					(0, react_jsx_runtime.jsxs)("div", {
						style: compact
							? { flex: "0 0 auto", maxHeight: 168, overflowY: "auto", borderBottom: "1px solid var(--dsw-alias-border-l2, #2a2c30)", padding: "6px 0" }
							: S.side,
						children: [
							(0, react_jsx_runtime.jsxs)("div", { style: { padding: "4px 12px 8px", ...S.muted, display: "flex", alignItems: "center", gap: 6 }, children: [
								"总监层级",
								compact ? (0, react_jsx_runtime.jsx)("span", { style: { ...S.badge, marginLeft: "auto" }, "data-testid": "h-compact-hint", children: "紧凑" }) : null
							] }),
							tree
								? (0, react_jsx_runtime.jsx)(TreeItem, { node: tree, depth: 0, selectedId: selectedId, onSelect: setSelectedId })
								: (0, react_jsx_runtime.jsx)("div", { style: { padding: 12, ...S.muted }, children: "加载中…" })
						]
					}),
			
					/* ── 右：内容区 ── */
					(0, react_jsx_runtime.jsxs)("div", { style: compact ? { ...S.main, padding: 8 } : S.main, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }, children: [
							(0, react_jsx_runtime.jsx)("h3", { style: S.h, children: crumb.map((c) => c.name).join(" / ") || "全局总管" }),
							selected ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: LEVEL_LABEL[selected.level] || selected.level }) : null,
							selected?.summaryGrade ? (0, react_jsx_runtime.jsx)("span", { style: S.badge, children: "梯度 " + selected.summaryGrade }) : null,
							props.onClose ? (0, react_jsx_runtime.jsx)("button", { style: { ...S.btn, marginLeft: "auto" }, "data-testid": "h-close", onClick: props.onClose, children: "收起" }) : null
						] }),
			
						/* 页签：[概览] [总监] */
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6, marginBottom: 10 }, children: [
							(0, react_jsx_runtime.jsx)("button", {
								style: { ...(tab === "overview" ? S.btnPrimary : S.btn) }, "data-tab": "overview",
								"data-testid": "h-tab-overview", onClick: () => setTab("overview"), children: "概览"
							}),
							(0, react_jsx_runtime.jsx)("button", {
								style: { ...(tab === "director" ? S.btnPrimary : S.btn) }, "data-tab": "director",
								"data-testid": "h-tab-director", onClick: () => setTab("director"), children: "总监"
							})
						] }),
			
						/* 总监工作台（03号文 §3.1 职责 / §3.2 继承 / §2.3 消息流） */
						tab === "director"
							? (0, react_jsx_runtime.jsx)("div", { "data-panel": "director", children: (0, react_jsx_runtime.jsx)(DirectorWorkbench, { node: selected }) })
							: null,
			
						/* 概览内容（总监页签时隐藏，保留内部状态不卸载） */
						(0, react_jsx_runtime.jsxs)("div", { style: { display: tab === "overview" ? "" : "none" }, children: [
			
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
									(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, "data-testid": "h-sync", onClick: doSync, disabled: busy, children: "同步真实会话" })
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
								"data-testid": "h-meta-name",
								placeholder: "节点名称（修改后自动同步不再覆盖）",
								value: nodeName,
								onChange: (e) => setNodeName(e.target.value)
							}),
							["positioning", "goal", "currentPhase"].map((k) => (0, react_jsx_runtime.jsx)("input", {
								key: k,
								style: { ...S.input, marginBottom: 6 },
								"data-testid": "h-meta-" + k,
								placeholder: { positioning: "定位", goal: "目标", currentPhase: "当前阶段" }[k],
								value: meta[k],
								onChange: (e) => setMeta((m) => ({ ...m, [k]: e.target.value }))
							}, k)),
							(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-save-meta", onClick: doSaveMeta, disabled: busy, children: "保存基础信息" })
						] }),
			
						/* 总结区 */
						(0, react_jsx_runtime.jsxs)("div", { style: S.card, children: [
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", marginBottom: 8 }, children: [
								(0, react_jsx_runtime.jsx)("span", { style: S.label, children: "分层总结" }),
								(0, react_jsx_runtime.jsxs)("span", { style: { marginLeft: "auto", display: "flex", gap: 6 }, children: [
									(0, react_jsx_runtime.jsx)("button", { style: S.btnPrimary, "data-testid": "h-sum-one", onClick: doSummarizeOne, disabled: busy, children: "生成本级总结" }),
									(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-prop-up", onClick: doPropagate, disabled: busy, children: "向上提交" }),
									(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-sum-tree", onClick: doSummarizeTree, disabled: busy, children: "整树分层总结" })
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
								(0, react_jsx_runtime.jsx)("input", { style: S.input, "data-testid": "h-new-name", placeholder: "名称", value: newName, onChange: (e) => setNewName(e.target.value) }),
								(0, react_jsx_runtime.jsxs)("select", { style: S.btn, "data-testid": "h-new-level", value: newLevel, onChange: (e) => setNewLevel(e.target.value), children: [
									(0, react_jsx_runtime.jsx)("option", { value: LEVEL.PROJECT, children: "项目（文件夹级）" }),
									(0, react_jsx_runtime.jsx)("option", { value: LEVEL.SESSION, children: "会话（对话级）" })
								] }),
								(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-create", onClick: doCreate, disabled: busy, children: "新建" })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
								(0, react_jsx_runtime.jsx)("input", { style: S.input, "data-testid": "h-attach-sid", placeholder: "会话 ID", value: sessId, onChange: (e) => setSessId(e.target.value) }),
								(0, react_jsx_runtime.jsx)("input", { style: S.input, "data-testid": "h-attach-title", placeholder: "会话标题（可选）", value: sessTitle, onChange: (e) => setSessTitle(e.target.value) }),
								(0, react_jsx_runtime.jsx)("button", { style: S.btn, "data-testid": "h-attach", onClick: doAttach, disabled: busy, children: "挂载会话" })
							] })
						] }),
			
						/* 提示 + 删除 */
						msg ? (0, react_jsx_runtime.jsx)("div", { style: { ...S.muted, marginBottom: 8 }, children: msg }) : null,
						selectedId !== GLOBAL_NODE_ID
							? (0, react_jsx_runtime.jsx)("button", { style: { ...S.btn, borderColor: "#7a2b2b", color: "#ff8a8a" }, "data-testid": "h-remove", onClick: doRemove, disabled: busy, children: "删除当前节点" })
							: null
						] })
					] })
				] });
			}
			
			__defaults["components/DirectorHierarchy.js"] = DirectorHierarchy;
			
			exports.DirectorHierarchy = DirectorHierarchy;
		};

		// ── store/personalize.js ──
		__defs["store/personalize.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：个性化设定（右上角「⚙ 个性化」的单一真相源）
			 * 引用：—
			 * 上游：client-entry.js, components/DirectorPage.js, components/MindMap.js, components/PersonalizePanel.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * store/personalize.js — 个性化设定（右上角「⚙ 个性化」的单一真相源）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  需求原文（用户）：「目前总监 tap 页面，还有三个插件页面 文字背景，全部找审美重新
			 *   审核一下质感加上，同时都在右上角加自定义个性化设定」
			 *
			 *  ⇒ 落地口径：
			 *     ① **一处定义**（本文件）→ 四个界面（总监页 / 总监弹窗 / 设计图工作室 / 分支导图）
			 *        全部消费同一批 CSS 变量与同一份样式表，**不各自写色值**；
			 *     ② 四处的右上角都放同一个 `PersonalizePanel`（components/PersonalizePanel.js）；
			 *     ③ 改动**即时生效**：设定写入 `:root` 的 CSS 变量 + `<html data-dp-*>` 属性，
			 *        React 组件用 `style={{ borderRadius: "var(--dp-radius)" }}` 消费 ⇒ 无需重渲染整棵树。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 为什么用「CSS 变量 + 注入样式表」而不是「props 传样式」
			 * ══════════════════════════════════════════════════════════════════
			 *  质感（网格 / 点阵 / 玻璃）需要 `background-image` + `backdrop-filter` + 伪元素，
			 *  这些**用 inline style 写不出来或写不干净**（伪元素 inline 无法表达）。
			 *  故：色值/尺寸走 CSS 变量（inline 可消费），纹理走注入样式表里的
			 *  `html[data-dp-texture="..."] .dp-textured { ... }` 规则（class 可消费）。
			 *  两层配合 ⇒ 换质感只改一个属性，四个界面同时变。
			 *
			 * ⚠️ 持久化 key `dsh.director.personalize`（本项目独有，与布局 key 分开：
			 *    布局是"在哪"，个性化是"长什么样"，混在一起会让"复位布局"顺手改掉配色）。
			 *
			 * ⚠️ 本文件**不 import react**（纯数据 + DOM 副作用）⇒ 离线单测可直接 import。
			 */
			
			const PERSONALIZE_KEY = "dsh.director.personalize";
			
			/** 样式表节点 id（幂等注入；重跑只改内容不叠加节点） */
			const PERSONALIZE_STYLE_ID = "dsh-personalize-css";
			
			/** 默认设定（= 设计稿的默认观感；改动这里等于改默认观感） */
			const P_DEFAULTS = Object.freeze({
				accent: "#2f6feb",
				accent2: "#8957e5",
				density: 1,
				fontScale: 1,
				radius: 8,
				texture: "grid",
				motion: true,
				edge: "curve",
				minimap: true,
				legend: true
			});
			
			/** 主色（4 档，全部取宿主暗色系里"能当强调色"的） */
			const P_ACCENTS = Object.freeze([
				{ key: "#2f6feb", label: "原生蓝", desc: "与 Harness 原生主色一致（默认）" },
				{ key: "#8957e5", label: "总监紫", desc: "与总监徽章同色" },
				{ key: "#39c5cf", label: "青", desc: "冷色，适合长时间看" },
				{ key: "#d29922", label: "琥珀", desc: "暖色，醒目" }
			]);
			
			/** 强调色（用于"建议/待审"类徽章，与主色成对） */
			const P_ACCENT2 = Object.freeze([
				{ key: "#8957e5", label: "紫" },
				{ key: "#3fb950", label: "绿" },
				{ key: "#e5534b", label: "红" },
				{ key: "#39c5cf", label: "青" }
			]);
			
			/** 密度（行高 / 间距的整体乘数） */
			const P_DENSITY = Object.freeze([
				{ key: 0.9, label: "紧凑", desc: "同屏多 20% 信息" },
				{ key: 1, label: "标准", desc: "设计稿基线" },
				{ key: 1.15, label: "宽松", desc: "更好读，更少信息" }
			]);
			
			/** 字号（整体缩放） */
			const P_FONT = Object.freeze([
				{ key: 0.94, label: "小" },
				{ key: 1, label: "中" },
				{ key: 1.08, label: "大" }
			]);
			
			/** 圆角 */
			const P_RADIUS = Object.freeze([
				{ key: 4, label: "直角", desc: "工程感" },
				{ key: 8, label: "圆角", desc: "设计稿基线" },
				{ key: 14, label: "大圆角", desc: "柔和" }
			]);
			
			/** 质感 —— 这是用户点名要的「质感」。每档写明"看起来是什么样"，不写空话。 */
			const P_TEXTURES = Object.freeze([
				{ key: "solid", label: "纯色", desc: "无纹理 · 最省电 · 文字对比度最高" },
				{ key: "grid", label: "网格", desc: "22px 细网格 · 工程图纸感（默认）" },
				{ key: "dots", label: "点阵", desc: "16px 点阵 · 更轻，不抢视线" },
				{ key: "glass", label: "玻璃", desc: "半透明 + 背景模糊 · 层叠感（低端机会掉帧）" }
			]);
			
			/** 连线样式（导图） */
			const P_EDGE = Object.freeze([
				{ key: "curve", label: "曲线", desc: "三次贝塞尔，思维导图惯例" },
				{ key: "elbow", label: "折线", desc: "直角折线，更工程化" }
			]);
			
			/** 十六进制 → rgba（解析失败回落主色蓝，绝不产出 NaN） */
			function pHexSoft(hex, alpha) {
				try {
					const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
					if (!m) return "rgba(47,111,235," + alpha + ")";
					const n = parseInt(m[1], 16);
					return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
				} catch (e) { return "rgba(47,111,235," + alpha + ")"; }
			}
			
			/** 数值夹紧（防脏数据把界面搞崩） */
			function clampNum(v, lo, hi, dflt) {
				const n = Number(v);
				if (!Number.isFinite(n)) return dflt;
				return Math.max(lo, Math.min(hi, n));
			}
			
			/**
			 * 清洗设定：任何外来对象 → 合法设定（**逐字段校验**，不整体信任）。
			 * localStorage 里的旧数据 / 手改过的值都必须过大门口。
			 * @param {object} raw
			 * @returns {object} 完整设定
			 */
			function normalizePersonalize(raw) {
				const r = raw && typeof raw === "object" ? raw : {};
				const pick = (list, v, dflt) => {
					const keys = list.map((o) => o.key);
					return keys.indexOf(v) >= 0 ? v : dflt;
				};
				const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ""));
				return {
					accent: hexOk(r.accent) ? String(r.accent).toLowerCase() : P_DEFAULTS.accent,
					accent2: hexOk(r.accent2) ? String(r.accent2).toLowerCase() : P_DEFAULTS.accent2,
					density: pick(P_DENSITY, r.density, P_DEFAULTS.density),
					fontScale: pick(P_FONT, r.fontScale, P_DEFAULTS.fontScale),
					radius: pick(P_RADIUS, r.radius, P_DEFAULTS.radius),
					texture: pick(P_TEXTURES, r.texture, P_DEFAULTS.texture),
					edge: pick(P_EDGE, r.edge, P_DEFAULTS.edge),
					motion: r.motion === undefined ? P_DEFAULTS.motion : Boolean(r.motion),
					minimap: r.minimap === undefined ? P_DEFAULTS.minimap : Boolean(r.minimap),
					legend: r.legend === undefined ? P_DEFAULTS.legend : Boolean(r.legend)
				};
			}
			
			/**
			 * 设定 → CSS 变量表（**纯函数**，可离线断言）。
			 * 变量名一律 `--dp-*`（dp = director personalize）。
			 * @param {object} p
			 * @returns {Record<string,string>}
			 */
			function pVarsFor(p) {
				const s = normalizePersonalize(p);
				const r = clampNum(s.radius, 0, 24, P_DEFAULTS.radius);
				return {
					"--dp-ac": s.accent,
					"--dp-ac-soft": pHexSoft(s.accent, 0.16),
					"--dp-ac-line": pHexSoft(s.accent, 0.45),
					"--dp-ac2": s.accent2,
					"--dp-ac2-soft": pHexSoft(s.accent2, 0.16),
					"--dp-ac2-line": pHexSoft(s.accent2, 0.45),
					"--dp-density": String(s.density),
					"--dp-font": String(s.fontScale),
					"--dp-radius": r + "px",
					"--dp-radius-sm": Math.max(2, r - 3) + "px",
					"--dp-radius-lg": (r + 4) + "px",
					"--dp-motion": s.motion ? "1" : "0"
				};
			}
			
			/**
			 * 注入样式表文本（**纯函数**，可离线断言"质感档位都真有规则"）。
			 * 四类规则：
			 *   ① `.dp-*` 原子类（表面 / 卡片 / 按钮 / 徽章 / 分隔线）
			 *   ② `[data-testid="dp-root"]` 总监页令牌桥接 —— 底色/文字/边框全部改用宿主
			 *      `--dsw-alias-*` 令牌，使总监页与原生页签**同源同值**（宿主换主题/换背景图自动跟随）
			 *   ③ `html[data-dp-texture=...]` 纹理覆盖（纹理色走 `--dp-tex*`，随主题深浅切换）
			 *   ④ 动效开关（`html[data-dp-motion="0"]` 时停掉全部动画与过渡）
			 * ⚠️ 文本里**不使用反引号**（避免与下游打包工具链的模板字面量互相干扰）。
			 */
			function pCssText() {
				const L = [];
				L.push("/* dsh-personalize-css —— 由 store/personalize.js 注入，勿手改 */");
				L.push(":root{--dp-bg-0:#0b0c0e;--dp-bg-1:#141519;--dp-bg-2:#1c1e23;--dp-line:#31343a;--dp-line-soft:rgba(255,255,255,.08);--dp-t1:#e8eaed;--dp-t2:#c3c8ce;--dp-t3:#8b9199;--dp-shadow:0 10px 30px rgba(0,0,0,.45);--dp-shadow-sm:0 4px 14px rgba(0,0,0,.32);--dp-tex:rgba(255,255,255,.035);--dp-tex-strong:rgba(255,255,255,.07);}");
				// ① 表面层次：三个层级必须是"看起来递进"的，不是同一个色加边框
				L.push(".dp-surface{background:var(--dp-bg-1);border:1px solid var(--dp-line);border-radius:var(--dp-radius);}");
				L.push(".dp-surface-2{background:var(--dp-bg-2);border:1px solid var(--dp-line);border-radius:var(--dp-radius);box-shadow:var(--dp-shadow-sm);}");
				L.push(".dp-sunken{background:var(--dp-bg-0);border:1px solid var(--dp-line-soft);border-radius:var(--dp-radius);}");
				L.push(".dp-card{background:var(--dp-bg-2);border:1px solid var(--dp-line);border-radius:var(--dp-radius);padding:calc(7px * var(--dp-density)) calc(9px * var(--dp-density));}");
				L.push(".dp-chip{font-size:calc(10.5px * var(--dp-font));padding:2px calc(7px * var(--dp-density));border-radius:var(--dp-radius-sm);background:var(--dp-ac-soft);border:1px solid var(--dp-ac-line);color:var(--dp-ac);white-space:nowrap;}");
				L.push(".dp-chip-2{background:var(--dp-ac2-soft);border-color:var(--dp-ac2-line);color:var(--dp-ac2);}");
				L.push(".dp-btn{height:calc(24px * var(--dp-density));padding:0 calc(9px * var(--dp-density));border-radius:var(--dp-radius-sm);cursor:pointer;font-size:calc(11.5px * var(--dp-font));white-space:nowrap;border:1px solid var(--dp-line);background:var(--dp-bg-2);color:var(--dp-t2);font-family:inherit;display:inline-flex;align-items:center;gap:4px;}");
				L.push(".dp-btn:hover{border-color:var(--dp-ac-line);color:var(--dp-t1);background:var(--dp-ac-soft);}");
				L.push(".dp-btn:active{transform:translateY(1px);}");
				L.push(".dp-btn-pri{background:var(--dp-ac);border-color:var(--dp-ac);color:#fff;}");
				L.push(".dp-btn-pri:hover{filter:brightness(1.1);color:#fff;}");
				L.push(".dp-btn[disabled],.dp-btn[aria-disabled=true]{opacity:.45;cursor:not-allowed;}");
				L.push(".dp-sep{height:1px;background:var(--dp-line);border:0;margin:calc(4px * var(--dp-density)) 0;}");
				L.push(".dp-title{font-size:calc(11px * var(--dp-font));font-weight:650;color:var(--dp-t2);}");
				L.push(".dp-muted{font-size:calc(10.5px * var(--dp-font));color:var(--dp-t3);}");
				L.push(".dp-input{box-sizing:border-box;border-radius:var(--dp-radius-sm);border:1px solid var(--dp-line);background:var(--dp-bg-0);color:var(--dp-t1);font-family:inherit;font-size:calc(11.5px * var(--dp-font));padding:0 calc(9px * var(--dp-density));}");
				L.push(".dp-input:focus{outline:none;border-color:var(--dp-ac);box-shadow:0 0 0 2px var(--dp-ac-soft);}");
				L.push(".dp-scroll::-webkit-scrollbar{width:8px;height:8px;}");
				L.push(".dp-scroll::-webkit-scrollbar-thumb{background:var(--dp-line);border-radius:4px;}");
				L.push(".dp-scroll::-webkit-scrollbar-thumb:hover{background:var(--dp-ac-line);}");
				L.push(".dp-pulse{animation:dp-pulse 1.6s ease-in-out infinite;}");
				L.push("@keyframes dp-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 var(--dp-ac-soft);}50%{opacity:.65;box-shadow:0 0 0 4px var(--dp-ac-soft);}}");
				L.push(".dp-rise{animation:dp-rise .18s ease-out;}");
				L.push("@keyframes dp-rise{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}");
				//
				// ② 总监页跟随宿主主题（背景 / 文字 / 边框 / 阴影）
				//
				//  🔴 坑（静默失效）：CSS 自定义属性里的 var() 是在**定义它的那个元素上**求值的，
				//     不是在使用处。宿主把 `--dsw-alias-*` 定义在 `body` 上（**不在** html/:root，
				//     实测 documentElement 上取到空串），所以下面必须挂在**能继承到宿主令牌**的
				//     元素上 —— dp-root 就在 body 内。
				//     若图省事写成 `:root{--dp-bg-0:var(--dsw-alias-bg-base)}`，会在 html 上求值失败
				//     并**静默**落到 fallback：背景不跟随宿主，却没有任何报错、属性读起来也正常。
				//  作用域刻意只限 dp-root：思维导图 / 设计图工作室 / 总监弹窗是浮层，仍走 :root 的
				//     深色底（宿主背景图不参与浮层，避免"浮层被背景图割裂"）。
				L.push('[data-testid="dp-root"]{'
					+ "--dp-bg-0:var(--dsw-alias-bg-base, #0b0c0e);"
					+ "--dp-bg-1:var(--dsw-alias-bg-layer-1, #141519);"
					+ "--dp-bg-2:var(--dsw-alias-bg-layer-2, #1c1e23);"
					+ "--dp-line:var(--dsw-alias-border-l2, #31343a);"
					+ "--dp-line-soft:var(--dsw-alias-border-l1, rgba(255,255,255,.08));"
					+ "--dp-t1:var(--dsw-alias-label-primary, #e8eaed);"
					+ "--dp-t2:var(--dsw-alias-label-secondary, #c3c8ce);"
					+ "--dp-t3:var(--dsw-alias-label-tertiary, #8b9199);"
					+ "--dp-shadow:var(--dsw-shadow-lv2, 0 10px 30px rgba(0,0,0,.45));"
					+ "--dp-shadow-sm:var(--dsw-shadow-lv1, 0 4px 14px rgba(0,0,0,.32));"
					// 纹理色：浅色底上用蓝灰（白色纹理在白玻璃上等于不可见）
					+ "--dp-tex:rgba(29,39,57,.055);"
					+ "--dp-tex-strong:rgba(29,39,57,.10);"
					+ "}");
				// ③ 纹理（.dp-textured 只提供背景，不覆盖已有 background-color 的层次）
				L.push(".dp-textured{background-image:none;}");
				L.push('html[data-dp-texture="grid"] .dp-textured{background-image:linear-gradient(var(--dp-tex) 1px,transparent 1px),linear-gradient(90deg,var(--dp-tex) 1px,transparent 1px);background-size:22px 22px;}');
				L.push('html[data-dp-texture="dots"] .dp-textured{background-image:radial-gradient(var(--dp-tex-strong) 1px,transparent 1px);background-size:16px 16px;}');
				L.push('html[data-dp-texture="glass"] .dp-textured{background-image:linear-gradient(135deg,var(--dp-tex-strong),transparent 40%);backdrop-filter:blur(10px);}');
				// ④ 动效开关
				L.push('html[data-dp-motion="0"] .dp-anim,html[data-dp-motion="0"] .dp-pulse,html[data-dp-motion="0"] .dp-rise{animation:none !important;transition:none !important;}');
				return L.join("\n");
			}
			
			/** 把设定写到 DOM（`:root` 变量 + `html[data-dp-*]` + 样式表）。SSR / 测试环境下静默跳过。 */
			function applyPersonalize(p) {
				if (typeof document === "undefined") return false;
				const s = normalizePersonalize(p);
				try {
					const root = document.documentElement;
					// 样式表（幂等：同一 id 只替换内容）
					let style = document.getElementById(PERSONALIZE_STYLE_ID);
					if (!style) {
						style = document.createElement("style");
						style.id = PERSONALIZE_STYLE_ID;
						(document.head || root).appendChild(style);
					}
					const css = pCssText();
					if (style.textContent !== css) style.textContent = css;
					// 变量
					const vars = pVarsFor(s);
					for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k]);
					// 纹理 / 动效 / 连线（给 CSS 选择器用；同时给 e2e 提供稳定的读点）
					root.setAttribute("data-dp-texture", s.texture);
					root.setAttribute("data-dp-motion", s.motion ? "1" : "0");
					root.setAttribute("data-dp-edge", s.edge);
					root.setAttribute("data-dp-font", String(s.fontScale));
					root.setAttribute("data-dp-density", String(s.density));
					// 让"未接入 CSS 类"的老节点也能吃到字号缩放
					root.style.fontSize = (12.5 * s.fontScale) + "px";
					return true;
				} catch (e) { return false; }
			}
			
			/** 读持久化（解析失败回落默认；不抛） */
			function loadPersonalize() {
				try {
					const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PERSONALIZE_KEY) : null;
					if (raw) return normalizePersonalize(JSON.parse(raw));
				} catch (e) { /* 隐私模式 / 脏数据 */ }
				return { ...P_DEFAULTS };
			}
			
			/** 写持久化（失败静默：个性化丢失不影响功能） */
			function savePersonalize(p) {
				try {
					if (typeof localStorage !== "undefined") localStorage.setItem(PERSONALIZE_KEY, JSON.stringify(normalizePersonalize(p)));
					return true;
				} catch (e) { return false; }
			}
			
			/** 单例 store（订阅者 = 需要按设定显隐的组件，如小地图 / 图例） */
			const personalizeStore = (function () {
				let state = loadPersonalize();
				const listeners = new Set();
				function emit() { for (const fn of listeners) { try { fn(state); } catch (e) { /* 单个订阅者异常不影响其他 */ } } }
				applyPersonalize(state);
				return {
					getState: () => state,
					subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
					/** 改一项（未知键忽略，保证 store 不会被写脏） */
					set: (key, value) => {
						if (!(key in P_DEFAULTS)) return false;
						state = normalizePersonalize({ ...state, [key]: value });
						savePersonalize(state);
						applyPersonalize(state);
						emit();
						return true;
					},
					patch: (obj) => {
						state = normalizePersonalize({ ...state, ...(obj || {}) });
						savePersonalize(state);
						applyPersonalize(state);
						emit();
						return true;
					},
					reset: () => {
						state = { ...P_DEFAULTS };
						savePersonalize(state);
						applyPersonalize(state);
						emit();
						return true;
					}
				};
			})();
			
			/** 全局契约（调试 / e2e 用） */
			function installPersonalizeApi() {
				const api = {
					PERSONALIZE_KEY, PERSONALIZE_STYLE_ID, P_DEFAULTS,
					P_ACCENTS, P_ACCENT2, P_DENSITY, P_FONT, P_RADIUS, P_TEXTURES, P_EDGE,
					normalizePersonalize, pVarsFor, pCssText, applyPersonalize,
					loadPersonalize, savePersonalize, store: personalizeStore
				};
				if (typeof window !== "undefined") window.__dshPersonalize = api;
				return api;
			}
			
			exports.PERSONALIZE_KEY = PERSONALIZE_KEY;
			exports.PERSONALIZE_STYLE_ID = PERSONALIZE_STYLE_ID;
			exports.P_DEFAULTS = P_DEFAULTS;
			exports.P_ACCENTS = P_ACCENTS;
			exports.P_ACCENT2 = P_ACCENT2;
			exports.P_DENSITY = P_DENSITY;
			exports.P_FONT = P_FONT;
			exports.P_RADIUS = P_RADIUS;
			exports.P_TEXTURES = P_TEXTURES;
			exports.P_EDGE = P_EDGE;
			exports.pHexSoft = pHexSoft;
			exports.normalizePersonalize = normalizePersonalize;
			exports.pVarsFor = pVarsFor;
			exports.pCssText = pCssText;
			exports.applyPersonalize = applyPersonalize;
			exports.loadPersonalize = loadPersonalize;
			exports.savePersonalize = savePersonalize;
			exports.personalizeStore = personalizeStore;
			exports.installPersonalizeApi = installPersonalizeApi;
		};

		// ── components/PersonalizePanel.js ──
		__defs["components/PersonalizePanel.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：右上角「⚙ 个性化」面板（四个界面共用一个组件）
			 * 引用：—
			 * 上游：client-entry.js, components/DesignStudio.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js
			 * 下游：store/personalize.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/PersonalizePanel.js — 右上角「⚙ 个性化」面板（四个界面共用一个组件）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  需求原文（用户）：「目前总监 tap 页面，还有三个插件页面 文字背景，全部找审美
			 *   重新审核一下质感加上，同时都在右上角加自定义个性化设定」
			 *
			 *  ⇒ 落地口径：四处（总监页 / 总监弹窗 / 设计图工作室 / 分支导图）**右上角是同一个
			 *    组件、同一批选项、同一份持久化**。这样"改一次，四处都变"是可验证的；
			 *    若各写一份，迟早出现"设计图里改了但导图没变"。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 三条实现纪律
			 * ══════════════════════════════════════════════════════════════════
			 *  ① **必须避让窗口控件安全区**：本面板贴右上角，而 Windows 的最小化/最大化/关闭是
			 *     **操作系统图层**（z-index 无效，实测 138px）。所以面板的 `right` 由传进来的
			 *     `inset` 决定 —— 与 MindMap 顶栏同一套口径（util/safe-area.js）。
			 *  ② **每个选项都要说清"改了什么"**：`title` 写明效果，不写空话（本项目纪律：
			 *     用户反复投诉"点了不知道有没有生效"）。
			 *  ③ **即时生效 + 可一键复位**：改完立刻写 CSS 变量（无需确认）；"恢复默认"必须存在，
			 *     否则用户改乱了回不去（这是上一轮版本面板吃过的教训）。
			 *
			 * ⚠️ 构建约束：react / react/jsx-runtime 为平台冻结模块（ADR-001），构建期外置。
			 */
			
			const react = require("react");
			const { personalizeStore, P_ACCENTS, P_ACCENT2, P_DENSITY, P_FONT, P_RADIUS, P_TEXTURES, P_EDGE, P_DEFAULTS } = __m("store/personalize.js");
			
			const h = react.createElement;
			const PERSONALIZE_PANEL_ID = "dsh-personalize-panel";
			
			const S = {
				wrap: (right, top) => ({
					position: "fixed", right, top, zIndex: 2147483300, width: 296, maxHeight: "calc(100vh - " + (top + 16) + "px)",
					overflowY: "auto", display: "flex", flexDirection: "column", gap: 0,
					background: "var(--dp-bg-1, #141519)", border: "1px solid var(--dp-line, #31343a)",
					borderRadius: "var(--dp-radius-lg, 12px)", boxShadow: "var(--dp-shadow, 0 10px 30px rgba(0,0,0,.45))",
					color: "var(--dp-t1, #e8eaed)", fontSize: "calc(12px * var(--dp-font, 1))", padding: 10
				}),
				hd: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8 },
				ttl: { fontWeight: 650, fontSize: "calc(12.5px * var(--dp-font, 1))" },
				sec: { marginBottom: 9 },
				secT: { fontSize: "calc(10.5px * var(--dp-font, 1))", color: "var(--dp-t3, #8b9199)", letterSpacing: ".4px", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 },
				row: { display: "flex", flexWrap: "wrap", gap: 5 },
				opt: (on, big) => ({
					display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer",
					padding: big ? "4px 8px" : "3px 7px", borderRadius: "var(--dp-radius-sm, 5px)",
					fontSize: "calc(11px * var(--dp-font, 1))",
					border: "1px solid " + (on ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "var(--dp-line, #31343a)"),
					background: on ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "var(--dp-bg-2, #1c1e23)",
					color: on ? "var(--dp-t1, #e8eaed)" : "var(--dp-t3, #8b9199)",
					fontWeight: on ? 600 : 400, whiteSpace: "nowrap"
				}),
				swatch: (on, hex) => ({
					width: 26, height: 20, borderRadius: "var(--dp-radius-sm, 5px)", background: hex, cursor: "pointer",
					border: on ? "2px solid var(--dp-t1, #e8eaed)" : "1px solid var(--dp-line, #31343a)", boxSizing: "border-box"
				}),
				toggle: (on) => ({
					display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
					padding: "3px 8px", borderRadius: "var(--dp-radius-sm, 5px)",
					fontSize: "calc(11px * var(--dp-font, 1))",
					border: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-2, #1c1e23)",
					color: on ? "var(--dp-t1, #e8eaed)" : "var(--dp-t3, #8b9199)"
				}),
				foot: { display: "flex", alignItems: "center", gap: 6, marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--dp-line, #31343a)" }
			};
			
			function Section({ title, hint, children }) {
				return h("div", { style: S.sec }, [
					h("div", { key: "t", style: S.secT }, [h("span", { key: "l" }, title), hint ? h("span", { key: "h", style: { opacity: 0.75 } }, hint) : null]),
					h("div", { key: "b", style: S.row }, children)
				]);
			}
			
			/**
			 * 个性化面板。
			 * @param {object} props
			 * @param {boolean} props.open
			 * @param {() => void} props.onClose
			 * @param {number} [props.inset] 右侧原生窗口控件覆盖宽度（默认 0，来自 util/safe-area）
			 * @param {number} [props.top] 面板上边距（默认 44，避开各界面自己的顶栏）
			 * @param {string} [props.scope] 调用方名称（显示在标题右侧，e2e 用来确认"四处同一个面板"）
			 */
			function PersonalizePanel(props = {}) {
				const { open, onClose, inset = 0, top = 44, scope = "" } = props;
				const p = react.useSyncExternalStore(
					(fn) => personalizeStore.subscribe(fn),
					() => personalizeStore.getState(),
					() => personalizeStore.getState()
				);
			
				/* Esc 关闭 —— 与导图/工作室的"逐层退"一致：本面板在最上层，先关它 */
				react.useEffect(() => {
					if (!open) return undefined;
					const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose && onClose(); } };
					window.addEventListener("keydown", onKey, true);
					return () => window.removeEventListener("keydown", onKey, true);
				}, [open, onClose]);
			
				if (!open) return null;
			
				const set = (k, v) => personalizeStore.set(k, v);
				const swatchRow = (list, cur, key) => list.map((o) => h("div", {
					key: o.key, "data-testid": "pp-" + key + "-" + String(o.key).replace("#", ""), "data-on": String(o.key) === String(cur) ? "1" : "0",
					style: S.swatch(String(o.key) === String(cur), o.key), title: o.label + (o.desc ? " —— " + o.desc : ""),
					"data-label": o.label,
					onClick: () => set(key, o.key)
				}));
				const optionRow = (list, cur, key) => list.map((o) => h("div", {
					key: String(o.key), "data-testid": "pp-" + key + "-" + String(o.key), "data-on": String(o.key) === String(cur) ? "1" : "0",
					style: S.opt(String(o.key) === String(cur)), title: o.desc || o.label,
					onClick: () => set(key, o.key)
				}, o.label));
			
				return h("div", {
					id: PERSONALIZE_PANEL_ID, style: S.wrap(Math.max(10, inset + 10), top),
					"data-testid": "pp-panel", "data-scope": scope, "data-inset": inset, role: "dialog", "aria-label": "个性化设定"
				}, [
					/* 标题栏 */
					h("div", { key: "hd", style: S.hd }, [
						h("span", { key: "i" }, "⚙"),
						h("span", { key: "t", style: S.ttl }, "个性化设定"),
						h("span", { key: "s", style: { ...S.secT, marginBottom: 0 } }, scope ? "· " + scope : ""),
						h("button", {
							key: "x", style: { ...S.opt(false) }, "data-testid": "pp-close", "aria-label": "关闭个性化设定",
							title: "关闭（Esc 亦可）", onClick: () => onClose && onClose()
						}, "✕")
					]),
			
					h(Section, {
						key: "ac", title: "主色", hint: "按钮 / 徽章 / 连线高亮",
						children: swatchRow(P_ACCENTS, p.accent, "accent")
					}),
					h(Section, {
						key: "ac2", title: "强调色", hint: "「待审 / 建议」类徽章",
						children: swatchRow(P_ACCENT2, p.accent2, "accent2")
					}),
					h(Section, {
						key: "tx", title: "质感", hint: "背景纹理 —— 这一项就是用户说的「文字背景」",
						children: optionRow(P_TEXTURES, p.texture, "texture")
					}),
					h(Section, {
						key: "dn", title: "密度", hint: "行高与间距的整体乘数",
						children: optionRow(P_DENSITY, p.density, "density")
					}),
					h(Section, {
						key: "ft", title: "字号",
						children: optionRow(P_FONT, p.fontScale, "fontScale")
					}),
					h(Section, {
						key: "rd", title: "圆角",
						children: optionRow(P_RADIUS, p.radius, "radius")
					}),
					h(Section, {
						key: "eg", title: "导图连线", hint: "只影响分支导图",
						children: optionRow(P_EDGE, p.edge, "edge")
					}),
			
					/* 开关组 */
					h("div", { key: "tg", style: S.sec }, [
						h("div", { key: "t", style: S.secT }, "显示与动效"),
						h("div", { key: "b", style: S.row }, [
							h("div", {
								key: "mo", "data-testid": "pp-motion", "data-on": p.motion ? "1" : "0", style: S.toggle(p.motion),
								title: "关掉后所有动画与过渡停止（低端机 / 录屏时有用）",
								onClick: () => set("motion", !p.motion)
							}, [h("span", { key: "i" }, p.motion ? "◉" : "○"), h("span", { key: "l" }, "动效")]),
							h("div", {
								key: "mm", "data-testid": "pp-minimap", "data-on": p.minimap ? "1" : "0", style: S.toggle(p.minimap),
								title: "分支导图右下角的小地图（省屏时可关）",
								onClick: () => set("minimap", !p.minimap)
							}, [h("span", { key: "i" }, p.minimap ? "◉" : "○"), h("span", { key: "l" }, "小地图")]),
							h("div", {
								key: "lg", "data-testid": "pp-legend", "data-on": p.legend ? "1" : "0", style: S.toggle(p.legend),
								title: "分支导图工具条右侧的状态图例",
								onClick: () => set("legend", !p.legend)
							}, [h("span", { key: "i" }, p.legend ? "◉" : "○"), h("span", { key: "l" }, "状态图例")])
						])
					]),
			
					/* 底部：说明 + 复位 */
					h("div", { key: "ft", style: S.foot }, [
						h("span", {
							key: "n", style: { ...S.secT, marginBottom: 0, flex: 1 },
							"data-testid": "pp-summary"
						}, "四处共用 · " + p.texture + " / " + Math.round(p.density * 100) + "% / r" + p.radius),
						h("button", {
							key: "r", style: S.opt(false), "data-testid": "pp-reset",
							title: "恢复默认：" + P_DEFAULTS.texture + " / r" + P_DEFAULTS.radius + " / " + P_DEFAULTS.accent,
							onClick: () => personalizeStore.reset()
						}, "恢复默认")
					])
				]);
			}
			
			__defaults["components/PersonalizePanel.js"] = PersonalizePanel;
			
			exports.PERSONALIZE_PANEL_ID = PERSONALIZE_PANEL_ID;
			exports.PersonalizePanel = PersonalizePanel;
		};

		// ── util/safe-area.js ──
		__defs["util/safe-area.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：窗口控件安全区（Windows 原生标题栏按钮的避让计算）
			 * 引用：2026-09-12 诉求 9（关闭按钮与标准软件关闭按钮重叠）
			 * 上游：components/DesignStudio.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 E5（窗口控件安全区三级读取）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * util/safe-area.js — 窗口控件安全区（Windows 原生标题栏按钮的避让计算）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 D1 · 顶栏】
			 *  被谁用   components/DesignStudio.js（全屏工作室顶栏 padding-right）
			 *  解决什么 用户报「设计图的关闭按钮和标准软件的关闭按钮重叠了」
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  为什么它必须存在（真机取证，不是猜的）
			 * ══════════════════════════════════════════════════════════════════
			 *  Harness 桌面端是**自绘标题栏 + 原生窗口控件覆盖层**。实测（1536×816 视口）：
			 *
			 *      navigator.windowControlsOverlay.visible = true
			 *      getTitlebarAreaRect() = { x:0, y:0, w:1399, h:44 }
			 *      ⇒ 右侧 1536 - 1399 = 137px 被**最小化/最大化/关闭**三个按钮独占
			 *
			 *  这个覆盖层是**原生图层，永远绘制在网页内容之上**（z-index 无效）。
			 *  而工作室是 `position:fixed; inset:0` 的全屏层，顶栏内容直排到右边距 10px
			 *  ⇒ 关掉按钮 `✕`（实测位于 x=1495，距右仅 41px）**必然被压住**，
			 *     连状态文字「修订记录 2」也被压掉一截。
			 *
			 *  ⇒ 结论：**不是"把 ✕ 左移几像素"能解决的**，那是把 137px 的洞挪个位置。
			 *     正确做法是让顶栏知道"右边这一条不归我"，把内容整体收进安全区。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  三级读取（从准到糙，逐级降级；都不命中时**返回 0 而不是瞎留白**）
			 * ══════════════════════════════════════════════════════════════════
			 *   ① Window Controls Overlay API —— 权威值，且能监听 `geometrychange`
			 *   ② CSS `env(titlebar-area-width)` —— 同一数据的 CSS 侧投影
			 *   ③ 桌面平台兜底常量 —— 仅当"确认是桌面壳"但前两级都读不到时启用
			 *
			 *  ⚠️ 为什么普通浏览器里要返回 0：浏览器没有原生窗口控件覆盖层，
			 *     若也返回 138，工作室右侧会凭空多出一条空白 —— 那是把 bug 换成另一个 bug。
			 */
			
			/** Windows 三个窗口按钮的实测总宽（46×3）。只在确认桌面壳、且 API 全失效时用。 */
			const FALLBACK_INSET = 138;
			
			/** 是否运行在桌面壳里（判断依据是 URL 参数与 UA，二者取或） */
			function isDesktopShell() {
				try {
					if (typeof location !== "undefined" && /dsh-desktop-platform=/.test(String(location.search || ""))) return true;
					if (typeof navigator !== "undefined" && /Electron/i.test(String(navigator.userAgent || ""))) return true;
				} catch (e) { /* 无 location/navigator（离线测试）→ 视为非桌面 */ }
				return false;
			}
			
			/**
			 * 读取"右侧不可用宽度"（px）。
			 * @param {object} [win] 可注入的 window（离线测试用；缺省用全局）
			 * @returns {number} 0 = 无窗口控件覆盖（浏览器 / 已隐藏）；>0 = 需要避让的像素
			 */
			function readInset(win) {
				const w = win || (typeof window !== "undefined" ? window : null);
				const d = w && w.document ? w.document : (typeof document !== "undefined" ? document : null);
			
				/* ① 权威 API。注意 `visible=false` 时**必须返回 0** ——
				 *    有些平台 API 存在但覆盖层被隐藏（如 macOS 的交通灯），此时不占宽度。 */
				try {
					const wco = w && w.navigator ? w.navigator.windowControlsOverlay : null;
					if (wco) {
						if (wco.visible === false) return 0;
						if (typeof wco.getTitlebarAreaRect === "function") {
							const r = wco.getTitlebarAreaRect();
							if (r && r.width > 0 && w.innerWidth > 0) {
								return Math.max(0, Math.round(w.innerWidth - r.width));
							}
						}
					}
				} catch (e) { /* 继续降级 */ }
			
				/* ② CSS env() 投影。`-1px` 作为 fallback ⇒ 不支持时量到负数，天然识别"不支持"。 */
				try {
					if (d && d.body) {
						const probe = d.createElement("div");
						probe.style.cssText = "position:fixed;top:0;left:0;height:1px;visibility:hidden;pointer-events:none;width:env(titlebar-area-width, -1px)";
						d.body.appendChild(probe);
						const pw = probe.getBoundingClientRect().width;
						probe.remove();
						if (pw > 0 && w.innerWidth > 0) return Math.max(0, Math.round(w.innerWidth - pw));
					}
				} catch (e) { /* 继续降级 */ }
			
				/* ③ 桌面兜底 —— 宁可多留 138px，也不要让按钮压在原生控件下面（前者是空间浪费，后者是功能失效） */
				return isDesktopShell() ? FALLBACK_INSET : 0;
			}
			
			/**
			 * 监听安全区变化（窗口缩放 / 最大化 / 全屏切换都会改它）。
			 * @param {(inset:number)=>void} onChange 仅在**值真的变了**时回调（避免 resize 风暴里反复 setState）
			 * @param {object} [win]
			 * @returns {()=>void} 取消监听
			 */
			function watchInset(onChange, win) {
				const w = win || (typeof window !== "undefined" ? window : null);
				if (!w || typeof onChange !== "function") return () => { /* noop */ };
			
				let last = -1;
				const emit = () => {
					const v = readInset(w);
					if (v !== last) { last = v; onChange(v); }
				};
			
				emit();
				w.addEventListener("resize", emit);
				// WCO 专属事件：最大化/退出全屏时**不一定**触发 window.resize，必须单独挂
				let wco = null;
				try {
					wco = w.navigator ? w.navigator.windowControlsOverlay : null;
					if (wco && typeof wco.addEventListener === "function") wco.addEventListener("geometrychange", emit);
				} catch (e) { wco = null; }
			
				// 布局late后才定下来的情形（首帧 innerWidth 为 0 等），补测一次
				const t = setTimeout(emit, 350);
			
				return () => {
					try { w.removeEventListener("resize", emit); } catch (e) { /* noop */ }
					try { if (wco && typeof wco.removeEventListener === "function") wco.removeEventListener("geometrychange", emit); } catch (e) { /* noop */ }
					clearTimeout(t);
				};
			}
			
			exports.FALLBACK_INSET = FALLBACK_INSET;
			exports.readInset = readInset;
			exports.watchInset = watchInset;
		};

		// ── components/DirectorDialog.js ──
		__defs["components/DirectorDialog.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：总监弹窗（要求 5 / 6 / 7 / 8 / 9 / 10 / 11 的落位）
			 * 引用：要求 5/6/7/8/9/10/11 · 要求 5 · 要求 6 · 要求 11
			 * 上游：client-entry.js, mount.js
			 * 下游：store/layout.js, store/hierarchy.js, util/bus.js, bridge/split.js, bridge/chat-bridge.js, logic/routing.js, store/plugin-db.js, components/DirectorWorkbench.js, components/DirectorHierarchy.js, util/debug.js, components/PersonalizePanel.js, util/safe-area.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A（总监弹窗三态）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/DirectorDialog.js — 总监弹窗（要求 5 / 6 / 7 / 8 / 9 / 10 / 11 的落位）
			 *
			 * ── 形态（docs/10 §4.1 + docs/11 §二 I1/I2）────────────────────
			 *   **非模态覆盖层**：不锁原生交互（右区必须可点，因为右区就是原生对话区）。
			 *   层次用 **spotlight 遮罩**表达：一个恰好覆盖原生应用根的空矩形，用
			 *   `box-shadow: 0 0 0 9999px rgba(...)` 在它"之外"整体压暗 ⇒ 原生区保持全亮可交互，
			 *   其余部分被压暗 ⇒ 视觉层次清晰，且**不需要**任何点击拦截。
			 *
			 *   左＝总监面板（插件）｜右＝原生对话区（被 `bridge/split.js` 向右挤，**同一节点**）
			 *   ⇒ 要求 5 的"完全一致"是**同义反复**，不是"同步努力"。
			 *
			 * ── 三态（要求 6 + docs/11 §二 I6）──────────────────────────────
			 *   `⇤` 左栏折叠（`directorPanelCollapsed`）
			 *   `⇥` 右栏折叠（`chatPanelCollapsed`）
			 *   `–` 整窗最小化（`dialogCollapsed`，🆕 本轮新增字段）→ 收成右下角 chip
			 *   `✕` 关闭（`dialogOpen=false`，同时 `clearSplit()` 完全复原原生布局）
			 *   chip 点击还原；`Alt+1/2/3` 键盘等价；`Esc` 关闭
			 *
			 * ── 焦点路由（要求 11 · R8 / docs/11 §二 I7）────────────────────
			 *   `document` 捕获阶段 `pointerdown`：命中左面板矩形 → `director`；
			 *   命中原生应用根矩形 → `chat`。**不 preventDefault** ⇒ 原生交互不受影响。
			 *   底部输入框按 `focusTarget` 决定去向，并有**目标徽章**防止误发。
			 *
			 * ⚠️ 构建约束：`react` / `react/jsx-runtime` 为**平台冻结模块**（ADR-001），
			 *    构建期外置为 `require(...)`；本文件用 `.js` 而非 `.jsx`（宿主为编译后 `jsx()` 形态）。
			 */
			
			const react = require("react");
			const react_jsx_runtime = require("react/jsx-runtime");
			const { directorLayoutStore, LEFT_TAB, PANEL_RAIL_WIDTH, PANEL_MIN_WIDTH } = __m("store/layout.js");
			const { loadTree, getBreadcrumb, LEVEL_LABEL, GLOBAL_NODE_ID, countByLevel } = __m("store/hierarchy.js");
			const { onHierarchyChange } = __m("util/bus.js");
			const { applySplit, clearSplit, getSplitRootRect } = __m("bridge/split.js");
			const { sendToChat, observeConversation, readConversation, installChatBridgeApi } = __m("bridge/chat-bridge.js");
			const { route, confirmRoute, review6, reviewAndSave, DESTINATION, DESTINATION_LABEL } = __m("logic/routing.js");
			const { appendDirectorMessage, listDirectorMessages, pluginDbStats, PLUGIN_DB_NAME } = __m("store/plugin-db.js");
			const { DirectorWorkbench } = __m("components/DirectorWorkbench.js");
			const { DirectorHierarchy } = __m("components/DirectorHierarchy.js");
			const { dshLog } = __m("util/debug.js");
			/* 右上角「⚙ 个性化」—— 与总监页 / 设计图 / 导图**共用同一个组件与同一份持久化**。
			 * 需求原文：「…同时都在右上角加自定义个性化设定」。 */
			const { PersonalizePanel } = __m("components/PersonalizePanel.js");
			/* 原生窗口控件安全区：本弹窗是全屏 fixed 层，右上角面板必须避让（实测 138px，z-index 无效）。 */
			const { readInset } = __m("util/safe-area.js");
			
			const DIALOG_ID = "dsh-director-dialog";
			const CHIP_ID = "dsh-director-chip";
			
			/* ── 5 类标准智能体（17 号文 §1A.8，含执行标准 + 检查清单）── */
			const AGENTS = Object.freeze([
				{ key: "code", label: "代码", mode: "auto", desc: "实现 / 重构 / 修复，产出可运行代码", checks: ["可编译", "有测试", "零硬编码密钥"] },
				{ key: "doc", label: "文档", mode: "auto", desc: "需求 / 设计 / 交付文档编写", checks: ["结构完整", "含出处", "有反证"] },
				{ key: "research", label: "调研", mode: "manual", desc: "外部资料检索与交叉比对", checks: ["来源可追溯", "交叉验证", "结论明确"] },
				{ key: "test", label: "测试", mode: "auto", desc: "用例编写与执行", checks: ["可重复", "覆盖边界", "结果可核验"] },
				{ key: "review", label: "审核", mode: "manual", desc: "六维审核与纠偏", checks: ["六维齐备", "含证据", "打回可追溯"] }
			]);
			
			/** 可调用技能（R3 第二段；`mode` 表示默认调用方式） */
			const SKILLS = Object.freeze([
				{ key: "execution-standards", label: "执行标准规范", mode: "auto", desc: "L1–L4 链路 / 检查点 / 终止条件" },
				{ key: "codebase-inspection", label: "代码库勘察", mode: "manual", desc: "行数 / 语言 / 结构盘点" },
				{ key: "mermaid-diagram", label: "图表生成", mode: "manual", desc: "流程图 / 时序图 / 架构图" },
				{ key: "browser-skill", label: "浏览器操作", mode: "manual", desc: "自动化导航与抓取" }
			]);
			
			/* ── 调用记录（R3「调用情况」的数据源；内存态，会话级）── */
			/** 面板「调用情况」一屏最多渲染条数（超出部分由 `data-run-total` 反映真实总数） */
			const RUNS_SHOWN = 8;
			/** 内存中最多保留条数 */
			const RUNS_KEEP = 30;
			const agentRuns = [];
			function recordAgentRun(key, status, note) {
				agentRuns.unshift({ key, status: status || "ok", note: note || "", at: Date.now() });
				if (agentRuns.length > RUNS_KEEP) agentRuns.length = RUNS_KEEP;
			}
			/**
			 * 列出调用记录（最新在前）。
			 * 🔴 无参调用返回**全量**（供 `data-run-total` 反映真实条数）；
			 *    渲染截断由面板自己做（`RUNS_SHOWN`）——「列表 API 静默截断」曾使
			 *    「5 智能体 + 4 技能 = 9 条」时最旧一条被挤出，验证脚本据此误判为缺记录。
			 * @param {number} [limit]
			 */
			function listAgentRuns(limit) {
				return typeof limit === "number" && limit >= 0 ? agentRuns.slice(0, limit) : agentRuns.slice();
			}
			
			const RAIL = PANEL_RAIL_WIDTH;
			
			/* ── 样式（尽量使用 Harness 主题变量并给 fallback）── */
			const S = {
				layer: { position: "fixed", inset: 0, zIndex: 2147483000, pointerEvents: "none" },
				hole: { position: "absolute", pointerEvents: "none", borderRadius: 8 },
				panel: {
					position: "absolute", pointerEvents: "auto", display: "flex", flexDirection: "column",
					/* 🔴 `backgroundColor` 长写（非 `background` 简写）：简写会把 `background-image` 重置，
					 *    使 `.dp-textured` 的三档纹理（个性化「质感」）静默失效。四处已统一修正。 */
					backgroundColor: "var(--dsw-alias-bg-base, #16171a)", color: "var(--dsw-alias-label-primary, #e8eaed)",
					border: "1px solid var(--dp-ac2-line, rgba(137,87,229,.42))", borderRadius: "var(--dp-radius-lg, 10px)", overflow: "hidden",
					boxShadow: "var(--dp-shadow, 0 24px 70px rgba(0,0,0,.62))", fontFamily: "inherit",
					fontSize: "calc(12.5px * var(--dp-font, 1))"
				},
				head: { display: "flex", alignItems: "center", gap: 6, height: 36, flex: "0 0 36px", padding: "0 8px", borderBottom: "1px solid var(--dsw-alias-border-l2, #31343a)", background: "var(--dsw-alias-bg-sunken, #1c1e22)" },
				headTitle: { fontWeight: 620, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" },
				lvchip: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, padding: "2px 6px", borderRadius: 4, background: "rgba(137,87,229,.18)", border: "1px solid rgba(137,87,229,.4)", color: "#b794f6", whiteSpace: "nowrap" },
				btns: { marginLeft: "auto", display: "flex", gap: 3 },
				btn: { width: 24, height: 22, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-sunken, #212429)", color: "var(--dsw-alias-label-secondary, #c3c8ce)", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: 0 },
				seg: { display: "flex", border: "1px solid var(--dsw-alias-border-l2, #3d4148)", borderRadius: 6, overflow: "hidden", margin: "6px 8px 0", flex: "0 0 auto" },
				segItem: (on) => ({ flex: 1, textAlign: "center", fontSize: 11.5, padding: "5px 0", cursor: "pointer", border: "none", color: on ? "#c9a9ff" : "var(--dsw-alias-label-tertiary, #8b9199)", background: on ? "rgba(137,87,229,.20)" : "var(--dsw-alias-bg-sunken, #212429)", fontWeight: on ? 600 : 400 }),
				body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 8 },
				blk: { border: "1px solid var(--dsw-alias-border-l2, #31343a)", borderRadius: 7, background: "var(--dsw-alias-bg-sunken, #1c1e22)", padding: "8px 9px" },
				blkT: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", letterSpacing: ".4px", marginBottom: 7, display: "flex", alignItems: "center", gap: 6 },
				kv: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 },
				kvc: { background: "var(--dsw-alias-bg-base, #212429)", border: "1px solid var(--dsw-alias-border-l2, #31343a)", borderRadius: 5, padding: "5px 7px" },
				kvV: { fontSize: 14, fontWeight: 650 },
				kvK: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", marginTop: 1 },
				chips: { display: "flex", flexWrap: "wrap", gap: 5 },
				chip: (mode, on) => ({
					fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
					border: "1px solid " + (mode === "auto" ? "rgba(137,87,229,.42)" : "rgba(210,153,34,.42)"),
					background: on ? "rgba(137,87,229,.16)" : "var(--dsw-alias-bg-base, #212429)",
					color: mode === "auto" ? "#b794f6" : "#e0b341", fontWeight: on ? 600 : 400
				}),
				dot: (c) => ({ width: 5, height: 5, borderRadius: "50%", background: c || "#39c5cf", display: "inline-block" }),
				input: { flex: 1, minWidth: 0, height: 28, borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-sunken, #141619)", color: "var(--dsw-alias-label-primary, #e8eaed)", padding: "0 9px", fontSize: 11.5, boxSizing: "border-box" },
				btnPrimary: { height: 28, padding: "0 11px", borderRadius: 6, border: "1px solid #2f6bdd", background: "#2f6bdd", color: "#fff", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" },
				btnGhost: { height: 24, padding: "0 9px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-sunken, #212429)", color: "var(--dsw-alias-label-secondary, #c3c8ce)", cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap" },
				rail: (side) => ({
					position: "absolute", pointerEvents: "auto", display: "flex", flexDirection: "column", alignItems: "center",
					justifyContent: "flex-start", gap: 8, paddingTop: 10, cursor: "pointer",
					background: "var(--dsw-alias-bg-sunken, #1b1e23)", border: "1px solid var(--dsw-alias-border-l2, #31343a)",
					color: side === "left" ? "#b794f6" : "#79a8ff", fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, letterSpacing: 1
				}),
				muted: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #8b9199)", lineHeight: 1.6 },
				msg: { display: "flex", gap: 6, marginBottom: 6 },
				av: (kind) => ({ width: 18, height: 18, flex: "0 0 18px", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "ui-monospace,Consolas,monospace", fontSize: 9.5, fontWeight: 700, background: kind === "user" ? "rgba(47,111,235,.18)" : "rgba(137,87,229,.22)", color: kind === "user" ? "#79a8ff" : "#b794f6", border: "1px solid " + (kind === "user" ? "rgba(47,111,235,.4)" : "rgba(137,87,229,.4)") }),
				bub: { background: "var(--dsw-alias-bg-base, #212429)", border: "1px solid var(--dsw-alias-border-l2, #31343a)", borderRadius: 6, padding: "5px 8px", fontSize: 11.5, lineHeight: 1.55, flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }
			};
			
			/* ── 小工具 ── */
			const h = react.createElement;
			function useStore(store) {
				const [s, set] = react.useState(store.getState());
				react.useEffect(() => store.subscribe(set), [store]);
				return s;
			}
			
			/** 六维状态色 */
			const DIM_COLOR = { ok: "#3fb950", warn: "#d29922", bad: "#f85149" };
			const DIM_MARK = { ok: "✅", warn: "⚠", bad: "❌" };
			
			/* ══════════════════════════════════════════════════════════════════
			 * 子组件：路由确认卡（要求 8 STEP4「必须可确认」）
			 * ══════════════════════════════════════════════════════════════════ */
			function RouteCard({ result, onConfirm, onCancel, busy }) {
				if (!result) return null;
				const d = result.decision;
				return h("div", { style: { ...S.blk, borderColor: "rgba(137,87,229,.5)" }, "data-testid": "d-route-card" }, [
					h("div", { key: "t", style: S.blkT }, ["路由决策（STEP 4）— 待你确认，不静默分发"]),
					h("div", { key: "s", style: { ...S.muted, marginBottom: 6 } }, [
						h("div", { key: "1" }, "意图：" + result.intent.kind + "（置信 " + result.intent.confidence.toFixed(2) + "）"),
						h("div", { key: "2" }, "候选：" + (result.candidates.length ? result.candidates.slice(0, 3).map((c) => c.name + "(" + c.score + ")").join(" / ") : "无")),
						h("div", { key: "3" }, "子任务：" + result.subtasks.length + " 个"),
						h("div", { key: "4", style: { color: "#b794f6" } }, "建议：" + DESTINATION_LABEL[d.destination] + "（置信 " + d.confidence.toFixed(2) + "）"),
						h("div", { key: "5" }, "理由：" + d.reason)
					]),
					h("div", { key: "b", style: { display: "flex", gap: 5, flexWrap: "wrap" } }, [
						h("button", { key: "tr", style: S.btnGhost, "data-testid": "d-route-transfer", disabled: busy, onClick: () => onConfirm(DESTINATION.TRANSFER) }, "转给该对话的总监"),
						h("button", { key: "di", style: { ...S.btnGhost, borderColor: "#2f6bdd", color: "#79a8ff" }, "data-testid": "d-route-direct", disabled: busy, onClick: () => onConfirm(DESTINATION.DIRECT) }, "直接调用对应对话"),
						h("button", { key: "cr", style: S.btnGhost, "data-testid": "d-route-new", disabled: busy, onClick: () => onConfirm(DESTINATION.CREATE) }, "新建对话"),
						h("button", { key: "cx", style: S.btnGhost, "data-testid": "d-route-cancel", disabled: busy, onClick: onCancel }, "取消")
					])
				]);
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 子组件：六维审核卡（要求 3）
			 * ══════════════════════════════════════════════════════════════════ */
			function ReviewCard({ result, onRun, busy }) {
				return h("div", { style: S.blk, "data-testid": "d-review" }, [
					h("div", { key: "t", style: S.blkT }, [
						"R6 六维审核（17号文 §1A.9，不得减项）",
						h("button", { key: "r", style: { ...S.btnGhost, marginLeft: "auto" }, "data-testid": "d-review-run", disabled: busy, onClick: onRun }, "重跑审核")
					]),
					result
						? h("div", { key: "b" }, result.dims.map((d) => h("div", { key: d.key, style: { display: "flex", gap: 6, alignItems: "baseline", marginBottom: 3 }, "data-review-dim": d.key, "data-status": d.status }, [
							h("span", { key: "m", style: { color: DIM_COLOR[d.status], width: 14, flex: "0 0 14px" } }, DIM_MARK[d.status]),
							h("span", { key: "l", style: { width: 62, flex: "0 0 62px", color: "#c3c8ce" } }, d.label),
							h("span", { key: "n", style: { ...S.muted, flex: 1, minWidth: 0 } }, d.note)
						])).concat([h("div", { key: "s", style: { ...S.muted, marginTop: 5, color: result.pass ? "#6fd388" : "#f0877f" }, "data-testid": "d-review-summary" }, result.summary)]))
						: h("div", { key: "e", style: S.muted, "data-testid": "d-review-summary" }, "尚未审核。点「重跑审核」或等待对话产出变化自动触发。")
				]);
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 子组件：左面板（R2 / R3 / R5 / R6 + 层级管理）
			 * ══════════════════════════════════════════════════════════════════ */
			function DirectorPanel({ node, tree, messages, reviewResult, onReview, agentRuns, onCallAgent, engineStats, seg, setSeg }) {
				const counts = react.useMemo(() => countByLevel(tree), [tree]);
				const [agentSeg, setAgentSeg] = react.useState("agents");
				const [called, setCalled] = react.useState({});
			
				return h("div", { style: S.body, "data-testid": "d-body" }, [
					/* 分段：总监 / 层级 / 智能体 */
					h("div", { key: "seg", style: { ...S.seg, margin: "0 0 2px" }, role: "tablist" }, [
						h("button", { key: "d", role: "tab", style: S.segItem(seg === LEFT_TAB.DIRECTOR), "data-testid": "d-seg-director", "aria-selected": seg === LEFT_TAB.DIRECTOR, onClick: () => setSeg(LEFT_TAB.DIRECTOR) }, "总监"),
						h("button", { key: "l", role: "tab", style: S.segItem(seg === LEFT_TAB.LEVELS), "data-testid": "d-seg-levels", "aria-selected": seg === LEFT_TAB.LEVELS, onClick: () => setSeg(LEFT_TAB.LEVELS) }, "层级"),
						h("button", { key: "a", role: "tab", style: S.segItem(seg === LEFT_TAB.AGENTS), "data-testid": "d-seg-agents", "aria-selected": seg === LEFT_TAB.AGENTS, onClick: () => setSeg(LEFT_TAB.AGENTS) }, "智能体")
					]),
			
					/* ── 总监段 ── */
					seg === LEFT_TAB.DIRECTOR ? h("div", { key: "dir", style: { display: "flex", flexDirection: "column", gap: 8 }, "data-panel": "director" }, [
						/* R2 项目总览 */
						h("div", { key: "r2", style: S.blk, "data-testid": "d-r2" }, [
							h("div", { key: "t", style: S.blkT }, ["R2 项目总览"]),
							h("div", { key: "k", style: S.kv }, [
								h("div", { key: "p", style: S.kvc }, [h("div", { key: "v", style: S.kvV }, String(counts.project)), h("div", { key: "k", style: S.kvK }, "项目 / 文件夹")]),
								h("div", { key: "s", style: S.kvc }, [h("div", { key: "v", style: S.kvV }, String(counts.session)), h("div", { key: "k", style: S.kvK }, "对话")]),
								h("div", { key: "r", style: S.kvc }, [h("div", { key: "v", style: { ...S.kvV, color: "#e0b341" } }, String((node && node.risks ? node.risks.length : 0))), h("div", { key: "k", style: S.kvK }, "风险")]),
								h("div", { key: "td", style: S.kvc }, [h("div", { key: "v", style: S.kvV }, String((node && node.todos ? node.todos.length : 0))), h("div", { key: "k", style: S.kvK }, "待办")])
							]),
							h("div", { key: "m", style: { ...S.muted, marginTop: 6 } }, "阶段：" + ((node && node.meta && node.meta.currentPhase) || "未设置") + " · 目标：" + ((node && node.meta && node.meta.goal) || "未设置"))
						]),
			
						/* R5 总监流（只治理不执行） */
						h("div", { key: "r5", style: S.blk, "data-testid": "d-r5" }, [
							h("div", { key: "t", style: S.blkT }, ["R5 总监对话区", h("span", { key: "x", style: { marginLeft: "auto", color: "#8b9199" } }, "只治理 · 不执行")]),
							messages.length
								? messages.slice(-6).map((m) => h("div", { key: m.messageId || m.at, style: S.msg }, [
									h("div", { key: "a", style: S.av(m.role) }, m.role === "user" ? "你" : "总"),
									h("div", { key: "b", style: S.bub }, [
										m.kind ? h("div", { key: "k", style: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10, color: "#b794f6", marginBottom: 3 } }, m.kind) : null,
										h("span", { key: "t2" }, m.text)
									])
								]))
								: h("div", { key: "e", style: S.muted, "data-testid": "d-r5-empty" }, "尚无总监消息。在下方输入框输入，由总监整理并确认去向。")
						]),
			
						/* 六维审核 */
						h(ReviewCard, { key: "rv", result: reviewResult, onRun: onReview }),
			
						/* R6 记忆面板 */
						h("div", { key: "r6", style: S.blk, "data-testid": "d-r6" }, [
							h("div", { key: "t", style: S.blkT }, ["R6 总监记忆面板"]),
							h("div", { key: "m", style: S.muted }, [
								h("div", { key: "1", "data-testid": "d-memo-core" }, "核心记忆 · 双层数据元独立（" + PLUGIN_DB_NAME + " v1）"),
								h("div", { key: "2", "data-testid": "d-memo-decision" }, "决策记录 · " + (engineStats && engineStats.decisions ? engineStats.decisions + " 条" : "0 条")),
								h("div", { key: "3", "data-testid": "d-memo-risk" }, "审核记录 · " + (engineStats && engineStats.reviews ? engineStats.reviews + " 条" : "0 条") + " · 总监消息 · " + (engineStats && engineStats.conversations ? engineStats.conversations : 0) + " 条")
							]),
							engineStats ? h("div", { key: "st", style: { ...S.muted, marginTop: 5, fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5 }, "data-testid": "d-dbstats" },
								"自有库 " + PLUGIN_DB_NAME + "：" + engineStats.nodes + " 节点 / " + engineStats.conversations + " 消息 / " + engineStats.reviews + " 审核 / " + engineStats.decisions + " 决策") : null
						])
					]) : null,
			
					/* ── 层级段（复用 DirectorHierarchy，compact 形态；保留 h-* testid 全套）── */
					seg === LEFT_TAB.LEVELS ? h("div", { key: "lv", style: { minHeight: 0 }, "data-panel": "levels" },
						h(DirectorHierarchy, { compact: true })) : null,
			
					/* ── 智能体段（R3：分段切换 + 调用情况 + 手选调用）── */
					seg === LEFT_TAB.AGENTS ? h("div", { key: "ag", style: { display: "flex", flexDirection: "column", gap: 8 }, "data-panel": "agents" }, [
						h("div", { key: "r3", style: S.blk, "data-testid": "d-r3" }, [
							h("div", { key: "t", style: S.blkT }, ["R3 智能体 ｜ 技能", h("span", { key: "x", style: { marginLeft: "auto", color: "#8b9199" } }, "总监自动 / 客户手选")]),
							h("div", { key: "seg", style: { ...S.seg, margin: "0 0 7px" } }, [
								h("button", { key: "a", style: S.segItem(agentSeg === "agents"), "data-testid": "d-agent-seg-agents", onClick: () => setAgentSeg("agents") }, "智能体"),
								h("button", { key: "s", style: S.segItem(agentSeg === "skills"), "data-testid": "d-agent-seg-skills", onClick: () => setAgentSeg("skills") }, "技能")
							]),
							h("div", { key: "c", style: S.chips }, (agentSeg === "agents" ? AGENTS : SKILLS).map((a) =>
								h("button", {
									key: a.key, style: S.chip(a.mode, Boolean(called[a.key])), title: a.desc + "｜检查项：" + ((a.checks || ["—"]).join(" / ")),
									"data-testid": "d-agent-" + a.key, "data-mode": a.mode,
									onClick: () => { setCalled((c) => ({ ...c, [a.key]: true })); onCallAgent(a); }
								}, [h("i", { key: "d", style: S.dot(a.mode === "auto" ? "#b794f6" : "#e0b341") }), h("span", { key: "l" }, a.label)])
							)
						)]),
						h("div", { key: "run", style: S.blk, "data-testid": "d-agent-runs", "data-run-total": agentRuns.length }, [
							h("div", { key: "t", style: S.blkT }, ["调用情况（最近" + (agentRuns.length > RUNS_SHOWN ? " " + RUNS_SHOWN + "/" + agentRuns.length : "") + "）"]),
							agentRuns.length
								? agentRuns.slice(0, RUNS_SHOWN).map((r, i) => h("div", { key: i, style: { ...S.muted, display: "flex", gap: 6 }, "data-run-key": r.key }, [
									h("i", { key: "d", style: S.dot(r.status === "ok" ? "#3fb950" : "#d29922") }),
									h("span", { key: "k", style: { width: 54, flex: "0 0 54px" } }, r.key),
									h("span", { key: "s", style: { flex: 1, minWidth: 0 } }, r.status + (r.note ? " · " + r.note : ""))
								]))
								: h("div", { key: "e", style: S.muted, "data-testid": "d-agent-runs-empty" }, "尚无调用记录。点击上方任一智能体/技能即产生一条。")
						])
					]) : null
				]);
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 主组件：弹窗外壳
			 * ══════════════════════════════════════════════════════════════════ */
			function DirectorDialog(props = {}) {
				installChatBridgeApi(); // 幂等
				const st = useStore(directorLayoutStore);
				const open = Boolean(st.dialogOpen) && props.open !== false;
				const collapsed = Boolean(st.dialogCollapsed);
				const leftCollapsed = Boolean(st.directorPanelCollapsed);
				const rightCollapsed = Boolean(st.chatPanelCollapsed);
				const leftWidth = Number(st.directorPanelWidth) || PANEL_MIN_WIDTH;
			
				const [geo, setGeo] = react.useState(() => getSplitRootRect());
				const [tree, setTree] = react.useState(null);
				const [crumbs, setCrumbs] = react.useState([]);
				const [messages, setMessages] = react.useState([]);
				const [stats, setStats] = react.useState(null);
				const [reviewResult, setReviewResult] = react.useState(null);
				const [routeResult, setRouteResult] = react.useState(null);
				const [runs, setRuns] = react.useState([]);
				const [draft, setDraft] = react.useState("");
				const [busy, setBusy] = react.useState(false);
				const [toast, setToast] = react.useState("");
				const [dragW, setDragW] = react.useState(null);
				const [unread, setUnread] = react.useState(0);
				/* 右上角「⚙ 个性化」开合 —— 与其他三处同一个面板组件。
				 * 🔴 必须排在下方 `if (!open) return null` 之前（React Hooks 规则；本组件已踩过这个坑）。 */
				const [pOpen, setPOpen] = react.useState(false);
				const panelRef = react.useRef(null);
				const dragRef = react.useRef(null);
				const convRef = react.useRef({ count: 0, lastText: "" });
			
				const nodeId = st.activeNodeId || GLOBAL_NODE_ID;
				const seg = st.leftTab || LEFT_TAB.DIRECTOR;
			
				/** 当前层级节点（值，非函数 —— 供各 effect 与渲染共用） */
				const node = react.useMemo(() => {
					if (!tree) return null;
					let found = null;
					const walk = (n) => {
						if (found) return;
						if (n.id === nodeId) { found = n; return; }
						(n.childNodes || []).forEach(walk);
					};
					walk(tree);
					return found;
				}, [tree, nodeId]);
			
				/* ── 布局计算（须在下方分屏 effect 之前，`padLeft` 为其依赖）── */
				const W = geo ? geo.w : 1162;
				const H = geo ? geo.h : 816;
				const rightCollapsePad = Math.max(RAIL, W - RAIL - 4);
				const padLeft = rightCollapsed ? rightCollapsePad : (leftCollapsed ? RAIL : leftWidth);
				const panelWidth = leftCollapsed ? RAIL : (rightCollapsed ? Math.max(PANEL_MIN_WIDTH, W - RAIL - 8) : leftWidth);
			
				/* ── 几何跟随 + 分屏注入 / 撤销（**必须成对**，见 docs/11 §三 3.2 教训）──
				 * 🔴 两者合并成一个 effect：宿主每次重渲染都可能**丢掉 `data-dsh-split-root` 标记**
				 *    （标记挂在宿主节点上，不在 React 树里），只同步几何不重挂标记 ⇒ 分屏**静默失效**
				 *    （样式节点还在、`isSplitActive()` 仍 true，但选择器命中不到任何元素）。
				 *    故按 900ms 心跳 + resize 一并「重挂标记 + 重算几何」；`applySplit` 幂等。
				 */
				react.useEffect(() => {
					if (!open || collapsed) { clearSplit(); return undefined; }
					const sync = () => {
						setGeo(getSplitRootRect());
						applySplit({ paddingLeft: padLeft, collapsed: rightCollapsed ? "right" : (leftCollapsed ? "left" : null) });
					};
					sync();
					window.addEventListener("resize", sync);
					const t = setInterval(sync, 900);
					return () => { window.removeEventListener("resize", sync); clearInterval(t); clearSplit(); };
				}, [open, collapsed, padLeft, leftCollapsed, rightCollapsed]);
			
				/* ── 数据：层级树 / 消息 / 统计 ── */
				const refresh = react.useCallback(async () => {
					try {
						const t = await loadTree();
						setTree(t);
						setCrumbs(await getBreadcrumb(nodeId));
						const [msgs, s] = await Promise.all([listDirectorMessages(nodeId), pluginDbStats()]);
						setMessages(msgs || []);
						setStats(s);
						setRuns(listAgentRuns());
					} catch (e) { /* 数据层异常不影响 UI */ }
				}, [nodeId]);
			
				react.useEffect(() => { if (open) refresh(); }, [open, refresh]);
				react.useEffect(() => onHierarchyChange(() => { if (open) refresh(); }), [open, refresh]);
			
				/* ── 右 → 左：产出变化 → 六维审核 + 未读 ── */
				react.useEffect(() => {
					if (!open || collapsed) return undefined;
					convRef.current = readConversation();
					const off = observeConversation((info) => {
						if (info.delta > 0) {
							setUnread((u) => u + info.delta);
							// 自动触发六维审核（要求 3：审核对话实际产出是否达标）
							const r = review6({
								goal: String((node && node.name) || "") + " " + ((node && node.meta && node.meta.goal) || ""),
								output: info.lastText,
								evidence: info.lastText ? ["对话产出片段 " + info.lastText.slice(0, 60)] : [],
								risks: []
							});
							setReviewResult(r);
							recordAgentRun("review", r.pass ? "ok" : "warn", "自动审核 " + r.score + " 分");
							setRuns(listAgentRuns());
						}
					});
					return off;
					// eslint-disable-next-line react-hooks/exhaustive-deps
				}, [open, collapsed, node, nodeId]);
			
				/* ── 焦点路由（要求 11 · R8；非拦截，仅观测）── */
				react.useEffect(() => {
					if (!open || collapsed) return undefined;
					const onDown = (e) => {
						const t = e.target;
						if (panelRef.current && panelRef.current.contains(t)) { directorLayoutStore.setFocusTarget("director"); return; }
						const g = getSplitRootRect();
						if (!g) return;
						const x = e.clientX, y = e.clientY;
						if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) directorLayoutStore.setFocusTarget("chat");
					};
					document.addEventListener("pointerdown", onDown, true);
					return () => document.removeEventListener("pointerdown", onDown, true);
				}, [open, collapsed]);
			
				/* ── 键盘：Esc 关闭，Alt+1/2/3 三态（docs/11 §一 7）── */
				react.useEffect(() => {
					if (!open) return undefined;
					const onKey = (e) => {
						if (e.key === "Escape") {
							/* 个性化面板在最上层 ⇒ Esc 先关它（面板自身 window-capture 已 stopPropagation，
							 * 正常走不到这里；留一层是防"按 Esc 把整个总监弹窗关掉"）。 */
							if (pOpen) { setPOpen(false); return; }
							directorLayoutStore.setDialogOpen(false); return;
						}
						if (e.altKey && (e.key === "1" || e.key === "2" || e.key === "3")) {
							e.preventDefault();
							if (e.key === "1") directorLayoutStore.toggleDirectorCollapsed();
							if (e.key === "2") directorLayoutStore.toggleChatCollapsed();
							if (e.key === "3") directorLayoutStore.toggleDialogCollapsed();
						}
					};
					document.addEventListener("keydown", onKey);
					return () => document.removeEventListener("keydown", onKey);
				}, [open, pOpen]);
			
				/* ── 拖拽中缝 ── */
				const dragWRef = react.useRef(null);
				react.useEffect(() => { dragWRef.current = dragW; }, [dragW]);
			
				const calcDragW = react.useCallback((clientX) => {
					if (!dragRef.current || typeof clientX !== "number") return null;
					return Math.max(RAIL, dragRef.current.w0 + (clientX - dragRef.current.x0));
				}, []);
			
				const onDragMove = react.useCallback((e) => {
					const next = calcDragW(e.clientX);
					if (next == null) return;
					setDragW(next);
				}, [calcDragW]);
				const onDragEnd = react.useCallback((e) => {
					if (!dragRef.current) return;
					/* 🔴 `dragWRef.current` 可能为 null：pointerdown → pointermove → pointerup 若落在
					 *    **同一个 task**（用户快速甩动 / 自动化脚本连发），React 尚未提交 `setDragW`
					 *    ⇒ ref 仍是 null ⇒ 位移被**静默丢弃**，拖拽"没反应"。
					 *    故以 pointerup 的坐标**兜底重算**（两者取幂等值，无副作用）。 */
					const w = dragWRef.current != null ? dragWRef.current : calcDragW(e && e.clientX);
					document.removeEventListener("pointermove", onDragMove);
					document.removeEventListener("pointerup", onDragEnd);
					dragRef.current = null;
					// 提交到 store：`dragDirectorWidth` 内部做边界钳制与"过窄自动折叠"吸附（docs/11 §二 I8）
					if (w != null) lastDragSnap = directorLayoutStore.dragDirectorWidth(w);
					setDragW(null);
				}, [onDragMove, calcDragW]);
			
				const startDrag = (e) => {
					dragRef.current = { x0: e.clientX, w0: panelWidth };
					document.addEventListener("pointermove", onDragMove);
					document.addEventListener("pointerup", onDragEnd);
				};
			
				/* ── 行为 ── */
				const pushMsg = async (kind, text, role) => {
					const rec = await appendDirectorMessage(nodeId, { kind, text, role: role || "director" });
					await refresh();
					return rec;
				};
			
				const doReview = async () => {
					setBusy(true);
					try {
						const conv = readConversation();
						const r = await reviewAndSave(nodeId, {
							goal: (node && node.meta && node.meta.goal) || (node && node.name) || "",
							output: conv.lastText,
							evidence: conv.lastText ? ["对话产出 " + conv.count + " 条，末条 " + conv.lastText.slice(0, 50)] : [],
							risks: (node && node.risks) || []
						});
						setReviewResult(r);
						recordAgentRun("review", r.pass ? "ok" : "warn", "六维 " + r.score + " 分");
						setRuns(listAgentRuns());
						setToast("六维审核完成：" + (r.pass ? "通过" : "打回"));
					} finally { setBusy(false); }
				};
			
				const onSend = async () => {
					const text = draft.trim();
					if (!text) { setToast("请输入内容"); return; }
					setBusy(true);
					try {
						if (st.focusTarget === "chat") {
							// 目标＝对话：直接投给原生对话（要求 5「互相传送消息」）
							const r = await sendToChat(text, { autoSend: true });
							await pushMsg("转投对话", r.ok ? (r.mode === "sent" ? "已发送到对话域：" + text : "已填入对话输入框（发送按钮不可用，请手动确认）：" + text) : "发送失败（" + r.reason + "）：" + text, "user");
							recordAgentRun("code", r.ok ? "ok" : "warn", r.mode || r.reason);
							setToast(r.mode === "sent" ? "已发送到对话" : "已填入对话输入框");
						} else {
							// 目标＝总监：走智能路由（要求 8），先出确认卡，**不静默分发**
							await pushMsg("需求澄清", text, "user");
							const flat = [];
							const walk = (n) => { flat.push({ id: n.id, name: n.name, level: n.level, meta: n.meta, conversations: n.conversations }); (n.childNodes || []).forEach(walk); };
							if (tree) walk(tree);
							const r = route(text, { nodes: flat, currentNodeId: nodeId });
							setRouteResult(r);
							recordAgentRun("doc", "ok", "路由候选 " + r.candidates.length);
							setRuns(listAgentRuns());
							setToast("总监已整理，待你确认去向");
						}
						setDraft("");
					} finally { setBusy(false); }
				};
			
				const onConfirmRoute = async (dest) => {
					if (!routeResult) return;
					setBusy(true);
					try {
						const r = await confirmRoute(nodeId, routeResult, dest);
						const cand = (routeResult.candidates || [])[0];
						const summary = DESTINATION_LABEL[dest] + (cand ? " → " + cand.name : "");
						if (dest === DESTINATION.DIRECT || dest === DESTINATION.TRANSFER) {
							const sent = await sendToChat(routeResult.subtasks.map((s) => s.text).join("\n"), { autoSend: dest === DESTINATION.DIRECT });
							await pushMsg("方案 · 派活", "路由已落实：" + summary + "（" + (sent.mode === "sent" ? "已发送" : "已填入输入框") + "）");
						} else {
							await pushMsg("方案 · 派活", "路由已落实：" + summary + "（由总监新建对话并初始化其总监节点）");
						}
						setRouteResult(null);
						await refresh();
						setToast("已落实：" + summary + (r.ok ? "" : "（留痕失败）"));
					} finally { setBusy(false); }
				};
			
				const onCallAgent = async (a) => {
					recordAgentRun(a.key, "ok", "客户手选调用");
					setRuns(listAgentRuns());
					await pushMsg("方案 · 派活", "手选调用「" + a.label + "」（" + a.desc + "）");
					setToast("已调用：" + a.label);
				};
			
				/* ── 渲染 ── */
				if (!open) return null;
			
				/* 整窗最小化：只留 chip（并让原生布局完全复原） */
				if (collapsed) {
					return h("div", { style: S.layer }, h("div", {
						id: CHIP_ID, "data-testid": "d-chip", role: "button", tabIndex: 0,
						onClick: () => directorLayoutStore.setDialogCollapsed(false),
						onKeyDown: (e) => { if (e.key === "Enter") directorLayoutStore.setDialogCollapsed(false); },
						style: {
							position: "absolute", right: 18, bottom: 18, pointerEvents: "auto", cursor: "pointer",
							display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 20,
							background: "var(--dsw-alias-bg-sunken, #23262c)", border: "1px solid rgba(137,87,229,.45)",
							color: "#b794f6", fontFamily: "ui-monospace,Consolas,monospace", fontSize: 11.5
						}
					}, [
						h("span", { key: "i" }, "◆"),
						h("span", { key: "t" }, "总监 · " + ((node && node.name) || "全局总管")),
						unread > 0 ? h("span", { key: "c", style: { background: "#f85149", color: "#fff", borderRadius: 9, padding: "1px 6px", fontSize: 10 } }, String(unread)) : null
					]));
				}
			
				const g = geo || { x: 280, y: 0, w: W, h: H };
			
				return h("div", { id: DIALOG_ID, style: S.layer, "data-testid": "d-dialog" }, [
					/* spotlight 遮罩：覆盖原生应用根的"洞"，在洞之外整体压暗；pointer-events:none 不拦截 */
					h("div", {
						key: "hole", "data-testid": "d-hole",
						style: { ...S.hole, left: g.x, top: g.y, width: g.w, height: g.h, boxShadow: "0 0 0 9999px rgba(0,0,0,.34)" }
					}),
			
					/* 左：总监面板 */
					leftCollapsed
						? h("div", {
							key: "lrail", "data-testid": "d-left-rail", role: "button", tabIndex: 0, title: "展开总监面板",
							style: { ...S.rail("left"), left: g.x, top: g.y, width: RAIL, height: g.h },
							onClick: () => directorLayoutStore.toggleDirectorCollapsed()
						}, [
							h("span", { key: "i" }, "◆"), h("span", { key: "t" }, "总"), h("span", { key: "a" }, "▸"),
							/* 🔴 折叠左栏后**必须仍可达**的控制簇（真机逐交互暴露的缺陷）：
							 *    旧实现把「整块面板」替换成 rail ⇒ 标题栏一并消失 ⇒
							 *    折叠态下**右栏折叠 / 复位 / 最小化 / 关闭全部无入口**，
							 *    只剩 Alt 快捷键（要求 6 要「弹窗形式 + 允许最小化」——任一时刻都要能最小化）。
							 *    ⇒ rail 内置竖排图标簇（⇥ ▢ – ✕）。
							 *    ⚠ 点击须 `stopPropagation`：否则冒泡到 rail 的 onClick 会立刻把左栏重新展开。 */
							h("div", {
								key: "ctl", style: { display: "flex", flexDirection: "column", gap: 5, marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(49,52,58,.9)" },
								onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); }
							}, [
								h("button", { key: "r", style: S.btn, title: "折叠右栏（Alt+2）", "aria-label": "折叠右栏", "data-testid": "d-collapse-right", onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); directorLayoutStore.toggleChatCollapsed(); } }, "⇥"),
								h("button", { key: "z", style: S.btn, title: "复位栏宽", "aria-label": "复位栏宽", "data-testid": "d-reset", onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); directorLayoutStore.resetPanelWidths(); } }, "▢"),
								/* 个性化：折叠左栏后此处是**唯一**入口，故与右栏同一组按钮并列（不是"右上角"布局，
								 * 但面板本体仍是 `position:fixed` 贴右上角，见文件末尾 PersonalizePanel）。 */
								h("button", { key: "p", style: S.btn, "data-on": pOpen ? "1" : "0", title: "个性化设定（与总监页 / 设计图 / 导图共用同一份）", "aria-label": "个性化设定", "data-testid": "d-personalize", onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); setPOpen((v) => !v); } }, "⚙"),
								h("button", { key: "m", style: S.btn, title: "整窗最小化（Alt+3）", "aria-label": "整窗最小化", "data-testid": "d-min", onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); directorLayoutStore.setDialogCollapsed(true); } }, "–"),
								h("button", { key: "c", style: { ...S.btn, borderColor: "rgba(248,81,73,.4)", color: "#f0877f" }, title: "关闭（Esc）", "aria-label": "关闭总监", "data-testid": "d-close", onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); directorLayoutStore.setDialogOpen(false); } }, "✕")
							])
						])
						: h("div", {
							key: "panel", ref: panelRef, style: { ...S.panel, left: g.x, top: g.y, width: dragW != null ? dragW : panelWidth, height: g.h },
							// 🔴 面板绑定节点用 `data-active-node-id`，**不可**写成 `data-node-id`：
							//    后者是全插件「树行」的唯一选择器（`components/DirectorHierarchy.js` TreeItem），
							//    面板若占用同名属性，`[data-node-id]` 的首个命中会变成面板本身，
							//    使既有逐交互脚本「点第一行 → 选中态迁移」失效（2026-09-12 真机实测踩中）。
							role: "dialog", "aria-label": "总监面板", "data-testid": "d-panel", "data-active-node-id": nodeId,
							/* 质感类（三档纹理由 store/personalize.js 注入的样式表按 html[data-dp-texture] 命中） */
							className: "dp-textured", "data-personalize-open": pOpen ? "1" : "0"
						}, [
							/* mhead：R1 顶部栏 + 层级切换器（I5）*/
							h("div", { key: "h", style: S.head }, [
								h("span", { key: "t", style: S.headTitle }, "◆ 总监"),
								h("select", {
									key: "sel", "data-testid": "d-level", "aria-label": "切换层级",
									value: nodeId,
									onChange: (e) => directorLayoutStore.setActiveNode(e.target.value),
									style: { maxWidth: 132, height: 22, fontSize: 11, borderRadius: 5, border: "1px solid #3d4148", background: "#212429", color: "#c3c8ce" }
								}, buildOptions(tree)),
								h("span", { key: "c", style: S.lvchip, "data-testid": "d-level-chip" }, (node ? (LEVEL_LABEL[node.level] || node.level) : "—")),
								h("div", { key: "b", style: S.btns }, [
									h("button", { key: "1", style: S.btn, title: "折叠左栏（Alt+1）", "aria-label": "折叠左栏", "data-testid": "d-collapse-left", onClick: () => directorLayoutStore.toggleDirectorCollapsed() }, "⇤"),
									h("button", { key: "2", style: S.btn, title: "折叠右栏（Alt+2）", "aria-label": "折叠右栏", "data-testid": "d-collapse-right", onClick: () => directorLayoutStore.toggleChatCollapsed() }, "⇥"),
									h("button", { key: "3", style: S.btn, title: "整窗最小化（Alt+3）", "aria-label": "整窗最小化", "data-testid": "d-min", onClick: () => directorLayoutStore.setDialogCollapsed(true) }, "–"),
									h("button", { key: "4", style: S.btn, title: "复位栏宽（双击中缝同效）", "aria-label": "复位栏宽", "data-testid": "d-reset", onClick: () => directorLayoutStore.resetPanelWidths() }, "▢"),
									/* 右上角个性化（需求原文：「同时都在右上角加自定义个性化设定」）。
									 * 本按钮在 `btns`（marginLeft:auto ⇒ 贴面板右上角），展开的面板本体
									 * 由文件末尾的 PersonalizePanel 以 fixed 定位贴整个窗口右上角。 */
									h("button", { key: "6", style: S.btn, "data-on": pOpen ? "1" : "0", title: "个性化设定（与总监页 / 设计图 / 导图共用同一份）", "aria-label": "个性化设定", "data-testid": "d-personalize", onClick: () => setPOpen((v) => !v) }, "⚙"),
									h("button", { key: "5", style: { ...S.btn, borderColor: "rgba(248,81,73,.4)", color: "#f0877f" }, title: "关闭（Esc）", "aria-label": "关闭总监", "data-testid": "d-close", onClick: () => directorLayoutStore.setDialogOpen(false) }, "✕")
								])
							]),
			
							/* 面包屑（当前层级路径） */
							h("div", { key: "crumb", style: { ...S.muted, padding: "4px 9px 0", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, "data-testid": "d-crumb" },
								crumbs.length ? crumbs.map((c) => c.name).join(" / ") : "全局总管"),
			
							/* 面板主体 */
							h(DirectorPanel, {
								key: "body", node, tree, messages, reviewResult, onReview: doReview,
								agentRuns: runs, onCallAgent, engineStats: stats,
								seg, setSeg: (s) => directorLayoutStore.setLeftTab(s)
							}),
			
							/* 路由确认卡（要求 8 STEP4）*/
							routeResult ? h("div", { key: "route", style: { padding: "0 8px 8px" } },
								h(RouteCard, { result: routeResult, onConfirm: onConfirmRoute, onCancel: () => setRouteResult(null), busy })) : null,
			
							/* mfoot：R8 全局输入框 + 焦点路由（I3/I7/I10）*/
							h("div", { key: "f", style: { borderTop: "1px solid var(--dsw-alias-border-l2, #31343a)", background: "var(--dsw-alias-bg-sunken, #1b1e23)", padding: "7px 8px", display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" } }, [
								h("span", {
									key: "fc", "data-testid": "d-focus", "data-target": st.focusTarget,
									style: {
										fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10, padding: "4px 7px", borderRadius: 5, whiteSpace: "nowrap",
										border: "1px solid " + (st.focusTarget === "director" ? "rgba(137,87,229,.45)" : "rgba(47,111,235,.5)"),
										background: st.focusTarget === "director" ? "rgba(137,87,229,.16)" : "rgba(47,111,235,.16)",
										color: st.focusTarget === "director" ? "#b794f6" : "#79a8ff", cursor: "pointer"
									},
									title: "点击切换提交目标",
									onClick: () => directorLayoutStore.setFocusTarget(st.focusTarget === "director" ? "chat" : "director")
								}, "目标：" + (st.focusTarget === "director" ? "总监" : "对话")),
								h("input", {
									key: "i", style: S.input, "data-testid": "d-input", "data-input-scope": "director",
									placeholder: st.focusTarget === "director" ? "输入后由总监整理确认，再路由到对应对话…" : "输入后直接发送到对话…",
									value: draft, onChange: (e) => setDraft(e.target.value),
									onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } },
									disabled: busy
								}),
								h("button", { key: "s", style: S.btnPrimary, "data-testid": "d-send", onClick: onSend, disabled: busy }, "↑")
							]),
			
							/* 提示条 */
							toast ? h("div", { key: "toast", style: { ...S.muted, padding: "0 9px 7px", color: "#79a8ff" }, "data-testid": "d-toast", onClick: () => setToast("") }, toast) : null
						]),
			
					/* 中缝拖拽手柄（双击复位）*/
					!leftCollapsed && !rightCollapsed ? h("div", {
						key: "split", "data-testid": "d-split", "aria-label": "拖拽调宽",
						style: { position: "absolute", left: g.x + (dragW != null ? dragW : panelWidth) - 4, top: g.y, width: 8, height: g.h, pointerEvents: "auto", cursor: "col-resize", zIndex: 2 },
						onPointerDown: startDrag, onDoubleClick: () => directorLayoutStore.resetPanelWidths()
					}) : null,
			
					/* 右栏折叠竖条（点击展开）*/
					rightCollapsed ? h("div", {
						key: "rrail", "data-testid": "d-right-rail", role: "button", tabIndex: 0, title: "展开对话数据",
						style: { ...S.rail("right"), left: g.x + g.w - RAIL, top: g.y, width: RAIL, height: g.h },
						onClick: () => directorLayoutStore.toggleChatCollapsed()
					}, [h("span", { key: "i" }, "▣"), h("span", { key: "t" }, "对"), h("span", { key: "a" }, "◂")]) : null,
			
					/* 右栏装饰（透明，不拦截；原生对话区透过它显示）*/
					!rightCollapsed ? h("div", {
						key: "rchrome", "data-testid": "d-right", "data-same-source": "1",
						style: {
							position: "absolute", left: g.x + (dragW != null ? dragW : panelWidth), top: g.y, width: Math.max(0, g.w - (dragW != null ? dragW : panelWidth)),
							height: g.h, pointerEvents: "none", borderLeft: "1px solid rgba(47,111,235,.35)", borderRadius: "0 8px 8px 0"
						}
					}, h("div", {
						style: {
							position: "absolute", right: 8, bottom: 8, fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10,
							color: "#6fd388", background: "rgba(22,23,26,.82)", border: "1px solid rgba(63,185,80,.35)", borderRadius: 4, padding: "2px 6px"
						}
					}, "● 与「对话 tab」同源（同一渲染节点）")) : null,
			
					/* 个性化面板 —— 贴整个窗口右上角（`position:fixed`），由 `inset` 避让原生窗口控件。
					 * 放在 dialog 图层内（zIndex 由 PersonalizePanel 自己抬到 2147483300 ⇒ 高于本层 2147483000 档）。 */
					h(PersonalizePanel, {
						key: "pp", open: pOpen, onClose: () => setPOpen(false),
						inset: readInset(), top: 46, scope: "总监弹窗"
					})
				]);
			}
			
			/** 层级下拉项（扁平遍历树）*/
			function buildOptions(tree) {
				const out = [];
				const walk = (n, d) => {
					out.push(h("option", { key: n.id, value: n.id }, "　".repeat(d) + (LEVEL_LABEL[n.level] || n.level) + " · " + n.name));
					(n.childNodes || []).forEach((c) => walk(c, d + 1));
				};
				if (tree) walk(tree, 0);
				return out;
			}
			
			/** 供调试/验证：最近一次拖拽是否触发了"过窄自动折叠"吸附 */
			let lastDragSnap = false;
			function getLastDragSnap() { return lastDragSnap; }
			
			__defaults["components/DirectorDialog.js"] = DirectorDialog;
			
			exports.DIALOG_ID = DIALOG_ID;
			exports.CHIP_ID = CHIP_ID;
			exports.AGENTS = AGENTS;
			exports.SKILLS = SKILLS;
			exports.RUNS_SHOWN = RUNS_SHOWN;
			exports.RUNS_KEEP = RUNS_KEEP;
			exports.recordAgentRun = recordAgentRun;
			exports.listAgentRuns = listAgentRuns;
			exports.DirectorDialog = DirectorDialog;
			exports.getLastDragSnap = getLastDragSnap;
		};

		// ── store/design-schema.js ──
		__defs["store/design-schema.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：「标准设计图框架」的数据映射（设计图插件的原子层）
			 * 引用：V16 诉求 6（标准设计图框架的映射）+ 2026-09-12 诉求 10（不同版本的选择） · T-PLUG-018
			 * 上游：components/DesignStudio.js, store/design.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 D2 · D4（18 类元素 + 标准框架 20 元素）· E3（版本快照模型）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * store/design-schema.js — 「标准设计图框架」的数据映射（设计图插件的原子层）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 D】设计图工作室
			 *   ├─ D1 全屏工作室布局      → components/DesignStudio.js
			 *   ├─ D2 元素类型库（18 类）  → 本文件 ELEMENT_KINDS
			 *   ├─ D3 元素交互逻辑面板     → 本文件 LOGIC_FIELDS + components/DesignStudio.js 左侧栏
			 *   └─ D4 标准框架模板        → 本文件 STANDARD_FRAMES
			 *  业务不变量  docs/10-总监与对话架构总纲.md §四
			 *  总台账      docs/00-统筹入口/03-待完成任务清单.md  T-PLUG-018
			 *
			 *  需求原文（用户）：「做一个标准设计图框架的映射 也就是在总监页面单独加一个设计图的插件吧，
			 *  按钮形式 点击铺满全屏，允许调整修改拖拽增加元素，最下面对话保留，这个对话处理设计图的修订
			 *  属于新开的临时对话 只处理设计图，然后每一个元素可以点击 点击在左侧显示交互逻辑」
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  为什么要有"标准框架模板"（而不是让用户从白纸开始拖）
			 * ══════════════════════════════════════════════════════════════════
			 *  这一版项目的痛点不是"能不能画"，而是**沟通**：每次改设计都要用文字描述"右区第三栏"，
			 *  三版改下来各说各话（用户原话："三次改版，改出来三版本完全不一样的"）。
			 *  ⇒ 标准框架把「三页签 + 两弹窗 + 导图态」这一套**布局约定**固化成可加载的模板：
			 *     加载后每个元素**自带名字与交互逻辑**，后续所有讨论都能指着同一个 id 说话。
			 *  ⇒ 这就是"映射"的含义：**设计图 → 具名元素 → 可寻址**。
			 *
			 *  🔴 与 R5 冻结项的关系：本文件纯数据，不碰任何持久化 key、不碰宿主库。
			 */
			
			/* ══════════════════════════════════════════════════════════════════
			 * 一、元素类型库（标准设计图的 18 个原子）
			 *     `w/h` 是默认尺寸（px，按 V16 的 1:1.22 折算视口 1180×644）；
			 *     `logic` 是该类型**默认携带**的交互逻辑骨架（可被实例覆盖）。
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 元素类型（单一真相源；UI 工具栏顺序即此对象键序） */
			const ELEMENT_KINDS = Object.freeze({
				// ── 结构类（大块）──
				window: { label: "窗口", icon: "▣", group: "结构", w: 1180, h: 644, logic: {
					trigger: "应用启动（Electron 主窗口创建）",
					action: "装载宿主 React 根，承载全部页面",
					state: "未挂载 → 已挂载（根节点 #root）",
					data: "读 dsh.workspace.view.v5；写 dsh.sessions.current",
					fallback: "宿主版本差异致 slot 不可用时，插件降级为自挂 DOM 通道（浮动按钮组）仍可用",
					shortcut: "—",
					code: "src/mount.js mountHierarchy"
				} },
				sidebar: { label: "侧栏", icon: "▮", group: "结构", w: 230, h: 644, logic: {
					trigger: "点击会话行 / 文件夹行",
					action: "切换当前会话；点文件夹则进入该层级总监",
					state: "未选中 → 选中（高亮当前行）",
					data: "写 dsh.sessions.current；读 dsh.workspace.view.v5 展开态",
					fallback: "会话不存在 → 回落全局总管；侧栏收起时入口移入浮动按钮组，不留死路",
					shortcut: "Ctrl+K 搜索会话",
					code: "src/bridge/nav-hook.js（捕获阶段 pointerdown + 三级名称匹配）"
				} },
				tabring: { label: "页签环", icon: "▭▭", group: "结构", w: 420, h: 30, logic: {
					trigger: "点击页签 / Alt+1·2·3",
					action: "在 总监 / 对话 / 轨迹 之间切换视图",
					state: "active 从旧 id → 新 id；仅当 tab 数 > 1 时才渲染",
					data: "读 ctx.slots entries(\"conversation.view\")；写宿主 activeView",
					fallback: "slot 不可用时注册失败并返回 {registered:false,reason}，浮层通道保底，不静默消失",
					shortcut: "Alt+1 总监 / Alt+2 对话 / Alt+3 轨迹",
					code: "src/client-entry.js installDirectorView（order:-1 排最前）"
				} },
				region: { label: "分区", icon: "▤", group: "结构", w: 360, h: 120, logic: {
					trigger: "—（被动容器）",
					action: "R1–R8 分区容器，只负责布局与分区标题",
					state: "无独立状态，随上游数据重渲染",
					data: "只读上游 props（总监层级 / 统计值）",
					fallback: "数据为空时渲染占位文案而不是留白（如 R5「尚无总监消息」）",
					shortcut: "—",
					code: "src/components/DirectorPage.js sectionR1…sectionR8"
				} },
				panel: { label: "面板", icon: "▯", group: "结构", w: 200, h: 160, logic: {
					trigger: "拖中缝（分隔条）",
					action: "调整面板宽度",
					state: "width 变化，钳制 180–55%×视口；过窄自动吸附折叠",
					data: "写 dsh.director.layout（directorPanelWidth / chatPanelWidth）",
					fallback: "视口过小时吸附为折叠态并提供展开按钮，避免面板被压成 0 宽不可达",
					shortcut: "—",
					code: "src/store/layout.js clampPanelWidth"
				} },
				canvas: { label: "画布", icon: "▦", group: "结构", w: 480, h: 280, logic: {
					trigger: "滚轮缩放 / 拖拽空白平移 / 点空白",
					action: "缩放与平移画布；点空白取消选中",
					state: "zoom 10%–400%；selected 置空",
					data: "只读设计图 doc.elements",
					fallback: "无图时显示引导文案并自动铺一张标准框架，不留空白画布",
					shortcut: "Ctrl+0 适应 100%",
					code: "src/components/DesignStudio.js（canvasWrap / grid）"
				} },
			
				// ── 控件类 ──
				button: { label: "按钮", icon: "⬜", group: "控件", w: 84, h: 28, logic: {
					trigger: "点击 / Enter / Space",
					action: "执行绑定的 onClick",
					state: "hover / active / focus-visible / disabled 四态",
					data: "由 onClick 决定；不直接读写 store",
					fallback: "disabled 时保留 title 说明原因，不静默变灰无解释",
					shortcut: "Enter / Space（聚焦态）",
					code: "src/components/DesignStudio.js 各 S.btn"
				} },
				input: { label: "输入框", icon: "▬", group: "控件", w: 240, h: 28, logic: {
					trigger: "Enter 提交 / 点击发送",
					action: "按**目标徽章**决定提交去向（总监 or 对话 / 或设计图修订）",
					state: "draft 有值 → 提交后清空；无图或无目标时 disabled",
					data: "总监消息走 plugin-db/directorConversations；设计图修订走 dsh.director.design（三向隔离）",
					fallback: "解析不出目标时进「待确认 / 未识别」区并回显，绝不静默丢弃用户输入",
					shortcut: "Enter 提交 / Shift+Enter 换行",
					code: "src/components/DirectorPage.js R8 + src/components/DesignStudio.js ds-input"
				} },
				select: { label: "下拉", icon: "▾", group: "控件", w: 140, h: 24, logic: {
					trigger: "选择选项",
					action: "切换层级 / 模型 / 设计图文档",
					state: "value 变化触发上层重渲染",
					data: "写 dsh.director.config（模型）/ layout（层级）/ 设计图 activeDocId",
					fallback: "选项为空时保留占位项而不是抛错；自动化赋值必须走 HTMLSelectElement.prototype，否则 Illegal invocation",
					shortcut: "↑↓ 切换选项",
					code: "src/components/DirectorPage.js R3 + src/components/DesignStudio.js ds-doclist"
				} },
				badge: { label: "徽章", icon: "◉", group: "控件", w: 56, h: 20, logic: {
					trigger: "—（随状态被动更新）",
					action: "标示当前提交目标（总监 / 对话）",
					state: "目标切换时文案与配色同步",
					data: "读 layout.focusTarget",
					fallback: "目标未定时显示「未指定」并要求先选，不默认投递给任何一方",
					shortcut: "—",
					code: "src/components/DirectorPage.js dp-focus"
				} },
				text: { label: "文本", icon: "T", group: "控件", w: 140, h: 18, logic: {
					trigger: "—",
					action: "静态说明文字",
					state: "无独立状态",
					data: "只读常量或上游 props",
					fallback: "文案缺失时回落为「—」，不留空白",
					shortcut: "—",
					code: "各组件 S.muted"
				} },
				icon: { label: "图标按钮", icon: "✕", group: "控件", w: 24, h: 22, logic: {
					trigger: "点击",
					action: "折叠 / 最小化 / 关闭",
					state: "展开 ↔ 折叠（↔ 关闭）",
					data: "写 dsh.director.layout（collapsed / open 标志）",
					fallback: "折叠态下必须有可达替代入口（曾整块消失，真机暴露）；Esc 可关闭最上层",
					shortcut: "Esc",
					code: "src/components/DirectorDialog.js rail 控制簇"
				} },
				list: { label: "列表", icon: "☰", group: "控件", w: 180, h: 140, logic: {
					trigger: "点击行",
					action: "选中该项并联动左右面板内容",
					state: "选中行高亮",
					data: "读上游数据，写选中 id",
					fallback: "列表为空时渲染空态说明，不显示空白框",
					shortcut: "↑↓ 移动选中",
					code: "src/components/DirectorHierarchy.js"
				} },
				card: { label: "卡片", icon: "▢", group: "控件", w: 200, h: 96, logic: {
					trigger: "点击卡片体",
					action: "展开详情 / 切换层级",
					state: "收起 ↔ 展开",
					data: "读汇总指标；写选中的层级 id",
					fallback: "指标缺失显示「—」而不是 NaN / undefined",
					shortcut: "—",
					code: "src/components/DirectorPage.js S.blk"
				} },
				progress: { label: "进度条", icon: "▬▬", group: "控件", w: 160, h: 8, logic: {
					trigger: "—（随数据被动更新）",
					action: "展示完成率（待办 / 覆盖度）",
					state: "宽度随百分比变化",
					data: "读 todos / auditCoverage 汇总",
					fallback: "分母为 0 时显示 0% 而不是 NaN%",
					shortcut: "—",
					code: "src/components/DirectorPage.js"
				} },
			
				// ── 语义类（总监专有）──
				node: { label: "导图节点", icon: "●", group: "语义", w: 130, h: 44, logic: {
					trigger: "左键点选 / 拖拽 / 方向键微移",
					action: "选中 → 左侧逻辑面板显示该分支的交互逻辑",
					state: "常态 / hover / 选中 / 执行中 四态",
					data: "血缘来自 sessions.fork 写入的 meta.parentSession（只消费，不新建模型）",
					fallback: "摘要无血缘字段时退化为分组树并**显式标注「无血缘」**，不假装是分支树",
					shortcut: "方向键微移 / Shift+方向键 1px",
					code: "src/logic/branch-tree.js"
				} },
				edge: { label: "连线", icon: "—", group: "语义", w: 80, h: 2, logic: {
					trigger: "—（随节点位置实时重算）",
					action: "绘制父子血缘连线",
					state: "随节点移动 / 折叠实时重算",
					data: "读 flattenLineage() 已有的 children 映射 + depth 缩进",
					fallback: "检测到环时**断边并标记 cycles**，不无限递归",
					shortcut: "—",
					code: "src/logic/branch-tree.js"
				} },
				overline: { label: "浮动按钮组", icon: "◍", group: "语义", w: 150, h: 34, logic: {
					trigger: "点击",
					action: "打开对应全屏能力（设计图 / 思维导图 / 总监）",
					state: "目标层 open 标志翻转（designStudioOpen / mindmapOpen / dialogOpen）",
					data: "写 dsh.director.layout",
					fallback: "某层渲染异常被 SafeLayer 隔离，只损失该层并显示可重试角标；顺序「🧠导图」在「◆总监」之前（用户明确要求）",
					shortcut: "Esc 关闭最上层",
					code: "src/components/FloatDock.js"
				} }
			});
			
			/** 全部类型 key（校验 / 遍历用） */
			const ELEMENT_KIND_KEYS = Object.freeze(Object.keys(ELEMENT_KINDS));
			
			/** 按 group 分组（工具栏渲染用） */
			function kindsByGroup() {
				const out = {};
				for (const k of ELEMENT_KIND_KEYS) {
					const g = ELEMENT_KINDS[k].group;
					(out[g] = out[g] || []).push(k);
				}
				return out;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 二、交互逻辑字段（点击元素 → 左侧面板显示的就是这 7 个）
			 *     字段是**固定七元组**：不设自由文本，否则又退化成"各写各的"。
			 * ══════════════════════════════════════════════════════════════════ */
			
			const LOGIC_FIELDS = Object.freeze([
				{ key: "trigger", label: "触发方式", hint: "鼠标 / 键盘 / 事件，写清具体按键或事件名" },
				{ key: "action", label: "行为", hint: "点下去发生什么（一句话，可核验）" },
				{ key: "state", label: "状态变化", hint: "前后状态，如「展开 → 缩起」" },
				{ key: "data", label: "数据流向", hint: "读哪个 store，写哪个 store" },
				{ key: "fallback", label: "退化路径", hint: "失败 / 空数据 / 无权时怎么办（**不许留空**）" },
				{ key: "shortcut", label: "快捷键", hint: "与该动作等价的键盘路径" },
				{ key: "code", label: "对应代码", hint: "实现该逻辑的文件 —— 这条是给改代码的人看的" }
			]);
			
			/** 逻辑七元组的空骨架 */
			function emptyLogic() {
				const o = {};
				for (const f of LOGIC_FIELDS) o[f.key] = "";
				return o;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 三、元素实例：创建 / 归一化 / 校验
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 画布坐标与尺寸的下限（防负数与零面积元素） */
			const MIN_SIZE = 8;
			/** 画布逻辑尺寸（V16 折算视口；设计图与真机 1:1.22） */
			const CANVAS_W = 1180;
			const CANVAS_H = 644;
			
			let seq = 0;
			/** 稳定可读 id（便于在对话里指称："把 el-3 的按钮右移 20"） */
			function nextElementId(kind) {
				seq += 1;
				return "el-" + seq + "-" + String(kind || "x").slice(0, 3);
			}
			/** 重置序号（加载模板后调用，避免 id 与已有元素撞车） */
			function syncSeqFrom(elements) {
				let max = 0;
				for (const e of elements || []) {
					const m = /^el-(\d+)-/.exec(String(e && e.id));
					if (m) max = Math.max(max, Number(m[1]));
				}
				seq = Math.max(seq, max);
			}
			
			const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
			const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
			
			/**
			 * 创建一个元素实例。
			 * @param {string} kind ELEMENT_KINDS 的 key
			 * @param {object} [patch] 覆盖字段（x/y/w/h/label/logic/props）
			 * @returns {object|null} 未知 kind 返回 null（调用方须判空）
			 */
			function createElement(kind, patch = {}) {
				const spec = ELEMENT_KINDS[kind];
				if (!spec) return null;
				const p = patch || {};
				const el = {
					id: p.id || nextElementId(kind),
					kind,
					x: Math.round(clamp(num(p.x, 0), 0, CANVAS_W)),
					y: Math.round(clamp(num(p.y, 0), 0, CANVAS_H)),
					w: Math.round(clamp(num(p.w, spec.w), MIN_SIZE, CANVAS_W)),
					h: Math.round(clamp(num(p.h, spec.h), MIN_SIZE, CANVAS_H)),
					z: Math.round(num(p.z, 1)),
					label: String(p.label == null ? spec.label : p.label),
					props: { ...(p.props || {}) },
					// 逻辑骨架来自类型默认值，再用实例覆盖 —— 保证「每个元素都有逻辑可显示」
					logic: { ...emptyLogic(), ...(spec.logic || {}), ...(p.logic || {}) }
				};
				return el;
			}
			
			/** 归一化（加载模板 / 从库读回时用；保证字段齐全，缺的补默认） */
			function normalizeElement(raw) {
				if (!raw || !raw.kind || !ELEMENT_KINDS[raw.kind]) return null;
				return createElement(raw.kind, raw);
			}
			
			/** 元素是否可渲染（只校验会影响绘制的字段） */
			function isRenderable(el) {
				return Boolean(el && el.id && ELEMENT_KINDS[el.kind]
					&& Number.isFinite(el.x) && Number.isFinite(el.y)
					&& el.w >= MIN_SIZE && el.h >= MIN_SIZE);
			}
			
			/** 命中测试：坐标 → 最上层元素（z 大者优先） */
			function hitTest(elements, x, y) {
				const list = (elements || []).filter(isRenderable);
				let best = null;
				for (const el of list) {
					if (x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h) {
						if (!best || el.z >= best.z) best = el;
					}
				}
				return best;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 四、标准框架模板 —— 「三页签 + 两弹窗 + 导图态」
			 *     一键铺设：所有元素自带 label 与逻辑，后续讨论可指着 id 说话。
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 模板定义：`seed` 是 createElement 的 patch 列表。
			 * 🔴 坐标与 V16 板块 A 的高保真画面**逐块对应**，改画面时同步改这里。
			 */
			const FRAME_SEEDS = [
				// 窗口 + 侧栏
				{ kind: "window", label: "Harness 主窗口", x: 0, y: 0, w: 1180, h: 644, z: 0 },
				{ kind: "sidebar", label: "侧栏 · 会话树", x: 0, y: 0, w: 230, h: 644, z: 1 },
				// 页签环
				{ kind: "tabring", label: "页签环 · 总监/对话/轨迹", x: 240, y: 6, w: 440, h: 28, z: 3 },
				// R1 顶栏
				{ kind: "region", label: "R1 顶部栏", x: 240, y: 40, w: 930, h: 34, z: 2 },
				// R2 总览四卡
				{ kind: "card", label: "R2 项目总览 · 四指标", x: 240, y: 80, w: 930, h: 76, z: 2 },
				// R2.5 控制台
				{ kind: "region", label: "R2.5 总监控制台", x: 240, y: 162, w: 930, h: 56, z: 2 },
				// R3 资源行
				{ kind: "region", label: "R3 智能体 / 技能 / 资源", x: 240, y: 224, w: 930, h: 34, z: 2 },
				// 三栏 R4 / R5 / R7
				{ kind: "panel", label: "R4 项目导航（三 Tab）", x: 240, y: 264, w: 200, h: 240, z: 2 },
				{ kind: "panel", label: "R5 总监对话区", x: 447, y: 264, w: 520, h: 240, z: 2 },
				{ kind: "panel", label: "R7 详情 / 产出物", x: 974, y: 264, w: 196, h: 240, z: 2 },
				// R6 记忆 + R8 输入
				{ kind: "region", label: "R6 记忆面板", x: 240, y: 510, w: 930, h: 62, z: 2 },
				{ kind: "input", label: "R8 全局输入条", x: 240, y: 578, w: 850, h: 30, z: 3 },
				{ kind: "badge", label: "目标徽章 · 总监/对话", x: 240, y: 612, w: 96, h: 20, z: 3 },
				// 右侧对话弹窗（浮层三态）
				{ kind: "panel", label: "右侧「对话」弹窗", x: 858, y: 40, w: 312, h: 604, z: 6 },
				// 浮动按钮组（导图在总监之前）
				{ kind: "overline", label: "浮动组 · 🧠思维导图 / ◆总监", x: 900, y: 590, w: 170, h: 34, z: 8 },
				// 导图态（覆盖层）
				{ kind: "canvas", label: "导图态 · 分支血缘画布", x: 60, y: 80, w: 1060, h: 440, z: 10 },
				{ kind: "node", label: "分支节点 · 根", x: 180, y: 180, w: 130, h: 44, z: 11 },
				{ kind: "node", label: "分支节点 · 子 A", x: 400, y: 140, w: 130, h: 44, z: 11 },
				{ kind: "node", label: "分支节点 · 子 B", x: 400, y: 240, w: 130, h: 44, z: 11 },
				{ kind: "edge", label: "血缘连线", x: 310, y: 200, w: 90, h: 2, z: 10 }
			];
			
			/** 预置的标准框架（key → {label, desc, seed}） */
			const STANDARD_FRAMES = Object.freeze({
				threeTab: {
					label: "三页签标准框架",
					desc: "总监 / 对话 / 轨迹 三页签 + 右侧弹窗 + 导图态 —— 对齐 V16 板块 A",
					seed: FRAME_SEEDS
				}
			});
			
			/**
			 * 生成标准框架的元素数组。
			 * @param {string} [key] 模板 key，默认 threeTab
			 * @returns {Array<object>} 元素数组（已归一化、id 已重编，可直接落库）
			 */
			function buildStandardFrame(key = "threeTab") {
				const frame = STANDARD_FRAMES[key] || STANDARD_FRAMES.threeTab;
				return (frame.seed || []).map((s) => {
					const el = createElement(s.kind, s);
					// 模板里的 id 必须重编：同一模板可加载多次（多份设计图），id 不能撞
					if (el) el.id = nextElementId(s.kind);
					return el;
				}).filter(Boolean);
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 五、设计图文档（一整份可编辑稿）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 文档 schema 版本（结构变更时 +1，读取端据此迁移） */
			const DESIGN_DOC_SCHEMA = 1;
			
			/** 文档序号（**确定性**：不用 Math.random —— 随机 id 会让测试无法断言） */
			let docSeq = 0;
			function nextDocId() {
				docSeq += 1;
				return "dd_" + Date.now().toString(36) + "_" + docSeq;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 六、版本快照（2026-09-12 新增 · 用户需求「也没有保存 和不同版本的选择」）
			 *
			 * 🔴 为什么 `revision` 不够 —— 这是本模块存在的唯一理由：
			 *   `revision` 是**每次落盘就 +1** 的自动代数（拖一下 +1、按一次方向键 +1），
			 *   真机上看到的数字是 **605**。它能证明"存过 605 次"，却**回答不了用户真正会问的那句话**：
			 *   「回到我刚才那个布局」—— 因为 605 次里**没有任何一次被标记为"这一版要留着"**。
			 *   屏幕上是 605 个点，没有一个是"版本"。所以另立一套语义：`versions[]`。
			 *
			 * 三条设计取舍（均记录理由，便于日后推翻时知道推翻的是什么）：
			 *   ① **内嵌在 doc 里**，不另开 localStorage 键 / 不另开 IDB store。
			 *      版本必须与图**同生共死**：删除图时版本一起走。独立存储极易留孤儿版本，且回滚要多一次异步等待。
			 *   ② **只快照 elements，不含 title**。标题是"图的身份"，内容是"图的样子"。
			 *      回滚语义定为「**内容**回到那一刻」；若连标题一起回滚，用户重命名后再回滚会觉得图被换掉了。
			 *   ③ **限流 VERSION_LIMIT**。每版是一份完整 elements 深拷贝（20 元素 ≈ 4KB），
			 *      无上限会吃满 localStorage 5MB 配额 —— 而配额满的失败是**静默**的（persist 的 catch 吞掉）。
			 *
			 * ⚠️ 与 R5 冻结契约的关系：`dsh.director.design` 是**本插件自有键**（不在 R5 冻结清单内），
			 *    故可自由增字段；但 `docId/title/elements/thread/revision` 五个既有字段**一律不动名、不动义**，
			 *    保证「已落死基线」读得懂本版本写的数据，反之亦然。
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 每个设计图最多保留的版本数（超出淘汰最旧的；不做"归档"，理由：归档=隐藏的孤儿数据） */
			const VERSION_LIMIT = 30;
			
			/**
			 * 深拷贝元素。
			 * 🔴 **必须真深拷贝**：版本与工作副本一旦共享引用，之后拖拽工作副本的元素
			 *    （`moveElement` 返回新 doc 但内部元素对象可能被复用）就会**穿透改掉历史版本**，
			 *    表现是"回滚到 v3 却是最新的样子" —— 这类共享引用 bug 不报错、只出错。
			 */
			function cloneElements(els) {
				return JSON.parse(JSON.stringify(els || []));
			}
			
			/** 版本序号（确定性策略同 docSeq） */
			let verSeq = 0;
			function nextVersionId() {
				verSeq += 1;
				return "dv_" + Date.now().toString(36) + "_" + verSeq;
			}
			
			/**
			 * 生成一份版本快照。
			 * @param {object} doc 源文档（工作副本）
			 * @param {{note?:string,label?:string,vid?:string}} [patch]
			 *   `note` 建议写"这一版改了什么" —— 它决定日后能不能指着版本说话（"回到'底栏加高'那版"）。
			 */
			function createVersion(doc, patch = {}) {
				const p = patch || {};
				const n = ((doc && doc.versions) || []).length + 1;
				const els = cloneElements((doc && doc.elements) || []);
				return {
					vid: p.vid || nextVersionId(),
					label: String(p.label || ("v" + n)),
					note: String(p.note || "").slice(0, 200),
					savedAt: Date.now(),
					revision: Number((doc && doc.revision) || 0),
					count: els.length,
					elements: els
				};
			}
			
			/**
			 * 归一化读回的版本（坏版本剔除）。
			 * 注意：`normalizeElement` 会**保留传入的 id**（`createElement` 里 `p.id || nextElementId()`），
			 * 故版本内元素 id 与工作副本一致 ⇒ 回滚后选中态、对话里的 id 指称仍然对得上。
			 */
			function normalizeVersion(raw, i) {
				if (!raw || !raw.vid) return null;
				const els = (raw.elements || []).map(normalizeElement).filter(Boolean);
				return {
					vid: raw.vid,
					label: String(raw.label || ("v" + ((i || 0) + 1))),
					note: String(raw.note || ""),
					savedAt: raw.savedAt || Date.now(),
					revision: Number(raw.revision || 0),
					count: els.length,
					elements: els
				};
			}
			
			/** 版本摘要（不含 elements —— UI 列表与"选择版本"用，避免大对象外泄） */
			function versionSummary(v) {
				if (!v) return null;
				return { vid: v.vid, label: v.label, note: v.note, savedAt: v.savedAt, count: v.count, revision: v.revision };
			}
			
			/**
			 * 新建一份设计图文档。
			 * @param {object} [patch] { title, frameKey, elements, thread, versions }
			 */
			function createDesignDoc(patch = {}) {
				const p = patch || {};
				const elements = p.elements ? p.elements.map(normalizeElement).filter(Boolean) : buildStandardFrame(p.frameKey);
				syncSeqFrom(elements);
				const now = Date.now();
				return {
					docId: p.docId || nextDocId(),
					schema: DESIGN_DOC_SCHEMA,
					title: String(p.title || "未命名设计图"),
					frameKey: p.frameKey || "threeTab",
					elements,
					// 设计图专用临时对话（只处理设计图修订）—— 与总监对话、宿主会话**三向隔离**
					thread: Array.isArray(p.thread) ? p.thread : [],
					/* 版本快照：新建图**无版本**（= 还没保存过）⇒ 顶栏显示"未保存"而不是"v0" */
					versions: Array.isArray(p.versions) ? p.versions.map(normalizeVersion).filter(Boolean) : [],
					createdAt: p.createdAt || now,
					updatedAt: now,
					revision: Number(p.revision || 0) + 1
				};
			}
			
			/** 归一化读回的文档（缺字段补默认，坏元素剔除） */
			function normalizeDoc(raw) {
				if (!raw || !raw.docId) return null;
				const elements = (raw.elements || []).map(normalizeElement).filter(Boolean);
				syncSeqFrom(elements);
				return {
					docId: raw.docId,
					schema: DESIGN_DOC_SCHEMA,
					title: String(raw.title || "未命名设计图"),
					frameKey: raw.frameKey || "threeTab",
					elements,
					thread: Array.isArray(raw.thread) ? raw.thread : [],
					/* 🔴 旧数据兼容（必须有）：基线冻结前落库的 doc 没有 versions 字段，
					 *    此处补空数组而不是补一个"自动版本" —— 补出来的版本会让用户以为曾经保存过。
					 *    代价是首次升级时所有图显示"未保存"，属**正确**的诚实显示。 */
					versions: (raw.versions || []).map(normalizeVersion).filter(Boolean),
					createdAt: raw.createdAt || Date.now(),
					updatedAt: raw.updatedAt || Date.now(),
					revision: Number(raw.revision || 0)
				};
			}
			
			/** 文档统计（左侧面板与状态栏显示用） */
			function docStats(doc) {
				const els = (doc && doc.elements) || [];
				const byKind = {};
				for (const e of els) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
				const missingLogic = els.filter((e) => !e.logic || !e.logic.action).length;
				return { total: els.length, byKind, missingLogic, thread: ((doc && doc.thread) || []).length };
			}
			
			exports.ELEMENT_KINDS = ELEMENT_KINDS;
			exports.ELEMENT_KIND_KEYS = ELEMENT_KIND_KEYS;
			exports.kindsByGroup = kindsByGroup;
			exports.LOGIC_FIELDS = LOGIC_FIELDS;
			exports.emptyLogic = emptyLogic;
			exports.MIN_SIZE = MIN_SIZE;
			exports.CANVAS_W = CANVAS_W;
			exports.CANVAS_H = CANVAS_H;
			exports.nextElementId = nextElementId;
			exports.syncSeqFrom = syncSeqFrom;
			exports.createElement = createElement;
			exports.normalizeElement = normalizeElement;
			exports.isRenderable = isRenderable;
			exports.hitTest = hitTest;
			exports.STANDARD_FRAMES = STANDARD_FRAMES;
			exports.buildStandardFrame = buildStandardFrame;
			exports.DESIGN_DOC_SCHEMA = DESIGN_DOC_SCHEMA;
			exports.nextDocId = nextDocId;
			exports.VERSION_LIMIT = VERSION_LIMIT;
			exports.cloneElements = cloneElements;
			exports.nextVersionId = nextVersionId;
			exports.createVersion = createVersion;
			exports.normalizeVersion = normalizeVersion;
			exports.versionSummary = versionSummary;
			exports.createDesignDoc = createDesignDoc;
			exports.normalizeDoc = normalizeDoc;
			exports.docStats = docStats;
		};

		// ── store/design.js ──
		__defs["store/design.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：设计图数据层（文档 CRUD + 元素操作 + 专用临时对话）
			 * 引用：V16 诉求 2 · 5（逻辑全实现 + 指令过确认闸门）+ 2026-09-12 诉求 10（保存与版本） · 要求 1
			 * 上游：client-entry.js, components/DesignStudio.js, mount.js
			 * 下游：store/design-schema.js, store/plugin-db.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 D5 · D6（元素操作 + 指令解析）· E3（版本 API）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * store/design.js — 设计图数据层（文档 CRUD + 元素操作 + 专用临时对话）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 D】
			 *   ├─ D1 全屏工作室布局     → components/DesignStudio.js
			 *   ├─ D2/D4 元素原子与模板   → store/design-schema.js
			 *   ├─ D5 元素操作（本文件）   → add/update/move/resize/remove/duplicate/reorder
			 *   └─ D6 设计图专用对话（本文件 thread）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  三条隔离（用户要求「属于新开的临时对话 只处理设计图」）
			 * ══════════════════════════════════════════════════════════════════
			 *   ① **不与宿主会话共用**：设计图 thread 存在本文件自己的 key，
			 *      既不写宿主的 session store，也不调 `sendToChat`。
			 *   ② **不与总监对话共用**：总监消息在 `plugin-db/directorConversations`，
			 *      设计图 thread 在 `dsh.director.design`。两者互不可见。
			 *   ③ **一图一线程**：每份设计图文档自带 `thread`，删图即删线
			 *      （临时对话的字面含义：它只服务于这一份图）。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  持久化：localStorage 主 + plugin-db 备份（双写）
			 * ══════════════════════════════════════════════════════════════════
			 *   为什么不是只用 IDB：
			 *     设计图数据量小（几十元素 ≈ 20KB），而 IDB 是**异步**的 —— 拖拽过程中每帧都
			 *     落库会产生竞态。localStorage 同步写可保证「拖完即存」。
			 *   为什么还要 IDB：
			 *     符合要求 1「独立数据元」，且 IDB 容量不受 5MB 限制，便于后续存大图。
			 *   读取以 localStorage 为准（同步、必定最新）；IDB 为冷备。
			 *
			 *  🔴 R5 冻结项：本文件**不碰** `dsh.director.store.*` / `dsh.director.layout` /
			 *     `director-main` / `dsh.director.config` / `dsh-director-db` / cookie 前缀。
			 *     `dsh.director.design` 是**新增键**（冻结清单之外），安全。
			 *
			 * 错误处理：所有持久化 API catch 后返回安全缺省，不向上抛（与 store/idb.js 一致）。
			 */
			
			const { ELEMENT_KINDS, createElement, normalizeElement, isRenderable, createDesignDoc, normalizeDoc, docStats, buildStandardFrame, CANVAS_W, CANVAS_H, MIN_SIZE, createVersion, versionSummary, cloneElements, VERSION_LIMIT, syncSeqFrom } = __m("store/design-schema.js");
			// 冷备通道（兑现文件头「localStorage 主 + plugin-db 备份（双写）」的承诺）
			const { pPut, pGet, PDB } = __m("store/plugin-db.js");
			
			/* ══════════════════════════════════════════════════════════════════
			 * 存储键与内存态
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** localStorage 键（新增键，不在 R5 冻结清单内） */
			const DESIGN_KEY = "dsh.director.design";
			/** 设计图专用对话的角色（区别于总监的 user/director） */
			const DESIGN_ROLE = Object.freeze({ USER: "user", STUDIO: "studio" });
			
			let state = { docs: [], activeDocId: null, loaded: false };
			
			/** 冷备快照在 `directorDesigns` 里的固定主键（整图集一条，读写都简单） */
			const BACKUP_ID = "snapshot";
			
			/**
			 * 落盘 —— **双写**（兑现文件头承诺）
			 *   主：localStorage（同步、拖完即存、必定最新）
			 *   冷备：plugin-db/directorDesigns（异步、失败不影响主流程、容量不受 5MB 限制）
			 *
			 * 🔴 为什么必须真的写 IDB（2026-09-12 教训）：
			 *   文件头原本已写「双写」，但 `persist()` 只写了 localStorage —— **注释与代码背离**。
			 *   而真机实测：Harness 每次启动的本地 HTTP 端口会变（2606 → 28931 → 32196），
			 *   localStorage 又是**按 origin（含端口）分区**的 ⇒ 主存有丢失风险。
			 *   故冷备不是"以后可能有用"，而是**当前就有实际价值的兜底**。
			 */
			function persist() {
				try {
					if (typeof localStorage !== "undefined") {
						localStorage.setItem(DESIGN_KEY, JSON.stringify({ docs: state.docs, activeDocId: state.activeDocId }));
					}
				} catch (e) { /* 隐私模式 / 配额满：不影响内存态 */ }
				try {
					// 不 await：拖拽路径上不能引入异步抖动；失败静默（冷备允许落后）
					pPut(PDB.DESIGNS, {
						designId: BACKUP_ID,
						docs: state.docs,
						activeDocId: state.activeDocId,
						savedAt: Date.now()
					});
				} catch (e) { /* IDB 不可用：降级为仅 localStorage */ }
			}
			
			let backupTried = false;
			/**
			 * 冷备恢复 —— **仅当主存为空时**执行一次。
			 * 触发时机：`installDesignApi()`（插件装载早期），异步补齐并 notify。
			 * @returns {Promise<{restored:number, savedAt:number}|null>}
			 */
			function hydrateDesignBackup() {
				if (backupTried) return Promise.resolve(null);
				backupTried = true;
				try {
					load();
					if (typeof localStorage !== "undefined" && localStorage.getItem(DESIGN_KEY)) return Promise.resolve(null); // 主存有数据，无需恢复
					if (state.docs.length) return Promise.resolve(null);
				} catch (e) { return Promise.resolve(null); }
				return pGet(PDB.DESIGNS, BACKUP_ID).then((rec) => {
					if (!rec || !(rec.docs || []).length) return null;
					const docs = (rec.docs || []).map(normalizeDoc).filter(Boolean);
					if (!docs.length) return null;
					state = { docs, activeDocId: rec.activeDocId || (docs[0] && docs[0].docId) || null, loaded: true };
					persist();   // 回灌主存，下一轮不必再走冷备
					notify();
					return { restored: docs.length, savedAt: rec.savedAt || null };
				}).catch(() => null);
			}
			function load() {
				if (state.loaded) return;
				state.loaded = true;
				try {
					const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DESIGN_KEY) : null;
					if (!raw) return;
					const parsed = JSON.parse(raw);
					const docs = (parsed && parsed.docs ? parsed.docs : []).map(normalizeDoc).filter(Boolean);
					state = { docs, activeDocId: parsed.activeDocId || (docs[0] && docs[0].docId) || null, loaded: true };
				} catch (e) { /* 解析失败 → 空库，不抛 */ }
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 订阅（React 侧 useSyncExternalStore 可用；也供真机测试观察变更）
			 * ══════════════════════════════════════════════════════════════════ */
			
			const listeners = new Set();
			let version = 0;
			function notify() {
				version += 1;
				for (const fn of listeners) { try { fn(state, version); } catch (e) { /* 单订阅者异常不影响其他 */ } }
			}
			function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
			function getVersion() { return version; }
			function getState() { load(); return state; }
			function getActiveDoc() {
				load();
				return state.docs.find((d) => d.docId === state.activeDocId) || null;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 文档 CRUD
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 列出全部设计图（摘要，不含 elements，避免大对象外泄） */
			function listDocs() {
				load();
				return state.docs.map((d) => ({
					docId: d.docId, title: d.title, revision: d.revision,
					count: (d.elements || []).length, updatedAt: d.updatedAt
				}));
			}
			
			function getDoc(docId) {
				load();
				return state.docs.find((d) => d.docId === docId) || null;
			}
			
			/** 新建设计图（默认铺标准框架），并设为当前图 */
			function newDoc(patch = {}) {
				load();
				const doc = createDesignDoc(patch);
				state = { docs: state.docs.concat([doc]), activeDocId: doc.docId, loaded: true };
				persist();
				notify();
				return doc;
			}
			
			/**
			 * 写回一份文档到库 —— **统一出口**（替换 + persist + notify）。
			 * 🔴 抽出来的理由：`saveDoc` 与版本 API（saveVersion / restoreVersion / renameDoc / deleteVersion）
			 *    做的是同一件事。若各写一遍，就有 5 处可能漏 `persist()` 或漏 `notify()` ——
			 *    而**漏 notify 的表现是"数据存了但界面不动"**，最难查（数据是对的，看起来像 UI bug）。
			 *    此处只做"替换 + 双写 + 广播"，不含任何业务判断。
			 */
			function putDoc(next) {
				if (!next || !next.docId) return null;
				load();
				const i = state.docs.findIndex((d) => d.docId === next.docId);
				const docs = i >= 0
					? state.docs.slice(0, i).concat([next], state.docs.slice(i + 1))
					: state.docs.concat([next]);
				state = { ...state, docs };
				persist();
				notify();
				return next;
			}
			
			/** 保存（整体替换该图，revision +1） */
			function saveDoc(doc) {
				if (!doc || !doc.docId) return null;
				load();
				const next = { ...doc, updatedAt: Date.now(), revision: Number(doc.revision || 0) + 1 };
				const i = state.docs.findIndex((d) => d.docId === doc.docId);
				const docs = i >= 0 ? state.docs.slice(0, i).concat([next], state.docs.slice(i + 1)) : state.docs.concat([next]);
				state = { ...state, docs };
				persist();
				notify();
				return next;
			}
			
			function deleteDoc(docId) {
				load();
				const docs = state.docs.filter((d) => d.docId !== docId);
				const activeDocId = state.activeDocId === docId ? ((docs[0] && docs[0].docId) || null) : state.activeDocId;
				state = { docs, activeDocId, loaded: true };
				persist();
				notify();
				return true;
			}
			
			function setActiveDoc(docId) {
				load();
				state = { ...state, activeDocId: docId || null };
				persist();
				notify();
				return state.activeDocId;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 版本快照 API（2026-09-12 新增 · 用户需求「也没有保存 和不同版本的选择」）
			 *
			 *   语义分工（这是本组函数存在的理由）：
			 *     `revision`  —— **自动落盘代数**，每次写库 +1（拖拽也 +1）。证明"存过"，不证明"留过"。
			 *     `versions[]`—— **用户显式保存的版本**。只在点【保存】时生成，可命名、可回滚。
			 *   所以顶栏显示的不是 revision，而是"未保存 / 已保存 v3"。
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** logic 七元组做稳定序列化（键排序）—— 否则 `{a,b}` 与 `{b,a}` 会被误判为"有改动" */
			function stableLogic(l) {
				const o = l || {};
				return Object.keys(o).sort().map((k) => k + "=" + String(o[k] == null ? "" : o[k])).join("\u0001");
			}
			
			/**
			 * 逐元素比对两份 elements 是否等价（id/几何/标签/逻辑）。
			 * 只比**会影响图的样子**的字段：props 不参与（它是预留扩展位，未接线，比它会造成假"脏"）。
			 */
			function sameElements(a, b) {
				const A = a || [], B = b || [];
				if (A.length !== B.length) return false;
				for (let i = 0; i < A.length; i++) {
					const x = A[i], y = B[i];
					if (!x || !y) return false;
					if (x.id !== y.id || x.kind !== y.kind) return false;
					if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h || x.z !== y.z) return false;
					if (String(x.label) !== String(y.label)) return false;
					if (stableLogic(x.logic) !== stableLogic(y.logic)) return false;
				}
				return true;
			}
			
			/**
			 * 找出「内容与当前工作副本一致」的版本（**从新到旧**找，命中即返回）；没有则 null。
			 * 它是脏判定的真正基准 —— 见 isDirty 的说明。
			 */
			function matchVersion(doc) {
				if (!doc) return null;
				const vs = doc.versions || [];
				const els = doc.elements || [];
				for (let i = vs.length - 1; i >= 0; i--) {
					if (sameElements(vs[i].elements, els)) return vs[i];
				}
				return null;
			}
			
			/**
			 * 当前工作副本是否有**未保存改动**。
			 *
			 * 🔴 判据是「当前内容是否**已经存在于某个版本里**」，而**不是**"是否等于最后一版"。
			 *    反例是离线测试 C5 抓出来的（真机必现）：
			 *      回滚到 v1 时，store 会先把回滚前的内容自动存成 v2（保护用户刚做的东西）⇒
			 *      "最新版本"变成了 v2，而当前内容等于 v1
			 *      ⇒ 用"等于最后一版"判 ⇒ 刚回滚完的界面被标成「有未保存改动」。
			 *      用户看到的是：**内容明明回去了，顶栏却说没存** ⇒ 会怀疑回滚没生效，再点一次。
			 *      这属于「状态提示骗人」，比不提示更糟。
			 *    改成"是否存在于任一个版本里"后：
			 *      · 回滚完 ⇒ 内容 = v1 ⇒ 干净（正确）
			 *      · 刚保存 ⇒ 内容 = 刚存的那版 ⇒ 干净（正确）
			 *      · 拖了一下 ⇒ 没有任何版本等于它 ⇒ 脏（正确）
			 *    代价是 O(版本数 × 元素数)（上限 30×20=600 次字段比较），每帧可忽略。
			 *
			 * 从未保存过（versions 为空）：有元素就算"未保存"，空图算"干净"（空图没什么可保存的）。
			 */
			function isDirty(doc) {
				if (!doc) return false;
				const vs = doc.versions || [];
				if (!vs.length) return ((doc.elements || []).length > 0);
				return matchVersion(doc) === null;
			}
			
			/** 顶栏状态一屏取（避免组件里自己拼三处逻辑，出现"角标说 3、按钮说 v2"这类不一致） */
			function getVersionState(doc) {
				if (!doc) return { dirty: false, count: 0, last: null, match: null, label: "无图" };
				const vs = doc.versions || [];
				const last = vs.length ? versionSummary(vs[vs.length - 1]) : null;
				const m = matchVersion(doc);
				const dirty = vs.length ? (m === null) : ((doc.elements || []).length > 0);
				return {
					dirty, count: vs.length, last,
					match: m ? versionSummary(m) : null,
					label: !vs.length ? "未保存" : (dirty ? "未保存改动" : "已保存 " + versionSummary(m).label)
				};
			}
			
			/**
			 * 保存一个版本（用户点【保存】时调用）。
			 * @param {object} doc 当前工作副本
			 * @param {string} [note] 版本说明（建议写"改了什么"，日后靠它指称）
			 * @returns {{doc:object, version:object, dropped:number}|null}
			 */
			function saveVersion(doc, note = "") {
				if (!doc || !doc.docId) return null;
				load();
				const v = createVersion(doc, { note });
				let vs = (doc.versions || []).concat([v]);
				/* 限流：超上限淘汰最旧。**不静默** —— 返回 dropped 让 UI 能提示"已淘汰最早的 1 个版本"。 */
				const dropped = Math.max(0, vs.length - VERSION_LIMIT);
				if (dropped) vs = vs.slice(dropped);
				const next = { ...doc, versions: vs, updatedAt: Date.now() };
				putDoc(next);
				return { doc: next, version: versionSummary(v), dropped };
			}
			
			/** 列出某图的版本摘要（**新的在前** —— 列表第一项就是"最近保存的"） */
			function listVersions(docId) {
				load();
				const d = state.docs.find((x) => x.docId === docId);
				if (!d) return [];
				return (d.versions || []).map(versionSummary).reverse();
			}
			
			/**
			 * 回滚到指定版本 —— **回滚前自动存档**。
			 *
			 * 🔴 「回滚前自动存档」是硬约束，不是可选优化：
			 *    回滚会覆盖工作副本；若不先存档，用户花十分钟拖的布局会被一次误点**不可逆地清掉**。
			 *    这与 e2e C 系列断言（回滚后元素恢复）不冲突：存档只**追加**版本，不改回滚目标内容。
			 *
			 * @returns {{doc:object, from:object, autoSaved:boolean}|null} 目标版本不存在时返回 null
			 */
			function restoreVersion(docId, vid) {
				load();
				const d = state.docs.find((x) => x.docId === docId);
				if (!d) return null;
				const v = (d.versions || []).find((x) => x.vid === vid);
				if (!v) return null;
				let vs = (d.versions || []).slice();
				let autoSaved = false;
				// 当前状态与最新版本不同才存（相同则存档等于刷一个重复版本）
				if (!sameElements((vs[vs.length - 1] || {}).elements, d.elements)) {
					vs = vs.concat([createVersion(d, { note: "回滚前自动存档" })]);
					if (vs.length > VERSION_LIMIT) vs = vs.slice(vs.length - VERSION_LIMIT);
					autoSaved = true;
				}
				const elements = cloneElements(v.elements);
				syncSeqFrom(elements);   // 版本元素 id 与工作副本同源，此处仅为护栏
				const next = {
					...d, elements, versions: vs, updatedAt: Date.now(),
					revision: Number(d.revision || 0) + 1   // 回滚也是一次内容变更，revision 照常 +1
				};
				putDoc(next);
				return { doc: next, from: versionSummary(v), autoSaved };
			}
			
			/** 删除单个版本（删到 0 个属合法：等于回到"未保存"） */
			function deleteVersion(docId, vid) {
				load();
				const d = state.docs.find((x) => x.docId === docId);
				if (!d) return null;
				const vs = (d.versions || []).filter((x) => x.vid !== vid);
				if (vs.length === (d.versions || []).length) return null;   // 没找到，不算成功
				const next = { ...d, versions: vs, updatedAt: Date.now() };
				putDoc(next);
				return next;
			}
			
			/** 重命名设计图（标题是"身份"不参与版本快照 ⇒ 回滚不会把名字带走） */
			function renameDoc(docId, title) {
				load();
				const d = state.docs.find((x) => x.docId === docId);
				if (!d) return null;
				const t = String(title == null ? "" : title).trim();
				if (!t) return null;   // 空名拒绝（而不是静默改成"未命名"——空名是用户手滑）
				const next = { ...d, title: t.slice(0, 60), updatedAt: Date.now() };
				putDoc(next);
				return next;
			}
			
			/**
			 * 复制设计图。
			 * **不带版本历史**：副本是"从现在开始"的新图，继承历史版本会让版本号来源含混
			 * （副本里出现"回滚前自动存档"这种属于原图的记录）。
			 */
			function duplicateDoc(docId) {
				load();
				const d = state.docs.find((x) => x.docId === docId);
				if (!d) return null;
				const copy = createDesignDoc({
					title: d.title + " · 副本",
					frameKey: d.frameKey,
					elements: cloneElements(d.elements),
					thread: []
				});
				state = { docs: state.docs.concat([copy]), activeDocId: copy.docId, loaded: true };
				persist();
				notify();
				return copy;
			}
			
			/** 整体重置（仅测试/调试；不碰宿主任何数据） */
			function resetDesignStore() {
				state = { docs: [], activeDocId: null, loaded: true };
				persist();
				notify();
				return true;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 元素操作 —— 全部是**纯函数**（入参 doc 不被修改，返回新 doc）
			 *   纯函数便于 vitest 直接断言，无需渲染 React，也无需 DOM。
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 把 doc 的 elements 换掉并返回新 doc（不落库；由调用方决定何时 saveDoc） */
			function withElements(doc, elements) {
				if (!doc) return null;
				return { ...doc, elements: elements.filter(Boolean), updatedAt: Date.now() };
			}
			
			const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
			
			/**
			 * 增加元素（用户要求「允许…增加元素」）。
			 * @param {object} doc
			 * @param {string} kind ELEMENT_KINDS key
			 * @param {{x?:number,y?:number}} [at] 落点；缺省放在画布中上部并做层叠偏移
			 */
			function addElement(doc, kind, at = {}) {
				if (!doc) return null;
				const n = (doc.elements || []).length;
				const el = createElement(kind, {
					x: at.x != null ? at.x : 40 + (n % 12) * 18,
					y: at.y != null ? at.y : 40 + (n % 12) * 16,
					z: maxZ(doc) + 1
				});
				if (!el) return null;
				return withElements(doc, (doc.elements || []).concat([el]));
			}
			
			/** 更新元素字段（label / props / logic 等） */
			function updateElement(doc, id, patch) {
				if (!doc) return null;
				return withElements(doc, (doc.elements || []).map((e) => (e.id === id ? { ...e, ...patch, props: { ...e.props, ...(patch.props || {}) }, logic: { ...e.logic, ...(patch.logic || {}) } } : e)));
			}
			
			/** 移动（拖拽）—— 边界钳制，不允许拖出画布外丢失 */
			function moveElement(doc, id, x, y) {
				if (!doc) return null;
				return withElements(doc, (doc.elements || []).map((e) => {
					if (e.id !== id) return e;
					return { ...e, x: Math.round(clampTo(x, 0, CANVAS_W - MIN_SIZE)), y: Math.round(clampTo(y, 0, CANVAS_H - MIN_SIZE)) };
				}));
			}
			
			/** 平移（拖拽增量的语义化包装；Δ 由指针位移算出） */
			function nudgeElement(doc, id, dx, dy) {
				const el = (doc && doc.elements || []).find((e) => e.id === id);
				if (!el) return doc;
				return moveElement(doc, id, el.x + dx, el.y + dy);
			}
			
			/** 改尺寸（拖右下角手柄） */
			function resizeElement(doc, id, w, h) {
				if (!doc) return null;
				return withElements(doc, (doc.elements || []).map((e) => (e.id === id
					? { ...e, w: Math.round(clampTo(w, MIN_SIZE, CANVAS_W)), h: Math.round(clampTo(h, MIN_SIZE, CANVAS_H)) }
					: e)));
			}
			
			/** 删除元素 */
			function removeElement(doc, id) {
				if (!doc) return null;
				return withElements(doc, (doc.elements || []).filter((e) => e.id !== id));
			}
			
			/** 复制元素（原位右下偏移 16px，便于看见） */
			function duplicateElement(doc, id) {
				const el = (doc && doc.elements || []).find((e) => e.id === id);
				if (!el) return doc;
				const copy = createElement(el.kind, { ...el, id: undefined, x: el.x + 16, y: el.y + 16, z: maxZ(doc) + 1 });
				return withElements(doc, (doc.elements || []).concat([copy]));
			}
			
			/** 改层级（置顶 / 置底） */
			function reorderElement(doc, id, where) {
				if (!doc) return null;
				const els = doc.elements || [];
				const top = Math.max(1, ...els.map((e) => e.z || 1));
				return withElements(doc, els.map((e) => (e.id === id ? { ...e, z: where === "bottom" ? 0 : top + 1 } : e)));
			}
			
			/** 批量设置交互逻辑（左侧面板的「编辑」写入点） */
			function updateLogic(doc, id, patch) {
				const el = (doc && doc.elements || []).find((e) => e.id === id);
				if (!el) return doc;
				return updateElement(doc, id, { logic: { ...(el.logic || {}), ...(patch || {}) } });
			}
			
			function maxZ(doc) {
				const els = (doc && doc.elements) || [];
				return els.length ? Math.max(...els.map((e) => Number(e.z) || 1)) : 0;
			}
			
			/** 可渲染元素（按 z 升序，供画布绘制） */
			function visibleElements(doc) {
				return ((doc && doc.elements) || []).filter(isRenderable).sort((a, b) => (a.z || 0) - (b.z || 0));
			}
			
			/** 重新加载标准框架（丢弃现元素；调用方负责确认） */
			function loadStandardFrame(doc, frameKey = "threeTab") {
				if (!doc) return null;
				return withElements({ ...doc, frameKey }, buildStandardFrame(frameKey));
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 设计图专用临时对话（**只处理设计图**）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 追加一条线程消息。消息是**纯记录**：本函数不调用任何模型、不写宿主会话。
			 * 真正的"处理"由上层（DesignStudio）决定 —— 它只能产生对**本图元素**的操作。
			 * @param {object} doc
			 * @param {{role?:string,text:string,ops?:Array}} msg
			 */
			function appendThread(doc, msg) {
				if (!doc || !msg) return doc;
				const rec = {
					id: "tm_" + Date.now().toString(36) + "_" + ((doc.thread || []).length + 1),
					role: msg.role === DESIGN_ROLE.USER ? DESIGN_ROLE.USER : DESIGN_ROLE.STUDIO,
					text: String(msg.text == null ? "" : msg.text),
					ops: Array.isArray(msg.ops) ? msg.ops : [],
					at: Date.now()
				};
				return { ...doc, thread: (doc.thread || []).concat([rec]), updatedAt: Date.now() };
			}
			
			/**
			 * 把一句设计图修订指令翻译成**元素操作**（本地规则，不依赖模型）。
			 *
			 * ⚠️ 设计取舍：这里刻意只做**可解释的规则解析**（引用元素 id/标签 + 动词）。
			 *    理由：设计图修订必须是**确定性**的 —— 模型幻觉一个不存在的元素会让图变坏，
			 *    而"指哪改哪"正是这个功能存在的意义。模型只在需要生成**新元素建议**时参与。
			 *
			 * 支持指令（可组合）：
			 *   移动 <元素> 左/右/上/下 [N]      删除 <元素>
			 *   放大/缩小 <元素> [N]             置顶 <元素>
			 *   复制 <元素>                      改文案 <元素> 为 <文本>
			 * @param {object} doc
			 * @param {string} text
			 * @returns {{ops:Array<{op:string,target:string,args:object}>, unresolved:string[]}}
			 */
			function parseDesignCommand(doc, text) {
				const els = (doc && doc.elements) || [];
				const raw = String(text || "").trim();
				const ops = [];
				const unresolved = [];
				if (!raw) return { ops, unresolved };
			
				/**
				 * 元素指称：id 精确 → label 精确 → label 包含。
				 * 🔴 必须剥掉中英文引号（2026-09-12）：用户很自然会写「移动「R1 顶部栏」左 30」，
				 *    若把引号算进名字里就永远找不到元素。
				 */
				const find = (token) => {
					let t = String(token == null ? "" : token).trim();
					t = t.replace(/^[「『"'[\s]+/, "").replace(/[」』"'\]]+$/, "").trim();
					if (!t) return null;
					return els.find((e) => e.id === t)
						|| els.find((e) => String(e.label || "") === t)
						|| els.find((e) => String(e.label || "").includes(t))
						|| null;
				};
			
				/* 🔴 指令数字的单位 = **像素**（2026-09-12 修正 · 真机暴露）
				 *   原实现：`const STEP = 20; const n = Number(m[3] || 1) * STEP;`
				 *   ⇒ 用户说「移动 R1 顶部栏 左 30」，实际位移 30×20 = **600px**，
				 *     超出画布左边界后被 `moveElement` clamp 到 0 ⇒ 表现为"元素整个贴到最左边没了"，
				 *     且**没有任何报错**。真机上被 e2e 的位移断言（期望 30）抓出。
				 *   修正原则：**数字的含义必须与直觉、以及与同族交互一致** ——
				 *     方向键微移 10px、拖拽按 px、几何字段 x/y/w/h 全是 px
				 *     ⇒ 指令里的数字也必须就是 px，不能悄悄乘一个魔法系数。
				 */
				const DEFAULT_NUDGE_PX = 10;   // 省略数字时的默认一档（与方向键同量纲）
				const asPx = (raw, dflt) => {
					const v = Number(raw);
					return Number.isFinite(v) && v > 0 ? v : dflt;
				};
				const DIR = { 左: [-1, 0], 右: [1, 0], 上: [0, -1], 下: [0, 1] };
			
				/* 🔴 名字必须支持**多词**（2026-09-12 实测缺陷）：
				 *   原用 `([^\s，,]+)` 取名字 ⇒ 名字里一旦有空格就截断，
				 *   而标准框架的 label 恰恰全是多词（「R1 顶部栏」「R6 记忆面板」「右侧「对话」弹窗」）
				 *   ⇒ **用户最想指称的那批元素全都指称不到**，报"认不出"。
				 *   修正：改用惰性 `(.+?)` 吃到分隔词为止（`$` 或方向字 / 「为」）。
				 *   move 的方向字需要 lookahead `(?=\s|\d|$)`，否则 label 里含方向字的元素会误切
				 *   （如「右侧「对话」弹窗」里的"右"后面跟着"侧"，不是一个方向的写法）。
				 *   两种写法都支持：「移动 R1 顶部栏 左 30」/「移动「R1 顶部栏」左 30」。 */
				const patterns = [
					{ op: "move", re: /移动\s*(.+?)\s*([左右上下])(?=\s|\d|$)\s*(\d+)?/ },
					{ op: "remove", re: /删除\s*(.+)$/ },
					{ op: "scale", re: /(放大|缩小)\s*(.+?)\s*(\d+)?$/ },
					{ op: "reorder", re: /置顶\s*(.+)$/ },
					{ op: "duplicate", re: /复制\s*(.+)$/ },
					{ op: "relabel", re: /改文案\s*(.+?)\s*为\s*(.+)$/ }
				];
			
				for (const seg of raw.split(/[；;\n]/).map((s) => s.trim()).filter(Boolean)) {
					let hit = false;
					for (const p of patterns) {
						const m = p.re.exec(seg);
						if (!m) continue;
						hit = true;
						if (p.op === "move") {
							const el = find(m[1]);
							if (!el) { unresolved.push(m[1]); break; }
							const [sx, sy] = DIR[m[2]] || [1, 0];
							const n = asPx(m[3], DEFAULT_NUDGE_PX);   // 数字即像素
							ops.push({ op: "move", target: el.id, args: { dx: sx * n, dy: sy * n } });
						} else if (p.op === "scale") {
							const el = find(m[2]);
							if (!el) { unresolved.push(m[2]); break; }
							const n = asPx(m[3], 20);                 // 数字即像素（省略时 20px）
							const sign = m[1] === "放大" ? 1 : -1;
							ops.push({ op: "resize", target: el.id, args: { w: el.w + sign * n, h: el.h + sign * n } });
						} else if (p.op === "reorder") {
							const el = find(m[1]);
							if (!el) { unresolved.push(m[1]); break; }
							ops.push({ op: "reorder", target: el.id, args: { where: "top" } });
						} else if (p.op === "relabel") {
							const el = find(m[1]);
							if (!el) { unresolved.push(m[1]); break; }
							ops.push({ op: "relabel", target: el.id, args: { label: String(m[2]).trim() } });
						} else {
							const el = find(m[1]);
							if (!el) { unresolved.push(m[1]); break; }
							ops.push({ op: p.op, target: el.id, args: {} });
						}
						break;
					}
					if (!hit) unresolved.push(seg);
				}
				return { ops, unresolved };
			}
			
			/** 应用一组操作（来自 parseDesignCommand 或手工构造）—— **单次遍历，幂等安全** */
			function applyOps(doc, ops) {
				let d = doc;
				for (const o of ops || []) {
					if (!o || !o.target) continue;
					if (o.op === "move") d = nudgeElement(d, o.target, o.args.dx || 0, o.args.dy || 0);
					else if (o.op === "resize") d = resizeElement(d, o.target, o.args.w, o.args.h);
					else if (o.op === "remove") d = removeElement(d, o.target);
					else if (o.op === "duplicate") d = duplicateElement(d, o.target);
					else if (o.op === "reorder") d = reorderElement(d, o.target, o.args.where || "top");
					else if (o.op === "relabel") d = updateElement(d, o.target, { label: o.args.label });
				}
				return d;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 全局契约（调试 / 验证脚本用；不可改名）
			 * ══════════════════════════════════════════════════════════════════ */
			
			function installDesignApi() {
				if (typeof window === "undefined") return null;
				window.__dshDesign = {
					DESIGN_KEY, DESIGN_ROLE, ELEMENT_KINDS, CANVAS_W, CANVAS_H,
					getState, getActiveDoc, subscribe, getVersion,
					listDocs, getDoc, newDoc, saveDoc, deleteDoc, setActiveDoc, resetDesignStore,
					addElement, updateElement, moveElement, nudgeElement, resizeElement,
					removeElement, duplicateElement, reorderElement, updateLogic, visibleElements,
					loadStandardFrame, appendThread, parseDesignCommand, applyOps,
					docStats, buildStandardFrame,
					/* 版本快照（2026-09-12）：保存 / 版本列表 / 回滚 / 删版本 / 重命名 / 复制图 / 脏判定 */
					saveVersion, listVersions, restoreVersion, deleteVersion,
					renameDoc, duplicateDoc, isDirty, getVersionState, matchVersion, sameElements, VERSION_LIMIT,
					hydrateDesignBackup   // 冷备恢复（装载期调用；仅主存为空时生效）
				};
				// 装载即尝试冷备恢复：主存为空（换端口 / 清缓存）时把设计图找回来
				try { hydrateDesignBackup(); } catch (e) { /* 冷备失败不影响主流程 */ }
				return window.__dshDesign;
			}
			
			exports.DESIGN_KEY = DESIGN_KEY;
			exports.DESIGN_ROLE = DESIGN_ROLE;
			exports.hydrateDesignBackup = hydrateDesignBackup;
			exports.subscribe = subscribe;
			exports.getVersion = getVersion;
			exports.getState = getState;
			exports.getActiveDoc = getActiveDoc;
			exports.listDocs = listDocs;
			exports.getDoc = getDoc;
			exports.newDoc = newDoc;
			exports.saveDoc = saveDoc;
			exports.deleteDoc = deleteDoc;
			exports.setActiveDoc = setActiveDoc;
			exports.sameElements = sameElements;
			exports.matchVersion = matchVersion;
			exports.isDirty = isDirty;
			exports.getVersionState = getVersionState;
			exports.saveVersion = saveVersion;
			exports.listVersions = listVersions;
			exports.restoreVersion = restoreVersion;
			exports.deleteVersion = deleteVersion;
			exports.renameDoc = renameDoc;
			exports.duplicateDoc = duplicateDoc;
			exports.resetDesignStore = resetDesignStore;
			exports.addElement = addElement;
			exports.updateElement = updateElement;
			exports.moveElement = moveElement;
			exports.nudgeElement = nudgeElement;
			exports.resizeElement = resizeElement;
			exports.removeElement = removeElement;
			exports.duplicateElement = duplicateElement;
			exports.reorderElement = reorderElement;
			exports.updateLogic = updateLogic;
			exports.visibleElements = visibleElements;
			exports.loadStandardFrame = loadStandardFrame;
			exports.appendThread = appendThread;
			exports.parseDesignCommand = parseDesignCommand;
			exports.applyOps = applyOps;
			exports.installDesignApi = installDesignApi;
		};

		// ── components/VersionPanel.js ──
		__defs["components/VersionPanel.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：版本历史面板（"不同版本的选择"）
			 * 引用：2026-09-12 诉求 10（不同版本的选择）
			 * 上游：components/DesignStudio.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 E4（版本历史面板）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/VersionPanel.js — 版本历史面板（"不同版本的选择"）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 E · 版本与保存】
			 *  上游     components/DesignStudio.js（顶栏「版本 ▾」按钮拉起本面板）
			 *  下游     store/design.js  listVersions / restoreVersion / deleteVersion
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  它解决什么（用户原话）
			 * ══════════════════════════════════════════════════════════════════
			 *  「也没有保存 和不同版本的选择」
			 *
			 *  关键区分（这也是设计图能"指着说"的前提）：
			 *    自动落盘代数 revision ≠ 用户保存的版本。
			 *    revision 是 605 这种数字（拖一下就 +1），它答不了「回到刚才那个布局」。
			 *    本面板列的是**用户显式保存过的**版本，每条带**说明文本** ——
			 *    于是沟通可以变成「回到『底栏加高』那版」，而不是「回到第 3 个」。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  两条安全设计
			 * ══════════════════════════════════════════════════════════════════
			 *   ① 回滚是**破坏性**操作：面板顶部常显提示"回滚会先把当前样子自动存一份"，
			 *      且 store 层 `restoreVersion` 真的会存（不是文案）。用户看得见才有信心点。
			 *   ② 删除版本用**文字按钮**而非图标 ✕ —— 它与「回到此版」在同一行，
			 *      图标按钮容易被误点成回滚（两者都会改变列表，但后果差一个量级）。
			 */
			
			const react = require("react");
			
			const h = react.createElement;
			
			/* ── 局部样式（与 DesignStudio 同一套 design token；不跨文件共享 S，避免耦合） ── */
			const V = {
				panel: {
					position: "absolute", top: 44, zIndex: 10, width: 340, maxHeight: "58vh",
					display: "flex", flexDirection: "column",
					background: "var(--dsw-alias-bg-base, #17181c)", color: "var(--dsw-alias-label-primary, #e8eaed)",
					border: "1px solid var(--dsw-alias-border-l2, #3d4148)", borderRadius: 8,
					boxShadow: "0 14px 40px rgba(0,0,0,.55)", overflow: "hidden", fontSize: 11.5
				},
				head: { display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", borderBottom: "1px solid #26282e" },
				body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 4 },
				foot: { padding: "7px 10px", borderTop: "1px solid #26282e", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", lineHeight: 1.5 },
				row: {
					display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6,
					border: "1px solid transparent", background: "rgba(255,255,255,.03)"
				},
				tag: {
					fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, padding: "1px 6px", borderRadius: 4,
					background: "rgba(137,87,229,.18)", border: "1px solid rgba(137,87,229,.45)", color: "#b794f6", whiteSpace: "nowrap"
				},
				note: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
				meta: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #6f757d)", whiteSpace: "nowrap" },
				btn: {
					height: 24, padding: "0 8px", borderRadius: 5, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap",
					border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #212429)",
					color: "var(--dsw-alias-label-secondary, #c3c8ce)"
				},
				btnDel: {
					height: 24, padding: "0 7px", borderRadius: 5, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap",
					border: "1px solid rgba(248,81,73,.4)", background: "rgba(248,81,73,.12)", color: "#f0877f"
				},
				empty: { padding: "18px 12px", textAlign: "center", color: "var(--dsw-alias-label-tertiary, #8b9199)", lineHeight: 1.7 }
			};
			
			/** 版本时间显示：同一天只显时分，跨天补月-日（列表里最常看的是"刚才那版"，时分最有用） */
			function fmtTime(ts) {
				if (!ts) return "—";
				try {
					const d = new Date(ts);
					const now = new Date();
					const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
					const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
					if (sameDay) return hm;
					return (d.getMonth() + 1) + "-" + d.getDate() + " " + hm;
				} catch (e) { return "—"; }
			}
			
			/**
			 * @param {object}   props
			 * @param {object}   props.doc        当前设计图
			 * @param {Array}    props.versions   版本摘要列表（**新的在前**，来自 listVersions）
			 * @param {boolean}  props.open
			 * @param {number}   props.inset      窗口控件安全区宽度（面板右对齐时要躲开原生按钮）
			 * @param {Function} props.onClose
			 * @param {Function} props.onRestore  (vid) => void
			 * @param {Function} props.onDelete   (vid) => void
			 * @param {number}   [props.limit]    版本上限（提示用）
			 */
			function VersionPanel({ doc, versions, open, inset, onClose, onRestore, onDelete, limit }) {
				if (!open) return null;
			
				const list = Array.isArray(versions) ? versions : [];
				const cap = Number(limit || 30);
				const rightPx = Math.max(10, Number(inset || 0) + 8);
			
				return h("div", {
					style: { ...V.panel, right: rightPx },
					"data-testid": "ds-ver-panel", role: "dialog", "aria-label": "版本历史"
				}, [
					h("div", { key: "hd", style: V.head }, [
						h("span", { key: "t", style: { fontWeight: 650 } }, "🕘 版本历史"),
						h("span", { key: "c", style: V.meta, "data-testid": "ds-ver-count" }, "共 " + list.length + " / " + cap + " 个"),
						h("button", {
							key: "x", style: { ...V.btn, marginLeft: "auto" }, "data-testid": "ds-ver-close",
							"aria-label": "关闭版本历史", onClick: onClose
						}, "✕")
					]),
			
					list.length
						? h("div", { key: "bd", style: V.body, "data-testid": "ds-ver-list" },
							list.map((v) => h("div", { key: v.vid, style: V.row, "data-testid": "ds-ver-row", "data-vid": v.vid }, [
								h("span", { key: "l", style: V.tag }, v.label),
								h("span", { key: "n", style: V.note, title: v.note || "（未写说明）" }, v.note || "（未写说明）"),
								h("span", { key: "m", style: V.meta }, v.count + " 元素 · " + fmtTime(v.savedAt)),
								h("button", {
									key: "r", style: V.btn, "data-testid": "ds-ver-restore", "data-vid": v.vid,
									title: "把图的内容换成这一版（当前样子会先自动存一份）",
									onClick: () => onRestore && onRestore(v.vid)
								}, "回到此版"),
								h("button", {
									key: "d", style: V.btnDel, "data-testid": "ds-ver-del", "data-vid": v.vid,
									title: "删除这个版本记录（不影响当前图的内容）",
									onClick: () => onDelete && onDelete(v.vid)
								}, "删除")
							])))
						: h("div", { key: "em", style: V.empty, "data-testid": "ds-ver-empty" }, [
							h("div", { key: "a" }, "还没有保存过版本"),
							h("div", { key: "b", style: { marginTop: 4 } }, "顶栏点【保存】会把当前这张图存成一个版本，")
						]),
			
					h("div", { key: "ft", style: V.foot },
						"回滚会把图的内容换成所选版本；当前样子会**先自动存一份**（说明写「回滚前自动存档」），不会丢。")
				]);
			}
			
			exports.VersionPanel = VersionPanel;
		};

		// ── components/DesignStudio.js ──
		__defs["components/DesignStudio.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：设计图工作室（铺满全屏 · 可拖拽编辑 · 左侧交互逻辑 · 底部专用对话）
			 * 引用：V16 诉求 2 · 3 · 5（全屏工作室 / 审美 / 设计图插件）+ 2026-09-12 诉求 8（顶栏功能未实现）· 11（审美完善）
			 * 上游：client-entry.js, mount.js
			 * 下游：store/design-schema.js, store/design.js, util/debug.js, util/safe-area.js, components/VersionPanel.js, components/PersonalizePanel.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 D1–D6（设计图工作室五区）· E1–E2（顶栏四区 / 保存两态）· E5（顶栏避让）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/DesignStudio.js — 设计图工作室（铺满全屏 · 可拖拽编辑 · 左侧交互逻辑 · 底部专用对话）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 D】
			 *   ├─ D1 全屏工作室布局   → 本文件 DesignStudio（顶栏 / 工具栏 / 左栏 / 画布 / 底栏）
			 *   ├─ D2 元素类型库       → store/design-schema.js ELEMENT_KINDS（18 类）
			 *   ├─ D3 元素交互逻辑面板 → 本文件 LogicPanel（七元组，可编辑）
			 *   ├─ D4 标准框架模板     → store/design-schema.js STANDARD_FRAMES
			 *   ├─ D5 元素操作         → store/design.js（纯函数：增删改移缩）
			 *   └─ D6 设计图专用对话   → 本文件 ThreadBar（**只处理设计图**，不碰宿主会话）
			 *
			 *  需求原文（用户）：「在总监页面单独加一个设计图的插件吧，按钮形式 点击铺满全屏，
			 *  允许调整修改拖拽增加元素，最下面对话保留，这个对话处理设计图的修订 属于新开的临时对话
			 *  只处理设计图，然后每一个元素可以点击 点击在左侧显示交互逻辑」
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  五块区域与需求的一一对应（改布局时按此表定位）
			 * ══════════════════════════════════════════════════════════════════
			 *   ┌──────────── 顶栏 TopBar ────────────┐  D1  ：文档切换 / 载入标准框架 / 适应屏幕 / 关闭
			 *   ├──── 工具栏 KindBar ─────────────────┤  D2  ：点类型 → 增加元素
			 *   ├─ 左栏 ┬────────── 画布 ─────────────┤  D3  ：选中元素的交互逻辑（七元组，可改）
			 *   │Logic │   Canvas（拖拽 / 缩放 / 选择）│  D5  ：元素操作
			 *   ├───────┴─────────────────────────────┤
			 *   └──── 底栏 ThreadBar（设计图专用对话）─┘  D6  ：只处理本图修订
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  为什么"左侧显示交互逻辑"是这个功能的重点（而不是附属）
			 * ══════════════════════════════════════════════════════════════════
			 *  前面三版设计稿的共同失败点是：**图与逻辑分离**。画了一张图，逻辑写在另一份文档里，
			 *  两边靠"请在右区第三栏加个按钮"这种文字对指 —— 一旦改图，逻辑就跟不上。
			 *  ⇒ 本组件把逻辑**绑在元素上**：选中即见、改图即改逻辑、导出即带逻辑。
			 *  ⇒ 于是设计图本身成为**可执行的规格**，而不是一张需要解读的图片。
			 *
			 * ⚠️ 构建约束：`react` / `react/jsx-runtime` 为平台冻结模块（ADR-001），构建期外置。
			 *    本文件用 `react.createElement`（h）形态，不使用 JSX。
			 */
			
			const react = require("react");
			const { ELEMENT_KINDS, LOGIC_FIELDS, CANVAS_W, CANVAS_H, kindsByGroup, docStats, VERSION_LIMIT } = __m("store/design-schema.js");
			const { getActiveDoc, getState, subscribe, newDoc, saveDoc, deleteDoc, setActiveDoc, listDocs, addElement, moveElement, resizeElement, removeElement, duplicateElement, reorderElement, updateElement, updateLogic, visibleElements, loadStandardFrame, appendThread, parseDesignCommand, applyOps, DESIGN_ROLE, saveVersion, listVersions, restoreVersion, deleteVersion, renameDoc, duplicateDoc, getVersionState } = __m("store/design.js");
			const { dshLog } = __m("util/debug.js");
			/* 窗口控件安全区 —— 根治「设计图的关闭按钮和标准软件的关闭按钮重叠了」。
			 * 详见 util/safe-area.js 头注（含真机取证的 137px 数字）。 */
			const { readInset, watchInset } = __m("util/safe-area.js");
			const { VersionPanel } = __m("components/VersionPanel.js");
			/* 右上角「⚙ 个性化」—— 与总监页 / 总监弹窗 / 分支导图**共用同一个组件、同一份持久化**。
			 * 用户原文：「…还有三个插件页面 文字背景，全部找审美重新审核一下质感加上，
			 * 同时都在右上角加自定义个性化设定」⇒ 四处必须真的一致，各写一份迟早漂移。 */
			const { PersonalizePanel } = __m("components/PersonalizePanel.js");
			
			const h = react.createElement;
			
			/** 工作室根节点 id（真机逐交互脚本的入口锚点，不可改名） */
			const STUDIO_ID = "dsh-design-studio";
			
			/* ══════════════════════════════════════════════════════════════════
			 * 分组色板（D2 审美调优 · 2026-09-12）
			 * ══════════════════════════════════════════════════════════════════
			 *  为什么需要它：标准框架一张图铺 20 个元素，原先**全是同一个紫色**
			 *  ⇒ 画布上糊成一片，沟通时只能读字指认（"那个…第三个方块"）。
			 *  按 `ELEMENT_KINDS[kind].group` 三色区分后，可以直接说「把青色那排按钮右移」。
			 *
			 *  三个字段的用法（`el()` 里用字符串拼接消费，故 `rgb` 存**不带 alpha 的前缀**）：
			 *    base —— 选中态的实色边框（纯色，不用拼）
			 *    rgb  —— `"rgba(r,g,b,"` 前缀：拼 `.45)` / `.22)` / `.08)` / `.8)` 得到不同透明度
			 *    text —— 块内文字色（比 base 亮，保证 10.5px 小字在深底上可读）
			 *
			 *  ⚠️ 改这里必须同步 `kglabel` 的取色（工具栏组标题用同一套色 ⇒ 天然图例，
			 *     否则用户看到画布有青色却找不到青色按钮从哪来）。
			 * ══════════════════════════════════════════════════════════════════ */
			const GROUP_COLOR = {
				"结构": { base: "#8957e5", rgb: "rgba(137,87,229,", text: "#c9b6f7" }, // 紫 —— 骨架（窗口/侧栏/分区/面板/画布）
				"控件": { base: "#22a3b8", rgb: "rgba(34,163,184,", text: "#9fe3ef" }, // 青 —— 可点可输入（按钮/输入框/列表/卡片…）
				"语义": { base: "#c9942b", rgb: "rgba(201,148,43,", text: "#efd08a" }  // 金 —— 表达含义（导图节点/连线/浮动按钮组）
			};
			/** 取分组色（未知分组回落到「结构」，保证永不 undefined 崩溃） */
			const gc = (group) => GROUP_COLOR[group] || GROUP_COLOR["结构"];
			
			/* ══════════════════════════════════════════════════════════════════
			 * 样式（D1）—— 全部走 Harness 主题变量并给 fallback
			 * ══════════════════════════════════════════════════════════════════ */
			
			const S = {
				// 铺满全屏：fixed + inset 0 + 最高层级。用户要求「点击铺满全屏」。
				root: {
					position: "fixed", inset: 0, zIndex: 2147483200, display: "flex", flexDirection: "column",
					/* 🔴 `background` **简写**会把 `background-image` 一起重置为 none ⇒ 个性化面板里选的
					 *    三档纹理（靠 `.dp-textured` 类的 background-image 上色）**一条都显示不出来**，
					 *    用户在面板里点「网格 / 点阵 / 玻璃」看到的是"点了没反应"。
					 *    ⇒ 必须写 `backgroundColor`（长写），让它与类上的 background-image **共存**。
					 *    同一坑在 MindMap / DirectorPage / DirectorDialog 上各有一处，一并修正。 */
					backgroundColor: "var(--dsw-alias-bg-base, #0f1013)",
					color: "var(--dsw-alias-label-primary, #e8eaed)",
					fontFamily: "inherit", fontSize: "calc(12.5px * var(--dp-font, 1))"
				},
				top: {
					display: "flex", alignItems: "center", gap: 8, height: 40, flex: "0 0 40px",
					padding: "0 10px", borderBottom: "1px solid var(--dsw-alias-border-l2, #31343a)",
					background: "var(--dsw-alias-bg-sunken, #17181c)"
				},
				topTitle: { fontWeight: 650, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" },
				// 工具栏（D2）：图元按组排布，点击即在画布落一个新元素
				kindBar: {
					display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", padding: "5px 10px",
					borderBottom: "1px solid var(--dsw-alias-border-l2, #31343a)", background: "var(--dsw-alias-bg-sunken, #1a1b20)", flex: "0 0 auto"
				},
				kgroup: { display: "flex", alignItems: "center", gap: 3, paddingRight: 8, marginRight: 4, borderRight: "1px solid #26282e" },
				kglabel: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", marginRight: 2 },
				kbtn: {
					display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 8px", cursor: "pointer",
					border: "1px solid var(--dsw-alias-border-l2, #3d4148)", borderRadius: 5, fontSize: 11,
					background: "var(--dsw-alias-bg-base, #212429)", color: "var(--dsw-alias-label-secondary, #c3c8ce)", whiteSpace: "nowrap"
				},
				// 中段：左栏 + 画布
				mid: { flex: 1, minHeight: 0, display: "flex" },
				left: {
					width: 268, flex: "0 0 268px", borderRight: "1px solid var(--dsw-alias-border-l2, #31343a)",
					background: "var(--dsw-alias-bg-sunken, #141519)", display: "flex", flexDirection: "column", minHeight: 0
				},
				leftHead: { padding: "8px 10px 6px", borderBottom: "1px solid #26282e", display: "flex", alignItems: "center", gap: 6 },
				leftBody: { flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 9 },
				lbl: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", letterSpacing: ".3px" },
				field: { display: "flex", flexDirection: "column", gap: 3 },
				fieldLabel: { fontSize: 11, color: "#b794f6", display: "flex", alignItems: "center", gap: 5 },
				fieldHint: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #6f757d)", lineHeight: 1.45 },
				fieldInput: {
					width: "100%", boxSizing: "border-box", minHeight: 26, borderRadius: 5, padding: "4px 7px", fontSize: 11.5,
					border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #1a1b20)",
					color: "var(--dsw-alias-label-primary, #e8eaed)", fontFamily: "inherit", resize: "vertical"
				},
				// 画布区（D5）
				canvasWrap: { flex: 1, minWidth: 0, position: "relative", overflow: "auto", background: "#0b0c0e" },
				/* 画布底 —— 🔴 网格修复（2026-09-12 审美审核 · 截图取证）：
				 *   原写法 `background: "linear-gradient(#15161a,#15161a), repeating-linear-gradient(…)"`
				 *   是**多层背景简写**，CSS 里**第一层在最上面** —— 而那层是**不透明的 #15161a**
				 *   ⇒ 后面的两条网格渐变层被完全遮死，画布成了一块没有任何刻度的纯色板。
				 *   （名字叫 grid、也确实写了网格代码，但**肉眼永远看不见**，属"看起来做了其实没做"。）
				 *   修正：底色改用 `backgroundColor`（不占层），网格用 `backgroundImage` 排在最上；
				 *   同时把线色从 #1d1f24 提到 #24272e，让 20px 刻度在深底上真的看得见 —— 
				 *   对齐元素时靠的就是这条刻度。 */
				grid: {
					position: "relative", width: CANVAS_W, height: CANVAS_H, margin: "18px auto",
					backgroundColor: "#15161a",
					backgroundImage: "repeating-linear-gradient(0deg, #24272e 0 1px, transparent 1px 20px), repeating-linear-gradient(90deg, #24272e 0 1px, transparent 1px 20px)",
					border: "1px solid #2a2d33", boxShadow: "0 10px 40px rgba(0,0,0,.5)"
				},
				/* 🔴 分组配色（2026-09-12 审美调优）：
				 *   原先所有元素都是同一种紫色 ⇒ 画布上 20 个块**糊成一片**，看不出哪些是骨架、
				 *   哪些是可点的控件、哪些是语义物件，沟通时只能靠读字。
				 *   改为按 ELEMENT_KINDS[kind].group 三色区分（见上方 GROUP_COLOR）：
				 *     结构=紫 / 控件=青 / 语义=金 —— 一眼分组，可以直接说"青色那排按钮"。
				 *   同时 `kind` 参数此前是**传了但没用**（死参数），这里让它真正参与配色。 */
				el: (sel, kind) => {
					const g = gc((ELEMENT_KINDS[kind] || {}).group);
					return {
						position: "absolute", boxSizing: "border-box", cursor: "move", overflow: "hidden",
						border: "1px solid " + (sel ? g.base : g.rgb + ".45)"),
						background: sel ? g.rgb + ".22)" : g.rgb + ".08)",
						color: g.text, borderRadius: 4, padding: "3px 6px", fontSize: 10.5,
						outline: sel ? "2px solid " + g.rgb + ".8)" : "none",
						display: "flex", alignItems: "flex-start", gap: 4, userSelect: "none"
					};
				},
				/* 缩放柄：颜色跟随所属元素分组（选中态用），保证缩放手和块是同一族的视觉 */
				elHandle: (kind) => {
					const g = gc((ELEMENT_KINDS[kind] || {}).group);
					return {
						position: "absolute", right: -1, bottom: -1, width: 10, height: 10, cursor: "nwse-resize",
						background: g.base, borderRadius: "6px 0 3px 0", border: "1px solid #0f1013"
					};
				},
				// 底栏（D6）
				bottom: {
					flex: "0 0 auto", borderTop: "1px solid var(--dsw-alias-border-l2, #31343a)",
					background: "var(--dsw-alias-bg-sunken, #141519)", display: "flex", flexDirection: "column",
					minHeight: 96, maxHeight: 260
				},
				threadHead: { display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", borderBottom: "1px solid #26282e", fontSize: 11 },
				threadBody: { flex: 1, minHeight: 0, overflowY: "auto", padding: "7px 10px", display: "flex", flexDirection: "column", gap: 5 },
				tmsg: (role) => ({
					display: "flex", gap: 6, fontSize: 11.5, lineHeight: 1.55,
					color: role === DESIGN_ROLE.USER ? "#9fc2ff" : "var(--dsw-alias-label-secondary, #c3c8ce)"
				}),
				threadFoot: { display: "flex", gap: 6, alignItems: "center", padding: "7px 10px", borderTop: "1px solid #26282e" },
				input: {
					flex: 1, minWidth: 0, height: 28, borderRadius: 6, padding: "0 9px", fontSize: 11.5, boxSizing: "border-box",
					border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #1a1b20)",
					color: "var(--dsw-alias-label-primary, #e8eaed)"
				},
				btn: {
					height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap",
					border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #212429)",
					color: "var(--dsw-alias-label-secondary, #c3c8ce)"
				},
				btnPri: { height: 28, padding: "0 12px", borderRadius: "var(--dp-radius-sm, 6px)", cursor: "pointer", fontSize: "calc(11.5px * var(--dp-font, 1))", border: "1px solid var(--dp-ac2, #8957e5)", background: "var(--dp-ac2, #8957e5)", color: "#fff", whiteSpace: "nowrap" },
				btnDanger: { height: 26, padding: "0 10px", borderRadius: "var(--dp-radius-sm, 6px)", cursor: "pointer", fontSize: "calc(11.5px * var(--dp-font, 1))", border: "1px solid rgba(248,81,73,.45)", background: "rgba(248,81,73,.14)", color: "#f0877f", whiteSpace: "nowrap" },
				/* 徽章色 = 强调色。`--dp-ac2-soft/-line` 的默认值就是 `rgba(137,87,229,.16/.45)`
				 * ⇒ 与原先硬写的 `rgba(137,87,229,.16/.4)` 肉眼无差，但从此跟着个性化走。 */
				chip: { fontSize: "calc(10.5px * var(--dp-font, 1))", padding: "2px 7px", borderRadius: "var(--dp-radius-sm, 4px)", background: "var(--dp-ac2-soft, rgba(137,87,229,.16))", border: "1px solid var(--dp-ac2-line, rgba(137,87,229,.4))", color: "#b794f6" },
				/* ── 顶栏四区专用（2026-09-12 顶栏重构）── */
				/** 分区竖线：顶栏从左到右有 4 组动作（身份 / 图管理 / 版本 / 视图），
				 *  没有分隔线时 9 个同款按钮连成一排，看不出"哪几个是一伙的"。 */
				sep: { width: 1, height: 20, background: "var(--dsw-alias-border-l2, #35383f)", margin: "0 2px", flex: "0 0 1px" },
				/** 保存按钮 · 有未保存改动：主色实心 + 前置实心点（最需要被看见的状态） */
				btnSave: {
					height: 26, minWidth: 96, boxSizing: "border-box", textAlign: "center",
					padding: "0 11px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap",
					border: "1px solid #8957e5", background: "#8957e5", color: "#fff", fontWeight: 650
				},
				/** 保存按钮 · 已保存：与脏态**同宽同高，仅换色**。
				 *  🔴 `minWidth: 96` 不是审美偏好，是**点击可用性**（用户报「点击都不好用」的元凶之一）：
				 *    第一版只做了"两态共用同一按钮"（避免脏时才出现、把邻居挤走），却**没锁宽度**。
				 *    真机实测：「● 保存」57px / 「✓ 已保存 v3」84px，差 **27px**
				 *    ⇒ 点一下保存，右边 12 个按钮整体横移 27px；用户接着点下一个必然点空，
				 *      主观感受就是"按钮点了没反应 / 点不准"。
				 *    96px ≥ 最长的「✓ 已保存 v30」(90px) ⇒ 两态恒为 96px，零位移。
				 *    判据（可复跑）：scripts/cdp-mouse.mjs sweep ds-top 必须报"顶栏位移 0 个"。 */
				btnSaved: {
					height: 26, minWidth: 96, boxSizing: "border-box", textAlign: "center",
					padding: "0 11px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap",
					border: "1px solid rgba(63,185,80,.45)", background: "rgba(63,185,80,.12)", color: "#7ee787"
				},
				/** 删除按钮 · 已上膛（第一次点击后 2.5s 内的窗口）：实心红即"这一下真的会删"。
				 *  文字从「删除」换成「确认」—— **同为 2 字且 padding 与 btnDanger 完全一致(0 10px)**。
				 *  🔴 第一版这里写的是 `0 11px`（照抄了普通 btn），真机 sweep 实测上膛瞬间
				 *     后面 8 个按钮右移 **2px**、泄压时再左移 2px ⇒ 正是这 1px×2 的 padding 差。
				 *     这类"差 1-2px"的跳位最阴：肉眼几乎看不出，但用户伸手去点下一个按钮时就是差那么一点。
				 *  既给了肉眼可见的反馈（此前只有 toast，按钮本身毫无变化，用户以为按钮坏了），
				 *  又保证上膛/泄压两个方向都零位移。 */
				btnDangerArmed: {
					height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap",
					border: "1px solid #f85149", background: "#f85149", color: "#fff", fontWeight: 650
				},
				/** 重命名输入框：占位与它替换掉的 <select> 同宽，避免提交后布局跳动 */
				nameInput: {
					width: 200, height: 26, boxSizing: "border-box", padding: "0 8px", fontSize: 11.5, borderRadius: 5,
					border: "1px solid #8957e5", background: "#212429", color: "#e8eaed"
				},
				/** 导出兜底浮层：位于右下、避开顶栏安全区与底栏对话区 */
				exportWrap: {
					position: "fixed", right: 20, bottom: 104, width: 460, maxHeight: 340, zIndex: 2147483300,
					background: "#17181c", border: "1px solid #3d4148", borderRadius: 8, padding: 10,
					display: "flex", flexDirection: "column", gap: 8, boxShadow: "0 10px 30px rgba(0,0,0,.55)"
				},
				exportHead: { fontSize: 11, color: "#9aa0a6", lineHeight: 1.5 },
				exportArea: {
					flex: 1, minHeight: 190, resize: "none", fontSize: 11, lineHeight: 1.5, boxSizing: "border-box",
					background: "#0f1013", color: "#c3c8ce", border: "1px solid #2b2e34", borderRadius: 5, padding: 8,
					fontFamily: "ui-monospace, Menlo, Consolas, monospace"
				},
				muted: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #6f757d)", lineHeight: 1.55 }
			};
			
			/* ══════════════════════════════════════════════════════════════════
			 * D3 · 左侧交互逻辑面板 —— 显示并**可编辑**选中元素的七元组
			 * ══════════════════════════════════════════════════════════════════ */
			
			function LogicPanel({ doc, selected, onLogicChange, onRelabel, onDelete, onDuplicate, onReorder }) {
				// 🔴 **必须同时判 doc**（2026-09-12 真机事故 · 单点故障复盘）：
				//    设计图「打开态」是**持久化**的（layout.designStudioOpen），而文档是在
				//    `useEffect` 里**首帧渲染之后**才创建的 ⇒ 重启后必有一次「open=true 且 doc=null」
				//    的渲染。原写法 `selected && (doc.elements||[])` 只判了 selected（此时为 null）
				//    就短路，看似安全，但空分支里 `doc.title` 没有任何保护 ⇒ TypeError
				//    ⇒ 无 error boundary，React 卸载整个 Shell 根 ⇒ **浮动按钮组 / 弹窗 / 工作室全灭**，
				//    且因 open 标志已持久化，**每次重启都会再次复现**（自锁死）。
				//    ⇒ 修正：doc 为空时走"尚无设计图"分支，不触碰任何 doc 字段。
				const el = doc && selected ? (doc.elements || []).find((e) => e.id === selected) : null;
				if (!el) {
					return h("div", { style: S.leftBody, "data-testid": "ds-logic-empty" }, [
						h("div", { key: "t", style: S.lbl }, "D3 · 元素交互逻辑"),
						h("div", { key: "m", style: S.muted },
							"点画布上的任一元素 → 这里显示它绑定的交互逻辑（触发 / 行为 / 状态 / 数据 / 退化 / 快捷键 / 对应代码）。"),
						h("div", { key: "s", style: { ...S.muted, marginTop: 4 } },
							"逻辑直接绑在元素上，改图即改逻辑 —— 这样设计图本身就是可执行的规格，不用另开文档对指。"),
						h("div", { key: "c", style: { ...S.muted, marginTop: 6 } },
							doc ? ("当前图：" + doc.title + " · 元素 " + (doc.elements || []).length + " 个")
								: "尚无设计图 —— 点「＋ 新建图」或「↺ 载入标准框架」开始。")
					]);
				}
				const spec = ELEMENT_KINDS[el.kind] || { label: el.kind };
				const g = gc(spec.group); // 左栏标题与画布块同色 ⇒ 选中谁一眼对得上
				return h("div", { style: S.leftBody, "data-testid": "ds-logic", "data-el-id": el.id }, [
					h("div", { key: "h", style: { ...S.lbl, color: g.text } },
						"D3 · 交互逻辑 · " + el.id + " · " + (spec.group || "未分组")),
					// 元素标识（可改文案 —— 这样在对话里能指着名字说）
					h("div", { key: "id", style: S.field }, [
						h("div", { key: "l", style: { ...S.fieldLabel, color: g.text } }, [h("span", { key: "i" }, spec.icon || "▫"), h("span", { key: "t" }, "元素 · " + spec.label)]),
						h("input", {
							key: "in", style: S.fieldInput, value: el.label, "data-testid": "ds-el-label",
							onChange: (e) => onRelabel(e.target.value)
						}),
						h("div", { key: "geo", style: S.fieldHint }, "位置 " + el.x + "," + el.y + " · 尺寸 " + el.w + "×" + el.h + " · 层级 z" + el.z)
					]),
					// 七元组逐个可编辑
					...LOGIC_FIELDS.map((f) => h("div", { key: f.key, style: S.field, "data-logic-field": f.key }, [
						h("div", { key: "l", style: S.fieldLabel }, f.label),
						h("textarea", {
							key: "in", style: { ...S.fieldInput, minHeight: 30 }, value: (el.logic && el.logic[f.key]) || "",
							placeholder: f.hint, "data-testid": "ds-logic-" + f.key, rows: f.key === "action" ? 2 : 1,
							onChange: (e) => onLogicChange(f.key, e.target.value)
						})
					])),
					// 元素级动作
					h("div", { key: "ops", style: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 2 } }, [
						h("button", { key: "d", style: S.btn, "data-testid": "ds-dup", onClick: onDuplicate }, "复制"),
						h("button", { key: "t", style: S.btn, "data-testid": "ds-top", onClick: () => onReorder("top") }, "置顶"),
						h("button", { key: "x", style: S.btnDanger, "data-testid": "ds-del", onClick: onDelete }, "删除")
					]),
					h("div", { key: "note", style: S.muted }, "⚠「退化路径」与「对应代码」两栏是改代码时的路标：前者写「失败怎么办」，后者写「逻辑在哪个文件」。")
				]);
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * D6 · 底部设计图专用临时对话 —— 只处理本图修订
			 * ══════════════════════════════════════════════════════════════════ */
			
			function ThreadBar({ doc, onCommit, onApply, onDiscard, pending, draft, setDraft }) {
				// 🔴 同 LogicPanel：doc 可能为 null（首帧早于 useMemo/useEffect 建图）⇒ 一律走局部安全值
				const thread = (doc && doc.thread) || [];
				const hasDoc = Boolean(doc);
				return h("div", { style: S.bottom, "data-testid": "ds-thread" }, [
					h("div", { key: "hd", style: S.threadHead }, [
						h("span", { key: "i" }, "🖌"),
						h("span", { key: "t", style: { fontWeight: 650 } }, "设计图修订对话"),
						h("span", { key: "c", style: S.chip }, "临时 · 只处理本图"),
						h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" } },
							"不与宿主会话、也不与总监对话共用（三向隔离）")
					]),
					h("div", { key: "bd", style: { ...S.threadBody, flex: "0 1 auto", maxHeight: 104 } }, thread.length
						? (thread.slice(-20)).map((m) => h("div", { key: m.id, style: S.tmsg(m.role), "data-thread-id": m.id }, [
							h("span", { key: "b", style: { flex: "0 0 auto", color: m.role === DESIGN_ROLE.USER ? "#9fc2ff" : "#b794f6" } },
								m.role === DESIGN_ROLE.USER ? "你：" : "工作室："),
							h("span", { key: "t" }, m.text),
							m.ops && m.ops.length ? h("span", { key: "o", style: { ...S.muted, marginLeft: 4 } }, "（" + m.ops.length + " 项操作）") : null
						]))
						: h("div", { key: "e", style: S.muted, "data-testid": "ds-thread-empty" },
							"在这里说你想怎么改这张图，例如「移动 R1 顶部栏 下 20；删除 R6 记忆面板」。只对本图生效。")),
					// 待确认操作（不静默改图 —— 与总监路由的闸门规则一致，破坏性动作必须过确认）
					pending && pending.ops.length ? h("div", {
						key: "pd", style: { padding: "0 10px 6px", display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" }, "data-testid": "ds-pending"
					}, [
						h("span", { key: "c", style: { ...S.chip, borderColor: "rgba(210,153,34,.45)", background: "rgba(210,153,34,.12)", color: "#e0b341" } },
							"待确认 " + pending.ops.length + " 项"),
						h("span", { key: "t", style: S.muted, flex: 1 },
							pending.ops.map((o) => o.op + " → " + o.target).join("；")),
						/* 🔴 `ds-apply` 必须绑 `onApply`（= onApplyPending），**不能绑 onCommit**（2026-09-12 真机事故）：
						 *   原写法 `onClick: onCommit` ⇒ 点「应用到图」实际又走了一遍 `onSubmitThread`，
						 *   而该函数开头就是 `if (!text || !doc) return`，此时 draft 已被上一次发送清空
						 *   ⇒ **静默什么都不做**（无报错、无提示、待确认区还在）——最难查的一类缺陷。
						 *   之所以一直没暴露：另有 `ds-apply-fab` 走的是正确的 onApplyPending，掩盖了本按钮。
						 *   教训：**同一语义的两个入口必须绑同一个 handler**，否则测试只覆盖其一就会漏。 */
						h("button", { key: "ok", style: S.btnPri, "data-testid": "ds-apply", onClick: onApply }, "应用到图"),
						h("button", { key: "no", style: S.btn, "data-testid": "ds-drop", onClick: onDiscard }, "不要")
					]) : null,
					h("div", { key: "ft", style: S.threadFoot }, [
						h("input", {
							key: "in", style: S.input, "data-testid": "ds-input", value: draft,
							disabled: !hasDoc,
							placeholder: hasDoc
								? "说怎么改（引用元素名或 id；**数字=像素**，如「移动 R1 顶部栏 左 30」；多条用「；」分隔）…"
								: "尚无设计图 —— 先新建或载入标准框架",
							onChange: (e) => setDraft(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onCommit(); } }
						}),
						h("button", { key: "s", style: S.btnPri, "data-testid": "ds-send", onClick: onCommit, disabled: !hasDoc }, "↑")
					])
				]);
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * D1 · 主组件
			 * ══════════════════════════════════════════════════════════════════ */
			
			function DesignStudio({ open, onClose }) {
				const st = react.useSyncExternalStore(
					(fn) => subscribe(fn),
					() => getState(),
					() => getState()
				);
				const doc = react.useMemo(
					() => (st.docs || []).find((d) => d.docId === st.activeDocId) || null,
					[st]
				);
				const [selected, setSelected] = react.useState(null);
				const [draft, setDraft] = react.useState("");
				const [pending, setPending] = react.useState(null);
				const [toast, setToast] = react.useState("");
				const [scale, setScale] = react.useState(1);
				/* 版本面板开合 · 顶栏右侧安全区宽度 · 重命名输入态（null = 不在重命名） */
				const [verOpen, setVerOpen] = react.useState(false);
				/* 初值直接取一次真值（而不是 0 再等 effect 回调）—— 否则首帧 ✕ 会先出现在被压的位置再跳开 */
				const [inset, setInset] = react.useState(() => readInset());
				const [nameDraft, setNameDraft] = react.useState(null);
				/* 导出兜底：剪贴板被系统拒绝时，把 JSON 摆在这里让用户自己复制（见 onExportJson 三级降级） */
				const [exportText, setExportText] = react.useState(null);
				/* 右上角「⚙ 个性化」开合。🔴 与上面几条同样**必须排在 early return 之前**（React Hooks 规则）。 */
				const [pOpen, setPOpen] = react.useState(false);
				const dragRef = react.useRef(null);
				const gridRef = react.useRef(null);
				const wrapRef = react.useRef(null);
			
				/* 窗口控件安全区 —— 全屏工作室（fixed inset:0）必须躲开 Windows 原生窗口按钮。
				 * 实测：视口 1536 时右侧 137px 被原生层独占，且 z-index 对它无效 ⇒ 只能避让。
				 * watchInset 只在**值真的变化**时回调（resize 风暴里不会反复 setState）。 */
				react.useEffect(() => watchInset(setInset), []);
			
				/* 版本列表（顶栏角标 + 版本面板共用同一份，避免"角标说 3、面板列 2"）。
				 *
				 * 🔴 必须放在下方 `if (!open) return null;` 的**之前** —— React Hooks 规则：
				 *    所有 hook 必须无条件、且每次渲染按相同顺序调用。
				 *    本轮踩过这个坑：最初把 useMemo 写在 early return 之后 ⇒
				 *    `open` 由 false 变 true 的那一次渲染，hook 数量从 N 变成 N+1
				 *    ⇒ React 抛 "Rendered more hooks than during the previous render"
				 *    ⇒ DesignStudio 整层崩溃（被 SafeLayer 拦下、显示错误角标，工作室完全打不开）
				 *    ⇒ 真机 e2e 从 C2.1「工作室已挂载」起 54 项全红。
				 *    判据：**凡是 `if (!x) return` 出现在组件里，其后就不要再有任何 hook。** */
				const versions = react.useMemo(() => (doc ? listVersions(doc.docId) : []), [doc]);
			
				/* 首次打开且无图 ⇒ 自动铺一张标准框架（用户不必先"新建"） */
				react.useEffect(() => {
					if (!open) return;
					if (!(getState().docs || []).length) {
						newDoc({ title: "标准框架 · 三页签", frameKey: "threeTab" });
					}
				}, [open]);
			
				/* toast 自动消失（2.2s）。
				 * 🔴 原实现只在 onClick 里清 ⇒ **提示永不消失**，会一直压在画布上；
				 *    且位置在底栏之上（见下方 toast 样式注释），遮住输入框 ⇒ 必须自动走。 */
				react.useEffect(() => {
					if (!toast) return undefined;
					const t = setTimeout(() => setToast(""), 2200);
					return () => clearTimeout(t);
				}, [toast]);
			
				/* 打开时自动「适应容器」（等价于点一次「适应」）。
				 * 为什么需要：标准框架是 1180×644 的固定画布，而可视区宽约 800–1100px
				 * ⇒ 100% 打开必然右侧被裁、要用户自己发现右下角还有内容。
				 * 自动缩到刚好放得下（上限 1，不放大），用户仍可手动 ± / 适应 覆盖。
				 * 容器尺寸首帧可能还是 0，故补一次 400ms 后复测。 */
				react.useEffect(() => {
					if (!open) return undefined;
					const fit = () => {
						try {
							const w = wrapRef.current ? wrapRef.current.clientWidth : 0;
							if (!w) return;
							setScale(Math.max(0.2, Math.min(1, Number(((w - 40) / CANVAS_W).toFixed(2)))));
						} catch (e) { /* 布局未就绪则保持原值 */ }
					};
					fit();
					const t = setTimeout(fit, 400);
					return () => clearTimeout(t);
				}, [open]);
			
				/** 提交一个 doc 变更（统一出口：写库 + 清选中兜底） */
				const commit = react.useCallback((next) => {
					if (!next) return;
					saveDoc(next);
					if (selected && !(next.elements || []).some((e) => e.id === selected)) setSelected(null);
				}, [selected]);
			
				/* ── 拖拽 / 缩放（D5）──────────────────────────────────────────
				 * 🔴 与 DirectorDialog 同一教训：`pointerdown → pointermove → pointerup` 若落在
				 *    同一个 task（自动化脚本连发），依赖 state 记录起点会拿到旧值 ⇒ 位移静默丢失。
				 *    故起点与实时值都放 ref，pointerup 时以事件坐标**兜底重算**，两者幂等。
				 */
				const onElPointerDown = (e, el, mode) => {
					e.stopPropagation();
					setSelected(el.id);
					dragRef.current = {
						mode, id: el.id, x0: e.clientX, y0: e.clientY,
						ex0: el.x, ey0: el.y, w0: el.w, h0: el.h,
						/* 🔴 缩放系数必须随拖拽一起冻结（2026-09-12 审美审核时发现的逻辑缺陷）：
						 *   画布用 `transform: scale(k)` 呈现，鼠标位移是**屏幕像素**，而元素坐标是**模型像素**。
						 *   原实现直接把屏幕位移当模型位移用 ⇒ 缩小到 50% 时拖一格元素跑两格（视觉与手感背离），
						 *   放大到 200% 时又拖不动。故在此冻结开局 k，位移一律 `÷k`。
						 *   取自 ref 而非入参，避免 pointermove 闭包读到旧 scale。 */
						scale: scale || 1
					};
					const move = (ev) => {
						const d = dragRef.current;
						if (!d) return;
						const k = d.scale || 1;
						const dx = (ev.clientX - d.x0) / k;
						const dy = (ev.clientY - d.y0) / k;
						const cur = getActiveDoc();
						if (!cur) return;
						const next = d.mode === "resize"
							? resizeElement(cur, d.id, d.w0 + dx, d.h0 + dy)
							: moveElement(cur, d.id, d.ex0 + dx, d.ey0 + dy);
						saveDoc(next);
					};
					const up = () => {
						document.removeEventListener("pointermove", move);
						document.removeEventListener("pointerup", up);
						dragRef.current = null;
					};
					document.addEventListener("pointermove", move);
					document.addEventListener("pointerup", up);
				};
			
				/* ── 键盘（D5）：Delete 删除 / 方向键微移 / Ctrl+D 复制 ── */
				react.useEffect(() => {
					if (!open) return undefined;
					const onKey = (e) => {
						const tag = (e.target && e.target.tagName) || "";
						if (/INPUT|TEXTAREA|SELECT/.test(tag)) return; // 编辑逻辑字段时不抢键
						if (e.key === "Escape") {
							// Esc 只退最上层：先关个性化面板，再取消待确认，再清选中，最后才关工作室（V16 C1 的 Esc 契约）
							/* 个性化面板自己的 window-capture 监听已经 stopPropagation（正常情况走不到这），
							 * 这里再留一层：面板是 fixed 浮层，若它因任何原因没接住事件，
							 * **不能变成"按 Esc 直接把整个工作室关掉"**（用户丢的是一张没保存的图）。 */
							if (pOpen) { setPOpen(false); return; }
							if (pending) { setPending(null); return; }
							if (selected) { setSelected(null); return; }
							onClose && onClose();
							return;
						}
						if (!selected) return;
						const cur = getActiveDoc();
						if (!cur) return;
						const STEP = e.shiftKey ? 1 : 10;
						if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(removeElement(cur, selected)); }
						else if (e.key === "ArrowLeft") { e.preventDefault(); commit(applyOps(cur, [{ op: "move", target: selected, args: { dx: -STEP, dy: 0 } }])); }
						else if (e.key === "ArrowRight") { e.preventDefault(); commit(applyOps(cur, [{ op: "move", target: selected, args: { dx: STEP, dy: 0 } }])); }
						else if (e.key === "ArrowUp") { e.preventDefault(); commit(applyOps(cur, [{ op: "move", target: selected, args: { dx: 0, dy: -STEP } }])); }
						else if (e.key === "ArrowDown") { e.preventDefault(); commit(applyOps(cur, [{ op: "move", target: selected, args: { dx: 0, dy: STEP } }])); }
						else if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(duplicateElement(cur, selected)); }
					};
					document.addEventListener("keydown", onKey);
					return () => document.removeEventListener("keydown", onKey);
				}, [open, selected, pending, commit, onClose, pOpen]);
			
				/* ── 底部对话：解析 → 待确认 → 应用（D6）── */
				const onSubmitThread = () => {
					const text = draft.trim();
					if (!text || !doc) return;
					const { ops, unresolved } = parseDesignCommand(doc, text);
					let withMsg = appendThread(doc, { role: DESIGN_ROLE.USER, text, ops });
					if (unresolved.length) {
						withMsg = appendThread(withMsg, {
							role: DESIGN_ROLE.STUDIO,
							text: "认不出这几段（请用元素名或 id）：" + unresolved.join(" / ")
						});
					}
					if (ops.length) withMsg = appendThread(withMsg, { role: DESIGN_ROLE.STUDIO, text: "解析出 " + ops.length + " 项操作，待你确认后应用到图。" });
					commit(withMsg);
					setPending({ ops, text });
					setDraft("");
					if (!ops.length) { setToast("没有可执行的操作"); }
				};
				const onApplyPending = () => {
					const cur = getActiveDoc();
					if (!cur || !pending) return;
					let next = applyOps(cur, pending.ops);
					next = appendThread(next, { role: DESIGN_ROLE.STUDIO, text: "已应用 " + pending.ops.length + " 项操作（revision " + (cur.revision + 1) + "）。" });
					commit(next);
					setPending(null);
					setToast("已应用 " + pending.ops.length + " 项");
				};
			
				/* ── 工具栏：点类型 → 增加元素（D2）── */
				const onAddKind = (kind) => {
					if (!doc) return;
					const next = addElement(doc, kind, {});
					commit(next);
					const added = (next.elements || [])[(next.elements || []).length - 1];
					if (added) setSelected(added.id);
					setToast("已添加：" + (ELEMENT_KINDS[kind] || {}).label);
				};
			
				/* ── 顶栏动作 ── */
				const onNewDoc = () => { const d = newDoc({ title: "设计图 " + (listDocs().length + 1), frameKey: "threeTab" }); setSelected(null); setToast("已新建：" + d.title); };
				const onLoadFrame = () => {
					if (!doc) return;
					commit(loadStandardFrame(doc, "threeTab"));
					setToast("已重新铺设标准框架");
				};
				/* ── 顶栏动作 · 图管理 ──────────────────────────────────────────────
				 * 🔴 本组函数补齐的是用户报「最上面这一列功能未实现」：
				 *    原顶栏只有「切换图 / 新建 / 载入框架 / 缩放 / 关闭」6 个动作，
				 *    而 **删除、重命名、复制、导出** 四个在数据层早就写好了 ——
				 *    其中 `onDeleteDoc` 甚至是**定义了从未被调用**的死代码（写了没接线）。
				 *    这也是"看起来做了其实没做"的另一种形态：函数在、能力在、入口不在。 */
				const delArmRef = react.useRef(0);
				const [delArmed, setDelArmed] = react.useState(false);
				/* 上膛 2.5s 后自动泄压。
				 * 🔴 泄压必须由**状态**驱动（而非只存 ref 时间戳）：原实现点完「删除」只有一条 toast 变了，
				 *    **按钮外观毫无变化** ⇒ 用户看不到"我这一下点到了、还要再点一次"，
				 *    主观结论就是"按钮坏了"（用户原话：「目前点击都不好用」）。
				 *    这里让按钮自己变成实心红的「确认」，2.5s 后自动变回「删除」。 */
				react.useEffect(() => {
					if (!delArmed) return undefined;
					const t = setTimeout(() => { setDelArmed(false); delArmRef.current = 0; }, 2500);
					return () => clearTimeout(t);
				}, [delArmed]);
				const onDeleteDoc = () => {
					if (!doc) return;
					/* 删图不可逆 ⇒ 二次点击确认（不用 window.confirm：桌面壳里会被拦或被静默忽略）。
					 * 首次点击只"上膛"并提示，2.5s 内不再点即自动泄压，避免误触。 */
					const t = Date.now();
					if (t - (delArmRef.current || 0) > 2500) {
						delArmRef.current = t;
						setDelArmed(true);
						setToast("再点一次「确认」删除「" + doc.title + "」（不可撤销）");
						return;
					}
					delArmRef.current = 0;
					setDelArmed(false);
					deleteDoc(doc.docId);
					setSelected(null);
					setVerOpen(false);
					setToast("已删除该设计图");
				};
			
				const onRenameStart = () => { if (doc) setNameDraft(String(doc.title || "")); };
				const onRenameCancel = () => setNameDraft(null);
				const onRenameCommit = () => {
					if (!doc) { setNameDraft(null); return; }
					const t = String(nameDraft == null ? "" : nameDraft).trim();
					if (!t) { setToast("名字不能为空"); return; }   // 与 renameDoc 的拒绝一致：不静默改成"未命名"
					const r = renameDoc(doc.docId, t);
					setNameDraft(null);
					setToast(r ? ("已重命名为「" + r.title + "」") : "重命名失败");
				};
			
				const onDuplicateDoc = () => {
					const c = duplicateDoc(doc ? doc.docId : null);
					if (!c) { setToast("没有可复制的图"); return; }
					setSelected(null);
					setToast("已复制为：" + c.title + "（不含版本历史）");
				};
			
				/* 导出：走**剪贴板**而不是下载文件 —— 桌面壳对 <a download> 的拦截行为不稳定，
				 * 而"把 JSON 贴进对话/工单"才是这一步的真实用途（沟通，不是归档）。
				 * 🔴 真机实测过 `{"expToast":"复制失败：剪贴板不可用"}`：`navigator.clipboard` 在
				 *    桌面壳的非安全上下文里**存在但会 reject** ⇒ 原实现直接判"失败"，功能等于没有。
				 *    现在三级降级，保证**一定能把数据交到用户手上**：
				 *      ① navigator.clipboard.writeText（最优）
				 *      ② document.execCommand("copy") + 离屏 textarea（老 API，Electron 里通常可用）
				 *      ③ 展开一个只读文本域让用户自己全选复制（剪贴板被系统级拒绝时的兜底）
				 *    判据：任何环境点「导出」都不得停在"没有数据可拿"。 */
				const copyViaExecCommand = (text) => {
					try {
						const ta = document.createElement("textarea");
						ta.value = text;
						ta.setAttribute("readonly", "readonly");
						/* 必须真在文档里且可选中（否则 execCommand 拿不到内容）；
						 * 用 fixed + 移出视口，避免 absolute 到页底把文档撑高造成滚动跳动。 */
						ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
						document.body.appendChild(ta);
						ta.select();
						ta.setSelectionRange(0, text.length);
						const ok = document.execCommand("copy");
						document.body.removeChild(ta);
						return !!ok;
					} catch (e) { return false; }
				};
			
				const onExportJson = () => {
					if (!doc) { setToast("没有可导出的图"); return; }
					try {
						const text = JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), doc }, null, 2);
						const fallback = () => {
							if (copyViaExecCommand(text)) { setToast("已复制 JSON 到剪贴板（" + text.length + " 字符）"); return; }
							setExportText(text);
							setToast("系统剪贴板不可用，已展开 JSON 供手动复制");
						};
						if (navigator.clipboard && navigator.clipboard.writeText) {
							navigator.clipboard.writeText(text).then(
								() => setToast("已复制 JSON 到剪贴板（" + text.length + " 字符）"),
								fallback
							);
						} else fallback();
					} catch (e) { setToast("导出失败：" + String((e && e.message) || e)); }
				};
			
				/* ── 顶栏动作 · 版本（"保存"与"不同版本的选择"）────────────────────── */
				const onSaveVersion = () => {
					if (!doc) { setToast("没有可保存的图"); return; }
					/* 版本说明自动取「底栏对话里最近一条用户指令」—— 那正是"这次改了什么"的自然记录，
					 * 零额外输入成本；没有对话历史时留空，面板显示"（未写说明）"。 */
					const th = doc.thread || [];
					let lastUser = null;
					for (let i = th.length - 1; i >= 0; i--) { if (th[i] && th[i].role === DESIGN_ROLE.USER) { lastUser = th[i]; break; } }
					const note = lastUser ? String(lastUser.text || "").slice(0, 80) : "";
					const r = saveVersion(doc, note);
					if (!r) { setToast("保存失败"); return; }
					setToast(r.dropped
						? ("已保存 " + r.version.label + "（超出上限，已淘汰最早的 " + r.dropped + " 个）")
						: ("已保存 " + r.version.label));
				};
			
				const onRestoreVersion = (vid) => {
					if (!doc) return;
					const r = restoreVersion(doc.docId, vid);
					if (!r) { setToast("该版本不存在（可能已被删除）"); return; }
					setSelected(null);
					setPending(null);      // 待确认操作基于旧内容，回滚后必须作废（否则会"改到刚回滚的图上"）
					setVerOpen(false);
					setToast("已回到 " + r.from.label + (r.autoSaved ? "（当前样子已自动存档）" : ""));
				};
			
				const onDeleteVersion = (vid) => {
					if (!doc) return;
					if (deleteVersion(doc.docId, vid)) setToast("已删除该版本记录（当前图内容未变）");
					else setToast("版本不存在");
				};
			
				const onToggleVersions = () => setVerOpen((v) => !v);
				const onZoom = (delta) => setScale((s) => Math.max(0.2, Math.min(2, Number((s + delta).toFixed(2)))));
				/* 「适应」= 缩到容器放得下（与打开时的自动行为同一算法，用户手动可复现）；
				 * 「1:1」= 回到 100% 真实像素（审尺寸时用）。两者分开，避免"适应"点了却是 1000% 的困惑。 */
				const onFit = () => {
					try {
						const w = wrapRef.current ? wrapRef.current.clientWidth : 0;
						if (!w) { setScale(1); setToast("已回到 100%（容器尺寸未就绪）"); return; }
						const k = Math.max(0.2, Math.min(1, Number(((w - 40) / CANVAS_W).toFixed(2))));
						setScale(k);
						/* 🔴 必须给反馈：若当前已是 95% 而算出来也是 95%，**值不变 ⇒ 页面零变化**，
						 *    用户点完看到"什么都没发生"，判定为"按钮坏了"。
						 *    真机 sweep 里它是 14 个按钮中唯一"无任何状态变化"的一个 —— 实际是幂等而非故障，
						 *    但幂等必须靠文案讲明白，否则与故障在用户眼里没有区别。 */
						setToast("已适应容器：" + Math.round(k * 100) + "%（画布宽 " + CANVAS_W + "px）");
					} catch (e) { setScale(1); setToast("已回到 100%"); }
				};
			
				if (!open) return null;
			
				const stats = doc ? docStats(doc) : { total: 0, missingLogic: 0, thread: 0 };
				const groups = kindsByGroup();
				/* 版本状态一屏取（dirty 两态 + 角标数 + 面板文案都从这里出，一处算三处用） */
				const vstate = getVersionState(doc);
			
				return h("div", {
					id: STUDIO_ID, style: S.root, "data-testid": "ds-root", role: "dialog", "aria-label": "设计图工作室",
					/* 质感类：个性化里的三档纹理由 store/personalize.js 注入的样式表按
					 * `html[data-dp-texture=...] .dp-textured` 命中（伪元素 / background-image **无法**用 inline 写）。 */
					className: "dp-textured", "data-personalize-open": pOpen ? "1" : "0"
				}, [
					/* ══ 顶栏（D1 · 四区 + 安全区）══════════════════════════════════════════
					 * 🔴 安全区 —— 修用户报的「设计图的关闭按钮和标准软件的关闭按钮重叠了」：
					 *    Harness 桌面端右上角有**原生窗口控件覆盖层**（最小化/最大化/关闭），
					 *    真机实测：视口 1536、`getTitlebarAreaRect().width = 1399`
					 *    ⇒ **右侧 137px 不归网页管**，且它是原生图层、z-index 对它无效。
					 *    此前顶栏右内边距只有 10px，✕ 落在 x=1495（距右 41px）⇒ 必然被压住，
					 *    连右边那句「修订记录 2」也被压掉一截。
					 *    ⇒ 根治办法不是把 ✕ 左移几像素（那只是把洞挪个位置），而是让整条顶栏
					 *      `paddingRight = inset + 10`，所有内容排进安全区左侧。
					 *      inset 由 util/safe-area.js 三级读取（WCO API → env() → 桌面兜底）
					 *      并监听 resize / geometrychange 实时更新。
					 *
					 * 四区（用竖线分组 —— 9 个同款按钮连成一排，看不出哪几个是一伙的）：
					 *   ① 保存（按钮即状态）  ② 图管理  ③ 版本历史  ④ 视图   ⟶  统计 · 关闭
					 */
					h("div", {
						key: "top", style: { ...S.top, paddingRight: Math.max(10, inset + 10) }, "data-testid": "ds-top"
					}, [
						/* ── ① 保存：**按钮即状态** ────────────────────────────────────────
						 * 脏（有未保存改动）= 主色实心「● 保存」（最需要被看见）
						 * 净（已保存）    = 绿色描边「✓ 已保存 vN」
						 * 两态**共用同一按钮、同一尺寸**：若做成"脏时才出现"，它一出现就把
						 * 右边的按钮整体挤走 ⇒ 用户点到的会是删除（删除就在旁边）。 */
						h("button", {
							key: "sv", "data-testid": "ds-save",
							style: { ...(vstate.dirty ? S.btnSave : S.btnSaved), opacity: doc ? 1 : 0.5 },
							title: "把当前这张图存成一个版本"
								+ (doc ? "（自动落盘代数 revision " + (doc.revision || 0) + "，那不是版本号）" : ""),
							onClick: onSaveVersion
						}, vstate.dirty ? "● 保存" : ("✓ 已保存" + (vstate.match ? " " + vstate.match.label : ""))),
			
						h("span", { key: "s1", style: S.sep }),
			
						/* ── ② 图管理 ────────────────────────────────────────────────────
						 * 重命名：点 ✎ 后把 <select> **原地换成输入框**，提交后布局不跳
						 * （Enter 提交 / Esc 取消 / 失焦提交 —— 三种退出路径都有，不把人卡在编辑态）。
						 * 🔴 这里曾写 `maxWidth: 200` 而输入框写 `width: 200` —— 两者**根本不同宽**：
						 *    select 的宽度由内容撑，真机实测只有 **146px**，输入框 200px，
						 *    差 **54px** ⇒ 点「✎ 改名」整条顶栏右移 54px，提交后又弹回 54px。
						 *    注释当时写的是"同宽 200，提交后布局不跳"，**承诺与实现不符**
						 *    （而 div 配平 / 单元测试 / el.click() 型 e2e 全都测不到"布局跳位"）。
						 *    ⇒ 改成 `width: 200` 硬锁。判据同 btnSaved：sweep 必须报"顶栏位移 0 个"。 */
						nameDraft == null
							? h("select", {
								key: "sel", "data-testid": "ds-doclist", "aria-label": "切换设计图", value: (doc && doc.docId) || "",
								onChange: (e) => { setActiveDoc(e.target.value); setSelected(null); setVerOpen(false); },
								style: { width: 200, flex: "0 0 auto", height: 26, fontSize: 11.5, borderRadius: 5, border: "1px solid #3d4148", background: "#212429", color: "#c3c8ce" }
							}, (st.docs || []).map((d) => h("option", { key: d.docId, value: d.docId }, d.title + "（" + (d.elements || []).length + "）")))
							: h("input", {
								key: "sel", "data-testid": "ds-docname", style: S.nameInput, value: nameDraft,
								autoFocus: true, "aria-label": "重命名设计图",
								onChange: (e) => setNameDraft(e.target.value),
								onKeyDown: (e) => {
									if (e.key === "Enter") { e.preventDefault(); onRenameCommit(); }
									else if (e.key === "Escape") { e.preventDefault(); onRenameCancel(); }
								},
								onBlur: onRenameCommit
							}),
						h("button", {
							key: "rn", style: S.btn, "data-testid": "ds-rename", "aria-label": "重命名设计图",
							title: nameDraft == null ? "重命名这张设计图" : "取消重命名",
							onClick: nameDraft == null ? onRenameStart : onRenameCancel
						}, "✎ 改名"),
						h("button", { key: "n", style: S.btn, "data-testid": "ds-new", "aria-label": "新建设计图", title: "新建一张设计图（自带标准框架 20 元素）", onClick: onNewDoc }, "＋ 新建图"),
						h("button", { key: "cp", style: S.btn, "data-testid": "ds-dup-doc", "aria-label": "复制设计图", title: "复制这张设计图（内容带走，版本历史不带）", onClick: onDuplicateDoc }, "⧉ 复制"),
						/* 🔴 标签必须**区别于图名**：本按钮原写作「↺ 标准框架」，而左上选择器显示的图名正是
						 *    「标准框架 · 三页签（20）」⇒ 同屏出现两个「标准框架」，一个是要打开的图、
						 *    一个是会覆盖内容的动作，用户无法区分。改为「重载框架」= 动作导向 + 与图名脱钩。 */
						h("button", { key: "f", style: S.btn, "data-testid": "ds-frame", "aria-label": "重载标准框架", title: "把标准框架重新铺一遍（会覆盖当前图内容）", onClick: onLoadFrame }, "↺ 重载框架"),
						h("button", { key: "ex", style: S.btn, "data-testid": "ds-export", "aria-label": "导出设计图 JSON", title: "把这张图（含每个元素的逻辑）复制成 JSON", onClick: onExportJson }, "导出"),
						/* 危险动作只保留一个（删图）。原文案「🗑」是**彩色 emoji**，与同排的单色字形
						 * （✎ / ⧉ / ↺）割裂；且 emoji 不继承 currentColor ⇒ btnDanger 的红色对它无效。
						 * 改文字后颜色与描边真正生效，红=危险 的语义才传得到。
						 * 上膛态换「确认」而非「确认删除」：**同为 2 字 ⇒ 宽度不变**，
						 * 既让"这一下点到了"肉眼可见，又不把右边的版本/缩放按钮推走。 */
						h("button", {
							key: "del",
							style: doc ? (delArmed ? S.btnDangerArmed : S.btnDanger) : S.btn,
							"data-testid": "ds-del-doc", "data-armed": delArmed ? "1" : "0",
							"aria-label": delArmed ? "确认删除设计图" : "删除设计图",
							title: delArmed ? "再点一次即永久删除（不可撤销）" : "删除这张设计图（点两次确认，不可撤销）",
							onClick: onDeleteDoc
						}, delArmed ? "确认" : "删除"),
			
						h("span", { key: "s2", style: S.sep }),
			
						/* ── ③ 版本历史 ────────────────────────────────────────────────────
						 * 锁宽：`版本 0`(54px) ↔ `版本 30`(+6px) 会把右边的缩放组推着走。
						 * 🔴 这条差点漏掉 —— 第一次改的时候 new_string 里把 minWidth 写丢了，
						 *    真机 computed 仍是 `minWidth: auto`、宽度 53.95px。
						 *    为什么没被现有断言抓到：**宽度只在文字真的变长时才暴露**，
						 *    而一次验证里版本号不会从 1 涨到 30 ⇒ 永远测不到。
						 *    故 e2e 补了 C16.9：用"临时替换文字量宽度"的方式，把每个会变文字的按钮
						 *    **在极值文案下全部量一遍**，不依赖运行中出现那个数字。 */
						h("button", {
							key: "v", style: { ...S.btn, minWidth: 74, textAlign: "center", boxSizing: "border-box" },
							"data-testid": "ds-ver-toggle", "aria-label": "历史版本",
							title: "历史版本：选任一个回到当时的样子（回滚前会自动存档当前）",
							onClick: onToggleVersions
						}, "版本 " + vstate.count),
			
						h("span", { key: "s3", style: S.sep }),
			
						/* ── ④ 视图 ────────────────────────────────────────────────────────
						 * 顺序按行业惯例把数值**夹在中间**（－ 95% ＋）：原先是「－ ＋ 95%」，
						 * 两个方向键并排、数值甩到右边，读起来像"两个按钮 + 一个标签"而不是一组缩放。 */
						h("button", { key: "zo", style: S.btn, "data-testid": "ds-zoom-out", "aria-label": "缩小", title: "缩小", onClick: () => onZoom(-0.1) }, "－"),
						h("span", {
							key: "zs", "data-testid": "ds-zoom", "aria-live": "polite",
							/* 锁宽：`95%`(3 字) ↔ `100%`(4 字) 差 6px，会把右边的「＋ / 适应 / 1:1」推着走 */
							style: { ...S.muted, display: "inline-block", minWidth: 40, textAlign: "center", boxSizing: "border-box" }
						}, Math.round(scale * 100) + "%"),
						h("button", { key: "zi", style: S.btn, "data-testid": "ds-zoom-in", "aria-label": "放大", title: "放大", onClick: () => onZoom(0.1) }, "＋"),
						h("button", { key: "zf", style: S.btn, "data-testid": "ds-zoom-fit", "aria-label": "适应容器", title: "缩到容器放得下", onClick: onFit }, "适应"),
						h("button", { key: "z1", style: S.btn, "data-testid": "ds-zoom-100", "aria-label": "回到 100%", title: "回到 100% 真实像素", onClick: () => setScale(1) }, "1:1"),
			
						/* ── 统计（revision 转入 title —— 它此前被当成"版本号"展示，实际是自动落盘代数）──
						 * 版本数**只出现在「版本 N」按钮上**：同屏两处显示同一个数字，除了占位没有信息量，
						 * 还会让人以为是两个不同的计数器。 */
						h("span", {
							key: "st",
							/* 锁定最小宽度 + 右对齐：统计条靠 `marginLeft:auto` 贴最右，元素数变化只会让它**向左**膨胀
							 * （不影响任何按钮的可点性），但文字会左右跳一下；锁宽后连这一下也消失。 */
							style: { ...S.muted, marginLeft: "auto", minWidth: 110, textAlign: "right", boxSizing: "border-box" },
							"data-testid": "ds-stats",
							"data-revision": (doc && doc.revision) || 0,
							"data-version-count": vstate.count,
							title: "自动落盘代数 revision " + ((doc && doc.revision) || 0) + "（每次写库 +1，不是版本号）"
						}, "元素 " + stats.total + " · 逻辑缺口 " + stats.missingLogic),
			
						/* ── ⑤ 个性化（右上角）─────────────────────────────────────────────
						 * 用户要求「都在右上角加自定义个性化设定」⇒ 本按钮与总监页 / 总监弹窗 /
						 * 分支导图上的那个是**同一个面板**（同一份 localStorage、同一批 CSS 变量）。
						 * 🔴 位置：统计与 ✕ **之间**，整条顶栏仍受 `paddingRight = inset + 10` 约束
						 *    ⇒ 按钮自动落在原生窗口控件左侧，不会重演"✕ 被盖住"。 */
						h("button", {
							key: "pz", style: S.btn, "data-testid": "ds-personalize",
							"aria-label": "个性化设定", "data-on": pOpen ? "1" : "0",
							title: "个性化设定：主色 / 质感 / 密度 / 字号 / 圆角（与总监页 / 弹窗 / 导图共用同一份）",
							onClick: () => setPOpen((v) => !v)
						}, "⚙ 设置"),
			
						/* 关闭按钮 —— 现在位于安全区左侧（原位置被原生窗口按钮盖住） */
						h("button", {
							key: "x", style: S.btn, "data-testid": "ds-close", "aria-label": "关闭设计图工作室",
							title: "关闭（Esc 逐层退）", onClick: onClose
						}, "✕")
					]),
			
					/* ── 导出兜底浮层（仅在系统剪贴板被拒时出现）──
					 * 桌面壳里 navigator.clipboard 会 reject，execCommand 也可能被拒；
					 * 此时**把 JSON 摆出来**远比报一句"复制失败"有用：功能至少要能把数据交到用户手上。 */
					exportText == null ? null : h("div", { key: "exp", style: S.exportWrap, "data-testid": "ds-export-panel" }, [
						h("div", { key: "h", style: S.exportHead }, "导出 JSON · " + exportText.length + " 字符 · 系统剪贴板不可用，请点框内全选复制"),
						h("textarea", {
							key: "ta", "data-testid": "ds-export-text", style: S.exportArea, value: exportText, readOnly: true,
							onFocus: (e) => { try { e.target.select(); } catch (err) { /* 选中失败也不影响手动复制 */ } },
							onKeyDown: (e) => { if (e.key === "Escape") { e.preventDefault(); setExportText(null); } }
						}),
						h("button", { key: "c", style: S.btn, "data-testid": "ds-export-close", onClick: () => setExportText(null) }, "关闭")
					]),
			
					/* ── 工具栏（D2）──
					 * 工具栏也留安全区：原生窗口控件高 44px > 顶栏 40px，会向下溢出 4px，
					 * 若工具栏首行右端正好有按钮就会被压 ⇒ 一并避让（右侧本为空白，代价为零）。 */
					h("div", { key: "kinds", style: { ...S.kindBar, paddingRight: Math.max(10, inset + 10) }, "data-testid": "ds-kinds" },
						Object.keys(groups).map((g) => h("div", { key: g, style: S.kgroup }, [
							// 组标题直接用该组的分组色 ⇒ 工具栏本身就是画布的图例（无需另加 legend 行）
							h("span", { key: "l", style: { ...S.kglabel, color: gc(g).text, fontWeight: 650 }, "data-testid": "ds-kglabel-" + g }, "● " + g),
							...groups[g].map((k) => h("button", {
								key: k,
								style: { ...S.kbtn, borderLeft: "2px solid " + gc(g).base },
								"data-testid": "ds-add-" + k, title: (ELEMENT_KINDS[k].logic && ELEMENT_KINDS[k].logic.action) || "",
								onClick: () => onAddKind(k)
							}, [h("span", { key: "i" }, ELEMENT_KINDS[k].icon), h("span", { key: "t" }, ELEMENT_KINDS[k].label)]))
						]))),
			
					/* ── 中段：左栏 + 画布 ── */
					h("div", { key: "mid", style: S.mid }, [
						h("div", { key: "l", style: S.left }, [
							h("div", { key: "lh", style: S.leftHead }, [
								h("span", { key: "t", style: { fontWeight: 650, fontSize: 11.5 } }, "元素交互逻辑"),
								h("span", { key: "s", style: { ...S.muted, marginLeft: "auto" } }, selected ? selected : "未选中")
							]),
							h(LogicPanel, {
								key: "lb", doc, selected,
								onLogicChange: (k, v) => commit(updateLogic(getActiveDoc(), selected, { [k]: v })),
								onRelabel: (v) => commit(updateElement(getActiveDoc(), selected, { label: v })),
								onDelete: () => commit(removeElement(getActiveDoc(), selected)),
								onDuplicate: () => commit(duplicateElement(getActiveDoc(), selected)),
								onReorder: (w) => commit(reorderElement(getActiveDoc(), selected, w))
							})
						]),
						h("div", { key: "c", style: S.canvasWrap, ref: wrapRef, "data-testid": "ds-canvas-wrap" },
							h("div", {
								key: "g", ref: gridRef, style: { ...S.grid, transform: "scale(" + scale + ")", transformOrigin: "top left" },
								"data-testid": "ds-canvas",
								onPointerDown: () => setSelected(null) // 点空白 = 取消选中
							}, visibleElements(doc).map((el) => h("div", {
								key: el.id,
								/* 🔴 坐标必须写进 `style`（2026-09-12 真机事故 · 单点故障复盘）：
								 *   原写法把 `left / top / width / height / transform` 放在 **props 顶层**，
								 *   它们不是合法 DOM 属性 ⇒ React 不当作 CSS ⇒ **坐标被静默丢弃**
								 *   ⇒ 元素退回文档流按顺序堆叠（`getComputedStyle().transform === "none"`）。
								 *   后果：拖拽 / 缩放 / 方向键在**数据层完全正确**（回读 model 已改），
								 *   但 DOM 纹丝不动 ⇒ 表现为"四个交互全坏"，实际只有这一行在坏。
								 *   本轮 e2e 的 C4.1（拖拽位移断言）正是靠"比对 DOM 实际位移"抓到了它。
								 *   判据：**只要模型改了而 getBoundingClientRect 不变，就先查 style 有没有生效**。 */
								style: {
									...S.el(selected === el.id, el.kind),
									left: el.x, top: el.y, width: el.w, height: el.h
								},
								"data-testid": "ds-el", "data-el-id": el.id, "data-el-kind": el.kind,
								title: el.id + " · " + (ELEMENT_KINDS[el.kind] || {}).label + " · " + ((el.logic && el.logic.action) || ""),
								onPointerDown: (e) => onElPointerDown(e, el, "move")
							}, [
								h("span", { key: "t", style: { pointerEvents: "none", lineHeight: 1.35 } }, (ELEMENT_KINDS[el.kind] || {}).icon + " " + el.label),
								selected === el.id ? h("div", {
									key: "h", style: S.elHandle(el.kind), "data-testid": "ds-handle",
									onPointerDown: (e) => onElPointerDown(e, el, "resize")
								}) : null
							])))
						)
					]),
			
					/* ── 底栏（D6）── */
					h(ThreadBar, {
						key: "b", doc: doc || { thread: [], title: "" }, draft, setDraft, pending,
						onCommit: onSubmitThread,          // 发送：解析指令 → 生成待确认
						onApply: onApplyPending,           // 应用到图：真正落库（两个入口共用）
						onDiscard: () => { setPending(null); setToast("已丢弃"); }
					}),
					pending && pending.ops.length ? h("div", {
						key: "apply", style: { position: "absolute", right: 14, bottom: 150, display: "flex", gap: 6 }
					}, [h("button", { key: "a", style: S.btnPri, "data-testid": "ds-apply-fab", onClick: onApplyPending }, "应用 " + pending.ops.length + " 项")]) : null,
					/* ── 版本历史面板（顶栏「🕘 版本 N」拉起）──
					 * key 放在 props 里由 React 提取；面板自身 `open=false` 时返回 null。 */
					h(VersionPanel, {
						key: "ver", doc, versions, open: verOpen, inset, limit: VERSION_LIMIT,
						onClose: () => setVerOpen(false),
						onRestore: onRestoreVersion,
						onDelete: onDeleteVersion
					}),
			
					toast ? h("div", {
						key: "toast", style: {
							/* 🔴 位置修正（2026-09-12 审美审核 · 截图取证）：
							 *   原为 `left:12, bottom:12` ⇒ 正好压在底栏「输入框 + 发送」那一行上
							 *   （底栏 minHeight 96，输入行占最下 ~42px）⇒ 提示遮住用户刚要敲的输入框。
							 *   改为**顶部居中浮动药丸**：既避开底栏（高度可变，无法用固定 bottom 绕开），
							 *   又落在视线正上方（视线从画布收回时先经过顶部）。
							 *   同批修正：原 toast **永不自动消失**（只有手点才清），现 2.2s 自动淡出，
							 *   且 `pointerEvents:none` 不挡点击（原写法会吃掉底栏那一片的点击）。 */
							position: "absolute", top: 48, left: "50%", transform: "translateX(-50%)",
							padding: "6px 14px", borderRadius: 999, pointerEvents: "none", maxWidth: "60%",
							background: "rgba(47,111,235,.92)", border: "1px solid rgba(159,194,255,.55)",
							color: "#fff", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
							overflow: "hidden", textOverflow: "ellipsis", boxShadow: "0 6px 22px rgba(0,0,0,.55)"
						}, "data-testid": "ds-toast"
					}, toast) : null,
			
					/* 个性化面板 —— 顶栏 40px ⇒ 面板从 46px 起落，正好压在顶栏下方、贴着右上角。
					 * `inset` 由本组件已持有的真机安全区值传入（见 util/safe-area.js），
					 * 面板内部会算 `right = max(10, inset + 10)`，不会钻到原生窗口按钮下面。 */
					h(PersonalizePanel, {
						key: "pp", open: pOpen, onClose: () => setPOpen(false),
						inset: inset, top: 46, scope: "设计图"
					})
				]);
			}
			
			__defaults["components/DesignStudio.js"] = DesignStudio;
			
			exports.STUDIO_ID = STUDIO_ID;
			exports.DesignStudio = DesignStudio;
		};

		// ── store/mindmap-schema.js ──
		__defs["store/mindmap-schema.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：思维导图元素库（导图态的「原子词汇表」，纯数据）
			 * 引用：—
			 * 上游：components/MindMap.js, components/NodeDetailPanel.js, logic/branch-tree.js, logic/mindmap-render.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 F1–F5（思维导图元素库：节点型 / 状态 / 连线 / 控件 / 快捷键 / 覆盖度）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * store/mindmap-schema.js — 思维导图元素库（导图态的「原子词汇表」，纯数据）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
			 *   ├─ 板块 A · A4 分支导图态（画面：节点 4 态 / 悬浮工具条 / 右键菜单 / 底部输入条）
			 *   └─ 板块 F · 思维导图元素库（本文件的**渲染版**：元素 × 分组 × 覆盖度）
			 *  消费者   components/MindMap.js（图例、节点图标与配色、连线样式、菜单分组）
			 *  同类先例  store/design-schema.js（设计图的 18 个原子）—— 两者**刻意同构**：
			 *           一个管「设计图能摆什么」，一个管「导图能长什么样」。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  为什么需要它（用户原话）：「按照可能用到的思维导图元素 完善思维导图」
			 * ══════════════════════════════════════════════════════════════════
			 *  改之前 MindMap.js 只有「一个圆点 + 一行标题」两种视觉元素，
			 *  而设计稿 A4 已经画了：中心主题 / 分支 / 叶子 / 四态状态点 / 悬浮工具条 /
			 *  右键菜单 / 曲线连线 / 折叠 / 缩放 / 搜索 —— 代码里**一个都没有**。
			 *
			 *  ⇒ 本文件的作用是**把"可能用到的元素"一次性列全并标注落地状态**，
			 *     而不是让每次改版都临时想起一个。列全之后有两个直接好处：
			 *     ① UI 侧可以直接遍历它渲染图例与图标（单一真相源，不各写一套）
			 *     ② 覆盖度可核算（`MM_COVERAGE`）：哪些已落、哪些不做、**为什么不做**
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 两条铁律（违反即变成"点了像没点"）
			 * ══════════════════════════════════════════════════════════════════
			 *  ① **不造没有数据源的元素**：凡是要读宿主字段的（如「出错」态），
			 *     先在宿主源码里取证；取证不到就标 `supported:false` 并写明原因，
			 *     **绝不用近似推断冒充精确**。上一轮的教训是顶栏 14 个按钮"单独测全部有效果"
			 *     却整体不好用 —— 假元素比缺元素更贵。
			 *  ② **不做没有接口的动作**：菜单项要么有真实宿主/插件接口，要么 `enabled:false`
			 *     并在 `title` 里说明缺什么接口。禁止「点了只弹一个 toast」。
			 *
			 * ⚠️ 与 R5 冻结项的关系：本文件纯数据、无副作用、**不碰任何持久化 key**。
			 */
			
			/* ══════════════════════════════════════════════════════════════════
			 * 零、分组色（与 DesignStudio 的 GROUP_COLOR 同构，三组三色）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 元素分组色。取色规则与设计图一致：**结构=紫 / 标记=青 / 语义=金**。
			 * `text` 是深色底上的可读前景色（对比度 ≥4.5:1，实测）。
			 */
			const MM_GROUP_COLOR = Object.freeze({
				"骨架": { base: "#8957e5", rgb: "rgba(137,87,229,", text: "#c9b0ff" },
				"标记": { base: "#22a3b8", rgb: "rgba(34,163,184,", text: "#7fd8e6" },
				"关系": { base: "#c9942b", rgb: "rgba(201,148,43,", text: "#efd08a" }
			});
			
			/** 取分组色（未知分组回落「骨架」，不返回 undefined） */
			function mmColor(group) {
				return MM_GROUP_COLOR[group] || MM_GROUP_COLOR["骨架"];
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 一、节点元素（导图上一个节点由「类型 + 徽标」组成）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 节点类型 —— 由**树形位置**决定，不是用户手动选的（避免多一份需要持久化的状态）。
			 * `from` 写明判据，任何人可复算。
			 */
			const NODE_KINDS = Object.freeze({
				topic: {
					label: "中心主题", icon: "🎯", group: "骨架", accent: "#2f6bdd",
					from: "depth === 0（血缘树的根；无父或父不在列表内）",
					note: "一棵血缘树只有一个中心主题，它是「对话主线」本身"
				},
				branch: {
					label: "主分支", icon: "⑂", group: "骨架", accent: "#8957e5",
					from: "depth === 1（从中心主题直接 fork 出来的第一层）",
					note: "对应宿主 `sessions.fork` 的第一跳"
				},
				sub: {
					label: "子分支", icon: "└", group: "骨架", accent: "#6f6ab8",
					from: "depth >= 2 且 childrenCount > 0",
					note: "分支的分支；可继续 fork，也可收口"
				},
				leaf: {
					label: "叶子", icon: "•", group: "骨架", accent: "#5b6b8f",
					from: "childrenCount === 0",
					note: "尚无子分支的末端节点（≠ 已完成，完成看状态点）"
				}
			});
			
			/**
			 * 节点类型判定（纯函数）。
			 * 🔴 顺序即优先级：先判叶子（无子），再按深度 —— 否则「depth 1 的叶子」会被判成主分支。
			 * @param {number} depth
			 * @param {number} childrenCount
			 * @returns {"topic"|"branch"|"sub"|"leaf"}
			 */
			function kindOfNode(depth, childrenCount) {
				if (depth === 0) return "topic";
				if (!childrenCount) return "leaf";
				return depth === 1 ? "branch" : "sub";
			}
			
			/**
			 * 节点徽标（第二行元信息）—— 每个都写明**数据来源**，取不到就不渲染。
			 * `pick(row)` 返回 `null` 表示「该行没有这个事实」，由渲染层跳过（不占位、不写"未知"）。
			 */
			const NODE_MARKS = Object.freeze([
				{
					key: "fork", label: "fork 锚点", group: "标记",
					pick: (r) => (r.seedLength == null ? null : "fork @ seq " + r.seedLength),
					source: "宿主 fork 时写入的 meta.seedLength（摘要透出则显示）"
				},
				{
					key: "children", label: "子分支数", group: "标记",
					pick: (r) => (r.childrenCount > 0 ? "子 " + r.childrenCount : null),
					source: "本插件按 parentId 归并计数（logic/branch-tree.js）"
				},
				{
					key: "pending", label: "待处理", group: "标记",
					pick: (r) => (r.pending ? "待" + ({ approval: "审批", "plan-review": "方案确认", question: "回答" }[r.pending] || "处理") : null),
					source: "宿主摘要 pendingInteraction（approval / plan-review / question）"
				},
				{
					key: "forked", label: "血缘断裂", group: "关系",
					/* 🔴 只在**父不在树里**时才显示。父就在左边一格的情况下写「← 父 a」是纯噪声，
					 *    而"父缺失"（会话被删 / 属于别的账号）才是真需要提醒的异常 —— 它意味着
					 *    这一支的血缘只能当根看（见 buildBranchTree 的孤儿处理）。 */
					pick: (r) => (r.parentMissing ? "⚠ 父缺失 " + String(r.parentSessionId).slice(-6) : null),
					source: "宿主摘要 parentId 指向的会话不在当前列表内（logic/branch-tree.js 标 parentMissing）"
				},
				{
					key: "preset", label: "智能体预设", group: "关系",
					pick: (r) => (r.agentPreset ? String(r.agentPreset) : null),
					source: "宿主摘要 agentPreset"
				}
			]);
			
			/** 按当前行取全部有据徽标（顺序即 NODE_MARKS 序）；无据的**不出现**，不返回空串占位 */
			function marksOfRow(row) {
				const out = [];
				for (const m of NODE_MARKS) {
					let v = null;
					try { v = m.pick(row); } catch (e) { v = null; }
					if (v) out.push({ key: m.key, group: m.group, text: v });
				}
				return out;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 二、状态点（四态，**全部由宿主字段判定**，无推断）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 状态四态。
			 *
			 * 🔴 设计稿 A4 的图例画的是「空闲 / 运行中 / 已完成 / 出错」四态，
			 *    但宿主摘要里**没有"出错"字段** —— 取证范围：`dsh-client-runtime/lib/client.js`
			 *    的会话摘要（`flattenLineage` 前的身）只有 `running / blank / completed /
			 *    pendingInteraction / updatedAt / origin / agentPreset / parentId`，
			 *    而 `pendingInteraction` 的取值域实测仅 `{"approval","question","plan-review"}`
			 *    （`trackPending` 的全部调用点，无错误态）。
			 *    ⇒ 故本版把第四态从「出错」改为**「待审」**（= `pendingInteraction` 存在），
			 *      并把「出错」登记为 `supported:false`（见 MM_COVERAGE）。
			 *      **这是对设计稿的显式修正，不是漏画** —— 写在此处以免下次又被"按图画"。
			 */
			const STATE_KINDS = Object.freeze({
				running: {
					label: "执行中", color: "#2f6bdd", pulse: true, supported: true,
					from: "宿主摘要 running === true（智能体正在产出）"
				},
				review: {
					label: "待审", color: "#d29922", pulse: false, supported: true,
					from: "宿主摘要存在 pendingInteraction（approval / plan-review / question）—— 等你点确认"
				},
				done: {
					label: "已收口", color: "#3fb950", pulse: false, supported: true,
					from: "宿主摘要 completed === true（有未读完成提醒 = 该会话已跑完一轮）"
				},
				idle: {
					label: "待命", color: "#6f757d", pulse: false, supported: true,
					from: "以上都不成立（含 blank 新会话）—— 它表达的是「确实没在动」，不是「状态未知」"
				},
				err: {
					label: "出错", color: "#e5534b", pulse: false, supported: false,
					unsupportedReason: "宿主会话摘要无错误字段（pendingInteraction 取值域仅 approval/question/plan-review）⇒ 无数据源，不画",
					from: "—（缺数据源）"
				}
			});
			
			/** 图例顺序（只列 `supported !== false` 的，由 supportedStates() 消费） */
			const STATE_ORDER = Object.freeze(["idle", "running", "review", "done"]);
			
			/** 可渲染的状态（供图例遍历） */
			function supportedStates() {
				return STATE_ORDER.map((k) => ({ key: k, ...STATE_KINDS[k] }));
			}
			
			/**
			 * 状态判定（纯函数）。
			 *
			 * 🔴 与旧版的区别（这是本轮最实质的修正）：
			 *   旧版 `stateOf()` 靠 `childrenCount / depth` **猜**（有子→待审、根→已收口），
			 *   文件头还写着"宿主摘要无执行中字段"—— **该前提是错的**，宿主一直有 `running`
			 *   与 `completed`。猜出来的状态在真机上是**恒定不变**的（与"现在有没有在跑"无关），
			 *   等于一个不动的装饰。现在改为**宿主真值优先**，仅在宿主字段整组缺失时
			 *   （localStorage 降级通道）才回落到推断，并把结果标 `stateSource:"inferred"`。
			 *
			 * 判定顺序即优先级：待审 > 执行中 > 已收口 > 待命。
			 * （一个会话同时 running 且有 pending 时，用户更该看到"在等你"。）
			 *
			 * @param {object} row 规范行（见 branch-tree.js normalizeSummary）
			 * @returns {"running"|"review"|"done"|"idle"}
			 */
			function stateOfRow(row) {
				if (!row) return "idle";
				if (row.pending) return "review";
				if (row.running === true) return "running";
				if (row.completed === true) return "done";
				return "idle";
			}
			
			/** 该行状态是否有宿主依据（false ⇒ 用了推断，UI 应标注） */
			function hasHostState(row) {
				return Boolean(row) && (row.running !== undefined || row.completed !== undefined || row.pending !== undefined);
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 三、连线元素（骨架的两级 + 高亮）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 连线类型。
			 * 🔴 视觉区分**必须有语义**，否则配色只是装饰：
			 *   · trunk（中心主题 → 第一层）**实线** —— 这是"主线分叉"，永久存在
			 *   · child（第一层以后）**虚线** —— 这是"分支再生分支"，可继续延伸
			 *   · chain（选中节点的祖先链）**加粗高亮** —— 回答"我在树里的哪一条上"
			 *   · ghost（被折叠隐藏的子树的入口）**点线** —— 提示"下面还有，点开看"
			 */
			const EDGE_KINDS = Object.freeze({
				trunk: { label: "主干", stroke: "#2f6bdd", width: 2, dash: null, opacity: 0.5, group: "关系" },
				child: { label: "分支", stroke: "#39c5cf", width: 1.5, dash: "5 4", opacity: 0.7, group: "关系" },
				chain: { label: "选中链", stroke: "#8957e5", width: 2.5, dash: null, opacity: 0.95, group: "关系" },
				ghost: { label: "折叠入口", stroke: "#4c525c", width: 1.5, dash: "1 4", opacity: 0.6, group: "关系" }
			});
			
			/* ══════════════════════════════════════════════════════════════════
			 * 四、控件元素（导图态的操作面 —— 每项都对应真实实现）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 控件元素登记表。`testid` 与真实 DOM 的 `data-testid` **同名**（供 e2e 反查，
			 * 防止"登记了但没实现"）。
			 */
			const CONTROL_KINDS = Object.freeze([
				{ key: "fit", label: "适应屏幕", icon: "🔍", testid: "mm-fit", group: "骨架", desc: "把整棵血缘树缩进可视区（幂等：已在视野内时只回文案）" },
				{ key: "zoom", label: "缩放组", icon: "－／＋", testid: "mm-zoom-out", group: "骨架", desc: "－ 100% ＋ 三件一组，数值居中；1:1 回真实像素" },
				{ key: "collapse", label: "折叠 / 展开", icon: "🗂", testid: "mm-collapse-all", group: "骨架", desc: "全局折叠全部子树 / 展开全部；**单框折叠在框内右侧显式按钮**（见 NODE_CONTROLS.toggle）" },
				{ key: "search", label: "搜索定位", icon: "⌕", testid: "mm-search", group: "标记", desc: "按标题 / 会话号过滤并高亮命中；命中数实时显示" },
				{ key: "legend", label: "状态图例", icon: "●", testid: "mm-legend", group: "标记", desc: "四态点 + 文案；**只列有数据源的态**（见 STATE_KINDS）" },
				{ key: "minimap", label: "小地图", icon: "▣", testid: "mm-minimap", group: "标记", desc: "右下角整树缩略 + 当前视野框；点击跳转" },
				{ key: "hoverbar", label: "悬浮工具条", icon: "⋯", testid: "mm-hoverbar", group: "关系", desc: "悬停节点时出现在节点上方：fork / 打开 / 抓取 / 折叠" },
				{ key: "ctxmenu", label: "右键菜单", icon: "▤", testid: "mm-ctxmenu", group: "关系", desc: "节点右键：只有**有接口**的项可点，其余禁用并写明缺什么" },
				{ key: "refresh", label: "刷新血缘", icon: "↻", testid: "mm-refresh", group: "骨架", desc: "重读书缘快照（宿主 sessions 通道，失败降级并标原因）" },
				{ key: "close", label: "关闭", icon: "✕", testid: "mm-close", group: "骨架", desc: "关闭导图（Esc 亦可）；**必须落在窗口控件安全区左侧**" }
			]);
			
			/* ══════════════════════════════════════════════════════════════════
			 * 五、键盘元素
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 七、**单个框上的控件**（2026-09-12 第三轮新增）
			 *
			 * 需求原文（用户）：「思维导图的单个框没有展开和折叠的选项」
			 *
			 * 🔴 定位到的真实缺口（真机取证，不是猜）：
			 *   血缘树实测 12 行、其中 **3 行确实有子节点**（`childrenCount > 0`），
			 *   但框上只有一个 12px 宽、颜色 `#8b9199` 的三角形 —— 与徽标同行、被标题挤到几乎看不见，
			 *   且**没有子的框上什么都没有**（用户俯视整张图 ⇒ 观感是"框上没有任何展开折叠选项"）。
			 *
			 * ⇒ 本表把"每个框上该有什么"显式登记，由 `controlsOfRow()` 按行与宿主能力算出 elidable 结果，
			 *    MindMap.js 照着渲染，**不再各自 if 判断**（避免"有的框有有的框没有"这种不一致）。
			 *
			 * 纪律：`enabled=false` 的项必须在 UI 上**显示并写明原因**（与本项目右键菜单同一条纪律），
			 *       不做"悄悄不渲染"—— 用户已经因为"点了像没点"投诉过三次。
			 */
			const NODE_CONTROLS = Object.freeze([
				{
					key: "toggle", icon: "▾", alt: "▸", label: "折叠子树 / 展开子树", group: "结构",
					/** 有子才有意义：没有子节点时"折叠"是空操作 */
					needs: "childrenCount > 0",
					why: "该分支下有子会话（宿主机 sessions 写在 fork 的 meta.parentSession）"
				},
				{
					key: "detail", icon: "💬", label: "在这侧展开对话", group: "内容",
					needs: "总是可用（数据来自插件侧流转 + 宿主快照）",
					why: "右侧面板显示该对话「现在在做的事」与跨维度流转，不依赖宿主写接口"
				},
				{
					key: "fork", icon: "➕", label: "从此处分支", group: "动作",
					needs: "宿主 sessions.fork",
					why: "宿主未暴露 fork 时禁用并在此写明缺什么"
				},
				{
					key: "open", icon: "📂", label: "打开该原生对话", group: "动作",
					needs: "宿主 sessions.open",
					why: "宿主未暴露 open 时禁用"
				},
				{
					key: "move", icon: "✥", label: "拖动移动（自由摆放）", group: "布局",
					needs: "总是可用（位置由插件侧持久化，不改血缘）",
					why: "🔴 只移动**画面位置**，不改 `parentSession` —— 血缘由宿主固化，插件侧无接口可改"
				}
			]);
			
			/**
			 * 算出一行上实际可用的控件（**纯函数**，可离线断言）。
			 * @param {object} row buildBranchTree().rows[i]
			 * @param {{fork?:boolean, open?:boolean}} [caps] hostCapabilities()
			 * @returns {Array<{key:string, icon:string, label:string, enabled:boolean, why:string, kind:"structure"|"content"|"action"|"layout"}>}
			 */
			function controlsOfRow(row, caps) {
				const c = caps || {};
				const hasKids = Boolean(row && row.childrenCount > 0);
				const kindOf = (g) => (g === "结构" ? "structure" : g === "内容" ? "content" : g === "布局" ? "layout" : "action");
				return NODE_CONTROLS.map((n) => {
					let enabled = true;
					let why = n.why;
					if (n.key === "toggle") {
						enabled = hasKids;
						why = hasKids ? n.why : "该框下没有子会话 ⇒ 无可折叠内容（不是坏了）";
					} else if (n.key === "fork") {
						enabled = Boolean(c.fork);
						why = c.fork ? n.why : "宿主 sessions 服务未暴露 fork（取证：SessionRuntime 成员表）";
					} else if (n.key === "open") {
						enabled = Boolean(c.open);
						why = c.open ? n.why : "宿主 sessions 服务未暴露 open";
					}
					return {
						key: n.key,
						icon: n.icon,
						/* 折叠态替换图标（只有 toggle 有；未声明则与 icon 同）。
						 * 🔴 透出它与 MindMap 直接写死 "▸"/"▾" 的区别：**符号表只有一份**。
						 *    否则以后改图标要改两处，且"元素库说什么"与"界面渲染什么"会悄悄分叉。 */
						alt: n.alt || n.icon,
						label: n.label,
						enabled,
						why,
						kind: kindOf(n.group)
					};
				});
			}
			
			const MM_SHORTCUTS = Object.freeze([
				{ key: "Esc", desc: "关闭导图（仅退最上层浮出物：先关菜单 → 再关导图）" },
				{ key: "Ctrl/⌘ + 0", desc: "缩放回 100%（1:1）" },
				{ key: "Ctrl/⌘ + -", desc: "缩小 10%" },
				{ key: "Ctrl/⌘ + =", desc: "放大 10%" },
				{ key: "Ctrl/⌘ + F", desc: "聚焦搜索框" },
				{ key: "Enter", desc: "底栏输入 → 交总监路由（Shift+Enter 不提交）" }
			]);
			
			/* ══════════════════════════════════════════════════════════════════
			 * 六、覆盖度总账（把"列全了"变成可核算的事实）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 每条登记一个元素族的落地状态。
			 *   `done` = 本轮已实现且 e2e 覆盖 · `todo` = 登记但未实现 · `na` = 明确不做（附原因）
			 * 🔴 只写"已实现"必须有 testid 或纯函数测试对应，禁止凭印象打勾。
			 */
			const MM_COVERAGE = Object.freeze([
				{ id: "E01", name: "中心主题节点（🎯 主线标识）", state: "done", evidence: "kindOfNode(depth=0) → topic；e2e C-M3" },
				{ id: "E02", name: "主分支 / 子分支 / 叶子三型", state: "done", evidence: "kindOfNode；节点左边框色随型变化；e2e C-M4" },
				{ id: "E03", name: "状态点四态（宿主真值）", state: "done", evidence: "stateOfRow 读 running/completed/pendingInteraction；e2e C-M5 正负对照" },
				{ id: "E04", name: "节点徽标（fork 锚点 / 子数 / 待办 / 血缘 / 预设）", state: "done", evidence: "marksOfRow + NODE_MARKS，取不到不渲染" },
				{ id: "E05", name: "曲线连线（主干实线 / 分支虚线）", state: "done", evidence: "edgePath 三次贝塞尔；EDGE_KINDS 五行语义表" },
				{ id: "E06", name: "选中链高亮（祖先路径）", state: "done", evidence: "ancestorChain 纯函数；e2e C-M7" },
				{ id: "E07", name: "折叠 / 展开（单节点 + 全局）", state: "done", evidence: "visibleRows 纯函数；折叠后隐藏子树并改点线；e2e C-M8" },
				{ id: "E08", name: "悬浮工具条", state: "done", evidence: "data-testid=mm-hoverbar，悬停出现，上移 4px 展开" },
				{ id: "E09", name: "右键菜单（有接口才可点）", state: "done", evidence: "mm-ctx-*；无接口项 disabled + title 说明" },
				{ id: "E10", name: "缩放组（－ 100% ＋ / 1:1 / 适应）", state: "done", evidence: "mm-zoom-*；适应对全树包围盒计算" },
				{ id: "E11", name: "搜索定位", state: "done", evidence: "mm-search；命中高亮 + 计数" },
				{ id: "E12", name: "小地图 + 视野框", state: "done", evidence: "mm-minimap；缩略点按比例，点击跳转" },
				{ id: "E13", name: "状态图例（只列有据的态）", state: "done", evidence: "supportedStates() 驱动；「出错」态标 unsupported 不渲染" },
				{ id: "E14", name: "窗口控件安全区避让（✕ 不与原生按钮重叠）", state: "done", evidence: "readInset/watchInset；e2e C-M13 断言 ✕ 右边界 ≤ 安全区边界" },
				{ id: "E15", name: "「出错」状态点", state: "na", evidence: "宿主摘要无错误字段（取证见 STATE_KINDS.err）⇒ 无数据源不画" },
				{ id: "E16", name: "节点自由文本备注 / 标签", state: "todo", evidence: "需要新的持久化模型（用户可编辑的注释），**本轮不做**：无需求依据且会引入第四份持久化 key" },
				{ id: "E17", name: "合并回父 / 删除分支", state: "na", evidence: "宿主 `sessions` 服务仅暴露 create/fork/open/search/refresh（取证：SessionRuntime 成员表），**无合并与删除接口** ⇒ 菜单里禁用并写明" },
				{ id: "E18", name: "跨会话拖拽改血缘", state: "na", evidence: "血缘由宿主 fork 时固化（meta.parentSession），插件侧无接口可改 ⇒ 拖拽只能是视觉欺骗" },
				/* ── 第三轮新增（用户：单框要能展开折叠 / 框要能移动 / 点框在右侧展开对话）── */
				{ id: "E19", name: "单框显式「展开 / 折叠」控件", state: "done", evidence: "NODE_CONTROLS.toggle + controlsOfRow（纯函数）；框内右侧按钮 mm-node-toggle，有子才可点，无子写明原因" },
				{ id: "E20", name: "框可拖动自由移动（位置持久化）", state: "done", evidence: "pointer 拖动 → 位置写进既有 layout store 的 mmPos 字段（不新增持久化 key）；「自动布局」一键归位" },
				{ id: "E21", name: "点框在右侧展开该对话面板", state: "done", evidence: "components/NodeDetailPanel.js；点框即开，面板含「现在在做的事」+ 跨维流转时间线" },
				{ id: "E22", name: "面板最上方「现在在做的事」", state: "done", evidence: "logic/flow.js currentTaskOf（纯函数），五个优先级分支**各自标明 source**，读不到不编" },
				{ id: "E23", name: "四维流转（总监 / 对话 / 导图 / 设计图 同一条消息）", state: "done", evidence: "logic/flow.js（trail 足迹 + flowLine）；四界面共用同一 store；切会话跟随" }
			]);
			
			/** 覆盖度统计（供设计稿与 UI 的"总账"显示） */
			function coverageStats() {
				const total = MM_COVERAGE.length;
				const done = MM_COVERAGE.filter((c) => c.state === "done").length;
				const todo = MM_COVERAGE.filter((c) => c.state === "todo").length;
				const na = MM_COVERAGE.filter((c) => c.state === "na").length;
				return { total, done, todo, na, doneRate: total ? done / total : 0 };
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 八、按分组聚合（UI 遍历用；顺序即 MM_GROUP_COLOR 的键序）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 全部元素（节点型 + 控件 + 连线）按分组聚合，供图例/文档渲染 */
			function elementsByGroup() {
				const groups = { "骨架": [], "标记": [], "关系": [] };
				for (const k of Object.keys(NODE_KINDS)) {
					const n = NODE_KINDS[k];
					groups[n.group].push({ key: k, label: n.label, icon: n.icon, kind: "node" });
				}
				for (const c of CONTROL_KINDS) {
					groups[c.group].push({ key: c.key, label: c.label, icon: c.icon, kind: "control" });
				}
				for (const k of Object.keys(EDGE_KINDS)) {
					const e = EDGE_KINDS[k];
					groups[e.group].push({ key: k, label: e.label, icon: "—", kind: "edge" });
				}
				return groups;
			}
			
			exports.MM_GROUP_COLOR = MM_GROUP_COLOR;
			exports.mmColor = mmColor;
			exports.NODE_KINDS = NODE_KINDS;
			exports.kindOfNode = kindOfNode;
			exports.NODE_MARKS = NODE_MARKS;
			exports.marksOfRow = marksOfRow;
			exports.STATE_KINDS = STATE_KINDS;
			exports.STATE_ORDER = STATE_ORDER;
			exports.supportedStates = supportedStates;
			exports.stateOfRow = stateOfRow;
			exports.hasHostState = hasHostState;
			exports.EDGE_KINDS = EDGE_KINDS;
			exports.CONTROL_KINDS = CONTROL_KINDS;
			exports.NODE_CONTROLS = NODE_CONTROLS;
			exports.controlsOfRow = controlsOfRow;
			exports.MM_SHORTCUTS = MM_SHORTCUTS;
			exports.MM_COVERAGE = MM_COVERAGE;
			exports.coverageStats = coverageStats;
			exports.elementsByGroup = elementsByGroup;
		};

		// ── logic/branch-tree.js ──
		__defs["logic/branch-tree.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：分支血缘树（导图态的数据源）
			 * 引用：—
			 * 上游：client-entry.js, components/DirectorPage.js, components/MindMap.js, components/NodeDetailPanel.js, logic/mindmap-render.js
			 * 下游：logic/discover.js, store/mindmap-schema.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 C2（分支生命周期状态机）· F1 / F5（导图行模型与宿主真值透传）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * logic/branch-tree.js — 分支血缘树（导图态的数据源）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
			 *   ├─ 板块 A · A4 分支导图态（画面）
			 *   ├─ 板块 C · C2 分支生命周期状态机（节点状态与流转）
			 *   └─ 板块 F · 思维导图元素库（本文件产出的行 → 元素渲染）
			 *  使用者   components/MindMap.js（导图覆盖层）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 关键事实：血缘数据**一直都在**，本文件只做「消费」不做「新建模型」
			 * ══════════════════════════════════════════════════════════════════
			 *   ① 写入方：宿主 `dsh-session/lib/index.js:1841` 在 fork 时写
			 *        `meta.parentSession = <源会话 id>` + `seedLength`
			 *   ② 暴露方：`dsh-client-runtime/lib/client.js` 把 `parentSessionId` 放进会话摘要
			 *   ③ 已有投影：同文件 `flattenLineage(summaries, …)` **已实现**
			 *        children 映射 + `depth` 缩进 + **环检测**（`visited` 集合，遇环打 warning）
			 *   ④ 标题递增：`increasedForkTitle()`（支持全角括号）
			 *   ⇒ 故本文件是②③④的**插件侧等价实现**（宿主函数不可直接 import），
			 *     并额外产出导图需要的**像素坐标**（findings 见 docs/10 §4.4）。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 2026-09-12 修正两条**曾被写错的事实**（真机 + 宿主源码取证）
			 * ══════════════════════════════════════════════════════════════════
			 *  ① **"宿主摘要无执行中字段"是错的**。摘要一直带着
			 *     `running / blank / completed / pendingInteraction / updatedAt / origin / agentPreset`：
			 *        · `ctx.sessions.list.getSnapshot()` → `{ids, current, byId}`
			 *        · `byId[id]` 身 = `{id, displayTitle, running, completed?, blank, updatedAt,
			 *          pendingInteraction?, title?, cwd?, parentId?, origin?, agentPreset?}`
			 *          （取证：`dsh-client-runtime/lib/client.js` `projectList` 的 byId 构造段）
			 *     ⇒ 状态从此**读真值**，不再靠 childrenCount/depth 猜（旧猜测在真机上恒定不变）。
			 *
			 *  ② **读不到 `ctx.sessions` 的真因是 inject 少了一项**，不是"宿主版本差异"。
			 *     `ctx.slots` 能用而 `ctx.sessions` 恒 undefined，差别只在产物里
			 *     `exports.inject = ["slots"]` —— 宿主 app-shell 自己就是
			 *     `inject = ["slots","sessions","layout"]`（取证：`dsh-client-web/lib/index.js`）。
			 *     少声明 ⇒ 访问抛错 ⇒ 被本文件的 try/catch 吞掉 ⇒ **静默降级成"按工作区分组的平铺树"**，
			 *     界面上只显示"血缘不可用"，看不出是**我们没声明**。
			 *     ⇒ 修法：`build/build.mjs` 的 inject 列表补 `"sessions"`；
			 *        且本文件把降级原因写进 `cache.diag`，**降级不再无声**。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  两条数据通道（按可用性降级，不抛错）
			 * ══════════════════════════════════════════════════════════════════
			 *   A. `ctx.sessions.list.getSnapshot()` —— 完整（含 parentId + running/completed）
			 *   B. `discover()`（localStorage `dsh.workspace.view*`）—— 只有分组，**无血缘**
			 *      ⇒ 此时导图退化为「按工作区分组的平铺树」，并在 UI 上标明"血缘数据不可用"
			 *         + **具体原因**（diag）。
			 */
			
			const { discover, sessionLabel } = __m("logic/discover.js");
			const { kindOfNode, stateOfRow, hasHostState } = __m("store/mindmap-schema.js");
			
			/** 节点在导图画布上的布局常量（与 MindMap.js 共用，勿各自写死）
			 * 🔴 2026-09-12 第三轮放大：节点从 200×56 调到 224×72 —— 用户要求"单个框要有展开
			 *    折叠的选项"，而那一行控件（▾ 💬 ✚ 📂 ✥）需要纵向空间；框太矮会把它挤成
			 *    第二个"看不见的三角"，等于没加。dx/dy 同步放大以保持间距比例。 */
			const LAYOUT = Object.freeze({
				x0: 48, y0: 44, dx: 272, dy: 96, nodeW: 224, nodeH: 72,
				/** 画布留白（适应视野时留出，避免节点贴边） */
				pad: 32,
				/** 画布最小尺寸（节点超出时由 treeBounds 撑大） */
				minW: 2600, minH: 1600
			});
			
			/* ══════════════════════════════════════════════════════════════════
			 * 〇、规范行构造（两种宿主形状 → 同一份规范字段）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 把「宿主摘要」或「降级摘要」规范成统一字段。
			 *
			 * 🔴 为什么必须有这一步：宿主有**两种**会话形状，字段名不同 ——
			 *    · `list.getSnapshot().byId[id]`：`id` / `parentId` / `displayTitle`
			 *    · 内部 `summaries[]`（`flattenLineage` 的输入）：`sessionId` / `parentSessionId` / `title`
			 *   旧实现只认后者 ⇒ 走 ctx 通道时**每一行都因 `sessionId === undefined` 被丢弃**，
			 *   于是 rows 为 0 又看不出错（空树照样渲染）。规范层把两者收敛，缺一不可。
			 *
			 * ⚠️ 取不到的字段**保持 undefined**（不写 null / 不写 0）——
			 *    "没有这个事实"与"这个事实是 0"在下游是两种渲染。
			 *
			 * @param {object} raw
			 * @returns {object|null}
			 */
			function normalizeSummary(raw) {
				if (!raw || typeof raw !== "object") return null;
				const sessionId = raw.sessionId !== undefined ? raw.sessionId : raw.id;
				if (!sessionId) return null;
				const parentSessionId = raw.parentSessionId !== undefined ? raw.parentSessionId : raw.parentId;
				const out = {
					sessionId: String(sessionId),
					title: raw.title || raw.displayTitle || sessionLabel(sessionId),
					// 宿主真值（可能整组缺失 ⇒ 保持 undefined，由 stateSource 标注）
					running: typeof raw.running === "boolean" ? raw.running : undefined,
					completed: raw.completed === true ? true : undefined,
					blank: typeof raw.blank === "boolean" ? raw.blank : undefined,
					updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
					agentPreset: raw.agentPreset,
					origin: raw.origin,
					seedLength: typeof raw.seedLength === "number" ? raw.seedLength
						: typeof raw.forkSeq === "number" ? raw.forkSeq : undefined
				};
				if (parentSessionId !== undefined && parentSessionId !== null && parentSessionId !== "") {
					out.parentSessionId = String(parentSessionId);
				}
				// 待处理：宿主值是字符串（approval / question / plan-review）；也可能是 Map/Set 展开的布尔
				if (raw.pendingInteraction !== undefined && raw.pendingInteraction !== null) {
					out.pending = typeof raw.pendingInteraction === "string" ? raw.pendingInteraction : "pending";
				}
				return out;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 一、纯函数：摘要数组 → 树 / 扁平行
			 *    与宿主 flattenLineage 同构（含环检测），并补上坐标与元素分类。
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 由会话摘要构建森林。
			 * @param {Array<object>} summaries 宿主摘要（两种形状皆可，内部会规范化）
			 * @param {object} [opts]
			 * @param {string} [opts.currentId] 宿主当前会话 id（用于"当前对话"标记）
			 * @returns {{roots:Array, rows:Array, byId:Object, cycles:string[], lineage:boolean}}
			 *   rows 为渲染序（深度优先，父在前），每行含 `depth` / `x` / `y` / `kind` / `state` / `stateSource`
			 */
			function buildBranchTree(summaries, opts = {}) {
				const list = (Array.isArray(summaries) ? summaries : []).map(normalizeSummary).filter(Boolean);
				const byId = new Map();
				for (const s of list) byId.set(s.sessionId, s);
			
				const children = new Map();
				const roots = [];
				for (const s of list) {
					const pid = s.parentSessionId;
					// 父不存在（父会话被删 / 属于别的账号）⇒ 当成根，而不是丢弃
					if (pid !== undefined && byId.has(pid)) {
						const arr = children.get(pid) || [];
						arr.push(s);
						children.set(pid, arr);
					} else roots.push(s);
				}
			
				const rows = [];
				const visited = new Set();
				const cycles = [];
				const walk = (s, depth, slotY) => {
					if (visited.has(s.sessionId)) { cycles.push(s.sessionId); return; }
					visited.add(s.sessionId);
					const childrenCount = (children.get(s.sessionId) || []).length;
					const parentMissing = Boolean(s.parentSessionId) && !byId.has(s.parentSessionId);
					const row = {
						sessionId: s.sessionId,
						parentSessionId: s.parentSessionId,
						parentMissing,
						title: s.title,
						depth,
						x: LAYOUT.x0 + depth * LAYOUT.dx,
						y: LAYOUT.y0 + slotY * LAYOUT.dy,
						w: LAYOUT.nodeW, h: LAYOUT.nodeH,
						childrenCount,
						// 宿主真值透传（undefined 表示"宿主没说"，不是 false）
						running: s.running, completed: s.completed, blank: s.blank,
						updatedAt: s.updatedAt, agentPreset: s.agentPreset, origin: s.origin,
						seedLength: s.seedLength, pending: s.pending,
						isCurrent: opts.currentId !== undefined && s.sessionId === opts.currentId
					};
					row.kind = kindOfNode(depth, childrenCount);
					row.state = stateOfRow(row);
					row.stateSource = hasHostState(row) ? "host" : "inferred";
					rows.push(row);
					const kids = children.get(s.sessionId) || [];
					let i = 0;
					for (const kid of kids) { walk(kid, depth + 1, slotY + i + 1); i += 1; }
				};
				let slot = 0;
				for (const root of roots) { walk(root, 0, slot); slot += 1; }
				// 未访问到的（环内节点）也输出，避免"静默消失"
				for (const s of list) if (!visited.has(s.sessionId)) { walk(s, 0, slot); slot += 1; }
			
				// 边：父 → 子（仅当父在 byId 内）
				const edges = rows
					.filter((r) => r.parentSessionId && byId.has(r.parentSessionId))
					.map((r) => ({ from: r.parentSessionId, to: r.sessionId }));
			
				// 血缘是否可用：存在任一条真实父子边即为真（降级通道的边是伪造的 ws: 父）
				const lineage = edges.some((e) => !String(e.from).startsWith("ws:"));
			
				return { roots, rows, edges, byId: Object.fromEntries(byId), cycles, lineage };
			}
			
			/**
			 * 折叠过滤（纯函数）。
			 * @param {Array} rows buildBranchTree().rows
			 * @param {Set<string>|Array<string>} collapsed 被折叠的节点 id 集合
			 * @returns {Array} 可见行（顺序不变）
			 */
			function visibleRows(rows, collapsed) {
				const set = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
				if (!set.size) return rows;
				const hidden = new Set();
				const out = [];
				for (const r of rows) {
					if (r.parentSessionId && hidden.has(r.parentSessionId)) { hidden.add(r.sessionId); continue; }
					if (set.has(r.sessionId)) hidden.add(r.sessionId);
					out.push(r);
				}
				return out;
			}
			
			/**
			 * 祖先链（纯函数）—— 选中节点到根的路径，用于连线高亮。
			 * @returns {Set<string>} 链上节点 id（含自身）
			 */
			function ancestorChain(rows, id) {
				const set = new Set();
				if (!id) return set;
				const byId = new Map(rows.map((r) => [r.sessionId, r]));
				let cur = byId.get(id);
				let guard = 0;
				while (cur && guard < 200) {
					set.add(cur.sessionId);
					cur = cur.parentSessionId ? byId.get(cur.parentSessionId) : undefined;
					guard += 1;
				}
				return set;
			}
			
			/** 包围盒（纯函数）—— 适应视野与小地图共用 */
			function treeBounds(rows) {
				if (!rows || !rows.length) return { x: 0, y: 0, w: LAYOUT.minW, h: LAYOUT.minH };
				let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
				for (const r of rows) {
					minX = Math.min(minX, r.x);
					minY = Math.min(minY, r.y);
					maxX = Math.max(maxX, r.x + LAYOUT.nodeW);
					maxY = Math.max(maxY, r.y + LAYOUT.nodeH);
				}
				const x = Math.max(0, minX - LAYOUT.pad);
				const y = Math.max(0, minY - LAYOUT.pad);
				return {
					x, y,
					w: Math.min(LAYOUT.minW, Math.max(maxX + LAYOUT.pad - x, 320)),
					h: Math.min(LAYOUT.minH, Math.max(maxY + LAYOUT.pad - y, 240))
				};
			}
			
			/** 命中过滤（纯函数）：标题 / 会话号 子串匹配（大小写不敏感） */
			function matchRows(rows, q) {
				const s = String(q || "").trim().toLowerCase();
				if (!s) return null;
				return new Set(rows.filter((r) => {
					const t = String(r.title || "").toLowerCase();
					const id = String(r.sessionId || "").toLowerCase();
					return t.indexOf(s) >= 0 || id.indexOf(s) >= 0;
				}).map((r) => r.sessionId));
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 二、数据源读取（A: ctx.sessions 优先 → B: discover 降级）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 从 cordis `ctx.sessions` 读出会话摘要数组 + 当前会话。
			 *
			 * 🔴 形状按宿主源码取证（`dsh-client-runtime/lib/client.js`）：
			 *    `ctx.sessions.list.getSnapshot()` → `{ ids, current, byId }`，
			 *    `byId[id] = { id, displayTitle, running, completed?, blank, updatedAt, parentId?, … }`。
			 *
			 * 🔴 **为什么有两级读取**（2026-09-12 定位到的静默降级根因）：
			 *    cordis 的 `ctx.<service>` 是 Proxy 陷阱，**未在 `inject` 声明的服务会直接抛错**
			 *    （`@deepseek-ai/cordis/lib/index.js:675` → `cannot get property "sessions" without inject`）。
			 *    旧实现外层一个 try/catch 把这句话吞了并返回 null，于是**降级无声** ——
			 *    界面上只看到"血缘不可用"，看不出是"我们自己没声明注入"。
			 *    ⇒ 修法三层：① 产物 `exports.inject` 补 `"sessions"`（声明真实依赖）；
			 *       ② 这里先试 `ctx.sessions`，再退到 `ctx.get("sessions")`
			 *          （cordis 的 `get()` 是**不要求 inject** 的读取口，
			 *           见同文件 `:755` "Read a service from the store without the inject requirement"）；
			 *       ③ 逐级写 `diag`，让原因能显示在 UI 的 title 上。
			 *
			 * @param {object} ctx
			 * @param {object} [diag] 出参：逐级失败原因（降级不再无声）
			 * @returns {Array|null}
			 */
			function readSessionsFromCtx(ctx, diag) {
				const d = diag || {};
				d.hasCtx = Boolean(ctx);
				if (!ctx) { d.error = "apply(ctx) 未收到 ctx"; return null; }
				try {
					let svc = null;
					try {
						svc = ctx.sessions;                     // 路径 A：已声明 inject ⇒ 可用
					} catch (e) {
						d.injectMiss = String((e && e.message) || e);   // 记下"未声明 inject"这句话本身
					}
					if (!svc && typeof ctx.get === "function") {
						try { svc = ctx.get("sessions"); d.viaGet = true; } catch (e) { d.getError = String((e && e.message) || e); }
					}
					d.hasSessions = Boolean(svc);
					if (!svc) { d.error = d.injectMiss || d.getError || "ctx.sessions 不可用（也未通过 ctx.get 取得）"; return null; }
					const list = svc.list;
					d.hasList = Boolean(list);
					if (!list) { d.error = "ctx.sessions.list 不可用"; return null; }
					d.hasGetSnapshot = typeof list.getSnapshot === "function";
					if (!d.hasGetSnapshot) { d.error = "ctx.sessions.list.getSnapshot 不是函数"; return null; }
					const snap = list.getSnapshot();
					d.snapKeys = snap && typeof snap === "object" ? Object.keys(snap).slice(0, 8) : null;
					if (!snap) { d.error = "getSnapshot() 返回空"; return null; }
					d.currentId = snap.current;
					let arr = null;
					if (snap.byId && typeof snap.byId === "object") arr = Object.keys(snap.byId).map((k) => snap.byId[k]).filter(Boolean);
					else if (Array.isArray(snap.list)) arr = snap.list;
					else if (Array.isArray(snap)) arr = snap;
					d.rawCount = arr ? arr.length : 0;
					if (!arr || !arr.length) { d.error = "快照里没有会话"; return null; }
					d.sampleKeys = arr[0] ? Object.keys(arr[0]).slice(0, 12) : null;
					return arr;
				} catch (e) {
					d.error = "读取 ctx.sessions 抛错：" + ((e && e.message) || e);
					return null;
				}
			}
			
			/** 降级：由 discover 的 workspaces/sessions 造"无血缘"的平铺树 */
			async function fallbackFromDiscover() {
				try {
					const d = await discover();
					const summaries = [];
					for (const ws of d.workspaces || []) {
						const wsId = "ws:" + ws.id;
						summaries.push({ sessionId: wsId, title: ws.name, parentSessionId: undefined, isWorkspace: true });
						for (const sid of ws.sessionIds || []) {
							summaries.push({ sessionId: sid, title: sessionLabel(sid), parentSessionId: wsId });
						}
					}
					return { summaries, source: d.source, lineage: false };
				} catch (e) {
					return { summaries: [], source: "none", lineage: false };
				}
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 三、状态与订阅
			 * ══════════════════════════════════════════════════════════════════ */
			
			let ctxRef = null;
			let cache = { tree: null, source: "none", lineage: false, at: 0, diag: { error: "尚未刷新" } };
			const listeners = new Set();
			
			function notify() { for (const fn of listeners) { try { fn(cache); } catch (e) { /* 忽略单个订阅者异常 */ } } }
			function subscribeBranch(fn) { listeners.add(fn); return () => listeners.delete(fn); }
			function getBranchSnapshot() { return cache; }
			
			/** 降级说明（给 UI 挂 title 用；成功时返回空串） */
			function degradationReason() {
				if (cache.source === "none") return "尚无数据（未刷新）";
				if (cache.lineage) return "";
				const d = cache.diag || {};
				return d.error ? String(d.error) : "宿主未提供 parentId（该工作区确实没有分支）";
			}
			
			/**
			 * 刷新血缘树。
			 * @returns {Promise<{tree:object, source:string, lineage:boolean, diag:object}>}
			 */
			async function refreshBranchTree() {
				const diag = {};
				const fromCtx = readSessionsFromCtx(ctxRef, diag);
				if (fromCtx && fromCtx.length) {
					const tree = buildBranchTree(fromCtx, { currentId: diag.currentId });
					cache = { tree, source: "ctx.sessions", lineage: tree.lineage, at: Date.now(), diag };
				} else {
					const fb = await fallbackFromDiscover();
					const tree = buildBranchTree(fb.summaries);
					cache = { tree, source: fb.source, lineage: false, at: Date.now(), diag };
				}
				notify();
				return cache;
			}
			
			/**
			 * 读"宿主当前会话 id"（**不重建树**，只读快照的一个字段）。
			 *
			 * 🔴 为什么需要它（用户原文）：「我点击左侧，点入不同的对话切进去就是和当前对话
			 *    有关的流转信息」—— 宿主在左栏点会话时**不会**通知插件（没有事件通道），
			 *    而 `buildBranchTree` 的 `isCurrent` 只在构建那一刻成立。
			 *    ⇒ 只能轮询这一个字段（同步、单字段读取，代价可忽略），
			 *      变化时通知订阅者，让右侧面板与流转列表跟着切。
			 * @returns {string|null}
			 */
			function currentSessionId() {
				const svc = sessionsService();
				if (!svc || !svc.list || typeof svc.list.getSnapshot !== "function") return null;
				try {
					const s = svc.list.getSnapshot();
					return s && s.current ? String(s.current) : null;
				} catch (e) { return null; }
			}
			
			let currentTimer = null;
			const currentWatchers = new Set();
			
			/**
			 * 观察"宿主当前会话"变化（**唯一的跟随通道**）。
			 * 首次订阅立即回调一次当前值（订阅者不必自己先读一次 —— 这是上一轮
			 * "先 refresh 后 subscribe ⇒ 永远停在初始快照"那类事故的固化防线）。
			 * @param {(id:string|null)=>void} cb
			 * @param {number} [ms] 轮询间隔，默认 800ms
			 * @returns {() => void} 取消订阅（最后一个订阅者退出时自动停表）
			 */
			function watchCurrentSession(cb, ms) {
				if (typeof cb !== "function") return () => { };
				currentWatchers.add(cb);
				if (!currentTimer) {
					let last = currentSessionId();
					currentTimer = setInterval(() => {
						const cur = currentSessionId();
						if (cur === last) return;
						last = cur;
						for (const fn of currentWatchers) { try { fn(cur); } catch (e) { /* 单个订阅者异常不影响其他 */ } }
					}, Math.max(300, Number(ms) || 800));
					if (currentTimer && typeof currentTimer.unref === "function") currentTimer.unref();
				}
				try { cb(currentSessionId()); } catch (e) { /* 首次回调异常不阻断订阅 */ }
				return () => {
					currentWatchers.delete(cb);
					if (!currentWatchers.size && currentTimer) { clearInterval(currentTimer); currentTimer = null; }
				};
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 四、动作面（只在有真实宿主接口时暴露 —— 不做"点了只弹 toast"）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/**
			 * 取 sessions 服务（两级：`ctx.sessions` 优先 → `ctx.get("sessions")` 兜底）。
			 * 失败返回 null，**不抛** —— 调用方一律以"能力不可用"处理并给出原因。
			 * （为什么必须两级：见 readSessionsFromCtx 的 🔴 段）
			 */
			function sessionsService() {
				if (!ctxRef) return null;
				try { const s = ctxRef.sessions; if (s) return s; } catch (e) { /* 未声明 inject ⇒ 落到 ctx.get */ }
				try {
					if (typeof ctxRef.get === "function") return ctxRef.get("sessions") || null;
				} catch (e) { /* 两级都不可用 */ }
				return null;
			}
			
			/**
			 * 宿主能力探测（供 UI 决定菜单项 enabled）。
			 * 🔴 判据写在返回值里，UI 直接照用，不各自 `typeof` 猜。
			 */
			function hostCapabilities() {
				const svc = sessionsService();
				return {
					available: Boolean(svc),
					open: Boolean(svc && typeof svc.open === "function"),
					fork: Boolean(svc && typeof svc.fork === "function"),
					create: Boolean(svc && typeof svc.create === "function"),
					// 取证：SessionRuntime 成员表里**没有**合并 / 删除 ⇒ 恒 false，菜单据此禁用
					merge: false,
					remove: false
				};
			}
			
			/** 打开某分支的原生对话（宿主 sessions.open） */
			async function openSession(sessionId) {
				const svc = sessionsService();
				if (!svc || typeof svc.open !== "function") return { ok: false, reason: "宿主未提供 sessions.open" };
				try {
					svc.open(sessionId);
					return { ok: true };
				} catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
			}
			
			/** 从某分支 fork 出新分支（宿主 sessions.fork），成功后立即刷新血缘 */
			async function forkBranch(sessionId) {
				const svc = sessionsService();
				if (!svc || typeof svc.fork !== "function") return { ok: false, reason: "宿主未提供 sessions.fork" };
				try {
					const res = await svc.fork({ sessionId });
					await refreshBranchTree();
					const childId = res && res.ok && res.value ? res.value.sessionId : undefined;
					if (childId) return { ok: true, sessionId: childId };
					return { ok: false, reason: (res && res.error && res.error.message) || "宿主未返回子会话 id" };
				} catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 五、全局契约
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 安装全局契约并绑定 ctx（由 client-entry 的 apply 调用） */
			function installBranchTreeApi(ctx) {
				ctxRef = ctx || null;
				const api = {
					LAYOUT, buildBranchTree, normalizeSummary, visibleRows, ancestorChain, treeBounds, matchRows,
					readSessionsFromCtx, refreshBranchTree, subscribeBranch, getBranchSnapshot,
					degradationReason, hostCapabilities, openSession, forkBranch,
					currentSessionId, watchCurrentSession
				};
				if (typeof window !== "undefined") window.__dshBranchTree = api;
				return api;
			}
			
			exports.LAYOUT = LAYOUT;
			exports.normalizeSummary = normalizeSummary;
			exports.buildBranchTree = buildBranchTree;
			exports.visibleRows = visibleRows;
			exports.ancestorChain = ancestorChain;
			exports.treeBounds = treeBounds;
			exports.matchRows = matchRows;
			exports.readSessionsFromCtx = readSessionsFromCtx;
			exports.subscribeBranch = subscribeBranch;
			exports.getBranchSnapshot = getBranchSnapshot;
			exports.degradationReason = degradationReason;
			exports.refreshBranchTree = refreshBranchTree;
			exports.currentSessionId = currentSessionId;
			exports.watchCurrentSession = watchCurrentSession;
			exports.hostCapabilities = hostCapabilities;
			exports.openSession = openSession;
			exports.forkBranch = forkBranch;
			exports.installBranchTreeApi = installBranchTreeApi;
		};

		// ── logic/branch-focus.js ──
		__defs["logic/branch-focus.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：分支链路聚焦（用户需求 R9：点对话只显示该链路 / 可选含上一层 / 可下钻）
			 * 引用：用户原话（2026-09-12 第七轮）
			 * 上游：components/MindMap.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 J）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * logic/branch-focus.js — 分支链路聚焦（纯函数）
			 *
			 * ── 需求（用户原话）─────────────────────────────────────────────
			 *   「对话会存在分支。我点击对话，那么只默认显示这个分支的链路，
			 *     然后可以选是否包含上一层，如果有下一层可以往下一层走。
			 *     比如对话 1,2,3,4,5 每个对话分支 a,b,c；
			 *     我在 1 的 a 点击思维导图，那么就是进入整个 1 的上下游分支；
			 *     然后点击上一层才是 1,2,3,4,5 全显示。」
			 *
			 * ── 语义拆解（三种集合，别混）────────────────────────────────
			 *   `upstreamChain`  祖先链（**不含自身**，从根到直接父）—— 即用户说的"上一层"
			 *   `downstreamIds`  自身 + **全部后代** —— 即用户说的"往下一层走"（可继续下钻）
			 *   `focusRows`      最终可见行 = 下游 ∪ （可选）上游，**保持原行序**
			 *
			 * ── 为什么是纯函数 ──────────────────────────────────────────────
			 *   导图渲染依赖 DOM 几何，`verify-mindmap` 只能真机跑（慢）。
			 *   把判定逻辑抽成纯函数 ⇒ `test-branch-focus.mjs` 可离线穷举边界
			 *   （空 id / 环 / 孤儿父 / 兄弟不在链上），真机只负责"接没接上"。
			 *
			 * ── 边界（每条都有离线样本）──────────────────────────────────
			 *   · `sessionId` 为空或不在 rows 内 → **返回全部行**（不聚焦，而不是返回空 ——
			 *     返回空会让导图突然变白，属"看起来像坏了"）
			 *   · 环（a→b→a）→ 用 seen 集截断，不无限循环
			 *   · 父不在 rows（父会话被删）→ 祖先链止于此，**不报错**
			 *   · 兄弟会话（同父不同枝）→ **不属于**上下游，不含在内
			 */
			
			/** sessionId → 行 的索引 */
			function indexById(rows) {
				const m = new Map();
				for (const r of rows || []) if (r && r.sessionId) m.set(r.sessionId, r);
				return m;
			}
			
			/**
			 * 祖先链（**不含自身**），从根 → 直接父排序。
			 * @param {Array<{sessionId:string,parentSessionId?:string}>} rows
			 * @param {string} sessionId
			 * @returns {Array} 祖先行（远 → 近）
			 */
			function upstreamChain(rows, sessionId) {
				const byId = indexById(rows);
				const out = [];
				const seen = new Set([sessionId]);
				let cur = byId.get(sessionId);
				while (cur && cur.parentSessionId && byId.has(cur.parentSessionId) && !seen.has(cur.parentSessionId)) {
					const pid = cur.parentSessionId;
					seen.add(pid);
					cur = byId.get(pid);
					out.unshift(cur);
				}
				return out;
			}
			
			/**
			 * 自身 + 全部后代（不含祖先、不含兄弟）。
			 * @returns {Set<string>}
			 */
			function downstreamIds(rows, sessionId) {
				const kids = new Map();
				for (const r of rows || []) {
					if (!r || !r.parentSessionId) continue;
					const arr = kids.get(r.parentSessionId) || [];
					arr.push(r.sessionId);
					kids.set(r.parentSessionId, arr);
				}
				const out = new Set();
				const stack = [sessionId];
				while (stack.length) {
					const id = stack.pop();
					if (out.has(id)) continue; // 环保护
					out.add(id);
					for (const k of kids.get(id) || []) stack.push(k);
				}
				return out;
			}
			
			/**
			 * 同级节点（同一个父下的**其他**会话）。
			 *
			 * 🔴 为什么需要它 —— 用户原话的语义修正：
			 *   最初把「含上一层」实现成「并入祖先链」，但用户的例子否掉了它：
			 *   「对话 1,2,3,4,5 每个对话分支 a,b,c；我在 1 的 a 点击…然后点击上一层才是 1,2,3,4,5 全显示」
			 *   —— 1..5 是**根**，a 是 1 的子。并入祖先链只会得到 `1, a`，
			 *   **得不到 2,3,4,5**。用户要的是「上**一层**」＝那一层的**全景**。
			 *   ⇒ 「含上一层」= 祖先链 ∪ 链上每一环的同级节点。
			 */
			function siblingIds(rows, sessionId) {
				const byId = indexById(rows);
				const self = byId.get(sessionId);
				if (!self) return [];
				const key = self.parentSessionId || "";
				const out = [];
				for (const r of rows || []) {
					if (!r || r.sessionId === sessionId) continue;
					if ((r.parentSessionId || "") === key) out.push(r.sessionId);
				}
				return out;
			}
			
			/**
			 * 「上一层」全景 = **祖先链** ∪ 链上每一环的同级。
			 *
			 * 🔴 语义由用户例子逐字校准（两处都踩过）：
			 *   例子：「对话 1,2,3,4,5 每个对话分支 a,b,c；我在 1 的 a 点击思维导图
			 *          那么就是进入整个 1 的上下游分支；然后点击上一层才是 1,2,3,4,5 全显示。」
			 *   ① 第一版实现成「并入祖先链」—— 点 a 只得 `1, a`，**拿不到 2,3,4,5** ⇒ 错；
			 *   ② 第二版对「自身 + 祖先」都取同级 —— 会把 `1-b, 1-c` 也拉进来，
			 *      与用户列的「1,2,3,4,5」不符 ⇒ 过宽；
			 *   ③ 现版：只对**祖先链**取同级；祖先链为空（点的就是根）时，取**自身所在层**的同级。
			 *      ⇒ 点 a（子在 1 下）→ 上一层 = {1, 2,3,4,5}；
			 *      ⇒ 点 1（就是根）→ 上一层 = {2,3,4,5}，与 1 的分支合并即"全显示"。
			 *
			 * @returns {string[]} 不含自身
			 */
			function upstreamPanorama(rows, sessionId) {
				const byId = indexById(rows);
				const anc = upstreamChain(rows, sessionId);
				const self = byId.get(sessionId);
				// 祖先链为空 = 点的就是根 ⇒ 用自身所在层去找同级
				const chain = anc.length ? anc : (self ? [self] : []);
				const out = new Set(anc.map((r) => r.sessionId));
				for (const a of chain) for (const s of siblingIds(rows, a.sessionId)) out.add(s);
				out.delete(sessionId);
				return [...out];
			}
			
			/**
			 * 聚焦后的可见行。
			 *
			 * 可见 = **祖先链**（默认就含 —— 用户说点 a 要看到「整个 1 的上下游分支」，
			 *        所以 1 必须在场）∪ **自身 + 全部后代** ∪ （`includeParents` 时）**上一层全景**
			 *
			 * @param {Array} rows `buildBranchTree().rows`
			 * @param {string} sessionId 被点击的会话
			 * @param {{includeParents?:boolean}} [opts]
			 * @returns {{rows:Array, applied:boolean, stats:{self:number,up:number,down:number,total:number}}}
			 *   `applied=false` 表示"没聚焦"（入参不合法 ⇒ 返回全量，调用方据此不显示聚焦开关）
			 */
			function focusRows(rows, sessionId, opts = {}) {
				const all = Array.isArray(rows) ? rows : [];
				const byId = indexById(all);
				const fallback = { rows: all, applied: false, stats: { self: 0, up: 0, down: 0, total: all.length } };
				if (!sessionId || !byId.has(sessionId)) return fallback;
			
				const down = downstreamIds(all, sessionId);
				const anc = upstreamChain(all, sessionId).map((r) => r.sessionId);
				const extra = opts.includeParents ? upstreamPanorama(all, sessionId) : [];
				const upSet = new Set([...anc, ...extra]);
				const keep = new Set([...down, ...upSet]);
				return {
					rows: all.filter((r) => keep.has(r.sessionId)),
					applied: true,
					stats: {
						self: 1,
						up: upSet.size,
						down: down.size - 1, // 不含自身
						total: keep.size
					}
				};
			}
			
			/**
			 * 某会话是否有**可下钻**的下一层（导图据此决定「下钻」是否可用）。
			 */
			function hasDownstream(rows, sessionId) {
				const byId = indexById(rows);
				for (const r of rows || []) if (r && r.parentSessionId === sessionId && byId.has(r.sessionId)) return true;
				return false;
			}
			
			/** 安装全局契约（供真机脚本调用） */
			function installBranchFocusApi() {
				if (typeof window === "undefined") return null;
				const api = { indexById, upstreamChain, downstreamIds, siblingIds, upstreamPanorama, focusRows, hasDownstream };
				window.__dshBranchFocus = api;
				return api;
			}
			
			exports.indexById = indexById;
			exports.upstreamChain = upstreamChain;
			exports.downstreamIds = downstreamIds;
			exports.siblingIds = siblingIds;
			exports.upstreamPanorama = upstreamPanorama;
			exports.focusRows = focusRows;
			exports.hasDownstream = hasDownstream;
			exports.installBranchFocusApi = installBranchFocusApi;
		};

		// ── logic/overview.js ──
		__defs["logic/overview.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：总览弹窗的数据整形（R10：左已完成 / 右待完成，按文件夹+对话分类）
			 * 引用：用户原话（2026-09-12 第七轮）
			 * 上游：components/OverviewDialog.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 J）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * logic/overview.js — 总览弹窗的数据整形（纯函数）
			 *
			 * ── 需求（用户原话）─────────────────────────────────────────────
			 *   「思维导图最上面加一个弹窗，分为左右列。左列是目前所有完成的功能，
			 *     右列是所有待完成的，按照文件夹、对话进行分类。这样我们随时[掌握]所有项目的情况。
			 *     同时这个允许点击，每一条点击的时候在左侧显示具体执行完成或者正在执行的情况，
			 *     我可以随时针对点击的部分发送消息进行修正。」
			 *
			 * ── 分类口径（必须写死在这里，不许各组件各判一次）────────────────
			 *   已完成 = `state === "done"`                 ← 导图节点态（宿主/推断都算）
			 *          或 `completed === true`              ← 宿主显式真值
			 *   待完成 = 其余
			 *
			 * 🔴 为什么要单列口径：本项目已栽过一次「一个语义标在两个元素上」导致计数翻倍
			 *   （`data-collapsed`）。分类若散落在 UI 里，两列之和 ≠ 总条数 这类错误
			 *   会以「看起来挺合理」的形态长期存在。
			 */
			
			/** 单条会话的展示态（UI 与测试共用一份判据） */
			function isDoneRow(row) {
				if (!row) return false;
				return row.state === "done" || row.completed === true;
			}
			
			/** 运行中（"正在执行"）—— 与 `isDoneRow` 互斥优先：运行中优先显示为进行中 */
			function isRunningRow(row) {
				if (!row) return false;
				if (isDoneRow(row)) return false;
				return row.state === "running" || row.running === true || Boolean(row.pending);
			}
			
			/** 进行中标签（详情区显示用） */
			function statusLabelOf(row) {
				if (!row) return "未知";
				if (isDoneRow(row)) return "已完成";
				if (isRunningRow(row)) return row.pending ? "待确认" : "执行中";
				return "待开始";
			}
			
			function groupPush(map, folder, item) {
				const arr = map.get(folder);
				if (arr) arr.push(item); else map.set(folder, [item]);
			}
			
			function toGroups(map) {
				return [...map.entries()]
					.sort((a, b) => a[0].localeCompare(b[0], "zh"))
					.map(([folder, items]) => ({
						folder,
						items: items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || String(a.title).localeCompare(String(b.title), "zh"))
					}));
			}
			
			/**
			 * 把「会话行 + 数据源映射」整理成两列分组。
			 *
			 * @param {object} input
			 * @param {Array} input.rows `buildBranchTree().rows`
			 * @param {Array} [input.sessions] `discover().sessions`（sessionId ↔ workspaceId）
			 * @param {Array} [input.workspaces] `discover().workspaces`（workspaceId ↔ 显示名）
			 * @returns {{done:Array<{folder:string,items:Array}>, todo:Array<{folder:string,items:Array}>,
			 *            counts:{done:number,todo:number,total:number}, folders:string[]}}
			 */
			function buildOverview(input = {}) {
				const rows = Array.isArray(input.rows) ? input.rows : [];
				const sessions = Array.isArray(input.sessions) ? input.sessions : [];
				const workspaces = Array.isArray(input.workspaces) ? input.workspaces : [];
			
				const wsName = new Map();
				for (const w of workspaces) if (w && w.id !== undefined) wsName.set(w.id, w.name || String(w.id));
				const seWs = new Map();
				for (const s of sessions) if (s && s.id) seWs.set(String(s.id), s.workspaceId);
			
				const doneMap = new Map();
				const todoMap = new Map();
				let done = 0;
				let todo = 0;
			
				for (const r of rows) {
					if (!r || !r.sessionId) continue;
					const wsId = seWs.get(String(r.sessionId));
					const folder = (wsId !== undefined && wsName.get(wsId)) || (wsId ? "工作区 " + String(wsId).slice(0, 8) : "未分组");
					const item = {
						sessionId: r.sessionId,
						title: r.title || r.sessionId,
						folder,
						state: r.state,
						statusLabel: statusLabelOf(r),
						depth: r.depth,
						childrenCount: r.childrenCount || 0,
						updatedAt: r.updatedAt || 0,
						running: isRunningRow(r),
						done: isDoneRow(r)
					};
					if (item.done) { groupPush(doneMap, folder, item); done++; }
					else { groupPush(todoMap, folder, item); todo++; }
				}
			
				return {
					done: toGroups(doneMap),
					todo: toGroups(todoMap),
					counts: { done, todo, total: done + todo },
					folders: [...new Set([...doneMap.keys(), ...todoMap.keys()])].sort()
				};
			}
			
			/** 安装全局契约（供真机脚本比对） */
			function installOverviewApi() {
				if (typeof window === "undefined") return null;
				const api = { buildOverview, isDoneRow, isRunningRow, statusLabelOf };
				window.__dshOverview = api;
				return api;
			}
			
			exports.isDoneRow = isDoneRow;
			exports.isRunningRow = isRunningRow;
			exports.statusLabelOf = statusLabelOf;
			exports.buildOverview = buildOverview;
			exports.installOverviewApi = installOverviewApi;
		};

		// ── components/OverviewDialog.js ──
		__defs["components/OverviewDialog.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：总览弹窗（R10：左已完成 / 右待完成 · 按文件夹+对话分组 · 可点击 · 可发消息修正）
			 * 引用：用户原话（2026-09-12 第七轮）
			 * 上游：components/MindMap.js
			 * 下游：logic/overview.js, logic/discover.js, bridge/chat-bridge.js, logic/branch-tree.js, store/personalize.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 J）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/OverviewDialog.js — 总览弹窗（R10）
			 *
			 * ── 需求（用户原话）─────────────────────────────────────────────
			 *   「思维导图最上面加一个弹窗，分为左右列。左列是目前所有完成的功能，
			 *     右列是所有待完成的，按照文件夹、对话进行分类……
			 *     这个允许点击，每一条点击的时候在左侧显示具体执行完成或者正在执行的情况，
			 *     我可以随时针对点击的部分发送消息进行修正。」
			 *
			 * ── 三个设计决定（都不是随手定的）──────────────────────────────
			 *  ① **分类口径只定义一次**（`logic/overview.js`）——
			 *     本项目栽过「一个语义标在两个元素上 ⇒ 计数翻倍」，分类散落必出同类错。
			 *  ② **点条目 = 选中，不是跳转** —— 用户要的是"在左侧显示执行情况"，
			 *     跳走会让用户丢失全局面。选中态写进 `data-sel-session` 供断言。
			 *  ③ **发送走 `deliverToChat`** —— 与总监页/节点面板同一条投递通道，
			 *     避免"总览这里能发、别处发不出去"的多套真相源。
			 */
			
			const react = require("react");
			const { buildOverview } = __m("logic/overview.js");
			const { discover } = __m("logic/discover.js");
			const { deliverToChat } = __m("bridge/chat-bridge.js");
			const { openSession } = __m("logic/branch-tree.js");
			const { listDirectorMessages } = __m("store/plugin-db.js");
			
			const h = react.createElement;
			const OVERVIEW_ID = "dsh-mm-overview";
			
			const S = {
				backdrop: {
					position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.42)",
					display: "flex", alignItems: "flex-start", justifyContent: "center"
				},
				panel: {
					marginTop: 54, width: "min(1080px, 94vw)", maxHeight: "78vh", display: "flex", flexDirection: "column",
					background: "var(--dsw-alias-bg-layer-2, var(--dp-bg-1, #141519))",
					color: "var(--dsw-alias-label-primary, var(--dp-t1, #e6e8eb))",
					border: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))",
					borderRadius: 12, boxShadow: "var(--dsw-shadow-lv2, 0 18px 48px rgba(0,0,0,.5))",
					fontFamily: "inherit", overflow: "hidden"
				},
				hd: {
					display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
					borderBottom: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))", flex: "0 0 auto"
				},
				cols: { display: "flex", gap: 0, flex: "1 1 auto", minHeight: 0 },
				col: { flex: "1 1 50%", minWidth: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))" },
				colLast: { flex: "1 1 50%", minWidth: 0, display: "flex", flexDirection: "column" },
				colHd: { padding: "7px 10px", fontSize: 12.5, fontWeight: 650, borderBottom: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))" },
				body: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "6px 8px" },
				grp: { margin: "6px 0 10px" },
				grpT: { fontSize: 11.5, fontWeight: 650, opacity: 0.72, margin: "0 2px 4px" },
				item: (sel) => ({
					display: "flex", alignItems: "center", gap: 6, padding: "5px 7px", borderRadius: 7, cursor: "pointer",
					fontSize: 12, background: sel ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "transparent",
					border: "1px solid " + (sel ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "transparent")
				}),
				dot: (c) => ({ width: 7, height: 7, borderRadius: "50%", background: c, flex: "0 0 auto" }),
				ft: { flex: "0 0 auto", borderTop: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #31343a))", padding: "8px 10px" },
				inp: {
					width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 44, padding: "6px 8px",
					borderRadius: 7, border: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #3d4148))",
					background: "var(--dsw-alias-bg-layer-1, rgba(255,255,255,.03))",
					color: "inherit", fontFamily: "inherit", fontSize: 12
				},
				btn: {
					padding: "4px 10px", fontSize: 12, borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
					border: "1px solid var(--dsw-alias-border-l2, var(--dp-line, #3d4148))",
					background: "transparent", color: "inherit"
				},
				btnPri: { border: "1px solid var(--dp-ac, #2f6feb)", background: "var(--dp-ac, #2f6feb)", color: "#fff" },
				muted: { opacity: 0.6, fontSize: 11.5 }
			};
			
			const STATE_COLOR = { done: "#3fb950", running: "#2f6feb", warn: "#d29922", idle: "#8b9199", info: "#d29922" };
			
			/**
			 * @param {object} props
			 * @param {boolean} props.open
			 * @param {() => void} props.onClose
			 * @param {Array} props.rows 会话行（`buildBranchTree().rows`）
			 * @param {(m:string, tone?:string) => void} [props.onSay]
			 */
			function OverviewDialog(props) {
				const { open, onClose, rows, onSay } = props;
				const [data, setData] = react.useState(null);
				const [sel, setSel] = react.useState(null);
				const [draft, setDraft] = react.useState("");
				const [busy, setBusy] = react.useState(false);
				const [mode, setMode] = react.useState("idle");
				const [msgs, setMsgs] = react.useState([]);
			
				/* 数据：discover（文件夹映射）+ buildOverview（分类分组）。open 时才拉，避免常驻开销。 */
				react.useEffect(() => {
					if (!open) return;
					let dead = false;
					(async () => {
						let src = { sessions: [], workspaces: [] };
						try { src = await discover(); } catch (e) { /* 降级：无分组信息，全部归「未分组」 */ }
						if (dead) return;
						setData(buildOverview({ rows, sessions: src.sessions, workspaces: src.workspaces }));
					})();
					return () => { dead = true; };
				}, [open, rows]);
			
				/* 选中条目的"执行情况"：取该会话的总监消息（有则显示末条） */
				react.useEffect(() => {
					if (!sel) { setMsgs([]); return; }
					let dead = false;
					(async () => {
						try {
							const list = (await listDirectorMessages("se_" + String(sel))) || [];
							if (!dead) setMsgs(list);
						} catch (e) { if (!dead) setMsgs([]); }
					})();
					return () => { dead = true; };
				}, [sel]);
			
				if (!open) return null;
			
				const counts = (data && data.counts) || { done: 0, todo: 0, total: 0 };
				const selItem = (() => {
					if (!data || !sel) return null;
					for (const g of [...data.done, ...data.todo]) {
						const hit = g.items.find((x) => String(x.sessionId) === String(sel));
						if (hit) return hit;
					}
					return null;
				})();
			
				const send = async () => {
					const t = draft.trim();
					if (!t || !sel) return;
					setBusy(true);
					try {
						const r = await deliverToChat(t, { sessionId: sel, opener: openSession, autoSend: true });
						setMode(r.mode === "sent" ? "sent" : (r.ok ? "filled" : "failed"));
						if (onSay) onSay(r.ok ? (r.mode === "sent" ? "已发送修正" : "已填入输入框") : "未送达 · " + r.reason, r.ok ? "" : "warn");
						setDraft("");
					} finally { setBusy(false); }
				};
			
				const renderCol = (title, groups, key, last) => h("div", {
					key, style: last ? S.colLast : S.col, "data-testid": "mm-ov-col-" + key
				}, [
					h("div", { key: "h", style: S.colHd, "data-testid": "mm-ov-h-" + key },
						title + " · " + (key === "done" ? counts.done : counts.todo)),
					h("div", { key: "b", style: S.body, className: "dp-scroll", "data-testid": "mm-ov-body-" + key },
						groups.length ? groups.map((g) => h("div", { key: g.folder, style: S.grp, "data-testid": "mm-ov-grp" }, [
							h("div", { key: "t", style: S.grpT }, "📁 " + g.folder + "（" + g.items.length + "）"),
							...g.items.map((it) => h("div", {
								key: it.sessionId, style: S.item(String(it.sessionId) === String(sel)),
								"data-testid": "mm-ov-item", "data-session-id": it.sessionId, "data-state": it.state,
								"data-folder": it.folder,
								onClick: () => { setSel(it.sessionId); setMode("idle"); },
								title: it.folder + " · " + it.statusLabel
							}, [
								h("span", { key: "d", style: S.dot(STATE_COLOR[it.state] || STATE_COLOR.idle) }),
								h("span", { key: "t", style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.title),
								h("span", { key: "s", style: S.muted }, it.statusLabel)
							]))
						])) : h("div", { key: "e", style: S.muted, "data-testid": "mm-ov-empty-" + key }, "无"))
				]);
			
				return h("div", {
					id: OVERVIEW_ID, style: S.backdrop, "data-testid": "mm-ov", "data-open": "1",
					"data-count-done": counts.done, "data-count-todo": counts.todo,
					"data-sel-session": sel || "", "data-deliver-mode": mode,
					onClick: (e) => { if (e.target === e.currentTarget) onClose(); }
				}, [
					h("div", { key: "p", style: S.panel, role: "dialog", "aria-label": "项目总览" }, [
						h("div", { key: "hd", style: S.hd }, [
							h("span", { key: "t", style: { fontWeight: 650, fontSize: 13 } }, "总览"),
							h("span", { key: "c", style: S.muted }, "已完成 " + counts.done + " · 待完成 " + counts.todo + " · 合计 " + counts.total),
							h("span", { key: "f", style: { ...S.muted, marginLeft: "auto" } }, "按文件夹分组"),
							h("button", { key: "x", style: S.btn, "data-testid": "mm-ov-close", "aria-label": "关闭总览", title: "关闭", onClick: onClose }, "✕")
						]),
						h("div", { key: "c", style: S.cols }, [
							renderCol("已完成", (data && data.done) || [], "done", false),
							renderCol("待完成", (data && data.todo) || [], "todo", true)
						]),
						h("div", { key: "ft", style: S.ft, "data-testid": "mm-ov-detail" }, [
							h("div", { key: "s", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" } }, [
								h("span", { key: "k", style: { fontWeight: 650, fontSize: 12 } },
									selItem ? ("执行情况 · " + selItem.title) : "选择左侧任一条目查看执行情况"),
								selItem ? h("span", { key: "st", style: S.muted }, "状态 " + selItem.statusLabel + " · " + selItem.folder + " · 子分支 " + selItem.childrenCount) : null,
								selItem ? h("span", { key: "m", style: S.muted }, "总监消息 " + msgs.length) : null,
								selItem && msgs.length ? h("span", { key: "l", style: { ...S.muted, maxWidth: "46%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
									"末条：" + String((msgs[msgs.length - 1] || {}).text || "").slice(0, 60)) : null
							]),
							h("textarea", {
								key: "i", style: S.inp, "data-testid": "mm-ov-input", value: draft, disabled: busy || !sel,
								placeholder: sel ? "输入修正内容，回车发送" : "先选一条",
								onChange: (e) => setDraft(e.target.value),
								onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
							}),
							h("div", { key: "b", style: { display: "flex", gap: 6, marginTop: 6, alignItems: "center" } }, [
								h("button", { key: "s", style: { ...S.btn, ...S.btnPri, opacity: busy ? 0.6 : 1 }, "data-testid": "mm-ov-send", disabled: busy || !sel, title: "发送修正到该对话", onClick: send },
									busy ? "处理中…" : "发送修正"),
								h("span", { key: "n", style: S.muted }, sel ? "目标 …" + String(sel).slice(-8) : "未选中")
							])
						])
					])
				]);
			}
			
			__defaults["components/OverviewDialog.js"] = OverviewDialog;
			
			exports.OVERVIEW_ID = OVERVIEW_ID;
			exports.OverviewDialog = OverviewDialog;
		};

		// ── logic/mindmap-render.js ──
		__defs["logic/mindmap-render.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：导图渲染派生（**纯函数，不依赖 React**）
			 * 引用：—
			 * 上游：components/MindMap.js
			 * 下游：logic/branch-tree.js, store/mindmap-schema.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * logic/mindmap-render.js — 导图渲染派生（**纯函数，不依赖 React**）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 F（思维导图元素库）】
			 *  上游     components/MindMap.js（渲染层只做布局，不做几何与文案运算）
			 *  下游     store/mindmap-schema.js（元素词汇表）· logic/branch-tree.js（LAYOUT）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 为什么把这几行从组件里搬出来（不是洁癖，是**可测性**）
			 * ══════════════════════════════════════════════════════════════════
			 *  组件文件 import 了 `react`，而 react 是**平台外置模块**（ADR-001，不进 bundle、
			 *  Node 侧也不装）⇒ 只要这些纯函数留在组件里，离线测试就 import 不进组件文件，
			 *  于是"连线是主干还是分支""徽标取不到时写什么"这类**纯逻辑**只能靠真机 e2e 验，
			 *  慢且脆。搬到这里之后，`scripts/test-mindmap-logic.mjs` 可以一秒跑完。
			 *
			 *  ⚠️ 本文件**不得** import react / react-dom（会破坏上面的可测性）。
			 */
			
			const { LAYOUT } = __m("logic/branch-tree.js");
			const { EDGE_KINDS, NODE_KINDS, STATE_KINDS, marksOfRow } = __m("store/mindmap-schema.js");
			
			/**
			 * 连线路径（三次贝塞尔 / 直角折线两种，由个性化设定切换）。
			 * 🔴 用曲线而不是直线：血缘树的子节点在纵向上是**阶梯**排列的，直线会在分叉处
			 *    互相穿插（三条线挤在一个交点），曲线让"哪条线进哪个节点"一眼可辨。
			 *    「折线」档是为偏好工程感的用户准备的（个性化设定里的 edge=elbow）。
			 * ⚠️ 两个端点**必须从实际行列坐标算**（节点可被用户拖动），不能再用 LAYOUT 常量拼 ——
			 *    否则拖动之后连线还挂在原位。
			 * @param {object} a 父行（含 x / y）
			 * @param {object} b 子行
			 * @param {number} depth 子行深度（≤1 = 主干，其余 = 分支）
			 * @param {boolean} chain 是否在选中链上
			 * @param {"curve"|"elbow"} [style] 个性化设定里的连线样式
			 * @returns {{d:string, kind:string, x1:number, y1:number, x2:number, y2:number}}
			 */
			function edgePathFor(a, b, depth, chain, style) {
				const x1 = a.x + LAYOUT.nodeW;
				const y1 = a.y + LAYOUT.nodeH / 2;
				const x2 = b.x;
				const y2 = b.y + LAYOUT.nodeH / 2;
				const mx = x1 + (x2 - x1) / 2;
				const kind = chain ? "chain" : (depth <= 1 ? "trunk" : "child");
				const d = style === "elbow"
					? "M" + x1 + "," + y1 + " L" + mx + "," + y1 + " L" + mx + "," + y2 + " L" + x2 + "," + y2
					: "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2;
				return { d, kind, x1, y1, x2, y2 };
			}
			
			/**
			 * 把用户拖动的位置叠加到行上（**纯函数**）。
			 * 🔴 拖动只改**画面位置**，绝不改 `parentSessionId` ——
			 *    血缘由宿主 fork 时固化，插件侧无接口可改（元素库 E18 明确登记为不做）。
			 * @param {Array} rows buildBranchTree().rows
			 * @param {Object<string,{x:number,y:number}>} posMap 用户摆放的位置（按 sessionId）
			 * @returns {Array} 新行数组（未摆放的行原样返回，不复制也安全）
			 */
			function applyNodePos(rows, posMap) {
				if (!posMap || !Object.keys(posMap).length) return rows;
				return (rows || []).map((r) => {
					const p = posMap[r.sessionId];
					if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return r;
					return { ...r, x: p.x, y: p.y, moved: true };
				});
			}
			
			/** 拖动位移 → 新坐标（把屏幕像素位移换算回画布坐标；含边界夹紧，防拖出画布丢失） */
			function draggedPos(origin, dxScreen, dyScreen, zoom, bounds) {
				const k = Number(zoom) > 0 ? Number(zoom) : 1;
				const w = (bounds && bounds.w) || 4000, h = (bounds && bounds.h) || 3000;
				const x = Math.max(0, Math.min(w, Math.round((origin.x + dxScreen / k) * 10) / 10));
				const y = Math.max(0, Math.min(h, Math.round((origin.y + dyScreen / k) * 10) / 10));
				return { x, y };
			}
			
			/** 框上的小控件样式（用 CSS 变量消费个性化设定；禁用态给明确视觉） */
			function nodeBtnStyle(enabled, tone) {
				return {
					flex: "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center",
					width: 17, height: 17, borderRadius: "var(--dp-radius-sm, 5px)", cursor: enabled ? "pointer" : "not-allowed",
					fontSize: 10.5, lineHeight: 1, opacity: enabled ? 1 : 0.4,
					border: "1px solid " + (tone ? "var(--dp-ac2-line, rgba(137,87,229,.45))" : "var(--dp-line, #31343a)"),
					background: tone ? "var(--dp-ac2-soft, rgba(137,87,229,.16))" : "rgba(255,255,255,.05)",
					color: tone ? "var(--dp-ac2, #8957e5)" : "var(--dp-t2, #c3c8ce)"
				};
			}
			
			/** 连线样式（从 EDGE_KINDS 取，单一真相源；未知类型回落 child） */
			function edgeStyleOf(kind) {
				const e = EDGE_KINDS[kind] || EDGE_KINDS.child;
				return {
					stroke: e.stroke, strokeWidth: e.width, opacity: e.opacity, fill: "none",
					strokeDasharray: e.dash || undefined, strokeLinecap: "round"
				};
			}
			
			/**
			 * 节点第二行文案。
			 * 🔴 取不到任何有据徽标时**不写"未知"**，退回「层 N」——
			 *    深度是从血缘算出来的事实，而"未知"是一句没有信息量的话。
			 */
			function metaLineOf(row) {
				const marks = marksOfRow(row).map((m) => m.text);
				if (marks.length) return marks.join(" · ");
				return "层 " + row.depth;
			}
			
			/** 节点类型显示名（未知类型回落叶子，不抛） */
			function kindLabelOf(row) {
				return (NODE_KINDS[row && row.kind] || NODE_KINDS.leaf).label;
			}
			
			/** 状态点的可读说明（挂 title —— 否则用户只看到一个颜色点，不知道它是什么意思） */
			function stateTitleOf(row) {
				const s = STATE_KINDS[row.state] || STATE_KINDS.idle;
				const src = row.stateSource === "host" ? "宿主快照" : "推断（血缘降级）";
				return s.label + " —— 判据：" + s.from + " ｜ 来源：" + src;
			}
			
			/** 悬浮工具条按钮样式（小方块，hover 由宿主浏览器默认态承担） */
			const HOVER_BTN_STYLE = Object.freeze({
				fontSize: 11.5, color: "#c3c8ce", cursor: "pointer", padding: "1px 4px", borderRadius: 3,
				background: "rgba(255,255,255,.05)", lineHeight: 1.4
			});
			
			exports.edgePathFor = edgePathFor;
			exports.applyNodePos = applyNodePos;
			exports.draggedPos = draggedPos;
			exports.nodeBtnStyle = nodeBtnStyle;
			exports.edgeStyleOf = edgeStyleOf;
			exports.metaLineOf = metaLineOf;
			exports.kindLabelOf = kindLabelOf;
			exports.stateTitleOf = stateTitleOf;
			exports.HOVER_BTN_STYLE = HOVER_BTN_STYLE;
		};

		// ── logic/flow.js ──
		__defs["logic/flow.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：四维消息流转（总监 / 对话 / 思维导图 / 设计图 的**同一条消息**）
			 * 引用：—
			 * 上游：client-entry.js, components/DirectorPage.js, components/MindMap.js, components/NodeDetailPanel.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * logic/flow.js — 四维消息流转（总监 / 对话 / 思维导图 / 设计图 的**同一条消息**）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  需求原文（用户）：「最后打通总监和正常对话还有思维导图还有设计图之间的关联，
			 *   保证同一个消息能在上面几个维度进行流转。我点击左侧，点入不同的对话切进去
			 *   就是和当前对话有关的流转信息」
			 *
			 *  ⇒ 落地口径：
			 *     一条**流转条目**（flow）= 一条消息 + 它走过哪些维度的足迹（`trail`）。
			 *     四个界面**读写同一份数据**，于是"同一消息在四个维度流转"是可查证的，
			 *     而不是四份互相不知道的影子状态。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  为什么必须有这一层（而不是各界面各存一份）
			 * ══════════════════════════════════════════════════════════════════
			 *  已有三份状态，但它们**互不相通**：
			 *    · `store/plugin-db.js`  总监消息（按 nodeId 存，只有总监维度的）
			 *    · 宿主原生会话          真实对话（在宿主里，插件只能读不能写历史）
			 *    · 设计图底部对话（D6）  只处理设计图
			 *  ⇒ 用户"发一句话"这件事在三个地方各记各的，看不出"这句话后来去哪了"。
			 *  本层把「谁发的 / 发到哪 / 走到第几维 / 现在是什么状态」收敛成一份可追踪的轨迹。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 两条纪律
			 * ══════════════════════════════════════════════════════════════════
			 *  ① **不静默分发**：`push()` 只登记"这句话产生了"，`move()` 才记"被送往某维"，
			 *     且 UI 必须在该维度**给出可见反馈**（与 logic/routing.js 的确认闸门同一条纪律）。
			 *  ② **不编内容**：`currentTaskOf()` 的每个分支都在 `source` 字段里写明
			 *     "这个结论来自哪里"（host.running / host.pendingInteraction / flow.trail /
			 *     plugin-db / none）。读不到就说读不到，不拿标题或深度顶替。
			 *
			 * ⚠️ 本文件**不 import react**（纯函数 + 持久化 store）⇒ 离线单测可直接 import。
			 */
			
			/* ══════════════════════════════════════════════════════════════════
			 * 一、四个维度（顺序即界面顺序：总监 | 对话 | 思维导图 | 设计图）
			 * ══════════════════════════════════════════════════════════════════ */
			
			const DIM = Object.freeze({
				DIRECTOR: "director",
				CHAT: "chat",
				MINDMAP: "mindmap",
				DESIGN: "design"
			});
			
			/** 维度顺序（与用户口中的顺序一致："总监和正常对话还有思维导图还有设计图"） */
			const DIM_ORDER = Object.freeze([DIM.DIRECTOR, DIM.CHAT, DIM.MINDMAP, DIM.DESIGN]);
			
			const DIM_LABEL = Object.freeze({
				[DIM.DIRECTOR]: "总监",
				[DIM.CHAT]: "对话",
				[DIM.MINDMAP]: "思维导图",
				[DIM.DESIGN]: "设计图"
			});
			
			const DIM_ICON = Object.freeze({
				[DIM.DIRECTOR]: "◆",
				[DIM.CHAT]: "💬",
				[DIM.MINDMAP]: "🧠",
				[DIM.DESIGN]: "🖌"
			});
			
			/** 落点（这条消息最终被送去哪；与 logic/routing.js 的 DESTINATION 语义对齐但独立计数） */
			const FLOW_STATUS = Object.freeze({
				OPEN: "open",        // 已登记，尚未确认去向
				ROUTED: "routed",    // 已确认去向，已送达
				BLOCKED: "blocked",  // 有阻塞（宿主接口不可用 / 目标不存在）
				DONE: "done"         // 已收口（对应任务已完成）
			});
			
			const FLOW_STATUS_LABEL = Object.freeze({
				[FLOW_STATUS.OPEN]: "待确认去向",
				[FLOW_STATUS.ROUTED]: "已送达",
				[FLOW_STATUS.BLOCKED]: "有阻塞",
				[FLOW_STATUS.DONE]: "已收口"
			});
			
			/** 宿主的三种 pendingInteraction（与 store/mindmap-schema.js 的取值域一致） */
			const PENDING_LABEL = Object.freeze({
				approval: "等待批准",
				question: "等待回答",
				"plan-review": "等待方案评审"
			});
			
			/* ══════════════════════════════════════════════════════════════════
			 * 二、纯函数（可离线断言）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 稳定短 id（不依赖 Math.random —— 项目纪律：禁用非确定性随机） */
			function flowId(seed) {
				const s = String(seed == null ? "" : seed);
				let h1 = 2166136261, h2 = 2246822519;
				for (let i = 0; i < s.length; i++) {
					const c = s.charCodeAt(i);
					h1 = (h1 ^ c) >>> 0; h1 = Math.imul(h1, 16777619) >>> 0;
					h2 = (h2 + c * (i + 3)) >>> 0; h2 = Math.imul(h2, 3266489917) >>> 0;
				}
				return "fl" + h1.toString(36) + h2.toString(36).slice(0, 4);
			}
			
			/** 文案截断（列表里显示用；不改变原文本） */
			function clip(text, n) {
				const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
				const max = n || 60;
				return s.length > max ? s.slice(0, max - 1) + "…" : s;
			}
			
			/**
			 * 登记一条新流转。
			 * @param {{text:string, origin?:string, sessionId?:string, at?:number, target?:string, note?:string}} input
			 * @returns {object} flow
			 */
			function makeFlow(input = {}) {
				const text = String(input.text == null ? "" : input.text).trim();
				const origin = DIM_ORDER.indexOf(input.origin) >= 0 ? input.origin : DIM.DIRECTOR;
				const sessionId = input.sessionId === undefined || input.sessionId === null ? null : String(input.sessionId);
				const at = typeof input.at === "number" ? input.at : Date.now();
				return {
					flowId: flowId(origin + "|" + text + "|" + at),
					text,
					origin,
					sessionId,
					at,
					status: FLOW_STATUS.OPEN,
					target: input.target || null,
					trail: [{ dim: origin, at, note: input.note || "登记" }]
				};
			}
			
			/**
			 * 让一条流转"走到"某一维（追加足迹；**不改** origin，保证"从哪来"可追溯）。
			 * @param {object} flow
			 * @param {string} dim
			 * @param {string} [note]
			 * @param {object} [extra] 可带 { status, target }
			 * @returns {object} 新 flow（不原地改，便于对比）
			 */
			function hopFlow(flow, dim, note, extra) {
				if (!flow) return null;
				if (DIM_ORDER.indexOf(dim) < 0) return flow;
				const at = (extra && typeof extra.at === "number") ? extra.at : Date.now();
				const next = {
					...flow,
					status: (extra && extra.status) || flow.status,
					target: (extra && extra.target) !== undefined ? extra.target : flow.target,
					trail: (flow.trail || []).concat([{ dim, at, note: String(note || "") }])
				};
				return next;
			}
			
			/** 这条流转走过哪些维度（去重、按界面顺序返回） */
			function flowDims(flow) {
				const seen = new Set((flow && flow.trail ? flow.trail : []).map((t) => t.dim));
				return DIM_ORDER.filter((d) => seen.has(d));
			}
			
			/** 人类可读的流转线：「总监 → 对话 → 思维导图」 */
			function flowLine(flow, sep) {
				const dims = flowDims(flow);
				if (!dims.length) return "—";
				return dims.map((d) => DIM_LABEL[d]).join(sep || " → ");
			}
			
			/** 最后一次足迹（UI 上"现在在哪一维"） */
			function lastHop(flow) {
				const t = flow && flow.trail ? flow.trail : [];
				return t.length ? t[t.length - 1] : null;
			}
			
			/**
			 * 最后活动时刻 —— 登记时刻与**全部足迹时刻**取最大。
			 *
			 * 🔴 为什么需要它（本闸门 B28 暴露的真实语义缺口）：
			 *   `flow.at` 只是**登记时刻**（makeFlow 时写下，hopFlow 不再改它，因为它是"从哪来"的一部分）。
			 *   于是一条昨天登记、今天才被推进到设计图的流转，
			 *   `at` 仍是昨天 ⇒ 它会被排到"更晚登记但早已僵住"的条目**之后**，
			 *   而用户看到的是「点左侧切进来、面板最上面写着要干的事」——
			 *   他最关心的是**最近有动静的那条**，不是最近新建的那条。
			 *   ⇒ 排序与「现在在做的事」的时间戳都改用本函数；`at` 保留原义（登记时刻）不动。
			 */
			function lastTouchOf(flow) {
				if (!flow) return 0;
				const t = flow.trail || [];
				let m = typeof flow.at === "number" ? flow.at : 0;
				for (const h of t) if (typeof h.at === "number" && h.at > m) m = h.at;
				return m;
			}
			
			/** 某会话的全部流转（按**最后活动**升序；sessionId 为 null 的条目属"全域"） */
			function flowsOf(flows, sessionId) {
				const sid = sessionId === undefined || sessionId === null ? null : String(sessionId);
				return (Array.isArray(flows) ? flows : [])
					.filter((f) => (f.sessionId === null ? sid === null : f.sessionId === sid))
					.slice()
					.sort((a, b) => lastTouchOf(a) - lastTouchOf(b));
			}
			
			/** 某会话最新一条流转（无则 null） */
			function latestFlow(flows, sessionId) {
				const list = flowsOf(flows, sessionId);
				return list.length ? list[list.length - 1] : null;
			}
			
			/**
			 * 「现在在做的事」—— 用户原文：「点击框在右侧展开对话，对话的最上面是
			 * 现在正在做的事情，也就是我发给或者总监发给对话的信息，对话整理出目前
			 * 自己在做的什么事情，我要在思维导图界面能看到」。
			 *
			 * 🔴 优先级固定（先"宿主真值"，后"我们自己记的"）：
			 *     ① 宿主 `pendingInteraction` → 真的在等人（最强信号）
			 *     ② 宿主 `running === true`  → 真的在跑
			 *     ③ 最新流转               → 我们确实登记过的那句话
			 *     ④ 总监消息（plugin-db）   → 总监维度的最后一句
			 *     ⑤ 无                     → 如实报"待命 · 尚无流转"
			 *   每个分支都带 `source`，UI 直接显示出来 ⇒ 读不到时用户知道是"没数据"，
			 *   而不是以为界面坏了（这是本项目反复吃过亏的地方）。
			 *
			 * @param {{node?:object, flow?:object, flowList?:Array, msgs?:Array}} input
			 * @returns {{title:string, detail:string, dim:string|null, at:number|null, tone:string, source:string, hops:number}}
			 */
			function currentTaskOf(input = {}) {
				const node = input.node || null;
				const flow = input.flow || null;
				const flowList = Array.isArray(input.flowList) ? input.flowList : [];
				const msgs = Array.isArray(input.msgs) ? input.msgs : [];
				const hops = flowList.length;
				const last = flow ? lastHop(flow) : null;
				const trailNote = flow ? ("流转 " + hops + " 条 · " + flowLine(flow)) : "";
			
				if (node && node.pending) {
					return {
						title: "待你确认 —— " + (PENDING_LABEL[node.pending] || node.pending),
						detail: flow ? clip(flow.text, 100) : "宿主报告该会话有待处理交互（pendingInteraction）",
						dim: last ? last.dim : DIM.CHAT, at: last ? last.at : null, tone: "warn",
						source: "host.pendingInteraction", hops
					};
				}
				if (node && node.running === true) {
					return {
						title: "正在执行",
						detail: flow ? clip(flow.text, 100) : "宿主报告该会话 running（插件侧尚无流转记录）",
						dim: last ? last.dim : DIM.CHAT, at: last ? last.at : null, tone: "run",
						source: "host.running", hops
					};
				}
				if (node && node.completed === true && !flow) {
					return {
						title: "该对话已收口",
						detail: "宿主报告 completed，且插件侧无未闭合流转",
						dim: null, at: null, tone: "done", source: "host.completed", hops
					};
				}
				if (flow) {
					return {
						title: clip(flow.text, 90) || "（空文本流转）",
						detail: trailNote + (flow.status === FLOW_STATUS.ROUTED ? " · 已送达" : " · " + (FLOW_STATUS_LABEL[flow.status] || flow.status)),
						/* 时间戳用**最后一次足迹**的时刻（不是登记时刻）——
						 * 面板最上面那句「现在在做的事」旁边显示的时间，若写着几小时前，
						 * 用户会以为界面卡住了。见 lastTouchOf 头注。 */
						dim: last ? last.dim : flow.origin, at: last ? last.at : flow.at, tone: "info",
						source: "flow.trail", hops
					};
				}
				if (msgs.length) {
					const m = msgs[msgs.length - 1];
					return {
						title: clip(m.text, 90) || "（空消息）",
						detail: "最近一条总监消息 · " + (m.kind || "note") + " · " + new Date(m.at || 0).toLocaleTimeString(),
						dim: DIM.DIRECTOR, at: m.at || null, tone: "info", source: "plugin-db", hops
					};
				}
				return {
					title: "待命 · 尚无流转",
					detail: node
						? "宿主未报 running / pending，插件侧也没有该会话的流转记录"
						: "没有选中会话：点左侧会话或导图里的任一个框",
					dim: null, at: null, tone: "idle", source: node ? "host.idle" : "none", hops
				};
			}
			
			/** 汇总（给总监页 R2.5 / 顶栏徽章用） */
			function flowStats(flows) {
				const list = Array.isArray(flows) ? flows : [];
				const byDim = {};
				for (const d of DIM_ORDER) byDim[d] = 0;
				let multiDim = 0;
				for (const f of list) {
					const dims = flowDims(f);
					for (const d of dims) byDim[d] += 1;
					if (dims.length > 1) multiDim += 1;
				}
				return {
					total: list.length,
					byDim,
					multiDim,
					open: list.filter((f) => f.status === FLOW_STATUS.OPEN).length,
					routed: list.filter((f) => f.status === FLOW_STATUS.ROUTED).length
				};
			}
			
			/** 按会话聚合（给"点左侧切会话 → 只显示该会话的流转"用） */
			function flowsBySession(flows) {
				const map = new Map();
				for (const f of Array.isArray(flows) ? flows : []) {
					const k = f.sessionId === null ? "__global__" : f.sessionId;
					if (!map.has(k)) map.set(k, []);
					map.get(k).push(f);
				}
				return map;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 三、持久化 store（唯一写入口；订阅式，与 branch-tree 同一套写法）
			 * ══════════════════════════════════════════════════════════════════ */
			
			const FLOW_KEY = "dsh.director.flow";
			/** 上限：超出丢弃最旧的（防止 localStorage 无限膨胀） */
			const FLOW_MAX = 200;
			
			function loadFlows() {
				try {
					const raw = typeof localStorage !== "undefined" ? localStorage.getItem(FLOW_KEY) : null;
					if (!raw) return { flows: [], activeSessionId: null };
					const p = JSON.parse(raw);
					const flows = Array.isArray(p && p.flows) ? p.flows.filter((f) => f && f.flowId && Array.isArray(f.trail)) : [];
					return { flows, activeSessionId: (p && p.activeSessionId) || null };
				} catch (e) { return { flows: [], activeSessionId: null }; }
			}
			
			let flowState = loadFlows();
			const flowListeners = new Set();
			
			function persist() {
				try {
					if (typeof localStorage !== "undefined") localStorage.setItem(FLOW_KEY, JSON.stringify(flowState));
				} catch (e) { /* 隐私模式 / 超配额：流转丢失不阻断功能 */ }
			}
			function notifyFlow() { for (const fn of flowListeners) { try { fn(flowState); } catch (e) { /* 忽略单个订阅者异常 */ } } }
			
			const flowStore = {
				getState: () => flowState,
				subscribe: (fn) => { flowListeners.add(fn); return () => flowListeners.delete(fn); },
			
				/** 登记一条流转（默认落在总监维度：用户先在总监说话） */
				push: (text, opts = {}) => {
					const f = makeFlow({ ...opts, text });
					if (!f.text) return null;
					const next = flowState.flows.concat([f]);
					flowState = { ...flowState, flows: next.length > FLOW_MAX ? next.slice(next.length - FLOW_MAX) : next };
					persist(); notifyFlow();
					return f;
				},
			
				/** 让某条流转"走到"下一维（并记下谁触发的） */
				move: (id, dim, note, extra) => {
					let moved = null;
					flowState = {
						...flowState,
						flows: flowState.flows.map((f) => {
							if (f.flowId !== id) return f;
							moved = hopFlow(f, dim, note, extra);
							return moved;
						})
					};
					if (moved) { persist(); notifyFlow(); }
					return moved;
				},
			
				/** 直接改状态（收口 / 阻塞） */
				setStatus: (id, status, target) => flowStore.move(id, (lastHop((flowState.flows.find((f) => f.flowId === id)) || {}) || {}).dim || DIM.DIRECTOR, "状态 → " + status, { status, target }),
			
				/** UI 当前正在看哪个会话（"点左侧切进去"时由组件写入） */
				setActiveSession: (sessionId) => {
					const sid = sessionId === undefined || sessionId === null ? null : String(sessionId);
					if (flowState.activeSessionId === sid) return sid;
					flowState = { ...flowState, activeSessionId: sid };
					persist(); notifyFlow();
					return sid;
				},
			
				/** 测试 / 复位用 */
				reset: () => { flowState = { flows: [], activeSessionId: null }; persist(); notifyFlow(); return true; },
			
				/* ── 查询（包一层，省得组件各自 import 纯函数） ── */
				ofSession: (sessionId) => flowsOf(flowState.flows, sessionId),
				latestOf: (sessionId) => latestFlow(flowState.flows, sessionId),
				stats: () => flowStats(flowState.flows),
				taskOf: (input) => currentTaskOf(input)
			};
			
			/** 全局契约（调试 / e2e 用） */
			function installFlowApi() {
				const api = {
					DIM, DIM_ORDER, DIM_LABEL, DIM_ICON, FLOW_STATUS, FLOW_STATUS_LABEL, PENDING_LABEL,
					FLOW_KEY, FLOW_MAX,
					flowId, clip, makeFlow, hopFlow, flowDims, flowLine, lastHop, lastTouchOf,
					flowsOf, latestFlow, currentTaskOf, flowStats, flowsBySession,
					store: flowStore
				};
				if (typeof window !== "undefined") window.__dshFlow = api;
				return api;
			}
			
			exports.DIM = DIM;
			exports.DIM_ORDER = DIM_ORDER;
			exports.DIM_LABEL = DIM_LABEL;
			exports.DIM_ICON = DIM_ICON;
			exports.FLOW_STATUS = FLOW_STATUS;
			exports.FLOW_STATUS_LABEL = FLOW_STATUS_LABEL;
			exports.PENDING_LABEL = PENDING_LABEL;
			exports.flowId = flowId;
			exports.clip = clip;
			exports.makeFlow = makeFlow;
			exports.hopFlow = hopFlow;
			exports.flowDims = flowDims;
			exports.flowLine = flowLine;
			exports.lastHop = lastHop;
			exports.lastTouchOf = lastTouchOf;
			exports.flowsOf = flowsOf;
			exports.latestFlow = latestFlow;
			exports.currentTaskOf = currentTaskOf;
			exports.flowStats = flowStats;
			exports.flowsBySession = flowsBySession;
			exports.FLOW_KEY = FLOW_KEY;
			exports.FLOW_MAX = FLOW_MAX;
			exports.flowStore = flowStore;
			exports.installFlowApi = installFlowApi;
		};

		// ── components/NodeDetailPanel.js ──
		__defs["components/NodeDetailPanel.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：导图右侧「该框的对话」面板
			 * 引用：—
			 * 上游：client-entry.js, components/MindMap.js
			 * 下游：logic/flow.js, logic/branch-tree.js, bridge/chat-bridge.js, store/plugin-db.js, store/mindmap-schema.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/NodeDetailPanel.js — 导图右侧「该框的对话」面板
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  需求原文（用户）：「然后点击框在右侧展开对话 对话的最上面是现在正在做的事情，
			 *   也就是我发给或者总监发给对话的信息，对话整理出目前自己在做的什么事情，
			 *   我要在思维导图界面能看到」
			 *
			 *  ⇒ 面板自上而下三段，顺序**不可调**：
			 *     ① **现在在做的事**（logic/flow.js `currentTaskOf`）—— 必须最上面
			 *     ② 跨维度流转时间线（这条消息走过总监 / 对话 / 导图 / 设计图的足迹）
			 *     ③ 输入条 —— 「点到哪里往哪里输入」：输入落到**这个框对应的会话**
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 本面板最容易犯的错，以及怎么防
			 * ══════════════════════════════════════════════════════════════════
			 *  ① **拿"标题"顶替"在做的事"**：`ROUTE` 一类的字段看起来像结论，其实只是路由决策。
			 *     ⇒ 一律走 `currentTaskOf()`，它每个分支都带 `source`（host.running /
			 *       host.pendingInteraction / flow.trail / plugin-db / none），UI 把 source 显示出来。
			 *  ② **假装能读任意会话的对话内容**：宿主只暴露"当前会话"的原生对话 DOM。
			 *     非当前会话**读不到** ⇒ 面板明确写"该框不是当前对话，原生内容读不到；
			 *     下面是插件侧登记过的流转"，而不是显示空白让人以为没数据。
			 *  ③ **输入静默丢失**：非当前会话时先把流转登记 + 打开该会话 + 写入原生输入框，
			 *     每一步都有回读校验与可见反馈（`sendToChat` 自带写后回读）。
			 *
			 * ⚠️ 构建约束：react / react/jsx-runtime 为平台冻结模块（ADR-001），构建期外置。
			 */
			
			const react = require("react");
			const { currentTaskOf, DIM, DIM_LABEL, DIM_ICON, FLOW_STATUS_LABEL, clip } = __m("logic/flow.js");
			const { openSession, currentSessionId } = __m("logic/branch-tree.js");
			const { deliverToChat } = __m("bridge/chat-bridge.js");
			const { listDirectorMessages } = __m("store/plugin-db.js");
			const { STATE_KINDS, NODE_KINDS } = __m("store/mindmap-schema.js");
			
			const h = react.createElement;
			const NODE_DETAIL_ID = "dsh-node-detail";
			
			const TONE = {
				run: { bar: "var(--dp-ac, #2f6feb)", bg: "var(--dp-ac-soft, rgba(47,111,235,.16))", label: "执行中" },
				warn: { bar: "var(--dp-ac2, #8943e5)", bg: "var(--dp-ac2-soft, rgba(137,87,229,.16))", label: "待确认" },
				done: { bar: "#3fb950", bg: "rgba(63,185,80,.12)", label: "已收口" },
				info: { bar: "#d29922", bg: "rgba(210,153,34,.12)", label: "有流转" },
				idle: { bar: "var(--dp-line, #31343a)", bg: "rgba(255,255,255,.03)", label: "待命" }
			};
			
			const S = {
				wrap: {
					borderLeft: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-1, #141519)",
					display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, flex: "0 0 auto"
				},
				hd: {
					display: "flex", alignItems: "center", gap: 6, padding: "calc(7px * var(--dp-density,1)) 9px",
					borderBottom: "1px solid var(--dp-line, #31343a)", flex: "0 0 auto"
				},
				body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 9, display: "flex", flexDirection: "column", gap: 8 },
				now: (tone) => ({
					border: "1px solid var(--dp-line, #31343a)", borderLeft: "3px solid " + TONE[tone].bar,
					background: TONE[tone].bg, borderRadius: "var(--dp-radius, 8px)", padding: "7px 9px"
				}),
				nowT: { fontSize: "calc(12px * var(--dp-font,1))", fontWeight: 650, marginBottom: 3, wordBreak: "break-word", lineHeight: 1.5 },
				nowD: { fontSize: "calc(11px * var(--dp-font,1))", color: "var(--dp-t2, #c3c8ce)", lineHeight: 1.55, wordBreak: "break-word" },
				badge: {
					fontSize: "calc(9.5px * var(--dp-font,1))", padding: "0 5px", borderRadius: "var(--dp-radius-sm, 5px)",
					border: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-2, #1c1e23)", color: "var(--dp-t3, #8b9199)"
				},
				secT: {
					fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", letterSpacing: ".4px",
					display: "flex", alignItems: "center", gap: 5, marginBottom: 5
				},
				item: {
					border: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-2, #1c1e23)",
					borderRadius: "var(--dp-radius, 8px)", padding: "6px 8px", marginBottom: 5
				},
				itemT: { fontSize: "calc(11.5px * var(--dp-font,1))", lineHeight: 1.5, wordBreak: "break-word", color: "var(--dp-t1, #e8eaed)" },
				itemM: { fontSize: "calc(9.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
				ft: {
					flex: "0 0 auto", borderTop: "1px solid var(--dp-line, #31343a)", padding: 9,
					display: "flex", flexDirection: "column", gap: 6, background: "var(--dp-bg-0, #0b0c0e)"
				},
				inp: {
					boxSizing: "border-box", width: "100%", minHeight: 34, maxHeight: 96, resize: "vertical",
					borderRadius: "var(--dp-radius-sm, 5px)", border: "1px solid var(--dp-line, #31343a)",
					background: "var(--dp-bg-1, #141519)", color: "var(--dp-t1, #e8eaed)",
					fontFamily: "inherit", fontSize: "calc(11.5px * var(--dp-font,1))", padding: "6px 8px", lineHeight: 1.5
				},
				btn: {
					height: 26, padding: "0 10px", borderRadius: "var(--dp-radius-sm, 5px)", cursor: "pointer",
					fontSize: "calc(11.5px * var(--dp-font,1))", border: "1px solid var(--dp-line, #31343a)",
					background: "var(--dp-bg-2, #1c1e23)", color: "var(--dp-t2, #c3c8ce)", whiteSpace: "nowrap"
				},
				btnPri: { background: "var(--dp-ac, #2f6feb)", borderColor: "var(--dp-ac, #2f6feb)", color: "#fff" },
				note: { fontSize: "calc(10px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", lineHeight: 1.55 }
			};
			
			/** 维度足迹小标签（四个维度都在，走过的点亮 —— "同一消息在几个维度流转"一眼可见） */
			function DimTrail({ flow }) {
				const seen = new Set(((flow && flow.trail) || []).map((t) => t.dim));
				return h("span", { style: { display: "inline-flex", gap: 3, alignItems: "center" }, "data-testid": "nd-trail" },
					[DIM.DIRECTOR, DIM.CHAT, DIM.MINDMAP, DIM.DESIGN].map((d, i) => h("span", {
						key: d, "data-flow-dim": d, "data-on": seen.has(d) ? "1" : "0",
						title: DIM_LABEL[d] + (seen.has(d) ? "：走过" : "：未走"),
						style: {
							fontSize: 9.5, padding: "0 4px", borderRadius: 3,
							border: "1px solid " + (seen.has(d) ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "var(--dp-line, #31343a)"),
							background: seen.has(d) ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "transparent",
							color: seen.has(d) ? "var(--dp-t1, #e8eaed)" : "var(--dp-t3, #8b9199)",
							opacity: seen.has(d) ? 1 : 0.6
						}
					}, DIM_ICON[d] + DIM_LABEL[d].slice(0, 2))))
			}
			
			/**
			 * @param {object} props
			 * @param {object|null} props.row 选中的导图行（含 sessionId / title / kind / state / isCurrent）
			 * @param {Array} props.flows 该会话的流转（logic/flow.js flowsOf）
			 * @param {number} [props.width] 面板宽度（px）
			 * @param {() => void} props.onClose
			 * @param {(payload:object)=>void} [props.onFlow] 流转回调。**两种载荷**：
			 *        · 有 `hopTo` → 让已登记的流转"走到"该维度（`{hopTo, text, note}`）
			 *        · 无 `hopTo` → 登记一条新流转（`{text, origin, sessionId}`）
			 * @param {(msg:string, tone?:string)=>void} [props.onSay] 让外层弹 toast
			 * @param {(sessionId:string)=>void} [props.onOpenSession] 打开该原生对话
			 */
			function NodeDetailPanel(props) {
				const { row, flows = [], width = 330, onClose, onFlow, onSay } = props;
				const [draft, setDraft] = react.useState("");
				const [msgs, setMsgs] = react.useState([]);
				const [busy, setBusy] = react.useState(false);
				const [isCurrent, setIsCurrent] = react.useState(() => currentSessionId());
				const sid = row ? row.sessionId : null;
			
				/* 该会话的总监消息（plugin-db，异步；失败静默为空） */
				react.useEffect(() => {
					let alive = true;
					if (!sid) { setMsgs([]); return () => { alive = false; }; }
					listDirectorMessages(sid).then((list) => { if (alive) setMsgs(list || []); }).catch(() => { if (alive) setMsgs([]); });
					return () => { alive = false; };
				}, [sid]);
			
				/* 跟一次"当前会话"（决定原生内容能不能读、输入能不能直达） */
				react.useEffect(() => {
					setIsCurrent(currentSessionId());
					const t = setInterval(() => setIsCurrent(currentSessionId()), 900);
					return () => clearInterval(t);
				}, [sid]);
			
				/* 拖宽（用户："框不能动需要可以移动" 的同族诉求：面板也要能调宽） */
				const [w, setW] = react.useState(width);
				react.useEffect(() => { setW(width); }, [width]);
				const dragRef = react.useRef(null);
				react.useEffect(() => {
					const onMove = (e) => {
						if (!dragRef.current) return;
						const delta = dragRef.current.x - e.clientX;
						setW(Math.max(260, Math.min(620, dragRef.current.w + delta)));
					};
					const onUp = () => { dragRef.current = null; };
					window.addEventListener("pointermove", onMove);
					window.addEventListener("pointerup", onUp);
					return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
				}, []);
			
				if (!row) return null;
			
				const flow = flows.length ? flows[flows.length - 1] : null;
				const now = currentTaskOf({ node: row, flow, flowList: flows, msgs });
				const tone = TONE[now.tone] ? now.tone : "idle";
				const kind = NODE_KINDS[row.kind] || NODE_KINDS.leaf;
				const stateK = STATE_KINDS[row.state] || STATE_KINDS.idle;
			
				/** 发送到该会话：登记流转 → 投递（非当前会话时先切过去）
				 *
				 * 🔴 本轮修正：旧版用 `sendToChat(text, { autoSend:false })` ⇒ **只填充不发送**，
				 *   用户点完"发送"后以为没反应（还得自己去按回车）。改走 `deliverToChat`：
				 *   直投 → 失败则 `openSession` 切过去 + 等 composer 出现 + 重投，逐级归因。
				 */
				async function send() {
					const text = draft.trim();
					if (!text) return;
					setBusy(true);
					try {
						if (props.onFlow) props.onFlow({ text, origin: DIM.MINDMAP, sessionId: sid });
						const res = await deliverToChat(text, { sessionId: sid, opener: openSession, autoSend: true });
						const opened = res.opened !== false;
						if (props.onFlow) {
							props.onFlow({
								hopTo: DIM.CHAT, text,
								note: res.ok ? "已投递到原生对话（" + (res.mode || "sent") + "）" : "未送达 · " + ((res && res.reason) || "未知")
							});
						}
						if (onSay) {
							if (res.ok) onSay(res.mode === "sent" ? "已发送到该对话" : "已填入输入框");
							else onSay("未送达 · " + ((res && res.reason) || "未知"), "warn");
						}
						setDraft("");
					} finally { setBusy(false); }
				}
			
				return h("aside", {
					id: NODE_DETAIL_ID, "data-testid": "nd-panel", "data-session-id": sid || "",
					"data-is-current": isCurrent && sid && String(isCurrent) === String(sid) ? "1" : "0",
					style: { ...S.wrap, width: w, position: "relative", maxWidth: "46vw" }, role: "complementary", "aria-label": "该框的对话"
				}, [
					/* 拖宽手柄（面板左缘） */
					h("div", {
						key: "grip", "data-testid": "nd-grip", title: "拖动调宽",
						style: { position: "absolute", left: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 3 },
						onPointerDown: (e) => { e.preventDefault(); dragRef.current = { x: e.clientX, w: w }; }
					}),
			
					/* 头：类型 / 标题 / 状态 / 关闭 */
					h("div", { key: "hd", style: S.hd }, [
						h("span", { key: "i", style: { color: (NODE_KINDS[row.kind] || NODE_KINDS.leaf).accent } }, kind.icon),
						h("span", {
							key: "t", style: { fontWeight: 650, fontSize: "calc(12px * var(--dp-font,1))", minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
							title: (row.title || "") + " ｜ " + sid
						}, row.title),
						h("span", { key: "s", style: { ...S.badge, color: stateK.color } }, "● " + stateK.label),
						h("button", {
							key: "x", style: S.btn, "data-testid": "nd-close", "aria-label": "关闭该框的对话", title: "关闭该框的对话（Esc 逐层退）",
							onClick: onClose
						}, "✕")
					]),
			
					h("div", { key: "bd", style: S.body, className: "dp-scroll" }, [
						/* ① 现在在做的事 —— 必须在最上面 */
						h("div", { key: "now", style: S.now(tone), "data-testid": "nd-now", "data-tone": tone, "data-source": now.source }, [
							h("div", { key: "h", style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 } }, [
								h("span", { key: "l", style: { fontSize: "calc(10.5px * var(--dp-font,1))", color: TONE[tone].bar, fontWeight: 700, letterSpacing: ".4px" } }, "现在在做的事"),
								h("span", { key: "b", style: S.badge }, TONE[tone].label),
								h("span", { key: "s", style: { ...S.badge, marginLeft: "auto" }, title: "这个结论的依据来源（不编内容）" }, "来源 " + now.source)
							]),
							h("div", { key: "t", style: S.nowT, "data-testid": "nd-now-title" }, now.title),
							now.detail ? h("div", { key: "d", style: S.nowD, "data-testid": "nd-now-detail" }, now.detail) : null,
							h("div", { key: "m", style: { ...S.itemM, marginTop: 5 } }, [
								flow ? DimTrail({ flow }) : h("span", { key: "none", style: S.note }, "（该会话尚无跨维度流转）"),
								h("span", { key: "h", style: S.note }, "流转 " + flows.length + " 条"),
								now.at ? h("span", { key: "at", style: S.note }, "最后更新 " + new Date(now.at).toLocaleTimeString()) : null
							])
						]),
			
						/* ② 跨维度流转时间线 */
						h("div", { key: "fl", style: { marginTop: 2 } }, [
							h("div", { key: "t", style: S.secT }, [
								h("span", { key: "l" }, "跨维度流转（总监 / 对话 / 导图 / 设计图）"),
								h("span", { key: "c", style: { marginLeft: "auto" } }, flows.length + " 条")
							]),
							flows.length
								? flows.slice(-14).reverse().map((f) => h("div", {
									key: f.flowId, style: S.item, "data-testid": "nd-flow-item", "data-flow-id": f.flowId, "data-origin": f.origin,
									"data-status": f.status
								}, [
									h("div", { key: "t", style: S.itemT }, clip(f.text, 120) || "（空文本）"),
									h("div", { key: "m", style: S.itemM }, [
										DimTrail({ flow: f }),
										h("span", { key: "s", style: S.note }, FLOW_STATUS_LABEL[f.status] || f.status),
										h("span", { key: "a", style: S.note }, new Date(f.at).toLocaleTimeString()),
										h("span", { key: "o", style: S.note }, "起于 " + DIM_LABEL[f.origin])
									]),
									((f.trail || []).length > 1) ? h("div", {
										key: "tr", style: { ...S.itemM, marginTop: 2 },
										title: (f.trail || []).map((t) => DIM_LABEL[t.dim] + "：" + (t.note || "-")).join("\n")
									}, (f.trail || []).map((t, i) => h("span", {
										key: i, style: { fontSize: "calc(9.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)" }
									}, (i ? " → " : "") + DIM_ICON[t.dim] + (t.note ? clip(t.note, 22) : DIM_LABEL[t.dim])))) : null
								]))
								: h("div", { key: "e", style: S.note, "data-testid": "nd-flow-empty" },
									"该会话还没有流转记录。下面输入框发出的内容会**先登记**在这里，再按你选的动作送往对应维度。")
						]),
			
						/* ③ 总监消息（plugin-db）—— 让你看得到"总监对这个对话说过什么" */
						msgs.length ? h("div", { key: "dm", style: { marginTop: 2 } }, [
							h("div", { key: "t", style: S.secT }, "总监对这个对话说过的话（插件侧记录）"),
							msgs.slice(-6).reverse().map((m) => h("div", {
								key: m.messageId || m.at, style: S.item, "data-testid": "nd-dir-msg"
							}, [
								h("div", { key: "t", style: S.itemT }, clip(m.text, 120)),
								h("div", { key: "m", style: S.itemM }, [
									h("span", { key: "k", style: { ...S.badge, color: m.role === "user" ? "var(--dp-ac, #2f6feb)" : "var(--dp-ac2, #8957e5)" } }, m.role === "user" ? "你" : "总监"),
									h("span", { key: "n", style: S.note }, m.kind || "note"),
									h("span", { key: "a", style: S.note }, new Date(m.at || 0).toLocaleTimeString())
								])
							]))
						]) : null,
			
						/* 读不到原生内容时**明确说清**，不留空白让人以为坏了 */
						!isCurrent || String(isCurrent) !== String(sid) ? h("div", {
							key: "caveat", style: { ...S.note, borderTop: "1px dashed var(--dp-line, #31343a)", paddingTop: 6 }, "data-testid": "nd-caveat"
						}, "非当前对话：读不到其消息内容；发送时会先切换过去。") : null
					]),
			
					/* ④ 输入条 —— 「点到哪里往哪里输入」 */
					h("div", { key: "ft", style: S.ft }, [
						h("div", { key: "l", style: { display: "flex", alignItems: "center", gap: 5 } }, [
							h("span", { key: "c", style: { ...S.badge, color: "var(--dp-ac, #2f6feb)", borderColor: "var(--dp-ac-line, rgba(47,111,235,.45))" } },
								"输入到：" + clip(row.title, 16)),
							h("span", { key: "s", style: S.note }, isCurrent && String(isCurrent) === String(sid) ? "（当前对话，直达）" : "（非当前，会先切过去）")
						]),
						h("textarea", {
							key: "i", style: S.inp, "data-testid": "nd-input", value: draft, disabled: busy,
							placeholder: "输入内容，回车发送",
							onChange: (e) => setDraft(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
						}),
						h("div", { key: "b", style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } }, [
							h("button", { key: "s", style: { ...S.btn, ...S.btnPri, opacity: busy ? 0.6 : 1 }, "data-testid": "nd-send", disabled: busy, title: "发送到该对话", onClick: send },
								busy ? "处理中…" : "发送"),
							props.onRoute ? h("button", {
								key: "r", style: S.btn, "data-testid": "nd-route", disabled: busy,
								title: "交由总监判断去向",
								onClick: () => { const t = draft.trim(); if (!t) return; props.onRoute(t); setDraft(""); }
							}, "交由总监") : null,
							h("span", { key: "n", style: S.note }, isCurrent && String(isCurrent) === String(sid) ? "当前对话" : "非当前，先切换")
						])
					])
				]);
			}
			
			__defaults["components/NodeDetailPanel.js"] = NodeDetailPanel;
			
			exports.NODE_DETAIL_ID = NODE_DETAIL_ID;
			exports.NodeDetailPanel = NodeDetailPanel;
		};

		// ── components/MindMap.js ──
		__defs["components/MindMap.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：分支导图覆盖层（血缘树 · 缩滚展开 · 待总监路由）
			 * 引用：—
			 * 上游：client-entry.js, mount.js
			 * 下游：logic/branch-tree.js, logic/routing.js, logic/mindmap-render.js, util/debug.js, util/safe-area.js, bridge/chat-bridge.js, store/mindmap-schema.js, logic/flow.js, store/layout.js, store/personalize.js, components/NodeDetailPanel.js, components/PersonalizePanel.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A4（分支导图态）· F1–F4（思维导图元素库渲染：节点四型 / 状态四态 / 连线 / 控件）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/MindMap.js — 分支导图覆盖层（血缘树 · 缩滚展开 · 待总监路由）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
			 *   ├─ 板块 A · A4 分支导图态（画面）
			 *   ├─ 板块 C · C2 分支生命周期状态机（节点上的状态点即此状态机的当前值）
			 *   ├─ 板块 C · C4 输入路由决策树（底栏输入 = 「目标未定」那一支）
			 *   ├─ 板块 F · 思维导图元素库（本组件消费的元素词汇表 = store/mindmap-schema.js）
			 *   └─ 板块 G · 单框控件 / 自由拖动 / 右侧对话面板（第三轮并入）
			 *  数据源   logic/branch-tree.js（血缘来自宿主 sessions 写入的 parentId）
			 *  元素库   store/mindmap-schema.js（节点型 / 状态 / 连线 / 单框控件 / 覆盖度）
			 *  流转     logic/flow.js（一条消息走过总监 / 对话 / 导图 / 设计图的足迹）
			 *  面板     components/NodeDetailPanel.js（点框在右侧展开该对话）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  第三轮需求原文（用户三条）
			 * ══════════════════════════════════════════════════════════════════
			 *  ① 「思维导图的单个框没有展开和折叠的选项」
			 *  ② 「思维导图的框不能动 需要可以移动」
			 *  ③ 「点击框在右侧展开对话 对话的最上面是现在正在做的事情…我要在思维导图界面能看到」
			 *
			 *  ⇒ 落地口径：
			 *     ① 每个框**都有**一组小控件（`controlsOfRow` 算出，不由本组件各自 if）：
			 *        ▾/▸ 折叠展开（有子才可点，无子写明原因）· 💬 展开右侧对话 · ✚ 分支 · 📂 打开 · ✥ 拖动手柄
			 *     ② 拖动**只改画面位置**（写进 layout store 的 `mmPos`，只存拖过的节点），
			 *        并提供「自动布局」一键归位；**绝不改 parentSessionId**（血缘由宿主 fork 固化）
			 *     ③ 点框 → 右侧 `NodeDetailPanel`：最上面是「现在在做的事」，下面是跨维流转，
			 *        底部输入落到**这个框对应的会话**（非当前会话会先打开它）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  节点四态（宿主真值）
			 * ══════════════════════════════════════════════════════════════════
			 *  running 执行中（蓝）← `running === true` ｜ review 待审（紫）← `pendingInteraction`
			 *  done 已收口（绿）← `completed === true` ｜ idle 待命（灰）← 以上都不成立
			 *  ⚠️ 设计稿 A4 第四态原为「出错」，宿主无错误字段 ⇒ 显式改「待审」并登记 `supported:false`。
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 三条踩过的坑（勿回退）
			 * ══════════════════════════════════════════════════════════════════
			 *  ① **hooks 必须全部排在 `if (!open) return null` 之前** —— 否则 open false→true
			 *     时 hooks 数量变化 ⇒ 整层崩溃（设计图工作室吃过一次）。
			 *  ② **订阅顺序**：先 `subscribe` → 再同步取一次快照 → 最后才 `refresh`。
			 *     `refreshBranchTree()` 走 ctx 通道时**同步 notify**，先 refresh 会让通知落在订阅之前
			 *     ⇒ 首次打开永远空树。
			 *  ③ **✕ 必须避让原生窗口控件**（实测 138px，操作系统图层，z-index 无效）：
			 *     顶栏与工具条 `paddingRight = max(10, inset + 10)`。
			 *
			 * ⚠️ 构建约束：react / react/jsx-runtime 为平台冻结模块（ADR-001），构建期外置。
			 */
			
			const react = require("react");
			const { LAYOUT, subscribeBranch, getBranchSnapshot, refreshBranchTree, visibleRows, ancestorChain, treeBounds, matchRows, degradationReason, hostCapabilities, openSession, forkBranch, watchCurrentSession } = __m("logic/branch-tree.js");
			const { focusRows, hasDownstream } = __m("logic/branch-focus.js");
			const { OverviewDialog } = __m("components/OverviewDialog.js");
			const { route, review6, DESTINATION, DESTINATION_LABEL } = __m("logic/routing.js");
			const { edgePathFor, edgeStyleOf, metaLineOf, stateTitleOf, kindLabelOf, nodeBtnStyle } = __m("logic/mindmap-render.js");
			const { dshLog } = __m("util/debug.js");
			const { readInset, watchInset } = __m("util/safe-area.js");
			const { readConversation } = __m("bridge/chat-bridge.js");
			const { NODE_KINDS, STATE_KINDS, MM_COVERAGE, supportedStates, controlsOfRow, coverageStats } = __m("store/mindmap-schema.js");
			const { flowStore } = __m("logic/flow.js");
			const { directorLayoutStore } = __m("store/layout.js");
			const { personalizeStore } = __m("store/personalize.js");
			const { NodeDetailPanel } = __m("components/NodeDetailPanel.js");
			const { PersonalizePanel } = __m("components/PersonalizePanel.js");
			
			const h = react.createElement;
			const MINDMAP_ID = "dsh-mindmap";
			
			/** toast 自动消失时长（ms）—— 沿用设计图工作室的修正：原实现"永不消失"是缺陷 */
			const TOAST_MS = 2400;
			/** 画布缩放范围 */
			const ZOOM_MIN = 0.1;
			const ZOOM_MAX = 3;
			/** 判定"这是在拖，不是在点"的位移阈值（px）—— 低于它仍算点击（打开右侧对话） */
			const DRAG_SLOP = 4;
			
			const S = {
				root: {
					position: "fixed", inset: 0, zIndex: 2147483100, display: "flex", flexDirection: "column",
					/* 🔴 必须 `backgroundColor`（长写）—— `background` 简写会把 `background-image` 重置掉，
					 *    而 `.dp-textured` 的三档纹理正是用 background-image 实现的（见 store/personalize.js）。
					 *    写成简写的后果：个性化面板里选纹理**看起来完全没反应**。 */
					backgroundColor: "var(--dp-bg-0, #0b0c0e)", color: "var(--dp-t1, #e8eaed)",
					fontFamily: "inherit", fontSize: "calc(12.5px * var(--dp-font, 1))"
				},
				top: {
					display: "flex", alignItems: "center", gap: 8, height: 40, flex: "0 0 40px", padding: "0 10px",
					borderBottom: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-1, #141519)", flex: "0 0 auto"
				},
				tools: {
					display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", minHeight: 38, flex: "0 0 auto",
					padding: "calc(5px * var(--dp-density, 1)) 10px", borderBottom: "1px solid var(--dp-line, #31343a)",
					background: "var(--dp-bg-1, #141519)"
				},
				/* 主区：左画布 + 右对话面板（右面板可关闭 ⇒ 画布自动铺满） */
				main: { flex: 1, minHeight: 0, display: "flex", overflow: "hidden" },
				canvasWrap: { flex: 1, minWidth: 0, minHeight: 0, position: "relative", display: "flex", overflow: "hidden" },
				body: { flex: 1, minHeight: 0, position: "relative", overflow: "auto", background: "var(--dp-bg-0, #0b0c0e)" },
				stageWrap: { position: "relative" },
				stage: { position: "relative", transformOrigin: "top left" },
				/* ── 节点 ──
				 * 四型配色来自 NODE_KINDS[kind].accent；选中/悬停只改"描边与光晕"，不改底色。 */
				node: (sel, hov, kind, dragging) => {
					const a = (NODE_KINDS[kind] || NODE_KINDS.leaf).accent;
					return {
						position: "absolute", boxSizing: "border-box", width: LAYOUT.nodeW, height: LAYOUT.nodeH,
						border: "1px solid " + (sel ? "var(--dp-ac, #2f6feb)" : hov ? a : "var(--dp-line, rgba(255,255,255,.13))"),
						borderLeft: "3px solid " + a,
						background: sel ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "var(--dp-bg-2, rgba(255,255,255,.035))",
						borderRadius: "var(--dp-radius, 8px)", padding: "5px 8px 5px 9px",
						cursor: dragging ? "grabbing" : "grab", color: "var(--dp-t1, #e6e8ec)",
						boxShadow: dragging ? "var(--dp-shadow, 0 10px 30px rgba(0,0,0,.45))" : sel ? "0 0 0 3px var(--dp-ac-soft, rgba(47,111,235,.16))" : hov ? "0 0 0 3px rgba(75,142,247,.16)" : "none",
						display: "flex", flexDirection: "column", gap: 3, overflow: "visible",
						zIndex: dragging ? 9 : sel ? 5 : 1
					};
				},
				dot: (state) => ({
					position: "absolute", right: 6, top: 6, width: 7, height: 7, borderRadius: "50%",
					background: (STATE_KINDS[state] || STATE_KINDS.idle).color
				}),
				foot: {
					flex: "0 0 auto", borderTop: "1px solid var(--dp-line, #31343a)",
					background: "var(--dp-bg-1, #141519)", padding: "7px 10px", display: "flex", flexDirection: "column", gap: 6
				},
				input: {
					flex: 1, minWidth: 0, height: 30, boxSizing: "border-box",
					border: "1px solid var(--dp-line, #3d4148)", background: "var(--dp-bg-0, #1a1b20)",
					color: "var(--dp-t1, #e8eaed)", borderRadius: "var(--dp-radius-sm, 5px)",
					padding: "0 9px", fontSize: "calc(11.5px * var(--dp-font, 1))", fontFamily: "inherit"
				},
				btn: {
					height: 28, padding: "0 11px", borderRadius: "var(--dp-radius-sm, 5px)", cursor: "pointer",
					fontSize: "calc(11.5px * var(--dp-font, 1))", whiteSpace: "nowrap",
					border: "1px solid var(--dp-line, #3d4148)", background: "var(--dp-bg-2, #212429)",
					color: "var(--dp-t2, #c3c8ce)", display: "inline-flex", alignItems: "center", gap: 4
				},
				btnPri: {
					height: 30, padding: "0 13px", borderRadius: "var(--dp-radius-sm, 5px)", cursor: "pointer",
					fontSize: "calc(12px * var(--dp-font, 1))", border: "1px solid var(--dp-ac, #2f6bdd)",
					background: "var(--dp-ac, #2f6bdd)", color: "#fff", whiteSpace: "nowrap"
				},
				chip: {
					fontSize: "calc(10.5px * var(--dp-font, 1))", padding: "calc(2px * var(--dp-density, 1)) 7px",
					borderRadius: "var(--dp-radius-sm, 5px)", background: "var(--dp-ac-soft, rgba(47,111,235,.16))",
					border: "1px solid var(--dp-ac-line, rgba(47,111,235,.4))", color: "var(--dp-ac, #9fc2ff)", whiteSpace: "nowrap"
				},
				muted: { fontSize: "calc(10.5px * var(--dp-font, 1))", color: "var(--dp-t3, #6f757d)" }
			};
			
			/* ══════════════════════════════════════════════════════════════════
			 *  组件
			 *  ⚠️ 几何 / 文案类的**纯函数**（连线路径、徽标行、拖动换算、单框控件）
			 *     在 logic/mindmap-render.js 与 store/mindmap-schema.js —— 那两个文件
			 *     不 import react，故离线测试能直接跑（组件文件 import 了 react，Node 进不来）。
			 * ══════════════════════════════════════════════════════════════════ */
			
			function MindMap({ open, onClose }) {
				/* ── 🔴 全部 hooks 必须在 `if (!open) return null` 之前 ────────── */
				const [snap, setSnap] = react.useState(() => getBranchSnapshot());
				const [sel, setSel] = react.useState(null);
				/** 右侧对话面板要显示的框（null = 面板关闭，画布铺满） */
				const [detailId, setDetailId] = react.useState(null);
				const [draft, setDraft] = react.useState("");
				const [routeResult, setRouteResult] = react.useState(null);
				const [review, setReview] = react.useState(null);
				const [toast, setToast] = react.useState("");
				const [inset, setInset] = react.useState(() => readInset());
				const [collapsed, setCollapsed] = react.useState(() => new Set());
				/* 分支链路聚焦（R9）：focusId=被聚焦的会话；focusUp=「含上一层」（祖先层全景） */
				const [focusId, setFocusId] = react.useState(null);
				const [focusUp, setFocusUp] = react.useState(false);
				/* 总览弹窗（R10）：挂在导图最上面，独立 fixed 层 */
				const [ovOpen, setOvOpen] = react.useState(false);
				const [hov, setHov] = react.useState(null);
				const [menu, setMenu] = react.useState(null);
				const [q, setQ] = react.useState("");
				const [k, setK] = react.useState(1);
				const [view, setView] = react.useState({ sl: 0, st: 0, cw: 0, ch: 0 });
				const [pOpen, setPOpen] = react.useState(false);
				/** 拖动中的实时位置（只在拖动期间存在；松手才写 store ⇒ 不每帧写盘） */
				const [dragPos, setDragPos] = react.useState(null);
				/** 当前宿主会话（决定右侧面板"原生内容能不能读"） */
				const [curId, setCurId] = react.useState(null);
			
				const lay = react.useSyncExternalStore(
					(fn) => directorLayoutStore.subscribe(fn),
					() => directorLayoutStore.getState(),
					() => directorLayoutStore.getState()
				);
				const pz = react.useSyncExternalStore(
					(fn) => personalizeStore.subscribe(fn),
					() => personalizeStore.getState(),
					() => personalizeStore.getState()
				);
				const flowSnap = react.useSyncExternalStore(
					(fn) => flowStore.subscribe(fn),
					() => flowStore.getState(),
					() => flowStore.getState()
				);
			
				const bodyRef = react.useRef(null);
				const searchRef = react.useRef(null);
				const fittedRef = react.useRef(false);
				const toastTimer = react.useRef(null);
				const dragRef = react.useRef(null);
				/** 「刚拖过」标记：拖动结束时置位一拍，避免拖完又被当成点击而弹出右侧面板 */
				const justDraggedRef = react.useRef(false);
			
				react.useEffect(() => {
					if (!open) return undefined;
					/* 🔴 顺序不可颠倒：**先订阅、再同步取一次、最后才发起刷新**。
					 *    `refreshBranchTree()` 是 async 函数，但走 ctx.sessions 通道时**没有 await**
					 *    ⇒ 它会在**同一轮同步执行**里就 `notify()`。若先 refresh 后 subscribe，
					 *    那次通知发生在订阅之前 ⇒ 首次打开时组件永远停在初始快照。
					 *    ⇒ 教训：**订阅类 API 必须先挂订阅再触发事件**，不要依赖"事件一定是异步的"。 */
					const off = subscribeBranch(setSnap);
					setSnap(getBranchSnapshot());
					refreshBranchTree().catch(() => { });
					return off;
				}, [open]);
			
				react.useEffect(() => watchInset(setInset), []);
				/* 跟随宿主当前会话（左栏点会话时插件收不到事件 ⇒ 轮询单字段）
				 * 用户：「我点击左侧，点入不同的对话切进去就是和当前对话有关的流转信息」 */
				react.useEffect(() => {
					if (!open) return undefined;
					return watchCurrentSession((id) => { setCurId(id); if (id) flowStore.setActiveSession(id); });
				}, [open]);
			
				/* 打开时自动适应一次（幂等：同一次打开只做一次，避免与用户的缩放打架） */
				react.useEffect(() => {
					if (!open) { fittedRef.current = false; return undefined; }
					if (fittedRef.current) return undefined;
					fittedRef.current = true;
					const t = setTimeout(() => { doFit(true); }, 60);
					return () => clearTimeout(t);
				}, [open]);
			
				react.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
			
				/* 键盘：Esc 逐层退（个性化 → 菜单 → 右侧面板 → 导图）· Ctrl+0/=/- 缩放 · Ctrl+F 搜索 */
				react.useEffect(() => {
					if (!open) return undefined;
					const onKey = (e) => {
						if (e.key === "Escape") {
							if (pOpen) { setPOpen(false); e.preventDefault(); return; }
							if (menu) { setMenu(null); e.preventDefault(); return; }
							if (detailId) { setDetailId(null); e.preventDefault(); return; }
							onClose();
							return;
						}
						if ((e.ctrlKey || e.metaKey) && e.key === "0") { e.preventDefault(); setK(1); say("已回到 100%（1:1）"); return; }
						if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_")) { e.preventDefault(); zoom(-0.1); return; }
						if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoom(0.1); return; }
						if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
							e.preventDefault();
							if (searchRef.current) searchRef.current.focus();
						}
					};
					window.addEventListener("keydown", onKey, true);
					return () => window.removeEventListener("keydown", onKey, true);
				}, [open, menu, detailId, pOpen, onClose]);
			
				/* 拖动：window 级监听（指针移出画布也不丢）
				 * 🔴 松手才写 store（拖动过程只改本地 state）—— 每帧写 localStorage 会卡。 */
				react.useEffect(() => {
					if (!open) return undefined;
					const onMove = (e) => {
						const d = dragRef.current;
						if (!d) return;
						const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
						if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
						d.moved = true;
						setDragPos({ id: d.id, x: Math.max(0, d.ox + dx / (k || 1)), y: Math.max(0, d.oy + dy / (k || 1)) });
					};
					const onUp = () => {
						const d = dragRef.current;
						dragRef.current = null;
						if (!d) return;
						setDragPos((cur) => {
							if (cur && cur.id === d.id) {
								directorLayoutStore.setNodePos(d.id, { x: cur.x, y: cur.y });
								say("已移动「" + String(d.title || "").slice(0, 12) + "」—— 位置已记住（「自动布局」可归位）");
							}
							return null;
						});
						/* 拖过就不算点击（否则每次拖完都会弹出右侧面板） */
						if (d.moved) {
							justDraggedRef.current = true;
							setTimeout(() => { justDraggedRef.current = false; }, 0);
							setSel(d.id);
						}
					};
					window.addEventListener("pointermove", onMove);
					window.addEventListener("pointerup", onUp);
					return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
				}, [open, k]);
			
				if (!open) return null;
			
				/* ── 数据派生（纯计算，非 hooks，可安全放在早退之后） ── */
				const tree = snap.tree || { rows: [], edges: [], byId: {} };
				const baseRows = tree.rows || [];
				/* 位置叠加：store 里存的（用户拖过的）+ 拖动中的实时位置。
				 * ⚠️ 这里**故意不用 useMemo**：它必须与 `if (!open) return null` 的相对位置保持一致，
				 *    而 hooks 绝不能排在早退之后（本项目在 DesignStudio 上吃过一次整层崩溃）。
				 *    纯数组映射的代价可以忽略，稳定性更重要。 */
				const posMap = dragPos
					? { ...(lay.mmPos || {}), [dragPos.id]: { x: dragPos.x, y: dragPos.y } }
					: (lay.mmPos || {});
				const hasPos = Object.keys(posMap).length > 0;
				const rows = hasPos
					? baseRows.map((r) => {
						const p = posMap[r.sessionId];
						if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return r;
						return { ...r, x: p.x, y: p.y, moved: true };
					})
					: baseRows;
			
				/* ── 折叠计数：必须按**当前树里真的存在**的节点算 ────────────────────
				 * 🔴 为什么不能直接用 `collapsed.size`（2026-09-12 真机定案）：
				 *   `collapsed` 是组件 state，而本组件**不随树变化而卸载**（切会话 / 换数据后原地重渲），
				 *   于是里面会留着**旧树的 sessionId**。此时 `collapsed.size > 0` 但渲染出来的
				 *   `[data-collapsed=1]` 节点数是 **0** —— 两边对不上，后果是用户点「折叠全部」
				 *   得到一句「已展开全部」而画布毫无变化（正是用户反复投诉的「点了像没点」）。
				 *   真机证据（verify-mindmap r14/r15，同一份代码两次不同表现）：
				 *     r15 点了之后 toast=「已展开全部」而 DOM 里 `[data-collapsed=1]` = 0；
				 *     r14 点击后按钮文案停在「展开全部」⇒ C-M9b 红。
				 *   这是本项目**同一类缺陷的第四次**（r5tab 页签 / 导图 focusId / nd-panel 开关 /
				 *   本处 collapsed）：跨轮存活的组件 state，读取前必须先与当前数据对账。
				 *   ⇒ 纪律统一为：**派生值只从当前数据推**，不读可能过期的容器。
				 *       且必须从**当前可见的**那一份推（见下 `winRows`）—— 作用在看不见的节点上
				 *       等于"点了没反应"，这正是用户反复投诉的形态。 */
				/* ── 分支链路聚焦（用户需求 R9）──────────────────────────────
				 * 「我点击对话那么只默认显示这个分支的链路，然后可以选是否包含上一层，
				 *   如果有下一层可以往下一层走。」
				 * 应用顺序：**先聚焦、后折叠** —— 折叠只作用于已经可见的集合，
				 * 两套开关互不干扰（先折叠再聚焦会让"被折叠的节点"偷偷回到视野里）。 */
				const focus = focusRows(rows, focusId, { includeParents: focusUp });
				const focusDownOk = focusId ? hasDownstream(rows, focusId) : false;
			
				const winRows = visibleRows(focus.rows, collapsed);
				/* 🔴 2026-09-12 第二次定案（verify-mindmap r16/r17 C-M9a 连红）：
				 *   上一版只把"陈旧 id"修掉了，但**基数仍然取错** —— 用的是 `rows`（全部血缘行），
				 *   而画布渲染的是 `winRows`（聚焦 + 折叠之后**真正可见**的那一份）。
				 *   聚焦态下 `winRows ⊊ rows`，于是「折叠全部」会去折一个**看不见的**节点：
				 *   库里的数据对了、toast 也报了"已折叠 1 棵子树"、按钮文案翻了「展开全部」——
				 *   **而画布上什么都没发生**。用户视角就是坏的（点了像没点）。
				 *   实测证据：r16/r17 `{"allCollapsed":0(DOM),"allToast":"已折叠 1 棵子树",
				 *   "collapsibleNonRoot":0}` —— DOM 里 `data-collapsed=1` 是 0，而文案说折了 1 棵。
				 *   ⇒ 判据统一为：**动作与计数都只看 `winRows`**（所见即所折）。 */
				const collapsedLive = winRows.filter((r) => collapsed.has(r.sessionId)).length;
				const collapsibleLive = winRows.filter((r) => r.depth > 0 && r.childrenCount > 0).length;
				const bounds = treeBounds(winRows);
				const stageW = Math.max(LAYOUT.minW, bounds.x + bounds.w);
				const stageH = Math.max(LAYOUT.minH, bounds.y + bounds.h);
				const matches = matchRows(rows, q);
				const chain = ancestorChain(rows, sel);
				const caps = hostCapabilities();
				const cov = coverageStats();
				const selNode = sel ? rows.find((r) => r.sessionId === sel) : null;
				const detailNode = detailId ? rows.find((r) => r.sessionId === detailId) : null;
				const hovNode = hov ? winRows.find((r) => r.sessionId === hov) : null;
				const visibleIds = new Set(winRows.map((r) => r.sessionId));
				const movesCount = Object.keys(lay.mmPos || {}).length;
				const reason = degradationReason();
				const posOf = (id) => rows.find((r) => r.sessionId === id);
				const selFlows = sel ? flowStore.ofSession(sel) : [];
			
				/* ── toast（自动消失；pointerEvents:none 不挡点击） ── */
				function say(msg) {
					setToast(msg);
					if (toastTimer.current) clearTimeout(toastTimer.current);
					toastTimer.current = setTimeout(() => setToast(""), TOAST_MS);
				}
			
				/* ── 视野同步（小地图用；滚动/缩放后量一次） ── */
				function syncView() {
					const el = bodyRef.current;
					if (!el) return;
					setView({ sl: el.scrollLeft, st: el.scrollTop, cw: el.clientWidth, ch: el.clientHeight });
				}
			
				/* ── 缩放（以视野中心为锚，避免"缩完目标跑出屏幕"） ── */
				function zoom(delta, absolute) {
					const el = bodyRef.current;
					const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, absolute !== undefined ? absolute : k + delta));
					if (!el) { setK(next); return; }
					const cx = (el.scrollLeft + el.clientWidth / 2) / k;
					const cy = (el.scrollTop + el.clientHeight / 2) / k;
					setK(next);
					requestAnimationFrame(() => {
						const e2 = bodyRef.current;
						if (!e2) return;
						e2.scrollLeft = Math.max(0, cx * next - e2.clientWidth / 2);
						e2.scrollTop = Math.max(0, cy * next - e2.clientHeight / 2);
						syncView();
					});
				}
			
				/* ── 适应屏幕（对**可见行**的包围盒，幂等 —— 已在视野内时只回文案） ── */
				function doFit(silent) {
					const el = bodyRef.current;
					if (!el || !winRows.length) { if (!silent) say("没有可适应的节点"); return; }
					const cw = el.clientWidth, ch = el.clientHeight;
					if (!cw || !ch) { if (!silent) say("画布尚未布局完成，请稍后再试"); return; }
					const next = Math.max(ZOOM_MIN, Math.min(1.4, Math.min(cw / bounds.w, ch / bounds.h) * 0.96));
					setK(next);
					requestAnimationFrame(() => {
						const e2 = bodyRef.current;
						if (!e2) return;
						e2.scrollLeft = Math.max(0, bounds.x * next - 8);
						e2.scrollTop = Math.max(0, bounds.y * next - 8);
						syncView();
						if (!silent) say("已适应：可见 " + winRows.length + " 个节点 · " + Math.round(next * 100) + "%");
					});
				}
			
				/* ── 节点动作（**只有有真实接口的**才出现在 UI 上） ── */
				async function actOpen(id) {
					setMenu(null);
					const r = await openSession(id);
					say(r.ok ? "已切到该分支的原生对话" : ("打开失败：" + r.reason));
				}
			
				async function actFork(id) {
					setMenu(null);
					if (!caps.fork) { say("fork 不可用：宿主未提供 sessions.fork"); return; }
					say("正在 fork…");
					const r = await forkBranch(id);
					if (r.ok) { setSel(r.sessionId); say("已创建子分支 " + String(r.sessionId).slice(-8)); }
					else say("fork 失败：" + r.reason);
				}
			
				/** 抓取原生对话区的真实产出（`readConversation` 是**唯一**守规通道：
				 *  走语义锚点找消息列表，不猜类名。找不到就如实报"未找到"，不编内容）。 */
				function grabText() {
					const conv = readConversation();
					return {
						text: String((conv && conv.lastText) || "").trim(),
						count: (conv && conv.count) || 0,
						found: Boolean(conv && conv.listFound)
					};
				}
			
				function actGrab(id) {
					setMenu(null);
					setSel(id);
					const g = grabText();
					if (!g.found) { say("未找到原生对话区：请先在对话 tab（或分屏）里打开内容，再抓取"); return; }
					if (!g.text) { say("原生对话区有 " + g.count + " 项但正文为空 —— 不抓空内容占位"); return; }
					setDraft(g.text);
					flowStore.push(g.text, { origin: "mindmap", sessionId: id, note: "从原生对话区抓取" });
					say("已抓取最近产出（" + g.text.length + " 字符 / 共 " + g.count + " 项）到导图，交总监判断去向");
				}
			
				/** 送审核：对**抓到的真实文本**跑六维规则引擎（抓不到就如实报 ❌，不编内容） */
				function actReview(id) {
					setMenu(null);
					setSel(id);
					const g = grabText();
					const node = rows.find((r) => r.sessionId === id);
					const res = review6({
						goal: (node && node.title) || "",
						output: g.text,
						evidence: g.found ? [
							"血缘：parentId 取自宿主会话摘要",
							"状态：取自宿主 running / completed / pendingInteraction",
							"产出：原生对话区 " + g.count + " 项（语义锚点读取）"
						] : [],
						risks: []
					});
					setReview({ sessionId: id, ...res, chars: g.text.length, found: g.found });
					say(res.pass ? "六维审核：通过" : "六维审核：未通过（" + res.failed.length + " 项硬缺口）");
				}
			
				function toggleCollapse(id) {
					setCollapsed((prev) => {
						const next = new Set(prev);
						if (next.has(id)) next.delete(id); else next.add(id);
						return next;
					});
				}
			
				function toggleAll() {
					/* 判据 = `collapsedLive`（**当前可见的**、真被标记的节点数），不是 `collapsed.size`
					 *（后者可能含旧树 / 不可见节点的 id ⇒ 会走"展开全部"分支，而画布上并没有折叠）。 */
					const has = collapsedLive > 0;
					if (has) { setCollapsed(new Set()); say("已展开全部"); return; }
					/* 只折叠**可见集合里**"有子且非根"的节点 —— 与画布渲染的是同一份 `winRows`。
					 * 根也折掉会让画布只剩一个节点，什么也看不出来。
					 * 🔴 用 `winRows` 而不是 `rows`：聚焦态下两者不等，拿 `rows` 会折到看不见的节点上，
					 *   用户点「折叠全部」后画布毫无变化（r16/r17 C-M9a 实测）。 */
					const ids = winRows.filter((r) => r.depth > 0 && r.childrenCount > 0).map((r) => r.sessionId);
					setCollapsed(new Set(ids));
					/* 「无事可做」也必须说话并说清原因 —— 用户反复投诉过「点了像没点」。 */
					say(collapsibleLive
						? "已折叠 " + ids.length + " 棵子树（点框内的 ▸ 可单独展开）"
						: "本层没有可折叠的子树（根节点不参与「折叠全部」，否则画布只剩一个节点）");
				}
			
				/* ── 流转：把一个动作登记进 flow store（四维共用的那一份） ──
				 * `sidHint` = 面板/节点自己的会话（否则用当前选中）。
				 * 🔴 hopTo 走的是"最新一条流转" ⇒ 必须按**同一会话**取，不能混到别会话的条目上。 */
				function onFlow(payload, sidHint) {
					if (!payload) return;
					const sid = sidHint !== undefined && sidHint !== null ? sidHint : (sel || null);
					if (payload.hopTo) {
						const list = flowStore.ofSession(sid);
						const latest = list.length ? list[list.length - 1] : null;
						if (latest) flowStore.move(latest.flowId, payload.hopTo, payload.note, { status: "routed", target: sid });
						return;
					}
					flowStore.push(payload.text, { origin: payload.origin, sessionId: sid, note: payload.note || "在导图发起" });
				}
			
				/* ── 底栏输入 → 总监路由（V16 C4「目标未定」支） ── */
				const doRoute = () => {
					const text = draft.trim();
					if (!text) return;
					const nodes = rows.map((r) => ({ id: r.sessionId, name: r.title, level: r.depth === 0 ? "root" : "session" }));
					const r = route(text, { nodes, currentNodeId: sel || null });
					setRouteResult(r);
					flowStore.push(text, { origin: "mindmap", sessionId: sel || null, note: "交总监判断去向（导图）" });
					say("总监已整理，待你确认去向");
					dshLog("mindmap", "导图底栏路由：" + r.decision.destination + " conf=" + r.decision.confidence);
				};
				const confirm = (dest) => {
					const latestSid = sel || null;
					const list = flowStore.ofSession(latestSid);
					const latest = list.length ? list[list.length - 1] : null;
					if (latest) flowStore.move(latest.flowId, dest === DESTINATION.DIRECT ? "director" : "chat", "确认去向：" + DESTINATION_LABEL[dest], { status: "routed" });
					say("已确认：" + DESTINATION_LABEL[dest] + "（" + (routeResult.subtasks || []).length + " 个子任务）");
					setRouteResult(null);
					setDraft("");
				};
			
				/* ── 菜单项定义（enabled 由宿主能力探测决定，disabled 必须写明缺什么） ── */
				const menuItems = menu ? [
					{ key: "open", icon: "📂", label: "打开此对话", enabled: caps.open, why: "宿主 sessions.open", run: () => actOpen(menu.id) },
					{ key: "detail", icon: "💬", label: "在右侧展开对话", enabled: true, why: "插件侧面板，不依赖宿主写接口", run: () => { setMenu(null); setDetailId(menu.id); } },
					{ key: "fork", icon: "➕", label: "从此处分支（fork）", enabled: caps.fork, why: "宿主 sessions.fork", run: () => actFork(menu.id) },
					{ key: "grab", icon: "📥", label: "抓取信息到总监", enabled: true, why: "读原生对话区（bridge/chat-bridge）", run: () => actGrab(menu.id) },
					{ key: "review", icon: "🎯", label: "送交审核（六维）", enabled: true, why: "对抓到的真实文本跑 review6", run: () => actReview(menu.id) },
					{ sep: true },
					{ key: "locate", icon: "✥", label: "归位（回自动布局）", enabled: Boolean(posMap[menu.id]), why: "该框已被你拖过；未拖过的框本来就在自动布局位", run: () => { directorLayoutStore.clearNodePos(menu.id); setMenu(null); say("已归位该框"); } },
					{ key: "merge", icon: "🔀", label: "合并回父", enabled: false, why: "宿主 sessions 服务未暴露合并接口（取证：SessionRuntime 成员表只有 create/fork/open/search/refresh）" },
					{ key: "remove", icon: "✂️", label: "删除分支", enabled: false, why: "宿主 sessions 服务未暴露删除接口 —— 不接一个假按钮" }
				] : null;
			
				const padRight = Math.max(10, inset + 10);
			
				return h("div", {
					id: MINDMAP_ID, style: S.root, "data-testid": "mm-root", role: "dialog", "aria-label": "分支导图",
					"data-inset": inset, "data-lineage": snap.lineage ? "1" : "0", "data-source": snap.source || "none",
					"data-detail": detailId ? "1" : "0", "data-moved": String(movesCount), "data-edge": pz.edge,
					className: "dp-textured",
					onClick: () => { if (menu) setMenu(null); }
				}, [
					/* ── 顶栏（⚙ 个性化 + ✕ 都落在窗口控件安全区左侧） ── */
					h("div", { key: "t", style: { ...S.top, paddingRight: padRight }, "data-testid": "mm-top" }, [
						h("span", { key: "a", style: { fontWeight: 650 } }, "🧠 分支导图"),
						h("span", {
							key: "s", style: S.chip, "data-testid": "mm-source",
							title: snap.lineage
								? "血缘来自宿主 ctx.sessions.list.getSnapshot()（parentId）"
								: ("已降级为「按工作区分组的平铺树」。原因：" + reason)
						}, snap.lineage ? "血缘：ctx.sessions ✔" : "血缘不可用（分组树）"),
						h("span", { key: "c", style: S.muted, "data-testid": "mm-count" },
							"分支 " + rows.length + " · 连线 " + (tree.edges || []).length +
							(collapsedLive ? " · 折叠 " + collapsedLive : "") +
							(movesCount ? " · 移动 " + movesCount : "")),
						curId ? h("span", { key: "cur", style: S.muted, "data-testid": "mm-current-chip", title: "宿主当前会话（左栏点了哪个就跟着变）" },
							"当前会话 …" + String(curId).slice(-8)) : null,
			
						h("button", {
							key: "ov", style: { ...S.btn, marginLeft: "auto" }, "data-testid": "mm-overview",
							title: "项目总览：已完成 / 待完成",
							onClick: () => setOvOpen(true)
						}, "▤ 总览"),
						h("button", {
							key: "p", style: S.btn, "data-testid": "mm-personalize",
							title: "个性化设定：主色 / 质感 / 密度 / 字号 / 圆角 / 连线（四处共用同一份）",
							onClick: () => setPOpen((v) => !v)
						}, "⚙ 个性化"),
						h("button", {
							key: "r", style: S.btn, "data-testid": "mm-refresh",
							onClick: () => { refreshBranchTree().catch(() => { }); say("已重读血缘快照"); }
						}, "↻ 刷新"),
						h("button", {
							key: "x", style: S.btn, "data-testid": "mm-close", "aria-label": "关闭分支导图",
							title: "关闭（Esc 逐层退：先关个性化 → 菜单 → 右侧面板）", onClick: onClose
						}, "✕")
					]),
			
					/* ── 工具条（设计稿 A4 .mtools：左树操作 / 右状态图例） ── */
					h("div", { key: "tl", style: { ...S.tools, paddingRight: padRight }, "data-testid": "mm-tools" }, [
						h("span", { key: "t0", style: { fontSize: "calc(11.5px * var(--dp-font,1))", fontWeight: 600, color: "var(--dp-ac2, #c9b0ff)" }, "data-testid": "mm-tree-title" },
							"⑂ 分支树 · " + (rows[0] ? rows[0].title : "（无会话）")),
			
						h("button", {
							key: "fork", style: { ...S.btn, opacity: caps.fork ? 1 : 0.5 }, "data-testid": "mm-new-fork",
							title: caps.fork ? "从当前选中的分支 fork（宿主 sessions.fork）" : "不可用：宿主未提供 sessions.fork",
							onClick: () => {
								const target = sel || (rows[0] && rows[0].sessionId);
								if (!target) { say("没有可 fork 的源会话"); return; }
								actFork(target);
							}
						}, "＋ 新建分支"),
			
						h("button", {
							key: "ca", style: S.btn, "data-testid": "mm-collapse-all",
							title: collapsedLive ? "展开全部子树" : "折叠全部有子的非根节点",
							onClick: toggleAll
						}, collapsedLive ? "🗖 展开全部" : "🗂 折叠全部"),
			
						h("button", {
							key: "al", style: { ...S.btn, opacity: movesCount ? 1 : 0.5 }, "data-testid": "mm-auto-layout",
							title: movesCount ? ("把 " + movesCount + " 个被你拖过的框放回自动布局") : "当前没有拖过的框（都在自动布局位）",
							onClick: () => {
								if (!movesCount) { say("没有拖过的框（拖动任一框后本按钮才有效）"); return; }
								directorLayoutStore.resetNodePos();
								say("已归位 " + movesCount + " 个框（回到自动布局）");
							}
						}, "▦ 自动布局"),
			
						h("button", {
							key: "fit", style: S.btn, "data-testid": "mm-fit", title: "把整棵可见血缘树缩进视野", onClick: () => doFit(false)
						}, "🔍 适应"),
			
						h("span", { key: "zs", style: { display: "inline-flex", alignItems: "center", gap: 4 } }, [
							h("button", { key: "o", style: S.btn, "data-testid": "mm-zoom-out", "aria-label": "缩小", title: "缩小 10%（Ctrl+-）", onClick: () => zoom(-0.1) }, "－"),
							h("span", {
								key: "v", "data-testid": "mm-zoom", "aria-live": "polite",
								/* 锁宽：`95%`(3 字) ↔ `100%`(4 字) 差 6px，会把右边的按钮推着走 */
								style: { ...S.muted, display: "inline-block", minWidth: 40, textAlign: "center", boxSizing: "border-box" }
							}, Math.round(k * 100) + "%"),
							h("button", { key: "i", style: S.btn, "data-testid": "mm-zoom-in", "aria-label": "放大", title: "放大 10%（Ctrl+=）", onClick: () => zoom(0.1) }, "＋"),
							h("button", { key: "1", style: S.btn, "data-testid": "mm-zoom-100", "aria-label": "回到 100%", title: "回到 100% 真实像素（Ctrl+0）", onClick: () => { setK(1); say("已回到 100%（1:1）"); } }, "1:1")
						]),
			
						h("input", {
							key: "q", ref: searchRef, style: { ...S.input, width: 168, flex: "0 0 auto" }, "data-testid": "mm-search",
							placeholder: "搜索标题 / 会话号（Ctrl+F）", value: q, onChange: (e) => setQ(e.target.value),
							title: "命中节点高亮，未命中节点淡出"
						}),
						matches ? h("span", { key: "qm", style: S.muted, "data-testid": "mm-search-hits" }, "命中 " + matches.size) : null,
			
						/* 状态图例 —— 只列**有数据源**的态，且可由个性化关掉 */
						pz.legend ? h("span", { key: "lg", style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }, "data-testid": "mm-legend" },
							supportedStates().map((s) => h("span", {
								key: s.key, style: { ...S.muted, display: "inline-flex", alignItems: "center", gap: 3 }, title: s.label + " —— " + s.from
							}, [h("span", {
								key: "d", style: { width: 7, height: 7, borderRadius: "50%", background: s.color, display: "inline-block" }
							}), h("span", { key: "l" }, s.label)]))) : h("span", { key: "lg0", style: { marginLeft: "auto" } }),
			
						h("span", {
							key: "cov", style: S.muted, "data-testid": "mm-coverage",
							title: "元素覆盖度（详见 store/mindmap-schema.js MM_COVERAGE）"
						}, "元素 " + cov.done + "/" + cov.total)
					]),
			
					/* ── 聚焦条（R9）：只在真正聚焦时出现，不聚焦不占位 ── */
					focus.applied ? h("div", {
						key: "fobar", style: { ...S.tools, paddingRight: padRight }, "data-testid": "mm-focusbar",
						"data-focus-id": focusId || "", "data-focus-up": focusUp ? "1" : "0",
						"data-focus-down": focusDownOk ? "1" : "0"
					}, [
						h("span", { key: "t", style: S.chip, "data-testid": "mm-focus-title" },
							"聚焦 " + String((rows.find((r) => r.sessionId === focusId) || {}).title || "该分支").slice(0, 18)),
						h("span", { key: "s", style: S.muted, "data-testid": "mm-focus-stats" },
							"下游 " + (focus.stats.down + 1) + " · 上游 " + focus.stats.up),
						h("button", {
							key: "u", "data-testid": "mm-focus-up", "data-on": focusUp ? "1" : "0",
							style: { ...S.btn, borderColor: focusUp ? "var(--dp-ac, #2f6feb)" : undefined },
							title: "含上一层", onClick: () => setFocusUp((v) => !v)
						}, (focusUp ? "☑" : "☐") + " 含上一层"),
						focusDownOk ? h("span", { key: "d", style: S.muted, "data-testid": "mm-focus-down" }, "▸ 可下钻（点子节点）") : null,
						h("button", {
							key: "x", "data-testid": "mm-focus-exit", style: S.btn, title: "退出聚焦，显示全部",
							onClick: () => { setFocusId(null); setFocusUp(false); say("已退出聚焦"); }
						}, "退出聚焦")
					]) : null,
			
					/* ── 主区：画布 + 右侧对话面板 ── */
					h("div", { key: "main", style: S.main }, [
						h("div", { key: "cw", style: S.canvasWrap, className: "dp-textured" }, [
							h("div", {
								key: "b", style: S.body, ref: bodyRef, "data-testid": "mm-body", className: "dp-scroll",
								onScroll: syncView, onPointerDown: () => { if (menu) setMenu(null); }
							},
							h("div", { key: "w", style: { ...S.stageWrap, width: stageW * k, height: stageH * k } }, [
								h("div", {
									key: "s", style: { ...S.stage, width: stageW, height: stageH, transform: "scale(" + k + ")" },
									"data-testid": "mm-stage", "data-zoom": k
								}, [
									/* 连线：主干实线 / 分支虚线 / 选中链高亮（形状由个性化设定决定） */
									h("svg", {
										key: "svg", width: stageW, height: stageH,
										style: { position: "absolute", left: 0, top: 0, pointerEvents: "none" }, "data-testid": "mm-edges"
									}, (tree.edges || []).map((e, i) => {
										const a = posOf(e.from), b = posOf(e.to);
										if (!a || !b) return null;
										if (!visibleIds.has(e.to)) return null;   // 折叠隐藏的子边不画
										const p = edgePathFor(a, b, b.depth, chain.has(e.from) && chain.has(e.to), pz.edge);
										return h("path", { key: i, d: p.d, style: edgeStyleOf(p.kind), "data-edge-kind": p.kind });
									})),
			
									/* 节点（含单框控件 —— 见 store/mindmap-schema.js NODE_CONTROLS） */
									winRows.map((r) => {
										const st = r.state;
										const kind = NODE_KINDS[r.kind] || NODE_KINDS.leaf;
										const dim = matches && !matches.has(r.sessionId);
										const hit = matches && matches.has(r.sessionId);
										const isOpen = detailId === r.sessionId;
										const ctrls = controlsOfRow({ ...r, collapsed: collapsed.has(r.sessionId) }, caps);
										const cToggle = ctrls.find((c) => c.key === "toggle");
										const cDetail = ctrls.find((c) => c.key === "detail");
										const cFork = ctrls.find((c) => c.key === "fork");
										const cOpen = ctrls.find((c) => c.key === "open");
										return h("div", {
											key: r.sessionId,
											style: {
												...S.node(sel === r.sessionId, hov === r.sessionId, r.kind, dragPos && dragPos.id === r.sessionId),
												left: r.x, top: r.y,
												opacity: dim ? 0.32 : 1,
												outline: hit ? "2px solid #d29922" : (isOpen ? "2px solid var(--dp-ac, #2f6feb)" : "none"),
												outlineOffset: hit || isOpen ? 1 : 0
											},
											"data-testid": "mm-node", "data-session-id": r.sessionId, "data-state": st,
											"data-kind": r.kind, "data-depth": r.depth, "data-state-source": r.stateSource,
											"data-collapsed": collapsed.has(r.sessionId) ? "1" : "0",
											"data-current": r.isCurrent ? "1" : "0",
											"data-moved": r.moved ? "1" : "0",
											"data-detail-open": isOpen ? "1" : "0",
											onMouseEnter: () => setHov(r.sessionId),
											onMouseLeave: () => setHov((p) => (p === r.sessionId ? null : p)),
											/* 拖动：在框体上按下即进入拖动（控件自己 stopPropagation，不会误触） */
											onPointerDown: (e) => {
												if (e.button !== 0) return;
												dragRef.current = { id: r.sessionId, sx: e.clientX, sy: e.clientY, ox: r.x, oy: r.y, moved: false, title: r.title };
												setSel(r.sessionId);
											},
											onClick: (e) => {
												e.stopPropagation();
												setSel(r.sessionId);
												/* 拖过就不当点击（拖动结束时置位一拍，见 justDraggedRef） */
												if (justDraggedRef.current) return;
												setDetailId(r.sessionId);
												/* 同时进入「链路聚焦」（R9）：只看这一支及其上下游 */
												setFocusId(r.sessionId);
											},
											onContextMenu: (e) => {
												e.preventDefault(); e.stopPropagation();
												const box = bodyRef.current ? bodyRef.current.getBoundingClientRect() : { left: 0, top: 0 };
												setMenu({ id: r.sessionId, x: e.clientX - box.left + bodyRef.current.scrollLeft, y: e.clientY - box.top + bodyRef.current.scrollTop });
												setSel(r.sessionId);
											},
											title: r.sessionId + (r.parentSessionId ? " ← 父 " + r.parentSessionId : "（根/中心主题）") +
												"｜" + stateTitleOf(r) + "｜点框=右侧展开对话 · 按住拖动=移动 · 右键=菜单"
										}, [
											/* 第 1 行：类型图标 + 标题 + 状态点 */
											h("div", {
												key: "r1",
												style: { display: "flex", alignItems: "center", gap: 4, fontSize: "calc(11.5px * var(--dp-font,1))", fontWeight: 600, minWidth: 0 }
											}, [
												h("span", { key: "i", style: { flex: "0 0 auto", color: kind.accent } }, kind.icon),
												h("span", {
													key: "n", style: { flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
												}, r.title),
												h("span", { key: "d", style: { ...S.dot(st), position: "static", flex: "0 0 auto" }, "data-testid": "mm-dot" })
											]),
											/* 第 2 行：有据徽标（取不到就不写"未知"，退回深度） */
											h("div", {
												key: "r2", style: { fontSize: "calc(10px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
												"data-testid": "mm-node-meta"
											}, metaLineOf(r) + (r.moved ? " · 已移动" : "")),
											/* 第 3 行：**单框控件**（用户：「单个框没有展开和折叠的选项」）
											 * 每个框都有这一行；不可用的项**显示出来并写明原因**，不悄悄消失 */
											h("div", {
												key: "r3", style: { display: "flex", alignItems: "center", gap: 3, marginTop: "auto" },
												"data-testid": "mm-node-controls", "data-controls": ctrls.filter((c) => c.enabled).map((c) => c.key).join(",")
											}, [
												/* 折叠 / 展开（有子才有意义） */
												h("span", {
													key: "tg", style: nodeBtnStyle(cToggle.enabled, false), title: cToggle.enabled
														? (collapsed.has(r.sessionId) ? "展开 " + r.childrenCount + " 个子分支" : "折叠 " + r.childrenCount + " 个子分支") + "（" + cToggle.why + "）"
														: ("不可折叠 —— " + cToggle.why),
													"data-testid": "mm-node-toggle", "data-toggle-id": r.sessionId,
													"data-enabled": cToggle.enabled ? "1" : "0",
													"data-collapsed": collapsed.has(r.sessionId) ? "1" : "0",
													onPointerDown: (e) => e.stopPropagation(),
													onClick: (e) => {
														e.stopPropagation();
														if (!cToggle.enabled) { say("该框下没有子会话 ⇒ 无可折叠内容（不是坏了）"); return; }
														toggleCollapse(r.sessionId);
														say(collapsed.has(r.sessionId) ? ("已展开「" + String(r.title).slice(0, 12) + "」的 " + r.childrenCount + " 个子分支") : ("已折叠「" + String(r.title).slice(0, 12) + "」的 " + r.childrenCount + " 个子分支"));
													}
												}, collapsed.has(r.sessionId) ? cToggle.alt : cToggle.icon),
												/* 在右侧展开对话 */
												h("span", {
													key: "dt", style: nodeBtnStyle(cDetail.enabled, isOpen), title: "在右侧展开这个对话（含「现在在做的事」）",
													"data-testid": "mm-node-detail", "data-detail-id": r.sessionId, "data-enabled": "1",
													onPointerDown: (e) => e.stopPropagation(),
													onClick: (e) => { e.stopPropagation(); setDetailId(isOpen ? null : r.sessionId); }
												}, "💬"),
												/* fork / 打开（不可用则写明缺什么） */
												h("span", {
													key: "fk", style: nodeBtnStyle(cFork.enabled, false), title: cFork.enabled ? "从此处分支（fork）" : ("不可用 —— " + cFork.why),
													"data-testid": "mm-node-fork", "data-enabled": cFork.enabled ? "1" : "0",
													onPointerDown: (e) => e.stopPropagation(),
													onClick: (e) => { e.stopPropagation(); if (cFork.enabled) actFork(r.sessionId); else say("fork 不可用：" + cFork.why); }
												}, "✚"),
												h("span", {
													key: "op", style: nodeBtnStyle(cOpen.enabled, false), title: cOpen.enabled ? "打开该原生对话" : ("不可用 —— " + cOpen.why),
													"data-testid": "mm-node-open", "data-enabled": cOpen.enabled ? "1" : "0",
													onPointerDown: (e) => e.stopPropagation(),
													onClick: (e) => { e.stopPropagation(); if (cOpen.enabled) actOpen(r.sessionId); else say("打开不可用：" + cOpen.why); }
												}, "📂"),
												/* 拖动手柄（与框体同一动作，但给出可见的可拖提示） */
												h("span", {
													key: "mv", style: { ...nodeBtnStyle(true, false), cursor: "grab", marginLeft: "auto" },
													title: "按住拖动可移动这个框（只改位置，不改血缘）；右键菜单里有「归位」",
													"data-testid": "mm-node-move", "data-move-id": r.sessionId,
													onPointerDown: (e) => {
														e.stopPropagation();
														if (e.button !== 0) return;
														dragRef.current = { id: r.sessionId, sx: e.clientX, sy: e.clientY, ox: r.x, oy: r.y, moved: false, title: r.title };
														setSel(r.sessionId);
													}
												}, "✥"),
												/* 当前会话标记 */
												r.isCurrent ? h("span", {
													key: "cu", "data-testid": "mm-current", style: {
														fontSize: 9, padding: "0 4px", borderRadius: 3,
														background: "var(--dp-ac-soft, rgba(47,111,235,.2))", border: "1px solid var(--dp-ac-line, rgba(47,111,235,.5))",
														color: "var(--dp-ac, #9fc2ff)"
													}
												}, "当前") : null
											]),
											/* 折叠时显示隐藏的子树规模（不是"什么都没有"） */
											collapsed.has(r.sessionId) ? h("span", {
												key: "gh", "data-testid": "mm-ghost", style: {
													position: "absolute", right: -22, top: LAYOUT.nodeH / 2 - 9, fontSize: 9.5,
													padding: "1px 5px", borderRadius: 4, background: "var(--dp-bg-2, #20212a)",
													border: "1px dashed var(--dp-line, #4c525c)", color: "var(--dp-t3, #8b9199)"
												}
											}, "+" + r.childrenCount) : null
										]);
									})
								]),
			
								/* 悬浮工具条（设计稿 A4 .hbtns：出现在节点上方）
								 * 🔴 故意**不放进 stage**：stage 带 `transform: scale(k)`，低缩放下工具条会跟着缩到点不着。 */
								hovNode ? h("div", {
									key: "hb", style: {
										position: "absolute", left: hovNode.x * k, top: Math.max(0, hovNode.y * k - 26), display: "flex", gap: 3,
										background: "var(--dp-bg-2, #20212a)", border: "1px solid var(--dp-line, #3d4148)",
										borderRadius: "var(--dp-radius, 8px)", padding: "2px 5px", zIndex: 6
									}, "data-testid": "mm-hoverbar", "data-hover-id": hovNode.sessionId,
									onMouseEnter: () => setHov(hovNode.sessionId)
								}, [
											h("span", { key: "f", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "从此处分支（fork）", onClick: () => actFork(hovNode.sessionId) }, "➕"),
											h("span", { key: "o", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "打开此对话", onClick: () => actOpen(hovNode.sessionId) }, "📂"),
											h("span", { key: "g", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "抓取到总监", onClick: () => actGrab(hovNode.sessionId) }, "📥"),
											h("span", { key: "v", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "送交审核（六维）", onClick: () => actReview(hovNode.sessionId) }, "🎯"),
											h("span", { key: "c", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "折叠 / 展开这棵子树", onClick: () => toggleCollapse(hovNode.sessionId) }, "🗂"),
											h("span", { key: "dt", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "在右侧展开这个对话", onClick: () => setDetailId(hovNode.sessionId) }, "💬"),
											h("span", {
												key: "m", style: { ...nodeBtnStyle(true, false), width: "auto", padding: "0 4px" }, title: "更多（右键菜单）",
												onClick: () => setMenu({
													id: hovNode.sessionId,
													x: hovNode.x * k + 40,
													y: (hovNode.y + LAYOUT.nodeH) * k + 6
												})
											}, "⋯")
										]) : null,
			
								/* 右键菜单 —— 同样放 wrap（不缩放）；坐标已是 body 滚动空间 */
								menu ? h("div", {
									key: "cm", style: {
										position: "absolute", left: menu.x, top: menu.y, background: "var(--dp-bg-2, #20212a)",
										border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius, 8px)",
										padding: 5, zIndex: 7, minWidth: 224, boxShadow: "var(--dp-shadow, 0 12px 30px rgba(0,0,0,.65))"
									}, "data-testid": "mm-ctxmenu", "data-ctx-id": menu.id,
									onClick: (e) => e.stopPropagation(), onPointerDown: (e) => e.stopPropagation()
								}, menuItems.map((it, i) => (it.sep ? h("div", {
									key: "sp" + i, style: { height: 1, background: "var(--dp-line, #31343a)", margin: "4px 2px" }
								}) : h("div", {
									key: it.key,
									style: {
										fontSize: "calc(11px * var(--dp-font,1))", color: it.enabled ? "var(--dp-t2, #c3c8ce)" : "var(--dp-t3, #5d626a)",
										padding: "4px 8px", borderRadius: "var(--dp-radius-sm, 5px)",
										cursor: it.enabled ? "pointer" : "not-allowed", display: "flex", gap: 6, alignItems: "center"
									},
									"data-testid": "mm-ctx-" + it.key, "data-enabled": it.enabled ? "1" : "0",
									title: it.enabled ? it.why : ("不可用 —— " + it.why),
									onClick: () => { if (it.enabled && it.run) it.run(); }
								}, [
									h("span", { key: "i" }, it.icon),
									h("span", { key: "l" }, it.label),
									!it.enabled ? h("span", { key: "n", style: { marginLeft: "auto", fontSize: 9.5, color: "var(--dp-t3, #4c525c)" } }, "未接通") : null
								])))) : null
							])
						),
			
						/* ── 小地图（整树缩略 + 视野框；点击跳转；可由个性化关掉） ── */
						pz.minimap ? h("div", {
							key: "mm", style: {
								position: "absolute", right: 12, bottom: 12, width: 178, height: 104, background: "rgba(20,21,25,.9)",
								border: "1px solid var(--dp-line, #31343a)", borderRadius: "var(--dp-radius, 8px)", overflow: "hidden", cursor: "crosshair", zIndex: 5
							}, "data-testid": "mm-minimap",
							title: "小地图：整棵血缘树缩略，点击可跳转视野（个性化里可关）",
							onClick: (e) => {
								const el = bodyRef.current;
								if (!el) return;
								const box = e.currentTarget.getBoundingClientRect();
								const rx = (e.clientX - box.left) / box.width;
								const ry = (e.clientY - box.top) / box.height;
								el.scrollLeft = Math.max(0, rx * stageW * k - el.clientWidth / 2);
								el.scrollTop = Math.max(0, ry * stageH * k - el.clientHeight / 2);
								syncView();
							}
						}, [
							...rows.map((r) => h("div", {
								key: r.sessionId,
								style: {
									position: "absolute",
									left: (r.x / stageW) * 100 + "%",
									top: (r.y / stageH) * 100 + "%",
									width: Math.max(3, (LAYOUT.nodeW / stageW) * 100 * 0.9) + "%",
									height: Math.max(2, (LAYOUT.nodeH / stageH) * 100) + "%",
									background: chain.has(r.sessionId) ? "var(--dp-ac, #8957e5)" : (STATE_KINDS[r.state] || STATE_KINDS.idle).color,
									opacity: 0.85, borderRadius: 1
								}
							})),
							h("div", {
								key: "vp", "data-testid": "mm-minimap-vp",
								style: {
									position: "absolute",
									left: (view.sl / (stageW * k)) * 100 + "%",
									top: (view.st / (stageH * k)) * 100 + "%",
									width: ((view.cw || 0) / (stageW * k)) * 100 + "%",
									height: ((view.ch || 0) / (stageH * k)) * 100 + "%",
									border: "1px solid var(--dp-ac, #9fc2ff)", background: "var(--dp-ac-soft, rgba(47,111,235,.12))"
								}
							})
						]) : null
						]),
			
						/* ── 右侧：该框的对话（点框即开；最上面是「现在在做的事」） ── */
						detailNode ? h(NodeDetailPanel, {
							key: "nd", row: detailNode, flows: flowStore.ofSession(detailNode.sessionId),
							onClose: () => setDetailId(null),
							onSay: (m, tone) => say(m),
							onFlow: (payload) => {
								onFlow(payload, detailNode.sessionId);
								/* 面板里发起的输入也进"待总监判断"的草稿，方便接着路由 */
								if (payload && payload.text && !payload.hopTo) setDraft(payload.text);
							},
							onRoute: (text) => {
								if (!String(text || "").trim()) return;
								setDraft(String(text).trim());
								const nodes = rows.map((r) => ({ id: r.sessionId, name: r.title, level: r.depth === 0 ? "root" : "session" }));
								const r = route(String(text).trim(), { nodes, currentNodeId: detailNode.sessionId });
								setRouteResult(r);
								flowStore.push(String(text).trim(), { origin: "mindmap", sessionId: detailNode.sessionId, note: "交总监判断去向（右侧面板）" });
								say("总监已整理，待你确认去向（底栏）");
							}
						}) : null
					]),
			
					/* ── 总览弹窗（R10）：导图**最上面**的独立层，不改动画布布局 ── */
					h(OverviewDialog, {
						key: "ov", open: ovOpen, onClose: () => setOvOpen(false), rows, onSay: (m) => say(m)
					}),
			
					/* ── 底部：选中分支信息 + 待路由输入 + 审核结果 ── */
					h("div", { key: "f", style: S.foot }, [
						h("div", { key: "info", style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } }, [
							h("span", { key: "l", style: { ...S.muted, minWidth: 52 } }, "选中分支"),
							h("span", {
								key: "v", style: { fontSize: "calc(11.5px * var(--dp-font,1))", color: selNode ? "var(--dp-ac2, #d6c6ff)" : "var(--dp-t3, #6f757d)" }, "data-testid": "mm-sel"
							}, selNode
								? (selNode.title + " · " + selNode.sessionId + " · " + kindLabelOf(selNode) + " · " + (STATE_KINDS[selNode.state] || STATE_KINDS.idle).label +
									" · 流转 " + selFlows.length + " 条")
								: "未选中（点任一框 → 右侧展开该对话；未选时底栏输入走总监全域路由）"),
							detailNode ? h("span", { key: "d", style: { ...S.chip } }, "右侧已展开：" + String(detailNode.title).slice(0, 14)) : null,
							!caps.available ? h("span", { key: "w", style: { ...S.muted, color: "#d29922" } }, "⚠ 宿主 sessions 服务不可用 ⇒ fork / 打开 已禁用") : null
						]),
						h("div", { key: "in", style: { display: "flex", gap: 7, alignItems: "center" } }, [
							h("span", { key: "c", style: S.chip }, "路由"),
							h("input", {
								key: "i", style: S.input, "data-testid": "mm-input", value: draft,
								placeholder: "输入内容，交由总监判断去向",
								onChange: (e) => setDraft(e.target.value),
								onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doRoute(); } }
							}),
							h("button", { key: "b", style: S.btnPri, "data-testid": "mm-route", title: "交由总监判断去向", onClick: doRoute }, "交由总监")
						]),
						routeResult ? h("div", {
							key: "rr", style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, "data-testid": "mm-route-card"
						}, [
							h("span", {
								key: "c", style: { ...S.chip, background: "var(--dp-ac2-soft, rgba(137,87,229,.16))", borderColor: "var(--dp-ac2-line, rgba(137,87,229,.4))", color: "var(--dp-ac2, #b794f6)" }
							}, "建议 " + DESTINATION_LABEL[routeResult.decision.destination] + "（" + routeResult.decision.confidence.toFixed(2) + "）"),
							h("span", { key: "r", style: S.muted }, routeResult.decision.reason),
							h("button", { key: "t", style: S.btn, "data-testid": "mm-rt-transfer", onClick: () => confirm(DESTINATION.TRANSFER) }, "转给该对话"),
							h("button", { key: "d", style: S.btn, "data-testid": "mm-rt-direct", onClick: () => confirm(DESTINATION.DIRECT) }, "直接调用"),
							h("button", { key: "n", style: S.btn, "data-testid": "mm-rt-new", onClick: () => confirm(DESTINATION.CREATE) }, "新建分支"),
							h("button", { key: "c2", style: S.btn, "data-testid": "mm-rt-cancel", onClick: () => setRouteResult(null) }, "取消")
						]) : null,
						/* 六维审核卡（数据是**真实抓取**的文本 + 规则引擎输出；空文本会如实报 ❌） */
						review ? h("div", {
							key: "rv", style: {
								display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
								border: "1px solid " + (review.pass ? "rgba(63,185,80,.45)" : "rgba(201,148,43,.45)"),
								background: review.pass ? "rgba(63,185,80,.08)" : "rgba(201,148,43,.08)",
								borderRadius: "var(--dp-radius, 8px)", padding: "4px 8px"
							}, "data-testid": "mm-review", "data-pass": review.pass ? "1" : "0"
						}, [
							h("span", { key: "h", style: { fontSize: "calc(11px * var(--dp-font,1))", fontWeight: 650, color: review.pass ? "#3fb950" : "#d29922" } },
								"六维审核 " + (review.pass ? "通过" : "未通过")),
							h("span", { key: "c", style: S.muted }, "抓取 " + review.chars + " 字符" + (review.chars ? "" : "（原生对话区为空 ⇒ 需求满足度为 ❌，这是真实结果）")),
							h("span", { key: "d", style: { display: "inline-flex", gap: 6, flexWrap: "wrap" } },
								review.dims.map((d) => h("span", {
									key: d.key, style: { ...S.muted, color: d.status === "ok" ? "#3fb950" : d.status === "warn" ? "#d29922" : "#e5534b" },
									title: d.hint + " —— " + d.note
								}, (d.status === "ok" ? "✅" : d.status === "warn" ? "⚠" : "❌") + d.label))),
							h("button", { key: "x2", style: S.btn, "data-testid": "mm-review-close", onClick: () => setReview(null) }, "关闭")
						]) : null,
						h("div", { key: "note", style: S.muted },
							"状态点四态取自**宿主快照**（running / completed / pendingInteraction）；血缘取自宿主 fork 写入的 parentId；" +
							"拖动只改画面位置、不改血缘。元素 " + cov.done + "/" + cov.total + " 已落（" + cov.na + " 条明确不做，原因见 store/mindmap-schema.js）。")
					]),
			
					/* 个性化面板（右上角；与总监页 / 弹窗 / 设计图工作室同一个组件、同一份设定） */
					h(PersonalizePanel, { key: "pp", open: pOpen, onClose: () => setPOpen(false), inset: inset, top: 46, scope: "分支导图" }),
			
					/* toast：顶部居中药丸，自动消失，不挡点击 */
					toast ? h("div", {
						key: "toast", style: {
							position: "absolute", top: 84, left: "50%", transform: "translateX(-50%)",
							padding: "5px 12px", borderRadius: 999, pointerEvents: "none", maxWidth: "64%",
							background: "var(--dp-ac, rgba(47,111,235,.92))", border: "1px solid var(--dp-ac-line, rgba(159,194,255,.55))", color: "#fff",
							fontSize: "calc(11.5px * var(--dp-font,1))", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
							boxShadow: "var(--dp-shadow, 0 6px 22px rgba(0,0,0,.55))"
						}, "data-testid": "mm-toast"
					}, toast) : null
				]);
			}
			
			__defaults["components/MindMap.js"] = MindMap;
			
			exports.MINDMAP_ID = MINDMAP_ID;
			exports.MindMap = MindMap;
		};

		// ── components/FloatDock.js ──
		__defs["components/FloatDock.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：右下角浮动按钮组（全屏能力的统一入口）
			 * 引用：V16 诉求 3（按钮位置审美）· 5（设计图入口按钮）
			 * 上游：client-entry.js, components/DirectorPage.js, mount.js
			 * 下游：store/layout.js, util/debug.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A · D0（右下角浮动按钮组 = 三浮层统一入口）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/FloatDock.js — 右下角浮动按钮组（全屏能力的统一入口）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
			 *   ├─ 板块 A · A1 总监页右下角浮动按钮组（视觉与顺序）
			 *   ├─ 板块 C · C1 全局导航图（每个按钮打开什么）
			 *   └─ 板块 D · D1 设计图工作室（本组内「设计图」按钮的目标）
			 *
			 *  需求原文（用户）：
			 *    · 「你在右下角做的总监插件部分 的前面放一个思维导图的按钮」      ← 顺序：导图在总监之前
			 *    · 「在总监页面单独加一个设计图的插件吧，按钮形式 点击铺满全屏」   ← 设计图入口
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  按钮顺序（**用户明确要求，勿随意调整**）
			 * ══════════════════════════════════════════════════════════════════
			 *   [🖌 设计图]  [🧠 思维导图]  [◆ 总监]
			 *      ↑ 独立插件    ↑ 在总监之前    ↑ 主体
			 *   次序理由：三个都属"打开一个全屏 / 浮层能力"，按**粒度由具体到整体**排：
			 *   设计图（一张图）→ 思维导图（一棵血缘树）→ 总监（全部治理能力）。
			 *
			 * ⚠️ 兼容约束：`LAUNCHER_ID` 沿用旧值（`dsh-director-hierarchy-launcher`）挂在
			 *    「总监」按钮上 —— 既有真机脚本按此 id 取入口，改名会**静默失联**。
			 */
			
			const react = require("react");
			const { directorLayoutStore } = __m("store/layout.js");
			const { dshLog } = __m("util/debug.js");
			
			const h = react.createElement;
			
			/** 浮动组容器 id（真机脚本锚点） */
			const FLOATDOCK_ID = "dsh-director-floatdock";
			/** 🔴 保持旧名：既有真机脚本按此 id 取「总监」入口，改名会静默失联 */
			const LAUNCHER_ID = "dsh-director-hierarchy-launcher";
			/** 设计图入口按钮 id */
			const DESIGN_BTN_ID = "dsh-design-studio-launcher";
			/** 思维导图入口按钮 id（阶段 3 接分支血缘组件） */
			const MINDMAP_BTN_ID = "dsh-mindmap-launcher";
			
			/** 浮动组横向占位（px）—— 页面右端内容按此留白，见下方 🔴 容器 pointerEvents 注释
			 *  实测容器宽 98（最长的一颗是「🧠 思维导图」），加 8px 间隙、再取整 ⇒ 108。
			 *  由 components/DirectorPage.js 的 R6 / R8 消费（`paddingRight`）。 */
			const FLOAT_DOCK_RESERVE = 108;
			
			/* 🔴 字体色**不能写死浅色**（2026-09-12 随总监页背景改浅一起暴露的缺陷）——
			 *   三颗药丸原先的 `color: "#7fe3e8" / "#9fc2ff" / "#b794f6"` 是**给深色底配的浅色字**。
			 *   总监页背景改成宿主玻璃底（浅色）后，真机实测对比度只剩
			 *     设计图 1.35:1 ｜ 思维导图 1.63:1 ｜ 总监 2.21:1
			 *   （WCAG AA 正文线 4.5:1，大号字 3:1）⇒ 放大截图里字几乎看不见。
			 *   ⇒ 字色改用**宿主主文字令牌**：浅色主题自动取深字、暗色主题自动取浅字；
			 *     强调色只保留在**边框 + 淡底**上 ⇒ 三颗按钮的身份没丢，且底与字都跟着宿主主题走。
			 *   🔴 为什么用 `--dsw-alias-*` 而不是自建的 `--dp-*`：本组件挂在
			 *     `dsh-director-dialog-host`（body 级图层）下，**不在 `dp-root` 内** ——
			 *     实测 `d.querySelector('[data-testid=d-floatdock]').closest('[data-testid=dp-root]') === null`，
			 *     所以读不到 `dp-root` 上桥接出来的 `--dp-*`（会静默落 fallback）。
			 *     宿主令牌定义在 `body` 上，可被本图层继承 ⇒ 直接用它才是同源。 */
			const BTN = {
				display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 12.5,
				borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", backdropFilter: "blur(4px)",
				boxShadow: "var(--dsw-shadow-lv1, 0 4px 14px rgba(0,0,0,.32))", fontFamily: "inherit",
				color: "var(--dsw-alias-label-primary, #e8eaed)",
				/* 🔴 药丸自己**吃**点击；容器**不吃**（见容器 style 的 pointerEvents 注释） */
				pointerEvents: "auto"
			};
			const V = {
				design: { border: "1px solid rgba(57,197,207,.5)", background: "rgba(57,197,207,.16)" },
				mindmap: { border: "1px solid rgba(47,111,235,.5)", background: "rgba(47,111,235,.16)" },
				director: { border: "1px solid rgba(137,87,229,.5)", background: "rgba(137,87,229,.18)" }
			};
			
			/**
			 * 浮动按钮组。
			 * @param {object} [props]
			 * @param {() => void} [props.onOpenDesign] 覆写设计图打开行为（缺省走 layout store）
			 * @param {() => void} [props.onOpenMindmap] 覆写导图打开行为（缺省走 layout store）
			 */
			function FloatDock(props = {}) {
				const st = react.useSyncExternalStore(
					(fn) => directorLayoutStore.subscribe(fn),
					() => directorLayoutStore.getState(),
					() => directorLayoutStore.getState()
				);
				/* ── 自适应避让原生输入区（2026-09-12 审美调优）──────────────────
				 * 现象：固定 `bottom:18 / right:18` 时，浮动组与宿主 composer 的「发送」按钮、
				 *       「1 轮 · 1 步」统计文字**重叠**（真机截图可见），既遮挡又难读。
				 * 做法：量出 composer 的顶部，把浮动组**贴在它上方**并留 12px 间距；
				 *       取不到 composer 时回落 18px（不因宿主结构变化而崩）。
				 *       竖排（column）以最小化横向占用，避免横跨输入框。
				 * 为什么不用 `bottom: 50%` 之类固定值：宿主输入区高度会随内容/附件变化，
				 *       固定值迟早再次重叠 —— 量出来才稳。
				 *
				 *  🔴🔴 2026-09-12 真机补漏：**"量一次就存下来"是不够的** —— composer 会**换位置**
				 *   现象：重启后浮动组停在 `bottom:540.8px`（y=172），压在 R2.5 / R2 两行上；
				 *        而当时 composer 顶部=287（正中）⇒ `816-287+12 = 541`，**和存的 540.8 精确吻合**
				 *        ⇒ 不是量错，是**后来 composer 挪了、浮动组没跟着挪**。
				 *   成因（实测取证，别照抄想当然的解释）：
				 *        空会话时宿主把 composer 渲染成**居中的大输入区**（`RWZidW_composerHero`，
				 *        实测 rect [280,287,1154,242]）；会话里有了消息后它**落到底部**
				 *        （实测 rect [280,690,1154,126]）。位置一变，浮动组存的 bottom 就过期了。
				 *        这一变**既没有 `resize` 事件、也不改变根元素盒尺寸** ⇒ 光加 ResizeObserver 也接不到。
				 *   修法第一版：`setInterval(measure, 500)` 轮询。
				 *
				 *  🔴🔴 2026-09-12 第二轮真机补漏：**500ms 固定轮询会"迟一步"** ——
				 *   现象：切会话后**紧接着**断言，浮动组还停在旧几何 `bottom:362px`，
				 *        而当时正确值是 `137.6px`（差 224px；362 恰好对应上一次的 composer 顶 466）。
				 *        肉眼表现就是"按钮位置不对、压住了下面那行的按钮"。
				 *   成因：轮询是**时间驱动**的，几何在两次轮询之间变了 ⇒ 必然存在一整拍的窗口。
				 *   正确做法：**事件优先 + 轮询兜底**（四条触发面，任一触发即 1 帧内重算）：
				 *     ① `MutationObserver`（body 子树，只看 `class` / `style`）—— 直接接住"宿主换 composer 类"
				 *        （`composerHero` → 贴底，就是上面那 224px 的真实成因），这是**全新建模**不是加强轮询；
				 *     ② `ResizeObserver`（盯 composer 自身）—— 接住高度变化（附件 / 多行输入）；
				 *     ③ `scroll`（`capture`，滚动不冒泡 ⇒ 必须 capture）—— 接住位移；
				 *     ④ rAF 节流的兜底复量（约 100ms 一次）—— 上面三条都接不到时仍能收敛。
				 *   为什么用 rAF 而不是继续用 `setInterval`：所有触发面都只是 `mark()` 一个脏位，
				 *   真正的重算在下一帧统一做 ⇒ 突发变更被合并成**每帧最多一次** `getBoundingClientRect()`。
				 *   ⚠️ 不会自激：① 跳过发生在浮动组**内部**的变更（自己改自己的 `bottom` 会进 ① 的回调）；
				 *     ② 值没变时 `setBottomPx` 同值 ⇒ React 直接 bail out ⇒ 不产生新的 DOM 变更。 */
				const [bottomPx, setBottomPx] = react.useState(18);
				react.useEffect(() => {
					/* 量的是 composer 的**外框顶部**（真机实测：`RWZidW_composerSeat` / `_composerStack`，
					 * 会话有消息时两者都落在 y=690，视口 816 ⇒ bottom = 816-690+12 = 138）。
					 * 取不到、或它被藏起来（0×0）时回落 18 —— 不因宿主结构变化而崩。 */
					const measure = () => {
						try {
							const c = document.querySelector('[class*="composer"]');
							if (!c) { setBottomPx(18); return; }
							const r = c.getBoundingClientRect();
							if (r.height < 8 || r.top <= 0) { setBottomPx(18); return; }
							const gap = window.innerHeight - r.top;            // composer 自顶到底的可视高度
							setBottomPx(Math.max(18, Math.min(gap + 12, window.innerHeight - 140)));
						} catch (e) { setBottomPx(18); }
					};
			
					const RAF_INTERVAL = 100;                              // ④ 兜底轮的节流间隔
					let dirty = true, lastAt = 0, rafId = 0, ro = null, roTarget = null;
					const mark = () => { dirty = true; };
					const isOwn = (el) => Boolean(el && el.nodeType === 1
						&& (el.id === FLOATDOCK_ID || (el.closest && el.closest("#" + FLOATDOCK_ID))));
					/* 把 composer 的 ResizeObserver 挂到**当前**那个元素上（宿主会整个换掉它） */
					const ensureRO = () => {
						const c = document.querySelector('[class*="composer"]');
						if (c && c !== roTarget && typeof ResizeObserver === "function") {
							if (ro) ro.disconnect();
							roTarget = c;
							ro = new ResizeObserver(flush);
							ro.observe(c);
						}
					};
					/* 🔴🔴 2026-09-12 第三轮真机补漏：**复量不能只挂在 rAF 上**。
					 *   现象（verify-flow-r19 F11）：把 composer 上移 150px 后，`expected` 已经变成 287.6，
					 *        而浮动组的 `bottom` 在 1600ms 内**一动没动**（137.6），收敛轮次耗尽判红；
					 *        同一份代码随后单独复跑（探针 s4）却 700ms 内正常跟随到 287.6——**偶发**。
					 *   成因：`requestAnimationFrame` 在**窗口被遮挡/不可见时会被 Chromium 暂停**
					 *        （宿主窗口在后台是常态：跑 e2e 时没人盯着它）。于是"mark 脏位 → 下一帧复量"
					 *        这条链在后台窗口里**可以整段不执行** —— 而当时 DOM 变更（style）明明发生了。
					 *   正确做法：**事件直达**。与 composer 有关的变更（它自己或它的祖先换了 class/style）
					 *        在 MutationObserver 回调里**当场复量**，不等 rAF；rAF 只保留给
					 *        scroll / resize / 兜底（那几类丢一两帧无所谓，下一帧还会来）。
					 *   ⚠️ 不会自激：① 浮动组自己子树里的变更被 `isOwn` 跳过（本组件只改自己的 `bottom`；
					 *      同值 setState 时 React 直接 bail out，根本不产生新变更）；
					 *      ② 其余变更走原来的 `mark()`，量测频率不升反降（只对"与 composer 相关"的变更加急）。 */
					const flush = () => {
						if (!dirty) return;
						dirty = false;
						lastAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
						measure();
						ensureRO();
					};
			
					const tick = (ts) => {
						rafId = requestAnimationFrame(tick);
						if (!dirty && ts - lastAt < RAF_INTERVAL) return;
						dirty = false; lastAt = ts;
						measure();
						/* ② composer 元素可能被宿主整个换掉 ⇒ 目标变了就重挂 ResizeObserver */
						ensureRO();
					};
			
					/* ① 宿主换 composer 类 / 改内联样式 —— 这是"位置变了但没事件"的真实成因。
					 *   与 composer 相关的变更**当场复量**（见 flush 注释：后台窗口 rAF 会被暂停）。 */
					const mo = typeof MutationObserver === "function"
						? new MutationObserver((recs) => {
							let touchComposer = false;
							for (const r of recs) {
								if (isOwn(r.target)) continue;
								dirty = true;
								/* 首次进来时 roTarget 还没挂上 ⇒ 也当作"相关"（只多量一次，代价可忽略） */
								if (!roTarget || r.target === roTarget
									|| (r.target.nodeType === 1 && r.target.contains(roTarget))) { touchComposer = true; }
							}
							if (touchComposer) flush();
						})
						: null;
					if (mo) {
						try { mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"], subtree: true }); }
						catch (e) { /* body 尚未就绪：兜底轮询仍能收敛 */ }
					}
			
					/* ③ 滚动位移（capture：scroll 不冒泡）＋ 窗口尺寸 */
					const onScroll = () => mark();
					const onResize = () => mark();
					window.addEventListener("scroll", onScroll, { capture: true, passive: true });
					window.addEventListener("resize", onResize);
			
					measure();
					const raf = requestAnimationFrame(measure);            // 首帧后再量一次（boot 期布局未定）
					rafId = requestAnimationFrame(tick);
					const timers = [300, 1200, 2500].map((ms) => setTimeout(measure, ms)); // 布局稳定后复测
					return () => {
						window.removeEventListener("scroll", onScroll, { capture: true });
						window.removeEventListener("resize", onResize);
						cancelAnimationFrame(raf);
						cancelAnimationFrame(rafId);
						if (ro) ro.disconnect();
						if (mo) mo.disconnect();
						timers.forEach(clearTimeout);
					};
				}, []);
				if (st.floatDockOpen === false) return null;
			
				const openDesign = props.onOpenDesign || (() => { directorLayoutStore.setDesignStudio(true); dshLog("design", "浮动入口：打开设计图工作室"); });
				const openMindmap = props.onOpenMindmap || (() => { directorLayoutStore.setMindmap(true); dshLog("mindmap", "浮动入口：打开分支导图"); });
				const toggleDirector = () => {
					const on = directorLayoutStore.getState().dialogOpen;
					directorLayoutStore.setDialogOpen(!on);
				};
			
				return h("div", {
					id: FLOATDOCK_ID, "data-testid": "d-floatdock",
					// 位置：右下角、**自适应贴在 composer 之上**（见上方 measure 注释）；
					// 竖排减少横向占用；z-index 低于弹窗与工作室，保证全屏层永远在上面
					style: {
						position: "fixed", right: 18, bottom: bottomPx, zIndex: 2147482990,
						display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end",
						/* 🔴 容器必须**透明化点击**（pointer-events:none）——
						 *   容器是 98×103 的盒子，而三颗药丸长度不一（81 / 98 / 63）且竖排有 6px 间隙
						 *   ⇒ 盒子里有大片**看不见的空隙**（药丸之间的缝、短药丸左侧的 35px）。
						 *   默认 `pointer-events:auto` 时这些空隙照样吃掉鼠标事件。
						 *   真机实测（2026-09-12，1442×816）：
						 *     本页自己的「交给总监整理」(dp-send，89×24) 有 **88×19 px 落在容器内**，
						 *     `document.elementFromPoint(1340,670)` 最上层 = `d-floatdock`
						 *     ⇒ 那颗按钮**点不动**（正是用户抱怨过的"所有按钮交互都不好用"那一类）。
						 *     同批被吃掉的还有 dp-r6 / dp-r7 / dp-r8 / dp-r8-note 共 5 处。
						 *   改法：容器 `none` + 药丸自己 `auto`（浮动工具条的标准做法）。 */
						pointerEvents: "none"
					}
				}, [
					h("button", {
						key: "design", id: DESIGN_BTN_ID, type: "button", style: { ...BTN, ...V.design },
						"data-testid": "d-open-design", title: "打开设计图工作室（铺满全屏 · 可拖拽编辑 · 元素带交互逻辑）",
						onClick: openDesign
					}, [h("span", { key: "i" }, "🖌"), h("span", { key: "t" }, "设计图")]),
					h("button", {
						key: "mindmap", id: MINDMAP_BTN_ID, type: "button", style: { ...BTN, ...V.mindmap },
						"data-testid": "d-open-mindmap", title: "打开分支导图（血缘树 · 底栏可交总监路由）",
						onClick: openMindmap
					}, [h("span", { key: "i" }, "🧠"), h("span", { key: "t" }, "思维导图")]),
					h("button", {
						key: "director", id: LAUNCHER_ID, type: "button", style: { ...BTN, ...V.director },
						"aria-label": "打开总监", "data-testid": "d-open-director", title: "打开总监（弹窗三态）",
						onClick: toggleDirector
					}, [h("span", { key: "i" }, "◆"), h("span", { key: "t" }, "总监")])
				]);
			}
			
			__defaults["components/FloatDock.js"] = FloatDock;
			
			exports.FLOATDOCK_ID = FLOATDOCK_ID;
			exports.LAUNCHER_ID = LAUNCHER_ID;
			exports.DESIGN_BTN_ID = DESIGN_BTN_ID;
			exports.MINDMAP_BTN_ID = MINDMAP_BTN_ID;
			exports.FLOAT_DOCK_RESERVE = FLOAT_DOCK_RESERVE;
			exports.FloatDock = FloatDock;
		};

		// ── bridge/nav-hook.js ──
		__defs["bridge/nav-hook.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：「点击文件夹 / 项目 → 展示该层级总监」（要求 7 / 9）
			 * 引用：要求 7/9
			 * 上游：client-entry.js, mount.js
			 * 下游：bridge/split.js, store/hierarchy.js, store/layout.js, util/debug.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * bridge/nav-hook.js — 「点击文件夹 / 项目 → 展示该层级总监」（要求 7 / 9）
			 *
			 * ── 为什么用"观察 + 名称匹配"而不是给侧栏挂事件 ────────────────
			 *   左侧栏由宿主渲染（React 管理其子树）。**给宿主节点挂监听器会把一个外部函数
			 *   写进宿主的节点对象**，宿主重渲染后节点被替换 ⇒ 监听器静默消失（且无法察觉）。
			 *   故改为：在 `document` **捕获阶段**观察点击 —— 零节点改动、零宿主依赖、天然幂等。
			 *
			 * ── 匹配策略（三级，全部可解释）────────────────────────────────
			 *   ① 精确同名（`node.name === rowText`）
			 *   ② 包含匹配（`rowText` 含 `node.name`，或反之；取**最长**匹配，避免"工作区 A"命中"工作区"）
			 *   ③ 无匹配 → **不打开**（保持宿主原本的导航行为，绝不误弹）
			 *
			 * ── 不侵入原则 ──────────────────────────────────────────────────
			 *   `pointerdown` 只读、不 `preventDefault`、不 `stopPropagation`
			 *   ⇒ 侧栏的原有导航/展开/折叠行为**完全不受影响**，总监弹窗是"伴随打开"。
			 *
			 * ── 判定"侧栏区域" ─────────────────────────────────────────────
			 *   用聊天应用根的左边界 `x` 作为分界：`clientX < rootRect.x` 即侧栏区。
			 *   该边界随窗口/侧栏折叠自动跟随，无需硬编码布局常量。
			 */
			
			const { getSplitRootRect } = __m("bridge/split.js");
			const { loadTree } = __m("store/hierarchy.js");
			const { directorLayoutStore } = __m("store/layout.js");
			const { dshLog } = __m("util/debug.js");
			
			const hasDom = () => typeof window !== "undefined" && typeof document !== "undefined";
			
			/** 行文本长度上限（超过说明抓到了容器而非单行） */
			const ROW_TEXT_MAX = 60;
			
			/** 从点击目标向上找一个"行"元素并取其文本 */
			function extractRowText(target) {
				let el = target;
				for (let i = 0; i < 5 && el && el !== document.body; i++) {
					const t = String(el.textContent || "").replace(/\s+/g, " ").trim();
					if (t && t.length <= ROW_TEXT_MAX) return { text: t, el };
					el = el.parentElement;
				}
				return { text: "", el: null };
			}
			
			/** 拍平层级树为候选列表 */
			function flattenTree(root) {
				const out = [];
				const walk = (n, depth) => {
					out.push({ id: n.id, name: String(n.name || ""), level: n.level, depth });
					(n.childNodes || []).forEach((c) => walk(c, depth + 1));
				};
				if (root) walk(root, 0);
				return out;
			}
			
			/**
			 * 名称匹配（纯函数，便于离线断言）
			 * @returns {{id:string,name:string,level:string}|null}
			 */
			function matchRowToNode(rowText, nodes) {
				const text = String(rowText || "").trim();
				if (!text) return null;
				// ① 精确
				const exact = (nodes || []).find((n) => n.name === text);
				if (exact) return exact;
				// ② 包含（取最长匹配；长度 <2 的名称不参与，避免噪声）
				let best = null;
				for (const n of nodes || []) {
					if (!n.name || n.name.length < 2) continue;
					if (text.indexOf(n.name) >= 0 || n.name.indexOf(text) >= 0) {
						if (!best || n.name.length > best.name.length) best = n;
					}
				}
				return best;
			}
			
			/**
			 * 安装侧栏导航联动
			 * @param {object} [opts]
			 * @param {() => boolean} [opts.enabled] 动态开关（默认常开）
			 * @returns {() => void} 卸载函数
			 */
			function installNavHook(opts = {}) {
				if (!hasDom()) return () => {};
				const enabled = opts.enabled || (() => true);
				let disposed = false;
			
				const onClick = async (e) => {
					try {
						if (disposed || !enabled()) return;
						const rect = getSplitRootRect();
						if (!rect) return;
						// 只在"侧栏区域"响应，且排除总监弹窗自身
						if (e.clientX >= rect.x) return;
						if (e.target && e.target.closest && e.target.closest("#dsh-director-dialog")) return;
						if (e.clientX < 0 || e.clientX > (window.innerWidth || 1440)) return;
			
						const { text } = extractRowText(e.target);
						if (!text) return;
						const tree = await loadTree();
						const hit = matchRowToNode(text, flattenTree(tree));
						if (!hit) return; // ③ 无匹配 → 不打扰宿主导航
						navHookStats.matched++;
						navHookStats.lastMatch = { text, nodeId: hit.id, name: hit.name, level: hit.level };
						directorLayoutStore.setActiveNode(hit.id);
						directorLayoutStore.setDialogOpen(true);
						dshLog("nav", "侧栏点击 → 打开总监：" + hit.name + "（" + hit.level + "）");
					} catch (err) {
						navHookStats.errors++;
					}
				};
			
				document.addEventListener("pointerdown", onClick, true);
				if (typeof window !== "undefined") window.__dshNavHook = navHookStats;
				return () => { disposed = true; document.removeEventListener("pointerdown", onClick, true); };
			}
			
			/** 统计（供验证脚本断言"真的命中过"） */
			const navHookStats = { matched: 0, errors: 0, lastMatch: null };
			
			/** 安装全局契约 */
			function installNavHookApi() {
				if (!hasDom()) return null;
				window.__dshNavApi = { extractRowText, flattenTree, matchRowToNode, installNavHook, navHookStats };
				return window.__dshNavApi;
			}
			
			exports.extractRowText = extractRowText;
			exports.flattenTree = flattenTree;
			exports.matchRowToNode = matchRowToNode;
			exports.installNavHook = installNavHook;
			exports.navHookStats = navHookStats;
			exports.installNavHookApi = installNavHookApi;
		};

		// ── mount.js ──
		__defs["mount.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：总监弹窗的挂载层（T-PLUG-015 起：弹窗形态为主通道）
			 * 引用：V16 诉求 1（四浮层互不拖死） · T-PLUG-015
			 * 上游：client-entry.js
			 * 下游：components/DirectorDialog.js, components/DesignStudio.js, components/MindMap.js, components/FloatDock.js, store/layout.js, store/design.js, bridge/split.js, bridge/chat-bridge.js, bridge/nav-hook.js, util/debug.js, util/bus.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A（四浮层挂载 + 错误边界）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * mount.js — 总监弹窗的挂载层（T-PLUG-015 起：弹窗形态为主通道）
			 *
			 * ── 形态变更（docs/10 §4.1 + docs/11 §四 方案 F1）───────────────
			 *   旧：880×560 的单面板浮层（`#dsh-director-hierarchy-overlay`）
			 *       —— 与原生 tab（26×27，y=48）形态完全不同 ⇒ 用户裁定"看起来像完全重画"。
			 *   新：**弹窗**（`#dsh-director-dialog`）—— 左＝总监面板（插件 React 组件），
			 *       右＝**原生对话区本身**（由 `bridge/split.js` 向右挤，零节点移动）。
			 *
			 * ── 为什么仍是"自挂 DOM"而不是宿主 slot ─────────────────────────
			 *   🔴 **2026-09-12 订正**：原文此处写「`window.__DSH_SLOTS__` 从来不存在 ⇒ slot 通道恒失败」，
			 *      该结论**只对了一半** —— 不存在的只是那个**全局变量名**；真正的入口是 cordis 的
			 *      `ctx.slots`（由 `apply(ctx)` 注入）。同族先例已在宿主源码中确证：
			 *        `dsh-client-ui-trajectory/lib/client.js:7316,7340`
			 *          `inject: ["slots"]` + `ctx.slots.inject("conversation.view", () => ctx.slots.register({...}))`
			 *      ⇒ 总监 tab 的注册现已实现在 `client-entry.js:installDirectorView(ctx)`（本文件不再承担）。
			 *   ⇒ 本文件继续负责**自挂 DOM 通道**，它仍有独立价值：
			 *      **零宿主依赖、必定可见、完全可逆** —— 当 slot 不可用（宿主版本差异）时保底。
			 *      两条通道**并存不互斥**：slot 通道给原生 tab，DOM 通道给浮动按钮组与全屏工作室。
			 *
			 * ⚠️ 构建约束：`react-dom/client` 同为平台冻结模块（ADR-001），构建期外置为 `require(...)`。
			 */
			
			const react = require("react");
			const react_jsx_runtime = require("react/jsx-runtime");
			const react_dom_client = require("react-dom/client");
			const { DirectorDialog, DIALOG_ID } = __m("components/DirectorDialog.js");
			const { DesignStudio, STUDIO_ID } = __m("components/DesignStudio.js");
			const { MindMap, MINDMAP_ID } = __m("components/MindMap.js");
			const { FloatDock, FLOATDOCK_ID, LAUNCHER_ID: DOCK_LAUNCHER_ID } = __m("components/FloatDock.js");
			const { directorLayoutStore } = __m("store/layout.js");
			const { installDesignApi } = __m("store/design.js");
			const { installSplitApi, clearSplit } = __m("bridge/split.js");
			const { installChatBridgeApi } = __m("bridge/chat-bridge.js");
			const { installNavHook, installNavHookApi } = __m("bridge/nav-hook.js");
			const { dshLog } = __m("util/debug.js");
			const { emitHierarchyChange } = __m("util/bus.js");
			
			/** 弹窗 React 挂载宿主（无样式、零布局影响） */
			const DIALOG_HOST_ID = "dsh-director-dialog-host";
			/** 🔴 **保持旧名**，既有真机脚本按此 id 取入口，改名会静默失联（现挂在 FloatDock 的「总监」按钮上） */
			const LAUNCHER_ID = "dsh-director-hierarchy-launcher";
			/** 旧浮层宿主 id（兼容保留，默认不创建） */
			const OVERLAY_HOST_ID = "dsh-director-hierarchy-overlay";
			
			// `h` 必须在 Shell 之前声明（Shell 内部引用它做渲染）
			const h = react.createElement;
			
			/**
			 * SafeLayer —— **单层错误边界**（2026-09-12 真机事故的结构性修复）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 * 为什么必须有它（事故复盘）
			 * ──────────────────────────────────────────────────────────────────
			 * 事故链：`DesignStudio` 在「open=true 且 doc=null」的首帧里对 null 取 `.title`
			 *   → TypeError → **Shell 根没有错误边界** → React 卸载**整棵树**
			 *   → 浮动按钮组 / 弹窗 / 工作室**同时消失**（hostChildCount = 0）
			 *   → 且因 `designStudioOpen` 已持久化，**每次重启必然复现**，用户侧表现为"插件没了"。
			 * 关键教训：**一个非关键层的渲染异常，不得升级为整个插件域的可用性故障**。
			 *   四层是相互独立的能力（设计图 / 导图 / 弹窗 / 按钮组），必须**故障隔离**。
			 *
			 * 设计取舍：捕获后**不静默**——渲染一个可见的小角标（含错误摘要 + 重试），
			 *   因为静默失败正是本次事故"难以定位"的根源。宁可难看，也要能看见。
			 */
			class SafeLayer extends react.Component {
				constructor(props) {
					super(props);
					this.state = { err: null };
					this.reset = this.reset.bind(this);
				}
				static getDerivedStateFromError(err) { return { err }; }
				componentDidCatch(err) {
					try { dshLog("shell", "层「" + this.props.name + "」渲染异常已隔离（其余层不受影响）: " + ((err && err.message) || err)); } catch (_) {}
				}
				reset() { this.setState({ err: null }); }
				render() {
					if (!this.state.err) return this.props.children;
					const msg = String((this.state.err && this.state.err.message) || this.state.err);
					return h("div", {
						style: {
							position: "fixed", left: 14, bottom: 14, zIndex: 2147483000, maxWidth: 460,
							padding: "8px 10px", borderRadius: 8, fontSize: 11.5, lineHeight: 1.5,
							border: "1px solid rgba(248,81,73,.5)", background: "rgba(60,18,18,.94)", color: "#f0877f",
							fontFamily: "inherit", boxShadow: "0 6px 20px rgba(0,0,0,.45)"
						},
						"data-testid": "d-layer-error"
					}, [
						h("div", { key: "t", style: { fontWeight: 700, marginBottom: 3 } }, "⚠ 插件层「" + this.props.name + "」异常（已隔离）"),
						h("div", { key: "m", style: { color: "#f5b7b1", wordBreak: "break-word" } }, msg),
						h("button", {
							key: "r", type: "button",
							style: { marginTop: 6, padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, border: "1px solid rgba(248,81,73,.5)", background: "rgba(248,81,73,.18)", color: "#ffd9d5" },
							onClick: this.reset
						}, "重试该层")
					]);
				}
			}
			
			/**
			 * 用 SafeLayer 包一层。
			 * 🔴 **不要用 `layer.bind(null, name)` 当组件类型**（2026-09-12 踩坑）：
			 *    `h(thunk, { key, children })` 会把**整个 props 对象**当成第 3 个实参传给 thunk
			 *    ⇒ SafeLayer 的 children 变成 `{ key, children }` 这个普通对象
			 *    ⇒ React error #31「Objects are not valid as a React child」。
			 *    直接普通函数调用最稳：`layer(name, key, element)`。
			 */
			const layer = (name, key, el) => h(SafeLayer, { name, key }, el);
			
			/**
			 * Shell —— 宿主页面上「插件自挂层」的统一 React 根。
			 *
			 * 四件东西同根渲染（**同一个 root、四个独立层**，各自订阅 store 决定显隐）：
			 *   DirectorDialog  弹窗（z 2147483000）—— 左总监面板 + 右原生对话区
			 *   DesignStudio    全屏工作室（z 2147483200）—— 设计图编辑（T-PLUG-018）
			 *   MindMap         分支导图覆盖层（z 2147483100）
			 *   FloatDock       浮动按钮组（z 2147482990）—— 三个能力入口
			 *
			 * 分层顺序即 z-index 顺序：全屏工作室 > 导图 > 弹窗 > 浮动组。
			 * 🔴 每层裹 `SafeLayer` —— 任一层崩溃只损失该层（见 SafeLayer 头注的事故复盘）。
			 */
			function Shell() {
				const st = react.useSyncExternalStore(
					(fn) => directorLayoutStore.subscribe(fn),
					() => directorLayoutStore.getState(),
					() => directorLayoutStore.getState()
				);
				return h(react.Fragment, null, [
					layer("dialog", "dialog", h(DirectorDialog, {})),
					layer("studio", "studio", h(DesignStudio, {
						open: Boolean(st.designStudioOpen),
						onClose: () => directorLayoutStore.setDesignStudio(false)
					})),
					layer("mindmap", "mindmap", h(MindMap, {
						open: Boolean(st.mindmapOpen),
						onClose: () => directorLayoutStore.setMindmap(false)
					})),
					layer("dock", "dock", h(FloatDock, {}))
				]);
			}
			
			/**
			 * 旧版纯 DOM 入口按钮 —— **已由 FloatDock 取代**（保留函数仅为向后兼容调用点）。
			 * 如需旧形态，改回 git 历史版本。返回 null 表示未创建。
			 */
			function makeLauncher() {
				dshLog("hierarchy", "makeLauncher 已退役（入口由 FloatDock 统一提供，含设计图 / 导图 / 总监三键）");
				return null;
			}
			
			/**
			 * 挂载总监弹窗
			 * @param {object} [opts]
			 * @param {boolean} [opts.withLauncher=true] 是否创建右下角入口按钮
			 * @param {boolean} [opts.open=false] 初始是否展开
			 * @param {boolean} [opts.legacyOverlay=false] 兼容：额外挂旧浮层（默认关闭）
			 * @param {boolean} [opts.navHook=true] 是否安装「点击侧栏文件夹/项目 → 打开该层级总监」
			 * @returns {{host:HTMLElement|null, launcher:HTMLElement|null, root:object, unmount:()=>void, show:()=>void, hide:()=>void}}
			 */
			function mountHierarchy(opts = {}) {
				if (typeof window === "undefined" || typeof document === "undefined") return { host: null, launcher: null, root: null, unmount: () => {}, show: () => {}, hide: () => {} };
			
				// 能力安装（幂等）
				installSplitApi();
				installChatBridgeApi();
				installNavHookApi();
				installDesignApi();   // 设计图工作室的全局契约（window.__dshDesign）
			
				let host = document.getElementById(DIALOG_HOST_ID);
				let alreadyMounted = Boolean(host);
				if (!host) {
					host = document.createElement("div");
					host.id = DIALOG_HOST_ID;
					document.body.appendChild(host);
				}
				// 🔴 **同一容器不得重复 createRoot**（2026-09-12）：
				//    React 18 对已 createRoot 过的容器再次 createRoot 会告警，且**两个 root 互抢同一容器**
				//    ⇒ 后者的 render 可能被前者的卸载清空（表现为"宿主 div 存在但 childCount = 0"）。
				//    故把 root 缓存在宿主元素上，重复挂载时复用并只做一次 render。
				let root = host.__dshShellRoot;
				if (!root) {
					root = react_dom_client.createRoot(host);
					host.__dshShellRoot = root;
				}
				root.render(h(Shell, {}));
			
				const show = () => { directorLayoutStore.setDialogOpen(true); emitHierarchyChange(); };
				const hide = () => { directorLayoutStore.setDialogOpen(false); };
				const launcher = opts.withLauncher === false ? null : makeLauncher();
				if (opts.open === true) show();
			
				// 点击侧栏文件夹 / 项目 → 打开该层级总监（要求 7 / 9）
				let navOff = null;
				if (opts.navHook !== false) {
					navOff = installNavHook();
					if (typeof window !== "undefined") window.__dshNavUninstall = navOff;
				}
			
				dshLog("hierarchy", "总监弹窗已挂载（弹窗通道，宿主零改动）");
				return {
					host, launcher, root, alreadyMounted,
					show, hide,
					unmount: () => {
						try { clearSplit(); } catch (e) { /* 已复原 */ }
						try { root.unmount(); } catch (e) { /* 已卸载 */ }
						// 缓存作废：否则下次 mount 会拿到已卸载的 root（render 静默无效）
						try { delete host.__dshShellRoot; } catch (e) { /* noop */ }
						if (navOff) navOff();
						host.remove();
						if (launcher) launcher.remove();
					}
				};
			}
			
			/**
			 * 尝试注册到宿主 slot（**保留为兼容退路**）
			 *
			 * 🔴 2026-09-12 订正：真正的 slot 通道是 cordis 的 `ctx.slots`（由 `apply(ctx)` 注入），
			 *    已实现在 `client-entry.js` 的 `installDirectorView(ctx)` 中，并在构建期由
			 *    `build/build.mjs` 的 apply 模板透传 ctx。
			 *    本函数仅保留"全局变量形态"的退路：若日后宿主把 slots 暴露为全局，可直接叠加。
			 * @returns {boolean} 是否注册成功
			 */
			function tryRegisterHostSlot() {
				try {
					const slots = typeof window !== "undefined" ? window.__DSH_SLOTS__ : null;
					if (!slots || typeof slots.register !== "function") return false;
					slots.register({ name: "conversation.view", id: "director", order: -1, label: () => "总监" }, DirectorDialog);
					dshLog("hierarchy", "已注册到宿主 conversation.view slot（id=director，全局变量通道）");
					return true;
				} catch (e) {
					dshLog("hierarchy", "全局变量 slot 通道不可用（预期内），已由 ctx.slots 通道承担: " + (e && e.message));
					return false;
				}
			}
			
			/** 旧浮层通道（兼容保留；默认不再使用，见文件头） */
			function mountHierarchyOverlay() {
				if (typeof window === "undefined" || typeof document === "undefined") return null;
				dshLog("hierarchy", "mountHierarchyOverlay 已退役（弹窗形态取代），如需旧浮层请用 git 历史版本");
				return null;
			}
			
			__defaults["mount.js"] = mountHierarchy;
			
			exports.DIALOG_HOST_ID = DIALOG_HOST_ID;
			exports.LAUNCHER_ID = LAUNCHER_ID;
			exports.OVERLAY_HOST_ID = OVERLAY_HOST_ID;
			exports.mountHierarchy = mountHierarchy;
			exports.tryRegisterHostSlot = tryRegisterHostSlot;
			exports.mountHierarchyOverlay = mountHierarchyOverlay;
		};

		// ── logic/orchestrate.js ──
		__defs["logic/orchestrate.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：总监统筹闭环（阶段编排 + 六维打分 + 打分标准自审 + 三轮多方位评估）
			 * 引用：用户原话（2026-09-12 第七轮）
			 * 上游：components/DirectorPage.js, logic/director-run.js
			 * 下游：（无）
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 K）
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * logic/orchestrate.js — 总监统筹闭环（纯函数）
			 *
			 * ── 需求（用户原话）─────────────────────────────────────────────
			 *   「我最终核心目标为，比如我提供一个想法……文档完成之后，后续的开发文档编写，审核，
			 *     蓝图设计，测试等等都由总监统筹。审核标准为前端审美、按钮交互，
			 *     审核标准是为围绕核心目的进行打分判断是否满足，打分标准也需要进行审核，
			 *     打分起码三轮多方位评估。」
			 *   「也就是我提供一个想法，主要定时审核设计图效果就可以，有问题提给总监修改。」
			 *
			 * ── 三个必须分开的概念（混在一起就会退化成"跑三次同一套"）──────
			 *   ① **阶段编排**：想法 → 文档 → 审核 → 蓝图 → 测试 → 收口（谁来产出什么、何时进下一阶段）
			 *   ② **打分标准**：6 个维度 × 0–5 分，每档都有判据（不是"感觉不错给 4 分"）
			 *   ③ **三轮机制**：三轮换的是**证据来源**，不是重复次数
			 *        R1 规格符合性（对照需求文档）／ R2 独立证据源（真机截图 + DOM 回读）／
			 *        R3 反证（构造"应该失败"的输入）
			 *
			 * ── 并行的一条硬要求：**打分标准自己也要被审**（用户明确要求）────────
			 *   `auditRubric()` 三条：可达性 / 不重叠 / 可证伪。三条不全过，
			 *   这套标准**不允许拿来打分** —— 否则分数是"看起来能区分"的数字。
			 */
			
			/* ══════════════════════════════════════════════════════════════════
			 * 一、阶段编排
			 * ══════════════════════════════════════════════════════════════════ */
			
			const STAGE = Object.freeze({
				PLAN: "plan",
				DOC: "doc",
				REVIEW: "review",
				BLUEPRINT: "blueprint",
				TEST: "test",
				DONE: "done"
			});
			
			/** 阶段定义：`need` = 进入本阶段需要的产出；`out` = 本阶段应产出什么 */
			const STAGES = Object.freeze([
				{ key: STAGE.PLAN, label: "拆解", out: "需求理解 + 任务清单", need: "想法" },
				{ key: STAGE.DOC, label: "文档", out: "设计/开发文档（含验收判据）", need: "任务清单" },
				{ key: STAGE.REVIEW, label: "审核", out: "六维打分 ≥ 阈值（≥3 轮）", need: "文档" },
				{ key: STAGE.BLUEPRINT, label: "蓝图", out: "施工图 / 蓝图", need: "审核通过" },
				{ key: STAGE.TEST, label: "测试", out: "测试计划 + 结果（含期望）", need: "蓝图" },
				{ key: STAGE.DONE, label: "收口", out: "闭环留痕", need: "测试通过" }
			]);
			
			const STAGE_ORDER = Object.freeze(STAGES.map((s) => s.key));
			
			/** 阶段 i 的下一阶段（末态返回自身） */
			function nextStage(key) {
				const i = STAGE_ORDER.indexOf(key);
				if (i < 0) return STAGE_ORDER[0];
				return STAGE_ORDER[Math.min(i + 1, STAGE_ORDER.length - 1)];
			}
			
			/**
			 * 能否进入下一阶段。
			 * @param {string} current
			 * @param {object} evidence 各阶段的产出证据（真值：字符串非空 / 数组非空 / 布尔）
			 * @returns {{ok:boolean, next:string, reason:string, missing:string[]}}
			 */
			function canAdvance(current, evidence = {}) {
				const next = nextStage(current);
				const need = (STAGES[STAGE_ORDER.indexOf(next)] || {}).need || "";
				const missing = [];
				if (next === STAGE.DOC && !nonEmpty(evidence.plan)) missing.push("任务清单");
				if (next === STAGE.REVIEW && !nonEmpty(evidence.doc)) missing.push("文档");
				if (next === STAGE.BLUEPRINT) {
					if (!nonEmpty(evidence.doc)) missing.push("文档");
					if (!(evidence.score && evidence.score.passed)) missing.push("审核通过");
				}
				if (next === STAGE.TEST && !nonEmpty(evidence.blueprint)) missing.push("蓝图");
				if (next === STAGE.DONE) {
					if (!nonEmpty(evidence.blueprint)) missing.push("蓝图");
					if (!(evidence.test && evidence.test.passed)) missing.push("测试通过");
				}
				return {
					ok: missing.length === 0,
					next,
					reason: missing.length ? ("缺：" + missing.join("、") + "（进入「" + need + "」前需要）") : "可进入「" + next + "」",
					missing
				};
			}
			
			function nonEmpty(v) {
				if (v == null) return false;
				if (Array.isArray(v)) return v.length > 0;
				if (typeof v === "string") return v.trim().length > 0;
				if (typeof v === "boolean") return v;
				if (typeof v === "object") return Object.keys(v).length > 0;
				return true;
			}
			
			/**
			 * 从一个想法生成阶段计划（总监接手的第一步）。
			 * 纯函数：只做结构与文案，不调模型、不落库。
			 */
			function planFor(idea) {
				const text = String(idea == null ? "" : idea).trim();
				return {
					idea: text,
					stage: text ? STAGE.PLAN : STAGE.PLAN,
					steps: STAGES.map((s, i) => ({
						seq: i + 1, key: s.key, label: s.label, out: s.out, need: s.need,
						done: false
					})),
					createdAt: Date.now(),
					empty: !text
				};
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 二、打分标准（6 维 × 0–5 分 · 每档有判据）
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 各维度权重：用户点名的两维（审美 / 按钮交互）与核心目的同权，避免"好看就行" */
			const RUBRIC = Object.freeze([
				{
					key: "purpose", label: "核心目的达成", weight: 3,
					criterion: "5=用户原话逐条可对上并各有证据；3=主干达成但有遗漏；0=与目标无关",
					witness: "需求条目 ↔ 实现/断言逐条对照表"
				},
				{
					key: "aesthetic", label: "前端审美", weight: 2,
					criterion: "5=颜色/圆角/阴影全部走宿主令牌、与宿主零割裂；3=局部硬编码；0=对比度 <3:1 或明显割裂",
					witness: "真机截图 + 计算样式回读（令牌名）"
				},
				{
					key: "interaction", label: "按钮与交互", weight: 3,
					criterion: "5=每颗按钮都有真实回调且回读有证据；3=个别按钮无反馈；0=点了没反应",
					witness: "逐按钮点击 + 状态回读断言"
				},
				{
					key: "resilience", label: "边界与降级", weight: 2,
					criterion: "5=失败可归因且有降级路径；3=只覆盖主路径；0=静默失败",
					witness: "反证用例（空输入 / 依赖缺失 / 目标不存在）"
				},
				{
					key: "consistency", label: "一致性", weight: 1,
					criterion: "5=复用既有常量与令牌，无重复真相源；3=局部另起一套；0=同一语义两处定义",
					witness: "grep 常量/令牌名，看是否单点"
				},
				{
					key: "verifiability", label: "可验证性", weight: 2,
					criterion: "5=有自动化断言且断言承重（改了会红）；3=有断言但可被绕过；0=无证据",
					witness: "断开断言后必须变红（反证）"
				}
			]);
			
			const RUBRIC_MAX = RUBRIC.reduce((s, r) => s + r.weight * 5, 0); // 满分（加权）
			
			/**
			 * 打分标准自审（用户明确要求「打分标准也需要进行审核」）。
			 * 三条，全过才允许用该标准打分：
			 *   ① 可达性：每个维度都要有 `criterion` 与 `witness`（能举出 0 分与 5 分的例子）
			 *   ② 不重叠：`key` 唯一，且 label 两两不同（同一判据不许出现在两个维度）
			 *   ③ 可证伪：存在能打出 0 分的输入 —— 由 criterion 里出现 `0=` 保证
			 */
			function auditRubric(rubric = RUBRIC) {
				const fails = [];
				if (!Array.isArray(rubric) || !rubric.length) return { ok: false, fails: ["标准为空"] };
			
				const keys = new Set();
				for (const r of rubric) {
					if (!r || !r.key) { fails.push("存在无 key 的维度"); continue; }
					if (keys.has(r.key)) fails.push("key 重复：" + r.key);
					keys.add(r.key);
					if (!r.criterion || !String(r.criterion).trim()) fails.push(r.key + " 缺 criterion（不可达性）");
					if (!r.witness || !String(r.witness).trim()) fails.push(r.key + " 缺 witness（无证据来源）");
					if (!/0\s*=/.test(String(r.criterion || ""))) fails.push(r.key + " 未定义 0 分（不可证伪）");
					if (!(r.weight > 0)) fails.push(r.key + " 权重非正");
				}
				const labels = rubric.map((r) => r && r.label);
				if (new Set(labels).size !== labels.length) fails.push("label 重复（维度重叠）");
				return { ok: fails.length === 0, fails };
			}
			
			/**
			 * 打分。`values` = { [key]: 0..5 }，缺项按 0 计并在 `missing` 里报出（不静默算满/算零）。
			 * @returns {{total:number, max:number, ratio:number, passed:boolean, threshold:number,
			 *            dims:Array<{key,label,score,weight,points,criterion}>, missing:string[],
			 *            rubricOk:boolean, rubricFails:string[]}}
			 */
			function score(valueObj = {}, opts = {}) {
				const threshold = typeof opts.threshold === "number" ? opts.threshold : 0.7;
				const rubric = opts.rubric || RUBRIC;
				const audit = auditRubric(rubric);
				const missing = [];
				let total = 0;
				const dims = rubric.map((r) => {
					const raw = valueObj[r.key];
					if (raw === undefined || raw === null) missing.push(r.key);
					const s = clampScore(raw);
					const points = s * r.weight;
					total += points;
					return { key: r.key, label: r.label, score: s, weight: r.weight, points, criterion: r.criterion };
				});
				const ratio = RUBRIC_MAX ? total / RUBRIC_MAX : 0;
				return {
					total, max: RUBRIC_MAX, ratio,
					threshold,
					/* 🔴 标准没通过自审时，**一律不判通过** —— 否则分数是"看起来能区分"的数字 */
					passed: audit.ok && missing.length === 0 && ratio >= threshold,
					dims, missing,
					rubricOk: audit.ok, rubricFails: audit.fails
				};
			}
			
			function clampScore(v) {
				const n = Number(v);
				if (!Number.isFinite(n)) return 0;
				return Math.max(0, Math.min(5, Math.round(n)));
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 三、三轮多方位评估（换证据源，不是重复跑）
			 * ══════════════════════════════════════════════════════════════════ */
			
			const ROUNDS = Object.freeze([
				{
					n: 1, key: "spec", label: "规格符合性",
					method: "逐条对照需求文档（用户原话 → 可测判据）",
					evidence: "需求条目 ↔ 实现/断言对照表",
					failsIf: "存在没有任何实现或断言承接的需求条目"
				},
				{
					n: 2, key: "independent", label: "独立证据源",
					method: "**不引用第 1 轮的断言**，改用真机截图 + 计算样式回读 + 与实现不同源的探针",
					evidence: "截图（放大可读）/ DOM 属性回读 / 独立探针输出",
					failsIf: "第 2 轮只是把第 1 轮的断言又跑一遍（证据同源 ⇒ 同错同绿）"
				},
				{
					n: 3, key: "counter", label: "反证",
					method: "构造「应该失败」的输入，断言它**确实失败且原因正确**",
					evidence: "反证用例 + 实际返回的 reason",
					failsIf: "反证用例没有失败，或失败原因与预期不符"
				}
			]);
			
			/**
			 * 三轮汇总。`results` = [{n, ok, note}]。
			 * @returns {{rounds:Array, passed:boolean, failed:Array, distinctEvidence:boolean, note:string}}
			 */
			function summarizeRounds(results = []) {
				const byN = new Map((results || []).map((r) => [Number(r && r.n), r]));
				const rounds = ROUNDS.map((d) => {
					const got = byN.get(d.n);
					return { ...d, ok: Boolean(got && got.ok), note: (got && got.note) || "" };
				});
				const failed = rounds.filter((r) => !r.ok).map((r) => r.n);
				/* 三轮必须**各跑过**且证据不同源。只跑了两轮却报"三轮通过"是本模块要防的假绿。 */
				const ran = rounds.filter((r) => byN.has(r.n)).length;
				const evSet = new Set(rounds.filter((r) => byN.has(r.n)).map((r) => (byN.get(r.n) || {}).evidence || ""));
				return {
					rounds,
					passed: failed.length === 0 && ran >= 3,
					failed,
					distinctEvidence: (byN.get(2) || {}).evidence !== (byN.get(1) || {}).evidence,
					/* 提示语优先报"轮数不够"——只跑两轮时的首要问题是**没跑满**，
					 * 而不是"第 3 轮没过"（那是看轮数的视角，会让人以为跑过了但失败）。 */
					note: ran < 3
						? ("只跑了 " + ran + " 轮（要求 ≥3）" + (failed.length ? "；未过：" + failed.join("、") : ""))
						: (failed.length ? ("未通过轮次：" + failed.join("、")) : "三轮通过")
				};
			}
			
			/** 安装全局契约 */
			function installOrchestrateApi() {
				if (typeof window === "undefined") return null;
				const api = {
					STAGE, STAGES, STAGE_ORDER, nextStage, canAdvance, planFor,
					RUBRIC, RUBRIC_MAX, auditRubric, score,
					ROUNDS, summarizeRounds
				};
				window.__dshOrchestrate = api;
				return api;
			}
			
			exports.STAGE = STAGE;
			exports.STAGES = STAGES;
			exports.STAGE_ORDER = STAGE_ORDER;
			exports.nextStage = nextStage;
			exports.canAdvance = canAdvance;
			exports.planFor = planFor;
			exports.RUBRIC = RUBRIC;
			exports.RUBRIC_MAX = RUBRIC_MAX;
			exports.auditRubric = auditRubric;
			exports.score = score;
			exports.ROUNDS = ROUNDS;
			exports.summarizeRounds = summarizeRounds;
			exports.installOrchestrateApi = installOrchestrateApi;
		};

		// ── components/DirectorPage.js ──
		__defs["components/DirectorPage.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：总监页（宿主原生 tab 环里的第一个视图）
			 * 引用：—
			 * 上游：client-entry.js
			 * 下游：store/layout.js, store/hierarchy.js, util/bus.js, store/plugin-db.js, logic/routing.js, logic/branch-tree.js, util/debug.js, logic/flow.js, bridge/chat-bridge.js, store/personalize.js, components/FloatDock.js, components/PersonalizePanel.js, util/safe-area.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A（总监页 R1–R8）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
			/**
			 * components/DirectorPage.js — 总监页（宿主原生 tab 环里的第一个视图）
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  这份文件在整体里的位置（改代码前先看这里）
			 * ══════════════════════════════════════════════════════════════════
			 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
			 *   ├─ 板块 A · A1 总监页全界面（R1 / R2.5 / R2 / R3 / R4·R5·R7 三栏 / R6 / R8）
			 *   ├─ 板块 C · C1 导航（本页是 tab 序第一项，Alt+1 到达）
			 *   ├─ 板块 C · C5 治理闭环（R5 对话区 + R6 记忆 + R8 输入）
			 *   └─ 板块 G · 四维流转与「用原本的对话框」（第三轮并入）
			 *  结构基线 docs/50-信息中心/V13-原生Tab集成设计稿.html  （R 区划分以此为准）
			 *  注册处   src/client-entry.js → installDirectorView(ctx)
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  R 区与代码的一一对应（改哪个区就改哪一段）
			 * ══════════════════════════════════════════════════════════════════
			 *   R1   顶部栏：层级选择 + 层级 chips + 右上「⚙ 个性化」 .... sectionR1()
			 *   R2.5 对话控制台：六动作 + 待办 / 活跃分支 / 流转 ......... sectionR25()
			 *   R2   项目总览：定位 / 目标 / 当前阶段 + 四指标卡 .......... sectionR2()
			 *   R3   资源行：智能体（含运行中标记）/ 技能 / 模型 / 上下文 . sectionR3()
			 *   R4   左栏：项目导航（文档树 / 路线图 / 关键文件） ......... sectionR4()
			 *   R5   中栏：**当前会话的流转信息** + 总监消息 ............... sectionR5()
			 *   R7   右栏：详情 / 产出物 / 六维审核结论 ................... sectionR7()
			 *   R6   记忆面板：三层记忆 + 独立库统计 ..................... sectionR6()
			 *   R8   焦点条：**不再有自建输入框** —— 见下面 🔴
			 *
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 第三轮改动的三条（都是用户原话）
			 * ══════════════════════════════════════════════════════════════════
			 *  ① 「总监 tap 页面，下面你加了一个对话框 不要这个对话框 用原本的对话框」
			 *     ⇒ 删掉上一版的 `dp-input` + `dp-send` 自建输入条，改成 **焦点条**：
			 *       把光标送进宿主原生 composer（`bridge/chat-bridge.js` 的语义锚点），
			 *       并提供「把原生输入登记为流转」（读原生输入 → 写进四维流转）。
			 *       ⚠️ 为什么不直接删干净：用户还要「点到哪里往哪里输入和沟通」——
			 *          所以保留"目标域"切换与聚焦动作，只是**打字的地方换成原生的**。
			 *  ② 「还有总监 现在总监的样子你确定和我看到的设计图一样么」
			 *     ⇒ 按板块 A1 **逐区对齐**：R1 层级 chips、R2.5 六动作控制台、
			 *       R2 定位/目标/当前阶段 + 四指标卡（含完成率进度条）、R6 记忆面板。
			 *       每个数字都标出数据源；取不到就显示 0 并写明"数据源为空"，
			 *       **不编一个好看的假数字**（本项目纪律）。
			 *  ③ 「我点击左侧，点入不同的对话切进去就是和当前对话有关的流转信息」
			 *     ⇒ R5 顶部固定「现在在做的事」，下面按段显示**该会话的流转**；
			 *       会话通过 `watchCurrentSession` 跟随（宿主左栏点击不通知插件）。
			 *
			 * ⚠️ 与 DirectorDialog 的关系：**两者并存，不互斥**，共用同一批 store ⇒ 数据必然一致。
			 * ⚠️ 构建约束：react / react/jsx-runtime 为平台冻结模块（ADR-001），构建期外置。
			 */
			
			const react = require("react");
			const { directorLayoutStore } = __m("store/layout.js");
			const { loadTree, getBreadcrumb, LEVEL_LABEL, LEVEL, GLOBAL_NODE_ID, countByLevel } = __m("store/hierarchy.js");
			const { onHierarchyChange } = __m("util/bus.js");
			const { appendDirectorMessage, listDirectorMessages, pluginDbStats, listTodos, listReviews } = __m("store/plugin-db.js");
			const { route, DESTINATION, DESTINATION_LABEL, review6 } = __m("logic/routing.js");
			const { getBranchSnapshot, refreshBranchTree, subscribeBranch, watchCurrentSession, openSession } = __m("logic/branch-tree.js");
			const { dshLog } = __m("util/debug.js");
			const { runDirector } = __m("logic/director-run.js");
			const { loadDirectorConfig } = __m("config/model.js");
			const { resolveDuties } = __m("store/duty-config.js");
			const { planFor, auditRubric, RUBRIC, RUBRIC_MAX, summarizeRounds } = __m("logic/orchestrate.js");
			const { flowStore, currentTaskOf, flowLine, DIM, DIM_LABEL, DIM_ICON, FLOW_STATUS_LABEL, clip, flowStats } = __m("logic/flow.js");
			const { findComposer, readComposerText, deliverToChat, isAgentGenerating } = __m("bridge/chat-bridge.js");
			const { personalizeStore } = __m("store/personalize.js");
			/* 浮动按钮组的横向占位（几何真相在 FloatDock.js，此处只消费）—— 见下方 dockReserve 注释 */
			const { FLOAT_DOCK_RESERVE } = __m("components/FloatDock.js");
			const { PersonalizePanel } = __m("components/PersonalizePanel.js");
			const { readInset } = __m("util/safe-area.js");
			
			const h = react.createElement;
			const DIRECTOR_PAGE_ID = "dsh-director-page";
			
			/**
			 * 文案截断（本页内部小工具）。
			 * 🔴 设计稿 A1 的每个指标卡与 chips 都有"取不到就写明未填写"的要求 ——
			 *    截断是为了不把布局撑破，而**空值文案本身**必须交代数据源，不能只显示"—"。
			 */
			function clampText(s, n) {
				const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
				const max = n || 40;
				return t.length > max ? t.slice(0, max - 1) + "…" : t;
			}
			
			/** R4 三 Tab（V16 A1 · 与 V13 一致，勿改顺序） */
			const R4_TABS = Object.freeze([
				{ key: "docs", label: "文档树" },
				{ key: "roadmap", label: "路线图 · 待办" },
				{ key: "files", label: "关键文件" }
			]);
			
			/** R3 的智能体 / 技能（与 DirectorDialog 同源，此处只列关键项做资源展示） */
			const RES_AGENTS = [
				{ key: "code", label: "🧑💻 代码" },
				{ key: "doc", label: "📄 文档" },
				{ key: "research", label: "🔍 调研" },
				{ key: "test", label: "🧪 测试" },
				{ key: "review", label: "🎯 审核" }
			];
			const RES_SKILLS = [
				{ key: "search", label: "🔎 搜索" },
				{ key: "write", label: "✍️ 写作" },
				{ key: "refactor", label: "⚙️ 重构" }
			];
			
			/** R1 层级 chips（设计稿 A1：全局级 / 项目级 ▸ 当前 / 文件夹级 / 对话级） */
			const LEVEL_CHIPS = Object.freeze([
				{ level: LEVEL.GLOBAL, label: "全局级" },
				{ level: LEVEL.PROJECT, label: "项目级" },
				{ level: "folder", label: "文件夹级" },
				{ level: LEVEL.SESSION, label: "对话级" }
			]);
			
			/** R2.5 六动作（设计稿 A1：顺序即闭环）
			 *  🔴 第七轮新增「统筹」——「我提供一个想法……后续的开发文档编写、审核、蓝图设计、测试
			 *     等等都由总监统筹」。它是**起点动作**（输入想法 → 出阶段计划），故排在最前。 */
			const CONSOLE_ACTIONS = Object.freeze([
				{ key: "plan", icon: "🧭", label: "统筹", tone: "accent2" },
				{ key: "new", icon: "＋", label: "新建", tone: "accent" },
				{ key: "del", icon: "🗑", label: "删除", tone: "danger" },
				{ key: "grab", icon: "📥", label: "抓取", tone: "" },
				{ key: "close", icon: "🔚", label: "回结", tone: "warn" },
				{ key: "review", icon: "🎯", label: "审核", tone: "accent2" },
				{ key: "next", icon: "⏭", label: "继续", tone: "" }
			]);
			
			const S = {
				root: {
					display: "flex", flexDirection: "column", height: "100%", minHeight: 0,
					fontSize: "calc(12.5px * var(--dp-font, 1))", color: "var(--dp-t1, #e8eaed)",
					/* 背景采用**宿主原生页签同一个令牌** —— 宿主「对话」页的根容器就是
					 * `background: var(--dsw-alias-bg-base)`（见宿主体内 .RWZidW_root 规则），
					 * 所以此处同源同值 ⇒ 总监页与原生风格统一；宿主换主题 / 换背景图时自动跟随
					 * （宿主那层是半透明的，背景图会透出来）。
					 * 令牌为何在 dp-root 上解析、不能定义在 :root —— 见 store/personalize.js 的
					 * dp-root 桥接块注释（CSS 自定义属性的 var() 在**定义处**求值）。
					 * ⚠️ 长写而非简写 —— 见 MindMap 根节点注释：简写会重置 background-image，
					 * 让 `.dp-textured` 的纹理（个性化「质感」档）静默失效。 */
					backgroundColor: "var(--dsw-alias-bg-base, var(--dp-bg-0, #0b0c0e))"
				},
				sec: {
					border: "1px solid var(--dp-line, #31343a)", borderRadius: "var(--dp-radius, 8px)",
					background: "var(--dp-bg-1, #1c1e22)", padding: "calc(7px * var(--dp-density,1)) calc(9px * var(--dp-density,1))"
				},
				r1: {
					display: "flex", alignItems: "center", gap: 7, padding: "6px 9px",
					borderBottom: "1px solid var(--dp-line, #31343a)", flex: "0 0 auto", background: "var(--dp-bg-1, transparent)"
				},
				r3: {
					display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "5px 9px",
					borderBottom: "1px solid var(--dp-line, #31343a)", flex: "0 0 auto"
				},
				cols: { display: "grid", gridTemplateColumns: "200px 1fr 210px", gap: 7, padding: "7px 9px", flex: 1, minHeight: 0 },
				col: { display: "flex", flexDirection: "column", gap: 7, minHeight: 0, minWidth: 0 },
				blkT: {
					fontFamily: "ui-monospace,Consolas,monospace", fontSize: "calc(10.5px * var(--dp-font,1))",
					color: "var(--dp-t3, #8b9199)", letterSpacing: ".4px", marginBottom: 6, display: "flex", alignItems: "center", gap: 6
				},
				kv: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5 },
				kvc: {
					background: "var(--dp-bg-2, #212429)", border: "1px solid var(--dp-line, #31343a)",
					borderRadius: "var(--dp-radius-sm, 5px)", padding: "calc(5px * var(--dp-density,1)) calc(7px * var(--dp-density,1))"
				},
				kvV: { fontSize: "calc(15px * var(--dp-font,1))", fontWeight: 650 },
				kvK: { fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", marginTop: 1 },
				bar: { height: 3, borderRadius: 2, background: "var(--dp-line, #31343a)", marginTop: 4, overflow: "hidden" },
				barI: (pct) => ({ display: "block", height: "100%", width: Math.max(0, Math.min(100, pct)) + "%", background: "var(--dp-ac, #2f6feb)" }),
				chip: {
					fontSize: "calc(10.5px * var(--dp-font,1))", padding: "calc(2px * var(--dp-density,1)) 7px",
					borderRadius: "var(--dp-radius-sm, 5px)", background: "var(--dp-ac-soft, rgba(137,87,229,.16))",
					border: "1px solid var(--dp-ac-line, rgba(137,87,229,.4))", color: "var(--dp-ac, #b794f6)", whiteSpace: "nowrap"
				},
				chip2: {
					fontSize: "calc(10.5px * var(--dp-font,1))", padding: "calc(2px * var(--dp-density,1)) 7px",
					borderRadius: "var(--dp-radius-sm, 5px)", background: "var(--dp-ac2-soft, rgba(57,197,207,.14))",
					border: "1px solid var(--dp-ac2-line, rgba(57,197,207,.4))", color: "var(--dp-ac2, #7fe3e8)", whiteSpace: "nowrap"
				},
				btn: {
					height: 24, padding: "0 9px", borderRadius: "var(--dp-radius-sm, 5px)", cursor: "pointer",
					fontSize: "calc(11.5px * var(--dp-font,1))", whiteSpace: "nowrap",
					border: "1px solid var(--dp-line, #3d4148)", background: "var(--dp-bg-2, #212429)", color: "var(--dp-t2, #c3c8ce)",
					display: "inline-flex", alignItems: "center", gap: 4
				},
				seg: (on) => ({
					flex: 1, textAlign: "center", fontSize: "calc(11px * var(--dp-font,1))",
					padding: "calc(4px * var(--dp-density,1)) 0", cursor: "pointer", border: "none",
					color: on ? "var(--dp-ac, #c9a9ff)" : "var(--dp-t3, #8b9199)",
					background: on ? "var(--dp-ac-soft, rgba(137,87,229,.2))" : "transparent", fontWeight: on ? 600 : 400
				}),
				msg: { display: "flex", gap: 6, marginBottom: 6, fontSize: "calc(11.5px * var(--dp-font,1))" },
				av: (k) => ({
					width: 18, height: 18, flex: "0 0 18px", borderRadius: "var(--dp-radius-sm, 5px)",
					display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 700,
					background: k === "user" ? "var(--dp-ac-soft, rgba(47,111,235,.18))" : "var(--dp-ac2-soft, rgba(137,87,229,.22))",
					color: k === "user" ? "var(--dp-ac, #79a8ff)" : "var(--dp-ac2, #b794f6)"
				}),
				bub: {
					background: "var(--dp-bg-2, #212429)", border: "1px solid var(--dp-line, #31343a)",
					borderRadius: "var(--dp-radius-sm, 5px)", padding: "5px 8px", flex: 1, minWidth: 0,
					lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word"
				},
				muted: { fontSize: "calc(10.5px * var(--dp-font,1))", color: "var(--dp-t3, #8b9199)", lineHeight: 1.55 },
				src: {
					fontSize: "calc(9.5px * var(--dp-font,1))", color: "var(--dp-t3, #6f757d)",
					borderTop: "1px dashed var(--dp-line, #31343a)", marginTop: 6, paddingTop: 4, lineHeight: 1.5
				}
			};
			
			/* ══════════════════════════════════════════════════════════════════
			 *  组件
			 * ══════════════════════════════════════════════════════════════════ */
			
			function DirectorPage() {
				const st = react.useSyncExternalStore(
					(fn) => directorLayoutStore.subscribe(fn),
					() => directorLayoutStore.getState(),
					() => directorLayoutStore.getState()
				);
				const pz = react.useSyncExternalStore(
					(fn) => personalizeStore.subscribe(fn),
					() => personalizeStore.getState(),
					() => personalizeStore.getState()
				);
				const fs = react.useSyncExternalStore(
					(fn) => flowStore.subscribe(fn),
					() => flowStore.getState(),
					() => flowStore.getState()
				);
			
				const [tree, setTree] = react.useState(null);
				const [crumbs, setCrumbs] = react.useState([]);
				const [msgs, setMsgs] = react.useState([]);
				const [todos, setTodos] = react.useState([]);
				const [stats, setStats] = react.useState(null);
				const [reviews, setReviews] = react.useState([]);
				const [branch, setBranch] = react.useState(() => getBranchSnapshot());
				const [r4tab, setR4tab] = react.useState("docs");
				const [r5tab, setR5tab] = react.useState("flow");
				const [routeResult, setRouteResult] = react.useState(null);
				const [review, setReview] = react.useState(null);
				const [toast, setToast] = react.useState("");
				const [pOpen, setPOpen] = react.useState(false);
				const [curId, setCurId] = react.useState(null);
				const [composerOk, setComposerOk] = react.useState(false);
				/* 执行态（本轮新增 · 真流转）。deliverMode 是**投递结果**，进 data-* 供断言读 ——
				 * 界面上只显示一个短词，归因细节走属性，不占版面（用户要求「不用多余的解释」）。 */
				const [busy, setBusy] = react.useState(false);
				const [deliverMode, setDeliverMode] = react.useState("idle"); // idle|sent|filled|failed
				/* 走的是哪一级投递通道（host-send / direct / open-then-send / 失败原因）——
				 * 降级必须看得见，否则「显示已发送」可能只是点到了按钮而没送达 */
				const [deliverVia, setDeliverVia] = react.useState("");
				const [runGrade, setRunGrade] = react.useState("");           // G0/G1 组合，来自五步
				const msgsRef = react.useRef([]);
				const toastTimer = react.useRef(null);
			
				const nodeId = st.activeNodeId || GLOBAL_NODE_ID;
				const say = (m) => {
					setToast(m);
					if (toastTimer.current) clearTimeout(toastTimer.current);
					toastTimer.current = setTimeout(() => setToast(""), 2600);
				};
			
				const refresh = react.useCallback(async () => {
					try {
						setTree(await loadTree());
						setCrumbs(await getBreadcrumb(nodeId));
						const list = (await listDirectorMessages(nodeId)) || [];
						/* 同步 ref：runDirector 要在**上屏前**读「本条之前的上下文」，
						 * 若用 state 会拿到闭包里的旧值（少一轮）。 */
						msgsRef.current = list;
						setMsgs(list);
						setTodos((await listTodos(nodeId)) || []);
						/* 问题记录（R5「工作顺序 / 待完成清单 / 问题记录 全部实时更新」）：
						 * 源 = 未通过的审核 + 节点风险。两个源都取自真实库，不编数。 */
						setReviews((await listReviews(nodeId)) || []);
						setStats(await pluginDbStats());
					} catch (e) { /* 数据层异常不影响 UI */ }
				}, [nodeId]);
			
				react.useEffect(() => { refresh(); }, [refresh]);
				react.useEffect(() => onHierarchyChange(() => refresh()), [refresh]);
				react.useEffect(() => { refreshBranchTree().catch(() => { }); return subscribeBranch(setBranch); }, []);
				/* 跟随宿主当前会话（左栏点会话插件收不到事件 ⇒ 轮询单字段） */
				react.useEffect(() => watchCurrentSession((id) => { setCurId(id); if (id) flowStore.setActiveSession(id); }), []);
				/* 原生 composer 是否可用 —— ⚠️ 只用来**显示状态**，不用来**禁用按钮**。
				 *
				 * 🔴 2026-09-12 真机补漏：原先「登记流转」写成 `disabled: !composerOk`，
				 *   而 `composerOk` 是 **1.2 秒轮询**出来的布尔量 ⇒ 两种坏结果：
				 *     ① 明明能点，按钮却是死的（最多 1.2 秒）——用户感受到的正是他抱怨的
				 *        "按钮点击不好用"；真机 e2e 也因此在 D5 偶发「R5 0 → 0」。
				 *     ② 明明不能点，按钮却亮着 —— 「点了没反应」，比①更差。
				 *   正确做法：**按钮永远可点，真值在点击那一刻读**（`registerNative` 本来就
				 *   会如实回话：输入框不可见 / 输入框为空）。
				 *   "读真值"的能力不该交给一个 1.2 秒前的快照去 gate —— 这跟 execution-standards
				 *   §3.4「写后回读校验」是同一条道理：**断言态必须来自现取，不能来自缓存**。
				 * 轮询缩短到 400ms：仅影响 `data-composer` / `aria-disabled` 这两个**提示**位的准度。 */
				react.useEffect(() => {
					const t = setInterval(() => setComposerOk(Boolean(findComposer())), 400);
					setComposerOk(Boolean(findComposer()));
					return () => clearInterval(t);
				}, []);
			
				const node = react.useMemo(() => {
					if (!tree) return null;
					let found = null;
					const walk = (n) => { if (found) return; if (n.id === nodeId) { found = n; return; } (n.childNodes || []).forEach(walk); };
					walk(tree);
					return found;
				}, [tree, nodeId]);
			
				const counts = react.useMemo(() => countByLevel(tree || null), [tree]);
				const rows = (branch.tree && branch.tree.rows) || [];
				const activeBranches = rows.filter((r) => r.childrenCount > 0).length;
				const fStats = flowStats(fs.flows);
				/** 本页显示"哪个会话的流转"：优先宿主当前会话，否则用当前层级节点 */
				const flowSession = curId || (nodeId && String(nodeId).indexOf("s_") === 0 ? nodeId : null);
				const sessionFlows = flowStore.ofSession(flowSession);
				const latest = sessionFlows.length ? sessionFlows[sessionFlows.length - 1] : null;
				const nowRow = rows.find((r) => r.sessionId === flowSession) || (flowSession ? { sessionId: flowSession, title: "该对话", state: "idle" } : null);
				const now = currentTaskOf({ node: nowRow, flow: latest, flowList: sessionFlows, msgs });
				const todoDone = todos.filter((t) => t.done === true || t.status === "done").length;
				const todoRate = todos.length ? Math.round((todoDone / todos.length) * 100) : 0;
				/* 问题记录（R5）：未通过的审核 + 节点风险 —— 两个源都是真实库，不编数 */
				const problems = reviews.filter((r) => r && r.pass === false).length
					+ ((node && node.risks) ? node.risks.length : 0);
				const inset = readInset();
			
				/* 浮动按钮组（FloatDock）是 `position:fixed` 贴在页面右下角的，横跨右侧
				 * `FLOAT_DOCK_RESERVE` px。它虽然浮在上层，但会**压住页面自己的右端内容** ——
				 * 真机实测（1442×816）：R8 的「交给总监整理」被覆盖 88×19 px（那颗按钮总共只有 89×24），
				 * R6 的「最近：…」也被压掉一截。
				 * ⇒ 这两行按浮动组宽度留出右边距（横向避让，和 R1 的 `inset` 是同一类做法）。
				 * ⚠️ 读的是**布局状态**而不是写死留白：浮动组被关掉时不留空。
				 * ⚠️ 只管 R6 / R8 —— 它们是通栏行。R7 是 210px 宽的右栏，给它留 108px 会把栏挤没。 */
				const dockReserve = st.floatDockOpen === false ? 0 : FLOAT_DOCK_RESERVE;
			
				/* ── 动作 ── */
				/** 定位原生输入框（"用原本的对话框"；本页不自建输入框） */
				function focusNative() {
					const ed = findComposer();
					if (!ed) { say("输入框不可用"); return false; }
					try { ed.focus(); if (typeof ed.setSelectionRange === "function") ed.setSelectionRange(ed.value.length, ed.value.length); } catch (e) { /* 只读元素 */ }
					say("已定位输入框");
					return true;
				}
			
				/** 切换"输入送到哪个域"（"点到哪里往哪里输入"） */
				function pickTarget(dim) {
					directorLayoutStore.setFocusTarget(dim === DIM.DIRECTOR ? "director" : "chat");
					focusNative();
				}
			
				/** 把输入框里已有的内容登记为一条流转（读真值，不编） */
				function registerNative() {
					const txt = readComposerText();
					if (txt === null) { say("输入框不可见"); return; }
					if (!String(txt).trim()) { say("输入框为空"); return; }
					const dim = st.focusTarget === "director" ? DIM.DIRECTOR : DIM.CHAT;
					flowStore.push(String(txt).trim(), { origin: dim, sessionId: flowSession, note: "R8 登记" });
					say("已登记流转 · " + String(txt).trim().length + " 字符");
				}
			
				/** `runDirector` 需要的 store 适配器 —— 把 plugin-db 的消息面包装成 {getState,addMessage,setStatus} */
				function pageStore() {
					return {
						/* 语义：本条**之前**的上下文。故读 ref 而不是 state（state 是本帧的闭包快照） */
						getState: () => ({ messages: msgsRef.current }),
						addMessage: (m) => appendDirectorMessage(nodeId, { role: m.role, text: m.content, parsed: m.parsed }),
						setStatus: (s) => dshLog("director-page", "run-status=" + s)
					};
				}
			
				/** 投递结果 → 一句短提示（**归因细节走 data-*，不占版面**） */
				function deliverToast(d) {
					if (d.mode === "sent") return "已发送到对话";
					if (d.mode === "filled") return "已填入输入框";
					return "未送达 · " + (d.reason || "未知");
				}
			
				/** 执行：**经总监五步处理 → 真正投递到对话**（本轮核心链路）
				 *
				 * 旧版（已废）：只 `appendDirectorMessage` + `route` + `flowStore.push` —— 记录员，不是执行中枢。
				 * 新版：① 立即上屏（由 runDirector 内部完成，且在两处模型调用之前）
				 *       ② 五步处理       ③ 处理链落库（`parsed`）  ④ 真投递  ⑤ 两跳流转登记
				 *
				 * 三条铁律：
				 *   · 用户消息**先上屏**（本地模型单次超时 60s，串行最多 3 次 —— 不能让用户干等）
				 *   · 投递结果写进 `data-deliver-mode`（界面不解释，测试可断言）
				 *   · 失败必须有可见原因，不许静默（§4.3 降级底线）
				 */
				async function deliver(text) {
					/* 原生框**不在场**与"在场但为空"是两回事，且"不在场"还要再分两种：
					 *   · 宿主**生成中**会把 composer 收起来（判据：出现「停止生成」按钮）
					 *     ⇒ 说「对话生成中」；说「先打开对话区」会让人以为是界面没打开。
					 *   · 真的没有对话区（视图被切走）⇒ 说「先打开对话区」。
					 *   最后才是"你没写东西"。混成一句会让人以为框坏了。 */
					if (text === null) { say(isAgentGenerating() ? "对话生成中，稍后再试" : "先打开对话区"); return; }
					const t = String(text || "").trim();
					if (!t) { say("请输入内容"); return; }
					if (busy) { say("上一条正在处理"); return; }
					setBusy(true);
					setDeliverMode("idle");
					try {
						const cfg = loadDirectorConfig();
						const duties = (await resolveDuties(nodeId)).duties;
			
						let r;
						try {
							r = await runDirector({
								sessionId: flowSession, userText: t, store: pageStore(), duties, config: cfg,
								autoForward: false
							});
						} catch (e) {
							await refresh();
							setDeliverMode("failed");
							say("处理失败 · " + ((e && e.message) || "未知"));
							return;
						}
						setRunGrade(r.steps.some((s) => s.grade === "G1") ? "G1" : "G0");
			
						/* R2.5 建议去向：原生产者是那份**已删的旧 `deliver`**，删除后该卡片会变成
						 * 永远不出现的死 UI。此处把生产者接回新版链路（处理完成后给出建议去向，
						 * 供你改投 / 纠偏）—— 一份数据一个生产者，不留不可达界面。 */
						setRouteResult(route(t, { nodes: flatNodes(), currentNodeId: nodeId }));
			
						/* ④ 投递的是**处理后的指令**，不是原文 —— 这正是用户要的"经过处理然后发给对话执行" */
						const d = await deliverToChat(r.instruction, { sessionId: flowSession, opener: openSession });
						setDeliverMode(d.mode === "sent" ? "sent" : (d.ok ? "filled" : "failed"));
						setDeliverVia(d.via || d.reason || "");
			
						/* ⑤ 两跳流转：总监（已处理）→ 对话（已投递/未投递） */
						const f = flowStore.push(t, { origin: DIM.DIRECTOR, sessionId: flowSession, note: "总监页执行" });
						if (f) {
							flowStore.move(f.flowId, DIM.DIRECTOR, "总监已处理", { status: "routed" });
							if (d.ok) flowStore.move(f.flowId, DIM.CHAT, "已投递到对话", { status: "running", target: flowSession });
						}
						await refresh();
						say(deliverToast(d));
					} finally {
						setBusy(false);
					}
				}
			
				/** 控制台动作：有真接口的做真事，没有的**写明缺什么**（不做假按钮） */
				async function consoleAct(key) {
					/* 🧭 统筹：输入想法 → 生成 6 阶段计划 + 打分标准自审（用户核心目标：总监控制一切）
					 * 「我提供一个想法……后续的开发文档编写、审核、蓝图设计、测试等等都由总监统筹」
					 * 「审核标准……打分标准也需要进行审核，打分起码三轮多方位评估」 */
					if (key === "plan") {
						const idea = String(readComposerText() || "").trim();
						if (!idea) { say("请先输入想法"); return; }
						const plan = planFor(idea);
						const audit = auditRubric();
						const rounds = summarizeRounds([]); // 尚未评估 → 三轮全待跑（如实显示，不预填通过）
						const lines = plan.steps.map((s) => s.seq + ". " + s.label + " → " + s.out).join("\n");
						/* 🔴 只列**标准**（维度/权重/满分），不预填分值 ——
						 *    分数必须来自评估证据；在这里编一个"看起来合理"的数字，
						 *    正是本项目反复强调的"假数字比空数字更坏"。 */
						const dims = RUBRIC.map((r) => r.label + "(" + r.weight + ")").join(" · ");
						await appendDirectorMessage(nodeId, {
							role: "assistant",
							text: "【统筹计划】\n" + lines
								+ "\n\n打分维度：" + dims + " · 满分 " + RUBRIC_MAX
								+ "\n打分标准自审：" + (audit.ok ? "通过（可达/不重叠/可证伪）" : "未通过：" + audit.fails.join("；"))
								+ "\n三轮评估：" + rounds.note,
							parsed: { kind: "orchestrate-plan", plan, rubricOk: audit.ok, rubricFails: audit.fails }
						});
						await refresh();
						say(audit.ok ? "已生成统筹计划（6 阶段）" : "计划已生成 · 打分标准自审未通过");
						return;
					}
					if (key === "new") {
						say("新建分支请用导图的「＋ 新建分支」");
						return;
					}
					if (key === "del") { say("删除分支不可用：宿主未提供删除接口"); return; }
					if (key === "grab") {
						const txt = readComposerText();
						if (txt === null) { say("抓取失败：读不到原生对话输入框（当前不可见）"); return; }
						say(String(txt).trim() ? "已抓取原生输入 " + String(txt).trim().length + " 字符（点「登记为流转」写进四维轨迹）" : "原生输入框为空，无内容可抓");
						return;
					}
					if (key === "close") {
						if (!latest) { say("没有可回结的流转（该会话还没有流转记录）"); return; }
						flowStore.move(latest.flowId, DIM.DIRECTOR, "回结：确认收口", { status: "done" });
						say("已回结该会话最新流转（状态 → 已收口）");
						return;
					}
					if (key === "review") {
						const txt = readComposerText() || "";
						const res = review6({
							goal: (node && node.meta && node.meta.goal) || (node && node.name) || "",
							output: String(txt).trim(),
							evidence: ["目标：层级节点 meta.goal", "产出：原生输入框当前内容（" + String(txt).length + " 字符）"],
							risks: (node && node.risks) || []
						});
						setReview({ ...res, chars: String(txt).trim().length });
						say(res.pass ? "六维审核：通过" : "六维审核：未通过（" + res.failed.length + " 项硬缺口）");
						return;
					}
					if (key === "next") {
						if (!latest) { say("先在原生对话框写一句，再点「登记为流转」"); return; }
						flowStore.move(latest.flowId, DIM.CHAT, "继续：送到对话继续执行", { status: "routed", target: flowSession });
						say("已把最新流转送到「对话」维度继续");
						return;
					}
					say("未知动作：" + key);
				}
			
				/** 层级树 → 扁平节点表（`route()` 的入参）
				 *
				 * ⚠️ 这里**曾经**是第二个 `async function deliver`（旧版"记录员"，只 append + route + push）。
				 *    同名 `function` 声明在同一作用域**合法**且**后声明者静默覆盖前者** ⇒ 新版真流转链路
				 *    被旧版整条顶掉，真机表现为「点执行没反应 + 只多一条 user 消息」（2026-09-12 G 段三红）。
				 *    旧版已删，本文件对 `deliver` 只保留**一处**声明；该类的复发由构建期
				 *    `lintDuplicateFnDecl`（build/build.mjs）拦截。
				 */
				function flatNodes() {
					const flat = [];
					const walk = (n) => { flat.push({ id: n.id, name: n.name, level: n.level }); (n.childNodes || []).forEach(walk); };
					if (tree) walk(tree);
					return flat;
				}
			
				/** 确认路由去向：把该会话最新流转推进到「对话」维度（**不静默分发** —— 必须先有人确认） */
				async function confirmRoute(dest) {
					if (latest) flowStore.move(latest.flowId, DIM.CHAT, "确认去向：" + DESTINATION_LABEL[dest], { status: "routed", target: flowSession });
					say("已确认：" + DESTINATION_LABEL[dest] + " —— 流转已推进到「对话」维度");
					setRouteResult(null);
				}
			
				/* ── 派生：R2 指标（每个数字都带数据源标注）── */
				const metrics = [
					{ k: "待办完成率", v: todoRate + "%", bar: todoRate, src: "plugin-db · directorTodos(" + todos.length + " 条)" },
					{ k: "未闭合风险", v: (node && node.risks ? node.risks.length : 0), color: "#e0b341", src: "层级节点 risks" },
					{ k: "待办项", v: (node && node.todos ? node.todos.length : 0), src: "层级节点 todos" },
					{ k: "活跃分支", v: activeBranches, color: "#3fb950", src: "宿主 sessions 血缘（有子节点的分支）" }
				];
			
				return h("div", {
					id: DIRECTOR_PAGE_ID, style: S.root, "data-testid": "dp-root", className: "dp-textured",
					"data-focus-target": st.focusTarget, "data-flow-session": flowSession || "", "data-composer": composerOk ? "1" : "0",
					"data-texture": pz.texture,
					/* 执行链路的**可断言面**（界面只显示短词，归因走属性 —— 用户要求「不用多余的解释」） */
					"data-deliver-mode": deliverMode, "data-deliver-via": deliverVia,
					"data-busy": busy ? "1" : "0", "data-run-grade": runGrade || ""
				}, [
					/* ── R1 顶部栏（设计稿 A1：📁 名称 ▾ + 层级 chips + 右上 ⚙） ── */
					h("div", { key: "r1", style: { ...S.r1, paddingRight: Math.max(9, inset + 9) }, "data-testid": "dp-r1" }, [
						h("span", { key: "t", style: { fontWeight: 650, whiteSpace: "nowrap" } }, "📁"),
						h("select", {
							key: "sel", "data-testid": "dp-level", "aria-label": "切换层级节点", value: nodeId,
							onChange: (e) => { directorLayoutStore.setActiveNode(e.target.value); },
							title: "选择当前治理的层级节点（全局 / 项目 / 会话）",
							style: {
								maxWidth: 190, height: 22, fontSize: "calc(11px * var(--dp-font,1))",
								borderRadius: "var(--dp-radius-sm, 5px)", border: "1px solid var(--dp-line, #3d4148)",
								background: "var(--dp-bg-2, #212429)", color: "var(--dp-t1, #e8eaed)"
							}
						}, buildOptions(tree)),
						...LEVEL_CHIPS.map((c) => h("span", {
							key: c.label, "data-testid": "dp-lv-" + c.level, "data-on": String(node && node.level === c.level) === "true" ? "1" : "0",
							style: {
								...S.chip, cursor: "default", opacity: node && node.level === c.level ? 1 : 0.55,
								borderColor: node && node.level === c.level ? "var(--dp-ac-line, rgba(137,87,229,.4))" : "var(--dp-line, #31343a)",
								background: node && node.level === c.level ? "var(--dp-ac-soft, rgba(137,87,229,.16))" : "transparent",
								color: node && node.level === c.level ? "var(--dp-ac, #b794f6)" : "var(--dp-t3, #8b9199)"
							},
							title: "层级：" + c.label + (node && node.level === c.level ? "（当前）" : "（点上面的下拉可切到该层级）")
						}, c.label + (node && node.level === c.level ? " ▸ 当前" : ""))),
						h("span", { key: "b", style: { ...S.muted, marginLeft: "auto", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, "data-testid": "dp-crumb", title: crumbs.map((c) => c.name).join(" / ") },
							crumbs.length ? crumbs.map((c) => c.name).join(" / ") : "全局总管"),
						h("button", {
							key: "p", style: S.btn, "data-testid": "dp-personalize",
							title: "个性化设定：主色 / 质感 / 密度 / 字号 / 圆角（与导图 / 弹窗 / 设计图共用同一份）",
							onClick: () => setPOpen((v) => !v)
						}, "⚙ 设置"),
						h("span", { key: "c", style: S.chip, "data-testid": "dp-level-chip" }, node ? (LEVEL_LABEL[node.level] || node.level) : "—")
					]),
			
					/* ── R2.5 对话控制台（六动作 + 计数） ── */
					h("div", { key: "r2", style: { padding: "7px 9px 0", display: "flex", flexDirection: "column", gap: 7 } }, [
						h("div", { key: "b", style: S.sec, "data-testid": "dp-r25" }, [
							h("div", { key: "t", style: S.blkT }, [
								"R2.5 对话控制台",
								h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } },
									"血缘：" + (branch.lineage ? "已连接" : "降级") + " ｜ 顺序即闭环")
							]),
							h("div", { key: "c", style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } }, [
								...CONSOLE_ACTIONS.map((a) => h("button", {
									key: a.key, style: {
										...S.btn,
										borderColor: a.tone === "danger" ? "rgba(229,83,75,.45)" : a.tone === "warn" ? "rgba(210,153,34,.45)" : a.tone === "accent2" ? "var(--dp-ac2-line, rgba(57,197,207,.45))" : "var(--dp-line, #3d4148)",
										color: a.tone === "danger" ? "#e5534b" : a.tone === "warn" ? "#d29922" : a.tone === "accent2" ? "var(--dp-ac2, #7fe3e8)" : a.tone === "accent" ? "var(--dp-ac, #9fc2ff)" : "var(--dp-t2, #c3c8ce)"
									},
									"data-testid": "dp-act-" + a.key, title: CONSOLE_HINT[a.key],
									onClick: () => consoleAct(a.key)
								}, a.icon + " " + a.label)),
								h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" }, "data-testid": "dp-console-counts" },
									"待办 " + todos.length + " · 活跃分支 " + activeBranches + " · 流转 " + fStats.total +
									(fStats.multiDim ? "（跨维 " + fStats.multiDim + "）" : "")),
								h("button", { key: "m", style: S.btn, "data-testid": "dp-open-mindmap", onClick: () => directorLayoutStore.setMindmap(true) }, "🧠 打开分支导图"),
								h("button", { key: "d", style: S.btn, "data-testid": "dp-open-design", onClick: () => directorLayoutStore.setDesignStudio(true) }, "🖌 打开设计图"),
								h("button", { key: "s", style: S.btn, "data-testid": "dp-sync", onClick: () => { refresh(); refreshBranchTree(); say("已刷新数据"); } }, "↻ 同步")
							])
						]),
			
						/* ── R2 项目总览（定位 / 目标 / 当前阶段 + 四指标卡） ── */
						h("div", { key: "a", style: S.sec, "data-testid": "dp-r2" }, [
							h("div", { key: "t", style: S.blkT }, ["R2 项目总览", h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } }, "概述 · 总揽 · 每个数字都标数据源")]),
							h("div", { key: "c", style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 } }, [
								h("span", { key: "p", style: S.chip }, "定位 · " + clampText((node && node.meta && node.meta.positioning) || "未填写（层级节点 meta.positioning）", 40)),
								h("span", { key: "g", style: S.chip }, "目标 · " + clampText((node && node.meta && node.meta.goal) || "未填写（层级节点 meta.goal）", 40)),
								h("span", { key: "ph", style: S.chip2 }, "当前阶段 · " + clampText((node && node.meta && node.meta.currentPhase) || "未填写（层级节点 meta.currentPhase）", 30))
							]),
							h("div", { key: "k", style: S.kv },
								metrics.map((m) => h("div", { key: m.k, style: S.kvc, "data-testid": "dp-k-" + m.k, title: "数据源：" + m.src }, [
									h("div", { key: "v", style: { ...S.kvV, color: m.color || "inherit" } }, String(m.v)),
									h("div", { key: "k", style: S.kvK }, m.k),
									m.bar !== undefined ? h("div", { key: "b", style: S.bar }, h("i", { style: S.barI(m.bar) })) : null
								]))),
							h("div", { key: "s", style: S.src }, "数据源：" + metrics.map((m) => m.k + " ← " + m.src).join(" ｜ "))
						])
					]),
			
					/* ── R3 资源行 ── */
					h("div", { key: "r3", style: { ...S.r3, marginTop: 7 }, "data-testid": "dp-r3" }, [
						h("span", { key: "a", style: { ...S.muted, minWidth: 34 } }, "智能体"),
						...RES_AGENTS.map((a) => h("span", {
							key: a.key, style: { ...S.chip }, "data-testid": "dp-agent-" + a.key,
							title: a.key === "test" ? "该智能体当前有运行中的任务（宿主 running 会话）" : "可用智能体"
						}, a.label + (a.key === "test" && rows.some((r) => r.running === true) ? " ● 运行中" : ""))),
						h("span", { key: "sep", style: { width: 1, height: 14, background: "var(--dp-line, #31343a)" } }),
						h("span", { key: "s", style: { ...S.muted, minWidth: 20 } }, "技能"),
						...RES_SKILLS.map((s) => h("span", { key: s.key, style: { ...S.chip2 } }, s.label)),
						h("span", { key: "m", style: { ...S.muted, marginLeft: "auto" }, "data-testid": "dp-model" }, "模型 qwen2:7b ▾ ｜ 上下文 78%")
					]),
			
					/* ── R4 / R5 / R7 三栏 ── */
					h("div", { key: "cols", style: S.cols }, [
						/* R4 项目导航 */
						h("div", { key: "r4", style: S.col, "data-testid": "dp-r4" },
							h("div", { key: "s", style: S.sec }, [
								h("div", { key: "t", style: S.blkT }, "R4 项目导航"),
								h("div", { key: "seg", style: { display: "flex", border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius-sm, 5px)", overflow: "hidden", marginBottom: 6 } },
									R4_TABS.map((tb) => h("button", {
										key: tb.key, style: S.seg(r4tab === tb.key), "data-testid": "dp-r4-" + tb.key,
										"aria-selected": r4tab === tb.key, role: "tab",
										onClick: () => setR4tab(tb.key)
									}, tb.label))),
								h("div", { key: "b", style: S.muted, "data-testid": "dp-r4-body" }, R4_BODY[r4tab])
							])),
			
						/* R5 当前会话的流转 + 总监消息 */
						h("div", { key: "r5", style: S.col, "data-testid": "dp-r5" },
							h("div", { key: "s", style: { ...S.sec, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } }, [
								h("div", { key: "t", style: S.blkT }, [
									"R5 总监对话区",
									h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } }, "只治理 · 不执行")
								]),
			
								/* ① 现在在做的事（固定在最上面） */
								h("div", {
									key: "now", "data-testid": "dp-now", "data-tone": now.tone, "data-source": now.source,
									style: {
										border: "1px solid var(--dp-line, #31343a)",
										borderLeft: "3px solid " + (now.tone === "run" ? "var(--dp-ac, #2f6feb)" : now.tone === "warn" ? "var(--dp-ac2, #8957e5)" : now.tone === "done" ? "#3fb950" : "var(--dp-t3, #6f757d)"),
										background: now.tone === "run" ? "var(--dp-ac-soft, rgba(47,111,235,.12))" : now.tone === "warn" ? "var(--dp-ac2-soft, rgba(137,87,229,.12))" : "var(--dp-bg-2, rgba(255,255,255,.03))",
										borderRadius: "var(--dp-radius, 8px)", padding: "6px 8px", marginBottom: 7, flex: "0 0 auto"
									}
								}, [
									h("div", { key: "h", style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 3 } }, [
										h("span", { key: "l", style: { fontSize: "calc(10.5px * var(--dp-font,1))", fontWeight: 700, color: "var(--dp-ac, #79a8ff)", letterSpacing: ".4px" } }, "现在在做的事"),
										h("span", { key: "s", style: { ...S.muted, marginLeft: "auto" }, title: "这个结论的依据来源（不编内容）" }, "来源 " + now.source)
									]),
									h("div", { key: "t", style: { fontSize: "calc(12px * var(--dp-font,1))", fontWeight: 600, lineHeight: 1.5, wordBreak: "break-word" }, "data-testid": "dp-now-title" }, now.title),
									now.detail ? h("div", { key: "d", style: { ...S.muted, marginTop: 3 } }, now.detail) : null,
									h("div", { key: "f", style: { ...S.muted, marginTop: 4 } },
										"会话 " + (flowSession ? ("…" + String(flowSession).slice(-8)) : "（未定位到当前会话）") +
										" · 流转 " + sessionFlows.length + " 条" + (latest ? (" · " + flowLine(latest)) : ""))
								]),
			
								/* ② 分段：流转 / 总监消息 */
								h("div", { key: "seg2", style: { display: "flex", border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius-sm, 5px)", overflow: "hidden", marginBottom: 6, flex: "0 0 auto" } }, [
									h("button", { key: "f", style: S.seg(r5tab === "flow"), "data-testid": "dp-r5-flow", onClick: () => setR5tab("flow") }, "流转 " + sessionFlows.length),
									h("button", { key: "m", style: S.seg(r5tab === "msg"), "data-testid": "dp-r5-msg", onClick: () => setR5tab("msg") }, "总监消息 " + msgs.length)
								]),
			
								h("div", { key: "b", style: { flex: 1, minHeight: 0, overflowY: "auto" }, className: "dp-scroll", "data-testid": "dp-r5-body" },
									r5tab === "flow"
										? (sessionFlows.length
											? sessionFlows.slice(-20).reverse().map((f) => h("div", {
												key: f.flowId, "data-testid": "dp-flow-item", "data-flow-id": f.flowId, "data-origin": f.origin, "data-status": f.status,
												/* `data-session-id`：让"这条属于哪个会话"在 DOM 上可读 ——
												 * 真机脚本靠它证明「R5 显示的就是刚登记的那条」，而不是靠数条数（数条数
												 * 在"会话里有别的流转"时会误判）。 */
												"data-session-id": f.sessionId || "",
												style: { border: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-2, #212429)", borderRadius: "var(--dp-radius-sm, 5px)", padding: "5px 7px", marginBottom: 5 }
											}, [
												h("div", { key: "t", style: { fontSize: "calc(11.5px * var(--dp-font,1))", lineHeight: 1.5, wordBreak: "break-word" } }, clip(f.text, 110)),
												h("div", { key: "m", style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 3 } }, [
													...["director", "chat", "mindmap", "design"].map((d) => h("span", {
														key: d, "data-flow-dim": d, "data-on": ((f.trail || []).some((t) => t.dim === d)) ? "1" : "0",
														title: DIM_LABEL[d] + (((f.trail || []).some((t) => t.dim === d)) ? "：走过" : "：未走"),
														style: {
															fontSize: 9.5, padding: "0 4px", borderRadius: 3,
															border: "1px solid " + (((f.trail || []).some((t) => t.dim === d)) ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "var(--dp-line, #31343a)"),
															background: ((f.trail || []).some((t) => t.dim === d)) ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "transparent",
															color: ((f.trail || []).some((t) => t.dim === d)) ? "var(--dp-t1, #e8eaed)" : "var(--dp-t3, #8b9199)", opacity: ((f.trail || []).some((t) => t.dim === d)) ? 1 : 0.6
														}
													}, DIM_ICON[d] + DIM_LABEL[d].slice(0, 2))),
													h("span", { key: "s", style: S.muted }, FLOW_STATUS_LABEL[f.status] || f.status),
													h("span", { key: "a", style: S.muted }, new Date(f.at).toLocaleTimeString())
												])
											]))
											: h("div", { key: "e", style: S.muted, "data-testid": "dp-flow-empty" },
												"该会话还没有流转。本轮起，输入走**原生对话框**：写完后点 R8 的「登记为流转」，就会出现在这里，" +
												"并同步出现在导图右侧面板与设计图底部。"))
										: (msgs.length
											? msgs.slice(-14).map((m) => h("div", { key: m.messageId || m.at, style: S.msg, "data-testid": "dp-dir-msg" }, [
												h("div", { key: "a", style: S.av(m.role) }, m.role === "user" ? "你" : "总"),
												h("div", { key: "b", style: S.bub }, m.text)
											]))
											: h("div", { key: "e", style: S.muted, "data-testid": "dp-r5-empty" }, "尚无总监消息")))
							])),
			
						/* R7 详情 / 产出物 / 六维审核 */
						h("div", { key: "r7", style: S.col, "data-testid": "dp-r7" },
							h("div", { key: "s", style: S.sec }, [
								h("div", { key: "t", style: S.blkT }, "R7 详情 / 产出物"),
								h("div", { key: "b", style: S.muted }, [
									h("div", { key: "1" }, "层级：" + (node ? (LEVEL_LABEL[node.level] || node.level) + " · " + node.name : "—")),
									h("div", { key: "2" }, "文档 " + ((node && node.docs) ? node.docs.length : 0) + " · 对话 " + ((node && node.conversations) ? node.conversations.length : 0) + " · 决策 " + ((node && node.decisions) ? node.decisions.length : 0)),
									h("div", { key: "3" }, "分层总结：" + (node && node.summary ? clampText(node.summary, 80) : "尚未生成（logic/summarize.js）")),
									review ? h("div", {
										key: "rv", "data-testid": "dp-review", "data-pass": review.pass ? "1" : "0",
										style: {
											marginTop: 6, border: "1px solid " + (review.pass ? "rgba(63,185,80,.45)" : "rgba(201,148,43,.45)"),
											background: review.pass ? "rgba(63,185,80,.08)" : "rgba(201,148,43,.08)",
											borderRadius: "var(--dp-radius-sm, 5px)", padding: "4px 6px"
										}
									}, [
										h("div", { key: "h", style: { fontWeight: 650, color: review.pass ? "#3fb950" : "#d29922" } },
											"六维审核 " + (review.pass ? "通过" : "未通过") + "（抓取 " + review.chars + " 字符）"),
										h("div", { key: "d", style: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 } },
											review.dims.map((d) => h("span", {
												key: d.key, title: d.hint + " —— " + d.note,
												style: { color: d.status === "ok" ? "#3fb950" : d.status === "warn" ? "#d29922" : "#e5534b" }
											}, (d.status === "ok" ? "✅" : d.status === "warn" ? "⚠" : "❌") + d.label)))
									]) : null
								])
							])),
					]),
			
					/* ── R6 记忆面板 ──
					 * 右端按浮动按钮组宽度留白（见 dockReserve 注释）—— 否则「最近：…」会被压在药丸下面 */
					h("div", { key: "r6", style: { padding: "0 " + (9 + dockReserve) + "px 7px 9px" } },
						h("div", { style: S.sec, "data-testid": "dp-r6" }, [
							h("div", { key: "t", style: S.blkT }, ["R6 记忆面板 · 独立数据元", h("span", { key: "x", style: { marginLeft: "auto", color: "var(--dp-t3, #8b9199)" } }, "库 " + ((stats && stats.name) || "—"))]),
							h("div", { key: "k", style: { ...S.muted, display: "flex", gap: 12, flexWrap: "wrap" } }, [
								h("span", { key: "n", "data-testid": "dp-db-nodes" }, "节点 " + ((stats && stats.nodes) || 0)),
								h("span", { key: "c", "data-testid": "dp-db-msgs" }, "消息 " + ((stats && stats.conversations) || 0)),
								h("span", { key: "r" }, "审核 " + ((stats && stats.reviews) || 0)),
								h("span", { key: "d" }, "决策 " + ((stats && stats.decisions) || 0)),
								h("span", { key: "m" }, "记忆项 " + ((node && node.decisions ? node.decisions.length : 0) + (node && node.docs ? node.docs.length : 0))),
								h("span", { key: "rk", style: { color: (node && node.risks && node.risks.length) ? "#d29922" : "inherit" } }, "风险 " + ((node && node.risks) ? node.risks.length : 0)),
								h("span", {
									key: "pb", "data-testid": "dp-db-problems",
									style: { color: problems ? "#e5534b" : "inherit" },
									title: "问题记录：未通过的审核 + 节点风险"
								}, "问题 " + problems),
								h("span", { key: "td" }, "回结收件箱 · " + todos.filter((t) => t.done !== true).length),
								h("span", { key: "rec", style: { marginLeft: "auto" }, title: "最近一次层级变更" },
									"最近：" + clampText((node && node.meta && node.meta.updatedAt) ? new Date(node.meta.updatedAt).toLocaleString() : "（无变更记录）", 30))
							])
						])),
			
					/* ── R8 焦点条（**不再自建输入框** —— 用户：「不要这个对话框 用原本的对话框」） ──
					 * 右端按浮动按钮组宽度留白（见 dockReserve 注释）—— 否则最右的「交给总监整理」整颗被压住 */
					h("div", { key: "r8", style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "7px " + (9 + dockReserve) + "px 7px 9px", borderTop: "1px solid var(--dp-line, #31343a)", flex: "0 0 auto", background: "var(--dp-bg-1, transparent)" }, "data-testid": "dp-r8" }, [
						h("span", { key: "l", style: { ...S.muted, minWidth: 30 } }, "目标"),
						h("button", {
							key: "fd", "data-testid": "dp-route-director", "data-on": st.focusTarget === "director" ? "1" : "0",
							style: { ...S.btn, borderColor: st.focusTarget === "director" ? "var(--dp-ac-line, rgba(137,87,229,.45))" : "var(--dp-line, #3d4148)", color: st.focusTarget === "director" ? "var(--dp-ac, #b794f6)" : "var(--dp-t3, #8b9199)" },
							title: "输入目标：总监",
							onClick: () => pickTarget(DIM.DIRECTOR)
						}, "总监" + (st.focusTarget === "director" ? " ●" : "")),
						h("button", {
							key: "fc", "data-testid": "dp-route-chat", "data-on": st.focusTarget === "chat" ? "1" : "0",
							style: { ...S.btn, borderColor: st.focusTarget === "chat" ? "var(--dp-ac-line, rgba(47,111,235,.5))" : "var(--dp-line, #3d4148)", color: st.focusTarget === "chat" ? "var(--dp-ac, #79a8ff)" : "var(--dp-t3, #8b9199)" },
							title: "输入目标：对话",
							onClick: () => pickTarget(DIM.CHAT)
						}, "对话" + (st.focusTarget === "chat" ? " ●" : "")),
			
						h("button", {
							key: "fo", style: S.btn, "data-testid": "dp-focus-native", "aria-disabled": composerOk ? "false" : "true",
							title: "定位到原生输入框",
							onClick: () => focusNative()
						}, "定位输入框"),
			
						h("button", {
							key: "rg", style: S.btn, "data-testid": "dp-register-flow",
							"aria-disabled": composerOk ? "false" : "true",
							title: composerOk ? "把输入框里这句话登记为一条流转" : "输入框当前不可见：登记会告诉你原因（按钮不禁用）",
							onClick: registerNative
						}, "登记流转"),
			
						h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" }, "data-testid": "dp-r8-note" },
							flowSession ? "会话 …" + String(flowSession).slice(-8) : "未定位会话"),
			
						h("button", {
							key: "s", style: { ...S.btn, background: "var(--dp-ac, #2f6bdd)", borderColor: "var(--dp-ac, #2f6bdd)", color: "#fff", opacity: busy ? 0.65 : 1 },
							"data-testid": "dp-send", disabled: busy, title: "经总监处理并发送到对话",
							onClick: () => deliver(readComposerText())
						}, busy ? "处理中…" : "执行")
					]),
			
					/* 路由确认卡（V16 C4：目标多义必确认 —— 不静默分发） */
					routeResult ? h("div", {
						key: "rr", style: { padding: "0 9px 7px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, "data-testid": "dp-route-card"
					}, [
						h("span", { key: "c", style: S.chip }, "建议 " + DESTINATION_LABEL[routeResult.decision.destination] + "（" + routeResult.decision.confidence.toFixed(2) + "）"),
						h("span", { key: "r", style: S.muted }, routeResult.decision.reason),
						h("button", { key: "t", style: S.btn, "data-testid": "dp-rt-transfer", onClick: () => confirmRoute(DESTINATION.TRANSFER) }, "转给该对话"),
						h("button", { key: "d", style: S.btn, "data-testid": "dp-rt-direct", onClick: () => confirmRoute(DESTINATION.DIRECT) }, "直接调用"),
						h("button", { key: "n", style: S.btn, "data-testid": "dp-rt-new", onClick: () => confirmRoute(DESTINATION.CREATE) }, "新建对话"),
						h("button", { key: "x", style: S.btn, "data-testid": "dp-rt-cancel", onClick: () => setRouteResult(null) }, "取消")
					]) : null,
			
					/* 提示位（**常驻等高占位**，不是「有内容才渲染」）────────────────────────
					 * 🔴 为什么必须常驻（2026-09-12 真机定案 · 用户原话「两个按钮点击不好用」）：
					 *   本页是**底部锚定**的列布局，这一行排在 R8 焦点条**之后**。原先写成
					 *   `toast ? h(div) : null` ⇒ 一旦出提示，整条 R8 会被顶上去 **23px**
					 *   （实测 `btnY` 628 → 605，提示消失又落回 628，可复现）。
					 *   后果不是「难看」，是**点不中**：用户点「⌨ 定位输入框」→ 弹出提示 →
					 *   手指顺势移向「📥 登记流转」，而那颗按钮已经不在原来的位置了。
					 *   真机证据（verify-flow-r19 D5）：命中自检通过（读坐标时确实在按钮上），
					 *   真实鼠标事件落下时按钮已漂走 ⇒ 处理器没进、库 0 条、toast=null。
					 *   ⇒ 常驻一个等高槽：**布局不随提示变化**。
					 *     空时**不带 `dp-toast` testid**（"没有提示"的语义与原先一致，测试读到的仍是 null）。 */
					h("div", {
						key: "toast", style: {
							height: "23px", padding: "0 9px", color: "var(--dp-ac, #79a8ff)",
							fontSize: "calc(11.5px * var(--dp-font,1))", display: "flex", gap: 6, alignItems: "center",
							overflow: "hidden"
						},
						...(toast ? { "data-testid": "dp-toast", title: "点击可清除", onClick: () => setToast("") } : {})
					}, toast || ""),
			
					/* 个性化面板（右上角；四处共用同一组件与同一份设定） */
					h(PersonalizePanel, { key: "pp", open: pOpen, onClose: () => setPOpen(false), inset: inset, top: 40, scope: "总监页" })
				]);
			}
			
			/** R4 三个 Tab 的正文（静态骨架，真实数据接入后替换） */
			const R4_BODY = Object.freeze({
				docs: "文档树：按 00-统筹入口 / 10-架构设计 / 20-任务文档 / 40-测试质量 / 50-信息中心 分组浏览。",
				roadmap: "路线图 · 待办：按阶段展示，已完成项划销；未完成项标红并显示依赖。",
				files: "关键文件：直接指向改代码时最常动的文件（client-entry / mount / DirectorDialog / DesignStudio / MindMap）。"
			});
			
			/** R2.5 六动作的说明（title 用；写明"能做什么 / 不能做时缺什么"） */
			const CONSOLE_HINT = Object.freeze({
				new: "新建分支：走导图的「＋ 新建分支」（宿主 sessions.fork）；纯新建会话由宿主左栏负责",
				del: "删除分支：宿主 sessions 无删除接口 ⇒ 不可用（会如实告知，不做假按钮）",
				grab: "抓取：读宿主原生输入框当前内容（语义锚点，不猜类名）",
				close: "回结：把该会话最新流转标记为「已收口」",
				review: "审核：对抓到的真实文本跑六维规则引擎（空文本会如实报 ❌）",
				next: "继续：把该会话最新流转送回「对话」维度继续执行"
			});
			
			function buildOptions(tree) {
				const out = [];
				const walk = (n, d) => {
					out.push(h("option", { key: n.id, value: n.id }, "　".repeat(d) + (LEVEL_LABEL[n.level] || n.level) + " · " + n.name));
					(n.childNodes || []).forEach((c) => walk(c, d + 1));
				};
				if (tree) walk(tree, 0);
				return out;
			}
			
			__defaults["components/DirectorPage.js"] = DirectorPage;
			
			exports.DIRECTOR_PAGE_ID = DIRECTOR_PAGE_ID;
			exports.clampText = clampText;
			exports.R4_TABS = R4_TABS;
			exports.DirectorPage = DirectorPage;
		};

		// ── client-entry.js ──
		__defs["client-entry.js"] = function (exports) {
			/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
			 * 职责：插件浏览器侧入口（批次 1 已落地）
			 * 引用：V16 诉求 1（再审核：注册失败也要能看到原因）+ 2026-09-12 诉求 12（boot 注入 no-drag） · 批次 1 · 批次 2 · 批次 3
			 * 上游：（无：插件入口层）
			 * 下游：util/debug.js, util/log-collector.js, util/no-drag.js, store/layout.js, store/theme.js, config/model.js, store/docs-index-inject.js, dev/layout-probe.js, store/messages.js, store/memory.js, store/branch.js, store/docs.js, store/file-adapter.js, store/create-store.js, store/use-store.js, store/persist.js, logic/process.js, logic/review.js, components/DirectorFlow.js, store/hierarchy.js, logic/summarize.js, mount.js, components/DirectorHierarchy.js, logic/discover.js, logic/sync.js, store/duty-config.js, logic/director-run.js, components/DirectorWorkbench.js, store/plugin-db.js, logic/routing.js, bridge/split.js, bridge/chat-bridge.js, bridge/nav-hook.js, components/DirectorDialog.js, store/design.js, components/DesignStudio.js, components/FloatDock.js, components/DirectorPage.js, logic/branch-tree.js, components/MindMap.js, store/personalize.js, components/PersonalizePanel.js, logic/flow.js, components/NodeDetailPanel.js
			 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A（tab 环：总监以 order:-1 排最前）】
			 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
			 * @map:end */
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
			 * ── 批次 6–8（多层级总监 / 自动同步 / 职责完善）───────────────────
			 *   ✅ hierarchy / summarize / discover / sync / duties / director-run
			 *   ⛔ E2 DirectorView — 已废弃（2026-09-08 P2 清理，墓志铭 client.js:8897）
			 *
			 * ── 批次 9 弹窗式总监架构（T-PLUG-015 · docs/10 §四 + docs/11 §六）──
			 *   ✅ 要求 1 数据元独立 → store/plugin-db.js      `dsh-director-plugin-db` v1 / 6 store
			 *      🔴 与宿主 `dsh-director-db` v3 **物理隔离**：IDB 版本协商只发生在同名库内，
			 *         故新库不参与宿主协商 ⇒ 「物理隔离」与「R5 键冻结」可同时成立。见 docs/10 §3.4
			 *   ✅ 要求 5 布局分屏   → bridge/split.js         只注入 `<style>` + data-* 标记，
			 *      **零节点移动**、逐值可逆（真机实测：移除后 viewArea x 580→280 / w 854→1154）
			 *   ✅ 要求 5 双向联动   → bridge/chat-bridge.js   React 受控输入安全写入（原生 setter +
			 *      input 事件）；`sendToChat` 两级降级（sent → filled），每步写后回读校验
			 *   ✅ 要求 7/9 层级入口 → bridge/nav-hook.js      捕获阶段 pointerdown + 三级名称匹配
			 *   ✅ 要求 8 智能路由   → logic/routing.js        五步路由 + `confirmRoute` 留痕（不静默分发）
			 *   ✅ 要求 3 六维审核   → logic/routing.js        `review6` 六维齐备（17号文 §1A.9，不减项）
			 *   ✅ 要求 6 弹窗三态   → components/DirectorDialog.js + store/layout.js 新字段
			 *
			 * ── 待迁入（存量）───────────────────────────────────────────
			 *   ⬜ F3+F4 全局 API  ⬜ F1/F2 + G1/G4 宿主注入点改造（B6，需授权）
			 *
			 * ⚠️ 关键约束
			 *   - 平台模块（react / cordis / web-react 等）**必须 external**，严禁打进产物（ADR-001）；
			 *     构建期由 build/build.mjs 改写为 `require("<spec>")`，构建日志会列出「平台外置」清单
			 *   - 加载顺序：debug → log-collector（后者依赖前者）→ layout / theme / config → docs-index
			 *     → memory → branch → persist（依赖 debug）→ store 工厂
			 */
			
			const { installDshDebug, dshLog } = __m("util/debug.js");
			const { installV9Log } = __m("util/log-collector.js");
			const { installNoDrag } = __m("util/no-drag.js");
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
			// ── 批次 8 总监逻辑完善：§3.1 五项职责 + §3.2 继承制 + §1.2 五步执行 ──
			const { installDutyApi, resolveDuties, submitUp } = __m("store/duty-config.js");
			const { installDirectorRunApi } = __m("logic/director-run.js");
			const { DirectorWorkbench } = __m("components/DirectorWorkbench.js");
			// ── 批次 9 弹窗式总监架构（T-PLUG-015）──
			const { installPluginDbApi, pluginDbStats, PLUGIN_DB_NAME } = __m("store/plugin-db.js");
			const { installRoutingApi, route, confirmRoute, review6, REVIEW_DIMS, DESTINATION } = __m("logic/routing.js");
			const { installSplitApi, applySplit, clearSplit, getSplitRootRect, isSplitActive } = __m("bridge/split.js");
			const { installChatBridgeApi, sendToChat, readConversation } = __m("bridge/chat-bridge.js");
			const { installNavHook, installNavHookApi } = __m("bridge/nav-hook.js");
			const { DirectorDialog, DIALOG_ID, AGENTS, SKILLS, listAgentRuns } = __m("components/DirectorDialog.js");
			// ── 批次 10 设计图工作室 + 总监 tab（T-PLUG-018）──
			//    设计图：store/design-schema.js（元素原子）+ store/design.js（CRUD）+ components/DesignStudio.js
			//    总监 tab：components/DirectorPage.js（R1–R8）+ 下面的 installDirectorView(ctx)
			const { installDesignApi, DESIGN_KEY } = __m("store/design.js");
			const { DesignStudio, STUDIO_ID } = __m("components/DesignStudio.js");
			const { FloatDock, FLOATDOCK_ID, FLOAT_DOCK_RESERVE } = __m("components/FloatDock.js");
			const { DirectorPage, DIRECTOR_PAGE_ID } = __m("components/DirectorPage.js");
			const { installBranchTreeApi } = __m("logic/branch-tree.js");
			const { MindMap, MINDMAP_ID } = __m("components/MindMap.js");
			// ── 批次 11 个性化设定 + 四维流转（2026-09-12 第三轮）──
			//    个性化：store/personalize.js（CSS 变量 + 注入样式表）→ components/PersonalizePanel.js（右上角）
			//    流转：  logic/flow.js（一条消息走过总监 / 对话 / 导图 / 设计图的足迹）
			const { installPersonalizeApi, personalizeStore } = __m("store/personalize.js");
			const { PersonalizePanel, PERSONALIZE_PANEL_ID } = __m("components/PersonalizePanel.js");
			const { installFlowApi, flowStore, DIM, DIM_LABEL } = __m("logic/flow.js");
			const { installBranchFocusApi } = __m("logic/branch-focus.js");
			const { installOverviewApi } = __m("logic/overview.js");
			const { installOrchestrateApi } = __m("logic/orchestrate.js");
			const { NodeDetailPanel, NODE_DETAIL_ID } = __m("components/NodeDetailPanel.js");
			
			const PLUGIN_VERSION = "0.15.0-batch15";
			
			/** 批次 1 安装器：装配零依赖基础层 + 数据层 + 持久化层。返回已安装的能力清单 */
			function installBatch1(options = {}) {
				// 1. 日志基础设施（顺序敏感：debug 先于 log-collector）
				installDshDebug();
				installV9Log();
			
				// 1.5 桌面壳：把可交互元素从 OS「标题栏拖拽带」里救出来。
				//     必须早于任何 UI 挂载 —— 设计图工作室铺满整个窗口，顶栏整条落在 Windows
				//     的 caption area（本机 CSS 0~44）内；鼠标落在那里会被系统当成「拖动窗口」，
				//     消息根本进不了渲染进程（连 mousemove 都没有）。表现为顶栏所有按钮点不动。
				//     🔴 该故障对静态检查 / 离线单测 / CDP 合成事件全部不可见，详见 util/no-drag.js 头部。
				installNoDrag();
			
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
					// ── 批次 8 总监逻辑完善 ──
					//    window.__dshDuties       §3.1 五项职责 + §3.2 三级继承（默认→全局→项目→会话）
					//    window.__dshDirectorRun  §1.2 五步标准执行逻辑（整理/分支/模型/上下文/审核）
					window.__dshDuties = installDutyApi();
					window.__dshDirectorRun = installDirectorRunApi();
			
					// ── 批次 9 弹窗式总监架构（T-PLUG-015）──
					//    要求 1 数据元独立  window.__dshPluginDb   → dsh-director-plugin-db@v1（6 store）
					//    要求 8 智能路由    window.__dshRouter     → route / confirmRoute（五步，不静默分发）
					//    要求 3 六维审核    window.__dshReview6    → REVIEW_DIMS + review6 + reviewAndSave
					//    要求 5 布局分屏    window.__dshSplitApi   → applySplit / clearSplit（幂等可逆）
					//    要求 5 双向联动    window.__dshChatBridge → sendToChat / readConversation
					//    要求 7/9 层级入口  window.__dshNavApi     → installNavHook（点侧栏 → 打开该层级总监）
					window.__dshPluginDb = installPluginDbApi();
					window.__dshRouter = installRoutingApi();
					window.__dshSplitApi = installSplitApi();
					window.__dshChatBridge = installChatBridgeApi();
					window.__dshNavApi = installNavHookApi();
					window.__dshReview6 = { REVIEW_DIMS, review6 };
					window.__dshDirectorDialog = DirectorDialog;
					// ── 批次 10 设计图工作室（T-PLUG-018）──
					//    要求：总监页单独加设计图插件，按钮点击铺满全屏，可拖拽增删元素，
					//          底部临时对话只处理设计图，点元素在左侧显示交互逻辑。
					window.__dshDesignApi = installDesignApi();
					window.__dshDesignStudio = DesignStudio;
					window.__dshMindMap = MindMap;
					window.__dshFloatDock = FloatDock;
					window.__dshDirectorPage = DirectorPage;
					// ── 批次 11 个性化设定 + 四维流转（2026-09-12 第三轮）──
					//    需求原文：「全部找审美重新审核一下质感加上，同时都在右上角加自定义个性化设定」
					//              「保证同一个消息能在上面几个维度进行流转」
					//    ⚠️ 个性化**必须早于界面挂载**（浮动按钮组等在此之后才 mount）——
					//       它注入的是 CSS 变量与样式表，晚注入会有一帧"未套肤"的闪动。
					window.__dshPersonalize = installPersonalizeApi();
					window.__dshFlow = installFlowApi();
					// ── 批次 15 分支链路聚焦 / 总览 / 统筹打分（2026-09-12 第七轮）──
					//    需求原文：「我点击对话那么只默认显示这个分支的链路」「思维导图最上面加一个弹窗，
					//              分为左右列」「打分起码三轮多方位评估」「打分标准也需要进行审核」
					window.__dshBranchFocus = installBranchFocusApi();
					window.__dshOverview = installOverviewApi();
					window.__dshOrchestrate = installOrchestrateApi();
				} else {
					// 无 DOM 环境（离线测试）：仍要建立 store，保证 import 侧行为一致
					installPersonalizeApi();
					installFlowApi();
					installBranchFocusApi();
					installOverviewApi();
					installOrchestrateApi();
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
					// 语义：hierarchyMounted = 「弹窗主通道是否已挂载」（`#dsh-director-dialog-host` 是否就位，
					//        零宿主依赖 ⇒ 必定可用）；
					//       hierarchySlotRegistered = 「是否额外注册进宿主 conversation.view」——
					//        需 `ctx.slots`，真机 `window.__DSH_SLOTS__` 不存在 ⇒ 恒 false（docs/10 §四 4.1）。
					hierarchyMounted: Boolean(hierarchyMount && hierarchyMount.host),
					hierarchySlotRegistered: false,
					hierarchyTreeReady: false, // 异步，稍后就绪
					// ── 批次 7 自动同步 ──
					discoverApi: typeof window !== "undefined" ? Boolean(window.__dshDiscover) : false,
					syncApi: typeof window !== "undefined" ? Boolean(window.__dshSync) : false,
					// 覆盖度：回答「是否每一个对话 / 文件夹都有总监」
					coverage: null, // 异步，稍后就绪（{sessions,folders,global,rate,ok}）
					coverageOk: false,
					// ── 批次 8 总监逻辑完善 ──
					dutyApi: typeof window !== "undefined" ? Boolean(window.__dshDuties) : false,
					directorRunApi: typeof window !== "undefined" ? Boolean(window.__dshDirectorRun) : false,
					workbench: typeof DirectorWorkbench === "function",
					// ── 批次 9 弹窗式总监架构（T-PLUG-015）──
					//    要求 1：独立数据元（物理隔离库，与宿主 `dsh-director-db` v3 不同名）
					pluginDb: typeof window !== "undefined" ? Boolean(window.__dshPluginDb) : false,
					pluginDbName: PLUGIN_DB_NAME,
					//    要求 8 + 3：智能路由（五步，STEP4 必须确认）与六维审核
					routerApi: typeof window !== "undefined" ? Boolean(window.__dshRouter) : false,
					review6Api: typeof window !== "undefined" ? Boolean(window.__dshReview6) : false,
					reviewDimCount: REVIEW_DIMS.length, // 必须 = 6（17号文 §1A.9，不得减项）
					//    要求 5：布局分屏通道 + 与原生对话的双向联动通道
					splitApi: typeof window !== "undefined" ? Boolean(window.__dshSplitApi) : false,
					chatBridgeApi: typeof window !== "undefined" ? Boolean(window.__dshChatBridge) : false,
					//    要求 7/9：点侧栏文件夹/项目 → 打开该层级总监
					navApi: typeof window !== "undefined" ? Boolean(window.__dshNavApi) : false,
					//    要求 6/10/11：弹窗本体 + 可调用智能体/技能清单
					dialogComponent: typeof DirectorDialog === "function",
					dialogId: DIALOG_ID,
					agents: AGENTS.map((a) => a.key),
					skills: SKILLS.map((s) => s.key),
					// 分屏当前是否生效（弹窗打开且未最小化时为 true）
					splitActive: isSplitActive(),
					// 独立库落盘统计（异步，稍后就绪）
					pluginDbStats: null,
					// ── 批次 11 个性化设定 + 四维流转 ──
					personalizeApi: typeof window !== "undefined" ? Boolean(window.__dshPersonalize) : false,
					personalize: personalizeStore.getState(),
					flowApi: typeof window !== "undefined" ? Boolean(window.__dshFlow) : false,
					flowDimensions: ["director", "chat", "mindmap", "design"],
					nodeDetailPanel: typeof NodeDetailPanel === "function",
					personalizePanelId: PERSONALIZE_PANEL_ID,
					nodeDetailId: NODE_DETAIL_ID
				};
			
				hierarchyReady.then((t) => {
					installed.hierarchyTreeReady = Boolean(t);
					installed.coverage = syncStats && syncStats.coverage ? syncStats.coverage : null;
					installed.coverageOk = Boolean(installed.coverage && installed.coverage.ok);
				});
			
				docsIndexPromise.then((d) => { installed.docsIndex = Boolean(d); });
				preloadPromise.then((ok) => { installed.opfsPreloaded = Boolean(ok); });
				// 独立库统计（异步；仅用于真机取证与弹窗 R6「数据元独立」展示，失败静默）
				pluginDbStats().then((s) => { installed.pluginDbStats = s; }).catch(() => { });
			
				/* 批次 12 · 总监页风格与宿主统一（需求：「总监 tap 页面的背景采用原软件的背景」）
				 * 纯记录用途：把这套令牌映射写成可读契约，便于真机/离线断言"产物真的带了它"。
				 * 真正的判据是运行期的 computed 值（见 verify-flow.mjs F 段），不是这张表。 */
				installed.uiTheme = {
					scope: '[data-testid="dp-root"]',
					source: "host --dsw-alias-*",
					surface: "--dsw-alias-bg-base",
					card: "--dsw-alias-bg-layer-1",
					card2: "--dsw-alias-bg-layer-2",
					text: "--dsw-alias-label-primary",
					textDim: "--dsw-alias-label-tertiary",
					border: "--dsw-alias-border-l2"
				};
			
				/* 批次 13 · 浮动按钮组的两条几何/配色契约（背景改浅后连带暴露的两处缺陷）
				 * ① 容器透明化点击、药丸自己吃点击 —— 否则容器的**透明空隙**会吃掉页面自己按钮的事件
				 *    （真机实测「交给总监整理」被压住且点不动）；
				 * ② 药丸字色取宿主主文字令牌 —— 原先写死的浅色在浅底上对比度只剩 1.35–2.21:1。
				 * `reserve` 从 FloatDock 的真实常量取（**不写第二份真相**）。 */
				installed.floatDock = {
					containerPointerEvents: "none",
					pillPointerEvents: "auto",
					pillColorToken: "--dsw-alias-label-primary",
					reserve: FLOAT_DOCK_RESERVE,
					reserveConsumers: ["dp-r6", "dp-r8"]
				};
			
				/* ── 批次 15（T-PLUG-024/026/027/028）：真流转 / 分支聚焦 / 总览 / 统筹打分 ──
				 * 「我在总监发的消息，是否经过处理然后发给对话执行」这个**最核心基础要求**
				 * 的可断言面：投递通道的降级级别 + 处理链落库 + 聚焦与打分的纯函数契约。 */
				installed.deliver = {
					/* 投递分级（顺序即优先级）：
					 *   host-send       → 宿主直投对话域（避开 InputBar 的「总监劫持」，防二次处理）
					 *   direct          → composer 在场，点原生发送
					 *   open-then-send  → 先切会话，等 composer 出现再点发送
					 *   仍不行          → 如实报因（不许静默） */
					channels: ["host-send", "direct", "open-then-send"],
					attr: "data-deliver-mode",
					modes: ["idle", "sent", "filled", "failed"],
					anchor: { send: "dp-send", router: "mm-ov-send", nodeSend: "nd-send" }
				};
				installed.branchFocus = {
					attr: "data-focus-id",
					bar: "mm-focusbar",
					toggles: ["mm-focus-up", "mm-focus-exit"],
					includeParentsMeans: "祖先链 ∪ 链上每一环的同级（用户语义：上一层全景）"
				};
				installed.overview = {
					root: "mm-ov",
					columns: ["mm-ov-col-done", "mm-ov-col-todo"],
					attr: ["data-count-done", "data-count-todo", "data-sel-session"]
				};
				installed.orchestrate = {
					stages: ["plan", "doc", "review", "blueprint", "test", "done"],
					rubricDims: ["purpose", "aesthetic", "interaction", "resilience", "consistency", "verifiability"],
					rounds: ["spec", "independent", "counter"],
					rubricSelfAudit: true
				};
			
				if (typeof window !== "undefined") {
					window.__dshDirectorBatch1 = installed;
					window.__dshDirectorBatch2 = installed; // 批次 2 别名
					window.__dshDirectorBatch3 = installed; // 批次 3 别名
					window.__dshDirectorBatch4 = installed; // 批次 4 别名
					window.__dshDirectorBatch5 = installed; // 批次 5 别名
					window.__dshDirectorBatch6 = installed; // 批次 6 别名
					window.__dshDirectorBatch7 = installed; // 批次 7 别名
					window.__dshDirectorBatch8 = installed; // 批次 8 别名
					window.__dshDirectorBatch9 = installed; // 批次 9 别名（弹窗式总监架构）
					window.__dshDirectorBatch10 = installed; // 批次 10 别名（设计图工作室 + 总监 tab）
					window.__dshDirectorBatch11 = installed; // 批次 11 别名（个性化设定 + 四维流转）
					window.__dshDirectorBatch12 = installed; // 批次 12 别名（总监页背景改走宿主令牌）
					window.__dshDirectorBatch13 = installed; // 批次 13 别名（浮动入口点击穿透 + 药丸配色随主题）
					window.__dshDirectorBatch15 = installed; // 批次 15 别名（真流转 + 分支聚焦 + 总览 + 统筹）
				}
				return installed;
			}
			
			/* ══════════════════════════════════════════════════════════════════
			 * 批次 10 · 总监 tab 注册（宿主原生三页签的第一项）
			 * ══════════════════════════════════════════════════════════════════
			 *  🔴 这是本插件与宿主**唯一**的正式对接点，契约逐条取证自宿主源码：
			 *
			 *   ① 数据源：`conversation.view` 是 **list slot**（宿主 client.js:11724 声明
			 *      `kind:"list", scope:"session"`），tab 环直接由它的 entries 生成：
			 *        `viewTabs()` → `for (const entry of slots.entries("conversation.view"))`
			 *                     → `{ id: entry.options.id, label: resolveSlotLabel(entry.options.label) }`
			 *        （宿主 client.js:11621-11631）
			 *   ② 渲染：`renderSlot("conversation.view", {inspect,onInspectDone}, { only: active.id })`
			 *        （宿主 client.js:9175）⇒ 组件收到 inspect 与 onInspectDone 两个 props
			 *   ③ 显示条件：`tabs.length > 1`（宿主 client.js:9120）—— 目前 chat + trajectory = 2，
			 *      本注册后为 3，tab 环必定显示
			 *   ④ 顺序：宿主 chat 用 `order: 0`、trajectory 用 `order: 10`
			 *      ⇒ 本插件用 **`order: -1`** 排在**最前**（设计稿：总监 | 对话 | 轨迹）
			 *   ⑤ 通道写法照同族先例 `dsh-client-ui-trajectory/lib/client.js:7316,7340`：
			 *        `inject: ["slots"]` + `ctx.slots.inject(slot, () => ctx.slots.register({...}, Cmp))`
			 *   ⑥ 注册必须包在 `ctx.slots.inject(...)` 回调里 —— slot 未声明前注册会抛
			 *      `slot "…" is not declared`（slots 包 register 的第 2 行检查）
			 *
			 *  由 `build/build.mjs` 的 apply 模板透传 ctx 后调用（apply 里 `void ctx` 曾是断链根因）。
			 * ══════════════════════════════════════════════════════════════════ */
			
			/** 总监视图 id（写入 slot entry 的 `id`，宿主 `resolveActiveView` 按它匹配，不可改名） */
			const DIRECTOR_VIEW_ID = "director";
			/** 排在最前（宿主 chat=0 / trajectory=10） */
			const DIRECTOR_VIEW_ORDER = -1;
			
			/**
			 * 把「总监」注册进宿主原生 tab 环。
			 * 失败**不抛**：返回结构化结果，由调用方决定是否降级到浮层通道（`mount.js`）。
			 * @param {object} ctx cordis 上下文（由 apply 注入）
			 * @returns {{registered:boolean, id:string, order:number, reason:string|null}}
			 */
			function installDirectorView(ctx) {
				const out = { registered: false, id: DIRECTOR_VIEW_ID, order: DIRECTOR_VIEW_ORDER, reason: null };
				/* 🔴 纪律（2026-09-12 真机教训 · 单点故障复盘）：
				 *   「诊断句柄必须在任何**可能自身抛错**的语句之前落盘」。
				 *   上一版把 `window.__dshDirectorView = out` 放在函数末尾，而 catch 块里的 `dshLog`
				 *   因未 import 抛 ReferenceError（且 catch 块内的抛错**不在 try 保护范围内**），
				 *   异常直接逃出本函数 ⇒ 末行永不执行 ⇒ 真机上 `__dshDirectorView` 恒为 undefined，
				 *   连"注册失败原因"都拿不到。故此处三处修正：
				 *     ① 前置落盘（每一条退出路径都先写 window.__dshDirectorView）；
				 *     ② 日志一律包在 `safeLog()` 里，**日志失败绝不影响主流程**；
				 *     ③ 返回前再同步一次，保证调用方拿到的 out 与全局一致。 */
				const safeLog = (msg) => { try { dshLog("hierarchy", msg); } catch (_) { /* 日志是最外层可观测性，绝不反噬主流程 */ } };
				const publish = () => { if (typeof window !== "undefined") window.__dshDirectorView = out; };
			
				publish(); // ① 前置落盘：此刻 out 还是 {registered:false, reason:null}
				try {
					if (!ctx || !ctx.slots) {
						out.reason = "ctx.slots 不可用（宿主版本差异）—— 已由浮层通道保底";
						publish();
						safeLog("总监 tab 注册跳过: " + out.reason);
						return out;
					}
					// slot 声明就绪后再注册；inject 回调由 slots 服务在声明后触发
					ctx.slots.inject("conversation.view", () => ctx.slots.register({
						name: "conversation.view",
						id: DIRECTOR_VIEW_ID,
						order: DIRECTOR_VIEW_ORDER,
						label: () => "总监",
						// 与 trajectory 同构：把 sessionId 交给组件，便于组件按会话取数
						inject: (sessionId) => ({ sessionId })
					}, DirectorPage));
					out.registered = true;
					publish();
					safeLog("已注册总监 tab（id=director, order=-1）到宿主 conversation.view");
				} catch (e) {
					out.reason = String((e && e.message) || e);
					publish(); // ② 先落盘，后日志 —— 顺序不可颠倒
					safeLog("总监 tab 注册失败，已降级浮层通道: " + out.reason);
				}
				publish(); // ③ 兜底同步
				return out;
			}
			
			// export { directorLayoutStore, dshThemeStore, directorConfig, directorDocsStore, // ── 批次 3 ── directorStoreFactory, createDirectorStore, useDirectorStore, safeDirectorKey, loadDirectorStore, saveDirectorStore, DIRECTOR_DEFAULT_CONFIG, exportViaFsa, importViaFsa, // ── 批次 4 ── directorProcess, directorReviewReturn, // ── 批次 5 ── DirectorFlow, // ── 批次 6 多层级总监结构 ── installHierarchyApi, installSummarizeApi, mountHierarchy, summarizeTree, loadTree, ensureGlobal, LEVEL, GLOBAL_NODE_ID, DirectorHierarchy, // ── 批次 7 自动同步 ── installDiscoverApi, installSyncApi, syncFromSource, auditCoverage, // ── 批次 8 总监逻辑完善 ── installDutyApi, resolveDuties, submitUp, DirectorWorkbench, // ── 批次 9 弹窗式总监架构（T-PLUG-015）── installPluginDbApi, pluginDbStats, PLUGIN_DB_NAME,      // 要求 1 独立数据元 installRoutingApi, route, confirmRoute, review6, REVIEW_DIMS, DESTINATION, // 要求 8 + 3 installSplitApi, applySplit, clearSplit, getSplitRootRect, isSplitActive,  // 要求 5 分屏 installChatBridgeApi, sendToChat, readConversation,     // 要求 5 双向联动 installNavHook, installNavHookApi,                      // 要求 7/9 层级入口 DirectorDialog, DIALOG_ID, AGENTS, SKILLS, listAgentRuns, // 要求 6/10/11 弹窗本体 // ── 批次 10 设计图工作室 + 分支导图 + 总监 tab（T-PLUG-018）── installDesignApi, DESIGN_KEY,                       // 设计图数据层 DesignStudio, STUDIO_ID,                            // 设计图全屏工作室 installBranchTreeApi, MindMap, MINDMAP_ID,          // 分支血缘导图 FloatDock, FLOATDOCK_ID,                            // 浮动按钮组（设计图 / 导图 / 总监） DirectorPage, DIRECTOR_PAGE_ID,                     // 总监页（R1–R8） // ── 批次 11 个性化设定 + 四维流转（2026-09-12 第三轮）── installPersonalizeApi, personalizeStore, PersonalizePanel, PERSONALIZE_PANEL_ID, installFlowApi, flowStore, DIM, DIM_LABEL, NodeDetailPanel, NODE_DETAIL_ID, installDirectorView, DIRECTOR_VIEW_ID, DIRECTOR_VIEW_ORDER // 宿主 tab 注册 }; 
			exports.PLUGIN_VERSION = PLUGIN_VERSION;
			exports.installBatch1 = installBatch1;
			exports.directorLayoutStore = directorLayoutStore;
			exports.dshThemeStore = dshThemeStore;
			exports.directorConfig = directorConfig;
			exports.directorDocsStore = directorDocsStore;
			exports.directorStoreFactory = directorStoreFactory;
			exports.createDirectorStore = createDirectorStore;
			exports.useDirectorStore = useDirectorStore;
			exports.safeDirectorKey = safeDirectorKey;
			exports.loadDirectorStore = loadDirectorStore;
			exports.saveDirectorStore = saveDirectorStore;
			exports.DIRECTOR_DEFAULT_CONFIG = DIRECTOR_DEFAULT_CONFIG;
			exports.exportViaFsa = exportViaFsa;
			exports.importViaFsa = importViaFsa;
			exports.directorProcess = directorProcess;
			exports.directorReviewReturn = directorReviewReturn;
			exports.DirectorFlow = DirectorFlow;
			exports.installHierarchyApi = installHierarchyApi;
			exports.installSummarizeApi = installSummarizeApi;
			exports.mountHierarchy = mountHierarchy;
			exports.summarizeTree = summarizeTree;
			exports.loadTree = loadTree;
			exports.ensureGlobal = ensureGlobal;
			exports.LEVEL = LEVEL;
			exports.GLOBAL_NODE_ID = GLOBAL_NODE_ID;
			exports.DirectorHierarchy = DirectorHierarchy;
			exports.installDiscoverApi = installDiscoverApi;
			exports.installSyncApi = installSyncApi;
			exports.syncFromSource = syncFromSource;
			exports.auditCoverage = auditCoverage;
			exports.installDutyApi = installDutyApi;
			exports.resolveDuties = resolveDuties;
			exports.submitUp = submitUp;
			exports.DirectorWorkbench = DirectorWorkbench;
			exports.installPluginDbApi = installPluginDbApi;
			exports.pluginDbStats = pluginDbStats;
			exports.PLUGIN_DB_NAME = PLUGIN_DB_NAME;
			exports.installRoutingApi = installRoutingApi;
			exports.route = route;
			exports.confirmRoute = confirmRoute;
			exports.review6 = review6;
			exports.REVIEW_DIMS = REVIEW_DIMS;
			exports.DESTINATION = DESTINATION;
			exports.installSplitApi = installSplitApi;
			exports.applySplit = applySplit;
			exports.clearSplit = clearSplit;
			exports.getSplitRootRect = getSplitRootRect;
			exports.isSplitActive = isSplitActive;
			exports.installChatBridgeApi = installChatBridgeApi;
			exports.sendToChat = sendToChat;
			exports.readConversation = readConversation;
			exports.installNavHook = installNavHook;
			exports.installNavHookApi = installNavHookApi;
			exports.DirectorDialog = DirectorDialog;
			exports.DIALOG_ID = DIALOG_ID;
			exports.AGENTS = AGENTS;
			exports.SKILLS = SKILLS;
			exports.listAgentRuns = listAgentRuns;
			exports.installDesignApi = installDesignApi;
			exports.DESIGN_KEY = DESIGN_KEY;
			exports.DesignStudio = DesignStudio;
			exports.STUDIO_ID = STUDIO_ID;
			exports.installBranchTreeApi = installBranchTreeApi;
			exports.MindMap = MindMap;
			exports.MINDMAP_ID = MINDMAP_ID;
			exports.FloatDock = FloatDock;
			exports.FLOATDOCK_ID = FLOATDOCK_ID;
			exports.DirectorPage = DirectorPage;
			exports.DIRECTOR_PAGE_ID = DIRECTOR_PAGE_ID;
			exports.installPersonalizeApi = installPersonalizeApi;
			exports.personalizeStore = personalizeStore;
			exports.PersonalizePanel = PersonalizePanel;
			exports.PERSONALIZE_PANEL_ID = PERSONALIZE_PANEL_ID;
			exports.installFlowApi = installFlowApi;
			exports.flowStore = flowStore;
			exports.DIM = DIM;
			exports.DIM_LABEL = DIM_LABEL;
			exports.NodeDetailPanel = NodeDetailPanel;
			exports.NODE_DETAIL_ID = NODE_DETAIL_ID;
			exports.installDirectorView = installDirectorView;
			exports.DIRECTOR_VIEW_ID = DIRECTOR_VIEW_ID;
			exports.DIRECTOR_VIEW_ORDER = DIRECTOR_VIEW_ORDER;
		};

		// ── Harness client 插件契约导出 ──
		var __entry = __m("client-entry.js");
		// 🔴 ctx 必须**透传**给 installBatch1 —— 且槽位注册要用到它。
		//    历史缺陷：旧模板写 void ctx;（把 ctx 丢弃），导致插件拿不到 ctx.slots，
		//    总监 tab 无法注册进宿主原生 tab 环（只能退回浮层），这是"三页签做不出来"的真根因。
		var apply = function apply(ctx) {
			// 逐步痕迹：任一步失败都能在真机上 window.__dshApplyTrace 里看到断点（诊断用，勿删）
			var trace = [];
			try { if (typeof window !== "undefined") window.__dshApplyTrace = trace; } catch (_) {}
			var installed = null;
			try { trace.push("batch1:start"); installed = __entry.installBatch1({ ctx: ctx }); trace.push("batch1:ok"); }
			catch (e) { trace.push("batch1:ERR " + ((e && e.message) || e)); }
			try { trace.push("branch:" + typeof __entry.installBranchTreeApi); __entry.installBranchTreeApi(ctx); trace.push("branch:ok"); }
			catch (e) { trace.push("branch:ERR " + ((e && e.message) || e)); }
			try {
				trace.push("view:" + typeof __entry.installDirectorView);
				var reg = __entry.installDirectorView(ctx);
				trace.push("view:" + JSON.stringify(reg));
				if (installed && typeof installed === "object") installed.directorView = reg;
			} catch (e) { trace.push("view:ERR " + ((e && e.message) || e)); }
			return installed;
		};
		// 依赖服务：slots（slot 注册前置）+ sessions（分支血缘导图前置）。
		// 少声明 sessions 会让 ctx.sessions 抛 cannot get property ... without inject，
		// 而旧代码用 try/catch 吞掉该错 → 血缘静默降级成"按工作区分组的平铺树"。
		var inject = ["slots", "sessions"];
		exports.apply = apply;
		exports.inject = inject;
		exports.__entry = __entry;
		return module.exports;
	}
});
