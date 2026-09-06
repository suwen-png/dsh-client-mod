import ctypes
from ctypes import wintypes
import time
import subprocess

user32 = ctypes.windll.user32

# 查找DevTools窗口
hwnd = None
def callback(h, lParam):
    global hwnd
    length = user32.GetWindowTextLengthW(h)
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(h, buf, length + 1)
        if 'Developer Tools' in buf.value:
            hwnd = h
    return True

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(EnumWindowsProc(callback), 0)

if hwnd:
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.5)
    
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    click_x = rect.left + 300
    click_y = rect.top + 500
    
    # 点击控制台输入框
    user32.SetCursorPos(click_x, click_y)
    time.sleep(0.2)
    user32.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.1)
    user32.mouse_event(0x0004, 0, 0, 0, 0)
    time.sleep(0.3)
    
    # 输入命令检查V10元素可见性
    cmd = "var e=document.querySelector('.dsh-dir-app');var r=e.getBoundingClientRect();getComputedStyle(e).display+'|'+getComputedStyle(e).visibility+'|'+e.offsetWidth+'x'+e.offsetHeight+'|pos:'+Math.round(r.left)+','+Math.round(r.top)+'|zIndex:'+getComputedStyle(e).zIndex"
    
    # 用剪贴板粘贴
    subprocess.run(['powershell', '-Command', f'Set-Clipboard -Value "{cmd}"'], capture_output=True)
    time.sleep(0.3)
    user32.keybd_event(0x11, 0, 0, 0)
    user32.keybd_event(0x56, 0, 0, 0)
    time.sleep(0.1)
    user32.keybd_event(0x56, 0, 2, 0)
    user32.keybd_event(0x11, 0, 2, 0)
    time.sleep(0.3)
    
    # 按Enter
    user32.keybd_event(0x0D, 0, 0, 0)
    time.sleep(0.1)
    user32.keybd_event(0x0D, 0, 2, 0)
    time.sleep(1)
    
    # 截图
    ps = r'''
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$b = $screen.Bounds
$bm = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bm)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bm.Save("D:\hermes-data\dsh-client-mod\logs\test-v10-visible.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bm.Dispose()
'''
    with open(r'D:\hermes-data\dsh-client-mod\scripts\shot-v10.ps1','w') as f: f.write(ps)
    subprocess.run(['powershell','-ExecutionPolicy','Bypass','-File',r'D:\hermes-data\dsh-client-mod\scripts\shot-v10.ps1'],capture_output=True)
    print("截图已保存")
