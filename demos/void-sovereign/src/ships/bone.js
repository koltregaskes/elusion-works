/* The hostile shipyard: a bone kit.

   The player's navy is lofted from chamfered prisms along a straight keel —
   slabs, strakes, wings, cube greeble. If the enemy is built from the same
   kit it reads as the same navy in another colour, which is what the R7
   critique said it did: at fleet range, where colour carries little, the two
   sides blurred.

   So the enemy yard shares nothing with ours but the class envelope (role,
   length, engine and weapon anchors). Its language is:

     spine   — one swept, arched, slightly S-curved hull whose girth swells and
               pinches at each vertebra and tapers organically to bow and stern;
     ribs    — bevelled bands that wrap the hull section from the dorsal ridge
               down both flanks, flaring and trailing aft toward the tips, never
               cube teeth;
     prongs  — forward-curved mandibles and tusks, unequal in length;
     sponson — an offset pod on ONE flank, hung from swept struts;
     fins / quills — swept blades and raked dorsal spines in place of greeble.

   Everything is a sweep of a 2D profile along a 3D path, so a curve is a curve
   and not a staircase of boxes. Geometry is deterministic per class (no RNG),
   and every level is built from the same recipe with fewer segments, so a
   coarse LOD is the same ship, not a different one. */

import * as THREE from '../../vendor/three/build/three.module.js';
import { KIND, PLATE, Mesher, chamferPoly } from './greeble.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const HOSTILE_LAMP = 0xff6a2a;
const HOSTILE_EYE = 0xff3a1c;

/* ------------------------------------------------------------- profiles */

/** Closed lens / keeled oval, unit size, CCW. `ridge` raises a dorsal crest and
    `keel` drops a ventral one — the vertebral section of a bone hull. */
export function lensProfile(sides, opts = {}) {
  const { ridge = 0, keel = 0, pinch = 0, rot = 0 } = opts;
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let x = c * (1 - pinch * Math.abs(s));
    let y = s;
    if (s > 0) y += ridge * Math.pow(s, 6);
    else y -= keel * Math.pow(-s, 6);
    pts.push([x, y]);
  }
  return pts;
}

/** Bevelled band section: wide along the sweep's B axis, thin along N, sat so
    that most of its depth stands proud of the surface it wraps. CCW. */
export function bandProfile(w, t, chamfer = 0.3) {
  return chamferPoly([
    [w * 0.5, -t * 0.25],
    [w * 0.5, t * 0.75],
    [-w * 0.5, t * 0.75],
    [-w * 0.5, -t * 0.25],
  ], Math.min(w, t) * chamfer);
}

/* ---------------------------------------------------------------- sweep */

const _a = new THREE.Vector3();
const _n = new THREE.Vector3();
const _bv = new THREE.Vector3();

/**
 * Sweep a closed CCW profile along a path.
 * @param {{p:number[], s:number|number[], up?:number[]}[]} path
 * @param {Array<[number,number]>} profile x maps to B, y to N (B = N x T, so
 *        the sweep has the same handedness as `loft` and faces outward).
 * Frames are parallel-transported from `opts.up` unless a point supplies its
 * own `up`, which a rib uses to keep its band's face radial.
 */
export function sweep(path, profile, opts = {}) {
  const n = path.length;
  const m = profile.length;
  const uv = opts.uvScale || 6;
  const P = path.map((q) => new THREE.Vector3(q.p[0], q.p[1], q.p[2]));
  const rings = [];
  let N = null;
  for (let i = 0; i < n; i++) {
    const T = new THREE.Vector3().subVectors(P[Math.min(i + 1, n - 1)], P[Math.max(i - 1, 0)]).normalize();
    const up = path[i].up || (i === 0 ? opts.up || [0, 1, 0] : null);
    if (up) _a.set(up[0], up[1], up[2]);
    else _a.copy(N);
    _n.copy(_a).addScaledVector(T, -_a.dot(T));
    if (_n.lengthSq() < 1e-8) {
      _a.set(1, 0, 0);
      _n.copy(_a).addScaledVector(T, -_a.dot(T));
    }
    _n.normalize();
    N = _n.clone();
    _bv.crossVectors(N, T).normalize();
    const s = path[i].s;
    const sx = Array.isArray(s) ? s[0] : s;
    const sy = Array.isArray(s) ? s[1] : s;
    const ring = [];
    for (let k = 0; k < m; k++) {
      const u = profile[k][0] * sx;
      const v = profile[k][1] * sy;
      ring.push([
        P[i].x + _bv.x * u + N.x * v,
        P[i].y + _bv.y * u + N.y * v,
        P[i].z + _bv.z * u + N.z * v,
      ]);
    }
    rings.push(ring);
  }

  const mesh = opts.into || new Mesher();
  let vAcc = 0;
  for (let i = 0; i < n - 1; i++) {
    const dv = P[i + 1].distanceTo(P[i]);
    let uAcc = 0;
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m;
      const du = Math.hypot(rings[i][j][0] - rings[i][k][0], rings[i][j][1] - rings[i][k][1], rings[i][j][2] - rings[i][k][2]);
      mesh.quad(
        rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k],
        [uAcc / uv, vAcc / uv], [(uAcc + du) / uv, vAcc / uv],
        [(uAcc + du) / uv, (vAcc + dv) / uv], [uAcc / uv, (vAcc + dv) / uv],
      );
      uAcc += du;
    }
    vAcc += dv;
  }

  const cap = (ring, sign) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of ring) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    const c = [cx / m, cy / m, cz / m];
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m;
      if (sign > 0) mesh.tri(c, ring[k], ring[j], [0, 0], [1, 0], [0, 1]);
      else mesh.tri(c, ring[j], ring[k], [0, 0], [1, 0], [0, 1]);
    }
  };
  if (opts.capStart !== false) cap(rings[0], -1);
  if (opts.capEnd !== false) cap(rings[n - 1], 1);
  return opts.into ? null : mesh.geometry();
}

