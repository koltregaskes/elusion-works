// One driver, tau, for the teardown sequences.
// Play, step, scrub and slow motion only move tau. The lake, the gates and the
// rotor angle are whatever hydro.js produces when the same steps are replayed
// from the start, so a scrub lands on the same state as playing to that time.
//
// Elevations come from src/model/data.js, the rounded Bureau of Reclamation
// figures already used by the field lab (spillway crest 1,205.4 ft, drum gates
// 16 ft high, minimum power pool about 950 ft). No new plant figures are
// introduced here. The start-up order and the 24-hour demand shape are teaching
// devices on top of that model, not an operating procedure or a dispatch record.
// Hoover is a peaking plant in the field lab's own scenario notes (data.js).

import { createState, step, spillFlow, efficiency, UNIT_IDS } from '../../src/model/hydro.js';
import { ELEV } from '../../src/model/data.js';

export const DT = 1 / 60;
export const A5_DUR = 68;
export const DAY_DUR = 36;
// Wicket gates follow a command. 1.6 /s is a governor-ish lag, not a field measurement.
const GATE_INERTIA = 1.6;
// Shown spin matches the study model, which draws the runner at 1/12 of shaft speed
// so the blades stay readable. The tachometer still reads real rpm.
const SHOW_SPIN = 1 / 12;

export const PHASES = [
  { id: 'stand', name: 'Standstill', nick: 'still', color: '#b7b2aa' },
  { id: 'roll', name: 'Rolling', nick: 'roll', color: '#3b3f45' },
  { id: 'sync', name: 'On the line', nick: 'sync', color: '#2f9e6a' },
  { id: 'load', name: 'On load', nick: 'load', color: '#ff5a1f' },
  { id: 'spill', name: 'Spill', nick: 'spill', color: '#ff7a45' },
  { id: 'trip', name: 'Tripped', nick: 'trip', color: '#16181b' },
];

const A5 = UNIT_IDS.indexOf('A5');
// Same centre-out order the field lab uses, but A5 leads so the open unit is first.
const CENTER = [7, 8, 6, 9, 5, 10, 4, 11, 3, 12, 2, 13, 1, 14, 0, 15, 16];
const BRING_ON = [A5, ...CENTER.filter((i) => i !== A5)];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

export function demandMW(hour) {
  // Teaching shape: a quiet night, a morning shoulder, an afternoon peak.
  // Not a Bureau of Reclamation schedule.
  const h = ((hour % 24) + 24) % 24;
  const g = (c, w) => Math.exp(-0.5 * ((h - c) / w) ** 2);
  const bump = Math.min(1, g(17, 3.2) + 0.55 * g(8.5, 1.6));
  return 420 + (1600 - 420) * bump;
}

export function hillSamples(n = 49) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const gate = i / n;
    pts.push({ gate, eta: efficiency(gate) });
  }
  return pts;
}

function phaseIndex(unit, lake, top) {
  // Spill and trip are properties of the lake, so their chart boundaries move
  // when the drum gates or the water balance change. Spill begins once the
  // lake is above the drum-gate top (fixed crest plus the raised height).
  // Every unit trips once the lake is below the minimum power pool.
  if (lake < ELEV.minPower) return 5;
  if (lake > top) return 4;
  if (!unit.on || ((unit.mw || 0) < 0.5 && (unit.rpm || 0) < 30 && unit.gate < 0.05)) return 0;
  if ((unit.rpm || 0) < 170) return 1;
  if (unit.gate < 0.55) return 2;
  return 3;
}

function a5Command(tau, ov) {
  let inflow = 12000;
  let speed = 0;
  let gate = 0;
  let n = 0;
  if (tau < 5) {
    gate = 0; n = 0;
  } else if (tau < 12) {
    const u = (tau - 5) / 7;
    gate = lerp(0.04, 0.22, smooth(u)); n = 1;
  } else if (tau < 18) {
    const u = (tau - 12) / 6;
    gate = lerp(0.22, 0.42, smooth(u)); n = 1;
  } else if (tau < 26) {
    const u = (tau - 18) / 8;
    gate = lerp(0.42, 0.84, smooth(u));
    n = Math.max(1, Math.round(lerp(1, 9, smooth(u))));
  } else if (tau < 42) {
    const u = (tau - 26) / 16;
    gate = lerp(0.84, 1, smooth(Math.min(1, u * 2)));
    n = 17;
    // Held at the top of the inflow slider. 16 s × 60 sim hours/s is enough
    // to climb from 1,198 ft through the raised drum-gate top at 1,221.4 ft.
    // A lowered drum (top at the 1,205.4 ft crest) spills earlier.
    inflow = 110000;
    speed = 60;
  } else {
    gate = 1; n = 17;
    // Below the turbine release, so the same water balance falls through
    // the minimum power pool before the sequence ends.
    inflow = 3000;
    speed = 360;
  }
  return {
    lake0: ov.lake0 ?? 1198,
    drum: ov.drum ?? 1,
    inflow: ov.inflow ?? inflow,
    speed,
    gate: ov.gate ?? gate,
    n: ov.units ?? n,
    mode: 'manual',
  };
}

