// Shot Framer: the arithmetic of looking at a 360 picture through a lens, and the sample picture itself.
// Nothing here touches the page, so every figure and every pixel can be checked in Node.
//
// A 360 picture is "equirectangular": its width is the whole way round (360 degrees) and its height is from straight up to straight down (180 degrees).
// The middle of the picture is straight ahead (yaw 0), as 360 cameras and stitching programs make them; its left and right edges meet behind you.
// A view is { yaw, pitch, fov }: which way the camera points (yaw to the right from north, pitch up from level), and how tall its view is, all in degrees.
// A frame is that view through an ordinary lens: straight lines stay straight.

const RAD = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const ASPECTS = [{ id: '16:9', w: 16, h: 9, name: 'Wide' }, { id: '2.39:1', w: 2.39, h: 1, name: 'Cinema' }, { id: '4:3', w: 4, h: 3, name: 'Classic' }, { id: '1:1', w: 1, h: 1, name: 'Square' }, { id: '4:5', w: 4, h: 5, name: 'Portrait' }, { id: '9:16', w: 9, h: 16, name: 'Tall' }];
export const aspectOf = id => ASPECTS.find(a => a.id === id) || ASPECTS[0];
export const LIMITS = { fov: [12, 110], pitch: [-85, 85] };
export const HOME = { yaw: 0, pitch: 4, fov: 46 }; // a 24 mm lens in a 16:9 frame
// Keep a view sensible: yaw between -180 and 180, pitch short of straight up or down, the lens within its range.
export function tidy(view) { const yaw = ((view.yaw + 180) % 360 + 360) % 360 - 180; return { yaw, pitch: clamp(view.pitch, ...LIMITS.pitch), fov: clamp(view.fov, ...LIMITS.fov) }; }

// The direction a point of the frame looks in. x and y run from -1 to 1 across the frame (x right, y up); ratio is the frame's width over its height.
// North is -z, east is +x, up is +y.
export function basis(view) { const y = view.yaw * RAD, p = view.pitch * RAD, cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y); return { f: [sy * cp, sp, -cy * cp], r: [cy, 0, sy], u: [-sy * sp, cp, cy * sp], t: Math.tan(view.fov * RAD / 2) }; }
export function look(view, x, y, ratio) { const b = basis(view), a = x * b.t * ratio, c = y * b.t, d = [b.f[0] + b.r[0] * a + b.u[0] * c, b.f[1] + b.r[1] * a + b.u[1] * c, b.f[2] + b.r[2] * a + b.u[2] * c], n = Math.hypot(...d); return [d[0] / n, d[1] / n, d[2] / n]; }
// Where a direction falls in the 360 picture, as fractions across and down. And back again.
export const toPicture = d => ({ u: (Math.atan2(d[0], -d[2]) / (2 * Math.PI) + 1.5) % 1, v: Math.acos(clamp(d[1], -1, 1)) / Math.PI });
export const fromPicture = (u, v) => { const lon = (u - 0.5) * 2 * Math.PI, lat = v * Math.PI, s = Math.sin(lat); return [Math.sin(lon) * s, Math.cos(lat), -Math.cos(lon) * s]; };
// Where a direction falls in the frame, or null if it is behind the camera. The inverse of look().
export function inFrame(view, d, ratio) { const b = basis(view), z = d[0] * b.f[0] + d[1] * b.f[1] + d[2] * b.f[2]; if (z <= 1e-9) return null; return { x: (d[0] * b.r[0] + d[1] * b.r[1] + d[2] * b.r[2]) / z / (b.t * ratio), y: (d[0] * b.u[0] + d[1] * b.u[1] + d[2] * b.u[2]) / z / b.t }; }
// How wide the view is, given how tall it is and the frame's shape.
export const fovAcross = (fov, ratio) => 2 * Math.atan(Math.tan(fov * RAD / 2) * ratio) / RAD;
// The lens that gives this view on a full-frame camera, in millimetres. The frame is fitted inside the camera's 36 by 24 mm sensor, as a crop of what that lens sees:
// a wide shape uses the sensor's full width, a squarer one its full height, and for a tall shape the camera is turned on its side.
export const sensorHeight = ratio => (ratio >= 1.5 ? 36 / ratio : ratio >= 1 ? 24 : ratio > 2 / 3 ? 24 / ratio : 36);
export const lens = (fov, ratio) => sensorHeight(ratio) / 2 / Math.tan(fov * RAD / 2);
// And back: how tall the view is through a lens of so many millimetres. Changing the shape keeps the lens, as turning or cropping a camera does.
export const fovFor = (mm, ratio) => 2 * Math.atan(sensorHeight(ratio) / 2 / mm) / RAD;
// The lenses a shape can have, widest first, in millimetres: the view's limits in degrees are the same for every shape, so the lenses are not.
export const lensRange = id => { const a = aspectOf(id), r = a.w / a.h; return [lens(LIMITS.fov[1], r), lens(LIMITS.fov[0], r)]; };
// Changing the shape from one to another: the view keeps its lens if the new shape can have it. If it cannot (the widest 16:9 lens is wider than any 9:16 can be), the view takes the nearest lens the new shape has,
// and kept is false, so that the page can say so. mm is the lens before, got the lens after.
export function reshape(view, fromId, toId) { const a = aspectOf(fromId), b = aspectOf(toId), mm = lens(view.fov, a.w / a.h), v = tidy({ ...view, fov: fovFor(mm, b.w / b.h) }), got = lens(v.fov, b.w / b.h);
  return { view: v, mm, got, kept: Math.abs(got - mm) < 1e-6 * mm }; }
