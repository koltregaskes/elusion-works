import * as THREE from '../../vendor/three/build/three.module.js';
import { bus } from '../core/events.js';
import { ROLE, damageAffinity } from '../ships/catalog.js';
import {
  setNavArrive,
  setNavSeek,
  setNavHold,
  setFacePoint,
  predictIntercept,
} from './movement.js';

/* Targeting, weapon cooldowns, projectiles and the damage pipeline.

   Two things here matter more than anything else:

   * Shots travel. Everything except an ion beam is a simulated body with a
     speed and a lifetime, launched at a predicted intercept. A fighter that
     breaks hard genuinely dodges — that is where the game lives.
   * Fighters make attack runs. Approach, fire, break off, loop back. A ship
     that hovers in front of its target shooting is the tell of a bad space
     RTS and is explicitly banned here. */

export const STANCE = {
  AGGRESSIVE: 'aggressive',
  NEUTRAL: 'neutral',
  PASSIVE: 'passive',
  EVASIVE: 'evasive',
};

/* Stance tuning: how far a ship looks for trouble, how far it will stray from
   its station to get it, and whether it shoots at all. */
const STANCE_CFG = {
  [STANCE.AGGRESSIVE]: { scan: 1.0, leash: 9000, chase: true, fire: true, standoff: 0.6 },
  [STANCE.NEUTRAL]: { scan: 0.72, leash: 3200, chase: true, fire: true, standoff: 0.78 },
  [STANCE.PASSIVE]: { scan: 0.42, leash: 260, chase: false, fire: true, standoff: 0.95 },
  [STANCE.EVASIVE]: { scan: 0.5, leash: 0, chase: false, fire: false, standoff: 1.6 },
};

export function stanceConfig(stance) {
  return STANCE_CFG[stance] || STANCE_CFG[STANCE.NEUTRAL];
}

/* An attack-move, guard or patrol order is an instruction to go looking for a
   fight along the way, so it widens the acquisition envelope and the leash.
   It deliberately does *not* touch `entity.stance`: the stance is the player's
   setting, and an order that quietly rewrote it would be exactly the class of
   bug that has automatic behaviour outranking an explicit command. An evasive
   ship still refuses the engagement, because the player said so. */
const ORDER_ENGAGE = { scan: 1.0, leash: 4200 };

/* Attack-run phases for strike craft. */
const RUN = { APPROACH: 0, BREAK: 1, REFORM: 2 };

const PROJ_CAP = 8000;
const PT = { KINETIC: 0, MISSILE: 1, FLAK: 2 };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const WORLD_FWD = new THREE.Vector3(0, 0, 1);

/* ------------------------------------------------------------- projectiles */

/* Structure-of-arrays. At a thousand hulls the field carries a few thousand
   rounds in flight; objects would cost more in cache misses than in maths. */
export class ProjectileField {
  constructor(capacity = PROJ_CAP) {
    this.capacity = capacity;
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.dmg = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.team = new Uint8Array(capacity);
    this.shooter = new Int32Array(capacity);
    this.target = new Int32Array(capacity);
    this.turn = new Float32Array(capacity);
    this.burst = new Float32Array(capacity);
    this.count = 0;
  }

  spawn(x, y, z, vx, vy, vz, damage, life, kind, team, shooterId, targetId, turn, burst) {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.dmg[i] = damage;
    this.life[i] = life;
    this.kind[i] = kind;
    this.team[i] = team;
    this.shooter[i] = shooterId;
    this.target[i] = targetId;
    this.turn[i] = turn;
    this.burst[i] = burst;
    return i;
  }

  removeAt(i) {
    const last = --this.count;
    if (i !== last) {
      this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
      this.dmg[i] = this.dmg[last];
      this.life[i] = this.life[last];
      this.kind[i] = this.kind[last];
      this.team[i] = this.team[last];
      this.shooter[i] = this.shooter[last];
      this.target[i] = this.target[last];
      this.turn[i] = this.turn[last];
      this.burst[i] = this.burst[last];
    }
  }

  clear() {
    this.count = 0;
  }
}

/* ------------------------------------------------------------ weapon state */

