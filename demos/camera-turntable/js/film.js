// Elusion One: the camera's parts and the film's camera moves, as plain data and arithmetic.
// Nothing here draws or touches the page, so the film can be checked frame by frame in Node.
// Units are centimetres. The camera body sits at the origin: x across it (the grip is at negative x, on the left as you
// face the lens), y up, z out through the lens.

export const BODY = { w: 13.4, h: 8.4, d: 4.2 }; // the body's outer box
export const LENS = { x: 0.9, y: -0.4, r: 3.3, front: 9.0 }; // the lens axis, its widest radius, and how far its front stands out
// Everything solid, as boxes [min, max], with a little room: the film's camera must never be inside any of these.
export const SOLID = [
  [[-BODY.w / 2 - 0.4, -BODY.h / 2 - 0.4, -BODY.d / 2 - 0.9], [BODY.w / 2 + 0.4, BODY.h / 2 + 2.4, BODY.d / 2 + 0.6]], // body, viewfinder hump and eyecup
  [[-7.2, -4.4, 0], [-3.2, 4.9, 3.9]], // grip and shutter button
  [[LENS.x - LENS.r - 0.2, LENS.y - LENS.r - 0.2, BODY.d / 2], [LENS.x + LENS.r + 0.2, LENS.y + LENS.r + 0.2, LENS.front + 0.3]], // lens
];

// The parts you can ask about. at: where the label points. view: where the camera goes to look (degrees round, degrees up, distance).
export const PARTS = [
  { id: 'sensor', name: 'Sensor', inside: true, at: [0.9, -0.4, -0.15], view: [-38, 14, 21], says: 'A full-frame sensor, 36 by 24 mm. Everything else in the body exists to put light on this rectangle and read it off again.' },
  { id: 'shutter', name: 'Shutter', inside: true, at: [0.9, 1.5, 0.75], view: [-46, 20, 22], says: 'Two sets of blades just in front of the sensor. They cross the frame in about three thousandths of a second.' },
  { id: 'stabiliser', name: 'Stabiliser', inside: true, at: [3.0, -1.9, -0.55], view: [-34, 8, 22], says: 'The sensor floats in a frame moved by magnets, which cancels the shake of your hands.' },
  { id: 'board', name: 'Main board', inside: true, at: [3.9, 1.6, -1.25], view: [-58, 26, 24], says: 'The processor, memory and the chips that turn the sensor’s readings into a picture file.' },
  { id: 'battery', name: 'Battery', inside: true, at: [-5.0, -1.4, 1.2], view: [-64, 10, 24], says: 'It sits inside the grip, which is why the grip is the shape it is.' },
  { id: 'cards', name: 'Card slot', inside: true, at: [5.6, -0.6, -0.9], view: [-30, 12, 23], says: 'Two cards side by side, so every picture can be written twice.' },
  { id: 'finder', name: 'Viewfinder', inside: true, at: [0, 4.4, -0.9], view: [-52, 34, 22], says: 'A small screen and a magnifying lens. What you see through the eyepiece is the picture the sensor is about to take.' },
  { id: 'glass', name: 'Lens elements', inside: true, at: [0.9, -0.4, 5.6], view: [-62, 12, 25], says: 'Seven pieces of glass in five groups. The iris between them sets how much light gets through.' },
  { id: 'dial', name: 'Mode dial', inside: false, at: [3.4, 5.0, 0.1], view: [-18, 48, 20], says: 'Knurled so that it can be turned with a cold thumb.' },
  { id: 'release', name: 'Shutter button', inside: false, at: [-5.1, 4.75, 1.9], view: [24, 42, 20], says: 'On top of the grip, under your first finger.' },
  { id: 'screen', name: 'Rear screen', inside: false, at: [-0.4, -0.7, -2.4], view: [168, 8, 24], says: 'The same live picture as the viewfinder, for when the camera is away from your eye.' },
];

const rad = d => d * Math.PI / 180, lerp = (a, b, k) => a + (b - a) * k, ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2); // slow in, slow out
// Where a camera is, given what it looks at and how it stands off from it. round 0 is straight in front of the lens; positive goes round to the right-hand side of the picture.
export function place(pose) { const [tx, ty, tz] = pose.target, a = rad(pose.round), e = rad(pose.up), c = Math.cos(e) * pose.dist; return [tx + Math.sin(a) * c, ty + Math.sin(e) * pose.dist, tz + Math.cos(a) * c]; }