/** Cubic Bézier sampled into `count` sweep points; `s(t)` gives the scale. */
function curve(p0, p1, p2, p3, count, s, up) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push({
      p: [
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
        a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
      ],
      s: s(t),
      up: i === 0 ? up : undefined,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- spine */

/**
 * The hull's spine as a function of t (0 stern .. 1 bow). Girth peaks at
 * `peak`, falls to `stern` (a fraction, so the drive has a face to sit on) and
 * to a point at the bow; vertebrae swell and pinch it; the centreline arches
 * dorsally and sways to one side so no hostile is mirror-true.
 */
function makeSpine(c) {
  const L = c.L;
  const z0 = -L * 0.5;
  const peak = c.peak !== undefined ? c.peak : 0.5;
  const stern = c.stern !== undefined ? c.stern : 0.4;
  const bow = c.bow !== undefined ? c.bow : 0.03;
  const vert = c.vert || 0;
  const bulge = c.bulge !== undefined ? c.bulge : 0.1;
  const ridge = c.ridge !== undefined ? c.ridge : 0.35;
  const keel = c.keel !== undefined ? c.keel : 0.25;
  const env = (t) => {
    if (t < peak) return stern + (1 - stern) * Math.pow(Math.sin((t / peak) * Math.PI * 0.5), 0.75);
    const u = (t - peak) / Math.max(1e-6, 1 - peak);
    return bow + (1 - bow) * Math.pow(Math.cos(u * Math.PI * 0.5), c.bowPow || 0.9);
  };
  const at = (t) => {
    const e = env(t);
    const v = vert ? 1 + bulge * Math.cos(t * vert * TAU) * Math.sin(Math.PI * clamp01(t * 1.15)) : 1;
    return {
      x: (c.sway || 0) * c.W * Math.sin(t * Math.PI * 1.4 + 0.3),
      y: (c.arch || 0) * c.H * Math.sin(t * Math.PI) - (c.droop || 0) * c.H * t * t,
      z: z0 + L * t,
      w: c.W * e * v,
      h: c.H * e * v,
    };
  };
  return {
    at,
    ridge,
    keel,
    top: (t) => { const S = at(t); return S.y + S.h * (1 + ridge * 0.9); },
    bottom: (t) => { const S = at(t); return S.y - S.h * (1 + keel * 0.9); },
    tOf: (z) => (z - z0) / L,
  };
}

/* ------------------------------------------------------------ the kit */

function lodScale(L) {
  // 0 for a fighter, ~1 for a mothership — section and segment counts grow
  // with it so a 1,900 m spine is not a ten-sided pipe.
  return clamp01(Math.log2(Math.max(1, L / 14)) / 7);
}

function hull(ctx, sp, c) {
  const { b } = ctx;
  const k = lodScale(c.L);
  const sides = b.lod(10 + Math.round(14 * k), 8 + Math.round(8 * k), 6 + Math.round(2 * k), 6);
  const segs = b.lod(22 + Math.round(42 * k), 14 + Math.round(18 * k), 9 + Math.round(5 * k), 7);
  const prof = lensProfile(sides, { ridge: sp.ridge, keel: sp.keel, pinch: c.pinch || 0.08, rot: Math.PI / sides });
  const path = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const S = sp.at(t);
    path.push({ p: [S.x, S.y, S.z], s: [S.w, S.h] });
  }
  b.add(sweep(path, prof, {}), { variant: PLATE.HULL, wear: 0.2 });
}

/** One rib: a bevelled band from one flank tip, over the dorsal ridge, to the
    other, flaring and trailing aft toward the tips. `gap` is the open belly. */
function rib(ctx, sp, t, o) {
  const { b } = ctx;
  const S = sp.at(t);
  const k = lodScale(o.L);
  const count = b.lod(12 + Math.round(14 * k), 9 + Math.round(6 * k), 6, 5);
  const gapR = o.gapR !== undefined ? o.gapR : o.gap;
  const gapL = o.gapL !== undefined ? o.gapL : o.gap;
  const a0 = -Math.PI * 0.5 + gapR;
  const a1 = Math.PI * 1.5 - gapL;
  const mid = Math.PI * 0.5;
  const path = [];
  for (let i = 0; i < count; i++) {
    const a = a0 + ((a1 - a0) * i) / (count - 1);
    const tip = Math.abs(a - mid) / Math.max(mid - a0, a1 - mid);
    const flare = 1 + (o.flare || 0) * tip * tip;
    const lift = Math.sin(a) > 0 ? 1 + sp.ridge * 0.85 * Math.pow(Math.sin(a), 6) : 1 + sp.keel * 0.85 * Math.pow(-Math.sin(a), 6);
    const out = o.out || 1.02;
    const rx = S.w * out * flare;
    const ry = S.h * out * flare * (o.out ? 1 : lift);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    path.push({
      p: [S.x + ca * rx, S.y + sa * ry, S.z - (o.back || 0) * tip * tip],
      s: o.even ? 1 : Math.max(0.12, 1 - 0.75 * Math.pow(tip, 3)),
      up: [ca, sa, 0],
    });
  }
  const w = o.bw * (0.6 + 0.4 * Math.min(1, S.w / o.W));
  b.add(sweep(path, bandProfile(w, o.bt * (0.6 + 0.4 * Math.min(1, S.w / o.W)), 0.35), {}), {
    variant: PLATE.ARMOUR, wear: 0.35, team: o.team ? 1 : 0,
  });
}

/** A forward-curved prong (mandible / tusk / feeler) from a base point. */
function prong(ctx, base, o) {
  const { b } = ctx;
  const sides = b.lod(7, 6, 5, 4);
  const pts = b.lod(11, 8, 5, 4);
  const [x, y, z] = base;
  const len = o.len;
  const side = o.side || 0;
  const tip = [x + side * (o.spread || 0) * 0.35 - side * (o.curl || 0) * len * 0.25, y + (o.rise || 0) * len, z + len];
  const p1 = [x + side * (o.spread || 0) * 0.9, y + (o.rise || 0) * len * 0.15, z + len * 0.3];
  const p2 = [x + side * (o.spread || 0) * 1.05, y + (o.rise || 0) * len * 0.6, z + len * 0.72];
  const r = o.r;
  const path = curve(base, p1, p2, tip, pts, (t) => [r * Math.pow(1 - t, 0.85) + r * 0.02, r * 0.8 * Math.pow(1 - t, 0.85) + r * 0.02], [0, 1, 0]);
  b.add(sweep(path, lensProfile(sides, { ridge: 0.35, keel: 0.1 }), {}), { variant: PLATE.ARMOUR, wear: 0.5, team: o.team ? 1 : 0 });
  return tip;
}

/** A swept blade (fin or quill), raked aft. `dir` [dx, dy] is its outward
    direction in the section plane; chord tapers to a point. */
function blade(ctx, base, o) {
  const { b } = ctx;
  const [x, y, z] = base;
  const [dx, dy] = o.dir || [0, 1];
  const len = o.len;
  const rake = o.rake !== undefined ? o.rake : 0.8;
  const tip = [x + dx * len, y + dy * len, z - rake * len];
  const p1 = [x + dx * len * 0.4, y + dy * len * 0.4, z - rake * len * 0.1];
  const p2 = [x + dx * len * 0.8, y + dy * len * 0.8, z - rake * len * 0.45];
  const chord = o.chord;
  const thick = o.thick || chord * 0.14;
  const pts = o.simple ? 3 : b.lod(7, 5, 4, 3);
  const path = curve(base, p1, p2, tip, pts, (t) => [chord * (1 - t) + chord * 0.03, thick * (1 - t * 0.8)], [-dy, dx, 0]);
  b.add(sweep(path, lensProfile(o.simple ? 4 : b.lod(6, 6, 4, 4), {}), {}), {
    variant: PLATE.PANEL, wear: 0.4, team: o.team ? 1 : 0,
  });
  return tip;
}

/** Offset pod on one flank, slung from two swept struts. */
function sponson(ctx, sp, c, o) {
  const { b, kit } = ctx;
  const S0 = sp.at(o.t0);
  const S1 = sp.at(o.t1);
  const side = o.side;
  const sides = b.lod(8, 7, 6, 5);
  const segs = b.lod(12, 8, 6, 4);
  const xOff = (Math.max(S0.w, S1.w) + o.r * 1.4 + (o.gap || 0)) * side;
  const yOff = o.y || 0;
  const path = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const e = 0.45 + 0.55 * Math.pow(Math.sin(Math.min(1, t * 1.35) * Math.PI * 0.5 + (t > 0.74 ? (t - 0.74) * 3.2 : 0)), 0.8);
    const z = S0.z + (S1.z - S0.z) * t;
    const S = sp.at(sp.tOf(z));
    const bow = t > 0.7 ? Math.cos(((t - 0.7) / 0.3) * Math.PI * 0.5) * 0.9 + 0.08 : 1;
    path.push({ p: [S.x + xOff, S.y + yOff + o.r * 0.25 * Math.sin(t * Math.PI), z], s: [o.r * e * bow, o.r * 0.85 * e * bow] });
  }
  b.add(sweep(path, lensProfile(sides, { ridge: 0.3, keel: 0.4 }), {}), { variant: PLATE.HULL, wear: 0.3 });
  // Struts: short swept arms from the hull flank to the pod, raked aft.
  for (const f of o.struts || [0.25, 0.65]) {
    const z = S0.z + (S1.z - S0.z) * f;
    const S = sp.at(sp.tOf(z));
    const from = [S.x + side * S.w * 0.7, S.y + S.h * 0.2, z + o.r * 0.6];
    const to = [S.x + xOff - side * o.r * 0.6, S.y + yOff, z - o.r * 0.8];
    const path2 = curve(from, [from[0] + side * o.r * 0.6, from[1] + o.r * 0.6, from[2]], [to[0] - side * o.r * 0.4, to[1] + o.r * 0.5, to[2] + o.r * 0.2], to, b.lod(6, 4, 3, 3), (t) => [o.r * 0.55 * (1 - t * 0.35), o.r * 0.3], [0, 1, 0]);
    b.add(sweep(path2, lensProfile(b.lod(6, 5, 4, 4), {}), {}), { variant: PLATE.ARMOUR, wear: 0.4 });
  }
  const aft = sp.at(sp.tOf(S0.z));
  if (o.engine) kit.thruster(ctx, aft.x + xOff, aft.y + yOff, S0.z + o.r * 0.1, o.r * 0.55);
  const fore = sp.at(sp.tOf(S1.z));
  return { x: fore.x + xOff, y: fore.y + yOff, z: S1.z, r: o.r };
}