function dayCommand(tau, ov) {
  return {
    lake0: ov.lake0 ?? 1065,
    drum: ov.drum ?? 1,
    inflow: ov.inflow ?? 11000,
    speed: 24 / DAY_DUR,
    // null means "let auto dispatch choose this". One override keeps the other.
    gate: ov.gate ?? null,
    n: ov.units ?? null,
    mode: ov.gate == null && ov.units == null ? 'auto' : 'manual',
  };
}

// The units and the gate auto dispatch would choose at this lake and hour.
// A scratch step keeps that decision inside hydro.js. Paused, so the lake stays.
function autoPlan(state) {
  const scratch = {
    lake: state.lake, inflow: state.inflow, drum: state.drum,
    mode: 'auto', demand: demandMW(state.hour),
    units: state.units.map((u) => ({ ...u })),
    hour: state.hour, day: state.day, speed: state.speed,
    paused: true, out: { ...state.out },
  };
  step(scratch, 0);
  let n = 0, gate = 0;
  for (const u of scratch.units) if (u.on) { n++; gate = u.gate; }
  return { n, gate };
}

function snapshot(st) {
  return {
    lake: st.lake, inflow: st.inflow, drum: st.drum, mode: st.mode,
    demand: st.demand, hour: st.hour, day: st.day, speed: st.speed,
    units: st.units.map((u) => ({ ...u })),
    out: {
      ...st.out,
      spill: st.out.spill ? { ...st.out.spill } : null,
      warn: (st.out.warn || []).map((w) => ({ ...w })),
    },
  };
}

function restore(st, s) {
  st.lake = s.lake; st.inflow = s.inflow; st.drum = s.drum; st.mode = s.mode;
  st.demand = s.demand; st.hour = s.hour; st.day = s.day; st.speed = s.speed;
  st.units.forEach((u, i) => Object.assign(u, s.units[i]));
  st.out = {
    ...s.out,
    spill: s.out.spill ? { ...s.out.spill } : null,
    warn: (s.out.warn || []).map((w) => ({ ...w })),
  };
}

function applyCommand(state, cmd, dt) {
  state.drum = cmd.drum;
  state.inflow = cmd.inflow;
  state.speed = cmd.speed;
  state.paused = false;
  const gateMissing = cmd.gate == null;
  const unitsMissing = cmd.n == null;
  if (gateMissing && unitsMissing) {
    state.mode = 'auto';
    state.demand = demandMW(state.hour);
    return;
  }
  // A gate with no unit count, or a unit count with no gate, would turn the
  // plant off: manual mode runs nobody when n is missing, and a null gate
  // eases every wicket shut. Fill the missing half from auto dispatch.
  state.mode = 'manual';
  let gate = cmd.gate;
  let n = cmd.n;
  let order = BRING_ON;
  if (gateMissing || unitsMissing) {
    const plan = autoPlan(state);
    if (gateMissing) gate = plan.gate;
    if (unitsMissing) n = plan.n;
    order = CENTER;
  }
  state.units.forEach((u) => { u.on = false; });
  const count = Math.max(0, n || 0);
  for (let i = 0; i < count && i < order.length; i++) state.units[order[i]].on = true;
  const k = 1 - Math.exp(-dt * GATE_INERTIA);
  for (const u of state.units) u.gate += ((gate || 0) - u.gate) * k;
}

export class Run {
  constructor(kind, overrides = {}) {
    this.kind = kind === 'day' ? 'day' : 'a5';
    this.duration = this.kind === 'day' ? DAY_DUR : A5_DUR;
    this.overrides = { ...overrides };
    this.tau = 0;
    this.built = false;
    this.sampleCount = 0;
    this.checkpoints = [];
    const n = Math.ceil(this.duration / DT) + 2;
    this.tauBuf = new Float64Array(n);
    this.lakeBuf = new Float64Array(n);
    this.mwBuf = new Float64Array(n);
    this.phaseBuf = new Uint8Array(n * 17);
    this.state = createState();
  }

  command(tau) {
    const ov = this.overrides;
    return this.kind === 'day' ? dayCommand(tau, ov) : a5Command(tau, ov);
  }

