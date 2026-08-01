/* Ship model registry.

   Geometry is built once per class and shared by every hull that ever flies —
   a skirmish can ask for eight hundred interceptors, and all of them point at
   the same four buffers. Only the THREE.Mesh wrappers are per-ship, and those
   cost nothing.

   Each class returns a THREE.LOD with four levels inside a plain Group:

     0  full detail        every greeble, every window, every barrel
     1  ~35% triangles     coarse greeble subset, fewer barrel facets
     2  chamfered blockout primary and secondary masses only
     3  distant            decimated primary loft, a few dozen triangles

   Level 1+ redraw the ship from the same seed rather than decimating level 0,
   so the coarse levels are genuinely the same vessel with detail removed. */

import * as THREE from '../../vendor/three/build/three.module.js';
import { SHIPS, ROLE, FAMILY } from './catalog.js';
import { buildHullLevel, HULL_CLASSES } from './hulls.js';
import { KIND } from './greeble.js';
import { LAYER } from '../core/engine.js';

/* ------------------------------------------------------- material bridge */

/* [MAT] owns render/materials.js and may not have landed yet. Import it
   defensively and keep a small standalone fallback so the ship viewer, and any
   agent testing in isolation, still renders something honest. */
let MATLIB = null;
try {
  MATLIB = await import('../render/materials.js');
} catch (err) {
  MATLIB = null;
}

const FALLBACK_TEAM_COLORS = [
  {
    primary: new THREE.Color(0x8d949c),
    secondary: new THREE.Color(0x5d6570),
    engine: new THREE.Color(0x63d4ff),
    trim: new THREE.Color(0x2fa8d8),
    light: new THREE.Color(0xdff2ff),
  },
  {
    primary: new THREE.Color(0x9a9186),
    secondary: new THREE.Color(0x6b5f53),
    engine: new THREE.Color(0xff9a3c),
    trim: new THREE.Color(0xc4552c),
    light: new THREE.Color(0xffe3c2),
  },
];

export const TEAM_COLORS = (MATLIB && MATLIB.TEAM_COLORS) || FALLBACK_TEAM_COLORS;

const FAMILY_TINT = {
  [FAMILY.LANCER]: 0xa8aeb4,
  [FAMILY.BULWARK]: 0x8f9298,
  [FAMILY.MONOLITH]: 0x9ba099,
};

const _fallbackCache = new Map();

function fallbackMaterial(key, make) {
  let m = _fallbackCache.get(key);
  if (!m) {
    m = make();
    _fallbackCache.set(key, m);
  }
  return m;
}

function callMat(fn, ...args) {
  if (!fn) return null;
  try {
    const m = fn(...args);
    return m && m.isMaterial ? m : null;
  } catch (err) {
    return null;
  }
}

/* `length` drives plate density: the `bulwark` family spans a 46 m collector to
   a 380 m destroyer, and without it both would be issued the same plating. */
function hullMaterial(team, family, instanced, length) {
  const opts = length ? { length } : undefined;
  const m = instanced
    ? callMat(MATLIB && MATLIB.getInstancedHullMaterial, team, family, opts)
    : callMat(MATLIB && MATLIB.getHullMaterial, team, family, opts);
  if (m) return m;
  return fallbackMaterial(`hull:${team}:${family}:${instanced ? 1 : 0}`, () => {
    const c = TEAM_COLORS[team] || FALLBACK_TEAM_COLORS[0];
    const base = new THREE.Color(FAMILY_TINT[family] || 0x9aa0a6);
    base.lerp(c.primary, 0.35);
    return new THREE.MeshStandardMaterial({
      color: base,
      roughness: 0.72,
      metalness: 0.28,
      envMapIntensity: 0.6,
    });
  });
}

/* `kind` is one of 'bell' | 'light' | 'window' | 'vent'. Bells take an axial
   gradient off the 0..1 V the nozzle now writes; the rest are flat emitters. */
function glowMaterial(team, kind) {
  const m = callMat(MATLIB && MATLIB.getGlowMaterial, team, kind)
    || callMat(MATLIB && MATLIB.getEngineMaterial, team);
  if (m) return m;
  return fallbackMaterial(`glow:${team}:${kind}`, () => {
    const c = TEAM_COLORS[team] || FALLBACK_TEAM_COLORS[0];
    return new THREE.MeshBasicMaterial({
      color: c.engine.clone(),
      toneMapped: false,
      // Additive emitters must never write depth: TAA and DoF read that buffer.
      depthWrite: false,
    });
  });
}

function glassMaterial(team) {
  const m = callMat(MATLIB && MATLIB.getGlassMaterial, team);
  if (m) return m;
  return fallbackMaterial(`glass:${team}`, () => new THREE.MeshStandardMaterial({
    color: 0x0d1620,
    roughness: 0.12,
    metalness: 0.9,
    envMapIntensity: 1.4,
  }));
}

