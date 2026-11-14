// Hoover Dam HD-1935 · teardown field simulator.
// One model (the field lab's hydro.js) drives the parts, every card and the film.
// The operation log is a script of operator beats; it plays itself, can be scrubbed,
// and hands control to the visitor on any input (25 s of quiet hands it back).
import * as THREE from 'three';
import { Stage, ACCENT } from '../../../_teardown-kit/stage.js';
import { StudyModel } from './model3d.js';
import { FrancisUnit } from './francis.js';
import { createState, step, UNIT_IDS, thrustMN } from '../../src/model/hydro.js';
import { ELEV, SCENARIOS } from '../../src/model/data.js';
import { DAM, elevToY } from '../../src/scene/util.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const q = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// scene
const stage = new Stage($('#scene'));
const model = new StudyModel(stage);
const unit = new FrancisUnit();
const INSET = { pos: new THREE.Vector3(0, 330, 200), scale: 4.4 };
unit.root.position.copy(INSET.pos); unit.root.scale.setScalar(INSET.scale);
model.root.add(unit.root);
const a5 = model.S.ph.gens.find((g) => g.id === 'A5');
const leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([INSET.pos.clone().add(new THREE.Vector3(0, -62, 0)), a5.pos.clone()]), new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 5, gapSize: 4 }));
leader.computeLineDistances(); model.root.add(leader);
const pad = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 1.2, 64), new THREE.MeshPhysicalMaterial({ color: 0xf6f4f0, roughness: 0.4, clearcoat: 0.5 }));
pad.position.copy(INSET.pos).add(new THREE.Vector3(0, -62, 0)); pad.receiveShadow = true; model.root.add(pad);
const setInset = (v) => [unit.root, leader, pad].forEach((o) => { o.visible = v; });
setInset(false);

const st = createState();
let out = step(st, 0);
const THRUST_MAX = thrustMN(ELEV.crest);

// ---------------------------------------------------------------------------
// state the console and the film both drive
const S = { focus: null, exploded: false, unitOpen: false, look: 'solid', labels: true, turntable: true, flow: true, view: 'hero' };
const VIEWS = {
  hero: { pos: [250, 360, 830], tgt: [0, 105, 50] },
  wide: { pos: [1250, 900, 1300], tgt: [0, 60, -10] },
  front: { pos: [0, 320, 1100], tgt: [0, 110, 40] },
  intake: { pos: [-430, 380, -580], tgt: [-50, 160, -130] },
  penstock: { pos: [560, 340, 330], tgt: [60, 85, 30] },
  unit: { pos: [270, 395, 470], tgt: [0, 360, 200] },
  spill: { pos: [-170, 360, -470], tgt: [120, 200, -150] },
  section: { pos: [-950, 250, 70], tgt: [0, 105, 30] },
  top: { pos: [0, 1600, 90], tgt: [0, 0, 20] },
};
let fly = null, turnTo = null;
function flyTo(name, dur = 1.7, instant = false) {
  const v = VIEWS[name]; if (!v) return;
  S.view = name;
  if (!S.turntable) turnTo = 0;
  if (instant) { stage.camera.position.set(...v.pos); stage.controls.target.set(...v.tgt); fly = null; return; }
  fly = { t: 0, dur, p0: stage.camera.position.clone(), t0: stage.controls.target.clone(), p1: new THREE.Vector3(...v.pos), t1: new THREE.Vector3(...v.tgt) };
}

const ASM = [
  { id: null, label: 'Hero', view: 'hero' },
  { id: 'dam', label: 'Dam', view: 'front' },
  { id: 'towers', label: 'Intake', view: 'intake' },
  { id: 'penstocks', label: 'Penstock', view: 'penstock' },
  { id: 'turbine', label: 'Unit A5', view: 'unit' },
  { id: 'spillways', label: 'Spillway', view: 'spill' },
  { id: 'tunnels', label: 'Tunnels', view: 'wide' },
];
function setFocus(id, view = true, instant = false) {
  S.focus = id;
  model.setFocus(id === 'turbine' ? 'powerhouse' : id);
  setInset(id === 'turbine');
  if (id !== 'turbine' && S.unitOpen) setUnitOpen(false);
  if (view) { const a = ASM.find((x) => x.id === id); flyTo(a ? a.view : 'hero', 1.7, instant); }
  if (id !== null && view) setTurntable(false);
  syncChips();
}
function setExploded(v) { S.exploded = v; model.explode(v); syncChips(); }
function setUnitOpen(v) { S.unitOpen = v; unit.explode(v); }
function setLook(l) { S.look = l; model.setMode(l); syncChips(); }
function setTurntable(v) { S.turntable = v; turnTo = v ? null : 0; syncChips(); }
function setFlow(v) { S.flow = v; model.pen.points.visible = v; model.spillT.points.visible = v; syncChips(); }
function setLabels(v) { S.labels = v; document.body.classList.toggle('nolabels', !v); syncChips(); }