/** One mutable record per weapon per entity. Called at spawn. */
export function initCombatState(e) {
  const defs = e.def.weapons || [];
  const ws = new Array(defs.length);
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    ws[i] = {
      def: d,
      cooldown: 0,
      targetId: -1,
      muzzle: 0,
      beamLeft: 0,
      beamDps: 0,
      beamTick: 0,
      beamHp: 0,
    };
  }
  e.weapons = ws;
  e.stance = e.stance || STANCE.NEUTRAL;
  e.targetId = -1;
  e.retarget = 0;
  e.runPhase = RUN.APPROACH;
  e.runTimer = 12;
  e.breakDir = new THREE.Vector3(0, 1, 0);
  e.lastHitTick = -99999;
  e.lastAttackerId = -1;
  e.engageRange = maxWeaponRange(e.def);
  // How dangerous this hull is to an unarmed hauler. Read by the economy so a
  // collector runs from an interceptor wing but not from a passing picket.
  e.threatScore = dpsAgainst(e.def, ROLE.RESOURCE);
}

export function maxWeaponRange(def) {
  let r = 0;
  const w = def.weapons || [];
  for (let i = 0; i < w.length; i++) if (w[i].range > r) r = w[i].range;
  return r;
}

/** Expected damage per second this shooter can put on that role. */
export function dpsAgainst(def, role) {
  const w = def.weapons || [];
  let sum = 0;
  for (let i = 0; i < w.length; i++) {
    const k = w[i];
    sum += k.damage * (k.hardpoints || 1) * k.rate * damageAffinity(k.type, role);
  }
  return sum;
}

/* -------------------------------------------------------- target selection */

const ROLE_VALUE = {
  [ROLE.STRUCTURE]: 5.0,
  [ROLE.CAPITAL]: 3.2,
  [ROLE.FRIGATE]: 2.2,
  [ROLE.SUPPORT]: 2.6,
  [ROLE.RESOURCE]: 2.4,
  [ROLE.CORVETTE]: 1.3,
  [ROLE.FIGHTER]: 1.0,
};

let _scanSelf = null;
let _scanWorld = null;
let _scanBest = null;
let _scanBestScore = 0;
let _scanRangeSq = 0;
let _scanWeapon = null;

function scoreCandidate(n) {
  const e = _scanSelf;
  if (!n.alive || n.team === e.team) return;
  const dx = n.position.x - e.position.x;
  const dy = n.position.y - e.position.y;
  const dz = n.position.z - e.position.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > _scanRangeSq) return;

  const w = _scanWeapon;
  let aff;
  if (w) {
    aff = damageAffinity(w.type, n.role);
    // A gun that cannot meaningfully hurt this role should not look at it.
    if (aff < 0.25) return;
    const pref = w.preferredTargets;
    if (pref && pref.length && pref.indexOf(n.role) >= 0) aff *= 2.4;
  } else {
    aff = 1;
  }

  const dist = Math.sqrt(d2) + 1;
  const value = ROLE_VALUE[n.role] || 1;
  // Wounded things finish first; distance is a soft, not hard, discriminator.
  const wounded = 1 + 0.55 * (1 - (n.hull + n.shield) / (n.maxHull + n.maxShield + 1));
  let score = (aff * value * wounded * 1000) / dist;

  // Stickiness: do not thrash between two equally good marks.
  if (n.id === e.targetId) score *= 1.35;
  if (n.id === e.lastAttackerId) score *= 1.25;

  if (score > _scanBestScore) {
    _scanBestScore = score;
    _scanBest = n;
  }
  void _scanWorld;
}

/** Best enemy for `weapon` (or for the hull, if weapon is null) within `range`. */
export function findTarget(world, e, weapon, range) {
  _scanSelf = e;
  _scanWorld = world;
  _scanWeapon = weapon;
  _scanBest = null;
  _scanBestScore = 0;
  _scanRangeSq = range * range;
  world.forEachNear(e.position.x, e.position.y, e.position.z, range, scoreCandidate);
  const best = _scanBest;
  _scanSelf = null;
  _scanBest = null;
  _scanWeapon = null;
  return best;
}

