// Planetary Teardown · SOL-08. Eight planets as study models you can open up.
// Every number on the console comes from data.js; the orbit card is computed live from
// JPL's approximate Keplerian elements for the sim date. The operation log is a script of
// operator beats that plays itself, can be scrubbed, and hands over on any real input.
import * as THREE from 'three';
import { Stage } from './stage.js';
import { PlanetModel, OPEN_DIR } from './model.js';
import { PLANETS, EARTH, sky, helio } from './data.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const q = new URLSearchParams(location.search);
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const f1 = (v, d = 1) => Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const DAY = 86400000;
if (q.has('clean')) document.body.classList.add('clean');

// accent: one colour means "working" (focused part, live readouts, the film)
const ACCENTS = { lime: '#c6ff3d', cyan: '#3de8ff', violet: '#b58cff', orange: '#ff5a1f' };
const accentU = { value: new THREE.Color(ACCENTS.lime) };
function setAccent(k) {
  const c = ACCENTS[k] || ACCENTS.lime;
  document.documentElement.style.setProperty('--acc', c);
  accentU.value.set(c);
  $$('#accents button').forEach((b) => b.classList.toggle('on', b.dataset.a === k));
  S.accent = k; if (model) model.apply();
}

// ---------------------------------------------------------------------------
const stage = new Stage($('#scene'));
let model = null, P = PLANETS[4];
const S = { mode: 'surface', focus: null, labels: true, turntable: true, glass: false, rings: true, moons: false, axis: true, compare: false, accent: 'lime', simT: Date.now(), run: false, dos: 'moons' };

// camera views: positions relative to the planet at the origin
const VIEWS = {
  surface: { pos: [3.7, 1.5, 6.3], tgt: [0, 0.05, 0] },
  cutaway: { pos: [-3.7, 1.9, 4.2], tgt: [-0.15, 0.05, 0.15] },
  exploded: { pos: [0.6, 2.3, 7.6], tgt: [-0.85, 0.35, 0.85] },
  wide: { pos: [0.5, 3.4, 9.6], tgt: [0, -0.1, 0] },
  compare: { pos: [2.8, 1.2, 5.8], tgt: [0.6, 0, 0.3] },
  feature: { pos: [0, 0.6, 4.6], tgt: [0, 0, 0] },
};
let fly = null, turnTo = null;
function viewScale(name) {
  if (name !== 'surface' || !S.rings) return 1;
  const R = P.phys.meanR; const bright = P.ringList.filter((r) => r.k >= 0.3 && !r.gap);
  return bright.length ? Math.max(1, Math.max(...bright.map((r) => r.r1)) / R / 1.9) : 1;
}
function flyTo(v, dur = 1.6, instant = false) {
  const V = typeof v === 'string' ? VIEWS[v] : v; if (!V) return;
  const k = (typeof v === 'string' ? viewScale(v) : 1) * Math.min(2.2, Math.max(1, 1.25 / stage.camera.aspect));
  const p1 = new THREE.Vector3(...V.pos).multiplyScalar(k), t1 = new THREE.Vector3(...V.tgt);
  if (instant) { stage.camera.position.copy(p1); stage.controls.target.copy(t1); fly = null; return; }
  fly = { t: 0, dur, p0: stage.camera.position.clone(), t0: stage.controls.target.clone(), p1, t1 };
}

// ---------------------------------------------------------------------------
// planet selection
const strip = $('#planets');
PLANETS.forEach((p) => {
  const b = document.createElement('button'); b.dataset.p = p.id;
  b.innerHTML = `<i style="background:radial-gradient(circle at 35% 35%, ${p.surface.c3}, ${p.surface.c1} 55%, ${p.surface.c2})"></i><b>${p.name}</b><span>${String(p.no).padStart(2, '0')} · ${p.kind.split(' ')[0]}</span>`;
  b.addEventListener('click', () => selectPlanet(p.id));
  strip.appendChild(b);
});
let swapT = 1;
function selectPlanet(id, opts = {}) {
  const p = PLANETS.find((x) => x.id === id) || PLANETS[4];
  if (model && p === P && !opts.force) return;
  P = p;
  if (model) model.dispose();
  model = new PlanetModel(P, accentU);
  stage.pivot.add(model.root);
  model.show = { rings: S.rings, moons: S.moons, axis: S.axis, compare: S.compare };
  S.focus = null; model.setFocus(null); model.setGlass(S.glass); model.setMode(S.mode);
  swapT = 0;
  $$('#planets button').forEach((b) => b.classList.toggle('on', b.dataset.p === P.id));
  renderStatic();
  syncChips(); syncUrl();
}

