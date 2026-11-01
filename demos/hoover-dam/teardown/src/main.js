// Hoover Dam teardown: the same reservoir and powerplant model as the field lab,
// shown as a white study model on a turntable. Every panel redraws from the
// model each frame; the tour drives the real buttons with a cursor.
import * as THREE from 'three';
import { Stage, ACCENT } from './stage.js';
import { StudyModel, BOX } from './model3d.js';
import { FrancisUnit } from './francis.js';
import { createState, step, UNIT_IDS } from '../../src/model/hydro.js';
import { ELEV, SCENARIOS } from '../../src/model/data.js';
import { DAM, damSection, elevToY } from '../../src/scene/util.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const stage = new Stage($('#scene'));
const model = new StudyModel(stage);
const unit = new FrancisUnit();
const INSET = { pos: new THREE.Vector3(0, 330, 200), scale: 4.4 };
unit.root.position.copy(INSET.pos); unit.root.scale.setScalar(INSET.scale);
model.root.add(unit.root);
// leader from the magnified unit down to the real A5 in the Arizona wing
const a5 = model.S.ph.gens.find((g) => g.id === 'A5');
const leaderGeo = new THREE.BufferGeometry().setFromPoints([INSET.pos.clone().add(new THREE.Vector3(0, -62, 0)), a5.pos.clone()]);
const leader = new THREE.Line(leaderGeo, new THREE.LineDashedMaterial({ color: 0x1d2024, dashSize: 6, gapSize: 5, transparent: true, opacity: 0.6 }));
leader.computeLineDistances();
model.root.add(leader);
const pad = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 1.2, 64), new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.6, transparent: true, opacity: 0.9 }));
pad.position.copy(INSET.pos).add(new THREE.Vector3(0, -62, 0)); model.root.add(pad);
const insetParts = [unit.root, leader, pad];
const setInset = (v) => insetParts.forEach((o) => { o.visible = v; });
setInset(false);

const st = createState();
st.speed = 1;
let out = step(st, 0);

