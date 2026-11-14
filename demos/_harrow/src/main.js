// HARROW TK-4 · teardown simulator.
// One model (sim.js) drives the legs, the crest, the core glow, every card and the film.
// The operation log is a script of operator beats; it plays itself, can be scrubbed,
// and hands control to the visitor on any input (25 s of quiet hands it back).
import * as THREE from 'three';
import { Stage } from 'kit/stage.js';
import { Machine, GROUND } from './machine.js';
import { createState, step, SPEC, GAITS, LEGS } from './sim.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const q = new URLSearchParams(location.search);
const GAITNAME = { stand: 'Standing', walk: 'Walk', trot: 'Trot', bound: 'Bound' };

// ---------------------------------------------------------------------------
// scene
const stage = new Stage($('#scene'));
stage.controls.minDistance = 140; stage.controls.maxDistance = 2400;
stage.controls.target.set(0, 110, 0);
const m = new Machine(stage);
const st = createState();
let out = step(st, 0);

// ---------------------------------------------------------------------------
// console + film state
const S = { focus: null, exploded: false, look: 'solid', labels: true, turntable: true, prints: true, view: 'hero' };
const VIEWS = {
  hero: { pos: [760, 370, 880], tgt: [20, 104, 0] },
  wide: { pos: [1150, 700, 1300], tgt: [0, 130, 0] },
  head: { pos: [640, 280, 470], tgt: [200, 160, 0] },
  carapace: { pos: [-420, 760, 660], tgt: [0, 140, 0] },
  legs: { pos: [80, 150, 1050], tgt: [0, 70, 0] },
  core: { pos: [430, 360, 720], tgt: [10, 116, 0] },
  cells: { pos: [-260, 260, 820], tgt: [-6, 104, 40] },
  fins: { pos: [-640, 680, 520], tgt: [-20, 170, 0] },
  drill: { pos: [380, 70, 640], tgt: [-14, 46, 0] },
  section: { pos: [40, 260, 1150], tgt: [0, 110, 0] },
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
  { id: 'head', label: 'Head', view: 'head' },
  { id: 'carapace', label: 'Carapace', view: 'carapace' },
  { id: 'legs', label: 'Legs', view: 'legs' },
  { id: 'core', label: 'Core', view: 'core' },
  { id: 'cells', label: 'Cells', view: 'cells' },
  { id: 'fins', label: 'Crest', view: 'fins' },
  { id: 'drill', label: 'Drill', view: 'drill' },
];
function setFocus(id, view = true, instant = false) {
  S.focus = id;
  m.setFocus(id);
  if (view) { const a = ASM.find((x) => x.id === id); flyTo(a ? a.view : 'hero', 1.7, instant); }
  if (id !== null && view) setTurntable(false);
  syncChips();
}
function setExploded(v) { S.exploded = v; m.explode(v); syncChips(); }
function setLook(l) { S.look = l; m.setMode(l); syncChips(); }
function setTurntable(v) { S.turntable = v; turnTo = v ? null : 0; syncChips(); }
function setPrints(v) { S.prints = v; m.printsOn = v; if (!v) m.prints.forEach((p) => { p.m.visible = false; }); m.track.visible = v; syncChips(); }
function setLabels(v) { S.labels = v; document.body.classList.toggle('nolabels', !v); syncChips(); }

