/* AudioSystem — the mixer, the listener and the voice budget.

   Everything audible in Void Sovereign is synthesised at runtime (ARCHITECTURE
   §0: zero binary assets). This file owns the graph those synths plug into and
   nothing else: the sub-buses, the limiter, the spatial model, the voice cap and
   the gesture/permission dance browsers require before a context will run.

   Signal flow
   -----------
     music ─► musicVol ─► musicTone ─► musicDuck ─┐
     sfx   ─► sfxVol   ─► sfxTone   ─► sfxDuck   ─┼─► preMaster ─► masterVol
     ui    ─► uiVol ───────────────────────────── ┤       │
     voice ─► voiceVol ─► voiceTone ───────────── ┘       │
                       │                                  ▼
                       └──► spaceSend ─► convolver ─► limiter ─► safety ─► out
                                        (generated IR)                     │
                                                                     destination

   The mix is deliberately quiet. Space is the subject: sfx presence falls away
   as the camera pulls back, so strategic zoom is score and UI only, and a
   capital detonation is allowed to duck everything else and own the frame.

   Nothing here throws if audio is unavailable. `available === false` turns every
   public method into a no-op so the game plays silently rather than not at all. */

import { makeRng } from '../core/rng.js';
import { bus } from '../core/events.js';
import {
  NoiseBank, impulseResponse, safetyCurve, dbToGain, clamp, lerp, smoothstep, safeDisconnect,
} from './synth.js';
import { SfxLayer } from './sfx.js';
import { MusicLayer } from './music.js';
import { VoiceLayer } from './voice.js';

const STORAGE_KEY = 'vs.audio.v1';

export const BUSES = ['master', 'music', 'sfx', 'ui', 'voice'];

/* Bus trims in dB. These are the mix, not the user's preference: a slider at
   1.0 means "as loud as this bus is meant to be", not "0 dBFS". */
const TRIM_DB = { master: -1.5, music: -11, sfx: -4.5, ui: -8, voice: -5 };

const DEFAULT_PREFS = { master: 0.8, music: 0.7, sfx: 0.85, ui: 0.75, voice: 0.9, muted: false };

/* Hard ceiling on simultaneously scheduled instruments. A 1,000-unit brawl
   coalesces long before it gets here, but the cap is the backstop that makes
   that guarantee absolute. */
const DEFAULT_MAX_VOICES = 48;

/* Distance beyond which the whole sfx bus has retreated to near-silence. */
const ZOOM_QUIET = 26000;
const ZOOM_LOUD = 7000;

/* --------------------------------------------------------------- voice pool */

/**
 * Fixed-budget voice allocator.
 *
 * Callers `claim()` a slot before building any nodes; a null return means the
 * sound is culled and must not be built at all. Stealing prefers the least
 * important voice, then the quietest, then the oldest — so a fighter's
 * autocannon loses to a mothership detonation every time, and never the reverse.
 */
class VoicePool {
  constructor(ctx, cap) {
    this.ctx = ctx;
    this.cap = cap;
    this.active = [];
    this.culled = 0;
    this.stolen = 0;
    this.peakActive = 0;
    this._seq = 1;
  }

  get count() {
    return this.active.length;
  }

  claim(priority, until, level) {
    const now = this.ctx.currentTime;
    this.sweep(now);
    if (this.active.length >= this.cap) {
      let worst = -1;
      let worstScore = Infinity;
      for (let i = 0; i < this.active.length; i++) {
        const r = this.active[i];
        if (r.priority > priority) continue;
        // Lower is more stealable: unimportant, quiet and old.
        const score = r.priority * 10 + r.level * 6 + r.start * 0.0001;
        if (score < worstScore) {
          worstScore = score;
          worst = i;
        }
      }
      if (worst < 0) {
        this.culled++;
        return null;
      }
      this._release(this.active[worst], now, true);
      this.active.splice(worst, 1);
      this.stolen++;
    }
    const rec = {
      id: this._seq++,
      priority,
      level,
      until,
      start: now,
      head: null,
      sources: null,
    };
    this.active.push(rec);
    if (this.active.length > this.peakActive) this.peakActive = this.active.length;
    return {
      /** Register the node to disconnect and the sources to stop on a steal. */
      bind(head, sources) {
        rec.head = head;
        rec.sources = sources || null;
      },
      /** Extend the reservation — sustained sounds do not know their length up front. */
      hold(t) {
        if (t > rec.until) rec.until = t;
      },
      rec,
    };
  }

