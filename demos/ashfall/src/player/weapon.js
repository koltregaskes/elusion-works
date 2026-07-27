/**
 * Ashfall — first-person weapons: procedural models, arms, and all handling feel.
 *
 * ARCHITECTURE.md §3.8. This module owns everything the player sees of their own kit:
 * three fully modelled weapons, a gloved two-arm rig posed by analytic two-bone IK, the
 * spring-damper recoil system, ADS, sway, and a small keyframe animation runtime that
 * drives reloads, inspects and weapon swaps.
 *
 * Design notes that are not obvious from the code:
 *
 * - **Everything below `root` lives in camera space.** Each frame `root` copies the
 *   viewmodel camera's world transform, so the pose group's local numbers are literally
 *   "metres in front of / to the right of the eye". That is what makes exact sight
 *   alignment possible: the ADS pose is derived arithmetically from the optic's own local
 *   position rather than hand-tuned, so the reticle cannot drift off centre.
 *
 * - **Materials are local variants, not world materials.** `world/materials.js` hands out
 *   CSM-registered, metre-scale-UV materials meant for the world scene; the viewmodel scene
 *   never receives world shadows and a gun part is 30 mm across, not 3 m. We therefore build
 *   our own `MeshStandardMaterial` set seeded from `art.js` PALETTE, and *borrow* the
 *   procedural texture maps from `materials.getTextures(...)` via cheap clones (shared GPU
 *   source, private repeat/offset) when that module is alive. On top of that every merged
 *   static batch gets baked vertex colours — value noise plus an edge/wear term — so the
 *   surfaces are never flat even if the materials module failed to build.
 *
 * - **Static parts are merged per material at build time.** A rifle is ~90 primitives; merged
 *   it is 5-7 draw calls. Only genuinely animated parts (magazine, bolt carrier, charging
 *   handle, dust cover, trigger, selector, reticle, glass) stay separate.
 *
 * - **Zero allocation in update().** All scratch is at module scope below.
 */

import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';
import { PALETTE, CAMERA, LIGHTING } from '../world/art.js';

/* ========================================================================== */
/* Scratch — module scope, never allocated per frame                          */
/* ========================================================================== */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _v8 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _e1 = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, -1);

/* --- Palette-derived colour helpers ---------------------------------------
 *
 * art.js authors every palette entry as a *diffuse* value in sRGB. That is the right
 * number for a painted wall and the wrong number for a metal, because a metal's base
 * colour is its F0 reflectance: real alloys sit at 0.4-0.9, and PALETTE.gunmetal in linear
 * is 0.035. Feeding 0.035 into `metalness: 0.94` produces a body that reflects 3.5% of the
 * world and has no diffuse term at all, i.e. a black cut-out with a blue rim (the palette
 * value is blue-biased, B > R, so every specular hit came back cyan). These two helpers
 * keep the palette as the single source of hue while putting the *level* where the physics
 * needs it, and bias the reflectance warm so a warm key produces warm highlights.
 */
const _C_GROUND = new THREE.Color(PALETTE.groundBounce);
const _C_DUST = new THREE.Color(PALETTE.dust);
const _C_SHADOW = new THREE.Color(PALETTE.moonlessShadow);

/** Metal F0: lift a palette diffuse into a plausible reflectance and warm it. */
function metalF0(hex, gain, warmth) {
  return new THREE.Color(hex).lerp(_C_GROUND, warmth === undefined ? 0.18 : warmth).multiplyScalar(gain);
}
/** Dielectric albedo: same idea, far gentler — polymer really is nearly black. */
function dielectric(hex, gain, warmth) {
  return new THREE.Color(hex).lerp(_C_GROUND, warmth === undefined ? 0.10 : warmth).multiplyScalar(gain);
}

/* ========================================================================== */
/* Small maths                                                                */
/* ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent approach rate. `k` is "how fast", in inverse seconds. */
const approach = (k, dt) => 1 - Math.exp(-k * dt);
/** Ken Perlin's smootherstep: zero 1st *and* 2nd derivative at both ends. */
const smootherstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Deterministic hash noise, used for vertex-colour grain and pattern jitter seeds. */
function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * xorshift32. Recoil needs a *small* random component on top of a deterministic pattern;
 * using our own generator keeps it independent of anything else touching Math.random.
 */
function makeRandom(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/* ========================================================================== */
/* Critically damped spring                                                   */
/* ========================================================================== */

/**
 * Second-order critically damped spring, integrated semi-implicitly. Critical damping
 * (`c = 2*sqrt(k)`) is what stops recoil looking bouncy and cartoonish: the part snaps out
 * and settles without visible overshoot unless we deliberately underdamp it.
 */
class Spring {
  constructor(stiffness, dampingRatio = 1.0) {
    this.value = 0;
    this.vel = 0;
    this.target = 0;
    this.k = stiffness;
    this.zeta = dampingRatio;
  }
  set(k, zeta) {
    this.k = k;
    if (zeta !== undefined) this.zeta = zeta;
  }
  /** Instantaneous velocity change — this is how a shot enters the system. */
  impulse(v) {
    this.vel += v;
  }
  step(dt) {
    // Sub-step so a 20 Hz frame cannot make a 900 N/m spring explode.
    const sub = dt > 1 / 90 ? Math.min(4, Math.ceil(dt * 90)) : 1;
    const h = dt / sub;
    const c = 2 * this.zeta * Math.sqrt(this.k);
    for (let i = 0; i < sub; i++) {
      const a = -this.k * (this.value - this.target) - c * this.vel;
      this.vel += a * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
  reset() {
    this.value = 0;
    this.vel = 0;
    this.target = 0;
  }
}

/**
 * Velocity impulse that makes a spring of stiffness `k` and damping ratio `zeta` peak at
 * exactly 1.0. Multiply by the desired peak to get the impulse to apply. See the derivation
 * where it is used in `equip()`.
 */
function impulseFor(k, zeta) {
  const w = Math.sqrt(k);
  const z = clamp(zeta, 0.05, 0.999);
  const s = Math.sqrt(1 - z * z);
  return w / Math.exp((-z * Math.acos(z)) / s);
}

/* ========================================================================== */
/* Geometry helpers — nothing here may produce a raw sharp-edged box          */
/* ========================================================================== */

/** Rounded rectangle in XY, centred on the origin. */
function roundedRectShape(w, h, r) {
  const hw = w * 0.5;
  const hh = h * 0.5;
  r = clamp(r, 1e-5, Math.min(hw, hh) * 0.98);
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

/**
 * A box with every edge chamfered — the workhorse. Extruded along +/-Z with a bevel at both
 * caps and rounded corners on the profile, so the silhouette catches a highlight the way
 * machined aluminium does. Raw `BoxGeometry` is banned in this file for exactly this reason.
 */
function chamferBox(w, h, d, opt) {
  const o = opt || {};
  const r = clamp(o.r !== undefined ? o.r : Math.min(w, h) * 0.18, 1e-4, Math.min(w, h) * 0.46);
  const bev = clamp(
    o.bevel !== undefined ? o.bevel : Math.min(w, h, d) * 0.11,
    1e-4,
    Math.min(r * 0.75, d * 0.45)
  );
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth: Math.max(1e-4, d - bev * 2),
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelOffset: 0,
    bevelSegments: o.bevelSegments || 1,
    curveSegments: o.curveSegments || 3,
    steps: 1,
  });
  geo.translate(0, 0, -(d * 0.5 - bev));
  return geo;
}

/** Chamfered box whose long axis is Y (grips, magazines, uprights). */
function chamferBoxY(w, h, d, opt) {
  const g = chamferBox(w, d, h, opt);
  g.rotateX(-Math.PI * 0.5);
  return g;
}

/** Chamfered box whose long axis is X (cross pins, bolt catches). */
function chamferBoxX(w, h, d, opt) {
  const g = chamferBox(d, h, w, opt);
  g.rotateY(Math.PI * 0.5);
  return g;
}

/**
 * Lathe about the Z axis. `profile` is [[radius, z], ...] with z *descending* (forward is
 * -Z, the way the weapon points). Internally the lathe runs about +Y with y = -z, which
 * keeps the winding correct, then we rotate the axis onto -Z.
 */
function latheZ(profile, segments) {
  const pts = [];
  for (let i = 0; i < profile.length; i++) {
    pts.push(new THREE.Vector2(Math.max(1e-5, profile[i][0]), -profile[i][1]));
  }
  const g = new THREE.LatheGeometry(pts, segments || 16);
  g.rotateX(-Math.PI * 0.5);
  return g;
}

/** Lathe about the Y axis, profile [[radius, y], ...] with y ascending. */
function latheY(profile, segments) {
  const pts = [];
  for (let i = 0; i < profile.length; i++) {
    pts.push(new THREE.Vector2(Math.max(1e-5, profile[i][0]), profile[i][1]));
  }
  return new THREE.LatheGeometry(pts, segments || 16);
}

/** A hollow tube (outer wall, inner wall, both rims) along Z. */
function tubeZ(rOut, rIn, z0, z1, segments) {
  return latheZ(
    [
      [rIn, z0],
      [rOut, z0],
      [rOut, z1],
      [rIn, z1],
      [rIn, z0],
    ],
    segments || 20
  );
}

/** A bevelled plate from an arbitrary Shape, extruded along Z. */
function plate(shape, depth, bevel, curveSegments) {
  const bev = clamp(bevel === undefined ? depth * 0.18 : bevel, 1e-4, depth * 0.45);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - bev * 2),
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelOffset: 0,
    bevelSegments: 1,
    curveSegments: curveSegments || 4,
    steps: 1,
  });
  g.translate(0, 0, -(depth * 0.5 - bev));
  return g;
}

/** Torus with sane defaults, used for sling loops and trigger guard returns. */
function ring(radius, tube, seg, tubeSeg) {
  return new THREE.TorusGeometry(radius, tube, tubeSeg || 6, seg || 16);
}

/** A capsule-ish tapered limb along +Y from the origin, for arms. */
function limbGeometry(len, rTop, rBot, seg) {
  return latheY(
    [
      [1e-4, -rBot * 0.55],
      [rBot * 0.72, -rBot * 0.28],
      [rBot, 0],
      [lerp(rBot, rTop, 0.45), len * 0.45],
      [rTop, len],
      [rTop * 0.7, len + rTop * 0.35],
      [1e-4, len + rTop * 0.6],
    ],
    seg || 12
  );
}

/* ========================================================================== */
/* Vertex-colour surface treatment                                            */
/* ========================================================================== */

/**
 * Bakes a `color` attribute into a merged batch: three octaves of value noise for grain,
 * plus a wear term that brightens up-facing and outward-facing surfaces. This is what stops
 * an untextured procedural gun reading as flat plastic, and it costs nothing at runtime.
 */
function bakeVertexTint(geo, opts) {
  const o = opts || {};
  const grain = o.grain !== undefined ? o.grain : 0.085;
  const wear = o.wear !== undefined ? o.wear : 0.09;
  /** Settled dust on up-facing faces. 0 for anything the hand touches, high on a forearm. */
  const dust = o.dust !== undefined ? o.dust : 0;
  /** Grime that collects where a face turns away from the sky — seams, cuffs, undersides. */
  const grime = o.grime !== undefined ? o.grime : 0;
  const gain = o.gain !== undefined ? o.gain : 1;
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Three octaves at gun scale — 8 mm, 22 mm and 90 mm features.
    let g =
      (hash3(x * 128, y * 128, z * 128) - 0.5) * 0.55 +
      (hash3(x * 46, y * 46, z * 46) - 0.5) * 0.32 +
      (hash3(x * 11, y * 11, z * 11) - 0.5) * 0.13;
    const ny = nrm ? nrm.getY(i) : 0;
    const nx = nrm ? Math.abs(nrm.getX(i)) : 0;
    // Up-facing and outboard faces catch handling wear; undersides stay dark and dusty.
    const w = clamp(ny * 0.65 + nx * 0.35, -1, 1);
    const v = (1 + g * grain + w * wear) * gain;
    let r = v;
    let gg = v * (1 + g * grain * 0.22);
    let b = v * (1 - g * grain * 0.18);
    if (dust > 0) {
      // Ash settles on horizontal faces and breaks up with the same noise field, so the
      // dust edge is ragged rather than a clean lambert term.
      const d = clamp(dust * clamp(ny, 0, 1) * (0.55 + 1.6 * (g + 0.28)), 0, 0.85);
      r += (_C_DUST.r * 1.15 - r) * d;
      gg += (_C_DUST.g * 1.15 - gg) * d;
      b += (_C_DUST.b * 1.15 - b) * d;
    }
    if (grime > 0) {
      // Downward-facing and inboard faces darken and go slightly cool — sweat, oil, shadow.
      const c = clamp(grime * clamp(-ny * 0.7 + (1 - nx) * 0.35, 0, 1) * (0.6 + 0.8 * (0.5 - g)), 0, 0.8);
      r += (_C_SHADOW.r * 0.55 - r) * c;
      gg += (_C_SHADOW.g * 0.55 - gg) * c;
      b += (_C_SHADOW.b * 0.55 - b) * c;
    }
    arr[i * 3] = r;
    arr[i * 3 + 1] = gg;
    arr[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Simple camo blotching straight into vertex colours — used for the sleeves and cuffs.
 *
 * `gain` exists because the palette tones are authored for *world* surfaces standing in
 * fog at 30 m. A sleeve 0.4 m from the eye takes the key light head-on with no atmospheric
 * attenuation at all, so at gain 1.0 PALETTE.sandbag measured brighter than the sunlit
 * ground behind it, which is the single loudest tell that the arm is not in the scene.
 * `dust` lays settled ash on up-facing cloth on top of the blotches.
 */
function bakeCamo(geo, tones, opts) {
  const o = opts || {};
  const gain = o.gain !== undefined ? o.gain : 1;
  const dust = o.dust !== undefined ? o.dust : 0;
  const grime = o.grime !== undefined ? o.grime : 0;
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Two-scale blotch field, quantised into the tone list -> hard-edged multicam-ish patches.
    const f =
      hash3(x * 34, y * 26, z * 34) * 0.6 +
      hash3(x * 78 + 11, y * 61 + 3, z * 78 + 7) * 0.4;
    const idx = clamp(Math.floor(f * tones.length), 0, tones.length - 1);
    c.set(tones[idx]);
    const j = (1 + (hash3(x * 190, y * 190, z * 190) - 0.5) * 0.12) * gain;
    let r = c.r * j;
    let g = c.g * j;
    let b = c.b * j;
    const ny = nrm ? nrm.getY(i) : 0;
    if (dust > 0) {
      const d = clamp(dust * clamp(ny, 0, 1) * (0.5 + f * 0.9), 0, 0.8);
      r += (_C_DUST.r * 0.85 - r) * d;
      g += (_C_DUST.g * 0.85 - g) * d;
      b += (_C_DUST.b * 0.85 - b) * d;
    }
    if (grime > 0) {
      const k = clamp(grime * clamp(-ny, 0, 1) * (0.4 + (1 - f) * 0.9), 0, 0.8);
      r *= 1 - k * 0.7;
      g *= 1 - k * 0.7;
      b *= 1 - k * 0.66;
    }
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/* ========================================================================== */
/* Assembly — collects primitives and merges them per material                */
/* ========================================================================== */

const _bm = new THREE.Matrix4();
const _bq = new THREE.Quaternion();
const _be = new THREE.Euler();
const _bp = new THREE.Vector3();
const _bs = new THREE.Vector3();

class Assembly {
  constructor() {
    this.batches = new Map();
    this.count = 0;
  }
  /**
   * `t` is an optional transform: {p:[x,y,z], r:[x,y,z], s:[x,y,z]|number}. The geometry is
   * consumed — do not reuse the instance you pass in.
   */
  add(geo, matKey, t) {
    if (!geo) return this;
    if (t) {
      _bp.set(t.p ? t.p[0] : 0, t.p ? t.p[1] : 0, t.p ? t.p[2] : 0);
      _be.set(t.r ? t.r[0] : 0, t.r ? t.r[1] : 0, t.r ? t.r[2] : 0);
      _bq.setFromEuler(_be);
      if (typeof t.s === 'number') _bs.set(t.s, t.s, t.s);
      else _bs.set(t.s ? t.s[0] : 1, t.s ? t.s[1] : 1, t.s ? t.s[2] : 1);
      _bm.compose(_bp, _bq, _bs);
      geo.applyMatrix4(_bm);
    }
    let g = geo;
    if (g.index) g = g.toNonIndexed();
    // mergeGeometries demands an identical attribute set across the batch.
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') g.deleteAttribute(key);
    }
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!this.batches.has(matKey)) this.batches.set(matKey, []);
    this.batches.get(matKey).push(g);
    this.count++;
    return this;
  }
  /** Mirror-add across X, for symmetric detail (sling loops, vent ribs, finger swells). */
  addMirrored(geoFactory, matKey, t) {
    this.add(geoFactory(), matKey, t);
    const t2 = {
      p: [-(t && t.p ? t.p[0] : 0), t && t.p ? t.p[1] : 0, t && t.p ? t.p[2] : 0],
      r: [t && t.r ? t.r[0] : 0, -(t && t.r ? t.r[1] : 0), -(t && t.r ? t.r[2] : 0)],
      s: t ? t.s : 1,
    };
    this.add(geoFactory(), matKey, t2);
    return this;
  }
  /** Merge each batch and emit one mesh per material. */
  build(mats, tintOpts) {
    const group = new THREE.Group();
    for (const [key, list] of this.batches) {
      if (!list.length) continue;
      let merged = null;
      try {
        merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      } catch {
        merged = list[0];
      }
      if (!merged) continue;
      if (list.length > 1) for (const g of list) if (g !== merged) g.dispose();
      bakeVertexTint(merged, (tintOpts && tintOpts[key]) || null);
      const mesh = new THREE.Mesh(merged, mats[key] || mats.gunmetal);
      mesh.name = 'batch:' + key;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    this.batches.clear();
    return group;
  }
}

/* ========================================================================== */
/* Manufactured detail — the small hard parts                                 */
/* ========================================================================== */

/**
 * Fastener heads, hex sockets, knurled bands, data panels, sling sockets, rail covers.
 *
 * None of these carry the silhouette. All of them carry the read at 0.3 m, which is where a
 * viewmodel actually lives: the difference between "a gun-shaped object" and "an object that
 * came off a production line" is almost entirely small, hard, repeated features that a hand
 * would have had to fit. A smooth extrusion at this magnification reads as a placeholder no
 * matter how good its proportions are.
 *
 * Each builder either hands `Assembly.add` several primitives with the *same* transform (the
 * transform object is only read, never mutated, so that is safe and keeps the cluster in one
 * batch), or lays a cluster out in a convenient local frame and merges it into one geometry
 * first. Either way nothing here costs an extra draw call.
 */

/** Transform a geometry in place. Same {p,r,s} convention as `Assembly.add`. */
function place(geo, p, r, s) {
  _bp.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0);
  _be.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
  _bq.setFromEuler(_be);
  if (typeof s === 'number') _bs.set(s, s, s);
  else _bs.set(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1);
  _bm.compose(_bp, _bq, _bs);
  geo.applyMatrix4(_bm);
  return geo;
}

/** Merge a locally-built cluster into a single geometry. Build time only, never per frame. */
function mergeLocal(list) {
  const parts = [];
  for (const g of list) {
    if (!g) continue;
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const key of Object.keys(n.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') n.deleteAttribute(key);
    }
    parts.push(n);
  }
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  let merged = null;
  try {
    merged = mergeGeometries(parts, false);
  } catch {
    merged = null;
  }
  if (!merged) return parts[0];
  for (const g of parts) g.dispose();
  return merged;
}

/** Regular hexagon prism along Z, sized across the flats. A hex socket, or a nut. */
function hexPrismZ(acrossFlats, depth) {
  const rc = (acrossFlats * 0.5) / Math.cos(Math.PI / 6);
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * rc;
    const y = Math.sin(a) * rc;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1, steps: 1 });
  g.translate(0, 0, -depth * 0.5);
  return g;
}

/**
 * Socket-head cap screw, axis along the local +Z of `cfg`.
 *
 * The head lathe is deliberately *not* capped, so its top is an open annulus, and the hex
 * prism sits a fourteenth of the head depth below the rim. The socket is therefore a real
 * recess that self-occludes and goes black, rather than a hexagon painted onto a disc — which
 * is the whole point, because what the eye reads at this size is the dark spot, not the shape.
 */
function addScrew(asm, cfg) {
  const rad = cfg.rad !== undefined ? cfg.rad : 0.0026;
  const dep = cfg.depth !== undefined ? cfg.depth : 0.0018;
  asm.add(
    latheZ(
      [
        [rad * 0.62, dep * 0.5],
        [rad * 0.96, dep * 0.3],
        [rad, dep * 0.1],
        [rad, -dep * 0.5],
        [rad * 0.5, -dep * 0.5],
      ],
      cfg.seg || 10
    ),
    cfg.mat || 'worn',
    cfg
  );
  asm.add(hexPrismZ(rad * 1.07, dep * 0.86), 'cavity', cfg);
}

/**
 * Knurled band about +Z.
 *
 * Real knurling is a crossed diamond; at 0.3 m through a 60° lens what survives is the
 * high-frequency radial break-up, so a single ring of axial ridges carries it. Built as *one*
 * extruded star annulus rather than N separate ridge boxes — same silhouette, about a fifth of
 * the triangles, and one geometry the caller can place with a single transform. The hole
 * matters: several of these sit round an optic tube, and a solid disc would plug the tube
 * interior the player is looking down.
 */
function knurlGeo(rad, len, n, ridge) {
  const count = Math.max(6, n || 16);
  const rOut = rad + ridge * 0.85;
  const rRoot = Math.max(1e-4, rad - ridge * 0.45);
  const rIn = Math.max(1e-4, rad - ridge * 2.4);
  const s = new THREE.Shape();
  const pts = count * 2;
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const rr = i % 2 === 0 ? rOut : rRoot;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  const hole = new THREE.Path();
  for (let i = 0; i < 12; i++) {
    // Reverse winding, which is what makes three treat it as a hole rather than an island.
    const a = -(i / 12) * Math.PI * 2;
    if (i === 0) hole.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
    else hole.lineTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
  }
  hole.closePath();
  s.holes.push(hole);
  const bev = Math.min(ridge * 0.3, len * 0.18);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(1e-4, len - bev * 2),
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev * 0.55,
    bevelOffset: 0,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  g.translate(0, 0, -(len * 0.5 - bev));
  return g;
}

/**
 * A glyph-sized plate. Deliberately the cheapest primitive in the file: a rounded rectangle at
 * one curve segment with a hairline bevel, roughly 60 triangles. There are forty of these on a
 * weapon between the data panels and the index marks and they are 1 mm tall, so paying
 * `chamferBox`'s default tessellation for them would cost more than the receiver.
 */
function microPlate(w, h, d) {
  const r = Math.min(w, h) * 0.24;
  const bev = Math.min(d * 0.4, r * 0.6);
  const g = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth: Math.max(1e-4, d - bev * 2),
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelOffset: 0,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  g.translate(0, 0, -(d * 0.5 - bev));
  return g;
}

/** `microPlate` whose long axis is X — cross ridges, serrations, pins. */
function microPlateX(w, h, d) {
  const g = microPlate(d, h, w);
  g.rotateY(Math.PI * 0.5);
  return g;
}

/** QD sling socket: a raised boss with a real bore, axis along the local +Z of `cfg`. */
function addQdSocket(asm, cfg) {
  const rad = cfg.rad !== undefined ? cfg.rad : 0.0058;
  asm.add(
    latheZ(
      [
        [rad * 0.52, 0.0022],
        [rad, 0.0015],
        [rad, -0.003],
        [rad * 0.86, -0.0038],
      ],
      12
    ),
    cfg.mat || 'gunmetal',
    cfg
  );
  asm.add(
    latheZ(
      [
        [rad * 0.5, 0.0016],
        [rad * 0.5, -0.004],
        [1e-4, -0.0044],
      ],
      10
    ),
    'cavity',
    cfg
  );
}

/**
 * Engraved data panel: a shallow recessed field with rows of raised glyph bars.
 *
 * It is not legible and is not trying to be. A serial plate at arm's length reads as a
 * rectangle of high-frequency marks with a border; the glyph heights are jittered off the
 * same hash the vertex tint uses so the rows do not degenerate into a barcode.
 */
function stencilGeo(cfg) {
  const w = cfg.w || 0.026;
  const h = cfg.h || 0.0075;
  const rows = cfg.rows || 2;
  const seed = cfg.seed || 3;
  const list = [];
  list.push(place(chamferBox(w, h, 0.0011, { r: 0.0009, bevel: 0.0005, curveSegments: 2 }), [0, 0, -0.0004]));
  const glyphH = h / (rows + 0.9);
  for (let r = 0; r < rows; r++) {
    const y = h * 0.5 - glyphH * (r + 0.85);
    const n = 7 + ((seed * (r + 3)) % 3);
    const gw = (w * 0.86) / n;
    for (let i = 0; i < n; i++) {
      const x = -w * 0.43 + gw * (i + 0.5);
      const hh = glyphH * (0.5 + 0.32 * hash3(i * 3.1 + seed, r * 7.7, seed * 2.3));
      list.push(place(microPlate(gw * 0.58, hh, 0.0007), [x, y, 0.0006]));
    }
  }
  return mergeLocal(list);
}

/**
 * Picatinny ladder cover — the polymer strip a shooter clips over the rail sections their
 * support hand has to touch. Two of them break up what is otherwise 200 mm of unbroken
 * machined teeth, which is both more truthful and a much better silhouette.
 */
function railCoverGeo(len, w) {
  const list = [];
  list.push(place(chamferBox(w, 0.0042, len, { r: 0.0011, bevel: 0.0008, curveSegments: 2 }), [0, 0, 0]));
  const rungs = Math.max(3, Math.round(len / 0.0074));
  for (let i = 0; i < rungs; i++) {
    const z = len * 0.5 - (len / rungs) * (i + 0.5);
    list.push(place(microPlate(w * 0.9, 0.0024, 0.0026), [0, 0.0027, z]));
  }
  return mergeLocal(list);
}

/**
 * Shallow spherical cap about Z, bulging towards +Z — a lens element rather than a flat disc.
 *
 * `sag` is the centre rise. A real combat optic's objective is only a fraction of a millimetre
 * proud over 30 mm of aperture, but the *normal* sweep across it is what makes the coating
 * flash rotate as the weapon moves, and a flat circle cannot do that at any opacity.
 */
function domedDisc(r, sag, seg, rings) {
  const n = Math.max(3, rings || 5);
  const prof = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    prof.push([Math.max(1e-5, r * t), sag * Math.sqrt(Math.max(0, 1 - t * t))]);
  }
  return latheZ(prof, seg || 26);
}

/**
 * A bevel highlight: a ~1.5 mm sliver of bare alloy laid at 45° along a long edge.
 *
 * At the art-directed 8° key rake a square edge catches no highlight at all and reads as a CSG
 * boolean. A broken edge on an anodised part really is bare metal — the anodising is 20 µm
 * thick and the first thing to go — so these sit in the `worn` band, and the specular line
 * they throw is what separates the receiver from the rail from the magwell in silhouette.
 */
function addEdgeHighlight(asm, cfg) {
  const t = cfg.t || 0.0015;
  asm.add(
    chamferBox(t, t, cfg.len, { r: t * 0.28, bevel: t * 0.22, curveSegments: 2 }),
    cfg.mat || 'worn',
    cfg
  );
}

/* ========================================================================== */
/* Materials                                                                  */
/* ========================================================================== */

/**
 * Borrow a procedural map from world/materials.js if that module built successfully.
 * Cloning a Texture shares the GPU `source` but gives us private repeat/offset, so we can
 * retile a 3-metre concrete-scale map down to 30-millimetre gun scale for free.
 */
function borrowMap(game, name, key, repeat) {
  try {
    const tex = game.materials && game.materials.getTextures ? game.materials.getTextures(name) : null;
    const src = tex && tex[key];
    if (!src || !src.isTexture) return null;
    const c = src.clone();
    c.wrapS = THREE.RepeatWrapping;
    c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(repeat, repeat);
    c.needsUpdate = true;
    return c;
  } catch {
    return null;
  }
}

