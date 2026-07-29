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

function hullMaterial(team, family, instanced) {
  const m = instanced
    ? callMat(MATLIB && MATLIB.getInstancedHullMaterial, team, family)
    : callMat(MATLIB && MATLIB.getHullMaterial, team, family);
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

function engineMaterial(team) {
  const m = callMat(MATLIB && MATLIB.getEngineMaterial, team);
  if (m) return m;
  return fallbackMaterial(`engine:${team}`, () => {
    const c = TEAM_COLORS[team] || FALLBACK_TEAM_COLORS[0];
    return new THREE.MeshBasicMaterial({ color: c.engine.clone(), toneMapped: false });
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

/* -------------------------------------------------------------- LOD table */

/* Multipliers on hull length. A 14 m interceptor drops to the blockout at
   ~310 m, which is well inside the 8 km battle radius; a 1,900 m mothership
   effectively never leaves level 0 while it is on screen at all. */
const LOD_STEPS = [0, 6, 22, 70];
const LOD_HYSTERESIS = 0.08;

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

function levelGroup(asset, index, team) {
  const g = new THREE.Group();
  const geo = asset.levels[index];
  if (geo.hull) {
    const mesh = new THREE.Mesh(geo.hull, hullMaterial(team, asset.def.family, false));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  if (geo.glass) g.add(new THREE.Mesh(geo.glass, glassMaterial(team)));
  if (geo.glow) {
    const m = new THREE.Mesh(geo.glow, engineMaterial(team));
    m.castShadow = false;
    m.receiveShadow = false;
    g.add(m);
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

  const push = (g, mat, shadow) => {
    if (!g) return;
    const im = new THREE.InstancedMesh(g, mat, count);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = shadow;
    im.receiveShadow = shadow;
    im.frustumCulled = false;
    mesh.add(im);
    parts.push(im);
  };

  push(geo.hull, hullMaterial(team, asset.def.family, true), true);
  push(geo.glass, glassMaterial(team), false);
  push(geo.glow, engineMaterial(team), false);

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

/* ------------------------------------------------------------ diagnostics */

/** Triangle counts and metadata per LOD level. Used by the ship viewer and by
    anyone auditing the draw budget. Not part of the frozen contract. */
export function shipStats(classId) {
  const asset = buildClass(classId);
  if (!asset) return null;
  return {
    classId,
    length: asset.def.length,
    family: asset.def.family,
    radius: asset.radius,
    levels: asset.tris.slice(),
    groups: asset.levels.map((g) => [g.hull ? 1 : 0, g.glass ? 1 : 0, g.glow ? 1 : 0].reduce((a, v) => a + v, 0)),
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
      for (const k of [KIND.HULL, KIND.GLASS, KIND.GLOW]) {
        if (level[k]) level[k].dispose();
      }
    }
  }
  _cache.clear();
  for (const m of _fallbackCache.values()) m.dispose();
  _fallbackCache.clear();
}

export { HULL_CLASSES };
