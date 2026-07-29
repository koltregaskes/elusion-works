import * as THREE from '../../vendor/three/build/three.module.js';
import { SHIPS, TEAM, approxRadius } from '../ships/catalog.js';

/* Skirmish setup.

   Two motherships, far enough apart that neither can see the other at the
   opening bell, and a resource field that is provably fair: every seam placed
   for one side is mirrored through the origin for the other, with a band of
   contested rock straddling the midline to fight over. */

/* Field size is a balance decision, not a cosmetic one: a fleet big enough to
   crack a mothership costs roughly 25k, so each side must be able to pull
   somewhere north of 80k over a match or the game cannot be won by anybody. */
const DEFAULT_SETUP = {
  separation: 22000, // metres between the two motherships
  clustersPerSide: 4,
  contestedClusters: 4,
  clusterAmount: 21000,
  homeAmount: 24000,
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const WORLD_FWD = new THREE.Vector3(0, 0, 1);

/** Home position for a team, in the +X / -X halves of the volume. */
export function homePosition(team, separation, out) {
  const s = team === TEAM.PLAYER ? -1 : 1;
  return out.set(s * separation * 0.5, s * 900, s * separation * 0.12);
}

/* ------------------------------------------------------- start clearance */

/* The opening frame is the whole first impression, and a scalar keep-out
   radius is the wrong unit to protect it with. Two kilometres of clearance is
   generous for a 300 m boulder and meaningless for a six-kilometre landmark,
   which at the same range still fills half the view. What matters is how much
   of the frame a body occupies from the start, so the rule is angular.

   `OPENING_ANGLE` is the most of the sky an *opaque* body may take up as seen
   from a mothership. It is deliberately not applied to ore seams: a resource
   cluster is a porous swarm of small rocks you fly through and see past, and
   its silhouette is the size of one rock, not of the cluster. ENV should pass
   the radius of the thing that actually blocks the view.

   ENV owns rock and landmark placement; this is the shared rule both sides
   test against, exactly as `homePosition` already is. */
export const OPENING_ANGLE = 0.52; // radians, ~30 degrees

/* An ore seam is not a wall. You fly into it, mine inside it and see straight
   through the gaps, so it is held to a looser angle than an opaque landmark —
   close ore is exactly what a good opening wants. It is not unlimited, though:
   past about a third of the field of view a seam stops reading as "ore over
   there" and starts reading as scenery in the way. */
export const SEAM_ANGLE = 0.62; // radians, ~35.5 degrees

/** Hard floor: nothing may physically intersect the mothership, ever. */
const HARD_GAP = 600;

const MOTHERSHIP_R = approxRadius('mothership');

/** Angle a sphere of `radius` subtends at `distance`, in radians. */
export function subtendedAngle(radius, distance) {
  if (!(distance > 0)) return Math.PI;
  const s = radius / distance;
  return s >= 1 ? Math.PI : 2 * Math.asin(s);
}

/** Closest a body of `radius` may come to a start before it owns the frame. */
export function minRangeFor(radius, limit = OPENING_ANGLE) {
  const angular = radius / Math.sin(Math.max(0.02, limit) * 0.5);
  const solid = MOTHERSHIP_R + radius + HARD_GAP;
  return angular > solid ? angular : solid;
}

const _home = new THREE.Vector3();

/**
 * Metres by which a body of `radius` at `point` is too close to the nearest
 * start, or 0 when it is clear. Checks both starts — the field is mirrored, so
 * a body that is fine for one side must be fine for the other.
 */
export function startEncroachment(point, radius, separation = DEFAULT_SETUP.separation, limit = OPENING_ANGLE) {
  const need = minRangeFor(radius, limit);
  let worst = 0;
  for (let t = 0; t < 2; t++) {
    homePosition(t, separation, _home);
    const short = need - _home.distanceTo(point);
    if (short > worst) worst = short;
  }
  return worst;
}

export function clearOfStarts(point, radius, separation, limit) {
  return startEncroachment(point, radius, separation, limit) <= 0;
}

/**
 * Push `point` radially away from whichever start it crowds, in place.
 * Deterministic, and mirror-safe: the mirrored twin of a nudged point is the
 * nudge of the mirrored point, so a symmetric field stays symmetric.
 */
export function nudgeClearOfStarts(point, radius, separation = DEFAULT_SETUP.separation, limit = OPENING_ANGLE) {
  const need = minRangeFor(radius, limit);
  for (let pass = 0; pass < 2; pass++) {
    let worstT = -1;
    let worstShort = 0;
    for (let t = 0; t < 2; t++) {
      homePosition(t, separation, _home);
      const short = need - _home.distanceTo(point);
      if (short > worstShort) {
        worstShort = short;
        worstT = t;
      }
    }
    if (worstT < 0) return point;
    homePosition(worstT, separation, _home);
    _v.subVectors(point, _home);
    // Dead on the start: pick a stable outward direction rather than NaN.
    if (_v.lengthSq() < 1) _v.set(worstT === 0 ? -1 : 1, 0.15, 0).normalize();
    else _v.normalize();
    point.copy(_home).addScaledVector(_v, need);
  }
  return point;
}

/**
 * Fair asteroid field. Seams are generated for the player half and mirrored,
 * so the two economies start identical whatever the seed does.
 */
export function generateResourceClusters(rng, opts = {}) {
  const cfg = Object.assign({}, DEFAULT_SETUP, opts);
  const out = [];
  const home = new THREE.Vector3();
  homePosition(TEAM.PLAYER, cfg.separation, home);

  const push = (x, y, z, radius, amount) => {
    // Keep the seam off the motherships, then mirror the *corrected* point so
    // both sides get an identical opening whatever the nudge did.
    _v2.set(x, y, z);
    nudgeClearOfStarts(_v2, radius, cfg.separation, SEAM_ANGLE);
    out.push(makeCluster(out.length, _v2.x, _v2.y, _v2.z, radius, amount));
    out.push(makeCluster(out.length, -_v2.x, -_v2.y, -_v2.z, radius, amount));
  };

  // Two rich seams close to each home, so the opening is never a dice roll.
  for (let i = 0; i < 2; i++) {
    const a = (i / 2) * Math.PI * 2 + rng.range(0, Math.PI);
    const d = rng.range(3600, 5200);
    push(
      home.x + Math.cos(a) * d,
      home.y + rng.range(-900, 900),
      home.z + Math.sin(a) * d,
      rng.range(900, 1400),
      cfg.homeAmount,
    );
  }

  // Expansion seams further out — worth a carrier to hold.
  for (let i = 2; i < cfg.clustersPerSide; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(8000, 12500);
    push(
      home.x * 0.55 + Math.cos(a) * d,
      rng.range(-2600, 2600),
      home.z * 0.55 + Math.sin(a) * d,
      rng.range(1100, 1800),
      cfg.clusterAmount,
    );
  }

  // Contested band on the midline: symmetric by construction.
  for (let i = 0; i < cfg.contestedClusters; i++) {
    const a = (i / cfg.contestedClusters) * Math.PI * 2;
    const d = rng.range(2500, 7000);
    out.push(makeCluster(
      out.length,
      Math.cos(a) * d * 0.35,
      Math.sin(a) * d * 0.55,
      Math.sin(a * 1.7) * d,
      rng.range(1300, 2000),
      cfg.clusterAmount * 1.4,
    ));
  }

  return out;
}

function makeCluster(id, x, y, z, radius, amount) {
  return {
    id,
    position: new THREE.Vector3(x, y, z),
    radius,
    amount,
    maxAmount: amount,
    miners: [0, 0],
    threat: [0, 0],
  };
}

/**
 * Pull seams from the Environment if it exposes any; otherwise make our own.
 *
 * ENV's records are adopted *in place* rather than copied. ENV fades and culls
 * its rocks from `amount`, so a copy would leave a mined-out seam looking
 * untouched for the whole match while the sim quietly emptied a different
 * object. The returned array is new — only the records inside it are shared —
 * so `World.dispose()` clearing it cannot reach into ENV's field.
 */
export function resolveResourceClusters(world, rng, opts) {
  const cfg = Object.assign({}, DEFAULT_SETUP, opts);
  const env = world.environment;
  let raw = null;
  try {
    if (env && env.resourceClusters) raw = env.resourceClusters;
  } catch (err) {
    raw = null; // ENV module not finished — our own field is authoritative.
  }
  if (!raw || !raw.length) return generateResourceClusters(rng, opts);

  const out = [];
  const violations = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!c || !c.position) continue;
    c.id = out.length;
    if (!(c.amount > 0)) c.amount = cfg.clusterAmount;
    if (!(c.maxAmount > 0)) c.maxAmount = c.amount;
    if (!(c.radius > 0)) c.radius = 1200;
    c.miners = [0, 0];
    c.threat = [0, 0];
    const over = startEncroachment(c.position, c.radius, cfg.separation, SEAM_ANGLE);
    if (over > 0) {
      violations.push({ kind: 'cluster', index: i, radius: Math.round(c.radius), over: Math.round(over) });
    }
    out.push(c);
  }
  // Placement is ENV's to fix — the rocks are already built by the time we see
  // them, so moving the seam here would only desync ore from art. Record it so
  // a harness can assert on it instead of it going out unnoticed.
  world.fieldViolations = violations;
  return out;
}

