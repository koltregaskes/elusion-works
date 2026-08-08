/**
 * Ashfall — player controller (ARCHITECTURE.md §3.7).
 *
 * A capsule character controller with no physics library. Three things live here:
 *
 *  1. A Quake-derived movement model (accelerate / friction with a stop-speed floor, air
 *     acceleration capped by a wish-speed projection). This is what gives the player weight
 *     without making him feel like he is wading; a plain `velocity = wishDir * speed` reads
 *     as arcade instantly.
 *  2. Collide-and-slide against `level.triangles` — capsule vs triangle, deepest contact
 *     first, velocity projected onto the contact planes, with step-up and mantle handling.
 *     A uniform XZ grid is built once over the triangle soup so the per-frame test touches
 *     a few dozen triangles rather than tens of thousands.
 *  3. The camera stack. Look, bob, footstep dip, landing dip, lean, breathing, slide dip,
 *     shake and recoil are all *separate* transforms, composed only at the very end of the
 *     frame. Nothing is ever baked back into yaw/pitch, so recoil can never fight the mouse
 *     and the bob can never desynchronise the aim.
 *
 * Everything below integrates with `1 - exp(-k dt)` smoothing or a substepped critically
 * damped spring, so behaviour is identical at 30 and 240 fps. `dt` arrives clamped to 1/20 s
 * from main.js; we clamp again because this file must not trust its caller.
 *
 * Zero allocation in `update()`. Every vector, quaternion and payload object used per frame
 * is preallocated at module scope.
 */

import * as THREE from '../../vendor/three.module.js';
import { CAMERA, MAP, SURFACES } from '../world/art.js';

/* ========================================================================== */
/* Tuning — the contract's numbers, plus the feel constants around them        */
/* ========================================================================== */

const DEG = Math.PI / 180;

const RADIUS = 0.35; // capsule radius, metres
const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.2; // 1.2 - 0.15 eye inset = the contract's 1.05 crouch eye
const EYE_INSET = STAND_HEIGHT - CAMERA.eyeHeight; // 0.15 m from the crown to the eye

const SPEED_WALK = 3.2;
const SPEED_SPRINT = 6.1;
const SPEED_CROUCH = 1.6;
const SPEED_ADS = 2.1;
const SPEED_BACK_SCALE = 0.82; // walking backwards is slower, as it should be
const SPEED_STRAFE_SCALE = 0.92;

const ACCEL_GROUND = 14.0; // Quake `sv_accelerate`, in wish-speeds per second
const ACCEL_AIR = 16.0;
/**
 * Air acceleration is applied against a *clipped* wish speed. This is the whole trick: the
 * accelerate() projection term `wishSpeed - v·wishDir` stays positive when you steer
 * sideways, so you keep authority over direction, but you can never add much forward speed
 * in the air. Cap it and air control reads crisp; remove it and the player floats.
 */
const AIR_WISH_CAP = 1.35;
const AIR_CONTROL = 0.28; // contract value: extra steering authority on the horizontal vector

const FRICTION = 6.4;
const STOP_SPEED = 1.45; // friction floor — without it you creep to a halt over a metre
const GRAVITY = 22.0;
const JUMP_IMPULSE = 6.4;
const COYOTE_TIME = 0.09;
const JUMP_BUFFER = 0.13; // pressing jump just before landing still jumps
const STEP_HEIGHT = 0.4;
const SLOPE_LIMIT = Math.cos(46 * DEG); // ~0.695 — above this a contact is floor, below, wall

const SPRINT_SPINUP = 0.12; // seconds to full sprint authority
const SPRINT_K = 3 / SPRINT_SPINUP; // exponential rate reaching ~95% in the spin-up window

const SLIDE_DURATION = 1.1;
const SLIDE_ENTRY_SPEED = 4.4; // must be moving this fast to slide rather than just crouch
const SLIDE_BOOST = 1.22;
const SLIDE_SPEED_CAP = 8.6;
const SLIDE_EXIT_SPEED = 2.2;
const SLIDE_FRICTION_MIN = 0.55; // low at entry so the slide carries...
const SLIDE_FRICTION_MAX = 7.5; // ...then bleeds hard at the tail
const SLIDE_COOLDOWN = 0.45;

const MANTLE_MIN = 0.5;
const MANTLE_MAX = 1.2;
const MANTLE_TIME = 0.35;

const PITCH_LIMIT = 1.54;
const LOOK_SMOOTH_K = 55; // ~18 ms — kills 1000 Hz mouse jitter, invisible as latency

const SUBSTEPS = 4;
const DEPEN_EPS = 1e-3;
const RESOLVE_ITERATIONS = 6;
const GRID_CELL = 3.0;
const MAX_CANDIDATES = 4096;

const RECOIL_AIM_GAIN = 0.42; // fraction of a kick that moves the actual aim
const RECOIL_RECENTER = 0.7; // of the aim moved during a burst, 70% comes back free
const RECOIL_RECENTER_K = 13;
const RECOIL_RELEASE_DELAY = 0.085;

/* ========================================================================== */
/* Module-scope scratch — nothing in the hot path may allocate                 */
/* ========================================================================== */

const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _savePos = new THREE.Vector3();
const _saveVel = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _groundNormal = new THREE.Vector3(0, 1, 0);
const _contactPoint = new THREE.Vector3();
const _contactNormal = new THREE.Vector3(0, 1, 0);
const _mantleStart = new THREE.Vector3();
const _mantleEnd = new THREE.Vector3();
const _eyeTmp = new THREE.Vector3();
const _dirTmp = new THREE.Vector3();

const _lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _offsetEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _qLook = new THREE.Quaternion();
const _qOffset = new THREE.Quaternion();

/** Reused event payloads. Consumers must read, not retain. */
const FOOTSTEP_PAYLOAD = { surface: 'gravel', foot: 'left', speed: 0 };

/** Plane normals used by the collide-and-slide crease solver. */
const PLANES = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
];

/** Contact result from `capsuleTriangle`, written in place. */
const CT = { hit: false, nx: 0, ny: 1, nz: 0, depth: 0, px: 0, py: 0, pz: 0 };
/** Deepest-contact accumulator. */
const BEST = { hit: false, nx: 0, ny: 1, nz: 0, depth: 0, px: 0, py: 0, pz: 0, tri: -1 };
/** Segment-segment closest points. */
const SS = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, d2: 0 };
/** Ray result. */
const RAY = { hit: false, t: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, tri: -1 };

/* ========================================================================== */
/* Small maths helpers                                                        */
/* ========================================================================== */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential approach factor. */
const approach = (k, dt) => 1 - Math.exp(-k * dt);
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Used only when the level failed to build; keeps the demo playable on a flat plane. */
const FALLBACK_BOUNDS = {
  min: new THREE.Vector3(-MAP.width / 2, 0, -MAP.depth / 2),
  max: new THREE.Vector3(MAP.width / 2, MAP.wallHeight + 20, MAP.depth / 2),
};

/**
 * Critically damped (or tuneable-zeta) spring, semi-implicit Euler with substepping so a
 * stiff spring stays stable when the frame rate collapses to 20 fps.
 */
function springTo(s, target, k, zeta, dt) {
  const steps = dt > 1 / 55 ? 3 : 1;
  const h = dt / steps;
  const c = 2 * zeta * Math.sqrt(k);
  for (let i = 0; i < steps; i++) {
    s.v += (-k * (s.x - target) - c * s.v) * h;
    s.x += s.v * h;
  }
}

const makeSpring = (x = 0) => ({ x, v: 0 });

/* ========================================================================== */
/* Geometry — capsule vs triangle, segment vs segment, ray vs triangle         */
/* ========================================================================== */

/** Closest points between segments p1->q1 and p2->q2 (Ericson, Real-Time Collision Detection). */
function segSegClosest(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0;
  let t = 0;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    // Both degenerate.
  } else if (a <= EPS) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  SS.ax = p1x + d1x * s;
  SS.ay = p1y + d1y * s;
  SS.az = p1z + d1z * s;
  SS.bx = p2x + d2x * t;
  SS.by = p2y + d2y * t;
  SS.bz = p2z + d2z * t;
  const dx = SS.ax - SS.bx, dy = SS.ay - SS.by, dz = SS.az - SS.bz;
  SS.d2 = dx * dx + dy * dy + dz * dz;
  return SS;
}

/* ========================================================================== */
/* Collision world — uniform XZ grid over the triangle soup                    */
/* ========================================================================== */

