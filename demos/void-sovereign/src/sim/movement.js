import * as THREE from '../../vendor/three/build/three.module.js';
import { ROLE } from '../ships/catalog.js';

/* Flight model, steering and local avoidance.

   Everything here is 3D. A ship is a rigid body with a forward axis (+Z), a
   turn rate and an acceleration; it cannot slide sideways freely and it cannot
   stop on a sixpence. The whole "Homeworld feel" comes out of three details:

     1. Thrust is applied along the hull, not toward the waypoint. A capital
        that wants to go left must first spend twenty seconds coming about.
     2. Sideways velocity bleeds off at a role-dependent rate ("grip"), so
        fighters carve and capitals drift wide through a turn.
     3. Roll is driven by yaw rate, so anything that turns banks into it.

   Steering targets are set by combat/economy/ai through the setNav* helpers;
   this module owns integration and orientation and nothing else. */

export const NAV = {
  IDLE: 0,
  ARRIVE: 1,
  SEEK: 2,
  PURSUE: 3,
  HOLD: 4,
};

const FACE_TRAVEL = 0;
const FACE_POINT = 1;

/* Per-role handling. `lateral` is how much of the steering demand a ship can
   satisfy with translation rather than rotation; `grip` is how fast sideways
   velocity bleeds; `bank` is the maximum roll into a turn, in radians. */
const PROFILE = {
  [ROLE.FIGHTER]: { lateral: 0.55, grip: 2.30, brake: 0.95, bank: 1.05, reverse: 0.28, sep: 1.35 },
  [ROLE.CORVETTE]: { lateral: 0.38, grip: 1.55, brake: 0.80, bank: 0.78, reverse: 0.22, sep: 1.15 },
  [ROLE.FRIGATE]: { lateral: 0.16, grip: 0.78, brake: 0.55, bank: 0.42, reverse: 0.13, sep: 0.85 },
  [ROLE.CAPITAL]: { lateral: 0.07, grip: 0.44, brake: 0.36, bank: 0.24, reverse: 0.08, sep: 0.7 },
  [ROLE.SUPPORT]: { lateral: 0.18, grip: 0.85, brake: 0.60, bank: 0.40, reverse: 0.14, sep: 0.9 },
  [ROLE.RESOURCE]: { lateral: 0.30, grip: 1.15, brake: 0.75, bank: 0.52, reverse: 0.20, sep: 1.0 },
  [ROLE.STRUCTURE]: { lateral: 0.05, grip: 0.36, brake: 0.30, bank: 0.12, reverse: 0.06, sep: 0.5 },
};

const DEFAULT_PROFILE = PROFILE[ROLE.FRIGATE];

/* Scratch. The tick loop runs thousands of times a second; nothing in here
   may allocate. */
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _des = new THREE.Vector3();
const _desFwd = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _refUp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_FWD = new THREE.Vector3(0, 0, 1);

export function profileFor(role) {
  return PROFILE[role] || DEFAULT_PROFILE;
}

/**
 * Deceleration a hull can actually produce along its own axis: retro thrust
 * plus the airbrake term. The arrive curve has to use this and not the full
 * forward figure, or every ship plans a stop it has no way of making and
 * sails straight over its waypoint.
 */
function decelFor(e) {
  const p = e.profile;
  return Math.max(1e-3, e.maxAccel * (p.reverse + p.brake * 0.35));
}

/** Attach the mutable flight state an entity needs. Called once, at spawn. */
export function initMovementState(e) {
  const d = e.def;
  e.profile = profileFor(e.role);
  e.maxSpeed = d.speed || 1;
  e.maxAccel = d.accel || 10;
  e.turnRate = d.turnRate || 0.2;
  e.rollRate = d.rollRate || 0.2;
  e.mass = Math.max(1, d.length * d.length * d.length * 1e-3);

  e.navMode = NAV.IDLE;
  e.navPoint = new THREE.Vector3();
  e.navVel = new THREE.Vector3();
  e.navSpeed = 1;
  e.navArrive = 0;
  e.faceMode = FACE_TRAVEL;
  e.facePoint = new THREE.Vector3();

  e.throttle = 0;
  e.bank = 0;
  e.yawRate = 0;
  e.speed = 0;
  e._sepX = 0;
  e._sepY = 0;
  e._sepZ = 0;
}

