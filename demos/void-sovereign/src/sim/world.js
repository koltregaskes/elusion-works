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
import {
  initCombatState, updateCombat, ProjectileField, STANCE, maxWeaponRange, creditKill,
} from './combat.js';
import {
  initEconomyState, updateEconomy, enqueueBuild, cancelBuild, updateControl,
} from './economy.js';
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

/* --------------------------------------------------------- match resolution

   Numbers that decide the *shape* of a skirmish rather than the outcome of any
   one fight. They are gathered here, and every one of them is stated to the
   player somewhere, because an undisclosed pacing rule is indistinguishable
   from the game cheating. */

/* ------------------------------------------------------------------ pacing */

/** Match pacing presets.

    `long` is the original rule, kept exactly as it was. `standard` is the
    shorter default a first-time player is dropped into.

    The problem `standard` solves: the drain rate is set by the *margin* in
    seams divided by the *whole contested band*, and the band is mostly
    neutral, because taking a seam needs 22 s of unopposed presence
    (`CONTROL.CAPTURE`) and a contested middle rarely offers 22 quiet seconds.
    So the numerator is whatever scrap survives a brawl while the denominator
    is the entire band. Two evenly matched commanders sit on a one-seam margin
    and the clock becomes a formality. Measured on the shipped path: seed 1337
    ran 35.3 minutes to an attrition finish, and seed 20260727 hit the 70-minute
    cap with no winner at all, seams level at 1–1.

    It got worse, not better, when the contested band was fixed: most seeds went
    from a band of 4 (or none) to a band of 6, and a bigger denominator makes
    the same lead drain *slower*.

    `standard` raises that fraction to a power below 1. That lifts narrow
    margins hard, where the dead zone is, while leaving a total sweep almost
    untouched, so dominance still wins fastest and the comeback path survives.
    Modelled over every seam split on bands of 4 and 6, the square root lands
    61% of them inside a 12–18 minute match against 44% for the linear rule; a
    fixed denominator (28%) and a margin measured against only the seams held
    (22%) both score worse than what shipped, by overshooting the other way.

    Model figures assume a constant margin held from minute zero, which never
    happens, so they choose the candidate rather than predict the result. The
    ten-seed A/B is what decides, and it moved the exponent below the square
    root — see the measurements below.

    `exp` is the exponent applied to the margin fraction: 1 is the original
    linear rule, 0.5 its square root, and lower values lift narrow margins
    harder still. It is a number rather than a named curve so the pacing can
    be swept and measured instead of argued about.

    Measured on the shipped path, ten seeds, both chairs filled by a real
    commander, one fresh page per seed so the runs are reproducible:

      long      median 46.5 min, range 31.2–70.0. Every single match ran past
                25 minutes, and one hit the cap with no winner at all.
      standard  median 17.5 min, range 11.0–24.8. No match over 25 minutes,
                none unresolved, and 9 of 10 decided by sovereignty rather
                than by grinding the other fleet down.

    `standard` is faster on all ten seeds, not on average — there is no seed
    where the old rule produced the shorter match. That is why it is the
    default and `long` is the option, rather than the other way round.

    Do not trust these figures from a harness that reuses one page across
    seeds. State persists between matches, so the first match in a page
    differs from later ones: the same seed gave 20.9, 14.6 and 14.2 minutes
    in one page, and 20.9 three times out of three with a fresh page each. */
export const PACE = {
  long: { grace: 240, rate: 0.25, exp: 1 },
  standard: { grace: 120, rate: 0.38, exp: 0.34 },
};

/** Default pacing. `standard` on the evidence above: faster on all ten seeds,
    median inside a demo-sized 12–18 minutes, and it always resolves. `long`
    stays reachable for anyone who wants the hour-scale grind. */
const PACE_DEFAULT = 'standard';

/* The grace period and drain rate used to live here as `SOVEREIGNTY_GRACE`
   and `SOVEREIGNTY_RATE`. They are in `PACE` above now, per preset. They are
   not left behind as aliases on purpose: a named constant that no longer
   drives anything is the exact trap this file has already sprung twice —
   once with a doc comment still describing a four-seam field after the band
   became six, and once with a whole generator that nothing called. */

/** Share of the drain rate at which the side holding the band recovers. */
const SOVEREIGNTY_RECOVERY = 0.3;

/** Thresholds that get a line to the player. */
const SOVEREIGNTY_WARN = [75, 50, 25, 10];

/** A hull rebuilt from nothing costs this share of a new one. */
const REPAIR_COST_FRACTION = 0.32;

/** Below this in warships, with no yards and no miners, a side is finished. */
const BROKEN_FLEET_VALUE = 1400;

const VICTORY_COPY = {
  base: 'The mothership is gone.',
  sovereignty: 'The contested field decided it.',
  attrition: 'No yards, no miners, no fleet left to rebuild with.',
};

/* Grid: 24^3 cells of 2.6 km covers a 62.4 km cube — the playable volume. */
const GRID_DIM = 24;
const GRID_CELL = 2600;
const GRID_CELLS = GRID_DIM * GRID_DIM * GRID_DIM;
const GRID_ORIGIN = (GRID_DIM * GRID_CELL) / 2;
const GRID_PAD = 100; // largest radius still held in the grid
const BIG_RADIUS = 100;

