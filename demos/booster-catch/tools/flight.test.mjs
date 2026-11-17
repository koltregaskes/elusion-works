// Run: node demos/booster-catch/tools/flight.test.mjs
import assert from 'node:assert/strict';
import { sample, REF, T_START, T_END, EVENTS, CUTS, BPM, SITE, BASE_CATCH_Y, engineLevel } from '../js/flight.js';

// 1. The three cited event times are reproduced by the model itself.
let machCross = null, burnStart = null, caught = null;
for (let t = T_START; t <= T_END; t += 0.01) {
  const s = sample(t);
  if (machCross === null && s.mach < 1) machCross = t;
  if (burnStart === null && s.thrust > 0.01) burnStart = t;
  if (caught === null && s.vDown === 0 && Math.abs(s.y - BASE_CATCH_Y) < 0.5 && s.arm < 0.01) caught = t;
}
assert.ok(Math.abs(machCross - REF.transonic) <= 0.5, `Mach 1 at ${machCross}, cited ${REF.transonic}`);
assert.ok(Math.abs(burnStart - REF.burn) <= 0.2, `burn at ${burnStart}, cited ${REF.burn}`);
assert.ok(Math.abs(caught - REF.catch) <= 0.2, `catch at ${caught}, cited ${REF.catch}`);

// 2. Deterministic: same clock value, same state, whatever was sampled before.
const a = JSON.stringify(sample(401.37)); sample(366); sample(419.9);
assert.equal(JSON.stringify(sample(401.37)), a);

// 3. Physically sane: always descending, never underground, lean bounded, no jumps.
let prev = sample(T_START), maxLean = 0, maxG = 0;
for (let t = T_START + 0.02; t <= T_END; t += 0.02) {
  const s = sample(t);
  assert.ok(s.y <= prev.y + 0.3, `climbs at ${t}`);
  assert.ok(s.y >= BASE_CATCH_Y - 0.4, `below catch height at ${t}`);
  assert.ok(Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z) < 8, `jump at ${t}`);
  maxLean = Math.max(maxLean, Math.atan(Math.hypot(s.leanX, s.leanZ)) * 180 / Math.PI);
  maxG = Math.max(maxG, (prev.vDown - s.vDown) / 0.02 / 9.81);
  prev = s;
}
assert.ok(maxLean < 18 && maxLean > 3, `lean ${maxLean}`);

// 4. At the catch the pins sit on the arm rails at the catch point.
const c = sample(REF.catch + 4);
assert.ok(Math.abs(c.y + SITE.pinY - SITE.armY) < 0.1 && Math.abs(c.x - SITE.catchX) < 0.01 && Math.abs(c.z - SITE.catchZ) < 0.01);
assert.equal(sample(REF.burn + 2).lit, 13); assert.equal(sample(400).lit, 3); assert.equal(sample(REF.catch + 2).lit, 0);
for (let i = 13; i < 33; i++) assert.equal(engineLevel(i, 392), 0);

// 5. Director's cut: every cut is on the beat, and the cited events are too.
const beat = 60 / BPM;
for (const [t] of CUTS) assert.ok(Math.abs((t - T_START) / beat - Math.round((t - T_START) / beat)) < 1e-9, `cut off-beat at ${t}`);
for (const e of EVENTS.filter(e => e.cited)) assert.ok(Number.isInteger((e.t - T_START) / beat));

const b = sample(REF.burn);
console.log(`ok  Mach 1 at T+${machCross.toFixed(2)}s, burn ${burnStart.toFixed(2)}, catch ${caught.toFixed(2)}`);
console.log(`    start alt ${(sample(T_START).y / 1000).toFixed(2)} km, burn-start alt ${(b.y).toFixed(0)} m at ${(b.speed * 3.6).toFixed(0)} km/h, peak braking ${maxG.toFixed(1)} g, max lean ${maxLean.toFixed(1)} deg`);
for (const t of [366, 368, 390, 393, 396, 400, 405, 410, 413, 414, 416]) { const s = sample(t); console.log(`    t=${t} alt=${s.y.toFixed(1)} x=${s.x.toFixed(1)} z=${s.z.toFixed(1)} v=${(s.speed*3.6).toFixed(0)}km/h lean=${(Math.atan(Math.hypot(s.leanX,s.leanZ))*57.3).toFixed(1)} arm=${s.arm.toFixed(0)}`); }