/* ------------------------------------------------------ distant impostor */

/* Iteration 5 measured a 560-hull fleet and found no silhouette in it: at
   5,000 m every ship produced the same bright teardrop whether it was a 14 m
   interceptor or a 130 m frigate, and at 16,000 m the fleet was pure glow.

   The cause is not the LOD cull. Measured on the built geometry, the primary
   loft survives at every level — a level-3 hull still has a bounding box
   exactly `SHIPS[id].length` long. What fails is screen coverage:

     LOD 3 begins at 70 hull lengths, which at a 48 deg FOV is 17 px wide
     for *every* class, and runs down from there. An interceptor at 5 km is
     3.4 px and at 16 km is 1.06 px — under one pixel. A physically lit hull
     that small averages to a value indistinguishable from the void, and the
     drive bloom, which is a fixed screen size, then writes straight over it.

   So the coarse levels stop trying to be lit models and become a deliberate
   mark: one key-lit term with a hard terminator and a floor under the shadow
   side, at a value chosen to sit across the range the backdrop occupies. The
   lit side reads against the void, the shadow side reads against the nebula,
   and the ship is a shape either way instead of a value that happens to
   average into the background. A floor on the painted size then stops a
   fighter dissolving below one pixel. That floor only binds under ~2.3 px, so
   it never touches a frigate or a capital and the ranking by hull length —
   which is the whole of §3.4 — survives.

   This costs nothing. It replaces the hull material at the coarse levels
   rather than adding a pass, so the draw-call count is unchanged, and one
   `dot()` is cheaper per fragment than the PBR path it displaces. */

/** Levels at or beyond this draw as impostors. 2 == under ~55 screen px. */
const IMPOSTOR_LOD = 2;
/** Minimum painted diameter, in device pixels, for an impostor hull. */
const IMPOSTOR_MIN_PX = 2.3;
/** Ceiling on the size floor, so nothing balloons out at 60 km. */
const IMPOSTOR_MAX_GROW = 2.4;
/** Canopy glass stops resolving well before the blockout does. */
const GLASS_MAX_LOD = 1;
/** Shadow-side floor. Deep, but never zero — a hole reads as nothing. */
const IMPOSTOR_FILL = 0.20;

/* Shared uniform objects: one write per frame serves every impostor material.
   `uPxScale` is pixels per metre at one metre of view depth; `uKeyDir` is the
   key star in view space. */
const _impostorPx = { value: 600 };
const _impostorKey = { value: new THREE.Vector3(0, 0, 1) };
const _vp = new THREE.Vector4();
const _dbSize = new THREE.Vector2();
const _keyWorld = new THREE.Vector3(0, 0, 1);
let _keyFound = false;
let _keyCountdown = 0;

/* The key star belongs to [ENV] and its direction is not on any frozen API, so
   read it out of the scene rather than duplicating a constant that would then
   silently drift. Read-only, and only every couple of seconds. */
function scanKeyLight(scene) {
  if (!scene || !scene.traverseVisible) return;
  let best = null;
  let bestPower = -1;
  scene.traverseVisible((o) => {
    if (!o.isDirectionalLight) return;
    const c = o.color;
    const power = o.intensity * (c ? c.r + c.g + c.b : 1);
    if (power > bestPower) { bestPower = power; best = o; }
  });
  if (!best) return;
  best.getWorldPosition(_keyWorld);
  if (best.target) {
    const t = new THREE.Vector3();
    best.target.getWorldPosition(t);
    _keyWorld.sub(t);
  }
  if (_keyWorld.lengthSq() < 1e-9) _keyWorld.set(0, 0, 1);
  _keyWorld.normalize();
  _keyFound = true;
}

/* Object3D.onBeforeRender fires once per mesh per pass, and it is the only
   hook into the frame that SHIPS owns — nothing here may reach into main.js. */
function impostorBeforeRender(renderer, scene, camera) {
  if (!renderer || !camera || !camera.isPerspectiveCamera) return;

  let h = 0;
  if (typeof renderer.getCurrentViewport === 'function') {
    renderer.getCurrentViewport(_vp);
    h = _vp.w;
  }
  if (!(h > 0)) h = renderer.getDrawingBufferSize(_dbSize).y;
  // projectionMatrix[1][1] is 1 / tan( fovY / 2 ); half the viewport height in
  // device pixels turns that into pixels per metre at one metre of depth. Taken
  // from the matrix rather than from camera.fov so a post stack that renders at
  // a reduced scale, or jitters the projection for TAA, is followed exactly.
  _impostorPx.value = camera.projectionMatrix.elements[5] * h * 0.5;

  if (_keyCountdown-- <= 0) {
    scanKeyLight(scene);
    _keyCountdown = _keyFound ? 120 : 8;
  }
  _impostorKey.value.copy(_keyWorld).transformDirection(camera.matrixWorldInverse);
}

