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

function updateCollector(world, e, dt) {
  const clusters = world.resourceClusters;

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
