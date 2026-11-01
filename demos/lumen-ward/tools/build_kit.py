"""Lumen Ward asset kit, modelled in Blender.

Run with headless Blender (the `bpy` module from PyPI works, no install of the
Blender app is needed):

    python -I demos/lumen-ward/tools/build_kit.py demos/lumen-ward/assets/lumen-ward-kit.glb

Every asset in the district is built here: towers, rooftop clutter, street
props, sign and billboard frames, the elevated rail, the train, hover cars and
the plaza hologram. The script is deterministic (fixed seeds), so the same
input always gives the same .glb.

Conventions
- Blender is Z-up; the glTF exporter converts to Y-up, so Blender -Y becomes
  three.js +Z.
- One object per kit item, origin on the ground at the footprint centre.
- Materials are matched by name in the browser. A few are placeholders the
  browser swaps for its own shaders: Facade, FacadeGlass (procedural lit
  windows), SignFace (text atlas), Screen (animated adverts), Hologram.
- Object names starting `tower_` are buildings; their footprint is read from
  the bounding box at load time.
"""

import math
import random
import sys

import bpy
from mathutils import Matrix, Vector

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else "lumen-ward-kit.glb"

# --------------------------------------------------------------------------
# Scene reset
# --------------------------------------------------------------------------
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for me in list(bpy.data.meshes):
    bpy.data.meshes.remove(me)
for ma in list(bpy.data.materials):
    bpy.data.materials.remove(ma)
COL = bpy.context.scene.collection

# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------
MATS = {}


def make_mat(name, col, metal=0.0, rough=0.6, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*col, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    MATS[name] = m
    return m


make_mat("Facade", (0.055, 0.058, 0.07), 0.2, 0.62)
make_mat("FacadeGlass", (0.03, 0.04, 0.055), 0.6, 0.25)
make_mat("Concrete", (0.11, 0.11, 0.12), 0.0, 0.88)
make_mat("ConcreteDark", (0.06, 0.06, 0.068), 0.0, 0.9)
make_mat("MetalDark", (0.05, 0.055, 0.065), 0.85, 0.42)
make_mat("Trim", (0.22, 0.23, 0.25), 0.9, 0.35)
make_mat("Rust", (0.16, 0.08, 0.045), 0.35, 0.78)
make_mat("Glass", (0.015, 0.02, 0.03), 0.5, 0.08)
make_mat("ShopLit", (0.3, 0.2, 0.12), 0.0, 0.5, (1.0, 0.6, 0.3), 0.8)
make_mat("ShopCool", (0.15, 0.2, 0.25), 0.0, 0.5, (0.4, 0.8, 1.0), 0.75)
make_mat("Awning", (0.28, 0.035, 0.07), 0.0, 0.92)
make_mat("AwningB", (0.03, 0.12, 0.16), 0.0, 0.92)
make_mat("Rubber", (0.02, 0.02, 0.022), 0.0, 0.7)
make_mat("Plant", (0.02, 0.06, 0.04), 0.0, 0.8)
NEONS = {
    "NeonPink": (1.0, 0.08, 0.5),
    "NeonCyan": (0.05, 0.85, 1.0),
    "NeonAmber": (1.0, 0.5, 0.08),
    "NeonViolet": (0.5, 0.18, 1.0),
    "NeonGreen": (0.15, 1.0, 0.45),
}
for k, c in NEONS.items():
    make_mat(k, (c[0] * 0.2, c[1] * 0.2, c[2] * 0.2), 0.0, 0.4, c, 5.0)
make_mat("LampWarm", (0.4, 0.3, 0.2), 0.0, 0.4, (1.0, 0.78, 0.5), 9.0)
make_mat("LampCold", (0.3, 0.35, 0.4), 0.0, 0.4, (0.7, 0.9, 1.0), 9.0)
make_mat("Beacon", (0.3, 0.0, 0.0), 0.0, 0.4, (1.0, 0.04, 0.04), 12.0)
make_mat("HeadLight", (0.5, 0.5, 0.5), 0.0, 0.3, (1.0, 0.95, 0.85), 12.0)
make_mat("TailLight", (0.3, 0.0, 0.0), 0.0, 0.3, (1.0, 0.03, 0.08), 9.0)
make_mat("GlowLeaf", (0.02, 0.2, 0.18), 0.0, 0.6, (0.1, 1.0, 0.75), 2.2)
make_mat("SignFace", (1, 1, 1), 0.0, 1.0)
make_mat("Screen", (0.02, 0.02, 0.02), 0.0, 0.3)
make_mat("Hologram", (0.2, 0.9, 1.0), 0.0, 0.3, (0.2, 0.9, 1.0), 3.0)
make_mat("CarBody", (0.07, 0.075, 0.09), 0.9, 0.28)
make_mat("CarBodyB", (0.22, 0.2, 0.17), 0.7, 0.4)
make_mat("CarBodyC", (0.35, 0.04, 0.06), 0.8, 0.3)
make_mat("Canopy", (0.01, 0.015, 0.02), 0.6, 0.05)
make_mat("TrainBody", (0.6, 0.62, 0.66), 0.9, 0.3)
make_mat("Stripe", (0.9, 0.85, 0.1), 0.0, 0.6)


# --------------------------------------------------------------------------
# Mesh builder
# --------------------------------------------------------------------------
class MB:
    """Collects verts and faces for one object, then makes a Blender mesh."""

    def __init__(self):
        self.v, self.f, self.m, self.uv, self.sm = [], [], [], [], []
        self.mats = []

    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def vert(self, p, M=None):
        p = Vector(p)
        if M is not None:
            p = M @ p
        self.v.append(p)
        return len(self.v) - 1

    def face(self, idx, mat, uvs=None, smooth=False):
        self.f.append(tuple(idx))
        self.m.append(self._mi(mat))
        self.uv.append(uvs)
        self.sm.append(smooth)

    # Axis-aligned box from min corner to max corner (optionally transformed).
    def box(self, x0, y0, z0, x1, y1, z1, mat, M=None, sides=None, top=True, bottom=False):
        P = [
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
        ]
        i = [self.vert(p, M) for p in P]
        sides = sides or {}
        quads = {
            "-z": (0, 3, 2, 1), "+z": (4, 5, 6, 7),
            "-y": (0, 1, 5, 4), "+y": (2, 3, 7, 6),
            "-x": (3, 0, 4, 7), "+x": (1, 2, 6, 5),
        }
        for key, q in quads.items():
            if key == "+z" and not top:
                continue
            if key == "-z" and not bottom:
                continue
            self.face([i[k] for k in q], sides.get(key, mat), [(0, 0), (1, 0), (1, 1), (0, 1)])

    def cbox(self, cx, cy, cz, sx, sy, sz, mat, **kw):
        self.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, mat, **kw)

    # Prism/cylinder/cone along local Z from z0 to z1.
    def prism(self, cx, cy, z0, z1, r, n, mat, M=None, r2=None, top=True, bottom=False,
              smooth=True, rot=0.0, cap_mat=None):
        r2 = r if r2 is None else r2
        b, t = [], []
        for k in range(n):
            a = rot + 2 * math.pi * k / n
            b.append(self.vert((cx + r * math.cos(a), cy + r * math.sin(a), z0), M))
            t.append(self.vert((cx + r2 * math.cos(a), cy + r2 * math.sin(a), z1), M))
        for k in range(n):
            k2 = (k + 1) % n
            self.face((b[k], b[k2], t[k2], t[k]), mat, [(k / n, 0), ((k + 1) / n, 0), ((k + 1) / n, 1), (k / n, 1)], smooth)
        if top and r2 > 0.001:
            self.face(t, cap_mat or mat)
        if bottom:
            self.face(list(reversed(b)), cap_mat or mat)

    def sphere(self, cx, cy, cz, r, mat, seg=10, rings=6, sz=1.0, M=None):
        rows = []
        for j in range(rings + 1):
            th = math.pi * j / rings
            row = []
            for k in range(seg):
                a = 2 * math.pi * k / seg
                row.append(self.vert((cx + r * math.sin(th) * math.cos(a),
                                      cy + r * math.sin(th) * math.sin(a),
                                      cz + r * sz * math.cos(th)), M))
            rows.append(row)
        for j in range(rings):
            for k in range(seg):
                k2 = (k + 1) % seg
                self.face((rows[j][k], rows[j + 1][k], rows[j + 1][k2], rows[j][k2]), mat, None, True)

    # Pipe between two points.
    def pipe(self, p0, p1, r, mat, n=6):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        M = Matrix.Translation(p0) @ q.to_matrix().to_4x4()
        self.prism(0, 0, 0, L, r, n, mat, M=M, top=False)

    # Flat quad with explicit UVs (sign faces, screens).
    def quad(self, p0, p1, p2, p3, mat, uvs=((0, 0), (1, 0), (1, 1), (0, 1))):
        i = [self.vert(p) for p in (p0, p1, p2, p3)]
        self.face(i, mat, list(uvs))

    def build(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.v], [], self.f)
        assert len(me.polygons) == len(self.f), name
        for mn in self.mats:
            me.materials.append(MATS[mn])
        me.polygons.foreach_set("material_index", self.m)
        me.polygons.foreach_set("use_smooth", [bool(s) for s in self.sm])
        uvl = me.uv_layers.new(name="UVMap")
        for poly, uvs in zip(me.polygons, self.uv):
            for k, li in enumerate(poly.loop_indices):
                uvl.data[li].uv = uvs[k] if uvs else (0.0, 0.0)
        me.update()
        ob = bpy.data.objects.new(name, me)
        COL.objects.link(ob)
        return ob


