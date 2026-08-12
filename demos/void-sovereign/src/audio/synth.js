/* WebAudio synthesis primitives.

   Void Sovereign ships zero binary assets (ARCHITECTURE §0), so every sound in
   the game is built here out of oscillators, procedurally filled noise buffers,
   biquads, waveshapers and convolvers fed generated impulse responses.

   Nothing in this file knows about the game. It is a toolbox: the sfx, music and
   voice modules assemble instruments from it. Everything that allocates takes an
   AudioContext so a single kit can be torn down with the context.

   Two conventions hold throughout:
     * times are absolute AudioContext seconds, never deltas
     * exponential ramps never target zero — WebAudio throws — so decays land on
       EPS and are then hard-cut with setValueAtTime */

export const EPS = 1e-4;

export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

export function gainToDb(g) {
  return 20 * Math.log10(Math.max(1e-6, g));
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Hermite smoothstep, tolerant of an inverted edge pair (edge0 > edge1). */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ---------------------------------------------------------------- envelopes */

/** Percussive envelope: silence -> peak in `attack`, exponential decay to zero. */
export function blip(param, t, peak, attack, decay) {
  const a = Math.max(0.0005, attack);
  param.cancelScheduledValues(t);
  param.setValueAtTime(EPS, t);
  param.exponentialRampToValueAtTime(Math.max(EPS, peak), t + a);
  param.exponentialRampToValueAtTime(EPS, t + a + Math.max(0.005, decay));
  param.setValueAtTime(0, t + a + Math.max(0.005, decay) + 0.001);
}

/** Attack / hold / release with an optional sustain plateau below the peak. */
export function adsr(param, t, opts) {
  const peak = Math.max(EPS, opts.peak === undefined ? 1 : opts.peak);
  const attack = Math.max(0.001, opts.attack || 0.01);
  const decay = Math.max(0.001, opts.decay || 0.05);
  const sustain = Math.max(EPS, (opts.sustain === undefined ? 0.7 : opts.sustain) * peak);
  const hold = Math.max(0, opts.hold || 0);
  const release = Math.max(0.005, opts.release || 0.2);
  param.cancelScheduledValues(t);
  param.setValueAtTime(EPS, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(sustain, t + attack + decay);
  const off = t + attack + decay + hold;
  param.setValueAtTime(sustain, off);
  param.exponentialRampToValueAtTime(EPS, off + release);
  param.setValueAtTime(0, off + release + 0.001);
  return off + release + 0.002;
}

/** Glide a param from `from` to `to` over `dur`, exponentially where legal. */
export function sweep(param, t, from, to, dur) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(from, t);
  if (from > 0 && to > 0) param.exponentialRampToValueAtTime(to, t + Math.max(0.005, dur));
  else param.linearRampToValueAtTime(to, t + Math.max(0.005, dur));
}

/* ------------------------------------------------------------------- noise */

/** Procedurally filled noise buffers. Built once per context, shared by everything. */
export class NoiseBank {
  constructor(ctx, rng) {
    this.ctx = ctx;
    this.rng = rng;
    this._cache = new Map();
  }

  /** kind: 'white' | 'pink' | 'brown' | 'crackle' | 'metal' */
  get(kind, seconds) {
    const secs = seconds || 2.5;
    const key = kind + ':' + secs;
    const hit = this._cache.get(key);
    if (hit) return hit;
    const buf = this._build(kind, secs);
    this._cache.set(key, buf);
    return buf;
  }

  _build(kind, seconds) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const n = Math.max(256, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, n, rate);
    const rng = this.rng;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      switch (kind) {
        case 'pink': {
          // Paul Kellet's economical pink filter: -3 dB/octave, close enough.
          let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
          for (let i = 0; i < n; i++) {
            const w = rng.next() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.969 * b2 + w * 0.153852;
            b3 = 0.8665 * b3 + w * 0.3104856;
            b4 = 0.55 * b4 + w * 0.5329522;
            b5 = -0.7616 * b5 - w * 0.016898;
            d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
            b6 = w * 0.115926;
          }
          break;
        }
        case 'brown': {
          // Leaky integrator — the -6 dB/octave slope that carries subsonic weight.
          let last = 0;
          for (let i = 0; i < n; i++) {
            const w = rng.next() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            d[i] = last * 3.2;
          }
          break;
        }
        case 'crackle': {
          // Sparse impulses under a low noise floor: electrical arcing.
          for (let i = 0; i < n; i++) {
            const base = (rng.next() * 2 - 1) * 0.08;
            d[i] = rng.next() < 0.0016 ? (rng.next() * 2 - 1) : base;
          }
          break;
        }
        case 'metal': {
          // White stack rung through a handful of fixed resonances so hull hits
          // have a body rather than a hiss.
          const modes = [0.011, 0.019, 0.031, 0.047, 0.071, 0.113];
          const st = new Float32Array(modes.length * 2);
          for (let i = 0; i < n; i++) {
            const w = rng.next() * 2 - 1;
            let acc = 0;
            for (let m = 0; m < modes.length; m++) {
              const k = m * 2;
              st[k] += modes[m] * (w - st[k] - st[k + 1] * 0.28);
              st[k + 1] += modes[m] * st[k];
              acc += st[k + 1];
            }
            d[i] = clamp(acc * 0.55, -1, 1);
          }
          break;
        }
        default:
          for (let i = 0; i < n; i++) d[i] = rng.next() * 2 - 1;
      }
    }
    return buf;
  }

  dispose() {
    this._cache.clear();
  }
}