// The film: seven shots, cut one to the next. Each shot moves from one pose to another. open: how far the body is cut open (0 shut, 1 open).
const shot = (name, secs, from, to, open = [0, 0]) => ({ name, secs, from, to, open });
const P = (round, up, dist, target, fov = 32) => ({ round, up, dist, target, fov });
export const SHOTS = [
  shot('The reveal', 5.5, P(-42, 6, 52, [0.4, 0.6, 1.5], 30), P(-24, 11, 37, [0.4, 0.6, 1.5], 30)),
  shot('Across the top plate', 5.0, P(14, 58, 19, [-4.4, 4.2, 0.4], 28), P(-10, 52, 19, [4.2, 4.2, 0.2], 28)),
  shot('Into the glass', 5.0, P(9, 4, 34, [0.9, -0.4, 6.5], 34), P(-3, 1, 15.5, [0.9, -0.4, 8.6], 34)),
  shot('Round the grip', 5.0, P(-58, 5, 30, [-1.5, 0.2, 1.0], 32), P(-112, 9, 28, [-1.5, 0.2, 0.2], 32)),
  shot('The back', 4.5, P(202, 10, 30, [0, 0.4, -1.5], 32), P(164, 7, 26, [0, 0.4, -1.5], 32)),
  shot('Inside', 7.0, P(-28, 12, 34, [0.9, 0, 0.5], 32), P(-52, 19, 25, [0.9, -0.2, 0.2], 32), [0, 1]),
  shot('Elusion One', 4.5, P(-40, 13, 30, [0.6, 0.3, 1.0], 30), P(-27, 9, 44, [0.4, 0.6, 1.5], 30), [1, 0]),
];
export const LENGTH = SHOTS.reduce((s, x) => s + x.secs, 0);
export const STARTS = SHOTS.map((_, i) => SHOTS.slice(0, i).reduce((s, x) => s + x.secs, 0));

// The camera at time t of the film: position, what it looks at, field of view, which shot, and how open the body is.
export function frame(t) {
  const time = Number.isFinite(t) ? Math.min(Math.max(t, 0), LENGTH) : 0; let i = SHOTS.length - 1; while (i > 0 && time < STARTS[i]) i--;
  const s = SHOTS[i], k = ease(Math.min(1, (time - STARTS[i]) / s.secs)), a = s.from, b = s.to;
  const pose = { round: lerp(a.round, b.round, k), up: lerp(a.up, b.up, k), dist: lerp(a.dist, b.dist, k), target: a.target.map((v, n) => lerp(v, b.target[n], k)), fov: lerp(a.fov, b.fov, k) };
  // The body opens in the middle of its shot, not across the whole of it, so the eye has time to settle first and to look afterwards.
  const span = Math.min(1, Math.max(0, ((time - STARTS[i]) / s.secs - 0.18) / 0.5));
  return { shot: i, name: s.name, pose, position: place(pose), target: pose.target, fov: pose.fov, open: lerp(s.open[0], s.open[1], ease(span)), done: time >= LENGTH };
}
// Is a point inside something solid?
export const inside = ([x, y, z]) => SOLID.some(([lo, hi]) => x > lo[0] && x < hi[0] && y > lo[1] && y < hi[1] && z > lo[2] && z < hi[2]);

// Turning the camera by hand: a pose that is nudged, and kept within sensible limits.
export const LIMITS = { up: [-8, 72], dist: [15, 70] };
export function orbit(pose, { round = 0, up = 0, zoom = 1 } = {}) { const next = { ...pose, round: pose.round + round, up: Math.min(LIMITS.up[1], Math.max(LIMITS.up[0], pose.up + up)), dist: Math.min(LIMITS.dist[1], Math.max(LIMITS.dist[0], pose.dist * zoom)) };
  next.round = ((next.round + 180) % 360 + 360) % 360 - 180; return next; }
// Ease one pose towards another by the share k, going the short way round.
export function towards(pose, goal, k) { let turn = ((goal.round - pose.round + 180) % 360 + 360) % 360 - 180; return { round: pose.round + turn * k, up: lerp(pose.up, goal.up, k), dist: lerp(pose.dist, goal.dist, k), target: pose.target.map((v, n) => lerp(v, goal.target[n], k)), fov: lerp(pose.fov, goal.fov, k) }; }
export const HOME = P(-27, 9, 44, [0.4, 0.6, 1.5], 30); // the three-quarter view the turntable starts from, and the film ends on
export const viewOf = part => P(part.view[0], part.view[1], part.view[2] * 1.3, part.at.map(v => v * 0.6), 30); // look a little towards the middle of the camera, so the part is seen in its place
