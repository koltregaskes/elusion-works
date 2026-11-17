// Checks on the place itself, run in Node: node demos/still-water/tools/world.test.mjs
import assert from 'node:assert/strict';
import { makeWorld, newWalker, walk, clear, floorAt, viewPoint, route, follow, facing, clearLine, CELL, EYE, RADIUS, POOL_FLOOR, ORDER } from '../js/world.js';

const w = makeWorld();
// The plan: closed at the edges, one way in, twelve photographs, every open square reachable.
for (const c of w.cells) if (c.r === 0 || c.c === 0 || c.r === w.rows - 1 || c.c === w.cols - 1) assert.ok(!c.open, `the edge of the plan is open at ${c.r},${c.c}`);
assert.equal(w.photos.length, 12); assert.deepEqual(w.photos.map(p => p.id).join(''), ORDER); assert.deepEqual(w.photos.map(p => p.plate), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const open = w.cells.filter(c => c.open), seen = new Set([w.start]), q = [w.start];
for (let i = 0; i < q.length; i++) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = w.cell(q[i].r + dr, q[i].c + dc); if (n && n.open && !seen.has(n)) { seen.add(n); q.push(n); } }
assert.equal(seen.size, open.length, 'some part of the place cannot be reached');
assert.ok(w.skylights.length >= 8 && w.pillars.length === 2);

// Each photograph hangs on a wall, faces into a room, and can be stood in front of and seen.
for (const p of w.photos) {
  assert.ok(!w.cell(p.r, p.c).open && w.cell(p.front.r, p.front.c).open); assert.ok(p.free >= CELL);
  for (const dist of [0.5, 1.7, 2.6, 4, 9]) { const v = viewPoint(w, p, dist); assert.ok(clear(w, v.x, v.z), `plate ${p.plate}: the viewing spot at ${dist} m is in a wall`);
    const me = { ...newWalker(w), x: v.x, z: v.z, yaw: v.yaw }; assert.equal(facing(w, me), p, `plate ${p.plate}: standing in front of it at ${dist} m does not count as looking at it`);
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw); assert.ok(Math.abs(v.x + fx * v.dist - p.x) < 1e-9 && Math.abs(v.z + fz * v.dist - p.z) < 1e-9, `plate ${p.plate}: the viewing direction misses the photograph`); }
  const away = { ...newWalker(w), x: viewPoint(w, p).x, z: viewPoint(w, p).z, yaw: p.yaw + Math.PI }; assert.notEqual(facing(w, away), p, 'a photograph behind you is not the one you are looking at');
}
assert.equal(facing(w, newWalker(w)), null, 'nothing is in view on the way in');

// Walking: thousands of random steps never end inside a wall or pillar, never leave the plan, and the eye never jumps.
let rnd = 12345; const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
let wet = 0, far = 0;
for (let walker = 0; walker < 40; walker++) { const me = newWalker(w); const c0 = open[Math.floor(rand() * open.length)]; me.x = c0.x; me.z = c0.z; me.y = floorAt(w, me.x, me.z) + EYE; let inp = { forward: 1, strafe: 0, turn: 0 };
  for (let i = 0; i < 4000; i++) { if (i % 30 === 0) inp = { forward: rand() * 2.4 - 0.7, strafe: rand() * 2 - 1, turn: (rand() * 2 - 1) * 3 }; const dt = rand() < 0.02 ? 5 : 1 / 60 + rand() * 0.03, y0 = me.y;
    walk(w, me, inp, dt); assert.ok(clear(w, me.x, me.z, RADIUS - 1e-6), `walker ${walker} ended in a wall at ${me.x.toFixed(2)}, ${me.z.toFixed(2)}`); assert.ok(Number.isFinite(me.x + me.z + me.y + me.yaw));
    assert.ok(Math.abs(me.y - y0) < 0.2, `the eye jumped ${Math.abs(me.y - y0).toFixed(2)} m in one step`); assert.ok(me.y >= POOL_FLOOR + EYE - 1e-6 && me.y <= EYE + 1e-6); assert.ok(me.wade >= 0 && me.wade <= 1);
    if (me.wade > 0.9) wet++; far = Math.max(far, Math.hypot(me.x - c0.x, me.z - c0.z)); } }
