#!/usr/bin/env node
/**
 * Combat-scene audio harness.
 *
 * The per-voice harness measures every sound ALONE, which is exactly the condition under which
 * the master bus does nothing. This one renders realistic simultaneous gameplay through the
 * real bus chain (busCompressor -> softClip -> limiter -> masterGain) and measures what that
 * chain does to the mix: short-term crest factor, level, and whether individual shots keep
 * their transients or merge into a squashed wall.
 *
 * Also writes the render to a .wav so it can be listened to.
 *
 * Usage: node combat.mjs <scene> [outdir]
 *   scenes: fullauto | firefight | single | reload | walk
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

const SCENE = process.argv[2] || 'firefight';
const TAG = process.env.NOAMB === '1' ? '-dry' : '';
const OUTDIR = process.argv[3] || path.join(__dirname, 'audio');
fs.mkdirSync(OUTDIR, { recursive: true });
const SR = 44100;
const SECONDS = 5;

/* Event scripts: [timeSeconds, voiceName, opts]. These mirror real call sites. */
const SCENES = {
  // Player holds the trigger on the mk18: 780 rpm = one round every 76.9 ms.
  fullauto: () => {
    const ev = [];
    for (let i = 0; i < 20; i++) ev.push([0.25 + i * 0.0769, 'shot', { weapon: 'mk18', volume: 1 }]);
    return ev;
  },
  // A single shot with nothing else, for reference against the per-voice harness.
  single: () => [[0.25, 'shot', { weapon: 'mk18', volume: 1 }]],
  // The real thing: player firing, two enemies returning fire, rounds striking cover,
  // brass on concrete, the player moving. This is what the game actually sounds like.
  firefight: () => {
    const ev = [];
    for (let i = 0; i < 14; i++) ev.push([0.4 + i * 0.0769, 'shot', { weapon: 'mk18', volume: 1 }]);
    for (let i = 0; i < 9; i++) ev.push([2.0 + i * 0.0769, 'shot', { weapon: 'mk18', volume: 1 }]);
    for (let i = 0; i < 6; i++) {
      ev.push([0.6 + i * 0.31, 'enemyShot', { position: { x: -8, y: 1.6, z: -22 }, dir: { x: 0.3, y: 0, z: 1 }, weapon: 'rifleman', volume: 0.85 }]);
      ev.push([0.72 + i * 0.29, 'whizz', { position: { x: 0.7, y: 1.7, z: -1 }, volume: 0.7 }]);
    }
    for (let i = 0; i < 5; i++) {
      ev.push([0.9 + i * 0.37, 'enemyShot', { position: { x: 14, y: 1.6, z: -30 }, dir: { x: -0.4, y: 0, z: 1 }, weapon: 'sniper', volume: 0.85 }]);
    }
    for (let i = 0; i < 10; i++) {
      ev.push([0.55 + i * 0.21, 'impact', { surface: i % 3 === 0 ? 'metal' : 'concrete', position: { x: 2 - i * 0.3, y: 1.2, z: -5 }, volume: 1 }]);
    }
    for (let i = 0; i < 8; i++) ev.push([0.7 + i * 0.24, 'footstep', { surface: 'gravel', volume: 0.55, speed: 3.4 }]);
    ev.push([2.6, 'magout', { weapon: 'mk18' }]);
    ev.push([3.0, 'magin', { weapon: 'mk18' }]);
    ev.push([3.35, 'boltrelease', { weapon: 'mk18' }]);
    return ev;
  },
  reload: () => [
    [0.2, 'shot', { weapon: 'mk18', volume: 1 }],
    [0.6, 'magout', { weapon: 'mk18' }],
    [1.05, 'magin', { weapon: 'mk18' }],
    [1.45, 'boltrelease', { weapon: 'mk18' }],
    [2.1, 'shot', { weapon: 'mk18', volume: 1 }],
  ],
  ambience: () => [],
  walk: () => {
    const ev = [];
    for (let i = 0; i < 12; i++) ev.push([0.3 + i * 0.38, 'footstep', { surface: i % 2 ? 'gravel' : 'concrete', volume: 0.55, speed: 3.2 }]);
    for (let i = 0; i < 6; i++) ev.push([0.5 + i * 0.75, 'cloth', { volume: 1 }]);
    return ev;
  },
};