// ---------------------------------------------------------------------------
// camera views (model frame); the turntable eases back to 0 when a view is chosen
const VIEWS = {
  hero: { pos: [1300, 940, 1350], tgt: [0, 70, -10] },
  front: { pos: [0, 430, 2000], tgt: [0, 100, 40] },
  side: { pos: [-2050, 470, 30], tgt: [0, 100, 30] },
  top: { pos: [0, 2500, 80], tgt: [0, 0, 20] },
  upstream: { pos: [-700, 780, -1700], tgt: [0, 100, -40] },
  unit: { pos: [300, 390, 520], tgt: [0, 345, 200] },
  inside: { pos: [150, 120, 420], tgt: [0, 70, 200] },
};
let fly = null, turnOn = true, turnTo = null;
function flyTo(name, dur = 1.6) {
  const v = VIEWS[name]; if (!v) return;
  turnOn = false; turnTo = 0;
  fly = { t: 0, dur, p0: stage.camera.position.clone(), t0: stage.controls.target.clone(), p1: new THREE.Vector3(...v.pos), t1: new THREE.Vector3(...v.tgt) };
  $$('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === name));
  $('#turnBtn').classList.toggle('on', false);
}

// ---------------------------------------------------------------------------
// controls
function range(id, fn, fmt) {
  const el = $(`#${id}`), o = $(`#${id}Out`);
  const apply = () => { fn(+el.value); el.style.setProperty('--p', `${(el.value - el.min) / (el.max - el.min) * 100}%`); if (o) o.textContent = fmt(+el.value); };
  el.addEventListener('input', apply); apply();
  return { el, set(v) { el.value = v; apply(); } };
}
const rLake = range('lake', (v) => { st.lake = v; }, (v) => `${n0(v)} ft`);
const rInflow = range('inflow', (v) => { st.inflow = v; }, (v) => `${n0(v)} ft³/s`);
const rGate = range('gate', (v) => { st.units.forEach((u) => { u.gate = v; }); }, (v) => `${Math.round(v * 100)}%`);
const rDrum = range('drum', (v) => { st.drum = v; }, (v) => (v > 0.98 ? 'raised' : v < 0.02 ? 'lowered' : `${Math.round(v * 100)}%`));
const order = [7, 8, 6, 9, 5, 10, 4, 11, 3, 12, 2, 13, 1, 14, 0, 15, 16];
const rUnits = range('units', (v) => { st.units.forEach((u) => { u.on = false; }); for (let i = 0; i < v; i++) st.units[order[i]].on = true; if (v > 0) st.units[UNIT_IDS.indexOf('A5')].on = true; }, (v) => `${v} of 17`);
const rSpeed = range('speed', (v) => { st.speed = [0.5, 1, 6, 24, 96][v]; }, (v) => ['½ h/s', '1 h/s', '6 h/s', '1 day/s', '4 days/s'][v]);

function scenario(k) {
  const s = SCENARIOS[k];
  rLake.set(s.lake); rInflow.set(s.inflow); rGate.set(s.gate); rDrum.set(s.drum === 'raised' ? 1 : 0); rUnits.set(s.units);
  rSpeed.set(s.speed > 4 ? 3 : 1);
  $$('[data-scn]').forEach((b) => b.classList.toggle('on', b.dataset.scn === k));
  hist.length = 0;
}
$$('[data-scn]').forEach((b) => b.addEventListener('click', () => scenario(b.dataset.scn)));

// subsystems
const SYS = {
  dam: { label: 'Dam', view: 'front', note: 'Arch-gravity wall: 726 ft high, 45 ft thick at the crest, 660 ft at the base. The curve throws the lake\'s push into the canyon walls; the weight resists the rest.' },
  towers: { label: 'Intake towers', view: 'upstream', note: 'Four 395 ft towers draw water through screened openings at two levels and drop it through cylinder gates into the penstocks.' },
  penstocks: { label: 'Penstocks', view: 'hero', note: '30 ft steel pipes run through tunnels in the rock from the towers to the turbines. The orange tracers are the water, at a speed set by the live flow.' },
  turbine: { label: 'Turbine A5', view: 'unit', note: 'Wicket gates meter water onto a 13-blade Francis runner. One shaft turns a 40-pole generator at 180 rpm: 60 Hz. Gates open, power rises.' },
  powerhouse: { label: 'Powerhouse', view: 'inside', note: 'Two wings at the toe of the dam hold 17 generating units, 8 in Nevada and 9 in Arizona: about 2,080 MW together.' },
  spillways: { label: 'Spillways', view: 'upstream', note: 'Four 100 ft drum gates per side. Lower them and floodwater pours into 50 ft tunnels that bypass the dam. Turns orange when water is spilling.' },
  tunnels: { label: 'Tunnels', view: 'side', note: 'Four diversion tunnels moved the whole river during construction; the outer two now carry spillway water around the dam.' },
};
const sysBar = $('#sys');
for (const [k, s] of Object.entries(SYS)) {
  const b = document.createElement('button'); b.className = 'sysb'; b.dataset.sys = k; b.textContent = s.label;
  b.addEventListener('click', () => pick(k)); sysBar.appendChild(b);
}
let focus = null;
function pick(k) {
  focus = focus === k ? null : k;
  $$('.sysb').forEach((b) => b.classList.toggle('on', b.dataset.sys === focus));
  model.setFocus(focus === 'turbine' ? 'powerhouse' : focus);
  setInset(focus === 'turbine');
  $('#unitPanel').classList.toggle('lit', focus === 'turbine');
  $('#note').textContent = focus ? SYS[focus].note : 'Press a part to open it. Drag to orbit, scroll to zoom. Push the inflow past the turbines and watch the lake climb.';
  $('#noteK').textContent = focus ? SYS[focus].label : 'Teardown';
  if (focus) flyTo(SYS[focus].view);
}

// modes
let exploded = false, unitOpen = false;
$('#explodeBtn').addEventListener('click', () => {
  exploded = !exploded; model.explode(exploded);
  if (focus === 'turbine') { unitOpen = exploded; unit.explode(unitOpen); }
  $('#explodeBtn').classList.toggle('on', exploded);
  $('#explodeBtn').textContent = exploded ? 'Snap together' : 'Take apart';
});
$$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  const m = model.mode === b.dataset.mode ? 'solid' : b.dataset.mode;
  model.setMode(m);
  $$('[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === m));
  if (m === 'cut') flyTo('side');
}));
$$('[data-cam]').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.cam)));
$('#turnBtn').addEventListener('click', () => { turnOn = !turnOn; turnTo = null; $('#turnBtn').classList.toggle('on', turnOn); });
$('#hideBtn').addEventListener('click', () => document.body.classList.toggle('bare'));
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  const k = e.key.toLowerCase();
  if (k === 'h') document.body.classList.toggle('bare');
  if (k === 'e') $('#explodeBtn').click();
  if (k === ' ') { e.preventDefault(); st.paused = !st.paused; }
});

