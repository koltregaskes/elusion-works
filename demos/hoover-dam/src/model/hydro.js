// Simplified reservoir and powerplant model for Hoover Dam.
// Everything is computed in US customary units (ft, ft³/s, acre-ft) and converted
// to SI only where physics needs it (power in watts, pressure in pascals).
//
// Teaching model. The area table is shaped to match published capacity figures at
// a few levels (dead pool ≈ 2 MAF, 2022 low ≈ 27 %, full ≈ 26 MAF), not survey data.

import { ELEV, FT, CFS_TO_CMS } from './data.js';

const RHO = 1000;      // kg/m³
const G = 9.81;        // m/s²
const AF_PER_CFS_DAY = 1.98347;

// Lake surface area (thousand acres) by elevation (ft).
const AREA = [
  [700, 0.5], [800, 6], [895, 20], [950, 28], [1000, 40], [1040, 55], [1100, 85],
  [1150, 110], [1200, 132], [1229, 158], [1240, 162],
];
const DEAD_STORAGE_MAF = 2.0;

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

// Precompute storage (MAF) on a 1 ft grid from 700 to 1240 by trapezoid integration,
// pinned to DEAD_STORAGE_MAF at dead pool.
const S_MIN = 700, S_MAX = 1240;
const storageGrid = new Float64Array(S_MAX - S_MIN + 1);
(function build() {
  let s = 0;
  storageGrid[0] = 0;
  for (let e = S_MIN + 1; e <= S_MAX; e++) {
    s += (interp(AREA, e - 1) + interp(AREA, e)) / 2 / 1000; // kacre·ft -> MAF
    storageGrid[e - S_MIN] = s;
  }
  const off = DEAD_STORAGE_MAF - storageGrid[ELEV.deadPool - S_MIN];
  for (let i = 0; i < storageGrid.length; i++) storageGrid[i] = Math.max(0, storageGrid[i] + off);
})();

export function storageAt(elev) {
  const e = Math.min(S_MAX, Math.max(S_MIN, elev));
  const i = Math.floor(e - S_MIN), f = e - S_MIN - i;
  const a = storageGrid[i], b = storageGrid[Math.min(storageGrid.length - 1, i + 1)];
  return a + (b - a) * f;
}

export function elevAt(maf) {
  let lo = S_MIN, hi = S_MAX;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (storageAt(mid) < maf) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export const areaAt = (elev) => interp(AREA, elev) * 1000; // acres
export const FULL_STORAGE = storageAt(ELEV.fullPool);

// Units: A1..A9 on the Arizona wing, N1..N8 on the Nevada wing.
export const UNIT_IDS = [
  'N8', 'N7', 'N6', 'N5', 'N4', 'N3', 'N2', 'N1',
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9',
];
export const UNIT_MW = 122.4;        // 2,080 MW nameplate ÷ 17 units
const Q_RATED = 2900;                // ft³/s per unit at full gate and rated head
const H_RATED = 520;                 // ft
const LOSS_AT_RATED = 12;            // ft of friction loss at rated flow
const SPILL_C = 3.7;                 // weir coefficient, ft^0.5/s
const SPILL_L = 400;                 // ft of drum gate per side (4 × 100)
const EVAP_AF_YR = 600000;           // at full-pool area

export function efficiency(gate) {
  if (gate <= 0.02) return 0;
  // Francis turbine hill-chart slice: peaks ~93 % near 80-85 % gate.
  const e = 0.935 - 0.62 * Math.pow(gate - 0.84, 2) - 0.18 * Math.max(0, 0.35 - gate);
  return Math.max(0.55, Math.min(0.94, e));
}

export function createState() {
  return {
    lake: 1065,
    inflow: 11000,
    drum: 1,           // 0 lowered .. 1 fully raised
    mode: 'manual',    // 'manual' | 'auto'
    demand: 1200,      // MW, used in auto mode
    units: UNIT_IDS.map((id, i) => ({ id, on: i % 2 === 0, gate: 0.7, angle: 0 })),
    hour: 11,
    day: 196,          // day of year (mid July)
    speed: 1,          // sim hours per real second
    paused: false,
    out: {},
  };
}

function unitHydraulics(gate, gross) {
  // Solve Q and net head together (loss depends on Q).
  let q = 0, hnet = gross;
  for (let k = 0; k < 4; k++) {
    q = gate * Q_RATED * Math.sqrt(Math.max(0, hnet) / H_RATED);
    hnet = gross - LOSS_AT_RATED * Math.pow(q / Q_RATED, 2);
  }
  const eta = efficiency(gate);
  let mw = eta * RHO * G * (q * CFS_TO_CMS) * (hnet * FT) / 1e6;
  if (mw > UNIT_MW) {
    // Governor holds the generator at its rating: reduce effective flow.
    const scale = UNIT_MW / mw;
    q *= scale; mw = UNIT_MW;
  }
  return { q, hnet, eta, mw };
}

export function spillFlow(lake, drum) {
  const top = ELEV.spillCrest + 16 * drum;
  const h = Math.max(0, lake - top);
  return { perSide: SPILL_C * SPILL_L * Math.pow(h, 1.5), top, h };
}

// Pressure (psi) at a given elevation for the current lake.
export function psiAt(lake, elev) {
  const h = Math.max(0, lake - elev) * FT;
  return RHO * G * h / 6894.76;
}

// Canyon chord width (ft) at elevation, used for thrust estimates.
export function canyonWidth(elev) {
  return 300 + Math.max(0, elev - ELEV.foundation) * 1.0;
}

export function thrustMN(lake) {
  let f = 0;
  const step = 2;
  for (let e = ELEV.foundation; e < lake; e += step) {
    const p = RHO * G * (lake - e - step / 2) * FT;
    f += p * canyonWidth(e) * FT * step * FT;
  }
  return f / 1e6;
}

function autoDispatch(state, gross) {
  // Pick the fewest units that can carry demand at good efficiency, then share load.
  const capAtFull = unitHydraulics(1, gross).mw;
  const target = Math.max(0, state.demand);
  if (capAtFull <= 0) return;
  let n = Math.ceil(target / (capAtFull * 0.88));
  n = Math.max(target > 0 ? 1 : 0, Math.min(state.units.length, n));
  const per = n ? Math.min(capAtFull, target / n) : 0;
  let lo = 0, hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (unitHydraulics(mid, gross).mw < per) lo = mid; else hi = mid;
  }
  // Spread running units across both wings, alternating from the centre out.
  const order = [7, 8, 6, 9, 5, 10, 4, 11, 3, 12, 2, 13, 1, 14, 0, 15, 16];
  state.units.forEach((u) => { u.on = false; });
  for (let i = 0; i < n; i++) { const u = state.units[order[i]]; u.on = true; u.gate = hi; }
}