function createCollisionWorld() {
  const world = {
    source: null,
    tris: null,
    count: 0,
    normals: null, // 3 floats per triangle
    planeD: null, // 1 float per triangle
    minX: 0, minZ: 0, gw: 0, gh: 0,
    starts: null,
    items: null,
    stamp: null,
    stampCounter: 0,
    cand: new Int32Array(MAX_CANDIDATES),
    candCount: 0,
    ready: false,
  };

  world.build = function build(tris) {
    world.source = tris;
    world.ready = false;
    if (!tris || !tris.length || tris.length < 9) {
      world.count = 0;
      return;
    }
    const count = Math.floor(tris.length / 9);
    world.count = count;
    world.tris = tris;

    const normals = new Float32Array(count * 3);
    const planeD = new Float32Array(count);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < count; i++) {
      const b = i * 9;
      const ax = tris[b], ay = tris[b + 1], az = tris[b + 2];
      const bx = tris[b + 3], by = tris[b + 4], bz = tris[b + 5];
      const cx = tris[b + 6], cy = tris[b + 7], cz = tris[b + 8];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-9) {
        nx /= len; ny /= len; nz /= len;
      } else {
        // Degenerate sliver: zero normal marks it as skippable.
        nx = 0; ny = 0; nz = 0;
      }
      normals[i * 3] = nx;
      normals[i * 3 + 1] = ny;
      normals[i * 3 + 2] = nz;
      planeD[i] = -(nx * ax + ny * ay + nz * az);

      if (ax < minX) minX = ax; if (bx < minX) minX = bx; if (cx < minX) minX = cx;
      if (ax > maxX) maxX = ax; if (bx > maxX) maxX = bx; if (cx > maxX) maxX = cx;
      if (az < minZ) minZ = az; if (bz < minZ) minZ = bz; if (cz < minZ) minZ = cz;
      if (az > maxZ) maxZ = az; if (bz > maxZ) maxZ = bz; if (cz > maxZ) maxZ = cz;
    }

    world.normals = normals;
    world.planeD = planeD;
    world.minX = minX - 1;
    world.minZ = minZ - 1;
    const gw = Math.max(1, Math.min(512, Math.ceil((maxX - minX + 2) / GRID_CELL) + 1));
    const gh = Math.max(1, Math.min(512, Math.ceil((maxZ - minZ + 2) / GRID_CELL) + 1));
    world.gw = gw;
    world.gh = gh;

    // Two-pass counting sort into flat arrays: no per-cell array objects, no GC churn.
    const cells = gw * gh;
    const counts = new Int32Array(cells + 1);
    const cellOf = (v, min) => Math.floor((v - min) / GRID_CELL);

    for (let i = 0; i < count; i++) {
      const b = i * 9;
      let x0 = cellOf(Math.min(tris[b], tris[b + 3], tris[b + 6]), world.minX);
      let x1 = cellOf(Math.max(tris[b], tris[b + 3], tris[b + 6]), world.minX);
      let z0 = cellOf(Math.min(tris[b + 2], tris[b + 5], tris[b + 8]), world.minZ);
      let z1 = cellOf(Math.max(tris[b + 2], tris[b + 5], tris[b + 8]), world.minZ);
      x0 = clamp(x0, 0, gw - 1); x1 = clamp(x1, 0, gw - 1);
      z0 = clamp(z0, 0, gh - 1); z1 = clamp(z1, 0, gh - 1);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) counts[z * gw + x + 1]++;
      }
    }
    for (let i = 0; i < cells; i++) counts[i + 1] += counts[i];
    const total = counts[cells];
    const items = new Int32Array(total);
    const cursor = new Int32Array(cells);
    for (let i = 0; i < count; i++) {
      const b = i * 9;
      let x0 = cellOf(Math.min(tris[b], tris[b + 3], tris[b + 6]), world.minX);
      let x1 = cellOf(Math.max(tris[b], tris[b + 3], tris[b + 6]), world.minX);
      let z0 = cellOf(Math.min(tris[b + 2], tris[b + 5], tris[b + 8]), world.minZ);
      let z1 = cellOf(Math.max(tris[b + 2], tris[b + 5], tris[b + 8]), world.minZ);
      x0 = clamp(x0, 0, gw - 1); x1 = clamp(x1, 0, gw - 1);
      z0 = clamp(z0, 0, gh - 1); z1 = clamp(z1, 0, gh - 1);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const c = z * gw + x;
          items[counts[c] + cursor[c]] = i;
          cursor[c]++;
        }
      }
    }
    world.starts = counts;
    world.items = items;
    world.stamp = new Int32Array(count);
    world.stampCounter = 0;
    world.ready = total > 0;
  };

  /** Fill `cand` with unique triangle indices whose cell overlaps the given XZ box. */
  world.gather = function gather(minX, minZ, maxX, maxZ) {
    world.candCount = 0;
    if (!world.ready) return 0;
    const gw = world.gw, gh = world.gh;
    let x0 = Math.floor((minX - world.minX) / GRID_CELL);
    let x1 = Math.floor((maxX - world.minX) / GRID_CELL);
    let z0 = Math.floor((minZ - world.minZ) / GRID_CELL);
    let z1 = Math.floor((maxZ - world.minZ) / GRID_CELL);
    if (x1 < 0 || z1 < 0 || x0 > gw - 1 || z0 > gh - 1) return 0;
    x0 = clamp(x0, 0, gw - 1); x1 = clamp(x1, 0, gw - 1);
    z0 = clamp(z0, 0, gh - 1); z1 = clamp(z1, 0, gh - 1);
    const stampId = ++world.stampCounter;
    const stamp = world.stamp;
    const starts = world.starts;
    const items = world.items;
    const cand = world.cand;
    let n = 0;
    for (let z = z0; z <= z1; z++) {
      const row = z * gw;
      for (let x = x0; x <= x1; x++) {
        const c = row + x;
        const s = starts[c];
        const e = starts[c + 1];
        for (let i = s; i < e; i++) {
          const ti = items[i];
          if (stamp[ti] === stampId) continue;
          stamp[ti] = stampId;
          if (n >= MAX_CANDIDATES) return n;
          cand[n++] = ti;
        }
      }
    }
    world.candCount = n;
    return n;
  };

  /**
   * Capsule (segment A-B, radius r) against triangle `ti`. Double-sided: the push-out normal
   * is chosen from whichever side of the plane the capsule sits on, so the controller cannot
   * be sucked through a wall whose winding faces away.
   */
  world.capsuleTriangle = function capsuleTriangle(ax, ay, az, bx, by, bz, r, ti) {
    CT.hit = false;
    const nrm = world.normals;
    const nx = nrm[ti * 3], ny = nrm[ti * 3 + 1], nz = nrm[ti * 3 + 2];
    if (nx === 0 && ny === 0 && nz === 0) return false; // degenerate
    const d = world.planeD[ti];
    const dA = nx * ax + ny * ay + nz * az + d;
    const dB = nx * bx + ny * by + nz * bz + d;
    if ((dA > r && dB > r) || (dA < -r && dB < -r)) return false;

    // Point on the capsule axis nearest the triangle plane.
    let t;
    if (dA * dB <= 0) {
      const den = dA - dB;
      t = Math.abs(den) < 1e-9 ? 0.5 : dA / den;
    } else {
      t = Math.abs(dA) <= Math.abs(dB) ? 0 : 1;
    }
    t = clamp(t, 0, 1);
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    const pz = az + (bz - az) * t;
    const sd = nx * px + ny * py + nz * pz + d;

    const tris = world.tris;
    const b0 = ti * 9;
    const v0x = tris[b0], v0y = tris[b0 + 1], v0z = tris[b0 + 2];
    const v1x = tris[b0 + 3], v1y = tris[b0 + 4], v1z = tris[b0 + 5];
    const v2x = tris[b0 + 6], v2y = tris[b0 + 7], v2z = tris[b0 + 8];

    // Projection of P onto the plane, then a barycentric containment test.
    const qx = px - nx * sd, qy = py - ny * sd, qz = pz - nz * sd;
    const e0x = v1x - v0x, e0y = v1y - v0y, e0z = v1z - v0z;
    const e1x = v2x - v0x, e1y = v2y - v0y, e1z = v2z - v0z;
    const e2x = qx - v0x, e2y = qy - v0y, e2z = qz - v0z;
    const dot00 = e0x * e0x + e0y * e0y + e0z * e0z;
    const dot01 = e0x * e1x + e0y * e1y + e0z * e1z;
    const dot11 = e1x * e1x + e1y * e1y + e1z * e1z;
    const dot20 = e2x * e0x + e2y * e0y + e2z * e0z;
    const dot21 = e2x * e1x + e2y * e1y + e2z * e1z;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (denom > 1e-12) {
      const u = (dot11 * dot20 - dot01 * dot21) / denom;
      const v = (dot00 * dot21 - dot01 * dot20) / denom;
      if (u >= -1e-5 && v >= -1e-5 && u + v <= 1 + 1e-5) {
        const dist = Math.abs(sd);
        if (dist < r) {
          // Sign the normal towards the side the capsule occupies.
          let s = sd;
          if (Math.abs(s) < 1e-6) s = Math.abs(dA) > Math.abs(dB) ? dA : dB;
          const sign = s >= 0 ? 1 : -1;
          CT.hit = true;
          CT.nx = nx * sign; CT.ny = ny * sign; CT.nz = nz * sign;
          CT.depth = r - dist;
          CT.px = qx; CT.py = qy; CT.pz = qz;
          return true;
        }
        return false;
      }
    }

    // Outside the face: test the three edges.
    const r2 = r * r;
    let bestD2 = r2;
    let found = false;
    let cxA = 0, cyA = 0, czA = 0, cxB = 0, cyB = 0, czB = 0;
    for (let e = 0; e < 3; e++) {
      const sx = e === 0 ? v0x : e === 1 ? v1x : v2x;
      const sy = e === 0 ? v0y : e === 1 ? v1y : v2y;
      const sz = e === 0 ? v0z : e === 1 ? v1z : v2z;
      const ex = e === 0 ? v1x : e === 1 ? v2x : v0x;
      const ey = e === 0 ? v1y : e === 1 ? v2y : v0y;
      const ez = e === 0 ? v1z : e === 1 ? v2z : v0z;
      segSegClosest(ax, ay, az, bx, by, bz, sx, sy, sz, ex, ey, ez);
      if (SS.d2 < bestD2) {
        bestD2 = SS.d2;
        found = true;
        cxA = SS.ax; cyA = SS.ay; czA = SS.az;
        cxB = SS.bx; cyB = SS.by; czB = SS.bz;
      }
    }
    if (!found) return false;
    const dist = Math.sqrt(bestD2);
    let ox = cxA - cxB, oy = cyA - cyB, oz = czA - czB;
    if (dist > 1e-6) {
      ox /= dist; oy /= dist; oz /= dist;
    } else {
      const sign = dA + dB >= 0 ? 1 : -1;
      ox = nx * sign; oy = ny * sign; oz = nz * sign;
    }
    CT.hit = true;
    CT.nx = ox; CT.ny = oy; CT.nz = oz;
    CT.depth = r - dist;
    CT.px = cxB; CT.py = cyB; CT.pz = czB;
    return true;
  };

  /**
   * Deepest contact for a vertical capsule whose feet are at (x, y, z). Candidates must have
   * been gathered already by the caller so a resolve loop does not re-query the grid.
   */
  world.deepest = function deepest(x, y, z, height, r) {
    BEST.hit = false;
    BEST.depth = 0;
    BEST.tri = -1;
    if (!world.ready) return BEST;
    const ay = y + r;
    const by = y + Math.max(height - r, r + 1e-4);
    const cand = world.cand;
    const n = world.candCount;
    for (let i = 0; i < n; i++) {
      const ti = cand[i];
      if (!world.capsuleTriangle(x, ay, z, x, by, z, r, ti)) continue;
      if (CT.depth > BEST.depth) {
        BEST.hit = true;
        BEST.depth = CT.depth;
        BEST.nx = CT.nx; BEST.ny = CT.ny; BEST.nz = CT.nz;
        BEST.px = CT.px; BEST.py = CT.py; BEST.pz = CT.pz;
        BEST.tri = ti;
      }
    }
    return BEST;
  };

  /** True if any candidate triangle overlaps the given vertical capsule slice. */
  world.overlaps = function overlaps(x, y0, y1, z, r) {
    if (!world.ready) return false;
    const cand = world.cand;
    const n = world.candCount;
    for (let i = 0; i < n; i++) {
      if (world.capsuleTriangle(x, y0, z, x, y1, z, r, cand[i])) return true;
    }
    return false;
  };

  /** Möller–Trumbore, double-sided, nearest hit within `maxDist`. */
  world.raycast = function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    RAY.hit = false;
    RAY.t = maxDist;
    RAY.tri = -1;
    if (!world.ready) return RAY;
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    world.gather(
      Math.min(ox, ex) - 0.1,
      Math.min(oz, ez) - 0.1,
      Math.max(ox, ex) + 0.1,
      Math.max(oz, ez) + 0.1
    );
    const tris = world.tris;
    const cand = world.cand;
    const n = world.candCount;
    let bestT = maxDist;
    for (let i = 0; i < n; i++) {
      const ti = cand[i];
      const b = ti * 9;
      const v0x = tris[b], v0y = tris[b + 1], v0z = tris[b + 2];
      const e1x = tris[b + 3] - v0x, e1y = tris[b + 4] - v0y, e1z = tris[b + 5] - v0z;
      const e2x = tris[b + 6] - v0x, e2y = tris[b + 7] - v0y, e2z = tris[b + 8] - v0z;
      const hx = dy * e2z - dz * e2y;
      const hy = dz * e2x - dx * e2z;
      const hz = dx * e2y - dy * e2x;
      const a = e1x * hx + e1y * hy + e1z * hz;
      if (a > -1e-8 && a < 1e-8) continue;
      const f = 1 / a;
      const sx = ox - v0x, sy = oy - v0y, sz = oz - v0z;
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = f * (dx * qx + dy * qy + dz * qz);
      if (v < 0 || u + v > 1) continue;
      const t = f * (e2x * qx + e2y * qy + e2z * qz);
      if (t <= 1e-5 || t >= bestT) continue;
      bestT = t;
      RAY.hit = true;
      RAY.t = t;
      RAY.tri = ti;
    }
    if (RAY.hit) {
      const ti = RAY.tri;
      RAY.px = ox + dx * bestT;
      RAY.py = oy + dy * bestT;
      RAY.pz = oz + dz * bestT;
      let nx = world.normals[ti * 3];
      let ny = world.normals[ti * 3 + 1];
      let nz = world.normals[ti * 3 + 2];
      // Face the normal back along the ray so callers never see an inverted surface.
      if (nx * dx + ny * dy + nz * dz > 0) {
        nx = -nx; ny = -ny; nz = -nz;
      }
      RAY.nx = nx; RAY.ny = ny; RAY.nz = nz;
    }
    return RAY;
  };

  return world;
}

