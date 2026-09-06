import time
import ctypes
from ctypes import wintypes

time.sleep(3)

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

width = user32.GetSystemMetrics(0)
height = user32.GetSystemMetrics(1)

hwnd = user32.GetDesktopWindow()
hdc = user32.GetWindowDC(hwnd)
memdc = gdi32.CreateCompatibleDC(hdc)
bmp = gdi32.CreateCompatibleBitmap(hdc, width, height)
gdi32.SelectObject(memdc, bmp)
gdi32.BitBlt(memdc, 0, 0, width, height, hdc, 0, 0, 0x00CC0020)

class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ('biSize', wintypes.DWORD), ('biWidth', wintypes.LONG), ('biHeight', wintypes.LONG),
        ('biPlanes', wintypes.WORD), ('biBitCount', wintypes.WORD),
        ('biCompression', wintypes.DWORD), ('biSizeImage', wintypes.DWORD),
        ('biXPelsPerMeter', wintypes.LONG), ('biYPelsPerMeter', wintypes.LONG),
        ('biClrUsed', wintypes.DWORD), ('biClrImportant', wintypes.DWORD),
    ]

bmpinfo = BITMAPINFOHEADER()
bmpinfo.biSize = ctypes.sizeof(BITMAPINFOHEADER)
bmpinfo.biWidth = width
bmpinfo.biHeight = -height
bmpinfo.biPlanes = 1
bmpinfo.biBitCount = 32
bmpinfo.biCompression = 0

pixels = ctypes.create_string_buffer(width * height * 4)
gdi32.GetDIBits(memdc, bmp, 0, height, pixels, ctypes.byref(bmpinfo), 0)

# 写BMP
with open(r'D:\hermes-data\dsh-client-mod\logs\v20-main3.bmp', 'wb') as f:
    # 文件头
    f.write(b'BM')
    f.write((54 + len(pixels.raw)).to_bytes(4, 'little'))
    f.write((0).to_bytes(2, 'little'))
    f.write((0).to_bytes(2, 'little'))
    f.write((54).to_bytes(4, 'little'))
    # 信息头
    f.write(ctypes.string_at(ctypes.byref(bmpinfo), 40))
    f.write(pixels.raw)

print(f'截图完成: {width}x{height}')

gdi32.DeleteObject(bmp)
gdi32.DeleteDC(memdc)
user32.ReleaseDC(hwnd, hdc)
