// The eight labs below the 3D stage. Each canvas is drawn from a small model;
// several read the live dam model when "follow" is on.
import { ELEV, FT, TIMELINE, HISTORY, HISTORY_NOTES, QUIZ, SPECS } from '../model/data.js';
import { unitPerformance, efficiency, storageAt, FULL_STORAGE } from '../model/hydro.js';
import { damSection, DAM, damHalfWidthAt, elevToY } from '../scene/util.js';
import { fmt, U, onUnits } from '../ui/units.js';

const $ = (s) => document.querySelector(s);
const C = { ink: '#ede7dc', ink2: '#b4ad9f', ink3: '#7f796e', brass: '#e4a94f', brass2: '#f5cd8a', water: '#5cc8d6', line: 'rgba(236,228,214,0.12)', danger: '#ff6b4f', ok: '#7fd39b', warn: '#f0b44a', conc: '#cfc6b5', rock: '#3d3029' };
const RHO = 1000, G = 9.81;

function fit(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}
const fill = (el) => el.style.setProperty('--p', `${(el.value - el.min) / (el.max - el.min) * 100}%`);
function arrow(g, x0, y0, x1, y1, col, w = 1.5, head = 6) {
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = w;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45)); g.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45)); g.fill();
}
function visible(el) { const r = el.getBoundingClientRect(); return r.bottom > -50 && r.top < window.innerHeight + 50; }