const IMPOSTOR_PARS = /* glsl */`
uniform float uPxScale;
uniform float uBoundR;
uniform float uMinPxR;
uniform float uMaxGrow;
uniform float uFill;
uniform vec3 uKeyDir;
varying float vFace;
`;

/* Runs immediately after <project_vertex>, so `mvPosition` is the view-space
   position and gl_Position has not yet been touched by the log-depth chunk. */
const IMPOSTOR_VERT = /* glsl */`
{
  vec4 vsCtr = vec4( 0.0, 0.0, 0.0, 1.0 );
  #ifdef USE_INSTANCING
    vsCtr = instanceMatrix * vsCtr;
  #endif
  vsCtr = modelViewMatrix * vsCtr;

  float vsDepth = max( 1.0, -vsCtr.z );
  float vsPxR = uBoundR * uPxScale / vsDepth;
  float vsGrow = clamp( uMinPxR / max( vsPxR, 1e-4 ), 1.0, uMaxGrow );

  vec4 vsPos = mvPosition;
  /* Lateral only. Every vertex keeps the depth it already had, so a widened
     hull can never push itself in front of its own drive bells and kill the
     glow that carries team colour at this range. */
  vsPos.xy = vsCtr.xy + ( mvPosition.xy - vsCtr.xy ) * vsGrow;
  gl_Position = projectionMatrix * vsPos;

  mat3 vsNm = normalMatrix;
  #ifdef USE_INSTANCING
    mat3 vsIm = mat3( instanceMatrix );
    vec3 vsSq = vec3( dot( vsIm[ 0 ], vsIm[ 0 ] ), dot( vsIm[ 1 ], vsIm[ 1 ] ), dot( vsIm[ 2 ], vsIm[ 2 ] ) );
    vsNm = vsNm * mat3( vsIm[ 0 ] / vsSq.x, vsIm[ 1 ] / vsSq.y, vsIm[ 2 ] / vsSq.z );
  #endif
  vec3 vsN = normalize( vsNm * normal );
  float vsNdl = clamp( dot( vsN, uKeyDir ), 0.0, 1.0 );
  /* One key light, hard terminator, deep but never black on the shadow side —
     §3.2 stated in the only two numbers a mark this small can carry. */
  vFace = uFill + ( 1.0 - uFill ) * ( vsNdl * vsNdl * ( 3.0 - 2.0 * vsNdl ) );
}
`;

const _impostorCache = new Map();

/**
 * The mark a hull becomes once it is a few tens of pixels wide or less.
 * One material per (class, team) — they all compile to the same program, and
 * the per-class uniform is the bounding radius the size floor works from.
 */
