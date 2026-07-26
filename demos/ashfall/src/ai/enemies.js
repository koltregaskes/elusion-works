/**
 * Ashfall — opposing soldiers: procedural model, procedural animation, behaviour.
 *
 * There are no animation assets in this project, so everything here is built and driven in
 * code: a chamfered soldier mesh, an Object3D bone hierarchy the parts ride on, a gait with
 * world-locked foot planting and two-bone IK, a weapon-ready upper body whose hands stay on
 * the rifle, additive flinch/breath/fire layers, and a verlet ragdoll on death.
 *
 * Rendering strategy — the reason this stays inside the draw-call budget:
 *   every soldier is the same 16 rigid segments, so each segment is ONE InstancedMesh shared
 *   by the whole squad. Sixteen draw calls covers up to twelve enemies. Per-enemy variation
 *   comes from `instanceColor` (kit tint), the instance matrix (height ±4 %), and a zero-scale
 *   instance for the optional helmet cover. Bones live in a detached hierarchy — they carry no
 *   meshes, we just read their world matrices into the instance buffers.
 *
 * Material strategy: one MeshStandardMaterial for the whole squad. Albedo comes from baked
 * vertex colours, and roughness/metalness come from a generated 128² LUT texture bound to both
 * `roughnessMap` (.g) and `metalnessMap` (.b). Each material class owns a 32² tile of noise, and
 * vertices are given UVs that wander inside their tile, so roughness is spatially varying
 * rather than the flat constant that reads as amateur.
 *
 * ARCHITECTURE.md §3.10.
 */

import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';
import { PALETTE, ZONES } from '../world/art.js';

/* ========================================================================== */
/* Tuning                                                                     */
/* ========================================================================== */

const MAX_ENEMIES = 12;
/** Live population the respawn trickle aims for. ARCHITECTURE asks for 6–10. */
const TARGET_ALIVE_MIN = 6;
const TARGET_ALIVE_MAX = 10;

const VISION_FOV = (100 * Math.PI) / 180; // full cone angle
const VISION_HALF = VISION_FOV * 0.5;
const VISION_RANGE = 55.0;
const HEARING_RANGE = 45.0;
const ENEMY_HEALTH = 100;
const ENEMY_RADIUS = 0.38;

/**
 * Rest-pose skeleton metrics, metres. Everything downstream derives from these.
 *
 * Measured against a 1.8 m male rather than eyeballed, because the proportion errors that make
 * a character read as a toy are all small ones. Three were found and corrected:
 *
 *  - The leg chain was thigh 0.42 + shin 0.42 = 0.840 against a hip-to-ankle span of exactly
 *    0.840, so the IK ran permanently at full extension. A dead-straight standing knee is one
 *    of the strongest "mannequin" tells there is. thigh/shin now sum to 0.850 against a 0.835
 *    span — 1.8 % slack, which is a real standing knee bend and gives the solver a stable
 *    bend plane instead of a degenerate one.
 *  - The arm was short. Acromion-to-elbow on a 1.8 m male is ~0.30 and elbow-to-wrist ~0.27;
 *    0.28/0.26 put the hands high enough that the rifle sat under the chin.
 *  - Shoulders out to 0.19 (biacromial ~0.38, ~0.53 over the deltoids and brassards). A wide
 *    shoulder against a narrow head is the whole difference between an adult silhouette and a
 *    doll, and the head is narrowed to a real 0.163 m breadth in buildHead to match.
 */
const RIG = {
  hipsY: 0.94,
  spineY: 0.135,
  chestY: 0.225, // above spine → world 1.30
  neckY: 0.205, // → world 1.505
  headY: 0.09, // → world 1.595
  shoulderX: 0.19,
  shoulderY: 0.185, // chest-local → world 1.485, i.e. real acromion height
  upperArm: 0.3,
  foreArm: 0.27,
  hipX: 0.098,
  hipYOff: -0.02, // hips-local → world 0.92
  thigh: 0.425,
  shin: 0.425,
  ankleY: 0.085,
  eyeY: 1.65,
};

const ARM_REACH = RIG.upperArm + RIG.foreArm;

/**
 * Archetypes. Burst discipline and error floors are what make an enemy read as deliberate
 * rather than twitchy, so they are the numbers worth tuning first.
 */
const ARCHETYPES = {
  rifleman: {
    id: 'rifleman',
    damage: 17,
    rpm: 640,
    burst: [3, 5],
    burstPause: [0.55, 1.05],
    magazine: 30,
    reloadTime: 2.5,
    // ~2.6°. The player capsule is 1.15 m tall, so vertical error barely misses — the number
    // that governs whether a burst connects is the LATERAL spread, and it is tuned so a
    // stationary player in the open dies in about three seconds and a moving one survives.
    minError: 0.045,
    startError: 0.115,
    converge: 0.6,
    range: 46,
    idealRange: 17,
    moveSpeed: 3.5,
    sprintSpeed: 5.6,
    aggression: 0.55,
    accuracyFalloff: 30,
  },
  smg: {
    id: 'smg',
    damage: 12,
    rpm: 900,
    burst: [5, 9],
    burstPause: [0.4, 0.8],
    magazine: 33,
    reloadTime: 2.2,
    minError: 0.062,
    startError: 0.14,
    converge: 0.45,
    range: 30,
    idealRange: 10,
    moveSpeed: 4.0,
    sprintSpeed: 6.2,
    aggression: 0.85,
    accuracyFalloff: 18,
  },
  marksman: {
    id: 'marksman',
    damage: 34,
    rpm: 145,
    burst: [1, 2],
    burstPause: [1.1, 2.0],
    magazine: 20,
    reloadTime: 2.9,
    minError: 0.016,
    startError: 0.075,
    converge: 0.85,
    range: 70,
    idealRange: 34,
    moveSpeed: 3.0,
    sprintSpeed: 5.0,
    aggression: 0.25,
    accuracyFalloff: 55,
  },
};

const ARCHETYPE_MIX = ['rifleman', 'rifleman', 'rifleman', 'smg', 'smg', 'marksman'];

/** Material classes → LUT slot. Slot n occupies tile (n%4, floor(n/4)) of a 4×4 grid. */
const MAT = {
  skin: 0,
  cloth: 1,
  webbing: 2,
  armour: 3,
  leather: 4,
  rubber: 5,
  gunmetal: 6,
  polymer: 7,
  paintSteel: 8,
  optic: 9,
  brass: 10,
  coverCloth: 11,
  glove: 12,
  padded: 13,
};

/** [roughness, metalness] per slot. */
const MAT_RESPONSE = [
  [0.58, 0.0], // skin
  [0.88, 0.0], // cloth
  [0.8, 0.03], // webbing
  [0.52, 0.07], // armour
  [0.55, 0.0], // leather
  [0.93, 0.0], // rubber
  [0.36, 0.92], // gunmetal
  [0.62, 0.03], // polymer
  [0.44, 0.7], // painted steel
  [0.1, 0.1], // optic glass
  [0.3, 0.95], // brass
  [0.92, 0.0], // helmet cover cloth
  [0.72, 0.0], // glove
  [0.78, 0.02], // padded / knee pad
];

/** Segment ids. Order is the instanced-mesh order and never changes at runtime. */
const SEG = {
  pelvis: 0,
  chest: 1,
  head: 2,
  helmet: 3,
  cover: 4,
  uarmR: 5,
  farmR: 6,
  uarmL: 7,
  farmL: 8,
  thighR: 9,
  shinR: 10,
  bootR: 11,
  thighL: 12,
  shinL: 13,
  bootL: 14,
  rifle: 15,
  sling: 16,
};
const SEG_COUNT = 17;

/**
 * Which bone each segment rides. `sling` is the one segment that is not a rigid part of the
 * body: its bone is given a stretched basis every frame so the strap literally spans from the
 * rifle's front sling loop to the shoulder, whatever the weapon is doing.
 */
const SEG_BONE = [
  'hips', 'chest', 'head', 'head', 'head',
  'shoulderR', 'elbowR', 'shoulderL', 'elbowL',
  'hipR', 'kneeR', 'ankleR', 'hipL', 'kneeL', 'ankleL',
  'rifle', 'sling',
];

/** Which per-enemy tint channel each segment uses: 0 kit, 1 skin, 2 helmet, 3 cover, 4 none. */
const SEG_TINT = [0, 0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 4, 0, 0, 4, 4, 0];

/* ========================================================================== */
/* Module scratch — nothing in the hot path allocates                         */
/* ========================================================================== */

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _ik0 = new THREE.Vector3();
const _ik1 = new THREE.Vector3();
const _ik2 = new THREE.Vector3();
const _ik3 = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _az = new THREE.Vector3();
const _dp = new THREE.Vector3();
const _ds = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _e0 = new THREE.Euler();
const WHITE = new THREE.Color(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Shared, reused result object for `ai.raycast`. Callers must copy what they keep. */
const _hitResult = {
  enemy: null,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  zone: 'torso',
  headshot: false,
  multiplier: 1,
};

/* ========================================================================== */
/* Maths                                                                      */
/* ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

/** Frame-rate independent exponential approach. k is "per second sharpness". */
const damp = (current, target, k, dt) => current + (target - current) * (1 - Math.exp(-k * dt));

const smoothstep = (t) => t * t * (3 - 2 * t);
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Shortest signed angular difference, radians. */
function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function dampAngle(current, target, k, dt) {
  return current + angleDelta(current, target) * (1 - Math.exp(-k * dt));
}

/** Deterministic PRNG so a given seed always builds the same soldier. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap 3D value hash in [0,1) — used for per-vertex grain, never per frame. */
function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  h -= Math.floor(h);
  return h;
}

/* ========================================================================== */
/* Geometry helpers                                                           */
/* ========================================================================== */

/**
 * Chamfered box. A hard 90° edge catches no light and reads instantly as programmer art, so
 * every panel on the soldier goes through here. Two subdivisions per axis is enough for a
 * proper corner bevel at 54 vertices.
 */
function roundedBox(w, h, d, r, seg = 2) {
  const rr = Math.max(0.0005, Math.min(r, Math.min(w, Math.min(h, d)) * 0.49));
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const hx = w * 0.5 - rr;
  const hy = h * 0.5 - rr;
  const hz = d * 0.5 - rr;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const cx = clamp(px, -hx, hx);
    const cy = clamp(py, -hy, hy);
    const cz = clamp(pz, -hz, hz);
    let dx = px - cx;
    let dy = py - cy;
    let dz = pz - cz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 1e-6) {
      const s = rr / len;
      dx *= s;
      dy *= s;
      dz *= s;
    }
    pos.setXYZ(i, cx + dx, cy + dy, cz + dz);
  }
  g.computeVertexNormals();
  return g;
}

/** Mirror a finished geometry across X, flipping winding so it is not inside-out. */
function mirrorX(src) {
  const g = src.clone();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, -p.getX(i));
    if (n) n.setX(i, -n.getX(i));
  }
  p.needsUpdate = true;
  if (n) n.needsUpdate = true;
  const idx = g.index;
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i];
      a[i] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  return g;
}

/**
 * Collects transformed, colour-baked, LUT-mapped parts for one rigid segment and merges them
 * into a single BufferGeometry. Runs once at boot, never per frame.
 */
class SegmentBuilder {
  constructor() {
    this.parts = [];
  }

  /**
   * @param {THREE.BufferGeometry} geo    consumed — do not reuse the instance
   * @param {number} slot                 MAT.* class
   * @param {THREE.Color} colour          linear-space albedo
   * @param {object} o                    {pos, rot, scale, ao, grain, uvScale}
   */
  add(geo, slot, colour, o) {
    const opt = o || {};
    const pos = opt.pos;
    const rot = opt.rot;
    const sc = opt.scale;
    if (rot || pos || sc) {
      _e0.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
      _q0.setFromEuler(_e0);
      _v0.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
      if (typeof sc === 'number') _v1.set(sc, sc, sc);
      else if (sc) _v1.set(sc[0], sc[1], sc[2]);
      else _v1.set(1, 1, 1);
      _m0.compose(_v0, _q0, _v1);
      geo.applyMatrix4(_m0);
    }
    geo.clearGroups();
    // Strip anything merge would choke on; we rebuild uv and color below.
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') geo.deleteAttribute(key);
    }
    if (!geo.attributes.uv) {
      const n = geo.attributes.position.count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    bakeSurface(geo, slot, colour, opt);
    this.parts.push(geo);
    return this;
  }

  build(name) {
    if (!this.parts.length) return new THREE.BufferGeometry();
    let merged = null;
    try {
      merged = this.parts.length === 1 ? this.parts[0] : mergeGeometries(this.parts, false);
    } catch {
      merged = this.parts[0];
    }
    if (!merged) merged = this.parts[0];
    if (this.parts.length > 1) {
      for (const g of this.parts) if (g !== merged) g.dispose();
    }
    merged.name = 'ai:' + name;
    merged.computeBoundingSphere();
    this.parts.length = 0;
    return merged;
  }
}

const LUT_TILES = 4; // 4×4 grid
const LUT_SIZE = 128;
const LUT_TILE_PX = LUT_SIZE / LUT_TILES; // 32
const LUT_TILE_UV = 1 / LUT_TILES; // 0.25
const LUT_INSET = 3 / LUT_SIZE; // keep bilinear taps inside the tile

/**
 * Write vertex colours (albedo × fake AO × grain) and LUT uvs into a finished part.
 * The uv wanders across the part's tile as a function of world-ish position, which is what
 * gives every panel spatially varying roughness instead of one flat number.
 */
function bakeSurface(geo, slot, colour, opt) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const count = pos.count;
  let colAttr = geo.getAttribute('color');
  if (!colAttr || colAttr.count !== count) {
    colAttr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    geo.setAttribute('color', colAttr);
  }
  const ao = opt.ao === undefined ? 1 : opt.ao;
  const grain = opt.grain === undefined ? 0.05 : opt.grain;
  const uvScale = opt.uvScale === undefined ? 5.5 : opt.uvScale;
  const tu = (slot % LUT_TILES) * LUT_TILE_UV;
  const tv = Math.floor(slot / LUT_TILES) * LUT_TILE_UV;
  const span = LUT_TILE_UV - LUT_INSET * 2;
  const cr = colour.r;
  const cg = colour.g;
  const cb = colour.b;
  for (let i = 0; i < count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const ny = nor ? nor.getY(i) : 0;
    // Fake contact occlusion: undersides sit in shade, up-faces catch the sky.
    const dirAO = 0.8 + 0.2 * (ny * 0.5 + 0.5);
    const g = 1 + (hash3(px * 7.3, py * 7.7, pz * 7.1) * 2 - 1) * grain;
    const f = ao * dirAO * g;
    colAttr.setXYZ(i, cr * f, cg * f, cb * f);
    let fu = (px * uvScale + pz * uvScale * 0.61) % 1;
    let fv = (py * uvScale + px * uvScale * 0.37) % 1;
    if (fu < 0) fu += 1;
    if (fv < 0) fv += 1;
    uv.setXY(i, tu + LUT_INSET + fu * span, tv + LUT_INSET + fv * span);
  }
  colAttr.needsUpdate = true;
  uv.needsUpdate = true;
}

