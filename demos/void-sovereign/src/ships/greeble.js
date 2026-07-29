/* Procedural detail toolkit for the fleet.

   Everything the hull builders draw with lives here: lofted cross-section
   surfaces, chamfered primitives, recessed pockets, turrets, engine bells and
   the greeble vocabulary that gives a hull its sense of scale.

   Two rules shape the whole file.

   - Geometry is non-indexed and flat shaded. A chamfer only reads as a chamfer
     if its two faces meet at a hard edge; averaged normals turn every bevel
     into a smear and the model instantly looks like a browser toy.
   - Every part carries the four attributes the hull material samples — `uv`,
     `aTeamMask`, `aVariant`, `aWear`. A merge silently drops any attribute a
     single input is missing, so they are written on the way in, not later.

   Convention for composite helpers (nozzles, pockets, turrets): the working
   face points down -Z with its opening at the local origin and the body
   extending toward +Z. Placing one on a flank or a deck is then a rotation. */

import * as THREE from '../../vendor/three/build/three.module.js';
import { mergeGeometries } from '../../vendor/three/addons/utils/BufferGeometryUtils.js';
import { fbm3 } from '../core/rng.js';

/** Metres per UV tile. Constant across the fleet, so a 1,900 m mothership
    carries ~300 plate rows down its flank and a 14 m fighter carries two —
    which is exactly the scale cue ARCHITECTURE §3.4 asks for. */
export const UV_TILE = 6;

export const KIND = { HULL: 'hull', GLASS: 'glass', GLOW: 'glow' };

/** Plate families in the material atlas. `aVariant` selects one. */
export const PLATE = {
  HULL: 0, // large bare plating
  ARMOUR: 1, // belt armour, prow, turret faces
  PANEL: 2, // fine access panelling, superstructure skin
  MECH: 3, // exposed machinery, engine block, greeble
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ mesher */

const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _nrm = new THREE.Vector3();

/** Triangle soup accumulator. Computes a flat normal per face and drops
    degenerate triangles, which is what lets a profile taper to a knife edge
    without leaving slivers behind. */
export class Mesher {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uvs = [];
  }

  tri(a, b, c, ua, ub, uc) {
    _e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _e2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _nrm.crossVectors(_e1, _e2);
    const len = _nrm.length();
    if (len < 1e-9) return this;
    _nrm.multiplyScalar(1 / len);
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.nor.push(_nrm.x, _nrm.y, _nrm.z);
    this.uvs.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    return this;
  }

  quad(a, b, c, d, ua, ub, uc, ud) {
    this.tri(a, b, c, ua, ub, uc);
    this.tri(a, c, d, ua, uc, ud);
    return this;
  }

  get empty() {
    return this.pos.length === 0;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    return g;
  }
}

/* ------------------------------------------------------------ 2D profiles */

/** Bevel every corner of a closed polygon. Always emits two points per corner
    so that a family of stations keeps a matching point count even when some of
    them use a zero chamfer — the coincident pair collapses into a degenerate
    quad that the mesher throws away. */
export function chamferPoly(pts, amount) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const p = pts[(i - 1 + n) % n];
    const q = pts[(i + 1) % n];
    const a = Array.isArray(amount) ? amount[i] : amount;
    const px = p[0] - c[0];
    const py = p[1] - c[1];
    const qx = q[0] - c[0];
    const qy = q[1] - c[1];
    const pl = Math.hypot(px, py) || 1;
    const ql = Math.hypot(qx, qy) || 1;
    const ap = Math.min(a || 0, pl * 0.47);
    const aq = Math.min(a || 0, ql * 0.47);
    out.push([c[0] + (px / pl) * ap, c[1] + (py / pl) * ap]);
    out.push([c[0] + (qx / ql) * aq, c[1] + (qy / ql) * aq]);
  }
  return out;
}

/** Chamfered rectangle. `wTop`/`wBot` give tumblehome; `top`/`bottom` let the
    section sit off-axis without moving the loft spine. */
export function rectSection(w, h, opts = {}) {
  const wTop = opts.wTop !== undefined ? opts.wTop : w;
  const wBot = opts.wBot !== undefined ? opts.wBot : w;
  const cx = opts.cx || 0;
  const cy = opts.cy || 0;
  const top = opts.top !== undefined ? opts.top : h * 0.5;
  const bot = opts.bottom !== undefined ? opts.bottom : -h * 0.5;
  const c = opts.chamfer || 0;
  const ct = opts.chamferTop !== undefined ? opts.chamferTop : c;
  const cb = opts.chamferBottom !== undefined ? opts.chamferBottom : c;
  const pts = [
    [cx + wBot * 0.5, cy + bot],
    [cx + wTop * 0.5, cy + top],
    [cx - wTop * 0.5, cy + top],
    [cx - wBot * 0.5, cy + bot],
  ];
  return chamferPoly(pts, [cb, ct, ct, cb]);
}

/** Rectangle with a channel cut out of its deck. The notch is part of the
    cross-section, so the trench floor and walls come out of the same loft —
    real recessed geometry rather than a dark texture. */
export function trenchSection(w, h, opts = {}) {
  const wTop = opts.wTop !== undefined ? opts.wTop : w;
  const wBot = opts.wBot !== undefined ? opts.wBot : w;
  const cx = opts.cx || 0;
  const cy = opts.cy || 0;
  const top = opts.top !== undefined ? opts.top : h * 0.5;
  const bot = opts.bottom !== undefined ? opts.bottom : -h * 0.5;
  const nw = opts.notchW !== undefined ? opts.notchW : wTop * 0.3;
  const nd = opts.notchDepth !== undefined ? opts.notchDepth : h * 0.12;
  const c = opts.chamfer || 0;
  const ct = opts.chamferTop !== undefined ? opts.chamferTop : c;
  const cb = opts.chamferBottom !== undefined ? opts.chamferBottom : c;
  const ci = opts.chamferNotch !== undefined ? opts.chamferNotch : c * 0.5;
  const pts = [
    [cx + wBot * 0.5, cy + bot],
    [cx + wTop * 0.5, cy + top],
    [cx + nw * 0.5, cy + top],
    [cx + nw * 0.5, cy + top - nd],
    [cx - nw * 0.5, cy + top - nd],
    [cx - nw * 0.5, cy + top],
    [cx - wTop * 0.5, cy + top],
    [cx - wBot * 0.5, cy + bot],
  ];
  return chamferPoly(pts, [cb, ct, ci, ci, ci, ci, ct, cb]);
}

/** Regular n-gon, optionally squashed. Used for tubes, barrels and nozzles. */
export function ngonSection(r, sides = 10, opts = {}) {
  const rot = opts.rot || 0;
  const sx = opts.sx !== undefined ? opts.sx : 1;
  const sy = opts.sy !== undefined ? opts.sy : 1;
  const cx = opts.cx || 0;
  const cy = opts.cy || 0;
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * TAU;
    pts.push([cx + Math.cos(a) * r * sx, cy + Math.sin(a) * r * sy]);
  }
  return pts;
}