/* ------------------------------------------------------------------ firing */

/** World-space muzzle for hardpoint `index`, into `out`. */
export function muzzleAt(e, index, out) {
  const hp = e.hardpoints;
  if (hp && hp.length) {
    out.copy(hp[index % hp.length]).applyQuaternion(e.quaternion).add(e.position);
  } else {
    out.copy(e.position);
  }
  return out;
}

/** Weapon reach is measured to the target's hull, not to its centre. */
function inWeaponRange(e, weapon, target) {
  const r = weapon.range + target.radius;
  return target.position.distanceToSquared(e.position) <= r * r;
}

function inArc(e, weapon, targetPos) {
  const half = (weapon.arcDeg || 360) * 0.5;
  if (half >= 179) return true;
  _fwd.copy(WORLD_FWD).applyQuaternion(e.quaternion);
  _a.set(targetPos.x - e.position.x, targetPos.y - e.position.y, targetPos.z - e.position.z);
  const len = _a.length();
  if (len < 1e-4) return true;
  _a.multiplyScalar(1 / len);
  return _fwd.dot(_a) >= Math.cos((half * Math.PI) / 180);
}

function kindOf(type) {
  if (type === 'missile') return PT.MISSILE;
  if (type === 'flak') return PT.FLAK;
  return PT.KINETIC;
}

function fireWeapon(world, e, ws, target) {
  const w = ws.def;
  const hp = Math.max(1, w.hardpoints || 1);
  const rng = world.rngCombat;
  const emit = world.fxEvents;

  if (w.type === 'ion' || w.type === 'beam') {
    // Beams lock on and burn. Damage is applied over beamDuration so a target
    // can die mid-cut, which is the whole drama of an ion frigate.
    ws.beamLeft = w.beamDuration || 1.2;
    ws.beamDps = (w.damage * hp) / ws.beamLeft;
    ws.beamTick = 0;
    ws.targetId = target.id;
    ws.beamHp = ws.muzzle;
    if (emit) {
      muzzleAt(e, ws.muzzle, _muzzle);
      // The lance has to land on the hull, not at the centre of it: the FX
      // layer welds this point into the target's frame and splashes there, so
      // a centre-of-mass `to` would bury a two-second beam inside a carrier.
      _aim.subVectors(_muzzle, target.position);
      const l = _aim.length();
      if (l > 1e-4) _aim.multiplyScalar(target.radius / l).add(target.position);
      else _aim.copy(target.position);
      bus.emit('sim:fire', {
        shooter: e,
        target,
        weapon: w,
        from: _muzzle.clone(),
        to: _aim.clone(),
      });
    }
    ws.muzzle++;
    return;
  }

  const speed = w.projectileSpeed || 1500;
  const kind = kindOf(w.type);
  const life = Math.min(9, (w.range / speed) * 1.5 + 0.4);
  const spread = w.spread || 0;
  const burst = kind === PT.FLAK ? 120 + (e.radius || 10) * 0.4 : 0;
  const turn = kind === PT.MISSILE ? 1.5 : 0;

  for (let k = 0; k < hp; k++) {
    muzzleAt(e, ws.muzzle + k, _muzzle);
    predictIntercept(_muzzle, target.position, target.velocity, speed, _aim);
    _a.set(_aim.x - _muzzle.x, _aim.y - _muzzle.y, _aim.z - _muzzle.z);
    const len = _a.length();
    if (len < 1e-3) continue;
    _a.multiplyScalar(1 / len);
    if (spread > 0) {
      _a.x += rng.gaussian(0, spread);
      _a.y += rng.gaussian(0, spread);
      _a.z += rng.gaussian(0, spread);
      _a.normalize();
    }
    world.projectiles.spawn(
      _muzzle.x, _muzzle.y, _muzzle.z,
      _a.x * speed + e.velocity.x * 0.35,
      _a.y * speed + e.velocity.y * 0.35,
      _a.z * speed + e.velocity.z * 0.35,
      w.damage, life, kind, e.team, e.id, target.id, turn, burst,
    );
    if (emit) {
      bus.emit('sim:fire', {
        shooter: e,
        target,
        weapon: w,
        from: _muzzle.clone(),
        to: _aim.clone(),
      });
    }
  }
  ws.muzzle += hp;
}