// =============================================================================
// Lab 01: gravity section
function sectionLab(app) {
  const cv = $('#secCanvas');
  const lake = $('#secLake'), base = $('#secBase'), drains = $('#secDrains'), link = $('#secLink');
  let probe = 0.7; // fraction of water depth
  let drag = false;
  cv.addEventListener('pointerdown', (e) => { drag = true; cv.setPointerCapture(e.pointerId); move(e); });
  cv.addEventListener('pointermove', (e) => { if (drag) move(e); });
  cv.addEventListener('pointerup', () => { drag = false; });
  let geom = null;
  function move(e) { if (!geom) return; const r = cv.getBoundingClientRect(); const y = e.clientY - r.top; probe = Math.max(0, Math.min(1, (y - geom.yWater) / (geom.yBase - geom.yWater))); }
  [lake, base].forEach((el) => el.addEventListener('input', () => { if (el === lake) link.checked = false; }));

  function calc() {
    const lakeEl = +lake.value, k = +base.value;
    const Hd = DAM.crestY;
    const hw = Math.max(0, (lakeEl - ELEV.foundation) * FT);
    const ht = (ELEV.tailwater - ELEV.foundation) * FT;
    const N = 80; let A = 0, Mx = 0;
    const tAt = (y) => DAM.crestT + (damSection(y).t - DAM.crestT) * k;
    const upAt = (y) => damSection(y).up;
    for (let j = 0; j < N; j++) { const y = (j + 0.5) / N * Hd, dy = Hd / N; const t = tAt(y), up = upAt(y); A += t * dy; Mx += t * dy * (up + t / 2); }
    const xc = Mx / A;
    const heel = upAt(0), toe = upAt(0) + tAt(0), B = toe - heel;
    const W = 2400 * G * A;
    const P = 0.5 * RHO * G * hw * hw;
    const Pt = 0.5 * RHO * G * ht * ht;
    // uplift: linear heel -> toe, with drains at 10 % of base reducing pressure to tail + 1/3 difference
    const ph = RHO * G * hw, pt = RHO * G * ht;
    let Uf, Ux;
    if (drains.checked) {
      const xd = 0.1 * B, pd = pt + (ph - pt) / 3;
      const U1 = (ph + pd) / 2 * xd, x1 = heel + xd * (ph + 2 * pd) / (3 * (ph + pd));
      const U2 = (pd + pt) / 2 * (B - xd), x2 = heel + xd + (B - xd) * (pd + 2 * pt) / (3 * (pd + pt));
      Uf = U1 + U2; Ux = (U1 * x1 + U2 * x2) / Uf;
    } else { Uf = (ph + pt) / 2 * B; Ux = heel + B * (ph + 2 * pt) / (3 * (ph + pt)); }
    const mu = 0.65, c = 1.4e6;
    const fsSlide = (mu * (W - Uf) + c * B) / Math.max(1, P - Pt);
    const Mo = P * hw / 3 + Uf * (toe - Ux);
    const Mr = W * (toe - xc) + Pt * ht / 3;
    const fsOver = Mr / Math.max(1, Mo);
    const xR = toe - (Mr - Mo) / Math.max(1, W - Uf); // resultant crossing from heel
    const rel = (xR - heel) / B;
    return { lakeEl, k, hw, ht, A, xc, heel, toe, B, W, P, Uf, Ux, fsSlide, fsOver, rel, tAt, upAt, Hd, ph, pt };
  }

  function draw() {
    if (link.checked && app) { lake.value = Math.round(app.engine.state.lake); }
    [lake, base].forEach(fill);
    $('#secLakeOut').textContent = fmt.elev(+lake.value);
    $('#secBaseOut').textContent = `${fmt.len(DAM.crestT / FT + (660 - 45) * +base.value)} (${Math.round(+base.value * 100)}%)`;
    if (!visible(cv)) return;
    const f = fit(cv); if (!f) return;
    const { g, w, h } = f; const m = calc();
    g.clearRect(0, 0, w, h);
    const sc = Math.min((h - 50) / 235, (w - 40) / 520);
    const ox = w * 0.46, oy = h - 26;
    const X = (z) => ox + z * sc, Y = (y) => oy - y * sc;
    // rock
    g.fillStyle = C.rock; g.fillRect(0, oy, w, h - oy);
    // water upstream
    const wy = elevToY(m.lakeEl);
    g.fillStyle = 'rgba(92,200,214,0.28)'; g.beginPath(); g.moveTo(0, Y(wy)); g.lineTo(X(m.upAt(wy)), Y(wy));
    for (let j = 40; j >= 0; j--) { const y = wy * j / 40; g.lineTo(X(m.upAt(y)), Y(y)); } g.lineTo(0, oy); g.fill();
    g.strokeStyle = C.water; g.beginPath(); g.moveTo(0, Y(wy)); g.lineTo(X(m.upAt(wy)), Y(wy)); g.stroke();
    // tailwater
    g.fillStyle = 'rgba(92,200,214,0.22)'; g.fillRect(X(m.toe) - 30, Y(m.ht), w, m.ht * sc);
    // dam
    g.fillStyle = C.conc; g.beginPath();
    for (let j = 0; j <= 60; j++) { const y = m.Hd * j / 60; const x = X(m.upAt(y)); j ? g.lineTo(x, Y(y)) : g.moveTo(x, Y(y)); }
    for (let j = 60; j >= 0; j--) { const y = m.Hd * j / 60; g.lineTo(X(m.upAt(y) + m.tAt(y)), Y(y)); }
    g.fill();
    // drainage gallery and drains
    if (drains.checked) { g.strokeStyle = 'rgba(40,40,40,.6)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(m.heel + 0.1 * m.B), Y(12)); g.lineTo(X(m.heel + 0.1 * m.B), oy + 18); g.stroke(); g.setLineDash([]); g.fillStyle = '#333'; g.fillRect(X(m.heel + 0.1 * m.B) - 4, Y(12) - 4, 8, 8); }
    // grout curtain
    g.strokeStyle = 'rgba(228,169,79,.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(m.heel + 3), oy); g.lineTo(X(m.heel + 3), oy + 22); g.stroke();
    // hydrostatic pressure arrows on the upstream face
    const maxP = RHO * G * 225;
    for (let i = 1; i <= 12; i++) {
      const y = wy * (1 - i / 12.5), p = RHO * G * (wy - y), L = p / maxP * w * 0.28;
      const x1 = X(m.upAt(y)) - 2;
      arrow(g, x1 - L, Y(y), x1, Y(y), 'rgba(92,200,214,0.9)', 1.3, 5);
    }
    // uplift arrows
    const ph = m.ph, pt = m.pt;
    for (let i = 0; i <= 14; i++) {
      const x = m.heel + m.B * i / 14;
      let p;
      if (drains.checked) { const xd = m.heel + 0.1 * m.B, pd = pt + (ph - pt) / 3; p = x < xd ? ph + (pd - ph) * (x - m.heel) / (0.1 * m.B) : pd + (pt - pd) * (x - xd) / (m.toe - xd); }
      else p = ph + (pt - ph) * (x - m.heel) / m.B;
      const L = p / maxP * 70;
      arrow(g, X(x), oy + 4 + L, X(x), oy + 2, 'rgba(255,107,79,0.75)', 1.1, 4);
    }
    // weight and resultant
    const cy = m.Hd * 0.33;
    arrow(g, X(m.xc), Y(cy), X(m.xc), Y(cy) + 60, C.brass, 2.2, 8);
    g.fillStyle = C.brass; g.font = '600 11px Inter'; g.fillText('weight', X(m.xc) + 6, Y(cy) + 30);
    const xR = m.heel + m.rel * m.B;
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(X(m.heel + m.B / 3), oy); g.lineTo(X(m.heel + m.B / 3), oy - 8); g.moveTo(X(m.heel + 2 * m.B / 3), oy); g.lineTo(X(m.heel + 2 * m.B / 3), oy - 8); g.stroke(); g.setLineDash([]);
    const inThird = m.rel > 1 / 3 && m.rel < 2 / 3;
    g.fillStyle = inThird ? C.ok : C.danger; g.beginPath(); g.arc(X(xR), oy, 5, 0, 7); g.fill();
    g.font = '10px "IBM Plex Mono"'; g.fillText('resultant', X(xR) - 24, oy + 16);
    // probe
    const py = wy * (1 - probe);
    const ppsi = RHO * G * (wy - py) / 6894.76;
    const px = X(m.upAt(py));
    geom = { yWater: Y(wy), yBase: oy };
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(px - 120, Y(py)); g.lineTo(px, Y(py)); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(px, Y(py), 5, 0, 7); g.fill();
    const depthFt = (wy - py) / FT;
    const tonsFt2 = ppsi * 144 / 2000;
    g.fillStyle = 'rgba(10,12,15,.85)'; g.fillRect(px - 250, Y(py) - 40, 128, 50);
    g.fillStyle = C.ink; g.font = '600 13px Inter'; g.fillText(fmt.psi(ppsi), px - 242, Y(py) - 22);
    g.fillStyle = C.ink2; g.font = '10px "IBM Plex Mono"'; g.fillText(`${fmt.len(depthFt)} deep`, px - 242, Y(py) - 8); g.fillText(`≈ ${tonsFt2.toFixed(1)} tons per ft²`, px - 242, Y(py) + 5);
    g.fillStyle = C.ink3; g.fillText('drag the probe up and down the face', 10, 16);
    g.fillText('μ = 0.65, cohesion 1.4 MPa, no arch help', 10, 30);
    const facts = [
      ['Sliding safety (shear-friction)', m.fsSlide.toFixed(2), m.fsSlide >= 3 ? 'good' : m.fsSlide < 1 ? 'bad' : ''],
      ['Overturning safety', m.fsOver.toFixed(2), m.fsOver >= 1.5 ? 'good' : m.fsOver < 1 ? 'bad' : ''],
      ['Resultant from heel', `${Math.round(m.rel * 100)}% of base`, inThird ? 'good' : 'bad'],
      ['Uplift vs weight', `${Math.round(m.Uf / m.W * 100)}%`, ''],
    ];
    $('#secFacts').innerHTML = facts.map(([k, v, cls]) => `<li class="${cls}">${k}<b>${v}</b></li>`).join('');
  }
  return draw;
}

// =============================================================================
// Lab 02: arch plan view
function archLab() {
  const cv = $('#archCanvas');
  const R = $('#archR'), D = $('#archD'), S = $('#archShare');
  return function draw() {
    [R, D, S].forEach(fill);
    const depth = +D.value; // metres below the crest
    const y = Math.max(0, DAM.crestY - depth);
    const half = damHalfWidthAt(y);
    const r = Math.max(+R.value, half + 2);
    const t = damSection(y).t;
    const p = RHO * G * depth; // Pa, full lake at crest level
    const share = +S.value;
    const straight = +R.value >= 880;
    const sigma = straight ? 0 : share * p * r / t; // Pa
    $('#archROut').textContent = straight ? 'straight wall' : fmt.len(r / FT);
    $('#archDOut').textContent = `${fmt.len(depth / FT)} below crest`;
    $('#archShareOut').textContent = straight ? 'none: no curve' : `${Math.round(share * 100)}% arch · ${Math.round((1 - share) * 100)}% cantilever`;
    if (!visible(cv)) return;
    const f = fit(cv); if (!f) return;
    const { g, w, h } = f;
    g.clearRect(0, 0, w, h);
    const sc = Math.min(w / 420, h / 300);
    const cx = w / 2, cy = h * 0.36;
    const X = (x) => cx + x * sc, Z = (z) => cy + z * sc;
    // canyon walls (plan)
    g.fillStyle = C.rock;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(X(-half), 0); g.lineTo(X(-half), h); g.lineTo(0, h); g.fill();
    g.beginPath(); g.moveTo(w, 0); g.lineTo(X(half), 0); g.lineTo(X(half), h); g.lineTo(w, h); g.fill();
    // lake upstream (top). Arch centre of curvature sits downstream.
    const phiM = straight ? 0 : Math.asin(half / r);
    const sag = straight ? 0 : r - r * Math.cos(phiM);
    const P = (u) => { // u in [-1, 1] across the span; returns upstream-face point and inward normal
      if (straight) return { x: u * half, z: 0, nx: 0, nz: 1 };
      const ph = u * phiM;
      return { x: r * Math.sin(ph), z: (r - r * Math.cos(ph)) - sag, nx: -Math.sin(ph), nz: Math.cos(ph) };
    };
    g.fillStyle = 'rgba(92,200,214,0.25)';
    g.beginPath(); g.moveTo(X(-half), 0); g.lineTo(X(half), 0);
    for (let i = 20; i >= -20; i--) { const q = P(i / 20); g.lineTo(X(q.x), Z(q.z)); }
    g.closePath(); g.fill();
    // arch ring coloured by stress
    const fc = 20e6; // typical mass concrete strength
    const ratio = sigma / fc;
    const col = ratio < 0.25 ? C.ok : ratio < 0.5 ? C.warn : C.danger;
    g.fillStyle = straight ? '#9a9283' : col; g.globalAlpha = 0.8;
    g.beginPath();
    for (let i = -30; i <= 30; i++) { const q = P(i / 30); i === -30 ? g.moveTo(X(q.x), Z(q.z)) : g.lineTo(X(q.x), Z(q.z)); }
    for (let i = 30; i >= -30; i--) { const q = P(i / 30); g.lineTo(X(q.x + q.nx * t), Z(q.z + q.nz * t)); }
    g.closePath(); g.fill(); g.globalAlpha = 1;
    // water pressure arrows, normal to the face
    for (let i = -6; i <= 6; i++) {
      const q = P(i / 6 * 0.92);
      const L = 18 + p / 2.2e6 * 30;
      arrow(g, X(q.x - q.nx * L / sc), Z(q.z - q.nz * L / sc) - 3, X(q.x), Z(q.z) - 3, 'rgba(92,200,214,.9)', 1.3, 5);
    }
    // thrust into the abutments, along the arch's tangent
    if (!straight) {
      const thrust = 20 + share * 60;
      for (const s of [-1, 1]) {
        const q = P(s); const mx = q.x + q.nx * t / 2, mz = q.z + q.nz * t / 2;
        const tx = s * Math.cos(phiM), tz = Math.sin(phiM);
        arrow(g, X(mx) - tx * thrust * 0.2, Z(mz) - tz * thrust * 0.2, X(mx) + tx * thrust * 0.8, Z(mz) + tz * thrust * 0.8, C.brass, 3, 10);
      }
    } else {
      g.fillStyle = C.ink2; g.font = '12px Inter'; g.textAlign = 'center';
      g.fillText('A straight wall gets no arch action. All of the load goes down into the base by weight.', w / 2, h - 30);
    }
    g.textAlign = 'left';
    g.fillStyle = C.ink3; g.font = '10px "IBM Plex Mono"';
    g.fillText('PLAN VIEW · LAKE ABOVE · RIVER BELOW', 10, 16);
    g.fillStyle = C.ink; g.font = '600 13px Inter';
    const span = 2 * half;
    g.fillText(`Span ${fmt.len(span / FT)} · thickness ${fmt.len(t / FT)} · water pressure ${fmt.psi(p / 6894.76)}`, 10, h - 12);
    if (!straight) {
      g.fillStyle = col; g.font = '700 22px "Big Shoulders Display", sans-serif';
      const sTxt = U.sys === 'imperial' ? `${Math.round(sigma / 6894.76).toLocaleString()} psi` : `${(sigma / 1e6).toFixed(1)} MPa`;
      g.fillText(`Arch squeeze σ ≈ ${sTxt}`, 10, 42);
      g.fillStyle = C.ink2; g.font = '11px Inter';
      g.fillText(`${Math.round(ratio * 100)}% of typical mass-concrete strength (≈ 20 MPa / 2,900 psi)`, 10, 60);
    }
  };
}

// =============================================================================
// Lab 03: Francis turbine
function turbineLab(app) {
  const cv = $('#turbCanvas');
  const gate = $('#tbGate'), lake = $('#tbLake'), cut = $('#tbCut');
  let rot = 0, ang = 0, gateAnim = +gate.value;
  const parts = Array.from({ length: 160 }, () => ({ a: Math.random() * 6.28, r: 1, life: Math.random() }));
  let last = performance.now();
  return function draw() {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    [gate, lake].forEach(fill);
    const perf = unitPerformance(+gate.value, +lake.value);
    $('#tbGateOut').textContent = `${Math.round(+gate.value * 100)}%`;
    $('#tbLakeOut').textContent = `${fmt.elev(+lake.value)} · head ${fmt.len(perf.gross)}`;
    if (!visible(cv)) return;
    const f = fit(cv); if (!f) return;
    const { g, w, h } = f;
    g.clearRect(0, 0, w, h);
    gateAnim += (+gate.value - gateAnim) * Math.min(1, dt * 4);
    const running = perf.mw > 0.5;
    const rpm = running ? 180 : 0;
    ang += (rpm / 60) * 6.283 * dt / 10; // shown at 1/10 speed
    const cx = w * 0.32, cy = h * 0.54, R = Math.min(w * 0.25, h * 0.4);
    // spiral case (snail)
    g.save(); g.translate(cx, cy);
    g.fillStyle = '#3b4e5a'; g.strokeStyle = '#6f8fa0'; g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 80; i++) { const a = -Math.PI / 2 + i / 80 * 6.283; const rr = R * (0.72 + 0.28 * (1 - i / 80)); const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath();
    if (cut.checked) { g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1; g.stroke(); } else { g.fill(); g.stroke(); }
    // penstock inlet, tangential at the top of the case
    g.beginPath(); g.moveTo(0.05 * R, -R); g.lineTo(-R * 1.15, -R); g.lineTo(-R * 1.15, -R * 0.74); g.lineTo(-R * 0.3, -R * 0.74); g.closePath();
    if (cut.checked) { g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1; } else g.fill();
    g.stroke();
    g.fillStyle = C.ink3; g.font = '10px "IBM Plex Mono"'; g.fillText('FROM PENSTOCK →', -R * 1.15, -R * 1.06);
    // water particles spiralling in
    const speed = perf.q / 3000;
    for (const p of parts) {
      p.life += dt * (0.25 + speed * 0.8);
      if (p.life > 1 || !running) { p.life = running ? 0 : p.life; p.a = Math.random() * 6.283; }
      const rr = R * (0.85 - p.life * 0.55);
      const a = p.a + p.life * (2.2 - gateAnim * 0.9);
      if (!running) continue;
      g.fillStyle = `rgba(140,220,235,${0.8 - p.life * 0.6})`;
      g.fillRect(Math.cos(a) * rr - 1.5, Math.sin(a) * rr - 1.5, 3, 3);
    }
    // stay vanes (fixed)
    g.strokeStyle = '#9fb3bf'; g.lineWidth = 3;
    for (let i = 0; i < 20; i++) { const a = i / 20 * 6.283; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66); g.lineTo(Math.cos(a + 0.18) * R * 0.58, Math.sin(a + 0.18) * R * 0.58); g.stroke(); }
    // wicket gates: rotate from tangential (closed) to open
    g.strokeStyle = C.brass; g.lineWidth = 4;
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * 6.283; const px = Math.cos(a) * R * 0.5, py = Math.sin(a) * R * 0.5;
      const t = a + Math.PI / 2 - gateAnim * 1.0; const L = R * 0.075;
      g.beginPath(); g.moveTo(px - Math.cos(t) * L, py - Math.sin(t) * L); g.lineTo(px + Math.cos(t) * L, py + Math.sin(t) * L); g.stroke();
    }
    // runner
    g.save(); g.rotate(ang);
    g.fillStyle = '#c9ccd0'; g.beginPath(); g.arc(0, 0, R * 0.38, 0, 7); g.fill();
    g.strokeStyle = '#6a6f75'; g.lineWidth = 2.5;
    for (let i = 0; i < 15; i++) { const a = i / 15 * 6.283; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.1, Math.sin(a) * R * 0.1); g.quadraticCurveTo(Math.cos(a + 0.4) * R * 0.28, Math.sin(a + 0.4) * R * 0.28, Math.cos(a + 0.75) * R * 0.37, Math.sin(a + 0.75) * R * 0.37); g.stroke(); }
    g.fillStyle = '#222'; g.beginPath(); g.arc(0, 0, R * 0.08, 0, 7); g.fill();
    g.restore();
    g.restore();
    // labels with leaders
    g.font = '10px "IBM Plex Mono"'; g.fillStyle = C.ink2; g.strokeStyle = 'rgba(245,205,138,.6)'; g.lineWidth = 1;
    const lab = (txt, x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.fillText(txt, x1 + 4, y1 + 3); };
    lab('SPIRAL CASE', cx + R * 0.62, cy - R * 0.6, cx + R * 0.95, cy - R * 0.95);
    lab('STAY VANES', cx - R * 0.62, cy + R * 0.1, cx - R * 1.05, cy + R * 0.55);
    lab('WICKET GATES', cx + R * 0.36, cy + R * 0.36, cx + R * 0.5, cy + R * 0.95);
    lab('RUNNER', cx, cy, cx - R * 0.35, cy + R * 1.02);
    // readout panel
    const x0 = w * 0.73, y0 = 24;
    const row = (k, v, y, big) => { g.fillStyle = C.ink3; g.font = '10px "IBM Plex Mono"'; g.fillText(k, x0, y); g.fillStyle = big ? C.brass : C.ink; g.font = big ? '800 34px "Big Shoulders Display", sans-serif' : '600 15px Inter'; g.fillText(v, x0, y + (big ? 32 : 18)); };
    row('POWER', perf.tripped ? 'TRIPPED' : `${perf.mw.toFixed(1)} MW`, y0, true);
    row('FLOW', fmt.flow(perf.q), y0 + 58);
    row('NET HEAD', fmt.len(perf.hnet), y0 + 96);
    row('EFFICIENCY', perf.eta ? `${(perf.eta * 100).toFixed(1)}%` : '—', y0 + 134);
    row('SPEED · FREQUENCY', running ? '180 rpm · 60 Hz · 40 poles' : 'stopped', y0 + 172);
    // efficiency curve
    const gx = x0, gy = h - 18, gw = w - x0 - 14, gh = Math.min(70, h - y0 - 230);
    if (gh > 30) {
      g.strokeStyle = C.line; g.strokeRect(gx, gy - gh, gw, gh);
      g.strokeStyle = C.water; g.lineWidth = 1.5; g.beginPath();
      for (let i = 0; i <= 40; i++) { const gt = i / 40, e = efficiency(gt); const x = gx + gt * gw, y = gy - (e - 0.5) / 0.5 * gh; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      const e = efficiency(+gate.value);
      g.fillStyle = C.brass; g.beginPath(); g.arc(gx + +gate.value * gw, gy - (Math.max(0.5, e) - 0.5) / 0.5 * gh, 4, 0, 7); g.fill();
      g.fillStyle = C.ink3; g.font = '9px "IBM Plex Mono"'; g.fillText('EFFICIENCY vs GATE', gx, gy - gh - 4);
    }
    if (perf.tripped) { g.fillStyle = C.danger; g.font = '600 12px Inter'; g.fillText('Below minimum power pool: unit tripped', 12, h - 12); }
  };
}

