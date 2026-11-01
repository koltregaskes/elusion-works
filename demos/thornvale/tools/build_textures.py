"""Thornvale texture sets: tileable PBR maps generated in Blender's Python.

    python -I demos/thornvale/tools/build_textures.py /tmp/tvtex

Each set writes <name>_color.png (sRGB), <name>_orm.png (R occlusion,
G roughness, B metalness) and <name>_normal.png (OpenGL convention), all
1024x1024 and tileable. leaves.png is an RGBA atlas of foliage cards.
Fixed seeds: the output is deterministic.
"""

import math
import os
import sys

import bpy
import numpy as np

OUT = sys.argv[-1] if not sys.argv[-1].endswith(".py") else "tex"
os.makedirs(OUT, exist_ok=True)
N = 1024
yy, xx = np.mgrid[0:N, 0:N] / N


def fbm(seed, beta=1.8, lo=2, hi=None):
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.normal(size=(N, N)))
    k = np.fft.fftfreq(N) * N
    kx, ky = np.meshgrid(k, k)
    kk = np.sqrt(kx * kx + ky * ky)
    kk[0, 0] = 1
    f = 1.0 / kk ** beta
    f[kk < lo] = 0
    if hi:
        f[kk > hi] = 0
    o = np.real(np.fft.ifft2(F * f))
    o -= o.min()
    return o / (o.max() + 1e-9)


def stretched(seed, beta, lo, sx=1, sy=8):
    """Noise stretched along one axis (wood grain, streaks)."""
    base = fbm(seed, beta, lo)
    out = np.repeat(np.repeat(base[::sy, ::sx], sy, 0), sx, 1)[:N, :N]
    return np.mean([np.roll(out, k * 3, 0) for k in range(sy)], axis=0)


def voronoi(seed, count, jitter=1.0):
    rng = np.random.default_rng(seed)
    pts = rng.random((count, 2))
    offs = [(a, b) for a in (-1, 0, 1) for b in (-1, 0, 1)]
    allp = np.concatenate([pts + o for o in offs])
    ids = np.tile(np.arange(count), 9)
    f1 = np.full((N, N), 9.0)
    f2 = np.full((N, N), 9.0)
    cid = np.zeros((N, N), dtype=np.int32)
    for i, p in enumerate(allp):
        d = np.sqrt((xx - p[0]) ** 2 + (yy - p[1]) ** 2)
        c = d < f1
        f2 = np.where(c, f1, np.minimum(f2, d))
        cid = np.where(c, ids[i], cid)
        f1 = np.where(c, d, f1)
    return f1, f2 - f1, cid


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.dstack([-dx, dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def save(name, rgb, srgb, alpha=None):
    img = bpy.data.images.new(name, N, N, alpha=alpha is not None, float_buffer=False)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    a = np.ones((N, N)) if alpha is None else alpha
    rgba = np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)])
    img.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())
    img.filepath_raw = os.path.join(OUT, name + ".png")
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    print("wrote", name)


def write_set(name, color, rough, height, strength, ao=None, metal=None):
    ao = np.ones((N, N)) if ao is None else ao
    metal = np.zeros((N, N)) if metal is None else metal
    save(name + "_color", color, True)
    save(name + "_orm", np.dstack([ao, rough, metal]), False)
    save(name + "_normal", normal_from_height(height, strength), False)


def col(c, v):
    return np.dstack([v * c[0], v * c[1], v * c[2]])


def mix3(a, b, t):
    t = t[..., None]
    return a * (1 - t) + b * t