/* ========================================================================== */
/* Factory                                                                    */
/* ========================================================================== */

export function createPlayer(game) {
  const world = createCollisionWorld();

  /* --- state ------------------------------------------------------------ */

  const position = new THREE.Vector3(0, 1.0, 20); // feet, world space
  const velocity = new THREE.Vector3();
  const eye = new THREE.Vector3(0, CAMERA.eyeHeight, 20);
  const forward = new THREE.Vector3(0, 0, -1);
  const spawnPos = new THREE.Vector3(0, 1.0, 20);
  let spawnYaw = Math.PI;

  // Look — the pure aim. Nothing but the mouse and the recoil aim term touches these.
  let yawTarget = Math.PI;
  let pitchTarget = 0;
  let yaw = Math.PI;
  let pitch = 0;
  let lastYawOut = yaw;
  let lastPitchOut = pitch;

  // Motion
  let onGround = false;
  let wasOnGround = false;
  let coyote = 0;
  let jumpBuffer = 0;
  let airTime = 0;
  let groundY = 0;
  let hasGroundContact = false;

  // Stance
  let crouchBlend = 0; // 0 standing, 1 crouched
  let crouchHeld = false;
  let sprintBlend = 0;
  let sprinting = false;
  let sliding = false;
  let slideTimer = 0;
  let slideCooldown = 0;
  let slideRollDir = 1;
  let mantling = false;
  let mantleT = 0;
  let mantleCooldown = 0;
  let wallPress = 0;
  let blockedByWall = false;
  let lastWallNx = 0;
  let lastWallNz = 0;

  // Camera layers — each its own spring, composed at the very end.
  let bobPhase = 0;
  const bobX = makeSpring(0);
  const bobY = makeSpring(0);
  const bobRoll = makeSpring(0);
  const leanRoll = makeSpring(0);
  const leanX = makeSpring(0);
  const landDip = makeSpring(0);
  const stepDip = makeSpring(0);
  const slideDip = makeSpring(0);
  const slideRoll = makeSpring(0);
  const crouchDip = makeSpring(0);
  /**
   * Step smoothing. When the capsule is teleported vertically by a step-up or a ground snap
   * the *camera* must not teleport with it, or stairs strobe. We record the jump here and
   * spring it out over ~120 ms, which is the difference between climbing stairs in a AAA
   * shooter and climbing them in a jam game.
   */
  const stepSmooth = makeSpring(0);
  const recoilPitch = makeSpring(0);
  const recoilYaw = makeSpring(0);
  const recoilPush = makeSpring(0);
  const fovSpring = makeSpring(0);
  const mantlePitch = makeSpring(0);

  let trauma = 0; // 0..1, drives procedural shake; squared on use so small hits stay subtle
  let shakeSeed = Math.random() * 100;
  let breathPhase = Math.random() * 6.283;

  // Recoil bookkeeping
  let recoilAimAccum = 0; // aim pitch added by the current burst
  let recoilRecover = 0; // pitch still owed back to the player
  let lastFireTime = -10;

  // Camera FOV composition — we own an additive pulse only, and detect when another module
  // (the weapon's ADS pull-in) has taken the wheel so we never fight it.
  let fovBase = game?.camera?.fov ?? CAMERA.fov;
  let fovLastWritten = fovBase;

  // Damage de-duplication: main.js does not wire the `damage` event, so we subscribe. If the
  // AI both calls player.damage() and emits, the second one inside the same frame is dropped.
  let lastDamageFrame = -1;
  let lastDamageAmount = -1;

  let footstepParity = 0;
  let surfaceTimer = 0;
  let dead = false;

  const player = {
    position,
    velocity,
    eye,
    forward,
    yaw,
    pitch,
    onGround: false,
    crouched: false,
    sprinting: false,
    sliding: false,
    mantling: false,
    stance: 'STAND',
    speed: 0,
    airTime: 0,
    surfaceUnderfoot: 'gravel',
    /** Additive FOV degrees this module contributes; weapon.js may read it. */
    fovPulse: 0,
    radius: RADIUS,
    height: STAND_HEIGHT,
  };

  /* --- collision helpers ------------------------------------------------ */

  function ensureWorld() {
    const tris = game?.level?.triangles;
    if (tris !== world.source) world.build(tris);
    return world.ready;
  }

  function bounds() {
    const b = game?.level?.bounds;
    if (b && b.min && b.max && isFinite(b.min.x)) return b;
    return FALLBACK_BOUNDS;
  }

  function capsuleHeight() {
    return lerp(STAND_HEIGHT, CROUCH_HEIGHT, crouchBlend);
  }

  function gatherAround(x, z, pad) {
    world.gather(x - RADIUS - pad, z - RADIUS - pad, x + RADIUS + pad, z + RADIUS + pad);
  }

  /**
   * Resolve every penetration at the current position, deepest first, clipping velocity onto
   * each contact plane. Returns the number of contacts resolved; ground/wall classification
   * lands in `hasGroundContact`, `_groundNormal`, `blockedByWall`.
   */
  function resolvePenetration(height, clipVel) {
    let planeCount = 0;
    let resolved = 0;
    for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
      const hit = world.deepest(position.x, position.y, position.z, height, RADIUS);
      if (!hit.hit || hit.depth <= DEPEN_EPS * 0.5) break;
      const push = hit.depth + DEPEN_EPS;
      position.x += hit.nx * push;
      position.y += hit.ny * push;
      position.z += hit.nz * push;
      resolved++;

      if (hit.ny >= SLOPE_LIMIT) {
        hasGroundContact = true;
        _groundNormal.set(hit.nx, hit.ny, hit.nz);
        _contactPoint.set(hit.px, hit.py, hit.pz);
        groundY = hit.py;
      } else if (hit.ny <= -0.4) {
        // Ceiling: stop rising immediately, otherwise you stick to it for a frame.
        if (velocity.y > 0) velocity.y = 0;
      } else {
        blockedByWall = true;
        lastWallNx = hit.nx;
        lastWallNz = hit.nz;
      }

      if (clipVel) {
        if (planeCount < PLANES.length) {
          PLANES[planeCount].set(hit.nx, hit.ny, hit.nz);
          planeCount++;
        }
        clipAgainstPlanes(planeCount);
      }
    }
    return resolved;
  }

  /**
   * Quake's ClipVelocity with a crease pass: projecting onto plane A then plane B can send
   * the velocity straight back into A, so when that happens we slide along the crease
   * (the cross product of the two normals) instead.
   */
  function clipAgainstPlanes(count) {
    for (let i = 0; i < count; i++) {
      const n = PLANES[i];
      const into = velocity.dot(n);
      if (into >= 0) continue;
      velocity.addScaledVector(n, -into);
      // Re-check earlier planes; if we now violate one, ride the crease.
      for (let j = 0; j < count; j++) {
        if (j === i) continue;
        const m = PLANES[j];
        if (velocity.dot(m) >= 0) continue;
        _tmpA.crossVectors(n, m);
        const len = _tmpA.length();
        if (len < 1e-5) {
          velocity.set(0, 0, 0);
        } else {
          _tmpA.multiplyScalar(1 / len);
          velocity.copy(_tmpA.multiplyScalar(velocity.dot(_tmpA)));
        }
        break;
      }
    }
  }

  /** Flat-world fallback so the demo is playable even if level.triangles never arrives. */
  function fallbackCollide() {
    const b = bounds();
    const minX = b.min.x + RADIUS;
    const maxX = b.max.x - RADIUS;
    const minZ = b.min.z + RADIUS;
    const maxZ = b.max.z - RADIUS;
    if (position.x < minX) { position.x = minX; if (velocity.x < 0) velocity.x = 0; blockedByWall = true; }
    if (position.x > maxX) { position.x = maxX; if (velocity.x > 0) velocity.x = 0; blockedByWall = true; }
    if (position.z < minZ) { position.z = minZ; if (velocity.z < 0) velocity.z = 0; blockedByWall = true; }
    if (position.z > maxZ) { position.z = maxZ; if (velocity.z > 0) velocity.z = 0; blockedByWall = true; }
    if (position.y <= 0) {
      position.y = 0;
      if (velocity.y < 0) velocity.y = 0;
      hasGroundContact = true;
      _groundNormal.set(0, 1, 0);
      groundY = 0;
    }
  }

  /**
   * Step-up. A capsule that simply slides forward at a raised height stalls on the top edge
   * of a kerb — the edge contact is steeper than the slope limit, so it reads as a wall and
   * pushes straight back. Instead we probe for the tread in front, verify the capsule fits
   * at that height, lift the body onto it, nudge forward, and hide the vertical jump from
   * the camera with `stepSmooth`. Stairs then feel like walking, not like hopping.
   */
  function tryStepUp(dirX, dirZ, height) {
    if (!world.ready) return false;
    const probeX = position.x + dirX * (RADIUS + 0.12);
    const probeZ = position.z + dirZ * (RADIUS + 0.12);
    const r = world.raycast(
      probeX,
      position.y + STEP_HEIGHT + 0.3,
      probeZ,
      0, -1, 0,
      STEP_HEIGHT + 0.34
    );
    if (!r.hit || r.ny < SLOPE_LIMIT) return false;
    const rise = r.py - position.y;
    if (rise < 0.02 || rise > STEP_HEIGHT) return false;

    const newY = position.y + rise + 0.012;
    gatherAround(position.x, position.z, 0.35);
    if (world.deepest(position.x, newY, position.z, height, RADIUS * 0.97).depth > 0.02) return false;

    const oldY = position.y;
    position.y = newY;
    // A small forward nudge so the body actually gets over the lip rather than teetering.
    const nudge = 0.22;
    const nx = position.x + dirX * nudge;
    const nz = position.z + dirZ * nudge;
    gatherAround(nx, nz, 0.35);
    if (world.deepest(nx, position.y, nz, height, RADIUS * 0.97).depth <= 0.02) {
      position.x = nx;
      position.z = nz;
    }
    stepSmooth.x = clamp(stepSmooth.x - (position.y - oldY), -STEP_HEIGHT, STEP_HEIGHT);
    hasGroundContact = true;
    _groundNormal.set(r.nx, r.ny, r.nz);
    groundY = r.py;
    return true;
  }

  /** Sweep the capsule by `dt` worth of velocity in SUBSTEPS, with step-up recovery. */
  function integrate(dt) {
    const height = capsuleHeight();
    hasGroundContact = false;
    blockedByWall = false;

    const hasTris = ensureWorld();
    if (!hasTris) {
      position.addScaledVector(velocity, dt);
      fallbackCollide();
      return;
    }

    const stepUpAllowed = wasOnGround || coyote > 0;
    // Four substeps as the contract specifies, more only when a single frame's travel could
    // outrun the capsule radius (an explosion punt, or terminal velocity at 20 fps) — that is
    // the one case where four would tunnel.
    const travel = velocity.length() * dt;
    const substeps = clamp(Math.ceil(travel / (RADIUS * 0.7)), SUBSTEPS, 16);

    for (let s = 0; s < substeps; s++) {
      // Recompute the substep delta from the live velocity: after a clip, the remaining
      // substeps must follow the new direction or you scrape along walls.
      _delta.copy(velocity).multiplyScalar(dt / substeps);
      const wantX = _delta.x;
      const wantZ = _delta.z;
      const wantLen2 = wantX * wantX + wantZ * wantZ;

      _savePos.copy(position);
      _saveVel.copy(velocity);

      position.add(_delta);
      const pad = Math.abs(_delta.x) + Math.abs(_delta.z) + 0.2;
      gatherAround(position.x, position.z, pad);
      const before = blockedByWall;
      blockedByWall = false;
      resolvePenetration(height, true);
      const hitWall = blockedByWall;
      blockedByWall = before || blockedByWall;

      if (hitWall && stepUpAllowed && wantLen2 > 1e-8) {
        const gotX = position.x - _savePos.x;
        const gotZ = position.z - _savePos.z;
        const progress = (gotX * wantX + gotZ * wantZ) / wantLen2;
        if (progress < 0.72) {
          const inv = 1 / Math.sqrt(wantLen2);
          if (tryStepUp(wantX * inv, wantZ * inv, height)) {
            // The wall clip ate the horizontal speed; a step is not an impact, so give it back.
            velocity.x = _saveVel.x;
            velocity.z = _saveVel.z;
            // Zero, not clamp: an edge contact will have tilted some horizontal speed
            // upwards, and a step should never pop the player into the air.
            velocity.y = 0;
          }
        }
      }
    }

    // Never let the player leak out of the world: a fall through a seam respawns rather than
    // dropping into the void for ever.
    const b = bounds();
    if (position.y < b.min.y - 8) {
      respawn();
    }
  }

  /**
   * Downward probe for ground when no contact was generated this frame — essential for
   * coyote time and for walking down gentle slopes without going airborne every step.
   */
  function probeGround() {
    if (!world.ready) return false;
    const probe = 0.22;
    const y = position.y - probe;
    gatherAround(position.x, position.z, 0.3);
    const ay = y + RADIUS;
    const by = y + Math.max(capsuleHeight() - RADIUS, RADIUS + 1e-4);
    const cand = world.cand;
    const n = world.candCount;
    let best = -1;
    let bestDepth = 0;
    for (let i = 0; i < n; i++) {
      const ti = cand[i];
      if (!world.capsuleTriangle(position.x, ay, position.z, position.x, by, position.z, RADIUS, ti)) continue;
      if (CT.ny < SLOPE_LIMIT) continue;
      if (CT.depth > bestDepth) {
        bestDepth = CT.depth;
        best = ti;
        _contactNormal.set(CT.nx, CT.ny, CT.nz);
        _contactPoint.set(CT.px, CT.py, CT.pz);
      }
    }
    if (best < 0) return false;
    _groundNormal.copy(_contactNormal);
    groundY = _contactPoint.y;
    // Snap down onto the surface so walking off a kerb or down a ramp keeps ground contact
    // instead of going airborne for a frame. The camera is compensated by stepSmooth, so the
    // snap is felt as weight rather than seen as a jolt.
    if (velocity.y <= 0.01) {
      const target = groundY;
      const drop = position.y - target;
      if (drop > 0 && drop < probe + 0.02) {
        position.y = target;
        stepSmooth.x = clamp(stepSmooth.x + drop, -STEP_HEIGHT, STEP_HEIGHT);
      }
    }
    return true;
  }

  /* --- movement --------------------------------------------------------- */

  function applyFriction(dt, scale) {
    const vx = velocity.x;
    const vz = velocity.z;
    const speed = Math.sqrt(vx * vx + vz * vz);
    if (speed < 1e-4) {
      velocity.x = 0;
      velocity.z = 0;
      return;
    }
    // The stop-speed floor is what makes the player come to a definite halt instead of
    // easing asymptotically towards zero for half a metre.
    const control = speed < STOP_SPEED ? STOP_SPEED : speed;
    const drop = control * FRICTION * scale * dt;
    const newSpeed = Math.max(0, speed - drop) / speed;
    velocity.x *= newSpeed;
    velocity.z *= newSpeed;
  }

  /**
   * Quake `PM_Accelerate`. The projection term is why strafing never exceeds wishSpeed.
   * The wish direction carries a Y component on slopes (see `projectWishToGround`), so the
   * player walks *up* a ramp at walking pace instead of grinding against gravity.
   */
  function accelerate(wishX, wishY, wishZ, wishSpeed, accel, dt) {
    const current = velocity.x * wishX + velocity.y * wishY + velocity.z * wishZ;
    const add = wishSpeed - current;
    if (add <= 0) return;
    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > add) accelSpeed = add;
    velocity.x += wishX * accelSpeed;
    velocity.y += wishY * accelSpeed;
    velocity.z += wishZ * accelSpeed;
  }

  /**
   * Tilt the horizontal wish direction into the ground plane and renormalise. Without this,
   * gravity's downhill component fights a purely horizontal wish and ramps become treacle.
   */
  function projectWishToGround() {
    if (_wish.x === 0 && _wish.z === 0) return;
    const n = _groundNormal;
    if (n.y > 0.999) {
      _wish.y = 0;
      return;
    }
    if (n.y < 0.05) return;
    _wish.y = -(_wish.x * n.x + _wish.z * n.z) / n.y;
    const l = Math.sqrt(_wish.x * _wish.x + _wish.y * _wish.y + _wish.z * _wish.z);
    if (l > 1e-5) _wish.multiplyScalar(1 / l);
  }

  function airAccelerate(wishX, wishZ, wishSpeed, dt) {
    const capped = Math.min(wishSpeed, AIR_WISH_CAP);
    const current = velocity.x * wishX + velocity.z * wishZ;
    const add = capped - current;
    if (add > 0) {
      let accelSpeed = ACCEL_AIR * capped * dt;
      if (accelSpeed > add) accelSpeed = add;
      velocity.x += wishX * accelSpeed;
      velocity.z += wishZ * accelSpeed;
    }
    // Directional air control: steer the existing horizontal vector towards the wish
    // direction without adding energy. This is the part that feels like control in the air.
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (speed > 0.05 && wishSpeed > 0.01) {
      const dx = velocity.x / speed;
      const dz = velocity.z / speed;
      const dot = dx * wishX + dz * wishZ;
      if (dot > 0) {
        const k = AIR_CONTROL * dot * dot * dt * 32;
        let nx = dx + wishX * k;
        let nz = dz + wishZ * k;
        const nl = Math.sqrt(nx * nx + nz * nz);
        if (nl > 1e-5) {
          nx /= nl; nz /= nl;
          velocity.x = nx * speed;
          velocity.z = nz * speed;
        }
      }
    }
  }

  /* --- damage / events --------------------------------------------------- */

  function applyDamage(amount, dir) {
    if (!(amount > 0)) return;
    const state = game?.state;
    if (!state) return;
    lastDamageFrame = game?.clock?.frame ?? -1;
    lastDamageAmount = amount;

    let remaining = amount;
    if (state.armour > 0) {
      const absorbed = Math.min(state.armour, remaining * 0.55);
      state.armour = Math.max(0, state.armour - absorbed);
      remaining -= absorbed;
    }
    state.health = Math.max(0, state.health - remaining);
    state.hitFlash = Math.min(1, (state.hitFlash || 0) + remaining / 42 + 0.16);
    if (dir && state.lastDamageDir) {
      state.lastDamageDir.copy(dir);
      if (state.lastDamageDir.lengthSq() > 1e-6) state.lastDamageDir.normalize();
    }

    // A hit should move the camera, but predictably: a punch away from the impact plus a
    // little trauma, never a random jolt.
    const mag = clamp(remaining / 30, 0.15, 1.4);
    trauma = Math.min(1, trauma + mag * 0.32);
    if (dir) {
      _dirTmp.copy(dir);
      _dirTmp.y = 0;
      if (_dirTmp.lengthSq() > 1e-6) {
        _dirTmp.normalize();
        _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
        const lateral = _dirTmp.dot(_right);
        recoilYaw.v += -lateral * mag * 0.8;
        recoilPitch.v += mag * 0.9;
      }
    } else {
      recoilPitch.v += mag * 0.75;
    }
    dead = state.health <= 0;
  }

  function onDamageEvent(e) {
    if (!e) return;
    const frame = game?.clock?.frame ?? -1;
    if (frame === lastDamageFrame && Math.abs((e.amount || 0) - lastDamageAmount) < 1e-6) return;
    applyDamage(e.amount, e.dir);
  }

  function onExplosion(e) {
    if (!e || !e.point) return;
    const radius = e.radius || 6;
    const dist = eye.distanceTo(e.point);
    if (dist > radius * 1.6) return;
    const falloff = clamp(1 - dist / radius, 0, 1);
    trauma = Math.min(1, trauma + falloff * 0.9);
    if (falloff <= 0) return;
    const power = e.power ?? 60;
    _dirTmp.copy(eye).sub(e.point);
    if (_dirTmp.lengthSq() < 1e-6) _dirTmp.set(0, 1, 0);
    _dirTmp.normalize();
    velocity.addScaledVector(_dirTmp, power * 0.055 * falloff);
    if (velocity.y > 0) velocity.y = Math.min(velocity.y, 6.5);
    _dirTmp.negate();
    applyDamage(power * Math.pow(falloff, 1.4), _dirTmp);
  }

  const offDamage = game?.events?.on?.('damage', onDamageEvent);
  const offExplosion = game?.events?.on?.('explosion', onExplosion);

  /* --- respawn / teleport ------------------------------------------------ */

  function respawn() {
    position.copy(spawnPos);
    velocity.set(0, 0, 0);
    onGround = false;
    airTime = 0;
    sliding = false;
    mantling = false;
    crouchBlend = 0;
    sprintBlend = 0;
  }

  function snapToGround() {
    if (!ensureWorld()) {
      if (position.y < 0) position.y = 0;
      return;
    }
    // Probe from a little above the requested point down a few metres. Spawn points are
    // authored loosely (some at eye height), so this makes teleport forgiving.
    const r = world.raycast(position.x, position.y + 1.2, position.z, 0, -1, 0, 6.0);
    if (r.hit && r.ny >= SLOPE_LIMIT) {
      position.y = r.py + 0.01;
    }
    gatherAround(position.x, position.z, 0.4);
    resolvePenetration(STAND_HEIGHT, false);
  }

  /* --- mantle ------------------------------------------------------------ */

  function tryStartMantle(wishForward) {
    if (mantling || sliding || !world.ready) return false;
    if (mantleCooldown > 0) return false;
    if (wishForward < 0.25) return false;
    if (airTime > 0.7) return false;

    // A failed probe is cheap but not free; rate-limit it so running face-first into a wall
    // does not raycast four times a frame.
    mantleCooldown = 0.12;

    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const fx = _fwd.x;
    const fz = _fwd.z;

    // 1. Is there something to vault? Probe at chest height.
    const chest = position.y + 0.85;
    let r = world.raycast(position.x, chest, position.z, fx, 0, fz, RADIUS + 0.55);
    if (!r.hit) {
      // Nothing at chest height — maybe a low ledge; probe at knee height instead.
      r = world.raycast(position.x, position.y + 0.35, position.z, fx, 0, fz, RADIUS + 0.55);
      if (!r.hit) return false;
    }
    if (Math.abs(r.ny) > 0.6) return false; // that's a floor or a ceiling, not a ledge face
    if (r.nx * fx + r.nz * fz > -0.35) return false; // not facing us

    // 2. Find the top surface just beyond the face.
    const px = position.x + fx * (RADIUS + 0.45);
    const pz = position.z + fz * (RADIUS + 0.45);
    const top = world.raycast(px, position.y + MANTLE_MAX + 0.45, pz, 0, -1, 0, MANTLE_MAX + 0.75);
    if (!top.hit || top.ny < SLOPE_LIMIT) return false;
    const rise = top.py - position.y;
    if (rise < MANTLE_MIN || rise > MANTLE_MAX) return false;

    // 3. Headroom: a standing capsule must fit on the ledge.
    gatherAround(px, pz, 0.5);
    _savePos.copy(position);
    position.set(px, top.py + 0.03, pz);
    const clear = world.deepest(position.x, position.y, position.z, STAND_HEIGHT * 0.96, RADIUS * 0.92).depth <= 0.02;
    position.copy(_savePos);
    if (!clear) return false;

    // 4. Commit. The vault cannot be cancelled — that is what makes it read as deliberate.
    mantling = true;
    mantleT = 0;
    mantleCooldown = MANTLE_TIME + 0.15;
    _mantleStart.copy(position);
    _mantleEnd.set(px + fx * 0.22, top.py + 0.02, pz + fz * 0.22);
    velocity.set(0, 0, 0);
    sprinting = false;
    sliding = false;
    mantlePitch.v -= 2.6;
    trauma = Math.min(1, trauma + 0.12);
    sampleSurfaceAt(_mantleEnd.x, _mantleEnd.y, _mantleEnd.z, 0, 1, 0);
    game.audio?.playOneShot?.('mantle', { surface: player.surfaceUnderfoot, volume: 0.8 });
    return true;
  }

  function updateMantle(dt) {
    mantleT += dt / MANTLE_TIME;
    const t = clamp(mantleT, 0, 1);
    // Vertical first, horizontal second: the classic vault silhouette. The sine term adds a
    // small overshoot at the top so the body settles rather than stopping dead.
    const vT = smootherstep(clamp(t * 1.35, 0, 1));
    const hT = smootherstep(clamp((t - 0.22) / 0.78, 0, 1));
    const arc = Math.sin(Math.PI * t) * 0.06;
    position.x = lerp(_mantleStart.x, _mantleEnd.x, hT);
    position.z = lerp(_mantleStart.z, _mantleEnd.z, hT);
    position.y = lerp(_mantleStart.y, _mantleEnd.y, vT) + arc;
    velocity.set(0, 0, 0);
    onGround = false;

    if (t >= 1) {
      mantling = false;
      mantleT = 0;
      _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      velocity.set(_fwd.x * 2.3, 0.35, _fwd.z * 2.3);
      onGround = true;
      coyote = COYOTE_TIME;
      stepDip.v -= 3.4;
      emitFootstep(2.6);
    }
  }

  /* --- surfaces and footsteps -------------------------------------------- */

  function sampleSurfaceAt(x, y, z, nx, ny, nz) {
    const level = game?.level;
    if (level && typeof level.sampleSurface === 'function') {
      _tmpB.set(x, y, z);
      _tmpC.set(nx, ny, nz);
      try {
        const s = level.sampleSurface(_tmpB, _tmpC);
        if (typeof s === 'string' && s) {
          player.surfaceUnderfoot = s;
          return s;
        }
      } catch {
        /* a broken level module must not stop the player moving */
      }
    }
    return player.surfaceUnderfoot;
  }

  function emitFootstep(speed) {
    footstepParity ^= 1;
    FOOTSTEP_PAYLOAD.surface = player.surfaceUnderfoot;
    FOOTSTEP_PAYLOAD.foot = footstepParity ? 'left' : 'right';
    FOOTSTEP_PAYLOAD.speed = speed;
    game?.events?.emit?.('footstep', FOOTSTEP_PAYLOAD);
  }

  /* --- the frame --------------------------------------------------------- */

  function update(dt, gameRef) {
    if (gameRef) game = gameRef;
    dt = clamp(dt || 0, 0, 1 / 20);
    if (dt <= 0) return;

    const inp = game?.input;
    const state = game?.state;
    dead = !!state && state.health <= 0;

    /* --- external look sync (capture mode / menu drift set yaw directly) --- */
    if (Math.abs(player.yaw - lastYawOut) > 1e-6) {
      yaw = yawTarget = player.yaw;
      recoilAimAccum = 0;
      recoilRecover = 0;
    }
    if (Math.abs(player.pitch - lastPitchOut) > 1e-6) {
      pitch = pitchTarget = player.pitch;
    }

    /* --- look ------------------------------------------------------------ */
    const sens = inp?.sensitivity ?? 0.0022;
    const invert = inp?.invertY ? -1 : 1;
    const mdx = inp?.mouse?.dx || 0;
    const mdy = inp?.mouse?.dy || 0;
    const locked = inp ? inp.locked !== false : true;
    if (locked && !dead) {
      yawTarget -= mdx * sens;
      const pitchDelta = -mdy * sens * invert;
      pitchTarget += pitchDelta;
      // Pulling down during recoil recovery eats into what the game gives back, so manual
      // compensation and auto-recentre never double up and overshoot.
      if (pitchDelta < 0 && recoilRecover > 0) {
        recoilRecover = Math.max(0, recoilRecover + pitchDelta * 0.85);
      }
    }
    pitchTarget = clamp(pitchTarget, -PITCH_LIMIT, PITCH_LIMIT);
    // Keep yaw in a sane range without a visible wrap.
    if (yawTarget > Math.PI * 4 || yawTarget < -Math.PI * 4) {
      const wrap = yawTarget % (Math.PI * 2);
      yaw += wrap - yawTarget;
      yawTarget = wrap;
    }

    // Recoil recovery: bleed the owed pitch back out over ~0.2 s once the trigger is released.
    const now = game?.clock?.time ?? 0;
    const firing = !!(game?.weapon?.firing) || (!!inp?.mouse?.left && !!game?.weapon?.ammo);
    if (!firing && now - lastFireTime > RECOIL_RELEASE_DELAY && recoilAimAccum > 0) {
      recoilRecover += recoilAimAccum * RECOIL_RECENTER;
      recoilAimAccum = 0;
    }
    if (recoilRecover > 0) {
      const give = recoilRecover * approach(RECOIL_RECENTER_K, dt);
      pitchTarget -= give;
      recoilRecover -= give;
      if (recoilRecover < 1e-4) recoilRecover = 0;
    }

    // A touch of smoothing: enough to stop a 1000 Hz mouse strobing sub-pixel jitter through
    // TAA, far too little to feel like input lag.
    const lookA = approach(LOOK_SMOOTH_K, dt);
    yaw += (yawTarget - yaw) * lookA;
    pitch += (pitchTarget - pitch) * lookA;
    pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);

    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    forward.copy(_fwd);

    /* --- input axes ------------------------------------------------------ */
    let fAxis = 0;
    let sAxis = 0;
    if (!dead && locked) {
      // Actions, not codes — bindings live in core/input.js and the player can remap them.
      if (inp.actionDown?.('forward')) fAxis += 1;
      if (inp.actionDown?.('back')) fAxis -= 1;
      if (inp.actionDown?.('right')) sAxis += 1;
      if (inp.actionDown?.('left')) sAxis -= 1;
    }
    const jumpPressed = !dead && !!inp?.actionPressed?.('jump');
    const crouchWas = crouchHeld;
    crouchHeld = !dead && !!inp?.actionDown?.('crouch');
    if (crouchHeld && !crouchWas) crouchDip.v -= 1.4; // anticipation on the way down
    const sprintKey = !!inp?.actionDown?.('sprint');

    const ads = !!game?.weapon?.ads || (game?.weapon?.adsProgress ?? 0) > 0.35;
    const adsAmount = clamp(game?.weapon?.adsProgress ?? (ads ? 1 : 0), 0, 1);

    if (jumpPressed) jumpBuffer = JUMP_BUFFER;
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    slideCooldown = Math.max(0, slideCooldown - dt);
    mantleCooldown = Math.max(0, mantleCooldown - dt);

    /* --- mantle owns the frame when active ------------------------------- */
    if (mantling) {
      updateMantle(dt);
      updateCamera(dt, 0, 0, adsAmount);
      writeOut();
      return;
    }

    /* --- stance ---------------------------------------------------------- */
    const horizSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    player.speed = horizSpeed;

    // Sprint: forward only, cancelled outright by ADS or by pulling the trigger.
    const sprintBefore = sprintBlend;
    const wantSprint = sprintKey && fAxis > 0.1 && !crouchHeld && !ads && !firing && !dead;
    sprintBlend += ((wantSprint ? 1 : 0) - sprintBlend) * approach(wantSprint ? SPRINT_K : SPRINT_K * 2.2, dt);
    sprinting = wantSprint && sprintBlend > 0.55;

    // Slide entry: crouch while sprinting and actually moving. Tested against last frame's
    // sprint blend, because pressing crouch cancels sprint on this very frame.
    if (
      crouchHeld &&
      !sliding &&
      slideCooldown <= 0 &&
      onGround &&
      sprintBefore > 0.5 &&
      horizSpeed > SLIDE_ENTRY_SPEED
    ) {
      sliding = true;
      slideTimer = 0;
      const boosted = Math.min(SLIDE_SPEED_CAP, Math.max(horizSpeed * SLIDE_BOOST, SLIDE_ENTRY_SPEED * 1.55));
      const inv = horizSpeed > 1e-4 ? boosted / horizSpeed : 0;
      velocity.x *= inv;
      velocity.z *= inv;
      slideRollDir = sAxis < 0 ? -1 : 1; // roll onto the leading shoulder
      slideDip.v -= 5.5;
      slideRoll.v += slideRollDir * 0.9;
      trauma = Math.min(1, trauma + 0.1);
      game.audio?.playOneShot?.('slide', { surface: player.surfaceUnderfoot, volume: 0.9 });
    }

    if (sliding) {
      slideTimer += dt;
      const t = clamp(slideTimer / SLIDE_DURATION, 0, 1);
      // Friction curve: almost free at entry, biting hard at the tail. Squared so the last
      // third of the slide does most of the work.
      const fr = lerp(SLIDE_FRICTION_MIN, SLIDE_FRICTION_MAX, t * t);
      const sp = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
      if (sp > 1e-4) {
        const drop = Math.max(sp, STOP_SPEED) * fr * dt * 0.35;
        const scale = Math.max(0, sp - drop) / sp;
        velocity.x *= scale;
        velocity.z *= scale;
      }
      // Gravity projected onto the contact plane: downhill slides accelerate, uphill ones
      // die fast. tangential = g - n(g·n) with g = (0,-G,0) reduces to (G nx ny, ., G nz ny).
      if (onGround) {
        velocity.x += GRAVITY * _groundNormal.x * _groundNormal.y * dt * 0.85;
        velocity.z += GRAVITY * _groundNormal.z * _groundNormal.y * dt * 0.85;
      }
      const spNow = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
      if (
        slideTimer > SLIDE_DURATION ||
        spNow < SLIDE_EXIT_SPEED ||
        !crouchHeld ||
        jumpBuffer > 0 ||
        !onGround
      ) {
        sliding = false;
        slideCooldown = SLIDE_COOLDOWN;
        slideDip.v += 2.2;
      }
    }

    // Crouch blend, with a headroom test before standing back up.
    const wantCrouch = crouchHeld || sliding;
    let canStand = true;
    if (!wantCrouch && crouchBlend > 0.01 && ensureWorld()) {
      gatherAround(position.x, position.z, 0.25);
      const y0 = position.y + CROUCH_HEIGHT - RADIUS;
      const y1 = position.y + STAND_HEIGHT - RADIUS;
      canStand = !world.overlaps(position.x, y0, y1, position.z, RADIUS * 0.94);
    }
    const crouchTarget = wantCrouch || !canStand ? 1 : 0;
    crouchBlend += (crouchTarget - crouchBlend) * approach(crouchTarget > crouchBlend ? 15 : 11, dt);
    crouchBlend = clamp(crouchBlend, 0, 1);

    /* --- wish direction and speed ---------------------------------------- */
    _wish.set(0, 0, 0);
    if (fAxis !== 0 || sAxis !== 0) {
      _wish.set(_fwd.x * fAxis + _right.x * sAxis, 0, _fwd.z * fAxis + _right.z * sAxis);
      const l = Math.sqrt(_wish.x * _wish.x + _wish.z * _wish.z);
      if (l > 1e-5) {
        _wish.x /= l;
        _wish.z /= l;
      }
    }
    const wishing = _wish.x !== 0 || _wish.z !== 0;

    let wishSpeed = lerp(SPEED_WALK, SPEED_SPRINT, sprintBlend);
    if (adsAmount > 0.05) wishSpeed = lerp(wishSpeed, SPEED_ADS, adsAmount);
    if (crouchBlend > 0.05) wishSpeed = lerp(wishSpeed, SPEED_CROUCH, crouchBlend);
    if (fAxis < -0.1) wishSpeed *= SPEED_BACK_SCALE;
    else if (fAxis === 0 && sAxis !== 0) wishSpeed *= SPEED_STRAFE_SCALE;
    if (!wishing) wishSpeed = 0;
    if (dead) wishSpeed = 0;

    /* --- integrate motion ------------------------------------------------ */
    wasOnGround = onGround;
    let justJumped = false;

    // Gravity is applied unconditionally, including while grounded: the contact resolve
    // cancels it every frame, and the small residual sink is what keeps the capsule welded
    // to the floor instead of hovering a few millimetres above it.
    velocity.y -= GRAVITY * dt;

    if (onGround) {
      projectWishToGround();
      if (sliding) {
        // Slide friction is handled by its own curve above; no ground friction here.
        if (wishing) {
          // Minimal steering authority so the slide can be aimed but not accelerated.
          accelerate(_wish.x, _wish.y, _wish.z, Math.min(wishSpeed, 2.4), 2.6, dt);
        }
      } else {
        applyFriction(dt, 1);
        accelerate(_wish.x, _wish.y, _wish.z, wishSpeed, ACCEL_GROUND, dt);
      }
    } else {
      airAccelerate(_wish.x, _wish.z, wishSpeed, dt);
    }

    // Jump / vault. A jump into a qualifying ledge becomes a vault: far better than bouncing
    // off a waist-high crate.
    if (jumpBuffer > 0 && (onGround || coyote > 0) && !dead) {
      if (tryStartMantle(fAxis)) {
        jumpBuffer = 0;
        updateMantle(dt);
        updateCamera(dt, fAxis, sAxis, adsAmount);
        writeOut();
        return;
      }
      jumpBuffer = 0;
      coyote = 0;
      onGround = false;
      justJumped = true;
      velocity.y = JUMP_IMPULSE;
      if (sliding) {
        sliding = false;
        slideCooldown = SLIDE_COOLDOWN * 0.5;
        velocity.x *= 1.06;
        velocity.z *= 1.06;
      }
      airTime = 0;
      stepDip.v -= 1.2;
      game.audio?.playOneShot?.('jump', { surface: player.surfaceUnderfoot, volume: 0.55 });
    }

    // Terminal velocity. Also keeps the collide-and-slide sweep inside its substep budget.
    if (velocity.y < -46) velocity.y = -46;

    const fallSpeed = velocity.y;
    integrate(dt);

    /* --- ground state ----------------------------------------------------- */
    // Tested against the *ground normal*, not world up: walking up a ramp has a large +Y
    // velocity yet zero velocity through the surface, and must still count as grounded.
    let grounded =
      !justJumped && hasGroundContact && velocity.dot(_groundNormal) <= 0.9;
    if (!grounded && !justJumped && velocity.y <= 0.2) grounded = probeGround();
    if (grounded) {
      if (!wasOnGround) {
        // Landing. The dip is proportional to impact speed on a critically damped spring so
        // a step off a kerb barely registers and a two-storey drop hurts.
        const impact = clamp(-fallSpeed, 0, 22);
        if (impact > 1.6) {
          const mag = (impact - 1.6) / 12;
          landDip.v -= clamp(mag, 0, 1.6) * 9.0;
          trauma = Math.min(1, trauma + clamp(mag * 0.35, 0, 0.5));
          sampleSurfaceAt(position.x, position.y, position.z, _groundNormal.x, _groundNormal.y, _groundNormal.z);
          emitFootstep(impact);
          game.audio?.playOneShot?.('land', {
            surface: player.surfaceUnderfoot,
            volume: clamp(0.35 + mag * 0.6, 0.35, 1),
          });
          // Fall damage above roughly a three-storey drop.
          if (impact > 13.5) applyDamage((impact - 13.5) * 7.5, null);
        }
      }
      onGround = true;
      coyote = COYOTE_TIME;
      airTime = 0;
      // Clip the velocity into the ground plane: this cancels the gravity we integrated this
      // frame, and kills the upward component an edge contact tilts out of horizontal speed
      // (left alone, that launches the player off every kerb). On flat ground it is exactly
      // `velocity.y = 0`; on a ramp it preserves the climb.
      const intoGround = velocity.dot(_groundNormal);
      velocity.addScaledVector(_groundNormal, -intoGround);
    } else {
      onGround = false;
      coyote = Math.max(0, coyote - dt);
      airTime += dt;
    }

    // Auto-vault: pressing forward into a ledge for a moment vaults it without a jump press.
    if (blockedByWall && fAxis > 0.3 && (onGround || coyote > 0)) {
      const into = -(lastWallNx * _fwd.x + lastWallNz * _fwd.z);
      wallPress = into > 0.3 ? wallPress + dt : 0;
    } else {
      wallPress = 0;
    }
    if (wallPress > 0.08 && mantleCooldown <= 0) {
      if (tryStartMantle(fAxis)) {
        wallPress = 0;
        updateMantle(dt);
        updateCamera(dt, fAxis, sAxis, adsAmount);
        writeOut();
        return;
      }
    }

    /* --- surface under foot ------------------------------------------------ */
    surfaceTimer -= dt;
    if (onGround && surfaceTimer <= 0) {
      surfaceTimer = 0.18;
      sampleSurfaceAt(position.x, position.y + 0.02, position.z, _groundNormal.x, _groundNormal.y, _groundNormal.z);
    }

    updateCamera(dt, fAxis, sAxis, adsAmount);
    writeOut();
  }

  /* --- camera stack ------------------------------------------------------ */

  function updateCamera(dt, fAxis, sAxis, adsAmount) {
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    const speedRatio = clamp(speed / SPEED_SPRINT, 0, 1.15);
    const adsSuppress = 1 - 0.85 * adsAmount; // contract: bob down to 15% in ADS
    const grounded = onGround ? 1 : 0;

    /* Bob — a figure of eight. x = sin(phase), y = sin(2*phase) traces the lateral sway of a
       walk cycle with the vertical bounce at twice the rate, which is what a real gait does.
       Amplitude and frequency both ride the speed so a sprint reads heavier, not just faster. */
    const strideHz = 0.95 + 1.35 * speedRatio;
    const prevPhase = bobPhase;
    if (grounded && speed > 0.35 && !mantling) {
      bobPhase += Math.PI * 2 * strideHz * dt;
    } else {
      // Airborne: let the phase glide to a stop so the bob does not snap on landing.
      bobPhase += Math.PI * 2 * strideHz * dt * 0.15;
    }
    if (bobPhase > Math.PI * 2) {
      bobPhase -= Math.PI * 2;
    }

    // Footstep on each half-cycle crossing (two steps per stride).
    if (grounded && speed > 1.1 && !sliding && !mantling) {
      const prevHalf = Math.floor(prevPhase / Math.PI);
      const nowHalf = Math.floor(bobPhase / Math.PI);
      if (nowHalf !== prevHalf) {
        stepDip.v -= 1.1 + 1.9 * speedRatio;
        const hardness = SURFACES[player.surfaceUnderfoot]?.hardness ?? 0.5;
        emitFootstep(speed);
        game.audio?.playOneShot?.('footstep', {
          surface: player.surfaceUnderfoot,
          volume: clamp(0.25 + speedRatio * 0.55 + hardness * 0.15, 0.2, 1),
          speed,
        });
      }
    }

    const bobAmp = speedRatio * speedRatio * 0.55 + speedRatio * 0.45;
    const targetBobX = Math.sin(bobPhase) * 0.042 * bobAmp * adsSuppress * grounded;
    const targetBobY = Math.sin(bobPhase * 2) * 0.030 * bobAmp * adsSuppress * grounded;
    const targetBobRoll = Math.sin(bobPhase) * 0.0075 * bobAmp * adsSuppress * grounded;
    springTo(bobX, targetBobX, 190, 1.0, dt);
    springTo(bobY, targetBobY, 190, 1.0, dt);
    springTo(bobRoll, targetBobRoll, 150, 1.0, dt);

    /* Lean — roll into the strafe with a matching lateral offset. Capped at the contract's
       1.1 degrees; more than that and the horizon starts to swim. */
    const leanAuthority = (1 - 0.6 * adsAmount) * clamp(speed / SPEED_WALK, 0, 1);
    const targetLean = -sAxis * 1.1 * DEG * leanAuthority;
    const targetLeanX = -sAxis * 0.032 * leanAuthority;
    springTo(leanRoll, targetLean, 62, 0.85, dt);
    springTo(leanX, targetLeanX, 55, 0.9, dt);

    /* Dips: landing, footstep, slide, crouch. All critically damped so nothing rings. */
    springTo(landDip, 0, 95, 0.85, dt);
    springTo(stepDip, 0, 150, 0.9, dt);
    springTo(slideDip, sliding ? -0.24 : 0, 70, 0.9, dt);
    springTo(slideRoll, sliding ? slideRollDir * 3.6 * DEG : 0, 48, 0.95, dt);
    springTo(crouchDip, 0, 80, 1.0, dt);
    springTo(stepSmooth, 0, 170, 1.0, dt);

    /* Breathing: two out-of-phase sines, sub-degree, fading out as you move so it never
       competes with the bob. */
    breathPhase += dt;
    const idle = clamp(1 - speed / 1.8, 0, 1) * (1 - 0.35 * adsAmount);
    const breathPitch = Math.sin(breathPhase * 0.9) * 0.0015 * idle;
    const breathYaw = Math.sin(breathPhase * 0.61 + 1.1) * 0.0021 * idle;
    const breathY = Math.sin(breathPhase * 0.9 + 0.4) * 0.0035 * idle;

    /* Recoil springs. Stiff with a hint of overshoot: punchy, but it settles inside 200 ms. */
    springTo(recoilPitch, 0, 210, 0.72, dt);
    springTo(recoilYaw, 0, 180, 0.78, dt);
    springTo(recoilPush, 0, 160, 0.85, dt);
    springTo(mantlePitch, 0, 90, 0.8, dt);

    /* Trauma shake: two irrational frequencies per axis so it never looks periodic, scaled by
       trauma squared so light hits stay subtle. */
    trauma = Math.max(0, trauma - dt * 1.35);
    const shake = trauma * trauma;
    const st = (game?.clock?.time ?? 0) + shakeSeed;
    const shakePitch = shake * 0.030 * (Math.sin(st * 27.3) * 0.6 + Math.sin(st * 41.7) * 0.4);
    const shakeYaw = shake * 0.034 * (Math.sin(st * 23.1 + 1.7) * 0.6 + Math.sin(st * 37.9) * 0.4);
    const shakeRoll = shake * 0.026 * Math.sin(st * 19.4 + 0.6);

    /* --- compose ---------------------------------------------------------- */

    const height = capsuleHeight();
    const eyeH = height - EYE_INSET;

    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    _eyeTmp.set(position.x, position.y + eyeH, position.z);
    _eyeTmp.y +=
      bobY.x + landDip.x * 0.16 + stepDip.x * 0.045 + slideDip.x + crouchDip.x * 0.35 + stepSmooth.x;
    _eyeTmp.addScaledVector(_right, bobX.x + leanX.x + shakeYaw * 0.25);
    _eyeTmp.addScaledVector(_fwd, -recoilPush.x * 0.5);
    if (mantling) {
      // Duck the head towards the ledge on the way over.
      _eyeTmp.y -= Math.sin(Math.PI * clamp(mantleT, 0, 1)) * 0.12;
    }
    eye.copy(_eyeTmp);

    // The recoil springs carry radians directly, so the visual kick equals the kick the
    // weapon asked for; every other layer is a scaled contribution.
    const pitchOffset =
      recoilPitch.x +
      landDip.x * 0.012 +
      stepDip.x * 0.012 +
      breathPitch +
      shakePitch +
      mantlePitch.x * 0.3;
    const yawOffset = recoilYaw.x + breathYaw + shakeYaw;
    const rollOffset =
      leanRoll.x + bobRoll.x + slideRoll.x + shakeRoll + mantlePitch.x * 0.03;

    _lookEuler.set(pitch, yaw, 0, 'YXZ');
    _qLook.setFromEuler(_lookEuler);
    _offsetEuler.set(pitchOffset, yawOffset, rollOffset, 'YXZ');
    _qOffset.setFromEuler(_offsetEuler);
    _qLook.multiply(_qOffset);

    const cam = game?.camera;
    if (cam) {
      cam.position.copy(eye);
      cam.quaternion.copy(_qLook);
    }

    /* FOV pulse — subtle, tied to the bob and the sprint so speed is felt as well as seen.
       We only ever add a delta on top of whatever the weapon's ADS pull-in has set, and we
       detect an external write so the two never fight. */
    const pulseTarget =
      sprintBlend * 2.6 * (1 - adsAmount) +
      (sliding ? 3.2 : 0) +
      bobY.x * 9 * (1 - adsAmount) -
      landDip.x * 0.4;
    springTo(fovSpring, pulseTarget, 45, 0.9, dt);
    const pulse = clamp(fovSpring.x, -4, 5);
    player.fovPulse = pulse;
    if (cam && typeof cam.fov === 'number') {
      if (Math.abs(cam.fov - fovLastWritten) > 1e-4) fovBase = cam.fov; // someone else owns it now
      const next = fovBase + pulse;
      // Threshold generously: updateProjectionMatrix is the one call in this file that
      // allocates (inside Three), so a settled camera must not touch it every frame.
      if (Math.abs(next - cam.fov) > 0.02) {
        cam.fov = next;
        cam.updateProjectionMatrix();
      }
      fovLastWritten = cam.fov;
    }
  }

  function writeOut() {
    player.yaw = yaw;
    player.pitch = pitch;
    lastYawOut = yaw;
    lastPitchOut = pitch;
    player.onGround = onGround;
    player.crouched = crouchBlend > 0.5;
    player.sprinting = sprinting;
    player.sliding = sliding;
    player.mantling = mantling;
    player.airTime = airTime;
    player.height = capsuleHeight();
    player.speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    player.stance = sliding ? 'SLIDE' : player.crouched ? 'CROUCH' : sprinting ? 'SPRINT' : 'STAND';
  }

  /* --- public API -------------------------------------------------------- */

  player.update = update;

  /**
   * Called by weapon.js on every shot. `pitchKick` is upward in radians, `yawKick` lateral.
   * The visual spring is separate from the aim change: the camera snaps, but only
   * RECOIL_AIM_GAIN of the kick actually moves where the bullets go, and 70 percent of that
   * comes back for free when the trigger is released. That combination is what makes a
   * recoil pattern learnable.
   */
  player.applyRecoil = function applyRecoil(pitchKick = 0, yawKick = 0) {
    // The impulse is sized so the spring's peak displacement lands on the requested kick:
    // for a critically-ish damped spring, x_peak ≈ v0 / ω with ω = sqrt(k).
    recoilPitch.v += pitchKick * 19; // k = 210 -> ω ≈ 14.5
    recoilYaw.v += yawKick * 17; // k = 180 -> ω ≈ 13.4
    recoilPush.v += Math.abs(pitchKick) * 14;
    const aim = pitchKick * RECOIL_AIM_GAIN;
    pitchTarget = clamp(pitchTarget + aim, -PITCH_LIMIT, PITCH_LIMIT);
    yawTarget += yawKick * RECOIL_AIM_GAIN * 0.55;
    recoilAimAccum += Math.max(0, aim);
    lastFireTime = game?.clock?.time ?? 0;
    trauma = Math.min(1, trauma + Math.abs(pitchKick) * 0.12);
  };

  player.damage = function damage(amount, dir) {
    applyDamage(amount, dir);
  };

  player.teleport = function teleport(pos, newYaw) {
    if (pos) {
      position.copy(pos);
      spawnPos.copy(pos);
    }
    if (typeof newYaw === 'number') {
      yaw = yawTarget = newYaw;
      spawnYaw = newYaw;
    }
    pitch = pitchTarget = 0;
    velocity.set(0, 0, 0);
    sliding = false;
    mantling = false;
    crouchBlend = 0;
    sprintBlend = 0;
    trauma = 0;
    recoilAimAccum = 0;
    recoilRecover = 0;
    landDip.x = landDip.v = 0;
    stepDip.x = stepDip.v = 0;
    bobX.x = bobX.v = bobY.x = bobY.v = 0;
    snapToGround();
    spawnPos.copy(position);
    onGround = true;
    coyote = COYOTE_TIME;
    airTime = 0;
    player.yaw = yaw;
    player.pitch = pitch;
    lastYawOut = yaw;
    lastPitchOut = pitch;
    _eyeTmp.set(position.x, position.y + CAMERA.eyeHeight, position.z);
    eye.copy(_eyeTmp);
    if (game?.camera) {
      game.camera.position.copy(eye);
      _lookEuler.set(pitch, yaw, 0, 'YXZ');
      game.camera.quaternion.setFromEuler(_lookEuler);
    }
  };

  player.respawn = function () {
    player.teleport(spawnPos, spawnYaw);
    if (game?.state) {
      game.state.health = game.state.maxHealth ?? 100;
      game.state.hitFlash = 0;
    }
    dead = false;
  };

  /** Kick the camera without touching aim — used for explosions, heavy impacts, scripted beats. */
  player.addTrauma = function (amount) {
    trauma = clamp(trauma + (amount || 0), 0, 1);
  };

  player.dispose = function dispose() {
    if (typeof offDamage === 'function') offDamage();
    else game?.events?.off?.('damage', onDamageEvent);
    if (typeof offExplosion === 'function') offExplosion();
    else game?.events?.off?.('explosion', onExplosion);
    world.tris = null;
    world.items = null;
    world.starts = null;
    world.stamp = null;
    world.normals = null;
    world.planeD = null;
    world.source = null;
    world.ready = false;
  };

  /* --- init -------------------------------------------------------------- */

  ensureWorld();
  const first = game?.level?.spawnPoints?.[0];
  if (first && first.pos) {
    player.teleport(first.pos, first.yaw ?? Math.PI);
  } else {
    player.teleport(position, yaw);
  }

  return player;
}

export default createPlayer;