function impostorMaterial(team, classId, radius) {
  const key = `${team}:${classId}`;
  const hit = _impostorCache.get(key);
  if (hit) return hit;

  const pal = TEAM_COLORS[team] || FALLBACK_TEAM_COLORS[0];
  // Bone grey, straddling the backdrop: lit side above the brightest gas,
  // shadow side below it. The team lean is deliberately small — §3.3, colour
  // comes from the engines and the trim, never from the hull.
  const colour = new THREE.Color(0x8d949c);
  colour.lerp(pal.secondary, 0.16);

  const uniforms = {
    uPxScale: _impostorPx,
    uKeyDir: _impostorKey,
    uBoundR: { value: Math.max(1e-3, radius) },
    uMinPxR: { value: IMPOSTOR_MIN_PX * 0.5 },
    uMaxGrow: { value: IMPOSTOR_MAX_GROW },
    uFill: { value: IMPOSTOR_FILL },
  };

  const m = new THREE.MeshBasicMaterial({ color: colour, fog: false });
  m.userData.impostor = true;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${IMPOSTOR_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${IMPOSTOR_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFace;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= vFace;');
  };
  // Every impostor shares one program; only the uniforms differ.
  m.customProgramCacheKey = () => 'vs-impostor';

  _impostorCache.set(key, m);
  return m;
}

/* -------------------------------------------------------------- LOD table */

/* Multipliers on hull length. A 14 m interceptor drops to the blockout at
   ~310 m, which is well inside the 8 km battle radius; a 1,900 m mothership
   effectively never leaves level 0 while it is on screen at all. */
const LOD_STEPS = [0, 6, 22, 70];
const LOD_HYSTERESIS = 0.08;

/**
 * The LOD level a ship should draw at, given camera distance in metres.
 *
 * Batched hulls do not go through `THREE.LOD` — nothing walks the graph to
 * update them — so the level has to be chosen by the caller and pushed with
 * `batch.setLod()`. Exported so SIM picks exactly the same thresholds the
 * individual path uses; an unbatched fighter and a batched one at the same
 * range must not be drawing different geometry.
 */
export function pickLod(classId, distance, current = -1) {
  const def = SHIPS[classId];
  if (!def) return 0;
  const t = distance / def.length;
  let want = 0;
  for (let i = LOD_STEPS.length - 1; i > 0; i--) {
    if (t >= LOD_STEPS[i]) { want = i; break; }
  }
  /* Hysteresis. `THREE.LOD` gets this for free; the batched path has to be
     given it, and it matters more here than it used to, because level 2 is
     where the hull swaps to the impostor shading. A ship parked on the
     boundary would otherwise change shading model every frame. */
  if (current >= 0 && want !== current) {
    const edge = LOD_STEPS[want > current ? want : current];
    if (want > current ? t < edge * (1 + LOD_HYSTERESIS) : t > edge * (1 - LOD_HYSTERESIS)) {
      return current;
    }
  }
  return want;
}

/* ------------------------------------------------------------------ cache */

const _cache = new Map();

function buildClass(classId) {
  let asset = _cache.get(classId);
  if (asset) return asset;

  const def = SHIPS[classId];
  if (!def || HULL_CLASSES.indexOf(classId) < 0) return null;

  const base = buildHullLevel(classId, 0, null);
  if (!base) return null;

  const levels = [base.geo];
  const tris = [base.tris];
  for (let d = 1; d < 4; d++) {
    const lvl = buildHullLevel(classId, d, base.xform);
    if (!lvl) break;
    levels.push(lvl.geo);
    tris.push(lvl.tris);
  }

  asset = {
    classId,
    def,
    levels,
    tris,
    radius: base.radius,
    hardpoints: base.hardpoints,
    engines: base.engines,
    lights: base.lights,
    dock: base.dock,
  };
  _cache.set(classId, asset);
  return asset;
}

/* Every level is three merged submeshes, and which is which has to be
   discoverable from outside: [MAT] needs to find the emissive group to swap a
   material on to it, [FX] needs to know what already blooms, and an audit
   walking the scene graph should not have to infer it from material identity.
   Hence the name and the userData tag rather than bare indices. */
function tagged(geo, material, kind, level) {
  const m = new THREE.Mesh(geo, material);
  m.name = kind;
  m.userData.kind = kind;
  m.userData.lodLevel = level;
  m.userData.emissive = kind === KIND.GLOW;
  return m;
}

/* Emissive submeshes go on LAYER.GLOW.
   The near-scene bloom threshold is scene-referred at 2.8 linear, and a 4×
   emissive of a mid hull grey is only ~2.0 — under the cut. So an emissive
   left on the default layer produces no bloom at all, which at fleet range is
   indistinguishable from having no emissive: it is exactly why 560 hulls
   showed no drive glow. On the glow layer it blooms via a separate 0.6 cut
   regardless of absolute level. */
function asGlow(mesh) {
  mesh.layers.set(LAYER.GLOW);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function levelGroup(asset, index, team) {
  const g = new THREE.Group();
  g.name = `${asset.classId}:L${index}`;
  g.userData.lodLevel = index;
  const geo = asset.levels[index];
  const impostor = index >= IMPOSTOR_LOD;
  if (geo.hull) {
    const mat = impostor
      ? impostorMaterial(team, asset.classId, asset.radius)
      : hullMaterial(team, asset.def.family, false, asset.def.length);
    const mesh = tagged(geo.hull, mat, KIND.HULL, index);
    // A dilated hull must not cast a dilated shadow, and at this size there is
    // nothing in the shadow worth having.
    mesh.castShadow = !impostor;
    mesh.receiveShadow = !impostor;
    mesh.userData.impostor = impostor;
    if (impostor) mesh.onBeforeRender = impostorBeforeRender;
    g.add(mesh);
  }
  if (geo.glass && index <= GLASS_MAX_LOD) g.add(tagged(geo.glass, glassMaterial(team), KIND.GLASS, index));
  if (geo.glow) {
    g.add(asGlow(tagged(geo.glow, glowMaterial(team, 'light'), KIND.GLOW, index)));
  }
  if (geo.bell) {
    g.add(asGlow(tagged(geo.bell, glowMaterial(team, 'bell'), KIND.BELL, index)));
  }
  return g;
}

/* --------------------------------------------------------------- public */

/**
 * Build a ready-to-fly model.
 * @param {string} classId key in SHIPS
 * @param {number} team 0 player, 1 enemy
 * @param {object} [rng] seeded stream; used only to scatter running-light
 *        phase, never geometry — hulls come from `SHIPS[classId].modelSeed`.
 */
export function buildShipModel(classId, team = 0, rng = null) {
  const asset = buildClass(classId);
  if (!asset) return null;

  const group = new THREE.Group();
  group.name = classId;

  const lod = new THREE.LOD();
  const step = asset.def.length;
  for (let i = 0; i < asset.levels.length; i++) {
    lod.addLevel(levelGroup(asset, i, team), LOD_STEPS[i] * step, LOD_HYSTERESIS);
  }
  group.add(lod);

  const jitter = rng && rng.next ? rng.next() : 0;
  return {
    group,
    lod,
    radius: asset.radius,
    hardpoints: asset.hardpoints.map((v) => v.clone()),
    engines: asset.engines.map((e) => ({
      pos: e.pos.clone(),
      dir: e.dir.clone(),
      radius: e.radius,
    })),
    lights: asset.lights.map((l, i) => ({
      pos: l.pos.clone(),
      colour: l.colour.clone(),
      period: l.period,
      phase: (jitter + i * 0.37) % 1,
    })),
    dockPoints: asset.dock.map((v) => v.clone()),
  };
}

/**
 * Instanced batch for a class that appears in numbers. Fighters draw from the
 * level-1 geometry — at the range a swarm is ever seen, the difference is not
 * visible and the triangle saving is.
 */
export function buildInstancedBatch(classId, team = 0, count = 1, rng = null) {
  const asset = buildClass(classId);
  if (!asset) return null;

  const swarm = asset.def.role === ROLE.FIGHTER || asset.def.role === ROLE.CORVETTE;
  const index = Math.min(asset.levels.length - 1, swarm ? 1 : 0);
  const geo = asset.levels[index];

  const mesh = new THREE.Group();
  mesh.name = `${classId}:batch`;
  const parts = [];

  const push = (g, mat, shadow, kind) => {
    if (!g) return;
    const im = new THREE.InstancedMesh(g, mat, count);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = shadow;
    im.receiveShadow = shadow;
    im.frustumCulled = false;
    im.name = kind;
    im.userData.kind = kind;
    im.userData.emissive = kind === KIND.GLOW;
    mesh.add(im);
    parts.push(im);
  };

  push(geo.hull, hullMaterial(team, asset.def.family, true, asset.def.length), true, KIND.HULL);
  push(geo.glass, glassMaterial(team), false, KIND.GLASS);
  // Was `engineMaterial(team)`, which is not a symbol in this module — the
  // first call would have thrown. This entry point has no callers (SIM uses
  // getFleetBatch), which is why it never surfaced.
  push(geo.glow, glowMaterial(team, 'light'), false, KIND.GLOW);
  push(geo.bell, glowMaterial(team, 'bell'), false, KIND.BELL);

  const _c = new THREE.Color();
  return {
    mesh,
    count,
    radius: asset.radius,
    hardpoints: asset.hardpoints,
    engines: asset.engines,
    lights: asset.lights,
    setMatrixAt(i, m) {
      for (let p = 0; p < parts.length; p++) parts[p].setMatrixAt(i, m);
    },
    setColorAt(i, c) {
      _c.set(c);
      for (let p = 0; p < parts.length; p++) parts[p].setColorAt(i, _c);
    },
    setCount(n) {
      for (let p = 0; p < parts.length; p++) parts[p].count = Math.min(n, count);
    },
    commit() {
      for (let p = 0; p < parts.length; p++) {
        parts[p].instanceMatrix.needsUpdate = true;
        if (parts[p].instanceColor) parts[p].instanceColor.needsUpdate = true;
        parts[p].computeBoundingSphere();
      }
    },
    dispose() {
      for (let p = 0; p < parts.length; p++) parts[p].dispose();
      parts.length = 0;
      mesh.clear();
    },
  };
}

/** Pre-build every class so the first frame of a skirmish does not hitch. */
export function warmShipCache(rng = null) {
  for (const id of HULL_CLASSES) buildClass(id);
  return _cache.size;
}

/* ========================================================== fleet batching */

/* Draw-call submission, not triangle count, is what caps unit count: one
   Object3D per ship costs ~2.9 calls each, so a thousand units is ~2,900 calls
   per frame and no WebGL 2 context holds that. Every class that appears in
   numbers is therefore drawn from a per-(class, team) InstancedMesh set, and
   the cost becomes a handful of calls no matter how many ships are alive.

   The tricky part of the contract is that a slot must survive an LOD change.
   Each LOD level keeps its own *compact* instance buffer — no gaps, so
   `mesh.count` is exactly what is drawn — and a slot carries a stable logical
   id that maps into whichever level it currently sits in. Moving between
   levels is a swap-remove from one and an append to the other, both O(1).
   The slot's transform, colour and damage are held here as the source of
   truth so a move can rewrite them without the caller being involved. */

/** Unique hulls appear once or twice a side; they stay individual Object3Ds so
    they can carry bespoke detail and per-ship damage. Everything else batches. */
const UNBATCHED = new Set(['mothership', 'carrier', 'cruiser']);

export function classBatches(classId) {
  return HULL_CLASSES.indexOf(classId) >= 0 && !UNBATCHED.has(classId);
}

/* A distinct BufferGeometry that reuses the cached geometry's attribute
   objects. Same GPU buffers, but each InstancedMesh gets somewhere private to
   hang its own instanced attributes — sharing the geometry outright would make
   team 0 and team 1 fight over `aDamage`. */
function shareGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.attributes[name]);
  if (src.index) g.setIndex(src.index);
  src.computeBoundingSphere();
  g.boundingSphere = src.boundingSphere.clone();
  g.boundingBox = src.boundingBox ? src.boundingBox.clone() : null;
  return g;
}