# ----------------------------------------------------------------------------- ashlar
def ashlar():
    """Coursed limestone blocks, 1 tile = 3 m. Rows of varying height."""
    rng = np.random.default_rng(101)
    heights = []
    while sum(heights) < 1.0:
        heights.append(rng.choice([0.09, 0.11, 0.13, 0.15]))
    heights = np.array(heights) / sum(heights)
    edges_y = np.concatenate([[0], np.cumsum(heights)])
    row = np.searchsorted(edges_y, yy, side="right") - 1
    row = np.clip(row, 0, len(heights) - 1)
    ry0 = edges_y[row]
    ry1 = edges_y[row + 1]
    # blocks per row with random widths
    block_id = np.zeros((N, N), dtype=np.int64)
    bx0 = np.zeros((N, N))
    bx1 = np.zeros((N, N))
    for r in range(len(heights)):
        ws = []
        while sum(ws) < 1.0:
            ws.append(rng.uniform(0.12, 0.28))
        ws = np.array(ws) / sum(ws)
        off = rng.random()
        ex = np.concatenate([[0], np.cumsum(ws)])
        m = row == r
        xs = (xx[m] + off) % 1.0
        bi = np.clip(np.searchsorted(ex, xs, side="right") - 1, 0, len(ws) - 1)
        block_id[m] = r * 100 + bi
        bx0[m] = ex[bi]
        bx1[m] = ex[bi + 1]
        xx_m = xs
        bx0[m] = xx_m - ex[bi]
        bx1[m] = ex[bi + 1] - xx_m
    dy = np.minimum(yy - ry0, ry1 - yy)
    dx = np.minimum(bx0, bx1)
    chip = fbm(102, 1.2, 8) * 0.004
    d = np.minimum(dx, dy) - chip
    mortar = smooth(0.0045, 0.0015, d)
    bevel = smooth(0.012, 0.0, d)
    tone = np.random.default_rng(103).random(10000)[block_id % 10000]
    grain = fbm(104, 1.0, 30)
    weather = fbm(105, 1.7, 2)
    face = fbm(106, 1.4, 6)
    v = 0.58 + tone * 0.16 + grain * 0.08 - weather * 0.12 - face * 0.06
    stone = col((0.93, 0.88, 0.79), v)
    mort = col((0.75, 0.72, 0.66), np.full((N, N), 0.55)) * (0.8 + 0.2 * grain[..., None])
    color = mix3(stone, mort, mortar)
    rough = np.clip(0.78 + grain * 0.12 + mortar * 0.08 - weather * 0.08, 0, 1)
    height = face * 0.25 + grain * 0.2 - bevel * 0.8 - mortar * 0.6
    ao = 1 - mortar * 0.55 - bevel * 0.2
    write_set("ashlar", color, rough, height, 7.0, ao)


def rubble():
    """Random rubble stone wall with deep mortar, 1 tile = 2 m."""
    f1, edge, cid = voronoi(201, 70)
    rng = np.random.default_rng(202)
    tone = rng.random(70)[cid]
    hue = rng.random(70)[cid]
    grain = fbm(203, 0.9, 40)
    stone_h = smooth(0.0, 0.03, edge) ** 0.6
    mortar = smooth(0.012, 0.002, edge)
    base = mix3(col((0.62, 0.58, 0.52), np.ones((N, N))), col((0.55, 0.52, 0.5), np.ones((N, N))), hue)
    v = 0.75 + tone * 0.3 + grain * 0.12
    color = base * v[..., None]
    color = mix3(color, col((0.42, 0.4, 0.36), np.ones((N, N))), mortar)
    rough = np.clip(0.82 + grain * 0.1, 0, 1)
    height = stone_h * 0.9 + grain * 0.15 - mortar * 0.3
    write_set("rubble", color, rough, height, 6.0, 1 - mortar * 0.6)


def plaster():
    """Lime plaster: warm white, patchy, hairline cracks, 1 tile = 3 m."""
    base = fbm(301, 1.8, 2)
    fine = fbm(302, 0.8, 50)
    stain = smooth(0.55, 0.85, fbm(303, 1.6, 3))
    _, edge, _ = voronoi(304, 18)
    cracks = smooth(0.0016, 0.0, edge) * smooth(0.6, 0.75, fbm(305, 1.4, 3))
    v = 0.86 + base * 0.08 + fine * 0.04 - stain * 0.12 - cracks * 0.25
    color = col((0.97, 0.93, 0.85), v)
    color = mix3(color, col((0.7, 0.66, 0.58), np.ones((N, N))), stain * 0.35)
    rough = np.clip(0.9 + fine * 0.06, 0, 1)
    height = fine * 0.3 + base * 0.3 - cracks * 1.2
    write_set("plaster", color, rough, height, 3.0, 1 - cracks * 0.4)