/** Raked dorsal quills down the ridge, tallest amidships. */
function quills(ctx, sp, c, o) {
  const tips = [];
  for (let i = 0; i < o.n; i++) {
    const t = o.t0 + ((o.t1 - o.t0) * i) / Math.max(1, o.n - 1);
    const S = sp.at(t);
    const m = Math.sin(Math.PI * (0.15 + 0.7 * (i + 0.5) / o.n));
    const lean = (o.lean || 0) * (i % 2 ? 1 : -1);
    tips.push(blade(ctx, [S.x, sp.top(t) - S.h * 0.15, S.z], {
      dir: [lean, 1], len: o.len * m * (S.h / c.H + 0.3) / 1.3, chord: o.chord * m, rake: o.rake, team: o.team, simple: o.simple,
    }));
  }
  return tips;
}

/** Barnacle field: small raked spikes over the flanks — the bone yard's
    greeble, in place of cubes. Deterministic scatter, no RNG stream. */
function barnacles(ctx, sp, c, o) {
  const { b } = ctx;
  if (b.detail > 1) return;
  const n = b.lod(o.n, Math.round(o.n * 0.4), 0, 0);
  const prof = lensProfile(4, {});
  for (let i = 0; i < n; i++) {
    const h1 = fract(Math.sin(i * 12.9898 + c.L) * 43758.5453);
    const h2 = fract(Math.sin(i * 78.233 + c.L * 0.7) * 24634.6345);
    const h3 = fract(Math.sin(i * 39.425 + 3.1) * 19341.271);
    const t = o.t0 + (o.t1 - o.t0) * h1;
    const S = sp.at(t);
    const a = (h2 * 1.4 - 0.2) * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const base = [S.x + ca * S.w * 0.97, S.y + sa * S.h * (sa > 0 ? 1 + sp.ridge * Math.pow(sa, 6) : 1) * 0.97, S.z];
    const len = o.size * (0.6 + h3 * 1.2);
    const path = [
      { p: base, s: o.size * 0.35, up: [0, 0, 1] },
      { p: [base[0] + ca * len * 0.5, base[1] + sa * len * 0.5, base[2] - len * 0.3], s: o.size * 0.2 },
      { p: [base[0] + ca * len, base[1] + sa * len, base[2] - len * 0.9], s: o.size * 0.02 },
    ];
    b.add(sweep(path, prof, { capEnd: false }), { variant: PLATE.MECH, wear: 0.5 });
  }
}

