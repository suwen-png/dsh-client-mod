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
            # 获取窗口位置
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            print(f"窗口: hwnd={hwnd}, title='{title}'")
            print(f"位置: left={rect.left}, top={rect.top}, right={rect.right}, bottom={rect.bottom}")
            print(f"大小: {rect.right-rect.left}x{rect.bottom-rect.top}")
            print(f"可见: {bool(user32.IsWindowVisible(hwnd))}")
            print(f"最小化: {bool(user32.IsIconic(hwnd))}")
    return True

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(EnumWindowsProc(callback), 0)

if hwnd_found:
    # 强制恢复并显示
    user32.ShowWindow(hwnd_found, 9)  # SW_RESTORE
    time.sleep(0.5)
    user32.SetForegroundWindow(hwnd_found)
    time.sleep(0.5)
    user32.BringWindowToTop(hwnd_found)
    time.sleep(1)
    print("已强制恢复窗口")