/* --------------------------------------------------------- damage pipeline */

const _pt = new THREE.Vector3();
const _nrm = new THREE.Vector3();

/**
 * Shield, then armour, then hull. `fromX/Y/Z` is where the hit came from, used
 * to place the impact on the target's surface for the FX layer.
 */
export function applyDamage(world, target, raw, weaponType, shooter, fromX, fromY, fromZ) {
  if (!target.alive || raw <= 0) return 0;
  let amount = raw * damageAffinity(weaponType, target.role);
  if (amount <= 0) return 0;

  const emit = world.fxEvents;
  if (emit) {
    _nrm.set(fromX - target.position.x, fromY - target.position.y, fromZ - target.position.z);
    const l = _nrm.length();
    if (l < 1e-4) _nrm.set(0, 1, 0);
    else _nrm.multiplyScalar(1 / l);
    _pt.copy(target.position).addScaledVector(_nrm, target.radius);
  }

  target.lastHitTick = world.tickCount;
  if (shooter) target.lastAttackerId = shooter.id;

  let dealt = 0;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, amount);
    target.shield -= absorbed;
    amount -= absorbed;
    dealt += absorbed;
    if (emit) {
      bus.emit('sim:damage', {
        entity: target,
        amount: absorbed,
        point: _pt.clone(),
        normal: _nrm.clone(),
        shield: true,
      });
    }
  }

  if (amount > 0) {
    const through = amount * (1 - (target.def.armour || 0));
    target.hull -= through;
    dealt += through;
    if (emit) {
      bus.emit('sim:damage', {
        entity: target,
        amount: through,
        point: _pt.clone(),
        normal: _nrm.clone(),
        shield: false,
      });
    }
    if (target.hull <= 0) world.kill(target, shooter || null);
  }
  return dealt;
}

/* --------------------------------------------------- projectile simulation */

let _burstWorld = null;
let _burstTeam = 0;
let _burstDmg = 0;
let _burstX = 0;
let _burstY = 0;
let _burstZ = 0;
let _burstR = 0;
let _burstShooter = null;

function burstVisitor(n) {
  if (!n.alive || n.team === _burstTeam) return;
  const dx = n.position.x - _burstX;
  const dy = n.position.y - _burstY;
  const dz = n.position.z - _burstZ;
  const reach = _burstR + n.radius;
  if (dx * dx + dy * dy + dz * dz > reach * reach) return;
  applyDamage(_burstWorld, n, _burstDmg, 'flak', _burstShooter, _burstX, _burstY, _burstZ);
}

/** Segment (p -> p+d) against sphere (c, r). Returns t in [0,1] or -1. */
function segmentSphere(px, py, pz, dx, dy, dz, cx, cy, cz, r) {
  const mx = px - cx;
  const my = py - cy;
  const mz = pz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-9) return mx * mx + my * my + mz * mz <= r * r ? 0 : -1;
  const b = 2 * (mx * dx + my * dy + mz * dz);
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