// ---------------------------------------------------------------------------
// callouts with ink leaders
const CALL = [
  { id: 'dam', label: 'Arch-gravity dam', p: [0, 175, 30] },
  { id: 'towers', label: 'Intake towers', p: [-84, 232, -112] },
  { id: 'spillways', label: 'Spillway gates', p: [146, 225, -160] },
  { id: 'powerhouse', label: 'Powerhouse · 17 units', p: [66, 95, 262] },
  { id: 'penstocks', label: 'Penstock', p: [-112, 58, 30] },
  { id: 'lake', label: 'Lake Mead', p: [0, 0, -360] },
  { id: 'turbine', label: 'Unit A5 · ×4.4', p: [INSET.pos.x + 34, INSET.pos.y + 20, INSET.pos.z] },
];
const svg = $('#leaders'), layer = $('#callouts');
const calls = CALL.map((c) => {
  const el = document.createElement('div'); el.className = 'call'; el.innerHTML = `<span>${c.label}</span><b></b>`; layer.appendChild(el);
  const ln = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); svg.appendChild(ln);
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', 3); svg.appendChild(dot);
  return { ...c, el, ln, dot, v: new THREE.Vector3(...c.p) };
});
function anchorWorld(c) {
  const v = c.v.clone();
  if (c.id === 'lake') v.y = elevToY(st.lake);
  if (c.id === 'dam') v.y += 70 * model.e;
  if (c.id === 'towers') v.y += 34 * model.e;
  return v.applyMatrix4(model.root.matrixWorld);
}
function updateCallouts() {
  const r = stage.canvas.getBoundingClientRect();
  for (const c of calls) {
    const show = !document.body.classList.contains('bare') && (c.id === 'turbine' ? focus === 'turbine' : focus !== 'turbine') && model.mode !== 'cut';
    const p = anchorWorld(c).project(stage.camera);
    const x = (p.x * 0.5 + 0.5) * r.width, y = (-p.y * 0.5 + 0.5) * r.height;
    const ok = show && p.z < 1 && x > 20 && x < r.width - 20 && y > 20 && y < r.height - 20;
    c.el.style.display = ok ? '' : 'none'; c.ln.style.display = c.dot.style.display = ok ? '' : 'none';
    if (!ok) continue;
    const side = x > r.width / 2 ? 1 : -1;
    const lx = x + side * 70, ly = y - 46;
    c.el.style.transform = `translate(${side > 0 ? lx + 6 : lx - 6}px, ${ly - 10}px) translateX(${side > 0 ? 0 : -100}%)`;
    c.el.classList.toggle('hot', focus === c.id || (c.id === 'spillways' && out.spillQ > 1) || (c.id === 'turbine'));
    c.ln.setAttribute('points', `${x},${y} ${x + side * 30},${ly} ${lx},${ly}`);
    c.dot.setAttribute('cx', x); c.dot.setAttribute('cy', y);
  }
}

