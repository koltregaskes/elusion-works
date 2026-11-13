"""Lumen Ward texture sets: tileable PBR maps generated in Blender's Python.

Run with the same headless Blender as the kit:

    python -I demos/lumen-ward/tools/build_textures.py demos/lumen-ward/assets/tex

Each set writes three 1024x1024 PNGs (converted to WebP afterwards):
  <name>_color.png  base colour (sRGB)
  <name>_orm.png    R ambient occlusion, G roughness, B metalness (linear)
  <name>_normal.png tangent-space normal, OpenGL convention (linear)

Everything is periodic (FFT noise, wrapped Voronoi, wrapped shapes), so the
maps tile without seams. Fixed seeds make the output deterministic.
"""

import os
import sys

import bpy
import numpy as np

OUT = sys.argv[-1] if not sys.argv[-1].endswith(".py") else "tex"
os.makedirs(OUT, exist_ok=True)
N = 1024
yy, xx = np.mgrid[0:N, 0:N] / N  # 0..1, row 0 = top


# --------------------------------------------------------------------------- noise
def fbm(seed, beta=1.8, lo=2, hi=None):
    """Tileable fractal noise in 0..1 from filtered white noise."""
    rng = np.random.default_rng(seed)
    w = rng.normal(size=(N, N))
    F = np.fft.fft2(w)
    k = np.fft.fftfreq(N) * N
    kx, ky = np.meshgrid(k, k)
    kk = np.sqrt(kx * kx + ky * ky)
    kk[0, 0] = 1
    filt = 1.0 / kk ** beta
    filt[kk < lo] = 0
    if hi:
        filt[kk > hi] = 0
    out = np.real(np.fft.ifft2(F * filt))
    out -= out.min()
    out /= out.max() + 1e-9
    return out


