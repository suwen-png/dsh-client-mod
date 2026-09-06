path = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 替换9781-9787行（索引9780-9786）
# 9781: setV10Data(newData);
# 9782: // 显示保存成功提示
# 9783: if (typeof window !== "undefined" && window.__dshShowToast) {
# 9784:     window.__dshShowToast((mode === "new" ? "已新建" : "已保存") + ": " + itemName);
# 9785: }
# 9786: closeDModal();
# 9787: }, [dModal, closeDModal, v10Data, setV10Data]);

new_lines = [
    '\t\t\t\t\tsetV10Data(newData);\n',
    '\t\t\t\t\t// 持久化写入config文件（Electron fs可用时）\n',
    '\t\t\t\t\ttry {\n',
    '\t\t\t\t\t\tif (typeof window !== "undefined" && window.require) {\n',
    '\t\t\t\t\t\t\tvar fs = window.require("fs");\n',
    '\t\t\t\t\t\t\tif (fs && fs.writeFileSync) {\n',
    '\t\t\t\t\t\t\t\tvar cfgPath = "D:/hermes-data/dsh-client-mod/config/" + listKey + ".json";\n',
    '\t\t\t\t\t\t\t\tfs.writeFileSync(cfgPath, JSON.stringify(newList, null, 2), "utf-8");\n',
    '\t\t\t\t\t\t\t}\n',
    '\t\t\t\t\t\t}\n',
    '\t\t\t\t\t} catch (e) {}\n',
    '\t\t\t\t\t// 显示保存成功提示\n',
    '\t\t\t\t\tif (typeof window !== "undefined" && window.__dshShowToast) {\n',
    '\t\t\t\t\t\twindow.__dshShowToast((mode === "new" ? "已新建" : "已保存") + ": " + itemName + "（已持久化）");\n',
    '\t\t\t\t\t}\n',
    '\t\t\t\t\tcloseDModal();\n',
    '\t\t\t\t}, [dModal, closeDModal, v10Data, setV10Data]);\n',
]

# 验证要替换的行
print("要替换的原始内容:")
for i in range(9780, 9787):
    print(f"  {i+1}: {lines[i].rstrip()}")

lines[9780:9787] = new_lines

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f"\n已替换，新行数: {len(new_lines)}")
print("替换后的内容:")
for i in range(9780, 9780 + len(new_lines)):
    print(f"  {i+1}: {lines[i].rstrip()}")
