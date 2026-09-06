path = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 修复1: 去掉编辑模式中的"阶段"字段（9902行附近）
# 原始: (0, react_jsx_runtime.jsxs)("label", { style: { flex: 1, fontSize: 10, color: "#666" }, children: ["阶段", ...] })
# 需要把这一行去掉，同时把外层的flex gap布局调整

# 先找到编辑模式的阶段字段
for i, line in enumerate(lines):
    if '"阶段"' in line and 'overviewDraft.phase' in line:
        print(f"找到编辑模式阶段字段: 行{i+1}")
        print(f"  内容: {line.strip()[:100]}")
        # 去掉这一行
        lines[i] = ''
        print(f"  已删除")
        break

# 修复2: 去掉显示模式中的阶段标签（9913行附近）
for i, line in enumerate(lines):
    if 'overview.phase' in line and 'e3f2fd' in line:
        print(f"找到显示模式阶段标签: 行{i+1}")
        print(f"  内容: {line.strip()[:100]}")
        lines[i] = ''
        print(f"  已删除")
        break

# 修复3: 编辑模式中风险和待办从数字输入改为文本框
# 找到风险数字输入
for i, line in enumerate(lines):
    if '风险' in line and 'overviewDraft.risks' in line and 'type="number"' in line:
        print(f"找到风险数字输入: 行{i+1}")
        # 替换为文本框
        old = line
        new_line = '\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("label", { style: { fontSize: 10, color: "#666", flex: 1 }, children: ["风险描述", (0, react_jsx_runtime.jsx)("textarea", { value: overviewDraft.riskText || "", onChange: function(e) { setOverviewDraft(Object.assign({}, overviewDraft, { riskText: e.target.value })); }, style: { width: "100%", height: 50, padding: "4px 6px", border: "1px solid #ccc", borderRadius: 3, fontSize: 10, marginTop: 2, resize: "vertical" } })] }),\n'
        lines[i] = new_line
        print(f"  已替换为文本框")
        break

# 找到待办数字输入
for i, line in enumerate(lines):
    if '待办' in line and 'overviewDraft.todos' in line and 'type="number"' in line:
        print(f"找到待办数字输入: 行{i+1}")
        old = line
        new_line = '\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("label", { style: { fontSize: 10, color: "#666", flex: 1 }, children: ["待办描述", (0, react_jsx_runtime.jsx)("textarea", { value: overviewDraft.todoText || "", onChange: function(e) { setOverviewDraft(Object.assign({}, overviewDraft, { todoText: e.target.value })); }, style: { width: "100%", height: 50, padding: "4px 6px", border: "1px solid #ccc", borderRadius: 3, fontSize: 10, marginTop: 2, resize: "vertical" } })] }),\n'
        lines[i] = new_line
        print(f"  已替换为文本框")
        break

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("\nB区阶段字段已完全去除，风险/待办改为文本框")
