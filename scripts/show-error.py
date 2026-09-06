import time, ctypes
from ctypes import wintypes
user32 = ctypes.windll.user32

# 查找错误窗口
hwnd_found = None
def callback(hwnd, lParam):
    global hwnd_found
    length = user32.GetWindowTextLengthW(hwnd)
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value
        if 'failed to start' in title:
            hwnd_found = hwnd
    return True

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(EnumWindowsProc(callback), 0)

if hwnd_found:
    print(f"找到错误窗口: hwnd={hwnd_found}")
    user32.ShowWindow(hwnd_found, 9)
    user32.SetForegroundWindow(hwnd_found)
    time.sleep(1)
    print("已激活错误窗口")
else:
    print("未找到错误窗口")
