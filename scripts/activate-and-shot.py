import ctypes
from ctypes import wintypes
import time
import subprocess

user32 = ctypes.windll.user32

# 查找Harness窗口
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
    print(f"找到Harness窗口: hwnd={hwnd_found}")
    # 恢复并激活
    user32.ShowWindow(hwnd_found, 9)
    time.sleep(0.3)
    user32.SetForegroundWindow(hwnd_found)
    time.sleep(0.3)
    user32.BringWindowToTop(hwnd_found)
    time.sleep(1)
    
    # 验证前台窗口
    fg = user32.GetForegroundWindow()
    length = user32.GetWindowTextLengthW(fg)
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(fg, buf, length + 1)
    print(f"前台窗口: '{buf.value}'")
    
    # 立即用PowerShell截图
    ps_script = r'''
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$path = "D:\hermes-data\dsh-client-mod\logs\harness-final.png"
$bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Host "截图已保存"
'''
    with open(r'D:\hermes-data\dsh-client-mod\scripts\take-shot.ps1', 'w', encoding='utf-8') as f:
        f.write(ps_script)
    
    subprocess.run(['powershell', '-ExecutionPolicy', 'Bypass', '-File', r'D:\hermes-data\dsh-client-mod\scripts\take-shot.ps1'], capture_output=True)
    print("截图完成")
else:
    print("未找到Harness窗口")