  _release(rec, now, fade) {
    if (rec.head && fade) {
      // 12 ms out: short enough to be inaudible in a busy mix, long enough that
      // the steal is not a click.
      const g = rec.head.gain;
      if (g) {
        try {
          g.cancelScheduledValues(now);
          g.setValueAtTime(Math.max(1e-4, g.value), now);
          g.exponentialRampToValueAtTime(1e-4, now + 0.012);
        } catch (e) {
          /* param already finalised */
        }
      }
    }
    if (rec.sources) {
      for (let i = 0; i < rec.sources.length; i++) {
        try {
          rec.sources[i].stop(now + (fade ? 0.02 : 0));
        } catch (e) {
          /* already stopped */
        }
      }
    }
    if (rec.head) {
      const head = rec.head;
      // Disconnect a beat after the fade so the ramp is actually heard.
      setTimeout(() => safeDisconnect(head), fade ? 40 : 0);
    }
    rec.head = null;
    rec.sources = null;
  }

  sweep(now) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].until <= now) {
        this._release(this.active[i], now, false);
        this.active.splice(i, 1);
      }
    }
  }

  clear() {
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.active.length; i++) this._release(this.active[i], now, false);
    this.active.length = 0;
  }
}

/* ------------------------------------------------------------ audio system */

export class AudioSystem {
  /**
   * @param {object} opts
   * @param {number} opts.seed           map seed — the soundscape is deterministic per seed
   * @param {object} [opts.engine]       core/engine.js instance (for engine.camera)
   * @param {object} [opts.world]        sim/world.js instance (read-only: teams, entities)
   * @param {object} [opts.camera]       core/camera.js CameraRig (read-only: .distance)
   * @param {number} [opts.maxVoices]    hard concurrency cap, default 48
   * @param {Storage} [opts.storage]     override for localStorage in tests
   */
  constructor(opts) {
    const o = opts || {};
    this.seed = o.seed || 1;
    this.engine = o.engine || null;
    this.world = o.world || null;
    this.cameraRig = o.camera || null;
    this.available = false;
    this.blocked = false;
    this.prefs = Object.assign({}, DEFAULT_PREFS);
    this._storage = o.storage !== undefined ? o.storage : safeStorage();
    this._offs = [];
    this._unlockers = [];
    this._disposed = false;

    // Listener frame, refreshed each render frame from engine.camera.
    this.listener = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0, distance: 4000 };
    this.presence = 1;
    this._presenceTarget = 1;
    this.sensorsOpen = false;

    this._loadPrefs();

    const Ctor = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    if (!Ctor) {
      this.blocked = true;
      return;
    }

    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch (e) {
      this.blocked = true;
      return;
    }

    const rng = makeRng(this.seed).fork(0x5a17);
    this.rng = rng;
    this.noise = new NoiseBank(this.ctx, rng.fork(1));

    try {
      this._buildGraph();
    } catch (e) {
      this.blocked = true;
      this.available = false;
      try {
        this.ctx.close();
      } catch (e2) {
        /* nothing to close */
      }
      return;
    }

    this.voices = new VoicePool(this.ctx, o.maxVoices || DEFAULT_MAX_VOICES);

    this.sfx = new SfxLayer(this, rng.fork(2));
    this.music = new MusicLayer(this, rng.fork(3));
    this.voice = new VoiceLayer(this, rng.fork(4));

    this.available = true;
    this._applyPrefs(0);
    this._installGestureUnlock();
    this._installVisibility();
    this._installControlEvents();

