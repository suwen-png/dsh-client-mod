"""A14 剥离：把 client.js 第 6539 行的 541,312 字节 DSH_DOCS_INDEX 常量
替换为「运行时按需加载」的降级占位，使宿主不再内联整份 docs 快照。

用法：python strip_a14.py [--dry-run]
"""
import io
import json
import sys
import os
from datetime import datetime

TARGET = r"D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"
DRY = "--dry-run" in sys.argv

# 剥离后的替代实现：保持 window.__dshDocsIndex 接口形态不变，
# 但改为「尝试 fetch 插件侧资源，失败则保持 undefined」。
# 关键：宿主 6583 行有 `typeof DSH_DOCS_INDEX !== "undefined" && DSH_DOCS_INDEX`
# 守卫，故这里**必须不声明** DSH_DOCS_INDEX 才能走到 "索引未注入" 回落分支。
REPLACEMENT = (
    '\t\t/* [T-PLUG-005 A14 剥离 2026-09-11] 原为单行 541,312 B 的 DSH_DOCS_INDEX 内联常量'
    '（含 docs/ 90 篇全文），占本文件 36.6%。\n'
    '\t\t   已抽取为插件资源 dsh-director-plugin/assets/docs-index.json，由插件运行时加载并'
    '挂 window.__dshDocsIndex。\n'
    '\t\t   本处不再声明 DSH_DOCS_INDEX —— 下游 client.js 的 `typeof DSH_DOCS_INDEX !== "undefined"` '
    '守卫会自动回落为「索引未注入」，与原剥离前缺省行为一致。\n'
    '\t\t   恢复：从 snapshots/ 或 git 取回本文件。 */'
)

with io.open(TARGET, "r", encoding="utf-8", newline="") as f:
    lines = f.readlines()

print("剥离前  行数=%d  字节=%d" % (len(lines), os.path.getsize(TARGET)))

idx = 6539 - 1
line = lines[idx]
print("目标行 6539 字节=%d  前缀=%r" % (len(line), line[:40]))

if "DSH_DOCS_INDEX" not in line or len(line) < 500000:
    print("!! 断言失败：第 6539 行不是预期的 DSH_DOCS_INDEX 巨型常量")
    sys.exit(2)

# 同时改 6541 行的挂载逻辑：改为读取外部注入值（若插件已加载则用，否则不写）
mount_idx = 6541 - 1
mount_old = lines[mount_idx]
print("目标行 6541 = %r" % mount_old.strip())

if DRY:
    print("[dry-run] 将替换 6539 行为 %d 字节注释；将改写 6541 行挂载逻辑" % len(REPLACEMENT))
    sys.exit(0)

lines[idx] = REPLACEMENT + "\n"
lines[mount_idx] = (
    "\t\tif (typeof window !== \"undefined\" && typeof DSH_DOCS_INDEX !== \"undefined\" && DSH_DOCS_INDEX) "
    "window.__dshDocsIndex = DSH_DOCS_INDEX;\n"
)

with io.open(TARGET, "w", encoding="utf-8", newline="") as f:
    f.writelines(lines)

print("剥离后  行数=%d  字节=%d" % (len(lines), os.path.getsize(TARGET)))
print("减幅    %d 字节" % (1479577 - os.path.getsize(TARGET)))
