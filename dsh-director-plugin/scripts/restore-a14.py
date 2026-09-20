"""A14 剥离回滚：从快照恢复 client.js 至剥离前状态。

用途：T-PLUG-005 A14 剥离出问题时的快速复原。
注意：`workspace/` 被 .gitignore 忽略 → **git 兜不住**，故依赖 snapshots/ 副本。

用法：
  python restore-a14.py              # 从快照恢复到 workspace/
  python restore-a14.py --check      # 仅校验锚点可用性，不改动
"""
import io
import os
import shutil
import sys

ROOT = r"D:\hermes-data\dsh-client-mod"
"""🔴 `T-DOC-001` B6 更正（2026-09-18）：原指向
  `snapshots\\snapshot-20260908-131412-before-apply\\...`
  —— 该目录已于 **09-14 清理**时删除 ⇒ 本脚本 `--check` **恒失败**（退路名存实亡）。
  现存唯一快照是 `snapshots\\host-b6-20260911-before-patch\\client.js`，
  实测体积 **1479577 B**，与下面 `EXPECTED_SNAP_BYTES` **逐字节一致**
  ⇒ 是同一份文件被重新归置（不是"另一份快照"），故改指向即可，判据不必放松。"""
SNAP = os.path.join(ROOT, r"snapshots\host-b6-20260911-before-patch\client.js")
DST = os.path.join(ROOT, r"workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js")
ASSET = os.path.join(ROOT, r"dsh-director-plugin\assets\docs-index.json")

EXPECTED_SNAP_BYTES = 1479577

if not os.path.isfile(SNAP):
    print("!! 快照缺失: " + SNAP)
    sys.exit(2)

snap_size = os.path.getsize(SNAP)
if snap_size != EXPECTED_SNAP_BYTES:
    print("!! 快照体积异常: %d（预期 %d）" % (snap_size, EXPECTED_SNAP_BYTES))
    sys.exit(2)

with io.open(SNAP, "r", encoding="utf-8", newline="") as f:
    decl = sum(1 for ln in f if ln.startswith("const DSH_DOCS_INDEX"))

print("快照 %s  字节=%d  DSH_DOCS_INDEX 声明=%d" % (SNAP, snap_size, decl))
if decl != 1:
    print("!! 快照不含预期的 DSH_DOCS_INDEX 声明")
    sys.exit(2)

if "--check" in sys.argv:
    print("锚点校验通过（未改动任何文件）")
    sys.exit(0)

shutil.copy2(SNAP, DST)
print("已恢复到 %s  字节=%d" % (DST, os.path.getsize(DST)))
print("提示：资源文件 %s 可保留（宿主已不再引用，插件侧仍可用）" % ASSET)
