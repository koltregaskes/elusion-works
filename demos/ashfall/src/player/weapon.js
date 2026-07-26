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
import { PALETTE, CAMERA } from '../world/art.js';

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
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, -1);

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
    const v = 1 + g * grain + w * wear;
    arr[i * 3] = v;
    arr[i * 3 + 1] = v * (1 + g * grain * 0.22);
    arr[i * 3 + 2] = v * (1 - g * grain * 0.18);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Simple camo blotching straight into vertex colours — used for the sleeve cuffs. */
function bakeCamo(geo, tones) {
  const pos = geo.getAttribute('position');
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
    const j = 1 + (hash3(x * 190, y * 190, z * 190) - 0.5) * 0.12;
    arr[i * 3] = c.r * j;
    arr[i * 3 + 1] = c.g * j;
    arr[i * 3 + 2] = c.b * j;
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
      const nm = borrowMap(game, borrow.from, 'normalMap', borrow.repeat || 6);
      const rm = borrowMap(game, borrow.from, 'roughnessMap', borrow.repeat || 6);
      if (nm) {
        m.normalMap = nm;
        m.normalScale.set(borrow.normalScale || 0.35, borrow.normalScale || 0.35);
      }
      if (rm) m.roughnessMap = rm;
    }
    if (env) m.envMap = env;
    m.name = 'vm:' + name;
    owned.push(m);
    return m;
  };

  const mats = {
    /* Receivers, barrel, bolt. Hard-anodised aluminium and phosphated steel. */
    gunmetal: make('gunmetal', {
      color: new THREE.Color(PALETTE.gunmetal),
      metalness: 0.94,
      roughness: 0.44,
    }, { from: 'gunmetal', repeat: 7, normalScale: 0.4 }),

    /* Barrel / bolt steel — darker, tighter, more specular than the anodised receiver. */
    steel: make('steel', {
      color: new THREE.Color(PALETTE.gunmetal).multiplyScalar(0.72),
      metalness: 1.0,
      roughness: 0.29,
    }, { from: 'gunmetal', repeat: 11, normalScale: 0.3 }),

    /* Wear points: charging-handle latch, bolt face, mag-catch, safety detent. */
    worn: make('worn', {
      color: new THREE.Color(PALETTE.steelBare).multiplyScalar(0.8),
      metalness: 1.0,
      roughness: 0.19,
    }),

    /* Handguard / stock polymer. */
    polymer: make('polymer', {
      color: new THREE.Color(PALETTE.gunPolymer),
      metalness: 0.03,
      roughness: 0.61,
    }, { from: 'gunPolymer', repeat: 8, normalScale: 0.55 }),

    /* Grip polymer: stippled, and the palm swell is polished by use. */
    grip: make('grip', {
      color: new THREE.Color(PALETTE.gunPolymer).multiplyScalar(0.88),
      metalness: 0.02,
      roughness: 0.78,
    }, { from: 'gunPolymer', repeat: 18, normalScale: 0.9 }),

    /* Tan furniture — the vector reads warmer than the mk18 at a glance. */
    tan: make('tan', {
      color: new THREE.Color(PALETTE.gunTan),
      metalness: 0.02,
      roughness: 0.66,
    }, { from: 'gunPolymer', repeat: 9, normalScale: 0.5 }),

    /* Oiled walnut for the dmr14. */
    wood: make('wood', {
      color: new THREE.Color(PALETTE.woodWeathered).multiplyScalar(1.05),
      metalness: 0.0,
      roughness: 0.42,
    }, { from: 'gunWood', repeat: 4, normalScale: 0.6 }),

    /* Buttpad, eyecup, cheek riser pad. */
    rubber: make('rubber', {
      color: new THREE.Color(PALETTE.gunRubber),
      metalness: 0.0,
      roughness: 0.92,
    }, { from: 'gunPolymer', repeat: 22, normalScale: 1.0 }),

    /* Brass, for the round visible at the port and the follower witness holes. */
    brass: make('brass', {
      color: new THREE.Color(PALETTE.brass),
      metalness: 1.0,
      roughness: 0.31,
    }),

    /* Gloves. */
    glove: make('glove', {
      color: new THREE.Color(PALETTE.gunPolymer).multiplyScalar(1.35),
      metalness: 0.0,
      roughness: 0.83,
    }, { from: 'fabric', repeat: 14, normalScale: 0.8 }),

    /* Knuckle guards and finger reinforcement — rubberised, slightly glossier. */
    gloveHard: make('gloveHard', {
      color: new THREE.Color(PALETTE.gunRubber).multiplyScalar(1.5),
      metalness: 0.0,
      roughness: 0.66,
    }),

    /* Sleeve, camouflaged via vertex colour. */
    sleeve: make('sleeve', {
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.95,
    }, { from: 'fabric', repeat: 10, normalScale: 0.7 }),

    /* Hazard-yellow selector markings and the odd stencilled detail. */
    marking: make('marking', {
      color: new THREE.Color(PALETTE.hazardYellow),
      metalness: 0.1,
      roughness: 0.55,
    }),

    /* Deep shadow inserts: ejection port recess, M-LOK slot bottoms, bore. */
    cavity: make('cavity', {
      color: new THREE.Color(0x08090a),
      metalness: 0.2,
      roughness: 0.95,
    }),
  };

  /* Optic glass. Transmission would be lovely and is far too expensive for a viewmodel that
     is on screen every frame; a low-opacity, low-roughness standard material with a strong
     env response sells it, and the coating disc below adds the tell-tale blue-magenta cast. */
  mats.glass = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.glass),
    metalness: 0.0,
    roughness: 0.045,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    envMapIntensity: 2.6,
  });
  if (env) mats.glass.envMap = env;
  owned.push(mats.glass);

  mats.coating = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.11, 0.16, 0.34),
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(mats.coating);

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
  // Beavertail / backstrap flare where the web of the hand sits — polished by use.
  asm.add(
    chamferBoxY(w * 1.04, 0.026, 0.014, { r: 0.006, bevel: 0.002 }),
    'polymer',
    { p: [x, y - 0.006, z - 0.0175], r: [rake - 0.22, 0, 0] }
  );
  // Grip cap with a lanyard loop.
  asm.add(
    chamferBoxY(w * 0.9, 0.008, 0.031, { r: 0.005, bevel: 0.0018 }),
    'polymer',
    { p: [x, y - len - 0.002, z + Math.sin(rake) * len], r: [rake, 0, 0] }
  );
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
  const teeth = Math.max(3, Math.round(len / 0.0102));
  for (let t = 0; t < teeth; t++) {
    const zz = z0 - 0.018 - (len - 0.034) * (t / (teeth - 1));
    asm.add(
      chamferBox(0.0206, 0.0042, 0.0058, { r: 0.0011, bevel: 0.0009, curveSegments: 2 }),
      'gunmetal',
      { p: [0, r * 0.92 + 0.0055, zz] }
    );
  }

  // Handstop / index block where the support thumb goes — visibly worn.
  asm.add(
    chamferBox(0.020, 0.011, 0.020, { r: 0.0035, bevel: 0.0018 }),
    'grip',
    { p: [0, -r * 0.92 - 0.004, z1 + len * 0.30], r: [0.10, 0, 0] }
  );
  // QD sling socket on both sides of the rear collar.
  asm.addMirrored(() => latheZ([[0.0034, z0 - 0.020], [0.0058, z0 - 0.020], [0.0058, z0 - 0.026], [0.0022, z0 - 0.026]], 10), 'gunmetal', {
    p: [r * 0.86, -0.004, 0],
    r: [0, Math.PI * 0.5, 0],
  });
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
  }
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
  // Gas tube, running rearwards from the block into the receiver. Profile z must descend.
  asm.add(latheZ([[0.0019, cfg.tubeZ], [0.0028, cfg.tubeZ], [0.0028, z + 0.004]], 10), 'worn', {
    p: [0, 0.0122, 0],
  });
  // Gas port set screw.
  asm.add(latheZ([[0.0022, z - 0.008], [0.0022, z - 0.011]], 8), 'worn', { p: [0, -0.0118, 0], r: [0, 0, 0] });
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
  // Witness holes: cavity inserts on the spine.
  for (let i = 1; i <= 3; i++) {
    const t = i / 4.2;
    asm.add(chamferBox(0.0042, 0.0042, 0.0022, { r: 0.0009, bevel: 0.0006, curveSegments: 3 }), 'cavity', {
      p: [w * 0.5 - 0.0004, -t * len, -curve * t * t * 0.055 + d * 0.30],
      r: [0, Math.PI * 0.5, 0],
    });
  }

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
  asm.add(chamferBox(0.030, 0.0165, kind === 'lpvo' ? 0.088 : 0.052, { r: 0.0035, bevel: 0.0022, curveSegments: 4 }), 'gunmetal', {
    p: [0, yc - tubeR - 0.0075, zc - (kind === 'lpvo' ? 0.010 : 0.000)],
  });
  asm.add(chamferBox(0.0355, 0.0075, kind === 'lpvo' ? 0.084 : 0.048, { r: 0.0028, bevel: 0.0018, curveSegments: 3 }), 'gunmetal', {
    p: [0, yc - tubeR - 0.0175, zc - (kind === 'lpvo' ? 0.010 : 0.000)],
  });
  asm.add(chamferBoxX(0.040, 0.0075, 0.010, { r: 0.0022, bevel: 0.0015, curveSegments: 3 }), 'worn', {
    p: [0.006, yc - tubeR - 0.0175, zc + 0.016],
  });
  // Rings.
  const ringZ = kind === 'lpvo' ? [zc + 0.028, zc - 0.030] : [zc + 0.004];
  for (const rz of ringZ) {
    asm.add(tubeZ(tubeR + 0.0042, tubeR - 0.0002, rz + 0.007, rz - 0.007, 20), 'gunmetal', { p: [0, yc, 0] });
    // Ring clamp screws, one each side.
    asm.addMirrored(() => latheY([[0.0021, 0], [0.0021, 0.0042], [0.0014, 0.0048]], 8), 'worn', {
      p: [tubeR + 0.0034, yc - 0.0055, rz],
      r: [0, 0, -Math.PI * 0.5],
    });
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
  asm.add(latheZ(profile, 24), 'gunmetal', { p: [0, yc, 0] });

  // Interior wall — deliberately near-black so the glass reads as a tunnel, not a disc.
  asm.add(tubeZ(glassR * 0.995, glassR * 0.94, back - 0.004, front + 0.004, 20), 'cavity', { p: [0, yc, 0] });

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
  asm.add(turret(), 'gunmetal', { p: [0, yc + tubeR - 0.001, turretZ], r: [Math.PI * 0.5, 0, 0] });
  asm.add(turret(), 'gunmetal', { p: [tubeR - 0.001, yc, turretZ], r: [0, -Math.PI * 0.5, 0] });
  if (kind === 'lpvo') {
    // Magnification ring with a throw lever.
    asm.add(latheZ([[tubeR * 1.10, back - 0.014], [tubeR * 1.10, back - 0.030]], 20), 'gunmetal', { p: [0, yc, 0] });
    asm.add(chamferBox(0.0075, 0.030, 0.011, { r: 0.0022, bevel: 0.0014, curveSegments: 3 }), 'polymer', {
      p: [tubeR * 1.10 + 0.012, yc + 0.006, back - 0.022],
      r: [0, 0, -0.5],
    });
  } else {
    // Brightness rheostat on the left of a red dot.
    asm.add(latheZ([[0.0058, 0], [0.0058, -0.008], [0.0074, -0.009], [0.0074, -0.016], [1e-4, -0.016]], 12), 'gunmetal', {
      p: [-tubeR + 0.001, yc, turretZ + 0.010],
      r: [0, Math.PI * 0.5, 0],
    });
  }

  // Rubber eyecup / killflash honeycomb rim.
  asm.add(latheZ([[tubeR * 0.98, back + 0.012], [tubeR * 1.14, back + 0.006], [tubeR * 1.14, back - 0.004], [tubeR * 0.98, back - 0.004]], 20), 'rubber', {
    p: [0, yc, 0],
  });
  asm.add(latheZ([[tubeR * 1.02, front - 0.001], [tubeR * 1.14, front - 0.004], [tubeR * 1.14, front - 0.012], [tubeR * 1.02, front - 0.010]], 20), 'rubber', {
    p: [0, yc, 0],
  });

  const group = asm.build(mats, { gunmetal: { grain: 0.06, wear: 0.11 } });
  group.name = 'optic';

  /* --- Glass: two discs, the ocular and the objective. -------------------- */
  const glassGeo = new THREE.CircleGeometry(glassR, 24);
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

  // Anti-reflective coating flash — the blue-magenta cast every combat optic has.
  const coat = new THREE.Mesh(glassGeo, mats.coating);
  coat.position.set(0, yc, back - 0.0055);
  coat.scale.setScalar(0.985);
  coat.renderOrder = 9;
  coat.frustumCulled = false;
  group.add(coat);

  /* --- Reticle ------------------------------------------------------------ */
  const reticle = new THREE.Group();
  reticle.name = 'reticle';
  reticle.renderOrder = 12;

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
  const glow = new THREE.Mesh(new THREE.CircleGeometry(kind === 'lpvo' ? 6.5 : 3.4, 14), mats.reticleGlow);
  glow.position.z = -0.0002;
  reticle.add(glow);
  for (const c of reticle.children) c.frustumCulled = false;
  group.add(reticle);

  const sightAnchor = new THREE.Object3D();
  sightAnchor.name = 'sightAnchor';
  sightAnchor.position.set(0, yc, (back + front) * 0.5);
  group.add(sightAnchor);

  return { group, reticle, sightAnchor, glassR, back, front, yc };
}