/** Uniform scale about a pivot. Cheap stand-in for a polygon inset — accurate
    enough for the end-cap rings that turn a flat face into a chamfered one. */
export function scalePoly(pts, sx, sy = sx, cx = 0, cy = 0) {
  return pts.map((p) => [cx + (p[0] - cx) * sx, cy + (p[1] - cy) * sy]);
}

export function offsetPoly(pts, dx, dy) {
  return pts.map((p) => [p[0] + dx, p[1] + dy]);
}

export function reversePoly(pts) {
  return pts.slice().reverse();
}

function dedupePoly(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = out.length ? out[out.length - 1] : null;
    if (q && Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
  }
  return out;
}

/* ----------------------------------------------------------------- lofting */

const _v2a = new THREE.Vector2();

function capPoly(m, pts, z, sign, uvScale) {
  const clean = dedupePoly(pts);
  if (clean.length < 3) return;
  const contour = clean.map((p) => new THREE.Vector2(p[0], p[1]));
  let faces = null;
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch (err) {
    faces = null;
  }
  if (!faces) return;
  for (let f = 0; f < faces.length; f++) {
    const A = contour[faces[f][0]];
    const B = contour[faces[f][1]];
    const C = contour[faces[f][2]];
    if (!A || !B || !C) continue;
    const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    const flip = sign > 0 ? cross < 0 : cross > 0;
    const p0 = [A.x, A.y, z];
    const p1 = [B.x, B.y, z];
    const p2 = [C.x, C.y, z];
    const u0 = [A.x / uvScale, A.y / uvScale];
    const u1 = [B.x / uvScale, B.y / uvScale];
    const u2 = [C.x / uvScale, C.y / uvScale];
    if (flip) m.tri(p0, p2, p1, u0, u2, u1);
    else m.tri(p0, p1, p2, u0, u1, u2);
  }
  _v2a.set(0, 0);
}

/**
 * Skin a run of cross-sections into a surface.
 * @param {{z:number, pts:Array<[number,number]>}[]} stations ordered along +Z,
 *        every station sharing a point count.
 * @param {object} opts `capStart`, `capEnd`, `inward` (flip to face inward),
 *        `into` (append to an existing Mesher), `uvScale`, `u0`, `v0`.
 * UVs run in metres: U around the section, V along the spine.
 */
export function loft(stations, opts = {}) {
  const uvScale = opts.uvScale || UV_TILE;
  const m = opts.into || new Mesher();
  const inward = !!opts.inward;
  const capStart = opts.capStart !== false;
  const capEnd = opts.capEnd !== false;
  const st = inward ? stations.map((s) => ({ z: s.z, pts: reversePoly(s.pts) })) : stations;
  const n = st[0].pts.length;

  const vv = [opts.v0 || 0];
  for (let k = 1; k < st.length; k++) vv[k] = vv[k - 1] + Math.abs(st[k].z - st[k - 1].z);

  const uu = st.map((s) => {
    const arr = new Array(n + 1);
    arr[0] = opts.u0 || 0;
    for (let i = 0; i < n; i++) {
      const p = s.pts[i];
      const q = s.pts[(i + 1) % n];
      arr[i + 1] = arr[i] + Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    return arr;
  });

  for (let k = 0; k < st.length - 1; k++) {
    const s0 = st[k];
    const s1 = st[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      m.quad(
        [s0.pts[i][0], s0.pts[i][1], s0.z],
        [s0.pts[j][0], s0.pts[j][1], s0.z],
        [s1.pts[j][0], s1.pts[j][1], s1.z],
        [s1.pts[i][0], s1.pts[i][1], s1.z],
        [uu[k][i] / uvScale, vv[k] / uvScale],
        [uu[k][j] / uvScale, vv[k] / uvScale],
        [uu[k + 1][j] / uvScale, vv[k + 1] / uvScale],
        [uu[k + 1][i] / uvScale, vv[k + 1] / uvScale],
      );
    }
  }

  const last = st[st.length - 1];
  const first = st[0];
  if (capEnd) capPoly(m, last.pts, last.z, inward ? -1 : 1, uvScale);
  if (capStart) capPoly(m, first.pts, first.z, inward ? 1 : -1, uvScale);

  return opts.into ? null : m.geometry();
}

/** Drop intermediate stations for the coarser LOD levels, always keeping the
    ends so the silhouette length never changes. */
export function decimateStations(stations, keepEvery) {
  if (keepEvery <= 1 || stations.length <= 3) return stations;
  const out = [stations[0]];
  for (let i = 1; i < stations.length - 1; i++) if (i % keepEvery === 0) out.push(stations[i]);
  out.push(stations[stations.length - 1]);
  return out;
}

/* -------------------------------------------------------------- primitives */

/**
 * Box with every edge bevelled — the workhorse. `chamfer` bevels the four
 * long edges, `chamferZ` bevels the two end faces.
 */
export function chamferBox(w, h, d, opts = {}) {
  const c = opts.chamfer !== undefined ? opts.chamfer : Math.min(w, h) * 0.14;
  const cz = Math.min(opts.chamferZ !== undefined ? opts.chamferZ : c, d * 0.45);
  const wTop = opts.wTop !== undefined ? opts.wTop : w;
  const wBot = opts.wBot !== undefined ? opts.wBot : w;
  const tf = opts.taperFront !== undefined ? opts.taperFront : 1;
  const tb = opts.taperBack !== undefined ? opts.taperBack : 1;
  const cy = opts.cy || 0;
  const base = (scale, extra) =>
    rectSection(w * scale, h * scale, {
      wTop: wTop * scale,
      wBot: wBot * scale,
      cy,
      chamfer: c,
      chamferTop: opts.chamferTop !== undefined ? opts.chamferTop : c,
      chamferBottom: opts.chamferBottom !== undefined ? opts.chamferBottom : c,
      top: (h * scale) * 0.5 - extra,
      bottom: -(h * scale) * 0.5 + extra,
    });
  const stations = [];
  if (cz > 1e-4) {
    stations.push({ z: -d * 0.5, pts: scalePoly(base(tb, 0), 1 - (2 * cz) / Math.max(w, 1e-3), 1 - (2 * cz) / Math.max(h, 1e-3), 0, cy) });
    stations.push({ z: -d * 0.5 + cz, pts: base(tb, 0) });
    stations.push({ z: d * 0.5 - cz, pts: base(tf, 0) });
    stations.push({ z: d * 0.5, pts: scalePoly(base(tf, 0), 1 - (2 * cz) / Math.max(w, 1e-3), 1 - (2 * cz) / Math.max(h, 1e-3), 0, cy) });
  } else {
    stations.push({ z: -d * 0.5, pts: base(tb, 0) });
    stations.push({ z: d * 0.5, pts: base(tf, 0) });
  }
  return loft(stations, opts);
}

/** Chamfered n-gon tube along Z. */
export function tube(r0, r1, len, sides = 10, opts = {}) {
  const cz = Math.min(opts.chamferZ !== undefined ? opts.chamferZ : Math.min(r0, r1) * 0.16, len * 0.45);
  const rot = opts.rot || 0;
  const sy = opts.sy !== undefined ? opts.sy : 1;
  const st = [];
  const at = (t) => r0 + (r1 - r0) * t;
  if (cz > 1e-4) {
    st.push({ z: 0, pts: ngonSection(at(0) * 0.78, sides, { rot, sy }) });
    st.push({ z: cz, pts: ngonSection(at(cz / len), sides, { rot, sy }) });
    st.push({ z: len - cz, pts: ngonSection(at(1 - cz / len), sides, { rot, sy }) });
    st.push({ z: len, pts: ngonSection(at(1) * 0.78, sides, { rot, sy }) });
  } else {
    st.push({ z: 0, pts: ngonSection(at(0), sides, { rot, sy }) });
    st.push({ z: len, pts: ngonSection(at(1), sides, { rot, sy }) });
  }
  return loft(st, opts);
}

/** Flat ring / flange, lying in the XY plane at z. */
export function ring(rInner, rOuter, thickness, sides = 12, opts = {}) {
  const rot = opts.rot || 0;
  const outer = ngonSection(rOuter, sides, { rot });
  const inner = ngonSection(rInner, sides, { rot });
  const m = new Mesher();
  const zs = [0, thickness];
  for (let s = 0; s < 2; s++) {
    const z = zs[s];
    const sign = s === 0 ? -1 : 1;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const a = [outer[i][0], outer[i][1], z];
      const b = [outer[j][0], outer[j][1], z];
      const c = [inner[j][0], inner[j][1], z];
      const d = [inner[i][0], inner[i][1], z];
      const ua = [outer[i][0] / UV_TILE, outer[i][1] / UV_TILE];
      const ub = [outer[j][0] / UV_TILE, outer[j][1] / UV_TILE];
      const uc = [inner[j][0] / UV_TILE, inner[j][1] / UV_TILE];
      const ud = [inner[i][0] / UV_TILE, inner[i][1] / UV_TILE];
      if (sign > 0) m.quad(a, b, c, d, ua, ub, uc, ud);
      else m.quad(d, c, b, a, ud, uc, ub, ua);
    }
  }
  // outer and inner walls
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    m.quad(
      [outer[i][0], outer[i][1], 0], [outer[j][0], outer[j][1], 0],
      [outer[j][0], outer[j][1], thickness], [outer[i][0], outer[i][1], thickness],
      [0, 0], [thickness / UV_TILE, 0], [thickness / UV_TILE, 1], [0, 1],
    );
    m.quad(
      [inner[j][0], inner[j][1], 0], [inner[i][0], inner[i][1], 0],
      [inner[i][0], inner[i][1], thickness], [inner[j][0], inner[j][1], thickness],
      [0, 0], [thickness / UV_TILE, 0], [thickness / UV_TILE, 1], [0, 1],
    );
  }
  return m.geometry();
}

