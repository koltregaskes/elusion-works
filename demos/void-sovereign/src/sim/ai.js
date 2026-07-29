import * as THREE from '../../vendor/three/build/three.module.js';
import { SHIPS, ROLE, CLASS_IDS } from '../ships/catalog.js';
import { canBuild, enqueueBuild, cancelBuild } from './economy.js';
import { dpsAgainst, STANCE } from './combat.js';
import { FORMATION } from './formations.js';

/* The enemy commander.

   Not a script. It runs an economy, keeps a picture of what it has actually
   seen, buys the counter to it, and holds its fleet back until the fleet is
   worth committing. The three things that make it read as a player rather than
   a spawner are: it harasses collectors early, it masses before it attacks,
   and it pulls wounded capitals out of the line.

   No resource cheating at 'normal'. */

const DIFFICULTY = {
  easy: {
    think: 2.6, commitScale: 1.75, collectors: 5, harassAt: 200,
    income: 0.9, buildRate: 0.85, retreatAt: 0.45, techScale: 1.35, sloppiness: 0.35,
  },
  normal: {
    think: 1.4, commitScale: 1.0, collectors: 8, harassAt: 78,
    income: 1.0, buildRate: 1.0, retreatAt: 0.34, techScale: 1.0, sloppiness: 0.12,
  },
  hard: {
    think: 0.8, commitScale: 0.72, collectors: 11, harassAt: 52,
    income: 1.15, buildRate: 1.15, retreatAt: 0.28, techScale: 0.8, sloppiness: 0.0,
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

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Commander {
  constructor(world, team, opts = {}) {
    this.world = world;
    this.team = team;
    this.difficulty = opts.difficulty || 'normal';
    this.cfg = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
    this.rng = world.rngAi.fork(team + 1);

    const t = world.teams[team];
    t.incomeScale = this.cfg.income;
    t.buildRate = this.cfg.buildRate;

    this.timer = this.rng.range(0, 0.6);
    this.intel = {};
    for (let i = 0; i < COMBAT_ROLES.length; i++) this.intel[COMBAT_ROLES[i]] = 0;
    this.intel[ROLE.RESOURCE] = 0;
    this.intel[ROLE.STRUCTURE] = 0;

    this.own = {};
    this.strike = [];
    this.defence = [];
    this.harass = [];
    this.strikeTargetId = -1;
    this.strikePoint = new THREE.Vector3();
    this.phase = 'rally';
    this.phaseDeadline = 0;
    this.committed = false;
    this.harassSent = false;
    this.expandCluster = -1;
    this.lastDefenceCall = -999;
    this.defencePoint = new THREE.Vector3();
    this._scratch = [];
  }

  get state() {
    return {
      committed: this.committed,
      strike: this.strike.length,
      defence: this.defence.length,
      harass: this.harass.length,
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
     the fleet stays tiny — which is exactly what the second soak run did. So
     production is planned per yard: the mothership lays down capitals while the
     carriers pump strike craft, the way the genre has always worked. */
  _production() {
    const world = this.world;
    const t = world.teams[this.team];

    // Population headroom first: a fleet with nowhere to live is no fleet.
    // Yards are expensive — the first soak run proved the AI will cheerfully
    // buy seven — so the cap only lifts when the treasury is genuinely idle.
    const head = t.popCap - t.popUsed - t.popQueued;
    const carriers = (this.own.carrier || 0) + this._queuedCount('carrier');
    const maxCarriers = t.credits > 14000 ? 4 : 2;
    if (head < 12 && carriers < maxCarriers &&
        this.time > TECH_GATE.carrier * this.cfg.techScale &&
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

  _assignForces() {
    this.strike.length = 0;
    this.defence.length = 0;
    this.harass.length = 0;

    const list = this.world.dense;
    const wantDefence = Math.max(2, Math.round(this.own.combat * 0.22));
    let defenceCount = 0;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team !== this.team) continue;
      if (e.role === ROLE.RESOURCE || e.role === ROLE.STRUCTURE) continue;
      if (e.classId === 'scout') {
        e.aiForce = 'scout';
        continue;
      }
      if (e.aiForce === 'harass' && this.harassSent) {
        this.harass.push(e);
        continue;
      }
      if (e.aiRepairing) {
        continue;
      }
      if (defenceCount < wantDefence && e.role !== ROLE.CAPITAL) {
        e.aiForce = 'defence';
        this.defence.push(e);
        defenceCount++;
        continue;
      }
      e.aiForce = 'strike';
      this.strike.push(e);
    }
  }

  _forceValue(force) {
    let v = 0;
    for (let i = 0; i < force.length; i++) v += force[i].def.cost;
    return v;
  }

  /* ------------------------------------------------------------- behaviours */

  /** Early fighters go for the throat: their collectors, not their warships. */
  _harass() {
    if (this.harassSent) {
      if (this.harass.length === 0) {
        this.harassSent = false;
        return;
      }
      const mark = this._nearestEnemyOfRole(this.harass[0].position, ROLE.RESOURCE);
      if (mark) {
        this.world.commandAttack({ ids: idsOf(this.harass), targetId: mark.id });
        for (let i = 0; i < this.harass.length; i++) this.harass[i].stance = STANCE.AGGRESSIVE;
      } else {
        this.harassSent = false;
        for (let i = 0; i < this.harass.length; i++) this.harass[i].aiForce = 'strike';
      }
      return;
    }
    if (this.time < this.cfg.harassAt) return;

    const pool = [];
    for (let i = 0; i < this.strike.length; i++) {
      const e = this.strike[i];
      if (e.role === ROLE.FIGHTER && e.classId !== 'bomber') pool.push(e);
      if (pool.length >= 5) break;
    }
    if (pool.length < 3) return;
    for (let i = 0; i < pool.length; i++) pool[i].aiForce = 'harass';
    this.harass = pool;
    this.harassSent = true;
  }

  /** Somebody is shooting our miners: send the standing defence force. */
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

    if (alarm) {
      this.defencePoint.copy(alarm.position);
      this.lastDefenceCall = this.time;
      const attacker = world.entities.get(alarm.lastAttackerId);
      if (attacker && attacker.alive) {
        world.commandAttack({ ids: idsOf(this.defence), targetId: attacker.id });
      } else {
        world.issueMove(this.defence, this.defencePoint, FORMATION.CLAW, true);
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
    let far = 0;
    for (let i = 0; i < this.defence.length; i++) {
      const d = this.defence[i].position.distanceToSquared(_v);
      if (d > far) far = d;
    }
    if (far > 4200 * 4200) {
      world.issueMove(this.defence, _v, FORMATION.SPHERE, true);
      for (let i = 0; i < this.defence.length; i++) this.defence[i].stance = STANCE.NEUTRAL;
    }
  }

  /** Mass, choose, commit. Do not trickle. */
  _strike() {
    const world = this.world;
    if (!this.strike.length) return;
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
        // Hold short of home while the yards work.
        if (base && this.rng.chance(0.25)) {
          _v.copy(base.position).addScaledVector(
            _v2.copy(world.teams[this.team ^ 1].homePosition).sub(base.position).normalize(),
            3000,
          );
          world.issueMove(this.strike, _v, FORMATION.WALL, true);
          for (let i = 0; i < this.strike.length; i++) this.strike[i].stance = STANCE.NEUTRAL;
        }
        return;
      }
      this.committed = true;
      this.phase = 'rally';
      this.phaseDeadline = this.time + 100;
      this.strikeTargetId = -1;
    }

    // Fall back home if the push has been ground down.
    if (value < need * 0.38) {
      this.committed = false;
      this.strikeTargetId = -1;
      if (base) world.issueMove(this.strike, base.position, FORMATION.DELTA, true);
      return;
    }

    let target = this.strikeTargetId >= 0 ? world.entities.get(this.strikeTargetId) : null;
    if (!target || !target.alive) {
      target = this._pickStrikeTarget(value);
      this.phase = 'rally';
      this.phaseDeadline = this.time + 100;
    }
    if (!target) return;
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
        if (this.strike[i].position.distanceToSquared(this.strikePoint) < 4000 * 4000) ready++;
      }
      if (ready >= this.strike.length * 0.7 || this.time > this.phaseDeadline) {
        this.phase = 'assault';
      } else {
        world.issueMove(this.strike, this.strikePoint, FORMATION.WALL, true);
        for (let i = 0; i < this.strike.length; i++) this.strike[i].stance = STANCE.NEUTRAL;
        return;
      }
    }

    // Assault: anything in reach engages, stragglers and fresh hulls close up.
    const near = [];
    const far = [];
    for (let i = 0; i < this.strike.length; i++) {
      const e = this.strike[i];
      e.stance = STANCE.AGGRESSIVE;
      const reach = e.engageRange + target.radius + 3000;
      if (e.position.distanceToSquared(target.position) < reach * reach) near.push(e);
      else far.push(e);
    }
    if (near.length) world.commandAttack({ ids: idsOf(near), targetId: target.id });
    if (far.length) world.issueMove(far, target.position, FORMATION.CLAW, true);
  }

  _pickStrikeTarget(value) {
    const world = this.world;
    const foe = this.team ^ 1;
    const enemyBase = world.entities.get(world.teams[foe].baseId);
    const enemyValue = this._enemyCombatValue();

    _v.set(0, 0, 0);
    for (let i = 0; i < this.strike.length; i++) _v.add(this.strike[i].position);
    _v.multiplyScalar(1 / this.strike.length);

    // Go for the win when the fleet can carry it, or when their economy is
    // already dead and there is nothing left worth strangling.
    const minersLeft = world.teams[foe].collectors.size;
    if (enemyBase && (value > enemyValue * 1.25 + 700 || minersLeft === 0)) return enemyBase;

    // Otherwise strangle the economy or crack the weakest formation.
    const miner = this._nearestEnemyOfRole(_v, ROLE.RESOURCE);
    if (miner) return miner;

    let best = null;
    let bestScore = 0;
    const list = world.dense;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team === this.team) continue;
      if (e.role === ROLE.STRUCTURE && e.id !== (enemyBase && enemyBase.id)) continue;
      const d = Math.sqrt(e.position.distanceToSquared(_v)) + 500;
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
        e.stance = STANCE.PASSIVE;
        e.orderQueue.length = 0;
        e.forcedTargetId = -1;
        _v.copy(base.position).addScaledVector(
          _v2.subVectors(e.position, base.position).normalize(),
          base.radius + e.radius + 700,
        );
        e.orderQueue.push({ type: 'move', point: _v.clone(), formation: FORMATION.BROAD });
        e.station = _v.clone();
      } else if (e.aiRepairing && (frac > 0.85 || this.time > e.aiRepairUntil)) {
        // Rejoin on health, or on a timer. A hull parked at the yard forever
        // because nothing is repairing it is a hull the enemy already killed.
        e.aiRepairing = false;
        e.stance = STANCE.NEUTRAL;
      }
    }
  }

  /** Keep one wing on the move so intel never goes fully cold. */
  _scout() {
    const world = this.world;
    const scouts = [];
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
  }

  /* ---------------------------------------------------------------- helpers */

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
    this._scratch.length = 0;
  }
}

function idsOf(list) {
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i++) out[i] = list[i].id;
  return out;
}

export function createCommander(world, team, opts) {
  return new Commander(world, team, opts);
}