// ---------------------------------------------------------------------------
// static cards
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]}`;
const kv = (rows) => rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
function fmtDays(h) { const a = Math.abs(h); return a < 48 ? `${f1(a, a < 10 ? 2 : 1)} h` : `${f1(a / 24, a / 24 < 10 ? 1 : 0)} d`; }
function fmtYear(d) { return d < 700 ? `${f1(d, 1)} d` : `${f1(d / 365.25, d / 365.25 < 20 ? 2 : 1)} yr`; }
const GAS_COLORS = ['var(--acc)', '#e9e6de', '#8f8c85', '#5c5a55', '#3a3936'];
function renderStatic() {
  const p = P, ph = p.phys;
  $('#sym').textContent = p.symbol; $('#code').textContent = p.code; $('#simId').textContent = `${p.code}-T`;
  $('#kick').textContent = `${p.kind} · ${ordinal(p.no)} from the Sun`;
  $('#pname').textContent = p.name;
  document.title = `${p.name} · Planetary Teardown | Elusion Works`;
  $('#vR').textContent = n0(ph.meanR);
  $('#vRx').textContent = `${f1(ph.meanR / EARTH.radius, ph.meanR / EARTH.radius < 1 ? 2 : 1)}×`;
  const temp = ph.tMax != null ? `${n0(ph.tMin)} to ${n0(ph.tMax)} °C` : `${n0(ph.tMean)} °C at 1 bar`;
  $('#vitals').innerHTML = kv([
    ['Mass', `${f1(ph.mass, ph.mass < 10 ? 3 : 0)}×10²⁴ kg`],
    ['Mass vs Earth', `<em>${f1(ph.mass / EARTH.mass, ph.mass / EARTH.mass < 10 ? 3 : 1)}×</em>`],
    ['Density', `${f1(ph.density / 1000, 2)} g/cm³`],
    ['Surface gravity', `${f1(ph.gravity, 1)} m/s² <small>· ${f1(ph.gravity / 9.81, 2)} g</small>`],
    ['Escape speed', `${f1(ph.escape, 1)} km/s`],
    ['Spin', `${fmtDays(ph.rotH)}${ph.rotH < 0 ? ' <em>retrograde</em>' : ''}`],
    ...(Math.abs(Math.abs(ph.rotH) - ph.dayH) / ph.dayH > 0.02 ? [['Solar day', fmtDays(ph.dayH)]] : []),
    ['Axial tilt', `${f1(ph.tilt, ph.tilt < 1 ? 3 : 1)}°`],
    ['Flattening', ph.polR === ph.eqR ? 'none' : `${f1((1 - ph.polR / ph.eqR) * 100, 1)}%`],
    ['Temperature', temp],
    ['Reflects', `${Math.round(ph.albedo * 100)}% of light`],
    ['Magnetic field', `<small>${ph.field}</small>`],
  ]);
  // atmosphere
  const tot = p.atmo.gases.reduce((s, g) => s + g[1], 0);
  $('#gasbar').innerHTML = p.atmo.gases.map((g, i) => `<i style="flex-grow:${Math.max(g[1], tot * 0.012)};background:${GAS_COLORS[i] || '#333'}" title="${g[0]} ${g[1]}%"></i>`).join('');
  $('#gases').innerHTML = p.atmo.gases.map((g, i) => `<li><span><i style="background:${GAS_COLORS[i] || '#333'}"></i>${g[0]}</span><em>${g[1] >= 1 ? f1(g[1], g[1] >= 10 ? 1 : 2) : g[1] >= 0.01 ? f1(g[1], 3) : f1(g[1] * 10000, 0) + ' ppm'}${g[1] >= 0.01 ? '%' : ''}</em></li>`).join('');
  $('#atmo').innerHTML = kv([['Pressure', p.atmo.pressure], ['Note', `<small>${p.atmo.note}</small>`]]);
  // interior
  $('#layers').innerHTML = p.layers.map((L, k) => {
    const thick = L.r1 - L.r0; const depth0 = Math.max(0, ph.meanR - L.r1), depth1 = Math.max(0, ph.meanR - L.r0);
    return `<li data-k="${k}"><span class="no">${String(k + 1).padStart(2, '0')}</span><i class="sw" style="background:${L.color}"></i><div><b>${L.name}</b><small>${L.r0 === 0 ? `centre to ${n0(L.r1)} km` : `${n0(depth0)}–${n0(depth1)} km deep`} · ${n0(thick)} km</small><small>${L.comp}</small></div><em class="pill ${/liquid|molten|fluid|gas/i.test(L.state) ? '' : 'gr'}">${L.state}</em></li>`;
  }).join('');
  $$('#layers li').forEach((li) => li.addEventListener('click', () => { const k = +li.dataset.k; setFocus(S.focus === k ? null : k); }));
  $('#layersNote').textContent = p.layersNote;
  // display chips that do not apply
  $('#disp [data-d="rings"]').disabled = !p.ringList.length;
  $('#disp [data-d="moons"]').disabled = !p.moonList.length;
  $('#disp [data-d="compare"]').disabled = p.id === 'earth';
  renderDossier(); renderYou(); renderOrbit(true);
  $('#frameL').textContent = `Study model ${p.code} · mean radius = 1 · ${n0(ph.meanR)} km`;
}

function renderDossier() {
  const p = P; const el = $('#dossier');
  $$('#dosTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === S.dos));
  if (S.dos === 'moons') {
    const rings = p.ringList.length ? `<p><b>Rings:</b> ${p.ringList.filter((r) => !r.gap).map((r) => r.name).join(', ')} · out to ${n0(Math.max(...p.ringList.map((r) => r.r1)))} km.</p>` : '';
    el.innerHTML = `<div class="big"><strong>${p.moons}</strong><span>known moons · NASA/JPL, Aug 2026</span></div>${rings}` +
      (p.moonList.length ? `<ol>${p.moonList.map((m, i) => `<li class="click" data-m="${i}"><b>${m.name}<em>${n0(m.r)} km · ${f1(Math.abs(m.periodD), Math.abs(m.periodD) < 10 ? 2 : 1)} d${m.periodD < 0 ? ' retro' : ''}</em></b><span>${m.note} · ${n0(m.a)} km out</span></li>`).join('')}</ol>` : '<p>No moons. Too close to the Sun to keep one stable for long.</p>');
    $$('#dossier li[data-m]').forEach((li) => li.addEventListener('click', () => { setShow('moons', true); flyTo('wide'); }));
  } else if (S.dos === 'features') {
    el.innerHTML = `<ol>${p.features.map((f, i) => `<li class="click" data-f="${i}"><b>${f.name}<em>${f.value}</em></b><span>${f.note}</span></li>`).join('')}</ol>`;
    $$('#dossier li[data-f]').forEach((li) => li.addEventListener('click', () => lookAtFeature(p.features[+li.dataset.f])));
  } else if (S.dos === 'missions') {
    el.innerHTML = `<ol>${p.missions.map((m) => `<li><b>${m[0]}<em>${m[1]}</em></b><span>${m[2]}</span></li>`).join('')}</ol>`;
  } else {
    el.innerHTML = `<p><b>Name:</b> ${p.origin}.</p><p><b>Discovered:</b> ${p.discovered}.</p><ol>${p.facts.map((f) => `<li><span>${f}</span></li>`).join('')}</ol>`;
  }
}
$$('#dosTabs button').forEach((b) => b.addEventListener('click', () => { S.dos = b.dataset.t; renderDossier(); }));

function renderYou() {
  const w = +$('#w').value, age = +$('#age').value, ph = P.phys;
  const feels = w * ph.gravity / 9.81;
  $('#you').innerHTML = kv([
    ['You would weigh like', `<em>${f1(feels, 1)} kg</em>`],
    ['A 50 cm jump reaches', `${f1(50 * 9.81 / ph.gravity / 100, 2)} m`],
    ['One day here', ph.dayH < 48 ? `${f1(ph.dayH, 1)} Earth hours` : `${f1(ph.dayH / 24, 1)} Earth days`],
    ['One year here', fmtYear(P.orbit.periodD)],
    ['Your age here', `<em>${f1(age * 365.25 / P.orbit.periodD, age * 365.25 / P.orbit.periodD < 10 ? 2 : 1)}</em> ${P.name} years`],
  ]);
  for (const id of ['w', 'age']) { const el = $(`#${id}`); el.style.setProperty('--p', `${(el.value - el.min) / (el.max - el.min) * 100}%`); }
  $('#wOut').textContent = `${w} kg`; $('#ageOut').textContent = `${age} yr`;
}
$('#w').addEventListener('input', renderYou); $('#age').addEventListener('input', renderYou);

