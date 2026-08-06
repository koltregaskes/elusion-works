import * as THREE from '../../vendor/three/build/three.module.js';
import { bus } from '../core/events.js';
import { SHIPS, ROLE } from '../ships/catalog.js';
import { setNavArrive, setNavHold, setFacePoint } from './movement.js';

/* Resourcing and production.

   Collectors run a four-state loop — find a seam, cut it, haul it home,
   unload — and the whole game hangs off it: a fleet that loses its collectors
   loses about ninety seconds later. Production is a per-team queue with each
   item bound to a producer, so a carrier genuinely doubles your build rate. */

export const HARVEST = { SEEK: 0, CUT: 1, RETURN: 2, UNLOAD: 3 };

/* --------------------------------------------------------------- field control

   The midline band in `spawn.js` has always been the most interesting geography
   on the map — richer ore, equidistant, indefensible — and until now it was
   worth exactly its ore and nothing else. There was therefore no reason to hold
   ground: a fleet that won a fight could go home and lose nothing by it, which
   is most of why winning every engagement 12:1 for half an hour bought a player
   nothing at all.

   Holding a contested seam now does two things: it pays, and it runs a clock.
   Both are continuous and both are visible, and neither of them scales with how
   well the opponent is doing — this is a race for ground, not a rubber band. */
export const CONTROL = {
  /** Metres past a cluster's own radius that count as standing on it. */
  RADIUS: 3400,
  /** Seconds of unopposed presence to take a neutral seam. */
  CAPTURE: 22,
  /** Income multiplier per held contested seam. */
  INCOME_PER_SEAM: 0.09,
  /** Presence advantage below which a seam is genuinely deadlocked. */
  DEADZONE: 0.22,
  /** Share of capture rate at which an abandoned seam drifts back to neutral. */
  DECAY: 0.28,
};

/* Upkeep. Company of Heroes' brake, and the reason it is the one the
   literature keeps naming: it is passive, continuous and has no threshold to
   fall off. A lean fleet earns full rate; a maxed one earns about two thirds.
   Nothing is ever taken away, so it never reads as a punishment for winning —
   it just means the fiftieth interceptor is worth less than the fifth. */
const UPKEEP_FREE_POP = 50;
const UPKEEP_K = 0.0045;

/* Anything below this much damage-per-second against a hauler is a picket, not
   a raid. A collector that downs tools every time an enemy scout drifts past
   has stopped being an economy. */
const FLEE_THREAT = 40;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Per-entity harvesting state. Called at spawn for RESOURCE-role hulls. */
export function initEconomyState(e) {
  if (e.role !== ROLE.RESOURCE) return;
  e.harvestState = HARVEST.SEEK;
  e.cargo = 0;
  e.capacity = e.def.capacity || 200;
  e.harvestRate = e.def.harvestRate || 20;
  e.clusterId = -1;
  e.homeId = -1;
  e.dockTimer = 0;
  e.fleeUntil = 0;
  e.fleeFromId = -1;
}

/* ------------------------------------------------------------ resourcing */

