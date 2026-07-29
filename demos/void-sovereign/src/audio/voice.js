/* Unit acknowledgement — radio chatter.

   Real speech synthesis is not available offline inside the no-assets rule, so
   this does not attempt words. It builds the *idiom* instead: a squelch break, a
   short burst of formant-shaped, band-limited, ring-modulated buzz with a
   syllable rhythm and a pitch contour, comms artefacts over the top, and a
   squelch tail. The brain hears a crew answering and does not go looking for
   consonants.

   Why it exists at all: the acknowledgement bark is the genre's canonical
   latency-hiding technique — the "Yes, Sir!" that fires on the click and covers
   the tick the order is actually waiting for. It is triggered from `cmd:*` and
   `sel:changed`, which are input events, so it lands before the sim has run.

   Character comes from the hull that answers. A fighter pilot is high, fast and
   compressed with a lot of static between them and you; a capital's bridge is
   low, unhurried, and sitting in a room.

   Contours carry the meaning, since the words cannot:
     fall      acknowledgement — "moving"
     rise      urgency — "engaging"
     riseFall  report — "standing by"
     flat      routine */

import { bus } from '../core/events.js';
import { SHIPS, ROLE } from '../ships/catalog.js';
import {
  glottalWave, formantBank, noiseSource, driveCurve, blip, clamp, lerp, safeDisconnect,
} from './synth.js';

/* Formant triples. Not a phoneme set — a set of timbres that read as vowels. */
const VOWELS = [
  [700, 1220, 2600],
  [400, 1900, 2550],
  [360, 750, 2400],
  [530, 1840, 2480],
  [570, 840, 2410],
  [640, 1190, 2390],
  [490, 1350, 2500],
];

/* Per-role voice character. `pitch` is the fundamental range in Hz. */
const CHARACTER = {
  [ROLE.FIGHTER]: { pitch: [152, 198], syl: [0.055, 0.085], count: [3, 5], tilt: 1.09, static: 0.85, room: 0.10 },
  [ROLE.CORVETTE]: { pitch: [132, 168], syl: [0.062, 0.095], count: [3, 5], tilt: 1.04, static: 0.7, room: 0.12 },
  [ROLE.FRIGATE]: { pitch: [104, 136], syl: [0.075, 0.115], count: [4, 6], tilt: 0.98, static: 0.5, room: 0.2 },
  [ROLE.CAPITAL]: { pitch: [80, 104], syl: [0.1, 0.15], count: [4, 7], tilt: 0.9, static: 0.32, room: 0.34 },
  [ROLE.STRUCTURE]: { pitch: [74, 96], syl: [0.11, 0.16], count: [4, 7], tilt: 0.87, static: 0.26, room: 0.42 },
  [ROLE.SUPPORT]: { pitch: [116, 150], syl: [0.08, 0.12], count: [3, 5], tilt: 1.0, static: 0.55, room: 0.18 },
  [ROLE.RESOURCE]: { pitch: [122, 152], syl: [0.085, 0.12], count: [2, 4], tilt: 1.02, static: 0.6, room: 0.14 },
};

const DEFAULT_CHARACTER = CHARACTER[ROLE.CORVETTE];

/* Cooldowns in seconds. A forty-ship selection is one crew answering for the
   group, not forty crews talking over each other. */
const GLOBAL_COOLDOWN = 0.30;
const KIND_COOLDOWN = { select: 1.5, move: 0.85, attack: 0.7, order: 1.1, build: 2.5, distress: 3.5 };
const MAX_CONCURRENT = 2;

export class VoiceLayer {
  constructor(audio, rng) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.rng = rng;
    this._offs = [];
    this._last = { any: 0 };
    this._active = 0;
    this._counts = { spoken: 0, suppressed: 0 };
    this._wave = glottalWave(this.ctx, 20, 1.3);
    this._drive = driveCurve(4.5);
    this._lastSelectionSize = 0;