/** Flat emissive quad in the XY plane facing -Z (matches the helper convention). */
export function plate(w, h, opts = {}) {
  const m = new Mesher();
  const uw = w / UV_TILE;
  const uh = h / UV_TILE;
  m.quad(
    [w * 0.5, -h * 0.5, 0], [-w * 0.5, -h * 0.5, 0],
    [-w * 0.5, h * 0.5, 0], [w * 0.5, h * 0.5, 0],
    [uw, 0], [0, 0], [0, uh], [uw, uh],
  );
  return m.geometry();
}

/** Octahedral marker — running lights and lamp housings. Eight triangles and
    readable from any angle, which a billboard quad is not. */
export function blip(size) {
  const m = new Mesher();
  const s = size;
  const top = [0, s, 0];
  const bot = [0, -s, 0];
  const eq = [[s, 0, 0], [0, 0, s], [-s, 0, 0], [0, 0, -s]];
  for (let i = 0; i < 4; i++) {
    const a = eq[i];
    const b = eq[(i + 1) % 4];
    m.tri(top, a, b, [0.5, 1], [0, 0], [1, 0]);
    m.tri(bot, b, a, [0.5, 0], [1, 1], [0, 1]);
  }
  return m.geometry();
}

/**
 * Aerofoil-ish wing section for a spanwise loft. Written in ship terms —
 * `zFront`/`zBack` are the chord ends along the hull axis — and flipped into
 * the loft's local frame here so callers never have to think about it.
 * Leading and trailing edges stay knife-sharp; only the shoulders bevel.
 */
export function wingSection(span, zFront, zBack, thick, opts = {}) {
  const cy = opts.cy || 0;
  const bias = opts.bias !== undefined ? opts.bias : 0.36; // thickest point, 0=front
  const mid = zFront + (zBack - zFront) * bias;
  const pts = [
    [-zBack, cy],
    [-mid, cy + thick * 0.5],
    [-zFront, cy],
    [-mid, cy - thick * 0.5],
  ];
  const c = opts.chamfer !== undefined ? opts.chamfer : thick * 0.42;
  return { z: span, pts: chamferPoly(pts, [0, c, 0, c]) };
}

/** Skin a set of `wingSection` stations and orient it out along +X. Pass
    `mirrorX` at placement to get the opposite flank. */
export function wing(stations, opts = {}) {
  const geo = loft(stations, { capStart: opts.capStart !== false, capEnd: opts.capEnd !== false });
  geo.rotateY(Math.PI / 2);
  return geo;
}

/* --------------------------------------------------------------- composite */

/**
 * Recessed opening. Walls face inward, floor faces out at the opening, so the
 * hole reads as depth from any angle. Mouth sits at z = 0 facing -Z.
 * Returns `{ parts }` — the optional lit backwall is a separate glow part.
 */
export function pocket(w, h, depth, opts = {}) {
  const parts = [];
  const c = opts.chamfer !== undefined ? opts.chamfer : Math.min(w, h) * 0.06;
  const taper = opts.taper !== undefined ? opts.taper : 0.9;
  const mouth = rectSection(w, h, { chamfer: c });
  const floor = rectSection(w * taper, h * taper, { chamfer: c * taper });
  parts.push({
    geo: loft([{ z: 0, pts: mouth }, { z: depth, pts: floor }], { inward: true, capStart: false, capEnd: true }),
    kind: KIND.HULL,
    variant: opts.variant !== undefined ? opts.variant : PLATE.MECH,
    wear: 0.35,
  });
  if (opts.lit) {
    parts.push({
      geo: plate(w * taper * 0.9, h * taper * 0.9, {}),
      kind: KIND.GLOW,
      matrix: null,
      z: depth - Math.min(depth * 0.12, 0.4),
      variant: PLATE.MECH,
    });
  }
  return parts;
}

/**
 * Engine bell. Mouth at the local origin facing -Z, housing runs to +Z.
 * Returns `{ parts, mouth }` with `mouth` in local space for the FX agent.
 */
