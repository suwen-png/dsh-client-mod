import re

filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# ============================================================
# 修改1: 下面框文档列表 - 只显示当前activeDocTab类型的文档
# ============================================================
# 原代码: children: DIRECTOR_DOC_TYPES.map((type) =>
# 改成: children: [DIRECTOR_DOC_TYPES.find(t => t.key === activeDocTab)].filter(Boolean).map((type) =>
old1 = 'children: DIRECTOR_DOC_TYPES.map((type) =>'
new1 = 'children: [DIRECTOR_DOC_TYPES.find(t => t.key === activeDocTab)].filter(Boolean).map((type) =>'
if old1 in content:
    content = content.replace(old1, new1, 1)
    print('修改1成功: 文档列表只显示当前tab')
else:
    print('修改1失败: 未找到目标字符串')

# ============================================================
# 修改2: 创建文档时使用默认模板 + 自动选中当前tab类型
# ============================================================
# 找到handleCreateDoc函数，修改它
old2_pattern = r'const handleCreateDoc = \(0, react\.useCallback\)\(\(\) => \{'
match = re.search(old2_pattern, content)
if match:
    # 在handleCreateDoc函数中，创建文档时增加template
    # 先找到createDoc调用
    start = match.start()
    # 找到函数结束位置（下一个}, [）
    end_match = re.search(r'\}, \[.*?\]\);', content[start:])
    if end_match:
        func_text = content[start:start+end_match.end()]
        # 替换createDoc调用，增加content模板
        if 'createDoc(newDocName, newDocType' in func_text:
            new_func = func_text.replace(
                'createDoc(newDocName, newDocType',
                'createDoc(newDocName, newDocType, (DIRECTOR_DOC_TYPES.find(t => t.key === newDocType) || {}).template || ""'
            )
            content = content[:start] + new_func + content[start+end_match.end():]
            print('修改2成功: 创建文档使用模板')
        else:
            print('修改2失败: 未找到createDoc调用')
    else:
        print('修改2失败: 未找到函数结束')
else:
    print('修改2失败: 未找到handleCreateDoc')

# ============================================================
# 修改3: 新建文档时默认类型为当前activeDocTab
# ============================================================
old3 = 'const [newDocType, setNewDocType] = (0, react.useState)("core_memory");'
new3 = 'const [newDocType, setNewDocType] = (0, react.useState)("core_memory");\n\t\t\t// V10: 切换tab时同步新建文档类型\n\t\t\t(0, react.useEffect)(() => { setNewDocType(activeDocTab); }, [activeDocTab]);'
if old3 in content:
    content = content.replace(old3, new3, 1)
    print('修改3成功: 新建文档类型同步tab')
else:
    print('修改3失败: 未找到newDocType定义')

# ============================================================
# 修改4: 自动保存 - textarea onChange时设置docDirty
# ============================================================
old4 = 'onChange: (e) => setDocEditor((prev) => ({ ...prev, content: e.target.value })),'
new4 = 'onChange: (e) => { setDocEditor((prev) => ({ ...prev, content: e.target.value })); setDocDirty(true); },'
if old4 in content:
    content = content.replace(old4, new4, 1)
    print('修改4成功: textarea onChange设置dirty')
else:
    print('修改4失败: 未找到textarea onChange')

# ============================================================
# 修改5: 保存成功后重置docDirty
# ============================================================
old5 = 'const saveDocEditor = (0, react.useCallback)(async () => {'
match5 = re.search(re.escape(old5), content)
if match5:
    start = match5.start()
    end_match = re.search(r'\}, \[docEditor, closeDocEditor\]\);', content[start:])
    if end_match:
        func_text = content[start:start+end_match.end()]
        # 在closeDocEditor()前增加setDocDirty(false)
        if 'closeDocEditor();' in func_text:
            new_func = func_text.replace('closeDocEditor();', 'setDocDirty(false); closeDocEditor();')
            content = content[:start] + new_func + content[start+end_match.end():]
            print('修改5成功: 保存后重置dirty')
        else:
            print('修改5失败: 未找到closeDocEditor调用')
    else:
        print('修改5失败: 未找到函数结束')
else:
    print('修改5失败: 未找到saveDocEditor')

# ============================================================
# 修改6: 取消时重置docDirty
# ============================================================
old6 = 'const closeDocEditor = (0, react.useCallback)(() => {'
match6 = re.search(re.escape(old6), content)
if match6:
    start = match6.start()
    end_match = re.search(r'\}, \[\]\);', content[start:])
    if end_match:
        func_text = content[start:start+end_match.end()]
        if 'setDocEditor({ active: false' in func_text:
            new_func = func_text.replace(
                'setDocEditor({ active: false',
                'setDocDirty(false); setDocEditor({ active: false'
            )
            content = content[:start] + new_func + content[start+end_match.end():]
            print('修改6成功: 取消时重置dirty')
        else:
            print('修改6失败: 未找到setDocEditor调用')
    else:
        print('修改6失败: 未找到函数结束')
else:
    print('修改6失败: 未找到closeDocEditor')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('\n所有修改完成')
