// Snapshot Circuit: from the objects found in a photograph to a closed circuit.
// The photograph lies flat as the ground. World units: x across the picture, z down it, centred on 0.
export const WORLD_W = 120; // the picture is 120 units wide; its height follows its shape
export const HALF = 5.2; // half the track width
export const KART_R = 1.3;
export const LAPS = 3;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const toWorld = (u, v, H) => [(u - 0.5) * WORLD_W, (v - 0.5) * H];
export const toPhoto = (x, z, H) => [x / WORLD_W + 0.5, z / H + 0.5];

// Closed Catmull-Rom through control points, `per` samples a segment.
function smoothLoop(cps, per) {
  const n = cps.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = cps[(i + n - 1) % n], p1 = cps[i], p2 = cps[(i + 1) % n], p3 = cps[(i + 2) % n];
    for (let k = 0; k < per; k++) { const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); }
  }
  return out;
}

// The loop the circuit starts from. With nothing in the picture it is a rounded rectangle. With objects, it is drawn round
// the group of them, so the objects become the middle of the circuit and every photograph gives a different shape.
function homeLoop(hazards, N, mx, mz) {
  const M = N * 6, dirs = Array.from({ length: M }, (_, i) => { const a = -(i / M) * Math.PI * 2 + Math.PI / 2; return [Math.cos(a), Math.sin(a)]; }); // anticlockwise on screen
  const even = loop => { const cum = [0]; for (let i = 0; i < M; i++) cum.push(cum[i] + Math.hypot(loop[(i + 1) % M][0] - loop[i][0], loop[(i + 1) % M][1] - loop[i][1])); const out = []; let k = 0; // the same loop as N points, evenly spaced along it
    for (let i = 0; i < N; i++) { const d = cum[M] * i / N; while (cum[k + 1] < d) k++; const f = (d - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]), p = loop[k], q = loop[(k + 1) % M]; out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); } return out; };
  const rect = dirs.map(([c, s]) => { const k = 1 / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), 0.25); return [c * k * mx * 0.86, s * k * mz * 0.84]; });
  if (!hazards.length) return even(rect);
  const pts = []; for (const hz of hazards) for (let k = 0; k < 12; k++) pts.push([hz.x + Math.cos(k / 12 * 6.2832) * hz.r, hz.z + Math.sin(k / 12 * 6.2832) * hz.r]);
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]); // the outline of the group: a convex hull
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]), half = list => { const h = []; for (const p of list) { while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
  const hull = [...half(pts), ...half([...pts].reverse())];
  let cx = 0, cz = 0; for (const p of hull) { cx += p[0]; cz += p[1]; } cx /= hull.length; cz /= hull.length; cx = clamp(cx, -mx * 0.5, mx * 0.5); cz = clamp(cz, -mz * 0.5, mz * 0.5);
  const reach = ([dx, dz]) => { let far = 0; for (let k = 0; k < hull.length; k++) { const p = hull[k], q = hull[(k + 1) % hull.length], ex = q[0] - p[0], ez = q[1] - p[1], den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue; const t = ((p[0] - cx) * ez - (p[1] - cz) * ex) / den, u = ((p[0] - cx) * dz - (p[1] - cz) * dx) / den; if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) far = Math.max(far, t); } return far; };
  const radial = dirs.map(reach), make = grow => dirs.map(([dx, dz], i) => [clamp(cx + dx * (radial[i] + HALF + 3 + grow), -mx, mx), clamp(cz + dz * (radial[i] + HALF + 3 + grow), -mz, mz)]);
  const around = loop => loop.reduce((sum, p, i) => sum + Math.hypot(p[0] - loop[(i + 1) % M][0], p[1] - loop[(i + 1) % M][1]), 0), want = around(rect) * 0.62;
  let loop = make(0); for (let grow = 2; around(loop) < want && grow < 80; grow += 2) loop = make(grow); // a small group still gets a circuit worth driving
  return even(loop);
}

