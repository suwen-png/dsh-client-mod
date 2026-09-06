import ctypes
from ctypes import wintypes
user32 = ctypes.windll.user32

# 获取前台窗口
fg = user32.GetForegroundWindow()
length = user32.GetWindowTextLengthW(fg)
buf = ctypes.create_unicode_buffer(length + 1)
user32.GetWindowTextW(fg, buf, length + 1)
print(f"前台窗口: hwnd={fg}, title='{buf.value}'")

# 检查所有Harness窗口
def callback(hwnd, lParam):
    length = user32.GetWindowTextLengthW(hwnd)
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value
        if 'DeepSeek' in title or 'Harness' in title:
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            print(f"窗口: hwnd={hwnd}, title='{title}', pos=({rect.left},{rect.top})-({rect.right},{rect.bottom}), visible={bool(user32.IsWindowVisible(hwnd))}, iconic={bool(user32.IsIconic(hwnd))}")
    return True

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(EnumWindowsProc(callback), 0)

# 尝试用keybd_event模拟Alt+Tab
print("\n尝试模拟Alt+Tab...")
user32.keybd_event(0x12, 0, 0, 0)  # Alt down
user32.keybd_event(0x09, 0, 0, 0)  # Tab down
user32.keybd_event(0x09, 0, 2, 0)  # Tab up
user32.keybd_event(0x12, 0, 2, 0)  # Alt up

import time
time.sleep(1)

# 再次检查前台窗口
fg2 = user32.GetForegroundWindow()
length2 = user32.GetWindowTextLengthW(fg2)
buf2 = ctypes.create_unicode_buffer(length2 + 1)
user32.GetWindowTextW(fg2, buf2, length2 + 1)
print(f"Alt+Tab后前台窗口: hwnd={fg2}, title='{buf2.value}'")