/** Build the roughness/metalness LUT. Noise per tile so no surface is perfectly uniform. */
function buildResponseLUT() {
  const data = new Uint8Array(LUT_SIZE * LUT_SIZE * 4);
  for (let slot = 0; slot < LUT_TILES * LUT_TILES; slot++) {
    const resp = MAT_RESPONSE[slot] || [0.7, 0.0];
    const x0 = (slot % LUT_TILES) * LUT_TILE_PX;
    const y0 = Math.floor(slot / LUT_TILES) * LUT_TILE_PX;
    const rnd = mulberry32(9871 + slot * 131);
    // Two octaves of value noise, bilinearly resolved by the sampler at 32² — plenty at the
    // screen size a soldier occupies.
    for (let y = 0; y < LUT_TILE_PX; y++) {
      for (let x = 0; x < LUT_TILE_PX; x++) {
        const n1 = rnd();
        const n2 = rnd();
        const wear = (n1 - 0.5) * 0.16 + (n2 - 0.5) * 0.07;
        const rough = clamp(resp[0] + wear, 0.04, 1);
        // Worn edges on metal polish up; worn paint roughens. Correlate metalness with it.
        const metal = clamp(resp[1] + (resp[1] > 0.4 ? -wear * 0.35 : wear * 0.1), 0, 1);
        const o = ((y0 + y) * LUT_SIZE + (x0 + x)) * 4;
        data[o] = 255;
        data[o + 1] = Math.round(rough * 255);
        data[o + 2] = Math.round(metal * 255);
        data[o + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, LUT_SIZE, LUT_SIZE, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'ai:responseLUT';
  return tex;
}

/* ========================================================================== */
/* Palette derivation                                                         */
/* ========================================================================== */

/**
 * Colours are derived from art.js, never invented. Skin is the one tone the palette has no
 * entry for, so it is mixed from the two closest authored values (splintered wood + rust),
 * which lands on a believable weathered European skin tone inside the scene's gamut.
 */
function buildPalette() {
  const c = (hex) => new THREE.Color(hex);
  const skin = c(PALETTE.woodSplinter).lerp(c(PALETTE.rust), 0.24).multiplyScalar(0.94);
  return {
    skin,
    skinShade: skin.clone().multiplyScalar(0.82),
    fatigue: c(PALETTE.railGreen).lerp(c(PALETTE.dirt), 0.35),
    fatigueDark: c(PALETTE.railGreen).lerp(c(PALETTE.dirt), 0.35).multiplyScalar(0.78),
    carrier: c(PALETTE.gunPolymer).lerp(c(PALETTE.steelPainted), 0.35),
    carrierDark: c(PALETTE.gunPolymer).lerp(c(PALETTE.steelPainted), 0.2).multiplyScalar(0.8),
    webbing: c(PALETTE.steelPainted).multiplyScalar(0.62),
    plate: c(PALETTE.gunPolymer).lerp(c(PALETTE.railGreen), 0.25),
    helmet: c(PALETTE.railGreen).multiplyScalar(0.85),
    helmetCover: c(PALETTE.sandbag).lerp(c(PALETTE.railGreen), 0.45),
    boot: c(PALETTE.gunRubber).lerp(c(PALETTE.woodWeathered), 0.28),
    sole: c(PALETTE.gunRubber),
    glove: c(PALETTE.gunRubber).lerp(c(PALETTE.woodWeathered), 0.14),
    knee: c(PALETTE.gunPolymer).multiplyScalar(1.05),
    gunmetal: c(PALETTE.gunmetal),
    gunPolymer: c(PALETTE.gunPolymer),
    gunTan: c(PALETTE.gunTan),
    brass: c(PALETTE.brass),
    optic: c(PALETTE.glass),
    hazard: c(PALETTE.hazardYellow),
    rust: c(PALETTE.rust),
    tarp: c(PALETTE.tarpBlue),
  };
}

/* ========================================================================== */
/* The soldier — one geometry per rigid segment, authored in bone-local space  */
/* ========================================================================== */

/**
 * Pelvis: trouser seat, belt, dump pouch, holster. Origin at the hips bone.
 *
 * The trouser seat is deliberately wider than the hips underneath it and sits slightly low —
 * combat trousers bag over the belt, and a seat that hugs the pelvis exactly is what makes a
 * figure read as a shop mannequin with clothes painted on.
 */
function buildPelvis(P) {
  const b = new SegmentBuilder();
  b.add(roundedBox(0.318, 0.24, 0.218, 0.07), MAT.cloth, P.fatigue, { pos: [0, -0.025, 0], ao: 0.95 });
  // Fabric slump: a second, wider, lower block breaking the seat's silhouette at the back.
  b.add(roundedBox(0.3, 0.11, 0.2, 0.055), MAT.cloth, P.fatigueDark, {
    pos: [0, -0.095, -0.012], ao: 0.88,
  });
  // Belt sits proud of the trousers so it catches a rim of key light.
  b.add(roundedBox(0.332, 0.062, 0.232, 0.024), MAT.webbing, P.webbing, { pos: [0, 0.085, 0], ao: 0.86 });
  b.add(roundedBox(0.058, 0.052, 0.03, 0.012), MAT.paintSteel, P.gunmetal, { pos: [0, 0.085, 0.117], ao: 0.95 });
  // Belt keepers — four small loops, the kind of thing you only notice when it is missing.
  for (let i = 0; i < 4; i++) {
    const a = -0.9 + i * 0.6;
    b.add(roundedBox(0.026, 0.072, 0.018, 0.005, 1), MAT.webbing, P.carrierDark, {
      pos: [Math.sin(a) * 0.16, 0.085, Math.cos(a) * 0.118], rot: [0, a, 0], ao: 0.82,
    });
  }
  // Dump pouch, rear left, with a rolled-down top so it does not read as a brick.
  b.add(roundedBox(0.112, 0.13, 0.078, 0.032), MAT.webbing, P.webbing, {
    pos: [-0.108, 0.0, -0.108], rot: [0.12, 0, 0.08], ao: 0.8,
  });
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), MAT.webbing, P.carrierDark, {
    pos: [-0.108, 0.062, -0.112], rot: [0.12, 0, Math.PI * 0.5], ao: 0.78,
  });
  // Utility pouch, rear right, with its own flap and a pull tab.
  b.add(roundedBox(0.088, 0.1, 0.062, 0.025), MAT.webbing, P.webbing, {
    pos: [0.104, 0.005, -0.108], rot: [0.1, 0, -0.05], ao: 0.8,
  });
  b.add(roundedBox(0.092, 0.03, 0.07, 0.012), MAT.webbing, P.carrierDark, {
    pos: [0.104, 0.058, -0.11], rot: [0.24, 0, -0.05], ao: 0.78,
  });
  b.add(roundedBox(0.016, 0.026, 0.008, 0.003, 1), MAT.webbing, P.hazard, {
    pos: [0.104, 0.048, -0.146], ao: 0.9,
  });
  // Holster on the right hip, on a drop-leg platform.
  b.add(roundedBox(0.078, 0.152, 0.058, 0.02), MAT.leather, P.boot, {
    pos: [0.163, -0.065, 0.015], rot: [0, 0, -0.09], ao: 0.82,
  });
  b.add(roundedBox(0.052, 0.032, 0.052, 0.012), MAT.polymer, P.gunPolymer, { pos: [0.163, 0.018, 0.015], ao: 0.85 });
  b.add(roundedBox(0.03, 0.09, 0.012, 0.004, 1), MAT.webbing, P.webbing, {
    pos: [0.166, 0.045, 0.016], rot: [0, 0, -0.09], ao: 0.86,
  });
  // Trouser tops flaring into the thigh, kills the boxy join at the hip.
  b.add(new THREE.CylinderGeometry(0.104, 0.092, 0.11, 10, 1, true), MAT.cloth, P.fatigue, {
    pos: [0.098, -0.115, 0], ao: 0.86,
  });
  b.add(new THREE.CylinderGeometry(0.104, 0.092, 0.11, 10, 1, true), MAT.cloth, P.fatigue, {
    pos: [-0.098, -0.115, 0], ao: 0.86,
  });
  return b.build('pelvis');
}

/**
 * Chest: torso, plate carrier front/back/side, mag pouches, radio, hydration, collar, neck.
 *
 * Almost all of the added silhouette lives here, because the chest is what the player sees
 * first and longest. The rule applied throughout: nothing is a single closed box. Every pouch
 * gets a flap that overhangs it, every strap gets a buckle, and the back carries a hydration
 * bladder and its drink tube so the soldier is not flat when he turns away.
 */
function buildChest(P) {
  const b = new SegmentBuilder();
  // Torso in three stacked blocks so the waist tapers and the ribcage flares, rather than
  // reading as a fridge. The middle block is the widest — that is where the lats sit.
  b.add(roundedBox(0.295, 0.19, 0.2, 0.07), MAT.cloth, P.fatigue, { pos: [0, -0.065, 0], ao: 0.9 });
  b.add(roundedBox(0.368, 0.2, 0.228, 0.082), MAT.cloth, P.fatigue, { pos: [0, 0.075, 0], ao: 0.93 });
  b.add(roundedBox(0.35, 0.11, 0.212, 0.07), MAT.cloth, P.fatigue, { pos: [0, 0.17, -0.004], ao: 0.92 });
  // Trapezius wedge into the neck.
  b.add(roundedBox(0.265, 0.09, 0.175, 0.048), MAT.cloth, P.fatigueDark, { pos: [0, 0.2, -0.012], ao: 0.86 });

  // --- Plate carrier -----------------------------------------------------
  // Front plate, tilted back at the top the way a real carrier sits on the chest.
  b.add(roundedBox(0.278, 0.33, 0.045, 0.018), MAT.armour, P.plate, {
    pos: [0, 0.07, 0.128], rot: [-0.07, 0, 0], ao: 1.0,
  });
  b.add(roundedBox(0.272, 0.3, 0.04, 0.016), MAT.armour, P.plate, {
    pos: [0, 0.07, -0.128], rot: [0.05, 0, 0], ao: 0.88,
  });
  // Cummerbund side plates, with the elastic band that laces them to the front.
  b.add(roundedBox(0.05, 0.185, 0.19, 0.02), MAT.armour, P.carrier, { pos: [0.178, -0.012, 0], ao: 0.84 });
  b.add(roundedBox(0.05, 0.185, 0.19, 0.02), MAT.armour, P.carrier, { pos: [-0.178, -0.012, 0], ao: 0.84 });
  b.add(roundedBox(0.062, 0.03, 0.196, 0.008), MAT.webbing, P.carrierDark, { pos: [0.176, 0.05, 0], ao: 0.8 });
  b.add(roundedBox(0.062, 0.03, 0.196, 0.008), MAT.webbing, P.carrierDark, { pos: [-0.176, 0.05, 0], ao: 0.8 });
  // Shoulder straps bridging front to back over the trapezius, each with a quick-release buckle.
  b.add(roundedBox(0.078, 0.055, 0.285, 0.022), MAT.webbing, P.carrierDark, {
    pos: [0.1, 0.222, 0], rot: [0, 0, 0.12], ao: 0.9,
  });
  b.add(roundedBox(0.078, 0.055, 0.285, 0.022), MAT.webbing, P.carrierDark, {
    pos: [-0.1, 0.222, 0], rot: [0, 0, -0.12], ao: 0.9,
  });
  b.add(roundedBox(0.05, 0.03, 0.045, 0.008), MAT.polymer, P.gunPolymer, {
    pos: [0.104, 0.212, 0.108], rot: [-0.2, 0, 0.12], ao: 0.86,
  });
  b.add(roundedBox(0.05, 0.03, 0.045, 0.008), MAT.polymer, P.gunPolymer, {
    pos: [-0.104, 0.212, 0.108], rot: [-0.2, 0, -0.12], ao: 0.86,
  });

  // --- Front load: three mag pouches, each with its own flap and pull tab ---
  for (let i = 0; i < 3; i++) {
    const x = -0.084 + i * 0.084;
    // Body of the pouch, slightly bellied out — a full magazine pouch is not a flat panel.
    b.add(roundedBox(0.078, 0.145, 0.058, 0.017), MAT.webbing, P.webbing, {
      pos: [x, -0.04, 0.17], rot: [-0.04, 0, 0], ao: 0.92,
    });
    // Flap with a visible lip — the shadow line under it is the whole point. Each one is
    // tilted a little differently, because three identical flaps read as a texture, not kit.
    const tilt = -0.13 - (i - 1) * 0.05;
    b.add(roundedBox(0.083, 0.046, 0.066, 0.014), MAT.webbing, P.carrierDark, {
      pos: [x, 0.034, 0.172], rot: [tilt, 0, (i - 1) * 0.05], ao: 0.86,
    });
    // Retention tab hanging off the flap's lower edge.
    b.add(roundedBox(0.02, 0.034, 0.008, 0.003, 1), MAT.webbing, P.carrierDark, {
      pos: [x, 0.014, 0.205], rot: [tilt * 0.5, 0, 0], ao: 0.82,
    });
  }
  // MOLLE ladder across the front plate — the loom that everything else clips to.
  for (let r = 0; r < 2; r++) {
    b.add(roundedBox(0.24, 0.012, 0.01, 0.003, 1), MAT.webbing, P.carrierDark, {
      pos: [0, 0.1 + r * 0.062, 0.152], ao: 0.78,
    });
  }
  // Admin pouch and a grenade, upper left of the carrier.
  b.add(roundedBox(0.092, 0.078, 0.048, 0.014), MAT.webbing, P.carrierDark, {
    pos: [-0.092, 0.155, 0.158], ao: 0.9,
  });
  b.add(roundedBox(0.094, 0.026, 0.052, 0.01), MAT.webbing, P.webbing, {
    pos: [-0.092, 0.192, 0.16], rot: [-0.16, 0, 0], ao: 0.84,
  });
  b.add(new THREE.CylinderGeometry(0.027, 0.027, 0.072, 8), MAT.paintSteel, P.helmet, {
    pos: [0.1, 0.155, 0.162], ao: 0.9,
  });
  b.add(new THREE.CylinderGeometry(0.013, 0.013, 0.02, 6), MAT.gunmetal, P.gunmetal, {
    pos: [0.1, 0.2, 0.162], ao: 0.9,
  });
  // Grenade retention strap over the top of it.
  b.add(roundedBox(0.062, 0.012, 0.03, 0.004, 1), MAT.webbing, P.carrierDark, {
    pos: [0.1, 0.192, 0.162], ao: 0.85,
  });

  // --- Hydration bladder + drink tube -------------------------------------
  // The bladder is what gives the back a readable shape from behind, which matters because a
  // flanking player spends real time looking at exactly this.
  b.add(roundedBox(0.235, 0.3, 0.08, 0.04), MAT.webbing, P.carrierDark, {
    pos: [0, 0.08, -0.19], rot: [0.04, 0, 0], ao: 0.8,
  });
  b.add(roundedBox(0.21, 0.05, 0.07, 0.02), MAT.webbing, P.webbing, {
    pos: [0, 0.208, -0.188], rot: [0.1, 0, 0], ao: 0.76,
  });
  // Compression straps across it.
  for (let i = 0; i < 2; i++) {
    b.add(roundedBox(0.245, 0.016, 0.088, 0.005, 1), MAT.webbing, P.webbing, {
      pos: [0, 0.03 + i * 0.09, -0.19], ao: 0.74,
    });
  }
  // Drink tube: over the left shoulder and down the front, in four short runs.
  const tube = [
    [-0.09, 0.235, -0.15, 0.6, 0.0, 0.16],
    [-0.108, 0.262, -0.03, 1.45, 0.0, 0.1],
    [-0.12, 0.215, 0.075, 2.5, 0.0, 0.14],
    [-0.13, 0.115, 0.115, 3.05, 0.0, 0.12],
  ];
  for (let i = 0; i < tube.length; i++) {
    const t = tube[i];
    b.add(new THREE.CylinderGeometry(0.0085, 0.0085, t[5], 6), MAT.rubber, P.gunPolymer, {
      pos: [t[0], t[1], t[2]], rot: [t[3], t[4], 0], ao: 0.9,
    });
  }
  b.add(roundedBox(0.02, 0.03, 0.02, 0.006), MAT.polymer, P.gunPolymer, {
    pos: [-0.132, 0.06, 0.13], rot: [0.3, 0, 0], ao: 0.88,
  });

  // --- Rifle sling, body side ---------------------------------------------
  // The dynamic strap (SEG.sling) runs from the weapon to just here; this is the run that is
  // fixed relative to the chest, over the left shoulder and diagonally down the back.
  b.add(roundedBox(0.034, 0.05, 0.16, 0.008), MAT.webbing, P.webbing, {
    pos: [-0.14, 0.235, 0.03], rot: [0.22, 0.1, -0.14], ao: 0.86,
  });
  b.add(roundedBox(0.034, 0.2, 0.03, 0.008), MAT.webbing, P.webbing, {
    pos: [-0.152, 0.15, -0.16], rot: [-0.1, 0, 0.05], ao: 0.8,
  });
  b.add(roundedBox(0.034, 0.24, 0.03, 0.008), MAT.webbing, P.webbing, {
    pos: [-0.02, -0.02, -0.185], rot: [-0.06, 0, -0.95], ao: 0.78,
  });
  b.add(roundedBox(0.03, 0.026, 0.026, 0.006), MAT.polymer, P.gunPolymer, {
    pos: [-0.142, 0.2, -0.07], rot: [0.2, 0, 0], ao: 0.84,
  });

  // --- Radio + antenna ----------------------------------------------------
  b.add(roundedBox(0.095, 0.17, 0.062, 0.016), MAT.polymer, P.gunPolymer, {
    pos: [-0.16, 0.06, -0.155], rot: [0, 0.22, 0], ao: 0.82,
  });
  b.add(new THREE.CylinderGeometry(0.006, 0.004, 0.3, 6), MAT.polymer, P.gunPolymer, {
    pos: [-0.17, 0.27, -0.175], rot: [0.22, 0, 0.16], ao: 0.95,
  });
  // Coiled handset lead — a tiny bit of story on the back of the carrier.
  b.add(new THREE.TorusGeometry(0.032, 0.007, 5, 10), MAT.polymer, P.gunPolymer, {
    pos: [-0.155, 0.15, -0.15], rot: [1.2, 0, 0.3], ao: 0.85,
  });

  // --- Neck + collar ------------------------------------------------------
  b.add(new THREE.CylinderGeometry(0.052, 0.061, 0.135, 10), MAT.skin, P.skinShade, {
    pos: [0, 0.245, 0.004], ao: 0.7,
  });
  // A standing collar, not a slab: an open cylinder flaring away from the neck, plus the
  // fastening band. It is what stops the head reading as a ball dropped onto the shoulders.
  b.add(new THREE.CylinderGeometry(0.085, 0.072, 0.086, 12, 1, true), MAT.cloth, P.fatigueDark, {
    pos: [0, 0.242, -0.002], rot: [-0.08, 0, 0], ao: 0.78,
  });
  b.add(new THREE.CylinderGeometry(0.076, 0.074, 0.024, 12, 1, true), MAT.cloth, P.fatigue, {
    pos: [0, 0.204, -0.002], ao: 0.74,
  });
  // Collar tips at the front, slightly splayed.
  b.add(roundedBox(0.05, 0.055, 0.014, 0.006), MAT.cloth, P.fatigueDark, {
    pos: [0.042, 0.248, 0.064], rot: [-0.16, -0.35, 0.1], ao: 0.8,
  });
  b.add(roundedBox(0.05, 0.055, 0.014, 0.006), MAT.cloth, P.fatigueDark, {
    pos: [-0.042, 0.248, 0.064], rot: [-0.16, 0.35, -0.1], ao: 0.8,
  });
  return b.build('chest');
}

/**
 * Head: skull, jaw, nose, brow, ears. Deliberately not a sphere.
 *
 * Narrowed. The skull was 0.184 m across against a real male head breadth of ~0.158, and a
 * head 16 % too wide on a 1.8 m body is the single loudest "this is a toy" signal a character
 * can send — it survives distance, motion blur and a helmet on top. It is now 0.163 wide by
 * 0.213 chin-to-crown, which is a real head, and the extra height is taken out of the width so
 * the total volume barely moves.
 */
function buildHead(P) {
  const b = new SegmentBuilder();
  b.add(new THREE.SphereGeometry(0.098, 14, 11), MAT.skin, P.skin, {
    pos: [0, 0.048, -0.01], scale: [0.83, 1.1, 1.04], ao: 0.96,
  });
  // Jaw and chin — the silhouette from side-on lives or dies on this.
  b.add(roundedBox(0.122, 0.09, 0.128, 0.036), MAT.skin, P.skin, {
    pos: [0, -0.008, 0.014], rot: [0.06, 0, 0], ao: 0.9,
  });
  b.add(roundedBox(0.07, 0.052, 0.05, 0.022), MAT.skin, P.skin, { pos: [0, -0.026, 0.058], ao: 0.86 });
  // Brow ridge, nose, cheekbones.
  b.add(roundedBox(0.118, 0.032, 0.05, 0.014), MAT.skin, P.skinShade, {
    pos: [0, 0.07, 0.068], rot: [0.12, 0, 0], ao: 0.9,
  });
  b.add(roundedBox(0.028, 0.06, 0.042, 0.012), MAT.skin, P.skin, {
    pos: [0, 0.036, 0.09], rot: [-0.28, 0, 0], ao: 0.95,
  });
  b.add(roundedBox(0.108, 0.03, 0.045, 0.014), MAT.skin, P.skinShade, { pos: [0, 0.028, 0.074], ao: 0.88 });
  // Ears.
  b.add(new THREE.SphereGeometry(0.026, 7, 6), MAT.skin, P.skinShade, {
    pos: [0.082, 0.042, -0.008], scale: [0.42, 1.12, 0.85], ao: 0.8,
  });
  b.add(new THREE.SphereGeometry(0.026, 7, 6), MAT.skin, P.skinShade, {
    pos: [-0.082, 0.042, -0.008], scale: [0.42, 1.12, 0.85], ao: 0.8,
  });
  // Eye sockets read as dark recesses at distance; two shallow dark boxes do it cheaply.
  b.add(roundedBox(0.034, 0.018, 0.02, 0.007), MAT.skin, P.skinShade.clone().multiplyScalar(0.5), {
    pos: [0.031, 0.053, 0.082], ao: 0.6,
  });
  b.add(roundedBox(0.034, 0.018, 0.02, 0.007), MAT.skin, P.skinShade.clone().multiplyScalar(0.5), {
    pos: [-0.031, 0.053, 0.082], ao: 0.6,
  });
  return b.build('head');
}

/**
 * Helmet: shell, brim, side rails, NVG mount, ear cups, counterweight, chin strap.
 *
 * Brought in from 0.252 m across to 0.234 to sit on the narrowed skull without floating, and
 * given the two things a real modern helmet has that a dome does not: a counterweight pouch on
 * the back (which is what balances an NVG mount, and reads as a distinct lump in silhouette)
 * and bungee retention cords across the shell.
 */
function buildHelmet(P) {
  const b = new SegmentBuilder();
  // Shell — a partial sphere so the open bottom does not waste triangles.
  b.add(new THREE.SphereGeometry(0.117, 18, 12, 0, TAU, 0, 1.42), MAT.armour, P.helmet, {
    pos: [0, 0.064, -0.006], scale: [1.0, 0.99, 1.1], ao: 1.0,
  });
  // Brim: a partial cylinder shell around the front 210°, flaring outward.
  b.add(new THREE.CylinderGeometry(0.132, 0.119, 0.024, 18, 1, false, -1.85, 3.7), MAT.armour, P.helmet, {
    pos: [0, 0.045, -0.006], scale: [1.0, 1.0, 1.1], ao: 0.92,
  });
  // Accessory rails.
  b.add(roundedBox(0.016, 0.03, 0.16, 0.006), MAT.polymer, P.gunPolymer, {
    pos: [0.114, 0.07, -0.012], rot: [0, 0, -0.12], ao: 0.86,
  });
  b.add(roundedBox(0.016, 0.03, 0.16, 0.006), MAT.polymer, P.gunPolymer, {
    pos: [-0.114, 0.07, -0.012], rot: [0, 0, 0.12], ao: 0.86,
  });
  // NVG shroud on the brow.
  b.add(roundedBox(0.05, 0.035, 0.05, 0.012), MAT.paintSteel, P.gunmetal, {
    pos: [0, 0.1, 0.094], rot: [0.3, 0, 0], ao: 0.9,
  });
  b.add(roundedBox(0.03, 0.016, 0.028, 0.006), MAT.gunmetal, P.gunmetal, {
    pos: [0, 0.118, 0.11], rot: [0.3, 0, 0], ao: 0.95,
  });
  // Counterweight pouch on the rear, on its own strap. Balances the shroud above, and gives
  // the back of the head a shape instead of a hemisphere.
  b.add(roundedBox(0.098, 0.076, 0.056, 0.022), MAT.webbing, P.webbing, {
    pos: [0, 0.058, -0.128], rot: [-0.26, 0, 0], ao: 0.8,
  });
  b.add(roundedBox(0.104, 0.024, 0.05, 0.008), MAT.webbing, P.carrierDark, {
    pos: [0, 0.096, -0.124], rot: [-0.34, 0, 0], ao: 0.76,
  });
  // Bungee cords over the shell, front to back, for stowing kit under.
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    b.add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.2, 5), MAT.rubber, P.gunPolymer, {
      pos: [s * 0.062, 0.14, -0.02], rot: [0.05, 0, s * 0.34], ao: 0.88,
    });
  }
  // Cat-eye retro tabs on the back — two tiny hazard flecks that catch the key.
  for (let i = 0; i < 2; i++) {
    b.add(roundedBox(0.026, 0.012, 0.006, 0.002, 1), MAT.coverCloth, P.hazard, {
      pos: [(i === 0 ? 1 : -1) * 0.035, 0.104, -0.108], rot: [-0.4, 0, 0], ao: 0.95,
    });
  }
  // Ear protection cups.
  b.add(new THREE.CylinderGeometry(0.043, 0.04, 0.03, 12), MAT.polymer, P.gunPolymer, {
    pos: [0.118, 0.042, -0.006], rot: [0, 0, Math.PI * 0.5], ao: 0.82,
  });
  b.add(new THREE.CylinderGeometry(0.043, 0.04, 0.03, 12), MAT.polymer, P.gunPolymer, {
    pos: [-0.118, 0.042, -0.006], rot: [0, 0, Math.PI * 0.5], ao: 0.82,
  });
  b.add(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 5), MAT.polymer, P.gunPolymer, {
    pos: [-0.104, 0.022, 0.05], rot: [0.5, 0, 0.5], ao: 0.9,
  });
  // Chin strap: two risers, the strap under the jaw, and the buckle on it.
  b.add(roundedBox(0.012, 0.104, 0.028, 0.005), MAT.webbing, P.webbing, {
    pos: [0.098, -0.01, 0.026], rot: [0, 0, 0.2], ao: 0.8,
  });
  b.add(roundedBox(0.012, 0.104, 0.028, 0.005), MAT.webbing, P.webbing, {
    pos: [-0.098, -0.01, 0.026], rot: [0, 0, -0.2], ao: 0.8,
  });
  b.add(roundedBox(0.012, 0.09, 0.026, 0.005), MAT.webbing, P.webbing, {
    pos: [0.09, -0.006, -0.05], rot: [0, 0, 0.24], ao: 0.78,
  });
  b.add(roundedBox(0.012, 0.09, 0.026, 0.005), MAT.webbing, P.webbing, {
    pos: [-0.09, -0.006, -0.05], rot: [0, 0, -0.24], ao: 0.78,
  });
  b.add(roundedBox(0.16, 0.02, 0.03, 0.008), MAT.webbing, P.webbing, {
    pos: [0, -0.058, 0.048], rot: [0.18, 0, 0], ao: 0.78,
  });
  b.add(roundedBox(0.03, 0.028, 0.024, 0.006), MAT.polymer, P.gunPolymer, {
    pos: [0.042, -0.056, 0.05], rot: [0.18, 0, 0], ao: 0.82,
  });
  return b.build('helmet');
}

/** Optional scrim cover — a separate segment so it can be scaled to zero per soldier. */
function buildHelmetCover(P) {
  const b = new SegmentBuilder();
  b.add(new THREE.SphereGeometry(0.1225, 16, 11, 0, TAU, 0, 1.36), MAT.coverCloth, P.helmetCover, {
    pos: [0, 0.064, -0.006], scale: [1.0, 0.99, 1.1], ao: 1.0, grain: 0.11, uvScale: 9,
  });
  // Elastic band around the shell and a few scrim tabs to break the dome silhouette.
  b.add(new THREE.CylinderGeometry(0.127, 0.125, 0.026, 16, 1, true), MAT.coverCloth, P.webbing, {
    pos: [0, 0.078, -0.006], scale: [1.0, 1.0, 1.1], ao: 0.9, grain: 0.1,
  });
  b.add(roundedBox(0.03, 0.052, 0.012, 0.004), MAT.coverCloth, P.helmetCover, {
    pos: [0.084, 0.108, -0.078], rot: [0.4, 0.5, 0.2], ao: 0.85, grain: 0.14,
  });
  b.add(roundedBox(0.026, 0.046, 0.01, 0.004), MAT.coverCloth, P.helmetCover, {
    pos: [-0.056, 0.12, -0.062], rot: [0.5, -0.4, -0.3], ao: 0.85, grain: 0.14,
  });
  b.add(roundedBox(0.022, 0.042, 0.01, 0.004), MAT.coverCloth, P.webbing, {
    pos: [0.03, 0.126, 0.05], rot: [-0.6, 0.2, 0.5], ao: 0.85, grain: 0.14,
  });
  // The cover's stitched seam where it wraps under the brim — a thin darker lip all round.
  b.add(new THREE.CylinderGeometry(0.134, 0.122, 0.014, 16, 1, true), MAT.coverCloth, P.webbing, {
    pos: [0, 0.043, -0.006], scale: [1.0, 1.0, 1.1], ao: 0.82, grain: 0.1,
  });
  return b.build('helmetCover');
}

/**
 * Right upper arm, origin at the shoulder joint, limb running down -Y.
 *
 * The sleeve is built as two overlapping volumes rather than one capsule: a fuller upper
 * section, and a lower one offset slightly rearward, cinched by a cuff just above the elbow
 * pad. Real sleeves have slack that gathers at the joint; a single tapered tube is what makes
 * a limb read as a pipe, and pipes are what separate a rigged prop from a person.
 */
function buildUpperArm(P) {
  const b = new SegmentBuilder();
  // Deltoid cap — without it the shoulder joint reads as a gap.
  b.add(new THREE.SphereGeometry(0.084, 11, 9), MAT.cloth, P.fatigue, {
    pos: [0.006, -0.014, 0], scale: [0.98, 1.0, 1.02], ao: 0.88,
  });
  // Upper sleeve: full, sitting a touch proud of the arm inside it.
  b.add(new THREE.CapsuleGeometry(0.061, 0.1, 4, 10), MAT.cloth, P.fatigue, { pos: [0, -0.1, 0.002], ao: 0.94 });
  // Lower sleeve: slack, hanging back off the triceps.
  b.add(new THREE.CapsuleGeometry(0.057, 0.085, 4, 10), MAT.cloth, P.fatigue, {
    pos: [0, -0.205, -0.008], ao: 0.93,
  });
  // Cuff above the elbow — the compression that makes the slack above it read as slack.
  b.add(new THREE.CylinderGeometry(0.05, 0.047, 0.034, 10), MAT.cloth, P.fatigueDark, {
    pos: [0, -0.272, -0.004], ao: 0.84,
  });
  // Rolled sleeve seam and a shoulder patch.
  b.add(new THREE.CylinderGeometry(0.064, 0.062, 0.022, 10), MAT.cloth, P.fatigueDark, {
    pos: [0, -0.152, -0.002], ao: 0.86,
  });
  b.add(roundedBox(0.05, 0.05, 0.014, 0.005), MAT.cloth, P.helmet, {
    pos: [0.056, -0.06, 0.014], rot: [0, 0.5, 0], ao: 0.9,
  });
  // Brassard / shoulder armour lip riding on top of the deltoid, with its retaining strap.
  b.add(roundedBox(0.104, 0.058, 0.116, 0.026), MAT.webbing, P.carrierDark, {
    pos: [0.014, 0.008, 0], rot: [0, 0, 0.14], ao: 0.84,
  });
  b.add(roundedBox(0.108, 0.016, 0.104, 0.006), MAT.webbing, P.webbing, {
    pos: [0.016, -0.026, 0], rot: [0, 0, 0.14], ao: 0.8,
  });
  return b.build('upperArm');
}

/**
 * Right forearm + gloved hand, origin at the elbow. Wrist lands at -RIG.foreArm.
 *
 * The glove now has knuckles: four bumps and a hard guard plate across the back of the hand.
 * Hands are read at close range more than any other part of a soldier, and a mitten reads as a
 * mitten however good the rest is.
 */
function buildForeArm(P) {
  const b = new SegmentBuilder();
  // Elbow pad, sitting over the joint.
  b.add(roundedBox(0.09, 0.092, 0.094, 0.034), MAT.padded, P.knee, { pos: [0, -0.02, 0.008], ao: 0.86 });
  // Forearm: fuller near the elbow, tapering into the wrist the way a real one does.
  b.add(new THREE.CapsuleGeometry(0.052, 0.1, 4, 10), MAT.cloth, P.fatigue, { pos: [0, -0.105, 0.002], ao: 0.93 });
  b.add(new THREE.CapsuleGeometry(0.045, 0.06, 3, 9), MAT.cloth, P.fatigue, { pos: [0, -0.19, 0.002], ao: 0.92 });
  // Cuff at the wrist, over the glove gauntlet.
  b.add(new THREE.CylinderGeometry(0.05, 0.043, 0.036, 10), MAT.glove, P.glove, {
    pos: [0, -0.248, 0.002], ao: 0.85,
  });
  b.add(roundedBox(0.086, 0.014, 0.08, 0.005), MAT.webbing, P.webbing, {
    pos: [0, -0.232, 0.002], ao: 0.8,
  });
  // Wristwatch — small, but it is the kind of detail that stops a model reading as generic.
  b.add(roundedBox(0.032, 0.012, 0.03, 0.005), MAT.gunmetal, P.gunmetal, {
    pos: [-0.042, -0.222, 0], rot: [0, 0, 0.2], ao: 0.9,
  });
  // Glove: palm block, thumb, wrapped fingers.
  b.add(roundedBox(0.058, 0.098, 0.086, 0.024), MAT.glove, P.glove, {
    pos: [0, -0.29, 0.006], rot: [0.1, 0, 0], ao: 0.9,
  });
  b.add(roundedBox(0.027, 0.052, 0.032, 0.01), MAT.glove, P.glove, {
    pos: [-0.031, -0.279, 0.032], rot: [0.2, 0, 0.5], ao: 0.86,
  });
  b.add(roundedBox(0.052, 0.052, 0.054, 0.02), MAT.glove, P.glove, {
    pos: [0.002, -0.336, 0.016], rot: [0.35, 0, 0], ao: 0.82,
  });
  // Knuckles: four bumps across the back of the hand, plus the hard guard over them.
  for (let i = 0; i < 4; i++) {
    b.add(roundedBox(0.014, 0.016, 0.015, 0.006), MAT.glove, P.glove, {
      pos: [-0.021 + i * 0.014, -0.322 - i * 0.001, -0.03], rot: [0.3, 0, 0], ao: 0.88,
    });
  }
  b.add(roundedBox(0.056, 0.03, 0.02, 0.008), MAT.rubber, P.gunPolymer, {
    pos: [0, -0.318, -0.033], rot: [0.28, 0, 0], ao: 0.84,
  });
  // Reinforced palm patch — catches a different roughness to the back of the glove.
  b.add(roundedBox(0.05, 0.07, 0.012, 0.005), MAT.leather, P.boot, {
    pos: [0, -0.294, 0.048], rot: [0.1, 0, 0], ao: 0.86,
  });
  return b.build('foreArm');
}

/**
 * Right thigh, origin at the hip joint. Knee at -RIG.thigh.
 *
 * Three volumes, not one: the quad, a slack lower section hanging slightly rearward, and a
 * pronounced narrowing into the knee. Combat trousers are cut loose and gather above the knee
 * pad, and that gather is the difference between a leg and a cylinder.
 */
function buildThigh(P) {
  const b = new SegmentBuilder();
  b.add(new THREE.CapsuleGeometry(0.09, 0.19, 4, 11), MAT.cloth, P.fatigue, { pos: [0, -0.155, 0.004], ao: 0.95 });
  // Slack, hanging back off the hamstring.
  b.add(new THREE.CapsuleGeometry(0.084, 0.1, 4, 11), MAT.cloth, P.fatigue, { pos: [0, -0.285, -0.012], ao: 0.92 });
  // Compression into the knee.
  b.add(new THREE.CapsuleGeometry(0.07, 0.05, 3, 10), MAT.cloth, P.fatigue, { pos: [0, -0.378, -0.004], ao: 0.9 });
  // Cargo pocket on the outer thigh, with a flap, a buckle and a pull tab.
  b.add(roundedBox(0.058, 0.14, 0.115, 0.026), MAT.cloth, P.fatigueDark, {
    pos: [0.08, -0.2, 0.012], rot: [0, 0, -0.05], ao: 0.86,
  });
  b.add(roundedBox(0.062, 0.042, 0.12, 0.012), MAT.webbing, P.webbing, {
    pos: [0.082, -0.132, 0.012], rot: [0, 0, -0.05], ao: 0.84,
  });
  b.add(roundedBox(0.03, 0.03, 0.014, 0.005, 1), MAT.polymer, P.gunPolymer, {
    pos: [0.088, -0.152, 0.07], rot: [0.2, 0, -0.05], ao: 0.86,
  });
  // Small dressing pouch on the inner thigh — asymmetry stops the legs mirroring perfectly.
  b.add(roundedBox(0.048, 0.07, 0.05, 0.016), MAT.webbing, P.webbing, {
    pos: [-0.072, -0.235, 0.024], rot: [0, 0.2, 0.06], ao: 0.82,
  });
  // Drop-leg strap running down from the belt to the pocket.
  b.add(roundedBox(0.024, 0.16, 0.012, 0.004, 1), MAT.webbing, P.webbing, {
    pos: [0.086, -0.09, 0.05], rot: [0, 0, -0.06], ao: 0.84,
  });
  // Knee pad's upper strap, wrapping the trouser above the joint.
  b.add(new THREE.CylinderGeometry(0.076, 0.074, 0.022, 11, 1, true), MAT.webbing, P.webbing, {
    pos: [0, -0.365, -0.004], ao: 0.82,
  });
  return b.build('thigh');
}

/** Right shin, origin at the knee. Ankle at -RIG.shin. Knee pad rides here so it tracks the joint. */
function buildShin(P) {
  const b = new SegmentBuilder();
  // Knee pad: a domed cap over the joint with a raised rim, and two wrap straps.
  b.add(roundedBox(0.118, 0.124, 0.1, 0.044), MAT.padded, P.knee, { pos: [0, -0.028, 0.03], ao: 0.9 });
  b.add(roundedBox(0.104, 0.05, 0.05, 0.022), MAT.padded, P.knee, {
    pos: [0, -0.075, 0.052], rot: [0.45, 0, 0], ao: 0.86,
  });
  b.add(new THREE.CylinderGeometry(0.072, 0.07, 0.02, 11, 1, true), MAT.webbing, P.webbing, {
    pos: [0, -0.088, 0.002], ao: 0.8,
  });
  b.add(roundedBox(0.028, 0.026, 0.02, 0.006), MAT.polymer, P.gunPolymer, {
    pos: [-0.068, -0.088, 0.014], rot: [0, 0.4, 0], ao: 0.82,
  });
  // Calf: full at the top, offset rearward, then a real taper into the ankle.
  b.add(new THREE.CapsuleGeometry(0.068, 0.15, 4, 10), MAT.cloth, P.fatigue, { pos: [0, -0.185, -0.012], ao: 0.94 });
  b.add(new THREE.CapsuleGeometry(0.053, 0.07, 3, 9), MAT.cloth, P.fatigue, { pos: [0, -0.315, -0.006], ao: 0.9 });
  // Blousing over the boot top plus the elastic that holds it.
  b.add(new THREE.CylinderGeometry(0.072, 0.06, 0.082, 11), MAT.cloth, P.fatigueDark, {
    pos: [0, -0.372, -0.004], ao: 0.86,
  });
  b.add(new THREE.CylinderGeometry(0.064, 0.064, 0.016, 11), MAT.webbing, P.webbing, {
    pos: [0, -0.404, -0.004], ao: 0.8,
  });
  return b.build('shin');
}

/**
 * Right boot, origin at the ankle. Sole bottom sits at y = -0.085 so the ankle rides at
 * RIG.ankleY and the foot IK target lands the tread exactly on the ground.
 */