// ---------------------------------------------------------------------------
// live charts and schematic (all from the model)
const hist = [];
function fit(c) {
  const d = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); return { g, w, h };
}
const INKC = '#1d2024', MUTE = '#8b8f94', ACC = '#ff5a1f', H2O = '#3f9fbd';
function drawStrip(c, key, color, unitLabel, lo0, hi0) {
  const { g, w, h } = fit(c);
  if (hist.length < 2) return;
  let lo = lo0 ?? Math.min(...hist.map((p) => p[key])), hi = hi0 ?? Math.max(...hist.map((p) => p[key]));
  if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
  const X = (i) => (i / (hist.length - 1)) * (w - 4) + 2, Y = (v) => h - 16 - (v - lo) / (hi - lo) * (h - 26);
  g.strokeStyle = 'rgba(29,32,36,.08)'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = 6 + i * (h - 22) / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.beginPath(); hist.forEach((p, i) => (i ? g.lineTo(X(i), Y(p[key])) : g.moveTo(X(i), Y(p[key]))));
  g.strokeStyle = color; g.lineWidth = 2; g.stroke();
  g.lineTo(X(hist.length - 1), h - 16); g.lineTo(X(0), h - 16); g.closePath(); g.fillStyle = color + '18'; g.fill();
  const last = hist[hist.length - 1][key];
  g.fillStyle = color; g.beginPath(); g.arc(X(hist.length - 1), Y(last), 3.5, 0, 7); g.fill();
  g.font = '10px "IBM Plex Mono", monospace'; g.fillStyle = MUTE;
  g.fillText(`${n0(hi)} ${unitLabel}`, 4, 14); g.fillText(`${n0(lo)}`, 4, h - 4);
}
function drawSchematic() {
  const c = $('#schem'); const { g, w, h } = fit(c);
  const e0 = 480, e1 = 1260, Y = (el) => h - 8 - (el - e0) / (e1 - e0) * (h - 18), sx = w / 620, X = (m) => (m + 320) * sx;
  g.fillStyle = '#e4ddd1'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, Y(700)); g.lineTo(X(-60), Y(640)); g.lineTo(w, Y(630)); g.lineTo(w, h); g.fill();
  const zUp = DAM.cz - (DAM.R - damSection(elevToY(st.lake)).up);
  g.fillStyle = 'rgba(63,159,189,.28)'; g.fillRect(0, Y(st.lake), X(zUp), Y(640) - Y(st.lake));
  g.strokeStyle = H2O; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, Y(st.lake)); g.lineTo(X(zUp), Y(st.lake)); g.stroke();
  g.fillStyle = 'rgba(63,159,189,.25)'; g.fillRect(X(160), Y(out.tail), w - X(160), Y(630) - Y(out.tail));
  g.fillStyle = '#f4f1ea'; g.strokeStyle = INKC; g.lineWidth = 1; g.beginPath();
  for (let j = 0; j <= 24; j++) { const y = DAM.crestY * j / 24, { up } = damSection(y); const zz = DAM.cz - (DAM.R - up); j ? g.lineTo(X(zz), Y(y / 0.3048 + ELEV.foundation)) : g.moveTo(X(zz), Y(y / 0.3048 + ELEV.foundation)); }
  for (let j = 24; j >= 0; j--) { const y = DAM.crestY * j / 24, { t, up } = damSection(y); g.lineTo(X(DAM.cz - (DAM.R - up) + t), Y(y / 0.3048 + ELEV.foundation)); }
  g.closePath(); g.fill(); g.stroke();
  const flow = out.turbQ > 1;
  g.strokeStyle = flow ? ACC : MUTE; g.lineWidth = 2.5; g.setLineDash(flow ? [6, 5] : []); g.lineDashOffset = -performance.now() / 1000 * (8 + out.turbQ / 1200);
  g.beginPath(); g.moveTo(X(-115), Y(860)); g.bezierCurveTo(X(-40), Y(760), X(80), Y(700), X(175), Y(662)); g.stroke(); g.setLineDash([]);
  g.fillStyle = flow ? ACC : MUTE; g.beginPath(); g.arc(X(178), Y(662), 4, 0, 7); g.fill();
  if (out.spillQ > 1) { g.strokeStyle = H2O; g.setLineDash([4, 4]); g.lineDashOffset = -performance.now() / 60; g.beginPath(); g.moveTo(X(-150), Y(1210)); g.bezierCurveTo(X(-60), Y(1100), X(200), Y(760), X(300), Y(650)); g.stroke(); g.setLineDash([]); }
  const hx = X(250); g.strokeStyle = INKC; g.lineWidth = 1;
  g.beginPath(); g.moveTo(hx, Y(st.lake)); g.lineTo(hx, Y(out.tail)); g.stroke();
  for (const yy of [Y(st.lake), Y(out.tail)]) { g.beginPath(); g.moveTo(hx - 4, yy); g.lineTo(hx + 4, yy); g.stroke(); }
  g.font = '600 11px Inter, sans-serif'; g.fillStyle = INKC; g.fillText(`H = ${n0(out.gross)} ft`, hx + 7, (Y(st.lake) + Y(out.tail)) / 2 + 4);
  g.font = '10px "IBM Plex Mono", monospace'; g.fillStyle = MUTE; g.fillText(`lake ${n0(st.lake)}`, 4, Y(st.lake) - 4); g.fillText(`tail ${n0(out.tail)}`, X(200), Y(out.tail) - 4);
}
function drawUnits() {
  const { g, w, h } = fit($('#bars'));
  const n = st.units.length, bw = (w - 6) / n;
  st.units.forEach((u, i) => {
    const x = 3 + i * bw, bh = (u.mw || 0) / 125 * (h - 18);
    g.fillStyle = 'rgba(29,32,36,.07)'; g.fillRect(x + 1, 2, bw - 3, h - 18);
    g.fillStyle = u.id === 'A5' ? ACC : INKC; g.fillRect(x + 1, h - 16 - bh, bw - 3, bh);
    g.font = '8px "IBM Plex Mono", monospace'; g.fillStyle = u.on ? INKC : MUTE; g.textAlign = 'center'; g.fillText(u.id, x + bw / 2, h - 4);
  });
  g.textAlign = 'left';
}
function drawDial() {
  const { g, w, h } = fit($('#dial'));
  const u = st.units[UNIT_IDS.indexOf('A5')];
  const cx = h / 2 + 4, cy = h / 2, R = h / 2 - 6;
  g.strokeStyle = 'rgba(29,32,36,.15)'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
  g.strokeStyle = ACC; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * (u.on ? u.gate : 0))); g.stroke();
  g.fillStyle = INKC; g.font = '600 15px Inter'; g.textAlign = 'center'; g.fillText(`${Math.round((u.on ? u.gate : 0) * 100)}%`, cx, cy + 5);
  g.font = '9px "IBM Plex Mono"'; g.fillStyle = MUTE; g.fillText('GATE', cx, cy + 18); g.textAlign = 'left';
  const x0 = h + 18;
  const row = (k, v, y, big) => { g.fillStyle = MUTE; g.font = '9.5px "IBM Plex Mono"'; g.fillText(k, x0, y); g.fillStyle = big ? ACC : INKC; g.font = big ? '700 22px Inter' : '600 13px Inter'; g.fillText(v, x0, y + (big ? 22 : 16)); };
  row('UNIT A5 OUTPUT', `${(u.mw || 0).toFixed(1)} MW`, 14, true);
  row('FLOW', `${n0(u.q || 0)} ft³/s`, 52);
  row('SPEED', `${Math.round(u.rpm || 0)} rpm · 40 poles`, 85);
  row('EFFICIENCY', u.eta ? `${(u.eta * 100).toFixed(1)}%` : '—', 118);
}

