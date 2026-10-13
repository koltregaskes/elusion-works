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
import { SHIPS, ROLE, FAMILY, hullFloorPx, HULL_FLOOR_MAX_GROW } from './catalog.js';
import { buildHullLevel, HULL_CLASSES } from './hulls.js';
import { KIND } from './greeble.js';
import { LAYER } from '../core/engine.js';
import { bus } from '../core/events.js';
import { HULL_HAZE_DEFINE } from '../render/atmosphere.js';

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
   a 380 m destroyer, and without it both would be issued the same plating.

   The `instanced` variant is asked for unconditionally, including for the three
   unbatched hulls that are drawn as plain Meshes, and that is deliberate.

   [MAT] defines `VS_ATTRIBS` only on the instanced material. That define is
   what declares the per-vertex `aVariant` attribute every part in greeble.js
   writes, and `aVariant` is what offsets the macro-texture slot — belt armour
   away from superstructure panelling away from exposed machinery. Without it
   `fv = uVariant` for every fragment on the model, so a 1,900 m mothership drew
   its entire skin from one macro layer: no panel-to-panel value change
   anywhere, which is exactly the "uniform grey albedo" the round-1 critique
   called out, and it hit the mothership, the carrier and the cruiser — the
   three hulls the eye spends longest on.

   Using the instanced material on a plain Mesh is safe. Three.js sets
   USE_INSTANCING per object, not per material, so the vertex path is unchanged;
   the two other attributes the define declares, `aDamage` and `aTeam`, are
   simply absent, and an absent attribute reads the generic default of 0 — which
   is the value the material's own contract already documents as the no-op. */