function buildBoot(P) {
  const b = new SegmentBuilder();
  // Padded ankle collar — a boot without one has no join to the trouser.
  b.add(new THREE.CylinderGeometry(0.056, 0.05, 0.052, 10), MAT.leather, P.boot, {
    pos: [0, 0.012, -0.004], ao: 0.82,
  });
  b.add(roundedBox(0.1, 0.1, 0.118, 0.03), MAT.leather, P.boot, { pos: [0, -0.03, -0.002], ao: 0.88 });
  b.add(roundedBox(0.096, 0.062, 0.138, 0.028), MAT.leather, P.boot, {
    pos: [0, -0.05, 0.076], rot: [0.06, 0, 0], ao: 0.9,
  });
  // Toe cap: a separate, harder panel with its own seam line.
  b.add(roundedBox(0.09, 0.044, 0.064, 0.02), MAT.leather, P.boot, {
    pos: [0, -0.056, 0.148], rot: [0.16, 0, 0], ao: 0.88,
  });
  b.add(roundedBox(0.086, 0.012, 0.016, 0.004, 1), MAT.leather, P.sole, {
    pos: [0, -0.042, 0.118], rot: [0.16, 0, 0], ao: 0.8,
  });
  // Heel counter.
  b.add(roundedBox(0.092, 0.064, 0.05, 0.022), MAT.leather, P.boot, { pos: [0, -0.03, -0.056], ao: 0.86 });
  // Midsole, outsole and the heel block — the heel is what stops a boot looking like a slipper.
  b.add(roundedBox(0.106, 0.02, 0.292, 0.008), MAT.rubber, P.sole, { pos: [0, -0.062, 0.05], ao: 0.72 });
  b.add(roundedBox(0.11, 0.014, 0.286, 0.005), MAT.rubber, P.sole, { pos: [0, -0.073, 0.05], ao: 0.66 });
  b.add(roundedBox(0.104, 0.03, 0.086, 0.008), MAT.rubber, P.sole, { pos: [0, -0.066, -0.046], ao: 0.62 });
  // Tread lugs. Boxes, not chamfered — they are 12 triangles each and only ever seen in
  // silhouette against the ground or when a corpse's sole faces the camera.
  for (let i = 0; i < 5; i++) {
    b.add(roundedBox(0.096, 0.012, 0.03, 0.002, 1), MAT.rubber, P.sole, {
      pos: [0, -0.079, -0.06 + i * 0.055], ao: 0.55,
    });
  }
  // Laces: rungs up the vamp, then a pair of speed hooks at the top.
  for (let i = 0; i < 4; i++) {
    b.add(roundedBox(0.072, 0.008, 0.012, 0.003, 1), MAT.webbing, P.webbing, {
      pos: [0, -0.008 - i * 0.02, 0.056 + i * 0.007], rot: [0.1, 0, 0], ao: 0.8,
    });
  }
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    b.add(roundedBox(0.01, 0.01, 0.012, 0.003, 1), MAT.gunmetal, P.gunmetal, {
      pos: [s * 0.038, 0.008, 0.042], ao: 0.85,
    });
  }
  return b.build('boot');
}

/**
 * Compact carbine. Authored pointing down -Z to match the body's forward axis, origin at the
 * pistol grip / trigger so the right hand grips near the local origin.
 */
function buildRifle(P) {
  const b = new SegmentBuilder();
  const gm = P.gunmetal;
  const poly = P.gunPolymer;
  // Receiver.
  b.add(roundedBox(0.044, 0.078, 0.3, 0.012), MAT.gunmetal, gm, { pos: [0, 0.012, -0.06], ao: 0.95 });
  b.add(roundedBox(0.046, 0.03, 0.12, 0.008), MAT.gunmetal, gm, { pos: [0, 0.052, -0.03], ao: 0.9 });
  // Ejection port and forward assist.
  b.add(roundedBox(0.008, 0.036, 0.07, 0.004), MAT.gunmetal, gm.clone().multiplyScalar(0.7), {
    pos: [0.024, 0.02, -0.05], ao: 0.8,
  });
  b.add(new THREE.CylinderGeometry(0.011, 0.011, 0.024, 7), MAT.gunmetal, gm, {
    pos: [0.028, 0.038, -0.012], rot: [0, 0, Math.PI * 0.5], ao: 0.9,
  });
  // Handguard with vent slots.
  b.add(roundedBox(0.05, 0.056, 0.27, 0.016), MAT.polymer, poly, { pos: [0, 0.012, -0.34], ao: 0.94 });
  for (let i = 0; i < 4; i++) {
    const z = -0.26 - i * 0.05;
    b.add(roundedBox(0.056, 0.016, 0.03, 0.004), MAT.gunmetal, gm.clone().multiplyScalar(0.55), {
      pos: [0, 0.012, z], ao: 0.6,
    });
  }
  // Barrel, gas block, muzzle device.
  b.add(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 9), MAT.gunmetal, gm.clone().multiplyScalar(0.8), {
    pos: [0, 0.012, -0.55], rot: [Math.PI * 0.5, 0, 0], ao: 0.95,
  });
  b.add(roundedBox(0.026, 0.03, 0.04, 0.008), MAT.gunmetal, gm, { pos: [0, 0.02, -0.48], ao: 0.9 });
  b.add(new THREE.CylinderGeometry(0.017, 0.015, 0.055, 9), MAT.gunmetal, gm.clone().multiplyScalar(0.62), {
    pos: [0, 0.012, -0.655], rot: [Math.PI * 0.5, 0, 0], ao: 0.95,
  });
  for (let i = 0; i < 3; i++) {
    b.add(roundedBox(0.036, 0.006, 0.008, 0.002), MAT.gunmetal, gm.clone().multiplyScalar(0.5), {
      pos: [0, 0.012, -0.645 + i * 0.016], ao: 0.7,
    });
  }
  // Magazine — two blocks at slightly different angles reads as curved.
  b.add(roundedBox(0.036, 0.13, 0.062, 0.01), MAT.polymer, poly, {
    pos: [0, -0.075, -0.085], rot: [0.09, 0, 0], ao: 0.9,
  });
  b.add(roundedBox(0.034, 0.09, 0.058, 0.01), MAT.polymer, poly, {
    pos: [0, -0.175, -0.055], rot: [0.3, 0, 0], ao: 0.86,
  });
  b.add(roundedBox(0.038, 0.014, 0.064, 0.005), MAT.polymer, poly.clone().multiplyScalar(0.7), {
    pos: [0, -0.222, -0.043], rot: [0.3, 0, 0], ao: 0.8,
  });
  // Pistol grip and trigger guard.
  b.add(roundedBox(0.038, 0.13, 0.055, 0.016), MAT.polymer, poly, {
    pos: [0, -0.082, 0.045], rot: [-0.32, 0, 0], ao: 0.9,
  });
  b.add(new THREE.TorusGeometry(0.028, 0.006, 5, 10, Math.PI), MAT.gunmetal, gm, {
    pos: [0, -0.024, -0.004], rot: [0, Math.PI * 0.5, Math.PI], ao: 0.88,
  });
  b.add(roundedBox(0.008, 0.024, 0.008, 0.003), MAT.gunmetal, gm.clone().multiplyScalar(0.8), {
    pos: [0, -0.026, 0.002], ao: 0.85,
  });
  // Stock: buffer tube, cheek riser, butt pad.
  b.add(new THREE.CylinderGeometry(0.019, 0.019, 0.19, 10), MAT.gunmetal, gm, {
    pos: [0, 0.016, 0.17], rot: [Math.PI * 0.5, 0, 0], ao: 0.92,
  });
  b.add(roundedBox(0.046, 0.055, 0.13, 0.016), MAT.polymer, poly, { pos: [0, 0.006, 0.2], ao: 0.9 });
  b.add(roundedBox(0.05, 0.075, 0.022, 0.008), MAT.rubber, P.sole, { pos: [0, -0.002, 0.268], ao: 0.8 });
  // Optic: mount, tube, and an emissive-ish glass face.
  b.add(roundedBox(0.03, 0.03, 0.075, 0.008), MAT.gunmetal, gm, { pos: [0, 0.068, -0.055], ao: 0.9 });
  b.add(new THREE.CylinderGeometry(0.021, 0.021, 0.085, 10), MAT.gunmetal, gm.clone().multiplyScalar(0.85), {
    pos: [0, 0.092, -0.06], rot: [Math.PI * 0.5, 0, 0], ao: 0.95,
  });
  b.add(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 10), MAT.optic, P.optic, {
    pos: [0, 0.092, -0.101], rot: [Math.PI * 0.5, 0, 0], ao: 1.0,
  });
  // Sling loops and a charging handle. The front loop is a real QD socket on a mount, because
  // the dynamic sling strap is anchored to it and a strap that emerges from bare polymer looks
  // like a mistake rather than a fitting.
  b.add(new THREE.TorusGeometry(0.012, 0.0035, 4, 8), MAT.gunmetal, gm, {
    pos: [0.024, -0.01, 0.09], rot: [0, Math.PI * 0.5, 0], ao: 0.85,
  });
  b.add(roundedBox(0.024, 0.024, 0.03, 0.006), MAT.gunmetal, gm.clone().multiplyScalar(0.9), {
    pos: [-0.03, 0.006, -0.4], ao: 0.88,
  });
  b.add(new THREE.TorusGeometry(0.013, 0.0038, 4, 9), MAT.gunmetal, gm, {
    pos: [-0.04, 0.0, -0.4], rot: [0, Math.PI * 0.5, 0], ao: 0.85,
  });
  b.add(roundedBox(0.05, 0.012, 0.02, 0.004), MAT.gunmetal, gm.clone().multiplyScalar(0.75), {
    pos: [0, 0.05, 0.078], ao: 0.85,
  });
  return b.build('rifle');
}

/**
 * The sling strap, authored in a unit span: it runs from the origin (the rifle's front QD
 * loop) to (0, 0, 1), sagging in -Y. `poseSling` gives the segment's bone a basis whose Z axis
 * is scaled to the live gap between the loop and the shoulder, so the strap really does
 * connect the weapon to the body and really does tighten and slacken as the rifle moves.
 *
 * Built from short boxes following the curve rather than a swept tube: eleven boxes at twelve
 * triangles each is 132 triangles for a part that is only ever a few pixels wide.
 */
function buildSling(P) {
  const b = new SegmentBuilder();
  const N = 9;
  const SAG = 0.115;
  // Parabolic drape. Real webbing under its own weight is a catenary, but over this span the
  // two are within a millimetre of each other and a parabola is two multiplies.
  const py = (u) => -SAG * 4 * u * (1 - u);
  for (let i = 0; i < N; i++) {
    const u0 = i / N;
    const u1 = (i + 1) / N;
    const y0 = py(u0);
    const y1 = py(u1);
    const dy = y1 - y0;
    const dz = u1 - u0;
    const len = Math.hypot(dy, dz);
    b.add(roundedBox(0.034, 0.008, len * 1.12, 0.002, 1), MAT.webbing, P.webbing, {
      pos: [0, (y0 + y1) * 0.5, (u0 + u1) * 0.5],
      rot: [Math.atan2(-dy, dz), 0, 0],
      ao: 0.86,
      grain: 0.09,
    });
  }
  // Length adjuster sliding on the strap, and the snap hook at the weapon end.
  b.add(roundedBox(0.042, 0.014, 0.03, 0.004, 1), MAT.polymer, P.gunPolymer, {
    pos: [0, py(0.3) - 0.002, 0.3], rot: [Math.atan2(SAG * 0.8, 1), 0, 0], ao: 0.82,
  });
  b.add(roundedBox(0.02, 0.02, 0.028, 0.005, 1), MAT.gunmetal, P.gunmetal, {
    pos: [0, -0.002, 0.022], ao: 0.88,
  });
  return b.build('sling');
}

/** Local-space grip, muzzle and fitting anchors on the rifle geometry above. */
const RIFLE = {
  gripR: new THREE.Vector3(0.0, -0.055, 0.028),
  gripL: new THREE.Vector3(-0.004, -0.048, -0.3),
  muzzle: new THREE.Vector3(0, 0.012, -0.69),
  eject: new THREE.Vector3(0.03, 0.02, -0.05),
  /** Front sling QD socket — the moving end of the strap. */
  slingFront: new THREE.Vector3(-0.046, 0.0, -0.4),
  /** Magazine well, where the support hand goes during an idle weapon check. */
  magWell: new THREE.Vector3(-0.01, -0.135, -0.082),
};

/** Build every segment geometry once. Left limbs are mirrored copies of the right. */
function buildSegmentGeometries(P) {
  const uarm = buildUpperArm(P);
  const farm = buildForeArm(P);
  const thigh = buildThigh(P);
  const shin = buildShin(P);
  const boot = buildBoot(P);
  const geos = new Array(SEG_COUNT);
  geos[SEG.pelvis] = buildPelvis(P);
  geos[SEG.chest] = buildChest(P);
  geos[SEG.head] = buildHead(P);
  geos[SEG.helmet] = buildHelmet(P);
  geos[SEG.cover] = buildHelmetCover(P);
  geos[SEG.uarmR] = uarm;
  geos[SEG.farmR] = farm;
  geos[SEG.uarmL] = mirrorX(uarm);
  geos[SEG.farmL] = mirrorX(farm);
  geos[SEG.thighR] = thigh;
  geos[SEG.shinR] = shin;
  geos[SEG.bootR] = boot;
  geos[SEG.thighL] = mirrorX(thigh);
  geos[SEG.shinL] = mirrorX(shin);
  geos[SEG.bootL] = mirrorX(boot);
  geos[SEG.rifle] = buildRifle(P);
  geos[SEG.sling] = buildSling(P);
  return geos;
}

/* ========================================================================== */
/* Rig                                                                        */
/* ========================================================================== */

/**
 * A pure-transform bone tree. It carries no meshes and is never added to the scene: we drive
 * it, call `updateMatrixWorld`, then copy each bone's world matrix into an instance buffer.
 */
function buildSkeleton() {
  const mk = (name, x, y, z, parent) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    o.matrixAutoUpdate = false; // we compose explicitly, once per frame
    if (parent) parent.add(o);
    return o;
  };
  const root = new THREE.Object3D();
  root.name = 'soldier';
  root.matrixAutoUpdate = false;

  const hips = mk('hips', 0, RIG.hipsY, 0, root);
  const spine = mk('spine', 0, RIG.spineY, 0, hips);
  const chest = mk('chest', 0, RIG.chestY, 0, spine);
  const neck = mk('neck', 0, RIG.neckY, 0, chest);
  const head = mk('head', 0, RIG.headY, 0.005, neck);
  const shoulderR = mk('shoulderR', RIG.shoulderX, RIG.shoulderY, 0, chest);
  const elbowR = mk('elbowR', 0, -RIG.upperArm, 0, shoulderR);
  const wristR = mk('wristR', 0, -RIG.foreArm, 0, elbowR);
  const shoulderL = mk('shoulderL', -RIG.shoulderX, RIG.shoulderY, 0, chest);
  const elbowL = mk('elbowL', 0, -RIG.upperArm, 0, shoulderL);
  const wristL = mk('wristL', 0, -RIG.foreArm, 0, elbowL);
  const hipR = mk('hipR', RIG.hipX, RIG.hipYOff, 0, hips);
  const kneeR = mk('kneeR', 0, -RIG.thigh, 0, hipR);
  const ankleR = mk('ankleR', 0, -RIG.shin, 0, kneeR);
  const hipL = mk('hipL', -RIG.hipX, RIG.hipYOff, 0, hips);
  const kneeL = mk('kneeL', 0, -RIG.thigh, 0, hipL);
  const ankleL = mk('ankleL', 0, -RIG.shin, 0, kneeL);
  const rifle = mk('rifle', 0, 0, 0, chest);
  // The sling's "bone" is a leaf that never drives anything and never has its local TRS read:
  // poseSling writes its matrixWorld directly, because the strap needs a non-uniform basis
  // (uniform thickness, live length) that a position/quaternion/scale triple cannot express.
  const sling = mk('sling', 0, 0, 0, chest);

  return {
    root, hips, spine, chest, neck, head,
    shoulderR, elbowR, wristR, shoulderL, elbowL, wristL,
    hipR, kneeR, ankleR, hipL, kneeL, ankleL,
    rifle, sling,
  };
}

/** Compose a bone's local matrix from its own TRS. Bones are matrixAutoUpdate:false. */
function refreshLocal(bone) {
  bone.matrix.compose(bone.position, bone.quaternion, bone.scale);
}

/** World position of a bone, straight out of its matrixWorld — no decompose needed. */
function boneWorldPos(bone, out) {
  const e = bone.matrixWorld.elements;
  return out.set(e[12], e[13], e[14]);
}

/**
 * Give a bone a world-space orientation, expressed as "the limb's -Y axis points along `dir`,
 * and it bends toward `pole`". This is the primitive every IK result flows through.
 */
function setBoneAim(bone, dir, pole) {
  _ay.copy(dir).multiplyScalar(-1); // local +Y is up the limb, so it opposes the aim
  if (_ay.lengthSq() < 1e-10) return;
  _ay.normalize();
  _az.copy(pole).addScaledVector(_ay, -pole.dot(_ay));
  if (_az.lengthSq() < 1e-8) {
    // Degenerate pole: pick any perpendicular so we never emit a NaN basis.
    _az.set(_ay.z, _ay.x, _ay.y).addScaledVector(_ay, -(_ay.z * _ay.x + _ay.x * _ay.y + _ay.y * _ay.z));
    if (_az.lengthSq() < 1e-8) _az.set(0, 0, 1).addScaledVector(_ay, -_ay.z);
  }
  _az.normalize();
  _ax.crossVectors(_ay, _az).normalize();
  _m1.makeBasis(_ax, _ay, _az);
  _q0.setFromRotationMatrix(_m1);
  setBoneWorldQuat(bone, _q0);
}

/** Convert a desired world quaternion into the bone's local quaternion. */
function setBoneWorldQuat(bone, worldQuat) {
  const parent = bone.parent;
  if (parent) {
    parent.matrixWorld.decompose(_dp, _dq, _ds);
    bone.quaternion.copy(_dq.invert()).multiply(worldQuat);
  } else {
    bone.quaternion.copy(worldQuat);
  }
  bone.quaternion.normalize();
}

/** Place a node at a world transform, given its parent's matrixWorld is current. */
function setWorldTransform(node, pos, quat, scale) {
  _v7.set(scale, scale, scale);
  _m0.compose(pos, quat, _v7);
  if (node.parent) {
    _m2.copy(node.parent.matrixWorld).invert();
    _m0.premultiply(_m2);
  }
  _m0.decompose(node.position, node.quaternion, node.scale);
}

/**
 * Analytic two-bone IK. Given a root and a target, returns the mid-joint world position that
 * satisfies both bone lengths, bending toward `pole`. Over-extension straightens rather than
 * snapping, which is what keeps a running gait from popping.
 *
 * @returns {THREE.Vector3} `out`, the mid-joint position
 */
function solveTwoBone(rootPos, targetPos, pole, len1, len2, out) {
  _ik0.copy(targetPos).sub(rootPos);
  let dist = _ik0.length();
  const maxLen = (len1 + len2) * 0.999;
  const minLen = Math.abs(len1 - len2) * 1.001 + 1e-4;
  if (dist < 1e-5) {
    _ik0.set(0, -1, 0);
    dist = 1e-5;
  }
  _ik1.copy(_ik0).divideScalar(dist); // unit root→target
  const clamped = clamp(dist, minLen, maxLen);
  // Law of cosines: distance from root to the projection of the mid joint on the chord.
  const a = (len1 * len1 - len2 * len2 + clamped * clamped) / (2 * clamped);
  const hSq = len1 * len1 - a * a;
  const h = hSq > 0 ? Math.sqrt(hSq) : 0;
  // Bend plane: the component of the pole perpendicular to the chord.
  _ik2.copy(pole).addScaledVector(_ik1, -pole.dot(_ik1));
  if (_ik2.lengthSq() < 1e-8) {
    _ik3.set(0, 1, 0);
    _ik2.crossVectors(_ik1, _ik3);
    if (_ik2.lengthSq() < 1e-8) _ik2.set(1, 0, 0);
  }
  _ik2.normalize();
  out.copy(rootPos).addScaledVector(_ik1, a).addScaledVector(_ik2, h);
  return out;
}

/**
 * Drive a three-bone chain (root → mid → tip) onto a world target.
 * `poleWorld` is where the joint should bend toward.
 */
function ikChain(rootBone, midBone, tipBone, targetWorld, poleWorld, len1, len2) {
  // Refresh the root's world matrix from its parent before reading its position. Its
  // matrixWorld is otherwise left over from the previous frame, and the shoulder/hip it
  // describes has moved since: the pelvis alone travels by the bob, the heel-strike settle,
  // the lateral weight shift and the whole body's velocity between frames. Solving to a
  // one-frame-old root made the legs lag the hips by up to 10 cm at a sprint — measured as
  // 3.8 cm of boot pushed through the ground — and after a pool slot is recycled the stale
  // matrix belongs to the *previous* soldier, metres away, so the first frame of a respawn
  // posed its legs from a dead man's hips. Only the translation is used here, and that depends
  // solely on the parent and a fixed local offset, so the stale rotation is harmless.
  if (rootBone.parent) {
    refreshLocal(rootBone);
    rootBone.matrixWorld.multiplyMatrices(rootBone.parent.matrixWorld, rootBone.matrix);
  }
  boneWorldPos(rootBone, _v4);
  solveTwoBone(_v4, targetWorld, poleWorld, len1, len2, _v5);
  _v6.copy(_v5).sub(_v4);
  if (_v6.lengthSq() > 1e-10) {
    _v6.normalize();
    setBoneAim(rootBone, _v6, poleWorld);
    refreshLocal(rootBone);
    rootBone.matrixWorld.multiplyMatrices(rootBone.parent.matrixWorld, rootBone.matrix);
  }
  _v6.copy(targetWorld).sub(_v5);
  if (_v6.lengthSq() > 1e-10) {
    _v6.normalize();
    setBoneAim(midBone, _v6, poleWorld);
    refreshLocal(midBone);
    midBone.matrixWorld.multiplyMatrices(midBone.parent.matrixWorld, midBone.matrix);
  }
  if (tipBone) {
    refreshLocal(tipBone);
    tipBone.matrixWorld.multiplyMatrices(midBone.matrixWorld, tipBone.matrix);
  }
}

/* ========================================================================== */
/* Navigation — A* over level.navGrid, allocation free after construction      */
/* ========================================================================== */

const NAV_MAX_EXPAND = 3600;
const NAV_MAX_PATH = 128;
const DIAG = Math.SQRT2;

function createNav(level) {
  const grid = level && level.navGrid;
  if (!grid || !grid.walkable || !grid.w || !grid.h) return null;
  const w = grid.w | 0;
  const h = grid.h | 0;
  const n = w * h;
  if (n <= 0 || grid.walkable.length < n) return null;
  const cell = grid.cell || 1;
  const org = grid.origin;
  const ox = org ? (org.x !== undefined ? org.x : org[0] || 0) : 0;
  const oz = org ? (org.z !== undefined ? org.z : org[2] || 0) : 0;
  const walk = grid.walkable;

  const gScore = new Float32Array(n);
  const fScore = new Float32Array(n);
  const cameFrom = new Int32Array(n);
  const stamp = new Int32Array(n); // generation marker, avoids clearing n floats per query
  const state = new Uint8Array(n); // 0 unseen, 1 open, 2 closed
  const heap = new Int32Array(n + 1);
  const heapPos = new Int32Array(n);
  const raw = new Int32Array(NAV_MAX_PATH);
  let gen = 0;
  let heapSize = 0;

  const idx = (x, z) => z * w + x;
  const walkable = (x, z) => x >= 0 && z >= 0 && x < w && z < h && walk[z * w + x] !== 0;

  function heapPush(node) {
    let i = ++heapSize;
    heap[i] = node;
    heapPos[node] = i;
    const f = fScore[node];
    while (i > 1) {
      const p = i >> 1;
      if (fScore[heap[p]] <= f) break;
      heap[i] = heap[p];
      heapPos[heap[i]] = i;
      i = p;
    }
    heap[i] = node;
    heapPos[node] = i;
  }

  function heapPop() {
    const top = heap[1];
    const last = heap[heapSize--];
    if (heapSize > 0) {
      let i = 1;
      const f = fScore[last];
      for (;;) {
        let c = i << 1;
        if (c > heapSize) break;
        if (c + 1 <= heapSize && fScore[heap[c + 1]] < fScore[heap[c]]) c++;
        if (fScore[heap[c]] >= f) break;
        heap[i] = heap[c];
        heapPos[heap[i]] = i;
        i = c;
      }
      heap[i] = last;
      heapPos[last] = i;
    }
    return top;
  }

  function heapDecrease(node) {
    let i = heapPos[node];
    const f = fScore[node];
    while (i > 1) {
      const p = i >> 1;
      if (fScore[heap[p]] <= f) break;
      heap[i] = heap[p];
      heapPos[heap[i]] = i;
      i = p;
    }
    heap[i] = node;
    heapPos[node] = i;
  }

  /** Octile distance — admissible and tight for an 8-connected grid. */
  function heuristic(x, z, gx, gz) {
    const dx = Math.abs(x - gx);
    const dz = Math.abs(z - gz);
    return (dx > dz ? dx - dz : dz - dx) + DIAG * (dx > dz ? dz : dx);
  }

  /** Nearest walkable cell within `maxR` rings — spawn and cover points land on edges. */
  function snap(x, z, maxR) {
    if (walkable(x, z)) return idx(x, z);
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (walkable(x + dx, z + dz)) return idx(x + dx, z + dz);
        }
      }
    }
    return -1;
  }

  const nav = {
    w, h, cell, ox, oz,
    toGX: (wx) => Math.floor((wx - ox) / cell),
    toGZ: (wz) => Math.floor((wz - oz) / cell),
    worldX: (gx) => ox + (gx + 0.5) * cell,
    worldZ: (gz) => oz + (gz + 0.5) * cell,
    walkableAt(wx, wz) {
      return walkable(Math.floor((wx - ox) / cell), Math.floor((wz - oz) / cell));
    },

    /**
     * A* from world start to world goal. Writes world x/z pairs into `out` (Float32Array),
     * returns the number of waypoints, or 0 on failure.
     */
    search(sx, sz, tx, tz, out, outMax) {
      const s = snap(Math.floor((sx - ox) / cell), Math.floor((sz - oz) / cell), 4);
      const g = snap(Math.floor((tx - ox) / cell), Math.floor((tz - oz) / cell), 5);
      if (s < 0 || g < 0) return 0;
      if (s === g) {
        out[0] = tx;
        out[1] = tz;
        return 1;
      }
      gen++;
      heapSize = 0;
      const gx = g % w;
      const gz = (g / w) | 0;
      stamp[s] = gen;
      state[s] = 1;
      gScore[s] = 0;
      fScore[s] = heuristic(s % w, (s / w) | 0, gx, gz);
      cameFrom[s] = -1;
      heapPush(s);

      let expanded = 0;
      let best = s;
      let bestH = fScore[s];
      let found = false;

      while (heapSize > 0 && expanded < NAV_MAX_EXPAND) {
        const cur = heapPop();
        if (cur === g) {
          found = true;
          best = cur;
          break;
        }
        state[cur] = 2;
        expanded++;
        const cx = cur % w;
        const cz = (cur / w) | 0;
        const hCur = heuristic(cx, cz, gx, gz);
        if (hCur < bestH) {
          bestH = hCur;
          best = cur;
        }
        const gCur = gScore[cur];
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nx = cx + dx;
            const nz = cz + dz;
            if (!walkable(nx, nz)) continue;
            // Diagonal corner check: never cut a corner past two blocked orthogonals.
            if (dx !== 0 && dz !== 0) {
              if (!walkable(cx + dx, cz) || !walkable(cx, cz + dz)) continue;
            }
            const ni = nz * w + nx;
            if (stamp[ni] === gen && state[ni] === 2) continue;
            const step = dx !== 0 && dz !== 0 ? DIAG : 1;
            const tentative = gCur + step;
            if (stamp[ni] !== gen) {
              stamp[ni] = gen;
              state[ni] = 0;
              gScore[ni] = Infinity;
            }
            if (tentative >= gScore[ni]) continue;
            gScore[ni] = tentative;
            cameFrom[ni] = cur;
            fScore[ni] = tentative + heuristic(nx, nz, gx, gz) * 1.02; // slight weight: fewer expansions
            if (state[ni] === 1) heapDecrease(ni);
            else {
              state[ni] = 1;
              heapPush(ni);
            }
          }
        }
      }

      // Even a failed search leaves us the closest node reached — walking there beats standing still.
      let node = found ? g : best;
      let count = 0;
      while (node >= 0 && count < NAV_MAX_PATH) {
        raw[count++] = node;
        node = cameFrom[node];
      }
      if (count === 0) return 0;
      const limit = Math.min(count, outMax);
      let written = 0;
      for (let i = count - 1; i >= 0 && written < limit; i--) {
        const ni = raw[i];
        out[written * 2] = ox + ((ni % w) + 0.5) * cell;
        out[written * 2 + 1] = oz + (((ni / w) | 0) + 0.5) * cell;
        written++;
      }
      if (found && written > 0) {
        // Snap the last waypoint to the true goal so arrival is exact, not cell-centred.
        out[(written - 1) * 2] = tx;
        out[(written - 1) * 2 + 1] = tz;
      }
      return written;
    },
  };
  return nav;
}

