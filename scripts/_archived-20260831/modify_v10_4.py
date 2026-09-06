filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 缩进前缀（9个tab）
T = '\t\t\t\t\t\t\t\t\t'

# ============================================================
# 下面框tab栏 - 插入在第8760行(] }),)之后，第8761行之前
# 行号从0开始，所以第8760行是index 8759
# ============================================================
bottom_tab = [
    T + '// V10: 横排tab栏\n',
    T + '(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", background: "#f5f5f5", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }, children: DIRECTOR_DOC_TYPES.map((type) => (0, react_jsx_runtime.jsx)("button", { key: type.key, onClick: (e) => { e.stopPropagation(); setActiveDocTab(type.key); }, style: { flex: 1, padding: "4px 8px", border: "none", background: activeDocTab === type.key ? type.color : "transparent", cursor: "pointer", fontSize: 11, fontWeight: activeDocTab === type.key ? 600 : 400, color: activeDocTab === type.key ? "#333" : "#888", borderBottom: activeDocTab === type.key ? "2px solid #1976d2" : "2px solid transparent" }, children: type.label })) }),\n',
]

# 确认第8760行(index 8759)是] }),
if '] }),' in lines[8759]:
    for i, line in enumerate(bottom_tab):
        lines.insert(8760 + i, line)
    print('下面框tab栏插入成功')
else:
    print('下面框插入位置错误:', repr(lines[8759]))

# ============================================================
# 上面框tab栏 - 插入在第8673行(] }),)之后，第8674行之前
# 注意：上面框插入后，下面框的行号会增加，所以先插上面框
# 重新计算：上面框在第8673行(index 8672)
# ============================================================
# 由于上面框在下面框之前，先插上面框会影响下面框的行号
# 所以需要先插上面框，再重新定位下面框
# 让我重新来：先插上面框

# 先撤销下面框的插入（如果成功了）
# 实际上，让我重新读取文件，先插上面框，再插下面框

# 重新读取
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 上面框tab栏
top_tab = [
    T + '// V10: 上面框横排tab栏\n',
    T + '(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", background: "#f5f5f5", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }, children: [\n',
    T + '\t(0, react_jsx_runtime.jsx)("button", { onClick: (e) => { e.stopPropagation(); setActiveProjectTab("chat-memory"); }, style: { flex: 1, padding: "4px 8px", border: "none", background: activeProjectTab === "chat-memory" ? "#e3f2fd" : "transparent", cursor: "pointer", fontSize: 11, fontWeight: activeProjectTab === "chat-memory" ? 600 : 400, color: activeProjectTab === "chat-memory" ? "#333" : "#888", borderBottom: activeProjectTab === "chat-memory" ? "2px solid #1976d2" : "2px solid transparent" }, children: "对话记忆" }),\n',
    T + '\t(0, react_jsx_runtime.jsx)("button", { onClick: (e) => { e.stopPropagation(); setActiveProjectTab("project-files"); }, style: { flex: 1, padding: "4px 8px", border: "none", background: activeProjectTab === "project-files" ? "#e3f2fd" : "transparent", cursor: "pointer", fontSize: 11, fontWeight: activeProjectTab === "project-files" ? 600 : 400, color: activeProjectTab === "project-files" ? "#333" : "#888", borderBottom: activeProjectTab === "project-files" ? "2px solid #1976d2" : "2px solid transparent" }, children: "项目文件" })\n',
    T + '] }),\n',
]

# 上面框在第8673行(index 8672)
if '] }),' in lines[8672]:
    for i, line in enumerate(top_tab):
        lines.insert(8673 + i, line)
    print('上面框tab栏插入成功')
else:
    print('上面框插入位置错误:', repr(lines[8672]))

# 上面框插入了5行，下面框的行号增加5
# 下面框原来在第8760行(index 8759)，现在在第8765行(index 8764)
bottom_idx = 8759 + 5
if '] }),' in lines[bottom_idx]:
    for i, line in enumerate(bottom_tab):
        lines.insert(bottom_idx + 1 + i, line)
    print('下面框tab栏插入成功')
else:
    print('下面框插入位置错误:', repr(lines[bottom_idx]))

# ============================================================
# 修改上面框的文件列表，根据tab显示不同内容
# 原来: children: projectFiles.map((file) =>
# 改成: children: activeProjectTab === "chat-memory" ? (...) : projectFiles.map((file) =>
# ============================================================
# 找到上面框的projectFiles.map位置
for i, line in enumerate(lines):
    if 'children: projectFiles.map((file) =>' in line and i > 8670 and i < 8700:
        # 替换这一行
        indent = line[:len(line) - len(line.lstrip())]
        new_line = indent + 'children: activeProjectTab === "chat-memory" ? (directorDocsStore.getDocsByType("core_memory").length === 0 ? (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, color: "#bbb", padding: "8px", textAlign: "center" }, children: "暂无对话记忆" }) : directorDocsStore.getDocsByType("core_memory").map((doc) => (0, react_jsx_runtime.jsxs)("div", { key: doc.docId, onClick: (e) => { e.stopPropagation(); openDirectorDoc(doc); }, style: { padding: "4px 8px", cursor: "pointer", borderRadius: 4, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }, onMouseEnter: (e) => e.currentTarget.style.background = "#e3f2fd", onMouseLeave: (e) => e.currentTarget.style.background = "transparent", children: [(0, react_jsx_runtime.jsx)("span", { children: "📝" }), (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 }, children: doc.docName })] }))) : projectFiles.map((file) =>\n'
        lines[i] = new_line
        print('上面框文件列表条件渲染修改成功, 行号:', i+1)
        break

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print('\n所有修改完成')