function buildMaterials(game) {
  const env = (game.materials && game.materials.env) || null;
  const owned = [];

  const make = (name, params, borrow) => {
    const m = new THREE.MeshStandardMaterial(
      Object.assign({ vertexColors: true, envMapIntensity: 1.0, side: THREE.FrontSide }, params)
    );
    if (borrow) {
      const rp = borrow.repeat || 6;
      const nm = borrowMap(game, borrow.from, 'normalMap', rp);
      const rm = borrowMap(game, borrow.from, 'roughnessMap', rp);
      if (nm) {
        m.normalMap = nm;
        m.normalScale.set(borrow.normalScale || 0.35, borrow.normalScale || 0.35);
      }
      // The ORM green channel *multiplies* our authored roughness, so a borrowed map is what
      // makes each band spatially varying instead of a flat constant — see §3.4's rule that a
      // constant roughness reads instantly as amateur.
      if (rm) m.roughnessMap = rm;
      if (borrow.albedo) {
        // Only cloth and leather take a borrowed albedo: those are the surfaces whose *value*
        // is a weave, not a moulded colour. `albedoGain` compensates for the map already
        // carrying most of the surface value, and is applied only when the map really arrived,
        // so the no-materials-module fallback still gets a correctly dark flat colour.
        const am = borrowMap(game, borrow.from, 'map', borrow.albedoRepeat || rp);
        if (am) {
          m.map = am;
          m.color.multiplyScalar(borrow.albedoGain !== undefined ? borrow.albedoGain : 1);
        }
      }
    }
    if (env) m.envMap = env;
    m.name = 'vm:' + name;
    owned.push(m);
    return m;
  };

  /* Viewmodel IBL weight. The gun's shadow side is lit by nothing except the environment
     probe, so this number *is* whether the unlit half of the receiver retains material read
     or crushes to a silhouette. Metals carry more of it than dielectrics because for a metal
     the environment is the entire response.

     Trimmed from 1.45. The probe is a PMREM of the whole dome and is close to achromatic, so
     every unit of it over 1.0 is a neutral wash on top of an already-unshadowed key — see the
     F0 note below, which is where the same error was much larger. 1.22 keeps the sky in the
     receiver's flats without it being the brightest thing in the response. */
  const ENV_METAL = 1.05;
  const ENV_POLY = 0.95;
  const ENV_CLOTH = 0.55; // cloth has no business mirroring the sky; this is what made the arm glow

  /* Four genuinely separate roughness bands, wide enough apart that the same key light
     produces four visibly different specular characters (§3.8's material-contrast bar):
     optic housing 0.32 -> rail 0.38 -> anodised alloy 0.46 -> phosphated steel 0.60 ->
     polymer 0.74, with the rubber and the grip effectively matte at 0.90+, and bare `worn`
     steel alone down at 0.15. The old set ran 0.29-0.61 with metalness 0.94-1.0 on everything,
     which is why they collapsed into one gloss.

     The whole band moved up ~0.12 after measuring where the receiver's brightness was actually
     coming from. It was not the base colour: at roughness 0.34 the GGX lobe peaks at D = 1/(pi
     a^2) = 24, so a 40 mm flat catching the key near its mirror direction returns ~0.74 in
     scene-linear, which is over AgX's shoulder at exposure 5 no matter how dark the F0 is. A
     hard-anodised receiver is bead-blasted satin, not semi-gloss; 0.46 drops that peak by 3x
     and spreads it, which is both truer to the finish and what finally puts the weapon under
     the sunlit ground it is being held over. The tight finish is now `worn` and only `worn`,
     which is precisely what makes a broken edge read as a broken edge.

     ---- Reflectance recalibration, measured off a live capture ----------------------------
     The `gain` numbers on the four metal bands were 3.4 / 4.1 / 2.5 / 3.0 against `worn` at
     2.1, and that ordering is backwards: it puts the *finish* brighter than the bare metal it
     is supposed to have been worn off. Read back from a 960x540 gunclose capture, the flat of
     the mk18 upper measured luminance 179/255 against sunlit track ballast at 83 — the
     black-anodised receiver was the brightest object in the frame, more than twice the
     brightness of lit gravel, and the whole weapon collapsed into one pale beige value with
     the rail, the optic body and the buffer tube within 30 codes of each other.

     The mistake was treating "a metal's base colour is its F0, so lift it" as a licence to
     lift without a target. Bare aluminium really is F0 0.91 and PALETTE.gunmetal really is
     0.035 linear, but a *hard-anodised* receiver is neither: the coating is a dark, porous
     oxide and it measures around 0.08-0.12 broadband. 3.4x put it at 0.31. Phosphated barrel
     steel is darker still. So every band below is re-derived from what the finish is, not from
     what the substrate under it would be, and `worn` goes *up* to a real bright-steel 0.52 so
     that a broken edge, a latch or a muzzle crown is unambiguously the brightest thing on the
     weapon. That ordering — dark finish, bright wear — is the entire mechanism by which wear
     reads as wear rather than as a paler shade of the same paint. */
  const mats = {
    /* Receiver: hard-anodised 7075. Satin, dark, and firmly below the sunlit ground behind it. */
    gunmetal: make('gunmetal', {
      color: metalF0(PALETTE.gunmetal, 0.72, 0.12),
      metalness: 0.86,
      roughness: 0.46,
      envMapIntensity: ENV_METAL,
    }, { from: 'gunmetal', repeat: 7, normalScale: 0.4 }),

    /* Rail: the same alloy, but every slot corner has been worn back to bright metal by
       mounts going on and off, so it runs a touch brighter and tighter than the receiver. */
    rail: make('rail', {
      color: metalF0(PALETTE.gunmetal, 1.00, 0.16),
      metalness: 0.90,
      roughness: 0.38,
      envMapIntensity: ENV_METAL,
    }, { from: 'gunmetal', repeat: 5, normalScale: 0.30 }),

    /* Barrel: manganese phosphate over steel. Noticeably *rougher* and darker than the
       receiver — the phosphate conversion coating is a matte crystalline surface, and that
       contrast against the anodising is most of what says "two different processes". */
    steel: make('steel', {
      color: metalF0(PALETTE.gunmetal, 0.72, 0.10),
      metalness: 0.92,
      roughness: 0.60,
      envMapIntensity: ENV_METAL,
    }, { from: 'gunmetal', repeat: 11, normalScale: 0.34 }),

    /* Optic housing: type-III anodised tube, the tightest finish on the gun. */
    opticBody: make('opticBody', {
      color: metalF0(PALETTE.gunmetal, 0.80, 0.12),
      metalness: 0.88,
      roughness: 0.32,
      envMapIntensity: ENV_METAL * 1.1,
    }, { from: 'gunmetal', repeat: 9, normalScale: 0.26 }),

    /* Wear points: charging-handle latch, bolt face, mag-catch, safety detent, broken edges,
       the muzzle crown. Real bright steel — the only genuinely shiny surfaces on the weapon,
       and now 4-5x the reflectance of the finish they have worn through, which is what makes
       them read as wear instead of as highlights. */
    worn: make('worn', {
      color: metalF0(PALETTE.steelBare, 2.10, 0.08),
      metalness: 1.0,
      roughness: 0.15,
      envMapIntensity: ENV_METAL * 1.15,
    }),

    /* Carbon fouling: soot round the muzzle ports, aft of the ejection port, on the bolt
       face. Nearly black, nearly fully rough, and *slightly* metallic because burnt propellant
       residue is a conductive film — which is why it kills the specular under it rather than
       just darkening it. This is the other half of the wear story: bright where steel rubs
       steel, black where gas escapes. */
    carbon: make('carbon', {
      color: new THREE.Color(0.028, 0.024, 0.022),
      metalness: 0.30,
      roughness: 0.93,
      envMapIntensity: ENV_METAL * 0.35,
    }, { from: 'gunmetal', repeat: 16, normalScale: 0.5 }),

    /* Polymer that a hand has actually been on: the handguard where the C-clamp lands, the
       backstrap, the magazine spine. Skin oil fills the moulding texture and polishes it, so
       it goes *smoother* and a shade lighter, never a different hue. Roughness carries the
       whole effect — this is the material-system answer to "worn where the support hand
       grips", rather than painting a lighter patch on. */
    polymerWorn: make('polymerWorn', {
      color: dielectric(PALETTE.gunPolymer, 1.85, 0.14),
      metalness: 0.0,
      roughness: 0.46,
      envMapIntensity: ENV_POLY * 1.15,
    }, { from: 'gunPolymer', repeat: 10, normalScale: 0.34 }),

    /* Handguard / stock polymer: moulded, matte, and a dielectric — its specular is the
       fixed 4% F0, so pushing roughness right up is the only way to kill the sheen.

       The dielectric gains came down with the metals and for the same reason. At 2.4 the
       stock's albedo landed on 0.13 linear; glass-filled nylon furniture is *black*, and black
       polymer measures 0.03-0.05. 1.55 puts it at 0.084 — still lifted well above the raw
       palette value, because a viewmodel with no shadowing and no fog on it needs some
       headroom to keep its form readable, but no longer three times the reflectance of the
       thing it is modelling. Same adjustment on the grip, the tan furniture and the rubber. */
    polymer: make('polymer', {
      color: dielectric(PALETTE.gunPolymer, 1.55),
      metalness: 0.0,
      roughness: 0.74,
      envMapIntensity: ENV_POLY,
    }, { from: 'gunPolymer', repeat: 8, normalScale: 0.75 }),

    /* Grip polymer: aggressive stipple, near-fully rough. */
    grip: make('grip', {
      color: dielectric(PALETTE.gunPolymer, 1.35),
      metalness: 0.0,
      roughness: 0.90,
      envMapIntensity: ENV_POLY * 0.85,
    }, { from: 'gunPolymer', repeat: 18, normalScale: 1.1 }),

    /* Tan furniture — the vector reads warmer than the mk18 at a glance. */
    tan: make('tan', {
      color: new THREE.Color(PALETTE.gunTan).multiplyScalar(0.46),
      metalness: 0.0,
      roughness: 0.68,
      envMapIntensity: ENV_POLY,
    }, { from: 'gunPolymer', repeat: 9, normalScale: 0.6 }),

    /* Oiled walnut for the dmr14 — satin, the one warm dielectric with a real sheen. */
    wood: make('wood', {
      color: new THREE.Color(PALETTE.woodWeathered).multiplyScalar(1.05),
      metalness: 0.0,
      roughness: 0.44,
      envMapIntensity: ENV_POLY,
    }, { from: 'gunWood', repeat: 4, normalScale: 0.6 }),

    /* Buttpad, eyecup, cheek riser pad. Rubber is the matte extreme of the set. */
    rubber: make('rubber', {
      color: dielectric(PALETTE.gunRubber, 1.7),
      metalness: 0.0,
      roughness: 0.97,
      envMapIntensity: ENV_POLY * 0.6,
    }, { from: 'gunPolymer', repeat: 22, normalScale: 1.2 }),

    /* Brass, for the round visible at the port and the follower witness holes. */
    brass: make('brass', {
      color: new THREE.Color(PALETTE.brass),
      metalness: 1.0,
      roughness: 0.33,
      envMapIntensity: ENV_METAL,
    }),

    /* Glove, back of hand: woven nomex. The borrowed fabric albedo is what puts a real weave
       on the closest surface in the game; the authored colour is only a tint on it. */
    glove: make('glove', {
      color: new THREE.Color(PALETTE.gunPolymer).lerp(new THREE.Color(PALETTE.dirt), 0.45).multiplyScalar(1.6),
      metalness: 0.0,
      roughness: 0.88,
      envMapIntensity: ENV_CLOTH,
    }, { from: 'fabric', repeat: 12, normalScale: 0.85, albedo: true, albedoRepeat: 12, albedoGain: 2.8 }),

    /* Glove, palm and finger pads: goat leather. Much smoother than the fabric back, and
       polished further where it actually grips — the roughness map supplies that variation. */
    glovePalm: make('glovePalm', {
      color: new THREE.Color(PALETTE.gunRubber).lerp(new THREE.Color(PALETTE.woodWeathered), 0.34).multiplyScalar(1.5),
      metalness: 0.0,
      roughness: 0.44,
      envMapIntensity: ENV_CLOTH * 1.4,
    }, { from: 'fabric', repeat: 16, normalScale: 0.30, albedo: true, albedoRepeat: 16, albedoGain: 3.4 }),

    /* Knuckle guards and finger reinforcement — moulded TPR, between leather and fabric. */
    gloveHard: make('gloveHard', {
      color: dielectric(PALETTE.gunRubber, 2.2),
      metalness: 0.0,
      roughness: 0.58,
      envMapIntensity: ENV_CLOTH * 1.2,
    }, { from: 'gunPolymer', repeat: 14, normalScale: 0.9 }),

    /* Sleeve, camouflaged via vertex colour. The albedo is *entirely* the baked camo, so the
       material colour stays white and `bakeCamo`'s gain controls the level. */
    sleeve: make('sleeve', {
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.95,
      envMapIntensity: ENV_CLOTH,
    }, { from: 'fabric', repeat: 3.2, normalScale: 0.55 }),

    /* Cuff / wrist webbing: heavier weave than the sleeve, and dirtier. */
    cuff: make('cuff', {
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.93,
      envMapIntensity: ENV_CLOTH * 0.8,
    }, { from: 'fabric', repeat: 2.4, normalScale: 0.8 }),

    /* Hazard-yellow selector markings and the odd stencilled detail. */
    marking: make('marking', {
      color: new THREE.Color(PALETTE.hazardYellow),
      metalness: 0.1,
      roughness: 0.52,
      envMapIntensity: ENV_POLY,
    }),

    /* Deep shadow inserts: ejection port recess, M-LOK slot bottoms, bore. */
    cavity: make('cavity', {
      color: new THREE.Color(0x08090a),
      metalness: 0.1,
      roughness: 0.97,
      envMapIntensity: ENV_POLY * 0.35,
    }),
  };

  /* Optic glass. Transmission would be lovely and is far too expensive for a viewmodel that
     is on screen every frame, so this is an alpha-blended standard material — but the numbers
     have to make it read *darker* than the sky behind it, which is what real coated glass
     does. The previous set (opacity 0.24, roughness 0.045, envMapIntensity 2.6) was a mirror
     with almost no body colour: 24% of a 2.6x sky reflection is still a blown white clip and
     that is exactly how it rendered. Now the body colour is a deep blue-green (the coating
     cast), it carries most of the blend, and the specular is a sheen rather than a mirror. */
  /* Second recalibration, and this one is about *where the energy lives*, not how much.
     At colour x0.42 / opacity 0.72 the element was mostly a diffuse disc: 72% of a lit mid-tone
     laid over the tube, which renders as a flat green-grey coin whatever is behind it. Measured
     off a capture, the ocular came back at luminance 142 with under 12 codes of variation
     across the whole aperture — a painted disc, exactly what §3.8 says not to ship.
     Real coated glass reflects under 1% on axis and approaches 100% at grazing, so essentially
     all of its visible energy is Fresnel. So the body colour drops by 4.2x and the opacity with
     it — in ADS the ocular fills the whole aperture, so every point of opacity is a point of
     tint over the entire sight picture, and at 0.58 the view through the scope came back
     visibly teal — while roughness tightens and envMapIntensity goes up:
     three's IBL includes the Fresnel term, so on the domed element that produces a dark centre
     and a bright rim *for free*, from the geometry, and the bright band travels round the lens
     as the weapon moves. That is what the additive rim below was faking, so it comes down. */
  mats.glass = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.glass).lerp(new THREE.Color(PALETTE.tarpBlue), 0.72).multiplyScalar(0.10),
    metalness: 0.0,
    roughness: 0.12,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    envMapIntensity: 1.5,
  });
  if (env) mats.glass.envMap = env;
  owned.push(mats.glass);

  /* Anti-reflective coating flash: the green-gold bloom every combat optic throws off axis.
     Additive and weak — it is a tint on the glass, not a light source. */
  mats.coating = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.055, 0.105, 0.082),
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(mats.coating);

  /* Fresnel rim: a thin annulus at the edge of the glass. Grazing angles are where a lens
     goes bright, and having the *rim* be the bright part rather than the centre is the whole
     difference between reading as glass and reading as a painted white disc.
     Halved now that the elements are domed and the standard material's own IBL Fresnel does
     most of this properly — this is only the top-up that a 26-segment lathe cannot resolve at
     the very edge, and doubling up on it was part of what blew the aperture out. */
  mats.coatRim = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.3, 0.44, 0.52),
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(mats.coatRim);

  /* Reticle. Colour deliberately > 1.0 so the bloom threshold at 1.0 in HDR catches it. */
  mats.reticle = new THREE.MeshBasicMaterial({
    color: new THREE.Color(6.2, 0.42, 0.16),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  owned.push(mats.reticle);

  mats.reticleGlow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.5, 0.14, 0.05),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  owned.push(mats.reticleGlow);

  mats._owned = owned;
  return mats;
}

/* ========================================================================== */
/* Shared sub-assemblies                                                      */
/* ========================================================================== */

/**
 * Pistol grip with finger swells. Built as a lathe-less stack of chamfered slabs on a rake
 * angle plus three torus finger grooves, so the front strap actually has relief.
 */
function buildPistolGrip(asm, cfg) {
  const mat = cfg.mat || 'grip';
  const x = cfg.x || 0;
  const z = cfg.z;
  const y = cfg.y;
  const rake = cfg.rake !== undefined ? cfg.rake : 0.30;
  const len = cfg.len || 0.088;
  const w = cfg.w || 0.028;

  // Backstrap-to-frontstrap body, three stacked segments narrowing to the base.
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const segLen = len / 4;
    const yy = y - segLen * (i + 0.5);
    const zz = z + Math.sin(rake) * segLen * (i + 0.5);
    asm.add(
      chamferBoxY(w * (1 - t * 0.13), segLen * 1.06, 0.036 - t * 0.006, { r: 0.007, bevel: 0.0022, curveSegments: 4 }),
      mat,
      { p: [x, yy, zz], r: [rake, 0, 0] }
    );
  }
  // Finger swells on the front strap.
  for (let i = 0; i < 3; i++) {
    const yy = y - 0.018 - i * 0.021;
    const zz = z + Math.sin(rake) * (0.018 + i * 0.021) - 0.0165;
    asm.add(ring(0.0092, 0.0034, 10, 5), mat, { p: [x, yy, zz], r: [Math.PI * 0.5, 0, 0], s: [1.5, 1, 1] });
  }
  /* Beavertail / backstrap flare where the web of the hand sits. `polymerWorn` rather than
     `polymer`: this is the single spot on the weapon a hand never leaves, and skin oil fills
     the moulding stipple and polishes it. The change is a roughness change, not a colour
     change, which is why it survives every light angle instead of only reading head-on. */
  asm.add(
    chamferBoxY(w * 1.04, 0.026, 0.014, { r: 0.006, bevel: 0.002 }),
    'polymerWorn',
    { p: [x, y - 0.006, z - 0.0175], r: [rake - 0.22, 0, 0] }
  );
  // Grip cap with a lanyard loop, and the screw that actually holds the grip to the receiver.
  asm.add(
    chamferBoxY(w * 0.9, 0.008, 0.031, { r: 0.005, bevel: 0.0018 }),
    'polymer',
    { p: [x, y - len - 0.002, z + Math.sin(rake) * len], r: [rake, 0, 0] }
  );
  addScrew(asm, {
    rad: 0.0032,
    depth: 0.0018,
    seg: 10,
    p: [x, y - len - 0.0058, z + Math.sin(rake) * len],
    r: [Math.PI * 0.5 - rake, 0, 0],
  });
}

/** Trigger guard (bevelled loop) plus the trigger itself, returned as a separate mesh. */
function buildTriggerGroup(asm, mats, cfg) {
  const z = cfg.z;
  const y = cfg.y;
  const w = cfg.w || 0.0125;

  // Guard: a bevelled U built from three chamfered members so it has real corner radii.
  asm.add(chamferBoxX(w, 0.0075, 0.052, { r: 0.0028, bevel: 0.0016 }), 'gunmetal', {
    p: [0, y - 0.042, z + 0.004],
  });
  asm.add(chamferBoxY(w, 0.030, 0.0075, { r: 0.0028, bevel: 0.0016 }), 'gunmetal', {
    p: [0, y - 0.028, z + 0.028],
    r: [0.14, 0, 0],
  });
  asm.add(chamferBoxY(w, 0.024, 0.0075, { r: 0.0028, bevel: 0.0016 }), 'gunmetal', {
    p: [0, y - 0.026, z - 0.021],
    r: [-0.10, 0, 0],
  });
  // Front radius of the guard.
  asm.add(ring(0.011, 0.0036, 12, 5), 'gunmetal', {
    p: [0, y - 0.033, z - 0.0285],
    r: [0, Math.PI * 0.5, 0],
    s: [1, 1.1, 1],
  });

  // The trigger blade itself: a curved shoe with a bevelled face, hinged at the pin.
  const triggerShape = new THREE.Shape();
  triggerShape.moveTo(0, 0);
  triggerShape.lineTo(0.0035, -0.002);
  triggerShape.quadraticCurveTo(0.006, -0.014, 0.0016, -0.0245);
  triggerShape.quadraticCurveTo(-0.0022, -0.028, -0.0048, -0.0225);
  triggerShape.quadraticCurveTo(-0.004, -0.010, -0.0038, 0);
  triggerShape.lineTo(0, 0);
  // Extruded in XY, then swung so the blade is thin across X and its profile lies in ZY.
  const triggerGeo = plate(triggerShape, 0.0072, 0.0016, 5);
  triggerGeo.rotateY(Math.PI * 0.5);
  const trigger = new THREE.Mesh(bakeVertexTint(triggerGeo, { grain: 0.05, wear: 0.16 }), mats.worn);
  trigger.position.set(0, y - 0.008, z + 0.002);
  trigger.frustumCulled = false;
  return trigger;
}

/**
 * Handguard. Built as longitudinal ribs around a heptagonal section with real gaps between
 * them — the gaps *are* the vent slots, and short cross-bars every few centimetres give the
 * M-LOK ladder. No CSG, no fake texture: you can see the barrel through it.
 */
function buildHandguard(asm, cfg) {
  const mat = cfg.mat || 'polymer';
  const z0 = cfg.z0;
  const z1 = cfg.z1;
  const r = cfg.r || 0.0245;
  const ribs = cfg.ribs || 7;
  const len = z0 - z1;

  // Rear and front collars.
  asm.add(tubeZ(r * 1.05, r * 0.62, z0, z0 - 0.016, 18), 'gunmetal', null);
  asm.add(tubeZ(r * 0.98, r * 0.66, z1 + 0.012, z1, 18), mat, null);

  // Longitudinal ribs. The top rib is wider — that is the continuous top rail.
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2 - Math.PI * 0.5;
    const isTop = Math.abs(Math.sin(a) - 1) < 0.35;
    const wRib = isTop ? 0.0215 : 0.0128;
    const rr = isTop ? r * 0.92 : r * 0.93;
    asm.add(
      chamferBox(wRib, 0.0075, len - 0.026, { r: 0.0026, bevel: 0.0016, curveSegments: 3 }),
      mat,
      { p: [Math.cos(a) * rr, Math.sin(a) * rr, (z0 + z1) * 0.5 - 0.002], r: [0, 0, a + Math.PI * 0.5] }
    );
    // Slot floor: a dark insert set below the rib pair so the gap reads as depth, not a hole.
    if (!isTop) {
      const a2 = a + Math.PI / ribs;
      asm.add(
        chamferBox(0.010, 0.0035, len - 0.05, { r: 0.0012, bevel: 0.0009, curveSegments: 2 }),
        'cavity',
        { p: [Math.cos(a2) * r * 0.70, Math.sin(a2) * r * 0.70, (z0 + z1) * 0.5 - 0.002], r: [0, 0, a2 + Math.PI * 0.5] }
      );
    }
  }

  // Cross-bars: these break the vents into M-LOK-length slots.
  const bars = Math.max(2, Math.round(len / 0.052));
  for (let b = 1; b < bars; b++) {
    const zz = z0 - 0.016 - (len - 0.030) * (b / bars);
    asm.add(tubeZ(r * 0.945, r * 0.80, zz + 0.0045, zz - 0.0045, 16), mat, null);
  }

  // Picatinny teeth along the top rail — the single most recognisable gun silhouette cue.
  // Same coarser pitch as the receiver rail; see the note in buildReceiver.
  const railY = r * 0.92 + 0.0058;
  const teeth = Math.max(3, Math.round(len / 0.0168));
  for (let t = 0; t < teeth; t++) {
    const zz = z0 - 0.020 - (len - 0.040) * (t / Math.max(1, teeth - 1));
    asm.add(
      chamferBox(0.0206, 0.0046, 0.0098, { r: 0.0019, bevel: 0.0016, curveSegments: 3 }),
      'rail',
      { p: [0, railY, zz] }
    );
  }
  /* Rail covers. Two sections with a deliberate gap between them, which is what a shooter
     actually does to the rail their hand has to reach, and what stops 200 mm of identical
     teeth reading as a machine-generated repeat. The gap matters as much as the covers: from
     the hip pose the whole top run is foreshortened into one ramp, and it is the *interruption*
     that gives the eye something to measure the length against. */
  const coverLen = len * 0.30;
  asm.add(railCoverGeo(coverLen, 0.0212), 'polymer', { p: [0, railY + 0.0012, z1 + 0.028 + coverLen * 0.5] });
  asm.add(railCoverGeo(len * 0.2, 0.0212), 'polymer', {
    p: [0, railY + 0.0012, z1 + 0.048 + coverLen + len * 0.1],
  });
  // Broken edges either side of the rail top. See addEdgeHighlight.
  asm.addMirrored(() => microPlate(0.0013, 0.0013, len - 0.046), 'worn', {
    p: [0.0101, railY + 0.0023, (z0 + z1) * 0.5 - 0.002],
    r: [0, 0, Math.PI * 0.25],
  });

  /* Barrel-nut clamp screws round the rear collar — the fastener pattern that says this is a
     free-float tube bolted onto a nut, not a shroud that grew out of the receiver. */
  for (let i = 0; i < 3; i++) {
    const zz = z0 - 0.0045 - i * 0.0052;
    for (const sgn of [1, -1]) {
      addScrew(asm, {
        rad: 0.0021,
        depth: 0.0016,
        seg: 8,
        p: [sgn * r * 1.03, -0.0025 - i * 0.0018, zz],
        r: [0, sgn * Math.PI * 0.5, 0],
      });
    }
  }
  // Anti-rotation index pin under the collar.
  asm.add(latheZ([[0.0024, z0 - 0.007], [0.0024, z0 - 0.013], [0.0016, z0 - 0.014]], 8), 'worn', {
    p: [0, -r * 0.86, 0],
  });

  // Handstop / index block where the support thumb goes — visibly worn.
  asm.add(
    chamferBox(0.020, 0.011, 0.020, { r: 0.0035, bevel: 0.0018 }),
    'grip',
    { p: [0, -r * 0.92 - 0.004, z1 + len * 0.30], r: [0.10, 0, 0] }
  );
  /* Where the C-clamp actually lands. `polymerWorn` is the same polymer with the moulding
     texture filled by skin oil: smoother, a shade lighter, same hue. Two shallow pads either
     side of the handstop, following the ribs so the wear looks like it grew on the geometry
     rather than being decalled onto it. */
  const wearMat = cfg.wear || (mat === 'polymer' ? 'polymerWorn' : mat);
  for (let i = 0; i < 2; i++) {
    const a = (i === 0 ? -1 : 1) * 0.86;
    asm.add(
      chamferBox(0.0125, 0.0032, 0.062, { r: 0.0012, bevel: 0.0009, curveSegments: 3 }),
      wearMat,
      {
        p: [Math.sin(a) * r * 0.95, -Math.cos(a) * r * 0.95, z1 + len * 0.32],
        r: [0, 0, a],
      }
    );
  }

  // QD sling sockets, both sides of the rear collar, plus one under the front collar for a
  // two-point sling run forward.
  for (const sgn of [1, -1]) {
    addQdSocket(asm, { rad: 0.0056, p: [sgn * r * 0.9, -0.004, z0 - 0.023], r: [0, sgn * Math.PI * 0.5, 0] });
  }
  addQdSocket(asm, { rad: 0.005, p: [0, -r * 0.93, z1 + 0.026], r: [Math.PI * 0.5, 0, 0] });
}

/** Muzzle device: a ported flash hider or a compensator, per config. */
function buildMuzzle(asm, cfg) {
  const z = cfg.z;
  const r = cfg.r || 0.0112;
  const len = cfg.len || 0.058;
  const bore = cfg.bore || 0.0038;

  asm.add(
    latheZ(
      [
        [r * 0.86, z],
        [r * 1.02, z - 0.004],
        [r * 1.02, z - 0.010],
        [r * 0.90, z - 0.013],
        [r * 0.90, z - len + 0.010],
        [r * 1.06, z - len + 0.006],
        [r * 1.06, z - len],
        [bore, z - len],
        [bore, z],
      ],
      18
    ),
    'steel',
    null
  );
  // Bore cavity so you are not looking at a flat disc down the barrel.
  asm.add(latheZ([[bore * 0.98, z - len], [bore * 0.98, z - len + 0.03], [1e-4, z - len + 0.03]], 12), 'cavity', null);

  /* Crown. The muzzle is the most reliably worn surface on any weapon: the device is the first
     thing into a doorway, the last thing out of a vehicle, and the bore mouth is scrubbed bare
     by cleaning rods. A shallow bright cup wrapping the front edge is the whole "finish worn
     through at the muzzle" note, and because it sits in `worn` at 4x the reflectance of the
     phosphated device around it, it reads at any light angle. */
  asm.add(
    latheZ(
      [
        [r * 1.07, z - len + 0.0024],
        [r * 1.07, z - len - 0.0005],
        [r * 0.78, z - len - 0.0005],
        [r * 0.78, z - len + 0.0008],
      ],
      18
    ),
    'worn',
    null
  );
  // Soot ring round the bore mouth, on the front face, where the gas actually leaves.
  asm.add(latheZ([[r * 0.79, z - len - 0.0007], [bore * 1.06, z - len - 0.0007]], 16), 'carbon', null);

  // Ports. Prongs on top and sides, closed underneath so muzzle blast does not kick up dust.
  const ports = cfg.ports || 5;
  for (let i = 0; i < ports; i++) {
    const a = -Math.PI * 0.5 + Math.PI * 0.28 + (i / (ports - 1)) * Math.PI * 1.44;
    for (let k = 0; k < 3; k++) {
      const zz = z - 0.018 - k * 0.013;
      asm.add(
        chamferBox(0.0045, 0.0075, 0.0072, { r: 0.0011, bevel: 0.0008, curveSegments: 2 }),
        'cavity',
        { p: [Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, zz], r: [0, 0, a + Math.PI * 0.5] }
      );
    }
    // Soot fan trailing back from each port, where the gas actually goes.
    asm.add(
      microPlate(0.0062, 0.0016, 0.02),
      'carbon',
      { p: [Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93, z - 0.030], r: [0, 0, a + Math.PI * 0.5] }
    );
  }
  // Knurled band on the shank, where a wrench or a hand times the device onto the thread.
  asm.add(knurlGeo(r * 0.905, 0.013, 18, 0.0009), 'steel', { p: [0, 0, z - len + 0.030] });
  // Crush washer / timing shim. Authored front-to-back so the lathe profile descends in z.
  asm.add(latheZ([[r * 0.80, z + 0.0032], [r * 0.98, z + 0.0032], [r * 0.98, z], [r * 0.80, z]], 16), 'worn', null);
}

