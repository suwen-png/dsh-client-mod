"""
V10总监控制台 GUI交互测试脚本 V3 - 精确坐标
基于实际截图计算坐标
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
    
    path = f'D:\\hermes-data\\dsh-client-mod\\logs\\gui3-{name}.bmp'
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

# ========== 测试开始 ==========
print('=' * 60)
print('V10总监控制台 GUI交互测试 V3 - 精确坐标')
print('=' * 60)

# 测试1: D区技能tab切换
# 从截图看，D区tab在y约395，智能体x约1430，技能x约1475，执行逻辑x约1520
print('\n[测试1] D区技能tab切换')
click(1475, 395)
screenshot('01-skills-tab')

# 测试2: D区执行逻辑tab切换
print('\n[测试2] D区执行逻辑tab切换')
click(1520, 395)
screenshot('02-duties-tab')

# 测试3: D区智能体tab切换（回到智能体）
print('\n[测试3] D区智能体tab切换')
click(1430, 395)
screenshot('03-agents-tab')

# 测试4: B区项目总览折叠
# 项目总览标题在y约180
print('\n[测试4] B区项目总览折叠')
click(80, 180)
screenshot('04-overview-collapsed')

# 测试5: B区项目总览展开
print('\n[测试5] B区项目总览展开')
click(80, 180)
screenshot('05-overview-expanded')

# 测试6: A区驾驶舱下拉
# 驾驶舱按钮在y约125，x约400
print('\n[测试6] A区驾驶舱下拉')
click(400, 125)
screenshot('06-cockpit-dropdown')

# 测试7: 点击空白关闭下拉
print('\n[测试7] 关闭下拉')
click(500, 400)
screenshot('07-dropdown-closed')

# 测试8: A区设置按钮
# 设置按钮在y约125，x约1305
print('\n[测试8] A区设置按钮')
click(1305, 125)
screenshot('08-settings-modal')

# 测试9: 关闭设置弹窗（点击遮罩外部）
print('\n[测试9] 关闭设置弹窗')
click(100, 100)
screenshot('09-settings-closed')

# 测试10: 智能体切换对话（代码工程师）
# 代码工程师卡片在y约500，切换对话按钮在x约1470
print('\n[测试10] 智能体切换对话（代码工程师）')
click(1470, 545)
screenshot('10-agent-switched')

# 测试11: 发送消息
# 输入框在y约780，发送按钮在x约1290
print('\n[测试11] 发送测试消息')
click(400, 780)
time.sleep(0.3)
# 输入"hello"
for key in [0x48, 0x45, 0x4C, 0x4C, 0x4F]:
    user32.keybd_event(key, 0, 0, 0)
    user32.keybd_event(key, 0, 2, 0)
    time.sleep(0.05)
time.sleep(0.5)
click(1290, 780)
time.sleep(2.5)
screenshot('11-message-sent')

# 测试12: A区折叠导航栏
# 折叠按钮在y约125，x约1335
print('\n[测试12] A区折叠导航栏')
click(1335, 125)
screenshot('12-nav-collapsed')

# 测试13: 展开导航栏
print('\n[测试13] 展开导航栏')
click(1400, 50)
screenshot('13-nav-expanded')

# 测试14: B区风险编辑
print('\n[测试14] B区风险编辑')
click(1430, 245)  # 编辑按钮
screenshot('14-risk-edit')

# 测试15: 取消编辑
print('\n[测试15] 取消编辑')
click(1100, 340)  # 取消按钮
screenshot('15-edit-cancelled')

print('\n' + '=' * 60)
print('GUI交互测试 V3 完成！')
print('=' * 60)
