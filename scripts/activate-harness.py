import subprocess
import time
import ctypes
from ctypes import wintypes

# 检查进程
result = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq DeepSeek*'], capture_output=True, text=True)
print("=== Harness进程 ===")
print(result.stdout)

# 用ctypes查找并激活窗口
user32 = ctypes.windll.user32

def enum_windows_callback(hwnd, lParam):
    length = user32.GetWindowTextLengthW(hwnd)
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value
        if 'DeepSeek' in title or 'Harness' in title:
            print(f"找到窗口: hwnd={hwnd}, title='{title}'")
            # 激活窗口
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            user32.SetForegroundWindow(hwnd)
            print(f"已激活窗口: {title}")
    return True

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
callback = EnumWindowsProc(enum_windows_callback)
user32.EnumWindows(callback, 0)

time.sleep(2)
print("\n窗口激活完成")
