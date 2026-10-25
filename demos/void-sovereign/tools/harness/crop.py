# crop.py out.png scale x0 y0 x1 y1 in1 [in2 ...] : side-by-side crops, labelled
import sys
from PIL import Image, ImageDraw
out, sc = sys.argv[1], float(sys.argv[2]); box = tuple(int(v) for v in sys.argv[3:7]); ins = sys.argv[7:]
tiles = []
for f in ins:
    im = Image.open(f).convert('RGB').crop(box)
    im = im.resize((int(im.width * sc), int(im.height * sc)), Image.NEAREST)
    d = ImageDraw.Draw(im); d.rectangle([0, 0, 420, 18], fill=(0, 0, 0)); d.text((4, 3), f.split('/')[-1], fill=(255, 255, 255))
    tiles.append(im)
W = sum(t.width for t in tiles) + 6 * (len(tiles) - 1); H = max(t.height for t in tiles)
o = Image.new('RGB', (W, H), (40, 40, 40)); x = 0
for t in tiles: o.paste(t, (x, 0)); x += t.width + 6
o.save(out)
