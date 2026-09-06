import re

filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 把文件存储检测中的console.log改回__dshDebug.log
# 格式: console.log("[DSH:persist] V10 file storage detection start");
# 改成: if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "V10 file storage detection start");

def replace_console_log(match):
    full = match.group(0)
    # 提取消息内容
    msg_match = re.search(r'console\.log\("\[DSH:persist\]\s*(.*?)"\)', full)
    if msg_match:
        msg = msg_match.group(1)
        # 处理消息中的引号
        msg = msg.replace('\\"', '"')
        return f'if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "{msg}");'
    return full

# 替换所有console.log("[DSH:persist] ...")
content = re.sub(r'console\.log\("\[DSH:persist\][^"]*"\);?', replace_console_log, content)

# 同样处理console.log("[DSH:persist] ..." + variable)
# 这种比较复杂，先处理简单的

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('console.log替换完成')
