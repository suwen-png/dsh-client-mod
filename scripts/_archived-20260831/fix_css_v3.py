filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 找到有问题的代码块
old_block = '''\t\t\t\tif (typeof window !== "undefined" && !window.__dshDebug) {
\t\t\t\t\twindow.__dshDebug = { logs: [], enabled: true, log: function(s, m, d) { this.logs.push({time:new Date().toISOString(),scope:s,message:m,data:d||null}); }, warn: function(s, m, d) { this.logs.push({time:new Date().toISOString(),scope:s,message:m,data:d||null,level:"WARN"}); } }
// V10: 全局CSS修复 - 确保所有对话容器正确滚动
if (typeof document !== "undefined" && document.head && !document.getElementById("dsh-v10-scroll-fix")) {'''

# 检查是否找到
if old_block in content:
    print('找到有问题的代码块')
    
    # 新的代码块 - if块正确闭合，CSS注入在外部
    new_block = '''\t\t\t\tif (typeof window !== "undefined" && !window.__dshDebug) {
\t\t\t\t\twindow.__dshDebug = { logs: [], enabled: true, log: function(s, m, d) { this.logs.push({time:new Date().toISOString(),scope:s,message:m,data:d||null}); }, warn: function(s, m, d) { this.logs.push({time:new Date().toISOString(),scope:s,message:m,data:d||null,level:"WARN"}); } };
\t\t\t\t}
// V10: 全局CSS修复 - 确保所有对话容器正确滚动
if (typeof document !== "undefined" && document.head && !document.getElementById("dsh-v10-scroll-fix")) {'''
    
    content = content.replace(old_block, new_block, 1)
    print('代码块修复成功')
else:
    print('未找到有问题的代码块')
    # 调试：查找部分内容
    idx = content.find('window.__dshDebug = { logs: [], enabled: true')
    if idx >= 0:
        print('找到__dshDebug初始化，位置:', idx)
        print('上下文:', repr(content[idx-100:idx+300]))

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
