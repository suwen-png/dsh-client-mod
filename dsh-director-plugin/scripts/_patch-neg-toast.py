#!/usr/bin/env python3
"""_patch-neg-toast.py —— E1 新断言（NS-6n）的**负向校准**补丁

为什么需要：纪律 32「新检查必须**植入目标缺陷**校准」。NS-6n 断言"toast 自己说明
『已清除总监对话消息 N 条』"—— 必须证明**产品真不这么说时它会红**，否则它可能只是恒真。

用法（改的是**产品源码**，不是闸门 —— 用别处的缺陷校准不算）：
    python scripts/_patch-neg-toast.py check    # 看当前状态
    python scripts/_patch-neg-toast.py apply    # 植入缺陷（正→坏）
    python scripts/_patch-neg-toast.py revert   # 还原（坏→正）

校准完成后**必须 revert + 重建 + 重装**，否则产品是坏的。
"""
import io
import sys

P = "src/components/DirectorPage.js"
GOOD = '"已清除总监对话消息 " + r.removed'
BAD = '"已清理总监会话记录 " + r.removed'

mode = sys.argv[1] if len(sys.argv) > 1 else "check"
s = io.open(P, encoding="utf-8", newline="").read()  # newline="" ⇒ 换行符原样保留

if mode == "check":
    print("GOOD(正确文案) 出现 " + str(s.count(GOOD)) + " 处 ｜ BAD(缺陷文案) 出现 " + str(s.count(BAD)) + " 处")
    sys.exit(0)

if mode == "apply":
    n = s.count(GOOD)
    if n != 1:
        print("FAIL：期望 GOOD 恰好 1 处，实为 " + str(n))
        sys.exit(2)
    s = s.replace(GOOD, BAD)
elif mode == "revert":
    n = s.count(BAD)
    if n != 1:
        print("FAIL：期望 BAD 恰好 1 处，实为 " + str(n))
        sys.exit(2)
    s = s.replace(BAD, GOOD)
else:
    print("用法：python scripts/_patch-neg-toast.py check|apply|revert")
    sys.exit(2)

io.open(P, "w", encoding="utf-8", newline="").write(s)
print("ok " + mode + " · 文件 " + str(len(s.encode("utf-8"))) + " B")