def timber():
    """Weathered dark oak beams, grain along V, 1 tile = 1 m."""
    grain = stretched(401, 1.0, 6, 1, 16)
    fine = stretched(402, 0.6, 40, 1, 8)
    knots = smooth(0.82, 0.9, fbm(403, 1.2, 10))
    v = 0.22 + grain * 0.12 + fine * 0.06 - knots * 0.08
    color = col((0.62, 0.44, 0.3), v)
    rough = np.clip(0.72 + fine * 0.2, 0, 1)
    height = grain * 0.5 + fine * 0.4 - knots * 0.3
    write_set("timber", color, rough, height, 5.0)


def roof_clay():
    """Overlapping clay pantiles, 1 tile = 2 m: 10 rows, tiles 0.2 m wide."""
    rows = 10
    cols_ = 10
    ry = (yy * rows) % 1.0
    rowi = np.floor(yy * rows)
    off = (rowi % 2) * 0.5
    cx = (xx * cols_ + off) % 1.0
    tid = (np.floor(xx * cols_ + off) % cols_ + rowi * cols_).astype(int)
    rng = np.random.default_rng(501)
    tone = rng.random(cols_ * rows)[tid]
    hue = rng.random(cols_ * rows)[tid]
    curve = np.sin(cx * math.pi)  # rounded across the tile
    overlap = smooth(0.0, 0.18, ry)  # lower edge of the row above casts a lip
    lip = smooth(0.12, 0.0, ry)
    lichen = smooth(0.7, 0.82, fbm(502, 1.3, 6)) * 0.6
    grain = fbm(503, 0.9, 40)
    terracotta = mix3(col((0.72, 0.36, 0.2), np.ones((N, N))), col((0.6, 0.3, 0.18), np.ones((N, N))), hue)
    v = 0.8 + tone * 0.35 + grain * 0.1
    color = terracotta * v[..., None] * (0.55 + 0.45 * overlap)[..., None]
    color = mix3(color, col((0.55, 0.55, 0.4), np.ones((N, N))), lichen)
    rough = np.clip(0.7 + grain * 0.15 + lichen * 0.1, 0, 1)
    height = curve * 0.55 + ry * 0.45 - lip * 0.6 + grain * 0.08
    ao = 0.55 + 0.45 * overlap * (0.6 + 0.4 * curve)
    write_set("roofclay", color, rough, height, 9.0, ao)


def roof_slate():
    """Natural slate, staggered rectangles, 1 tile = 2 m."""
    rows = 16
    cols_ = 8
    ry = (yy * rows) % 1.0
    rowi = np.floor(yy * rows)
    off = (rowi % 2) * 0.5
    cx = (xx * cols_ + off) % 1.0
    tid = (np.floor(xx * cols_ + off) % cols_ + rowi * cols_).astype(int)
    rng = np.random.default_rng(601)
    tone = rng.random(cols_ * rows)[tid]
    gap = smooth(0.03, 0.0, np.minimum(cx, 1 - cx))
    lip = smooth(0.1, 0.0, ry)
    grain = stretched(602, 0.8, 30, 4, 1)
    v = 0.22 + tone * 0.08 + grain * 0.05
    color = col((0.78, 0.82, 0.92), v)
    color *= (0.7 + 0.3 * smooth(0.0, 0.25, ry))[..., None]
    rough = np.clip(0.55 + grain * 0.2 + tone * 0.1, 0, 1)
    height = ry * 0.5 - lip * 0.6 - gap * 0.5 + grain * 0.1
    write_set("roofslate", color, rough, height, 8.0, 1 - gap * 0.5 - lip * 0.3)


