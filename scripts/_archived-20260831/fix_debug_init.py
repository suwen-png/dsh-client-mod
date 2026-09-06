filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 在文件存储检测之前插入最小化的__dshDebug初始化
old_marker = '// V10: 文件存储检测（最可靠的持久化方式，直接写JSON文件）'

init_code = '''// V10: 提前初始化__dshDebug（文件存储检测需要用log）
		if (typeof window !== "undefined" && !window.__dshDebug) {
			window.__dshDebug = {
				logs: [],
				scrollStates: {},
				enabled: true,
				log: function(scope, message, data) {
					if (!this.enabled) return;
					const entry = { time: new Date().toISOString(), scope: scope, message: message, data: data !== void 0 ? data : null };
					this.logs.push(entry);
					if (this.logs.length > 2000) this.logs.shift();
					console.log("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
				},
				warn: function(scope, message, data) {
					const entry = { time: new Date().toISOString(), scope: scope, message: message, data: data !== void 0 ? data : null, level: "WARN" };
					this.logs.push(entry);
					if (this.logs.length > 2000) this.logs.shift();
					console.warn("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
				},
				setScrollState: function(id, state) { this.scrollStates[id] = Object.assign({ time: Date.now() }, state); },
				getScrollState: function(id) { return this.scrollStates[id] || null; },
				exportLogs: function() {
					const lines = this.logs.map((e) => "[" + e.time + "] [" + (e.level || "INFO") + "] [" + e.scope + "] " + e.message + (e.data ? " " + JSON.stringify(e.data) : ""));
					return lines.join("\\n");
				},
				clear: function() { this.logs = []; this.scrollStates = {}; },
				scrollProbe: function(id, el) {
					if (!el) return null;
					const state = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= 25 };
					this.setScrollState(id, state);
					return state;
				},
				findScrollContainers: function(id, fromEl) {
					if (!fromEl) return [];
					const chain = [];
					let el = fromEl;
					let depth = 0;
					while (el && depth < 15) {
						const style = window.getComputedStyle(el);
						const overflowY = style.overflowY;
						const isScrollable = el.scrollHeight > el.clientHeight + 1 && (overflowY === "auto" || overflowY === "scroll");
						chain.push({ depth: depth, tag: el.tagName, overflowY: overflowY, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, isScrollable: isScrollable });
						el = el.parentElement;
						depth++;
					}
					return chain;
				}
			};
		}
		'''

if old_marker in content:
    content = content.replace(old_marker, init_code + old_marker, 1)
    print('提前初始化__dshDebug插入成功')
else:
    print('插入失败: 未找到目标字符串')

# 同时把文件存储检测中的console.log改回__dshDebug.log
content = content.replace('console.log("[DSH:persist]', 'if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "')

# 但这样替换会有问题，因为console.log的参数格式和__dshDebug.log不同
# 让我用更精确的替换
# 实际上，让我先恢复文件存储检测中的log调用，使用__dshDebug.log

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
