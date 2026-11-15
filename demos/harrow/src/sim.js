// HARROW TK-4 · one model for gait, leg loads, power and heat.
// Every panel and every moving part reads from step(); nothing is keyframed.
//
// Gait follows dynamic similarity (Alexander, 1976): animals of any size change gait
// at about the same Froude number Fr = v² / (g·h), and stride length scales as
// λ / h ≈ 2.3 · Fr^0.3. Peak vertical force on a leg follows from the duty factor β:
// a leg carries its share of weight only while it is on the ground.

export const G = 9.81;
export const SPEC = {
  mass: 840, // kg, dry
  hip: 1.5, // m, hip height (h in the Froude number)
  frontShare: 0.56, // fraction of weight on the front legs on level ground
  cellKWh: 6.5, cells: 4, // battery
  ratedKW: 36,
  bore: 0.063, lever: 3.6, precharge: 12, ratedBar: 210, // hydraulic ram per knee
  etaDrive: 0.82, lossShare: 0.22,
  heatCap: 2500, uaBase: 30, uaFins: 120, finOnset: 42, finSpan: 18, // thermal (J/K, W/K, °C)
  hotelW: 900, scanW: 650, drillW: 2600,
};
export const LEGS = ['LF', 'RF', 'LH', 'RH'];

// phase offsets per leg (LF, RF, LH, RH) and duty factor per gait
export const GAITS = {
  stand: { duty: 1, off: [0, 0.5, 0.5, 0], cot: 0 },
  walk: { duty: 0.72, off: [0.25, 0.75, 0, 0.5], cot: 0.52 }, // lateral sequence: LH, LF, RH, RF
  trot: { duty: 0.46, off: [0, 0.5, 0.5, 0], cot: 0.44 }, // diagonal pairs
  bound: { duty: 0.34, off: [0.45, 0.55, 0, 0.1], cot: 0.46 }, // rotary gallop: hinds, then fronts
};

