filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 找到旧的CSS添加代码并替换
old_css = '''// V10: 全局CSS修复 - 确保所有对话容器正确滚动
if (typeof document !== "undefined" && !document.getElementById("dsh-v10-scroll-fix")) {
    const style = document.createElement("style");
    style.id = "dsh-v10-scroll-fix";
    style.textContent = `
        /* 确保所有flex列容器的子元素能正确收缩 */
        [class*="scrollBody"], [class*="scroll_body"], [class*="scrollbody"] {
            min-height: 0 !important;
            overflow-y: auto !important;
        }
        /* 确保对话列表容器有正确的高度 */
        [class*="chat"] > div, [class*="Chat"] > div {
            min-height: 0;
        }
        /* 确保composer上方的消息区域能滚动 */
        [class*="composerSeat"] {
            flex-shrink: 0 !important;
        }
        /* 通用：flex column布局中，可滚动区域需要min-height:0 */
        .flex-column > .scrollable, [style*="flex-direction: column"] > [style*="overflow"] {
            min-height: 0;
        }
    `;
    document.head.appendChild(style);
}'''

new_css = '''// V10: 全局CSS修复 - 确保所有对话容器正确滚动
(function() {
    function addScrollFixCSS() {
        if (typeof document === "undefined") return;
        if (document.getElementById("dsh-v10-scroll-fix")) return;
        const style = document.createElement("style");
        style.id = "dsh-v10-scroll-fix";
        style.textContent = `
            /* 确保所有flex列容器的子元素能正确收缩并滚动 */
            [class*="scrollBody"], [class*="scroll_body"], [class*="scrollbody"] {
                min-height: 0 !important;
                overflow-y: auto !important;
            }
            /* RWZidW系列容器修复 */
            [class*="RWZidW"] {
                min-height: 0 !important;
            }
            [class*="RWZidW_scroll"] {
                min-height: 0 !important;
                overflow-y: auto !important;
                flex: 1 1 auto !important;
            }
            /* 确保对话列表容器有正确的高度 */
            [class*="chat"] > div, [class*="Chat"] > div {
                min-height: 0;
            }
            /* 确保composer上方的消息区域能滚动 */
            [class*="composerSeat"] {
                flex-shrink: 0 !important;
            }
            /* 通用：flex column布局中，可滚动区域需要min-height:0 */
            [style*="flex-direction: column"] > [style*="overflow"] {
                min-height: 0;
            }
            /* 确保body和html有正确高度 */
            html, body {
                height: 100%;
                margin: 0;
                padding: 0;
            }
        `;
        if (document.head) {
            document.head.appendChild(style);
        } else if (document.documentElement) {
            document.documentElement.appendChild(style);
        }
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", addScrollFixCSS);
    } else {
        addScrollFixCSS();
    }
})();'''

if old_css in content:
    content = content.replace(old_css, new_css, 1)
    print('CSS添加代码替换成功')
else:
    print('CSS添加代码替换失败: 未找到目标字符串')
    # 调试：查找旧代码
    idx = content.find('dsh-v10-scroll-fix')
    if idx >= 0:
        print('找到dsh-v10-scroll-fix，位置:', idx)
        print('上下文:', repr(content[idx-100:idx+200]))

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
