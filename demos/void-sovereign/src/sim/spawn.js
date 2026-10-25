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
/* The field is deliberately smaller than a match consumes comfortably. Two
   sides pull somewhere north of 80k each over a long game against a field of
   about 226k, of which the contested band holds 40% — so the home seams thin
   out first and the last act is forced onto the middle, which is the only
   place left with ore in it. That is the third act: it is geography doing the
   work, not a script and not a timer.

   At the old 298k nothing ever ran out. A 60-minute match ended with 140k
   still in the ground and both sides sitting on 30k of unspendable credits,
   and an economy nobody can exhaust is an economy with no decisions in it. */
const DEFAULT_SETUP = {
  separation: 22000, // metres between the two motherships
  clustersPerSide: 4,
  contestedClusters: 4,
  clusterAmount: 16000,
  homeAmount: 18000,
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

/* The angular rule protects the frame as seen from the *mothership*, which is
   not quite where the camera is: the rig opens about 4 km out, so a body that
   comfortably clears the hull can still sit a couple of hundred metres from the
   lens and fill 60 degrees of the opening shot — measured at exactly that on
   one seed. Carving a thin shell out of the field at the opening orbit radius
   costs a handful of rocks and nothing else.

   This lived in `render/environment.js` while ENV placed the seams itself. ENV
   no longer does, so the rule moved to the file that owns placement, and ENV
   imports it for the landmarks and derelicts it still places on its own. */
export const OPENING_SHELL = 4000;
export const SHELL_GAP = 900;

/** Hard floor: nothing may physically intersect the mothership, ever. */
const HARD_GAP = 600;

/* How even a seam's two home distances must be to count as no-man's land.

   Strict on purpose. The midline ring is exactly equidistant by construction —
   ratio 1.000 on all twelve seeds in `.local/laneD-field.mjs`, bias 1.6e-16
   over 400 — and the home seams sit at 0.20–0.51, so the band is never a dice
   roll and never a coin toss.

   One caveat, measured rather than intended: an expansion seam can wander over
   the midline on its own and qualify too, so the band is 4 seams on three
   seeds in four, 6 on nearly all the rest, 8 on about one in eighty. Total
   control runs the same clock either way — `world.js` normalises by share, not
   by count — but a *partial* margin scores differently, two seams up out of
   six draining slower than two up out of four, which is exactly the
   seed-dependence this threshold was written to prevent. See `contestedBias`
   for the measurement and the fix. Raising this number until the symptom goes
   away is not the fix. */
const CONTESTED_RATIO = 0.82;

/** Largest home-distance imbalance a contested seam may carry and still be fair. */
export const SEAM_BIAS_LIMIT = 0.08;

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

const _shell = new THREE.Vector3();

/**
 * Put `point` where it cannot own the opening frame: outside the angular
 * clearance from both starts, and off the sphere the camera rig opens on.
 * Mutates and returns `point`.
 *
 * The nudge is looped rather than called once because moving a body away from
 * one start can bring it toward the other, and `nudgeClearOfStarts` takes a
 * bounded number of passes by design. Looping to a fixed point here is cheap
 * and means the field never ships a violation for the sake of one iteration.
 *
 * Mirror-safe, like the nudge it wraps: the correction is radial about a start,
 * and the two starts are reflections of each other through the origin, so the
 * corrected twin of a point is the correction of its twin. Call it *before*
 * mirroring and a symmetric field stays symmetric.
 */
export function clearOpening(point, radius, separation = DEFAULT_SETUP.separation, limit = OPENING_ANGLE) {
  for (let i = 0; i < 8 && !clearOfStarts(point, radius, separation, limit); i++) {
    nudgeClearOfStarts(point, radius, separation, limit);
  }
  const gap = radius + SHELL_GAP;
  for (let t = 0; t < 2; t++) {
    homePosition(t, separation, _shell);
    const d = point.distanceTo(_shell);
    if (Math.abs(d - OPENING_SHELL) >= gap) continue;
    // Always outward: inward is toward the mothership.
    const want = OPENING_SHELL + gap;
    if (d < 1) point.set(_shell.x + want, _shell.y, _shell.z);
    else point.sub(_shell).multiplyScalar(want / d).add(_shell);
  }
  return point;
}

/**
 * Fair asteroid field. Seams are generated for the player half and mirrored,
 * so the two economies start identical whatever the seed does.
 *
 * This is the *only* definition of the field. `render/environment.js` calls it
 * and builds its rocks around what comes back, rather than laying out a second
 * field of its own — see the note on `resolveResourceClusters`.
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
    clearOpening(_v2, radius, cfg.separation, SEAM_ANGLE);
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

  /* Contested band.

     This used to be a ring drawn in *world* axes and the comment above it said
     "symmetric by construction". It was not. The two starts do not lie on a
     world axis, so the ring sat lopsided across the midline: on one measured
     seed three of the four midline seams were nearer team 1 and one was nearer
     team 0. That is a quiet, permanent advantage to one side, and once holding
     the band ran a clock it stopped being cosmetic — team 1 won all five
     mirror matches, every one of them on sovereignty.

     The band is now a ring in the plane that perpendicularly bisects the two
     starts, so every seam on it is exactly equidistant from both homes by
     construction rather than by hope. */
  const homeB = new THREE.Vector3();
  homePosition(TEAM.ENEMY, cfg.separation, homeB);
  const axis = new THREE.Vector3().subVectors(homeB, home).normalize();
  const u = new THREE.Vector3(0, 1, 0);
  if (Math.abs(axis.dot(u)) > 0.9) u.set(1, 0, 0);
  u.crossVectors(axis, u).normalize();
  const w = new THREE.Vector3().crossVectors(axis, u).normalize();

  for (let i = 0; i < cfg.contestedClusters; i++) {
    const a = (i / cfg.contestedClusters) * Math.PI * 2 + rng.range(0, 0.7);
    const d = rng.range(3400, 8200);
    const radius = rng.range(1300, 2000);
    _v2.copy(u).multiplyScalar(Math.cos(a) * d).addScaledVector(w, Math.sin(a) * d * 0.72);
    /* A no-op at these ranges — the nearest point of the bisector plane is
       11.3 km from either start and the opening shell is 4 km — but the
       clearance rule is absolute, and it must stay a no-op: a correction here
       would be radial about one start and would therefore be the one thing
       that could take equidistance away from a band that has it by
       construction. `contestedBias` is the assertion that it never does. */
    clearOpening(_v2, radius, cfg.separation, SEAM_ANGLE);
    out.push(makeCluster(
      out.length, _v2.x, _v2.y, _v2.z, radius, cfg.clusterAmount * 1.4,
    ));
  }

  return out;
}

