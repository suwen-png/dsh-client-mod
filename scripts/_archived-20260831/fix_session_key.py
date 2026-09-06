filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

old_func = '''\t\t\tfunction safeDirectorKey(sessionId) {
\t\t\t\t// V9修复: 总监是全局大总监，使用固定key持久化
\t\t\t\t// 原实现使用sessionId(UUID)，每次启动都不同，导致持久化完全失效
\t\t\t\treturn "director-main";
\t\t\t}'''

new_func = '''\t\t\tfunction safeDirectorKey(sessionId) {
\t\t\t\t// V10: 按不同对话拆分，使用sessionId的短哈希作为key
\t\t\t\tif (!sessionId) return "director-main";
\t\t\t\tconst sid = String(sessionId);
\t\t\t\tif (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
\t\t\t\t\treturn "director-" + sid.substring(0, 8);
\t\t\t\t}
\t\t\t\tlet hash = 0;
\t\t\t\tfor (let i = 0; i < sid.length; i++) {
\t\t\t\t\thash = ((hash << 5) - hash) + sid.charCodeAt(i);
\t\t\t\t\thash |= 0;
\t\t\t\t}
\t\t\t\treturn "director-" + Math.abs(hash).toString(36).substring(0, 8);
\t\t\t}'''

if old_func in content:
    content = content.replace(old_func, new_func, 1)
    print('safeDirectorKey修改成功')
else:
    print('safeDirectorKey修改失败: 未找到目标字符串')
    # 调试
    idx = content.find('function safeDirectorKey')
    if idx >= 0:
        print('找到函数，位置:', idx)
        print('上下文:', repr(content[idx:idx+300]))

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
