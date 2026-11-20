import test from 'node:test';
import assert from 'node:assert/strict';
import { screenPairs, launchKey, SCREEN_KM, MIN_RELATIVE_KMS } from '../demos/orbit-census/src/screen.js';
import { family, FAMILIES, MEGA } from '../demos/orbit-census/src/classify.js';

// Scene units: 1 = 1000 km, velocity in 1000 km/s. Two objects ~6,800 km out, apart by `km` along x.
const pair = (km, relKms, launches = ['2020-001A', '2021-002B']) => {
  const pv = new Float32Array(12);
  pv.set([6.8, 0, 0, 0, 0.0076, 0], 0);
  pv.set([6.8 + km / 1000, 0, 0, relKms / 1000, 0.0076, 0], 6);
  return screenPairs(pv, new Uint8Array([1, 1]), launches);
};

test('the published thresholds are 25 km and 10 m/s', () => {
  assert.equal(SCREEN_KM, 25);
  assert.equal(MIN_RELATIVE_KMS, 0.01);
});

test('a fast pair inside the distance limit is listed with its distance and speed', () => {
  const { pairs, slow } = pair(5, 3);
  assert.equal(pairs.length, 1); assert.equal(slow, 0);
  assert.ok(Math.abs(pairs[0][2] - 5) < 0.01); assert.ok(Math.abs(pairs[0][3] - 3) < 0.01);
});

test('distance limit: 24.9 km is in, 25.1 km is out', () => {
  assert.equal(pair(24.9, 1).pairs.length, 1);
  assert.equal(pair(25.1, 1).pairs.length, 0);
  assert.equal(pair(25.1, 1).slow, 0);
});

test('speed rule: 11 m/s is listed, 9 m/s is counted as slow, never dropped silently', () => {
  assert.equal(pair(1, 0.011).pairs.length, 1);
  const s = pair(1, 0.009);
  assert.equal(s.pairs.length, 0);
  assert.equal(s.slow, 1);
});

test('the review case: unrelated objects 1 km apart at 5 m/s are reported as slow, not as no pair', () => {
  const s = pair(1, 0.005);
  assert.deepEqual(s.pairs, []);
  assert.equal(s.slow, 1);
});

test('same launch is screened out; unpropagated objects are ignored', () => {
  assert.equal(pair(1, 3, ['2020-001A', '2020-001A']).pairs.length, 0);
  const pv = new Float32Array(12); pv.set([6.8, 0, 0, 0, 0, 0], 0); pv.set([6.801, 0, 0, 0.003, 0, 0], 6);
  assert.equal(screenPairs(pv, new Uint8Array([1, 0]), ['A', 'B']).pairs.length, 0);
});

test('unknown launch provenance is never treated as same-launch, in either order', () => {
  // blank/blank and blank/known: listed at 11 m/s, counted as slow at 9 m/s
  for (const launches of [['', ''], ['', '2020-001'], ['2020-001', '']]) {
    const fast = pair(1, 0.011, launches);
    assert.equal(fast.pairs.length, 1, `listed at 11 m/s: ${JSON.stringify(launches)}`);
    const slow = pair(1, 0.009, launches);
    assert.deepEqual([slow.pairs.length, slow.slow], [0, 1], `slow at 9 m/s: ${JSON.stringify(launches)}`);
  }
});

test('the worker prefix makes 2020-001A and 2020-001B one known launch', () => {
  const prefix = launchKey; // what worker.js stores per object
  assert.equal(prefix('2020-001A'), prefix('2020-001B'));
  assert.equal(pair(1, 3, ['2020-001A', '2020-001B'].map(prefix)).pairs.length, 0);
  assert.equal(pair(1, 0.005, ['2020-001A', '2020-001B'].map(prefix)).slow, 0); // excluded before the speed rule
  assert.equal(prefix(null), '');
});

test('results are sorted nearest first and capped', () => {
  const n = 12; const pv = new Float32Array(n * 6); const cospar = [];
  for (let i = 0; i < n; i++) { pv.set([6.8 + i * 0.001, 0, 0, i * 0.001, 0, 0], i * 6); cospar.push(`2020-${String(i).padStart(3, '0')}A`); }
  const { pairs } = screenPairs(pv, new Uint8Array(n).fill(1), cospar);
  assert.equal(pairs.length, 8);
  for (let k = 1; k < pairs.length; k++) assert.ok(pairs[k][2] >= pairs[k - 1][2]);
});

test('families from #114: HULIANWANG is Guowang; O3b covers both generations; Rassvet is its own', () => {
  assert.equal(family('HULIANWANG DIGUI-01'), 'guowang');
  assert.equal(family('SATNET LEO GROUP 01'), 'guowang');
  assert.equal(family('O3B FM20'), 'o3b');
  assert.equal(family('O3B MPOWER F7'), 'o3b');
  assert.equal(FAMILIES.find((f) => f.id === 'o3b').label, 'O3b');
  assert.equal(family('RASSVET-1'), 'rassvet');
  for (const id of ['guowang', 'o3b', 'rassvet']) assert.ok(MEGA.has(id));
});
