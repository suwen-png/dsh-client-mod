filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 修复1: 在loadDirectorStore中兼容旧cookie key
old_load = '''\t\t\t\t// V10: 优先从cookie加载（最可靠，同步持久化）
\t\t\t\tconst cookieData = dshCookieLoad("dsh_director_" + safeDirectorKey(sessionId));
\t\t\t\tif (cookieData && cookieData.messages) {'''

new_load = '''\t\t\t\t// V10: 优先从cookie加载（最可靠，同步持久化）
\t\t\t\tlet cookieData = dshCookieLoad("dsh_director_" + safeDirectorKey(sessionId));
\t\t\t\t// 兼容旧key：如果新key没有数据，尝试旧的固定key
\t\t\t\tif ((!cookieData || !cookieData.messages) && typeof window !== "undefined") {
\t\t\t\t\tconst oldData = dshCookieLoad("dsh_director_cookie");
\t\t\t\t\tif (oldData && oldData.messages) {
\t\t\t\t\t\tcookieData = oldData;
\t\t\t\t\t\tif (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "V10 load from old cookie key (compatibility)");
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tif (cookieData && cookieData.messages) {'''

if old_load in content:
    content = content.replace(old_load, new_load, 1)
    print('修复1: cookie旧key兼容添加成功')
else:
    print('修复1: 未找到目标字符串')
    # 调试
    idx = content.find('V10: 优先从cookie加载')
    if idx >= 0:
        print('找到位置:', idx)
        print('上下文:', repr(content[idx:idx+200]))

# 修复2: 添加全局CSS修复b-2滚动
# 在文件开头添加一个style标签
css_fix = '''
// V10: 全局CSS修复 - 确保所有对话容器正确滚动
if (typeof document !== "undefined" && !document.getElementById("dsh-v10-scroll-fix")) {
    const style = document.createElement("style");
    style.id = "dsh-v10-scroll-fix";
    style.textContent = `
        /* 确保所有flex列容器的子元素能正确收缩 */
        [class*="scrollBody"], [class*="scroll_body"], [class*="scrollbody"] {
            min-height: 0 !important;
            overflow-y: auto !important;
        }
        /* 确保对话列表容器有正确的高度 */
        [class*="chat"] > div, [class*="Chat"] > div {
            min-height: 0;
        }
        /* 确保composer上方的消息区域能滚动 */
        [class*="composerSeat"] {
            flex-shrink: 0 !important;
        }
        /* 通用：flex column布局中，可滚动区域需要min-height:0 */
        .flex-column > .scrollable, [style*="flex-direction: column"] > [style*="overflow"] {
            min-height: 0;
        }
    `;
    document.head.appendChild(style);
}
'''

# 在__dshDebug初始化之后添加全局CSS
anchor = 'window.__dshDebug = {'
if anchor in content:
    idx = content.find(anchor)
    # 找到对象结束
    brace_count = 0
    end_idx = idx
    for i in range(idx, len(content)):
        if content[i] == '{':
            brace_count += 1
        elif content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                end_idx = i + 1
                break
    content = content[:end_idx] + css_fix + content[end_idx:]
    print('修复2: 全局CSS滚动修复添加成功')
else:
    print('修复2: 未找到__dshDebug初始化位置')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