// =============================================================================
// Lab 04: concrete cooling
function coolingLab() {
  const cv = $('#coolCanvas');
  const S = $('#coolS'), pipes = $('#coolPipes'), chill = $('#coolChill');
  let hoverT = null;
  cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); hoverT = (e.clientX - r.left) / r.width; });
  cv.addEventListener('pointerleave', () => { hoverT = null; });
  const alphaYr = 26; // m²/yr thermal diffusivity of mass concrete (≈ 0.003 m²/h)
  return function draw() {
    fill(S);
    const s = +S.value * FT;
    $('#coolSOut').textContent = fmt.len(+S.value, 1);
    const tPeak = 115, tPlace = 70, tFinal = chill.checked && pipes.checked ? 40 : pipes.checked ? 60 : 65; // °F
    const tauPipe = (s * s) / (Math.PI * Math.PI * alphaYr) * 6 * (chill.checked ? 0.7 : 1); // pipe heat exchange is slower than pure conduction
    const tauBlock = (100 * 100) / (Math.PI * Math.PI * alphaYr);
    const tau = pipes.checked ? tauPipe : tauBlock;
    const temp = (yr, tt, tf) => { const rise = 1 - Math.exp(-yr * 365 / 3); return tf + (tPlace - tf + (tPeak - tPlace) * rise) * Math.exp(-yr / tt); };
    // time to reach within 5 °F of final
    let tDone = 0; for (let y = 0.001; y < 400; y *= 1.02) { if (temp(y, tau, tFinal) < tFinal + 5) { tDone = y; break; } tDone = y; }
    if (!visible(cv)) return;
    const f = fit(cv); if (!f) return;
    const { g, w, h } = f; g.clearRect(0, 0, w, h);
    // block diagram on the left
    const bw = Math.min(w * 0.3, h * 0.7), bx = 16, by = 40 + (h - 40 - bw) / 2;
    const n = Math.max(1, Math.round(15.24 / s));
    const tNow = hoverT != null ? Math.pow(10, -2.5 + Math.max(0, (hoverT * w - bw - 50) / (w - bw - 70)) * 4.8) : tDone * 0.3;
    const heat = (x, y) => {
      if (!pipes.checked) return (temp(tNow, tauBlock, tFinal) - tFinal) / (tPeak - tFinal);
      const px = (x % (1 / n)) * n - 0.5, py = (y % (1 / n)) * n - 0.5; const d = Math.hypot(px, py) * 2;
      return Math.min(1, (temp(tNow, tau, tFinal) - tFinal) / (tPeak - tFinal) * (0.4 + 0.9 * d));
    };
    const cells = 36;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const v = Math.max(0, Math.min(1, heat(i / cells, j / cells)));
      g.fillStyle = `rgb(${40 + 215 * v | 0},${60 + 80 * v | 0},${120 - 90 * v | 0})`;
      g.fillRect(bx + i * bw / cells, by + j * bw / cells, bw / cells + 0.5, bw / cells + 0.5);
    }
    if (pipes.checked) { g.fillStyle = '#e8f6fa'; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.beginPath(); g.arc(bx + (i + 0.5) * bw / n, by + (j + 0.5) * bw / n, 2.5, 0, 7); g.fill(); } }
    g.strokeStyle = C.line; g.strokeRect(bx, by, bw, bw);
    g.fillStyle = C.ink3; g.font = '9.5px "IBM Plex Mono"'; g.fillText('50 FT COLUMN · SECTION', bx, by - 6);
    g.fillText(`t = ${tNow < 1 ? (tNow * 365).toFixed(0) + ' days' : tNow.toFixed(1) + ' years'}`, bx, by + bw + 14);
    // chart, log time axis 0.003 .. 200 years
    const cx0 = bx + bw + 50, cx1 = w - 14, cy0 = 44, cy1 = h - 34;
    const tx = (yr) => cx0 + (Math.log10(Math.max(0.003, yr)) + 2.5) / 4.8 * (cx1 - cx0);
    const ty = (F) => cy1 - (F - 30) / 95 * (cy1 - cy0);
    g.strokeStyle = C.line;
    for (const [yr, l] of [[1 / 365, '1 d'], [7 / 365, '1 wk'], [30 / 365, '1 mo'], [1, '1 yr'], [10, '10 yr'], [100, '100 yr']]) { g.beginPath(); g.moveTo(tx(yr), cy0); g.lineTo(tx(yr), cy1); g.stroke(); g.fillStyle = C.ink3; g.fillText(l, tx(yr) - 8, cy1 + 14); }
    for (const F of [40, 70, 100]) { g.beginPath(); g.moveTo(cx0, ty(F)); g.lineTo(cx1, ty(F)); g.stroke(); g.fillText(U.sys === 'imperial' ? `${F}°F` : `${Math.round((F - 32) / 1.8)}°C`, cx0 - 34, ty(F) + 3); }
    const curve = (tt, tf, col, dash) => { g.strokeStyle = col; g.lineWidth = 2; g.setLineDash(dash || []); g.beginPath(); for (let i = 0; i <= 200; i++) { const yr = Math.pow(10, -2.5 + i / 200 * 4.8); const x = tx(yr), y = ty(temp(yr, tt, tf)); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.setLineDash([]); };
    curve(tauBlock, 65, 'rgba(255,107,79,.7)', [5, 4]);
    if (pipes.checked) curve(tau, tFinal, C.water);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(tx(tNow), cy0); g.lineTo(tx(tNow), cy1); g.stroke();
    g.fillStyle = C.danger; g.font = '10px "IBM Plex Mono"'; g.fillText('NO PIPES: one solid block', tx(0.4), ty(108));
    g.fillStyle = C.ink; g.font = '700 20px "Big Shoulders Display", sans-serif';
    const doneTxt = tDone < 1 ? `${Math.round(tDone * 365)} days` : `${tDone.toFixed(tDone < 10 ? 1 : 0)} years`;
    g.fillText(`Cooled and ready to grout in ≈ ${doneTxt}`, bx, 24);
  };
}