// ---------------------------------------------------------------------------
// tour: drives the real buttons; any input hands control over, 25 s quiet hands it back
const ghost = $('#ghost'), cap = $('#cap');
let touring = false, tourTok = 0, lastInput = performance.now() - 16000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach((t) => addEventListener(t, (e) => { if (!e.isTrusted) return; lastInput = performance.now(); if (touring) stopTour(); }, { capture: true, passive: true }));
function stopTour() { touring = false; tourTok++; ghost.hidden = true; cap.hidden = true; $('#tourBtn').classList.remove('on'); }
async function go(el, tok) {
  if (tok !== tourTok) throw 0;
  const r = el.getBoundingClientRect(); ghost.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px)`;
  await sleep(900); if (tok !== tourTok) throw 0;
}
async function press(sel, tok) { const el = $(sel); await go(el, tok); ghost.classList.remove('tap'); void ghost.offsetWidth; ghost.classList.add('tap'); el.click(); await sleep(300); }
async function drag(id, to, ms, tok) {
  const el = $(`#${id}`), from = +el.value; const r = el.getBoundingClientRect();
  const px = (v) => r.left + (v - el.min) / (el.max - el.min) * r.width;
  ghost.style.transform = `translate(${px(from)}px, ${r.top + r.height / 2}px)`; await sleep(900);
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (tok !== tourTok) throw 0;
    const k = EASE((performance.now() - t0) / ms), v = from + (to - from) * k;
    el.value = v; el.dispatchEvent(new Event('input'));
    ghost.style.transition = 'none'; ghost.style.transform = `translate(${px(v)}px, ${r.top + r.height / 2}px)`;
    await sleep(30);
  }
  ghost.style.transition = '';
}
async function say(t, ms, tok) { if (tok !== tourTok) throw 0; $('#capText').textContent = t; await sleep(ms); if (tok !== tourTok) throw 0; }
async function tour() {
  if (touring) return;
  touring = true; const tok = ++tourTok; ghost.hidden = false; cap.hidden = false; $('#tourBtn').classList.add('on');
  try {
    while (tok === tourTok) {
      if (exploded) $('#explodeBtn').click();
      if (focus) pick(focus);
      if (model.mode !== 'solid') $(`[data-mode="${model.mode}"]`).click();
      scenario('peak');
      turnOn = true; turnTo = null; flyTo('hero', 2); turnOn = true;
      await say('Hoover Dam as a study model. Every gauge reads the same model that moves the parts.', 3200, tok);
      await press('#explodeBtn', tok);
      await say('Take it apart: the canyon slides away and the dam\'s plumbing floats free.', 3600, tok);
      await press('[data-sys="penstocks"]', tok);
      await say('Penstocks: water drops 500 ft through 30 ft steel pipes. The orange is the water, moving at the live flow.', 3800, tok);
      await press('[data-sys="turbine"]', tok);
      await sleep(1200);
      await press('#explodeBtn', tok);
      await press('#explodeBtn', tok);
      await say('Unit A5 opened up: spiral case, stay vanes, wicket gates, runner, shaft, 40-pole generator.', 3200, tok);
      await drag('gate', 0.15, 1800, tok);
      await say('Close the wicket gates and the flow and power fall away.', 2200, tok);
      await drag('gate', 1, 2000, tok);
      await say('Open them: more water on the runner, more megawatts. Speed stays at 180 rpm.', 2600, tok);
      await press('[data-sys="turbine"]', tok);
      if (exploded) await press('#explodeBtn', tok);
      await press('[data-mode="cut"]', tok);
      await say('Cut through the crown: 45 ft thick at the top, 660 ft at the base, galleries inside.', 3400, tok);
      await press('[data-mode="cut"]', tok);
      await press('[data-scn="flood"]', tok);
      await press('[data-cam="upstream"]', tok);
      await drag('inflow', 120000, 1800, tok);
      await say('Break it: push the inflow past what the turbines can pass. The lake climbs.', 2800, tok);
      await drag('drum', 0, 1600, tok);
      await say('Drop the drum gates: the spillways run and turn orange.', 3200, tok);
      await press('[data-scn="normal"]', tok);
      await say('Your turn. Press anything. The tour comes back after 25 seconds of quiet.', 3000, tok);
    }
  } catch (e) { if (e !== 0) console.error(e); }
}
$('#tourBtn').addEventListener('click', () => { if (touring) stopTour(); else setTimeout(tour, 30); });
setInterval(() => { const q = new URLSearchParams(location.search); if (!touring && !q.has('notour') && performance.now() - lastInput > 25000) tour(); }, 1000);

