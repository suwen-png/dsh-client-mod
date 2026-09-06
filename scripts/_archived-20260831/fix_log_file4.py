filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 精确替换log方法中的console.log行
old_log_line = '\t\t\t\t\tconsole.log("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");\n\t\t\t\t},'

new_log_block = '''\t\t\t\t\tconsole.log("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
\t\t\t\t\t// V10: 实时写入文件
\t\t\t\t\ttry {
\t\t\t\t\t\tif (typeof directorFs !== "undefined" && directorFs && directorPath) {
\t\t\t\t\t\t\tconst logDir = directorPath.join((typeof process !== "undefined" && process.env) ? (process.env.APPDATA || process.env.HOME || ".") : ".", "dsh-director");
\t\t\t\t\t\t\tif (!directorFs.existsSync(logDir)) directorFs.mkdirSync(logDir, { recursive: true });
\t\t\t\t\t\t\tconst logFile = directorPath.join(logDir, "debug.log");
\t\t\t\t\t\t\tconst line = "[" + entry.time + "] [INFO] [" + scope + "] " + message + (entry.data ? " " + JSON.stringify(entry.data) : "") + "\\n";
\t\t\t\t\t\t\tdirectorFs.appendFileSync(logFile, line, "utf-8");
\t\t\t\t\t\t}
\t\t\t\t\t} catch (e) {}
\t\t\t\t},'''

if old_log_line in content:
    content = content.replace(old_log_line, new_log_block, 1)
    print('log方法修改成功')
else:
    print('log方法修改失败')

# 同样修改warn方法
old_warn_line = '\t\t\t\t\tconsole.warn("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");\n\t\t\t\t},'

new_warn_block = '''\t\t\t\t\tconsole.warn("[DSH:" + scope + "] " + message, data !== void 0 ? data : "");
\t\t\t\t\t// V10: 实时写入文件
\t\t\t\t\ttry {
\t\t\t\t\t\tif (typeof directorFs !== "undefined" && directorFs && directorPath) {
\t\t\t\t\t\t\tconst logDir = directorPath.join((typeof process !== "undefined" && process.env) ? (process.env.APPDATA || process.env.HOME || ".") : ".", "dsh-director");
\t\t\t\t\t\t\tif (!directorFs.existsSync(logDir)) directorFs.mkdirSync(logDir, { recursive: true });
\t\t\t\t\t\t\tconst logFile = directorPath.join(logDir, "debug.log");
\t\t\t\t\t\t\tconst line = "[" + entry.time + "] [WARN] [" + scope + "] " + message + (entry.data ? " " + JSON.stringify(entry.data) : "") + "\\n";
\t\t\t\t\t\t\tdirectorFs.appendFileSync(logFile, line, "utf-8");
\t\t\t\t\t\t}
\t\t\t\t\t} catch (e) {}
\t\t\t\t},'''

if old_warn_line in content:
    content = content.replace(old_warn_line, new_warn_block, 1)
    print('warn方法修改成功')
else:
    print('warn方法修改失败')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
