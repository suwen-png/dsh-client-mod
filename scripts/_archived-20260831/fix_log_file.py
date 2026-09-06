import re

filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 修改log方法，增加实时文件写入
old_log = '''log: function(scope, message, data) {
						if (!this.enabled) return;
						const entry = { time: new Date().toISOString(), scope: scope, message: message, data: data !== void 0 ? data : null };
						this.logs.push(entry);
						if (this.logs.length > 2000) this.logs.shift();
						console.log("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
					},'''

new_log = '''log: function(scope, message, data) {
						if (!this.enabled) return;
						const entry = { time: new Date().toISOString(), scope: scope, message: message, data: data !== void 0 ? data : null };
						this.logs.push(entry);
						if (this.logs.length > 2000) this.logs.shift();
						console.log("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
						// V10: 实时写入文件
						try {
							if (typeof directorFs !== "undefined" && directorFs && directorPath) {
								const logDir = directorPath.join((typeof process !== "undefined" && process.env) ? (process.env.APPDATA || process.env.HOME || ".") : ".", "dsh-director");
								if (!directorFs.existsSync(logDir)) directorFs.mkdirSync(logDir, { recursive: true });
								const logFile = directorPath.join(logDir, "debug.log");
								const line = "[" + entry.time + "] [INFO] [" + scope + "] " + message + (entry.data ? " " + JSON.stringify(entry.data) : "") + "\\n";
								directorFs.appendFileSync(logFile, line, "utf-8");
							}
						} catch (e) {}
					},'''

if old_log in content:
    content = content.replace(old_log, new_log, 1)
    print('log方法修改成功')
else:
    print('log方法修改失败: 未找到目标字符串')

# 修改warn方法，增加实时文件写入
old_warn = '''warn: function(scope, message, data) {
						const entry = { time: new Date().toISOString(), scope: scope, message: message, data: data !== void 0 ? data : null, level: "WARN" };
						this.logs.push(entry);
						if (this.logs.length > 2000) this.logs.shift();
						console.warn("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
					},'''

new_warn = '''warn: function(scope, message, data) {
						const entry = { time: new Date().toISOString(), scope: scope, message: message, data: data !== void 0 ? data : null, level: "WARN" };
						this.logs.push(entry);
						if (this.logs.length > 2000) this.logs.shift();
						console.warn("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
						// V10: 实时写入文件
						try {
							if (typeof directorFs !== "undefined" && directorFs && directorPath) {
								const logDir = directorPath.join((typeof process !== "undefined" && process.env) ? (process.env.APPDATA || process.env.HOME || ".") : ".", "dsh-director");
								if (!directorFs.existsSync(logDir)) directorFs.mkdirSync(logDir, { recursive: true });
								const logFile = directorPath.join(logDir, "debug.log");
								const line = "[" + entry.time + "] [WARN] [" + scope + "] " + message + (entry.data ? " " + JSON.stringify(entry.data) : "") + "\\n";
								directorFs.appendFileSync(logFile, line, "utf-8");
							}
						} catch (e) {}
					},'''

if old_warn in content:
    content = content.replace(old_warn, new_warn, 1)
    print('warn方法修改成功')
else:
    print('warn方法修改失败: 未找到目标字符串')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
