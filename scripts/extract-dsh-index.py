import json

snap_path = r'D:\hermes-data\dsh-client-mod\snapshots\snapshot-20260903-122224-before-apply\dsh-client-ui-conversation\lib\client.js'
with open(snap_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 找到DSH_DOCS_INDEX开始
start_marker = 'const DSH_DOCS_INDEX = '
idx = content.find(start_marker)
if idx < 0:
    print('未找到DSH_DOCS_INDEX')
    exit()

start = idx + len(start_marker)
# 从start开始，找到匹配的JSON对象结束
# JSON以{开始，找到匹配的}
brace_count = 0
i = start
while i < len(content):
    if content[i] == '{':
        brace_count += 1
    elif content[i] == '}':
        brace_count -= 1
        if brace_count == 0:
            break
    i += 1

json_str = content[start:i+1]
print(f'JSON长度: {len(json_str)}')
print(f'前50字符: {json_str[:50]}')
print(f'后50字符: {json_str[-50:]}')

# 验证JSON是否有效
try:
    data = json.loads(json_str)
    print(f'JSON有效, docCount: {data.get("docCount")}')
except Exception as e:
    print(f'JSON无效: {e}')

# 保存完整的DSH_DOCS_INDEX声明
full_decl = 'const DSH_DOCS_INDEX = ' + json_str + ';'
with open(r'D:\hermes-data\dsh-client-mod\scripts\dsh_docs_index.txt', 'w', encoding='utf-8') as f:
    f.write(full_decl)
print(f'已保存完整声明, 长度: {len(full_decl)}')