/** Front sight post inside a protective hood, sitting on the gas block. */
function buildFrontSight(asm, cfg) {
  const z = cfg.z;
  const y = cfg.y;
  asm.add(chamferBox(0.0058, 0.020, 0.0125, { r: 0.0014, bevel: 0.0009, curveSegments: 3 }), 'gunmetal', {
    p: [0, y + 0.011, z],
  });
  asm.add(latheZ([[0.0021, z + 0.003], [0.0021, z - 0.003], [0.0011, z - 0.003]], 8), 'worn', {
    p: [0, y + 0.020, 0],
  });
  // Hood ears.
  asm.addMirrored(() => chamferBox(0.0032, 0.020, 0.0105, { r: 0.0011, bevel: 0.0008, curveSegments: 2 }), 'gunmetal', {
    p: [0.0068, y + 0.013, z],
    r: [0, 0, 0.10],
  });
}

/** Gas block with a bevelled taper and a gas tube running back into the receiver. */
function buildGasBlock(asm, cfg) {
  const z = cfg.z;
  asm.add(
    chamferBox(0.0205, 0.0225, 0.030, { r: 0.0035, bevel: 0.0022, curveSegments: 4 }),
    'steel',
    { p: [0, 0.0012, z] }
  );
  /* Gas tube, running rearwards from the block into the receiver. Profile z must descend.
     Stainless, so it stays in `worn` — and it is the one part of the gas system the player can
     see through the handguard vents, which is the entire reason the vents are real gaps. */
  asm.add(latheZ([[0.0019, cfg.tubeZ], [0.0028, cfg.tubeZ], [0.0028, z + 0.004]], 10), 'worn', {
    p: [0, 0.0122, 0],
  });
  // Heat colouring where the tube leaves the block: the first 30 mm runs blue-black.
  asm.add(latheZ([[0.0030, z - 0.004], [0.0030, z + 0.026]], 10), 'carbon', { p: [0, 0.0122, 0] });
  // Gas tube roll pin through the block, and the two taper set screws that time it.
  asm.add(latheZ([[0.0016, 0.0125], [0.0016, -0.0125]], 8), 'worn', {
    p: [0, 0.0122, z - 0.010],
    r: [0, Math.PI * 0.5, 0],
  });
  for (const sgn of [1, -1]) {
    addScrew(asm, { rad: 0.0022, depth: 0.0015, seg: 8, p: [sgn * 0.0104, -0.004, z + 0.008], r: [0, sgn * Math.PI * 0.5, 0] });
  }
  // Gas port set screw underneath.
  asm.add(latheZ([[0.0022, z - 0.008], [0.0022, z - 0.011]], 8), 'worn', { p: [0, -0.0118, 0], r: [0, 0, 0] });
  // Carbon wash on the underside and the rear face of the block.
  asm.add(microPlate(0.019, 0.0014, 0.026), 'carbon', {
    p: [0, -0.0104, z + 0.001],
  });
}

/**
 * Curved detachable box magazine with a floorplate, witness holes and a visible follower.
 * The curve is real: the body is a stack of short slabs on an arc, not one bent box.
 */
function buildMagazineMesh(mats, cfg) {
  const asm = new Assembly();
  const segs = cfg.segs || 6;
  const len = cfg.len || 0.105;
  const w = cfg.w || 0.0225;
  const d = cfg.d || 0.033;
  const curve = cfg.curve !== undefined ? cfg.curve : 0.42;
  const mat = cfg.mat || 'polymer';

  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const seg = len / segs;
    const yy = -t * (len - seg) - seg * 0.5;
    // Circular arc: the further down the magazine, the further forward it swings.
    const bend = curve * t * t;
    const zz = -bend * 0.055;
    asm.add(
      chamferBoxY(w * (1 - t * 0.04), seg * 1.05, d * (1 - t * 0.02), { r: 0.0048, bevel: 0.0021, curveSegments: 4 }),
      mat,
      { p: [0, yy, zz], r: [bend * 0.62, 0, 0] }
    );
    // Grip ribs down the side, alternating so the mag reads as textured polymer.
    if (i > 0 && i < segs - 1) {
      const gf = () => chamferBox(0.0022, seg * 0.62, 0.0026, { r: 0.0007, bevel: 0.0005, curveSegments: 2 });
      asm.addMirrored(gf, mat, { p: [w * 0.5, yy, zz + d * 0.24], r: [bend * 0.62, 0, 0] });
      asm.addMirrored(gf, mat, { p: [w * 0.5, yy, zz - d * 0.24], r: [bend * 0.62, 0, 0] });
    }
  }
  // Feed lips and the exposed top round.
  asm.add(chamferBoxY(w * 1.02, 0.010, d * 1.01, { r: 0.005, bevel: 0.002 }), 'gunmetal', { p: [0, 0.004, 0] });
  /* Feed lips scrubbed bare. A magazine's lips take the whole bolt face on every round and are
     always the brightest 2 mm on the weapon; two slivers of `worn` along them are what stops
     the magazine reading as a moulded lump with a brass sticker on top. */
  asm.addMirrored(() => microPlate(0.0016, 0.0016, d * 0.86), 'worn', {
    p: [w * 0.5 - 0.0008, 0.0084, 0],
    r: [0, 0, Math.PI * 0.25],
  });
  asm.add(
    latheZ([[0.0044, 0.010], [0.0044, -0.004], [0.0032, -0.010], [1e-4, -0.012]], 10),
    'brass',
    { p: [0, 0.0075, -0.002], r: [-0.22, 0, 0] }
  );
  // Floorplate with a bevelled lip.
  const bend = curve;
  asm.add(chamferBoxY(w * 1.14, 0.0085, d * 1.06, { r: 0.0035, bevel: 0.0018 }), mat, {
    p: [0, -len - 0.002, -curve * 0.055],
    r: [bend * 0.62, 0, 0],
  });
  asm.add(chamferBoxY(w * 1.20, 0.0042, d * 1.12, { r: 0.0028, bevel: 0.0014 }), 'rubber', {
    p: [0, -len - 0.008, -curve * 0.055],
    r: [bend * 0.62, 0, 0],
  });
  /* Floorplate texture. A bare rubber slab is the flattest surface on the whole model and it
     sits at the bottom of the silhouette where the eye tracks the reload, so it gets a real
     moulded waffle: cross ribs plus the disassembly button and its retaining plate. */
  {
    const list = [];
    for (let i = -2; i <= 2; i++) {
      list.push(place(microPlate(w * 1.10, 0.0016, 0.0022), [0, 0, i * (d * 0.20)]));
    }
    for (let i = -1; i <= 1; i++) {
      list.push(place(microPlate(0.0022, 0.0016, d * 1.02), [i * (w * 0.36), 0, 0]));
    }
    asm.add(mergeLocal(list), 'rubber', { p: [0, -len - 0.0098, -curve * 0.055], r: [bend * 0.62, 0, 0] });
    // Baseplate retainer button, punched through the floorplate.
    asm.add(latheY([[0.0030, 0], [0.0030, 0.0018], [0.0021, 0.0024]], 8), 'worn', {
      p: [0, -len - 0.0104, -curve * 0.055 + d * 0.22],
      r: [Math.PI + bend * 0.62, 0, 0],
    });
  }
  /* Witness holes. A recessed slot with a rim reads as a hole; a flat dark square reads as a
     sticker, which is what these were. Round counts show as brass through the top two. */
  for (let i = 1; i <= 4; i++) {
    const t = i / 5.4;
    const px = w * 0.5 - 0.0004;
    const py = -t * len;
    const pz = -curve * t * t * 0.055 + d * 0.30;
    const rot = [0, Math.PI * 0.5, 0];
    asm.add(chamferBox(0.0055, 0.0055, 0.0016, { r: 0.0012, bevel: 0.0007, curveSegments: 3 }), mat, {
      p: [px + 0.0004, py, pz],
      r: rot,
    });
    asm.add(chamferBox(0.0038, 0.0038, 0.0028, { r: 0.0009, bevel: 0.0006, curveSegments: 3 }), 'cavity', {
      p: [px, py, pz],
      r: rot,
    });
    if (i <= 2) {
      asm.add(chamferBox(0.0026, 0.0026, 0.0012, { r: 0.0007, bevel: 0.0004, curveSegments: 3 }), 'brass', {
        p: [px - 0.0008, py, pz],
        r: rot,
      });
    }
  }
  // Data panel on the magazine spine — lot number, capacity, the usual moulded block.
  asm.add(stencilGeo({ w: 0.017, h: 0.0058, rows: 2, seed: 5 }), mat, {
    p: [0, -len * 0.42, -curve * 0.18 * 0.055 - d * 0.51],
    r: [0, Math.PI, 0],
  });

  const group = asm.build(mats, { [mat]: { grain: 0.1, wear: 0.07 } });
  group.name = 'magazine';
  return group;
}

/**
 * Optic. `kind` is 'reddot' (short tube, big glass) or 'lpvo' (long tube, turrets, magnifier
 * bell, throw lever). Returns {group, sightAnchor, reticle} — the reticle is repositioned
 * every frame so it is parallax free.
 */
function buildOptic(mats, cfg) {
  const asm = new Assembly();
  const kind = cfg.kind || 'reddot';
  const zc = cfg.z;
  const yc = cfg.y;
  const glassR = kind === 'lpvo' ? 0.0165 : 0.0148;
  const tubeR = glassR + 0.0032;
  const back = kind === 'lpvo' ? zc + 0.062 : zc + 0.026;
  const front = kind === 'lpvo' ? zc - 0.082 : zc - 0.026;

  // Mount: a bevelled cantilever with two cross-bolts and a QD throw lever.
  asm.add(chamferBox(0.030, 0.0165, kind === 'lpvo' ? 0.088 : 0.052, { r: 0.0035, bevel: 0.0022, curveSegments: 4 }), 'opticBody', {
    p: [0, yc - tubeR - 0.0075, zc - (kind === 'lpvo' ? 0.010 : 0.000)],
  });
  asm.add(chamferBox(0.0355, 0.0075, kind === 'lpvo' ? 0.084 : 0.048, { r: 0.0028, bevel: 0.0018, curveSegments: 3 }), 'opticBody', {
    p: [0, yc - tubeR - 0.0175, zc - (kind === 'lpvo' ? 0.010 : 0.000)],
  });
  asm.add(chamferBoxX(0.040, 0.0075, 0.010, { r: 0.0022, bevel: 0.0015, curveSegments: 3 }), 'worn', {
    p: [0.006, yc - tubeR - 0.0175, zc + 0.016],
  });
  // Throw-lever cam on the clamp bar, and the recoil-lug screw through the mount.
  asm.add(chamferBox(0.0055, 0.0165, 0.0135, { r: 0.0022, bevel: 0.0013, curveSegments: 3 }), 'worn', {
    p: [0.0245, yc - tubeR - 0.0175, zc + 0.016],
    r: [0, 0, 0.34],
  });
  addScrew(asm, {
    rad: 0.0028,
    depth: 0.0019,
    seg: 10,
    p: [0, yc - tubeR - 0.0092, zc - (kind === 'lpvo' ? 0.032 : 0.017)],
    r: [Math.PI * 0.5, 0, 0],
  });
  // Broken edges along the mount's outer top corners — the mount is machined 6061 and the
  // first thing to lose its anodising is exactly these two lines.
  asm.addMirrored(() => microPlate(0.0013, 0.0013, (kind === 'lpvo' ? 0.084 : 0.048) - 0.006), 'worn', {
    p: [0.0148, yc - tubeR - 0.0031, zc - (kind === 'lpvo' ? 0.01 : 0.0)],
    r: [0, 0, Math.PI * 0.25],
  });
  // Rings.
  const ringZ = kind === 'lpvo' ? [zc + 0.028, zc - 0.030] : [zc + 0.004];
  for (const rz of ringZ) {
    asm.add(tubeZ(tubeR + 0.0042, tubeR - 0.0002, rz + 0.007, rz - 0.007, 20), 'opticBody', { p: [0, yc, 0] });
    // Ring clamp screws, one each side — real socket heads with real sockets.
    for (const sgn of [1, -1]) {
      addScrew(asm, {
        rad: 0.0023,
        depth: 0.0017,
        seg: 8,
        p: [sgn * (tubeR + 0.0034), yc - 0.0052, rz],
        r: [Math.PI * 0.5, 0, 0],
      });
    }
  }

  // Main tube, with the bell flare at the objective for the LPVO.
  const profile = [];
  profile.push([tubeR * 0.72, back + 0.010]);
  profile.push([tubeR, back + 0.006]);
  profile.push([tubeR, back]);
  if (kind === 'lpvo') {
    profile.push([tubeR * 0.86, back - 0.012]);
    profile.push([tubeR * 0.86, zc + 0.040]);
    profile.push([tubeR * 0.94, zc + 0.036]);
    profile.push([tubeR * 0.94, zc - 0.030]);
    profile.push([tubeR * 0.86, zc - 0.034]);
    profile.push([tubeR * 0.86, front + 0.016]);
    profile.push([tubeR * 1.06, front + 0.008]);
    profile.push([tubeR * 1.06, front]);
    profile.push([tubeR * 0.86, front]);
  } else {
    profile.push([tubeR * 0.90, back - 0.008]);
    profile.push([tubeR * 0.90, front + 0.008]);
    profile.push([tubeR, front + 0.004]);
    profile.push([tubeR, front]);
    profile.push([tubeR * 0.74, front]);
  }
  asm.add(latheZ(profile, 24), 'opticBody', { p: [0, yc, 0] });

  /* Interior wall — deliberately near-black so the glass reads as a tunnel, not a disc — plus
     real baffles. The baffles are what make it a tube: a smooth black cylinder behind glass is
     ambiguous at any brightness, whereas three stepped rings give the eye parallax cues as the
     weapon moves and the interior resolves as *inside something*. They sit in `carbon`, which
     is matte and near-black but still carries a normal map, exactly like the flocking in a
     real optic. */
  asm.add(tubeZ(glassR * 0.995, glassR * 0.94, back - 0.004, front + 0.004, 20), 'cavity', { p: [0, yc, 0] });
  {
    const span = back - front - 0.016;
    const n = kind === 'lpvo' ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const bz = front + 0.010 + (span * (i + 0.5)) / n;
      asm.add(tubeZ(glassR * 0.99, glassR * (0.92 - i * 0.018), bz + 0.0012, bz - 0.0012, 18), 'cavity', {
        p: [0, yc, 0],
      });
    }
  }

  // Turrets: windage right, elevation top, each with a knurled cap.
  const turretZ = kind === 'lpvo' ? zc + 0.002 : zc - 0.002;
  const turret = (rx, rz, dir) =>
    latheZ(
      [
        [0.0062, 0],
        [0.0062, -0.011],
        [0.0086, -0.012],
        [0.0086, -0.020],
        [0.0072, -0.0225],
        [1e-4, -0.0225],
      ],
      12
    );
  /* Turret caps, knurled. A turret is a knob a shooter turns wearing gloves: without the
     knurl it is a smooth cylinder and reads as a bolt head. The index line on top is in the
     `marking` band so it picks up the same hazard yellow as the selector — the only saturated
     hit anywhere on the weapon, which §4 wants kept scarce. */
  const turretCap = (mat) => [
    { g: turret(), m: 'opticBody' },
    { g: place(knurlGeo(0.0088, 0.0074, 16, 0.0009), [0, 0, -0.016]), m: mat || 'opticBody' },
    { g: place(microPlate(0.0016, 0.0016, 0.0075), [0, 0.009, -0.0165]), m: 'worn' },
  ];
  for (const t of [
    { p: [0, yc + tubeR - 0.001, turretZ], r: [Math.PI * 0.5, 0, 0] },
    { p: [tubeR - 0.001, yc, turretZ], r: [0, -Math.PI * 0.5, 0] },
  ]) {
    for (const part of turretCap()) asm.add(part.g, part.m, t);
  }
  if (kind === 'lpvo') {
    // Magnification ring with a throw lever and a knurled band under it.
    asm.add(latheZ([[tubeR * 1.10, back - 0.014], [tubeR * 1.10, back - 0.030]], 20), 'opticBody', { p: [0, yc, 0] });
    asm.add(knurlGeo(tubeR * 1.11, 0.014, 26, 0.0011), 'opticBody', { p: [0, yc, back - 0.022] });
    asm.add(chamferBox(0.0075, 0.030, 0.011, { r: 0.0022, bevel: 0.0014, curveSegments: 3 }), 'polymer', {
      p: [tubeR * 1.10 + 0.012, yc + 0.006, back - 0.022],
      r: [0, 0, -0.5],
    });
    // Diopter ring at the ocular, also knurled — two different knurl pitches on one optic is
    // a real manufacturing tell.
    asm.add(knurlGeo(tubeR * 1.02, 0.009, 20, 0.0008), 'opticBody', { p: [0, yc, back + 0.002] });
  } else {
    // Brightness rheostat on the left of a red dot, knurled, with a detent index.
    asm.add(latheZ([[0.0058, 0], [0.0058, -0.008], [0.0074, -0.009], [0.0074, -0.016], [1e-4, -0.016]], 12), 'opticBody', {
      p: [-tubeR + 0.001, yc, turretZ + 0.010],
      r: [0, Math.PI * 0.5, 0],
    });
    asm.add(place(knurlGeo(0.0076, 0.0062, 14, 0.0009), [0, 0, -0.0125]), 'opticBody', {
      p: [-tubeR + 0.001, yc, turretZ + 0.010],
      r: [0, Math.PI * 0.5, 0],
    });
    asm.add(place(microPlate(0.0014, 0.0014, 0.0062), [0, 0.008, -0.013]), 'worn', {
      p: [-tubeR + 0.001, yc, turretZ + 0.010],
      r: [0, Math.PI * 0.5, 0],
    });
    // Battery cap on the right, opposite the windage turret.
    asm.add(latheZ([[0.0072, 0], [0.0072, -0.0052], [0.0058, -0.0062]], 12), 'opticBody', {
      p: [0, yc - tubeR + 0.001, turretZ + 0.014],
      r: [-Math.PI * 0.5, 0, 0],
    });
  }

  // Rubber eyecup / killflash honeycomb rim.
  asm.add(latheZ([[tubeR * 0.98, back + 0.012], [tubeR * 1.14, back + 0.006], [tubeR * 1.14, back - 0.004], [tubeR * 0.98, back - 0.004]], 20), 'rubber', {
    p: [0, yc, 0],
  });
  asm.add(latheZ([[tubeR * 1.02, front - 0.001], [tubeR * 1.14, front - 0.004], [tubeR * 1.14, front - 0.012], [tubeR * 1.02, front - 0.010]], 20), 'rubber', {
    p: [0, yc, 0],
  });

  const group = asm.build(mats, { opticBody: { grain: 0.06, wear: 0.11 } });
  group.name = 'optic';

  /* --- Glass: two discs, the ocular and the objective. --------------------
     Draw order matters more than it looks. Everything here is depthWrite:false and
     transparent, so three sorts it by renderOrder and *nothing* occludes anything else;
     the numbers below simply stack coating over glass and put the reticle on top of both.
     The reticle used to inherit renderOrder from its Group, which three ignores — group
     render order is not propagated — so the dot was sorting at 0, underneath the glass. */
  /* Both elements are shallow spherical caps, not discs. The sag is ~4% of the aperture, which
     is about right for a 1x objective and — far more importantly — means the surface normal
     sweeps ~9° from centre to rim. That sweep is the entire reason a lens looks like glass:
     the coating flash and the environment reflection travel *across* the element as the weapon
     moves, instead of the whole disc switching brightness together the way a flat plane does.
     A flat circle cannot produce that at any opacity, which is why the old objective read as a
     painted green dot. */
  const sag = glassR * 0.042;
  const glassGeo = domedDisc(glassR, sag, 26, 5);
  const ocular = new THREE.Mesh(glassGeo, mats.glass);
  ocular.position.set(0, yc, back - 0.006);
  ocular.renderOrder = 8;
  ocular.frustumCulled = false;
  group.add(ocular);

  const objective = new THREE.Mesh(glassGeo, mats.glass);
  objective.position.set(0, yc, front + 0.006);
  objective.rotation.y = Math.PI;
  objective.renderOrder = 7;
  objective.frustumCulled = false;
  group.add(objective);

  // Anti-reflective coating flash — the green-gold cast every combat optic has, on both
  // elements, because the objective is the one the player sees for 99% of the match. Slightly
  // shallower dome than the glass so it never z-fights it at grazing angles.
  const coatGeo = domedDisc(glassR * 0.985, sag * 1.06, 26, 5);
  const coat = new THREE.Mesh(coatGeo, mats.coating);
  coat.position.set(0, yc, back - 0.0056);
  coat.renderOrder = 9;
  coat.frustumCulled = false;
  group.add(coat);

  const coatFront = new THREE.Mesh(coatGeo, mats.coating);
  coatFront.position.set(0, yc, front + 0.0056);
  coatFront.rotation.y = Math.PI;
  coatFront.renderOrder = 9;
  coatFront.frustumCulled = false;
  group.add(coatFront);

  // Fresnel rim on the objective. A lens goes bright at grazing incidence and stays dark on
  // axis; a thin bright annulus is a cheap, view-independent stand-in that reads correctly
  // from the off-axis angles hipfire actually shows.
  const rimGeo = new THREE.RingGeometry(glassR * 0.80, glassR * 0.995, 24);
  const rim = new THREE.Mesh(rimGeo, mats.coatRim);
  rim.position.set(0, yc, front + 0.0052);
  rim.renderOrder = 10;
  rim.frustumCulled = false;
  group.add(rim);

  const rimBack = new THREE.Mesh(rimGeo, mats.coatRim);
  rimBack.position.set(0, yc, back - 0.0052);
  rimBack.renderOrder = 10;
  rimBack.frustumCulled = false;
  group.add(rimBack);

  /* --- Reticle ------------------------------------------------------------ */
  const reticle = new THREE.Group();
  reticle.name = 'reticle';

  if (kind === 'lpvo') {
    // Illuminated centre dot + a broken circle + heavy posts at 3, 6 and 9 o'clock.
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.5, 10), mats.reticle);
    reticle.add(dot);
    const circ = new THREE.Mesh(new THREE.RingGeometry(4.4, 5.2, 28), mats.reticle);
    reticle.add(circ);
    const postGeo = new THREE.PlaneGeometry(0.9, 4.6);
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(postGeo, mats.reticle);
      const a = [Math.PI * 0.5, 0, Math.PI][i];
      p.position.set(Math.cos(a) * 8.2, Math.sin(a) * 8.2, 0);
      p.rotation.z = a - Math.PI * 0.5;
      reticle.add(p);
    }
    // Sub-tension hash marks below the centre, for holdover.
    for (let i = 1; i <= 3; i++) {
      const h = new THREE.Mesh(new THREE.PlaneGeometry(2.2 - i * 0.35, 0.55), mats.reticle);
      h.position.set(0, -1.9 * i, 0);
      reticle.add(h);
    }
  } else {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(1.0, 12), mats.reticle);
    reticle.add(dot);
  }
  /* Glow halo. Sized down from 3.4/6.5: the hipfire scale below put a 3.4-unit halo at 8.2 mm
     radius inside a 13 mm aperture, so 62% of the objective was a soft orange wash and the
     tube interior it is supposed to be sitting *in* never showed. A dot needs a halo, not a
     floodlight. */
  const glow = new THREE.Mesh(new THREE.CircleGeometry(kind === 'lpvo' ? 4.6 : 2.3, 14), mats.reticleGlow);
  glow.position.z = -0.0002;
  reticle.add(glow);
  // renderOrder has to live on the meshes, not the Group — see the note above the glass.
  for (const c of reticle.children) {
    c.frustumCulled = false;
    c.renderOrder = c === glow ? 11 : 12;
  }
  group.add(reticle);

  const sightAnchor = new THREE.Object3D();
  sightAnchor.name = 'sightAnchor';
  sightAnchor.position.set(0, yc, (back + front) * 0.5);
  group.add(sightAnchor);

  // The reticle plane sits just behind the objective, which is where the aperture clamp in
  // update() confines it so the dot can never float outside the tube.
  const reticlePlane = new THREE.Object3D();
  reticlePlane.name = 'reticlePlane';
  reticlePlane.position.set(0, yc, front + 0.014);
  group.add(reticlePlane);

  return { group, reticle, sightAnchor, reticlePlane, glassR, back, front, yc };
}

