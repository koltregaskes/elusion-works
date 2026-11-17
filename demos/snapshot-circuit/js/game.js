// Snapshot Circuit: the race. A fixed-step simulation with no drawing and no clock of its own,
// so the same inputs always give the same race and it can be run and checked without a screen.
import { nearest, heading, normal, offRoad, KART_R, LAPS } from './track.js';

export const DT = 1 / 60;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export function newRace(track, { rivals = 2 } = {}) {
  const karts = [];
  for (let k = 0; k <= rivals; k++) { // a staggered grid behind the line, the player at the back
    const slot = rivals - k, i = (track.start - 6 - slot * 5 + track.n) % track.n, nrm = normal(track, i), side = (slot % 2 ? 1 : -1) * track.half * 0.45;
    karts.push({ id: k, player: k === 0, x: track.pts[i][0] + nrm[0] * side, z: track.pts[i][1] + nrm[1] * side, h: heading(track, i), v: 0, i, lap: 0, cp: 1, boost: 0, bump: 0, done: false, time: 0, laps: [], lapStart: 0, skill: k === 0 ? 1 : 0.86 + 0.05 * k, line: side * 0.6 });
  }
  return { track, karts, t: 0, go: false, countdown: 3, picks: track.pickups.map(() => 0), events: [], finished: false, order: [] };
}

// What a computer driver would do from here: aim at a point further down the road, ease off for bends.
export function autopilot(race, kart) {
  const t = race.track, look = Math.round(7 + kart.v * 0.5), j = (kart.i + look) % t.n, nrm = normal(t, j);
  const tx = t.pts[j][0] + nrm[0] * kart.line, tz = t.pts[j][1] + nrm[1] * kart.line, want = Math.atan2(tz - kart.z, tx - kart.x), err = wrap(want - kart.h);
  let bend = 0; for (let k = 2; k <= 26; k += 4) bend = Math.max(bend, Math.abs(wrap(heading(t, kart.i + k + 4) - heading(t, kart.i + k))));
  const safe = clamp(40 - bend * 62, 13, 40) * kart.skill;
  return { steer: clamp(err * 2.6, -1, 1), throttle: kart.v < safe ? 1 : 0, brake: kart.v > safe + 4 ? 1 : 0 };
}

