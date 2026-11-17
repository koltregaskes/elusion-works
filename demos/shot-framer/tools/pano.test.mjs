// Checks the framing arithmetic and the sample picture without a browser. Usage: node pano.test.mjs
import assert from 'node:assert/strict';
import * as P from '../js/pano.js';
const RAD = Math.PI / 180, near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol, close = (a, b, tol = 1e-9) => a.every((v, i) => near(v, b[i], tol));
const picture = (w, h, paint) => { const data = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = paint((i + 0.5) / w, (j + 0.5) / h), k = (j * w + i) * 4; data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255; } return { data, width: w, height: h }; };
const blank = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), px = (img, i, j) => [...img.data.slice((j * img.width + i) * 4, (j * img.width + i) * 4 + 3)];

// Which way the middle of the frame looks: north is -z, east +x, up +y.
assert.ok(close(P.look({ yaw: 0, pitch: 0, fov: 50 }, 0, 0, 1.5), [0, 0, -1])); assert.ok(close(P.look({ yaw: 90, pitch: 0, fov: 50 }, 0, 0, 1.5), [1, 0, 0])); assert.ok(close(P.look({ yaw: 180, pitch: 0, fov: 50 }, 0, 0, 1.5), [0, 0, 1], 1e-9)); assert.ok(close(P.look({ yaw: -90, pitch: 0, fov: 50 }, 0, 0, 1.5), [-1, 0, 0])); assert.ok(close(P.look({ yaw: 37, pitch: 90, fov: 50 }, 0, 0, 1.5), [0, 1, 0], 1e-9));
// The right-hand edge looks to the right, the top edge looks up, by half the view each.
{ const v = { yaw: 0, pitch: 0, fov: 60 }, ratio = 16 / 9, right = P.look(v, 1, 0, ratio), top = P.look(v, 0, 1, ratio); assert.ok(right[0] > 0 && near(Math.atan2(right[0], -right[2]) / RAD, P.fovAcross(60, ratio) / 2, 1e-9)); assert.ok(near(Math.asin(top[1]) / RAD, 30, 1e-9)); assert.ok(near(P.fovAcross(60, 1), 60) && P.fovAcross(60, 16 / 9) > 91 && P.fovAcross(60, 16 / 9) < 92); }
// Round trips: frame to direction and back; picture to direction and back. Compass points fall where a 360 picture has them.
for (let n = 0; n < 500; n++) { const r = k => Math.abs(Math.sin(n * 12.9898 + k * 78.233) * 43758.5453) % 1, v = { yaw: r(1) * 360 - 180, pitch: r(2) * 160 - 80, fov: 15 + r(3) * 90 }, ratio = 0.5 + r(4) * 2, x = r(5) * 2 - 1, y = r(6) * 2 - 1, d = P.look(v, x, y, ratio), back = P.inFrame(v, d, ratio); assert.ok(near(Math.hypot(...d), 1)); assert.ok(near(back.x, x, 1e-7) && near(back.y, y, 1e-7), 'frame and back');
  const uv = P.toPicture(d), again = P.fromPicture(uv.u, uv.v); assert.ok(close(again, d, 1e-7), 'picture and back'); assert.ok(uv.u >= 0 && uv.u < 1 && uv.v >= 0 && uv.v <= 1); }
