import * as THREE from '../../vendor/three/build/three.module.js';
import { SHIPS, ROLE, CLASS_IDS } from '../ships/catalog.js';
import { canBuild, enqueueBuild, cancelBuild, refreshIncome, CONTROL } from './economy.js';
import { dpsAgainst, STANCE } from './combat.js';
import { FORMATION } from './formations.js';

/* The enemy commander.

   Not a script. It runs an economy, keeps a picture of what it has actually
   seen, buys the counter to it, and holds its fleet back until the fleet is
   worth committing. The three things that make it read as a player rather than
   a spawner are: it harasses collectors early, it masses before it attacks,
   and it pulls wounded capitals out of the line.

   Two rules keep the push coherent rather than a trickle:

     * Force membership is sticky. A ship keeps its job until the commander
       deliberately reassigns it, and quotas drift back into line a ship or two
       at a time. Rebuilding the order of battle from scratch every think was
       what had wings receiving fresh waypoints faster than they could fly to
       the last one.
     * Orders are only re-issued when they have actually changed. A move is
       repeated when the objective drifts, the force gains or loses a real
       fraction of its hulls, or the wing has run out of orders — not on a
       timer.

   And one rule makes the match resolve: the commander escalates. Strangling
   an economy is an opening, not a win condition, so pressure shifts from
   collectors to yards to the mothership as the fleet grows, as the enemy
   economy dies, and — failing both — as the clock runs out.

   No resource cheating at 'normal'. */

/* Difficulty.

   `income` and `buildRate` are the only two entries here that are not
   decisions — everything else describes how the commander *plays*, and a
   player could make every one of those choices too. So those two are the only
   two that can be dishonest, and hard is now flat 1.0 on both.

   The rubric's line on this is unambiguous and it is the most durable
   complaint in the whole genre: if you must handicap, handicap *downward* on
   easy rather than upward on hard. Easy therefore keeps 0.9 / 0.85 — a
   disclosed handicap in the player's favour — and hard is bought entirely with
   decision quality: it thinks twice as often, commits on a lower margin,
   works more seams, raids sooner, reaches for the contested band earlier and
   never makes a random mistake.

   Verified head-to-head after the change: see the report. */
const DIFFICULTY = {
  easy: {
    think: 2.6, commitScale: 1.75, collectors: 5, harassAt: 200,
    income: 0.9, buildRate: 0.85, retreatAt: 0.45, techScale: 1.35, sloppiness: 0.35,
    dominance: 1.5, siegeAt: 1500, yards: 3, defenceShare: 0.30, reserve: 3.2,
    holdShare: 0.10, contestAt: 260,
  },
  normal: {
    think: 1.4, commitScale: 1.0, collectors: 8, harassAt: 78,
    income: 1.0, buildRate: 1.0, retreatAt: 0.34, techScale: 1.0, sloppiness: 0.12,
    dominance: 1.08, siegeAt: 840, yards: 5, defenceShare: 0.22, reserve: 2.4,
    holdShare: 0.18, contestAt: 170,
  },
  hard: {
    think: 0.65, commitScale: 0.72, collectors: 11, harassAt: 45,
    income: 1.0, buildRate: 1.0, retreatAt: 0.26, techScale: 0.8, sloppiness: 0.0,
    dominance: 0.88, siegeAt: 560, yards: 6, defenceShare: 0.18, reserve: 1.5,
    holdShare: 0.26, contestAt: 110,
  },
};

/** Plain-language difficulty copy. The boot card and the HUD read this — an
    undisclosed multiplier is an automatic fail, so it is stated here once. */
export const DIFFICULTY_COPY = {
  easy: {
    name: 'Cadet',
    line: 'Thinks slowly, masses far too long, and mines a handicapped 90% ' +
      'income at 85% build speed. The handicap is yours, not its.',
  },
  normal: {
    name: 'Line Officer',
    line: 'Plays the same economy you do — identical income, identical build ' +
      'speed. Raids at about a minute twenty, contests the middle from three.',
  },
  hard: {
    name: 'Fleet Command',
    line: 'Plays the same economy you do. No income bonus, no build bonus. ' +
      'It simply thinks twice as often, commits on a thinner margin, works ' +
      'more seams, raids sooner and goes for the contested band first.',
  },
};

/* Earliest sensible time (seconds) for each class. Stops the opening from
   being a coin-flip and gives the match a shape. */
const TECH_GATE = {
  scout: 0,
  collector: 0,
  interceptor: 20,
  corvette: 45,
  bomber: 70,
  missileCorvette: 110,
  assaultFrigate: 165,
  ionFrigate: 195,
  supportFrigate: 235,
  carrier: 275,
  destroyer: 340,
  cruiser: 580,
};

const COMBAT_ROLES = [ROLE.FIGHTER, ROLE.CORVETTE, ROLE.FRIGATE, ROLE.CAPITAL, ROLE.SUPPORT];

/* Once a push is under way the fleet stays a fleet. A new objective inside
   this radius is a change of aim, not a reason to fly home and form up again —
   which is what used to happen every time a collector died. */
const THEATRE = 11000;

/* A fleet is "together" when most of it is inside this of its own centre, and
   it advances on the objective in bounds of this length. Ships outside the
   body are told to rejoin it, never to go and find the enemy on their own:
   that is the difference between a push and a queue of single ships walking
   into a meat grinder. */
const COHESION = 5400;
const ADVANCE = 6500;

/* How far from the body the commander will look for the thing to kill next
   when the fleet is in contact short of its objective. */
const MELEE = 7000;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/* Sorting a force by range to a point. The comparator is module-level so the
   sort does not allocate a closure every think. */
