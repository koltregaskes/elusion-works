// Shot Framer: the arithmetic of looking at a 360 picture through a lens, and the sample picture itself.
// Nothing here touches the page, so every figure and every pixel can be checked in Node.
//
// A 360 picture is "equirectangular": its width is the whole way round (360 degrees) and its height is from straight up to straight down (180 degrees).
// A view is { yaw, pitch, fov }: which way the camera points (yaw to the right from north, pitch up from level), and how tall its view is, all in degrees.
// A frame is that view through an ordinary lens: straight lines stay straight.

const RAD = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const ASPECTS = [{ id: '16:9', w: 16, h: 9, name: 'Wide' }, { id: '2.39:1', w: 2.39, h: 1, name: 'Cinema' }, { id: '4:3', w: 4, h: 3, name: 'Classic' }, { id: '1:1', w: 1, h: 1, name: 'Square' }, { id: '4:5', w: 4, h: 5, name: 'Portrait' }, { id: '9:16', w: 9, h: 16, name: 'Tall' }];
export const aspectOf = id => ASPECTS.find(a => a.id === id) || ASPECTS[0];
export const LIMITS = { fov: [12, 110], pitch: [-85, 85] };
export const HOME = { yaw: 0, pitch: 4, fov: 55 };
// Keep a view sensible: yaw between -180 and 180, pitch short of straight up or down, the lens within its range.
export function tidy(view) { const yaw = ((view.yaw + 180) % 360 + 360) % 360 - 180; return { yaw, pitch: clamp(view.pitch, ...LIMITS.pitch), fov: clamp(view.fov, ...LIMITS.fov) }; }

// The direction a point of the frame looks in. x and y run from -1 to 1 across the frame (x right, y up); ratio is the frame's width over its height.
// North is -z, east is +x, up is +y.
export function basis(view) { const y = view.yaw * RAD, p = view.pitch * RAD, cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y); return { f: [sy * cp, sp, -cy * cp], r: [cy, 0, sy], u: [-sy * sp, cp, cy * sp], t: Math.tan(view.fov * RAD / 2) }; }
export function look(view, x, y, ratio) { const b = basis(view), a = x * b.t * ratio, c = y * b.t, d = [b.f[0] + b.r[0] * a + b.u[0] * c, b.f[1] + b.r[1] * a + b.u[1] * c, b.f[2] + b.r[2] * a + b.u[2] * c], n = Math.hypot(...d); return [d[0] / n, d[1] / n, d[2] / n]; }
// Where a direction falls in the 360 picture, as fractions across and down. And back again.
export const toPicture = d => ({ u: (Math.atan2(d[0], -d[2]) / (2 * Math.PI) + 1) % 1, v: Math.acos(clamp(d[1], -1, 1)) / Math.PI });
export const fromPicture = (u, v) => { const lon = u * 2 * Math.PI, lat = v * Math.PI, s = Math.sin(lat); return [Math.sin(lon) * s, Math.cos(lat), -Math.cos(lon) * s]; };
// Where a direction falls in the frame, or null if it is behind the camera. The inverse of look().
export function inFrame(view, d, ratio) { const b = basis(view), z = d[0] * b.f[0] + d[1] * b.f[1] + d[2] * b.f[2]; if (z <= 1e-9) return null; return { x: (d[0] * b.r[0] + d[1] * b.r[1] + d[2] * b.r[2]) / z / (b.t * ratio), y: (d[0] * b.u[0] + d[1] * b.u[1] + d[2] * b.u[2]) / z / b.t }; }
// How wide the view is, given how tall it is and the frame's shape.
export const fovAcross = (fov, ratio) => 2 * Math.atan(Math.tan(fov * RAD / 2) * ratio) / RAD;
// The lens that gives this view on a full-frame camera, in millimetres: the frame's shorter side is taken as the sensor's 24 mm.
export function lens(fov, ratio) { const short = ratio >= 1 ? fov : fovAcross(fov, ratio); return 12 / Math.tan(short * RAD / 2); }
// The size of an exported picture: the longer side as asked, the other from the shape, both even numbers.
export function sizeFor(id, long) { const a = aspectOf(id), r = a.w / a.h, even = n => Math.max(2, Math.round(n / 2) * 2); return r >= 1 ? { w: even(long), h: even(long / r) } : { w: even(long * r), h: even(long) }; }

// Draw a frame: for each pixel of the output, find the direction it looks in and take that colour from the 360 picture, blending the four nearest pixels.
// src and out are { data, width, height } with four bytes a pixel. rows: draw only these rows [from, to), so that a big picture can be drawn a slice at a time.
export function render(src, view, out, rows = [0, out.height]) { const b = basis(view), W = out.width, H = out.height, ratio = W / H, sw = src.width, sh = src.height, s = src.data, o = out.data, tx = b.t * ratio, ty = b.t, TAU = 2 * Math.PI;
  for (let j = rows[0]; j < rows[1]; j++) { const c = (1 - (j + 0.5) / H * 2) * ty, bx = b.f[0] + b.u[0] * c, by = b.f[1] + b.u[1] * c, bz = b.f[2] + b.u[2] * c; let k = j * W * 4;
    for (let i = 0; i < W; i++, k += 4) { const a = ((i + 0.5) / W * 2 - 1) * tx, dx = bx + b.r[0] * a, dy = by, dz = bz + b.r[2] * a, n = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let u = Math.atan2(dx, -dz) / TAU; if (u < 0) u += 1; const fx = u * sw - 0.5, fy = Math.acos(dy / n) / Math.PI * sh - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const xa = ((x0 % sw) + sw) % sw, xb = (xa + 1) % sw, ya = y0 < 0 ? 0 : y0 >= sh ? sh - 1 : y0, yb = y0 + 1 < 0 ? 0 : y0 + 1 >= sh ? sh - 1 : y0 + 1, p = (ya * sw + xa) * 4, q = (ya * sw + xb) * 4, r = (yb * sw + xa) * 4, t = (yb * sw + xb) * 4, w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      o[k] = s[p] * w00 + s[q] * w10 + s[r] * w01 + s[t] * w11; o[k + 1] = s[p + 1] * w00 + s[q + 1] * w10 + s[r + 1] * w01 + s[t + 1] * w11; o[k + 2] = s[p + 2] * w00 + s[q + 2] * w10 + s[r + 2] * w01 + s[t + 2] * w11; o[k + 3] = 255; } }
  return out; }