/** Buffer tube / receiver extension with adjustment notches, plus a stock that slides on it. */
function buildStock(asm, cfg) {
  const z0 = cfg.z0; // front (at the receiver)
  const len = cfg.len || 0.215;
  const y = cfg.y || -0.001;
  const mat = cfg.mat || 'polymer';
  const tubeR = 0.0148;

  /* End plate + castle nut. Lathe profiles are authored rear-to-front so z descends.
     The castle nut is the fastener that most obviously says "this weapon was assembled": six
     staking notches round its rim, a stepped shoulder, and a separate end plate behind it
     carrying a QD sling socket. It was a plain cone; a cone at this scale reads as a shadow. */
  asm.add(latheZ([[0.0140, z0 + 0.0028], [0.0196, z0 + 0.0022], [0.0196, z0 - 0.0004]], 14), 'gunmetal', {
    p: [0, y, 0],
  });
  // Ambidextrous end-plate lobe carrying a QD socket, axis across the weapon.
  asm.add(chamferBox(0.0080, 0.0145, 0.0062, { r: 0.0024, bevel: 0.0013, curveSegments: 3 }), 'gunmetal', {
    p: [-0.0172, y + 0.002, z0 + 0.0016],
  });
  addQdSocket(asm, { rad: 0.005, p: [-0.0206, y + 0.002, z0 + 0.0016], r: [0, -Math.PI * 0.5, 0] });
  asm.add(latheZ([[0.0166, z0 + 0.0118], [0.0192, z0 + 0.0112], [0.0192, z0 + 0.0038], [0.0166, z0 + 0.0032]], 16), 'worn', {
    p: [0, y, 0],
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    asm.add(chamferBox(0.0022, 0.0034, 0.0072, { r: 0.0007, bevel: 0.0005, curveSegments: 2 }), 'cavity', {
      p: [Math.cos(a) * 0.0188, y + Math.sin(a) * 0.0188, z0 + 0.0075],
      r: [0, 0, a + Math.PI * 0.5],
    });
  }
  // Buffer tube.
  asm.add(latheZ([[1e-4, z0 + len + 0.004], [tubeR * 0.94, z0 + len + 0.004], [tubeR, z0 + len], [tubeR, z0 + 0.010]], 18), 'gunmetal', {
    p: [0, y, 0],
  });
  // Adjustment notches along the underside of the tube.
  const notches = cfg.notches || 6;
  for (let i = 0; i < notches; i++) {
    const zz = z0 + 0.042 + i * ((len - 0.062) / (notches - 1));
    asm.add(chamferBox(0.0105, 0.0062, 0.0072, { r: 0.0014, bevel: 0.0009, curveSegments: 2 }), 'cavity', {
      p: [0, y - tubeR + 0.0018, zz],
    });
  }
  /* Anti-rotation rib along the *top* of the extension, with the position index stamped into
     it. Checked against the player's actual viewpoint rather than an orbit view: from the hip
     pose the buffer tube is a 200 mm cylinder running out of the bottom-right of the frame
     with nothing on it, because every feature it had — the notches, the sling loops, the
     release lever — is on the underside where the camera never goes. This rib and the two
     index rings below are the only things that break that run, and they are the difference
     between a stock and a length of pipe. */
  asm.add(chamferBox(0.0068, 0.0042, len - 0.030, { r: 0.0014, bevel: 0.001, curveSegments: 3 }), 'gunmetal', {
    p: [0, y + tubeR - 0.0008, z0 + 0.014 + (len - 0.030) * 0.5],
  });
  asm.addMirrored(() => microPlate(0.0011, 0.0011, len - 0.036), 'worn', {
    p: [0.0031, y + tubeR + 0.0012, z0 + 0.014 + (len - 0.030) * 0.5],
    r: [0, 0, Math.PI * 0.25],
  });
  for (let i = 0; i < notches; i += 2) {
    const zz = z0 + 0.042 + i * ((len - 0.062) / (notches - 1));
    asm.add(microPlate(0.0026, 0.0016, 0.0026), 'worn', { p: [0, y + tubeR + 0.0021, zz] });
  }
  for (const rz of [z0 + 0.030, z0 + len - 0.020]) {
    asm.add(latheZ([[tubeR * 1.06, rz + 0.0022], [tubeR * 1.06, rz - 0.0022]], 16), 'gunmetal', { p: [0, y, 0] });
  }

  if (cfg.folding) {
    // Vector-style folding stock: a thin strut frame rather than a solid body.
    asm.addMirrored(() => chamferBox(0.0068, 0.0135, len * 0.72, { r: 0.0022, bevel: 0.0014, curveSegments: 3 }), 'gunmetal', {
      p: [0.0125, y + 0.006, z0 + len * 0.50],
      r: [0.03, 0, 0],
    });
    asm.add(chamferBoxX(0.034, 0.012, 0.014, { r: 0.0032, bevel: 0.0018 }), 'gunmetal', {
      p: [0, y + 0.010, z0 + len * 0.86],
    });
    asm.add(chamferBoxY(0.036, 0.050, 0.016, { r: 0.0055, bevel: 0.0025 }), 'rubber', {
      p: [0, y + 0.002, z0 + len * 0.93],
      r: [-0.06, 0, 0],
    });
  } else {
    // Collapsible stock body.
    asm.add(chamferBox(0.040, 0.052, len * 0.50, { r: 0.0085, bevel: 0.0032, curveSegments: 5 }), mat, {
      p: [0, y - 0.004, z0 + len * 0.66],
    });
    // Cheek riser, raised for the optic height-over-bore.
    asm.add(chamferBox(0.030, 0.016, len * 0.42, { r: 0.006, bevel: 0.0026, curveSegments: 4 }), mat, {
      p: [0, y + 0.030, z0 + len * 0.64],
      r: [-0.03, 0, 0],
    });
    asm.add(chamferBox(0.026, 0.0055, len * 0.36, { r: 0.0022, bevel: 0.0016, curveSegments: 3 }), 'rubber', {
      p: [0, y + 0.039, z0 + len * 0.64],
      r: [-0.03, 0, 0],
    });
    // Release lever underneath.
    asm.add(chamferBox(0.014, 0.0165, 0.030, { r: 0.0032, bevel: 0.0018 }), mat, {
      p: [0, y - 0.032, z0 + len * 0.60],
      r: [0.18, 0, 0],
    });
    // Sling loops both sides.
    asm.addMirrored(() => ring(0.0062, 0.0018, 10, 5), 'gunmetal', {
      p: [0.0205, y - 0.012, z0 + len * 0.50],
      r: [0, Math.PI * 0.5, 0],
    });
  }

  // Buttpad: ribbed rubber, the softest thing on the gun.
  const padZ = z0 + len + (cfg.folding ? -0.005 : 0.012);
  asm.add(chamferBoxY(0.044, 0.062, 0.019, { r: 0.008, bevel: 0.0035, curveSegments: 5 }), 'rubber', {
    p: [0, y - 0.004, padZ],
    r: [-0.10, 0, 0],
  });
  for (let i = 0; i < 4; i++) {
    asm.add(chamferBoxX(0.040, 0.0026, 0.0038, { r: 0.0009, bevel: 0.0007, curveSegments: 2 }), 'rubber', {
      p: [0, y + 0.020 - i * 0.014, padZ + 0.0095],
      r: [-0.10, 0, 0],
    });
  }
}

/* ========================================================================== */
/* Weapon model builders                                                      */
/* ========================================================================== */

/**
 * Common receiver core shared by all three. Returns the animated part meshes; the static
 * primitives go straight into `asm`.
 *
 * Local frame convention for every weapon: bore axis is Z at y = 0, muzzle towards -Z,
 * the origin sits at the rear face of the upper receiver.
 */
function buildReceiver(asm, mats, cfg) {
  const upperZ0 = cfg.upperZ0; // rear
  const upperZ1 = cfg.upperZ1; // front
  const upW = cfg.width || 0.0385;
  const upH = cfg.height || 0.040;
  const upLen = upperZ0 - upperZ1;

  /* --- Upper receiver ---------------------------------------------------- */
  asm.add(chamferBox(upW, upH, upLen, { r: 0.0072, bevel: 0.0028, curveSegments: 5 }), 'gunmetal', {
    p: [0, upH * 0.5 - 0.0135, (upperZ0 + upperZ1) * 0.5],
  });
  /* Top rail. Tooth *pitch* is a viewmodel-scale decision, not an accuracy one: a real
     1913 rail is 10.2 mm pitch with a 5.35 mm slot, and at 0.88 model scale 0.4 m from a
     60° camera that slot lands on 3-4 px — below what the sharpen and chromatic passes can
     carry, which is why the rail resolved as red/green fringed speckle instead of slots.
     16.8 mm pitch with a 7 mm slot keeps every feature over 10 px and still reads as
     picatinny; the bevels go up with it so the tooth edges are a highlight, not an alias. */
  const railPitch = 0.0168;
  const teeth = Math.max(3, Math.round(upLen / railPitch));
  asm.add(chamferBox(0.0215, 0.0055, upLen - 0.004, { r: 0.0018, bevel: 0.0013, curveSegments: 3 }), 'rail', {
    p: [0, upH - 0.0135 + 0.0015, (upperZ0 + upperZ1) * 0.5],
  });
  const railY = upH - 0.0135;
  for (let t = 0; t < teeth; t++) {
    const zz = upperZ0 - 0.008 - (upLen - 0.016) * (t / Math.max(1, teeth - 1));
    asm.add(chamferBox(0.0206, 0.0046, 0.0098, { r: 0.0019, bevel: 0.0016, curveSegments: 3 }), 'rail', {
      p: [0, railY + 0.0062, zz],
    });
    // T-marks: the numbered index scale down the side of a flat-top rail. Every third slot.
    if (t % 3 === 0) {
      asm.add(microPlate(0.0009, 0.0022, 0.0009), 'worn', {
        p: [-0.0104, railY + 0.0058, zz],
      });
    }
  }
  /* Broken edges. Two 1.3 mm slivers of bare alloy at 45° along the top corners of the
     receiver and two more along the rail's outer edges. At the art-directed 8° key rake a
     square corner returns nothing at all; these four lines are most of what separates the
     receiver from the rail in silhouette, and they are physically what a rifle that has been
     in and out of a plate carrier actually looks like. */
  asm.addMirrored(() => microPlate(0.0016, 0.0016, upLen - 0.008), 'worn', {
    p: [upW * 0.5 - 0.0009, railY - 0.0009, (upperZ0 + upperZ1) * 0.5],
    r: [0, 0, Math.PI * 0.25],
  });
  asm.addMirrored(() => microPlate(0.0012, 0.0012, upLen - 0.01), 'worn', {
    p: [0.0102, railY + 0.0084, (upperZ0 + upperZ1) * 0.5],
    r: [0, 0, Math.PI * 0.25],
  });
  /* Rail cover over the rear section, behind the optic, where the shooter's hand and cheek
     both come into contact with the teeth. */
  asm.add(railCoverGeo(upLen * 0.20, 0.0212), 'polymer', {
    p: [0, railY + 0.0074, upperZ0 - 0.010 - upLen * 0.10],
  });
  /* Model / calibre roll-mark on the left of the upper, forward of the port. Not legible and
     not meant to be — see stencilGeo. */
  asm.add(stencilGeo({ w: 0.030, h: 0.0078, rows: 2, seed: 4 }), 'gunmetal', {
    p: [-upW * 0.5 - 0.0002, 0.002, upperZ0 - 0.062],
    r: [0, -Math.PI * 0.5, 0],
  });

  // Brass deflector and forward assist — the two lumps that make an AR silhouette read.
  asm.add(
    chamferBox(0.011, 0.020, 0.026, { r: 0.0042, bevel: 0.0022, curveSegments: 4 }),
    'gunmetal',
    { p: [upW * 0.5 - 0.001, 0.004, upperZ0 - 0.030], r: [0, 0, -0.28] }
  );
  asm.add(latheZ([[0.0068, upperZ0 - 0.026], [0.0068, upperZ0 - 0.040], [0.0052, upperZ0 - 0.044]], 12), 'gunmetal', {
    p: [upW * 0.5 - 0.002, -0.004, 0],
    r: [0, -0.16, 0],
  });
  // Forward assist head: serrated, and hammered bare by a thumb. Knurl band + a bright face.
  asm.add(knurlGeo(0.0069, 0.010, 12, 0.0009), 'worn', {
    p: [upW * 0.5 + 0.0035, -0.004, upperZ0 - 0.033],
    r: [0, Math.PI * 0.5, 0],
  });

  /* --- Ejection port: recess + separate hinged dust cover ------------------ */
  const portZ = upperZ0 - 0.040;
  asm.add(chamferBox(0.0026, 0.019, 0.040, { r: 0.0022, bevel: 0.0012, curveSegments: 3 }), 'cavity', {
    p: [upW * 0.5 - 0.0022, 0.0015, portZ],
  });
  /* Carbon wash trailing aft and down from the port lip. Every round that leaves the gun
     drags gas across this exact patch, and it is the one piece of staining a shooter never
     scrubs off. It sits *behind* the cover so it only shows when the cover is open. */
  asm.add(microPlate(0.0012, 0.014, 0.03), 'carbon', {
    p: [upW * 0.5 - 0.0006, -0.004, portZ + 0.022],
    r: [0, 0, -0.16],
  });
  const dustCover = new THREE.Mesh(
    bakeVertexTint(
      mergeLocal([
        chamferBox(0.0032, 0.0205, 0.0425, { r: 0.0026, bevel: 0.0014, curveSegments: 3 }),
        // Longitudinal stiffening ribs — a real dust cover is a stamping, not a slab.
        place(microPlate(0.0014, 0.0022, 0.0385), [0.0021, 0.0052, 0]),
        place(microPlate(0.0014, 0.0022, 0.0385), [0.0021, -0.0052, 0]),
        // Spring detent boss standing proud of the outer face, near the rear edge.
        place(
          latheZ([[0.0026, 0.0016], [0.0026, -0.0006], [0.0018, -0.001]], 8),
          [0.0024, 0, 0.0192],
          [0, Math.PI * 0.5, 0]
        ),
      ]),
      { grain: 0.07, wear: 0.13 }
    ),
    mats.gunmetal
  );
  dustCover.name = 'dustCover';
  dustCover.frustumCulled = false;
  // Pivot lives at the bottom edge of the port so the cover swings down and out.
  const dustPivot = new THREE.Object3D();
  dustPivot.position.set(upW * 0.5 - 0.0005, -0.0085, portZ);
  dustCover.position.set(0, 0.0105, 0);
  dustPivot.add(dustCover);

  /* --- Bolt carrier (visible through the port when it cycles) -------------- */
  const bolt = new THREE.Mesh(
    bakeVertexTint(
      mergeGeometries(
        [
          (() => {
            const g = latheZ([[0.0092, portZ + 0.018], [0.0092, portZ - 0.020], [0.0072, portZ - 0.024]], 14);
            return g.index ? g.toNonIndexed() : g;
          })(),
          (() => {
            const g = chamferBox(0.0075, 0.0075, 0.030, { r: 0.0018, bevel: 0.0011, curveSegments: 3 });
            g.translate(0.0, 0.0085, portZ - 0.002);
            return g.index ? g.toNonIndexed() : g;
          })(),
        ],
        false
      ) || latheZ([[0.0092, portZ + 0.018], [0.0092, portZ - 0.020]], 14),
      { grain: 0.05, wear: 0.2 }
    ),
    mats.worn
  );
  bolt.name = 'bolt';
  bolt.frustumCulled = false;

  /* --- Charging handle ----------------------------------------------------
     Everything a hand repeatedly closes on ends up bare, and this is the clearest case on the
     weapon: the latch and the extended paddle are gripped hard, wet, in gloves, thousands of
     times. They are `worn` (bright steel, roughness 0.15), the shaft behind them stays
     anodised, and the paddle carries a knurled face so the wear has texture to sit on rather
     than being a lighter shade of the same slab. */
  const chY = upH - 0.0135;
  const chAsm = new Assembly();
  chAsm.add(chamferBox(0.030, 0.0095, 0.052, { r: 0.0022, bevel: 0.0015, curveSegments: 3 }), 'gunmetal', {
    p: [0, chY - 0.005, upperZ0 - 0.020],
  });
  // Roll pin retaining the latch, and the shaft's own broken edges.
  chAsm.add(latheZ([[0.0011, 0.008], [0.0011, -0.008]], 6), 'worn', {
    p: [-0.0085, chY - 0.005, upperZ0 - 0.006],
    r: [0, Math.PI * 0.5, 0],
  });
  chAsm.add(chamferBox(0.014, 0.0135, 0.020, { r: 0.0032, bevel: 0.0018, curveSegments: 3 }), 'worn', {
    p: [-0.0155, chY - 0.006, upperZ0 + 0.001],
    r: [0, 0, 0.16],
  });
  chAsm.add(chamferBoxX(0.020, 0.0075, 0.0075, { r: 0.0018, bevel: 0.0012, curveSegments: 2 }), 'worn', {
    p: [-0.0225, chY - 0.006, upperZ0 + 0.001],
  });
  // Knurled grip face on the paddle — five ridges across the pull surface.
  for (let i = 0; i < 5; i++) {
    chAsm.add(microPlateX(0.019, 0.0011, 0.0013), 'worn', {
      p: [-0.0225, chY - 0.0102 + i * 0.0021, upperZ0 + 0.0048],
      r: [0.28, 0, 0],
    });
  }
  const chargingHandle = chAsm.build(mats, { worn: { grain: 0.05, wear: 0.22 } });
  chargingHandle.name = 'chargingHandle';

  /* --- Lower receiver, magwell, controls ---------------------------------- */
  const lowZ0 = cfg.lowerZ0;
  const lowZ1 = cfg.lowerZ1;
  asm.add(chamferBox(upW * 0.94, 0.028, lowZ0 - lowZ1, { r: 0.0062, bevel: 0.0026, curveSegments: 5 }), 'gunmetal', {
    p: [0, -0.0265, (lowZ0 + lowZ1) * 0.5],
  });
  // Magwell: a flared funnel built from two nested chamfered shells.
  const mw = cfg.magwell;
  asm.add(chamferBoxY(mw.w + 0.0075, mw.h, mw.d + 0.0075, { r: 0.0062, bevel: 0.0028, curveSegments: 5 }), 'gunmetal', {
    p: [0, -0.0265 - mw.h * 0.5 + 0.004, mw.z],
    r: [mw.tilt || 0, 0, 0],
  });
  asm.add(chamferBoxY(mw.w + 0.0125, 0.010, mw.d + 0.0125, { r: 0.0055, bevel: 0.0026, curveSegments: 5 }), 'gunmetal', {
    p: [0, -0.0265 - mw.h + 0.004, mw.z + (mw.tilt || 0) * mw.h],
    r: [mw.tilt || 0, 0, 0],
  });
  asm.add(chamferBoxY(mw.w, mw.h * 0.92, mw.d, { r: 0.0048, bevel: 0.0022, curveSegments: 4 }), 'cavity', {
    p: [0, -0.0265 - mw.h * 0.5 + 0.006, mw.z],
    r: [mw.tilt || 0, 0, 0],
  });
  /* Magwell mouth. The flare is the part that eats every magazine that misses on a speed
     reload, so its lip is bare all the way round; a thin `worn` band there is both the wear
     story and the bevel highlight that stops the funnel reading as a solid block. */
  asm.add(
    chamferBoxY(mw.w + 0.0135, 0.0018, mw.d + 0.0135, { r: 0.0055, bevel: 0.0008, curveSegments: 5 }),
    'worn',
    { p: [0, -0.0265 - mw.h - 0.0006, mw.z + (mw.tilt || 0) * mw.h], r: [mw.tilt || 0, 0, 0] }
  );
  /* Takedown and pivot pins. Both get a knurled head so the shooter can turn them and a
     recessed detent face, which is a lot of read for four small primitives — a plain disc on
     the side of a receiver reads as a decal, a knurled one reads as a fastener. */
  for (const pz of [lowZ0 - 0.014, lowZ1 + 0.010]) {
    for (const sgn of [1, -1]) {
      const rot = [0, sgn * Math.PI * 0.5, 0];
      asm.add(latheZ([[0.0046, 0.0004], [0.0046, -0.0022], [0.0036, -0.0028]], 10), 'worn', {
        p: [sgn * upW * 0.47, -0.0245, pz],
        r: rot,
      });
      asm.add(knurlGeo(0.0044, 0.0022, 14, 0.0007), 'worn', {
        p: [sgn * (upW * 0.47 + 0.0009), -0.0245, pz],
        r: rot,
      });
      asm.add(latheZ([[0.0021, 0.0007], [0.0021, -0.0004], [1e-4, -0.0006]], 8), 'cavity', {
        p: [sgn * (upW * 0.47 + 0.0016), -0.0245, pz],
        r: rot,
      });
    }
  }
  /* Serial plate on the left of the magwell — the one panel every receiver in the world
     carries, in the one place the law puts it. */
  asm.add(stencilGeo({ w: 0.024, h: 0.0092, rows: 2, seed: 7 }), 'gunmetal', {
    p: [-(mw.w + 0.0075) * 0.5 - 0.0002, -0.0265 - mw.h * 0.52, mw.z + 0.001],
    r: [0, -Math.PI * 0.5, 0],
  });
  // Bolt catch (left) and magazine release (right).
  asm.add(chamferBox(0.0062, 0.0115, 0.030, { r: 0.0018, bevel: 0.0012, curveSegments: 3 }), 'worn', {
    p: [-upW * 0.5 + 0.001, -0.021, lowZ1 + 0.018],
    r: [0, 0, 0.05],
  });
  // Serrations across the bolt-catch paddle.
  for (let i = 0; i < 4; i++) {
    asm.add(microPlate(0.0011, 0.0095, 0.0011), 'worn', {
      p: [-upW * 0.5 - 0.0018, -0.021, lowZ1 + 0.0295 - i * 0.0032],
    });
  }
  /* Magazine release. Hit by the shooter's trigger-finger knuckle on every reload, so the
     button face is one of the four brightest spots on the weapon; it gets a checkered face and
     a fence around it. */
  asm.add(latheZ([[0.0056, 0], [0.0056, -0.0055], [0.0042, -0.0062]], 10), 'worn', {
    p: [upW * 0.5 - 0.001, -0.021, lowZ1 + 0.026],
    r: [0, -Math.PI * 0.5, 0],
  });
  asm.add(knurlGeo(0.0035, 0.0018, 10, 0.0009), 'worn', {
    p: [upW * 0.5 + 0.0046, -0.021, lowZ1 + 0.026],
    r: [0, -Math.PI * 0.5, 0],
  });
  asm.add(latheZ([[0.0076, 0.0006], [0.0076, -0.0038], [0.0064, -0.0042]], 12), 'gunmetal', {
    p: [upW * 0.5 - 0.0016, -0.021, lowZ1 + 0.026],
    r: [0, -Math.PI * 0.5, 0],
  });
  // Trigger-pin bosses, with the two real pins through them.
  asm.add(chamferBoxX(upW * 0.98, 0.014, 0.020, { r: 0.0034, bevel: 0.0018 }), 'gunmetal', {
    p: [0, -0.030, lowZ1 + 0.044],
  });
  for (const pz of [lowZ1 + 0.038, lowZ1 + 0.050]) {
    for (const sgn of [1, -1]) {
      asm.add(latheZ([[0.0021, 0.0004], [0.0021, -0.0009], [0.0015, -0.0012]], 8), 'worn', {
        p: [sgn * upW * 0.48, -0.030, pz],
        r: [0, sgn * Math.PI * 0.5, 0],
      });
    }
  }

  /* --- Safety selector (animated: rotates to FIRE when the trigger is live) - */
  const selAsm = new Assembly();
  selAsm.add(chamferBox(0.0075, 0.0075, 0.024, { r: 0.0022, bevel: 0.0013, curveSegments: 3 }), 'worn', {
    p: [0, 0, 0.008],
  });
  selAsm.add(chamferBoxX(0.020, 0.0062, 0.0075, { r: 0.0018, bevel: 0.0011, curveSegments: 2 }), 'worn', {
    p: [-0.010, 0, 0.018],
  });
  const selector = selAsm.build(mats, {});
  selector.name = 'selector';
  selector.position.set(-upW * 0.5 + 0.002, -0.0205, lowZ1 + 0.036);
  selector.rotation.y = -Math.PI * 0.5;

  // Selector markings.
  asm.add(chamferBox(0.0038, 0.0038, 0.0012, { r: 0.0008, bevel: 0.0005, curveSegments: 2 }), 'marking', {
    p: [-upW * 0.5 + 0.0002, -0.0125, lowZ1 + 0.036],
    r: [0, Math.PI * 0.5, 0],
  });

  return { dustPivot, dustCover, bolt, chargingHandle, selector, portZ, upW, upH };
}

/** Assemble the mk18 carbine. */
function buildMk18(mats) {
  const asm = new Assembly();
  const group = new THREE.Group();
  group.name = 'mk18';

  const rec = buildReceiver(asm, mats, {
    upperZ0: 0.012,
    upperZ1: -0.180,
    lowerZ0: 0.008,
    lowerZ1: -0.108,
    width: 0.0385,
    height: 0.040,
    magwell: { w: 0.028, h: 0.048, d: 0.040, z: -0.062, tilt: 0.10 },
  });

  // Barrel: chamber shoulder, taper under the handguard, thin profile out front.
  asm.add(
    latheZ(
      [
        [0.0132, -0.150],
        [0.0132, -0.198],
        [0.0112, -0.206],
        [0.0112, -0.262],
        [0.0092, -0.270],
        [0.0092, -0.372],
        [0.0106, -0.376],
        [0.0106, -0.404],
        [0.0092, -0.410],
        [0.0092, -0.470],
        [0.0104, -0.474],
        [0.0104, -0.486],
      ],
      18
    ),
    'steel',
    null
  );
  buildGasBlock(asm, { z: -0.352, tubeZ: -0.200 });
  buildFrontSight(asm, { z: -0.352, y: 0.0112 });
  buildHandguard(asm, { z0: -0.196, z1: -0.418, r: 0.0248, ribs: 7, mat: 'polymer' });
  buildMuzzle(asm, { z: -0.486, r: 0.0118, len: 0.056, bore: 0.0040, ports: 5 });
  buildPistolGrip(asm, { z: -0.006, y: -0.040, rake: 0.30, len: 0.090, w: 0.029, mat: 'grip' });
  buildStock(asm, { z0: 0.012, len: 0.212, notches: 6, mat: 'polymer' });

  // Rear backup iron sight, folded down behind the optic.
  asm.add(chamferBox(0.020, 0.0135, 0.016, { r: 0.0028, bevel: 0.0016, curveSegments: 3 }), 'gunmetal', {
    p: [0, 0.031, -0.010],
    r: [-0.9, 0, 0],
  });
  // Sling loop on the receiver end plate.
  asm.add(ring(0.0068, 0.0019, 10, 5), 'gunmetal', { p: [-0.017, -0.004, 0.014], r: [0, Math.PI * 0.5, 0] });

  const trigger = buildTriggerGroup(asm, mats, { z: -0.058, y: -0.026, w: 0.0125 });
  const optic = buildOptic(mats, { kind: 'reddot', z: -0.062, y: 0.0555 });

  const stat = asm.build(mats, {
    gunmetal: { grain: 0.075, wear: 0.10, dust: 0.10 },
    // The rail takes the heaviest wear term of anything on the gun: mounts clamping onto the
    // slot corners polish them back to bright metal, and that band of brighter edges is what
    // makes machined aluminium read as machined aluminium.
    rail: { grain: 0.06, wear: 0.30, dust: 0.08 },
    polymer: { grain: 0.11, wear: 0.06, dust: 0.09 },
    grip: { grain: 0.16, wear: 0.05, grime: 0.16 },
    steel: { grain: 0.055, wear: 0.14, dust: 0.07 },
    /* `worn` is bare steel and picks up no dust film at all — a surface that is being
       rubbed clean every day is exactly the surface ash cannot settle on. `carbon` gets
       almost no grain because soot is a smooth even deposit, and no wear term at all. */
    worn: { grain: 0.05, wear: 0.26 },
    carbon: { grain: 0.04, wear: 0.0, gain: 0.9 },
    polymerWorn: { grain: 0.06, wear: 0.16, grime: 0.1 },
  });
  group.add(stat, optic.group, rec.dustPivot, rec.bolt, rec.chargingHandle, rec.selector, trigger);

  const mag = buildMagazineMesh(mats, { len: 0.108, w: 0.0235, d: 0.034, curve: 0.34, segs: 6, mat: 'polymer' });
  mag.position.set(0, -0.0745, -0.062);
  mag.rotation.x = 0.10;
  group.add(mag);

  return {
    group,
    parts: {
      mag,
      magHome: mag.position.clone(),
      magRotHome: mag.rotation.x,
      bolt: rec.bolt,
      dustPivot: rec.dustPivot,
      chargingHandle: rec.chargingHandle,
      selector: rec.selector,
      trigger,
      optic,
    },
    anchors: {
      muzzle: [0, 0, -0.540],
      eject: [0.024, 0.006, rec.portZ],
      ejectDir: [0.86, 0.44, 0.26],
      gripFire: [0, -0.052, -0.014],
      /* C-clamp on the handguard, solved rather than eyeballed. In the support hand's own
         frame the fingers wrap a circle centred 46 mm forward of and 36 mm below the palm
         origin; converting that back through the anchor rotation and the 0.88 model scale
         puts the anchor here, which lands the palm's metacarpal edge tangent to the 21.8 mm
         (world) handguard and closes the fingertips on its far side. */
      gripSupport: [-0.052, -0.041, -0.300],
      boltCatch: [-0.026, -0.022, -0.090],
      sight: [0, optic.sightAnchor.position.y, optic.sightAnchor.position.z],
      magGrab: [-0.028, -0.055, 0.004],
    },
  };
}

/** Assemble the vector SMG: short, boxy, top-heavy, folding stock. */
function buildVector(mats) {
  const asm = new Assembly();
  const group = new THREE.Group();
  group.name = 'vector';

  const rec = buildReceiver(asm, mats, {
    upperZ0: 0.020,
    upperZ1: -0.168,
    lowerZ0: 0.014,
    lowerZ1: -0.120,
    width: 0.0425,
    height: 0.044,
    magwell: { w: 0.024, h: 0.038, d: 0.030, z: -0.086, tilt: 0.03 },
  });

  // Slab-sided polymer chassis over the receiver — this is what makes it read as an SMG.
  asm.addMirrored(() => chamferBox(0.0055, 0.052, 0.170, { r: 0.0055, bevel: 0.0024, curveSegments: 4 }), 'tan', {
    p: [0.0225, -0.002, -0.072],
  });
  asm.add(chamferBox(0.048, 0.0075, 0.150, { r: 0.0045, bevel: 0.0022, curveSegments: 4 }), 'tan', {
    p: [0, -0.0275, -0.070],
  });

  // Short barrel and shroud.
  asm.add(
    latheZ(
      [
        [0.0122, -0.140],
        [0.0122, -0.186],
        [0.0092, -0.192],
        [0.0092, -0.276],
        [0.0102, -0.280],
        [0.0102, -0.292],
      ],
      16
    ),
    'steel',
    null
  );
  buildHandguard(asm, { z0: -0.184, z1: -0.290, r: 0.0225, ribs: 6, mat: 'tan' });
  buildMuzzle(asm, { z: -0.292, r: 0.0106, len: 0.040, bore: 0.0038, ports: 4 });
  buildPistolGrip(asm, { z: -0.026, y: -0.044, rake: 0.24, len: 0.086, w: 0.030, mat: 'grip' });
  buildStock(asm, { z0: 0.020, len: 0.170, folding: true, mat: 'tan' });

  // Forward vertical grip — the support hand wraps this, not the handguard.
  asm.add(chamferBoxY(0.023, 0.062, 0.028, { r: 0.0058, bevel: 0.0026, curveSegments: 4 }), 'grip', {
    p: [0, -0.056, -0.248],
    r: [0.12, 0, 0],
  });
  for (let i = 0; i < 3; i++) {
    asm.add(ring(0.0082, 0.0030, 10, 5), 'grip', {
      p: [0, -0.042 - i * 0.017, -0.248 + 0.0018 * i],
      r: [Math.PI * 0.5, 0, 0],
      s: [1.35, 1, 1],
    });
  }
  // Sling loops.
  asm.addMirrored(() => ring(0.0062, 0.0018, 10, 5), 'gunmetal', {
    p: [0.0225, -0.020, -0.010],
    r: [0, Math.PI * 0.5, 0],
  });

  const trigger = buildTriggerGroup(asm, mats, { z: -0.076, y: -0.030, w: 0.0125 });
  const optic = buildOptic(mats, { kind: 'reddot', z: -0.056, y: 0.0585 });

  const stat = asm.build(mats, {
    gunmetal: { grain: 0.07, wear: 0.11, dust: 0.10 },
    rail: { grain: 0.06, wear: 0.30, dust: 0.08 },
    tan: { grain: 0.13, wear: 0.09, dust: 0.12 },
    grip: { grain: 0.17, wear: 0.05, grime: 0.16 },
    steel: { grain: 0.055, wear: 0.15, dust: 0.07 },
    /* `worn` is bare steel and picks up no dust film at all — a surface that is being
       rubbed clean every day is exactly the surface ash cannot settle on. `carbon` gets
       almost no grain because soot is a smooth even deposit, and no wear term at all. */
    worn: { grain: 0.05, wear: 0.26 },
    carbon: { grain: 0.04, wear: 0.0, gain: 0.9 },
    polymerWorn: { grain: 0.06, wear: 0.16, grime: 0.1 },
  });
  group.add(stat, optic.group, rec.dustPivot, rec.bolt, rec.chargingHandle, rec.selector, trigger);

  const mag = buildMagazineMesh(mats, { len: 0.132, w: 0.0205, d: 0.026, curve: 0.10, segs: 6, mat: 'tan' });
  mag.position.set(0, -0.0665, -0.086);
  mag.rotation.x = 0.03;
  group.add(mag);

  return {
    group,
    parts: {
      mag,
      magHome: mag.position.clone(),
      magRotHome: mag.rotation.x,
      bolt: rec.bolt,
      dustPivot: rec.dustPivot,
      chargingHandle: rec.chargingHandle,
      selector: rec.selector,
      trigger,
      optic,
    },
    anchors: {
      muzzle: [0, 0, -0.332],
      eject: [0.026, 0.008, rec.portZ],
      ejectDir: [0.90, 0.38, 0.20],
      gripFire: [0, -0.056, -0.034],
      /* The vector's support hand is on a vertical foregrip, so the C-clamp does not apply:
         roll the wrist a quarter turn so the palm faces the grip from the left and pitch it
         so the fingers wrap forward around it. */
      gripSupport: [-0.034, -0.052, -0.232],
      gripSupportRot: [Math.PI * 0.5, 0, -Math.PI * 0.5],
      boltCatch: [-0.028, -0.024, -0.100],
      sight: [0, optic.sightAnchor.position.y, optic.sightAnchor.position.z],
      magGrab: [-0.028, -0.070, 0.002],
    },
  };
}

/** Assemble the dmr14 marksman rifle: long, wooden furniture, LPVO. */
function buildDmr14(mats) {
  const asm = new Assembly();
  const group = new THREE.Group();
  group.name = 'dmr14';

  const rec = buildReceiver(asm, mats, {
    upperZ0: 0.030,
    upperZ1: -0.208,
    lowerZ0: 0.026,
    lowerZ1: -0.118,
    width: 0.0405,
    height: 0.046,
    magwell: { w: 0.031, h: 0.050, d: 0.046, z: -0.066, tilt: 0.14 },
  });

  // Long, heavy fluted barrel.
  asm.add(
    latheZ(
      [
        [0.0158, -0.176],
        [0.0158, -0.230],
        [0.0132, -0.238],
        [0.0132, -0.360],
        [0.0116, -0.368],
        [0.0116, -0.520],
        [0.0104, -0.528],
        [0.0104, -0.604],
        [0.0118, -0.610],
        [0.0118, -0.624],
      ],
      20
    ),
    'steel',
    null
  );
  // Flutes: six shallow cavity channels down the barrel.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    asm.add(chamferBox(0.0038, 0.0038, 0.120, { r: 0.0012, bevel: 0.0008, curveSegments: 2 }), 'cavity', {
      p: [Math.cos(a) * 0.0122, Math.sin(a) * 0.0122, -0.300],
      r: [0, 0, a],
    });
  }
  buildGasBlock(asm, { z: -0.470, tubeZ: -0.238 });
  buildFrontSight(asm, { z: -0.470, y: 0.0135 });
  buildMuzzle(asm, { z: -0.624, r: 0.0132, len: 0.072, bore: 0.0045, ports: 6 });

  /* --- Wooden furniture. The handguard is a two-piece walnut forend with steel bands and
         real vent slots cut as gaps between the upper and lower halves. ------ */
  const fgZ0 = -0.226;
  const fgZ1 = -0.462;
  const fgLen = fgZ0 - fgZ1;
  asm.add(chamferBox(0.046, 0.024, fgLen, { r: 0.0095, bevel: 0.0038, curveSegments: 5 }), 'wood', {
    p: [0, -0.020, (fgZ0 + fgZ1) * 0.5],
  });
  asm.add(chamferBox(0.043, 0.017, fgLen * 0.94, { r: 0.0085, bevel: 0.0034, curveSegments: 5 }), 'wood', {
    p: [0, 0.019, (fgZ0 + fgZ1) * 0.5],
  });
  // Vent slots: the gap between the halves, floored with cavity inserts.
  asm.addMirrored(() => chamferBox(0.0045, 0.0075, fgLen * 0.86, { r: 0.0014, bevel: 0.0009, curveSegments: 2 }), 'cavity', {
    p: [0.0195, 0.0022, (fgZ0 + fgZ1) * 0.5],
  });
  for (let i = 0; i < 4; i++) {
    const zz = fgZ0 - 0.026 - (fgLen - 0.052) * (i / 3);
    asm.addMirrored(() => chamferBox(0.0055, 0.0085, 0.014, { r: 0.0016, bevel: 0.001, curveSegments: 2 }), 'wood', {
      p: [0.0198, 0.0022, zz],
    });
  }
  // Steel barrel bands, each clamped by a real screw and each with a broken top edge.
  for (const bz of [fgZ0 - 0.010, fgZ1 + 0.012]) {
    asm.add(chamferBox(0.049, 0.050, 0.012, { r: 0.0068, bevel: 0.0026, curveSegments: 4 }), 'gunmetal', {
      p: [0, -0.0005, bz],
    });
    addScrew(asm, { rad: 0.0028, depth: 0.0018, seg: 10, p: [0, -0.0262, bz], r: [Math.PI * 0.5, 0, 0] });
    asm.addMirrored(() => microPlate(0.0014, 0.0014, 0.0112), 'worn', {
      p: [0.0238, 0.0238, bz],
      r: [0, 0, Math.PI * 0.25],
    });
  }
  /* The forend is where the support hand lives on a rifle with no vertical grip, so the wood
     under it is polished smooth and the sharp arris either side is rubbed pale. Both are
     material states, not painted patches: `polymerWorn` is a low-roughness dielectric and the
     arris runs in `worn`. */
  asm.addMirrored(() => chamferBox(0.0036, 0.0125, fgLen * 0.44, { r: 0.0012, bevel: 0.0009, curveSegments: 3 }), 'polymerWorn', {
    p: [0.0228, -0.020, (fgZ0 + fgZ1) * 0.5 + fgLen * 0.06],
  });
  // Cartouche stamped into the left of the forend.
  asm.add(stencilGeo({ w: 0.020, h: 0.0068, rows: 2, seed: 9 }), 'wood', {
    p: [-0.0232, -0.020, (fgZ0 + fgZ1) * 0.5 - fgLen * 0.22],
    r: [0, -Math.PI * 0.5, 0],
  });
  // Handguard top rail for the LPVO's forward reach and a sling swivel underneath.
  asm.add(ring(0.0072, 0.0021, 10, 5), 'gunmetal', { p: [0, -0.036, fgZ1 + 0.030], r: [0, Math.PI * 0.5, 0] });
  addQdSocket(asm, { rad: 0.005, p: [-0.0238, -0.020, fgZ1 + 0.050], r: [0, -Math.PI * 0.5, 0], mat: 'gunmetal' });

  /* --- Wooden thumbhole stock with a cheek riser -------------------------- */
  const stZ0 = 0.030;
  asm.add(chamferBox(0.044, 0.062, 0.150, { r: 0.0125, bevel: 0.0042, curveSegments: 5 }), 'wood', {
    p: [0, -0.014, stZ0 + 0.086],
    r: [-0.02, 0, 0],
  });
  asm.add(chamferBox(0.038, 0.024, 0.120, { r: 0.0072, bevel: 0.0032, curveSegments: 5 }), 'wood', {
    p: [0, 0.028, stZ0 + 0.092],
    r: [-0.05, 0, 0],
  });
  asm.add(chamferBox(0.030, 0.0062, 0.104, { r: 0.0026, bevel: 0.0018, curveSegments: 3 }), 'rubber', {
    p: [0, 0.041, stZ0 + 0.092],
    r: [-0.05, 0, 0],
  });
  // Comb adjustment posts.
  asm.addMirrored(() => latheY([[0.0026, 0], [0.0026, 0.020], [0.0018, 0.022]], 8), 'gunmetal', {
    p: [0.011, 0.014, stZ0 + 0.060],
  });
  // Buttpad.
  asm.add(chamferBoxY(0.046, 0.078, 0.020, { r: 0.010, bevel: 0.0038, curveSegments: 5 }), 'rubber', {
    p: [0, -0.012, stZ0 + 0.172],
    r: [-0.13, 0, 0],
  });
  // Sling swivel and a bipod stud under the forend.
  asm.add(ring(0.0068, 0.0020, 10, 5), 'gunmetal', { p: [0, -0.046, stZ0 + 0.146], r: [0, Math.PI * 0.5, 0] });

  buildPistolGrip(asm, { z: -0.012, y: -0.048, rake: 0.34, len: 0.094, w: 0.030, mat: 'wood' });

  const trigger = buildTriggerGroup(asm, mats, { z: -0.062, y: -0.030, w: 0.0135 });
  const optic = buildOptic(mats, { kind: 'lpvo', z: -0.052, y: 0.0625 });

  const stat = asm.build(mats, {
    gunmetal: { grain: 0.07, wear: 0.10, dust: 0.10 },
    rail: { grain: 0.06, wear: 0.30, dust: 0.08 },
    wood: { grain: 0.14, wear: 0.11, dust: 0.10 },
    grip: { grain: 0.16, wear: 0.05, grime: 0.16 },
    steel: { grain: 0.05, wear: 0.14, dust: 0.07 },
    /* `worn` is bare steel and picks up no dust film at all — a surface that is being
       rubbed clean every day is exactly the surface ash cannot settle on. `carbon` gets
       almost no grain because soot is a smooth even deposit, and no wear term at all. */
    worn: { grain: 0.05, wear: 0.26 },
    carbon: { grain: 0.04, wear: 0.0, gain: 0.9 },
    polymerWorn: { grain: 0.06, wear: 0.16, grime: 0.1 },
  });
  group.add(stat, optic.group, rec.dustPivot, rec.bolt, rec.chargingHandle, rec.selector, trigger);

  const mag = buildMagazineMesh(mats, { len: 0.100, w: 0.0265, d: 0.046, curve: 0.52, segs: 6, mat: 'polymer' });
  mag.position.set(0, -0.0775, -0.066);
  mag.rotation.x = 0.14;
  group.add(mag);

  return {
    group,
    parts: {
      mag,
      magHome: mag.position.clone(),
      magRotHome: mag.rotation.x,
      bolt: rec.bolt,
      dustPivot: rec.dustPivot,
      chargingHandle: rec.chargingHandle,
      selector: rec.selector,
      trigger,
      optic,
    },
    anchors: {
      muzzle: [0, 0, -0.700],
      eject: [0.026, 0.008, rec.portZ],
      ejectDir: [0.88, 0.42, 0.18],
      gripFire: [0, -0.058, -0.020],
      // Same C-clamp solve as the mk18, against the wooden forend's ~26 mm effective radius.
      gripSupport: [-0.053, -0.044, -0.308],
      boltCatch: [-0.028, -0.024, -0.100],
      sight: [0, optic.sightAnchor.position.y, optic.sightAnchor.position.z],
      magGrab: [-0.028, -0.052, 0.006],
    },
  };
}