// ---------------------------------------------------------------------------
// controls
function range(id, fn, fmt) {
  const el = $(`#${id}`), o = $(`#${id}Out`);
  const apply = () => { fn(+el.value); el.style.setProperty('--p', `${(el.value - el.min) / (el.max - el.min) * 100}%`); if (o) o.textContent = fmt(+el.value); };
  el.addEventListener('input', apply); apply();
  return { el, set(v) { el.value = v; apply(); } };
}
const order = [7, 8, 6, 9, 5, 10, 4, 11, 3, 12, 2, 13, 1, 14, 0, 15, 16];
const R = {
  lake: range('lake', (v) => { st.lake = v; }, (v) => `${n0(v)} ft`),
  inflow: range('inflow', (v) => { st.inflow = v; }, (v) => `${n0(v)} cfs`),
  gate: range('gate', (v) => { st.units.forEach((u) => { u.gate = v; }); }, (v) => `${Math.round(v * 100)}%`),
  drum: range('drum', (v) => { st.drum = v; }, (v) => (v > 0.98 ? 'raised' : v < 0.02 ? 'lowered' : `${Math.round(v * 100)}%`)),
  units: range('units', (v) => { st.units.forEach((u) => { u.on = false; }); for (let i = 0; i < v; i++) st.units[order[i]].on = true; if (v > 0) st.units[UNIT_IDS.indexOf('A5')].on = true; }, (v) => `${v} / 17`),
};
function scenario(k) {
  const s = SCENARIOS[k];
  R.lake.set(s.lake); R.inflow.set(s.inflow); R.gate.set(s.gate); R.drum.set(s.drum === 'raised' ? 1 : 0); R.units.set(s.units);
  st.speed = s.speed > 4 ? 12 : 1;
  $$('[data-scn]').forEach((b) => b.classList.toggle('on', b.dataset.scn === k));
}
$$('[data-scn]').forEach((b) => b.addEventListener('click', () => scenario(b.dataset.scn)));

// assemblies chips
const asmEl = $('#asm');
for (const a of ASM) {
  const b = document.createElement('button'); b.textContent = a.label; b.dataset.asm = a.id ?? 'hero';
  b.addEventListener('click', () => { if (a.id === null) { setFocus(null, false); flyTo('hero'); } else setFocus(S.focus === a.id ? null : a.id); if (a.id === 'turbine' && S.exploded) setUnitOpen(true); });
  asmEl.appendChild(b);
}
// display toggles
$$('#disp button').forEach((b) => b.addEventListener('click', () => {
  const d = b.dataset.d;
  if (d === 'labels') setLabels(!S.labels);
  if (d === 'exploded') { setExploded(!S.exploded); if (S.focus === 'turbine') setUnitOpen(S.exploded); }
  if (d === 'turntable') setTurntable(!S.turntable);
  if (d === 'glass') setLook(S.look === 'glass' ? 'solid' : 'glass');
  if (d === 'cut') { setLook(S.look === 'cut' ? 'solid' : 'cut'); if (S.look === 'cut') flyTo('section'); }
  if (d === 'flow') setFlow(!S.flow);
}));
function syncChips() {
  $$('#asm button').forEach((b) => b.classList.toggle('on', (b.dataset.asm === 'hero' && S.focus === null) || b.dataset.asm === S.focus));
  const on = { labels: S.labels, exploded: S.exploded, turntable: S.turntable, glass: S.look === 'glass', cut: S.look === 'cut', flow: S.flow };
  $$('#disp button').forEach((b) => b.classList.toggle('on', !!on[b.dataset.d]));
  $('#frameR').textContent = `Isolate · ${S.focus ? ASM.find((a) => a.id === S.focus).label : 'Hero'}`;
}