// ---------------------------------------------------------------------------
// live orbit: today's distances and a top-down orrery
const cells = $('#loadCells'); for (let i = 0; i < 40; i++) cells.appendChild(document.createElement('i'));
$('.crosses').innerHTML = Array.from({ length: 28 }, () => '<span>+</span>').join('');
const dateFmt = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function renderOrbit(force) {
  const t = S.simT; const isToday = Math.abs(t - Date.now()) < DAY;
  $('#orbDate').textContent = isToday ? 'today' : dateFmt(t);
  $('#loadDate').textContent = isToday ? 'today' : dateFmt(t);
  const o = P.orbit;
  let rows;
  if (P.id === 'earth') {
    const h = helio('earth', t); const r = Math.hypot(h.x, h.y, h.z);
    rows = [['From the Sun', `<em>${f1(r, 4)} AU</em>`], ['Sunlight takes', `${f1(r * 499.005 / 60, 2)} min`], ['Orbital speed', `${f1(Math.sqrt(1.32712440018e11 * (2 / (r * 149597870.7) - 1 / (h.a * 149597870.7))), 2)} km/s`], ['Year', `${f1(o.periodD, 2)} d`], ['Eccentricity', f1(o.ecc, 4)], ['Inclination', `${f1(o.inc, 1)}° (reference)`]];
    setLoad(r * 149.5978707, o);
    $('#lightT').textContent = `${f1(r * 499.005 / 60, 1)} min`;
  } else {
    const s = sky(P.id, t);
    const side = s.elong < 15 ? 'too near the Sun to see' : s.east ? 'evening sky' : 'morning sky';
    rows = [
      ['From the Sun', `<em>${f1(s.r, s.r < 2 ? 3 : 2)} AU</em>`],
      ['From Earth', `${f1(s.d, s.d < 2 ? 3 : 2)} AU`],
      ['Light to Earth', s.lightMinEarth < 120 ? `${f1(s.lightMinEarth, 1)} min` : `${f1(s.lightMinEarth / 60, 2)} h`],
      ['Orbital speed now', `${f1(s.v, 2)} km/s`],
      ['In our sky', `${Math.round(s.elong)}° ${s.east ? 'E' : 'W'} of Sun · <em>${side}</em>`],
      ['Year · synodic', `${fmtYear(o.periodD)} · ${f1(o.synodicD, 0)} d`],
      ['Eccentricity · tilt', `${f1(o.ecc, 3)} · ${f1(o.inc, 1)}°`],
    ];
    setLoad(s.r * 149.5978707, o);
    $('#lightT').textContent = s.lightMinSun < 120 ? `${f1(s.lightMinSun, 1)} min` : `${f1(s.lightMinSun / 60, 2)} h`;
  }
  $('#orbit').innerHTML = kv(rows);
  drawOrrery();
}
function setLoad(rMkm, o) {
  const span = o.aph - o.peri || 1; const f = Math.max(0, Math.min(1, (rMkm - o.peri) / span));
  $('#loadAu').textContent = `${f1(rMkm / 149.5978707, rMkm < 300 ? 3 : 2)} AU`;
  [...cells.children].forEach((c, i) => { const x = (i + 0.5) / 40; c.className = Math.abs(x - f) < 0.0125 ? 'hot' : x < f ? 'on' : Math.abs(x - 0.5) < 0.0125 ? 'mid' : ''; });
}
function fitCv(c) {
  const d = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (w < 8 || h < 8) return null;
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); return { g, w, h };
}
function drawOrrery() {
  const f = fitCv($('#cvOrrery')); if (!f) return;
  const { g, w, h } = f; const cx = w / 2, cy = h / 2; const R = Math.min(w, h) / 2 - 6;
  const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#c6ff3d';
  const sc = (au) => Math.sqrt(au / 30.4) * R; // square-root radial scale fits Mercury and Neptune together
  g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
  const pos = {};
  for (const p of PLANETS) {
    const hp = helio(p.id, S.simT); const r = Math.hypot(hp.x, hp.y);
    const rr = sc(r); const a = Math.atan2(hp.y, hp.x);
    pos[p.id] = [cx + Math.cos(a) * rr, cy - Math.sin(a) * rr];
    g.strokeStyle = p.id === P.id ? acc : 'rgba(255,255,255,.12)'; g.lineWidth = p.id === P.id ? 1 : 0.8;
    g.setLineDash(p.id === P.id ? [] : [2, 3]); g.beginPath(); g.arc(cx, cy, sc(p.orbit.a / 149.5978707), 0, 7); g.stroke(); g.setLineDash([]);
  }
  if (P.id !== 'earth') { g.strokeStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.moveTo(...pos.earth); g.lineTo(...pos[P.id]); g.stroke(); }
  for (const p of PLANETS) {
    const [x, y] = pos[p.id]; const on = p.id === P.id;
    g.fillStyle = on ? acc : p.id === 'earth' ? '#8ab4ff' : '#cfcac0';
    g.beginPath(); g.arc(x, y, on ? 3.6 : p.id === 'earth' ? 2.6 : 2, 0, 7); g.fill();
    if (on || p.id === 'earth') { g.font = '600 8px "IBM Plex Mono", monospace'; g.fillStyle = on ? acc : '#8ab4ff'; g.fillText(p.name.toUpperCase(), x + 6, y - 4); }
  }
  g.font = '500 7px "IBM Plex Mono", monospace'; g.fillStyle = 'rgba(255,255,255,.35)'; g.fillText('TOP-DOWN · √ DISTANCE SCALE', 4, h - 4);
}
$$('#dates button').forEach((b) => b.addEventListener('click', () => {
  const d = b.dataset.d;
  if (d === 'run') { S.run = !S.run; b.classList.toggle('on', S.run); return; }
  S.simT = +d === 0 ? Date.now() : S.simT + +d * DAY;
  $$('#dates button').forEach((x) => { if (x.dataset.d !== 'run') x.classList.toggle('on', x === b && +d === 0); });
  renderOrbit();
}));

