/**
 * Ashfall — the map (ARCHITECTURE.md §3.6, art direction §4).
 *
 * Freight yard 14, an hour before dusk. Three combat spaces — THE YARD, THE DEPOT to the
 * north-west, THE TERRACES to the north-east — each joined to its neighbours by two routes,
 * bounded by a perimeter of precast wall, chain-link and earth embankment.
 *
 * ---------------------------------------------------------------------------------------
 * HOW THIS FILE IS ORGANISED
 * ---------------------------------------------------------------------------------------
 *  1. Layout constants and module-scope scratch (the raycast hot path must not allocate).
 *  2. A tiny geometry builder. Everything is written through it, so every primitive lands in
 *     one of a small number of merged buffers: ~35 static draw calls for the whole map.
 *  3. Primitives. `chamferBox` is the important one — every hard edge in the scene carries a
 *     1–2 cm chamfer, because a raking 8° key light needs an edge highlight to read as a
 *     manufactured object rather than as a CSG boolean.
 *  4. Prop library — containers, rolling stock, the gantry crane, the water tower, sandbags,
 *     jersey barriers, drums, pallets, rubble, chain-link, chains, tarpaulins, lamps.
 *  5. Region builders — ground, track, yard, depot, terraces, perimeter.
 *  6. Collision: box/ramp colliders, a world-space triangle soup, a 2 m uniform grid
 *     broadphase, a 0.75 m nav grid, cover points and spawn points.
 *
 * ---------------------------------------------------------------------------------------
 * COLOUR
 * ---------------------------------------------------------------------------------------
 * Every material comes from `materials.get`/`materials.triplanar`, and every mesh carries a
 * per-vertex tint sampled from `art.js`. The tint is a multiplier on the procedural albedo,
 * which is how hazard yellow, rail green, tarpaulin blue, soot and ground-line grime get into
 * a scene whose textures are shared. Nothing here invents a colour.
 *
 * Materials are fetched through the `{ repeat: [1, 1] }` variant of `materials.get` so that
 * enabling `vertexColors` cannot leak onto another module's copy of the same surface.
 */

import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';
import { PALETTE, MAP, LIGHTING, SUN_AZIMUTH, SUN_ELEVATION } from './art.js';

/* ========================================================================== */
/* 1. Layout                                                                  */
/* ========================================================================== */

const DEG = Math.PI / 180;

/** Playable footprint. `MAP.width` x `MAP.depth` with a metre of slack for the wall bases. */
const HALF_W = MAP.width * 0.5;
const HALF_D = MAP.depth * 0.5;

const PLAY = { minX: -50, maxX: 50, minZ: -40, maxZ: 40 };

/** Running track centres, west-east. The yard reads as a yard because of these. */
const TRACK_Z = [30, 22, 14, 6, -2];
/** The depot spur, which runs in through the shed's west end and dies on a buffer stop. */
const SPUR_Z = -19;

const DEPOT = { x0: -52, x1: -22, z0: -40, z1: -8, eave: 9.2, ridge: 12.6, ridgeX: -37, wall: 0.4 };
/** The inspection pit under the spur. Shared, because the track, the floor and the collision
 *  all have to agree about where the hole is. */
const PIT = { x0: -50, x1: -31, hz: 1.15, depth: 1.55 };
const ADMIN = { x0: 20, x1: 46, z0: -40, z1: -14, wall: 0.4, floor: MAP.floorHeight, para: 1.05 };
const CRANE = { x: -8, zA: -4, zB: 24, railY: 0.55, top: 19.2 };
const TOWER = { x: -33, z: 18, h: MAP.waterTowerHeight };
const DOCK = { x0: -16, x1: 26, z0: 32, z1: 40, h: 1.15 };

/** Direction *to* the sun, matching sky.js exactly. Drives the light shafts and the shadows. */
const SUN_DIR = new THREE.Vector3(
  Math.sin(SUN_AZIMUTH * DEG) * Math.cos(SUN_ELEVATION * DEG),
  Math.sin(SUN_ELEVATION * DEG),
  Math.cos(SUN_AZIMUTH * DEG) * Math.cos(SUN_ELEVATION * DEG)
).normalize();

/** Gameplay surface ids, indexed by the per-triangle `Uint8Array`. */
const SURFACE_IDS = ['concrete', 'metal', 'wood', 'dirt', 'gravel', 'glass', 'sandbag'];
const SURFACE_INDEX = Object.create(null);
for (let i = 0; i < SURFACE_IDS.length; i++) SURFACE_INDEX[SURFACE_IDS[i]] = i;

/** Which gameplay surface each art material behaves as, for footsteps, FX and penetration. */
const MAT_SURFACE = {
  concreteRough: 'concrete',
  concretePanel: 'concrete',
  plaster: 'concrete',
  rubble: 'concrete',
  asphalt: 'concrete',
  brickPainted: 'concrete',
  metalPainted: 'metal',
  metalRust: 'metal',
  corrugatedSteel: 'metal',
  woodPlank: 'wood',
  tarpaulin: 'wood',
  sandbag: 'sandbag',
  glassDirty: 'glass',
  gravel: 'gravel',
  dirt: 'dirt',
};

/* ========================================================================== */
/* 1b. Module-scope scratch — §6 forbids allocation in the hot path           */
/* ========================================================================== */

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c3 = [0, 0, 0];
const _mtmp = new THREE.Matrix4();
const _qtmp = new THREE.Quaternion();
const _etmp = new THREE.Euler();
const _stmp = new THREE.Vector3(1, 1, 1);
const _ptmp = new THREE.Vector3();
const _col = new THREE.Color();

/** Two independent hit records: `sampleSurface` may be called with a live raycast result. */
function makeHit() {
  return {
    hit: false,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    distance: 0,
    surface: 'concrete',
    index: -1,
  };
}
const _hitA = makeHit();
const _hitB = makeHit();

/** Per-frame scratch for the animated dressing. */
const _animM = new THREE.Matrix4();
const _animQ = new THREE.Quaternion();
const _animP = new THREE.Vector3();
const _animS = new THREE.Vector3(1, 1, 1);
const _animE = new THREE.Euler();

/* ========================================================================== */
/* 2. Deterministic noise — the map must be identical every load              */
/* ========================================================================== */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable value hash for grid work (ground jitter, per-cell material choice). */
function hash2(x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function vnoise2(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const sx = xf * xf * (3 - 2 * xf);
  const sz = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

function fbm2(x, z) {
  return vnoise2(x, z) * 0.6 + vnoise2(x * 2.13 + 11.3, z * 2.13 - 7.1) * 0.3 + vnoise2(x * 4.7 - 3.2, z * 4.7 + 19.7) * 0.1;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ========================================================================== */
/* 3. Tints — sRGB palette entries resolved once into linear multipliers      */
/* ========================================================================== */

/**
 * A tint is a flat `[r, g, b]` in linear space. Values hover around 1.0: the procedural
 * albedo already carries the surface, the tint only pushes it. Anything far from 1 is a
 * deliberate repaint (hazard bands, rail green, the tarpaulins).
 */
function tint(hex, mul = 1) {
  _col.setStyle(hex, THREE.SRGBColorSpace);
  return [_col.r * mul, _col.g * mul, _col.b * mul];
}

/** Neutral, plus a touch of variation so no two merged surfaces read identically. */
function grey(v) {
  return [v, v, v];
}

/** Blend two tints. Load-time only, so allocating a small array is fine. */
function mixTint(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

const T = {
  white: grey(1),
  concrete: grey(1),
  concreteDark: grey(0.78),
  concreteWorn: grey(0.88),
  kerb: grey(0.92),
  asphalt: grey(0.96),
  steel: grey(1),
  steelDark: grey(0.72),
  rust: tint(PALETTE.rust, 1.0),
  rustDeep: tint(PALETTE.rustDeep, 1.0),
  railGreen: tint(PALETTE.railGreen, 1.35),
  steelPainted: tint(PALETTE.steelPainted, 1.3),
  hazard: tint(PALETTE.hazardYellow, 1.25),
  tarpBlue: tint(PALETTE.tarpBlue, 1.5),
  wood: grey(1),
  woodDark: grey(0.8),
  sleeper: grey(0.72),
  brick: tint(PALETTE.brick, 1.15),
  brickPale: tint(PALETTE.brickPainted, 1.1),
  plaster: tint(PALETTE.plaster, 1.05),
  dirt: tint(PALETTE.dirt, 1.15),
  gravel: grey(1),
  soot: grey(0.32),
  sootMid: grey(0.55),
  sandbag: tint(PALETTE.sandbag, 1.1),
  glass: tint(PALETTE.glass, 1.0),
  weeds: tint(PALETTE.weeds, 1.25),
  ember: tint(PALETTE.ember, 1),
  smoke: tint(PALETTE.smoke, 1),
  sun: tint(PALETTE.sun, 1),
  bounce: tint(PALETTE.groundBounce, 1),
};

/** Container livery. Low saturation, one hazard hit, so the stacks read as a rhythm. */
const CONTAINER_TINTS = [
  tint('#7d4a34', 1.0),
  tint('#4a5a58', 1.05),
  tint('#6c6152', 1.05),
  tint('#3f5468', 1.0),
  tint('#8a6a3c', 1.0),
  tint('#5d4c46', 1.05),
  tint('#4d5a44', 1.05),
  tint('#7a6f66', 1.0),
];

/* ========================================================================== */
/* 4. Geometry builder                                                        */
/* ========================================================================== */

/**
 * A single growable vertex buffer. Every primitive writes through the shared transform
 * stack, so an entire region of the map ends up as one indexed BufferGeometry and one draw
 * call. Attributes are fixed at position/normal/uv/color so `mergeGeometries` can combine
 * buffers later without an attribute mismatch.
 */
class Geo {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.count = 0;
  }

  get tris() {
    return this.idx.length / 3;
  }

  /** @param {number} uvScale metres-to-tile conversion, applied once on build. */
  build(uvScale = 1) {
    const g = new THREE.BufferGeometry();
    const n = this.count;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) uv[i] = this.uv[i] * uvScale;
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(this.nor), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(this.col), 3));
    const Idx = n > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(Idx.from(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/* --- transform stack ------------------------------------------------------ */

const XSTACK = [];
const XSCRATCH = [];
for (let i = 0; i < 24; i++) {
  XSTACK.push(new THREE.Matrix4());
  XSCRATCH.push(new THREE.Matrix4());
}
let xDepth = 0;
let curM = XSTACK[0];
const curNM = new THREE.Matrix3();

function resetX() {
  xDepth = 0;
  XSTACK[0].identity();
  curM = XSTACK[0];
  curNM.identity();
}

/** Compose a local transform onto the stack. Returns the depth so callers can assert. */
function pushX(m) {
  const d = xDepth + 1;
  XSTACK[d].multiplyMatrices(XSTACK[xDepth], m);
  xDepth = d;
  curM = XSTACK[d];
  curNM.getNormalMatrix(curM);
}

function popX() {
  xDepth = Math.max(0, xDepth - 1);
  curM = XSTACK[xDepth];
  curNM.getNormalMatrix(curM);
}

/** Translate + Y-yaw + optional X/Z tilt, composed into a scratch matrix for `pushX`. */
function trs(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = XSCRATCH[xDepth];
  _etmp.set(rx, ry, rz, 'YXZ');
  _qtmp.setFromEuler(_etmp);
  _ptmp.set(x, y, z);
  _stmp.set(sx, sy, sz);
  m.compose(_ptmp, _qtmp, _stmp);
  return m;
}

function place(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  pushX(trs(x, y, z, ry, rx, rz, sx, sy, sz));
}

/**
 * Yaw that maps **local +X onto the run direction**. Every helper that lays something out
 * along a line (walls, fences, kerbs, sandbag revetments) authors its profile across local Z
 * and its length along local X, so this is the one conversion they all need. Using
 * `atan2(dx, dz)` instead — which maps local +Z onto the run — silently builds every wall
 * rotated ninety degrees, which is exactly the kind of error that only shows up in a
 * screenshot.
 */
function runYaw(dx, dz) {
  return Math.atan2(-dz, dx);
}

/* --- vertex + polygon emitters -------------------------------------------- */

function gv(g, x, y, z, nx, ny, nz, u, v, t) {
  _p.set(x, y, z).applyMatrix4(curM);
  _n.set(nx, ny, nz).applyMatrix3(curNM).normalize();
  g.pos.push(_p.x, _p.y, _p.z);
  g.nor.push(_n.x, _n.y, _n.z);
  g.uv.push(u, v);
  g.col.push(t[0], t[1], t[2]);
  return g.count++;
}

/**
 * Emit a convex polygon as a fan. UVs are a planar projection in *local* metres, so a texture
 * stays glued to the prop through any placement transform. Winding is corrected against the
 * supplied normal, which keeps every primitive below readable instead of a puzzle.
 */
function gpoly(g, pts, nx, ny, nz, t) {
  const k = pts.length / 3;
  if (k < 3) return;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  let ui = 0;
  let vi = 1;
  if (ax >= ay && ax >= az) {
    ui = 2;
    vi = 1;
  } else if (ay >= az) {
    ui = 0;
    vi = 2;
  }

  // Winding: flip the fan if the first triangle faces away from the requested normal.
  const e1x = pts[3] - pts[0];
  const e1y = pts[4] - pts[1];
  const e1z = pts[5] - pts[2];
  const e2x = pts[6] - pts[0];
  const e2y = pts[7] - pts[1];
  const e2z = pts[8] - pts[2];
  const cx = e1y * e2z - e1z * e2y;
  const cy = e1z * e2x - e1x * e2z;
  const cz = e1x * e2y - e1y * e2x;
  const flip = cx * nx + cy * ny + cz * nz < 0;

  const base = g.count;
  for (let j = 0; j < k; j++) {
    const i = flip ? k - 1 - j : j;
    _c3[0] = pts[i * 3];
    _c3[1] = pts[i * 3 + 1];
    _c3[2] = pts[i * 3 + 2];
    gv(g, _c3[0], _c3[1], _c3[2], nx, ny, nz, _c3[ui], _c3[vi], t);
  }
  for (let i = 1; i < k - 1; i++) g.idx.push(base, base + i, base + i + 1);
}

/** Smooth-shaded quad with explicit per-corner normals — for lathes and cables. */
function gquadN(g, ax, ay, az, an, bx, by, bz, bn, cx2, cy2, cz2, cn, dx, dy, dz, dn, u0, u1, v0, v1, t) {
  const i0 = gv(g, ax, ay, az, an[0], an[1], an[2], u0, v0, t);
  const i1 = gv(g, bx, by, bz, bn[0], bn[1], bn[2], u1, v0, t);
  const i2 = gv(g, cx2, cy2, cz2, cn[0], cn[1], cn[2], u1, v1, t);
  const i3 = gv(g, dx, dy, dz, dn[0], dn[1], dn[2], u0, v1, t);
  g.idx.push(i0, i1, i2, i0, i2, i3);
}

/* ========================================================================== */
/* 5. Primitives                                                              */
/* ========================================================================== */

const _bp = [];

/**
 * A chamfered box: 6 faces, 12 edge bevels, 8 corner triangles. 44 triangles.
 *
 * The chamfer is the single highest-value detail in the whole file. At 8° of sun elevation a
 * true 90° arris returns nothing; a 1.5 cm bevel returns a hot specular line that traces the
 * silhouette of every object in the scene. Default 0.015 m.
 */
function chamferBox(g, cx, cy, cz, hx, hy, hz, t, c = 0.015) {
  hx = Math.abs(hx);
  hy = Math.abs(hy);
  hz = Math.abs(hz);
  c = Math.min(c, hx * 0.45, hy * 0.45, hz * 0.45);
  const h = [hx, hy, hz];
  const o = [cx, cy, cz];
  const p = _bp;

  // 6 faces, inset by the chamfer on both tangent axes.
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const d = (a + 2) % 3;
    for (let s = -1; s <= 1; s += 2) {
      p.length = 0;
      const sb = [-1, 1, 1, -1];
      const sd = [-1, -1, 1, 1];
      for (let k = 0; k < 4; k++) {
        const v = [0, 0, 0];
        v[a] = s * h[a];
        v[b] = sb[k] * (h[b] - c);
        v[d] = sd[k] * (h[d] - c);
        p.push(o[0] + v[0], o[1] + v[1], o[2] + v[2]);
      }
      const n = [0, 0, 0];
      n[a] = s;
      gpoly(g, p, n[0], n[1], n[2], t);
    }
  }

  // 12 edge bevels.
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const d = (a + 2) % 3;
    for (let sa = -1; sa <= 1; sa += 2) {
      for (let sb = -1; sb <= 1; sb += 2) {
        p.length = 0;
        const push = (va, vb, vd) => {
          const v = [0, 0, 0];
          v[a] = va;
          v[b] = vb;
          v[d] = vd;
          p.push(o[0] + v[0], o[1] + v[1], o[2] + v[2]);
        };
        push(sa * h[a], sb * (h[b] - c), -(h[d] - c));
        push(sa * h[a], sb * (h[b] - c), h[d] - c);
        push(sa * (h[a] - c), sb * h[b], h[d] - c);
        push(sa * (h[a] - c), sb * h[b], -(h[d] - c));
        const n = [0, 0, 0];
        n[a] = sa * Math.SQRT1_2;
        n[b] = sb * Math.SQRT1_2;
        gpoly(g, p, n[0], n[1], n[2], t);
      }
    }
  }

  // 8 corner triangles.
  const k3 = 1 / Math.sqrt(3);
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        p.length = 0;
        p.push(cx + sx * hx, cy + sy * (hy - c), cz + sz * (hz - c));
        p.push(cx + sx * (hx - c), cy + sy * hy, cz + sz * (hz - c));
        p.push(cx + sx * (hx - c), cy + sy * (hy - c), cz + sz * hz);
        gpoly(g, p, sx * k3, sy * k3, sz * k3, t);
      }
    }
  }
}

/**
 * Unchamfered box, 12 triangles. Reserved for details whose edges are under about 4 cm or
 * are never lit directly — bricks in a rubble pile, lattice bracing thirty metres up, deck
 * boards inside a pallet. Anything the player can walk up to keeps its chamfer.
 */
function plainBox(g, cx, cy, cz, hx, hy, hz, t) {
  const h = [hx, hy, hz];
  const o = [cx, cy, cz];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const d = (a + 2) % 3;
    for (let s = -1; s <= 1; s += 2) {
      _bp.length = 0;
      const sb = [-1, 1, 1, -1];
      const sd = [-1, -1, 1, 1];
      for (let k = 0; k < 4; k++) {
        const v = [0, 0, 0];
        v[a] = s * h[a];
        v[b] = sb[k] * h[b];
        v[d] = sd[k] * h[d];
        _bp.push(o[0] + v[0], o[1] + v[1], o[2] + v[2]);
      }
      const n = [0, 0, 0];
      n[a] = s;
      gpoly(g, _bp, n[0], n[1], n[2], t);
    }
  }
}

/** Thin member between two points, 12 triangles. The lattice workhorse. */
function strutThin(g, x0, y0, z0, x1, y1, z1, w, t) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-5) return;
  place((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5, Math.atan2(dx, dz), -Math.asin(clamp(dy / len, -1, 1)));
  plainBox(g, 0, 0, 0, w, w, len * 0.5, t);
  popX();
}

/** Axis-aligned quad in the XZ plane, facing +Y. Used for floors, decks and light pools. */
function quadXZ(g, cx, y, cz, hx, hz, t, up = 1) {
  _bp.length = 0;
  _bp.push(cx - hx, y, cz - hz, cx + hx, y, cz - hz, cx + hx, y, cz + hz, cx - hx, y, cz + hz);
  gpoly(g, _bp, 0, up, 0, t);
}

/**
 * A cylinder along local Y with smooth side normals and a small chamfer on both rims.
 * Used for drums, tubes, columns, cable and pipework.
 */
function tube(g, rTop, rBot, h, seg, t, capTop = true, capBot = false, chamf = 0.01, uvTwist = 0) {
  const y0 = -h * 0.5;
  const y1 = h * 0.5;
  const rt = Math.max(0.0005, rTop - chamf);
  const rb = Math.max(0.0005, rBot - chamf);
  const circ = Math.PI * (rTop + rBot);
  const nA = [0, 0, 0];
  const nB = [0, 0, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2 + uvTwist;
    const a1 = ((i + 1) / seg) * Math.PI * 2 + uvTwist;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const slope = (rBot - rTop) / Math.max(h, 1e-4);
    const inv = 1 / Math.sqrt(1 + slope * slope);
    nA[0] = c0 * inv;
    nA[1] = slope * inv;
    nA[2] = s0 * inv;
    nB[0] = c1 * inv;
    nB[1] = slope * inv;
    nB[2] = s1 * inv;
    const u0 = (i / seg) * circ;
    const u1 = ((i + 1) / seg) * circ;
    // Main barrel between the two chamfer rings.
    gquadN(
      g,
      c0 * rBot, y0 + chamf, s0 * rBot, nA,
      c1 * rBot, y0 + chamf, s1 * rBot, nB,
      c1 * rTop, y1 - chamf, s1 * rTop, nB,
      c0 * rTop, y1 - chamf, s0 * rTop, nA,
      u0, u1, 0, h, t
    );
    if (chamf > 0.0005) {
      const up = [0, 0.7, 0];
      const dn = [0, -0.7, 0];
      const ta = [nA[0] * 0.7, 0.7, nA[2] * 0.7];
      const tb = [nB[0] * 0.7, 0.7, nB[2] * 0.7];
      const ba = [nA[0] * 0.7, -0.7, nA[2] * 0.7];
      const bb = [nB[0] * 0.7, -0.7, nB[2] * 0.7];
      void up;
      void dn;
      gquadN(
        g,
        c0 * rTop, y1 - chamf, s0 * rTop, ta,
        c1 * rTop, y1 - chamf, s1 * rTop, tb,
        c1 * rt, y1, s1 * rt, tb,
        c0 * rt, y1, s0 * rt, ta,
        u0, u1, h, h + chamf, t
      );
      gquadN(
        g,
        c0 * rb, y0, s0 * rb, ba,
        c1 * rb, y0, s1 * rb, bb,
        c1 * rBot, y0 + chamf, s1 * rBot, bb,
        c0 * rBot, y0 + chamf, s0 * rBot, ba,
        u0, u1, -chamf, 0, t
      );
    }
  }
  if (capTop) {
    _bp.length = 0;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2 + uvTwist;
      _bp.push(Math.cos(a) * rt, y1, Math.sin(a) * rt);
    }
    gpoly(g, _bp, 0, 1, 0, t);
  }
  if (capBot) {
    _bp.length = 0;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2 + uvTwist;
      _bp.push(Math.cos(a) * rb, y0, Math.sin(a) * rb);
    }
    gpoly(g, _bp, 0, -1, 0, t);
  }
}

/** A rod between two local points, built as a chamfered box so it catches an edge highlight. */
function strut(g, x0, y0, z0, x1, y1, z1, w, t, c = 0.008) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-5) return;
  const yaw = Math.atan2(dx, dz);
  // Negated: with a 'YXZ' euler the X rotation sends local +Z to (0, -sin p, cos p), so a
  // positive rise needs a negative pitch. Getting this wrong inverts every diagonal brace.
  const pitch = -Math.asin(clamp(dy / len, -1, 1));
  place((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5, yaw, pitch);
  chamferBox(g, 0, 0, 0, w, w, len * 0.5, t, c);
  popX();
}

/** Torus, for chain links, hoops and tyres. */
function torus(g, R, r, segR, segT, t) {
  for (let i = 0; i < segR; i++) {
    const a0 = (i / segR) * Math.PI * 2;
    const a1 = ((i + 1) / segR) * Math.PI * 2;
    for (let j = 0; j < segT; j++) {
      const b0 = (j / segT) * Math.PI * 2;
      const b1 = ((j + 1) / segT) * Math.PI * 2;
      const pt = (a, b) => {
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const cb = Math.cos(b);
        const sb = Math.sin(b);
        return [(R + r * cb) * ca, r * sb, (R + r * cb) * sa, ca * cb, sb, sa * cb];
      };
      const A = pt(a0, b0);
      const B = pt(a1, b0);
      const C = pt(a1, b1);
      const D = pt(a0, b1);
      gquadN(
        g,
        A[0], A[1], A[2], [A[3], A[4], A[5]],
        B[0], B[1], B[2], [B[3], B[4], B[5]],
        C[0], C[1], C[2], [C[3], C[4], C[5]],
        D[0], D[1], D[2], [D[3], D[4], D[5]],
        a0 * R, a1 * R, b0 * r, b1 * r, t
      );
    }
  }
}

/**
 * Corrugated sheet: a trapezoidal profile running along local X, `h` tall in Y, ribs standing
 * proud in +Z. Backed with a flat inner skin so the panel is a solid, not a ribbon.
 */
function corrugated(g, w, h, t, pitch = 0.24, depth = 0.035, backing = 0.02) {
  const n = Math.max(2, Math.round(w / pitch));
  const step = w / n;
  const x0 = -w * 0.5;
  const y0 = -h * 0.5;
  const y1 = h * 0.5;
  const flat = step * 0.3;
  let prevX = x0;
  let prevZ = 0;
  const nA = [0, 0, 1];
  const nB = [0, 0, 1];
  const seg = (ax, az, bx, bz) => {
    const dx = bx - ax;
    const dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    nA[0] = -dz / l;
    nA[1] = 0;
    nA[2] = dx / l;
    nB[0] = nA[0];
    nB[1] = 0;
    nB[2] = nA[2];
    if (nA[2] < 0) {
      nA[0] = -nA[0];
      nA[2] = -nA[2];
      nB[0] = nA[0];
      nB[2] = nA[2];
    }
    gquadN(g, ax, y0, az, nA, bx, y0, bz, nB, bx, y1, bz, nB, ax, y1, az, nA, ax - x0, bx - x0, 0, h, t);
  };
  for (let i = 0; i < n; i++) {
    const a = x0 + i * step;
    seg(prevX, prevZ, a + flat, 0);
    seg(a + flat, 0, a + step * 0.5 - flat * 0.4, depth);
    seg(a + step * 0.5 - flat * 0.4, depth, a + step * 0.5 + flat * 0.4, depth);
    prevX = a + step * 0.5 + flat * 0.4;
    prevZ = depth;
    seg(prevX, prevZ, a + step, 0);
    prevX = a + step;
    prevZ = 0;
  }
  // Inner skin + the four edges, so the panel has thickness.
  if (backing > 0) {
    _bp.length = 0;
    _bp.push(x0, y0, -backing, x0 + w, y0, -backing, x0 + w, y1, -backing, x0, y1, -backing);
    gpoly(g, _bp, 0, 0, -1, t);
    _bp.length = 0;
    _bp.push(x0, y1, -backing, x0 + w, y1, -backing, x0 + w, y1, depth, x0, y1, depth);
    gpoly(g, _bp, 0, 1, 0, t);
    _bp.length = 0;
    _bp.push(x0, y0, -backing, x0 + w, y0, -backing, x0 + w, y0, depth, x0, y0, depth);
    gpoly(g, _bp, 0, -1, 0, t);
  }
}

/** Rolled-steel section (I-beam) along local Z. Three chamfered boxes, correctly proportioned. */
function ibeam(g, len, depth, width, tw, tf, t) {
  const hz = len * 0.5;
  chamferBox(g, 0, depth * 0.5 - tf * 0.5, 0, width * 0.5, tf * 0.5, hz, t, 0.008);
  chamferBox(g, 0, -depth * 0.5 + tf * 0.5, 0, width * 0.5, tf * 0.5, hz, t, 0.008);
  chamferBox(g, 0, 0, 0, tw * 0.5, depth * 0.5 - tf, hz, t, 0.006);
}

/** Right-angled prism: the collision-friendly shape behind every ramp and berm face. */
function wedge(g, hx, hz, y0, y1, t) {
  const p = _bp;
  // Sloped top.
  p.length = 0;
  p.push(-hx, y0, -hz, hx, y1, -hz, hx, y1, hz, -hx, y0, hz);
  const dy = y1 - y0;
  const dl = Math.hypot(dy, 2 * hx) || 1;
  gpoly(g, p, -dy / dl, (2 * hx) / dl, 0, t);
  // Ends.
  p.length = 0;
  p.push(-hx, 0, -hz, hx, 0, -hz, hx, y1, -hz, -hx, y0, -hz);
  gpoly(g, p, 0, 0, -1, t);
  p.length = 0;
  p.push(-hx, 0, hz, hx, 0, hz, hx, y1, hz, -hx, y0, hz);
  gpoly(g, p, 0, 0, 1, t);
  // High face and base.
  p.length = 0;
  p.push(hx, 0, -hz, hx, y1, -hz, hx, y1, hz, hx, 0, hz);
  gpoly(g, p, 1, 0, 0, t);
  p.length = 0;
  p.push(-hx, 0, -hz, hx, 0, -hz, hx, 0, hz, -hx, 0, hz);
  gpoly(g, p, 0, -1, 0, t);
}

