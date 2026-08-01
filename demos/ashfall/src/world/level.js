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
import { PALETTE, MAP, ZONES, LIGHTING, ATMOSPHERE, SUN_AZIMUTH, SUN_ELEVATION } from './art.js';

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

/**
 * Spawns, as [x, z, lookAtX, lookAtZ]. Hoisted to module scope because the dressing pass has
 * to know where they are: §4's near-field rule means every spawn gets a deliberate occluder
 * within about three metres of it, and that can only be placed if the geometry builder and the
 * spawn table agree on one list.
 */
const SPAWN_DEFS = [
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

/**
 * Floodlight and catenary masts, as [x, z, height, kind (0 = box section, 1 = lattice),
 * armSide]. Hoisted for the same reason as `SPAWN_DEFS`: the dressing pass strings the yard's
 * overhead cabling between these, and a wire that misses its own mast head by half a metre is
 * the kind of error only a screenshot finds. One table, two consumers.
 */
const MAST_DEFS = [
  [-30, 34.5, 12.4, 0, 1.0],
  [26, -6.5, 10.2, 1, -1.0],
  [44, 33, 13.6, 0, -1.0],
  [-44, 6.5, 11.0, 1, 1.0],
  [-11.5, -25.0, 9.4, 0, 1.0],
  [40.5, -3.0, 12.8, 1, 1.0],
  [-19.5, 38.4, 10.6, 0, -1.0],
];

/**
 * A 5 x 7 stencil face, one string per glyph, rows top to bottom.
 *
 * Yards are covered in painted identification: bay numbers, road numbers, wagon codes, door
 * references. It is also the only kind of surface detail that is unambiguously *man-made*, so
 * it does more to stop a wall reading as a noise texture than any amount of extra grunge. The
 * glyphs are emitted as run-length-merged quads (about ten per character), not per pixel.
 */
const STENCIL_FONT = {
  ' ': '00000 00000 00000 00000 00000 00000 00000',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '/': '00001 00010 00010 00100 01000 01000 10000',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00110 01000 10000 11111',
  '3': '11111 00010 00100 00010 00001 10001 01110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11100 10010 10001 10001 10001 10010 11100',
  E: '11111 10000 10000 11110 10000 10000 11111',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  W: '10001 10001 10001 10101 10101 11011 10001',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
};

/** Run-length decomposition of a glyph, cached. Load-time only. */
const _glyphRuns = new Map();
function glyphRuns(ch) {
  let runs = _glyphRuns.get(ch);
  if (runs) return runs;
  runs = [];
  const rows = STENCIL_FONT[ch];
  if (rows) {
    const parts = rows.split(' ');
    for (let r = 0; r < parts.length; r++) {
      const row = parts[r];
      let c = 0;
      while (c < row.length) {
        if (row.charCodeAt(c) === 49) {
          let e = c;
          while (e + 1 < row.length && row.charCodeAt(e + 1) === 49) e++;
          runs.push(c, e + 1, r);
          c = e + 1;
        } else {
          c++;
        }
      }
    }
  }
  _glyphRuns.set(ch, runs);
  return runs;
}

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
  /**
   * Dressing tints. A tint is a *multiplier*, so a stain has to sit between the palette hue
   * and white or it turns the surface under it black rather than dirty. These three are the
   * washes the set-dressing pass paints with: rust bleeding out of a fixing, soot and diesel
   * grime, and the standing water that takes its colour from the sky it reflects.
   */
  rustWash: mixTint(grey(1), tint(PALETTE.rust, 1), 0.62),
  grime: mixTint(grey(1), grey(0.32), 0.6),
  damp: mixTint(grey(1), grey(0.32), 0.42),
  water: tint(PALETTE.skyZenith, 0.9),
  paper: tint(PALETTE.plaster, 1.18),
  paint: grey(1.55),
  scorch: grey(0.2),
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
      const ta = [nA[0] * 0.7, 0.7, nA[2] * 0.7];
      const tb = [nB[0] * 0.7, 0.7, nB[2] * 0.7];
      const ba = [nA[0] * 0.7, -0.7, nA[2] * 0.7];
      const bb = [nB[0] * 0.7, -0.7, nB[2] * 0.7];
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

  /**
   * Far-field mode. Everything emitted while this is set belongs to the backdrop beyond the
   * wire: it goes into its own chunk (the four playable quadrants would otherwise be dragged
   * out to a 500 m bounding sphere and stop culling), and the meshes it produces neither cast
   * nor receive shadows — the CSM only reaches 140 m, so a shadow pass over the town is pure
   * cost.
   */
  let farMode = false;

  function bucket(name, triplanar = false, triScale = 0) {
    const ch = farMode ? 9 : chunkHere();
    const key = `${triplanar ? 'T' : 'U'}${name}#${ch}`;
    let b = buckets.get(key);
    if (!b) {
      b = { geo: new Geo(), name, tri: triplanar, triScale, chunk: ch, far: farMode };
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
    // The box below is authored with its length running along local Z, because that is the
    // axis the corrugated side sheets want to be rotated onto. Every *caller* — the collider
    // in `placeContainer`, the across-the-width offsets in `containerStack`, the toppled box
    // in the yard — treats the length as running along local X. That disagreement is why the
    // east row rendered as one continuous corrugated ribbon with no end caps and no door
    // faces: a "row" of 12.19 m units offset by 2.9 m was laying them *through* each other
    // end to end instead of side by side. Rotate the authored box once, here, so the
    // geometry and the twenty places that position it finally agree.
    place(0, 0, 0, Math.PI * 0.5);
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
    // Yaw *then* pitch: the sheet's length has to lie along the box, its ribs point up.
    place(0, hh - 0.05, 0, Math.PI * 0.5, -Math.PI * 0.5);
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
    popX();
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
   *
   * `opts.slump` (0..1, default 0) robs bags off the *top* of the run, position by position,
   * so the crest steps up and down instead of ruling a flat line. It is top-down on purpose:
   * dropping bags at random would leave the ones above them floating, and a wall of sacks with
   * holes through the middle of it is a physics bug, not a story. A part-dismantled crest is
   * the honest way to take mass out of an emplacement that is too dense to read — and it costs
   * the emplacement no cover, because the collider is sized off the courses that remain
   * standing at the tallest point.
   */
  function sandbagWall(set, pts, courses, seedN, opts) {
    const slump = (opts && opts.slump) || 0;
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
          // Robbed after the randoms are drawn, never before: the bags that stay have to land
          // exactly where they landed in the intact wall, or the two read as different walls
          // rather than as the same one part dismantled. `hash2` and not `r2` for the same
          // reason — the crest profile must not depend on how many bags came before it.
          if (slump > 0) {
            const robbed = clamp(Math.round(slump * courses * (0.3 + 1.4 * hash2(i, s * 31 + 7))), 0, courses - 1);
            if (c >= courses - robbed) continue;
          }
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

  /**
   * A broken slab with genuine thickness. 0.20 m through the body rather than the 0.15 it
   * used to be, plus a stepped break along one edge and three bent rebar strands out of the
   * fractured face — a slab of reinforced concrete never snaps clean, and a flat wedge with a
   * blank face is the single clearest programmer-art tell in a rubble heap.
   */
  function slabGeo(g) {
    chamferBox(g, 0, 0, 0, 0.42, 0.1, 0.31, T.white, 0.03);
    // The broken edge: two smaller masses stepped off the main body, not a clean cut.
    place(0.44, -0.02, 0.09, 0.22, 0, 0.18);
    chamferBox(g, 0, 0, 0, 0.11, 0.075, 0.19, grey(0.92), 0.022);
    popX();
    place(-0.4, 0.03, -0.14, -0.3, 0.1, -0.24);
    chamferBox(g, 0, 0, 0, 0.14, 0.06, 0.13, grey(0.86), 0.02);
    popX();
    // Rebar out of the broken faces, bent. Two strands and a stub, at different angles.
    place(0.4, 0.02, 0.1, 0.4, 0.5);
    tube(g, 0.011, 0.011, 0.42, 5, T.rustDeep, false, false, 0.003);
    popX();
    place(0.36, 0.05, -0.14, -0.35, 0.9, 0.2);
    tube(g, 0.01, 0.01, 0.33, 5, T.rustDeep, false, false, 0.003);
    popX();
    place(-0.44, -0.01, 0.02, 2.7, 0.35);
    tube(g, 0.009, 0.009, 0.2, 5, T.rustDeep, false, false, 0.003);
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
  /**
   * A drift of ash and concrete dust banked around the foot of something. Twelve segments of
   * skirt with a noisy crest, laid on the triplanar dirt so it never tiles.
   *
   * §4's detail bar is broken the moment a prop meets the floor at a bare 90 degree crease:
   * real debris accumulates a fillet at its base, and without one the pile reads as geometry
   * pushed through a plane. Every rubble heap, every wall foot and every container base in the
   * map gets one of these.
   */
  function dustSkirt(cx, cz, radius, height, seedN, tintArr) {
    // Placed first so `bucket` assigns the drift to the chunk it actually sits in.
    place(cx, 0, cz);
    const g = GT('dirt', 0.35);
    const SEG = 12;
    const r2 = mulberry32(seedN);
    const inner = [];
    const outer = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const ri = radius * (0.82 + r2() * 0.16);
      const ro = ri + radius * (0.34 + r2() * 0.4);
      const h = height * (0.55 + r2() * 0.6);
      inner.push([Math.cos(a) * ri, h, Math.sin(a) * ri]);
      outer.push([Math.cos(a) * ro, 0.006, Math.sin(a) * ro]);
    }
    inner[SEG] = inner[0];
    outer[SEG] = outer[0];
    for (let i = 0; i < SEG; i++) {
      const a0 = inner[i];
      const a1 = inner[i + 1];
      const b0 = outer[i];
      const b1 = outer[i + 1];
      const tone = 0.78 + ((i * 7) % 5) * 0.06;
      const tt = tintArr
        ? [tintArr[0] * tone, tintArr[1] * tone, tintArr[2] * tone]
        : [T.dirt[0] * tone * 1.06, T.dirt[1] * tone * 1.02, T.dirt[2] * tone];
      _bp.length = 0;
      _bp.push(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], b1[0], b1[1], b1[2], b0[0], b0[1], b0[2]);
      gpoly(g, _bp, (a0[0] + b0[0]) * 0.02, 0.9, (a0[2] + b0[2]) * 0.02, tt);
    }
    popX();
  }

  /**
   * Scatter a rubble pile in three size tiers — slabs, fist-sized chunks, gravel fines —
   * with the big pieces at the base and the grading getting finer up the cone, plus a dust
   * fillet round the foot so nothing intersects the floor at a bare crease.
   *
   * `opts.density` scales all four tiers and `opts.spread` scales how far past the nominal
   * radius the finer tiers and the dust fillet throw. Both default to 1, so every pile that
   * does not pass them is bit-for-bit what it was.
   *
   * They exist because density and readability pull against each other and the balance is
   * not the same everywhere. A heap seen across the yard wants every piece it can get; a heap
   * the player is standing *in* — the depot approach pile is 2.8 m from that vantage's eye —
   * turns into one undifferentiated pale mass filling the lower third of the frame, and no
   * amount of extra rubble fixes that, because the problem is that nothing in it has a
   * silhouette the eye can name. Past a certain count the pieces stop reading as pieces.
   */
  function rubblePile(slabSet, brickSet, cx, cz, radius, height, seedN, tintBase, opts) {
    const o = opts || {};
    const dens = o.density === undefined ? 1 : o.density;
    const spread = o.spread === undefined ? 1 : o.spread;
    /*
     * `opts.clear` is `[x, z, r]`: a circle the heap is not allowed to put anything inside.
     *
     * It exists because density is the wrong control for the depot spoil and cutting it twice
     * proved that. The unreadable near field there was never a count problem — it was that the
     * heap's toe reaches the doorway the player stands in, so the *nearest* pieces sit inside a
     * metre and a half of the lens, where a single 1.5 m slab is a third of the frame and
     * overlaps everything behind it. Thinning the heap removes pieces uniformly, which takes
     * away the readable mid-ground and leaves the giants exactly where they were.
     *
     * Cutting a bite out of the side facing the door fixes the actual geometry, and it is also
     * the more honest story: a gang clearing a blocked doorway shovels the spoil back off the
     * threshold, they do not thin it evenly across the yard.
     */
    const cl = o.clear;
    const clr2 = cl ? cl[2] * cl[2] : 0;
    const inClear = (px, pz) => {
      if (!cl) return false;
      const dx = px - cl[0];
      const dz = pz - cl[1];
      return dx * dx + dz * dz < clr2;
    };
    const r2 = mulberry32(seedN);
    const nSlab = Math.round(radius * radius * (lod > 0 ? 3.2 : 1.8) * dens);
    for (let i = 0; i < nSlab; i++) {
      const a = r2() * Math.PI * 2;
      // The slab tier honours `spread` too. It used to throw to the full nominal radius while
      // every finer tier was being pulled in, which is backwards: the slabs are the pieces big
      // enough to matter at close range, so they are the ones that most need pulling in.
      const rr = Math.sqrt(r2()) * radius * spread;
      const f = 1 - rr / radius;
      const y = f * f * height * (0.35 + r2() * 0.6);
      const s = lerp(1.25, 0.55, rr / radius) * (0.7 + r2() * 0.7);
      const tone = 0.72 + r2() * 0.45;
      if (inClear(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr)) continue;
      addInstance(
        slabSet,
        cx + Math.cos(a) * rr,
        // Lifted by the slab's own half-thickness so a piece lying flat rests *on* the
        // ground rather than half through it.
        y + 0.1 * s,
        cz + Math.sin(a) * rr,
        r2() * Math.PI * 2,
        (r2() - 0.5) * 0.9,
        (r2() - 0.5) * 0.9,
        s,
        [tintBase[0] * tone, tintBase[1] * tone, tintBase[2] * tone]
      );
    }
    // Mid tier.
    const nChunk = Math.round(radius * radius * (lod > 0 ? 5 : 2.4) * dens);
    for (let i = 0; i < nChunk; i++) {
      const a = r2() * Math.PI * 2;
      const rr = Math.sqrt(r2()) * radius * 1.1 * spread;
      const f = clamp(1 - rr / radius, 0, 1);
      const y = f * f * height * (0.4 + r2() * 0.65);
      const tone = 0.68 + r2() * 0.5;
      if (inClear(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr)) continue;
      addInstance(
        chunkSet,
        cx + Math.cos(a) * rr,
        y + 0.09,
        cz + Math.sin(a) * rr,
        r2() * Math.PI * 2,
        (r2() - 0.5) * 1.4,
        (r2() - 0.5) * 1.4,
        0.75 + r2() * 0.9,
        [tintBase[0] * tone, tintBase[1] * tone, tintBase[2] * tone]
      );
    }
    const nBrick = Math.round(radius * radius * (lod > 0 ? 6 : 3) * dens);
    for (let i = 0; i < nBrick; i++) {
      const a = r2() * Math.PI * 2;
      const rr = Math.sqrt(r2()) * radius * 1.15 * spread;
      const f = clamp(1 - rr / radius, 0, 1);
      const y = f * f * height * (0.3 + r2() * 0.7);
      const tone = 0.7 + r2() * 0.5;
      if (inClear(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr)) continue;
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
    // Fines: gravel spilling well past the toe of the heap, which is what actually blends a
    // pile into the floor.
    const nFine = Math.round(radius * radius * (lod > 1 ? 9 : lod > 0 ? 5 : 2) * dens);
    for (let i = 0; i < nFine; i++) {
      const a = r2() * Math.PI * 2;
      const rr = Math.sqrt(r2()) * radius * 1.6 * spread;
      const f = clamp(1 - rr / radius, 0, 1);
      const y = f * f * height * (0.25 + r2() * 0.6);
      const tone = 0.68 + r2() * 0.55;
      if (inClear(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr)) continue;
      addInstance(
        stoneSet,
        cx + Math.cos(a) * rr,
        y + 0.02,
        cz + Math.sin(a) * rr,
        r2() * 6.28,
        (r2() - 0.5) * 1.8,
        (r2() - 0.5) * 1.8,
        0.7 + r2() * 1.2,
        [tintBase[0] * tone, tintBase[1] * tone, tintBase[2] * tone]
      );
    }
    dustSkirt(cx, cz, radius * 1.08 * spread, Math.min(0.34, height * 0.34) * spread, seedN + 77, null);
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

  /**
   * The gravel tier. One irregular chunk, instanced by the thousand: ballast on the track
   * shoulders, the fines tier on every rubble pile, and grit banked against kerbs. Eight
   * facets is enough for a stone that is never more than a few pixels across, and it is the
   * only way to give the ballast and the rubble a genuine size grading without a second
   * material.
   */
  const stoneSet = inst('stone', 'gravel', (g) => {
    const r2 = mulberry32(0x5701);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rr = 0.055 + r2() * 0.045;
      pts.push([Math.cos(a) * rr, (r2() - 0.5) * 0.02, Math.sin(a) * rr]);
    }
    const top = 0.045 + r2() * 0.03;
    const bot = -0.02 - r2() * 0.02;
    for (let i = 0; i < 6; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 6];
      const nx = (a[0] + b[0]) * 0.5;
      const nz = (a[2] + b[2]) * 0.5;
      _bp.length = 0;
      _bp.push(a[0], a[1] + bot, a[2], b[0], b[1] + bot, b[2], b[0] * 0.72, b[1] + top, b[2] * 0.72, a[0] * 0.72, a[1] + top, a[2] * 0.72);
      gpoly(g, _bp, nx, 0.42, nz, T.white);
    }
    _bp.length = 0;
    for (let i = 0; i < 6; i++) _bp.push(pts[i][0] * 0.72, pts[i][1] + top, pts[i][2] * 0.72);
    gpoly(g, _bp, 0, 1, 0, T.white);
  });

  /**
   * The mid tier: a fist-to-head sized lump of broken concrete with real thickness. Rubble
   * that is only slabs and dust has no size grading, and a heap with no grading reads as
   * intersecting cards however many pieces are in it.
   */
  const chunkSet = inst('chunk', 'rubble', (g) => {
    const r2 = mulberry32(0x5702);
    chamferBox(g, 0, 0, 0, 0.11 + r2() * 0.05, 0.085 + r2() * 0.04, 0.095 + r2() * 0.05, T.white, 0.02);
    // A broken lobe off one face, so the silhouette is not a die.
    place(0.09, 0.03, 0.05, 0.6, 0.4, 0.3);
    chamferBox(g, 0, 0, 0, 0.07, 0.05, 0.06, grey(0.9), 0.015);
    popX();
  });

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

    // Ballast: a proper trapezoidal profile, triplanar so the stones never tile.
    //
    // The crest sits 0.26 m above grade with the shoulder 0.44 m clear of the sleeper ends
    // (sleepers are 2.6 m over the ends) and a 1:2 batter down to the cess. The sleeper
    // undersides land at 0.215, i.e. 4.5 cm *inside* the crest — real sleepers are bedded into
    // the ballast rather than sitting on it, and that buried line is most of what makes track
    // read as steel on stone instead of as a stripe painted on concrete.
    const bh = 0.26;
    const hw1 = 1.74;
    const hw0 = hw1 + bh * 2.0;
    if (o.ballast !== false) {
      const gb = GT('gravel', 0.55);
      place(cxm, yOff, z);
      const p = _bp;
      const segs = Math.max(2, Math.round(len / 6));
      for (let i = 0; i < segs; i++) {
        const xa = -len * 0.5 + (i / segs) * len;
        const xb = -len * 0.5 + ((i + 1) / segs) * len;
        // The crest is not a machined line: a couple of centimetres of settlement per panel.
        const ya = bh - (fbm2(xa * 0.3 + seedN, 5.1) - 0.5) * 0.05;
        const yb = bh - (fbm2(xb * 0.3 + seedN, 5.1) - 0.5) * 0.05;
        p.length = 0;
        p.push(xa, ya, -hw1, xb, yb, -hw1, xb, yb, hw1, xa, ya, hw1);
        gpoly(gb, p, 0, 1, 0, T.gravel);
        for (let s = -1; s <= 1; s += 2) {
          p.length = 0;
          p.push(xa, ya, s * hw1, xb, yb, s * hw1, xb, 0, s * hw0, xa, 0, s * hw0);
          gpoly(gb, p, 0, 0.89, s * 0.45, [T.gravel[0] * 0.92, T.gravel[1] * 0.92, T.gravel[2] * 0.94]);
        }
      }
      popX();
      solidBox(cxm, yOff + bh * 0.5, z, len * 0.5, bh * 0.5, hw0, 'gravel', 0, { walkTop: true });
    }

    // Individual ballast stone, over the shoulder and spilling into the cess. Without this
    // the shoulder is a smooth ramp and the track has no grain at the range the player
    // actually looks at it.
    if (o.ballast !== false && lod > 0) {
      const nStone = Math.round(len * (lod > 1 ? 3.4 : 1.8));
      for (let i = 0; i < nStone; i++) {
        const sx = x0 + r2() * len;
        // Bias outward: the crest between the rails is compacted, the shoulder is loose.
        const side = r2() < 0.5 ? -1 : 1;
        const f = r2();
        const sz = z + side * lerp(hw1 * 0.5, hw0 + 0.75, f * f);
        const sy = yOff + (Math.abs(sz - z) < hw1 ? bh : lerp(bh * 0.8, 0.01, clamp((Math.abs(sz - z) - hw1) / (hw0 - hw1 + 0.75), 0, 1)));
        const tone = 0.62 + r2() * 0.6;
        addInstance(
          stoneSet,
          sx, sy, sz,
          r2() * 6.28, (r2() - 0.5) * 1.6, (r2() - 0.5) * 1.6,
          0.7 + r2() * 1.1,
          [T.gravel[0] * tone, T.gravel[1] * tone, T.gravel[2] * tone]
        );
      }
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
    solidBox(CRANE.x, CRANE.top, (CRANE.zA + CRANE.zB) * 0.5, 1.35, 1.2, (CRANE.zB - CRANE.zA + 3.6) * 0.5, 'metal', 0, { noNav: true });
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
    // Mass, not outline. The tank was 3.5 m by 5.6 m and the legs were 0.22 m sticks, which
    // at 40 m through haze resolved into a dark cylinder with nothing under it. Widening the
    // tank and building each leg as a laced pair of chords roughly triples the silhouette
    // area below the tank, which is the part that has to survive the fog for the landmark to
    // read as a structure standing on the ground.
    const tankH = 6.4;
    const tankR = 4.1;
    const legTop = H - tankH - 0.6;
    const spreadTop = 2.95;
    const spreadBot = 5.2;
    /** Half-separation of the two chords in each leg, measured tangentially. */
    const chordSep = 0.42;

    place(TOWER.x, 0, TOWER.z);
    // Footings: a stepped concrete pad with a grouted base plate and holding-down bolts.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const bx = ca * spreadBot;
      const bz = sa * spreadBot;
      const tx = ca * spreadTop;
      const tz = sa * spreadTop;
      place(bx, 0, bz, -a);
      chamferBox(gc, 0, 0.24, 0, 1.05, 0.24, 1.05, T.concreteWorn, 0.03);
      chamferBox(gc, 0, 0.56, 0, 0.78, 0.1, 0.78, T.concrete, 0.025);
      chamferBox(gm, 0, 0.68, 0, 0.62, 0.035, 0.62, T.rustDeep, 0.01);
      for (let sx = -1; sx <= 1; sx += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          chamferBox(gm, sx * 0.5, 0.73, sz * 0.5, 0.045, 0.045, 0.045, T.steelDark, 0.008);
        }
      }
      popX();
      // Two chords per leg, laced together: this is what turns a stick into a member.
      const px = -sa * chordSep;
      const pz = ca * chordSep;
      for (let s = -1; s <= 1; s += 2) {
        strut(gm, bx + s * px, 0.7, bz + s * pz, tx + s * px * 0.62, legTop, tz + s * pz * 0.62, 0.115, T.rust, 0.014);
      }
      for (let k = 0; k < 9; k++) {
        const f0 = k / 9;
        const f1 = (k + 1) / 9;
        const y0 = lerp(0.7, legTop, f0);
        const y1 = lerp(0.7, legTop, f1);
        const r0 = lerp(spreadBot, spreadTop, f0);
        const r1 = lerp(spreadBot, spreadTop, f1);
        const s0 = lerp(1, 0.62, f0);
        const s1 = lerp(1, 0.62, f1);
        strut(gm, ca * r0 - px * s0, y0, sa * r0 - pz * s0, ca * r1 + px * s1, y1, sa * r1 + pz * s1, 0.038, T.rustDeep, 0.006);
        if (k % 3 === 0) strut(gm, ca * r0 - px * s0, y0, sa * r0 - pz * s0, ca * r0 + px * s0, y0, sa * r0 + pz * s0, 0.036, T.rustDeep, 0.006);
      }
      solidBox(TOWER.x + (bx + tx) * 0.5, legTop * 0.5, TOWER.z + (bz + tz) * 0.5, 0.5, legTop * 0.5, 0.5, 'metal', 0, { cover: true });
    }
    // Four levels of cross bracing between adjacent legs, heavier than before so the frame
    // survives at range rather than dissolving into the haze.
    for (let lvl = 1; lvl <= 4; lvl++) {
      const f0 = (lvl - 1) / 4;
      const f1 = lvl / 4;
      const y0 = 0.7 + f0 * (legTop - 0.7);
      const y1 = 0.7 + f1 * (legTop - 0.7);
      const r0 = lerp(spreadBot, spreadTop, f0);
      const r1 = lerp(spreadBot, spreadTop, f1);
      for (let i = 0; i < 4; i++) {
        const a0 = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
        const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI * 0.25;
        strut(gm, Math.cos(a0) * r0, y0, Math.sin(a0) * r0, Math.cos(a1) * r1, y1, Math.sin(a1) * r1, 0.055, T.rust, 0.008);
        strut(gm, Math.cos(a1) * r0, y0, Math.sin(a1) * r0, Math.cos(a0) * r1, y1, Math.sin(a0) * r1, 0.055, T.rust, 0.008);
        strut(gm, Math.cos(a0) * r1, y1, Math.sin(a0) * r1, Math.cos(a1) * r1, y1, Math.sin(a1) * r1, 0.07, T.rust, 0.01);
      }
    }
    // Tank floor beams, cross braced, plus a ring girder the tank actually sits on.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      strut(gm, Math.cos(a) * spreadTop, legTop, Math.sin(a) * spreadTop, Math.cos(a + Math.PI) * spreadTop, legTop, Math.sin(a + Math.PI) * spreadTop, 0.12, T.rust, 0.012);
    }
    place(0, legTop + 0.24, 0);
    tube(gm, tankR * 0.92, tankR * 0.92, 0.34, 20, T.rustDeep, false, false, 0.02);
    popX();

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

    // Conical roof, vent and finial. Steeper than it was: the roof is the part of the tower
    // that sits highest in the frame, so it is the part that has to carry the silhouette.
    place(0, tankY + tankH * 0.5 + 0.85, 0);
    tube(gm, 0.4, tankR + 0.16, 1.7, 24, T.rust, true, false, 0.02);
    popX();
    place(0, tankY + tankH * 0.5 + 2.0, 0);
    tube(gm, 0.26, 0.34, 0.7, 10, T.rustDeep, true, false, 0.01);
    popX();
    // Lightning finial — twelve metres of nothing above a landmark is a wasted silhouette.
    place(0, tankY + tankH * 0.5 + 3.6, 0);
    tube(gm, 0.03, 0.05, 2.5, 6, T.steelDark, true, false, 0.006);
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
    // Downpipe from the tank to the ground, on brackets, with a swan neck off the tank floor
    // and a splash block where it lands.
    place(-spreadTop * 0.8, (walkY + 0.6) * 0.5, spreadTop * 0.8);
    tube(gm, 0.13, 0.13, walkY - 0.6, 10, T.rustDeep, false, false, 0.008);
    popX();
    for (let i = 1; i * 2.4 < walkY - 0.8; i++) {
      chamferBox(gm, -spreadTop * 0.8, i * 2.4, spreadTop * 0.8 - 0.16, 0.05, 0.05, 0.16, T.rustDeep, 0.008);
    }
    place(-spreadTop * 0.8, walkY - 0.45, spreadTop * 0.8, 0, 0.5);
    tube(gm, 0.13, 0.13, 0.7, 10, T.rustDeep, false, false, 0.008);
    popX();
    chamferBox(gc, -spreadTop * 0.8, 0.07, spreadTop * 0.8 + 0.25, 0.42, 0.07, 0.6, T.concreteWorn, 0.02);
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
      const seg = 6;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI + (s > 0 ? 0 : Math.PI);
        const a1 = ((i + 1) / seg) * Math.PI + (s > 0 ? 0 : Math.PI);
        for (let j = 0; j < 4; j++) {
          const b0 = (j / 4) * Math.PI * 2;
          const b1 = ((j + 1) / 4) * Math.PI * 2;
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
      tube(g, r, r, half * 2, 4, T.white, false, false, 0.002);
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
   * Peak opacity for a sun shaft, before the view-angle and breathing terms in `update`.
   * These are additive cards with no soft-particle depth fade, so they have to stay faint:
   * anything near the original 0.44 reads as a solid white wedge rather than lit dust.
   */
  const SHAFT_OPACITY = 0.15;
  const _shaftView = new THREE.Vector3();

  /**
   * A shaft of sun from a hole in a roof or wall. Additive, vertex-graded from bright at the
   * aperture to nothing at its far end, on the NOPREPASS layer so it cannot poison SSAO.
   * At 8° of elevation the shafts rake almost horizontally, which is exactly why the depot's
   * west wall is the one that is blown open.
   */
  const shaftGeoParts = [];
  function lightShaft(x, y, z, w, h, length, strength) {
    // Shafts must die inside the building that motivates them. At the original 26-34 m they
    // punched right out of the depot and across the open yard, where an additive card with no
    // occluder behind it is just a bright triangle pasted over the sky.
    length = Math.min(length, 13);
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
      opacity: SHAFT_OPACITY,
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
    let y = n * 0.16 + fine * 0.04;
    // Ballast shoulders shed water into shallow cess drains between the roads.
    for (let i = 0; i < TRACK_Z.length; i++) {
      const d = Math.abs(z - TRACK_Z[i]);
      if (d < 3.6) y -= (1 - d / 3.6) * 0.07;
    }
    // Collision is a flat plane at y = 0; anything outside this band would read as the player
    // hovering over the dirt or wading through it.
    return clamp(y, -0.06, 0.09);
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
  function windowDress(gFrame, gStone, gGlass, x, y0, y1, w, thick, broken, worldFn) {
    const hw = w * 0.5;
    const h = y1 - y0;
    const isDoor = y0 < 0.4;
    if (isDoor) {
      // A doorway gets a lintel, a rubbed threshold and a steel lining — never glass.
      chamferBox(gStone, x, y1 + 0.08, 0, hw + 0.12, 0.08, thick * 0.5 + 0.02, T.concreteWorn, 0.015);
      for (let s = -1; s <= 1; s += 2) {
        chamferBox(gFrame, x + s * (hw - 0.035), y0 + h * 0.5, 0, 0.035, h * 0.5, 0.03, T.steelPainted, 0.007);
      }
      chamferBox(gFrame, x, y1 - 0.035, 0, hw, 0.035, 0.03, T.steelPainted, 0.007);
      chamferBox(gStone, x, 0.02, 0, hw, 0.02, thick * 0.5 + 0.02, T.concreteDark, 0.008);
      return;
    }
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
      // Intact panes are thin, penetrable collision so a round can break through them.
      if (worldFn) worldFn(x, y0 + h * 0.5, hw - 0.04, h * 0.5 - 0.04);
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
        ops.push({ x: -3, y0: 0, y1: 2.5, w: 1.9 }); // personnel door out to the yard
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
      // Wall-local +X maps to world -Z here, so local -5 is world z = -19: the spur's line.
      const ops = [
        { x: -5, y0: 0, y1: 5.4, w: 9.6 },
        { x: 9.5, y0: 0, y1: 2.5, w: 1.9 },
        { x: -14, y0: 6.4, y1: 7.9, w: 2.2 },
        { x: 13, y0: 6.4, y1: 7.9, w: 2.2 },
      ];
      place(DEPOT.x1, 0, cz, Math.PI * 0.5);
      const pB = punchedWall(gB, D, 0, dado, th, ops, T.brick, 0.02);
      const pC = punchedWall(gC, D, dado, eave, th * 0.6, ops, T.steelPainted, 0.012);
      chamferBox(gCon, 0, dado + 0.04, 0, D * 0.5, 0.05, th * 0.55, T.concreteWorn, 0.014);
      for (const o of ops) if (o.y0 > 3) windowDress(gS, gCon, gGl, o.x, o.y0, o.y1, o.w, th, true);
      // Roller door: the curtain rolled up into its barrel, plus the guide channels.
      place(-5, 5.55, -th * 0.35, 0, 0, Math.PI * 0.5);
      tube(gR, 0.42, 0.42, 9.9, 14, T.rustDeep, false, false, 0.012, 0);
      popX();
      for (let s = -1; s <= 1; s += 2) {
        chamferBox(gR, -5 + s * 4.9, 2.7, -th * 0.3, 0.09, 2.7, 0.11, T.rustDeep, 0.01);
      }
      // Concrete threshold and the rubbed steel angle that protects it.
      chamferBox(gCon, -5, 0.06, 0, 4.9, 0.06, th * 0.6, T.concreteWorn, 0.014);
      popX();
      // A wall placed at yaw = +90 deg maps its local +X onto world -Z, so the collision
      // offsets have to be negated or every opening ends up mirrored about the centre.
      for (const p of pB) solidBox(DEPOT.x1, p[1], cz - p[0], th * 0.5, p[3], p[2], 'concrete', 0, { cover: p[1] < 2 });
      for (const p of pC) solidBox(DEPOT.x1, p[1], cz - p[0], th * 0.4, p[3], p[2], 'metal');
    }

    // West wall: torn open by the blast that took the roof, which is where the light gets in.
    {
      const ops = [
        { x: -2, y0: 1.1, y1: 7.2, w: 7.5 },
        { x: 10, y0: 5.9, y1: 7.7, w: 2.6 },
        { x: -13, y0: 5.9, y1: 7.7, w: 2.6 },
        { x: 13.5, y0: 0, y1: 2.5, w: 1.9 },
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
      for (const p of pB) solidBox(DEPOT.x0, p[1], cz - p[0], th * 0.5, p[3], p[2], 'concrete', 0, { cover: p[1] < 2 });
      for (const p of pC) solidBox(DEPOT.x0, p[1], cz - p[0], th * 0.4, p[3], p[2], 'metal');
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
          // Roll the sheet so its long axis climbs the pitch; the ribs then fall out
          // perpendicular to the roof plane rather than pointing at the sky.
          place(mxp, myp, zc, 0, 0, Math.atan2(-dx, dy));
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
    solidBox((mez.x0 + mez.x1) * 0.5, mezY - 0.05, (mez.z0 + mez.z1) * 0.5, mhx, 0.06, mhz, 'metal');
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
        ops0.push({ x: 3.0, y0: 0, y1: 2.9, w: 2.8 }); // dock doorway, route two from the yard
        ops0.push({ x: -4.5, y0: 0.95, y1: 2.8, w: 1.5 });
        ops0.push({ x: -9.0, y0: 0.95, y1: 2.8, w: 1.5 });
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
      for (const o of ops0) {
        windowDress(gS, gCon, gGl, o.x, o.y0, o.y1, o.w, th, o.y0 > 0.3, (lx, ly, lhw, lhh) => {
          if (f.yaw === 0) solidBox(f.x + lx, ly, f.z, lhw, lhh, 0.02, 'glass');
          else solidBox(f.x, ly, f.z - lx, 0.02, lhh, lhw, 'glass');
        });
      }
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
          else solidBox(f.x, p[1], f.z - p[0], th * 0.5, p[3], p[2], 'concrete', 0, { cover: p[1] < 2.2 });
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
      // Three of the eleven slots are lifted clear of the slab edge and given a projecting
      // spout. At 0.06 they sit behind the slab's own shadow line and are invisible from the
      // yard, which is what left the balustrade reading as one unbroken 19 m band.
      const spout = i === -3 || i === 0 || i === 3;
      chamferBox(gCon, i * 1.6, spout ? 0.14 : 0.06, 1.45, 0.06, 0.05, 0.11, T.concreteDark, 0.006);
      if (spout) chamferBox(gCon, i * 1.6, 0.14, 1.56, 0.09, 0.05, 0.12, T.concreteWorn, 0.008);
    }
    /**
     * Supporting brackets under the slab.
     *
     * They used to run from the slab down to local z = -0.35, which is 0.95 m short of the
     * wall — nine concrete struts terminating in open air under a cantilever. The wall's outer
     * face is at world z = ADMIN.z1 + ADMIN.wall * 0.5, which in this frame is `zWall`.
     *
     * Simply stretching the old strut to the wall would give a 1.1 m drop over a 2.5 m run,
     * i.e. a 24-degree diagonal, which is a prop leaning on a building rather than a bracket
     * carrying one. The head is pulled inboard to 0.85 m out from the wall instead, so the
     * same 0.95 m drop makes a 48-degree bracket, and the foot runs 0.06 m into the brick so
     * no seam shows at the bearing.
     */
    const zWall = ADMIN.wall * 0.5 - 1.5;
    for (let i = -4; i <= 4; i++) {
      // These are structural: identical geometry on a constant 2.2 m centre is *correct*, and
      // jittering the angle or the spacing would read as subsidence, not as variation. Only
      // the concrete tone moves, the way the floor-slab bays above already do.
      const tone = 0.9 + hash2(i + 7, 3) * 0.2;
      const tt = [T.concreteWorn[0] * tone, T.concreteWorn[1] * tone, T.concreteWorn[2] * tone];
      strut(gCon, i * 2.2, -0.2, zWall + 0.85, i * 2.2, -1.15, zWall - 0.06, 0.11, tt, 0.014);
      // The bearing the foot now needs: a cast-in corbel pad standing proud of the wall face,
      // deep enough that the end of the strut is inside it rather than butted against brick.
      chamferBox(gCon, i * 2.2, -1.15, zWall + 0.02, 0.22, 0.13, 0.11, tt, 0.012);
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
      const ops = [{ x: -hl * 0.35, y0: 0, y1: 2.35, w: 2.0 }];
      if (hl > 5) ops.push({ x: hl * 0.4, y0: 0, y1: 2.35, w: 2.0 });
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
        else solidBox(px, y0 + p[1], pz - p[0], 0.08, p[3], p[2], 'concrete', 0, { cover: p[1] < 2 });
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
    place(ADMIN.x0 - 2.0, 0, cz + 4.2);
    chamferBox(gCon, 0, 0.55, 0, 2.0, 0.55, 3.2, T.concreteWorn, 0.025);
    for (let i = -2; i <= 2; i++) {
      chamferBox(gCon, -1.99, 0.3, i * 1.3, 0.03, 0.3, 0.09, T.concreteDark, 0.008);
    }
    popX();
    solidBox(ADMIN.x0 - 2.0, 0.55, cz + 4.2, 2.0, 0.55, 3.2, 'concrete', 0, { walkTop: true, cover: true });
    solidRamp(ADMIN.x0 - 5.4, cz + 4.2, 1.5, 1.6, 0.05, 1.05, 'concrete', Math.PI);
    place(ADMIN.x0 - 2.0, 0, cz + 4.2);
    for (let s = -1; s <= 1; s += 2) {
      place(-1.7, 1.55, s * 3.0);
      tube(gS, 0.06, 0.06, 3.1, 8, T.steelPainted, false, false, 0.008);
      popX();
    }
    place(-0.6, 3.2, 0, 0, -Math.PI * 0.5 + 0.16, 0);
    corrugated(G('corrugatedSteel'), 3.4, 6.4, T.rust, 0.3, 0.035, 0.02);
    popX();
    popX();

    // Fire escape on the east face.
    steelStair(ADMIN.x1 + 1.6, 0, cz + 6.0, 3.6, f1, 1.1, -Math.PI * 0.5, gS);
    place(ADMIN.x1 + 1.6, f1, cz + 3.6);
    chamferBox(gS, 0, -0.05, 0, 1.6, 0.05, 1.4, T.steelDark, 0.01);
    popX();
    solidBox(ADMIN.x1 + 1.6, f1 - 0.05, cz + 3.6, 1.6, 0.07, 1.4, 'metal');
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
    plainBox(g, 0, 0.02, 0, 0.42, 0.02, 0.06, T.white);
  });
  const setScrap = inst('scrap', 'metalRust', (g) => {
    place(0, 0, 0, 0, 0, 0.3);
    plainBox(g, 0, 0, 0, 0.24, 0.008, 0.16, T.white);
    popX();
    place(0.2, 0.05, 0.05, 0.6, 0, -0.5);
    plainBox(g, 0, 0, 0, 0.16, 0.006, 0.1, T.white);
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

  /**
   * One box. `opts.flip` turns it end for end so the door leaves, lock rods and hinges face
   * the sightline the caller cares about — a run with no door end anywhere in view carries no
   * scale cue at all, because plain corrugation could be 1.7 m or 2.6 m tall.
   */
  /** A scrap tyre. Lies flat, leans on a stack, or props against a wall. */
  const setTyre = inst('tyre', 'metalRust', (g) => {
    torus(g, 0.4, 0.135, 10, 5, T.white);
    // A wheel rim in a third of them reads as a bogie tyre rather than a rubber ring.
    place(0, 0, 0);
    tube(g, 0.19, 0.19, 0.13, 8, grey(0.62), true, true, 0.01);
    popX();
  });

  /** A traffic cone: the one bit of hazard colour that can be dropped anywhere. */
  const setCone = inst('cone', 'metalPainted', (g) => {
    chamferBox(g, 0, 0.025, 0, 0.19, 0.025, 0.19, T.steelDark, 0.012);
    place(0, 0.34, 0);
    tube(g, 0.035, 0.135, 0.62, 8, T.hazard, true, false, 0.012);
    popX();
    place(0, 0.42, 0);
    tube(g, 0.1, 0.115, 0.13, 8, grey(1.3), false, false, 0.008);
    popX();
  });

  function placeContainer(x, y, z, yaw, long, tintIdx, seedN, opts) {
    const o = opts || {};
    const r2 = mulberry32(seedN);
    const set = long ? set40 : set20;
    const len = long ? 12.19 : 6.06;
    const tt = CONTAINER_TINTS[tintIdx % CONTAINER_TINTS.length];
    const tone = 0.78 + r2() * 0.44;
    // Scale variation stays small so the corrugation pitch does not visibly stretch.
    const s = 0.99 + r2() * 0.02;
    // +-2 degrees. A box is set down by a reach stacker, never by a for-loop, and a run laid
    // true is exactly what produces the dead-straight top edge across a whole frame.
    const skew = (r2() - 0.5) * 0.07 + (o.skew || 0);
    addInstance(set, x, y + 1.2955, z, yaw + skew + (o.flip ? Math.PI : 0), 0, 0, s, [tt[0] * tone, tt[1] * tone, tt[2] * tone]);
    solidBox(x, y + 1.2955, z, len * 0.5, 1.2955, 1.219, 'metal', yaw, { cover: true });
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
          (seedN + i * 31 + k * 7) | 0,
          { flip: ((i + k) & 1) === 0 }
        );
      }
    }
  }

  /**
   * A run of boxes laid end to end along `yaw`, as discrete 6.06 / 12.19 m units.
   *
   * `spec` is `[long, tiers, gapAfter]` per unit, so the height steps along the run and the
   * gaps become lanes. §4's brief asks for stacks that break sightlines; a wall that is the
   * same height for forty metres breaks the sightline but reads as a fence, and a top edge
   * that steps four or five times over the same run reads as freight.
   */
  function containerRun(x, z, yaw, spec, seedN, opts) {
    const o = opts || {};
    const r2 = mulberry32(seedN);
    const dx = Math.cos(yaw);
    const dz = -Math.sin(yaw);
    let cursor = 0;
    for (let i = 0; i < spec.length; i++) {
      const long = spec[i][0];
      const tiers = spec[i][1];
      const gapAfter = spec[i][2] || 0;
      const len = long ? 12.19 : 6.06;
      const c = cursor + len * 0.5;
      // One unit per run is set down properly off square, which is the detail that stops the
      // eye reading the whole line as a single extrusion.
      const badUnit = i === (seedN % Math.max(1, spec.length));
      for (let k = 0; k < tiers; k++) {
        const jl = (r2() - 0.5) * (k ? 0.4 : 0.24);
        const jt = (r2() - 0.5) * (k ? 0.3 : 0.18);
        placeContainer(
          x + dx * (c + jl) - dz * jt,
          k * 2.591,
          z + dz * (c + jl) + dx * jt,
          yaw,
          long,
          (seedN * 5 + i * 3 + k * 7) | 0,
          (seedN + i * 31 + k * 13) | 0,
          {
            flip: o.doors === undefined ? ((i + k) & 1) === 0 : !!o.doors,
            skew: badUnit && k === tiers - 1 ? 0.055 : 0,
          }
        );
      }
      // Ash drifts into the lee of every base course: overlapping fillets down the flank, not
      // one ring, because the box is long and thin and a ring would read as a puddle.
      const drifts = long ? 4 : 2;
      for (let d = 0; d < drifts; d++) {
        const cd = cursor + ((d + 0.5) / drifts) * len;
        dustSkirt(x + dx * cd, z + dz * cd, 1.55, 0.18, seedN * 7 + i * 5 + d, null);
      }
      cursor += len + gapAfter;
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
    // Rows sit on the 8 m midlines between the running tracks (z = 2, 10, 18, 26) — a 12 m
    // box centred there clears both ballast shoulders by a metre, which is the only way to
    // lay freight along the yard without it standing on the track it was unloaded from.
    //
    // Each row is a sequence of discrete units with the stack height stepping 3/1/2 or 2/1/3
    // along it and one or two deliberate gaps forming cross lanes. Door ends alternate, so
    // whichever way the row is approached there is a door face, a lock rod and a corner
    // casting in view to carry the scale.
    containerRun(21.0, 2.0, 0, [[true, 3, 1.6], [false, 2, 0], [false, 1, 0]], 11, { doors: false });
    containerRun(21.0, 10.0, 0, [[false, 2, 0], [true, 1, 2.2], [false, 3, 0]], 12, { doors: true });
    containerRun(20.5, 18.0, 0, [[false, 1, 0], [true, 2, 1.4]], 13, { doors: true });
    containerRun(20.5, 26.0, 0, [[true, 3, 1.4], [false, 2, 0]], 14, { doors: false });
    // West group, breaking the sightline from the depot into the yard.
    containerRun(-40.0, 10.0, 0.02, [[true, 2, 1.5], [false, 1, 0]], 15);
    containerRun(-38.0, 26.0, -0.03, [[false, 3, 1.2], [true, 1, 0]], 16, { doors: true });
    // A genuine two-wide block by the west wall: boxes butted across their width, which
    // silhouettes quite differently from a single-file row.
    containerStack(-38, 34, 0.06, [[0, -1.3, 2, false], [0, 1.3, 1, false]], 19);
    // Northern group, cover on the approach to the terraces. Turned across the yard so its
    // end grain reads against the east-west rows.
    containerRun(10.5, -16.0, Math.PI * 0.5, [[true, 2, 1.4], [false, 1, 0]], 17, { doors: false });
    containerRun(1.0, -12.0, 0, [[true, 1, 0], [false, 2, 0]], 18, { doors: true });
    // A toppled box lying on its side, rolled about its own long axis.
    addInstance(set20, -18, 1.219, 33.6, 0.35, Math.PI * 0.5, 0, 1, CONTAINER_TINTS[2]);
    solidBox(-18, 1.219, 33.6, 3.03, 1.22, 1.3, 'metal', 0.35, { cover: true });
    dustSkirt(-18, 33.6, 3.4, 0.24, 1801, null);

    /* --- rolling stock ------------------------------------------------------ */
    place(-2, 0, TRACK_Z[1]);
    flatbedWagon(201, true);
    popX();
    solidBox(-2, 1.0, TRACK_Z[1], 6.9, 0.75, 1.45, 'metal', 0, { cover: true });

    place(13.5, 0, TRACK_Z[1]);
    flatbedWagon(202, true);
    popX();
    solidBox(13.5, 1.0, TRACK_Z[1], 6.9, 0.75, 1.45, 'metal', 0, { cover: true });

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
    const gR = G('metalRust');
    const cx = (DOCK.x0 + DOCK.x1) * 0.5;
    const cz = (DOCK.z0 + DOCK.z1) * 0.5;
    const hw = (DOCK.x1 - DOCK.x0) * 0.5;
    const hd = (DOCK.z1 - DOCK.z0) * 0.5;

    place(cx, 0, cz);
    /**
     * The brick face to the track: 42 m of it, the largest single plane in the map, which §4
     * forbids being bare and unbroken. It is now bayed by piers at 5.7 m centres.
     *
     * The panel itself stays exactly on its original plane rather than being recessed. Every
     * stencil, rust wash and pock mark `dressWalls` paints on this face is authored at zOff
     * 0.19 from DOCK.z0, i.e. 0.01 m proud of the panel's outer skin — pushing the panel back
     * would leave all of them floating in front of it. So the relief is made the other way
     * round: the panel holds its plane and the piers stand 0.24 m proud of it, which reads
     * identically and keeps the existing dressing glued down.
     *
     * Pier centres are the midpoints between the seven bay numerals (dock-local x = -17.2 +
     * i * 5.7) plus both ends, so a pier can never land on a stencil.
     */
    /**
     * The bricked-up opening sits in the bay between the piers at -14.35 and -8.65. -12.75
     * rather than the bay centre because the recess has to miss everything `dressWalls`
     * already paints on this plane: the bay numeral at -11.5, the coping run-off wash at -9.9
     * and the fixing wash at -13.84 would all be left floating 0.12 m in front of it.
     */
    const doorX = -12.75;
    const doorHW = 0.5;
    const doorTop = 0.92;
    const doorLin = 0.13; // lintel depth, so the head of the opening reads as built, not cut
    // Panel, split either side of the opening. Left run, then right run.
    chamferBox(gB, (-hw + doorX - doorHW) * 0.5, DOCK.h * 0.5, -hd, (doorX - doorHW + hw) * 0.5, DOCK.h * 0.5, 0.18, T.brick, 0.02);
    chamferBox(gB, (doorX + doorHW + hw) * 0.5, DOCK.h * 0.5, -hd, (hw - doorX - doorHW) * 0.5, DOCK.h * 0.5, 0.18, T.brick, 0.02);
    // Spandrel over the lintel, so the opening is a hole through the wall rather than a notch.
    chamferBox(gB, doorX, (doorTop + doorLin + DOCK.h) * 0.5, -hd, doorHW, (DOCK.h - doorTop - doorLin) * 0.5, 0.18, T.brick, 0.02);
    // The infill: later, paler brick set 0.12 back in the reveal, under a concrete lintel. One
    // asymmetric event on a face that is otherwise a rhythm — this is what stops it repeating.
    chamferBox(gB, doorX, doorTop * 0.5, -hd + 0.06, doorHW - 0.01, doorTop * 0.5, 0.12, T.brickPale, 0.012);
    chamferBox(gCon, doorX, doorTop + doorLin * 0.5, -hd - 0.06, doorHW + 0.12, doorLin * 0.5, 0.18, T.concreteWorn, 0.012);
    // Piers: 0.56 m wide, 0.24 m proud, one per bay. Tone varies per pier — the only variation
    // a structural rhythm is allowed, since jittering the spacing would read as subsidence.
    for (let i = 0; i < 8; i++) {
      const px = -20.05 + i * 5.7; // -20.05 .. 19.85 on 5.7 m centres
      const tone = 0.9 + hash2(i, 21) * 0.2;
      chamferBox(gB, px, DOCK.h * 0.5, -hd - 0.12, 0.28, DOCK.h * 0.5, 0.3, [T.brick[0] * tone, T.brick[1] * tone, T.brick[2] * tone], 0.02);
    }
    // Coping, pushed out and deepened so it oversails the piers by 0.10 instead of being
    // punched through by them, and still covers the back of the panel.
    chamferBox(gCon, 0, DOCK.h + 0.03, -hd - 0.16, hw + 0.05, 0.05, 0.36, T.concreteWorn, 0.018);
    /**
     * Trackside cable trough at the foot of the wall, continuous, with segmented lids so the
     * top edge reads as precast units rather than one extrusion. Kept to 0.33 m tall so it
     * clears the bottom of the painted bay numerals at y 0.38.
     *
     * Deliberately *not* in the collision set: it stands in the track lane, and giving it
     * cover/step collision would snag AI pathing against the dock exclusion in `walkableAt`.
     */
    chamferBox(gCon, 0, 0.14, -hd - 0.34, hw, 0.14, 0.16, T.concreteWorn, 0.02);
    for (let i = 0; i < 28; i++) {
      const px = -hw + (i + 0.5) * (hw * 2 / 28);
      const tone = 0.86 + hash2(i, 23) * 0.26;
      chamferBox(gCon, px, 0.3, -hd - 0.34, (hw * 2 / 28) * 0.5 - 0.03, 0.03, 0.17, [T.concrete[0] * tone, T.concrete[1] * tone, T.concrete[2] * tone], 0.012);
    }
    // Weep pipes at 3 m centres, laid along local Z so 0.04 m of each one stands out of the
    // brick. They sit clear of both the numerals and the piers by construction.
    for (let i = 0; i < 14; i++) {
      const px = -hw + 1.5 + i * 3.0;
      place(px, 0.5, -hd - 0.11, 0, Math.PI * 0.5);
      tube(gR, 0.035, 0.035, 0.22, 6, T.rustDeep, false, false, 0.006);
      popX();
    }
    // The staining under each weep. `rustWash` draws in local XY facing +Z and this face looks
    // down -Z, so the streaks need the face's own frame, turned through PI like `dressWalls`.
    place(0, 0, -hd - 0.18, Math.PI);
    for (let i = 0; i < 14; i++) {
      rustWash(gB, hw - 1.5 - i * 3.0, 0.44, 0.42, 0.13, 3, 0.012, T.rustWash, 8790 + i);
    }
    popX();
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
    /**
     * Truss soffit. The girder is centred at DOCK.h + 3.7 and `latticeGirder` reads its third
     * argument as the *full* depth, so its bottom chords are at DOCK.h + 3.45 — not
     * DOCK.h + 3.2, which is what the half-depth reads as if you take `depth` for a half
     * extent. The column length is derived from it rather than written out, so the two cannot
     * drift apart again.
     */
    const colTop = DOCK.h + 3.7 - 0.5 * 0.5;
    const colH = colTop - DOCK.h;
    const colY = DOCK.h + colH * 0.5;
    for (let i = 0; i < cols; i++) {
      const px = DOCK.x0 + 1.6 + (i / (cols - 1)) * (DOCK.x1 - DOCK.x0 - 3.2);
      /**
       * `tube` centres on the local origin, so the old call — origin on the deck, height 3.6 —
       * buried 1.8 m of column inside the platform and stopped the visible part well short of
       * the truss. The frame is now the column's mid-height, so it runs deck to soffit.
       */
      place(px, colY, cz - hd + 1.0);
      tube(gS, 0.1, 0.12, colH, 12, T.steelPainted, false, false, 0.01);
      // Base: pad, grouted plate, holding-down bolts — the triple every mast base carries, at
      // canopy-column scale. Nothing vertical in this map meets a floor at a bare cylinder.
      const yBase = DOCK.h - colY;
      chamferBox(gCon, 0, yBase + 0.06, 0, 0.28, 0.06, 0.28, T.concreteWorn, 0.014);
      chamferBox(gS, 0, yBase + 0.145, 0, 0.21, 0.025, 0.21, T.steelDark, 0.008);
      for (let sx = -1; sx <= 1; sx += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          chamferBox(gS, sx * 0.15, yBase + 0.2, sz * 0.15, 0.026, 0.03, 0.026, T.steelDark, 0.005);
        }
      }
      // External cable duct up one face, on saddles. This is what actually stops the column
      // reading as a primitive: a smooth extruded cylinder has no silhouette to catch the sun.
      chamferBox(gS, 0.12, 0, 0, 0.035, colH * 0.47, 0.06, T.steelDark, 0.006);
      for (let k = -1; k <= 1; k += 2) {
        chamferBox(gS, 0.12, k * colH * 0.29, 0, 0.055, 0.03, 0.075, T.steelDark, 0.004);
      }
      // Cap plate where the column meets the near bottom chord.
      chamferBox(gS, 0, colH * 0.5 - 0.025, 0, 0.16, 0.025, 0.16, T.steelDark, 0.008);
      /**
       * Knee brace. The old head tie was a horizontal 1.8 m stub at mid-height that ended in
       * open air; this runs from the column at DOCK.h + 1.6 up to the *far* bottom chord of
       * the truss (the girder is 3.0 m wide about cz - hd + 2.4, so that chord is at
       * cz - hd + 3.9), which is the only other piece of real geometry to land on.
       */
      strut(gS, 0, DOCK.h + 1.6 - colY, 0.06, 0, colH * 0.5, 2.9, 0.05, T.steelPainted, 0.008);
      popX();
      solidBox(px, colY, cz - hd + 1.0, 0.16, colH * 0.5, 0.16, 'metal', 0, { cover: false });
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
      place(px, DOCK.h + 4.05, cz - hd + 2.4, 0, -0.14, 0);
      place(0, 0, 0, Math.PI * 0.5, -Math.PI * 0.5);
      corrugated(gC, 3.4, (DOCK.x1 - DOCK.x0 - 2) / 20, [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone], 0.3, 0.04, 0.02);
      popX();
      popX();
    }

    // A gatehouse and the rail gate at the south-east.
    place(34, 0, 36);
    chamferBox(gB, 0, 1.5, 0, 2.0, 1.5, 1.8, T.brick, 0.02);
    chamferBox(gCon, 0, 3.06, 0, 2.2, 0.08, 2.0, T.concreteWorn, 0.018);
    chamferBox(G('glassDirty'), 0, 1.85, -1.82, 1.3, 0.55, 0.02, T.glass, 0.004);
    solidBox(34, 1.85, 34.18, 1.3, 0.55, 0.03, 'glass');
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
    // The depot-approach emplacement, robbed down. It is the one emplacement that stands in
    // the near field of the depot vantage, where it was adding another few dozen rounded pale
    // lumps to a frame that already could not tell rubble from sacks. Half its mass gone off
    // the crest gives the run a stepped silhouette and lets the drums and the barrier beside
    // it be the things the eye lands on.
    sandbagWall(setSack, [[-11.0, 1.5], [-11.0, 5.5]], 4, 505, { slump: 0.42 });
    sandbagWall(setSack, [[13.0, 26.0], [17.5, 26.0], [17.5, 29.5]], 3, 506);

    // Jersey barriers: chicanes on both flanking routes.
    const jersey = [
      [-20, -6, 0], [-16.4, -6, 0], [-12.8, -6, 0],
      [4, -6.4, 0.08], [7.6, -6.4, 0], [11.2, -6.2, -0.05],
      [18.5, 3, Math.PI * 0.5], [17.0, 9.2, Math.PI * 0.5],
      [17.2, 11.3, Math.PI * 0.5],
      [-6, 33.5, 0], [-2.4, 33.5, 0],
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
      [-13.6, 8.6, 0.2, 6], [-12.6, 9.5, 0.1, 4],
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
    /*
     * 601 is the depot blast spoil, and it is the only heap in the map the player stands
     * inside: the depot vantage's eye is 2.8 m from its centre, so at full density its fines
     * threw to 5.8 m and it rendered as one undifferentiated pale-grey mass across the whole
     * width of the lower frame — impossible to read as rubble rather than as sandbags or
     * spoil. Half the pieces and a 0.66 spread pull the toe (and its dust fillet) back inside
     * four metres and leave gaps between the slabs for the props below to sit in. It loses
     * nothing as cover: the ramp and the box colliders that make it climbable are separate.
     *
     * Halving it a second time was tried and rendered, and it did not work either — which is
     * what identified the real fault. Density is a uniform control and the fault is not
     * uniform: the heap's centre is 2.77 m from that eye and its slab tier threw to the full
     * 3.6 m radius, so the *nearest* pieces sat inside a metre of the lens, where one 1.5 m
     * slab is a third of the frame and occludes everything behind it. Thinning removes the
     * readable mid-ground and leaves the giants exactly where they were.
     *
     * So the density comes back up to 0.34 and the fix moves to `clear`: a 3.0 m circle on the
     * doorway at (-33.9, -7.7) that the heap may put nothing inside. Nearest piece to the eye
     * is now 2.6 m rather than 0.9 m, the mass starts at a distance the eye can resolve, and
     * the props below have somewhere to stand. The spread comes back to 0.8 for the same
     * reason — with the toe cut off the doorway, the rest of the heap wants its full body.
     */
    rubblePile(setSlab, setBrick, -31.6, DEPOT.z1 + 1.4, 3.6, 1.4, 601, T.concreteWorn,
      { density: 0.34, spread: 0.8, clear: [-33.9, -7.7, 3.0] });
    rubblePile(setSlab, setBrick, ADMIN.x0 - 1.5, ADMIN.z1 - 3.0, 5.6, 2.4, 602, T.concreteWorn);
    rubblePile(setSlab, setBrick, ADMIN.x0 + 3.5, ADMIN.z1 - 3.2, 4.4, 3.6, 603, T.concreteWorn);
    rubblePile(setSlab, setBrick, DEPOT.x0 - 2.0, -28.0, 3.4, 1.2, 604, T.concreteWorn);
    rubblePile(setSlab, setBrick, 2.0, -22.0, 3.0, 0.9, 605, T.concreteWorn);
    rubblePile(setSlab, setBrick, 44, 26.0, 3.6, 1.1, 606, T.concreteWorn);
    rubblePile(setSlab, setBrick, -8.0, 36.0, 2.6, 0.8, 607, T.concreteWorn);
    solidRamp(ADMIN.x0 + 1.0, ADMIN.z1 - 3.0, 4.5, 3.2, 0.2, 2.6, 'concrete', 0);
    solidRamp(-31.6, DEPOT.z1 + 1.4, 2.2, 2.4, 1.05, 0.15, 'concrete', 0);
    solidBox(-8.0, 0.45, 36.0, 2.2, 0.45, 2.2, 'concrete', 0, { cover: true });
    solidBox(44, 0.55, 26.0, 3.0, 0.55, 3.0, 'concrete', 0, { cover: true });
    solidBox(2.0, 0.45, -22.0, 2.6, 0.45, 2.6, 'concrete', 0, { cover: true });

    depotApproachProps();

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

    /**
     * Floodlight and catenary masts: the tall verticals that stitch the ground plane to the
     * sky, and the only three-tier read the yard has between the low cover and the crane.
     *
     * Two defects were live here. The column was emitted by `tube`, which centres on the
     * local origin, so an 11 m mast ran from -5.5 to +5.5 and the lamp head hung five metres
     * clear of the top of a stub that was half buried — from the yard that reads as a plain
     * column floating over the ground. And all three masts were the same section at the same
     * height, which is a clone array however you space it. Now: base plates and holding-down
     * bolts on every one, alternating lattice and tapered-box sections, jittered heights and
     * spacing, and bracket arms carrying the yard lighting out over the tracks.
     */
    for (let mi = 0; mi < MAST_DEFS.length; mi++) {
      const [mx, mz, mh, kind, armSide] = MAST_DEFS[mi];
      const yaw = hash2(mi, 5) * 0.5 - 0.25;
      place(mx, 0, mz, yaw);
      // Base: pad, grouted plate, bolts. A mast that meets the floor at a bare cylinder is
      // the same defect as a rubble slab punching through it.
      chamferBox(G('concreteRough'), 0, 0.16, 0, 0.62, 0.16, 0.62, T.concreteWorn, 0.025);
      chamferBox(gS, 0, 0.35, 0, 0.42, 0.035, 0.42, T.steelDark, 0.01);
      for (let sx = -1; sx <= 1; sx += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          chamferBox(gS, sx * 0.31, 0.4, sz * 0.31, 0.035, 0.04, 0.035, T.steelDark, 0.006);
        }
      }
      if (kind === 0) {
        // Tapered box section with a bolted splice halfway up.
        place(0, 0.38 + mh * 0.5, 0);
        tube(gR, 0.1, 0.19, mh, 8, T.steelPainted, false, false, 0.012);
        popX();
        chamferBox(gS, 0, 0.38 + mh * 0.52, 0, 0.2, 0.045, 0.2, T.steelDark, 0.01);
      } else {
        // Lattice section: four chords and K-bracing, the same vocabulary as the crane legs.
        place(0, 0.38, 0);
        latticeTower(gS, mh, 0.72, Math.max(3, Math.round(mh / 1.9)), 0.045, 0.028, T.steelPainted);
        popX();
      }
      const top = 0.38 + mh;
      // Bracket arm carrying the lamps out over the yard, with a tie back to the mast.
      place(0, top - 0.5, 0, armSide > 0 ? 0 : Math.PI);
      chamferBox(gS, 0.95, 0.34, 0, 0.95, 0.055, 0.06, T.steelPainted, 0.01);
      strut(gS, 0.05, -0.5, 0, 1.6, 0.28, 0, 0.035, T.steelPainted, 0.006);
      popX();
      place(0, top, 0);
      chamferBox(gS, 0, 0.12, 0, 0.9, 0.06, 0.28, T.steelPainted, 0.01);
      for (let k = -1; k <= 1; k++) {
        place(k * 0.55, 0.32, 0, 0, 0.6);
        chamferBox(gS, 0, 0, 0, 0.24, 0.16, 0.1, T.steelDark, 0.014);
        popX();
      }
      popX();
      popX();
      solidBox(mx, (0.38 + mh) * 0.5, mz, 0.24, (0.38 + mh) * 0.5, 0.24, 'metal');
      // Ash banked round the base — nothing vertical meets this floor at a clean crease.
      dustSkirt(mx, mz, 0.95, 0.14, 5300 + mi, null);
    }

    /**
     * Mid tier. §4 asks for a three-tier silhouette read and the yard had two — floor, then
     * the crane. A pair of aggregate silos on the east apron and a transfer conveyor off them
     * put a 12 m mass between the container stacks and the landmarks, and they sit where the
     * spawn at (44, 16) looks straight into them.
     */
    {
      const gc2 = G('concreteRough');
      for (let i = 0; i < 2; i++) {
        const sx = 44.0;
        const sz = 20.5 + i * 6.4;
        place(sx, 0, sz);
        chamferBox(gc2, 0, 0.3, 0, 3.1, 0.3, 3.1, T.concreteWorn, 0.03);
        place(0, 6.4, 0);
        tube(gc2, 2.6, 2.6, 11.4, 14, T.concrete, false, false, 0.03);
        popX();
        place(0, 1.6, 0);
        tube(gc2, 2.6, 1.5, 2.4, 14, T.concreteDark, false, false, 0.03);
        popX();
        place(0, 12.5, 0);
        tube(gR, 2.72, 2.72, 0.28, 14, T.rustDeep, false, false, 0.02);
        popX();
        place(0, 12.9, 0);
        tube(gR, 1.9, 2.7, 1.0, 14, T.rust, true, false, 0.02);
        popX();
        // Discharge cone legs and the chute, so the silo stands on something.
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI * 0.25;
          strut(gS, Math.cos(a) * 2.3, 0.55, Math.sin(a) * 2.3, Math.cos(a) * 2.5, 5.2, Math.sin(a) * 2.5, 0.09, T.steelPainted, 0.01);
        }
        popX();
        solidBox(sx, 6.4, sz, 2.7, 6.4, 2.7, 'concrete', 0, { cover: true });
        dustSkirt(sx, sz, 3.4, 0.3, 5400 + i, null);
      }
      // Conveyor gallery running off the silos towards the dock, on two trestles.
      place(44.0, 13.6, 27.0, 0, 0, -0.26);
      latticeGirder(gS, 15.0, 1.0, 1.2, 8, 0.06, 0.032, T.steelPainted);
      popX();
      for (let k = 0; k < 2; k++) {
        const tx = 44.0;
        const tz = 30.5 + k * 4.0;
        const th2 = 11.4 - k * 1.05;
        place(tx, 0, tz);
        for (let s = -1; s <= 1; s += 2) {
          strut(gS, s * 1.5, 0.1, 0, s * 0.6, th2, 0, 0.075, T.steelPainted, 0.01);
          strut(gS, s * 1.5, 0.1, -1.2, s * 0.6, th2, -1.2, 0.075, T.steelPainted, 0.01);
        }
        for (let b = 1; b <= 3; b++) {
          const f = b / 4;
          const y = f * th2;
          const r = lerp(1.5, 0.6, f);
          strut(gS, -r, y, 0, r, y, 0, 0.04, T.steelPainted, 0.006);
          strut(gS, -r, y, -1.2, r, y, -1.2, 0.04, T.steelPainted, 0.006);
        }
        popX();
        solidBox(tx, th2 * 0.5, tz, 1.6, th2 * 0.5, 0.7, 'metal', 0, { cover: true });
      }
    }

    // Practical lights, each on a visible fixture.
    workLamp(-19.5, 3.0, -19.0, 0.4, 1.0, 'tripod');
    workLamp(ADMIN.x0 - 0.6, 3.1, (ADMIN.z0 + ADMIN.z1) * 0.5 - 3.2, Math.PI * 0.5, 0.9, 'bracket');
    workLamp(CRANE.x + 1.1, 4.2, CRANE.zB, -Math.PI * 0.5, 0.85, 'bracket');
    burningBarrel(-4.5, 19.0);

    // Chains: on the crane hook, off a container door, and by the dock canopy.
    hangChain(CRANE.x - 0.55, 6.5, CRANE.zA + (CRANE.zB - CRANE.zA) * 0.62, 26, 0.9, 0.4, 1.7, 0.13);
    hangChain(33.2, 5.0, 3.2, 22, -0.4, 0.9, 3.1, 0.09);
    hangChain(4.0, DOCK.h + 3.9, DOCK.z0 + 1.1, 18, 0.7, -0.7, 5.0, 0.07);

    // Tarpaulins over stacked freight.
    tarp(-13.1, 1.0, 9.0, 3.6, 3.0, 0.25, 0.3, 811);
    tarp(19.9, 1.15, 21.3, 3.2, 2.8, 1.2, 0.26, 812);
    tarp(8.5, DOCK.h + 1.0, DOCK.z0 + 3.5, 3.4, 2.6, 0.05, 0.28, 813);

    groundClutter();
  }

  /**
   * Hard-edged, nameable props threaded through the depot blast spoil.
   *
   * The heap on its own failed §4's detail bar in a way more rubble could never have fixed.
   * Every piece in it is a broken lump of the same material at the same value, so at two to
   * eight metres the whole thing resolves as one pale mass with no scale in it — the frame
   * cannot say whether it is rubble, sandbags or spoil, and an eye that cannot name a shape
   * stops looking at it. Readability beats density: what the pile needed was not detail but
   * *contrast*, so half the rubble came out (see the 601 call above) and these went into the
   * gaps.
   *
   * Every one of them is chosen for silhouette rather than for fidelity — a drum is a
   * cylinder, a pallet is a slot-sided rectangle, a barrier is a battered trapezium, a slab
   * stood on edge is a plate with rebar out of the fracture. Each reads at a glance and at any
   * range, each is a different value and a different material family from the concrete around
   * it, and between them they give the near field the scale cue it had none of. They sit at
   * z >= -7.3 so the lorry route along the shed's north wall stays open.
   */
  function depotApproachProps() {
    const r2 = mulberry32(0x6301);

    // Two big slabs stood on edge against each other, the way a clearance gang leans them out
    // of the way. Rebar out of the broken faces gives the pile its only hard, thin silhouette.
    /*
     * Pulled back and cut down. At scale 2.3 and 2.0, 2.9 m from the depot eye, the first two
     * of these were the two pale masses that filled the left half of the frame: a 1.9 m plate
     * at three metres subtends about a third of the width, and two of them overlapping is the
     * "impossible to tell whether it is rubble, sandbags or spoil" finding almost by itself.
     * At 1.5 and 1.3, four metres out and outside the cleared circle round the doorway, they
     * read as what they are — slabs levered out of a floor and leaned out of the way.
     */
    const leans = [[-32.4, -4.1, 0.55, 1.02, 1.5], [-31.4, -4.6, -0.35, -0.86, 1.3], [-29.9, -7.2, 1.25, 0.95, 1.55]];
    for (let i = 0; i < leans.length; i++) {
      const L = leans[i];
      const tone = 0.82 + hash2(i, 41) * 0.3;
      // A slab on edge is half its length tall, so its centre has to rise with the tilt or the
      // plate sinks through the floor. The 0.72 buries the foot of it in the spoil, which is
      // where a slab levered out of a floor ends up and is also what stops it needing a
      // collider: like every other piece of rubble in the map this is dressing standing on the
      // heap's own ramp, not a second obstacle bolted on top of it.
      const rest = (0.42 * Math.abs(Math.sin(L[3])) + 0.1 * Math.abs(Math.cos(L[3]))) * L[4];
      addInstance(setSlab, L[0], groundY(L[0], L[1]) + rest * 0.72, L[1], L[2], 0, L[3], L[4],
        [T.concreteWorn[0] * tone, T.concreteWorn[1] * tone, T.concreteWorn[2] * tone]);
      dustSkirt(L[0], L[1], 0.72, 0.09, 6320 + i, null);
    }

    // A cable drum on its edge in the spoil: the one perfect circle anywhere in the frame.
    cableSpool(-30.4, -4.5, 0.85, 0.82, 6331);

    // Drums. Two upright and one rolled, in painted metal, so the mass gets a saturated hit
    // and three unmistakable cylinders at knee height.
    const drums = [[-34.2, -4.3, 0, T.rust], [-33.5, -3.6, 0, T.railGreen], [-35.1, -5.3, 1, T.steelPainted]];
    for (let i = 0; i < drums.length; i++) {
      const d = drums[i];
      const tone = 0.72 + hash2(i, 53) * 0.5;
      const tt = [d[3][0] * tone, d[3][1] * tone, d[3][2] * tone];
      if (d[2]) {
        addInstance(setDrum, d[0], groundY(d[0], d[1]) + 0.295, d[1], hash2(i, 9) * 6.28, Math.PI * 0.5, 0, 1, tt);
        solidBox(d[0], 0.3, d[1], 0.45, 0.3, 0.45, 'metal');
      } else {
        addInstance(setDrum, d[0], groundY(d[0], d[1]), d[1], hash2(i, 17) * 6.28, 0, 0, 1, tt);
        solidBox(d[0], 0.45, d[1], 0.31, 0.45, 0.31, 'metal');
      }
    }
    dustSkirt(-34.3, -4.4, 1.5, 0.12, 6341, null);

    // A pallet stack with one leaning off it: horizontal slots, which is a shape nothing else
    // in a rubble heap has.
    for (let k = 0; k < 4; k++) {
      const tone = 0.72 + hash2(k, 61) * 0.5;
      addInstance(setPallet, -28.5 + (hash2(k, 3) - 0.5) * 0.09, groundY(-28.5, -6.3) + k * 0.145,
        -6.3 + (hash2(k, 7) - 0.5) * 0.09, 0.62 + (hash2(k, 11) - 0.5) * 0.07, 0, 0, 1,
        [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone]);
    }
    addInstance(setPallet, -27.8, groundY(-28.5, -6.3) + 0.5, -6.9, 1.1, 0, 1.3, 1, T.woodDark);
    solidBox(-28.5, 0.29, -6.3, 0.62, 0.29, 0.42, 'wood', 0.62, { cover: false });
    dustSkirt(-28.5, -6.3, 0.95, 0.1, 6351, null);

    // A barrier dragged clear of the doorway, and the litter and offcuts that collect behind
    // anything that stops the wind.
    addInstance(setJersey, -35.4, 0, -6.4, 0.32, 0, 0, 1, [T.concrete[0] * 0.94, T.concrete[1] * 0.94, T.concrete[2] * 0.96]);
    solidBox(-35.4, 0.44, -6.4, 0.32, 0.44, 1.2, 'concrete', 0.32, { cover: true });
    timberOffcuts(-29.6, -3.7, 6, 6361);
    litterCatch(-34.9, -5.9, 0.32, lod > 0 ? 4 : 2, 6371);
    for (let i = 0; i < 3; i++) {
      const a = r2() * 6.28;
      const px = -31.6 + Math.cos(a) * (2.4 + r2() * 1.1);
      const pz = -6.6 + Math.sin(a) * (2.4 + r2() * 1.1);
      if (pz < -7.3) continue;
      addInstance(setOffcut, px, groundY(px, pz) + 0.03, pz, r2() * 6.28, (r2() - 0.5) * 0.3, (r2() - 0.5) * 0.25,
        0.9 + r2() * 0.7, [T.rust[0] * (0.7 + r2() * 0.5), T.rust[1] * 0.9, T.rust[2] * 0.9]);
    }

    /*
     * The crest, which is the part of the heap the depot vantage is actually looking at.
     *
     * Everything above is correct and almost none of it lands, for two separate reasons that
     * were both found by projecting the props through that camera (eye (-34, 1.75, -8),
     * 75° vertical, 16:9) rather than by eye.
     *
     *  1. *Framing.* The barrier falls off the right edge, the pallet stack sits at 1.5% of
     *     frame width on the extreme left margin, and all three drums land at 66% across and
     *     67% down — underneath the viewmodel. Only the lean slabs are in frame.
     *
     *  2. *Occlusion, and this is the one that matters.* The eye is 2.8 m from the centre of a
     *     3.6 m heap, i.e. standing on its own toe, so the crest 2.1 m ahead rises to about
     *     1.3 m and everything beyond it is behind a wall. A prop on the far flank at 4 m puts
     *     its top on a sight ray that passes the crest line at 1.12 m — half a metre under the
     *     spoil. Ringing the heap with readables therefore cannot work from here; the props
     *     have to be *on* the crest, inside the 10–45% band the mass actually fills.
     *
     * Positions are solved rather than guessed: sampled over the heap and kept only where the
     * projected x lands in that band, the range is 1.4–3.2 m, and nothing comes within 1.15 m
     * of a prop that is already there. Heights come off `rubblePile`'s own profile,
     * y = (1 - r/R)^2 * H with R = 3.6 and H = 1.4 for pile 601, and are then deliberately
     * under-set — a piece sunk a hand's depth into rubble is what rubble does, a piece
     * floating a hand's depth over it is the one error the eye catches instantly. Nothing
     * exceeds 1.2 m off the deck either, so a player standing where the camera stands still
     * sees over the heap.
     *
     * They are also the darkest things in the near field, and that is doing as much work as
     * the silhouettes. The mass reads as one object because every piece in it is broken
     * concrete at the same value; rust, creosote and weathered deal are three different value
     * families, and a value break is what tells the eye where one object stops.
     */
    const heapY = (rr) => {
      const f = clamp(1 - rr / 3.6, 0, 1);
      return f * f * 1.4;
    };

    // 44% across, 3.7 m out: a drum on its side, half sunk. The only horizontal cylinder in the
    // frame, so it is what sets the scale everything behind it gets measured against. It used to
    // stand at (-32.8, -6.8), which is 1.5 m from the lens and inside the cleared circle round
    // the doorway — at that range a 0.6 m drum is a featureless bar across the bottom of frame.
    addInstance(setDrum, -32.2, groundY(-32.2, -4.8) + heapY(2.05) * 0.5 + 0.235, -4.8,
      2.42, Math.PI * 0.5, 0.06, 1, [T.rustDeep[0] * 1.12, T.rustDeep[1] * 1.02, T.rustDeep[2] * 0.98]);
    // The slabs and the pallet ride the heap's own ramp collider like every other piece of
    // rubble here, but this one is a waist-wide steel cylinder standing where the ramp has
    // already flattened out — walking through it would be worse than the mass it is breaking.
    solidBox(-32.2, 0.29, -4.8, 0.45, 0.29, 0.45, 'metal');

    // 19% across: a floor slab levered out and stood on edge, rebar out of the fracture. Same
    // rest-height maths as the `leans` above. Moved from (-31.0, -6.3) at scale 2.0 — which put
    // a 1.7 m plate 2.6 m from the eye, i.e. the other half of the pale mass — out to 3.6 m at
    // 1.4, where the whole silhouette including the rebar fits inside the frame and reads.
    {
      const s = 1.4;
      const rz = 0.9;
      const rest = (0.42 * Math.abs(Math.sin(rz)) + 0.1 * Math.abs(Math.cos(rz))) * s;
      addInstance(setSlab, -30.9, 0.34 + rest * 0.72, -6.2, 1.86, 0, rz, s,
        [T.concreteWorn[0] * 0.74, T.concreteWorn[1] * 0.75, T.concreteWorn[2] * 0.8]);
    }

    // Out on the north flank, where the toe is only a hand deep: a pallet on edge tipped back
    // against the spoil. Five deck boards with daylight between them, a shape no piece of
    // broken concrete can imitate. Behind the crest from the depot vantage, but this heap is
    // approached from the yard as often as it is stood on, and that is the face that sees it.
    addInstance(setPallet, -29.9, groundY(-29.9, -5.5) + 0.42, -5.5, 0.86, 0, 1.25, 1, T.woodDark);
    dustSkirt(-29.9, -5.5, 0.8, 0.09, 6381, null);

    // Creosoted sleepers stacked clear of the heap on the apron proper: dead-black horizontal
    // bars, the hardest edge and the lowest value on the approach, and the piece that stops
    // the spoil and the apron reading as one continuous grey from the yard side.
    sleeperStack(-28.2, -5.0, 1.24, 3, 6391);

    /*
     * Five more readables through the gaps the cleared toe opened up.
     *
     * The rule the last pass had right and did not go far enough with: the eye cannot accept a
     * mass until it has named something inside it. With the pieces above moved back out of the
     * lens, the props on this heap project to 16, 19, 21, 44, 38 and 48% of frame width, which
     * leaves 5, 23, 27, 36 and 41 empty. These five are solved against the same camera (eye
     * (-34, 1.75, -8), 75° vertical, 16:9) to fill exactly those, so there is a nameable object
     * every four or five percent right across the band the heap occupies.
     *
     * Heights come off `rubblePile`'s own profile, y = (1 - r/3.6)^2 * 1.4, and are deliberately
     * under-set: a piece sunk a hand into rubble is what rubble does, a piece floating a hand
     * over it is the error the eye catches instantly. None of them carries a collider — they
     * ride the heap's existing ramp like every other piece of dressing on it, and a decorative
     * prop that can catch the player's capsule is worse than no prop at all.
     */
    const heapH = (rr) => {
      const f = clamp(1 - rr / 3.6, 0, 1);
      return f * f * 1.4;
    };
    // 36% across, on the crest: a length of pipe laid square across the sightline. A straight
    // unbroken cylinder is the one silhouette broken concrete can never imitate, and lying
    // across the view it also draws a horizontal the eye can measure the heap's depth against.
    addInstance(setPipe, -31.8, groundY(-31.8, -5.4) + heapH(1.22) * 0.82 + 0.06, -5.4, -2.79, 0, 0.06, 1.15,
      [T.rust[0] * 1.05, T.rust[1] * 0.92, T.rust[2] * 0.88]);
    // 5% across, out on the east toe where the spoil is only a hand deep: a second, shorter
    // length at a different angle, so the two read as scrap off a load and not as a fence.
    addInstance(setPipe, -29.4, groundY(-29.4, -6.4) + heapH(2.21) * 0.8 + 0.042, -6.4, -1.05, 0, -0.09, 0.78,
      [T.rustDeep[0] * 1.1, T.rustDeep[1] * 1.0, T.rustDeep[2] * 0.96]);
    // 27% across: an oil drum stood upright in the spoil. Vertical, dark and a perfect circle
    // in plan — three properties nothing else on the heap has.
    addInstance(setDrum, -30.2, groundY(-30.2, -5.0) + heapH(2.13) * 0.72, -5.0, 1.24, 0, 0.05, 1,
      [T.railGreen[0] * 0.92, T.railGreen[1] * 0.92, T.railGreen[2] * 0.94]);
    dustSkirt(-30.2, -5.0, 0.62, 0.09, 6401, null);
    // 41% across: a floor slab levered out and stood on edge with its rebar showing, angled
    // away from the 19% one so the two do not read as a pair of the same object.
    {
      const s = 1.7;
      const rz = -0.82;
      const rest = (0.42 * Math.abs(Math.sin(rz)) + 0.1 * Math.abs(Math.cos(rz))) * s;
      addInstance(setSlab, -31.4, groundY(-31.4, -4.2) + heapH(2.41) * 0.7 + rest * 0.7, -4.2, 0.42, 0, rz, s,
        [T.concreteWorn[0] * 0.82, T.concreteWorn[1] * 0.8, T.concreteWorn[2] * 0.78]);
      dustSkirt(-31.4, -4.2, 0.7, 0.085, 6402, null);
    }
    // Two pallets flat on the apron at 23%, six metres out and clear of the spool, the offcuts
    // and the sleeper stack: horizontal slots at the far edge of the mass, which is what tells
    // the eye the heap has a far edge at all.
    for (let k = 0; k < 2; k++) {
      const tone = 0.74 + hash2(k, 83) * 0.44;
      addInstance(setPallet, -27.4 + (hash2(k, 19) - 0.5) * 0.12, groundY(-27.4, -3.6) + k * 0.145,
        -3.6 + (hash2(k, 23) - 0.5) * 0.12, 2.35 + (hash2(k, 29) - 0.5) * 0.1, 0, 0, 1,
        [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone]);
    }
    // Grit and paper banked into the lee of the heap's east toe, which is what blends spoil
    // into apron. Without it the mass ends on a line and reads as a model sitting on a floor.
    gravelDrift(-28.6, -3.4, -28.2, -7.8, 1, 6403, 2.4);
    litterCatch(-28.9, -6.9, 0.32, lod > 0 ? 4 : 2, 6404);

    /*
     * The cleared threshold itself, which the `clear` circle above would otherwise leave as
     * three metres of bare apron in the closest part of the frame — trading one finding for the
     * other. Everything here is deliberately low: swept fines, the scrape the shovel left, and
     * one barrow. Nothing over knee height, or the mass comes straight back.
     */
    {
      const r2c = mulberry32(6411);
      // The push line: where the spoil was shoved back to. Grit banks on its inside face.
      // Eight segments, so the divisor is the segment count and not the last index — dividing
      // by 7 put the final segment's far end at 1.48 rad, a third of a radian past the arc.
      for (let i = 0; i < 8; i++) {
        const a = -1.15 + (i / 8) * 2.3;
        const x0 = -33.9 + Math.cos(a) * 2.72;
        const z0 = -7.7 + Math.sin(a) * 2.72;
        const a1 = -1.15 + ((i + 1) / 8) * 2.3;
        gravelDrift(x0, z0, -33.9 + Math.cos(a1) * 2.72, -7.7 + Math.sin(a1) * 2.72, -1, 6412 + i, 2.6);
      }
      // What the shovel missed, sized so no piece can dominate at a metre and a half.
      for (let i = 0; i < 26; i++) {
        const a = r2c() * 6.28;
        const rr = 0.9 + Math.sqrt(r2c()) * 1.75;
        const px = -33.9 + Math.cos(a) * rr;
        const pz = -7.7 + Math.sin(a) * rr;
        if (pz < -7.9) continue; // behind the door line, where nothing is visible anyway
        const tone = 0.7 + r2c() * 0.5;
        if (r2c() < 0.72) {
          addInstance(stoneSet, px, groundY(px, pz) + 0.015, pz, r2c() * 6.28,
            (r2c() - 0.5) * 1.6, (r2c() - 0.5) * 1.6, 0.55 + r2c() * 0.75,
            [T.gravel[0] * tone, T.gravel[1] * tone, T.gravel[2] * tone]);
        } else {
          addInstance(chunkSet, px, groundY(px, pz) + 0.07, pz, r2c() * 6.28,
            (r2c() - 0.5) * 1.2, (r2c() - 0.5) * 1.2, 0.45 + r2c() * 0.3,
            [T.concreteWorn[0] * tone, T.concreteWorn[1] * tone, T.concreteWorn[2] * tone]);
        }
      }
      // The scrape: dust dragged in an arc by the blade, and the diesel off whatever pushed it.
      place(-32.9, groundY(-32.9, -6.5) + 0.009, -6.5, 0.5);
      blobXZ(GT('dirt', 0.35), 1.5, 0.5, 6431, [T.dirt[0] * 1.06, T.dirt[1] * 1.02, T.dirt[2] * 0.94], 11, 0);
      popX();
      oilStain(-33.2, -5.9, 0.85, 0.6, 0.4, 6432, 0.0106);
      // One barrow standing where the gang left it: a nameable object in the nearest two metres
      // of frame, at 39% across, and the piece that explains the cleared ground it stands on.
      wheelbarrow(-32.4, -5.9, 1.9, 6441);
      litterCatch(-34.2, -6.6, 0.32, lod > 0 ? 4 : 2, 6442);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 14b. Ground clutter                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * §4: "nothing large may be a bare unbroken plane". The floor was the largest surface in
   * the map and it was carrying almost nothing — 55% of the wide vantage was featureless
   * concrete between the camera and the fence line.
   *
   * This pass is deliberately structured as a *guaranteed* cover pass rather than a random
   * scatter: it walks a 5.5 m grid over the whole playable box and drops at least one piece
   * of clutter in every cell that is not inside a building, so no unbroken floor region
   * larger than about 6 x 6 m can survive anywhere. Everything it places goes into instance
   * sets that already exist, so the whole pass costs two draw calls (tyres and cones) and no
   * new materials.
   */

  /** A drift of ash banked along a wall foot. The wall side is high, the yard side feathers. */
  function ashBerm(x0, z0, x1, z1, side, height, width, seedN) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5) return;
    const yaw = runYaw(x1 - x0, z1 - z0);
    place((x0 + x1) * 0.5, 0, (z0 + z1) * 0.5, yaw);
    const g = GT('dirt', 0.35);
    const segs = Math.max(3, Math.round(len / 2.2));
    const r2 = mulberry32(seedN);
    let ha = height * (0.6 + r2() * 0.7);
    for (let i = 0; i < segs; i++) {
      const xa = -len * 0.5 + (i / segs) * len;
      const xb = -len * 0.5 + ((i + 1) / segs) * len;
      const hb = height * (0.5 + r2() * 0.85);
      const wa = width * (0.7 + r2() * 0.6);
      const wb = width * (0.7 + r2() * 0.6);
      const tone = 0.86 + r2() * 0.3;
      const tt = [T.dirt[0] * tone * 1.08, T.dirt[1] * tone * 1.03, T.dirt[2] * tone];
      _bp.length = 0;
      _bp.push(xa, ha, side * 0.06, xb, hb, side * 0.06, xb, 0.006, side * wb, xa, 0.006, side * wa);
      gpoly(g, _bp, 0, 0.93, side * 0.36, tt);
      ha = hb;
    }
    popX();
  }

  /** Cast-iron manhole with a recessed frame and a lifting key slot. */
  function manhole(x, z, yaw) {
    const gc = G('concretePanel');
    const gm = G('metalRust');
    place(x, groundY(x, z), z, yaw);
    chamferBox(gc, 0, 0.012, 0, 0.44, 0.03, 0.44, T.concreteDark, 0.014);
    place(0, 0.032, 0);
    tube(gm, 0.35, 0.36, 0.05, 12, T.rustDeep, true, false, 0.008);
    popX();
    chamferBox(gm, 0, 0.056, 0, 0.06, 0.008, 0.02, T.steelDark, 0.004);
    popX();
  }

  /**
   * Surface drainage channel with a slotted grating. Runs along every hard edge that has a
   * building or a wall on one side of it — which is what turns a floor/wall junction from a
   * bare crease into a detail the eye can measure the space against.
   */
  function drainChannel(x0, z0, x1, z1, seedN) {
    const gc = G('concretePanel');
    const gm = G('metalRust');
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = runYaw(x1 - x0, z1 - z0);
    const units = Math.max(1, Math.round(len / 1.2));
    const r2 = mulberry32(seedN);
    place((x0 + x1) * 0.5, 0, (z0 + z1) * 0.5, yaw);
    // Channel walls.
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gc, 0, 0.04, s * 0.19, len * 0.5, 0.045, 0.055, T.concreteWorn, 0.014);
    }
    chamferBox(gc, 0, -0.03, 0, len * 0.5, 0.03, 0.14, T.concreteDark, 0.008);
    for (let i = 0; i < units; i++) {
      const px = -len * 0.5 + (i + 0.5) * (len / units);
      if (r2() < 0.18) continue; // a missing grating is a story and a shadow trap
      for (let k = -3; k <= 3; k++) {
        chamferBox(gm, px, 0.062, k * 0.038, (len / units) * 0.5 - 0.03, 0.008, 0.014, T.rustDeep, 0.003);
      }
      chamferBox(gm, px, 0.058, 0, (len / units) * 0.5 - 0.02, 0.006, 0.15, T.rustDeep, 0.004);
    }
    popX();
  }

  /** Cable drum: two cheeks, a barrel and the coiled cable still on it. */
  function cableSpool(x, z, yaw, r, seedN) {
    const gw = G('woodPlank');
    const gm = G('metalRust');
    const r2 = mulberry32(seedN);
    place(x, groundY(x, z) + r, z, yaw, 0, Math.PI * 0.5);
    for (let s = -1; s <= 1; s += 2) {
      place(0, s * r * 0.52, 0);
      tube(gw, r, r, 0.09, 14, T.wood, true, true, 0.014);
      popX();
    }
    place(0, 0, 0);
    tube(gw, r * 0.34, r * 0.34, r * 1.0, 10, T.woodDark, false, false, 0.01);
    popX();
    // The cable itself, as three stacked coils so the drum is not empty.
    for (let k = 0; k < 3; k++) {
      place(0, (k - 1) * r * 0.24, 0);
      tube(gm, r * 0.36 + k * 0.03 + r2() * 0.02, r * 0.36 + k * 0.03, r * 0.2, 12, T.steelDark, false, false, 0.008);
      popX();
    }
    popX();
    solidBox(x, r, z, r, r, r * 0.62, 'wood', yaw, { cover: false });
    dustSkirt(x, z, r * 1.15, 0.12, seedN, null);
  }

  /** A short line of bollards, hazard banded, on cast bases. */
  function bollardLine(x0, z0, x1, z1, n, seedN) {
    const gm = G('metalRust');
    const gc = G('concretePanel');
    const r2 = mulberry32(seedN);
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0.5;
      const x = lerp(x0, x1, f) + (r2() - 0.5) * 0.12;
      const z = lerp(z0, z1, f) + (r2() - 0.5) * 0.12;
      const h = 0.86 + r2() * 0.16;
      const lean = (r2() - 0.5) * 0.16;
      place(x, groundY(x, z), z, r2() * 6.28, 0, lean);
      chamferBox(gc, 0, 0.035, 0, 0.17, 0.035, 0.17, T.concreteDark, 0.01);
      place(0, h * 0.5 + 0.06, 0);
      tube(gm, 0.075, 0.085, h, 8, T.steelPainted, true, false, 0.01);
      popX();
      place(0, h * 0.82, 0);
      tube(gm, 0.09, 0.09, 0.14, 8, T.hazard, false, false, 0.008);
      popX();
      popX();
      solidBox(x, (h + 0.06) * 0.5, z, 0.11, (h + 0.06) * 0.5, 0.11, 'metal');
    }
  }

  /** A stack of sleeper offcuts, as found beside every yard in the world. */
  function sleeperStack(x, z, yaw, rows, seedN) {
    const r2 = mulberry32(seedN);
    for (let k = 0; k < rows; k++) {
      const cross = k & 1;
      const n = 2 + ((r2() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) * 0.5) * 0.34;
        const tone = 0.6 + r2() * 0.5;
        addInstance(
          sleeperSet,
          x + (cross ? off : (r2() - 0.5) * 0.14),
          groundY(x, z) + 0.08 + k * 0.16,
          z + (cross ? (r2() - 0.5) * 0.14 : off),
          yaw + (cross ? Math.PI * 0.5 : 0) + (r2() - 0.5) * 0.05,
          0,
          0,
          0.62 + r2() * 0.3,
          [T.sleeper[0] * tone, T.sleeper[1] * tone, T.sleeper[2] * tone],
          1,
          1
        );
      }
    }
    solidBox(x, 0.08 + rows * 0.08, z, 0.95, 0.08 + rows * 0.08, 0.75, 'wood', yaw, { cover: rows > 3 });
    dustSkirt(x, z, 1.25, 0.11, seedN + 3, null);
  }

  /** A heap of tyres: some flat, some leaning, one propped on its edge. */
  function tyrePile(x, z, n, seedN) {
    const r2 = mulberry32(seedN);
    for (let i = 0; i < n; i++) {
      const flat = r2() < 0.7;
      const a = r2() * 6.28;
      const rr = r2() * 0.5;
      addInstance(
        setTyre,
        x + Math.cos(a) * rr,
        groundY(x, z) + (flat ? 0.14 + i * 0.16 : 0.4),
        z + Math.sin(a) * rr,
        r2() * 6.28,
        flat ? (r2() - 0.5) * 0.4 : Math.PI * 0.5 + (r2() - 0.5) * 0.5,
        (r2() - 0.5) * 0.3,
        0.9 + r2() * 0.25,
        grey(0.34 + r2() * 0.12)
      );
    }
    dustSkirt(x, z, 1.05, 0.1, seedN + 11, null);
  }

  /**
   * The guaranteed coverage pass. Walks the playable box on a 5.5 m grid and drops clutter in
   * every open cell, weighted so that near-field cells (the ones inside 12 m of a spawn) get
   * something with real height rather than another sliver of plank.
   */
  function clutterGrid() {
    const r2 = mulberry32(0x9c1a7e >>> 0);
    const CELL = 5.5;
    const nx = Math.ceil((PLAY.maxX - PLAY.minX) / CELL);
    const nz = Math.ceil((PLAY.maxZ - PLAY.minZ) / CELL);
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const cx = PLAY.minX + (ix + 0.5) * CELL;
        const cz = PLAY.minZ + (iz + 0.5) * CELL;
        // Building interiors have their own dressing; the dock deck is a working surface.
        if (inRect(cx, cz, [DEPOT.x0 - 1, DEPOT.z0 - 1, DEPOT.x1 + 1, DEPOT.z1 + 1])) continue;
        if (inRect(cx, cz, [ADMIN.x0 - 1, ADMIN.z0 - 1, ADMIN.x1 + 1, ADMIN.z1 + 1])) continue;
        if (inRect(cx, cz, [DOCK.x0, DOCK.z0, DOCK.x1, DOCK.z1])) continue;
        // Three to five pieces per cell, jittered inside it, so the grid never reads.
        const pieces = 3 + ((r2() * 3) | 0);
        for (let k = 0; k < pieces; k++) {
          const x = cx + (r2() - 0.5) * CELL * 0.92;
          const z = cz + (r2() - 0.5) * CELL * 0.92;
          const y = groundY(x, z);
          const tone = 0.58 + r2() * 0.62;
          const pick = r2();
          if (pick < 0.26) {
            addInstance(setDebris, x, y + 0.02, z, r2() * 6.28, 0, (r2() - 0.5) * 0.3, 0.5 + r2() * 1.2, [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone]);
          } else if (pick < 0.46) {
            addInstance(setScrap, x, y + 0.02, z, r2() * 6.28, 0, 0, 0.6 + r2() * 1.3, [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone]);
          } else if (pick < 0.68) {
            // Grit. Three or four together, because a single stone is invisible.
            for (let s = 0; s < 4; s++) {
              addInstance(
                stoneSet,
                x + (r2() - 0.5) * 1.1, y + 0.02, z + (r2() - 0.5) * 1.1,
                r2() * 6.28, (r2() - 0.5) * 1.6, (r2() - 0.5) * 1.6,
                0.7 + r2() * 1.3,
                [T.gravel[0] * tone, T.gravel[1] * tone, T.gravel[2] * tone]
              );
            }
          } else if (pick < 0.82) {
            addInstance(setBrick, x, y + 0.035, z, r2() * 6.28, (r2() - 0.5) * 0.8, (r2() - 0.5) * 0.8, 0.8 + r2() * 0.6, [T.brick[0] * tone, T.brick[1] * tone, T.brick[2] * tone]);
          } else if (pick < 0.93) {
            addInstance(chunkSet, x, y + 0.09, z, r2() * 6.28, (r2() - 0.5) * 1.2, (r2() - 0.5) * 1.2, 0.7 + r2() * 0.9, [T.concreteWorn[0] * tone, T.concreteWorn[1] * tone, T.concreteWorn[2] * tone]);
          } else {
            addInstance(setWeed, x, y, z, r2() * 6.28, 0, 0, 0.6 + r2() * 0.9, [T.weeds[0] * tone, T.weeds[1] * tone, T.weeds[2] * tone]);
          }
        }
      }
    }
  }

  function groundClutter() {
    /* --- ash banked against every long wall and berm ---------------------- */
    ashBerm(-50, 41.4, 20, 41.4, -1, 0.42, 1.5, 5501);
    ashBerm(28, 41.4, 50, 41.4, -1, 0.4, 1.4, 5502);
    ashBerm(-52, -42.4, -20, -42.4, 1, 0.44, 1.6, 5503);
    ashBerm(18, -42.4, 50, -42.4, 1, 0.42, 1.5, 5504);
    ashBerm(-47.9, -38, -47.9, 40, 1, 0.36, 1.3, 5505);
    ashBerm(47.9, -38, 47.9, 40, -1, 0.34, 1.2, 5506);
    ashBerm(DEPOT.x1 + 0.3, DEPOT.z0 + 1, DEPOT.x1 + 0.3, DEPOT.z1 - 1, 1, 0.34, 1.2, 5507);
    ashBerm(ADMIN.x0 - 0.3, ADMIN.z0 + 2, ADMIN.x0 - 0.3, ADMIN.z1 - 8, -1, 0.32, 1.15, 5508);
    ashBerm(ADMIN.x0 + 2, ADMIN.z1 + 0.3, ADMIN.x1 - 2, ADMIN.z1 + 0.3, 1, 0.3, 1.1, 5509);
    ashBerm(DOCK.x0, DOCK.z0 - 0.35, DOCK.x1, DOCK.z0 - 0.35, -1, 0.3, 1.05, 5510);

    /* --- kerbs, channels and drainage along the hard edges ---------------- */
    kerbRun(ADMIN.x0 - 8.4, -34, ADMIN.x0 - 8.4, -18, 1);
    kerbRun(ADMIN.x0 - 0.6, -34, ADMIN.x0 - 0.6, -18, -1);
    kerbRun(-52, -40.2, -20, -40.2, 1);
    kerbRun(18, -40.2, 48, -40.2, 1);
    drainChannel(DEPOT.x1 + 1.5, DEPOT.z0 + 2, DEPOT.x1 + 1.5, DEPOT.z1 - 2, 5601);
    drainChannel(ADMIN.x0 - 1.4, ADMIN.z0 + 3, ADMIN.x0 - 1.4, ADMIN.z1 - 9, 5602);
    drainChannel(-20, -2.9, 18, -2.9, 5603);
    drainChannel(DOCK.x0 + 2, DOCK.z0 - 1.5, DOCK.x1 - 2, DOCK.z0 - 1.5, 5604);

    for (const m of [[-12, -6.2, 0.2], [8, -6.2, 0], [-26, 2.5, 0.5], [17.5, 34.0, 0.3],
      [-40, -20.0, 0.1], [30, -8.5, 0.7], [-6.5, 27.0, 0.4], [43.0, 4.0, 0.2]]) {
      manhole(m[0], m[1], m[2]);
    }

    /* --- yard furniture that has real height ------------------------------ */
    cableSpool(-14.5, -6.9, 0.4, 0.85, 5701);
    cableSpool(-13.0, -7.6, 1.9, 0.62, 5702);
    cableSpool(27.5, 30.5, 0.9, 0.95, 5703);
    cableSpool(-40.5, 20.5, 2.4, 0.72, 5704);
    cableSpool(4.5, -17.5, 0.2, 0.8, 5705);

    sleeperStack(-9.5, 2.2, 0.15, 5, 5801);
    sleeperStack(19.0, 30.2, 1.4, 4, 5802);
    sleeperStack(-36.5, 2.0, 0.0, 6, 5803);
    sleeperStack(35.0, -10.5, 0.9, 3, 5804);
    sleeperStack(-4.0, -25.5, 2.2, 4, 5805);

    tyrePile(-21.5, 5.0, 7, 5901);
    tyrePile(23.5, 33.0, 5, 5902);
    tyrePile(-45.0, 12.0, 6, 5903);
    tyrePile(38.5, 15.0, 5, 5904);
    tyrePile(-2.5, -18.0, 4, 5905);

    bollardLine(-20.5, -2.2, -13.5, -2.2, 5, 6001);
    bollardLine(12.0, -2.2, 18.0, -2.2, 4, 6002);
    bollardLine(ADMIN.x0 - 7.6, -20.0, ADMIN.x0 - 7.6, -26.0, 4, 6003);
    bollardLine(-14.0, 31.0, -8.0, 31.0, 4, 6004);

    /* --- cones, scattered where work stopped ------------------------------ */
    const cones = [
      [-19.0, -4.2], [-17.6, -4.6], [-8.0, -4.4], [3.5, -4.6], [4.9, -4.1],
      [16.0, -4.5], [-27.5, 6.4], [-26.3, 7.1], [12.5, 12.0], [13.9, 12.6],
      [30.0, -12.0], [31.2, -12.7], [-42.0, -8.0], [-40.8, -8.6], [22.0, 34.5],
      [23.4, 35.1], [-6.0, 22.0], [-4.8, 22.6], [41.0, 28.0], [-33.0, -34.0],
      [-31.8, -34.6], [9.0, 36.0], [-46.0, 30.0], [45.5, -30.0], [36.0, 20.0],
    ];
    for (let i = 0; i < cones.length; i++) {
      const [x, z] = cones[i];
      const fallen = hash2(i, 13) < 0.28;
      addInstance(setCone, x, groundY(x, z) + (fallen ? 0.14 : 0), z, hash2(i, 3) * 6.28, fallen ? Math.PI * 0.42 : 0, 0, 1, grey(0.9 + hash2(i, 7) * 0.3));
    }

    /* --- oil, spillage and tyre ruts -------------------------------------- */
    // Flat, but not featureless: a dark tinted patch a centimetre off the deck is what stops
    // a swept concrete apron reading as one value.
    const gStain = GT('asphalt', 0.35);
    const stains = [
      [-14.0, -6.5, 2.6, 1.8, 0.3], [7.0, -6.4, 3.2, 2.0, 0.0], [-30.0, -20.0, 3.4, 2.4, 0.5],
      [26.0, -9.0, 2.2, 1.6, 0.8], [-9.0, 2.5, 2.0, 1.4, 0.2], [18.5, 30.5, 2.8, 1.9, 1.1],
      [-42.0, 22.0, 2.4, 1.7, 0.4], [33.0, 12.0, 3.0, 2.1, 2.0], [-20.0, 33.0, 2.6, 1.8, 0.9],
      [2.0, 18.0, 2.2, 1.5, 1.6], [44.0, -8.0, 2.6, 1.8, 0.6], [-46.0, -14.0, 2.4, 1.6, 1.3],
    ];
    for (let i = 0; i < stains.length; i++) {
      const [x, z, hx, hz, yaw] = stains[i];
      place(x, groundY(x, z) + 0.012, z, yaw);
      const n = 5;
      for (let k = 0; k < n; k++) {
        const f = k / n;
        const rr = 1 - f * 0.72;
        const tone = 0.2 + f * 0.34;
        _bp.length = 0;
        _bp.push(-hx * rr, k * 0.0012, -hz * rr, hx * rr, k * 0.0012, -hz * rr * 0.8, hx * rr * 0.9, k * 0.0012, hz * rr, -hx * rr * 0.85, k * 0.0012, hz * rr * 0.9);
        gpoly(gStain, _bp, 0, 1, 0, [tone, tone * 0.98, tone * 1.02]);
      }
      popX();
    }
    // Ruts: paired dark bands following the two roads, so the apron shows where traffic ran.
    const ruts = [[-21, -6.2, 19, -6.2], [ADMIN.x0 - 4.2, -34, ADMIN.x0 - 4.2, -18], [-49, -41.5, 47, -41.5]];
    for (let i = 0; i < ruts.length; i++) {
      const [ax, az, bx, bz] = ruts[i];
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = runYaw(bx - ax, bz - az);
      place((ax + bx) * 0.5, 0.011, (az + bz) * 0.5, yaw);
      for (let s = -1; s <= 1; s += 2) {
        const segs = Math.max(4, Math.round(len / 4));
        for (let k = 0; k < segs; k++) {
          const xa = -len * 0.5 + (k / segs) * len;
          const xb = -len * 0.5 + ((k + 1) / segs) * len;
          const wob = Math.sin(k * 1.7 + i) * 0.09;
          const tone = 0.42 + hash2(k, i * 3 + s) * 0.24;
          _bp.length = 0;
          _bp.push(xa, 0, s * 0.82 + wob - 0.14, xb, 0, s * 0.82 - wob - 0.14, xb, 0, s * 0.82 - wob + 0.14, xa, 0, s * 0.82 + wob + 0.14);
          gpoly(gStain, _bp, 0, 1, 0, [tone, tone, tone * 1.03]);
        }
      }
      popX();
    }

    /* --- near-field occluders, one per spawn ------------------------------ */
    // §4's foreground rule: a frame with nothing inside four metres has no depth cue at all.
    // Each spawn gets a mass placed off to one side of its look direction — never in it — so
    // the first frame the player sees has something breaking its border.
    for (let i = 0; i < SPAWN_DEFS.length; i++) {
      const [sx, sz, lx, lz] = SPAWN_DEFS[i];
      const dx = lx - sx;
      const dz = lz - sz;
      const dl = Math.hypot(dx, dz) || 1;
      const fx = dx / dl;
      const fz = dz / dl;
      // Perpendicular, alternating sides.
      const side = i & 1 ? 1 : -1;
      const px = sx + (-fz * side) * 2.6 + fx * 1.4;
      const pz = sz + (fx * side) * 2.6 + fz * 1.4;
      const kind = i % 4;
      if (kind === 0) {
        sleeperStack(px, pz, Math.atan2(fz, fx), 5, 6100 + i);
      } else if (kind === 1) {
        cableSpool(px, pz, Math.atan2(fz, fx) + 0.4, 0.9, 6100 + i);
      } else if (kind === 2) {
        // Drum trio on a pallet: waist height, so it breaks the frame edge without blocking.
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * 6.28;
          addInstance(setDrum, px + Math.cos(a) * 0.36, groundY(px, pz), pz + Math.sin(a) * 0.36, hash2(i, k) * 6.28, 0, 0, 1, k === 1 ? T.rust : T.railGreen);
          solidBox(px + Math.cos(a) * 0.36, 0.45, pz + Math.sin(a) * 0.36, 0.31, 0.45, 0.31, 'metal');
        }
        dustSkirt(px, pz, 0.95, 0.12, 6200 + i, null);
      } else {
        tyrePile(px, pz, 6, 6100 + i);
        addInstance(setCone, px + 0.9, groundY(px, pz), pz - 0.7, 0.4, 0, 0, 1, grey(1.0));
      }
    }

    clutterGrid();
  }

  /* ====================================================================== */
  /* 14c. Set dressing — the density pass                                    */
  /* ====================================================================== */

  /**
   * §4's detail bar, run as one pass over everything the region builders left bare.
   *
   * The region builders own *structure*. This owns the *story*: where traffic ran, what
   * leaked, what got shelled, what somebody propped against a wall and never came back for.
   * The single clearest gap between this map and a shipped one was not fidelity but density —
   * large readable areas of ground and large readable areas of wall with nothing on them at
   * all, and an eye that finds nothing to land on reads the whole frame as a test level.
   *
   * Three rules govern every placement below.
   *
   *  1. **Draw calls come from materials, not from props.** Everything merged writes into a
   *     bucket that already exists (`concretePanel`, `concreteRough`, `metalRust`,
   *     `metalPainted`, `woodPlank`, `brickPainted`, `corrugatedSteel`, `glassDirty`, the
   *     triplanar `dirt` / `asphalt` / `gravel` grounds); everything repeated goes through an
   *     instance set, six of which are new. So the whole pass costs six draw calls.
   *  2. **Nothing is spread uniformly.** Detail banks where the eye goes — the two routes
   *     between each pair of spaces, the cover edges, the nine spawn sightlines, and above all
   *     the wall/floor junction, which is where a real yard accumulates and a procedural one
   *     famously does not.
   *  3. **Nothing is stamped.** Every instance varies in yaw, in scale and in tint, and the
   *     tint always comes off `art.js` through the `T` table.
   */

  /* --- new instance sets -------------------------------------------------- */

  /** Paper, card and plastic sheet: what blows across a yard and catches on the first edge. */
  const setLitter = inst('litter', 'plaster', (g) => {
    // Two flaps, each emitted twice back to back so a scrap seen edge-on does not vanish.
    const flap = (pts, t) => {
      _bp.length = 0;
      for (let i = 0; i < pts.length; i++) _bp.push(pts[i]);
      gpoly(g, _bp, 0, 1, 0, t);
      _bp.length = 0;
      for (let i = 0; i < pts.length; i++) _bp.push(pts[i]);
      gpoly(g, _bp, 0, -1, 0, t);
    };
    place(0, 0.004, 0, 0, 0, 0.05);
    flap([-0.13, 0, -0.09, 0.03, 0, -0.11, 0.06, 0, 0.08, -0.11, 0, 0.1], T.white);
    popX();
    place(0.055, 0.022, 0.015, 0.7, 0, -0.55);
    flap([-0.07, 0, -0.05, 0.08, 0, -0.06, 0.07, 0, 0.06, -0.06, 0, 0.05], grey(0.86));
    popX();
  });

  /** Fine grass, taller and wispier than `setWeed`, for wall feet and sleeper gaps. */
  const setTuft = inst('tuft', 'dirt', (g) => {
    const r2 = mulberry32(0x7a17);
    for (let i = 0; i < 11; i++) {
      const a = r2() * Math.PI * 2;
      const h = 0.26 + r2() * 0.36;
      const lean = 0.34 + r2() * 0.6;
      place(Math.cos(a) * 0.055, 0, Math.sin(a) * 0.055, a, 0, lean);
      _bp.length = 0;
      _bp.push(-0.008, 0, 0, 0.008, 0, 0, 0.002, h, h * 0.42);
      gpoly(g, _bp, 0, 0, 1, T.weeds);
      popX();
    }
  });

  /** 20 litre jerry can, X-swaged flanks and a three-finger handle. */
  const setJerry = inst('jerry', 'metalPainted', (g) => {
    chamferBox(g, 0, 0.17, 0, 0.085, 0.17, 0.155, T.white, 0.016);
    for (let i = -1; i <= 1; i++) chamferBox(g, 0, 0.36, i * 0.072, 0.05, 0.024, 0.016, T.white, 0.007);
    place(0, 0.355, -0.115, 0, 0, 0.22);
    tube(g, 0.03, 0.034, 0.085, 6, T.white, true, false, 0.005);
    popX();
    // The pressed X on both flanks. A jerry can without it is a box with a spout.
    for (let s = -1; s <= 1; s += 2) {
      for (let d = -1; d <= 1; d += 2) {
        place(s * 0.087, 0.17, 0, 0, d * 0.62, 0);
        plainBox(g, 0, 0, 0, 0.006, 0.011, 0.185, grey(0.84));
        popX();
      }
    }
  });

  /** A roosting corvid. Reads at 30 m as a black notch on a skyline member, which is the job. */
  const setBird = inst('bird', 'metalPainted', (g) => {
    place(0, 0, 0, 0, -0.14, 0);
    plainBox(g, 0, 0.085, 0, 0.042, 0.052, 0.1, T.white);
    popX();
    plainBox(g, 0, 0.148, -0.082, 0.03, 0.032, 0.038, T.white);
    _bp.length = 0;
    _bp.push(-0.011, 0.146, -0.115, 0.011, 0.146, -0.115, 0, 0.136, -0.178);
    gpoly(g, _bp, 0, 1, 0, T.white);
    _bp.length = 0;
    _bp.push(-0.019, 0.076, 0.085, 0.019, 0.076, 0.085, 0.009, 0.05, 0.225, -0.009, 0.05, 0.225);
    gpoly(g, _bp, 0, 1, 0, T.white);
  });

  /** Timber wheel chock with a steel toe plate and a rope eye. */
  const setChock = inst('chock', 'woodPlank', (g) => {
    wedge(g, 0.155, 0.105, 0.006, 0.185, T.white);
    plainBox(g, -0.145, 0.045, 0, 0.018, 0.042, 0.088, T.steelDark);
  });

  /** Offcut of steel angle or a length of pipe — the scrap a yard is never without. */
  const setOffcut = inst('offcut', 'metalRust', (g) => {
    place(0, 0.03, 0, 0, 0, 0);
    plainBox(g, 0, 0, 0, 0.36, 0.028, 0.028, T.white);
    plainBox(g, 0, 0.026, 0.026, 0.36, 0.026, 0.004, T.white);
    popX();
  });

  /**
   * A snapped kerbstone, half-battered, laid along local X.
   *
   * Hard-edged and unmistakably man-made, which is the entire reason it exists. A floor dressed
   * only with organic scatter still reads as noise however much of it there is — the eye needs a
   * handful of pieces whose shape it can *name* before it will accept the grit around them as
   * ground rather than as a texture, and a kerb profile names itself from twenty metres.
   */
  const setKerbFrag = inst('kerbfrag', 'concretePanel', (g) => {
    chamferBox(g, 0, 0.075, 0, 0.3, 0.075, 0.0625, T.white, 0.012);
    // The batter along the top front arris: the one line that says "kerb" and not "block".
    place(0, 0.146, -0.05, 0, 0, -0.62);
    chamferBox(g, 0, 0, 0, 0.3, 0.014, 0.03, grey(0.95), 0.006);
    popX();
    // The break: a stepped lobe off one end, never a saw cut.
    place(0.3, 0.05, 0.012, 0.26, 0.2, 0.34);
    chamferBox(g, 0, 0, 0, 0.055, 0.05, 0.045, grey(0.86), 0.01);
    popX();
  });

  /**
   * A 1.5 m length of pipe with a flange collar at one end, lying along local X.
   *
   * The only unbroken straight cylinder in the debris vocabulary. Broken concrete has no
   * silhouette the eye can name, so a heap made purely of it collapses into one mass; a pipe
   * laid across that mass is what tells the eye where one object stops and the next starts.
   */
  const setPipe = inst('pipe', 'metalRust', (g) => {
    place(0, 0, 0, 0, 0, Math.PI * 0.5);
    tube(g, 0.058, 0.058, 1.5, 8, T.white, false, false, 0.006);
    popX();
    place(-0.735, 0, 0, 0, 0, Math.PI * 0.5);
    tube(g, 0.095, 0.095, 0.028, 8, grey(0.78), true, true, 0.005);
    popX();
  });

  /* --- flat ground work --------------------------------------------------- */

  /** An irregular flat patch: the shape every stain, scorch mark and puddle is cut from. */
  function blobXZ(g, r, squash, seedN, tintArr, segs, y) {
    const n = segs || 11;
    const r2 = mulberry32(seedN);
    _bp.length = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.76 + r2() * 0.46);
      _bp.push(Math.cos(a) * rr, y || 0, Math.sin(a) * rr * squash);
    }
    gpoly(g, _bp, 0, 1, 0, tintArr);
  }

  /**
   * Oil. A hard black core inside two softer haloes, because a spill wicks outwards into the
   * fines and a single flat ellipse reads as a sticker.
   */
  function oilStain(x, z, r, squash, yaw, seedN, yOff) {
    // `yOff` exists so the open-bay pass can lay its own spills without ever landing coplanar
    // with one of the hand-placed stains below. Two flat blobs at the same height z-fight, and
    // the fight is far more visible than either stain.
    place(x, groundY(x, z) + (yOff === undefined ? 0.01 : yOff), z, yaw);
    const g = GT('asphalt', 0.35);
    const r2 = mulberry32(seedN);
    for (let k = 0; k < 3; k++) {
      const f = k / 3;
      const tone = 0.17 + f * 0.4;
      blobXZ(g, r * (1 - f * 0.55), squash * (0.9 + r2() * 0.3), seedN + k * 13, [tone, tone * 0.97, tone * 1.02], 11, k * 0.0015);
    }
    popX();
  }

  /**
   * Standing water in a rut. Two layers: a matte damp margin, then the water itself in dirty
   * glass — the only surface in the map smooth enough to return the 8° key as a hard specular,
   * which is the entire reason a puddle reads as wet rather than as another dark patch.
   */
  function puddle(x, z, r, squash, yaw, seedN) {
    place(x, groundY(x, z), z, yaw);
    blobXZ(GT('asphalt', 0.35), r * 1.4, squash, seedN, T.damp, 11, 0.008);
    blobXZ(G('glassDirty'), r, squash, seedN + 7, T.water, 11, 0.015);
    popX();
  }

  /**
   * A pair of tyre ruts with tread across them. `wander` puts a real steering error into the
   * run; a rut laid dead straight is the same tell as a container row laid dead straight.
   */
  function tyreTrack(x0, z0, x1, z1, gauge, seedN, opts) {
    const o = opts || {};
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1) return;
    const yaw = runYaw(x1 - x0, z1 - z0);
    const r2 = mulberry32(seedN);
    // `opts.y` lets a second family of ruts run at its own height. Every rut is a flat quad at
    // a fixed world Y, so two that cross at the same height z-fight along the crossing; the
    // open-bay ruts therefore sit 0.6 mm over the hand-placed ones and can cross them freely.
    place((x0 + x1) * 0.5, o.y === undefined ? 0.011 : o.y, (z0 + z1) * 0.5, yaw);
    const g = GT('asphalt', 0.35);
    const segs = Math.max(4, Math.round(len / 1.6));
    const half = gauge * 0.5;
    const wander = o.wander === undefined ? 0.16 : o.wander;
    for (let s = -1; s <= 1; s += 2) {
      for (let k = 0; k < segs; k++) {
        const xa = -len * 0.5 + (k / segs) * len;
        const xb = -len * 0.5 + ((k + 1) / segs) * len;
        const wa = Math.sin(k * 0.83 + seedN) * wander + Math.sin(k * 2.1) * wander * 0.4;
        const wb = Math.sin((k + 1) * 0.83 + seedN) * wander + Math.sin((k + 1) * 2.1) * wander * 0.4;
        const w = 0.15 + r2() * 0.05;
        const tone = 0.4 + hash2(k, seedN + s) * 0.28;
        _bp.length = 0;
        _bp.push(xa, 0, s * half + wa - w, xb, 0, s * half + wb - w, xb, 0, s * half + wb + w, xa, 0, s * half + wa + w);
        gpoly(g, _bp, 0, 1, 0, [tone, tone, tone * 1.03]);
        // Tread: a chevron bar every third segment, alternating hand, a shade darker again.
        if (k % 3 === (s > 0 ? 0 : 1)) {
          const tb = tone * 0.72;
          const cx2 = (xa + xb) * 0.5;
          _bp.length = 0;
          _bp.push(
            cx2 - 0.09, 0.0012, s * half + wa - w * 0.9,
            cx2 + 0.09, 0.0012, s * half + wa - w * 0.1,
            cx2 + 0.04, 0.0012, s * half + wa + w * 0.9,
            cx2 - 0.14, 0.0012, s * half + wa + w * 0.1
          );
          gpoly(g, _bp, 0, 1, 0, [tb, tb, tb]);
        }
      }
    }
    popX();
  }

  /**
   * Ballast and grit washed up against a kerb or a wall foot. Runs the drift as instanced
   * stones over a thin dirt fillet, so it costs nothing and kills the bare crease.
   */
  function gravelDrift(x0, z0, x1, z1, side, seedN, density) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5) return;
    const yaw = runYaw(x1 - x0, z1 - z0);
    // `side` is the direction from the line into open ground, expressed as the sign of the
    // run's *local +Z*. The fillet below feathers that way, so the stones have to use the same
    // axis: taking the world normal as -sin/-cos instead scatters them on the far side of the
    // line from the drift they are supposed to be sitting in.
    const ux = Math.sin(yaw);
    const uz = Math.cos(yaw);
    const r2 = mulberry32(seedN);
    // The fillet.
    place((x0 + x1) * 0.5, 0, (z0 + z1) * 0.5, yaw);
    const g = GT('dirt', 0.35);
    const segs = Math.max(3, Math.round(len / 2.4));
    for (let i = 0; i < segs; i++) {
      const xa = -len * 0.5 + (i / segs) * len;
      const xb = -len * 0.5 + ((i + 1) / segs) * len;
      const wa = 0.28 + r2() * 0.4;
      const wb = 0.28 + r2() * 0.4;
      const ha = 0.05 + r2() * 0.07;
      const tone = 0.84 + r2() * 0.3;
      _bp.length = 0;
      _bp.push(xa, ha, side * 0.04, xb, ha, side * 0.04, xb, 0.005, side * wb, xa, 0.005, side * wa);
      gpoly(g, _bp, 0, 0.9, side * 0.35, [T.gravel[0] * tone, T.gravel[1] * tone, T.gravel[2] * tone]);
    }
    popX();
    // The stones on top of it.
    const n = Math.round(len * (density === undefined ? 2.6 : density) * (lod > 0 ? 1 : 0.5));
    for (let i = 0; i < n; i++) {
      const f = r2();
      const px = lerp(x0, x1, f) + ux * side * (0.06 + r2() * 0.55) + (r2() - 0.5) * 0.2;
      const pz = lerp(z0, z1, f) + uz * side * (0.06 + r2() * 0.55) + (r2() - 0.5) * 0.2;
      const tone = 0.62 + r2() * 0.55;
      addInstance(
        stoneSet, px, groundY(px, pz) + 0.015, pz,
        r2() * 6.28, (r2() - 0.5) * 1.5, (r2() - 0.5) * 1.5,
        0.6 + r2() * 1.15,
        [T.gravel[0] * tone, T.gravel[1] * tone, T.gravel[2] * tone]
      );
    }
  }

  /**
   * A line of vegetation against a hard edge. Weeds only ever grow where nothing runs, so
   * every wall foot, fence line and sleeper gap in the map gets one of these and nowhere else
   * does — which is what makes the growth read as a consequence rather than as scatter.
   */
  function weedLine(x0, z0, x1, z1, side, spread, seedN, density) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5) return;
    const yaw = runYaw(x1 - x0, z1 - z0);
    // Same convention as `gravelDrift`: `side` is the sign of local +Z towards open ground.
    const nx = Math.sin(yaw) * side;
    const nz = Math.cos(yaw) * side;
    const r2 = mulberry32(seedN);
    const n = Math.round(len * (density === undefined ? 1.5 : density) * (lod > 1 ? 1 : lod > 0 ? 0.7 : 0.42));
    for (let i = 0; i < n; i++) {
      const f = r2();
      const off = 0.06 + r2() * r2() * spread;
      const px = lerp(x0, x1, f) + nx * off;
      const pz = lerp(z0, z1, f) + nz * off;
      const tone = 0.6 + r2() * 0.65;
      addInstance(
        r2() < 0.45 ? setWeed : setTuft,
        px, groundY(px, pz), pz,
        r2() * 6.28, 0, 0,
        0.65 + r2() * 0.8,
        [T.weeds[0] * tone, T.weeds[1] * tone, T.weeds[2] * tone]
      );
    }
  }

  /** Litter blown up against an edge and stopped by it. Always downwind, never in the open. */
  function litterCatch(x, z, yaw, n, seedN) {
    const r2 = mulberry32(seedN);
    for (let i = 0; i < n; i++) {
      const d = r2() * r2();
      const px = x + Math.cos(yaw) * (r2() - 0.5) * 1.7 - Math.sin(yaw) * d * 0.5;
      const pz = z - Math.sin(yaw) * (r2() - 0.5) * 1.7 - Math.cos(yaw) * d * 0.5;
      const tone = 0.62 + r2() * 0.55;
      addInstance(
        setLitter, px, groundY(px, pz) + 0.012, pz,
        r2() * 6.28, (r2() - 0.5) * 0.5, (r2() - 0.5) * 0.5,
        0.65 + r2() * 0.7,
        [T.paper[0] * tone, T.paper[1] * tone, T.paper[2] * tone]
      );
    }
  }

  /**
   * A boarded barrow crossing over a running line: timber deck panels inside and outside the
   * rails, a chamfered nosing, and a hazard-banded post at each approach.
   *
   * Worth the geometry because it is the one thing that explains how anybody is meant to get
   * from the road to the dock on foot, and a route the player can read is worth more than any
   * amount of scatter.
   */
  function levelCrossing(x, z, halfW, seedN) {
    const gw = G('woodPlank');
    const gm = G('metalRust');
    const r2 = mulberry32(seedN);
    place(x, 0, z);
    // Deck panels: three bays across, four boards each, laid on the sleeper tops at 0.29.
    const bays = [[-2.05, -0.85], [-0.62, 0.62], [0.85, 2.05]];
    for (let b = 0; b < bays.length; b++) {
      const za = bays[b][0];
      const zb = bays[b][1];
      const boards = 4;
      for (let i = 0; i < boards; i++) {
        const pz = za + ((i + 0.5) / boards) * (zb - za);
        const tone = 0.62 + r2() * 0.45;
        chamferBox(gw, 0, 0.285 - r2() * 0.012, pz, halfW, 0.035, ((zb - za) / boards) * 0.5 - 0.012, [T.sleeper[0] * tone, T.sleeper[1] * tone, T.sleeper[2] * tone], 0.012);
      }
      // Retaining angle down each side of the bay.
      for (let s = -1; s <= 1; s += 2) {
        chamferBox(gm, 0, 0.28, (s < 0 ? za : zb) + s * 0.03, halfW, 0.055, 0.022, T.rustDeep, 0.006);
      }
    }
    // Approach nosings, so the deck meets the ballast at a ramp rather than a step.
    for (let s = -1; s <= 1; s += 2) {
      place(0, 0, s * 2.5, s > 0 ? 0 : Math.PI, 0, 0);
      place(0, 0, 0, Math.PI * 0.5);
      wedge(gw, 0.42, halfW, 0.02, 0.3, T.sleeper);
      popX();
      popX();
    }
    // Hazard posts at all four corners of the deck, one of them always knocked askew.
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        const lean = sx * sz > 0 ? 0.0 : 0.2 * r2();
        place(sx * (halfW + 0.35), 0, sz * 2.9, 0, 0, lean);
        tube(gm, 0.045, 0.05, 1.25, 6, T.steelPainted, true, false, 0.008);
        place(0, 0.42, 0);
        tube(gm, 0.055, 0.055, 0.16, 6, T.hazard, false, false, 0.006);
        popX();
        popX();
      }
    }
    popX();
  }

  /* --- wall furniture ----------------------------------------------------- */

  /**
   * Painted stencil in the wall's local frame, centred on (cx, cy), facing +Z at `zOff`.
   * `cell` is one font cell, so a glyph is 5 x 7 cells.
   */
  function stencilText(g, text, cx, cy, cell, tintArr, zOff) {
    const adv = 6.4 * cell;
    const total = text.length * adv - 1.4 * cell;
    const gh = 7 * cell;
    let x = cx - total * 0.5;
    for (let i = 0; i < text.length; i++) {
      const runs = glyphRuns(text.charAt(i));
      for (let k = 0; k < runs.length; k += 3) {
        const x0 = x + runs[k] * cell;
        const x1 = x + runs[k + 1] * cell;
        const y1 = cy + gh * 0.5 - runs[k + 2] * cell;
        const y0 = y1 - cell;
        _bp.length = 0;
        _bp.push(x0, y0, zOff, x1, y0, zOff, x1, y1, zOff, x0, y1, zOff);
        gpoly(g, _bp, 0, 0, 1, tintArr);
      }
      x += adv;
    }
  }

  /**
   * Rust bleeding down from a fixing: one tapered, drifting quad. Two triangles.
   *
   * This is the highest value-per-triangle detail in the file. A bracket, a bolt or a cill
   * with nothing running out of it reads as having been fitted this morning; the streak is
   * what dates the building, and at 8° of key elevation it is also the only tonal variation a
   * flat sunlit wall gets between its openings.
   */
  function rustStreak(g, x, yTop, len, wTop, zOff, tintArr, seedN) {
    const r2 = mulberry32(seedN);
    const wBot = wTop * (0.22 + r2() * 0.5);
    const drift = (r2() - 0.5) * wTop * 3.0;
    // Clamped to the wall base: `rustWash` randomises length, and an unclamped long streak on
    // a low fixing runs straight past the plinth and out of the bottom of the world.
    const yBot = Math.max(0.02, yTop - len);
    _bp.length = 0;
    _bp.push(x - wTop, yTop, zOff, x + wTop, yTop, zOff, x + drift + wBot, yBot, zOff, x + drift - wBot, yBot, zOff);
    gpoly(g, _bp, 0, 0, 1, tintArr);
  }

  /** A fan of streaks below one fixing, with a dark cap where the water actually leaves it. */
  function rustWash(g, x, yTop, len, spread, n, zOff, tintArr, seedN) {
    const r2 = mulberry32(seedN);
    for (let i = 0; i < n; i++) {
      const px = x + (r2() - 0.5) * spread;
      const l = len * (0.3 + r2() * 0.95);
      const w = 0.012 + r2() * 0.038;
      const tone = 0.55 + r2() * 0.5;
      rustStreak(g, px, yTop - r2() * 0.05, l, w, zOff, [tintArr[0] * tone, tintArr[1] * tone, tintArr[2] * tone], seedN * 31 + i * 7);
    }
  }

  /**
   * Shrapnel pocking. Each hit is a dark core with a paler spall halo one millimetre behind
   * it, which is what stops a pock reading as a black dot stuck on the surface.
   */
  function pockMarks(g, cx, cy, hx, hy, n, zOff, seedN, dirX, dirY) {
    const r2 = mulberry32(seedN);
    for (let i = 0; i < n; i++) {
      // Biased along the blast direction, so a wall shows which way the round came from.
      const u = (r2() - 0.5) * 2;
      const v = (r2() - 0.5) * 2;
      const bx = dirX === undefined ? 0 : dirX;
      const by = dirY === undefined ? 0 : dirY;
      const px = cx + (u * 0.72 + bx * (r2() - 0.2)) * hx;
      const py = cy + (v * 0.72 + by * (r2() - 0.2)) * hy;
      const r = 0.028 + r2() * r2() * 0.09;
      const spall = 0.75 + r2() * 0.28;
      _bp.length = 0;
      _bp.push(px - r * 1.7, py - r * 1.5, zOff, px + r * 1.6, py - r * 1.6, zOff, px + r * 1.5, py + r * 1.7, zOff, px - r * 1.6, py + r * 1.5, zOff);
      gpoly(g, _bp, 0, 0, 1, [spall * 1.2, spall * 1.18, spall * 1.12]);
      const core = 0.24 + r2() * 0.2;
      _bp.length = 0;
      _bp.push(px - r, py - r * 0.9, zOff + 0.002, px + r * 0.9, py - r, zOff + 0.002, px + r, py + r * 0.9, zOff + 0.002, px - r * 0.9, py + r, zOff + 0.002);
      gpoly(g, _bp, 0, 0, 1, [core, core * 0.96, core]);
    }
  }

  /**
   * Largest font cell that fits `text` inside a `2*hw x 2*hh` panel with a margin. Sizing the
   * cell by eye is what produces a number three times the width of the plate it is painted on.
   */
  function fitCell(text, hw, hh) {
    return Math.min(hh * 0.24, (hw * 1.7) / (6.4 * Math.max(1, text.length)));
  }

  /** Bolted-on plate, hazard-edged, with a stencil on it. Local frame, facing +Z. */
  function signPlate(gm, x, y, zOff, hw, hh, text, faceTint, textTint) {
    chamferBox(gm, x, y, zOff + 0.012, hw, hh, 0.012, faceTint, 0.006);
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        chamferBox(gm, x + sx * (hw - 0.03), y + sy * (hh - 0.03), zOff + 0.026, 0.012, 0.012, 0.004, T.steelDark, 0.002);
      }
    }
    if (text) stencilText(gm, text, x, y, fitCell(text, hw, hh), textTint || T.soot, zOff + 0.027);
  }

  /** Weathered louvred vent: a frame with angled blades and a soot wash below it. */
  function louvreVent(gm, x, y, zOff, hw, hh, tintArr) {
    chamferBox(gm, x, y, zOff + 0.02, hw, hh, 0.02, tintArr, 0.008);
    const blades = Math.max(4, Math.round(hh / 0.09));
    for (let i = 0; i < blades; i++) {
      const by = y + hh - 0.045 - i * ((hh * 2 - 0.06) / blades);
      place(x, by, zOff + 0.045, 0, -0.55, 0);
      plainBox(gm, 0, 0, 0, hw - 0.035, 0.016, 0.035, [tintArr[0] * 0.72, tintArr[1] * 0.72, tintArr[2] * 0.72]);
      popX();
    }
    chamferBox(gm, x, y, zOff + 0.005, hw + 0.03, hh + 0.03, 0.008, T.steelDark, 0.004);
  }

  /** Perforated cable tray on drop brackets, with the cables lying in it. */
  function cableTray(gm, x0, x1, y, zOff, seedN) {
    const len = Math.abs(x1 - x0);
    const cx = (x0 + x1) * 0.5;
    const r2 = mulberry32(seedN);
    chamferBox(gm, cx, y, zOff + 0.075, len * 0.5, 0.012, 0.075, T.steelPainted, 0.005);
    for (let s = -1; s <= 1; s += 2) {
      chamferBox(gm, cx, y + 0.038, zOff + 0.075 + s * 0.072, len * 0.5, 0.038, 0.008, T.steelPainted, 0.004);
    }
    const brackets = Math.max(2, Math.round(len / 1.5));
    for (let i = 0; i <= brackets; i++) {
      const px = x0 + ((x1 - x0) * i) / brackets;
      chamferBox(gm, px, y - 0.02, zOff + 0.04, 0.02, 0.05, 0.045, T.steelDark, 0.005);
      strut(gm, px, y - 0.06, zOff + 0.01, px, y + 0.02, zOff + 0.13, 0.012, T.steelDark, 0.003);
    }
    // Three cables in the tray, one of them dropping out of it and away down the wall.
    for (let k = 0; k < 3; k++) {
      place(cx, y + 0.028 + k * 0.006, zOff + 0.05 + k * 0.028, 0, 0, Math.PI * 0.5);
      tube(gm, 0.022, 0.022, len - 0.05, 6, k === 1 ? T.steelDark : T.soot, false, false, 0.004);
      popX();
    }
    const dropX = lerp(x0, x1, 0.22 + r2() * 0.5);
    strut(gm, dropX, y - 0.02, zOff + 0.05, dropX + 0.16, Math.max(0.3, y - 1.1 - r2() * 0.8), zOff + 0.035, 0.02, T.soot, 0.004);
  }

  /**
   * A bulkhead or conical work-light fixture. It carries no `PointLight`: §4 caps the
   * practicals at the three the yard already has, and an unpowered fitting on a dead building
   * is both correct and free.
   */
  function wallLamp(gm, x, y, zOff, kind) {
    chamferBox(gm, x, y, zOff + 0.03, 0.055, 0.075, 0.03, T.steelDark, 0.008);
    if (kind === 'cone') {
      strut(gm, x, y, zOff + 0.05, x, y + 0.12, zOff + 0.36, 0.022, T.steelPainted, 0.005);
      place(x, y + 0.06, zOff + 0.4, 0, Math.PI * 0.5, 0);
      tube(gm, 0.155, 0.055, 0.16, 10, T.steelPainted, false, true, 0.008);
      popX();
      place(x, y + 0.045, zOff + 0.345, 0, Math.PI * 0.5, 0);
      tube(G('glassDirty'), 0.1, 0.1, 0.02, 8, T.glass, true, true, 0.004);
      popX();
    } else {
      // Cast bulkhead: an oval body with a wire guard across the glass.
      place(x, y, zOff + 0.11, 0, Math.PI * 0.5, 0);
      tube(gm, 0.1, 0.13, 0.13, 8, T.steelPainted, true, false, 0.008);
      popX();
      place(x, y, zOff + 0.155, 0, Math.PI * 0.5, 0);
      tube(G('glassDirty'), 0.085, 0.085, 0.02, 8, T.glass, true, true, 0.004);
      popX();
      for (let i = -1; i <= 1; i++) {
        chamferBox(gm, x + i * 0.045, y, zOff + 0.175, 0.008, 0.095, 0.008, T.steelDark, 0.003);
      }
    }
  }

  /**
   * Rainwater and services down one blank stretch of wall, authored in the wall's local frame
   * (X along the run, Y up, +Z out of the face). Everything lands in buckets the wall already
   * owns, so a fully dressed elevation costs nothing but triangles.
   */
  function wallFittings(gm, gWall, x0, x1, yTop, zOut, seedN, opts) {
    const o = opts || {};
    const r2 = mulberry32(seedN);
    const len = x1 - x0;
    if (len < 0.8) return;
    const wash = o.wash || T.rustWash;

    // Surface conduit at shoulder height with junction boxes, dropping to a switch.
    const cy = Math.min(yTop - 0.5, 2.35 + r2() * 0.5);
    strut(gm, x0 + 0.15, cy, zOut + 0.035, x1 - 0.15, cy + (r2() - 0.5) * 0.1, zOut + 0.035, 0.018, T.steelPainted, 0.004);
    const clips = Math.max(2, Math.round(len / 1.1));
    for (let i = 0; i <= clips; i++) {
      const px = lerp(x0 + 0.15, x1 - 0.15, i / clips);
      chamferBox(gm, px, cy, zOut + 0.016, 0.016, 0.016, 0.018, T.steelPainted, 0.003);
      if (i % 3 === 1) rustWash(gWall, px, cy - 0.05, 0.9, 0.1, 2, zOut + 0.004, wash, seedN + i * 17);
    }
    const boxX = lerp(x0 + 0.5, x1 - 0.5, 0.25 + r2() * 0.5);
    chamferBox(gm, boxX, cy, zOut + 0.06, 0.115, 0.15, 0.06, T.steelPainted, 0.01);
    chamferBox(gm, boxX, cy, zOut + 0.122, 0.085, 0.12, 0.006, T.steelDark, 0.003);
    strut(gm, boxX, cy - 0.15, zOut + 0.035, boxX + 0.05, 1.15, zOut + 0.035, 0.016, T.steelPainted, 0.003);
    rustWash(gWall, boxX, cy - 0.16, 1.5, 0.22, 4, zOut + 0.004, wash, seedN + 3);

    // A cable tray wherever there is a run long enough to justify one. On a tall elevation it
    // goes above the conduit; on a 2.6 m dado there is no room up there, so it goes below it.
    if (o.tray !== false && len > 4.0) {
      const ty = yTop > 3.2 ? Math.min(yTop - 0.55, 3.5) : cy - 1.0;
      cableTray(gm, x0 + 0.6, x1 - 0.6, ty, zOut, seedN + 11);
      rustWash(gWall, lerp(x0, x1, 0.4), ty - 0.03, 1.6, 0.5, 4, zOut + 0.004, wash, seedN + 19);
    }
    if (o.lamp !== false && len > 2.0) {
      wallLamp(gm, lerp(x0, x1, o.lampAt === undefined ? 0.62 : o.lampAt), Math.min(yTop - 0.55, 2.95), zOut, r2() < 0.5 ? 'cone' : 'bulkhead');
      rustWash(gWall, lerp(x0, x1, o.lampAt === undefined ? 0.62 : o.lampAt), Math.min(yTop - 0.62, 2.86), 1.9, 0.16, 3, zOut + 0.004, wash, seedN + 23);
    }

    // Signage and a painted reference, both fixed to the pier not floating in the middle.
    if (o.sign && len > 1.6) {
      signPlate(gm, lerp(x0, x1, 0.32), 1.85, zOut, 0.28, 0.2, o.sign, T.hazard, T.soot);
      rustWash(gWall, lerp(x0, x1, 0.32), 1.63, 1.1, 0.4, 3, zOut + 0.004, wash, seedN + 29);
    }
    if (o.stencil) {
      stencilText(gWall, o.stencil, lerp(x0, x1, o.stencilAt === undefined ? 0.78 : o.stencilAt), o.stencilY === undefined ? 1.55 : o.stencilY, o.stencilSize || 0.055, o.stencilTint || T.paint, zOut + 0.006);
    }
    if (o.louvre && len > 2.2 && yTop > 2.4) {
      const ly = Math.min(yTop - 0.85, 1.78);
      louvreVent(gm, lerp(x0, x1, 0.5), ly, zOut, 0.34, 0.28, T.steelPainted);
      rustWash(gWall, lerp(x0, x1, 0.5), ly - 0.3, 1.4, 0.6, 5, zOut + 0.004, wash, seedN + 31);
    }
    // Grime at the base: splash-back off the ground, which every wall in the world has.
    const splashes = Math.max(2, Math.round(len / 1.4));
    for (let i = 0; i < splashes; i++) {
      const px = lerp(x0, x1, (i + 0.5) / splashes) + (r2() - 0.5) * 0.4;
      rustStreak(gWall, px, 0.34 + r2() * 0.3, 0.34, 0.09 + r2() * 0.14, zOut + 0.004, T.grime, seedN + 200 + i);
    }
  }

  /* --- working-yard clutter ------------------------------------------------ */

  /** A coil of lay-flat hose or heavy cable, dumped rather than hung. */
  function hoseCoil(x, z, r, seedN) {
    const gm = G('metalRust');
    const r2 = mulberry32(seedN);
    const y = groundY(x, z);
    place(x, y, z, r2() * 6.28, (r2() - 0.5) * 0.1, (r2() - 0.5) * 0.1);
    for (let k = 0; k < 4; k++) {
      const rr = r * (1 - k * 0.13) * (0.96 + r2() * 0.08);
      place((r2() - 0.5) * 0.05, 0.045 + k * 0.075, (r2() - 0.5) * 0.05);
      torus(gm, rr, 0.038, 12, 5, k & 1 ? T.soot : T.steelDark);
      popX();
    }
    // The loose end, thrown clear of the coil.
    const a = r2() * 6.28;
    strut(gm, Math.cos(a) * r, 0.04, Math.sin(a) * r, Math.cos(a) * (r + 0.9), 0.04, Math.sin(a) * (r + 0.55), 0.036, T.soot, 0.006);
    popX();
    dustSkirt(x, z, r * 1.15, 0.07, seedN + 5, null);
  }

  /** Two-wheel tool cart: tray, tools laid in it, a barrow handle and a bucket underneath. */
  function toolCart(x, z, yaw, seedN) {
    const gm = G('metalPainted');
    const gr = G('metalRust');
    const gw = G('woodPlank');
    const r2 = mulberry32(seedN);
    const y = groundY(x, z);
    place(x, y, z, yaw);
    chamferBox(gm, 0, 0.62, 0, 0.46, 0.045, 0.3, T.steelPainted, 0.012);
    chamferBox(gm, 0, 0.3, 0, 0.42, 0.035, 0.27, T.steelPainted, 0.012);
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        strut(gm, sx * 0.42, 0.06, sz * 0.27, sx * 0.42, 0.66, sz * 0.27, 0.02, T.steelPainted, 0.004);
      }
    }
    // Push handle.
    strut(gm, -0.42, 0.66, -0.27, -0.62, 0.95, -0.27, 0.018, T.steelPainted, 0.004);
    strut(gm, -0.42, 0.66, 0.27, -0.62, 0.95, 0.27, 0.018, T.steelPainted, 0.004);
    strut(gm, -0.62, 0.95, -0.27, -0.62, 0.95, 0.27, 0.018, T.steelDark, 0.004);
    // Wheels.
    for (let sz = -1; sz <= 1; sz += 2) {
      place(0.38, 0.14, sz * 0.29, 0, 0, Math.PI * 0.5);
      tube(gr, 0.14, 0.14, 0.05, 10, grey(0.36), true, true, 0.008);
      popX();
    }
    // Tools in the tray: a bar, a wrench blank, a stack of rag.
    place(0.05, 0.68, -0.1, 0.3, 0, 0);
    tube(gr, 0.016, 0.016, 0.72, 5, T.rustDeep, true, false, 0.004);
    popX();
    place(-0.1, 0.665, 0.12, -0.15, 0, 0);
    plainBox(gr, 0, 0, 0, 0.2, 0.012, 0.03, T.steelDark);
    popX();
    plainBox(gw, 0.2, 0.35, 0.06, 0.11, 0.015, 0.09, T.woodDark);
    // Bucket on the lower shelf.
    place(-0.22, 0.44, -0.08, r2() * 3);
    tube(gr, 0.115, 0.09, 0.2, 8, T.steelPainted, false, true, 0.008);
    popX();
    popX();
    solidBox(x, 0.45, z, 0.5, 0.45, 0.34, 'metal', yaw, { cover: false });
    dustSkirt(x, z, 0.75, 0.08, seedN + 2, null);
  }

  /** Wheelbarrow, tipped onto its nose against something, half full of spoil. */
  function wheelbarrow(x, z, yaw, seedN) {
    const gm = G('metalPainted');
    const gr = G('metalRust');
    const y = groundY(x, z);
    place(x, y, z, yaw, 0, 0);
    place(0, 0.34, 0, 0, -0.85, 0);
    // The pan: a tapered tub, wider at the lip.
    place(0, 0, 0);
    tube(gm, 0.42, 0.24, 0.34, 8, T.steelPainted, false, true, 0.014);
    popX();
    // Spoil still in it.
    place(0, 0.1, 0);
    tube(GT('dirt', 0.35), 0.33, 0.3, 0.1, 8, T.dirt, true, false, 0.01);
    popX();
    popX();
    // Handles and legs.
    for (let s = -1; s <= 1; s += 2) {
      strut(gm, -0.1, 0.42, s * 0.3, -0.95, 0.62, s * 0.24, 0.026, T.steelPainted, 0.005);
      strut(gm, -0.55, 0.5, s * 0.27, -0.55, 0.06, s * 0.27, 0.02, T.steelPainted, 0.004);
    }
    place(0.36, 0.2, 0, 0, 0, Math.PI * 0.5);
    tube(gr, 0.2, 0.2, 0.07, 10, grey(0.34), true, true, 0.01);
    popX();
    popX();
    solidBox(x, 0.35, z, 0.62, 0.35, 0.42, 'metal', yaw);
    dustSkirt(x, z, 0.8, 0.07, seedN + 4, null);
  }

  /**
   * A stack of timber packing crates, stencilled. The stencil is emitted per crate rather
   * than baked into an instance, which is the whole reason these are merged geometry: four
   * boxes carrying the same painted number is worse than no number at all.
   */
  function crateStack(x, z, yaw, specs, seedN, yBase) {
    const gw = G('woodPlank');
    const r2 = mulberry32(seedN);
    // `yBase` lets a stack stand on the depot slab or the dock deck. Defaulting to `groundY`
    // and then placing something on a 1.15 m platform buries it to the shoulders.
    const y0 = yBase === undefined ? groundY(x, z) : yBase;
    let y = 0;
    for (let i = 0; i < specs.length; i++) {
      const [hw, hh, hd, text] = specs[i];
      const jx = (r2() - 0.5) * 0.1;
      const jz = (r2() - 0.5) * 0.1;
      const jy = (r2() - 0.5) * 0.14;
      const tone = 0.66 + r2() * 0.5;
      const tt = [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone];
      place(x + jx, y0 + y + hh, z + jz, yaw + jy);
      chamferBox(gw, 0, 0, 0, hw, hh, hd, tt, 0.014);
      // Battens round the case — a crate is boards on a frame, not a solid.
      for (let s = -1; s <= 1; s += 2) {
        chamferBox(gw, 0, s * (hh - 0.045), hd + 0.012, hw + 0.012, 0.045, 0.012, [tt[0] * 0.86, tt[1] * 0.86, tt[2] * 0.86], 0.005);
        chamferBox(gw, s * (hw - 0.045), 0, hd + 0.012, 0.045, hh + 0.012, 0.012, [tt[0] * 0.86, tt[1] * 0.86, tt[2] * 0.86], 0.005);
      }
      if (text) stencilText(gw, text, 0, 0.02, fitCell(text, hw * 0.8, hh * 0.75), T.soot, hd + 0.03);
      popX();
      solidBox(x + jx, y0 + y + hh, z + jz, hw, hh, hd, 'wood', yaw + jy, { cover: y + hh * 2 > 0.9 });
      y += hh * 2 + 0.01;
    }
    dustSkirt(x, z, 0.95, 0.1, seedN + 6, null);
  }

  /** A bundle of scaffold tube leaning where it was unloaded, with a couple of fittings. */
  function scaffoldBundle(x, z, yaw, lean, n, seedN) {
    const gm = G('metalRust');
    const r2 = mulberry32(seedN);
    place(x, groundY(x, z), z, yaw, 0, 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = 0.07 + r2() * 0.06;
      const L = 2.6 + r2() * 1.7;
      // Off-vertical by `lean`, foot on the ground: the tube is authored along local Y and
      // centred on its own origin, so the centre has to be lifted by half its projected length
      // or the bundle sinks through the floor and lies flat instead of standing.
      const tilt = lean * (0.85 + r2() * 0.3);
      place(Math.cos(a) * rr + Math.sin(tilt) * L * 0.5, Math.cos(tilt) * L * 0.5, Math.sin(a) * rr, (r2() - 0.5) * 0.2, 0, -tilt);
      tube(gm, 0.024, 0.024, L, 5, r2() < 0.4 ? T.rustDeep : T.steelPainted, true, true, 0.004);
      popX();
    }
    // Two dropped couplers at the foot.
    for (let i = 0; i < 2; i++) {
      place((r2() - 0.5) * 0.5, 0.035, (r2() - 0.5) * 0.5, r2() * 6.28, 0, r2());
      plainBox(gm, 0, 0, 0, 0.05, 0.032, 0.038, T.steelDark);
      popX();
    }
    popX();
    solidBox(x + Math.cos(yaw) * 0.5, 0.95, z - Math.sin(yaw) * 0.5, 0.55, 0.95, 0.35, 'metal', yaw);
    dustSkirt(x, z, 0.7, 0.09, seedN + 8, null);
  }

  /** A scatter of sawn timber ends beside a stack, plus a couple of steel offcuts. */
  function timberOffcuts(x, z, n, seedN, yBase) {
    const r2 = mulberry32(seedN);
    const yb = yBase === undefined ? null : yBase;
    for (let i = 0; i < n; i++) {
      const a = r2() * 6.28;
      const rr = r2() * 1.5;
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      const tone = 0.58 + r2() * 0.6;
      if (r2() < 0.7) {
        addInstance(setDebris, px, (yb === null ? groundY(px, pz) : yb) + 0.02, pz, r2() * 6.28, 0, (r2() - 0.5) * 0.5, 0.45 + r2() * 1.0,
          [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone]);
      } else {
        addInstance(setOffcut, px, (yb === null ? groundY(px, pz) : yb) + 0.02, pz, r2() * 6.28, (r2() - 0.5) * 0.3, (r2() - 0.5) * 0.2, 0.7 + r2() * 0.7,
          [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone]);
      }
    }
  }

  /** A row of jerry cans, one or two knocked over, tints off the palette's painted metals. */
  function jerryRow(x, z, yaw, n, seedN, yBase) {
    const r2 = mulberry32(seedN);
    for (let i = 0; i < n; i++) {
      const f = i - (n - 1) * 0.5;
      const px = x + Math.cos(yaw) * f * 0.23 + (r2() - 0.5) * 0.05;
      const pz = z - Math.sin(yaw) * f * 0.23 + (r2() - 0.5) * 0.05;
      const down = r2() < 0.22;
      const tone = 0.7 + r2() * 0.55;
      const base = i % 3 === 0 ? T.railGreen : i % 3 === 1 ? T.steelPainted : T.hazard;
      addInstance(
        setJerry, px, (yBase === undefined ? groundY(px, pz) : yBase) + (down ? 0.09 : 0), pz,
        yaw + (r2() - 0.5) * 0.5, down ? Math.PI * 0.5 : 0, 0, 1,
        [base[0] * tone, base[1] * tone, base[2] * tone]
      );
    }
  }

  /** Chocks under a wagon's wheels, against the rail. Every stabled vehicle in a yard has them. */
  function wheelChocks(wx, tz, seedN) {
    const r2 = mulberry32(seedN);
    for (let e = -1; e <= 1; e += 2) {
      for (let s = -1; s <= 1; s += 2) {
        if (r2() < 0.25) continue;
        const px = wx + e * (4.3 + r2() * 0.3);
        const pz = tz + s * 0.7175;
        addInstance(setChock, px + e * 0.42, groundY(px, pz) + 0.19, pz,
          e > 0 ? 0 : Math.PI, 0, (r2() - 0.5) * 0.1, 0.9 + r2() * 0.25, grey(0.72 + r2() * 0.4));
      }
    }
  }

  /* --- overhead ------------------------------------------------------------ */

  /**
   * A wire with real catenary sag, as two quads at right angles per segment. Four triangles a
   * segment buys a silhouette from every angle, which a flat billboard does not have and a
   * tube costs ten times over.
   */
  function wireRun(g, ax, ay, az, bx, by, bz, sag, rad, tintArr, segs) {
    const n = Math.max(2, segs || 9);
    let px = ax;
    let py = ay;
    let pz = az;
    for (let i = 1; i <= n; i++) {
      const t1 = i / n;
      const qx = lerp(ax, bx, t1);
      const qz = lerp(az, bz, t1);
      const qy = lerp(ay, by, t1) - sag * 4 * t1 * (1 - t1);
      let dx = qx - px;
      let dy = qy - py;
      let dz = qz - pz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      // Horizontal perpendicular, then the third axis by cross product.
      let ux = -dz;
      let uz = dx;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul;
      uz /= ul;
      const vx = dy * uz;
      const vy = dz * ux - dx * uz;
      const vz = -dy * ux;
      _bp.length = 0;
      _bp.push(px - ux * rad, py, pz - uz * rad, qx - ux * rad, qy, qz - uz * rad, qx + ux * rad, qy, qz + uz * rad, px + ux * rad, py, pz + uz * rad);
      gpoly(g, _bp, vx, vy, vz, tintArr);
      _bp.length = 0;
      _bp.push(px - vx * rad, py - vy * rad, pz - vz * rad, qx - vx * rad, qy - vy * rad, qz - vz * rad, qx + vx * rad, qy + vy * rad, qz + vz * rad, px + vx * rad, py + vy * rad, pz + vz * rad);
      gpoly(g, _bp, ux, 0, uz, tintArr);
      px = qx;
      py = qy;
      pz = qz;
    }
  }

  /** Fetch a merged bucket as if the emitter stood at (x, z), then emit in world space. */
  function bucketAt(name, x, z) {
    place(x, 0, z);
    const g = G(name);
    popX();
    return g;
  }

  /** Creosoted pole with a cross-arm, insulators and a stay wire to the ground. */
  function catenaryPole(x, z, h, yaw, seedN) {
    const gw = G('woodPlank');
    const gm = G('metalRust');
    const r2 = mulberry32(seedN);
    const lean = (r2() - 0.5) * 0.05;
    place(x, groundY(x, z), z, yaw, 0, lean);
    place(0, h * 0.5 - 0.25, 0);
    tube(gw, 0.085, 0.115, h + 0.5, 7, T.woodDark, true, false, 0.01);
    popX();
    // Cross-arm with three pin insulators, plus the bolt that holds it.
    const ay = h - 0.35;
    chamferBox(gw, 0, ay, 0, 0.055, 0.055, 0.72, T.woodDark, 0.008);
    for (let i = -1; i <= 1; i++) {
      place(0, ay + 0.1, i * 0.52);
      tube(gm, 0.035, 0.048, 0.13, 6, T.glass, true, false, 0.006);
      popX();
    }
    strut(gm, 0, ay - 0.42, 0.3, 0, ay - 0.02, 0.62, 0.016, T.steelDark, 0.004);
    strut(gm, 0, ay - 0.42, -0.3, 0, ay - 0.02, -0.62, 0.016, T.steelDark, 0.004);
    // A painted identification band rather than a plate: at 0.21 m diameter a numbered plate
    // would need a 1 cm glyph, which is under a pixel from anywhere the player can stand.
    place(0, 1.95, 0);
    tube(gm, 0.108, 0.112, 0.22, 8, T.hazard, false, false, 0.004);
    popX();
    rustWash(gw, 0, 1.82, 1.2, 0.1, 3, 0.114, T.rustWash, seedN + 9);
    popX();
    solidBox(x, h * 0.5, z, 0.13, h * 0.5, 0.13, 'wood');
    dustSkirt(x, z, 0.42, 0.07, seedN + 1, null);
  }

  /** A windsock on a short mast, streaming down the map's own wind vector. */
  function windsock(x, z, h, seedN) {
    const gm = G('metalPainted');
    const gt = G('tarpaulin');
    const wd = ATMOSPHERE.windDirection;
    const yaw = Math.atan2(wd[0], wd[2]);
    place(x, groundY(x, z), z);
    chamferBox(G('concreteRough'), 0, 0.12, 0, 0.38, 0.12, 0.38, T.concreteWorn, 0.02);
    place(0, h * 0.5 + 0.2, 0);
    tube(gm, 0.05, 0.07, h, 8, T.steelPainted, false, false, 0.008);
    popX();
    place(0, h + 0.2, 0, yaw);
    // The hoop, then five tapering bands alternating hazard and bleached white.
    place(0, 0, 0, 0, Math.PI * 0.5, 0);
    torus(gm, 0.26, 0.018, 10, 4, T.steelDark);
    popX();
    for (let i = 0; i < 5; i++) {
      const f0 = i / 5;
      const f1 = (i + 1) / 5;
      place(0, -f0 * 0.09, 0.15 + f0 * 1.5, 0, Math.PI * 0.5, 0);
      tube(gt, 0.26 - f1 * 0.13, 0.26 - f0 * 0.13, (f1 - f0) * 1.5, 10, i & 1 ? grey(1.5) : T.hazard, false, false, 0.004);
      popX();
    }
    popX();
    popX();
    solidBox(x, h * 0.5, z, 0.12, h * 0.5, 0.12, 'metal');
  }

  /** Birds along a member. Spacing is uneven and one always faces the wrong way. */
  function roost(ax, ay, az, bx, by, bz, n, seedN) {
    const r2 = mulberry32(seedN);
    const yaw = Math.atan2(bx - ax, bz - az);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.35 + r2() * 0.5) / n;
      const g = 0.16 + r2() * 0.2;
      addInstance(
        setBird,
        lerp(ax, bx, f), lerp(ay, by, f), lerp(az, bz, f),
        yaw + (r2() < 0.25 ? Math.PI : 0) + (r2() - 0.5) * 0.7,
        0, 0,
        0.85 + r2() * 0.4,
        [g, g * 1.02, g * 1.1]
      );
    }
  }

  /* --- damage ------------------------------------------------------------- */

  /**
   * A shell crater: a shallow bowl inside a lip of displaced earth, a scorch fan, and debris
   * thrown directionally.
   *
   * The bowl only reaches -0.05 m. Ground collision is a flat plane at y = 0, so a real hole
   * would have the player walking on air across it; at 8° of key elevation the *lip* is what
   * reads anyway — it catches the sun on its west side and drops the east side into shadow,
   * and that is the whole silhouette of a crater from standing height.
   */
  function shellCrater(x, z, r, dirX, dirZ, seedN) {
    const r2 = mulberry32(seedN);
    const SEG = 18;
    place(x, groundY(x, z), z);
    const g = GT('dirt', 0.35);
    /*
     * Three rings — bowl floor, lip crest, feathered toe — each wobbled *independently*.
     * Sharing one radial jitter across all three (the obvious way to write this) keeps the
     * rings concentric, and concentric rings on a shallow bowl read as a decal stamped on the
     * floor rather than as a hole. Independent wobble is what breaks the circle.
     */
    const ring = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // The lip is thrown higher downrange of the burst, so the crater has a direction.
      const down = ca * dirX + sa * dirZ;
      const lip = (0.2 + r2() * 0.22) * (0.55 + Math.max(0, down) * 1.15);
      const w0 = 0.72 + r2() * 0.5;
      const w1 = 0.8 + r2() * 0.42;
      const w2 = 0.7 + r2() * 0.75;
      ring.push([
        ca * r * 0.38 * w0, -0.055, sa * r * 0.38 * w0,
        ca * r * 0.8 * w1, lip, sa * r * 0.8 * w1,
        ca * r * 1.25 * w2, 0.004, sa * r * 1.25 * w2,
      ]);
    }
    ring[SEG] = ring[0];
    for (let i = 0; i < SEG; i++) {
      const A = ring[i];
      const B = ring[i + 1];
      // Big per-segment tonal swing: the shaded flank of a spoil lip is a stop and a half
      // darker than its sunlit crest, and a crater painted at one value has no volume at all.
      const shade = 0.5 + r2() * 0.55;
      const inner = [T.dirt[0] * shade * 0.78, T.dirt[1] * shade * 0.76, T.dirt[2] * shade * 0.84];
      const outer = [T.dirt[0] * (shade + 0.42), T.dirt[1] * (shade + 0.36), T.dirt[2] * (shade + 0.26)];
      _bp.length = 0;
      _bp.push(A[0], A[1], A[2], B[0], B[1], B[2], B[3], B[4], B[5], A[3], A[4], A[5]);
      gpoly(g, _bp, 0, 0.85, 0, inner);
      _bp.length = 0;
      _bp.push(A[3], A[4], A[5], B[3], B[4], B[5], B[6], B[7], B[8], A[6], A[7], A[8]);
      gpoly(g, _bp, 0, 0.9, 0, outer);
    }
    // Bowl floor, so the centre is not an open hole.
    _bp.length = 0;
    for (let i = 0; i < SEG; i++) _bp.push(ring[i][0], ring[i][1], ring[i][2]);
    gpoly(g, _bp, 0, 1, 0, [T.dirt[0] * 0.36, T.dirt[1] * 0.34, T.dirt[2] * 0.4]);
    /*
     * Scorch. It goes *outside* the lip, never over the bowl: the bowl is fresh subsoil turned
     * up by the burst and it is the brightest thing in the picture, while the burn is on the
     * surface the fireball actually washed across. Laying it over the bowl also floats it,
     * because the bowl is 5 cm below the plane every flat decal here sits on.
     */
    const gs = GT('asphalt', 0.35);
    for (let i = 0; i < SEG; i++) {
      const A = ring[i];
      const B = ring[i + 1];
      const ea = Math.atan2(A[8], A[6]);
      const eb = Math.atan2(B[8], B[6]);
      const la = r * (1.5 + r2() * 0.7);
      const lb = r * (1.5 + r2() * 0.7);
      const tone = 0.22 + r2() * 0.34;
      _bp.length = 0;
      _bp.push(A[6], 0.018, A[8], B[6], 0.018, B[8], Math.cos(eb) * lb, 0.018, Math.sin(eb) * lb, Math.cos(ea) * la, 0.018, Math.sin(ea) * la);
      gpoly(gs, _bp, 0, 1, 0, [tone, tone * 0.97, tone]);
    }
    // Streaks radiating out of that ring, longest downrange.
    const rays = 14;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + r2() * 0.3;
      const bias = 0.5 + Math.max(0, Math.cos(a) * dirX + Math.sin(a) * dirZ) * 1.1;
      const L = r * (1.7 + r2() * 1.6) * bias;
      const w = 0.1 + r2() * 0.24;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const tone = 0.28 + r2() * 0.32;
      _bp.length = 0;
      _bp.push(
        ca * r * 1.2 - sa * w, 0.02, sa * r * 1.2 + ca * w,
        ca * r * 1.2 + sa * w, 0.02, sa * r * 1.2 - ca * w,
        ca * L + sa * w * 0.25, 0.02, sa * L - ca * w * 0.25,
        ca * L - sa * w * 0.25, 0.02, sa * L + ca * w * 0.25
      );
      gpoly(gs, _bp, 0, 1, 0, [tone, tone * 0.98, tone]);
    }
    popX();
    // Spoil banked on the lip itself: the silhouette of a crater from eye height is its lip,
    // and a smooth lip is the last thing that still reads as geometry rather than as ground.
    const nLip = Math.round(r * (lod > 0 ? 16 : 8));
    for (let i = 0; i < nLip; i++) {
      const a = r2() * Math.PI * 2;
      const rr = r * (0.72 + r2() * 0.36);
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      const tone = 0.55 + r2() * 0.55;
      addInstance(stoneSet, px, groundY(x, z) + 0.1 + r2() * 0.12, pz,
        r2() * 6.28, (r2() - 0.5) * 1.7, (r2() - 0.5) * 1.7, 0.8 + r2() * 1.5,
        [T.dirt[0] * tone, T.dirt[1] * tone, T.dirt[2] * tone]);
    }
    // Ejecta: clods, brick and grit thrown downrange, thinning with distance.
    const n = Math.round(r * r * (lod > 0 ? 7 : 3.5));
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dirZ, dirX) + (r2() - 0.5) * 2.6;
      const rr = r * (1.1 + r2() * r2() * 3.2);
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      const tone = 0.6 + r2() * 0.5;
      const pick = r2();
      if (pick < 0.34) {
        addInstance(chunkSet, px, groundY(px, pz) + 0.08, pz, r2() * 6.28, (r2() - 0.5) * 1.4, (r2() - 0.5) * 1.4, 0.6 + r2() * 0.85,
          [T.concreteWorn[0] * tone, T.concreteWorn[1] * tone, T.concreteWorn[2] * tone]);
      } else if (pick < 0.6) {
        addInstance(setBrick, px, groundY(px, pz) + 0.035, pz, r2() * 6.28, (r2() - 0.5) * 0.9, (r2() - 0.5) * 0.9, 0.8 + r2() * 0.6,
          [T.brick[0] * tone, T.brick[1] * tone, T.brick[2] * tone]);
      } else if (pick < 0.86) {
        for (let sI = 0; sI < 3; sI++) {
          addInstance(stoneSet, px + (r2() - 0.5) * 0.8, groundY(px, pz) + 0.02, pz + (r2() - 0.5) * 0.8,
            r2() * 6.28, (r2() - 0.5) * 1.6, (r2() - 0.5) * 1.6, 0.6 + r2() * 1.1,
            [T.gravel[0] * tone, T.gravel[1] * tone, T.gravel[2] * tone]);
        }
      } else {
        addInstance(setScrap, px, groundY(px, pz) + 0.02, pz, r2() * 6.28, 0, (r2() - 0.5) * 0.4, 0.6 + r2() * 1.1,
          [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone]);
      }
    }
    // A slab or two heaved clear of the lip.
    for (let i = 0; i < 3; i++) {
      const a = Math.atan2(dirZ, dirX) + (r2() - 0.5) * 1.8;
      const rr = r * (1.05 + r2() * 0.5);
      addInstance(setSlab, x + Math.cos(a) * rr, groundY(x, z) + 0.14, z + Math.sin(a) * rr,
        r2() * 6.28, (r2() - 0.5) * 0.9, (r2() - 0.5) * 0.9, 0.8 + r2() * 0.6,
        [T.concreteWorn[0] * 0.8, T.concreteWorn[1] * 0.8, T.concreteWorn[2] * 0.85]);
    }
  }

  /**
   * A sandbag position that took a hit: courses standing at one end, burst and spilled at the
   * other, with the fill run out across the floor. Sacks are already an instance set, so the
   * damage costs nothing beyond the spill.
   */
  function burstSandbags(x0, z0, x1, z1, courses, seedN) {
    const r2 = mulberry32(seedN);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dirY = runYaw(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 0.42));
    // The breach eats the middle third of the run.
    const b0 = 0.34 + r2() * 0.12;
    const b1 = b0 + 0.24 + r2() * 0.12;
    for (let c = 0; c < courses; c++) {
      const y = 0.075 + c * 0.155;
      const off = (c % 2) * 0.21;
      for (let i = 0; i < n; i++) {
        const f = (i * 0.42 + off) / len;
        if (f > 1.001) continue;
        // Above the breach the wall has simply gone; at its shoulders it slumps.
        const inBreach = f > b0 && f < b1;
        const shoulder = Math.min(Math.abs(f - b0), Math.abs(f - b1));
        if (inBreach && c > 0) continue;
        if (inBreach && r2() < 0.55) continue;
        const slump = shoulder < 0.12 ? (0.12 - shoulder) * 3.4 : 0;
        const tone = 0.8 + r2() * 0.34;
        const px = lerp(x0, x1, f) + (r2() - 0.5) * 0.07;
        const pz = lerp(z0, z1, f) + (r2() - 0.5) * 0.07;
        addInstance(
          setSack, px, y - slump * 0.09, pz,
          dirY + (r2() - 0.5) * (0.22 + slump), (r2() - 0.5) * (0.08 + slump * 0.6), (r2() - 0.5) * (0.1 + slump * 0.6),
          0.92 + r2() * 0.16,
          [T.sandbag[0] * tone, T.sandbag[1] * tone, T.sandbag[2] * tone]
        );
      }
    }
    // Burst bags thrown clear, and the fill spilled out of them.
    const bx = lerp(x0, x1, (b0 + b1) * 0.5);
    const bz = lerp(z0, z1, (b0 + b1) * 0.5);
    for (let i = 0; i < 9; i++) {
      const a = r2() * 6.28;
      const rr = 0.4 + r2() * 1.9;
      const tone = 0.72 + r2() * 0.4;
      addInstance(
        setSack, bx + Math.cos(a) * rr, groundY(bx, bz) + 0.07, bz + Math.sin(a) * rr,
        r2() * 6.28, (r2() - 0.5) * 1.4, (r2() - 0.5) * 1.4, 0.8 + r2() * 0.3,
        [T.sandbag[0] * tone, T.sandbag[1] * tone, T.sandbag[2] * tone]
      );
    }
    dustSkirt(bx, bz, 1.9, 0.13, seedN + 21, T.sandbag);
    for (let i = 0; i < 26; i++) {
      const a = r2() * 6.28;
      const rr = r2() * 2.3;
      const px = bx + Math.cos(a) * rr;
      const pz = bz + Math.sin(a) * rr;
      const tone = 0.75 + r2() * 0.4;
      addInstance(stoneSet, px, groundY(px, pz) + 0.012, pz, r2() * 6.28, (r2() - 0.5) * 1.5, (r2() - 0.5) * 1.5, 0.4 + r2() * 0.6,
        [T.sandbag[0] * tone, T.sandbag[1] * tone, T.sandbag[2] * tone]);
    }
    // The position still gets its collider, breach and all — it is cover the AI relies on.
    solidBox((x0 + x1) * 0.5, courses * 0.155 * 0.5, (z0 + z1) * 0.5, len * 0.5 + 0.15, courses * 0.155 * 0.5, 0.28, 'sandbag', dirY, { cover: true });
  }

  /* --- the driver --------------------------------------------------------- */

  /** Ground: traffic, spillage, standing water, drifts, growth and litter. */
  function dressGround() {
    // Boarded barrow crossing from the road at z = -6 up to the middle of the yard. It is the
    // one thing that explains how anyone crosses five running lines on foot, and a route the
    // player can read is worth more than any amount of scatter.
    levelCrossing(-8.5, TRACK_Z[4], 1.6, 7101);
    levelCrossing(-8.5, TRACK_Z[3], 1.6, 7102);
    levelCrossing(-8.5, TRACK_Z[2], 1.6, 7103);
    tyreTrack(-8.5, -6.4, -8.5, 16.5, 1.9, 7110, { wander: 0.1 });

    // Lorry movements: out of the depot roller door, off the personnel door, along the aprons
    // and round the terraces. All of them end somewhere, none of them cross the whole map.
    tyreTrack(-21.2, -16.2, -5.5, -8.2, 2.05, 7121);
    tyreTrack(-41.0, -8.6, -26.0, -7.6, 2.05, 7122);
    tyreTrack(ADMIN.x0 - 4.4, -33.0, ADMIN.x0 - 4.0, -18.5, 2.0, 7123, { wander: 0.1 });
    tyreTrack(20.5, -8.8, 34.0, -10.6, 2.05, 7124);
    tyreTrack(-46.5, -33.0, -46.0, -18.0, 2.0, 7125);
    tyreTrack(28.0, 33.5, 44.0, 30.0, 2.1, 7126);
    tyreTrack(-2.0, -6.6, 16.0, -6.0, 2.05, 7127, { wander: 0.22 });

    // Oil where machinery stood or leaked: under the wagons, at the drum clusters, on the
    // aprons, in the depot doorway.
    const oils = [
      [-19.0, -14.5, 1.7, 0.75, 0.2], [-14.6, 20.9, 1.2, 0.9, 0.7], [21.8, -3.4, 1.4, 0.85, 1.3],
      [-43.6, -13.0, 1.5, 0.8, 0.4], [30.6, 30.4, 1.3, 0.9, 2.1], [-23.6, 3.3, 1.0, 0.85, 0.9],
      [12.4, DOCK.z0 - 1.4, 1.2, 0.8, 0.3], [-2.0, 25.0, 2.4, 0.5, 0.0], [13.5, 19.0, 2.4, 0.5, 0.0],
      [9.0, 11.0, 2.2, 0.5, 0.0], [-21.0, 17.0, 2.2, 0.5, 0.0], [14.5, 27.5, 1.8, 0.9, 0.55],
      [-24.5, -4.0, 1.7, 0.9, 2.3], [-8.6, -6.3, 1.1, 0.7, 0.0], [34.2, -10.4, 1.3, 0.8, 1.9],
      [-30.0, -20.0, 1.6, 0.85, 0.5], [-45.0, -30.5, 1.4, 0.8, 1.1], [4.6, -17.6, 1.0, 0.9, 0.4],
    ];
    for (let i = 0; i < oils.length; i++) {
      const o = oils[i];
      oilStain(o[0], o[1], o[2], o[3], o[4], 7200 + i);
    }

    // Standing water, always in a rut or against a kerb — never in the middle of a slab.
    const puddles = [
      [-14.0, -6.9, 1.15, 0.42, 0.02], [3.5, -7.1, 0.95, 0.38, 0.0], [10.5, -5.4, 0.8, 0.4, 0.05],
      [-8.5, 0.6, 0.7, 0.5, 0.0], [-8.5, 9.4, 0.62, 0.55, 0.0], [-19.4, -16.0, 1.0, 0.45, 0.36],
      [ADMIN.x0 - 4.3, -27.5, 1.1, 0.4, 0.03], [ADMIN.x0 - 4.1, -21.0, 0.8, 0.45, 0.0],
      [-46.2, -25.0, 1.0, 0.42, 0.0], [30.5, -9.6, 0.9, 0.45, 1.9], [-33.0, -7.4, 0.85, 0.5, 0.2],
      [21.0, -6.4, 0.75, 0.45, 0.0], [-40.0, 21.0, 0.7, 0.6, 0.9], [17.0, 34.6, 0.8, 0.5, 0.1],
      [-27.5, 41.0, 0.9, 0.4, 0.0], [41.0, -41.0, 1.0, 0.4, 0.0],
    ];
    for (let i = 0; i < puddles.length; i++) {
      const p = puddles[i];
      puddle(p[0], p[1], p[2], p[3], p[4], 7300 + i);
    }

    // Grit drifted against every kerb and hard edge in the map.
    gravelDrift(-21, -2.75, 19, -2.75, -1, 7401);
    gravelDrift(-21, -9.25, 19, -9.25, 1, 7402);
    gravelDrift(ADMIN.x0 - 8.25, -34, ADMIN.x0 - 8.25, -18, -1, 7403);
    gravelDrift(ADMIN.x0 - 0.75, -34, ADMIN.x0 - 0.75, -18, 1, 7404);
    gravelDrift(-52, -40.05, -20, -40.05, -1, 7405);
    gravelDrift(18, -40.05, 48, -40.05, -1, 7406);
    gravelDrift(-49.5, 41.6, 19.5, 41.6, -1, 7407, 1.6);
    gravelDrift(28.5, 41.6, 49.5, 41.6, -1, 7408, 1.6);
    gravelDrift(-51.5, -42.6, -20.5, -42.6, 1, 7409, 1.6);
    gravelDrift(18.5, -42.6, 49.5, -42.6, 1, 7410, 1.6);
    gravelDrift(DEPOT.x1 + 0.25, DEPOT.z0 + 1, DEPOT.x1 + 0.25, DEPOT.z1 - 1, -1, 7411);
    gravelDrift(ADMIN.x0 - 0.25, ADMIN.z0 + 2, ADMIN.x0 - 0.25, ADMIN.z1 - 8, 1, 7412);
    gravelDrift(DOCK.x0, DOCK.z0 - 0.2, DOCK.x1, DOCK.z0 - 0.2, -1, 7413);

    // Growth: wall feet, fence lines, the cess and every sleeper gap on the outer roads.
    weedLine(-49.5, 41.5, 19.5, 41.5, -1, 1.3, 7501);
    weedLine(28.5, 41.5, 49.5, 41.5, -1, 1.3, 7502);
    weedLine(-51.5, -42.5, -20.5, -42.5, 1, 1.2, 7503);
    weedLine(18.5, -42.5, 49.5, -42.5, 1, 1.2, 7504);
    weedLine(-48.2, -37, -48.2, 39, -1, 1.5, 7505, 1.9);
    weedLine(48.2, -37, 48.2, 39, 1, 1.5, 7506, 1.9);
    weedLine(DEPOT.x1 + 0.3, DEPOT.z0 + 1, DEPOT.x1 + 0.3, DEPOT.z1 - 1, -1, 0.85, 7507, 1.1);
    weedLine(DEPOT.x0 - 0.3, DEPOT.z0 + 1, DEPOT.x0 - 0.3, DEPOT.z1 - 1, 1, 0.85, 7508, 1.1);
    weedLine(ADMIN.x0 - 0.3, ADMIN.z0 + 1, ADMIN.x0 - 0.3, ADMIN.z1 - 8, 1, 0.85, 7509, 1.1);
    weedLine(ADMIN.x1 + 0.3, ADMIN.z0 + 1, ADMIN.x1 + 0.3, ADMIN.z1 - 1, -1, 0.85, 7510, 1.1);
    weedLine(DOCK.x0 + 1, DOCK.z0 - 0.15, DOCK.x1 - 1, DOCK.z0 - 0.15, -1, 0.7, 7511, 1.0);
    // In the cess either side of every road, 2.6 m off the centre line. Not between the
    // sleepers: the ballast shoulder stands 0.26 m proud and `groundY` knows nothing about it,
    // so a tuft planted on the crest is a tuft buried to its neck in stone.
    for (let ti = 0; ti < TRACK_Z.length; ti++) {
      const z = TRACK_Z[ti];
      const dens = ti === 0 || ti === 4 ? 1.1 : 0.6;
      weedLine(-46, z - 2.6, 44, z - 2.6, -1, 1.1, 7520 + ti, dens);
      weedLine(-46, z + 2.6, 44, z + 2.6, 1, 1.1, 7530 + ti, dens);
    }

    /*
     * Container flanks. The lanes between the stacks are the map's strongest composition —
     * two hard verticals and a vanishing point — and they were also its emptiest ground: from
     * inside one, the whole lower third of the frame was bare ballast. Freight stands on the
     * same square metre for years, so the foot of every box carries a drift of grit, growth in
     * the lee of it, a strip of blown litter and the odd offcut. Everything here rides in
     * existing instance sets, so the densest part of the map costs nothing.
     *
     * `[x0, z0, x1, z1]` is the centre line of each run; boxes are 2.438 m across, so the
     * flanks are +-1.35 off it.
     */
    const rowLines = [
      [21.0, 2.0, 47.0, 2.0], [21.0, 10.0, 47.6, 10.0],
      [20.5, 18.0, 38.8, 18.0], [20.5, 26.0, 40.3, 26.0],
      [-40.0, 9.9, -20.2, 9.5], [-38.0, 26.1, -18.5, 26.7],
      [10.5, -16.0, 10.5, -32.7], [1.0, -12.0, 19.3, -12.0],
    ];
    for (let i = 0; i < rowLines.length; i++) {
      const [ax, az, bx, bz] = rowLines[i];
      const yaw = runYaw(bx - ax, bz - az);
      const ux = Math.sin(yaw) * 1.35;
      const uz = Math.cos(yaw) * 1.35;
      for (let side = -1; side <= 1; side += 2) {
        const ox = ux * side;
        const oz = uz * side;
        gravelDrift(ax + ox, az + oz, bx + ox, bz + oz, side, 7700 + i * 4 + side, 2.2);
        weedLine(ax + ox, az + oz, bx + ox, bz + oz, side, 0.6, 7740 + i * 4 + side, 1.5);
        // Litter and scrap caught in three places along each flank, never evenly.
        const len2 = Math.hypot(bx - ax, bz - az);
        const spots = Math.max(1, Math.round(len2 / 8));
        for (let k = 0; k < spots; k++) {
          const f = (k + 0.25 + hash2(i * 7 + k, side + 3) * 0.5) / spots;
          const px = lerp(ax, bx, f) + ox * 1.05;
          const pz = lerp(az, bz, f) + oz * 1.05;
          litterCatch(px, pz, yaw + Math.PI * 0.5 * side, lod > 0 ? 4 : 2, 7780 + i * 9 + k * 2 + (side > 0 ? 1 : 0));
          if (hash2(i + k, side) < 0.45) {
            timberOffcuts(px, pz, lod > 0 ? 5 : 3, 7830 + i * 9 + k * 2 + (side > 0 ? 1 : 0));
          }
        }
      }
    }

    // The two-wide block by the west wall is butted, so it has no inner flank to dress — its
    // boxes stand 0.16 m apart and a drift laid down that slot would be inside both of them.
    gravelDrift(-40.5, 36.65, -35.5, 36.65, 1, 7736, 2.0);
    weedLine(-40.5, 36.65, -35.5, 36.65, 1, 0.6, 7737, 1.5);
    litterCatch(-38.0, 36.9, Math.PI * 0.5, lod > 0 ? 5 : 3, 7738);

    // Litter, always downwind of something that stopped it.
    const wd = ATMOSPHERE.windDirection;
    const windYaw = Math.atan2(wd[0], wd[2]);
    const catches = [
      [-20, -6, 5], [-16.4, -6, 4], [-12.8, -6, 5], [4, -6.4, 5], [7.6, -6.4, 4], [11.2, -6.2, 5],
      [18.5, 3, 4], [17.0, 9.2, 5], [-6, 33.5, 4], [-2.4, 33.5, 5], [-40, -6.5, 4], [-36.4, -6.6, 5],
      [-2.4, 15.6, 4], [3.4, 18.4, 4], [-17.5, -16.0, 5], [26.0, ADMIN.z1 + 1.0, 4],
      [-11.0, 3.5, 4], [13.0, 26.0, 4], [-48.2, 12.0, 5], [-48.2, -20.0, 4], [48.2, 8.0, 5],
      [48.2, -28.0, 4], [-30.0, 41.6, 6], [10.0, 41.6, 5], [-34.0, -42.6, 5], [30.0, -42.6, 5],
      [DEPOT.x1 + 0.5, -12.0, 6], [DEPOT.x1 + 0.5, -36.0, 5], [ADMIN.x0 - 0.6, -22.0, 6],
      [ADMIN.x0 - 0.6, -32.0, 5], [-21.5, 5.0, 4], [23.5, 33.0, 4], [-45.0, 12.0, 4],
      [DOCK.x0 + 4, DOCK.z0 - 0.5, 5], [DOCK.x1 - 6, DOCK.z0 - 0.5, 5],
    ];
    for (let i = 0; i < catches.length; i++) {
      const c = catches[i];
      litterCatch(c[0], c[1], windYaw, lod > 0 ? c[2] : Math.max(2, c[2] >> 1), 7600 + i);
    }
  }

  /* ====================================================================== */
  /* 14e. Set dressing — the open bays                                       */
  /* ====================================================================== */

  /**
   * Everything above this point dresses *edges*. Ash banks against walls, grit drifts into
   * kerbs, weeds grow in the lee of a container, litter catches on the first thing that stops
   * it — all true, all correct, and all of it clinging to the map's cover and its structure.
   * The consequence was that the middle of every open bay came out bare: measured off the
   * terraces vantage, roughly 25 x 15 m of the player's near field carried six thumb-sized
   * dark chips and nothing else, which is fifteen metres of walkable nothing in the frame a
   * player looks at first. No shipped map has that.
   *
   * This pass fills the interiors. Three rules, and the second is the one that matters.
   *
   *  1. **Everything rides in a bucket or an instance set that already exists.** Not one new
   *     material, not one new draw call: grit, tufts, litter, scrap, timber, brick and chunk
   *     go through the sets the density pass already built, and the flat work (reinstatement
   *     patches, painted line remnants) goes into the triplanar `asphalt` and the
   *     `concretePanel` buffers. Measured, the whole pass is under twenty thousand triangles,
   *     which is less than the depot heap gave back.
   *
   *  2. **Density follows the desire lines, and so does the *kind*.** A uniform scatter over
   *     an open bay is not detail, it is noise with a seed — it reads as procedural at a
   *     glance because real ground is never evenly dirty. Every bay therefore carries the
   *     lines the traffic actually takes through it, and the fill probability decays as a
   *     Gaussian away from them. The mix rotates with the same term: on the line the traffic
   *     grinds the surface to grit, drags litter along and shakes scrap off a load, and kills
   *     anything trying to grow; three metres off it nothing has been touched in years, so
   *     that is where the tufts are. Density and species both fall out of one number.
   *
   *  3. **Nothing lands on top of anything.** Every candidate is tested against the live
   *     collider list — which by the time this runs is the whole map — plus the ballast
   *     shoulders, which stand 0.26 m proud and which `groundY` knows nothing about, and the
   *     building footprints, which own their own dressing.
   */

  /**
   * The open bays. `rect` is [x0, z0, x1, z1]; `lines` are the desire lines through it;
   * `wear` scales the whole bay's density; `ruts`, `marks`, `drains` and `patches` are the
   * man-made work laid on top of the scatter, and `avoid` is for masses that carry no collider
   * (a rubble heap, a crater) and would otherwise get grit scattered through them.
   */
  const OPEN_BAYS = [
    {
      // THE TERRACES forecourt: the hardstanding between the yard road and the admin block.
      // This is the bare 25 x 15 m the finding measured, and it is the first thing the
      // terraces spawn sees.
      seed: 9601,
      wear: 1.0,
      rect: [20.6, -13.4, 45.2, -4.6],
      lines: [
        [20.8, -8.8, 34.0, -10.6],
        [22.0, -12.2, 44.2, -12.4],
        [30.4, -4.8, 30.0, -12.2],
        [38.2, -5.0, 44.4, -11.2],
      ],
      /*
       * Three ruts, not one. The single rut this bay used to carry ran from (35.4, -5.4) to
       * (44.6, -8.6), which is off the right edge of the terraces frame entirely — so the one
       * vantage the finding was written against saw none of it. The two added here are placed
       * *in* that frame: one reversing into the middle bay between the 30.6 and 34.6 markings,
       * one running along the admin frontage six metres ahead of the spawn, stopping short of
       * the 9105 crater at (38, -10.5) rather than driving through its lip.
       */
      // The two shell craters and the burst emplacement in this rect own no collider, so at the
      // raised density the fill would otherwise scatter grit straight through their bowls.
      avoid: [[22.5, -8.5, 2.7], [38.0, -10.5, 2.5], [21.8, -12.8, 2.0]],
      ruts: [[35.4, -5.4, 44.6, -8.6], [32.6, -4.9, 32.5, -11.4], [25.0, -12.5, 34.5, -12.6]],
      marks: [
        [22.4, -5.5, 43.8, -5.7, 0.1, 0.3],
        [26.6, -6.4, 26.6, -11.4, 0.085, 0.44],
        [30.6, -6.4, 30.6, -11.4, 0.085, 0.5],
        [34.6, -6.4, 34.6, -11.4, 0.085, 0.56],
        [38.6, -6.4, 38.6, -11.4, 0.085, 0.62],
      ],
      // The third cover sits between the 26.6 and 30.6 markings, clear of the new rut at 32.6.
      drains: [[24.6, -6.7, 0.4], [41.4, -7.3, 0.15], [28.4, -9.6, 1.05]],
      patches: 6,
      anchors: 4,
    },
    {
      // The depot's north apron: the strip between the shed wall and the ballast of road 5.
      seed: 9602,
      wear: 0.95,
      rect: [-49.4, -7.3, -22.8, -4.6],
      lines: [[-47.0, -6.9, -24.0, -7.1], [-42.0, -5.4, -38.5, -7.2]],
      avoid: [[-31.6, -6.6, 3.2]],
      // Stops at x -36.5: any further east and the rut runs into the blast spoil at (-31.6, -6.6).
      ruts: [[-46.5, -5.2, -36.5, -5.4]],
      marks: [[-46.6, -4.9, -25.0, -5.1, 0.095, 0.42]],
      drains: [[-44.2, -5.4, 0.9], [-27.0, -6.2, 0.3]],
      patches: 3,
      anchors: 2,
    },
    {
      // The depot's east approach: the long open bay between the shed's east elevation and
      // the northern container group. Two flanking routes cross it, so it is walked hard.
      seed: 9603,
      wear: 1.0,
      rect: [-17.4, -33.6, -3.6, -10.6],
      lines: [
        [-16.6, -11.4, -4.4, -11.6],
        [-9.0, -11.0, -9.6, -32.4],
        [-16.2, -30.4, -5.2, -27.2],
      ],
      // The 8751 scaffold bundle at (-20.6, -22.5) used to be listed here and could never fire:
      // its west edge is 3.2 m outside this rect's x0, and it stands its own collider anyway.
      avoid: [[-16.5, -25.0, 2.6], [-17.0, -12.5, 2.7]],
      // The second run keeps east of x -13: the 9101 crater sits at (-17, -12.5) with a 2.8 m
      // lip and a flat rut laid over a depression is the clearest possible tell.
      ruts: [[-15.4, -12.6, -14.6, -30.0], [-13.0, -11.6, -4.2, -11.9]],
      marks: [[-16.0, -13.4, -4.4, -13.6, 0.09, 0.52]],
      drains: [[-6.2, -13.2, 1.3], [-12.4, -20.6, 0.8]],
      patches: 4,
      anchors: 4,
    },
    {
      // THE YARD, the four 8 m bays between the running lines. The container rows stand on
      // their midlines out at the ends, so what this dresses is the open lane in the middle
      // of each — the ground the player crosses under the crane.
      seed: 9604,
      wear: 0.8,
      rect: [-42.0, 0.7, 41.0, 3.3],
      lines: [[-8.6, 0.5, -8.6, 3.5], [-24.0, 0.7, -24.0, 3.3], [14.0, 0.7, 14.4, 3.3]],
      // The 9203 burst emplacement carries no collider of its own.
      avoid: [[13.1, 3.2, 2.9]],
      patches: 1,
      anchors: 3,
    },
    {
      seed: 9605,
      wear: 0.8,
      rect: [-42.0, 8.7, 41.0, 11.3],
      lines: [[-8.6, 8.5, -8.6, 11.5], [-19.0, 8.7, -19.0, 11.3], [12.0, 8.7, 12.4, 11.3]],
      patches: 1,
      anchors: 2,
    },
    {
      seed: 9606,
      wear: 0.78,
      rect: [-42.0, 16.7, 39.0, 19.3],
      lines: [[-8.6, 16.5, -8.6, 19.5], [6.0, 16.7, 6.4, 19.3], [-30.0, 16.7, -30.0, 19.3]],
      patches: 1,
      anchors: 3,
    },
    {
      // The apron the `yardBack` vantage stands on and looks straight down: its near ground is
      // this strip, so it gets the same treatment as the terraces forecourt rather than the
      // thinner dressing the other inter-road bays carry.
      seed: 9607,
      wear: 0.82,
      rect: [-41.0, 24.7, 37.0, 27.3],
      lines: [[-8.6, 24.5, -8.6, 27.5], [-26.0, 24.7, -26.0, 27.3], [10.0, 24.7, 10.4, 27.3], [2.0, 24.7, 2.2, 27.3]],
      drains: [[-4.4, 26.0, 0.6]],
      patches: 2,
      anchors: 3,
    },
    {
      // The north-east outer bay behind the dock, which the wide vantage looks straight down.
      seed: 9608,
      wear: 0.9,
      rect: [28.0, 32.6, 46.6, 40.4],
      lines: [[28.6, 34.8, 45.2, 33.6], [34.0, 33.2, 34.2, 39.6]],
      ruts: [[29.0, 36.4, 44.4, 35.0]],
      marks: [[30.0, 39.0, 45.4, 38.6, 0.1, 0.6]],
      drains: [[31.4, 34.0, 0.7]],
      patches: 2,
      anchors: 2,
    },
    {
      // The admin approach road, the terraces' western flanking route.
      seed: 9609,
      wear: 1.0,
      rect: [12.9, -33.2, 19.1, -18.8],
      lines: [[15.6, -33.0, 16.0, -18.9]],
      marks: [[15.8, -32.4, 16.0, -19.4, 0.095, 0.66], [18.5, -32.0, 18.6, -19.6, 0.085, 0.5]],
      drains: [[13.8, -24.6, 0.2]],
      patches: 2,
      anchors: 1,
    },
    /*
     * The three bays below extend the table above rather than adding a second pass — same
     * `fillBay`, same instance sets, same rules. They were found by walking the shipped
     * vantages against the nine rects above and asking which open ground *no* rect reaches:
     *
     *  - the yard road itself, which the first pass dressed either side of and then left bare
     *    down the middle;
     *  - the south-central field, which is the whole near ground of the `sunline` vantage;
     *  - the outer yard west of the dock, which `wide` looks straight across.
     *
     * None of the three overlaps an existing rect, so no square metre is scattered twice.
     */
    {
      // THE YARD ROAD. `ROAD_ZONES` makes x -22..20, z -9..-3 asphalt, and it is the spine
      // every route in the map joins: the depot apron feeds it, both terraces flanks leave
      // off it, and the boarded crossings step off it. The first pass put grit in both kerbs
      // (7401/7402) and litter along the z = -6 line and then stopped, so the carriageway —
      // 40 m of it, dead centre of the depot and sunline frames — was the cleanest surface in
      // a bombed freight yard. A road is the one piece of ground guaranteed to be filthy, so
      // this runs at full wear with its lines laid straight down the running direction.
      seed: 9610,
      wear: 1.0,
      rect: [-21.4, -8.9, 18.8, -4.8],
      lines: [
        [-21.0, -6.4, 18.4, -6.1],
        [-21.0, -8.2, -5.6, -8.0],
        [-2.2, -6.6, 16.0, -6.0],
      ],
      // The spools, the crossing approach and the two manhole covers `groundClutter` already
      // put down here carry no collider tall enough for `bayClear` to see, or none at all.
      avoid: [[-14.5, -6.9, 1.5], [-13.0, -7.6, 1.3], [-8.5, -6.4, 2.2], [-12.0, -6.2, 0.8], [8.0, -6.2, 0.8]],
      marks: [
        [-20.0, -4.95, 17.6, -4.85, 0.1, 0.45],
        [-20.2, -8.75, -6.2, -8.65, 0.1, 0.55],
        [2.0, -8.75, 17.6, -8.7, 0.1, 0.5],
      ],
      patches: 4,
      // The carriageway is 4 m deep and the desire lines run down all of it, so `dressBay`'s
      // "more than 2.2 m off a line" test will reject most candidates and place one or two.
      // That is the correct answer for a road: nothing stands in a live traffic lane.
      anchors: 2,
    },
    {
      // The south-central field between the depot's east approach and the admin road. The
      // `sunline` vantage stands at (-2, -14) and looks east down it, so this is that frame's
      // entire near ground; it is also the open half of the southern flanking route.
      seed: 9611,
      wear: 0.85,
      rect: [-3.2, -32.4, 12.2, -14.2],
      lines: [[-2.8, -15.0, 11.8, -16.2], [4.0, -14.4, 5.2, -31.8], [-2.6, -30.6, 9.0, -28.4]],
      // 605 is a rubble heap and the spool and the tyres are low: none of them owns a collider
      // this pass can see, and grit scattered through a heap reads as a bug.
      avoid: [[2.0, -22.0, 4.3], [4.5, -17.5, 1.4], [-2.5, -18.0, 1.5]],
      ruts: [[6.6, -15.2, 7.4, -30.8]],
      marks: [[-2.4, -14.6, 11.6, -15.0, 0.09, 0.6]],
      // Clear of the x = 10.5 container column, whose boxes reach out to x 9.15.
      drains: [[7.8, -20.4, 1.1]],
      patches: 3,
      anchors: 3,
    },
    {
      // The outer yard north of road 1 and west of the dock. Nothing structural stands in it,
      // which is exactly why it was bare: the edge-dressing passes had no edges to work off
      // between the container block at x -38 and the dock ramp at x -16.
      seed: 9612,
      wear: 0.7,
      rect: [-45.6, 32.8, -18.4, 40.4],
      lines: [[-45.0, 34.6, -19.0, 34.2], [-28.0, 33.0, -27.4, 39.8]],
      // Kept south of z 35.4: the two-wide container block sits on z 36.65 and its boxes are
      // 2.438 m across, so a rut any further north would run underneath them.
      ruts: [[-44.0, 34.9, -21.0, 34.1]],
      marks: [[-44.6, 39.2, -20.0, 39.0, 0.1, 0.62]],
      drains: [[-24.6, 33.6, 1.5]],
      patches: 2,
      anchors: 3,
    },
  ];

  /** Species weights, refilled in place — this runs a thousand times at load, so no garbage. */
  const _bayW = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  /** Distance from (x, z) to the nearest of a bay's desire lines. */
  function desireDist(x, z, lines) {
    let best = 1e9;
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      const dx = L[2] - L[0];
      const dz = L[3] - L[1];
      const dd = dx * dx + dz * dz;
      const t = dd > 1e-6 ? clamp(((x - L[0]) * dx + (z - L[1]) * dz) / dd, 0, 1) : 0;
      const ex = x - (L[0] + dx * t);
      const ez = z - (L[1] + dz * t);
      const d = Math.sqrt(ex * ex + ez * ez);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Is (x, z) open ground? Tested against the live collider list rather than against a hand
   * table of exclusions, because this pass runs last and the collider list by then *is* the
   * map — which means a prop added anywhere else in this file is automatically respected here
   * without anybody having to remember to come back and update a rectangle.
   */
  function bayClear(x, z, margin) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      // Kerbs, ducts and the odd low kerb-height slab are dressed over, not walked round.
      if (c.max.y < 0.14) continue;
      if (x > c.min.x - margin && x < c.max.x + margin && z > c.min.z - margin && z < c.max.z + margin) return false;
    }
    // Ballast shoulders stand 0.26 m proud and `groundY` knows nothing about them, so anything
    // planted on a crest is buried to its neck in stone. Same for the depot spur.
    for (let i = 0; i < TRACK_Z.length; i++) if (Math.abs(z - TRACK_Z[i]) < 2.5) return false;
    if (Math.abs(z - SPUR_Z) < 2.5 && x > DEPOT.x1 - 1) return false;
    // Interiors and the dock deck own their own dressing and sit at their own levels.
    if (inRect(x, z, [DEPOT.x0 - 0.6, DEPOT.z0 - 0.6, DEPOT.x1 + 0.6, DEPOT.z1 + 0.6])) return false;
    if (inRect(x, z, [ADMIN.x0 - 0.6, ADMIN.z0 - 0.6, ADMIN.x1 + 0.6, ADMIN.z1 + 0.6])) return false;
    if (inRect(x, z, [DOCK.x0 - 0.4, DOCK.z0 - 0.4, DOCK.x1 + 0.4, DOCK.z1])) return false;
    return true;
  }

  /** `bayClear` plus the bay's own list of collider-free masses to stay out of. */
  function bayOpen(bay, x, z, margin) {
    if (bay.avoid) {
      for (let i = 0; i < bay.avoid.length; i++) {
        const a = bay.avoid[i];
        const dx = x - a[0];
        const dz = z - a[1];
        if (dx * dx + dz * dz < a[2] * a[2]) return false;
      }
    }
    return bayClear(x, z, margin);
  }

  /**
   * One piece of area fill. `wear` is 1 on a desire line and decays away from it, and it
   * picks the species as well as gating the amount — see rule 2 above.
   */
  function bayPiece(x, z, wear, r2) {
    const y = groundY(x, z);
    const tone = 0.58 + r2() * 0.62;
    _bayW[0] = 0.26 + 0.18 * wear; // grit drift
    _bayW[1] = 0.30 - 0.24 * wear; // growth
    _bayW[2] = 0.08 + 0.10 * wear; // litter
    _bayW[3] = 0.06 + 0.05 * wear; // scrap steel
    _bayW[4] = 0.07; // timber
    _bayW[5] = 0.06; // brick
    _bayW[6] = 0.05 - 0.02 * wear; // broken concrete
    _bayW[7] = 0.05; // kerb fragment
    _bayW[8] = 0.03 + 0.04 * wear; // pipe / bar
    _bayW[9] = 0.13 + 0.15 * wear; // flat ground tone
    let total = 0;
    for (let i = 0; i < _bayW.length; i++) total += _bayW[i];
    let pick = r2() * total;
    let k = 0;
    while (k < _bayW.length - 1 && pick > _bayW[k]) {
      pick -= _bayW[k];
      k++;
    }

    if (k === 0) {
      // Grit, never one stone: a 7 cm pebble at eight metres is a pixel, a handful is a drift.
      // The stones now ride a thin dirt blob rather than sitting on bare hardstanding. That
      // blob is the important half: a pebble is a few pixels of silhouette and contributes
      // nothing to how the *ground* reads, whereas half a square metre of value break is
      // exactly what a plane is missing, and it costs nine triangles.
      const rr = 0.42 + r2() * 0.48;
      place(x, y + 0.006 + r2() * 0.0016, z, r2() * 6.28);
      blobXZ(GT('dirt', 0.35), rr, 0.6 + r2() * 0.5, (r2() * 1e6) | 0,
        [T.gravel[0] * tone * 1.04, T.gravel[1] * tone, T.gravel[2] * tone * 0.96], 9, 0);
      popX();
      const n = 4 + ((r2() * 5) | 0);
      for (let s = 0; s < n; s++) {
        const px = x + (r2() - 0.5) * rr * 2.1;
        const pz = z + (r2() - 0.5) * rr * 2.1;
        addInstance(
          stoneSet, px, groundY(px, pz) + 0.015, pz,
          r2() * 6.28, (r2() - 0.5) * 1.6, (r2() - 0.5) * 1.6,
          0.5 + r2() * 1.05,
          [T.gravel[0] * tone, T.gravel[1] * tone, T.gravel[2] * tone]
        );
      }
    } else if (k === 1) {
      // Growth, through the cracks. Tufts are taller and read at range; weeds fill under them.
      const n = 1 + ((r2() * 2) | 0);
      for (let s = 0; s < n; s++) {
        const px = x + (r2() - 0.5) * 0.7;
        const pz = z + (r2() - 0.5) * 0.7;
        addInstance(
          r2() < 0.45 ? setWeed : setTuft, px, groundY(px, pz), pz,
          r2() * 6.28, 0, 0,
          0.6 + r2() * 0.85,
          [T.weeds[0] * tone, T.weeds[1] * tone, T.weeds[2] * tone]
        );
      }
    } else if (k === 2) {
      addInstance(
        setLitter, x, y + 0.012, z,
        r2() * 6.28, (r2() - 0.5) * 0.45, (r2() - 0.5) * 0.45,
        0.6 + r2() * 0.7,
        [T.paper[0] * tone, T.paper[1] * tone, T.paper[2] * tone]
      );
    } else if (k === 3) {
      addInstance(
        setScrap, x, y + 0.02, z,
        r2() * 6.28, 0, (r2() - 0.5) * 0.3,
        0.6 + r2() * 1.15,
        [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone]
      );
    } else if (k === 4) {
      addInstance(
        setDebris, x, y + 0.02, z,
        r2() * 6.28, 0, (r2() - 0.5) * 0.3,
        0.5 + r2() * 1.1,
        [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone]
      );
      if (r2() < 0.35) {
        const px = x + (r2() - 0.5) * 0.6;
        const pz = z + (r2() - 0.5) * 0.6;
        addInstance(setOffcut, px, groundY(px, pz) + 0.03, pz, r2() * 6.28, 0, (r2() - 0.5) * 0.2,
          0.7 + r2() * 0.6, [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone]);
      }
    } else if (k === 5) {
      // Bricks come off a wall in twos and threes, never singly.
      const n = 1 + ((r2() * 3) | 0);
      for (let s = 0; s < n; s++) {
        const px = x + (r2() - 0.5) * 0.55;
        const pz = z + (r2() - 0.5) * 0.55;
        addInstance(setBrick, px, groundY(px, pz) + 0.035, pz, r2() * 6.28, (r2() - 0.5) * 0.9, (r2() - 0.5) * 0.9,
          0.8 + r2() * 0.55, [T.brick[0] * tone, T.brick[1] * tone, T.brick[2] * tone]);
      }
    } else if (k === 6) {
      addInstance(
        chunkSet, x, y + 0.09, z,
        r2() * 6.28, (r2() - 0.5) * 1.3, (r2() - 0.5) * 1.3,
        0.7 + r2() * 0.9,
        [T.concreteWorn[0] * tone, T.concreteWorn[1] * tone, T.concreteWorn[2] * tone]
      );
    } else if (k === 7) {
      // A kerb out of the edging, dragged clear and dumped. Half of them keep a stub of the
      // bedding mortar, which is why the second one lands hard against the first.
      const yaw = r2() * 6.28;
      addInstance(setKerbFrag, x, y, z, yaw, 0, (r2() - 0.5) * 0.5, 0.85 + r2() * 0.45,
        [T.kerb[0] * tone, T.kerb[1] * tone, T.kerb[2] * tone]);
      if (r2() < 0.45) {
        const px = x + Math.cos(yaw) * 0.42 + (r2() - 0.5) * 0.2;
        const pz = z - Math.sin(yaw) * 0.42 + (r2() - 0.5) * 0.2;
        // Rolled onto its back, not stood on end: the roll is about local X, which keeps the
        // 0.6 m length lying along the ground. A Z rotation would stand it upright like a post.
        addInstance(setKerbFrag, px, groundY(px, pz) + 0.06, pz, yaw + (r2() - 0.5) * 0.7,
          1.5 + r2() * 0.3, 0, 0.8 + r2() * 0.4,
          [T.kerb[0] * tone * 0.94, T.kerb[1] * tone * 0.94, T.kerb[2] * tone]);
      }
      dustSkirt(x, z, 0.5, 0.045, (r2() * 1e6) | 0, null);
    } else if (k === 8) {
      // A length of pipe or a bar off a load, with the grit that has banked along its lee.
      // The pipe is modelled on its axis, so the lift has to scale with it or a big one floats.
      const ps = 0.7 + r2() * 0.55;
      addInstance(setPipe, x, y + 0.05 * ps, z, r2() * 6.28, 0, (r2() - 0.5) * 0.12,
        ps, [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone]);
      if (r2() < 0.5) {
        const px = x + (r2() - 0.5) * 0.9;
        const pz = z + (r2() - 0.5) * 0.9;
        addInstance(setOffcut, px, groundY(px, pz) + 0.03, pz, r2() * 6.28, 0, (r2() - 0.5) * 0.25,
          0.8 + r2() * 0.6, [T.rustDeep[0] * tone, T.rustDeep[1] * tone, T.rustDeep[2] * tone]);
      }
    } else {
      /*
       * Ground tone, and this is the species the "bare unbroken plane" finding is really about.
       *
       * Every other entry in this table is a *prop*: it has a silhouette, it is a few pixels
       * across at eight metres, and a hundred of them still leave the floor between them one
       * flat value. What a working surface actually has is large-scale tonal variation — the
       * dark polish traffic grinds into a desire line, the pale drift of ash and fines that
       * settles either side of it — and that is area, not objects.
       *
       * Nine triangles buys a square metre of it, so this is by a wide margin the cheapest
       * thing in the pass and the one doing the most work. It follows the same wear term as
       * everything else, which is what stops it reading as a stain applied at random: dark on
       * the line where the tyres are, pale off it where nothing has been driven in years.
       */
      const onLine = wear > 0.52;
      const rr = 0.55 + r2() * (onLine ? 0.75 : 0.6);
      // The polish never goes below about half: `T.grime` is already a 0.59 multiplier, so
      // 0.6 x 0.59 lands at 0.35 of the surface under it — a clear value break, and still short
      // of the black hole a harder number would punch in the floor.
      const tn = onLine ? 0.6 + r2() * 0.3 : 0.92 + r2() * 0.3;
      const tt = onLine
        ? [T.grime[0] * tn, T.grime[1] * tn, T.grime[2] * tn * 1.05]
        : [T.dirt[0] * tn, T.dirt[1] * tn, T.dirt[2] * tn * 0.95];
      // Two bands, never one height: the polish rides under the tyre ruts at 0.011 and the
      // drift rides over them, and each piece is jittered inside its band so two overlapping
      // blobs can never come out coplanar.
      const yb = (onLine ? 0.0086 : 0.0122) + r2() * 0.0016;
      place(x, y + yb, z, r2() * 6.28);
      blobXZ(onLine ? GT('asphalt', 0.35) : GT('dirt', 0.35), rr, 0.4 + r2() * 0.55,
        (r2() * 1e6) | 0, tt, 9, 0);
      popX();
    }
  }

  /**
   * A reinstatement patch: the rectangle a service trench was sawn out of the hardstanding and
   * filled back in, plus the seal bleeding a hand's width past the cut.
   *
   * Deliberately the one hard-edged, straight-sided thing this pass lays down. Everything else
   * here is organic scatter, and a floor made only of scatter still reads as noise however
   * much of it there is — the eye needs a man-made straight line per bay to measure the space
   * against, and a patch also explains where the drains and the ducts run.
   */
  function surfacePatch(x, z, hx, hz, yaw, seedN) {
    const g = GT('asphalt', 0.35);
    const r2 = mulberry32(seedN);
    place(x, groundY(x, z), z, yaw);
    // The seal: one size up, ragged, and paler because the bitumen has bloomed to grey.
    const st = mixTint(T.grime, T.asphalt, 0.55);
    _bp.length = 0;
    for (let i = 0; i < 4; i++) {
      const sx = i === 0 || i === 3 ? -1 : 1;
      const sz = i < 2 ? -1 : 1;
      _bp.push(sx * (hx + 0.07 + r2() * 0.1), 0.014, sz * (hz + 0.07 + r2() * 0.1));
    }
    gpoly(g, _bp, 0, 1, 0, st);
    // The patch itself: darker, fresher, and sitting a couple of millimetres proud of it.
    _bp.length = 0;
    for (let i = 0; i < 4; i++) {
      const sx = i === 0 || i === 3 ? -1 : 1;
      const sz = i < 2 ? -1 : 1;
      _bp.push(sx * hx * (0.94 + r2() * 0.09), 0.0165, sz * hz * (0.94 + r2() * 0.09));
    }
    gpoly(g, _bp, 0, 1, 0, [T.grime[0] * 0.82, T.grime[1] * 0.82, T.grime[2] * 0.86]);
    popX();
  }

  /**
   * What is left of a painted marking. Emitted as dashes with a wear-out probability, because
   * a line on a working surface goes in the wheel tracks first and survives at the edges — a
   * continuous line reads as freshly laid, which is the opposite of the story.
   *
   * Rides in the `concretePanel` buffer, where a bright tint off `T.paint` lands as chalky
   * white; on the asphalt buffer the same tint would only ever be dark grey.
   */
  function paintedLine(x0, z0, x1, z1, w, gone, seedN) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5) return;
    const yaw = runYaw(x1 - x0, z1 - z0);
    const g = G('concretePanel');
    const r2 = mulberry32(seedN);
    const segs = Math.max(2, Math.round(len / 0.62));
    place((x0 + x1) * 0.5, 0, (z0 + z1) * 0.5, yaw);
    for (let i = 0; i < segs; i++) {
      const f0 = i / segs;
      const f1 = (i + 1) / segs;
      const skip = r2() < gone;
      const hw = w * (0.62 + r2() * 0.5);
      const tone = 0.6 + r2() * 0.44;
      if (skip) continue;
      const a = -len * 0.5 + f0 * len + 0.04;
      const b = -len * 0.5 + f1 * len - 0.04;
      // The run is yawed, so local Y is still world Y and the strip can follow the ground.
      const ya = groundY(lerp(x0, x1, f0), lerp(z0, z1, f0)) + 0.019;
      const yb = groundY(lerp(x0, x1, f1), lerp(z0, z1, f1)) + 0.019;
      _bp.length = 0;
      _bp.push(a, ya, -hw, b, yb, -hw, b, yb, hw, a, ya, hw);
      gpoly(g, _bp, 0, 1, 0, [T.paint[0] * tone, T.paint[1] * tone, T.paint[2] * tone]);
    }
    popX();
  }

  /**
   * The man-made half of a bay: the ruts down its desire lines, the markings, the drain covers
   * and the patches, plus two or three pieces of yard furniture with real height.
   *
   * The anchors are the part that stops the bay reading as a *textured* plane rather than an
   * inhabited one. Scatter gives the ground grain; only something knee-high gives it parallax,
   * a cast shadow at 8° of key elevation, and a scale reference. They go where the traffic
   * does not, because that is the only place anybody would leave something standing.
   */
  function dressBay(bay) {
    const r2 = mulberry32(bay.seed + 977);
    const rect = bay.rect;

    if (bay.ruts) {
      for (let i = 0; i < bay.ruts.length; i++) {
        const R = bay.ruts[i];
        tyreTrack(R[0], R[1], R[2], R[3], 2.0, bay.seed + 30 + i, { wander: 0.14, y: 0.0116 });
      }
    }
    if (bay.marks) {
      for (let i = 0; i < bay.marks.length; i++) {
        const m = bay.marks[i];
        paintedLine(m[0], m[1], m[2], m[3], m[4], m[5], bay.seed + 60 + i);
      }
    }
    if (bay.drains) {
      for (let i = 0; i < bay.drains.length; i++) {
        const d = bay.drains[i];
        if (!bayOpen(bay, d[0], d[1], 0.6)) continue;
        manhole(d[0], d[1], d[2]);
        gravelDrift(d[0] - 0.5, d[1] - 0.52, d[0] + 0.5, d[1] - 0.52, -1, bay.seed + 80 + i, 1.6);
      }
    }

    /*
     * Oil where the traffic stands, as opposed to the hand-placed stains in `dressGround`,
     * which mark where the *machines* stood. A spill is a consequence of a route, so it belongs
     * on the desire line and not in a table. Laid at 0.0104 so it can never come out coplanar
     * with one of those hand-placed stains, which sit at the default 0.01.
     */
    const spills = bay.spills === undefined ? Math.round(2.4 * (bay.wear === undefined ? 1 : bay.wear)) : bay.spills;
    for (let i = 0; i < spills; i++) {
      const L = bay.lines[(r2() * bay.lines.length) | 0];
      const f = 0.12 + r2() * 0.76;
      const px = lerp(L[0], L[2], f) + (r2() - 0.5) * 1.4;
      const pz = lerp(L[1], L[3], f) + (r2() - 0.5) * 1.4;
      if (px < rect[0] || px > rect[2] || pz < rect[1] || pz > rect[3]) continue;
      if (!bayOpen(bay, px, pz, 0.8)) continue;
      oilStain(px, pz, 0.65 + r2() * 0.85, 0.5 + r2() * 0.45, r2() * 3.14, bay.seed + 160 + i, 0.0104);
    }

    // Patches follow the routes, because that is where the services were laid.
    const patches = bay.patches || 0;
    for (let i = 0; i < patches; i++) {
      const L = bay.lines[(r2() * bay.lines.length) | 0];
      const f = 0.16 + r2() * 0.68;
      const px = lerp(L[0], L[2], f) + (r2() - 0.5) * 2.4;
      const pz = lerp(L[1], L[3], f) + (r2() - 0.5) * 2.4;
      if (px < rect[0] || px > rect[2] || pz < rect[1] || pz > rect[3]) continue;
      if (!bayOpen(bay, px, pz, 0.9)) continue;
      surfacePatch(px, pz, 0.55 + r2() * 1.05, 0.38 + r2() * 0.62,
        runYaw(L[2] - L[0], L[3] - L[1]) + (r2() - 0.5) * 0.3, bay.seed + 100 + i);
    }

    const anchors = bay.anchors === undefined ? 0 : bay.anchors;
    for (let i = 0; i < anchors; i++) {
      let px = 0;
      let pz = 0;
      let ok = false;
      for (let a = 0; a < 16 && !ok; a++) {
        px = lerp(rect[0] + 1.4, rect[2] - 1.4, r2());
        pz = lerp(rect[1] + 1.0, rect[3] - 1.0, r2());
        ok = desireDist(px, pz, bay.lines) > 2.2 && bayOpen(bay, px, pz, 1.8);
      }
      if (!ok) continue;
      const seedN = bay.seed + 130 + i * 7;
      const yaw = r2() * 6.28;
      const kind = (r2() * 5) | 0;
      if (kind === 0) {
        tyrePile(px, pz, 4 + ((r2() * 3) | 0), seedN);
      } else if (kind === 1) {
        timberOffcuts(px, pz, lod > 0 ? 7 : 4, seedN);
        addInstance(setCone, px + 0.9, groundY(px + 0.9, pz - 0.6), pz - 0.6, yaw, 0, 0, 1, grey(0.9 + r2() * 0.3));
      } else if (kind === 2) {
        jerryRow(px, pz, yaw, 3 + ((r2() * 2) | 0), seedN);
        litterCatch(px + 0.7, pz + 0.5, yaw, lod > 0 ? 3 : 2, seedN + 1);
      } else if (kind === 3) {
        // A short pallet stack with one leaning off it. Slot-sided, so it reads instantly.
        const n = 3 + ((r2() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const tone = 0.72 + hash2(seedN + k, 6) * 0.5;
          addInstance(setPallet, px + (hash2(k, seedN) - 0.5) * 0.1, groundY(px, pz) + k * 0.145,
            pz + (hash2(k, seedN + 5) - 0.5) * 0.1, yaw + (hash2(k, seedN + 9) - 0.5) * 0.08, 0, 0, 1,
            [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone]);
        }
        addInstance(setPallet, px + Math.cos(yaw) * 0.78, groundY(px, pz) + 0.5, pz - Math.sin(yaw) * 0.78,
          yaw + 0.5, 0, 1.3, 1, T.woodDark);
        solidBox(px, groundY(px, pz) + n * 0.0725, pz, 0.62, n * 0.0725, 0.42, 'wood', yaw, { cover: false });
        dustSkirt(px, pz, 0.92, 0.09, seedN + 2, null);
      } else {
        // A slab levered out of the surface and left on edge, with its rebar showing.
        const s = 1.5 + r2() * 0.7;
        const rz = (r2() < 0.5 ? -1 : 1) * (0.7 + r2() * 0.45);
        const rest = (0.42 * Math.abs(Math.sin(rz)) + 0.1 * Math.abs(Math.cos(rz))) * s;
        const tone = 0.8 + r2() * 0.32;
        addInstance(setSlab, px, groundY(px, pz) + rest * 0.74, pz, yaw, 0, rz, s,
          [T.concreteWorn[0] * tone, T.concreteWorn[1] * tone, T.concreteWorn[2] * tone]);
        dustSkirt(px, pz, 0.78, 0.1, seedN + 3, null);
      }

      /*
       * The drift behind the anchor. Whatever the anchor is, it is the first thing the wind has
       * met in twenty metres of open bay, so grit banks against its windward face and paper
       * piles in its lee — and that, rather than the prop itself, is what stops it looking
       * dropped onto the floor. It also puts a second, softer mass at every anchor, which is
       * what gives the bay a rhythm of light and dark instead of one even speckle.
       */
      litterCatch(px + Math.cos(yaw) * 0.95, pz - Math.sin(yaw) * 0.95, yaw, lod > 0 ? 3 : 2, seedN + 5);
      gravelDrift(
        px - Math.cos(yaw + 1.57) * 0.8, pz + Math.sin(yaw + 1.57) * 0.8,
        px + Math.cos(yaw + 1.57) * 0.8, pz - Math.sin(yaw + 1.57) * 0.8,
        1, seedN + 6, 2.2
      );
    }
  }

  function fillBay(bay) {
    const rect = bay.rect;
    const r2 = mulberry32(bay.seed);
    /*
     * 0.92 m, down from 1.15.
     *
     * 1.15 was set from the geometry of the cell — the largest spacing that leaves no bare
     * metre — and that reasoning was wrong, because "no bare metre" is not the bar. A native-
     * resolution render of the terraces forecourt at 1.15 came back with roughly one piece per
     * two square metres and it still read as an unbroken plane with chips on it: at eight
     * metres a 10 cm stone is four pixels, so sparse small props do not make ground read as
     * inhabited, they make it read as clean ground with litter. The bar is *coverage*, which
     * needs both a shorter spacing and the flat tonal species added above.
     *
     * 0.92 is 1.56x the cell count for the same rects. Measured, the whole pass lands under
     * 70k triangles, most of it instanced.
     */
    const CELL = 0.92;
    const nx = Math.max(1, Math.round((rect[2] - rect[0]) / CELL));
    const nz = Math.max(1, Math.round((rect[3] - rect[1]) / CELL));
    const cw = (rect[2] - rect[0]) / nx;
    const cd = (rect[3] - rect[1]) / nz;
    const gate = lod > 1 ? 1 : lod > 0 ? 0.86 : 0.5;
    const bw = bay.wear === undefined ? 1 : bay.wear;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const x = rect[0] + (ix + 0.12 + r2() * 0.76) * cw;
        const z = rect[1] + (iz + 0.12 + r2() * 0.76) * cd;
        // Gaussian, not linear: a linear falloff leaves a visible edge to the dirty band, and
        // a working surface has no edge — it just gets cleaner until it is growing over.
        const d = desireDist(x, z, bay.lines);
        const wear = Math.exp(-(d * d) / 18);
        if (r2() > (0.34 + 0.58 * wear) * bw * gate) continue;
        if (!bayOpen(bay, x, z, 0.5)) continue;
        bayPiece(x, z, wear, r2);
      }
    }
    dressBay(bay);
  }

  function openBays() {
    for (let i = 0; i < OPEN_BAYS.length; i++) fillBay(OPEN_BAYS[i]);
  }

  /** Walls: rainwater goods, services, fittings, signage, stencils and the stains off them. */
  function dressWalls() {
    /* --- the depot ------------------------------------------------------- */
    // East elevation faces the yard and carries the roller door; the blank piers either side
    // of it are the largest unbroken wall in the map from the yard vantage.
    {
      const gB = G('brickPainted');
      const gC = G('corrugatedSteel');
      const zOut = DEPOT.x1 + 0.2;
      // Buckets are fetched *at the wall*, not at the origin: `bucket` keys on the chunk the
      // transform stack is standing in, and taking them at identity would drag one quadrant's
      // bounding sphere across the whole map and stop it culling.
      const gm = bucketAt('metalRust', DEPOT.x1, (DEPOT.z0 + DEPOT.z1) * 0.5);
      // Local frame: X along the run (world -Z), +Z out of the face (world +X).
      place(DEPOT.x1, 0, (DEPOT.z0 + DEPOT.z1) * 0.5, Math.PI * 0.5);
      wallFittings(gm, gB, -15.4, -10.0, 2.6, 0.2, 8101, { sign: '14', stencil: 'D-2', louvre: true });
      wallFittings(gm, gB, 0.5, 8.6, 2.6, 0.2, 8102, { sign: 'B7', stencil: '204', lampAt: 0.35 });
      wallFittings(gm, gB, 10.8, 15.4, 2.6, 0.2, 8103, { stencil: 'KL 6', louvre: true });
      // Cladding above the dado: sheeting bolts bleed, and the eaves gutter overflows.
      for (let i = 0; i < 22; i++) {
        const px = -15.2 + i * 1.42;
        rustWash(gC, px, DEPOT.eave - 0.12, 1.6 + hash2(i, 5) * 2.6, 0.14, 3, 0.13, T.rustWash, 8110 + i);
        if (i % 4 === 2) rustWash(gC, px, 5.6, 1.3, 0.1, 2, 0.13, T.rustWash, 8140 + i);
      }
      // Shrapnel across the piers nearest the yard's open ground.
      pockMarks(gB, -12.6, 1.5, 2.4, 1.1, 26, 0.205, 8150, 0.3, -0.4);
      pockMarks(gB, 4.5, 1.4, 3.6, 1.1, 30, 0.205, 8151, -0.2, -0.3);
      pockMarks(gC, 4.0, 4.2, 4.0, 1.2, 22, 0.13, 8152, 0.1, -0.2);
      popX();
      // Rainwater goods on the bays the original build left bare.
      downpipe(zOut + 0.08, DEPOT.z0 + 9.0, DEPOT.eave, Math.PI, gm);
      downpipe(zOut + 0.08, DEPOT.z1 - 9.5, DEPOT.eave, Math.PI, gm);
      downpipe(DEPOT.x0 - 0.28, DEPOT.z0 + 9.0, DEPOT.eave, 0, gm);
    }
    // South gable — the elevation every approach from the yard sees first.
    {
      const gB = G('brickPainted');
      const gC = G('corrugatedSteel');
      const cx = (DEPOT.x0 + DEPOT.x1) * 0.5;
      const gm = bucketAt('metalRust', cx, DEPOT.z1);
      place(cx, 0, DEPOT.z1, 0);
      wallFittings(gm, gB, -14.6, -4.2, 2.6, 0.2, 8201, { sign: 'D2', stencil: 'SHED 2', stencilSize: 0.07, louvre: true });
      wallFittings(gm, gB, -1.8, 5.5, 2.6, 0.2, 8202, { stencil: '14', stencilSize: 0.1, lampAt: 0.3 });
      wallFittings(gm, gB, 11.5, 14.6, 2.6, 0.2, 8203, { sign: 'H4' });
      // A big painted door reference beside the personnel door, half weathered away.
      stencilText(gB, 'NO 2', -6.4, 2.15, 0.075, T.paint, 0.206);
      for (let i = 0; i < 16; i++) {
        const px = -14.4 + i * 1.9;
        rustWash(gC, px, DEPOT.eave - 0.15, 1.4 + hash2(i, 9) * 2.2, 0.16, 3, 0.13, T.rustWash, 8210 + i);
      }
      // The blast that opened this gable pocked everything either side of the hole.
      pockMarks(gB, 4.0, 1.5, 1.7, 1.1, 24, 0.205, 8230, -0.6, 0.2);
      pockMarks(gB, 13.0, 1.4, 1.6, 1.1, 20, 0.205, 8231, 0.6, 0.2);
      pockMarks(gC, 8.5, 5.9, 4.2, 1.0, 24, 0.13, 8232, 0, 0.3);
      popX();
    }

    /* --- the terraces ---------------------------------------------------- */
    // South elevation is the overlook; west is the route in off the yard.
    {
      const gB = G('brickPainted');
      const cx = (ADMIN.x0 + ADMIN.x1) * 0.5;
      const cz = (ADMIN.z0 + ADMIN.z1) * 0.5;
      const span = (ADMIN.x1 - ADMIN.x0) - 1.5;
      const gm = bucketAt('metalRust', cx, cz);
      place(cx, 0, ADMIN.z1, 0);
      // Piers between the ground-floor windows, and the cill stains above them.
      for (let i = 0; i < 5; i++) {
        const px = -span * 0.5 + ((i + 1) / 6) * span;
        wallFittings(gm, gB, px - 1.05, px + 1.05, 3.4, 0.2, 8301 + i, {
          lamp: i === 2,
          sign: i === 1 ? 'A1' : null,
          stencil: i === 3 ? String(10 + i) : null,
        });
      }
      for (let i = 0; i < 6; i++) {
        const wx = -span * 0.5 + ((i + 0.5) / 6) * span;
        // Under every cill: the classic two-tail wash off the drip's ends.
        rustWash(gB, wx - 0.72, 0.9, 1.6, 0.14, 3, 0.204, T.rustWash, 8320 + i);
        rustWash(gB, wx + 0.72, 0.9, 1.6, 0.14, 3, 0.204, T.rustWash, 8340 + i);
        rustWash(gB, wx, 3.55, 1.5, 0.5, 3, 0.204, T.grime, 8360 + i);
      }
      // Parapet run-off marks the top of the whole elevation.
      for (let i = 0; i < 14; i++) {
        rustWash(gB, -12.0 + i * 1.85, 7.15, 2.6 + hash2(i, 3) * 1.6, 0.22, 3, 0.204, T.grime, 8380 + i);
      }
      // Confined to the piers: the window and balcony-door openings either side of these are
      // holes, and a pock mark hanging in a hole is worse than no pock mark at all.
      pockMarks(gB, -8.17, 1.6, 1.0, 1.3, 20, 0.205, 8390, 0.2, -0.3);
      pockMarks(gB, 5.6, 5.0, 1.4, 1.2, 18, 0.205, 8391, -0.2, 0.1);
      popX();
      // West elevation, beside the loading door. Note the yaw: the builder lays this face at
      // +90 degrees, which puts its outward normal at world +X — into the building. Dressing
      // it needs -90 so local +Z is the yard side, and that mirrors the run, so every local X
      // below is the negative of the opening coordinates the builder used.
      place(ADMIN.x0, 0, cz, -Math.PI * 0.5);
      wallFittings(gm, gB, -12.5, -5.0, 3.4, 0.2, 8401, { sign: 'W3', stencil: '22', louvre: true });
      wallFittings(gm, gB, -1.2, 3.4, 3.4, 0.2, 8402, { stencil: 'D6', lampAt: 0.3 });
      wallFittings(gm, gB, 10.0, 12.8, 3.4, 0.2, 8403, { sign: 'E1' });
      stencilText(gB, 'BAY 3', 6.7, 3.15, 0.08, T.paint, 0.206);
      stencilText(gB, 'LOAD', -3.0, 3.15, 0.07, T.paint, 0.206);
      pockMarks(gB, -8.5, 1.5, 2.2, 1.2, 22, 0.205, 8410, 0.4, -0.2);
      popX();
      downpipe(ADMIN.x0 - 0.3, ADMIN.z0 + 12.0, ADMIN.floor * 2 + ADMIN.para, 0, gm);
      downpipe(ADMIN.x0 - 0.3, ADMIN.z1 - 2.0, ADMIN.floor * 2 + ADMIN.para, 0, gm);
      downpipe(ADMIN.x1 + 0.3, ADMIN.z0 + 12.0, ADMIN.floor * 2 + ADMIN.para, Math.PI, gm);
    }

    /* --- the perimeter --------------------------------------------------- */
    // The precast walls are the largest flat surfaces in the frame from the yard and were
    // carrying nothing at all above the grime band the builder gave them.
    {
      const gc = G('concretePanel');
      const runs = [
        [-50, 20, 42, -1, 3.2, 8501],
        [28, 50, 42, -1, 3.2, 8502],
        [-52, -20, -43, 1, 3.0, 8503],
        [18, 50, -43, 1, 3.0, 8504],
      ];
      for (let r = 0; r < runs.length; r++) {
        const [x0, x1, wz, side, h, seedN] = runs[r];
        const gm = bucketAt('metalRust', (x0 + x1) * 0.5, wz);
        // Yaw the frame so local +Z always leaves the wall on the yard side, whichever way
        // round the run was authored. Everything below is then a plain positive offset.
        place((x0 + x1) * 0.5, 0, wz, side > 0 ? 0 : Math.PI);
        const half = (x1 - x0) * 0.5;
        const bays = Math.max(2, Math.round((x1 - x0) / 2.5));
        for (let i = 0; i < bays; i++) {
          const px = -half + (i + 0.5) * ((x1 - x0) / bays);
          const hs = hash2(i, seedN);
          // Coping run-off on most bays, a painted bay number on every fourth.
          rustWash(gc, px, h - 0.06, 1.2 + hs * 2.2, 0.55, 2 + ((hs * 3) | 0), 0.095, T.grime, seedN + i);
          if (i % 4 === 1) stencilText(gc, String(i + 3), px, 1.7, 0.075, T.paint, 0.097);
          if (i % 7 === 3) pockMarks(gc, px, 1.5, 0.9, 1.0, 12, 0.096, seedN + 500 + i, 0, 0);
        }
        // Fittings on three bays of each run, clustered near the routes rather than spread.
        wallFittings(gm, gc, -half + 3.0, -half + 8.0, h, 0.09, seedN + 61, { sign: String(r * 2 + 3), lamp: true });
        wallFittings(gm, gc, half - 9.0, half - 4.0, h, 0.09, seedN + 62, { stencil: 'E-4', lamp: false });
        popX();
      }
    }

    /* --- the freight dock ------------------------------------------------ */
    {
      const gB = G('brickPainted');
      const cx = (DOCK.x0 + DOCK.x1) * 0.5;
      place(cx, 0, DOCK.z0, Math.PI);
      // Bay numbers along the dock face, which is exactly what a freight platform carries,
      // plus the run-off from the coping above each one.
      for (let i = 0; i < 7; i++) {
        const px = -17.0 + i * 5.7;
        stencilText(gB, String(i + 1), px, 0.66, 0.08, T.paint, 0.19);
        rustWash(gB, px + 1.4, DOCK.h - 0.04, 0.62, 0.35, 3, 0.19, T.grime, 8601 + i);
      }
      for (let i = 0; i < 8; i++) {
        rustWash(gB, -19.4 + i * 5.54, DOCK.h - 0.05, 0.55, 0.22, 3, 0.19, T.rustWash, 8640 + i);
      }
      pockMarks(gB, 6.0, 0.6, 4.0, 0.42, 18, 0.19, 8620, 0, 0);
      popX();
      // Scuffing on the deck itself, where forty years of pallets have been dragged off it.
      const gsc = GT('asphalt', 0.35);
      for (let i = 0; i < 10; i++) {
        const px = DOCK.x0 + 2.4 + i * 3.7;
        place(px, DOCK.h + 0.005, DOCK.z0 + 1.1 + hash2(i, 3) * 1.6, hash2(i, 7) * 3);
        blobXZ(gsc, 0.6 + hash2(i, 11) * 0.7, 0.42, 8660 + i, T.damp, 9, 0);
        popX();
      }
    }

    /* --- the gatehouse: a blank 4 x 3 m brick face straight down the approach --- */
    {
      const gB = G('brickPainted');
      const gm = bucketAt('metalRust', 34, 36);
      place(34, 0, 36, Math.PI);
      // The window takes x +-1.3 between y 1.30 and 2.40, so everything here works the strip
      // above it and the two returns beside it. Fittings laid across the glass would float.
      stencilText(gB, 'GATE 4', 0, 2.68, 0.05, T.paint, 1.815);
      wallLamp(gm, 1.62, 2.55, 1.81, 'cone');
      rustWash(gB, 1.62, 2.44, 1.5, 0.16, 3, 1.815, T.rustWash, 8681);
      rustWash(gB, -1.5, 2.9, 1.9, 0.5, 4, 1.815, T.grime, 8682);
      pockMarks(gB, -1.66, 0.7, 0.28, 0.6, 9, 1.815, 8683, 0, 0);
      pockMarks(gB, 1.66, 0.7, 0.28, 0.6, 9, 1.815, 8684, 0, 0);
      popX();
    }
  }

  /** Working clutter: the things a yard crew leaves lying about. */
  function dressYard() {
    // Hose and cable coils by the water points and the sheds.
    hoseCoil(-19.2, -14.0, 0.62, 8701);
    hoseCoil(1.4, -7.2, 0.55, 8702);
    hoseCoil(-43.0, -33.5, 0.68, 8703);
    hoseCoil(18.5, 25.4, 0.6, 8704);
    hoseCoil(ADMIN.x0 - 2.6, -30.5, 0.5, 8705);

    // Tool carts and barrows, always beside something being worked on.
    toolCart(-20.4, -14.8, 1.1, 8711);
    toolCart(15.2, 25.4, 2.4, 8712);
    toolCart(-42.2, -28.0, 0.3, 8713);
    wheelbarrow(-9.0, 2.4, 2.1, 8721);
    wheelbarrow(18.6, -16.4, 0.7, 8722);
    wheelbarrow(-33.5, 21.0, 3.4, 8723);

    // Crates. Stencilled per crate, so no two stacks read the same.
    crateStack(-12.2, -7.4, 0.35, [[0.62, 0.38, 0.44, '7412'], [0.5, 0.3, 0.36, 'K2'], [0.34, 0.22, 0.3, null]], 8731);
    crateStack(17.6, 17.6, 1.25, [[0.7, 0.42, 0.5, 'BX 09'], [0.55, 0.32, 0.4, null]], 8732);
    // Inside the shed and up on the dock deck, both standing on their own slab.
    crateStack(-41.6, -26.4, 2.2, [[0.6, 0.4, 0.42, 'D-14'], [0.6, 0.26, 0.42, '3'], [0.4, 0.24, 0.32, null]], 8733, 0.12);
    crateStack(6.4, DOCK.z0 + 2.6, 0.15, [[0.66, 0.4, 0.46, '221'], [0.42, 0.26, 0.34, 'S']], 8734, DOCK.h);
    crateStack(28.5, -11.5, 1.7, [[0.58, 0.36, 0.4, 'A7'], [0.46, 0.28, 0.34, null]], 8735);
    crateStack(-27.0, 1.6, 0.9, [[0.64, 0.4, 0.44, '58'], [0.5, 0.3, 0.36, null]], 8736);

    // Jerry cans, in rows against walls and cover where fuel gets stood.
    jerryRow(-19.6, -12.6, 0.0, 5, 8741);
    jerryRow(16.6, 26.0, 1.3, 4, 8742);
    jerryRow(-43.2, -30.6, 0.2, 6, 8743, 0.12);
    jerryRow(21.6, -4.4, 1.55, 3, 8744);
    jerryRow(-12.6, 2.6, 0.0, 4, 8745);
    jerryRow(9.4, DOCK.z0 + 2.2, 0.8, 3, 8746, DOCK.h);

    // Scaffold tube, propped where it was dropped.
    scaffoldBundle(-20.6, -22.5, 0.4, 0.32, 7, 8751);
    scaffoldBundle(ADMIN.x0 - 1.2, -18.6, 1.9, 0.28, 6, 8752);
    scaffoldBundle(-11.5, 34.5, 2.6, 0.35, 5, 8753);

    // Timber ends around every stack of sleepers and every crate pile.
    timberOffcuts(-9.5, 2.2, 9, 8761);
    timberOffcuts(19.0, 30.2, 8, 8762);
    timberOffcuts(-36.5, 2.0, 10, 8763);
    timberOffcuts(-12.2, -7.4, 7, 8764);
    timberOffcuts(-41.6, -26.4, 8, 8765, 0.12);
    timberOffcuts(6.4, DOCK.z0 + 2.6, 7, 8766, DOCK.h);

    // More pallets, at angles, leaning and fallen — a yard is mostly pallets.
    // Every one of these is in a lane between two ballast shoulders or on open apron; the
    // shoulders sit 0.26 m proud, so a pallet laid across one is a pallet buried in stone.
    const pallets = [
      [-17.5, -7.2, 0.5, 5], [-16.7, -8.1, 1.2, 3], [18.0, 26.0, 2.6, 6],
      [-45.0, -6.0, 0.9, 4], [-14.5, 25.2, 0.2, 7], [27.0, 35.0, 1.6, 4],
      [-30.5, 2.2, 2.9, 5], [11.0, -14.6, 0.4, 3], [-46.0, 18.0, 1.1, 6],
      [34.0, -6.0, 2.2, 4],
    ];
    for (let i = 0; i < pallets.length; i++) {
      const [x, z, yaw, n] = pallets[i];
      for (let k = 0; k < n; k++) {
        const tone = 0.7 + hash2(i * 11 + k, 6) * 0.52;
        addInstance(setPallet, x + (hash2(k, i + 5) - 0.5) * 0.1, groundY(x, z) + k * 0.145, z + (hash2(k, i + 17) - 0.5) * 0.1,
          yaw + (hash2(k, i + 23) - 0.5) * 0.09, 0, 0, 1, [T.wood[0] * tone, T.wood[1] * tone, T.wood[2] * tone]);
      }
      // One pallet per stack leaning off the side of it.
      addInstance(setPallet, x + Math.cos(yaw) * 0.78, groundY(x, z) + 0.5, z - Math.sin(yaw) * 0.78, yaw + 0.5, 0, 1.3, 1, T.woodDark);
      solidBox(x, groundY(x, z) + n * 0.0725, z, 0.62, n * 0.0725, 0.42, 'wood', yaw, { cover: n > 4 });
      dustSkirt(x, z, 0.9, 0.09, 8800 + i, null);
    }

    // Tyres: two more heaps and a properly stacked column beside the wagon repair road.
    tyrePile(-19.8, -15.0, 6, 8811);
    tyrePile(17.4, -17.2, 5, 8812);
    tyrePile(-44.0, -12.0, 7, 8813);
    for (let i = 0; i < 6; i++) {
      addInstance(setTyre, -20.6, groundY(-20.6, -12.8) + 0.14 + i * 0.24, -12.8,
        hash2(i, 3) * 6.28, (hash2(i, 7) - 0.5) * 0.06, (hash2(i, 11) - 0.5) * 0.06, 0.95 + hash2(i, 5) * 0.12, grey(0.3 + hash2(i, 13) * 0.14));
    }
    solidBox(-20.6, 0.75, -12.8, 0.45, 0.75, 0.45, 'metal');

    // Chocks under every stabled wagon.
    wheelChocks(-2, TRACK_Z[1], 8821);
    wheelChocks(13.5, TRACK_Z[1], 8822);
    wheelChocks(-21, TRACK_Z[2], 8823);
    wheelChocks(9, TRACK_Z[2], 8824);
    wheelChocks(-34, TRACK_Z[0], 8825);
    wheelChocks(30, TRACK_Z[3], 8826);

    // Two more cable drums, and the sleeper offcut piles that go with them.
    cableSpool(-19.0, -25.4, 1.2, 0.78, 8831);
    cableSpool(24.5, -11.8, 0.5, 0.66, 8832);
    sleeperStack(-19.8, -28.4, 0.6, 4, 8841);
    sleeperStack(30.0, 35.5, 2.0, 5, 8842);
  }

  /** Overhead: the layer between the container tops and the crane that the yard had nothing in. */
  function dressOverhead() {
    const wireT = mixTint(grey(1), T.soot, 0.55);

    // Two lines of catenary poles, both laid where the ground under them is genuinely clear.
    const poleLines = [
      [[13.5, -33.0], [13.5, -27.0], [13.5, -21.0]],
      [[-46.5, 12.0], [-46.5, 20.0], [-46.5, 28.0], [-46.5, 36.0]],
    ];
    for (let l = 0; l < poleLines.length; l++) {
      const line = poleLines[l];
      const h = 7.4 + l * 0.6;
      for (let i = 0; i < line.length; i++) {
        catenaryPole(line[i][0], line[i][1], h + (i & 1 ? 0.25 : 0), l === 0 ? Math.PI * 0.5 : 0, 8901 + l * 20 + i);
      }
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i];
        const b = line[i + 1];
        const g = bucketAt('metalRust', (a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);
        for (let k = -1; k <= 1; k++) {
          const off = k * 0.52;
          const dx = l === 0 ? off : 0;
          const dz = l === 0 ? 0 : off;
          wireRun(g, a[0] + dx, h + 0.05, a[1] + dz, b[0] + dx, h + 0.05, b[1] + dz, 0.42, 0.018, wireT, 7);
        }
      }
    }

    // Mast-to-mast feeders. Only the pairs with genuinely clear air between them: a wire
    // through a silo or a water tower is the one overhead mistake nobody forgives.
    const feeders = [
      [0, 6, 1.1], [4, 1, 2.4], [1, 5, 0.9],
    ];
    for (let i = 0; i < feeders.length; i++) {
      const A = MAST_DEFS[feeders[i][0]];
      const B = MAST_DEFS[feeders[i][1]];
      const g = bucketAt('metalRust', (A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5);
      for (let k = 0; k < 2; k++) {
        wireRun(g, A[0] + k * 0.22, A[2] + 0.28, A[1], B[0] + k * 0.22, B[2] + 0.28, B[1], feeders[i][2], 0.022, wireT, 10);
      }
    }

    // The slack run across the yard: off the crane's east leg down to the north-west mast.
    // Deliberately over-slack, so it sags into the frame instead of ruling a line across it.
    {
      const M = MAST_DEFS[0];
      const g = bucketAt('metalRust', -19, 29);
      wireRun(g, CRANE.x + 0.4, 8.4, CRANE.zB, M[0], M[2] + 0.2, M[1], 2.1, 0.026, wireT, 12);
      wireRun(g, CRANE.x + 0.4, 8.1, CRANE.zB - 0.5, M[0] + 0.3, M[2] - 0.1, M[1], 2.4, 0.02, wireT, 12);
    }

    // Birds: the crane jib and the tower rail carry the map's silhouette, so they carry these.
    roost(CRANE.x - 5.5, CRANE.top + 0.55, CRANE.zA + 3.0, CRANE.x - 5.5, CRANE.top + 0.55, CRANE.zB - 3.0, 9, 8951);
    roost(MAST_DEFS[0][0], MAST_DEFS[0][2] + 0.5, MAST_DEFS[0][1] - 0.85, MAST_DEFS[0][0], MAST_DEFS[0][2] + 0.5, MAST_DEFS[0][1] + 0.85, 3, 8952);
    roost(MAST_DEFS[2][0], MAST_DEFS[2][2] + 0.5, MAST_DEFS[2][1] - 0.85, MAST_DEFS[2][0], MAST_DEFS[2][2] + 0.5, MAST_DEFS[2][1] + 0.85, 3, 8953);
    roost(13.5, 7.6, -33.0, 13.5, 7.6, -21.0, 6, 8954);
    roost(-46.5, 8.1, 12.0, -46.5, 8.1, 36.0, 7, 8955);
    roost(-48.4, 2.5, -10.0, -48.4, 2.5, 14.0, 5, 8956);
    roost(48.4, 2.5, -4.0, 48.4, 2.5, 20.0, 4, 8957);
    roost(DOCK.x0 + 4, DOCK.h + 4.2, DOCK.z0 + 2.4, DOCK.x1 - 4, DOCK.h + 4.2, DOCK.z0 + 2.4, 6, 8958);

    // A windsock on the dock's west end: the one moving-looking thing on the skyline.
    windsock(-18.5, 33.0, 6.4, 8961);

    // More hanging chains, all of them already animated by `update`.
    hangChain(CRANE.x - 5.5, CRANE.top - 0.2, CRANE.zA + 5.5, 20, 0.6, -0.8, 0.4, 0.11);
    hangChain(DEPOT.x1 + 0.15, 6.2, -18.0, 24, -0.9, 0.3, 2.2, 0.1);
    hangChain(-13.0, 4.6, -25.0, 16, 0.5, 0.85, 4.1, 0.08);
    hangChain(ADMIN.x0 - 0.4, 6.8, -22.0, 18, -0.8, -0.5, 5.6, 0.09);
  }

  /** Damage: craters, the debris fields off them, and the positions that took the hits. */
  function dressDamage() {
    // Each crater sits on a route or a sightline, and each throws its debris downrange of the
    // thing it was aimed at, so the map reads as having been fought over in a direction.
    const craters = [
      [-17.0, -12.5, 2.8, 0.55, 0.84, 9101],
      [22.5, -8.5, 2.8, -0.6, 0.8, 9102],
      [-2.0, 10.0, 2.3, 0.2, -0.98, 9103],
      [-16.5, -25.0, 2.4, -0.9, 0.44, 9104],
      [38.0, -10.5, 2.6, -0.7, 0.72, 9105],
      [-45.0, 35.0, 2.2, 0.95, -0.3, 9106],
    ];
    for (let i = 0; i < craters.length; i++) {
      const c = craters[i];
      shellCrater(c[0], c[1], c[2], c[3], c[4], c[5]);
    }

    // Two positions that were hit while they were held.
    // Placed as extensions of the intact positions the yard already has rather than on top of
    // them, so a player walking the line sees the same emplacement standing at one end and
    // blown open at the other. That contrast is the story; two separate walls is not.
    burstSandbags(-22.0, -16.0, -17.6, -16.0, 4, 9201);
    burstSandbags(19.5, -12.8, 24.0, -12.8, 3, 9202);
    burstSandbags(11.0, 3.2, 15.2, 3.2, 3, 9203);

    // Shrapnel on the depot's east elevation, which is the flat concrete nearest the two
    // craters on the depot route. The jersey barriers deliberately get none: a New Jersey
    // profile is battered, so a decal laid at a constant offset floats off the face.
    place(DEPOT.x1, 0, (DEPOT.z0 + DEPOT.z1) * 0.5, Math.PI * 0.5);
    pockMarks(G('brickPainted'), 1.5, 1.2, 2.4, 0.9, 18, 0.205, 9301, -0.5, -0.3);
    popX();
    place((DEPOT.x0 + DEPOT.x1) * 0.5, 0, DEPOT.z1, 0);
    pockMarks(G('brickPainted'), -9.5, 1.2, 3.2, 0.9, 20, 0.205, 9302, 0.5, -0.2);
    popX();
  }

  function setDressing() {
    resetX();
    dressGround();
    dressWalls();
    dressYard();
    dressOverhead();
    dressDamage();
    // Last, and it has to be last: the open-bay fill tests every candidate against the live
    // collider list, so everything above has to have finished putting its props down first.
    openBays();
    resetX();
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
    // The berms sit behind the fence line rather than under it, so the two-metre service
    // margin outside the depot and the admin block stays walkable.
    embankment(-53.5, -40, -53.5, 40, 3.6, 4.0, 1);
    embankment(53.5, -40, 53.5, 40, 3.2, 3.8, -1);
    fenceRun(-48.4, -38, -48.4, 40, 2.4, 921);
    fenceRun(48.4, -38, 48.4, 40, 2.4, 922);
    // North: retaining wall behind the buildings plus a service-road fence.
    precastWall(-52, -43, -20, -43, 3.0, 923);
    precastWall(18, -43, 50, -43, 3.0, 924);
    fenceRun(-20, -43, 18, -43, 2.4, 925);
    // South-east corner fence linking the wall to the embankment.
    fenceRun(50, 41.5, 40, 41.5, 2.4, 926, false);

    // A short, flattened run of fence marking the terraces' forecourt. Kept clear of the
    // approach lane: a boundary the player cannot walk round is a wall, not a fence.
    fenceRun(ADMIN.x0 - 9.5, 1.0, ADMIN.x0 - 9.5, 9.0, 1.9, 927, false);
  }

  /* ====================================================================== */
  /* 15b. The far field — the town beyond the wire                           */
  /* ====================================================================== */

  /**
   * Everything in this section sits between about 70 m and 560 m from the origin. None of it
   * collides, none of it navigates, none of it casts a shadow: its entire job is that the
   * horizon is never a straight line.
   *
   * The rule the art direction actually needs met is "the horizon is broken in six to eight
   * places per 90 degrees of yaw from anywhere on the map", so the layers below are laid out
   * as full rings rather than as a backdrop card facing one way. Depth is carried by five
   * bands at increasing radius — fringe sheds, near town, mid town, far town, ridge/treeline —
   * because parallax between bands is what stops a backdrop reading as painted-on.
   *
   * Heights are chosen against the fog: ATMOSPHERE.fogDensity is 0.0072/m, so a mass at 220 m
   * still returns about a fifth of its contrast and anything past 450 m is a tonal shift only.
   * The silhouette work therefore lives at 90-260 m and the far bands are atmosphere.
   */

  const FAR = {
    edgeX: HALF_W + 4,
    edgeZ: HALF_D + 4,
    outer: 560,
  };

  /**
   * Skirt terrain. Flat at the map edge (it has to meet `buildGround` without a step), rising
   * into a shallow bowl rim, with two named ridge lobes that lift the skyline. tan(4 deg) over
   * 360 m is 25 m, so the 33 m crest on the north-west lobe is the top of the range §4 asks
   * for and the off-ridge 15 m is the bottom of it.
   */
  function farGroundY(x, z) {
    const r = Math.hypot(x, z);
    const t = clamp((r - 66) / 300, 0, 1);
    const s = t * t;
    const n = fbm2(x * 0.0062 + 11.3, z * 0.0062 - 7.1) - 0.5;
    let y = s * 8 + n * 14 * s;
    const ang = Math.atan2(z, x);
    const lobe = (a0, w, amp) => {
      let d = ang - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return amp * Math.exp(-(d * d) / (w * w));
    };
    // North-west (behind the depot) and south-east (behind the dock): two sides, as specified.
    y += (lobe(2.5, 0.8, 18) + lobe(-1.1, 0.66, 13)) * s;
    return y;
  }

  /** Distance from the origin out to the playable rectangle along a unit direction. */
  function farInnerRadius(ca, sa) {
    const tx = Math.abs(ca) > 1e-4 ? FAR.edgeX / Math.abs(ca) : 1e9;
    const tz = Math.abs(sa) > 1e-4 ? FAR.edgeZ / Math.abs(sa) : 1e9;
    return Math.min(tx, tz);
  }

  /**
   * The skirt itself: a polar annulus from the map edge to the far clip. Without this the
   * ground simply stops at x = +-58 and the frame becomes a plane meeting sky, which is the
   * defect that made wide.png read as a prototype.
   */
  function farSkirt() {
    const g = GT('dirt', 0.35);
    const SEG = 72;
    const rings = [0, 78, 96, 122, 158, 208, 272, 350, 448, FAR.outer];
    const px = new Float64Array(SEG + 1);
    const pz = new Float64Array(SEG + 1);
    const py = new Float64Array(SEG + 1);
    const qx = new Float64Array(SEG + 1);
    const qz = new Float64Array(SEG + 1);
    const qy = new Float64Array(SEG + 1);
    const tt = [0, 0, 0];
    for (let ri = 0; ri < rings.length - 1; ri++) {
      const rA = rings[ri];
      const rB = rings[ri + 1];
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const inner = farInnerRadius(ca, sa);
        const ra = rA === 0 ? inner : Math.max(inner, rA);
        const rb = Math.max(inner + 0.5, rB);
        if (ri === 0) {
          px[i] = ca * ra;
          pz[i] = sa * ra;
          py[i] = 0;
        } else {
          px[i] = qx[i];
          pz[i] = qz[i];
          py[i] = qy[i];
        }
        qx[i] = ca * rb;
        qz[i] = sa * rb;
        qy[i] = farGroundY(qx[i], qz[i]);
      }
      for (let i = 0; i < SEG; i++) {
        // Tone drifts with distance and with the noise field, so the skirt is not one flat
        // value the eye can read as a backdrop plate.
        const shade = 0.62 + fbm2(px[i] * 0.012, pz[i] * 0.012) * 0.5;
        tt[0] = T.dirt[0] * shade;
        tt[1] = T.dirt[1] * shade * 0.99;
        tt[2] = T.dirt[2] * shade * 1.03;
        _bp.length = 0;
        _bp.push(px[i], py[i], pz[i], px[i + 1], py[i + 1], pz[i + 1], qx[i + 1], qy[i + 1], qz[i + 1], qx[i], qy[i], qz[i]);
        gpoly(g, _bp, 0, 1, 0, tt);
      }
    }
  }

  /** Ridge along local X between y0 and the ridge line y1, two slopes and two gable ends. */
  function farGable(g, w, d, y0, y1, t) {
    const hw = w * 0.5;
    const hd = d * 0.5;
    for (let s = -1; s <= 1; s += 2) {
      _bp.length = 0;
      _bp.push(-hw, y0, s * hd, hw, y0, s * hd, hw, y1, 0, -hw, y1, 0);
      gpoly(g, _bp, 0, 0.72, s * 0.69, t);
    }
    for (let s = -1; s <= 1; s += 2) {
      _bp.length = 0;
      _bp.push(s * hw, y0, -hd, s * hw, y0, hd, s * hw, y1, 0);
      gpoly(g, _bp, s, 0, 0, t);
    }
  }

  /**
   * One band of town. Blocks are placed on a jittered ring with deliberate gaps, and every
   * block gets one of four roof treatments, because a run of flat-topped boxes is exactly the
   * silhouette that reads as placeholder backdrop.
   */
  function farTownBand(radius, count, hMin, hMax, jitter, seedN) {
    const g = G('brickPainted');
    const gc = G('concreteRough');
    const r2 = mulberry32(seedN);
    for (let i = 0; i < count; i++) {
      if (r2() < 0.2) continue; // gaps — a town has streets through it
      const a = (i / count) * Math.PI * 2 + (r2() - 0.5) * 0.06;
      const rr = radius + (r2() - 0.5) * jitter;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const y0 = farGroundY(x, z);
      const w = 7 + r2() * 24;
      const d = 7 + r2() * 15;
      const h = hMin + r2() * (hMax - hMin);
      const yaw = a + Math.PI * 0.5 + (r2() - 0.5) * 0.9;
      // Distance haze is the post chain's job, but a far block still has to be *tonally*
      // further away or the parallax bands merge into one silhouette.
      const tone = (0.5 + r2() * 0.42) * lerp(1.0, 0.72, clamp((radius - 90) / 300, 0, 1));
      const warm = r2() < 0.45;
      const base = warm ? T.brick : T.concreteDark;
      const tt = [base[0] * tone, base[1] * tone, base[2] * tone * 1.06];
      place(x, y0, z, yaw);
      plainBox(g, 0, h * 0.5, 0, w * 0.5, h * 0.5, d * 0.5, tt);
      const roof = r2();
      if (roof < 0.5) {
        farGable(g, w, d, h, h + 1.8 + r2() * 3.4, tt);
      } else if (roof < 0.74) {
        // Parapet: a flat roof still needs a lip or the top edge is a razor line.
        plainBox(gc, 0, h + 0.5, 0, w * 0.5 + 0.35, 0.5, d * 0.5 + 0.35, [tt[0] * 0.92, tt[1] * 0.92, tt[2] * 0.95]);
      } else if (roof < 0.9) {
        // Sawtooth shed roof, north lights facing one way.
        const teeth = 2 + ((r2() * 3) | 0);
        for (let k = 0; k < teeth; k++) {
          const tw = w / teeth;
          place(-w * 0.5 + (k + 0.5) * tw, h, 0);
          _bp.length = 0;
          _bp.push(-tw * 0.5, 0, -d * 0.5, tw * 0.5, 0, -d * 0.5, tw * 0.5, 2.2, d * 0.5, -tw * 0.5, 2.2, d * 0.5);
          gpoly(g, _bp, 0, 0.85, -0.5, tt);
          plainBox(g, tw * 0.42, 1.1, 0, tw * 0.08, 1.1, d * 0.5, [tt[0] * 0.8, tt[1] * 0.8, tt[2] * 0.85]);
          popX();
        }
      } else {
        // A stair or lift overrun breaking one corner of the roofline.
        plainBox(gc, w * 0.28, h + 1.6, 0, w * 0.14, 1.6, d * 0.22, tt);
      }
      // A domestic stack on roughly half of them: the cheapest silhouette break there is.
      if (r2() < 0.5) {
        plainBox(gc, (r2() - 0.5) * w * 0.7, h + 1.5 + r2() * 1.2, (r2() - 0.5) * d * 0.5, 0.45, 1.5, 0.4, [tt[0] * 0.85, tt[1] * 0.8, tt[2] * 0.8]);
      }
      popX();
    }
  }

  /** A tapering industrial chimney with banding. Four of these, all different heights. */
  function farChimney(x, z, h, rBot, rTop, tintArr) {
    const g = G('metalRust');
    const y0 = farGroundY(x, z);
    place(x, y0 + h * 0.5, z);
    tube(g, rTop, rBot, h, 10, tintArr, true, false, 0.05);
    popX();
    for (let k = 0; k < 3; k++) {
      const f = 0.35 + k * 0.22;
      const rr = lerp(rBot, rTop, f) + 0.12;
      place(x, y0 + f * h, z);
      tube(g, rr, rr, 0.5, 10, [tintArr[0] * 0.7, tintArr[1] * 0.7, tintArr[2] * 0.75], false, false, 0.03);
      popX();
    }
  }

  /** Hyperbolic cooling tower — the one unmistakable "industrial town" shape in the set. */
  function farCoolingTower(x, z, h, rBot, rWaist, rTop) {
    const g = G('concreteRough');
    const y0 = farGroundY(x, z);
    const rings = 7;
    const prof = (f) => (f < 0.66 ? lerp(rBot, rWaist, f / 0.66) : lerp(rWaist, rTop, (f - 0.66) / 0.34));
    for (let i = 0; i < rings; i++) {
      const f0 = i / rings;
      const f1 = (i + 1) / rings;
      const tone = 0.74 - f0 * 0.1;
      place(x, y0 + (f0 + f1) * 0.5 * h, z);
      tube(g, prof(f1), prof(f0), (f1 - f0) * h, 16, [T.concrete[0] * tone, T.concrete[1] * tone, T.concrete[2] * tone * 1.05], false, false, 0.02);
      popX();
    }
    // The louvred air intake at the base is what makes the scale read.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      place(x + Math.cos(a) * rBot, y0 + 4.5, z + Math.sin(a) * rBot, -a);
      plainBox(g, 0, 0, 0, 0.5, 4.5, 1.4, T.concreteDark);
      popX();
    }
  }

  /** One suspension pylon: tapered lattice body, two cross arms, earth peak. */
  function farPylonBody(g, h, base, tintArr) {
    const legs = [];
    for (let s = 0; s < 4; s++) {
      const a = (s / 4) * Math.PI * 2 + Math.PI * 0.25;
      legs.push([Math.cos(a), Math.sin(a)]);
    }
    const waist = h * 0.62;
    for (let s = 0; s < 4; s++) {
      const [cx, cz] = legs[s];
      strutThin(g, cx * base, 0, cz * base, cx * base * 0.28, waist, cz * base * 0.28, 0.18, tintArr);
      strutThin(g, cx * base * 0.28, waist, cz * base * 0.28, cx * base * 0.22, h, cz * base * 0.22, 0.14, tintArr);
    }
    for (let k = 1; k <= 4; k++) {
      const f = k / 5;
      const y = f * waist;
      const r = lerp(base, base * 0.28, f);
      for (let s = 0; s < 4; s++) {
        const a = legs[s];
        const b = legs[(s + 1) % 4];
        strutThin(g, a[0] * r, y, a[1] * r, b[0] * r, y, b[1] * r, 0.12, tintArr);
      }
    }
    // Cross arms with insulator strings hanging off them.
    for (let k = 0; k < 2; k++) {
      const y = waist + 2.5 + k * 5.5;
      const arm = 7.5 - k * 1.8;
      plainBox(g, 0, y, 0, arm, 0.45, 0.45, tintArr);
      for (let s = -1; s <= 1; s += 2) {
        strutThin(g, s * arm, y, 0, 0, y + 3.2, 0, 0.1, tintArr);
        plainBox(g, s * arm * 0.92, y - 1.1, 0, 0.16, 1.1, 0.16, [tintArr[0] * 0.8, tintArr[1] * 0.8, tintArr[2] * 0.8]);
      }
    }
  }

  /** A line of pylons marching off to one side, with the conductors sagging between them. */
  function farPylonLine(x0, z0, x1, z1, n, h, seedN) {
    const g = G('metalRust');
    const r2 = mulberry32(seedN);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const x = lerp(x0, x1, f) + (r2() - 0.5) * 14;
      const z = lerp(z0, z1, f) + (r2() - 0.5) * 14;
      const y = farGroundY(x, z);
      const hh = h * (0.86 + r2() * 0.3);
      pts.push([x, y, z, hh]);
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      place(x, y, z, yaw);
      farPylonBody(g, hh, hh * 0.11, [T.steelDark[0] * 0.62, T.steelDark[1] * 0.64, T.steelDark[2] * 0.7]);
      popX();
    }
    // Conductors: two levels, three sagging segments per span. Sub-pixel at this range but
    // they are what tells the eye the pylons are a *line* and not three unrelated towers.
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      for (let k = 0; k < 2; k++) {
        const ya = a[1] + a[3] * 0.62 + 2.5 + k * 5.5;
        const yb = b[1] + b[3] * 0.62 + 2.5 + k * 5.5;
        const sag = 4.5;
        let prevX = a[0];
        let prevY = ya;
        let prevZ = a[2];
        for (let s = 1; s <= 3; s++) {
          const f = s / 3;
          const cx = lerp(a[0], b[0], f);
          const cz = lerp(a[2], b[2], f);
          const cy = lerp(ya, yb, f) - Math.sin(f * Math.PI) * sag;
          strutThin(g, prevX, prevY, prevZ, cx, cy, cz, 0.09, T.steelDark);
          prevX = cx;
          prevY = cy;
          prevZ = cz;
        }
      }
    }
  }

  /**
   * Treeline. A ribbon with a lumpy top edge, which is honestly all a stand of trees is at
   * this range, plus a scatter of real crowns on the near band so the edge has depth.
   */
  function farTreeRibbon(radius, a0, a1, hMin, hMax, seedN, shade) {
    const g = GT('dirt', 0.35);
    const n = Math.max(8, Math.round(((a1 - a0) / (Math.PI * 2)) * 96));
    const tt = [T.weeds[0] * shade * 0.62, T.weeds[1] * shade * 0.66, T.weeds[2] * shade * 0.6];
    const r2 = mulberry32(seedN);
    let pax = 0;
    let paz = 0;
    let pay = 0;
    let pah = 0;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const a = lerp(a0, a1, f);
      const rr = radius * (0.97 + r2() * 0.07);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const y = farGroundY(x, z);
      // Lumpy: a low-frequency swell times a per-sample break, with the odd gap to zero.
      const swell = 0.45 + 0.55 * (fbm2(a * 9.0, 3.7) + 0.2);
      const h = (r2() < 0.07 ? 0.15 : 1) * lerp(hMin, hMax, clamp(swell, 0, 1));
      if (i > 0) {
        _bp.length = 0;
        _bp.push(pax, pay, paz, x, y, z, x, y + h, z, pax, pay + pah, paz);
        // Faces inward: the player is always inside the ring.
        gpoly(g, _bp, -Math.cos(a), 0, -Math.sin(a), tt);
      }
      pax = x;
      paz = z;
      pay = y;
      pah = h;
    }
  }

  /** Individual crowns for the near treeline, so it is not a single flat cut-out. */
  function farTreeClumps(radius, a0, a1, count, seedN) {
    const g = GT('dirt', 0.35);
    const r2 = mulberry32(seedN);
    for (let i = 0; i < count; i++) {
      const a = lerp(a0, a1, r2());
      const rr = radius * (0.9 + r2() * 0.26);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const y = farGroundY(x, z);
      const h = 7 + r2() * 9;
      const w = 2.6 + r2() * 2.6;
      const tone = 0.5 + r2() * 0.4;
      const tt = [T.weeds[0] * tone * 0.7, T.weeds[1] * tone * 0.72, T.weeds[2] * tone * 0.62];
      place(x, y + h * 0.5, z, r2() * 6.28);
      tube(g, w * 0.2, w, h, 6, tt, true, false, 0.05);
      popX();
      place(x, y + h * 0.86, z, r2() * 6.28);
      tube(g, w * 0.05, w * 0.6, h * 0.34, 6, tt, true, false, 0.05);
      popX();
    }
  }

  /**
   * The industrial fringe: the first band out, 80-140 m, big low sheds and spoil heaps. This
   * is the band that does the real work at the current fog density — everything past 250 m is
   * tone, this is silhouette.
   */
  function farFringe() {
    const g = G('corrugatedSteel');
    const gc = G('concreteRough');
    const gr = G('metalRust');
    const sheds = [
      [-104, -36, 46, 22, 11.5, 0.3],
      [-88, 62, 34, 18, 9.0, -0.5],
      [-22, -108, 52, 20, 10.5, 0.06],
      [66, -96, 30, 22, 12.5, -0.9],
      [112, -6, 24, 40, 9.5, 1.5],
      [96, 74, 38, 20, 8.5, 0.7],
      [12, 104, 44, 18, 10.0, 0.02],
      [-96, 96, 26, 26, 13.0, 0.9],
      [-124, 16, 30, 20, 8.0, 1.2],
    ];
    for (let i = 0; i < sheds.length; i++) {
      const [x, z, w, d, h, yaw] = sheds[i];
      const y0 = farGroundY(x, z);
      const tone = 0.5 + hash2(i, 17) * 0.4;
      const tt = [T.steelPainted[0] * tone, T.steelPainted[1] * tone, T.steelPainted[2] * tone * 1.05];
      place(x, y0, z, yaw);
      plainBox(g, 0, h * 0.5, 0, w * 0.5, h * 0.5, d * 0.5, tt);
      farGable(g, w, d, h, h + 2.6 + hash2(i, 3) * 2.4, [tt[0] * 0.86, tt[1] * 0.86, tt[2] * 0.9]);
      // Roof vents and a stub stack: never let a shed ridge run clean.
      for (let k = -1; k <= 1; k++) {
        plainBox(gr, k * w * 0.3, h + 2.2, 0, 0.5, 0.9, 0.5, [T.rust[0] * tone, T.rust[1] * tone, T.rust[2] * tone]);
      }
      if (i % 3 === 0) plainBox(gc, w * 0.36, h + 5.5, d * 0.25, 0.9, 5.5, 0.9, [T.concrete[0] * tone, T.concrete[1] * tone, T.concrete[2] * tone]);
      popX();
    }
    // Spoil heaps and a bank of silos: mid-height mass between the sheds and the town.
    const heaps = [[-70, -84, 16, 9], [78, 52, 20, 7.5], [-118, 54, 14, 8.5], [44, -118, 22, 10]];
    const gd = GT('dirt', 0.35);
    for (let i = 0; i < heaps.length; i++) {
      const [x, z, r, h] = heaps[i];
      const y0 = farGroundY(x, z);
      place(x, y0 + h * 0.5, z, i * 0.7);
      tube(gd, r * 0.16, r, h, 9, [T.dirt[0] * 0.7, T.dirt[1] * 0.68, T.dirt[2] * 0.72], true, false, 0.1);
      popX();
    }
    for (let i = 0; i < 5; i++) {
      const x = -132 - i * 0.5;
      const z = -52 + i * 7.4;
      const y0 = farGroundY(x, z);
      place(x, y0 + 13, z);
      tube(gc, 4.0, 4.0, 26, 12, [T.concrete[0] * 0.6, T.concrete[1] * 0.6, T.concrete[2] * 0.64], false, false, 0.06);
      popX();
      place(x, y0 + 27.6, z);
      tube(gc, 0.6, 4.2, 3.2, 12, [T.concrete[0] * 0.52, T.concrete[1] * 0.52, T.concrete[2] * 0.56], true, false, 0.06);
      popX();
    }
  }

  function buildFarField() {
    resetX();
    farMode = true;
    farSkirt();
    farFringe();
    // Five parallax bands. Counts fall with radius so the angular density stays roughly even.
    farTownBand(168, 54, 7, 15, 26, 3101);
    farTownBand(214, 48, 9, 19, 30, 3102);
    farTownBand(272, 42, 10, 23, 36, 3103);
    farTownBand(348, 36, 12, 27, 44, 3104);
    farTownBand(438, 30, 14, 30, 56, 3105);
    // Chimneys, all different heights, spread so at least one is up from most yaws.
    farChimney(-196, -128, 58, 3.4, 1.9, [T.brick[0] * 0.52, T.brick[1] * 0.48, T.brick[2] * 0.5]);
    farChimney(-158, -172, 41, 2.6, 1.6, [T.brick[0] * 0.5, T.brick[1] * 0.46, T.brick[2] * 0.5]);
    farChimney(148, -186, 72, 4.0, 2.1, [T.concreteDark[0] * 0.6, T.concreteDark[1] * 0.6, T.concreteDark[2] * 0.65]);
    farChimney(214, 96, 47, 3.0, 1.8, [T.brick[0] * 0.46, T.brick[1] * 0.44, T.brick[2] * 0.48]);
    farCoolingTower(-238, 158, 62, 21, 12.5, 15.5);
    farCoolingTower(-292, 196, 54, 18, 11, 13.5);
    farPylonLine(-62, -128, 128, -352, 6, 34, 3201);
    farPylonLine(150, 74, 470, 168, 5, 31, 3202);
    // Broken treeline: a near band with real crowns and two far ribbons.
    farTreeRibbon(196, 0.35, 1.85, 8, 17, 3301, 1.0);
    farTreeClumps(184, 0.35, 1.85, 46, 3302);
    farTreeRibbon(310, 2.2, 4.1, 10, 21, 3303, 0.86);
    farTreeRibbon(392, 4.3, 6.05, 11, 23, 3304, 0.74);
    farTreeRibbon(268, -0.6, 0.25, 9, 18, 3305, 0.92);
    farMode = false;
    resetX();
  }

  /* ====================================================================== */
  /* 16. Build                                                               */
  /* ====================================================================== */

  buildGround();
  buildPerimeter();
  buildDepot();
  buildAdmin();
  buildYard();
  // Density pass. Runs last of the playable builders so it can dress against everything the
  // region builders put down, and before the far field so nothing it emits lands in the
  // unshadowed backdrop chunk.
  setDressing();
  buildFarField();
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
      const key = `${b.tri ? 'T' : 'U'}${b.name}:${b.triScale}${b.far ? ':F' : ''}`;
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
        mesh.castShadow = !b0.far;
        mesh.receiveShadow = !b0.far;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.name = b0.far ? `level:far:${b0.name}` : `level:${b0.name}`;
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
   * Ground level only, deliberately. A single-layer grid cannot hold two floors above the
   * same footprint, and letting the admin block's first-floor slab win the height field would
   * make its whole ground storey read as a 3.6 m plateau with no walls in it. So the height
   * field only accepts surfaces up to `NAV_MAX_FLOOR`; the upper storeys, the mezzanine and
   * the container tops are still fully collidable and climbable, they are simply not in the
   * AI's path graph. The player owns the high ground, which is the intended tension.
   */
  const NAV_MAX_FLOOR = 1.75;
  const NAV_CELL = 0.75;
  const navOrigin = new THREE.Vector3(PLAY.minX, 0, PLAY.minZ);
  const navW = Math.ceil((PLAY.maxX - PLAY.minX) / NAV_CELL);
  const navH = Math.ceil((PLAY.maxZ - PLAY.minZ) / NAV_CELL);
  const navFloor = new Float32Array(navW * navH);
  const navWalkable = new Uint8Array(navW * navH);

  {
    const AGENT_R = 0.25;
    const HEAD = 1.8;
    const STEP = 0.45;
    /**
     * Half-width of the probe square tested against each collider. Testing the bare cell
     * centre lets a 0.7 m wall slip between two centres and become permeable; testing the
     * whole 0.75 m cell closes every doorway. A 0.13 m probe blocks anything wider than
     * 0.45 m and still finds a clear cell in any opening wider than about 1.5 m.
     */
    const PROBE = 0.13;

    // Pass one: floor heights from anything with a standable top face.
    for (let ci = 0; ci < colliders.length; ci++) {
      const c = colliders[ci];
      if (!c.walkTop || c.noNav) continue;
      const top = c.max.y;
      if (top < -2 || (c.type !== 'ramp' && top > NAV_MAX_FLOOR)) continue;
      const ix0 = clamp(Math.floor((c.min.x - navOrigin.x) / NAV_CELL), 0, navW - 1);
      const ix1 = clamp(Math.ceil((c.max.x - navOrigin.x) / NAV_CELL), 0, navW - 1);
      const iz0 = clamp(Math.floor((c.min.z - navOrigin.z) / NAV_CELL), 0, navH - 1);
      const iz1 = clamp(Math.ceil((c.max.z - navOrigin.z) / NAV_CELL), 0, navH - 1);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = navOrigin.x + (ix + 0.5) * NAV_CELL;
          const wz = navOrigin.z + (iz + 0.5) * NAV_CELL;
          if (wx < c.min.x - 0.1 || wx > c.max.x + 0.1) continue;
          if (wz < c.min.z - 0.1 || wz > c.max.z + 0.1) continue;
          const k = iz * navW + ix;
          let h = top;
          if (c.type === 'ramp') {
            // Interpolate the ramp's rise across its footprint so the slope is walkable.
            const rx = wx - c.cx;
            const rz = wz - c.cz;
            const cs = Math.cos(-c.yaw);
            const sn = Math.sin(-c.yaw);
            const lx = rx * cs + rz * sn;
            h = lerp(c.y0, c.y1, clamp((lx + c.hx) / (2 * c.hx), 0, 1));
          }
          if (h > NAV_MAX_FLOOR) continue;
          if (h > navFloor[k] && h - navFloor[k] < 3.0) navFloor[k] = h;
        }
      }
    }

    // Pass two: obstruction. Anything occupying the agent's body volume blocks the cell.
    for (let k = 0; k < navW * navH; k++) navWalkable[k] = 1;
    for (let ci = 0; ci < colliders.length; ci++) {
      const c = colliders[ci];
      if (c.noNav || c.type === 'ramp') continue;
      const ix0 = clamp(Math.floor((c.min.x - AGENT_R - navOrigin.x) / NAV_CELL), 0, navW - 1);
      const ix1 = clamp(Math.ceil((c.max.x + AGENT_R - navOrigin.x) / NAV_CELL), 0, navW - 1);
      const iz0 = clamp(Math.floor((c.min.z - AGENT_R - navOrigin.z) / NAV_CELL), 0, navH - 1);
      const iz1 = clamp(Math.ceil((c.max.z + AGENT_R - navOrigin.z) / NAV_CELL), 0, navH - 1);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          // The cell range above is conservative by up to a cell on each side. Test the cell
          // centre against the inflated box before blocking: without this every 1.8 m doorway
          // loses 1.5 m to rasterisation slop and the building seals itself shut.
          const wx = navOrigin.x + (ix + 0.5) * NAV_CELL;
          const wz = navOrigin.z + (iz + 0.5) * NAV_CELL;
          if (wx + PROBE < c.min.x - AGENT_R || wx - PROBE > c.max.x + AGENT_R) continue;
          if (wz + PROBE < c.min.z - AGENT_R || wz - PROBE > c.max.z + AGENT_R) continue;
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

  const spawnPoints = SPAWN_DEFS.map(([x, z, lx, lz]) => ({
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

    /*
     * Light shafts breathe as the dust drifts through them, and fade with view angle.
     *
     * A shaft is forward-scattered light: you see it when you look towards the sun, and it
     * all but vanishes when the sun is behind you. Without that term these additive cards read
     * as hard-edged white wedges laid over the whole frame from every angle, which was by far
     * the worst artefact in the first review pass. Weighting by the camera-to-sun dot both
     * removes the wedge from the majority of views and is the physically correct behaviour.
     */
    if (dyn.shafts.length) {
      const ctx = g || game;
      const cam = ctx && ctx.camera ? ctx.camera : null;
      let facing = 0.5;
      if (cam) {
        cam.getWorldDirection(_shaftView);
        // SUN_DIR points *to* the sun, so this is +1 looking straight into it.
        facing = _shaftView.dot(SUN_DIR) * 0.5 + 0.5;
      }
      // Bias hard towards the sun-facing half, and keep a small floor so a shaft never pops
      // out of existence as the player turns.
      const gaze = 0.06 + 0.94 * Math.pow(Math.max(0, facing), 3.0);
      for (let i = 0; i < dyn.shafts.length; i++) {
        const breathe = 1.0 + Math.sin(t * 0.31 + i) * 0.14;
        dyn.shafts[i].mat.opacity = SHAFT_OPACITY * gaze * breathe;
      }
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
    /**
     * Named spaces for the HUD's zone readout and the AI's patrol picker, lifted straight
     * from art.js so the minimap legend and this map can never disagree.
     */
    zones: (() => {
      const out = {};
      for (const key of Object.keys(ZONES)) {
        const z = ZONES[key];
        out[key] = {
          label: z.label,
          centre: new THREE.Vector3(z.centre[0], z.centre[1], z.centre[2]),
          radius: z.radius,
        };
      }
      return out;
    })(),
    stats: {
      triangles: triCount,
      colliders: colliders.length,
      draws: (() => {
        let n = 0;
        root.traverse((o) => {
          if (o.isMesh) n++;
        });
        return n;
      })(),
      coverPoints: coverPoints.length,
    },
  };

  if (game && game.debug) {
    // Gated: §6 forbids console output on the shipped path.
    console.info(
      `[level] ${level.stats.draws} draws, ${triCount} collision tris, ${colliders.length} colliders, ${coverPoints.length} cover points`
    );
  }

  return level;
}

export default createLevel;