def cobbles():
    """Rounded setts with dark joints, 1 tile = 2 m."""
    f1, edge, cid = voronoi(701, 150)
    rng = np.random.default_rng(702)
    tone = rng.random(150)[cid]
    dome = smooth(0.0, 0.025, edge) ** 0.5
    joint = smooth(0.006, 0.0, edge)
    grain = fbm(703, 0.8, 40)
    dirt = fbm(704, 1.6, 2)
    v = 0.48 + tone * 0.22 + grain * 0.08 - dirt * 0.1
    color = col((0.85, 0.82, 0.76), v)
    color = mix3(color, col((0.25, 0.23, 0.2), np.ones((N, N))), joint)
    rough = np.clip(0.6 + grain * 0.2 - dome * 0.15 + joint * 0.2, 0, 1)
    height = dome * 0.9 + grain * 0.1 - joint * 0.4
    write_set("cobbles", color, rough, height, 7.0, 1 - joint * 0.6)


def flagstone():
    """Large limestone flags in staggered courses, 1 tile = 4 m."""
    rng = np.random.default_rng(801)
    rows = 6
    ry = (yy * rows) % 1.0
    rowi = np.floor(yy * rows).astype(int)
    fid = np.zeros((N, N), dtype=np.int64)
    dxm = np.zeros((N, N))
    for r in range(rows):
        ws = []
        while sum(ws) < 1:
            ws.append(rng.uniform(0.12, 0.3))
        ws = np.array(ws) / sum(ws)
        ex = np.concatenate([[0], np.cumsum(ws)])
        off = rng.random()
        m = rowi == r
        xs = (xx[m] + off) % 1.0
        bi = np.clip(np.searchsorted(ex, xs, side="right") - 1, 0, len(ws) - 1)
        fid[m] = r * 50 + bi
        dxm[m] = np.minimum(xs - ex[bi], ex[bi + 1] - xs) * 6
    d = np.minimum(dxm, np.minimum(ry, 1 - ry)) / 6
    joint = smooth(0.0035, 0.0008, d)
    tone = rng.random(400)[fid % 400]
    grain = fbm(802, 0.9, 30)
    worn = fbm(803, 1.5, 3)
    v = 0.66 + tone * 0.14 + grain * 0.07 - worn * 0.08
    color = col((0.93, 0.9, 0.83), v)
    color = mix3(color, col((0.4, 0.38, 0.34), np.ones((N, N))), joint)
    rough = np.clip(0.62 + grain * 0.18 - worn * 0.1, 0, 1)
    height = grain * 0.3 + worn * 0.3 - joint * 0.8
    write_set("flagstone", color, rough, height, 5.0, 1 - joint * 0.5)


def grass_ground():
    """Meadow ground seen from above: grass, clover, dry patches. 1 tile = 4 m."""
    blades = stretched(901, 0.3, 120, 1, 3)
    fine = fbm(902, 0.5, 80)
    patches = fbm(903, 1.7, 2)
    dry = smooth(0.55, 0.75, patches)
    green = col((0.24, 0.36, 0.1), np.ones((N, N)))
    straw = col((0.55, 0.48, 0.24), np.ones((N, N)))
    c = mix3(green, straw, dry * 0.8)
    c *= (0.7 + blades * 0.45 + fine * 0.15)[..., None]
    rough = np.clip(0.85 + fine * 0.1, 0, 1)
    height = blades * 0.6 + fine * 0.3
    write_set("grass", c, rough, height, 3.0)


def dirt():
    """Packed earth path with pebbles, 1 tile = 3 m."""
    f1, edge, cid = voronoi(1001, 220)
    pebble = smooth(0.012, 0.004, f1) * (np.random.default_rng(1002).random(220)[cid] > 0.55)
    base = fbm(1003, 1.6, 2)
    fine = fbm(1004, 0.7, 60)
    c = col((0.5, 0.4, 0.28), 0.62 + base * 0.2 + fine * 0.15)
    c = mix3(c, col((0.62, 0.6, 0.55), np.ones((N, N))), pebble)
    rough = np.clip(0.88 - pebble * 0.2, 0, 1)
    height = fine * 0.3 + base * 0.2 + pebble * 0.8
    write_set("dirt", c, rough, height, 4.0)


