"""
V10总监控制台 GUI交互测试脚本 V2
先激活Harness窗口，然后精确测试所有交互
"""
import ctypes
from ctypes import wintypes
import time

user32 = ctypes.windll.user32

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_ABSOLUTE = 0x8000

SCREEN_WIDTH = 1536
SCREEN_HEIGHT = 864

def click(x, y, delay=0.8):
    abs_x = int(x * 65535 / SCREEN_WIDTH)
    abs_y = int(y * 65535 / SCREEN_HEIGHT)
    user32.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y, 0, 0)
    time.sleep(0.15)
    user32.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTDOWN, abs_x, abs_y, 0, 0)
    time.sleep(0.08)
    user32.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTUP, abs_x, abs_y, 0, 0)
    time.sleep(delay)
    print(f'  点击 ({x}, {y})')

def screenshot(name):
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
    
    path = f'D:\\hermes-data\\dsh-client-mod\\logs\\gui2-{name}.bmp'
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

# ========== 激活Harness窗口 ==========
print('激活Harness窗口...')
# 点击Harness窗口中心区域激活
click(768, 400, delay=1)
screenshot('00-harness-active')

# ========== 测试开始 ==========
print('\n' + '=' * 60)
print('V10总监控制台 GUI交互测试 V2')
print('=' * 60)

# 测试1: D区技能tab切换（精确坐标）
print('\n[测试1] D区技能tab切换')
click(1465, 200)  # 技能tab
screenshot('01-skills-tab')

# 测试2: D区执行逻辑tab切换
print('\n[测试2] D区执行逻辑tab切换')
click(1510, 200)  # 执行逻辑tab
screenshot('02-duties-tab')

# 测试3: D区智能体tab切换
print('\n[测试3] D区智能体tab切换')
click(1425, 200)  # 智能体tab
screenshot('03-agents-tab')

# 测试4: B区项目总览折叠
print('\n[测试4] B区项目总览折叠')
click(80, 135)  # 项目总览标题
screenshot('04-overview-collapsed')

# 测试5: B区项目总览展开
print('\n[测试5] B区项目总览展开')
click(80, 135)
screenshot('05-overview-expanded')

# 测试6: A区驾驶舱下拉
print('\n[测试6] A区驾驶舱下拉')
click(370, 68)  # 驾驶舱按钮
screenshot('06-cockpit-dropdown')

# 测试7: 点击空白关闭下拉
print('\n[测试7] 关闭下拉')
click(500, 350)
screenshot('07-dropdown-closed')

# 测试8: A区设置按钮
print('\n[测试8] A区设置按钮')
click(1305, 68)  # 设置按钮
screenshot('08-settings-modal')

# 测试9: 关闭设置弹窗（点击遮罩）
print('\n[测试9] 关闭设置弹窗')
click(200, 200)  # 点击遮罩外部
screenshot('09-settings-closed')

# 测试10: 智能体切换对话
print('\n[测试10] 智能体切换对话（代码工程师）')
click(1470, 345)  # 切换对话按钮
screenshot('10-agent-switched')

# 测试11: 发送消息
print('\n[测试11] 发送测试消息')
click(400, 790)  # 输入框
time.sleep(0.3)
# 输入"测试"
user32.keybd_event(0x54, 0, 0, 0)  # T
user32.keybd_event(0x54, 0, 2, 0)
user32.keybd_event(0x45, 0, 0, 0)  # E
user32.keybd_event(0x45, 0, 2, 0)
user32.keybd_event(0x53, 0, 0, 0)  # S
user32.keybd_event(0x53, 0, 2, 0)
user32.keybd_event(0x54, 0, 0, 0)  # T
user32.keybd_event(0x54, 0, 2, 0)
time.sleep(0.5)
click(1290, 790)  # 发送按钮
time.sleep(2.5)
screenshot('11-message-sent')

# 测试12: A区折叠导航栏
print('\n[测试12] A区折叠导航栏')
click(1335, 68)  # 折叠按钮
screenshot('12-nav-collapsed')

# 测试13: 展开导航栏
print('\n[测试13] 展开导航栏')
click(1400, 22)  # 展开按钮
screenshot('13-nav-expanded')

# 测试14: D区搜索功能
print('\n[测试14] D区搜索功能')
click(1440, 240)  # 搜索框
time.sleep(0.3)
user32.keybd_event(0x43, 0, 0, 0)  # C
user32.keybd_event(0x43, 0, 2, 0)
user32.keybd_event(0x4F, 0, 0, 0)  # O
user32.keybd_event(0x4F, 0, 2, 0)
user32.keybd_event(0x44, 0, 0, 0)  # D
user32.keybd_event(0x44, 0, 2, 0)
user32.keybd_event(0x45, 0, 0, 0)  # E
user32.keybd_event(0x45, 0, 2, 0)
time.sleep(0.5)
screenshot('14-search')

print('\n' + '=' * 60)
print('GUI交互测试 V2 完成！')
print('=' * 60)