// Dragging: the view, near this one, that puts the direction d at the place (x, y) of the frame. What you take hold of stays under your finger, at any lens and any tilt.
export function dragTo(view, d, x, y, ratio) { let v = tidy(view); const miss = w => { const p = inFrame(w, d, ratio); return p ? [p.x - x, p.y - y] : null; };
  for (let i = 0; i < 8; i++) { const e = miss(v); if (!e || Math.hypot(e[0], e[1]) < 1e-5) break; const h = 0.05, a = miss({ ...v, yaw: v.yaw + h }), b = miss({ ...v, pitch: v.pitch + h }); if (!a || !b) break;
    const j11 = (a[0] - e[0]) / h, j21 = (a[1] - e[1]) / h, j12 = (b[0] - e[0]) / h, j22 = (b[1] - e[1]) / h, det = j11 * j22 - j12 * j21; if (Math.abs(det) < 1e-12) break; // how the place moves for a degree of turn and a degree of tilt
    const dy = clamp(-(e[0] * j22 - e[1] * j12) / det, -30, 30), dp = clamp(-(e[1] * j11 - e[0] * j21) / det, -30, 30); v = { ...v, yaw: v.yaw + dy, pitch: clamp(v.pitch + dp, ...LIMITS.pitch) }; }
  return tidy(v); }
// The size of an exported picture: the longer side as asked, the other from the shape, both even numbers.
export function sizeFor(id, long) { const a = aspectOf(id), r = a.w / a.h, even = n => Math.max(2, Math.round(n / 2) * 2); return r >= 1 ? { w: even(long), h: even(long / r) } : { w: even(long * r), h: even(long) }; }

// Smaller copies of a 360 picture, each half the size of the last, made when first needed and kept with the picture. level 0 is the picture itself.
// A wide lens on a large picture puts several of its pixels into each pixel of the frame; taking one of them at random makes fine detail shimmer. Reading from a copy of the right size does not.
export function mip(src, level) { if (level <= 0) return src; src.mips = src.mips || []; if (src.mips[level]) return src.mips[level]; const from = mip(src, level - 1), w = Math.max(1, from.width >> 1), h = Math.max(1, from.height >> 1), d = new Uint8ClampedArray(w * h * 4), f = from.data, fw = from.width, fh = from.height;
  for (let j = 0; j < h; j++) { const ya = Math.min(fh - 1, j * 2), yb = Math.min(fh - 1, j * 2 + 1); for (let i = 0; i < w; i++) { const xa = Math.min(fw - 1, i * 2), xb = Math.min(fw - 1, i * 2 + 1), p = (ya * fw + xa) * 4, q = (ya * fw + xb) * 4, r = (yb * fw + xa) * 4, t = (yb * fw + xb) * 4, k = (j * w + i) * 4; for (let c = 0; c < 4; c++) d[k + c] = (f[p + c] + f[q + c] + f[r + c] + f[t + c] + 2) >> 2; } }
  return (src.mips[level] = { data: d, width: w, height: h }); }
