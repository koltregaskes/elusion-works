// Flight model for the replay. Pure maths, no rendering: everything on screen
// is a function of one clock value t (seconds after liftoff), so scrubbing,
// replaying and every camera always agree.
//
// Anchored to three whole-second times quoted from the as-flown timeline of
// Starship Flight 5 (13 Oct 2024). Each is defined here as one exact model event:
//   transonic  T+6:08  speed first drops below Mach 1
//   burn       T+6:30  ignition: the first landing-burn engine lights
//   catch      T+6:54  tower contact (arms closed, booster stopped at catch
//                      height) and engine shutdown (every engine fully off)
// Sources differ by 2 to 3 s on the last two, so these are illustrative anchors,
// not precise history. Altitude, speed, path, lean and arm timing are a
// modelled fit, not telemetry.

export const T_START = 366; // T+6:06
export const T_END = 420; // T+7:00
export const REF = { transonic: 368, burn: 390, catch: 414 };
export const THREE_ENGINES_AT = 395.4; // modelled
export const G = 9.81;

// Site frame: metres, Y up, +X east (sea), +Z south. Tower centre at origin.
export const SITE = {
  towerHeight: 146,
  armY: 88, // top of the arm rails
  pinY: 61, // catch pins, measured up the booster from its base
  hingeX: 8.5,
  hingeZ: 5.85,
  armLength: 36,
  armOpenDeg: 34,
  catchX: 29,
  catchZ: 0,
  boosterHeight: 70.5,
  boosterRadius: 4.5,
};
export const BASE_CATCH_Y = SITE.armY - SITE.pinY; // 27 m

export const EVENTS = [
  { id: 'transonic', t: REF.transonic, label: 'Transonic', short: 'Mach 1', cited: true,
    text: 'Slowing through the speed of sound, engines first. Four grid fins steer.' },
  { id: 'burn', t: REF.burn, label: 'Landing burn', short: 'Burn', cited: true,
    text: 'Landing burn. Thirteen centre engines light about a kilometre up.' },
  { id: 'three', t: THREE_ENGINES_AT, label: 'Three engines', short: '3 eng', cited: false,
    text: 'Down to three engines. The booster slides sideways toward the tower.' },
  { id: 'arms', t: 408.8, label: 'Arms close', short: 'Arms', cited: false,
    text: 'The tower arms swing shut around the booster.' },
  { id: 'catch', t: REF.catch, label: 'Catch', short: 'Catch', cited: true,
    text: 'Caught. The booster hangs from two pins resting on the tower arms.' },
];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;

