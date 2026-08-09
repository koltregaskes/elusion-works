/**
 * Ashfall — ballistics.
 *
 * Resolves every round fired in the world: the player's (via the `shot` event) and the AI's
 * (via `ballistics.fireEnemy`). Both routes share one tracer: the same spread cone, the same
 * capsule tests, the same wall-penetration marcher, the same falloff curve. That shared code
 * path is deliberate — if the player can shoot through a plywood door, so can the soldier on
 * the other side of it, and the two must agree about where the round came out.
 *
 * Three round behaviours:
 *
 *   1. Hitscan. Carbine and SMG. Resolved inside the frame the trigger broke, because a
 *      hitmarker that arrives a frame late is felt even if it cannot be seen.
 *   2. Stepped ballistic. The DMR. A real projectile with a muzzle velocity, gravity drop and
 *      drag, marched in 4 m segments across frames, each segment raycast. At 120 m the round
 *      is in the air for ~0.15 s and has fallen ~11 cm, so a crossing target needs lead and a
 *      distant one needs holdover. This is the only reason the marksman rifle feels different
 *      to a high-damage carbine.
 *   3. Penetration continuation. Either of the above, restarted past a wall with reduced
 *      energy and a small deflection.
 *
 * Nothing here draws. Impacts go out as `impact` events for fx/audio; enemy hits go out as
 * `hit`; tracers are requested from `fx.spawnTracer`.
 *
 * Zero allocation after construction. Every vector, every result record and every event
 * payload is preallocated at module or factory scope. `new` inside a trace is a defect.
 */

import * as THREE from '../../vendor/three.module.js';
import { SURFACES } from '../world/art.js';

/* ========================================================================== */
/* Tuning                                                                     */
/* ========================================================================== */

/** Longest a hitscan round is traced. The map is 110 x 90 m, so this always over-reaches. */
const MAX_RANGE = 260;
/** Longest a ballistic round may fly before it is retired. */
const MAX_BALLISTIC_RANGE = 340;
/** Segment length for the stepped ballistic march, in metres. Spec'd at 4 m. */
const BALLISTIC_STEP = 4.0;
/** Gravity used for bullet drop. Slightly under the player's 22 m/s² — bullets are not players. */
const BULLET_GRAVITY = 9.81;
/**
 * Velocity-proportional drag, per metre of flight rather than per second, so the retardation
 * is independent of how the frame happens to be sliced. exp(-k * s): a 7.62 loses roughly a
 * fifth of its speed over 200 m, which is about right for a 168 gr match load.
 */
const BULLET_DRAG_PER_M = 0.0011;
/** Default muzzle velocity for a ballistic round when the weapon def does not state one. */
const DEFAULT_MUZZLE_VELOCITY = 840;
/** Tracer flight speed for hitscan weapons. Slow enough to read as travelling, not popping. */
const TRACER_SPEED = 420;
/** One round in three carries a tracer. */
const TRACER_EVERY = 3;
/** Hard cap on how many walls one round may cross. */
const MAX_PENETRATIONS = 2;
/** Below this fraction of muzzle energy the round is not worth continuing. */
const MIN_PEN_ENERGY = 0.14;
/** How far past a surface the continuation trace starts, to avoid re-hitting the exit face. */
const PEN_EXIT_EPS = 0.004;
/** Near-miss radius around the player's head that raises a `whizz`. */
const WHIZZ_RADIUS = 1.2;
/** Inside this the round has effectively hit the player; no whizz, the damage speaks. */
const WHIZZ_MIN = 0.16;

/** Damage multipliers by hit zone. */
const ZONE_HEAD = 2.2;
const ZONE_TORSO = 1.0;
const ZONE_LIMB = 0.85;
/** Enemy rounds into the player's head. Deliberately under the player's own 2.2x: the AI
 *  already gets a first-shot delay, and a 2.2x from an unseen rifleman reads as cheap. */
const ZONE_HEAD_VS_PLAYER = 1.9;

/**
 * Distance falloff. Full damage inside `near`, smoothly rolling to `min` at `far`, flat after.
 *
 *   t = clamp((d - near) / (far - near), 0, 1)
 *   s = t * t * (3 - 2t)                       // smoothstep: zero slope at both ends
 *   mul = 1 - (1 - min) * s
 *
 * Smoothstep rather than a straight line because a linear falloff has a visible kink at the
 * near stop — players feel the exact metre where damage starts dropping and it reads as a
 * bug. The zero-derivative ends make the transition unfindable while the mid-range slope
 * stays steep enough that engagement distance genuinely matters.
 */
const FALLOFF = {
  mk18: { near: 26, far: 62, min: 0.55 },
  vector: { near: 13, far: 33, min: 0.40 },
  dmr14: { near: 72, far: 150, min: 0.82 },
  _default: { near: 22, far: 55, min: 0.50 },
  /** Enemy weapons are gentler at range so being sniped across the yard is survivable. */
  _enemy: { near: 16, far: 46, min: 0.34 },
};

/**
 * Maximum thickness a round will cross, per surface, in metres. Density comes from
 * art.js SURFACES; this is the geometric half of the same story. Concrete is absent on
 * purpose — it is `penetrable: false` and stops the round dead.
 */
const PEN_THICKNESS = {
  wood: 0.20,
  sandbag: 0.34,
  glass: 0.06,
  dirt: 0.26,
  gravel: 0.20,
  metal: 0.035, // 'thin' in SURFACES: sheet steel, corrugated cladding, a container wall
  flesh: 0.50,
};
/** Nominal thickness assumed when the level's raycast cannot resolve an exit face. */
const PEN_FALLBACK_THICKNESS = 0.09;
/**
 * Energy retained = exp(-(density * thickness * K) - hardness * H). Density is g/cm³ from
 * art.js, so the exponent is roughly "areal mass crossed". K is set so 10 cm of pine
 * (0.65) keeps ~75% and 3 cm of steel (7.8) keeps ~46%, which matches how these two feel in
 * a modern shooter: wood is a soft wall, sheet metal is a bad idea but not a wall.
 */
const PEN_DENSITY_K = 4.2;
const PEN_HARDNESS_K = 0.18;
/**
 * Peak angular deflection off a penetration, in radians, scaled by the energy lost. Kept
 * small on purpose: this is an angle, so it is multiplied by everything downrange. At 5 mrad
 * a round that punched a plank at 10 m is still 60 cm wide at 140 m, which is already at the
 * limit of what reads as "the wall spoiled my shot" rather than "the game ignored my aim".
 */
const PEN_DEFLECT = 0.005;
/**
 * Minimum |cos| of the angle between the surface normal and the round for penetration to be
 * attempted. A bullet that grazes a wall at 15° does not punch through it, it skips off — and
 * without this rule a round skimming the ground at a shallow angle "penetrates" the terrain
 * and carries on underneath the map.
 */
const PEN_MIN_INCIDENCE = 0.28;

/* --- Enemy hit capsules ---------------------------------------------------- */

/**
 * Fallback soldier hitbox layout, in metres above the feet for a 1.80 m standing figure.
 * Used only when `ai/enemies.js` does not publish its own capsules; if it does, those win,
 * so headshots track the animated head rather than a guess.
 */
const BODY_STAND_HEIGHT = 1.80;
const BODY = {
  headY0: 1.545,
  headY1: 1.700,
  headR: 0.118,
  // The torso segment stops at the collarbone, not the neck: its spherical cap adds another
  // 0.215 m on top, and if the segment ran to shoulder height that cap would enclose the
  // whole head and make a headshot geometrically impossible. Costing an hour of confusion in
  // any project that gets this wrong.
  torsoY0: 0.960,
  torsoY1: 1.340,
  torsoR: 0.215,
  legsY0: 0.075,
  legsY1: 0.955,
  legsR: 0.170,
  armY0: 1.030,
  armY1: 1.430,
  armR: 0.088,
  armX: 0.258,
};
/** Crouched soldiers keep their girth but lose height. */
const CROUCH_SCALE = 0.70;

const MAX_CAPS = 8;
const CAP_STRIDE = 8; // ax, ay, az, bx, by, bz, r, zone

const ZONE_ID_HEAD = 0;
const ZONE_ID_TORSO = 1;
const ZONE_ID_LIMB = 2;
const ZONE_NAMES = ['head', 'torso', 'limb'];

