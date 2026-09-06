filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 在文件存储检测之后，增加cookie辅助函数
# 找到 DIRECTOR_STORE_PREFIX 定义的位置
anchor = 'const DIRECTOR_STORE_PREFIX = "dsh.director.store.";'
if anchor not in content:
    print('未找到DIRECTOR_STORE_PREFIX')
else:
    # 在anchor之后插入cookie辅助函数
    cookie_helpers = '''
// V10: Cookie同步存储辅助函数（最可靠，因为cookie是同步持久化的）
function dshCookieSet(name, value, days) {
    try {
        const expires = new Date(Date.now() + (days || 3650) * 86400000).toUTCString();
        document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/";
        return true;
    } catch (e) { return false; }
}
function dshCookieGet(name) {
    try {
        const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
        return match ? decodeURIComponent(match[1]) : null;
    } catch (e) { return null; }
}
function dshCookieSave(key, data) {
    try {
        const json = JSON.stringify(data);
        // 分块存储，每块3KB（cookie单条限制约4KB）
        const chunkSize = 3000;
        const chunks = [];
        for (let i = 0; i < json.length; i += chunkSize) {
            chunks.push(json.substring(i, i + chunkSize));
        }
        // 先清除旧的块
        for (let i = 0; i < 100; i++) {
            const old = dshCookieGet(key + "_" + i);
            if (old === null) break;
            dshCookieSet(key + "_" + i, "", -1);
        }
        // 存储元数据
        dshCookieSet(key + "_meta", JSON.stringify({ chunks: chunks.length, len: json.length }), 3650);
        // 存储每个块
        for (let i = 0; i < chunks.length; i++) {
            dshCookieSet(key + "_" + i, chunks[i], 3650);
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
'''
    content = content.replace(anchor, anchor + cookie_helpers, 1)
    print('cookie辅助函数插入成功')

# 在loadDirectorStore中，在文件加载失败后、localStorage加载之前，增加cookie加载
# 找到 if (typeof localStorage === "undefined") 这一行
load_anchor = '\t\t\t\t\tif (typeof localStorage === "undefined") {'
if load_anchor in content:
    cookie_load = '''\t\t\t\t\t// V10: 优先从cookie加载（最可靠，同步持久化）
\t\t\t\t\tconst cookieData = dshCookieLoad("dsh_director_cookie");
\t\t\t\t\tif (cookieData && cookieData.messages) {
\t\t\t\t\t\tif (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "V10 load from cookie: msgs=" + cookieData.messages.length);
\t\t\t\t\t\tif (typeof window !== "undefined" && window.__directorPersistState) { window.__directorPersistState.loadCount++; window.__directorPersistState.lastLoadTime = Date.now(); window.__directorPersistState.savedMessages = cookieData.messages.length; }
\t\t\t\t\t\treturn { messages: cookieData.messages || [], config: { autoForward: true, localModel: { enabled: false, endpoint: "http://localhost:11434", model: "qwen2:7b" }, duties: { languagePolish: { enabled: true, name: "语言规范整理" }, contextMemory: { enabled: true, name: "上下文记忆" }, executionLogic: { enabled: true, name: "执行逻辑分析" }, modelRouting: { enabled: false, name: "模型路由" }, returnReview: { enabled: true, name: "对话返回审核" } }, ...(cookieData.config || {}) } };
\t\t\t\t\t}
'''
    content = content.replace(load_anchor, cookie_load + load_anchor, 1)
    print('cookie加载插入成功')
else:
    print('未找到load_anchor')

# 在saveDirectorStore中，在IndexedDB保存之后，增加cookie保存
# 找到 const idbOk = await idbSave 这一行之后
save_anchor = '\t\t\t\t\tconst idbOk = await idbSave(key, { messages: state.messages, config: state.config, savedAt: Date.now() });'
if save_anchor in content:
    cookie_save = '''
\t\t\t\t\t// V10: Cookie同步存储（最可靠）
\t\t\t\t\tconst cookieOk = dshCookieSave("dsh_director_cookie", { messages: state.messages, config: state.config, savedAt: Date.now() });
\t\t\t\t\tif (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "V10 save to cookie: " + (cookieOk ? "OK" : "FAIL") + " msgs=" + state.messages.length);
'''
    content = content.replace(save_anchor, save_anchor + cookie_save, 1)
    print('cookie保存插入成功')
else:
    print('未找到save_anchor')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
