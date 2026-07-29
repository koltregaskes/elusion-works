import * as THREE from '../../vendor/three/build/three.module.js';
import { bus } from '../core/events.js';
import { makeRng } from '../core/rng.js';
import { SHIPS, ROLE, approxRadius } from '../ships/catalog.js';
import {
  initMovementState,
  updateSteering,
  updateIntegration,
  syncTransforms as syncMovement,
  setNavArrive,
  setNavHold,
  setFacePoint,
  NAV,
} from './movement.js';
import { initCombatState, updateCombat, ProjectileField, STANCE, maxWeaponRange } from './combat.js';
import { initEconomyState, updateEconomy, enqueueBuild, cancelBuild } from './economy.js';
import { assignFormation, formationOffsets, formationWorld, spacingFor, FORMATION, formationTightness } from './formations.js';
import { setupSkirmish } from './spawn.js';
import { Commander } from './ai.js';

/* The simulation.

   One entity store, one uniform-grid spatial hash, one fixed 30 Hz tick. Every
   proximity question in the game — targeting, separation, flak bursts,
   selection, harvesting — goes through the hash, which is why it is rebuilt
   once per tick with a counting sort into flat typed arrays rather than
   maintained incrementally.

   Hulls larger than the grid pad (destroyers and up) live in a short linear
   list instead of the grid: there are never many of them, and inserting a
   1.9 km mothership into forty cells would cost more than scanning six. */

/* Grid: 24^3 cells of 2.6 km covers a 62.4 km cube — the playable volume. */
const GRID_DIM = 24;
const GRID_CELL = 2600;
const GRID_CELLS = GRID_DIM * GRID_DIM * GRID_DIM;
const GRID_ORIGIN = (GRID_DIM * GRID_CELL) / 2;
const GRID_PAD = 100; // largest radius still held in the grid
const BIG_RADIUS = 100;

/* buildShipModel may not exist yet — the SHIPS agent is building it in
   parallel. Fall back to a scaled box so the sim runs standalone. */
let buildShipModel = null;
try {
  const mod = await import('../ships/index.js');
  if (mod && typeof mod.buildShipModel === 'function') buildShipModel = mod.buildShipModel;
} catch (err) {
  buildShipModel = null;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const WORLD_FWD = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3(0, 0, 0);

/* ------------------------------------------------------------- fallback art */

const _fallbackGeo = new Map();
const _fallbackMat = new Map();

function fallbackModel(classId, team) {
  const def = SHIPS[classId];
  let geo = _fallbackGeo.get(classId);
  if (!geo) {
    const L = def.length;
    geo = new THREE.BoxGeometry(L * 0.34, L * 0.2, L);
    _fallbackGeo.set(classId, geo);
  }
  let mat = _fallbackMat.get(team);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color: team === 0 ? 0x5fd6ff : 0xff9a4a,
      wireframe: true,
    });
    _fallbackMat.set(team, mat);
  }
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  return group;
}

/** Muzzle points inferred from hull size when there is no model to ask. */
function fallbackHardpoints(def) {
  const L = def.length;
  return [
    new THREE.Vector3(L * 0.14, 0, L * 0.42),
    new THREE.Vector3(-L * 0.14, 0, L * 0.42),
    new THREE.Vector3(0, L * 0.09, L * 0.3),
    new THREE.Vector3(0, -L * 0.07, L * 0.3),
    new THREE.Vector3(L * 0.2, 0, 0),
    new THREE.Vector3(-L * 0.2, 0, 0),
    new THREE.Vector3(L * 0.16, L * 0.08, -L * 0.2),
    new THREE.Vector3(-L * 0.16, L * 0.08, -L * 0.2),
    new THREE.Vector3(L * 0.16, -L * 0.08, -L * 0.2),
    new THREE.Vector3(-L * 0.16, -L * 0.08, -L * 0.2),
  ];
}

/* ------------------------------------------------------------ spatial hash */

class Grid {
  constructor() {
    this.counts = new Int32Array(GRID_CELLS + 1);
    this.starts = new Int32Array(GRID_CELLS + 1);
    this.cursor = new Int32Array(GRID_CELLS + 1);
    this.items = new Int32Array(2048);
    this.cellOf = new Int32Array(2048);
    this.n = 0;
  }

