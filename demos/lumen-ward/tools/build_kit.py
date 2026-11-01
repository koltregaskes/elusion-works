"""Lumen Ward detailed kit, modelled in Blender (v2).

    python -I demos/lumen-ward/tools/build_kit.py demos/lumen-ward/assets/lumen-ward-kit.glb

Writes the .glb and a sibling .json describing every tower's facade grid.

How the detail is organised (the same way game engines build cities):
- Facade cell modules (`cell_*`, `shop_*`): one window bay each, with real
  depth: piers, spandrels, recessed glass, frames, mullions, sills, AC units,
  balconies with railings. The browser instances these thousands of times.
- Tower shells (`tower_*`): podium fascia, corner pillars, ledges, core, roof
  parapets and detailed rooftop plant. The JSON says where each facade wall is,
  how many columns and floors it has, and which module family fills it.
- Street props, signs, transport and the plaza hologram.

Conventions: Blender is Z-up; glTF export turns Blender -Y into three.js +Z.
Modules face Blender -Y (three.js +Z), so a module's outward side is local +Z
in the browser. Faces without explicit UVs get box-projected UVs in metres
divided by the material's tile size, so textures keep a real-world scale.
"""

import json
import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else "lumen-ward-kit.glb"
OUT_JSON = OUT[:-4] + ".json"

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for me in list(bpy.data.meshes):
    bpy.data.meshes.remove(me)
for ma in list(bpy.data.materials):
    bpy.data.materials.remove(ma)
COL = bpy.context.scene.collection

# ---------------------------------------------------------------------------- materials
MATS = {}
TILE = {}


