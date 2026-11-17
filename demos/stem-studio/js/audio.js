// Stem Studio: sound. One set of synth voices and one mixer, used for live playback and for the
// offline export, so the WAV you download is the mix you heard.
import { events, audible } from './model.js';

export const SR = 44100, TAIL = 2; // export sample rate, and seconds of ring-out after the last bar
const hz = p => 440 * Math.pow(2, (p - 69) / 12);

const noiseBuffers = new WeakMap();
function noise(ctx) { // one second of noise from a fixed seed, so two renders of the same song are identical
  if (!noiseBuffers.has(ctx)) {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); let s = 1234567;
    for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
    noiseBuffers.set(ctx, b);
  }
  return noiseBuffers.get(ctx);
}
const env = (g, t, peak, attack, hold, release) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.setValueAtTime(peak, t + attack + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release); };
function burst(ctx, out, t, { type, freq, q = 1, peak, decay, offset = 0 }) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise(ctx); f.type = type; f.frequency.value = freq; f.Q.value = q; env(g, t, peak, 0.001, 0, decay);
  src.connect(f).connect(g).connect(out); src.start(t, offset); src.stop(t + decay + 0.05);
}
function tone(ctx, out, t, { type, f0, f1, glide, peak, decay }) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  env(g, t, peak, 0.002, 0, decay); o.connect(g).connect(out); o.start(t); o.stop(t + decay + 0.05);
}

// Play one note of the song at time t (seconds) into a track's input.
export function playNote(ctx, out, ev, t, secPerBeat) {
  const v = ev.v, dur = Math.max(0.05, ev.dur * secPerBeat);
  if (ev.kind === 'drums') {
    if (ev.p === 'kick') { tone(ctx, out, t, { type: 'sine', f0: 155, f1: 44, glide: 0.11, peak: v, decay: 0.3 }); burst(ctx, out, t, { type: 'lowpass', freq: 2500, peak: v * 0.25, decay: 0.012 }); }
    else if (ev.p === 'snare') { burst(ctx, out, t, { type: 'bandpass', freq: 1900, q: 0.7, peak: v * 0.75, decay: 0.17 }); tone(ctx, out, t, { type: 'triangle', f0: 205, f1: 160, glide: 0.06, peak: v * 0.45, decay: 0.1 }); }
    else if (ev.p === 'clap') { for (const [dt, a] of [[0, 0.5], [0.011, 0.6], [0.024, 0.8]]) burst(ctx, out, t + dt, { type: 'bandpass', freq: 1250, q: 1.2, peak: v * a, decay: dt === 0.024 ? 0.2 : 0.02, offset: dt * 7 }); }
    else if (ev.p === 'hat') burst(ctx, out, t, { type: 'highpass', freq: 7600, peak: v * 0.42, decay: 0.045, offset: 0.3 });
    else if (ev.p === 'open') burst(ctx, out, t, { type: 'highpass', freq: 6800, peak: v * 0.36, decay: Math.min(0.32, dur + 0.1), offset: 0.5 });
    else tone(ctx, out, t, { type: 'triangle', f0: 560, f1: 390, glide: 0.05, peak: v * 0.45, decay: 0.1 });
    return;
  }
  const f = ctx.createBiquadFilter(), g = ctx.createGain(), end = t + dur, oscs = []; f.type = 'lowpass';
  const osc = (type, freq, detune, level) => { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = freq; o.detune.value = detune; og.gain.value = level; o.connect(og).connect(f); oscs.push(o); return o; };
  let release = 0.08;
  if (ev.kind === 'bass') {
    osc('sawtooth', hz(ev.p), 0, 0.55); osc('square', hz(ev.p), -4, 0.3); osc('sine', hz(ev.p) / 2, 0, 0.35);
    f.Q.value = 5; f.frequency.setValueAtTime(1100, t); f.frequency.exponentialRampToValueAtTime(190, t + 0.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.8, t + 0.006); g.gain.setTargetAtTime(v * 0.55, t + 0.006, 0.08);
  } else if (ev.kind === 'keys') {
    osc('sawtooth', hz(ev.p), -7, 0.5); osc('sawtooth', hz(ev.p), 7, 0.5); osc('triangle', hz(ev.p) * 2, 0, 0.2); release = 0.3;
    f.Q.value = 0.8; f.frequency.setValueAtTime(700, t); f.frequency.linearRampToValueAtTime(1900, t + Math.min(0.5, dur)); f.frequency.setTargetAtTime(900, t + Math.min(0.5, dur), 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.62, t + 0.03);
  } else { // lead
    const a = osc('square', hz(ev.p), 0, 0.26), b = osc('sawtooth', hz(ev.p), 5, 0.22), lfo = ctx.createOscillator(), lg = ctx.createGain(); release = 0.14;
    lfo.frequency.value = 5.6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(9, t + 0.35); lfo.connect(lg); lg.connect(a.detune); lg.connect(b.detune); lfo.start(t); lfo.stop(end + release + 0.05);
    f.Q.value = 2; f.frequency.setValueAtTime(3200, t); f.frequency.setTargetAtTime(1700, t, 0.25);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.95, t + 0.012);
  }
  g.gain.setTargetAtTime(0.0001, end, release / 4);
  f.connect(g).connect(out); for (const o of oscs) { o.start(t); o.stop(end + release + 0.05); }
}

