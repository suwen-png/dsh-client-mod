path = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
index_file = r'D:\hermes-data\dsh-client-mod\scripts\dsh_docs_index.txt'

with open(index_file, 'r', encoding='utf-8') as f:
    dsh_index = f.read()

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 找到插入位置：// __DSH_DOCS_INDEX_START__ 之后
marker_start = '// __DSH_DOCS_INDEX_START__'
marker_end = '// __DSH_DOCS_INDEX_END__'

idx_start = content.find(marker_start)
idx_end = content.find(marker_end)

if idx_start >= 0 and idx_end >= 0:
    # 替换两个marker之间的内容
    new_content = content[:idx_start + len(marker_start)] + '\n' + dsh_index + '\n' + content[idx_end:]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f'DSH_DOCS_INDEX已恢复，长度: {len(dsh_index)}')
    print(f'插入位置: {idx_start} - {idx_end}')
else:
    print(f'未找到marker: start={idx_start}, end={idx_end}')