function updateProjectiles(world, dt) {
  const P = world.projectiles;
  const ents = world.entities;
  for (let i = 0; i < P.count; i++) {
    P.life[i] -= dt;
    if (P.life[i] <= 0) {
      P.removeAt(i--);
      continue;
    }

    const tgt = P.target[i] >= 0 ? ents.get(P.target[i]) : null;

    // Guided rounds bend toward the mark; unguided ones cannot correct, which
    // is precisely why a hard-breaking interceptor survives.
    if (P.turn[i] > 0 && tgt && tgt.alive) {
      const sx = P.vx[i];
      const sy = P.vy[i];
      const sz = P.vz[i];
      const sp = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      let dx = tgt.position.x - P.px[i];
      let dy = tgt.position.y - P.py[i];
      let dz = tgt.position.z - P.pz[i];
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const k = Math.min(1, P.turn[i] * dt);
      let nx = sx / sp + (dx - sx / sp) * k;
      let ny = sy / sp + (dy - sy / sp) * k;
      let nz = sz / sp + (dz - sz / sp) * k;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      P.vx[i] = (nx / nl) * sp;
      P.vy[i] = (ny / nl) * sp;
      P.vz[i] = (nz / nl) * sp;
    }

    const dx = P.vx[i] * dt;
    const dy = P.vy[i] * dt;
    const dz = P.vz[i] * dt;

    if (tgt && tgt.alive) {
      const hitR = tgt.radius + (P.burst[i] > 0 ? P.burst[i] * 0.35 : 3);
      const t = segmentSphere(
        P.px[i], P.py[i], P.pz[i], dx, dy, dz,
        tgt.position.x, tgt.position.y, tgt.position.z, hitR,
      );
      if (t >= 0) {
        const hx = P.px[i] + dx * t;
        const hy = P.py[i] + dy * t;
        const hz = P.pz[i] + dz * t;
        if (P.burst[i] > 0) {
          _burstWorld = world;
          _burstTeam = P.team[i];
          _burstDmg = P.dmg[i];
          _burstX = hx; _burstY = hy; _burstZ = hz;
          _burstR = P.burst[i];
          _burstShooter = ents.get(P.shooter[i]) || null;
          world.forEachNear(hx, hy, hz, _burstR + 60, burstVisitor);
          _burstWorld = null;
          _burstShooter = null;
        } else {
          const shooter = ents.get(P.shooter[i]) || null;
          const type = P.kind[i] === PT.MISSILE ? 'missile' : 'kinetic';
          applyDamage(world, tgt, P.dmg[i], type, shooter, hx, hy, hz);
        }
        P.removeAt(i--);
        continue;
      }
    } else if (P.target[i] >= 0) {
      // Mark is gone. Unguided rounds keep flying (and can still be dodged
      // into); guided ones go dumb and expire early.
      P.target[i] = -1;
      if (P.turn[i] > 0) P.life[i] = Math.min(P.life[i], 0.6);
    }

    P.px[i] += dx;
    P.py[i] += dy;
    P.pz[i] += dz;
  }
}

/* ---------------------------------------------------------- ship behaviour */

const _lead = new THREE.Vector3();
const _perp = new THREE.Vector3();

function isStrikeCraft(e) {
  return e.role === ROLE.FIGHTER || e.role === ROLE.CORVETTE;
}

/** Dive, shoot, overshoot, loop back. The signature move of the genre. */
function attackRun(world, e, target, dt) {
  const cfg = stanceConfig(e.stance);
  // Range is to the hull, not the centre. A bomber with 1.5 km of reach has to
  // be able to hit a 1.9 km mothership; measuring centre-to-centre made it
  // break off before it could ever fire, which is what the soak run showed.
  const reach = e.engageRange + target.radius;
  _a.set(
    target.position.x - e.position.x,
    target.position.y - e.position.y,
    target.position.z - e.position.z,
  );
  const dist = _a.length();
  const breakAt = target.radius + e.radius + 150;
  const reformAt = breakAt + reach * 0.8 + 420;

  e.runTimer -= dt;

  switch (e.runPhase) {
    case RUN.BREAK: {
      if (e.runTimer <= 0 || dist > reformAt) {
        e.runPhase = RUN.REFORM;
        e.runTimer = 6;
      }
      _b.copy(e.position).addScaledVector(e.breakDir, 4000);
      setNavSeek(e, _b, 1);
      setFacePoint(e, null);
      return;
    }
    case RUN.REFORM: {
      // Come about; when the nose is roughly on the mark, dive again.
      _fwd.copy(WORLD_FWD).applyQuaternion(e.quaternion);
      const aligned = dist > 1e-3 ? _fwd.dot(_a) / dist : 1;
      if (aligned > 0.72 || e.runTimer <= 0) {
        e.runPhase = RUN.APPROACH;
        e.runTimer = 14;
      }
      predictIntercept(e.position, target.position, target.velocity, e.maxSpeed, _lead);
      setNavSeek(e, _lead, 1);
      setFacePoint(e, _lead);
      return;
    }
    default: {
      /* A run ends by breaking off the mark. A timer that expires while the
         target is still kilometres away is a transit, not an attack run — so
         it is refreshed rather than triggering a break in open space. */
      const closed = dist < breakAt;
      const spent = e.runTimer <= 0;
      if (spent && dist > reformAt) e.runTimer = 14;
      if (closed || (spent && dist <= reformAt)) {
        // Break out along a vector that keeps the overshoot legible: mostly
        // perpendicular to the run-in, seeded off the entity so a whole wing
        // fans instead of stacking.
        _perp.set(
          Math.sin(e.id * 1.7) * 0.9,
          Math.cos(e.id * 2.3) * 0.7 + 0.35,
          Math.sin(e.id * 0.9 + 1.1) * 0.9,
        );
        _b.copy(_a).normalize();
        _perp.addScaledVector(_b, -_perp.dot(_b));
        if (_perp.lengthSq() < 1e-4) _perp.set(0, 1, 0);
        _perp.normalize();
        e.breakDir.copy(_b).multiplyScalar(0.45).addScaledVector(_perp, 1).normalize();
        e.runPhase = RUN.BREAK;
        e.runTimer = 1.6 + (e.id % 7) * 0.12;
        return;
      }
      // Run in hot: full throttle at a lead point, guns on the predicted mark.
      predictIntercept(e.position, target.position, target.velocity, e.maxSpeed * 1.35, _lead);
      setNavSeek(e, _lead, 1);
      setFacePoint(e, _lead);
      void cfg;
      return;
    }
  }
}