// Which copy to read from: how many pixels of the picture go into one pixel of a frame this tall, at the middle of the frame.
export const levelFor = (src, view, outHeight) => { const per = 2 * Math.tan(view.fov * RAD / 2) / outHeight * src.height / Math.PI; let level = 0; while (per / 2 ** level > 1.5 && src.width >> (level + 1) >= 64) level++; return level; };

// Draw a frame: for each pixel of the output, find the direction it looks in and take that colour from the 360 picture, blending the four nearest pixels.
// src and out are { data, width, height } with four bytes a pixel. rows: draw only these rows [from, to), so that a big picture can be drawn a slice at a time.
export function render(pic, view, out, rows = [0, out.height]) { const src = mip(pic, levelFor(pic, view, out.height)), b = basis(view), W = out.width, H = out.height, ratio = W / H, sw = src.width, sh = src.height, s = src.data, o = out.data, tx = b.t * ratio, ty = b.t, TAU = 2 * Math.PI;
  for (let j = rows[0]; j < rows[1]; j++) { const c = (1 - (j + 0.5) / H * 2) * ty, bx = b.f[0] + b.u[0] * c, by = b.f[1] + b.u[1] * c, bz = b.f[2] + b.u[2] * c; let k = j * W * 4;
    for (let i = 0; i < W; i++, k += 4) { const a = ((i + 0.5) / W * 2 - 1) * tx, dx = bx + b.r[0] * a, dy = by, dz = bz + b.r[2] * a, n = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const u = Math.atan2(dx, -dz) / TAU + 0.5, fx = u * sw - 0.5, fy = Math.acos(dy / n) / Math.PI * sh - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const xa = ((x0 % sw) + sw) % sw, xb = (xa + 1) % sw, ya = y0 < 0 ? 0 : y0 >= sh ? sh - 1 : y0, yb = y0 + 1 < 0 ? 0 : y0 + 1 >= sh ? sh - 1 : y0 + 1, p = (ya * sw + xa) * 4, q = (ya * sw + xb) * 4, r = (yb * sw + xa) * 4, t = (yb * sw + xb) * 4, w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      o[k] = s[p] * w00 + s[q] * w10 + s[r] * w01 + s[t] * w11; o[k + 1] = s[p + 1] * w00 + s[q + 1] * w10 + s[r + 1] * w01 + s[t + 1] * w11; o[k + 2] = s[p + 2] * w00 + s[q + 2] * w10 + s[r + 2] * w01 + s[t + 2] * w11; o[k + 3] = 255; } }
  return out; }

// A shot, in words a director could read out.
const compass = yaw => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((yaw % 360) + 360) % 360) / 45) % 8];
const AHEAD = ['ahead', 'ahead and right', 'right', 'behind and right', 'behind', 'behind and left', 'left', 'ahead and left'];
// own: the picture is the user's, so nobody knows which way north is. Its middle is called ahead.
export function describe(view, id, own = false) { const v = tidy(view), a = aspectOf(id), head = Math.round(((v.yaw % 360) + 360) % 360) % 360, tilt = Math.round(v.pitch); return { heading: `${head}°`, compass: own ? AHEAD[Math.round(head / 45) % 8] : compass(v.yaw), tilt: tilt === 0 ? 'level' : `${Math.abs(tilt)}° ${tilt > 0 ? 'up' : 'down'}`, lens: `${Math.round(lens(v.fov, a.w / a.h))} mm`, shape: a.id }; }
export const line = (n, view, id, own = false) => { const d = describe(view, id, own); return `Shot ${n}: facing ${d.compass} (${d.heading}), ${d.tilt}, ${d.lens} lens, ${d.shape}`; };
export const fileName = (n, id, size, word = 'shot') => `${word}-${String(n).padStart(2, '0')}-${id.replace(':', 'x')}-${size.w}x${size.h}.png`; // a saved shot is shot-03-…; the frame as it stands, exported without saving, is frame-01-…, so the two can never share a name