/**
 * String-pull a grid path against the level so it stops looking like a staircase. Each skip is
 * validated with three parallel rays (centre plus body half-width) so corners are not clipped.
 */
function stringPull(level, path, count, y, budget) {
  if (!level || typeof level.raycast !== 'function' || count < 3) return count;
  let rays = budget;
  let write = 1;
  let anchor = 0;
  while (anchor < count - 1) {
    let furthest = anchor + 1;
    for (let j = count - 1; j > anchor + 1; j--) {
      if (rays <= 0) break;
      rays -= 3;
      if (clearBetween(level, path[anchor * 2], path[anchor * 2 + 1], path[j * 2], path[j * 2 + 1], y)) {
        furthest = j;
        break;
      }
    }
    path[write * 2] = path[furthest * 2];
    path[write * 2 + 1] = path[furthest * 2 + 1];
    write++;
    anchor = furthest;
    if (write >= count) break;
  }
  return write;
}

/** Three-ray corridor test at torso height. */
function clearBetween(level, ax, az, bx, bz, y) {
  _v0.set(bx - ax, 0, bz - az);
  const dist = _v0.length();
  if (dist < 0.05) return true;
  _v0.divideScalar(dist);
  _v1.set(-_v0.z, 0, _v0.x).multiplyScalar(ENEMY_RADIUS * 0.9);
  for (let s = -1; s <= 1; s++) {
    _v2.set(ax + _v1.x * s, y, az + _v1.z * s);
    const hit = level.raycast(_v2, _v0, dist);
    if (hit && hit.hit !== false && hit.distance !== undefined && hit.distance < dist - 0.05) return false;
    if (hit && hit.hit === true && hit.distance === undefined) return false;
  }
  return true;
}

/* ========================================================================== */
/* Enemy record                                                               */
/* ========================================================================== */

/** Ragdoll particle layout. Indices are also used to rebuild bone orientations. */
const RD = {
  hips: 0, chest: 1, head: 2,
  shoulderR: 3, elbowR: 4, wristR: 5,
  shoulderL: 6, elbowL: 7, wristL: 8,
  hipR: 9, kneeR: 10, ankleR: 11,
  hipL: 12, kneeL: 13, ankleL: 14,
};
const RD_COUNT = 15;
const RD_BONE = [
  'hips', 'chest', 'head',
  'shoulderR', 'elbowR', 'wristR',
  'shoulderL', 'elbowL', 'wristL',
  'hipR', 'kneeR', 'ankleR',
  'hipL', 'kneeL', 'ankleL',
];
/** [a, b, stiffness]. Structural edges plus cross braces that stop the torso folding flat. */
const RD_LINKS = [
  [RD.hips, RD.chest, 1.0],
  [RD.chest, RD.head, 1.0],
  [RD.chest, RD.shoulderR, 1.0],
  [RD.chest, RD.shoulderL, 1.0],
  [RD.shoulderR, RD.elbowR, 1.0],
  [RD.elbowR, RD.wristR, 1.0],
  [RD.shoulderL, RD.elbowL, 1.0],
  [RD.elbowL, RD.wristL, 1.0],
  [RD.hips, RD.hipR, 1.0],
  [RD.hips, RD.hipL, 1.0],
  [RD.hipR, RD.kneeR, 1.0],
  [RD.kneeR, RD.ankleR, 1.0],
  [RD.hipL, RD.kneeL, 1.0],
  [RD.kneeL, RD.ankleL, 1.0],
  [RD.shoulderR, RD.shoulderL, 0.85],
  [RD.hipR, RD.hipL, 0.85],
  [RD.shoulderR, RD.hipR, 0.55],
  [RD.shoulderL, RD.hipL, 0.55],
  [RD.shoulderR, RD.hipL, 0.4],
  [RD.shoulderL, RD.hipR, 0.4],
  [RD.head, RD.shoulderR, 0.5],
  [RD.head, RD.shoulderL, 0.5],
  // Soft limits: keep elbows and knees from hyper-extending into a noodle.
  [RD.shoulderR, RD.wristR, 0.18],
  [RD.shoulderL, RD.wristL, 0.18],
  [RD.hipR, RD.ankleR, 0.18],
  [RD.hipL, RD.ankleL, 0.18],
];
/** Collision radius per particle — heads and hips need to sit off the ground properly. */
const RD_RADIUS = [0.16, 0.18, 0.13, 0.1, 0.08, 0.07, 0.1, 0.08, 0.07, 0.1, 0.08, 0.08, 0.1, 0.08, 0.08];

const HIT_ZONES = ['head', 'torso', 'armR', 'armL', 'legR', 'legL'];
const ZONE_MULT = { head: 2.2, torso: 1.0, armR: 0.85, armL: 0.85, legR: 0.85, legL: 0.85 };
const ZONE_RADIUS = { head: 0.132, torso: 0.215, armR: 0.095, armL: 0.095, legR: 0.115, legL: 0.115 };

function createEnemyRecord(index) {
  const e = {
    index,
    id: 0,
    active: false,
    dead: false,
    archetype: ARCHETYPES.rifleman,
    seed: 0,
    rng: mulberry32(index * 7919 + 13),

    /* --- transform / motion --- */
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    desiredVel: new THREE.Vector3(),
    facing: 0,
    facingTarget: 0,
    groundY: 0,
    scale: 1,
    speed: 0,
    crouch: 0,
    crouchTarget: 0,

    /* --- combat / senses --- */
    health: ENEMY_HEALTH,
    state: 'idle',
    stateTime: 0,
    alert: 0,
    awareness: 0,
    canSee: false,
    losTimer: 0,
    lastSeenTime: -100,
    lastKnown: new THREE.Vector3(),
    lastKnownVel: new THREE.Vector3(),
    hasTarget: false,
    reactTimer: 0,
    fireTimer: 0,
    burstLeft: 0,
    burstPause: 0,
    ammo: 30,
    reloadTimer: 0,
    aimDir: new THREE.Vector3(0, 0, -1),
    aimTarget: new THREE.Vector3(),
    aimError: 0.08,
    aimAge: 0,
    aimOffset: new THREE.Vector3(),
    lookTarget: new THREE.Vector3(),
    lookAtWeight: 0,
    readyWeight: 0,
    scanPhase: 0,
    suppressedBy: 0,
    reinforceTimer: 0,
    fireToken: false,
    tokenTime: 0,

    /* --- pathing --- */
    path: new Float32Array(NAV_MAX_PATH * 2),
    pathLen: 0,
    pathIdx: 0,
    pathTimer: 0,
    pathGoal: new THREE.Vector3(),
    wantPath: false,
    goalKind: 'none',
    coverPoint: null,
    coverScore: 0,
    coverTimer: 0,

    /* --- gait --- */
    cycle: 0,
    cycleRate: 0,
    strideLen: 0.8,
    /** Live duty factor, derived from stride each frame — see FOOT_EXCURSION. */
    swingFrac: GAIT.swingFrac,
    footPos: [new THREE.Vector3(), new THREE.Vector3()],
    footPrev: [new THREE.Vector3(), new THREE.Vector3()],
    footPlant: [new THREE.Vector3(), new THREE.Vector3()],
    footLift: [0, 0],
    footPlanted: [true, true],
    /** Yaw the foot was planted at. Held through stance so a turning body never twists a
     *  planted boot — the single most visible foot-slide artefact there is. */
    footYaw: [0, 0],
    footYawPrev: [0, 0],
    footToeOut: [-0.1, 0.1],
    wasSwing: [false, false],
    /** Cooldown before the other foot may take a corrective step, so a turn is two steps. */
    stepCooldown: 0,
    hipBob: 0,
    hipRoll: 0,
    hipYaw: 0,
    bobPhase: 0,
    /** Heel-strike impact spring: a footfall drives it, it dips the pelvis and settles. */
    strike: 0,
    strikeV: 0,
    /** −1 fully on the left foot, +1 fully on the right. Drives pelvic drop and lateral shift. */
    weight: 0,
    weightBias: 0,
    weightBiasTarget: 0,
    pelvisShift: 0,
    armSwing: 0,

    /* --- additive layers --- */
    flinchPitch: 0,
    flinchPitchV: 0,
    flinchYaw: 0,
    flinchYawV: 0,
    flinchRoll: 0,
    flinchRollV: 0,
    /** Knee collapse from a leg hit; separate from flinch because it is a leg, not a torso. */
    buckle: 0,
    buckleV: 0,
    armJerkR: 0,
    armJerkL: 0,
    fireShove: 0,
    fireShoveV: 0,
    breath: Math.random() * TAU,
    stagger: 0,
    crouchV: 0,

    /* --- cover lean --- */
    lean: 0,
    leanTarget: 0,
    leanSide: 0,
    leanAxis: new THREE.Vector3(1, 0, 0),
    /** World offset from `position` the whole body (and its feet) leans out by. */
    bodyOffset: new THREE.Vector3(),
    bodyOffsetTarget: new THREE.Vector3(),

    /* --- idle life --- */
    idleTimer: 1.5,
    idleAction: 0,
    idleT: 0,
    idleDur: 1,
    weaponCheck: 0,
    shoulderRoll: 0,
    lookYawOff: 0,

    /* --- ragdoll --- */
    rdPos: new Float32Array(RD_COUNT * 3),
    rdPrev: new Float32Array(RD_COUNT * 3),
    rdRest: new Float32Array(RD_LINKS.length),
    rdActive: false,
    rdTime: 0,
    rdGround: 0,
    deathTime: 0,
    lastDamageDir: new THREE.Vector3(0, 0, 1),
    lastDamageFrame: -1,
    lastDamageAmount: -1,
    headshotKill: false,

    /* --- hit volumes, refreshed each frame --- */
    zoneA: [],
    zoneB: [],
    boundCentre: new THREE.Vector3(),
    boundRadius: 1.2,

    /* --- rendering --- */
    bones: null,
    kitTint: new THREE.Color(1, 1, 1),
    skinTint: new THREE.Color(1, 1, 1),
    helmetTint: new THREE.Color(1, 1, 1),
    coverTint: new THREE.Color(1, 1, 1),
    hasCover: false,
    muzzleWorld: new THREE.Vector3(),
    eyeWorld: new THREE.Vector3(),
    chestWorld: new THREE.Vector3(),
    animRate: 1,
    animAccum: 0,
  };
  for (let i = 0; i < HIT_ZONES.length; i++) {
    e.zoneA.push(new THREE.Vector3());
    e.zoneB.push(new THREE.Vector3());
  }
  e.bones = buildSkeleton();
  return e;
}

/* ========================================================================== */
/* Ragdoll                                                                    */
/* ========================================================================== */

const _rdCentre = new THREE.Vector3();
const _rdOmega = new THREE.Vector3();
const _rdArm = new THREE.Vector3();
const _rdSpin = new THREE.Vector3();

/**
 * Snapshot the live pose into verlet particles and kick it with the killing shot.
 *
 * The important part is the *angular* impulse. A linear-only capture makes every corpse drop
 * more or less straight down, translated a little, which is the single most obvious tell that
 * a death is procedural. A real hit almost never passes through the centre of mass, so it
 * applies a torque: τ = r × F, where r is the offset from the body's centre to the wound. Feed
 * that in as ω and give every particle v += ω × (p − centre) and the body turns as it falls —
 * a shot through the right shoulder spins him left and drops him on his face, a hit low on the
 * hip folds him sideways. `hitPoint` is the wound, so the same maths covers all of it.
 */
function ragdollCapture(e, impulseDir, impulseMag, groundY, hitPoint) {
  const b = e.bones;
  for (let i = 0; i < RD_COUNT; i++) {
    boneWorldPos(b[RD_BONE[i]], _v0);
    e.rdPos[i * 3] = _v0.x;
    e.rdPos[i * 3 + 1] = _v0.y;
    e.rdPos[i * 3 + 2] = _v0.z;
  }
  for (let i = 0; i < RD_LINKS.length; i++) {
    const a = RD_LINKS[i][0] * 3;
    const c = RD_LINKS[i][1] * 3;
    const dx = e.rdPos[a] - e.rdPos[c];
    const dy = e.rdPos[a + 1] - e.rdPos[c + 1];
    const dz = e.rdPos[a + 2] - e.rdPos[c + 2];
    e.rdRest[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Centre of mass, near enough: midway between hips and chest.
  _rdCentre.set(
    (e.rdPos[RD.hips * 3] + e.rdPos[RD.chest * 3]) * 0.5,
    (e.rdPos[RD.hips * 3 + 1] + e.rdPos[RD.chest * 3 + 1]) * 0.5,
    (e.rdPos[RD.hips * 3 + 2] + e.rdPos[RD.chest * 3 + 2]) * 0.5
  );

  // τ = r × F. Scaled down hard because a soldier is not a rigid rod and the constraint solver
  // adds its own rotation; 3.4 rad/s of seed spin is a body that turns as it goes down, 10 is
  // a cartwheel. Clamped for the same reason.
  _rdOmega.set(0, 0, 0);
  if (hitPoint) {
    _rdArm.copy(hitPoint).sub(_rdCentre);
    // Clamp the lever arm: a limb hit at 0.5 m would otherwise out-torque a torso hit.
    if (_rdArm.lengthSq() > 0.16) _rdArm.setLength(0.4);
    _rdOmega.crossVectors(_rdArm, impulseDir).multiplyScalar(impulseMag * 5.5);
    // A little yaw about vertical always: bodies twist as they collapse, they do not topple
    // like a plank. Signed off the same lever arm so it stays consistent with the hit.
    _rdOmega.y += (_rdArm.x * impulseDir.z - _rdArm.z * impulseDir.x) * impulseMag * 3.0;
    const om = _rdOmega.length();
    if (om > 3.4) _rdOmega.multiplyScalar(3.4 / om);
  }

  // Seed prev positions from the body's own motion plus the shot impulse, so a runner
  // tumbles forward and a standing target folds where it was hit.
  const dt = 1 / 60;
  const ix = impulseDir.x * impulseMag;
  const iy = impulseDir.y * impulseMag + 0.6;
  const iz = impulseDir.z * impulseMag;
  for (let i = 0; i < RD_COUNT; i++) {
    // Upper body takes more of the impulse than the feet — that asymmetry is the whole look.
    const w = i <= RD.wristL ? 1.0 : 0.35;
    const o = i * 3;
    _rdArm.set(e.rdPos[o] - _rdCentre.x, e.rdPos[o + 1] - _rdCentre.y, e.rdPos[o + 2] - _rdCentre.z);
    _rdSpin.crossVectors(_rdOmega, _rdArm);
    const vx = e.velocity.x + ix * w + _rdSpin.x;
    const vy = e.velocity.y + iy * w * 0.6 + _rdSpin.y;
    const vz = e.velocity.z + iz * w + _rdSpin.z;
    e.rdPrev[o] = e.rdPos[o] - vx * dt;
    e.rdPrev[o + 1] = e.rdPos[o + 1] - vy * dt;
    e.rdPrev[o + 2] = e.rdPos[o + 2] - vz * dt;
  }
  e.rdGround = groundY;
  e.rdActive = true;
  e.rdTime = 0;
}

const RD_GRAVITY = -22.0;
const RD_SUBSTEPS = 2;
const RD_ITER = 7;

function ragdollStep(e, dt) {
  const pos = e.rdPos;
  const prev = e.rdPrev;
  // Damping ramps up over the first 1.2 s so the body settles inside ~1.5 s rather than
  // twitching forever on the constraint solver's residual error.
  const settle = clamp(e.rdTime / 1.2, 0, 1);
  const drag = lerp(0.995, 0.86, settle * settle);
  const h = dt / RD_SUBSTEPS;
  const g = RD_GRAVITY * h * h;
  for (let s = 0; s < RD_SUBSTEPS; s++) {
    for (let i = 0; i < RD_COUNT; i++) {
      const o = i * 3;
      const px = pos[o];
      const py = pos[o + 1];
      const pz = pos[o + 2];
      pos[o] = px + (px - prev[o]) * drag;
      pos[o + 1] = py + (py - prev[o + 1]) * drag + g;
      pos[o + 2] = pz + (pz - prev[o + 2]) * drag;
      prev[o] = px;
      prev[o + 1] = py;
      prev[o + 2] = pz;
    }
    for (let it = 0; it < RD_ITER; it++) {
      for (let l = 0; l < RD_LINKS.length; l++) {
        const link = RD_LINKS[l];
        const a = link[0] * 3;
        const c = link[1] * 3;
        const rest = e.rdRest[l];
        const k = link[2];
        let dx = pos[c] - pos[a];
        let dy = pos[c + 1] - pos[a + 1];
        let dz = pos[c + 2] - pos[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-6) continue;
        // Soft limit links only push apart; they must never pull a straight limb inward.
        if (k < 0.25 && d >= rest) continue;
        const diff = ((d - rest) / d) * 0.5 * k;
        dx *= diff;
        dy *= diff;
        dz *= diff;
        pos[a] += dx;
        pos[a + 1] += dy;
        pos[a + 2] += dz;
        pos[c] -= dx;
        pos[c + 1] -= dy;
        pos[c + 2] -= dz;
      }
      // Ground plane only — full level collision on 15 points × 12 corpses is not worth it.
      for (let i = 0; i < RD_COUNT; i++) {
        const o = i * 3;
        const floor = e.rdGround + RD_RADIUS[i] * e.scale;
        if (pos[o + 1] < floor) {
          pos[o + 1] = floor;
          // Tangential friction: bleed lateral speed so limbs scrape rather than skate.
          prev[o] += (pos[o] - prev[o]) * 0.45;
          prev[o + 2] += (pos[o + 2] - prev[o + 2]) * 0.45;
          if (prev[o + 1] < pos[o + 1]) prev[o + 1] = pos[o + 1] - (pos[o + 1] - prev[o + 1]) * 0.25;
        }
      }
    }
  }
  e.rdTime += dt;
}

/** Rebuild bone transforms from ragdoll particles, top-down through the hierarchy. */
function ragdollPose(e) {
  const b = e.bones;
  const pos = e.rdPos;
  const P = (i, out) => out.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);

  P(RD.hips, _v0);
  b.root.position.copy(_v0);
  b.root.quaternion.identity();
  b.root.scale.setScalar(e.scale);
  refreshLocal(b.root);
  b.root.matrixWorld.copy(b.root.matrix);

  // Torso frame: up runs hips→chest, right runs shoulderL→shoulderR.
  P(RD.chest, _v1);
  P(RD.shoulderR, _v2);
  P(RD.shoulderL, _v3);
  _ay.copy(_v1).sub(_v0);
  if (_ay.lengthSq() < 1e-8) _ay.set(0, 1, 0);
  _ay.normalize();
  _ax.copy(_v2).sub(_v3);
  if (_ax.lengthSq() < 1e-8) _ax.set(1, 0, 0);
  _ax.addScaledVector(_ay, -_ax.dot(_ay)).normalize();
  _az.crossVectors(_ax, _ay).normalize();
  _m1.makeBasis(_ax, _ay, _az);
  _q1.setFromRotationMatrix(_m1);

  b.hips.position.set(0, 0, 0);
  setBoneWorldQuat(b.hips, _q1);
  refreshLocal(b.hips);
  b.hips.matrixWorld.multiplyMatrices(b.root.matrixWorld, b.hips.matrix);

  b.spine.quaternion.identity();
  refreshLocal(b.spine);
  b.spine.matrixWorld.multiplyMatrices(b.hips.matrixWorld, b.spine.matrix);
  b.chest.quaternion.identity();
  refreshLocal(b.chest);
  b.chest.matrixWorld.multiplyMatrices(b.spine.matrixWorld, b.chest.matrix);

  // Neck/head follow the head particle.
  P(RD.head, _v4);
  boneWorldPos(b.neck, _v5);
  _v6.copy(_v4).sub(_v5);
  if (_v6.lengthSq() > 1e-8) {
    _v6.normalize().multiplyScalar(-1);
    setBoneAim(b.neck, _v6, _az);
  } else b.neck.quaternion.identity();
  refreshLocal(b.neck);
  b.neck.matrixWorld.multiplyMatrices(b.chest.matrixWorld, b.neck.matrix);
  b.head.quaternion.identity();
  refreshLocal(b.head);
  b.head.matrixWorld.multiplyMatrices(b.neck.matrixWorld, b.head.matrix);

  // setBoneAim writes _az, so the bend-plane reference has to live somewhere it cannot reach.
  _rdPole.copy(_az);
  aimRagdollLimb(b.shoulderR, b.elbowR, b.wristR, RD.shoulderR, RD.elbowR, RD.wristR, pos, _rdPole);
  aimRagdollLimb(b.shoulderL, b.elbowL, b.wristL, RD.shoulderL, RD.elbowL, RD.wristL, pos, _rdPole);
  aimRagdollLimb(b.hipR, b.kneeR, b.ankleR, RD.hipR, RD.kneeR, RD.ankleR, pos, _rdPole);
  aimRagdollLimb(b.hipL, b.kneeL, b.ankleL, RD.hipL, RD.kneeL, RD.ankleL, pos, _rdPole);

  // The rifle drops out of the hands — keep it near the right wrist, canted over.
  boneWorldPos(b.wristR, _v0);
  setWorldTransform(b.rifle, _v0, _q1, e.scale);
  refreshLocal(b.rifle);
  b.rifle.matrixWorld.multiplyMatrices(b.chest.matrixWorld, b.rifle.matrix);
  // The sling is still attached to the corpse, so it has to follow the fallen weapon too.
  poseSling(e);
}

const _rdPole = new THREE.Vector3();
const _rdA = new THREE.Vector3();
const _rdB = new THREE.Vector3();
const _rdC = new THREE.Vector3();
const _rdD = new THREE.Vector3();

function aimRagdollLimb(rootBone, midBone, tipBone, ia, ib, ic, pos, pole) {
  _rdA.set(pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]);
  _rdB.set(pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]);
  _rdC.set(pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]);
  _rdD.copy(_rdB).sub(_rdA);
  if (_rdD.lengthSq() > 1e-8) {
    _rdD.normalize();
    setBoneAim(rootBone, _rdD, pole);
  }
  refreshLocal(rootBone);
  rootBone.matrixWorld.multiplyMatrices(rootBone.parent.matrixWorld, rootBone.matrix);
  _rdD.copy(_rdC).sub(_rdB);
  if (_rdD.lengthSq() > 1e-8) {
    _rdD.normalize();
    setBoneAim(midBone, _rdD, pole);
  }
  refreshLocal(midBone);
  midBone.matrixWorld.multiplyMatrices(rootBone.matrixWorld, midBone.matrix);
  refreshLocal(tipBone);
  tipBone.matrixWorld.multiplyMatrices(midBone.matrixWorld, tipBone.matrix);
}

/* ========================================================================== */
/* Procedural animation                                                       */
/* ========================================================================== */

/* Animation-local scratch. Kept separate from the IK scratch so a nested solve can never
   clobber a value the caller still needs. */
const _a0 = new THREE.Vector3();
const _a1 = new THREE.Vector3();
const _a2 = new THREE.Vector3();
const _a3 = new THREE.Vector3();
const _a4 = new THREE.Vector3();
const _a5 = new THREE.Vector3();
const _a6 = new THREE.Vector3();
const _a7 = new THREE.Vector3();
const _a8 = new THREE.Vector3();
const _aq = new THREE.Quaternion();
const _aq2 = new THREE.Quaternion();
const _ae = new THREE.Euler();

const GAIT = {
  /** Floor for the duty factor. The live value is per-enemy, see FOOT_EXCURSION. */
  swingFrac: 0.42,
  /** Ceiling. Past this both feet are airborne for a quarter of the cycle — a real run. */
  swingFracMax: 0.62,
  /**
   * Cadence ceiling, cycles per second. Raised from 2.6 as a consequence of FOOT_EXCURSION:
   * with the stride the legs can actually cover capped, the only way to keep moving at 6 m/s
   * is to turn the legs over faster, which is also what a sprinting man does.
   */
  cadenceMax: 3.4,
  liftHeight: 0.14,
  bobAmp: 0.045,
  rollAmp: 0.062,
  yawAmp: 0.1,
  minStride: 0.52,
  strideGain: 0.24,
  standWidth: 0.112,
  /** Squared world drift that forces a corrective step when standing — about 0.23 m. */
  stepDrift: 0.053,
  /** Body-vs-foot yaw that forces one, radians. ~24°: past that the boot is visibly twisted. */
  stepYaw: 0.42,
  /** Impulse into the heel-strike spring. Sized for a ~2 cm pelvis dip, see updateGait. */
  strikeGain: 0.62,
  /** Fraction of stance spent flat before the heel starts to lift. */
  toeOffAt: 0.62,
};

/**
 * How far a planted foot may travel from under its hip, along the ground, over one stance.
 *
 * This is derived, not chosen, and it is the number the whole gait geometry hangs off. The hip
 * joint sits 0.92 m up and the ankle 0.085 m up, so the leg spans 0.835 of its 0.850 length
 * standing. Pythagoras: a foot 0.35 m from under the hip needs the hip only 0.775 m above it,
 * which the pelvis bob supplies; a foot 0.45 m away needs 0.72, which it does not. So the
 * usable excursion is about ±0.345, and the body may travel 0.69 m while a foot is planted.
 *
 * The gait was violating this by a factor of well over two at a sprint: a 1.55 m stride at a
 * 0.58 duty factor asks the stance foot to end up 0.9 m behind the hip. The IK cannot get
 * there, so it straightened the leg and left the boot hanging — measured in a soak at 0.60 m
 * of float and 2.7 m of unreachable foot target. Deriving the duty factor from this instead of
 * fixing it at 0.42 is what makes the stride something the legs can actually walk.
 *
 * 0.62 rather than the 0.69 the geometry allows: swept over a 200-second soak, it minimises
 * the share of stance frames where the sole is not within 2 cm of the ground (6.3 %, against
 * 13.4 % before this pass) without shortening the stride enough to read as a shuffle.
 */
const FOOT_EXCURSION = 0.62;

/**
 * Ankle pitch across the whole cycle: heel strike, roll to flat, weight over it, heel lift and
 * toe-off, then clearance and a reach for the next strike.
 *
 * This curve is the difference between a walk and a shuffle. A foot that stays flat through
 * stance and pitches only in the air has no heel-to-toe roll, and without the roll the body
 * appears to be carried past a stationary foot rather than pushed by it.
 *
 * SIGN: positive is toe-down. setBoneAim puts the boot's local +Z on the foot's heading and
 * local +Y on world up, and the boot geometry has its toe at +Z, so a positive local pitch
 * about X drops the toe. This was worth measuring rather than reasoning about — the previous
 * curve had it backwards, and the soldiers were landing toe-first and pushing off their heels,
 * which is a walk played in reverse.
 */