/** Buffer tube / receiver extension with adjustment notches, plus a stock that slides on it. */
function buildStock(asm, cfg) {
  const z0 = cfg.z0; // front (at the receiver)
  const len = cfg.len || 0.215;
  const y = cfg.y || -0.001;
  const mat = cfg.mat || 'polymer';
  const tubeR = 0.0148;

  // Castle nut + end plate. Lathe profiles are authored rear-to-front so z descends.
  asm.add(latheZ([[0.0165, z0 + 0.011], [0.0195, z0 + 0.010], [0.0195, z0]], 14), 'worn', { p: [0, y, 0] });
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
  // Top rail with real teeth — runs the length of the upper.
  const teeth = Math.max(4, Math.round(upLen / 0.0102));
  asm.add(chamferBox(0.0215, 0.0055, upLen - 0.004, { r: 0.0018, bevel: 0.0013, curveSegments: 3 }), 'gunmetal', {
    p: [0, upH - 0.0135 + 0.0015, (upperZ0 + upperZ1) * 0.5],
  });
  for (let t = 0; t < teeth; t++) {
    const zz = upperZ0 - 0.006 - (upLen - 0.012) * (t / (teeth - 1));
    asm.add(chamferBox(0.0206, 0.0042, 0.0058, { r: 0.0011, bevel: 0.0009, curveSegments: 2 }), 'gunmetal', {
      p: [0, upH - 0.0135 + 0.0060, zz],
    });
  }
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

  /* --- Ejection port: recess + separate hinged dust cover ------------------ */
  const portZ = upperZ0 - 0.040;
  asm.add(chamferBox(0.0026, 0.019, 0.040, { r: 0.0022, bevel: 0.0012, curveSegments: 3 }), 'cavity', {
    p: [upW * 0.5 - 0.0022, 0.0015, portZ],
  });
  const dustCover = new THREE.Mesh(
    bakeVertexTint(chamferBox(0.0032, 0.0205, 0.0425, { r: 0.0026, bevel: 0.0014, curveSegments: 3 }), { grain: 0.07, wear: 0.13 }),
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

  /* --- Charging handle ---------------------------------------------------- */
  const chAsm = new Assembly();
  chAsm.add(chamferBox(0.030, 0.0095, 0.052, { r: 0.0022, bevel: 0.0015, curveSegments: 3 }), 'gunmetal', {
    p: [0, upH - 0.0135 - 0.005, upperZ0 - 0.020],
  });
  chAsm.add(chamferBox(0.014, 0.0135, 0.020, { r: 0.0032, bevel: 0.0018, curveSegments: 3 }), 'worn', {
    p: [-0.0155, upH - 0.0135 - 0.006, upperZ0 + 0.001],
    r: [0, 0, 0.16],
  });
  chAsm.add(chamferBoxX(0.020, 0.0075, 0.0075, { r: 0.0018, bevel: 0.0012, curveSegments: 2 }), 'worn', {
    p: [-0.0225, upH - 0.0135 - 0.006, upperZ0 + 0.001],
  });
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
  // Takedown pins.
  asm.addMirrored(() => latheZ([[0.0046, 0], [0.0046, -0.0022], [0.0036, -0.0028]], 10), 'worn', {
    p: [upW * 0.47, -0.0245, lowZ0 - 0.014],
    r: [0, Math.PI * 0.5, 0],
  });
  asm.addMirrored(() => latheZ([[0.0046, 0], [0.0046, -0.0022], [0.0036, -0.0028]], 10), 'worn', {
    p: [upW * 0.47, -0.0245, lowZ1 + 0.010],
    r: [0, Math.PI * 0.5, 0],
  });
  // Bolt catch (left) and magazine release (right).
  asm.add(chamferBox(0.0062, 0.0115, 0.030, { r: 0.0018, bevel: 0.0012, curveSegments: 3 }), 'worn', {
    p: [-upW * 0.5 + 0.001, -0.021, lowZ1 + 0.018],
    r: [0, 0, 0.05],
  });
  asm.add(latheZ([[0.0056, 0], [0.0056, -0.0055], [0.0042, -0.0062]], 10), 'worn', {
    p: [upW * 0.5 - 0.001, -0.021, lowZ1 + 0.026],
    r: [0, -Math.PI * 0.5, 0],
  });
  // Trigger-pin bosses.
  asm.add(chamferBoxX(upW * 0.98, 0.014, 0.020, { r: 0.0034, bevel: 0.0018 }), 'gunmetal', {
    p: [0, -0.030, lowZ1 + 0.044],
  });

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
    gunmetal: { grain: 0.075, wear: 0.10 },
    polymer: { grain: 0.11, wear: 0.06 },
    grip: { grain: 0.16, wear: 0.05 },
    steel: { grain: 0.055, wear: 0.14 },
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
      gripSupport: [0, -0.026, -0.300],
      boltCatch: [-0.026, -0.022, -0.090],
      sight: [0, optic.sightAnchor.position.y, optic.sightAnchor.position.z],
      magGrab: [0, -0.055, 0.004],
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
    gunmetal: { grain: 0.07, wear: 0.11 },
    tan: { grain: 0.13, wear: 0.09 },
    grip: { grain: 0.17, wear: 0.05 },
    steel: { grain: 0.055, wear: 0.15 },
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
      gripSupport: [0, -0.062, -0.250],
      boltCatch: [-0.028, -0.024, -0.100],
      sight: [0, optic.sightAnchor.position.y, optic.sightAnchor.position.z],
      magGrab: [0, -0.070, 0.002],
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
  // Steel barrel bands.
  for (const bz of [fgZ0 - 0.010, fgZ1 + 0.012]) {
    asm.add(chamferBox(0.049, 0.050, 0.012, { r: 0.0068, bevel: 0.0026, curveSegments: 4 }), 'gunmetal', {
      p: [0, -0.0005, bz],
    });
  }
  // Handguard top rail for the LPVO's forward reach and a sling swivel underneath.
  asm.add(ring(0.0072, 0.0021, 10, 5), 'gunmetal', { p: [0, -0.036, fgZ1 + 0.030], r: [0, Math.PI * 0.5, 0] });

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
    gunmetal: { grain: 0.07, wear: 0.10 },
    wood: { grain: 0.14, wear: 0.11 },
    grip: { grain: 0.16, wear: 0.05 },
    steel: { grain: 0.05, wear: 0.14 },
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
      gripSupport: [0, -0.034, -0.316],
      boltCatch: [-0.028, -0.024, -0.100],
      sight: [0, optic.sightAnchor.position.y, optic.sightAnchor.position.z],
      magGrab: [0, -0.052, 0.006],
    },
  };
}