export function createState() {
  return {
    vSet: 0.9, v: 0.9, payload: 60, grade: 0, gaitMode: 'auto', scan: true, drill: false,
    gait: 'walk', off: [...GAITS.walk.off], duty: GAITS.walk.duty, phase: 0,
    temp: 34, fins: 0, soc: 0.86, throttle: 1, drillDepth: 0, cores: 0, odo: 0, tAmb: 22,
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (x) => x - Math.floor(x);
// shortest signed difference between two phases
const dphase = (a, b) => { let d = wrap(b - a); if (d > 0.5) d -= 1; return d; };

export function froude(v) { return (v * v) / (G * SPEC.hip); }
export function strideLength(v) { return v < 0.01 ? 0 : 2.3 * SPEC.hip * Math.pow(froude(v), 0.3); }

function autoGait(st, Fr) {
  if (st.v < 0.06) return 'stand';
  const g = st.gait === 'stand' ? 'walk' : st.gait;
  if (g === 'walk') return Fr > 0.42 ? 'trot' : 'walk';
  if (g === 'trot') return Fr < 0.36 ? 'walk' : Fr > 1.9 ? 'bound' : 'trot';
  return Fr < 1.6 ? 'trot' : 'bound';
}

export function step(st, dt) {
  // drilling needs the machine standing still
  const want = st.drill ? 0 : st.vSet * st.throttle;
  const acc = 1.4 * dt;
  st.v += clamp(want - st.v, -acc, acc);
  if (Math.abs(st.v) < 1e-3) st.v = 0;

  const Fr = froude(st.v);
  let gait = st.gaitMode === 'auto' || st.v < 0.06 ? autoGait(st, Fr) : st.gaitMode;
  if (st.v < 0.06) gait = 'stand';
  st.gait = gait;
  const G0 = GAITS[gait];

  // offsets and duty glide to the new gait, so transitions are visible rather than a snap
  const k = 1 - Math.exp(-dt * 3.2);
  if (gait !== 'stand') for (let i = 0; i < 4; i++) st.off[i] = wrap(st.off[i] + dphase(st.off[i], G0.off[i]) * k);
  st.duty += (G0.duty - st.duty) * k;

  const lambda = strideLength(st.v); // m
  const freq = lambda > 0 ? st.v / lambda : 0; // strides per second
  st.phase = wrap(st.phase + freq * dt);
  st.odo += st.v * dt;

  // loads
  const theta = Math.atan(st.grade / 100);
  const mass = SPEC.mass + st.payload;
  const W = mass * G;
  const front = clamp(SPEC.frontShare - 0.9 * Math.sin(theta), 0.3, 0.75); // climbing shifts weight back
  const beta = clamp(st.duty, 0.2, 1);
  const legs = [];
  let stanceCount = 0;
  for (let i = 0; i < 4; i++) {
    const share = i < 2 ? front : 1 - front; // per pair
    const ph = wrap(st.phase + st.off[i]);
    const stance = gait === 'stand' || ph < beta;
    const s = gait === 'stand' ? 0.5 : stance ? ph / beta : (ph - beta) / (1 - beta);
    let F;
    if (gait === 'stand') F = (W * share) / 2;
    else F = stance ? ((Math.PI * W * share) / (4 * beta)) * Math.sin(Math.PI * s) : 0; // half-sine, averages to W·share/2 per leg
    const bar = (F * SPEC.lever) / (Math.PI * (SPEC.bore / 2) ** 2) / 1e5 + SPEC.precharge;
    if (stance) stanceCount++;
    legs.push({ id: LEGS[i], phase: ph, stance, s, F, bar });
  }
  const peakBar = (Math.PI * W * Math.max(front, 1 - front) / (4 * beta)) * SPEC.lever / (Math.PI * (SPEC.bore / 2) ** 2) / 1e5 + SPEC.precharge;

  // power: cost of transport for locomotion, plus lifting against the grade, plus the hotel load
  const cot = gait === 'stand' ? 0 : G0.cot * (1 + 0.15 * Math.max(0, Fr - 1));
  const pLoco = cot * W * st.v;
  let pGrade = W * st.v * Math.sin(theta);
  if (pGrade < 0) pGrade *= 0.25; // downhill: the legs brake, a little comes back
  const pHotel = SPEC.hotelW + (st.scan ? SPEC.scanW : 0) + (st.drillDepth > 0.02 ? SPEC.drillW : 0);
  const P = Math.max(0, (pLoco + pGrade) / SPEC.etaDrive) + pHotel; // W
  const rated = SPEC.ratedKW * 1000;
  // over the rating, or too hot, the governor eases the pace
  const limit = Math.min(1, rated / Math.max(1, P)) * (st.temp > 82 ? 0.7 : 1);
  // over the limit the pace is trimmed in proportion; under it, it recovers. Settles near P ≈ rated
  const target = limit < 0.999 ? clamp(st.throttle * limit, 0.3, 1) : 1;
  st.throttle += (target - st.throttle) * (1 - Math.exp(-dt * 1.2));

  // heat: losses into a lumped core, shed through the crest of fins
  const Q = SPEC.lossShare * P;
  const finTarget = clamp((st.temp - SPEC.finOnset) / SPEC.finSpan, 0, 1);
  st.fins += clamp(finTarget - st.fins, -0.5 * dt, 0.5 * dt);
  const UA = SPEC.uaBase + SPEC.uaFins * st.fins;
  st.temp += ((Q - UA * (st.temp - st.tAmb)) / SPEC.heatCap) * dt;

  // battery (real time: it barely moves, so the panel also shows endurance)
  const E = SPEC.cellKWh * SPEC.cells * 3.6e6;
  st.soc = clamp(st.soc - (P * dt) / E, 0, 1);
  const enduranceH = (st.soc * E) / Math.max(1, P) / 3600;
  const rangeKm = st.v > 0.05 ? (enduranceH * st.v * 3600) / 1000 : 0;

  // coring drill: lowers once stopped, takes a core at full depth
  const dTarget = st.drill && st.v < 0.02 ? 1 : 0;
  const before = st.drillDepth;
  st.drillDepth = clamp(st.drillDepth + clamp(dTarget - st.drillDepth, -0.45 * dt, 0.22 * dt), 0, 1);
  if (before < 1 && st.drillDepth >= 1) st.cores++;

  return {
    v: st.v, Fr, lambda, freq, duty: st.duty, gait, legs, stanceCount, peakBar, mass, theta,
    P, pLoco, pGrade, pHotel, cot, temp: st.temp, fins: st.fins, soc: st.soc, enduranceH, rangeKm,
    load: P / rated, throttle: st.throttle, sweep: st.duty * lambda,
  };
}