export function step(state, dtReal) {
  const hours = state.paused ? 0 : dtReal * state.speed;
  const out = state.out;

  const spill = spillFlow(state.lake, state.drum);
  const spillQ = spill.perSide * 2;
  const overtopH = Math.max(0, state.lake - ELEV.crest);
  const overQ = 3.0 * 1244 * Math.pow(overtopH, 1.5);

  // Tailwater rises slightly with total release.
  const prevQ = out.totalQ || 0;
  const tail = ELEV.tailwater - 2 + 5 * Math.min(1.5, prevQ / 60000);
  const gross = state.lake - tail;
  const canRun = state.lake >= ELEV.minPower;

  if (state.mode === 'auto' && canRun) autoDispatch(state, gross);

  let turbQ = 0, mw = 0, running = 0, etaSum = 0, hnetSum = 0;
  for (const u of state.units) {
    if (u.on && canRun && u.gate > 0.02) {
      const r = unitHydraulics(u.gate, gross);
      u.q = r.q; u.mw = r.mw; u.eta = r.eta; u.hnet = r.hnet;
      turbQ += r.q; mw += r.mw; running++; etaSum += r.eta; hnetSum += r.hnet;
    } else {
      u.q = 0; u.mw = 0; u.eta = 0; u.hnet = 0;
    }
    // Rotor animation: 180 rpm synchronous when generating, spin down otherwise.
    u.rpm = u.rpm || 0;
    const target = u.mw > 0 ? 180 : 0;
    u.rpm += (target - u.rpm) * Math.min(1, dtReal * 0.8);
  }

  const totalQ = turbQ + spillQ + overQ;
  const evapAfDay = EVAP_AF_YR / 365 * (areaAt(state.lake) / 158000);
  const netAfPerDay = (state.inflow - totalQ) * AF_PER_CFS_DAY - evapAfDay;

  if (hours > 0) {
    const s = storageAt(state.lake) + netAfPerDay * (hours / 24) / 1e6;
    state.lake = Math.max(ELEV.deadPool - 30, Math.min(ELEV.crest + 6, elevAt(Math.max(0.01, s))));
    state.hour += hours;
    while (state.hour >= 24) { state.hour -= 24; state.day = (state.day + 1) % 365; }
  }

  const area = areaAt(state.lake);
  const ftPerDay = area > 0 ? netAfPerDay / area : 0;

  const warn = [];
  if (state.lake >= ELEV.crest) warn.push({ tone: 'danger', text: 'OVERTOPPING: water is flowing over the crest. Real dams are designed so this never happens.' });
  else if (state.lake > ELEV.crest - 2) warn.push({ tone: 'danger', text: 'Lake within 2 ft of the crest. Lower the drum gates now.' });
  else if (spillQ > 1) warn.push({ tone: 'water', text: `Spillways running: ${Math.round(spillQ).toLocaleString()} ft³/s into the tunnels.` });
  if (!canRun && state.lake >= ELEV.deadPool) warn.push({ tone: 'warn', text: 'Below minimum power pool: turbines tripped to avoid cavitation and air being drawn in.' });
  if (state.lake < ELEV.deadPool) warn.push({ tone: 'danger', text: 'DEAD POOL: the lake is below the lowest outlet. Nothing leaves the dam.' });
  const capFull = canRun ? unitHydraulics(1, gross).mw : 0;
  if (canRun && capFull < UNIT_MW * 0.85) warn.push({ tone: 'muted', text: `Low head: at full gate each unit can make only about ${Math.round(capFull)} of its ${Math.round(UNIT_MW)} MW.` });

  Object.assign(out, {
    tail, gross, spill, spillQ, overQ, turbQ, totalQ, mw, running,
    eta: running ? etaSum / running : 0,
    hnet: running ? hnetSum / running : 0,
    storage: storageAt(state.lake),
    pct: storageAt(state.lake) / FULL_STORAGE,
    area, ftPerDay, evapAfDay, netAfPerDay,
    basePsi: psiAt(state.lake, ELEV.foundation),
    thrust: thrustMN(state.lake),
    homes: mw * 1e3 / 1.2,   // average US household ≈ 1.2 kW continuous
    canRun, warn, capFull,
  });
  return out;
}

// One unit at a given gate and lake level, for the turbine lab.
export function unitPerformance(gate, lake) {
  const gross = lake - ELEV.tailwater;
  if (lake < ELEV.minPower) return { q: 0, hnet: gross, eta: 0, mw: 0, gross, tripped: true };
  return { ...unitHydraulics(gate, gross), gross, tripped: false };
}
