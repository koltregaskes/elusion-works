/* The score.

   Ruskay's Homeworld work is the reference and the restraint is the point: an
   ambient electronic bed, modal rather than functional, that leaves the frame
   mostly empty and swells only when the fleet is actually in trouble. There is
   no climactic orchestral cue here and there is no loop — every interval, every
   chord and every note is drawn from the seeded RNG at schedule time, so a given
   map seed has a consistent character without ever repeating a bar.

   Four layers, each entering on its own terms:

     drone   always present, barely. Root and fifth under a slow filter.
     pad     wide, slow chords that fade in over seconds and leave the same way.
     motif   sparse FM bells. The thing you actually remember.
     pulse   only above the tension threshold. A heartbeat, not a drum kit.

   State is read, not pushed: `heat` (weapons discharging) and `threat` (friendly
   hulls taking damage) come from the sfx layer, enemy proximity is scanned from
   the world at 2 Hz, and the four of them decide between calm, tension, battle
   and the two resolutions.

   Scheduling uses the standard lookahead pattern — a render-frame tick that
   commits events up to LOOKAHEAD seconds into the future at absolute context
   times — so nothing depends on frame rate. */

import { bus } from '../core/events.js';
import { clamp, lerp, blip, adsr, noiseSource } from './synth.js';

const LOOKAHEAD = 1.8;

/* Modes as semitone offsets. Aeolian for the quiet, dorian when things are
   merely tense, phrygian once it has gone wrong — the flat second is the whole
   reason that mode exists. */
const MODES = {
  calm: [0, 2, 3, 5, 7, 8, 10],
  tension: [0, 2, 3, 5, 7, 9, 10],
  battle: [0, 1, 3, 5, 7, 8, 10],
  victory: [0, 2, 4, 7, 9, 11],
  defeat: [0, 1, 3, 5, 6, 8, 10],
};

/* Chord shapes as scale degrees. Deliberately open — no thirds stacked in the
   low register, because that is what makes an ambient bed turn to mud. */
const CHORDS = [
  [0, 4, 7],
  [0, 3, 7],
  [0, 4, 9],
  [0, 2, 7],
  [0, 5, 9],
  [0, 3, 10],
];

const ROOT_HZ = 55; // A1

export class MusicLayer {
  constructor(audio, rng) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.rng = rng;
    this.state = 'calm';
    this.intensity = 0;
    this._target = 0;
    this._notes = 0;
    this._maxNotes = 12;
    this._started = false;
    this._resolved = false;
    this._scanAcc = 0;
    this._proximity = 0;
    this._chordIndex = 0;
    this._rootOffset = 0;
    this._counts = { pads: 0, motifs: 0, pulses: 0 };

    this._next = { pad: 0, motif: 0, pulse: 0, root: 0 };

