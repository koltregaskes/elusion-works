// Live charts that move with the model: the water-path schematic, a lake/flow
// strip chart over simulated time, and per-unit output bars.
import { ELEV } from '../model/data.js';
import { damSection, DAM, elevToY } from '../scene/util.js';
import { fmt, U } from './units.js';

function fit(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}
const C = { ink: '#ede7dc', ink2: '#b4ad9f', ink3: '#7f796e', brass: '#e4a94f', water: '#5cc8d6', line: 'rgba(236,228,214,0.12)', danger: '#ff6b4f', warn: '#f0b44a', rock: '#3a2e26', conc: '#cfc6b5' };

export class Charts {
  constructor(engine) {
    this.e = engine;
    this.schem = document.getElementById('schem');
    this.lakeC = document.getElementById('stripLake');
    this.unitsC = document.getElementById('stripUnits');
    this.hist = [];
    this.lastSample = 0;
    this.flowPhase = 0;
    this.selected = null;
  }

  sample() {
    const st = this.e.state, o = this.e.out;
    const simT = st.day * 24 + st.hour;
    if (this.hist.length && Math.abs(simT - this.hist[this.hist.length - 1].t) < 0.02 && !st.paused) return;
    this.hist.push({ t: simT, lake: st.lake, inQ: st.inflow, outQ: o.totalQ, mw: o.mw });
    if (this.hist.length > 360) this.hist.shift();
  }

  update(dt) {
    this.flowPhase += dt * (0.3 + (this.e.out.turbQ || 0) / 25000);
    this.lastSample += dt;
    if (this.lastSample > 0.15) { this.lastSample = 0; this.sample(); }
    if (this.e.frame % 2) return;
    this.drawSchematic(); this.drawLake(); this.drawUnits();
  }