assert.equal(P.inFrame({ yaw: 0, pitch: 0, fov: 60 }, [0, 0, 1], 1), null, 'what is behind the camera is not in the frame');
for (const [d, u, v] of [[[0, 0, -1], 0, 0.5], [[1, 0, 0], 0.25, 0.5], [[0, 0, 1], 0.5, 0.5], [[-1, 0, 0], 0.75, 0.5], [[0, 1, 0], null, 0], [[0, -1, 0], null, 1]]) { const p = P.toPicture(d); if (u !== null) assert.ok(near(p.u, u) || near(p.u, u + 1)); assert.ok(near(p.v, v)); }
// A lens keeps straight lines straight: points along any great circle land on one line in the frame.
{ const v = { yaw: 25, pitch: -10, fov: 70 }, ratio = 1.6, a = P.look(v, -0.8, -0.6, ratio), b = P.look(v, 0.7, 0.9, ratio), pts = []; for (let k = 0; k <= 10; k++) { const d = a.map((x, i) => x + (b[i] - x) * k / 10), n = Math.hypot(...d); pts.push(P.inFrame(v, d.map(x => x / n), ratio)); } const X = p => p.x * ratio; for (const p of pts) { const cross = (X(pts[10]) - X(pts[0])) * (p.y - pts[0].y) - (pts[10].y - pts[0].y) * (X(p) - X(pts[0])); assert.ok(Math.abs(cross) < 1e-9, 'a straight line bent'); } }
// The lens in millimetres: a view 53.13 degrees across its shorter side is a 24 mm lens, whichever way up the frame is. Narrower views are longer lenses.
assert.ok(near(P.lens(53.130102, 16 / 9), 24, 1e-4)); { const tall = 2 * Math.atan(Math.tan(53.130102 * RAD / 2) * 16 / 9) / RAD; assert.ok(near(P.lens(tall, 9 / 16), 24, 1e-4)); } assert.ok(P.lens(20, 1.5) > P.lens(60, 1.5)); assert.ok(near(P.lens(90, 1), 12));
// Sizes: the longer side as asked, the right shape, even numbers.
for (const a of P.ASPECTS) for (const long of [1280, 1920, 3840]) { const s = P.sizeFor(a.id, long); assert.equal(Math.max(s.w, s.h), long); assert.ok(s.w % 2 === 0 && s.h % 2 === 0); assert.ok(Math.abs(s.w / s.h - a.w / a.h) < 0.004, `${a.id} at ${long}: ${s.w}x${s.h}`); }
assert.deepEqual(P.sizeFor('16:9', 3840), { w: 3840, h: 2160 }); assert.deepEqual(P.sizeFor('9:16', 1920), { w: 1080, h: 1920 }); assert.deepEqual(P.sizeFor('1:1', 1280), { w: 1280, h: 1280 }); assert.deepEqual(P.sizeFor('nonsense', 1920), { w: 1920, h: 1080 });
// Keeping a view sensible.
assert.deepEqual(P.tidy({ yaw: 190, pitch: 99, fov: 500 }), { yaw: -170, pitch: 85, fov: 110 }); assert.deepEqual(P.tidy({ yaw: -540, pitch: -99, fov: 1 }), { yaw: -180, pitch: -85, fov: 12 }); assert.deepEqual(P.tidy(P.HOME), P.HOME);

// ---- Drawing a frame ----
// A dot painted in one direction of a 360 picture appears in the middle of a frame aimed at it, and to the right of the middle by the right amount when the camera turns left.
{ const target = P.look({ yaw: 63, pitch: 12, fov: 50 }, 0, 0, 1), pano = picture(2048, 1024, (u, v) => { const d = P.fromPicture(u, v), dot = d[0] * target[0] + d[1] * target[1] + d[2] * target[2]; return dot > Math.cos(1.2 * RAD) ? [255, 255, 255] : [0, 0, 0]; });
  const find = img => { let sx = 0, sy = 0, n = 0; for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) { const w = img.data[(j * img.width + i) * 4]; sx += i * w; sy += j * w; n += w; } return n ? { x: sx / n + 0.5, y: sy / n + 0.5 } : null; };
  const a = find(P.render(pano, { yaw: 63, pitch: 12, fov: 50 }, blank(400, 300))); assert.ok(Math.abs(a.x - 200) < 0.6 && Math.abs(a.y - 150) < 0.6, `the dot is at ${a.x}, ${a.y}`);
  const b = find(P.render(pano, { yaw: 53, pitch: 12, fov: 50 }, blank(400, 300))), want = P.inFrame({ yaw: 53, pitch: 12, fov: 50 }, target, 4 / 3); assert.ok(b.x > 200 && Math.abs(b.x - (want.x + 1) / 2 * 400) < 1 && Math.abs(b.y - (1 - want.y) / 2 * 300) < 1, 'turning the camera left did not move the dot right by the right amount');
  assert.equal(find(P.render(pano, { yaw: -117, pitch: -12, fov: 50 }, blank(200, 150))), null, 'the dot shows when the camera faces away from it'); }
