import re

filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 用正则表达式匹配整个函数
pattern = r'function safeDirectorKey\(sessionId\)\s*\{[^}]*\}'

new_func = '''function safeDirectorKey(sessionId) {
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

new_content = re.sub(pattern, new_func, content, count=1)
if new_content != content:
    print('safeDirectorKey修改成功')
    content = new_content
else:
    print('safeDirectorKey修改失败')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