// =============================================================================
// Lab 05: timeline cards (drive the 3D construction view)
function timelineLab(app) {
  const ol = $('#timeline');
  ol.innerHTML = TIMELINE.map((t) => `<li data-t="${t.t}" tabindex="0"><span class="d">${t.date}</span><b>${t.title}</b><p>${t.body}</p></li>`).join('');
  ol.addEventListener('click', (e) => {
    const li = e.target.closest('li'); if (!li || !app) return;
    app.setMode('build'); app.tab('view');
    const y = $('#year'); y.value = Math.max(+y.min, +li.dataset.t + 0.05); y.dispatchEvent(new Event('input'));
    app.engine.flyTo('overview');
    document.getElementById('stage').scrollIntoView({ behavior: 'smooth' });
  });
  ol.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.click(); });
}

// =============================================================================
// Lab 06: history ledger
function ledgerLab(app) {
  const cv = $('#ledgerCanvas');
  let hx = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); hx = e.clientX - r.left; };
  cv.addEventListener('pointermove', pos);
  cv.addEventListener('pointerleave', () => { hx = null; });
  const lerpH = (yr) => { for (let i = 1; i < HISTORY.length; i++) if (yr <= HISTORY[i][0]) { const [a, ea] = HISTORY[i - 1], [b, eb] = HISTORY[i]; return ea + (eb - ea) * (yr - a) / (b - a); } return HISTORY[HISTORY.length - 1][1]; };
  let geo = null;
  cv.addEventListener('click', (e) => {
    if (!geo || !app) return;
    const r = cv.getBoundingClientRect(); const yr = geo.inv(e.clientX - r.left);
    if (yr < 1936) return;
    app.engine.state.lake = lerpH(yr);
    document.getElementById('stage').scrollIntoView({ behavior: 'smooth' });
    app.engine.flyTo('upstream');
  });
  return function draw() {
    if (!visible(cv)) return;
    const f = fit(cv); if (!f) return;
    const { g, w, h } = f; g.clearRect(0, 0, w, h);
    const x0 = 46, x1 = w - 12, y0 = 18, y1 = h - 26;
    const t0 = 1935, t1 = 2026, e0 = 860, e1 = 1240;
    const X = (t) => x0 + (t - t0) / (t1 - t0) * (x1 - x0), Y = (e) => y1 - (e - e0) / (e1 - e0) * (y1 - y0);
    geo = { inv: (x) => t0 + (x - x0) / (x1 - x0) * (t1 - t0) };
    g.font = '9.5px "IBM Plex Mono"';
    for (const [e, l, col] of [[ELEV.crest, 'TOP OF DAM', C.danger], [ELEV.spillCrest, 'SPILLWAY CREST', C.ink3], [ELEV.minPower, 'MIN POWER POOL', C.warn], [ELEV.deadPool, 'DEAD POOL', C.danger]]) {
      g.strokeStyle = col; g.globalAlpha = 0.5; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x0, Y(e)); g.lineTo(x1, Y(e)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = col; g.fillText(l, x1 - g.measureText(l).width, Y(e) + (e === ELEV.crest ? -3 : 11));
    }
    for (let t = 1940; t <= 2020; t += 10) { g.fillStyle = C.ink3; g.fillText(t, X(t) - 12, y1 + 14); }
    for (const e of [900, 1000, 1100, 1200]) g.fillText(fmt.elevVal(e), 4, Y(e) + 3);
    // area fill
    const grd = g.createLinearGradient(0, y0, 0, y1); grd.addColorStop(0, 'rgba(92,200,214,.45)'); grd.addColorStop(1, 'rgba(92,200,214,.02)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(X(HISTORY[0][0]), y1);
    for (const [t, e] of HISTORY) g.lineTo(X(t), Y(e)); g.lineTo(X(HISTORY[HISTORY.length - 1][0]), y1); g.fill();
    g.strokeStyle = C.water; g.lineWidth = 2; g.beginPath(); HISTORY.forEach(([t, e], i) => (i ? g.lineTo(X(t), Y(e)) : g.moveTo(X(t), Y(e)))); g.stroke();
    for (const n of HISTORY_NOTES) { const e = lerpH(n.t); g.fillStyle = C.brass; g.beginPath(); g.arc(X(n.t), Y(e), 3.5, 0, 7); g.fill(); g.fillStyle = C.ink2; g.fillText(n.label, X(n.t) + 6, Y(e) + (e > 1150 ? 14 : 14)); }
    if (app) { const now = app.engine.state.lake; g.strokeStyle = C.brass; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(x0, Y(now)); g.lineTo(x1, Y(now)); g.stroke(); g.setLineDash([]); g.fillStyle = C.brass; const lt = `LIVE MODEL ${fmt.elev(now)}`; g.fillText(lt, x1 - g.measureText(lt).width - 70, Y(now) - 4); }
    if (hx != null && hx > x0 && hx < x1) {
      const yr = geo.inv(hx), e = lerpH(yr);
      g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.moveTo(hx, y0); g.lineTo(hx, y1); g.stroke();
      g.fillStyle = 'rgba(10,12,15,.9)'; g.fillRect(hx + 8, Y(e) - 34, 150, 40);
      g.fillStyle = C.ink; g.font = '600 12px Inter'; g.fillText(`${Math.floor(yr)} · ≈ ${fmt.elev(e)}`, hx + 14, Y(e) - 18);
      g.fillStyle = C.ink2; g.font = '10px "IBM Plex Mono"'; g.fillText(`≈ ${Math.round(storageAt(e) / FULL_STORAGE * 100)}% full · click to load`, hx + 14, Y(e) - 4);
    }
  };
}