export function engineNozzle(r, opts = {}) {
  const sides = opts.sides || 10;
  const housing = opts.housing !== undefined ? opts.housing : r * 2.1;
  const parts = [];

  // outer housing, slightly flared toward the mouth
  parts.push({
    geo: tube(r * 0.86, r, housing, sides, { rot: Math.PI / sides, capStart: false, capEnd: false }),
    kind: KIND.HULL,
    variant: PLATE.MECH,
    wear: 0.55,
    z: housing,
    ry: Math.PI,
  });
  // lip flange
  parts.push({
    geo: ring(r * 0.9, r * 1.12, r * 0.16, sides, { rot: Math.PI / sides }),
    kind: KIND.HULL,
    variant: PLATE.MECH,
    wear: 0.8,
    z: 0.0,
  });
  // recess: inward cone sinking into the housing
  parts.push({
    geo: loft(
      [
        { z: 0, pts: ngonSection(r * 0.88, sides, { rot: Math.PI / sides }) },
        { z: r * 1.25, pts: ngonSection(r * 0.42, sides, { rot: Math.PI / sides }) },
      ],
      { inward: true, capStart: false, capEnd: false },
    ),
    kind: KIND.HULL,
    variant: PLATE.MECH,
    wear: 0.95,
  });
  // emitter disc, seen down the throat
  parts.push({
    geo: (() => {
      const m = new Mesher();
      const p = ngonSection(r * 0.44, sides, { rot: Math.PI / sides });
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        m.tri([0, 0, 0], [p[j][0], p[j][1], 0], [p[i][0], p[i][1], 0], [0.5, 0.5], [0.5 + p[j][0] / (4 * r), 0.5 + p[j][1] / (4 * r)], [0.5 + p[i][0] / (4 * r), 0.5 + p[i][1] / (4 * r)]);
      }
      return m.geometry();
    })(),
    kind: KIND.GLOW,
    variant: PLATE.MECH,
    z: r * 1.22,
  });

  return { parts, mouth: { x: 0, y: 0, z: 0, r } };
}

/**
 * Gun turret: barbette, chamfered house, mantlet and barrels pointing +Z.
 * Returns `{ parts, muzzles }` with muzzle points in local space.
 */