// ---------------------------------------------------------------------------
// loop
const clock = new THREE.Clock();
let t = 0, frame = 0, sample = 0, fpsT = performance.now(), fpsN = 0, low = 0;
function loop() {
  const dt = Math.min(0.05, clock.getDelta()); t += dt; frame++;
  out = step(st, dt);
  if (st.lake > ELEV.crest + 1) { st.lake = ELEV.crest + 1; }
  if (fly) {
    fly.t += dt / fly.dur; const k = fly.t >= 1 ? 1 : EASE(fly.t);
    stage.camera.position.lerpVectors(fly.p0, fly.p1, k); stage.controls.target.lerpVectors(fly.t0, fly.t1, k);
    if (fly.t >= 1) fly = null;
  }
  if (turnOn) stage.pivot.rotation.y += dt * 0.06;
  else if (turnTo !== null) { let r = stage.pivot.rotation.y % (Math.PI * 2); if (r > Math.PI) r -= Math.PI * 2; if (r < -Math.PI) r += Math.PI * 2; stage.pivot.rotation.y = r + (turnTo - r) * Math.min(1, dt * 3); }
  stage.controls.update();
  model.update(st, out, dt, t);
  unit.update(st.units[UNIT_IDS.indexOf('A5')], dt);
  unit.root.rotation.y += dt * 0.15;
  stage.render(dt);

  sample += dt;
  if (sample > 0.25) { sample = 0; hist.push({ mw: out.mw, lake: st.lake }); if (hist.length > 160) hist.shift(); }
  if (frame % 2 === 0) {
    $('#mw').textContent = n0(out.mw);
    $('#mwSub').textContent = `${out.running} of 17 units · head ${n0(out.gross)} ft · ${n0(out.turbQ)} ft³/s`;
    $('#lakeBig').textContent = `${n0(st.lake)} ft`;
    $('#lakeSub').textContent = `${Math.round(out.pct * 100)}% full · ${out.ftPerDay >= 0 ? '+' : '−'}${Math.abs(out.ftPerDay).toFixed(2)} ft/day`;
    $('#spillBig').textContent = out.spillQ > 1 ? `${n0(out.spillQ)} ft³/s` : 'Closed';
    $('#spillPanel').classList.toggle('lit', out.spillQ > 1);
    $('#psiBig').textContent = `${n0(out.basePsi)} psi`;
    const w = out.warn.find((x) => x.tone === 'danger' || x.tone === 'warn');
    $('#warn').textContent = w ? w.text : ''; $('#warn').hidden = !w;
    if (document.activeElement !== $('#lake')) { $('#lake').value = st.lake; $('#lake').style.setProperty('--p', `${(st.lake - 895) / (1240 - 895) * 100}%`); $('#lakeOut').textContent = `${n0(st.lake)} ft`; }
    drawStrip($('#chartMW'), 'mw', ACC, 'MW', 0, 2200);
    drawStrip($('#chartLake'), 'lake', H2O, 'ft');
    drawSchematic(); drawUnits(); drawDial();
    updateCallouts();
  }
  // quality tiers
  fpsN++;
  const now = performance.now();
  if (now - fpsT > 2000) { const fps = fpsN / ((now - fpsT) / 1000); fpsT = now; fpsN = 0; low = fps < 40 ? low + 1 : 0; if (!stage.lock && low >= 2 && t > 5 && stage.quality > 0) { stage.setQuality(stage.quality - 1); low = 0; } }
  requestAnimationFrame(loop);
}