  _grow(n) {
    if (this.items.length >= n) return;
    let cap = this.items.length;
    while (cap < n) cap *= 2;
    this.items = new Int32Array(cap);
    this.cellOf = new Int32Array(cap);
  }

  static cellIndex(x, y, z) {
    let cx = ((x + GRID_ORIGIN) / GRID_CELL) | 0;
    let cy = ((y + GRID_ORIGIN) / GRID_CELL) | 0;
    let cz = ((z + GRID_ORIGIN) / GRID_CELL) | 0;
    if (cx < 0) cx = 0; else if (cx >= GRID_DIM) cx = GRID_DIM - 1;
    if (cy < 0) cy = 0; else if (cy >= GRID_DIM) cy = GRID_DIM - 1;
    if (cz < 0) cz = 0; else if (cz >= GRID_DIM) cz = GRID_DIM - 1;
    return (cz * GRID_DIM + cy) * GRID_DIM + cx;
  }

  /** Counting sort of `list` indices into cells. O(n + cells). */
  rebuild(list) {
    const n = list.length;
    this._grow(n);
    const counts = this.counts;
    counts.fill(0);
    const cellOf = this.cellOf;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (!e.alive || e.radius > BIG_RADIUS) {
        cellOf[i] = -1;
        continue;
      }
      const c = Grid.cellIndex(e.position.x, e.position.y, e.position.z);
      cellOf[i] = c;
      counts[c]++;
      m++;
    }
    const starts = this.starts;
    let acc = 0;
    for (let c = 0; c < GRID_CELLS; c++) {
      starts[c] = acc;
      acc += counts[c];
    }
    starts[GRID_CELLS] = acc;
    this.cursor.set(starts);
    const items = this.items;
    const cursor = this.cursor;
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c >= 0) items[cursor[c]++] = i;
    }
    this.n = m;
  }
}

/* ------------------------------------------------------------------- world */

let _nextId = 1;

export class World {
  constructor({ seed = 1337, engine = null, fx = null, options = {} } = {}) {
    this.seed = seed >>> 0 || 1;
    this.engine = engine;
    this.fx = fx;
    this.options = options;
    this.environment = options.environment || null;
    this.headless = options.headless === true;
    this.fxEvents = options.fxEvents !== false;
    this.bounds = options.bounds || 30000;

    this.rng = makeRng(this.seed);
    this.rngCombat = this.rng.fork(0xC0FFEE);
    this.rngAi = this.rng.fork(0xA1);
    this.rngSpawn = this.rng.fork(0x5A);

    this.entities = new Map();
    this.dense = [];
    this.grid = new Grid();
    this.bigList = [];
    this.projectiles = new ProjectileField(options.projectileCap || 8000);

    this.tickCount = 0;
    this.time = 0;
    this.over = false;
    this.winner = -1;

    this.resourceClusters = [];
    this.separation = 22000;
    // Weapon reach is measured to the hull, so range queries have to be padded
    // by the largest thing that could be standing in them.
    this.maxTargetRadius = 0;
    for (const id in SHIPS) {
      const r = approxRadius(id);
      if (r > this.maxTargetRadius) this.maxTargetRadius = r;
    }

    this.teams = [makeTeam(0, options), makeTeam(1, options)];
    this._busyScratch = new Set();
    this._pendingRemoval = false;
    this._groupSeq = 1;
    this._offs = [];
    this._commanders = [];

    // Perf counters — the debug harness and the HUD read these.
    this.stats = { tickMs: 0, entities: 0, projectiles: 0, queries: 0 };

    this._bind();

    if (options.autoSetup !== false) {
      setupSkirmish(this, options.setup || {});
    }

    const ai = options.ai || {};
    if (ai.enemy !== false) {
      this._commanders.push(new Commander(this, 1, { difficulty: ai.difficulty || 'normal' }));
    }
    if (ai.player === true) {
      this._commanders.push(new Commander(this, 0, { difficulty: ai.playerDifficulty || ai.difficulty || 'normal' }));
    }
  }

  /* --------------------------------------------------------------- events */

  _bind() {
    this._offs.push(bus.on('cmd:move', (p) => this.commandMove(p)));
    this._offs.push(bus.on('cmd:attack', (p) => this.commandAttack(p)));
    this._offs.push(bus.on('cmd:stance', (p) => this.commandStance(p)));
    this._offs.push(bus.on('cmd:formation', (p) => this.commandFormation(p)));
    this._offs.push(bus.on('cmd:build', (p) => this.commandBuild(p)));
    this._offs.push(bus.on('cmd:cancelBuild', (p) => this.commandCancelBuild(p)));
  }