/** Broadphase: skip an enemy whose bounding cylinder cannot possibly be within this of the ray. */
const ENEMY_BROAD_RADIUS = 1.15;
/**
 * Distance, in metres, by which a head hit outranks a nearer body hit on the same actor.
 * Overlapping capsules are unavoidable around the neck and shoulders, and "nearest wins"
 * there resolves almost every neck shot as a torso hit. Every shooter worth the name gives
 * the head priority; a player who put the dot on the head and got a body hitmarker is
 * certain the game is broken, and on the evidence available to them they are right.
 */
const HEAD_PRIORITY = 0.35;

/** Pending ballistic projectiles. Well over the DMR's ability to have rounds in the air. */
const MAX_PROJECTILES = 48;

/* ========================================================================== */
/* Module-scope scratch — nothing below allocates once the factory has run     */
/* ========================================================================== */

const _traceOrigin = new THREE.Vector3();
const _traceDir = new THREE.Vector3();
const _probeOrigin = new THREE.Vector3();
const _probeDir = new THREE.Vector3();
const _entry = new THREE.Vector3();
const _exit = new THREE.Vector3();
const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fxFrom = new THREE.Vector3();
const _fxTo = new THREE.Vector3();
const _fxDir = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
/** Terminal point of the last resolved hitscan round — the tracer's endpoint. */
const _endPoint = new THREE.Vector3();
/** Predicted terminal point of a ballistic round, for its tracer. */
const _predEnd = new THREE.Vector3();
const _capBuf = new Float32Array(MAX_CAPS * CAP_STRIDE);
const _emptyArray = [];

/** World-up reference for building a tangent basis; swapped when the ray is near-vertical. */
const WORLD_UP_X = 0;
const WORLD_UP_Y = 1;
const WORLD_UP_Z = 0;