    const on = (t, fn) => this._offs.push(bus.on(t, fn));
    on('sel:changed', (p) => this._onSelect(p));
    on('cmd:move', (p) => this.bark(this._roleOf(p && p.ids), 'move', 'fall'));
    on('cmd:attack', (p) => this.bark(this._roleOf(p && p.ids), 'attack', 'rise'));
    on('cmd:formation', (p) => this.bark(this._roleOf(p && p.ids), 'order', 'flat'));
    on('cmd:stance', (p) => this.bark(this._roleOf(p && p.ids), 'order', 'flat'));
    on('sim:buildComplete', (p) => {
      if (!p || p.team !== 0) return;
      const def = SHIPS[p.classId];
      this.bark(def ? def.role : ROLE.CORVETTE, 'build', 'riseFall');
    });
    on('sim:death', (p) => this._onDeath(p));
  }

  /* -------------------------------------------------------------------- API */

  /**
   * Speak one acknowledgement.
   * @param {string} role     ROLE value — decides the voice's character
   * @param {string} kind     cooldown bucket: select|move|attack|order|build|distress
   * @param {string} contour  fall|rise|riseFall|flat
   * @param {object} [at]     world position; omit for a non-positional bark
   */
  bark(role, kind, contour, at) {
    if (!this.audio.running) return false;
    const now = this.ctx.currentTime;
    if (now - this._last.any < GLOBAL_COOLDOWN) return this._suppress();
    const cd = KIND_COOLDOWN[kind] === undefined ? 1 : KIND_COOLDOWN[kind];
    if (now - (this._last[kind] || 0) < cd) return this._suppress();
    if (this._active >= MAX_CONCURRENT) return this._suppress();

    const v = this.audio.voices.claim(8, now + 1.4, 0.35);
    if (!v) return this._suppress();

    this._last.any = now;
    this._last[kind] = now;
    this._build(now + 0.001, role, kind, contour, at, v);
    this._counts.spoken++;
    // Voice sits above combat: everything else steps back a couple of dB while
    // somebody is talking, which is the whole reason it stays intelligible.
    this.audio.duck('sfx', 3, 0.35, 0.5);
    return true;
  }

  /* --------------------------------------------------------------- synthesis */

  _build(t, role, kind, contour, at, voice) {
    const ctx = this.ctx;
    const ch = CHARACTER[role] || DEFAULT_CHARACTER;
    const rng = this.rng;
    const f0 = rng.range(ch.pitch[0], ch.pitch[1]);
    const syllables = rng.int(ch.count[0], ch.count[1]);

    /* Output tail. Positional barks pan and attenuate; the fleet answering a
       selection does not, because that is the player's own comms panel. */
    const sp = at ? this.audio.spatial(at.x, at.y, at.z, 200, 30000) : null;
    const out = ctx.createGain();
    out.gain.value = 1;
    let sink = this.audio.buses.voice.input;
    let level = 1;
    if (sp) {
      // Fold distance into gain but keep the comms band open — a radio does not
      // get muffled by distance, it gets noisier.
      level = clamp(0.45 + sp.gain * 0.55, 0.35, 1);
      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = sp.pan * 0.6;
        pan.connect(sink);
        sink = pan;
      }
    }
    const outLevel = ctx.createGain();
    outLevel.gain.value = level * 0.9;
    out.connect(outLevel);
    outLevel.connect(sink);

    // Bridge room for the big hulls.
    if (ch.room > 0.15) {
      const send = ctx.createGain();
      send.gain.value = ch.room;
      outLevel.connect(send);
      send.connect(this.audio.comms);
    }

    /* Radio chain. Saturation then the comms band: this is what makes a buzz
       sound like it came down a wire rather than out of a synthesiser. */
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._drive;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1250;
    band.Q.value = 0.75;
    shaper.connect(band);
    band.connect(out);

    /* Comms artefacts: a gate that occasionally drops out mid-sentence. */
    const gate = ctx.createGain();
    gate.gain.value = 1;
    gate.connect(shaper);

    const formants = formantBank(ctx, 3);
    formants.output.connect(gate);

    const srcs = [];

    /* Carrier: odd-harmonic buzz through the formants. */
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this._wave);
    osc.frequency.setValueAtTime(f0, t);
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0;
    osc.connect(oscGain);
    oscGain.connect(formants.input);

    /* Ring modulation: the vocoded, "not-quite-human" comms character. Kept
       partial — fully ring-modulated reads as a robot, not a person on a radio. */
    const ringCarrier = ctx.createGain();
    ringCarrier.gain.value = 0;
    const ringOsc = ctx.createOscillator();
    ringOsc.type = 'sine';
    ringOsc.frequency.value = rng.range(58, 96);
    ringOsc.connect(ringCarrier.gain);
    oscGain.connect(ringCarrier);
    const ringMix = ctx.createGain();
    ringMix.gain.value = 0.42;
    ringCarrier.connect(ringMix);
    ringMix.connect(formants.input);

    /* Breath / static bed, gated by the same syllable envelope plus a constant
       floor so the channel is audibly open even between syllables. */
    const hiss = noiseSource(ctx, this.audio.noise.get('white', 2.5), 1, true);
    const hissBp = ctx.createBiquadFilter();
    hissBp.type = 'bandpass';
    hissBp.frequency.value = 2200;
    hissBp.Q.value = 0.9;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    hiss.connect(hissBp);
    hissBp.connect(hissGain);
    hissGain.connect(gate);

    /* --- squelch open --- */
    this._squelch(gate, srcs, t, 0.045, true);
    const speechStart = t + 0.05;

    /* --- syllables --- */
    let cursor = speechStart;
    const spans = [];
    for (let i = 0; i < syllables; i++) {
      const len = rng.range(ch.syl[0], ch.syl[1]) * (contour === 'rise' ? 0.85 : 1);
      spans.push({ at: cursor, len });
      cursor += len + rng.range(0.012, 0.045);
      // The odd longer gap reads as a breath, or as thinking.
      if (rng.chance(0.18)) cursor += rng.range(0.03, 0.09);
    }
    const speechEnd = cursor;
    const span = Math.max(0.001, speechEnd - speechStart);

    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      const u = (s.at - speechStart) / span;
      const pitch = f0 * this._contour(contour, u, i, spans.length);
      osc.frequency.setValueAtTime(pitch * rng.range(0.97, 1.03), s.at);
      // A little drift inside the syllable — a held pitch sounds synthesised.
      osc.frequency.linearRampToValueAtTime(pitch * rng.range(0.94, 1.06), s.at + s.len);

      const vowel = VOWELS[rng.int(0, VOWELS.length - 1)];
      for (let b = 0; b < formants.bands.length; b++) {
        const f = vowel[b] * ch.tilt * rng.range(0.96, 1.04);
        formants.bands[b].bp.frequency.setValueAtTime(f, s.at);
        formants.bands[b].bp.Q.setValueAtTime(b === 0 ? 7 : 9 + b * 2, s.at);
      }

      // Consonant-ish attack on some syllables: a fast noise tick at onset.
      const stress = i === 0 || (contour === 'rise' && i === spans.length - 1) ? 1 : rng.range(0.62, 0.95);
      blip(oscGain.gain, s.at, 0.5 * stress, 0.008, s.len);
      blip(hissGain.gain, s.at, 0.05 * ch.static * stress, 0.004, s.len * 0.8);
      if (rng.chance(0.4)) {
        const tick = noiseSource(ctx, this.audio.noise.get('white', 2.5), 1, true);
        const tf = ctx.createBiquadFilter();
        tf.type = 'bandpass';
        tf.frequency.value = rng.range(1800, 3200);
        tf.Q.value = 1.6;
        const tg = ctx.createGain();
        blip(tg.gain, s.at, 0.11 * ch.static, 0.001, 0.014);
        tick.connect(tf);
        tf.connect(tg);
        tg.connect(gate);
        tick.start(s.at, rng.range(0, 1.5));
        tick.stop(s.at + 0.04);
        srcs.push(tick);
      }
    }

    /* --- artefacts: a dropout roughly one bark in four --- */
    if (rng.chance(0.26) && spans.length > 2) {
      const cut = spans[rng.int(1, spans.length - 2)].at + rng.range(0.005, 0.03);
      gate.gain.setValueAtTime(1, cut);
      gate.gain.linearRampToValueAtTime(0.04, cut + 0.004);
      gate.gain.setValueAtTime(0.04, cut + rng.range(0.02, 0.05));
      gate.gain.linearRampToValueAtTime(1, cut + rng.range(0.05, 0.08));
    }

    /* --- squelch close --- */
    this._squelch(gate, srcs, speechEnd + 0.02, 0.06, false);

    const stopAt = speechEnd + 0.28;
    osc.start(t);
    osc.stop(stopAt);
    ringOsc.start(t);
    ringOsc.stop(stopAt);
    hiss.start(t, rng.range(0, 1.5));
    hiss.stop(stopAt);
    srcs.push(osc, ringOsc, hiss);

    // The channel hiss decays away after the squelch rather than being cut.
    hissGain.gain.setValueAtTime(0.03 * ch.static, speechEnd + 0.02);
    hissGain.gain.exponentialRampToValueAtTime(1e-4, stopAt);

    this._active++;
    voice.hold(stopAt + 0.1);
    voice.bind(out, srcs);
    const ms = (stopAt - this.ctx.currentTime) * 1000 + 60;
    setTimeout(() => {
      this._active = Math.max(0, this._active - 1);
      safeDisconnect(formants.input);
      safeDisconnect(formants.output);
      safeDisconnect(gate);
      safeDisconnect(shaper);
      safeDisconnect(band);
      safeDisconnect(outLevel);
    }, ms);
  }

  /** Squelch break: a short filtered noise burst either side of the message. */
  _squelch(dest, srcs, t, dur, opening) {
    const ctx = this.ctx;
    const n = noiseSource(ctx, this.audio.noise.get('white', 2.5), 1, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(opening ? 1400 : 2600, t);
    bp.frequency.exponentialRampToValueAtTime(opening ? 2800 : 1100, t + dur);
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    blip(g.gain, t, opening ? 0.24 : 0.3, 0.0015, dur);
    n.connect(bp);
    bp.connect(g);
    g.connect(dest);
    n.start(t, this.rng.range(0, 1.5));
    n.stop(t + dur + 0.08);
    srcs.push(n);
  }

  /**
   * Pitch multiplier across the message.
   * A falling contour is what "acknowledged" sounds like in every language;
   * a rising one is what urgency sounds like.
   */
  _contour(kind, u, i, n) {
    switch (kind) {
      case 'rise': return lerp(0.92, 1.28, u * u);
      case 'fall': return lerp(1.14, 0.86, Math.sqrt(u));
      case 'riseFall': return 0.95 + Math.sin(u * Math.PI) * 0.24 - u * 0.12;
      default: return 1 + (i % 2 === 0 ? 0.03 : -0.03) * (1 - u) - u * 0.06;
    }
  }

  /* ------------------------------------------------------------- triggering */

  _onSelect(p) {
    const ids = p && p.ids ? p.ids : [];
    if (!ids.length) {
      this._lastSelectionSize = 0;
      return;
    }
    // Only report in when the selection actually grew — repeatedly reselecting
    // the same wing should not make them keep announcing themselves.
    const grew = ids.length > this._lastSelectionSize;
    this._lastSelectionSize = ids.length;
    if (!grew) return;
    this.bark(this._roleOf(ids), 'select', 'riseFall');
  }

  _onDeath(p) {
    if (!p || !p.entity || p.entity.team !== 0) return;
    const e = p.entity;
    const def = e.def || SHIPS[e.classId];
    if (!def || def.length < 100) return; // fighters do not get last words
    // A clipped, rising fragment cut off by the squelch: a distress call that
    // does not finish.
    this.bark(def.role, 'distress', 'rise', e.position);
  }

  /** The largest hull in the selection answers for the group. */
  _roleOf(ids) {
    const world = this.audio.world;
    if (!world || !world.entities || !ids || !ids.length) return ROLE.CORVETTE;
    let best = null;
    let bestLen = -1;
    for (let i = 0; i < ids.length; i++) {
      const e = world.entities.get(ids[i]);
      if (!e || !e.def) continue;
      if (e.def.length > bestLen) {
        bestLen = e.def.length;
        best = e;
      }
    }
    return best ? best.role : ROLE.CORVETTE;
  }

  _suppress() {
    this._counts.suppressed++;
    return false;
  }

  /* ------------------------------------------------------------- lifecycle */

  update() {
    /* Stateless between barks — everything is scheduled at trigger time. */
  }

  getDebugState() {
    return {
      spoken: this._counts.spoken,
      suppressed: this._counts.suppressed,
      active: this._active,
    };
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
  }
}

export const CONTOURS = ['fall', 'rise', 'riseFall', 'flat'];
export const VOICE_ROLES = Object.keys(CHARACTER);