function anklePitch(phase, sf) {
  if (phase >= sf) {
    const u = (phase - sf) / (1 - sf);
    if (u < 0.18) return lerp(-0.21, 0.0, smoothstep(u / 0.18)); // heel down → foot flat
    if (u < GAIT.toeOffAt) return 0.0; // flat, weight rolling over it
    return lerp(0.0, 0.44, smoothstep((u - GAIT.toeOffAt) / (1 - GAIT.toeOffAt))); // toe-off
  }
  const v = phase / sf;
  if (v < 0.45) return lerp(0.44, -0.15, smootherstep(v / 0.45)); // recover, toes up to clear
  return lerp(-0.15, -0.21, smoothstep((v - 0.45) / 0.55)); // reach out for the heel strike
}

/**
 * How much of the gait's foot-roll is currently active, 0..1, as a smooth function of cadence.
 *
 * This exists because a boolean here is a visible defect. The toe-off displaces the stance
 * ankle by up to 7 cm, and the moment the walk-vs-stand test flipped, that displacement
 * vanished in one frame — a 7 cm jump of a foot that is supposed to be nailed to the ground,
 * measured at 0.051 m/frame in a 90-second soak. Fading it out as cadence decays means the
 * offset is already at zero by the time the branch changes, so the plant stays a plant.
 */
function gaitAmount(cycleRate) {
  return smoothstep(clamp((cycleRate - 0.06) / 0.35, 0, 1));
}

/**
 * The ankle pitch applied this frame, in one place.
 *
 * Both updateGait and poseEnemy need it — the pose to rotate the boot, the gait to move the
 * ankle so the boot rotates *about its contact patch* rather than about the ankle. If those two
 * ever disagree the foot swims, so neither computes it privately.
 */
function ankleRoll(e, leg) {
  const amt = gaitAmount(e.cycleRate);
  if (amt <= 0) return 0;
  const phase = (e.cycle + (leg === 0 ? 0 : 0.5)) % 1;
  return anklePitch(phase, e.swingFrac) * clamp(0.4 + e.speed * 0.2, 0.4, 1.1) * amt;
}

/**
 * Boot contact extremes, ankle-local, taken straight off the tread lugs in buildBoot: the
 * leading lug sits at z +0.175 and the trailing one at z −0.075. They have to be the real
 * numbers, not approximations, because pivotAnkle uses them to keep the sole on the ground.
 */
const BOOT_BALL = 0.175;
const BOOT_HEEL = 0.075;

/**
 * Offset the ankle IK target so the boot pivots about whichever end is actually on the ground —
 * the ball at toe-off, the heel at contact — instead of about the ankle joint.
 *
 * This is not a nicety. Pitching a 0.30 m boot 0.44 rad about its ankle drives the toe about
 * 3 cm through the floor, and a foot that visibly sinks and drags at every push-off is the
 * same defect as sliding, just harder to name. Rotating a point (f, u) about the contact by θ
 * gives the ankle's true displacement, and it is two trig calls.
 *
 * It writes to the IK target, deliberately, and not to `footPos`. footPos is the foot's ground
 * contact and is what the next toe-off captures as the swing's start point; folding a
 * rendering correction into it made the correction get captured and then re-applied, jumping
 * the foot 6 cm on the toe-off frame.
 */
function pivotAnkle(out, pitch, forward, scale) {
  if (pitch === 0) return;
  const a = Math.abs(pitch);
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Toe-down (positive) rolls onto the ball and carries the ankle forward; toe-up rolls back
  // onto the heel and carries it back.
  const lever = pitch > 0 ? BOOT_BALL : BOOT_HEEL;
  const dir = pitch > 0 ? 1 : -1;
  out.y += (lever * s + RIG.ankleY * (c - 1)) * scale;
  out.addScaledVector(forward, dir * (lever * (1 - c) + RIG.ankleY * s) * scale);
}

/**
 * Advance the gait clock and pick world-space foot targets.
 *
 * Feet are locked in WORLD space during stance — that is the difference between a walk cycle
 * and a skating character. A plant point is chosen once, at the moment the foot leaves the
 * ground, from the body's predicted position half a stride later.
 *
 * Three things were missing and are added here, all of them "weight":
 *
 *  - **Foot yaw is planted too.** Position was world-locked but orientation was not: the boot
 *    took its heading from `e.facing` every frame, so a soldier turning on the spot twisted his
 *    planted boots like a screw. Yaw is now captured at plant and interpolated only during
 *    swing, which is what makes the turn-in-place read as steps.
 *  - **Heel strike.** A footfall now kicks a stiff spring that drops the pelvis about two
 *    centimetres and settles, so each step lands instead of gliding.
 *  - **Weight transfer.** A signed load value tracks which foot is carrying, and shifts the
 *    pelvis laterally over it and drops the opposite hip. Walking without it is a torso being
 *    conveyed between two moving feet.
 */
function updateGait(e, dt, level) {
  const speed = e.speed;
  const moving = speed > 0.22;
  // Stride length grows with speed, but sub-linearly: a sprint lengthens the stride AND
  // raises cadence, which is what makes fast movement read as urgent rather than fast-forward.
  const stride = clamp(GAIT.minStride + speed * GAIT.strideGain, GAIT.minStride, 1.55);
  e.strideLen = damp(e.strideLen, stride, 8, dt);
  const cadence = moving ? clamp(speed / Math.max(0.3, e.strideLen), 0.35, GAIT.cadenceMax) : 0;
  e.cycleRate = damp(e.cycleRate, cadence, 9, dt);
  if (moving || e.cycleRate > 0.06) {
    e.cycle += e.cycleRate * dt;
    if (e.cycle >= 1) e.cycle -= Math.floor(e.cycle);
  }
  if (e.stepCooldown > 0) e.stepCooldown -= dt;

  // Duty factor from geometry. The distance the body covers per cycle is speed / cadence, and
  // a foot may only stay down for FOOT_EXCURSION of that, so the rest of the cycle has to be
  // swing. Taken from the *target* cadence rather than the damped one so a hard acceleration
  // does not briefly report an absurd stride while cycleRate is still catching up.
  const effStride = speed > 0.05 ? speed / Math.max(0.35, cadence) : e.strideLen;
  e.swingFrac = clamp(
    1 - FOOT_EXCURSION / Math.max(0.35, effStride),
    GAIT.swingFrac,
    GAIT.swingFracMax
  );
  const excursion = effStride * (1 - e.swingFrac);
  // Slight forward bias: the pelvis is lower at heel strike than at toe-off, so the leg can
  // reach a little further ahead than behind.
  const lead = excursion * 0.52;
  // Bounded to a plausible swing duration. cycleRate is damped and lags speed, so during a
  // hard acceleration the raw ratio briefly claims a 1.8-second swing, and multiplying that by
  // a 6 m/s velocity throws the anticipated plant ten metres down the map. The in-flight
  // re-aim recovers from it, but there is no reason to create it.
  const swingTime = clamp(e.swingFrac / Math.max(0.35, e.cycleRate), 0.12, 0.45);

  const cosF = Math.cos(e.facing);
  const sinF = Math.sin(e.facing);
  // Body axes: forward is -Z in local space, so world forward is (-sin, 0, -cos).
  _a0.set(-sinF, 0, -cosF); // forward
  _a1.set(cosF, 0, -sinF); // right

  // The stance is measured from the leaned body position, not the nav position, so a soldier
  // leaning out of cover steps his outboard foot across rather than sliding off his boots.
  _a4.set(e.position.x + e.bodyOffset.x, e.groundY, e.position.z + e.bodyOffset.z);

  const stanceWidth = GAIT.standWidth * (1 + e.crouch * 0.3);
  const cycling = e.cycleRate > 0.06;
  // Guard on how far a stance foot may end up from the body. See FOOT_EXCURSION.
  const maxTrail = FOOT_EXCURSION * 0.62 * e.scale;

  for (let leg = 0; leg < 2; leg++) {
    const side = leg === 0 ? 1 : -1; // 0 = right
    const phase = (e.cycle + (leg === 0 ? 0 : 0.5)) % 1;
    // Rest position under the hip, in world space.
    _a2.copy(_a4)
      .addScaledVector(_a1, side * stanceWidth)
      .addScaledVector(_a0, moving ? 0 : side * 0.018);
    _a2.y = e.groundY;

    if (!moving && !cycling) {
      // --- standing: turn and shuffle in place, one foot at a time ---
      const drift = e.footPlant[leg].distanceToSquared(_a2);
      const yawOff = Math.abs(angleDelta(e.footYaw[leg], e.facing));
      const wantStep = drift > GAIT.stepDrift || yawOff > GAIT.stepYaw;
      // Only step if the other foot is down and the last step has had time to land: a pivot is
      // two separate steps, and both feet leaving the ground together is a hop.
      if (e.footPlanted[leg] && wantStep && e.stepCooldown <= 0 && e.footPlanted[1 - leg]) {
        e.footPrev[leg].copy(e.footPos[leg]);
        e.footYawPrev[leg] = e.footYaw[leg];
        e.footPlant[leg].copy(_a2);
        groundSnap(level, e.footPlant[leg]);
        e.footPlanted[leg] = false;
        e.footLift[leg] = 0;
        e.stepCooldown = 0.34;
      }
      if (!e.footPlanted[leg]) {
        e.footLift[leg] = Math.min(1, e.footLift[leg] + dt * 4.6);
        const t = e.footLift[leg];
        const s = smootherstep(t);
        e.footPos[leg].lerpVectors(e.footPrev[leg], e.footPlant[leg], s);
        e.footPos[leg].y += Math.sin(t * Math.PI) * 0.055;
        e.footYaw[leg] = e.footYawPrev[leg] + angleDelta(e.footYawPrev[leg], e.facing) * s;
        if (t >= 1) {
          e.footPlanted[leg] = true;
          e.footYaw[leg] = e.facing;
          e.strikeV -= GAIT.strikeGain * 0.42; // a shuffle still lands with some weight
          e.stepCooldown = Math.max(e.stepCooldown, 0.14);
        }
      } else {
        e.footPos[leg].copy(e.footPlant[leg]);
      }
      e.wasSwing[leg] = false;
      continue;
    }

    const swing = phase < e.swingFrac;
    if (swing) {
      if (!e.wasSwing[leg]) {
        // Toe-off: choose where this foot is going to land, and release its planted yaw.
        // The plant is placed relative to where the body will BE when the foot arrives, not
        // where it is now. Ignoring the swing displacement is what made a sprinting soldier
        // land his foot almost underneath himself and then trail it for the whole of stance.
        e.footPrev[leg].copy(e.footPos[leg]);
        e.footYawPrev[leg] = e.footYaw[leg];
        _a3.copy(_a4)
          .addScaledVector(e.velocity, swingTime)
          .addScaledVector(_a1, side * stanceWidth)
          .addScaledVector(_a0, lead);
        _a3.y = e.groundY;
        groundSnap(level, _a3);
        e.footPlant[leg].copy(_a3);
        e.footPlanted[leg] = false;
      }
      const t = clamp(phase / e.swingFrac, 0, 1);
      const prevT = e.footLift[leg];
      // Re-aim the plant while the foot is still in the air. Committing at toe-off assumes the
      // soldier will keep going the way he was for the whole swing, and an AI under fire does
      // not: he turns, he sprints, he stops. A stale plant lands the boot up to 1.5 m from
      // where the body ended up, and everything downstream then has to drag it. The
      // anticipation uses the REMAINING swing time, so the correction shrinks to nothing by
      // itself, and the last fifth of the swing is committed so the touchdown cannot jitter.
      if (t < 0.82) {
        _a3.copy(_a4)
          .addScaledVector(e.velocity, swingTime * (1 - t))
          .addScaledVector(_a1, side * stanceWidth)
          .addScaledVector(_a0, lead);
        const k = 1 - Math.exp(-10 * dt);
        e.footPlant[leg].x += (_a3.x - e.footPlant[leg].x) * k;
        e.footPlant[leg].z += (_a3.z - e.footPlant[leg].z) * k;
      } else if (prevT < 0.82) {
        // One ground probe at the commit point, so the height matches wherever it drifted to.
        groundSnap(level, e.footPlant[leg]);
      }
      // Ease out of the plant, ease into the next one; the foot travels fastest mid-swing.
      const s = smootherstep(t);
      e.footLift[leg] = t; // so a stop mid-swing continues the same arc rather than snapping
      e.footPos[leg].lerpVectors(e.footPrev[leg], e.footPlant[leg], s);
      const lift = GAIT.liftHeight * (0.5 + speed * 0.09) * Math.sin(t * Math.PI);
      e.footPos[leg].y += lift * (1 - e.crouch * 0.3);
      e.footYaw[leg] = e.footYawPrev[leg] + angleDelta(e.footYawPrev[leg], e.facing) * s;
    } else {
      if (e.wasSwing[leg]) {
        // --- heel strike ---
        e.footPlanted[leg] = true;
        e.footYaw[leg] = e.facing;
        e.strikeV -= GAIT.strikeGain * clamp(0.3 + speed * 0.19, 0.3, 1.0);
      }
      // Acceleration guard. A soldier who accelerates hard outruns the plant chosen at
      // toe-off, and the geometry above only holds for a steady speed. Rather than let the
      // knee lock and the boot hang, ease the plant forward — a scuff of a centimetre or two
      // spread over several frames, which is both what happens to a real boot and far less
      // visible than a straight, dragging leg.
      _a5.copy(e.footPlant[leg]).sub(_a4);
      _a5.y = 0;
      const trail = _a5.length();
      if (trail > maxTrail) {
        // Rate-limited to 0.7 m/s — about a tenth of the body's speed when this fires at all,
        // so it reads as a boot scuffing rather than a foot skating. It only ever fires on a
        // transient the in-flight re-aim did not already absorb.
        const need = trail - maxTrail;
        const move = Math.min(need * (1 - Math.exp(-9 * dt)), 0.7 * dt);
        e.footPlant[leg].addScaledVector(_a5, -move / trail);
      }
      e.footPos[leg].copy(e.footPlant[leg]);
    }
    e.wasSwing[leg] = swing;
  }

  /* --- pelvis ------------------------------------------------------------ */
  const c2 = e.cycle * TAU;
  const spd = clamp(speed / 3.2, 0.25, 1.5);

  // Heel-strike impact. A stiff spring (ω ≈ 14.8 rad/s) at ζ = 0.62: an impulse of 0.62 peaks
  // at roughly 0.022 m of drop and is gone inside a third of a second, which is a footfall
  // landing rather than a bounce. Clamped so a burst of strikes cannot stack into a squat.
  const sk = 220;
  const sd = 2 * Math.sqrt(sk) * 0.62;
  e.strikeV += (-sk * e.strike - sd * e.strikeV) * dt;
  e.strike += e.strikeV * dt;
  if (e.strike < -0.048) {
    e.strike = -0.048;
    if (e.strikeV < 0) e.strikeV = 0;
  } else if (e.strike > 0.016) {
    e.strike = 0.016;
    if (e.strikeV > 0) e.strikeV = 0;
  }

  // Weight transfer. −cos puts the load on the left at cycle 0, which is when the right leg is
  // starting its swing. Standing, it settles onto whichever hip the idle layer has chosen.
  e.weightBias = damp(e.weightBias, cycling ? 0 : e.weightBiasTarget, 1.3, dt);
  const wTarget = cycling ? -Math.cos(c2) : e.weightBias;
  e.weight = damp(e.weight, wTarget, cycling ? 12 : 3.2, dt);
  e.pelvisShift = damp(e.pelvisShift, e.weight * (cycling ? 0.026 : 0.036), 10, dt);

  const amp = GAIT.bobAmp * spd;
  e.hipBob = damp(e.hipBob, -amp * (0.5 - 0.5 * Math.cos(c2 * 2)), 18, dt);
  // Positive roll lifts the right side, so the swing-side hip drops — a real Trendelenburg
  // pattern, and it is phase-locked to the weight rather than to an independent sine.
  e.hipRoll = damp(e.hipRoll, e.weight * GAIT.rollAmp * (cycling ? spd : 0.55), 12, dt);
  e.hipYaw = damp(e.hipYaw, GAIT.yawAmp * Math.sin(c2) * clamp(speed / 3.6, 0, 1.2), 12, dt);

  // Arm swing: damped rather than symmetric. The second harmonic makes the forward throw
  // quicker than the return, and the damp makes the arm trail the shoulder driving it — two
  // small asymmetries that together stop the swing reading as a metronome.
  const swingTarget = cycling
    ? (Math.sin(c2) * 0.9 - 0.26 * Math.sin(c2 * 2)) * clamp(speed / 3.2, 0.25, 1.35)
    : 0;
  e.armSwing = damp(e.armSwing, swingTarget, 15, dt);
}

/**
 * Idle life.
 *
 * A stationary soldier who is perfectly still is a prop, and the usual fix — more noise on more
 * bones — just makes a twitchy prop. What reads as a person is discrete, legible actions with
 * dead air between them, so this is a tiny scheduler: pick one of four things, play it over a
 * couple of seconds on a sine envelope, then wait two to six seconds and pick another.
 *
 *   1  shift weight onto the other hip (drives the pelvis laterally via updateGait)
 *   2  scan: hold a look somewhere off the patrol heading
 *   3  check the weapon: roll it inboard, support hand to the magazine well
 *   4  roll the shoulders under the plate carrier
 */
function updateIdleLife(e, dt) {
  const settled = e.speed < 0.32 && e.alert < 2;
  if (!settled) {
    if (e.idleAction !== 0) {
      e.idleAction = 0;
      e.idleT = 0;
      e.lookYawOff = 0;
    }
    e.idleTimer = 1.0 + e.rng() * 1.8;
    e.weightBiasTarget = 0;
    e.weaponCheck = damp(e.weaponCheck, 0, 6, dt);
    e.shoulderRoll = damp(e.shoulderRoll, 0, 6, dt);
    return;
  }
  if (e.idleAction === 0) {
    e.idleTimer -= dt;
    if (e.idleTimer <= 0) {
      const r = e.rng();
      e.idleAction = r < 0.34 ? 1 : r < 0.62 ? 2 : r < 0.84 ? 3 : 4;
      e.idleT = 0;
      e.idleDur = e.idleAction === 3 ? 2.0 : e.idleAction === 2 ? 2.6 : 1.4;
      // Shifting weight always goes to the *other* hip: standing on one leg and then choosing
      // it again is the one thing a tired man never does.
      if (e.idleAction === 1) e.weightBiasTarget = e.weightBias > 0 ? -1 : 1;
      if (e.idleAction === 2) e.lookYawOff = (e.rng() * 2 - 1) * 1.1;
    }
  } else {
    e.idleT += dt / e.idleDur;
    if (e.idleT >= 1) {
      e.idleAction = 0;
      e.idleT = 0;
      e.lookYawOff = 0;
      e.idleTimer = 2.2 + e.rng() * 3.6;
    }
  }
  // One shared envelope, so nothing ever starts or stops on a step.
  const env = e.idleAction === 0 ? 0 : Math.sin(clamp(e.idleT, 0, 1) * Math.PI);
  e.weaponCheck = damp(e.weaponCheck, e.idleAction === 3 ? env : 0, 7, dt);
  e.shoulderRoll = damp(e.shoulderRoll, e.idleAction === 4 ? env : 0, 7, dt);
}

/** Drop a point onto the ground with a short downward probe. */
function groundSnap(level, point) {
  if (!level || typeof level.raycast !== 'function') return;
  _a8.set(0, -1, 0);
  _a7.set(point.x, point.y + 1.1, point.z);
  const hit = level.raycast(_a7, _a8, 2.4);
  if (hit && hit.point) point.y = hit.point.y + 0.002;
}

/**
 * Pose one soldier for this frame: root, spine chain, weapon, arms, legs, additive layers.
 * Every write here goes through preallocated scratch — no allocation, no exceptions.
 */
function poseEnemy(e, dt, level, aimBlend) {
  const b = e.bones;

  /* --- root ------------------------------------------------------------- */
  // bodyOffset is the cover lean: the whole figure translates out past the cover edge, and
  // updateGait steps the feet across to follow it, so leaning is not a slide.
  b.root.position.set(e.position.x + e.bodyOffset.x, e.groundY, e.position.z + e.bodyOffset.z);
  _ae.set(0, e.facing, 0);
  b.root.quaternion.setFromEuler(_ae);
  b.root.scale.setScalar(e.scale);
  refreshLocal(b.root);
  b.root.matrixWorld.copy(b.root.matrix);

  /* --- additive layers -------------------------------------------------- */
  // Flinch: three critically damped springs, so a hit snaps then returns without wobbling.
  // Pitch/yaw/roll are separate because a hit's direction and its height on the body pick
  // different mixes of them — see damageEnemy.
  const flinchK = 130;
  const flinchD = 2 * Math.sqrt(flinchK) * 0.42;
  e.flinchPitchV += (-flinchK * e.flinchPitch - flinchD * e.flinchPitchV) * dt;
  e.flinchPitch += e.flinchPitchV * dt;
  e.flinchYawV += (-flinchK * e.flinchYaw - flinchD * e.flinchYawV) * dt;
  e.flinchYaw += e.flinchYawV * dt;
  e.flinchRollV += (-flinchK * e.flinchRoll - flinchD * e.flinchRollV) * dt;
  e.flinchRoll += e.flinchRollV * dt;
  // Leg buckle from a low hit: softer and slower than the torso flinch, because a knee gives
  // way and recovers rather than snapping back.
  const buckleK = 46;
  const buckleD = 2 * Math.sqrt(buckleK) * 0.55;
  e.buckleV += (-buckleK * e.buckle - buckleD * e.buckleV) * dt;
  e.buckle += e.buckleV * dt;
  if (e.buckle < 0) {
    e.buckle *= Math.exp(-8 * dt); // it only ever collapses, it never springs the other way
  }
  e.armJerkR = damp(e.armJerkR, 0, 7, dt);
  e.armJerkL = damp(e.armJerkL, 0, 7, dt);
  const shoveK = 190;
  const shoveD = 2 * Math.sqrt(shoveK) * 0.55;
  e.fireShoveV += (-shoveK * e.fireShove - shoveD * e.fireShoveV) * dt;
  e.fireShove += e.fireShoveV * dt;
  e.breath += dt * (1.05 + e.speed * 0.28);
  const breathe = Math.sin(e.breath) * 0.011 * (1 - aimBlend * 0.45);
  e.stagger = Math.max(0, e.stagger - dt * 2.4);
  const leanRoll = e.lean * e.leanSide;

  /* --- hips ------------------------------------------------------------- */
  // Local units: the root carries e.scale, so world-space amplitudes divide it out and
  // pose-authored ones (crouch, buckle) do not.
  const crouchDrop = e.crouch * 0.3 + e.buckle * 0.16;
  b.hips.position.set(
    e.pelvisShift / e.scale,
    RIG.hipsY + (e.hipBob + e.strike) / e.scale - crouchDrop,
    e.crouch * 0.05
  );
  _ae.set(
    0.045 + e.crouch * 0.2 + e.buckle * 0.1 + e.flinchPitch * 0.35 + e.stagger * 0.12,
    e.hipYaw,
    e.hipRoll + e.flinchRoll * 0.3 - leanRoll * 0.1
  );
  b.hips.quaternion.setFromEuler(_ae);

  /* --- spine + chest: contra-body rotation ------------------------------ */
  // Shoulders counter-rotate against the hips. Without this a walk reads as a mannequin
  // on rails; with it, the torso has torque.
  const aimYaw = Math.atan2(-e.aimDir.x, -e.aimDir.z);
  let twist = angleDelta(e.facing, aimYaw);
  twist = clamp(twist, -0.72, 0.72) * aimBlend;
  const counter = -e.hipYaw * 0.62;
  _ae.set(
    breathe * 0.6 - e.crouch * 0.06 + e.buckle * 0.06,
    counter * 0.4 + twist * 0.35,
    -e.hipRoll * 0.25 + e.flinchRoll * 0.35 - leanRoll * 0.14 + e.shoulderRoll * 0.05
  );
  b.spine.quaternion.setFromEuler(_ae);
  const aimPitch = Math.asin(clamp(e.aimDir.y, -1, 1));
  _ae.set(
    -aimPitch * 0.28 * aimBlend +
      breathe +
      e.flinchPitch +
      e.crouch * 0.1 +
      e.buckle * 0.14 +
      e.fireShove * 0.5 +
      e.weaponCheck * 0.09,
    counter * 0.6 + twist * 0.65 - e.shoulderRoll * 0.1,
    e.flinchYaw * 0.5 - e.hipRoll * 0.3 + e.flinchRoll * 0.55 - leanRoll * 0.24 + e.shoulderRoll * 0.13
  );
  b.chest.quaternion.setFromEuler(_ae);

  refreshLocal(b.hips);
  b.hips.matrixWorld.multiplyMatrices(b.root.matrixWorld, b.hips.matrix);
  refreshLocal(b.spine);
  b.spine.matrixWorld.multiplyMatrices(b.hips.matrixWorld, b.spine.matrix);
  refreshLocal(b.chest);
  b.chest.matrixWorld.multiplyMatrices(b.spine.matrixWorld, b.chest.matrix);

  /* --- head look-at, leading the chest ---------------------------------- */
  boneWorldPos(b.neck, _a0);
  _a1.copy(e.lookTarget).sub(_a0);
  if (_a1.lengthSq() < 1e-6) _a1.set(-Math.sin(e.facing), 0, -Math.cos(e.facing));
  _a1.normalize();
  const lookYaw = Math.atan2(-_a1.x, -_a1.z);
  const lookPitch = Math.asin(clamp(_a1.y, -1, 1));
  // Head leads: it reaches the target before the torso finishes twisting.
  const headYaw = clamp(angleDelta(e.facing + counter * 0.6 + twist * 0.65, lookYaw), -1.15, 1.15);
  const headPitch = clamp(-lookPitch - e.flinchPitch * 0.5, -0.62, 0.55);
  _ae.set(0, headYaw * 0.42, 0);
  b.neck.quaternion.setFromEuler(_ae);
  _ae.set(headPitch + breathe * 0.5, headYaw * 0.58, e.flinchYaw * 0.6 + e.hipRoll * 0.2);
  b.head.quaternion.setFromEuler(_ae);
  refreshLocal(b.neck);
  b.neck.matrixWorld.multiplyMatrices(b.chest.matrixWorld, b.neck.matrix);
  refreshLocal(b.head);
  b.head.matrixWorld.multiplyMatrices(b.neck.matrixWorld, b.head.matrix);

  /* --- weapon ----------------------------------------------------------- */
  poseWeapon(e, aimBlend);
  poseSling(e);

  /* --- arms: two-bone IK onto the rifle grips ---------------------------- */
  _a2.copy(RIFLE.gripR).applyMatrix4(b.rifle.matrixWorld); // right hand target
  _a3.copy(RIFLE.gripL).applyMatrix4(b.rifle.matrixWorld); // left hand target

  // Elbow poles: down and out, rotated with the body so elbows never invert behind the back.
  const cosF = Math.cos(e.facing);
  const sinF = Math.sin(e.facing);
  _a4.set(cosF, 0, -sinF); // world right
  _a5.copy(_a4).multiplyScalar(0.75).addScaledVector(UP, -1.0).normalize(); // right elbow pole
  _a6.copy(_a4).multiplyScalar(-0.35).addScaledVector(UP, -1.0).normalize(); // left elbow pole

  // Idle weapon check: the support hand leaves the handguard for the magazine well, tugs it,
  // and comes back. A stationary soldier who never touches his rifle reads as a statue.
  if (e.weaponCheck > 0.002) {
    _a0.copy(RIFLE.magWell).applyMatrix4(b.rifle.matrixWorld);
    _a3.lerp(_a0, e.weaponCheck);
  }

  // Off the ready, the left arm swings with the gait instead of gripping the handguard.
  const swingBlend = (1 - clamp(e.readyWeight * 2.2, 0, 1)) * (1 - e.weaponCheck);
  if (swingBlend > 0.001) {
    boneWorldPos(b.shoulderL, _a7);
    _a8.set(-sinF, 0, -cosF);
    _a0.copy(_a7)
      .addScaledVector(UP, -ARM_REACH * 0.86)
      .addScaledVector(_a8, e.armSwing * 0.22)
      // A swinging arm crosses inboard as it comes forward and opens out as it goes back;
      // that lateral component is most of what separates a swing from a pendulum.
      .addScaledVector(_a4, -0.06 - Math.max(0, e.armSwing) * 0.05);
    _a3.lerp(_a0, swingBlend);
  }

  // Limb jerk from a hit landing on that arm — small, brief, and on the correct side.
  if (e.armJerkR !== 0) _a2.addScaledVector(_a4, e.armJerkR * 0.09).addScaledVector(UP, -Math.abs(e.armJerkR) * 0.05);
  if (e.armJerkL !== 0) _a3.addScaledVector(_a4, e.armJerkL * 0.09).addScaledVector(UP, -Math.abs(e.armJerkL) * 0.05);

  ikChain(b.shoulderR, b.elbowR, b.wristR, _a2, _a5, RIG.upperArm * e.scale, RIG.foreArm * e.scale);
  ikChain(b.shoulderL, b.elbowL, b.wristL, _a3, _a6, RIG.upperArm * e.scale, RIG.foreArm * e.scale);

  /* --- legs: two-bone IK onto the planted feet -------------------------- */
  _a4.set(-sinF, 0, -cosF); // knees bend forward
  for (let leg = 0; leg < 2; leg++) {
    const hip = leg === 0 ? b.hipR : b.hipL;
    const knee = leg === 0 ? b.kneeR : b.kneeL;
    const ankle = leg === 0 ? b.ankleR : b.ankleL;
    // The boot's heading comes from the yaw the foot was PLANTED at, never from the live body
    // facing — that is what stops a turning soldier twisting his own boots into the ground.
    const fy = e.footYaw[leg] + e.footToeOut[leg];
    _a1.set(-Math.sin(fy), 0, -Math.cos(fy));
    // Every source of ankle pitch, summed once so the pivot compensation below covers all of
    // it. The heel-strike-to-toe-off roll; the crouch, which flexes the ankle; and crouch
    // *velocity*, which is what gives a stand-up its direction — sinking dorsiflexes as the
    // heel takes the load, rising plantarflexes as he pushes off the balls of his feet. A
    // crouch pose without the velocity term is symmetrical and reads as a lift, not a
    // movement.
    const pitch = ankleRoll(e, leg) + e.crouch * 0.12 + clamp(e.crouchV, -3, 3) * 0.014;
    _a0.copy(e.footPos[leg]);
    _a0.y += RIG.ankleY * e.scale;
    // Displace the target so the sole rolls over its contact patch rather than swinging
    // through the floor.
    pivotAnkle(_a0, pitch, _a1, e.scale);
    ikChain(hip, knee, ankle, _a0, _a4, RIG.thigh * e.scale, RIG.shin * e.scale);
    // Level the sole to world horizontal first (so the boot stays flat however the shin is
    // angled), then add the pitch on top as a local rotation.
    _a2.set(0, -1, 0);
    setBoneAim(ankle, _a2, _a1);
    _ae.set(pitch, 0, 0);
    _aq.setFromEuler(_ae);
    ankle.quaternion.multiply(_aq);
    refreshLocal(ankle);
    ankle.matrixWorld.multiplyMatrices(knee.matrixWorld, ankle.matrix);
  }

  /* --- cached world points used by combat, audio and hit detection ------- */
  boneWorldPos(b.head, e.eyeWorld);
  e.eyeWorld.y += 0.06 * e.scale;
  boneWorldPos(b.chest, e.chestWorld);
  _a0.copy(RIFLE.muzzle).applyMatrix4(b.rifle.matrixWorld);
  e.muzzleWorld.copy(_a0);
  updateHitVolumes(e);
}

