import re

filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 缩进是10个tab
T = '\t\t\t\t\t\t\t\t\t\t'

# ============================================================
# 修改1: 下面框增加tab栏
# ============================================================
old1 = T + '''] }),
''' + T + '''(0, react_jsx_runtime.jsx)("div", {
''' + T + '''\tstyle: { flex: 1, overflowY: "auto", padding: "4px 8px" },
''' + T + '''\tchildren: [DIRECTOR_DOC_TYPES.find(t => t.key === activeDocTab)].filter(Boolean).map((type) =>'''

tab_bar = T + '''] }),
''' + T + '''// V10: 横排tab栏
''' + T + '''(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", background: "#f5f5f5", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }, children: DIRECTOR_DOC_TYPES.map((type) => (0, react_jsx_runtime.jsx)("button", { key: type.key, onClick: (e) => { e.stopPropagation(); setActiveDocTab(type.key); }, style: { flex: 1, padding: "4px 8px", border: "none", background: activeDocTab === type.key ? type.color : "transparent", cursor: "pointer", fontSize: 11, fontWeight: activeDocTab === type.key ? 600 : 400, color: activeDocTab === type.key ? "#333" : "#888", borderBottom: activeDocTab === type.key ? "2px solid #1976d2" : "2px solid transparent" }, children: type.label })) }),
''' + T + '''(0, react_jsx_runtime.jsx)("div", {
''' + T + '''\tstyle: { flex: 1, overflowY: "auto", padding: "4px 8px" },
''' + T + '''\tchildren: [DIRECTOR_DOC_TYPES.find(t => t.key === activeDocTab)].filter(Boolean).map((type) =>'''

if old1 in content:
    content = content.replace(old1, tab_bar, 1)
    print('修改1成功: 下面框增加tab栏')
else:
    print('修改1失败')

# ============================================================
# 修改2: 上面框增加分tab
# ============================================================
old2 = T + '''] }),
''' + T + '''(0, react_jsx_runtime.jsx)("div", {
''' + T + '''\tstyle: { flex: 1, overflowY: "auto", padding: "4px 8px" },
''' + T + '''\tchildren: projectFiles.map((file) =>'''

project_tab_bar = T + '''] }),
''' + T + '''// V10: 上面框横排tab栏
''' + T + '''(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", background: "#f5f5f5", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }, children: [
''' + T + '''\t(0, react_jsx_runtime.jsx)("button", { onClick: (e) => { e.stopPropagation(); setActiveProjectTab("chat-memory"); }, style: { flex: 1, padding: "4px 8px", border: "none", background: activeProjectTab === "chat-memory" ? "#e3f2fd" : "transparent", cursor: "pointer", fontSize: 11, fontWeight: activeProjectTab === "chat-memory" ? 600 : 400, color: activeProjectTab === "chat-memory" ? "#333" : "#888", borderBottom: activeProjectTab === "chat-memory" ? "2px solid #1976d2" : "2px solid transparent" }, children: "对话记忆" }),
''' + T + '''\t(0, react_jsx_runtime.jsx)("button", { onClick: (e) => { e.stopPropagation(); setActiveProjectTab("project-files"); }, style: { flex: 1, padding: "4px 8px", border: "none", background: activeProjectTab === "project-files" ? "#e3f2fd" : "transparent", cursor: "pointer", fontSize: 11, fontWeight: activeProjectTab === "project-files" ? 600 : 400, color: activeProjectTab === "project-files" ? "#333" : "#888", borderBottom: activeProjectTab === "project-files" ? "2px solid #1976d2" : "2px solid transparent" }, children: "项目文件" })
''' + T + '''] }),
''' + T + '''(0, react_jsx_runtime.jsx)("div", {
''' + T + '''\tstyle: { flex: 1, overflowY: "auto", padding: "4px 8px" },
''' + T + '''\tchildren: activeProjectTab === "chat-memory" ? (
''' + T + '''\t\tdirectorDocsStore.getDocsByType("core_memory").length === 0
''' + T + '''\t\t\t? (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, color: "#bbb", padding: "8px", textAlign: "center" }, children: "暂无对话记忆，在总监文档中创建核心记忆文档" })
''' + T + '''\t\t\t: directorDocsStore.getDocsByType("core_memory").map((doc) => (0, react_jsx_runtime.jsxs)("div", { key: doc.docId, onClick: (e) => { e.stopPropagation(); openDirectorDoc(doc); }, style: { padding: "4px 8px", cursor: "pointer", borderRadius: 4, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }, onMouseEnter: (e) => e.currentTarget.style.background = "#e3f2fd", onMouseLeave: (e) => e.currentTarget.style.background = "transparent", children: [(0, react_jsx_runtime.jsx)("span", { children: "📝" }), (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 }, children: doc.docName })] }))
''' + T + '''\t) : projectFiles.map((file) =>'''

if old2 in content:
    content = content.replace(old2, project_tab_bar, 1)
    print('修改2成功: 上面框增加分tab')
else:
    print('修改2失败')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('\n修改完成')