function nearestProducer(world, e) {
  const team = world.teams[e.team];
  let best = null;
  let bestD = Infinity;
  for (const id of team.producers) {
    const p = world.entities.get(id);
    if (!p || !p.alive) continue;
    const d = p.position.distanceToSquared(e.position);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Pick a seam: rich, close, and not already crawling with our own hulls. */
function pickCluster(world, e) {
  const clusters = world.resourceClusters;
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (c.amount <= 1) continue;
    const d = Math.sqrt(c.position.distanceToSquared(e.position)) + 200;
    const crowd = 1 + (c.miners[e.team] || 0) * 0.55;
    // Contested rock is worth less than safe rock: a collector that dies
    // full has harvested nothing.
    const danger = 1 + c.threat[e.team ^ 1] * 0.9;
    const score = (Math.min(c.amount, 4000) * 1000) / (d * crowd * danger);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** A stable point on the cluster shell so a dozen collectors do not stack. */
function seamPoint(cluster, e, out) {
  const k = e.id * 2.399963;
  const y = ((e.id * 7) % 13) / 13 - 0.5;
  const r = Math.sqrt(Math.max(0.05, 1 - y * y * 4)) * cluster.radius * 0.72;
  out.set(
    cluster.position.x + Math.cos(k) * r,
    cluster.position.y + y * cluster.radius * 0.8,
    cluster.position.z + Math.sin(k) * r,
  );
  return out;
}

/* ------------------------------------------------------------------- flight */

let _threatSelf = null;
let _threatBest = null;
let _threatScore = 0;

function threatVisitor(n) {
  const e = _threatSelf;
  if (!n.alive || n.team === e.team) return;
  if (!(n.threatScore > FLEE_THREAT)) return;
  if (n.role === ROLE.STRUCTURE) return; // a fixed battery is a place, not a hunter
  const score = n.threatScore / (n.position.distanceToSquared(e.position) + 1);
  if (score > _threatScore) {
    _threatScore = score;
    _threatBest = n;
  }
}

/** Nearest armed enemy inside `range` that could actually kill a hauler. */
function nearestThreat(world, e, range) {
  _threatSelf = e;
  _threatBest = null;
  _threatScore = 0;
  world.forEachNear(e.position.x, e.position.y, e.position.z, range, threatVisitor);
  const out = _threatBest;
  _threatSelf = null;
  _threatBest = null;
  return out;
}

function releaseCluster(world, e) {
  if (e.clusterId < 0) return;
  const c = world.resourceClusters[e.clusterId];
  if (c) c.miners[e.team] = Math.max(0, (c.miners[e.team] || 0) - 1);
  e.clusterId = -1;
}

function updateCollector(world, e, dt) {
  const clusters = world.resourceClusters;

  /* Collectors are the game, and a full hold is worth nothing if the hauler
     dies with it. They keep cutting under fire only long enough to notice it,
     then run for the nearest yard and unload whatever they have. The scan is
     staggered across hulls — this decides something that plays out over half a
     minute, so it does not need to be answered thirty times a second. */
  const tick = world.tickCount;
  if ((tick + e.id) % 10 === 0) {
    const hunted = tick - e.lastHitTick < 90;
    const threat = nearestThreat(world, e, hunted ? 3600 : 2200);
    if (threat) {
      e.fleeUntil = world.time + 7;
      e.fleeFromId = threat.id;
    }
  }

  if (world.time < e.fleeUntil) {
    if (e.harvestState === HARVEST.CUT || e.harvestState === HARVEST.SEEK) {
      releaseCluster(world, e);
      e.harvestState = HARVEST.RETURN;
    }
    const guard = nearestProducer(world, e);
    if (guard) {
      const safe = guard.radius + e.radius + 900;
      if (e.cargo <= 0 && e.position.distanceToSquared(guard.position) < safe * safe) {
        // Home and empty: sit under the yard's guns until it blows over.
        setNavHold(e);
        setFacePoint(e, null);
        return;
      }
    } else {
      // Nowhere to run to. Put distance between us and the shooter instead.
      const from = world.entities.get(e.fleeFromId);
      if (from && from.alive) {
        _b.subVectors(e.position, from.position);
        if (_b.lengthSq() < 1e-4) _b.set(0, 1, 0);
        _b.normalize().multiplyScalar(5000).add(e.position);
        setNavArrive(e, _b, 1, e.radius + 40);
        setFacePoint(e, null);
        return;
      }
    }
  }

  switch (e.harvestState) {
    case HARVEST.CUT: {
      const c = clusters[e.clusterId];
      if (!c || c.amount <= 0) {
        e.clusterId = -1;
        e.harvestState = HARVEST.SEEK;
        return;
      }
      seamPoint(c, e, _a);
      const d = e.position.distanceTo(_a);
      if (d > c.radius * 0.5 + e.radius + 40) {
        setNavArrive(e, _a, 1, e.radius + 20);
        setFacePoint(e, null);
        return;
      }
      setNavArrive(e, _a, 0.35, e.radius + 20);
      setFacePoint(e, c.position);
      const take = Math.min(e.harvestRate * dt, c.amount, e.capacity - e.cargo);
      c.amount -= take;
      e.cargo += take;
      if (e.cargo >= e.capacity - 0.01 || c.amount <= 0) {
        e.harvestState = HARVEST.RETURN;
        c.miners[e.team] = Math.max(0, (c.miners[e.team] || 0) - 1);
        e.clusterId = -1;
      }
      return;
    }

    case HARVEST.RETURN: {
      const home = world.entities.get(e.homeId);
      const p = home && home.alive ? home : nearestProducer(world, e);
      if (!p) {
        // Nowhere to unload. Hold the cargo and idle rather than orbit forever.
        setNavHold(e);
        return;
      }
      e.homeId = p.id;
      const dockR = p.radius + e.radius + 40;
      _b.copy(e.position).sub(p.position);
      if (_b.lengthSq() < 1e-4) _b.set(0, 0, 1);
      _b.normalize().multiplyScalar(dockR).add(p.position);
      setNavArrive(e, _b, 1, e.radius + 10);
      setFacePoint(e, p.position);
      if (e.position.distanceTo(p.position) <= dockR + e.radius + 60) {
        e.harvestState = HARVEST.UNLOAD;
        e.dockTimer = 0.6;
      }
      return;
    }

    case HARVEST.UNLOAD: {
      e.dockTimer -= dt;
      setNavHold(e);
      if (e.dockTimer <= 0) {
        if (e.cargo > 0) {
          const t = world.teams[e.team];
          const paid = e.cargo * (t.incomeScale || 1);
          addCredits(world, e.team, paid);
          t.harvested += paid;
          e.cargo = 0;
        }
        e.harvestState = HARVEST.SEEK;
      }
      return;
    }

    default: {
      const idx = pickCluster(world, e);
      if (idx < 0) {
        // Field is stripped: park on the nearest producer and wait.
        const p = nearestProducer(world, e);
        if (p) {
          _b.copy(e.position).sub(p.position).normalize()
            .multiplyScalar(p.radius + e.radius + 200).add(p.position);
          setNavArrive(e, _b, 0.5, e.radius + 40);
        } else {
          setNavHold(e);
        }
        return;
      }
      e.clusterId = idx;
      const c = clusters[idx];
      c.miners[e.team] = (c.miners[e.team] || 0) + 1;
      e.harvestState = HARVEST.CUT;
      seamPoint(c, e, _a);
      setNavArrive(e, _a, 1, e.radius + 20);
      setFacePoint(e, null);
    }
  }
}

/* --------------------------------------------------------------- credits */

export function addCredits(world, team, delta) {
  const t = world.teams[team];
  t.credits += delta;
  if (t.credits < 0) t.credits = 0;
  bus.emit('sim:resourceChanged', { team, credits: t.credits, delta });
}

/* ---------------------------------------------------------------- control */

/**
 * Who is standing on the contested band, and what that is worth.
 *
 * Presence is armed, mobile hulls only. A collector does not take ground and a
 * mothership does not go and sit on a seam, so neither counts: taking the
 * middle costs warships that are then not somewhere else, which is the whole
 * point of the decision.
 *
 * Control is a per-cluster float in [-1, 1] — negative to team 0, positive to
 * team 1 — and it is a tug-of-war, not a switch. Presence is measured in fleet
 * *value*, so the seam swings toward whoever is genuinely winning the fight
 * over it and only deadlocks when the two sides are close to matched.
 *
 * Freezing the seam whenever both sides had a hull inside it was tried first
 * and it simply moved the stalemate: a permanently deadlocked band meant the
 * clock never ran and the match still could not resolve. Winning the fight in
 * the middle has to *take* the middle, or none of this converts.
 *
 * A seam stays yours once taken — you keep ground until somebody pushes you
 * off it — but an abandoned one drifts back to neutral, so the middle cannot
 * be claimed at minute five and banked.
 */
export function updateControl(world, dt) {
  const clusters = world.resourceClusters;
  if (!clusters.length) return;

  // Presence is rebuilt on the same stagger as the threat map below.
  if (world.tickCount % 15 === 0) {
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (!c.contested) continue;
      if (!c.presence) c.presence = [0, 0];
      c.presence[0] = 0;
      c.presence[1] = 0;
    }
    const list = world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.role === ROLE.STRUCTURE || e.role === ROLE.RESOURCE) continue;
      if (!e.weapons || !e.weapons.length) continue;
      // Value, not hulls: twenty scouts do not hold ground against a destroyer.
      const w = e.def.cost || 40;
      for (let k = 0; k < clusters.length; k++) {
        const c = clusters[k];
        if (!c.contested) continue;
        const rr = c.radius + CONTROL.RADIUS;
        if (c.position.distanceToSquared(e.position) < rr * rr) c.presence[e.team] += w;
      }
    }
  }

  const rate = 1 / CONTROL.CAPTURE;
  const seams = [0, 0];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (!c.contested) continue;
    if (c.control === undefined) c.control = 0;
    const p = c.presence || (c.presence = [0, 0]);
    const total = p[0] + p[1];
    if (total <= 0) {
      // Nobody is standing on it. Ground you walked away from is not yours.
      const decay = rate * CONTROL.DECAY * dt;
      if (c.control > decay) c.control -= decay;
      else if (c.control < -decay) c.control += decay;
      else c.control = 0;
    } else {
      const bias = (p[1] - p[0]) / total; // -1 all ours, +1 all theirs
      const mag = Math.abs(bias);
      if (mag > CONTROL.DEADZONE) {
        c.control = Math.max(-1, Math.min(1, c.control + Math.sign(bias) * mag * rate * dt));
      }
    }
    const owner = c.control <= -0.999 ? 0 : c.control >= 0.999 ? 1 : -1;
    if (owner >= 0) seams[owner]++;
    if (c.owner !== owner) {
      const was = c.owner;
      c.owner = owner;
      if (was !== undefined) announceSeam(world, owner, was);
    }
  }
  world.teams[0].seams = seams[0];
  world.teams[1].seams = seams[1];
  refreshIncome(world);
}