/* ------------------------------------------------------------------ nav API */

export function setNavArrive(e, point, speedScale = 1, arriveRadius = 0) {
  e.navMode = NAV.ARRIVE;
  e.navPoint.copy(point);
  e.navSpeed = speedScale;
  e.navArrive = arriveRadius;
}

export function setNavSeek(e, point, speedScale = 1) {
  e.navMode = NAV.SEEK;
  e.navPoint.copy(point);
  e.navSpeed = speedScale;
  e.navArrive = 0;
}

export function setNavPursue(e, point, vel, speedScale = 1) {
  e.navMode = NAV.PURSUE;
  e.navPoint.copy(point);
  e.navVel.copy(vel);
  e.navSpeed = speedScale;
}

export function setNavHold(e) {
  e.navMode = NAV.HOLD;
}

export function setNavIdle(e) {
  e.navMode = NAV.IDLE;
}

export function setFacePoint(e, point) {
  if (point) {
    e.faceMode = FACE_POINT;
    e.facePoint.copy(point);
  } else {
    e.faceMode = FACE_TRAVEL;
  }
}

/** Where to shoot at / fly to so a constant-velocity target is intercepted. */
export function predictIntercept(from, targetPos, targetVel, projectileSpeed, out) {
  const rx = targetPos.x - from.x;
  const ry = targetPos.y - from.y;
  const rz = targetPos.z - from.z;
  const c = rx * rx + ry * ry + rz * rz;
  if (!(projectileSpeed > 0)) {
    out.copy(targetPos);
    return 0;
  }
  const vs = targetVel.x * targetVel.x + targetVel.y * targetVel.y + targetVel.z * targetVel.z;
  const a = vs - projectileSpeed * projectileSpeed;
  const b = 2 * (rx * targetVel.x + ry * targetVel.y + rz * targetVel.z);
  let t = -1;
  if (Math.abs(a) < 1e-3) {
    if (Math.abs(b) > 1e-6) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b + sq) / (2 * a);
      const t2 = (-b - sq) / (2 * a);
      const lo = Math.min(t1, t2);
      const hi = Math.max(t1, t2);
      t = lo > 1e-4 ? lo : hi;
    }
  }
  if (!(t > 0) || t > 20) t = Math.sqrt(c) / projectileSpeed;
  out.set(
    targetPos.x + targetVel.x * t,
    targetPos.y + targetVel.y * t,
    targetPos.z + targetVel.z * t,
  );
  return t;
}

/* ------------------------------------------------------------------- update */

/** Desired world velocity for the entity's current nav mode, into `_des`. */
function desiredVelocity(e, dt) {
  const p = e.position;
  const maxV = e.maxSpeed * e.navSpeed;

  switch (e.navMode) {
    case NAV.SEEK: {
      _des.set(e.navPoint.x - p.x, e.navPoint.y - p.y, e.navPoint.z - p.z);
      const d = _des.length();
      if (d < 1e-3) return _des.set(0, 0, 0);
      return _des.multiplyScalar(maxV / d);
    }
    case NAV.PURSUE: {
      // Lead the mark by the time it takes us to close, capped so we do not
      // chase a phantom half a map away.
      _des.set(e.navPoint.x - p.x, e.navPoint.y - p.y, e.navPoint.z - p.z);
      const d = _des.length();
      const lead = Math.min(6, d / Math.max(60, maxV));
      _tmp.set(
        e.navPoint.x + e.navVel.x * lead - p.x,
        e.navPoint.y + e.navVel.y * lead - p.y,
        e.navPoint.z + e.navVel.z * lead - p.z,
      );
      const d2 = _tmp.length();
      if (d2 < 1e-3) return _des.set(0, 0, 0);
      return _des.copy(_tmp).multiplyScalar(maxV / d2);
    }
    case NAV.ARRIVE: {
      _des.set(e.navPoint.x - p.x, e.navPoint.y - p.y, e.navPoint.z - p.z);
      const d = _des.length();
      const slack = d - e.navArrive;
      // Inside the dead-band the demand is zero, not a tiny vector pointing
      // back at the mark — that is the difference between parking and
      // oscillating about the waypoint for the rest of the match.
      if (slack < 1e-3) return _des.set(0, 0, 0);
      // v = sqrt(2 a s) puts us at zero speed exactly on the mark, provided
      // `a` is a deceleration the hull can genuinely produce.
      const want = Math.min(maxV, Math.sqrt(2 * decelFor(e) * slack));
      return _des.multiplyScalar(want / d);
    }
    case NAV.HOLD:
      return _des.set(0, 0, 0);
    default:
      // Idle ships coast to a stop rather than freezing in place.
      _des.copy(e.velocity).multiplyScalar(Math.max(0, 1 - dt * 0.6));
      return _des;
  }
}