function hullMaterial(team, family, instanced, length) {
  const opts = length ? { length } : undefined;
  const m = callMat(MATLIB && MATLIB.getInstancedHullMaterial, team, family, opts)
    || (instanced ? null : callMat(MATLIB && MATLIB.getHullMaterial, team, family, opts));
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

/* `kind` is one of 'bell' | 'light' | 'window' | 'vent'.
   The rest are flat emitters; bells are meant to take an axial gradient.

   ── OPEN CONTRACT, for whoever owns render/materials.js ──────────────────
   The bell geometry ships a clean axial ramp and nothing reads it.
   `greeble.js:engineNozzle()` runs `axialV()` over both bell parts, writing
   **uv.y = 0 at the throat, 1 at the mouth**. Measured on the merged `bell`
   group of every class at every LOD (`.local/bellramp.mjs`): uv.y spans
   exactly 0..1, mean 0.5, and survives the merge.

   `getGlowMaterial(team,'bell')` currently derives heat from `dot( N, V )`
   and carries a comment saying hull geometry "arrives merged and unwrapped".
   For the bell group that is not true. `GLOW_KINDS.bell` is specified as
   "hot throat falling to the team's drive colour at the lip", so the term it
   wants is:

       heat = pow( 1.0 - vUv.y, uSharp );

   Until it does, the bore reads dead off-axis and only the lip ring lights,
   which is why FX has had to paper the throat over with a sprite from
   outside. SHIPS cannot fix this — materials.js is not ours to edit. */
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
   fighter dissolving below one pixel.

   Round 4 (critic round 3, fix 5) raised that floor from 2.3 px to 9-12 px of
   *hull length* (`hullFloorPx` in catalog.js, shared with FX). At 2.3 px the
   floor kept a fighter on screen but did not make it a ship: at 5 km the drive
   glow was a 7 px white blob and the hull a 3 px smudge inside it, so "the
   engine *is* the ship". The floor now binds on interceptors, corvettes and
   collectors at fleet range and on frigates only well past 10 km, and it
   rises gently with hull length so the classes it binds on still rank. It
   scales the hull's own silhouette about its centre, so a floored fighter is
   a 9 px sliver with its real proportions, not a disc. EngineFX moves the
   nozzles out with the same grow so the drive stays on the stern.

   This costs nothing. It replaces the hull material at the coarse levels
   rather than adding a pass, so the draw-call count is unchanged, and one
   `dot()` is cheaper per fragment than the PBR path it displaces. */

/** Levels at or beyond this draw as impostors. 2 == under ~55 screen px. */
const IMPOSTOR_LOD = 2;
/** Ceiling on the size floor, so nothing balloons out at 60 km. Shared with
    FX through catalog.js; the floor itself is `hullFloorPx(length)`. */
const IMPOSTOR_MAX_GROW = HULL_FLOOR_MAX_GROW;
/** Canopy glass stops resolving well before the blockout does. */
const GLASS_MAX_LOD = 1;
/** Shadow-side floor. Deep, but never zero — a hole reads as nothing.
    Chosen against measured backdrops: with the base below, the shadow side
    lands near 22/255 and the lit side near 75/255, while the nebula around
    the fleet runs 12–94. So the hull sits *inside* the backdrop's range and
    reads dark against gas and light against void, rather than picking one and
    disappearing into the other half of the sky. */
const IMPOSTOR_FILL = 0.10;

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
  // projectionMatrix[1][1] is 1 / tan( fovY / 2 ); half the viewport height
  // turns that into pixels per metre at one metre of depth. Taken from the
  // matrix rather than from camera.fov so a jittered projection is followed
  // exactly. The height is the canvas's *CSS* height when there is one: the
  // floor is a promise about how big a hull looks on screen, and FX sizes the
  // drive glow against the same CSS-pixel hull, so the two must agree whatever
  // the device pixel ratio or the post stack's internal render scale.
  const css = renderer.domElement && renderer.domElement.clientHeight;
  _impostorPx.value = camera.projectionMatrix.elements[5] * (css > 0 ? css : h) * 0.5;

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
  // Bone grey, pitched to straddle the backdrop rather than sit above it —
  // a hull brighter than the brightest gas stops being a silhouette. The team
  // lean is deliberately small: §3.3, colour comes from the engines and the
  // trim, never from the plating.
  const colour = new THREE.Color(0x6d747c);
  colour.lerp(pal.secondary, 0.16);

  /* The floor is on painted hull *length*; the shader measures the bounding
     radius, so convert: grow = minPxR / (R * s) and the painted length is
     L * s * grow, so minPxR = floorPx * R / L. */
  const def = SHIPS[classId];
  const R = Math.max(1e-3, radius);
  const L = def && def.length > 0 ? def.length : R * 2;
  const uniforms = {
    uPxScale: _impostorPx,
    uKeyDir: _impostorKey,
    uBoundR: { value: R },
    uMinPxR: { value: (hullFloorPx(L) * R) / L },
    uMaxGrow: { value: IMPOSTOR_MAX_GROW },
    uFill: { value: IMPOSTOR_FILL },
  };

  // Fogged like the full hulls, with the same hull cap, so a ship does not
  // pop out of the haze when it drops to the impostor.
  const m = new THREE.MeshBasicMaterial({ color: colour, fog: true });
  m.userData.impostor = true;
  // Exposed so a probe can sweep the size floor and the fill without a rebuild.
  // `uPxScale` and `uKeyDir` are the shared objects — writing them here would
  // hit every class at once, which is exactly what a sweep wants.
  m.userData.impostorUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${IMPOSTOR_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${IMPOSTOR_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFace;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= vFace;')
      .replace('#include <fog_pars_fragment>', `${HULL_HAZE_DEFINE}#include <fog_pars_fragment>`);
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

/* Geometry is per (class, team): the hostile yard builds its own hulls from the
   bone kit (bone.js), so each team's batch carries its own geometry and LODs.
   Gameplay size does not change with the shipyard — the hostile asset takes the
   player hull's radius, which is what the sim reads as the collision radius. */
function buildClass(classId, team = 0) {
  const t = team === 1 ? 1 : 0;
  const key = `${classId}:${t}`;
  let asset = _cache.get(key);
  if (asset) return asset;

  const def = SHIPS[classId];
  if (!def || HULL_CLASSES.indexOf(classId) < 0) return null;

  const base = buildHullLevel(classId, 0, null, t);
  if (!base) return null;
  const gameplay = t === 1 ? buildClass(classId, 0) : null;

  const levels = [base.geo];
  const tris = [base.tris];
  for (let d = 1; d < 4; d++) {
    const lvl = buildHullLevel(classId, d, base.xform, t);
    if (!lvl) break;
    levels.push(lvl.geo);
    tris.push(lvl.tris);
  }

  asset = {
    classId,
    team: t,
    def,
    levels,
    tris,
    radius: gameplay ? gameplay.radius : base.radius,
    visualRadius: base.radius,
    hardpoints: base.hardpoints,
    engines: base.engines,
    lights: base.lights,
    dock: base.dock,
  };
  _cache.set(key, asset);
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
  const asset = buildClass(classId, team);
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
  const asset = buildClass(classId, team);
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
  for (const id of HULL_CLASSES) {
    buildClass(id, 0);
    buildClass(id, 1);
  }
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
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _col = new THREE.Color();
const _hv = new THREE.Vector3();
const _hit4 = [0, 0, 0, 0];
const PROF_Z = 16;
const PROF_A = 12;

/* Stable render-side scatter for `addHit`; never touches the sim's RNG. */
function hash01(n) {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/* Hull hits feed the hit-local damage shading. Listening only: the event is
   read, never changed, so the sim stays deterministic. */
bus.on('sim:damage', (p) => {
  if (!p || p.shield) return;
  const e = p.entity;
  const rec = e && e._batchRec;
  if (rec && rec.batch && typeof rec.batch.addHit === 'function') rec.batch.addHit(e._slot, p.point);
});

class FleetBatch {
  constructor(classId, team) {
    this.classId = classId;
    this.team = team;
    this.asset = buildClass(classId, team);
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
    const slotCut = new Float32Array(capacity * 2);
    const slotWreck = new Uint8Array(capacity);
    if (oldCap) {
      slotMatrix.set(this.slotMatrix);
      slotColor.set(this.slotColor);
      slotDamage.set(this.slotDamage);
      slotLevel.set(this.slotLevel);
      slotIndex.set(this.slotIndex);
      slotCut.set(this.slotCut);
      slotWreck.set(this.slotWreck);
    }
    this.slotCut = slotCut;
    this.slotWreck = slotWreck;

    // Hit-local damage (R6): one row per slot in the shared hit texture, see
    // `addHit`. A grown batch takes a fresh range and carries its hits over.
    const slotHits = new Uint8Array(capacity);
    if (oldCap) slotHits.set(this.slotHits);
    this.slotHits = slotHits;
    const hitBase = MATLIB && MATLIB.allocHitRows
      ? MATLIB.allocHitRows(capacity, this.hullBox().max.z - this.hullBox().min.z) : 0;
    if (hitBase && oldCap && this.hitBase) MATLIB.copyHitRows(this.hitBase, hitBase, oldCap);
    this.hitBase = hitBase;
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
        // Wreck-section keel slice, see `setWreckSection`. (0, 0) = whole hull.
        const cut = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
        cut.setUsage(THREE.DynamicDrawUsage);
        im.geometry.setAttribute('aCut', cut);
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
        // Row of the shared hit texture, hull parts only (nothing else reads it).
        let row = null;
        if (kind === KIND.HULL) {
          row = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
          row.setUsage(THREE.DynamicDrawUsage);
          im.geometry.setAttribute('aHitRow', row);
        }
        level.parts.push({ mesh: im, damage: dmg, cut, row, kind });
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
    const wreck = this.slotWreck[slot] === 1;
    for (const p of level.parts) {
      // A wreck section is dark plating only: its lights, glass and drive
      // bells are collapsed to nothing rather than drawn whole across the cut.
      p.mesh.setMatrixAt(index, wreck && p.kind !== KIND.HULL ? _zero : _m4);
      p.mesh.setColorAt(index, _col);
      p.damage.array[index] = this.slotDamage[slot];
      p.cut.array[index * 2] = this.slotCut[slot * 2];
      p.cut.array[index * 2 + 1] = this.slotCut[slot * 2 + 1];
      if (p.row) p.row.array[index] = this.hitBase ? this.hitBase + slot : 0;
    }
    level.dirty = true;
  }

  /** LOD0 hull bounds in the hull's own space (the space `aCut` and the hit
      texture use). */
  hullBox() {
    if (!this._hullBox) {
      const g = this.asset.levels[0] && this.asset.levels[0].hull;
      if (g && !g.boundingBox) g.computeBoundingBox();
      this._hullBox = g && g.boundingBox ? g.boundingBox.clone()
        : new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    }
    return this._hullBox;
  }

  /** Mean radius off the keel axis of the LOD0 hull's vertices, binned by
      keel station (PROF_Z) and bearing (PROF_A). Built once per class. */
  hullProfile() {
    if (this._hullProfile) return this._hullProfile;
    const b = this.hullBox();
    const cx = (b.max.x + b.min.x) * 0.5;
    const cy = (b.max.y + b.min.y) * 0.5;
    const sz = Math.max(1e-3, b.max.z - b.min.z);
    const sum = new Float32Array(PROF_Z * PROF_A);
    const cnt = new Uint32Array(PROF_Z * PROF_A);
    const g = this.asset.levels[0] && this.asset.levels[0].hull;
    const pos = g && g.attributes && g.attributes.position;
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) - cx;
        const y = pos.getY(i) - cy;
        const zi = Math.min(PROF_Z - 1, Math.max(0, Math.floor(((pos.getZ(i) - b.min.z) / sz) * PROF_Z)));
        const a = Math.atan2(y, x) / (Math.PI * 2) + 0.5;
        const ai = Math.min(PROF_A - 1, Math.floor(a * PROF_A));
        sum[zi * PROF_A + ai] += Math.hypot(x, y);
        cnt[zi * PROF_A + ai]++;
      }
    }
    for (let k = 0; k < sum.length; k++) sum[k] = cnt[k] ? sum[k] / cnt[k] : 0;
    this._hullProfile = sum;
    return sum;
  }

  /**
   * Record a hull hit for the hit-local damage shading (R6). Render-side only:
   * reads the `sim:damage` point, never changes it. The sim reports the hit on
   * the target's bounding sphere along the shooter's bearing; that is brought
   * into hull space through the slot's own matrix, scattered along the keel so
   * a burst from one bearing marks several places on the facing side instead
   * of one, and pulled in onto the hull's bounds. A hit close to an existing
   * one deepens and re-heats that zone instead of starting a new one.
   */
  addHit(slot, point) {
    if (!this.hitBase || slot < 0 || slot >= this.capacity || !point) return;
    if (this.slotWreck[slot] === 1) return;
    const row = this.hitBase + slot;
    _m4.fromArray(this.slotMatrix, slot * 16).invert();
    _hv.copy(point).applyMatrix4(_m4);
    const b = this.hullBox();
    const sx = b.max.x - b.min.x;
    const sy = b.max.y - b.min.y;
    const sz = b.max.z - b.min.z;
    const cx = (b.max.x + b.min.x) * 0.5;
    const cy = (b.max.y + b.min.y) * 0.5;
    const cz = (b.max.z + b.min.z) * 0.5;
    const n = (this._hitSeq = (this._hitSeq || 0) + 1);
    const r1 = hash01(n * 3 + 1);
    const r3 = hash01(n * 3 + 3);
    // Bearing round the keel, scattered a little, and a station along it.
    const ang = Math.atan2(_hv.y - cy, _hv.x - cx) + (r1 - 0.5) * 1.1;
    const z = cz + Math.max(-0.46, Math.min(0.46, (_hv.z - cz) / sz + (r3 - 0.5) * 0.8)) * sz;
    // Onto the skin: the box is no use for that, since the masts and the
    // bridge make it far taller than the hull, so a hit would float above the
    // deck. The profile is the hull's mean radius per keel station and bearing.
    const prof = this.hullProfile();
    const zi = Math.min(PROF_Z - 1, Math.max(0, Math.floor(((z - b.min.z) / sz) * PROF_Z)));
    const ai = Math.min(PROF_A - 1, Math.max(0, Math.floor(((ang / (Math.PI * 2)) + 0.5 - Math.floor((ang / (Math.PI * 2)) + 0.5)) * PROF_A)));
    const rr = prof[zi * PROF_A + ai] || Math.min(sx, sy) * 0.4;
    _hv.set(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, z);
    // Merge into a nearby zone rather than spend a ring entry on it.
    const near = sz * 0.1;
    for (let k = 0; k < 8; k++) {
      MATLIB.readHit(row, k, _hit4);
      const dx = _hit4[0] - _hv.x;
      const dy = _hit4[1] - _hv.y;
      const dz = _hit4[2] - _hv.z;
      if (dx * dx + dy * dy + dz * dz < near * near) {
        MATLIB.writeHit(row, k, _hit4[0], _hit4[1], _hit4[2]);
        return;
      }
    }
    const k = this.slotHits[slot] % 8;
    this.slotHits[slot] = (k + 1) % 8;
    MATLIB.writeHit(row, k, _hv.x, _hv.y, _hv.z);
  }

  /** Turn a reserved slot into one section of a wreck: keep only the slice
      lo..hi of the hull's own keel (object-space z), and drop its emitters.
      Called again with a narrower slice to burn the section away at the end. */
  setWreckSection(slot, lo, hi) {
    if (slot < 0 || slot >= this.capacity) return;
    this.slotWreck[slot] = 1;
    this.slotCut[slot * 2] = lo;
    this.slotCut[slot * 2 + 1] = hi;
    const lv = this.slotLevel[slot];
    if (lv >= 0) this.writeInstance(this.levels[lv], this.slotIndex[slot], slot);
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
    this.slotCut[slot * 2] = 0;
    this.slotCut[slot * 2 + 1] = 0;
    this.slotWreck[slot] = 0;
    this.slotHits[slot] = 0;
    if (this.hitBase) MATLIB.resetHitRow(this.hitBase + slot);
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
    const wreck = this.slotWreck[slot] === 1;
    for (const p of level.parts) p.mesh.setMatrixAt(index, wreck && p.kind !== KIND.HULL ? _zero : matrix);
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
        p.cut.needsUpdate = true;
        if (p.row) p.row.needsUpdate = true;
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
  if (!buildClass(classId, team)) return null;
  batch = new FleetBatch(classId, team);
  _batches.set(key, batch);
  return batch;
}

/** What FX needs to cut a dead hull of this class into wreck sections: its
    keel extent in object space, and the finest-shaded level a section may sit
    on (the impostor levels do not take the cut, so sections stop short of
    them). Null if the class has no hull. */
export function wreckInfo(classId, team = 0) {
  const asset = buildClass(classId, team);
  const g = asset && asset.levels[0] && asset.levels[0].hull;
  if (!g) return null;
  if (!g.boundingBox) g.computeBoundingBox();
  return { zMin: g.boundingBox.min.z, zMax: g.boundingBox.max.z, maxLod: IMPOSTOR_LOD - 1 };
}

/**
 * Compile the shader programs of every batch that exists, off the main thread
 * where the driver allows it (`compileAsync`, KHR_parallel_shader_compile).
 *
 * Why (R9 fix 1): a program is otherwise linked on the first frame that draws
 * it, synchronously. An instanced hull is its own program (USE_INSTANCING), so
 * the first wreck of a class drawn only as a plain Mesh in play (carrier,
 * cruiser, mothership) linked the hull shader mid-battle: 0.9-1.0 s with no
 * frame. Call this at boot, after the batches are created.
 *
 * `offscreen`: the scene is drawn into a render target (the post stack), and
 * three keys a program on that (no tone mapping, linear output), so compile
 * against one too or the warmed program is not the one the frame uses.
 */
export function compileFleetBatches(renderer, scene, camera, offscreen = false) {
  if (!renderer || typeof renderer.compileAsync !== 'function' || !_fleetRoot.children.length) {
    return Promise.resolve(0);
  }
  const prev = renderer.getRenderTarget();
  const rt = offscreen ? new THREE.WebGLRenderTarget(1, 1) : null;
  let job;
  try {
    renderer.setRenderTarget(rt);
    job = renderer.compileAsync(_fleetRoot, camera, scene);
  } finally {
    renderer.setRenderTarget(prev);
  }
  return job.then(() => {
    if (rt) rt.dispose();
    return _fleetRoot.children.length;
  });
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
export function shipStats(classId, team = 0) {
  const asset = buildClass(classId, team);
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
    // Which levels have dropped to the impostor, and the screen size each level
    // is chosen for — the two numbers an art audit needs to know whether it is
    // looking at a lit hull or a mark.
    impostorFrom: IMPOSTOR_LOD,
    lodOnsetPx: LOD_STEPS.map((s) => (s > 0 ? Math.round((1080 / (2 * Math.tan(Math.PI * 24 / 180))) / s) : null)),
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
  // The impostors are ours, not [MAT]'s, so nothing else will free them.
  for (const m of _impostorCache.values()) m.dispose();
  _impostorCache.clear();
  _keyFound = false;
  _keyCountdown = 0;
}

export { HULL_CLASSES };