/* ========================================================================== */
/* Arms                                                                       */
/* ========================================================================== */

/** One gloved hand, posed in a fixed grip curl. Fingers are separate meshes. */
function buildHand(mats, side) {
  const asm = new Assembly();
  const s = side; // +1 = right, -1 = left

  // Palm: a chamfered wedge, thicker at the thenar side.
  asm.add(chamferBox(0.042, 0.026, 0.078, { r: 0.010, bevel: 0.0038, curveSegments: 5 }), 'glove', {
    p: [0, 0, 0.006],
    r: [0, 0, 0],
  });
  // Back-of-hand knuckle guard.
  asm.add(chamferBox(0.040, 0.0075, 0.052, { r: 0.0055, bevel: 0.0026, curveSegments: 4 }), 'gloveHard', {
    p: [0, 0.0148, -0.004],
    r: [-0.10, 0, 0],
  });
  // Knuckle domes.
  for (let i = 0; i < 4; i++) {
    asm.add(latheY([[0.0055, 0], [0.0062, 0.0026], [0.0038, 0.0052], [1e-4, 0.0058]], 8), 'gloveHard', {
      p: [(-0.0145 + i * 0.0097) * s, 0.017, -0.028],
    });
  }
  // Wrist cuff transition.
  asm.add(latheZ([[0.0215, 0.036], [0.0235, 0.030], [0.0225, 0.022], [0.0205, 0.020]], 14), 'glove', null);

  // Four fingers, each two phalanges curled around the grip.
  for (let i = 0; i < 4; i++) {
    const fx = (-0.0148 + i * 0.0099) * s;
    const spread = (i - 1.5) * 0.05;
    const curl = 1.02 + i * 0.06;
    const r0 = 0.0062 - i * 0.0004;
    // Proximal.
    asm.add(chamferBox(r0 * 2, r0 * 2, 0.030, { r: r0 * 0.85, bevel: r0 * 0.4, curveSegments: 4 }), 'glove', {
      p: [fx, -0.004, -0.046],
      r: [-curl * 0.55, spread * s, 0],
    });
    // Distal, curled under.
    asm.add(chamferBox(r0 * 1.8, r0 * 1.8, 0.026, { r: r0 * 0.8, bevel: r0 * 0.38, curveSegments: 4 }), 'glove', {
      p: [fx + Math.sin(spread * s) * 0.012, -0.004 - Math.sin(curl * 0.55) * 0.026, -0.046 - Math.cos(curl * 0.55) * 0.024],
      r: [-curl * 1.32, spread * s, 0],
    });
    // Reinforced fingertip pad.
    asm.add(latheY([[0.0044, 0], [0.0048, 0.0022], [0.0028, 0.0044], [1e-4, 0.005]], 7), 'gloveHard', {
      p: [
        fx + Math.sin(spread * s) * 0.020,
        -0.004 - Math.sin(curl * 0.55) * 0.026 - Math.sin(curl * 1.32) * 0.022,
        -0.046 - Math.cos(curl * 0.55) * 0.024 - Math.cos(curl * 1.32) * 0.020,
      ],
      r: [-curl * 1.32 + Math.PI * 0.5, 0, 0],
    });
  }

  // Thumb: two segments wrapping the far side of the grip.
  asm.add(chamferBox(0.0135, 0.0125, 0.030, { r: 0.0052, bevel: 0.0024, curveSegments: 4 }), 'glove', {
    p: [-0.020 * s, -0.006, -0.020],
    r: [-0.42, 0.62 * s, 0.30 * s],
  });
  asm.add(chamferBox(0.0118, 0.0110, 0.028, { r: 0.0046, bevel: 0.0022, curveSegments: 4 }), 'glove', {
    p: [-0.030 * s, -0.010, -0.043],
    r: [-0.75, 1.02 * s, 0.34 * s],
  });

  const g = asm.build(mats, { glove: { grain: 0.12, wear: 0.05 }, gloveHard: { grain: 0.09, wear: 0.13 } });
  g.name = side > 0 ? 'handR' : 'handL';
  return g;
}

