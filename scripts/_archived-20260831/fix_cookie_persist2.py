filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 在loadDirectorStore中，在localStorage检查之前，增加cookie加载
load_anchor = '\t\t\t\tif (typeof localStorage === "undefined") {'
if load_anchor in content:
    cookie_load = '''\t\t\t\t// V10: 优先从cookie加载（最可靠，同步持久化）
\t\t\t\tconst cookieData = dshCookieLoad("dsh_director_cookie");
\t\t\t\tif (cookieData && cookieData.messages) {
\t\t\t\t\tif (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "V10 load from cookie: msgs=" + cookieData.messages.length);
\t\t\t\t\tif (typeof window !== "undefined" && window.__directorPersistState) { window.__directorPersistState.loadCount++; window.__directorPersistState.lastLoadTime = Date.now(); window.__directorPersistState.savedMessages = cookieData.messages.length; }
\t\t\t\t\treturn { messages: cookieData.messages || [], config: { autoForward: true, localModel: { enabled: false, endpoint: "http://localhost:11434", model: "qwen2:7b" }, duties: { languagePolish: { enabled: true, name: "语言规范整理" }, contextMemory: { enabled: true, name: "上下文记忆" }, executionLogic: { enabled: true, name: "执行逻辑分析" }, modelRouting: { enabled: false, name: "模型路由" }, returnReview: { enabled: true, name: "对话返回审核" } }, ...(cookieData.config || {}) } };
\t\t\t\t}
'''
    content = content.replace(load_anchor, cookie_load + load_anchor, 1)
    print('cookie加载插入成功')
else:
    print('未找到load_anchor')

# 在saveDirectorStore中，在IndexedDB保存之后，增加cookie保存
save_anchor = '\t\t\t\tconst idbOk = await idbSave(key, { messages: state.messages, config: state.config, savedAt: Date.now() });'
if save_anchor in content:
    cookie_save = '''
\t\t\t\t// V10: Cookie同步存储（最可靠）
\t\t\t\tconst cookieOk = dshCookieSave("dsh_director_cookie", { messages: state.messages, config: state.config, savedAt: Date.now() });
\t\t\t\tif (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "V10 save to cookie: " + (cookieOk ? "OK" : "FAIL") + " msgs=" + state.messages.length);
'''
    content = content.replace(save_anchor, save_anchor + cookie_save, 1)
    print('cookie保存插入成功')
else:
    print('未找到save_anchor')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