function announceSeam(world, owner, was) {
  if (!world.notify) return;
  const me = world.humanTeam;
  if (owner === me) {
    world._alert('seamTaken', 'Contested seam secured', 'good', 20);
  } else if (was === me) {
    world._alert('seamLost', 'Contested seam lost', 'warn', 20);
  }
}

/**
 * Fold the three income terms into the one number the haulers are paid at.
 *
 * Kept separate all the way to here so the HUD can show a player *why* their
 * income is what it is. An economy that silently halves itself is the same
 * defect as an AI that silently doubles its own.
 */
export function refreshIncome(world) {
  for (let i = 0; i < world.teams.length; i++) {
    const t = world.teams[i];
    const over = Math.max(0, t.popUsed - UPKEEP_FREE_POP);
    t.upkeepScale = 1 / (1 + over * UPKEEP_K);
    t.controlScale = 1 + t.seams * CONTROL.INCOME_PER_SEAM;
    t.incomeScale = (t.incomeBase || 1) * t.upkeepScale * t.controlScale;
  }
}

/* ------------------------------------------------------------ production */

/** True if `team` can afford and house a wing of `classId` right now. */
export function canBuild(world, team, classId, producerId) {
  const def = SHIPS[classId];
  if (!def) return false;
  const t = world.teams[team];
  if (t.credits < def.cost) return false;
  const squad = Math.max(1, def.squadSize || 1);
  if (t.popUsed + t.popQueued + (def.popCost || 0) * squad > t.popCap) return false;
  return findProducer(world, team, classId, producerId) !== null;
}