/**
 * How lopsided a contested seam is: 0 when both starts are exactly as far
 * away, 1 when it sits on top of one of them. Any midline seam above about
 * 0.08 is a standing advantage to one side, because holding the band runs the
 * sovereignty clock.
 */
export function seamBias(point, separation = DEFAULT_SETUP.separation) {
  const a = homePosition(0, separation, new THREE.Vector3());
  const b = homePosition(1, separation, new THREE.Vector3());
  const dA = point.distanceTo(a);
  const dB = point.distanceTo(b);
  const sum = dA + dB;
  return sum > 1 ? Math.abs(dA - dB) / sum : 0;
}

/**
 * Flag the seams that belong to neither side.
 *
 * A cluster is contested when it is roughly equidistant from both starts. That
 * is a geometric test rather than a flag set at generation time on purpose: a
 * seam that only one side can reach first is that side's, whoever placed it and
 * whatever they meant by it. It is the ground the match is fought over —
 * `sim/economy.js` turns standing on it into income, and `sim/world.js` turns
 * holding it into a clock.
 *
 * Note what it is *not* asking. Not "is the field symmetric" — ENV's was, and
 * still had no contested band, because it mirrored each seam through the origin
 * and the origin swaps the two starts. Symmetry makes a pair fair; only
 * equidistance makes a single seam neutral.
 */
