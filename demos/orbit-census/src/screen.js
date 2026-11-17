// Close-approach screen over one propagation snapshot. Pure, so it can be tested without a worker.
// pv holds 6 floats per object in scene units (1 = 1000 km; velocity in 1000 km/s), ok marks
// propagated objects and cospar holds launch designators (first 8 characters).
//
// Criteria, all three shown in the console so an empty list never reads as "nothing nearby":
//   1. closer than SCREEN_KM right now (an instantaneous distance, not a probability);
//   2. from different launches (same-launch trains and stacks would fill the list);
//   3. moving at least MIN_RELATIVE_KMS apart. This is a speed heuristic, not docking data: it keeps
//      out co-moving pairs such as separately catalogued ISS modules, and would also hide any other
//      pair drifting together more slowly than that. Those are counted in `slow`, not dropped silently.
export const SCREEN_KM = 25;
export const MIN_RELATIVE_KMS = 0.01; // 10 m/s
export const SCREEN_MAX = 8;

export function screenPairs(pv, ok, cospar, { limKm = SCREEN_KM, minRelKms = MIN_RELATIVE_KMS, max = SCREEN_MAX } = {}) {
  const n = ok.length; const cell = limKm / 1000; const map = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const o = i * 6; const k = key(Math.floor(pv[o] / cell), Math.floor(pv[o + 1] / cell), Math.floor(pv[o + 2] / cell));
    const a = map.get(k); if (a) a.push(i); else map.set(k, [i]);
  }
  const pairs = []; let slow = 0;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const o = i * 6; const cx = Math.floor(pv[o] / cell), cy = Math.floor(pv[o + 1] / cell), cz = Math.floor(pv[o + 2] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = map.get(key(cx + dx, cy + dy, cz + dz)); if (!a) continue;
      for (const j of a) {
        if (j <= i) continue;
        if (cospar[i] && cospar[i] === cospar[j]) continue;
        const p = j * 6;
        const d = Math.hypot(pv[o] - pv[p], pv[o + 1] - pv[p + 1], pv[o + 2] - pv[p + 2]) * 1000;
        if (d >= limKm) continue;
        const vr = Math.hypot(pv[o + 3] - pv[p + 3], pv[o + 4] - pv[p + 4], pv[o + 5] - pv[p + 5]) * 1000;
        if (vr < minRelKms) { slow++; continue; }
        pairs.push([i, j, d, vr]);
      }
    }
  }
  pairs.sort((a, b) => a[2] - b[2]);
  return { pairs: pairs.slice(0, max), slow };
}