// Advance the race by one sixtieth of a second. `input` drives the player: { steer -1..1, throttle 0..1, brake 0..1 }.
export function step(race, input) {
  const t = race.track; race.events.length = 0;
  if (!race.go) { race.countdown -= DT; if (race.countdown <= 0) { race.go = true; race.events.push({ type: 'go' }); } return race; }
  race.t += DT; // the race runs on after the player finishes, so the others cross the line too
  for (let k = 0; k < race.picks.length; k++) if (race.picks[k] > 0) race.picks[k] -= DT;
  for (const kart of race.karts) {
    const inp = kart.done ? { steer: 0, throttle: 0, brake: 0.6 } : kart.player && input ? input : autopilot(race, kart);
    const off = offRoad(t, kart.x, kart.z, kart.i), top = (off ? 15 : 33) * (kart.player ? 1 : kart.skill) + (kart.boost > 0 ? 12 : 0);
    kart.v += (inp.throttle * (kart.boost > 0 ? 34 : 21) - inp.brake * 42) * DT; kart.v -= kart.v * (off ? 1.5 : 0.42) * DT;
    if (kart.v > top) kart.v += (top - kart.v) * Math.min(1, 5 * DT); kart.v = clamp(kart.v, -7, 60);
    kart.h = wrap(kart.h + inp.steer * 2.5 * clamp(Math.abs(kart.v) / 11, 0.2, 1) * Math.sign(kart.v || 1) * DT);
    kart.x += Math.cos(kart.h) * kart.v * DT; kart.z += Math.sin(kart.h) * kart.v * DT;
    kart.boost = Math.max(0, kart.boost - DT); kart.bump = Math.max(0, kart.bump - DT);
    kart.stuck = !kart.done && Math.abs(kart.v) < 1.5 ? (kart.stuck || 0) + DT : 0;
    if (kart.stuck > 2 && !kart.player) rescue(race, kart); // a computer driver wedged against something is set back on the road
    // The objects from the photograph are solid.
    for (const hz of t.hazards) { const dx = kart.x - hz.x, dz = kart.z - hz.z, d = Math.hypot(dx, dz), min = hz.r + KART_R; if (d < min) { const nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0; kart.x = hz.x + nx * min; kart.z = hz.z + nz * min; if (Math.abs(kart.v) > 4) { race.events.push({ type: 'bump', kart: kart.id, hazard: hz.blob, speed: Math.abs(kart.v) }); kart.bump = 0.35; } kart.v *= 0.35; } }
    // So is the edge of the picture.
    const ex = 60 - KART_R, ez = t.H / 2 - KART_R; if (Math.abs(kart.x) > ex || Math.abs(kart.z) > ez) { kart.x = clamp(kart.x, -ex, ex); kart.z = clamp(kart.z, -ez, ez); kart.v *= 0.5; }
    // Progress: checkpoints must be taken in order, so cutting across the picture or reversing earns nothing.
    kart.i = nearest(t, kart.x, kart.z, kart.i, 24);
    if (!kart.done) {
      const target = t.checkpoints[kart.cp % 8], gap = ((kart.i - target + t.n) % t.n);
      if (gap < 30 && Math.hypot(t.pts[kart.i][0] - kart.x, t.pts[kart.i][1] - kart.z) < t.half + 6) {
        kart.cp++;
        if (kart.cp % 8 === 1 && kart.cp > 1) { kart.lap++; kart.laps.push(race.t - kart.lapStart); kart.lapStart = race.t; race.events.push({ type: 'lap', kart: kart.id, lap: kart.lap, time: kart.laps[kart.laps.length - 1] });
          if (kart.lap >= LAPS) { kart.done = true; kart.time = race.t; race.order.push(kart.id); race.events.push({ type: 'finish', kart: kart.id, place: race.order.length, time: race.t }); } }
      }
      for (let k = 0; k < t.pickups.length; k++) { const p = t.pickups[k]; if (race.picks[k] <= 0 && Math.hypot(p.x - kart.x, p.z - kart.z) < 2.6) { race.picks[k] = 9; kart.boost = 1.7; race.events.push({ type: 'pickup', kart: kart.id, pickup: k }); } }
    }
  }
  for (let a = 0; a < race.karts.length; a++) for (let b = a + 1; b < race.karts.length; b++) { // karts nudge each other apart
    const A = race.karts[a], B = race.karts[b], dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) || 0.001; if (d < KART_R * 2) { const push = (KART_R * 2 - d) / 2; A.x -= dx / d * push; A.z -= dz / d * push; B.x += dx / d * push; B.z += dz / d * push;
      for (const K of [A, B]) for (const hz of t.hazards) { const ex = K.x - hz.x, ez = K.z - hz.z, e = Math.hypot(ex, ez) || 0.001, min = hz.r + KART_R; if (e < min) { K.x = hz.x + ex / e * min; K.z = hz.z + ez / e * min; } } } } // a nudge never pushes anyone into an object
  if (race.karts[0].done) race.finished = true;
  return race;
}

// Put a kart back on the centre of the road where it is, facing the right way. The player can ask for this too.
export function rescue(race, kart) { const t = race.track; kart.i = nearest(t, kart.x, kart.z, kart.i, t.n); kart.x = t.pts[kart.i][0]; kart.z = t.pts[kart.i][1]; kart.h = heading(t, kart.i); kart.v = 5; kart.stuck = 0; race.events.push({ type: 'rescue', kart: kart.id }); }

// Where everyone stands: laps, then checkpoints, then distance along the road.
export function standings(race) {
  const t = race.track, score = k => k.done ? 1e9 - race.order.indexOf(k.id) : k.cp * t.n + ((k.i - t.checkpoints[(k.cp + 7) % 8] + t.n) % t.n);
  return [...race.karts].sort((a, b) => score(b) - score(a)).map(k => k.id);
}
