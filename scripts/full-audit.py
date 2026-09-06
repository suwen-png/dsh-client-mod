import re
import os
import json

print("=" * 70)
print("项目全面审核报告 (按 execution-unified-standards V1.6)")
print("=" * 70)

client_js = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(client_js, 'r', encoding='utf-8') as f:
    content = f.read()
    lines = content.split('\n')

print(f"\n【代码基础信息】")
print(f"  总行数: {len(lines)}")
print(f"  总字符: {len(content)}")

# ========== 1. 函数连通性审核 ==========
print("\n【一、函数连通性审核】")
critical_funcs = [
    'loadV10Config', 'saveDModal', 'toggleSkill', 'handleCreateDoc',
    'switchToMainBranch', 'switchToBranch', 'openDModal', 'closeDModal',
    'forceDuty', 'handleAgentClick', 'invokeSkill', 'saveOverview',
    'addTask', 'toggleTaskStatus', 'deleteTask', 'switchProject',
    'exportHistory', 'importHistory'
]

func_results = []
for func in critical_funcs:
    def_pattern = f'const {func} = (0, react.useCallback)'
    def_count = content.count(def_pattern)
    call_count = sum(1 for line in lines if func + '(' in line and def_pattern not in line)
    onclick_count = sum(1 for line in lines if 'onClick' in line and func in line)
    total = call_count + onclick_count
    status = '✅' if total > 0 else '⚠️'
    func_results.append((func, def_count, total, status))
    print(f"  {status} {func:25s} 定义{def_count} 调用{total}")

# ========== 2. State完整性审核 ==========
print("\n【二、State完整性审核】")
v10_states = ['navCollapsed', 'dPanelCollapsed', 'dNavState', 'dSearch', 'dFilter',
              'dModal', 'cockpitOpen', 'settingsTab', 'phaseEditOpen',
              'pendingSkill', 'pendingForceRule', 'v10Data']
for state in v10_states:
    setter = 'set' + state[0].upper() + state[1:]
    state_count = content.count(state)
    setter_count = content.count(setter)
    status = '✅' if setter_count > 0 else '❌'
    print(f"  {status} {state:20s} 使用{state_count} setter{setter_count}")

# ========== 3. 前端样式审核 ==========
print("\n【三、前端样式审核】")

# 3.1 D区小方框布局
d_grid = 'gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))"'
print(f"  {'✅' if d_grid in content else '❌'} D区grid小方框布局")

d_flex_col = 'flexDirection: "column", alignItems: "center"'
print(f"  {'✅' if d_flex_col in content else '❌'} D区小方框竖向排列")

d_icon_size = 'fontSize: 22, lineHeight: 1'
print(f"  {'✅' if d_icon_size in content else '❌'} D区图标22px放大")

d_edit_btn = 'marginTop: "auto"'
print(f"  {'✅' if d_edit_btn in content else '❌'} D区编辑按钮底部对齐")

# 3.2 B区总览
b_core_memory = '核心记忆' in content
print(f"  {'✅' if b_core_memory else '❌'} B区核心记忆(原定位)")

b_no_phase = '阶段' not in content[content.find('项目总览'):content.find('项目总览')+2000] if '项目总览' in content else True
print(f"  {'✅' if b_no_phase else '⚠️'} B区已去掉阶段")

b_risk_box = '#fff8f0' in content
print(f"  {'✅' if b_risk_box else '❌'} B区风险文本框(浅黄色)")

b_todo_box = '#f0f7ff' in content
print(f"  {'✅' if b_todo_box else '❌'} B区待办文本框(浅蓝色)")

# 3.3 A区导航
a_folder_click = 'setProjectPickerOpen(!projectPickerOpen)' in content
print(f"  {'✅' if a_folder_click else '❌'} A区文件夹可点击选择")

a_cockpit_actions = '驾驶舱快捷面板' in content
print(f"  {'✅' if a_cockpit_actions else '❌'} A区驾驶舱快捷面板")

# 3.4 弹窗
modal_icon = '图标 (Emoji)' in content
print(f"  {'✅' if modal_icon else '❌'} 弹窗图标选择字段")

modal_category = '分类' in content and 'development' in content
print(f"  {'✅' if modal_category else '❌'} 弹窗分类选择字段")

modal_refdocs = '引用文档' in content
print(f"  {'✅' if modal_refdocs else '❌'} 弹窗引用文档字段")

# 3.5 hover延迟
hover_delay = 'setTimeout(function() { setBottomHovered(true); }, 300)' in content
print(f"  {'✅' if hover_delay else '❌'} 文档面板hover 300ms延迟")

# ========== 4. 数据加载审核 ==========
print("\n【四、数据加载审核】")
fetch_agents = 'fetch(base + "agents.json"' in content
fetch_skills = 'fetch(base + "skills.json"' in content
fetch_duties = 'fetch(base + "duties.json"' in content
print(f"  {'✅' if fetch_agents else '❌'} agents.json fetch加载")
print(f"  {'✅' if fetch_skills else '❌'} skills.json fetch加载")
print(f"  {'✅' if fetch_duties else '❌'} duties.json fetch加载")