// subsystems list
const SYS = [
  { id: 'towers', name: 'Intake towers', sub: '4 towers · cylinder gates' },
  { id: 'penstocks', name: 'Penstocks', sub: '30 ft steel · 4 lines' },
  { id: 'turbine', name: 'Unit A5', sub: 'Francis · 40-pole rotor' },
  { id: 'powerhouse', name: 'Powerhouse', sub: '17 units · 2 wings' },
  { id: 'spillways', name: 'Spillways', sub: '8 drum gates · 100 × 16 ft' },
  { id: 'dam', name: 'Dam body', sub: 'Arch-gravity · 726 ft' },
  { id: 'tunnels', name: 'Tunnels', sub: '4 diversion · 50 ft' },
];
const sysEl = $('#sysList');
const sysRows = SYS.map((s, i) => {
  const li = document.createElement('li');
  li.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span><div><b>${s.name}</b><small>${s.sub}</small></div><em class="pill"></em>`;
  const target = s.id === 'powerhouse' ? 'turbine' : s.id;
  li.addEventListener('click', () => setFocus(S.focus === target ? null : target));
  sysEl.appendChild(li);
  return { ...s, li, pill: li.querySelector('.pill') };
});
function sysStatus(s) {
  if (S.exploded && ['towers', 'spillways', 'dam', 'powerhouse'].includes(s.id)) return ['Detached', 'or'];
  const a5u = st.units[UNIT_IDS.indexOf('A5')];
  switch (s.id) {
    case 'towers': return out.turbQ > 1 ? ['Drawing', ''] : ['Closed', 'gr'];
    case 'penstocks': return out.turbQ > 1 ? ['Flowing', ''] : ['Dry', 'gr'];
    case 'turbine': return S.unitOpen ? ['Open', 'or'] : a5u.mw > 0.5 ? ['Generating', ''] : ['Stopped', 'gr'];
    case 'powerhouse': return [`${out.running} / 17`, 'ink'];
    case 'spillways': return out.spillQ > 1 ? ['Spilling', 'or'] : [st.drum > 0.98 ? 'Raised' : 'Lowered', 'gr'];
    case 'dam': return st.lake >= ELEV.crest ? ['Overtopping', 'or'] : ['Holding', ''];
    case 'tunnels': return out.spillQ > 1 ? ['Carrying', ''] : ['Dry', 'gr'];
  }
  return ['—', 'gr'];
}

// unit bars
const ub = $('#ubars');
const ubRows = UNIT_IDS.map((id) => { const r = document.createElement('div'); r.className = 'ub'; r.innerHTML = `<span>${id}</span><i></i><em>0</em>`; ub.appendChild(r); return { id, r, bar: r.querySelector('i'), v: r.querySelector('em') }; });

// load meter cells and crosses
const cells = $('#loadCells'); for (let i = 0; i < 40; i++) cells.appendChild(document.createElement('i'));
$('.crosses').innerHTML = Array.from({ length: 28 }, () => '<span>+</span>').join('');

// ---------------------------------------------------------------------------
// charts
const hist = [];
function fit(c) {
  const d = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (w < 8 || h < 8) return null; // hidden (clean mode or a narrow screen)
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); return { g, w, h };
}
const OR = '#ff5a1f', INKC = '#16181b', MUTE = '#8d9196';
function drawLine(c, key, lo, hi, color, guide) {
  const f = fit(c); if (!f) return;
  const { g, w, h } = f;
  g.strokeStyle = 'rgba(22,24,27,.08)'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = i * h / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  if (guide !== undefined) { const y = h - 4 - (guide - lo) / (hi - lo) * (h - 8); g.setLineDash([2, 3]); g.strokeStyle = 'rgba(22,24,27,.35)'; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.setLineDash([]); }
  if (hist.length < 2) return;
  const X = (i) => i / (hist.length - 1) * w, Y = (v) => h - 4 - Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * (h - 8);
  g.beginPath(); hist.forEach((p, i) => (i ? g.lineTo(X(i), Y(p[key])) : g.moveTo(X(i), Y(p[key]))));
  g.strokeStyle = color; g.lineWidth = 1.6; g.stroke();
  const L = hist[hist.length - 1][key];
  g.fillStyle = color; g.beginPath(); g.arc(w - 2, Y(L), 2.6, 0, 7); g.fill();
}
function drawGate() {
  const f = fit($('#cvGate')); if (!f) return;
  const { g, w, h } = f;
  const cx = w / 2, cy = h / 2, R0 = Math.min(w, h) / 2 - 3;
  const u = st.units[UNIT_IDS.indexOf('A5')];
  const gate = u.on ? u.gate : 0;
  g.fillStyle = '#efece6'; g.beginPath(); g.arc(cx, cy, R0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(22,24,27,.35)'; g.lineWidth = 1; g.stroke();
  for (let i = 0; i < 24; i++) { // 24 wicket gates, turned to the live opening
    const a = i / 24 * Math.PI * 2, r = R0 * 0.62, px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    const t = a + Math.PI / 2 - gate * 0.95, L = R0 * 0.16;
    g.strokeStyle = OR; g.lineWidth = 2; g.beginPath(); g.moveTo(px - Math.cos(t) * L, py - Math.sin(t) * L); g.lineTo(px + Math.cos(t) * L, py + Math.sin(t) * L); g.stroke();
  }
  g.fillStyle = INKC; g.beginPath(); g.arc(cx, cy, R0 * 0.28, 0, 7); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 1.2;
  const rot = (performance.now() / 1000) * (u.rpm || 0) / 60 * Math.PI * 2 / 12;
  for (let i = 0; i < 6; i++) { const a = rot + i / 6 * Math.PI * 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R0 * 0.26, cy + Math.sin(a) * R0 * 0.26); g.stroke(); }
}

// ---------------------------------------------------------------------------
// drafting overlay: orbit circles, dashed arcs, nodes and a crosshair around the subject
const SVGNS = 'http://www.w3.org/2000/svg';
const draft = $('#draft');
const el = (tag, cls, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); if (cls) e.setAttribute('class', cls); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); draft.appendChild(e); return e; };
const D = {
  c1: el('circle', 'c'), c2: el('circle', 'c'), c3: el('circle', 'd'),
  arc: el('path', 'd'), arc2: el('path', 'c'),
  v: el('line', 'd'), h: el('line', 'd'), diag: el('line', 'd'),
  frame: el('rect', 'd', { rx: 0 }),
  cross: [el('line', 'x'), el('line', 'x')],
  nodes: Array.from({ length: 6 }, (_, i) => el('circle', i % 3 === 0 ? 'nf' : 'n', { r: i % 3 === 0 ? 2.5 : 5 })),
  ring: el('circle', 'c', { r: 13, 'stroke-width': 4, style: 'stroke: rgba(22,24,27,.22)' }),
};
const center = new THREE.Vector3();
function drawDraft(t) {
  const W = innerWidth, H = innerHeight;
  // subject centre: the focused assembly, else the dam crest
  const fp = S.focus === 'turbine' ? INSET.pos.clone() : S.focus === 'towers' ? new THREE.Vector3(-88, 180, -140) : S.focus === 'spillways' ? new THREE.Vector3(150, 210, -160) : new THREE.Vector3(0, 120, 40);
  center.copy(fp).applyMatrix4(model.root.matrixWorld).project(stage.camera);
  const cx = (center.x * 0.5 + 0.5) * W, cy = (-center.y * 0.5 + 0.5) * H;
  const sx = cx + (W / 2 - cx) * 0.4, sy = cy + (H / 2 - cy) * 0.4; // pulled toward screen centre
  const r1 = H * 0.36, r2 = H * 0.52, r3 = H * 0.44;
  D.c1.setAttribute('cx', sx); D.c1.setAttribute('cy', sy); D.c1.setAttribute('r', r1);
  D.c2.setAttribute('cx', sx); D.c2.setAttribute('cy', sy); D.c2.setAttribute('r', r2);
  D.c3.setAttribute('cx', sx); D.c3.setAttribute('cy', sy); D.c3.setAttribute('r', r3);
  const a0 = t * 0.12, a1 = a0 + 1.9;
  const P = (r, a) => `${sx + Math.cos(a) * r} ${sy + Math.sin(a) * r}`;
  D.arc.setAttribute('d', `M ${P(r2 * 1.12, a0 + 3.4)} A ${r2 * 1.12} ${r2 * 1.12} 0 0 1 ${P(r2 * 1.12, a0 + 4.6)}`);
  D.arc2.setAttribute('d', `M ${P(r1 * 0.82, -a0)} A ${r1 * 0.82} ${r1 * 0.82} 0 0 1 ${P(r1 * 0.82, -a0 + 1.4)}`);
  D.v.setAttribute('x1', sx); D.v.setAttribute('x2', sx); D.v.setAttribute('y1', sy - r2 * 1.2); D.v.setAttribute('y2', sy + r2 * 1.2);
  D.h.setAttribute('x1', sx - r2 * 1.3); D.h.setAttribute('x2', sx - r1 * 1.05); D.h.setAttribute('y1', sy); D.h.setAttribute('y2', sy);
  D.diag.setAttribute('x1', sx + r1 * 0.7); D.diag.setAttribute('y1', sy - r1 * 0.7); D.diag.setAttribute('x2', sx + r2 * 1.1); D.diag.setAttribute('y2', sy - r2 * 1.1);
  D.frame.setAttribute('x', 228); D.frame.setAttribute('y', 104); D.frame.setAttribute('width', Math.max(0, W - 456)); D.frame.setAttribute('height', Math.max(0, H - 104 - 150));
  const angs = [a0, a0 + 2.1, a1 + 1.7, -a0 * 1.3 + 0.8, -a0 * 1.3 + 3.0, a0 * 0.7 + 4.4];
  const rads = [r2, r2, r3, r1, r1 * 0.82, r2 * 1.12];
  D.nodes.forEach((n, i) => { n.setAttribute('cx', sx + Math.cos(angs[i]) * rads[i]); n.setAttribute('cy', sy + Math.sin(angs[i]) * rads[i]); });
  D.ring.setAttribute('cx', sx + Math.cos(a0 + 4.0) * r3); D.ring.setAttribute('cy', sy + Math.sin(a0 + 4.0) * r3);
  const L = 7;
  D.cross[0].setAttribute('x1', cx - L); D.cross[0].setAttribute('x2', cx + L); D.cross[0].setAttribute('y1', cy); D.cross[0].setAttribute('y2', cy);
  D.cross[1].setAttribute('y1', cy - L); D.cross[1].setAttribute('y2', cy + L); D.cross[1].setAttribute('x1', cx); D.cross[1].setAttribute('x2', cx);
}

// ---------------------------------------------------------------------------
// callouts: orange dot, elbow leader, two-line label; the set follows the focus
const CALLS = {
  hero: [['dam', 'Arch-gravity dam', '726 ft · 3.25M yd³'], ['towers', 'Intake towers', '4 × 395 ft'], ['powerhouse', 'Powerhouse', '17 units · 2,080 MW'], ['spill', 'Spillway', '4 drum gates per side']],
  towers: [['towerTop', 'Clock crown', 'Nevada | Arizona time'], ['towerGate', 'Cylinder gate', '2 intake levels'], ['towers', 'Trash racks', 'screened openings']],
  penstocks: [['pen1', 'Penstock', '30 ft steel · glass'], ['pen2', 'Flange ring', 'every 26 m'], ['powerhouse', 'Header', 'branches to 8–9 units']],
  turbine: [['uGen', 'Generator', '40 poles · 60 Hz'], ['uShaft', 'Shaft', '180 rpm'], ['uWicket', 'Wicket gates', '24 · live opening'], ['uRunner', 'Runner', '13 blades'], ['uCase', 'Spiral case', 'glass · cut away']],
  spillways: [['spill', 'Drum gates', '100 × 16 ft each'], ['spillChan', 'Side channel', 'to the 50 ft shaft'], ['tunnelIn', 'Spillway tunnel', 'around the dam']],
  dam: [['dam', 'Crown cantilever', '45 ft crest · 660 ft base'], ['crest', 'Crest road', 'Nevada | Arizona'], ['damToe', 'Toe', 'into the powerhouse']],
  tunnels: [['tunnelIn', 'Spillway tunnel', '50 ft lined'], ['divert', 'Diversion tunnel', '56 ft bored · 1932']],
};
const ANCH = {
  dam: () => new THREE.Vector3(0, 160 + 70 * model.e, 30), crest: () => new THREE.Vector3(-60, DAM.crestY + 70 * model.e, 20), damToe: () => new THREE.Vector3(0, 60 + 70 * model.e, 150),
  towers: () => new THREE.Vector3(-84, 150 + 34 * model.e, -112), towerTop: () => new THREE.Vector3(-84, 226 + 34 * model.e, -112), towerGate: () => new THREE.Vector3(-94, 123 + 34 * model.e, -172),
  powerhouse: () => new THREE.Vector3(66, 92, 262), spill: () => new THREE.Vector3(146, 222 + 24 * model.e, -150), spillChan: () => new THREE.Vector3(166, 196 + 24 * model.e, -120),
  tunnelIn: () => model.S.curves.spill[1].c.getPointAt(0.55), divert: () => model.S.curves.diversion[1].c.getPointAt(0.5),
  pen1: () => model.S.curves.penstock[2].c.getPointAt(0.45), pen2: () => model.S.curves.penstock[3].c.getPointAt(0.7),
  uGen: () => unit.parts.stator.localToWorld(new THREE.Vector3(7, 12, 0)), uShaft: () => unit.parts.shaft.localToWorld(new THREE.Vector3(0.4, 6.5, 0)),
  uWicket: () => unit.parts.wicket.localToWorld(new THREE.Vector3(2.8, 0, 0)), uRunner: () => unit.parts.runner.localToWorld(new THREE.Vector3(-2.2, 0, 0)),
  uCase: () => unit.parts.spiral.localToWorld(new THREE.Vector3(-5.4, 0, 0)),
};
const svgL = $('#leaders'), layer = $('#callouts');
const pool = Array.from({ length: 6 }, () => {
  const div = document.createElement('div'); div.className = 'call'; div.innerHTML = '<b></b><span></span>'; layer.appendChild(div);
  const pl = document.createElementNS(SVGNS, 'polyline'); const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', 3); svgL.append(pl, dot);
  return { div, pl, dot, sx: null, sy: null };
});
// free band between the side columns (whole width when they are hidden on small screens);
// measured once per resize so the callouts never force a layout pass per frame
let bandCache = null;
addEventListener('resize', () => { bandCache = null; });
// the columns appear after boot and change size with the media queries: re-measure when they do
if (window.ResizeObserver) { const ro = new ResizeObserver(() => { bandCache = null; }); document.querySelectorAll('.col').forEach((c) => ro.observe(c)); }
function bands() {
  if (bandCache) return bandCache;
  const colL = $('.col.left'), colR = $('.col.right'), W = innerWidth;
  // a side column is taller than it is wide; on phones the right column becomes a short strip
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > r.width ? r : null; };
  const rl = rect(colL), rr = rect(colR);
  bandCache = { LL: rl ? rl.right + 8 : 10, RL: rr ? rr.left - 8 : W - 10 };
  return bandCache;
}
function drawCallouts() {
  const set = S.look === 'cut' ? [] : (CALLS[S.focus === null ? 'hero' : S.focus] || []);
  const W = innerWidth, H = innerHeight;
  // first pass: where each label wants to sit; then push overlapping labels apart vertically
  const want = pool.map((p, i) => {
    const c = set[i]; if (!c) return null;
    let v = ANCH[c[0]](); if (!c[0].startsWith('u')) v = v.applyMatrix4(model.root.matrixWorld);
    const pr = v.project(stage.camera); const x = (pr.x * 0.5 + 0.5) * W, y = (-pr.y * 0.5 + 0.5) * H;
    const side = x > W * 0.52 ? 1 : -1;
    return { x, y, z: pr.z, side, tx: x + side * (90 + (i % 2) * 26), ty: y - 30 - (i % 3) * 8 };
  });
  for (let pass = 0; pass < 5; pass++) for (let a = 0; a < want.length; a++) for (let b = a + 1; b < want.length; b++) {
    const A = want[a], B = want[b]; if (!A || !B || A.side !== B.side) continue;
    if (Math.abs(A.tx - B.tx) < 150 && Math.abs(A.ty - B.ty) < 30) { const d = (30 - Math.abs(A.ty - B.ty)) / 2, s = A.ty <= B.ty ? -1 : 1; A.ty += s * d; B.ty -= s * d; }
  }
  const { LL, RL } = bands();
  pool.forEach((p, i) => {
    const c = set[i];
    if (!c) { p.div.style.display = 'none'; p.pl.style.display = p.dot.style.display = 'none'; p.sx = null; return; }
    const { x, y, ty } = want[i];
    let { side, tx } = want[i];
    const ok = want[i].z < 1 && x > LL && x < RL && y > 100 && y < H - 150;
    p.div.style.display = ok ? '' : 'none'; p.pl.style.display = p.dot.style.display = ok ? '' : 'none';
    if (!ok) return;
    if (p.label !== c[1]) { p.label = c[1]; p.div.querySelector('b').textContent = c[1]; p.div.querySelector('span').textContent = c[2]; p.w = p.div.offsetWidth || 150; }
    // keep the label in the gap between the side columns: flip it, or slide it inward
    if (side > 0 && tx + 8 + p.w > RL) { if (x - 90 - 8 - p.w >= LL) { side = -1; tx = x - 90; } else tx = RL - 8 - p.w; }
    else if (side < 0 && tx - 8 - p.w < LL) { if (x + 90 + 8 + p.w <= RL) { side = 1; tx = x + 90; } else tx = LL + 8 + p.w; }
    p.sx = p.sx === null || p.side !== side ? tx : p.sx + (tx - p.sx) * 0.2; p.sy = p.sy === null ? ty : p.sy + (ty - p.sy) * 0.2; p.side = side;
    p.div.style.transform = `translate(${side > 0 ? p.sx + 8 : p.sx - 8}px, ${p.sy - 9}px) translateX(${side > 0 ? 0 : -100}%)`;
    p.div.style.textAlign = side > 0 ? 'left' : 'right';
    p.pl.setAttribute('points', `${x},${y} ${x + (p.sx - x) * 0.35},${p.sy} ${p.sx},${p.sy}`);
    p.dot.setAttribute('cx', x); p.dot.setAttribute('cy', y);
  });
}

// ---------------------------------------------------------------------------
// operation log: the film
const BEATS = [
  { t: 0, label: 'Wake · generating', mode: 'Generating', target: '#asm [data-asm="hero"]', apply: (i) => { scenario('peak'); setLook('solid'); setExploded(false); setUnitOpen(false); setFocus(null, false); flyTo('hero', 2, i); setTurntable(true); setFlow(true); } },
  { t: 4, label: 'Operator · isolate intake', mode: 'Drawing water', target: '#asm [data-asm="towers"]', apply: (i) => { setFocus('towers', false); setTurntable(false); flyTo('intake', 1.8, i); } },
  { t: 8, label: 'Operator · isolate penstock', mode: 'Penstock flow', target: '#asm [data-asm="penstocks"]', apply: (i) => { setFocus('penstocks', false); setLook('glass'); flyTo('penstock', 1.8, i); } },
  { t: 12, label: 'Operator · open unit A5', mode: 'Unit A5 open', target: '#asm [data-asm="turbine"]', apply: (i) => { setLook('solid'); setFocus('turbine', false); setUnitOpen(true); flyTo('unit', 1.8, i); } },
  { t: 16, label: 'Operator · close wicket gates', mode: 'Gates closing', target: '#cGate', ramp: ['gate', 0.95, 0.15, 2.6], apply: () => {} },
  { t: 19.5, label: 'Operator · full gate', mode: 'Full gate', target: '#cGate', ramp: ['gate', 0.15, 1, 2.4], apply: () => {} },
  { t: 23, label: 'Operator · exploded on', mode: 'Take apart', target: '#disp [data-d="exploded"]', apply: (i) => { setUnitOpen(false); setFocus(null, false); setExploded(true); flyTo('wide', 2, i); } },
  { t: 27, label: 'Operator · flood · drop drum gates', mode: 'Spillway open', target: '#asm [data-asm="spillways"]', ramp: ['drum', 1, 0, 2], apply: (i) => { setExploded(false); scenario('flood'); R.lake.set(1219); setFocus('spillways', false); flyTo('spill', 1.8, i); } },
  { t: 31, label: 'Operator · section through crown', mode: 'Section', target: '#disp [data-d="cut"]', apply: (i) => { setFocus(null, false); setLook('cut'); flyTo('section', 1.8, i); } },
  { t: 34, label: 'Operator · reassemble', mode: 'Reassembly', target: '#disp [data-d="turntable"]', apply: (i) => { setLook('solid'); scenario('peak'); flyTo('hero', 2, i); setTurntable(true); } },
];
const FILM = 38;
const film = { t: 0, playing: !q.has('notour'), idx: -1, lastInput: performance.now() };
const ticks = $('#ticks');
BEATS.forEach((b) => { const i = document.createElement('i'); i.style.left = `${b.t / FILM * 100}%`; ticks.appendChild(i); });
$('#acts').textContent = `${BEATS.length - 1} operator actions`;
const ghost = $('#ghost');
function ghostTap(sel) {
  const e = $(sel); if (!e || document.body.classList.contains('clean')) return;
  const r = e.getBoundingClientRect(); ghost.hidden = false;
  ghost.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px)`;
  setTimeout(() => { ghost.classList.remove('tap'); void ghost.offsetWidth; ghost.classList.add('tap'); }, 820);
}
function beatAt(t) { let k = 0; for (let i = 0; i < BEATS.length; i++) if (BEATS[i].t <= t) k = i; return k; }
function seek(t, instant = true) {
  film.t = Math.max(0, Math.min(FILM - 0.01, t));
  const k = beatAt(film.t);
  // replay every beat up to here so the state is exactly the film's at time t
  // replay each beat and its ramp in order, so a later beat's settings win over an earlier ramp
  for (let i = 0; i <= k; i++) {
    const b = BEATS[i]; b.apply(instant || i < k);
    if (b.ramp) { const [key, a, z, d] = b.ramp; const f = Math.min(1, (film.t - b.t) / d); R[key].set(a + (z - a) * EASE(f)); }
  }
  film.idx = k;
}
function setPlaying(v) { film.playing = v; if (v) film.touched = false; $('#play').classList.toggle('paused', !v); ghost.hidden = !v; $('#status').innerHTML = `<i></i>${v ? 'Operator log' : 'Hands on'}`; }
$('#play').addEventListener('click', () => { if (!film.playing) { if (film.t > FILM - 0.5) film.t = 0; seek(film.t, false); } setPlaying(!film.playing); });
$('#bar').addEventListener('pointerdown', (e) => { const r = $('#bar').getBoundingClientRect(); film.touched = false; seek((e.clientX - r.left) / r.width * FILM, true); });
['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach((tp) => addEventListener(tp, (e) => {
  if (!e.isTrusted) return;
  film.lastInput = performance.now();
  if (!e.target.closest?.('#play, #bar')) film.touched = true;
  if (film.playing && !e.target.closest?.('#play, #bar')) setPlaying(false);
}, { capture: true, passive: true }));
function filmTick(dt) {
  if (!film.playing) {
    if (!q.has('notour') && performance.now() - film.lastInput > 25000) { film.t = 0; film.idx = -1; setPlaying(true); }
    return;
  }
  film.t += dt;
  if (film.t >= FILM) { film.t = 0; film.idx = -1; }
  const k = beatAt(film.t);
  if (k !== film.idx) { film.idx = k; BEATS[k].apply(false); ghostTap(BEATS[k].target); }
  const b = BEATS[k];
  if (b.ramp) { const [key, a, z, d] = b.ramp; const f = Math.min(1, (film.t - b.t) / d); R[key].set(a + (z - a) * EASE(f)); }
}