function findProducer(world, team, classId, producerId) {
  const def = SHIPS[classId];
  const t = world.teams[team];
  if (producerId !== undefined && producerId !== null) {
    const p = world.entities.get(producerId);
    if (!p || !p.alive || p.team !== team || !def.buildableBy.includes(p.classId)) return null;
    return p;
  }
  let best = null;
  let bestLoad = Infinity;
  for (const id of t.producers) {
    const p = world.entities.get(id);
    if (!p || !p.alive) continue;
    if (!def.buildableBy.includes(p.classId)) continue;
    let load = 0;
    for (let i = 0; i < t.queue.length; i++) if (t.queue[i].producerId === p.id) load++;
    if (load < bestLoad) {
      bestLoad = load;
      best = p;
    }
  }
  return best;
}

/**
 * Queue a wing. Cost and population are committed immediately so the UI can
 * never promise a fleet the treasury cannot pay for. Pass `producerId` to pin
 * the item to a specific yard; otherwise the least-loaded one takes it.
 */
export function enqueueBuild(world, team, classId, producerId) {
  const def = SHIPS[classId];
  if (!def) return false;
  const t = world.teams[team];
  const producer = findProducer(world, team, classId, producerId);
  if (!producer) return false;
  const squad = Math.max(1, def.squadSize || 1);
  const pop = (def.popCost || 0) * squad;
  if (t.credits < def.cost || t.popUsed + t.popQueued + pop > t.popCap) return false;

  addCredits(world, team, -def.cost);
  t.popQueued += pop;
  t.queue.push({
    classId,
    producerId: producer.id,
    remaining: def.buildTime,
    buildTime: def.buildTime,
    cost: def.cost,
    pop,
  });
  return true;
}