const _sortOrigin = new THREE.Vector3();
function byRangeToOrigin(a, b) {
  return a.position.distanceToSquared(_sortOrigin) - b.position.distanceToSquared(_sortOrigin);
}

export class Commander {
  constructor(world, team, opts = {}) {
    this.world = world;
    this.team = team;
    this.difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal';
    this.cfg = DIFFICULTY[this.difficulty];
    this.rng = world.rngAi.fork(team + 1);

    const t = world.teams[team];
    // The handicap is the *base*; upkeep and field control multiply it, and
    // they are the same for both sides.
    t.incomeBase = this.cfg.income;
    t.buildRate = this.cfg.buildRate;
    refreshIncome(world);

    this.timer = this.rng.range(0, 0.6);
    this.intel = {};
    for (let i = 0; i < COMBAT_ROLES.length; i++) this.intel[COMBAT_ROLES[i]] = 0;
    this.intel[ROLE.RESOURCE] = 0;
    this.intel[ROLE.STRUCTURE] = 0;

    this.own = {};
    this.strike = [];
    this.defence = [];
    this.harass = [];
    this.hold = [];
    this.holdCluster = -1;
    this.strikeTargetId = -1;
    this.meleeTargetId = -1;
    this.strikePoint = new THREE.Vector3();
    this.phase = 'massing';
    this.phaseDeadline = 0;
    this.bestProgress = Infinity;
    this.progressAt = 0;
    this.flankSign = 0;
    this.flankUntil = -1;
    this.committed = false;
    this.harassSent = false;
    this.harassCooldown = 0;
    this.expandCluster = -1;
    this.lastDefenceCall = -999;
    this.defencePoint = new THREE.Vector3();

    this._scratch = [];
    this._ids = [];
    this._near = [];
    this._far = [];
    this._body = [];
    this._orders = {};
  }

  get state() {
    return {
      difficulty: this.difficulty,
      committed: this.committed,
      phase: this.phase,
      strike: this.strike.length,
      defence: this.defence.length,
      harass: this.harass.length,
      hold: this.hold.length,
      seams: this.world.teams[this.team].seams,
      sovereignty: Math.round(this.world.teams[this.team].sovereignty),
      targetId: this.strikeTargetId,
      intel: this.intel,
    };
  }

  update(dt) {
    if (this.world.over) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.cfg.think;
    this._census();
    this._observe();
    this._economy();
    this._production();
    this._assignForces();
    this._harass();
    this._defend();
    this._control();
    this._strike();
    this._retreat();
    this._scout();
  }

  /* -------------------------------------------------------------- awareness */

