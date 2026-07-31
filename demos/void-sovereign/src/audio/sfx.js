/* Event-driven sound effects.

   Three responsibilities, in order of how much they matter:

   1. ORDER FEEDBACK. Every player command answers within a millisecond of the
      click. These fire on `cmd:*` and `sel:changed` — the *input* events, which
      input.js emits synchronously on pointer-up — not on the sim result. The sim
      is 33 ms away and the perception threshold is 85–100 ms, so the sound has
      already covered the gap before the ships have finished turning. Nine
      distinct confirmations, all identifiable without looking at the screen.

   2. COMBAT, SCALED. A mothership battery and an interceptor autocannon are not
      the same event. Weapon sounds key off WEAPON_TYPE and off the firing hull's
      length, attenuate and dull with distance, and — critically — coalesce. A
      thousand ships firing at 6 Hz is six thousand events a second; what reaches
      the mixer is a handful of chattering clusters at the right places in the
      stereo field, which is also how a real battle actually sounds.

   3. WEIGHT. A capital death is a staged sequence with subsonic content and a
      six-second tail, and it ducks the entire rest of the mix while it happens.
      That contrast is the whole point: nothing else in the game is allowed to be
      that loud. Its beats are *driven by `fx:blast`*, not by a copy of the FX
      beat table — see `_onBlast`. The previous version mirrored
      `fx/explosions.js`'s internal script and silently went two seconds out of
      sync the moment FX re-cut it.

   Ambience is deliberately almost nothing — a brown-noise floor two dozen dB
   under everything, a hull resonance that only appears when the camera is
   genuinely close to a friendly ship, and silence at strategic zoom. */

import { bus } from '../core/events.js';
import { SHIPS, WEAPON_TYPE } from '../ships/catalog.js';
import {
  blip, adsr, sweep, noiseSource, driveCurve, harmonicWave, clamp, lerp, smoothstep, safeDisconnect,
} from './synth.js';

/* A hull this long or longer fires "capital" ordnance: individual, slow, heavy. */
const CAPITAL_LENGTH = 200;

/* Coalescing windows. Longer windows mean fewer, denser sounds — which is what
   a distant firefight is. Shorter windows keep close-quarters fire articulate. */
const BUCKETS = {
  kineticSmall: { window: 0.075, radius: 1500, maxDist: 9500, priority: 2, cap: 6 },
  flak: { window: 0.100, radius: 1700, maxDist: 11000, priority: 2, cap: 5 },
  missile: { window: 0.055, radius: 1300, maxDist: 15000, priority: 3, cap: 4 },
  impactHull: { window: 0.090, radius: 1300, maxDist: 9000, priority: 2, cap: 5 },
  impactShield: { window: 0.090, radius: 1300, maxDist: 9000, priority: 2, cap: 4 },
};

/* Per-category concurrency, checked before the global pool. Stops one loud
   category from eating the whole budget during its own moment. */
const CATEGORY_CAP = { ion: 3, beam: 4, capitalGun: 6, death: 8, capitalDeath: 3 };

/* Rate limits in events per second. */
const RATE = { capitalGun: 14, spawn: 3, resource: 0.5 };

/* Ambience levels. Both are deliberately tiny: the loudest thing in the game is
   about 45 dB above the void floor, and that headroom is the whole aesthetic. */
const VOID_LEVEL = 0.012;
const HULL_LEVEL = 0.09;

/* ------------------------------------------------------------ death sessions */

/* FX publishes `{ point, radius, strength }` on every beat of a death that is
   meant to be *felt* — each secondary, the buckle, the primary. That channel is
   the contract; how `strength` is normalised across hull sizes is not.
   Mid-refactor it changed from (L/380)^1.5 to (L/380)^0.8 under a parallel
   agent, which silently demoted a mothership's detonation to a secondary in an
   earlier draft of this file that had the old exponent baked in.
   So nothing here knows the normalisation.

   Instead each session measures its *own* unit — the smallest beat it has heard,
   which is always one of the walking secondaries — and classifies everything
   against that. Every beat in one death carries the same hull factor, so those
   ratios survive any rescaling: measured, a capital's primary is 15.6× its unit
   and its buckle 3.7×, a frigate's primary 6.3×. The thresholds sit in the gaps.

   The one absolute is a hard floor that keeps a distant fighter's pop from being
   read as part of a capital's death. */
const BLAST = { hardFloor: 0.0025, unitFloor: 0.4, buckle: 2.2, primary: 4.5 };

/* `radius` is the blast's physical reach in metres, and every beat of one death
   carries a reach set by the hull that is dying — measured at 1.4–1.9× its
   length across secondaries, buckle and primary alike. That makes it the way to
   tell whose beat this is: without the check, a corvette dying inside a
   destroyer's match radius drags the session's unit down to its own 0.01, and
   the destroyer's very next secondary reads as 7× the unit and detonates the
   ship two seconds early. Observed, not hypothetical.

   Measured, every beat of one death reports 1.4–1.9× the hull's length, so the
   band below both clears its own sequence with margin and excludes a frigate's
   beats from a destroyer's session. */
const BLAST_RADIUS_BAND = { min: 0.8, max: 3.5 };

/* A session past its detonation is in its tail. If another hull dies close by,
   its sequence belongs to the newer session, not the one that is finishing. */
const SPENT_SESSION_PENALTY = 6;

/* If FX never speaks — disabled, or a quality mode that drops the sequence —
   the death still has to land. One compact detonation, not a fabricated script.
   Anything longer than this and the player has already stopped believing it. */
const UNATTENDED_AFTER = 0.6;

/* A session cannot know how long it will run — that is the whole point — so it
   reserves modestly and extends as beats arrive. Reserving the maximum up front
   starves both the category cap and the voice pool: in a staged 200-ship battle
   that cost 40% of the deaths and took the limiter out of the mix entirely. */
const SESSION_INITIAL = { capital: 5, break: 4.5 };
/* Generous enough to ride out a frame stall between beats — losing the session
   mid-sequence costs the detonation, which is the one thing that must land. */
const SESSION_EXTEND = 3.2;
/* Hard stops. A session that never sees its primary must not drone forever. */
const SESSION_MAX = 13;
const PRIMARY_DEADLINE = 9.5;

/* An ion lance emits on the same channel with no hull-length term (~0.16), which
   would read as a buckle inside a nearby capital's session. We already voice the
   lance from `sim:fire`, so mark it and let the router step over it. */
const ION_MARK_WINDOW = 0.3;
const ION_MARK_DIST2 = 500 * 500;

/** Growing cluster of near-simultaneous events at roughly one place. */
class Cluster {
  constructor() {
    this.n = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.size = 0;
    this.weight = 0;
  }
}

class Coalescer {
  constructor(cfg) {
    this.cfg = cfg;
    this.r2 = cfg.radius * cfg.radius;
    this.clusters = [];
    this.due = 0;
    this.dropped = 0;
  }

  add(now, x, y, z, size, weight) {
    if (this.clusters.length === 0) this.due = now + this.cfg.window;
    for (let i = 0; i < this.clusters.length; i++) {
      const c = this.clusters[i];
      const cx = c.x / c.n;
      const cy = c.y / c.n;
      const cz = c.z / c.n;
      const dx = cx - x;
      const dy = cy - y;
      const dz = cz - z;
      if (dx * dx + dy * dy + dz * dz < this.r2) {
        c.n++;
        c.x += x;
        c.y += y;
        c.z += z;
        c.weight += weight;
        if (size > c.size) c.size = size;
        return;
      }
    }
    if (this.clusters.length >= 3) {
      // Beyond three simultaneous fronts the ear cannot separate them anyway;
      // fold the overflow into the first so its density still counts.
      const c = this.clusters[0];
      c.n++;
      c.x += x;
      c.y += y;
      c.z += z;
      c.weight += weight;
      this.dropped++;
      return;
    }
    const c = new Cluster();
    c.n = 1;
    c.x = x;
    c.y = y;
    c.z = z;
    c.size = size;
    c.weight = weight;
    this.clusters.push(c);
  }

  take(now) {
    if (this.clusters.length === 0 || now < this.due) return null;
    const out = this.clusters;
    this.clusters = [];
    return out;
  }
}

export class SfxLayer {
  constructor(audio, rng) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.rng = rng;
    this._offs = [];
    this._started = false;
    this._active = { ion: 0, beam: 0, capitalGun: 0, death: 0, capitalDeath: 0 };
    this._last = { capitalGun: 0, spawn: 0, resource: 0, toast: 0 };
    this._counts = { fire: 0, played: 0, culled: 0 };

    /* Open death sequences waiting on `fx:blast` to tell them what happens next. */
    this._sessions = [];
    this._sessionSeq = 1;
    this._ionMarks = [];
    this._blastStats = {
      blasts: 0, matched: 0, ignored: 0, sessions: 0,
      secondaries: 0, buckles: 0, primaries: 0, unattended: 0, expired: 0,
      lastOpenedAt: 0, lastPrimaryAt: 0, lastPrimaryDelay: 0,
    };

    this.buckets = {};
    for (const k of Object.keys(BUCKETS)) this.buckets[k] = new Coalescer(BUCKETS[k]);

    // Engagement heat, read by music.js to decide whether we are in a battle.
    this.heat = 0;
    this.threat = 0;
    this._hullNear = 0;
    this._hullSize = 0;
    this._scanAcc = 0;

    this._drive = driveCurve(3.2);
    this._hardDrive = driveCurve(9);
    this._metalWave = harmonicWave(this.ctx, [1, 0.62, 0.31, 0.44, 0.16, 0.21, 0.09]);
    this._bellWave = harmonicWave(this.ctx, [1, 0.06, 0.34, 0.02, 0.19, 0.01, 0.08, 0.05]);