const _fleetRoot = new THREE.Group();
_fleetRoot.name = 'fleet:batches';
_fleetRoot.frustumCulled = false;

/** The group every batch lives in. Add it to `engine.scene` once. */
export function fleetRoot() {
  return _fleetRoot;
}

/** Convenience for the bootstrap: parents the batch root into a scene. */
export function setFleetScene(scene) {
  if (scene && _fleetRoot.parent !== scene) scene.add(_fleetRoot);
  return _fleetRoot;
}

const INITIAL_CAPACITY = 64;
const _m4 = new THREE.Matrix4();
const _col = new THREE.Color();

class FleetBatch {
  constructor(classId, team) {
    this.classId = classId;
    this.team = team;
    this.asset = buildClass(classId);
    this.capacity = 0;
    this.levels = [];
    this.group = new THREE.Group();
    this.group.name = `${classId}:${team}:batch`;
    this.group.frustumCulled = false;
    _fleetRoot.add(this.group);

    this.freeSlots = [];
    this.nextSlot = 0;
    this.live = 0;
    this.grow(INITIAL_CAPACITY);
  }

  /** Rebuild every InstancedMesh at a larger capacity, preserving slot state.
      Geometric growth, so this runs a handful of times over a whole match. */
  grow(capacity) {
    const old = this.levels;
    const oldCap = this.capacity;
    this.capacity = capacity;

    const slotMatrix = new Float32Array(capacity * 16);
    const slotColor = new Float32Array(capacity * 3).fill(1);
    const slotDamage = new Float32Array(capacity);
    const slotLevel = new Int32Array(capacity).fill(-1);
    const slotIndex = new Int32Array(capacity).fill(-1);
    if (oldCap) {
      slotMatrix.set(this.slotMatrix);
      slotColor.set(this.slotColor);
      slotDamage.set(this.slotDamage);
      slotLevel.set(this.slotLevel);
      slotIndex.set(this.slotIndex);
    }
    this.slotMatrix = slotMatrix;
    this.slotColor = slotColor;
    this.slotDamage = slotDamage;
    this.slotLevel = slotLevel;
    this.slotIndex = slotIndex;

    this.levels = [];
    for (let i = 0; i < this.asset.levels.length; i++) {
      const geo = this.asset.levels[i];
      const level = {
        parts: [],
        count: old[i] ? old[i].count : 0,
        indexToSlot: new Int32Array(capacity).fill(-1),
        dirty: true,
      };
      if (old[i]) level.indexToSlot.set(old[i].indexToSlot);

      const make = (src, material, kind, shadow) => {
        if (!src) return;
        const im = new THREE.InstancedMesh(shareGeometry(src), material, capacity);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
        im.instanceColor.setUsage(THREE.DynamicDrawUsage);
        // Per-instance battle damage for [MAT]. Harmless if unread.
        const dmg = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
        dmg.setUsage(THREE.DynamicDrawUsage);
        im.geometry.setAttribute('aDamage', dmg);
        im.castShadow = shadow;
        im.receiveShadow = shadow;
        // Instances are scattered across the whole battle volume, so a bounding
        // sphere round the batch is meaningless — cull per entity in the sim.
        im.frustumCulled = false;
        im.count = level.count;
        im.visible = level.count > 0;
        im.name = `${this.classId}:${kind}:L${i}`;
        im.userData.kind = kind;
        im.userData.lodLevel = i;
        im.userData.emissive = kind === KIND.GLOW || kind === KIND.BELL;
        if (im.userData.emissive) asGlow(im);
        if (material.userData && material.userData.impostor) {
          im.userData.impostor = true;
          im.onBeforeRender = impostorBeforeRender;
        }
        this.group.add(im);
        level.parts.push({ mesh: im, damage: dmg, kind });
      };

      const impostor = i >= IMPOSTOR_LOD;
      make(
        geo.hull,
        impostor
          ? impostorMaterial(this.team, this.classId, this.asset.radius)
          : hullMaterial(this.team, this.asset.def.family, true, this.asset.def.length),
        KIND.HULL,
        !impostor,
      );
      if (i <= GLASS_MAX_LOD) make(geo.glass, glassMaterial(this.team), KIND.GLASS, false);
      make(geo.glow, glowMaterial(this.team, 'light'), KIND.GLOW, false);
      make(geo.bell, glowMaterial(this.team, 'bell'), KIND.BELL, false);
      this.levels.push(level);
    }

    // Repopulate the new buffers from the retained slot state.
    for (let s = 0; s < oldCap; s++) {
      const lv = this.slotLevel[s];
      if (lv >= 0 && this.levels[lv]) this.writeInstance(this.levels[lv], this.slotIndex[s], s);
    }

    for (const lvl of old) {
      for (const p of lvl.parts) {
        this.group.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.dispose();
      }
    }
  }

