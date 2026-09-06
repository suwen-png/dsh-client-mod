filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 回滚v3的修改 - 移除添加的};和}
v3_fix = '''\t\t\t\tif (typeof window !== "undefined" && !window.__dshDebug) {
\t\t\t\t\twindow.__dshDebug = { logs: [], enabled: true, log: function(s, m, d) { this.logs.push({time:new Date().toISOString(),scope:s,message:m,data:d||null}); }, warn: function(s, m, d) { this.logs.push({time:new Date().toISOString(),scope:s,message:m,data:d||null,level:"WARN"}); } };
\t\t\t\t}
// V10: 全局CSS修复'''

original = '''\t\t\t\tif (typeof window !== "undefined" && !window.__dshDebug) {
\t\t\t\t\twindow.__dshDebug = { logs: [], enabled: true, log: function(s, m, d) { this.logs.push({time:new Date().toISOString(),scope:s,message:m,data:d||null}); }, warn: function(s, m, d) { this.logs.push({time:new Date().toISOString(),scope:s,message:m,data:d||null,level:"WARN"}); } }
// V10: 全局CSS修复'''

if v3_fix in content:
    content = content.replace(v3_fix, original, 1)
    print('回滚v3修改成功')
else:
    print('未找到v3修改，可能已经是原始状态')

# 现在移除原来位置的CSS注入代码
old_css_block = '''// V10: 全局CSS修复 - 确保所有对话容器正确滚动
if (typeof document !== "undefined" && document.head && !document.getElementById("dsh-v10-scroll-fix")) {
    var _dshStyle = document.createElement("style");
    _dshStyle.id = "dsh-v10-scroll-fix";
    _dshStyle.textContent = "/* 确保所有flex列容器的子元素能正确收缩并滚动 */[class*=\\"scrollBody\\"],[class*=\\"scroll_body\\"],[class*=\\"scrollbody\\"]{min-height:0 !important;overflow-y:auto !important;}/* RWZidW系列容器修复 */[class*=\\"RWZidW_root\\"]{min-height:0 !important;flex:1 1 0% !important;}[class*=\\"RWZidW_scroll\\"]{min-height:0 !important;overflow-y:auto !important;flex:1 1 auto !important;}[class*=\\"RWZidW_composerSeat\\"]{flex-shrink:0 !important;min-height:auto !important;}/* 确保对话列表容器有正确的高度 */[class*=\\"chat\\"]>div,[class*=\\"Chat\\"]>div{min-height:0;}/* 通用：flex column布局中，可滚动区域需要min-height:0 */[style*=\\"flex-direction:column\\"]>[style*=\\"overflow\\"]{min-height:0;}/* 确保body和html有正确高度 */html,body{height:100%;margin:0;padding:0;}";
    document.head.appendChild(_dshStyle);
}'''

if old_css_block in content:
    content = content.replace(old_css_block, '', 1)
    print('移除原位置CSS注入代码成功')
else:
    print('未找到原位置CSS注入代码')
    # 调试
    idx = content.find('_dshStyle')
    if idx >= 0:
        print('找到_dshStyle，位置:', idx)
        print('上下文:', repr(content[idx-100:idx+200]))

# 在文件最开头添加CSS注入代码
css_inject = '''// DSH MOD: 全局CSS修复 - 确保所有对话容器正确滚动
(function() {
    if (typeof document === "undefined") return;
    function injectCSS() {
        if (document.getElementById("dsh-v10-scroll-fix")) return;
        var style = document.createElement("style");
        style.id = "dsh-v10-scroll-fix";
        style.textContent = "[class*=\\"scrollBody\\"],[class*=\\"scroll_body\\"],[class*=\\"scrollbody\\"]{min-height:0 !important;overflow-y:auto !important;}[class*=\\"RWZidW_root\\"]{min-height:0 !important;flex:1 1 0% !important;}[class*=\\"RWZidW_scroll\\"]{min-height:0 !important;overflow-y:auto !important;flex:1 1 auto !important;}[class*=\\"RWZidW_composerSeat\\"]{flex-shrink:0 !important;min-height:auto !important;}html,body{height:100%;margin:0;padding:0;}";
        if (document.head) {
            document.head.appendChild(style);
        } else if (document.documentElement) {
            document.documentElement.appendChild(style);
        }
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", injectCSS);
    } else {
        injectCSS();
    }
    // 也在setTimeout中再次尝试，确保CSS一定注入
    setTimeout(injectCSS, 100);
    setTimeout(injectCSS, 500);
    setTimeout(injectCSS, 1000);
})();

'''

content = css_inject + content
print('在文件开头添加CSS注入代码成功')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
