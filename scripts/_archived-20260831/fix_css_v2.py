filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 找到旧的CSS IIFE代码并替换为直接注入
old_css_start = '// V10: 全局CSS修复 - 确保所有对话容器正确滚动\n(function() {'
old_css_end = '})();'

# 找到完整的IIFE
idx_start = content.find(old_css_start)
if idx_start >= 0:
    # 找到IIFE结束的位置
    idx_end = content.find(old_css_end, idx_start)
    if idx_end >= 0:
        idx_end += len(old_css_end)
        old_css_code = content[idx_start:idx_end]
        print('找到旧CSS IIFE，长度:', len(old_css_code))
        
        # 新的CSS代码 - 直接注入，不使用IIFE
        new_css_code = '''// V10: 全局CSS修复 - 确保所有对话容器正确滚动
if (typeof document !== "undefined" && document.head && !document.getElementById("dsh-v10-scroll-fix")) {
    var _dshStyle = document.createElement("style");
    _dshStyle.id = "dsh-v10-scroll-fix";
    _dshStyle.textContent = "/* 确保所有flex列容器的子元素能正确收缩并滚动 */[class*=\\"scrollBody\\"],[class*=\\"scroll_body\\"],[class*=\\"scrollbody\\"]{min-height:0 !important;overflow-y:auto !important;}/* RWZidW系列容器修复 */[class*=\\"RWZidW_root\\"]{min-height:0 !important;flex:1 1 0% !important;}[class*=\\"RWZidW_scroll\\"]{min-height:0 !important;overflow-y:auto !important;flex:1 1 auto !important;}[class*=\\"RWZidW_composerSeat\\"]{flex-shrink:0 !important;min-height:auto !important;}/* 确保对话列表容器有正确的高度 */[class*=\\"chat\\"]>div,[class*=\\"Chat\\"]>div{min-height:0;}/* 通用：flex column布局中，可滚动区域需要min-height:0 */[style*=\\"flex-direction:column\\"]>[style*=\\"overflow\\"]{min-height:0;}/* 确保body和html有正确高度 */html,body{height:100%;margin:0;padding:0;}";
    document.head.appendChild(_dshStyle);
}'''
        
        content = content[:idx_start] + new_css_code + content[idx_end:]
        print('CSS代码替换成功')
    else:
        print('未找到IIFE结束位置')
else:
    print('未找到旧CSS IIFE')
    # 调试
    idx = content.find('dsh-v10-scroll-fix')
    if idx >= 0:
        print('找到dsh-v10-scroll-fix，位置:', idx)
        print('上下文:', repr(content[idx-100:idx+200]))

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
