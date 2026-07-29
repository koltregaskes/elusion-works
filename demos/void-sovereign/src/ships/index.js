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

function levelGroup(asset, index, team) {
  const g = new THREE.Group();
  g.name = `${asset.classId}:L${index}`;
  g.userData.lodLevel = index;
  const geo = asset.levels[index];
  if (geo.hull) {
    const mesh = tagged(geo.hull, hullMaterial(team, asset.def.family, false), KIND.HULL, index);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  if (geo.glass) g.add(tagged(geo.glass, glassMaterial(team), KIND.GLASS, index));
  if (geo.glow) {
    // Self-lit: it must not take shadow, and it must not cast one either — a
    // hangar throat that shadows the hull it is cut into looks broken.
    const m = tagged(geo.glow, engineMaterial(team), KIND.GLOW, index);
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

  push(geo.hull, hullMaterial(team, asset.def.family, true), true, KIND.HULL);
  push(geo.glass, glassMaterial(team), false, KIND.GLASS);
  push(geo.glow, engineMaterial(team), false, KIND.GLOW);

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
        im.userData.emissive = kind === KIND.GLOW;
        this.group.add(im);
        level.parts.push({ mesh: im, damage: dmg, kind });
      };

      make(geo.hull, hullMaterial(this.team, this.asset.def.family, true), KIND.HULL, true);
      make(geo.glass, glassMaterial(this.team), KIND.GLASS, false);
      make(geo.glow, engineMaterial(this.team), KIND.GLOW, false);
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
    groups: asset.levels.map((g) => [g.hull ? 1 : 0, g.glass ? 1 : 0, g.glow ? 1 : 0].reduce((a, v) => a + v, 0)),
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