/* ========================================================================== */
/* Arms                                                                       */
/* ========================================================================== */

/**
 * One gloved hand, posed in a fixed grip curl. Fingers are separate meshes.
 *
 * Local convention: the back of the hand faces +Y, the palm faces -Y, the fingers extend
 * along -Z and curl towards the palm. `cfg.wrap` is the radius of the thing being gripped:
 * it sets how far round the fingers travel, so the same builder produces a fist closed on a
 * 29 mm pistol grip and a hand opened out around a 50 mm handguard. `cfg.trigger` straightens
 * the index finger and lays it on the trigger instead of curling it into the palm.
 *
 * Materials are split three ways across the hand — leather palm and finger pads, woven
 * fabric back and gussets, moulded knuckle armour — because a single material over the whole
 * glove is precisely the "smooth Lambert gradient over a silhouette" this is 0.4 m from the
 * camera to avoid.
 */
function buildHand(mats, side, cfg) {
  const o = cfg || {};
  const asm = new Assembly();
  const s = side; // +1 = right, -1 = left
  const wrap = o.wrap !== undefined ? o.wrap : 0.016;
  /* Curl needed to lay the fingers around a cylinder of radius `wrap`, in *world* metres —
     the hands are not parented under the weapon holder, so they are at scale 1 while the
     gun is at ~0.88, and the wrap radius has to be quoted in the hands' own units. Tight on
     a 15 mm pistol grip, open on a 22 mm handguard. Calibrated so that at wrap = 0.026 the
     fingertip pads land within a millimetre of the cylinder surface rather than sticking
     out straight past it, which is what "no fingers that wrap anything" was describing. */
  const curlK = clamp(0.034 / (wrap + 0.010), 0.70, 1.40);

  // Palm: a chamfered wedge, thicker at the thenar side. Leather.
  asm.add(chamferBox(0.042, 0.026, 0.078, { r: 0.010, bevel: 0.0038, curveSegments: 5 }), 'glovePalm', {
    p: [0, 0, 0.006],
    r: [0, 0, 0],
  });
  // Fabric back panel over the palm block — this is the panel split that gives the glove a
  // visible seam line instead of one continuous surface.
  asm.add(chamferBox(0.0405, 0.0085, 0.070, { r: 0.0075, bevel: 0.0030, curveSegments: 5 }), 'glove', {
    p: [0, 0.0105, 0.004],
  });
  // Raised seam piping around the panel edge, one strip each side. It is 1.4 mm proud, which
  // is enough to catch the key and read as stitching at viewmodel magnification.
  asm.addMirrored(() => chamferBox(0.0026, 0.0034, 0.064, { r: 0.0011, bevel: 0.0008, curveSegments: 2 }), 'gloveHard', {
    p: [0.0198, 0.0072, 0.004],
  });
  // Back-of-hand knuckle guard.
  asm.add(chamferBox(0.040, 0.0075, 0.052, { r: 0.0055, bevel: 0.0026, curveSegments: 4 }), 'gloveHard', {
    p: [0, 0.0158, -0.004],
    r: [-0.10, 0, 0],
  });
  // Knuckle domes.
  for (let i = 0; i < 4; i++) {
    asm.add(latheY([[0.0055, 0], [0.0062, 0.0026], [0.0038, 0.0052], [1e-4, 0.0058]], 8), 'gloveHard', {
      p: [(-0.0145 + i * 0.0097) * s, 0.018, -0.028],
    });
  }
  // Wrist cuff transition: a rolled fabric band, so the glove ends in a cuff rather than a
  // polygonal cut where it meets the sleeve.
  asm.add(latheZ([[0.0215, 0.036], [0.0250, 0.030], [0.0255, 0.020], [0.0225, 0.016], [0.0205, 0.016]], 14), 'cuff', null);
  // Wrist closure strap across the back of the cuff.
  asm.add(chamferBox(0.040, 0.0040, 0.011, { r: 0.0016, bevel: 0.0010, curveSegments: 2 }), 'gloveHard', {
    p: [0, 0.0155, 0.026],
  });

  /* Four fingers, each two phalanges curled around whatever is being held.
     The index finger of a hand that has a trigger under it is built into its own group with
     its pivot at the metacarpophalangeal joint, because it is the one part of the rig that has
     to move independently on every single round. A trigger blade that travels while the finger
     lying on it stays rigid is one of the loudest tells in a first-person shooter and it is on
     screen for the whole match; two extra draw calls on the most-scrutinised object in the
     game is the right trade. */
  const fingerPivot = new THREE.Vector3();
  let fasm = null;
  for (let i = 0; i < 4; i++) {
    const fx = (-0.0148 + i * 0.0099) * s;
    // Wider splay than before so the fingers read as four separate digits rather than one
    // mitten — finger separation is explicitly what the silhouette was missing.
    const spread = (i - 1.5) * 0.085;
    const isTrigger = !!o.trigger && i === 0;
    // The trigger finger comes off the grip and lies almost straight along the trigger.
    const curl = isTrigger ? 0.3 : (1.02 + i * 0.06) * curlK;
    const r0 = 0.0062 - i * 0.0004;
    const yaw = isTrigger ? spread * s * 0.4 : spread * s;
    let tgt = asm;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (isTrigger) {
      fasm = new Assembly();
      tgt = fasm;
      // Knuckle: the rear end of the proximal phalanx at rest. Everything below is authored in
      // hand space and then shifted so the group's origin lands on it.
      fingerPivot.set(fx, -0.004, -0.031);
      ox = -fingerPivot.x;
      oy = -fingerPivot.y;
      oz = -fingerPivot.z;
    }
    // Proximal.
    tgt.add(chamferBox(r0 * 2, r0 * 2, 0.030, { r: r0 * 0.85, bevel: r0 * 0.4, curveSegments: 4 }), 'glove', {
      p: [fx + ox, -0.004 + oy, -0.046 + oz],
      r: [-curl * 0.55, yaw, 0],
    });
    // Distal, curled under.
    const pz = -0.046 - Math.cos(curl * 0.55) * 0.024;
    const py = -0.004 - Math.sin(curl * 0.55) * 0.026;
    tgt.add(chamferBox(r0 * 1.8, r0 * 1.8, 0.026, { r: r0 * 0.8, bevel: r0 * 0.38, curveSegments: 4 }), 'glove', {
      p: [fx + Math.sin(yaw) * 0.012 + ox, py + oy, pz + oz],
      r: [-curl * (isTrigger ? 1.05 : 1.32), yaw, 0],
    });
    // Reinforced fingertip pad — leather, like the palm, so the grip surfaces match.
    const dc = curl * (isTrigger ? 1.05 : 1.32);
    tgt.add(latheY([[0.0044, 0], [0.0048, 0.0022], [0.0028, 0.0044], [1e-4, 0.005]], 7), 'glovePalm', {
      p: [
        fx + Math.sin(yaw) * 0.02 + ox,
        py - Math.sin(dc) * 0.022 + oy,
        pz - Math.cos(dc) * 0.02 + oz,
      ],
      r: [-dc + Math.PI * 0.5, 0, 0],
    });
  }

  // Thumb: two segments wrapping the far side of the grip.
  asm.add(chamferBox(0.0135, 0.0125, 0.030, { r: 0.0052, bevel: 0.0024, curveSegments: 4 }), 'glove', {
    p: [-0.020 * s, -0.006, -0.020],
    r: [-0.42 * curlK, 0.62 * s, 0.30 * s],
  });
  asm.add(chamferBox(0.0118, 0.0110, 0.028, { r: 0.0046, bevel: 0.0022, curveSegments: 4 }), 'glovePalm', {
    p: [-0.030 * s, -0.010, -0.043],
    r: [-0.75 * curlK, 1.02 * s, 0.34 * s],
  });

  /* Vertex treatment per panel. The palm is polished by use and picks up no dust; the fabric
     back is dusty on top and grimy underneath; the cuff is the dirtiest thing on the rig. */
  const tint = {
    glove: { grain: 0.13, wear: 0.05, dust: 0.13, grime: 0.22 },
    glovePalm: { grain: 0.1, wear: 0.09, grime: 0.3 },
    gloveHard: { grain: 0.09, wear: 0.13, dust: 0.1 },
    cuff: { grain: 0.16, wear: 0.04, dust: 0.1, grime: 0.34 },
  };
  const handRoot = new THREE.Group();
  handRoot.name = side > 0 ? 'handR' : 'handL';
  handRoot.add(asm.build(mats, tint));

  let triggerFinger = null;
  if (fasm) {
    triggerFinger = fasm.build(mats, tint);
    triggerFinger.name = 'triggerFinger';
    triggerFinger.position.copy(fingerPivot);
    handRoot.add(triggerFinger);
  }
  return { group: handRoot, triggerFinger };
}

/**
 * A full arm: sleeve cuff + tapered forearm + upper arm + hand, ready for two-bone IK.
 *
 * `hand` is an empty Object3D that the IK writes to; the built mesh hangs off it with a
 * fixed local orientation. That indirection is what lets the support hand sit palm-up and
 * across the handguard (fingers running perpendicular to the bore, wrapping the ribs) while
 * the firing hand keeps the palm-down, fingers-forward pose a pistol grip needs — without
 * the per-frame IK having to know which is which.
 */
function buildArm(mats, side, lengths, cfg) {
  const o = cfg || {};
  const group = new THREE.Group();
  group.name = side > 0 ? 'armR' : 'armL';

  const upper = new THREE.Mesh(
    bakeVertexTint(limbGeometry(lengths.upper, 0.0465, 0.0555, 12), { grain: 0.09, wear: 0.05 }),
    mats.sleeve
  );
  upper.frustumCulled = false;
  const fore = new THREE.Mesh(
    bakeVertexTint(limbGeometry(lengths.fore, 0.0305, 0.0480, 12), { grain: 0.09, wear: 0.05 }),
    mats.sleeve
  );
  fore.frustumCulled = false;

  /* Multicam-ish camo baked straight into the sleeve vertex colours.
     The gain is the important number. These tones are authored in art.js for world surfaces
     seen through 30 m of ash; on a sleeve 0.4 m from the eye taking the key head-on there is
     no atmosphere to knock them back, and at gain 1.0 the forearm measured *brighter* than
     the sunlit ground behind it — the arm read as a light source rather than as cloth in the
     scene. 0.58 puts it where cloth in that light belongs: clearly darker than the sand. */
  const tones = [PALETTE.gunPolymer, PALETTE.dirt, PALETTE.railGreen, PALETTE.woodWeathered, PALETTE.weeds];
  bakeCamo(upper.geometry, tones, { gain: 0.58, dust: 0.30, grime: 0.35 });
  bakeCamo(fore.geometry, tones, { gain: 0.58, dust: 0.36, grime: 0.32 });

  // Cuff: a rolled band at the wrist end of the forearm, darker fabric, its own material so
  // it does not share the sleeve's tiling.
  const cuff = new THREE.Mesh(
    bakeVertexTint(latheY([[0.0300, 0], [0.0355, 0.006], [0.0362, 0.026], [0.0318, 0.033], [0.0295, 0.033]], 14), {
      grain: 0.13,
      wear: 0.04,
    }),
    mats.cuff
  );
  bakeCamo(cuff.geometry, [PALETTE.gunPolymer, PALETTE.dirt, PALETTE.gunRubber], { gain: 0.52, grime: 0.4 });
  cuff.position.y = lengths.fore - 0.033;
  cuff.frustumCulled = false;
  fore.add(cuff);

  /* Elbow pad, sitting on the elbow end of the forearm (limb geometry runs +Y from the
     proximal joint, so y = 0 on `fore` *is* the elbow). It exists to break the straight-
     sided cone silhouette that made the sleeve read as an unwrapped putty blob, and its
     radius has to clear the forearm's 48 mm root or it disappears inside it. */
  const pad = new THREE.Mesh(
    bakeVertexTint(latheY([[0.0480, 0], [0.0565, 0.012], [0.0570, 0.036], [0.0490, 0.050], [1e-4, 0.054]], 14), {
      grain: 0.10,
      wear: 0.16,
      dust: 0.16,
      grime: 0.2,
    }),
    mats.gloveHard
  );
  pad.position.y = -0.004;
  pad.frustumCulled = false;
  fore.add(pad);

  // IK-driven wrist. The visual hand hangs off it at a fixed orientation.
  const hand = new THREE.Group();
  hand.name = side > 0 ? 'wristR' : 'wristL';
  const handBuilt = buildHand(mats, side, { wrap: o.wrap, trigger: o.trigger });
  const handMesh = handBuilt.group;
  if (o.palmUp) {
    /* Rotate hand space so the palm faces +Y and the fingers run along +X: the C-clamp a
       support hand makes on a handguard. Derived rather than eyeballed — the matrix with
       columns [+Z, -Y, -X] is exactly Euler XYZ (0, -pi/2, pi). */
    handMesh.rotation.set(0, -Math.PI * 0.5, Math.PI);
  }
  hand.add(handMesh);
  hand.frustumCulled = false;

  group.add(upper, fore, hand);
  return { group, upper, fore, hand, handMesh, triggerFinger: handBuilt.triggerFinger, lengths };
}

/**
 * Analytic two-bone IK. Writes the elbow into `outElbow`; the wrist ends at the clamped
 * target. `pole` biases which way the elbow breaks — this is the difference between an arm
 * that looks braced and one that looks broken.
 */
function solveTwoBone(shoulder, target, l1, l2, pole, outElbow, outWrist) {
  _v5.subVectors(target, shoulder);
  let dist = _v5.length();
  const minD = Math.abs(l1 - l2) + 1e-4;
  const maxD = l1 + l2 - 1e-4;
  if (dist < 1e-5) {
    _v5.set(0, -1, 0);
    dist = 1e-5;
  }
  const clamped = clamp(dist, minD, maxD);
  _v5.multiplyScalar(1 / dist); // unit axis
  outWrist.copy(shoulder).addScaledVector(_v5, clamped);
  // Distance from the shoulder to the foot of the elbow's perpendicular.
  const a = (l1 * l1 - l2 * l2 + clamped * clamped) / (2 * clamped);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // Gram-Schmidt the pole against the bone axis so the elbow plane is well defined.
  _v6.copy(pole).addScaledVector(_v5, -pole.dot(_v5));
  if (_v6.lengthSq() < 1e-8) _v6.set(_v5.y, -_v5.x, 0);
  _v6.normalize();
  outElbow.copy(shoulder).addScaledVector(_v5, a).addScaledVector(_v6, h);
  return clamped < dist; // true when the target was out of reach
}

/** Orient a limb mesh whose geometry runs along +Y from `from` to `to`. */
function aimLimb(mesh, from, to, quatScratch) {
  mesh.position.copy(from);
  _v7.subVectors(to, from);
  const len = _v7.length();
  if (len < 1e-6) return;
  _v7.multiplyScalar(1 / len);
  quatScratch.setFromUnitVectors(_up, _v7);
  mesh.quaternion.copy(quatScratch);
}

/* ========================================================================== */
/* Keyframe animation runtime                                                 */
/* ========================================================================== */

const EASE = {
  l: (t) => t,
  io: smootherstep,
  i: (t) => t * t,
  o: (t) => 1 - (1 - t) * (1 - t),
  i3: (t) => t * t * t,
  o3: (t) => 1 - Math.pow(1 - t, 3),
  /** Slight overshoot then settle — used for parts that slam home. */
  b: (t) => {
    const c = 1.9;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  /** Hard step — dust covers and visibility flags. */
  s: () => 0,
};

/**
 * Sample a track. `keys` is [[time, value, easeName], ...] sorted by time. Allocation free.
 */
function sampleTrack(keys, t) {
  const n = keys.length;
  if (n === 0) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const span = b[0] - a[0];
      if (span <= 1e-6) return b[1];
      const u = (t - a[0]) / span;
      const fn = EASE[b[2] || 'io'] || EASE.io;
      return a[1] + (b[1] - a[1]) * fn(u);
    }
  }
  return keys[n - 1][1];
}

/* -------------------------------------------------------------------------- */
/* Animation channels                                                          */
/* -------------------------------------------------------------------------- */

/** Everything a clip may drive. Reset to these defaults every frame before sampling. */
const CHANNEL_DEFAULTS = {
  gunX: 0,
  gunY: 0,
  gunZ: 0,
  gunPitch: 0,
  gunYaw: 0,
  gunRoll: 0,
  magX: 0,
  magY: 0,
  magZ: 0,
  magPitch: 0,
  magRoll: 0,
  magHidden: 0,
  boltZ: 0,
  chargeZ: 0,
  coverOpen: 0,
  supportToMag: 0,
  supportToBolt: 0,
  supportOff: 0,
  fireOff: 0,
  hide: 0,
};

/* -------------------------------------------------------------------------- */
/* Clips                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Tactical reload: a round stays chambered, so no bolt release and no last-second slap.
 * Timings are the real ones from a competent shooter — ~2.1 s door to door.
 */