/**
 * A full arm: sleeve cuff + tapered forearm + upper arm + hand, ready for two-bone IK.
 * The hand is a child of the arm group but positioned in the arm group's local space.
 */
function buildArm(mats, side, lengths) {
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

  // Multicam-ish camo baked straight into the sleeve vertex colours.
  const tones = [PALETTE.gunPolymer, PALETTE.dirt, PALETTE.sandbag, PALETTE.weeds, PALETTE.woodWeathered];
  bakeCamo(upper.geometry, tones);
  bakeCamo(fore.geometry, tones);

  // Cuff: a rolled band at the wrist end of the forearm, darker fabric.
  const cuff = new THREE.Mesh(
    bakeVertexTint(latheY([[0.0300, 0], [0.0345, 0.006], [0.0350, 0.024], [0.0310, 0.030], [0.0295, 0.030]], 14), {
      grain: 0.13,
      wear: 0.04,
    }),
    mats.sleeve
  );
  bakeCamo(cuff.geometry, [PALETTE.gunPolymer, PALETTE.dirt, PALETTE.gunRubber]);
  cuff.position.y = lengths.fore - 0.030;
  cuff.frustumCulled = false;
  fore.add(cuff);

  const hand = buildHand(mats, side);

  group.add(upper, fore, hand);
  return { group, upper, fore, hand, lengths };
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
      /* Hip pose in camera space: right of centre, below the eyeline, cranked inboard. */
      hip: { p: [0.132, -0.118, -0.168], r: [0.020, -0.062, 0.028] },
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
      hip: { p: [0.128, -0.112, -0.150], r: [0.026, -0.070, 0.034] },
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
      hip: { p: [0.140, -0.124, -0.196], r: [0.016, -0.052, 0.024] },
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

  /* --- Viewmodel lighting fallback ---------------------------------------- */
  // The engine owns the viewmodel scene's lights. If it failed to build them the gun would
  // be a black silhouette, which is worse than double-lighting, so add a minimal rig.
  let ownLights = null;
  try {
    let hasLight = false;
    if (game.viewScene) game.viewScene.traverse((o) => { if (o.isLight) hasLight = true; });
    if (!hasLight) {
      ownLights = new THREE.Group();
      ownLights.name = 'viewmodelLightsFallback';
      const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 2.6);
      key.position.set(-0.6, 0.9, 0.5);
      const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.skyZenith), 0.9);
      fill.position.set(0.8, 0.4, 0.6);
      const bounce = new THREE.HemisphereLight(
        new THREE.Color(PALETTE.skyZenith),
        new THREE.Color(PALETTE.groundBounce),
        0.55
      );
      ownLights.add(key, fill, bounce);
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
      gripFire: mkAnchor(a.gripFire, null, [-0.30, 0.06, 0.10]),
      gripSupport: mkAnchor(a.gripSupport, null, [0.30, -0.10, -0.06]),
      boltCatch: mkAnchor(a.boltCatch, null, [0.10, -0.55, -0.25]),
      sight: mkAnchor(a.sight),
      magGrab: mkAnchor(a.magGrab, model.parts && model.parts.mag ? model.parts.mag : null, [0.25, -0.05, 0.0]),
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

    /* Sprint pose: canted down and inboard, muzzle low and left, arms dropped. This is a
       pose, not a rotation of the hip pose — the difference is what makes it read as the
       character relaxing rather than the camera tilting. */
    def.sprintPose = {
      p: [def.hip.p[0] + 0.030, def.hip.p[1] - 0.062, def.hip.p[2] + 0.030],
      r: [0.62, -0.66, -0.42],
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
  const armR = buildArm(mats, 1, { upper: 0.195, fore: 0.190 });
  const armL = buildArm(mats, -1, { upper: 0.300, fore: 0.280 });
  const armsGrp = new THREE.Group();
  armsGrp.name = 'arms';
  armsGrp.add(armR.group, armL.group);
  recoilGrp.add(armsGrp);
  applyLayer(armsGrp);

  // Shoulder sockets in camera space. Behind the near plane, so the upper arms enter frame
  // from off-screen rather than being sliced by it.
  const shoulderR = new THREE.Vector3(0.190, -0.258, 0.062);
  const shoulderL = new THREE.Vector3(-0.098, -0.262, 0.022);
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

    impScale: { pitch: 1, yaw: 1, roll: 1, pos: 1 },

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
    swayX: new Spring(90, 0.85),
    swayY: new Spring(90, 0.85),
    swayYaw: new Spring(70, 0.80),
    swayPitch: new Spring(70, 0.80),
    swayRoll: new Spring(55, 0.78),
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

    /* Impulse needed for a given peak excursion.
       For x'' + 2ζω x' + ω²x = 0 with x(0)=0, x'(0)=v, the first peak is
           x_peak = (v/ω) · exp(-ζ·acos(ζ)/√(1-ζ²)).
       Inverting that lets the recoil table above be authored in degrees of actual
       on-screen movement, and keeps those degrees honest if the stiffness is ever retuned. */
    state.impScale.pitch = impulseFor(d.recoil.stiff.pitch, d.recoil.zeta.pitch);
    state.impScale.yaw = impulseFor(d.recoil.stiff.yaw, d.recoil.zeta.yaw);
    state.impScale.roll = impulseFor(d.recoil.stiff.roll, d.recoil.zeta.roll);
    state.impScale.pos = impulseFor(d.recoil.stiff.pos, d.recoil.zeta.pos);

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
    if (state._sprintBlend === undefined) state._sprintBlend = 0;
    // Lazier into the sprint pose than out of it: ~0.19 s down, ~0.15 s back on target.
    state._sprintBlend += (sprintWant - state._sprintBlend) * approach(sprintWant ? 6.0 : 7.0, dt);
    const sb = smootherstep(state._sprintBlend);

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

    sway.position.set(sp.swayX.value + brX + bobX, sp.swayY.value + brY + bobY, 0);
    sway.rotation.set(sp.swayPitch.value, sp.swayYaw.value, sp.swayRoll.value + bobRoll);

    /* --- Recoil springs ---------------------------------------------------- */
    sp.pitch.step(dt);
    sp.yaw.step(dt);
    sp.roll.step(dt);
    sp.posZ.step(dt);
    sp.posY.step(dt);
    sp.posX.step(dt);

    recoilGrp.position.set(sp.posX.value, sp.posY.value, sp.posZ.value);
    recoilGrp.rotation.set(sp.pitch.value, sp.yaw.value, sp.roll.value);

    /* --- Pose blend: hip -> low-ready -> sprint -> ADS ---------------------- */
    state.idleTimer = weapon.firing || state.reloading || state.switching ? 0 : state.idleTimer + dt;
    const readyBlend = state.adsBlend > 0.02 ? 0 : smootherstep(clamp((state.idleTimer - 2.6) / 1.6, 0, 1));

    hipP.set(d.hip.p[0], d.hip.p[1], d.hip.p[2]);
    hipR.set(d.hip.r[0], d.hip.r[1], d.hip.r[2]);
    if (readyBlend > 0) {
      hipP.lerp(_v1.set(d.readyPose.p[0], d.readyPose.p[1], d.readyPose.p[2]), readyBlend);
      hipR.lerp(_v2.set(d.readyPose.r[0], d.readyPose.r[1], d.readyPose.r[2]), readyBlend);
    }

    if (sb > 0.001) {
      hipP.lerp(_v1.set(d.sprintPose.p[0], d.sprintPose.p[1], d.sprintPose.p[2]), sb);
      hipR.lerp(_v2.set(d.sprintPose.r[0], d.sprintPose.r[1], d.sprintPose.r[2]), sb);
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

    /* --- Reticle: parallax free ------------------------------------------- */
    const optic = parts.optic;
    if (optic && optic.reticle && gm.viewCamera) {
      const sa = optic.sightAnchor;
      sa.getWorldPosition(_v1);
      sa.getWorldQuaternion(_q1);
      _v2.copy(_fwd).applyQuaternion(_q1).normalize(); // optic's own boresight
      gm.viewCamera.getWorldPosition(_v3);
      const dist = Math.max(0.02, _v1.distanceTo(_v3));
      // Put the dot on the line "eye + boresight * dist". Its apparent direction is therefore
      // exactly the optic's boresight regardless of where the eye is — which is what a
      // collimated reticle does, and why the dot stays usable when the head is off axis.
      _v4.copy(_v3).addScaledVector(_v2, dist);
      optic.reticle.parent.worldToLocal(_v4);
      optic.reticle.position.copy(_v4);
      // Screen-aligned.
      gm.viewCamera.getWorldQuaternion(_q2);
      optic.reticle.parent.getWorldQuaternion(_q3);
      _q3.invert().multiply(_q2);
      optic.reticle.quaternion.copy(_q3);
      // Constant angular size: ~0.0035 rad half-width, roughly 4 px at 1080p in ADS.
      const s = dist * 0.0035 * scaleInv;
      optic.reticle.scale.setScalar(s);
      // The dot dims when you are not behind the glass — hipfire should not have a free aim
      // point floating over the screen.
      const vis = 0.22 + 0.78 * state.adsBlend;
      mats.reticle.opacity = vis;
      mats.reticleGlow.opacity = 0.5 * vis;
      optic.reticle.visible = true;
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

      /* Right arm. */
      armR.hand.position.copy(handTargetR);
      armR.hand.quaternion.copy(handQuatR);
      // The wrist sits behind the palm along the hand's own +Z.
      _v1.set(0, 0.006, 0.052).applyQuaternion(handQuatR).add(handTargetR);
      poleTmpR.copy(poleR);
      solveTwoBone(shoulderR, _v1, armR.lengths.upper, armR.lengths.fore, poleTmpR, elbowR, wristR);
      aimLimb(armR.upper, shoulderR, elbowR, _q1);
      aimLimb(armR.fore, elbowR, wristR, _q1);

      /* Left arm. */
      armL.hand.position.copy(handTargetL);
      armL.hand.quaternion.copy(handQuatL);
      _v1.set(0, 0.006, 0.052).applyQuaternion(handQuatL).add(handTargetL);
      // The support elbow tucks under the rifle; bias the pole with the gun's roll so it
      // follows the weapon when the gun cants during a reload.
      poleTmpL.copy(poleL);
      poleTmpL.applyAxisAngle(_fwd, channels.gunRoll * 0.6);
      solveTwoBone(shoulderL, _v1, armL.lengths.upper, armL.lengths.fore, poleTmpL, elbowL, wristL);
      aimLimb(armL.upper, shoulderL, elbowL, _q1);
      aimLimb(armL.fore, elbowL, wristL, _q1);
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
  state._sel = 0;
  state._sprintBlend = 0;

  return weapon;
}

export default createWeapon;
