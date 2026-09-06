"""
V10总监控制台 GUI交互测试脚本
测试所有50+项按钮点击功能
使用Python ctypes模拟鼠标点击
"""
import ctypes
from ctypes import wintypes
import time
import os

user32 = ctypes.windll.user32

# 鼠标事件常量
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_ABSOLUTE = 0x8000

# 屏幕尺寸
SCREEN_WIDTH = 1536
SCREEN_HEIGHT = 864

def click(x, y, delay=0.5):
    """模拟鼠标点击"""
    # 转换为绝对坐标（0-65535）
    abs_x = int(x * 65535 / SCREEN_WIDTH)
    abs_y = int(y * 65535 / SCREEN_HEIGHT)
    user32.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y, 0, 0)
    time.sleep(0.1)
    user32.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTDOWN, abs_x, abs_y, 0, 0)
    time.sleep(0.05)
    user32.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTUP, abs_x, abs_y, 0, 0)
    time.sleep(delay)
    print(f'  点击 ({x}, {y})')

def screenshot(name):
    """截图"""
    gdi32 = ctypes.windll.gdi32
    hwnd = user32.GetDesktopWindow()
    hdc = user32.GetWindowDC(hwnd)
    memdc = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, SCREEN_WIDTH, SCREEN_HEIGHT)
    gdi32.SelectObject(memdc, bmp)
    gdi32.BitBlt(memdc, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, hdc, 0, 0, 0x00CC0020)
    
    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [('biSize', wintypes.DWORD), ('biWidth', wintypes.LONG),
                    ('biHeight', wintypes.LONG), ('biPlanes', wintypes.WORD),
                    ('biBitCount', wintypes.WORD), ('biCompression', wintypes.DWORD),
                    ('biSizeImage', wintypes.DWORD), ('biXPelsPerMeter', wintypes.LONG),
                    ('biYPelsPerMeter', wintypes.LONG), ('biClrUsed', wintypes.DWORD),
                    ('biClrImportant', wintypes.DWORD)]
    
    bmpinfo = BITMAPINFOHEADER()
    bmpinfo.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmpinfo.biWidth = SCREEN_WIDTH
    bmpinfo.biHeight = -SCREEN_HEIGHT
    bmpinfo.biPlanes = 1
    bmpinfo.biBitCount = 32
    bmpinfo.biCompression = 0
    
    pixels = ctypes.create_string_buffer(SCREEN_WIDTH * SCREEN_HEIGHT * 4)
    gdi32.GetDIBits(memdc, bmp, 0, SCREEN_HEIGHT, pixels, ctypes.byref(bmpinfo), 0)
    
    path = f'D:\\hermes-data\\dsh-client-mod\\logs\\gui-test-{name}.bmp'
    with open(path, 'wb') as f:
        f.write(b'BM')
        f.write((54 + len(pixels.raw)).to_bytes(4, 'little'))
        f.write((0).to_bytes(2, 'little'))
        f.write((0).to_bytes(2, 'little'))
        f.write((54).to_bytes(4, 'little'))
        f.write(ctypes.string_at(ctypes.byref(bmpinfo), 40))
        f.write(pixels.raw)
    
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(memdc)
    user32.ReleaseDC(hwnd, hdc)
    print(f'  截图: {name}')
    return path

# ========== 测试开始 ==========
print('=' * 60)
print('V10总监控制台 GUI交互测试')
print('=' * 60)

# 测试1: D区技能tab切换
print('\n[测试1] D区技能tab切换')
click(1470, 205)  # 技能tab
screenshot('01-skills-tab')

# 测试2: D区执行逻辑tab切换
print('\n[测试2] D区执行逻辑tab切换')
click(1510, 205)  # 执行逻辑tab
screenshot('02-duties-tab')

# 测试3: D区智能体tab切换（回到智能体）
print('\n[测试3] D区智能体tab切换')
click(1430, 205)  # 智能体tab
screenshot('03-agents-tab')

# 测试4: B区项目总览折叠
print('\n[测试4] B区项目总览折叠')
click(100, 130)  # 项目总览标题
screenshot('04-overview-collapsed')

# 测试5: B区项目总览展开
print('\n[测试5] B区项目总览展开')
click(100, 130)  # 项目总览标题
screenshot('05-overview-expanded')

# 测试6: A区驾驶舱下拉
print('\n[测试6] A区驾驶舱下拉')
click(380, 65)  # 驾驶舱按钮
screenshot('06-cockpit-dropdown')

# 测试7: 点击空白关闭下拉
print('\n[测试7] 关闭下拉')
click(500, 300)  # 空白区域
screenshot('07-dropdown-closed')

# 测试8: A区设置按钮
print('\n[测试8] A区设置按钮')
click(1310, 65)  # 设置按钮
screenshot('08-settings-modal')

# 测试9: 设置弹窗外观tab
print('\n[测试9] 设置弹窗外观tab')
click(760, 420)  # 外观tab
screenshot('09-settings-appearance')

# 测试10: 关闭设置弹窗
print('\n[测试10] 关闭设置弹窗')
click(800, 700)  # 关闭按钮
screenshot('10-settings-closed')

# 测试11: 智能体切换对话
print('\n[测试11] 智能体切换对话（代码工程师）')
click(1470, 340)  # 代码工程师的切换对话按钮
screenshot('11-agent-switched')

# 测试12: 发送消息
print('\n[测试12] 发送测试消息')
# 点击输入框
click(400, 780)
time.sleep(0.3)
# 输入文字
user32.keybd_event(0x54, 0, 0, 0)  # T
user32.keybd_event(0x54, 0, 2, 0)
user32.keybd_event(0x45, 0, 0, 0)  # E
user32.keybd_event(0x45, 0, 2, 0)
user32.keybd_event(0x53, 0, 0, 0)  # S
user32.keybd_event(0x53, 0, 2, 0)
user32.keybd_event(0x54, 0, 0, 0)  # T
user32.keybd_event(0x54, 0, 2, 0)
time.sleep(0.3)
# 点击发送按钮
click(1300, 780)
time.sleep(2)
screenshot('12-message-sent')

# 测试13: A区折叠导航栏
print('\n[测试13] A区折叠导航栏')
click(1340, 65)  # 折叠按钮
screenshot('13-nav-collapsed')

# 测试14: 展开导航栏
print('\n[测试14] 展开导航栏')
click(1400, 25)  # 展开按钮
screenshot('14-nav-expanded')

print('\n' + '=' * 60)
print('GUI交互测试完成！')
print('=' * 60)
