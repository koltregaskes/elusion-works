// Shared scene maths: elevation mapping, noise, the canyon height field.
// Scene units are metres. y = 0 is the dam foundation (elevation 505.6 ft).
// The river flows toward +z. Nevada is on -x, Arizona on +x (looking downstream).

import { ELEV, FT } from '../model/data.js';

export const elevToY = (ft) => (ft - ELEV.foundation) * FT;
export const yToElev = (y) => y / FT + ELEV.foundation;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// --- value noise -------------------------------------------------------------
function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
export function fbm(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
export function ridged(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(noise2(x * f, y * f))); f *= 2.1; a *= 0.5; }
  return s;
}

// --- dam geometry constants ------------------------------------------------------
export const DAM = {
  R: 152,                  // upstream face radius at crest (≈ 500 ft)
  crestY: elevToY(ELEV.crest),
  crestT: 13.7,            // 45 ft
  baseT: 201,              // 660 ft
};
DAM.cz = DAM.R;            // arch centre sits downstream on the river axis

// Dam section at height y: upstream face offset (z, toward -z is upstream) and thickness.
export function damSection(y) {
  const s = clamp((DAM.crestY - y) / DAM.crestY, 0, 1);
  const t = DAM.crestT + (DAM.baseT - DAM.crestT) * Math.pow(s, 1.55);
  const up = -9 * s * s;   // slight upstream batter low down
  return { t, up };
}

// --- canyon shape ------------------------------------------------------------
export const EXTENT = { x0: -1150, x1: 1150, z0: -1700, z1: 1150 };

export function canyonCentre(z) {
  if (z < -320) return 150 * Math.sin((z + 320) / 520) * smooth(-320, -700, z);
  if (z > 520) return -40 * Math.sin((z - 520) / 300);
  return 0;
}
export function wallSlope(z) {
  let k = 2.8;
  k = lerp(k, 0.75, smooth(-260, -760, z));
  k = lerp(k, 1.05, smooth(380, 470, z));
  return k;
}
export function floorHalfWidth(z) {
  let w = 54;
  w = lerp(w, 82, smooth(110, 150, z) * (1 - smooth(360, 420, z)));
  w = lerp(w, 360, smooth(-260, -780, z));
  w = lerp(w, 58, smooth(420, 480, z));
  return w;
}
export function floorY(z) {
  if (z < -40) return lerp(28, 6, smooth(-200, -1200, z));
  return 30;
}

// Rectangular carves (x0,x1,z0,z1, target y or function, blend metres)
const CARVES = [];
function addCarve(x0, x1, z0, z1, target, blend) { CARVES.push({ x0, x1, z0, z1, target, blend }); }
// Spillway approach aprons and channels on both rims.
export const SPILL = { z0: -232, z1: -92, lip: 146, chanW: 34 };
for (const s of [-1, 1]) {
  const a = s < 0 ? [-SPILL.lip, -104] : [104, SPILL.lip];
  addCarve(Math.min(...a), Math.max(...a), SPILL.z0, SPILL.z1, elevToY(ELEV.spillCrest) - 1.2, 10);
  const c = s < 0 ? [-(SPILL.lip + 4 + SPILL.chanW), -(SPILL.lip + 2)] : [SPILL.lip + 2, SPILL.lip + 4 + SPILL.chanW];
  addCarve(Math.min(...c), Math.max(...c), SPILL.z0 - 6, SPILL.z1 + 30, (x, z) => lerp(198, 182, smooth(SPILL.z0, SPILL.z1 + 30, z)), 6);
}

function boxWeight(c, x, z) {
  const dx = Math.max(c.x0 - x, 0, x - c.x1);
  const dz = Math.max(c.z0 - z, 0, z - c.z1);
  const d = Math.hypot(dx, dz);
  return 1 - smooth(0, c.blend, d);
}

export function terrainHeight(x, z) {
  const cx = canyonCentre(z);
  const dx = Math.abs(x - cx);
  const w = floorHalfWidth(z) + fbm(x * 0.01, z * 0.01, 3) * 6;
  const fy = floorY(z) + fbm(x * 0.02, z * 0.02, 3) * 2.5;
  const k = wallSlope(z);
  const far = smooth(320, 950, dx);
  // a broken mesa near the rim, rising to the Black Mountains further out
  let plateau = 256 + ridged(x * 0.013 + 3, z * 0.013, 3) * 18 + fbm(x * 0.05, z * 0.05, 3) * 5 + fbm(x * 0.006, z * 0.006, 3) * 16
    + far * (60 + Math.max(0, fbm(x * 0.0022 + 7, z * 0.0022 - 3, 5)) * 150 + ridged(x * 0.004, z * 0.004, 4) * 70);
  if (z > 420) plateau += 18 * smooth(420, 520, z);
  let y;
  if (dx <= w) y = fy;
  else {
    const t = dx - w;
    const raw = fy + t * k;
    // ledges and buttresses in the volcanic breccia
    const ledge = -0.28 * (((raw % 13) + 13) % 13);
    const rough = Math.min(1, t / 14);
    const wall = raw + (ledge + fbm(x * 0.05, z * 0.05, 4) * 9 + ridged(x * 0.02 + 5, z * 0.035, 3) * 10) * rough;
    // smooth min of wall and plateau
    const r = 30;
    const h = clamp(0.5 + 0.5 * (plateau - wall) / r, 0, 1);
    y = lerp(plateau, wall, h) - r * h * (1 - h);
  }
  for (const c of CARVES) {
    const wgt = boxWeight(c, x, z);
    if (wgt <= 0) continue;
    const tgt = typeof c.target === 'function' ? c.target(x, z) : c.target;
    if (y > tgt) y = lerp(y, tgt, wgt);
  }
  return y;
}

// Canyon half-width at height y near the dam (walls are straight there).
export function damHalfWidthAt(y) {
  return 54 + Math.max(0, y - 30) / 2.8;
}