// ---------------------------------------------------------------------------
// operator controls
function range(id, fn, fmt) {
  const el = $(`#${id}`), o = $(`#${id}Out`);
  const apply = () => { fn(+el.value); el.style.setProperty('--p', `${(el.value - el.min) / (el.max - el.min) * 100}%`); if (o) o.textContent = fmt(+el.value); };
  el.addEventListener('input', apply); apply();
  return { el, set(v) { el.value = v; apply(); } };
}
const R = {
  spd: range('spdIn', (v) => { st.vSet = v; }, (v) => `${f1(v)} m/s`),
  payload: range('payload', (v) => { st.payload = v; }, (v) => `${v} kg`),
  grade: range('grade', (v) => { st.grade = v; }, (v) => `${v > 0 ? '+' : ''}${v}%`),
};
function setGaitMode(g) { st.gaitMode = g; $$('#gaitSel button').forEach((b) => b.classList.toggle('on', b.dataset.g === g)); }
function setTool(t, v) { st[t] = v; $$('#tog button').forEach((b) => b.classList.toggle('on', !!st[b.dataset.t])); }
$$('#gaitSel button').forEach((b) => b.addEventListener('click', () => setGaitMode(b.dataset.g)));
$$('#tog button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.t, !st[b.dataset.t])));
const SCN = {
  graze: { spd: 0.9, payload: 60, grade: 0, scan: true, drill: false },
  sample: { spd: 0, payload: 60, grade: 0, scan: true, drill: true },
  haul: { spd: 3.2, payload: 260, grade: 0, scan: false, drill: false },
  climb: { spd: 1.4, payload: 260, grade: 18, scan: false, drill: false },
  sprint: { spd: 6, payload: 0, grade: 0, scan: false, drill: false },
};
function scenario(k) {
  const s = SCN[k];
  R.spd.set(s.spd); R.payload.set(s.payload); R.grade.set(s.grade); setTool('scan', s.scan); setTool('drill', s.drill); setGaitMode('auto');
  $$('[data-scn]').forEach((b) => b.classList.toggle('on', b.dataset.scn === k));
}
$$('[data-scn]').forEach((b) => b.addEventListener('click', () => scenario(b.dataset.scn)));

const asmEl = $('#asm');
for (const a of ASM) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = a.label; b.dataset.asm = a.id ?? 'hero';
  b.addEventListener('click', () => { if (a.id === null) { setFocus(null, false); flyTo('hero'); } else setFocus(S.focus === a.id ? null : a.id); });
  asmEl.appendChild(b);
}
$$('#disp button').forEach((b) => b.addEventListener('click', () => {
  const d = b.dataset.d;
  if (d === 'labels') setLabels(!S.labels);
  if (d === 'exploded') { setExploded(!S.exploded); if (S.exploded && S.focus === null) flyTo('wide'); }
  if (d === 'turntable') setTurntable(!S.turntable);
  if (d === 'glass') setLook(S.look === 'glass' ? 'solid' : 'glass');
  if (d === 'cut') { setLook(S.look === 'cut' ? 'solid' : 'cut'); if (S.look === 'cut') { setTurntable(false); flyTo('section'); } }
  if (d === 'prints') setPrints(!S.prints);
}));
function syncChips() {
  $$('#asm button').forEach((b) => b.classList.toggle('on', (b.dataset.asm === 'hero' && S.focus === null) || b.dataset.asm === S.focus));
  const on = { labels: S.labels, exploded: S.exploded, turntable: S.turntable, glass: S.look === 'glass', cut: S.look === 'cut', prints: S.prints };
  $$('#disp button').forEach((b) => b.classList.toggle('on', !!on[b.dataset.d]));
  $('#frameR').textContent = `Isolate · ${S.focus ? ASM.find((a) => a.id === S.focus).label : 'Hero'}`;
}