// ---------------------------------------------------------------------------
// modes, focus and display toggles
const MODE_LABEL = { surface: 'Surface', cutaway: 'Cutaway', exploded: 'Exploded' };
function setMode(m, view = true, instant = false) {
  S.mode = m; model.setMode(m);
  if (m !== 'surface') setTurntable(false);
  if (view) flyTo(m === 'surface' ? 'surface' : m, 1.7, instant);
  syncChips();
}
function setFocus(k, view = true) {
  S.focus = k; model.setFocus(k);
  if (k !== null && S.mode === 'surface') setMode('cutaway', view);
  syncChips();
}
function setTurntable(v) { S.turntable = v; turnTo = v ? null : 0; syncChips(); }
function setLabels(v) { S.labels = v; document.body.classList.toggle('nolabels', !v); syncChips(); }
function setGlass(v) { S.glass = v; model.setGlass(v); syncChips(); }
function setShow(k, v) { S[k] = v; model.setShow(k, v); syncChips(); if (k === 'moons' && v) S.dos = 'moons', renderDossier(); }
function lookAtFeature(f) {
  setMode('surface', false); setTurntable(false);
  stage.pivot.rotation.y = 0; model.hold = true; clearTimeout(S.holdTimer);
  S.holdTimer = setTimeout(() => { if (model) model.hold = false; }, 8000);
  stage.pivot.updateMatrixWorld(true);
  const n = model.featureNormal(f); const pos = n.clone().multiplyScalar(4.4).add(new THREE.Vector3(0, 0.4, 0));
  flyTo({ pos: [pos.x, pos.y, pos.z], tgt: [0, 0, 0] }, 1.6);
}
$$('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
$$('#disp button').forEach((b) => b.addEventListener('click', () => {
  const d = b.dataset.d;
  if (d === 'labels') setLabels(!S.labels);
  if (d === 'turntable') setTurntable(!S.turntable);
  if (d === 'glass') setGlass(!S.glass);
  if (['rings', 'moons', 'axis', 'compare'].includes(d)) { setShow(d, !S[d]); if (d === 'compare' && S.compare) flyTo('compare'); if (d === 'moons' && S.moons) flyTo('wide'); }
}));
for (const [k, c] of Object.entries(ACCENTS)) { const b = document.createElement('button'); b.dataset.a = k; b.style.background = c; b.title = `${k[0].toUpperCase()}${k.slice(1)} accent`; b.addEventListener('click', () => { setAccent(k); syncUrl(); }); $('#accents').appendChild(b); }
function syncChips() {
  $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.m === S.mode));
  const on = { labels: S.labels, turntable: S.turntable, glass: S.glass, rings: S.rings, moons: S.moons, axis: S.axis, compare: S.compare };
  $$('#disp button').forEach((b) => b.classList.toggle('on', !!on[b.dataset.d] && !b.disabled));
  $$('#layers li').forEach((li) => li.classList.toggle('on', +li.dataset.k === S.focus));
  $('#frameR').textContent = `Isolate · ${S.focus === null ? 'Whole planet' : P.layers[S.focus].name}`;
}