// =============================================================================
// Lab 07: quiz
function quizLab() {
  const el = $('#quiz');
  let i = 0, score = 0; const answered = new Array(QUIZ.length).fill(null);
  function render() {
    const q = QUIZ[i];
    const a = answered[i];
    el.innerHTML = `<div class="qn">Question ${i + 1} of ${QUIZ.length}</div><h4>${q.q}</h4><div class="opts">${q.a.map((t, k) => `<button class="opt ${a != null ? (k === q.c ? 'right' : k === a ? 'wrong' : '') : ''}" data-k="${k}" ${a != null ? 'disabled' : ''}>${t}</button>`).join('')}</div>${a != null ? `<p class="why">${a === q.c ? '✓ Right. ' : '✗ Not quite. '}${q.why}</p>` : ''}<div class="qnav"><button data-nav="-1" ${i === 0 ? 'disabled' : ''}>← Back</button><span class="score">${score} / ${answered.filter((x) => x != null).length} correct</span><button data-nav="1">${i === QUIZ.length - 1 ? 'Start again' : 'Next →'}</button></div>`;
  }
  el.addEventListener('click', (e) => {
    const o = e.target.closest('.opt'); const n = e.target.closest('[data-nav]');
    if (o && answered[i] == null) { answered[i] = +o.dataset.k; if (answered[i] === QUIZ[i].c) score++; render(); }
    if (n) { const d = +n.dataset.nav; if (d > 0 && i === QUIZ.length - 1) { i = 0; score = 0; answered.fill(null); } else i = Math.max(0, Math.min(QUIZ.length - 1, i + d)); render(); }
  });
  render();
}

// =============================================================================
// Lab 08: specs
function specsLab() {
  const el = $('#specs');
  const render = () => { el.innerHTML = SPECS.map((s) => `<div><dt>${s.k}</dt><dd>${s.unit === 'len' ? fmt.len(s.ft, s.ft < 100 ? 1 : 0) : s.v}</dd></div>`).join(''); };
  render(); onUnits(render);
}

export function initLabs(app) {
  const draws = [sectionLab(app), archLab(), turbineLab(app), coolingLab(), ledgerLab(app)];
  timelineLab(app); quizLab(); specsLab();
  // Labs share one animation loop and draw only while on screen.
  const loop = () => { for (const d of draws) d(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
