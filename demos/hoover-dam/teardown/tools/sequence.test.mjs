// Exactness checks for the teardown sequences. No browser.
// Run: node demos/hoover-dam/teardown/tools/sequence.test.mjs
import assert from 'node:assert/strict';
import { efficiency } from '../../src/model/hydro.js';
import { ELEV } from '../../src/model/data.js';
import { Run, hillSamples, A5_INDEX, PHASES } from '../src/sequence.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

const a = new Run('a5');
a.rebuild(0);
const b = new Run('a5');
b.rebuild(0);
a.seek(30);
b.seek(11);
b.seek(30);
near(a.state.lake, b.state.lake, 1e-6, 'scrubbed lake matches a direct seek');
near(a.state.units[A5_INDEX].gate, b.state.units[A5_INDEX].gate, 1e-6, 'scrubbed gate');
near(a.state.units[A5_INDEX].rpm, b.state.units[A5_INDEX].rpm, 1e-4, 'scrubbed rpm');
near(a.state.units[A5_INDEX].spin, b.state.units[A5_INDEX].spin, 1e-4, 'scrubbed rotor angle');

const c = new Run('a5');
c.rebuild(40);
c.seek(8);
c.seek(40);
near(c.state.lake, a.seek(40) || a.state.lake, 1e-6, 'rewind then forward');
a.seek(40);
near(c.state.lake, a.state.lake, 1e-6, 'rewind lake');

assert.equal(a.phaseAt(0, A5_INDEX), 'stand', 'opens at standstill');
const bounds = a.bounds(A5_INDEX);
const ids = bounds.map((p) => p.id);
assert.ok(ids.includes('roll') && ids.includes('sync') && ids.includes('load'), `start-up phases ${ids}`);
assert.ok(ids.includes('spill'), `spill phase ${ids}`);
assert.equal(ids[ids.length - 1], 'trip', `ends tripped ${ids}`);
assert.ok(a.lakeAt(a.duration) < ELEV.minPower, `lake ${a.lakeAt(a.duration)} below minimum power pool`);

const raised = new Run('a5', { drum: 1 });
const lowered = new Run('a5', { drum: 0 });
raised.rebuild(0);
lowered.rebuild(0);
const spillHi = raised.bounds(A5_INDEX).find((p) => p.id === 'spill').t0;
const spillLo = lowered.bounds(A5_INDEX).find((p) => p.id === 'spill').t0;
assert.ok(spillLo < spillHi - 1, `lowered drum spills sooner (${spillLo.toFixed(2)} < ${spillHi.toFixed(2)})`);
const tripHi = raised.bounds(A5_INDEX).find((p) => p.id === 'trip').t0;
const tripLo = lowered.bounds(A5_INDEX).find((p) => p.id === 'trip').t0;
assert.ok(Number.isFinite(tripHi) && Number.isFinite(tripLo), 'trip boundary exists at both drum settings');

const wet = new Run('a5', { inflow: 110000 });
wet.rebuild(0);
const dry = new Run('a5', { inflow: 8000 });
dry.rebuild(0);
const wetSpill = wet.bounds(A5_INDEX).find((p) => p.id === 'spill');
const drySpill = dry.bounds(A5_INDEX).find((p) => p.id === 'spill');
assert.ok(wetSpill, 'a high inflow still spills');
if (drySpill && wetSpill) assert.ok(wetSpill.t0 < drySpill.t0, 'more inflow spills earlier');

const day = new Run('day');
day.rebuild(0);
const night = 2 / 24 * day.duration;
const peak = 17 / 24 * day.duration;
assert.equal(day.phaseAt(night, A5_INDEX), 'stand', 'A5 is off in the night valley');
assert.notEqual(day.phaseAt(peak, A5_INDEX), 'stand', 'A5 carries the afternoon peak');
day.seek(peak);
const hour = day.state.hour;
assert.ok(hour > 16 && hour < 18, `peak hour ${hour}`);
const followed = 3;
assert.equal(typeof day.phaseAt(peak, followed), 'string');
const day2 = new Run('day');
day2.rebuild(peak);
near(day2.state.lake, day.state.lake, 1e-6, 'dispatch day lake is exact');

const hill = hillSamples();
const peakGate = hill.reduce((p, q) => (q.eta > p.eta ? q : p));
near(peakGate.gate, 0.84, 0.03, 'hill peak near 84% gate');
for (const p of hill) near(p.eta, efficiency(p.gate), 1e-12, `hill sample at ${p.gate}`);
assert.equal(hill[0].eta, 0);
assert.equal(PHASES.length, 6);

console.log('sequence checks passed');
console.log(`  A5 phases: ${bounds.map((p) => `${p.id}@${p.t0.toFixed(1)}`).join(' ')}`);
console.log(`  spill drum raised ${spillHi.toFixed(2)}s, lowered ${spillLo.toFixed(2)}s`);
console.log(`  end lake ${a.lakeAt(a.duration).toFixed(1)} ft`);