// ---------------------------------------------------------------------------
// drafting overlay (orbit circles, dashed arcs, nodes, crosshair on the subject)
const SVGNS = 'http://www.w3.org/2000/svg';
const draft = $('#draft');
const mk = (tag, cls, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); if (cls) e.setAttribute('class', cls); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); draft.appendChild(e); return e; };
const D = {
  c1: mk('circle', 'c'), c2: mk('circle', 'c'), c3: mk('circle', 'd'), arc: mk('path', 'd'), arc2: mk('path', 'c'),
  v: mk('line', 'd'), h: mk('line', 'd'), diag: mk('line', 'd'), frame: mk('rect', 'd'),
  cross: [mk('line', 'x'), mk('line', 'x')],
  nodes: Array.from({ length: 6 }, (_, i) => mk('circle', i % 3 === 0 ? 'nf' : 'n', { r: i % 3 === 0 ? 2.5 : 5 })),
  ring: mk('circle', 'c', { r: 13, 'stroke-width': 4, style: 'stroke: rgba(255,255,255,.14)' }),
};
const tmpV = new THREE.Vector3();
function drawDraft(t) {
  const W = innerWidth, H = innerHeight;
  tmpV.set(0, 0, 0).project(stage.camera);
  const cx = (tmpV.x * 0.5 + 0.5) * W, cy = (-tmpV.y * 0.5 + 0.5) * H;
  const sx = cx + (W / 2 - cx) * 0.4, sy = cy + (H / 2 - cy) * 0.4;
  const r1 = H * 0.33, r2 = H * 0.49, r3 = H * 0.41;
  for (const [c, r] of [[D.c1, r1], [D.c2, r2], [D.c3, r3]]) { c.setAttribute('cx', sx); c.setAttribute('cy', sy); c.setAttribute('r', r); }
  const a0 = t * 0.12, a1 = a0 + 1.9; const Pp = (r, a) => `${sx + Math.cos(a) * r} ${sy + Math.sin(a) * r}`;
  D.arc.setAttribute('d', `M ${Pp(r2 * 1.12, a0 + 3.4)} A ${r2 * 1.12} ${r2 * 1.12} 0 0 1 ${Pp(r2 * 1.12, a0 + 4.6)}`);
  D.arc2.setAttribute('d', `M ${Pp(r1 * 0.82, -a0)} A ${r1 * 0.82} ${r1 * 0.82} 0 0 1 ${Pp(r1 * 0.82, -a0 + 1.4)}`);
  D.v.setAttribute('x1', sx); D.v.setAttribute('x2', sx); D.v.setAttribute('y1', sy - r2 * 1.2); D.v.setAttribute('y2', sy + r2 * 1.2);
  D.h.setAttribute('x1', sx - r2 * 1.3); D.h.setAttribute('x2', sx - r1 * 1.05); D.h.setAttribute('y1', sy); D.h.setAttribute('y2', sy);
  D.diag.setAttribute('x1', sx + r1 * 0.7); D.diag.setAttribute('y1', sy - r1 * 0.7); D.diag.setAttribute('x2', sx + r2 * 1.1); D.diag.setAttribute('y2', sy - r2 * 1.1);
  D.frame.setAttribute('x', 252); D.frame.setAttribute('y', 140); D.frame.setAttribute('width', Math.max(0, W - 504)); D.frame.setAttribute('height', Math.max(0, H - 140 - 150));
  const angs = [a0, a0 + 2.1, a1 + 1.7, -a0 * 1.3 + 0.8, -a0 * 1.3 + 3.0, a0 * 0.7 + 4.4]; const rads = [r2, r2, r3, r1, r1 * 0.82, r2 * 1.12];
  D.nodes.forEach((n, i) => { n.setAttribute('cx', sx + Math.cos(angs[i]) * rads[i]); n.setAttribute('cy', sy + Math.sin(angs[i]) * rads[i]); });
  D.ring.setAttribute('cx', sx + Math.cos(a0 + 4.0) * r3); D.ring.setAttribute('cy', sy + Math.sin(a0 + 4.0) * r3);
  const L = 7;
  D.cross[0].setAttribute('x1', cx - L); D.cross[0].setAttribute('x2', cx + L); D.cross[0].setAttribute('y1', cy); D.cross[0].setAttribute('y2', cy);
  D.cross[1].setAttribute('y1', cy - L); D.cross[1].setAttribute('y2', cy + L); D.cross[1].setAttribute('x1', cx); D.cross[1].setAttribute('x2', cx);
}

