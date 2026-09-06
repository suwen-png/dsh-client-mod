import ctypes
from ctypes import wintypes
import time
import subprocess

user32 = ctypes.windll.user32

# 获取屏幕DPI缩放
hdc = user32.GetDC(0)
dpi = ctypes.windll.gdi32.GetDeviceCaps(hdc, 88)  # LOGPIXELSX
user32.ReleaseDC(0, hdc)
scale = dpi / 96.0
print(f"DPI: {dpi}, 缩放: {scale}")

# 获取Harness窗口位置
hwnd = None
def callback(h, lParam):
    global hwnd
    length = user32.GetWindowTextLengthW(h)
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(h, buf, length + 1)
        if 'DeepSeek Harness' in buf.value and 'failed' not in buf.value:
            hwnd = h
    return True

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(EnumWindowsProc(callback), 0)

if hwnd:
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    print(f"窗口位置: ({rect.left},{rect.top})-({rect.right},{rect.bottom})")
    print(f"窗口大小: {rect.right-rect.left}x{rect.bottom-rect.top}")
    
    # 激活窗口
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.5)
    
    # 点击编辑按钮（在窗口内大约(1030, 100)位置）
    # 转换为屏幕坐标
    click_x = rect.left + 1030
    click_y = rect.top + 100
    print(f"点击编辑按钮: 屏幕坐标({click_x},{click_y})")
    
    # 模拟鼠标点击
    user32.SetCursorPos(click_x, click_y)
    time.sleep(0.2)
    user32.mouse_event(0x0002, 0, 0, 0, 0)  # LEFTDOWN
    time.sleep(0.1)
    user32.mouse_event(0x0004, 0, 0, 0, 0)  # LEFTUP
    time.sleep(2)
    
    # 截图
    ps = r'''
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$b = $screen.Bounds
$bm = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bm)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bm.Save("D:\hermes-data\dsh-client-mod\logs\test-ctypes-click.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bm.Dispose()
'''
    with open(r'D:\hermes-data\dsh-client-mod\scripts\shot-ctypes.ps1','w') as f: f.write(ps)
    subprocess.run(['powershell','-ExecutionPolicy','Bypass','-File',r'D:\hermes-data\dsh-client-mod\scripts\shot-ctypes.ps1'],capture_output=True)
    print("截图已保存")
else:
    print("未找到Harness窗口")