/** Line ships hold a firing station and keep the broadside pointed in. */
function standOff(world, e, target) {
  const cfg = stanceConfig(e.stance);
  const reach = e.engageRange + target.radius;
  // Ion-class weapons have a narrow arc; those ships must face dead-on.
  let narrow = false;
  const ws = e.weapons;
  for (let i = 0; i < ws.length; i++) {
    if ((ws[i].def.arcDeg || 360) < 60) narrow = true;
  }

  _a.set(
    e.position.x - target.position.x,
    e.position.y - target.position.y,
    e.position.z - target.position.z,
  );
  const dist = _a.length();
  const want = Math.max(target.radius + e.radius + 250, reach * cfg.standoff);
  if (dist > 1e-3) _a.multiplyScalar(1 / dist);
  else _a.set(0, 0, 1);

  _b.copy(target.position).addScaledVector(_a, want);
  setNavArrive(e, _b, dist > want * 1.4 ? 1 : 0.7, e.radius * 0.5 + 60);
  setFacePoint(e, narrow || dist < reach ? target.position : null);
}

/** Alive friendly producer within docking distance, or null. */
function nearestOwnYard(world, e) {
  const t = world.teams[e.team];
  for (const id of t.producers) {
    const p = world.entities.get(id);
    if (!p || !p.alive) continue;
    const reach = p.radius + e.radius + 1400;
    if (p.position.distanceToSquared(e.position) <= reach * reach) return p;
  }
  return null;
}

/* Support frigates. They carry no gun worth the name; their job is to keep
   the line alive between engagements, which is also what makes them a
   priority target worth escorting. */

let _repSelf = null;
let _repBest = null;
let _repScore = 0;

function repairVisitor(n) {
  const e = _repSelf;
  if (!n.alive || n.team !== e.team || n === e) return;
  if (n.role === ROLE.STRUCTURE) return;
  const missing = 1 - n.hull / n.maxHull;
  if (missing < 0.02) return;
  const range = e.def.repairRange || 1800;
  if (n.position.distanceToSquared(e.position) > range * range) return;
  // Fix the expensive thing first.
  const score = missing * (n.def.cost + 200);
  if (score > _repScore) {
    _repScore = score;
    _repBest = n;
  }
}