# --------------------------------------------------------------------------
# Building parts
# --------------------------------------------------------------------------
def ac_unit(mb, x, y, z, nx, ny):
    """Wall air-con unit hanging off a facade facing (nx, ny)."""
    d = 0.7
    cx, cy = x + nx * d / 2, y + ny * d / 2
    sx = 1.0 if nx == 0 else d
    sy = 1.0 if ny == 0 else d
    mb.cbox(cx, cy, z, sx, sy, 0.7, "MetalDark", bottom=True)
    # fan grille
    fx, fy = x + nx * (d + 0.01), y + ny * (d + 0.01)
    if nx != 0:
        M = Matrix.Translation((fx, fy, z)) @ Matrix.Rotation(math.pi / 2 * nx, 4, "Y")
    else:
        M = Matrix.Translation((fx, fy, z)) @ Matrix.Rotation(-math.pi / 2 * ny, 4, "X")
    mb.prism(0, 0, 0, 0.02, 0.26, 8, "Rubber", M=M)


def roof_clutter(mb, x0, y0, x1, y1, z, rng, neon, tall=False):
    w, d = x1 - x0, y1 - y0
    # parapet
    t, ph = 0.35, 1.1
    mb.box(x0, y0, z, x1, y0 + t, z + ph, "Concrete")
    mb.box(x0, y1 - t, z, x1, y1, z + ph, "Concrete")
    mb.box(x0, y0 + t, z, x0 + t, y1 - t, z + ph, "Concrete")
    mb.box(x1 - t, y0 + t, z, x1, y1 - t, z + ph, "Concrete")
    # roof slab (darker)
    mb.box(x0 + t, y0 + t, z, x1 - t, y1 - t, z + 0.08, "ConcreteDark")
    # AC / plant boxes
    for _ in range(rng.randint(1, 3) if w * d > 120 else 1):
        bw, bd = rng.uniform(1.6, 3.4), rng.uniform(1.4, 2.6)
        cx = rng.uniform(x0 + 1 + bw / 2, max(x0 + 1 + bw / 2, x1 - 1 - bw / 2))
        cy = rng.uniform(y0 + 1 + bd / 2, max(y0 + 1 + bd / 2, y1 - 1 - bd / 2))
        mb.cbox(cx, cy, z + 0.75, bw, bd, 1.5, "MetalDark")
        mb.prism(cx, cy, z + 1.5, z + 1.62, min(bw, bd) * 0.3, 10, "Rubber")
    # water tank on legs
    if w * d > 150 and rng.random() < 0.7:
        r = rng.uniform(1.2, 1.8)
        cx = rng.uniform(x0 + r + 1, x1 - r - 1)
        cy = rng.uniform(y0 + r + 1, y1 - r - 1)
        for a in range(4):
            ang = a * math.pi / 2 + math.pi / 4
            mb.box(cx + math.cos(ang) * r * 0.7 - 0.12, cy + math.sin(ang) * r * 0.7 - 0.12, z,
                   cx + math.cos(ang) * r * 0.7 + 0.12, cy + math.sin(ang) * r * 0.7 + 0.12, z + 2.2, "Rust")
        mb.prism(cx, cy, z + 2.2, z + 5.0, r, 12, "Rust", bottom=True, top=False)
        mb.prism(cx, cy, z + 5.0, z + 6.0, r, 12, "Rust", r2=0.15)
    # antenna mast with beacon
    if tall or rng.random() < 0.6:
        cx = rng.uniform(x0 + 1.5, x1 - 1.5)
        cy = rng.uniform(y0 + 1.5, y1 - 1.5)
        hh = rng.uniform(5, 14) * (1.6 if tall else 1)
        mb.prism(cx, cy, z, z + hh, 0.14, 6, "Trim")
        for k in range(1, 4):
            hz = z + hh * k / 4
            mb.cbox(cx, cy, hz, 1.4 - k * 0.3, 0.06, 0.06, "Trim")
        mb.sphere(cx, cy, z + hh + 0.2, 0.28, "Beacon", 8, 5)
    # dish
    if rng.random() < 0.4:
        cx = rng.uniform(x0 + 1.5, x1 - 1.5)
        cy = rng.uniform(y0 + 1.5, y1 - 1.5)
        mb.prism(cx, cy, z, z + 1.2, 0.08, 6, "Trim")
        M = Matrix.Translation((cx, cy, z + 1.6)) @ Matrix.Rotation(rng.uniform(0.5, 1.0), 4, "X") @ Matrix.Rotation(rng.uniform(0, 6.28), 4, "Z")
        mb.prism(0, 0, -0.3, 0.1, 0.12, 12, "Trim", M=M, r2=1.0, top=False)
    # neon roof outline on some
    if neon and rng.random() < 0.45:
        s = 0.12
        mb.box(x0, y0 - s, z + ph - s, x1, y0, z + ph, neon)
        mb.box(x0, y1, z + ph - s, x1, y1 + s, z + ph, neon)
        mb.box(x0 - s, y0, z + ph - s, x0, y1, z + ph, neon)
        mb.box(x1, y0, z + ph - s, x1 + s, y1, z + ph, neon)


