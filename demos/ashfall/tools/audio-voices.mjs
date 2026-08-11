#!/usr/bin/env node
/**
 * Offline measurement harness for Ashfall's procedural audio (src/audio/audio.js).
 *
 * Approach: load the game origin in headless Chromium, then — per voice — import the audio
 * module FRESH (cache-busting query) with window.AudioContext temporarily replaced by a
 * wrapper that returns a Proxy around an OfflineAudioContext(2, 44100*3, 44100) which
 * reports state === 'running' (so createAudio() arms itself and playOneShot works).
 * Looping buffer sources are blocked (setting .loop = true throws inside buildAmbience's
 * try/catch) so the ambience beds never contaminate one-shot renders; a special "ambience"
 * probe re-enables loops and triggers nothing, measuring the beds alone.
 *
 * Per voice: peak dBFS, RMS dBFS (active region), attack-to-90%-peak (ms),
 * duration-to--40dB-rel-peak (ms), spectral centroid (Hz), zero-crossing rate (Hz).
 *
 * Usage: node measure.mjs [outfile.json]
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Playwright is resolved from wherever it is installed: a local node_modules, a global
// install, or the PLAYWRIGHT_PATH environment variable. It is a dev-only dependency of these
// tools and is deliberately not vendored into the repo.
const require = createRequire(import.meta.url);
function loadChromium() {
  const candidates = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'];
  for (const c of candidates) {
    if (!c) continue;
    try { return require(c).chromium; } catch { /* try the next candidate */ }
  }
  throw new Error('playwright not found — npm i -D playwright, or set PLAYWRIGHT_PATH');
}
const chromium = loadChromium();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(__dirname, 'baseline.json');
const ORIGIN = 'http://127.0.0.1:8123';
const PAGE = ORIGIN + '/demos/ashfall/';
const MODULE_PATH = '/demos/ashfall/src/audio/audio.js';
const SECONDS = 3;
const SR = 44100;

/* Voice inventory + option shapes, mirroring the real call sites
   (weapon.js / controller.js / enemies.js / particles.js / audio.js event wiring). */
