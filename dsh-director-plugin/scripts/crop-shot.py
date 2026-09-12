#!/usr/bin/env python
"""crop-shot.py —— 截图局部放大（视觉审核用）

为什么需要它：`cdp-shot.mjs` 抓的是全屏 PNG（1802x1020），而「按钮在浅色底上还看得清吗」
「文字有没有被裁掉」这类判断在缩略图上**看不清**——肉眼在缩略图上误判过一次
（把浅底面板看成深色漏网，见锚点 §七 7.7 的教训）。本工具把某块区域裁剪并放大到
能被 Read 清楚渲染的尺寸，供并排比对。

坐标用 **CSS px**（和 CDP 断言里 getBoundingClientRect 的输出同一坐标系），
内部按 dpr 换算成 PNG 像素 —— 这样断言里的 rect 可以直接抄过来当参数。

用法:
  python scripts/crop-shot.py <in.png> <x> <y> <w> <h> <out.png> [scale] [dpr]
  # 例：把 rect [1361,648,63,30] 周围各留 60px 余量、放大 4 倍
  python scripts/crop-shot.py logs/a.png 1301 588 183 150 logs/a-zoom.png 4

缩放用 NEAREST —— 放大是为了看清像素边缘（有没有被裁、边框有没有断），
平滑插值会把缺陷糊掉。
"""
import sys

from PIL import Image

if len(sys.argv) < 7:
    print(__doc__)
    sys.exit(1)

src, out = sys.argv[1], sys.argv[6]
x, y, w, h = (int(float(v)) for v in sys.argv[2:6])
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 3.0
dpr = float(sys.argv[8]) if len(sys.argv) > 8 else 1.25

im = Image.open(src)
# CSS px -> PNG px，并夹到图像范围内（越界直接夹住，不抛错——审核工具不该因参数粗糙而中断）
box = (
    max(0, int(x * dpr)),
    max(0, int(y * dpr)),
    min(im.width, int((x + w) * dpr)),
    min(im.height, int((y + h) * dpr)),
)
if box[2] <= box[0] or box[3] <= box[1]:
    print("❌ 裁剪区域为空：box=%s，图尺寸=%s" % (box, im.size))
    sys.exit(2)

crop = im.crop(box)
crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.NEAREST)
crop.save(out)
print("已保存: %s  %dx%d  (源 box=%s，dpr=%s，放大 %sx)" % (out, crop.width, crop.height, box, dpr, scale))
