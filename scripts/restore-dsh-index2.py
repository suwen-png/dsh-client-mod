snap_path = r'D:\hermes-data\dsh-client-mod\snapshots\snapshot-20260903-122224-before-apply\dsh-client-ui-conversation\lib\client.js'
work_path = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'

with open(snap_path, 'r', encoding='utf-8') as f:
    snap_lines = f.readlines()

# 找到snapshot中的DSH_DOCS_INDEX行
dsh_line = None
for i, line in enumerate(snap_lines):
    if 'const DSH_DOCS_INDEX' in line:
        dsh_line = line
        print(f'从snapshot第{i+1}行提取, 长度: {len(line)}')
        break

if dsh_line is None:
    print('未找到DSH_DOCS_INDEX')
    exit()

with open(work_path, 'r', encoding='utf-8') as f:
    work_lines = f.readlines()

# 找到workspace中的DSH_DOCS_INDEX行（可能被拆成多行或不完整）
# 找到 // __DSH_DOCS_INDEX_START__ 和 // __DSH_DOCS_INDEX_END__ 之间的内容
start_idx = None
end_idx = None
for i, line in enumerate(work_lines):
    if '__DSH_DOCS_INDEX_START__' in line:
        start_idx = i
    if '__DSH_DOCS_INDEX_END__' in line:
        end_idx = i
        break

print(f'workspace中marker位置: start={start_idx}, end={end_idx}')

if start_idx is not None and end_idx is not None:
    # 替换start+1到end-1之间的内容
    new_lines = work_lines[:start_idx+1] + [dsh_line] + work_lines[end_idx:]
    with open(work_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f'已替换, 新文件行数: {len(new_lines)}')
else:
    print('未找到marker')