  reset() {
    const st = createState();
    const cmd = this.command(0);
    st.lake = cmd.lake0;
    st.hour = this.kind === 'day' ? 0 : 11;
    st.day = 196;
    st.paused = false;
    st.units.forEach((u) => { u.on = false; u.gate = 0; u.rpm = 0; u.mw = 0; u.q = 0; u.eta = 0; u.spin = 0; });
    this.state = st;
    this.tau = 0;
    step(st, 0);
    this.checkpoints = [{ tau: 0, snap: snapshot(st) }];
    this.sampleCount = 0;
    this.built = false;
  }

  record() {
    const i = this.sampleCount;
    if (i >= this.tauBuf.length) return;
    const st = this.state;
    const top = spillFlow(st.lake, st.drum).top;
    this.tauBuf[i] = this.tau;
    this.lakeBuf[i] = st.lake;
    this.mwBuf[i] = st.out.mw || 0;
    for (let u = 0; u < 17; u++) this.phaseBuf[i * 17 + u] = phaseIndex(st.units[u], st.lake, top);
    this.sampleCount = i + 1;
  }

  advance(dt, record) {
    const st = this.state;
    const cmd = this.command(this.tau);
    applyCommand(st, cmd, dt);
    // Once the pool is below the turbines, stop adding water. Otherwise the
    // inflow refills a few tenths of a foot, the units restart, and the chart
    // chatters across the trip line. The crossing itself still comes from hydro.js.
    if (this.kind === 'a5' && st.lake < ELEV.minPower) { st.inflow = 0; st.speed = 0; }
    const hours = st.speed * dt;
    const n = Math.max(1, Math.ceil(hours));
    const sub = dt / n;
    for (let i = 0; i < n; i++) {
      if (st.mode === 'auto') st.demand = demandMW(st.hour);
      step(st, sub);
    }
    const w = SHOW_SPIN;
    for (const u of st.units) u.spin = (u.spin || 0) + ((u.rpm || 0) / 60) * Math.PI * 2 * w * dt;
    this.tau += dt;
    if (record) {
      this.record();
      const last = this.checkpoints[this.checkpoints.length - 1];
      if (this.tau - last.tau >= 0.5) this.checkpoints.push({ tau: this.tau, snap: snapshot(st) });
    }
  }

  rebuild(tau = 0) {
    this.reset();
    this.record();
    while (this.tau < this.duration - 1e-9) this.advance(Math.min(DT, this.duration - this.tau), true);
    this.built = true;
    this.seek(tau);
  }

  seek(tau) {
    if (!this.built) this.rebuild(tau);
    tau = clamp(tau, 0, this.duration);
    // The recorded run steps by exactly DT from the origin. An in-between
    // time is not a state the model produced, and playing onward from a
    // fractional step would leave the grid, so a later seek would disagree.
    const grid = Math.min(this.duration, Math.round(tau / DT) * DT);
    let cp = this.checkpoints[0];
    for (const c of this.checkpoints) if (c.tau <= grid + 1e-6) cp = c;
    restore(this.state, cp.snap);
    this.tau = cp.tau;
    const steps = Math.max(0, Math.round((grid - this.tau) / DT));
    for (let i = 0; i < steps; i++) this.advance(DT, false);
  }

  index(tau) {
    let lo = 0, hi = this.sampleCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tauBuf[mid] <= tau + 1e-6) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  phaseAt(tau, unit = A5) {
    if (!this.sampleCount) return 'stand';
    return PHASES[this.phaseBuf[this.index(tau) * 17 + unit]].id;
  }

  bounds(unit = A5) {
    const out = [];
    let prev = -1;
    for (let i = 0; i < this.sampleCount; i++) {
      const p = this.phaseBuf[i * 17 + unit];
      if (p !== prev) { out.push({ id: PHASES[p].id, name: PHASES[p].name, color: PHASES[p].color, t0: this.tauBuf[i], index: p }); prev = p; }
    }
    return out;
  }

  lakeAt(tau) { return this.sampleCount ? this.lakeBuf[this.index(tau)] : this.state.lake; }
}

export const A5_INDEX = A5;
export const PHASE_BY_ID = Object.fromEntries(PHASES.map((p) => [p.id, p]));

// Copy a run onto the page's live state. The render loop must not call step()
// afterwards: the copied lake is the integral up to tau, and another step would move it.
export function applyRun(dst, run) {
  const s = run.state;
  dst.lake = s.lake;
  dst.inflow = s.inflow;
  dst.drum = s.drum;
  dst.mode = s.mode;
  dst.demand = s.demand;
  dst.hour = s.hour;
  dst.day = s.day;
  dst.speed = s.speed;
  dst.paused = true;
  dst.units.forEach((u, i) => {
    const b = s.units[i];
    u.on = b.on; u.gate = b.gate; u.rpm = b.rpm; u.mw = b.mw;
    u.q = b.q; u.eta = b.eta; u.hnet = b.hnet; u.spin = b.spin;
  });
  dst.out = s.out;
}
