// The film's backing track, made from nothing but arithmetic: node tools/make-bed.mjs
// Writes tools/film/assets/bed.wav, then ffmpeg turns it into bed.m4a. 100 beats a minute, so a bar is 2.4 s and every scene starts on a bar.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const SR = 44100, BAR = 2.4, BEAT = 0.6, LEN = 93.6, N = Math.round(LEN * SR), L = new Float32Array(N), R = new Float32Array(N);
const hz = semis => 220 * Math.pow(2, semis / 12); // semitones from A3
const add = (t, f, dur, gain, { attack = 0.01, pan = 0, shape = 0, bend = 1 } = {}) => { const i0 = Math.round(t * SR), n = Math.round(dur * SR); let ph = 0;
  for (let i = 0; i < n && i0 + i < N; i++) { const x = i / n, env = Math.min(1, i / (attack * SR)) * Math.pow(1 - x, 1.6), fr = f * (1 + (bend - 1) * x); ph += 2 * Math.PI * fr / SR; const s = (Math.sin(ph) + shape * Math.sin(2 * ph) * 0.5 + shape * Math.sin(3 * ph) * 0.25) * env * gain; L[i0 + i] += s * (1 - pan) * 0.7; R[i0 + i] += s * (1 + pan) * 0.7; } };
let seed = 99; const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; // the same hiss every time
const tick = (t, gain) => { const i0 = Math.round(t * SR), n = Math.round(0.03 * SR); let last = 0; for (let i = 0; i < n && i0 + i < N; i++) { const w = noise(), hp = w - last; last = w; const s = hp * Math.pow(1 - i / n, 3) * gain; L[i0 + i] += s; R[i0 + i] += s; } };
const CHORDS = [[-12, -9, -5, 0], [-16, -12, -9, -4], [-9, -5, -2, 3], [-14, -10, -7, -2]]; // A minor, F, C, G, two bars each
const scene = t => (t < 7.2 ? 1 : t < 14.4 ? 2 : t < 26.4 ? 3 : t < 38.4 ? 4 : t < 50.4 ? 5 : t < 72 ? 6 : 7);
for (let bar = 0; bar < 39; bar++) { const t = bar * BAR, ch = CHORDS[Math.floor(bar / 2) % 4], sc = scene(t);
  if (bar % 2 === 0) ch.forEach((s, k) => add(t, hz(s), BAR * 2 + 0.6, 0.085, { attack: 0.5, pan: (k - 1.5) * 0.25, shape: 0.25 })); // the pad
  if (sc >= 2 && bar < 37) { add(t, hz(ch[0] - 12), 0.5, 0.2, { attack: 0.005 }); // bass on the bar
    for (const b of [0, 2]) add(t + b * BEAT, 58, 0.2, sc === 7 ? 0.12 : 0.3, { attack: 0.002, bend: 0.6 }); } // a soft thud on beats one and three
  if (sc >= 3 && sc <= 6) for (const b of [1, 3]) tick(t + b * BEAT, 0.05); // off-beat ticks
  if (sc === 6) for (let e = 0; e < 8; e++) add(t + e * BEAT / 2, hz([0, 3, 7, 12, 7, 3, 0, 7][e] + (ch[0] + 12)), 0.3, 0.05, { attack: 0.004, pan: e % 2 ? 0.4 : -0.4 }); } // a little lift under the four rules
// Accents where the words land hard.
for (const [t, g] of [[3.6, 1], [12.0, 0.7], [24.0, 1.1], [35.4, 1], [47.4, 0.7], [84.0, 0.8]]) { add(t, 52, 0.5, 0.45 * g, { attack: 0.002, bend: 0.5 }); [0, 7, 12, 16].forEach((s, k) => add(t, hz(s), 0.9, 0.06 * g, { attack: 0.004, pan: (k - 1.5) * 0.3, shape: 0.5 })); }
// A last warm chord, and a fade over the final bar.
[-12, -5, 0, 4, 7].forEach((s, k) => add(87.6, hz(s), 5.5, 0.07, { attack: 0.3, pan: (k - 2) * 0.2, shape: 0.2 }));
let peak = 0, sq = 0; for (let i = 0; i < N; i++) { const fade = Math.min(1, i / (0.05 * SR)) * Math.min(1, (N - i) / (2.4 * SR)); L[i] = Math.tanh(L[i] * 1.4) * fade; R[i] = Math.tanh(R[i] * 1.4) * fade; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); sq += L[i] * L[i] + R[i] * R[i]; }
const norm = 0.6 / peak, buf = Buffer.alloc(44 + N * 4); // peaks at about -4.4 dB: a bed, not a lead
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * norm * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * norm * 32767), 46 + i * 4); }
const dir = new URL('./film/assets/', import.meta.url).pathname; fs.writeFileSync(dir + 'bed.wav', buf);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', dir + 'bed.wav', '-c:a', 'aac', '-b:a', '128k', dir + 'bed.m4a']); fs.unlinkSync(dir + 'bed.wav');
console.log(`bed written: ${LEN} s, peak ${(20 * Math.log10(0.6)).toFixed(1)} dB, average level ${(10 * Math.log10(sq / (2 * N)) + 20 * Math.log10(norm)).toFixed(1)} dB`);