// ---------------------------------------------------------------------------
// callouts: accent dot, elbow leader, two-line label
const svgL = $('#leaders'), layer = $('#callouts');
const pool = Array.from({ length: 7 }, () => {
  const div = document.createElement('div'); div.className = 'call'; div.innerHTML = '<b></b><span></span>'; layer.appendChild(div);
  const pl = document.createElementNS(SVGNS, 'polyline'); const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', 3); svgL.append(pl, dot);
  return { div, pl, dot, sx: null, sy: null, key: null };
});
function calloutSet() {
  const set = [];
  if (S.mode !== 'surface') {
    P.layers.forEach((L, k) => { if (S.focus !== null && S.focus !== k) return; set.push({ key: `L${k}`, a: () => model.layerAnchor(k), t: L.name, s: `${L.r0 === 0 ? 'to' : `${n0(Math.max(0, P.phys.meanR - L.r1))} km down ·`} ${n0(L.r1 - L.r0)} km${L.r0 === 0 ? ' radius' : ''} · ${L.state}` }); });
  } else if (S.moons && P.moonList.length) {
    P.moonList.forEach((m, i) => set.push({ key: `M${i}`, a: () => model.moonAnchor(i), t: m.name, s: `${n0(m.r)} km · ${f1(Math.abs(m.periodD), 2)} d` }));
  } else {
    P.features.forEach((f, i) => set.push({ key: `F${i}`, a: () => model.featureAnchor(f), vis: () => model.featureNormal(f).dot(stage.camera.position.clone().sub(model.featureAnchor(f)).normalize()) > 0.2, t: f.name, s: f.value }));
    if (S.rings && P.ringList.length) { const main = P.ringList.reduce((a, b) => (b.k > a.k ? b : a)); set.push({ key: 'R', a: () => model.ringAnchor(main), t: P.id === 'saturn' ? 'Main rings' : 'Rings', s: `${P.ringList.length} mapped · to ${n0(Math.max(...P.ringList.map((r) => r.r1)))} km` }); }
    if (S.compare && P.id !== 'earth') set.push({ key: 'E', a: () => model.ghost.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, model.ghostR, 0)), t: 'Earth to scale', s: `${f1(EARTH.radius / P.phys.meanR, 2)} × this radius` });
  }
  return set.slice(0, pool.length);
}
function drawCallouts() {
  const set = calloutSet(); const W = innerWidth, H = innerHeight;
  const want = pool.map((p, i) => {
    const c = set[i]; if (!c) return null;
    const v = c.a().project(stage.camera); const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    const side = x > W * 0.5 ? 1 : -1;
    const lo = W < 1180 ? 20 : 262, hi = W - lo;
    let tx = x + side * (96 + (i % 2) * 26); tx = side > 0 ? Math.min(tx, hi - 150) : Math.max(tx, lo + 150);
    return { x, y, z: v.z, side, tx, ty: Math.max(150, y - 30 - (i % 3) * 10), vis: c.vis ? c.vis() : true };
  });
  for (let pass = 0; pass < 6; pass++) for (let a = 0; a < want.length; a++) for (let b = a + 1; b < want.length; b++) {
    const A = want[a], B = want[b]; if (!A || !B || A.side !== B.side) continue;
    if (Math.abs(A.tx - B.tx) < 160 && Math.abs(A.ty - B.ty) < 30) { const d = (30 - Math.abs(A.ty - B.ty)) / 2, s = A.ty <= B.ty ? -1 : 1; A.ty += s * d; B.ty -= s * d; }
  }
  const narrow = W < 1180;
  pool.forEach((p, i) => {
    const c = set[i];
    if (!c) { p.div.style.display = 'none'; p.pl.style.display = p.dot.style.display = 'none'; p.sx = null; return; }
    const { x, y, side, tx, ty, vis } = want[i];
    const ok = vis && want[i].z < 1 && x > (narrow ? 10 : 240) && x < W - (narrow ? 10 : 240) && y > 120 && y < H - 140;
    p.div.style.display = ok ? '' : 'none'; p.pl.style.display = p.dot.style.display = ok ? '' : 'none';
    if (!ok) return;
    if (p.key !== c.key) { p.sx = null; p.key = c.key; }
    p.sx = p.sx === null ? tx : p.sx + (tx - p.sx) * 0.2; p.sy = p.sy === null ? ty : p.sy + (ty - p.sy) * 0.2;
    p.div.querySelector('b').textContent = c.t; p.div.querySelector('span').textContent = c.s;
    p.div.style.transform = `translate(${side > 0 ? p.sx + 8 : p.sx - 8}px, ${p.sy - 9}px) translateX(${side > 0 ? 0 : -100}%)`;
    p.div.style.textAlign = side > 0 ? 'left' : 'right';
    p.pl.setAttribute('points', `${x},${y} ${x + (p.sx - x) * 0.35},${p.sy} ${p.sx},${p.sy}`);
    p.dot.setAttribute('cx', x); p.dot.setAttribute('cy', y);
  });
}