/* The ships module is built in parallel and each export lands separately, so
   every one of them is feature-detected and every one has a fallback: a scaled
   box for the model, an ordinary scene node when the instanced batch is not
   there yet. The sim must run standalone whatever the art side has finished. */
let buildShipModel = null;
let getFleetBatch = null;
let commitAllBatches = null;
let setFleetScene = null;
let classBatches = null;
try {
  const mod = await import('../ships/index.js');
  if (mod) {
    if (typeof mod.buildShipModel === 'function') buildShipModel = mod.buildShipModel;
    if (typeof mod.getFleetBatch === 'function') getFleetBatch = mod.getFleetBatch;
    if (typeof mod.commitAllBatches === 'function') commitAllBatches = mod.commitAllBatches;
    if (typeof mod.setFleetScene === 'function') setFleetScene = mod.setFleetScene;
    if (typeof mod.classBatches === 'function') classBatches = mod.classBatches;
  }
} catch (err) {
  buildShipModel = null;
}

/* Unique hulls stay unique. A mothership, carrier or cruiser appears once or
   twice a side and carries bespoke detail; batching them would buy nothing and
   cost the thing that makes them read as landmarks. Everything else turns up in
   dozens and draws from an instanced batch, because draw calls — not
   triangles — are what a thousand-hull fleet runs out of first.

   `ships/` is the authority on which classes batch; this list is only the
   fallback for a build where that export has not landed, and the two must not
   be allowed to drift. */
const BATCH_EXEMPT = new Set(['mothership', 'carrier', 'cruiser']);

function classIsBatched(classId) {
  return classBatches ? classBatches(classId) === true : !BATCH_EXEMPT.has(classId);
}

/* LOD bands, in metres, scaled by hull size so a 14 m interceptor and a 380 m
   destroyer drop detail at the range each actually stops resolving. */
