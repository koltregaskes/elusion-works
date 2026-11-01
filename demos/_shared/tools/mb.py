"""Shared Blender mesh builder for the Elusion Works demo kits.

Builds meshes from boxes, chamfered boxes, prisms, spheres, pipes and quads,
then makes a Blender object with per-face materials and UVs. Faces without
explicit UVs get box-projected UVs in metres divided by the material's tile
size, so textures keep a real-world scale.

Usage: set mb_mod.MATS and mb_mod.TILE (name -> material, name -> metres per
texture tile) and mb_mod.COL (the collection to link objects into).
"""

import math

import bpy
from mathutils import Matrix, Vector

MATS = {}
TILE = {}
COL = None

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
        (COL or bpy.context.scene.collection).objects.link(ob)
        return ob