// ---------------------------------------------------------------------------
// operation log: a grand tour, two beats per planet
const TOUR = {
  mercury: { label: 'cut to the core', mode: 'Iron core', target: '#modes [data-m="cutaway"]', run: (i) => { setMode('cutaway', true, i); setFocus(1, false); } },
  venus: { label: 'section under the clouds', mode: 'Cutaway', target: '#modes [data-m="cutaway"]', run: (i) => { setMode('cutaway', true, i); } },
  earth: { label: 'explode the layers', mode: 'Exploded', target: '#modes [data-m="exploded"]', run: (i) => { setMode('exploded', true, i); } },
  mars: { label: 'isolate the molten layer', mode: 'Molten layer', target: '#layers [data-k="1"]', run: (i) => { setMode('cutaway', true, i); setFocus(1, false); } },
  jupiter: { label: 'explode · metallic hydrogen', mode: 'Exploded', target: '#modes [data-m="exploded"]', run: (i) => { setMode('exploded', true, i); setFocus(1, false); } },
  saturn: { label: 'rings and moons', mode: 'Rings + moons', target: '#disp [data-d="moons"]', run: (i) => { setShow('moons', true); flyTo('wide', 1.8, i); } },
  uranus: { label: 'Earth to scale', mode: 'Compare', target: '#disp [data-d="compare"]', run: (i) => { setShow('compare', true); flyTo('compare', 1.8, i); } },
  neptune: { label: 'explode the ice giant', mode: 'Exploded', target: '#modes [data-m="exploded"]', run: (i) => { setMode('exploded', true, i); } },
};
const SEG = 5.6;
const BEATS = [];
PLANETS.forEach((p, i) => {
  BEATS.push({ t: i * SEG, label: `Select · ${p.name}`, mode: 'Surface', target: `#planets [data-p="${p.id}"]`, big: true, apply: (inst) => { S.moons = false; S.compare = false; S.focus = null; S.mode = 'surface'; selectPlanet(p.id); setMode('surface', true, inst); setTurntable(true); } });
  const b = TOUR[p.id];
  BEATS.push({ t: i * SEG + 2.6, label: `Operator · ${b.label}`, mode: b.mode, target: b.target, apply: (inst) => b.run(inst) });
});
const FILM = PLANETS.length * SEG;
const film = { t: 0, playing: !q.has('notour'), idx: -1, lastInput: performance.now(), touched: false };
const ticks = $('#ticks');
BEATS.forEach((b) => { const i = document.createElement('i'); i.style.left = `${b.t / FILM * 100}%`; if (b.big) i.className = 'big'; ticks.appendChild(i); });
$('#acts').textContent = `${BEATS.length} operator actions`;
const ghost = $('#ghost');
function ghostTap(sel) {
  const e = $(sel); if (!e || document.body.classList.contains('clean')) return;
  const r = e.getBoundingClientRect(); if (!r.width) return;
  ghost.hidden = false; ghost.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px)`;
  setTimeout(() => { ghost.classList.remove('tap'); void ghost.offsetWidth; ghost.classList.add('tap'); }, 820);
}
function beatAt(t) { let k = 0; for (let i = 0; i < BEATS.length; i++) if (BEATS[i].t <= t) k = i; return k; }
function seek(t, instant = true) {
  film.t = Math.max(0, Math.min(FILM - 0.01, t));
  const k = beatAt(film.t);
  const start = k % 2 === 0 ? k : k - 1; // a planet's beats are self-contained
  for (let i = start; i <= k; i++) BEATS[i].apply(instant || i < k);
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
    if (!q.has('notour') && performance.now() - film.lastInput > 25000) { film.t = beatAt(film.t) % 2 === 0 ? film.t : film.t; film.idx = -1; setPlaying(true); }
    return;
  }
  film.t += dt; if (film.t >= FILM) { film.t = 0; film.idx = -1; }
  const k = beatAt(film.t);
  if (k !== film.idx) { film.idx = k; BEATS[k].apply(false); ghostTap(BEATS[k].target); }
}

// keyboard
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (/^[1-8]$/.test(k)) selectPlanet(PLANETS[+k - 1].id);
  else if (k === 's') setMode('surface'); else if (k === 'c') setMode('cutaway'); else if (k === 'x') setMode('exploded');
  else if (k === 'g') setGlass(!S.glass); else if (k === 'l') setLabels(!S.labels); else if (k === 'm') setShow('moons', !S.moons);
  else if (k === 'e') setShow('compare', !S.compare);
  else if (k === 'h') document.body.classList.toggle('clean');
  else if (k === 't') { if (!film.playing) seek(film.t, false); setPlaying(!film.playing); }
  else if (k === 'arrowright' || k === 'arrowleft') { const i = PLANETS.indexOf(P); selectPlanet(PLANETS[(i + (k === 'arrowright' ? 1 : 7)) % 8].id); }
});
$('#panelsBtn').addEventListener('click', () => {
  const b = document.body;
  if (!b.classList.contains('panels')) b.classList.add('panels');
  else if (!b.classList.contains('side-left')) b.classList.add('side-left');
  else b.classList.remove('panels', 'side-left');
  $('#panelsBtn').setAttribute('aria-expanded', b.classList.contains('panels'));
});
function syncUrl() {
  if (film.playing) return;
  const u = new URLSearchParams();
  u.set('p', P.id); if (S.mode !== 'surface') u.set('mode', S.mode); if (S.accent !== 'lime') u.set('accent', S.accent);
  for (const k of ['clean', 'notour', 'q']) if (q.has(k)) u.set(k, q.get(k));
  history.replaceState(null, '', `?${u}`);
}

// ---------------------------------------------------------------------------
// loop
const clock = new THREE.Clock();
let T = 0, frame = 0, fpsT = performance.now(), fpsN = 0, low = 0, lastOrbit = 0;
const t0 = performance.now();
function loop() {
  const raw = clock.getDelta(); const dt = Math.min(0.05, raw); T += dt; frame++;
  filmTick(Math.min(0.25, raw));
  if (S.run) { S.simT += dt * 20 * DAY; }
  if (fly) { fly.t += dt / fly.dur; const k = fly.t >= 1 ? 1 : EASE(fly.t); stage.camera.position.lerpVectors(fly.p0, fly.p1, k); stage.controls.target.lerpVectors(fly.t0, fly.t1, k); if (fly.t >= 1) fly = null; }
  if (S.turntable) stage.pivot.rotation.y += dt * 0.08;
  else if (turnTo !== null) { let r = stage.pivot.rotation.y % (Math.PI * 2); if (r > Math.PI) r -= Math.PI * 2; if (r < -Math.PI) r += Math.PI * 2; stage.pivot.rotation.y = r + (turnTo - r) * Math.min(1, dt * 3); }
  stage.turntable.rotation.y = stage.pivot.rotation.y;
  // planet swap: drop in with a little overshoot
  if (swapT < 1) { swapT = Math.min(1, swapT + dt * 1.6); const k = swapT; const s = 1 + Math.sin(k * Math.PI) * 0.06 * (1 - k); model.root.scale.setScalar(0.55 + 0.45 * EASE(k) * s / (1 + 0.0)); model.root.position.y = (1 - EASE(k)) * 0.6; }
  else { model.root.scale.setScalar(1); model.root.position.y = 0; }
  // stand the planet upright while it is sectioned, so the cut faces the camera
  const tiltTarget = S.mode === 'surface' ? -THREE.MathUtils.degToRad(Math.min(P.phys.tilt, 180)) : 0;
  model.tilt.rotation.z += (tiltTarget - model.tilt.rotation.z) * Math.min(1, dt * 3);
  stage.controls.update();
  stage.pivot.updateMatrixWorld(true);
  const sunW = stage.sunDir;
  model.update(dt, T, sunW);
  stage.render(dt);

  if (S.labels) drawCallouts();
  if (frame % 2 === 0) drawDraft(T);
  if (frame % 6 === 0) {
    const el = Math.floor((performance.now() - t0) / 1000);
    $('#runtime').textContent = [el / 3600, (el / 60) % 60, el % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
    const isFilm = film.idx >= 0 && !film.touched && film.playing;
    $('#modeT').textContent = isFilm ? BEATS[film.idx].mode : S.focus !== null ? P.layers[S.focus].name : (S.moons && S.mode === 'surface' ? 'Moons' : S.compare && S.mode === 'surface' ? 'Compare' : MODE_LABEL[S.mode]);
    $('#modeS').textContent = S.mode === 'surface' ? `${P.name} · tilt ${f1(P.phys.tilt, P.phys.tilt < 1 ? 2 : 1)}° · spin ${fmtDays(P.phys.rotH)}` : `${P.layers.length} layers · cut 90° · ${S.mode === 'exploded' ? 'shells drawn out' : 'section faces'}`;
    const m = Math.floor(film.t / 60), s = Math.floor(film.t % 60);
    $('#clock').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} / 00:${String(Math.round(FILM)).padStart(2, '0')}`;
    const pct = film.t / FILM * 100; $('#fill').style.width = `${pct}%`; $('#knob').style.left = `${pct}%`;
    $$('#ticks i').forEach((i, k) => i.classList.toggle('done', BEATS[k].t <= film.t));
    if (film.idx >= 0) $('#beatT').textContent = BEATS[film.idx].label;
  }
  if (S.run && performance.now() - lastOrbit > 120) { lastOrbit = performance.now(); renderOrbit(); }
  // adaptive quality
  fpsN++;
  if (performance.now() - fpsT > 2000) {
    const fps = fpsN / ((performance.now() - fpsT) / 1000); fpsN = 0; fpsT = performance.now();
    if (!q.has('q') && fps < 40 && stage.quality > 0) { low++; if (low >= 2) { stage.setQuality(stage.quality - 1); low = 0; } } else low = 0;
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// boot
setAccent(q.get('accent') in ACCENTS ? q.get('accent') : 'lime');
if (q.has('q')) stage.setQuality(Math.max(0, Math.min(2, +q.get('q'))));
const startP = PLANETS.find((p) => p.id === q.get('p'));
selectPlanet(startP ? startP.id : 'mercury', { force: true });
if (startP || q.has('mode')) {
  film.playing = false; setPlaying(false); film.touched = true;
  if (q.has('mode') && MODE_LABEL[q.get('mode')]) setMode(q.get('mode'), true, true); else flyTo('surface', 0, true);
} else if (q.has('t')) { seek(+q.get('t'), true); }
else flyTo('surface', 0, true);
if (q.has('pause')) setPlaying(false);
setPlaying(film.playing);
setInterval(() => { if (!S.run && Math.abs(S.simT - Date.now()) < DAY) { S.simT = Date.now(); renderOrbit(); } }, 60000);
addEventListener('resize', () => drawOrrery());
requestAnimationFrame(() => { $('#boot').classList.add('done'); });
loop();
window.__pt = { S, stage, get model() { return model; }, setMode, setFocus, selectPlanet, seek, flyTo, setShow };