function lodFor(radius, distance) {
  if (distance < radius * 120 + 1500) return 0;
  if (distance < radius * 420 + 5000) return 1;
  return 2;
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
  constructor({ seed = 1337, engine = null, fx = null, environment = null, options = {} } = {}) {
    this.seed = seed >>> 0 || 1;
    this.engine = engine;
    this.fx = fx;
    this.options = options;
    /* Match pacing. An unknown name falls back rather than throwing, so a
       stale link or a typed URL cannot produce a match with no clock. */
    this.paceName = PACE[options.pace] ? options.pace : PACE_DEFAULT;
    this.pace = PACE[this.paceName];
    // The bootstrap passes `environment` at the top level; the harness puts it
    // in `options`. Reading only one of the two meant the integrated build
    // silently generated its own ore field and mined coordinates where ENV had
    // drawn no rocks at all.
    this.environment = options.environment || environment || null;
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
    this.endReason = '';

    /* Which side a human is playing, so combat alerts are sent to them and not
       to the commander. -1 in an AI-versus-AI harness silences them entirely. */
    this.humanTeam = options.humanTeam === undefined ? 0 : options.humanTeam;
    this.notify = options.notify !== false && this.humanTeam >= 0;
    this._alertAt = {};
    this._sovWarned = [0, 0];

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
    this._batches = new Map();
    this._anyBatched = false;
    this._fleetSceneSet = false;

    // Perf counters — the debug harness and the HUD read these.
    this.stats = { tickMs: 0, entities: 0, projectiles: 0, queries: 0 };

    this._bind();

    if (options.autoSetup !== false) {
      setupSkirmish(this, options.setup || {});
    }

    // `options.difficulty` is what main.js passes from the URL; `options.ai`
    // is the harness form. Honour both or the skirmish difficulty selector
    // silently does nothing.
    const ai = options.ai || {};
    const baseDifficulty = ai.difficulty || options.difficulty || 'normal';
    if (ai.enemy !== false) {
      this._commanders.push(new Commander(this, 1, { difficulty: baseDifficulty }));
    }
    if (ai.player === true) {
      this._commanders.push(new Commander(this, 0, {
        difficulty: ai.playerDifficulty || baseDifficulty,
      }));
    }
  }

  /** Live commanders, for the debug harness and the HUD's AI readout. */
  get commanders() {
    return this._commanders;
  }

  /* --------------------------------------------------------------- events */

  _bind() {
    this._offs.push(bus.on('cmd:move', (p) => this.commandMove(p)));
    this._offs.push(bus.on('cmd:attack', (p) => this.commandAttack(p)));
    this._offs.push(bus.on('cmd:stance', (p) => this.commandStance(p)));
    this._offs.push(bus.on('cmd:formation', (p) => this.commandFormation(p)));
    this._offs.push(bus.on('cmd:build', (p) => this.commandBuild(p)));
    this._offs.push(bus.on('cmd:cancelBuild', (p) => this.commandCancelBuild(p)));
    // The rest of the order verbs. `cmd:move` and `cmd:attack` also accept a
    // `mode` field for the same effect, so an input layer may use either.
    this._offs.push(bus.on('cmd:attackMove', (p) => this.commandAttackMove(p)));
    this._offs.push(bus.on('cmd:guard', (p) => this.commandGuard(p)));
    this._offs.push(bus.on('cmd:patrol', (p) => this.commandPatrol(p)));
    this._offs.push(bus.on('cmd:stop', (p) => this.commandStop(p)));
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
      orderEngage: false,
      harvestOrder: true,
      engaged: false,
      avoid: true,
      birth: this.time,

      /* Instanced-batch slot. Declared here rather than bolted on at reserve
         time so every entity keeps the same hidden shape. */
      _batchRec: null,
      _slot: -1,
      _lod: -1,
      _damageShown: -1,
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

    if (this.engine && this.engine.scene && !this._reserveSlot(e)) {
      this.engine.scene.add(e.object3D);
    }
    if (this.fx && this.fx.attachEngines && e._engines) {
      try {
        this.fx.attachEngines(e, e._engines);
      } catch (err) {
        /* FX not ready — plumes are cosmetic, carry on. */
      }
    }
  }

  /* ------------------------------------------------------------- batching */

  /** The batch record for a class/team pair, or null if it cannot batch. */
  _batchFor(classId, team) {
    const key = `${classId}/${team}`;
    let rec = this._batches.get(key);
    if (rec !== undefined) return rec;
    rec = null;
    if (getFleetBatch && classIsBatched(classId)) {
      let b = null;
      try {
        // The batches all live under one root group, and that root has to be
        // parented into the scene exactly once. Miss this and everything still
        // reserves slots and reports healthy counts while drawing nothing —
        // which is precisely how a "draw calls are flat" measurement can be
        // taken of a scene with no fleet in it.
        if (setFleetScene && !this._fleetSceneSet && this.engine && this.engine.scene) {
          setFleetScene(this.engine.scene);
          this._fleetSceneSet = true;
        }
        b = getFleetBatch(classId, team);
      } catch (err) {
        b = null; // batch side not ready; an ordinary scene node will do
      }
      // Every method is checked once, here, so the per-frame path can be a
      // straight loop with no guards in it.
      if (b && typeof b.reserve === 'function' && typeof b.release === 'function' &&
          typeof b.setMatrix === 'function') {
        rec = {
          batch: b,
          hasLod: typeof b.setLod === 'function',
          // Preferred: the batch picks the level off the same thresholds the
          // individual `THREE.LOD` path uses, so batched and unbatched hulls
          // shed detail at identical ranges.
          hasLodDistance: typeof b.setLodFromDistance === 'function',
          hasDamage: typeof b.setDamage === 'function',
        };
      }
    }
    this._batches.set(key, rec);
    return rec;
  }

  /**
   * Hand the entity to its class batch. The `Object3D` is deliberately kept —
   * FX, HUD and the camera rig all read transforms off it — it is simply never
   * added to the scene, so it costs no draw call.
   */
  _reserveSlot(e) {
    const rec = this._batchFor(e.classId, e.team);
    if (!rec) return false;
    let slot = -1;
    try {
      slot = rec.batch.reserve();
    } catch (err) {
      slot = -1;
    }
    if (!(slot >= 0)) return false;
    e._batchRec = rec;
    e._slot = slot;
    e._lod = -1;
    e._damageShown = -1;
    this._anyBatched = true;
    return true;
  }

  _releaseSlot(e) {
    if (!e._batchRec) return;
    try {
      e._batchRec.batch.release(e._slot);
    } catch (err) {
      /* the batch is going away anyway */
    }
    e._batchRec = null;
    e._slot = -1;
  }

  /** Push interpolated transforms into the instance buffers, once per frame. */
  _syncBatches() {
    const cam = this.engine ? this.engine.camera : null;
    const camPos = cam ? cam.position : null;
    const list = this.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const rec = e._batchRec;
      if (!rec || !e.alive) continue;
      const o = e.object3D;
      if (!o) continue;
      rec.batch.setMatrix(e._slot, o.matrix);
      /* Batched hulls never pass through a `THREE.LOD`, and nothing else walks
         the graph on their behalf — every slot would sit at level 0 for the
         whole match unless the level is driven from here. This one line is the
         difference between detail that sheds with distance and a scene that is
         permanently triangle-bound. */
      if (camPos) {
        const d = camPos.distanceTo(o.position);
        if (rec.hasLodDistance) rec.batch.setLodFromDistance(e._slot, d);
        else if (rec.hasLod) {
          const lod = lodFor(e.radius, d);
          if (lod !== e._lod) {
            e._lod = lod;
            rec.batch.setLod(e._slot, lod);
          }
        }
      }
      if (rec.hasDamage) {
        const d = 1 - e.hull / e.maxHull;
        // Only when it has moved enough to see: this writes an instance
        // attribute, and rewriting it every frame for every hull is the cost
        // instancing was supposed to remove.
        if (d - e._damageShown > 0.05 || e._damageShown - d > 0.05) {
          e._damageShown = d;
          rec.batch.setDamage(e._slot, d);
        }
      }
    }
    if (commitAllBatches) commitAllBatches();
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
    if (killer) {
      this.teams[killer.team].kills++;
      creditKill(killer, e);
    }
    this._deathAlert(e, killer);
    bus.emit('sim:death', { entity: e, killer: killer || null });
  }

  /**
   * Public removal by id. Silent — no death event, no kill credit — and it
   * takes this hull's rounds out of the sky with it.
   *
   * Without that last part a harness that tears an arena down and builds
   * another one gets the previous fight's ordnance sweeping the new one: the
   * projectile field is cleared by neither `destroy` nor `_compact`, and a
   * missile with a dead shooter is perfectly happy to keep flying.
   */
  destroy(id) {
    const e = this.entities.get(id);
    if (!e) return;
    e.alive = false;
    e._silent = true;
    this._pendingRemoval = true;
  }

  /** Drop every round in flight. For arena resets, not for gameplay. */
  clearProjectiles() {
    this.projectiles.clear();
  }

  /** Remove in-flight rounds fired by, or aimed at, one entity. */
  _purgeProjectiles(id) {
    const P = this.projectiles;
    for (let i = 0; i < P.count; i++) {
      if (P.shooter[i] === id) {
        P.removeAt(i--);
        continue;
      }
      if (P.target[i] === id) P.target[i] = -1;
    }
  }

  /* --------------------------------------------------------------- repair */

  /**
   * Restore hull, and bill for it.
   *
   * Free repair makes attrition free, and attrition being free is most of why
   * a lost engagement costs nothing and a won one buys nothing. The rate is
   * deliberately gentle — a hull rebuilt from nothing costs about a third of a
   * new one, so withdrawing a mauled destroyer is always better value than
   * replacing it, which is exactly the decision that should exist.
   */
  repairAt(e, amount) {
    if (!e.alive || amount <= 0) return 0;
    const room = e.maxHull - e.hull;
    if (room <= 0) return 0;
    let give = amount < room ? amount : room;
    const t = this.teams[e.team];
    const price = ((e.def.cost || 0) * REPAIR_COST_FRACTION) / Math.max(1, e.maxHull);
    if (price > 0) {
      const afford = t.credits / price;
      if (afford < give) give = afford;
      if (give <= 0) return 0;
      const spend = give * price;
      t.credits -= spend;
      t.repairSpend += spend;
    }
    e.hull += give;
    return give;
  }

  /* --------------------------------------------------------------- alerts */

  /**
   * One line to the player, at most this often.
   *
   * `sim/` emitted no player-facing notification of any kind: a match with 866
   * kills, 73 losses and 57 raids on the player's home produced production
   * toasts and nothing else. The fix is not to emit 866 toasts. Every alert
   * here is rate-limited by key, and the keys are chosen so the ones that
   * repeat (raids, seams changing hands) are throttled hard while the ones
   * that cannot repeat (a capital dying, the sovereignty clock) are not.
   */
  _alert(key, text, kind, minGap) {
    if (!this.notify) return;
    const last = this._alertAt[key];
    const gap = minGap === undefined ? 30 : minGap;
    if (last !== undefined && this.time - last < gap) return;
    this._alertAt[key] = this.time;
    bus.emit('ui:toast', { text, kind: kind || 'info' });
  }

  _deathAlert(e, killer) {
    if (!this.notify) return;
    const mine = e.team === this.humanTeam;
    const def = e.def;
    if (def.isBase) return; // the game-over line says this better
    if (def.producer) {
      this._alert(
        mine ? 'lostYard' : 'killedYard',
        mine ? `${def.name} lost` : `Enemy ${def.name.toLowerCase()} destroyed`,
        mine ? 'alarm' : 'good',
        0,
      );
      return;
    }
    if (e.role === ROLE.CAPITAL) {
      this._alert(
        mine ? 'lostCapital' : 'killedCapital',
        mine ? `${def.name} lost` : `Enemy ${def.name.toLowerCase()} destroyed`,
        mine ? 'warn' : 'good',
        6,
      );
      return;
    }
    if (mine && e.role === ROLE.RESOURCE) {
      this._alert('lostCollector', 'Collector destroyed', 'warn', 45);
    }
    void killer;
  }

  /** Somebody is shooting something of the player's. Throttled hard. */
  _threatAlerts() {
    if (!this.notify) return;
    const team = this.humanTeam;
    const t = this.teams[team];
    const recent = 90; // ticks — three seconds
    const base = this.entities.get(t.baseId);
    if (base && base.alive && this.tickCount - base.lastHitTick < recent) {
      this._alert('homeAttack', 'Mothership under attack', 'alarm', 25);
      return;
    }
    for (const id of t.producers) {
      const p = this.entities.get(id);
      if (!p || !p.alive || p.id === t.baseId) continue;
      if (this.tickCount - p.lastHitTick < recent) {
        this._alert('yardAttack', `${p.def.name} under attack`, 'alarm', 25);
        return;
      }
    }
    for (const id of t.collectors) {
      const c = this.entities.get(id);
      if (!c || !c.alive) continue;
      if (this.tickCount - c.lastHitTick < recent) {
        this._alert('minersAttack', 'Collectors under attack', 'warn', 35);
        return;
      }
    }
  }

  _release(e) {
    if (e._silent) this._purgeProjectiles(e.id);
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
    this._releaseSlot(e);
    if (e.object3D) {
      if (e.object3D.parent) e.object3D.parent.remove(e.object3D);
      // Only the fallback boxes are ours to free. A model from `ships/` is
      // built from cached, class-shared geometry and materials — disposing it
      // here would delete the geometry every *other* hull of that class is
      // still drawing from. The ships module owns that teardown.
      if (e._fallbackModel) disposeTree(e.object3D);
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

  /* Order verbs.

     Move, attack-move, attack, guard, patrol, stop/hold, formation and stance,
     each queueable. Two rules govern all of them:

       * A player order is never silently discarded. Nothing in the simulation
         clears an order queue except a new order, the order completing, or its
         subject dying. Automatic behaviour may *suspend* the helm — that is
         what attack-move is for — but the order underneath survives and
         resumes.
       * The verbs mean different things. A move is a move: the helm stays on
         the waypoint and the guns look after themselves. An attack-move hands
         the helm to combat when there is something to fight and takes it back
         when the sky is clear. Collapsing the two is how a fleet ends up
         wandering off after a target of opportunity it was never sent for. */

  commandMove({ ids, point, formation, queue, mode }) {
    const members = this.entitiesByIds(ids);
    if (!members.length || !point) return;
    this.issueMove(members, point, formation, false, {
      queue: queue === true,
      mode: mode === 'attackMove' ? 'attackMove' : 'move',
    });
  }

  commandAttackMove({ ids, point, formation, queue }) {
    const members = this.entitiesByIds(ids);
    if (!members.length || !point) return;
    this.issueMove(members, point, formation, false, {
      queue: queue === true,
      mode: 'attackMove',
    });
  }

  /** Shared by player commands and the AI commander. */
  issueMove(members, point, formation, keepStance, opts) {
    if (!members.length) return;
    const o = opts || EMPTY_OPTS;
    const mode = o.mode === 'attackMove' ? 'attackMove' : 'move';
    const queue = o.queue === true;
    const shape = formation || members[0].formation || FORMATION.DELTA;
    const order = assignFormation(members, shape);

    // A queued leg is laid out from where the group will be when it *starts*
    // that leg, not from where it happens to be standing now — otherwise a
    // three-waypoint route keeps the heading of the first leg for all of them.
    _v.set(0, 0, 0);
    for (let i = 0; i < order.length; i++) {
      const tail = queue ? lastWaypoint(order[i]) : null;
      _v.add(tail || order[i].position);
    }
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
      if (!queue) {
        e.orderQueue.length = 0;
        e.forcedTargetId = -1;
        e.station = dest.clone();
      }
      e.orderQueue.push({ type: mode, point: dest, formation: shape });
      e.harvestOrder = false;
      if (!keepStance && e.stance === STANCE.PASSIVE && e.role !== ROLE.RESOURCE &&
          e.role !== ROLE.STRUCTURE) {
        e.stance = STANCE.NEUTRAL;
      }
    }
  }

  commandAttack({ ids, targetId, queue, mode }) {
    if (mode === 'guard') {
      this.commandGuard({ ids, targetId, queue });
      return;
    }
    const members = this.entitiesByIds(ids);
    const target = this.entities.get(targetId);
    if (!members.length || !target) return;
    const append = queue === true;
    for (let i = 0; i < members.length; i++) {
      const e = members[i];
      if (!append) {
        e.orderQueue.length = 0;
        e.forcedTargetId = targetId;
        e.targetId = targetId;
        e.retarget = 0;
        // The mark becomes the leash anchor, or a passive escort would be
        // dragged home by its old station the moment it opened fire.
        e.station = target.position.clone();
      }
      e.orderQueue.push({ type: 'attack', targetId });
      e.combatHelm = true;
      e.harvestOrder = false;
    }
  }

  /**
   * Escort. The wing stations on the anchor, rides with it, and engages
   * anything that comes for it — then falls back to station rather than
   * chasing the survivor across the map.
   */
  commandGuard({ ids, targetId, point, radius, queue }) {
    const members = this.entitiesByIds(ids);
    if (!members.length) return;
    const anchor = targetId === undefined || targetId === null
      ? null
      : this.entities.get(targetId);
    if (!anchor && !point) return;
    const append = queue === true;
    const shape = members[0].formation || FORMATION.SPHERE;
    const order = assignFormation(members, shape);
    const r = radius || 4200;

    for (let i = 0; i < order.length; i++) {
      const e = order[i];
      if (!append) {
        e.orderQueue.length = 0;
        e.forcedTargetId = -1;
      }
      const o = { type: 'guard', targetId: anchor ? anchor.id : -1, radius: r, point: null };
      if (!anchor) {
        o.point = new THREE.Vector3(point.x, point.y, point.z);
        e.station = o.point.clone();
      }
      e.orderQueue.push(o);
      e.harvestOrder = false;
    }
  }

  /**
   * Patrol a closed route, engaging on contact. One point means "between here
   * and there"; the leg heading rotates the formation, so a patrolling wing
   * keeps its shape through the turn.
   */
  commandPatrol({ ids, points, point, formation, queue }) {
    const members = this.entitiesByIds(ids);
    if (!members.length) return;
    const raw = [];
    if (points && points.length) {
      for (let i = 0; i < points.length; i++) {
        raw.push(new THREE.Vector3(points[i].x, points[i].y, points[i].z));
      }
    } else if (point) {
      _v.set(0, 0, 0);
      for (let i = 0; i < members.length; i++) _v.add(members[i].position);
      raw.push(_v.multiplyScalar(1 / members.length).clone());
      raw.push(new THREE.Vector3(point.x, point.y, point.z));
    }
    if (raw.length < 2) return;

    const append = queue === true;
    const shape = formation || members[0].formation || FORMATION.BROAD;
    const order = assignFormation(members, shape);
    const spacing = spacingFor(order);
    const offsets = formationOffsets(shape, order.length, spacing);
    const gid = this._groupSeq++;

    for (let i = 0; i < order.length; i++) {
      const e = order[i];
      const route = new Array(raw.length);
      for (let k = 0; k < raw.length; k++) {
        _v2.subVectors(raw[k], raw[(k - 1 + raw.length) % raw.length]);
        if (_v2.lengthSq() < 1) _v2.copy(WORLD_FWD);
        route[k] = new THREE.Vector3();
        formationWorld(raw[k], _v2, offsets[i], route[k]);
      }
      e.groupId = gid;
      if (!append) {
        e.orderQueue.length = 0;
        e.forcedTargetId = -1;
      }
      // Start on the leg the ship is furthest from finishing, so a wing does
      // not all turn round and fly back to the first marker.
      let start = 0;
      let bestD = Infinity;
      for (let k = 0; k < route.length; k++) {
        const d = e.position.distanceToSquared(route[k]);
        if (d < bestD) {
          bestD = d;
          start = k;
        }
      }
      e.orderQueue.push({
        type: 'patrol',
        points: route,
        index: (start + 1) % route.length,
        formation: shape,
      });
      e.station = route[start].clone();
      e.harvestOrder = false;
      if (e.stance === STANCE.PASSIVE && e.role !== ROLE.RESOURCE &&
          e.role !== ROLE.STRUCTURE) {
        e.stance = STANCE.NEUTRAL;
      }
    }
  }

  /** Stop and hold position. Guns stay hot; the helm stays put. */
  commandStop({ ids }) {
    const members = this.entitiesByIds(ids);
    for (let i = 0; i < members.length; i++) {
      const e = members[i];
      e.orderQueue.length = 0;
      e.forcedTargetId = -1;
      e.station = e.position.clone();
      e.orderQueue.push({ type: 'hold', point: e.position.clone() });
      e.harvestOrder = false;
      setNavHold(e);
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

  /** Formation tightness: a mothership does not need to hit the pixel. */
  _slackFor(e) {
    return (e.radius + 60) / Math.max(0.2, formationTightness(e.role));
  }

  _updateOrders(dt) {
    const list = this.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const q = e.orderQueue;
      if (q.length === 0) {
        e.orderEngage = false;
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
          if (e.forcedTargetId === o.targetId) e.forcedTargetId = -1;
          continue;
        }
        if (e.forcedTargetId !== o.targetId) {
          // A queued attack coming live: adopt the mark and re-anchor the leash.
          e.forcedTargetId = o.targetId;
          e.targetId = o.targetId;
          e.retarget = 0;
          e.station = t.position.clone();
        }
        e.orderEngage = false;
        e.combatHelm = true;
        continue;
      }

      if (o.type === 'guard') {
        const anchor = o.targetId >= 0 ? this.entities.get(o.targetId) : null;
        if (o.targetId >= 0 && (!anchor || !anchor.alive)) {
          q.shift(); // nothing left to escort
          e.orderEngage = false;
          continue;
        }
        _v.copy(anchor ? anchor.position : o.point);
        if (!e.station) e.station = new THREE.Vector3();
        e.station.copy(_v);
        e.orderEngage = true;
        const t = e.targetId >= 0 ? this.entities.get(e.targetId) : null;
        const threat = !!(t && t.alive &&
          t.position.distanceToSquared(_v) < o.radius * o.radius);
        e.combatHelm = threat && e.stance !== STANCE.PASSIVE;
        if (!e.combatHelm) {
          // A slot on the escort's flank, not sitting inside it.
          const slot = e.formationSlot >= 0 ? e.formationSlot : 0;
          const n = Math.max(1, e.formationCount);
          const a = (slot / n) * Math.PI * 2;
          const r = (anchor ? anchor.radius : 0) + e.radius + 280;
          _v3.set(Math.cos(a) * r, ((slot % 3) - 1) * r * 0.3, Math.sin(a) * r).add(_v);
          setNavArrive(e, _v3, 1, e.radius + 60);
          setFacePoint(e, null);
        }
        continue;
      }

      if (o.type === 'hold') {
        e.orderEngage = false;
        // Hold position still fights back — it just does not go anywhere. A
        // fighter parked in front of a target shooting is the tell of a lazy
        // space RTS, so the helm is released the moment there is a mark.
        const contact = e.engaged && e.targetId >= 0 && e.stance !== STANCE.PASSIVE;
        e.combatHelm = contact;
        if (!contact) {
          setNavHold(e);
          setFacePoint(e, null);
        }
        continue;
      }

      if (o.type === 'move' || o.type === 'attackMove' || o.type === 'patrol') {
        const point = o.type === 'patrol' ? o.points[o.index] : o.point;
        const slack = this._slackFor(e);
        // Copy, never alias: `station` is written in place elsewhere, and
        // pointing it at a stored waypoint would let the leash quietly rewrite
        // the order it is supposed to be anchored to.
        if (!e.station) e.station = new THREE.Vector3();
        e.station.copy(point);
        if (e.position.distanceTo(point) < slack && e.speed < e.maxSpeed * 0.14) {
          if (o.type === 'patrol') {
            o.index = (o.index + 1) % o.points.length;
          } else {
            q.shift();
            setNavHold(e);
          }
          e.combatHelm = true;
          continue;
        }
        /* This is the line between the two verbs. A move keeps the helm on the
           waypoint whatever it passes — the guns are independent and fire
           regardless. An attack-move or a patrol hands the helm to combat
           while there is something to fight, and takes it straight back when
           the sky is clear. The order itself is never dropped either way. */
        const engage = o.type !== 'move';
        e.orderEngage = engage;
        const contact = engage && e.engaged && e.targetId >= 0 &&
          e.stance !== STANCE.PASSIVE;
        e.combatHelm = contact;
        if (!contact) {
          // The nav dead-band covers most of the slack so a ship that is there
          // cuts thrust instead of hunting the exact metre, sailing over it
          // and turning back.
          setNavArrive(e, point, 1, slack * 0.55);
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
    updateControl(this, dt);
    updateEconomy(this, dt);
    for (let i = 0; i < this._commanders.length; i++) this._commanders[i].update(dt);
    updateCombat(this, dt);
    updateSteering(this, dt);
    updateIntegration(this, dt);

    this._compact();
    this._sovereignty(dt);
    if (this.tickCount % 15 === 0) this._threatAlerts();
    this._checkVictory();

    bus.emit('sim:tick', { tick: this.tickCount, dt });

    this.stats.tickMs = performance.now() - t0;
    this.stats.entities = this.dense.length;
    this.stats.projectiles = this.projectiles.count;
  }

  /**
   * The sovereignty clock.
   *
   * A skirmish whose only win condition is "grind down the largest object on
   * the map" has one shape, and a 30-minute stalemate at a 12:1 kill ratio is
   * the worst outcome it can produce. This is the second condition, and it is
   * deliberately not a timer, a score or a rubber band: it is *map control*,
   * measured on the contested band that `spawn.js` already puts across the
   * midline and that until now was only ore.
   *
   * Hold more of the middle than your opponent and their sovereignty drains at
   * a rate set by the margin. So a side that wins fights and *stays where it
   * won them* converts that into a clock the other side must answer, and a
   * side that is behind on fleet value can still answer it by taking ground
   * rather than by winning a set-piece it would lose.
   *
   * The numbers that used to be quoted here — "four seams to none is about
   * four and a half minutes, one seam of margin is nearly twenty" — described
   * a four-seam band, and the band became six when the contested-cluster bug
   * was fixed. On a six-seam band the linear rule makes a one-seam margin a
   * forty-minute clock, which is how a match reached the seventy-minute cap
   * with the seams level at 1–1. The live figures now depend on the pacing
   * preset, so they belong in `PACE` at the top of this file, next to the
   * values that produce them, rather than in prose here that cannot be
   * checked.
   *
   * The grace period matters as much as the rate: nothing drains at all for
   * the opening, so the opening is still an opening.
   */
  _sovereignty(dt) {
    if (this.over) return;
    const pace = this.pace || PACE[PACE_DEFAULT];
    if (this.time < pace.grace) return;
    const a = this.teams[0].seams;
    const b = this.teams[1].seams;
    if (a === b) return;
    const total = this.contestedSeams || Math.max(1, a + b);
    const leader = a > b ? 0 : 1;
    const frac = Math.abs(a - b) / total;
    const share = Math.min(1, pace.exp === 1 ? frac : Math.pow(frac, pace.exp));
    const loser = this.teams[leader ^ 1];
    const before = loser.sovereignty;
    loser.sovereignty = Math.max(0, before - share * pace.rate * dt);

    /* The side holding the middle claws its own losses back, slowly. Without
       this the clock is a ratchet: a fleet that gives up the band at minute
       eight and takes it back at minute twenty is still on the same losing
       trajectory, which is the "destined to gradually lose" feeling the whole
       anti-snowball literature is written against. Recovery is deliberately
       far slower than the drain, so retaking ground stops the bleeding while
       only sustained control actually wins. */
    const held = this.teams[leader];
    if (held.sovereignty < 100) {
      held.sovereignty = Math.min(
        100, held.sovereignty + share * pace.rate * SOVEREIGNTY_RECOVERY * dt,
      );
    }

    if (!this.notify) return;
    const mine = loser.id === this.humanTeam;
    for (let i = 0; i < SOVEREIGNTY_WARN.length; i++) {
      const mark = SOVEREIGNTY_WARN[i];
      const bit = 1 << i;
      // Once per threshold per side, ever. Sovereignty recovers, so a plain
      // downward-crossing test would re-announce every swing of the band.
      if (this._sovWarned[loser.id] & bit) continue;
      if (!(before > mark && loser.sovereignty <= mark)) continue;
      this._sovWarned[loser.id] |= bit;
      if (mine) {
        bus.emit('ui:toast', {
          text: `Sovereignty ${mark}% — the contested seams are theirs. Take them back.`,
          kind: mark <= 25 ? 'alarm' : 'warn',
        });
      } else {
        bus.emit('ui:toast', { text: `Enemy sovereignty down to ${mark}%`, kind: 'good' });
      }
    }
  }

  /**
   * Three ways a match ends, and the third is the one that was missing.
   *
   * Base destruction. Sovereignty exhausted. And a called result: once a side
   * has no yards, no collectors and nothing left worth calling a fleet, it
   * cannot come back, and making the player spend twenty minutes hunting the
   * last collector to prove it is the standard tail on a single-condition RTS.
   */
  _checkVictory() {
    if (this.over) return;
    const aliveBase = [false, false];
    for (let t = 0; t < 2; t++) {
      const base = this.entities.get(this.teams[t].baseId);
      aliveBase[t] = !!(base && base.alive);
    }

    let winner = null;
    let reason = '';
    if (!aliveBase[0] || !aliveBase[1]) {
      reason = 'base';
      winner = aliveBase[0] ? 0 : aliveBase[1] ? 1 : -1;
    } else if (this.teams[0].sovereignty <= 0 || this.teams[1].sovereignty <= 0) {
      reason = 'sovereignty';
      const a = this.teams[0].sovereignty;
      const b = this.teams[1].sovereignty;
      winner = a <= 0 && b <= 0 ? -1 : a <= 0 ? 1 : 0;
    } else if (this.tickCount % 30 === 0) {
      for (let t = 0; t < 2 && winner === null; t++) {
        if (this._isBroken(t)) {
          reason = 'attrition';
          winner = t ^ 1;
        }
      }
    }
    if (winner === null) return;

    this.over = true;
    this.winner = winner;
    this.endReason = reason;
    bus.emit('sim:gameOver', { winner: this.winner, reason });
    if (this.notify) {
      const won = this.winner === this.humanTeam;
      const line = this.winner < 0
        ? 'Mutual annihilation.'
        : won ? 'Victory.' : 'Defeat.';
      bus.emit('ui:toast', {
        text: `${line} ${VICTORY_COPY[reason] || ''}`.trim(),
        kind: won ? 'good' : 'alarm',
      });
    }
  }

  /** No yards, no miners, no fleet: there is no route back from here. */
  _isBroken(team) {
    const t = this.teams[team];
    if (t.collectors.size > 0) return false;
    let producers = 0;
    let combat = 0;
    for (let i = 0; i < this.dense.length; i++) {
      const e = this.dense[i];
      if (!e.alive || e.team !== team) continue;
      if (e.def.producer) producers++;
      else if (e.role !== ROLE.RESOURCE && e.role !== ROLE.STRUCTURE) combat += e.def.cost;
    }
    if (producers > 1) return false; // a carrier still standing is a way back
    if (t.credits > SHIPS.collector.cost * 2) return false;
    return combat < BROKEN_FLEET_VALUE;
  }

  syncTransforms(alpha) {
    if (this.headless) return;
    syncMovement(this, alpha);
    if (this._anyBatched) this._syncBatches();
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
      this._releaseSlot(e);
      if (e.object3D) {
        if (e.object3D.parent) e.object3D.parent.remove(e.object3D);
        if (e._fallbackModel) disposeTree(e.object3D);
        e.object3D = null;
      }
    }
    this._batches.clear();
    this._anyBatched = false;
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

const EMPTY_OPTS = {};

/** Where a ship will be standing once its current orders are exhausted. */
function lastWaypoint(e) {
  const q = e.orderQueue;
  for (let i = q.length - 1; i >= 0; i--) {
    const o = q[i];
    if (o.point) return o.point;
    if (o.points && o.points.length) return o.points[o.points.length - 1];
  }
  return null;
}

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

    /* Income is three separate things multiplied together, and they are kept
       apart on purpose so the HUD can state each one.

         incomeBase   difficulty handicap. 1.0 unless the player asked for easy.
         upkeepScale  the anti-snowball brake — a bigger fleet earns less per
                      tonne, continuously, with no threshold to fall off.
         controlScale what the fleet earned by holding the contested band.

       `incomeScale` is the product and is what the economy actually charges. */
    incomeBase: 1,
    upkeepScale: 1,
    controlScale: 1,
    incomeScale: 1,

    /* Field control. `seams` is how many contested clusters this side holds. */
    seams: 0,
    sovereignty: 100,
    repairSpend: 0,
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
