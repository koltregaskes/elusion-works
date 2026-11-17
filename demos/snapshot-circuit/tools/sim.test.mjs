// Run: node demos/snapshot-circuit/tools/sim.test.mjs
// Track building and the race, with no browser: a made-up set of objects stands in for a photograph.
import assert from 'node:assert/strict';
import { buildTrack, nearest, toWorld, toPhoto, HALF, KART_R, LAPS, WORLD_W } from '../js/track.js';
import { newRace, step, standings, autopilot, DT } from '../js/game.js';
import { colourName, analyse } from '../js/photo.js';

const blob = (id, x, y, w, h, colour, role = 'hazard') => ({ id, x, y, x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2, area: w * h * 0.7, colour, name: colourName(colour), role });
const caps = { width: 192, height: 128, blobs: [blob(0, 0.251, 0.375, 0.28, 0.44, [215, 235, 20]), blob(1, 0.502, 0.502, 0.2, 0.35, [240, 70, 30]), blob(2, 0.666, 0.584, 0.14, 0.3, [70, 200, 50]), blob(3, 0.781, 0.635, 0.12, 0.23, [235, 40, 110]), blob(4, 0.871, 0.733, 0.1, 0.19, [32, 28, 38])] };
function check(analysis, label) {
  const t = buildTrack(analysis);
  // The road is a closed loop inside the picture, and no object blocks it.
  assert.ok(t.n >= 300 && t.length > 150, `${label}: track too short`);
  for (const p of t.pts) assert.ok(Math.abs(p[0]) <= WORLD_W / 2 - HALF && Math.abs(p[1]) <= t.H / 2 - HALF, `${label}: road leaves the picture`);
  for (let i = 0; i < t.n; i++) { const a = t.pts[i], b = t.pts[(i + 1) % t.n]; assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 3, `${label}: gap in the road`); }
  for (const hz of t.hazards) for (const p of t.pts) assert.ok(Math.hypot(p[0] - hz.x, p[1] - hz.z) >= hz.r + KART_R + HALF * 0.5 - 0.01, `${label}: an object blocks the road`);
  // Every object keeps its place: world position maps back to where it sits in the photograph.
  for (const hz of t.hazards) { const b = analysis.blobs[hz.blob], [u, v] = toPhoto(hz.x, hz.z, t.H); assert.ok(Math.abs(u - b.x) < 1e-9 && Math.abs(v - b.y) < 1e-9); }
  assert.ok(t.pickups.length >= 5); for (const p of t.pickups) assert.ok(Math.hypot(t.pts[nearest(t, p.x, p.z, 0, t.n)][0] - p.x, t.pts[nearest(t, p.x, p.z, 0, t.n)][1] - p.z) < HALF, `${label}: a pick-up is off the road`);
  // A full race on autopilot: three laps, checkpoints in order, nobody drives through an object.
  const race = newRace(t); let steps = 0, events = { bump: 0, pickup: 0, lap: 0, finish: 0 }, deepest = Infinity;
  while (!race.karts.every(k => k.done) && steps < 60 * 400) { step(race, autopilot(race, race.karts[0])); steps++; for (const e of race.events) if (e.type in events) events[e.type]++;
    for (const k of race.karts) for (const hz of t.hazards) deepest = Math.min(deepest, Math.hypot(k.x - hz.x, k.z - hz.z) - hz.r - KART_R); }
  assert.ok(race.karts.every(k => k.done && k.lap === LAPS && k.laps.length === LAPS), `${label}: not everyone finished (${race.karts.map(k => k.lap)}) after ${steps} steps`);
  assert.equal(events.lap, LAPS * race.karts.length); assert.equal(events.finish, race.karts.length); assert.ok(events.pickup >= 3, `${label}: pick-ups never collected`); assert.ok(deepest > -0.01, `${label}: a kart went ${(-deepest).toFixed(2)} into an object`);
  assert.deepEqual([...race.order].sort(), race.karts.map(k => k.id)); assert.equal(standings(race)[0], race.order[0]);
  return { t, race, steps, events };
}
const a = check(caps, 'caps');
// The same inputs give the same race.
const b = check(caps, 'caps again'); assert.equal(a.steps, b.steps); assert.deepEqual(a.race.karts.map(k => [k.x, k.z, k.time]), b.race.karts.map(k => [k.x, k.z, k.time]));
// Rules: nothing moves before the lights; standing still earns no lap; driving the wrong way earns no lap; hitting an object costs speed.
{ const t = a.t, r = newRace(t); for (let i = 0; i < 60; i++) step(r, { steer: 0, throttle: 1, brake: 0 }); assert.ok(r.karts.every(k => k.v === 0) && !r.go, 'karts move before the start');
  for (let i = 0; i < 60 * 4; i++) step(r, { steer: 0, throttle: 0, brake: 0 }); assert.ok(r.go && r.karts[0].lap === 0);
  const k = r.karts[0]; for (let i = 0; i < 60 * 60 && k.lap === 0; i++) { const ap = autopilot(r, k); step(r, { steer: 0, throttle: 0, brake: 0 }); void ap; } assert.equal(k.lap, 0, 'a parked kart completed a lap');
  const r2 = newRace(t); r2.go = true; const p = r2.karts[0]; p.h += Math.PI; for (let i = 0; i < 60 * 40; i++) { const j = (p.i - 9 + t.n) % t.n, want = Math.atan2(t.pts[j][1] - p.z, t.pts[j][0] - p.x), err = Math.atan2(Math.sin(want - p.h), Math.cos(want - p.h)); step(r2, { steer: Math.max(-1, Math.min(1, err * 2.6)), throttle: p.v < 18 ? 1 : 0, brake: 0 }); } assert.equal(p.lap, 0, 'driving the wrong way round counted as a lap');
  const r3 = newRace(t); r3.go = true; const q = r3.karts[0], hz = t.hazards[0]; q.x = hz.x - hz.r - 12; q.z = hz.z; q.h = 0; q.v = 25; q.i = nearest(t, q.x, q.z, 0, t.n); let hit = null; for (let i = 0; i < 90 && !hit; i++) { step(r3, { steer: 0, throttle: 1, brake: 0 }); hit = r3.events.find(e => e.type === 'bump' && e.kart === 0); }
  assert.ok(hit && q.v < 12 && Math.hypot(q.x - hz.x, q.z - hz.z) >= hz.r + KART_R - 0.01, 'a head-on hit should stop the kart at the object'); }