// Turning the camera is the same as sliding the 360 picture: a frame at yaw 45 of a picture equals a frame at yaw 0 of the picture slid an eighth of the way round.
{ const paint = (u, v) => [128 + 120 * Math.sin(u * 2 * Math.PI * 5), 128 + 120 * Math.cos(v * Math.PI * 7), 128 + 100 * Math.sin((u * 3 + v * 2) * 2 * Math.PI)], a = picture(1024, 512, paint), b = picture(1024, 512, (u, v) => paint((u + 0.125) % 1, v)); const fa = P.render(a, { yaw: 45, pitch: 8, fov: 65 }, blank(160, 90)), fb = P.render(b, { yaw: 0, pitch: 8, fov: 65 }, blank(160, 90)); let worst = 0; for (let i = 0; i < fa.data.length; i++) worst = Math.max(worst, Math.abs(fa.data[i] - fb.data[i])); assert.ok(worst <= 1, `turning and sliding differ by ${worst}`); }
// No seam: the picture's left and right edges meet due north, and a frame looking north shows no join.
{ const pano = picture(512, 256, (u, v) => { const k = 128 + 120 * Math.cos(u * 2 * Math.PI * 3); return [k, k, k]; }), f = P.render(pano, { yaw: 0, pitch: 0, fov: 40 }, blank(300, 100)); let worst = 0; for (let i = 1; i < 300; i++) worst = Math.max(worst, Math.abs(px(f, i, 50)[0] - px(f, i - 1, 50)[0])); assert.ok(worst < 6, `a jump of ${worst} at the seam`); }
// Looking almost straight up or down draws without holes or nonsense.
for (const pitch of [85, -85]) { const pano = picture(256, 128, (u, v) => [255 * v, 80, 200]), f = P.render(pano, { yaw: 10, pitch, fov: 100 }, blank(64, 64)); for (let i = 0; i < f.data.length; i += 4) { assert.ok(Number.isFinite(f.data[i]) && f.data[i + 3] === 255); assert.equal(f.data[i + 1], 80); } }
// A big frame drawn a slice at a time is the same as one drawn whole.
{ const pano = picture(512, 256, (u, v) => [u * 255, v * 255, (u * 7 % 1) * 255]), whole = P.render(pano, { yaw: 70, pitch: -5, fov: 48 }, blank(96, 54)), parts = blank(96, 54); for (let r = 0; r < 54; r += 7) P.render(pano, { yaw: 70, pitch: -5, fov: 48 }, parts, [r, Math.min(54, r + 7)]); assert.deepEqual([...parts.data], [...whole.data]); }

