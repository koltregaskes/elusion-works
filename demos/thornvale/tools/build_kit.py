"""Thornvale kit: a walled medieval hill town, modelled in Blender.

    python -I demos/thornvale/tools/build_kit.py demos/thornvale/assets/thornvale-kit.glb

Every asset is built here from code: half-timbered houses (stone ground
floors, jettied timber-framed upper floors with plaster infill, recessed
mullioned windows, shutters, flower boxes, gables with framing, chimneys,
dormers), town walls with crenellations, round towers, a gatehouse, a keep,
an arcaded terrace wall, a Gothic church with twin spires, market dressing,
and procedurally branched trees with leaf cards.

Blender is Z-up; glTF export makes Blender -Y the browser's +Z. Buildings
face Blender -Y (the browser's +Z) and sit on the ground at the origin.
Writes a sibling .json with each building's footprint and door position.
"""

import json
import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared", "tools"))
import mb as mbm  # noqa: E402
from mb import MB  # noqa: E402

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else "thornvale-kit.glb"
OUT_JSON = OUT[:-4] + ".json"

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for me in list(bpy.data.meshes):
    bpy.data.meshes.remove(me)
for ma in list(bpy.data.materials):
    bpy.data.materials.remove(ma)


def make_mat(name, col, metal=0.0, rough=0.7, emit=None, strength=0.0, tile=2.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*col, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    mbm.MATS[name] = m
    mbm.TILE[name] = tile


# Textured materials (bound to texture sets by name in the browser)
make_mat("Ashlar", (0.8, 0.8, 0.8), tile=3.0)
make_mat("Rubble", (0.8, 0.8, 0.8), tile=2.0)
make_mat("Plaster", (0.9, 0.9, 0.9), tile=3.0)
make_mat("Plaster2", (0.9, 0.85, 0.7), tile=3.0)
make_mat("Plaster3", (0.92, 0.8, 0.75), tile=3.0)
make_mat("Timber", (0.4, 0.3, 0.2), tile=1.0)
make_mat("RoofClay", (0.7, 0.35, 0.2), tile=2.0)
make_mat("RoofSlate", (0.25, 0.27, 0.3), tile=2.0)
make_mat("Cobbles", (0.6, 0.6, 0.6), tile=2.0)
make_mat("Flagstone", (0.8, 0.8, 0.75), tile=4.0)
make_mat("Planks", (0.4, 0.3, 0.2), tile=2.0)
make_mat("Bark", (0.35, 0.28, 0.22), tile=1.0)
# Plain materials
make_mat("Iron", (0.05, 0.05, 0.055), 0.8, 0.45)
make_mat("Brass", (0.6, 0.45, 0.2), 1.0, 0.35)
make_mat("Glass", (0.03, 0.035, 0.04), 0.0, 0.08)
make_mat("Leaves", (0.3, 0.45, 0.15), 0.0, 0.8)
make_mat("Fabric", (0.9, 0.85, 0.75), 0.0, 0.9)
make_mat("Stripe", (0.9, 0.4, 0.1), 0.0, 0.9)
make_mat("Banner", (0.1, 0.18, 0.55), 0.0, 0.85)
make_mat("BannerRed", (0.55, 0.08, 0.06), 0.0, 0.85)
make_mat("FlowerRed", (0.75, 0.08, 0.1), 0.0, 0.8)
make_mat("FlowerPink", (0.85, 0.4, 0.6), 0.0, 0.8)
make_mat("FlowerYellow", (0.95, 0.75, 0.15), 0.0, 0.8)
make_mat("FlowerPurple", (0.5, 0.3, 0.75), 0.0, 0.8)
make_mat("Greenery", (0.13, 0.25, 0.07), 0.0, 0.85)
make_mat("Hay", (0.75, 0.62, 0.3), 0.0, 0.9)
make_mat("Water", (0.08, 0.14, 0.16), 0.0, 0.03)
make_mat("Produce", (0.7, 0.2, 0.1), 0.0, 0.6)
make_mat("Produce2", (0.4, 0.6, 0.15), 0.0, 0.6)
make_mat("Produce3", (0.9, 0.6, 0.1), 0.0, 0.6)
make_mat("Lantern", (0.5, 0.4, 0.25), 0.0, 0.4, (1.0, 0.7, 0.35), 0.0)
make_mat("Gold", (0.8, 0.6, 0.2), 1.0, 0.3)

FOOT = {}


# ----------------------------------------------------------------------------- face frames
class Face:
    """A wall face: outward normal n=(nx,ny), origin o (Blender XY) at a=0.
    Local coords: a along the face (right as seen from outside), z up,
    out = distance in front of the face plane."""

    def __init__(self, ox, oy, nx, ny):
        self.o = Vector((ox, oy, 0))
        self.n = Vector((nx, ny, 0))
        self.r = Vector((-ny, nx, 0))
        # local x = r, local y = inward (-n), z up: right-handed
        self.M = Matrix((
            (self.r.x, -self.n.x, 0, ox),
            (self.r.y, -self.n.y, 0, oy),
            (0, 0, 1, 0),
            (0, 0, 0, 1),
        ))

    def pt(self, a, out, z):
        return self.o + self.r * a + self.n * out + Vector((0, 0, z))

    def box(self, mb, a0, a1, z0, z1, out0, out1, mat, chamfer=0.0, **kw):
        if chamfer:
            mb.bbox(a0, -out1, z0, a1, -out0, z1, mat, c=chamfer, M=self.M, bottom=kw.get("bottom", False))
        else:
            kw.pop("bottom", None)
            mb.box(a0, -out1, z0, a1, -out0, z1, mat, M=self.M, **kw)

    def quad(self, mb, a0, a1, z0, z1, out, mat, uvs=((0, 0), (1, 0), (1, 1), (0, 1))):
        mb.quad(self.pt(a0, out, z0), self.pt(a1, out, z0), self.pt(a1, out, z1), self.pt(a0, out, z1), mat, uvs)

    def beam(self, mb, a0, z0, a1, z1, w, out0, out1, mat):
        """A straight timber between two points in the face plane (any angle)."""
        dx, dz = a1 - a0, z1 - z0
        L = math.hypot(dx, dz)
        ang = math.atan2(dz, dx)
        R = Matrix.Rotation(ang, 4, "Y").inverted()  # rotate local x towards z
        T = Matrix.Translation((a0, 0, z0))
        M = self.M @ T @ R
        mb.box(0, -out1, -w / 2, L, -out0, w / 2, mat, M=M, skip=("+y",))


def faces_of(x0, y0, x1, y1):
    """Four faces of a rectangle: S (front, -y), E, N, W with their widths."""
    return [
        ("S", Face(x0, y0, 0, -1), x1 - x0),
        ("E", Face(x1, y0, 1, 0), y1 - y0),
        ("N", Face(x1, y1, 0, 1), x1 - x0),
        ("W", Face(x0, y1, -1, 0), y1 - y0),
    ]


# ----------------------------------------------------------------------------- house parts
def window_bay(mb, F, a0, a1, z0, z1, rng, shutters=True, box_flowers=True, depth=0.2, frame="Timber"):
    """Recessed mullioned window in an opening from a0..a1, z0..z1."""
    # reveal (opening sides are formed by the surrounding timbers/stone)
    F.quad(mb, a0, a1, z0, z1, -depth, "Glass", ((0, 0), (1, 0), (1, 1), (0, 1)))
    t = 0.06
    am = (a0 + a1) / 2
    zt = z0 + (z1 - z0) * 0.62
    F.box(mb, a0, a1, z0, z0 + t, -depth, -depth + 0.07, frame)
    F.box(mb, a0, a1, z1 - t, z1, -depth, -depth + 0.07, frame)
    F.box(mb, am - 0.03, am + 0.03, z0, z1, -depth, -depth + 0.08, frame)
    F.box(mb, a0, a1, zt - 0.025, zt + 0.025, -depth, -depth + 0.08, frame)
    # leading of the small panes
    for k in range(1, 3):
        zz = z0 + (zt - z0) * k / 3
        F.box(mb, a0, a1, zz - 0.006, zz + 0.006, -depth, -depth + 0.02, "Iron")
    for aa in (a0 + (am - a0) / 2, am + (a1 - am) / 2):
        F.box(mb, aa - 0.006, aa + 0.006, z0, zt, -depth, -depth + 0.02, "Iron")
    # sill
    F.box(mb, a0 - 0.06, a1 + 0.06, z0 - 0.07, z0, -depth, 0.08, "Timber")
    if shutters and rng.random() < 0.6:
        w = (a1 - a0) / 2
        F.box(mb, a0 - w - 0.03, a0 - 0.03, z0, z1, 0.02, 0.06, "Planks")
        F.box(mb, a1 + 0.03, a1 + w + 0.03, z0, z1, 0.02, 0.06, "Planks")
        for aa in (a0 - 0.03, a1 + 0.03):
            for zz in (z0 + 0.2, z1 - 0.25):
                F.box(mb, aa - 0.1, aa + 0.1, zz, zz + 0.04, 0.06, 0.075, "Iron")
    if box_flowers and rng.random() < 0.45:
        F.box(mb, a0 - 0.05, a1 + 0.05, z0 - 0.3, z0 - 0.07, 0.0, 0.28, "Planks", chamfer=0.02, bottom=True)
        fl = rng.choice(["FlowerRed", "FlowerPink", "FlowerYellow", "FlowerPurple"])
        for k in range(int((a1 - a0) / 0.2) + 1):
            aa = a0 + k * 0.2
            c = F.pt(aa, 0.14, z0 + rng.uniform(0.0, 0.08))
            mb.sphere(c.x, c.y, c.z, rng.uniform(0.09, 0.13), "Greenery" if k % 2 else fl, 5, 3)


def timber_floor(mb, F, width, z0, H, rng, infill, windows, brace_style):
    """One timber-framed storey on face F: posts, rails, braces, infill, windows."""
    tw, td = 0.2, 0.06  # timber width, how far timbers stand proud of the infill
    sill_z, head_z = 0.85, 2.05
    # posts: corners, both sides of every window, and in wide panels
    posts = {0.0, width}
    for (wa0, wa1) in windows:
        posts.add(wa0 - tw / 2)
        posts.add(wa1 + tw / 2)
    ps = sorted(posts)
    extra = []
    for p, q in zip(ps, ps[1:]):
        if q - p > 1.6 and not any(wa0 - tw < (p + q) / 2 < wa1 + tw for wa0, wa1 in windows):
            n = int((q - p) / 1.2)
            for k in range(1, n + 1):
                extra.append(p + (q - p) * k / (n + 1))
    ps = sorted(set(ps) | set(extra))
    # infill panel behind everything
    F.box(mb, 0, width, z0, z0 + H, -0.25, 0.0, infill, skip=("-z", "+z"))
    # sole plate and top plate
    F.box(mb, -0.05, width + 0.05, z0, z0 + 0.22, 0.0, td, "Timber", skip=("+y",))
    F.box(mb, -0.05, width + 0.05, z0 + H - 0.2, z0 + H, 0.0, td, "Timber", skip=("+y",))
    for p in ps:
        F.box(mb, p - tw / 2, p + tw / 2, z0 + 0.22, z0 + H - 0.2, 0.0, td, "Timber", skip=("+y", "-z", "+z"))
    # rails at sill and head height, broken by windows
    for zr in (sill_z, head_z):
        for p, q in zip(ps, ps[1:]):
            mid = (p + q) / 2
            win = any(wa0 - 0.01 <= mid <= wa1 + 0.01 for wa0, wa1 in windows)
            if win and zr == head_z:
                F.box(mb, p + tw / 2, q - tw / 2, z0 + zr, z0 + zr + 0.16, 0.0, td, "Timber", skip=("+y", "-x", "+x"))
            elif not win:
                F.box(mb, p + tw / 2, q - tw / 2, z0 + zr, z0 + zr + 0.16, 0.0, td * 0.9, "Timber", skip=("+y", "-x", "+x"))
            else:
                F.box(mb, p + tw / 2, q - tw / 2, z0 + zr - 0.16, z0 + zr, 0.0, td, "Timber", skip=("+y", "-x", "+x"))
    # braces in the solid panels
    for i, (p, q) in enumerate(zip(ps, ps[1:])):
        mid = (p + q) / 2
        if any(wa0 - 0.01 <= mid <= wa1 + 0.01 for wa0, wa1 in windows):
            # St Andrew's cross under the window
            if brace_style == "cross":
                F.beam(mb, p + tw / 2, z0 + 0.22, q - tw / 2, z0 + sill_z - 0.16, 0.14, 0.0, td * 0.8, "Timber")
                F.beam(mb, p + tw / 2, z0 + sill_z - 0.16, q - tw / 2, z0 + 0.22, 0.14, 0.0, td * 0.8, "Timber")
            continue
        if brace_style in ("cross", "brace") or i == 0 or q >= width - 0.01:
            if (i % 2 == 0) == (brace_style != "mirror"):
                F.beam(mb, p + tw / 2, z0 + 0.22, q - tw / 2, z0 + H - 0.2, 0.15, 0.0, td * 0.8, "Timber")
            else:
                F.beam(mb, p + tw / 2, z0 + H - 0.2, q - tw / 2, z0 + 0.22, 0.15, 0.0, td * 0.8, "Timber")
    for (wa0, wa1) in windows:
        window_bay(mb, F, wa0, wa1, z0 + sill_z, z0 + head_z, rng)


def stone_floor(mb, F, width, H, rng, mat, door_at=None, shop=False):
    """Stone ground floor: thick wall with quoins, door and small windows."""
    openings = []
    if door_at is not None:
        openings.append(("door", door_at - 0.55, door_at + 0.55))
    n_win = int(width / 2.6)
    for k in range(n_win):
        a = width * (k + 0.5) / n_win
        if door_at is not None and abs(a - door_at) < 1.6:
            continue
        w = 1.8 if shop and k % 2 == 0 else 0.8
        openings.append(("shop" if w > 1 else "win", a - w / 2, a + w / 2))
    openings.sort(key=lambda o: o[1])
    # wall pieces between openings
    edges = [(0.0, "none")] + [(o[1], o[0]) for o in openings]
    cur = 0.0
    for kind, a0, a1 in openings:
        if a0 > cur:
            F.box(mb, cur, a0, 0, H, -0.35, 0.0, mat, skip=("-z", "+z"))
        if kind == "door":
            top = 2.25
            F.box(mb, a0, a1, top, H, -0.35, 0.0, mat, skip=("-z",))
            F.quad(mb, a0, a1, 0.0, top, -0.22, "Planks", ((0, 0), (0.5, 0), (0.5, 1.1), (0, 1.1)))
            F.box(mb, a0 - 0.12, a0, 0, top + 0.1, -0.25, 0.04, "Timber")
            F.box(mb, a1, a1 + 0.12, 0, top + 0.1, -0.25, 0.04, "Timber")
            F.box(mb, a0 - 0.2, a1 + 0.2, top, top + 0.28, -0.3, 0.06, "Ashlar", chamfer=0.02)
            for zz in (0.5, 1.6):
                F.box(mb, a0 + 0.05, a1 - 0.25, zz, zz + 0.06, -0.22, -0.2, "Iron")
            F.box(mb, a1 - 0.22, a1 - 0.16, 1.0, 1.12, -0.22, -0.16, "Brass")
            F.box(mb, a0 - 0.3, a1 + 0.3, -0.05, 0.16, 0.0, 0.45, "Ashlar", chamfer=0.03)
        elif kind == "shop":
            F.box(mb, a0, a1, 0, 0.8, -0.35, 0.0, mat, skip=("-z",))
            F.box(mb, a0, a1, 2.3, H, -0.35, 0.0, mat, skip=("+z",))
            window_bay(mb, F, a0, a1, 0.8, 2.3, rng, shutters=False, box_flowers=False, depth=0.25)
            F.box(mb, a0 - 0.1, a1 + 0.1, 0.72, 0.82, -0.05, 0.35, "Planks")
        else:
            F.box(mb, a0, a1, 0, 1.0, -0.35, 0.0, mat, skip=("-z",))
            F.box(mb, a0, a1, 2.0, H, -0.35, 0.0, mat, skip=("+z",))
            window_bay(mb, F, a0, a1, 1.0, 2.0, rng, shutters=True, box_flowers=False, depth=0.28)
            F.box(mb, a0 - 0.12, a1 + 0.12, 2.0, 2.18, -0.05, 0.06, "Ashlar", chamfer=0.02)
        cur = a1
    if cur < width:
        F.box(mb, cur, width, 0, H, -0.35, 0.0, mat, skip=("-z", "+z"))
    # quoins at both corners
    for a in (0.0, width):
        z = 0.0
        k = 0
        while z < H - 0.05:
            h = 0.32
            w = 0.55 if k % 2 == 0 else 0.35
            a0, a1 = (a - 0.04, a + w) if a == 0 else (a - w, a + 0.04)
            F.box(mb, a0, a1, z, min(H, z + h), 0.0, 0.03, "Ashlar", skip=("+y",))
            z += h + 0.01
            k += 1
    # plinth
    F.box(mb, -0.05, width + 0.05, 0, 0.35, 0.0, 0.08, mat, chamfer=0.03)


def gable_roof(mb, x0, y0, x1, y1, z, pitch, mat, ridge_along_y, oh=0.4, oh_g=0.3, t=0.16, rng=None, frame_gable=True, infill="Plaster"):
    """Gable roof over the rectangle. Returns ridge height."""
    if ridge_along_y:
        span = x1 - x0
        xc = (x0 + x1) / 2
        rise = span / 2 * math.tan(pitch)
        zr = z + rise
        ze = z - oh * math.tan(pitch)
        ya, yb = y0 - oh_g, y1 + oh_g
        L = math.hypot(span / 2 + oh, rise + oh * math.tan(pitch))
        for side in (-1, 1):
            xe = xc + side * (span / 2 + oh)
            # top surface: u along ridge, v up the slope
            p0, p1 = Vector((xe, ya, ze)), Vector((xe, yb, ze))
            p2, p3 = Vector((xc, yb, zr)), Vector((xc, ya, zr))
            uv = [(0, 0), ((yb - ya) / 2, 0), ((yb - ya) / 2, L / 2), (0, L / 2)]
            if side > 0:
                mb.quad(p0, p3, p2, p1, mat, [uv[0], uv[3], uv[2], uv[1]])
            else:
                mb.quad(p0, p1, p2, p3, mat, uv)
            dz = Vector((0, 0, -t))
            q = [p0 + dz, p1 + dz, p2 + dz, p3 + dz]
            if side > 0:
                mb.quad(q[0], q[1], q[2], q[3], "Timber")
            else:
                mb.quad(q[0], q[3], q[2], q[1], "Timber")
            # eave edge (fascia)
            mb.poly([p0, p1, q[1], q[0]], "Timber", (xc, (ya + yb) / 2, z))
            # gable edges (barge boards)
            for yy, pa, pb, qa, qb in ((ya, p0, p3, q[0], q[3]), (yb, p1, p2, q[1], q[2])):
                mb.poly([pa, pb, qb, qa], "Timber", (xc, (ya + yb) / 2, z))
            # rafter ends under the eaves
            n = int((yb - ya) / 0.7)
            for k in range(n + 1):
                yy = ya + 0.2 + k * (yb - ya - 0.4) / max(1, n)
                xa = xc + side * (span / 2 - 0.1)
                mb.pipe((xa, yy, z - 0.05), (xe + side * -0.05, yy, ze - 0.05), 0.06, "Timber", 4)
        mb.prism(0, 0, 0, yb - ya, 0.13, 8, mat, M=Matrix.Translation((xc, ya, zr + 0.02)) @ Matrix.Rotation(-math.pi / 2, 4, "X"), top=True, bottom=True)
        # gable walls
        for yy, out in ((y0, -1), (y1, 1)):
            tri = [Vector((x0, yy, z)), Vector((x1, yy, z)), Vector((xc, yy, zr - 0.05))]
            mb.poly(tri, infill, (xc, yy - out, z))
            if frame_gable:
                F = Face(x0, yy, 0, out) if out < 0 else Face(x1, yy, 0, out)
                w = x1 - x0
                F.box(mb, -0.05, w + 0.05, z, z + 0.2, 0.0, 0.06, "Timber")
                F.box(mb, w / 2 - 0.1, w / 2 + 0.1, z + 0.2, z + rise - 0.3, 0.0, 0.06, "Timber")
                zc = z + rise * 0.45
                hw = w / 2 * (1 - 0.45)
                F.box(mb, w / 2 - hw + 0.1, w / 2 + hw - 0.1, zc, zc + 0.16, 0.0, 0.06, "Timber")
                F.beam(mb, 0.25, z + 0.2, w / 2 - 0.1, zc, 0.14, 0.0, 0.05, "Timber")
                F.beam(mb, w - 0.25, z + 0.2, w / 2 + 0.1, zc, 0.14, 0.0, 0.05, "Timber")
                # small attic window
                if rng and rng.random() < 0.7 and rise > 2.5:
                    window_bay(mb, F, w / 2 - 0.85, w / 2 - 0.25, zc + 0.3, zc + 1.1, rng, shutters=False, box_flowers=False, depth=0.15)
                    window_bay(mb, F, w / 2 + 0.25, w / 2 + 0.85, zc + 0.3, zc + 1.1, rng, shutters=False, box_flowers=False, depth=0.15)
        return zr
    # ridge along x: swap via a 90 degree rotation of the y-ridge construction
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    sub = MB()
    zr = gable_roof(sub, -(y1 - y0) / 2, -(x1 - x0) / 2, (y1 - y0) / 2, (x1 - x0) / 2, z, pitch, mat, True, oh, oh_g, t, rng, frame_gable, infill)
    R = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
    base = len(mb.v)
    for p in sub.v:
        mb.v.append(R @ p)
    for f, mi, uv, sm in zip(sub.f, sub.m, sub.uv, sub.sm):
        mb.face([i + base for i in f], sub.mats[mi], uv, sm)
    return zr


def chimney(mb, x, y, z0, z1):
    mb.bbox(x - 0.4, y - 0.35, z0, x + 0.4, y + 0.35, z1, "Ashlar", c=0.03)
    mb.bbox(x - 0.48, y - 0.43, z1, x + 0.48, y + 0.43, z1 + 0.16, "Ashlar", c=0.03, bottom=True)
    for dx in (-0.18, 0.18):
        mb.prism(x + dx, y, z1 + 0.16, z1 + 0.5, 0.11, 10, "RoofClay", r2=0.09, top=False)


def lantern(mb, F, a, z, out=0.3):
    p = F.pt(a, 0, z)
    q = F.pt(a, out, z + 0.25)
    mb.pipe(p, q, 0.02, "Iron", 4)
    c = F.pt(a, out, z)
    mb.box(c.x - 0.1, c.y - 0.1, c.z - 0.25, c.x + 0.1, c.y + 0.1, c.z + 0.05, "Lantern")
    mb.prism(c.x, c.y, c.z + 0.05, c.z + 0.2, 0.15, 4, "Iron", r2=0.02, rot=math.pi / 4)


def hanging_sign(mb, F, a, z, rng):
    p = F.pt(a, 0, z)
    q = F.pt(a, 1.0, z)
    mb.pipe(p, q, 0.025, "Iron", 5)
    mb.pipe(F.pt(a, 0, z - 0.6), F.pt(a, 0.7, z), 0.015, "Iron", 4)
    for o in (0.25, 0.85):
        mb.pipe(F.pt(a, o, z), F.pt(a, o, z - 0.18), 0.01, "Iron", 3)
    c = F.pt(a, 0.55, 0)
    F2 = Face(c.x, c.y, F.r.x, F.r.y)  # board hangs edge-on to the wall
    F2.box(mb, -0.35, 0.35, z - 0.95, z - 0.25, -0.03, 0.03, "Planks", chamfer=0.01, bottom=True)
    mb.sphere(c.x, c.y, z - 1.05, 0.1, rng.choice(["Gold", "BannerRed", "Banner"]), 8, 5)


def house(name, w, d, floors, seed, roof_mat="RoofClay", stone="Rubble", infill="Plaster", gable_front=True, shop=False, dormer=False):
    rng = random.Random(seed)
    mb = MB()
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    H0 = 3.1
    door_a = w * rng.uniform(0.3, 0.7)
    for key, F, width in faces_of(x0, y0, x1, y1):
        stone_floor(mb, F, width, H0, rng, stone, door_at=door_a if key == "S" else None, shop=shop and key == "S")
    mb.box(x0 + 0.3, y0 + 0.3, 0, x1 - 0.3, y1 - 0.3, H0, "Rubble", skip=("-z", "+z"))
    z = H0
    jet = 0.0
    style = rng.choice(["brace", "cross", "mirror"])
    for f in range(floors):
        H = 2.75
        jet += 0.32  # each storey jetties out over the street side
        fx0, fy0, fx1, fy1 = x0 - (0.12 if f else 0), y0 - jet, x1 + (0.12 if f else 0), y1
        # floor beam and joist ends at the jetty line
        Fs = Face(fx0, fy0, 0, -1)
        Fs.box(mb, -0.1, fx1 - fx0 + 0.1, z - 0.04, z + 0.2, -0.05, 0.12, "Timber", chamfer=0.02, bottom=True)
        for k in range(int((fx1 - fx0) / 0.45) + 1):
            a = 0.15 + k * 0.45
            Fs.box(mb, a - 0.07, a + 0.07, z - 0.2, z - 0.04, -0.4, 0.06, "Timber", skip=("+y", "+z"))
        if f == 0:
            mb.box(fx0, fy0, z - 0.2, fx1, y0, z - 0.05, "Planks", skip=("+z",))
        for key, F, width in faces_of(fx0, fy0, fx1, fy1):
            nwin = max(1, int(width / 2.3))
            wins = []
            for k in range(nwin):
                a = width * (k + 0.5) / nwin
                ww = rng.choice([0.9, 1.1, 1.3]) if key in "SN" else 0.8
                wins.append((a - ww / 2, a + ww / 2))
            if key in "EW" and rng.random() < 0.4:
                wins = wins[:1]
            timber_floor(mb, F, width, z, H, rng, infill, wins, style)
        mb.box(fx0 + 0.25, fy0 + 0.25, z, fx1 - 0.25, fy1 - 0.25, z + H, "Plaster", skip=("-z", "+z"))
        z += H
    # roof: gable facing the street (ridge along y) or along the street
    pitch = math.radians(rng.uniform(50, 56))
    rx0, ry0, rx1, ry1 = x0 - 0.12, y0 - jet, x1 + 0.12, y1
    zr = gable_roof(mb, rx0, ry0, rx1, ry1, z, pitch, roof_mat, gable_front, rng=rng, infill=infill)
    if dormer and not gable_front:
        for k in range(max(1, int(w / 4))):
            dx = rx0 + (k + 0.5) * (rx1 - rx0) / max(1, int(w / 4))
            dz = z + 0.9
            dy = ry0 + (0.9 / math.tan(pitch)) + 0.1
            mb.box(dx - 0.6, dy - 0.2, dz - 0.3, dx + 0.6, dy + 1.2, dz + 1.2, infill, skip=("-z",))
            Fd = Face(dx - 0.6, dy - 0.2, 0, -1)
            window_bay(mb, Fd, 0.25, 0.95, 0.0 + dz - 0.1, dz + 0.9, rng, shutters=False, box_flowers=False, depth=0.1)
            gable_roof(mb, dx - 0.7, dy - 0.3, dx + 0.7, dy + 1.4, dz + 1.2, math.radians(52), roof_mat, True, oh=0.15, oh_g=0.1, rng=None, frame_gable=False, infill=infill)
    # chimney through the roof
    cxp = rng.uniform(x0 + 1.0, x1 - 1.0)
    cyp = rng.uniform(y0 + 1.5, y1 - 1.0)
    chimney(mb, cxp, cyp, z - 1.0, zr + 1.2)
    # street furniture on the front
    Ff = Face(x0, y0, 0, -1)
    lantern(mb, Ff, door_a + 0.95, 2.5)
    if shop or rng.random() < 0.35:
        hanging_sign(mb, Face(x0, y0 - 0.32, 0, -1), 0.4 if door_a > w / 2 else w - 0.4, H0 + 0.6, rng)
    FOOT[name] = {"w": w + 0.3, "d": d + jet, "dz": -jet / 2, "door": [door_a - w / 2, 0, -(y0 - 0.6)], "h": zr}
    return mb.build(name)


HOUSES = [
    ("house_a", 6.0, 8.0, 2, "RoofClay", "Rubble", "Plaster", True, False, False),
    ("house_b", 7.5, 9.0, 2, "RoofClay", "Ashlar", "Plaster2", True, True, False),
    ("house_c", 5.2, 7.0, 3, "RoofSlate", "Rubble", "Plaster", True, False, False),
    ("house_d", 9.0, 7.0, 2, "RoofClay", "Rubble", "Plaster3", False, True, True),
    ("house_e", 6.5, 8.5, 1, "RoofClay", "Ashlar", "Plaster", True, False, False),
    ("house_f", 8.0, 10.0, 3, "RoofSlate", "Ashlar", "Plaster2", True, True, False),
    ("house_g", 10.0, 8.0, 2, "RoofSlate", "Rubble", "Plaster", False, False, True),
    ("house_h", 5.8, 9.0, 2, "RoofClay", "Rubble", "Plaster3", True, False, False),
    ("house_i", 7.0, 7.5, 1, "RoofClay", "Rubble", "Plaster2", False, False, True),
    ("house_j", 6.4, 10.5, 3, "RoofClay", "Ashlar", "Plaster", True, True, False),
]
for k, (n, w, d, fl, rm, st, inf, gf, shop, dorm) in enumerate(HOUSES):
    house(n, w, d, fl, 5000 + k * 31, rm, st, inf, gf, shop, dorm)


# ----------------------------------------------------------------------------- fortifications
def wall_segment(name="wall_seg"):
    """4 m of curtain wall along x: battered base, walkway, crenellated parapet facing -y."""
    mb = MB()
    L, H, T = 4.0, 9.0, 2.6
    # battered plinth and body
    mb.poly([(0, -T / 2 - 0.5, 0), (L, -T / 2 - 0.5, 0), (L, -T / 2, 2.0), (0, -T / 2, 2.0)], "Ashlar", (L / 2, 0, 1))
    mb.box(0, -T / 2 - 0.5, 0, L, T / 2, 0.01, "Ashlar", skip=("+z", "-x", "+x", "-y", "+y"))
    mb.box(0, -T / 2, 2.0, L, T / 2, H, "Ashlar", skip=("-x", "+x", "-z"))
    mb.box(0, -T / 2 - 0.12, 2.0, L, -T / 2, 2.25, "Ashlar")
    # string course
    mb.bbox(0, -T / 2 - 0.12, H - 0.3, L, -T / 2 + 0.2, H - 0.05, "Ashlar", c=0.03, bottom=True)
    # parapet: merlons and crenels
    py0, py1 = -T / 2, -T / 2 + 0.55
    mb.box(0, py0, H, L, py1, H + 0.9, "Ashlar", skip=("-x", "+x"))
    for k in range(3):
        a = 0.2 + k * 1.35
        mb.bbox(a, py0, H + 0.9, a + 0.85, py1, H + 2.1, "Ashlar", c=0.03)
        # arrow slit
        mb.box(a + 0.38, py0 - 0.01, H + 1.1, a + 0.47, py0 + 0.02, H + 1.8, "Iron")
    # inner low wall and walkway
    mb.box(0, T / 2 - 0.35, H, L, T / 2, H + 0.7, "Ashlar", skip=("-x", "+x"))
    mb.box(0, py1, H - 0.01, L, T / 2 - 0.35, H, "Flagstone", skip=("-x", "+x", "-z"))
    return mb.build(name)


def round_tower(name, roofed):
    mb = MB()
    R, H = 3.6, 13.5
    n = 28
    mb.prism(0, 0, 0, 2.2, R + 0.5, n, "Ashlar", r2=R, top=False)
    mb.prism(0, 0, 2.2, H, R, n, "Ashlar", top=False)
    mb.prism(0, 0, 2.2, 2.45, R + 0.12, n, "Ashlar", bottom=True, top=True)
    # arrow slits around
    for k in range(6):
        a = k * math.pi / 3 + 0.3
        for zz in (4.5, 8.5):
            c = Vector((math.cos(a) * (R + 0.005), math.sin(a) * (R + 0.005), zz))
            M = Matrix.Translation(c) @ Matrix.Rotation(a, 4, "Z")
            mb.box(-0.02, -0.06, 0, 0.02, 0.06, 0.9, "Iron", M=M)
    # machicolation corbels and parapet
    for k in range(n):
        a = (k + 0.5) * 2 * math.pi / n
        c = Vector((math.cos(a) * (R + 0.18), math.sin(a) * (R + 0.18), H - 0.4))
        M = Matrix.Translation(c) @ Matrix.Rotation(a, 4, "Z")
        mb.bbox(-0.22, -0.13, 0, 0.22, 0.13, 0.4, "Ashlar", c=0.02, M=M, bottom=True)
    mb.prism(0, 0, H, H + 1.0, R + 0.4, n, "Ashlar", top=False, bottom=True)
    if roofed:
        mb.prism(0, 0, H + 1.0, H + 1.15, R + 0.75, n, "Timber", bottom=True)
        mb.prism(0, 0, H + 1.15, H + 8.5, R + 0.7, n, "RoofSlate", r2=0.05)
        mb.prism(0, 0, H + 8.5, H + 10.0, 0.05, 6, "Iron", r2=0.02)
        mb.sphere(0, 0, H + 9.0, 0.12, "Gold", 8, 5)
    else:
        for k in range(10):
            a = k * 2 * math.pi / 10
            c = Vector((math.cos(a) * (R + 0.15), math.sin(a) * (R + 0.15), H + 1.0))
            M = Matrix.Translation(c) @ Matrix.Rotation(a, 4, "Z")
            mb.bbox(-0.25, -0.6, 0, 0.25, 0.6, 1.1, "Ashlar", c=0.03, M=M)
        mb.prism(0, 0, H + 0.1, H + 0.2, R - 0.2, n, "Flagstone")
        mb.prism(0, 0, H + 1.0, H + 7.0, 0.06, 6, "Timber")
        mb.quad((0.05, 0, H + 6.8), (1.6, 0, H + 6.5), (1.6, 0, H + 5.6), (0.05, 0, H + 5.6), "Banner")
        mb.quad((0.05, 0, H + 5.6), (1.6, 0, H + 5.6), (1.6, 0, H + 6.5), (0.05, 0, H + 6.8), "Banner")
    FOOT[name] = {"r": R + 0.5, "h": H}
    return mb.build(name)


def pointed_arch_pts(a0, a1, z_spring, segs=10, pointed=True):
    """Points from a0 to a1 along a pointed (two-centred) or round arch."""
    w = a1 - a0
    pts = []
    if pointed:
        r = w * 0.85
        c0, c1 = a0 + r, a1 - r
        th = math.acos((w / 2 - r) / r)
        for k in range(segs + 1):
            ang = math.pi + (th - math.pi) * k / segs
            pts.append((c0 + r * math.cos(ang), z_spring + r * math.sin(ang)))
        for k in range(1, segs + 1):
            ang = (math.pi - th) * (1 - k / segs)
            pts.append((c1 + r * math.cos(ang), z_spring + r * math.sin(ang)))
    else:
        r = w / 2
        for k in range(segs * 2 + 1):
            ang = math.pi - math.pi * k / (segs * 2)
            pts.append((a0 + r + r * math.cos(ang), z_spring + r * math.sin(ang)))
    return pts


def arch_opening(mb, F, a0, a1, z0, z_spring, z_top, depth, mat, pointed=True, fill=None):
    """Wall slab with an arched opening: builds the masonry around the arch."""
    pts = pointed_arch_pts(a0, a1, z_spring, 8, pointed)
    # jambs
    # spandrel pieces above the arch, as thin vertical slices
    for (pa, pz), (qa, qz) in zip(pts, pts[1:]):
        if qa - pa < 1e-4:
            continue
        F.box(mb, pa, qa, min(pz, qz), z_top, -depth, 0.0, mat, skip=("+z",))
    if fill:
        # recessed infill (door or glass) following the arch
        poly = [F.pt(a0, -depth + 0.05, z0), F.pt(a1, -depth + 0.05, z0)] + [F.pt(p[0], -depth + 0.05, p[1]) for p in reversed(pts)]
        uvs = [((p - F.pt(a0, 0, 0)).dot(F.r) / (a1 - a0), (p.z - z0) / (z_top - z0)) for p in poly]
        mb.poly(poly, fill, F.pt((a0 + a1) / 2, 1.0, z0), uvs=uvs)
    # voussoir ring
    for (pa, pz), (qa, qz) in zip(pts, pts[1:]):
        F.beam(mb, pa, pz, qa, qz, 0.28, 0.0, 0.06, "Ashlar")


def gatehouse():
    mb = MB()
    W, D, H = 12.0, 9.0, 13.0
    hw = W / 2
    gw = 4.0
    # two flanking masses
    for side in (-1, 1):
        a0, a1 = (-hw, -gw / 2) if side < 0 else (gw / 2, hw)
        mb.bbox(a0, -D / 2, 0, a1, D / 2, H, "Ashlar", c=0.05)
        # half-round towers on the outside face
        cx = (a0 + a1) / 2
        M = Matrix.Translation((cx, -D / 2, 0))
        mb.prism(0, 0, 0, H + 1.5, 2.6, 24, "Ashlar", M=M, top=False)
        for k in range(8):
            a = k * 2 * math.pi / 8
            c = Vector((cx + math.cos(a) * 2.75, -D / 2 + math.sin(a) * 2.75, H + 1.5))
            mb.bbox(c.x - 0.3, c.y - 0.3, c.z, c.x + 0.3, c.y + 0.3, c.z + 1.1, "Ashlar", c=0.03)
        mb.prism(0, 0, H + 1.4, H + 1.55, 2.4, 24, "Flagstone", M=M)
    # passage: arch over the gate on both faces, vault ceiling
    for yy, out in ((-D / 2, -1), (D / 2, 1)):
        F = Face(-gw / 2, yy, 0, out) if out < 0 else Face(gw / 2, yy, 0, out)
        arch_opening(mb, F, 0, gw, 0, 3.8, H, 0.6, "Ashlar", pointed=True)
    mb.box(-gw / 2, -D / 2 + 0.6, 6.0, gw / 2, D / 2 - 0.6, H, "Ashlar", skip=("+z",))
    mb.box(-gw / 2, -D / 2, 0, gw / 2, D / 2, 0.02, "Cobbles", skip=("-z",))
    # portcullis (raised) and doors
    for k in range(9):
        a = -gw / 2 + 0.2 + k * (gw - 0.4) / 8
        mb.box(a - 0.04, -D / 2 + 0.75, 4.2, a + 0.04, -D / 2 + 0.83, 7.4, "Iron")
    for k in range(4):
        mb.box(-gw / 2 + 0.1, -D / 2 + 0.75, 4.4 + k * 0.85, gw / 2 - 0.1, -D / 2 + 0.83, 4.47 + k * 0.85, "Iron")
    # upper storey: timber hoarding with a slate roof over the gate
    mb.box(-hw, -D / 2 - 0.6, H, hw, D / 2, H + 3.0, "Plaster", skip=("-z",))
    Fh = Face(-hw, -D / 2 - 0.6, 0, -1)
    timber_floor(mb, Fh, W, H, 3.0, random.Random(7), "Plaster", [(W / 2 - 1.6, W / 2 - 0.7), (W / 2 + 0.7, W / 2 + 1.6)], "cross")
    gable_roof(mb, -hw - 0.2, -D / 2 - 0.8, hw + 0.2, D / 2 + 0.2, H + 3.0, math.radians(48), "RoofSlate", False, rng=None, frame_gable=False)
    # banners either side of the arch
    for a in (-1.4, 1.4):
        c = Vector((a, -D / 2 - 0.62, 9.5))
        mb.quad((c.x - 0.45, c.y, c.z - 2.4), (c.x + 0.45, c.y, c.z - 2.4), (c.x + 0.45, c.y, c.z), (c.x - 0.45, c.y, c.z), "Banner")
        mb.box(c.x - 0.6, c.y - 0.05, c.z, c.x + 0.6, c.y + 0.05, c.z + 0.06, "Iron")
        mb.poly([(c.x - 0.45, c.y - 0.005, c.z - 2.4), (c.x + 0.45, c.y - 0.005, c.z - 2.4), (c.x, c.y - 0.005, c.z - 2.9)], "Banner", (c.x, c.y + 1, c.z))
    FOOT["gatehouse"] = {"w": W + 2, "d": D + 2.6, "gate": gw}
    return mb.build("gatehouse")


def keep():
    mb = MB()
    S, H = 9.0, 30.0
    h = S / 2
    mb.bbox(-h - 0.4, -h - 0.4, 0, h + 0.4, h + 0.4, 2.0, "Ashlar", c=0.08)
    mb.box(-h, -h, 2.0, h, h, H, "Ashlar", skip=("-z",))
    for zz in (8.0, 16.0, 24.0):
        mb.bbox(-h - 0.15, -h - 0.15, zz, h + 0.15, h + 0.15, zz + 0.25, "Ashlar", c=0.04, bottom=True)
    for key, F, width in faces_of(-h, -h, h, h):
        for zz in (10.0, 18.0, 25.5):
            for a in (width * 0.3, width * 0.7):
                F.box(mb, a - 0.35, a + 0.35, zz - 0.15, zz, 0.0, 0.12, "Ashlar")
                F.quad(mb, a - 0.3, a + 0.3, zz, zz + 1.6, 0.005, "Glass")
                F.box(mb, a - 0.4, a + 0.4, zz + 1.6, zz + 1.9, 0.0, 0.1, "Ashlar")
        for k in range(7):
            a = 0.4 + k * (width - 0.8) / 6
            F.box(mb, a - 0.28, a + 0.28, H - 0.6, H, 0.0, 0.35, "Ashlar", chamfer=0.02, bottom=True)
    mb.box(-h - 0.35, -h - 0.35, H, h + 0.35, h + 0.35, H + 1.0, "Ashlar", skip=("-z",))
    for key, F, width in faces_of(-h - 0.35, -h - 0.35, h + 0.35, h + 0.35):
        for k in range(6):
            a = 0.5 + k * (width - 1.0) / 5
            F.box(mb, a - 0.35, a + 0.35, H + 1.0, H + 2.1, -0.6, 0.0, "Ashlar", chamfer=0.03)
    # corner bartizans with conical roofs
    for cx, cy in ((-h, -h), (h, -h), (h, h), (-h, h)):
        M = Matrix.Translation((cx, cy, 0))
        mb.prism(0, 0, H - 4.0, H - 2.5, 0.4, 16, "Ashlar", M=M, r2=1.4, top=False)
        mb.prism(0, 0, H - 2.5, H + 2.5, 1.4, 16, "Ashlar", M=M, top=False)
        mb.prism(0, 0, H + 2.5, H + 2.65, 1.6, 16, "Timber", M=M, bottom=True)
        mb.prism(0, 0, H + 2.65, H + 7.0, 1.55, 16, "RoofSlate", M=M, r2=0.03)
    mb.prism(0, 0, H + 1.0, H + 9.0, 0.08, 6, "Timber")
    mb.quad((0.05, 0, H + 8.8), (2.4, 0, H + 8.4), (2.4, 0, H + 7.2), (0.05, 0, H + 7.2), "BannerRed")
    mb.quad((0.05, 0, H + 7.2), (2.4, 0, H + 7.2), (2.4, 0, H + 8.4), (0.05, 0, H + 8.8), "BannerRed")
    FOOT["keep"] = {"w": S + 1, "d": S + 1, "h": H}
    return mb.build("keep")


def arcade_wall(name="arcade_wall"):
    """6 m retaining wall module with blind round arches, height 8, facing -y."""
    mb = MB()
    L, H = 6.0, 8.0
    F = Face(0, 0, 0, -1)
    for k in range(2):
        a0 = k * 3.0 + 0.45
        a1 = a0 + 2.1
        arch_opening(mb, F, a0, a1, 0.0, 4.4, H - 0.6, 0.45, "Ashlar", pointed=False, fill="Ashlar")
        F.box(mb, k * 3.0, a0, 0, H - 0.6, -0.45, 0.0, "Ashlar", skip=("-z",))
        F.box(mb, a1, k * 3.0 + 3.0, 0, H - 0.6, -0.45, 0.0, "Ashlar", skip=("-z",))
        F.box(mb, k * 3.0 + 1.4, k * 3.0 + 1.6, 4.6, 5.6, -0.4, -0.38, "BannerRed")
    F.box(mb, 0, L, H - 0.6, H, -0.45, 0.15, "Ashlar", chamfer=0.03, bottom=True)
    F.box(mb, 0, L, H, H + 0.9, -0.3, 0.0, "Ashlar")
    F.box(mb, 0, L, H + 0.9, H + 1.05, -0.35, 0.05, "Ashlar", chamfer=0.02, bottom=True)
    mb.box(0, 0.45, 0, L, 6.0, H, "Rubble", skip=("-z", "-x", "+x"))
    return mb.build(name)


def church():
    mb = MB()
    rng = random.Random(77)
    W, Lh, H = 13.0, 30.0, 15.0  # nave width, length, wall height
    x0, x1 = -W / 2, W / 2
    y0, y1 = -Lh / 2, Lh / 2
    # nave walls with buttresses and lancet windows on the long sides
    for side, F, width in (("E", Face(x1, y0, 1, 0), Lh), ("W", Face(x0, y1, -1, 0), Lh)):
        bays = 6
        bw = width / bays
        for b in range(bays):
            a0 = b * bw
            F.box(mb, a0, a0 + bw, 0, H, -0.8, 0.0, "Ashlar", skip=("-z",))
            # lancet window
            c = a0 + bw / 2
            pts = pointed_arch_pts(c - 0.9, c + 0.9, 10.0, 6, True)
            poly = [F.pt(c - 0.9, 0.01, 4.0), F.pt(c + 0.9, 0.01, 4.0)] + [F.pt(p[0], 0.01, p[1]) for p in reversed(pts)]
            mb.poly(poly, "Glass", F.pt(c, -2, 6), uvs=[(0, 0)] * len(poly))
            for (pa, pz), (qa, qz) in zip(pts, pts[1:]):
                F.beam(mb, pa, pz, qa, qz, 0.2, 0.0, 0.08, "Ashlar")
            F.box(mb, c - 1.0, c + 1.0, 3.8, 4.0, 0.0, 0.15, "Ashlar")
            F.box(mb, c - 0.04, c + 0.04, 4.0, 11.5, 0.0, 0.05, "Iron")
            # buttress between bays
            if b > 0:
                F.box(mb, a0 - 0.45, a0 + 0.45, 0, H - 2.0, 0.0, 1.6, "Ashlar", chamfer=0.04)
                F.box(mb, a0 - 0.45, a0 + 0.45, H - 2.0, H + 1.0, 0.0, 0.9, "Ashlar", chamfer=0.04)
                c2 = F.pt(a0, 0.45, H + 1.0)
                mb.prism(c2.x, c2.y, H + 1.0, H + 3.0, 0.4, 4, "Ashlar", r2=0.02, rot=math.pi / 4)
        F.box(mb, -0.5, width + 0.5, H - 0.4, H, 0.0, 0.25, "Ashlar", chamfer=0.03, bottom=True)
    # nave roof
    gable_roof(mb, x0 - 0.3, y0, x1 + 0.3, y1, H, math.radians(55), "RoofSlate", True, oh=0.5, oh_g=0.0, rng=None, frame_gable=False, infill="Ashlar")
    # apse (half octagon) at the north end
    n = 5
    r = W / 2
    prev = None
    for k in range(n + 1):
        a = math.pi * k / n
        p = (math.cos(a) * r, y1 + math.sin(a) * r * 0.9)
        if prev:
            mb.poly([(prev[0], prev[1], 0), (p[0], p[1], 0), (p[0], p[1], H - 1), (prev[0], prev[1], H - 1)], "Ashlar", (0, y1, H / 2))
            mb.poly([(prev[0], prev[1], H - 1), (p[0], p[1], H - 1), (0, y1, H + 6.5)], "RoofSlate", (0, y1, 0))
        prev = p
    # west front with twin towers and spires
    T = 6.5
    TH = 26.0
    fy = y0
    for side in (-1, 1):
        cx = side * (W / 2 + T / 2 - 1.0)
        tx0, tx1 = cx - T / 2, cx + T / 2
        mb.bbox(tx0, fy - 1.5, 0, tx1, fy + T - 1.5, TH, "Ashlar", c=0.06)
        for zz in (H * 0.55, H, TH - 4):
            mb.bbox(tx0 - 0.15, fy - 1.65, zz, tx1 + 0.15, fy + T - 1.35, zz + 0.3, "Ashlar", c=0.04, bottom=True)
        # belfry openings
        Ft = Face(tx0, fy - 1.5, 0, -1)
        for a in (T * 0.3, T * 0.7):
            pts = pointed_arch_pts(a - 0.55, a + 0.55, TH - 2.6, 5, True)
            poly = [Ft.pt(a - 0.55, 0.01, TH - 5.5), Ft.pt(a + 0.55, 0.01, TH - 5.5)] + [Ft.pt(p[0], 0.01, p[1]) for p in reversed(pts)]
            mb.poly(poly, "Iron", Ft.pt(a, -2, TH - 4), uvs=[(0, 0)] * len(poly))
        # spire: octagonal pyramid with pinnacles at the corners
        sc = Vector((cx, fy - 1.5 + T / 2, TH))
        mb.prism(sc.x, sc.y, TH, TH + 1.2, T / 2 + 0.2, 8, "Ashlar", rot=math.pi / 8, smooth=False)
        mb.prism(sc.x, sc.y, TH + 1.2, TH + 17.0, T / 2 - 0.4, 8, "RoofSlate", r2=0.05, rot=math.pi / 8, smooth=False)
        mb.prism(sc.x, sc.y, TH + 17.0, TH + 19.0, 0.06, 4, "Iron", r2=0.02)
        mb.box(sc.x - 0.5, sc.y - 0.04, TH + 18.0, sc.x + 0.5, sc.y + 0.04, TH + 18.1, "Gold")
        for dx in (-1, 1):
            for dy in (-1, 1):
                pc = (sc.x + dx * (T / 2 - 0.3), sc.y + dy * (T / 2 - 0.3))
                mb.prism(pc[0], pc[1], TH + 1.2, TH + 4.2, 0.35, 4, "Ashlar", r2=0.02, rot=math.pi / 4)
    # west facade between the towers: portal and rose window
    Fw = Face(x0 + 1.0, fy, 0, -1)
    ww = W - 2.0
    arch_opening(mb, Fw, ww / 2 - 1.6, ww / 2 + 1.6, 0.0, 3.6, H * 0.55, 1.2, "Ashlar", pointed=True, fill="Planks")
    Fw.box(mb, 0, ww / 2 - 1.6, 0, H * 0.55, -1.2, 0.0, "Ashlar", skip=("-z",))
    Fw.box(mb, ww / 2 + 1.6, ww, 0, H * 0.55, -1.2, 0.0, "Ashlar", skip=("-z",))
    Fw.box(mb, 0, ww, H * 0.55, H + 2.0, -0.5, 0.0, "Ashlar")
    tri = [Fw.pt(0, 0, H + 2.0), Fw.pt(ww, 0, H + 2.0), Fw.pt(ww / 2, 0, H + 2.0 + ww / 2 * math.tan(math.radians(55)))]
    mb.poly(tri, "Ashlar", Fw.pt(ww / 2, -2, H))
    rc = Fw.pt(ww / 2, 0.02, H * 0.55 + 4.0)
    M = Matrix.Translation(rc) @ Matrix.Rotation(math.pi / 2, 4, "X")
    mb.prism(0, 0, 0.0, 0.05, 2.6, 32, "Glass", M=M, top=True)
    mb.prism(0, 0, 0.0, 0.3, 2.9, 32, "Ashlar", M=M, r2=2.9, top=False)
    for k in range(12):
        a = k * math.pi / 6
        p = rc + Vector((math.cos(a) * 2.5, 0, math.sin(a) * 2.5))
        mb.pipe(rc + Vector((0, -0.1, 0)), p + Vector((0, -0.1, 0)), 0.07, "Ashlar", 4)
    M2 = Matrix.Translation(rc + Vector((0, -0.12, 0))) @ Matrix.Rotation(math.pi / 2, 4, "X")
    mb.prism(0, 0, 0, 0.1, 0.6, 16, "Ashlar", M=M2, top=True)
    mb.prism(0, 0, -0.1, 0.0, 1.5, 32, "Ashlar", M=M2, r2=1.4, top=False)
    # steps
    for k in range(5):
        mb.bbox(-4.0 - k * 0.3, fy - 1.5 - 0.5 * (k + 1), 0, 4.0 + k * 0.3, fy - 1.5 - 0.5 * k, 0.9 - k * 0.18, "Flagstone", c=0.02)
    FOOT["church"] = {"w": W + 2 * T - 2, "d": Lh + W / 2 + 2, "h": TH + 19}
    return mb.build("church")


# ----------------------------------------------------------------------------- props
def market_stall(name, stripe):
    mb = MB()
    w, d = 3.2, 2.0
    for (x, y) in ((-w / 2, -d / 2), (w / 2, -d / 2), (-w / 2, d / 2), (w / 2, d / 2)):
        mb.bbox(x - 0.06, y - 0.06, 0, x + 0.06, y + 0.06, 2.6 if y > 0 else 2.2, "Timber", c=0.015)
    mb.bbox(-w / 2, -d / 2, 0.85, w / 2, d / 2 - 0.4, 0.95, "Planks", c=0.02, bottom=True)
    mb.box(-w / 2, -d / 2, 0.0, w / 2, -d / 2 + 0.05, 0.85, "Planks")
    # awning with a sag: strips alternating stripe colours
    n = 10
    for k in range(n):
        xa = -w / 2 - 0.15 + k * (w + 0.3) / n
        xb = xa + (w + 0.3) / n
        m = stripe if k % 2 else "Fabric"
        pts = []
        for j in range(5):
            t = j / 4
            y = -d / 2 - 0.6 + t * (d + 0.7)
            z = 2.2 + t * 0.4 - math.sin(t * math.pi) * 0.12
            pts.append((y, z))
        for (ya, za), (yb, zb) in zip(pts, pts[1:]):
            mb.quad((xa, ya, za), (xb, ya, za), (xb, yb, zb), (xa, yb, zb), m)
            mb.quad((xa, yb, zb - 0.01), (xb, yb, zb - 0.01), (xb, ya, za - 0.01), (xa, ya, za - 0.01), m)
        mb.quad((xa, -d / 2 - 0.6, 2.2), (xb, -d / 2 - 0.6, 2.2), (xb, -d / 2 - 0.6, 1.95), (xa, -d / 2 - 0.6, 1.95), m)
    # produce baskets
    rng = random.Random(name)
    for k in range(5):
        x = -w / 2 + 0.4 + k * (w - 0.8) / 4
        mb.prism(x, -0.4, 0.95, 1.15, 0.28, 12, "Planks", r2=0.32, top=False, bottom=True)
        mat = rng.choice(["Produce", "Produce2", "Produce3"])
        for j in range(7):
            a = j * 0.9
            mb.sphere(x + math.cos(a) * 0.14, -0.4 + math.sin(a) * 0.14, 1.17 + (j % 2) * 0.05, 0.08, mat, 8, 5)
    for k in range(2):
        mb.prism(-w / 2 + 0.6 + k * 2.0, d / 2 - 0.2, 0, 0.9, 0.32, 14, "Planks", top=True)
    return mb.build(name)


def barrel(mb, x, y, z=0.0, h=0.9, r=0.33):
    mb.prism(x, y, z, z + h / 2, r * 0.88, 16, "Planks", r2=r, top=False)
    mb.prism(x, y, z + h / 2, z + h, r, 16, "Planks", r2=r * 0.88, top=True, cap_mat="Planks")
    for zz in (z + 0.12, z + h / 2 - 0.05, z + h - 0.15):
        rr = r * (0.9 if abs(zz - (z + h / 2)) > 0.1 else 1.0) + 0.01
        mb.prism(x, y, zz, zz + 0.04, rr, 16, "Iron", top=False)


def prop_barrels():
    mb = MB()
    barrel(mb, 0, 0)
    barrel(mb, 0.72, 0.1)
    barrel(mb, 0.35, 0.65)
    barrel(mb, 0.3, 0.25, 0.9, 0.85, 0.3)
    return mb.build("prop_barrels")


def prop_crates():
    mb = MB()
    rng = random.Random(3)
    for k in range(5):
        s = rng.uniform(0.5, 0.75)
        x, y = rng.uniform(-0.6, 0.6), rng.uniform(-0.5, 0.5)
        z = 0 if k < 3 else 0.72
        mb.bbox(x - s / 2, y - s / 2, z, x + s / 2, y + s / 2, z + s, "Planks", c=0.03)
    return mb.build("prop_crates")


def prop_cart():
    mb = MB()
    mb.bbox(-1.1, -0.7, 0.6, 1.1, 0.7, 0.72, "Planks", c=0.02, bottom=True)
    for y in (-0.7, 0.7):
        mb.box(-1.1, y - 0.04, 0.72, 1.1, y + 0.04, 1.1, "Planks")
    for x in (-1.1, 1.1):
        mb.box(x - 0.04, -0.7, 0.72, x + 0.04, 0.7, 1.0, "Planks")
    for y in (-0.82, 0.82):
        M = Matrix.Translation((0.2, y, 0.55)) @ Matrix.Rotation(math.pi / 2, 4, "X")
        mb.prism(0, 0, -0.05, 0.05, 0.55, 18, "Timber", M=M, top=True, bottom=True)
        mb.prism(0, 0, -0.06, 0.06, 0.1, 8, "Iron", M=M, top=True, bottom=True)
        for k in range(8):
            a = k * math.pi / 4
            mb.pipe((0.2, y, 0.55), (0.2 + math.cos(a) * 0.5, y, 0.55 + math.sin(a) * 0.5), 0.025, "Timber", 4)
    mb.pipe((1.1, -0.3, 0.7), (2.6, -0.2, 0.4), 0.05, "Timber", 6)
    mb.pipe((1.1, 0.3, 0.7), (2.6, 0.2, 0.4), 0.05, "Timber", 6)
    for k in range(6):
        mb.sphere(-0.6 + (k % 3) * 0.55, -0.25 + (k // 3) * 0.5, 0.95, 0.32, "Hay", 8, 5, sz=0.7)
    return mb.build("prop_cart")


def prop_well():
    mb = MB()
    mb.prism(0, 0, 0, 0.9, 1.1, 20, "Rubble", top=False, smooth=False)
    mb.prism(0, 0, 0, 0.9, 0.85, 20, "Rubble", top=False, smooth=False)
    mb.prism(0, 0, 0.9, 1.0, 1.15, 20, "Ashlar", bottom=True)
    mb.prism(0, 0, 0.5, 0.55, 0.84, 20, "Water")
    for x in (-0.95, 0.95):
        mb.bbox(x - 0.08, -0.08, 0.9, x + 0.08, 0.08, 2.6, "Timber", c=0.02)
    M = Matrix.Translation((-0.95, 0, 2.2)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
    mb.prism(0, 0, 0, 1.9, 0.08, 8, "Timber", M=M, top=True, bottom=True)
    gable_roof(mb, -1.2, -0.8, 1.2, 0.8, 2.6, math.radians(40), "RoofClay", False, oh=0.1, oh_g=0.05, rng=None, frame_gable=False, infill="Planks")
    mb.pipe((0, 0, 2.2), (0, 0, 1.4), 0.008, "Iron", 3)
    mb.prism(0, 0, 1.15, 1.4, 0.13, 10, "Planks", r2=0.15, top=False, bottom=True)
    return mb.build("prop_well")


def prop_fountain():
    mb = MB()
    n = 8
    # octagonal basin: outer wall, inner wall, a coping ring on top, water inside
    mb.prism(0, 0, 0, 0.6, 4.2, n, "Ashlar", rot=math.pi / 8, smooth=False, top=False)
    ring_o = [(4.35 * math.cos(math.pi / 8 + k * math.pi / 4), 4.35 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(n)]
    ring_i = [(3.75 * math.cos(math.pi / 8 + k * math.pi / 4), 3.75 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(n)]
    for k in range(n):
        k2 = (k + 1) % n
        mb.poly([(*ring_o[k], 0.75), (*ring_o[k2], 0.75), (*ring_i[k2], 0.75), (*ring_i[k], 0.75)], "Ashlar", (0, 0, 0))
        mb.poly([(*ring_o[k], 0.6), (*ring_o[k2], 0.6), (*ring_o[k2], 0.75), (*ring_o[k], 0.75)], "Ashlar", (0, 0, 0.67))
        mb.poly([(*ring_i[k], 0.3), (*ring_i[k2], 0.3), (*ring_i[k2], 0.75), (*ring_i[k], 0.75)], "Ashlar", (0, 0, 2.0))
    mb.prism(0, 0, 0.0, 0.48, 3.76, n, "Water", rot=math.pi / 8, smooth=False)
    mb.prism(0, 0, 0.45, 2.2, 0.55, 16, "Ashlar")
    mb.prism(0, 0, 2.2, 2.5, 1.8, 24, "Ashlar", r2=1.9, bottom=True)
    mb.prism(0, 0, 2.48, 2.52, 1.75, 24, "Water")
    mb.prism(0, 0, 2.5, 3.6, 0.3, 12, "Ashlar")
    mb.prism(0, 0, 3.6, 3.8, 0.8, 16, "Ashlar", r2=0.85, bottom=True)
    # small statue on top
    mb.prism(0, 0, 3.8, 4.9, 0.25, 10, "Ashlar", r2=0.18)
    mb.sphere(0, 0, 5.05, 0.17, "Ashlar", 10, 6)
    mb.prism(0, 0, 4.4, 4.5, 0.38, 10, "Ashlar", r2=0.2)
    return mb.build("prop_fountain")


def prop_lamppost():
    mb = MB()
    mb.prism(0, 0, 0, 0.3, 0.22, 8, "Iron", r2=0.16)
    mb.prism(0, 0, 0.3, 3.2, 0.07, 8, "Iron", r2=0.05)
    mb.pipe((0, 0, 3.0), (0.45, 0, 3.25), 0.025, "Iron", 4)
    mb.box(0.33, -0.12, 2.75, 0.57, 0.12, 3.1, "Lantern")
    mb.prism(0.45, 0, 3.1, 3.3, 0.2, 4, "Iron", r2=0.03, rot=math.pi / 4)
    return mb.build("prop_lamppost")


def prop_bench():
    mb = MB()
    mb.bbox(-1.0, -0.25, 0.42, 1.0, 0.25, 0.52, "Ashlar", c=0.03, bottom=True)
    for x in (-0.75, 0.75):
        mb.bbox(x - 0.15, -0.2, 0, x + 0.15, 0.2, 0.42, "Ashlar", c=0.03)
    return mb.build("prop_bench")


def prop_planter():
    mb = MB()
    mb.bbox(-1.0, -0.6, 0, 1.0, 0.6, 0.55, "Ashlar", c=0.04)
    rng = random.Random(9)
    for k in range(26):
        x, y = rng.uniform(-0.85, 0.85), rng.uniform(-0.45, 0.45)
        mb.sphere(x, y, 0.62 + rng.uniform(0, 0.15), rng.uniform(0.1, 0.18), "Greenery" if k % 3 else rng.choice(["FlowerRed", "FlowerPurple", "FlowerYellow", "FlowerPink"]), 8, 5)
    return mb.build("prop_planter")


def prop_banner_pole():
    mb = MB()
    mb.prism(0, 0, 0, 7.0, 0.07, 8, "Timber", r2=0.05)
    mb.sphere(0, 0, 7.05, 0.1, "Gold", 8, 5)
    for k in range(6):
        z0 = 6.8 - k * 0.6
        mb.quad((0.05, 0, z0), (1.3, 0.05 * math.sin(k), z0 - 0.08), (1.3, 0.05 * math.sin(k + 1), z0 - 0.68), (0.05, 0, z0 - 0.6), "BannerRed" if k % 2 == 0 else "BannerRed")
        mb.quad((0.05, 0, z0 - 0.6), (1.3, 0.05 * math.sin(k + 1), z0 - 0.68), (1.3, 0.05 * math.sin(k), z0 - 0.08), (0.05, 0, z0), "BannerRed")
    return mb.build("prop_banner_pole")


def prop_hay():
    mb = MB()
    M = Matrix.Rotation(math.pi / 2, 4, "Y")
    mb.prism(0, 0, -0.6, 0.6, 0.6, 16, "Hay", M=Matrix.Translation((0, 0, 0.6)) @ M, top=True, bottom=True)
    return mb.build("prop_hay")


def prop_fence():
    """3 m of wattle-and-post garden fence along x."""
    mb = MB()
    for k in range(4):
        x = k * 1.0
        mb.prism(x, 0, 0, 1.0, 0.05, 6, "Timber", r2=0.04)
    for zz in (0.35, 0.75):
        mb.box(0, -0.03, zz, 3.0, 0.03, zz + 0.06, "Timber")
    return mb.build("prop_fence")


# ----------------------------------------------------------------------------- trees
LEAF_CELLS = {"green": (0.0, 0.5), "orange": (0.5, 0.5), "yellow": (0.0, 0.0), "fir": (0.5, 0.0)}


def leaf_card(mb, c, size, rng, cell=(0.0, 0.5), n=3):
    """Crossed alpha cards (UV into one atlas cell) centred on c."""
    u0, v0 = cell
    uvs = [(u0, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.5), (u0, v0 + 0.5)]
    for k in range(n):
        a = rng.random() * math.pi + k * math.pi / n
        tilt = rng.uniform(-0.6, 0.6)
        dx, dy = math.cos(a) * size, math.sin(a) * size
        up = Vector((math.sin(tilt) * dy * 0.3, -math.sin(tilt) * dx * 0.3, size))
        p0 = Vector(c) - Vector((dx, dy, 0)) - up
        p1 = Vector(c) + Vector((dx, dy, 0)) - up
        p2 = Vector(c) + Vector((dx, dy, 0)) + up
        p3 = Vector(c) - Vector((dx, dy, 0)) + up
        mb.quad(p0, p1, p2, p3, "Leaves", uvs)
    # one roughly horizontal card for cover from above
    h = size * 0.9
    mb.quad(Vector(c) + Vector((-h, -h, 0)), Vector(c) + Vector((h, -h, 0)), Vector(c) + Vector((h, h, 0)), Vector(c) + Vector((-h, h, 0)), "Leaves", uvs)


def branch(mb, p, d, length, radius, depth, rng, tips):
    q = p + d * length
    mb.pipe(p, q, radius, "Bark", 7 if depth < 2 else 5)
    if depth >= 4 or radius < 0.035:
        tips.append(q)
        return
    n = 2 if depth > 0 else 3
    for k in range(n):
        axis = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.2, 0.6))).normalized()
        nd = (d + axis * rng.uniform(0.5, 0.9)).normalized()
        nd.z = max(nd.z, -0.1)
        nd.normalize()
        branch(mb, q, nd, length * rng.uniform(0.62, 0.78), radius * 0.62, depth + 1, rng, tips)
    if depth >= 2:
        tips.append(q)


def tree_broadleaf(name, seed, height=9.0, crown=4.0):
    rng = random.Random(seed)
    mb = MB()
    trunk_h = height * 0.38
    pts = [Vector((0, 0, 0)), Vector((0.1, 0.05, trunk_h * 0.5)), Vector((-0.05, 0.1, trunk_h))]
    r = 0.32 * height / 9
    for a, b in zip(pts, pts[1:]):
        mb.pipe(a, b, r, "Bark", 9)
    mb.prism(0, 0, 0, 0.5, r * 1.6, 9, "Bark", r2=r, top=False)
    tips = []
    for k in range(4):
        ang = k * math.pi / 2 + rng.uniform(-0.4, 0.4)
        d = Vector((math.cos(ang) * 0.6, math.sin(ang) * 0.6, 0.8)).normalized()
        branch(mb, pts[-1], d, height * 0.22, r * 0.6, 1, rng, tips)
    for t in tips:
        leaf_card(mb, t + Vector((0, 0, 0.2)), crown * rng.uniform(0.4, 0.55), rng, LEAF_CELLS["green"], n=3)
    # fill the crown envelope so it reads as a canopy, not separate tufts
    cz = trunk_h + height * 0.32
    for k in range(18):
        th = rng.random() * 2 * math.pi
        ph = math.acos(rng.uniform(-0.3, 1.0))
        rr = crown * rng.uniform(0.55, 0.95)
        c = Vector((math.cos(th) * math.sin(ph) * rr, math.sin(th) * math.sin(ph) * rr, cz + math.cos(ph) * rr * 0.75))
        leaf_card(mb, c, crown * rng.uniform(0.38, 0.5), rng, LEAF_CELLS["green"], n=2)
    return mb.build(name)


def tree_cypress(name, seed, height=11.0):
    rng = random.Random(seed)
    mb = MB()
    mb.pipe((0, 0, 0), (0, 0, height * 0.9), 0.14, "Bark", 7)
    # dense column of fir cards so it reads as a solid flame shape, not a post
    n = int(height * 7)
    for k in range(n):
        t = k / n
        z = 0.8 + t * (height - 0.8)
        rad = 0.95 * math.sin(min(1.0, t * 1.3 + 0.08) * math.pi) ** 0.8 * (1 - t * 0.35)
        a = rng.random() * 6.28
        c = Vector((math.cos(a) * rad * 0.45, math.sin(a) * rad * 0.45, z))
        leaf_card(mb, c, 0.55 + rad * 0.42, rng, LEAF_CELLS["fir"], n=2)
    return mb.build(name)


def tree_pine(name, seed, height=14.0):
    rng = random.Random(seed)
    mb = MB()
    mb.prism(0, 0, 0, height, 0.28, 9, "Bark", r2=0.04, top=False)
    whorls = int(height / 0.75)
    for w in range(whorls):
        t = w / whorls
        z = height * 0.15 + t * height * 0.83
        reach = (1 - t) ** 0.9 * height * 0.3 + 0.35
        for k in range(7):
            a = k * 2 * math.pi / 7 + rng.uniform(-0.3, 0.3) + w * 0.6
            d = Vector((math.cos(a), math.sin(a), -0.3)).normalized()
            p = Vector((0, 0, z))
            q = p + d * reach
            mb.pipe(p, q, 0.035, "Bark", 3)
            for s in (0.35, 0.7, 1.0):
                leaf_card(mb, p + (q - p) * s + Vector((0, 0, 0.05)), reach * 0.34 + 0.3, rng, LEAF_CELLS["fir"], n=2)
    leaf_card(mb, Vector((0, 0, height)), 0.6, rng, LEAF_CELLS["fir"], n=3)
    return mb.build(name)


def bush(name, seed):
    rng = random.Random(seed)
    mb = MB()
    for k in range(7):
        a = rng.random() * 6.28
        r = rng.uniform(0, 0.6)
        leaf_card(mb, (math.cos(a) * r, math.sin(a) * r, rng.uniform(0.4, 0.9)), rng.uniform(0.45, 0.7), rng, LEAF_CELLS["green"])
    return mb.build(name)


def tree_far(name, seed, kind):
    """Cheap distant tree: a trunk and a few large crossed cards."""
    rng = random.Random(seed)
    mb = MB()
    if kind == "pine":
        mb.prism(0, 0, 0, 14, 0.3, 5, "Bark", r2=0.05, top=False)
        for k in range(5):
            z = 3.5 + k * 2.3
            leaf_card(mb, (0, 0, z), 3.4 - k * 0.55, rng, LEAF_CELLS["fir"], n=3)
    else:
        mb.prism(0, 0, 0, 5, 0.32, 5, "Bark", r2=0.2, top=False)
        for k in range(4):
            c = (rng.uniform(-1, 1), rng.uniform(-1, 1), 6.5 + rng.uniform(-0.8, 1.2))
            leaf_card(mb, c, 3.2, rng, LEAF_CELLS["green"], n=2)
    return mb.build(name)


tree_far("tree_far_pine", 980, "pine")
tree_far("tree_far_oak", 981, "oak")
for k in range(3):
    tree_broadleaf(f"tree_oak_{k}", 900 + k * 11, height=[8.5, 10.5, 7.5][k], crown=[4.2, 5.0, 3.6][k])
tree_cypress("tree_cypress", 950)
tree_pine("tree_pine_0", 960, 14.0)
tree_pine("tree_pine_1", 961, 18.0)
bush("bush_0", 970)

wall_segment()
round_tower("tower_round", False)
round_tower("tower_round_roof", True)
gatehouse()
keep()
arcade_wall()
church()
market_stall("stall_orange", "Stripe")
market_stall("stall_blue", "Banner")
for fn in (prop_barrels, prop_crates, prop_cart, prop_well, prop_fountain, prop_lamppost, prop_bench, prop_planter, prop_banner_pole, prop_hay, prop_fence):
    fn()

# ----------------------------------------------------------------------------- export
COLL = bpy.context.scene.collection
tris = 0
for ob in COLL.objects:
    for p in ob.data.polygons:
        tris += len(p.vertices) - 2
print(f"objects={len(COLL.objects)} triangles={tris}")
with open(OUT_JSON, "w") as fh:
    json.dump(FOOT, fh, separators=(",", ":"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True, export_cameras=False,
                          export_extras=False, export_animations=False, export_materials="EXPORT", export_texcoords=True,
                          export_normals=True, export_vertex_color="NONE")
print("wrote", OUT, OUT_JSON)
