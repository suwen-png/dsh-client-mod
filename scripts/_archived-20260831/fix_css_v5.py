filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 修复CSS - 把RWZidW_scroll的flex改回1 1 0%
old_css = '[class*=\\"RWZidW_scroll\\"]{min-height:0 !important;overflow-y:auto !important;flex:1 1 auto !important;}'
new_css = '[class*=\\"RWZidW_scroll\\"]{min-height:0 !important;overflow-y:auto !important;flex:1 1 0% !important;}'

if old_css in content:
    content = content.replace(old_css, new_css, 1)
    print('RWZidW_scroll flex修复成功: 1 1 auto -> 1 1 0%')
else:
    print('未找到旧CSS，检查当前CSS')
    idx = content.find('RWZidW_scroll')
    if idx >= 0:
        print('找到RWZidW_scroll，位置:', idx)
        print('上下文:', repr(content[idx-50:idx+200]))

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
