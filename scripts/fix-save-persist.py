import re

path = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 匹配saveDModal中setV10Data之后的部分
old_code = """\t\t\t\t\tsetV10Data(newData);
\t\t\t\t\t// 显示保存成功提示
\t\t\t\t\tif (typeof window !== "undefined" && window.__dshShowToast) {
\t\t\t\t\t\twindow.__dshShowToast((mode === "new" ? "已新建" : "已保存") + ": " + itemName);
\t\t\t\t\t}
\t\t\t\t\tcloseDModal();
\t\t\t\t}, [dModal, closeDModal, v10Data, setV10Data]);"""

new_code = """\t\t\t\t\tsetV10Data(newData);
\t\t\t\t\t// 持久化写入config文件（Electron fs可用时）
\t\t\t\t\ttry {
\t\t\t\t\t\tif (typeof window !== "undefined" && window.require) {
\t\t\t\t\t\t\tvar fs = window.require("fs");
\t\t\t\t\t\t\tif (fs && fs.writeFileSync) {
\t\t\t\t\t\t\t\tvar configPath = "D:/hermes-data/dsh-client-mod/config/" + listKey + ".json";
\t\t\t\t\t\t\t\tfs.writeFileSync(configPath, JSON.stringify(newList, null, 2), "utf-8");
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t} catch (e) {}
\t\t\t\t\t// 显示保存成功提示
\t\t\t\t\tif (typeof window !== "undefined" && window.__dshShowToast) {
\t\t\t\t\t\twindow.__dshShowToast((mode === "new" ? "已新建" : "已保存") + ": " + itemName + "（已持久化）");
\t\t\t\t\t}
\t\t\t\t\tcloseDModal();
\t\t\t\t}, [dModal, closeDModal, v10Data, setV10Data]);"""

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('saveDModal 已添加文件写入持久化')
else:
    print('未匹配到saveDModal代码段，尝试正则...')
    pattern = r'\t\t\t\t\tsetV10Data\(newData\);\n\t\t\t\t\t// 显示保存成功提示.*?\}, \[dModal, closeDModal, v10Data, setV10Data\]\);'
    match = re.search(pattern, content, re.DOTALL)
    if match:
        print(f'正则匹配成功，长度: {len(match.group())}')
        content = content[:match.start()] + new_code + content[match.end():]
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print('正则替换成功')
    else:
        print('正则也未匹配')