    /* The score owns the resolution: winner 0 is ours, anything else is not. */
    this._offs = [
      bus.on('sim:gameOver', (p) => {
        this.setState(p && p.winner === 0 ? 'victory' : 'defeat');
      }),
    ];
  }

  /* --------------------------------------------------------------- lifecycle */

  start() {
    if (this._started) return;
    this._started = true;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(this.audio.buses.music.input);

    /* Drone. Three sawtooths — root, fifth, octave — dragged through a lowpass
       that opens with intensity. This is the only always-on part of the score. */
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 210;
    this.droneFilter.Q.value = 3.2;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.out);
    this.droneGain.gain.setTargetAtTime(0.28, t, 6);

    this._droneOsc = [];
    const ratios = [1, 1.5, 2.005, 0.5];
    for (let i = 0; i < ratios.length; i++) {
      const o = ctx.createOscillator();
      o.type = i === 3 ? 'sine' : 'sawtooth';
      o.frequency.value = ROOT_HZ * ratios[i];
      o.detune.value = this.rng.range(-7, 7);
      const g = ctx.createGain();
      g.gain.value = i === 3 ? 0.5 : 0.24 / (1 + i * 0.5);
      o.connect(g);
      g.connect(this.droneFilter);
      o.start(t);
      this._droneOsc.push({ osc: o, gain: g, ratio: ratios[i] });
    }

    // Two incommensurate LFOs on the drone filter: the cutoff never returns to
    // the same place at the same time, which is what stops a drone droning.
    this._droneLfo = [];
    const lfoSpecs = [[0.037, 60], [0.0113, 34]];
    for (const [f, amt] of lfoSpecs) {
      const l = ctx.createOscillator();
      l.type = 'sine';
      l.frequency.value = f;
      const a = ctx.createGain();
      a.gain.value = amt;
      l.connect(a);
      a.connect(this.droneFilter.frequency);
      l.start(t);
      this._droneLfo.push({ osc: l, gain: a });
    }

    this._next.pad = t + this.rng.range(1.5, 4);
    this._next.motif = t + this.rng.range(6, 14);
    this._next.pulse = t + 4;
    this._next.root = t + this.rng.range(50, 90);
  }

  /* ------------------------------------------------------------------ state */

  /** Force a state. Used by the harness and by the game-over resolution. */
  setState(name) {
    if (!MODES[name]) return;
    if (this._resolved && name !== 'victory' && name !== 'defeat') return;
    if (this.state === name) return;
    this.state = name;
    if (name === 'victory' || name === 'defeat') {
      this._resolved = true;
      // A match can end before audio was ever unlocked; the state stands, but
      // there is no graph to write the resolution into.
      if (this._started) this._resolve(name);
    }
  }

  get mode() {
    return MODES[this.state] || MODES.calm;
  }

  update(dt, now) {
    if (!this._started) return;

    this._scanAcc += dt;
    if (this._scanAcc > 0.5) {
      this._scanAcc = 0;
      this._scanProximity();
    }

    if (!this._resolved) {
      const sfx = this.audio.sfx;
      const heat = sfx ? sfx.heat : 0;
      const threat = sfx ? sfx.threat : 0;
      // Proximity alone should raise the hair on the back of the neck without
      // a shot being fired; heat and threat are what turn it into a battle.
      this._target = clamp(heat * 0.85 + threat * 0.75 + this._proximity * 0.45, 0, 1);
      this.intensity += (this._target - this.intensity) * clamp(dt * (this._target > this.intensity ? 0.8 : 0.22), 0, 1);
      const i = this.intensity;
      const wanted = i > 0.42 ? 'battle' : i > 0.14 ? 'tension' : 'calm';
      if (wanted !== this.state) this.state = wanted;
    }

    this._applyIntensity(now);
    this._schedule(now);
  }

  _applyIntensity(now) {
    const i = this.intensity;
    const resolved = this._resolved;
    this.droneFilter.frequency.setTargetAtTime(lerp(180, 720, resolved ? 0.5 : i), now, 2.5);
    this.droneGain.gain.setTargetAtTime(lerp(0.22, 0.44, i), now, 3);
    // Nudge the fifth flat as things get worse. Barely perceptible, deeply
    // uncomfortable — the cheapest tension trick in the book.
    const d = this._droneOsc[1];
    if (d) d.osc.detune.setTargetAtTime(lerp(-4, -26, i), now, 4);
  }

  /* -------------------------------------------------------------- scheduling */

  _schedule(now) {
    const horizon = now + LOOKAHEAD;
    const i = this.intensity;

    while (this._next.pad < horizon) {
      const t = Math.max(this._next.pad, now + 0.02);
      this._pad(t);
      this._next.pad = t + this.rng.range(
        lerp(11, 4.5, i),
        lerp(26, 10, i),
      );
    }

    while (this._next.motif < horizon) {
      const t = Math.max(this._next.motif, now + 0.02);
      this._motif(t);
      this._next.motif = t + this.rng.range(
        lerp(6.5, 1.6, i),
        lerp(17, 5.0, i),
      );
    }

    if (i > 0.32 && !this._resolved) {
      const beat = 60 / lerp(56, 92, i) * 2;
      while (this._next.pulse < horizon) {
        const t = Math.max(this._next.pulse, now + 0.02);
        this._pulse(t, i);
        this._next.pulse = t + beat * (this.rng.chance(0.12) ? 1.5 : 1);
      }
    } else {
      this._next.pulse = Math.max(this._next.pulse, now + 0.5);
    }

    // The tonal centre moves once in a long while. It is what stops forty
    // minutes of skirmish sounding like the same forty seconds.
    if (this._next.root < horizon && !this._resolved) {
      const steps = [-5, -3, 2, 3, 5, 7];
      this._rootOffset = clamp(this._rootOffset + this.rng.pick(steps), -7, 7);
      const t = Math.max(this._next.root, now + 0.02);
      const f = ROOT_HZ * Math.pow(2, this._rootOffset / 12);
      for (const d of this._droneOsc) {
        d.osc.frequency.setTargetAtTime(f * d.ratio, t, 8);
      }
      this._next.root = t + this.rng.range(60, 130);
    }
  }

  /** A wide, slow chord. Attack in seconds, release in more seconds. */
  _pad(t) {
    if (this._notes + 3 > this._maxNotes) return;
    const mode = this.mode;
    let idx = this.rng.int(0, CHORDS.length - 1);
    if (idx === this._chordIndex) idx = (idx + 1 + this.rng.int(0, CHORDS.length - 2)) % CHORDS.length;
    this._chordIndex = idx;
    const chord = CHORDS[idx];
    const i = this.intensity;
    const attack = lerp(4.5, 1.2, i);
    const hold = this.rng.range(3, 9);
    const release = lerp(8, 3.4, i);

    const g = this.ctx.createGain();
    g.gain.value = 1;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(lerp(500, 1500, i), t);
    lp.frequency.linearRampToValueAtTime(lerp(360, 1100, i), t + attack + hold + release);
    lp.Q.value = 0.8;
    g.connect(lp);
    lp.connect(this.out);

    const srcs = [];
    for (let n = 0; n < chord.length; n++) {
      const deg = chord[n];
      const oct = n === 0 ? 2 : this.rng.chance(0.5) ? 3 : 4;
      const f = this._degreeHz(mode, deg, oct);
      // Two detuned voices per note: any single oscillator sounds like a test tone.
      for (let d = 0; d < 2; d++) {
        const o = this.ctx.createOscillator();
        o.type = n === 0 ? 'sawtooth' : 'triangle';
        o.frequency.value = f;
        o.detune.value = (d === 0 ? -1 : 1) * this.rng.range(4, 13);
        const a = this.ctx.createGain();
        adsr(a.gain, t, {
          peak: (n === 0 ? 0.10 : 0.062) * lerp(0.75, 1.25, i),
          attack,
          decay: 1.2,
          sustain: 0.82,
          hold,
          release,
        });
        o.connect(a);
        a.connect(g);
        o.start(t);
        o.stop(t + attack + 1.2 + hold + release + 0.2);
        srcs.push(o);
      }
    }
    this._retain(srcs.length ? 3 : 0, t + attack + hold + release + 1.5, g);
    this._counts.pads++;
  }

  /** FM bell. Short modulation index envelope; the tail is pure sine. */
  _motif(t) {
    if (this._notes + 1 > this._maxNotes) return;
    const mode = this.mode;
    const i = this.intensity;
    const phrase = this.rng.chance(lerp(0.25, 0.6, i)) ? this.rng.int(2, 3) : 1;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.out);
    const send = this.ctx.createGain();
    send.gain.value = 0.4;
    g.connect(send);
    send.connect(this.audio.buses.music.wet);

    const srcs = [];
    let deg = this.rng.pick([0, 2, 3, 4, 6]);
    let last = t;
    for (let p = 0; p < phrase; p++) {
      const oct = this.rng.chance(0.3) ? 5 : 4;
      const f = this._degreeHz(mode, deg, oct);
      const dur = this.rng.range(lerp(2.4, 1.0, i), lerp(5.0, 2.2, i));
      const ratio = this.rng.pick([2, 2.76, 3.5, 5.4]);

      const carrier = this.ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = f;
      const mod = this.ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = f * ratio;
      const index = this.ctx.createGain();
      index.gain.setValueAtTime(f * lerp(1.4, 3.2, i), last);
      index.gain.exponentialRampToValueAtTime(f * 0.04, last + 0.5);
      mod.connect(index);
      index.connect(carrier.frequency);

      const a = this.ctx.createGain();
      blip(a.gain, last, lerp(0.075, 0.13, i), 0.006, dur);
      carrier.connect(a);
      a.connect(g);
      carrier.start(last);
      carrier.stop(last + dur + 0.3);
      mod.start(last);
      mod.stop(last + dur + 0.3);
      srcs.push(carrier, mod);

      last += this.rng.range(0.28, 0.9);
      deg = clamp(deg + this.rng.pick([-2, -1, 1, 2, 3]), 0, mode.length - 1);
    }
    this._retain(1, last + 5, g);
    this._counts.motifs++;
  }

  /** A low heartbeat. Present only above the tension threshold. */
  _pulse(t, i) {
    if (this._notes + 1 > this._maxNotes) return;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.out);
    const f = ROOT_HZ * Math.pow(2, this._rootOffset / 12);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.16);
    const a = this.ctx.createGain();
    blip(a.gain, t, lerp(0.10, 0.24, i), 0.004, 0.42);
    o.connect(a);
    a.connect(g);
    o.start(t);
    o.stop(t + 0.6);

    const n = noiseSource(this.ctx, this.audio.noise.get('pink', 2.5), 1, true);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 1.4;
    const ng = this.ctx.createGain();
    blip(ng.gain, t, 0.03 * i, 0.001, 0.05);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(g);
    n.start(t, this.rng.range(0, 1.5));
    n.stop(t + 0.15);

    this._retain(1, t + 0.9, g);
    this._counts.pulses++;
  }

  /**
   * Resolution. Victory rises and opens; defeat sinks and closes. Both are
   * slow — eight to twelve seconds — because the match just ended and there is
   * nothing left to hurry for.
   */
  _resolve(kind) {
    const t = this.ctx.currentTime + 0.4;
    const win = kind === 'victory';
    const mode = MODES[kind];
    const g = this.ctx.createGain();
    g.gain.value = 1;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(win ? 500 : 900, t);
    lp.frequency.linearRampToValueAtTime(win ? 2600 : 220, t + (win ? 7 : 11));
    const send = this.ctx.createGain();
    send.gain.value = 0.55;
    g.connect(lp);
    lp.connect(this.out);
    lp.connect(send);
    send.connect(this.audio.buses.music.wet);

    const degrees = win ? [0, 2, 4, 5] : [0, 1, 3, 5];
    for (let n = 0; n < degrees.length; n++) {
      const oct = 2 + n;
      const f = this._degreeHz(mode, degrees[n], oct);
      for (let d = 0; d < 2; d++) {
        const o = this.ctx.createOscillator();
        o.type = n === 0 ? 'sawtooth' : 'triangle';
        o.frequency.setValueAtTime(f, t);
        // Victory drifts a few cents sharp as it opens; defeat sags a semitone.
        o.detune.setValueAtTime((d === 0 ? -1 : 1) * 9, t);
        o.detune.linearRampToValueAtTime((d === 0 ? -1 : 1) * 9 + (win ? 6 : -100), t + (win ? 8 : 12));
        const a = this.ctx.createGain();
        adsr(a.gain, t + n * (win ? 0.5 : 0.9), {
          peak: win ? 0.11 : 0.13,
          attack: win ? 2.4 : 3.6,
          decay: 1.5,
          sustain: 0.85,
          hold: win ? 4 : 5,
          release: win ? 5 : 7,
        });
        o.connect(a);
        a.connect(g);
        o.start(t);
        o.stop(t + 20);
      }
    }

    if (win) {
      // A high shimmer, only on victory. It is the one bright thing in the game.
      for (let k = 0; k < 3; k++) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = this._degreeHz(mode, [0, 2, 4][k], 6);
        const a = this.ctx.createGain();
        adsr(a.gain, t + 2 + k * 0.7, {
          peak: 0.035, attack: 1.8, decay: 1, sustain: 0.7, hold: 3, release: 5,
        });
        const trem = this.ctx.createOscillator();
        trem.type = 'sine';
        trem.frequency.value = 4.2 + k * 0.9;
        const tremAmt = this.ctx.createGain();
        tremAmt.gain.value = 0.012;
        trem.connect(tremAmt);
        tremAmt.connect(a.gain);
        o.connect(a);
        a.connect(g);
        o.start(t);
        o.stop(t + 20);
        trem.start(t);
        trem.stop(t + 20);
      }
    }

    // Drone follows the resolution rather than sitting under it unchanged.
    const f0 = ROOT_HZ * Math.pow(2, this._rootOffset / 12);
    for (const d of this._droneOsc) {
      d.osc.frequency.setTargetAtTime(f0 * d.ratio * (win ? 1 : 0.5), t, 5);
    }
    this.droneGain.gain.setTargetAtTime(win ? 0.2 : 0.4, t, 5);
    this._retain(2, t + 21, g);
  }

  /* ----------------------------------------------------------------- helpers */

  _degreeHz(mode, degree, octave) {
    const len = mode.length;
    const oct = Math.floor(degree / len);
    const semis = mode[((degree % len) + len) % len] + (oct + octave - 2) * 12 + this._rootOffset;
    return ROOT_HZ * Math.pow(2, semis / 12);
  }

  /** Count a scheduled cluster against the note budget and free it on time. */
  _retain(count, until, head) {
    this._notes += count;
    const ms = Math.max(0, (until - this.ctx.currentTime) * 1000) + 60;
    setTimeout(() => {
      this._notes = Math.max(0, this._notes - count);
      if (head) {
        try {
          head.disconnect();
        } catch (e) {
          /* already gone */
        }
      }
    }, ms);
  }

  /** How close is the nearest enemy to anything of ours worth losing? */
  _scanProximity() {
    const world = this.audio.world;
    if (!world || !world.teams || !world.entities) {
      this._proximity = 0;
      return;
    }
    const base = world.entities.get(world.teams[0].baseId);
    if (!base || base.alive === false) {
      this._proximity = 1;
      return;
    }
    let nearest = Infinity;
    const list = Array.isArray(world.dense) ? world.dense : null;
    const each = (e) => {
      if (!e || e.alive === false || e.team !== 1) return;
      const dx = e.position.x - base.position.x;
      const dy = e.position.y - base.position.y;
      const dz = e.position.z - base.position.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < nearest) nearest = d;
    };
    if (list) for (let i = 0; i < list.length; i++) each(list[i]);
    else world.entities.forEach(each);
    if (!Number.isFinite(nearest)) {
      this._proximity = 0;
      return;
    }
    const d = Math.sqrt(nearest);
    // 18 km away is nothing; 4 km away is a raid already in progress.
    this._proximity = clamp(1 - (d - 4000) / 14000, 0, 1);
  }

  getDebugState() {
    return {
      state: this.state,
      intensity: Math.round(this.intensity * 100) / 100,
      proximity: Math.round(this._proximity * 100) / 100,
      rootOffset: this._rootOffset,
      notes: this._notes,
      pads: this._counts.pads,
      motifs: this._counts.motifs,
      pulses: this._counts.pulses,
    };
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    if (!this._started) return;
    const now = this.ctx.currentTime;
    const stopAll = (list) => {
      for (const item of list) {
        try {
          item.osc.stop(now);
        } catch (e) {
          /* already stopped */
        }
      }
    };
    stopAll(this._droneOsc);
    stopAll(this._droneLfo);
    try {
      this.out.disconnect();
      this.droneGain.disconnect();
      this.droneFilter.disconnect();
    } catch (e) {
      /* already torn down */
    }
    this._started = false;
  }
}