function supportBehaviour(world, e, dt) {
  _repSelf = e;
  _repBest = null;
  _repScore = 0;
  const range = e.def.repairRange || 1800;
  world.forEachNear(e.position.x, e.position.y, e.position.z, range, repairVisitor);
  const patient = _repBest;
  _repSelf = null;
  _repBest = null;

  if (patient) {
    patient.hull = Math.min(patient.maxHull, patient.hull + (e.def.repairRate || 60) * dt);
    e.repairTargetId = patient.id;
  } else {
    e.repairTargetId = -1;
  }

  if (e.combatHelm === false) return;
  // Shadow the wounded, or the most valuable friendly hull nearby.
  const anchor = patient || nearestValuableFriend(world, e);
  if (anchor) {
    _a.subVectors(e.position, anchor.position);
    if (_a.lengthSq() < 1e-4) _a.set(0, 1, 0);
    _a.normalize().multiplyScalar(anchor.radius + e.radius + 320).add(anchor.position);
    setNavArrive(e, _a, 1, e.radius + 60);
    setFacePoint(e, null);
  } else {
    setNavHold(e);
  }
}

let _friendSelf = null;
let _friendBest = null;
let _friendScore = 0;

function friendVisitor(n) {
  const e = _friendSelf;
  if (!n.alive || n.team !== e.team || n === e) return;
  if (n.role !== ROLE.CAPITAL && n.role !== ROLE.FRIGATE) return;
  const d = Math.sqrt(n.position.distanceToSquared(e.position)) + 400;
  const score = n.def.cost / d;
  if (score > _friendScore) {
    _friendScore = score;
    _friendBest = n;
  }
}

function nearestValuableFriend(world, e) {
  _friendSelf = e;
  _friendBest = null;
  _friendScore = 0;
  world.forEachNear(e.position.x, e.position.y, e.position.z, 6000, friendVisitor);
  const out = _friendBest;
  _friendSelf = null;
  _friendBest = null;
  return out;
}

/** Evasive: put distance between us and the nearest threat, do not trade. */
function evade(world, e, threat) {
  if (!threat) {
    setNavHold(e);
    setFacePoint(e, null);
    return;
  }
  _a.set(
    e.position.x - threat.position.x,
    e.position.y - threat.position.y,
    e.position.z - threat.position.z,
  );
  if (_a.lengthSq() < 1e-4) _a.set(0, 1, 0);
  _a.normalize();
  _b.copy(e.position).addScaledVector(_a, 5000);
  setNavSeek(e, _b, 1);
  setFacePoint(e, null);
}

/* ------------------------------------------------------------------ update */

const RETARGET_PERIOD = 0.55;

