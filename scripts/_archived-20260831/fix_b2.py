filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# ============================================================
# 修复1: ChatFlow外面包裹flex:1的div，确保高度正确
# 原代码: (useSession && useStore) ? (0, react_jsx_runtime.jsx)(ChatFlowErrorBoundary, { key: "chatflow", children: (0, react_jsx_runtime.jsx)(ChatFlow, {
# 改成: (useSession && useStore) ? (0, react_jsx_runtime.jsx)("div", { style: { flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }, children: (0, react_jsx_runtime.jsx)(ChatFlowErrorBoundary, { key: "chatflow", children: (0, react_jsx_runtime.jsx)(ChatFlow, {
# ============================================================
old1 = '(useSession && useStore) ? (0, react_jsx_runtime.jsx)(ChatFlowErrorBoundary, { key: "chatflow", children: (0, react_jsx_runtime.jsx)(ChatFlow, {'
new1 = '(useSession && useStore) ? (0, react_jsx_runtime.jsx)("div", { style: { flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }, children: (0, react_jsx_runtime.jsx)(ChatFlowErrorBoundary, { key: "chatflow", children: (0, react_jsx_runtime.jsx)(ChatFlow, {'

if old1 in content:
    content = content.replace(old1, new1, 1)
    print('修复1成功: ChatFlow包裹flex:1容器')
else:
    print('修复1失败: 未找到目标字符串')

# ============================================================
# 修复2: ChatFlow结束的括号匹配
# 原代码: onContainerClick: () => directorLayoutStore.setFocusTarget("chat")
# 									}) }) : (0, react_jsx_runtime.jsx)("div", { key: "chat-error", ...
# 需要在ChatFlow结束后增加一个闭合的div括号
# ============================================================
# 找到onContainerClick后面的部分
old2 = 'onContainerClick: () => directorLayoutStore.setFocusTarget("chat")\n\t\t\t\t\t\t\t\t\t\t}) }) : (0, react_jsx_runtime.jsx)("div", { key: "chat-error"'
new2 = 'onContainerClick: () => { directorLayoutStore.setFocusTarget("chat"); const input = document.querySelector("textarea, input[type=\'text\']"); if (input) input.focus(); }\n\t\t\t\t\t\t\t\t\t\t}) }) }) : (0, react_jsx_runtime.jsx)("div", { key: "chat-error"'

if old2 in content:
    content = content.replace(old2, new2, 1)
    print('修复2成功: ChatFlow闭合div + 点击聚焦输入框')
else:
    print('修复2失败: 未找到目标字符串')
    # 调试
    idx = content.find('onContainerClick: () => directorLayoutStore.setFocusTarget')
    if idx >= 0:
        print('找到onContainerClick位置:', idx)
        print('上下文:', repr(content[idx:idx+200]))

# ============================================================
# 修复3: chat-error也需要包裹
# ============================================================
old3 = ': (0, react_jsx_runtime.jsx)("div", { key: "chat-error", style: { flex: 1, padding: 16, color: "#d32f2f", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }, children: "对话小窗：useSession 不可用" })'
new3 = ': (0, react_jsx_runtime.jsx)("div", { style: { flex: 1, minHeight: 0, overflow: "hidden" }, children: (0, react_jsx_runtime.jsx)("div", { key: "chat-error", style: { flex: 1, padding: 16, color: "#d32f2f", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }, children: "对话小窗：useSession 不可用" }) })'

if old3 in content:
    content = content.replace(old3, new3, 1)
    print('修复3成功: chat-error包裹')
else:
    print('修复3失败: 未找到目标字符串')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('\n修改完成')