// subsystems list
const SYS = [
  { id: 'head', name: 'Sensor head', sub: '3 lenses · tiller tines' },
  { id: 'carapace', name: 'Carapace', sub: '7 plates · 2 skirts' },
  { id: 'legs', name: 'Legs', sub: '4 · digitigrade · ram knees' },
  { id: 'core', name: 'Power core', sub: `${SPEC.ratedKW} kW rated · manifold` },
  { id: 'cells', name: 'Flank cells', sub: `${SPEC.cells} × ${SPEC.cellKWh} kWh` },
  { id: 'fins', name: 'Heat-sink crest', sub: `9 blades · open ${SPEC.finOnset}–${SPEC.finOnset + SPEC.finSpan} °C` },
  { id: 'drill', name: 'Coring drill', sub: 'telescoping · 0.8 m' },
];
const sysEl = $('#sysList');
const sysRows = SYS.map((s, i) => {
  const li = document.createElement('li'); li.tabIndex = 0;
  li.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span><div><b>${s.name}</b><small>${s.sub}</small></div><em class="pill"></em>`;
  const go = () => setFocus(S.focus === s.id ? null : s.id);
  li.addEventListener('click', go); li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  sysEl.appendChild(li);
  return { ...s, li, pill: li.querySelector('.pill') };
});
function sysStatus(s) {
  if (S.exploded && ['head', 'carapace', 'legs', 'cells', 'drill'].includes(s.id)) return ['Detached', 'or'];
  switch (s.id) {
    case 'head': return st.scan && st.drillDepth < 0.05 ? ['Scanning', 'or'] : ['Idle', 'gr'];
    case 'carapace': return S.look === 'glass' ? ['X-ray', 'ink'] : S.look === 'cut' ? ['Sectioned', 'ink'] : ['Sealed', ''];
    case 'legs': return out.gait === 'stand' ? ['Standing', 'gr'] : [GAITNAME[out.gait], ''];
    case 'core': return out.load > 0.95 ? ['Limit', 'or'] : [`${f1(out.P / 1000)} kW`, 'ink'];
    case 'cells': return [`${Math.round(out.soc * 100)}%`, out.P > 20000 ? 'or' : ''];
    case 'fins': return st.fins > 0.04 ? [`Open ${Math.round(st.fins * 100)}%`, st.fins > 0.6 ? 'or' : ''] : ['Folded', 'gr'];
    case 'drill': return st.drillDepth > 0.98 ? ['Coring', 'or'] : st.drillDepth > 0.02 ? [st.drill ? 'Lowering' : 'Raising', ''] : ['Stowed', 'gr'];
  }
  return ['—', 'gr'];
}

// leg rows
const legEl = $('#legBars');
const legRows = LEGS.map((id) => {
  const r = document.createElement('div'); r.className = 'ub';
  r.innerHTML = `<span>${id}</span><i></i><em>0</em><small></small>`; legEl.appendChild(r);
  return { id, r, bar: r.querySelector('i'), v: r.querySelector('em'), sm: r.querySelector('small') };
});
const LEGNAME = { LF: 'left fore', RF: 'right fore', LH: 'left hind', RH: 'right hind' };

const cells = $('#loadCells'); for (let i = 0; i < 40; i++) cells.appendChild(document.createElement('i'));
$('.crosses').innerHTML = Array.from({ length: 28 }, () => '<span>+</span>').join('');

// ---------------------------------------------------------------------------
// charts
const hist = [];
function fit(c) {
  const d = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (w < 8 || h < 8) return null;
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); return { g, w, h };
}
const OR = '#ff5a1f', INKC = '#16181b';
function drawLine(c, key, lo, hi, color, guide) {
  const f = fit(c); if (!f) return;
  const { g, w, h } = f;
  g.strokeStyle = 'rgba(22,24,27,.08)'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = i * h / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  if (guide !== undefined) { const y = h - 4 - (guide - lo) / (hi - lo) * (h - 8); g.setLineDash([2, 3]); g.strokeStyle = 'rgba(22,24,27,.35)'; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.setLineDash([]); }
  if (hist.length < 2) return;
  const X = (i) => i / (hist.length - 1) * w, Y = (v) => h - 4 - Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * (h - 8);
  g.beginPath(); hist.forEach((p, i) => (i ? g.lineTo(X(i), Y(p[key])) : g.moveTo(X(i), Y(p[key]))));
  g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fillStyle = color === OR ? 'rgba(255,90,31,.08)' : 'rgba(22,24,27,.05)'; g.fill();
  g.beginPath(); hist.forEach((p, i) => (i ? g.lineTo(X(i), Y(p[key])) : g.moveTo(X(i), Y(p[key]))));
  g.strokeStyle = color; g.lineWidth = 1.6; g.stroke();
  const L = hist[hist.length - 1][key];
  g.fillStyle = color; g.beginPath(); g.arc(w - 2, Y(L), 2.6, 0, 7); g.fill();
}
// Hildebrand footfall diagram: one row per leg, ink bars while the foot is down, two strides wide
function drawGait() {
  const f = fit($('#cvGait')); if (!f) return;
  const { g, w, h } = f;
  const rows = [2, 0, 1, 3]; // LH, LF, RF, RH
  const lx = 20, W = w - lx, rh = (h - 10) / 4;
  g.font = '600 7.5px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
  const standing = out.gait === 'stand';
  for (let c = 0; c <= 2; c++) { const x = lx + (c / 2) * W; g.strokeStyle = 'rgba(22,24,27,.12)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 8); g.stroke(); }
  rows.forEach((li, r) => {
    const y = r * rh + 1, leg = out.legs[li];
    g.fillStyle = leg.stance && !standing ? OR : INKC; g.fillText(LEGS[li], 0, y + rh / 2);
    g.fillStyle = 'rgba(22,24,27,.06)'; g.fillRect(lx, y + 2, W, rh - 4);
    if (standing) { g.fillStyle = 'rgba(22,24,27,.28)'; g.fillRect(lx, y + 2, W, rh - 4); return; }
    const o = st.off[li], b = st.duty;
    g.fillStyle = INKC;
    for (let c = -1; c < 2; c++) {
      // stance runs from phase -off to -off+β in the leg's own clock; draw it in the body clock
      const a = c + ((1 - o) % 1), z = a + b;
      const x0 = lx + Math.max(0, a / 2) * W, x1 = lx + Math.min(1, z / 2) * W;
      if (x1 > x0) g.fillRect(x0, y + 2, x1 - x0, rh - 4);
    }
  });
  // playhead: the body clock, swept across the first stride and echoed in the second
  const px = lx + (st.phase / 2) * W;
  g.strokeStyle = OR; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h - 8); g.stroke();
  g.strokeStyle = 'rgba(255,90,31,.35)'; g.beginPath(); g.moveTo(px + W / 2, 0); g.lineTo(px + W / 2, h - 8); g.stroke();
  g.fillStyle = 'rgba(22,24,27,.45)'; g.font = '500 6.5px "IBM Plex Mono", monospace';
  g.fillText(standing ? 'ALL FEET DOWN' : 'STRIDE 1', lx + 2, h - 3); if (!standing) g.fillText('STRIDE 2', lx + W / 2 + 2, h - 3);
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
const FOCUSPT = { head: 'head', carapace: 'carapace', legs: 'kneeLF', core: 'core', cells: 'cells', fins: 'crest', drill: 'drillHouse' };
function drawDraft(t) {
  const W = innerWidth, H = innerHeight;
  const P = S.focus ? m.anchors[FOCUSPT[S.focus]]() : m.body.localToWorld(new THREE.Vector3(10, 150, 0));
  const c = P.project(stage.camera);
  const cx = (c.x * 0.5 + 0.5) * W, cy = (-c.y * 0.5 + 0.5) * H;
  const sx = cx + (W / 2 - cx) * 0.4, sy = cy + (H / 2 - cy) * 0.4;
  const r1 = H * 0.36, r2 = H * 0.52, r3 = H * 0.44;
  for (const [k, r] of [['c1', r1], ['c2', r2], ['c3', r3]]) { D[k].setAttribute('cx', sx); D[k].setAttribute('cy', sy); D[k].setAttribute('r', r); }
  const a0 = t * 0.12, a1 = a0 + 1.9;
  const Pt = (r, a) => `${sx + Math.cos(a) * r} ${sy + Math.sin(a) * r}`;
  D.arc.setAttribute('d', `M ${Pt(r2 * 1.12, a0 + 3.4)} A ${r2 * 1.12} ${r2 * 1.12} 0 0 1 ${Pt(r2 * 1.12, a0 + 4.6)}`);
  D.arc2.setAttribute('d', `M ${Pt(r1 * 0.82, -a0)} A ${r1 * 0.82} ${r1 * 0.82} 0 0 1 ${Pt(r1 * 0.82, -a0 + 1.4)}`);
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
  hero: [['lens', 'Sensor head', '3-lens array · sweeps ±24°'], ['crest', 'Heat-sink crest', '9 blades · fold when cool'], ['cells', 'Flank cells', `${SPEC.cells} × ${SPEC.cellKWh} kWh`], ['kneeLH', 'Hind leg', 'digitigrade · ram knee'], ['carapace', 'Carapace', '7 overlapping plates']],
  head: [['lens', 'Main lens', 'live while scanning'], ['tines', 'Tiller tines', 'soil contact probes'], ['vane', 'Sensor vanes', 'swept back · passive'], ['head', 'Skull shell', 'bevelled · 40 cm wide']],
  carapace: [['carapace', 'Dorsal plate', 'overlaps the next by 6 cm'], ['spine', 'Spine', '11 vertebrae'], ['crest', 'Crest mount', 'rides the ridge']],
  legs: [['kneeLF', 'Fore elbow', 'bends back'], ['kneeLH', 'Hind knee', 'bends forward · ring = load'], ['ramLH', 'Knee ram', '63 mm bore'], ['footRH', 'Foot', '3 toes on a pad'], ['hipRF', 'Hip yoke', 'through-shaft']],
  core: [['core', 'Power core', 'glow follows load'], ['manifold', 'Hydraulic manifold', '4 lines to the hips'], ['spine', 'Spine', '11 vertebrae']],
  cells: [['cells', 'Flank cell', `${SPEC.cellKWh} kWh · band = draw`], ['core', 'Power core', `${SPEC.ratedKW} kW rated`]],
  fins: [['crest', 'Fin blade', `opens past ${SPEC.finOnset} °C`], ['fins0', 'Rear fin', `fully open at ${SPEC.finOnset + SPEC.finSpan} °C`], ['coolant', 'Coolant loop', 'core to crest']],
  drill: [['drill', 'Coring bit', 'runs 6 cm into soil'], ['drillHouse', 'Drill housing', 'telescoping shaft']],
};
const svgL = $('#leaders'), layer = $('#callouts');
const pool = Array.from({ length: 6 }, () => {
  const div = document.createElement('div'); div.className = 'call'; div.innerHTML = '<b></b><span></span>'; layer.appendChild(div);
  const pl = document.createElementNS(SVGNS, 'polyline'); const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', 3); svgL.append(pl, dot);
  return { div, pl, dot, sx: null, sy: null };
});
let bandCache = null;
addEventListener('resize', () => { bandCache = null; });
if (window.ResizeObserver) { const ro = new ResizeObserver(() => { bandCache = null; }); $$('.col').forEach((c) => ro.observe(c)); }
function bands() {
  if (bandCache) return bandCache;
  const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > r.width ? r : null; };
  const rl = rect($('.col.left')), rr = rect($('.col.right'));
  bandCache = { LL: rl ? rl.right + 8 : 10, RL: rr ? rr.left - 8 : innerWidth - 10 };
  return bandCache;
}
function drawCallouts() {
  const set = S.look === 'cut' ? (CALLS.core) : (CALLS[S.focus === null ? 'hero' : S.focus] || []);
  const W = innerWidth, H = innerHeight;
  const want = pool.map((p, i) => {
    const c = set[i]; if (!c) return null;
    const pr = m.anchors[c[0]]().project(stage.camera); const x = (pr.x * 0.5 + 0.5) * W, y = (-pr.y * 0.5 + 0.5) * H;
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
  { t: 0, label: 'Wake · grazing', mode: 'Grazing', target: '#asm [data-asm="hero"]', apply: (i) => { scenario('graze'); setLook('solid'); setExploded(false); setFocus(null, false); flyTo('hero', 2, i); setTurntable(true); setPrints(true); } },
  { t: 4, label: 'Operator · isolate head', mode: 'Scanning', target: '#asm [data-asm="head"]', apply: (i) => { setFocus('head', false); setTurntable(false); flyTo('head', 1.8, i); } },
  { t: 8, label: 'Operator · take a soil core', mode: 'Coring', target: '[data-scn="sample"]', apply: (i) => { scenario('sample'); setFocus('drill', false); flyTo('drill', 1.8, i); } },
  { t: 14, label: 'Operator · haul 260 kg', mode: 'Hauling', target: '[data-scn="haul"]', ramp: ['spd', 1, 3.2, 3.5], apply: (i) => { scenario('haul'); setFocus('legs', false); flyTo('legs', 1.8, i); } },
  { t: 18.5, label: 'Gait change · walk to trot', mode: 'Walk → trot', target: '#cGait', apply: (i) => { setFocus(null, false); flyTo('hero', 1.8, i); } },
  { t: 22, label: 'Operator · climb 18% grade', mode: 'Climbing', target: '[data-scn="climb"]', ramp: ['grade', 0, 18, 3], apply: (i) => { scenario('climb'); setFocus('fins', false); flyTo('fins', 1.8, i); } },
  { t: 27, label: 'Operator · exploded on', mode: 'Take apart', target: '#disp [data-d="exploded"]', apply: (i) => { R.grade.set(0); setFocus(null, false); setExploded(true); flyTo('wide', 2, i); } },
  { t: 31, label: 'Operator · X-ray the core', mode: 'X-ray', target: '#disp [data-d="glass"]', apply: (i) => { setExploded(false); setLook('glass'); setFocus('core', false); flyTo('core', 1.8, i); } },
  { t: 34.5, label: 'Operator · section the spine', mode: 'Section', target: '#disp [data-d="cut"]', apply: (i) => { setFocus(null, false); setLook('cut'); flyTo('section', 1.8, i); } },
  { t: 37.5, label: 'Operator · reassemble · sprint', mode: 'Sprint', target: '[data-scn="sprint"]', apply: (i) => { setLook('solid'); scenario('sprint'); flyTo('hero', 2, i); setTurntable(true); } },
];
const FILM = 41;
const film = { t: 0, playing: !q.has('notour'), idx: -1, lastInput: performance.now() };
const ticks = $('#ticks');
BEATS.forEach((b) => { const i = document.createElement('i'); i.style.left = `${b.t / FILM * 100}%`; ticks.appendChild(i); });
$('#acts').textContent = `${BEATS.length - 1} operator actions`;
const ghost = $('#ghost');
function ghostTap(sel) {
  const e = $(sel); if (!e || document.body.classList.contains('clean')) return;
  const r = e.getBoundingClientRect(); if (r.width === 0) return;
  ghost.hidden = false;
  ghost.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px)`;
  setTimeout(() => { ghost.classList.remove('tap'); void ghost.offsetWidth; ghost.classList.add('tap'); }, 820);
}
function beatAt(t) { let k = 0; for (let i = 0; i < BEATS.length; i++) if (BEATS[i].t <= t) k = i; return k; }
function seek(t, instant = true) {
  film.t = Math.max(0, Math.min(FILM - 0.01, t));
  const k = beatAt(film.t);
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
  if (film.idx >= 0 && !film.touched && film.playing) return BEATS[film.idx].mode;
  if (S.look === 'cut') return 'Section';
  if (S.exploded) return 'Take apart';
  if (st.drillDepth > 0.02) return 'Coring';
  if (st.temp > 82) return 'Overheating';
  if (out.gait === 'stand') return st.scan ? 'Scanning' : 'Standing';
  if (st.grade > 6) return 'Climbing';
  if (st.grade < -6) return 'Descending';
  if (st.payload > 150) return 'Hauling';
  return out.gait === 'bound' ? 'Sprint' : out.gait === 'trot' ? 'Trotting' : st.scan ? 'Grazing' : 'Walking';
}
function hm(h) { if (!isFinite(h) || h > 99) return '—'; const mm = Math.round(h * 60); return `${Math.floor(mm / 60)} h ${String(mm % 60).padStart(2, '0')}`; }
function loop() {
  const dt = Math.min(0.05, clock.getDelta()); T += dt; frame++;
  filmTick(dt);
  out = step(st, st.paused ? 0 : dt);
  if (fly) { fly.t += dt / fly.dur; const k = fly.t >= 1 ? 1 : EASE(fly.t); stage.camera.position.lerpVectors(fly.p0, fly.p1, k); stage.controls.target.lerpVectors(fly.t0, fly.t1, k); if (fly.t >= 1) fly = null; }
  if (S.turntable) stage.pivot.rotation.y += dt * 0.08;
  else if (turnTo !== null) { let r = stage.pivot.rotation.y % (Math.PI * 2); if (r > Math.PI) r -= Math.PI * 2; if (r < -Math.PI) r += Math.PI * 2; stage.pivot.rotation.y = r + (turnTo - r) * Math.min(1, dt * 3); }
  stage.controls.update();
  m.update(st, out, st.paused ? 0 : dt, T);
  stage.render(dt);

  sample += dt;
  if (sample > 0.2) { sample = 0; hist.push({ kw: out.P / 1000, temp: out.temp }); if (hist.length > 140) hist.shift(); }
  if (frame % 2 === 0) {
    $('#spd').textContent = f1(out.v);
    const gn = GAITNAME[out.gait]; if ($('#gaitBig').textContent !== gn) $('#gaitBig').textContent = gn;
    $('#pkw').textContent = `${f1(out.P / 1000)} kW`; $('#fr').textContent = f2(out.Fr);
    $('#temp').textContent = Math.round(out.temp); $('#soc').textContent = `${Math.round(out.soc * 100)}%`;
    $('#finsPct').textContent = `${Math.round(st.fins * 100)}%`; $('#endur').textContent = hm(out.enduranceH);
    $('#stride').textContent = `${f2(out.lambda)} m`; $('#duty').textContent = f2(out.duty); $('#hz').textContent = f2(out.freq);
    legRows.forEach((r, i) => {
      const L = out.legs[i];
      r.bar.style.setProperty('--w', `${Math.min(100, L.bar / SPEC.ratedBar * 100)}%`);
      r.v.textContent = `${Math.round(L.bar)} bar`;
      r.sm.textContent = `${LEGNAME[r.id]} · ${(L.F / 1000).toFixed(1)} kN`;
      r.r.classList.toggle('hot', L.stance && L.F > 6000);
      r.r.classList.toggle('stance', L.stance);
    });
    const pill = $('#stancePill'); pill.textContent = S.exploded ? 'Detached' : `${out.stanceCount} down`; pill.className = `pill ${S.exploded ? 'or' : out.stanceCount <= 2 ? 'ink' : ''}`;
    const pct = Math.max(0, Math.min(1, out.load));
    $('#loadPct').textContent = `${Math.round(pct * 100)}%`;
    [...cells.children].forEach((c, i) => { const on = i / 40 < pct; c.className = on ? (i >= 34 ? 'hot' : 'on') : ''; });
    const rt = Math.floor((performance.now() - t0) / 1000);
    $('#runtime').textContent = `${String(Math.floor(rt / 3600)).padStart(2, '0')}:${String(Math.floor(rt / 60) % 60).padStart(2, '0')}:${String(rt % 60).padStart(2, '0')}`;
    const mode = modeLabel();
    if ($('#modeT').textContent !== mode) $('#modeT').textContent = mode;
    $('#modeS').textContent = st.drillDepth > 0.02 ? `Bit depth ${Math.round(Math.max(0, st.drillDepth * 116 - 110))} cm into soil · cores ${st.cores}` : out.gait === 'stand' ? `All feet down · ${f1(out.P / 1000)} kW` : `${GAITNAME[out.gait]} · ${f1(out.v)} m/s · Fr ${f2(out.Fr)}${st.grade ? ` · grade ${st.grade > 0 ? '+' : ''}${Math.round(st.grade)}%` : ''}${out.throttle < 0.97 ? ' · governed' : ''}`;
    if (!film.playing) $('#status').innerHTML = `<i></i>${mode}`;
    for (const r of sysRows) { const [txt, cls] = sysStatus(r); r.pill.textContent = txt; r.pill.className = `pill ${cls}`; r.li.classList.toggle('on', S.focus === r.id); }
    const f = film.t / FILM;
    $('#fill').style.width = `${f * 100}%`; $('#knob').style.left = `${f * 100}%`;
    [...ticks.children].forEach((tk, i) => tk.classList.toggle('done', BEATS[i].t <= film.t));
    $('#beatT').textContent = BEATS[Math.max(0, film.idx)].label;
    const s = Math.floor(film.t); $('#clock').textContent = `00:${String(s).padStart(2, '0')} / 00:${FILM}`;
    drawLine($('#cvP'), 'kw', 0, 40, OR, SPEC.ratedKW);
    drawLine($('#cvT'), 'temp', 20, 90, INKC, 82);
    drawGait();
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
if (q.has('t')) { // settle springs and warm the sim for stills
  m.e = S.exploded ? 1 : 0; stage.pivot.rotation.y = 0;
  for (let i = 0; i < 240; i++) out = step(st, 1 / 60);
  m.rig.rotation.z = out.theta;
}
setPlaying(!q.has('notour') && !q.has('pause'));
if (q.has('pause')) st.paused = true;
stage.renderer.compile(stage.scene, stage.camera);
$('#boot').classList.add('done');
requestAnimationFrame(loop);
window.harrow = { stage, m, st, S, film, seek, get out() { return out; } };
void GAITS; void GROUND;
