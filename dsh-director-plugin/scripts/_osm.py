#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""OS 级鼠标 —— 绕过 CDP，用真实的 user32.dll 事件做裁判。

为什么必须有这个工具：
  CDP 的 Input.dispatchMouseEvent 是**注入到渲染进程**的合成事件，
  它不经过 Windows 的窗口消息循环。凡是发生在"事件到达渲染进程之前"
  的拦截（-webkit-app-region: drag 的 WM_NCHITTEST、上层覆盖窗口、
  窗口非客户区判定……）它**一律看不见**，于是全部报绿。
  真人点击走的是 OS -> 窗口 -> Chromium 这条路。
  要证明"真人能不能点到"，只有这条路走一遍。

用法：
  python scripts/_osm.py info
  python scripts/_osm.py restore
  python scripts/_osm.py pos
  python scripts/_osm.py move <x> <y>
  python scripts/_osm.py click <x> <y>
坐标一律是**物理屏幕像素**。
"""
import ctypes
import json
import sys
import time
from ctypes import wintypes

u = ctypes.windll.user32

# 让本进程 DPI 感知：否则 SetCursorPos 走的是被系统缩放过的虚拟坐标
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
except Exception:
    try:
        u.SetProcessDPIAware()
    except Exception:
        pass

u.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
u.FindWindowW.restype = wintypes.HWND
u.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
u.SetForegroundWindow.argtypes = [wintypes.HWND]
u.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
u.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
u.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
u.mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
                          wintypes.DWORD, ctypes.c_void_p]

TITLE = "DeepSeek Harness"
SW_RESTORE = 9
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004


def hwnd():
    return u.FindWindowW(None, TITLE)


def rect(h):
    r = wintypes.RECT()
    u.GetWindowRect(h, ctypes.byref(r))
    return [r.left, r.top, r.right, r.bottom]


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "info"
    h = hwnd()

    if cmd == "info":
        out({"hwnd": h or None, "title": TITLE,
             "rect": rect(h) if h else None,
             "clientOrigin": [0, 0]})

    elif cmd == "restore":
        if not h:
            out({"error": "window not found"})
            return
        u.ShowWindow(h, SW_RESTORE)
        u.SetForegroundWindow(h)
        time.sleep(0.6)
        out({"restored": True, "hwnd": h, "rect": rect(h)})

    elif cmd == "pos":
        p = wintypes.POINT()
        u.GetCursorPos(ctypes.byref(p))
        out({"pos": [p.x, p.y]})

    elif cmd == "move":
        x, y = int(sys.argv[2]), int(sys.argv[3])
        u.SetCursorPos(x, y)
        time.sleep(0.15)
        p = wintypes.POINT()
        u.GetCursorPos(ctypes.byref(p))
        out({"moved": [x, y], "actual": [p.x, p.y]})

    elif cmd == "click":
        x, y = int(sys.argv[2]), int(sys.argv[3])
        u.SetCursorPos(x, y)
        time.sleep(0.18)
        u.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, None)
        time.sleep(0.07)
        u.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, None)
        time.sleep(0.3)
        out({"clicked": [x, y]})

    else:
        out({"error": "unknown cmd: " + cmd})


main()
