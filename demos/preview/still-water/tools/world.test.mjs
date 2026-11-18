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
// Starting right beside a pillar, at any angle, there is a route, and following it never passes through the pillar or a wall.
for (const pl of w.pillars) for (let k = 0; k < 24; k++) { const ang = k / 24 * Math.PI * 2, me = { ...newWalker(w), x: pl.x + Math.cos(ang) * 0.83, z: pl.z + Math.sin(ang) * 0.83 }; assert.ok(clear(w, me.x, me.z)); const v = viewPoint(w, w.photos[k % 12]), path = route(w, me.x, me.z, v.x, v.z); assert.ok(path, 'no route when starting beside a pillar');
  const steps = path.slice(1); let done = false, t = 0; while (!done && t < 120) { done = follow(w, me, steps, v.yaw, 1 / 60); t += 1 / 60; assert.ok(clear(w, me.x, me.z, RADIUS - 0.02), `a walk from beside a pillar passed through something at ${me.x.toFixed(2)}, ${me.z.toFixed(2)}`); } assert.ok(done); }
// Nonsense times and places are refused, not spread.
{ const me = newWalker(w); walk(w, me, { forward: 1 }, NaN); follow(w, me, [[me.x + 1, me.z]], 0, NaN); assert.ok(Number.isFinite(me.x + me.z + me.y + me.yaw), 'a NaN time step poisoned the walker'); assert.equal(clear(w, NaN, NaN), false); assert.equal(clear(w, Infinity, 0), false); }
// A step with a silly time gap is cut down to a tenth of a second.
{ const me = newWalker(w); walk(w, me, { forward: 1 }, 1e9); assert.ok(me.moved <= 0.28); walk(w, me, { forward: 1 }, -5); assert.equal(me.moved, 0); walk(w, me, { forward: NaN, strafe: undefined }, 1 / 60); assert.ok(Number.isFinite(me.x)); }
// The rooms as geometry: every number finite, every triangle facing into a room, light in range, water over every pool.
import { buildRooms, KIND } from '../js/build.js';
const t0 = Date.now(), g = buildRooms(w), nv = g.position.length / 3;
for (const arr of [g.position, g.normal, g.light, g.kind, g.wet, g.water.position]) for (const v of arr) assert.ok(Number.isFinite(v));
assert.equal(g.normal.length, nv * 3); assert.equal(g.light.length, nv * 3); assert.equal(g.kind.length, nv); assert.equal(g.wet.length, nv); assert.ok(Math.max(...g.index) < nv);
{ let wrong = 0, buried = 0; const inRoom = (x, z) => { const c = w.cellAt(x, z); return !!c && (c.open || (c.pillar && Math.hypot(x - c.x, z - c.z) > 0.5)); }; // every triangle is wound to match its normal, and its normal points into a room, not into the wall behind it
  for (let i = 0; i < g.index.length; i += 3) { const [a, b, c] = [g.index[i], g.index[i + 1], g.index[i + 2]], P = k => [g.position[k * 3], g.position[k * 3 + 1], g.position[k * 3 + 2]], pa = P(a), pb = P(b), pc = P(c);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], nn = [g.normal[a * 3], g.normal[a * 3 + 1], g.normal[a * 3 + 2]];
    if (n[0] * nn[0] + n[1] * nn[1] + n[2] * nn[2] <= 0) wrong++;
    const cx = (pa[0] + pb[0] + pc[0]) / 3 + nn[0] * 0.08, cz = (pa[2] + pb[2] + pc[2]) / 3 + nn[2] * 0.08; const cell = w.cellAt(cx, cz); if (Math.abs(nn[1]) > 0.5 ? !(cell && (cell.open || cell.pillar)) : !inRoom(cx, cz)) buried++; } // floors and ceilings run on under a pillar; walls must face open air
  assert.equal(wrong, 0, `${wrong} triangles face the wrong way`); assert.equal(buried, 0, `${buried} triangles face into solid wall`); }
