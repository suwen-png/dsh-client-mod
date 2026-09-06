filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 修改onContainerClick + 闭合外层div
old = 'onContainerClick: () => directorLayoutStore.setFocusTarget("chat")\n\t\t\t\t\t\t\t\t\t}) }) : (0, react_jsx_runtime.jsx)("div", { style: { flex: 1, minHeight: 0, overflow: "hidden" }, children: (0, react_jsx_runtime.jsx)("div", { key: "chat-error"'
new = 'onContainerClick: () => { directorLayoutStore.setFocusTarget("chat"); setTimeout(() => { const input = document.querySelector("textarea, input[type=\'text\']"); if (input) input.focus(); }, 50); }\n\t\t\t\t\t\t\t\t\t}) }) }) : (0, react_jsx_runtime.jsx)("div", { style: { flex: 1, minHeight: 0, overflow: "hidden" }, children: (0, react_jsx_runtime.jsx)("div", { key: "chat-error"'

if old in content:
    content = content.replace(old, new, 1)
    print('修改成功: onContainerClick聚焦 + 闭合div')
else:
    print('修改失败')
    # 调试
    idx = content.find('onContainerClick: () => directorLayoutStore.setFocusTarget("chat")')
    if idx >= 0:
        print('找到位置:', idx)
        print('上下文:', repr(content[idx:idx+300]))

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