// Monotone cubic interpolation through knots (Fritsch-Carlson): smooth, no overshoot.
function monotone(knots) {
  const n = knots.length, xs = knots.map(k => k[0]), ys = knots.map(k => k[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], u = (x - xs[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i]
      + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

// Descent rate (m/s, positive down).
function vDown(t) {
  const B = REF.burn, C = REF.catch, E3 = THREE_ENGINES_AT - 0.4; // 395.0
  if (t <= B) return 313 - 1.6 * (t - T_START); // drag-limited fall
  if (t <= E3) { // thirteen engines: hard braking (cubic Hermite)
    const h = E3 - B, u = (t - B) / h, u2 = u * u, u3 = u2 * u;
    const v0 = 313 - 1.6 * (B - T_START), v1 = 58, m0 = -1.6, m1 = -7.0;
    return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * m1;
  }
  if (t <= C - 1.5) { const u = (t - E3) / (C - 1.5 - E3); return 2.2 + 55.8 * Math.pow(1 - u, 2.2); }
  if (t <= C) return 2.2 * (1 - smooth(C - 1.5, C, t));
  return 0;
}

// Horizontal distance from the catch point along the approach line (+X), and sideways drift.
const along = monotone([[366, 560], [378, 432], [390, 300], [396, 214], [402, 112], [406, 52], [409, 20], [411.5, 5], [413.4, 0], [421, 0]]);
const across = monotone([[366, 64], [380, 46], [390, 33], [399, 13], [406, 2.5], [410, 0], [421, 0]]);

// ISA speed of sound (troposphere).
export const speedOfSound = alt => Math.sqrt(1.4 * 287.05 * (288.15 - 0.0065 * clamp(alt, 0, 11000)));

// Engine layout: 3 inner, 10 middle (these 13 relight for landing), 20 outer.
export const ENGINES = (() => {
  const list = [];
  for (let i = 0; i < 3; i++) list.push({ ring: 0, r: 1.05, a: (i / 3) * Math.PI * 2 + 0.5 });
  for (let i = 0; i < 10; i++) list.push({ ring: 1, r: 2.55, a: (i / 10) * Math.PI * 2 });
  for (let i = 0; i < 20; i++) list.push({ ring: 2, r: 3.95, a: ((i + 0.5) / 20) * Math.PI * 2 });
  return list;
})();

export function engineLevel(i, t) {
  const e = ENGINES[i];
  if (e.ring === 2) return 0;
  const j = ((i * 7) % 10) * 0.03; // small deterministic stagger
  // The centre three shut down as the booster settles on the arms: all fully off by REF.catch (j is at most 0.27).
  if (e.ring === 0) return smooth(REF.burn + j, REF.burn + 0.45 + j, t) * (1 - smooth(REF.catch - 0.9 + j, REF.catch - 0.3 + j, t));
  return smooth(REF.burn + 0.2 + j, REF.burn + 0.8 + j, t) * (1 - smooth(THREE_ENGINES_AT - 0.5 + j, THREE_ENGINES_AT + 0.1 + j, t));
}

// ---- Precomputed table --------------------------------------------------
const DT = 1 / 60, PAD = 1.5;
const N = Math.round((T_END - T_START + 2 * PAD) / DT) + 1;
const tOf = i => T_START - PAD + i * DT;
const tab = { x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N), lx: new Float64Array(N), lz: new Float64Array(N) };

// Altitude: integrate the descent rate backwards from the catch.
{
  const iC = Math.round((REF.catch - (T_START - PAD)) / DT);
  tab.y[iC] = BASE_CATCH_Y;
  for (let i = iC + 1; i < N; i++) tab.y[i] = BASE_CATCH_Y;
  for (let i = iC - 1; i >= 0; i--) tab.y[i] = tab.y[i + 1] + 0.5 * (vDown(tOf(i)) + vDown(tOf(i + 1))) * DT;
  for (let i = 0; i < N; i++) { const t = tOf(i); tab.x[i] = SITE.catchX + along(t); tab.z[i] = SITE.catchZ + across(t); }
  // Lean: the engines point along the body, so sideways acceleration needs a tilt.
  const acc = (arr, i) => (arr[Math.min(N - 1, i + 12)] - 2 * arr[i] + arr[Math.max(0, i - 12)]) / Math.pow(12 * DT, 2);
  const rawX = new Float64Array(N), rawZ = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = tOf(i), up = acc(tab.y, i) + G;
    const burnMix = smooth(REF.burn, REF.burn + 1.6, t) * (1 - smooth(REF.catch - 5, REF.catch - 1.6, t));
    const glide = 1 - smooth(REF.burn - 0.5, REF.burn + 1.2, t);
    let lx = 0.62 * burnMix * acc(tab.x, i) / Math.max(up, 4), lz = 0.62 * burnMix * acc(tab.z, i) / Math.max(up, 4);
    lx += glide * (0.075 + 0.012 * Math.sin(t * 0.9)); lz += glide * (0.02 + 0.01 * Math.sin(t * 0.63 + 1));
    const mag = Math.hypot(lx, lz), cap = Math.tan(12 * Math.PI / 180);
    if (mag > cap) { lx *= cap / mag; lz *= cap / mag; }
    rawX[i] = lx; rawZ[i] = lz;
  }
  // Symmetric smoothing so the body turns like something with inertia.
  const W = 30;
  for (let i = 0; i < N; i++) {
    let sx = 0, sz = 0, w = 0;
    for (let k = -W; k <= W; k++) { const j = clamp(i + k, 0, N - 1), g = 1 - Math.abs(k) / (W + 1); sx += rawX[j] * g; sz += rawZ[j] * g; w += g; }
    tab.lx[i] = sx / w; tab.lz[i] = sz / w;
  }
}

function read(arr, t) {
  const f = clamp((t - (T_START - PAD)) / DT, 0, N - 1.0001), i = Math.floor(f), u = f - i;
  return arr[i] + (arr[i + 1] - arr[i]) * u;
}

// Everything the scene needs at time t. Deterministic: same t, same answer.
export function sample(t, out = {}) {
  t = clamp(t, T_START, T_END);
  const after = Math.max(0, t - REF.catch);
  const settle = after > 0 ? Math.exp(-after / 1.3) * Math.cos(after * 5.2) * 0.22 * (1 - Math.exp(-after * 8)) : 0; // arms flex
  const sway = after > 0 ? Math.exp(-after / 3.2) * Math.sin(after * 2.4) * 0.011 : 0; // radians, hanging from the pins
  out.t = t;
  out.x = read(tab.x, t); out.y = read(tab.y, t) - settle; out.z = read(tab.z, t);
  out.leanX = read(tab.lx, t) + sway; out.leanZ = read(tab.lz, t);
  out.settle = settle;
  const h = 0.05;
  const vx = (read(tab.x, t + h) - read(tab.x, t - h)) / (2 * h), vz = (read(tab.z, t + h) - read(tab.z, t - h)) / (2 * h);
  out.vDown = t >= REF.catch ? 0 : vDown(t);
  out.speed = Math.hypot(out.vDown, vx, vz); // m/s
  out.alt = out.y; // booster base above ground, m
  out.mach = out.speed / speedOfSound(out.alt);
  let lit = 0, thrust = 0;
  for (let i = 0; i < 13; i++) { const l = engineLevel(i, t); thrust += l; if (l > 0.5) lit++; }
  out.lit = lit; out.thrust = thrust / 13;
  out.arm = SITE.armOpenDeg * (1 - smooth(408.8, 413.2, t)); // degrees open, each arm
  out.heat = lerp(1, 0.12, smooth(REF.burn + 1, REF.burn + 12, t)); // engine-section glow from the fall
  out.fire = t > REF.catch + 0.3 ? lerp(1, 0.4, smooth(REF.catch + 0.5, T_END, t)) * smooth(REF.catch + 0.3, REF.catch + 0.9, t) : 0;
  const calm = 1 - 0.8 * smooth(REF.burn, REF.catch, t);
  out.fins = [0, 1, 2, 3].map(k => calm * (0.16 * Math.sin(t * 1.7 + k * 1.9) + 0.09 * Math.sin(t * 3.1 + k * 0.7)));
  out.phase = t < REF.transonic ? 'Supersonic fall' : t < REF.burn ? 'Subsonic fall' : t < THREE_ENGINES_AT ? 'Landing burn, 13 engines'
    : t < 408.8 ? 'Landing burn, 3 engines' : t < REF.catch ? 'Final approach' : 'Caught';
  return out;
}

export function fmtClock(t, tenths = true) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `T+${String(m).padStart(2, '0')}:${tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')}`;
}

// Director's cut: camera changes land on a 120 beats-per-minute grid (one beat = 0.5 s).
// The three cited events fall exactly on beats 4, 48 and 96.
export const BPM = 120;
export const CUTS = [
  [366, 'drone'], [368, 'tracker'], [372, 'onboard'], [378, 'drone'], [384, 'tracker'], [388, 'onboard'],
  [390, 'tracker'], [392, 'pad'], [395.5, 'drone'], [399, 'onboard'], [402, 'tower'], [405, 'pad'],
  [408, 'arm'], [410.5, 'onboard'], [412, 'tower'], [413, 'pad'], [415, 'drone'], [417.5, 'shore'],
];
export function directorCam(t) { let cam = CUTS[0][1]; for (const [ct, c] of CUTS) { if (t >= ct) cam = c; else break; } return cam; }