function orient(e, dt) {
  _fwd.copy(WORLD_FWD).applyQuaternion(e.quaternion);
  _up.copy(WORLD_UP).applyQuaternion(e.quaternion);

  // --- where do we want the nose ---
  let haveTarget = true;
  if (e.faceMode === FACE_POINT) {
    _desFwd.set(
      e.facePoint.x - e.position.x,
      e.facePoint.y - e.position.y,
      e.facePoint.z - e.position.z,
    );
    if (_desFwd.lengthSq() < 1e-6) haveTarget = false;
    else _desFwd.normalize();
  } else if (_des.lengthSq() > 4) {
    _desFwd.copy(_des).normalize();
  } else if (e.velocity.lengthSq() > 4) {
    _desFwd.copy(e.velocity).normalize();
  } else {
    haveTarget = false;
  }

  let yawRate = 0;
  if (haveTarget) {
    let dot = _fwd.dot(_desFwd);
    if (dot > 1) dot = 1;
    else if (dot < -1) dot = -1;
    const angle = Math.acos(dot);
    if (angle > 1e-4) {
      _axis.crossVectors(_fwd, _desFwd);
      if (_axis.lengthSq() < 1e-10) _axis.copy(_up); // exactly antipodal: pick a plane
      _axis.normalize();

      /* Big course changes are made flat.

         A raw shortest-arc rotation has no opinion about which plane it turns
         in, and for a course reversal the cross product is numerical noise —
         so a ship asked to come about would pick an arbitrary plane, often
         looping vertically and finishing the manoeuvre inverted. No warship
         does that. The heavier the hull the harder the turn is pulled into the
         horizontal, so capitals come about like ships while fighters keep the
         freedom to loop, which is theirs by right. */
      if (angle > 1.2) {
        const flat = 1 - Math.min(1, e.profile.lateral * 2.2);
        if (flat > 0.01) {
          _tmp2.copy(_up).multiplyScalar(_axis.dot(_up) >= 0 ? 1 : -1);
          _axis.lerp(_tmp2, flat * Math.min(1, (angle - 1.2) / 0.8)).normalize();
        }
      }
      const step = Math.min(angle, e.turnRate * dt);
      _q.setFromAxisAngle(_axis, step);
      e.quaternion.premultiply(_q).normalize();
      yawRate = _axis.dot(_up) * (step / dt);
      _fwd.copy(WORLD_FWD).applyQuaternion(e.quaternion);
      _up.copy(WORLD_UP).applyQuaternion(e.quaternion);
    }
  }
  e.yawRate = yawRate;

  // --- roll into the turn ---
  const speedFrac = Math.min(1, e.speed / e.maxSpeed);
  let want = (yawRate / e.turnRate) * e.profile.bank * (0.25 + 0.75 * speedFrac);
  const lim = e.profile.bank;
  if (want > lim) want = lim;
  else if (want < -lim) want = -lim;

  // Reference "level": world up with the forward component removed.
  _refUp.copy(WORLD_UP).addScaledVector(_fwd, -WORLD_UP.dot(_fwd));
  if (_refUp.lengthSq() < 1e-6) {
    // Nose straight up or down — no meaningful level, keep the current roll.
    e.bank = want;
    return;
  }
  _refUp.normalize();
  _tmp.crossVectors(_refUp, _up);
  const now = Math.atan2(_tmp.dot(_fwd), _refUp.dot(_up));
  let delta = want - now;
  const maxRoll = e.rollRate * dt;
  if (delta > maxRoll) delta = maxRoll;
  else if (delta < -maxRoll) delta = -maxRoll;
  if (Math.abs(delta) > 1e-6) {
    _q.setFromAxisAngle(_fwd, delta);
    e.quaternion.premultiply(_q).normalize();
  }
  e.bank = now + delta;
}