  writeInstance(level, index, slot) {
    if (index < 0) return;
    _m4.fromArray(this.slotMatrix, slot * 16);
    _col.setRGB(this.slotColor[slot * 3], this.slotColor[slot * 3 + 1], this.slotColor[slot * 3 + 2]);
    for (const p of level.parts) {
      p.mesh.setMatrixAt(index, _m4);
      p.mesh.setColorAt(index, _col);
      p.damage.array[index] = this.slotDamage[slot];
    }
    level.dirty = true;
  }

  addToLevel(slot, lv) {
    const level = this.levels[lv];
    if (!level) return;
    const index = level.count++;
    level.indexToSlot[index] = slot;
    this.slotIndex[slot] = index;
    this.slotLevel[slot] = lv;
    this.writeInstance(level, index, slot);
    for (const p of level.parts) {
      p.mesh.count = level.count;
      p.mesh.visible = true;
    }
  }

  removeFromLevel(slot) {
    const lv = this.slotLevel[slot];
    if (lv < 0) return;
    const level = this.levels[lv];
    const index = this.slotIndex[slot];
    const last = level.count - 1;
    // Swap-remove: the tail instance drops into the hole so the buffer stays
    // compact and `mesh.count` remains exactly what gets drawn.
    if (index !== last && last >= 0) {
      const moved = level.indexToSlot[last];
      level.indexToSlot[index] = moved;
      this.slotIndex[moved] = index;
      this.writeInstance(level, index, moved);
    }
    level.count = Math.max(0, last);
    level.indexToSlot[level.count] = -1;
    level.dirty = true;
    for (const p of level.parts) {
      p.mesh.count = level.count;
      p.mesh.visible = level.count > 0;
    }
    this.slotLevel[slot] = -1;
    this.slotIndex[slot] = -1;
  }