const P_NEAR = { x: 0.6, y: 1.2, z: -1.5 };
const P_MID = { x: 0, y: 1.5, z: -12 };
const P_FAR = { x: 0, y: 1.5, z: -20 };
const VOICES = [
  // Player weapon reports ('shot' avoids the auto-scheduled brass of the bare names)
  { id: 'shot.rifle', name: 'shot', opts: { weapon: 'mk18', volume: 1 } },
  { id: 'shot.smg', name: 'shot', opts: { weapon: 'vector', volume: 1 } },
  { id: 'shot.dmr', name: 'shot', opts: { weapon: 'dmr14', volume: 1 } },
  // Enemy shot, fired AT the listener (dir gives the supersonic crack path)
  { id: 'enemyShot.rifle', name: 'enemyShot', opts: { position: P_FAR, dir: { x: 0, y: 0, z: 1 }, weapon: 'rifleman', volume: 0.85 } },
  { id: 'enemyShot.dmr', name: 'enemyShot', opts: { position: P_FAR, dir: { x: 0, y: 0, z: 1 }, weapon: 'sniper', volume: 0.85 } },
  // Footsteps, one per FOOT surface (controller passes no position: self channel)
  ...['concrete', 'metal', 'wood', 'gravel', 'dirt', 'glass', 'sandbag'].map((s) => ({
    id: `footstep.${s}`, name: 'footstep', opts: { surface: s, volume: 0.55, speed: 3.2 },
  })),
  { id: 'footstep.concrete.sprint', name: 'footstep', opts: { surface: 'concrete', volume: 0.8, speed: 6.1 } },
  { id: 'enemyStep.gravel', name: 'enemyStep', opts: { surface: 'gravel', position: P_MID, volume: 0.62, speed: 3.0 } },
  // Mechanical
  ...['magout', 'magin', 'boltback', 'boltrelease', 'boltlock', 'dryfire', 'trigger',
    'weaponraise', 'weaponlower', 'inspect', 'adsin', 'adsout'].map((k) => ({
    id: `mech.${k}`, name: k, opts: { weapon: 'mk18' },
  })),
  // Movement
  { id: 'jump', name: 'jump', opts: { surface: 'concrete', volume: 0.55 } },
  { id: 'land', name: 'land', opts: { surface: 'concrete', volume: 0.8 } },
  { id: 'slide', name: 'slide', opts: { surface: 'concrete', volume: 0.9 } },
  { id: 'mantle', name: 'mantle', opts: { surface: 'concrete', volume: 0.8 } },
  // Combat feedback / enemy
  { id: 'whizz', name: 'whizz', opts: { position: P_NEAR, volume: 0.7 } },
  { id: 'brass', name: 'brass', opts: { position: { x: 0.5, y: 0, z: -1 }, volume: 1, surface: 'concrete' } },
  { id: 'enemyReload', name: 'enemyReload', opts: { position: P_MID, volume: 0.5 } },
  { id: 'enemyDeath', name: 'enemyDeath', opts: { position: P_MID, volume: 0.8 } },
  { id: 'enemyHit', name: 'enemyHit', opts: { position: P_MID, volume: 0.7 } },
  { id: 'enemyHitHead', name: 'enemyHitHead', opts: { position: P_MID, volume: 0.7 } },
  { id: 'hitmarker', name: 'hitmarker', opts: {} },
  { id: 'headshot', name: 'headshot', opts: {} },
  { id: 'kill', name: 'kill', opts: {} },
  { id: 'playerHurt', name: 'playerHurt', opts: { amount: 25 } },
  { id: 'heartbeat', name: 'heartbeat', opts: { volume: 0.5 } },
  { id: 'explosion', name: 'explosion', opts: { position: { x: 0, y: 1, z: -10 }, power: 1, radius: 6 } },
  // Impacts, per surface (flesh lives here, not in FOOT)
  ...['concrete', 'metal', 'wood', 'dirt', 'gravel', 'glass', 'sandbag', 'flesh'].map((s) => ({
    id: `impact.${s}`, name: 'impact', opts: { surface: s, position: { x: 0, y: 1, z: -6 }, volume: 1 },
  })),
  // Vocal / scenery / misc
  { id: 'shout.contact', name: 'shout', opts: { position: P_MID, kind: 'contact', volume: 0.62 } },
  { id: 'enemyHandling.shoulder', name: 'enemyHandling', opts: { position: P_MID, kind: 'shoulder', volume: 0.55 } },
  { id: 'creak', name: 'creak', opts: {} }, // position randomised inside — indicative only
  { id: 'cloth', name: 'cloth', opts: { volume: 1 } },
  { id: 'gear', name: 'gear', opts: { volume: 1 } },
  { id: 'ui.click', name: 'uiClick', opts: {} },
  { id: 'ui.hover', name: 'uiHover', opts: {} },
  { id: 'ui.lowAmmo', name: 'lowAmmo', opts: {} },
  // Ambience beds alone (loops allowed, nothing triggered; gain fades in over the render)
  { id: 'ambience.bed', name: null, opts: {}, allowLoops: true },
];