/* --------------------------------------------------------- starting fleet */

const OPENING = [
  { classId: 'collector', wings: 4, ring: 1 },
  { classId: 'interceptor', wings: 1, ring: 2 },
  { classId: 'scout', wings: 1, ring: 2 },
  { classId: 'corvette', wings: 1, ring: 3 },
];

/** Place one team's mothership and its opening fleet. */
export function seedTeam(world, team, cfg, rng) {
  const base = homePosition(team, cfg.separation, new THREE.Vector3());

  // Motherships face each other across the volume.
  _v.copy(base).multiplyScalar(-1).normalize();
  const m = new THREE.Matrix4().lookAt(_v, ZERO, WORLD_UP);
  _q.setFromRotationMatrix(m);

  const ms = world.spawn('mothership', team, base, _q);
  if (!ms) return null;
  ms.station = base.clone();

  const forward = new THREE.Vector3().copy(WORLD_FWD).applyQuaternion(_q);
  const side = new THREE.Vector3().copy(WORLD_UP).cross(forward).normalize();

  for (let g = 0; g < OPENING.length; g++) {
    const spec = OPENING[g];
    const def = SHIPS[spec.classId];
    const squad = Math.max(1, def.squadSize || 1);
    const total = squad * spec.wings;
    const spread = def.length * 3.2 + 220;
    for (let i = 0; i < total; i++) {
      const lane = (i - (total - 1) / 2) * spread;
      _v.copy(base)
        .addScaledVector(forward, ms.radius + 700 + spec.ring * 900)
        .addScaledVector(side, lane)
        .addScaledVector(WORLD_UP, ((i % 3) - 1) * spread * 0.55 + spec.ring * 160);
      const e = world.spawn(spec.classId, team, _v, _q);
      if (!e) continue;
      e.station = _v.clone();
      e.velocity.copy(forward).multiplyScalar(rng.range(0, 8));
    }
  }

  return ms;
}

const ZERO = new THREE.Vector3(0, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Full skirmish setup from a seed: field, both motherships, both opening
 * fleets. Deterministic for a given seed.
 */
export function setupSkirmish(world, opts = {}) {
  const cfg = Object.assign({}, DEFAULT_SETUP, opts);
  const rng = world.rng.fork(0x5EED);

  world.resourceClusters = resolveResourceClusters(world, rng.fork(2), cfg);
  world.separation = cfg.separation;

  for (let t = 0; t < 2; t++) {
    const base = seedTeam(world, t, cfg, rng.fork(11 + t));
    world.teams[t].baseId = base ? base.id : -1;
    world.teams[t].homePosition = homePosition(t, cfg.separation, new THREE.Vector3());
  }

  world.recomputePopulation();
  return world;
}

export { DEFAULT_SETUP };