/**
 * Place the rifle. It hangs off the chest but is oriented in world space from the aim
 * direction, and both hands then IK onto it — that ordering is what keeps the grip solid
 * while the torso breathes, flinches and counter-rotates underneath.
 */
function poseWeapon(e, aimBlend) {
  const b = e.bones;
  boneWorldPos(b.chest, _a0);
  const cosF = Math.cos(e.facing);
  const sinF = Math.sin(e.facing);
  _a1.set(cosF, 0, -sinF); // right
  _a2.set(-sinF, 0, -cosF); // forward

  // Aimed: rifle out in front along the sight line. Patrol: tucked in and angled down.
  _a3.copy(e.aimDir).normalize();
  const lowT = 1 - aimBlend;
  if (lowT > 0.001) {
    // Muzzle drops and swings inboard as the soldier relaxes.
    _a4.copy(_a2).multiplyScalar(0.85).addScaledVector(UP, -0.75).addScaledVector(_a1, -0.12).normalize();
    _a3.lerp(_a4, lowT).normalize();
  }
  if (e.weaponCheck > 0.002) {
    // Weapon check: muzzle further down and well inboard so he can look at the magazine.
    _a4.copy(_a2).multiplyScalar(0.45).addScaledVector(UP, -0.9).addScaledVector(_a1, -0.5).normalize();
    _a3.lerp(_a4, e.weaponCheck * 0.85).normalize();
  }

  // Off the aim, the weapon rides the gait: the arm holding it swings, so the rifle traces a
  // small figure with it rather than being welded to a floating chest.
  const gait = e.armSwing * (1 - aimBlend) * 0.5;
  const fwdOff = lerp(0.1, 0.15, aimBlend) - e.fireShove * 0.05 + gait * 0.05 - e.weaponCheck * 0.06;
  const upOff = lerp(-0.1, -0.015, aimBlend) - e.crouch * 0.02 - Math.abs(gait) * 0.02 + e.weaponCheck * 0.05;
  const rightOff = lerp(0.135, 0.095, aimBlend) - gait * 0.03 - e.weaponCheck * 0.05;
  _a5.copy(_a0)
    .addScaledVector(_a1, rightOff * e.scale)
    .addScaledVector(UP, upOff * e.scale)
    .addScaledVector(_a3, fwdOff * e.scale);

  // Orientation: local -Z onto the aim direction, roll kept upright with a small cant.
  _a6.copy(_a3).multiplyScalar(-1); // local +Z
  _a7.copy(UP).addScaledVector(_a6, -UP.dot(_a6));
  if (_a7.lengthSq() < 1e-6) _a7.set(0, 0, 1).addScaledVector(_a6, -_a6.z);
  _a7.normalize();
  _a8.crossVectors(_a7, _a6).normalize();
  // Checking the weapon rolls it over so the ejection port and the magazine face the eye.
  const cant = lerp(0.14, 0.045, aimBlend) + e.hipRoll * 0.4 - e.weaponCheck * 0.75;
  _m1.makeBasis(_a8, _a7, _a6);
  _aq.setFromRotationMatrix(_m1);
  _aq2.setFromAxisAngle(_a6, -cant);
  _aq.premultiply(_aq2);

  // Support-hand reach check. When the chest twists hard the left shoulder can end up further
  // from the handguard than the arm is long, and the IK would silently straighten and leave a
  // gap. A real shooter solves this by pulling the weapon in, so that is what we do — the
  // rifle slides back along its own axis until the support hand can actually reach it.
  _a2.set(-RIG.shoulderX, RIG.shoulderY, 0).applyMatrix4(b.chest.matrixWorld);
  _a4.copy(RIFLE.gripL).multiplyScalar(e.scale).applyQuaternion(_aq).add(_a5);
  const reach = ARM_REACH * e.scale * 0.985;
  const over = _a2.distanceTo(_a4) - reach;
  if (over > 0) _a5.addScaledVector(_a3, -Math.min(over, 0.2));

  setWorldTransform(b.rifle, _a5, _aq, e.scale);
  refreshLocal(b.rifle);
  b.rifle.matrixWorld.multiplyMatrices(b.chest.matrixWorld, b.rifle.matrix);
}

/* Sling scratch. Kept off _a* because poseSling runs both from poseEnemy, right after the
   weapon, and from ragdollPose, where the _a* set is in use for the corpse's limbs. */
const _sl0 = new THREE.Vector3();
const _sl1 = new THREE.Vector3();
const _slX = new THREE.Vector3();
const _slY = new THREE.Vector3();
const _slZ = new THREE.Vector3();
/** Chest-local point where the strap crosses the left shoulder and meets the fixed webbing. */
const SLING_SHOULDER = new THREE.Vector3(-0.15, 0.238, 0.052);

/**
 * Stretch the sling between the rifle's front QD loop and the shoulder.
 *
 * This is the one part of the soldier that is not a rigid segment, and it is worth the
 * exception: a sling that is baked into either the body or the weapon is wrong the moment the
 * other one moves, and a soldier carrying a rifle on nothing is the kind of detail a player
 * cannot name but does notice. The bone's matrixWorld is written directly rather than through
 * position/quaternion/scale because the strap needs a deliberately non-uniform basis —
 * constant thickness across X, a drape that grows with the span on Y, and the live gap on Z.
 * Three's instancing shader divides the normal by each basis column's squared length, so this
 * shades correctly despite the anisotropy.
 */
function poseSling(e) {
  const b = e.bones;
  const m = b.sling.matrixWorld.elements;
  _sl0.copy(RIFLE.slingFront).applyMatrix4(b.rifle.matrixWorld);
  _sl1.copy(SLING_SHOULDER).applyMatrix4(b.chest.matrixWorld);
  _slZ.copy(_sl1).sub(_sl0);
  const len = _slZ.length();
  if (len < 1e-4) {
    // Degenerate span: collapse the instance rather than emitting a NaN basis.
    for (let i = 0; i < 12; i++) m[i] = 0;
    m[12] = _sl0.x;
    m[13] = _sl0.y;
    m[14] = _sl0.z;
    m[15] = 1;
    return;
  }
  _slZ.divideScalar(len);
  // Y is world up made perpendicular to the run, so the drape always hangs downhill.
  _slY.set(0, 1, 0).addScaledVector(_slZ, -_slZ.y);
  if (_slY.lengthSq() < 1e-6) _slY.set(1, 0, 0).addScaledVector(_slZ, -_slZ.x);
  _slY.normalize();
  _slX.crossVectors(_slY, _slZ).normalize();
  const s = e.scale;
  // Sag tracks the span: a rifle held out at the shoulder pulls the strap nearly straight,
  // one dropped to the low ready lets it belly out. Same geometry, one multiply.
  const sag = clamp(0.4 + len * 1.1, 0.5, 1.4) * s;
  m[0] = _slX.x * s; m[1] = _slX.y * s; m[2] = _slX.z * s; m[3] = 0;
  m[4] = _slY.x * sag; m[5] = _slY.y * sag; m[6] = _slY.z * sag; m[7] = 0;
  m[8] = _slZ.x * len; m[9] = _slZ.y * len; m[10] = _slZ.z * len; m[11] = 0;
  m[12] = _sl0.x; m[13] = _sl0.y; m[14] = _sl0.z; m[15] = 1;
}

/** Refresh the capsule set used for hit detection. Six zones, two endpoints each. */
function updateHitVolumes(e) {
  const b = e.bones;
  boneWorldPos(b.head, e.zoneA[0]);
  // Sit the head capsule on the skull, not the atlas, or it swallows upper-chest hits.
  e.zoneA[0].addScaledVector(UP, 0.03 * e.scale);
  e.zoneB[0].copy(e.zoneA[0]).addScaledVector(UP, 0.09 * e.scale);
  boneWorldPos(b.chest, e.zoneA[1]);
  boneWorldPos(b.hips, e.zoneB[1]);
  boneWorldPos(b.shoulderR, e.zoneA[2]);
  boneWorldPos(b.wristR, e.zoneB[2]);
  boneWorldPos(b.shoulderL, e.zoneA[3]);
  boneWorldPos(b.wristL, e.zoneB[3]);
  boneWorldPos(b.hipR, e.zoneA[4]);
  boneWorldPos(b.ankleR, e.zoneB[4]);
  boneWorldPos(b.hipL, e.zoneA[5]);
  boneWorldPos(b.ankleL, e.zoneB[5]);
  e.boundCentre.copy(e.zoneA[1]).lerp(e.zoneB[1], 0.5);
  // One sphere fat enough to contain every zone, used as the broadphase in ai.raycast.
  let r = 0;
  for (let i = 0; i < HIT_ZONES.length; i++) {
    const da = e.boundCentre.distanceTo(e.zoneA[i]) + ZONE_RADIUS[HIT_ZONES[i]];
    const db = e.boundCentre.distanceTo(e.zoneB[i]) + ZONE_RADIUS[HIT_ZONES[i]];
    if (da > r) r = da;
    if (db > r) r = db;
  }
  e.boundRadius = r + 0.08;
}

/* ========================================================================== */
/* Ray / capsule intersection                                                 */
/* ========================================================================== */

const _rc0 = new THREE.Vector3();
const _rc1 = new THREE.Vector3();
const _rc2 = new THREE.Vector3();
const _rcOut = { t: 0, d2: 0, s: 0 };

/**
 * Closest approach between a ray (origin, unit dir) and the segment a→b.
 * Writes {t: distance along the ray, d2: squared gap, s: 0..1 along the segment}.
 */
function raySegment(origin, dir, a, b, out) {
  _rc0.copy(b).sub(a);
  _rc1.copy(origin).sub(a);
  const dd = _rc0.dot(_rc0);
  const dr = _rc0.dot(dir);
  const dw = _rc0.dot(_rc1);
  const rw = dir.dot(_rc1);
  const denom = dd - dr * dr;
  let s;
  let t;
  if (Math.abs(denom) < 1e-8 || dd < 1e-10) {
    s = 0;
    t = -rw;
  } else {
    // Minimising |(a + s·u) − (o + t·d)|² gives s = (u·w − (u·d)(d·w)) / (u·u − (u·d)²).
    s = clamp((dw - dr * rw) / denom, 0, 1);
    t = s * dr - rw;
  }
  if (t < 0) t = 0;
  _rc2.copy(a).addScaledVector(_rc0, s).sub(origin).addScaledVector(dir, -t);
  out.t = t;
  out.d2 = _rc2.lengthSq();
  out.s = s;
  return out;
}