def make_mat(name, col, metal=0.0, rough=0.6, emit=None, strength=0.0, tile=2.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*col, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    MATS[name] = m
    TILE[name] = tile
    return m


# Textured surfaces (the browser binds the texture sets by material name)
make_mat("Concrete", (0.8, 0.8, 0.8), 0.0, 0.8, tile=4.0)
make_mat("ConcreteDark", (0.35, 0.35, 0.38), 0.0, 0.85, tile=4.0)
make_mat("Cladding", (0.8, 0.8, 0.8), 0.7, 0.45, tile=4.0)
make_mat("Roof", (0.8, 0.8, 0.8), 0.0, 0.8, tile=4.0)
make_mat("Rust", (0.8, 0.8, 0.8), 0.4, 0.6, tile=2.0)
make_mat("Pavement", (0.8, 0.8, 0.8), 0.0, 0.6, tile=4.0)
# Plain surfaces
make_mat("Frame", (0.03, 0.032, 0.036), 0.85, 0.35)
make_mat("Trim", (0.16, 0.165, 0.18), 0.9, 0.32)
make_mat("Steel", (0.42, 0.43, 0.45), 1.0, 0.28)
make_mat("Rubber", (0.015, 0.015, 0.017), 0.0, 0.75)
make_mat("Grille", (0.02, 0.02, 0.022), 0.6, 0.5)
make_mat("Awning", (0.32, 0.03, 0.06), 0.0, 0.85)
make_mat("AwningB", (0.02, 0.12, 0.15), 0.0, 0.85)
make_mat("AwningC", (0.3, 0.2, 0.04), 0.0, 0.85)
make_mat("Plant", (0.015, 0.05, 0.03), 0.0, 0.8)
make_mat("Wood", (0.16, 0.09, 0.05), 0.0, 0.7)
make_mat("Fabric", (0.2, 0.18, 0.22), 0.0, 0.9)
make_mat("Stripe", (0.85, 0.75, 0.1), 0.0, 0.6)
make_mat("CarBody", (0.06, 0.065, 0.08), 0.9, 0.22)
make_mat("CarBodyB", (0.3, 0.26, 0.2), 0.75, 0.3)
make_mat("CarBodyC", (0.4, 0.03, 0.05), 0.85, 0.25)
make_mat("CarBodyD", (0.75, 0.75, 0.78), 0.9, 0.2)
make_mat("TrainBody", (0.62, 0.64, 0.68), 0.95, 0.22)
make_mat("Canopy", (0.005, 0.008, 0.012), 0.8, 0.04)
# Glass the browser swaps for interior-mapped shaders
make_mat("WindowGlass", (0.02, 0.025, 0.03), 0.0, 0.05)
make_mat("ShopGlass", (0.02, 0.025, 0.03), 0.0, 0.05)
make_mat("Glass", (0.02, 0.03, 0.04), 0.3, 0.05)
# Emissive
NEONS = {
    "NeonPink": (1.0, 0.06, 0.45),
    "NeonCyan": (0.04, 0.8, 1.0),
    "NeonAmber": (1.0, 0.45, 0.06),
    "NeonViolet": (0.45, 0.15, 1.0),
    "NeonGreen": (0.12, 1.0, 0.4),
}
for k, c in NEONS.items():
    make_mat(k, (c[0] * 0.2, c[1] * 0.2, c[2] * 0.2), 0.0, 0.4, c, 6.0)
make_mat("LampWarm", (0.4, 0.3, 0.2), 0.0, 0.4, (1.0, 0.72, 0.42), 10.0)
make_mat("LampCold", (0.3, 0.35, 0.4), 0.0, 0.4, (0.75, 0.9, 1.0), 10.0)
make_mat("ShopLit", (0.3, 0.2, 0.12), 0.0, 0.5, (1.0, 0.62, 0.32), 1.2)
make_mat("Screenlet", (0.05, 0.1, 0.15), 0.0, 0.3, (0.3, 0.8, 1.0), 2.5)
make_mat("Beacon", (0.3, 0.0, 0.0), 0.0, 0.4, (1.0, 0.04, 0.04), 14.0)
make_mat("HeadLight", (0.5, 0.5, 0.5), 0.0, 0.3, (1.0, 0.95, 0.85), 14.0)
make_mat("TailLight", (0.3, 0.0, 0.0), 0.0, 0.3, (1.0, 0.03, 0.08), 10.0)
make_mat("GlowLeaf", (0.02, 0.2, 0.18), 0.0, 0.6, (0.1, 1.0, 0.75), 2.0)
make_mat("SignFace", (1, 1, 1), 0.0, 1.0)
make_mat("Screen", (0.02, 0.02, 0.02), 0.0, 0.3)
make_mat("Hologram", (0.2, 0.9, 1.0), 0.0, 0.3, (0.2, 0.9, 1.0), 3.0)


# ---------------------------------------------------------------------------- mesh builder
class MB:
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

    def poly(self, pts, mat, center=None, uvs=None, smooth=False, M=None):
        """Polygon; if center is given, wind it to face away from center."""
        P = [Vector(p) if M is None else M @ Vector(p) for p in pts]
        if center is not None:
            c = Vector(center) if M is None else M @ Vector(center)
            n = (P[1] - P[0]).cross(P[2] - P[0])
            cen = sum(P, Vector()) / len(P)
            if n.dot(cen - c) < 0:
                P = P[::-1]
                if uvs:
                    uvs = uvs[::-1]
        i = [self.vert(p) for p in P]
        self.face(i, mat, uvs, smooth)

    def box(self, x0, y0, z0, x1, y1, z1, mat, M=None, sides=None, skip=()):
        P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        i = [self.vert(p, M) for p in P]
        sides = sides or {}
        quads = {"-z": (0, 3, 2, 1), "+z": (4, 5, 6, 7), "-y": (0, 1, 5, 4),
                 "+y": (2, 3, 7, 6), "-x": (3, 0, 4, 7), "+x": (1, 2, 6, 5)}
        for key, q in quads.items():
            if key in skip:
                continue
            self.face([i[k] for k in q], sides.get(key, mat))

    def cbox(self, cx, cy, cz, sx, sy, sz, mat, **kw):
        self.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, mat, **kw)

    def bbox(self, x0, y0, z0, x1, y1, z1, mat, c=0.04, M=None, bottom=False):
        """Box with chamfered edges (catches highlights like real geometry)."""
        c = min(c, (x1 - x0) / 2.5, (y1 - y0) / 2.5, (z1 - z0) / 2.5)
        hx, hy, hz = (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2
        cen = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        V = {}
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    for a in range(3):
                        V[(sx, sy, sz, a)] = (cen[0] + sx * (hx - (c if a != 0 else 0)),
                                              cen[1] + sy * (hy - (c if a != 1 else 0)),
                                              cen[2] + sz * (hz - (c if a != 2 else 0)))
        S = (-1, 1)
        # main faces
        for a in range(3):
            for s in S:
                if a == 2 and s == -1 and not bottom:
                    continue
                pts = []
                for u, v in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    k = [0, 0, 0]
                    k[a] = s
                    others = [i for i in range(3) if i != a]
                    k[others[0]] = u
                    k[others[1]] = v
                    pts.append(V[(k[0], k[1], k[2], a)])
                self.poly(pts, mat, cen, M=M)
        # edge chamfers
        for a in range(3):
            for b in range(a + 1, 3):
                t = 3 - a - b
                for sa in S:
                    for sb in S:
                        if (a == 2 and sa == -1) or (b == 2 and sb == -1):
                            if not bottom:
                                continue
                        k1 = [0, 0, 0]
                        k1[a], k1[b], k1[t] = sa, sb, -1
                        k2 = list(k1)
                        k2[t] = 1
                        pts = [V[(*k1, a)], V[(*k1, b)], V[(*k2, b)], V[(*k2, a)]]
                        self.poly(pts, mat, cen, M=M)
        # corners
        for sx in S:
            for sy in S:
                for sz in S:
                    if sz == -1 and not bottom:
                        continue
                    self.poly([V[(sx, sy, sz, 0)], V[(sx, sy, sz, 1)], V[(sx, sy, sz, 2)]], mat, cen, M=M)

    def prism(self, cx, cy, z0, z1, r, n, mat, M=None, r2=None, top=True, bottom=False, smooth=True, rot=0.0, cap_mat=None):
        r2 = r if r2 is None else r2
        b, t = [], []
        for k in range(n):
            a = rot + 2 * math.pi * k / n
            b.append(self.vert((cx + r * math.cos(a), cy + r * math.sin(a), z0), M))
            t.append(self.vert((cx + r2 * math.cos(a), cy + r2 * math.sin(a), z1), M))
        for k in range(n):
            k2 = (k + 1) % n
            self.face((b[k], b[k2], t[k2], t[k]), mat, None, smooth)
        if top and r2 > 0.001:
            self.face(t, cap_mat or mat)
        if bottom:
            self.face(list(reversed(b)), cap_mat or mat)

    def sphere(self, cx, cy, cz, r, mat, seg=12, rings=8, sz=1.0, M=None):
        rows = []
        for j in range(rings + 1):
            th = math.pi * j / rings
            rows.append([self.vert((cx + r * math.sin(th) * math.cos(2 * math.pi * k / seg),
                                    cy + r * math.sin(th) * math.sin(2 * math.pi * k / seg),
                                    cz + r * sz * math.cos(th)), M) for k in range(seg)])
        for j in range(rings):
            for k in range(seg):
                k2 = (k + 1) % seg
                self.face((rows[j][k], rows[j + 1][k], rows[j + 1][k2], rows[j][k2]), mat, None, True)

    def pipe(self, p0, p1, r, mat, n=6, caps=False):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        M = Matrix.Translation(p0) @ q.to_matrix().to_4x4()
        self.prism(0, 0, 0, d.length, r, n, mat, M=M, top=caps, bottom=caps)

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
        for poly, uvs, mi in zip(me.polygons, self.uv, self.m):
            if uvs:
                for k, li in enumerate(poly.loop_indices):
                    uvl.data[li].uv = uvs[k]
                continue
            tile = TILE.get(self.mats[mi], 2.0)
            n = poly.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for li in poly.loop_indices:
                p = me.vertices[me.loops[li].vertex_index].co
                if az >= ax and az >= ay:
                    u, v = p.x, p.y
                elif ax >= ay:
                    u, v = p.y * (1 if n.x > 0 else -1), p.z
                else:
                    u, v = p.x * (-1 if n.y > 0 else 1), p.z
                uvl.data[li].uv = (u / tile, v / tile)
        me.update()
        ob = bpy.data.objects.new(name, me)
        COL.objects.link(ob)
        return ob


# ---------------------------------------------------------------------------- facade modules
# Cell local frame: x along the wall (right as seen from outside), z up,
# outward = -y. Wall plane y = 0; recesses go +y.
CELL = {"std": (2.4, 3.3), "ribbon": (1.8, 3.6), "shop": (4.2, 4.0)}
D = 0.35


def window_cell(mb, wall, ob=0.95, ot=2.95, ow=1.5, W=2.4, H=3.3, mullion=True, transom=True):
    hw, ho = W / 2, ow / 2
    mb.box(-hw, 0, 0, -ho, D, H, wall, skip=("+y", "-z", "+z"))
    mb.box(ho, 0, 0, hw, D, H, wall, skip=("+y", "-z", "+z"))
    if ob > 0.01:
        mb.box(-ho, 0, 0, ho, D, ob, wall, skip=("+y", "-z", "-x", "+x"))
    mb.box(-ho, 0, ot, ho, D, H, wall, skip=("+y", "+z", "-x", "+x"))
    # frame
    fy0, fy1 = 0.2, 0.28
    t = 0.065
    mb.box(-ho, fy0, ob, ho, fy1, ob + t, "Frame", skip=("+y", "-z"))
    mb.box(-ho, fy0, ot - t, ho, fy1, ot, "Frame", skip=("+y", "+z"))
    mb.box(-ho, fy0, ob + t, -ho + t, fy1, ot - t, "Frame", skip=("+y", "-z", "+z", "-x"))
    mb.box(ho - t, fy0, ob + t, ho, fy1, ot - t, "Frame", skip=("+y", "-z", "+z", "+x"))
    if mullion:
        mb.box(-0.03, fy0 - 0.01, ob + t, 0.03, fy1, ot - t, "Frame", skip=("+y", "-z", "+z"))
    if transom:
        zt = ot - (ot - ob) * 0.28
        mb.box(-ho + t, fy0 - 0.01, zt - 0.03, ho - t, fy1, zt + 0.03, "Frame", skip=("+y",))
    # glass with 0..1 UVs over the opening
    gy = 0.26
    mb.quad((-ho, gy, ob), (ho, gy, ob), (ho, gy, ot), (-ho, gy, ot), "WindowGlass")
    return ho


def sill(mb, ho, ob, mat="Concrete"):
    mb.bbox(-ho - 0.08, -0.1, ob - 0.07, ho + 0.08, 0.22, ob + 0.01, mat, c=0.015)


def ac_box(mb, x, z, depth=0.6):
    mb.bbox(x - 0.45, -depth, z, x + 0.45, -0.02, z + 0.62, "Trim", c=0.03, bottom=True)
    M = Matrix.Translation((x + 0.08, -depth - 0.005, z + 0.31)) @ Matrix.Rotation(math.pi / 2, 4, "X")
    mb.prism(0, 0, 0, 0.012, 0.24, 14, "Grille", M=M, top=True)
    for k in range(3):
        mb.box(x - 0.42, -depth - 0.01, z + 0.08 + k * 0.17, x - 0.25, -depth + 0.01, z + 0.12 + k * 0.17, "Grille")
    # brackets and drip pipe
    for bx in (x - 0.35, x + 0.35):
        mb.box(bx - 0.02, -depth + 0.05, z - 0.25, bx + 0.02, -0.02, z - 0.21, "Steel")
        mb.pipe((bx, -0.02, z - 0.23), (bx, -depth + 0.1, z + 0.02), 0.015, "Steel", 4)
    mb.pipe((x + 0.4, -0.3, z), (x + 0.4, -0.3, z - 1.1), 0.015, "Rubber", 4)


def railing(mb, x0, x1, y, z, h=1.05, bars=0.12):
    mb.box(x0, y - 0.03, z + h - 0.05, x1, y + 0.03, z + h, "Steel")
    mb.box(x0, y - 0.02, z + 0.12, x1, y + 0.02, z + 0.15, "Steel")
    n = max(2, int((x1 - x0) / bars))
    for k in range(n + 1):
        x = x0 + (x1 - x0) * k / n
        mb.box(x - 0.012, y - 0.012, z, x + 0.012, y + 0.012, z + h - 0.05, "Steel", skip=("-z", "+z"))


def module_std(name, wall, variant):
    mb = MB()
    W, H = CELL["std"]
    if variant == "balcony":
        ho = window_cell(mb, wall, ob=0.12, ot=2.85, ow=1.7, mullion=True, transom=False)
        mb.bbox(-W / 2 + 0.05, -1.15, -0.02, W / 2 - 0.05, 0.02, 0.16, "Concrete", c=0.03, bottom=True)
        railing(mb, -W / 2 + 0.08, W / 2 - 0.08, -1.1, 0.16)
        for x in (-W / 2 + 0.08, W / 2 - 0.08):
            mb.box(x - 0.012, -1.1, 1.18, x + 0.012, -0.02, 1.21, "Steel")
        # clutter: plant pot or a drying rack
        rng = random.Random(name)
        if rng.random() < 0.5:
            mb.prism(0.7, -0.6, 0.16, 0.55, 0.18, 10, "Rust", r2=0.22)
            mb.sphere(0.7, -0.6, 0.75, 0.3, "Plant", 8, 5, sz=0.8)
        else:
            mb.pipe((-0.9, -0.95, 1.3), (0.6, -0.95, 1.3), 0.01, "Steel", 4)
            for k in range(3):
                mb.quad((-0.8 + k * 0.45, -0.95, 0.75), (-0.45 + k * 0.45, -0.95, 0.75),
                        (-0.45 + k * 0.45, -0.95, 1.3), (-0.8 + k * 0.45, -0.95, 1.3), "Fabric")
                mb.quad((-0.45 + k * 0.45, -0.95, 0.75), (-0.8 + k * 0.45, -0.95, 0.75),
                        (-0.8 + k * 0.45, -0.95, 1.3), (-0.45 + k * 0.45, -0.95, 1.3), "Fabric")
    elif variant == "blank":
        mb.box(-W / 2, 0, 0, W / 2, D, H, wall, skip=("+y", "-z", "+z"))
        # louvred vent panel and a junction box
        mb.bbox(-0.5, -0.05, 1.3, 0.5, 0.02, 2.2, "Trim", c=0.02)
        for k in range(7):
            z = 1.36 + k * 0.12
            mb.box(-0.44, -0.09, z, 0.44, -0.04, z + 0.04, "Grille")
        mb.bbox(0.75, -0.18, 0.6, 1.05, 0.0, 1.0, "Trim", c=0.015)
        mb.pipe((0.9, -0.1, 1.0), (0.9, -0.1, H), 0.03, "Rubber", 5)
    else:
        ho = window_cell(mb, wall)
        sill(mb, ho, 0.95, wall if wall == "Concrete" else "Trim")
        if variant == "ac":
            ac_box(mb, 0.25, 0.25)
        if variant == "awning":
            v = [(-ho - 0.1, 0.0, 3.05), (ho + 0.1, 0.0, 3.05), (ho + 0.1, -0.7, 2.7), (-ho - 0.1, -0.7, 2.7)]
            mb.quad(*v, "AwningB")
            mb.quad(v[3], v[2], v[1], v[0], "AwningB")
    return mb.build(name)


def module_ribbon(name):
    """Curtain-wall cell: mullions, spandrel panel, full-height glass."""
    mb = MB()
    W, H = CELL["ribbon"]
    hw = W / 2
    sp = 0.75
    mb.box(-hw, 0.0, 0, hw, 0.12, sp, "Cladding", skip=("+y", "-z"))
    gy = 0.08
    mb.quad((-hw, gy, sp), (hw, gy, sp), (hw, gy, H), (-hw, gy, H), "WindowGlass")
    for x in (-hw, hw):
        mb.bbox(x - 0.05, -0.16, 0, x + 0.05, 0.1, H, "Trim", c=0.015, bottom=False)
    mb.bbox(-hw, -0.06, sp - 0.04, hw, 0.09, sp + 0.04, "Trim", c=0.01, bottom=True)
    mb.bbox(-hw, -0.04, H - 0.05, hw, 0.09, H, "Trim", c=0.01, bottom=True)
    return mb.build(name)


def module_shop(name, kind):
    mb = MB()
    W, H = CELL["shop"]
    hw = W / 2
    mb.bbox(-hw, -0.06, 0, -hw + 0.3, D, H, "Concrete", c=0.03)
    mb.bbox(hw - 0.3, -0.06, 0, hw, D, H, "Concrete", c=0.03)
    mb.box(-hw + 0.3, 0, 3.3, hw - 0.3, D, H, "Concrete", skip=("+y", "+z", "-x", "+x"))
    x0, x1 = -hw + 0.3, hw - 0.3
    if kind == "shutter":
        mb.box(x0, 0.08, 0.0, x1, D, 3.3, "Cladding", skip=("+y", "-x", "+x", "-z"))
        for k in range(30):
            z = 0.05 + k * 0.105
            mb.box(x0 + 0.02, 0.05, z, x1 - 0.02, 0.08, z + 0.05, "Steel", skip=("+y",))
        mb.bbox(x0, -0.12, 3.05, x1, 0.08, 3.32, "Trim", c=0.02, bottom=True)
        mb.box(x0 + 0.2, 0.02, 0.0, x0 + 0.5, 0.05, 0.1, "Steel")
    else:
        mb.box(x0, 0.0, 0.0, x1, 0.32, 0.4, "Trim", skip=("+y", "-x", "+x", "-z"))
        mb.quad((x0, 0.25, 0.4), (x1, 0.25, 0.4), (x1, 0.25, 3.3), (x0, 0.25, 3.3), "ShopGlass")
        t = 0.06
        for x in (x0, -0.35, 0.35, x1 - t):
            mb.box(x, 0.18, 0.4, x + t, 0.27, 3.3, "Frame", skip=("+y",))
        mb.box(x0, 0.18, 2.6, x1, 0.27, 2.66, "Frame", skip=("+y",))
        if kind == "neon":
            for (a, b) in (((x0 + 0.1, 0.12, 2.75), (x1 - 0.1, 0.12, 2.75)),):
                mb.box(a[0], 0.08, 2.72, b[0], 0.13, 2.78, "NeonPink")
            mb.box(x0 + 0.1, 0.08, 0.5, x0 + 0.16, 0.13, 2.72, "NeonPink")
            mb.box(x1 - 0.16, 0.08, 0.5, x1 - 0.1, 0.13, 2.72, "NeonPink")
        # small lit menu panel
        mb.box(x1 - 0.9, 0.16, 1.2, x1 - 0.35, 0.2, 2.0, "Screenlet")
    return mb.build(name)


module_std("cell_std", "Concrete", "std")
module_std("cell_ac", "Concrete", "ac")
module_std("cell_balcony", "Concrete", "balcony")
module_std("cell_blank", "Concrete", "blank")
module_std("cell_awning", "Concrete", "awning")
module_std("cell_clad", "Cladding", "std")
module_std("cell_clad_ac", "Cladding", "ac")
module_std("cell_clad_blank", "Cladding", "blank")
module_ribbon("cell_ribbon")
module_shop("shop_glass", "glass")
module_shop("shop_shutter", "shutter")
module_shop("shop_neon", "neon")

# ---------------------------------------------------------------------------- tower shells
FACADES = {}


class Shell:
    def __init__(self, name, w, d, seed):
        self.name = name
        self.mb = MB()
        self.rng = random.Random(seed)
        self.walls = []
        self.w, self.d = w, d

    def wall(self, a, b, z0, z1, fam, outward_ref=(0, 0)):
        """Register a facade wall from footprint points a, b (Blender XY)."""
        a, b = Vector((*a, 0)), Vector((*b, 0))
        seg = b - a
        L = seg.length
        n = Vector((seg.y, -seg.x, 0)).normalized()
        mid = (a + b) / 2
        if n.dot(mid - Vector((*outward_ref, 0))) < 0:
            n = -n
        u = Vector((-n.y, n.x, 0))
        start = a if seg.dot(u) > 0 else b
        cw, ch = CELL["shop" if fam == "shop" else ("ribbon" if fam == "ribbon" else "std")]
        cols = max(1, round(L / cw))
        rows = max(1, round((z1 - z0) / ch))
        self.walls.append({
            "s": [round(start.x, 3), round(z0, 3), round(-start.y, 3)],
            "u": [round(u.x, 5), 0, round(-u.y, 5)],
            "n": [round(n.x, 5), 0, round(-n.y, 5)],
            "w": round(L, 3), "cols": cols, "rows": rows,
            "cw": round(L / cols, 4), "ch": round((z1 - z0) / rows, 4), "fam": fam,
        })
        return rows, (z1 - z0) / rows

    def rect_walls(self, x0, y0, x1, y1, z0, z1, fam, sides="nsew", fams=None):
        c = ((x0 + x1) / 2, (y0 + y1) / 2)
        out = {}
        segs = {"s": ((x0, y0), (x1, y0)), "n": ((x0, y1), (x1, y1)), "w": ((x0, y0), (x0, y1)), "e": ((x1, y0), (x1, y1))}
        for k in sides:
            out[k] = self.wall(*segs[k], z0, z1, (fams or {}).get(k, fam), c)
        return out

    def core(self, x0, y0, x1, y1, z0, z1):
        i = D + 0.02
        self.mb.box(x0 + i, y0 + i, z0, x1 - i, y1 - i, z1, "ConcreteDark")

    def corners(self, x0, y0, x1, y1, z0, z1, s=0.85, mat="Concrete"):
        for (cx, cy) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            self.mb.bbox(cx - s / 2, cy - s / 2, z0, cx + s / 2, cy + s / 2, z1, mat, c=0.06)

    def ledges(self, x0, y0, x1, y1, z0, ch, rows, every=4, mat="Concrete"):
        for k in range(every, rows, every):
            z = z0 + k * ch
            self.mb.bbox(x0 - 0.3, y0 - 0.3, z - 0.11, x1 + 0.3, y1 + 0.3, z + 0.11, mat, c=0.04, bottom=True)

    def podium(self, w, d, neon):
        hw, hd = w / 2, d / 2
        self.rect_walls(-hw, -hd, hw, hd, 0.0, 4.0, "shop")
        self.core(-hw, -hd, hw, hd, 0.0, 5.0)
        # fascia band with a lit soffit underneath
        self.mb.bbox(-hw - 0.25, -hd - 0.25, 4.0, hw + 0.25, hd + 0.25, 5.0, "Concrete", c=0.05, bottom=True)
        for (a, b, c_, e) in ((-hw, -hd - 0.25, hw, -hd - 0.2), (-hw, hd + 0.2, hw, hd + 0.25),
                              (-hw - 0.25, -hd, -hw - 0.2, hd), (hw + 0.2, -hd, hw + 0.25, hd)):
            self.mb.box(a, b, 3.98, c_, e, 4.03, neon or "LampWarm", skip=("+z",))
        self.corners(-hw, -hd, hw, hd, 0.0, 4.0, s=0.7)

    def roof(self, x0, y0, x1, y1, z, tall=False, neon=None):
        mb, rng = self.mb, self.rng
        t, ph = 0.4, 1.15
        for (a0, b0, a1, b1) in ((x0, y0, x1, y0 + t), (x0, y1 - t, x1, y1), (x0, y0 + t, x0 + t, y1 - t), (x1 - t, y0 + t, x1, y1 - t)):
            mb.box(a0, b0, z, a1, b1, z + ph, "Concrete", skip=("-z",))
            mb.bbox(a0 - 0.05, b0 - 0.05, z + ph, a1 + 0.05, b1 + 0.05, z + ph + 0.12, "Trim", c=0.02, bottom=True)
        mb.box(x0 + t, y0 + t, z, x1 - t, y1 - t, z + 0.1, "Roof", skip=("-z",))
        w, d = x1 - x0, y1 - y0
        area = w * d
        # stair / lift overrun
        if area > 120:
            ox = rng.uniform(x0 + 2.5, x1 - 5.5)
            oy = rng.uniform(y0 + 2.5, y1 - 4.5)
            mb.bbox(ox, oy, z, ox + 3.2, oy + 2.6, z + 3.2, "Concrete", c=0.05)
            mb.box(ox + 1.0, oy - 0.02, z + 0.1, ox + 2.0, oy, z + 2.2, "Trim")
            mb.box(ox + 1.3, oy - 0.04, z + 2.3, ox + 1.7, oy - 0.02, z + 2.4, "LampCold")
            mb.bbox(ox - 0.1, oy - 0.1, z + 3.2, ox + 3.3, oy + 2.7, z + 3.35, "Trim", c=0.02, bottom=True)
        # AC plant units with fans and louvres
        for _ in range(rng.randint(2, 5) if area > 150 else 1):
            bw, bd = rng.uniform(1.8, 3.6), rng.uniform(1.2, 2.0)
            cx = rng.uniform(x0 + 1.2 + bw / 2, max(x0 + 1.3 + bw / 2, x1 - 1.2 - bw / 2))
            cy = rng.uniform(y0 + 1.2 + bd / 2, max(y0 + 1.3 + bd / 2, y1 - 1.2 - bd / 2))
            hh = rng.uniform(1.1, 1.6)
            for fx in (cx - bw / 2 + 0.15, cx + bw / 2 - 0.15):
                mb.box(fx - 0.06, cy - bd / 2, z + 0.1, fx + 0.06, cy + bd / 2, z + 0.3, "Steel")
            mb.bbox(cx - bw / 2, cy - bd / 2, z + 0.3, cx + bw / 2, cy + bd / 2, z + 0.3 + hh, "Cladding", c=0.04)
            for k in range(int(hh / 0.12) - 1):
                zz = z + 0.42 + k * 0.12
                mb.box(cx - bw / 2 + 0.15, cy - bd / 2 - 0.04, zz, cx + bw / 2 - 0.15, cy - bd / 2, zz + 0.05, "Grille")
            nf = max(1, int(bw / 1.2))
            for k in range(nf):
                fx = cx - bw / 2 + bw * (k + 0.5) / nf
                top = z + 0.3 + hh
                mb.prism(fx, cy, top, top + 0.18, min(0.5, bd * 0.36), 16, "Trim", top=False)
                mb.prism(fx, cy, top + 0.02, top + 0.05, min(0.48, bd * 0.34), 16, "Grille")
                for bl in range(3):
                    a = bl * 2.094 + k
                    mb.box(fx - 0.04, cy - 0.04, top + 0.06, fx + 0.04 + 0.4 * math.cos(a), cy + 0.04 + 0.4 * math.sin(a), top + 0.08, "Steel")
        # water tank on a braced stand
        if area > 160 and rng.random() < 0.75:
            r = rng.uniform(1.3, 1.9)
            cx = rng.uniform(x0 + r + 1.2, x1 - r - 1.2)
            cy = rng.uniform(y0 + r + 1.2, y1 - r - 1.2)
            legs = []
            for a in range(4):
                ang = a * math.pi / 2 + math.pi / 4
                lx, ly = cx + math.cos(ang) * r * 0.75, cy + math.sin(ang) * r * 0.75
                mb.box(lx - 0.1, ly - 0.1, z, lx + 0.1, ly + 0.1, z + 2.4, "Rust")
                legs.append((lx, ly))
            for a in range(4):
                p, q = legs[a], legs[(a + 1) % 4]
                mb.pipe((p[0], p[1], z + 0.2), (q[0], q[1], z + 2.2), 0.03, "Rust", 4)
                mb.pipe((p[0], p[1], z + 2.2), (q[0], q[1], z + 0.2), 0.03, "Rust", 4)
            mb.prism(cx, cy, z + 2.4, z + 5.4, r, 20, "Wood", bottom=True, top=False)
            for k in range(4):
                zz = z + 2.7 + k * 0.75
                mb.prism(cx, cy, zz, zz + 0.06, r + 0.03, 20, "Steel", top=False)
            mb.prism(cx, cy, z + 5.4, z + 6.3, r + 0.08, 20, "Rust", r2=0.12)
            # ladder
            lx = cx + r + 0.15
            for yy in (cy - 0.22, cy + 0.22):
                mb.box(lx - 0.02, yy - 0.02, z, lx + 0.02, yy + 0.02, z + 5.6, "Steel")
            for k in range(18):
                mb.box(lx - 0.015, cy - 0.22, z + 0.3 + k * 0.3, lx + 0.015, cy + 0.22, z + 0.33 + k * 0.3, "Steel")
        # vent stacks
        for _ in range(rng.randint(2, 5)):
            vx, vy = rng.uniform(x0 + 0.8, x1 - 0.8), rng.uniform(y0 + 0.8, y1 - 0.8)
            hgt = rng.uniform(0.8, 2.4)
            mb.prism(vx, vy, z, z + hgt, rng.uniform(0.1, 0.22), 10, "Steel", top=False)
            mb.prism(vx, vy, z + hgt, z + hgt + 0.18, 0.3, 10, "Trim", r2=0.05)
        # antenna mast with guy wires and beacon
        if tall or rng.random() < 0.65:
            ax, ay = rng.uniform(x0 + 2, x1 - 2), rng.uniform(y0 + 2, y1 - 2)
            hh = rng.uniform(7, 15) * (1.6 if tall else 1)
            for k in range(3):
                a = k * 2.094
                mb.pipe((ax + 0.2 * math.cos(a), ay + 0.2 * math.sin(a), z), (ax + 0.05 * math.cos(a), ay + 0.05 * math.sin(a), z + hh), 0.03, "Steel", 4)
            for k in range(1, int(hh / 1.2)):
                zz = z + k * 1.2
                mb.pipe((ax - 0.18, ay, zz), (ax + 0.18, ay + 0.1, zz + 0.6), 0.012, "Steel", 3)
            for k in range(3):
                a = k * 2.094 + 0.5
                g = (ax + math.cos(a) * min(w, d) * 0.4, ay + math.sin(a) * min(w, d) * 0.4, z + 0.1)
                mb.pipe(g, (ax, ay, z + hh * 0.75), 0.008, "Steel", 3)
            for k in (0.5, 0.8):
                mb.box(ax - 0.5, ay - 0.04, z + hh * k, ax + 0.5, ay + 0.04, z + hh * k + 0.06, "Steel")
                mb.box(ax + 0.45, ay - 0.1, z + hh * k - 0.4, ax + 0.55, ay + 0.1, z + hh * k + 0.2, "Trim")
            mb.sphere(ax, ay, z + hh + 0.25, 0.24, "Beacon", 10, 6)
        # dishes
        for _ in range(rng.randint(0, 2)):
            dx, dy = rng.uniform(x0 + 1.5, x1 - 1.5), rng.uniform(y0 + 1.5, y1 - 1.5)
            mb.prism(dx, dy, z, z + 1.3, 0.07, 8, "Steel")
            M = Matrix.Translation((dx, dy, z + 1.7)) @ Matrix.Rotation(rng.uniform(0.5, 1.0), 4, "X") @ Matrix.Rotation(rng.uniform(0, 6.28), 4, "Z")
            mb.prism(0, 0, -0.35, -0.12, 0.15, 18, "Trim", M=M, r2=0.75, top=False)
            mb.prism(0, 0, -0.12, 0.08, 0.75, 18, "Steel", M=M, r2=0.95, top=False)
            mb.pipe(M @ Vector((0, 0, 0.0)), M @ Vector((0, 0, 0.7)), 0.02, "Steel", 4)
        # cable trays / pipes running across the roof
        for _ in range(rng.randint(1, 3)):
            yy = rng.uniform(y0 + 1, y1 - 1)
            mb.pipe((x0 + 0.5, yy, z + 0.35), (x1 - 0.5, yy, z + 0.35), 0.08, "Rust", 8)
            for k in range(int(w / 2)):
                xx = x0 + 1 + k * 2
                mb.box(xx - 0.05, yy - 0.12, z + 0.1, xx + 0.05, yy + 0.12, z + 0.28, "Steel")
        if neon and rng.random() < 0.5:
            s = 0.1
            zz = z + ph + 0.12
            mb.box(x0, y0 - s, zz, x1, y0, zz + s, neon)
            mb.box(x0, y1, zz, x1, y1 + s, zz + s, neon)
            mb.box(x0 - s, y0, zz, x0, y1, zz + s, neon)
            mb.box(x1, y0, zz, x1 + s, y1, zz + s, neon)

    def pipes_on(self, x0, y0, x1, y1, z0, z1, side, n=2):
        """Downpipes on one face, in front of the modules' piers."""
        for k in range(n):
            t = self.rng.uniform(0.1, 0.9)
            if side in "sn":
                x = x0 + (x1 - x0) * t
                y = (y0 - 0.25) if side == "s" else (y1 + 0.25)
                self.mb.pipe((x, y, z0), (x, y, z1), 0.09, "Rust", 8)
                for zz in range(int(z0) + 2, int(z1), 3):
                    self.mb.box(x - 0.12, min(y, y + (0.25 if side == "s" else -0.25)), zz, x + 0.12, max(y, y + (0.25 if side == "s" else -0.25)), zz + 0.06, "Steel")
            else:
                y = y0 + (y1 - y0) * t
                x = (x0 - 0.25) if side == "w" else (x1 + 0.25)
                self.mb.pipe((x, y, z0), (x, y, z1), 0.09, "Rust", 8)

    def fire_escape(self, x0, x1, y, z0, z1, ch, out=-1):
        """Zig-zag fire escape on a south (out=-1) or north (+1) face."""
        mb = self.mb
        depth = 1.3
        ya, yb = (y - depth, y) if out < 0 else (y, y + depth)
        z = z0 + ch
        k = 0
        while z < z1 - 0.5:
            mb.box(x0, ya, z - 0.06, x1, yb, z, "Grille", skip=())
            yr = ya if out < 0 else yb
            railing(mb, x0, x1, yr, z, h=1.0, bars=0.3)
            # stair to the next landing
            if z + ch < z1 - 0.5:
                sx0, sx1 = (x0 + 0.2, x1 - 1.2) if k % 2 == 0 else (x1 - 0.2, x0 + 1.2)
                steps = 12
                for s in range(steps):
                    t0 = s / steps
                    xs = sx0 + (sx1 - sx0) * t0
                    zs = z + ch * t0
                    mb.box(min(xs, xs + 0.25 * (1 if sx1 > sx0 else -1)), ya + 0.1, zs, max(xs, xs + 0.25 * (1 if sx1 > sx0 else -1)), yb - 0.1, zs + 0.04, "Grille")
                mb.pipe((sx0, yr, z + 1.0), (sx1, yr, z + ch + 1.0), 0.02, "Steel", 4)
            z += ch
            k += 1
        for x in (x0, x1):
            yy = ya if out < 0 else yb
            mb.box(x - 0.04, yy - 0.04, z0 + ch - 0.5, x + 0.04, yy + 0.04, z1 - 1, "Steel")

    def finish(self):
        FACADES[self.name] = {"walls": self.walls, "w": self.w, "d": self.d}
        return self.mb.build(self.name)


def tower(name, style, w, d, h, seed, neon):
    S = Shell(name, w, d, seed)
    rng = S.rng
    hw, hd = w / 2, d / 2
    S.podium(w, d, neon)
    z0 = 5.0
    i = 0.5
    x0, y0, x1, y1 = -hw + i, -hd + i, hw - i, hd - i
    if style in ("block", "market"):
        fam = "clad" if rng.random() < 0.4 and style == "block" else "std"
        fe = style == "block" and rng.random() < 0.6
        rows = S.rect_walls(x0, y0, x1, y1, z0, h, fam, fams={"s": "flat"} if fe else None)
        nr, ch = rows["n"]
        S.core(x0, y0, x1, y1, z0, h)
        S.corners(x0, y0, x1, y1, z0, h + 0.2)
        S.ledges(x0, y0, x1, y1, z0, ch, nr, every=4)
        if fe:
            S.fire_escape(x0 + 2.0, min(x1 - 2.0, x0 + 7.0), y0 - 0.0, z0, h, ch, out=-1)
        S.pipes_on(x0, y0, x1, y1, z0, h, "e", 1)
        S.roof(x0, y0, x1, y1, h, neon=neon)
        if style == "market":
            for k in range(5):
                yy = y0 + (y1 - y0) * (k + 0.5) / 5
                n = int((x1 - x0) // 1.3)
                for q in range(n):
                    S.mb.sphere(x0 + 0.65 + q * 1.3, yy, h + 3.2 - 0.35 * math.sin(math.pi * q / max(1, n - 1)), 0.13, "LampWarm", 8, 5)
                S.mb.pipe((x0 + 0.3, yy, h + 3.3), (x1 - 0.3, yy, h + 3.3), 0.01, "Rubber", 3)
            for (px, py) in ((x0 + 0.5, y0 + 0.5), (x1 - 0.5, y0 + 0.5), (x0 + 0.5, y1 - 0.5), (x1 - 0.5, y1 - 0.5)):
                S.mb.prism(px, py, h, h + 3.5, 0.08, 8, "Steel")
    elif style == "setback":
        zb = z0
        tiers = 3
        for t in range(tiers):
            zt = h if t == tiers - 1 else z0 + (h - z0) * (t + 1) / tiers
            zt = z0 + round((zt - z0) / 3.3) * 3.3 if t < tiers - 1 else zt
            fam = "std" if t == 0 else ("clad" if t == 1 else "ribbon")
            rows = S.rect_walls(x0, y0, x1, y1, zb, zt, fam)
            nr, ch = rows["n"]
            S.core(x0, y0, x1, y1, zb, zt)
            S.corners(x0, y0, x1, y1, zb, zt + 0.15, s=0.9, mat="Concrete" if t < 2 else "Trim")
            S.ledges(x0, y0, x1, y1, zb, ch, nr, every=3)
            if neon:
                for (cx, cy) in ((x0, y0), (x1, y1)):
                    S.mb.box(cx - 0.55, cy - 0.55, zb + 1.0, cx - 0.4, cy - 0.4, zt - 0.6, neon)
            ins = min(x1 - x0, y1 - y0) * rng.uniform(0.13, 0.17)
            if t < tiers - 1:
                # terrace: roof, railing, planters
                S.mb.box(x0, y0, zt, x1, y1, zt + 0.12, "Roof", skip=("-z",))
                for (a0, b0, a1, b1) in ((x0, y0, x1, y0), (x0, y1, x1, y1)):
                    railing(S.mb, a0, a1, b0 + (0.1 if b0 == y0 else -0.1), zt + 0.12, bars=0.2)
                for k in range(3):
                    px = x0 + 1.5 + k * (x1 - x0 - 3) / 2
                    S.mb.bbox(px - 0.8, y0 + 0.4, zt + 0.12, px + 0.8, y0 + 1.2, zt + 0.7, "Concrete", c=0.03)
                    S.mb.sphere(px, y0 + 0.8, zt + 1.1, 0.7, "Plant", 10, 6, sz=0.7)
                S.roof(x0 + ins * 0.3, y1 - ins * 0.9, x1 - ins * 0.3, y1 - 0.4, zt + 0.12)
            else:
                S.roof(x0, y0, x1, y1, zt, tall=True, neon=neon)
            x0, y0, x1, y1 = x0 + ins, y0 + ins, x1 - ins, y1 - ins
            zb = zt
    elif style == "slab":
        long_x = (x1 - x0) >= (y1 - y0)
        fams = {"s": "balcony", "n": "balcony", "w": "flat", "e": "flat"} if long_x else {"w": "balcony", "e": "balcony", "s": "flat", "n": "flat"}
        rows = S.rect_walls(x0, y0, x1, y1, z0, h, "std", fams=fams)
        nr, ch = rows["n"]
        S.core(x0, y0, x1, y1, z0, h)
        S.corners(x0, y0, x1, y1, z0, h + 0.2, s=1.0)
        S.ledges(x0, y0, x1, y1, z0, ch, nr, every=5)
        S.pipes_on(x0, y0, x1, y1, z0, h, "w" if long_x else "s", 2)
        S.roof(x0, y0, x1, y1, h, neon=neon)
    elif style == "glass":
        i2 = 1.0
        x0, y0, x1, y1 = -hw + i2, -hd + i2, hw - i2, hd - i2
        c = min(x1 - x0, y1 - y0) * 0.2
        pts = [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]
        nr, ch = 1, 3.6
        for k in range(8):
            nr, ch = S.wall(pts[k], pts[(k + 1) % 8], z0, h, "ribbon")
        inner = [(p[0] * 0.92, p[1] * 0.92) for p in pts]
        bz = [S.mb.vert((p[0], p[1], z0)) for p in inner]
        tz = [S.mb.vert((p[0], p[1], h)) for p in inner]
        for k in range(8):
            k2 = (k + 1) % 8
            S.mb.face((bz[k], bz[k2], tz[k2], tz[k]), "ConcreteDark")
        S.mb.face(tz, "Roof")
        for p in pts:
            S.mb.bbox(p[0] - 0.22, p[1] - 0.22, z0, p[0] + 0.22, p[1] + 0.22, h + 0.3, "Trim", c=0.05)
        for k in range(4, nr, 4):
            z = z0 + k * ch
            for j in range(8):
                p, q = Vector((*pts[j], 0)), Vector((*pts[(j + 1) % 8], 0))
                mid, L = (p + q) / 2, (q - p).length
                ang = math.atan2(q.y - p.y, q.x - p.x)
                M = Matrix.Translation((mid.x, mid.y, z)) @ Matrix.Rotation(ang, 4, "Z")
                S.mb.bbox(-L / 2 - 0.2, -0.35, -0.1, L / 2 + 0.2, 0.1, 0.1, "Trim", c=0.02, M=M, bottom=True)
        if neon:
            for j in range(8):
                p, q = Vector((*pts[j], 0)), Vector((*pts[(j + 1) % 8], 0))
                mid, L = (p + q) / 2, (q - p).length
                ang = math.atan2(q.y - p.y, q.x - p.x)
                for zz in (h - 0.5, h - 4.4):
                    M = Matrix.Translation((mid.x, mid.y, zz)) @ Matrix.Rotation(ang, 4, "Z")
                    S.mb.box(-L / 2, -0.42, -0.08, L / 2, -0.3, 0.08, neon, M=M)
        cx0, cy0, cx1, cy1 = x0 + c, y0 + c, x1 - c, y1 - c
        S.rect_walls(cx0, cy0, cx1, cy1, h, h + 7.2, "ribbon")
        S.core(cx0, cy0, cx1, cy1, h, h + 7.2)
        S.roof(cx0, cy0, cx1, cy1, h + 7.2, tall=True)
        S.mb.prism(0, 0, h + 7.2, h + 30, 0.55, 8, "Steel", r2=0.08)
        for k in range(1, 6):
            S.mb.prism(0, 0, h + 7.2 + k * 3.8, h + 7.4 + k * 3.8, 0.9 - k * 0.12, 8, "Trim")
        S.mb.sphere(0, 0, h + 30.3, 0.4, "Beacon", 10, 6)
    elif style == "cylinder":
        r = min(hw, hd) - 0.8
        n = 24
        pts = [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n)) for k in range(n)]
        nr, ch = 1, 3.6
        for k in range(n):
            nr, ch = S.wall(pts[k], pts[(k + 1) % n], z0, h, "ribbon")
        S.mb.prism(0, 0, z0, h, r - 0.4, n, "ConcreteDark", smooth=False)
        S.mb.prism(0, 0, h - 0.01, h, r, n, "Roof")
        for k in range(4, nr, 4):
            z = z0 + k * ch
            S.mb.prism(0, 0, z - 0.15, z + 0.15, r + 0.45, n, "Trim", bottom=True)
            if neon and (k // 4) % 2 == 1:
                S.mb.prism(0, 0, z + 0.15, z + 0.3, r + 0.3, n, neon)
        for p in pts[::2]:
            S.mb.bbox(p[0] - 0.12, p[1] - 0.12, z0, p[0] + 0.12, p[1] + 0.12, h, "Trim", c=0.03)
        s = r * 0.66
        S.roof(-s, -s, s, s, h, tall=True, neon=neon)
    elif style == "stack":
        z = z0
        bx0, by0, bx1, by1 = x0, y0, x1, y1
        k = 0
        while z < h - 2:
            nf = rng.randint(2, 4)
            zt = min(h, z + 3.3 * nf)
            ox0 = bx0 + rng.uniform(-1.2, 1.0)
            oy0 = by0 + rng.uniform(-1.2, 1.0)
            ox1 = bx1 + rng.uniform(-1.0, 1.2)
            oy1 = by1 + rng.uniform(-1.0, 1.2)
            fam = rng.choice(["std", "std", "clad", "balcony"]) if k else "std"
            rows = S.rect_walls(ox0, oy0, ox1, oy1, z, zt, fam)
            S.core(ox0, oy0, ox1, oy1, z, zt)
            S.corners(ox0, oy0, ox1, oy1, z, zt, s=0.7)
            S.mb.bbox(ox0 - 0.25, oy0 - 0.25, z - 0.12, ox1 + 0.25, oy1 + 0.25, z + 0.12, "Concrete", c=0.04, bottom=True)
            if neon and rng.random() < 0.35:
                S.mb.box(ox0, oy0 - 0.4, z + 0.12, ox1, oy0 - 0.3, z + 0.25, neon)
            z = zt
            k += 1
        S.mb.bbox(ox0 - 0.25, oy0 - 0.25, z - 0.12, ox1 + 0.25, oy1 + 0.25, z + 0.05, "Concrete", c=0.04, bottom=True)
        S.roof(ox0, oy0, ox1, oy1, z, neon=neon)
        for _ in range(rng.randint(1, 3)):
            sw, sd = rng.uniform(2.5, 4.5), rng.uniform(2.5, 3.5)
            cx = rng.uniform(ox0 + sw / 2 + 0.8, ox1 - sw / 2 - 0.8)
            cy = rng.uniform(oy0 + sd / 2 + 0.8, oy1 - sd / 2 - 0.8)
            S.mb.bbox(cx - sw / 2, cy - sd / 2, z, cx + sw / 2, cy + sd / 2, z + 2.6, "Rust", c=0.03)
            S.mb.bbox(cx - sw / 2 - 0.3, cy - sd / 2 - 0.3, z + 2.6, cx + sw / 2 + 0.3, cy + sd / 2 + 0.3, z + 2.75, "Cladding", c=0.02, bottom=True)
            S.mb.box(cx - 0.4, cy - sd / 2 - 0.02, z + 0.05, cx + 0.4, cy - sd / 2, z + 2.0, "Trim")
            S.mb.box(cx + 0.6, cy - sd / 2 - 0.02, z + 1.2, cx + 1.4, cy - sd / 2, z + 1.8, "ShopLit")
    return S.finish()


TOWERS = [
    ("tower_stack_a", "stack", 16, 16, 34, "NeonPink"),
    ("tower_stack_b", "stack", 18, 14, 46, "NeonCyan"),
    ("tower_stack_c", "stack", 14, 12, 27, "NeonAmber"),
    ("tower_block_a", "block", 20, 20, 44.6, "NeonViolet"),
    ("tower_block_b", "block", 16, 22, 58, None),
    ("tower_setback_a", "setback", 22, 22, 80, "NeonCyan"),
    ("tower_setback_b", "setback", 20, 18, 64, "NeonPink"),
    ("tower_slab_a", "slab", 22, 12, 51.2, "NeonAmber"),
    ("tower_slab_b", "slab", 12, 20, 41.3, None),
    ("tower_glass_a", "glass", 22, 22, 112, "NeonCyan"),
    ("tower_glass_b", "glass", 18, 18, 91.4, "NeonViolet"),
    ("tower_cylinder_a", "cylinder", 19, 19, 73.4, "NeonPink"),
    ("tower_market_a", "market", 20, 16, 14.9, "NeonGreen"),
    ("tower_market_b", "market", 16, 16, 11.6, "NeonAmber"),
]
for k, (n, st, w, d, h, ne) in enumerate(TOWERS):
    tower(n, st, w, d, h, 2000 + k * 37, ne)


# ---------------------------------------------------------------------------- props
def prop_lamp():
    mb = MB()
    mb.prism(0, 0, 0, 0.12, 0.3, 12, "Steel")
    mb.prism(0, 0, 0.12, 0.9, 0.16, 12, "Frame")
    mb.prism(0, 0, 0.9, 7.0, 0.11, 12, "Frame", r2=0.08)
    for zz in (0.9, 3.0, 5.5):
        mb.prism(0, 0, zz, zz + 0.08, 0.15, 12, "Steel")
    mb.prism(0, 0, 3.08, 3.2, 0.12, 12, "NeonCyan")
    # curved arm (segments)
    pts = [(0, 0, 6.8), (0.5, 0, 7.15), (1.1, 0, 7.3), (1.8, 0, 7.25)]
    for a, b in zip(pts, pts[1:]):
        mb.pipe(a, b, 0.06, "Frame", 8)
    mb.bbox(1.3, -0.25, 6.95, 2.3, 0.25, 7.3, "Frame", c=0.04, bottom=True)
    mb.box(1.36, -0.2, 6.93, 2.24, 0.2, 6.96, "LampCold", skip=("+z",))
    # small hanging sign box
    mb.bbox(0.12, -0.04, 2.0, 0.62, 0.04, 2.7, "Trim", c=0.01, bottom=True)
    return mb.build("prop_lamp")


def prop_vending():
    mb = MB()
    mb.bbox(-0.5, -0.42, 0, 0.5, 0.42, 1.95, "Cladding", c=0.03)
    mb.box(-0.44, -0.44, 0.75, 0.2, -0.42, 1.82, "Glass")
    mb.box(-0.42, -0.425, 0.77, 0.18, -0.415, 1.8, "ShopLit")
    for k in range(4):
        z = 0.95 + k * 0.22
        mb.box(-0.42, -0.45, z, 0.18, -0.43, z + 0.02, "Steel")
    mb.box(0.24, -0.44, 1.3, 0.44, -0.42, 1.7, "Screenlet")
    for k in range(6):
        mb.box(0.27 + (k % 2) * 0.09, -0.45, 0.9 + (k // 2) * 0.1, 0.33 + (k % 2) * 0.09, -0.42, 0.95 + (k // 2) * 0.1, "Steel")
    mb.box(-0.4, -0.46, 0.18, 0.4, -0.42, 0.5, "Frame")
    mb.box(-0.5, -0.47, 1.88, 0.5, -0.42, 1.95, "NeonPink")
    return mb.build("prop_vending")


def prop_kiosk():
    mb = MB()
    mb.bbox(-1.5, -1.0, 0, 1.5, 1.0, 1.0, "Rust", c=0.04)
    mb.bbox(-1.65, -1.2, 1.0, 1.65, 1.15, 1.08, "Wood", c=0.02, bottom=True)
    for (x, y) in ((-1.45, -0.95), (1.45, -0.95), (-1.45, 0.95), (1.45, 0.95)):
        mb.box(x - 0.05, y - 0.05, 1.08, x + 0.05, y + 0.05, 2.65, "Frame")
    mb.box(-1.4, 0.88, 1.08, 1.4, 1.0, 2.55, "ShopLit")
    # shelves with jars
    for k in range(2):
        z = 1.5 + k * 0.45
        mb.box(-1.35, 0.6, z, 1.35, 0.88, z + 0.03, "Wood")
        for j in range(9):
            mb.prism(-1.2 + j * 0.3, 0.74, z + 0.03, z + 0.22, 0.07, 8, "Glass")
    # menu boards (text atlas)
    mb.quad((-1.3, 0.86, 2.0), (-0.2, 0.86, 2.0), (-0.2, 0.86, 2.45), (-1.3, 0.86, 2.45), "SignFace")
    # pots
    for x in (-0.8, 0.4):
        mb.prism(x, 0.2, 1.08, 1.45, 0.25, 14, "Steel", bottom=False)
    v = [(-1.85, -1.7, 2.5), (1.85, -1.7, 2.5), (1.85, 1.2, 2.9), (-1.85, 1.2, 2.9)]
    mb.quad(*v, "Awning")
    mb.quad(v[3], v[2], v[1], v[0], "Awning")
    for k in range(9):
        x = -1.85 + k * 3.7 / 8
        mb.box(x - 0.2, -1.72, 2.25, x + 0.2, -1.68, 2.5, "Awning" if k % 2 else "Fabric")
    mb.box(-1.85, -1.74, 2.46, 1.85, -1.66, 2.52, "NeonAmber")
    for k in range(4):
        mb.sphere(-1.2 + k * 0.8, -1.45, 2.0, 0.17, "LampWarm", 10, 6, sz=1.3)
        mb.pipe((-1.2 + k * 0.8, -1.45, 2.2), (-1.2 + k * 0.8, -1.45, 2.45), 0.012, "Rubber", 4)
    for k in range(3):
        mb.prism(-1.0 + k, -1.5, 0, 0.62, 0.04, 6, "Steel")
        mb.prism(-1.0 + k, -1.5, 0.62, 0.69, 0.2, 14, "Awning")
    return mb.build("prop_kiosk")


def prop_dumpster():
    mb = MB()
    mb.bbox(-1.0, -0.6, 0.18, 1.0, 0.6, 1.25, "AwningB", c=0.04)
    for x in (-0.7, 0, 0.7):
        mb.box(x - 0.05, -0.64, 0.25, x + 0.05, -0.6, 1.2, "AwningB")
    v = [(-1.05, -0.68, 1.25), (1.05, -0.68, 1.25), (1.05, 0.66, 1.42), (-1.05, 0.66, 1.42)]
    mb.quad(*v, "Rubber")
    mb.quad(v[3], v[2], v[1], v[0], "Rubber")
    for x in (-0.8, 0.8):
        for y in (-0.45, 0.45):
            M = Matrix.Translation((x, y, 0.09)) @ Matrix.Rotation(math.pi / 2, 4, "X")
            mb.prism(0, 0, -0.04, 0.04, 0.09, 10, "Rubber", M=M, bottom=True)
    return mb.build("prop_dumpster")


def prop_crates():
    mb = MB()
    rng = random.Random(7)
    for k in range(5):
        s = rng.uniform(0.5, 0.8)
        x, y = rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6)
        z = 0 if k < 3 else 0.72
        mb.bbox(x - s / 2, y - s / 2, z, x + s / 2, y + s / 2, z + s, "Wood" if k % 2 else "CarBodyB", c=0.02)
    mb.bbox(0.6, -0.9, 0, 1.0, -0.5, 0.9, "AwningB", c=0.02)
    return mb.build("prop_crates")


def prop_barrier():
    mb = MB()
    mb.bbox(-1.0, -0.18, 0, 1.0, 0.18, 0.3, "Concrete", c=0.03)
    mb.bbox(-1.0, -0.07, 0.3, 1.0, 0.07, 0.95, "Stripe", c=0.02)
    mb.box(-1.0, -0.08, 0.75, 1.0, 0.08, 0.82, "NeonAmber")
    return mb.build("prop_barrier")


def prop_bench():
    mb = MB()
    for k in range(4):
        mb.bbox(-1.0, -0.25 + k * 0.13, 0.44, 1.0, -0.16 + k * 0.13, 0.5, "Wood", c=0.01)
    for x in (-0.85, 0.85):
        mb.bbox(x - 0.04, -0.22, 0, x + 0.04, 0.22, 0.44, "Frame", c=0.01)
    mb.box(-1.0, -0.27, 0.38, 1.0, -0.24, 0.42, "NeonCyan")
    return mb.build("prop_bench")


def prop_bollard():
    mb = MB()
    mb.prism(0, 0, 0, 0.9, 0.14, 14, "Frame")
    mb.prism(0, 0, 0.9, 0.98, 0.15, 14, "NeonPink")
    mb.prism(0, 0, 0.98, 1.02, 0.12, 14, "Steel")
    return mb.build("prop_bollard")


def prop_vent():
    mb = MB()
    mb.box(-0.6, -0.6, 0, 0.6, 0.6, 0.05, "Steel")
    for k in range(6):
        mb.box(-0.52, -0.52 + k * 0.2, 0.05, 0.52, -0.46 + k * 0.2, 0.07, "Grille")
    return mb.build("prop_vent")


def prop_tree():
    mb = MB()
    mb.prism(0, 0, 0, 0.8, 1.6, 8, "Concrete", rot=math.pi / 8, smooth=False)
    mb.prism(0, 0, 0.8, 0.86, 1.68, 8, "NeonGreen", rot=math.pi / 8)
    mb.prism(0, 0, 0.8, 0.85, 1.5, 8, "Plant", rot=math.pi / 8)
    rng = random.Random(3)
    trunk = [(0, 0, 0.8), (0.1, 0.05, 2.0), (-0.05, 0.1, 3.2), (0.05, 0, 4.0)]
    for a, b in zip(trunk, trunk[1:]):
        mb.pipe(a, b, 0.14, "Wood", 8)
    for k in range(10):
        a = k * 2.4
        r = rng.uniform(0.3, 1.4)
        mb.sphere(math.cos(a) * r, math.sin(a) * r, rng.uniform(3.5, 5.0), rng.uniform(0.6, 1.0), "GlowLeaf", 10, 6, sz=0.7)
    return mb.build("prop_tree")


def car_body(mb, L, W, H, body, glass="Canopy", z=0.3):
    """Shaped car body: lofted cross-sections along X."""
    secs = [(-L / 2, 0.55, 0.0, 0.62), (-L / 2 + 0.25, 0.9, 0.0, 0.7), (-L * 0.2, 1.0, 0.0, 0.72),
            (L * 0.25, 1.0, 0.0, 0.66), (L / 2 - 0.3, 0.92, 0.05, 0.5), (L / 2, 0.6, 0.12, 0.4)]
    rings = []
    for (x, wf, zb, zt) in secs:
        hw = W / 2 * wf
        ring = [(x, -hw, z + zb + 0.05), (x, -hw * 1.02, z + zt * H * 0.55), (x, -hw * 0.95, z + zt * H),
                (x, hw * 0.95, z + zt * H), (x, hw * 1.02, z + zt * H * 0.55), (x, hw, z + zb + 0.05)]
        rings.append([mb.vert(p) for p in ring])
    for a, b in zip(rings, rings[1:]):
        for k in range(6):
            k2 = (k + 1) % 6
            mb.face((a[k], b[k], b[k2], a[k2]), body)
    mb.face(list(reversed(rings[0])), body)
    mb.face(rings[-1], body)
    # greenhouse
    cx0, cx1 = -L * 0.22, L * 0.18
    top = z + H * 0.72
    hw = W / 2 * 0.86
    p = [(cx0 - 0.3, -hw, top), (cx1 + 0.4, -hw, top), (cx1 - 0.1, -hw * 0.82, top + H * 0.45), (cx0 + 0.1, -hw * 0.82, top + H * 0.45),
         (cx0 - 0.3, hw, top), (cx1 + 0.4, hw, top), (cx1 - 0.1, hw * 0.82, top + H * 0.45), (cx0 + 0.1, hw * 0.82, top + H * 0.45)]
    c = ((cx0 + cx1) / 2, 0, top + H * 0.2)
    for q in ((0, 1, 2, 3), (4, 7, 6, 5), (1, 5, 6, 2), (0, 3, 7, 4)):
        mb.poly([p[k] for k in q], glass, c)
    mb.poly([p[3], p[2], p[6], p[7]], body, c)


def prop_parked_car():
    mb = MB()
    L, W, H = 4.4, 1.8, 1.2
    car_body(mb, L, W, H, "CarBodyD")
    for x in (-1.4, 1.35):
        for y in (-0.86, 0.86):
            M = Matrix.Translation((x, y, 0.34)) @ Matrix.Rotation(math.pi / 2, 4, "X")
            mb.prism(0, 0, -0.12, 0.12, 0.34, 16, "Rubber", M=M, bottom=True)
            mb.prism(0, 0, -0.125 if y < 0 else 0.12, -0.12 if y < 0 else 0.125, 0.2, 12, "Steel", M=M, bottom=True)
    mb.box(L / 2 - 0.02, -0.75, 0.62, L / 2 + 0.03, -0.45, 0.72, "HeadLight")
    mb.box(L / 2 - 0.02, 0.45, 0.62, L / 2 + 0.03, 0.75, 0.72, "HeadLight")
    mb.box(-L / 2 - 0.03, -0.8, 0.7, -L / 2 + 0.02, 0.8, 0.76, "TailLight")
    return mb.build("prop_parked_car")


def hover_car(name, body, L=4.6, van=False):
    mb = MB()
    W, H = 2.0, (1.7 if van else 1.0)
    car_body(mb, L, W, H, body, z=-0.45)
    for y in (-W / 2 - 0.28, W / 2 + 0.28):
        M = Matrix.Translation((-L / 2 + 0.5, y, -0.15)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
        mb.prism(0, 0, 0, L - 1.0, 0.3, 12, "Trim", M=M, bottom=True)
        M2 = Matrix.Translation((-L / 2 + 0.45, y, -0.15)) @ Matrix.Rotation(-math.pi / 2, 4, "Y")
        mb.prism(0, 0, 0, 0.05, 0.25, 12, "NeonCyan", M=M2)
        mb.box(-0.4, min(y, y * 0.6), -0.2, 0.4, max(y, y * 0.6), -0.1, "Trim")
    mb.box(L / 2 - 0.05, -0.65, -0.15, L / 2 + 0.02, -0.25, -0.05, "HeadLight")
    mb.box(L / 2 - 0.05, 0.25, -0.15, L / 2 + 0.02, 0.65, -0.05, "HeadLight")
    mb.box(-L / 2 - 0.02, -0.9, 0.05, -L / 2 + 0.03, 0.9, 0.14, "TailLight")
    mb.box(-L / 2 + 0.4, -0.5, -0.5, L / 2 - 1.0, 0.5, -0.46, "NeonPink" if not van else "NeonAmber", skip=("+z",))
    return mb.build(name)


def sign_blade():
    mb = MB()
    W, H, T = 1.2, 5.0, 0.3
    mb.bbox(-T / 2, -W / 2 - 0.08, -0.08, T / 2, W / 2 + 0.08, H + 0.08, "Frame", c=0.03, bottom=True)
    mb.quad((T / 2 + 0.01, -W / 2, 0), (T / 2 + 0.01, W / 2, 0), (T / 2 + 0.01, W / 2, H), (T / 2 + 0.01, -W / 2, H), "SignFace")
    mb.quad((-T / 2 - 0.01, W / 2, 0), (-T / 2 - 0.01, -W / 2, 0), (-T / 2 - 0.01, -W / 2, H), (-T / 2 - 0.01, W / 2, H), "SignFace")
    for zz in (H * 0.15, H * 0.85):
        mb.box(-0.05, W / 2 + 0.08, zz, 0.05, W / 2 + 0.9, zz + 0.1, "Steel")
        mb.pipe((0, W / 2 + 0.08, zz + 0.1), (0, W / 2 + 0.9, zz + 0.6), 0.02, "Steel", 4)
    mb.pipe((0, 0, H + 0.08), (0, 0.4, H + 1.4), 0.02, "Rubber", 4)
    return mb.build("sign_blade")


def sign_wide():
    mb = MB()
    W, H = 6.0, 1.5
    mb.bbox(-W / 2 - 0.1, -0.25, -0.1, W / 2 + 0.1, 0, H + 0.1, "Frame", c=0.03, bottom=True)
    mb.quad((-W / 2, -0.26, 0), (W / 2, -0.26, 0), (W / 2, -0.26, H), (-W / 2, -0.26, H), "SignFace")
    for x in (-W / 2 + 0.4, W / 2 - 0.4):
        mb.pipe((x, -0.4, H + 0.3), (x, -0.25, H), 0.02, "Steel", 4)
        mb.box(x - 0.12, -0.55, H + 0.2, x + 0.12, -0.3, H + 0.35, "Trim")
    return mb.build("sign_wide")


def billboard():
    mb = MB()
    W, H = 12.0, 6.75
    mb.bbox(-W / 2 - 0.3, -0.3, 2.7, W / 2 + 0.3, 0.3, 3.0 + H + 0.3, "Frame", c=0.05, bottom=True)
    mb.quad((-W / 2, -0.31, 3.0), (W / 2, -0.31, 3.0), (W / 2, -0.31, 3.0 + H), (-W / 2, -0.31, 3.0 + H), "Screen")
    for x in (-W / 3, 0, W / 3):
        mb.box(x - 0.15, 0.3, 0, x + 0.15, 0.6, 3.0 + H, "Steel")
        mb.pipe((x, 0.45, 0), (x, 2.6, 2.6), 0.08, "Steel", 6)
        for k in range(4):
            z = 0.8 + k * 2.2
            mb.pipe((x, 0.45, z), (x + W / 3 * (1 if x < W / 3 else -1), 0.45, z + 1.8), 0.04, "Steel", 4)
    mb.box(-W / 2, 0.3, 1.6, W / 2, 1.3, 1.7, "Grille")
    railing(mb, -W / 2, W / 2, 1.25, 1.7, h=0.9, bars=0.6)
    mb.box(-W / 2, -0.6, 3.0 + H + 0.3, W / 2, -0.3, 3.0 + H + 0.4, "Trim")
    for x in (-W / 3, 0, W / 3):
        mb.bbox(x - 0.25, -1.1, 3.0 + H + 0.25, x + 0.25, -0.6, 3.0 + H + 0.4, "Trim", c=0.02, bottom=True)
        mb.box(x - 0.2, -1.05, 3.0 + H + 0.23, x + 0.2, -0.65, 3.0 + H + 0.25, "LampCold", skip=("+z",))
    return mb.build("billboard")


def skywalk():
    mb = MB()
    mb.box(0, -1.7, 0, 1, 1.7, 0.45, "Concrete", skip=("-x", "+x"))
    mb.box(0, -1.75, 3.0, 1, 1.75, 3.35, "Cladding", skip=("-x", "+x"))
    mb.box(0, -1.68, 0.45, 1, -1.62, 3.0, "Glass", skip=("-x", "+x"))
    mb.box(0, 1.62, 0.45, 1, 1.68, 3.0, "Glass", skip=("-x", "+x"))
    mb.box(0, -1.8, 0.38, 1, -1.7, 0.46, "NeonCyan", skip=("-x", "+x"))
    mb.box(0, 1.7, 0.38, 1, 1.8, 0.46, "NeonCyan", skip=("-x", "+x"))
    mb.box(0, -1.2, 2.95, 1, 1.2, 3.0, "LampCold", skip=("-x", "+x", "+z"))
    mb.box(0, -1.76, 1.6, 1, -1.7, 1.66, "Steel", skip=("-x", "+x"))
    mb.box(0, 1.7, 1.6, 1, 1.76, 1.66, "Steel", skip=("-x", "+x"))
    return mb.build("skywalk")


def rail_segment():
    mb = MB()
    mb.box(0, -2.2, -1.4, 1, 2.2, 0, "Concrete", skip=("-x", "+x"))
    mb.box(0, -1.2, -1.9, 1, 1.2, -1.4, "Concrete", skip=("-x", "+x"))
    mb.box(0, -2.45, -0.25, 1, -2.2, 0.7, "Cladding", skip=("-x", "+x"))
    mb.box(0, 2.2, -0.25, 1, 2.45, 0.7, "Cladding", skip=("-x", "+x"))
    mb.box(0, -1.05, 0, 1, -0.85, 0.22, "Steel", skip=("-x", "+x"))
    mb.box(0, 0.85, 0, 1, 1.05, 0.22, "Steel", skip=("-x", "+x"))
    mb.box(0, -0.3, 0, 1, 0.3, 0.12, "Grille", skip=("-x", "+x"))
    mb.box(0, -2.47, -1.0, 1, -2.45, -0.9, "NeonViolet", skip=("-x", "+x"))
    mb.box(0, 2.45, -1.0, 1, 2.47, -0.9, "NeonViolet", skip=("-x", "+x"))
    mb.box(0, -2.3, 0.7, 1, -2.25, 0.85, "Steel", skip=("-x", "+x"))
    mb.box(0, 2.25, 0.7, 1, 2.3, 0.85, "Steel", skip=("-x", "+x"))
    return mb.build("rail_segment")


def rail_pylon():
    mb = MB()
    mb.prism(0, 0, 0, 0.6, 1.5, 8, "Concrete", rot=math.pi / 8, smooth=False)
    mb.prism(0, 0, 0.6, 14.7, 0.9, 8, "Concrete", rot=math.pi / 8, r2=0.75, smooth=False)
    mb.bbox(-2.4, -0.9, 14.7, 2.4, 0.9, 16.6, "Concrete", c=0.08, bottom=True)
    mb.prism(0, 0, 4.0, 4.15, 0.95, 8, "NeonViolet", rot=math.pi / 8)
    for k in range(3):
        mb.pipe((0.92, 0.2 - k * 0.2, 0.6), (0.82, 0.2 - k * 0.2, 14.7), 0.05, "Rubber", 5)
    mb.bbox(-0.5, -0.95, 1.5, 0.5, -0.8, 2.6, "Trim", c=0.02)
    return mb.build("rail_pylon")


def train_car():
    mb = MB()
    L, W = 14.0, 3.0
    mb.bbox(-L / 2, -W / 2, 0.5, L / 2, W / 2, 3.7, "TrainBody", c=0.18, bottom=True)
    for side in (-1, 1):
        y = side * (W / 2 + 0.01)
        for k in range(6):
            x = -L / 2 + 1.0 + k * 2.1
            mb.box(x, min(y, y + side * 0.02), 1.7, x + 1.6, max(y, y + side * 0.02), 2.75, "Glass")
            mb.box(x + 0.05, min(y, y - side * 0.01), 1.75, x + 1.55, max(y, y - side * 0.01), 2.7, "ShopLit")
        mb.box(-L / 2, min(y, y + side * 0.03), 1.25, L / 2, max(y, y + side * 0.03), 1.35, "NeonPink")
        for x in (-2.8, 2.8):
            mb.box(x - 0.7, min(y, y + side * 0.025), 0.6, x + 0.7, max(y, y + side * 0.025), 3.0, "Trim")
    mb.bbox(-L / 2 + 0.8, -W / 2 + 0.4, 3.7, L / 2 - 0.8, W / 2 - 0.4, 4.0, "Trim", c=0.05)
    for x in (-L / 2 + 2, L / 2 - 2):
        mb.bbox(x - 1.3, -1.3, 0.05, x + 1.3, 1.3, 0.5, "Rubber", c=0.05, bottom=True)
    mb.box(L / 2 - 0.02, -1.0, 2.0, L / 2 + 0.03, 1.0, 2.35, "HeadLight")
    mb.box(-L / 2 - 0.03, -1.0, 2.0, -L / 2 + 0.02, 1.0, 2.35, "TailLight")
    return mb.build("train_car")


def holo_plinth():
    mb = MB()
    mb.prism(0, 0, 0, 0.6, 7.5, 32, "Concrete")
    mb.prism(0, 0, 0.6, 0.7, 7.7, 32, "NeonCyan")
    mb.prism(0, 0, 0.6, 1.2, 4.5, 32, "Trim", r2=3.8)
    mb.prism(0, 0, 1.2, 1.35, 3.6, 32, "NeonPink")
    mb.prism(0, 0, 1.2, 1.3, 3.5, 32, "LampCold")
    for k in range(6):
        a = k * math.pi / 3
        mb.bbox(math.cos(a) * 6 - 0.15, math.sin(a) * 6 - 0.15, 0.6, math.cos(a) * 6 + 0.15, math.sin(a) * 6 + 0.15, 3.2, "Frame", c=0.03)
        mb.sphere(math.cos(a) * 6, math.sin(a) * 6, 3.3, 0.22, "LampCold", 10, 6)
    return mb.build("holo_plinth")


def holo_koi():
    mb = MB()
    L = 8.0
    n_ring, seg = 28, 16
    rings = []
    for j in range(n_ring + 1):
        t = j / n_ring
        x = L / 2 - t * L
        r = 1.15 * math.sin(math.pi * min(1.0, t * 1.15) ** 0.8) * (1 - 0.65 * t) + 0.04
        rings.append([mb.vert((x, r * math.cos(2 * math.pi * k / seg), r * 0.82 * math.sin(2 * math.pi * k / seg))) for k in range(seg)])
    for j in range(n_ring):
        for k in range(seg):
            k2 = (k + 1) % seg
            mb.face((rings[j][k], rings[j][k2], rings[j + 1][k2], rings[j + 1][k]), "Hologram",
                    [(j / n_ring, k / seg), (j / n_ring, (k + 1) / seg), ((j + 1) / n_ring, (k + 1) / seg), ((j + 1) / n_ring, k / seg)], True)
    tx = -L / 2
    mb.quad((tx + 0.3, 0, 0), (tx - 2.0, 0, 1.6), (tx - 1.4, 0, 0), (tx - 2.0, 0, -1.6), "Hologram", ((1, 0.5), (1.3, 0.9), (1.2, 0.5), (1.3, 0.1)))
    mb.quad((tx - 2.0, 0, -1.6), (tx - 1.4, 0, 0), (tx - 2.0, 0, 1.6), (tx + 0.3, 0, 0), "Hologram", ((1.3, 0.1), (1.2, 0.5), (1.3, 0.9), (1, 0.5)))
    mb.quad((1.2, 0, 0.85), (-1.8, 0, 0.7), (-1.2, 0, 1.6), (0.2, 0, 1.5), "Hologram")
    mb.quad((0.2, 0, 1.5), (-1.2, 0, 1.6), (-1.8, 0, 0.7), (1.2, 0, 0.85), "Hologram")
    for s in (-1, 1):
        a, b, c = (1.6, s * 0.8, -0.4), (0.4, s * 2.2, -0.9), (0.6, s * 0.9, -0.5)
        mb.face((mb.vert(a), mb.vert(b), mb.vert(c)), "Hologram")
        mb.face((mb.vert(c), mb.vert(b), mb.vert(a)), "Hologram")
    return mb.build("holo_koi")


for fn in (prop_lamp, prop_vending, prop_kiosk, prop_dumpster, prop_crates, prop_barrier, prop_bench, prop_bollard,
           prop_vent, prop_tree, prop_parked_car, sign_blade, sign_wide, billboard, skywalk, rail_segment, rail_pylon,
           train_car, holo_plinth, holo_koi):
    fn()
hover_car("hover_car_a", "CarBody")
hover_car("hover_car_b", "CarBodyC", 4.2)
hover_car("hover_van", "CarBodyB", 6.0, van=True)

# ---------------------------------------------------------------------------- export
tris = 0
for ob in COL.objects:
    for p in ob.data.polygons:
        tris += len(p.vertices) - 2
print(f"objects={len(COL.objects)} triangles={tris}")
cells = sum(wl["cols"] * wl["rows"] for f in FACADES.values() for wl in f["walls"])
print(f"facade cells across the 14 tower variants: {cells}")
with open(OUT_JSON, "w") as fh:
    json.dump({"cells": {k: list(v) for k, v in CELL.items()}, "towers": FACADES}, fh, separators=(",", ":"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True, export_cameras=False,
                          export_extras=False, export_animations=False, export_materials="EXPORT", export_texcoords=True,
                          export_normals=True, export_vertex_color="NONE")
print("wrote", OUT, "and", OUT_JSON)