def voronoi(seed, count):
    """Wrapped Voronoi: returns (F1, F2-F1, cell id) on the grid."""
    rng = np.random.default_rng(seed)
    pts = rng.random((count, 2))
    offs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 0), (0, 1), (1, -1), (1, 0), (1, 1)]
    allp = np.concatenate([pts + o for o in offs])
    ids = np.tile(np.arange(count), 9)
    f1 = np.full((N, N), 9.0)
    f2 = np.full((N, N), 9.0)
    cid = np.zeros((N, N), dtype=np.int32)
    for i, p in enumerate(allp):
        d = np.sqrt((xx - p[0]) ** 2 + (yy - p[1]) ** 2)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        cid = np.where(closer, ids[i], cid)
        f1 = np.where(closer, d, f1)
    return f1, f2 - f1, cid


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength * N / 1024
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength * N / 1024
    # image row 0 is the top; +Y in tangent space points up the image
    n = np.dstack([-dx, dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def save(name, rgb, srgb):
    img = bpy.data.images.new(name, N, N, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    rgba = np.dstack([np.clip(rgb, 0, 1), np.ones((N, N))])
    # Blender images are stored bottom row first
    img.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())
    img.filepath_raw = os.path.join(OUT, name + ".png")
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    print("wrote", name)


def write_set(name, color, rough, metal, height, strength, ao=None):
    ao = np.ones((N, N)) if ao is None else ao
    save(name + "_color", color, True)
    save(name + "_orm", np.dstack([ao, rough, metal]), False)
    save(name + "_normal", normal_from_height(height, strength), False)


def lerp(a, b, t):
    return a + (b - a) * t


def tint(c, v):
    return np.dstack([v * c[0], v * c[1], v * c[2]])


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------- concrete
# 1 tile = 4 m. Precast panels 2 m wide, joints, pits, rain streaks.
def concrete():
    base = fbm(11, 1.6, 2)
    fine = fbm(12, 1.0, 40)
    pits_v = fbm(13, 0.6, 200)
    pits = smooth(0.72, 0.8, pits_v)
    # vertical rain streaks: noise stretched along y
    s = fbm(14, 1.0, 24)
    streak_src = np.repeat(s[::32, :], 32, axis=0)
    streak_src = np.mean([np.roll(streak_src, k * 7, 0) for k in range(12)], axis=0)
    streak_src = (streak_src - streak_src.min()) / (np.ptp(streak_src) + 1e-9)
    streaks = smooth(0.55, 0.85, streak_src) * smooth(0.3, 0.7, fbm(15, 2.0, 2)) + smooth(0.7, 0.95, streak_src) * 0.5
    jx = np.minimum(np.abs((xx * 2) % 1 - 0.0), np.abs((xx * 2) % 1 - 1.0))  # joints every 2 m
    jy = np.minimum(np.abs((yy * 4) % 1), np.abs((yy * 4) % 1 - 1.0))        # every 1 m
    joint = np.maximum(smooth(0.006, 0.0, jx), smooth(0.004, 0.0, jy) * 0.7)
    v = 0.36 + base * 0.12 + fine * 0.06 - streaks * 0.16 - pits * 0.08 - joint * 0.18
    color = tint((0.95, 0.94, 0.97), v)
    rough = np.clip(0.82 - streaks * 0.35 - base * 0.08 + pits * 0.1, 0.25, 1)
    height = fine * 0.3 + base * 0.4 - pits * 0.5 - joint * 1.2
    ao = 1 - joint * 0.5 - pits * 0.2
    write_set("concrete", color, rough, np.zeros((N, N)), height, 6.0, ao)


# --------------------------------------------------------------------------- metal cladding
# 1 tile = 4 m: panels 1 x 2 m with seams, rivets, scratches and grime.
def cladding():
    px = (xx * 4) % 1
    py = (yy * 2) % 1
    seam = np.maximum(smooth(0.012, 0.0, np.minimum(px, 1 - px)), smooth(0.008, 0.0, np.minimum(py, 1 - py)))
    # rivets near panel edges
    rx = np.minimum(px, 1 - px)
    ryc = (yy * 16) % 1
    rivet = smooth(0.012, 0.004, np.sqrt((rx - 0.04) ** 2 * 1 + ((ryc - 0.5) / 8) ** 2))
    panel_id = np.floor(xx * 4) + np.floor(yy * 2) * 4
    rng = np.random.default_rng(21)
    shade = rng.random(64)[(panel_id.astype(int)) % 64]
    grime = fbm(22, 1.5, 2)
    scratches = smooth(0.82, 0.9, fbm(23, 0.4, 150) * 0.5 + np.repeat(fbm(24, 1.2, 4)[::16, :], 16, 0) * 0.5)
    v = 0.18 + shade * 0.06 + grime * 0.05 - seam * 0.1 + scratches * 0.12
    color = np.dstack([v * 0.82, v * 0.88, v * 1.0])
    rough = np.clip(0.42 + grime * 0.3 - scratches * 0.15 + seam * 0.2, 0.15, 1)
    metal = np.clip(0.75 - grime * 0.3, 0, 1)
    height = -seam * 1.0 + rivet * 0.6 + fbm(25, 1.3, 2) * 0.15
    write_set("cladding", color, rough, metal, height, 5.0, 1 - seam * 0.6)


# --------------------------------------------------------------------------- asphalt
# 1 tile = 8 m. Aggregate, cracks, patches, oil stains.
def asphalt():
    agg = fbm(31, 0.3, 120)
    base = fbm(32, 1.7, 2)
    _, edge, cid = voronoi(33, 14)
    cracks = smooth(0.0028, 0.0, edge) * smooth(0.55, 0.7, fbm(34, 1.5, 2))
    rng = np.random.default_rng(35)
    patch_on = rng.random(14)[cid] > 0.7
    oil = smooth(0.62, 0.75, fbm(36, 1.9, 2))
    v = 0.09 + agg * 0.05 + base * 0.03 + patch_on * 0.025 - cracks * 0.06 - oil * 0.03
    color = tint((0.95, 0.95, 1.0), v)
    rough = np.clip(0.88 - oil * 0.3 + agg * 0.08, 0.2, 1)
    height = agg * 0.5 - cracks * 1.5 + patch_on * 0.15
    write_set("asphalt", color, rough, np.zeros((N, N)), height, 4.0, 1 - cracks * 0.5)


# --------------------------------------------------------------------------- pavement
# 1 tile = 4 m: 0.5 m slabs with grout, chips and tone variation.
def pavement():
    gx = (xx * 8) % 1
    gy = (yy * 8) % 1
    grout = np.maximum(smooth(0.03, 0.0, np.minimum(gx, 1 - gx)), smooth(0.03, 0.0, np.minimum(gy, 1 - gy)))
    tid = (np.floor(xx * 8) + np.floor(yy * 8) * 8).astype(int)
    rng = np.random.default_rng(41)
    tone = rng.random(64)[tid]
    fine = fbm(42, 0.8, 60)
    dirt = fbm(43, 1.6, 2)
    v = 0.24 + tone * 0.08 + fine * 0.05 - dirt * 0.08 - grout * 0.14
    color = tint((0.92, 0.93, 0.98), v)
    rough = np.clip(0.55 + fine * 0.15 + grout * 0.3 - dirt * 0.2, 0.15, 1)
    height = fine * 0.2 - grout * 1.0 + tone * 0.1
    write_set("pavement", color, rough, np.zeros((N, N)), height, 5.0, 1 - grout * 0.6)


# --------------------------------------------------------------------------- painted, rusting metal (props)
def rustmetal():
    paint = fbm(51, 1.4, 2)
    rust_mask = smooth(0.58, 0.7, paint * 0.7 + fbm(52, 0.9, 20) * 0.3)
    fine = fbm(53, 0.6, 100)
    paint_col = np.dstack([0.12 + fine * 0.02, 0.13 + fine * 0.02, 0.15 + fine * 0.02])
    rust_col = np.dstack([0.26 + fine * 0.1, 0.12 + fine * 0.04, 0.06 + fine * 0.02])
    m = rust_mask[..., None]
    color = paint_col * (1 - m) + rust_col * m
    rough = np.clip(0.45 + rust_mask * 0.45 + fine * 0.1, 0, 1)
    metal = np.clip(0.6 - rust_mask * 0.55, 0, 1)
    height = rust_mask * 0.4 + fine * 0.3
    write_set("rustmetal", color, rough, metal, height, 3.0)


# --------------------------------------------------------------------------- roof membrane
def roof():
    sx = (xx * 4) % 1
    seam = smooth(0.01, 0.0, np.minimum(sx, 1 - sx))
    blot = fbm(61, 1.7, 2)
    fine = fbm(62, 0.5, 80)
    puddle = smooth(0.62, 0.68, blot)
    v = 0.07 + fine * 0.04 + blot * 0.03 + seam * 0.05
    color = tint((1, 1, 1.05), v)
    rough = np.clip(0.8 - puddle * 0.7 + fine * 0.1, 0.05, 1)
    height = fine * 0.3 + seam * 0.8 - puddle * 0.2
    write_set("roof", color, rough, np.zeros((N, N)), height, 3.0)


for fn in (concrete, cladding, asphalt, pavement, rustmetal, roof):
    fn()