// ---- The sample 360 picture: a sculpture park at night, drawn by working out what each direction sees. No picture file is loaded. ----
// You stand 1.6 m above a flat ground marked in metre squares, with a green ring painted round you. Round the horizon: a tall slab to the north,
// an arch to the east, three balls to the south and a flight of blocks to the west. A moon in the north-east lights it.
const EYE = 1.6, MOON = (() => { const az = 52 * RAD, el = 31 * RAD; return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]; })();
const at = (azDeg, dist) => [Math.sin(azDeg * RAD) * dist, -Math.cos(azDeg * RAD) * dist]; // a place on the ground, so many metres off in a direction
const box = (azDeg, dist, w, h, d, base, col, turn = 0) => { const [x, z] = at(azDeg, dist); return { kind: 'box', c: [x, base + h / 2 - EYE, z], half: [w / 2, h / 2, d / 2], rot: (azDeg + turn) * RAD, col }; };
const ball = (azDeg, dist, r, base, col) => { const [x, z] = at(azDeg, dist); return { kind: 'ball', c: [x, base + r - EYE, z], r, col }; };
const WHITE = [232, 234, 230], GREEN = [63, 224, 138], GREY = [150, 158, 163];
export const THINGS = [
  box(0, 10, 1.5, 5.2, 0.55, 0, WHITE), // the slab, due north
  box(90, 9, 0.7, 3.4, 0.7, 0, GREEN, 0), box(90, 9, 0.7, 3.4, 0.7, 0, GREEN, 0), box(90, 9, 3.6, 0.7, 0.7, 3.4, GREEN), // the arch, due east: two posts and a lintel (the posts are moved apart just below)
  ball(180, 8.5, 1.25, 0, WHITE), ball(166, 8.2, 0.75, 0, GREY), ball(193, 7.2, 0.45, 0, GREEN), // three balls, to the south
  box(270, 10, 4.2, 0.8, 2.4, 0, GREY), box(270, 10.3, 3.0, 0.8, 1.8, 0.8, WHITE), box(270, 10.6, 1.8, 0.8, 1.2, 1.6, WHITE), box(270, 10.9, 0.7, 0.8, 0.7, 2.4, GREEN), // a flight of blocks, to the west
  ball(318, 12, 0.6, 3.1, GREEN), // a green ball in the air, north-west
];
{ const side = 1.45, [x, z] = at(90, 9); THINGS[1].c = [x, THINGS[1].c[1], z - side]; THINGS[2].c = [x, THINGS[2].c[1], z + side]; }
// To save work: each thing sits inside a cone of directions (seen from where you stand) and throws its shadow inside a circle on the ground. Outside those, it need not be asked.
for (const th of THINGS) { const R = th.kind === 'ball' ? th.r : Math.hypot(...th.half), dist = Math.hypot(...th.c), top = th.c[1] + EYE + R; th.dir = th.c.map(v => v / dist); th.cos = Math.cos(Math.min(Math.PI / 2, Math.asin(Math.min(1, R / dist)) + 0.01)); th.reach = R + top / Math.tan(31 * RAD) + 0.5; }
// Where a ray from o along d first meets a thing: the distance and the way the surface faces there, or null.
function meet(th, o, d) { if (th.kind === 'ball') { const x = o[0] - th.c[0], y = o[1] - th.c[1], z = o[2] - th.c[2], b = x * d[0] + y * d[1] + z * d[2], c = x * x + y * y + z * z - th.r * th.r, disc = b * b - c; if (disc < 0) return null; const t = -b - Math.sqrt(disc); if (t < 1e-4) return null; return { t, n: [(x + d[0] * t) / th.r, (y + d[1] * t) / th.r, (z + d[2] * t) / th.r] }; }
  const cs = Math.cos(th.rot), sn = Math.sin(th.rot), ox = o[0] - th.c[0], oy = o[1] - th.c[1], oz = o[2] - th.c[2], lo = [ox * cs + oz * sn, oy, -ox * sn + oz * cs], ld = [d[0] * cs + d[2] * sn, d[1], -d[0] * sn + d[2] * cs]; let t0 = -Infinity, t1 = Infinity, axis = 0, sign = 1;
  for (let i = 0; i < 3; i++) { if (Math.abs(ld[i]) < 1e-12) { if (Math.abs(lo[i]) > th.half[i]) return null; continue; } const a = (-th.half[i] - lo[i]) / ld[i], b = (th.half[i] - lo[i]) / ld[i], near = Math.min(a, b), far = Math.max(a, b); if (near > t0) { t0 = near; axis = i; sign = ld[i] > 0 ? -1 : 1; } if (far < t1) t1 = far; if (t0 > t1) return null; }
  if (t0 < 1e-4) return null; const ln = [0, 0, 0]; ln[axis] = sign; return { t: t0, n: [ln[0] * cs - ln[2] * sn, ln[1], ln[0] * sn + ln[2] * cs] }; }
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], smooth = (a, b, v) => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
// The colour seen in a direction.
export function colourOf(d) { const o = [0, 0, 0]; let hit = null, col = null; for (const th of THINGS) { if (d[0] * th.dir[0] + d[1] * th.dir[1] + d[2] * th.dir[2] < th.cos) continue; const m = meet(th, o, d); if (m && (!hit || m.t < hit.t)) { hit = m; col = th.col; } }
  const groundT = d[1] < -1e-6 ? -EYE / d[1] : Infinity;
  if (hit && hit.t < groundT) { const lit = hit.n[0] * MOON[0] + hit.n[1] * MOON[1] + hit.n[2] * MOON[2], tone = lit > 0.45 ? 1 : lit > 0.02 ? 0.74 : 0.5, fog = smooth(6, 40, hit.t); return mix([col[0] * tone, col[1] * tone, col[2] * tone], [24, 30, 34], fog * 0.55); } // three flat tones, as in a comic
  if (groundT < Infinity) { const x = d[0] * groundT, z = d[2] * groundT, r = Math.hypot(x, z), fog = smooth(5, 60, r); let base = [26, 30, 33];
    const gx = Math.abs(x - Math.round(x)), gz = Math.abs(z - Math.round(z)), wide = 0.012 + r * 0.004, lineK = Math.max(1 - smooth(0, wide, gx), 1 - smooth(0, wide, gz)) * (1 - smooth(4, 13, r)); base = mix(base, [58, 66, 71], lineK * 0.8); if (r < 0.9) base = r < 0.84 ? [36, 42, 46] : [70, 79, 84]; /* you stand on a round plinth with a pale rim: straight down is one colour, as it must be, and has a clean edge */
    const ring = 1 - smooth(0.05, 0.11, Math.abs(r - 5.5)); base = mix(base, GREEN, ring * 0.9);
    let shade = 1; const p = [x, -EYE + 1e-3, z]; for (const th of THINGS) { if (Math.hypot(x - th.c[0], z - th.c[2]) > th.reach) continue; if (meet(th, p, MOON)) { shade = 0.45; break; } } // is the moon hidden from here?
    return mix([base[0] * shade, base[1] * shade, base[2] * shade], [20, 26, 30], fog * 0.9); }
  // Sky: darker overhead, a green afterglow low down, hills on the horizon, stars, the moon and its halo.
  const el = Math.asin(clamp(d[1], -1, 1)) / RAD, az = Math.atan2(d[0], -d[2]), ridge = 2.2 + 1.5 * Math.sin(az * 3 + 0.6) + 0.9 * Math.sin(az * 7 + 2.1) + 0.5 * Math.sin(az * 13 + 4.2), far = 4.1 + 1.2 * Math.sin(az * 2 + 2.6) + 0.7 * Math.sin(az * 5 + 0.4);
  if (el < ridge) return [17, 22, 25]; if (el < far) return [24, 32, 36];
  let sky = mix([38, 74, 66], [13, 16, 20], smooth(0, 38, el)); sky = mix(sky, [9, 11, 14], smooth(38, 90, el));
  const mdot = d[0] * MOON[0] + d[1] * MOON[1] + d[2] * MOON[2], ang = Math.acos(clamp(mdot, -1, 1)) / RAD; sky = mix(sky, [70, 96, 92], (1 - smooth(1.5, 16, ang)) * 0.55); if (ang < 1.55) return mix([238, 240, 232], sky, smooth(1.4, 1.55, ang));
  if (el > 8) { const cv = Math.floor(el * 3.6), cellEl = (cv + 0.5) / 3.6, across = Math.max(6, Math.round(700 * Math.cos(cellEl * RAD))), cu = Math.floor((az / (2 * Math.PI) + 0.5) * across), h = hash(cu, cv); /* fewer cells round the sky the higher up, so that stars are as thick overhead as low down and do not crowd into a whorl */ if (h > 0.992) { const cellAz = ((cu + 0.5) / across - 0.5) * 2 * Math.PI, dd = Math.hypot((az - cellAz) * Math.cos(el * RAD) / RAD, el - cellEl); const b = (1 - smooth(0.02, 0.13, dd)) * (0.45 + hash(cv, cu) * 0.55) * (1 - smooth(74, 84, el)); /* and no stars right overhead, for the same reason */ sky = mix(sky, [235, 238, 240], b); } }
  return sky; }