use_effect_load = 'useEffect)(function() { loadV10Config(); }' in content
print(f"  {'✅' if use_effect_load else '❌'} 组件挂载时自动加载配置")

# 回退值
fallback_agents = 'AGENT_PROMPTS.code' in content
fallback_skills = 'code-gen' in content and 'doc-summary' in content
print(f"  {'✅' if fallback_agents else '❌'} 智能体内置回退值")
print(f"  {'✅' if fallback_skills else '❌'} 技能内置回退值")

# ========== 5. 保存持久化审核 ==========
print("\n【五、保存持久化审核】")
save_updates_v10data = 'setV10Data(newData)' in content
save_new_item = 'newList = [item].concat(currentList)' in content
save_edit_item = 'newList = currentList.map' in content
print(f"  {'✅' if save_updates_v10data else '❌'} saveDModal更新v10Data")
print(f"  {'✅' if save_new_item else '❌'} 新建项追加到列表")
print(f"  {'✅' if save_edit_item else '❌'} 编辑项替换列表元素")

# 检查是否写入文件（持久化）
file_write = 'fs.writeFile' in content or 'writeFileSync' in content or 'localStorage.setItem' in content
print(f"  {'✅' if file_write else '⚠️'} 数据持久化写入文件/localStorage")

# ========== 6. 错误处理审核 ==========
print("\n【六、错误处理审核】")
try_catch_count = content.count('try {')
catch_count = content.count('catch (e)')
print(f"  try/catch: {try_catch_count}/{catch_count}")

fetch_error_handling = 'catch (e) {}' in content
print(f"  {'✅' if fetch_error_handling else '❌'} fetch错误处理(静默回退)")

# ========== 7. 配置数据审核 ==========
print("\n【七、配置数据审核】")
config_dir = r'D:\hermes-data\dsh-client-mod\config'
config_files = ['agents.json', 'skills.json', 'duties.json', 'tasks.json',
                'assets.json', 'branches.json', 'project_overview.md', 'risks.md']
for cf in config_files:
    path = os.path.join(config_dir, cf)
    if os.path.exists(path):
        size = os.path.getsize(path)
        if cf.endswith('.json'):
            try:
                with open(path, 'r', encoding='utf-8') as jf:
                    data = json.load(jf)
                count = len(data) if isinstance(data, list) else len(data.keys())
                print(f"  ✅ {cf:25s} {size:6d}B {count}条记录")
            except Exception as e:
                print(f"  ❌ {cf:25s} JSON解析失败: {e}")
        else:
            print(f"  ✅ {cf:25s} {size:6d}B")
    else:
        print(f"  ❌ {cf:25s} 文件不存在")

# ========== 8. 文档审核 ==========
print("\n【八、文档审核】")
docs_root = r'D:\hermes-data\dsh-client-mod\docs'
doc_count = 0
for dirpath, dirnames, filenames in os.walk(docs_root):
    for f in filenames:
        if f.endswith('.md') or f.endswith('.html'):
            doc_count += 1
print(f"  文档总数: {doc_count}")

# 关键文档
key_docs = {
    '智能体数据格式规范': '10-架构设计/智能体数据格式规范V1.0.md',
    'V10完整代码索引': '50-信息中心/V10-完整代码索引.md',
    '项目大索引': '00-统筹入口/05-项目大索引.md',
}
for name, rel_path in key_docs.items():
    path = os.path.join(docs_root, rel_path)
    exists = os.path.exists(path)
    size = os.path.getsize(path) if exists else 0
    print(f"  {'✅' if exists else '❌'} {name}: {size}B")

# ========== 9. 问题汇总 ==========
print("\n" + "=" * 70)
print("【问题汇总清单】")
print("=" * 70)

issues = []

# 检查未接通函数
for func, def_count, total, status in func_results:
    if total == 0 and def_count > 0:
        issues.append(('中', f'函数{func}定义但未调用', '需要接通UI或标记为预留'))

# 检查数据持久化
if not file_write:
    issues.append(('高', 'saveDModal只更新内存v10Data，未写入config文件，重启后丢失', '需要实现文件写入或localStorage持久化'))

# 检查D区数据是否真的能显示（fetch file://可能被CORS阻止）
issues.append(('高', 'loadV10Config使用fetch file://协议，Electron环境可能被CORS阻止，导致数据加载失败回退到内置值', '需要改用Electron fs API或IPC加载本地文件'))

# 检查switchToBranch
issues.append(('低', 'switchToBranch未接通，需要分支列表UI', '后续迭代实现'))

# 检查组件拆分
issues.append(('低', 'DirectorView组件1400+行，过于臃肿', '建议源码层面拆分子组件'))

# 检查颜色主题
issues.append(('低', '硬编码颜色200+处，未主题化', '建议提取CSS变量'))

for i, (severity, desc, suggestion) in enumerate(issues, 1):
    print(f"  P-{i:02d} [{severity}] {desc}")
    print(f"        建议: {suggestion}")

print(f"\n总计: {len(issues)}个问题 (高{sum(1 for s,_,_ in issues if s=='高')} 中{sum(1 for s,_,_ in issues if s=='中')} 低{sum(1 for s,_,_ in issues if s=='低')})")
print("=" * 70)
