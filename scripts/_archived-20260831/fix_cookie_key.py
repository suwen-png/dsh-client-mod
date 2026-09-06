filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 修改load中的cookie key
old_load = 'const cookieData = dshCookieLoad("dsh_director_cookie");'
new_load = 'const cookieData = dshCookieLoad("dsh_director_" + safeDirectorKey(sessionId));'
if old_load in content:
    content = content.replace(old_load, new_load, 1)
    print('load cookie key修改成功')
else:
    print('load cookie key修改失败')

# 修改save中的cookie key
old_save = 'const cookieOk = dshCookieSave("dsh_director_cookie", { messages: state.messages, config: state.config, savedAt: Date.now() });'
new_save = 'const cookieOk = dshCookieSave("dsh_director_" + safeDirectorKey(sessionId), { messages: state.messages, config: state.config, savedAt: Date.now() });'
if old_save in content:
    content = content.replace(old_save, new_save, 1)
    print('save cookie key修改成功')
else:
    print('save cookie key修改失败')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
