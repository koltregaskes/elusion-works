// Checks on the film's camera moves and the parts list, run in Node: node demos/camera-turntable/tools/film.test.mjs
import assert from 'node:assert/strict';
import { SHOTS, STARTS, LENGTH, SOLID, PARTS, HOME, LIMITS, BODY, LENS, frame, place, inside, orbit, towards, viewOf } from '../js/film.js';
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const toBox = (p, [lo, hi]) => Math.hypot(...p.map((v, n) => Math.max(lo[n] - v, 0, v - hi[n]))), toModel = p => Math.min(...SOLID.map(b => toBox(p, b)));

// The film: seven shots, about 36 seconds, each long enough to read and none dragging.
assert.equal(SHOTS.length, 7); assert.equal(STARTS[0], 0); assert.ok(Math.abs(LENGTH - SHOTS.reduce((s, x) => s + x.secs, 0)) < 1e-9); assert.ok(LENGTH > 30 && LENGTH < 45, `the film runs ${LENGTH} s`); for (const s of SHOTS) assert.ok(s.secs >= 4 && s.secs <= 8, `"${s.name}" lasts ${s.secs} s`);
assert.equal(new Set(SHOTS.map(s => s.name)).size, 7);
// Frame by frame at sixty a second: every number finite; the camera never inside the camera, never closer than 5 cm to it,
// never under the turntable; it always looks at the product; and inside a shot it glides (no step bigger than 3 mm a frame, no jolt in speed).
let prev = null, cuts = 0, fastest = 0, nearest = Infinity, jolt = 0, lastStep = 0;
for (let n = 0; n <= Math.round(LENGTH * 60); n++) { const t = n / 60, f = frame(t); for (const v of [...f.position, ...f.target, f.fov, f.open]) assert.ok(Number.isFinite(v));
  assert.ok(!inside(f.position), `at ${t.toFixed(2)} s the camera is inside the model`); const gap = toModel(f.position); nearest = Math.min(nearest, gap); assert.ok(gap >= 5, `at ${t.toFixed(2)} s the camera is ${gap.toFixed(1)} cm from the model`);
  assert.ok(f.position[1] > -BODY.h / 2 + 0.5, `at ${t.toFixed(2)} s the camera is below the turntable`); assert.ok(toModel(f.target) < 1.5, `at ${t.toFixed(2)} s the camera looks ${toModel(f.target).toFixed(1)} cm away from the model`); assert.ok(f.fov >= 24 && f.fov <= 40); assert.ok(f.open >= 0 && f.open <= 1);
  if (prev) { if (f.shot !== prev.shot) { cuts++; lastStep = 0; } else { const step = dist(f.position, prev.position); fastest = Math.max(fastest, step); assert.ok(step < 0.3, `at ${t.toFixed(2)} s the camera jumps ${step.toFixed(2)} cm in one frame`); jolt = Math.max(jolt, Math.abs(step - lastStep)); lastStep = step; assert.ok(dist(f.target, prev.target) < 0.2); } }
  prev = f; }
assert.equal(cuts, 6, 'six cuts between seven shots'); assert.ok(jolt < 0.02, `the camera's speed changes by ${jolt.toFixed(3)} cm a frame at its roughest`);
// Each shot starts and ends at rest (slow in, slow out), and starts exactly on its first pose.
SHOTS.forEach((s, i) => { const a = frame(STARTS[i]), b = frame(STARTS[i] + 1 / 60), end = frame(STARTS[i] + s.secs - 1e-6), before = frame(STARTS[i] + s.secs - 1 / 60); assert.ok(dist(a.position, place(s.from)) < 1e-9); assert.ok(dist(a.position, b.position) < 0.01, `"${s.name}" starts with a lurch`); assert.ok(dist(end.position, before.position) < 0.01, `"${s.name}" ends with a lurch`); assert.ok(dist(end.position, place(s.to)) < 1e-3); assert.equal(a.shot, i); assert.equal(a.name, s.name); });
// The body is shut for the first five shots, opens during the sixth without ever going back, and is shut again by the end.
for (let t = 0; t < STARTS[5]; t += 0.05) assert.equal(frame(t).open, 0); { let last = 0, top = 0; for (let t = STARTS[5]; t < STARTS[6]; t += 1 / 60) { const o = frame(t).open; assert.ok(o >= last - 1e-12, 'the body starts to shut again while it should be opening'); last = o; top = Math.max(top, o); } assert.ok(top > 0.999, 'the body never fully opens'); assert.equal(frame(STARTS[5]).open, 0); assert.ok(frame(STARTS[5] + 1).open < 0.02, 'the body opens before the eye has settled'); }
{ let last = 1; for (let t = STARTS[6]; t <= LENGTH; t += 1 / 60) { const o = frame(t).open; assert.ok(o <= last + 1e-12); last = o; } assert.equal(frame(LENGTH).open, 0); }
// The film ends exactly where the turntable rests, so handing back is not a jump. Silly times are held, not spread.
assert.ok(dist(frame(LENGTH).position, place(HOME)) < 1e-9); assert.ok(frame(LENGTH).done && !frame(LENGTH - 0.1).done); assert.deepEqual(frame(-5).position, frame(0).position); assert.deepEqual(frame(1e9).position, frame(LENGTH).position); assert.deepEqual(frame(NaN).position, frame(0).position);