export function turret(size, opts = {}) {
  const barrels = opts.barrels || 2;
  const barrelLen = opts.barrelLen !== undefined ? opts.barrelLen : size * 3.0;
  const barrelR = opts.barrelR !== undefined ? opts.barrelR : size * 0.15;
  const sides = opts.sides || 10;
  const parts = [];
  const muzzles = [];

  parts.push({
    geo: tube(size * 0.95, size * 0.82, size * 0.55, sides, { rot: Math.PI / sides, capStart: false }),
    kind: KIND.HULL,
    variant: PLATE.ARMOUR,
    wear: 0.25,
    rx: -Math.PI / 2,
    y: -size * 0.05,
  });

  const houseH = size * 0.78;
  parts.push({
    geo: chamferBox(size * 1.5, houseH, size * 1.9, {
      chamfer: size * 0.17,
      chamferZ: size * 0.16,
      taperFront: 0.72,
      wTop: size * 1.18,
      wBot: size * 1.5,
    }),
    kind: KIND.HULL,
    variant: PLATE.ARMOUR,
    wear: 0.3,
    y: size * 0.5 + houseH * 0.5 - size * 0.2,
    z: size * 0.1,
  });

  // mantlet — the slab the barrels emerge from
  parts.push({
    geo: chamferBox(size * 1.05, size * 0.62, size * 0.34, { chamfer: size * 0.09, chamferZ: size * 0.07 }),
    kind: KIND.HULL,
    variant: PLATE.ARMOUR,
    wear: 0.4,
    y: size * 0.5 + houseH * 0.5 - size * 0.2,
    z: size * 1.05,
  });

  const spread = barrels > 1 ? size * 0.34 : 0;
  for (let i = 0; i < barrels; i++) {
    const bx = barrels === 1 ? 0 : -spread + (i * 2 * spread) / (barrels - 1);
    const by = size * 0.5 + houseH * 0.5 - size * 0.2;
    parts.push({
      geo: tube(barrelR, barrelR * 0.84, barrelLen, 8, { rot: Math.PI / 8, capStart: false }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.7,
      x: bx,
      y: by,
      z: size * 1.1,
    });
    parts.push({
      geo: ring(barrelR * 0.8, barrelR * 1.4, barrelR * 0.7, 8, { rot: Math.PI / 8 }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.85,
      x: bx,
      y: by,
      z: size * 1.1 + barrelLen * 0.82,
    });
    muzzles.push([bx, by, size * 1.1 + barrelLen]);
  }

  return { parts, muzzles };
}

/** Radiator wing: a thin slab with a row of ribs across its face. */
export function radiator(w, len, thickness, fins, opts = {}) {
  const parts = [];
  parts.push({
    geo: chamferBox(w, thickness, len, { chamfer: thickness * 0.4, chamferZ: thickness * 0.6, taperFront: opts.taper || 1 }),
    kind: KIND.HULL,
    variant: PLATE.PANEL,
    wear: 0.3,
  });
  const step = len / (fins + 1);
  for (let i = 0; i < fins; i++) {
    parts.push({
      geo: chamferBox(w * 0.98, thickness * 2.6, thickness * 1.1, { chamfer: thickness * 0.4 }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.4,
      z: -len * 0.5 + step * (i + 1),
    });
  }
  return parts;
}

/** Sensor dish — concave shell, rim and feed mast. Points +Z. */
export function dish(r, opts = {}) {
  const sides = opts.sides || 14;
  const depth = opts.depth !== undefined ? opts.depth : r * 0.42;
  const rows = opts.rows || 4;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const rr = r * Math.max(0.14, t);
    const z = -depth * (1 - t * t);
    // The two shells meet exactly at the rim, so the dish closes without a
    // seam ring costing extra triangles.
    const gap = 1 - t;
    outer.push({ z, pts: ngonSection(rr, sides) });
    inner.push({ z: z + r * 0.05 * gap, pts: ngonSection(rr * (1 - 0.035 * gap), sides) });
  }
  const m = new Mesher();
  loft(outer, { into: m, capStart: true, capEnd: false });
  loft(inner, { into: m, inward: true, capStart: false, capEnd: false });
  const parts = [{ geo: m.geometry(), kind: KIND.HULL, variant: PLATE.PANEL, wear: 0.25 }];
  if (opts.mast !== false) {
    parts.push({
      geo: tube(r * 0.05, r * 0.03, r * 0.72, 6, { capStart: false }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.5,
      z: -depth * 0.1,
    });
    parts.push({
      geo: chamferBox(r * 0.2, r * 0.2, r * 0.16, { chamfer: r * 0.05 }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.6,
      z: r * 0.66,
    });
  }
  return parts;
}

/** Antenna / sensor mast: tapered spar with cross elements. Points +Y. */
export function mast(rng, len, thick, opts = {}) {
  const parts = [];
  parts.push({
    geo: tube(thick, thick * 0.35, len, 6, { capStart: false }),
    kind: KIND.HULL,
    variant: PLATE.MECH,
    wear: 0.55,
    rx: -Math.PI / 2,
  });
  const arms = opts.arms !== undefined ? opts.arms : 3;
  for (let i = 0; i < arms; i++) {
    const t = 0.35 + (i / Math.max(1, arms)) * 0.55;
    const w = thick * rng.range(4, 9) * (1 - t * 0.5);
    parts.push({
      geo: chamferBox(w, thick * 0.8, thick * 0.8, { chamfer: thick * 0.28 }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.6,
      y: len * t,
      rz: rng.range(-0.16, 0.16),
      ry: rng.range(0, Math.PI),
    });
  }
  return parts;
}

/** Catwalk: two rails and a run of slats. Runs along +Z, sits on y = 0. */
export function catwalk(len, w, rail, opts = {}) {
  const parts = [];
  const z0 = opts.z0 || 0;
  for (const s of [-1, 1]) {
    parts.push({
      geo: chamferBox(rail, rail * 2.2, len, { chamfer: rail * 0.35, chamferZ: rail * 0.3 }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.5,
      x: s * w * 0.5,
      y: rail * 1.1,
      z: z0,
    });
  }
  const n = Math.max(2, Math.round(len / (w * 1.6)));
  for (let i = 0; i < n; i++) {
    parts.push({
      geo: chamferBox(w, rail * 0.5, rail * 0.9, { chamfer: rail * 0.18 }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.55,
      z: z0 - len * 0.5 + (len * (i + 0.5)) / n,
    });
  }
  if (opts.deck !== false) {
    parts.push({
      geo: chamferBox(w * 0.94, rail * 0.4, len, { chamfer: rail * 0.15, chamferZ: rail * 0.2 }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.45,
      z: z0,
    });
  }
  return parts;
}

/** Row of lit windows, facing -Z, laid along X. Tiny quads, glow material. */
export function windowRow(count, pitch, w, h, opts = {}) {
  const m = new Mesher();
  const skip = opts.skip || 0;
  for (let i = 0; i < count; i++) {
    if (skip && i % skip === skip - 1) continue;
    const x = (i - (count - 1) * 0.5) * pitch;
    m.quad(
      [x + w * 0.5, -h * 0.5, 0], [x - w * 0.5, -h * 0.5, 0],
      [x - w * 0.5, h * 0.5, 0], [x + w * 0.5, h * 0.5, 0],
      [1, 0], [0, 0], [0, 1], [1, 1],
    );
  }
  return m.empty ? null : m.geometry();
}

/**
 * Lit window band with variation. Slits run in stacked rows along X, merge
 * into runs of differing length, and leave dark gaps.
 *
 * A uniform grid of identical dots reads as portholes on a cruise liner. What
 * sells a hull as inhabited is irregularity — long lit galleries next to dead
 * blocks — so length, height and occupancy all come off the seeded stream.
 * Faces -Z, centred on the origin, same convention as `windowRow`.
 */
export function windowBand(rng, opts) {
  const count = Math.max(1, Math.round(opts.count || 1));
  const pitch = opts.pitch || 1;
  const w = opts.w !== undefined ? opts.w : pitch * 0.56;
  const h = opts.h !== undefined ? opts.h : w;
  const rows = Math.max(1, Math.round(opts.rows || 1));
  const rowPitch = opts.rowPitch !== undefined ? opts.rowPitch : h * 2.4;
  const fill = opts.fill !== undefined ? opts.fill : 0.62;
  const run = Math.max(1, Math.round(opts.run || 3));
  const m = new Mesher();
  const ox = -(count - 1) * 0.5 * pitch;
  for (let r = 0; r < rows; r++) {
    const y = (r - (rows - 1) * 0.5) * rowPitch;
    let i = 0;
    while (i < count) {
      const n = 1 + Math.floor(rng.next() * run);
      const lit = rng.next() < fill;
      const end = Math.min(count - 1, i + n - 1);
      if (lit) {
        const a = ox + i * pitch - w * 0.5;
        const bx = ox + end * pitch + w * 0.5;
        const hh = h * (0.7 + 0.3 * rng.next());
        m.quad(
          [bx, y - hh * 0.5, 0], [a, y - hh * 0.5, 0],
          [a, y + hh * 0.5, 0], [bx, y + hh * 0.5, 0],
          [1, 0], [0, 0], [0, 1], [1, 1],
        );
      }
      i = end + 1 + (rng.next() < 0.34 ? 1 : 0);
    }
  }
  return m.empty ? null : m.geometry();
}

/**
 * Window band sunk into a shallow trench, so the lit strip carries a lip and a
 * shadow instead of sitting on the skin like a decal. Mouth at z = 0, -Z.
 */
export function windowBay(rng, opts) {
  const parts = [];
  const count = Math.max(1, Math.round(opts.count || 1));
  const pitch = opts.pitch || 1;
  const rows = Math.max(1, Math.round(opts.rows || 1));
  const h = opts.h !== undefined ? opts.h : pitch * 0.5;
  const rowPitch = opts.rowPitch !== undefined ? opts.rowPitch : h * 2.4;
  const spanW = count * pitch * 1.04;
  const spanH = rows * rowPitch * 1.15;
  const depth = opts.depth !== undefined ? opts.depth : h * 1.1;
  const c = Math.min(spanH, spanW) * 0.16;
  parts.push({
    geo: loft(
      [
        { z: 0, pts: rectSection(spanW, spanH, { chamfer: c }) },
        { z: depth, pts: rectSection(spanW * 0.97, spanH * 0.92, { chamfer: c * 0.9 }) },
      ],
      { inward: true, capStart: false, capEnd: true },
    ),
    kind: KIND.HULL,
    variant: PLATE.PANEL,
    wear: 0.28,
  });
  const g = windowBand(rng, { ...opts, rowPitch });
  if (g) parts.push({ geo: g, kind: KIND.GLOW, variant: PLATE.PANEL, z: depth * 0.72 });
  return parts;
}

/**
 * Hangar mouth big enough to read as an opening rather than a dark patch.
 *
 * Everything that sells the depth is here: a stepped throat, ceiling ribs that
 * catch the light, a raised deck, a lit backwall and floor, and — the part
 * that actually does the work at range — a heavy frame of lip, overhang and
 * jambs standing proud of the surrounding skin.
 * Mouth at z = 0 facing -Z, bay running to +Z.
 */
export function hangarBay(rng, w, h, depth, opts = {}) {
  const parts = [];
  const c = opts.chamfer !== undefined ? opts.chamfer : Math.min(w, h) * 0.1;
  const f = opts.frame !== undefined ? opts.frame : h * 0.17;

  parts.push({
    geo: loft(
      [
        { z: 0, pts: rectSection(w, h, { chamfer: c }) },
        { z: depth * 0.3, pts: rectSection(w * 0.95, h * 0.9, { chamfer: c }) },
        { z: depth, pts: rectSection(w * 0.84, h * 0.76, { chamfer: c * 0.8 }) },
      ],
      { inward: true, capStart: false, capEnd: true },
    ),
    kind: KIND.HULL,
    variant: PLATE.MECH,
    wear: 0.55,
  });

  // Deck slab, set back from the mouth so the lip reads as an overhang.
  parts.push({
    geo: chamferBox(w * 0.88, h * 0.06, depth * 0.9, { chamfer: h * 0.02, chamferZ: h * 0.03 }),
    kind: KIND.HULL,
    variant: PLATE.MECH,
    wear: 0.75,
    y: -h * 0.4,
    z: depth * 0.54,
  });

  // Ceiling ribs and gantries — the interior needs edges to catch the key.
  const ribs = Math.max(0, opts.ribs !== undefined ? opts.ribs : 5);
  for (let i = 0; i < ribs; i++) {
    const z = depth * (0.16 + (i / Math.max(1, ribs - 1)) * 0.74);
    parts.push({
      geo: chamferBox(w * 0.9, h * 0.075, h * 0.05, { chamfer: h * 0.02, chamferZ: h * 0.015 }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.6,
      y: h * 0.33,
      z,
    });
  }
  const side = Math.max(0, opts.sideRibs !== undefined ? opts.sideRibs : 4);
  for (let i = 0; i < side; i++) {
    const z = depth * (0.22 + (i / Math.max(1, side - 1)) * 0.66);
    for (const s of [-1, 1]) {
      parts.push({
        geo: chamferBox(h * 0.05, h * 0.5, h * 0.055, { chamfer: h * 0.016 }),
        kind: KIND.HULL,
        variant: PLATE.MECH,
        wear: 0.65,
        x: s * w * 0.43,
        y: -h * 0.05,
        z,
      });
    }
  }

  // Lit backwall and deck wash. Two separate emitters so the bay does not read
  // as one flat card when seen off-axis.
  parts.push({ geo: plate(w * 0.72, h * 0.6, {}), kind: KIND.GLOW, variant: PLATE.MECH, z: depth * 0.985 });
  parts.push({
    geo: plate(w * 0.8, depth * 0.7, {}),
    kind: KIND.GLOW,
    variant: PLATE.MECH,
    y: -h * 0.36,
    z: depth * 0.55,
    rx: -Math.PI / 2,
  });

  if (opts.frame !== 0) {
    // Bottom lip, top overhang, side jambs.
    parts.push({
      geo: chamferBox(w + f * 2.2, f * 0.9, f * 2.4, { chamfer: f * 0.3, chamferZ: f * 0.5, taperFront: 0.86 }),
      kind: KIND.HULL,
      variant: PLATE.ARMOUR,
      wear: 0.6,
      y: -h * 0.5 - f * 0.42,
      z: -f * 0.5,
    });
    parts.push({
      geo: chamferBox(w + f * 2.6, f * 1.15, f * 3.1, { chamfer: f * 0.34, chamferZ: f * 0.6, taperFront: 0.8 }),
      kind: KIND.HULL,
      variant: PLATE.ARMOUR,
      wear: 0.34,
      y: h * 0.5 + f * 0.55,
      z: -f * 0.85,
    });
    for (const s of [-1, 1]) {
      parts.push({
        geo: chamferBox(f * 1.3, h + f * 1.2, f * 2.0, { chamfer: f * 0.32, chamferZ: f * 0.45 }),
        kind: KIND.HULL,
        variant: PLATE.ARMOUR,
        wear: 0.5,
        x: s * (w * 0.5 + f * 0.6),
        z: -f * 0.35,
      });
    }
    // Approach lights strung under the overhang.
    const lamps = Math.max(0, opts.lamps !== undefined ? opts.lamps : 9);
    if (lamps) {
      const m = new Mesher();
      for (let i = 0; i < lamps; i++) {
        const x = (i - (lamps - 1) * 0.5) * ((w + f) / lamps);
        const s = f * 0.16;
        m.quad(
          [x + s, -s, 0], [x - s, -s, 0], [x - s, s, 0], [x + s, s, 0],
          [1, 0], [0, 0], [0, 1], [1, 1],
        );
      }
      parts.push({ geo: m.geometry(), kind: KIND.GLOW, variant: PLATE.MECH, y: h * 0.5 + f * 0.2, z: -f * 2.2 });
    }
  }

  return parts;
}

/**
 * Open lattice girder along +Z, centred on the origin. Four chords, ring
 * frames and alternating diagonals. Reads as structure rather than a solid
 * box, which is what keeps a long docking arm from looking like a plank.
 */
export function truss(len, w, h, bays, opts = {}) {
  const parts = [];
  const t = opts.thickness !== undefined ? opts.thickness : Math.min(w, h) * 0.14;
  const variant = opts.variant !== undefined ? opts.variant : PLATE.MECH;
  const wear = opts.wear !== undefined ? opts.wear : 0.5;
  const n = Math.max(1, Math.round(bays));
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      parts.push({
        geo: chamferBox(t, t, len, { chamfer: t * 0.3, chamferZ: t * 0.3 }),
        kind: KIND.HULL,
        variant,
        wear,
        x: sx * w * 0.5,
        y: sy * h * 0.5,
      });
    }
  }
  const step = len / n;
  for (let i = 0; i <= n; i++) {
    const z = -len * 0.5 + i * step;
    parts.push({
      geo: chamferBox(w + t, t * 0.85, t * 0.85, { chamfer: t * 0.26 }),
      kind: KIND.HULL, variant, wear, y: h * 0.5, z,
    });
    parts.push({
      geo: chamferBox(w + t, t * 0.85, t * 0.85, { chamfer: t * 0.26 }),
      kind: KIND.HULL, variant, wear, y: -h * 0.5, z,
    });
    parts.push({
      geo: chamferBox(t * 0.85, h, t * 0.85, { chamfer: t * 0.26 }),
      kind: KIND.HULL, variant, wear, x: w * 0.5, z,
    });
    parts.push({
      geo: chamferBox(t * 0.85, h, t * 0.85, { chamfer: t * 0.26 }),
      kind: KIND.HULL, variant, wear, x: -w * 0.5, z,
    });
  }
  if (opts.diagonals !== false) {
    const diag = Math.hypot(step, h);
    const ang = Math.atan2(h, step);
    for (let i = 0; i < n; i++) {
      const z = -len * 0.5 + (i + 0.5) * step;
      const s = i % 2 ? 1 : -1;
      for (const sx of [-1, 1]) {
        parts.push({
          geo: chamferBox(t * 0.7, t * 0.7, diag, { chamfer: t * 0.22 }),
          kind: KIND.HULL, variant, wear: wear + 0.08,
          x: sx * w * 0.5, z, rx: s * ang,
        });
      }
    }
  }
  return parts;
}

/**
 * Layered armour plating. Big, flat, chamfered slabs laid over a surface at
 * slight angles so the skin gains a second scale of detail between the belt
 * armour and the fine greeble. This is the step that stops a capital hull
 * reading as one extruded shape.
 */
export function armourPlates(rng, opts) {
  const {
    x0, x1, z0, z1, y = 0, size, count, thickness = size * 0.13,
    variant = PLATE.ARMOUR, keep = 1, width = null, lean = 0.05, aspect = 2.6,
  } = opts;
  const parts = [];
  const span = Math.max(Math.abs(x0), Math.abs(x1)) || 1;
  for (let i = 0; i < count; i++) {
    const w = size * rng.range(0.7, 1.5);
    const d = w * rng.range(1.0, aspect);
    const th = thickness * rng.range(0.7, 1.5);
    const wear = rng.range(0.2, 0.55);
    let x = rng.range(x0, x1);
    const z = rng.range(z0, z1);
    const tilt = rng.range(-lean, lean);
    if (i / count >= keep) continue;
    if (width) {
      const lim = width(z);
      if (lim < size * 0.5) continue;
      x *= lim / span;
    }
    parts.push({
      geo: chamferBox(w, th, d, { chamfer: th * 0.45, chamferZ: th * 0.7 }),
      kind: KIND.HULL,
      variant,
      wear,
      x,
      y: y + th * 0.32,
      z,
      rx: tilt,
      rz: tilt * 0.6,
    });
  }
  return parts;
}

/** Flat phased-array face: a framed panel with a ribbed emitter surface. */
export function commsArray(w, h, opts = {}) {
  const parts = [];
  const t = opts.thickness !== undefined ? opts.thickness : Math.min(w, h) * 0.09;
  parts.push({
    geo: chamferBox(w, h, t, { chamfer: t * 0.4, chamferZ: t * 0.3 }),
    kind: KIND.HULL,
    variant: PLATE.PANEL,
    wear: 0.3,
  });
  const rows = Math.max(1, Math.round(opts.rows || 4));
  for (let i = 0; i < rows; i++) {
    parts.push({
      geo: chamferBox(w * 0.86, (h / rows) * 0.5, t * 0.7, { chamfer: t * 0.2 }),
      kind: KIND.HULL,
      variant: PLATE.MECH,
      wear: 0.45,
      y: (i - (rows - 1) * 0.5) * (h / rows),
      z: -t * 0.6,
    });
  }
  return parts;
}

/**
 * Scattered surface greeble. Boxes are sunk into the hull so they read as
 * fittings rather than floating blocks. `size` should be tied to hull length so
 * a mothership carries visibly finer detail than a fighter.
 */
export function greebleField(rng, opts) {
  const {
    x0, x1, z0, z1, y = 0, size, count, tall = 1.6, variant = PLATE.MECH, sink = 0.45,
    keep = 1, width = null,
  } = opts;
  const parts = [];
  const span = Math.max(Math.abs(x0), Math.abs(x1)) || 1;
  for (let i = 0; i < count; i++) {
    // The stream is consumed in full regardless of `keep`, so a coarser LOD
    // holds a subset of the same fittings rather than a different scatter.
    const w = size * rng.range(0.6, 2.4);
    const d = size * rng.range(0.6, 3.2);
    const h = size * rng.range(0.35, tall);
    const wear = rng.range(0.25, 0.6);
    let x = rng.range(x0, x1);
    const z = rng.range(z0, z1);
    const turn = rng.chance(0.25);
    if (i / count >= keep) continue;
    // Follow the hull's taper so nothing ends up floating beside a narrow bow.
    if (width) {
      const lim = width(z);
      if (lim < size) continue;
      x *= lim / span;
    }
    parts.push({
      geo: chamferBox(w, h, d, { chamfer: Math.min(w, h) * 0.2, chamferZ: Math.min(d, h) * 0.18 }),
      kind: KIND.HULL,
      variant,
      wear,
      x,
      y: y + h * (0.5 - sink),
      z,
      ry: turn ? Math.PI / 2 : 0,
    });
  }
  return parts;
}

/** A run of raised bands across a hull — frames, girth belts, structural ribs. */
export function ribBand(count, z0, z1, w, h, t, opts = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const t01 = count === 1 ? 0.5 : i / (count - 1);
    const taper = opts.taper ? 1 - Math.abs(t01 - 0.5) * opts.taper : 1;
    parts.push({
      geo: chamferBox(w * taper, h * taper, t, { chamfer: t * 0.5, chamferZ: t * 0.3 }),
      kind: KIND.HULL,
      variant: opts.variant !== undefined ? opts.variant : PLATE.PANEL,
      wear: 0.3,
      z: z0 + (z1 - z0) * t01,
      y: opts.y || 0,
    });
  }
  return parts;
}

/* ------------------------------------------------------------- attributes */

function setConst(geo, name, value, count) {
  const arr = new Float32Array(count);
  if (value) arr.fill(value);
  geo.setAttribute(name, new THREE.Float32BufferAttribute(arr, 1));
}

function reverseWinding(geo) {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    const s = a.itemSize;
    const arr = a.array;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < s; k++) {
        const i1 = (t + 1) * s + k;
        const i2 = (t + 2) * s + k;
        const tmp = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = tmp;
      }
    }
    a.needsUpdate = true;
  }
}

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _scl = new THREE.Vector3();

const _mirror = new THREE.Matrix4().makeScale(-1, 1, 1);

function composeMatrix(o) {
  const hasT = o.x || o.y || o.z;
  const hasR = o.rx || o.ry || o.rz;
  const hasS = o.sx !== undefined || o.sy !== undefined || o.sz !== undefined || o.scale !== undefined;
  if (!hasT && !hasR && !hasS && !o.mirrorX) return null;
  const s = o.scale !== undefined ? o.scale : 1;
  _pos.set(o.x || 0, o.y || 0, o.z || 0);
  _eul.set(o.rx || 0, o.ry || 0, o.rz || 0, 'ZYX');
  _quat.setFromEuler(_eul);
  _scl.set(o.sx !== undefined ? o.sx : s, o.sy !== undefined ? o.sy : s, o.sz !== undefined ? o.sz : s);
  _mat.compose(_pos, _quat, _scl);
  // Mirror last, in ship space: "put the same fitting on the other flank".
  if (o.mirrorX) _mat.premultiply(_mirror);
  return _mat;
}

/** Placement matrix for a part, matching `Builder.add` semantics. Hull code
    uses it to carry muzzle and thruster points through the same transform as
    the geometry they belong to. Returns a fresh Matrix4, or null for identity. */
export function partMatrix(o) {
  const m = composeMatrix(o);
  return m ? m.clone() : null;
}

/**
 * Paint `aTeamMask` on to whole regions of a finished hull.
 *
 * Team colour has to survive a ship being twenty pixels tall at five
 * kilometres, so it cannot live on thin applied trim — it has to be a large
 * graphic area of the hull skin itself. This marks every triangle whose
 * centroid falls inside an axis-aligned region, optionally restricted by face
 * direction so a flank blazon lands on the flank plating and not on the deck
 * above it or the structure behind.
 *
 * Regions are in build space: `{ x0,x1, y0,y1, z0,z1, n?:[x,y,z], nMin?, value?, mirror? }`.
 */
export function paintTeamMask(geo, regions) {
  if (!geo || !regions || !regions.length) return;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const mask = geo.getAttribute('aTeamMask');
  if (!pos || !mask) return;

  const list = [];
  for (const r of regions) {
    list.push(r);
    if (r.mirror) list.push({ ...r, x0: -r.x1, x1: -r.x0, n: r.n ? [-r.n[0], r.n[1], r.n[2]] : null });
  }

  for (let t = 0; t < pos.count; t += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(t + k);
      cy += pos.getY(t + k);
      cz += pos.getZ(t + k);
    }
    cx /= 3;
    cy /= 3;
    cz /= 3;
    for (let r = 0; r < list.length; r++) {
      const g = list[r];
      if (cx < g.x0 || cx > g.x1 || cy < g.y0 || cy > g.y1 || cz < g.z0 || cz > g.z1) continue;
      if (g.n && nor) {
        const d = nor.getX(t) * g.n[0] + nor.getY(t) * g.n[1] + nor.getZ(t) * g.n[2];
        if (d < (g.nMin !== undefined ? g.nMin : 0.35)) continue;
      }
      const v = g.value !== undefined ? g.value : 1;
      for (let k = 0; k < 3; k++) mask.setX(t + k, v);
      break;
    }
  }
  mask.needsUpdate = true;
}

/**
 * Wear rises near thruster mouths, along the leading edge and out at the
 * extremities — the three places a real hull gets scorched, sanded and hit.
 */
export function applyWear(geo, opts = {}) {
  const pos = geo.getAttribute('position');
  const wear = geo.getAttribute('aWear');
  if (!pos || !wear) return;
  const sources = opts.sources || [];
  const nose = opts.nose !== undefined ? opts.nose : 0;
  const span = Math.max(1e-3, opts.span || 1);
  const radial = Math.max(1e-3, opts.radial || 1);
  const noise = opts.noise !== undefined ? opts.noise : 0.2;
  const ns = opts.noiseScale || 0.08;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let w = wear.getX(i);
    for (let s = 0; s < sources.length; s++) {
      const e = sources[s];
      const d = Math.hypot(x - e.x, y - e.y, z - e.z);
      w += 0.8 * Math.exp(-d / Math.max(0.6, e.r * 2.4));
    }
    const lead = clamp01((z - (nose - span * 0.17)) / (span * 0.17));
    w += 0.32 * lead * lead;
    const r = clamp01(Math.hypot(x, y) / radial);
    w += 0.22 * r * r;
    w += noise * (fbm3(x * ns, y * ns, z * ns, 3) * 0.5 + 0.5);
    wear.setX(i, clamp01(w));
  }
  wear.needsUpdate = true;
}

/* ---------------------------------------------------------------- builder */

/**
 * Accumulates parts per material kind and merges each into one buffer, so a
 * finished hull costs at most three draw calls no matter how many hundreds of
 * greebles went into it.
 */
export class Builder {
  constructor(rng, detail = 0) {
    this.rng = rng;
    this.detail = detail;
    this.groups = { hull: [], glass: [], glow: [] };
    this.teamRegions = [];
  }

  /** Register a bold team-colour region on the finished hull skin. */
  paint(region) {
    if (region) this.teamRegions.push(region);
    return this;
  }

  /** Pick a value per LOD level. */
  lod(a, b, c, d) {
    return [a, b !== undefined ? b : a, c !== undefined ? c : b, d !== undefined ? d : c][this.detail];
  }

  add(geo, opts = {}) {
    if (!geo) return this;
    const kind = opts.kind || KIND.HULL;
    const m = composeMatrix(opts);
    if (m) {
      geo.applyMatrix4(m);
      if (m.determinant() < 0) reverseWinding(geo);
    }
    const count = geo.getAttribute('position').count;
    if (count === 0) {
      geo.dispose();
      return this;
    }
    setConst(geo, 'aTeamMask', opts.team || 0, count);
    setConst(geo, 'aVariant', opts.variant !== undefined ? opts.variant : PLATE.HULL, count);
    setConst(geo, 'aWear', opts.wear || 0, count);
    this.groups[kind].push(geo);
    return this;
  }

  /** Add a composite helper's parts under one shared placement. */
  addParts(parts, opts = {}) {
    if (!parts) return this;
    const om = composeMatrix(opts);
    const shared = om ? om.clone() : null;
    for (const p of parts) {
      const local = composeMatrix(p);
      const geo = p.geo;
      if (!geo) continue;
      if (local) {
        geo.applyMatrix4(local);
        if (local.determinant() < 0) reverseWinding(geo);
      }
      if (shared) {
        geo.applyMatrix4(shared);
        if (shared.determinant() < 0) reverseWinding(geo);
      }
      const count = geo.getAttribute('position').count;
      if (count === 0) {
        geo.dispose();
        continue;
      }
      setConst(geo, 'aTeamMask', p.team !== undefined ? p.team : opts.team || 0, count);
      setConst(geo, 'aVariant', p.variant !== undefined ? p.variant : opts.variant !== undefined ? opts.variant : PLATE.HULL, count);
      setConst(geo, 'aWear', p.wear !== undefined ? p.wear : opts.wear || 0, count);
      this.groups[p.kind || opts.kind || KIND.HULL].push(geo);
    }
    return this;
  }

  /** Mirror a sub-build across the centreline. Use sparingly — most of the
      fleet is deliberately asymmetric. */
  both(fn) {
    fn(1);
    fn(-1);
    return this;
  }

  finish(wearOpts) {
    const out = { hull: null, glass: null, glow: null };
    for (const kind of ['hull', 'glass', 'glow']) {
      const arr = this.groups[kind];
      if (!arr.length) continue;
      let merged = null;
      if (arr.length === 1) merged = arr[0];
      else {
        merged = mergeGeometries(arr, false);
        for (const g of arr) g.dispose();
      }
      if (!merged) continue;
      merged.computeBoundingBox();
      out[kind] = merged;
    }
    // Painted after the merge: the regions are described in ship coordinates,
    // and only the merged buffer knows which triangles ended up where.
    if (out.hull && this.teamRegions.length) paintTeamMask(out.hull, this.teamRegions);
    if (out.hull && wearOpts) applyWear(out.hull, wearOpts);
    this.groups = { hull: [], glass: [], glow: [] };
    this.teamRegions = [];
    return out;
  }
}

/** Triangle count of a non-indexed geometry. */
export function triCount(geo) {
  if (!geo) return 0;
  const p = geo.getAttribute('position');
  return p ? p.count / 3 : 0;
}