export function updateCombat(world, dt) {
  const list = world.dense;
  const tick = world.tickCount;

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;

    // --- shields regenerate out of contact ---
    if (e.maxShield > 0 && e.shield < e.maxShield && tick - e.lastHitTick > 180) {
      e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.05 * dt);
    }

    // --- hull repair alongside a friendly yard ---
    // Without this a mauled destroyer that limps home is simply gone from the
    // game, both fleets bleed out, and the match cannot resolve.
    if (e.hull < e.maxHull && e.role !== ROLE.STRUCTURE && tick - e.lastHitTick > 120 &&
        (tick + e.id) % 10 === 0) {
      const yard = nearestOwnYard(world, e);
      if (yard) e.hull = Math.min(e.maxHull, e.hull + e.maxHull * 0.014 * dt * 10);
    }

    const ws = e.weapons;
    if (!ws || ws.length === 0) continue;
    const cfg = stanceConfig(e.stance);
    // Attack-move, guard and patrol widen the envelope; the stance still has
    // the final say on whether this ship fights at all.
    const seeking = e.orderEngage === true && cfg.fire;
    const scanScale = seeking && ORDER_ENGAGE.scan > cfg.scan ? ORDER_ENGAGE.scan : cfg.scan;
    const leash = seeking && ORDER_ENGAGE.leash > cfg.leash ? ORDER_ENGAGE.leash : cfg.leash;

    // --- hull-level target, refreshed on a stagger ---
    e.retarget -= dt;
    if (e.retarget <= 0) {
      e.retarget = RETARGET_PERIOD + ((e.id % 13) / 13) * 0.5;
      const scan = Math.max(e.engageRange, (e.def.sensorRange || 4000) * scanScale);
      const forced = e.forcedTargetId >= 0 ? world.entities.get(e.forcedTargetId) : null;
      if (forced && forced.alive && forced.team !== e.team) {
        e.targetId = forced.id;
        /* An order to attack is an order to be in that fight, not an order to
           fly an ion lance at a fighter. When the main gun cannot meaningfully
           hurt the mark, the helm follows something it can — and picks the
           original mark back up the moment the screen is clear. */
        if (damageAffinity(ws[0].def.type, forced.role) < 0.25) {
          const alt = findTarget(world, e, ws[0].def, scan);
          if (alt) e.targetId = alt.id;
        }
      } else {
        e.forcedTargetId = -1;
        const t = cfg.fire ? findTarget(world, e, ws[0].def, scan) : null;
        e.targetId = t ? t.id : -1;
      }
    }

    const target = e.targetId >= 0 ? world.entities.get(e.targetId) : null;
    if (target && !target.alive) e.targetId = -1;

    // --- per-weapon fire control ---
    for (let k = 0; k < ws.length; k++) {
      const w = ws[k];
      const def = w.def;

      // Beam continuation.
      if (w.beamLeft > 0) {
        const bt = w.targetId >= 0 ? world.entities.get(w.targetId) : null;
        if (!bt || !bt.alive ||
            bt.position.distanceTo(e.position) > (def.range + bt.radius) * 1.15) {
          w.beamLeft = 0;
        } else {
          w.beamLeft -= dt;
          w.beamTick += dt;
          // Batch the damage at ~10 Hz so the FX bus is not flooded. The
          // origin is the live muzzle, not the hull centre, so the splash sits
          // where the beam actually meets the plating as both ships manoeuvre.
          if (w.beamTick >= 0.1 || w.beamLeft <= 0) {
            muzzleAt(e, w.beamHp, _muzzle);
            applyDamage(
              world, bt, w.beamDps * w.beamTick, def.type, e,
              _muzzle.x, _muzzle.y, _muzzle.z,
            );
            w.beamTick = 0;
          }
          continue;
        }
      }

      w.cooldown -= dt;
      if (!cfg.fire || w.cooldown > 0) continue;

      // Weapons pick their own mark: a flak battery must not chase the
      // capital its main gun is chewing on.
      let wt = w.targetId >= 0 ? world.entities.get(w.targetId) : null;
      const needNew = !wt || !wt.alive || wt.team === e.team || !inWeaponRange(e, def, wt);
      if (needNew) {
        if (target && target.alive && damageAffinity(def.type, target.role) >= 0.25 &&
            inWeaponRange(e, def, target)) {
          wt = target;
        } else {
          wt = findTarget(world, e, def, def.range + world.maxTargetRadius);
          if (wt && !inWeaponRange(e, def, wt)) wt = null;
        }
        w.targetId = wt ? wt.id : -1;
      }
      if (!wt) continue;

      if (!inArc(e, def, wt.position)) continue;
      fireWeapon(world, e, w, wt);
      w.cooldown = 1 / Math.max(0.02, def.rate);
    }

    // --- manoeuvre ---
    // Bases and yards fire but never chase; a mothership that wandered off to
    // duel an interceptor would be a losing proposition for everyone.
    if (e.role === ROLE.STRUCTURE) {
      e.engaged = !!target;
      continue;
    }

    if (e.def.repairRate) {
      supportBehaviour(world, e, dt);
      e.engaged = !!target;
      continue;
    }

    if (e.combatHelm === false) {
      e.engaged = !!target;
      continue;
    }

    if (e.stance === STANCE.EVASIVE) {
      const threat = findTarget(world, e, null, e.def.sensorRange * 0.5);
      evade(world, e, threat);
      e.engaged = false;
      continue;
    }

    if (!target) {
      e.engaged = false;
      continue;
    }

    // Leash: a passive/neutral ship will not follow a mark off the map.
    if (e.station) {
      const away = e.position.distanceTo(e.station);
      if (away > leash + e.engageRange) {
        setNavArrive(e, e.station, 1, e.radius + 80);
        setFacePoint(e, null);
        e.engaged = false;
        continue;
      }
    }

    e.engaged = true;
    if (isStrikeCraft(e)) attackRun(world, e, target, dt);
    else standOff(world, e, target);
  }

  updateProjectiles(world, dt);
}

export { RUN, PT };