  drawSchematic() {
    const f = fit(this.schem); if (!f) return;
    const { g, w, h } = f; const st = this.e.state, o = this.e.out;
    g.clearRect(0, 0, w, h);
    // elevation -> y, distance -> x (lake left, river right)
    const e0 = 480, e1 = 1250;
    const Y = (el) => h - 6 - (el - e0) / (e1 - e0) * (h - 14);
    const sx = w / 640;
    const X = (m) => (m + 330) * sx; // metres along river; dam at ~0
    // canyon bed
    g.fillStyle = C.rock; g.beginPath(); g.moveTo(0, h); g.lineTo(0, Y(700)); g.lineTo(X(-60), Y(640)); g.lineTo(X(320), Y(630)); g.lineTo(w, Y(630)); g.lineTo(w, h); g.fill();
    // lake
    g.fillStyle = 'rgba(92,200,214,0.35)';
    const dzUp = DAM.cz - (DAM.R - damSection(elevToY(st.lake)).up);
    g.beginPath(); g.moveTo(0, Y(st.lake)); g.lineTo(X(dzUp), Y(st.lake)); g.lineTo(X(dzUp), Y(640)); g.lineTo(X(-60), Y(640)); g.lineTo(0, Y(700)); g.fill();
    g.strokeStyle = C.water; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, Y(st.lake)); g.lineTo(X(dzUp), Y(st.lake)); g.stroke();
    // tailwater
    g.fillStyle = 'rgba(92,200,214,0.3)'; g.fillRect(X(160), Y(o.tail), w - X(160), Y(630) - Y(o.tail));
    // dam profile from the same section function the 3D uses
    g.fillStyle = C.conc; g.beginPath();
    const N = 24;
    for (let j = 0; j <= N; j++) { const y = DAM.crestY * j / N; const { up } = damSection(y); const z = DAM.cz - (DAM.R - up); const el = y / 0.3048 + ELEV.foundation; j ? g.lineTo(X(z), Y(el)) : g.moveTo(X(z), Y(el)); }
    for (let j = N; j >= 0; j--) { const y = DAM.crestY * j / N; const { t, up } = damSection(y); const z = DAM.cz - (DAM.R - up) + t; const el = y / 0.3048 + ELEV.foundation; g.lineTo(X(z), Y(el)); }
    g.fill();
    // intake tower and penstock path
    g.fillStyle = '#bdb4a3'; g.fillRect(X(-120), Y(1232), 9 * sx, Y(837) - Y(1232));
    const flow = o.turbQ > 1;
    g.strokeStyle = flow ? C.water : C.ink3; g.lineWidth = 3;
    g.setLineDash(flow ? [6, 6] : []); g.lineDashOffset = -this.flowPhase * 40;
    g.beginPath(); g.moveTo(X(-115), Y(860)); g.bezierCurveTo(X(-40), Y(760), X(80), Y(700), X(175), Y(660)); g.stroke();
    g.setLineDash([]);
    // powerhouse + turbine
    g.fillStyle = '#d6cdbd'; g.fillRect(X(160), Y(830), 40 * sx, Y(630) - Y(830));
    g.fillStyle = flow ? C.brass : C.ink3; g.beginPath(); g.arc(X(180), Y(665), 4, 0, 7); g.fill();
    // spill path
    if (o.spillQ > 1) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.setLineDash([4, 5]); g.lineDashOffset = -this.flowPhase * 60; g.beginPath(); g.moveTo(X(-150), Y(1210)); g.bezierCurveTo(X(-60), Y(1100), X(200), Y(760), X(300), Y(650)); g.stroke(); g.setLineDash([]); }
    // head dimension
    const hx = X(250);
    g.strokeStyle = C.brass; g.fillStyle = C.brass; g.lineWidth = 1;
    g.beginPath(); g.moveTo(hx, Y(st.lake)); g.lineTo(hx, Y(o.tail)); g.stroke();
    g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(dzUp), Y(st.lake)); g.lineTo(hx + 6, Y(st.lake)); g.stroke(); g.setLineDash([]);
    for (const yy of [Y(st.lake), Y(o.tail)]) { g.beginPath(); g.moveTo(hx - 4, yy); g.lineTo(hx + 4, yy); g.stroke(); }
    g.font = '600 11px Inter, sans-serif'; g.textAlign = 'left';
    g.fillText(`HEAD ${fmt.len(o.gross || 0)}`, hx + 7, (Y(st.lake) + Y(o.tail)) / 2);
    g.fillStyle = C.ink2; g.font = '10px "IBM Plex Mono", monospace';
    g.fillText(`Lake ${fmt.elev(st.lake)}`, 6, Y(st.lake) - 5);
    g.fillText(`Tail ${fmt.elev(o.tail)}`, X(205), Y(o.tail) - 5);
    // markers
    g.strokeStyle = 'rgba(240,180,74,.5)'; g.setLineDash([3, 4]);
    for (const m of [ELEV.minPower, ELEV.deadPool]) { g.beginPath(); g.moveTo(0, Y(m)); g.lineTo(X(-10), Y(m)); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = C.ink3; g.fillText('min power', 4, Y(ELEV.minPower) - 3); g.fillText('dead pool', 4, Y(ELEV.deadPool) + 10);
  }

  drawLake() {
    const f = fit(this.lakeC); if (!f) return;
    const { g, w, h } = f; const H = this.hist;
    g.clearRect(0, 0, w, h);
    const st = this.e.state;
    document.getElementById('simDate').textContent = `day ${st.day + 1} · ${String(Math.floor(st.hour)).padStart(2, '0')}:${String(Math.floor(st.hour % 1 * 60)).padStart(2, '0')}`;
    if (H.length < 2) return;
    let lo = Infinity, hi = -Infinity, qmax = 1000;
    for (const p of H) { lo = Math.min(lo, p.lake); hi = Math.max(hi, p.lake); qmax = Math.max(qmax, p.inQ, p.outQ); }
    const pad = Math.max(0.5, (hi - lo) * 0.25); lo -= pad; hi += pad;
    const t0 = H[0].t, t1 = H[H.length - 1].t || t0 + 1;
    const X = (t) => 34 + (t - t0) / Math.max(1e-6, t1 - t0) * (w - 40);
    // grid
    g.strokeStyle = C.line; g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const y = 6 + i * (h - 24) / 3; g.beginPath(); g.moveTo(34, y); g.lineTo(w, y); g.stroke(); }
    // flows (right axis, filled)
    const QY = (q) => h - 16 - q / qmax * (h - 24) * 0.9;
    const area = (key, col) => { g.beginPath(); g.moveTo(X(H[0].t), h - 16); for (const p of H) g.lineTo(X(p.t), QY(p[key])); g.lineTo(X(H[H.length - 1].t), h - 16); g.fillStyle = col; g.fill(); };
    area('inQ', 'rgba(127,211,155,0.18)'); area('outQ', 'rgba(228,169,79,0.18)');
    // lake line
    const LY = (e) => 6 + (hi - e) / (hi - lo) * (h - 24);
    g.strokeStyle = C.water; g.lineWidth = 2; g.beginPath();
    H.forEach((p, i) => (i ? g.lineTo(X(p.t), LY(p.lake)) : g.moveTo(X(p.t), LY(p.lake)))); g.stroke();
    g.fillStyle = C.ink3; g.font = '9.5px "IBM Plex Mono", monospace'; g.textAlign = 'right';
    g.fillText(fmt.elevVal(hi, 1), 30, 12); g.fillText(fmt.elevVal(lo, 1), 30, h - 18);
    g.textAlign = 'left';
    g.fillStyle = '#7fd39b'; g.fillText(`IN ${fmt.flowShort(st.inflow)}`, 38, h - 4);
    g.fillStyle = C.brass; g.fillText(`OUT ${fmt.flowShort(this.e.out.totalQ)}`, 38 + 90, h - 4);
    g.fillStyle = C.water; g.fillText(`LAKE ${fmt.rate(this.e.out.ftPerDay)}`, 38 + 186, h - 4);
    const span = t1 - t0;
    g.fillStyle = C.ink3; g.textAlign = 'right'; g.fillText(span > 48 ? `${(span / 24).toFixed(1)} days shown` : `${span.toFixed(1)} h shown`, w - 4, 12);
  }

  drawUnits() {
    const f = fit(this.unitsC); if (!f) return;
    const { g, w, h } = f; const st = this.e.state;
    g.clearRect(0, 0, w, h);
    const n = st.units.length, bw = (w - 8) / n;
    const max = 140;
    g.strokeStyle = C.line;
    for (const v of [50, 100]) { const y = h - 18 - v / max * (h - 30); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.fillStyle = C.ink3; g.font = '9px "IBM Plex Mono", monospace'; g.fillText(v, 2, y - 2); }
    st.units.forEach((u, i) => {
      const x = 4 + i * bw + (i >= 8 ? 4 : 0);
      const bh = (u.mw || 0) / max * (h - 30);
      const grd = g.createLinearGradient(0, h - 18 - bh, 0, h - 18);
      grd.addColorStop(0, u.id === this.selected ? C.water : C.brass); grd.addColorStop(1, 'rgba(228,169,79,0.25)');
      g.fillStyle = grd; g.fillRect(x + 1, h - 18 - bh, bw - 3, bh);
      // efficiency tick
      if (u.mw > 0) { g.fillStyle = '#fff'; g.fillRect(x + 1, h - 18 - u.eta * (h - 30), bw - 3, 1.5); }
      g.fillStyle = u.on ? C.ink : C.ink3; g.font = '8.5px "IBM Plex Mono", monospace'; g.textAlign = 'center';
      g.fillText(u.id, x + bw / 2 - 1, h - 6);
    });
    g.textAlign = 'right'; g.fillStyle = C.ink3; g.fillText('white tick = efficiency', w - 4, 10);
  }
}