export function markContested(clusters, separation = DEFAULT_SETUP.separation) {
  const a = homePosition(0, separation, new THREE.Vector3());
  const b = homePosition(1, separation, new THREE.Vector3());
  let n = 0;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (!c || !c.position) continue;
    /* Scale-free: neither side is meaningfully closer. A raw distance band
       would depend on the separation and on how far out the seam sits, and
       would classify a distant expansion seam as midline just for being far
       from everything. Measured across twelve seeds in the running game this
       separates the midline ring (1.000) from the home seams (0.20–0.51). */
    const dA = c.position.distanceTo(a);
    const dB = c.position.distanceTo(b);
    const contested = Math.min(dA, dB) / Math.max(1, Math.max(dA, dB)) > CONTESTED_RATIO;
    c.contested = contested;
    c.control = 0;
    c.owner = -1;
    c.presence = [0, 0];
    if (contested) n++;
  }
  return n;
}

/**
 * Contested seams that are meaningfully nearer one start than the other.
 *
 * Recorded rather than corrected — the same contract `startEncroachment` uses.
 * A harness can assert on `world.seamBiasViolations`.
 *
 * The bisector ring never appears here: measured over 400 seeds its worst bias
 * is 1.6e-16, which is zero in doubles. What does appear, on about one seed in
 * nine, is an *expansion* seam. It is placed on a circle of up to 12.5 km about
 * a point 6.2 km from the origin, so it can cross the midline on its own and
 * clear `CONTESTED_RATIO` without being neutral — 44 such seams over 400 seeds,
 * worst bias 0.097 against a 0.08 limit.
 *
 * The match stays fair, because those seams are mirrored: the twin that favours
 * one side by 0.097 is matched by one favouring the other by exactly as much.
 * But an individual seam in the band is not always neutral, which is what this
 * limit was written to mean. The fix is to keep the expansion ring on its own
 * side rather than to relax the limit: pushing a candidate along the home axis
 * until `p·ĥ ≤ -P(1-R²) / (2|ĥ|(1+R²))`, before mirroring, costs six lines and
 * makes the band exactly the designed four seams on every seed. It is left
 * undone here only because it moves the ore split and therefore the pacing,
 * which is not this change's to move quietly.
 */
export function contestedBias(clusters, separation = DEFAULT_SETUP.separation) {
  const out = [];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (!c || !c.contested) continue;
    const bias = seamBias(c.position, separation);
    if (bias > SEAM_BIAS_LIMIT) {
      out.push({ index: i, bias: Math.round(bias * 1000) / 1000 });
    }
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
 *
 * ENV's field is `generateResourceClusters`' output with rocks built around it,
 * so this branch is now an adoption rather than a handover. It did not used to
 * be, and the difference cost the game its second victory condition: ENV laid
 * out its own field, mirrored every seam through the origin, and called that
 * "symmetric by construction". It is — as a *pair*. Mirroring through the
 * origin swaps the two starts, so a seam and its twin have swapped home
 * distances and therefore the identical `markContested` ratio; the pair
 * straddles the midline while neither member is anywhere near equidistant.
 * Measured over eight seeds the most even pair on each reached 0.691, 0.753,
 * 0.884, 0.870, 0.796, 0.782, 0.888 and 0.816 against a 0.82 threshold — three
 * clear it, and on the other five the sovereignty clock could not start and one
 * of the three win conditions did not exist.
 *
 * Only a seam that is *individually* equidistant is no-man's-land, and that is
 * a ring in the plane perpendicularly bisecting the two starts. One generator
 * builds it; a second copy of the rule is what drifted.
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
  world.contestedSeams = markContested(world.resourceClusters, cfg.separation);
  world.seamBiasViolations = contestedBias(world.resourceClusters, cfg.separation);

  for (let t = 0; t < 2; t++) {
    const base = seedTeam(world, t, cfg, rng.fork(11 + t));
    world.teams[t].baseId = base ? base.id : -1;
    world.teams[t].homePosition = homePosition(t, cfg.separation, new THREE.Vector3());
  }

  world.recomputePopulation();
  return world;
}

export { DEFAULT_SETUP };
