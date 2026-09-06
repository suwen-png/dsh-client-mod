from PIL import ImageGrab
import time

# 等待一下
time.sleep(1)

# 截取全屏
img = ImageGrab.grab()
print(f"截图尺寸: {img.size}")

# 保存截图
img.save(r'D:\hermes-data\dsh-client-mod\logs\harness-screenshot.png')
print("截图已保存到 logs/harness-screenshot.png")

# 检查左上角区域的颜色（如果Harness在(0,0)，应该不是壁纸颜色）
pixel = img.getpixel((100, 100))
print(f"左上角(100,100)像素颜色: {pixel}")