export function cancelBuild(world, team, index) {
  const t = world.teams[team];
  if (index < 0 || index >= t.queue.length) return false;
  const item = t.queue.splice(index, 1)[0];
  addCredits(world, team, item.cost);
  t.popQueued = Math.max(0, t.popQueued - item.pop);
  return true;
}

const _launch = new THREE.Vector3();
const _side = new THREE.Vector3();
const WORLD_FWD = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Push a finished wing out of the hangar mouth with real separation. */
function launch(world, producer, classId, team) {
  const def = SHIPS[classId];
  const squad = Math.max(1, def.squadSize || 1);
  _launch.copy(WORLD_FWD).applyQuaternion(producer.quaternion);
  _side.copy(WORLD_UP).applyQuaternion(producer.quaternion).cross(_launch).normalize();
  const out = producer.radius + def.length * 1.6 + 80;
  let first = null;

  for (let i = 0; i < squad; i++) {
    const lane = (i - (squad - 1) / 2) * (def.length * 2.4 + 30);
    _a.copy(producer.position)
      .addScaledVector(_launch, out + (i % 2) * def.length * 1.5)
      .addScaledVector(_side, lane)
      .addScaledVector(WORLD_UP, ((i % 3) - 1) * def.length * 0.9);
    const e = world.spawn(classId, team, _a, producer.quaternion);
    if (!e) break;
    e.velocity.copy(_launch).multiplyScalar(def.speed * 0.55);
    e.station = producer.position.clone().addScaledVector(_launch, out + 600);
    if (!first) first = e;
  }

  if (first) bus.emit('sim:buildComplete', { team, classId, entity: first });
  return first;
}

function updateProduction(world, dt) {
  for (let ti = 0; ti < world.teams.length; ti++) {
    const t = world.teams[ti];
    const q = t.queue;
    if (q.length === 0) continue;

    // One item in progress per producer.
    const busy = world._busyScratch;
    busy.clear();
    for (let i = 0; i < q.length; i++) {
      const item = q[i];
      if (busy.has(item.producerId)) continue;
      const p = world.entities.get(item.producerId);
      if (!p || !p.alive) {
        // Producer died mid-build: refund and drop.
        addCredits(world, ti, item.cost);
        t.popQueued = Math.max(0, t.popQueued - item.pop);
        q.splice(i--, 1);
        continue;
      }
      busy.add(item.producerId);
      item.remaining -= dt * (t.buildRate || 1);
      if (item.remaining <= 0) {
        t.popQueued = Math.max(0, t.popQueued - item.pop);
        launch(world, p, item.classId, ti);
        q.splice(i--, 1);
        busy.delete(p.id);
      }
    }
  }
}

/* ------------------------------------------------------------------ tick */

export function updateEconomy(world, dt) {
  const clusters = world.resourceClusters;
  const list = world.dense;

  // Threat map: warships parked on a seam make it unattractive to the other
  // side's collectors. Rebuilt twice a second — it steers a decision that
  // takes half a minute to play out, so per-tick precision buys nothing.
  if (world.tickCount % 15 === 0) {
    for (let i = 0; i < clusters.length; i++) clusters[i].threat[0] = clusters[i].threat[1] = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.role === ROLE.STRUCTURE) continue;
      if (!e.weapons || !e.weapons.length) continue;
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c];
        const rr = cl.radius + 3200;
        if (cl.position.distanceToSquared(e.position) < rr * rr) cl.threat[e.team] += 1;
      }
    }
  }

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    if (e.role === ROLE.RESOURCE && e.harvestOrder !== false) updateCollector(world, e, dt);
  }

  updateProduction(world, dt);
}
