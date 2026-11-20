// SGP4 worker: holds one satrec per object and answers three questions.
//   prop  -> where is everything at time t (positions + velocities, scene units, one buffer)
//   track -> one object's orbit, ground track and next pass over an observer
//   conj  -> the closest pairs right now (instantaneous distance screen, see screen.js; not a probability)
// Scene units: 1 = 1000 km. TEME (x, y, z) maps to scene (x, z, -y) so +y is the north pole.
import { json2satrec, sgp4, gstime, sunPos, eciToGeodetic, geodeticToEcf, ecfToLookAngles, eciToEcf } from '../vendor/satellite/index.js';
import { rowToOmm } from './catalog.js';
import { screenPairs, launchKey } from './screen.js';

const DAY = 86400000;
const toJd = (ms) => ms / DAY + 2440587.5;
let recs = [];
let cospar = [];

function minutes(rec, ms) { return (toJd(ms) - rec.jdsatepoch) * 1440; }

function propAll(ms, out, ok) {
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i]; const o = i * 6;
    let r = null;
    if (rec && rec.error === 0) { try { r = sgp4(rec, minutes(rec, ms)); } catch { r = null; } }
    if (r && r.position && Number.isFinite(r.position.x)) {
      const p = r.position, v = r.velocity;
      out[o] = p.x / 1000; out[o + 1] = p.z / 1000; out[o + 2] = -p.y / 1000;
      out[o + 3] = v.x / 1000; out[o + 4] = v.z / 1000; out[o + 5] = -v.y / 1000;
      ok[i] = 1;
    } else {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = out[o + 4] = out[o + 5] = 0;
      ok[i] = 0;
      if (rec) rec.error = 0; // sgp4 flags are per call; keep trying next time
    }
  }
}

function eciAt(rec, ms) {
  try { const r = sgp4(rec, minutes(rec, ms)); return r && r.position && Number.isFinite(r.position.x) ? r : null; } catch { return null; }
}

// Cylindrical Earth shadow: is a TEME point (km) in eclipse?
function inShadow(p, sun) {
  const sl = Math.hypot(sun.x, sun.y, sun.z); const sx = sun.x / sl, sy = sun.y / sl, sz = sun.z / sl;
  const d = p.x * sx + p.y * sy + p.z * sz;
  if (d > 0) return false;
  const px = p.x - d * sx, py = p.y - d * sy, pz = p.z - d * sz;
  return Math.hypot(px, py, pz) < 6371;
}

function track(idx, ms, obs) {
  const rec = recs[idx]; if (!rec) return null;
  const periodMin = (2 * Math.PI) / rec.no; // rec.no is rad/min
  const orbit = []; const N = 240;
  for (let k = 0; k <= N; k++) {
    const t = ms + (k / N - 0.5) * periodMin * 60000;
    const r = eciAt(rec, t); if (!r) continue;
    orbit.push(r.position.x / 1000, r.position.z / 1000, -r.position.y / 1000);
  }
  // ground track: earth-fixed lat/lon over -0.5 .. +1.5 orbits, capped at a day
  const span = Math.min(periodMin * 2, 1440);
  const ground = [];
  for (let k = 0; k <= 360; k++) {
    const t = ms + (k / 360 * span - span * 0.25) * 60000;
    const r = eciAt(rec, t); if (!r) continue;
    const g = eciToGeodetic(r.position, gstime(toJd(t)));
    ground.push(g.latitude, g.longitude, g.height);
  }
  // next pass over the observer above 10 degrees, searched in 30 s steps over 36 h
  let pass = null;
  if (obs) {
    const og = { latitude: obs.lat * Math.PI / 180, longitude: obs.lon * Math.PI / 180, height: (obs.h || 0) / 1000 };
    const look = (t) => {
      const r = eciAt(rec, t); if (!r) return null;
      const ecf = eciToEcf(r.position, gstime(toJd(t)));
      return ecfToLookAngles(og, ecf).elevation * 180 / Math.PI;
    };
    const step = periodMin > 600 ? 300000 : 30000;
    let t = ms, prev = look(t);
    if (prev !== null && prev > 10) {
      // already up: report the pass in progress
      let s = t; while (s > ms - 3 * 3600000) { const e = look(s - step); if (e === null || e <= 10) break; s -= step; }
      pass = { rise: s, now: true };
    }
    if (!pass) {
      for (let k = 1; k < 36 * 3600000 / step; k++) {
        t = ms + k * step; const e = look(t);
        if (e !== null && e > 10 && (prev === null || prev <= 10)) { pass = { rise: t - step / 2 }; break; }
        prev = e;
      }
    }
    if (pass) {
      let t2 = pass.rise, maxEl = -90, tMax = t2;
      for (let k = 0; k < 4000; k++) { const e = look(t2); if (e === null || (e <= 10 && k > 1)) break; if (e > maxEl) { maxEl = e; tMax = t2; } t2 += Math.min(step, 15000); }
      pass.set = t2; pass.maxEl = maxEl; pass.tMax = tMax;
      // visible to the eye: object sunlit at culmination while the sky at the observer is dark
      const r = eciAt(rec, tMax); const jd = toJd(tMax);
      const sun = sunPos(jd).rsun; const AU = 149597870.7;
      const sunKm = { x: sun.x * AU, y: sun.y * AU, z: sun.z * AU };
      const ecfObs = geodeticToEcf(og); const th = gstime(jd);
      const ox = ecfObs.x * Math.cos(th) - ecfObs.y * Math.sin(th), oy = ecfObs.x * Math.sin(th) + ecfObs.y * Math.cos(th), oz = ecfObs.z;
      const on = Math.hypot(ox, oy, oz); const sl = Math.hypot(sunKm.x, sunKm.y, sunKm.z);
      const sunEl = Math.asin((ox * sunKm.x + oy * sunKm.y + oz * sunKm.z) / (on * sl)) * 180 / Math.PI;
      pass.sunlit = r ? !inShadow(r.position, sunKm) : false;
      pass.dark = sunEl < -6;
    }
  }
  return { idx, orbit: new Float32Array(orbit), ground: new Float32Array(ground), periodMin, pass };
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    const t0 = performance.now(); let bad = 0;
    recs = m.rows.map((row) => { try { const r = json2satrec(rowToOmm(row)); if (r.error) { bad++; return null; } return r; } catch { bad++; return null; } });
    cospar = m.rows.map((row) => launchKey(row[2]));
    self.postMessage({ type: 'ready', n: recs.length, bad, ms: performance.now() - t0 });
  } else if (m.type === 'prop') {
    const n = recs.length; const pv = new Float32Array(n * 6); const ok = new Uint8Array(n);
    const t0 = performance.now();
    propAll(m.t, pv, ok);
    const cost = performance.now() - t0;
    const screen = m.conj ? screenPairs(pv, ok, cospar) : null;
    self.postMessage({ type: 'snap', t: m.t, seq: m.seq, pv, ok, cost, pairs: screen?.pairs ?? null, slow: screen?.slow ?? 0 }, [pv.buffer, ok.buffer]);
  } else if (m.type === 'track') {
    const res = track(m.idx, m.t, m.obs);
    if (res) self.postMessage({ type: 'track', ...res, t: m.t, seq: m.seq }, [res.orbit.buffer, res.ground.buffer]);
  }
};