def podium(mb, w, d, rng, neon, h=5.0):
    """Ground floor: shop bays, pillars, fascia, awnings."""
    hw, hd = w / 2, d / 2
    inset = 0.5
    mb.box(-hw + inset, -hd + inset, 0, hw - inset, hd - inset, h, "ConcreteDark")
    mb.box(-hw, -hd, h - 1.2, hw, hd, h, "Concrete")
    sides = [("x", -hd, 0, -1), ("x", hd, 0, 1), ("y", -hw, -1, 0), ("y", hw, 1, 0)]
    for axis, plane, nx, ny in sides:
        span = w if axis == "x" else d
        bays = max(2, int(span // 4.2))
        bw = span / bays
        for k in range(bays):
            a0 = -span / 2 + k * bw
            # pillar
            if axis == "x":
                mb.box(a0 - 0.3, plane - 0.3, 0, a0 + 0.3, plane + 0.3, h - 1.2, "Concrete")
            else:
                mb.box(plane - 0.3, a0 - 0.3, 0, plane + 0.3, a0 + 0.3, h - 1.2, "Concrete")
            kind = rng.random()
            mat = "ShopLit" if kind < 0.45 else ("ShopCool" if kind < 0.6 else ("Glass" if kind < 0.8 else "MetalDark"))
            p = plane - (0.42 if plane > 0 else -0.42)
            if axis == "x":
                mb.box(a0 + 0.3, min(p, p + 0.08 * (1 if plane > 0 else -1)), 0.15, a0 + bw - 0.3,
                       max(p, p + 0.08 * (1 if plane > 0 else -1)), h - 1.4, mat)
            else:
                mb.box(min(p, p + 0.08 * (1 if plane > 0 else -1)), a0 + 0.3, 0.15,
                       max(p, p + 0.08 * (1 if plane > 0 else -1)), a0 + bw - 0.3, h - 1.4, mat)
            # awnings over some lit bays
            if mat in ("ShopLit", "ShopCool") and rng.random() < 0.55:
                aw = "Awning" if rng.random() < 0.5 else "AwningB"
                depth = rng.uniform(1.2, 1.9)
                zt, zb = h - 1.25, h - 1.85
                if axis == "x":
                    s = 1 if plane > 0 else -1
                    v = [(a0 + 0.35, plane, zt), (a0 + bw - 0.35, plane, zt),
                         (a0 + bw - 0.35, plane + s * depth, zb), (a0 + 0.35, plane + s * depth, zb)]
                    if s < 0:
                        v = [v[1], v[0], v[3], v[2]]
                else:
                    s = 1 if plane > 0 else -1
                    v = [(plane, a0 + 0.35, zt), (plane, a0 + bw - 0.35, zt),
                         (plane + s * depth, a0 + bw - 0.35, zb), (plane + s * depth, a0 + 0.35, zb)]
                    if s > 0:
                        v = [v[1], v[0], v[3], v[2]]
                mb.quad(v[0], v[1], v[2], v[3], aw)
                mb.quad(v[3], v[2], v[1], v[0], aw)
                if neon and rng.random() < 0.6:
                    e0, e1 = Vector(v[2]), Vector(v[3])
                    mid = (e0 + e1) / 2
                    ln = (e0 - e1).length
                    if axis == "x":
                        mb.cbox(mid.x, mid.y, mid.z - 0.04, ln, 0.07, 0.07, neon)
                    else:
                        mb.cbox(mid.x, mid.y, mid.z - 0.04, 0.07, ln, 0.07, neon)


def shaft(mb, x0, y0, x1, y1, z0, z1, rng, mat, band_every=4, floor_h=3.3, pillars=True):
    mb.box(x0, y0, z0, x1, y1, z1, mat)
    if pillars:
        s = 0.7
        for (cx, cy) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            mb.box(cx - s / 2, cy - s / 2, z0, cx + s / 2, cy + s / 2, z1 + 0.4, "MetalDark")
    if band_every:
        z = z0 + floor_h * band_every
        while z < z1 - 1:
            mb.box(x0 - 0.25, y0 - 0.25, z - 0.18, x1 + 0.25, y1 + 0.25, z + 0.18, "Concrete")
            z += floor_h * band_every


def facade_greebles(mb, x0, y0, x1, y1, z0, z1, rng, density=0.5):
    """AC units and pipes on facades."""
    faces = [(x0, x1, y0, 0, -1), (x0, x1, y1, 0, 1), (y0, y1, x0, -1, 0), (y0, y1, x1, 1, 0)]
    for a0, a1, plane, nx, ny in faces:
        n = int((a1 - a0) * (z1 - z0) / 60 * density)
        for _ in range(n):
            a = rng.uniform(a0 + 1.2, a1 - 1.2)
            z = z0 + 3.3 * rng.randint(1, max(1, int((z1 - z0) / 3.3) - 1)) - 1.0
            if nx == 0:
                ac_unit(mb, a, plane, z, 0, ny)
            else:
                ac_unit(mb, plane, a, z, nx, 0)
        if rng.random() < 0.5 * density + 0.2:
            a = rng.uniform(a0 + 0.8, a1 - 0.8)
            off = 0.3
            if nx == 0:
                mb.pipe((a, plane + ny * off, z0), (a, plane + ny * off, z1), 0.16, "Rust")
                mb.pipe((a + 0.45, plane + ny * off, z0), (a + 0.45, plane + ny * off, z1 - 2), 0.1, "Rust")
            else:
                mb.pipe((plane + nx * off, a, z0), (plane + nx * off, a, z1), 0.16, "Rust")


def neon_corner(mb, x, y, z0, z1, neon, s=0.16):
    mb.box(x - s, y - s, z0, x + s, y + s, z1, neon)


# --------------------------------------------------------------------------
# Tower styles
# --------------------------------------------------------------------------
def tower(name, style, w, d, h, seed, neon):
    rng = random.Random(seed)
    mb = MB()
    hw, hd = w / 2, d / 2
    podium(mb, w, d, rng, neon)
    z0 = 5.0
    if style == "block":
        i = 0.6
        shaft(mb, -hw + i, -hd + i, hw - i, hd - i, z0, h, rng, "Facade")
        facade_greebles(mb, -hw + i, -hd + i, hw - i, hd - i, z0, h, rng, 0.6)
        roof_clutter(mb, -hw + i, -hd + i, hw - i, hd - i, h, rng, neon)
    elif style == "setback":
        tiers = 3
        x0, y0, x1, y1 = -hw + 0.6, -hd + 0.6, hw - 0.6, hd - 0.6
        zb = z0
        for t in range(tiers):
            zt = z0 + (h - z0) * (t + 1) / tiers * (1.0 if t == tiers - 1 else rng.uniform(0.85, 1.0))
            if t == tiers - 1:
                zt = h
            shaft(mb, x0, y0, x1, y1, zb, zt, rng, "Facade" if t < 2 else "FacadeGlass", band_every=3)
            if t == 0:
                facade_greebles(mb, x0, y0, x1, y1, zb, zt, rng, 0.4)
            roof_clutter(mb, x0, y0, x1, y1, zt, rng, neon, tall=(t == tiers - 1))
            if neon:
                neon_corner(mb, x0 - 0.45, y0 - 0.45, zb + 1, zt - 0.5, neon)
                neon_corner(mb, x1 + 0.45, y1 + 0.45, zb + 1, zt - 0.5, neon)
            inset = min(x1 - x0, y1 - y0) * rng.uniform(0.12, 0.18)
            x0, y0, x1, y1 = x0 + inset, y0 + inset, x1 - inset, y1 - inset
            zb = zt
    elif style == "slab":
        i = 0.6
        x0, y0, x1, y1 = -hw + i, -hd + i, hw - i, hd - i
        shaft(mb, x0, y0, x1, y1, z0, h, rng, "Facade", band_every=0)
        long_x = (x1 - x0) >= (y1 - y0)
        z = z0 + 3.3
        while z < h - 1:
            if long_x:
                mb.box(x0, y0 - 1.1, z - 0.12, x1, y0, z + 0.05, "Concrete")
                mb.box(x0, y1, z - 0.12, x1, y1 + 1.1, z + 0.05, "Concrete")
                mb.box(x0, y0 - 1.1, z + 0.9, x1, y0 - 1.0, z + 1.0, "Trim", top=True)
                mb.box(x0, y1 + 1.0, z + 0.9, x1, y1 + 1.1, z + 1.0, "Trim", top=True)
            else:
                mb.box(x0 - 1.1, y0, z - 0.12, x0, y1, z + 0.05, "Concrete")
                mb.box(x1, y0, z - 0.12, x1 + 1.1, y1, z + 0.05, "Concrete")
            z += 3.3
        facade_greebles(mb, x0, y0, x1, y1, z0, h, rng, 0.9)
        roof_clutter(mb, x0, y0, x1, y1, h, rng, neon)
    elif style == "glass":
        i = 1.2
        x0, y0, x1, y1 = -hw + i, -hd + i, hw - i, hd - i
        c = min(x1 - x0, y1 - y0) * 0.2  # chamfer
        # octagonal prism, extruded
        pts = [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]
        b = [mb.vert((p[0], p[1], z0)) for p in pts]
        t = [mb.vert((p[0], p[1], h)) for p in pts]
        for k in range(8):
            k2 = (k + 1) % 8
            mb.face((b[k], b[k2], t[k2], t[k]), "FacadeGlass")
        mb.face(t, "ConcreteDark")
        # vertical mullion fins at chamfer corners
        for k in range(0, 8):
            p = pts[k]
            mb.box(p[0] - 0.18, p[1] - 0.18, z0, p[0] + 0.18, p[1] + 0.18, h, "Trim")
        # crown: neon ring + set-in top + spire
        if neon:
            for k in range(8):
                p, q = Vector((*pts[k], 0)), Vector((*pts[(k + 1) % 8], 0))
                mid, L = (p + q) / 2, (q - p).length
                ang = math.atan2(q.y - p.y, q.x - p.x)
                for zz in (h - 0.6, h - 4.6):
                    M = Matrix.Translation((mid.x, mid.y, zz)) @ Matrix.Rotation(ang, 4, "Z")
                    mb.box(-L / 2, -0.12, -0.12, L / 2, 0.12, 0.12, neon, M=M)
        cx0, cy0, cx1, cy1 = x0 + c, y0 + c, x1 - c, y1 - c
        mb.box(cx0, cy0, h, cx1, cy1, h + 6, "FacadeGlass")
        roof_clutter(mb, cx0, cy0, cx1, cy1, h + 6, rng, None, tall=True)
        mb.prism(0, 0, h + 6, h + 26, 0.5, 6, "Trim", r2=0.08)
        mb.sphere(0, 0, h + 26.3, 0.4, "Beacon", 8, 5)
    elif style == "cylinder":
        r = min(hw, hd) - 0.8
        mb.prism(0, 0, z0, h, r, 28, "FacadeGlass", top=False)
        mb.prism(0, 0, h - 0.01, h, r, 28, "ConcreteDark")
        z = z0 + 6
        k = 0
        while z < h - 2:
            mb.prism(0, 0, z, z + 0.5, r + 0.5, 28, "Concrete", bottom=True)
            if neon and k % 2 == 0:
                mb.prism(0, 0, z + 0.5, z + 0.7, r + 0.35, 28, neon)
            z += 13.2
            k += 1
        s = r * 0.62
        roof_clutter(mb, -s, -s, s, s, h, rng, neon, tall=True)
    elif style == "stack":
        # irregular stacked blocks with overhangs: dense residential
        z = z0
        x0, y0, x1, y1 = -hw + 0.6, -hd + 0.6, hw - 0.6, hd - 0.6
        while z < h - 2:
            th = 3.3 * rng.randint(2, 4)
            zt = min(h, z + th)
            ox0 = x0 + rng.uniform(-1.4, 1.2)
            oy0 = y0 + rng.uniform(-1.4, 1.2)
            ox1 = x1 + rng.uniform(-1.2, 1.4)
            oy1 = y1 + rng.uniform(-1.2, 1.4)
            mb.box(ox0, oy0, z, ox1, oy1, zt, "Facade", bottom=True)
            facade_greebles(mb, ox0, oy0, ox1, oy1, z, zt, rng, 1.6)
            if rng.random() < 0.35:
                # cage balcony strip
                mb.box(ox0, oy0 - 0.9, z + 1.2, ox1, oy0, z + 1.3, "Trim")
                for q in range(int((ox1 - ox0) // 1.5)):
                    xx = ox0 + 0.2 + q * 1.5
                    mb.box(xx, oy0 - 0.9, z, xx + 0.06, oy0 - 0.84, zt, "Trim")
            if neon and rng.random() < 0.3:
                mb.box(ox0, oy0 - 0.14, z + 0.2, ox1, oy0, z + 0.34, neon)
            z = zt
        roof_clutter(mb, x0, y0, x1, y1, z, rng, neon)
        # shacks on the roof
        for _ in range(rng.randint(1, 3)):
            sw, sd = rng.uniform(2.5, 4.5), rng.uniform(2.5, 4)
            cx, cy = rng.uniform(x0 + sw / 2 + 0.5, x1 - sw / 2 - 0.5), rng.uniform(y0 + sd / 2 + 0.5, y1 - sd / 2 - 0.5)
            mb.cbox(cx, cy, z + 1.3, sw, sd, 2.6, "Rust")
            mb.cbox(cx, cy, z + 2.7, sw + 0.5, sd + 0.5, 0.15, "MetalDark")
    elif style == "market":
        i = 0.6
        x0, y0, x1, y1 = -hw + i, -hd + i, hw - i, hd - i
        shaft(mb, x0, y0, x1, y1, z0, h, rng, "Facade", band_every=0, pillars=False)
        facade_greebles(mb, x0, y0, x1, y1, z0, h, rng, 1.4)
        roof_clutter(mb, x0, y0, x1, y1, h, rng, neon)
        # roof terrace lights strung across
        for k in range(5):
            y = y0 + (y1 - y0) * (k + 0.5) / 5
            for q in range(int((x1 - x0) // 1.4)):
                mb.sphere(x0 + 0.7 + q * 1.4, y, h + 3.2 - 0.3 * math.sin(math.pi * q / max(1, int((x1 - x0) // 1.4))), 0.13, "LampWarm", 6, 4)
        for (px, py) in ((x0 + 0.5, y0 + 0.5), (x1 - 0.5, y0 + 0.5), (x0 + 0.5, y1 - 0.5), (x1 - 0.5, y1 - 0.5)):
            mb.prism(px, py, h, h + 3.4, 0.08, 6, "Trim")
    return mb.build(name)


TOWERS = [
    ("tower_stack_a", "stack", 16, 16, 34, "NeonPink"),
    ("tower_stack_b", "stack", 18, 14, 46, "NeonCyan"),
    ("tower_stack_c", "stack", 14, 12, 27, "NeonAmber"),
    ("tower_block_a", "block", 20, 20, 42, "NeonViolet"),
    ("tower_block_b", "block", 16, 22, 58, None),
    ("tower_setback_a", "setback", 22, 22, 80, "NeonCyan"),
    ("tower_setback_b", "setback", 20, 18, 64, "NeonPink"),
    ("tower_slab_a", "slab", 22, 12, 52, "NeonAmber"),
    ("tower_slab_b", "slab", 12, 20, 40, None),
    ("tower_glass_a", "glass", 22, 22, 112, "NeonCyan"),
    ("tower_glass_b", "glass", 18, 18, 90, "NeonViolet"),
    ("tower_cylinder_a", "cylinder", 19, 19, 72, "NeonPink"),
    ("tower_market_a", "market", 20, 16, 15, "NeonGreen"),
    ("tower_market_b", "market", 16, 16, 12, "NeonAmber"),
]
for k, (n, st, w, d, h, ne) in enumerate(TOWERS):
    tower(n, st, w, d, h, 1000 + k * 37, ne)


# --------------------------------------------------------------------------
# Street props
# --------------------------------------------------------------------------
def prop_lamp():
    mb = MB()
    mb.prism(0, 0, 0, 0.3, 0.22, 8, "MetalDark")
    mb.prism(0, 0, 0.3, 6.5, 0.09, 8, "MetalDark")
    mb.box(-0.05, -0.05, 6.4, 1.6, 0.05, 6.55, "MetalDark")
    mb.box(1.1, -0.22, 6.15, 1.75, 0.22, 6.4, "MetalDark")
    mb.box(1.15, -0.18, 6.1, 1.7, 0.18, 6.15, "LampCold", bottom=True)
    # small neon ring on the pole
    mb.prism(0, 0, 3.0, 3.12, 0.13, 10, "NeonCyan")
    return mb.build("prop_lamp")


def prop_vending():
    mb = MB()
    mb.box(-0.5, -0.4, 0, 0.5, 0.4, 1.9, "MetalDark", sides={"-y": "Trim"})
    mb.box(-0.42, -0.42, 0.75, 0.42, -0.4, 1.8, "ShopCool")
    mb.box(-0.42, -0.43, 0.2, 0.42, -0.4, 0.55, "Rubber")
    mb.box(-0.5, -0.45, 1.85, 0.5, -0.4, 1.9, "NeonPink")
    return mb.build("prop_vending")


def prop_kiosk():
    mb = MB()
    mb.box(-1.5, -1.0, 0, 1.5, 1.0, 1.05, "Rust")
    mb.box(-1.6, -1.15, 1.05, 1.6, 1.15, 1.12, "Trim")
    for (x, y) in ((-1.45, -0.95), (1.45, -0.95), (-1.45, 0.95), (1.45, 0.95)):
        mb.box(x - 0.05, y - 0.05, 1.1, x + 0.05, y + 0.05, 2.6, "MetalDark")
    mb.box(-1.4, 0.85, 1.12, 1.4, 1.0, 2.5, "ShopLit")
    v = [(-1.8, -1.6, 2.45), (1.8, -1.6, 2.45), (1.8, 1.2, 2.85), (-1.8, 1.2, 2.85)]
    mb.quad(*v, "Awning")
    mb.quad(v[3], v[2], v[1], v[0], "Awning")
    mb.box(-1.8, -1.66, 2.36, 1.8, -1.56, 2.45, "NeonAmber")
    for k in range(4):
        mb.sphere(-1.2 + k * 0.8, -1.45, 2.05, 0.17, "LampWarm", 8, 5, sz=1.3)
        mb.pipe((-1.2 + k * 0.8, -1.45, 2.25), (-1.2 + k * 0.8, -1.45, 2.42), 0.015, "Rubber", 4)
    # stools
    for k in range(3):
        mb.prism(-1.0 + k, -1.5, 0, 0.62, 0.05, 6, "Trim")
        mb.prism(-1.0 + k, -1.5, 0.62, 0.68, 0.2, 10, "Awning")
    return mb.build("prop_kiosk")


def prop_dumpster():
    mb = MB()
    mb.box(-1.0, -0.6, 0.15, 1.0, 0.6, 1.25, "AwningB")
    mb.box(-1.05, -0.65, 1.25, 1.05, 0.65, 1.33, "MetalDark")
    for x in (-0.8, 0.8):
        for y in (-0.45, 0.45):
            mb.prism(x, y, 0, 0.15, 0.09, 6, "Rubber")
    return mb.build("prop_dumpster")


def prop_crates():
    mb = MB()
    rng = random.Random(7)
    for k in range(4):
        s = rng.uniform(0.5, 0.8)
        x, y = rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6)
        z = 0 if k < 3 else 0.7
        mb.cbox(x, y, z + s / 2, s, s, s, "Rust" if k % 2 else "CarBodyB", bottom=False)
    return mb.build("prop_crates")


def prop_barrier():
    mb = MB()
    mb.box(-1.0, -0.15, 0, 1.0, 0.15, 0.25, "Concrete")
    mb.box(-1.0, -0.06, 0.25, 1.0, 0.06, 0.95, "Stripe")
    mb.box(-1.0, -0.07, 0.75, 1.0, 0.07, 0.82, "NeonAmber")
    return mb.build("prop_barrier")


def prop_bench():
    mb = MB()
    mb.box(-1.0, -0.25, 0.42, 1.0, 0.25, 0.5, "Trim")
    for x in (-0.85, 0.85):
        mb.box(x - 0.04, -0.2, 0, x + 0.04, 0.2, 0.42, "MetalDark")
    mb.box(-1.0, -0.26, 0.38, 1.0, -0.22, 0.42, "NeonCyan")
    return mb.build("prop_bench")


def prop_bollard():
    mb = MB()
    mb.prism(0, 0, 0, 0.9, 0.14, 10, "MetalDark")
    mb.prism(0, 0, 0.9, 0.98, 0.15, 10, "NeonPink")
    return mb.build("prop_bollard")


def prop_vent():
    mb = MB()
    mb.box(-0.6, -0.6, 0, 0.6, 0.6, 0.05, "MetalDark")
    for k in range(5):
        mb.box(-0.5, -0.5 + k * 0.24, 0.05, 0.5, -0.44 + k * 0.24, 0.07, "Rubber")
    return mb.build("prop_vent")


def prop_tree():
    """Planter with a glowing synthetic tree."""
    mb = MB()
    mb.prism(0, 0, 0, 0.8, 1.6, 8, "Concrete", rot=math.pi / 8)
    mb.prism(0, 0, 0.8, 0.86, 1.68, 8, "NeonGreen", rot=math.pi / 8)
    mb.prism(0, 0, 0.8, 0.85, 1.5, 8, "Plant", rot=math.pi / 8)
    mb.prism(0, 0, 0.8, 4.0, 0.16, 6, "Rust", r2=0.09)
    rng = random.Random(3)
    for k in range(7):
        a = k * 2.4
        r = rng.uniform(0.4, 1.4)
        mb.sphere(math.cos(a) * r, math.sin(a) * r, rng.uniform(3.6, 5.0), rng.uniform(0.7, 1.1), "GlowLeaf", 8, 5, sz=0.7)
    return mb.build("prop_tree")


def prop_parked_car():
    mb = MB()
    mb.box(-2.1, -0.85, 0.3, 2.1, 0.85, 0.95, "CarBody", bottom=True)
    v = [(-1.0, -0.78, 0.95), (1.0, -0.78, 0.95), (0.7, -0.62, 1.42), (-1.3, -0.62, 1.42)]
    mb.box(-1.2, -0.7, 0.95, 0.9, 0.7, 1.42, "Canopy")
    for x in (-1.4, 1.4):
        for y in (-0.82, 0.82):
            M = Matrix.Translation((x, y, 0.33)) @ Matrix.Rotation(math.pi / 2, 4, "X")
            mb.prism(0, 0, -0.14, 0.14, 0.33, 10, "Rubber", M=M, bottom=True)
    mb.box(2.08, -0.75, 0.62, 2.12, -0.4, 0.75, "HeadLight")
    mb.box(2.08, 0.4, 0.62, 2.12, 0.75, 0.75, "HeadLight")
    mb.box(-2.12, -0.8, 0.65, -2.08, 0.8, 0.72, "TailLight")
    return mb.build("prop_parked_car")


def sign_blade():
    """Vertical blade sign: frame + two faces (UV 0..1 each), 1.2 x 5 m."""
    mb = MB()
    W, H, T = 1.2, 5.0, 0.3
    mb.box(-T / 2, -W / 2 - 0.08, -0.08, T / 2, W / 2 + 0.08, H + 0.08, "MetalDark")
    # faces on +x and -x
    mb.quad((T / 2 + 0.01, -W / 2, 0), (T / 2 + 0.01, W / 2, 0), (T / 2 + 0.01, W / 2, H), (T / 2 + 0.01, -W / 2, H), "SignFace")
    mb.quad((-T / 2 - 0.01, W / 2, 0), (-T / 2 - 0.01, -W / 2, 0), (-T / 2 - 0.01, -W / 2, H), (-T / 2 - 0.01, W / 2, H), "SignFace")
    # bracket to wall (wall is at y = +W/2 + 0.9)
    mb.box(-0.06, W / 2 + 0.08, H * 0.2, 0.06, W / 2 + 0.9, H * 0.2 + 0.12, "Trim")
    mb.box(-0.06, W / 2 + 0.08, H * 0.8, 0.06, W / 2 + 0.9, H * 0.8 + 0.12, "Trim")
    return mb.build("sign_blade")


def sign_wide():
    """Wide fascia sign: 6 x 1.5 m face on -y, back plate at y = 0."""
    mb = MB()
    W, H = 6.0, 1.5
    mb.box(-W / 2 - 0.1, -0.25, -0.1, W / 2 + 0.1, 0, H + 0.1, "MetalDark")
    mb.quad((-W / 2, -0.26, 0), (W / 2, -0.26, 0), (W / 2, -0.26, H), (-W / 2, -0.26, H), "SignFace")
    return mb.build("sign_wide")


def billboard():
    """Rooftop/wall screen: 12 x 6.75 m face on -y, frame and supports."""
    mb = MB()
    W, H = 12.0, 6.75
    mb.box(-W / 2 - 0.3, -0.3, 2.7, W / 2 + 0.3, 0.3, 3.0 + H + 0.3, "MetalDark")
    mb.quad((-W / 2, -0.31, 3.0), (W / 2, -0.31, 3.0), (W / 2, -0.31, 3.0 + H), (-W / 2, -0.31, 3.0 + H), "Screen")
    for x in (-W / 3, 0, W / 3):
        mb.box(x - 0.15, 0.3, 0, x + 0.15, 0.6, 3.0 + H, "Trim")
        mb.pipe((x, 0.45, 0), (x, 2.8, 2.6), 0.1, "Trim", 5)
    # light bar on top
    mb.box(-W / 2, -0.6, 3.0 + H + 0.3, W / 2, -0.3, 3.0 + H + 0.4, "Trim")
    for x in (-W / 3, 0, W / 3):
        mb.box(x - 0.25, -1.1, 3.0 + H + 0.25, x + 0.25, -0.6, 3.0 + H + 0.4, "LampCold", bottom=True)
    return mb.build("billboard")


def skywalk():
    """Enclosed footbridge, 1 m long along X (scaled to span), 3.4 wide."""
    mb = MB()
    mb.box(0, -1.7, 0, 1, 1.7, 0.4, "ConcreteDark", bottom=True)
    mb.box(0, -1.7, 3.0, 1, 1.7, 3.3, "MetalDark", bottom=True)
    mb.box(0, -1.72, 0.4, 1, -1.62, 3.0, "Glass")
    mb.box(0, 1.62, 0.4, 1, 1.72, 3.0, "Glass")
    mb.box(0, -1.78, 0.35, 1, -1.7, 0.45, "NeonCyan")
    mb.box(0, 1.7, 0.35, 1, 1.78, 0.45, "NeonCyan")
    mb.box(0, -1.4, 2.95, 1, 1.4, 3.0, "LampCold")
    return mb.build("skywalk")


def rail_segment():
    """Elevated rail beam, 1 m along X (scaled), deck top at z = 0."""
    mb = MB()
    mb.box(0, -2.2, -1.4, 1, 2.2, 0, "Concrete", bottom=True)
    mb.box(0, -2.4, -0.2, 1, -2.2, 0.6, "MetalDark")
    mb.box(0, 2.2, -0.2, 1, 2.4, 0.6, "MetalDark")
    mb.box(0, -1.0, 0, 1, -0.8, 0.25, "Trim")
    mb.box(0, 0.8, 0, 1, 1.0, 0.25, "Trim")
    mb.box(0, -2.42, -0.9, 1, -2.4, -0.82, "NeonViolet")
    mb.box(0, 2.4, -0.9, 1, 2.42, -0.82, "NeonViolet")
    return mb.build("rail_segment")


def rail_pylon():
    """Pylon from ground to the underside of the beam at 16.6 m."""
    mb = MB()
    mb.prism(0, 0, 0, 0.6, 1.5, 8, "Concrete", rot=math.pi / 8)
    mb.prism(0, 0, 0.6, 15.0, 0.9, 8, "Concrete", rot=math.pi / 8, r2=0.75)
    mb.box(-2.4, -0.9, 15.0, 2.4, 0.9, 16.6, "Concrete", bottom=True)
    mb.prism(0, 0, 4.0, 4.15, 0.95, 8, "NeonViolet", rot=math.pi / 8)
    return mb.build("rail_pylon")


def train_car():
    """Train car, 14 m along X, sits on the rail deck (z = 0)."""
    mb = MB()
    L, W = 14.0, 3.0
    mb.box(-L / 2, -W / 2, 0.5, L / 2, W / 2, 3.6, "TrainBody", bottom=True)
    mb.box(-L / 2 + 0.6, -W / 2 - 0.02, 1.7, L / 2 - 0.6, W / 2 + 0.02, 2.7, "ShopCool")
    mb.box(-L / 2, -W / 2 - 0.03, 1.2, L / 2, W / 2 + 0.03, 1.32, "NeonPink")
    mb.box(-L / 2 + 0.3, -W / 2 + 0.3, 3.6, L / 2 - 0.3, W / 2 - 0.3, 3.9, "MetalDark")
    for x in (-L / 2 + 2, L / 2 - 2):
        mb.box(x - 1.2, -1.3, 0.1, x + 1.2, 1.3, 0.5, "Rubber")
    mb.box(L / 2 - 0.02, -1.0, 2.0, L / 2 + 0.02, 1.0, 2.3, "HeadLight")
    mb.box(-L / 2 - 0.02, -1.0, 2.0, -L / 2 + 0.02, 1.0, 2.3, "TailLight")
    return mb.build("train_car")


def hover_car(name, body, length=4.6, van=False):
    """Hover car, nose towards +X. Origin at centre of the body."""
    mb = MB()
    L, W = length, 2.0
    hl, hw = L / 2, W / 2
    H = 1.6 if van else 0.9
    # wedge body: lower hull box + tapered nose
    mb.box(-hl, -hw, -0.35, hl - 0.9, hw, H - 0.35, body, bottom=True)
    nose = [mb.vert(p) for p in [
        (hl - 0.9, -hw, -0.35), (hl, -hw * 0.7, -0.2), (hl, hw * 0.7, -0.2), (hl - 0.9, hw, -0.35),
        (hl - 0.9, -hw, H - 0.35), (hl, -hw * 0.7, 0.15), (hl, hw * 0.7, 0.15), (hl - 0.9, hw, H - 0.35)]]
    for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5)):
        mb.face([nose[k] for k in q], body)
    if not van:
        mb.box(-hl + 0.9, -hw + 0.25, H - 0.35, hl - 1.4, hw - 0.25, H + 0.15, "Canopy")
    # pods
    for y in (-hw - 0.25, hw + 0.25):
        M = Matrix.Translation((-hl + 0.6, y, -0.1)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
        mb.prism(0, 0, 0, L - 1.2, 0.3, 8, "MetalDark", M=M, bottom=True)
        M2 = Matrix.Translation((-hl + 0.55, y, -0.1)) @ Matrix.Rotation(-math.pi / 2, 4, "Y")
        mb.prism(0, 0, 0, 0.05, 0.24, 8, "NeonCyan", M=M2)
    mb.box(hl - 0.02, -hw * 0.65, -0.1, hl + 0.03, -hw * 0.2, 0.05, "HeadLight")
    mb.box(hl - 0.02, hw * 0.2, -0.1, hl + 0.03, hw * 0.65, 0.05, "HeadLight")
    mb.box(-hl - 0.03, -hw + 0.1, 0.0, -hl + 0.02, hw - 0.1, 0.12, "TailLight")
    # underglow strip
    mb.box(-hl + 0.4, -0.5, -0.4, hl - 1.0, 0.5, -0.36, "NeonPink" if not van else "NeonAmber", bottom=True)
    return mb.build(name)


def holo_plinth():
    mb = MB()
    mb.prism(0, 0, 0, 0.6, 7.5, 16, "Concrete", rot=0)
    mb.prism(0, 0, 0.6, 0.7, 7.7, 16, "NeonCyan")
    mb.prism(0, 0, 0.6, 1.2, 4.5, 16, "MetalDark", r2=3.8)
    mb.prism(0, 0, 1.2, 1.35, 3.6, 16, "NeonPink")
    mb.prism(0, 0, 1.2, 1.3, 3.5, 16, "LampCold")
    for k in range(6):
        a = k * math.pi / 3
        mb.box(math.cos(a) * 6 - 0.15, math.sin(a) * 6 - 0.15, 0.6, math.cos(a) * 6 + 0.15, math.sin(a) * 6 + 0.15, 3.2, "MetalDark")
        mb.sphere(math.cos(a) * 6, math.sin(a) * 6, 3.3, 0.22, "LampCold", 8, 5)
    return mb.build("holo_plinth")


def holo_koi():
    """Stylised koi, nose towards +X, about 8 m long. Lofted from rings."""
    mb = MB()
    L = 8.0
    n_ring, seg = 16, 12
    rings = []
    for j in range(n_ring + 1):
        t = j / n_ring
        x = L / 2 - t * L
        # body profile: round head, slim tail
        r = 1.15 * math.sin(math.pi * min(1.0, t * 1.15) ** 0.8) * (1 - 0.65 * t) + 0.04
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            ring.append(mb.vert((x, r * math.cos(a), r * 0.82 * math.sin(a))))
        rings.append(ring)
    for j in range(n_ring):
        for k in range(seg):
            k2 = (k + 1) % seg
            mb.face((rings[j][k], rings[j][k2], rings[j + 1][k2], rings[j + 1][k]), "Hologram",
                    [(j / n_ring, k / seg), (j / n_ring, (k + 1) / seg), ((j + 1) / n_ring, (k + 1) / seg), ((j + 1) / n_ring, k / seg)], True)
    # tail fin
    tx = -L / 2
    mb.quad((tx + 0.3, 0, 0), (tx - 2.0, 0, 1.6), (tx - 1.4, 0, 0), (tx - 2.0, 0, -1.6), "Hologram",
            ((1, 0.5), (1.3, 0.9), (1.2, 0.5), (1.3, 0.1)))
    mb.quad((tx - 2.0, 0, -1.6), (tx - 1.4, 0, 0), (tx - 2.0, 0, 1.6), (tx + 0.3, 0, 0), "Hologram",
            ((1.3, 0.1), (1.2, 0.5), (1.3, 0.9), (1, 0.5)))
    # dorsal fin
    mb.quad((1.2, 0, 0.85), (-1.8, 0, 0.7), (-1.2, 0, 1.6), (0.2, 0, 1.5), "Hologram")
    mb.quad((0.2, 0, 1.5), (-1.2, 0, 1.6), (-1.8, 0, 0.7), (1.2, 0, 0.85), "Hologram")
    # pectoral fins
    for s in (-1, 1):
        a, b, c = (1.6, s * 0.8, -0.4), (0.4, s * 2.2, -0.9), (0.6, s * 0.9, -0.5)
        mb.face((mb.vert(a), mb.vert(b), mb.vert(c)), "Hologram")
        mb.face((mb.vert(c), mb.vert(b), mb.vert(a)), "Hologram")
    return mb.build("holo_koi")


for fn in (prop_lamp, prop_vending, prop_kiosk, prop_dumpster, prop_crates, prop_barrier,
           prop_bench, prop_bollard, prop_vent, prop_tree, prop_parked_car, sign_blade, sign_wide,
           billboard, skywalk, rail_segment, rail_pylon, train_car, holo_plinth, holo_koi):
    fn()
hover_car("hover_car_a", "CarBody")
hover_car("hover_car_b", "CarBodyC", 4.2)
hover_car("hover_van", "CarBodyB", 6.0, van=True)

# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
tris = 0
for ob in COL.objects:
    for p in ob.data.polygons:
        tris += len(p.vertices) - 2
print(f"objects={len(COL.objects)} triangles={tris}")

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_cameras=False,
    export_extras=False,
    export_animations=False,
    export_materials="EXPORT",
    export_texcoords=True,
    export_normals=True,
)
print("wrote", OUT)