function fract(v) {
  return v - Math.floor(v);
}

/**
 * Build one hostile class from its config.
 * Returns the spine so a class can add its own signature on top.
 */
export function boneShip(ctx, c) {
  const { b, kit } = ctx;
  const sp = makeSpine(c);
  hull(ctx, sp, c);

  // Ribs, bevelled bands wrapping the section, never teeth.
  const R = c.ribs;
  if (R && R.n) {
    const n = b.lod(R.n, R.n, Math.max(2, Math.ceil(R.n * 0.5)), Math.max(2, Math.ceil(R.n * 0.34)));
    for (let i = 0; i < n; i++) {
      const t = R.t0 + ((R.t1 - R.t0) * i) / Math.max(1, n - 1);
      const lean = R.asym ? R.asym * Math.sin(i * 1.7) : 0;
      rib(ctx, sp, t, {
        L: c.L, W: c.W, gap: R.gap, gapR: R.gap + lean, gapL: R.gap - lean,
        flare: R.flare * (R.grow ? 0.6 + 0.8 * (i / Math.max(1, n - 1)) : 1),
        back: R.back, bw: R.bw, bt: R.bt, team: R.team && i % 3 === 1,
      });
      // Costal ribs: finer bands between the main ones. On a capital they are
      // what makes 1,900 m read as 1,900 m and not a frigate scaled up.
      const fine = b.lod(R.fine || 0, R.fine ? 1 : 0, 0, 0);
      if (i < n - 1) {
        for (let f = 1; f <= fine; f++) {
          const tf = t + ((R.t1 - R.t0) / Math.max(1, n - 1)) * (f / (fine + 1));
          rib(ctx, sp, tf, {
            L: c.L, W: c.W, gap: R.gap + 0.25, flare: R.flare * 0.45,
            back: R.back * 0.7, bw: R.bw * 0.45, bt: R.bt * 0.55,
          });
        }
      }
    }
  }

  // Stern collar: the drive mounts inside a wrapped band.
  const St = sp.at(0.015);
  rib(ctx, sp, 0.015, { L: c.L, W: c.W, gap: 0.05, flare: 0.04, back: 0, bw: c.L * 0.02, bt: St.w * 0.12 });

  const tips = [];
  for (const p of c.prongs || []) {
    const S = sp.at(p.t);
    const base = [S.x + (p.side || 0) * S.w * (p.out !== undefined ? p.out : 0.55), S.y + (p.y || 0) * S.h, S.z];
    tips.push(prong(ctx, base, p));
  }
  for (const f of c.fins || []) {
    const S = sp.at(f.t);
    const dir = f.dir || [0, 1];
    const base = [S.x + dir[0] * S.w * 0.6, S.y + (dir[1] >= 0 ? sp.top(f.t) - S.y - S.h * 0.2 : sp.bottom(f.t) - S.y + S.h * 0.2), S.z];
    tips.push(blade(ctx, base, f));
  }
  if (c.quills) tips.push(...quills(ctx, sp, c, c.quills));
  let pod = null;
  if (c.sponson) pod = sponson(ctx, sp, c, c.sponson);
  if (c.sponson2) sponson(ctx, sp, c, c.sponson2);
  if (c.barnacles) barnacles(ctx, sp, c, c.barnacles);

  // Halo: a closed band standing well off the hull on swept spokes.
  if (c.halo) {
    const h = c.halo;
    const S = sp.at(h.t);
    rib(ctx, sp, h.t, { L: c.L, W: c.W, gap: 0.0, flare: 0, out: h.out, even: true, back: 0, bw: h.bw, bt: h.bt, team: true });
    for (let k = 0; k < 4; k++) {
      const a = Math.PI * 0.25 + k * Math.PI * 0.5 + 0.2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      b.add(sweep([
        { p: [S.x + ca * S.w * 0.6, S.y + sa * S.h * 0.6, S.z + h.bw * 2], s: [h.bw * 0.6, h.bt * 0.9], up: [0, 0, 1] },
        { p: [S.x + ca * S.w * (0.6 + h.out) * 0.5, S.y + sa * S.h * (0.6 + h.out) * 0.5, S.z + h.bw * 0.8], s: [h.bw * 0.45, h.bt * 0.7] },
        { p: [S.x + ca * S.w * h.out, S.y + sa * S.h * h.out, S.z], s: [h.bw * 0.35, h.bt * 0.6] },
      ], lensProfile(b.lod(6, 5, 4, 4), {}), {}), { variant: PLATE.ARMOUR, wear: 0.4 });
    }
  }

  // Crest: a serrated low blade down the dorsal ridge (capitals).
  if (c.crest) quills(ctx, sp, c, c.crest);

  // Drives: on the stern face, inside the collar.
  const S0 = sp.at(0);
  for (const e of c.engines || []) {
    kit.thruster(ctx, S0.x + e[0] * S0.w, S0.y + e[1] * S0.h, S0.z + c.L * 0.004, e[2] * S0.w);
  }

  // Weapon anchors: prong and quill tips first, then the sponson nose and
  // spine stations, until the class has as many as the player's hull does.
  const want = c.hp !== undefined ? c.hp : 1;
  const anchors = [];
  for (const t of tips) anchors.push(t);
  if (pod) anchors.push([pod.x, pod.y, pod.z]);
  for (let i = 0; anchors.length < want; i++) {
    const t = 0.25 + 0.6 * fract(i * 0.618 + 0.11);
    const S = sp.at(t);
    anchors.push([S.x + (i % 2 ? 1 : -1) * S.w * 0.8, S.y + S.h * 0.6, S.z]);
  }
  for (let i = 0; i < want; i++) kit.hp(ctx, anchors[i][0], anchors[i][1], anchors[i][2]);

  // Lamps: a hot eye pair at the bow and a dorsal row, in the hostile drive hue.
  const Sb = sp.at(0.86);
  const sz = Math.max(0.12, c.L * 0.012);
  kit.light(ctx, Sb.x + Sb.w * 0.55, Sb.y + Sb.h * 0.35, Sb.z, HOSTILE_EYE, 1.7, sz);
  kit.light(ctx, Sb.x - Sb.w * 0.45, Sb.y + Sb.h * 0.25, Sb.z - c.L * 0.01, HOSTILE_EYE, 1.9, sz * 0.8);
  const nl = Math.max(1, Math.round(c.lamps || 1));
  for (let i = 0; i < nl; i++) {
    const t = 0.2 + (0.55 * (i + 0.5)) / nl;
    kit.light(ctx, sp.at(t).x, sp.top(t), sp.at(t).z, HOSTILE_LAMP, 2.4 + (i % 3) * 0.2, sz);
  }

  if (c.flankLamps) {
    const nf = c.flankLamps;
    for (let i = 0; i < nf; i++) {
      const t = 0.14 + (0.68 * i) / Math.max(1, nf - 1);
      const S = sp.at(t);
      for (const sd of [1, -1]) kit.light(ctx, S.x + sd * S.w * 1.01, S.y - S.h * 0.15, S.z, HOSTILE_LAMP, 2.6 + (i % 5) * 0.08, sz * 0.7);
    }
  }

  // Livery: the dorsal crest carries the faction's mark.
  b.paint({ x0: -c.W * 0.35, x1: c.W * 0.35, y0: sp.top(0.5) - c.H * 0.3, y1: sp.top(0.5) + c.H, z0: -c.L * 0.3, z1: c.L * 0.3, n: [0, 1, 0], nMin: 0.55 });
  return { sp, tips, pod };
}