function clipReloadTactical(scale) {
  const s = scale || 1;
  const T = (t) => t * s;
  return {
    name: 'reloadTactical',
    duration: T(2.10),
    loop: false,
    tracks: {
      // Gun rolls inboard and drops slightly so the magwell is visible and reachable.
      gunRoll: [[0, 0, 'io'], [T(0.22), -0.42, 'io'], [T(1.55), -0.36, 'io'], [T(2.05), 0, 'io']],
      gunPitch: [[0, 0, 'io'], [T(0.22), 0.16, 'io'], [T(1.55), 0.13, 'io'], [T(2.05), 0, 'io']],
      gunY: [[0, 0, 'io'], [T(0.20), -0.030, 'io'], [T(1.60), -0.026, 'io'], [T(2.05), 0, 'io']],
      gunZ: [[0, 0, 'io'], [T(0.20), 0.020, 'io'], [T(1.60), 0.018, 'io'], [T(2.05), 0, 'io']],
      gunX: [[0, 0, 'io'], [T(0.22), 0.014, 'io'], [T(1.60), 0.012, 'io'], [T(2.05), 0, 'io']],
      // Empty mag drops out and away.
      magY: [[0, 0, 'l'], [T(0.28), 0, 'i'], [T(0.52), -0.30, 'i']],
      magZ: [[0, 0, 'l'], [T(0.28), 0, 'i'], [T(0.52), 0.05, 'i']],
      magPitch: [[0, 0, 'l'], [T(0.28), 0, 'i'], [T(0.52), 0.9, 'i']],
      magHidden: [[0, 0, 's'], [T(0.50), 1, 's'], [T(0.92), 0, 's']],
      // Fresh mag comes up from the carrier and seats with a small overshoot.
      magX: [[T(0.92), 0.055, 'l'], [T(1.32), 0.004, 'o3'], [T(1.44), 0, 'b']],
      // (magY/magZ re-used: the fresh mag rises from below.)
      supportToMag: [[0, 0, 'io'], [T(0.20), 1, 'io'], [T(1.46), 1, 'io'], [T(1.86), 0, 'io']],
    },
    // The second half of magY/magZ has to live in a separate pass because a track is a
    // single curve; these overwrite once the fresh magazine appears.
    tracksLate: {
      magY: [[T(0.92), -0.19, 'l'], [T(1.34), -0.012, 'o3'], [T(1.44), 0, 'b']],
      magZ: [[T(0.92), 0.030, 'l'], [T(1.34), 0.004, 'o3'], [T(1.44), 0, 'io']],
      magPitch: [[T(0.92), 0.34, 'l'], [T(1.34), 0.04, 'o3'], [T(1.44), 0, 'io']],
    },
    lateFrom: T(0.90),
    events: [
      [0.0, 'start'],
      [T(0.30), 'magout'],
      [T(1.40), 'magin'],
      [T(1.46), 'ammo'],
      [T(2.06), 'end'],
    ],
  };
}

/**
 * Empty reload: the bolt is locked back, so it costs an extra beat to slap the release,
 * and the support hand travels further. ~2.75 s.
 */
function clipReloadEmpty(scale) {
  const s = scale || 1;
  const T = (t) => t * s;
  return {
    name: 'reloadEmpty',
    duration: T(2.72),
    loop: false,
    tracks: {
      gunRoll: [[0, 0, 'io'], [T(0.24), -0.52, 'io'], [T(1.70), -0.46, 'io'], [T(2.05), -0.72, 'io'], [T(2.64), 0, 'io']],
      gunPitch: [[0, 0, 'io'], [T(0.24), 0.20, 'io'], [T(1.70), 0.16, 'io'], [T(2.10), 0.24, 'io'], [T(2.64), 0, 'io']],
      gunY: [[0, 0, 'io'], [T(0.22), -0.036, 'io'], [T(1.75), -0.030, 'io'], [T(2.64), 0, 'io']],
      gunZ: [[0, 0, 'io'], [T(0.22), 0.026, 'io'], [T(1.75), 0.022, 'io'], [T(2.64), 0, 'io']],
      gunX: [[0, 0, 'io'], [T(0.24), 0.018, 'io'], [T(1.75), 0.015, 'io'], [T(2.64), 0, 'io']],
      magY: [[0, 0, 'l'], [T(0.30), 0, 'i'], [T(0.56), -0.32, 'i']],
      magZ: [[0, 0, 'l'], [T(0.30), 0, 'i'], [T(0.56), 0.06, 'i']],
      magPitch: [[0, 0, 'l'], [T(0.30), 0, 'i'], [T(0.56), 1.0, 'i']],
      magHidden: [[0, 0, 's'], [T(0.54), 1, 's'], [T(1.00), 0, 's']],
      magX: [[T(1.00), 0.060, 'l'], [T(1.52), 0.004, 'o3'], [T(1.64), 0, 'b']],
      supportToMag: [[0, 0, 'io'], [T(0.22), 1, 'io'], [T(1.66), 1, 'io'], [T(1.86), 0, 'io']],
      // Bolt is locked back from the start and rides home on the release.
      boltZ: [[0, 0.030, 'l'], [T(2.10), 0.030, 'l'], [T(2.17), 0, 'i3']],
      coverOpen: [[0, 1, 'l'], [T(2.10), 1, 'l'], [T(2.20), 0.35, 'o']],
      supportToBolt: [[T(1.86), 0, 'io'], [T(2.04), 1, 'i'], [T(2.16), 1, 'l'], [T(2.34), 0, 'io']],
    },
    tracksLate: {
      magY: [[T(1.00), -0.20, 'l'], [T(1.54), -0.012, 'o3'], [T(1.64), 0, 'b']],
      magZ: [[T(1.00), 0.034, 'l'], [T(1.54), 0.004, 'o3'], [T(1.64), 0, 'io']],
      magPitch: [[T(1.00), 0.38, 'l'], [T(1.54), 0.05, 'o3'], [T(1.64), 0, 'io']],
    },
    lateFrom: T(0.98),
    events: [
      [0.0, 'start'],
      [T(0.32), 'magout'],
      [T(1.60), 'magin'],
      [T(1.66), 'ammo'],
      [T(2.12), 'bolt'],
      [T(2.68), 'end'],
    ],
  };
}

/** Inspect on F: tilt, look at the left side, cycle the charging handle, back to ready. */
function clipInspect() {
  return {
    name: 'inspect',
    duration: 2.35,
    loop: false,
    tracks: {
      gunYaw: [[0, 0, 'io'], [0.35, 0.55, 'io'], [1.05, 0.62, 'io'], [1.45, -0.45, 'io'], [1.95, -0.40, 'io'], [2.30, 0, 'io']],
      gunRoll: [[0, 0, 'io'], [0.35, -0.62, 'io'], [1.05, -0.70, 'io'], [1.45, 0.85, 'io'], [1.95, 0.80, 'io'], [2.30, 0, 'io']],
      gunPitch: [[0, 0, 'io'], [0.35, -0.18, 'io'], [1.45, 0.12, 'io'], [2.30, 0, 'io']],
      gunX: [[0, 0, 'io'], [0.35, -0.045, 'io'], [1.45, 0.020, 'io'], [2.30, 0, 'io']],
      gunY: [[0, 0, 'io'], [0.30, 0.028, 'io'], [1.45, 0.010, 'io'], [2.30, 0, 'io']],
      gunZ: [[0, 0, 'io'], [0.30, 0.055, 'io'], [1.45, 0.040, 'io'], [2.30, 0, 'io']],
      chargeZ: [[0.55, 0, 'io'], [0.72, 0.026, 'o'], [0.90, 0, 'i3']],
      boltZ: [[0.55, 0, 'io'], [0.72, 0.026, 'o'], [0.92, 0, 'i3']],
      coverOpen: [[0.55, 0, 's'], [0.62, 1, 'o'], [1.35, 1, 'l'], [1.55, 0, 'i']],
      supportOff: [[0, 0, 'io'], [0.30, 0.85, 'io'], [1.90, 0.85, 'io'], [2.25, 0, 'io']],
    },
    events: [
      [0.60, 'charge'],
      [0.90, 'boltHome'],
    ],
  };
}

/** Weapon lower — plays on the outgoing gun before a switch. */
function clipLower() {
  return {
    name: 'lower',
    duration: 0.26,
    loop: false,
    hold: true,
    tracks: {
      gunY: [[0, 0, 'i'], [0.26, -0.32, 'i']],
      gunPitch: [[0, 0, 'i'], [0.26, 1.05, 'i']],
      gunZ: [[0, 0, 'i'], [0.26, 0.06, 'i']],
      supportOff: [[0, 0, 'io'], [0.20, 1, 'io']],
      fireOff: [[0, 0, 'io'], [0.26, 0.6, 'io']],
    },
    events: [],
  };
}

/** Weapon raise — the incoming gun swings up with a touch of follow-through. */
function clipRaise(firstTime) {
  const d = firstTime ? 0.62 : 0.42;
  return {
    name: 'raise',
    duration: d,
    loop: false,
    tracks: {
      gunY: [[0, -0.34, 'o3'], [d * 0.72, 0.012, 'o3'], [d, 0, 'io']],
      gunPitch: [[0, 1.12, 'o3'], [d * 0.70, -0.075, 'o3'], [d, 0, 'io']],
      gunRoll: [[0, 0.30, 'o3'], [d * 0.66, -0.035, 'o3'], [d, 0, 'io']],
      gunZ: [[0, 0.075, 'o3'], [d * 0.75, -0.006, 'o3'], [d, 0, 'io']],
      supportOff: [[0, 1, 'io'], [d * 0.55, 0, 'io']],
      fireOff: [[0, 0.55, 'io'], [d * 0.35, 0, 'io']],
      chargeZ: firstTime ? [[0, 0, 'l'], [d * 0.55, 0, 'io'], [d * 0.72, 0.024, 'o'], [d * 0.92, 0, 'i3']] : [[0, 0, 'l']],
      boltZ: firstTime ? [[0, 0, 'l'], [d * 0.55, 0, 'io'], [d * 0.72, 0.024, 'o'], [d * 0.94, 0, 'i3']] : [[0, 0, 'l']],
    },
    events: firstTime ? [[d * 0.60, 'charge'], [d * 0.92, 'boltHome']] : [],
  };
}

/* ========================================================================== */
/* Weapon definitions                                                         */
/* ========================================================================== */

/**
 * Recoil patterns. Each entry is [pitchMultiplier, yawMultiplier] for that round of a
 * sustained burst; past the end of the array we hold the last entry. These are deliberately
 * *learnable*: a player who drags down and traces the shape can hold a 20-round burst on a
 * torso at 30 m. The random term below is small enough that it never hides the shape.
 */
const PATTERN_MK18 = [
  // Rounds 1-5: near-vertical climb with a tiny left bias, the classic AR "first five".
  [1.00, 0.00],
  [1.06, -0.08],
  [1.02, 0.14],
  [0.95, -0.20],
  [0.88, -0.33],
  // Rounds 6-9: the muzzle walks left as the shooter's grip loads up.
  [0.80, -0.44],
  [0.72, -0.38],
  [0.66, -0.16],
  [0.62, 0.14],
  // Rounds 10-12: it snaps back right and settles into a shallow right drift.
  [0.58, 0.38],
  [0.55, 0.48],
  [0.53, 0.42],
];

const PATTERN_VECTOR = [
  // 1100 rpm: almost no time to correct, so the pattern is a tight, fast right-hand hook.
  [1.00, 0.00],
  [0.98, 0.14],
  [0.94, 0.26],
  [0.88, 0.34],
  [0.80, 0.30],
  [0.72, 0.16],
  [0.66, -0.06],
  [0.62, -0.26],
  [0.58, -0.38],
  [0.55, -0.32],
  [0.52, -0.12],
  [0.50, 0.10],
];

const PATTERN_DMR = [
  // Semi-auto: every shot is effectively "round 1", but a fast double-tap still climbs, so
  // the first three entries ramp before flattening off.
  [1.00, 0.10],
  [1.08, -0.14],
  [1.12, 0.18],
  [1.10, -0.20],
  [1.06, 0.22],
  [1.04, -0.18],
  [1.02, 0.16],
  [1.00, -0.14],
  [1.00, 0.12],
  [1.00, -0.10],
  [1.00, 0.10],
  [1.00, -0.08],
];

const DEG = Math.PI / 180;

/* Settle depth, as a fraction of each round's primary peak. A third of the kick coming back
   the other way is what a shooter sees down a red dot: the dot dives slightly below the mark
   before floating up to it. Much past 0.4 and the weapon reads as rubbery. `SETTLE_CLAMP`
   caps the accumulated value during sustained fire so a 1100 rpm burst cannot integrate the
   tail into a visible sag. */
const SETTLE_PITCH = 0.3;
const SETTLE_ROLL = 0.26;
const SETTLE_Z = 0.34;
const SETTLE_CLAMP = 1.2;

/* How much of the recoil the hands and shoulders are allowed *not* to follow. See the
   residual-recoil block in update(): 0 is a hand welded to the receiver, 1 is a hand that
   stays where it is while the gun moves inside it. The support hand is braced against the
   handguard and gives most, the firing hand is locked round the grip and gives least, and the
   shoulders are attached to a body that barely moves at all. */
const GIVE_SUPPORT = 0.55;
const GIVE_FIRE = 0.2;
const GIVE_SHOULDER = 0.78;

function weaponDefs() {
  return [
    {
      id: 'mk18',
      name: 'MK18',
      classLabel: 'CARBINE',
      rpm: 780,
      damage: 33,
      magSize: 30,
      reserveMax: 210,
      auto: true,
      adsTime: 0.22,
      adsFov: 58,
      viewFov: 56,
      build: buildMk18,
      scale: 0.88,
      /* Hip *carry* pose in camera space, not an inspect pose.
         Three things changed together and they only work together:
         - pushed forward (-0.168 -> -0.268) so the whole weapon subtends less of the frame
           and the pistol grip climbs back inside the 30 deg half-FOV. At the old distance
           the firing hand sat 36 deg below the eye axis, i.e. off the bottom of the screen
           entirely, which is why no trigger hand appears in any frame;
         - pulled inboard (0.132 -> 0.106) and dropped, which walks the optic from x=0.79 to
           about x=0.66 of screen width, clear of both the right edge and the ammo counter's
           safe area at 16:9;
         - muzzle rotated down 4.9 deg (rotation.x is muzzle-*up*, so this goes negative) and
           kept outboard, so the barrel stays inside the lower-right quadrant instead of
           running up-left across the middle of the playfield. Roll stays under 1.5 deg. */
      hip: { p: [0.105, -0.104, -0.265], r: [-0.078, -0.105, 0.026] },
      adsZ: -0.135,
      recoil: {
        /* Viewmodel figures are the *peak* excursion of a single round, in radians; the
           spring impulse needed to reach them is derived from the stiffness at equip time.
           They run ~2.2x the camera numbers, which is what makes the gun look like it is
           being fought while the crosshair stays trackable. */
        pitch: 1.20 * DEG,
        yaw: 2.60 * DEG,
        roll: 1.70 * DEG,
        kick: 0.0125, // metres back along +Z
        camPitch: 0.43 * DEG,
        camYaw: 1.05 * DEG,
        // Random ride-along, deliberately far smaller than the pattern step so the shape
        // stays readable after a dozen magazines.
        randPitch: 0.10,
        randYaw: 0.12,
        recover: 0.66,
        pattern: PATTERN_MK18,
        stiff: { pitch: 340, yaw: 260, roll: 220, pos: 300 },
        zeta: { pitch: 0.68, yaw: 0.72, roll: 0.62, pos: 0.74 },
      },
      spread: { hip: 0.0300, ads: 0.0011, bloom: 0.0034, bloomMax: 0.042, decay: 5.6, move: 0.0230, air: 0.055 },
      reloadScale: 1.0,
      casing: { size: 1.0 },
      audio: { fire: 'rifle', dry: 'dryfire' },
    },
    {
      id: 'vector',
      name: 'VECTOR',
      classLabel: 'SMG',
      rpm: 1100,
      damage: 22,
      magSize: 33,
      reserveMax: 231,
      auto: true,
      adsTime: 0.17,
      adsFov: 63,
      viewFov: 57,
      build: buildVector,
      scale: 0.90,
      hip: { p: [0.100, -0.100, -0.238], r: [-0.074, -0.100, 0.028] },
      adsZ: -0.122,
      recoil: {
        pitch: 0.66 * DEG,
        yaw: 1.55 * DEG,
        roll: 1.10 * DEG,
        kick: 0.0074,
        camPitch: 0.235 * DEG,
        camYaw: 0.62 * DEG,
        randPitch: 0.13,
        randYaw: 0.16,
        recover: 0.72,
        pattern: PATTERN_VECTOR,
        stiff: { pitch: 420, yaw: 320, roll: 280, pos: 380 },
        zeta: { pitch: 0.72, yaw: 0.76, roll: 0.66, pos: 0.80 },
      },
      spread: { hip: 0.0255, ads: 0.0019, bloom: 0.0026, bloomMax: 0.050, decay: 6.4, move: 0.0175, air: 0.048 },
      reloadScale: 0.90,
      casing: { size: 0.85 },
      audio: { fire: 'smg', dry: 'dryfire' },
    },
    {
      id: 'dmr14',
      name: 'DMR14',
      classLabel: 'MARKSMAN',
      rpm: 300,
      damage: 62,
      magSize: 20,
      reserveMax: 100,
      auto: false,
      adsTime: 0.30,
      adsFov: 42,
      viewFov: 54,
      build: buildDmr14,
      scale: 0.86,
      hip: { p: [0.111, -0.108, -0.284], r: [-0.072, -0.098, 0.022] },
      adsZ: -0.150,
      recoil: {
        pitch: 3.20 * DEG,
        yaw: 1.40 * DEG,
        roll: 2.00 * DEG,
        kick: 0.0245,
        camPitch: 1.15 * DEG,
        camYaw: 0.55 * DEG,
        randPitch: 0.06,
        randYaw: 0.09,
        recover: 0.58,
        pattern: PATTERN_DMR,
        stiff: { pitch: 210, yaw: 190, roll: 160, pos: 190 },
        zeta: { pitch: 0.60, yaw: 0.66, roll: 0.58, pos: 0.66 },
      },
      spread: { hip: 0.0380, ads: 0.0004, bloom: 0.0060, bloomMax: 0.050, decay: 3.4, move: 0.0300, air: 0.070 },
      reloadScale: 1.12,
      casing: { size: 1.25 },
      audio: { fire: 'dmr', dry: 'dryfire' },
    },
  ];
}

/* ========================================================================== */
/* Factory                                                                    */
/* ========================================================================== */