/** Ray vs sphere; returns the near hit distance or -1. */
function raySphere(origin, dir, centre, radius) {
  _rc0.copy(centre).sub(origin);
  const b = _rc0.dot(dir);
  const c = _rc0.lengthSq() - radius * radius;
  if (c > 0 && b < 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t0 = b - sq;
  return t0 >= 0 ? t0 : b + sq;
}

/* ========================================================================== */
/* Factory                                                                    */
/* ========================================================================== */

export function createAI(game) {
  const scene = game && game.scene;
  const events = game && game.events;
  const P = buildPalette();

  /* --- geometry, material, instanced meshes ----------------------------- */
  const geometries = buildSegmentGeometries(P);
  const lut = buildResponseLUT();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 1.0,
    metalness: 1.0,
    roughnessMap: lut,
    metalnessMap: lut,
    envMapIntensity: 1.0,
    side: THREE.FrontSide,
  });
  material.name = 'ai:soldier';
  if (game && game.materials && game.materials.env) material.envMap = game.materials.env;
  try {
    game && game.shadows && game.shadows.register && game.shadows.register(material);
  } catch {
    /* CSM absent or already torn down — the material still renders, just unshadowed. */
  }

  const root = new THREE.Group();
  root.name = 'ai:squad';
  if (scene) scene.add(root);

  const meshes = new Array(SEG_COUNT);
  const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let s = 0; s < SEG_COUNT; s++) {
    const m = new THREE.InstancedMesh(geometries[s], material, MAX_ENEMIES);
    m.name = 'ai:seg' + s;
    m.castShadow = true;
    m.receiveShadow = true;
    // The squad roams the whole map and the pool is tiny; per-mesh culling would cost more
    // than it saves and risks popping shadows when a soldier leaves the camera frustum.
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_ENEMIES; i++) m.setMatrixAt(i, HIDDEN);
    m.instanceMatrix.needsUpdate = true;
    meshes[s] = m;
    root.add(m);
  }
  // instanceColor has to exist before the first setColorAt, and Three only allocates it lazily.
  for (let s = 0; s < SEG_COUNT; s++) {
    for (let i = 0; i < MAX_ENEMIES; i++) meshes[s].setColorAt(i, WHITE);
    if (meshes[s].instanceColor) meshes[s].instanceColor.needsUpdate = true;
  }

  /* --- pool ------------------------------------------------------------- */
  const enemies = [];
  for (let i = 0; i < MAX_ENEMIES; i++) enemies.push(createEnemyRecord(i));

  const level = () => (game && game.level) || null;
  const nav = createNav(level());
  let nextId = 1;

  /* --- shared runtime state --------------------------------------------- */
  const pathScratch = new Float32Array(NAV_MAX_PATH * 2);
  const pathQueue = [];
  let pathBudget = 2; // A* searches per frame
  let spawnedInitial = false;
  let respawnTimer = 3.0;
  let targetAlive = TARGET_ALIVE_MIN + 2;
  let suppression = 0;
  let quality = (game && game.quality) || 'high';
  /**
   * How many soldiers may shoot at the player simultaneously. Uncapped, eight rifles converge
   * on one target and the fight is over before the player has read it. Capped, the rest keep
   * manoeuvring — which is both more survivable and far more legible as squad behaviour.
   */
  let fireCap = 3;
  let tokensUsed = 0;
  let maxLive = quality === 'low' ? 7 : quality === 'medium' ? 9 : MAX_ENEMIES;
  let disposed = false;
  const rng = mulberry32(0x5eed1a7e);

  const KIT_SOURCES = [
    PALETTE.railGreen, PALETTE.dirt, PALETTE.sandbag,
    PALETTE.steelPainted, PALETTE.woodWeathered, PALETTE.asphalt,
  ];

  /**
   * Per-enemy kit tint. Pulling a palette entry's chroma out and normalising its luminance
   * means variation never brightens or darkens a soldier out of the scene's value range —
   * it only shifts hue, which is exactly the amount of variety a squad should have.
   */
  function kitTint(out, hex, amount, bright) {
    out.set(hex);
    const l = Math.max(1e-4, (out.r + out.g + out.b) / 3);
    out.multiplyScalar(1 / l);
    out.lerp(WHITE, 1 - amount);
    out.multiplyScalar(bright);
    return out;
  }

  /* --- helpers ----------------------------------------------------------- */

  function playerEye(out) {
    const p = game && game.player;
    if (p && p.eye) return out.copy(p.eye);
    if (p && p.position) return out.copy(p.position).setY(p.position.y + 1.6);
    if (game && game.camera) return out.copy(game.camera.position);
    return out.set(0, 1.6, 0);
  }

  function playerFeet(out) {
    const p = game && game.player;
    if (p && p.position) return out.copy(p.position);
    playerEye(out);
    out.y -= 1.6;
    return out;
  }

  function playerAlive() {
    const st = game && game.state;
    if (!st) return true;
    return st.health > 0 && st.mode !== 'dead';
  }

  /** Level raycast that never throws and never returns a partially-formed hit. */
  function castLevel(origin, dir, maxDist) {
    const lv = level();
    if (!lv || typeof lv.raycast !== 'function') return null;
    let hit = null;
    try {
      hit = lv.raycast(origin, dir, maxDist);
    } catch {
      return null;
    }
    if (!hit) return null;
    if (hit.hit === false) return null;
    return hit;
  }

  /** True when nothing solid sits between two world points. */
  function lineOfSight(from, to) {
    _v0.copy(to).sub(from);
    const dist = _v0.length();
    if (dist < 0.05) return true;
    _v0.divideScalar(dist);
    const hit = castLevel(from, _v0, dist - 0.08);
    return !hit || (hit.distance !== undefined && hit.distance >= dist - 0.08);
  }

  function groundAt(x, z, fallback) {
    _v1.set(x, fallback + 2.2, z);
    _v2.set(0, -1, 0);
    const hit = castLevel(_v1, _v2, 6.0);
    if (hit && hit.point) return hit.point.y;
    return fallback;
  }

  /* --- spawning ---------------------------------------------------------- */

  function pickSpawn(out) {
    const lv = level();
    const pts = lv && lv.spawnPoints;
    playerFeet(_v3);
    if (pts && pts.length) {
      let best = null;
      let bestScore = -Infinity;
      // Sample rather than scan: a fixed 10 tries keeps spawn cost flat as maps grow.
      for (let i = 0; i < 10; i++) {
        const sp = pts[(rng() * pts.length) | 0];
        if (!sp || !sp.pos) continue;
        const d = sp.pos.distanceTo(_v3);
        if (d < 20) continue;
        let score = Math.min(d, 70) - Math.max(0, d - 70) * 2;
        // Prefer somewhere the player cannot currently watch: soldiers should walk in.
        playerEye(_v4);
        _v5.copy(sp.pos).setY(sp.pos.y + 1.5);
        if (!lineOfSight(_v4, _v5)) score += 26;
        // Spread the squad out.
        for (let k = 0; k < enemies.length; k++) {
          const o = enemies[k];
          if (!o.active || o.dead) continue;
          const dd = o.position.distanceTo(sp.pos);
          if (dd < 6) score -= (6 - dd) * 4;
        }
        score += rng() * 8;
        if (score > bestScore) {
          bestScore = score;
          best = sp;
        }
      }
      if (best) {
        out.copy(best.pos);
        return best.yaw !== undefined ? best.yaw : rng() * TAU;
      }
    }
    // No spawn points: ring the yard centre so the demo still has opposition.
    const zone = ZONES.yard;
    const ang = rng() * TAU;
    const r = 24 + rng() * 12;
    out.set(zone.centre[0] + Math.cos(ang) * r, 0, zone.centre[2] + Math.sin(ang) * r);
    out.y = groundAt(out.x, out.z, 0);
    return ang + Math.PI;
  }

  function spawnEnemy(archetypeId) {
    let e = null;
    for (let i = 0; i < enemies.length; i++) {
      if (!enemies[i].active) {
        e = enemies[i];
        break;
      }
    }
    if (!e) return null;
    const yaw = pickSpawn(_v6);

    e.active = true;
    e.dead = false;
    e.rdActive = false;
    e.id = nextId++;
    e.seed = (rng() * 1e6) | 0;
    e.rng = mulberry32(e.seed);
    const r = e.rng;

    const archId = archetypeId || ARCHETYPE_MIX[(r() * ARCHETYPE_MIX.length) | 0];
    e.archetype = ARCHETYPES[archId] || ARCHETYPES.rifleman;

    // ±4 % height. Small, but it is exactly enough that a squad stops reading as clones.
    e.scale = 0.96 + r() * 0.08;
    e.hasCover = r() < 0.45;
    kitTint(e.kitTint, KIT_SOURCES[(r() * KIT_SOURCES.length) | 0], 0.34, 0.9 + r() * 0.22);
    kitTint(e.helmetTint, KIT_SOURCES[(r() * KIT_SOURCES.length) | 0], 0.26, 0.88 + r() * 0.2);
    kitTint(e.coverTint, r() < 0.5 ? PALETTE.sandbag : PALETTE.dirt, 0.3, 0.9 + r() * 0.2);
    // Skin varies in value far more than hue.
    const skinV = 0.82 + r() * 0.34;
    e.skinTint.setRGB(skinV, skinV * (0.98 + r() * 0.04), skinV * (0.96 + r() * 0.05));

    e.position.copy(_v6);
    e.groundY = groundAt(e.position.x, e.position.z, e.position.y);
    e.position.y = e.groundY;
    e.velocity.set(0, 0, 0);
    e.facing = yaw;
    e.facingTarget = yaw;
    e.health = ENEMY_HEALTH;
    e.state = 'idle';
    e.stateTime = 0;
    e.alert = 0;
    e.awareness = 0;
    e.canSee = false;
    e.hasTarget = false;
    e.losTimer = r() * 0.12;
    e.lastSeenTime = -100;
    e.ammo = e.archetype.magazine;
    e.reloadTimer = 0;
    e.burstLeft = 0;
    e.burstPause = 0;
    e.fireTimer = 0;
    e.reactTimer = 0;
    e.aimError = e.archetype.startError;
    e.aimAge = 0;
    e.readyWeight = 0;
    e.crouch = 0;
    e.crouchTarget = 0;
    e.speed = 0;
    e.cycle = r();
    e.cycleRate = 0;
    e.swingFrac = GAIT.swingFrac;
    e.pathLen = 0;
    e.pathIdx = 0;
    e.pathTimer = 0;
    e.wantPath = false;
    e.coverPoint = null;
    e.coverTimer = 0;
    e.scanPhase = r() * TAU;
    e.breath = r() * TAU;
    e.suppressedBy = 0;
    e.reinforceTimer = 0;
    e.fireToken = false;
    e.tokenTime = 0;
    e.flinchPitch = e.flinchPitchV = e.flinchYaw = e.flinchYawV = 0;
    e.flinchRoll = e.flinchRollV = 0;
    e.buckle = e.buckleV = 0;
    e.armJerkR = e.armJerkL = 0;
    e.fireShove = e.fireShoveV = 0;
    e.stagger = 0;
    e.crouchV = 0;
    e.strike = e.strikeV = 0;
    e.weight = e.weightBias = e.weightBiasTarget = 0;
    e.pelvisShift = 0;
    e.armSwing = 0;
    e.stepCooldown = 0;
    e.lean = e.leanTarget = 0;
    e.leanSide = 0;
    e.bodyOffset.set(0, 0, 0);
    e.bodyOffsetTarget.set(0, 0, 0);
    e.idleAction = 0;
    e.idleT = 0;
    e.idleTimer = 1.0 + r() * 2.5;
    e.weaponCheck = 0;
    e.shoulderRoll = 0;
    e.lookYawOff = 0;
    // Every soldier stands with a slightly different toe-out. Tiny, but a squad whose boots
    // are all dead parallel reads as one asset stamped out repeatedly.
    e.footToeOut[0] = -(0.05 + r() * 0.1);
    e.footToeOut[1] = 0.05 + r() * 0.1;
    e.deathTime = 0;
    e.animRate = 1;
    e.animAccum = 0;

    _v0.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    e.aimDir.copy(_v0);
    e.lookTarget.copy(e.position).addScaledVector(_v0, 8).setY(e.groundY + 1.6);
    e.aimTarget.copy(e.lookTarget);

    // Feet start planted under the hips so the first frame does not snap.
    const cosF = Math.cos(yaw);
    const sinF = Math.sin(yaw);
    for (let leg = 0; leg < 2; leg++) {
      const side = leg === 0 ? 1 : -1;
      e.footPlant[leg].set(
        e.position.x + cosF * side * GAIT.standWidth,
        e.groundY,
        e.position.z - sinF * side * GAIT.standWidth
      );
      e.footPos[leg].copy(e.footPlant[leg]);
      e.footPrev[leg].copy(e.footPlant[leg]);
      e.footPlanted[leg] = true;
      e.footLift[leg] = 1;
      e.footYaw[leg] = yaw;
      e.footYawPrev[leg] = yaw;
      e.wasSwing[leg] = false;
    }

    // Pose once immediately so eyeWorld / hit volumes are valid on the very first frame —
    // perception and ballistics both read them before the next pose runs.
    updateGait(e, 1 / 60, level());
    poseEnemy(e, 1 / 60, level(), 0);

    // Push the per-enemy tints into the instance colour buffers once, at spawn.
    for (let s = 0; s < SEG_COUNT; s++) {
      const kind = SEG_TINT[s];
      const c = kind === 0 ? e.kitTint : kind === 1 ? e.skinTint : kind === 2 ? e.helmetTint : kind === 3 ? e.coverTint : WHITE;
      meshes[s].setColorAt(e.index, c);
      if (meshes[s].instanceColor) meshes[s].instanceColor.needsUpdate = true;
    }
    return e;
  }

  function despawn(e) {
    e.active = false;
    e.dead = false;
    e.rdActive = false;
    for (let s = 0; s < SEG_COUNT; s++) meshes[s].setMatrixAt(e.index, HIDDEN);
  }

  /* --- perception -------------------------------------------------------- */

  /**
   * Vision: a 100° cone out to 55 m, with a peripheral and a distance falloff feeding an
   * `awareness` accumulator. Detection is therefore gradual — a soldier who catches you in
   * the corner of his eye at 50 m takes a beat to be sure, which is what makes the squad read
   * as deliberate rather than omniscient.
   */
  function perceive(e, dt, now) {
    if (!playerAlive()) {
      e.canSee = false;
      e.awareness = damp(e.awareness, 0, 1.4, dt);
      return;
    }
    playerEye(_v0);
    _v1.copy(_v0).sub(e.eyeWorld);
    const dist = _v1.length();
    let gain = 0;

    if (dist < VISION_RANGE) {
      _v1.divideScalar(Math.max(1e-5, dist));
      _v2.set(-Math.sin(e.facing), 0, -Math.cos(e.facing));
      // Sensitivity is biased toward the facing yaw, not the aim, so turning the head does
      // not magically widen the cone.
      const cosAng = _v1.x * _v2.x + _v1.z * _v2.z + _v1.y * 0.35;
      const cone = Math.cos(VISION_HALF);
      if (cosAng > cone) {
        const peripheral = smoothstep(clamp((cosAng - cone) / (1 - cone), 0, 1));
        const distFall = 1 - smoothstep(clamp(dist / VISION_RANGE, 0, 1));
        // Crouched, stationary players are harder to pick out.
        const pl = game && game.player;
        let stealth = 1;
        if (pl) {
          if (pl.crouched) stealth *= 0.72;
          if (pl.sprinting) stealth *= 1.35;
          const sp = pl.velocity ? pl.velocity.length() : 0;
          stealth *= 0.75 + clamp(sp / 6, 0, 1) * 0.5;
        }
        const strength = (0.35 + peripheral * 0.65) * (0.25 + distFall * 0.75) * stealth;
        if (strength > 0.02) {
          e.losTimer -= dt;
          if (e.losTimer <= 0) {
            // Throttled and jittered so twelve soldiers never all raycast on the same frame.
            e.losTimer = 0.085 + e.rng() * 0.075;
            e.canSee = lineOfSight(e.eyeWorld, _v0);
          }
          if (e.canSee) gain = strength * 3.1;
        } else e.canSee = false;
      } else e.canSee = false;
    } else e.canSee = false;

    if (gain > 0) {
      e.awareness = Math.min(1, e.awareness + gain * dt);
      e.lastSeenTime = now;
      e.lastKnown.copy(_v0);
      const pv = game && game.player && game.player.velocity;
      if (pv) e.lastKnownVel.copy(pv);
      else e.lastKnownVel.set(0, 0, 0);
      if (e.awareness > 0.55) {
        e.hasTarget = true;
        if (e.alert < 2) {
          e.alert = 2;
          // Reaction delay. The player is never insta-killed: acquisition, then a beat,
          // then the first round.
          e.reactTimer = 0.28 + e.rng() * 0.17;
          e.aimAge = 0;
          e.aimError = e.archetype.startError;
          e.reinforceTimer = 0.35 + e.rng() * 0.5;
        }
      } else if (e.alert < 1 && e.awareness > 0.18) {
        e.alert = 1;
      }
    } else {
      // Memory fades, but slower than awareness — soldiers keep watching where you were.
      e.awareness = damp(e.awareness, 0, 0.55, dt);
      if (e.alert === 2 && now - e.lastSeenTime > 7.5) e.alert = 1;
    }
  }

  /** Broadcast a contact to nearby squadmates after a short comms delay. */
  function shareContact(e, now) {
    for (let i = 0; i < enemies.length; i++) {
      const o = enemies[i];
      if (o === e || !o.active || o.dead) continue;
      if (o.position.distanceToSquared(e.position) > 900) continue; // 30 m
      if (o.alert >= 2) continue;
      o.lastKnown.copy(e.lastKnown);
      o.hasTarget = true;
      o.alert = Math.max(o.alert, 1);
      o.awareness = Math.max(o.awareness, 0.42);
      if (o.state === 'idle' || o.state === 'patrol') setState(o, 'investigate');
    }
  }

  /** Gunfire within 45 m is heard; the reported position is deliberately imprecise. */
  function onShot(payload) {
    if (!payload || !payload.origin) return;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active || e.dead) continue;
      const d2 = e.position.distanceToSquared(payload.origin);
      if (d2 > HEARING_RANGE * HEARING_RANGE) continue;
      const d = Math.sqrt(d2);
      // Localisation error grows with distance: you know roughly where, not exactly.
      const err = 1.2 + d * 0.085;
      e.lastKnown.set(
        payload.origin.x + (e.rng() - 0.5) * err,
        payload.origin.y + 0.4,
        payload.origin.z + (e.rng() - 0.5) * err
      );
      e.hasTarget = true;
      e.awareness = Math.max(e.awareness, 0.34 * (1 - d / HEARING_RANGE) + 0.16);
      if (e.alert < 1) e.alert = 1;
      if (e.state === 'idle' || e.state === 'patrol') setState(e, 'investigate');
    }
  }

  function onExplosion(payload) {
    if (!payload || !payload.point) return;
    const radius = payload.radius || 6;
    const power = payload.power === undefined ? 70 : payload.power;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active || e.dead) continue;
      const d = e.position.distanceTo(payload.point);
      if (d > radius * 1.5) {
        if (d < HEARING_RANGE) {
          e.lastKnown.copy(payload.point);
          e.hasTarget = true;
          if (e.alert < 1) e.alert = 1;
        }
        continue;
      }
      const falloff = clamp(1 - d / (radius * 1.2), 0, 1);
      _v0.copy(e.position).sub(payload.point);
      if (_v0.lengthSq() < 1e-6) _v0.set(0, 1, 0);
      _v0.normalize();
      damageEnemy(e, power * falloff * falloff, e.chestWorld, false, _v0);
    }
  }

  /* --- cover ------------------------------------------------------------- */

  /**
   * Score cover by how far it is to walk to, how much closer it puts us to the fight, and —
   * the part that actually matters — whether it genuinely breaks the player's line of sight.
   */
  function pickCover(e) {
    const lv = level();
    const pts = lv && lv.coverPoints;
    if (!pts || !pts.length) return null;
    playerEye(_v0);
    let best = null;
    let bestScore = -Infinity;
    const tries = Math.min(pts.length, 22);
    const start = (e.rng() * pts.length) | 0;
    for (let k = 0; k < tries; k++) {
      const cp = pts[(start + k * 3) % pts.length];
      if (!cp || !cp.pos) continue;
      const toMe = cp.pos.distanceTo(e.position);
      if (toMe > 34) continue;
      const toPlayer = cp.pos.distanceTo(_v0);
      if (toPlayer < 5.5) continue; // do not walk into his lap
      let score = 34 - toMe * 1.15;
      // Being roughly at the archetype's ideal range is worth a lot.
      score -= Math.abs(toPlayer - e.archetype.idealRange) * 0.55;
      // Does the cover face the threat? A normal pointing at the player is a wall we hide behind.
      if (cp.normal) {
        _v1.copy(_v0).sub(cp.pos);
        _v1.y = 0;
        if (_v1.lengthSq() > 1e-6) {
          _v1.normalize();
          score += _v1.dot(cp.normal) * 12;
        }
      }
      // The decisive test: standing there, is the player actually blocked?
      _v2.copy(cp.pos);
      _v2.y += 0.85;
      if (!lineOfSight(_v2, _v0)) score += 30;
      else score -= 8;
      score += e.rng() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = cp;
      }
    }
    e.coverScore = bestScore;
    return best;
  }

  /* --- pathing ----------------------------------------------------------- */

  function requestPath(e, goal, kind) {
    e.pathGoal.copy(goal);
    e.goalKind = kind;
    if (!e.wantPath) {
      e.wantPath = true;
      pathQueue.push(e);
    }
  }

  function servicePathQueue() {
    let budget = pathBudget;
    while (budget > 0 && pathQueue.length) {
      const e = pathQueue.shift();
      if (!e || !e.active || e.dead) continue;
      e.wantPath = false;
      budget--;
      buildPath(e, e.pathGoal);
    }
  }

  function buildPath(e, goal) {
    const lv = level();
    e.pathIdx = 0;
    e.pathTimer = 0.9 + e.rng() * 0.5;
    if (!nav) {
      // No nav data: a single waypoint is still better than freezing.
      e.path[0] = goal.x;
      e.path[1] = goal.z;
      e.pathLen = 1;
      return;
    }
    let count = nav.search(e.position.x, e.position.z, goal.x, goal.z, pathScratch, NAV_MAX_PATH);
    if (count <= 0) {
      e.path[0] = goal.x;
      e.path[1] = goal.z;
      e.pathLen = 1;
      return;
    }
    count = stringPull(lv, pathScratch, count, e.groundY + 0.95, 48);
    for (let i = 0; i < count; i++) {
      e.path[i * 2] = pathScratch[i * 2];
      e.path[i * 2 + 1] = pathScratch[i * 2 + 1];
    }
    e.pathLen = count;
    // The first waypoint is where we already are; skip it so we do not stall on arrival.
    if (count > 1) {
      const dx = e.path[0] - e.position.x;
      const dz = e.path[1] - e.position.z;
      if (dx * dx + dz * dz < 0.6) e.pathIdx = 1;
    }
  }

  /** Follow the current path, returning the steering target in `out`. False when finished. */
  function pathTarget(e, out) {
    while (e.pathIdx < e.pathLen) {
      const x = e.path[e.pathIdx * 2];
      const z = e.path[e.pathIdx * 2 + 1];
      const dx = x - e.position.x;
      const dz = z - e.position.z;
      const last = e.pathIdx === e.pathLen - 1;
      const reach = last ? 0.55 : 0.85;
      if (dx * dx + dz * dz < reach * reach) {
        e.pathIdx++;
        continue;
      }
      out.set(x, e.groundY, z);
      return true;
    }
    return false;
  }

  /* --- steering and locomotion ------------------------------------------- */

  const _stDesired = new THREE.Vector3();
  const _stSep = new THREE.Vector3();
  const _stProbe = new THREE.Vector3();

  /**
   * Arrival steering plus a soft separation force. Separation is what stops a squad stacking
   * into one silhouette; arrival is what stops them jittering on the spot at the goal.
   */
  function steer(e, dt, target, maxSpeed, hasTarget) {
    _stDesired.set(0, 0, 0);
    if (hasTarget) {
      _stDesired.copy(target).sub(e.position);
      _stDesired.y = 0;
      const dist = _stDesired.length();
      if (dist > 1e-4) {
        // Ease into the goal over the last 1.6 m so arrival has weight instead of a stop-dead.
        const slow = clamp(dist / 1.6, 0, 1);
        _stDesired.multiplyScalar((maxSpeed * (0.25 + 0.75 * smoothstep(slow))) / dist);
      }
    }

    // Separation — inverse-square-ish, capped, only against live squadmates.
    _stSep.set(0, 0, 0);
    for (let i = 0; i < enemies.length; i++) {
      const o = enemies[i];
      if (o === e || !o.active || o.dead) continue;
      const dx = e.position.x - o.position.x;
      const dz = e.position.z - o.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 2.25 || d2 < 1e-6) continue; // 1.5 m
      const d = Math.sqrt(d2);
      const push = (1.5 - d) / 1.5;
      _stSep.x += (dx / d) * push;
      _stSep.z += (dz / d) * push;
    }
    if (_stSep.lengthSq() > 1e-6) _stDesired.addScaledVector(_stSep, maxSpeed * 0.55);

    if (_stDesired.lengthSq() > maxSpeed * maxSpeed) _stDesired.setLength(maxSpeed);
    e.desiredVel.copy(_stDesired);

    // Acceleration: soldiers have mass. Slowing down is quicker than speeding up.
    const accelK = _stDesired.lengthSq() > e.velocity.lengthSq() ? 6.5 : 9.5;
    e.velocity.x = damp(e.velocity.x, _stDesired.x, accelK, dt);
    e.velocity.z = damp(e.velocity.z, _stDesired.z, accelK, dt);
    e.velocity.y = 0;
    e.speed = Math.hypot(e.velocity.x, e.velocity.z);

    if (e.speed > 1e-4) {
      // Obstacle probe at torso height; slide along whatever we are about to walk into.
      const step = e.speed * dt;
      _v0.set(e.velocity.x / e.speed, 0, e.velocity.z / e.speed);
      _stProbe.set(e.position.x, e.groundY + 0.95, e.position.z);
      const hit = castLevel(_stProbe, _v0, step + ENEMY_RADIUS + 0.15);
      if (hit && hit.normal) {
        _v1.copy(hit.normal);
        _v1.y = 0;
        if (_v1.lengthSq() > 1e-6) {
          _v1.normalize();
          const into = e.velocity.dot(_v1);
          if (into < 0) e.velocity.addScaledVector(_v1, -into * 1.02);
          e.speed = Math.hypot(e.velocity.x, e.velocity.z);
        }
      }
      e.position.x += e.velocity.x * dt;
      e.position.z += e.velocity.z * dt;
    }

    // Ground follow. Damped so slopes and kerbs do not pop the whole body.
    const g = groundAt(e.position.x, e.position.z, e.groundY);
    e.groundY = Math.abs(g - e.groundY) > 1.2 ? g : damp(e.groundY, g, 16, dt);
    e.position.y = e.groundY;
  }

  /* --- finite state machine ---------------------------------------------- */

  /**
   * Hand out permission to shoot. Holders keep it while they still have eyes on, but only for
   * about four seconds at a time, so the firing position rotates around the squad instead of
   * one man doing all the work.
   */
  function updateFireTokens(step) {
    tokensUsed = 0;
    let contenders = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active || e.dead) continue;
      const wants = e.alert >= 2 && e.hasTarget && e.canSee && e.reloadTimer <= 0;
      if (!wants) {
        e.fireToken = false;
        e.tokenTime = 0;
        continue;
      }
      contenders++;
      if (e.fireToken) e.tokenTime += step;
    }
    // Renew existing holders first — a token that flickers every frame reads as hesitation.
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active || e.dead || !e.fireToken) continue;
      if (tokensUsed >= fireCap || (e.tokenTime > 4.0 && contenders > fireCap)) {
        e.fireToken = false;
        e.tokenTime = 0;
        continue;
      }
      tokensUsed++;
    }
    // Then fill spare slots, near soldiers before far ones.
    for (let pass = 0; pass < 2 && tokensUsed < fireCap; pass++) {
      const limit = pass === 0 ? 625 : Infinity; // 25 m, then anywhere
      for (let i = 0; i < enemies.length && tokensUsed < fireCap; i++) {
        const e = enemies[i];
        if (!e.active || e.dead || e.fireToken) continue;
        if (!(e.alert >= 2 && e.hasTarget && e.canSee && e.reloadTimer <= 0)) continue;
        if (e.position.distanceToSquared(_v3) > limit) continue;
        e.fireToken = true;
        e.tokenTime = 0;
        tokensUsed++;
      }
    }
  }

  function setState(e, next) {
    if (e.state === next) return;
    e.state = next;
    e.stateTime = 0;
    if (next !== 'takeCover') e.coverPoint = null;
    if (next === 'combat' || next === 'suppress') {
      e.burstPause = Math.max(e.burstPause, 0.12);
    }
  }

  /** Where should this soldier be looking and aiming right now? */
  function updateAimIntent(e, dt, now) {
    const engaged = e.alert >= 2 && e.hasTarget;
    // Ready weight: rifle comes up when there is something to point it at.
    const wantReady = engaged ? 1 : e.alert >= 1 ? 0.55 : 0.0;
    e.readyWeight = damp(e.readyWeight, wantReady, 5.0, dt);

    if (engaged) {
      if (e.canSee) {
        playerEye(_v0);
        // Aim centre-of-mass, not the eye — headshots from AI feel unfair.
        _v0.y -= 0.28;
        // Slight lead on a moving player, deliberately under-corrected.
        const pv = game && game.player && game.player.velocity;
        if (pv) {
          const dist = e.eyeWorld.distanceTo(_v0);
          const lead = clamp(dist / 380, 0, 0.22);
          _v0.addScaledVector(pv, lead);
        }
        e.aimTarget.copy(_v0);
      } else {
        // No LOS: aim at the last known position, drifting along his last known heading.
        _v0.copy(e.lastKnown).addScaledVector(e.lastKnownVel, Math.min(now - e.lastSeenTime, 1.2) * 0.5);
        e.aimTarget.lerp(_v0, 1 - Math.exp(-3 * dt));
      }
      e.lookTarget.lerp(e.aimTarget, 1 - Math.exp(-9 * dt));
    } else if (e.alert >= 1) {
      _v0.copy(e.lastKnown);
      e.aimTarget.lerp(_v0, 1 - Math.exp(-2.5 * dt));
      e.lookTarget.lerp(_v0, 1 - Math.exp(-4 * dt));
    } else {
      // Idle scan: a slow sweep with pauses, never a metronome. `lookYawOff` is the idle-life
      // layer holding a look somewhere specific on top of the sweep.
      e.scanPhase += dt * 0.42;
      const sweep = Math.sin(e.scanPhase) * 0.85 + Math.sin(e.scanPhase * 0.37) * 0.5;
      const ang = e.facing + sweep + e.lookYawOff;
      _v0.set(e.position.x - Math.sin(ang) * 9, e.groundY + 1.6, e.position.z - Math.cos(ang) * 9);
      e.lookTarget.lerp(_v0, 1 - Math.exp(-2.2 * dt));
      e.aimTarget.lerp(_v0, 1 - Math.exp(-1.6 * dt));
    }

    // Aim direction slews toward the target; slew rate is the soldier's "reflex".
    _v1.copy(e.aimTarget).sub(e.eyeWorld);
    if (_v1.lengthSq() > 1e-8) {
      _v1.normalize();
      const slew = engaged ? (e.canSee ? 11 : 5) : 3.2;
      e.aimDir.lerp(_v1, 1 - Math.exp(-slew * dt));
      if (e.aimDir.lengthSq() > 1e-8) e.aimDir.normalize();
    }

    // Aim error converges over ~0.6 s from a wide first-contact cone to the archetype floor.
    const A = e.archetype;
    e.aimAge += dt;
    const k = A.converge > 0 ? 3 / A.converge : 5;
    e.aimError = A.minError + (A.startError - A.minError) * Math.exp(-k * e.aimAge);
    // Suppressed soldiers shoot worse; moving ones shoot much worse.
    e.aimError *= 1 + e.suppressedBy * 0.9 + clamp(e.speed / 4, 0, 1) * 0.7;
  }

  /**
   * Which side of his cover should this soldier come out of? The one that actually has a line
   * to the player. Two probes, 0.55 m either side of the cover point at chest height.
   */
  function choosePeekSide(e) {
    const cp = e.coverPoint;
    if (!cp || !cp.pos) return 0;
    if (cp.normal) {
      // Lateral runs along the cover face, i.e. perpendicular to its normal.
      e.leanAxis.set(-cp.normal.z, 0, cp.normal.x);
      if (e.leanAxis.lengthSq() < 1e-6) e.leanAxis.set(1, 0, 0);
      else e.leanAxis.normalize();
    } else {
      e.leanAxis.set(Math.cos(e.facing), 0, -Math.sin(e.facing));
    }
    playerEye(_v0);
    let best = 0;
    let bestScore = -Infinity;
    for (let s = -1; s <= 1; s += 2) {
      _v1.copy(cp.pos).addScaledVector(e.leanAxis, s * 0.55);
      _v1.y = e.groundY + 1.12;
      const score = (lineOfSight(_v1, _v0) ? 10 : 0) + e.rng() * 2;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  /**
   * Cover lean.
   *
   * A soldier who takes cover and then stands beside it is worse than one who never took cover,
   * because the player reads it as the AI not understanding its own level. So the body actually
   * translates out past the cover edge: `bodyOffset` moves the rig root *and* the gait's stance
   * centre, so the outboard foot steps across to follow instead of the figure sliding off its
   * own boots, and because eyeWorld and muzzleWorld are read off the bones the lean genuinely
   * buys line of sight — perception and the firing solution both get it for free.
   */
  function updateLean(e, dt) {
    let want = 0;
    if (e.coverPoint && (e.state === 'takeCover' || e.state === 'reload')) {
      if (e.leanSide === 0) e.leanSide = choosePeekSide(e);
      // Out when he is up and hunting for the shot; in behind it when he is down or reloading.
      want =
        e.state === 'takeCover' && e.hasTarget && e.crouchTarget < 0.75 && e.speed < 0.65 ? 1 : 0;
    } else if (e.leanSide !== 0) {
      e.leanSide = 0;
    }
    e.leanTarget = want;
    // Slower coming out than going back in: exposing yourself is deliberate, hiding is not.
    e.lean = damp(e.lean, e.leanTarget, want > 0 ? 3.4 : 5.5, dt);
    if (e.lean > 0.002 && e.leanSide !== 0) {
      e.bodyOffsetTarget.copy(e.leanAxis).multiplyScalar(e.leanSide * e.lean * 0.32);
    } else {
      e.bodyOffsetTarget.set(0, 0, 0);
    }
    e.bodyOffset.x = damp(e.bodyOffset.x, e.bodyOffsetTarget.x, 5.5, dt);
    e.bodyOffset.z = damp(e.bodyOffset.z, e.bodyOffsetTarget.z, 5.5, dt);
  }

  /** Body yaw target: face the fight when engaged, face travel otherwise. */
  function updateFacing(e, dt) {
    let want = e.facingTarget;
    if (e.alert >= 2 && e.hasTarget) {
      _v0.copy(e.aimTarget).sub(e.position);
      want = Math.atan2(-_v0.x, -_v0.z);
      // Strafing soldiers keep their chest to the threat, so blend a little travel yaw in.
      if (e.speed > 1.2) {
        const travel = Math.atan2(-e.velocity.x, -e.velocity.z);
        want += clamp(angleDelta(want, travel), -0.75, 0.75) * 0.35;
      }
    } else if (e.speed > 0.35) {
      want = Math.atan2(-e.velocity.x, -e.velocity.z);
    }
    e.facingTarget = want;
    // Turn rate has inertia — a soldier does not pivot like a turret.
    const rate = e.alert >= 2 ? 7.5 : 3.6;
    e.facing = dampAngle(e.facing, e.facingTarget, rate, dt);
  }

  const _thTarget = new THREE.Vector3();

  function think(e, dt, now) {
    e.stateTime += dt;
    const A = e.archetype;
    playerFeet(_v3);
    const distToPlayer = e.position.distanceTo(_v3);
    const engaged = e.alert >= 2 && e.hasTarget && playerAlive();
    e.suppressedBy = Math.max(0, e.suppressedBy - dt * 0.55);

    if (e.reinforceTimer > 0) {
      e.reinforceTimer -= dt;
      if (e.reinforceTimer <= 0) shareContact(e, now);
    }

    // Reload pre-empts everything except death.
    if (e.reloadTimer > 0) {
      e.reloadTimer -= dt;
      if (e.reloadTimer <= 0) {
        e.ammo = A.magazine;
        setState(e, engaged ? 'combat' : 'investigate');
      }
    } else if (e.ammo <= 0 && e.state !== 'reload') {
      setState(e, 'reload');
      e.reloadTimer = A.reloadTime * (0.92 + e.rng() * 0.18);
      game.audio?.playOneShot?.('enemyReload', { position: e.chestWorld, volume: 0.5 });
    }

    let moveSpeed = A.moveSpeed;
    let hasMove = false;
    e.crouchTarget = 0;

    switch (e.state) {
      case 'idle': {
        if (engaged) { setState(e, 'combat'); break; }
        if (e.alert >= 1) { setState(e, 'investigate'); break; }
        if (e.stateTime > 2.5 + e.rng() * 4) setState(e, 'patrol');
        break;
      }

      case 'patrol': {
        if (engaged) { setState(e, 'combat'); break; }
        if (e.alert >= 1) { setState(e, 'investigate'); break; }
        moveSpeed = A.moveSpeed * 0.44;
        hasMove = pathTarget(e, _thTarget);
        if (!hasMove) {
          e.pathTimer -= dt;
          if (e.pathTimer <= 0) {
            // Wander inside the nearest named zone so patrols stay legible on the minimap.
            const zoneKeys = Object.keys(ZONES);
            const z = ZONES[zoneKeys[(e.rng() * zoneKeys.length) | 0]];
            const ang = e.rng() * TAU;
            const r = z.radius * (0.25 + e.rng() * 0.7);
            _v0.set(z.centre[0] + Math.cos(ang) * r, e.groundY, z.centre[2] + Math.sin(ang) * r);
            requestPath(e, _v0, 'patrol');
            e.pathTimer = 3 + e.rng() * 3;
          }
          if (e.stateTime > 16) setState(e, 'idle');
        }
        break;
      }

      case 'investigate': {
        if (engaged) { setState(e, 'advance'); break; }
        moveSpeed = A.moveSpeed * 0.8;
        hasMove = pathTarget(e, _thTarget);
        if (!hasMove) {
          e.pathTimer -= dt;
          if (e.pathTimer <= 0 && e.position.distanceToSquared(e.lastKnown) > 9) {
            requestPath(e, e.lastKnown, 'investigate');
            e.pathTimer = 1.6;
          }
        }
        // Sweep the area, then stand down.
        if (e.stateTime > 7 + e.rng() * 4) {
          e.alert = 0;
          e.hasTarget = false;
          setState(e, 'patrol');
        }
        break;
      }

      case 'advance': {
        if (!engaged) { setState(e, 'investigate'); break; }
        // Close to the archetype's fighting distance, then hold.
        if (e.canSee && distToPlayer < A.range && distToPlayer > A.idealRange * 0.55) {
          setState(e, 'combat');
          break;
        }
        moveSpeed = distToPlayer > 26 ? A.sprintSpeed : A.moveSpeed;
        hasMove = pathTarget(e, _thTarget);
        if (!hasMove) {
          e.pathTimer -= dt;
          if (e.pathTimer <= 0) {
            // Approach from an offset rather than straight down the barrel.
            _v0.copy(e.lastKnown).sub(e.position);
            _v0.y = 0;
            const d = Math.max(0.001, _v0.length());
            _v0.divideScalar(d);
            _v1.set(-_v0.z, 0, _v0.x).multiplyScalar((e.rng() - 0.5) * 12);
            _v2.copy(e.lastKnown)
              .addScaledVector(_v0, -Math.min(A.idealRange, d - 3))
              .add(_v1);
            _v2.y = e.groundY;
            requestPath(e, _v2, 'advance');
            e.pathTimer = 1.4 + e.rng() * 0.8;
          }
        }
        if (e.stateTime > 3 && !e.canSee && now - e.lastSeenTime > 9) setState(e, 'investigate');
        break;
      }

      case 'combat': {
        if (!engaged) { setState(e, 'advance'); break; }
        if (e.health < 42 && e.rng() < dt * 0.9) { setState(e, 'takeCover'); break; }
        if (e.suppressedBy > 0.55 && e.rng() < dt * 1.6) { setState(e, 'takeCover'); break; }
        if (!e.canSee && now - e.lastSeenTime > 1.3) {
          setState(e, e.rng() < 0.45 ? 'suppress' : 'advance');
          break;
        }
        // Hold position and fight, with small lateral repositioning so he is not a statue.
        // Without a firing slot he manoeuvres instead: flank, close, or drop behind cover.
        e.crouchTarget = distToPlayer > 16 && e.rng() < 0.5 ? 0.6 : 0;
        moveSpeed = A.moveSpeed * (e.fireToken ? 0.55 : 0.95);
        if (!e.fireToken && e.stateTime > 1.2 && e.rng() < dt * 0.7) {
          setState(e, e.rng() < 0.5 ? 'takeCover' : 'advance');
          break;
        }
        hasMove = pathTarget(e, _thTarget);
        if (!hasMove) {
          e.pathTimer -= dt;
          if (e.pathTimer <= 0) {
            const wantCloser = distToPlayer > A.range * 0.85;
            const wantBack = distToPlayer < A.idealRange * 0.45;
            if (wantCloser || wantBack || e.rng() < 0.35) {
              _v0.copy(_v3).sub(e.position);
              _v0.y = 0;
              const d = Math.max(0.001, _v0.length());
              _v0.divideScalar(d);
              const push = wantCloser ? Math.min(8, d - A.idealRange) : wantBack ? -6 : 0;
              _v1.set(-_v0.z, 0, _v0.x).multiplyScalar((e.rng() - 0.5) * 7);
              _v2.copy(e.position).addScaledVector(_v0, push).add(_v1);
              _v2.y = e.groundY;
              requestPath(e, _v2, 'combat');
            }
            e.pathTimer = 1.8 + e.rng() * 1.6;
          }
        }
        break;
      }

      case 'takeCover': {
        if (!e.coverPoint) {
          e.coverPoint = pickCover(e);
          if (e.coverPoint) {
            requestPath(e, e.coverPoint.pos, 'cover');
            e.coverTimer = 3.5 + e.rng() * 3.5;
          } else {
            setState(e, engaged ? 'combat' : 'investigate');
            break;
          }
        }
        moveSpeed = A.sprintSpeed * 0.85;
        hasMove = pathTarget(e, _thTarget);
        if (!hasMove) {
          // In cover: crouch, breathe, peek. Peeking is what makes cover readable to the player.
          e.coverTimer -= dt;
          e.crouchTarget = 1;
          if (e.health < ENEMY_HEALTH) e.health = Math.min(ENEMY_HEALTH, e.health + dt * 4.5);
          if (e.coverTimer < 1.4) e.crouchTarget = 0.25; // rising to fire
          if (e.coverTimer <= 0) setState(e, engaged ? 'combat' : 'investigate');
        }
        if (e.stateTime > 14) setState(e, engaged ? 'combat' : 'investigate');
        break;
      }

      case 'suppress': {
        if (e.canSee && engaged) { setState(e, 'combat'); break; }
        if (!e.hasTarget) { setState(e, 'investigate'); break; }
        e.crouchTarget = 0.45;
        // Pour rounds into the last known position; stops when the magazine runs low.
        if (e.stateTime > 3.5 + e.rng() * 2.5 || e.ammo < A.magazine * 0.25) {
          setState(e, 'advance');
        }
        break;
      }

      case 'reload': {
        // Back off slightly while reloading if the player has eyes on.
        e.crouchTarget = e.canSee ? 0.8 : 0.3;
        if (e.canSee && e.coverPoint === null && e.rng() < dt * 2) {
          e.coverPoint = pickCover(e);
          if (e.coverPoint) requestPath(e, e.coverPoint.pos, 'cover');
        }
        moveSpeed = A.moveSpeed * 0.7;
        hasMove = pathTarget(e, _thTarget);
        break;
      }

      case 'flee': {
        moveSpeed = A.sprintSpeed;
        hasMove = pathTarget(e, _thTarget);
        if (!hasMove) {
          e.pathTimer -= dt;
          if (e.pathTimer <= 0) {
            _v0.copy(e.position).sub(_v3);
            _v0.y = 0;
            if (_v0.lengthSq() < 1e-6) _v0.set(1, 0, 0);
            _v0.normalize();
            _v2.copy(e.position).addScaledVector(_v0, 16 + e.rng() * 10);
            _v2.y = e.groundY;
            requestPath(e, _v2, 'flee');
            e.pathTimer = 2.2;
          }
        }
        if (e.stateTime > 5) {
          e.health = Math.min(ENEMY_HEALTH, e.health + 25);
          setState(e, 'takeCover');
        }
        break;
      }

      default:
        setState(e, 'idle');
        break;
    }

    // Low health with no cover in reach: break contact instead of dying in the open.
    if (e.state !== 'flee' && e.state !== 'takeCover' && e.health < 22 && e.rng() < dt * 0.8) {
      setState(e, 'flee');
    }

    // Crouch is a second-order spring, not an exponential approach, and the difference is all
    // in the rise. An exponential decelerates into standing and reads as a hydraulic lift;
    // ζ = 0.72 overshoots by a few percent, so the soldier pushes off, comes up slightly past
    // standing and settles. The overshoot also feeds the ankles in poseEnemy, so he rises onto
    // the balls of his feet the way a man actually gets up.
    const ck = 44;
    const cd = 2 * Math.sqrt(ck) * 0.72;
    e.crouchV += (ck * (e.crouchTarget - e.crouch) - cd * e.crouchV) * dt;
    e.crouch += e.crouchV * dt;
    if (e.crouch < -0.09) {
      e.crouch = -0.09;
      if (e.crouchV < 0) e.crouchV = 0;
    } else if (e.crouch > 1.08) {
      e.crouch = 1.08;
      if (e.crouchV > 0) e.crouchV = 0;
    }

    updateIdleLife(e, dt);
    updateLean(e, dt);
    steer(e, dt, _thTarget, moveSpeed, hasMove);
    updateFacing(e, dt);

    // Firing. Suppressive fire at a last-known position needs no token — it is the job of
    // the soldiers who are NOT currently shooting at you. A man leaned out past his cover has
    // a shot even if he has not stood up, which is the whole point of leaning out.
    const wantFire =
      (e.state === 'suppress') ||
      (e.fireToken && e.state === 'combat' && e.canSee) ||
      (e.fireToken && e.state === 'takeCover' && e.canSee && (e.crouchTarget < 0.5 || e.lean > 0.5));
    updateWeapon(e, dt, wantFire, distToPlayer);
  }

  /* --- weapon handling ---------------------------------------------------- */

  /** Weapon definitions handed to ballistics.fireEnemy. Built once, never per shot. */
  const WEAPON_DEFS = {};
  for (const key of Object.keys(ARCHETYPES)) {
    const A = ARCHETYPES[key];
    WEAPON_DEFS[key] = {
      id: 'ai_' + key,
      name: key,
      owner: 'enemy',
      isEnemy: true,
      damage: A.damage,
      rpm: A.rpm,
      falloffStart: A.accuracyFalloff,
      falloffEnd: A.range * 1.35,
      minDamageScale: 0.42,
      headshotMultiplier: 2.2,
      limbMultiplier: 0.85,
      penetration: key === 'marksman' ? 1.35 : 0.85,
      muzzleVelocity: key === 'marksman' ? 830 : 720,
      tracerEvery: 3,
    };
  }

  function updateWeapon(e, dt, wantFire, distToPlayer) {
    const A = e.archetype;
    if (e.fireTimer > 0) e.fireTimer -= dt;
    if (e.burstPause > 0) e.burstPause -= dt;
    if (e.reactTimer > 0) {
      e.reactTimer -= dt;
      return;
    }
    if (e.reloadTimer > 0 || e.ammo <= 0) return;
    if (!wantFire) {
      e.burstLeft = 0;
      return;
    }
    if (distToPlayer > A.range * 1.15) return;

    if (e.burstLeft <= 0) {
      if (e.burstPause > 0) return;
      // New burst: pick a length and a fresh, stable aim bias. Holding the bias for the whole
      // burst is what makes enemy fire learnable — you can see where it is going and move.
      e.burstLeft = A.burst[0] + ((e.rng() * (A.burst[1] - A.burst[0] + 1)) | 0);
      // Heavily biased to the horizontal: a tall target means vertical error rarely misses,
      // and lateral misses are what crack past the player's head and sell the suppression.
      e.aimOffset.set(e.rng() * 2 - 1, (e.rng() * 2 - 1) * 0.32, e.rng() * 2 - 1);
      if (e.aimOffset.lengthSq() < 1e-6) e.aimOffset.set(1, 0, 0);
      e.aimOffset.normalize();
    }
    if (e.fireTimer > 0) return;

    fireShot(e);
    e.fireTimer = 60 / A.rpm;
    e.burstLeft--;
    if (e.burstLeft <= 0) {
      const p = A.burstPause;
      e.burstPause = p[0] + e.rng() * (p[1] - p[0]);
      // Recoil climb between bursts: the longer the burst, the longer the settle.
      e.burstPause += clamp(e.aimError * 6, 0, 0.35);
    }
  }

  const _fsDir = new THREE.Vector3();
  const _fsPerp = new THREE.Vector3();
  const _fsEnd = new THREE.Vector3();

  function fireShot(e) {
    const A = e.archetype;
    e.ammo--;

    // Direction: the smoothed aim, plus a burst-stable bias, plus a small per-shot jitter.
    _fsDir.copy(e.aimTarget).sub(e.muzzleWorld);
    if (_fsDir.lengthSq() < 1e-8) _fsDir.copy(e.aimDir);
    _fsDir.normalize();
    _fsPerp.copy(e.aimOffset).addScaledVector(_fsDir, -e.aimOffset.dot(_fsDir));
    if (_fsPerp.lengthSq() < 1e-8) _fsPerp.set(-_fsDir.z, 0, _fsDir.x);
    _fsPerp.normalize();
    const bias = e.aimError; // held for the whole burst — this is the learnable part
    const jitter = e.aimError * 0.5; // per-shot dispersion around it
    _fsDir.addScaledVector(_fsPerp, bias);
    _fsDir.x += (e.rng() - 0.5) * jitter;
    _fsDir.y += (e.rng() - 0.5) * jitter * 0.8;
    _fsDir.z += (e.rng() - 0.5) * jitter;
    _fsDir.normalize();

    // Recoil on the shooter: a shoulder shove and a touch of muzzle climb into the next shot.
    e.fireShoveV -= 2.4;
    e.aimAge = Math.max(0, e.aimAge - 0.05);

    // FX and audio are the shooter's own; damage resolution belongs to ballistics.
    game.fx?.spawnMuzzle?.(e.muzzleWorld, _fsDir, 0.55);
    game.audio?.playOneShot?.('enemyShot', {
      position: e.muzzleWorld,
      dir: _fsDir,
      weapon: A.id,
      volume: 0.85,
    });

    const def = WEAPON_DEFS[A.id] || WEAPON_DEFS.rifleman;
    const ballistics = game && game.ballistics;
    if (ballistics && typeof ballistics.fireEnemy === 'function') {
      try {
        ballistics.fireEnemy(e.muzzleWorld, _fsDir, def, e, game);
      } catch {
        resolveShotLocally(e, def);
      }
    } else {
      resolveShotLocally(e, def);
    }

    applySuppression(e, _fsDir);
  }

  /**
   * Fallback shot resolution, used only when ballistics has not exposed `fireEnemy` (a sibling
   * module that failed to build). Keeps the demo playable rather than leaving enemies harmless.
   */
  function resolveShotLocally(e, def) {
    const maxDist = def.falloffEnd;
    const wall = castLevel(e.muzzleWorld, _fsDir, maxDist);
    const wallDist = wall && wall.distance !== undefined ? wall.distance : maxDist;

    playerFeet(_v3);
    _v4.set(_v3.x, _v3.y + 0.35, _v3.z);
    _v5.set(_v3.x, _v3.y + 1.5, _v3.z);
    raySegment(e.muzzleWorld, _fsDir, _v4, _v5, _rcOut);
    const r = 0.34;
    let hit = false;
    if (_rcOut.d2 < r * r && _rcOut.t < wallDist && _rcOut.t <= maxDist) {
      hit = true;
      const dist = _rcOut.t;
      const falloff = 1 - clamp((dist - def.falloffStart) / Math.max(1, def.falloffEnd - def.falloffStart), 0, 1);
      const scale = def.minDamageScale + (1 - def.minDamageScale) * falloff;
      const headshot = _rcOut.s > 0.92;
      const dmg = def.damage * scale * (headshot ? def.headshotMultiplier : 1);
      if (!(game && game.capture)) {
        // The controller subscribes to `damage`; emitting once avoids double-applying.
        events?.emit?.('damage', { amount: dmg, from: e, dir: _fsDir });
      }
      _fsEnd.copy(e.muzzleWorld).addScaledVector(_fsDir, dist);
      _v6.copy(_fsDir).negate();
      game.fx?.spawnBlood?.(_fsEnd, _v6, _fsDir);
    }
    if (!hit) {
      _fsEnd.copy(e.muzzleWorld).addScaledVector(_fsDir, Math.min(wallDist, maxDist));
      if (wall && wall.point) {
        _fsEnd.copy(wall.point);
        events?.emit?.('impact', {
          point: wall.point,
          normal: wall.normal,
          surface: wall.surface || 'concrete',
          material: wall.surface || 'concrete',
          dir: _fsDir,
        });
      }
    }
    game.fx?.spawnTracer?.(e.muzzleWorld, _fsEnd, 340);
  }

  /**
   * Suppression: rounds cracking past raise the player's screen shake and blur their aim.
   * This is what makes a squad feel like it has initiative rather than being a shooting gallery.
   */
  function applySuppression(e, dir) {
    if (!game || !game.state) return;
    playerEye(_v0);
    _v1.copy(_v0).sub(e.muzzleWorld);
    const along = _v1.dot(dir);
    if (along <= 0) return;
    _v2.copy(e.muzzleWorld).addScaledVector(dir, along);
    const miss = _v2.distanceTo(_v0);
    if (miss > 2.6) return;
    const closeness = 1 - miss / 2.6;
    suppression = Math.min(1, suppression + closeness * closeness * 0.24);
    game.player?.addTrauma?.(closeness * closeness * 0.055);
    game.audio?.playOneShot?.('whizz', { position: _v2, volume: 0.5 + closeness * 0.5 });
  }

  /* --- damage and death ---------------------------------------------------- */

  const _dmgDir = new THREE.Vector3();

  /**
   * Apply damage to a soldier. Safe to call from ballistics directly or via the `hit` event —
   * duplicate deliveries inside one frame are dropped.
   */
  function damageEnemy(enemy, dmg, point, headshot, dir) {
    const e = enemy;
    if (!e || !e.active || e.dead || !(dmg > 0)) return 0;
    const frame = (game && game.clock && game.clock.frame) || 0;
    if (frame === e.lastDamageFrame && Math.abs(dmg - e.lastDamageAmount) < 1e-6) return 0;
    e.lastDamageFrame = frame;
    e.lastDamageAmount = dmg;

    e.health -= dmg;
    if (dir && dir.lengthSq && dir.lengthSq() > 1e-8) {
      _dmgDir.copy(dir).normalize();
      e.lastDamageDir.copy(_dmgDir);
    } else {
      playerEye(_v0);
      _dmgDir.copy(e.chestWorld).sub(_v0);
      if (_dmgDir.lengthSq() < 1e-8) _dmgDir.set(0, 0, 1);
      _dmgDir.normalize();
      e.lastDamageDir.copy(_dmgDir);
    }

    // Flinch: resolve the impact into the soldier's own frame so a hit from the left throws
    // him to the right, not always backwards.
    const cosF = Math.cos(e.facing);
    const sinF = Math.sin(e.facing);
    const fwd = -_dmgDir.x * sinF - _dmgDir.z * cosF;
    const right = _dmgDir.x * cosF - _dmgDir.z * sinF;

    // WHERE the round landed, in his own frame: `high` runs −1 at the boots to +1 at the head,
    // `lat` is +1 out on his right. Direction alone gives every hit the same animation, so a
    // headshot and a round through the calf played identically — which is exactly what makes a
    // procedural reaction read as procedural. Height picks the mix of torso pitch against hip
    // fold and knee collapse; lateral offset picks the roll and which arm snaps.
    let high = 0.35;
    let lat = 0;
    if (point) {
      high = clamp((point.y - (e.groundY + 0.95 * e.scale)) / (0.62 * e.scale), -1, 1);
      _v1.copy(point).sub(e.chestWorld);
      lat = clamp((_v1.x * cosF - _v1.z * sinF) / (0.22 * e.scale), -1, 1);
    }
    const highW = clamp(high * 0.5 + 0.5, 0, 1);
    const mag = clamp(dmg / 34, 0.12, 1.35) * (headshot ? 1.5 : 1);
    e.flinchPitchV += fwd * mag * (4.5 + highW * 5.5);
    e.flinchYawV += right * mag * 6.0;
    e.flinchRollV += (lat * 0.7 + right * 0.5) * mag * 5.5;
    // Low hit: the leg gives. A separate, slower spring from the torso flinch, because a knee
    // buckles and recovers rather than snapping back.
    if (high < -0.15) e.buckleV += mag * (0.15 - high) * 5.0;
    // And the limb that was actually struck jerks with it.
    if (highW > 0.35 && Math.abs(lat) > 0.45) {
      const jerk = clamp(lat, -1, 1) * Math.min(mag, 1) * 0.8;
      if (lat > 0) e.armJerkR += jerk;
      else e.armJerkL += jerk;
    }
    e.stagger = Math.min(1, e.stagger + mag * 0.55);
    // A hit moves a man. Steering damps this out inside about 0.15 m, but the displacement is
    // what makes the flinch land instead of being a wobble on the spot.
    e.velocity.addScaledVector(_dmgDir, mag * 0.85);
    e.velocity.y = 0;
    // A stagger costs him accuracy and a fraction of a second of his burst.
    e.aimAge = Math.max(0, e.aimAge - 0.22 * mag);
    e.suppressedBy = Math.min(1, e.suppressedBy + mag * 0.3);
    if (e.fireTimer < 0.08) e.fireTimer = 0.08 + mag * 0.1;

    // Being shot at is perfect information about where you are.
    playerEye(e.lastKnown);
    e.hasTarget = true;
    e.awareness = 1;
    if (e.alert < 2) {
      e.alert = 2;
      e.reactTimer = Math.min(e.reactTimer > 0 ? e.reactTimer : 1, 0.22 + e.rng() * 0.12);
      e.aimAge = 0;
      e.reinforceTimer = 0.25;
    }
    e.lastSeenTime = (game && game.clock && game.clock.time) || 0;
    if (e.state === 'idle' || e.state === 'patrol' || e.state === 'investigate') setState(e, 'advance');

    game.audio?.playOneShot?.(headshot ? 'enemyHitHead' : 'enemyHit', {
      position: point || e.chestWorld,
      volume: 0.7,
    });

    if (e.health <= 0) {
      killEnemy(e, !!headshot, _dmgDir, dmg, point);
      return dmg;
    }
    return dmg;
  }

  function killEnemy(e, headshot, dir, dmg, point) {
    if (e.dead) return;
    e.dead = true;
    e.deathTime = 0;
    e.health = 0;
    e.burstLeft = 0;
    e.state = 'dead';
    e.headshotKill = headshot;
    // Impulse scales with the hit, and a headshot snaps the neck back harder. The hit point
    // goes in too: off-centre wounds torque the body so it turns as it falls (see
    // ragdollCapture), which is what stops every death being the same vertical collapse.
    const impulse = clamp(dmg * 0.055, 0.8, 4.5) * (headshot ? 1.55 : 1);
    ragdollCapture(e, dir, impulse, e.groundY, point || e.chestWorld);

    const st = game && game.state;
    if (st) {
      st.kills = (st.kills || 0) + 1;
      st.streak = (st.streak || 0) + 1;
      st.score = (st.score || 0) + (headshot ? 150 : 100);
    }
    events?.emit?.('kill', {
      enemy: e,
      headshot,
      weapon: (game && game.weapon && game.weapon.current) || null,
      point: e.chestWorld,
    });
    game.audio?.playOneShot?.('enemyDeath', { position: e.chestWorld, volume: 0.8 });

    // The rest of the squad notices a man go down.
    for (let i = 0; i < enemies.length; i++) {
      const o = enemies[i];
      if (o === e || !o.active || o.dead) continue;
      if (o.position.distanceToSquared(e.position) > 625) continue; // 25 m
      o.lastKnown.copy(e.lastKnown);
      o.hasTarget = true;
      o.awareness = Math.max(o.awareness, 0.5);
      if (o.alert < 1) o.alert = 1;
      o.suppressedBy = Math.min(1, o.suppressedBy + 0.25);
    }
  }

  function onHitEvent(payload) {
    if (!payload || !payload.enemy) return;
    const e = payload.enemy;
    if (typeof e.index !== 'number' || enemies[e.index] !== e) return;
    damageEnemy(e, payload.damage || 0, payload.point, !!payload.headshot, payload.dir);
  }

  /* --- hit testing --------------------------------------------------------- */

  /**
   * Ray against every living soldier. Broadphase sphere first, then the six zone capsules.
   * Returns a shared result object (copy anything you keep) or null.
   */
  function raycastEnemies(origin, dir, maxDist) {
    let bestT = maxDist === undefined ? Infinity : maxDist;
    let found = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active || e.dead) continue;
      const sphereT = raySphere(origin, dir, e.boundCentre, e.boundRadius);
      if (sphereT < 0 || sphereT > bestT) continue;
      for (let z = 0; z < HIT_ZONES.length; z++) {
        const zone = HIT_ZONES[z];
        const r = ZONE_RADIUS[zone] * e.scale;
        raySegment(origin, dir, e.zoneA[z], e.zoneB[z], _rcOut);
        if (_rcOut.d2 > r * r) continue;
        // Step back from the closest-approach point onto the capsule surface.
        const back = Math.sqrt(Math.max(0, r * r - _rcOut.d2));
        let t = _rcOut.t - back;
        if (t < 0) t = 0; // muzzle inside the capsule — still a hit, at zero range
        if (t >= bestT) continue;
        bestT = t;
        found = true;
        _hitResult.enemy = e;
        _hitResult.distance = t;
        _hitResult.zone = zone;
        _hitResult.headshot = zone === 'head';
        _hitResult.multiplier = ZONE_MULT[zone];
        _hitResult.point.copy(origin).addScaledVector(dir, t);
        _v0.copy(e.zoneA[z]).lerp(e.zoneB[z], _rcOut.s);
        _hitResult.normal.copy(_hitResult.point).sub(_v0);
        if (_hitResult.normal.lengthSq() < 1e-8) _hitResult.normal.copy(dir).negate();
        else _hitResult.normal.normalize();
      }
    }
    return found ? _hitResult : null;
  }

  /* --- per-frame ----------------------------------------------------------- */

  let aliveCount = 0;

  function writeInstances(e) {
    const b = e.bones;
    for (let s = 0; s < SEG_COUNT; s++) {
      if (s === SEG.cover && !e.hasCover) {
        meshes[s].setMatrixAt(e.index, HIDDEN);
        continue;
      }
      meshes[s].setMatrixAt(e.index, b[SEG_BONE[s]].matrixWorld);
    }
  }

  function update(dt, g) {
    if (disposed) return;
    if (g) game = g;
    const now = (game.clock && game.clock.time) || 0;
    const step = Math.min(dt, 1 / 20);

    if (!spawnedInitial) {
      spawnedInitial = true;
      targetAlive = Math.min(maxLive, TARGET_ALIVE_MIN + ((rng() * 3) | 0));
      spawnWave(targetAlive);
    }

    // Suppression decays fast once the rounds stop; the HUD and camera read it from state.
    suppression = Math.max(0, suppression - step * 0.85);
    if (game.state) {
      game.state.suppression = suppression;
      // Extra screen shake while pinned. Small — the player must still be able to fight back.
      if (suppression > 0.05) game.player?.addTrauma?.(suppression * suppression * step * 0.55);
    }

    servicePathQueue();

    playerFeet(_v3);
    updateFireTokens(step);
    aliveCount = 0;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active) continue;

      if (e.dead) {
        e.deathTime += step;
        if (e.rdActive) {
          // Freeze once settled: a body at rest costs nothing but the instance write.
          if (e.rdTime < 1.9) {
            ragdollStep(e, step);
            ragdollPose(e);
            writeInstances(e);
          } else if (e.deathTime > 5.0) {
            // Sink and retire, so corpses never accumulate into a draw-call problem.
            const sink = step * 0.32;
            for (let p = 0; p < RD_COUNT; p++) {
              e.rdPos[p * 3 + 1] -= sink;
              e.rdPrev[p * 3 + 1] -= sink;
            }
            e.rdGround -= sink;
            ragdollPose(e);
            writeInstances(e);
            if (e.deathTime > 7.2) despawn(e);
          }
        } else if (e.deathTime > 6.5) despawn(e);
        continue;
      }

      aliveCount++;

      perceive(e, step, now);
      updateAimIntent(e, step, now);
      think(e, step, now);
      updateGait(e, step, level());

      // Animation LOD: distant soldiers pose at half rate. The gait clock still advances, so
      // nothing drifts — only the matrix write is skipped.
      const distSq = e.position.distanceToSquared(_v3);
      e.animRate = distSq > 2500 ? 0.5 : 1; // 50 m
      e.animAccum += step * (e.animRate === 1 ? 1 : 0.5);
      if (e.animRate === 1 || e.animAccum >= 1 / 30) {
        if (e.animRate !== 1) e.animAccum = 0;
        poseEnemy(e, step, level(), clamp(e.readyWeight * 1.15, 0, 1));
        writeInstances(e);
      }
    }

    for (let s = 0; s < SEG_COUNT; s++) meshes[s].instanceMatrix.needsUpdate = true;

    // Respawn trickle — keeps the fight alive without a wave-clear lull.
    if (aliveCount < targetAlive) {
      respawnTimer -= step;
      if (respawnTimer <= 0) {
        if (spawnEnemy(null)) {
          respawnTimer = 2.6 + rng() * 1.8;
        } else {
          respawnTimer = 1.0;
        }
      }
    } else {
      respawnTimer = Math.max(respawnTimer, 1.6);
      if (aliveCount >= TARGET_ALIVE_MAX) targetAlive = Math.min(targetAlive, TARGET_ALIVE_MAX);
      // Drift the target population so the pressure is not perfectly constant.
      if (rng() < step * 0.08) {
        targetAlive = clamp(
          TARGET_ALIVE_MIN + ((rng() * (TARGET_ALIVE_MAX - TARGET_ALIVE_MIN + 1)) | 0),
          TARGET_ALIVE_MIN,
          maxLive
        );
      }
    }

    ai.alive = aliveCount;
  }

  function spawnWave(n) {
    const want = Math.max(0, Math.min(n | 0, maxLive));
    let spawned = 0;
    for (let i = 0; i < enemies.length && spawned < want; i++) {
      let live = 0;
      for (let k = 0; k < enemies.length; k++) if (enemies[k].active && !enemies[k].dead) live++;
      if (live >= maxLive) break;
      if (spawnEnemy(null)) spawned++;
    }
    targetAlive = Math.max(targetAlive, Math.min(maxLive, want));
    return spawned;
  }

  function setQuality(q) {
    quality = q || quality;
    maxLive = quality === 'low' ? 7 : quality === 'medium' ? 9 : MAX_ENEMIES;
    pathBudget = quality === 'low' ? 1 : 2;
    fireCap = quality === 'low' ? 2 : 3;
    targetAlive = Math.min(targetAlive, maxLive);
  }

  /* --- wiring -------------------------------------------------------------- */

  const offShot = events?.on?.('shot', onShot);
  const offHit = events?.on?.('hit', onHitEvent);
  const offBoom = events?.on?.('explosion', onExplosion);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (typeof offShot === 'function') offShot();
    else events?.off?.('shot', onShot);
    if (typeof offHit === 'function') offHit();
    else events?.off?.('hit', onHitEvent);
    if (typeof offBoom === 'function') offBoom();
    else events?.off?.('explosion', onExplosion);
    for (let s = 0; s < SEG_COUNT; s++) {
      root.remove(meshes[s]);
      meshes[s].dispose();
      geometries[s].dispose();
    }
    material.dispose();
    lut.dispose();
    if (scene) scene.remove(root);
    enemies.length = 0;
    pathQueue.length = 0;
  }

  const ai = {
    /** Live pool. Entries with `active === false` are recycled slots, not soldiers. */
    enemies,
    root,
    material,
    alive: 0,
    update,
    spawnWave,
    damageEnemy,
    setQuality,
    dispose,
    /** Ray vs the squad's hit zones — ballistics' entry point for enemy hit detection. */
    raycast: raycastEnemies,
    hitTest: raycastEnemies,
    /** Current suppression pressure on the player, 0..1. Mirrored into game.state.suppression. */
    get suppression() {
      return suppression;
    },
    /** Zone damage multipliers, so ballistics and AI agree on what a headshot is worth. */
    zoneMultipliers: ZONE_MULT,
    archetypes: ARCHETYPES,
    weaponDefs: WEAPON_DEFS,
  };

  setQuality(quality);
  return ai;
}

export default createAI;
