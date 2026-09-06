import time, ctypes
from ctypes import wintypes
user32 = ctypes.windll.user32

hwnd_found = None
def callback(hwnd, lParam):
    global hwnd_found
    length = user32.GetWindowTextLengthW(hwnd)
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value
        if 'DeepSeek Harness' in title and 'failed' not in title:
            hwnd_found = hwnd
    return True

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(EnumWindowsProc(callback), 0)

if hwnd_found:
    print(f"找到窗口: hwnd={hwnd_found}")
    # 先恢复
    user32.ShowWindow(hwnd_found, 9)  # SW_RESTORE
    time.sleep(0.5)
    # 移动到主显示器(0,0)，大小1400x900
    user32.MoveWindow(hwnd_found, 0, 0, 1400, 900, True)
    time.sleep(0.5)
    # 置前
    user32.SetForegroundWindow(hwnd_found)
    user32.BringWindowToTop(hwnd_found)
    time.sleep(1)
    # 验证位置
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd_found, ctypes.byref(rect))
    print(f"新位置: ({rect.left},{rect.top}) - ({rect.right},{rect.bottom})")
    print(f"可见: {bool(user32.IsWindowVisible(hwnd_found))}")
else:
    print("未找到窗口")
