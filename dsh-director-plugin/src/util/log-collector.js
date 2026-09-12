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

export const V9_LOG_MAX = 2000;
export const V9_LOG_TRIM_TO = 1000;

export function installV9Log() {
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