// ---------------------------------------------------------------------------
// loop
const clock = new THREE.Clock();
let T = 0, frame = 0, sample = 0, fpsT = performance.now(), fpsN = 0, low = 0;
const t0 = performance.now();
function modeLabel() {
  if (film.idx >= 0 && !film.touched) return BEATS[film.idx].mode;
  if (S.look === 'cut') return 'Section';
  if (S.exploded) return 'Take apart';
  if (S.focus === 'turbine') return S.unitOpen ? 'Unit A5 open' : 'Unit A5';
  if (st.lake >= ELEV.crest) return 'Overtopping';
  if (out.spillQ > 1) return 'Spillway open';
  if (S.look === 'glass') return 'Glass';
  return out.mw > 1 ? 'Generating' : 'Idle';
}
function loop() {
  const dt = Math.min(0.05, clock.getDelta()); T += dt; frame++;
  filmTick(dt);
  out = step(st, dt);
  if (st.lake > ELEV.crest + 1) st.lake = ELEV.crest + 1;
  if (fly) { fly.t += dt / fly.dur; const k = fly.t >= 1 ? 1 : EASE(fly.t); stage.camera.position.lerpVectors(fly.p0, fly.p1, k); stage.controls.target.lerpVectors(fly.t0, fly.t1, k); if (fly.t >= 1) fly = null; }
  if (S.turntable) stage.pivot.rotation.y += dt * 0.07;
  else if (turnTo !== null) { let r = stage.pivot.rotation.y % (Math.PI * 2); if (r > Math.PI) r -= Math.PI * 2; if (r < -Math.PI) r += Math.PI * 2; stage.pivot.rotation.y = r + (turnTo - r) * Math.min(1, dt * 3); }
  stage.controls.update();
  model.update(st, out, dt, T);
  unit.update(st.units[UNIT_IDS.indexOf('A5')], dt);
  if (S.focus === 'turbine') unit.root.rotation.y += dt * 0.12;
  stage.render(dt);

  sample += dt;
  if (sample > 0.2) { sample = 0; hist.push({ mw: out.mw, lake: st.lake }); if (hist.length > 140) hist.shift(); }
  if (frame % 2 === 0) {
    $('#mw').textContent = n0(out.mw);
    $('#unitsOn').textContent = `${out.running}/17`;
    $('#homes').textContent = `${n0(Math.round(out.homes / 1000))}k`;
    $('#lakeFt').textContent = n0(st.lake);
    $('#headFt').textContent = n0(out.gross);
    const u5 = st.units[UNIT_IDS.indexOf('A5')];
    $('#aMW').textContent = `${(u5.mw || 0).toFixed(1)} MW`; $('#aGate').textContent = `${Math.round((u5.on ? u5.gate : 0) * 100)}%`;
    $('#aQ').textContent = `${n0(u5.q || 0)} cfs`; $('#aRpm').textContent = `${Math.round(u5.rpm || 0)} rpm`; $('#aEta').textContent = u5.eta ? `${(u5.eta * 100).toFixed(1)}%` : '—';
    ubRows.forEach((r, i) => { const u = st.units[i]; r.bar.style.setProperty('--w', `${Math.min(100, (u.mw || 0) / 122.4 * 100)}%`); r.v.textContent = u.on ? `${Math.round(u.mw || 0)}` : 'off'; r.r.classList.toggle('off', !u.on); r.r.classList.toggle('hot', u.id === 'A5' || (u.mw || 0) > 110); });
    const anyOff = st.units.some((u) => !u.on);
    const pill = $('#unitsPill'); pill.textContent = S.exploded ? 'Detached' : out.running === 17 ? 'All on' : anyOff ? 'Holding' : '—'; pill.className = `pill ${S.exploded ? 'or' : ''}`;
    const pct = Math.max(0, Math.min(1, out.thrust / THRUST_MAX));
    $('#loadPct').textContent = `${Math.round(pct * 100)}%`;
    [...cells.children].forEach((c, i) => { const on = i / 40 < pct; c.className = on ? (i >= 34 ? 'hot' : 'on') : ''; });
    const rt = Math.floor((performance.now() - t0) / 1000);
    $('#runtime').textContent = `${String(Math.floor(rt / 3600)).padStart(2, '0')}:${String(Math.floor(rt / 60) % 60).padStart(2, '0')}:${String(rt % 60).padStart(2, '0')}`;
    const mode = modeLabel();
    if ($('#modeT').textContent !== mode) $('#modeT').textContent = mode;
    $('#modeS').textContent = S.focus === 'turbine' ? `Unit A5 · ${(u5.mw || 0).toFixed(0)} MW · gate ${Math.round((u5.on ? u5.gate : 0) * 100)}%` : out.spillQ > 1 ? `Spill ${n0(out.spillQ)} cfs · lake ${n0(st.lake)} ft` : `Head ${n0(out.gross)} ft · ${out.running} units · ${n0(out.turbQ)} cfs`;
    if (!film.playing) $('#status').innerHTML = `<i></i>${mode}`;
    for (const r of sysRows) { const [txt, cls] = sysStatus(r); r.pill.textContent = txt; r.pill.className = `pill ${cls}`; r.li.classList.toggle('on', S.focus === r.id || (r.id === 'turbine' && S.focus === 'turbine')); }
    // film bar
    const f = film.t / FILM;
    $('#fill').style.width = `${f * 100}%`; $('#knob').style.left = `${f * 100}%`;
    [...ticks.children].forEach((tk, i) => tk.classList.toggle('done', BEATS[i].t <= film.t));
    $('#beatT').textContent = BEATS[Math.max(0, film.idx)].label;
    const s = Math.floor(film.t); $('#clock').textContent = `00:${String(s).padStart(2, '0')} / 00:${FILM}`;
    drawLine($('#cvOut'), 'mw', 0, 2200, OR);
    drawLine($('#cvLake'), 'lake', 895, 1240, INKC, ELEV.fullPool);
    drawGate();
    drawDraft(T);
    drawCallouts();
  }
  fpsN++;
  const now = performance.now();
  if (now - fpsT > 2000) { const fps = fpsN / ((now - fpsT) / 1000); fpsT = now; fpsN = 0; low = fps < 40 ? low + 1 : 0; if (!stage.lock && low >= 2 && T > 5 && stage.quality > 0) { stage.setQuality(stage.quality - 1); low = 0; } }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// boot + deep links: ?t=12 (film time), ?q=0|1|2, ?clean, ?notour, ?pause
if (q.has('q')) { stage.lock = true; stage.setQuality(+q.get('q')); }
if (q.has('clean')) document.body.classList.add('clean');
seek(q.has('t') ? +q.get('t') : 0, true);
if (q.has('t')) { // let springs settle for stills
  model.e = S.exploded ? 1 : 0; unit.e = S.unitOpen ? 1 : 0; stage.pivot.rotation.y = 0;
}
setPlaying(!q.has('notour') && !q.has('pause'));
if (q.has('pause')) { st.paused = true; }
stage.renderer.compile(stage.scene, stage.camera);
$('#boot').classList.add('done');
requestAnimationFrame(loop);
window.teardown = { stage, model, unit, st, S, film, seek, get out() { return out; } };