def rock():
    """Stratified mountain rock with cracks, 1 tile = 8 m."""
    strata = stretched(1101, 1.2, 4, 12, 1)
    _, edge, _ = voronoi(1102, 25)
    cracks = smooth(0.004, 0.0, edge)
    base = fbm(1103, 1.5, 2)
    fine = fbm(1104, 0.8, 50)
    v = 0.45 + strata * 0.18 + base * 0.12 + fine * 0.08 - cracks * 0.25
    c = col((0.62, 0.6, 0.58), v)
    rough = np.clip(0.8 + fine * 0.15, 0, 1)
    height = strata * 0.6 + base * 0.4 + fine * 0.2 - cracks
    write_set("rock", c, rough, height, 6.0, 1 - cracks * 0.5)


def bark():
    """Oak-ish bark with vertical fissures, 1 tile = 1 m."""
    ridges = stretched(1201, 1.0, 10, 1, 24)
    fiss = smooth(0.35, 0.15, ridges)
    fine = fbm(1202, 0.8, 50)
    c = col((0.42, 0.34, 0.27), 0.5 + ridges * 0.4 + fine * 0.15)
    rough = np.clip(0.9 - ridges * 0.1, 0, 1)
    height = ridges + fine * 0.2
    write_set("bark", c, rough, height, 8.0, 1 - fiss * 0.6)


def planks():
    """Vertical planks for doors and shutters, 1 tile = 2 m."""
    pw = 8
    px = (xx * pw) % 1.0
    pid = np.floor(xx * pw).astype(int)
    gap = smooth(0.04, 0.0, np.minimum(px, 1 - px))
    grain = stretched(1301, 0.9, 8, 1, 16)
    tone = np.random.default_rng(1302).random(pw)[pid]
    c = col((0.5, 0.34, 0.2), 0.42 + grain * 0.2 + tone * 0.12)
    rough = np.clip(0.75 + grain * 0.15, 0, 1)
    height = grain * 0.4 - gap
    write_set("planks", c, rough, height, 5.0, 1 - gap * 0.6)