    this._subscribe();
  }

  /* ------------------------------------------------------------ event wiring */

  _subscribe() {
    const on = (t, fn) => this._offs.push(bus.on(t, fn));

    /* --- order feedback: fired on input, ahead of the sim --- */
    on('sel:changed', (p) => this._onSelect(p));
    on('cmd:move', (p) => this.order(p && p.queue ? 'moveQueued' : 'move', p));
    on('cmd:attack', (p) => this.order('attack', p));
    /* A/G/P/S are single keypresses that issue an order at the cursor with no
       confirming click, so their sound is the *only* thing that says which verb
       just went out. They get four unmistakably different shapes. */
    on('cmd:attackMove', (p) => this.order('attackMove', p));
    on('cmd:guard', (p) => this.order('guard', p));
    on('cmd:patrol', (p) => this.order('patrol', p));
    on('cmd:stop', (p) => this.order('stop', p));
    on('cmd:formation', () => this.order('formation'));
    on('cmd:stance', (p) => this.order('stance', p));
    on('cmd:build', (p) => this._onBuild(p));
    on('cmd:cancelBuild', () => this.order('cancel'));

    /* --- sim results --- */
    on('sim:fire', (p) => this._onFire(p));
    on('sim:damage', (p) => this._onDamage(p));
    on('sim:death', (p) => this._onDeath(p));
    on('sim:spawn', (p) => this._onSpawn(p));
    on('sim:buildComplete', (p) => this._onBuildComplete(p));
    on('sim:resourceChanged', (p) => this._onResource(p));
    on('sim:gameOver', (p) => this._onGameOver(p));

    /* --- the picture. Death beats are taken from FX rather than predicted. --- */
    on('fx:blast', (p) => this._onBlast(p));

    /* --- interface --- */
    on('ui:sensorsToggle', (p) => this.order(p && p.open ? 'sensorsOpen' : 'sensorsClose'));
    on('ui:speed', () => this.order('speed'));
    on('ui:focus', () => this.order('focus'));
    on('ui:toast', () => this._onToast());
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._buildAmbience();
  }

  /* ------------------------------------------------------------ order sounds */

  /**
   * Immediate, non-positional command confirmation.
   * @param {string} kind one of the ORDER keys below
   */
  order(kind, payload) {
    if (!this.audio.running) return false;
    const t = this.ctx.currentTime + 0.001;
    switch (kind) {
      case 'select': return this._select(t, payload);
      case 'move': return this._move(t, 0);
      case 'moveQueued': return this._move(t, 1);
      case 'attack': return this._attack(t, payload);
      case 'attackMove': return this._attackMove(t, payload);
      case 'guard': return this._guard(t, payload);
      case 'patrol': return this._patrol(t, payload);
      case 'stop': return this._stop(t);
      case 'formation': return this._formation(t);
      case 'stance': return this._stance(t, payload);
      case 'queued': return this._queued(t);
      case 'complete': return this._complete(t);
      case 'reject': return this._reject(t);
      case 'cancel': return this._cancel(t);
      case 'sensorsOpen': return this._sensors(t, true);
      case 'sensorsClose': return this._sensors(t, false);
      case 'speed': return this._tick(t, 1500, 0.16);
      case 'focus': return this._tick(t, 900, 0.10);
      case 'toast': return this._tick(t, 1320, 0.13);
      default: return false;
    }
  }

  /** Selection: a clipped double-tick. Pitch drops as the selected fleet grows. */
  _select(t, payload) {
    const ids = payload && payload.ids ? payload.ids : [];
    if (!ids.length) return false;
    const mass = this._selectionMass(ids);
    const base = lerp(1420, 760, clamp(mass, 0, 1));
    const v = this._claimUi(0.14);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const srcs = [];
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = base * (i === 0 ? 1 : 1.5);
      const a = this.ctx.createGain();
      blip(a.gain, t + i * 0.028, 0.34 * (i === 0 ? 1 : 0.55), 0.002, 0.05);
      o.connect(a);
      a.connect(g);
      o.start(t + i * 0.028);
      o.stop(t + i * 0.028 + 0.09);
      srcs.push(o);
    }
    // A hairline of noise gives the tick an edge; a pure sine reads as a phone.
    const n = this._noise(t, 'white', 0.9);
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = base * 2.4;
    nf.Q.value = 2.2;
    const ng = this.ctx.createGain();
    blip(ng.gain, t, 0.11, 0.001, 0.022);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(g);
    n.start(t);
    n.stop(t + 0.05);
    srcs.push(n);
    v.bind(g, srcs);
    return true;
  }

  /** Move: a soft falling two-note. The friendliest sound in the set. */
  _move(t, queued) {
    const v = this._claimUi(0.34);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const notes = queued ? [740, 740, 988] : [932, 622];
    const srcs = [];
    for (let i = 0; i < notes.length; i++) {
      const at = t + i * (queued ? 0.055 : 0.062);
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(notes[i], at);
      const a = this.ctx.createGain();
      blip(a.gain, at, 0.40 * (i === 0 ? 1 : 0.78), 0.004, 0.11);
      o.connect(a);
      a.connect(g);
      o.start(at);
      o.stop(at + 0.16);
      srcs.push(o);
    }
    v.bind(g, srcs);
    return true;
  }

  /** Attack: harder, lower, saturated. Reads as an instruction, not a chime. */
  _attack(t, payload) {
    const v = this._claimUi(0.26);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._drive;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1100, t);
    bp.frequency.exponentialRampToValueAtTime(430, t + 0.12);
    bp.Q.value = 1.6;
    g.connect(shaper);
    shaper.connect(bp);
    bp.connect(this.audio.buses.ui.input);

    const srcs = [];
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      sweep(o.frequency, t, 560 * (1 + i * 0.006), 300, 0.11);
      const a = this.ctx.createGain();
      blip(a.gain, t, 0.19, 0.002, 0.13);
      o.connect(a);
      a.connect(g);
      o.start(t);
      o.stop(t + 0.2);
      srcs.push(o);
    }
    const n = this._noise(t, 'white', 1.2);
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 1800;
    const ng = this.ctx.createGain();
    blip(ng.gain, t, 0.16, 0.001, 0.03);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(g);
    n.start(t);
    n.stop(t + 0.06);
    srcs.push(n);
    if (payload && payload.queue) this._queueTick(g, srcs, t + 0.15);
    v.bind(g, srcs);
    return true;
  }

  /**
   * Attack-move: the move gesture with the attack's teeth. The falling pair
   * says "go there", a saturated stab under the second note says "and shoot".
   * Neither half alone is either sound, which is the point — it must not be
   * mistaken for a plain move when it is the order that starts the battle.
   */
  _attackMove(t, payload) {
    const v = this._claimUi(0.42);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const srcs = [];

    // Falling pair, a fourth below the plain move so the two never confuse.
    const notes = [698, 466];
    for (let i = 0; i < notes.length; i++) {
      const at = t + i * 0.07;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(notes[i], at);
      const a = this.ctx.createGain();
      blip(a.gain, at, 0.34 * (i === 0 ? 1 : 0.82), 0.004, 0.11);
      o.connect(a);
      a.connect(g);
      o.start(at);
      o.stop(at + 0.17);
      srcs.push(o);
    }

    // The teeth: a short saturated stab arriving with the second note.
    const stabAt = t + 0.07;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._drive;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    sweep(bp.frequency, stabAt, 900, 380, 0.1);
    bp.Q.value = 1.7;
    shaper.connect(bp);
    bp.connect(g);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    sweep(o.frequency, stabAt, 466, 300, 0.1);
    const a = this.ctx.createGain();
    blip(a.gain, stabAt, 0.17, 0.002, 0.11);
    o.connect(a);
    a.connect(shaper);
    o.start(stabAt);
    o.stop(stabAt + 0.18);
    srcs.push(o);

    if (payload && payload.queue) this._queueTick(g, srcs, t + 0.21);
    v.bind(g, srcs);
    return true;
  }

  /**
   * Guard: the only sustained order in the palette. A held fifth with a slow
   * tremolo — nothing decays, because nothing is going anywhere.
   */
  _guard(t, payload) {
    const v = this._claimUi(0.6);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const srcs = [];
    const freqs = [349, 523];
    for (let i = 0; i < freqs.length; i++) {
      const o = this.ctx.createOscillator();
      o.setPeriodicWave(this._metalWave);
      o.frequency.value = freqs[i];
      const a = this.ctx.createGain();
      adsr(a.gain, t, {
        peak: 0.20 * (i === 0 ? 1 : 0.7), attack: 0.014, decay: 0.05,
        sustain: 0.78, hold: 0.24, release: 0.16,
      });
      o.connect(a);
      a.connect(g);
      o.start(t);
      o.stop(t + 0.55);
      srcs.push(o);
    }
    // Tremolo: a held dyad without it reads as a stuck note rather than a watch.
    const trem = this.ctx.createOscillator();
    trem.type = 'sine';
    trem.frequency.value = 7.5;
    const tremAmt = this.ctx.createGain();
    tremAmt.gain.value = 0.22;
    trem.connect(tremAmt);
    tremAmt.connect(g.gain);
    trem.start(t);
    trem.stop(t + 0.55);
    srcs.push(trem);
    if (payload && payload.queue) this._queueTick(g, srcs, t + 0.42);
    v.bind(g, srcs);
    return true;
  }

  /** Patrol: there and back again. A closed loop, so the figure returns home. */
  _patrol(t, payload) {
    const v = this._claimUi(0.4);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    g.connect(lp);
    lp.connect(this.audio.buses.ui.input);
    const srcs = [];
    const notes = [587, 784, 587];
    for (let i = 0; i < notes.length; i++) {
      const at = t + i * 0.072;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(notes[i], at);
      const a = this.ctx.createGain();
      blip(a.gain, at, 0.26 * (i === 1 ? 1 : 0.86), 0.003, 0.075);
      o.connect(a);
      a.connect(g);
      o.start(at);
      o.stop(at + 0.13);
      srcs.push(o);
    }
    if (payload && payload.queue) this._queueTick(g, srcs, t + 0.29);
    v.bind(g, srcs);
    return true;
  }

  /** Stop: one damped thud with no tail. The sound of something being put down. */
  _stop(t) {
    const v = this._claimUi(0.28);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const srcs = [];
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    sweep(o.frequency, t, 208, 96, 0.07);
    const a = this.ctx.createGain();
    blip(a.gain, t, 0.42, 0.002, 0.085);
    o.connect(a);
    a.connect(g);
    o.start(t);
    o.stop(t + 0.16);
    srcs.push(o);
    // A chuff of noise closing fast: the damping is what makes it a full stop.
    const n = this._noise(t, 'white', 0.8);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    sweep(lp.frequency, t, 2600, 320, 0.06);
    const ng = this.ctx.createGain();
    blip(ng.gain, t, 0.20, 0.001, 0.05);
    n.connect(lp);
    lp.connect(ng);
    ng.connect(g);
    n.start(t, this.rng.range(0, 1.5));
    n.stop(t + 0.12);
    srcs.push(n);
    v.bind(g, srcs);
    return true;
  }

  /** Shared "…and it is on the end of the queue" marker. */
  _queueTick(dest, srcs, t) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 1568;
    const a = this.ctx.createGain();
    blip(a.gain, t, 0.10, 0.001, 0.03);
    o.connect(a);
    a.connect(dest);
    o.start(t);
    o.stop(t + 0.06);
    srcs.push(o);
  }

  /** Formation: a three-step mechanical ratchet. Nothing else clicks like it. */
  _formation(t) {
    const v = this._claimUi(0.2);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    g.connect(lp);
    lp.connect(this.audio.buses.ui.input);
    const srcs = [];
    const steps = [820, 1030, 1290];
    for (let i = 0; i < steps.length; i++) {
      const at = t + i * 0.037;
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = steps[i];
      const a = this.ctx.createGain();
      blip(a.gain, at, 0.24, 0.0012, 0.021);
      o.connect(a);
      a.connect(g);
      o.start(at);
      o.stop(at + 0.05);
      srcs.push(o);
    }
    v.bind(g, srcs);
    return true;
  }

  /**
   * Stance: a two-note dyad whose interval encodes the stance.
   *
   * Deliberately soft, low and slow. Measured against the rest of the palette it
   * was 0.94 cosine-similar to `formation` — both were short bright tonal
   * clusters in the same octave, which is exactly the confusion the player would
   * make. A posture is not a mechanism: this one swells under a lowpass instead
   * of clicking, which moves it two octaves down the spectrum and out of the way.
   */
  _stance(t, payload) {
    const v = this._claimUi(0.5);
    if (!v) return false;
    const name = payload && payload.stance ? String(payload.stance) : 'default';
    // Stable per-name interval so a given stance always sounds the same.
    const table = { aggressive: 7, evasive: -5, neutral: 0, passive: -12, hold: 3, guard: 5 };
    let semis = table[name];
    if (semis === undefined) {
      let h = 0;
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
      semis = ((h % 13) + 13) % 13 - 6;
    }
    const root = 294;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1900;
    lp.Q.value = 0.7;
    g.connect(lp);
    lp.connect(this.audio.buses.ui.input);
    const srcs = [];
    const freqs = [root, root * Math.pow(2, semis / 12)];
    for (let i = 0; i < freqs.length; i++) {
      const at = t + i * 0.065;
      const o = this.ctx.createOscillator();
      o.setPeriodicWave(this._bellWave);
      o.frequency.setValueAtTime(freqs[i], at);
      // A touch of settle on the second note: the fleet taking up a posture.
      o.detune.setValueAtTime(i ? 6 : 0, at);
      o.detune.linearRampToValueAtTime(i ? -7 : 0, at + 0.3);
      const a = this.ctx.createGain();
      blip(a.gain, at, 0.44, 0.016, 0.27);
      o.connect(a);
      a.connect(g);
      o.start(at);
      o.stop(at + 0.42);
      srcs.push(o);
    }
    v.bind(g, srcs);
    return true;
  }

  /** Build queued: a rising metallic third — something has been laid down. */
  _queued(t) {
    const v = this._claimUi(0.32);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const srcs = [];
    const freqs = [523, 622];
    for (let i = 0; i < freqs.length; i++) {
      const at = t + i * 0.06;
      const o = this.ctx.createOscillator();
      o.setPeriodicWave(this._metalWave);
      o.frequency.value = freqs[i];
      const a = this.ctx.createGain();
      blip(a.gain, at, 0.28, 0.004, 0.15);
      o.connect(a);
      a.connect(g);
      o.start(at);
      o.stop(at + 0.24);
      srcs.push(o);
    }
    v.bind(g, srcs);
    return true;
  }

  /** Build complete: a bell with a real tail. Unmistakably a finished thing. */
  _complete(t) {
    const v = this._claimUi(1.1, 5);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const send = this.ctx.createGain();
    send.gain.value = 0.28;
    g.connect(send);
    send.connect(this.audio.buses.ui.wet);
    const srcs = [];
    const freqs = [392, 588, 784];
    for (let i = 0; i < freqs.length; i++) {
      const at = t + i * 0.045;
      const o = this.ctx.createOscillator();
      o.setPeriodicWave(this._bellWave);
      o.frequency.setValueAtTime(freqs[i], at);
      // A bell's partials fall slightly as it rings; a fixed pitch sounds cheap.
      o.detune.setValueAtTime(4, at);
      o.detune.linearRampToValueAtTime(-9, at + 0.8);
      const a = this.ctx.createGain();
      blip(a.gain, at, 0.26 / (1 + i * 0.5), 0.005, 0.62 - i * 0.12);
      o.connect(a);
      a.connect(g);
      o.start(at);
      o.stop(at + 0.9);
      srcs.push(o);
    }
    v.bind(g, srcs);
    return true;
  }

  /** Rejected: a flat, low, unmusical buzz. It is a "no" and nothing else. */
  _reject(t) {
    const v = this._claimUi(0.3);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._hardDrive;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    /* Level has to be set *after* the shaper. A tanh(9x) curve lifts anything
       quiet almost to unity, so trimming the envelope alone moves this sound by
       a fraction of a dB — which is how it ended up 12 dB above the rest of the
       palette. The trim is the actual fader; the envelope only shapes it. */
    const trim = this.ctx.createGain();
    trim.gain.value = 0.62;
    g.connect(shaper);
    shaper.connect(lp);
    lp.connect(trim);
    trim.connect(this.audio.buses.ui.input);
    const srcs = [];
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 118 + i * 5.5;
      const a = this.ctx.createGain();
      // Two short bursts, like a locked door being tried twice.
      blip(a.gain, t, 0.075, 0.003, 0.055);
      blip(a.gain, t + 0.085, 0.066, 0.003, 0.075);
      o.connect(a);
      a.connect(g);
      o.start(t);
      o.stop(t + 0.22);
      srcs.push(o);
    }
    v.bind(g, srcs);
    return true;
  }

  _cancel(t) {
    const v = this._claimUi(0.22);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    sweep(o.frequency, t, 1240, 380, 0.13);
    const a = this.ctx.createGain();
    blip(a.gain, t, 0.26, 0.002, 0.13);
    o.connect(a);
    a.connect(g);
    o.start(t);
    o.stop(t + 0.2);
    v.bind(g, [o]);
    return true;
  }

  /** Sensors: a filtered noise sweep. Up on open, down on close. */
  _sensors(t, open) {
    const v = this._claimUi(0.7, 5);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const n = this._noise(t, 'pink', 1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.4;
    sweep(bp.frequency, t, open ? 260 : 3400, open ? 3600 : 220, 0.42);
    const a = this.ctx.createGain();
    adsr(a.gain, t, { peak: 0.34, attack: 0.05, decay: 0.12, sustain: 0.5, hold: 0.1, release: 0.24 });
    n.connect(bp);
    bp.connect(a);
    a.connect(g);
    n.start(t);
    n.stop(t + 0.65);
    // A quiet tonal centre stops it reading as pure hiss.
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    sweep(o.frequency, t, open ? 180 : 520, open ? 520 : 180, 0.4);
    const og = this.ctx.createGain();
    adsr(og.gain, t, { peak: 0.1, attack: 0.06, decay: 0.1, sustain: 0.6, hold: 0.08, release: 0.26 });
    o.connect(og);
    og.connect(g);
    o.start(t);
    o.stop(t + 0.65);
    v.bind(g, [n, o]);
    return true;
  }

  _tick(t, freq, level) {
    const v = this._claimUi(0.08, 2);
    if (!v) return false;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.audio.buses.ui.input);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const a = this.ctx.createGain();
    blip(a.gain, t, level, 0.001, 0.035);
    o.connect(a);
    a.connect(g);
    o.start(t);
    o.stop(t + 0.06);
    v.bind(g, [o]);
    return true;
  }

  /* ------------------------------------------------------------------ weapons */

  /**
   * Fire a weapon sound at a world point.
   * @param {string} type WEAPON_TYPE value
   * @param {object} at   {x,y,z}
   * @param {number} size firing hull length in metres
   * @param {number} density how many shots this one sound represents
   */
  weapon(type, at, size, density, opts) {
    if (!this.audio.running) return false;
    const t = this.ctx.currentTime + 0.001;
    switch (type) {
      case WEAPON_TYPE.ION: return this._ion(t, at, size, opts);
      case WEAPON_TYPE.BEAM: return this._beam(t, at, size, opts);
      case WEAPON_TYPE.FLAK: return this._flak(t, at, size, density);
      case WEAPON_TYPE.MISSILE: return this._missile(t, at, size, density);
      default:
        return size >= CAPITAL_LENGTH
          ? this._capitalGun(t, at, size)
          : this._chatter(t, at, size, density);
    }
  }

  /** Small-calibre chatter. Density becomes repeats, not volume. */
  _chatter(t, at, size, density) {
    const sp = this.audio.spatial(at.x, at.y, at.z, size, BUCKETS.kineticSmall.maxDist);
    if (!sp) return this._cull();
    const shots = clamp(Math.round(1 + Math.log2(1 + (density || 1)) * 1.6), 1, BUCKETS.kineticSmall.cap);
    const v = this._claim(2, 0.45, sp.gain * 0.4);
    if (!v) return this._cull();
    const chain = this.audio.positional('sfx', sp, 0.40);
    const srcs = [];
    for (let i = 0; i < shots; i++) {
      const at2 = t + i * this.rng.range(0.011, 0.026);
      const n = this._noise(at2, 'white', this.rng.range(0.85, 1.25));
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const f0 = this.rng.range(1500, 2300) * lerp(1.15, 0.7, clamp(size / 200, 0, 1));
      sweep(bp.frequency, at2, f0, f0 * 0.42, 0.03);
      bp.Q.value = 1.5;
      const a = this.ctx.createGain();
      blip(a.gain, at2, 0.55, 0.0008, 0.028);
      n.connect(bp);
      bp.connect(a);
      a.connect(chain.input);
      n.start(at2, this.rng.range(0, 1.5));
      n.stop(at2 + 0.06);
      srcs.push(n);
      // A pitched thunk under each crack: the round leaving the rail.
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      sweep(o.frequency, at2, lerp(280, 130, clamp(size / 200, 0, 1)), 84, 0.05);
      const og = this.ctx.createGain();
      blip(og.gain, at2, 0.30, 0.001, 0.045);
      o.connect(og);
      og.connect(chain.input);
      o.start(at2);
      o.stop(at2 + 0.09);
      srcs.push(o);
    }
    v.bind(chain.input, srcs);
    this._counts.played++;
    return true;
  }

  /** Capital battery. Sub thump, saturated body, a tail you can feel. */
  _capitalGun(t, at, size) {
    if (this._active.capitalGun >= CATEGORY_CAP.capitalGun) return this._cull();
    const sp = this.audio.spatial(at.x, at.y, at.z, size, 26000);
    if (!sp) return this._cull();
    const v = this._claim(5, 1.3, sp.gain * 0.9);
    if (!v) return this._cull();
    this._hold('capitalGun', 1.3);
    const scale = clamp(size / 600, 0.4, 2.4);
    const chain = this.audio.positional('sfx', sp, 0.9);
    const srcs = [];

    // Sub: the concussion. Drops nearly an octave, which is what reads as mass.
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sweep(sub.frequency, t, 82 / scale, 34 / scale, 0.34);
    const subG = this.ctx.createGain();
    blip(subG.gain, t, 0.95, 0.004, 0.42 * scale);
    sub.connect(subG);
    subG.connect(chain.input);
    sub.start(t);
    sub.stop(t + 0.9 * scale);
    srcs.push(sub);

    // Body: broadband crack collapsing into a rumble, saturated so the tail has
    // grit rather than reading as a whoosh.
    const n = this._noise(t, 'brown', 1);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._drive;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    sweep(lp.frequency, t, 4200, 220, 0.5);
    lp.Q.value = 1.1;
    const ng = this.ctx.createGain();
    blip(ng.gain, t, 0.7, 0.003, 0.55 * scale);
    n.connect(shaper);
    shaper.connect(lp);
    lp.connect(ng);
    ng.connect(chain.input);
    n.start(t, this.rng.range(0, 2));
    n.stop(t + 1.1 * scale);
    srcs.push(n);

    // Transient: the only bright thing in the sound, and it is gone in 30 ms.
    const c = this._noise(t, 'white', 1);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1600;
    const cg = this.ctx.createGain();
    blip(cg.gain, t, 0.30, 0.0008, 0.03);
    c.connect(hp);
    hp.connect(cg);
    cg.connect(chain.input);
    c.start(t);
    c.stop(t + 0.06);
    srcs.push(c);

    v.bind(chain.input, srcs);
    this._counts.played++;
    return true;
  }

  /** Flak: a spatter of hard cracks with a short dirty tail. */
  _flak(t, at, size, density) {
    const sp = this.audio.spatial(at.x, at.y, at.z, size, BUCKETS.flak.maxDist);
    if (!sp) return this._cull();
    const pops = clamp(Math.round(2 + Math.log2(1 + (density || 1)) * 2), 2, BUCKETS.flak.cap + 2);
    const v = this._claim(2, 0.55, sp.gain * 0.5);
    if (!v) return this._cull();
    const chain = this.audio.positional('sfx', sp, 0.66);
    const srcs = [];
    for (let i = 0; i < pops; i++) {
      const at2 = t + i * this.rng.range(0.014, 0.04);
      const n = this._noise(at2, 'white', this.rng.range(0.9, 1.4));
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = this.rng.range(1900, 3400);
      bp.Q.value = this.rng.range(0.8, 1.8);
      const a = this.ctx.createGain();
      blip(a.gain, at2, 0.5, 0.0006, this.rng.range(0.03, 0.075));
      n.connect(bp);
      bp.connect(a);
      a.connect(chain.input);
      n.start(at2, this.rng.range(0, 1.5));
      n.stop(at2 + 0.12);
      srcs.push(n);
    }
    // Shared low tail so the burst has a floor rather than being all fizz.
    const tail = this._noise(t, 'pink', 1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    sweep(lp.frequency, t, 900, 180, 0.3);
    const tg = this.ctx.createGain();
    blip(tg.gain, t, 0.24, 0.01, 0.3);
    tail.connect(lp);
    lp.connect(tg);
    tg.connect(chain.input);
    tail.start(t, this.rng.range(0, 1.5));
    tail.stop(t + 0.45);
    srcs.push(tail);
    v.bind(chain.input, srcs);
    this._counts.played++;
    return true;
  }

  /** Missile: ignition thump then a rising rocket wash. */
  _missile(t, at, size, density) {
    const sp = this.audio.spatial(at.x, at.y, at.z, size, BUCKETS.missile.maxDist);
    if (!sp) return this._cull();
    const salvo = clamp(Math.round(1 + Math.log2(1 + (density || 1))), 1, BUCKETS.missile.cap);
    const v = this._claim(3, 0.95, sp.gain * 0.55);
    if (!v) return this._cull();
    const chain = this.audio.positional('sfx', sp, 0.55);
    const srcs = [];
    for (let i = 0; i < salvo; i++) {
      const at2 = t + i * this.rng.range(0.03, 0.09);
      const n = this._noise(at2, 'pink', this.rng.range(0.9, 1.15));
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      sweep(bp.frequency, at2, 320, this.rng.range(2400, 3400), 0.34);
      const a = this.ctx.createGain();
      adsr(a.gain, at2, { peak: 0.44, attack: 0.008, decay: 0.06, sustain: 0.55, hold: 0.12, release: 0.34 });
      n.connect(bp);
      bp.connect(a);
      a.connect(chain.input);
      n.start(at2, this.rng.range(0, 1.5));
      n.stop(at2 + 0.7);
      srcs.push(n);

      const o = this.ctx.createOscillator();
      o.type = 'sine';
      sweep(o.frequency, at2, 150, 62, 0.2);
      const og = this.ctx.createGain();
      blip(og.gain, at2, 0.34, 0.002, 0.19);
      o.connect(og);
      og.connect(chain.input);
      o.start(at2);
      o.stop(at2 + 0.32);
      srcs.push(o);
    }
    v.bind(chain.input, srcs);
    this._counts.played++;
    return true;
  }

  /**
   * The ion lance. The game's money shot, and the only weapon allowed to be
   * long: a rising charge, a hard discharge, a modulated sustain for as long as
   * the beam burns, then a filter closing over a decaying sub.
   */
  _ion(t, at, size, opts) {
    /* FX emits `fx:blast` on ion ignition too, with no hull-length term, which
       would read as a buckle inside a nearby capital's death session. Mark it
       before any early-out so the router steps over it whether or not the lance
       itself survives the voice budget — the blast is emitted either way. */
    this._ionMarks.push({ t: this.ctx.currentTime, x: at.x, y: at.y, z: at.z });
    if (this._ionMarks.length > 6) this._ionMarks.shift();
    if (this._active.ion >= CATEGORY_CAP.ion) return this._cull();
    const sp = this.audio.spatial(at.x, at.y, at.z, size, 40000);
    if (!sp) return this._cull();
    const burn = clamp((opts && opts.duration) || 1.6, 0.6, 3.2);
    const charge = 0.34;
    const tail = 0.85;
    const total = charge + burn + tail;
    const v = this._claim(7, total + 0.4, sp.gain);
    if (!v) return this._cull();
    this._hold('ion', total + 0.2);

    const scale = clamp(size / 500, 0.5, 2.0);
    // A spinal mount is lower than a frigate's lance — and must not be quieter
    // for it, so size buys level as well as pitch.
    const chain = this.audio.positional('sfx', sp, lerp(0.88, 1.15, clamp((scale - 0.5) / 1.5, 0, 1)));
    const srcs = [];

    // Extra reverb: the lance is the one thing that should sound enormous.
    const send = this.ctx.createGain();
    send.gain.value = 0.35;
    chain.amp.connect(send);
    send.connect(this.audio.buses.sfx.wet);

    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._drive;
    const body = this.ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.Q.value = 3.2;
    const bodyGain = this.ctx.createGain();
    bodyGain.gain.value = 1;
    shaper.connect(body);
    body.connect(bodyGain);
    bodyGain.connect(chain.input);

    // Charge: capacitors winding up. Frequency and filter climb together.
    sweep(body.frequency, t, 240, 1500, charge);
    body.frequency.setValueAtTime(1500, t + charge);
    body.frequency.linearRampToValueAtTime(900, t + charge + burn * 0.5);
    body.frequency.exponentialRampToValueAtTime(160, t + total);

    const roots = [55 / scale, 55.6 / scale, 82.6 / scale];
    for (let i = 0; i < roots.length; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(roots[i] * 0.62, t);
      o.frequency.exponentialRampToValueAtTime(roots[i], t + charge);
      o.frequency.setValueAtTime(roots[i], t + charge + burn);
      o.frequency.exponentialRampToValueAtTime(roots[i] * 0.55, t + total);
      const a = this.ctx.createGain();
      a.gain.setValueAtTime(1e-4, t);
      a.gain.exponentialRampToValueAtTime(0.16, t + charge * 0.8);
      a.gain.exponentialRampToValueAtTime(0.42, t + charge + 0.02);
      a.gain.setValueAtTime(0.42, t + charge + burn * 0.9);
      a.gain.exponentialRampToValueAtTime(1e-4, t + total);
      o.connect(a);
      a.connect(shaper);
      o.start(t);
      o.stop(t + total + 0.05);
      srcs.push(o);
    }

    // The whine that sells "charging" — inaudible in the sustain, vital before it.
    const whine = this.ctx.createOscillator();
    whine.type = 'sine';
    sweep(whine.frequency, t, 1400, 3300, charge);
    const wg = this.ctx.createGain();
    wg.gain.setValueAtTime(1e-4, t);
    wg.gain.exponentialRampToValueAtTime(0.13, t + charge * 0.95);
    wg.gain.exponentialRampToValueAtTime(1e-4, t + charge + 0.22);
    whine.connect(wg);
    wg.connect(chain.input);
    whine.start(t);
    whine.stop(t + charge + 0.3);
    srcs.push(whine);

    // Discharge transient.
    const crack = this._noise(t + charge, 'white', 1);
    const chp = this.ctx.createBiquadFilter();
    chp.type = 'highpass';
    chp.frequency.value = 900;
    const cg = this.ctx.createGain();
    blip(cg.gain, t + charge, 0.55, 0.001, 0.11);
    crack.connect(chp);
    chp.connect(cg);
    cg.connect(chain.input);
    crack.start(t + charge);
    crack.stop(t + charge + 0.2);
    srcs.push(crack);

    const thump = this.ctx.createOscillator();
    thump.type = 'sine';
    sweep(thump.frequency, t + charge, 70, 26, 0.4);
    const tg = this.ctx.createGain();
    blip(tg.gain, t + charge, 0.8, 0.003, 0.5);
    thump.connect(tg);
    tg.connect(chain.input);
    thump.start(t + charge);
    thump.stop(t + charge + 0.7);
    srcs.push(thump);

    // Sustain: plasma. Crackle noise through the same bandpass, plus a ring-
    // modulated high layer for the electrical fizz, plus two LFOs so the beam
    // breathes instead of sitting there as a drone.
    const plasma = this._noise(t + charge, 'crackle', 1);
    const pg = this.ctx.createGain();
    pg.gain.setValueAtTime(1e-4, t + charge);
    pg.gain.exponentialRampToValueAtTime(0.5, t + charge + 0.04);
    pg.gain.setValueAtTime(0.5, t + charge + burn * 0.85);
    pg.gain.exponentialRampToValueAtTime(1e-4, t + total);
    plasma.connect(pg);
    pg.connect(shaper);
    plasma.start(t + charge, this.rng.range(0, 1.5));
    plasma.stop(t + total + 0.05);
    srcs.push(plasma);

    const fizzC = this.ctx.createOscillator();
    fizzC.type = 'sine';
    fizzC.frequency.value = 2150;
    const fizzM = this.ctx.createOscillator();
    fizzM.type = 'sine';
    fizzM.frequency.value = 63;
    const fizzD = this.ctx.createGain();
    fizzD.gain.value = 1;
    const fizzOut = this.ctx.createGain();
    fizzOut.gain.value = 0;
    fizzM.connect(fizzD.gain);
    fizzC.connect(fizzD);
    fizzD.connect(fizzOut);
    fizzOut.connect(chain.input);
    fizzOut.gain.setValueAtTime(1e-4, t + charge);
    fizzOut.gain.exponentialRampToValueAtTime(0.075, t + charge + 0.06);
    fizzOut.gain.exponentialRampToValueAtTime(1e-4, t + charge + burn);
    fizzC.start(t + charge);
    fizzC.stop(t + total);
    fizzM.start(t + charge);
    fizzM.stop(t + total);
    srcs.push(fizzC, fizzM);

    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = this.rng.range(6.2, 8.4);
    const lfoAmt = this.ctx.createGain();
    lfoAmt.gain.value = 0.18;
    lfo.connect(lfoAmt);
    lfoAmt.connect(bodyGain.gain);
    lfo.start(t);
    lfo.stop(t + total);
    srcs.push(lfo);

    const slow = this.ctx.createOscillator();
    slow.type = 'sine';
    slow.frequency.value = this.rng.range(0.7, 1.3);
    const slowAmt = this.ctx.createGain();
    slowAmt.gain.value = 320;
    slow.connect(slowAmt);
    slowAmt.connect(body.frequency);
    slow.start(t);
    slow.stop(t + total);
    srcs.push(slow);

    v.bind(chain.input, srcs);
    // The lance owns the frame while it burns, but only by a couple of dB —
    // it should feel like everything leaned back, not like a mute button.
    this.audio.duck('music', 3.5, burn * 0.6, 1.2);
    this._counts.played++;
    return true;
  }

  /** Continuous beam — the ion lance's smaller, cheaper cousin. */
  _beam(t, at, size, opts) {
    if (this._active.beam >= CATEGORY_CAP.beam) return this._cull();
    const sp = this.audio.spatial(at.x, at.y, at.z, size, 32000);
    if (!sp) return this._cull();
    const burn = clamp((opts && opts.duration) || 1.2, 0.4, 3);
    const total = burn + 0.5;
    const v = this._claim(6, total + 0.3, sp.gain * 0.8);
    if (!v) return this._cull();
    this._hold('beam', total);
    const chain = this.audio.positional('sfx', sp, 0.75);
    const srcs = [];
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 720;
    bp.Q.value = 4;
    bp.connect(chain.input);
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 128 * (1 + i * 0.011);
      const a = this.ctx.createGain();
      adsr(a.gain, t, { peak: 0.3, attack: 0.03, decay: 0.06, sustain: 0.8, hold: burn, release: 0.4 });
      o.connect(a);
      a.connect(bp);
      o.start(t);
      o.stop(t + total);
      srcs.push(o);
    }
    const n = this._noise(t, 'crackle', 1);
    const ng = this.ctx.createGain();
    adsr(ng.gain, t, { peak: 0.22, attack: 0.02, decay: 0.05, sustain: 0.7, hold: burn, release: 0.35 });
    n.connect(ng);
    ng.connect(bp);
    n.start(t, this.rng.range(0, 1.5));
    n.stop(t + total);
    srcs.push(n);
    v.bind(chain.input, srcs);
    this._counts.played++;
    return true;
  }

  /* ------------------------------------------------------------------ impacts */

  impact(at, size, shield, density) {
    const cfg = shield ? BUCKETS.impactShield : BUCKETS.impactHull;
    const sp = this.audio.spatial(at.x, at.y, at.z, size, cfg.maxDist);
    if (!sp) return this._cull();
    const hits = clamp(Math.round(1 + Math.log2(1 + (density || 1)) * 1.3), 1, cfg.cap);
    const t = this.ctx.currentTime + 0.001;
    const v = this._claim(2, 0.7, sp.gain * 0.35);
    if (!v) return this._cull();
    const chain = this.audio.positional('sfx', sp, shield ? 0.30 : 0.36);
    const srcs = [];
    const big = clamp(size / 400, 0.25, 2);

    for (let i = 0; i < hits; i++) {
      const at2 = t + i * this.rng.range(0.012, 0.05);
      if (shield) {
        // Shields ring. Glassy, high, and gone.
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        sweep(o.frequency, at2, this.rng.range(1250, 1700), this.rng.range(700, 950), 0.22);
        const a = this.ctx.createGain();
        blip(a.gain, at2, 0.34, 0.001, 0.2);
        o.connect(a);
        a.connect(chain.input);
        o.start(at2);
        o.stop(at2 + 0.3);
        srcs.push(o);
        const n = this._noise(at2, 'white', 1);
        const bpf = this.ctx.createBiquadFilter();
        bpf.type = 'bandpass';
        bpf.frequency.value = this.rng.range(2600, 4200);
        bpf.Q.value = 3;
        const ng = this.ctx.createGain();
        blip(ng.gain, at2, 0.2, 0.0008, 0.055);
        n.connect(bpf);
        bpf.connect(ng);
        ng.connect(chain.input);
        n.start(at2, this.rng.range(0, 1.5));
        n.stop(at2 + 0.1);
        srcs.push(n);
      } else {
        // Hull takes it. Dull, low, structural.
        const n = this._noise(at2, 'metal', this.rng.range(0.6, 1.1) / big);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        sweep(lp.frequency, at2, 1800 / big, 260 / big, 0.13);
        const a = this.ctx.createGain();
        blip(a.gain, at2, 0.5, 0.0012, 0.11 * big);
        n.connect(lp);
        lp.connect(a);
        a.connect(chain.input);
        n.start(at2, this.rng.range(0, 1.5));
        n.stop(at2 + 0.3);
        srcs.push(n);
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        sweep(o.frequency, at2, 190 / big, 70 / big, 0.12);
        const og = this.ctx.createGain();
        blip(og.gain, at2, 0.36, 0.001, 0.13 * big);
        o.connect(og);
        og.connect(chain.input);
        o.start(at2);
        o.stop(at2 + 0.32);
        srcs.push(o);
      }
    }
    v.bind(chain.input, srcs);
    this._counts.played++;
    return true;
  }

  /* ------------------------------------------------------------------- deaths */

  /**
   * @param {object} at   world position
   * @param {number} size hull length. The tiers are a reading of the ship-length
   *                      table, not a schedule: <45 m is one beat and is played
   *                      outright; anything larger opens a session and lets
   *                      `fx:blast` conduct it.
   */
  death(at, size) {
    if (!this.audio.running) return false;
    if (size >= 210) return this._openDeath(at, size, 'capital');
    if (size >= 45) return this._openDeath(at, size, 'break');
    return this._deathPop(at, size);
  }

  _deathPop(at, size) {
    if (this._active.death >= CATEGORY_CAP.death) return this._cull();
    const sp = this.audio.spatial(at.x, at.y, at.z, size, 11000);
    if (!sp) return this._cull();
    const t = this.ctx.currentTime + 0.001;
    const v = this._claim(3, 0.7, sp.gain * 0.5);
    if (!v) return this._cull();
    this._hold('death', 0.7);
    const chain = this.audio.positional('sfx', sp, 0.55);
    const srcs = [];
    const n = this._noise(t, 'white', this.rng.range(0.8, 1.2));
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    sweep(lp.frequency, t, 5200, 380, 0.28);
    const a = this.ctx.createGain();
    blip(a.gain, t, 0.75, 0.002, 0.3);
    n.connect(lp);
    lp.connect(a);
    a.connect(chain.input);
    n.start(t, this.rng.range(0, 1.5));
    n.stop(t + 0.5);
    srcs.push(n);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    sweep(o.frequency, t, 160, 44, 0.22);
    const og = this.ctx.createGain();
    blip(og.gain, t, 0.6, 0.002, 0.26);
    o.connect(og);
    og.connect(chain.input);
    o.start(t);
    o.stop(t + 0.45);
    srcs.push(o);
    v.bind(chain.input, srcs);
    this._counts.played++;
    return true;
  }

  /* ------------------------------------------------- blast-driven sequences */

  /**
   * Open a death sequence and wait for the picture.
   *
   * This used to schedule the whole thing at trigger time against a copy of
   * `fx/explosions.js`'s beat table. FX then re-cut the capital death — same
   * script, but stretched by the cube root of hull length, so a mothership now
   * runs to roughly six seconds — and the audio kept firing its primary at a
   * fixed 2.98 s, more than two seconds ahead of the flash. Mirroring another
   * module's internals is the bug; the fix is to listen.
   *
   * So: this builds the chain, claims the voice and starts the bed. Every beat
   * after that arrives on `fx:blast`.
   */
  _openDeath(at, size, tier) {
    const capital = tier === 'capital';
    const cat = capital ? 'capitalDeath' : 'death';
    if (this._active[cat] >= CATEGORY_CAP[cat]) return this._cull();
    const sp = this.audio.spatial(at.x, at.y, at.z, size, capital ? 60000 : 24000);
    if (!sp) return this._cull();
    const t = this.ctx.currentTime + 0.001;
    const initial = SESSION_INITIAL[tier];
    const v = this._claim(capital ? 10 : 6, initial, capital ? 1 : sp.gain * 0.8);
    if (!v) return this._cull();
    // Held for the session's real lifetime, released in _sweepSessions.
    this._active[cat]++;

    // `late` keeps the detonation out of its own duck node — see index.js.
    const chain = this.audio.positional('sfx', sp, capital ? 1.0 : 0.85, capital);
    const send = this.ctx.createGain();
    send.gain.value = capital ? 0.42 : 0.3;
    chain.amp.connect(send);
    send.connect(this.audio.buses.sfx.wet);
    const srcs = [];

    const s = {
      id: this._sessionSeq++,
      tier,
      cat,
      capital,
      size,
      x: at.x,
      y: at.y,
      z: at.z,
      /* Blast points walk the spine and carry the wreck's momentum, so the
         match radius is the hull plus room for the drift of a long death. One
         chain serves the whole session: a few hundred metres of walk is nothing
         against a sixty-kilometre audible range, and re-panning every secondary
         would cost more than it is worth. */
      matchR2: Math.pow(Math.max(900, size * 1.5 + 600), 2),
      // The quietest beat heard so far. Secondaries are the floor of every
      // sequence, so this settles within the first beat or two and then holds.
      unit: 0,
      opened: t,
      until: t + initial,
      chain,
      voice: v,
      srcs,
      relative: sp.gain,
      heard: 0,
      secondaries: 0,
      buckled: false,
      primaryAt: 0,
      unattended: false,
      // Tier shapes: how a beat's ordinal maps to its size and level.
      progDiv: capital ? 12 : 2,
      levelBase: capital ? 0.22 : 0.46,
      levelSpan: capital ? 0.30 : 0.16,
      sizeBase: capital ? 0.09 : 0.42,
      sizeSpan: capital ? 0.11 : 0.14,
      bed: null,
    };
    s.bed = capital ? this._capitalBed(s, t) : null;

    v.bind(chain.input, srcs);
    this._sessions.push(s);
    this._blastStats.sessions++;
    this._blastStats.lastOpenedAt = t;
    this._counts.played++;
    return true;
  }

  /**
   * Act one, and deliberately without a schedule: something structural is
   * failing and the sound says so until the picture says otherwise. The bed
   * rises with the beats that actually arrive and is cut by the detonation, so
   * a three-second death and a six-second one both end on the bang instead of
   * guessing where it is.
   */
  _capitalBed(s, t) {
    const scale = clamp(s.size / 900, 0.5, 2.4);
    const groan = this._noise(t, 'brown', 0.55);
    const gl = this.ctx.createBiquadFilter();
    gl.type = 'lowpass';
    gl.frequency.setValueAtTime(90, t);
    gl.frequency.setTargetAtTime(280, t, 1.5);
    const gg = this.ctx.createGain();
    gg.gain.setValueAtTime(1e-4, t);
    gg.gain.setTargetAtTime(0.24, t, 0.9);
    groan.connect(gl);
    gl.connect(gg);
    gg.connect(s.chain.input);
    groan.start(t, this.rng.range(0, 1.5));
    groan.stop(t + SESSION_MAX);
    s.srcs.push(groan);

    // A rising tone under it: the reactor losing containment. It climbs with
    // evidence — each secondary heard — rather than against a predicted clock.
    const dread = this.ctx.createOscillator();
    dread.type = 'sawtooth';
    dread.frequency.setValueAtTime(36 / scale, t);
    const dl = this.ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 240;
    const dg = this.ctx.createGain();
    dg.gain.setValueAtTime(1e-4, t);
    dg.gain.setTargetAtTime(0.16, t + 0.3, 1.2);
    dread.connect(dl);
    dl.connect(dg);
    dg.connect(s.chain.input);
    dread.start(t);
    dread.stop(t + SESSION_MAX);
    s.srcs.push(dread);

    return { groan, dread, groanGain: gg, dreadGain: dg, dreadOsc: dread, scale };
  }

  /** A beat landed: lean the bed into it. */
  _bedPush(s, now, prog) {
    const b = s.bed;
    if (!b) return;
    b.groanGain.gain.setTargetAtTime(lerp(0.24, 0.58, prog), now, 0.35);
    b.dreadGain.gain.setTargetAtTime(lerp(0.16, 0.36, prog), now, 0.5);
    b.dreadOsc.frequency.setTargetAtTime(lerp(36, 74, prog) / b.scale, now, 0.8);
  }

  /** The hull gives up: the bed jumps, because the next thing is the end. */
  _bedBuckle(s, now) {
    const b = s.bed;
    if (!b) return;
    b.groanGain.gain.setTargetAtTime(0.66, now, 0.12);
    b.dreadGain.gain.setTargetAtTime(0.40, now, 0.15);
    b.dreadOsc.frequency.setTargetAtTime(86 / b.scale, now, 0.2);
  }

  /** The detonation takes the bed with it — the silence under it is the point. */
  _bedCut(s, at) {
    const b = s.bed;
    if (!b) return;
    for (const g of [b.groanGain.gain, b.dreadGain.gain]) {
      try {
        g.cancelScheduledValues(at);
        g.setValueAtTime(Math.max(1e-4, g.value), at);
        g.exponentialRampToValueAtTime(1e-4, at + 0.3);
      } catch (e) {
        /* param already finalised by a steal */
      }
    }
    for (const src of [b.groan, b.dread]) {
      try {
        src.stop(at + 0.45);
      } catch (e) {
        /* already stopped */
      }
    }
  }

  /* ---------------------------------------------------------- blast routing */

  /**
   * `fx:blast` — the channel FX publishes every beat that should be *felt* on.
   * The camera rig already drives its shake from it; this is the same
   * subscription doing the same job for the mix, and it is why nothing in this
   * file knows or cares when a capital death's primary actually lands.
   */
  _onBlast(p) {
    const st = this._blastStats;
    st.blasts++;
    if (!p || !p.point || !this.audio.running || !this._sessions.length) {
      st.ignored++;
      return;
    }
    const pt = p.point;
    const strength = Number(p.strength) || 0;
    if (strength < BLAST.hardFloor || this._nearIon(pt)) {
      st.ignored++;
      return;
    }
    const radius = Number(p.radius) || 0;
    const s = this._match(pt, radius);
    if (!s) {
      st.ignored++;
      return;
    }
    // Calibrate on this session's own quietest beat, so the thresholds below
    // hold for a 130 m frigate and a 1,900 m mothership alike — and keep
    // holding if FX renormalises the scale again.
    if (!s.unit || strength < s.unit) s.unit = strength;
    const ratio = strength / s.unit;
    if (ratio < BLAST.unitFloor) {
      st.ignored++;
      return;
    }
    st.matched++;
    s.heard++;
    const now = this.ctx.currentTime;

    if (s.primaryAt > 0) {
      // The flash is three overlapping beats; they are one detonation.
      if (now - s.primaryAt < 0.45) return;
      this._sessionSecondary(s, now, ratio);
      return;
    }
    if (ratio >= BLAST.primary) {
      this._sessionPrimary(s, now);
      return;
    }
    if (ratio >= BLAST.buckle && !s.buckled) {
      this._sessionBuckle(s, now);
      return;
    }
    this._sessionSecondary(s, now, ratio);
  }

  /**
   * Nearest open session, scored by its own match radius so the tighter wins —
   * and only sessions whose hull could plausibly have thrown a blast this big.
   */
  _match(pt, radius) {
    let best = null;
    let bestScore = 1;
    for (let i = 0; i < this._sessions.length; i++) {
      const s = this._sessions[i];
      if (radius > 0
        && (radius < s.size * BLAST_RADIUS_BAND.min || radius > s.size * BLAST_RADIUS_BAND.max)) {
        continue;
      }
      const dx = pt.x - s.x;
      const dy = pt.y - s.y;
      const dz = pt.z - s.z;
      let score = (dx * dx + dy * dy + dz * dz) / s.matchR2;
      if (s.primaryAt > 0) score = score * SPENT_SESSION_PENALTY + 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  /** An ion lance emits on the same channel; we already voiced it from sim:fire. */
  _nearIon(pt) {
    const now = this.ctx.currentTime;
    for (let i = this._ionMarks.length - 1; i >= 0; i--) {
      const m = this._ionMarks[i];
      if (now - m.t > ION_MARK_WINDOW) {
        this._ionMarks.splice(i, 1);
        continue;
      }
      const dx = pt.x - m.x;
      const dy = pt.y - m.y;
      const dz = pt.z - m.z;
      if (dx * dx + dy * dy + dz * dz < ION_MARK_DIST2) return true;
    }
    return false;
  }

  /** Keep the reservation just ahead of the sequence, never far ahead of it. */
  _extend(s, until) {
    if (until <= s.until) return;
    s.until = Math.min(until, s.opened + SESSION_MAX);
    s.voice.hold(s.until);
  }

  _sessionSecondary(s, now, ratio) {
    s.secondaries++;
    this._extend(s, now + SESSION_EXTEND);
    const prog = clamp(s.secondaries / s.progDiv, 0, 1);
    // How hard this beat was relative to the sequence's own floor says how big
    // it is; the running count says how far gone the ship is. Both belong.
    const level = clamp(s.levelBase + s.levelSpan * prog + clamp((ratio - 1) * 0.1, 0, 0.22),
      0.15, 0.85);
    this._secondary(s.chain.input, s.srcs, now + 0.001,
      s.size * (s.sizeBase + s.sizeSpan * prog), level);
    this._bedPush(s, now, prog);
    this._blastStats.secondaries++;
  }

  _sessionBuckle(s, now) {
    s.buckled = true;
    this._extend(s, now + SESSION_EXTEND);
    this._crack(s.chain.input, s.srcs, now + 0.001, s.capital ? 0.6 : 0.5, s.capital ? 1.0 : 0.9);
    this._bedBuckle(s, now);
    this._blastStats.buckles++;
  }

  /** Everything below 60 Hz in this game lives here. */
  _sessionPrimary(s, at) {
    if (s.primaryAt > 0) return;
    s.primaryAt = at;
    const t = at + 0.001;
    const tail = s.capital ? 6.0 : 2.4;
    this._detonation(s.chain.input, s.srcs, t, s.size, s.capital ? 1.0 : 0.85, tail);
    /* The shock front arrives after the flash — that is the one interval audio
       still owns, because it is physics rather than a beat table. */
    this._shock(s.chain.input, s.srcs, t + (s.capital ? 0.32 : 0.22),
      s.capital ? 2.6 : 1.4, s.capital ? 0.85 : 0.4);
    this._bedCut(s, at);

    /* The detonation's own tail is the one length this file does know, so the
       reservation can finally be exact. */
    s.until = t + tail + 1.2;
    s.voice.hold(s.until);

    /* Dominate the mix, briefly, then give it back — on the detonation itself,
       not on a timer started when the ship began dying. */
    if (s.capital) {
      if (s.relative > 0.25) {
        this.audio.duck('sfx', 7 * s.relative, 0.55, 1.6);
        this.audio.duck('music', 9 * s.relative, 0.9, 2.4);
      }
    } else {
      this.audio.duck('music', 2.5, 0.5, 0.9);
    }

    this._blastStats.primaries++;
    this._blastStats.lastPrimaryAt = at;
    this._blastStats.lastPrimaryDelay = Math.round((at - s.opened) * 1000) / 1000;
  }

  /**
   * FX said nothing at all — disabled, or a quality mode that dropped the
   * sequence. The death still has to land, so it lands: one crack and one
   * detonation. Deliberately *not* a reconstruction of the visual script,
   * because inventing beats nobody can see is how this drifted in the first
   * place.
   */
  _sessionFallback(s, now) {
    s.unattended = true;
    this._crack(s.chain.input, s.srcs, now + 0.001, s.capital ? 0.6 : 0.5, 1.0);
    this._sessionPrimary(s, now + (s.capital ? 0.35 : 0.25));
    this._blastStats.unattended++;
  }

  /** Fallbacks, watchdogs and retirement. Called once per frame from update(). */
  _sweepSessions(now) {
    for (let i = this._sessions.length - 1; i >= 0; i--) {
      const s = this._sessions[i];
      if (!s.primaryAt) {
        if (!s.heard && now - s.opened > UNATTENDED_AFTER) {
          this._sessionFallback(s, now);
        } else if (now - s.opened > PRIMARY_DEADLINE) {
          // Beats are arriving but the ship will not finish dying. End it.
          this._blastStats.expired++;
          this._sessionPrimary(s, now);
        }
      }
      if (now >= s.until) {
        this._active[s.cat] = Math.max(0, this._active[s.cat] - 1);
        this._sessions.splice(i, 1);
      }
    }
  }

  /* --------------------------------------------------- death sub-components */

  _crack(dest, srcs, t, level, bright) {
    const n = this._noise(t, 'white', 1);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700 * bright;
    const g = this.ctx.createGain();
    blip(g.gain, t, level, 0.001, 0.13);
    n.connect(hp);
    hp.connect(g);
    g.connect(dest);
    n.start(t, this.rng.range(0, 1.5));
    n.stop(t + 0.25);
    srcs.push(n);
  }

  _secondary(dest, srcs, t, size, level) {
    const scale = clamp(size / 120, 0.4, 2.2);
    // Same discipline as _detonation: size lengthens the tail and darkens the
    // timbre, but the fundamental stays inside the band a speaker can reproduce.
    const shift = Math.pow(scale, 0.4);
    const n = this._noise(t, 'brown', this.rng.range(0.8, 1.3));
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    sweep(lp.frequency, t, 1500 / shift, 190 / shift, 0.24);
    const g = this.ctx.createGain();
    blip(g.gain, t, level, 0.003, 0.26 * scale);
    n.connect(lp);
    lp.connect(g);
    g.connect(dest);
    n.start(t, this.rng.range(0, 1.5));
    n.stop(t + 0.6 * scale);
    srcs.push(n);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    sweep(o.frequency, t, 150 / shift, 55 / shift, 0.2);
    const og = this.ctx.createGain();
    blip(og.gain, t, level * 0.8, 0.002, 0.24 * scale);
    o.connect(og);
    og.connect(dest);
    o.start(t);
    o.stop(t + 0.55 * scale);
    srcs.push(o);
  }

  /**
   * The big one: sub, low-mid boom, saturated body, tearing mid, bright transient.
   *
   * Size makes it *louder and lower*, never quieter. An early version scaled
   * every layer's frequency by hull length, which put a mothership almost
   * entirely under 40 Hz and made it measure 6 dB below a destroyer — physically
   * defensible, perceptually backwards, and inaudible on a laptop. The sub now
   * goes lower with size while a scale-independent boom layer holds the part you
   * actually hear, and the level rises instead of falling.
   */
  _detonation(dest, srcs, t, size, level, tail) {
    const scale = clamp(size / 900, 0.45, 2.2);
    const big = clamp((scale - 0.45) / 1.75, 0, 1);
    const lvl = level * lerp(0.85, 1.4, big);

    // Sub: the part you feel. Bigger hulls sink further and hold longer.
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sweep(sub.frequency, t, 66 / Math.sqrt(scale), Math.max(16, 22 / scale), tail * 0.45);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(1e-4, t);
    sg.gain.exponentialRampToValueAtTime(lvl * 1.15, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(1e-4, t + tail * 0.55);
    sub.connect(sg);
    sg.connect(dest);
    sub.start(t);
    sub.stop(t + tail * 0.6);
    srcs.push(sub);

    // Boom: the audible octave above the sub, barely moved by size so the
    // detonation always reads through a small speaker.
    const boomShift = Math.pow(scale, 0.35);
    const boom = this.ctx.createOscillator();
    boom.type = 'sine';
    sweep(boom.frequency, t, 150 / boomShift, 58 / boomShift, tail * 0.3);
    const bmg = this.ctx.createGain();
    blip(bmg.gain, t, lvl * 0.9, 0.004, tail * 0.35);
    boom.connect(bmg);
    bmg.connect(dest);
    boom.start(t);
    boom.stop(t + tail * 0.5);
    srcs.push(boom);

    // Body: brown noise through a filter that opens for a moment and then
    // closes for good. Saturated so it has grit rather than being a whoosh.
    const body = this._noise(t, 'brown', 1);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._drive;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(3400, t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(120, t + tail * 0.8);
    lp.Q.value = 0.9;
    const bg = this.ctx.createGain();
    bg.gain.setValueAtTime(1e-4, t);
    bg.gain.exponentialRampToValueAtTime(lvl, t + 0.012);
    bg.gain.exponentialRampToValueAtTime(lvl * 0.22, t + tail * 0.3);
    bg.gain.exponentialRampToValueAtTime(1e-4, t + tail);
    body.connect(shaper);
    shaper.connect(lp);
    lp.connect(bg);
    bg.connect(dest);
    body.start(t, this.rng.range(0, 1.5));
    body.stop(t + tail + 0.1);
    srcs.push(body);

    // Tear: metal coming apart, sweeping down out of the way of the body.
    const tear = this._noise(t, 'metal', 1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    sweep(bp.frequency, t, 1100, 130, tail * 0.35);
    const tg = this.ctx.createGain();
    blip(tg.gain, t, lvl * 0.55, 0.004, tail * 0.4);
    tear.connect(bp);
    bp.connect(tg);
    tg.connect(dest);
    tear.start(t, this.rng.range(0, 1.5));
    tear.stop(t + tail * 0.6);
    srcs.push(tear);

    this._crack(dest, srcs, t, lvl * 0.7, 1.6);
  }

  /** Expanding shockwave: a swell that pitches down as it passes. */
  _shock(dest, srcs, t, dur, level) {
    const n = this._noise(t, 'pink', 1.4);
    n.playbackRate.setValueAtTime(1.4, t);
    n.playbackRate.exponentialRampToValueAtTime(0.55, t + dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    sweep(bp.frequency, t, 620, 90, dur);
    const g = this.ctx.createGain();
    adsr(g.gain, t, {
      peak: level, attack: dur * 0.22, decay: dur * 0.2, sustain: 0.55, hold: 0, release: dur * 0.55,
    });
    n.connect(bp);
    bp.connect(g);
    g.connect(dest);
    n.start(t, this.rng.range(0, 1));
    n.stop(t + dur * 1.2);
    srcs.push(n);
  }

  /* ---------------------------------------------------------------- ambience */

  /**
   * Two beds and nothing else. The void floor sits about 40 dB under a weapon
   * and exists only so the silence has a texture; the hull bed only appears
   * when the camera is genuinely inside a friendly ship's envelope, which is
   * the one place in a space game where you are entitled to hear something.
   */
  _buildAmbience() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const target = this.audio.buses.sfx.input;

    const void_ = noiseSource(ctx, this.audio.noise.get('brown', 4), 0.35, true);
    const vlp = ctx.createBiquadFilter();
    vlp.type = 'lowpass';
    vlp.frequency.value = 130;
    const vg = ctx.createGain();
    vg.gain.value = 0;
    vg.gain.setTargetAtTime(VOID_LEVEL, t, 3);
    void_.connect(vlp);
    vlp.connect(vg);
    vg.connect(target);
    void_.start(t);

    const hull = noiseSource(ctx, this.audio.noise.get('brown', 4), 0.5, true);
    const h1 = ctx.createBiquadFilter();
    h1.type = 'peaking';
    h1.frequency.value = 78;
    h1.Q.value = 7;
    h1.gain.value = 9;
    const h2 = ctx.createBiquadFilter();
    h2.type = 'peaking';
    h2.frequency.value = 147;
    h2.Q.value = 9;
    h2.gain.value = 7;
    const hlp = ctx.createBiquadFilter();
    hlp.type = 'lowpass';
    hlp.frequency.value = 420;
    const hg = ctx.createGain();
    hg.gain.value = 0;
    hull.connect(h1);
    h1.connect(h2);
    h2.connect(hlp);
    hlp.connect(hg);
    hg.connect(target);
    hull.start(t);

    // Slow breathing on the resonance so a docked camera is not a sine tone.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.09;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 18;
    lfo.connect(lfoAmt);
    lfoAmt.connect(h1.frequency);
    lfo.start(t);

    // Tactical overlay: only present with the sensors manager open.
    const tac = ctx.createGain();
    tac.gain.value = 0;
    tac.connect(this.audio.buses.ui.input);
    const tacSrcs = [];
    for (const f of [110, 220, 329.6]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f === 110 ? 0.5 : 0.16;
      o.connect(g);
      g.connect(tac);
      o.start(t);
      tacSrcs.push(o);
    }

    this._amb = {
      voidGain: vg, hullGain: hg, hullPeak: h1, hullPeak2: h2, tacGain: tac,
      sources: [void_, hull, lfo].concat(tacSrcs),
      nodes: [vlp, h1, h2, hlp, hg, vg, tac, lfoAmt],
    };
  }

  /* ------------------------------------------------------------- per-frame */

  update(dt, now) {
    if (!this._started) return;

    // Flush any coalesced clusters whose window has closed.
    for (const key of Object.keys(this.buckets)) {
      const list = this.buckets[key].take(now);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const x = c.x / c.n;
        const y = c.y / c.n;
        const z = c.z / c.n;
        switch (key) {
          case 'kineticSmall': this._chatter(now + 0.001, { x, y, z }, c.size, c.n); break;
          case 'flak': this._flak(now + 0.001, { x, y, z }, c.size, c.n); break;
          case 'missile': this._missile(now + 0.001, { x, y, z }, c.size, c.n); break;
          case 'impactHull': this.impact({ x, y, z }, c.size, false, c.n); break;
          case 'impactShield': this.impact({ x, y, z }, c.size, true, c.n); break;
          default: break;
        }
      }
    }

    this._sweepSessions(now);

    // Engagement heat decays; music.js reads it to decide what to play.
    this.heat = Math.max(0, this.heat - dt * 0.55);
    this.threat = Math.max(0, this.threat - dt * 0.3);

    this._scanAcc += dt;
    if (this._scanAcc > 0.2) {
      this._scanAcc = 0;
      this._scanHullProximity();
    }
    this._applyAmbience(now, dt);
  }

  /** Nearest friendly hull, expressed as "how far inside its envelope are we". */
  _scanHullProximity() {
    const world = this.audio.world;
    const l = this.audio.listener;
    let best = 0;
    let bestSize = 0;
    if (world) {
      const list = Array.isArray(world.dense) ? world.dense : null;
      const each = (e) => {
        if (!e || e.alive === false || e.team !== 0) return;
        const r = e.radius || 30;
        if (r < 40) return; // fighters have no interior to resonate
        const dx = e.position.x - l.x;
        const dy = e.position.y - l.y;
        const dz = e.position.z - l.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // A hull's acoustic envelope is roughly its own length plus a kilometre.
        // Scaling purely by radius made a mothership audible from 7 km, which is
        // not "close to a ship", it is "somewhere in the same battle".
        const t = smoothstep(r * 3 + 1200, r * 1.2 + 120, d);
        if (t > best) {
          best = t;
          bestSize = r;
        }
      };
      if (list) for (let i = 0; i < list.length; i++) each(list[i]);
      else if (world.entities && world.entities.forEach) world.entities.forEach(each);
    }
    this._hullNear = best;
    this._hullSize = bestSize;
  }

  _applyAmbience(now, dt) {
    const a = this._amb;
    if (!a) return;
    const presence = this.audio.presence;
    // The void floor is loudest in the quiet — it is what silence sounds like.
    const voidLevel = VOID_LEVEL * lerp(1.3, 0.55, presence);
    a.voidGain.gain.setTargetAtTime(voidLevel, now, 1.2);

    const hullLevel = this._hullNear * HULL_LEVEL * presence;
    a.hullGain.gain.setTargetAtTime(hullLevel, now, 0.35);
    if (this._hullSize > 0) {
      // Bigger hulls resonate lower. A mothership hums; a frigate rings.
      const f = lerp(120, 52, clamp(this._hullSize / 950, 0, 1));
      a.hullPeak.frequency.setTargetAtTime(f, now, 0.6);
      a.hullPeak2.frequency.setTargetAtTime(f * 1.87, now, 0.6);
    }
    a.tacGain.gain.setTargetAtTime(this.audio.sensorsOpen ? 0.028 : 0, now, 0.5);
  }

  /* ----------------------------------------------------------- event handlers */

  _onSelect(p) {
    this.order('select', p);
  }

  _onBuild(p) {
    // Affordability is decided here rather than waited for, so the answer
    // arrives with the click. Mirrors economy.js/enqueueBuild.
    const ok = this._canAfford(p);
    this.order(ok ? 'queued' : 'reject');
  }

  _canAfford(p) {
    const world = this.audio.world;
    if (!world || !world.teams || !p) return true;
    const def = SHIPS[p.classId];
    const team = world.teams[p.team];
    if (!def || !team) return true;
    const squad = Math.max(1, def.squadSize || 1);
    const pop = (def.popCost || 0) * squad;
    if (team.credits < def.cost) return false;
    if ((team.popUsed || 0) + (team.popQueued || 0) + pop > (team.popCap || 0)) return false;
    return true;
  }

  _onFire(p) {
    if (!this.audio.running || !p || !p.weapon || !p.from) return;
    this._counts.fire++;
    const size = p.shooter && p.shooter.def ? p.shooter.def.length : 30;
    this.heat = Math.min(1, this.heat + (size >= CAPITAL_LENGTH ? 0.07 : 0.012));
    const now = this.ctx.currentTime;
    const type = p.weapon.type;
    const at = p.from;

    if (type === WEAPON_TYPE.ION) {
      this._ion(now + 0.001, at, size, { duration: p.weapon.beamDuration || 1.6 });
      return;
    }
    if (type === WEAPON_TYPE.BEAM) {
      this._beam(now + 0.001, at, size, { duration: p.weapon.beamDuration || 1.2 });
      return;
    }
    if (type === WEAPON_TYPE.FLAK) {
      this.buckets.flak.add(now, at.x, at.y, at.z, size, 1);
      return;
    }
    if (type === WEAPON_TYPE.MISSILE) {
      this.buckets.missile.add(now, at.x, at.y, at.z, size, 1);
      return;
    }
    if (size >= CAPITAL_LENGTH) {
      // Individual, because a capital gun firing is an event you should notice.
      if (now - this._last.capitalGun < 1 / RATE.capitalGun) return;
      this._last.capitalGun = now;
      this._capitalGun(now + 0.001, at, size);
      return;
    }
    this.buckets.kineticSmall.add(now, at.x, at.y, at.z, size, 1);
  }

  _onDamage(p) {
    if (!this.audio.running || !p || !p.point) return;
    const size = p.entity && p.entity.def ? p.entity.def.length : 30;
    if (p.entity && p.entity.team === 0) this.threat = Math.min(1, this.threat + 0.03);
    const now = this.ctx.currentTime;
    const key = p.shield ? 'impactShield' : 'impactHull';
    this.buckets[key].add(now, p.point.x, p.point.y, p.point.z, size, p.amount || 1);
  }

  _onDeath(p) {
    if (!p || !p.entity) return;
    const e = p.entity;
    const size = e.def ? e.def.length : 20;
    this.heat = Math.min(1, this.heat + clamp(size / 700, 0.05, 0.6));
    if (e.team === 0) this.threat = Math.min(1, this.threat + clamp(size / 500, 0.08, 0.7));
    this.death(e.position, size);
  }

  _onSpawn(p) {
    if (!this.audio.running || !p || !p.entity) return;
    const e = p.entity;
    if (e.team !== 0) return;
    const now = this.ctx.currentTime;
    if (now - this._last.spawn < 1 / RATE.spawn) return;
    this._last.spawn = now;
    const sp = this.audio.spatial(e.position.x, e.position.y, e.position.z, e.def ? e.def.length : 20, 14000);
    if (!sp) return;
    const v = this._claim(2, 0.8, sp.gain * 0.3);
    if (!v) return;
    const t = now + 0.001;
    const chain = this.audio.positional('sfx', sp, 0.35);
    const n = this._noise(t, 'pink', 1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    sweep(bp.frequency, t, 900, 240, 0.5);
    const g = this.ctx.createGain();
    adsr(g.gain, t, { peak: 0.3, attack: 0.03, decay: 0.1, sustain: 0.5, hold: 0.1, release: 0.3 });
    n.connect(bp);
    bp.connect(g);
    g.connect(chain.input);
    n.start(t, this.rng.range(0, 1.5));
    n.stop(t + 0.8);
    v.bind(chain.input, [n]);
  }

  _onBuildComplete(p) {
    if (!p || p.team !== 0) return;
    this.order('complete');
  }

  _onResource(p) {
    if (!this.audio.running || !p || p.team !== 0 || !(p.delta > 0)) return;
    const now = this.ctx.currentTime;
    if (now - this._last.resource < 1 / RATE.resource) return;
    this._last.resource = now;
    this._tick(now + 0.001, 2100, 0.055);
  }

  _onToast() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (now - this._last.toast < 0.4) return;
    this._last.toast = now;
    this.order('toast');
  }

  _onGameOver(p) {
    if (!this.audio.running) return;
    // A single enormous concussion, non-positional, then the score takes over.
    const t = this.ctx.currentTime + 0.001;
    const v = this._claim(10, 8, 1);
    if (!v) return;
    const g = this.ctx.createGain();
    g.gain.value = 0.7;
    g.connect(this.audio.buses.sfx.lateInput);
    const send = this.ctx.createGain();
    send.gain.value = 0.5;
    g.connect(send);
    send.connect(this.audio.buses.sfx.wet);
    const srcs = [];
    this._detonation(g, srcs, t, p && p.winner === 0 ? 1400 : 1900, 0.8, 6.5);
    this._shock(g, srcs, t + 0.4, 3.2, 0.7);
    v.bind(g, srcs);
    this.audio.duck('music', 6, 1.2, 3);
  }

  /* ----------------------------------------------------------------- helpers */

  _selectionMass(ids) {
    const world = this.audio.world;
    if (!world || !world.entities) return 0;
    let biggest = 0;
    for (let i = 0; i < ids.length; i++) {
      const e = world.entities.get(ids[i]);
      if (e && e.def && e.def.length > biggest) biggest = e.def.length;
    }
    return clamp(Math.log2(1 + biggest / 12) / 8 + Math.log2(1 + ids.length) / 14, 0, 1);
  }

  _noise(t, kind, rate) {
    return noiseSource(this.ctx, this.audio.noise.get(kind, kind === 'crackle' ? 3 : 2.5), rate, true);
  }

  _claim(priority, duration, level) {
    return this.audio.voices.claim(priority, this.ctx.currentTime + duration, clamp(level, 0, 1));
  }

  /** UI feedback outranks everything: it is the answer to a click. */
  _claimUi(duration, priority) {
    return this.audio.voices.claim(
      priority === undefined ? 9 : priority,
      this.ctx.currentTime + duration,
      0.2,
    );
  }

  _hold(category, seconds) {
    this._active[category]++;
    setTimeout(() => {
      this._active[category] = Math.max(0, this._active[category] - 1);
    }, seconds * 1000);
  }

  _cull() {
    this._counts.culled++;
    return false;
  }

  getDebugState() {
    return {
      heat: Math.round(this.heat * 100) / 100,
      threat: Math.round(this.threat * 100) / 100,
      fireEvents: this._counts.fire,
      played: this._counts.played,
      culled: this._counts.culled,
      pendingClusters: Object.keys(this.buckets).reduce((n, k) => n + this.buckets[k].clusters.length, 0),
      active: Object.assign({}, this._active),
      hullProximity: Math.round(this._hullNear * 100) / 100,
      // `lastPrimaryDelay` is the gap between a hull dying and its detonation
      // being *seen* to go. The old hardcoded sequence always said 2.98.
      blast: Object.assign({ open: this._sessions.length }, this._blastStats),
    };
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._sessions.length = 0;
    this._ionMarks.length = 0;
    const a = this._amb;
    if (a) {
      const now = this.ctx.currentTime;
      for (const s of a.sources) {
        try {
          s.stop(now);
        } catch (e) {
          /* already stopped */
        }
      }
      for (const n of a.nodes) safeDisconnect(n);
      this._amb = null;
    }
  }
}

/* Re-exported so the test harness can drive every order sound by name without
   duplicating the list. Keep in sync with `order()`. */
export const ORDER_KINDS = [
  'select', 'move', 'moveQueued', 'attack', 'attackMove', 'guard', 'patrol',
  'stop', 'formation', 'stance', 'queued', 'complete', 'reject', 'cancel',
  'sensorsOpen', 'sensorsClose', 'speed', 'focus', 'toast',
];