/* Runs inside the page. Everything self-contained. */
async function measureInPage({ modulePath, name, opts, allowLoops, seconds, sr }) {
  const len = Math.ceil(seconds * sr);
  const real = new OfflineAudioContext(2, len, sr);

  const wrapSource = (src) => new Proxy(src, {
    get(t, p) { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; },
    set(t, p, v) {
      if (!allowLoops && p === 'loop' && v) throw new Error('loops disabled for one-shot measurement');
      t[p] = v; return true;
    },
  });
  const proxy = new Proxy(real, {
    get(t, p) {
      if (p === 'state') return 'running';
      if (p === 'resume' || p === 'suspend' || p === 'close') return () => Promise.resolve();
      if (p === 'createBufferSource') return (...a) => wrapSource(t.createBufferSource(...a));
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  function FakeAC() { return proxy; }

  const OldAC = window.AudioContext;
  const OldWK = window.webkitAudioContext;
  let audio;
  try {
    window.AudioContext = FakeAC;
    window.webkitAudioContext = undefined;
    // Fresh module instance per voice: module-scope state (scratch vectors, listener pos,
    // shot history) starts clean, and createAudio binds to OUR context. NOTE: the module
    // reads window.AudioContext inside createAudio(), so the fake must stay installed
    // until after createAudio has returned.
    const mod = await import(`${modulePath}?probe=${encodeURIComponent(name || 'amb')}-${Math.random().toString(36).slice(2)}`);
    audio = mod.createAudio({ quality: 'high' });
  } finally {
    window.AudioContext = OldAC;
    window.webkitAudioContext = OldWK;
  }
  if (!audio || !audio.available) return { error: 'createAudio returned inert/unavailable' };
  if (audio.ctx !== proxy) return { error: 'module bound to a different context' };
  if (name) audio.playOneShot(name, opts);

  const buf = await real.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const n = L.length;

  /* ---- metrics ---- */
  let peak = 0, peakIdx = 0;
  const env = new Float32Array(n);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const al = Math.abs(L[i]), ar = Math.abs(R[i]);
    const a = al > ar ? al : ar;
    env[i] = a;
    mono[i] = (L[i] + R[i]) * 0.5;
    if (a > peak) { peak = a; peakIdx = i; }
  }
  const db = (x) => (x <= 1e-10 ? -200 : 20 * Math.log10(x));
  if (peak < 1e-6) return { silent: true, peakDbfs: -200 };

  // Onset: first sample above -60 dB rel peak.
  let onset = 0;
  const th0 = peak * 0.001;
  for (let i = 0; i < n; i++) { if (env[i] > th0) { onset = i; break; } }

  // Attack: onset -> first sample >= 90% of peak.
  let i90 = peakIdx;
  const th90 = peak * 0.9;
  for (let i = onset; i < n; i++) { if (env[i] >= th90) { i90 = i; break; } }
  const attackMs = ((i90 - onset) / sr) * 1000;

  // Smoothed RMS envelope (5.8 ms window, 1.45 ms hop) for the decay measurement.
  const win = 256, hop = 64;
  const nf = Math.max(1, Math.floor((n - win) / hop));
  const sm = new Float32Array(nf);
  let smPeak = 0;
  {
    let acc = 0;
    for (let i = 0; i < win; i++) acc += mono[i] * mono[i];
    let head = win;
    for (let f = 0; f < nf; f++) {
      sm[f] = Math.sqrt(acc / win);
      if (sm[f] > smPeak) smPeak = sm[f];
      for (let k = 0; k < hop && head < n; k++, head++) {
        acc += mono[head] * mono[head] - mono[head - win] * mono[head - win];
      }
    }
  }
  // Duration: onset -> last smoothed-env frame above -40 dB rel smoothed peak.
  const th40 = smPeak * 0.01;
  let lastF = 0;
  for (let f = nf - 1; f >= 0; f--) { if (sm[f] >= th40) { lastF = f; break; } }
  const endIdx = Math.min(n - 1, lastF * hop + win);
  const durTo40Ms = Math.max(0, ((endIdx - onset) / sr) * 1000);
  const truncated = lastF >= nf - 3;

  // RMS over the active region.
  let sq = 0;
  const activeN = Math.max(1, endIdx - onset);
  for (let i = onset; i < endIdx; i++) sq += mono[i] * mono[i];
  const rms = Math.sqrt(sq / activeN);

  // Zero-crossing rate over the active region (Hz).
  let zc = 0;
  for (let i = onset + 1; i < endIdx; i++) {
    if ((mono[i] >= 0) !== (mono[i - 1] >= 0)) zc++;
  }
  const zcrHz = (zc / 2) / (activeN / sr);

  // Spectral centroid: averaged Hann-windowed power spectra (4096/1024) over the active region.
  const N = 4096;
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N);
  const pow = new Float64Array(N / 2);
  function fft(re, im) {
    const nn = re.length;
    for (let i = 1, j = 0; i < nn; i++) {
      let bit = nn >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let s = 2; s <= nn; s <<= 1) {
      const ang = (-2 * Math.PI) / s;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < nn; i += s) {
        let cwr = 1, cwi = 0;
        for (let k = 0; k < s / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + s / 2] * cwr - im[i + k + s / 2] * cwi;
          const vi = re[i + k + s / 2] * cwi + im[i + k + s / 2] * cwr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + s / 2] = ur - vr; im[i + k + s / 2] = ui - vi;
          const nwr = cwr * wr - cwi * wi;
          cwi = cwr * wi + cwi * wr; cwr = nwr;
        }
      }
    }
  }
  let frames = 0;
  for (let start = onset; start + N <= Math.min(n, endIdx + N); start += 1024) {
    for (let i = 0; i < N; i++) { re[i] = mono[start + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
    if (frames > 200) break;
  }
  let centroid = 0;
  if (frames > 0) {
    let num = 0, den = 0;
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sr) / N;
      num += f * pow[k];
      den += pow[k];
    }
    centroid = den > 0 ? num / den : 0;
  }

  return {
    peakDbfs: +db(peak).toFixed(2),
    rmsDbfs: +db(rms).toFixed(2),
    attackTo90Ms: +attackMs.toFixed(2),
    durTo40dbMs: +durTo40Ms.toFixed(1),
    truncated,
    spectralCentroidHz: +centroid.toFixed(1),
    zcrHz: +zcrHz.toFixed(1),
    onsetMs: +((onset / sr) * 1000).toFixed(2),
  };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  // Deterministic gate: the synthesis uses per-shot jitter by design, so a single-draw
  // measurement is a lottery whenever two layers nearly tie. Seeding Math.random makes every
  // harness run measure the same canonical draw; vary the seed deliberately to sample others.
  await page.addInitScript(() => {
    let s = 1337 >>> 0;
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 15), 1 | z);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  });
  page.on('pageerror', (e) => console.error('[pageerror]', String(e).slice(0, 200)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500); // let the game's own module graph settle
  // Freeze the game's render loop: under SwiftShader it starves the main thread and slows
  // every offline render ~30x. rAF is re-registered per frame, so overriding it stops the
  // loop after the in-flight frame; the audio module under test never uses rAF.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
  });
  await page.waitForTimeout(300);

  const results = {};
  for (const v of VOICES) {
    try {
      const r = await page.evaluate(measureInPage, {
        modulePath: MODULE_PATH,
        name: v.name,
        opts: v.opts,
        allowLoops: !!v.allowLoops,
        seconds: SECONDS,
        sr: SR,
      });
      results[v.id] = r;
      console.log(v.id.padEnd(26), JSON.stringify(r));
    } catch (e) {
      results[v.id] = { error: String(e).slice(0, 300) };
      console.error(v.id.padEnd(26), 'ERROR', String(e).slice(0, 200));
    }
  }
  await browser.close();

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sampleRate: SR,
    renderSeconds: SECONDS,
    module: MODULE_PATH,
    metricsNote: 'attackTo90Ms/durTo40dbMs are relative to onset (first sample above -60 dB rel peak); durTo40dbMs uses a 5.8 ms RMS envelope, threshold -40 dB rel envelope peak; centroid is a Hann/4096 Welch average over the active region.',
    voices: results,
  }, null, 2));
  console.log('wrote', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
