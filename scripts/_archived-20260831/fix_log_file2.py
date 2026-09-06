import re

filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 用正则表达式替换log方法
# 匹配 log: function(scope, message, data) { ... console.log(...) },
log_pattern = r'(log:\s*function\(scope,\s*message,\s*data\)\s*\{[^}]*?console\.log\("\[DSH:"\s*\+\s*scope[^}]*?\}\s*,)'

def replace_log(match):
    old = match.group(1)
    # 在console.log之后增加文件写入代码
    insert_code = '''
						// V10: 实时写入文件
						try {
							if (typeof directorFs !== "undefined" && directorFs && directorPath) {
								const logDir = directorPath.join((typeof process !== "undefined" && process.env) ? (process.env.APPDATA || process.env.HOME || ".") : ".", "dsh-director");
								if (!directorFs.existsSync(logDir)) directorFs.mkdirSync(logDir, { recursive: true });
								const logFile = directorPath.join(logDir, "debug.log");
								const line = "[" + entry.time + "] [INFO] [" + scope + "] " + message + (entry.data ? " " + JSON.stringify(entry.data) : "") + "\\n";
								directorFs.appendFileSync(logFile, line, "utf-8");
							}
						} catch (e) {}'''
    # 在最后一个}之前插入
    new = old[:-2] + insert_code + '\n\t\t\t\t\t},'
    return new

new_content = re.sub(log_pattern, replace_log, content, count=1)
if new_content != content:
    print('log方法修改成功')
    content = new_content
else:
    print('log方法修改失败')

# 同样修改warn方法
warn_pattern = r'(warn:\s*function\(scope,\s*message,\s*data\)\s*\{[^}]*?console\.warn\("\[DSH:"\s*\+\s*scope[^}]*?\}\s*,)'

def replace_warn(match):
    old = match.group(1)
    insert_code = '''
						// V10: 实时写入文件
						try {
							if (typeof directorFs !== "undefined" && directorFs && directorPath) {
								const logDir = directorPath.join((typeof process !== "undefined" && process.env) ? (process.env.APPDATA || process.env.HOME || ".") : ".", "dsh-director");
								if (!directorFs.existsSync(logDir)) directorFs.mkdirSync(logDir, { recursive: true });
								const logFile = directorPath.join(logDir, "debug.log");
								const line = "[" + entry.time + "] [WARN] [" + scope + "] " + message + (entry.data ? " " + JSON.stringify(entry.data) : "") + "\\n";
								directorFs.appendFileSync(logFile, line, "utf-8");
							}
						} catch (e) {}'''
    new = old[:-2] + insert_code + '\n\t\t\t\t\t},'
    return new

new_content = re.sub(warn_pattern, replace_warn, content, count=1)
if new_content != content:
    print('warn方法修改成功')
    content = new_content
else:
    print('warn方法修改失败')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