  /* --------------------------------------------------------------- spawning */

  spawn(classId, team, position, rotation) {
    const def = SHIPS[classId];
    if (!def) return null;

    const e = {
      id: _nextId++,
      classId,
      team,
      role: def.role,
      def,
      object3D: null,
      position: new THREE.Vector3().copy(position),
      velocity: new THREE.Vector3(),
      quaternion: rotation ? new THREE.Quaternion().copy(rotation) : new THREE.Quaternion(),
      prevPosition: new THREE.Vector3().copy(position),
      prevQuaternion: new THREE.Quaternion(),
      hull: def.hull,
      maxHull: def.hull,
      shield: def.shield || 0,
      maxShield: def.shield || 0,
      targetId: -1,
      orderQueue: [],
      stance: def.role === ROLE.RESOURCE || def.role === ROLE.STRUCTURE
        ? STANCE.PASSIVE
        : STANCE.NEUTRAL,
      formationSlot: -1,
      alive: true,
      radius: approxRadius(classId),
      throttle: 0,

      /* --- sim-private, below the frozen surface --- */
      formation: FORMATION.DELTA,
      formationCount: 1,
      groupId: 0,
      station: null,
      hardpoints: null,
      forcedTargetId: -1,
      combatHelm: true,
      harvestOrder: true,
      engaged: false,
      avoid: true,
      birth: this.time,
    };
    e.prevQuaternion.copy(e.quaternion);

    if (!this.headless) this._attachModel(e);
    if (!e.hardpoints) e.hardpoints = fallbackHardpoints(def);

    initMovementState(e);
    initCombatState(e);
    initEconomyState(e);
    e.engageRange = maxWeaponRange(def);

    this.entities.set(e.id, e);
    this.dense.push(e);
    if (e.radius > BIG_RADIUS) this.bigList.push(e);

    const t = this.teams[team];
    t.count++;
    t.popUsed += def.popCost || 0;
    if (def.producer) {
      t.producers.add(e.id);
      t.popCap += def.popProvided || 0;
    }
    if (def.role === ROLE.RESOURCE) t.collectors.add(e.id);

    bus.emit('sim:spawn', { entity: e });
    return e;
  }

  _attachModel(e) {
    let built = null;
    if (buildShipModel) {
      try {
        built = buildShipModel(e.classId, e.team, this.rngSpawn.fork(e.def.modelSeed || e.id));
      } catch (err) {
        built = null; // model registry not ready; box it.
      }
    }
    if (built && built.group) {
      e.object3D = built.group;
      if (built.radius) e.radius = built.radius;
      if (built.hardpoints && built.hardpoints.length) e.hardpoints = built.hardpoints;
      e._engines = built.engines || null;
      e._lights = built.lights || null;
    } else {
      e.object3D = fallbackModel(e.classId, e.team);
      e._fallbackModel = true;
    }
    e.object3D.matrixAutoUpdate = false;
    e.object3D.position.copy(e.position);
    e.object3D.quaternion.copy(e.quaternion);
    e.object3D.updateMatrix();
    e.object3D.userData.entityId = e.id;

    if (this.engine && this.engine.scene) this.engine.scene.add(e.object3D);
    if (this.fx && this.fx.attachEngines && e._engines) {
      try {
        this.fx.attachEngines(e, e._engines);
      } catch (err) {
        /* FX not ready — plumes are cosmetic, carry on. */
      }
    }
  }

  /* --------------------------------------------------------------- removal */

  /** Destroy with a death event. Removal is deferred to the end of the tick. */
  kill(e, killer) {
    if (!e || !e.alive) return;
    e.alive = false;
    e.hull = 0;
    this._pendingRemoval = true;
    const t = this.teams[e.team];
    t.losses++;
    if (killer) this.teams[killer.team].kills++;
    bus.emit('sim:death', { entity: e, killer: killer || null });
  }

  /** Public removal by id. Silent — no death event, no kill credit. */
  destroy(id) {
    const e = this.entities.get(id);
    if (!e) return;
    e.alive = false;
    this._pendingRemoval = true;
  }