function thrust(e, dt) {
  _fwd.copy(WORLD_FWD).applyQuaternion(e.quaternion);
  const prof = e.profile;

  const vFwd = e.velocity.dot(_fwd);
  const wantFwd = _des.dot(_fwd);

  // Forward axis: full acceleration ahead, weak retro.
  let along = (wantFwd - vFwd) / dt;
  const aMax = e.maxAccel;
  let aMin = -aMax * prof.reverse - aMax * prof.brake * 0.35;

  /* Turning is not stopping.

     A ship whose destination lies behind it has a demand pointing backwards,
     and a naive flight model answers that by slamming into reverse: it brakes
     to a near halt, pivots on the spot and accelerates away. That is the tell
     the brief bans. A warship instead carries its way through the turn and
     comes about in a wide arc, so braking authority is cut while the demand is
     off the nose and restored as the hull swings onto it. Arrival still brakes
     properly, because by then the mark is dead ahead. */
  const desLen = _des.length();
  if (desLen > 1e-4) {
    const align = wantFwd / desLen;
    if (align < 0.5) aMin *= 0.1 + 0.18 * Math.max(0, align + 0.5);
  }
  if (along > aMax) along = aMax;
  else if (along < aMin) along = aMin;
  e.velocity.addScaledVector(_fwd, along * dt);

  // Lateral authority: what a ship can do with vectored thrust rather than by
  // turning. Fighters have a lot of it, capitals essentially none.
  _tmp.copy(_des).addScaledVector(_fwd, -wantFwd);
  _tmp2.copy(e.velocity).addScaledVector(_fwd, -e.velocity.dot(_fwd));
  _tmp.sub(_tmp2); // lateral velocity error
  const latErr = _tmp.length();
  let latUsed = 0;
  if (latErr > 1e-4) {
    const latMax = aMax * prof.lateral;
    const mag = Math.min(latMax, latErr / dt);
    e.velocity.addScaledVector(_tmp, (mag * dt) / latErr);
    latUsed = mag / aMax;
  }

  // Grip: sideslip bleeds off. This is what makes a banked turn carve.
  _tmp2.copy(e.velocity).addScaledVector(_fwd, -e.velocity.dot(_fwd));
  const bleed = Math.min(1, prof.grip * dt);
  e.velocity.addScaledVector(_tmp2, -bleed);

  /* Throttle drives every engine plume and trail the FX layer draws, so it
     has to be an honest account of what the drives are doing: main burn, the
     glow of a hull already travelling fast, vectored thrust, and a floor from
     the manoeuvring jets while a capital hauls its nose round. It is written
     every tick for every hull, moving or parked. */
  const burn = along > 0 ? along / aMax : 0;
  const cruise = Math.max(0, vFwd) / e.maxSpeed;
  const swing = e.turnRate > 1e-4 ? Math.abs(e.yawRate) / e.turnRate : 0;
  let want = burn;
  if (cruise * 0.5 > want) want = cruise * 0.5;
  if (latUsed * 0.6 > want) want = latUsed * 0.6;
  if (swing * 0.2 > want) want = swing * 0.2;
  if (want > 1) want = 1;
  e.throttle += (want - e.throttle) * Math.min(1, dt * 7);
  if (e.throttle < 0) e.throttle = 0;
}

/** Steering + orientation for every live entity. Positions are untouched. */
export function updateSteering(world, dt) {
  const list = world.dense;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    e.prevPosition.copy(e.position);
    e.prevQuaternion.copy(e.quaternion);
    e.speed = e.velocity.length();
    desiredVelocity(e, dt);
    orient(e, dt);
    thrust(e, dt);
  }
}

/* -------------------------------------------------------- local avoidance */

/* A 40-ship wing must not occupy one cubic metre, and a destroyer must not
   sail through a cruiser. Cheap separation only: no RVO, no pathfinding —
   an inverse-square push weighted by mass, plus hard depenetration for the
   big hulls where visual interpenetration would be unforgivable. */

let _self = null;
let _sepDt = 0;