    // Chrome hands back a running context when a gesture already happened
    // (a reload after a click, for instance). Take it if it is offered.
    if (this.ctx.state === 'running') this._onRunning();
  }

  /* ------------------------------------------------------------------ graph */

  _buildGraph() {
    const ctx = this.ctx;

    this.out = ctx.createGain();
    this.out.gain.value = 1;

    this.safety = ctx.createWaveShaper();
    this.safety.curve = safetyCurve();
    this.safety.oversample = '2x';

    // A limiter, not a compressor: hard ratio, zero knee, fast enough to catch
    // a detonation transient but slow enough on release not to pump.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;

    this.masterVol = ctx.createGain();
    this.preMaster = ctx.createGain();

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
    this._timeBuf = new Float32Array(this.analyser.fftSize);

    this.preMaster.connect(this.masterVol);
    this.masterVol.connect(this.limiter);
    this.limiter.connect(this.safety);
    this.safety.connect(this.out);
    this.out.connect(this.analyser);
    this.out.connect(ctx.destination);

    /* The void. A long, dark impulse — not a room, a suggestion that the sound
       had somewhere to go. Feeding it too hard is the single fastest way to
       ruin the emptiness, so the sends stay low. */
    this.space = ctx.createConvolver();
    this.space.buffer = impulseResponse(this.ctx, this.rng.fork(7), {
      seconds: 3.4, decay: 3.1, tilt: 0.32, predelay: 0.024, taps: 6,
    });
    this.spaceReturn = ctx.createGain();
    this.spaceReturn.gain.value = 0.9;
    this.space.connect(this.spaceReturn);
    this.spaceReturn.connect(this.preMaster);

    /* A tighter, brighter plate for comms: the inside of a helmet, not a hangar. */
    this.comms = ctx.createConvolver();
    this.comms.buffer = impulseResponse(this.ctx, this.rng.fork(8), {
      seconds: 0.7, decay: 4.2, tilt: 0.72, predelay: 0.006, taps: 3,
    });
    this.commsReturn = ctx.createGain();
    this.commsReturn.gain.value = 0.5;
    this.comms.connect(this.commsReturn);
    this.commsReturn.connect(this.preMaster);

    this.buses = {};
    for (let i = 1; i < BUSES.length; i++) this.buses[BUSES[i]] = this._makeBus(BUSES[i]);

    /* Zoom and sensors both act on sfx tone, so the bus keeps its own filter. */
    const sfxTone = ctx.createBiquadFilter();
    sfxTone.type = 'lowpass';
    sfxTone.frequency.value = 18000;
    sfxTone.Q.value = 0.4;
    this.buses.sfx.insert(sfxTone);
    this.sfxTone = sfxTone;

    /* Music is deliberately dull-topped: it must never fight a weapon transient
       for the same 4 kHz that carries the crack. */
    const musicTone = ctx.createBiquadFilter();
    musicTone.type = 'lowpass';
    musicTone.frequency.value = 3600;
    musicTone.Q.value = 0.5;
    this.buses.music.insert(musicTone);

    /* Comms band. Everything that is meant to read as radio lives in 320–3 kHz. */
    const voiceHp = ctx.createBiquadFilter();
    voiceHp.type = 'highpass';
    voiceHp.frequency.value = 300;
    const voiceLp = ctx.createBiquadFilter();
    voiceLp.type = 'lowpass';
    voiceLp.frequency.value = 3200;
    this.buses.voice.insert(voiceHp);
    this.buses.voice.insert(voiceLp);

    // Sends. sfx and voice reach the void and the plate respectively.
    this.buses.sfx.send(this.space, 0.16);
    this.buses.voice.send(this.comms, 0.28);
    this.buses.music.send(this.space, 0.1);
  }

  /**
   * One sub-bus: input -> [inserts] -> volume -> duck -> preMaster,
   * with post-fader sends. `insert()` splices a node in before the fader so
   * tone shaping tracks the fader rather than the other way round.
   */
  _makeBus(name) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const volume = ctx.createGain();
    const duck = ctx.createGain();
    duck.gain.value = 1;
    let tail = input;
    volume.connect(duck);
    duck.connect(this.preMaster);
    tail.connect(volume);
    const b = {
      name,
      input,
      volume,
      duck,
      _tail: tail,
      insert(node) {
        safeDisconnect(b._tail);
        b._tail.connect(node);
        node.connect(volume);
        b._tail = node;
      },
      send(target, amount) {
        const g = ctx.createGain();
        g.gain.value = amount;
        duck.connect(g);
        g.connect(target);
        return g;
      },
    };
    return b;
  }

  /* ------------------------------------------------------------ preferences */

  _loadPrefs() {
    if (!this._storage) return;
    try {
      const raw = this._storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      for (const k of BUSES) {
        if (typeof parsed[k] === 'number') this.prefs[k] = clamp(parsed[k], 0, 1);
      }
      if (typeof parsed.muted === 'boolean') this.prefs.muted = parsed.muted;
    } catch (e) {
      /* corrupt or unavailable storage — defaults stand */
    }
  }

  _savePrefs() {
    if (!this._storage) return;
    try {
      this._storage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch (e) {
      /* private mode, quota, or storage disabled — the mix still works */
    }
  }

  _applyPrefs(tau) {
    if (!this.available) return;
    const t = this.ctx.currentTime;
    const smooth = tau === undefined ? 0.03 : tau;
    const m = this.prefs.muted ? 0 : 1;
    setParam(this.masterVol.gain, curve(this.prefs.master) * dbToGain(TRIM_DB.master) * m, t, smooth);
    for (let i = 1; i < BUSES.length; i++) {
      const name = BUSES[i];
      setParam(this.buses[name].volume.gain, curve(this.prefs[name]) * dbToGain(TRIM_DB[name]), t, smooth);
    }
  }

  /* ------------------------------------------------------------- public API */

  /** Bus names the UI may address. */
  get busNames() {
    return BUSES.slice();
  }

  /** @returns {number} 0..1 slider position, not gain. */
  getVolume(name) {
    return this.prefs[name] === undefined ? 0 : this.prefs[name];
  }

  /** @param {number} value 0..1. Persisted immediately. */
  setVolume(name, value) {
    if (this.prefs[name] === undefined || name === 'muted') return false;
    this.prefs[name] = clamp(Number(value) || 0, 0, 1);
    this._applyPrefs();
    this._savePrefs();
    bus.emit('ui:audioChanged', this.getSettings());
    return true;
  }

  isMuted() {
    return !!this.prefs.muted;
  }

  setMuted(on) {
    this.prefs.muted = !!on;
    this._applyPrefs(0.05);
    this._savePrefs();
    bus.emit('ui:audioChanged', this.getSettings());
    return this.prefs.muted;
  }

  toggleMute() {
    return this.setMuted(!this.prefs.muted);
  }

  /** Everything the UI needs to draw a settings panel. */
  getSettings() {
    return {
      master: this.prefs.master,
      music: this.prefs.music,
      sfx: this.prefs.sfx,
      ui: this.prefs.ui,
      voice: this.prefs.voice,
      muted: !!this.prefs.muted,
      available: this.available,
      running: this.available && this.ctx.state === 'running',
    };
  }

  /**
   * Resume the context. Safe to call at any time and from anywhere; browsers
   * only honour it inside a user gesture, so it is also wired to the first
   * pointer or key event automatically.
   * @returns {Promise<boolean>} whether the context is now running
   */
  unlock() {
    if (!this.available) return Promise.resolve(false);
    if (this.ctx.state === 'running') return Promise.resolve(true);
    return this.ctx
      .resume()
      .then(() => {
        this._onRunning();
        return this.ctx.state === 'running';
      })
      .catch(() => false);
  }

  suspend() {
    if (!this.available || this.ctx.state !== 'running') return Promise.resolve(false);
    return this.ctx.suspend().then(() => true).catch(() => false);
  }

  get running() {
    return this.available && this.ctx.state === 'running';
  }

  /** Duck a bus by `db` for `hold` seconds, recovering over `release`. */
  duck(name, db, hold, release) {
    if (!this.available) return;
    const b = this.buses[name];
    if (!b) return;
    const t = this.ctx.currentTime;
    const g = b.duck.gain;
    const target = dbToGain(-Math.abs(db));
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.min(g.value, 1), t);
      g.linearRampToValueAtTime(target, t + 0.02);
      g.setValueAtTime(target, t + 0.02 + Math.max(0, hold || 0.2));
      g.linearRampToValueAtTime(1, t + 0.02 + Math.max(0, hold || 0.2) + Math.max(0.05, release || 0.4));
    } catch (e) {
      /* param contention — the next duck will re-establish it */
    }
  }

  /** Time-domain peak and RMS of the master output. Used by the test harness. */
  measure() {
    if (!this.available) return { peak: 0, rms: 0 };
    this.analyser.getFloatTimeDomainData(this._timeBuf);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < this._timeBuf.length; i++) {
      const v = this._timeBuf[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / this._timeBuf.length) };
  }

  getAnalyser() {
    return this.available ? this.analyser : null;
  }

  /** Snapshot for the debug overlay and the numeric assertions in the harness. */
  getDebugState() {
    if (!this.available) {
      return { available: false, blocked: this.blocked, state: 'unavailable' };
    }
    const m = this.measure();
    return {
      available: true,
      blocked: false,
      state: this.ctx.state,
      sampleRate: this.ctx.sampleRate,
      baseLatency: this.ctx.baseLatency || 0,
      outputLatency: this.ctx.outputLatency || 0,
      voices: this.voices.count,
      voiceCap: this.voices.cap,
      peakVoices: this.voices.peakActive,
      culled: this.voices.culled,
      stolen: this.voices.stolen,
      presence: Math.round(this.presence * 1000) / 1000,
      cameraDistance: Math.round(this.listener.distance),
      limiterReduction: Math.round(this.limiter.reduction * 100) / 100,
      peak: Math.round(m.peak * 10000) / 10000,
      rms: Math.round(m.rms * 10000) / 10000,
      settings: this.getSettings(),
      music: this.music.getDebugState(),
      sfx: this.sfx.getDebugState(),
      voice: this.voice.getDebugState(),
    };
  }

  /* -------------------------------------------------------------- per-frame */

  /**
   * @param {number} dt      render delta in seconds
   * @param {number} elapsed total elapsed seconds
   * @param {object} camera  engine.camera (THREE.PerspectiveCamera)
   */
  update(dt, elapsed, camera) {
    if (!this.available || this._disposed) return;
    const running = this.ctx.state === 'running';
    this._syncListener(camera);
    const now = this.ctx.currentTime;
    this.voices.sweep(now);
    if (!running) return;

    // Presence: how much of the battle reaches the ear at this zoom. One
    // smoothed scalar drives both the sfx fader and its top end, so pulling
    // back to the strategic view genuinely leaves you with score and UI.
    this._presenceTarget = smoothstep(ZOOM_QUIET, ZOOM_LOUD, this.listener.distance);
    if (this.sensorsOpen) this._presenceTarget *= 0.12;
    this.presence += (this._presenceTarget - this.presence) * clamp(dt * 2.2, 0, 1);
    const p = this.presence;
    setParam(this.buses.sfx.volume.gain,
      curve(this.prefs.sfx) * dbToGain(TRIM_DB.sfx) * lerp(0.06, 1, p), now, 0.12);
    setParam(this.sfxTone.frequency, lerp(900, 18000, p * p), now, 0.16);
    // The score comes forward as the battle recedes — it is what is left.
    setParam(this.buses.music.volume.gain,
      curve(this.prefs.music) * dbToGain(TRIM_DB.music) * lerp(1.35, 1, p), now, 0.3);

    this.sfx.update(dt, now);
    this.music.update(dt, now);
    this.voice.update(dt, now);
  }

  _syncListener(camera) {
    const l = this.listener;
    if (camera && camera.matrixWorld) {
      const e = camera.matrixWorld.elements;
      l.x = e[12];
      l.y = e[13];
      l.z = e[14];
      // Column 0 of the world matrix is the camera's right vector.
      l.rx = e[0];
      l.ry = e[1];
      l.rz = e[2];
    }
    if (this.cameraRig && typeof this.cameraRig.distance === 'number') {
      l.distance = this.cameraRig.distance;
    }
  }

  /**
   * Spatial parameters for a world-space point.
   * Returns null when the sound is beyond `maxDist` and must not be built.
   *
   * The reference distance tracks the camera's own working distance, so a fight
   * you have zoomed into mixes correctly whether that is 800 m or 8 km away,
   * while the global presence term still silences the strategic view.
   */
  spatial(x, y, z, size, maxDist) {
    const l = this.listener;
    const dx = x - l.x;
    const dy = y - l.y;
    const dz = z - l.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (maxDist && dist > maxDist) return null;
    const ref = clamp(l.distance, 500, 14000) * 0.85 + (size || 0) * 2.4 + 220;
    const n = dist / ref;
    const gain = 1 / (1 + n * n * 0.55 + n * 0.55);
    if (gain < 0.008) return null;
    const pan = dist > 1 ? clamp((dx * l.rx + dy * l.ry + dz * l.rz) / dist, -1, 1) : 0;
    // Air has nothing to do with it: this is the film convention that distant
    // things are dull. It reads as depth and it stops the mix turning to grit.
    const cutoff = lerp(16000, 700, clamp(n * 0.55, 0, 1));
    return { dist, gain, pan: pan * 0.85, cutoff, ref };
  }

  /**
   * Build the standard tail of a positional sound: panner + tone + output gain,
   * already connected to the given bus. Returns the node to feed.
   */
  positional(busName, sp, level) {
    const ctx = this.ctx;
    const target = this.buses[busName] || this.buses.sfx;
    const out = ctx.createGain();
    out.gain.value = 1;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = sp ? sp.cutoff : 18000;
    tone.Q.value = 0.5;
    const amp = ctx.createGain();
    amp.gain.value = (sp ? sp.gain : 1) * (level === undefined ? 1 : level);
    out.connect(tone);
    tone.connect(amp);
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = sp ? sp.pan : 0;
      amp.connect(pan);
      pan.connect(target.input);
    } else {
      amp.connect(target.input);
    }
    return { input: out, amp, tone };
  }

  /* -------------------------------------------------------------- lifecycle */

  _onRunning() {
    if (this._started) return;
    this._started = true;
    this.music.start();
    this.sfx.start();
  }

  _installGestureUnlock() {
    if (typeof window === 'undefined') return;
    const kick = () => {
      this.unlock();
      // One gesture is enough; if it was not (an iOS quirk) the listeners are
      // re-armed by the failed resume below.
      if (this.ctx.state === 'running') this._removeUnlockers();
    };
    const types = ['pointerdown', 'mousedown', 'touchend', 'keydown'];
    for (const t of types) {
      const fn = () => kick();
      window.addEventListener(t, fn, { capture: true, passive: true });
      this._unlockers.push({ t, fn });
    }
  }

  _removeUnlockers() {
    for (const u of this._unlockers) {
      window.removeEventListener(u.t, u.fn, { capture: true });
    }
    this._unlockers.length = 0;
  }

  /* A backgrounded tab should not keep a synth running. */
  _installVisibility() {
    if (typeof document === 'undefined') return;
    this._onVis = () => {
      if (!this.available) return;
      if (document.hidden) {
        if (this.ctx.state === 'running') {
          this._wasRunning = true;
          this.ctx.suspend().catch(() => {});
        }
      } else if (this._wasRunning) {
        this._wasRunning = false;
        this.ctx.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', this._onVis);
  }

  /* Event-driven control so the UI agent can add sliders without holding a
     reference to this object. The direct methods above remain the primary API. */
  _installControlEvents() {
    this._offs.push(bus.on('ui:audioVolume', (p) => {
      if (!p || typeof p.bus !== 'string') return;
      this.setVolume(p.bus, p.value);
    }));
    this._offs.push(bus.on('ui:audioMute', (p) => {
      if (p && typeof p.muted === 'boolean') this.setMuted(p.muted);
      else this.toggleMute();
    }));
    this._offs.push(bus.on('ui:sensorsToggle', (p) => {
      this.sensorsOpen = !!(p && p.open);
    }));
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._removeUnlockers();
    if (this._onVis && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVis);
    }
    if (!this.available) {
      if (this.ctx) {
        try {
          this.ctx.close();
        } catch (e) {
          /* already closed */
        }
      }
      return;
    }
    this.sfx.dispose();
    this.music.dispose();
    this.voice.dispose();
    this.voices.clear();
    this.noise.dispose();
    for (const name of Object.keys(this.buses)) {
      const b = this.buses[name];
      safeDisconnect(b.input);
      safeDisconnect(b.volume);
      safeDisconnect(b.duck);
    }
    safeDisconnect(this.space);
    safeDisconnect(this.spaceReturn);
    safeDisconnect(this.comms);
    safeDisconnect(this.commsReturn);
    safeDisconnect(this.preMaster);
    safeDisconnect(this.masterVol);
    safeDisconnect(this.limiter);
    safeDisconnect(this.safety);
    safeDisconnect(this.out);
    safeDisconnect(this.analyser);
    this.available = false;
    try {
      this.ctx.close();
    } catch (e) {
      /* context may already be closing */
    }
  }
}

/* ------------------------------------------------------------------ helpers */

/** Slider position -> gain. Roughly perceptual; 0 is genuinely off. */
function curve(v) {
  const x = clamp(v === undefined ? 0 : v, 0, 1);
  return x <= 0 ? 0 : Math.pow(x, 1.8);
}

function setParam(param, value, t, tau) {
  const v = Number.isFinite(value) ? value : 0;
  try {
    if (tau > 0) param.setTargetAtTime(v, t, tau);
    else param.setValueAtTime(v, t);
  } catch (e) {
    /* the param was finalised by a stop() — nothing to do */
  }
}

function safeStorage() {
  try {
    const s = window.localStorage;
    s.getItem(STORAGE_KEY);
    return s;
  } catch (e) {
    return null;
  }
}