// Draw the whole sample picture, or some of its rows, into { data, width, height }.
// Each pixel is first given the colour at its middle. Then any pixel that differs from a neighbour, which is to say any pixel on an edge, is worked out again as the average of nine places inside it, so that edges are smooth and not stepped.
export function paintSample(out, rows = [0, out.height]) { const W = out.width, H = out.height, o = out.data, from = Math.max(0, rows[0] - 1), to = Math.min(H, rows[1] + 1), n = to - from, mid = new Float32Array(n * W * 3);
  for (let j = from; j < to; j++) { const v = (j + 0.5) / H; for (let i = 0; i < W; i++) { const c = colourOf(fromPicture((i + 0.5) / W, v)), k = ((j - from) * W + i) * 3; mid[k] = c[0]; mid[k + 1] = c[1]; mid[k + 2] = c[2]; } }
  const far = (a, b) => Math.abs(mid[a] - mid[b]) + Math.abs(mid[a + 1] - mid[b + 1]) + Math.abs(mid[a + 2] - mid[b + 2]) > 14;
  for (let j = rows[0]; j < rows[1]; j++) { const r = j - from; for (let i = 0; i < W; i++) { const k = (r * W + i) * 3, l = (r * W + (i + W - 1) % W) * 3, e = (r * W + (i + 1) % W) * 3, up = r > 0 ? k - W * 3 : k, dn = r < n - 1 ? k + W * 3 : k; let c = [mid[k], mid[k + 1], mid[k + 2]];
      if (far(k, l) || far(k, e) || far(k, up) || far(k, dn)) { c = [0, 0, 0]; for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) { const q = colourOf(fromPicture((i + (sx + 0.5) / 3) / W, (j + (sy + 0.5) / 3) / H)); c[0] += q[0] / 9; c[1] += q[1] / 9; c[2] += q[2] / 9; } }
      const p = (j * W + i) * 4; o[p] = c[0]; o[p + 1] = c[1]; o[p + 2] = c[2]; o[p + 3] = 255; } }
  return out; }