// Does a closed line of points cross itself anywhere?
function crosses(pts) { const n = pts.length, hit = (a, b, c, d) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (hit(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true; } return false; }

// Build the circuit: a loop round the things in the picture, pushed aside wherever one still stands in its way.
// Three tries, each plainer than the last, so every picture ends with a road that does not cross itself and that nothing blocks:
// round the group of objects; a rounded rectangle pushed clear of them; a rounded rectangle left alone.
export function buildTrack(analysis) {
  const H = WORLD_W * analysis.height / analysis.width, mx = WORLD_W / 2 - HALF - 2.5, mz = H / 2 - HALF - 2.5;
  if (!(mz > HALF + 2)) throw new Error('This picture is too wide or too tall to make a circuit from'); // the page crops pictures before they get here
  const all = analysis.blobs.filter(b => b.role === 'hazard').map(b => { const [x, z] = toWorld(b.x, b.y, H), w = (b.x1 - b.x0) * WORLD_W, h = (b.y1 - b.y0) * H; return { blob: b.id, x, z, r: clamp(Math.min(w, h) * 0.42, 2.2, 14), w, h, name: b.name, colour: b.colour }; });
  const N = Math.max(36, Math.round((mx + mz) * 2 / 6.5)); let pts = null, hazards = null; // more guide points for a longer loop
  for (const plan of ['round', 'pushed', 'plain']) {
    hazards = all.map(hz => ({ ...hz })); const cps = homeLoop(plan === 'round' ? hazards : [], N, mx, mz), home = cps.map(p => [p[0], p[1]]);
    if (plan !== 'plain') for (let it = 0; it < 90; it++) {
      for (let i = 0; i < N; i++) { const p = cps[i]; p[0] += (home[i][0] - p[0]) * 0.05; p[1] += (home[i][1] - p[1]) * 0.05; // a gentle pull back to the wide loop, so smoothing never shrinks the circuit
        for (const hz of hazards) { let dx = p[0] - hz.x, dz = p[1] - hz.z, d = Math.hypot(dx, dz); const need = hz.r + HALF + 1.6; if (d >= need) continue; if (d < 0.01) { dx = p[0] || 1; dz = p[1]; d = Math.hypot(dx, dz); } p[0] += dx / d * (need - d) * 0.55; p[1] += dz / d * (need - d) * 0.55; }
        p[0] = clamp(p[0], -mx, mx); p[1] = clamp(p[1], -mz, mz);
      }
      if (it < 80) for (let i = 0; i < N; i++) { const a = cps[(i + N - 1) % N], b = cps[i], c = cps[(i + 1) % N]; b[0] = b[0] * 0.7 + (a[0] + c[0]) * 0.15; b[1] = b[1] * 0.7 + (a[1] + c[1]) * 0.15; }
    }
    pts = smoothLoop(cps, 10).map(p => [clamp(p[0], -mx - 2, mx + 2), clamp(p[1], -mz - 2, mz + 2)]);
    // Iron out any kink a kart could not steer round: smooth the line a little at a time until no short stretch turns too sharply.
    const kink = () => { let worst = 0; const m = pts.length; for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % m], c = pts[(i + 4) % m], d = pts[(i + 5) % m], t = Math.atan2(d[1] - c[1], d[0] - c[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]); worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(t), Math.cos(t)))); } return worst; };
    for (let pass = 0; pass < 240 && kink() > 0.42; pass++) pts = pts.map((p, i) => { const a = pts[(i + pts.length - 1) % pts.length], c = pts[(i + 1) % pts.length]; return [p[0] * 0.5 + (a[0] + c[0]) * 0.25, p[1] * 0.5 + (a[1] + c[1]) * 0.25]; });
    const sharp = kink() > 0.42;
    // An object with no room beside the road is left lying flat in the picture: it is not made solid.
    hazards = hazards.filter(hz => { let near = Infinity; for (const p of pts) near = Math.min(near, Math.hypot(p[0] - hz.x, p[1] - hz.z)); const room = near - HALF - 0.4; hz.clear = near; if (room < 1.6) return false; hz.r = Math.min(hz.r, room); return true; }); // solid things stand beside the road, never in it
    let tight = false; for (let i = 0; i < pts.length && !tight; i++) for (let j = i + 40; j <= i + pts.length - 40 && !tight; j++) { const q = pts[j % pts.length]; if (Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) < HALF * 1.6) tight = true; } // two stretches of road lying on top of each other
    if (plan === 'plain' || (!crosses(pts) && !tight && !sharp)) break;
  }
  const n = pts.length, cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const track = { H, pts, cum, length: cum[n], n, hazards, half: HALF, flat: all.filter(a => !hazards.some(hz => hz.blob === a.blob)).map(a => a.blob) };
  // Start on the calmest stretch away from the objects.
  let best = 0, bestScore = Infinity;
  for (let i = 0; i < n; i += 5) { let bend = 0; for (let k = -12; k <= 12; k += 4) { const a = heading(track, i + k), b = heading(track, i + k + 4); bend += Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))); } let crowd = 0; for (const hz of hazards) crowd += Math.max(0, 22 - Math.hypot(pts[i][0] - hz.x, pts[i][1] - hz.z)); const sc = bend * 30 + crowd; if (sc < bestScore) { bestScore = sc; best = i; } }
  track.start = best; track.checkpoints = Array.from({ length: 8 }, (_, k) => (best + Math.round(k * n / 8)) % n);
  // Pick-ups: the small objects, moved onto the road beside where they sit in the picture. Top up from the picture's own colours.
  const picks = [];
  for (const b of analysis.blobs.filter(x => x.role === 'pickup')) { const [x, z] = toWorld(b.x, b.y, H), i = nearest(track, x, z, 0, n); picks.push({ i, blob: b.id, colour: b.colour, name: b.name, fromPhoto: true }); }
  for (let k = 0; picks.length < 5 && k < 10; k++) { const i = (best + Math.round((k + 0.5) * n / 10) + 17) % n; if (picks.some(p => Math.min(Math.abs(p.i - i), n - Math.abs(p.i - i)) < n / 14)) continue; const src = analysis.blobs[k % Math.max(1, analysis.blobs.length)]; picks.push({ i, blob: src ? src.id : -1, colour: src ? src.colour : [240, 200, 60], name: src ? src.name : 'gold', fromPhoto: false }); }
  track.pickups = picks.map((p, k) => { const nrm = normal(track, p.i), off = (k % 2 ? 1 : -1) * HALF * 0.42; return { ...p, x: pts[p.i][0] + nrm[0] * off, z: pts[p.i][1] + nrm[1] * off }; });
  return track;
}

export const heading = (t, i) => { const a = t.pts[((i % t.n) + t.n) % t.n], b = t.pts[(((i + 1) % t.n) + t.n) % t.n]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
export const normal = (t, i) => { const h = heading(t, i); return [-Math.sin(h), Math.cos(h)]; };
// Index of the nearest centre-line point, searching `span` points either side of `from` (or everything).
export function nearest(t, x, z, from, span) {
  let best = from, bd = Infinity;
  for (let k = -span; k <= span; k++) { const i = (((from + k) % t.n) + t.n) % t.n, d = (t.pts[i][0] - x) ** 2 + (t.pts[i][1] - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
export const offRoad = (t, x, z, i) => Math.hypot(t.pts[i][0] - x, t.pts[i][1] - z) > t.half + 0.4;