  _release(e) {
    const t = this.teams[e.team];
    t.count--;
    t.popUsed = Math.max(0, t.popUsed - (e.def.popCost || 0));
    if (e.def.producer) {
      t.producers.delete(e.id);
      t.popCap = Math.max(0, t.popCap - (e.def.popProvided || 0));
    }
    if (e.def.role === ROLE.RESOURCE) t.collectors.delete(e.id);
    if (t.baseId === e.id) t.baseAlive = false;

    if (this.fx && this.fx.detachEntity) {
      try {
        this.fx.detachEntity(e);
      } catch (err) {
        /* no-op */
      }
    }
    if (e.object3D) {
      if (e.object3D.parent) e.object3D.parent.remove(e.object3D);
      if (!e._fallbackModel) disposeTree(e.object3D);
      e.object3D = null;
    }
    this.entities.delete(e.id);
  }

  _compact() {
    if (!this._pendingRemoval) return;
    this._pendingRemoval = false;
    const list = this.dense;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive) list[w++] = e;
      else this._release(e);
    }
    list.length = w;
    const big = this.bigList;
    w = 0;
    for (let i = 0; i < big.length; i++) if (big[i].alive) big[w++] = big[i];
    big.length = w;
  }

  recomputePopulation() {
    for (let t = 0; t < 2; t++) {
      const team = this.teams[t];
      team.popUsed = 0;
      team.popCap = 0;
      team.producers.clear();
      team.collectors.clear();
      team.count = 0;
    }
    for (let i = 0; i < this.dense.length; i++) {
      const e = this.dense[i];
      if (!e.alive) continue;
      const t = this.teams[e.team];
      t.count++;
      t.popUsed += e.def.popCost || 0;
      if (e.def.producer) {
        t.producers.add(e.id);
        t.popCap += e.def.popProvided || 0;
      }
      if (e.role === ROLE.RESOURCE) t.collectors.add(e.id);
    }
    for (let t = 0; t < 2; t++) {
      const team = this.teams[t];
      team.popQueued = 0;
      for (let i = 0; i < team.queue.length; i++) team.popQueued += team.queue[i].pop;
    }
  }

  /* ---------------------------------------------------------------- queries */

  /**
   * Visit every entity whose cell overlaps the sphere, plus every large hull.
   * Candidates are approximate — the visitor must do its own exact test.
   */
  forEachNear(x, y, z, r, fn) {
    this.stats.queries++;
    const rr = r + GRID_PAD;
    const g = this.grid;
    const list = this.dense;

    let x0 = ((x - rr + GRID_ORIGIN) / GRID_CELL) | 0;
    let x1 = ((x + rr + GRID_ORIGIN) / GRID_CELL) | 0;
    let y0 = ((y - rr + GRID_ORIGIN) / GRID_CELL) | 0;
    let y1 = ((y + rr + GRID_ORIGIN) / GRID_CELL) | 0;
    let z0 = ((z - rr + GRID_ORIGIN) / GRID_CELL) | 0;
    let z1 = ((z + rr + GRID_ORIGIN) / GRID_CELL) | 0;
    if (x0 < 0) x0 = 0; if (x1 >= GRID_DIM) x1 = GRID_DIM - 1;
    if (y0 < 0) y0 = 0; if (y1 >= GRID_DIM) y1 = GRID_DIM - 1;
    if (z0 < 0) z0 = 0; if (z1 >= GRID_DIM) z1 = GRID_DIM - 1;

    const starts = g.starts;
    const items = g.items;
    for (let cz = z0; cz <= z1; cz++) {
      const zb = cz * GRID_DIM;
      for (let cy = y0; cy <= y1; cy++) {
        const base = (zb + cy) * GRID_DIM;
        const a = starts[base + x0];
        const b = starts[base + x1 + 1];
        for (let k = a; k < b; k++) fn(list[items[k]]);
      }
    }

    const big = this.bigList;
    for (let i = 0; i < big.length; i++) {
      const e = big[i];
      const dx = e.position.x - x;
      const dy = e.position.y - y;
      const dz = e.position.z - z;
      const reach = r + e.radius;
      if (dx * dx + dy * dy + dz * dz <= reach * reach) fn(e);
    }
  }

  /** `volume` is a THREE.Sphere or THREE.Box3. Allocates — not for hot loops. */
  query(volume) {
    const out = [];
    if (!volume) return out;
    if (volume.radius !== undefined && volume.center) {
      const c = volume.center;
      const r = volume.radius;
      const r2 = r * r;
      this.forEachNear(c.x, c.y, c.z, r, (e) => {
        if (!e.alive) return;
        if (e.position.distanceToSquared(c) <= r2) out.push(e);
      });
      return out;
    }
    if (volume.min && volume.max) {
      const min = volume.min;
      const max = volume.max;
      _v.addVectors(min, max).multiplyScalar(0.5);
      const r = _v2.subVectors(max, min).length() * 0.5;
      const cx = _v.x;
      const cy = _v.y;
      const cz = _v.z;
      this.forEachNear(cx, cy, cz, r, (e) => {
        if (!e.alive) return;
        const p = e.position;
        if (p.x < min.x || p.x > max.x || p.y < min.y || p.y > max.y || p.z < min.z || p.z > max.z) return;
        out.push(e);
      });
      return out;
    }
    return out;
  }

  /** Nearest entity whose bounding sphere the ray enters. */
  raycastEntities(ray, teamFilter) {
    const list = this.dense;
    let best = null;
    let bestT = Infinity;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (teamFilter !== undefined && teamFilter !== null && e.team !== teamFilter) continue;
      _v.subVectors(e.position, ray.origin);
      const t = _v.dot(ray.direction);
      if (t < 0) continue;
      _v2.copy(ray.direction).multiplyScalar(t).add(ray.origin);
      // Generous pick radius: a 14 m interceptor at 8 km is two pixels.
      const pick = Math.max(e.radius * 1.35, 45);
      if (_v2.distanceToSquared(e.position) <= pick * pick && t < bestT) {
        bestT = t;
        best = e;
      }
    }
    return best;
  }

  /**
   * Band-box selection. `screenRect` may be NDC ({x0,y0,x1,y1} in -1..1) or CSS
   * pixels ({left,top,right,bottom} plus {width,height} of the viewport, or
   * {x,y,width,height}). `camera` may be a THREE.Camera or a CameraRig.
   */
  selectionAt(screenRect, camera, team) {
    const cam = resolveCamera(camera) || (this.engine && this.engine.camera);
    const ids = [];
    if (!cam || !screenRect) return ids;

    const r = normaliseRect(screenRect);
    cam.updateMatrixWorld();
    _mat.copy(cam.matrixWorldInverse);

    const list = this.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (team !== undefined && team !== null && e.team !== team) continue;
      _v.copy(e.position).applyMatrix4(_mat);
      if (_v.z > -1) continue; // behind the eye
      _v.copy(e.position).project(cam);
      if (_v.x < r.x0 || _v.x > r.x1 || _v.y < r.y0 || _v.y > r.y1) continue;
      ids.push(e.id);
    }
    return ids;
  }

  entitiesByIds(ids) {
    const out = [];
    if (!ids) return out;
    for (let i = 0; i < ids.length; i++) {
      const e = this.entities.get(ids[i]);
      if (e && e.alive) out.push(e);
    }
    return out;
  }

  teamEntities(team, role) {
    const out = [];
    for (let i = 0; i < this.dense.length; i++) {
      const e = this.dense[i];
      if (e.alive && e.team === team && (role === undefined || e.role === role)) out.push(e);
    }
    return out;
  }

  /* --------------------------------------------------------------- commands */

  commandMove({ ids, point, formation }) {
    const members = this.entitiesByIds(ids);
    if (!members.length || !point) return;
    this.issueMove(members, point, formation);
  }

  /** Shared by player commands and the AI commander. */
  issueMove(members, point, formation, keepStance) {
    if (!members.length) return;
    const shape = formation || members[0].formation || FORMATION.DELTA;
    const order = assignFormation(members, shape);

    _v.set(0, 0, 0);
    for (let i = 0; i < order.length; i++) _v.add(order[i].position);
    _v.multiplyScalar(1 / order.length);
    _v2.subVectors(point, _v);
    if (_v2.lengthSq() < 1) _v2.copy(WORLD_FWD);

    const spacing = spacingFor(order);
    const offsets = formationOffsets(shape, order.length, spacing);
    const gid = this._groupSeq++;

    for (let i = 0; i < order.length; i++) {
      const e = order[i];
      const dest = new THREE.Vector3();
      formationWorld(point, _v2, offsets[i], dest);
      e.groupId = gid;
      e.orderQueue.length = 0;
      e.orderQueue.push({ type: 'move', point: dest, formation: shape });
      e.station = dest.clone();
      e.forcedTargetId = -1;
      e.harvestOrder = false;
      if (!keepStance && e.stance === STANCE.PASSIVE && e.role !== ROLE.RESOURCE &&
          e.role !== ROLE.STRUCTURE) {
        e.stance = STANCE.NEUTRAL;
      }
    }
  }

  commandAttack({ ids, targetId }) {
    const members = this.entitiesByIds(ids);
    const target = this.entities.get(targetId);
    if (!members.length || !target) return;
    for (let i = 0; i < members.length; i++) {
      const e = members[i];
      e.orderQueue.length = 0;
      e.orderQueue.push({ type: 'attack', targetId });
      e.forcedTargetId = targetId;
      e.targetId = targetId;
      e.combatHelm = true;
      e.harvestOrder = false;
      e.retarget = 0;
      // The mark becomes the leash anchor, or a passive escort would be
      // dragged home by its old station the moment it opened fire.
      e.station = target.position.clone();
    }
  }

  commandStance({ ids, stance }) {
    const members = this.entitiesByIds(ids);
    for (let i = 0; i < members.length; i++) members[i].stance = stance;
  }

  commandFormation({ ids, formation }) {
    const members = this.entitiesByIds(ids);
    if (!members.length) return;
    _v.set(0, 0, 0);
    for (let i = 0; i < members.length; i++) _v.add(members[i].position);
    _v.multiplyScalar(1 / members.length);
    this.issueMove(members, _v, formation, true);
  }

  commandBuild({ team, classId }) {
    enqueueBuild(this, team, classId);
  }

  commandCancelBuild({ team, index }) {
    cancelBuild(this, team, index);
  }

  /* ----------------------------------------------------------------- orders */

  _updateOrders(dt) {
    const list = this.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const q = e.orderQueue;
      if (q.length === 0) {
        if (e.combatHelm === false) e.combatHelm = true;
        if (e.role === ROLE.RESOURCE) e.harvestOrder = true;
        if (!e.engaged && e.role !== ROLE.RESOURCE) this._idleBehaviour(e);
        continue;
      }
      const o = q[0];

      if (o.type === 'attack') {
        const t = this.entities.get(o.targetId);
        if (!t || !t.alive) {
          q.shift();
          e.forcedTargetId = -1;
          continue;
        }
        e.combatHelm = true;
        continue;
      }

      if (o.type === 'move') {
        const d = e.position.distanceTo(o.point);
        // Formation tightness: a mothership does not need to hit the pixel.
        const slack = (e.radius + 60) / Math.max(0.2, formationTightness(e.role));
        if (d < slack && e.speed < e.maxSpeed * 0.06) {
          q.shift();
          e.combatHelm = true;
          setNavHold(e);
          continue;
        }
        // Contact breaks the march: a wing under a move order still turns and
        // fights, then picks the waypoint back up when the sky is clear.
        const contact = e.engaged && e.targetId >= 0 && e.stance !== STANCE.PASSIVE;
        e.combatHelm = contact;
        if (!contact) {
          setNavArrive(e, o.point, 1, e.radius * 0.4);
          setFacePoint(e, null);
        }
      }
    }
  }

  /** Nothing to do: hold station near the last waypoint. */
  _idleBehaviour(e) {
    if (e.role === ROLE.STRUCTURE) {
      setNavHold(e);
      setFacePoint(e, null);
      return;
    }
    if (e.station) {
      const d = e.position.distanceTo(e.station);
      if (d > e.radius * 3 + 220) {
        setNavArrive(e, e.station, 0.6, e.radius + 60);
        setFacePoint(e, null);
        return;
      }
    }
    if (e.navMode !== NAV.HOLD) setNavHold(e);
  }

  /* ------------------------------------------------------------------- tick */

  tick(dt) {
    const t0 = performance.now();
    this.tickCount++;
    this.time += dt;
    this.stats.queries = 0;

    this.grid.rebuild(this.dense);

    this._updateOrders(dt);
    updateEconomy(this, dt);
    for (let i = 0; i < this._commanders.length; i++) this._commanders[i].update(dt);
    updateCombat(this, dt);
    updateSteering(this, dt);
    updateIntegration(this, dt);

    this._compact();
    this._checkVictory();

    bus.emit('sim:tick', { tick: this.tickCount, dt });

    this.stats.tickMs = performance.now() - t0;
    this.stats.entities = this.dense.length;
    this.stats.projectiles = this.projectiles.count;
  }

  _checkVictory() {
    if (this.over) return;
    const aliveBase = [false, false];
    for (let t = 0; t < 2; t++) {
      const base = this.entities.get(this.teams[t].baseId);
      aliveBase[t] = !!(base && base.alive);
    }
    if (aliveBase[0] && aliveBase[1]) return;
    this.over = true;
    if (aliveBase[0]) this.winner = 0;
    else if (aliveBase[1]) this.winner = 1;
    else this.winner = -1;
    bus.emit('sim:gameOver', { winner: this.winner });
  }

  syncTransforms(alpha) {
    if (this.headless) return;
    syncMovement(this, alpha);
  }

  /* ---------------------------------------------------------------- teardown */

  dispose() {
    for (let i = 0; i < this._offs.length; i++) this._offs[i]();
    this._offs.length = 0;
    for (let i = 0; i < this._commanders.length; i++) this._commanders[i].dispose();
    this._commanders.length = 0;

    for (const e of this.entities.values()) {
      if (this.fx && this.fx.detachEntity) {
        try {
          this.fx.detachEntity(e);
        } catch (err) {
          /* no-op */
        }
      }
      if (e.object3D) {
        if (e.object3D.parent) e.object3D.parent.remove(e.object3D);
        if (!e._fallbackModel) disposeTree(e.object3D);
        e.object3D = null;
      }
    }
    this.entities.clear();
    this.dense.length = 0;
    this.bigList.length = 0;
    this.projectiles.clear();
    this.resourceClusters.length = 0;

    for (const g of _fallbackGeo.values()) g.dispose();
    _fallbackGeo.clear();
    for (const m of _fallbackMat.values()) m.dispose();
    _fallbackMat.clear();
  }
}

