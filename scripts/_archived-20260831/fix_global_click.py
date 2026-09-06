filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 在__dshDebug提前初始化之后添加全局点击事件监听器
anchor = 'window.__dshDebug = {'
if anchor in content:
    # 找到__dshDebug对象定义的结束位置（第一个};）
    idx = content.find(anchor)
    # 找到对象结束的位置
    brace_count = 0
    end_idx = idx
    for i in range(idx, len(content)):
        if content[i] == '{':
            brace_count += 1
        elif content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                end_idx = i + 1
                break
    
    # 在对象结束后添加全局点击事件监听器
    global_click_handler = '''
    // V10: 全局点击事件监听器 - 点击对话区域自动聚焦输入框
    if (typeof document !== "undefined") {
        document.addEventListener("click", function(e) {
            try {
                // 如果点击的是输入框、按钮、链接，不处理
                const target = e.target;
                if (!target || target.closest) {
                    if (target.closest("textarea, input, button, a, [contenteditable='true'], [role='button']")) {
                        return;
                    }
                }
                // 检查是否点击在对话区域内
                const chatContainer = target.closest ? target.closest("[class*='scroll'], [class*='chat'], [class*='Chat'], [class*='conversation'], [data-chat-flow]") : null;
                if (chatContainer) {
                    // 延迟聚焦，确保DOM更新完成
                    setTimeout(function() {
                        const input = document.querySelector("textarea, input[type='text'], [contenteditable='true']");
                        if (input) {
                            input.focus();
                            if (typeof window !== "undefined" && window.__dshDebug) {
                                window.__dshDebug.log("focus", "Global click handler: focused input in chat area");
                            }
                        }
                    }, 50);
                }
            } catch (err) {
                // 静默失败
            }
        }, true);
    }
'''
    content = content[:end_idx] + global_click_handler + content[end_idx:]
    print('全局点击事件监听器添加成功')
else:
    print('未找到__dshDebug初始化位置')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')