// The drawn pool floor agrees with the floor you walk on, to within 4 cm, everywhere.
{ let worst = 0; for (let i = 0; i < nv; i++) if (g.kind[i] === KIND.pool) { const x = g.position[i * 3], z = g.position[i * 3 + 2], c = w.cellAt(x + 1e-3, z + 1e-3) || w.cellAt(x - 1e-3, z - 1e-3); if (c && c.pool) worst = Math.max(worst, Math.abs(g.position[i * 3 + 1] - floorAt(w, Math.min(Math.max(x, c.x - 0.9999), c.x + 0.9999), Math.min(Math.max(z, c.z - 0.9999), c.z + 0.9999)))); }
  let mid = 0; for (const c of w.cells) if (c.pool) for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) { const x0 = c.x - 1 + a * 0.25, z0 = c.z - 1 + b * 0.25, f = (x, z) => floorAt(w, Math.min(Math.max(x, c.x - 0.9999), c.x + 0.9999), Math.min(Math.max(z, c.z - 0.9999), c.z + 0.9999)), drawn = (f(x0, z0) + f(x0 + 0.25, z0) + f(x0, z0 + 0.25) + f(x0 + 0.25, z0 + 0.25)) / 4; mid = Math.max(mid, Math.abs(drawn - f(x0 + 0.125, z0 + 0.125))); }
  assert.ok(worst < 1e-3, `pool floor corners are off by ${worst.toFixed(3)} m`); assert.ok(mid < 0.04, `between corners the drawn pool floor is off by ${mid.toFixed(3)} m`); }
{ let lo = Infinity, hi = 0, wetOnes = 0; for (let i = 0; i < nv; i++) { const l = g.light[i * 3 + 1]; lo = Math.min(lo, l); hi = Math.max(hi, l); if (g.wet[i] > 0.99) wetOnes++; assert.ok(g.wet[i] >= 0 && g.wet[i] <= 1); } assert.ok(lo > 0.15 && hi < 2.21 && hi > 1, `light runs from ${lo.toFixed(2)} to ${hi.toFixed(2)}`); assert.ok(wetOnes > 1000); }
assert.equal(g.water.index.length / 6, w.cells.filter(c => c.pool).length); assert.ok([...g.kind].filter(k => k === KIND.sky).length === w.skylights.length * 4);
const buildMs = Date.now() - t0;

// The plain gallery in index.html (shown when the rooms cannot start) lists the same twelve photographs, in the same order, with the same words, and links back to the site.
import fs from 'node:fs';
import { PHOTOS } from '../js/photos.js';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
{ const flat = html.slice(html.indexOf('<main id="fallback">'), html.indexOf('</main>')); assert.ok(flat.length > 100, 'index.html has no plain gallery');
  const items = [...flat.matchAll(/<li><figure><img src="([^"]+)" alt="" loading="lazy" width="(\d+)" height="(\d+)"><figcaption><b>Plate (\d\d)<\/b> ([^<]+)<\/figcaption><\/figure><\/li>/g)];
  assert.equal(items.length, 12, `the plain gallery lists ${items.length} photographs, not 12`);
  assert.deepEqual(items.map(m => m[4]), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
  assert.deepEqual(items.map(m => m[1]), PHOTOS.map(p => p.file), 'the plain gallery and photos.js disagree about the files');
  assert.deepEqual(items.map(m => m[5]), PHOTOS.map(p => p.alt), 'the plain gallery and photos.js disagree about the words');
  assert.match(items[1][5], /sailing boat/); // plate 2, checked by eye against img/k06.jpg
  assert.deepEqual(items.filter(m => m[2] === '512' && m[3] === '768').map(m => m[4]), ['05', '07'], 'the two portrait pictures (k19, k09: 512 by 768 pixels) are the only tall ones');
  assert.ok(/<a href="\.\.\/\.\.\/">[^<]*Elusion Works<\/a>/.test(flat), 'the plain gallery has no link back to the site'); }
// Every smoothstep in the shaders with number edges has them low then high: the other way round is undefined in GLSL.
{ const src = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8'), calls = [...src.matchAll(/smoothstep\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,/g)];
  assert.ok(calls.length >= 1); for (const m of calls) assert.ok(Number(m[1]) < Number(m[2]), `smoothstep(${m[1]}, ${m[2]}, ...) has its edges the wrong way round`); }
// The words on the page never claim more about the photographs' rights than is known.
// Any sentence that says "public domain" must deny it; any that says "unrestricted" must put it in someone else's mouth.
for (const f of ['../index.html', '../README.md', '../REVIEW.md', '../js/photos.js']) for (const said of fs.readFileSync(new URL(f, import.meta.url), 'utf8').split(/[.\n|]/)) {
  if (/public domain/i.test(said)) assert.match(said, /\b(no|not|nothing|never)\b/i, `${f} calls the photographs public domain: "${said.trim()}"`);
  if (/unrestricted/i.test(said)) assert.match(said, /\b(says|statement|claim|reports?)\b/i, `${f} states unrestricted use as fact: "${said.trim()}"`); }
assert.ok(/terms of reuse are not settled/.test(html) && /must be replaced/.test(html), 'the page does not say the photographs are stand-ins to be replaced');
console.log(`ok  the place: ${open.length} open squares all reachable, 12 photographs each viewable, 160,000 random steps never in a wall, walk round takes ${total.toFixed(0)} s (longest leg ${longest.toFixed(1)} s); rooms: ${nv} corners, ${g.index.length / 3} triangles, lit in ${buildMs} ms`);
console.log('ok  the plain gallery in index.html lists the same twelve photographs and words as photos.js, with a link back to the site; shader smoothsteps run low to high; the page calls the photographs unsettled stand-ins');