assert.ok(wet > 1000, 'no walker ever waded into a pool'); assert.ok(far > 12, 'the walkers barely moved');
// The floor of a pool shelves smoothly: no step anywhere, sampled every 5 cm across the whole plan.
{ let worst = 0; for (let z = -w.depth / 2 + 0.01; z < w.depth / 2; z += 0.05) for (let x = -w.width / 2 + 0.01; x < w.width / 2 - 0.06; x += 0.05) { const a = w.cellAt(x, z), b = w.cellAt(x + 0.05, z), c = w.cellAt(x, z + 0.05); if (a && b && a.open && b.open) worst = Math.max(worst, Math.abs(floorAt(w, x, z) - floorAt(w, x + 0.05, z))); if (a && c && a.open && c.open) worst = Math.max(worst, Math.abs(floorAt(w, x, z) - floorAt(w, x, z + 0.05))); } assert.ok(worst < 0.04, `the floor has a step of ${worst.toFixed(2)} m`); }
// A wall really stops you: walk north from the way in for a minute.
{ const me = newWalker(w); me.yaw = 0; for (let i = 0; i < 3600; i++) walk(w, me, { forward: 1 }, 1 / 60); assert.ok(Math.abs(me.z - (w.start.z - CELL * 1.5 + RADIUS)) < 0.05, `walking into the north wall ended at z ${me.z.toFixed(2)}`); }
// Speed: about 2.7 m a second on dry floor, slower in water; diagonal input is no faster.
{ const me = newWalker(w); for (let i = 0; i < 60; i++) walk(w, me, { forward: 1 }, 1 / 60); const d = me.x - w.start.x; assert.ok(Math.abs(d - 2.7) < 0.05, `one second of walking covered ${d.toFixed(2)} m`);
  const me2 = newWalker(w); me2.z += 1; let total = 0; for (let i = 0; i < 60; i++) { walk(w, me2, { forward: 1, strafe: 1 }, 1 / 60); total += me2.moved; } assert.ok(total < 2.75, 'walking diagonally is faster than walking straight'); }

// The walk round: from every photograph to the next there is a route, it stays clear of walls, and following it arrives facing the photograph.
let longest = 0, total = 0;
{ const me = newWalker(w); const stops = [...w.photos, w.photos[0], w.photos[7], w.photos[3]];
  for (const p of stops) { const v = viewPoint(w, p), path = route(w, me.x, me.z, v.x, v.z); assert.ok(path && path.length >= 2, `no route to plate ${p.plate}`);
    for (let i = 0; i < path.length - 1; i++) assert.ok(clearLine(w, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], RADIUS), `the route to plate ${p.plate} cuts a corner through a wall`);
    const steps = path.slice(1); let t = 0, done = false; while (!done && t < 120) { const y0 = me.y; done = follow(w, me, steps, v.yaw, 1 / 60); t += 1 / 60; assert.ok(clear(w, me.x, me.z, RADIUS - 1e-6), `the walk to plate ${p.plate} passed through a wall`); assert.ok(Math.abs(me.y - y0) < 0.2); }
    assert.ok(done, `the walk to plate ${p.plate} never arrived`); assert.ok(Math.hypot(me.x - v.x, me.z - v.z) < 1e-6); assert.equal(facing(w, me), p); longest = Math.max(longest, t); total += t; } }
assert.equal(route(w, 0, 0, 1000, 1000), null);
{ const pl = w.pillars[0], path = route(w, pl.x + 0.9, pl.z, w.start.x, w.start.z); assert.ok(path, 'no route when starting beside a pillar'); }
// A step with a silly time gap is cut down to a tenth of a second.
{ const me = newWalker(w); walk(w, me, { forward: 1 }, 1e9); assert.ok(me.moved <= 0.28); walk(w, me, { forward: 1 }, -5); assert.equal(me.moved, 0); walk(w, me, { forward: NaN, strafe: undefined }, 1 / 60); assert.ok(Number.isFinite(me.x)); }
// The rooms as geometry: every number finite, every triangle facing into a room, light in range, water over every pool.
import { buildRooms, KIND } from '../js/build.js';
const t0 = Date.now(), g = buildRooms(w), nv = g.position.length / 3;
for (const arr of [g.position, g.normal, g.light, g.kind, g.wet, g.water.position]) for (const v of arr) assert.ok(Number.isFinite(v));
assert.equal(g.normal.length, nv * 3); assert.equal(g.light.length, nv * 3); assert.equal(g.kind.length, nv); assert.equal(g.wet.length, nv); assert.ok(Math.max(...g.index) < nv);
{ let wrong = 0; for (let i = 0; i < g.index.length; i += 3) { const [a, b, c] = [g.index[i], g.index[i + 1], g.index[i + 2]], P = k => [g.position[k * 3], g.position[k * 3 + 1], g.position[k * 3 + 2]], pa = P(a), pb = P(b), pc = P(c);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * g.normal[a * 3] + n[1] * g.normal[a * 3 + 1] + n[2] * g.normal[a * 3 + 2] <= 0) wrong++; } assert.equal(wrong, 0, `${wrong} triangles face the wrong way`); }
{ let lo = Infinity, hi = 0, wetOnes = 0; for (let i = 0; i < nv; i++) { const l = g.light[i * 3 + 1]; lo = Math.min(lo, l); hi = Math.max(hi, l); if (g.wet[i] > 0.99) wetOnes++; assert.ok(g.wet[i] >= 0 && g.wet[i] <= 1); } assert.ok(lo > 0.15 && hi < 2.21 && hi > 1, `light runs from ${lo.toFixed(2)} to ${hi.toFixed(2)}`); assert.ok(wetOnes > 1000); }
assert.equal(g.water.index.length / 6, w.cells.filter(c => c.pool).length); assert.ok([...g.kind].filter(k => k === KIND.sky).length === w.skylights.length * 4);
const buildMs = Date.now() - t0;
console.log(`ok  the place: ${open.length} open squares all reachable, 12 photographs each viewable, 160,000 random steps never in a wall, walk round takes ${total.toFixed(0)} s (longest leg ${longest.toFixed(1)} s); rooms: ${nv} corners, ${g.index.length / 3} triangles, lit in ${buildMs} ms`);
