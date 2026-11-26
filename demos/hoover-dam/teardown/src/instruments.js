// Canvas instruments for the teardown. Same paper, ink and orange as the rest
// of the page. The hill chart is the efficiency() slice in hydro.js, not a
// surveyed Francis map: that function depends on gate opening only.
import { UNIT_IDS } from '../../src/model/hydro.js';
import { PHASES, hillSamples, A5_INDEX } from './sequence.js';

const INK = '#16181b';
const MUTE = '#8d9196';
const OR = '#ff5a1f';
const PAPER = '#f7f5f1';

export function fit(c) {
  const d = Math.min(2, devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (w < 8 || h < 8) return null;
  const W = Math.round(w * d), H = Math.round(h * d);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

let HILL = null;
function hill() { return HILL || (HILL = hillSamples(60)); }

export function drawHill(c, unit) {
  const f = fit(c); if (!f) return;
  const { g, w, h } = f;
  const pad = { l: 22, r: 8, t: 8, b: 14 };
  const x0 = pad.l, y0 = pad.t, x1 = w - pad.r, y1 = h - pad.b;
  const X = (gate) => x0 + gate * (x1 - x0);
  const Y = (eta) => y1 - (Math.max(0, Math.min(0.96, eta)) / 0.96) * (y1 - y0);
  g.strokeStyle = 'rgba(22,24,27,.1)'; g.lineWidth = 1;
  for (const eta of [0.6, 0.8, 0.9]) {
    g.beginPath(); g.moveTo(x0, Y(eta)); g.lineTo(x1, Y(eta)); g.stroke();
  }
  g.fillStyle = MUTE; g.font = '7px "IBM Plex Mono", ui-monospace, monospace';
  g.textAlign = 'right'; g.fillText('90', x0 - 3, Y(0.9) + 2); g.fillText('60', x0 - 3, Y(0.6) + 2);
  const pts = hill();
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(X(p.gate), Y(p.eta)) : g.moveTo(X(p.gate), Y(p.eta))));
  g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
  const peak = pts.reduce((a, b) => (b.eta > a.eta ? b : a));
  g.strokeStyle = 'rgba(22,24,27,.35)'; g.setLineDash([2, 2]);
  g.beginPath(); g.moveTo(X(peak.gate), y0); g.lineTo(X(peak.gate), y1); g.stroke();
  g.setLineDash([]);
  const gate = unit ? (unit.on ? unit.gate : 0) : 0;
  const eta = unit && unit.eta ? unit.eta : 0;
  g.fillStyle = OR;
  g.beginPath(); g.arc(X(gate), Y(eta), 3.2, 0, 7); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
  g.fillStyle = MUTE; g.textAlign = 'left';
  g.fillText('efficiency vs gate', x0, h - 3);
  g.textAlign = 'right'; g.fillText('peak', x1, h - 3);
}

export function drawTach(c, rpm) {
  const f = fit(c); if (!f) return;
  const { g, w, h } = f;
  const cx = w / 2, cy = h * 0.62, R = Math.min(w, h) * 0.42;
  const a0 = Math.PI * 0.82, a1 = Math.PI * 2.18;
  const ang = (rpm) => a0 + Math.max(0, Math.min(1, rpm / 200)) * (a1 - a0);
  g.strokeStyle = 'rgba(22,24,27,.18)'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
  g.strokeStyle = OR; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, R, a0, ang(Math.max(0, rpm))); g.stroke();
  g.strokeStyle = INK; g.lineWidth = 1;
  for (const mark of [0, 180]) {
    const a = ang(mark);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (R - 1), cy + Math.sin(a) * (R - 1));
    g.lineTo(cx + Math.cos(a) * (R + 3), cy + Math.sin(a) * (R + 3));
    g.stroke();
  }
  const a = ang(rpm || 0);
  g.strokeStyle = OR; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4)); g.stroke();
  g.fillStyle = INK; g.beginPath(); g.arc(cx, cy, 1.6, 0, 7); g.fill();
  g.fillStyle = MUTE; g.font = '6px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = 'center';
  g.fillText('rpm', cx, h - 1);
}

export function chartGeom(w, h) {
  const gutter = 26, top = 2, bottom = 2, rows = 17;
  const inner = h - top - bottom;
  const rh = inner / rows;
  return { gutter, top, rh, rows, plotW: w - gutter - 2 };
}

export function chartHit(c, run, clientX, clientY) {
  const rect = c.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const geom = chartGeom(rect.width, rect.height);
  const unit = Math.max(0, Math.min(16, Math.floor((y - geom.top) / geom.rh)));
  const t = Math.max(0, Math.min(1, (x - geom.gutter) / geom.plotW));
  return { unit, tau: t * run.duration };
}

export function drawSequence(c, run, follow, tau) {
  const f = fit(c); if (!f || !run || !run.sampleCount) return;
  const { g, w, h } = f;
  const geom = chartGeom(w, h);
  g.font = '6px "IBM Plex Mono", ui-monospace, monospace';
  g.textBaseline = 'middle';
  const n = run.sampleCount;
  for (let u = 0; u < 17; u++) {
    const y = geom.top + u * geom.rh;
    const rh = Math.max(1, geom.rh - 1);
    g.fillStyle = u === follow ? INK : MUTE;
    g.textAlign = 'right';
    g.fillText(UNIT_IDS[u], geom.gutter - 3, y + rh / 2);
    let i = 0;
    while (i < n) {
      const p = run.phaseBuf[i * 17 + u];
      let j = i + 1;
      while (j < n && run.phaseBuf[j * 17 + u] === p) j++;
      const x0 = geom.gutter + (run.tauBuf[i] / run.duration) * geom.plotW;
      const x1 = geom.gutter + (run.tauBuf[Math.min(j, n - 1)] / run.duration) * geom.plotW;
      g.fillStyle = PHASES[p].color;
      g.fillRect(x0, y, Math.max(1, x1 - x0), rh);
      i = j;
    }
    if (u === follow) {
      g.strokeStyle = OR; g.lineWidth = 1;
      g.strokeRect(geom.gutter - 0.5, y - 0.5, geom.plotW + 1, rh + 1);
    }
  }
  const x = geom.gutter + (tau / run.duration) * geom.plotW;
  g.strokeStyle = PAPER; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  g.strokeStyle = OR; g.lineWidth = 1.25;
  g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
}

export { A5_INDEX };