// The parts: eleven, each with its own name and words; inside parts are inside the model, outside parts are on it; each view stands clear and looks at its part.
assert.equal(PARTS.length, 11); assert.equal(new Set(PARTS.map(p => p.id)).size, 11); assert.equal(new Set(PARTS.map(p => p.name)).size, 11); assert.equal(PARTS.filter(p => p.inside).length, 8);
for (const p of PARTS) { assert.ok(p.says.length > 30 && p.says.endsWith('.')); if (p.inside) assert.ok(inside(p.at), `${p.name} is marked as inside but its label points outside the model`); else assert.ok(toModel(p.at) < 0.8, `${p.name}'s label is ${toModel(p.at).toFixed(1)} cm off the model`);
  const v = viewOf(p), cam = place(v); assert.ok(!inside(cam) && toModel(cam) > 8, `the view of ${p.name} is too close`); assert.ok(dist(v.target, p.at) < 3.2, `the view of ${p.name} looks ${dist(v.target, p.at).toFixed(1)} cm away from it`); assert.ok(v.dist >= LIMITS.dist[0] && v.dist <= LIMITS.dist[1] && v.up >= LIMITS.up[0] && v.up <= LIMITS.up[1]); assert.ok(cam[1] > -BODY.h / 2 + 0.5); }
// Turning by hand: kept within limits, the angle kept between -180 and 180, and easing takes the short way round.
{ let p = { ...HOME }; for (let i = 0; i < 400; i++) p = orbit(p, { round: 7, up: 3, zoom: 0.9 }); assert.equal(p.up, LIMITS.up[1]); assert.equal(p.dist, LIMITS.dist[0]); assert.ok(p.round >= -180 && p.round < 180); for (let i = 0; i < 400; i++) p = orbit(p, { up: -3, zoom: 1.2 }); assert.equal(p.up, LIMITS.up[0]); assert.equal(p.dist, LIMITS.dist[1]); assert.ok(!inside(place(p)));
  const a = { ...HOME, round: 170 }, b = { ...HOME, round: -170 }; assert.ok(Math.abs(Math.abs(towards(a, b, 0.5).round) - 180) < 1e-9, 'easing went the long way round'); { let q = a; for (let i = 0; i < 5000; i++) { q = towards(q, { ...q, round: q.round + 90 }, 0.5); assert.ok(q.round >= -180 && q.round < 180, 'the angle drifted out of range'); } } assert.ok(dist(place(towards(a, b, 1)), place(b)) < 1e-9); assert.deepEqual(towards(HOME, HOME, 0.3), HOME); }
assert.ok(LENS.front > BODY.d / 2 && SOLID.length === 3);
console.log(`ok  film: 7 shots, ${LENGTH.toFixed(1)} s, ${Math.round(LENGTH * 60) + 1} frames checked; nearest approach ${nearest.toFixed(1)} cm, fastest move ${(fastest * 60).toFixed(1)} cm a second, no jolts; opens and shuts once; ends where the turntable rests; 11 parts each with a clear view`);