// ---- A shot in words, and its file ----
assert.deepEqual(P.describe({ yaw: -90, pitch: -4.4, fov: 53.130102 }, '16:9'), { heading: '270°', compass: 'west', tilt: '4° down', lens: '24 mm', shape: '16:9' }); assert.equal(P.describe({ yaw: 0, pitch: 0.2, fov: 30 }, '1:1').tilt, 'level'); assert.equal(P.describe({ yaw: 359.6, pitch: 0, fov: 30 }, '1:1').heading, '0°');
assert.equal(P.line(3, { yaw: 44, pitch: 12, fov: 53.130102 }, '9:16'), 'Shot 3: facing north-east (44°), 12° up, 43 mm lens, 9:16'); assert.equal(P.fileName(7, '2.39:1', { w: 3840, h: 1606 }), 'shot-07-2.39x1-3840x1606.png'); assert.ok(!/[\/\\:*?"<>|]/.test(P.fileName(1, '16:9', { w: 2, h: 2 })));

// ---- The sample picture ----
// The same every time; no seam where its edges meet; one colour along the very top and the very bottom, as a 360 picture must have.
{ const W = 512, H = 256, a = P.paintSample(blank(W, H)), b = P.paintSample(blank(W, H)); assert.deepEqual([...a.data], [...b.data]); for (let j = 0; j < H; j++) { const l = px(a, 0, j), r = px(a, W - 1, j); assert.ok(Math.max(...l.map((v, k) => Math.abs(v - r[k]))) < 40, `a join at row ${j}`); }
  for (const j of [0, H - 1]) for (let i = 1; i < W; i++) assert.ok(Math.max(...px(a, i, j).map((v, k) => Math.abs(v - px(a, 0, j)[k]))) < 30, 'the pole is not one colour');
  const part = P.paintSample(blank(W, H), [40, 90]); for (let k = 40 * W * 4; k < 90 * W * 4; k++) assert.equal(part.data[k], a.data[k]); }
// What is where: the slab due north, the arch due east, the big ball due south, the blocks due west, the moon in the north-east, the ground below, sky above.
const lit = c => Math.max(...c), green = c => c[1] > c[0] * 1.6 && c[1] > c[2] * 1.3 && c[1] > 40, dirOf = (az, el) => [Math.sin(az * RAD) * Math.cos(el * RAD), Math.sin(el * RAD), -Math.cos(az * RAD) * Math.cos(el * RAD)];
assert.ok(lit(P.colourOf(dirOf(0, 6))) > 60 && !green(P.colourOf(dirOf(0, 6))), 'no slab to the north'); assert.ok(green(P.colourOf(dirOf(90, 13))), 'no arch lintel to the east'); assert.ok(!green(P.colourOf(dirOf(90, 3))), 'the arch has no opening'); assert.ok(lit(P.colourOf(dirOf(180, -2))) > 60, 'no ball to the south'); assert.ok(lit(P.colourOf(dirOf(270, 0))) > 40, 'no blocks to the west'); assert.ok(lit(P.colourOf(dirOf(52, 31))) > 220, 'no moon'); assert.ok(green(P.colourOf(dirOf(318, 9.3))), 'no ball in the air');
assert.ok(lit(P.colourOf(dirOf(40, 70))) < 40, 'the sky overhead is not dark'); assert.ok(lit(P.colourOf(dirOf(225, -60))) < 70, 'the ground at your feet is not dark');
// The ring painted on the ground is 5.5 m away all the way round: looking down at the right angle finds it green in every direction that nothing stands in front of.
{ let found = 0; for (let az = 0; az < 360; az += 5) if (green(P.colourOf(dirOf(az, -Math.atan(1.6 / 5.5) / RAD)))) found++; assert.ok(found >= 66, `the ring shows in ${found} of 72 directions`); }
// Shadows fall away from the moon: the ground just beyond the slab, on the far side from the moon, is darker than the ground beside it.
{ const ground = (x, z) => { const d = [x, -1.6, z], n = Math.hypot(...d); return lit(P.colourOf(d.map(v => v / n))); }, away = [-Math.sin(52 * RAD), Math.cos(52 * RAD)]; assert.ok(ground(0 + away[0] * 2, -10 + away[1] * 2) < ground(3.5, -10) * 0.8, 'the slab throws no shadow'); }
// Every colour is a real colour.
for (let n = 0; n < 4000; n++) { const u = (n * 0.61803398875) % 1, v = (n * 0.7548776662) % 1, c = P.colourOf(P.fromPicture(u, v)); assert.ok(c.length === 3 && c.every(x => Number.isFinite(x) && x >= 0 && x <= 255), `a bad colour at ${u}, ${v}`); }
console.log('ok  framing: compass points, edges, 500 round trips, straight lines stay straight, lens in millimetres, 18 export sizes; drawing: a dot lands in the middle and moves as it should, turning equals sliding, no seam, poles, slices; the sample picture: the same every time, no join, eight things where they should be, the ring all the way round, shadows away from the moon');
