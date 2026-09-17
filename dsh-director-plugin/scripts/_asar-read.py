# -*- coding: utf-8 -*-
"""_asar-read.py —— 读 DeepSeek Harness 的 `app.asar`（**应用自身代码的唯一真相源**）

════════════════════════════════════════════════════════════════════
为什么它必须存在（不是"顺手写的小工具"）
────────────────────────────────────────────────────────────────────
2026-09-17「打开就闪退」排查的**每一条真因都写在应用主进程代码里**：

  · 单实例锁   `/lib/main.js`             → `if (!app.requestSingleInstanceLock()) app.quit();`
  · 关窗不退   `/lib/types/window-lifecycle.js` → `onWindowClose(){ e.preventDefault(); getWindow()?.hide(); }`
  · 唤窗空操作 `/lib/main.js`             → `app.on("second-instance", () => lifecycle?.showWindow())`（boot 期 `?.` = 什么都不做）
  · 安装器参数 `/lib/types/window-lifecycle.js` → `INSTALLER_QUIT_ARGUMENT = "--dsh-installer-quit"`

不看 asar 就只能靠猜（本轮前几轮就在猜，代价是连报三次"已修复"而用户照样闪退）。
**凡是"应用整体行为"级别的故障（启动/退出/托盘/更新），先读这里。**

⚠️ 只读：不修改 asar，不写项目源码；导出物落在 `logs/_asar/`（证据保留）。

用法
  python scripts/_asar-read.py --list [前缀]          列出 asar 条目（默认全部）
  python scripts/_asar-read.py --dump <asar路径>      导出单个文件到 logs/_asar/
  python scripts/_asar-read.py --grep k1,k2 [-c 700]  搜关键词并打印上下文

退出码：0 = 成功 · 2 = 用法错 · 3 = asar 不存在
"""

import argparse
import json
import os
import re
import sys

ASAR = r"D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\resources\app.asar"
HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(os.path.dirname(HERE), "logs", "_asar")


def load():
    """返回 (raw, files{path: meta}, data_start)。asar 头从 b'{"files"' 反推长度字段。"""
    if not os.path.exists(ASAR):
        print("asar 不存在：" + ASAR)
        sys.exit(3)
    raw = open(ASAR, "rb").read()
    anchor = raw.find(b'{"files"')
    if anchor < 0:
        print("asar 头找不到（格式变了？）")
        sys.exit(3)
    json_len = int.from_bytes(raw[anchor - 4:anchor], "little")
    header = json.loads(raw[anchor:anchor + json_len].decode("utf-8"))
    data_start = (anchor + json_len + 3) // 4 * 4
    files = {}

    def walk(node, prefix=""):
        for name, meta in node.get("files", {}).items():
            p = prefix + "/" + name
            if "files" in meta:
                walk(meta, p)
            else:
                files[p] = meta

    walk(header)
    return raw, files, data_start


def body(raw, meta, data_start):
    off = int(meta["offset"])
    return raw[data_start + off: data_start + off + int(meta["size"])]


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--list", nargs="?", const="", default=None)
    ap.add_argument("--dump", default=None)
    ap.add_argument("--grep", default=None)
    ap.add_argument("-c", "--context", type=int, default=700)
    a = ap.parse_args()

    raw, files, data_start = load()

    if a.list is not None:
        pre = a.list
        hits = sorted((p for p in files if p.startswith(pre)), key=lambda p: -int(files[p].get("size", 0)))
        print("ASAR 条目 %d / 匹配 %d（前缀=%r）" % (len(files), len(hits), pre))
        for p in hits[:300]:
            print("  %9d  %s" % (int(files[p].get("size", 0)), p))
        return 0

    if a.dump:
        if a.dump not in files:
            print("条目不存在：" + a.dump)
            return 2
        os.makedirs(OUTDIR, exist_ok=True)
        out = os.path.join(OUTDIR, a.dump.strip("/").replace("/", "__"))
        open(out, "wb").write(body(raw, files[a.dump], data_start))
        print("dumped %-50s %d B → %s" % (a.dump, int(files[a.dump]["size"]), out))
        return 0

    if a.grep:
        kws = [k for k in a.grep.split(",") if k]
        os.makedirs(OUTDIR, exist_ok=True)
        out = os.path.join(OUTDIR, "_grep-hits.txt")
        n = 0
        with open(out, "w", encoding="utf-8") as fh:
            for p, meta in sorted(files.items()):
                if not p.endswith(".js"):
                    continue
                txt = body(raw, meta, data_start).decode("utf-8", "replace")
                for kw in kws:
                    for m in re.finditer(re.escape(kw), txt):
                        s = max(0, m.start() - a.context)
                        e = min(len(txt), m.end() + a.context)
                        fh.write("\n" + "=" * 100 + "\n")
                        fh.write("FILE=%s  KW=%s  AT=%d\n" % (p, kw, m.start()))
                        fh.write("-" * 100 + "\n" + txt[s:e] + "\n")
                        n += 1
        print("命中 %d 处 → %s" % (n, out))
        return 0

    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
