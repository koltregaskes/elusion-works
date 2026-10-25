# sharp.py prefixA prefixB : contrast-free sharpness (Laplacian var / luma var) away from the blast
import sys, json
import numpy as np
from PIL import Image
def sharp(f, box):
    a = np.asarray(Image.open(f).convert('L'), dtype=np.float64)
    H, W = a.shape
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    m = ((xx - cx) ** 2 + (yy - cy) ** 2 > (0.5 * H) ** 2)
    m[:16, :] = m[-16:, :] = False; m[:, :16] = m[:, -16:] = False
    lap = (-4 * a[1:-1, 1:-1] + a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:])
    mm = m[1:-1, 1:-1]
    return lap[mm].var() / max(1e-9, a[1:-1, 1:-1][mm].var())
for p in sys.argv[1:]:
    d = json.load(open(p + '.json')); box = d['pre']['hullBox']
    tags = ['00-prehit', 'k00', 'k06', 'k09', 'k13', 'plus0.3s', 'plus1s', 'plus1.5s', 'plus3s']
    print(p.split('/')[-1], ' '.join(f"{t}:{sharp(f'{p}-{t}.png', box):.4f}" for t in tags))