// Track strips, a touch of echo on the lead, a bus compressor and a master gain.
export function makeMixer(ctx, project) {
  const bus = ctx.createGain(), comp = ctx.createDynamicsCompressor(), master = ctx.createGain(), analyser = ctx.createAnalyser ? ctx.createAnalyser() : null, strips = new Map();
  comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.18; master.gain.value = 0.72;
  bus.connect(comp).connect(master).connect(ctx.destination); if (analyser) { analyser.fftSize = 512; master.connect(analyser); }
  function strip(track) {
    if (strips.has(track.id)) return strips.get(track.id);
    const input = ctx.createGain(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
    input.connect(gain).connect(pan).connect(bus);
    if (track.kind === 'lead') { const d = ctx.createDelay(1.5), fb = ctx.createGain(), wet = ctx.createGain(); d.delayTime.value = 60 / project.bpm * 0.75; fb.gain.value = 0.3; wet.gain.value = 0.24; input.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(gain); }
    const s = { input, gain, pan }; strips.set(track.id, s); return s;
  }
  function update(p) { const on = audible(p); for (const t of p.tracks) { const s = strip(t), now = ctx.currentTime; s.gain.gain.setTargetAtTime(on.has(t.id) ? t.vol : 0, now, 0.015); s.pan.pan.setTargetAtTime(t.pan, now, 0.015); } }
  for (const t of project.tracks) { const s = strip(t), on = audible(project); s.gain.gain.value = on.has(t.id) ? t.vol : 0; s.pan.pan.value = t.pan; }
  return { input: id => strips.get(id) && strips.get(id).input, update, master, analyser, strip };
}

// Schedule everything between two beats. `when(beat)` gives the clock time for a beat.
export function schedule(ctx, mixer, project, stems, fromBeat, toBeat, when, startingMidClip) {
  const spb = 60 / project.bpm;
  for (const ev of events(project, fromBeat, toBeat)) { const out = mixer.input(ev.track); if (out) playNote(ctx, out, ev, when(ev.beat), spb); }
  for (const clip of project.clips) { // loaded stems: plain audio, started at the clip (or part-way in when playback starts inside it)
    if (clip.pattern) continue; const buf = stems.get(clip.track), out = mixer.input(clip.track); if (!buf || !out) continue;
    const c0 = clip.start * 4, c1 = (clip.start + clip.len) * 4, begin = c0 >= fromBeat && c0 < toBeat ? c0 : startingMidClip && c0 < fromBeat && c1 > fromBeat ? fromBeat : null;
    if (begin === null) continue;
    const offset = ((clip.shift || 0) * 4 + (begin - c0)) * spb; if (offset >= buf.duration) continue;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(out); src.start(when(begin), offset, Math.min((c1 - begin) * spb, buf.duration - offset));
  }
}

export function peakOf(buffer) { let peak = 0; for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } } return peak; }

// Render bars [fromBar, toBar) to audio, faster than real time. `only` renders one track on its own (a stem).
export async function renderOffline(project, fromBar, toBar, stems = new Map(), { tail = TAIL, only = null } = {}) {
  const p = only ? { ...project, tracks: project.tracks.map(t => ({ ...t, solo: t.id === only, mute: false })) } : project;
  const spb = 60 / p.bpm, length = Math.round(((toBar - fromBar) * 4 * spb + tail) * SR);
  const ctx = new OfflineAudioContext(2, length, SR), mixer = makeMixer(ctx, p), from = fromBar * 4;
  schedule(ctx, mixer, p, stems, from, toBar * 4, beat => (beat - from) * spb, true);
  const buffer = await ctx.startRendering(), rawPeak = peakOf(buffer);
  let gain = 1; if (rawPeak > 0.98) { gain = 0.98 / rawPeak; for (let c = 0; c < 2; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= gain; } } // never clip: leave a little headroom
  return { buffer, rawPeak, peak: rawPeak * gain, gain, seconds: length / SR };
}

