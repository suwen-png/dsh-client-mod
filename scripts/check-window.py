import time, ctypes
from ctypes import wintypes
time.sleep(5)
user32 = ctypes.windll.user32
windows = []
def callback(hwnd, lParam):
    length = user32.GetWindowTextLengthW(hwnd)
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value
        if 'DeepSeek' in title or 'Harness' in title:
            windows.append((hwnd, title))
    return True
EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(EnumWindowsProc(callback), 0)
for hwnd, title in windows:
    print(f'窗口: hwnd={hwnd}, title="{title}"')
if not windows:
    print('未找到Harness窗口')