# ----------------------------------------------------------------------------- foliage atlas
def leaves():
    """RGBA atlas, 2x2 cells of 512px:
    (0,0) green broadleaf cluster, (1,0) autumn orange, (0,1) golden yellow,
    (1,1) fir branch. Alpha-tested in the browser."""
    H = N // 2
    rgb = np.zeros((N, N, 3))
    alpha = np.zeros((N, N))
    rng = np.random.default_rng(1401)
    gy, gx = np.mgrid[0:H, 0:H] / H

    def leaf_cluster(cx0, cy0, palette, count=170):
        for _ in range(count):
            # leaves distributed in a rough disc, pointing outward
            r = math.sqrt(rng.random()) * 0.42
            a = rng.random() * 2 * math.pi
            px, py = 0.5 + math.cos(a) * r, 0.5 + math.sin(a) * r
            ang = a + rng.uniform(-0.6, 0.6)
            L = rng.uniform(0.05, 0.085)
            W = L * rng.uniform(0.38, 0.5)
            ca, sa = math.cos(ang), math.sin(ang)
            x0, x1 = max(0, int((px - L) * H)), min(H, int((px + L) * H) + 1)
            y0, y1 = max(0, int((py - L) * H)), min(H, int((py + L) * H) + 1)
            if x1 <= x0 or y1 <= y0:
                continue
            sx = gx[y0:y1, x0:x1] - px
            sy = gy[y0:y1, x0:x1] - py
            u = sx * ca + sy * sa
            v = -sx * sa + sy * ca
            t = np.clip((u / L + 1) / 2, 0, 1)
            width = W * np.sin(t * math.pi) ** 0.8
            inside = (np.abs(v) < width) & (np.abs(u) < L)
            vein = np.exp(-(v / (W * 0.08 + 1e-6)) ** 2) * 0.25
            base = np.array(palette[rng.integers(len(palette))]) * rng.uniform(0.75, 1.15)
            shade = (0.75 + 0.25 * (1 - np.abs(v) / (width + 1e-6)))[..., None]
            c = np.clip(base * shade + vein[..., None] * 0.15, 0, 1)
            sub_rgb = rgb[cy0 + y0:cy0 + y1, cx0 + x0:cx0 + x1]
            sub_a = alpha[cy0 + y0:cy0 + y1, cx0 + x0:cx0 + x1]
            sub_rgb[inside] = c[inside]
            sub_a[inside] = 1.0
        # twigs
        for _ in range(14):
            a = rng.random() * 2 * math.pi
            for s in np.linspace(0, 0.38, 60):
                x = int((0.5 + math.cos(a) * s) * H)
                y = int((0.5 + math.sin(a) * s) * H)
                if 0 <= x < H - 1 and 0 <= y < H - 1 and alpha[cy0 + y, cx0 + x] < 0.5:
                    rgb[cy0 + y:cy0 + y + 2, cx0 + x:cx0 + x + 2] = (0.25, 0.18, 0.12)
                    alpha[cy0 + y:cy0 + y + 2, cx0 + x:cx0 + x + 2] = 1.0

    leaf_cluster(0, 0, [(0.22, 0.38, 0.1), (0.28, 0.45, 0.12), (0.18, 0.32, 0.08), (0.33, 0.48, 0.15)])
    leaf_cluster(H, 0, [(0.85, 0.38, 0.06), (0.78, 0.25, 0.05), (0.9, 0.5, 0.1), (0.6, 0.2, 0.06)])
    leaf_cluster(0, H, [(0.92, 0.72, 0.12), (0.85, 0.62, 0.08), (0.95, 0.8, 0.25), (0.7, 0.55, 0.1)])
    # fir branch: central twig with dense needles
    for b in range(5):
        by = 0.12 + b * 0.18
        for s in np.linspace(0.05, 0.95, 220):
            x = s
            y = by + (s - 0.5) * 0.08
            for side in (-1, 1):
                ln = 0.06 * (1 - abs(s - 0.5))
                for k in np.linspace(0, ln, 8):
                    nx = int((x + k * 0.3) * H)
                    ny = int((y + side * k) * H)
                    if 0 <= nx < H and 0 <= ny < H:
                        rgb[H + ny, H + nx] = (0.1, 0.22 + rng.random() * 0.08, 0.1)
                        alpha[H + ny, H + nx] = 1.0
    # widen fir needles a pixel
    a2 = alpha[H:, H:]
    grown = np.maximum.reduce([a2, np.roll(a2, 1, 0), np.roll(a2, 1, 1)])
    rgb[H:, H:] = np.where(grown[..., None] > a2[..., None], np.roll(rgb[H:, H:], 1, 0), rgb[H:, H:])
    alpha[H:, H:] = grown
    # dilate colour into transparent texels so mipmaps don't bleed dark edges
    filled = rgb.copy()
    mask = alpha > 0.5
    for _ in range(6):
        nb = [np.roll(filled, s, a) for s in (1, -1) for a in (0, 1)]
        nm = [np.roll(mask, s, a) for s in (1, -1) for a in (0, 1)]
        acc = sum(c * m[..., None] for c, m in zip(nb, nm))
        cnt = sum(m.astype(float) for m in nm)
        grow = (~mask) & (cnt > 0)
        filled[grow] = (acc[grow] / cnt[grow][:, None])
        mask = mask | grow
    save("leaves", filled, True, alpha)


for fn in (ashlar, rubble, plaster, timber, roof_clay, roof_slate, cobbles, flagstone, grass_ground, dirt, rock, bark, planks, leaves):
    fn()