  reserve() {
    const slot = this.freeSlots.length ? this.freeSlots.pop() : this.nextSlot++;
    if (slot >= this.capacity) this.grow(this.capacity * 2);
    _m4.identity().toArray(this.slotMatrix, slot * 16);
    this.slotColor[slot * 3] = 1;
    this.slotColor[slot * 3 + 1] = 1;
    this.slotColor[slot * 3 + 2] = 1;
    this.slotDamage[slot] = 0;
    this.live++;
    this.addToLevel(slot, 0);
    return slot;
  }

  release(slot) {
    if (slot < 0 || slot >= this.capacity) return;
    if (this.slotLevel[slot] < 0 && this.freeSlots.indexOf(slot) >= 0) return;
    this.removeFromLevel(slot);
    this.freeSlots.push(slot);
    this.live--;
  }

  setMatrix(slot, matrix) {
    if (slot < 0 || slot >= this.capacity) return;
    matrix.toArray(this.slotMatrix, slot * 16);
    const lv = this.slotLevel[slot];
    if (lv < 0) return;
    const level = this.levels[lv];
    const index = this.slotIndex[slot];
    for (const p of level.parts) p.mesh.setMatrixAt(index, matrix);
    level.dirty = true;
  }

  setLod(slot, lv) {
    if (slot < 0 || slot >= this.capacity) return;
    const want = Math.max(0, Math.min(this.levels.length - 1, lv | 0));
    if (this.slotLevel[slot] === want) return;
    this.removeFromLevel(slot);
    this.addToLevel(slot, want);
  }

  /** Convenience wrapper so the caller never has to hold the LOD table. The
      slot's current level is fed back in so `pickLod` can apply hysteresis —
      SIM has no idea what level a slot is on, and should not have to. */
  setLodFromDistance(slot, distance) {
    if (slot < 0 || slot >= this.capacity) return;
    this.setLod(slot, pickLod(this.classId, distance, this.slotLevel[slot]));
  }