/* --------------------------------------------------------------- classes */

const P = (side, t, len, spread, o = {}) => ({ side, t, len, spread, curl: 0.35, r: 0, ...o });

/* Every config is in metres along a hull of the class's catalog length; the
   builder normalises the result to that length exactly as it does the
   player's. Widths are set to sit inside the player's envelope for the class. */
const CLASSES = {
  scout: (L) => ({
    L, W: L * 0.095, H: L * 0.085, peak: 0.62, stern: 0.5, bow: 0.04, vert: 3, bulge: 0.12, arch: 0.3, sway: 0.15,
    ribs: { n: 3, t0: 0.28, t1: 0.55, gap: 0.5, flare: 0.5, back: L * 0.06, bw: L * 0.04, bt: L * 0.026 },
    prongs: [P(1, 0.82, L * 0.42, L * 0.06, { r: L * 0.022, rise: 0.08, curl: 0.2 }), P(-1, 0.8, L * 0.32, L * 0.05, { r: L * 0.02, rise: 0.12, curl: 0.25 })],
    // Sensor sail: the scout is the one hull that keeps a single tall fin.
    fins: [{ t: 0.3, dir: [-0.15, 1], len: L * 0.3, chord: L * 0.16, rake: 1.3, team: 1 }, { t: 0.32, dir: [0.2, -1], len: L * 0.16, chord: L * 0.1, rake: 1.0 }],
    engines: [[0.45, 0, 0.32], [-0.45, 0, 0.32]], hp: 1, lamps: 1,
  }),
  interceptor: (L) => ({
    L, W: L * 0.11, H: L * 0.09, peak: 0.55, stern: 0.55, bow: 0.04, vert: 3, bulge: 0.1, arch: 0.25, sway: 0.1,
    ribs: { n: 4, t0: 0.22, t1: 0.6, gap: 0.45, flare: 0.9, back: L * 0.08, bw: L * 0.036, bt: L * 0.028, grow: 1, asym: 0.25 },
    // A pincer: two great mandibles, unequal, curling in ahead of the bow.
    prongs: [
      P(1, 0.66, L * 0.56, L * 0.26, { r: L * 0.056, rise: -0.04, curl: 0.8, team: 1 }),
      P(-1, 0.64, L * 0.44, L * 0.21, { r: L * 0.05, rise: -0.02, curl: 0.7 }),
    ],
    // Canted V tail in place of a sail.
    fins: [{ t: 0.12, dir: [0.75, 0.7], len: L * 0.2, chord: L * 0.13, rake: 0.9 }, { t: 0.14, dir: [-0.8, 0.6], len: L * 0.16, chord: L * 0.11, rake: 0.9 }],
    sponson: { side: 1, t0: 0.12, t1: 0.42, r: L * 0.045, gap: L * 0.02, engine: false, struts: [0.5] },
    engines: [[0.42, 0.05, 0.36], [-0.42, -0.05, 0.36]], hp: 2, lamps: 1,
  }),
  bomber: (L) => ({
    L, W: L * 0.14, H: L * 0.115, peak: 0.42, stern: 0.55, bow: 0.05, vert: 4, bulge: 0.12, keel: 0.7, arch: 0.15, sway: 0.08,
    ribs: { n: 5, t0: 0.18, t1: 0.62, gap: 0.3, flare: 0.55, back: L * 0.07, bw: L * 0.032, bt: L * 0.026, asym: 0.2 },
    prongs: [
      // The lance: one long ventral tusk, the bomber's whole silhouette.
      P(0, 0.62, L * 0.7, 0, { r: L * 0.05, y: -0.7, rise: 0.08, curl: 0, team: 1 }),
      P(1, 0.66, L * 0.26, L * 0.1, { r: L * 0.03, y: 0.2, rise: -0.1, curl: 0.6 }),
      P(-1, 0.64, L * 0.2, L * 0.09, { r: L * 0.028, y: 0.2, rise: -0.1, curl: 0.6 }),
    ],
    fins: [{ t: 0.2, dir: [0.35, 1], len: L * 0.17, chord: L * 0.15, rake: 1.1 }],
    sponson: { side: -1, t0: 0.08, t1: 0.4, r: L * 0.05, gap: L * 0.015, engine: true },
    engines: [[0.42, 0.1, 0.3], [-0.3, 0.25, 0.26], [0.1, -0.4, 0.28]], hp: 4, lamps: 2,
  }),
  corvette: (L) => ({
    L, W: L * 0.12, H: L * 0.1, peak: 0.5, stern: 0.5, bow: 0.03, vert: 5, bulge: 0.11, arch: 0.3, sway: 0.12,
    ribs: { n: 6, t0: 0.16, t1: 0.66, gap: 0.35, flare: 0.75, back: L * 0.06, bw: L * 0.028, bt: L * 0.024, grow: 1, asym: 0.3 },
    prongs: [
      P(1, 0.74, L * 0.36, L * 0.13, { r: L * 0.03, curl: 0.65 }),
      P(-1, 0.72, L * 0.3, L * 0.12, { r: L * 0.028, curl: 0.6 }),
      // A dorsal horn swept forward over the bow.
      P(0, 0.62, L * 0.4, 0, { r: L * 0.03, y: 1.1, rise: 0.22, curl: 0, team: 1 }),
    ],
    fins: [{ t: 0.14, dir: [0.7, 0.75], len: L * 0.16, chord: L * 0.11, rake: 0.9 }, { t: 0.36, dir: [-0.2, -1], len: L * 0.14, chord: L * 0.1, rake: 1.0 }],
    sponson: { side: -1, t0: 0.08, t1: 0.46, r: L * 0.042, gap: L * 0.02, engine: true },
    engines: [[0.4, 0.15, 0.3], [-0.35, 0.2, 0.28], [0.15, -0.35, 0.28]], hp: 2, lamps: 2,
  }),
  missileCorvette: (L) => ({
    L, W: L * 0.105, H: L * 0.09, peak: 0.45, stern: 0.55, bow: 0.05, vert: 4, bulge: 0.12, arch: 0.15, sway: 0.1,
    ribs: { n: 4, t0: 0.15, t1: 0.7, gap: 0.55, flare: 0.4, back: L * 0.05, bw: L * 0.03, bt: L * 0.024 },
    // Quill racks: the missiles are carried in the spines.
    quills: { n: 6, t0: 0.22, t1: 0.68, len: L * 0.3, chord: L * 0.06, rake: 1.0, lean: 0.35, team: 1 },
    prongs: [P(1, 0.8, L * 0.2, L * 0.08, { r: L * 0.026, curl: 0.5 }), P(-1, 0.78, L * 0.16, L * 0.07, { r: L * 0.024, curl: 0.5 })],
    sponson: { side: 1, t0: 0.12, t1: 0.4, r: L * 0.04, gap: L * 0.01, engine: false, struts: [0.5] },
    engines: [[0.35, 0, 0.36], [-0.35, 0, 0.36]], hp: 6, lamps: 2,
  }),
  collector: (L) => ({
    L, W: L * 0.17, H: L * 0.14, peak: 0.4, stern: 0.55, bow: 0.12, bowPow: 0.6, vert: 3, bulge: 0.1, keel: 0.5, arch: 0.2, sway: 0.1,
    ribs: { n: 4, t0: 0.2, t1: 0.62, gap: 0.2, flare: 0.9, back: L * 0.08, bw: L * 0.04, bt: L * 0.03, asym: 0.25 },
    // Scoop: two great pincers curling in under the bow.
    prongs: [
      P(1, 0.7, L * 0.48, L * 0.2, { r: L * 0.055, y: -0.5, rise: -0.12, curl: 1.0 }),
      P(-1, 0.7, L * 0.42, L * 0.18, { r: L * 0.05, y: -0.5, rise: -0.1, curl: 1.0, team: 1 }),
    ],
    engines: [[0.4, 0.1, 0.3], [-0.4, -0.05, 0.3]], hp: 0, lamps: 1,
  }),
  assaultFrigate: (L) => ({
    L, W: L * 0.08, H: L * 0.078, peak: 0.5, stern: 0.5, bow: 0.03, vert: 7, bulge: 0.12, arch: 0.45, sway: 0.15,
    ribs: { n: 8, t0: 0.16, t1: 0.74, gap: 0.4, flare: 0.5, back: L * 0.045, bw: L * 0.02, bt: L * 0.02, grow: 1, asym: 0.3, team: 1 },
    prongs: [
      P(1, 0.76, L * 0.38, L * 0.1, { r: L * 0.022, curl: 0.6, rise: -0.05 }),
      P(-1, 0.74, L * 0.28, L * 0.08, { r: L * 0.019, curl: 0.55, rise: -0.03 }),
    ],
    quills: { n: 6, t0: 0.26, t1: 0.68, len: L * 0.12, chord: L * 0.032, rake: 1.2, lean: 0.25 },
    fins: [{ t: 0.14, dir: [0.7, 0.7], len: L * 0.12, chord: L * 0.08, rake: 0.9, team: 1 }, { t: 0.4, dir: [0.15, -1], len: L * 0.12, chord: L * 0.07, rake: 1.0 }],
    sponson: { side: 1, t0: 0.1, t1: 0.55, r: L * 0.03, gap: L * 0.014, engine: true },
    barnacles: { n: 50, t0: 0.15, t1: 0.8, size: L * 0.012 },
    engines: [[0.45, 0.2, 0.26], [-0.45, 0.2, 0.26], [0.2, -0.4, 0.24], [-0.25, -0.35, 0.24], [0, 0.55, 0.2]], hp: 12, lamps: 4,
  }),
  ionFrigate: (L) => ({
    L, W: L * 0.07, H: L * 0.07, peak: 0.36, stern: 0.6, bow: 0.12, bowPow: 0.7, vert: 6, bulge: 0.13, arch: 0.2, sway: 0.1,
    // Capacitor collars: closed bands crowding the gun end of the spine.
    ribs: { n: 7, t0: 0.5, t1: 0.86, gap: 0.0, flare: 0.25, back: L * 0.015, bw: L * 0.018, bt: L * 0.02, team: 1 },
    // The ion lance is a single tusk carried well past the bow.
    prongs: [
      P(0, 0.9, L * 0.45, 0, { r: L * 0.03, y: -0.2, rise: 0.02, curl: 0 }),
      P(1, 0.5, L * 0.22, L * 0.08, { r: L * 0.017, y: 0.3, curl: 0.8 }),
    ],
    fins: [{ t: 0.16, dir: [0.1, 1], len: L * 0.13, chord: L * 0.1, rake: 1.2 }, { t: 0.16, dir: [0.1, -1], len: L * 0.13, chord: L * 0.1, rake: 1.2 }],
    sponson: { side: -1, t0: 0.06, t1: 0.36, r: L * 0.03, gap: L * 0.01, engine: true },
    barnacles: { n: 40, t0: 0.12, t1: 0.7, size: L * 0.011 },
    engines: [[0.35, 0.1, 0.32], [-0.3, -0.2, 0.3]], hp: 1, lamps: 3,
  }),
  supportFrigate: (L) => ({
    L, W: L * 0.085, H: L * 0.085, peak: 0.45, stern: 0.5, bow: 0.06, vert: 5, bulge: 0.12, arch: 0.3, sway: 0.12,
    ribs: { n: 5, t0: 0.16, t1: 0.7, gap: 0.5, flare: 0.4, back: L * 0.03, bw: L * 0.02, bt: L * 0.02 },
    // The halo: one closed band standing well off the hull on four spokes.
    halo: { t: 0.48, out: 2.6, bw: L * 0.035, bt: L * 0.022 },
    prongs: [P(1, 0.82, L * 0.2, L * 0.06, { r: L * 0.02, curl: 0.5 }), P(-1, 0.8, L * 0.16, L * 0.05, { r: L * 0.018, curl: 0.5 })],
    sponson: { side: 1, t0: 0.08, t1: 0.3, r: L * 0.03, gap: L * 0.012, engine: true },
    barnacles: { n: 40, t0: 0.12, t1: 0.8, size: L * 0.011 },
    engines: [[0.4, 0.15, 0.3], [-0.4, 0.15, 0.3], [0, -0.4, 0.3]], hp: 6, lamps: 3,
  }),
  destroyer: (L) => ({
    L, W: L * 0.08, H: L * 0.085, peak: 0.48, stern: 0.5, bow: 0.03, vert: 9, bulge: 0.12, arch: 0.4, sway: 0.12, keel: 0.5,
    ribs: { n: 10, t0: 0.12, t1: 0.76, gap: 0.4, flare: 0.5, back: L * 0.03, bw: L * 0.014, bt: L * 0.014, grow: 1, asym: 0.3, team: 1, fine: 1 },
    prongs: [
      // A ventral ram well ahead of the bow, flanked by mandibles.
      P(0, 0.8, L * 0.34, 0, { r: L * 0.024, y: -0.8, rise: 0.06, curl: 0 }),
      P(1, 0.78, L * 0.26, L * 0.08, { r: L * 0.016, curl: 0.65 }),
      P(-1, 0.76, L * 0.22, L * 0.07, { r: L * 0.015, curl: 0.6 }),
    ],
    crest: { n: 9, t0: 0.18, t1: 0.66, len: L * 0.07, chord: L * 0.06, rake: 0.7, lean: 0, team: 1 },
    fins: [{ t: 0.35, dir: [0.2, -1], len: L * 0.12, chord: L * 0.06, rake: 1.0 }],
    sponson: { side: 1, t0: 0.12, t1: 0.6, r: L * 0.032, gap: L * 0.014, engine: true, struts: [0.2, 0.5, 0.8] },
    barnacles: { n: 260, t0: 0.1, t1: 0.82, size: L * 0.007 }, flankLamps: 8,
    engines: [[0.45, 0.2, 0.24], [-0.45, 0.2, 0.24], [0.2, -0.4, 0.22], [-0.25, -0.35, 0.22], [0, 0.55, 0.2]], hp: 20, lamps: 6,
  }),
  cruiser: (L) => ({
    L, W: L * 0.085, H: L * 0.09, peak: 0.45, stern: 0.55, bow: 0.04, vert: 11, bulge: 0.1, arch: 0.35, sway: 0.1,
    ribs: { n: 13, t0: 0.1, t1: 0.78, gap: 0.35, flare: 0.5, back: L * 0.028, bw: L * 0.011, bt: L * 0.011, grow: 1, asym: 0.3, team: 1, fine: 1 },
    prongs: [
      P(1, 0.8, L * 0.24, L * 0.08, { r: L * 0.015, curl: 0.65 }),
      P(-1, 0.78, L * 0.2, L * 0.07, { r: L * 0.014, curl: 0.6 }),
      P(0, 0.7, L * 0.26, 0, { r: L * 0.016, y: 1.0, rise: 0.22, curl: 0 }),
    ],
    quills: { n: 9, t0: 0.2, t1: 0.6, len: L * 0.08, chord: L * 0.02, rake: 1.2, lean: 0.3 },
    fins: [{ t: 0.12, dir: [0.75, 0.65], len: L * 0.12, chord: L * 0.07, rake: 0.9, team: 1 }, { t: 0.12, dir: [-0.75, 0.65], len: L * 0.1, chord: L * 0.06, rake: 0.9 }],
    // Two sponsons, deliberately unmatched: a long gun pod to starboard
    // forward, a short drive pod to port aft.
    sponson: { side: 1, t0: 0.3, t1: 0.74, r: L * 0.03, gap: L * 0.012, engine: false },
    sponson2: { side: -1, t0: 0.06, t1: 0.34, r: L * 0.034, gap: L * 0.014, engine: true },
    barnacles: { n: 420, t0: 0.08, t1: 0.85, size: L * 0.0055 }, flankLamps: 11,
    engines: [[0.45, 0.2, 0.22], [-0.45, 0.2, 0.22], [0.25, -0.4, 0.2], [-0.25, -0.4, 0.2], [0, 0.55, 0.2], [0, -0.05, 0.22], [0.6, -0.1, 0.16]], hp: 22, lamps: 8,
  }),
  carrier: (L) => ({
    L, W: L * 0.1, H: L * 0.085, peak: 0.42, stern: 0.6, bow: 0.06, vert: 8, bulge: 0.1, keel: 0.15, arch: 0.3, sway: 0.08,
    // The ribcage is the hangar: wide, open-bellied, deeply flared, so the
    // strike craft launch out of a cage rather than a slot.
    ribs: { n: 11, t0: 0.16, t1: 0.7, gap: 0.75, flare: 1.7, back: L * 0.05, bw: L * 0.013, bt: L * 0.013, asym: 0.15, team: 1, fine: 2 },
    prongs: [P(1, 0.8, L * 0.18, L * 0.07, { r: L * 0.016, curl: 0.5 }), P(-1, 0.78, L * 0.15, L * 0.06, { r: L * 0.014, curl: 0.5 })],
    crest: { n: 8, t0: 0.12, t1: 0.5, len: L * 0.06, chord: L * 0.06, rake: 0.7, lean: 0 },
    sponson: { side: -1, t0: 0.08, t1: 0.5, r: L * 0.045, gap: L * 0.09, engine: true, struts: [0.2, 0.5, 0.8] },
    barnacles: { n: 520, t0: 0.08, t1: 0.85, size: L * 0.005 }, flankLamps: 13,
    engines: [[0.42, 0.2, 0.24], [-0.42, 0.2, 0.24], [0.25, -0.35, 0.22], [-0.25, -0.35, 0.22], [0, 0.5, 0.2]], hp: 12, lamps: 8,
    dockAt: [0.3, 0.42, 0.54, 0.66],
  }),
  mothership: (L) => ({
    L, W: L * 0.13, H: L * 0.14, peak: 0.4, stern: 0.6, bow: 0.1, bowPow: 0.75, vert: 12, bulge: 0.09, keel: 0.45, ridge: 0.5, arch: 0.3, sway: 0.08,
    ribs: { n: 15, t0: 0.1, t1: 0.78, gap: 0.5, flare: 0.75, back: L * 0.03, bw: L * 0.01, bt: L * 0.012, grow: 1, asym: 0.3, team: 1, fine: 2 },
    prongs: [
      P(1, 0.8, L * 0.24, L * 0.1, { r: L * 0.018, curl: 0.7 }),
      P(-1, 0.78, L * 0.2, L * 0.09, { r: L * 0.016, curl: 0.65 }),
      P(1, 0.7, L * 0.16, L * 0.11, { r: L * 0.013, y: -0.6, curl: 0.5, rise: -0.1 }),
      P(-1, 0.72, L * 0.14, L * 0.1, { r: L * 0.012, y: -0.6, curl: 0.5, rise: -0.1 }),
    ],
    // The crown: a serrated dorsal crest, the tallest blade amidships.
    crest: { n: 11, t0: 0.18, t1: 0.66, len: L * 0.09, chord: L * 0.07, rake: 0.6, lean: 0, team: 1 },
    fins: [{ t: 0.3, dir: [0.1, -1], len: L * 0.12, chord: L * 0.1, rake: 1.0 }],
    sponson: { side: 1, t0: 0.1, t1: 0.58, r: L * 0.045, gap: L * 0.03, engine: true, struts: [0.15, 0.45, 0.75] },
    sponson2: { side: -1, t0: 0.22, t1: 0.44, r: L * 0.03, gap: L * 0.02, engine: true },
    barnacles: { n: 1100, t0: 0.06, t1: 0.86, size: L * 0.0035 }, flankLamps: 26,
    engines: [[0.5, 0.2, 0.18], [-0.5, 0.2, 0.18], [0.3, -0.35, 0.17], [-0.3, -0.35, 0.17], [0, 0.55, 0.16], [0, -0.05, 0.2], [0.25, 0.6, 0.12], [-0.25, 0.6, 0.12], [0.65, -0.15, 0.12], [-0.65, -0.15, 0.12]], hp: 32, lamps: 12,
    dockAt: [0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.48],
  }),
};

/** Hostile builder for `classId`, or null if the class has no bone variant. */
export function hostileBuilder(classId) {
  const make = CLASSES[classId];
  if (!make) return null;
  return (ctx) => {
    const c = make(ctx.def.length);
    const { sp } = boneShip(ctx, c);
    // Dock points in the open belly, alternating flanks down the ribcage.
    if (c.dockAt) {
      c.dockAt.forEach((t, i) => {
        const S = sp.at(t);
        const s = i === c.dockAt.length - 1 && c.dockAt.length % 2 ? 0 : (i % 2 ? -1 : 1);
        ctx.dock.push(new THREE.Vector3(S.x + s * S.w * 0.6, sp.bottom(t) - S.h * 0.15, S.z));
      });
    } else if (classId === 'collector') {
      const S = sp.at(0.6);
      ctx.dock.push(new THREE.Vector3(S.x, sp.bottom(0.6) - S.h * 0.2, S.z));
    }
  };
}

export const HOSTILE_CLASSES = Object.keys(CLASSES);
