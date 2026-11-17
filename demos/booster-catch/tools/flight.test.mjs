// Run: node demos/booster-catch/tools/flight.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sample, REF, T_START, T_END, EVENTS, CUTS, BPM, SITE, BASE_CATCH_Y, engineLevel } from '../js/flight.js';

// 1. The three cited times, each event defined on its own, are reproduced by the model.
// Expected values worked out by hand from the published timeline as quoted on the page:
// T+6:08 = 368 s, T+6:30 = 390 s, T+6:54 = 414 s. The tolerance (0.2 s) is how closely
// the model meets these figures, not a claim about how precise the figures themselves are.
const CITED = { transonic: 6 * 60 + 8, ignition: 6 * 60 + 30, contact: 6 * 60 + 54, shutdown: 6 * 60 + 54 };
let machCross = null, ignition = null, contact = null, shutdown = null;
for (let t = T_START; t <= T_END + 1e-9; t += 0.01) {
  const s = sample(t);
  if (machCross === null && s.mach < 1) machCross = t; // first moment below the speed of sound
  if (ignition === null && s.thrust > 0.01) ignition = t; // first engine lights for the landing burn
  // Tower contact: arms closed, booster stopped, base at catch height.
  if (contact === null && s.vDown === 0 && Math.abs(s.y - BASE_CATCH_Y) < 0.5 && s.arm < 0.01) contact = t;
  if (ignition !== null && shutdown === null && s.thrust === 0) shutdown = t; // every engine fully off
}
assert.ok(Math.abs(machCross - CITED.transonic) <= 0.2, `Mach 1 at ${machCross}, cited ${CITED.transonic}`);
assert.ok(Math.abs(ignition - CITED.ignition) <= 0.2, `ignition at ${ignition}, cited ${CITED.ignition}`);
assert.ok(Math.abs(contact - CITED.contact) <= 0.2, `tower contact at ${contact}, cited ${CITED.contact}`);
assert.ok(shutdown !== null && Math.abs(shutdown - CITED.shutdown) <= 0.2, `engines off at ${shutdown}, cited ${CITED.shutdown}`);
assert.ok(shutdown <= CITED.shutdown + 1e-9, `engines still running after T+6:54 (off at ${shutdown})`);
// The readout at T+6:54 says engines off and caught: check the event actually claimed.
{ const s = sample(CITED.contact); assert.equal(s.lit, 0, 'engines lit at T+6:54'); assert.equal(s.thrust, 0, 'thrust at T+6:54'); assert.equal(s.phase, 'Caught'); }
assert.equal(sample(CITED.contact - 1).lit, 3, 'three engines should still be lit at T+6:53');
for (const [id, t] of [['transonic', CITED.transonic], ['burn', CITED.ignition], ['catch', CITED.contact]]) assert.equal(REF[id], t, `REF.${id}`);

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
assert.equal(sample(REF.burn + 2).lit, 13); assert.equal(sample(400).lit, 3); assert.equal(sample(REF.catch).lit, 0); assert.equal(sample(REF.catch + 2).lit, 0);
for (let i = 13; i < 33; i++) assert.equal(engineLevel(i, 392), 0);

// 5. Director's cut: every cut is on the beat, and the cited events are too.
const beat = 60 / BPM;
for (const [t] of CUTS) assert.ok(Math.abs((t - T_START) / beat - Math.round((t - T_START) / beat)) < 1e-9, `cut off-beat at ${t}`);
for (const e of EVENTS.filter(e => e.cited)) assert.ok(Number.isInteger((e.t - T_START) / beat));

// 6. Shaders: GLSL leaves smoothstep(a, b, x) undefined when a >= b, so no shader may write the edges reversed.
const bad = [];
for (const f of ['app.js', 'fx.js', 'world.js', 'booster.js']) {
  const src = readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
  for (const m of src.matchAll(/smoothstep\(\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,/g)) if (Number(m[1]) >= Number(m[2])) bad.push(`${f}: ${m[0]}`);
}
assert.deepEqual(bad, [], 'reversed smoothstep edges');

const b = sample(REF.burn);
console.log(`ok  Mach 1 at T+${machCross.toFixed(2)}s, ignition ${ignition.toFixed(2)}, engines off ${shutdown.toFixed(2)}, tower contact ${contact.toFixed(2)}; at T+6:54 ${sample(414).lit} engines lit; no reversed smoothstep edges`);
console.log(`    start alt ${(sample(T_START).y / 1000).toFixed(2)} km, burn-start alt ${(b.y).toFixed(0)} m at ${(b.speed * 3.6).toFixed(0)} km/h, peak braking ${maxG.toFixed(1)} g, max lean ${maxLean.toFixed(1)} deg`);
for (const t of [366, 368, 390, 393, 396, 400, 405, 410, 413, 414, 416]) { const s = sample(t); console.log(`    t=${t} alt=${s.y.toFixed(1)} x=${s.x.toFixed(1)} z=${s.z.toFixed(1)} v=${(s.speed*3.6).toFixed(0)}km/h lean=${(Math.atan(Math.hypot(s.leanX,s.leanZ))*57.3).toFixed(1)} arm=${s.arm.toFixed(0)}`); }