// Awkward pictures still make a circuit: one huge object, objects in the corners, nothing at all, a crowd.
check({ width: 192, height: 128, blobs: [blob(0, 0.5, 0.5, 0.5, 0.6, [200, 40, 40])] }, 'one big object');
check({ width: 192, height: 128, blobs: [blob(0, 0.08, 0.1, 0.12, 0.16, [200, 40, 40]), blob(1, 0.92, 0.1, 0.12, 0.16, [40, 200, 40]), blob(2, 0.08, 0.9, 0.12, 0.16, [40, 40, 200]), blob(3, 0.92, 0.9, 0.12, 0.16, [200, 200, 40])] }, 'corners');
check({ width: 128, height: 192, blobs: [] }, 'empty portrait');
check({ width: 192, height: 128, blobs: Array.from({ length: 11 }, (_, i) => blob(i, 0.12 + 0.076 * i, 0.2 + 0.6 * ((i * 7) % 11) / 11, 0.1, 0.14, [20 * i, 255 - 20 * i, 120], i < 6 ? 'hazard' : 'pickup')) }, 'crowd');
// The analyser on a made-up picture: three coloured squares on grey, one touching the edge.
{ const w = 192, h = 128, data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const g = 120 + ((i * 37) % 9); data.set([g, g, g, 255], i * 4); }
  const sq = (x0, y0, s, c) => { for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) data.set([...c, 255], (y * w + x) * 4); };
  sq(40, 40, 22, [230, 40, 40]); sq(120, 70, 18, [40, 60, 220]); sq(84, 20, 9, [240, 220, 30]); sq(0, 100, 20, [20, 160, 60]);
  const an = analyse({ width: w, height: h, data }); assert.equal(an.method, 'colour'); const names = an.blobs.map(b => b.name).sort(); assert.deepEqual(names, ['blue', 'red', 'yellow'], 'finds the three objects inside the frame, not the one on the edge: ' + names);
  const red = an.blobs.find(b => b.name === 'red'); assert.ok(Math.abs(red.x - 51 / w) < 0.01 && Math.abs(red.y - 51 / h) < 0.01); check(an, 'made-up picture'); }