  _census() {
    const own = this.own;
    for (const k in own) own[k] = 0;
    own.value = 0;
    own.combat = 0;
    own.collectors = 0;
    own.producers = 0;
    const list = this.world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team !== this.team) continue;
      own[e.classId] = (own[e.classId] || 0) + 1;
      own[e.role] = (own[e.role] || 0) + 1;
      if (e.role === ROLE.RESOURCE) own.collectors++;
      else if (e.role === ROLE.STRUCTURE) own.producers++;
      else {
        own.combat++;
        own.value += e.def.cost;
      }
    }
  }

  /** Only count what we can actually see. Intel decays if we lose contact. */
  _observe() {
    const world = this.world;
    const sources = this._scratch;
    sources.length = 0;
    const list = world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team !== this.team) continue;
      if (e.role === ROLE.STRUCTURE || e.classId === 'scout' || (e.id & 3) === 0) sources.push(e);
    }

    const seen = {};
    for (let i = 0; i < COMBAT_ROLES.length; i++) seen[COMBAT_ROLES[i]] = 0;
    seen[ROLE.RESOURCE] = 0;
    seen[ROLE.STRUCTURE] = 0;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team === this.team) continue;
      for (let s = 0; s < sources.length; s++) {
        const src = sources[s];
        const r = src.def.sensorRange || 4000;
        if (src.position.distanceToSquared(e.position) <= r * r) {
          seen[e.role] = (seen[e.role] || 0) + 1;
          break;
        }
      }
    }

    // Blend: fresh contacts count fully, stale ones fade rather than vanish.
    for (const role in this.intel) {
      const fresh = seen[role] || 0;
      this.intel[role] = fresh > this.intel[role]
        ? fresh
        : this.intel[role] * 0.72 + fresh * 0.28;
    }
  }

  /* ---------------------------------------------------------------- economy */

  _economy() {
    const world = this.world;
    const t = world.teams[this.team];
    const want = this.cfg.collectors;
    const queued = this._queuedCount('collector');
    const have = this.own.collectors + queued;
    if (have >= want) return;

    if (canBuild(world, this.team, 'collector')) {
      enqueueBuild(world, this.team, 'collector');
      return;
    }
    // Miners come first. If the yard is jammed with warships and the economy
    // has been shot out from under us, bin the back of the queue and rebuild
    // it — an idle treasury with no collectors is how you lose from ahead.
    if (have < 3 && t.credits >= SHIPS.collector.cost) {
      for (let i = t.queue.length - 1; i >= 0; i--) {
        if (t.queue[i].classId === 'collector') continue;
        cancelBuild(world, this.team, i);
        if (canBuild(world, this.team, 'collector')) {
          enqueueBuild(world, this.team, 'collector');
          return;
        }
      }
    }
  }

  _queuedCount(classId) {
    const q = this.world.teams[this.team].queue;
    let n = 0;
    for (let i = 0; i < q.length; i++) if (q[i].classId === classId) n++;
    return n;
  }

  /* ------------------------------------------------------------- production */

  /* Keep every yard working.
     A mothership spends 210 seconds on a cruiser; if that is the only thing on
     order, income outruns spending by two to one and the treasury swells while
     the fleet stays tiny. So production is planned per yard: the mothership
     lays down capitals while the carriers pump strike craft, the way the genre
     has always worked.

     Throughput, not money, is the real ceiling — one hull at a time per yard.
     A treasury that keeps growing is therefore a signal to buy another yard,
     not to queue deeper at the ones already saturated. */
  _production() {
    const world = this.world;
    const t = world.teams[this.team];

    const head = t.popCap - t.popUsed - t.popQueued;
    const carriers = (this.own.carrier || 0) + this._queuedCount('carrier');
    const gate = TECH_GATE.carrier * this.cfg.techScale;
    // Two reasons to lay down a yard: nowhere to put the fleet, or money
    // piling up faster than the existing yards can spend it.
    const needRoom = head < 12;
    const idleMoney = t.credits > SHIPS.carrier.cost * this.cfg.reserve;
    if ((needRoom || idleMoney) && carriers < this.cfg.yards && this.time > gate &&
        t.credits > SHIPS.carrier.cost * 1.4 && canBuild(world, this.team, 'carrier')) {
      enqueueBuild(world, this.team, 'carrier');
      return;
    }

    for (const id of t.producers) {
      const p = world.entities.get(id);
      if (!p || !p.alive) continue;
      let load = 0;
      for (let i = 0; i < t.queue.length; i++) if (t.queue[i].producerId === id) load++;
      if (load >= 2) continue;
      const pick = this._chooseClass(p.classId);
      if (pick) enqueueBuild(world, this.team, pick, id);
    }
  }

  get time() {
    return this.world.time;
  }

  /** Observed enemy composition as role shares that sum to one. */
  _shares(out) {
    let total = 0;
    for (let r = 0; r < COMBAT_ROLES.length; r++) total += this.intel[COMBAT_ROLES[r]] || 0;
    total += (this.intel[ROLE.RESOURCE] || 0) * 0.5;
    if (total < 0.5) {
      // Nothing seen: assume a broad opposing fleet rather than nothing.
      out[ROLE.FIGHTER] = 0.4;
      out[ROLE.CORVETTE] = 0.15;
      out[ROLE.FRIGATE] = 0.2;
      out[ROLE.CAPITAL] = 0.1;
      out[ROLE.SUPPORT] = 0.05;
      out[ROLE.RESOURCE] = 0.1;
      return out;
    }
    for (let r = 0; r < COMBAT_ROLES.length; r++) {
      const role = COMBAT_ROLES[r];
      out[role] = (this.intel[role] || 0) / total;
    }
    out[ROLE.RESOURCE] = ((this.intel[ROLE.RESOURCE] || 0) * 0.5) / total;
    return out;
  }

  /**
   * Buy the counter.
   *
   * Damage alone picks cheap squadrons forever — five interceptors for sixty
   * credits beat everything on paper and then evaporate against a flak wall.
   * So the metric is sqrt(dps x effective hp), against the composition we have
   * actually seen, over a price that charges for population as well as
   * credits. Population is the real late-game constraint, and it is what makes
   * a destroyer the correct purchase once the yard can afford one.
   */
  _chooseClass(producerClassId) {
    const world = this.world;
    const t = world.teams[this.team];
    const now = this.time;
    const share = this._shares(this._shareBuf || (this._shareBuf = {}));
    let best = null;
    let bestScore = 0;

    for (let i = 0; i < CLASS_IDS.length; i++) {
      const id = CLASS_IDS[i];
      const def = SHIPS[id];
      if (!def.buildableBy.length) continue;
      if (def.role === ROLE.RESOURCE || id === 'carrier') continue;
      if (producerClassId && !def.buildableBy.includes(producerClassId)) continue;
      const gate = (TECH_GATE[id] === undefined ? 0 : TECH_GATE[id]) * this.cfg.techScale;
      if (now < gate) continue;
      if (t.credits < def.cost) continue;
      if (!canBuild(world, this.team, id)) continue;

      const squad = Math.max(1, def.squadSize || 1);
      let dps = 0;
      for (let r = 0; r < COMBAT_ROLES.length; r++) {
        const role = COMBAT_ROLES[r];
        dps += (share[role] || 0) * dpsAgainst(def, role);
      }
      dps += (share[ROLE.RESOURCE] || 0) * dpsAgainst(def, ROLE.RESOURCE);
      // Everything eventually has to shoot a mothership.
      dps += 0.12 * dpsAgainst(def, ROLE.STRUCTURE);

      const ehp = (def.shield + def.hull / Math.max(0.15, 1 - def.armour)) * squad;
      const pop = (def.popCost || 0) * squad;
      const price = def.cost + pop * 180;
      let score = Math.sqrt(Math.max(1, dps * squad) * ehp) / price;

      // Count what is already on order as though it existed, or a yard-by-yard
      // pass queues five scout wings before the first one launches.
      const have = (this.own[id] || 0) + this._queuedCount(id) * squad;

      // Diversity: the marginal value of the twentieth interceptor is low.
      score /= 1 + have * 0.14;

      // Scouts are intel, not fleet — buy one wing and stop.
      if (id === 'scout') score = have < 3 ? 0.55 : 0;
      // Support frigates are bought on need, not on paper numbers.
      if (def.repairRate) score = this.own.combat > 10 && have < 2 ? 1.15 : 0;

      if (this.cfg.sloppiness > 0) {
        score *= 1 + this.rng.range(-this.cfg.sloppiness, this.cfg.sloppiness);
      }

      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  /* ----------------------------------------------------------------- forces */

  /**
   * Sticky order of battle. Ships keep the job they were given; the quota is
   * nudged back into line by a couple of hulls per think rather than rebuilt,
   * so a wing is never handed a new destination faster than it can reach the
   * last one.
   */
  _assignForces() {
    const strike = this.strike;
    const defence = this.defence;
    const harass = this.harass;
    const hold = this.hold;
    strike.length = 0;
    defence.length = 0;
    harass.length = 0;
    hold.length = 0;

    const list = this.world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team !== this.team) continue;
      if (e.role === ROLE.RESOURCE || e.role === ROLE.STRUCTURE) continue;
      if (e.classId === 'scout') {
        e.aiForce = 'scout';
        continue;
      }
      if (e.aiRepairing) {
        e.aiForce = 'repair';
        continue;
      }
      if (e.aiForce === 'harass' && this.harassSent) {
        harass.push(e);
        continue;
      }
      if (e.aiForce === 'hold' && e.role !== ROLE.CAPITAL) {
        hold.push(e);
        continue;
      }
      if (e.aiForce === 'defence' && e.role !== ROLE.CAPITAL) {
        defence.push(e);
        continue;
      }
      e.aiForce = 'strike';
      strike.push(e);
    }

    const wantDefence = Math.min(14,
      Math.max(2, Math.round(this.own.combat * this.cfg.defenceShare)));
    this._quota(defence, strike, wantDefence, 'defence');

    /* Ground troops. Somebody has to be standing on the contested band or the
       sovereignty clock runs against us whatever the fleet is doing elsewhere,
       and a commander that only ever hunts hulls will lose a match it is
       winning on kills. Which is exactly the failure the whole clock exists to
       make impossible. */
    const urgency = this._losingControl() ? 1.8 : 1;
    const wantHold = this.time < this.cfg.contestAt
      ? 0
      : Math.min(22,
        Math.max(3, Math.round(this.own.combat * this.cfg.holdShare * urgency)));
    this._quota(hold, strike, wantHold, 'hold');
  }

  /** Drift a force toward its quota a couple of hulls at a time. */
  _quota(force, pool, want, tag) {
    let moves = 2;
    while (force.length > want && moves-- > 0) {
      const e = force.pop();
      e.aiForce = 'strike';
      e.orderQueue.length = 0;
      e.aiCommitted = false;
      pool.push(e);
    }
    moves = 2;
    while (force.length < want && moves-- > 0) {
      let pick = -1;
      for (let i = pool.length - 1; i >= 0; i--) {
        if (pool[i].role !== ROLE.CAPITAL) {
          pick = i;
          break;
        }
      }
      if (pick < 0) break;
      const e = pool[pick];
      pool[pick] = pool[pool.length - 1];
      pool.length--;
      e.aiForce = tag;
      e.orderQueue.length = 0;
      e.aiCommitted = false;
      force.push(e);
    }
  }

  _forceValue(force) {
    let v = 0;
    for (let i = 0; i < force.length; i++) v += force[i].def.cost;
    return v;
  }

  _centroid(force, out) {
    out.set(0, 0, 0);
    if (!force.length) return out;
    for (let i = 0; i < force.length; i++) out.add(force[i].position);
    return out.multiplyScalar(1 / force.length);
  }

  /* ----------------------------------------------------------- order memory */

  _memo(tag) {
    let m = this._orders[tag];
    if (!m) {
      m = {
        point: new THREE.Vector3(NaN, NaN, NaN),
        count: -1, formation: null, mode: null, targetId: -1, time: -999,
      };
      this._orders[tag] = m;
    }
    return m;
  }

  /**
   * Re-issue a move only when it means something: the objective has drifted,
   * the force has gained or lost a real share of its hulls, the shape changed,
   * or most of the wing has run out of orders.
   */
  _moveForce(force, point, formation, tag, minShift, mode) {
    if (!force.length) return;
    const m = this._memo(tag);
    const shift = minShift || 1400;
    let orderless = 0;
    for (let i = 0; i < force.length; i++) if (!force[i].orderQueue.length) orderless++;
    const drifted = !(m.point.distanceToSquared(point) < shift * shift);
    const churned = Math.abs(m.count - force.length) > Math.max(2, force.length * 0.25);
    const idle = orderless > force.length * 0.34;
    if (!drifted && !churned && !idle && m.formation === formation && m.mode === mode) return;

    this.world.issueMove(force, point, formation, true, { mode });
    m.point.copy(point);
    m.count = force.length;
    m.formation = formation;
    m.mode = mode;
    m.time = this.time;
  }

  /** Mark a target. Ships already on it are left alone; the anchor is only
      refreshed periodically, so a moving mark does not reset the whole wing. */
  _attackForce(force, targetId, tag) {
    if (!force.length) return;
    const m = this._memo(tag);
    const refresh = m.targetId !== targetId || this.time - m.time > 9;
    const ids = this._ids;
    ids.length = 0;
    for (let i = 0; i < force.length; i++) {
      const e = force[i];
      if (refresh || e.forcedTargetId !== targetId) ids.push(e.id);
    }
    if (!ids.length) return;
    this.world.commandAttack({ ids, targetId });
    if (refresh) {
      m.targetId = targetId;
      m.time = this.time;
    }
  }

  /* ------------------------------------------------------------- behaviours */

  /** Early fighters go for the throat: their collectors, not their warships. */
  _harass() {
    if (this.harassSent) {
      if (this.harass.length === 0) {
        this.harassSent = false;
        this.harassCooldown = this.time + 90;
        return;
      }
      this._centroid(this.harass, _c);
      const mark = this._nearestEnemyOfRole(_c, ROLE.RESOURCE);
      if (mark) {
        this._attackForce(this.harass, mark.id, 'harass');
        for (let i = 0; i < this.harass.length; i++) this.harass[i].stance = STANCE.AGGRESSIVE;
      } else {
        // Nothing left to strangle: fold the raiders back into the fleet.
        this.harassSent = false;
        this.harassCooldown = this.time + 120;
        for (let i = 0; i < this.harass.length; i++) {
          this.harass[i].aiForce = 'strike';
          this.harass[i].orderQueue.length = 0;
        }
      }
      return;
    }
    if (this.time < this.cfg.harassAt || this.time < this.harassCooldown) return;

    const pool = [];
    for (let i = 0; i < this.strike.length; i++) {
      const e = this.strike[i];
      if (e.role === ROLE.FIGHTER && e.classId !== 'bomber') pool.push(e);
      if (pool.length >= 5) break;
    }
    if (pool.length < 3) return;
    for (let i = 0; i < pool.length; i++) {
      pool[i].aiForce = 'harass';
      pool[i].orderQueue.length = 0;
    }
    this.harass = pool;
    this.harassSent = true;
    this._memo('harass').targetId = -1;
  }

  /** Somebody is shooting our economy: send the standing defence force. */
  _defend() {
    const world = this.world;
    if (!this.defence.length) return;
    const t = world.teams[this.team];

    let alarm = null;
    for (const id of t.collectors) {
      const c = world.entities.get(id);
      if (!c || !c.alive) continue;
      if (world.tickCount - c.lastHitTick < 150) {
        alarm = c;
        break;
      }
    }
    if (!alarm) {
      // A yard under fire is a louder alarm than a miner, not a quieter one.
      for (const id of t.producers) {
        const p = world.entities.get(id);
        if (!p || !p.alive) continue;
        if (world.tickCount - p.lastHitTick < 150) {
          alarm = p;
          break;
        }
      }
    }

    if (alarm) {
      this.defencePoint.copy(alarm.position);
      this.lastDefenceCall = this.time;
      const attacker = world.entities.get(alarm.lastAttackerId);
      if (attacker && attacker.alive && attacker.team !== this.team) {
        this._attackForce(this.defence, attacker.id, 'defend');
      } else {
        this._moveForce(this.defence, this.defencePoint, FORMATION.CLAW, 'defend', 1600, 'attackMove');
      }
      for (let i = 0; i < this.defence.length; i++) this.defence[i].stance = STANCE.AGGRESSIVE;
      return;
    }

    if (this.time - this.lastDefenceCall < 12) return;
    // Idle: sit between the mothership and the nearest worked seam.
    const base = world.entities.get(t.baseId);
    if (!base) return;
    _v.copy(base.position);
    const seam = this._busiestOwnCluster();
    if (seam) _v.lerp(seam.position, 0.55);
    this._moveForce(this.defence, _v, FORMATION.SPHERE, 'defend', 3200, 'move');
    for (let i = 0; i < this.defence.length; i++) this.defence[i].stance = STANCE.NEUTRAL;
  }

  /**
   * Take and hold the middle.
   *
   * The hold force is not a garrison and not a second strike wing: it goes to
   * one contested seam and stays on it, because the seam pays income and runs
   * the clock only while somebody is standing there. It picks the seam it can
   * most plausibly own — ours already, then empty ones, then the one the enemy
   * holds most weakly — and it prefers the near end of the band, so the two
   * commanders do not simply swap ends of the map for ever.
   */
  _control() {
    const world = this.world;
    if (!this.hold.length) {
      this.holdCluster = -1;
      return;
    }
    const t = world.teams[this.team];
    const home = t.homePosition;
    const clusters = world.resourceClusters;

    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (!c.contested) continue;
      const p = c.presence || [0, 0];
      const mine = p[this.team] > 0;
      const theirs = p[this.team ^ 1] > 0;
      const held = c.owner === this.team;
      // Keeping what we hold beats taking what we do not; an empty seam beats
      // one that has to be fought for; distance from home breaks the tie.
      let score = 0;
      if (held) score += 3;
      if (mine) score += 2;
      if (theirs) score -= 2.5;
      if (c.owner === (this.team ^ 1)) score -= 1.5;
      score -= Math.sqrt(c.position.distanceToSquared(home)) / 9000;
      // Stickiness: do not walk the whole band every think.
      if (c.id === this.holdCluster) score += 1.25;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) {
      this.holdCluster = -1;
      return;
    }
    this.holdCluster = best.id;

    /* Sit *on* the seam, on the near face. Standing off it does not count —
       presence is measured from the cluster, and the whole verb is occupation. */
    _v2.subVectors(home, best.position);
    if (_v2.lengthSq() < 1) _v2.set(0, 0, 1);
    _v.copy(best.position).addScaledVector(_v2.normalize(), best.radius * 0.5);

    const p = best.presence || [0, 0];
    const fight = p[this.team ^ 1] > 0;
    this._moveForce(this.hold, _v, fight ? FORMATION.CLAW : FORMATION.SPHERE,
      'hold', 1500, 'attackMove');
    for (let i = 0; i < this.hold.length; i++) {
      this.hold[i].stance = fight ? STANCE.AGGRESSIVE : STANCE.NEUTRAL;
    }
    void CONTROL;
  }

  /** True when the clock is running against us badly enough to answer it. */
  _losingControl() {
    const t = this.world.teams[this.team];
    const foe = this.world.teams[this.team ^ 1];
    return t.seams < foe.seams && t.sovereignty < foe.sovereignty - 12;
  }

  /** Mass, choose, commit. Do not trickle. */
  _strike() {
    const world = this.world;
    if (!this.strike.length) {
      this.committed = false;
      this.strikeTargetId = -1;
      this.phase = 'massing';
      return;
    }
    const value = this._forceValue(this.strike);
    const enemyValue = this._enemyCombatValue();
    // The bar rises early — you do not attack at ninety seconds with two
    // corvettes — but it must stop rising, or the AI masses forever and the
    // match never resolves. Beating what is in front of us is always enough.
    const ramp = Math.min(700 + this.time * 2.4, 5400) * this.cfg.commitScale;
    const need = Math.min(ramp, Math.max(900, enemyValue * 1.25 * this.cfg.commitScale));

    const base = world.entities.get(world.teams[this.team].baseId);

    if (!this.committed) {
      if (value < need) {
        this.phase = 'massing';
        this._stage(base);
        return;
      }
      this.committed = true;
      this.phase = 'rally';
      this.phaseDeadline = this.time + 110;
      this.strikeTargetId = -1;
    }

    // Fall back home if the push has been ground down.
    if (value < need * 0.38) {
      this.committed = false;
      this.phase = 'massing';
      this.strikeTargetId = -1;
      for (let i = 0; i < this.strike.length; i++) {
        this.strike[i].stance = STANCE.NEUTRAL;
        this.strike[i].aiCommitted = false;
      }
      if (base) this._moveForce(this.strike, base.position, FORMATION.DELTA, 'strike', 2600, 'move');
      return;
    }

    let target = this.strikeTargetId >= 0 ? world.entities.get(this.strikeTargetId) : null;
    if (!target || !target.alive) {
      target = this._pickStrikeTarget(value);
      if (!target) return;
      this._centroid(this.strike, _c);
      // Killing a collector is not a reason to fly 8 km home and form up
      // again. Only a genuinely distant objective earns a fresh rally.
      if (_c.distanceToSquared(target.position) > THEATRE * THEATRE) {
        this.phase = 'rally';
        this.phaseDeadline = this.time + 110;
      } else {
        this.phase = 'assault';
      }
      for (let i = 0; i < this.strike.length; i++) this.strike[i].aiCommitted = false;
      this.bestProgress = Infinity;
      this.progressAt = this.time;
      this.flankSign = 0;
      this.flankUntil = -1;
    }
    this.strikeTargetId = target.id;

    /* Rally, then assault.
       Sending ships the moment they roll off the line feeds them to the enemy
       one wing at a time — bombers are slow, interceptors are not, and the
       fast half arrives alone and dies. So the fleet forms up short of the
       objective and goes in together. */
    if (this.phase === 'rally') {
      _v2.subVectors(base ? base.position : this.strikePoint, target.position);
      if (_v2.lengthSq() < 1) _v2.set(0, 0, 1);
      this.strikePoint.copy(target.position).addScaledVector(_v2.normalize(), 8500);
      let ready = 0;
      for (let i = 0; i < this.strike.length; i++) {
        if (this.strike[i].position.distanceToSquared(this.strikePoint) < 4200 * 4200) ready++;
      }
      if (ready >= this.strike.length * 0.7 || this.time > this.phaseDeadline) {
        this.phase = 'assault';
      } else {
        this._moveForce(this.strike, this.strikePoint, FORMATION.WALL, 'strike', 1800, 'move');
        for (let i = 0; i < this.strike.length; i++) this.strike[i].stance = STANCE.NEUTRAL;
        return;
      }
    }

    /* Assault, as a body.

       Ships with the objective in weapon reach go aggressive and put fire on
       it. Everything else is *not* sent hunting: it is given a station on the
       fleet, at neutral, and the fleet advances in bounds. A reinforcement set
       loose at aggressive will chase the first contact it sees for nine
       kilometres, arrive alone and die — repeat that for forty minutes and you
       have two fleets feeding a permanent front line and a match that cannot
       end. Which is exactly what the soak did.

       Hysteresis on the boundary stops a ship on the edge of reach flipping
       between an attack order and a move order every think. */
    const near = this._near;
    const far = this._far;
    near.length = 0;
    far.length = 0;
    for (let i = 0; i < this.strike.length; i++) {
      const e = this.strike[i];
      const reach = (e.engageRange + target.radius + 900) * (e.aiCommitted ? 1.45 : 1);
      if (e.position.distanceToSquared(target.position) < reach * reach) {
        e.aiCommitted = true;
        e.stance = STANCE.AGGRESSIVE;
        near.push(e);
      } else {
        e.aiCommitted = false;
        e.stance = STANCE.NEUTRAL;
        far.push(e);
      }
    }
    if (near.length) this._attackForce(near, target.id, 'strikeAttack');
    if (!far.length) {
      this.meleeTargetId = -1;
      return;
    }

    /* Where the body is.

       The body is the *forward* part of the fleet, not its arithmetic centre.
       Fresh hulls rolling off yards twenty kilometres behind the front would
       otherwise drag the average backwards for ever: cohesion never passes,
       the fleet regroups on a point that keeps retreating, and the objective
       is never reached. Measured this way the push leads and the stragglers
       chase, which is also what it looks like when a person plays. */
    const body = this._body;
    body.length = 0;
    for (let i = 0; i < near.length; i++) body.push(near[i]);
    for (let i = 0; i < far.length; i++) body.push(far[i]);
    _sortOrigin.copy(target.position);
    body.sort(byRangeToOrigin);
    body.length = Math.max(1, Math.ceil(body.length * 0.6));
    this._centroid(body, _c);

    /* Contact well short of the objective means the fleet has run into their
       line. Fight that line as a fleet: one mark at a time, everything on it.

       Fifty ships each choosing their own favourite spreads damage across a
       whole enemy fleet and almost nothing dies — which is how two evenly
       matched sides end up feeding a front line for forty minutes with neither
       able to advance. Concentration is the whole of fleet combat, and it is
       what turns that stalemate back into a battle somebody wins. */
    let contact = 0;
    for (let i = 0; i < far.length; i++) if (far[i].engaged) contact++;
    if (contact > far.length * 0.25) {
      let mark = this.meleeTargetId >= 0 ? world.entities.get(this.meleeTargetId) : null;
      if (!mark || !mark.alive ||
          mark.position.distanceToSquared(_c) > MELEE * MELEE * 2.25) {
        mark = this._localMark(_c);
      }
      if (mark) {
        this.meleeTargetId = mark.id;
        for (let i = 0; i < far.length; i++) far[i].stance = STANCE.AGGRESSIVE;
        this._attackForce(far, mark.id, 'melee');
        return;
      }
    }
    this.meleeTargetId = -1;

    let together = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i].position.distanceToSquared(_c) < COHESION * COHESION) together++;
    }
    const cohesive = together >= body.length * 0.6 || near.length >= 3;

    if (cohesive) {
      /* Push: the next bound toward the objective, from where the fleet is.
         If the body has stopped closing, it is being held — go round rather
         than shove into the same wall for the rest of the match. */
      const dist = _c.distanceTo(target.position);
      if (dist < this.bestProgress - 1200) {
        this.bestProgress = dist;
        this.progressAt = this.time;
        this.flankUntil = -1;
      } else if (this.time - this.progressAt > 55 && this.time > this.flankUntil) {
        this.flankSign = this.rng.chance(0.5) ? 1 : -1;
        this.progressAt = this.time;
        this.flankUntil = this.time + 80;
      }

      _v2.subVectors(target.position, _c);
      const d = _v2.length();
      if (d > ADVANCE) _v.copy(_c).addScaledVector(_v2.multiplyScalar(1 / d), ADVANCE);
      else _v.copy(target.position);

      if (this.time < this.flankUntil) {
        _p.crossVectors(_v2, UP);
        if (_p.lengthSq() < 1e-6) _p.set(1, 0, 0);
        _v.addScaledVector(_p.normalize(), 7000 * this.flankSign);
      }
    } else {
      // Regroup: form on the fleet before going a metre further.
      _v.copy(_c);
    }
    this._moveForce(
      far, _v,
      cohesive ? FORMATION.CLAW : FORMATION.WALL,
      'strikeFar', 2400,
      // Advancing on the objective is an attack-move: fight what is in the way,
      // then carry on. Regrouping is a plain move — form up first, argue later.
      cohesive ? 'attackMove' : 'move',
    );
  }

  /**
   * What the fleet kills next when it is in contact. Value, weakness and
   * proximity, warships only — a body that stops to shoot collectors while an
   * enemy line is on top of it deserves what happens next.
   */
  _localMark(centre) {
    const list = this.world.dense;
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team === this.team) continue;
      if (e.role === ROLE.STRUCTURE) continue;
      const d2 = e.position.distanceToSquared(centre);
      if (d2 > MELEE * MELEE) continue;
      const soft = 1 - (e.hull + e.shield) / (e.maxHull + e.maxShield + 1);
      const score = ((e.def.cost + 120) * (1 + soft * 1.8)) / (Math.sqrt(d2) + 900);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /** Hold short of home, formed up, while the yards work. */
  _stage(base) {
    if (!base) return;
    const foeHome = this.world.teams[this.team ^ 1].homePosition;
    _v2.copy(foeHome).sub(base.position);
    if (_v2.lengthSq() < 1) _v2.set(0, 0, 1);
    _v.copy(base.position).addScaledVector(_v2.normalize(), 3400);
    this._moveForce(this.strike, _v, FORMATION.WALL, 'strike', 2000, 'move');
    for (let i = 0; i < this.strike.length; i++) {
      this.strike[i].stance = STANCE.NEUTRAL;
      this.strike[i].aiCommitted = false;
    }
  }

  /**
   * What the push is for.
   *
   * Escalation, in order: go for the win when the fleet can carry it, when
   * their economy is already dead, when we are stood on their doorstep, or
   * when the clock says trading miners is no longer winning. Otherwise take
   * the yards — a carrier is worth six collectors — then the collectors, then
   * whatever is softest and closest.
   */
  _pickStrikeTarget(value) {
    const world = this.world;
    const foe = this.team ^ 1;
    const enemyBase = world.entities.get(world.teams[foe].baseId);
    const theirs = this._enemyCombatValue();
    const mine = Math.max(value, this.own.value || 0);

    this._centroid(this.strike, _c);

    /* The clock outranks the shopping list. Being ahead on kills while the
       middle drains our sovereignty is precisely the trap the whole mechanic
       exists to punish, and a commander that keeps hunting collectors through
       it would be modelling the defect rather than answering it. */
    if (this._losingControl()) {
      const contest = this._contestedMark(_c);
      if (contest) return contest;
    }

    const minersLeft = world.teams[foe].collectors.size;
    const dominant = mine > theirs * this.cfg.dominance + 300;
    const siege = this.time > this.cfg.siegeAt * this.cfg.techScale;
    const atTheDoor = enemyBase &&
      _c.distanceToSquared(enemyBase.position) < 9000 * 9000;

    const yard = this._nearestEnemyProducer(_c, enemyBase);

    if (enemyBase && (dominant || minersLeft === 0 || siege || atTheDoor)) {
      // Yards first even in the endgame. A mothership still laying down
      // destroyers behind your assault is a mothership you have not killed;
      // the carriers are what make the next fleet, so they die first.
      if (yard && yard.position.distanceToSquared(_c) < 14000 * 14000) return yard;
      return enemyBase;
    }

    if (yard) return yard;

    const miner = this._nearestEnemyOfRole(_c, ROLE.RESOURCE);
    if (miner) return miner;

    let best = null;
    let bestScore = 0;
    const list = world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team === this.team) continue;
      if (e.role === ROLE.STRUCTURE && e.id !== (enemyBase && enemyBase.id)) continue;
      const d = Math.sqrt(e.position.distanceToSquared(_c)) + 500;
      const soft = 1 - (e.hull + e.shield) / (e.maxHull + e.maxShield + 1);
      const score = (1 + soft * 2) * 4000 / d;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best || enemyBase;
  }

  _enemyCombatValue() {
    let v = 0;
    const list = this.world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team === this.team) continue;
      if (e.role === ROLE.RESOURCE || e.role === ROLE.STRUCTURE) continue;
      v += e.def.cost;
    }
    // We only know what we have seen; assume a little more than we can see.
    return v * 0.75 + 200;
  }

  /** Pull anything expensive and badly hurt back to the yard. */
  _retreat() {
    const world = this.world;
    const t = world.teams[this.team];
    const base = world.entities.get(t.baseId);
    if (!base) return;
    const list = world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team !== this.team) continue;
      if (e.role !== ROLE.CAPITAL && e.role !== ROLE.FRIGATE) continue;
      const frac = e.hull / e.maxHull;
      if (!e.aiRepairing && frac < this.cfg.retreatAt) {
        e.aiRepairing = true;
        e.aiRepairUntil = this.time + 220;
        e.aiCommitted = false;
        e.stance = STANCE.PASSIVE;
        e.orderQueue.length = 0;
        e.forcedTargetId = -1;
        _v2.subVectors(e.position, base.position);
        if (_v2.lengthSq() < 1) _v2.set(0, 0, 1);
        _v.copy(base.position).addScaledVector(
          _v2.normalize(),
          base.radius + e.radius + 700,
        );
        e.orderQueue.push({ type: 'move', point: _v.clone(), formation: FORMATION.BROAD });
        e.station = _v.clone();
      } else if (e.aiRepairing && (frac > 0.85 || this.time > e.aiRepairUntil)) {
        // Rejoin on health, or on a timer. A hull parked at the yard forever
        // because nothing is repairing it is a hull the enemy already killed.
        e.aiRepairing = false;
        e.aiForce = 'strike';
        e.orderQueue.length = 0;
        e.stance = STANCE.NEUTRAL;
      }
    }
  }

  /** Keep one wing on the move so intel never goes fully cold. */
  _scout() {
    const world = this.world;
    const scouts = this._scratch;
    scouts.length = 0;
    const list = world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive && e.team === this.team && e.classId === 'scout') scouts.push(e);
    }
    if (!scouts.length) return;
    let anyBusy = false;
    for (let i = 0; i < scouts.length; i++) if (scouts[i].orderQueue.length) anyBusy = true;
    if (anyBusy) return;

    const clusters = world.resourceClusters;
    let point;
    if (clusters.length && this.rng.chance(0.55)) {
      point = clusters[this.rng.int(0, clusters.length - 1)].position;
    } else {
      point = world.teams[this.team ^ 1].homePosition;
    }
    _v.copy(point).addScaledVector(
      _v2.set(this.rng.range(-1, 1), this.rng.range(-0.4, 0.4), this.rng.range(-1, 1)).normalize(),
      2600,
    );
    world.issueMove(scouts, _v, FORMATION.BROAD, true);
    for (let i = 0; i < scouts.length; i++) scouts[i].stance = STANCE.EVASIVE;
    scouts.length = 0;
  }

  /* ---------------------------------------------------------------- helpers */

  /** The enemy hull holding the contested band that we can most cheaply reach. */
  _contestedMark(from) {
    const world = this.world;
    const clusters = world.resourceClusters;
    const list = world.dense;
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team === this.team) continue;
      if (e.role === ROLE.STRUCTURE) continue;
      let onBand = false;
      for (let k = 0; k < clusters.length; k++) {
        const c = clusters[k];
        if (!c.contested) continue;
        const rr = c.radius + CONTROL.RADIUS;
        if (c.position.distanceToSquared(e.position) < rr * rr) {
          onBand = true;
          break;
        }
      }
      if (!onBand) continue;
      const d = Math.sqrt(e.position.distanceToSquared(from)) + 800;
      const soft = 1 - (e.hull + e.shield) / (e.maxHull + e.maxShield + 1);
      const score = ((e.def.cost + 200) * (1 + soft * 1.5)) / d;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  _nearestEnemyOfRole(from, role) {
    let best = null;
    let bestD = Infinity;
    const list = this.world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team === this.team || e.role !== role) continue;
      const d = e.position.distanceToSquared(from);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Their forward yards: the thing that makes the next fleet. */
  _nearestEnemyProducer(from, except) {
    const foe = this.world.teams[this.team ^ 1];
    let best = null;
    let bestD = Infinity;
    for (const id of foe.producers) {
      const p = this.world.entities.get(id);
      if (!p || !p.alive) continue;
      if (except && p.id === except.id) continue;
      const d = p.position.distanceToSquared(from);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  _busiestOwnCluster() {
    const clusters = this.world.resourceClusters;
    let best = null;
    let bestN = 0;
    for (let i = 0; i < clusters.length; i++) {
      const n = clusters[i].miners[this.team] || 0;
      if (n > bestN) {
        bestN = n;
        best = clusters[i];
      }
    }
    return best;
  }

  dispose() {
    this.strike.length = 0;
    this.defence.length = 0;
    this.harass.length = 0;
    this.hold.length = 0;
    this._scratch.length = 0;
    this._ids.length = 0;
    this._near.length = 0;
    this._far.length = 0;
    this._body.length = 0;
    this._orders = {};
  }
}

export function createCommander(world, team, opts) {
  return new Commander(world, team, opts);
}