// boot
const q = new URLSearchParams(location.search);
if (q.has('q')) { stage.lock = true; stage.setQuality(+q.get('q')); }
scenario(q.get('scn') && SCENARIOS[q.get('scn')] ? q.get('scn') : 'normal');
if (q.has('explode')) $('#explodeBtn').click();
if (q.get('mode')) $(`[data-mode="${q.get('mode')}"]`)?.click();
if (q.get('focus')) pick(q.get('focus'));
if (q.get('view')) { const v = VIEWS[q.get('view')]; stage.camera.position.set(...v.pos); stage.controls.target.set(...v.tgt); turnOn = false; turnTo = 0; stage.pivot.rotation.y = 0; fly = null; }
if (q.has('bare')) document.body.classList.add('bare');
if (q.has('clean')) document.body.classList.add('bare', 'clean');
if (q.has('pause')) st.paused = true;
if (q.has('notour')) lastInput = Infinity;
stage.renderer.compile(stage.scene, stage.camera);
// first frames: let the explode spring settle instantly for deep links
if (q.has('explode')) { model.e = 1; if (q.get('focus') === 'turbine') { unitOpen = true; unit.explode(true); unit.e = 1; } }
$('#boot').classList.add('done');
requestAnimationFrame(loop);
window.teardown = { stage, model, unit, st, get out() { return out; } };