// A shot, in words a director could read out.
const compass = yaw => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((yaw % 360) + 360) % 360) / 45) % 8];
export function describe(view, id) { const v = tidy(view), a = aspectOf(id), head = Math.round(((v.yaw % 360) + 360) % 360) % 360, tilt = Math.round(v.pitch); return { heading: `${head}°`, compass: compass(v.yaw), tilt: tilt === 0 ? 'level' : `${Math.abs(tilt)}° ${tilt > 0 ? 'up' : 'down'}`, lens: `${Math.round(lens(v.fov, a.w / a.h))} mm`, shape: a.id }; }
export const line = (n, view, id) => { const d = describe(view, id); return `Shot ${n}: facing ${d.compass} (${d.heading}), ${d.tilt}, ${d.lens} lens, ${d.shape}`; };
export const fileName = (n, id, size) => `shot-${String(n).padStart(2, '0')}-${id.replace(':', 'x')}-${size.w}x${size.h}.png`;

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
    const gx = Math.abs(x - Math.round(x)), gz = Math.abs(z - Math.round(z)), wide = 0.012 + r * 0.004, lineK = Math.max(1 - smooth(0, wide, gx), 1 - smooth(0, wide, gz)) * (1 - smooth(4, 13, r)) * smooth(0.35, 0.9, r); base = mix(base, [58, 66, 71], lineK * 0.8); /* no lines right under your feet: straight down must be one colour */
    const ring = 1 - smooth(0.05, 0.11, Math.abs(r - 5.5)); base = mix(base, GREEN, ring * 0.9);
    let shade = 1; const p = [x, -EYE + 1e-3, z]; for (const th of THINGS) { if (Math.hypot(x - th.c[0], z - th.c[2]) > th.reach) continue; if (meet(th, p, MOON)) { shade = 0.45; break; } } // is the moon hidden from here?
    return mix([base[0] * shade, base[1] * shade, base[2] * shade], [20, 26, 30], fog * 0.9); }
  // Sky: darker overhead, a green afterglow low down, hills on the horizon, stars, the moon and its halo.
  const el = Math.asin(clamp(d[1], -1, 1)) / RAD, az = Math.atan2(d[0], -d[2]), ridge = 2.2 + 1.5 * Math.sin(az * 3 + 0.6) + 0.9 * Math.sin(az * 7 + 2.1) + 0.5 * Math.sin(az * 13 + 4.2), far = 4.1 + 1.2 * Math.sin(az * 2 + 2.6) + 0.7 * Math.sin(az * 5 + 0.4);
  if (el < ridge) return [17, 22, 25]; if (el < far) return [24, 32, 36];
  let sky = mix([38, 74, 66], [13, 16, 20], smooth(0, 38, el)); sky = mix(sky, [9, 11, 14], smooth(38, 90, el));
  const mdot = d[0] * MOON[0] + d[1] * MOON[1] + d[2] * MOON[2], ang = Math.acos(clamp(mdot, -1, 1)) / RAD; sky = mix(sky, [70, 96, 92], (1 - smooth(1.5, 16, ang)) * 0.55); if (ang < 1.55) return mix([238, 240, 232], sky, smooth(1.4, 1.55, ang));
  if (el > 8) { const cu = Math.floor((az / (2 * Math.PI) + 0.5) * 700), cv = Math.floor(el * 3.6), h = hash(cu, cv); if (h > 0.992) { const cellAz = ((cu + 0.5) / 700 - 0.5) * 2 * Math.PI, cellEl = (cv + 0.5) / 3.6, dd = Math.hypot((az - cellAz) * Math.cos(el * RAD) / RAD, el - cellEl); const b = (1 - smooth(0.02, 0.13, dd)) * (0.45 + hash(cv, cu) * 0.55) * (1 - smooth(74, 84, el)); /* and no stars right overhead, for the same reason */ sky = mix(sky, [235, 238, 240], b); } }
  return sky; }
// Draw the whole sample picture, or some of its rows, into { data, width, height }.
export function paintSample(out, rows = [0, out.height]) { const W = out.width, H = out.height, o = out.data; for (let j = rows[0]; j < rows[1]; j++) { const v = (j + 0.5) / H; for (let i = 0; i < W; i++) { const c = colourOf(fromPicture((i + 0.5) / W, v)), k = (j * W + i) * 4; o[k] = c[0]; o[k + 1] = c[1]; o[k + 2] = c[2]; o[k + 3] = 255; } } return out; }