async function renderInPage({ modulePath, events, seconds, sr, noAmbience }) {
  const len = Math.ceil(seconds * sr);
  const real = new OfflineAudioContext(2, len, sr);
  // Loops are normally allowed here — the ambience bed is part of what the player hears in
  // combat, and leaving it out is how a per-voice harness misses a bad bed entirely. Blocking
  // loops isolates the one-shots so the two can be compared.
  const wrapSource = (src) => new Proxy(src, {
    get(t, p) { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; },
    set(t, p, v) {
      if (noAmbience && p === 'loop' && v) throw new Error('loops disabled');
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
  let audio;
  try {
    window.AudioContext = FakeAC;
    window.webkitAudioContext = undefined;
    const mod = await import(`${modulePath}?combat=${Math.random().toString(36).slice(2)}`);
    audio = mod.createAudio({ quality: 'high' });
  } finally {
    window.AudioContext = OldAC;
  }
  if (!audio || !audio.available) return { error: 'audio unavailable' };

  // Schedule every event at its absolute offline time. playOneShot reads ctx.currentTime,
  // which in an OfflineAudioContext is 0 until rendering starts, so events would all pile up
  // at t=0. Instead each voice is given its scheduled time through the `when` option where the
  // module supports it, and otherwise triggered from a suspend() callback at the right frame.
  for (const [t, name, opts] of events) {
    const frame = Math.max(128, Math.round((t * sr) / 128) * 128);
    real.suspend(frame / sr).then(() => {
      try { audio.playOneShot(name, opts); } catch { /* one bad voice must not kill the render */ }
      real.resume();
    });
  }

  const buf = await real.startRendering();
  return {
    left: Array.from(buf.getChannelData(0)),
    right: Array.from(buf.getChannelData(1)),
  };
}

function wav(l, r, sr) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const a = Math.max(-1, Math.min(1, l[i])) * 32767;
    const b = Math.max(-1, Math.min(1, r[i])) * 32767;
    buf.writeInt16LE(a | 0, 44 + i * 4);
    buf.writeInt16LE(b | 0, 44 + i * 4 + 2);
  }
  return buf;
}

const db = (x) => (x <= 1e-10 ? -120 : 20 * Math.log10(x));

function analyse(l, r, sr) {
  const n = l.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (l[i] + r[i]) * 0.5;

  // Short-term crest factor in 50 ms windows. An impulsive mix (gunfire) should show a high
  // crest — peaks far above the local average. A heavily compressed one flattens toward ~6 dB.
  const w = Math.round(sr * 0.05);
  const frames = [];
  for (let s = 0; s + w <= n; s += w) {
    let pk = 0, sq = 0;
    for (let i = s; i < s + w; i++) {
      const a = Math.abs(mono[i]);
      if (a > pk) pk = a;
      sq += mono[i] * mono[i];
    }
    const rms = Math.sqrt(sq / w);
    frames.push({ t: s / sr, peak: pk, rms, crest: db(pk) - db(rms) });
  }
  const active = frames.filter((f) => f.rms > 1e-4);
  const mean = (a, k) => (a.length ? a.reduce((x, f) => x + f[k], 0) / a.length : 0);

  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(l[i]), Math.abs(r[i])); if (a > peak) peak = a; }
  let sq = 0;
  for (let i = 0; i < n; i++) sq += mono[i] * mono[i];
  const rmsAll = Math.sqrt(sq / n);

  // How much of the render is riding the ceiling (a proxy for limiter engagement).
  let hot = 0;
  for (let i = 0; i < n; i++) if (Math.max(Math.abs(l[i]), Math.abs(r[i])) > 0.83) hot++;

  return {
    peakDbfs: +db(peak).toFixed(2),
    rmsDbfs: +db(rmsAll).toFixed(2),
    globalCrestDb: +(db(peak) - db(rmsAll)).toFixed(2),
    meanShortTermCrestDb: +mean(active, 'crest').toFixed(2),
    minShortTermCrestDb: +Math.min(...active.map((f) => f.crest)).toFixed(2),
    pctSamplesNearCeiling: +((hot / n) * 100).toFixed(2),
    activeFrames: active.length,
    crestSeries: active.filter((_, i) => i % 2 === 0).map((f) => +f.crest.toFixed(1)),
    rmsSeries: active.filter((_, i) => i % 2 === 0).map((f) => +db(f.rms).toFixed(1)),
  };
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://127.0.0.1:8123/demos/ashfall/', { waitUntil: 'domcontentloaded', timeout: 60000 });

const events = SCENES[SCENE]();
const out = await page.evaluate(renderInPage, {
  modulePath: '/demos/ashfall/src/audio/audio.js',
  events, seconds: SECONDS, sr: SR, noAmbience: process.env.NOAMB === '1',
});
await browser.close();

if (out.error) { console.error('render failed:', out.error); process.exit(1); }

const l = Float32Array.from(out.left);
const r = Float32Array.from(out.right);
fs.writeFileSync(path.join(OUTDIR, `${SCENE}${TAG}.wav`), wav(l, r, SR));
const m = analyse(l, r, SR);
fs.writeFileSync(path.join(OUTDIR, `${SCENE}${TAG}.json`), JSON.stringify(m, null, 2));
console.log(`scene: ${SCENE}  (${events.length} events)`);
for (const [k, v] of Object.entries(m)) {
  if (Array.isArray(v)) console.log(`  ${k}: [${v.slice(0, 28).join(' ')}${v.length > 28 ? ' ...' : ''}]`);
  else console.log(`  ${k}: ${v}`);
}