// 16-bit PCM WAV. Pure, so it can be checked without a browser.
export function encodeWav(channels, sampleRate) {
  const n = channels[0].length, ch = channels.length, bytes = n * ch * 2, out = new DataView(new ArrayBuffer(44 + bytes));
  const text = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); out.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sampleRate, true); out.setUint32(28, sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); text(36, 'data'); out.setUint32(40, bytes, true);
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, channels[c][i])); out.setInt16(o, Math.round(s < 0 ? s * 32768 : s * 32767), true); o += 2; }
  return out.buffer;
}
export function readWavHeader(buf) {
  const v = new DataView(buf), text = (o, l) => String.fromCharCode(...new Uint8Array(buf, o, l));
  return { riff: text(0, 4), wave: text(8, 4), fmt: text(12, 4), format: v.getUint16(20, true), channels: v.getUint16(22, true), sampleRate: v.getUint32(24, true), bits: v.getUint16(34, true), data: text(36, 4), dataBytes: v.getUint32(40, true), fileBytes: buf.byteLength };
}
export const wavFromBuffer = b => encodeWav([b.getChannelData(0), b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)], b.sampleRate);

// Live playback: a short look-ahead keeps timing tight while the page stays free to redraw.
export class Engine {
  constructor(getProject) { this.get = getProject; this.ctx = null; this.mixer = null; this.playing = false; this.stems = new Map(); this.loop = null; this.onstop = null; }
  ensure() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state !== 'running') this.ctx.resume(); return this.ctx; }
  play(fromBeat) {
    const ctx = this.ensure(); this.stop(true); this.mixer = makeMixer(ctx, this.get());
    this.t0 = ctx.currentTime + 0.08; this.b0 = fromBeat; this.cursor = fromBeat; this.first = true; this.playing = true;
    this.timer = setInterval(() => this.tick(), 25); this.tick();
  }
  when(beat) { return this.t0 + (beat - this.b0) * 60 / this.get().bpm; }
  position() { if (!this.playing) return null; const spb = 60 / this.get().bpm; return this.b0 + Math.max(0, this.ctx.currentTime - this.t0) / spb; }
  tick() {
    if (!this.playing) return; const p = this.get(), spb = 60 / p.bpm, end = this.loop ? this.loop[1] : p.bars * 4;
    let horizon = this.b0 + (this.ctx.currentTime + 0.2 - this.t0) / spb;
    for (let guard = 0; guard < 4 && this.cursor < horizon; guard++) {
      const to = Math.min(horizon, end);
      if (to > this.cursor) { schedule(this.ctx, this.mixer, p, this.stems, this.cursor, to, b => this.when(b), this.first); this.first = false; this.cursor = to; }
      if (this.cursor >= end) {
        if (!this.loop) { if (this.position() >= end + TAIL / spb) { this.stop(); if (this.onstop) this.onstop(); } return; }
        this.t0 = this.when(end); this.b0 = this.loop[0]; this.cursor = this.loop[0]; this.first = true; horizon = this.b0 + (this.ctx.currentTime + 0.2 - this.t0) / spb; // wrap the loop
      }
    }
  }
  retime() { if (!this.playing) return; const b = this.position(); this.t0 = this.ctx.currentTime; this.b0 = b; this.cursor = Math.max(this.cursor, b); } // call before the tempo changes
  refresh() { if (this.mixer) this.mixer.update(this.get()); }
  stop(quiet) { if (this.timer) clearInterval(this.timer); this.timer = null; if (this.mixer) { const m = this.mixer.master; m.gain.setTargetAtTime(0, this.ctx.currentTime, 0.012); setTimeout(() => m.disconnect(), 120); } this.mixer = null; this.playing = false; void quiet; }
  level() { if (!this.mixer || !this.mixer.analyser) return 0; const a = this.mixer.analyser, d = this.buf || (this.buf = new Float32Array(a.fftSize)); a.getFloatTimeDomainData(d); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); }
}