export function createWeapon(game) {
  const mats = buildMaterials(game);
  const rng = makeRandom(0x5eed1234);

  /* --- Scene graph -------------------------------------------------------- */

  const root = new THREE.Group();
  root.name = 'viewmodelRoot';
  root.matrixAutoUpdate = true;

  const sway = new THREE.Group(); // mouse lag + breathing + bob
  sway.name = 'sway';
  const recoilGrp = new THREE.Group(); // recoil springs
  recoilGrp.name = 'recoil';
  const poseGrp = new THREE.Group(); // hip / ADS / sprint / clip offsets
  poseGrp.name = 'pose';

  root.add(sway);
  sway.add(recoilGrp);
  recoilGrp.add(poseGrp);

  /* --- Viewmodel lighting -------------------------------------------------- */
  /* The engine owns the viewmodel key and sky fill and drives them from the world sun, so
     this adds exactly one thing the engine's rig has no equivalent of: the warm bounce off
     the sunlit ground into the *underside* of the weapon.
     Without it, everything below the gun's top facets receives nothing but the hemisphere's
     ground term and crushes to a featureless black slab — the lower half of the receiver,
     the magazine and the whole trigger group measured under 0.12 luma against a scene
     sitting near 0.7. It is a real light in the scene's own palette (§4: "bounce light is
     warm off the ground"), motivated and strictly subordinate to the key at 4.6.
     If the engine's rig is missing entirely we also stand in a key and a sky fill so the
     weapon is never a silhouette. */
  let ownLights = null;
  try {
    let hasLight = false;
    if (game.viewScene) game.viewScene.traverse((o) => { if (o.isLight) hasLight = true; });
    if (game.viewScene) {
      ownLights = new THREE.Group();
      ownLights.name = hasLight ? 'viewmodelBounce' : 'viewmodelLightsFallback';
      const bounce = new THREE.DirectionalLight(
        new THREE.Color(PALETTE.groundBounce),
        LIGHTING.hemiGroundIntensity * 1.6
      );
      // From below and slightly ahead: the ground is the only thing down there to bounce off.
      bounce.position.set(0.25, -1.0, -0.45);
      bounce.castShadow = false;
      ownLights.add(bounce, bounce.target);
      if (!hasLight) {
        const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), LIGHTING.sunIntensity);
        key.position.set(-0.6, 0.9, 0.5);
        key.castShadow = false;
        // Cool sky fill from above, not a second cold key from the side.
        const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.skyZenith), LIGHTING.hemiSkyIntensity * 0.45);
        fill.position.set(0.35, 1.0, 0.25);
        fill.castShadow = false;
        const hemi = new THREE.HemisphereLight(
          new THREE.Color(PALETTE.skyZenith),
          new THREE.Color(PALETTE.groundBounce),
          LIGHTING.hemiSkyIntensity * 0.6
        );
        ownLights.add(key, key.target, fill, fill.target, hemi);
      }
      game.viewScene.add(ownLights);
    }
  } catch { /* a missing viewScene is handled below */ }

  /* --- Layers ------------------------------------------------------------- */
  const VM_LAYER = game.engine && game.engine.LAYER && typeof game.engine.LAYER.VIEWMODEL === 'number'
    ? game.engine.LAYER.VIEWMODEL
    : null;
  const applyLayer = (obj) => {
    if (VM_LAYER === null) return;
    // enable() rather than set(): if the engine's viewCamera is still on the default layer
    // the weapon must not vanish.
    obj.traverse((o) => o.layers.enable(VM_LAYER));
  };

  /* --- Build the three weapons -------------------------------------------- */

  const defs = weaponDefs();
  const models = new Map();

  for (const def of defs) {
    // `mag` is the name the HUD stub in main.js expects; keep both in step.
    def.mag = def.magSize;
    let model = null;
    try {
      model = def.build(mats);
    } catch (err) {
      if (game.debug) console.warn('[weapon] model build failed for ' + def.id, err);
      model = { group: new THREE.Group(), parts: {}, anchors: {} };
    }
    const holder = new THREE.Group();
    holder.name = 'weapon:' + def.id;
    holder.scale.setScalar(def.scale);
    holder.add(model.group);
    holder.visible = false;
    poseGrp.add(holder);

    // Anchors as real Object3D so their world transforms follow every animation.
    const a = model.anchors || {};
    const mkAnchor = (arr, parent, rot) => {
      const o = new THREE.Object3D();
      if (arr) o.position.set(arr[0], arr[1], arr[2]);
      if (rot) o.rotation.set(rot[0], rot[1], rot[2]);
      (parent || model.group).add(o);
      return o;
    };
    model.anchorObjs = {
      muzzle: mkAnchor(a.muzzle),
      eject: mkAnchor(a.eject),
      // Grip anchors carry the hand orientation, not just a position.
      gripFire: mkAnchor(a.gripFire, null, a.gripFireRot || [-0.30, 0.06, 0.10]),
      /* The support hand's mesh is pre-rotated palm-up with the fingers running along +X
         (see buildArm), so these anchor rotations are expressed in that frame: identity
         puts the palm under the handguard with the fingers across the bore and the thumb
         forward, which is the C-clamp. A weapon with a vertical foregrip overrides it. */
      gripSupport: mkAnchor(a.gripSupport, null, a.gripSupportRot || [0.12, -0.06, 0.16]),
      boltCatch: mkAnchor(a.boltCatch, null, a.boltCatchRot || [0.10, -0.30, -Math.PI * 0.5]),
      sight: mkAnchor(a.sight),
      magGrab: mkAnchor(
        a.magGrab,
        model.parts && model.parts.mag ? model.parts.mag : null,
        a.magGrabRot || [0.20, 0.0, -Math.PI * 0.5]
      ),
    };
    model.ejectDir = a.ejectDir || [0.9, 0.4, 0.2];

    /* ADS pose, derived rather than eyeballed.
       The optic's local sight point is at `sight`; scaled by the holder it lands at
       `sight * scale`. Placing the holder at (-sx, -sy, adsZ - sz) puts the sight exactly on
       the camera axis at `adsZ` metres in front of the eye, so the reticle sits dead centre
       no matter what the model's internal proportions are. */
    const sx = (a.sight ? a.sight[0] : 0) * def.scale;
    const sy = (a.sight ? a.sight[1] : 0) * def.scale;
    const sz = (a.sight ? a.sight[2] : 0) * def.scale;
    def.adsPose = { p: [-sx, -sy, def.adsZ - sz], r: [0, 0, 0] };

    /* Sprint pose. A pose, not a rotation of the hip pose — the difference is what makes it
       read as the character relaxing rather than the camera tilting.
       Re-solved rather than nudged, because the old rotation was pointing the wrong way: with
       Euler XYZ, r = [0.62, -0.66, -0.42] sends the bore to (+0.61, +0.46, -0.64), i.e. muzzle
       up and *outboard*, which is a port-arms carry, not the canted-inboard-and-down sprint
       §3.8 asks for. [-0.40, 0.58, 0.78] sends it to (-0.55, -0.33, -0.77) — forward, left and
       down, across the player's body — and puts the top of the receiver at (-0.59, +0.81),
       cantedinboard by about 36°. The position goes with it: inboard, well down, and drawn
       back towards the chest, which is where a weapon ends up when someone actually runs. */
    def.sprintPose = {
      p: [def.hip.p[0] - 0.03, def.hip.p[1] - 0.072, def.hip.p[2] + 0.042],
      r: [-0.4, 0.58, 0.78],
    };

    /* Low-ready idle: a shallow droop that eases in after a few idle seconds. */
    def.readyPose = {
      p: [def.hip.p[0] + 0.006, def.hip.p[1] - 0.016, def.hip.p[2] + 0.008],
      r: [def.hip.r[0] + 0.16, def.hip.r[1] - 0.05, def.hip.r[2] - 0.03],
    };

    applyLayer(holder);
    models.set(def.id, { def, model, holder });
  }

  /* --- Arms --------------------------------------------------------------- */
  // Asymmetric bone lengths: the firing arm is folded tight against the body and the support
  // arm is nearly extended, so matched lengths would make one of them look wrong.
  // The firing hand closes on a ~29 mm pistol grip and keeps its index finger on the trigger;
  // the support hand opens out around a ~50 mm handguard, palm up, in a C-clamp.
  const armR = buildArm(mats, 1, { upper: 0.195, fore: 0.190 }, { wrap: 0.015, trigger: true });
  const armL = buildArm(mats, -1, { upper: 0.306, fore: 0.288 }, { wrap: 0.026, palmUp: true });
  const armsGrp = new THREE.Group();
  armsGrp.name = 'arms';
  armsGrp.add(armR.group, armL.group);
  recoilGrp.add(armsGrp);
  applyLayer(armsGrp);

  // Shoulder sockets in camera space. Behind the near plane, so the upper arms enter frame
  // from off-screen rather than being sliced by it.
  /* Both sockets moved forward and up with the carry pose below. The support socket in
     particular has to sit forward enough that shoulder-to-handguard stays inside
     upper + fore = 0.594 m: past that the IK clamps the wrist short of the grip anchor and
     the forearm visibly stops before the hand, which is the "floating gun" read. */
  const shoulderR = new THREE.Vector3(0.176, -0.238, 0.020);
  const shoulderL = new THREE.Vector3(-0.115, -0.246, -0.030);
  const poleR = new THREE.Vector3(0.62, -0.72, 0.30).normalize();
  const poleL = new THREE.Vector3(-0.30, -0.90, 0.20).normalize();

  const elbowR = new THREE.Vector3();
  const wristR = new THREE.Vector3();
  const elbowL = new THREE.Vector3();
  const wristL = new THREE.Vector3();

  if (game.viewScene) game.viewScene.add(root);

  /* ====================================================================== */
  /* State                                                                  */
  /* ====================================================================== */

  const channels = Object.assign({}, CHANNEL_DEFAULTS);

  const state = {
    current: null,
    entry: null,
    ammoBy: new Map(),
    reserveBy: new Map(),

    ads: false,
    adsForced: null,
    adsProgress: 0,
    adsBlend: 0,

    triggerHeld: false,
    firedThisPull: false,
    shotClock: 0,
    burstIndex: 0,
    lastShotTime: -10,
    reloading: false,
    reloadKind: null,
    switching: false,
    pendingSwitch: null,
    blockUntilRelease: false,
    idleTimer: 0,

    spread: 0.03,
    bloom: 0,

    /* Camera recoil bookkeeping. `recoverPitch/Yaw` is the amount owed back to the player
       when they release the trigger — real shooters' muzzles settle, and a game that never
       gives any of the kick back feels like the mouse is being stolen. */
    recoverPitch: 0,
    recoverYaw: 0,
    recoverDelay: 0,

    impScale: { pitch: 1, yaw: 1, roll: 1, pos: 1, settlePitch: 1, settleRoll: 1, settleZ: 1 },

    boltTimer: 0,
    boltDuration: 0.055,
    coverTimer: 0,
  };

  /* Springs. Different stiffness per axis is what stops recoil looking like a single
     rigid-body shove: pitch snaps hardest, roll trails, the positional kick lags both. */
  const sp = {
    pitch: new Spring(340, 0.68),
    yaw: new Spring(260, 0.72),
    roll: new Spring(220, 0.62),
    posZ: new Spring(300, 0.74),
    posY: new Spring(320, 0.80),
    posX: new Spring(300, 0.82),

    /* Settle. A second, much slower spring per axis, impulsed *negative* on every shot.
       The primary springs are fast and near-critically damped, so on their own a round is a
       clean out-and-back: the weapon arrives at the peak, returns, stops. Real weapons do not
       stop — the shooter's arms are still absorbing the impulse after the receiver has come
       home, so the muzzle carries through slightly past the aim point and drifts back up into
       it over the next third of a second.
       Modelling that as a separate slow spring rather than by underdamping the primary is
       deliberate: underdamping makes the *peak* bouncy, which reads as a toy, while a slow
       negative companion leaves the snap intact and puts the wobble entirely in the tail.
       Their stiffness is derived from each weapon's own in `equip`, so a DMR settles visibly
       slower than a Vector without a second table of numbers. */
    settlePitch: new Spring(120, 0.5),
    settleRoll: new Spring(95, 0.48),
    settleZ: new Spring(130, 0.52),

    swayX: new Spring(90, 0.85),
    swayY: new Spring(90, 0.85),
    swayYaw: new Spring(70, 0.80),
    swayPitch: new Spring(70, 0.80),
    swayRoll: new Spring(55, 0.78),

    /* Weapon mass. Deliberately the slowest springs in the file — a 3.2 kg rifle held out at
       arm's length has a real moment of inertia, and what sells it is not lag on its own but
       lag *plus* overshoot on a direction change. These target the smoothed turn signal, and
       because their period is around a second, reversing a turn leaves the value still on the
       old side: the muzzle trails the turn, crosses over, and catches up. */
    massYaw: new Spring(26, 0.55),
    massPitch: new Spring(30, 0.58),

    /* Sprint transition. A spring rather than an exponential blend so the pose arrives with a
       little overshoot; the anticipation comes from its velocity — see the pose block. */
    sprint: new Spring(150, 0.62),
  };

  /* Animation player. Only one clip runs at a time — reloads, inspects and swaps are all
     mutually exclusive by design. */
  const anim = {
    clip: null,
    time: 0,
    nextEvent: 0,
    onEvent: null,
    onDone: null,
  };

  function playClip(clip, onEvent, onDone) {
    anim.clip = clip;
    anim.time = 0;
    anim.nextEvent = 0;
    anim.onEvent = onEvent || null;
    anim.onDone = onDone || null;
  }

  function stopClip() {
    anim.clip = null;
    anim.onEvent = null;
    anim.onDone = null;
  }

  /* ====================================================================== */
  /* Ammo helpers                                                           */
  /* ====================================================================== */

  for (const def of defs) {
    state.ammoBy.set(def.id, def.magSize);
    state.reserveBy.set(def.id, def.reserveMax);
  }

  const ammoOf = (id) => state.ammoBy.get(id) || 0;
  const reserveOf = (id) => state.reserveBy.get(id) || 0;

  /* ====================================================================== */
  /* Audio + events                                                         */
  /* ====================================================================== */

  /* Payload vectors. Allocated once at construction, never per frame. */
  const shotOrigin = new THREE.Vector3();
  const shotDir = new THREE.Vector3();
  const fxPos = new THREE.Vector3();
  const fxVel = new THREE.Vector3();

  const sfx = (name, opts) => {
    try {
      game.audio?.playOneShot?.(name, opts);
    } catch { /* audio is never allowed to break the gun */ }
  };

  const emit = (name, payload) => {
    try {
      game.events?.emit?.(name, payload);
    } catch { /* an exploding listener must not take the weapon down */ }
  };

  /* ====================================================================== */
  /* Weapon switching                                                       */
  /* ====================================================================== */

  function equip(id, firstTime) {
    const entry = models.get(id);
    if (!entry) return;
    if (state.entry) state.entry.holder.visible = false;
    state.entry = entry;
    state.current = entry.def;
    entry.holder.visible = true;

    // Reset transient handling state — carrying a spring charge across a swap looks like a bug.
    for (const k in sp) sp[k].reset();
    state.bloom = 0;
    state.burstIndex = 0;
    state.shotClock = 0;
    state.boltTimer = 0;
    state.coverTimer = 0;
    state.reloading = false;
    state.reloadKind = null;
    // A trigger already held through the swap must not fire the new weapon; require a
    // fresh pull. Full-auto ignores `firedThisPull`, so this needs its own latch.
    state.blockUntilRelease = state.triggerHeld;
    state.firedThisPull = state.triggerHeld;

    const d = entry.def;
    sp.pitch.set(d.recoil.stiff.pitch, d.recoil.zeta.pitch);
    sp.yaw.set(d.recoil.stiff.yaw, d.recoil.zeta.yaw);
    sp.roll.set(d.recoil.stiff.roll, d.recoil.zeta.roll);
    sp.posZ.set(d.recoil.stiff.pos, d.recoil.zeta.pos);
    sp.posY.set(d.recoil.stiff.pos * 1.1, 0.82);
    sp.posX.set(d.recoil.stiff.pos * 1.05, 0.84);
    /* Settle springs run at ~0.36x the primary stiffness, i.e. 0.6x the frequency, so their
       peak lands roughly where the primary has finished returning and the two never fight. */
    sp.settlePitch.set(d.recoil.stiff.pitch * 0.36, 0.5);
    sp.settleRoll.set(d.recoil.stiff.roll * 0.36, 0.48);
    sp.settleZ.set(d.recoil.stiff.pos * 0.36, 0.52);

    /* Impulse needed for a given peak excursion.
       For x'' + 2ζω x' + ω²x = 0 with x(0)=0, x'(0)=v, the first peak is
           x_peak = (v/ω) · exp(-ζ·acos(ζ)/√(1-ζ²)).
       Inverting that lets the recoil table above be authored in degrees of actual
       on-screen movement, and keeps those degrees honest if the stiffness is ever retuned. */
    state.impScale.pitch = impulseFor(d.recoil.stiff.pitch, d.recoil.zeta.pitch);
    state.impScale.yaw = impulseFor(d.recoil.stiff.yaw, d.recoil.zeta.yaw);
    state.impScale.roll = impulseFor(d.recoil.stiff.roll, d.recoil.zeta.roll);
    state.impScale.pos = impulseFor(d.recoil.stiff.pos, d.recoil.zeta.pos);
    // Same derivation for the settle springs, so `SETTLE_*` below are honest fractions of the
    // primary peak rather than arbitrary velocities.
    state.impScale.settlePitch = impulseFor(d.recoil.stiff.pitch * 0.36, 0.5);
    state.impScale.settleRoll = impulseFor(d.recoil.stiff.roll * 0.36, 0.48);
    state.impScale.settleZ = impulseFor(d.recoil.stiff.pos * 0.36, 0.52);

    weapon.current = d;
    weapon.ammo = ammoOf(d.id);
    weapon.reserve = reserveOf(d.id);

    state.switching = true;
    playClip(
      clipRaise(!!firstTime),
      (ev) => {
        if (ev === 'charge') sfx('boltback', { weapon: d.id });
        if (ev === 'boltHome') sfx('boltrelease', { weapon: d.id });
      },
      () => {
        state.switching = false;
      }
    );
    sfx('weaponraise', { weapon: d.id });
  }

  function switchTo(id) {
    if (!models.has(id)) return;
    if (state.current && state.current.id === id && !state.pendingSwitch) return;
    if (state.switching && state.pendingSwitch) return;
    if (state.reloading) cancelReload();
    state.pendingSwitch = id;
    state.switching = true;
    playClip(clipLower(), null, () => {
      const next = state.pendingSwitch;
      state.pendingSwitch = null;
      if (next) equip(next, false);
      else state.switching = false;
    });
    sfx('weaponlower', { weapon: state.current ? state.current.id : null });
  }

  function cycleWeapon(dir) {
    const idx = defs.findIndex((d) => state.current && d.id === state.current.id);
    const n = defs.length;
    const next = defs[(((idx + dir) % n) + n) % n];
    if (next) switchTo(next.id);
  }

  /* ====================================================================== */
  /* Reload                                                                 */
  /* ====================================================================== */

  function cancelReload() {
    if (!state.reloading) return;
    state.reloading = false;
    state.reloadKind = null;
    stopClip();
  }

  function reload() {
    const d = state.current;
    if (!d) return;
    if (state.reloading || state.switching) return;
    const have = ammoOf(d.id);
    const res = reserveOf(d.id);
    if (res <= 0 || have >= d.magSize) return;

    // Empty means the bolt locked back: a slower sequence with a bolt release at the end.
    const empty = have <= 0;
    state.reloading = true;
    state.reloadKind = empty ? 'empty' : 'tactical';
    weapon.reloading = true;
    // A reload breaks the aim; drop out of ADS the way a real shooter does.
    state.ads = false;

    const clip = empty ? clipReloadEmpty(d.reloadScale) : clipReloadTactical(d.reloadScale);
    playClip(
      clip,
      (ev) => {
        if (ev === 'start') emit('reload', { phase: 'start', weapon: d, empty });
        else if (ev === 'magout') {
          emit('reload', { phase: 'magout', weapon: d, empty });
          sfx('magout', { weapon: d.id });
        } else if (ev === 'magin') {
          emit('reload', { phase: 'magin', weapon: d, empty });
          sfx('magin', { weapon: d.id });
        } else if (ev === 'ammo') {
          // Rounds transfer at the moment the magazine seats, not when the animation ends —
          // so a player who cancels by sprinting after the click keeps the ammunition.
          const need = d.magSize - ammoOf(d.id);
          const take = Math.min(reserveOf(d.id), Math.max(0, need));
          state.ammoBy.set(d.id, ammoOf(d.id) + take);
          state.reserveBy.set(d.id, reserveOf(d.id) - take);
          weapon.ammo = ammoOf(d.id);
          weapon.reserve = reserveOf(d.id);
          // The bolt rides forward with the tactical reload's chambered round already home.
          if (!empty) state.coverTimer = 0;
        } else if (ev === 'bolt') {
          sfx('boltrelease', { weapon: d.id });
        } else if (ev === 'end') {
          emit('reload', { phase: 'end', weapon: d, empty });
        }
      },
      () => {
        state.reloading = false;
        state.reloadKind = null;
        weapon.reloading = false;
      }
    );
  }

  /* ====================================================================== */
  /* Firing                                                                 */
  /* ====================================================================== */

  /** Current spread cone half-angle in radians, recomputed each frame for the HUD. */
  function computeSpread(dt) {
    const d = state.current;
    if (!d) return 0.03;
    const s = d.spread;
    const p = game.player;
    const adsT = state.adsBlend;
    let base = lerp(s.hip, s.ads, adsT);

    if (p) {
      const vx = p.velocity ? p.velocity.x : 0;
      const vz = p.velocity ? p.velocity.z : 0;
      const speed = Math.sqrt(vx * vx + vz * vz);
      // Movement penalty scales with speed and is halved when aiming.
      base += (speed / 6.1) * s.move * lerp(1.0, 0.42, adsT);
      if (p.crouched) base *= 0.78;
      if (p.onGround === false) base += s.air * lerp(1.0, 0.6, adsT);
    }
    base += state.bloom;
    state.bloom = Math.max(0, state.bloom - state.bloom * approach(s.decay, dt));
    return base;
  }

  /** Emit one round. Called from the fire-rate accumulator, possibly twice in a frame. */
  function fireOne() {
    const d = state.current;
    const entry = state.entry;
    if (!d || !entry) return;

    const mag = ammoOf(d.id) - 1;
    state.ammoBy.set(d.id, mag);
    weapon.ammo = mag;

    /* --- Recoil pattern ------------------------------------------------- */
    const pat = d.recoil.pattern;
    const idx = Math.min(state.burstIndex, pat.length - 1);
    const pm = pat[idx][0];
    const ym = pat[idx][1];
    state.burstIndex++;

    // The random component rides on top of the deterministic curve, never replaces it.
    const rp = 1 + (rng() - 0.5) * 2 * d.recoil.randPitch;
    const ry = (rng() - 0.5) * 2 * d.recoil.randYaw;

    // ADS braces the weapon: less visible kick, tighter spread, slightly less camera climb.
    const braced = lerp(1.0, 0.74, state.adsBlend);

    const vmPitch = d.recoil.pitch * pm * rp * braced;
    const vmYaw = d.recoil.yaw * (ym + ry) * braced;
    // Roll always has a base component: the gun torques about the bore on every round,
    // whichever way the pattern is pushing it. Without this the first shot of a burst reads
    // as a pure vertical piston.
    const vmRoll = d.recoil.roll * (0.55 + ym * 0.60 + ry * 0.35 + (rng() - 0.5) * 0.30) * braced;

    sp.pitch.impulse(vmPitch * state.impScale.pitch);
    sp.yaw.impulse(vmYaw * state.impScale.yaw);
    sp.roll.impulse(vmRoll * state.impScale.roll);
    sp.posZ.impulse(d.recoil.kick * braced * state.impScale.pos);
    // A little lift and lateral shove so the kick is not a pure piston along Z.
    sp.posY.impulse(d.recoil.kick * 0.20 * braced * state.impScale.pos);
    sp.posX.impulse(vmYaw * 0.020 * state.impScale.pos);

    /* Settle. Negative, so the slow companion spring pulls the muzzle *through* the aim point
       as the primary comes home and then walks it back. Braced in ADS like everything else:
       a shoulder-welded rifle settles far less than one held out at arm's length.

       `burstFade` is not decoration. Mid-burst the arms never get to complete a settle — the
       next round arrives in 77 ms and the muzzle is still climbing — so a full-strength
       negative impulse every round would integrate into a standing downward sag fighting the
       recoil pattern the player is trying to learn. `lastShotTime` is still the *previous*
       round's at this point in fireOne, so this is the real interval: near zero inside a burst,
       full for a first shot or a deliberate semi-auto pace, which is exactly where a settle is
       something a shooter can actually see. */
    const since = (game.clock ? game.clock.time : 0) - state.lastShotTime;
    const burstFade = clamp((since - 0.06) / 0.22, 0.18, 1);
    const settle = lerp(1.0, 0.55, state.adsBlend) * burstFade;
    sp.settlePitch.impulse(-vmPitch * SETTLE_PITCH * settle * state.impScale.settlePitch);
    sp.settleRoll.impulse(-vmRoll * SETTLE_ROLL * settle * state.impScale.settleRoll);
    sp.settleZ.impulse(-d.recoil.kick * SETTLE_Z * settle * state.impScale.settleZ);

    /* --- Camera recoil (much softer than the viewmodel, ~1/2.2) ---------- */
    const camP = d.recoil.camPitch * pm * rp * lerp(1.0, 0.82, state.adsBlend);
    const camY = d.recoil.camYaw * (ym + ry) * lerp(1.0, 0.82, state.adsBlend);
    try {
      game.player?.applyRecoil?.(camP, camY);
      recoilAppliedPitch += camP;
      recoilAppliedYaw += camY;
    } catch { /* controller stub */ }
    state.recoverPitch += camP * d.recoil.recover;
    state.recoverYaw += camY * d.recoil.recover;
    state.recoverDelay = 0.09;

    /* --- Bolt cycle + dust cover ---------------------------------------- */
    state.boltTimer = state.boltDuration;
    state.coverTimer = 0.5;

    /* --- Spread bloom --------------------------------------------------- */
    state.bloom = Math.min(d.spread.bloomMax, state.bloom + d.spread.bloom);
    state.lastShotTime = game.clock ? game.clock.time : 0;
    state.idleTimer = 0;

    /* --- The shot event ------------------------------------------------- */
    // Dedicated vectors, not module scratch: `shot` listeners run synchronously but
    // ballistics is entitled to hold the payload for a frame, and scratch would be reused.
    const cam = game.camera;
    if (cam) {
      const origin = game.player && game.player.eye ? game.player.eye : cam.position;
      shotOrigin.copy(origin);
      // Raw camera forward. Ballistics owns applying the cone — we only report its width.
      shotDir.copy(_fwd).applyQuaternion(cam.quaternion).normalize();
      emit('shot', { origin: shotOrigin, dir: shotDir, weapon: d, spread: state.spread });
    }

    /* --- Muzzle flash --------------------------------------------------- */
    try {
      if (game.fx && game.fx.spawnMuzzle && cam) {
        muzzleWorld(fxPos);
        fxVel.copy(_fwd).applyQuaternion(cam.quaternion).normalize();
        game.fx.spawnMuzzle(fxPos, fxVel, d.id === 'dmr14' ? 1.35 : d.id === 'vector' ? 0.78 : 1.0);
      }
    } catch { /* fx stub */ }

    /* --- Brass ---------------------------------------------------------- */
    try {
      if (game.fx && game.fx.spawnCasing && cam) {
        const eo = entry.model.anchorObjs.eject;
        if (eo) {
          eo.getWorldPosition(fxPos);
          viewToWorld(fxPos);
          // Ejection velocity in the camera basis, so brass always leaves the port
          // outboard-and-up no matter which way the player is facing.
          const ed = entry.model.ejectDir;
          fxVel.set(ed[0], ed[1], ed[2]).normalize();
          fxVel.applyQuaternion(cam.quaternion);
          fxVel.multiplyScalar(2.1 + rng() * 0.9);
          // Inherit the player's motion, otherwise brass hangs in the air when sprinting.
          if (game.player && game.player.velocity) fxVel.add(game.player.velocity);
          game.fx.spawnCasing(fxPos, fxVel, 14 + rng() * 16);
        }
      }
    } catch { /* fx stub */ }

    if (mag <= 0) {
      // Bolt locks back on an empty magazine; the `ammo <= 0` test downstream holds the
      // carrier to the rear and the dust cover open until the reload feeds it.
      sfx('boltlock', { weapon: d.id });
    }
  }

  /* ====================================================================== */
  /* Coordinate helpers                                                     */
  /* ====================================================================== */

  const _invView = new THREE.Matrix4();

  /**
   * Convert a position in viewmodel-scene world space into world-scene world space.
   * The viewmodel scene is rendered with its own camera; anything handed to `fx` (which
   * lives in the world scene) has to be re-anchored to the world camera or the muzzle
   * flash appears somewhere behind the player.
   */
  function viewToWorld(v) {
    const vc = game.viewCamera;
    const wc = game.camera;
    if (!vc || !wc) return v;
    vc.updateMatrixWorld();
    wc.updateMatrixWorld();
    _invView.copy(vc.matrixWorld).invert();
    v.applyMatrix4(_invView); // -> camera-local
    v.applyMatrix4(wc.matrixWorld); // -> world
    return v;
  }

  function muzzleWorld(target) {
    const entry = state.entry;
    if (!entry || !entry.model.anchorObjs || !entry.model.anchorObjs.muzzle) {
      if (game.camera) target.copy(game.camera.position);
      else target.set(0, 0, 0);
      return target;
    }
    entry.model.anchorObjs.muzzle.getWorldPosition(target);
    viewToWorld(target);
    return target;
  }

  function muzzleDirWorld(target) {
    const cam = game.camera;
    if (!cam) return target.set(0, 0, -1);
    return target.copy(_fwd).applyQuaternion(cam.quaternion).normalize();
  }

  /* ====================================================================== */
  /* Per-frame                                                              */
  /* ====================================================================== */

  const hipP = new THREE.Vector3();
  const hipR = new THREE.Vector3();
  const targetP = new THREE.Vector3();
  const targetR = new THREE.Vector3();
  const handTargetR = new THREE.Vector3();
  const handTargetL = new THREE.Vector3();
  const handQuatR = new THREE.Quaternion();
  const handQuatL = new THREE.Quaternion();
  const anchorPos = new THREE.Vector3();
  const anchorQuat = new THREE.Quaternion();
  const anchorScale = new THREE.Vector3();
  const poleTmpR = new THREE.Vector3();
  const poleTmpL = new THREE.Vector3();
  const shoulderTmpR = new THREE.Vector3();
  const shoulderTmpL = new THREE.Vector3();
  /* Damped follower of the recoil transform plus the residual the body has not absorbed. See
     the residual-recoil block in update(). Preallocated: this is the hot path. */
  const lagPos = new THREE.Vector3();
  const lagRot = new THREE.Vector3();
  const resPos = new THREE.Vector3();
  const resRot = new THREE.Vector3();
  /* Where the mass-lag rotation pivots, in camera space: the buttstock in the shoulder pocket,
     roughly 20 cm behind, 9 cm right and 14 cm below the eye. */
  const MASS_PIVOT = new THREE.Vector3(0.086, -0.138, 0.202);

  let baseWorldFov = 0;
  let baseViewFov = 0;
  let lastAdsEmit = false;
  let lookPrevYaw = 0;
  let lookPrevPitch = 0;
  let recoilAppliedYaw = 0;
  let recoilAppliedPitch = 0;

  /** Read a local-space anchor transform into `recoilGrp` space. */
  function localiseAnchor(anchor, outPos, outQuat) {
    _m1.copy(recoilGrp.matrixWorld).invert();
    _m2.multiplyMatrices(_m1, anchor.matrixWorld);
    _m2.decompose(outPos, outQuat, anchorScale);
  }

  /**
   * Local edge detection.
   *
   * `main.js` calls `input.update(dt)` at the *top* of the frame, which clears the
   * edge sets and zeroes the deltas before any subsystem runs, so `input.pressed()` is
   * empty by the time we get here. The persistent state (`keys`, `mouse.left/right`) is
   * untouched though, so we latch it ourselves. We still honour `input.pressed()` when it
   * does report an edge, in case the ordering is ever corrected upstream.
   */
  const held = { Digit1: false, Digit2: false, Digit3: false, KeyR: false, KeyF: false, left: false, right: false };

  function edge(input, code) {
    const now = !!(input.down && input.down(code));
    const was = held[code];
    held[code] = now;
    return (now && !was) || !!(input.pressed && input.pressed(code));
  }

  function readInput() {
    const input = game.input;
    if (!input) return;

    if (edge(input, 'Digit1')) switchTo('mk18');
    if (edge(input, 'Digit2')) switchTo('vector');
    if (edge(input, 'Digit3')) switchTo('dmr14');
    if (input.mouse && input.mouse.wheel) cycleWeapon(input.mouse.wheel > 0 ? 1 : -1);

    if (edge(input, 'KeyR')) reload();
    if (edge(input, 'KeyF') && !state.reloading && !state.switching && !anim.clip) {
      playClip(
        clipInspect(),
        (ev) => {
          if (ev === 'charge') sfx('boltback', { weapon: state.current ? state.current.id : null });
          if (ev === 'boltHome') sfx('boltrelease', { weapon: state.current ? state.current.id : null });
        },
        null
      );
      sfx('inspect', { weapon: state.current ? state.current.id : null });
    }

    const m = input.mouse;
    if (m) {
      const nowLeft = !!m.left || !!m.leftPressed;
      if (nowLeft && !held.left) triggerDown();
      else if (!nowLeft && held.left) triggerUp();
      held.left = nowLeft;
      held.right = !!m.right;
      // ADS is a hold, unless capture mode has forced it.
      state.ads = state.adsForced !== null ? state.adsForced : held.right;
    }
  }

  function triggerDown() {
    state.triggerHeld = true;
    state.firedThisPull = false;
    // A fresh trigger pull always resets the burst so the pattern is learnable from round 1.
    if (game.clock && game.clock.time - state.lastShotTime > 0.32) state.burstIndex = 0;
  }

  function triggerUp() {
    state.triggerHeld = false;
    state.firedThisPull = false;
    state.blockUntilRelease = false;
  }

  function update(dt, g) {
    const gm = g || game;
    if (!state.current) return;
    const d = state.current;
    const entry = state.entry;

    if (baseWorldFov === 0 && gm.camera) baseWorldFov = gm.camera.fov || CAMERA.fov;
    if (baseViewFov === 0 && gm.viewCamera) baseViewFov = gm.viewCamera.fov || CAMERA.viewmodelFov;

    readInput();

    /* --- Effective look delta ---------------------------------------------
       Prefer the raw mouse delta, but fall back to the frame-over-frame change in the
       player's yaw/pitch when it is unavailable (see readInput's note on frame ordering).
       The recoil we pushed into the controller ourselves is subtracted out, otherwise every
       shot would double-count as a mouse flick and the sway would fight the recoil spring. */
    let lookDx = 0;
    let lookDy = 0;
    const rawMouse = !!(gm.input && gm.input.mouse && (gm.input.mouse.dx !== 0 || gm.input.mouse.dy !== 0));
    if (rawMouse) {
      lookDx = gm.input.mouse.dx;
      lookDy = gm.input.mouse.dy;
    } else if (gm.player && typeof gm.player.yaw === 'number') {
      let dYaw = gm.player.yaw - lookPrevYaw;
      // Shortest way round, so the wrap at +/-PI does not produce a huge phantom flick.
      if (dYaw > Math.PI) dYaw -= Math.PI * 2;
      else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const dPitch = (gm.player.pitch || 0) - lookPrevPitch;
      const sens = gm.input && gm.input.sensitivity ? gm.input.sensitivity : 0.0022;
      // Whatever we pushed into the controller ourselves is subtracted first — including
      // the auto-recentre, or the recentre would read as a mouse move and cancel itself.
      lookDx = -(dYaw - recoilAppliedYaw) / sens;
      lookDy = -(dPitch - recoilAppliedPitch) / sens;
    }
    if (gm.player) {
      lookPrevYaw = gm.player.yaw || 0;
      lookPrevPitch = gm.player.pitch || 0;
    }
    recoilAppliedYaw = 0;
    recoilAppliedPitch = 0;
    // A spike on lock acquisition would launch the viewmodel off screen.
    lookDx = clamp(lookDx, -400, 400);
    lookDy = clamp(lookDy, -400, 400);

    /* --- Root follows the viewmodel camera exactly ------------------------ */
    // Everything downstream is therefore expressed in metres relative to the eye, which is
    // what makes the derived ADS pose exact.
    if (gm.viewCamera) {
      gm.viewCamera.updateMatrixWorld();
      gm.viewCamera.matrixWorld.decompose(root.position, root.quaternion, _v8);
      root.scale.set(1, 1, 1);
    }

    /* --- Animation clip --------------------------------------------------- */
    for (const k in CHANNEL_DEFAULTS) channels[k] = CHANNEL_DEFAULTS[k];

    if (anim.clip) {
      const clip = anim.clip;
      anim.time += dt;
      // Fire any events we have passed this frame, in order.
      while (clip.events && anim.nextEvent < clip.events.length && anim.time >= clip.events[anim.nextEvent][0]) {
        const ev = clip.events[anim.nextEvent][1];
        anim.nextEvent++;
        if (anim.onEvent) {
          try {
            anim.onEvent(ev);
          } catch { /* keep the clip running */ }
        }
      }
      const t = clip.hold ? Math.min(anim.time, clip.duration) : anim.time;
      for (const key in clip.tracks) {
        if (channels[key] === undefined) continue;
        channels[key] = sampleTrack(clip.tracks[key], t);
      }
      // Late tracks override once the fresh magazine exists (a channel can only carry one
      // curve, and the mag's motion is genuinely two separate objects).
      if (clip.tracksLate && t >= clip.lateFrom) {
        for (const key in clip.tracksLate) {
          if (channels[key] === undefined) continue;
          channels[key] = sampleTrack(clip.tracksLate[key], t);
        }
      }
      if (anim.time >= clip.duration) {
        const done = anim.onDone;
        if (!clip.hold) stopClip();
        else {
          anim.onDone = null;
          anim.onEvent = null;
        }
        if (done) {
          try {
            done();
          } catch { /* keep going */ }
        }
      }
    }

    /* --- Sprint pose blend --------------------------------------------------
       Sprinting cants the weapon down and inboard, but wanting to shoot or aim overrides
       it: the gun comes back up over ~0.1 s and only then is the trigger live. That is the
       difference between "sprint locks you out" (feels broken) and "sprint costs you a
       tenth of a second" (feels like a weapon with weight). */
    const sprintingRaw = !!(gm.player && gm.player.sprinting);
    const wantsWeaponUp = state.ads || state.triggerHeld;
    const sprintWant = sprintingRaw && !state.reloading && !wantsWeaponUp ? 1 : 0;
    /* Spring, not a lerp. k = 150 / zeta = 0.62 peaks at about 0.23 s with ~8% overshoot, so
       the weapon arrives at the sprint pose slightly past it and settles in — the same
       follow-through an animator would key.
       `sbPose` subtracts the spring's own velocity, which is where the anticipation comes
       from and costs nothing: at the start of a transition the velocity is large and pointing
       at the target, so subtracting it drives the blend briefly *negative* and the weapon
       lifts a few degrees away from the sprint pose before dropping into it. Coming out of
       the sprint the velocity is negative, so the same term pushes the blend past 1 first.
       Anticipation on the way in, follow-through on the way out, one line, no keyframes.
       `sb` stays clean 0..1 because the fire and ADS gates below are thresholds and must not
       see the overshoot. */
    sp.sprint.target = sprintWant;
    sp.sprint.step(dt);
    const sb = clamp(sp.sprint.value, 0, 1);
    const sbPose = clamp(sp.sprint.value - clamp(sp.sprint.vel, -9, 9) * 0.026, -0.16, 1.16);

    /* --- ADS -------------------------------------------------------------- */
    const adsAllowed = !state.reloading && !state.switching && sb < 0.45 && !(anim.clip && anim.clip.name === 'inspect');
    const adsWant = state.ads && adsAllowed;
    const adsRate = 1 / Math.max(0.05, d.adsTime);
    state.adsProgress = clamp(state.adsProgress + (adsWant ? dt * adsRate : -dt * adsRate * 1.22), 0, 1);
    state.adsBlend = smootherstep(state.adsProgress);

    if (adsWant !== lastAdsEmit) {
      lastAdsEmit = adsWant;
      emit('ads', { active: adsWant, weapon: d });
      sfx(adsWant ? 'adsin' : 'adsout', { weapon: d.id });
    }

    // FOV pull. The world camera does the real work; the viewmodel camera narrows a little
    // so the gun grows slightly in frame rather than staying pinned.
    if (gm.camera) {
      // Re-read the base each frame while hip-firing so the settings FOV slider still works.
      if (state.adsBlend < 0.001) baseWorldFov = gm.camera.fov;
      const want = lerp(baseWorldFov, d.adsFov, state.adsBlend);
      if (Math.abs(gm.camera.fov - want) > 0.01) {
        gm.camera.fov = want;
        gm.camera.updateProjectionMatrix();
      }
    }
    if (gm.viewCamera) {
      if (state.adsBlend < 0.001) baseViewFov = gm.viewCamera.fov;
      const wantV = lerp(baseViewFov, d.viewFov, state.adsBlend);
      if (Math.abs(gm.viewCamera.fov - wantV) > 0.01) {
        gm.viewCamera.fov = wantV;
        gm.viewCamera.updateProjectionMatrix();
      }
    }

    /* --- Spread ------------------------------------------------------------ */
    // Computed before firing so the round that goes out this frame reports the cone it was
    // actually fired into, rather than last frame's.
    state.spread = computeSpread(dt);
    weapon.spread = state.spread;

    /* --- Fire control ----------------------------------------------------- */
    const canFire =
      !state.reloading &&
      !state.switching &&
      !state.blockUntilRelease &&
      !(anim.clip && anim.clip.name === 'inspect') &&
      sb < 0.35;
    const interval = 60 / Math.max(1, d.rpm);

    // The accumulator runs regardless of trigger state so the very first round of a pull is
    // never delayed, and it is capped so a 20 Hz frame cannot dump a whole magazine.
    state.shotClock = Math.min(state.shotClock + dt, interval * 4);

    if (canFire && state.triggerHeld) {
      let guard = 4;
      while (state.shotClock >= interval && guard-- > 0) {
        if (!d.auto && state.firedThisPull) break;
        if (ammoOf(d.id) <= 0) {
          if (!state.firedThisPull) {
            sfx(d.audio.dry, { weapon: d.id });
            state.firedThisPull = true;
            // A single soft click on the viewmodel, so a dry trigger still has feedback.
            sp.pitch.impulse(0.010);
            sp.posZ.impulse(0.10);
          }
          state.shotClock = 0;
          break;
        }
        state.shotClock -= interval;
        state.firedThisPull = true;
        fireOne();
      }
      if (state.shotClock > interval) state.shotClock = interval;
    } else if (!state.triggerHeld) {
      state.shotClock = Math.min(state.shotClock, interval);
    }

    weapon.firing = state.triggerHeld && canFire && ammoOf(d.id) > 0;

    // Burst decay: stop firing for a third of a second and the pattern resets.
    if (gm.clock && gm.clock.time - state.lastShotTime > 0.34) state.burstIndex = 0;

    /* --- Camera recoil recovery ------------------------------------------- */
    if (state.recoverDelay > 0) state.recoverDelay -= dt;
    if (!state.triggerHeld && state.recoverDelay <= 0 && (state.recoverPitch !== 0 || state.recoverYaw !== 0)) {
      const k = approach(11, dt);
      const dp = state.recoverPitch * k;
      const dy = state.recoverYaw * k;
      state.recoverPitch -= dp;
      state.recoverYaw -= dy;
      try {
        gm.player?.applyRecoil?.(-dp, -dy);
        recoilAppliedPitch -= dp;
        recoilAppliedYaw -= dy;
      } catch { /* stub */ }
      if (Math.abs(state.recoverPitch) < 1e-6) state.recoverPitch = 0;
      if (Math.abs(state.recoverYaw) < 1e-6) state.recoverYaw = 0;
    }
    // If the player takes over and steers, abandon the debt — auto-recentre must never
    // fight deliberate aiming. Only trusted when we have a genuine mouse delta; the
    // yaw-difference fallback cannot tell a deliberate flick from our own recentre.
    if (rawMouse) {
      const mag = Math.abs(lookDx) + Math.abs(lookDy);
      if (mag > 6) {
        const cancel = Math.min(1, mag / 90);
        state.recoverPitch *= 1 - cancel;
        state.recoverYaw *= 1 - cancel;
      }
    }

    /* --- Sway (look lag + breathing + bob) --------------------------------- */
    // The gun trails the view: the spring targets track the look delta, and because the
    // target collapses to zero the moment the mouse stops, the gun swings back through
    // centre rather than snapping. That overshoot-and-settle is the whole feel of "weight".
    const swaySuppress = lerp(1.0, 0.16, state.adsBlend);
    sp.swayX.target = clamp(-lookDx * 0.000100, -0.0130, 0.0130) * swaySuppress;
    sp.swayY.target = clamp(lookDy * 0.000092, -0.0115, 0.0115) * swaySuppress;
    sp.swayYaw.target = clamp(-lookDx * 0.00120, -0.130, 0.130) * swaySuppress;
    sp.swayPitch.target = clamp(lookDy * 0.00105, -0.110, 0.110) * swaySuppress;
    sp.swayRoll.target = clamp(-lookDx * 0.00095, -0.100, 0.100) * swaySuppress;
    sp.swayX.step(dt);
    sp.swayY.step(dt);
    sp.swayYaw.step(dt);
    sp.swayPitch.step(dt);
    sp.swayRoll.step(dt);

    const time = gm.clock ? gm.clock.time : 0;
    // Idle breathing: two out-of-phase sines so the loop never reads as a metronome.
    const breathAmp = lerp(1.0, 0.22, state.adsBlend) * (state.reloading ? 0.4 : 1);
    const brX = (Math.sin(time * 1.05) * 0.0021 + Math.sin(time * 0.41 + 1.3) * 0.0013) * breathAmp;
    const brY = (Math.sin(time * 1.31 + 0.7) * 0.0026 + Math.sin(time * 0.53) * 0.0014) * breathAmp;

    // Movement bob, spring-free but speed-scaled and suppressed in ADS.
    let bobX = 0;
    let bobY = 0;
    let bobRoll = 0;
    if (gm.player && gm.player.velocity && gm.player.onGround !== false) {
      const vx = gm.player.velocity.x;
      const vz = gm.player.velocity.z;
      const speed = Math.sqrt(vx * vx + vz * vz);
      const amp = clamp(speed / 6.1, 0, 1.25) * lerp(1.0, 0.14, state.adsBlend);
      const ph = time * (6.4 + speed * 0.55);
      bobX = Math.sin(ph) * 0.0125 * amp;
      bobY = -Math.abs(Math.cos(ph)) * 0.0092 * amp + 0.0046 * amp;
      bobRoll = Math.sin(ph) * 0.026 * amp;
    }

    /* --- Weapon mass: the muzzle trails a direction change -------------------
       The sway springs above are fast and track the mouse almost frame for frame, which gives
       lag but not *weight* — lag alone reads as latency. Weight is what happens at the moment
       the player reverses: a real 3 kg rifle held out in front of the chest has enough moment
       of inertia that the muzzle is still travelling the old way when the shoulders have
       already started the new one, so it crosses the aim line and comes back.
       These springs are an order of magnitude slower than the sway ones (26/30 against 70) and
       their target is the *normalised* turn rate, so they saturate on a fast flick and cannot
       be driven off screen by a huge delta. Suppressed hard in ADS, where the stock is in the
       shoulder and the eye is on the glass — there is nothing left to swing. */
    const massSuppress = lerp(1.0, 0.26, state.adsBlend) * lerp(1.0, 0.55, sb);
    sp.massYaw.target = clamp(-lookDx * 0.0022, -1, 1) * 0.088 * massSuppress;
    sp.massPitch.target = clamp(lookDy * 0.0020, -1, 1) * 0.062 * massSuppress;
    sp.massYaw.step(dt);
    sp.massPitch.step(dt);
    const massYaw = sp.massYaw.value;
    const massPitch = sp.massPitch.value;
    const massRoll = -massYaw * 0.38;

    sway.position.set(sp.swayX.value + brX + bobX, sp.swayY.value + brY + bobY, 0);
    sway.rotation.set(
      sp.swayPitch.value + massPitch,
      sp.swayYaw.value + massYaw,
      sp.swayRoll.value + bobRoll + massRoll
    );
    /* Pivot the mass rotation at the shoulder pocket instead of the eye. Rotating about a
       point P is a rotation about the origin plus a translation of (P - R·P); doing it here
       rather than with another Group keeps the graph flat and the whole thing allocation free.
       Without it the buttstock swings as far as the muzzle and the gun reads as a signpost
       being waved; with it the butt stays roughly planted in the shoulder and only the front
       end travels, which is the actual mechanics of the movement. */
    if (massYaw !== 0 || massPitch !== 0) {
      _e1.set(massPitch, massYaw, massRoll);
      _q1.setFromEuler(_e1);
      _v1.copy(MASS_PIVOT).applyQuaternion(_q1);
      sway.position.x += MASS_PIVOT.x - _v1.x;
      sway.position.y += MASS_PIVOT.y - _v1.y;
      sway.position.z += MASS_PIVOT.z - _v1.z;
    }

    /* --- Recoil springs ---------------------------------------------------- */
    sp.pitch.step(dt);
    sp.yaw.step(dt);
    sp.roll.step(dt);
    sp.posZ.step(dt);
    sp.posY.step(dt);
    sp.posX.step(dt);
    sp.settlePitch.step(dt);
    sp.settleRoll.step(dt);
    sp.settleZ.step(dt);

    // Clamp the settle tails so sustained fire cannot integrate them into a standing sag.
    const setP = clamp(sp.settlePitch.value, -d.recoil.pitch * SETTLE_CLAMP, d.recoil.pitch * SETTLE_CLAMP);
    const setR = clamp(sp.settleRoll.value, -d.recoil.roll * SETTLE_CLAMP, d.recoil.roll * SETTLE_CLAMP);
    const setZ = clamp(sp.settleZ.value, -d.recoil.kick * SETTLE_CLAMP, d.recoil.kick * SETTLE_CLAMP);

    recoilGrp.position.set(sp.posX.value, sp.posY.value, sp.posZ.value + setZ);
    recoilGrp.rotation.set(sp.pitch.value + setP, sp.yaw.value, sp.roll.value + setR);

    /* --- Residual recoil: what the hands and shoulders do *not* follow -------
       `armsGrp` hangs off `recoilGrp`, so left alone the arms and the weapon move as one rigid
       body — the gun, both gloves and both shoulders all kick by exactly the same amount, and
       that is the single biggest reason a procedural viewmodel reads as a prop being waved
       rather than a weapon being fired. In reality the support hand is braced round the
       handguard and the receiver moves *within* it, and the shoulders barely move at all.
       `lagPos/lagRot` is a damped follower of the recoil transform: what the body has caught up
       with so far. The difference between the live transform and that follower is the part the
       body has not absorbed yet, and subtracting a fraction of it from the IK targets is what
       lets the gun cycle inside the hands. Everything below is in `recoilGrp` local space, so
       the rotation pivot is simply the local origin. */
    const bodyK = approach(24, dt);
    lagPos.x += (sp.posX.value - lagPos.x) * bodyK;
    lagPos.y += (sp.posY.value - lagPos.y) * bodyK;
    lagPos.z += (sp.posZ.value + setZ - lagPos.z) * bodyK;
    lagRot.x += (sp.pitch.value + setP - lagRot.x) * bodyK;
    lagRot.y += (sp.yaw.value - lagRot.y) * bodyK;
    lagRot.z += (sp.roll.value + setR - lagRot.z) * bodyK;
    resPos.set(sp.posX.value - lagPos.x, sp.posY.value - lagPos.y, sp.posZ.value + setZ - lagPos.z);
    resRot.set(
      sp.pitch.value + setP - lagRot.x,
      sp.yaw.value - lagRot.y,
      sp.roll.value + setR - lagRot.z
    );

    /* --- Pose blend: hip -> low-ready -> sprint -> ADS ---------------------- */
    state.idleTimer = weapon.firing || state.reloading || state.switching ? 0 : state.idleTimer + dt;
    const readyBlend = state.adsBlend > 0.02 ? 0 : smootherstep(clamp((state.idleTimer - 2.6) / 1.6, 0, 1));

    hipP.set(d.hip.p[0], d.hip.p[1], d.hip.p[2]);
    hipR.set(d.hip.r[0], d.hip.r[1], d.hip.r[2]);
    if (readyBlend > 0) {
      hipP.lerp(_v1.set(d.readyPose.p[0], d.readyPose.p[1], d.readyPose.p[2]), readyBlend);
      hipR.lerp(_v2.set(d.readyPose.r[0], d.readyPose.r[1], d.readyPose.r[2]), readyBlend);
    }

    if (Math.abs(sbPose) > 0.001) {
      // lerp with t outside [0,1] extrapolates, which is exactly what the anticipation and the
      // follow-through need — see sbPose above.
      hipP.lerp(_v1.set(d.sprintPose.p[0], d.sprintPose.p[1], d.sprintPose.p[2]), sbPose);
      hipR.lerp(_v2.set(d.sprintPose.r[0], d.sprintPose.r[1], d.sprintPose.r[2]), sbPose);
    }

    targetP.copy(hipP);
    targetR.copy(hipR);
    if (state.adsBlend > 0.0001) {
      targetP.lerp(_v1.set(d.adsPose.p[0], d.adsPose.p[1], d.adsPose.p[2]), state.adsBlend);
      targetR.lerp(_v2.set(0, 0, 0), state.adsBlend);
    }

    // Clip-driven additive offsets on top of the pose.
    poseGrp.position.set(
      targetP.x + channels.gunX,
      targetP.y + channels.gunY,
      targetP.z + channels.gunZ
    );
    poseGrp.rotation.set(
      targetR.x + channels.gunPitch,
      targetR.y + channels.gunYaw,
      targetR.z + channels.gunRoll
    );

    /* --- Animated parts ---------------------------------------------------- */
    const parts = entry.model.parts;
    const scaleInv = 1 / Math.max(1e-4, d.scale);

    // Magazine.
    if (parts.mag) {
      const home = parts.magHome;
      parts.mag.position.set(
        home.x + channels.magX * scaleInv,
        home.y + channels.magY * scaleInv,
        home.z + channels.magZ * scaleInv
      );
      parts.mag.rotation.set(parts.magRotHome + channels.magPitch, 0, channels.magRoll);
      parts.mag.visible = channels.magHidden < 0.5;
    }

    // Bolt carrier: the clip can drive it (empty reload / inspect) and the fire loop kicks it.
    let boltZ = channels.boltZ;
    if (state.boltTimer > 0) {
      state.boltTimer = Math.max(0, state.boltTimer - dt);
      const u = 1 - state.boltTimer / state.boltDuration;
      // Out fast, back slower — real reciprocating mass, not a symmetric ping-pong.
      boltZ = Math.max(boltZ, u < 0.34 ? (u / 0.34) * 0.030 : (1 - (u - 0.34) / 0.66) * 0.030);
    }
    if (ammoOf(d.id) <= 0 && !state.reloading) boltZ = Math.max(boltZ, 0.030);
    if (parts.bolt) parts.bolt.position.z = boltZ * scaleInv;
    if (parts.chargingHandle) parts.chargingHandle.position.z = channels.chargeZ * scaleInv;

    // Dust cover: springs open on the first shot, drifts shut a beat after the last.
    if (state.coverTimer > 0 && state.coverTimer < 900) state.coverTimer = Math.max(0, state.coverTimer - dt);
    let coverWant = channels.coverOpen;
    if (state.coverTimer > 0) coverWant = 1;
    if (ammoOf(d.id) <= 0 && !state.reloading) coverWant = 1;
    state._cover = state._cover === undefined ? 0 : state._cover;
    state._cover += (coverWant - state._cover) * approach(coverWant > state._cover ? 34 : 9, dt);
    if (parts.dustPivot) parts.dustPivot.rotation.z = -state._cover * 1.35;

    // Trigger travel follows the actual trigger, with a short reset.
    if (parts.trigger) {
      const tw = weapon.firing ? 1 : state.triggerHeld ? 0.75 : 0;
      state._trig = state._trig === undefined ? 0 : state._trig;
      state._trig += (tw - state._trig) * approach(30, dt);
      parts.trigger.rotation.x = state._trig * 0.34;
    }

    // Safety selector snaps to FIRE the moment the trigger is live.
    if (parts.selector) {
      const sw = state.reloading || state.switching || sb > 0.6 ? 0 : 1;
      state._sel = state._sel === undefined ? 0 : state._sel;
      state._sel += (sw - state._sel) * approach(16, dt);
      parts.selector.rotation.z = -state._sel * 1.55;
    }

    /* --- World matrices before IK and the reticle --------------------------- */
    root.updateMatrixWorld(true);

    /* --- Reticle: parallax free, but confined to the aperture --------------- */
    const optic = parts.optic;
    if (optic && optic.reticle && gm.viewCamera) {
      const sa = optic.sightAnchor;
      sa.getWorldPosition(_v1);
      sa.getWorldQuaternion(_q1);
      _v2.copy(_fwd).applyQuaternion(_q1).normalize(); // optic's own boresight
      gm.viewCamera.getWorldPosition(_v3);
      /* The reticle lives in the plane of the glass, not at an arbitrary distance. Solving
         for the point in that plane whose direction from the eye *is* the boresight gives
         a genuinely collimated dot: R = E + F * ((C - E).F).

         The old code used |A - E| for that scalar, which is only equal when the eye is on
         the optic's axis. In hipfire the eye is 14 cm inboard and 7 cm above, so the solved
         point fell tens of centimetres outside the tube and the dot rendered as a free red
         pip floating at screen centre with no relationship to the sight — which is exactly
         what the frames show. Clamping it into the aperture is what a real optic does
         optically (you lose the reticle off axis), and it puts the glow back inside the
         glass where a viewer expects to see it. */
      if (optic.reticlePlane) optic.reticlePlane.getWorldPosition(_v5);
      else _v5.copy(_v1);
      _v5.sub(_v3); // C - E
      const along = Math.max(0.02, _v5.dot(_v2));
      _v5.copy(_v3).addScaledVector(_v2, along); // R, before clamping
      // Lateral offset of R from the optic's own axis, measured in the glass plane.
      _v6.subVectors(_v5, _v1);
      _v6.addScaledVector(_v2, -_v6.dot(_v2));
      const off = _v6.length();
      const rMax = (optic.glassR || 0.015) * d.scale * 0.62;
      let edge = 1;
      if (off > rMax) {
        // Slide the dot back to the aperture edge and fade it out over the next half radius,
        // so walking off axis dims and pins the glow instead of letting it escape the tube.
        _v5.addScaledVector(_v6, (rMax - off) / off);
        edge = clamp(1 - (off - rMax) / (rMax * 1.6), 0.16, 1);
      }
      _v4.copy(_v5);
      optic.reticle.parent.worldToLocal(_v4);
      optic.reticle.position.copy(_v4);
      // Screen-aligned.
      gm.viewCamera.getWorldQuaternion(_q2);
      optic.reticle.parent.getWorldQuaternion(_q3);
      _q3.invert().multiply(_q2);
      optic.reticle.quaternion.copy(_q3);
      // Constant angular size: ~0.0035 rad half-width, roughly 4 px at 1080p in ADS. Off
      // axis it is scaled up a little so the glow still reads as a lit emitter inside the
      // glass rather than collapsing to a sub-pixel speck.
      const dist = Math.max(0.02, _v3.distanceTo(_v5));
      const s = dist * (0.0035 + 0.0016 * (1 - state.adsBlend)) * scaleInv;
      optic.reticle.scale.setScalar(s);
      // In ADS the dot is the aim point and runs hot; in hipfire it is only the glow you see
      // through the objective, so it drops to a fraction and takes the aperture fade with it.
      const vis = (0.30 + 0.70 * state.adsBlend) * edge;
      mats.reticle.opacity = vis;
      mats.reticleGlow.opacity = 0.55 * vis;
      optic.reticle.visible = vis > 0.02;
    }

    /* --- Arms IK ----------------------------------------------------------- */
    const ao = entry.model.anchorObjs;
    if (ao && ao.gripFire && ao.gripSupport) {
      /* Firing hand: locked to the pistol grip, always. */
      localiseAnchor(ao.gripFire, anchorPos, anchorQuat);
      handTargetR.copy(anchorPos);
      handQuatR.copy(anchorQuat);
      if (channels.fireOff > 0.001) {
        // During a lower/raise the firing hand drops with the gun but relaxes slightly.
        handTargetR.y -= channels.fireOff * 0.05;
      }

      /* Support hand: handguard -> magazine -> bolt catch, blended by the clip. */
      localiseAnchor(ao.gripSupport, anchorPos, anchorQuat);
      handTargetL.copy(anchorPos);
      handQuatL.copy(anchorQuat);
      if (channels.supportToMag > 0.001 && ao.magGrab) {
        localiseAnchor(ao.magGrab, _v1, _q1);
        handTargetL.lerp(_v1, channels.supportToMag);
        handQuatL.slerp(_q1, channels.supportToMag);
      }
      if (channels.supportToBolt > 0.001 && ao.boltCatch) {
        localiseAnchor(ao.boltCatch, _v1, _q1);
        handTargetL.lerp(_v1, channels.supportToBolt);
        handQuatL.slerp(_q1, channels.supportToBolt);
      }
      if (channels.supportOff > 0.001) {
        // Inspect / sprint: the support hand comes off the gun and drops away.
        _v1.set(-0.055, -0.28, -0.14);
        handTargetL.lerp(_v1, channels.supportOff);
      }
      // Sprint drops both hands a touch further and rolls the wrists in.
      if (sb > 0.001) {
        handTargetL.y -= sb * 0.020;
        handTargetR.y -= sb * 0.012;
      }

      /* Apply the residual give. The support hand keeps most of its position while the
         handguard cycles through it; the firing hand is closed round the grip and follows
         nearly all of it; the shoulders are on a body and follow almost none. The rotation is
         applied about the local origin, which *is* the recoil pivot, and to the hand's
         orientation as well as its position — a hand that translates with the gun but does not
         rotate with it looks broken in a way that is hard to name and impossible to unsee. */
      const anyRes =
        resPos.lengthSq() > 1e-12 || resRot.lengthSq() > 1e-12;
      if (anyRes) {
        _e1.set(-resRot.x * GIVE_SUPPORT, -resRot.y * GIVE_SUPPORT, -resRot.z * GIVE_SUPPORT);
        _q2.setFromEuler(_e1);
        handTargetL.applyQuaternion(_q2).addScaledVector(resPos, -GIVE_SUPPORT);
        handQuatL.premultiply(_q2);

        _e1.set(-resRot.x * GIVE_FIRE, -resRot.y * GIVE_FIRE, -resRot.z * GIVE_FIRE);
        _q2.setFromEuler(_e1);
        handTargetR.applyQuaternion(_q2).addScaledVector(resPos, -GIVE_FIRE);
        handQuatR.premultiply(_q2);

        _e1.set(-resRot.x * GIVE_SHOULDER, -resRot.y * GIVE_SHOULDER, -resRot.z * GIVE_SHOULDER);
        _q2.setFromEuler(_e1);
        shoulderTmpR.copy(shoulderR).applyQuaternion(_q2).addScaledVector(resPos, -GIVE_SHOULDER);
        shoulderTmpL.copy(shoulderL).applyQuaternion(_q2).addScaledVector(resPos, -GIVE_SHOULDER);
      } else {
        shoulderTmpR.copy(shoulderR);
        shoulderTmpL.copy(shoulderL);
      }

      /* Right arm. */
      armR.hand.position.copy(handTargetR);
      armR.hand.quaternion.copy(handQuatR);
      // The wrist sits behind the palm along the hand's own +Z.
      _v1.set(0, 0.006, 0.052).applyQuaternion(handQuatR).add(handTargetR);
      poleTmpR.copy(poleR);
      solveTwoBone(shoulderTmpR, _v1, armR.lengths.upper, armR.lengths.fore, poleTmpR, elbowR, wristR);
      aimLimb(armR.upper, shoulderTmpR, elbowR, _q1);
      aimLimb(armR.fore, elbowR, wristR, _q1);

      /* Left arm. */
      armL.hand.position.copy(handTargetL);
      armL.hand.quaternion.copy(handQuatL);
      _v1.set(0, 0.006, 0.052).applyQuaternion(handQuatL).add(handTargetL);
      // The support elbow tucks under the rifle; bias the pole with the gun's roll so it
      // follows the weapon when the gun cants during a reload.
      poleTmpL.copy(poleL);
      poleTmpL.applyAxisAngle(_fwd, channels.gunRoll * 0.6);
      solveTwoBone(shoulderTmpL, _v1, armL.lengths.upper, armL.lengths.fore, poleTmpL, elbowL, wristL);
      aimLimb(armL.upper, shoulderTmpL, elbowL, _q1);
      aimLimb(armL.fore, elbowL, wristL, _q1);
    }

    /* --- Trigger finger -----------------------------------------------------
       The blade below moves 0.34 rad; the finger on it has to move with it or the two visibly
       separate. `_trig` is the same signal the blade uses, so they cannot drift apart.
       On top of that the finger *indexes* — comes off the trigger and lies straight along the
       receiver — whenever the weapon is not live: sprinting, reloading, swapping. That is
       real weapon handling and it is one of the few animation details a viewer notices
       consciously rather than just feeling. */
    if (armR.triggerFinger) {
      const idxWant = state.reloading || state.switching || sb > 0.45 ? 1 : 0;
      state._fingerIdx = state._fingerIdx === undefined ? 0 : state._fingerIdx;
      state._fingerIdx += (idxWant - state._fingerIdx) * approach(11, dt);
      // Negative rotation curls (see the finger layout in buildHand); positive straightens.
      armR.triggerFinger.rotation.x = state._fingerIdx * 0.42 - (state._trig || 0) * 0.3;
      armR.triggerFinger.rotation.y = state._fingerIdx * -0.16;
    }

    /* --- Public mirror ----------------------------------------------------- */
    weapon.ads = adsWant;
    weapon.adsProgress = state.adsProgress;
    weapon.ammo = ammoOf(d.id);
    weapon.reserve = reserveOf(d.id);
    weapon.reloading = state.reloading;
    weapon.reloadKind = state.reloadKind;
    weapon.switching = state.switching;
    weapon.current = d;
  }

  /* ====================================================================== */
  /* Public API                                                             */
  /* ====================================================================== */

  const weapon = {
    current: null,
    weapons: defs,
    ads: false,
    adsProgress: 0,
    ammo: 0,
    reserve: 0,
    reloading: false,
    firing: false,
    spread: 0.03,
    root,
    viewGroup: poseGrp,
    materials: mats,

    update,
    switchTo,
    reload,
    triggerDown,
    triggerUp,
    muzzleWorld,
    muzzleDirWorld,

    /** Capture mode and the menu drive this; `null` hands ADS back to the mouse. */
    setADS(v) {
      state.adsForced = v === null || v === undefined ? null : !!v;
      if (state.adsForced !== null) {
        state.ads = state.adsForced;
        // Snap for screenshots rather than easing in over 0.3 s.
        state.adsProgress = state.adsForced ? 1 : 0;
        state.adsBlend = state.adsProgress;
      }
    },

    /** Used by the HUD to draw the mag pips without reaching into private state. */
    ammoFor: (id) => ammoOf(id),
    reserveFor: (id) => reserveOf(id),

    /** Give the player ammunition — pickups, respawn, the menu's "refill" debug key. */
    resupply(id, amount) {
      const target = id || (state.current ? state.current.id : null);
      if (!target) return;
      const def = defs.find((x) => x.id === target);
      if (!def) return;
      const add = amount === undefined ? def.reserveMax : amount;
      state.reserveBy.set(target, Math.min(def.reserveMax, reserveOf(target) + add));
      if (weapon.current && weapon.current.id === target) weapon.reserve = reserveOf(target);
    },

    /** Full reset, used on respawn. */
    resetLoadout() {
      for (const def of defs) {
        state.ammoBy.set(def.id, def.magSize);
        state.reserveBy.set(def.id, def.reserveMax);
      }
      state.recoverPitch = 0;
      state.recoverYaw = 0;
      state.bloom = 0;
      state.burstIndex = 0;
      cancelReload();
      equip(defs[0].id, true);
    },

    dispose() {
      try {
        if (root.parent) root.parent.remove(root);
        if (ownLights && ownLights.parent) ownLights.parent.remove(ownLights);
        root.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
        });
        for (const m of mats._owned || []) {
          // Every borrowed map is a *clone*: it has its own GPU-side wrapper to release even
          // though the underlying source belongs to world/materials.js.
          if (m.map) m.map.dispose();
          if (m.normalMap) m.normalMap.dispose();
          if (m.roughnessMap) m.roughnessMap.dispose();
          m.dispose();
        }
      } catch { /* teardown must never throw */ }
    },
  };

  /* --- Spawn -------------------------------------------------------------- */
  equip(defs[0].id, true);

  // Guns start with the bolt forward and the dust cover shut.
  state._cover = 0;
  state._trig = 0;
  state._fingerIdx = 0;
  state._sel = 0;

  return weapon;
}

export default createWeapon;