function separateVisitor(n) {
  const e = _self;
  if (n === e || !n.alive) return;
  const dx = e.position.x - n.position.x;
  const dy = e.position.y - n.position.y;
  const dz = e.position.z - n.position.z;
  let d2 = dx * dx + dy * dy + dz * dz;
  const want = e.radius + n.radius + 14 + (e.radius + n.radius) * 0.35;
  if (d2 > want * want) return;

  let d = Math.sqrt(d2);
  let nx;
  let ny;
  let nz;
  if (d < 1e-3) {
    // Perfectly coincident: shove apart along a stable, id-derived axis so the
    // result stays deterministic.
    const h = (e.id * 2654435761) >>> 0;
    nx = ((h & 255) / 255) * 2 - 1;
    ny = (((h >>> 8) & 255) / 255) * 2 - 1;
    nz = (((h >>> 16) & 255) / 255) * 2 - 1;
    d = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= d;
    ny /= d;
    nz /= d;
    d = 0.001;
  } else {
    nx = dx / d;
    ny = dy / d;
    nz = dz / d;
  }

  const overlap = (want - d) / want;
  // Mass ratio: the small ship gets out of the way, not the carrier.
  const share = n.mass / (e.mass + n.mass);
  const push = overlap * overlap * e.maxAccel * e.profile.sep * 2.4 * share;
  e._sepX += nx * push;
  e._sepY += ny * push;
  e._sepZ += nz * push;

  // Hard separation for hulls big enough that clipping would show.
  const solid = e.radius + n.radius;
  if (d < solid * 0.92 && e.radius > 40 && n.radius > 40) {
    const fix = (solid * 0.92 - d) * share * 0.5;
    e.position.x += nx * fix;
    e.position.y += ny * fix;
    e.position.z += nz * fix;
  }
  void _sepDt;
}

/** Separation + integration. Call after updateSteering, once per tick. */
export function updateIntegration(world, dt) {
  const list = world.dense;
  _sepDt = dt;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    e._sepX = 0;
    e._sepY = 0;
    e._sepZ = 0;
    if (e.avoid !== false) {
      _self = e;
      const qr = e.radius * 2.6 + 120 + e.speed * 0.3;
      world.forEachNear(e.position.x, e.position.y, e.position.z, qr, separateVisitor);
    }
  }
  _self = null;

  const bound = world.bounds;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;

    e.velocity.x += e._sepX * dt;
    e.velocity.y += e._sepY * dt;
    e.velocity.z += e._sepZ * dt;

    // Speed ceiling. Separation may briefly exceed it; that is fine, clamp.
    const cap = e.maxSpeed * 1.25;
    const s2 = e.velocity.lengthSq();
    if (s2 > cap * cap) e.velocity.multiplyScalar(cap / Math.sqrt(s2));

    // Idle/hold: kill the residual creep so parked fleets actually park.
    if (e.navMode === NAV.HOLD || (e.navMode === NAV.IDLE && s2 < 4)) {
      e.velocity.multiplyScalar(Math.max(0, 1 - dt * 2.2));
    }

    e.position.x += e.velocity.x * dt;
    e.position.y += e.velocity.y * dt;
    e.position.z += e.velocity.z * dt;
    e.speed = e.velocity.length();

    // Keep everything inside the playable cube; a soft wall, not a bounce.
    if (bound) {
      const b = bound;
      if (e.position.x > b) { e.position.x = b; if (e.velocity.x > 0) e.velocity.x *= -0.2; }
      else if (e.position.x < -b) { e.position.x = -b; if (e.velocity.x < 0) e.velocity.x *= -0.2; }
      if (e.position.y > b) { e.position.y = b; if (e.velocity.y > 0) e.velocity.y *= -0.2; }
      else if (e.position.y < -b) { e.position.y = -b; if (e.velocity.y < 0) e.velocity.y *= -0.2; }
      if (e.position.z > b) { e.position.z = b; if (e.velocity.z > 0) e.velocity.z *= -0.2; }
      else if (e.position.z < -b) { e.position.z = -b; if (e.velocity.z < 0) e.velocity.z *= -0.2; }
    }
  }
}

/* ------------------------------------------------------- render transforms */

/** Lerp/slerp sim truth onto the scene graph. Called once per rendered frame. */
export function syncTransforms(world, alpha) {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const list = world.dense;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const o = e.object3D;
    if (!o) continue;
    o.position.lerpVectors(e.prevPosition, e.position, a);
    o.quaternion.copy(e.prevQuaternion).slerp(e.quaternion, a);
    o.updateMatrix();
    o.matrixWorldNeedsUpdate = true;
  }
}