/* ------------------------------------------------------------------ helpers */

function makeTeam(id, options) {
  return {
    id,
    credits: options.startingCredits === undefined ? 1200 : options.startingCredits,
    popUsed: 0,
    popCap: 0,
    popQueued: 0,
    queue: [],
    producers: new Set(),
    collectors: new Set(),
    baseId: -1,
    baseAlive: true,
    homePosition: new THREE.Vector3(),
    kills: 0,
    losses: 0,
    harvested: 0,
    count: 0,
    buildRate: 1,
    incomeScale: 1,
  };
}

function resolveCamera(c) {
  if (!c) return null;
  if (c.isCamera) return c;
  if (c.camera && c.camera.isCamera) return c.camera;
  if (c.engine && c.engine.camera) return c.engine.camera;
  return null;
}

function normaliseRect(r) {
  let x0;
  let y0;
  let x1;
  let y1;
  if (r.x0 !== undefined) {
    x0 = r.x0; y0 = r.y0; x1 = r.x1; y1 = r.y1;
  } else if (r.left !== undefined) {
    x0 = r.left; y0 = r.top; x1 = r.right; y1 = r.bottom;
  } else {
    x0 = r.x; y0 = r.y; x1 = r.x + r.width; y1 = r.y + r.height;
  }
  const ndc = r.space === 'ndc' ||
    (Math.abs(x0) <= 1 && Math.abs(x1) <= 1 && Math.abs(y0) <= 1 && Math.abs(y1) <= 1);
  if (!ndc) {
    const w = r.viewWidth || r.width || (typeof window !== 'undefined' ? window.innerWidth : 1);
    const h = r.viewHeight || r.height || (typeof window !== 'undefined' ? window.innerHeight : 1);
    const nx0 = (x0 / w) * 2 - 1;
    const nx1 = (x1 / w) * 2 - 1;
    const ny0 = 1 - (y0 / h) * 2;
    const ny1 = 1 - (y1 / h) * 2;
    x0 = nx0; x1 = nx1; y0 = ny0; y1 = ny1;
  }
  return {
    x0: Math.min(x0, x1),
    x1: Math.max(x0, x1),
    y0: Math.min(y0, y1),
    y1: Math.max(y0, y1),
  };
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (!m) return;
    const mats = Array.isArray(m) ? m : [m];
    for (const mat of mats) mat.dispose();
  });
}

export { GRID_CELL, GRID_DIM, STANCE, FORMATION };
