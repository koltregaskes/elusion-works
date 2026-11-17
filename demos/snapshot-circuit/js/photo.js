// Snapshot Circuit: reading a photograph. Pure functions on pixel arrays, no page and no network.
// The idea: whatever is unusual in the picture (rare colours, strong colour) is an "object".
// Big objects become hazards, small ones become pick-ups, and the track is routed around them.

const HUES = [[9, 'red'], [40, 'orange'], [68, 'yellow'], [160, 'green'], [195, 'teal'], [255, 'blue'], [290, 'purple'], [352, 'pink'], [361, 'red']];
export function colourName([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 28) return mx < 70 ? 'dark' : mx > 190 ? 'pale' : 'grey';
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  return HUES.find(([lim]) => h < lim)[1];
}

// Shrink an image (RGBA bytes) to at most `maxW` wide by box averaging.
export function shrink(img, maxW = 192) {
  const k = Math.max(1, Math.ceil(img.width / maxW)), w = Math.floor(img.width / k), h = Math.floor(img.height / k), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const o = ((y * k + j) * img.width + x * k + i) * 4; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; }
    const o = (y * w + x) * 4, n = k * k; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}


// Find the objects in a photograph. Returns blobs with positions as fractions of the picture (0 to 1).
export function analyse(source, { maxW = 192, maxBlobs = 11 } = {}) {
  const img = source.width > maxW ? shrink(source, maxW) : source, { width: w, height: h, data } = img, n = w * h;
  // 1. Group the pixels into a few colour families (k-means on lightness and two colour axes).
  const K = 16, feat = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; feat[i * 3] = (r + g + b) / 3 * 0.7; feat[i * 3 + 1] = (r - g) * 1.5; feat[i * 3 + 2] = ((r + g) / 2 - b) * 1.5; }
  const cen = new Float32Array(K * 3), fam = new Uint8Array(n);
  { // spread the starting centres: first the average, then each time the pixel furthest from all centres so far
    const dist = new Float32Array(n).fill(Infinity); let m0 = 0, m1 = 0, m2 = 0; for (let i = 0; i < n; i++) { m0 += feat[i * 3]; m1 += feat[i * 3 + 1]; m2 += feat[i * 3 + 2]; } cen[0] = m0 / n; cen[1] = m1 / n; cen[2] = m2 / n;
    for (let k = 1; k <= K; k++) { let far = 0, at = 0; for (let i = 0; i < n; i += 3) { const d0 = feat[i * 3] - cen[(k - 1) * 3], d1 = feat[i * 3 + 1] - cen[(k - 1) * 3 + 1], d2 = feat[i * 3 + 2] - cen[(k - 1) * 3 + 2], d = d0 * d0 + d1 * d1 + d2 * d2; if (d < dist[i]) dist[i] = d; if (dist[i] > far) { far = dist[i]; at = i; } } if (k < K) { cen[k * 3] = feat[at * 3]; cen[k * 3 + 1] = feat[at * 3 + 1]; cen[k * 3 + 2] = feat[at * 3 + 2]; } }
  }
  for (let it = 0; it < 10; it++) {
    const sum = new Float64Array(K * 3), cnt = new Float64Array(K);
    for (let i = 0; i < n; i++) { let best = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d0 = feat[i * 3] - cen[k * 3], d1 = feat[i * 3 + 1] - cen[k * 3 + 1], d2 = feat[i * 3 + 2] - cen[k * 3 + 2], d = d0 * d0 + d1 * d1 + d2 * d2; if (d < bd) { bd = d; best = k; } } fam[i] = best; cnt[best]++; sum[best * 3] += feat[i * 3]; sum[best * 3 + 1] += feat[i * 3 + 1]; sum[best * 3 + 2] += feat[i * 3 + 2]; }
    for (let k = 0; k < K; k++) if (cnt[k]) { cen[k * 3] = sum[k * 3] / cnt[k]; cen[k * 3 + 1] = sum[k * 3 + 1] / cnt[k]; cen[k * 3 + 2] = sum[k * 3 + 2] / cnt[k]; }
  }
  // 2. A family that hugs the edge of the picture is background. Objects sit inside the frame.
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.07)), total = new Float64Array(K), edge = new Float64Array(K); let bandCount = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = fam[y * w + x]; total[k]++; if (x < band || y < band || x >= w - band || y >= h - band) { edge[k]++; bandCount++; } }
  const isObject = new Uint8Array(K), cut = 0.5;
  const families = [];
  for (let k = 0; k < K; k++) { const share = total[k] / n, onEdge = total[k] ? (edge[k] / total[k]) / (bandCount / n) : 9; isObject[k] = total[k] > 0 && share < 0.3 && onEdge < cut ? 1 : 0; families.push({ share, onEdge, object: !!isObject[k] }); }
  let mask = new Uint8Array(n); for (let i = 0; i < n; i++) mask[i] = isObject[fam[i]];
  { // A strongly coloured patch that sits wholly inside the frame is an object too, even if its colour also appears at the edge.
    const seen = new Uint8Array(n), st = [], inBand = (x, y) => x < band || y < band || x >= w - band || y >= h - band;
    const lumHist = new Uint32Array(256); for (let i = 0; i < n; i++) lumHist[Math.round(data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11)]++;
    let medianLum = 0; for (let acc = 0; medianLum < 255 && (acc += lumHist[medianLum]) < n / 2; medianLum++);
    for (let s0 = 0; s0 < n; s0++) {
      if (seen[s0] || mask[s0]) continue; const f = fam[s0], members = []; let edgeHits = 0, sat = 0, lumSum = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; st.push(s0); seen[s0] = 1;
      while (st.length) { const p = st.pop(), x = p % w, y = (p - x) / w; members.push(p); if (inBand(x, y)) edgeHits++; const mx = Math.max(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]), mn = Math.min(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]); sat += mx ? (mx - mn) / mx : 0; lumSum += data[p * 4] * 0.3 + data[p * 4 + 1] * 0.59 + data[p * 4 + 2] * 0.11;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (!seen[q] && !mask[q] && fam[q] === f) { seen[q] = 1; st.push(q); } } }
      const area = members.length, fill = area / ((x1 - x0 + 1) * (y1 - y0 + 1));
      const stands = sat / area >= 0.4 || (Math.abs(lumSum / area - medianLum) >= 60 && fill >= 0.45); // strong colour, or much darker or lighter than the picture as a whole
      if (edgeHits === 0 && area >= n * 0.004 && area < n * 0.25 && stands && fill >= 0.35) for (const p of members) mask[p] = 1;
    }
    // And so is a patch far more vivid than what surrounds it, even when its family reaches the edge (a dark blue cap against a dark blue sky).
    const vivid = new Uint8Array(n), seen2 = new Uint8Array(n); let extra = 0;
    for (let i = 0; i < n; i++) { const mx = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]), mn = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); vivid[i] = !mask[i] && mx >= 40 && (mx - mn) / mx >= 0.62 ? 1 : 0; }
    for (let s0 = 0; s0 < n; s0++) {
      if (!vivid[s0] || seen2[s0]) continue; const members = []; let edgeHits = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; st.push(s0); seen2[s0] = 1;
      while (st.length) { const p = st.pop(), x = p % w, y = (p - x) / w; members.push(p); if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) edgeHits++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (vivid[q] && !seen2[q]) { seen2[q] = 1; st.push(q); } } }
      const area = members.length, fill = area / ((x1 - x0 + 1) * (y1 - y0 + 1));
      if (edgeHits === 0 && area >= n * 0.004 && area < n * 0.25 && fill >= 0.35 && extra < 20) { for (const p of members) { mask[p] = 1; fam[p] = 200 + extra; } extra++; }
    }
  }
  for (let pass = 0; pass < 2; pass++) { // tidy: a pixel follows the majority of its neighbourhood
    const next = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let c = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < w && yy < h) c += mask[yy * w + xx]; } next[y * w + x] = c >= 5 ? 1 : 0; }
    mask = next;
  }
  // 3. Connected regions of one family, so two objects that touch stay two objects.
  const label = new Int32Array(n).fill(-1), found = [], stack = [];
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = found.length, f = fam[s], bl = { id, area: 0, sx: 0, sy: 0, x0: w, y0: h, x1: 0, y1: 0, r: 0, g: 0, b: 0 }; stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w; bl.area++; bl.sx += x; bl.sy += y; bl.r += data[p * 4]; bl.g += data[p * 4 + 1]; bl.b += data[p * 4 + 2];
      if (x < bl.x0) bl.x0 = x; if (x > bl.x1) bl.x1 = x; if (y < bl.y0) bl.y0 = y; if (y > bl.y1) bl.y1 = y;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (mask[q] && label[q] < 0 && fam[q] === f) { label[q] = id; stack.push(q); } }
    }
    found.push(bl);
  }
  // 3b. One object is often two families (its lit side and its shaded side). Join neighbours of the same hue.
  { const hue = b => { const r = b.r / b.area, g = b.g / b.area, bl = b.b / b.area, mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn; if (d < 24) return -1; const hh = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4; return (hh * 60 + 360) % 360; };
    const touch = new Map();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = label[y * w + x]; if (a < 0) continue; for (const q of [x + 1 < w ? y * w + x + 1 : -1, y + 1 < h ? (y + 1) * w + x : -1]) { if (q < 0) continue; const c = label[q]; if (c >= 0 && c !== a) { const key = a < c ? a * 100000 + c : c * 100000 + a; touch.set(key, (touch.get(key) || 0) + 1); } } }
    const parent = found.map((_, i) => i), root = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    for (const [key, count] of touch) { const a = Math.floor(key / 100000), c = key % 100000, ha = hue(found[a]), hc = hue(found[c]); if (count < Math.max(4, 0.35 * Math.sqrt(Math.min(found[a].area, found[c].area)))) continue; const dh = ha < 0 || hc < 0 ? (ha === hc ? 0 : 99) : Math.min(Math.abs(ha - hc), 360 - Math.abs(ha - hc)); if (dh <= 32) parent[root(a)] = root(c); }
    const merged = new Map();
    for (const b of found) { const r = root(b.id); if (!merged.has(r)) merged.set(r, { id: r, area: 0, sx: 0, sy: 0, x0: w, y0: h, x1: 0, y1: 0, r: 0, g: 0, b: 0 }); const m = merged.get(r); m.area += b.area; m.sx += b.sx; m.sy += b.sy; m.r += b.r; m.g += b.g; m.b += b.b; m.x0 = Math.min(m.x0, b.x0); m.y0 = Math.min(m.y0, b.y0); m.x1 = Math.max(m.x1, b.x1); m.y1 = Math.max(m.y1, b.y1); }
    for (let i = 0; i < n; i++) if (label[i] >= 0) label[i] = root(label[i]);
    found.length = 0; found.push(...merged.values());
  }
  let blobs = found.filter(b => b.area >= n * 0.0018 && (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) < n * 0.4).sort((a, b) => b.area - a.area).slice(0, maxBlobs);
  let method = 'colour';
  if (blobs.length < 3) { // a picture with no stand-out colours: use its busiest patches instead
    method = 'detail'; const gx = 8, gy = 6, cells = [];
    for (let cy = 0; cy < gy; cy++) for (let cx = 0; cx < gx; cx++) {
      const x0 = Math.floor(cx * w / gx), x1 = Math.floor((cx + 1) * w / gx) - 1, y0 = Math.floor(cy * h / gy), y1 = Math.floor((cy + 1) * h / gy) - 1; let s = 0, s2 = 0, c = 0, r = 0, g = 0, b = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const o = (y * w + x) * 4, l = data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11; s += l; s2 += l * l; c++; r += data[o]; g += data[o + 1]; b += data[o + 2]; }
      cells.push({ cx, cy, x0, x1, y0, y1, v: s2 / c - (s / c) ** 2, r, g, b, c });
    }
    cells.sort((a, b) => b.v - a.v); const picked = [];
    for (const c of cells) { if (picked.length >= 7) break; if (c.cx === 0 || c.cy === 0 || c.cx === gx - 1 || c.cy === gy - 1) continue; if (picked.some(p => Math.abs(p.cx - c.cx) <= 1 && Math.abs(p.cy - c.cy) <= 1)) continue; picked.push(c); }
    label.fill(-1);
    blobs = picked.map((c, id) => { const rad = Math.min(c.x1 - c.x0, c.y1 - c.y0) / 2, mx = (c.x0 + c.x1) / 2, my = (c.y0 + c.y1) / 2; let area = 0;
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (Math.hypot(x - mx, y - my) <= rad) { label[y * w + x] = id; area++; }
      return { id, area, sx: mx * area, sy: my * area, x0: Math.round(mx - rad), x1: Math.round(mx + rad), y0: Math.round(my - rad), y1: Math.round(my + rad), r: c.r / c.c * area, g: c.g / c.c * area, b: c.b / c.c * area }; });
  }
  // 4. Describe them. The larger ones are hazards, the rest pick-ups.
  const order = new Map(blobs.map((b, i) => [b.id, i])), out = blobs.map((b, i) => {
    const colour = [Math.round(b.r / b.area), Math.round(b.g / b.area), Math.round(b.b / b.area)];
    return { id: i, x: (b.sx / b.area + 0.5) / w, y: (b.sy / b.area + 0.5) / h, x0: b.x0 / w, y0: b.y0 / h, x1: (b.x1 + 1) / w, y1: (b.y1 + 1) / h, area: b.area / n, colour, name: colourName(colour), role: 'hazard' };
  });
  const bigEnough = out.filter(b => b.area >= 0.006).length, hazards = Math.max(Math.min(3, out.length), Math.min(6, bigEnough));
  out.forEach((b, i) => { b.role = i < hazards ? 'hazard' : 'pickup'; });
  const labels = new Int16Array(n).fill(-1); for (let i = 0; i < n; i++) if (label[i] >= 0 && order.has(label[i])) labels[i] = order.get(label[i]);
  return { width: w, height: h, blobs: out, labels, method, families };
}
