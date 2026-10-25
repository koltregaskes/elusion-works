/* Headless sim tests. No browser, no WebGL: the sim runs standalone (see the
   note above buildShipModel in src/sim/world.js), so Node can tick it.

   Run from the repo root:  node demos/void-sovereign/tools/sim-test.mjs
   Exit code 0 when every check passes, 1 otherwise.

   1. Determinism: two worlds from the same seed, both sides played by the AI,
      hash identically at every checkpoint. A third world from another seed
      does not.
   2. A match ends: AI against AI on the standard pace reaches `over` with a
      winner inside the time limit.
   3. Fixed-step independence of the render side: ticking is the only thing
      that moves the sim (syncTransforms between ticks changes no hash).
   4. The audio noise bank (src/audio/synth.js) builds the same buffers in
      the same order every time, from a fake audio context. */

import * as THREE from '../vendor/three/build/three.module.js';
import { World } from '../src/sim/world.js';
import { NoiseBank } from '../src/audio/synth.js';
import { makeRng } from '../src/core/rng.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failed++;
};

/* FNV-1a over the state that matters: who exists, where, how hurt, and the
   economy. Positions at 1 cm, hull at 0.01. */
function hashWorld(w) {
  let h = 2166136261 >>> 0;
  const mix = (n) => {
    const v = Math.round(n) | 0;
    for (let k = 0; k < 4; k++) { h ^= (v >>> (k * 8)) & 0xff; h = Math.imul(h, 16777619) >>> 0; }
  };
  const ids = [...w.entities.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const e = w.entities.get(id);
    mix(id); mix(e.team); mix(e.alive ? 1 : 0);
    mix(e.position.x * 100); mix(e.position.y * 100); mix(e.position.z * 100);
    mix((e.hull || 0) * 100);
  }
  for (const t of w.teams) { mix((t.credits || 0) * 100); mix((t.sovereignty || 0) * 100); }
  mix(w.tickCount);
  return h.toString(16);
}

function makeWorld(seed, extra = {}) {
  return new World(Object.assign({ seed, scene: new THREE.Scene(), ai: { player: true } }, extra));
}

const STEP = 1 / 30;

/* Worlds share the global event bus (core/events.js): a Commander's orders
   and every sim event go through it, so two live worlds in one process hear
   each other. Each run therefore builds, ticks and disposes its world before
   the next one starts. */
function runHashes(seed, marks, opts = {}) {
  const w = makeWorld(seed);
  const out = [];
  let tick = 0;
  for (const m of marks) {
    while (tick < m) {
      w.tick(STEP); tick++;
      if (opts.interp) { w.syncTransforms(0.25); w.syncTransforms(0.75); }
    }
    out.push(hashWorld(w));
  }
  const size = w.entities.size;
  w.dispose();
  return { out, size };
}

/* 1. Determinism. */
{
  const marks = [0, 300, 1800, 5400, 9000];
  const a = runHashes(13634, marks);
  const b = runHashes(13634, marks);
  const c = runHashes(99, marks);
  const same = a.out.every((h, i) => h === b.out[i]);
  const firstBad = a.out.findIndex((h, i) => h !== b.out[i]);
  check('same seed, same tick, same state (5 checkpoints to 5 min)', same,
    same ? a.out.map((h, i) => `t${marks[i]}:${h}`).join(' ') : `first differs at tick ${marks[firstBad]}`);
  check('a different seed gives a different state', a.out.some((h, i) => h !== c.out[i]));
  check('the AI fielded ships on both sides', a.size > 40, `${a.size} entities at 5 min`);
}

/* 3. syncTransforms between ticks does not move the sim. */
{
  const marks = [900];
  const a = runHashes(37, marks, { interp: true });
  const b = runHashes(37, marks);
  check('render interpolation never changes sim state', a.out[0] === b.out[0]);
}

/* 2. A match ends. */
{
  const w = makeWorld(13634, { pace: 'standard' });
  const limit = 30 * 60 * 60; // an hour of game time
  let i = 0;
  while (!w.over && i < limit) { w.tick(STEP); i++; }
  w.dispose();
  check('an AI-vs-AI standard match ends with a winner', !!w.over && (w.winner === 0 || w.winner === 1),
    `over=${!!w.over} winner=${w.winner} at ${(w.time / 60).toFixed(1)} min, reason ${w.endReason}`);
}

/* 4. Noise bank. */
{
  const fakeCtx = {
    sampleRate: 8000,
    createBuffer(ch, n) { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { getChannelData: (k) => d[k] }; },
  };
  const sum = (bank) => NoiseBank.KEYS.map(([k, s]) => { const b = bank.get(k, s); let x = 0; const d = b.getChannelData(0); for (let i = 0; i < d.length; i += 97) x += d[i]; return x.toFixed(6); }).join(',');
  const a = new NoiseBank(fakeCtx, makeRng(7)); a.warm();
  const b = new NoiseBank(fakeCtx, makeRng(7)); b.warm();
  check('noise bank warm() is deterministic', sum(a) === sum(b));
  check('noise bank warm() builds every key', a._cache.size === NoiseBank.KEYS.length, `${a._cache.size} buffers`);
}

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
