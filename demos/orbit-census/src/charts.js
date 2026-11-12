// Small canvas charts for the console. Each takes the visible set and draws itself.
const INK = 'rgba(214,226,240,0.9)', MUTE = 'rgba(160,176,196,0.55)', HAIR = 'rgba(160,190,220,0.14)';
const FONT = '500 9px "IBM Plex Mono", ui-monospace, monospace';

export function fit(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}

export const ALT = { min: 150, max: 50000 };
export const altX = (alt, x0, x1) => x0 + (Math.log(Math.max(ALT.min, Math.min(ALT.max, alt)) / ALT.min) / Math.log(ALT.max / ALT.min)) * (x1 - x0);
export const xAlt = (x, x0, x1) => ALT.min * Math.pow(ALT.max / ALT.min, (x - x0) / (x1 - x0));

function axisAlt(g, x0, x1, y) {
  g.font = FONT; g.fillStyle = MUTE; g.textAlign = 'center';
  for (const [a, l] of [[200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k'], [35786, 'GEO']]) {
    const x = altX(a, x0, x1);
    g.fillRect(x, y, 1, 3); g.fillText(l, x, y + 12);
  }
}

// Stacked log-altitude histogram with a brushable band.
export function altitudeHist(cv, items, cats, opts) {
  const { g, w, h } = fit(cv);
  const x0 = 6, x1 = w - 6, y0 = 8, y1 = h - 18;
  const B = 110; const bins = Array.from({ length: B }, () => new Map());
  let maxN = 1;
  for (const it of items) {
    const b = Math.max(0, Math.min(B - 1, Math.floor((altX(it.alt, 0, 1)) * B)));
    const m = bins[b]; m.set(it.cat, (m.get(it.cat) || 0) + 1);
  }
  for (const m of bins) { let s = 0; for (const v of m.values()) s += v; if (s > maxN) maxN = s; }
  const yS = (n) => (Math.sqrt(n) / Math.sqrt(maxN)) * (y1 - y0);
  // band
  if (opts.band) {
    const a = altX(opts.band[0], x0, x1), b = altX(opts.band[1], x0, x1);
    g.fillStyle = 'rgba(255,209,102,0.10)'; g.fillRect(a, y0 - 4, b - a, y1 - y0 + 4);
    g.fillStyle = 'rgba(255,209,102,0.8)'; g.fillRect(a, y0 - 4, 1, y1 - y0 + 4); g.fillRect(b, y0 - 4, 1, y1 - y0 + 4);
  }
  g.fillStyle = HAIR; g.fillRect(x0, y1, x1 - x0, 1);
  const bw = (x1 - x0) / B;
  for (let b = 0; b < B; b++) {
    let y = y1; let acc = 0;
    for (const c of cats) {
      const n = bins[b].get(c.id); if (!n) continue;
      const top = y1 - yS(acc + n); g.fillStyle = c.color; g.fillRect(x0 + b * bw + 0.3, top, Math.max(1, bw - 0.6), y - top); y = top; acc += n;
    }
  }
  if (opts.mark != null) {
    const x = altX(opts.mark, x0, x1);
    g.fillStyle = '#fff'; g.fillRect(x - 0.5, y0 - 6, 1, y1 - y0 + 6);
    g.beginPath(); g.moveTo(x - 4, y0 - 8); g.lineTo(x + 4, y0 - 8); g.lineTo(x, y0 - 3); g.fill();
  }
  axisAlt(g, x0, x1, y1 + 1);
  g.textAlign = 'right'; g.fillStyle = MUTE; g.fillText(`peak ${maxN.toLocaleString('en-GB')} per bin`, x1, y0 + 2);
  return { x0, x1 };
}

// Inclination against altitude: the bands that orbits settle into.
export function incAlt(cv, items, colorOf, opts) {
  const { g, w, h } = fit(cv);
  const x0 = 26, x1 = w - 6, y0 = 6, y1 = h - 18;
  g.fillStyle = HAIR; for (const i of [0, 30, 60, 90]) { const y = y1 - i / 110 * (y1 - y0); g.fillRect(x0, y, x1 - x0, 1); }
  g.font = FONT; g.fillStyle = MUTE; g.textAlign = 'right';
  for (const i of [0, 30, 60, 90]) g.fillText(`${i}°`, x0 - 4, y1 - i / 110 * (y1 - y0) + 3);
  for (const it of items) {
    g.fillStyle = colorOf(it); const x = altX(it.mAlt, x0, x1), y = y1 - Math.min(110, it.inc) / 110 * (y1 - y0);
    g.fillRect(x, y, 1.4, 1.4);
  }
  if (opts.mark) { const x = altX(opts.mark.mAlt, x0, x1), y = y1 - opts.mark.inc / 110 * (y1 - y0); g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke(); }
  axisAlt(g, x0, x1, y1 + 1);
}

// Gabbard diagram: apogee and perigee against period. A break-up draws an X.
export function gabbard(cv, items, colorOf, opts) {
  const { g, w, h } = fit(cv);
  const x0 = 30, x1 = w - 6, y0 = 6, y1 = h - 18;
  const sel = items.filter((it) => it.period < 225);
  let pMin = 86, pMax = 130, aMax = 4000;
  if (sel.length) {
    const ps = sel.map((i) => i.period).sort((a, b) => a - b);
    pMin = Math.max(84, ps[Math.floor(ps.length * 0.01)] - 2); pMax = Math.min(225, ps[Math.floor(ps.length * 0.99)] + 2);
    const as = sel.map((i) => i.apo).sort((a, b) => a - b); aMax = Math.min(40000, Math.max(800, as[Math.floor(as.length * 0.99)] * 1.08));
  }
  const X = (p) => x0 + (p - pMin) / (pMax - pMin) * (x1 - x0), Y = (a) => y1 - Math.max(0, a) / aMax * (y1 - y0);
  g.font = FONT; g.fillStyle = MUTE; g.textAlign = 'right';
  const stepA = aMax > 8000 ? 5000 : aMax > 3000 ? 1000 : 500;
  for (let a = 0; a <= aMax; a += stepA) { g.fillStyle = HAIR; g.fillRect(x0, Y(a), x1 - x0, 1); g.fillStyle = MUTE; g.fillText(a >= 1000 ? `${a / 1000}k` : `${a}`, x0 - 4, Y(a) + 3); }
  g.textAlign = 'center';
  const stepP = (pMax - pMin) > 60 ? 20 : (pMax - pMin) > 25 ? 10 : 5;
  for (let p = Math.ceil(pMin / stepP) * stepP; p <= pMax; p += stepP) { g.fillStyle = MUTE; g.fillText(`${p}m`, X(p), y1 + 12); g.fillRect(X(p), y1, 1, 3); }
  for (const it of sel) {
    const c = colorOf(it); const x = X(it.period);
    if (x < x0 || x > x1) continue;
    g.fillStyle = c; g.fillRect(x, Y(it.apo), 1.5, 1.5);
    g.globalAlpha = 0.45; g.fillRect(x, Y(it.peri), 1.5, 1.5); g.globalAlpha = 1;
  }
  if (opts.mark && opts.mark.period < 225) { const x = X(opts.mark.period); g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(x, Y(opts.mark.apo)); g.lineTo(x, Y(opts.mark.peri)); g.stroke(); }
  g.textAlign = 'left'; g.fillStyle = MUTE; g.fillText('apogee ● perigee ○ · period', x0 + 4, y0 + 8);
}

// Launch year, stacked by category.
export function launches(cv, items, cats) {
  const { g, w, h } = fit(cv);
  const x0 = 6, x1 = w - 6, y0 = 10, y1 = h - 18;
  const Y0 = 1957, Y1 = new Date().getUTCFullYear();
  const n = Y1 - Y0 + 1; const bins = Array.from({ length: n }, () => new Map());
  for (const it of items) { if (!it.year) continue; const b = it.year - Y0; if (b < 0 || b >= n) continue; bins[b].set(it.cat, (bins[b].get(it.cat) || 0) + 1); }
  let maxN = 1; for (const m of bins) { let s = 0; for (const v of m.values()) s += v; maxN = Math.max(maxN, s); }
  const bw = (x1 - x0) / n;
  for (let b = 0; b < n; b++) {
    let acc = 0;
    for (const c of cats) { const v = bins[b].get(c.id); if (!v) continue; const top = y1 - (acc + v) / maxN * (y1 - y0), bot = y1 - acc / maxN * (y1 - y0); g.fillStyle = c.color; g.fillRect(x0 + b * bw + 0.2, top, Math.max(1, bw - 0.4), bot - top); acc += v; }
  }
  g.fillStyle = HAIR; g.fillRect(x0, y1, x1 - x0, 1);
  g.font = FONT; g.fillStyle = MUTE; g.textAlign = 'center';
  for (const y of [1960, 1980, 2000, 2020]) { const x = x0 + (y - Y0 + 0.5) * bw; g.fillRect(x, y1, 1, 3); g.fillText(String(y), x, y1 + 12); }
  g.textAlign = 'right'; g.fillText(`peak ${maxN.toLocaleString('en-GB')} / yr`, x1, y0);
}

export { INK };