/* ========================================================================== */
/* Small maths helpers                                                        */
/* ========================================================================== */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function smoothstep01(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * xorshift32. Deterministic, seeded once, ~2 ns a call. Math.random() is fine for feel but a
 * fixed stream makes a recorded firing sequence reproducible, which matters when you are
 * tuning a recoil pattern against a spread cone.
 */
function makeRandom(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return function random() {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Nearest non-negative root of a ray against a sphere, or -1. */
function raySphere(rox, roy, roz, rdx, rdy, rdz, cx, cy, cz, r) {
  const ox = rox - cx;
  const oy = roy - cy;
  const oz = roz - cz;
  const b = ox * rdx + oy * rdy + oz * rdz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const sh = Math.sqrt(h);
  const t0 = -b - sh;
  if (t0 >= 0) return t0;
  const t1 = -b + sh;
  return t1 >= 0 ? t1 : -1;
}

/**
 * Ray against a capsule (segment pa->pb, radius r). Returns the entry distance or -1.
 *
 * The finite cylinder is solved in the "ba" frame (Inigo Quilez's formulation), then both
 * spherical caps are tested and the nearest root wins. Testing the caps unconditionally
 * costs two extra quadratics and removes every degenerate case — a ray parallel to the
 * capsule axis, a ray starting inside, a zero-length segment — which is worth far more than
 * the nanoseconds saved by branching around them.
 *
 * This is a real intersection, not a closest-approach test: the returned distance is where
 * the round enters the limb, so blood and decals land on the surface rather than the spine.
 */
function rayCapsule(rox, roy, roz, rdx, rdy, rdz, pax, pay, paz, pbx, pby, pbz, r) {
  const bax = pbx - pax;
  const bay = pby - pay;
  const baz = pbz - paz;
  const oax = rox - pax;
  const oay = roy - pay;
  const oaz = roz - paz;

  const baba = bax * bax + bay * bay + baz * baz;
  let best = Infinity;

  if (baba > 1e-9) {
    const bard = bax * rdx + bay * rdy + baz * rdz;
    const baoa = bax * oax + bay * oay + baz * oaz;
    const rdoa = rdx * oax + rdy * oay + rdz * oaz;
    const oaoa = oax * oax + oay * oay + oaz * oaz;

    const a = baba - bard * bard;
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - r * r * baba;

    if (a > 1e-9) {
      const h = b * b - a * c;
      if (h >= 0) {
        const t = (-b - Math.sqrt(h)) / a;
        const y = baoa + t * bard;
        // Only the barrel of the cylinder; the caps handle the ends.
        if (t >= 0 && y > 0 && y < baba) best = t;
      }
    }
  }

  const ta = raySphere(rox, roy, roz, rdx, rdy, rdz, pax, pay, paz, r);
  if (ta >= 0 && ta < best) best = ta;
  const tb = raySphere(rox, roy, roz, rdx, rdy, rdz, pbx, pby, pbz, r);
  if (tb >= 0 && tb < best) best = tb;

  return best === Infinity ? -1 : best;
}

/** Squared distance from `p` to the segment o -> o + d*len. `d` must be unit length. */
function pointSegmentDistanceSq(px, py, pz, ox, oy, oz, dx, dy, dz, len) {
  const wx = px - ox;
  const wy = py - oy;
  const wz = pz - oz;
  let t = wx * dx + wy * dy + wz * dz;
  if (t < 0) t = 0;
  else if (t > len) t = len;
  const ex = wx - dx * t;
  const ey = wy - dy * t;
  const ez = wz - dz * t;
  return ex * ex + ey * ey + ez * ez;
}

/** Build an orthonormal tangent basis for `dir` into `_right` / `_up`. */
function tangentBasis(dx, dy, dz) {
  // Cross with world up unless we are looking almost straight up or down, in which case the
  // cross degenerates and we swap to the Z axis as the reference.
  let ax = WORLD_UP_X;
  let ay = WORLD_UP_Y;
  let az = WORLD_UP_Z;
  if (dy > 0.995 || dy < -0.995) {
    ax = 0;
    ay = 0;
    az = 1;
  }
  let rx = dy * az - dz * ay;
  let ry = dz * ax - dx * az;
  let rz = dx * ay - dy * ax;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  _right.set(rx, ry, rz);
  _up.set(ry * dz - rz * dy, rz * dx - rx * dz, rx * dy - ry * dx);
}

/* ========================================================================== */
/* Result records                                                             */
/* ========================================================================== */

const TRACE_NONE = 0;
const TRACE_WORLD = 1;
const TRACE_ACTOR = 2;

function makeTraceResult() {
  return {
    type: TRACE_NONE,
    distance: 0,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    surface: 'concrete',
    actor: null,
    zone: ZONE_ID_TORSO,
  };
}

/* ========================================================================== */
/* Factory                                                                    */
/* ========================================================================== */

export function createBallistics(game) {
  const random = makeRandom(0xba11 ^ 0x5eed);

  /* --- preallocated state ------------------------------------------------ */

  const trace = makeTraceResult();

  /** Ring of event payloads, so a listener that keeps one for a frame is not clobbered. */
  const RING = 6;
  const impactPayloads = [];
  const hitPayloads = [];
  const damagePayloads = [];
  const whizzPayloads = [];
  for (let i = 0; i < RING; i++) {
    impactPayloads.push({
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      surface: 'concrete',
      material: null,
      penetrated: false,
      energy: 1,
      distance: 0,
      fromPlayer: true,
    });
    hitPayloads.push({
      enemy: null,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      damage: 0,
      headshot: false,
      zone: 'torso',
      distance: 0,
      penetrated: false,
      weapon: null,
      handled: false,
    });
    damagePayloads.push({
      amount: 0,
      from: null,
      dir: new THREE.Vector3(),
      point: new THREE.Vector3(),
      headshot: false,
      zone: 'torso',
      distance: 0,
    });
    whizzPayloads.push({
      point: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      distance: 0,
      speed: TRACER_SPEED,
      from: null,
    });
  }
  let ringImpact = 0;
  let ringHit = 0;
  let ringDamage = 0;
  let ringWhizz = 0;

  /* --- projectile pool --------------------------------------------------- */

  const pool = new Array(MAX_PROJECTILES);
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    pool[i] = {
      active: false,
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      dir: new THREE.Vector3(), // normalised velocity, kept in sync for the trace
      def: null,
      damage: 0,
      energy: 1,
      travelled: 0,
      life: 0,
      penetrations: 0,
      fromPlayer: true,
      owner: null,
      tracer: false,
    };
  }
  let activeProjectiles = 0;

  /* --- counters ---------------------------------------------------------- */

  let roundCounter = 0;
  let lastPlayerShotTime = -10;
  const stats = {
    rounds: 0,
    worldImpacts: 0,
    enemyHits: 0,
    headshots: 0,
    penetrations: 0,
    projectiles: 0,
  };

  /* ====================================================================== */
  /* Environment accessors — every one of these tolerates a missing sibling   */
  /* ====================================================================== */

  function levelRaycast(origin, dir, maxDist) {
    const lvl = game.level;
    if (!lvl || typeof lvl.raycast !== 'function') return null;
    let r = null;
    try {
      r = lvl.raycast(origin, dir, maxDist);
    } catch {
      return null;
    }
    if (!r) return null;
    if (r.hit === false) return null;
    if (!r.point) return null;
    return r;
  }

  function surfaceAt(point, normal, fallback) {
    const lvl = game.level;
    if (lvl && typeof lvl.sampleSurface === 'function') {
      try {
        const s = lvl.sampleSurface(point, normal);
        if (s) return s;
      } catch {
        /* level stub */
      }
    }
    return fallback || 'concrete';
  }

  function enemies() {
    const list = game.ai && game.ai.enemies;
    return Array.isArray(list) ? list : _emptyArray;
  }

  function isAlive(e) {
    if (!e) return false;
    if (e.dead === true) return false;
    if (e.alive === false) return false;
    if (e.state === 'dead' || e.fsm === 'dead') return false;
    const h = readHealth(e);
    if (Number.isFinite(h) && h <= 0) return false;
    return true;
  }

  function readHealth(e) {
    if (!e) return NaN;
    if (typeof e.health === 'number') return e.health;
    if (typeof e.hp === 'number') return e.hp;
    if (typeof e.hitpoints === 'number') return e.hitpoints;
    return NaN;
  }

  /** World-space feet position of an enemy into `out`. Returns false if we cannot find one. */
  function enemyFeet(e, out) {
    if (e.position && typeof e.position.x === 'number') {
      out.set(e.position.x, e.position.y, e.position.z);
      return true;
    }
    const node = e.root || e.group || e.object3D || e.mesh;
    if (node && node.getWorldPosition) {
      try {
        node.getWorldPosition(out);
        return true;
      } catch {
        return false;
      }
    }
    if (node && node.position) {
      out.copy(node.position);
      return true;
    }
    return false;
  }

  function enemyYaw(e) {
    if (typeof e.yaw === 'number') return e.yaw;
    const node = e.root || e.group || e.object3D;
    if (node && node.rotation) return node.rotation.y;
    return 0;
  }

  function enemyHeight(e) {
    if (typeof e.height === 'number' && e.height > 0.5) return e.height;
    return BODY_STAND_HEIGHT;
  }

  function enemyCrouched(e) {
    return e.crouched === true || e.stance === 'crouch' || e.stance === 'CROUCH' || e.prone === true;
  }

  /* ====================================================================== */
  /* Hit capsules                                                            */
  /* ====================================================================== */

  function pushCap(i, ax, ay, az, bx, by, bz, r, zone) {
    if (i >= MAX_CAPS) return i;
    const o = i * CAP_STRIDE;
    _capBuf[o] = ax;
    _capBuf[o + 1] = ay;
    _capBuf[o + 2] = az;
    _capBuf[o + 3] = bx;
    _capBuf[o + 4] = by;
    _capBuf[o + 5] = bz;
    _capBuf[o + 6] = r;
    _capBuf[o + 7] = zone;
    return i + 1;
  }

  function zoneIdOf(name) {
    if (!name) return ZONE_ID_TORSO;
    const n = String(name).toLowerCase();
    if (n === 'head' || n === 'helmet' || n === 'neck') return ZONE_ID_HEAD;
    if (n === 'torso' || n === 'chest' || n === 'body' || n === 'pelvis') return ZONE_ID_TORSO;
    return ZONE_ID_LIMB;
  }

  /**
   * Fill `_capBuf` with an enemy's world-space hit capsules and return how many there are.
   *
   * Preference order:
   *   1. `enemy.getHitCapsules()` / `enemy.hitCapsules` published by ai/enemies.js. If the AI
   *      drives a bone hierarchy, this is where the animated head really is, so headshots on
   *      a leaning or flinching soldier land where they look like they should.
   *   2. Derived from the transform, with the head pinned to `enemy.head` if that Object3D
   *      exists.
   */
  function buildCapsules(e) {
    let list = null;
    if (typeof e.getHitCapsules === 'function') {
      try {
        list = e.getHitCapsules();
      } catch {
        list = null;
      }
    }
    if (!list) list = e.hitCapsules || e.capsules || e.hitboxes || null;

    if (Array.isArray(list) && list.length) {
      let n = 0;
      for (let i = 0; i < list.length && n < MAX_CAPS; i++) {
        const c = list[i];
        if (!c) continue;
        const a = c.a || c.start || c.top;
        const b = c.b || c.end || c.bottom;
        const r = c.r ?? c.radius ?? 0.16;
        if (!a || !b || typeof a.x !== 'number' || typeof b.x !== 'number') continue;
        n = pushCap(n, a.x, a.y, a.z, b.x, b.y, b.z, r, zoneIdOf(c.zone || c.name || c.kind));
      }
      if (n > 0) return n;
    }

    /* --- derived layout ------------------------------------------------- */
    if (!enemyFeet(e, _tmpA)) return 0;
    const fx = _tmpA.x;
    const fy = _tmpA.y;
    const fz = _tmpA.z;
    const scale = (enemyHeight(e) / BODY_STAND_HEIGHT) * (enemyCrouched(e) ? CROUCH_SCALE : 1);

    const yaw = enemyYaw(e);
    // Body right vector on the ground plane. Enemies face -Z at yaw 0, matching the camera
    // convention used everywhere else in the project.
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    let n = 0;

    // Head. If the AI exposes a head node, use its real world position — this is what makes
    // a headshot on a soldier who is peeking or flinching land correctly.
    let headSet = false;
    const headNode = e.head || e.headBone || (e.parts && e.parts.head) || (e.bones && e.bones.head);
    if (headNode && headNode.getWorldPosition) {
      try {
        headNode.getWorldPosition(_tmpB);
        n = pushCap(
          n,
          _tmpB.x,
          _tmpB.y - 0.055 * scale,
          _tmpB.z,
          _tmpB.x,
          _tmpB.y + 0.055 * scale,
          _tmpB.z,
          BODY.headR * scale,
          ZONE_ID_HEAD
        );
        headSet = true;
      } catch {
        headSet = false;
      }
    }
    if (!headSet) {
      n = pushCap(
        n,
        fx,
        fy + BODY.headY0 * scale,
        fz,
        fx,
        fy + BODY.headY1 * scale,
        fz,
        BODY.headR * scale,
        ZONE_ID_HEAD
      );
    }

    // Torso.
    n = pushCap(
      n,
      fx,
      fy + BODY.torsoY0 * scale,
      fz,
      fx,
      fy + BODY.torsoY1 * scale,
      fz,
      BODY.torsoR * scale,
      ZONE_ID_TORSO
    );

    // Legs as one capsule — two would be more correct and less useful, since a round that
    // splits the knees should miss, and with two thin capsules it does.
    n = pushCap(
      n,
      fx,
      fy + BODY.legsY0 * scale,
      fz,
      fx,
      fy + BODY.legsY1 * scale,
      fz,
      BODY.legsR * scale,
      ZONE_ID_LIMB
    );

    // Arms, offset along the body's right vector.
    const ax = BODY.armX * scale;
    n = pushCap(
      n,
      fx + rx * ax,
      fy + BODY.armY0 * scale,
      fz + rz * ax,
      fx + rx * ax,
      fy + BODY.armY1 * scale,
      fz + rz * ax,
      BODY.armR * scale,
      ZONE_ID_LIMB
    );
    n = pushCap(
      n,
      fx - rx * ax,
      fy + BODY.armY0 * scale,
      fz - rz * ax,
      fx - rx * ax,
      fy + BODY.armY1 * scale,
      fz - rz * ax,
      BODY.armR * scale,
      ZONE_ID_LIMB
    );

    return n;
  }

  /** Fill `_capBuf` with the player's hit capsules. Returns the count. */
  function buildPlayerCapsules() {
    const p = game.player;
    if (!p) return 0;
    const pos = p.position;
    const eye = p.eye || pos;
    if (!pos || typeof pos.x !== 'number') return 0;
    const h = typeof p.height === 'number' && p.height > 0.5 ? p.height : 1.8;
    // The movement capsule is 0.35 m; using it as a hitbox makes the player feel wide. The
    // damage capsule is deliberately slimmer than the collision one.
    const r = Math.min(0.30, (typeof p.radius === 'number' ? p.radius : 0.35) * 0.86);

    let n = 0;
    n = pushCap(n, eye.x, eye.y - 0.06, eye.z, eye.x, eye.y + 0.07, eye.z, 0.145, ZONE_ID_HEAD);
    // Same rule as the enemy torso: the segment stops well below the neck so its cap does
    // not enclose the head capsule. h - 0.60 puts the cap top at roughly the collarbone.
    n = pushCap(
      n,
      pos.x,
      pos.y + h * 0.5,
      pos.z,
      pos.x,
      pos.y + Math.max(h * 0.55, h - 0.60),
      pos.z,
      r,
      ZONE_ID_TORSO
    );
    // Legs, so incoming fire below the hips takes the same 0.85 limb reduction the AI gets.
    // Without this the torso capsule's lower cap reaches the ankles and every leg hit is a
    // full-damage body shot, which is exactly the sort of asymmetry players smell.
    n = pushCap(
      n,
      pos.x,
      pos.y + 0.10,
      pos.z,
      pos.x,
      pos.y + h * 0.5,
      pos.z,
      r * 0.72,
      ZONE_ID_LIMB
    );
    return n;
  }

  /* ====================================================================== */
  /* The trace                                                               */
  /* ====================================================================== */

  /**
   * Trace one straight segment against the world and against actors, writing the nearest
   * hit of either kind into `out`.
   *
   * `targets`: 0 = world only, 1 = world + enemies, 2 = world + player.
   * `ignore`: an actor to skip (the shooter).
   */
  function traceSegment(ox, oy, oz, dx, dy, dz, maxDist, targets, ignore, out) {
    out.type = TRACE_NONE;
    out.actor = null;
    out.distance = maxDist;

    let best = maxDist;

    /* --- world ---------------------------------------------------------- */
    _traceOrigin.set(ox, oy, oz);
    _traceDir.set(dx, dy, dz);
    const wr = levelRaycast(_traceOrigin, _traceDir, maxDist);
    if (wr) {
      // level.raycast is entitled to return a reused record, so copy immediately: the enemy
      // loop below may call raycast again before we are done with these numbers.
      const d = typeof wr.distance === 'number' ? wr.distance : _traceOrigin.distanceTo(wr.point);
      if (d >= 0 && d <= best) {
        best = d;
        out.type = TRACE_WORLD;
        out.distance = d;
        out.point.copy(wr.point);
        if (wr.normal) out.normal.copy(wr.normal);
        else out.normal.set(-dx, -dy, -dz);
        out.surface = wr.surface || surfaceAt(out.point, out.normal, 'concrete');
      }
    }

    /* --- actors --------------------------------------------------------- */
    if (targets === 1) {
      const list = enemies();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e || e === ignore || !isAlive(e)) continue;

        // Broadphase: reject on the perpendicular distance from the ray to the enemy's
        // bounding cylinder centre before touching the capsules.
        if (!enemyFeet(e, _tmpC)) continue;
        const hh = enemyHeight(e) * (enemyCrouched(e) ? CROUCH_SCALE : 1);
        const cy = _tmpC.y + hh * 0.5;
        const wx = _tmpC.x - ox;
        const wy = cy - oy;
        const wz = _tmpC.z - oz;
        const along = wx * dx + wy * dy + wz * dz;
        if (along < -2 || along > best + 2) continue;
        const ex = wx - dx * along;
        const ey = wy - dy * along;
        const ez = wz - dz * along;
        const perpSq = ex * ex + ey * ey + ez * ez;
        const broad = ENEMY_BROAD_RADIUS + hh * 0.5;
        if (perpSq > broad * broad) continue;

        best = testCapsules(buildCapsules(e), ox, oy, oz, dx, dy, dz, best, e, out);
      }
    } else if (targets === 2) {
      const p = game.player;
      if (p && p !== ignore && !(game.state && game.state.mode === 'dead')) {
        best = testCapsules(buildPlayerCapsules(), ox, oy, oz, dx, dy, dz, best, p, out);
      }
    }

    return out.type;
  }

  /**
   * Test the capsules sitting in `_capBuf` against the ray. If one is nearer than `best`, the
   * winner is committed to `out` and its distance returned; otherwise `best` comes back
   * unchanged. The head outranks any body capsule within HEAD_PRIORITY of it — see the
   * constant for why that matters more than strict nearest-hit ordering.
   */
  function testCapsules(n, ox, oy, oz, dx, dy, dz, best, actor, out) {
    let capT = Infinity;
    let capOff = -1;
    let capZone = ZONE_ID_TORSO;

    for (let c = 0; c < n; c++) {
      const o = c * CAP_STRIDE;
      const t = rayCapsule(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        _capBuf[o],
        _capBuf[o + 1],
        _capBuf[o + 2],
        _capBuf[o + 3],
        _capBuf[o + 4],
        _capBuf[o + 5],
        _capBuf[o + 6]
      );
      if (t < 0 || t > best) continue;
      const zone = _capBuf[o + 7];

      if (capOff < 0) {
        capT = t;
        capOff = o;
        capZone = zone;
        continue;
      }
      if (zone === ZONE_ID_HEAD && capZone !== ZONE_ID_HEAD) {
        if (t < capT + HEAD_PRIORITY) {
          capT = t;
          capOff = o;
          capZone = zone;
        }
        continue;
      }
      if (capZone === ZONE_ID_HEAD && zone !== ZONE_ID_HEAD) {
        if (capT < t + HEAD_PRIORITY) continue;
      }
      if (t < capT) {
        capT = t;
        capOff = o;
        capZone = zone;
      }
    }

    if (capOff < 0) return best;

    out.type = TRACE_ACTOR;
    out.distance = capT;
    out.actor = actor;
    out.zone = capZone;
    out.surface = 'flesh';
    out.point.set(ox + dx * capT, oy + dy * capT, oz + dz * capT);
    // Surface normal on the capsule: from the nearest point on its axis out to the hit.
    closestOnSegment(
      out.point.x,
      out.point.y,
      out.point.z,
      _capBuf[capOff],
      _capBuf[capOff + 1],
      _capBuf[capOff + 2],
      _capBuf[capOff + 3],
      _capBuf[capOff + 4],
      _capBuf[capOff + 5],
      _tmpB
    );
    out.normal.set(out.point.x - _tmpB.x, out.point.y - _tmpB.y, out.point.z - _tmpB.z);
    if (out.normal.lengthSq() < 1e-8) out.normal.set(-dx, -dy, -dz);
    else out.normal.normalize();
    return capT;
  }

  function closestOnSegment(px, py, pz, ax, ay, az, bx, by, bz, out) {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const len2 = abx * abx + aby * aby + abz * abz;
    if (len2 < 1e-9) {
      out.set(ax, ay, az);
      return;
    }
    let t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2;
    t = clamp(t, 0, 1);
    out.set(ax + abx * t, ay + aby * t, az + abz * t);
  }

  /* ====================================================================== */
  /* Penetration                                                             */
  /* ====================================================================== */

  /**
   * Find where a round that entered at `_entry` travelling along (dx,dy,dz) leaves the
   * surface, writing the exit into `_exit`. Returns the thickness crossed, or -1 if the
   * material is thicker than the round can manage.
   *
   * Three strategies, cheapest first, because we do not control how `world/level.js` builds
   * its raycast and it may or may not report back faces:
   *
   *   A. One reverse ray from the far side of the maximum thickness. Works when the raycast
   *      only reports front faces, which is the common case for a triangle-soup BVH that
   *      culls by winding.
   *   B. One forward ray from just inside the wall. Works when the raycast is double sided,
   *      and is rejected unless the hit is a back face (n . dir > 0) so we do not mistake the
   *      near face of a second object across an air gap for an exit.
   *   C. The stepped march: walk forward in small increments, probing each step. Slower, but
   *      it copes with fragmented geometry where a wall is several overlapping slabs.
   */
  function findExit(dx, dy, dz, maxThick) {
    const ex = _entry.x;
    const ey = _entry.y;
    const ez = _entry.z;

    /* A — reverse ray from beyond the far face. */
    const over = maxThick + 0.03;
    _probeOrigin.set(ex + dx * over, ey + dy * over, ez + dz * over);
    _probeDir.set(-dx, -dy, -dz);
    let r = levelRaycast(_probeOrigin, _probeDir, over);
    if (r) {
      const d = typeof r.distance === 'number' ? r.distance : _probeOrigin.distanceTo(r.point);
      const thick = over - d;
      if (thick > 0.001 && thick <= maxThick + 1e-4) {
        _exit.set(ex + dx * thick, ey + dy * thick, ez + dz * thick);
        return thick;
      }
    }

    /* B — forward ray from just inside, accepting only a back face. */
    const eps = 0.006;
    _probeOrigin.set(ex + dx * eps, ey + dy * eps, ez + dz * eps);
    _probeDir.set(dx, dy, dz);
    r = levelRaycast(_probeOrigin, _probeDir, maxThick);
    if (r) {
      const d = typeof r.distance === 'number' ? r.distance : _probeOrigin.distanceTo(r.point);
      const facing = r.normal ? r.normal.x * dx + r.normal.y * dy + r.normal.z * dz : 1;
      const thick = eps + d;
      if (facing > 0.02 && thick > 0.001 && thick <= maxThick + 1e-4) {
        _exit.set(ex + dx * thick, ey + dy * thick, ez + dz * thick);
        return thick;
      }
    }

    /* C — stepped march. */
    const step = clamp(maxThick / 8, 0.012, 0.05);
    for (let t = step; t <= maxThick + 1e-6; t += step) {
      _probeOrigin.set(ex + dx * t, ey + dy * t, ez + dz * t);
      // Probe backwards over just over one step. Once the probe has emerged from the far
      // side, this catches the exit face from outside — which every raycast reports,
      // whatever its culling. Starting at t = step keeps the entry face out of reach.
      _probeDir.set(-dx, -dy, -dz);
      r = levelRaycast(_probeOrigin, _probeDir, step * 1.02);
      if (r) {
        const d = typeof r.distance === 'number' ? r.distance : _probeOrigin.distanceTo(r.point);
        const thick = t - d;
        if (thick > 0.001) {
          _exit.set(ex + dx * thick, ey + dy * thick, ez + dz * thick);
          return thick;
        }
      }
    }

    /* D — nothing resolved. Rather than eating the round, assume a nominal thickness so a
       thin prop with a one-sided collider still behaves like a thin prop. */
    const nominal = Math.min(maxThick, PEN_FALLBACK_THICKNESS);
    if (nominal <= 0) return -1;
    _exit.set(ex + dx * nominal, ey + dy * nominal, ez + dz * nominal);
    return nominal;
  }

  /** Energy retained after crossing `thickness` of `surface`, or 0 if it stops the round. */
  function penetrationEnergy(surface, thickness) {
    const s = SURFACES[surface];
    if (!s || !s.penetrable) return 0;
    const density = s.density || 1;
    const hardness = s.hardness || 0;
    const e = Math.exp(-(density * thickness * PEN_DENSITY_K) - hardness * PEN_HARDNESS_K);
    return e;
  }

  function maxThicknessFor(surface) {
    const s = SURFACES[surface];
    if (!s || !s.penetrable) return 0;
    let t = PEN_THICKNESS[surface];
    if (t === undefined) t = s.penetrable === 'thin' ? 0.04 : 0.15;
    return t;
  }

  /* ====================================================================== */
  /* Events                                                                  */
  /* ====================================================================== */

  function emit(name, payload) {
    const ev = game.events;
    if (!ev || typeof ev.emit !== 'function') return;
    try {
      ev.emit(name, payload);
    } catch {
      /* an exploding listener is not ballistics' problem */
    }
  }

  function emitImpact(px, py, pz, nx, ny, nz, dx, dy, dz, surface, penetrated, energy, dist, fromPlayer) {
    const p = impactPayloads[ringImpact];
    ringImpact = (ringImpact + 1) % RING;
    p.point.set(px, py, pz);
    p.normal.set(nx, ny, nz);
    p.dir.set(dx, dy, dz);
    p.surface = surface;
    p.material = SURFACES[surface] || null;
    p.penetrated = penetrated;
    p.energy = energy;
    p.distance = dist;
    p.fromPlayer = fromPlayer;
    stats.worldImpacts++;
    emit('impact', p);
  }

  /**
   * Apply damage to an enemy. `hit` is the documented channel, but ai/enemies.js is written
   * in parallel and may prefer its `damageEnemy` entry point, so we detect: if the enemy's
   * health moved during the emit — or the listener set `handled` — the AI owns it and we do
   * not double-apply.
   */
  function applyEnemyHit(enemy, damage, zoneId, dx, dy, dz, distance, penetrated, def) {
    const headshot = zoneId === ZONE_ID_HEAD;
    const before = readHealth(enemy);

    const p = hitPayloads[ringHit];
    ringHit = (ringHit + 1) % RING;
    p.enemy = enemy;
    p.point.copy(_hitPoint);
    p.normal.copy(_hitNormal);
    p.dir.set(dx, dy, dz);
    p.damage = damage;
    p.headshot = headshot;
    p.zone = ZONE_NAMES[zoneId] || 'torso';
    p.distance = distance;
    p.penetrated = penetrated;
    p.weapon = def || null;
    p.handled = false;

    stats.enemyHits++;
    if (headshot) stats.headshots++;

    emit('hit', p);

    const after = readHealth(enemy);
    const consumed =
      p.handled === true ||
      (Number.isFinite(before) && Number.isFinite(after) && after < before - 1e-6);
    if (!consumed && game.ai && typeof game.ai.damageEnemy === 'function') {
      _fxDir.set(dx, dy, dz);
      try {
        game.ai.damageEnemy(enemy, damage, _hitPoint, headshot, _fxDir);
      } catch {
        /* ai stub */
      }
    }

    // fx does not listen for `hit` (see the event table), so blood is requested directly.
    try {
      game.fx?.spawnBlood?.(_hitPoint, _hitNormal, _fxDir.set(dx, dy, dz));
    } catch {
      /* fx stub */
    }
  }

  function applyPlayerHit(damage, zoneId, dx, dy, dz, distance, owner) {
    const headshot = zoneId === ZONE_ID_HEAD;
    const p = damagePayloads[ringDamage];
    ringDamage = (ringDamage + 1) % RING;
    p.amount = damage;
    p.from = owner || null;
    p.dir.set(dx, dy, dz);
    p.point.copy(_hitPoint);
    p.headshot = headshot;
    p.zone = ZONE_NAMES[zoneId] || 'torso';
    p.distance = distance;

    // controller.js de-duplicates a direct call followed by the event in the same frame, so
    // doing both is safe and means the player still takes the round if either path is stubbed.
    try {
      game.player?.damage?.(damage, p.dir);
    } catch {
      /* controller stub */
    }
    emit('damage', p);
  }

  function emitWhizz(px, py, pz, dx, dy, dz, distance, owner, speed) {
    const p = whizzPayloads[ringWhizz];
    ringWhizz = (ringWhizz + 1) % RING;
    p.point.set(px, py, pz);
    p.dir.set(dx, dy, dz);
    p.distance = distance;
    p.speed = speed;
    p.from = owner || null;
    emit('whizz', p);
  }

  /* ====================================================================== */
  /* Spread                                                                  */
  /* ====================================================================== */

  /**
   * Deflect (dx,dy,dz) into a cone of half-angle `spread`, writing the result to `_traceDir`.
   *
   * Sampling the disc: a naive `r = random()` puts far too many rounds near the axis, because
   * the area of an annulus grows with r. For a uniform distribution over the disc the radial
   * CDF is F(r) = r², so the inverse transform is r = sqrt(u). That single sqrt is the
   * difference between a cone that reads as a cone and one that reads as a dense core with a
   * few strays — the latter is what a player notices as "the spread indicator is lying".
   *
   *   u1, u2 ~ U(0,1)
   *   r     = sqrt(u1)          // uniform over area
   *   theta = 2 * pi * u2
   *   offset = tan(spread) * r * (right * cos(theta) + up * sin(theta))
   *
   * The offset is scaled by tan(spread) rather than spread itself so that the rim of the cone
   * sits at exactly `spread` radians off axis after re-normalisation, at any cone width.
   */
  function applySpread(dx, dy, dz, spread) {
    if (!(spread > 1e-6)) {
      _traceDir.set(dx, dy, dz);
      return;
    }
    const r = Math.sqrt(random());
    const theta = random() * Math.PI * 2;
    const t = Math.tan(spread) * r;
    const cx = Math.cos(theta) * t;
    const cy = Math.sin(theta) * t;
    tangentBasis(dx, dy, dz);
    _traceDir.set(
      dx + _right.x * cx + _up.x * cy,
      dy + _right.y * cx + _up.y * cy,
      dz + _right.z * cx + _up.z * cy
    );
    _traceDir.normalize();
  }

  /**
   * The live cone half-angle for this round.
   *
   * The weapon already folds stance, movement, air time, ADS blend and sustained-fire bloom
   * into `payload.spread`; we take that as the authority and only add the one rule it cannot
   * express: a first shot taken fully aimed and fully stationary is *perfect*. Not "0.001 rad
   * so it's basically perfect" — exactly zero, so a lined-up head at 90 m is a guaranteed
   * kill and the player can trust the sight picture. Everything else in the game punishes
   * moving and spraying; this is the reward for not doing either.
   */
  function effectiveSpread(reported, def) {
    let src = reported;
    if (typeof src !== 'number' && game.weapon && typeof game.weapon.spread === 'number') {
      src = game.weapon.spread;
    }
    let spread = typeof src === 'number' && src >= 0 ? src : 0.03;
    const w = game.weapon;
    const p = game.player;
    const ads = w ? (typeof w.adsProgress === 'number' ? w.adsProgress : w.ads ? 1 : 0) : 0;
    if (ads < 0.985) return spread;
    if (!p) return spread;
    if (p.onGround === false) return spread;

    const vx = p.velocity ? p.velocity.x : 0;
    const vz = p.velocity ? p.velocity.z : 0;
    if (vx * vx + vz * vz > 0.04) return spread; // > 0.2 m/s counts as moving

    // "First shot" means the bloom has had time to settle: one and a half cyclic intervals.
    const rpm = def && def.rpm ? def.rpm : 700;
    const cyclic = 60 / rpm;
    const now = game.clock ? game.clock.time : 0;
    if (now - lastPlayerShotTime < cyclic * 1.6) return spread;
    return 0;
  }

  /* ====================================================================== */
  /* Tracers                                                                 */
  /* ====================================================================== */

  /** Muzzle position for a tracer's origin, falling back to the eye if the weapon is stubbed. */
  function tracerOrigin(ox, oy, oz, fromPlayer) {
    _fxFrom.set(ox, oy, oz);
    if (!fromPlayer) return;
    const w = game.weapon;
    if (w && typeof w.muzzleWorld === 'function') {
      try {
        w.muzzleWorld(_tmpA);
        // Sanity: a stubbed muzzleWorld writes the origin. Anything more than 2 m from the
        // eye is not a muzzle, so keep the eye rather than firing from the floor.
        if (Number.isFinite(_tmpA.x) && _tmpA.distanceToSquared(_fxFrom) < 4) _fxFrom.copy(_tmpA);
      } catch {
        /* weapon stub */
      }
    }
  }

  function spawnTracer(tox, toy, toz, speed, fromPlayer) {
    const fx = game.fx;
    if (!fx || typeof fx.spawnTracer !== 'function') return;
    _fxTo.set(tox, toy, toz);
    try {
      // The fourth argument is outside the documented signature and is safely ignored by an
      // fx module that does not want it; if it does, it can colour enemy tracers cold
      // (PALETTE.tracerEnemy) against the player's warm ones.
      fx.spawnTracer(_fxFrom, _fxTo, speed, fromPlayer);
    } catch {
      /* fx stub */
    }
  }

  /* ====================================================================== */
  /* Hitscan resolution                                                      */
  /* ====================================================================== */

  /**
   * Resolve a hitscan round, following it through up to MAX_PENETRATIONS walls.
   * Returns the distance at which it finally stopped (for the tracer endpoint).
   */
  function resolveHitscan(ox, oy, oz, dx, dy, dz, def, baseDamage, fromPlayer, owner, wantWhizz) {
    let px = ox;
    let py = oy;
    let pz = oz;
    let ddx = dx;
    let ddy = dy;
    let ddz = dz;
    let energy = 1;
    let pens = 0;
    let travelled = 0;

    const targets = fromPlayer ? 1 : 2;
    const falloff = fromPlayer ? falloffFor(def) : FALLOFF._enemy;
    const crackSpeed = def && def.muzzleVelocity ? def.muzzleVelocity : 780;

    for (let iter = 0; iter <= MAX_PENETRATIONS; iter++) {
      const range = MAX_RANGE - travelled;
      if (range <= 0.05) break;

      const type = traceSegment(px, py, pz, ddx, ddy, ddz, range, targets, owner, trace);

      // A round that connects does not also crack past the ear — the hit is the event.
      const struckPlayer = type === TRACE_ACTOR && trace.actor === game.player;
      if (wantWhizz && !struckPlayer) {
        checkWhizz(
          px,
          py,
          pz,
          ddx,
          ddy,
          ddz,
          type === TRACE_NONE ? range : trace.distance,
          owner,
          crackSpeed
        );
      }

      if (type === TRACE_NONE) {
        travelled += range;
        px += ddx * range;
        py += ddy * range;
        pz += ddz * range;
        break;
      }

      travelled += trace.distance;

      if (type === TRACE_ACTOR) {
        _hitPoint.copy(trace.point);
        _hitNormal.copy(trace.normal);
        const zone = trace.zone;
        const dmg = baseDamage * falloffMul(falloff, travelled) * zoneMul(zone, fromPlayer) * energy;
        if (fromPlayer) {
          applyEnemyHit(trace.actor, dmg, zone, ddx, ddy, ddz, travelled, pens > 0, def);
        } else {
          applyPlayerHit(dmg, zone, ddx, ddy, ddz, travelled, owner);
        }
        px = trace.point.x;
        py = trace.point.y;
        pz = trace.point.z;
        break;
      }

      /* --- world hit --------------------------------------------------- */
      const surface = trace.surface;
      _entry.copy(trace.point);
      const nx = trace.normal.x;
      const ny = trace.normal.y;
      const nz = trace.normal.z;

      // Grazing rounds skip; only a reasonably square hit is allowed to punch through.
      const incidence = Math.abs(nx * ddx + ny * ddy + nz * ddz);
      const maxThick =
        pens < MAX_PENETRATIONS && incidence >= PEN_MIN_INCIDENCE ? maxThicknessFor(surface) : 0;
      let thickness = -1;
      if (maxThick > 0) thickness = findExit(ddx, ddy, ddz, maxThick);

      const newEnergy = thickness > 0 ? energy * penetrationEnergy(surface, thickness) : 0;
      const willPass = thickness > 0 && newEnergy >= MIN_PEN_ENERGY;

      emitImpact(_entry.x, _entry.y, _entry.z, nx, ny, nz, ddx, ddy, ddz, surface, willPass, energy, travelled, fromPlayer);

      if (!willPass) {
        px = _entry.x;
        py = _entry.y;
        pz = _entry.z;
        break;
      }

      // Exit spall on the far side reads as a second, weaker impact and is what sells the
      // round having actually gone through rather than teleported. Its normal points along
      // the direction of travel — that face looks away from the material.
      emitImpact(
        _exit.x,
        _exit.y,
        _exit.z,
        ddx,
        ddy,
        ddz,
        ddx,
        ddy,
        ddz,
        surface,
        true,
        newEnergy,
        travelled + thickness,
        fromPlayer
      );

      // Deflection: proportional to the energy shed, so glass barely bends a round and a
      // sandbag throws it noticeably. Sampled in the tangent plane with the same disc trick.
      const shed = 1 - newEnergy / Math.max(energy, 1e-4);

      pens++;
      stats.penetrations++;
      energy = newEnergy;
      travelled += thickness;

      const defl = PEN_DEFLECT * clamp(0.25 + shed, 0, 1);
      applySpread(ddx, ddy, ddz, defl);
      ddx = _traceDir.x;
      ddy = _traceDir.y;
      ddz = _traceDir.z;

      px = _exit.x + ddx * PEN_EXIT_EPS;
      py = _exit.y + ddy * PEN_EXIT_EPS;
      pz = _exit.z + ddz * PEN_EXIT_EPS;
    }

    _endPoint.set(px, py, pz);
    return travelled;
  }

  function checkWhizz(ox, oy, oz, dx, dy, dz, len, owner, speed) {
    const p = game.player;
    const eye = p && p.eye;
    if (!eye) return;
    const dSq = pointSegmentDistanceSq(eye.x, eye.y, eye.z, ox, oy, oz, dx, dy, dz, len);
    if (dSq > WHIZZ_RADIUS * WHIZZ_RADIUS || dSq < WHIZZ_MIN * WHIZZ_MIN) return;
    // Report the point of closest approach, not the muzzle: the crack should pan past the
    // ear from wherever the round actually went by.
    let t = (eye.x - ox) * dx + (eye.y - oy) * dy + (eye.z - oz) * dz;
    t = clamp(t, 0, len);
    emitWhizz(ox + dx * t, oy + dy * t, oz + dz * t, dx, dy, dz, Math.sqrt(dSq), owner, speed);
  }

  function falloffFor(def) {
    if (def && def.falloff && typeof def.falloff.near === 'number') return def.falloff;
    const id = def && def.id;
    return (id && FALLOFF[id]) || FALLOFF._default;
  }

  function falloffMul(curve, distance) {
    const span = curve.far - curve.near;
    const t = span > 1e-3 ? (distance - curve.near) / span : distance > curve.near ? 1 : 0;
    return 1 - (1 - curve.min) * smoothstep01(t);
  }

  function zoneMul(zoneId, fromPlayer) {
    if (zoneId === ZONE_ID_HEAD) return fromPlayer ? ZONE_HEAD : ZONE_HEAD_VS_PLAYER;
    if (zoneId === ZONE_ID_LIMB) return ZONE_LIMB;
    return ZONE_TORSO;
  }

  /* ====================================================================== */
  /* Ballistic projectiles                                                   */
  /* ====================================================================== */

  function isBallistic(def) {
    if (!def) return false;
    if (def.ballistic === true) return true;
    if (def.ballistic === false) return false;
    return def.id === 'dmr14';
  }

  function muzzleVelocityOf(def) {
    if (def && typeof def.muzzleVelocity === 'number' && def.muzzleVelocity > 50) {
      return def.muzzleVelocity;
    }
    return DEFAULT_MUZZLE_VELOCITY;
  }

  function acquireProjectile() {
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      if (!pool[i].active) return pool[i];
    }
    // Pool exhausted: recycle the oldest. Cannot happen at 300 rpm over 340 m, but a pool
    // that silently drops rounds is a bug the player would feel and never be able to report.
    let oldest = pool[0];
    for (let i = 1; i < MAX_PROJECTILES; i++) if (pool[i].life > oldest.life) oldest = pool[i];
    return oldest;
  }

  function launchProjectile(ox, oy, oz, dx, dy, dz, def, damage, fromPlayer, owner, tracer) {
    const p = acquireProjectile();
    const v = muzzleVelocityOf(def);
    if (!p.active) activeProjectiles++;
    p.active = true;
    p.pos.set(ox, oy, oz);
    p.prev.set(ox, oy, oz);
    p.vel.set(dx * v, dy * v, dz * v);
    p.dir.set(dx, dy, dz);
    p.def = def;
    p.damage = damage;
    p.energy = 1;
    p.travelled = 0;
    p.life = 0;
    p.penetrations = 0;
    p.fromPlayer = fromPlayer;
    p.owner = owner || null;
    p.tracer = tracer;
    stats.projectiles++;
    return p;
  }

  function retire(p) {
    if (p.active) activeProjectiles--;
    p.active = false;
    p.def = null;
    p.owner = null;
  }

  /**
   * Advance one projectile by `dt`, in fixed 4 m segments. Each segment is a straight
   * raycast, and gravity plus drag are applied per segment rather than per frame, so the
   * trajectory is identical at 30 fps and at 144 fps — a rifle that shoots differently
   * depending on frame rate is unusable.
   */
  function stepProjectile(p, dt) {
    p.life += dt;
    let budgetTime = dt;
    let guard = 0;

    while (budgetTime > 1e-5 && p.active && guard++ < 24) {
      const speed = p.vel.length();
      if (speed < 40) {
        retire(p);
        return;
      }
      const segTime = Math.min(budgetTime, BALLISTIC_STEP / speed);
      const segLen = speed * segTime;

      p.prev.copy(p.pos);
      p.dir.copy(p.vel).multiplyScalar(1 / speed);

      const targets = p.fromPlayer ? 1 : 2;
      const type = traceSegment(
        p.pos.x,
        p.pos.y,
        p.pos.z,
        p.dir.x,
        p.dir.y,
        p.dir.z,
        segLen,
        targets,
        p.owner,
        trace
      );

      if (!p.fromPlayer && !(type === TRACE_ACTOR && trace.actor === game.player)) {
        checkWhizz(
          p.pos.x,
          p.pos.y,
          p.pos.z,
          p.dir.x,
          p.dir.y,
          p.dir.z,
          type === TRACE_NONE ? segLen : trace.distance,
          p.owner,
          speed
        );
      }

      if (type === TRACE_ACTOR) {
        p.travelled += trace.distance;
        _hitPoint.copy(trace.point);
        _hitNormal.copy(trace.normal);
        const curve = p.fromPlayer ? falloffFor(p.def) : FALLOFF._enemy;
        const dmg =
          p.damage * falloffMul(curve, p.travelled) * zoneMul(trace.zone, p.fromPlayer) * p.energy;
        if (p.fromPlayer) {
          applyEnemyHit(
            trace.actor,
            dmg,
            trace.zone,
            p.dir.x,
            p.dir.y,
            p.dir.z,
            p.travelled,
            p.penetrations > 0,
            p.def
          );
        } else {
          applyPlayerHit(dmg, trace.zone, p.dir.x, p.dir.y, p.dir.z, p.travelled, p.owner);
        }
        retire(p);
        return;
      }

      if (type === TRACE_WORLD) {
        p.travelled += trace.distance;
        const surface = trace.surface;
        _entry.copy(trace.point);
        const nx = trace.normal.x;
        const ny = trace.normal.y;
        const nz = trace.normal.z;

        const incidence = Math.abs(nx * p.dir.x + ny * p.dir.y + nz * p.dir.z);
        const maxThick =
          p.penetrations < MAX_PENETRATIONS && incidence >= PEN_MIN_INCIDENCE
            ? maxThicknessFor(surface)
            : 0;
        let thickness = -1;
        if (maxThick > 0) thickness = findExit(p.dir.x, p.dir.y, p.dir.z, maxThick);
        const newEnergy = thickness > 0 ? p.energy * penetrationEnergy(surface, thickness) : 0;
        const willPass = thickness > 0 && newEnergy >= MIN_PEN_ENERGY;

        emitImpact(
          _entry.x,
          _entry.y,
          _entry.z,
          nx,
          ny,
          nz,
          p.dir.x,
          p.dir.y,
          p.dir.z,
          surface,
          willPass,
          p.energy,
          p.travelled,
          p.fromPlayer
        );

        if (!willPass) {
          retire(p);
          return;
        }

        emitImpact(
          _exit.x,
          _exit.y,
          _exit.z,
          p.dir.x,
          p.dir.y,
          p.dir.z,
          p.dir.x,
          p.dir.y,
          p.dir.z,
          surface,
          true,
          newEnergy,
          p.travelled + thickness,
          p.fromPlayer
        );

        const shed = 1 - newEnergy / Math.max(p.energy, 1e-4);
        p.penetrations++;
        stats.penetrations++;
        p.energy = newEnergy;
        p.travelled += thickness;

        applySpread(p.dir.x, p.dir.y, p.dir.z, PEN_DEFLECT * clamp(0.25 + shed, 0, 1));
        // A round that has just punched a wall also loses speed, not only damage.
        const newSpeed = speed * Math.max(0.55, newEnergy);
        p.vel.copy(_traceDir).multiplyScalar(newSpeed);
        p.dir.copy(_traceDir);
        p.pos.set(
          _exit.x + p.dir.x * PEN_EXIT_EPS,
          _exit.y + p.dir.y * PEN_EXIT_EPS,
          _exit.z + p.dir.z * PEN_EXIT_EPS
        );
        budgetTime -= segTime;
        continue;
      }

      /* --- free flight ------------------------------------------------- */
      p.pos.addScaledVector(p.dir, segLen);
      p.travelled += segLen;

      // Gravity over the segment, then velocity-proportional drag expressed per metre so it
      // is independent of the segment split.
      p.vel.y -= BULLET_GRAVITY * segTime;
      const dragMul = Math.exp(-BULLET_DRAG_PER_M * segLen);
      p.vel.multiplyScalar(dragMul);

      budgetTime -= segTime;

      if (p.travelled >= MAX_BALLISTIC_RANGE || p.life > 2.5) {
        retire(p);
        return;
      }
      // Fell out of the world.
      if (p.pos.y < -40 || p.pos.y > 400) {
        retire(p);
        return;
      }
    }
  }

  /**
   * Predict where a ballistic round will end up, using the world only, so a tracer can be
   * spawned at the instant of firing with a truthful endpoint. Cheap: at most 340/4 = 85
   * segments, and only on tracer rounds (one in three, and the DMR is semi-automatic).
   * Writes the endpoint into `_predEnd`.
   */
  function predictBallisticEnd(ox, oy, oz, dx, dy, dz, def) {
    let px = ox;
    let py = oy;
    let pz = oz;
    let vx = dx;
    let vy = dy;
    let vz = dz;
    let speed = muzzleVelocityOf(def);
    vx *= speed;
    vy *= speed;
    vz *= speed;
    let travelled = 0;

    for (let i = 0; i < 90; i++) {
      speed = Math.hypot(vx, vy, vz);
      if (speed < 40) break;
      const ux = vx / speed;
      const uy = vy / speed;
      const uz = vz / speed;
      const segLen = Math.min(BALLISTIC_STEP, MAX_BALLISTIC_RANGE - travelled);
      if (segLen <= 0.01) break;
      const segTime = segLen / speed;

      _traceOrigin.set(px, py, pz);
      _probeDir.set(ux, uy, uz);
      const r = levelRaycast(_traceOrigin, _probeDir, segLen);
      if (r) {
        _predEnd.copy(r.point);
        return;
      }
      px += ux * segLen;
      py += uy * segLen;
      pz += uz * segLen;
      travelled += segLen;
      vy -= BULLET_GRAVITY * segTime;
      const dragMul = Math.exp(-BULLET_DRAG_PER_M * segLen);
      vx *= dragMul;
      vy *= dragMul;
      vz *= dragMul;
      if (travelled >= MAX_BALLISTIC_RANGE) break;
    }
    _predEnd.set(px, py, pz);
  }

  /* ====================================================================== */
  /* Public firing entry points                                              */
  /* ====================================================================== */

  /**
   * Fire one round for the player. `origin` and `dir` are the eye and the raw camera
   * forward; the cone is applied here, because the weapon only reports its width.
   */
  function fire(origin, dir, def, _game, spreadOverride) {
    if (!origin || !dir) return;
    const spread = effectiveSpread(spreadOverride, def);
    fireInternal(origin, dir, def, spread, true, null);
    lastPlayerShotTime = game.clock ? game.clock.time : 0;
  }

  function fireInternal(origin, dir, def, spread, fromPlayer, owner) {
    const dl = Math.hypot(dir.x, dir.y, dir.z);
    if (!(dl > 1e-6)) return;
    const dx = dir.x / dl;
    const dy = dir.y / dl;
    const dz = dir.z / dl;

    applySpread(dx, dy, dz, spread);
    const sx = _traceDir.x;
    const sy = _traceDir.y;
    const sz = _traceDir.z;

    const baseDamage = def && typeof def.damage === 'number' ? def.damage : fromPlayer ? 30 : 15;

    stats.rounds++;
    roundCounter++;
    const wantTracer = roundCounter % TRACER_EVERY === 0;

    tracerOrigin(origin.x, origin.y, origin.z, fromPlayer);

    if (isBallistic(def)) {
      // Launch from the eye/origin so the maths is right, but draw from the muzzle.
      launchProjectile(origin.x, origin.y, origin.z, sx, sy, sz, def, baseDamage, fromPlayer, owner, wantTracer);
      if (wantTracer) {
        predictBallisticEnd(origin.x, origin.y, origin.z, sx, sy, sz, def);
        // A ballistic tracer flies at the round's own speed, otherwise the streak and the
        // impact disagree and the whole point of the travel time is lost. This is the one
        // deliberate departure from the 420 m/s tracer speed used for hitscan weapons.
        spawnTracer(_predEnd.x, _predEnd.y, _predEnd.z, muzzleVelocityOf(def), fromPlayer);
      }
      return;
    }

    resolveHitscan(
      origin.x,
      origin.y,
      origin.z,
      sx,
      sy,
      sz,
      def,
      baseDamage,
      fromPlayer,
      owner,
      !fromPlayer
    );

    if (wantTracer) {
      // `_endPoint` holds the terminal point written by resolveHitscan.
      spawnTracer(_endPoint.x, _endPoint.y, _endPoint.z, TRACER_SPEED, fromPlayer);
    }
  }

  /**
   * Enemy fire. `ai/enemies.js` routes every round it shoots through here so that AI bullets
   * obey the same penetration rules, the same falloff shape and the same capsule geometry as
   * the player's — including the near-miss crack, which is most of what makes being shot at
   * feel dangerous before anything actually connects.
   */
  function fireEnemy(origin, dir, def, enemy) {
    if (!origin || !dir) return;
    let spread = def && typeof def.spread === 'number' ? def.spread : 0.018;
    if (def && def.spread && typeof def.spread === 'object') {
      spread = typeof def.spread.ai === 'number' ? def.spread.ai : def.spread.hip || 0.018;
    }
    fireInternal(origin, dir, def, spread, false, enemy || null);
  }

  /* ====================================================================== */
  /* Frame                                                                   */
  /* ====================================================================== */

  function update(dt) {
    if (activeProjectiles <= 0) return;
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const p = pool[i];
      if (p.active) stepProjectile(p, dt);
    }
  }

  /* ====================================================================== */
  /* Wiring                                                                  */
  /* ====================================================================== */

  const shotOrigin = new THREE.Vector3();
  const shotDir = new THREE.Vector3();

  function onShot(e) {
    if (!e || !e.origin || !e.dir) return;
    // The weapon reuses its payload vectors between rounds; copy before doing anything that
    // could yield (an event listener, a raycast into the level's own scratch).
    shotOrigin.copy(e.origin);
    shotDir.copy(e.dir);
    const def = e.weapon || (game.weapon ? game.weapon.current : null);
    const spread = effectiveSpread(e.spread, def);
    fireInternal(shotOrigin, shotDir, def, spread, true, null);
    lastPlayerShotTime = game.clock ? game.clock.time : 0;
  }

  const offShot = game.events && game.events.on ? game.events.on('shot', onShot) : null;

  function dispose() {
    try {
      if (typeof offShot === 'function') offShot();
      else game.events?.off?.('shot', onShot);
    } catch {
      /* emitter gone */
    }
    for (let i = 0; i < MAX_PROJECTILES; i++) retire(pool[i]);
    activeProjectiles = 0;
  }

  /* ====================================================================== */

  const ballistics = {
    update,
    fire,
    fireEnemy,
    /** The preallocated projectile pool. Inspect `.active`; `pendingCount` is the live total. */
    pending: pool,
    get pendingCount() {
      return activeProjectiles;
    },
    stats,
    dispose,
    /* Exposed for the debug overlay and for tuning; not part of the module contract. */
    _trace: trace,
  };

  return ballistics;
}