/* ========================================================================== */
/* 6. The factory                                                             */
/* ========================================================================== */

/**
 * @param {THREE.Scene} scene
 * @param {object} materials  world/materials.js (or main.js's inert stub)
 * @param {object} game
 */
export function createLevel(scene, materials, game) {
  const quality = (game && game.quality) || 'high';
  const lod = quality === 'low' ? 0 : quality === 'medium' ? 1 : 2;
  const rand = mulberry32(0x5eed1a7e);

  const root = new THREE.Group();
  root.name = 'level';
  root.matrixAutoUpdate = false;

  const LAYER = (game && game.engine && game.engine.LAYER) || {
    WORLD: 0,
    VIEWMODEL: 1,
    NOPREPASS: 2,
    DECAL: 3,
  };
  const setLayer = (obj, layer) => {
    if (game && game.engine && typeof game.engine.setLayer === 'function') {
      game.engine.setLayer(obj, layer);
    } else if (obj && obj.traverse) {
      obj.traverse((o) => o.layers.set(layer));
    }
    return obj;
  };

  /* ---------------------------------------------------------------------- */
  /* Materials                                                               */
  /* ---------------------------------------------------------------------- */

  const matCache = new Map();
  const ownedMaterials = new Set();

  /**
   * Every merged surface uses the `{repeat:[1,1]}` variant of its art material so that
   * switching `vertexColors` on cannot contaminate another module's copy. Falls back to a
   * plain standard material if the library is the inert stub.
   */
  function mat(name) {
    const key = name;
    let m = matCache.get(key);
    if (m) return m;
    try {
      m = materials && materials.get ? materials.get(name, { repeat: [1, 1] }) : null;
    } catch {
      m = null;
    }
    if (!m) {
      try {
        m = materials && materials.get ? materials.get(name) : null;
      } catch {
        m = null;
      }
    }
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x8d8880, roughness: 0.92, metalness: 0.0 });
      ownedMaterials.add(m);
    }
    m.vertexColors = true;
    m.needsUpdate = true;
    try {
      if (game && game.shadows && game.shadows.register) game.shadows.register(m);
    } catch {
      /* shadows may be a stub */
    }
    matCache.set(key, m);
    return m;
  }

  /** Triplanar variant, for terrain, ballast, berms and rubble where UV seams would show. */
  function matTri(name, scale) {
    const key = `tri:${name}:${scale}`;
    let m = matCache.get(key);
    if (m) return m;
    try {
      m = materials && materials.triplanar ? materials.triplanar(name, scale) : null;
    } catch {
      m = null;
    }
    if (!m) return mat(name);
    m.vertexColors = true;
    m.needsUpdate = true;
    try {
      if (game && game.shadows && game.shadows.register) game.shadows.register(m);
    } catch {
      /* stub */
    }
    matCache.set(key, m);
    return m;
  }

  const tileOf = (name) => {
    try {
      const v = materials && materials.tileMetres ? materials.tileMetres(name) : 2.0;
      return v > 0 ? v : 2.0;
    } catch {
      return 2.0;
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Buckets — material x coarse chunk, so culling still works               */
  /* ---------------------------------------------------------------------- */

  const buckets = new Map(); // key -> { geo, name, tri:boolean, triScale }
  const bucketOrder = [];

  /** Four quadrants. More would cull better but multiply the CSM cascade draw calls. */
  function chunkAt(x, z) {
    return (x < 0 ? 0 : 1) + (z < 4 ? 0 : 2);
  }

  /** Current world position of the transform stack origin, for chunk assignment. */
  function chunkHere() {
    _ptmp.set(0, 0, 0).applyMatrix4(curM);
    return chunkAt(_ptmp.x, _ptmp.z);
  }

  function bucket(name, triplanar = false, triScale = 0) {
    const ch = chunkHere();
    const key = `${triplanar ? 'T' : 'U'}${name}#${ch}`;
    let b = buckets.get(key);
    if (!b) {
      b = { geo: new Geo(), name, tri: triplanar, triScale, chunk: ch };
      buckets.set(key, b);
      bucketOrder.push(b);
    }
    return b.geo;
  }

  /** Shorthand: the geometry buffer for a UV-mapped art material at the current transform. */
  const G = (name) => bucket(name, false);
  /** Shorthand: the triplanar buffer. */
  const GT = (name, scale) => bucket(name, true, scale);

  /* ---------------------------------------------------------------------- */
  /* Collision                                                               */
  /* ---------------------------------------------------------------------- */

  const colliders = [];
  const triList = []; // flat xyz*3 per triangle
  const triSurf = [];

  function emitTri(ax, ay, az, bx, by, bz, cx, cy, cz, sid) {
    triList.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    triSurf.push(sid);
  }

  const _cb = new Float64Array(24);

  /**
   * A solid box in world space: pushes a collider record, and the 12 outward-wound triangles
   * the player capsule, the AI line-of-sight probe and every bullet actually test against.
   *
   * `opts.walkTop` marks the top face as standable ground for the nav grid; `opts.cover`
   * makes it a candidate for AI cover points.
   */
  function solidBox(cx, cy, cz, hx, hy, hz, surface, yaw = 0, opts = null) {
    const sid = SURFACE_INDEX[surface] !== undefined ? SURFACE_INDEX[surface] : 0;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    let k = 0;
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        for (let sx = -1; sx <= 1; sx += 2) {
          const lx = sx * hx;
          const lz = sz * hz;
          _cb[k++] = cx + lx * cs + lz * sn;
          _cb[k++] = cy + sy * hy;
          _cb[k++] = cz + (-lx * sn + lz * cs);
        }
      }
    }
    // Index order: 0(-y,-z,-x) 1(-y,-z,+x) 2(-y,+z,-x) 3(-y,+z,+x) 4..7 mirrored in +y.
    const V = _cb;
    // Wound so the face normal points *out* of the box. Ballistics reads the raw geometric
    // normal (it distinguishes entry from exit faces by its sign), so this cannot be fudged
    // by flipping normals towards the ray at query time.
    const q = (a, b, c, d) => {
      emitTri(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[d * 3], V[d * 3 + 1], V[d * 3 + 2], V[c * 3], V[c * 3 + 1], V[c * 3 + 2], sid);
      emitTri(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[c * 3], V[c * 3 + 1], V[c * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2], sid);
    };
    q(4, 5, 7, 6); // +Y
    q(0, 2, 3, 1); // -Y
    q(1, 3, 7, 5); // +X(local)
    q(2, 0, 4, 6); // -X
    q(3, 2, 6, 7); // +Z
    q(0, 1, 5, 4); // -Z

    const min = new THREE.Vector3(Infinity, cy - hy, Infinity);
    const max = new THREE.Vector3(-Infinity, cy + hy, -Infinity);
    for (let i = 0; i < 8; i++) {
      const x = V[i * 3];
      const z = V[i * 3 + 2];
      if (x < min.x) min.x = x;
      if (x > max.x) max.x = x;
      if (z < min.z) min.z = z;
      if (z > max.z) max.z = z;
    }
    const rec = {
      type: 'box',
      min,
      max,
      quat: yaw !== 0 ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) : null,
      surface,
      walkTop: !!(opts && opts.walkTop),
      cover: !!(opts && opts.cover),
      noNav: !!(opts && opts.noNav),
    };
    colliders.push(rec);
    return rec;
  }

  /**
   * A ramp: footprint 2hx x 2hz, rising from `y0` at -X to `y1` at +X (rotated by `yaw`).
   * Rubble ramps, embankments and the stair proxies all use this so the player never trips
   * on a step edge — the visual geometry keeps its detail, the collision does not.
   */
  function solidRamp(cx, cz, hx, hz, y0, y1, surface, yaw = 0, opts = null) {
    const sid = SURFACE_INDEX[surface] !== undefined ? SURFACE_INDEX[surface] : 0;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const P = [];
    const put = (lx, ly, lz) => {
      P.push(cx + lx * cs + lz * sn, ly, cz + (-lx * sn + lz * cs));
    };
    const base = Math.min(y0, y1) - 2.0;
    put(-hx, y0, -hz); // 0
    put(hx, y1, -hz); // 1
    put(hx, y1, hz); // 2
    put(-hx, y0, hz); // 3
    put(-hx, base, -hz); // 4
    put(hx, base, -hz); // 5
    put(hx, base, hz); // 6
    put(-hx, base, hz); // 7
    const q = (a, b, c, d) => {
      emitTri(P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2], P[c * 3], P[c * 3 + 1], P[c * 3 + 2], sid);
      emitTri(P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[c * 3], P[c * 3 + 1], P[c * 3 + 2], P[d * 3], P[d * 3 + 1], P[d * 3 + 2], sid);
    };
    q(0, 3, 2, 1); // slope
    q(4, 5, 6, 7); // base
    q(1, 2, 6, 5); // +X
    q(3, 0, 4, 7); // -X
    q(0, 1, 5, 4); // -Z
    q(2, 3, 7, 6); // +Z

    const min = new THREE.Vector3(Infinity, base, Infinity);
    const max = new THREE.Vector3(-Infinity, Math.max(y0, y1), -Infinity);
    for (let i = 0; i < 8; i++) {
      const x = P[i * 3];
      const z = P[i * 3 + 2];
      if (x < min.x) min.x = x;
      if (x > max.x) max.x = x;
      if (z < min.z) min.z = z;
      if (z > max.z) max.z = z;
    }
    colliders.push({
      type: 'ramp',
      min,
      max,
      quat: yaw !== 0 ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) : null,
      surface,
      y0,
      y1,
      yaw,
      hx,
      hz,
      cx,
      cz,
      walkTop: true,
      cover: false,
      noNav: !!(opts && opts.noNav),
    });
  }

  /** Ground collision, emitted as a grid so no single triangle spans the broadphase. */
  const groundHoles = [];
  function groundHole(x0, z0, x1, z1) {
    groundHoles.push({ x0, z0, x1, z1 });
  }

  function emitGroundCollision() {
    const step = 2.5;
    const sid = SURFACE_INDEX.gravel;
    for (let x = -HALF_W - 2; x < HALF_W + 2; x += step) {
      for (let z = -HALF_D - 2; z < HALF_D + 2; z += step) {
        const x1 = x + step;
        const z1 = z + step;
        let hole = false;
        for (let i = 0; i < groundHoles.length; i++) {
          const h = groundHoles[i];
          if (x1 > h.x0 && x < h.x1 && z1 > h.z0 && z < h.z1) {
            hole = true;
            break;
          }
        }
        if (hole) continue;
        emitTri(x, 0, z, x, 0, z1, x1, 0, z1, sid);
        emitTri(x, 0, z, x1, 0, z1, x1, 0, z, sid);
      }
    }
    // A slab under the whole map so nothing can fall out of the world.
    colliders.push({
      type: 'box',
      min: new THREE.Vector3(-HALF_W - 4, -3, -HALF_D - 4),
      max: new THREE.Vector3(HALF_W + 4, 0, HALF_D + 4),
      quat: null,
      surface: 'gravel',
      walkTop: false,
      cover: false,
      noNav: true,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Instanced prop registry                                                 */
  /* ---------------------------------------------------------------------- */

  const instanceSets = new Map();

  /**
   * Anything drawn more than eight times goes through here: one geometry upload, one draw
   * call, per-instance transform and per-instance colour so the repetition never reads.
   */
  function inst(key, matName, buildFn) {
    let set = instanceSets.get(key);
    if (!set) {
      resetX();
      const g = new Geo();
      buildFn(g);
      set = { geo: g.build(1 / tileOf(matName)), matName, items: [], mesh: null };
      instanceSets.set(key, set);
    }
    return set;
  }

  function addInstance(set, x, y, z, ry, rx, rz, s, tintArr, sy, sz) {
    set.items.push({
      x, y, z,
      ry: ry || 0,
      rx: rx || 0,
      rz: rz || 0,
      sx: s === undefined ? 1 : s,
      sy: sy === undefined ? (s === undefined ? 1 : s) : sy,
      sz: sz === undefined ? (s === undefined ? 1 : s) : sz,
      t: tintArr || T.white,
    });
  }

  /* ====================================================================== */
  /* 7. Prop library                                                         */
  /* ====================================================================== */

  /* --- shipping container ------------------------------------------------ */

  /**
   * ISO box. Corrugated side and end walls, a rain-channelled roof, eight corner castings,
   * a full door end with four locking bars, hinges and cams, and the bottom side rail. Built
   * once per length and instanced with per-box colour so a stack never reads as a copy.
   */
  function containerGeo(g, len) {
    const W = 2.438;
    const H = 2.591;
    const hw = W * 0.5;
    const hl = len * 0.5;
    const hh = H * 0.5;
    const t0 = T.white;

    // Side walls: corrugation runs vertically on a real container, so the sheet is built in
    // the XY plane and rotated to stand on each flank.
    for (let s = -1; s <= 1; s += 2) {
      place(s * hw, 0, 0, s > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      corrugated(g, len - 0.22, H - 0.24, t0, 0.26, 0.032, 0.03);
      popX();
    }
    // Ends: front is plain corrugation, the door end gets its own treatment below.
    place(0, 0, -hl, 0);
    corrugated(g, W - 0.2, H - 0.24, t0, 0.24, 0.03, 0.03);
    popX();
    // Roof, with a shallow camber and rain channels at the ends.
    place(0, hh - 0.05, 0, 0, -Math.PI * 0.5);
    corrugated(g, len - 0.24, W - 0.2, t0, 0.42, 0.022, 0.025);
    popX();
    chamferBox(g, 0, -hh + 0.06, 0, hw - 0.02, 0.06, hl - 0.02, T.steelDark, 0.012);

    // Top and bottom side rails, and the corner posts: the structural frame.
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(g, s * (hw - 0.055), hh - 0.07, 0, 0.06, 0.07, hl - 0.14, T.steelDark, 0.012);
      chamferBox(g, s * (hw - 0.055), -hh + 0.09, 0, 0.06, 0.09, hl - 0.14, T.steelDark, 0.012);
      for (let e = -1; e <= 1; e += 2) {
        chamferBox(g, s * (hw - 0.06), 0, e * (hl - 0.07), 0.07, hh - 0.14, 0.075, T.steelDark, 0.012);
      }
    }
    // Corner castings — chamfered blocks with the characteristic slotted face.
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          chamferBox(g, sx * (hw - 0.09), sy * (hh - 0.085), sz * (hl - 0.09), 0.09, 0.085, 0.09, T.steelDark, 0.022);
        }
      }
    }

    // Door end: two leaves, four locking bars with cam keepers, hinges and a lock box.
    const dz = hl - 0.02;
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(g, s * (hw * 0.5 - 0.03), 0, dz - 0.045, hw * 0.5 - 0.07, hh - 0.15, 0.045, grey(0.94), 0.012);
      for (let b = 0; b < 2; b++) {
        const bx = s * (hw * 0.5 - 0.03) + (b === 0 ? -0.42 : 0.42) * (hw * 0.5 - 0.07) * 1.5;
        place(bx, 0, dz + 0.02);
        tube(g, 0.019, 0.019, H - 0.34, 8, T.steelDark, false, false, 0.004);
        popX();
        // Cam keepers top and bottom, and the handle.
        chamferBox(g, bx, hh - 0.24, dz + 0.035, 0.045, 0.05, 0.035, T.steelDark, 0.008);
        chamferBox(g, bx, -hh + 0.24, dz + 0.035, 0.045, 0.05, 0.035, T.steelDark, 0.008);
        chamferBox(g, bx + s * 0.09, 0.1, dz + 0.045, 0.09, 0.028, 0.028, T.steelDark, 0.007);
      }
      // Hinges on the outer stile.
      for (let k = -1; k <= 1; k++) {
        place(s * (hw - 0.075), k * (hh - 0.45), dz + 0.02, 0, Math.PI * 0.5);
        tube(g, 0.035, 0.035, 0.16, 8, T.steelDark, true, true, 0.006);
        popX();
      }
    }
    // Lock box and the small placard plate.
    chamferBox(g, 0, -0.1, dz + 0.05, 0.075, 0.11, 0.05, T.steelDark, 0.01);
    chamferBox(g, hw * 0.42, hh - 0.62, dz + 0.045, 0.16, 0.11, 0.006, grey(0.86), 0.004);

    // Fork pockets on the underside of a 20 ft box read as a nice shadow catcher.
    if (len < 8) {
      for (let s = -1; s <= 1; s += 2) {
        chamferBox(g, 0, -hh + 0.2, s * 0.9, hw - 0.16, 0.09, 0.16, T.steelDark, 0.01);
      }
    }
  }

  /* --- jersey barrier ----------------------------------------------------- */

  function jerseyGeo(g) {
    const L = 2.4;
    const hl = L * 0.5;
    // The classic profile, approximated with three stacked chamfered slabs; the two lower
    // ones are splayed, which is what makes it read as a barrier and not a wall stub.
    chamferBox(g, 0, 0.09, 0, 0.31, 0.09, hl, T.concreteWorn, 0.02);
    chamferBox(g, 0, 0.28, 0, 0.245, 0.11, hl - 0.005, T.concreteWorn, 0.03);
    chamferBox(g, 0, 0.52, 0, 0.155, 0.14, hl - 0.01, T.concrete, 0.03);
    chamferBox(g, 0, 0.76, 0, 0.09, 0.11, hl - 0.015, T.concrete, 0.025);
    // Lifting slots and the end connector pockets.
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(g, 0, 0.86, s * 0.42, 0.055, 0.035, 0.09, T.concreteDark, 0.008);
      chamferBox(g, 0, 0.45, s * hl, 0.05, 0.3, 0.02, T.concreteDark, 0.008);
    }
    // Hazard band, painted on as vertex colour — the palette's one saturated hit down low.
    chamferBox(g, 0, 0.63, hl - 0.02, 0.115, 0.1, 0.012, T.hazard, 0.006);
    chamferBox(g, 0, 0.63, -hl + 0.02, 0.115, 0.1, 0.012, T.hazard, 0.006);
  }

  /* --- oil drum ----------------------------------------------------------- */

  function drumGeo(g) {
    const r = 0.293;
    const h = 0.88;
    place(0, h * 0.5, 0);
    tube(g, r, r, h, 16, T.white, false, false, 0.012);
    popX();
    // Rolling hoops.
    for (let k = 0; k < 2; k++) {
      place(0, 0.28 + k * 0.32, 0);
      tube(g, r + 0.018, r + 0.018, 0.055, 16, T.steelDark, false, false, 0.008);
      popX();
    }
    // Chimes and lids.
    place(0, h - 0.022, 0);
    tube(g, r + 0.012, r + 0.012, 0.045, 16, T.steelDark, true, false, 0.008);
    popX();
    place(0, 0.022, 0);
    tube(g, r + 0.012, r + 0.012, 0.045, 16, T.steelDark, false, true, 0.008);
    popX();
    // Bung and its recess.
    place(0.16, h + 0.006, 0.05);
    tube(g, 0.035, 0.035, 0.02, 8, T.steelDark, true, false, 0.004);
    popX();
  }

  /* --- pallet ------------------------------------------------------------- */

  function palletGeo(g) {
    const W = 1.2;
    const D = 0.8;
    const t0 = T.wood;
    // Bottom boards.
    for (let k = -1; k <= 1; k++) plainBox(g, 0, 0.011, k * (D * 0.5 - 0.05), W * 0.5, 0.011, 0.05, t0);
    // Blocks.
    for (let i = -1; i <= 1; i++) {
      for (let k = -1; k <= 1; k++) {
        plainBox(g, i * (W * 0.5 - 0.05), 0.06, k * (D * 0.5 - 0.05), 0.05, 0.038, 0.05, T.woodDark);
      }
    }
    // Bearers and deck boards.
    for (let k = -1; k <= 1; k++) plainBox(g, 0, 0.109, k * (D * 0.5 - 0.05), W * 0.5, 0.011, 0.05, t0);
    for (let i = 0; i < 5; i++) {
      const z = -D * 0.5 + 0.06 + (i / 4) * (D - 0.12);
      plainBox(g, 0, 0.129, z, W * 0.5, 0.009, 0.048, t0);
    }
  }

  /* --- sandbag ------------------------------------------------------------ */

  /** One sack: a squashed, slightly irregular pillow. Each emplacement stacks these by hand. */
  function sandbagGeo(g) {
    const seg = 7;
    const ring = 4;
    const rx = 0.24;
    const ry = 0.085;
    const rz = 0.145;
    for (let i = 0; i < ring; i++) {
      const v0 = (i / ring) * Math.PI - Math.PI * 0.5;
      const v1 = ((i + 1) / ring) * Math.PI - Math.PI * 0.5;
      for (let j = 0; j < seg; j++) {
        const u0 = (j / seg) * Math.PI * 2;
        const u1 = ((j + 1) / seg) * Math.PI * 2;
        const pt = (u, v) => {
          const cv = Math.cos(v);
          // Slight taper at the ends and a sag on top: a filled sack is not an ellipsoid.
          const bulge = 1 - 0.22 * Math.abs(Math.sin(v));
          const x = Math.sin(u) * cv * rx * bulge;
          const y = Math.sin(v) * ry * (1 + 0.25 * Math.cos(u * 2));
          const z = Math.cos(u) * cv * rz * bulge;
          return [x, y, z, x / rx, y / ry, z / rz];
        };
        const A = pt(u0, v0);
        const B = pt(u1, v0);
        const C = pt(u1, v1);
        const D = pt(u0, v1);
        const nrm = (q) => {
          const l = Math.hypot(q[3], q[4], q[5]) || 1;
          return [q[3] / l, q[4] / l, q[5] / l];
        };
        gquadN(
          g,
          A[0], A[1], A[2], nrm(A),
          B[0], B[1], B[2], nrm(B),
          C[0], C[1], C[2], nrm(C),
          D[0], D[1], D[2], nrm(D),
          u0 * 0.12, u1 * 0.12, v0 * 0.12, v1 * 0.12, T.white
        );
      }
    }
    // The stitched seam across the top, which is what sells the scale.
    plainBox(g, 0, ry * 0.82, 0, rx * 0.72, 0.006, 0.012, grey(0.8));
  }

  /**
   * Lay a sandbag emplacement along a polyline. Bags are placed individually with header and
   * stretcher courses alternating, plus per-bag jitter, exactly as they would be filled and
   * stacked on site.
   */
  function sandbagWall(set, pts, courses, seedN) {
    const r2 = mulberry32(seedN);
    for (let s = 0; s < pts.length - 1; s++) {
      const ax = pts[s][0];
      const az = pts[s][1];
      const bx = pts[s + 1][0];
      const bz = pts[s + 1][1];
      const len = Math.hypot(bx - ax, bz - az);
      const dirY = runYaw(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 0.42));
      for (let c = 0; c < courses; c++) {
        const inset = c * 0.035;
        const y = 0.075 + c * 0.155;
        const off = (c % 2) * 0.21;
        for (let i = 0; i < n; i++) {
          const tt = (i * 0.42 + off) / len;
          if (tt > 1.001) continue;
          const x = ax + (bx - ax) * tt;
          const z = az + (bz - az) * tt;
          const jx = (r2() - 0.5) * 0.05;
          const jz = (r2() - 0.5) * 0.05;
          const tone = 0.86 + r2() * 0.28;
          addInstance(
            set,
            x + jx + Math.sin(dirY) * inset * 0,
            y,
            z + jz,
            dirY + (r2() - 0.5) * 0.22,
            (r2() - 0.5) * 0.08,
            (r2() - 0.5) * 0.1,
            0.94 + r2() * 0.14,
            [T.sandbag[0] * tone, T.sandbag[1] * tone, T.sandbag[2] * tone]
          );
        }
      }
      // One simplified collider per run per two courses — the player must not catch on bags.
      const midX = (ax + bx) * 0.5;
      const midZ = (az + bz) * 0.5;
      solidBox(midX, courses * 0.155 * 0.5, midZ, len * 0.5 + 0.15, courses * 0.155 * 0.5, 0.28, 'sandbag', dirY, {
        cover: true,
        walkTop: false,
      });
    }
  }

  /* --- rubble ------------------------------------------------------------- */

  function slabGeo(g) {
    chamferBox(g, 0, 0, 0, 0.42, 0.075, 0.31, T.white, 0.02);
    // A stub of exposed rebar, bent — the tell that this was reinforced concrete.
    place(0.36, 0.02, 0.1, 0.4, 0.5);
    tube(g, 0.011, 0.011, 0.42, 6, T.rustDeep, false, false, 0.003);
    popX();
  }

  function brickGeo(g) {
    // Twelve triangles: at rubble scale the chamfer would be sub-pixel.
    plainBox(g, 0, 0, 0, 0.113, 0.033, 0.053, T.white);
  }

  /**
   * Scatter a rubble pile: a cone of broken slabs and brick with a plausible size grading
   * (big pieces at the base, fines on top), plus rebar tangles.
   */
  function rubblePile(slabSet, brickSet, cx, cz, radius, height, seedN, tintBase) {
    const r2 = mulberry32(seedN);
    const nSlab = Math.round(radius * radius * (lod > 0 ? 3.2 : 1.8));
    for (let i = 0; i < nSlab; i++) {
      const a = r2() * Math.PI * 2;
      const rr = Math.sqrt(r2()) * radius;
      const f = 1 - rr / radius;
      const y = f * f * height * (0.35 + r2() * 0.6);
      const s = lerp(1.25, 0.55, rr / radius) * (0.7 + r2() * 0.7);
      const tone = 0.72 + r2() * 0.45;
      addInstance(
        slabSet,
        cx + Math.cos(a) * rr,
        y + 0.05,
        cz + Math.sin(a) * rr,
        r2() * Math.PI * 2,
        (r2() - 0.5) * 0.9,
        (r2() - 0.5) * 0.9,
        s,
        [tintBase[0] * tone, tintBase[1] * tone, tintBase[2] * tone]
      );
    }
    const nBrick = Math.round(radius * radius * (lod > 0 ? 6 : 3));
    for (let i = 0; i < nBrick; i++) {
      const a = r2() * Math.PI * 2;
      const rr = Math.sqrt(r2()) * radius * 1.15;
      const f = clamp(1 - rr / radius, 0, 1);
      const y = f * f * height * (0.3 + r2() * 0.7);
      const tone = 0.7 + r2() * 0.5;
      addInstance(
        brickSet,
        cx + Math.cos(a) * rr,
        y + 0.035,
        cz + Math.sin(a) * rr,
        r2() * Math.PI * 2,
        (r2() - 0.5) * 1.2,
        (r2() - 0.5) * 1.2,
        0.8 + r2() * 0.5,
        [T.brick[0] * tone, T.brick[1] * tone, T.brick[2] * tone]
      );
    }
  }

  /* --- chain-link fence ---------------------------------------------------- */

  /**
   * Real diamond mesh, not an alpha card: two sets of crossed strands, so the low sun throws
   * a genuine woven shadow through it and it silhouettes correctly against the sky. Built
   * once per panel size and merged with its posts.
   */
  function fencePanel(g, w, h, tintArr) {
    const pitch = lod > 1 ? 0.19 : lod > 0 ? 0.24 : 0.34;
    const wire = 0.016;
    // A strand is a pair of crossed ribbons, four triangles, not a chamfered box. At 16 mm
    // the bevel is invisible and the box costs eleven times as much; with seventy bays of
    // fence around the perimeter that difference is a fifth of the map's triangle budget.
    const strandRibbon = (ax, ay, bx, by, zoff) => {
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.06) return;
      const ang = Math.atan2(by - ay, bx - ax);
      place((ax + bx) * 0.5, (ay + by) * 0.5, zoff, 0, 0, ang);
      _bp.length = 0;
      _bp.push(-len * 0.5, -wire * 0.5, 0, len * 0.5, -wire * 0.5, 0, len * 0.5, wire * 0.5, 0, -len * 0.5, wire * 0.5, 0);
      gpoly(g, _bp, 0, 0, 1, tintArr);
      _bp.length = 0;
      _bp.push(-len * 0.5, 0, -wire * 0.5, len * 0.5, 0, -wire * 0.5, len * 0.5, 0, wire * 0.5, -len * 0.5, 0, wire * 0.5);
      gpoly(g, _bp, 0, 1, 0, tintArr);
      popX();
    };
    const strands = (sign) => {
      const span = w + h;
      const n = Math.ceil(span / pitch);
      for (let i = 0; i <= n; i++) {
        const c = -w * 0.5 - h + i * pitch;
        // Clip the 45 degree strand to the panel rectangle.
        let x0 = c;
        let y0 = -h * 0.5;
        let x1 = c + h * sign * (sign > 0 ? 1 : -1) * 0 + (sign > 0 ? h : -h);
        let y1 = h * 0.5;
        if (sign < 0) {
          x0 = c + h;
          x1 = c;
        }
        const cl = (xa, ya, xb, yb) => {
          const dx = xb - xa;
          let t0 = 0;
          let t1 = 1;
          if (Math.abs(dx) > 1e-6) {
            const ta = (-w * 0.5 - xa) / dx;
            const tb = (w * 0.5 - xa) / dx;
            t0 = Math.max(0, Math.min(ta, tb));
            t1 = Math.min(1, Math.max(ta, tb));
          } else if (xa < -w * 0.5 || xa > w * 0.5) {
            return null;
          }
          if (t1 <= t0 + 1e-4) return null;
          return [xa + dx * t0, ya + (yb - ya) * t0, xa + dx * t1, ya + (yb - ya) * t1];
        };
        const seg = cl(x0, y0, x1, y1);
        if (!seg) continue;
        strandRibbon(seg[0], seg[1], seg[2], seg[3], sign * 0.009);
      }
    };
    strands(1);
    strands(-1);
  }

  /**
   * Fence run between two world points: line posts, a top rail, the mesh, a bottom tension
   * wire and three strands of barbed wire on canted arms.
   */
  function fenceRun(x0, z0, x1, z1, h, seedN, barbed = true) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = runYaw(x1 - x0, z1 - z0);
    const bays = Math.max(1, Math.round(len / 3.0));
    const bay = len / bays;
    const r2 = mulberry32(seedN);
    for (let i = 0; i <= bays; i++) {
      const tt = i / bays;
      const px = x0 + (x1 - x0) * tt;
      const pz = z0 + (z1 - z0) * tt;
      place(px, 0, pz, yaw);
      const gm = G('metalRust');
      // Posts lean a degree or two off plumb; a perfectly straight fence reads as CAD.
      const leanX = (r2() - 0.5) * 0.06;
      place(0, (h + 0.16) * 0.5, 0, 0, 0, leanX);
      tube(gm, 0.036, 0.042, h + 0.16, 8, T.steelDark, true, false, 0.008);
      popX();
      if (barbed) {
        // Canted extension arm carrying three barb strands.
        place(0, h + 0.12, 0, 0, 0, -0.55);
        tube(gm, 0.02, 0.02, 0.44, 6, T.steelDark, true, false, 0.005);
        popX();
      }
      popX();
    }
    for (let i = 0; i < bays; i++) {
      const tt = (i + 0.5) / bays;
      const px = x0 + (x1 - x0) * tt;
      const pz = z0 + (z1 - z0) * tt;
      place(px, h * 0.5, pz, yaw);
      const gm = G('metalRust');
      const damaged = r2() < 0.14;
      if (!damaged) fencePanel(gm, bay - 0.09, h - 0.12, grey(0.78));
      // Top rail and bottom tension wire.
      place(0, h * 0.5 - 0.03, 0, 0, 0, Math.PI * 0.5);
      tube(gm, 0.022, 0.022, bay, 6, T.steelDark, false, false, 0.004);
      popX();
      place(0, -h * 0.5 + 0.06, 0, 0, 0, Math.PI * 0.5);
      tube(gm, 0.009, 0.009, bay, 5, T.steelDark, false, false, 0.002);
      popX();
      if (barbed) {
        for (let k = 0; k < 3; k++) {
          // Strands step outward as they climb, following the cant of the extension arms.
          place(0, h * 0.5 + 0.12 + k * 0.11, 0.1 + k * 0.1, 0, 0, Math.PI * 0.5);
          tube(gm, 0.007, 0.007, bay, 4, T.steelDark, false, false, 0.002);
          popX();
        }
      }
      popX();
    }
    // Collision: one thin slab for the whole run. Fences stop you; they must not snag you.
    const mx = (x0 + x1) * 0.5;
    const mz = (z0 + z1) * 0.5;
    solidBox(mx, (h + 0.2) * 0.5, mz, len * 0.5, (h + 0.2) * 0.5, 0.07, 'metal', yaw, { noNav: false });
  }

  /* --- rail track --------------------------------------------------------- */

  const sleeperSet = inst('sleeper', 'woodPlank', (g) => {
    // Sleeper plus its two cast chairs and four coach screws: one instance, four props.
    chamferBox(g, 0, 0, 0, 1.3, 0.075, 0.125, T.sleeper, 0.014);
    for (let s = -1; s <= 1; s += 2) {
      plainBox(g, s * 0.7175, 0.09, 0, 0.16, 0.018, 0.11, T.rust);
      plainBox(g, s * 0.7175, 0.108, 0, 0.075, 0.012, 0.085, T.steelDark);
    }
  });

  /**
   * A straight run of track along +X: ballast shoulder, sleepers, both rails in a proper
   * three-part section, fishplates at the joints, and weeds coming through the cess.
   */
  function railRun(x0, x1, z, seedN, opts) {
    const o = opts || {};
    const len = x1 - x0;
    const cxm = (x0 + x1) * 0.5;
    const r2 = mulberry32(seedN);
    const gauge = 1.435;
    // Track laid straight onto a shed floor sits lower than track on ballast.
    const yOff = o.y || 0;
    const gap = o.skipX || null;

    // Ballast: a shallow trapezoid, triplanar so the stones never tile.
    if (o.ballast !== false) {
      const gb = GT('gravel', 0.55);
      place(cxm, yOff, z);
      const bh = 0.22;
      const hw0 = 2.3;
      const hw1 = 1.55;
      const p = _bp;
      p.length = 0;
      p.push(-len * 0.5, bh, -hw1, len * 0.5, bh, -hw1, len * 0.5, bh, hw1, -len * 0.5, bh, hw1);
      gpoly(gb, p, 0, 1, 0, T.gravel);
      for (let s = -1; s <= 1; s += 2) {
        p.length = 0;
        p.push(-len * 0.5, bh, s * hw1, len * 0.5, bh, s * hw1, len * 0.5, 0, s * hw0, -len * 0.5, 0, s * hw0);
        gpoly(gb, p, 0, 0.75, s * 0.66, T.gravel);
      }
      popX();
      solidBox(cxm, yOff + 0.11, z, len * 0.5, 0.11, hw0, 'gravel', 0, { walkTop: true });
    }

    // Sleepers.
    const spacing = 0.66;
    const n = Math.floor(len / spacing);
    const step = lod > 0 ? 1 : 2;
    for (let i = 0; i < n; i += step) {
      const x = x0 + 0.4 + i * spacing;
      if (gap && x > gap[0] - 0.7 && x < gap[1] + 0.7) continue;
      const tone = 0.74 + r2() * 0.5;
      addInstance(
        sleeperSet,
        x,
        yOff + 0.29 - r2() * 0.03,
        z + (r2() - 0.5) * 0.05,
        (r2() - 0.5) * 0.035,
        0,
        (r2() - 0.5) * 0.05,
        1,
        [T.sleeper[0] * tone, T.sleeper[1] * tone, T.sleeper[2] * tone],
        1,
        1
      );
    }

    // Rails: foot, web and head, so the section reads correctly in silhouette.
    const gr = G('metalRust');
    for (let s = -1; s <= 1; s += 2) {
      const rz = z + (s * gauge) / 2;
      place(cxm, yOff, rz);
      chamferBox(gr, 0, 0.377, 0, len * 0.5, 0.012, 0.068, T.rustDeep, 0.006);
      chamferBox(gr, 0, 0.43, 0, len * 0.5, 0.045, 0.0125, T.rustDeep, 0.005);
      chamferBox(gr, 0, 0.4885, 0, len * 0.5, 0.0165, 0.0345, T.rustDeep, 0.006);
      // The running band on the head is polished by traffic: painted brighter, not rusted.
      chamferBox(gr, 0, 0.5055, 0, len * 0.5, 0.002, 0.026, grey(1.35), 0.002);
      popX();
      // Fishplates every 18 m.
      for (let x = x0 + 9; x < x1; x += 18) {
        place(x, yOff + 0.43, rz);
        chamferBox(gr, 0, 0, 0.026, 0.24, 0.05, 0.011, T.rust, 0.005);
        chamferBox(gr, 0, 0, -0.026, 0.24, 0.05, 0.011, T.rust, 0.005);
        for (let b = -1; b <= 1; b += 2) {
          place(b * 0.13, 0, 0, 0, Math.PI * 0.5);
          tube(gr, 0.013, 0.013, 0.086, 6, T.steelDark, true, true, 0.003);
          popX();
        }
        popX();
      }
    }
    return { x0, x1, z, gauge };
  }

  /* --- lattice steelwork --------------------------------------------------- */

  /**
   * A square lattice tower along +Y: four corner chords, horizontal ties and alternating
   * K-bracing. This is what makes the crane read as engineering rather than as a box.
   */
  function latticeTower(g, h, w, bays, chord, brace, tintArr) {
    const hw = w * 0.5;
    const bh = h / bays;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        chamferBox(g, sx * hw, h * 0.5, sz * hw, chord, h * 0.5, chord, tintArr, 0.01);
      }
    }
    for (let b = 0; b <= bays; b++) {
      const y = b * bh;
      for (let s = -1; s <= 1; s += 2) {
        strutThin(g, -hw, y, s * hw, hw, y, s * hw, brace, tintArr);
        strutThin(g, s * hw, y, -hw, s * hw, y, hw, brace, tintArr);
      }
    }
    for (let b = 0; b < bays; b++) {
      const y0 = b * bh;
      const y1 = (b + 1) * bh;
      const flip = b % 2 === 0;
      for (let s = -1; s <= 1; s += 2) {
        strutThin(g, flip ? -hw : hw, y0, s * hw, flip ? hw : -hw, y1, s * hw, brace, tintArr);
        strutThin(g, s * hw, y0, flip ? -hw : hw, s * hw, y1, flip ? hw : -hw, brace, tintArr);
      }
    }
  }

  /** A lattice box girder along +Z: four chords, verticals and Warren diagonals. */
  function latticeGirder(g, len, depth, width, bays, chord, brace, tintArr) {
    const hd = depth * 0.5;
    const hwd = width * 0.5;
    const hl = len * 0.5;
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sx = -1; sx <= 1; sx += 2) {
        chamferBox(g, sx * hwd, sy * hd, 0, chord, chord, hl, tintArr, 0.01);
      }
    }
    const bl = len / bays;
    for (let b = 0; b <= bays; b++) {
      const z = -hl + b * bl;
      for (let s = -1; s <= 1; s += 2) {
        strutThin(g, s * hwd, -hd, z, s * hwd, hd, z, brace, tintArr);
        strutThin(g, -hwd, s * hd, z, hwd, s * hd, z, brace, tintArr);
      }
    }
    for (let b = 0; b < bays; b++) {
      const z0 = -hl + b * bl;
      const z1 = z0 + bl;
      const flip = b % 2 === 0;
      for (let s = -1; s <= 1; s += 2) {
        strutThin(g, s * hwd, flip ? -hd : hd, z0, s * hwd, flip ? hd : -hd, z1, brace, tintArr);
        strutThin(g, flip ? -hwd : hwd, s * hd, z0, flip ? hwd : -hwd, s * hd, z1, brace, tintArr);
      }
    }
  }

  /** Handrail with a top rail, a knee rail and a toe board — every walkway in the map has one. */
  function handrail(g, len, tintArr, side = 1, posts = 0) {
    const hl = len * 0.5;
    const n = posts || Math.max(2, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) {
      const z = -hl + (i / n) * len;
      place(0, 0.55, z);
      tube(g, 0.021, 0.024, 1.1, 6, tintArr, true, false, 0.005);
      popX();
    }
    place(0, 1.09, 0, 0, 0, Math.PI * 0.5);
    tube(g, 0.024, 0.024, len, 6, tintArr, false, false, 0.005);
    popX();
    place(0, 0.56, 0, 0, 0, Math.PI * 0.5);
    tube(g, 0.018, 0.018, len, 6, tintArr, false, false, 0.004);
    popX();
    chamferBox(g, side * 0.02, 0.06, 0, 0.008, 0.06, hl, tintArr, 0.004);
  }

  /* --- the gantry crane ---------------------------------------------------- */

  /**
   * 22 m goliath crane straddling the yard. Two lattice A-legs on travelling bogies, a lattice
   * box girder spanning 28 m, a trolley with a machinery house, and a five-fall hook block on
   * visible rope. This and the water tower are the map's only true landmarks — everything
   * else in the silhouette is subordinate to them.
   */
  function buildCrane() {
    const gm = G('metalPainted');
    const gr = G('metalRust');
    const span = CRANE.zB - CRANE.zA;
    const legH = CRANE.top - 2.0;
    const paint = T.steelPainted;

    for (let e = 0; e < 2; e++) {
      const z = e === 0 ? CRANE.zA : CRANE.zB;
      place(CRANE.x, 0, z);
      // Concrete pad + crane rail beam.
      const gc = G('concreteRough');
      chamferBox(gc, 0, 0.18, 0, 3.4, 0.18, 2.2, T.concreteWorn, 0.03);
      solidBox(CRANE.x, 0.18, z, 3.4, 0.18, 2.2, 'concrete', 0, { walkTop: true });
      // Bogies.
      for (let s = -1; s <= 1; s += 2) {
        chamferBox(gr, s * 1.9, 0.62, 0, 0.7, 0.26, 0.42, T.rust, 0.02);
        for (let w = -1; w <= 1; w += 2) {
          place(s * 1.9 + w * 0.42, 0.44, 0, 0, 0, Math.PI * 0.5);
          tube(gr, 0.28, 0.28, 0.13, 12, T.rustDeep, true, true, 0.012);
          popX();
        }
        // Equalising beam up to the leg.
        strut(gm, s * 1.9, 0.9, 0, s * 0.55, 2.0, 0, 0.09, paint);
      }
      chamferBox(gm, 0, 2.05, 0, 1.5, 0.22, 0.75, paint, 0.02);
      // Hazard chevron band at knee height — the one saturated hit on the structure.
      chamferBox(gm, 0, 1.2, 0.78, 1.1, 0.5, 0.02, T.hazard, 0.01);
      chamferBox(gm, 0, 1.2, -0.78, 1.1, 0.5, 0.02, T.hazard, 0.01);

      // The leg itself: a lattice tower, tapering by way of a splayed base.
      place(0, 2.25, 0);
      latticeTower(gm, legH, 1.5, Math.round(legH / 2.3), 0.075, 0.045, paint);
      popX();
      // Splayed feet.
      for (let sx = -1; sx <= 1; sx += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          strut(gm, sx * 0.75, 2.25, sz * 0.75, sx * 1.35, 2.27, sz * 0.62, 0.06, paint);
        }
      }
      popX();

      solidBox(CRANE.x, 1.4, z, 1.85, 1.4, 1.0, 'metal', 0, { cover: true });
      solidBox(CRANE.x, (2.25 + legH) * 0.5, z, 0.85, (legH - 2.25) * 0.5 + 1.1, 0.85, 'metal', 0, { noNav: false });
    }

    // Crane runway rails, on their own longitudinal beams.
    for (let e = 0; e < 2; e++) {
      const z = e === 0 ? CRANE.zA : CRANE.zB;
      const gc2 = G('concreteRough');
      place(0, 0, z);
      chamferBox(gc2, 0, 0.12, 0, 34, 0.12, 0.55, T.concreteWorn, 0.02);
      popX();
      place(0, 0, z);
      chamferBox(gr, 0, 0.29, 0, 34, 0.055, 0.075, T.rustDeep, 0.008);
      popX();
      solidBox(0, 0.16, z, 34, 0.16, 0.55, 'concrete', 0, { walkTop: true });
    }

    // The main girder.
    place(CRANE.x, CRANE.top, (CRANE.zA + CRANE.zB) * 0.5);
    latticeGirder(gm, span + 3.6, 2.3, 2.6, Math.round(span / 2.4), 0.1, 0.052, paint);
    // Trolley rails on the top chords.
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gm, s * 1.3, 1.22, 0, 0.05, 0.05, (span + 3.6) * 0.5, T.rust, 0.008);
    }
    // Maintenance walkway with a full handrail down one side, and a festooned cable run.
    chamferBox(gm, 1.95, -1.0, 0, 0.55, 0.03, (span + 3.4) * 0.5, T.steelDark, 0.008);
    place(2.5, -0.97, 0);
    handrail(gm, span + 3.2, paint, -1);
    popX();
    for (let i = 0; i < 14; i++) {
      const z = -span * 0.5 + (i / 13) * span;
      const sag = Math.sin((i / 13) * Math.PI) * 0.35;
      strut(gr, -1.7, -0.35 - sag, z, -1.7, -0.35 - sag * 0.6, z + span / 13, 0.012, T.steelDark);
    }
    popX();

    // Trolley + machinery house + hook block, parked two-thirds along the span.
    const trolleyZ = CRANE.zA + span * 0.62;
    place(CRANE.x, CRANE.top + 1.34, trolleyZ);
    chamferBox(gm, 0, 0.2, 0, 1.45, 0.2, 1.5, T.steelPainted, 0.02);
    for (let s = -1; s <= 1; s += 2) {
      for (let e = -1; e <= 1; e += 2) {
        place(s * 1.3, -0.1, e * 1.1, 0, 0, Math.PI * 0.5);
        tube(gm, 0.17, 0.17, 0.1, 10, T.rustDeep, true, true, 0.008);
        popX();
      }
    }
    // Machinery house: a clad box with louvres and a pitched cover.
    place(0, 0.95, 0.1);
    const gcs = G('corrugatedSteel');
    chamferBox(gcs, 0, 0, 0, 1.1, 0.72, 1.15, T.steelPainted, 0.02);
    for (let i = 0; i < 4; i++) {
      chamferBox(gcs, 1.11, 0.34 - i * 0.17, 0, 0.012, 0.055, 0.85, T.steelDark, 0.005);
    }
    chamferBox(gm, 0, 0.78, 0, 1.2, 0.05, 1.25, T.steelDark, 0.015);
    popX();
    // Rope drum.
    place(0, 0.5, -1.0, 0, 0, Math.PI * 0.5);
    tube(gm, 0.3, 0.3, 1.5, 12, T.rust, true, true, 0.01);
    popX();
    popX();

    // Hook block on four falls of rope, hanging into the yard.
    const hookY = 6.4;
    const gh = G('metalRust');
    for (let s = -1; s <= 1; s += 2) {
      for (let e = -1; e <= 1; e += 2) {
        strut(gh, CRANE.x + s * 0.16, CRANE.top + 1.34, trolleyZ + e * 0.16, CRANE.x + s * 0.16, hookY + 0.9, trolleyZ + e * 0.14, 0.014, T.steelDark, 0.004);
      }
    }
    place(CRANE.x, hookY, trolleyZ);
    chamferBox(gh, 0, 0.55, 0, 0.42, 0.36, 0.2, T.rust, 0.02);
    for (let s = -1; s <= 1; s += 2) {
      place(s * 0.2, 0.55, 0, 0, 0, Math.PI * 0.5);
      tube(gh, 0.26, 0.26, 0.1, 12, T.rustDeep, true, true, 0.01);
      popX();
    }
    chamferBox(gh, 0, 0.08, 0, 0.09, 0.14, 0.09, T.rust, 0.012);
    // The hook: a swept sequence of tapering boxes.
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * 2.5;
      place(Math.sin(a) * 0.3, -0.1 - Math.cos(a) * 0.3 + 0.3, 0, 0, 0, -a);
      chamferBox(gh, 0, 0, 0, 0.06 - i * 0.005, 0.09, 0.055, T.rust, 0.012);
      popX();
    }
    popX();
    return { trolleyZ, hookY };
  }

  /* --- the water tower ----------------------------------------------------- */

  /**
   * 18 m riveted tank on four splayed, cross-braced legs, with a caged ladder, a catwalk and
   * a downpipe. Reads from every corner of the map and, from the yard, sits directly in front
   * of the setting sun.
   */
  function buildTower() {
    const gm = G('metalRust');
    const gp = G('metalPainted');
    const gc = G('concreteRough');
    const H = TOWER.h;
    const tankH = 5.6;
    const tankR = 3.5;
    const legTop = H - tankH - 0.6;
    const spreadTop = 2.4;
    const spreadBot = 4.2;

    place(TOWER.x, 0, TOWER.z);
    // Footings.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const bx = Math.cos(a) * spreadBot;
      const bz = Math.sin(a) * spreadBot;
      chamferBox(gc, bx, 0.3, bz, 0.6, 0.3, 0.6, T.concreteWorn, 0.025);
      const tx = Math.cos(a) * spreadTop;
      const tz = Math.sin(a) * spreadTop;
      strut(gm, bx, 0.5, bz, tx, legTop, tz, 0.11, T.rust, 0.012);
      solidBox(TOWER.x + (bx + tx) * 0.5, legTop * 0.5, TOWER.z + (bz + tz) * 0.5, 0.34, legTop * 0.5, 0.34, 'metal', 0, { cover: true });
    }
    // Three levels of cross bracing between adjacent legs.
    for (let lvl = 1; lvl <= 3; lvl++) {
      const f0 = (lvl - 1) / 3;
      const f1 = lvl / 3;
      const y0 = 0.5 + f0 * (legTop - 0.5);
      const y1 = 0.5 + f1 * (legTop - 0.5);
      const r0 = lerp(spreadBot, spreadTop, f0);
      const r1 = lerp(spreadBot, spreadTop, f1);
      for (let i = 0; i < 4; i++) {
        const a0 = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
        const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI * 0.25;
        strut(gm, Math.cos(a0) * r0, y0, Math.sin(a0) * r0, Math.cos(a1) * r1, y1, Math.sin(a1) * r1, 0.032, T.rust, 0.006);
        strut(gm, Math.cos(a1) * r0, y0, Math.sin(a1) * r0, Math.cos(a0) * r1, y1, Math.sin(a0) * r1, 0.032, T.rust, 0.006);
        strut(gm, Math.cos(a0) * r1, y1, Math.sin(a0) * r1, Math.cos(a1) * r1, y1, Math.sin(a1) * r1, 0.042, T.rust, 0.008);
      }
    }
    // Tank floor beams.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      strut(gm, Math.cos(a) * spreadTop, legTop, Math.sin(a) * spreadTop, Math.cos(a + Math.PI) * spreadTop, legTop, Math.sin(a + Math.PI) * spreadTop, 0.09, T.rust, 0.01);
    }

    // The tank: three riveted strakes with visible hoop seams, painted band on the middle one.
    const tankY = legTop + 0.35 + tankH * 0.5;
    place(0, tankY, 0);
    tube(gm, tankR, tankR, tankH, 24, T.rust, false, true, 0.03);
    for (let k = 0; k < 4; k++) {
      place(0, -tankH * 0.5 + (k / 3) * tankH, 0);
      tube(gm, tankR + 0.035, tankR + 0.035, 0.1, 24, T.rustDeep, false, false, 0.012);
      popX();
    }
    // The faded painted band. Vertex colour, so it needs no texture and no extra draw call.
    place(0, 0.35, 0);
    tube(gp, tankR + 0.01, tankR + 0.01, 1.5, 24, T.steelPainted, false, false, 0.01);
    popX();
    // Vertical strap seams.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      place(Math.cos(a) * (tankR + 0.02), 0, Math.sin(a) * (tankR + 0.02), -a);
      chamferBox(gm, 0, 0, 0, 0.012, tankH * 0.5, 0.055, T.rustDeep, 0.004);
      popX();
    }
    popX();

    // Conical roof, vent and finial.
    place(0, tankY + tankH * 0.5 + 0.55, 0);
    tube(gm, 0.35, tankR + 0.12, 1.1, 24, T.rust, true, false, 0.02);
    popX();
    place(0, tankY + tankH * 0.5 + 1.35, 0);
    tube(gm, 0.22, 0.28, 0.6, 10, T.rustDeep, true, false, 0.01);
    popX();

    // Catwalk around the tank with a handrail, and a caged ladder up one leg.
    const walkY = tankY - tankH * 0.5 - 0.05;
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      const rIn = tankR + 0.06;
      const rOut = tankR + 0.85;
      _bp.length = 0;
      _bp.push(
        Math.cos(a0) * rIn, walkY, Math.sin(a0) * rIn,
        Math.cos(a1) * rIn, walkY, Math.sin(a1) * rIn,
        Math.cos(a1) * rOut, walkY, Math.sin(a1) * rOut,
        Math.cos(a0) * rOut, walkY, Math.sin(a0) * rOut
      );
      gpoly(gm, _bp, 0, 1, 0, T.rustDeep);
      place(Math.cos(a0) * rOut, walkY + 0.53, Math.sin(a0) * rOut);
      tube(gp, 0.02, 0.022, 1.06, 6, T.steelPainted, true, false, 0.004);
      popX();
      strut(gp, Math.cos(a0) * rOut, walkY + 1.05, Math.sin(a0) * rOut, Math.cos(a1) * rOut, walkY + 1.05, Math.sin(a1) * rOut, 0.021, T.steelPainted, 0.004);
      strut(gp, Math.cos(a0) * rOut, walkY + 0.55, Math.sin(a0) * rOut, Math.cos(a1) * rOut, walkY + 0.55, Math.sin(a1) * rOut, 0.016, T.steelPainted, 0.004);
    }
    // Ladder + safety hoops.
    const lad = spreadBot * 0.72;
    for (let s = -1; s <= 1; s += 2) {
      strut(gm, lad, 0.4, s * 0.24, lad - 0.5, walkY, s * 0.24, 0.022, T.rust, 0.005);
    }
    const rungs = Math.floor(walkY / 0.32);
    for (let i = 1; i < rungs; i++) {
      const f = i / rungs;
      const x = lerp(lad, lad - 0.5, f);
      const y = lerp(0.4, walkY, f);
      strut(gm, x, y, -0.24, x, y, 0.24, 0.014, T.rust, 0.003);
      if (i > 6 && i % 2 === 0) {
        for (let k = 0; k < 5; k++) {
          const a0 = -Math.PI * 0.5 + (k / 4) * Math.PI;
          const a1 = -Math.PI * 0.5 + ((k + 1) / 4) * Math.PI;
          strut(gm, x + 0.42 * Math.cos(a0), y, 0.42 * Math.sin(a0), x + 0.42 * Math.cos(a1), y, 0.42 * Math.sin(a1), 0.011, T.rust, 0.003);
        }
      }
    }
    // Downpipe from the tank to the ground.
    place(-spreadTop * 0.8, (walkY + 0.6) * 0.5, spreadTop * 0.8);
    tube(gm, 0.09, 0.09, walkY - 0.6, 10, T.rustDeep, false, false, 0.008);
    popX();
    popX();

    solidBox(TOWER.x, tankY, TOWER.z, tankR + 0.9, tankH * 0.5 + 0.9, tankR + 0.9, 'metal');
  }

  /* --- rolling stock -------------------------------------------------------- */

  /** A two-axle bogie: side frames, springs, axle boxes and wheels on a visible axle. */
  function bogie(g, tintArr) {
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(g, 0, 0.52, s * 0.78, 1.05, 0.11, 0.075, tintArr, 0.012);
      for (let w = -1; w <= 1; w += 2) {
        // Leaf spring and axle box.
        chamferBox(g, w * 0.86, 0.66, s * 0.78, 0.3, 0.045, 0.06, T.steelDark, 0.008);
        chamferBox(g, w * 0.86, 0.53, s * 0.78, 0.14, 0.11, 0.12, T.steelDark, 0.01);
      }
    }
    for (let w = -1; w <= 1; w += 2) {
      place(w * 0.86, 0.46, 0, 0, 0, Math.PI * 0.5);
      tube(g, 0.055, 0.055, 1.62, 8, T.steelDark, false, false, 0.006);
      popX();
      for (let s = -1; s <= 1; s += 2) {
        place(w * 0.86, 0.46, s * 0.7175, 0, 0, Math.PI * 0.5);
        tube(g, 0.46, 0.46, 0.045, 16, T.rustDeep, true, true, 0.012);
        tube(g, 0.5, 0.5, 0.028, 16, T.rustDeep, true, true, 0.008);
        popX();
      }
    }
    chamferBox(g, 0, 0.76, 0, 0.9, 0.08, 0.6, tintArr, 0.012);
  }

  /** Buffers, coupling hook and the screw link that hangs off every wagon end. */
  function wagonEnd(g, hl, tintArr) {
    for (let e = -1; e <= 1; e += 2) {
      chamferBox(g, e * hl, 0.95, 0, 0.06, 0.42, 1.28, tintArr, 0.014);
      for (let s = -1; s <= 1; s += 2) {
        place(e * (hl + 0.2), 0.98, s * 0.85, 0, 0, Math.PI * 0.5);
        tube(g, 0.075, 0.075, 0.4, 8, T.steelDark, false, false, 0.006);
        popX();
        place(e * (hl + 0.4), 0.98, s * 0.85, 0, 0, Math.PI * 0.5);
        tube(g, 0.185, 0.185, 0.05, 12, T.rust, true, false, 0.008);
        popX();
      }
      chamferBox(g, e * (hl + 0.14), 0.86, 0, 0.09, 0.07, 0.06, T.steelDark, 0.01);
      // Screw coupling, hanging slack.
      for (let k = 0; k < 3; k++) {
        place(e * (hl + 0.18 + k * 0.09), 0.78 - k * 0.07, 0, 0, 0, 0.5 + k * 0.2);
        torus(g, 0.06, 0.016, 8, 5, T.steelDark);
        popX();
      }
    }
  }

  /**
   * Wrecked flatbed wagon: steel underframe, planked deck with missing boards, drop-side
   * stanchions (some bent), and both bogies. The map's principal mid-height cover.
   */
  function flatbedWagon(seedN, missing) {
    const r2 = mulberry32(seedN);
    const gm = G('metalRust');
    const gw = G('woodPlank');
    const L = 13.5;
    const hl = L * 0.5;
    const deckY = 1.14;

    // Solebars and headstocks.
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gm, 0, deckY - 0.16, s * 1.36, hl, 0.16, 0.05, T.railGreen, 0.012);
      chamferBox(gm, 0, deckY - 0.3, s * 1.36, hl, 0.05, 0.09, T.railGreen, 0.01);
    }
    for (let i = -5; i <= 5; i++) {
      chamferBox(gm, i * (hl / 5.5), deckY - 0.2, 0, 0.05, 0.1, 1.36, T.rustDeep, 0.008);
    }
    // Deck planks, with a few blown out.
    const planks = 26;
    for (let i = 0; i < planks; i++) {
      if (missing && r2() < 0.14) continue;
      const z = -1.32 + (i / (planks - 1)) * 2.64;
      const tone = 0.7 + r2() * 0.5;
      chamferBox(gw, (r2() - 0.5) * 0.06, deckY - 0.03, z, hl - 0.03, 0.03, 0.048, [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone], 0.007);
    }
    // Stanchions: some upright, some folded, one snapped off.
    for (let i = -3; i <= 3; i++) {
      for (let s = -1; s <= 1; s += 2) {
        const rr = r2();
        if (rr < 0.16) continue;
        const bent = rr < 0.42 ? (r2() - 0.5) * 1.4 : (r2() - 0.5) * 0.12;
        place(i * 2.0, deckY, s * 1.36, 0, 0, bent * s);
        chamferBox(gm, 0, 0.52, 0, 0.05, 0.52, 0.075, T.railGreen, 0.01);
        popX();
      }
    }
    wagonEnd(gm, hl, T.railGreen);
    for (let s = -1; s <= 1; s += 2) {
      place(s * (hl - 2.2), 0, 0);
      bogie(gm, T.rustDeep);
      popX();
    }
    return { L, deckY };
  }

  /** Tank wagon: barrel, saddle cradles, top walkway, dome and a ladder. Great silhouette. */
  function tankWagon(seedN) {
    const gm = G('metalRust');
    const L = 11.0;
    const hl = L * 0.5;
    const R = 1.32;
    const axis = 1.9 + R;
    void seedN;
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gm, 0, 1.02, s * 1.3, hl, 0.14, 0.05, T.rustDeep, 0.012);
    }
    place(0, axis, 0, 0, 0, Math.PI * 0.5);
    tube(gm, R, R, L - 1.2, 20, T.rust, true, true, 0.03);
    popX();
    // Dished ends.
    for (let s = -1; s <= 1; s += 2) {
      place(s * (hl - 0.6), axis, 0, 0, 0, Math.PI * 0.5);
      tube(gm, R * 0.55, R, 0.6, 20, T.rust, true, false, 0.02);
      popX();
    }
    // Saddles.
    for (let s = -1; s <= 1; s += 2) {
      place(s * 3.1, 0, 0);
      chamferBox(gm, 0, 1.55, 0, 0.14, 0.42, 1.25, T.rustDeep, 0.014);
      popX();
    }
    // Top walkway, handrail, filling dome and manway.
    chamferBox(gm, 0, axis + R + 0.03, 0, hl - 1.2, 0.02, 0.4, T.rustDeep, 0.008);
    for (let s = -1; s <= 1; s += 2) {
      for (let i = -4; i <= 4; i++) {
        place(i * 1.1, axis + R + 0.35, s * 0.4);
        tube(gm, 0.016, 0.016, 0.66, 5, T.rustDeep, true, false, 0.003);
        popX();
      }
      place(0, axis + R + 0.67, s * 0.4, 0, 0, Math.PI * 0.5);
      tube(gm, 0.019, 0.019, L - 2.4, 6, T.rustDeep, false, false, 0.004);
      popX();
    }
    place(0, axis + R + 0.16, 0);
    tube(gm, 0.42, 0.46, 0.32, 14, T.rustDeep, true, false, 0.012);
    popX();
    place(0, axis + R + 0.36, 0);
    tube(gm, 0.36, 0.36, 0.08, 14, T.steelDark, true, false, 0.008);
    popX();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      place(Math.cos(a) * 0.4, axis + R + 0.4, Math.sin(a) * 0.4);
      tube(gm, 0.022, 0.022, 0.05, 5, T.steelDark, true, false, 0.003);
      popX();
    }
    // End ladder.
    for (let s = -1; s <= 1; s += 2) {
      strut(gm, hl - 0.55, 1.1, s * 0.24, hl - 0.75, axis + R + 0.1, s * 0.24, 0.018, T.rustDeep, 0.004);
    }
    for (let i = 1; i < 8; i++) {
      const f = i / 8;
      strut(gm, lerp(hl - 0.55, hl - 0.75, f), lerp(1.1, axis + R + 0.1, f), -0.24, lerp(hl - 0.55, hl - 0.75, f), lerp(1.1, axis + R + 0.1, f), 0.24, 0.012, T.rustDeep, 0.003);
    }
    wagonEnd(gm, hl, T.rustDeep);
    for (let s = -1; s <= 1; s += 2) {
      place(s * (hl - 1.9), 0, 0);
      bogie(gm, T.rustDeep);
      popX();
    }
    return { L, R, axis };
  }

  /** Burnt-out box van: sliding doors off their runners, a collapsed roof, charred planking. */
  function boxVan(seedN) {
    const r2 = mulberry32(seedN);
    const gm = G('metalRust');
    const gw = G('woodPlank');
    const L = 10.5;
    const hl = L * 0.5;
    const bodyY = 1.2;
    const H = 2.7;
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gm, 0, bodyY - 0.16, s * 1.36, hl, 0.16, 0.05, T.rustDeep, 0.012);
    }
    chamferBox(gw, 0, bodyY, 0, hl - 0.05, 0.04, 1.32, T.soot, 0.01);
    // Planked sides with a big charred gap.
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 12; i++) {
        const y = bodyY + 0.14 + i * 0.22;
        if (y > bodyY + H - 0.3) continue;
        const burnt = r2() < 0.25 && i > 5;
        if (burnt) continue;
        const tone = i > 6 ? 0.3 + r2() * 0.25 : 0.55 + r2() * 0.4;
        chamferBox(gw, (r2() - 0.5) * 0.1, y, s * 1.32, hl - 0.4 - r2() * 0.6, 0.105, 0.035, [tone, tone * 0.96, tone * 0.92], 0.008);
      }
      // Body pillars and the door runner.
      for (let i = -2; i <= 2; i++) {
        chamferBox(gm, i * 2.0, bodyY + H * 0.5, s * 1.36, 0.06, H * 0.5, 0.05, T.rustDeep, 0.01);
      }
      chamferBox(gm, 0, bodyY + H - 0.05, s * 1.38, hl, 0.05, 0.06, T.rustDeep, 0.01);
      chamferBox(gm, 0, bodyY + 0.06, s * 1.4, hl, 0.05, 0.05, T.rustDeep, 0.01);
    }
    for (let e = -1; e <= 1; e += 2) {
      chamferBox(gm, e * (hl - 0.03), bodyY + H * 0.5, 0, 0.05, H * 0.5, 1.34, T.rustDeep, 0.012);
    }
    // Half-collapsed roof: two sagging sheets and exposed hoops.
    for (let i = -3; i <= 3; i++) {
      const sag = i > 0 ? 0.35 : 0.06;
      strut(gm, i * 1.5, bodyY + H - sag, -1.34, i * 1.5, bodyY + H - sag, 1.34, 0.035, T.rustDeep, 0.006);
    }
    place(-hl * 0.45, bodyY + H - 0.02, 0, 0, 0.06);
    chamferBox(gm, 0, 0, 0, hl * 0.5, 0.025, 1.36, T.sootMid, 0.01);
    popX();
    // One door hanging off its runner.
    place(hl * 0.35, bodyY + H * 0.5 - 0.1, 1.45, 0, 0, -0.18);
    chamferBox(gm, 0, 0, 0, 1.5, H * 0.42, 0.04, T.rustDeep, 0.012);
    popX();
    wagonEnd(gm, hl, T.rustDeep);
    for (let s = -1; s <= 1; s += 2) {
      place(s * (hl - 1.9), 0, 0);
      bogie(gm, T.rustDeep);
      popX();
    }
    return { L, H, bodyY };
  }

  /** Buffer stop at the end of the depot spur — sleeper-built, with a hazard-striped face. */
  function bufferStop(x, z) {
    const gw = G('woodPlank');
    const gm = G('metalRust');
    place(x, 0, z);
    for (let i = 0; i < 5; i++) {
      chamferBox(gw, -0.4, 0.36 + i * 0.16, 0, 1.4, 0.08, 1.05, T.sleeper, 0.012);
    }
    for (let s = -1; s <= 1; s += 2) {
      strut(gw, -1.7, 0.3, s * 0.95, 0.6, 1.1, s * 0.95, 0.1, T.sleeper, 0.012);
    }
    chamferBox(gm, 0.85, 1.0, 0, 0.06, 0.62, 1.05, T.hazard, 0.014);
    for (let s = -1; s <= 1; s += 2) {
      place(0.9, 0.86, s * 0.72, 0, 0, Math.PI * 0.5);
      tube(gm, 0.16, 0.16, 0.12, 10, T.rustDeep, true, true, 0.008);
      popX();
    }
    popX();
    solidBox(x - 0.3, 0.7, z, 1.8, 0.7, 1.15, 'wood', 0, { cover: true });
  }

  /* --- burnt-out car --------------------------------------------------------- */

  /**
   * The yard's hero small prop. Body, greenhouse and arches built from chamfered blocks, no
   * glass left, a collapsed bonnet, seat frames visible through the openings, and four
   * burst tyres. Everything sooted through vertex colour.
   */
  function burntCar(x, z, yaw) {
    const gm = G('metalRust');
    const soot = T.soot;
    const sootHi = T.sootMid;
    place(x, 0, z, yaw);
    // Sills, floor and bulkheads.
    chamferBox(gm, 0, 0.42, 0, 2.05, 0.1, 0.78, soot, 0.02);
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gm, 0, 0.5, s * 0.78, 1.85, 0.16, 0.05, sootHi, 0.02);
    }
    // Lower body sides with wheel arches cut in as separate blocks.
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gm, 0, 0.72, s * 0.8, 0.95, 0.24, 0.045, sootHi, 0.02);
      chamferBox(gm, 1.42, 0.86, s * 0.8, 0.34, 0.36, 0.05, sootHi, 0.02);
      chamferBox(gm, -1.42, 0.86, s * 0.8, 0.34, 0.36, 0.05, sootHi, 0.02);
      // Arch lips.
      for (const ax of [1.05, -1.05]) {
        for (let k = 0; k < 5; k++) {
          const a = (k / 4) * Math.PI;
          place(ax + Math.cos(a) * 0.44, 0.52 + Math.sin(a) * 0.42, s * 0.82, 0, 0, -a);
          chamferBox(gm, 0, 0, 0, 0.12, 0.03, 0.055, soot, 0.01);
          popX();
        }
      }
    }
    // Bonnet, boot and scuttle.
    place(1.45, 0.98, 0, 0, 0, -0.05);
    chamferBox(gm, 0, 0, 0, 0.62, 0.04, 0.76, soot, 0.02);
    popX();
    place(-1.5, 0.99, 0, 0, 0, 0.03);
    chamferBox(gm, 0, 0, 0, 0.55, 0.05, 0.76, soot, 0.02);
    popX();
    // Greenhouse: A, B and C pillars plus the roof, all warped by the fire.
    for (let s = -1; s <= 1; s += 2) {
      place(0.72, 1.28, s * 0.72, 0, 0, -0.5);
      chamferBox(gm, 0, 0, 0, 0.42, 0.04, 0.05, soot, 0.014);
      popX();
      place(-0.05, 1.52, s * 0.74, 0, 0, 0);
      chamferBox(gm, 0, 0, 0, 0.05, 0.24, 0.05, soot, 0.014);
      popX();
      place(-0.95, 1.32, s * 0.72, 0, 0, 0.55);
      chamferBox(gm, 0, 0, 0, 0.36, 0.04, 0.05, soot, 0.014);
      popX();
      chamferBox(gm, -0.1, 1.02, s * 0.74, 0.85, 0.04, 0.05, soot, 0.014);
    }
    place(-0.1, 1.7, 0, 0, 0, 0.02);
    chamferBox(gm, 0, 0, 0, 0.8, 0.035, 0.7, soot, 0.02);
    // The roof skin has buckled into a shallow dish.
    chamferBox(gm, 0.3, -0.06, 0, 0.28, 0.02, 0.62, T.soot, 0.012);
    popX();
    // Seat frames, steering column, engine block.
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gm, 0.35, 0.62, s * 0.36, 0.24, 0.06, 0.22, soot, 0.012);
      place(0.08, 0.86, s * 0.36, 0, 0, 0.25);
      chamferBox(gm, 0, 0, 0, 0.05, 0.26, 0.22, soot, 0.012);
      popX();
    }
    place(0.62, 0.84, 0.34, 0, 0, -0.9);
    tube(gm, 0.02, 0.02, 0.44, 6, soot, false, false, 0.004);
    popX();
    place(0.86, 0.9, 0.34, 0, 0, -1.3);
    torus(gm, 0.15, 0.018, 12, 5, soot);
    popX();
    chamferBox(gm, 1.45, 0.66, 0, 0.35, 0.24, 0.34, soot, 0.02);
    // Bumpers.
    chamferBox(gm, 2.02, 0.62, 0, 0.06, 0.11, 0.76, sootHi, 0.02);
    chamferBox(gm, -2.02, 0.62, 0, 0.06, 0.11, 0.76, sootHi, 0.02);
    // Wheels: burst tyres, so squashed tori on bare rims.
    for (const wx of [1.05, -1.05]) {
      for (let s = -1; s <= 1; s += 2) {
        place(wx, 0.24, s * 0.78, 0, 0, Math.PI * 0.5, 1, 1, 0.62);
        torus(gm, 0.24, 0.1, 12, 6, T.soot);
        popX();
        place(wx, 0.26, s * 0.76, 0, 0, Math.PI * 0.5);
        tube(gm, 0.17, 0.17, 0.14, 12, T.rustDeep, true, true, 0.008);
        popX();
      }
    }
    popX();
    solidBox(x, 0.85, z, 2.15, 0.85, 0.9, 'metal', yaw, { cover: true });
  }

  /* ====================================================================== */
  /* 8. Animated dressing                                                    */
  /* ====================================================================== */

  const dyn = { chains: [], tarps: [], flames: [], lamps: [], shafts: [] };

  /* --- hanging chains ------------------------------------------------------ */

  const chainLinkGeo = (() => {
    resetX();
    const g = new Geo();
    // A stadium-shaped link, not a torus: two arcs joined by straights, like real chain.
    const R = 0.028;
    const r = 0.011;
    const half = 0.026;
    for (let s = -1; s <= 1; s += 2) {
      place(0, s * half, 0);
      const seg = 8;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI + (s > 0 ? 0 : Math.PI);
        const a1 = ((i + 1) / seg) * Math.PI + (s > 0 ? 0 : Math.PI);
        for (let j = 0; j < 5; j++) {
          const b0 = (j / 5) * Math.PI * 2;
          const b1 = ((j + 1) / 5) * Math.PI * 2;
          const pt = (a, b) => {
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const cb = Math.cos(b);
            const sb = Math.sin(b);
            return [(R + r * cb) * ca, sa * (R + r * cb), r * sb, ca * cb, sa * cb, sb];
          };
          const A = pt(a0, b0);
          const B = pt(a1, b0);
          const C = pt(a1, b1);
          const D = pt(a0, b1);
          const nz = (q) => {
            const l = Math.hypot(q[3], q[4], q[5]) || 1;
            return [q[3] / l, q[4] / l, q[5] / l];
          };
          gquadN(g, A[0], A[1], A[2], nz(A), B[0], B[1], B[2], nz(B), C[0], C[1], C[2], nz(C), D[0], D[1], D[2], nz(D), a0 * R, a1 * R, b0 * r, b1 * r, T.white);
        }
      }
      popX();
    }
    for (let s = -1; s <= 1; s += 2) {
      place(s * R, 0, 0, 0, 0, 0);
      tube(g, r, r, half * 2, 6, T.white, false, false, 0.002);
      popX();
    }
    return g;
  })();

  const chainSet = { geo: chainLinkGeo.build(1 / tileOf('metalRust')), matName: 'metalRust', items: [], mesh: null };
  instanceSets.set('chainLink', chainSet);

  /**
   * Hang a chain from an anchor. The links are instances of one geometry; `update` swings the
   * whole run as a damped pendulum with an amplitude that grows down its length.
   */
  function hangChain(x, y, z, links, dirX, dirZ, phase, amp) {
    const start = chainSet.items.length;
    for (let i = 0; i < links; i++) {
      addInstance(chainSet, x, y - i * 0.045, z, i % 2 === 0 ? 0 : Math.PI * 0.5, 0, 0, 1, T.steelDark);
    }
    dyn.chains.push({ start, count: links, x, y, z, dirX, dirZ, phase, amp, spacing: 0.045 });
  }

  /* --- tarpaulins ----------------------------------------------------------- */

  /**
   * A sagging tarpaulin lashed at its corners. Built as its own small mesh so `update` can
   * ripple the vertex positions; the sag is a real catenary in both axes, not a flat sheet.
   */
  function tarp(x, y, z, w, d, yaw, sag, seedN) {
    const nx = 11;
    const nz = 9;
    const pos = new Float32Array(nx * nz * 3);
    const nor = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const col = new Float32Array(nx * nz * 3);
    const idx = [];
    const r2 = mulberry32(seedN);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const u = i / (nx - 1);
        const v = j / (nz - 1);
        const su = Math.sin(u * Math.PI);
        const sv = Math.sin(v * Math.PI);
        pos[k * 3] = (u - 0.5) * w;
        pos[k * 3 + 1] = -sag * su * sv - r2() * 0.02;
        pos[k * 3 + 2] = (v - 0.5) * d;
        nor[k * 3 + 1] = 1;
        uv[k * 2] = u * w;
        uv[k * 2 + 1] = v * d;
        const tone = 0.85 + r2() * 0.3;
        col[k * 3] = T.tarpBlue[0] * tone;
        col[k * 3 + 1] = T.tarpBlue[1] * tone;
        col[k * 3 + 2] = T.tarpBlue[2] * tone;
      }
    }
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        idx.push(a, a + nx, a + nx + 1, a, a + nx + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const m = mat('tarpaulin');
    m.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    dyn.tarps.push({ mesh, base: pos.slice(), attr: geo.getAttribute('position'), geo, phase: r2() * 6.28, w, d });

    // Eyelets and lashings at the corners.
    const gm = G('metalRust');
    place(x, y, z, yaw);
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        place(sx * w * 0.46, -0.02, sz * d * 0.46, 0, Math.PI * 0.5);
        torus(gm, 0.03, 0.008, 8, 4, T.steelDark);
        popX();
      }
    }
    popX();
    return mesh;
  }

  /* --- practical lights ----------------------------------------------------- */

  const practicalColour = new THREE.Color().setStyle(LIGHTING.practicalColour, THREE.SRGBColorSpace);

  /** Emissive filament/flame material. Basic, additive-free, so it still reads in the HDR pass. */
  function emissiveMat(colour, intensity) {
    const m = new THREE.MeshBasicMaterial({ color: colour, toneMapped: true, fog: false });
    m.color.multiplyScalar(intensity);
    ownedMaterials.add(m);
    return m;
  }

  /**
   * A work lamp: a visible fixture (shade, guard cage, bracket, cable) and the PointLight it
   * motivates. §4 permits no unmotivated point lights.
   */
  function workLamp(x, y, z, yaw, pitch, kind) {
    const gm = G('metalPainted');
    const grust = G('metalRust');
    const group = new THREE.Group();

    place(x, y, z, yaw, pitch);
    // Shade and reflector.
    tube(gm, 0.02, 0.2, 0.26, 12, T.steelPainted, false, false, 0.01);
    place(0, -0.1, 0);
    tube(gm, 0.2, 0.2, 0.03, 12, T.steelDark, false, true, 0.006);
    popX();
    // Guard cage.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      strut(grust, Math.cos(a) * 0.19, -0.12, Math.sin(a) * 0.19, Math.cos(a) * 0.05, -0.3, Math.sin(a) * 0.05, 0.006, T.steelDark, 0.002);
    }
    place(0, -0.24, 0);
    torus(grust, 0.15, 0.006, 10, 4, T.steelDark);
    popX();
    popX();

    // The bulb itself, as its own emissive mesh so the fixture is never a floating light.
    const bulbGeo = new THREE.SphereGeometry(0.062, 10, 7);
    const bulb = new THREE.Mesh(bulbGeo, emissiveMat(practicalColour, 6.5));
    _etmp.set(pitch, yaw, 0, 'YXZ');
    _qtmp.setFromEuler(_etmp);
    _ptmp.set(0, -0.14, 0).applyQuaternion(_qtmp);
    bulb.position.set(x + _ptmp.x, y + _ptmp.y, z + _ptmp.z);
    setLayer(bulb, LAYER.NOPREPASS);
    group.add(bulb);

    const light = new THREE.PointLight(practicalColour, LIGHTING.practicalIntensity, LIGHTING.practicalRange, 2);
    light.position.copy(bulb.position);
    light.castShadow = false;
    group.add(light);
    root.add(group);
    dyn.lamps.push({ light, bulb, base: LIGHTING.practicalIntensity, phase: rand() * 6.28, kind: kind || 'steady' });

    // Mounting hardware, chosen by kind.
    if (kind === 'tripod') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        strut(grust, x, y + 0.05, z, x + Math.cos(a) * 0.62, 0.02, z + Math.sin(a) * 0.62, 0.022, T.steelPainted, 0.005);
      }
      place(x, y * 0.5, z);
      tube(grust, 0.028, 0.028, y, 8, T.steelPainted, false, false, 0.006);
      popX();
      solidBox(x, y * 0.5, z, 0.28, y * 0.5, 0.28, 'metal');
    } else if (kind === 'bracket') {
      strut(grust, x, y, z, x - Math.sin(yaw) * 0.7, y + 0.28, z - Math.cos(yaw) * 0.7, 0.035, T.steelPainted, 0.007);
    }
    return group;
  }

  /**
   * The burning barrel. A punched drum with a glowing interior, a stack of additive flame
   * cards and a flickering light — the map's only warm counterpoint to the sun.
   */
  function burningBarrel(x, z) {
    const grust = G('metalRust');
    place(x, 0, z);
    place(0, 0.46, 0);
    tube(grust, 0.3, 0.3, 0.92, 16, T.soot, false, false, 0.014);
    popX();
    for (let k = 0; k < 2; k++) {
      place(0, 0.3 + k * 0.34, 0);
      tube(grust, 0.318, 0.318, 0.05, 16, T.rustDeep, false, false, 0.006);
      popX();
    }
    // Punched air holes around the base, and a few charred pallet boards sticking out.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      place(Math.cos(a) * 0.3, 0.18, Math.sin(a) * 0.3, -a);
      chamferBox(grust, 0, 0, 0, 0.012, 0.05, 0.06, T.soot, 0.004);
      popX();
    }
    const gw = G('woodPlank');
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.7;
      place(Math.cos(a) * 0.16, 0.95, Math.sin(a) * 0.16, -a, 0, 0.35 + i * 0.05);
      chamferBox(gw, 0, 0, 0, 0.03, 0.24, 0.04, T.soot, 0.006);
      popX();
    }
    popX();
    solidBox(x, 0.46, z, 0.34, 0.46, 0.34, 'metal', 0, { cover: false });

    // Flame cards: three crossed quads with a hot-to-ember vertical gradient.
    const flameGeo = new THREE.BufferGeometry();
    const cards = 3;
    const fp = [];
    const fc = [];
    const fi = [];
    const hot = new THREE.Color().setStyle(PALETTE.muzzleEdge, THREE.SRGBColorSpace);
    const cool = new THREE.Color().setStyle(PALETTE.ember, THREE.SRGBColorSpace);
    for (let c = 0; c < cards; c++) {
      const a = (c / cards) * Math.PI;
      const dx = Math.cos(a) * 0.24;
      const dz = Math.sin(a) * 0.24;
      const b = (fp.length / 3) | 0;
      fp.push(-dx, 0, -dz, dx, 0, dz, dx * 0.25, 0.95, dz * 0.25, -dx * 0.25, 0.95, -dz * 0.25);
      fc.push(hot.r * 2.6, hot.g * 2.0, hot.b * 1.0, hot.r * 2.6, hot.g * 2.0, hot.b * 1.0, cool.r * 0.25, cool.g * 0.14, cool.b * 0.05, cool.r * 0.25, cool.g * 0.14, cool.b * 0.05);
      fi.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    flameGeo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(fp), 3));
    flameGeo.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(fc), 3));
    flameGeo.setIndex(fi);
    const flameMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    ownedMaterials.add(flameMat);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(x, 0.78, z);
    flame.frustumCulled = false;
    setLayer(flame, LAYER.NOPREPASS);
    root.add(flame);

    const light = new THREE.PointLight(new THREE.Color().setStyle(PALETTE.ember, THREE.SRGBColorSpace), 14, 16, 2);
    light.position.set(x, 1.15, z);
    root.add(light);
    dyn.flames.push({ flame, light, phase: rand() * 6.28, x, z });
    return flame;
  }

  /* --- volumetric light shafts ---------------------------------------------- */

  /**
   * A shaft of sun from a hole in a roof or wall. Additive, vertex-graded from bright at the
   * aperture to nothing at its far end, on the NOPREPASS layer so it cannot poison SSAO.
   * At 8° of elevation the shafts rake almost horizontally, which is exactly why the depot's
   * west wall is the one that is blown open.
   */
  const shaftGeoParts = [];
  function lightShaft(x, y, z, w, h, length, strength) {
    const dirX = -SUN_DIR.x;
    const dirY = -SUN_DIR.y;
    const dirZ = -SUN_DIR.z;
    const up = [0, 1, 0];
    const rx = dirZ * up[1] - dirY * up[2];
    const ry = dirX * up[2] - dirZ * up[0];
    const rz = dirY * up[0] - dirX * up[1];
    const rl = Math.hypot(rx, ry, rz) || 1;
    const ux = rx / rl;
    const uy = ry / rl;
    const uz = rz / rl;
    const vx = uy * dirZ - uz * dirY;
    const vy = uz * dirX - ux * dirZ;
    const vz = ux * dirY - uy * dirX;

    const sun = new THREE.Color().setStyle(PALETTE.sun, THREE.SRGBColorSpace);
    const p = [];
    const c = [];
    const ix = [];
    const cards = 3;
    for (let k = 0; k < cards; k++) {
      const f = (k + 0.5) / cards;
      const hw = w * 0.5 * lerp(0.5, 1, f);
      const hh = h * 0.5 * lerp(1, 0.5, f);
      const spread = 1.55;
      const b = (p.length / 3) | 0;
      const a0 = [x - ux * hw - vx * hh, y - uy * hw - vy * hh, z - uz * hw - vz * hh];
      const a1 = [x + ux * hw - vx * hh, y + uy * hw - vy * hh, z + uz * hw - vz * hh];
      const e0 = [
        a0[0] + dirX * length - ux * hw * (spread - 1),
        a0[1] + dirY * length - vy * hh * (spread - 1),
        a0[2] + dirZ * length - uz * hw * (spread - 1),
      ];
      const e1 = [
        a1[0] + dirX * length + ux * hw * (spread - 1),
        a1[1] + dirY * length - vy * hh * (spread - 1),
        a1[2] + dirZ * length + uz * hw * (spread - 1),
      ];
      p.push(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], e1[0], e1[1], e1[2], e0[0], e0[1], e0[2]);
      const s0 = strength * (1 - Math.abs(f - 0.5));
      c.push(
        sun.r * s0, sun.g * s0 * 0.94, sun.b * s0 * 0.78,
        sun.r * s0, sun.g * s0 * 0.94, sun.b * s0 * 0.78,
        0, 0, 0,
        0, 0, 0
      );
      ix.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(p), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(c), 3));
    geo.setIndex(ix);
    shaftGeoParts.push(geo);
    return geo;
  }

  function finishShafts() {
    if (!shaftGeoParts.length) return;
    let geo = shaftGeoParts[0];
    if (shaftGeoParts.length > 1) {
      const merged = mergeGeometries(shaftGeoParts, false);
      if (merged) {
        for (const g of shaftGeoParts) g.dispose();
        geo = merged;
      }
    }
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    ownedMaterials.add(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    setLayer(mesh, LAYER.NOPREPASS);
    root.add(mesh);
    dyn.shafts.push({ mesh, mat: m });
  }

  /* ====================================================================== */
  /* 9. Ground                                                               */
  /* ====================================================================== */

  const inRect = (x, z, r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];

  const SLAB_ZONES = [
    [DEPOT.x0, DEPOT.z0, DEPOT.x1, DEPOT.z1],
    [ADMIN.x0, ADMIN.z0, ADMIN.x1, ADMIN.z1],
    [-24, -12, 2, -2],
  ];
  const ROAD_ZONES = [
    [-22, -9, 20, -3],
    [-52, -45, 48, -40.5],
    [ADMIN.x0 - 8, -34, ADMIN.x0, -18],
  ];

  /** Ground height: a few centimetres of relief so the map never reads as a flat plane. */
  function groundY(x, z) {
    for (let i = 0; i < SLAB_ZONES.length; i++) if (inRect(x, z, SLAB_ZONES[i])) return 0;
    const n = fbm2(x * 0.075, z * 0.075) - 0.5;
    const fine = fbm2(x * 0.42 + 31, z * 0.42 - 17) - 0.5;
    let y = n * 0.22 + fine * 0.05;
    // Ballast shoulders shed water into shallow cess drains between the roads.
    for (let i = 0; i < TRACK_Z.length; i++) {
      const d = Math.abs(z - TRACK_Z[i]);
      if (d < 3.6) y -= (1 - d / 3.6) * 0.09;
    }
    return y;
  }

  function groundMaterialAt(x, z) {
    for (let i = 0; i < SLAB_ZONES.length; i++) if (inRect(x, z, SLAB_ZONES[i])) return 'concreteRough';
    for (let i = 0; i < ROAD_ZONES.length; i++) if (inRect(x, z, ROAD_ZONES[i])) return 'asphalt';
    const n = fbm2(x * 0.055 + 9.3, z * 0.055 - 4.1);
    if (n > 0.62) return 'dirt';
    if (n < 0.34) return 'dirt';
    return 'gravel';
  }

  function buildGround() {
    resetX();
    const step = 2;
    const x0 = -HALF_W - 3;
    const x1 = HALF_W + 3;
    const z0 = -HALF_D - 3;
    const z1 = HALF_D + 3;
    const nx = Math.round((x1 - x0) / step);
    const nz = Math.round((z1 - z0) / step);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const ax = x0 + i * step;
        const az = z0 + j * step;
        const bx = ax + step;
        const bz = az + step;
        const name = groundMaterialAt(ax + 1, az + 1);
        const g = GT(name, name === 'asphalt' ? 0.35 : 0.6);
        const yA = groundY(ax, az);
        const yB = groundY(bx, az);
        const yC = groundY(bx, bz);
        const yD = groundY(ax, bz);
        // Large-scale tonal drift: dust settles pale, oil and shade go cool and dark.
        const shade = 0.72 + fbm2(ax * 0.031 - 5, az * 0.031 + 12) * 0.62;
        const warm = fbm2(ax * 0.017 + 40, az * 0.017 - 22);
        const t0 = [shade * lerp(0.94, 1.06, warm), shade * lerp(0.96, 1.02, warm), shade * lerp(1.04, 0.94, warm)];
        _bp.length = 0;
        _bp.push(ax, yA, az, bx, yB, az, bx, yC, bz, ax, yD, bz);
        gpoly(g, _bp, 0, 1, 0, t0);
      }
    }
  }

  /* --- kerbs, drains and cable ducts ----------------------------------------- */

  /** Kerb run with a chamfered top arris and a dropped section, plus a gully every 12 m. */
  function kerbRun(x0, z0, x1, z1, side) {
    const gc = G('concretePanel');
    const gm = G('metalRust');
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = runYaw(x1 - x0, z1 - z0);
    const units = Math.max(1, Math.round(len / 0.9));
    for (let i = 0; i < units; i++) {
      const tt = (i + 0.5) / units;
      const px = x0 + (x1 - x0) * tt;
      const pz = z0 + (z1 - z0) * tt;
      const tone = 0.85 + hash2(i, Math.round(px)) * 0.28;
      place(px, 0, pz, yaw);
      chamferBox(gc, 0, 0.06, 0, (len / units) * 0.5 - 0.01, 0.12, 0.075, [T.kerb[0] * tone, T.kerb[1] * tone, T.kerb[2] * tone], 0.02);
      popX();
    }
    // Gullies with a cast grating.
    const gullies = Math.max(1, Math.floor(len / 12));
    for (let i = 0; i < gullies; i++) {
      const tt = (i + 0.5) / gullies;
      const px = x0 + (x1 - x0) * tt;
      const pz = z0 + (z1 - z0) * tt;
      place(px - Math.sin(yaw) * 0.2 * side, 0, pz - Math.cos(yaw) * 0.2 * side, yaw);
      chamferBox(gc, 0, 0.01, 0, 0.24, 0.04, 0.24, T.concreteDark, 0.01);
      for (let k = -2; k <= 2; k++) {
        chamferBox(gm, 0, 0.045, k * 0.075, 0.2, 0.012, 0.024, T.rustDeep, 0.004);
      }
      popX();
    }
  }

  /** Surface cable duct: a run of chamfered trough covers with the odd one lifted. */
  function cableDuct(x0, z0, x1, z1, seedN) {
    const gc = G('concretePanel');
    const r2 = mulberry32(seedN);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = runYaw(x1 - x0, z1 - z0);
    const units = Math.max(1, Math.round(len / 1.0));
    for (let i = 0; i < units; i++) {
      const tt = (i + 0.5) / units;
      const px = x0 + (x1 - x0) * tt;
      const pz = z0 + (z1 - z0) * tt;
      const lifted = r2() < 0.12;
      place(px, 0, pz, yaw + (r2() - 0.5) * 0.03, 0, lifted ? 0.35 : 0);
      chamferBox(gc, 0, lifted ? 0.12 : 0.07, 0, (len / units) * 0.5 - 0.015, 0.07, 0.19, T.concreteWorn, 0.018);
      popX();
    }
  }

  /* ====================================================================== */
  /* 10. Perimeter                                                           */
  /* ====================================================================== */

  /**
   * Precast concrete panel wall: H-section pilasters with panels dropped between them, a
   * chamfered coping, and a couple of collapsed bays so the boundary reads as damaged rather
   * than as a level designer's box.
   */
  function precastWall(x0, z0, x1, z1, h, seedN) {
    const gc = G('concretePanel');
    const r2 = mulberry32(seedN);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = runYaw(x1 - x0, z1 - z0);
    const bays = Math.max(1, Math.round(len / 2.5));
    const bay = len / bays;
    for (let i = 0; i <= bays; i++) {
      const tt = i / bays;
      const px = x0 + (x1 - x0) * tt;
      const pz = z0 + (z1 - z0) * tt;
      place(px, 0, pz, yaw);
      chamferBox(gc, 0, h * 0.5, 0, 0.14, h * 0.5 + 0.05, 0.19, T.concrete, 0.022);
      popX();
    }
    for (let i = 0; i < bays; i++) {
      const tt = (i + 0.5) / bays;
      const px = x0 + (x1 - x0) * tt;
      const pz = z0 + (z1 - z0) * tt;
      const state = r2();
      place(px, 0, pz, yaw);
      if (state < 0.07) {
        // Collapsed bay: two leaning slabs and a spill of rubble.
        place(0, 0.6, 0.5, 0, 0.9, 0.1);
        chamferBox(gc, 0, 0, 0, 0.09, h * 0.42, bay * 0.44, T.concreteWorn, 0.02);
        popX();
      } else {
        const tone = 0.86 + r2() * 0.26;
        const tt2 = [T.concrete[0] * tone, T.concrete[1] * tone, T.concrete[2] * tone];
        // Three stacked panels with a visible joint gap: real precast, not one slab.
        const panels = 3;
        for (let k = 0; k < panels; k++) {
          const py = 0.1 + (k + 0.5) * ((h - 0.2) / panels);
          chamferBox(gc, 0, py, 0, bay * 0.5 - 0.16, (h - 0.2) / panels / 2 - 0.018, 0.09, tt2, 0.02);
        }
        // Coping.
        chamferBox(gc, 0, h + 0.03, 0, bay * 0.5 - 0.15, 0.05, 0.13, T.concreteWorn, 0.02);
        // Grime wash at the base.
        chamferBox(gc, 0, 0.16, 0.095, bay * 0.5 - 0.18, 0.16, 0.008, T.concreteDark, 0.006);
      }
      popX();
      if (state >= 0.07) solidBox(px, h * 0.5, pz, bay * 0.5, h * 0.5, 0.15, 'concrete', yaw, { cover: true });
    }
  }

  /** Earth embankment: a triplanar dirt berm with a sparse crown of scrub and a fence on top. */
  function embankment(x0, z0, x1, z1, height, width, faceIn) {
    const g = GT('dirt', 0.35);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const segs = Math.max(4, Math.round(len / 4));
    place((x0 + x1) * 0.5, 0, (z0 + z1) * 0.5, yaw);
    for (let i = 0; i < segs; i++) {
      const za = -len * 0.5 + (i / segs) * len;
      const zb = -len * 0.5 + ((i + 1) / segs) * len;
      const ha = height * (0.86 + fbm2(za * 0.2, 3) * 0.3);
      const hb = height * (0.86 + fbm2(zb * 0.2, 3) * 0.3);
      const toe = faceIn * width;
      // Face.
      _bp.length = 0;
      _bp.push(toe, 0, za, toe, 0, zb, faceIn * width * 0.18, hb, zb, faceIn * width * 0.18, ha, za);
      gpoly(g, _bp, faceIn * 0.75, 0.66, 0, T.dirt);
      // Crown.
      _bp.length = 0;
      _bp.push(faceIn * width * 0.18, ha, za, faceIn * width * 0.18, hb, zb, -faceIn * width * 0.3, hb, zb, -faceIn * width * 0.3, ha, za);
      gpoly(g, _bp, 0, 1, 0, mixTint(T.dirt, T.weeds, 0.35));
      // Back, falling away out of play.
      _bp.length = 0;
      _bp.push(-faceIn * width * 0.3, ha, za, -faceIn * width * 0.3, hb, zb, -faceIn * width * 1.1, 0, zb, -faceIn * width * 1.1, 0, za);
      gpoly(g, _bp, -faceIn * 0.7, 0.7, 0, T.dirt);
    }
    popX();
    solidBox((x0 + x1) * 0.5, height * 0.5, (z0 + z1) * 0.5, width * 0.72, height * 0.5, len * 0.5, 'dirt', yaw, { noNav: false });
  }

  /* ====================================================================== */
  /* 11. Building fabric                                                     */
  /* ====================================================================== */

  /**
   * A wall in local space: runs along X, thickness along Z, from `y0` to `y1`, with
   * rectangular openings punched through it. Emits the piers, the spandrels under and over
   * each opening, and the reveals — so a window is a hole in a solid, with depth, not a
   * darker rectangle painted on a plane.
   *
   * Returns the solid sub-boxes so the caller can turn them into collision.
   */
  function punchedWall(g, len, y0, y1, thick, openings, tintArr, chamf) {
    const parts = [];
    const ops = openings.slice().sort((a, b) => a.x - a.w * 0.5 - (b.x - b.w * 0.5));
    let cursor = -len * 0.5;
    const emit = (xa, xb, ya, yb) => {
      if (xb - xa < 0.02 || yb - ya < 0.02) return;
      chamferBox(g, (xa + xb) * 0.5, (ya + yb) * 0.5, 0, (xb - xa) * 0.5, (yb - ya) * 0.5, thick * 0.5, tintArr, chamf === undefined ? 0.018 : chamf);
      parts.push([(xa + xb) * 0.5, (ya + yb) * 0.5, (xb - xa) * 0.5, (yb - ya) * 0.5]);
    };
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      const oa = o.x - o.w * 0.5;
      const ob = o.x + o.w * 0.5;
      emit(cursor, oa, y0, y1);
      emit(oa, ob, y0, Math.max(y0, o.y0));
      emit(oa, ob, Math.min(y1, o.y1), y1);
      cursor = Math.max(cursor, ob);
    }
    emit(cursor, len * 0.5, y0, y1);
    return parts;
  }

  /**
   * Window dressing for a punched opening: a precast cill with a drip, a lintel, a steel
   * frame with a transom, and the shards of glass still in the rebate.
   */
  function windowDress(gFrame, gStone, gGlass, x, y0, y1, w, thick, broken) {
    const hw = w * 0.5;
    const h = y1 - y0;
    // Cill and lintel.
    chamferBox(gStone, x, y0 - 0.05, 0, hw + 0.1, 0.055, thick * 0.5 + 0.045, T.concreteWorn, 0.015);
    chamferBox(gStone, x, y1 + 0.08, 0, hw + 0.12, 0.08, thick * 0.5 + 0.02, T.concreteWorn, 0.015);
    // Frame: outer section, mullion and transom.
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gFrame, x + s * (hw - 0.03), y0 + h * 0.5, 0, 0.03, h * 0.5, 0.028, T.steelPainted, 0.006);
    }
    chamferBox(gFrame, x, y0 + 0.03, 0, hw, 0.03, 0.028, T.steelPainted, 0.006);
    chamferBox(gFrame, x, y1 - 0.03, 0, hw, 0.03, 0.028, T.steelPainted, 0.006);
    chamferBox(gFrame, x, y0 + h * 0.62, 0, hw, 0.022, 0.026, T.steelPainted, 0.005);
    if (w > 1.3) chamferBox(gFrame, x, y0 + h * 0.5, 0, 0.022, h * 0.5, 0.026, T.steelPainted, 0.005);
    if (broken) {
      // Shards clinging to the frame, on the glass material so they catch the sun edge-on.
      const r2 = mulberry32(Math.round(x * 977 + y0 * 31) >>> 0);
      const n = 3 + Math.floor(r2() * 4);
      for (let i = 0; i < n; i++) {
        const sx = x - hw + r2() * w;
        const top = r2() < 0.5;
        const hgt = 0.1 + r2() * 0.3;
        place(sx, top ? y1 - 0.04 - hgt * 0.5 : y0 + 0.04 + hgt * 0.5, 0, 0, 0, (r2() - 0.5) * 0.3);
        chamferBox(gGlass, 0, 0, 0, 0.05 + r2() * 0.12, hgt * 0.5, 0.004, T.glass, 0.002);
        popX();
      }
    } else {
      chamferBox(gGlass, x, y0 + h * 0.5, 0, hw - 0.04, h * 0.5 - 0.04, 0.004, T.glass, 0.002);
    }
  }

  /** Steel stair: stringers, treads, a landing nib and a handrail. Collision is a clean ramp. */
  function steelStair(x, y0, z, run, rise, width, yaw, gm) {
    const steps = Math.max(3, Math.round(rise / 0.19));
    const going = run / steps;
    place(x, y0, z, yaw);
    for (let i = 0; i < steps; i++) {
      const sx = -run * 0.5 + (i + 0.5) * going;
      const sy = ((i + 1) / steps) * rise;
      chamferBox(gm, sx, sy - 0.015, 0, going * 0.5, 0.015, width * 0.5, T.steelDark, 0.006);
      // The riser is open on a steel stair — just a toe plate.
      chamferBox(gm, sx - going * 0.45, sy - 0.09, 0, 0.012, 0.075, width * 0.5, T.steelPainted, 0.004);
    }
    for (let s = -1; s <= 1; s += 2) {
      const ang = Math.atan2(rise, run);
      place(0, rise * 0.5 - 0.12, s * (width * 0.5 + 0.03), 0, 0, ang);
      chamferBox(gm, 0, 0, 0, Math.hypot(run, rise) * 0.5, 0.11, 0.02, T.steelPainted, 0.008);
      popX();
      // Handrail, following the flight.
      for (let i = 0; i <= steps; i += 2) {
        const sx = -run * 0.5 + i * going;
        const sy = (i / steps) * rise;
        place(sx, sy + 0.5, s * (width * 0.5 + 0.03));
        tube(gm, 0.018, 0.02, 1.0, 6, T.steelPainted, true, false, 0.004);
        popX();
      }
      place(0, rise * 0.5 + 1.0, s * (width * 0.5 + 0.03), 0, 0, ang);
      tube(gm, 0.021, 0.021, Math.hypot(run, rise), 6, T.steelPainted, false, false, 0.004);
      popX();
      place(0, rise * 0.5 + 0.52, s * (width * 0.5 + 0.03), 0, 0, ang);
      tube(gm, 0.016, 0.016, Math.hypot(run, rise), 6, T.steelPainted, false, false, 0.003);
      popX();
    }
    popX();
    solidRamp(x, z, run * 0.5, width * 0.5, y0 + 0.05, y0 + rise, 'metal', yaw);
  }

  /** Rainwater goods: a hopper, a downpipe on offset brackets and a shoe at the bottom. */
  function downpipe(x, z, top, yaw, gm) {
    place(x, 0, z, yaw);
    place(0, top - 0.2, 0.06);
    tube(gm, 0.12, 0.09, 0.34, 8, T.rustDeep, false, false, 0.008);
    popX();
    place(0, (top - 0.5) * 0.5 + 0.15, 0.06);
    tube(gm, 0.055, 0.055, top - 0.5, 10, T.rustDeep, false, false, 0.006);
    popX();
    for (let i = 1; i < Math.floor(top / 1.8); i++) {
      chamferBox(gm, 0, i * 1.8, 0.028, 0.02, 0.02, 0.04, T.rustDeep, 0.004);
    }
    place(0, 0.18, 0.1, 0, -0.45);
    tube(gm, 0.055, 0.055, 0.32, 8, T.rustDeep, true, false, 0.006);
    popX();
    popX();
  }

  /** Surface conduit and a junction box — the cheapest way to stop a wall reading as a plane. */
  function conduitRun(gm, x0, y0, x1, y1, z, boxAt) {
    strut(gm, x0, y0, z, x1, y1, z, 0.021, T.steelPainted, 0.005);
    for (let i = 0; i <= 6; i++) {
      const f = i / 6;
      chamferBox(gm, lerp(x0, x1, f), lerp(y0, y1, f), z - 0.02, 0.018, 0.018, 0.02, T.steelPainted, 0.004);
    }
    if (boxAt !== undefined) {
      chamferBox(gm, boxAt, y1, z + 0.02, 0.13, 0.17, 0.07, T.steelPainted, 0.012);
      chamferBox(gm, boxAt, y1, z + 0.09, 0.1, 0.14, 0.008, T.steelDark, 0.004);
    }
  }

  /* ====================================================================== */
  /* 12. THE DEPOT — bombed maintenance shed                                 */
  /* ====================================================================== */

  /**
   * A 30 x 32 m two-bay shed. Brick dado, corrugated cladding above, steel portal frames,
   * a partly collapsed roof, an inspection pit under the spur, an overhead travelling crane
   * and a mezzanine.
   *
   * The sun is at 8° from the west-north-west, so the WEST wall is the one that is blown
   * open: shafts then rake right across the shed and strike the east wall and the floor
   * beside it. Punching the roof alone at this elevation would put the light on the far
   * neighbour's wall, not on this floor.
   */
  function buildDepot() {
    resetX();
    const gB = G('brickPainted');
    const gC = G('corrugatedSteel');
    const gS = G('metalPainted');
    const gR = G('metalRust');
    const gCon = G('concreteRough');
    const gGl = G('glassDirty');
    const W = DEPOT.x1 - DEPOT.x0;
    const D = DEPOT.z1 - DEPOT.z0;
    const cx = (DEPOT.x0 + DEPOT.x1) * 0.5;
    const cz = (DEPOT.z0 + DEPOT.z1) * 0.5;
    const dado = 2.7;
    const eave = DEPOT.eave;
    const th = DEPOT.wall;

    /* --- floor slab, gutters and the inspection pit --------------------- */

    // Inspection pit: a real hole in the floor, so it has to be cut out of both the visual
    // slab and the collision before either is emitted.
    const pit = { x0: PIT.x0, x1: PIT.x1, z0: SPUR_Z - PIT.hz, z1: SPUR_Z + PIT.hz, depth: PIT.depth };
    groundHole(pit.x0, pit.z0, pit.x1, pit.z1);

    // Bay-jointed slab: 5 m panels with real 25 mm movement joints between them. Bays that
    // meet the pit are re-cut at 1 m so the opening has a clean concrete edge.
    place(cx, 0, cz);
    const slabAt = (wx0, wz0, wx1, wz1) => {
      if (wx1 <= pit.x0 || wx0 >= pit.x1 || wz1 <= pit.z0 || wz0 >= pit.z1) {
        const tone = 0.82 + hash2(Math.round(wx0), Math.round(wz0)) * 0.3;
        chamferBox(
          gCon,
          (wx0 + wx1) * 0.5 - cx,
          0.06,
          (wz0 + wz1) * 0.5 - cz,
          (wx1 - wx0) * 0.5 - 0.025,
          0.06,
          (wz1 - wz0) * 0.5 - 0.025,
          [T.concrete[0] * tone, T.concrete[1] * tone, T.concrete[2] * tone],
          0.014
        );
        return true;
      }
      return false;
    };
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        const wx0 = DEPOT.x0 + i * 5;
        const wz0 = DEPOT.z0 + j * (D / 6);
        const wx1 = wx0 + 5;
        const wz1 = wz0 + D / 6;
        if (slabAt(wx0, wz0, wx1, wz1)) continue;
        for (let a = 0; a < 5; a++) {
          for (let b = 0; b < 5; b++) {
            slabAt(wx0 + a, wz0 + b * (D / 30), wx0 + a + 1, wz0 + (b + 1) * (D / 30));
          }
        }
      }
    }
    popX();
    // Floor collision, split into four bands around the opening.
    solidBox(cx, 0.06, (DEPOT.z0 + pit.z0) * 0.5, W * 0.5, 0.06, (pit.z0 - DEPOT.z0) * 0.5, 'concrete', 0, { walkTop: true });
    solidBox(cx, 0.06, (pit.z1 + DEPOT.z1) * 0.5, W * 0.5, 0.06, (DEPOT.z1 - pit.z1) * 0.5, 'concrete', 0, { walkTop: true });
    solidBox((DEPOT.x0 + pit.x0) * 0.5, 0.06, SPUR_Z, (pit.x0 - DEPOT.x0) * 0.5, 0.06, (pit.z1 - pit.z0) * 0.5, 'concrete', 0, { walkTop: true });
    solidBox((pit.x1 + DEPOT.x1) * 0.5, 0.06, SPUR_Z, (DEPOT.x1 - pit.x1) * 0.5, 0.06, (pit.z1 - pit.z0) * 0.5, 'concrete', 0, { walkTop: true });
    place((pit.x0 + pit.x1) * 0.5, 0, SPUR_Z);
    const phw = (pit.x1 - pit.x0) * 0.5;
    quadXZ(gCon, 0, -pit.depth, 0, phw, 1.05, T.concreteDark);
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gB, 0, -pit.depth * 0.5, s * 1.12, phw, pit.depth * 0.5, 0.075, T.brick, 0.012);
      chamferBox(gCon, 0, 0.02, s * 1.16, phw, 0.06, 0.12, T.concreteWorn, 0.014);
    }
    chamferBox(gB, -phw + 0.06, -pit.depth * 0.5, 0, 0.06, pit.depth * 0.5, 1.12, T.brick, 0.012);
    chamferBox(gB, phw - 0.06, -pit.depth * 0.5, 0, 0.06, pit.depth * 0.5, 1.12, T.brick, 0.012);
    // Pit ladder and a strip light on the wall.
    for (let s = -1; s <= 1; s += 2) {
      strut(gR, phw - 0.3, -pit.depth + 0.05, s * 0.2, phw - 0.3, 0.02, s * 0.2, 0.018, T.rustDeep, 0.004);
    }
    for (let i = 1; i < 6; i++) {
      strut(gR, phw - 0.3, -pit.depth + (i / 6) * pit.depth, -0.2, phw - 0.3, -pit.depth + (i / 6) * pit.depth, 0.2, 0.013, T.rustDeep, 0.003);
    }
    popX();
    // Pit collision: floor plus four walls, so the player can drop in and climb the ramp end.
    solidBox((pit.x0 + pit.x1) * 0.5, -pit.depth - 0.15, SPUR_Z, phw, 0.15, 1.06, 'concrete', 0, { walkTop: true });
    solidBox((pit.x0 + pit.x1) * 0.5, -pit.depth * 0.5, SPUR_Z - 1.15, phw, pit.depth * 0.5, 0.1, 'concrete');
    solidBox((pit.x0 + pit.x1) * 0.5, -pit.depth * 0.5, SPUR_Z + 1.15, phw, pit.depth * 0.5, 0.1, 'concrete');
    solidBox(pit.x0 - 0.1, -pit.depth * 0.5, SPUR_Z, 0.1, pit.depth * 0.5, 1.2, 'concrete');
    solidRamp(pit.x1 - 1.4, SPUR_Z, 1.4, 1.0, -pit.depth + 0.1, 0.05, 'concrete', 0);

    /* --- walls ---------------------------------------------------------- */

    // North and south gable walls (run along X), with the personnel door and the blast hole.
    for (let s = -1; s <= 1; s += 2) {
      const z = s < 0 ? DEPOT.z0 : DEPOT.z1;
      const ops = [];
      if (s > 0) {
        ops.push({ x: -3, y0: 0, y1: 2.35, w: 1.15 }); // personnel door out to the yard
        ops.push({ x: 8.5, y0: 0, y1: 4.4, w: 5.6 }); // blast hole, route two to the yard
        ops.push({ x: -11, y0: 3.2, y1: 5.0, w: 2.4 });
      } else {
        ops.push({ x: -6, y0: 3.4, y1: 5.2, w: 2.6 });
        ops.push({ x: 6, y0: 3.4, y1: 5.2, w: 2.6 });
      }
      place(cx, 0, z, 0);
      const partsB = punchedWall(gB, W, 0, dado, th, ops, T.brick, 0.02);
      place(0, 0, 0);
      const partsC = punchedWall(gC, W, dado, eave, th * 0.6, ops, T.steelPainted, 0.012);
      popX();
      // Gable infill above the eaves, following the roof pitch.
      const gx = DEPOT.ridgeX - cx;
      _bp.length = 0;
      _bp.push(-W * 0.5, eave, 0, gx, DEPOT.ridge, 0, W * 0.5, eave, 0);
      gpoly(gC, _bp, 0, 0, s, T.steelPainted);
      _bp.length = 0;
      _bp.push(-W * 0.5, eave, -th * 0.3, gx, DEPOT.ridge, -th * 0.3, W * 0.5, eave, -th * 0.3);
      gpoly(gC, _bp, 0, 0, -s, T.steelPainted);
      // Cill band on the dado.
      chamferBox(gCon, 0, dado + 0.04, 0, W * 0.5, 0.05, th * 0.55, T.concreteWorn, 0.014);
      for (const o of ops) {
        if (o.y1 > 3) windowDress(gS, gCon, gGl, o.x, o.y0, o.y1, o.w, th, true);
      }
      popX();
      for (const p of partsB) solidBox(cx + p[0], p[1], z, p[2], p[3], th * 0.5, 'concrete', 0, { cover: p[1] < 2 });
      for (const p of partsC) solidBox(cx + p[0], p[1], z, p[2], p[3], th * 0.4, 'metal');
      // Gable collision, coarse.
      solidBox(cx, (eave + DEPOT.ridge) * 0.5, z, W * 0.4, (DEPOT.ridge - eave) * 0.5, th * 0.4, 'metal');
    }

    // East wall (facing the yard): the big roller door plus a wicket.
    {
      const ops = [
        { x: 5, y0: 0, y1: 5.4, w: 9.6 },
        { x: -10, y0: 0, y1: 2.3, w: 1.1 },
        { x: -13, y0: 6.4, y1: 7.9, w: 2.2 },
        { x: 13, y0: 6.4, y1: 7.9, w: 2.2 },
      ];
      place(DEPOT.x1, 0, cz, Math.PI * 0.5);
      const pB = punchedWall(gB, D, 0, dado, th, ops, T.brick, 0.02);
      const pC = punchedWall(gC, D, dado, eave, th * 0.6, ops, T.steelPainted, 0.012);
      chamferBox(gCon, 0, dado + 0.04, 0, D * 0.5, 0.05, th * 0.55, T.concreteWorn, 0.014);
      for (const o of ops) if (o.y0 > 3) windowDress(gS, gCon, gGl, o.x, o.y0, o.y1, o.w, th, true);
      // Roller door: the curtain rolled up into its barrel, plus the guide channels.
      place(5, 5.55, -th * 0.35);
      tube(gR, 0.42, 0.42, 9.9, 14, T.rustDeep, false, false, 0.012, 0);
      popX();
      for (let s = -1; s <= 1; s += 2) {
        chamferBox(gR, 5 + s * 4.9, 2.7, -th * 0.3, 0.09, 2.7, 0.11, T.rustDeep, 0.01);
      }
      // Concrete threshold and the rubbed steel angle that protects it.
      chamferBox(gCon, 5, 0.06, 0, 4.9, 0.06, th * 0.6, T.concreteWorn, 0.014);
      popX();
      for (const p of pB) solidBox(DEPOT.x1, p[1], cz + p[0], th * 0.5, p[3], p[2], 'concrete', 0, { cover: p[1] < 2 });
      for (const p of pC) solidBox(DEPOT.x1, p[1], cz + p[0], th * 0.4, p[3], p[2], 'metal');
    }

    // West wall: torn open by the blast that took the roof, which is where the light gets in.
    {
      const ops = [
        { x: -2, y0: 1.1, y1: 7.2, w: 7.5 },
        { x: 10, y0: 5.9, y1: 7.7, w: 2.6 },
        { x: -13, y0: 5.9, y1: 7.7, w: 2.6 },
        { x: 13.5, y0: 0, y1: 2.4, w: 1.2 },
      ];
      place(DEPOT.x0, 0, cz, Math.PI * 0.5);
      const pB = punchedWall(gB, D, 0, dado, th, ops, T.brick, 0.02);
      const pC = punchedWall(gC, D, dado, eave, th * 0.6, ops, T.steelPainted, 0.012);
      chamferBox(gCon, 0, dado + 0.04, 0, D * 0.5, 0.05, th * 0.55, T.concreteWorn, 0.014);
      for (const o of ops) if (o.y0 > 3 && o.w < 4) windowDress(gS, gCon, gGl, o.x, o.y0, o.y1, o.w, th, true);
      // Torn cladding hanging off the blast edge.
      for (let i = 0; i < 5; i++) {
        const z = -5.5 + i * 2.7;
        place(z, 6.9 + (i % 2) * 0.4, -th * 0.4, 0, 0, 0.5 + i * 0.22);
        chamferBox(gC, 0, 0, 0, 0.5, 0.7, 0.012, T.rust, 0.006);
        popX();
      }
      popX();
      for (const p of pB) solidBox(DEPOT.x0, p[1], cz + p[0], th * 0.5, p[3], p[2], 'concrete', 0, { cover: p[1] < 2 });
      for (const p of pC) solidBox(DEPOT.x0, p[1], cz + p[0], th * 0.4, p[3], p[2], 'metal');
    }

    /* --- portal frames, purlins and the roof ----------------------------- */

    const frames = 7;
    for (let i = 0; i < frames; i++) {
      const z = DEPOT.z0 + 1.6 + (i / (frames - 1)) * (D - 3.2);
      place(0, 0, z);
      for (let s = -1; s <= 1; s += 2) {
        const x = s < 0 ? DEPOT.x0 + 0.75 : DEPOT.x1 - 0.75;
        place(x, eave * 0.5, 0, Math.PI * 0.5);
        ibeam(gS, eave, 0.46, 0.19, 0.012, 0.02, T.steelPainted);
        popX();
        // Rafter up to the ridge, with a haunch.
        const rx = DEPOT.ridgeX;
        const dx = rx - x;
        const dy = DEPOT.ridge - eave;
        const ln = Math.hypot(dx, dy);
        place(x + dx * 0.5, eave + dy * 0.5, 0, Math.PI * 0.5, 0, Math.atan2(dy, dx));
        ibeam(gS, ln, 0.4, 0.17, 0.011, 0.018, T.steelPainted);
        popX();
        strut(gS, x + dx * 0.14, eave - 0.28, 0, x + dx * 0.02, eave - 1.5, 0, 0.09, T.steelPainted, 0.01);
      }
      popX();
      solidBox(DEPOT.x0 + 0.75, eave * 0.5, z, 0.23, eave * 0.5, 0.23, 'metal', 0, { cover: true });
      solidBox(DEPOT.x1 - 0.75, eave * 0.5, z, 0.23, eave * 0.5, 0.23, 'metal', 0, { cover: true });
    }

    // Purlins and the roof sheets. The blast took the north-west quadrant.
    const blast = { x0: DEPOT.x0, x1: DEPOT.ridgeX + 3, z0: -35, z1: -23 };
    for (let side = -1; side <= 1; side += 2) {
      const xa = side < 0 ? DEPOT.x0 : DEPOT.x1;
      const dx = DEPOT.ridgeX - xa;
      const dy = DEPOT.ridge - eave;
      const steps = 7;
      for (let i = 0; i < steps; i++) {
        const f0 = i / steps;
        const f1 = (i + 1) / steps;
        const mxp = xa + dx * (f0 + f1) * 0.5;
        const myp = eave + dy * (f0 + f1) * 0.5;
        // Purlin.
        place(xa + dx * f0, eave + dy * f0 + 0.12, cz);
        chamferBox(gS, 0, 0, 0, 0.06, 0.09, D * 0.5, T.steelPainted, 0.008);
        popX();
        // Sheeting in 2.4 m lengths so pieces can be missing individually.
        const sheets = 13;
        for (let j = 0; j < sheets; j++) {
          const zc = DEPOT.z0 + (j + 0.5) * (D / sheets);
          const inBlast = mxp >= blast.x0 && mxp <= blast.x1 && zc >= blast.z0 && zc <= blast.z1;
          const gone = inBlast ? hash2(i, j) < 0.78 : hash2(i * 7, j * 3) < 0.05;
          if (gone) continue;
          const tone = 0.8 + hash2(i + 40, j) * 0.35;
          place(mxp, myp, zc, 0, 0, Math.atan2(dy, dx * side) * side * -1 + (side < 0 ? 0 : 0));
          place(0, 0, 0, Math.PI * 0.5);
          corrugated(gC, D / sheets, Math.hypot(dx / steps, dy / steps), [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone], 0.28, 0.045, 0.02);
          popX();
          popX();
        }
      }
    }
    // Ridge cap.
    place(DEPOT.ridgeX, DEPOT.ridge + 0.08, cz);
    chamferBox(gC, 0, 0, 0, 0.42, 0.05, D * 0.5, T.rustDeep, 0.012);
    popX();

    // Light shafts from the blown west wall and the missing roof, raking east across the shed.
    for (let i = 0; i < 5; i++) {
      const z = -33 + i * 4.6;
      lightShaft(DEPOT.x0 + 0.3, 4.2 + (i % 2) * 1.6, z, 2.6, 2.9, 34, 1.05);
    }
    for (let i = 0; i < 3; i++) {
      lightShaft(DEPOT.ridgeX - 4 + i * 3.5, DEPOT.ridge - 1.4, -32 + i * 4.5, 2.2, 2.0, 26, 0.8);
    }

    /* --- overhead travelling crane --------------------------------------- */

    const otcZ = -29.5;
    const railY = 6.6;
    for (let s = -1; s <= 1; s += 2) {
      const x = s < 0 ? DEPOT.x0 + 1.1 : DEPOT.x1 - 1.1;
      place(x, railY, cz);
      chamferBox(gS, 0, 0, 0, 0.16, 0.22, D * 0.5 - 1, T.steelPainted, 0.012);
      chamferBox(gR, 0, 0.28, 0, 0.055, 0.06, D * 0.5 - 1, T.rustDeep, 0.008);
      popX();
      // Corbels off each frame column.
      for (let i = 0; i < frames; i++) {
        const z = DEPOT.z0 + 1.6 + (i / (frames - 1)) * (D - 3.2);
        strut(gS, x + (s < 0 ? -0.35 : 0.35), railY - 0.3, z, x + (s < 0 ? 0.3 : -0.3), railY - 1.5, z, 0.07, T.steelPainted, 0.008);
      }
    }
    place(0, railY + 0.6, otcZ);
    const otcSpan = W - 2.2;
    for (let s = -1; s <= 1; s += 2) {
      place(DEPOT.ridgeX, 0, s * 0.75, 0, 0, Math.PI * 0.5);
      chamferBox(gS, 0, 0, 0, 0.42, 0.1, otcSpan * 0.5, T.steelPainted, 0.012);
      popX();
      for (let i = 0; i < 12; i++) {
        const x = DEPOT.x0 + 1.4 + (i / 11) * (otcSpan - 0.4);
        strut(gS, x, -0.34, s * 0.75, x + (otcSpan / 12) * (i % 2 ? -1 : 1), 0.34, s * 0.75, 0.035, T.steelPainted, 0.006);
      }
    }
    for (let s = -1; s <= 1; s += 2) {
      const x = s < 0 ? DEPOT.x0 + 1.1 : DEPOT.x1 - 1.1;
      chamferBox(gS, x, -0.55, 0, 0.35, 0.3, 1.1, T.steelPainted, 0.012);
      for (let w = -1; w <= 1; w += 2) {
        place(x, -0.62, w * 0.7, 0, 0, Math.PI * 0.5);
        tube(gR, 0.17, 0.17, 0.1, 10, T.rustDeep, true, true, 0.008);
        popX();
      }
    }
    // Crab with its hoist, parked off-centre.
    place(DEPOT.ridgeX + 4.5, -0.3, 0);
    chamferBox(gS, 0, 0, 0, 0.8, 0.12, 1.0, T.steelPainted, 0.012);
    chamferBox(gS, 0.1, 0.45, 0, 0.5, 0.34, 0.62, T.steelPainted, 0.016);
    place(-0.5, 0.2, 0, 0, 0, Math.PI * 0.5);
    tube(gS, 0.24, 0.24, 0.9, 12, T.rust, true, true, 0.01);
    popX();
    popX();
    popX();
    // The hoist chain, which sways.
    hangChain(DEPOT.ridgeX + 4.0, railY + 0.3, otcZ, 34, 1, 0.2, 0.6, 0.11);
    place(DEPOT.ridgeX + 4.0, railY + 0.3 - 34 * 0.045 - 0.16, otcZ);
    chamferBox(gR, 0, 0, 0, 0.09, 0.16, 0.07, T.rust, 0.012);
    popX();

    /* --- mezzanine + stair ------------------------------------------------ */

    const mezY = 3.55;
    const mez = { x0: DEPOT.x0 + 0.6, x1: DEPOT.x0 + 12.5, z0: DEPOT.z0 + 0.6, z1: DEPOT.z0 + 7.2 };
    place((mez.x0 + mez.x1) * 0.5, mezY, (mez.z0 + mez.z1) * 0.5);
    const mhx = (mez.x1 - mez.x0) * 0.5;
    const mhz = (mez.z1 - mez.z0) * 0.5;
    chamferBox(gS, 0, -0.05, 0, mhx, 0.05, mhz, T.steelDark, 0.01);
    for (let i = -3; i <= 3; i++) {
      chamferBox(gS, i * (mhx / 3.5), -0.24, 0, 0.05, 0.15, mhz, T.steelPainted, 0.008);
    }
    // Chequer-plate ribs.
    for (let i = 0; i < 16; i++) {
      chamferBox(gS, -mhx + (i / 15) * mhx * 2, 0.005, 0, 0.02, 0.006, mhz - 0.04, T.steelDark, 0.003);
    }
    popX();
    solidBox((mez.x0 + mez.x1) * 0.5, mezY - 0.05, (mez.z0 + mez.z1) * 0.5, mhx, 0.06, mhz, 'metal', 0, { walkTop: true });
    // Posts and handrail.
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        place((mez.x0 + mez.x1) * 0.5 + sx * (mhx - 0.15), mezY * 0.5, (mez.z0 + mez.z1) * 0.5 + sz * (mhz - 0.15));
        tube(gS, 0.07, 0.07, mezY, 8, T.steelPainted, false, false, 0.008);
        popX();
      }
    }
    place(mez.x1 - 0.08, mezY, (mez.z0 + mez.z1) * 0.5);
    handrail(gS, mhz * 2 - 0.2, T.steelPainted, -1);
    popX();
    place((mez.x0 + mez.x1) * 0.5, mezY, mez.z1 - 0.08, Math.PI * 0.5);
    handrail(gS, mhx * 2 - 0.2, T.steelPainted, -1);
    popX();
    steelStair(mez.x1 + 1.9, 0, mez.z1 - 1.4, 3.4, mezY, 1.0, Math.PI, gS);

    /* --- interior dressing ----------------------------------------------- */

    // Workbenches with a tool board and a vice.
    for (let i = 0; i < 3; i++) {
      const bx = DEPOT.x0 + 3.5 + i * 4.2;
      const bz = DEPOT.z1 - 2.4;
      const gw = G('woodPlank');
      place(bx, 0, bz);
      chamferBox(gw, 0, 0.88, 0, 1.9, 0.045, 0.42, T.woodDark, 0.012);
      for (let s = -1; s <= 1; s += 2) {
        chamferBox(gS, s * 1.75, 0.42, 0, 0.05, 0.42, 0.36, T.steelPainted, 0.01);
      }
      chamferBox(gS, 0, 0.4, -0.3, 1.7, 0.02, 0.1, T.steelPainted, 0.006);
      // Tool board.
      chamferBox(gw, 0, 1.5, -0.42, 1.85, 0.55, 0.02, T.woodDark, 0.008);
      for (let k = 0; k < 6; k++) {
        chamferBox(gS, -1.4 + k * 0.55, 1.5 - (k % 2) * 0.24, -0.38, 0.03, 0.16, 0.03, T.steelDark, 0.005);
      }
      // Vice.
      chamferBox(gS, 1.35, 1.0, 0.1, 0.16, 0.08, 0.12, T.steelDark, 0.012);
      popX();
      solidBox(bx, 0.5, bz, 1.9, 0.5, 0.45, 'wood', 0, { cover: true });
    }

    // A machine under a tarpaulin, and cable trays on the east wall.
    place(DEPOT.x1 - 5.5, 0, -34);
    chamferBox(gS, 0, 0.55, 0, 1.3, 0.55, 0.9, T.steelPainted, 0.02);
    popX();
    solidBox(DEPOT.x1 - 5.5, 0.55, -34, 1.35, 0.55, 0.95, 'metal', 0, { cover: true });
    tarp(DEPOT.x1 - 5.5, 1.16, -34, 3.4, 2.6, 0.2, 0.34, 991);

    const gConduit = G('metalPainted');
    place(DEPOT.x1 - th, 0, cz, Math.PI * 0.5);
    conduitRun(gConduit, -12, 3.1, 12, 3.1, -0.09, -6);
    conduitRun(gConduit, -6, 3.1, -6, 1.4, -0.09, undefined);
    popX();
    place(DEPOT.x0 + th, 0, cz, Math.PI * 0.5);
    conduitRun(gConduit, -13, 2.4, 4, 2.4, 0.09, 2);
    popX();
    downpipe(DEPOT.x1 + 0.28, DEPOT.z0 + 1.2, eave, Math.PI, G('metalRust'));
    downpipe(DEPOT.x1 + 0.28, DEPOT.z1 - 1.2, eave, Math.PI, G('metalRust'));
    downpipe(DEPOT.x0 - 0.28, DEPOT.z1 - 1.2, eave, 0, G('metalRust'));

    return { pit, blast, mez, otcZ };
  }

  /* ====================================================================== */
  /* 13. THE TERRACES — two-storey brick admin block                         */
  /* ====================================================================== */

  /**
   * 26 x 26 m, two floors plus an accessible roof. Blown-out windows on every face, a
   * first-floor balcony on the south elevation overlooking the yard (this is the "terrace"),
   * two stairwells, and a south-west corner brought down by a shell so that the rubble forms
   * a ramp straight from the yard onto the first floor.
   */
  function buildAdmin() {
    resetX();
    const gB = G('brickPainted');
    const gP = G('plaster');
    const gS = G('metalPainted');
    const gR = G('metalRust');
    const gCon = G('concreteRough');
    const gGl = G('glassDirty');
    const W = ADMIN.x1 - ADMIN.x0;
    const D = ADMIN.z1 - ADMIN.z0;
    const cx = (ADMIN.x0 + ADMIN.x1) * 0.5;
    const cz = (ADMIN.z0 + ADMIN.z1) * 0.5;
    const th = ADMIN.wall;
    const f1 = ADMIN.floor; // 3.6
    const f2 = ADMIN.floor * 2; // 7.2
    const slab = 0.24;

    /* --- slabs ------------------------------------------------------------ */

    const slabZones = [
      { y: f1, hole: { x0: ADMIN.x0, x1: ADMIN.x0 + 7.5, z0: ADMIN.z1 - 7.0, z1: ADMIN.z1 } },
      { y: f2, hole: { x0: cx + 2.5, x1: cx + 8.5, z0: cz - 3.0, z1: cz + 3.0 } },
    ];
    for (let k = 0; k < slabZones.length; k++) {
      const sz = slabZones[k];
      const bays = 6;
      for (let i = 0; i < bays; i++) {
        for (let j = 0; j < bays; j++) {
          const px = ADMIN.x0 + (i + 0.5) * (W / bays);
          const pz = ADMIN.z0 + (j + 0.5) * (D / bays);
          if (px > sz.hole.x0 - 0.1 && px < sz.hole.x1 && pz > sz.hole.z0 - 0.1 && pz < sz.hole.z1) continue;
          const tone = 0.85 + hash2(i + k * 13, j) * 0.24;
          place(px, sz.y, pz);
          chamferBox(gCon, 0, -slab * 0.5, 0, W / bays / 2 - 0.02, slab * 0.5, D / bays / 2 - 0.02, [T.concrete[0] * tone, T.concrete[1] * tone, T.concrete[2] * tone], 0.016);
          popX();
          solidBox(px, sz.y - slab * 0.5, pz, W / bays / 2, slab * 0.5, D / bays / 2, 'concrete', 0, { walkTop: true });
        }
      }
      // Downstand beams on the underside — a flat soffit is the giveaway of a box.
      for (let i = 1; i < 3; i++) {
        place(ADMIN.x0 + (i / 3) * W, sz.y - slab - 0.16, cz);
        chamferBox(gCon, 0, 0, 0, 0.16, 0.16, D * 0.5, T.concreteDark, 0.012);
        popX();
      }
    }

    /* --- external walls --------------------------------------------------- */

    const winRow = (yBase, count, span, wWin, hWin, skip) => {
      const ops = [];
      for (let i = 0; i < count; i++) {
        if (skip && skip.indexOf(i) >= 0) continue;
        ops.push({ x: -span * 0.5 + ((i + 0.5) / count) * span, y0: yBase, y1: yBase + hWin, w: wWin });
      }
      return ops;
    };

    const faces = [
      { name: 'south', x: cx, z: ADMIN.z1, yaw: 0, len: W },
      { name: 'north', x: cx, z: ADMIN.z0, yaw: 0, len: W },
      { name: 'east', x: ADMIN.x1, z: cz, yaw: Math.PI * 0.5, len: D },
      { name: 'west', x: ADMIN.x0, z: cz, yaw: Math.PI * 0.5, len: D },
    ];

    for (const f of faces) {
      const ops0 = winRow(0.95, 6, f.len - 1.5, 1.5, 1.85);
      const ops1 = winRow(f1 + 0.95, 6, f.len - 1.5, 1.5, 1.85);
      if (f.name === 'west') {
        ops0.length = 0;
        ops0.push({ x: -3.0, y0: 0, y1: 2.6, w: 2.6 }); // dock doorway, route two from the yard
        ops0.push({ x: 5.5, y0: 0.95, y1: 2.8, w: 1.5 });
        ops0.push({ x: 9.0, y0: 0.95, y1: 2.8, w: 1.5 });
      }
      if (f.name === 'south') {
        // The balcony doors that make this elevation the overlook.
        ops1.length = 0;
        for (let i = 0; i < 4; i++) ops1.push({ x: -8.4 + i * 5.6, y0: f1 + 0.1, y1: f1 + 2.5, w: 1.6 });
      }
      place(f.x, 0, f.z, f.yaw);
      const p0 = punchedWall(gB, f.len, 0, f1, th, ops0, T.brick, 0.02);
      const p1 = punchedWall(gB, f.len, f1, f2, th, ops1, T.brickPale, 0.02);
      // Plinth, string course at first floor, and the parapet.
      chamferBox(gCon, 0, 0.22, 0, f.len * 0.5 + 0.04, 0.22, th * 0.62, T.concreteWorn, 0.02);
      chamferBox(gCon, 0, f1 + 0.02, 0, f.len * 0.5 + 0.05, 0.09, th * 0.62, T.concreteWorn, 0.018);
      chamferBox(gB, 0, f2 + ADMIN.para * 0.5, 0, f.len * 0.5, ADMIN.para * 0.5, th * 0.7, T.brickPale, 0.02);
      chamferBox(gCon, 0, f2 + ADMIN.para + 0.05, 0, f.len * 0.5 + 0.06, 0.06, th * 0.85, T.concreteWorn, 0.02);
      for (const o of ops0) windowDress(gS, gCon, gGl, o.x, o.y0, o.y1, o.w, th, o.y0 > 0.3);
      for (const o of ops1) windowDress(gS, gCon, gGl, o.x, o.y0, o.y1, o.w, th, o.y0 > f1 + 0.5);
      // Rendered patches where the brick has spalled: plaster over brick, not a texture swap.
      for (let i = 0; i < 4; i++) {
        const px = -f.len * 0.4 + hash2(i, f.len) * f.len * 0.8;
        const py = 0.6 + hash2(i * 3, 7) * 5.4;
        chamferBox(gP, px, py, th * 0.5 + 0.012, 0.5 + hash2(i, 2) * 0.9, 0.3 + hash2(i, 5) * 0.6, 0.012, T.plaster, 0.008);
      }
      popX();
      const emitWallCol = (parts, yOff) => {
        void yOff;
        for (const p of parts) {
          if (f.yaw === 0) solidBox(f.x + p[0], p[1], f.z, p[2], p[3], th * 0.5, 'concrete', 0, { cover: p[1] < 2.2 });
          else solidBox(f.x, p[1], f.z + p[0], th * 0.5, p[3], p[2], 'concrete', 0, { cover: p[1] < 2.2 });
        }
      };
      emitWallCol(p0, 0);
      emitWallCol(p1, f1);
      if (f.yaw === 0) solidBox(f.x, f2 + ADMIN.para * 0.5, f.z, f.len * 0.5, ADMIN.para * 0.5, th * 0.6, 'concrete', 0, { cover: true });
      else solidBox(f.x, f2 + ADMIN.para * 0.5, f.z, th * 0.6, ADMIN.para * 0.5, f.len * 0.5, 'concrete', 0, { cover: true });
    }

    /* --- the balcony ------------------------------------------------------ */

    const balZ = ADMIN.z1 + 1.5;
    place(cx, f1, balZ);
    chamferBox(gCon, 0, -0.1, 0, 9.6, 0.1, 1.55, T.concreteWorn, 0.02);
    // Balustrade: a solid concrete upstand with a hardwood capping, and drainage slots.
    chamferBox(gCon, 0, 0.5, 1.45, 9.6, 0.5, 0.09, T.concrete, 0.022);
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gCon, s * 9.5, 0.5, 0.75, 0.09, 0.5, 0.78, T.concrete, 0.022);
    }
    const gw = G('woodPlank');
    chamferBox(gw, 0, 1.03, 1.45, 9.65, 0.035, 0.14, T.woodDark, 0.012);
    for (let i = -5; i <= 5; i++) {
      chamferBox(gCon, i * 1.6, 0.06, 1.45, 0.06, 0.05, 0.11, T.concreteDark, 0.006);
    }
    // Supporting brackets under the slab.
    for (let i = -4; i <= 4; i++) {
      strut(gCon, i * 2.2, -0.2, 1.3, i * 2.2, -1.3, -0.35, 0.11, T.concreteWorn, 0.014);
    }
    popX();
    solidBox(cx, f1 - 0.1, balZ, 9.6, 0.12, 1.55, 'concrete', 0, { walkTop: true });
    solidBox(cx, f1 + 0.5, balZ + 1.45, 9.6, 0.5, 0.12, 'concrete', 0, { cover: true });

    /* --- collapsed south-west corner + rubble ramp ------------------------ */

    const corner = { x0: ADMIN.x0, x1: ADMIN.x0 + 7.5, z0: ADMIN.z1 - 7.0, z1: ADMIN.z1 };
    // Broken slab edge, hanging reinforcement.
    place(corner.x1, f1 - 0.1, corner.z1 - 3.5);
    for (let i = 0; i < 6; i++) {
      place(0, 0, -3.5 + i * 1.4, 0, 0, 0.2 - i * 0.06);
      chamferBox(gCon, -0.3 - hash2(i, 1) * 0.5, 0, 0, 0.5, 0.11, 0.5, T.concreteWorn, 0.02);
      popX();
      strut(gR, -0.2, 0.02, -3.5 + i * 1.4, -1.1 - hash2(i, 9), -0.4, -3.2 + i * 1.4, 0.011, T.rustDeep, 0.003);
    }
    popX();
    // The ramp itself: a spill of slabs from the yard up to the first floor.
    solidRamp(ADMIN.x0 - 1.5, corner.z1 - 3.2, 5.4, 3.2, 0.15, f1 - 0.05, 'concrete', 0);
    solidRamp(ADMIN.x0 + 4.0, corner.z1 - 3.2, 3.2, 3.2, f1 - 0.05, f1 - 0.02, 'concrete', 0);

    /* --- stairwells -------------------------------------------------------- */

    const stairA = { x: ADMIN.x0 + 4.2, z: ADMIN.z0 + 4.2 }; // NW, runs to the roof
    const stairB = { x: ADMIN.x1 - 4.2, z: ADMIN.z1 - 4.6 }; // SE
    for (const st of [stairA, stairB]) {
      for (let lvl = 0; lvl < (st === stairA ? 2 : 1); lvl++) {
        const y = lvl * f1;
        steelStair(st.x, y, st.z - 1.6, 3.6, f1 - 0.1, 1.5, lvl % 2 ? 0 : Math.PI, gS);
        // Half-landing and its enclosing walls.
        place(st.x, y + f1 - 0.1, st.z + 1.5);
        chamferBox(gCon, 0, -0.09, 0, 1.9, 0.09, 1.4, T.concreteWorn, 0.016);
        popX();
        solidBox(st.x, y + f1 - 0.14, st.z + 1.5, 1.9, 0.1, 1.4, 'concrete', 0, { walkTop: true });
      }
      place(st.x, 0, st.z);
      chamferBox(gP, -2.3, f1, 0, 0.11, f1, 3.0, T.plaster, 0.014);
      popX();
      solidBox(st.x - 2.3, f1, st.z, 0.12, f1, 3.0, 'concrete', 0, { cover: true });
    }
    // Roof access: a stair head with a doorway.
    place(stairA.x, f2, stairA.z + 1.0);
    chamferBox(gB, 0, 1.3, 0, 2.2, 1.3, 2.0, T.brickPale, 0.02);
    chamferBox(gCon, 0, 2.68, 0, 2.35, 0.08, 2.15, T.concreteWorn, 0.018);
    popX();
    solidBox(stairA.x, f2 + 1.3, stairA.z + 1.0, 2.2, 1.3, 2.0, 'concrete', 0, { cover: true });
    steelStair(stairA.x, f1, stairA.z - 1.6, 3.6, f1 - 0.1, 1.5, Math.PI, gS);

    /* --- internal partitions ---------------------------------------------- */

    const partitions = [
      // [x, z, halfLen, alongX, y0]
      [cx, ADMIN.z0 + 7.5, W * 0.5 - 0.4, true, 0],
      [cx, ADMIN.z0 + 7.5, W * 0.5 - 0.4, true, f1],
      [ADMIN.x0 + 9.5, cz + 3.5, 6.5, false, 0],
      [ADMIN.x0 + 9.5, cz + 2.0, 8.0, false, f1],
      [ADMIN.x1 - 7.0, ADMIN.z0 + 12.0, 4.4, false, 0],
      [ADMIN.x1 - 7.0, ADMIN.z0 + 12.0, 4.4, false, f1],
      [cx + 3.0, ADMIN.z1 - 5.0, 5.0, true, f1],
    ];
    for (let i = 0; i < partitions.length; i++) {
      const [px, pz, hl, alongX, y0] = partitions[i];
      const ops = [{ x: -hl * 0.35, y0: 0, y1: 2.15, w: 1.0 }];
      if (hl > 5) ops.push({ x: hl * 0.4, y0: 0, y1: 2.15, w: 1.0 });
      // A shell has taken a bite out of one partition per floor.
      if (i % 3 === 2) ops.push({ x: 0.2 * hl, y0: 0.7, y1: 2.9, w: 2.2 });
      place(px, y0, pz, alongX ? 0 : Math.PI * 0.5);
      const parts = punchedWall(gP, hl * 2, 0, f1 - slab, 0.14, ops, T.plaster, 0.012);
      // Door linings.
      for (const o of ops) {
        if (o.y0 > 0.1) continue;
        for (let s = -1; s <= 1; s += 2) {
          chamferBox(gw, o.x + s * (o.w * 0.5 + 0.03), o.y1 * 0.5, 0, 0.03, o.y1 * 0.5, 0.1, T.woodDark, 0.008);
        }
        chamferBox(gw, o.x, o.y1 + 0.03, 0, o.w * 0.5 + 0.06, 0.03, 0.1, T.woodDark, 0.008);
      }
      popX();
      for (const p of parts) {
        if (alongX) solidBox(px + p[0], y0 + p[1], pz, p[2], p[3], 0.08, 'concrete', 0, { cover: p[1] < 2 });
        else solidBox(px, y0 + p[1], pz + p[0], 0.08, p[3], p[2], 'concrete', 0, { cover: p[1] < 2 });
      }
    }

    /* --- roof furniture ---------------------------------------------------- */

    place(cx - 6.5, f2 + 0.02, cz - 5.5);
    chamferBox(gCon, 0, 0.35, 0, 1.6, 0.35, 1.6, T.concreteWorn, 0.02);
    place(0, 1.5, 0);
    tube(gR, 1.0, 1.0, 2.0, 14, T.rust, true, false, 0.02);
    popX();
    popX();
    solidBox(cx - 6.5, f2 + 1.4, cz - 5.5, 1.1, 1.4, 1.1, 'metal', 0, { cover: true });
    for (let i = 0; i < 4; i++) {
      const vx = cx + 3 + i * 2.4;
      const vz = cz + 6.5;
      place(vx, f2, vz);
      tube(gR, 0.26, 0.26, 1.1, 10, T.rustDeep, false, false, 0.01);
      place(0, 0.7, 0);
      tube(gR, 0.34, 0.34, 0.12, 10, T.rustDeep, true, false, 0.008);
      popX();
      popX();
    }
    // Aerial mast, guyed. Reads at silhouette scale from the yard.
    place(cx + 9.5, f2 + ADMIN.para, cz - 9.0);
    tube(gR, 0.045, 0.07, 5.4, 8, T.steelPainted, true, false, 0.006);
    for (let i = 0; i < 4; i++) {
      strut(gR, 0, 1.6 + i * 0.8, 0, 0, 1.6 + i * 0.8, 0.55, 0.02, T.steelPainted, 0.004);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      strut(gR, 0, 2.0, 0, Math.cos(a) * 3.0, -ADMIN.para, Math.sin(a) * 3.0, 0.008, T.steelDark, 0.002);
    }
    popX();

    /* --- exterior detail --------------------------------------------------- */

    // Loading dock and canopy on the west face — route two between yard and terraces.
    place(ADMIN.x0 - 2.0, 0, cz - 3.0);
    chamferBox(gCon, 0, 0.55, 0, 2.0, 0.55, 3.2, T.concreteWorn, 0.025);
    for (let i = -2; i <= 2; i++) {
      chamferBox(gCon, -1.99, 0.3, i * 1.3, 0.03, 0.3, 0.09, T.concreteDark, 0.008);
    }
    popX();
    solidBox(ADMIN.x0 - 2.0, 0.55, cz - 3.0, 2.0, 0.55, 3.2, 'concrete', 0, { walkTop: true, cover: true });
    solidRamp(ADMIN.x0 - 5.4, cz - 3.0, 1.5, 1.6, 0.05, 1.05, 'concrete', Math.PI);
    place(ADMIN.x0 - 2.0, 0, cz - 3.0);
    for (let s = -1; s <= 1; s += 2) {
      place(-1.7, 1.55, s * 3.0);
      tube(gS, 0.06, 0.06, 3.1, 8, T.steelPainted, false, false, 0.008);
      popX();
    }
    place(-0.6, 3.2, 0, 0, 0, -0.16);
    corrugated(G('corrugatedSteel'), 3.4, 6.4, T.rust, 0.3, 0.035, 0.02);
    popX();
    popX();

    // Fire escape on the east face.
    steelStair(ADMIN.x1 + 1.6, 0, cz + 6.0, 3.6, f1, 1.1, -Math.PI * 0.5, gS);
    place(ADMIN.x1 + 1.6, f1, cz + 3.6);
    chamferBox(gS, 0, -0.05, 0, 1.6, 0.05, 1.4, T.steelDark, 0.01);
    popX();
    solidBox(ADMIN.x1 + 1.6, f1 - 0.05, cz + 3.6, 1.6, 0.07, 1.4, 'metal', 0, { walkTop: true });
    steelStair(ADMIN.x1 + 1.6, f1, cz + 1.2, 3.6, f1, 1.1, Math.PI * 0.5, gS);

    downpipe(ADMIN.x0 - 0.3, ADMIN.z0 + 1.0, f2 + ADMIN.para, 0, gR);
    downpipe(ADMIN.x1 + 0.3, ADMIN.z0 + 1.0, f2 + ADMIN.para, Math.PI, gR);
    downpipe(ADMIN.x1 + 0.3, ADMIN.z1 - 1.0, f2 + ADMIN.para, Math.PI, gR);
    place(ADMIN.x1 + th * 0.5, 0, cz, Math.PI * 0.5);
    conduitRun(gS, -9, 2.6, 9, 2.6, 0.1, 4);
    popX();

    // Light shafts through the west windows onto the first-floor corridor.
    for (let i = 0; i < 3; i++) {
      lightShaft(ADMIN.x0 + 0.2, f1 + 1.9, cz - 6 + i * 5.0, 1.5, 1.9, 16, 0.85);
    }
    lightShaft(ADMIN.x0 + 0.2, 1.9, cz + 5.0, 1.5, 1.9, 14, 0.7);

    return { corner, stairA, stairB, balZ };
  }

  /* ====================================================================== */
  /* 14. THE YARD                                                            */
  /* ====================================================================== */

  const set20 = inst('cont20', 'corrugatedSteel', (g) => containerGeo(g, 6.06));
  const set40 = inst('cont40', 'corrugatedSteel', (g) => containerGeo(g, 12.19));
  const setJersey = inst('jersey', 'concretePanel', jerseyGeo);
  const setDrum = inst('drum', 'metalRust', drumGeo);
  const setPallet = inst('pallet', 'woodPlank', palletGeo);
  const setSack = inst('sandbag', 'sandbag', sandbagGeo);
  const setSlab = inst('slab', 'rubble', slabGeo);
  const setBrick = inst('brick', 'brickPainted', brickGeo);

  /** Debris: a plank, a twist of sheet metal and a crushed can, scattered by the hundred. */
  const setDebris = inst('debris', 'woodPlank', (g) => {
    chamferBox(g, 0, 0.02, 0, 0.42, 0.02, 0.06, T.white, 0.006);
  });
  const setScrap = inst('scrap', 'metalRust', (g) => {
    place(0, 0, 0, 0, 0, 0.3);
    chamferBox(g, 0, 0, 0, 0.24, 0.008, 0.16, T.white, 0.004);
    popX();
    place(0.2, 0.05, 0.05, 0.6, 0, -0.5);
    chamferBox(g, 0, 0, 0, 0.16, 0.006, 0.1, T.white, 0.003);
    popX();
  });
  /** A weed tuft: crossed blades, no alpha texture needed. */
  const setWeed = inst('weed', 'dirt', (g) => {
    const r2 = mulberry32(7717);
    for (let i = 0; i < 7; i++) {
      const a = r2() * Math.PI * 2;
      const h = 0.16 + r2() * 0.26;
      const lean = 0.2 + r2() * 0.5;
      place(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, a, 0, lean);
      _bp.length = 0;
      _bp.push(-0.012, 0, 0, 0.012, 0, 0, 0.003, h, h * 0.32);
      gpoly(g, _bp, 0, 0, 1, T.weeds);
      popX();
    }
  });

  function placeContainer(x, y, z, yaw, long, tintIdx, seedN) {
    const r2 = mulberry32(seedN);
    const set = long ? set40 : set20;
    const len = long ? 12.19 : 6.06;
    const tt = CONTAINER_TINTS[tintIdx % CONTAINER_TINTS.length];
    const tone = 0.78 + r2() * 0.44;
    // Scale variation stays small so the corrugation pitch does not visibly stretch.
    const s = 0.99 + r2() * 0.02;
    addInstance(set, x, y + 1.2955, z, yaw + (r2() - 0.5) * 0.02, 0, 0, s, [tt[0] * tone, tt[1] * tone, tt[2] * tone]);
    solidBox(x, y + 1.2955, z, len * 0.5, 1.2955, 1.219, 'metal', yaw, { walkTop: true, cover: true });
  }

  /** A stack: containers laid up with a plausible offset and the odd one skewed. */
  function containerStack(x, z, yaw, spec, seedN) {
    const r2 = mulberry32(seedN);
    for (let i = 0; i < spec.length; i++) {
      const [dx, dz, tiers, long] = spec[i];
      for (let k = 0; k < tiers; k++) {
        const skew = k > 0 && r2() < 0.3 ? (r2() - 0.5) * 0.045 : 0;
        const off = k > 0 ? (r2() - 0.5) * 0.18 : 0;
        placeContainer(
          x + dx * Math.cos(yaw) + dz * Math.sin(yaw) + off,
          k * 2.591,
          z - dx * Math.sin(yaw) + dz * Math.cos(yaw),
          yaw + skew,
          long,
          (i * 3 + k * 5 + seedN) | 0,
          (seedN + i * 31 + k * 7) | 0
        );
      }
    }
  }

  function buildYard() {
    resetX();

    /* --- track ------------------------------------------------------------ */
    railRun(-50, 48, TRACK_Z[0], 101);
    railRun(-48, 50, TRACK_Z[1], 102);
    railRun(-50, 50, TRACK_Z[2], 103);
    railRun(-50, 46, TRACK_Z[3], 104);
    railRun(-46, 30, TRACK_Z[4], 105);
    // In the shed the spur runs on the floor slab and bridges the inspection pit; outside it
    // returns to ballast and dies on a buffer stop.
    railRun(DEPOT.x0 + 1.5, DEPOT.x1, SPUR_Z, 106, { ballast: false, y: -0.14, skipX: [PIT.x0, PIT.x1] });
    railRun(DEPOT.x1, -6, SPUR_Z, 107);
    bufferStop(-5.4, SPUR_Z);

    /* --- the two landmarks ------------------------------------------------- */
    buildCrane();
    buildTower();

    /* --- container stacks -------------------------------------------------- */
    // East canyon: two rows with a 4 m lane between them. The map's main north-south flank.
    containerStack(33, 6, 0, [[0, -2.9, 3, true], [0, 2.9, 2, true]], 11);
    containerStack(33, 19, 0, [[0, -2.9, 2, true], [0, 2.9, 3, true]], 12);
    containerStack(24.5, 12.5, Math.PI * 0.5, [[0, 0, 1, false]], 13);
    // West group, breaking the sightline from the depot into the yard.
    containerStack(-27, 12, 0.1, [[0, -2.8, 2, true], [0, 2.8, 1, true]], 14);
    containerStack(-27, 24, 0, [[0, 0, 2, false], [7.2, 0, 1, false]], 15);
    // Northern group, cover on the approach to the terraces.
    containerStack(16, -8, Math.PI * 0.5, [[0, 0, 2, true], [0, 2.9, 1, false]], 16);
    containerStack(6, -12, 0, [[0, 0, 1, true]], 17);
    // A toppled box lying on its side, propped by a jersey barrier.
    place(0, 0, 0);
    popX();
    addInstance(set20, -18, 1.28, 30.5, 0.35, 0, Math.PI * 0.5, 1, CONTAINER_TINTS[2]);
    solidBox(-18, 1.22, 30.5, 3.03, 1.22, 1.3, 'metal', 0.35, { cover: true, walkTop: true });

    /* --- rolling stock ------------------------------------------------------ */
    place(-2, 0, TRACK_Z[1]);
    flatbedWagon(201, true);
    popX();
    solidBox(-2, 1.0, TRACK_Z[1], 6.9, 0.75, 1.45, 'metal', 0, { cover: true, walkTop: true });

    place(13.5, 0, TRACK_Z[1]);
    flatbedWagon(202, true);
    popX();
    solidBox(13.5, 1.0, TRACK_Z[1], 6.9, 0.75, 1.45, 'metal', 0, { cover: true, walkTop: true });

    place(-21, 0, TRACK_Z[2]);
    tankWagon(203);
    popX();
    solidBox(-21, 1.7, TRACK_Z[2], 5.6, 1.7, 1.45, 'metal', 0, { cover: true });

    place(9, 0, TRACK_Z[2] + 0.0);
    boxVan(204);
    popX();
    solidBox(9, 2.1, TRACK_Z[2], 5.3, 2.1, 1.45, 'metal', 0, { cover: true });

    // A derailed flat, tipped off the rail — the yard's story in one prop.
    place(30, 0.3, TRACK_Z[3], 0.16, 0, -0.2);
    flatbedWagon(205, true);
    popX();
    solidBox(30, 1.2, TRACK_Z[3], 6.9, 1.0, 1.6, 'metal', 0.16, { cover: true });

    place(-34, 0, TRACK_Z[0]);
    boxVan(206);
    popX();
    solidBox(-34, 2.1, TRACK_Z[0], 5.3, 2.1, 1.45, 'metal', 0, { cover: true });

    /* --- the freight dock ---------------------------------------------------- */
    buildDock();

    /* --- cover, dressing and lights ------------------------------------------ */
    yardDressing();
  }

  /**
   * The freight dock closing the yard's south side: a brick-faced platform, a steel canopy
   * with half its sheets gone, a crane-loaded pallet stack and a run of jersey barriers.
   */
  function buildDock() {
    const gB = G('brickPainted');
    const gCon = G('concreteRough');
    const gS = G('metalPainted');
    const gC = G('corrugatedSteel');
    const cx = (DOCK.x0 + DOCK.x1) * 0.5;
    const cz = (DOCK.z0 + DOCK.z1) * 0.5;
    const hw = (DOCK.x1 - DOCK.x0) * 0.5;
    const hd = (DOCK.z1 - DOCK.z0) * 0.5;

    place(cx, 0, cz);
    // Brick face to the track, with engineering-brick copings and rubbed edges.
    chamferBox(gB, 0, DOCK.h * 0.5, -hd, hw, DOCK.h * 0.5, 0.18, T.brick, 0.02);
    chamferBox(gCon, 0, DOCK.h + 0.03, -hd - 0.08, hw + 0.05, 0.05, 0.28, T.concreteWorn, 0.018);
    // Platform surface in 3 m bays with real joints.
    for (let i = 0; i < 14; i++) {
      for (let j = 0; j < 3; j++) {
        const px = -hw + (i + 0.5) * (hw * 2 / 14);
        const pz = -hd + (j + 0.5) * (hd * 2 / 3);
        const tone = 0.84 + hash2(i, j) * 0.28;
        chamferBox(gCon, px, DOCK.h - 0.08, pz, (hw * 2 / 14) * 0.5 - 0.02, 0.08, (hd * 2 / 3) * 0.5 - 0.02, [T.concrete[0] * tone, T.concrete[1] * tone, T.concrete[2] * tone], 0.016);
      }
    }
    // Platform edge warning line, painted.
    chamferBox(gCon, 0, DOCK.h + 0.005, -hd + 0.62, hw - 0.1, 0.01, 0.09, T.hazard, 0.004);
    popX();
    solidBox(cx, DOCK.h * 0.5, cz, hw, DOCK.h * 0.5, hd, 'concrete', 0, { walkTop: true, cover: true });

    // Two ramps up onto the dock, at either end.
    solidRamp(DOCK.x0 - 1.8, cz - 2.0, 1.8, 2.2, 0.05, DOCK.h, 'concrete', 0);
    solidRamp(DOCK.x1 + 1.8, cz - 2.0, 1.8, 2.2, DOCK.h, 0.05, 'concrete', 0);
    place(DOCK.x0 - 1.8, 0, cz - 2.0);
    wedge(gCon, 1.8, 2.2, 0.02, DOCK.h, T.concreteWorn);
    popX();
    place(DOCK.x1 + 1.8, 0, cz - 2.0, Math.PI);
    wedge(gCon, 1.8, 2.2, 0.02, DOCK.h, T.concreteWorn);
    popX();

    // Canopy: columns, a lattice truss and sheeting with pieces missing.
    const cols = 8;
    for (let i = 0; i < cols; i++) {
      const px = DOCK.x0 + 1.6 + (i / (cols - 1)) * (DOCK.x1 - DOCK.x0 - 3.2);
      place(px, DOCK.h, cz - hd + 1.0);
      tube(gS, 0.1, 0.12, 3.6, 10, T.steelPainted, false, false, 0.01);
      place(0, 1.9, 0.6, 0, 0, -0.35);
      chamferBox(gS, 0, 0, 0, 0.05, 0.05, 0.9, T.steelPainted, 0.008);
      popX();
      popX();
      solidBox(px, DOCK.h + 1.8, cz - hd + 1.0, 0.16, 1.8, 0.16, 'metal', 0, { cover: false });
    }
    place(cx, DOCK.h + 3.7, cz - hd + 2.4, 0, 0, 0);
    place(0, 0, 0, Math.PI * 0.5);
    latticeGirder(gS, DOCK.x1 - DOCK.x0 - 2, 0.5, 3.0, 16, 0.045, 0.028, T.steelPainted);
    popX();
    popX();
    for (let i = 0; i < 20; i++) {
      if (hash2(i, 3) < 0.22) continue;
      const px = DOCK.x0 + 1 + (i + 0.5) * ((DOCK.x1 - DOCK.x0 - 2) / 20);
      const tone = 0.78 + hash2(i, 8) * 0.4;
      place(px, DOCK.h + 4.05, cz - hd + 2.4, 0, 0, -0.12);
      place(0, 0, 0, Math.PI * 0.5);
      corrugated(gC, 3.4, (DOCK.x1 - DOCK.x0 - 2) / 20, [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone], 0.3, 0.04, 0.02);
      popX();
      popX();
    }

    // A gatehouse and the rail gate at the south-east.
    place(34, 0, 36);
    chamferBox(gB, 0, 1.5, 0, 2.0, 1.5, 1.8, T.brick, 0.02);
    chamferBox(gCon, 0, 3.06, 0, 2.2, 0.08, 2.0, T.concreteWorn, 0.018);
    chamferBox(G('glassDirty'), 0, 1.85, -1.82, 1.3, 0.55, 0.02, T.glass, 0.004);
    chamferBox(gS, 0, 1.85, -1.85, 1.35, 0.03, 0.03, T.steelPainted, 0.005);
    popX();
    solidBox(34, 1.5, 36, 2.0, 1.5, 1.8, 'concrete', 0, { cover: true });
  }

  /** Everything that turns an empty yard into a place people worked and then fought over. */
  function yardDressing() {
    const gS = G('metalPainted');
    const gR = G('metalRust');

    // Sandbag emplacements, five of them, spread across the three spaces.
    sandbagWall(setSack, [[-2.4, 15.6], [2.4, 15.6], [3.4, 18.4]], 4, 501);
    sandbagWall(setSack, [[-17.5, -16.0], [-13.0, -16.0]], 4, 502);
    sandbagWall(setSack, [[26.0, ADMIN.z1 + 1.0], [31.0, ADMIN.z1 + 1.0]], 3, 503);
    sandbagWall(setSack, [[6.0, DOCK.z0 - 1.2], [11.0, DOCK.z0 - 1.2]], 3, 504);
    sandbagWall(setSack, [[-11.0, 1.5], [-11.0, 5.5]], 4, 505);
    sandbagWall(setSack, [[20.0, 26.0], [24.5, 26.0], [24.5, 29.5]], 3, 506);

    // Jersey barriers: chicanes on both flanking routes.
    const jersey = [
      [-20, -6, 0], [-16.4, -6, 0], [-12.8, -6, 0],
      [4, -6.4, 0.08], [7.6, -6.4, 0], [11.2, -6.2, -0.05],
      [18.5, 3, Math.PI * 0.5], [18.5, 6.6, Math.PI * 0.5],
      [-6, 33.5, 0], [-2.4, 33.5, 0],
      [40, 12, Math.PI * 0.5], [40, 15.6, Math.PI * 0.5],
      [-40, -6.5, 0], [-36.4, -6.6, 0.03],
    ];
    for (let i = 0; i < jersey.length; i++) {
      const [x, z, yaw] = jersey[i];
      const tone = 0.86 + hash2(i, 11) * 0.26;
      addInstance(setJersey, x, 0, z, yaw, 0, 0, 1, [T.concrete[0] * tone, T.concrete[1] * tone, T.concrete[2] * tone]);
      solidBox(x, 0.44, z, 0.32, 0.44, 1.2, 'concrete', yaw, { cover: true });
    }

    // Oil drums: clusters, some upright, some rolled over.
    const drums = [
      [-14.5, 20.5, 0], [-13.8, 21.3, 0], [-15.1, 21.5, 0], [-14.2, 22.4, 1],
      [21.5, -3.0, 0], [22.3, -3.6, 0], [21.0, -4.0, 1],
      [-44, -12.5, 0], [-43.2, -13.2, 0], [-44.4, -13.6, 0], [-42.6, -12.2, 1],
      [30.5, 30.0, 0], [31.4, 30.5, 1], [29.8, 31.0, 0],
      [-24, 3.5, 0], [-23.1, 3.0, 1],
      [12, DOCK.z0 + 2.0, 0], [12.9, DOCK.z0 + 2.4, 0],
    ];
    for (let i = 0; i < drums.length; i++) {
      const [x, z, fallen] = drums[i];
      const tone = 0.7 + hash2(i, 21) * 0.6;
      const tt = i % 3 === 0 ? T.rust : i % 3 === 1 ? T.railGreen : T.steelPainted;
      if (fallen) {
        addInstance(setDrum, x, 0.295, z, hash2(i, 3) * 6.28, Math.PI * 0.5, 0, 1, [tt[0] * tone, tt[1] * tone, tt[2] * tone]);
        solidBox(x, 0.3, z, 0.45, 0.3, 0.45, 'metal', 0, { cover: false });
      } else {
        addInstance(setDrum, x, 0, z, hash2(i, 5) * 6.28, 0, 0, 1, [tt[0] * tone, tt[1] * tone, tt[2] * tone]);
        solidBox(x, 0.45, z, 0.31, 0.45, 0.31, 'metal', 0, { cover: false });
      }
    }

    // Pallet stacks.
    const pallets = [
      [-30, 8.5, 0.2, 6], [-30.1, 9.4, 0.1, 4],
      [19.5, 21.0, 1.2, 7], [20.4, 21.6, 1.15, 3],
      [-45, -30.0, 0, 5], [-44.2, -31.0, 0.3, 8],
      [8.0, DOCK.z0 + 3.6, 0, 6], [9.3, DOCK.z0 + 3.4, 0.15, 4],
    ];
    for (let i = 0; i < pallets.length; i++) {
      const [x, z, yaw, n] = pallets[i];
      for (let k = 0; k < n; k++) {
        const tone = 0.72 + hash2(i * 7 + k, 4) * 0.5;
        addInstance(setPallet, x + (hash2(k, i) - 0.5) * 0.08, k * 0.145, z + (hash2(k, i + 9) - 0.5) * 0.08, yaw + (hash2(k, i + 3) - 0.5) * 0.06, 0, 0, 1, [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone]);
      }
      solidBox(x, n * 0.0725, z, 0.62, n * 0.0725, 0.42, 'wood', yaw, { cover: n > 4 });
    }

    // Rubble piles, tied to the damage: the depot blast hole, the admin corner, shelled walls.
    rubblePile(setSlab, setBrick, -28.5, DEPOT.z1 + 1.6, 4.2, 1.5, 601, T.concreteWorn);
    rubblePile(setSlab, setBrick, ADMIN.x0 - 1.5, ADMIN.z1 - 3.0, 5.6, 2.4, 602, T.concreteWorn);
    rubblePile(setSlab, setBrick, ADMIN.x0 + 3.5, ADMIN.z1 - 3.2, 4.4, 3.6, 603, T.concreteWorn);
    rubblePile(setSlab, setBrick, DEPOT.x0 - 2.0, -28.0, 3.4, 1.2, 604, T.concreteWorn);
    rubblePile(setSlab, setBrick, 2.0, -22.0, 3.0, 0.9, 605, T.concreteWorn);
    rubblePile(setSlab, setBrick, 44, 26.0, 3.6, 1.1, 606, T.concreteWorn);
    rubblePile(setSlab, setBrick, -8.0, 36.0, 2.6, 0.8, 607, T.concreteWorn);
    solidRamp(ADMIN.x0 + 1.0, ADMIN.z1 - 3.0, 4.5, 3.2, 0.2, 2.6, 'concrete', 0);
    solidBox(-28.5, 0.6, DEPOT.z1 + 1.6, 3.6, 0.6, 3.0, 'concrete', 0, { cover: true });
    solidBox(-8.0, 0.45, 36.0, 2.2, 0.45, 2.2, 'concrete', 0, { cover: true });
    solidBox(44, 0.55, 26.0, 3.0, 0.55, 3.0, 'concrete', 0, { cover: true });
    solidBox(2.0, 0.45, -22.0, 2.6, 0.45, 2.6, 'concrete', 0, { cover: true });

    // Burnt-out car and a second wreck by the depot apron.
    burntCar(14.5, 27.5, 0.55);
    burntCar(-24.5, -4.0, 2.3);

    // Cable ducts and kerbs along the roads.
    cableDuct(-20, -8.2, 18, -8.2, 701);
    cableDuct(DEPOT.x1 + 1.0, -14, DEPOT.x1 + 1.0, -30, 702);
    kerbRun(-21, -2.6, 19, -2.6, 1);
    kerbRun(-21, -9.4, 19, -9.4, -1);

    // Scattered debris and weeds. The single most effective anti-"empty polygon" pass.
    const r2 = mulberry32(4242);
    const debrisN = lod > 1 ? 420 : lod > 0 ? 260 : 140;
    for (let i = 0; i < debrisN; i++) {
      const x = -48 + r2() * 96;
      const z = -38 + r2() * 76;
      if (inRect(x, z, [ADMIN.x0 + 1, ADMIN.z0 + 1, ADMIN.x1 - 1, ADMIN.z1 - 1])) continue;
      const y = groundY(x, z) + 0.02;
      const tone = 0.6 + r2() * 0.6;
      if (r2() < 0.55) {
        addInstance(setDebris, x, y, z, r2() * 6.28, 0, (r2() - 0.5) * 0.25, 0.5 + r2() * 1.1, [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone]);
      } else {
        addInstance(setScrap, x, y, z, r2() * 6.28, 0, 0, 0.6 + r2() * 1.2, [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone]);
      }
    }
    const weedN = lod > 1 ? 620 : lod > 0 ? 340 : 150;
    for (let i = 0; i < weedN; i++) {
      // Weeds grow where nothing runs: between the sleepers, along walls, in the cess.
      let x;
      let z;
      const pick = r2();
      if (pick < 0.5) {
        x = -48 + r2() * 96;
        z = TRACK_Z[(r2() * TRACK_Z.length) | 0] + (r2() - 0.5) * 3.4;
      } else if (pick < 0.75) {
        x = -48 + r2() * 96;
        z = -38 + r2() * 76;
      } else {
        x = (r2() < 0.5 ? -1 : 1) * (44 + r2() * 5);
        z = -38 + r2() * 76;
      }
      if (inRect(x, z, [ADMIN.x0, ADMIN.z0, ADMIN.x1, ADMIN.z1])) continue;
      if (inRect(x, z, [DEPOT.x0, DEPOT.z0, DEPOT.x1, DEPOT.z1])) continue;
      const tone = 0.65 + r2() * 0.6;
      addInstance(setWeed, x, groundY(x, z), z, r2() * 6.28, 0, 0, 0.7 + r2() * 0.8, [T.weeds[0] * tone, T.weeds[1] * tone, T.weeds[2] * tone]);
    }

    // Floodlight masts: tall verticals that stitch the ground plane to the sky.
    for (const m of [[-30, 34.5], [26, -6.5], [44, 33]]) {
      place(m[0], 0, m[1]);
      tube(gR, 0.09, 0.16, 11.0, 10, T.steelPainted, false, false, 0.01);
      place(0, 5.5, 0);
      popX();
      place(0, 11.0, 0);
      chamferBox(gS, 0, 0.12, 0, 0.9, 0.06, 0.28, T.steelPainted, 0.01);
      for (let k = -1; k <= 1; k++) {
        place(k * 0.55, 0.32, 0, 0, 0.6);
        chamferBox(gS, 0, 0, 0, 0.24, 0.16, 0.1, T.steelDark, 0.014);
        popX();
      }
      popX();
      popX();
      solidBox(m[0], 5.5, m[1], 0.2, 5.5, 0.2, 'metal');
    }

    // Practical lights, each on a visible fixture.
    workLamp(-19.5, 3.0, -19.0, 0.4, 1.0, 'tripod');
    workLamp(ADMIN.x0 - 0.6, 3.1, (ADMIN.z0 + ADMIN.z1) * 0.5 - 3.0, Math.PI * 0.5, 0.9, 'bracket');
    workLamp(CRANE.x + 1.1, 4.2, CRANE.zB, -Math.PI * 0.5, 0.85, 'bracket');
    burningBarrel(-4.5, 19.0);

    // Chains: on the crane hook, off a container door, and by the dock canopy.
    hangChain(CRANE.x - 0.55, 6.5, CRANE.zA + (CRANE.zB - CRANE.zA) * 0.62, 26, 0.9, 0.4, 1.7, 0.13);
    hangChain(33.2, 5.0, 3.2, 22, -0.4, 0.9, 3.1, 0.09);
    hangChain(4.0, DOCK.h + 3.9, DOCK.z0 + 1.1, 18, 0.7, -0.7, 5.0, 0.07);

    // Tarpaulins over stacked freight.
    tarp(-30, 1.0, 9.0, 3.6, 3.0, 0.25, 0.3, 811);
    tarp(19.9, 1.15, 21.3, 3.2, 2.8, 1.2, 0.26, 812);
    tarp(8.5, DOCK.h + 1.0, DOCK.z0 + 3.5, 3.4, 2.6, 0.05, 0.28, 813);
  }

  /* ====================================================================== */
  /* 15. Perimeter assembly                                                  */
  /* ====================================================================== */

  function buildPerimeter() {
    resetX();
    // South: precast wall behind the dock, with the rail gate opening.
    precastWall(-50, 42, 20, 42, 3.2, 901);
    precastWall(28, 42, 50, 42, 3.2, 902);
    // Sliding rail gate, parked open against its runner.
    const gm = G('metalRust');
    place(24, 0, 42);
    for (let i = -3; i <= 3; i++) {
      place(i * 0.55, 1.4, 0);
      tube(gm, 0.035, 0.035, 2.8, 6, T.hazard, false, false, 0.006);
      popX();
    }
    chamferBox(gm, 0, 2.75, 0, 1.8, 0.06, 0.06, T.hazard, 0.008);
    chamferBox(gm, 0, 0.1, 0, 1.8, 0.05, 0.05, T.hazard, 0.008);
    popX();
    solidBox(24, 1.4, 42, 1.85, 1.4, 0.12, 'metal', 0, { cover: true });

    // West and east: embankment with chain-link on the crown.
    embankment(-50.5, -40, -50.5, 40, 3.4, 4.5, 1);
    embankment(50.5, -40, 50.5, 40, 3.0, 4.2, -1);
    fenceRun(-49.6, -38, -49.6, 40, 2.4, 921);
    fenceRun(49.6, -38, 49.6, 40, 2.4, 922);
    // North: retaining wall behind the buildings plus a service-road fence.
    precastWall(-52, -43, -20, -43, 3.0, 923);
    precastWall(18, -43, 50, -43, 3.0, 924);
    fenceRun(-20, -43, 18, -43, 2.4, 925);
    // South-east corner fence linking the wall to the embankment.
    fenceRun(50, 41.5, 40, 41.5, 2.4, 926, false);

    // A short run of fence dividing the yard from the terraces' forecourt, part-flattened.
    fenceRun(ADMIN.x0 - 9.5, -14, ADMIN.x0 - 9.5, 2, 2.0, 927, false);
  }

  /* ====================================================================== */
  /* 16. Build                                                               */
  /* ====================================================================== */

  buildGround();
  buildPerimeter();
  buildDepot();
  buildAdmin();
  buildYard();
  finishShafts();
  emitGroundCollision();
  resetX();

  /* --- merge the buckets into meshes -------------------------------------- */

  const meshes = [];
  const ownedGeometries = [];
  {
    const byMaterial = new Map();
    for (const b of bucketOrder) {
      if (!b.geo.count) continue;
      const key = `${b.tri ? 'T' : 'U'}${b.name}:${b.triScale}`;
      let list = byMaterial.get(key);
      if (!list) byMaterial.set(key, (list = []));
      list.push(b);
    }
    for (const [, list] of byMaterial) {
      const b0 = list[0];
      const material = b0.tri ? matTri(b0.name, b0.triScale) : mat(b0.name);
      const uvScale = b0.tri ? 1 : 1 / tileOf(b0.name);
      let total = 0;
      for (const b of list) total += b.geo.tris;
      const geos = list.map((b) => b.geo.build(uvScale));
      // Small material groups are cheaper as one draw call than as four cullable chunks;
      // large ones keep their chunking so the shadow cascades can reject most of the map.
      if (geos.length > 1 && total < 9000) {
        const merged = mergeGeometries(geos, false);
        if (merged) {
          for (const g of geos) g.dispose();
          geos.length = 0;
          geos.push(merged);
        }
      }
      for (const g of geos) {
        const mesh = new THREE.Mesh(g, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.name = `level:${b0.name}`;
        if (b0.name === 'glassDirty') setLayer(mesh, LAYER.NOPREPASS);
        root.add(mesh);
        meshes.push(mesh);
        ownedGeometries.push(g);
      }
    }
  }

  /* --- instanced props ------------------------------------------------------ */

  for (const [key, set] of instanceSets) {
    if (!set.items.length) {
      set.geo.dispose();
      continue;
    }
    const material = mat(set.matName);
    if (key === 'weed') material.side = THREE.DoubleSide;
    const mesh = new THREE.InstancedMesh(set.geo, material, set.items.length);
    for (let i = 0; i < set.items.length; i++) {
      const it = set.items[i];
      _animE.set(it.rx, it.ry, it.rz, 'YXZ');
      _animQ.setFromEuler(_animE);
      _animP.set(it.x, it.y, it.z);
      _animS.set(it.sx, it.sy, it.sz);
      _animM.compose(_animP, _animQ, _animS);
      mesh.setMatrixAt(i, _animM);
      _col.setRGB(it.t[0], it.t[1], it.t[2]);
      mesh.setColorAt(i, _col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (key === 'chainLink') mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `level:inst:${key}`;
    mesh.computeBoundingSphere();
    root.add(mesh);
    meshes.push(mesh);
    ownedGeometries.push(set.geo);
    set.mesh = mesh;
  }

  scene.add(root);
  root.updateMatrixWorld(true);

  /* ====================================================================== */
  /* 17. Collision broadphase — a 2 m uniform grid over the triangle soup     */
  /* ====================================================================== */

  const triangles = Float32Array.from(triList);
  const triangleSurfaces = Uint8Array.from(triSurf);
  const triCount = triangleSurfaces.length;

  const GRID_CELL = 2.0;
  const gMinX = -HALF_W - 6;
  const gMinZ = -HALF_D - 6;
  const gW = Math.ceil((HALF_W * 2 + 12) / GRID_CELL);
  const gH = Math.ceil((HALF_D * 2 + 12) / GRID_CELL);
  const gMaxX = gMinX + gW * GRID_CELL;
  const gMaxZ = gMinZ + gH * GRID_CELL;

  const cellCount = new Int32Array(gW * gH + 1);
  const triCellRange = new Int32Array(triCount * 4);

  for (let i = 0; i < triCount; i++) {
    const b = i * 9;
    let x0 = triangles[b];
    let x1 = x0;
    let z0 = triangles[b + 2];
    let z1 = z0;
    for (let k = 1; k < 3; k++) {
      const x = triangles[b + k * 3];
      const z = triangles[b + k * 3 + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const cx0 = clamp(Math.floor((x0 - gMinX) / GRID_CELL), 0, gW - 1);
    const cx1 = clamp(Math.floor((x1 - gMinX) / GRID_CELL), 0, gW - 1);
    const cz0 = clamp(Math.floor((z0 - gMinZ) / GRID_CELL), 0, gH - 1);
    const cz1 = clamp(Math.floor((z1 - gMinZ) / GRID_CELL), 0, gH - 1);
    triCellRange[i * 4] = cx0;
    triCellRange[i * 4 + 1] = cx1;
    triCellRange[i * 4 + 2] = cz0;
    triCellRange[i * 4 + 3] = cz1;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) cellCount[cz * gW + cx + 1]++;
    }
  }
  for (let i = 0; i < gW * gH; i++) cellCount[i + 1] += cellCount[i];
  const cellStart = cellCount;
  const cellItems = new Int32Array(cellStart[gW * gH]);
  const fillCursor = Int32Array.from(cellStart.subarray(0, gW * gH));
  for (let i = 0; i < triCount; i++) {
    const cx0 = triCellRange[i * 4];
    const cx1 = triCellRange[i * 4 + 1];
    const cz0 = triCellRange[i * 4 + 2];
    const cz1 = triCellRange[i * 4 + 3];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * gW + cx;
        cellItems[fillCursor[c]++] = i;
      }
    }
  }

  /** Generation stamps so a triangle spanning several cells is only tested once per ray. */
  const triStamp = new Int32Array(triCount);
  let stampGen = 0;

  /**
   * Möller-Trumbore, double sided. Double sided matters: `ballistics.findExit` relies on
   * being able to see the *back* face of a wall to measure its thickness for penetration.
   * The reported normal is the geometric one, unflipped, which is what that code tests.
   */
  function triHit(i, ox, oy, oz, dx, dy, dz, maxT) {
    const b = i * 9;
    const ax = triangles[b];
    const ay = triangles[b + 1];
    const az = triangles[b + 2];
    const e1x = triangles[b + 3] - ax;
    const e1y = triangles[b + 4] - ay;
    const e1z = triangles[b + 5] - az;
    const e2x = triangles[b + 6] - ax;
    const e2y = triangles[b + 7] - ay;
    const e2z = triangles[b + 8] - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-9 && det < 1e-9) return -1;
    const inv = 1 / det;
    const tx = ox - ax;
    const ty = oy - ay;
    const tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-6 || u > 1 + 1e-6) return -1;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t < 1e-5 || t > maxT) return -1;
    return t;
  }

  function writeNormal(i, out) {
    const b = i * 9;
    const ax = triangles[b];
    const ay = triangles[b + 1];
    const az = triangles[b + 2];
    const e1x = triangles[b + 3] - ax;
    const e1y = triangles[b + 4] - ay;
    const e1z = triangles[b + 5] - az;
    const e2x = triangles[b + 6] - ax;
    const e2y = triangles[b + 7] - ay;
    const e2z = triangles[b + 8] - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    out.normal.set(nx, ny, nz);
  }

  /**
   * Grid-marching ray cast. Allocation free: all state is in locals, the result is written
   * into a caller-supplied record that is reused across calls.
   */
  function traceInto(ox, oy, oz, dx, dy, dz, maxDist, out) {
    out.hit = false;
    out.index = -1;
    out.distance = 0;
    if (!(maxDist > 0)) return null;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 1e-9) return null;
    dx /= dl;
    dy /= dl;
    dz /= dl;

    // Clip the ray to the grid footprint in XZ so a shot from outside still works.
    let tMin = 0;
    let tMax = maxDist;
    if (Math.abs(dx) > 1e-9) {
      const t1 = (gMinX - ox) / dx;
      const t2 = (gMaxX - ox) / dx;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
    } else if (ox < gMinX || ox > gMaxX) {
      return null;
    }
    if (Math.abs(dz) > 1e-9) {
      const t1 = (gMinZ - oz) / dz;
      const t2 = (gMaxZ - oz) / dz;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
    } else if (oz < gMinZ || oz > gMaxZ) {
      return null;
    }
    if (tMax <= tMin) return null;

    stampGen++;
    const gen = stampGen;
    let best = -1;
    let bestT = tMax;

    let t = tMin + 1e-4;
    let cx = clamp(Math.floor((ox + dx * t - gMinX) / GRID_CELL), 0, gW - 1);
    let cz = clamp(Math.floor((oz + dz * t - gMinZ) / GRID_CELL), 0, gH - 1);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-9 ? GRID_CELL / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-9 ? GRID_CELL / Math.abs(dz) : Infinity;
    let tMaxX =
      Math.abs(dx) > 1e-9
        ? (gMinX + (cx + (stepX > 0 ? 1 : 0)) * GRID_CELL - ox) / dx
        : Infinity;
    let tMaxZ =
      Math.abs(dz) > 1e-9
        ? (gMinZ + (cz + (stepZ > 0 ? 1 : 0)) * GRID_CELL - oz) / dz
        : Infinity;

    // 4096 is far more cells than a 110 m map can present; it is a safety stop, not a budget.
    for (let guard = 0; guard < 4096; guard++) {
      const c = cz * gW + cx;
      const s = cellStart[c];
      const e = cellStart[c + 1];
      for (let k = s; k < e; k++) {
        const ti = cellItems[k];
        if (triStamp[ti] === gen) continue;
        triStamp[ti] = gen;
        const th2 = triHit(ti, ox, oy, oz, dx, dy, dz, bestT);
        if (th2 >= 0) {
          bestT = th2;
          best = ti;
        }
      }
      const tExit = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (best >= 0 && bestT <= tExit) break;
      if (tExit > tMax) break;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
        if (cx < 0 || cx >= gW) break;
      } else {
        cz += stepZ;
        tMaxZ += tDeltaZ;
        if (cz < 0 || cz >= gH) break;
      }
    }

    if (best < 0) return null;
    out.hit = true;
    out.index = best;
    out.distance = bestT;
    out.point.set(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
    writeNormal(best, out);
    out.surface = SURFACE_IDS[triangleSurfaces[best]] || 'concrete';
    return out;
  }

  function raycast(origin, dir, maxDist) {
    if (!origin || !dir) return null;
    return traceInto(
      origin.x,
      origin.y,
      origin.z,
      dir.x,
      dir.y,
      dir.z,
      maxDist === undefined ? 200 : maxDist,
      _hitA
    );
  }

  /**
   * Surface under a point. Probes back along the supplied normal (or straight down when none
   * is given). Uses its own hit record so it can safely be called with a live `raycast`
   * result as its argument.
   */
  function sampleSurface(point, normal) {
    if (!point) return 'gravel';
    const px = point.x;
    const py = point.y;
    const pz = point.z;
    let r = null;
    if (normal && (normal.x || normal.y || normal.z)) {
      const nx = normal.x;
      const ny = normal.y;
      const nz = normal.z;
      r = traceInto(px + nx * 0.25, py + ny * 0.25, pz + nz * 0.25, -nx, -ny, -nz, 0.55, _hitB);
    }
    if (!r) r = traceInto(px, py + 0.6, pz, 0, -1, 0, 1.6, _hitB);
    if (!r) return 'gravel';
    return r.surface;
  }

  /* ====================================================================== */
  /* 18. Nav grid, cover and spawns                                          */
  /* ====================================================================== */

  /**
   * 0.75 m cells over the playable footprint. Built by rasterising the collider AABBs rather
   * than by casting a ray per cell: 17 600 casts at load time is a visible hitch, and the
   * colliders already are the simplified world the AI should be walking on.
   *
   * Ground-level only. A 2D grid cannot express the admin block's first floor, so the AI
   * paths on the ground and reaches the upper storey by the rubble ramp and stairs, which the
   * ramp colliders make walkable in the height field.
   */
  const NAV_CELL = 0.75;
  const navOrigin = new THREE.Vector3(PLAY.minX, 0, PLAY.minZ);
  const navW = Math.ceil((PLAY.maxX - PLAY.minX) / NAV_CELL);
  const navH = Math.ceil((PLAY.maxZ - PLAY.minZ) / NAV_CELL);
  const navFloor = new Float32Array(navW * navH);
  const navWalkable = new Uint8Array(navW * navH);

  {
    const AGENT_R = 0.34;
    const HEAD = 1.8;
    const STEP = 0.45;

    // Pass one: floor heights from anything with a standable top face.
    for (let ci = 0; ci < colliders.length; ci++) {
      const c = colliders[ci];
      if (!c.walkTop || c.noNav) continue;
      const top = c.max.y;
      if (top < -2 || top > 4.6) continue;
      const ix0 = clamp(Math.floor((c.min.x - navOrigin.x) / NAV_CELL), 0, navW - 1);
      const ix1 = clamp(Math.ceil((c.max.x - navOrigin.x) / NAV_CELL), 0, navW - 1);
      const iz0 = clamp(Math.floor((c.min.z - navOrigin.z) / NAV_CELL), 0, navH - 1);
      const iz1 = clamp(Math.ceil((c.max.z - navOrigin.z) / NAV_CELL), 0, navH - 1);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const k = iz * navW + ix;
          let h = top;
          if (c.type === 'ramp') {
            // Interpolate the ramp's rise across its footprint so the slope is walkable.
            const wx = navOrigin.x + (ix + 0.5) * NAV_CELL - c.cx;
            const wz = navOrigin.z + (iz + 0.5) * NAV_CELL - c.cz;
            const cs = Math.cos(-c.yaw);
            const sn = Math.sin(-c.yaw);
            const lx = wx * cs + wz * sn;
            h = lerp(c.y0, c.y1, clamp((lx + c.hx) / (2 * c.hx), 0, 1));
          }
          if (h > navFloor[k] && h - navFloor[k] < 3.0) navFloor[k] = h;
        }
      }
    }

    // Pass two: obstruction. Anything occupying the agent's body volume blocks the cell.
    for (let k = 0; k < navW * navH; k++) navWalkable[k] = 1;
    for (let ci = 0; ci < colliders.length; ci++) {
      const c = colliders[ci];
      if (c.noNav) continue;
      const ix0 = clamp(Math.floor((c.min.x - AGENT_R - navOrigin.x) / NAV_CELL), 0, navW - 1);
      const ix1 = clamp(Math.ceil((c.max.x + AGENT_R - navOrigin.x) / NAV_CELL), 0, navW - 1);
      const iz0 = clamp(Math.floor((c.min.z - AGENT_R - navOrigin.z) / NAV_CELL), 0, navH - 1);
      const iz1 = clamp(Math.ceil((c.max.z + AGENT_R - navOrigin.z) / NAV_CELL), 0, navH - 1);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const k = iz * navW + ix;
          const f = navFloor[k];
          if (c.walkTop && Math.abs(c.max.y - f) < 0.08) continue;
          if (c.max.y <= f + STEP) continue;
          if (c.min.y >= f + HEAD) continue;
          navWalkable[k] = 0;
        }
      }
    }
    // Building interiors that no route reaches at ground level would strand a path; the depot
    // and the admin ground floor are both open, so only the outer margin needs clearing.
    for (let ix = 0; ix < navW; ix++) {
      navWalkable[ix] = 0;
      navWalkable[(navH - 1) * navW + ix] = 0;
    }
    for (let iz = 0; iz < navH; iz++) {
      navWalkable[iz * navW] = 0;
      navWalkable[iz * navW + navW - 1] = 0;
    }
  }

  const navGrid = {
    origin: navOrigin,
    cell: NAV_CELL,
    w: navW,
    h: navH,
    walkable: navWalkable,
    height: navFloor,
    /** Ground height for a world position, for the AI's foot placement. */
    heightAt(x, z) {
      const ix = clamp(Math.floor((x - navOrigin.x) / NAV_CELL), 0, navW - 1);
      const iz = clamp(Math.floor((z - navOrigin.z) / NAV_CELL), 0, navH - 1);
      return navFloor[iz * navW + ix];
    },
  };

  /* --- cover points --------------------------------------------------------- */

  /**
   * One point off the middle of each face of every collider flagged as cover, pushed out to
   * standing distance with an outward normal. Filtered against the nav grid so the AI is
   * never sent to a cover slot it cannot physically stand in.
   */
  const coverPoints = [];
  {
    const seen = new Set();
    for (let ci = 0; ci < colliders.length; ci++) {
      const c = colliders[ci];
      if (!c.cover) continue;
      const h = c.max.y - Math.max(0, c.min.y);
      if (h < 0.55) continue;
      const midY = navGrid.heightAt((c.min.x + c.max.x) * 0.5, (c.min.z + c.max.z) * 0.5);
      const faces = [
        [0, -1, (c.min.x + c.max.x) * 0.5, c.min.z],
        [0, 1, (c.min.x + c.max.x) * 0.5, c.max.z],
        [-1, 0, c.min.x, (c.min.z + c.max.z) * 0.5],
        [1, 0, c.max.x, (c.min.z + c.max.z) * 0.5],
      ];
      // Long faces get points at the thirds too, so a container wall offers a real firing line.
      const spanX = c.max.x - c.min.x;
      const spanZ = c.max.z - c.min.z;
      if (spanX > 5) {
        faces.push([0, -1, c.min.x + spanX * 0.22, c.min.z], [0, -1, c.min.x + spanX * 0.78, c.min.z]);
        faces.push([0, 1, c.min.x + spanX * 0.22, c.max.z], [0, 1, c.min.x + spanX * 0.78, c.max.z]);
      }
      if (spanZ > 5) {
        faces.push([-1, 0, c.min.x, c.min.z + spanZ * 0.22], [-1, 0, c.min.x, c.min.z + spanZ * 0.78]);
        faces.push([1, 0, c.max.x, c.min.z + spanZ * 0.22], [1, 0, c.max.x, c.min.z + spanZ * 0.78]);
      }
      for (let f = 0; f < faces.length; f++) {
        const [nx, nz, fx, fz] = faces[f];
        const px = fx + nx * 0.72;
        const pz = fz + nz * 0.72;
        if (px < PLAY.minX + 1 || px > PLAY.maxX - 1 || pz < PLAY.minZ + 1 || pz > PLAY.maxZ - 1) continue;
        const ix = Math.floor((px - navOrigin.x) / NAV_CELL);
        const iz = Math.floor((pz - navOrigin.z) / NAV_CELL);
        if (ix < 1 || iz < 1 || ix >= navW - 1 || iz >= navH - 1) continue;
        if (!navWalkable[iz * navW + ix]) continue;
        const key = `${Math.round(px * 0.7)}:${Math.round(pz * 0.7)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        coverPoints.push({
          pos: new THREE.Vector3(px, navFloor[iz * navW + ix], pz),
          // Outward from the cover: the AI wants the block between it and the threat.
          normal: new THREE.Vector3(nx, 0, nz),
          height: Math.min(h, 2.0),
        });
        if (coverPoints.length > 220) break;
      }
      if (coverPoints.length > 220) break;
    }
  }

  /* --- spawn points ---------------------------------------------------------- */

  /** Face a world point. Matches controller.js: forward is (-sin yaw, 0, -cos yaw). */
  function yawTowards(fromX, fromZ, toX, toZ) {
    return Math.atan2(-(toX - fromX), -(toZ - fromZ));
  }

  const spawnDefs = [
    [4, 27.5, 0, 6],
    [-16, 33, -6, 12],
    [30, 24, 12, 4],
    [-30, -2, -20, -18],
    [-42, -30, -28, -20],
    [40, -20, 26, -6],
    [24, -6, 10, 8],
    [-6, -12, 4, 10],
    [44, 16, 24, 12],
  ];
  const spawnPoints = spawnDefs.map(([x, z, lx, lz]) => ({
    pos: new THREE.Vector3(x, navGrid.heightAt(x, z) + 0.05, z),
    yaw: yawTowards(x, z, lx, lz),
  }));

  /* ====================================================================== */
  /* 19. Per-frame                                                           */
  /* ====================================================================== */

  const bounds = new THREE.Box3(
    new THREE.Vector3(-HALF_W - 4, -4, -HALF_D - 4),
    new THREE.Vector3(HALF_W + 4, 28, HALF_D + 4)
  );

  let clock = 0;
  const chainMesh = chainSet.mesh;
  const windDirX = 0.82;
  const windDirZ = -0.57;

  function update(dt, g) {
    if (!(dt > 0)) dt = 0;
    clock += dt;
    const t = clock;
    void g;

    /* Chains: a damped pendulum, amplitude growing towards the free end. Two frequencies so
       the swing never looks like a metronome. */
    if (chainMesh) {
      for (let ci = 0; ci < dyn.chains.length; ci++) {
        const ch = dyn.chains[ci];
        const swing = (Math.sin(t * 0.72 + ch.phase) * 0.75 + Math.sin(t * 1.31 + ch.phase * 1.7) * 0.25) * ch.amp;
        for (let i = 0; i < ch.count; i++) {
          const f = i / ch.count;
          const lag = f * f * (3 - 2 * f);
          const off = swing * lag;
          _animP.set(
            ch.x + ch.dirX * off + windDirX * off * 0.2,
            ch.y - i * ch.spacing,
            ch.z + ch.dirZ * off + windDirZ * off * 0.2
          );
          _animE.set(0, i % 2 === 0 ? 0 : Math.PI * 0.5, off * 1.4, 'YXZ');
          _animQ.setFromEuler(_animE);
          _animS.set(1, 1, 1);
          _animM.compose(_animP, _animQ, _animS);
          chainMesh.setMatrixAt(ch.start + i, _animM);
        }
      }
      chainMesh.instanceMatrix.needsUpdate = true;
    }

    /* Tarpaulins: a travelling wave over the sag, strongest at the unlashed centre. */
    for (let i = 0; i < dyn.tarps.length; i++) {
      const tp = dyn.tarps[i];
      const arr = tp.attr.array;
      const base = tp.base;
      const n = arr.length / 3;
      for (let k = 0; k < n; k++) {
        const bx = base[k * 3];
        const by = base[k * 3 + 1];
        const bz = base[k * 3 + 2];
        const edge = 1 - Math.max(Math.abs(bx) / (tp.w * 0.5), Math.abs(bz) / (tp.d * 0.5));
        const amp = Math.max(0, edge) * 0.055;
        arr[k * 3 + 1] = by + Math.sin(t * 1.9 + bx * 1.7 + bz * 1.1 + tp.phase) * amp;
        arr[k * 3] = bx + Math.sin(t * 1.4 + bz * 2.1 + tp.phase) * amp * 0.35;
      }
      tp.attr.needsUpdate = true;
    }

    /* The burning barrel: fuel-starved flicker on the light, and a flame that breathes. */
    for (let i = 0; i < dyn.flames.length; i++) {
      const fl = dyn.flames[i];
      const a = Math.sin(t * 11.3 + fl.phase) * 0.5 + Math.sin(t * 27.1 + fl.phase * 2.3) * 0.3 + Math.sin(t * 4.7) * 0.2;
      fl.light.intensity = 14 * (0.72 + a * 0.34);
      const s = 0.88 + a * 0.16;
      fl.flame.scale.set(s, 0.9 + a * 0.28, s);
      fl.flame.rotation.y = t * 0.6 + Math.sin(t * 2.7) * 0.35;
    }

    /* Work lamps: a slow mains hum on the two mains-fed fixtures, steady on the third. */
    for (let i = 0; i < dyn.lamps.length; i++) {
      const lp = dyn.lamps[i];
      if (lp.kind === 'steady') continue;
      const f = 0.94 + Math.sin(t * 6.1 + lp.phase) * 0.03 + Math.sin(t * 43.0 + lp.phase) * 0.02;
      lp.light.intensity = lp.base * f;
    }

    /* Light shafts breathe as the dust drifts through them. */
    for (let i = 0; i < dyn.shafts.length; i++) {
      dyn.shafts[i].mat.opacity = 0.44 + Math.sin(t * 0.31 + i) * 0.06;
    }
  }

  /* ====================================================================== */
  /* 20. Public object                                                       */
  /* ====================================================================== */

  function dispose() {
    scene.remove(root);
    for (const g of ownedGeometries) {
      try {
        g.dispose();
      } catch {
        /* already gone */
      }
    }
    for (const tp of dyn.tarps) {
      try {
        tp.geo.dispose();
      } catch {
        /* already gone */
      }
    }
    for (const s of dyn.shafts) {
      try {
        s.mesh.geometry.dispose();
      } catch {
        /* already gone */
      }
    }
    for (const m of ownedMaterials) {
      try {
        m.dispose();
      } catch {
        /* already gone */
      }
    }
    ownedGeometries.length = 0;
    meshes.length = 0;
    root.clear();
  }

  const level = {
    root,
    colliders,
    triangles,
    triangleSurfaces,
    spawnPoints,
    coverPoints,
    navGrid,
    bounds,
    raycast,
    sampleSurface,
    update,
    dispose,
    /** Named spaces, for the HUD's zone readout and the AI's patrol picker. */
    zones: {
      yard: { label: 'The Yard', centre: new THREE.Vector3(0, 0, 8), radius: 34 },
      depot: { label: 'The Depot', centre: new THREE.Vector3(-36, 0, -22), radius: 22 },
      terraces: { label: 'The Terraces', centre: new THREE.Vector3(34, 0, -26), radius: 20 },
    },
    stats: {
      triangles: triCount,
      colliders: colliders.length,
      draws: meshes.length,
      coverPoints: coverPoints.length,
    },
  };

  if (game && game.debug) {
    // Gated: §6 forbids console output on the shipped path.
    console.info(
      `[level] ${meshes.length} draws, ${triCount} collision tris, ${colliders.length} colliders, ${coverPoints.length} cover points`
    );
  }

  return level;
}

export default createLevel;