// ---- Many made-up pictures, in every shape the page allows: each gives a road that does not cross itself, that nothing blocks, and that all three karts finish on. ----
let fuzzRaces = 0, fuzzRescues = 0, flatObjects = 0;
{ let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const crossing = pts => { const n = pts.length, o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; const a = pts[i], b = pts[(i + 1) % n], c = pts[j], d = pts[(j + 1) % n]; if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true; } return false; };
  for (const [w, h] of [[192, 108], [192, 96], [192, 128], [160, 160], [120, 192], [115, 192]]) for (let k = 0; k < 110; k++) {
    const count = Math.floor(rand() * 11), blobs = []; for (let b = 0; b < count; b++) { const bw = 0.03 + rand() * (rand() < 0.2 ? 0.5 : 0.2), bh = 0.03 + rand() * (rand() < 0.2 ? 0.5 : 0.2), x = bw / 2 + rand() * (1 - bw), y = bh / 2 + rand() * (1 - bh); blobs.push(blob(b, x, y, bw, bh, [Math.floor(rand() * 255), Math.floor(rand() * 255), Math.floor(rand() * 255)], rand() < 0.75 ? 'hazard' : 'pickup')); }
    const label = `made-up picture ${w}x${h} #${k}`, t = buildTrack({ width: w, height: h, blobs });
    assert.ok(!crossing(t.pts), `${label}: the road crosses itself`);
    for (const p of t.pts) assert.ok(Math.abs(p[0]) <= WORLD_W / 2 - HALF && Math.abs(p[1]) <= t.H / 2 - HALF, `${label}: road leaves the picture`);
    for (let i = 0; i < t.n; i++) { const a = t.pts[i], b = t.pts[(i + 1) % t.n]; assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 3, `${label}: gap in the road`); }
    for (const hz of t.hazards) for (const p of t.pts) assert.ok(Math.hypot(p[0] - hz.x, p[1] - hz.z) >= hz.r + KART_R + HALF * 0.5 - 0.01, `${label}: an object blocks the road`);
    assert.equal(t.hazards.length + t.flat.length, blobs.filter(b => b.role === 'hazard').length); flatObjects += t.flat.length;
    const race = newRace(t); let steps = 0, rescues = 0; assert.equal(standings(race)[2], 0, `${label}: the player starts at the back but is not shown last`);
    while (!race.karts.every(q => q.done) && steps < 60 * 300) { step(race, autopilot(race, race.karts[0])); steps++; for (const e of race.events) if (e.type === 'rescue') rescues++; for (const q of race.karts) for (const hz of t.hazards) assert.ok(Math.hypot(q.x - hz.x, q.z - hz.z) >= hz.r + KART_R - 0.05, `${label}: a kart is inside an object`); }
    assert.ok(race.karts.every(q => q.done), `${label}: not everyone finished (laps ${race.karts.map(q => q.lap)}, rescues ${rescues})`); assert.ok(rescues <= 6, `${label}: ${rescues} rescues in one race`); assert.ok(steps < 60 * 200, `${label}: the race took ${(steps / 60).toFixed(0)} s`);
    fuzzRaces++; fuzzRescues += rescues; } }
// Driving the wrong way round the whole circuit, for five minutes, never counts a lap.
{ const t = a.t, r = newRace(t); r.go = true; const p = r.karts[0]; p.h += Math.PI; let back = 0;
  for (let i = 0; i < 60 * 300; i++) { const j = (p.i - 9 + t.n) % t.n, want = Math.atan2(t.pts[j][1] - p.z, t.pts[j][0] - p.x), err = Math.atan2(Math.sin(want - p.h), Math.cos(want - p.h)), i0 = p.i; step(r, { steer: Math.max(-1, Math.min(1, err * 2.6)), throttle: p.v < 22 ? 1 : 0, brake: 0 }); back += ((i0 - p.i + t.n) % t.n) < 30 ? (i0 - p.i + t.n) % t.n : 0; }
  assert.ok(back > t.n * 5, `the wrong-way driver only got ${(back / t.n).toFixed(1)} laps backwards`); assert.equal(p.lap, 0, 'driving the wrong way round counted laps'); assert.equal(p.done, false); }
// Real pixels through the detector, in awkward shapes: nothing throws, flat pictures claim no objects, one clear object is kept.
{ const pic = (w, h, paint) => { const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = paint(x, y); data.set([c[0], c[1], c[2], c[3] ?? 255], (y * w + x) * 4); } return { width: w, height: h, data }; };
  for (const [w, h] of [[1024, 512], [1024, 77], [77, 1024], [3, 2], [640, 640], [600, 1000]]) { const flat = analyse(pic(w, h, () => [200, 200, 200])); assert.equal(flat.blobs.length, 0, `a flat ${w}x${h} picture claims ${flat.blobs.length} objects`); assert.equal(flat.method, 'plain');
    const clear = analyse(pic(w, h, () => [0, 0, 0, 0])); assert.equal(clear.blobs.length, 0, 'an empty see-through picture claims objects');
    const noisy = analyse(pic(w, h, (x, y) => { const v = ((x * 7919 + y * 104729) % 97) * 2.6; return [v, v, v]; })); for (const b of noisy.blobs) assert.ok(Number.isFinite(b.x + b.y + b.area) && b.name, 'a busy patch has no proper description'); }
  const one = analyse(pic(900, 600, (x, y) => (Math.hypot(x - 300, y - 250) < 80 ? [220, 30, 30] : [140, 145, 150]))); assert.equal(one.method, 'colour'); assert.equal(one.blobs.length, 1, 'one clear object should be kept, not swapped for patches'); assert.equal(one.blobs[0].name, 'red'); check(one, 'one red ball'); }
console.log(`ok  track and race: ${a.t.n} road points, ${a.t.length.toFixed(0)} units a lap, autopilot race of ${LAPS} laps in ${(a.steps * DT).toFixed(1)} s, ${a.events.pickup} pick-ups, ${a.events.bump} bumps; rules and awkward pictures hold; ${fuzzRaces} made-up pictures in six shapes all raced to the finish (${fuzzRescues} rescues in all, ${flatObjects} objects left flat for want of room)`);