  setColor(slot, colour) {
    if (slot < 0 || slot >= this.capacity) return;
    _col.set(colour);
    this.slotColor[slot * 3] = _col.r;
    this.slotColor[slot * 3 + 1] = _col.g;
    this.slotColor[slot * 3 + 2] = _col.b;
    const lv = this.slotLevel[slot];
    if (lv < 0) return;
    const level = this.levels[lv];
    for (const p of level.parts) p.mesh.setColorAt(this.slotIndex[slot], _col);
    level.dirty = true;
  }

  setDamage(slot, value) {
    if (slot < 0 || slot >= this.capacity) return;
    const v = value < 0 ? 0 : value > 1 ? 1 : value;
    this.slotDamage[slot] = v;
    const lv = this.slotLevel[slot];
    if (lv < 0) return;
    const level = this.levels[lv];
    for (const p of level.parts) p.damage.array[this.slotIndex[slot]] = v;
    level.dirty = true;
  }

  commit() {
    for (const level of this.levels) {
      if (!level.dirty) continue;
      for (const p of level.parts) {
        p.mesh.instanceMatrix.needsUpdate = true;
        if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
        p.damage.needsUpdate = true;
      }
      level.dirty = false;
    }
  }

  get meshes() {
    const out = [];
    for (const level of this.levels) for (const p of level.parts) out.push(p.mesh);
    return out;
  }

  dispose() {
    for (const level of this.levels) {
      for (const p of level.parts) {
        this.group.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.dispose();
      }
    }
    this.levels.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

const _batches = new Map();

/**
 * The instanced draw batch for one class and team. Created on first use and
 * kept for the life of the match — never build one per frame.
 */
export function getFleetBatch(classId, team = 0) {
  const key = `${classId}:${team}`;
  let batch = _batches.get(key);
  if (batch) return batch;
  if (!buildClass(classId)) return null;
  batch = new FleetBatch(classId, team);
  _batches.set(key, batch);
  return batch;
}

/** Flush every dirty instance buffer. Call once per frame, after the sim has
    written its transforms. */
export function commitAllBatches() {
  for (const batch of _batches.values()) batch.commit();
}

/** Live instance counts per batch — for the HUD, and for proving the draw-call
    curve is flat. */
export function fleetBatchStats() {
  const out = [];
  for (const [key, batch] of _batches) {
    out.push({
      key,
      live: batch.live,
      capacity: batch.capacity,
      levels: batch.levels.map((l) => l.count),
      drawCalls: batch.levels.reduce((n, l) => n + (l.count > 0 ? l.parts.length : 0), 0),
    });
  }
  return out;
}

export function disposeFleetBatches() {
  for (const batch of _batches.values()) batch.dispose();
  _batches.clear();
}

/* ------------------------------------------------------------ diagnostics */

/** Triangle counts and metadata per LOD level. Used by the ship viewer and by
    anyone auditing the draw budget. Not part of the frozen contract. */
export function shipStats(classId) {
  const asset = buildClass(classId);
  if (!asset) return null;
  const tri = (g) => (g && g.getAttribute('position') ? g.getAttribute('position').count / 3 : 0);
  const lvl0 = asset.levels[0];
  const mask = lvl0.hull && lvl0.hull.getAttribute('aTeamMask');
  let masked = 0;
  if (mask) for (let i = 0; i < mask.count; i++) if (mask.getX(i) > 0.5) masked++;
  return {
    classId,
    length: asset.def.length,
    family: asset.def.family,
    radius: asset.radius,
    levels: asset.tris.slice(),
    groups: asset.levels.map((g) => [g.hull ? 1 : 0, g.glass ? 1 : 0, g.glow ? 1 : 0, g.bell ? 1 : 0].reduce((a, v) => a + v, 0)),
    // Per-kind counts so an audit can measure emissive coverage and team-mask
    // coverage directly rather than inferring either from the material.
    hullTris: tri(lvl0.hull),
    glowTris: tri(lvl0.glow),
    glassTris: tri(lvl0.glass),
    teamMaskPct: mask ? Math.round((masked / mask.count) * 1000) / 10 : 0,
    greebleSize: Math.round(0.35 * Math.pow(asset.def.length / 14, 0.45) * 100) / 100,
    hardpoints: asset.hardpoints.length,
    engines: asset.engines.length,
    lights: asset.lights.length,
    dock: asset.dock.length,
  };
}

/** Free every cached buffer and fallback material. Geometry is shared, so no
    individual ship model may dispose it — only this. */
export function disposeShipCache() {
  for (const asset of _cache.values()) {
    for (const level of asset.levels) {
      for (const k of [KIND.HULL, KIND.GLASS, KIND.GLOW, KIND.BELL]) {
        if (level[k]) level[k].dispose();
      }
    }
  }
  _cache.clear();
  for (const m of _fallbackCache.values()) m.dispose();
  _fallbackCache.clear();
}

export { HULL_CLASSES };