/** One-shot noise player. Caller must call `start`/`stop`. */
export function noiseSource(ctx, buffer, rate, loop) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop !== false;
  src.playbackRate.value = rate || 1;
  // Start somewhere random-ish in the buffer so repeated hits do not phase-lock
  // into an audible pattern. Deterministic enough: driven by the schedule time.
  return src;
}

/* ------------------------------------------------------ impulse responses */

/**
 * Generate a stereo impulse response.
 * `tilt` < 1 darkens the tail (a hangar); > 1 keeps it bright (a hard bulkhead).
 */
export function impulseResponse(ctx, rng, opts) {
  const o = opts || {};
  const seconds = o.seconds || 2.2;
  const decay = o.decay || 2.6;
  const tilt = o.tilt === undefined ? 0.55 : o.tilt;
  const predelay = o.predelay || 0.01;
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, n, rate);
  const pre = Math.floor(rate * predelay);

  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    const coef = clamp(tilt, 0.02, 0.98);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / (n - pre);
      const env = Math.pow(1 - t, decay);
      const w = (rng.next() * 2 - 1) * env;
      lp += coef * (w - lp);
      d[i] = lp;
    }
    // A few early reflections stop it sounding like a noise gate.
    const taps = o.taps === undefined ? 5 : o.taps;
    for (let k = 0; k < taps; k++) {
      const idx = pre + Math.floor(rng.range(0.004, 0.09) * rate);
      if (idx < n) d[idx] += (rng.next() * 2 - 1) * 0.45 * Math.pow(0.7, k);
    }
  }
  return buf;
}

/* ---------------------------------------------------------- wave shaping */

/**
 * Soft-clip curve. `drive` 1 = near-transparent, 12 = hard.
 * tanh-shaped so the knee is gradual and there is no hard corner to alias on.
 */
export function driveCurve(drive, n) {
  const size = n || 2048;
  const c = new Float32Array(size);
  const k = Math.max(0.001, drive);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

/** Final brickwall safety net after the limiter. Transparent below ~0.85. */
export function safetyCurve(n) {
  const size = n || 4096;
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = a <= 0.85 ? x : Math.sign(x) * (0.85 + (1 - Math.exp(-(a - 0.85) * 6)) * 0.148);
  }
  return c;
}

/* ------------------------------------------------------------ oscillators */

/** PeriodicWave from a partial amplitude list — cheaper and cleaner than stacking. */
export function harmonicWave(ctx, partials, phases) {
  const n = partials.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 0; i < partials.length; i++) {
    const a = partials[i];
    const p = phases ? phases[i] || 0 : 0;
    real[i + 1] = a * Math.cos(p);
    imag[i + 1] = a * Math.sin(p);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** Odd-harmonic buzz, the raw material for radio voice. */
export function glottalWave(ctx, count, rolloff) {
  const parts = [];
  const c = count || 18;
  const r = rolloff === undefined ? 1.25 : rolloff;
  for (let h = 1; h <= c; h++) parts.push(1 / Math.pow(h, r));
  return harmonicWave(ctx, parts);
}

/* -------------------------------------------------------------- filtering */

/** Parallel bandpass bank — vowel formants, hull resonances, flak crack shaping. */
export function formantBank(ctx, count) {
  const n = count || 3;
  const input = ctx.createGain();
  const output = ctx.createGain();
  const bands = [];
  for (let i = 0; i < n; i++) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 * (i + 1);
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.value = 1 / (1 + i * 0.55);
    input.connect(bp);
    bp.connect(g);
    g.connect(output);
    bands.push({ bp, gain: g });
  }
  return { input, output, bands };
}

/* ------------------------------------------------------------- scheduling */

/** Disconnect a node and swallow the throw if it was never connected. */
export function safeDisconnect(node) {
  if (!node) return;
  try {
    node.disconnect();
  } catch (e) {
    /* no-op */
  }
}
