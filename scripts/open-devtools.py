import ctypes
from ctypes import wintypes
import time
import subprocess

user32 = ctypes.windll.user32

# 查找Harness窗口
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
    # 激活窗口
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.5)
    
    # 按Ctrl+Shift+I打开DevTools
    print("按Ctrl+Shift+I打开DevTools...")
    user32.keybd_event(0x11, 0, 0, 0)  # Ctrl down
    user32.keybd_event(0x10, 0, 0, 0)  # Shift down
    user32.keybd_event(0x49, 0, 0, 0)  # I down
    time.sleep(0.1)
    user32.keybd_event(0x49, 0, 2, 0)  # I up
    user32.keybd_event(0x10, 0, 2, 0)  # Shift up
    user32.keybd_event(0x11, 0, 2, 0)  # Ctrl up
    time.sleep(3)
    
    # 截图
    ps = r'''
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$b = $screen.Bounds
$bm = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bm)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bm.Save("D:\hermes-data\dsh-client-mod\logs\test-devtools.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bm.Dispose()
'''
    with open(r'D:\hermes-data\dsh-client-mod\scripts\shot-devtools.ps1','w') as f: f.write(ps)
    subprocess.run(['powershell','-ExecutionPolicy','Bypass','-File',r'D:\hermes-data\dsh-client-mod\scripts\shot-devtools.ps1'],capture_output=True)
    print("截图已保存")
else:
    print("未找到Harness窗口")
