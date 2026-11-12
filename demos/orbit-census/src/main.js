// Orbit Census: every tracked object in Earth orbit, propagated live with SGP4.
// Data: data/catalog.json, built from CelesTrak by tools/build-catalog.mjs in the deploy.
// If that file is missing, the page asks CelesTrak directly; if that fails it says so.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gstime, sunPos, eciToGeodetic } from '../vendor/satellite/index.js';
import { CELESTRAK_GP, GROUPS, mergeGroups, TYPES } from './catalog.js';
import { orbitShape, regime, family, FAMILIES, NAV, MEGA, ownerName, siteName, TYPE_COLORS, REGIME_COLORS, OWNER_TOP, OWNER_COLORS, hexToRgb } from './classify.js';
import { Globe, RE } from './globe.js';
import { Swarm } from './swarm.js';
import * as charts from './charts.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const q = new URLSearchParams(location.search);
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const DAY = 86400000;
const toJd = (ms) => ms / DAY + 2440587.5;
const fmtUTC = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const fmtLocal = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtDur = (ms) => { const a = Math.abs(ms) / 1000; if (a < 90) return `${Math.round(a)} s`; if (a < 5400) return `${Math.round(a / 60)} min`; if (a < 172800) return `${(a / 3600).toFixed(a < 36000 ? 1 : 0)} h`; return `${(a / 86400).toFixed(1)} d`; };
const boot = (msg, p) => { $('#bootMsg').textContent = msg; if (p != null) $('#bootBar').style.width = `${p * 100}%`; };
if (q.has('clean')) document.body.classList.add('clean');

// ---------------------------------------------------------------------------
// scene
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04070c);
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 5000);
camera.position.set(30, 22, 44);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.07;
controls.minDistance = RE + 0.9; controls.maxDistance = 260;
controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.8;
controls.autoRotateSpeed = 0.18;
const globe = new Globe(scene, renderer);
function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', onResize); onResize();

// ---------------------------------------------------------------------------
// state
const S = {
  items: [], swarm: null, worker: null, doc: null, source: 'none',
  base: Date.now(), simT: Date.now(), warp: 1, paused: false, anchorReal: Date.now(), anchorSim: Date.now(),
  lens: 'all', color: 'type', hidden: new Set(), regimes: new Set(['LEO', 'MEO', 'GEO', 'HEO', 'Beyond GEO']), band: null,
  sel: -1, hov: -1, follow: false, frame: 'eci', rings: true, shadow: true, spin: !matchMedia('(prefers-reduced-motion: reduce)').matches,
  obs: { lat: 51.5074, lon: -0.1278, h: 20, name: 'London' },
  chart: 'alt', visible: [], track: null, pairs: [],
};

// ---------------------------------------------------------------------------
// lenses and colour modes
const DEBRIS_EVENTS = [
  { id: 'fengyun-1c-debris', label: 'Fengyun-1C · 2007', color: '#ff5277' },
  { id: 'cosmos-2251-debris', label: 'Cosmos 2251 · 2009', color: '#ffb547' },
  { id: 'iridium-33-debris', label: 'Iridium 33 · 2009', color: '#7fe3ff' },
  { id: 'cosmos-1408-debris', label: 'Cosmos 1408 · 2021', color: '#c39bff' },
  { id: 'other', label: 'Other debris', color: '#8a95a3' },
];
const AGE = [
  { id: 'a0', label: 'Under 1 day', max: 1, color: '#6ee7a8' },
  { id: 'a1', label: '1 to 3 days', max: 3, color: '#d9f07a' },
  { id: 'a2', label: '3 to 10 days', max: 10, color: '#ffb547' },
  { id: 'a3', label: 'Over 10 days', max: Infinity, color: '#ff5277' },
];
const COLOR_MODES = {
  type: { label: 'Type', cats: () => Object.keys(TYPES).map((k) => ({ id: k, label: TYPES[k].label, color: TYPE_COLORS[k] })), of: (it) => it.type },
  regime: { label: 'Regime', cats: () => Object.keys(REGIME_COLORS).map((k) => ({ id: k, label: k, color: REGIME_COLORS[k] })), of: (it) => it.regime },
  owner: { label: 'Owner', cats: () => [...OWNER_TOP.map((k) => ({ id: k, label: ownerName(k), color: OWNER_COLORS[k] })), { id: 'other', label: 'Everyone else', color: OWNER_COLORS.other }], of: (it) => (OWNER_TOP.includes(it.owner) ? it.owner : 'other') },
  family: { label: 'Constellation', cats: () => [...FAMILIES.map((f) => ({ id: f.id, label: f.label, color: f.color })), { id: 'other', label: 'Not in a family', color: '#56606c' }], of: (it) => it.fam || 'other' },
  event: { label: 'Debris event', cats: () => [...DEBRIS_EVENTS, { id: 'none', label: 'Not debris', color: '#3c4652' }], of: (it) => (it.group.endsWith('-debris') ? it.group : it.type === 'DEB' ? 'other' : 'none') },
  age: { label: 'Element age', cats: () => AGE, of: (it) => { const d = (S.simT - it.epoch) / DAY; return (AGE.find((a) => d < a.max) || AGE[3]).id; } },
};
const LENSES = [
  { id: 'all', label: 'Everything', k: 'Lens 1', color: 'type', dist: 38, test: () => true,
    story: 'Every object with a public element set: working satellites, spent rocket stages and the fragments of break-ups, each one propagated with SGP4 to the sim time above.' },
  { id: 'leo', label: 'Low orbit', k: 'Lens 2 · below 2,000 km', color: 'type', dist: 24, test: (it) => it.regime === 'LEO',
    story: 'Where nearly everything is: imaging, broadband, the crewed stations and most of the debris. One lap takes about 90 to 127 minutes, at around 7.5 km/s.' },
  { id: 'mega', label: 'Megaconstellations', k: 'Lens 3', color: 'family', dist: 26, test: (it) => MEGA.has(it.fam),
    story: 'Thousands of near-identical satellites in tidy shells. Starlink is most of the active fleet on its own; look for planes stacked at about 53°, 43°, 70° and the polar shells.' },
  { id: 'debris', label: 'Debris clouds', k: 'Lens 4', color: 'event', dist: 30, chart: 'gab', test: (it) => it.type === 'DEB',
    story: '' },
  { id: 'nav', label: 'Navigation', k: 'Lens 5 · medium orbit', color: 'family', dist: 84, test: (it) => NAV.has(it.fam),
    story: 'GPS, GLONASS, Galileo and BeiDou share medium orbit at about 19,000 to 23,000 km, in planes tilted 55° to 65°. Each satellite laps the planet about twice a day.' },
  { id: 'geo', label: 'Geostationary', k: 'Lens 6 · 35,786 km', color: 'owner', dist: 118, test: (it) => it.regime === 'GEO',
    story: 'One lap per sidereal day, so each satellite hangs over one longitude. Switch the frame to Earth-fixed and the ring stands still while the stars wheel past.' },
  { id: 'rb', label: 'Rocket bodies', k: 'Lens 7', color: 'regime', dist: 60, test: (it) => it.type === 'R/B',
    story: 'Upper stages left in orbit after delivering their payloads: big, uncontrolled, and the likeliest source of tomorrow\'s fragments.' },
  { id: 'crew', label: 'Stations', k: 'Lens 8', color: 'family', dist: 17, test: (it) => it.fam === 'stations', pick: /^ISS \(ZARYA\)|^ISS/,
    story: 'The crewed stations and the ships that serve them. The ISS orbits at about 420 km and 51.6°, low enough that drag lowers it a little every day.' },
];
const lens = () => LENSES.find((l) => l.id === S.lens) || LENSES[0];

// ---------------------------------------------------------------------------
// data
async function loadBundled() {
  const res = await fetch('data/catalog.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const doc = await res.json();
  if (!Array.isArray(doc.rows) || !doc.rows.length) throw new Error('empty catalogue');
  return doc;
}
async function loadLive() {
  const parts = await Promise.all(GROUPS.map(async (g) => {
    try { const r = await fetch(`${CELESTRAK_GP}?GROUP=${g.id}&FORMAT=json`); if (!r.ok) return null; return { id: g.id, records: await r.json() }; } catch { return null; }
  }));
  const ok = parts.filter(Boolean);
  if (!ok.length) throw new Error('CelesTrak did not answer');
  return { v: 1, generated: new Date().toISOString(), source: 'CelesTrak GP data, fetched live by your browser', live: true, satcat: false, rows: mergeGroups(ok, null) };
}

function buildItems(rows) {
  return rows.map((r, i) => {
    const o = orbitShape(r[10], r[11]);
    const epoch = Date.parse(r[9].endsWith('Z') ? r[9] : `${r[9]}Z`);
    return {
      i, name: r[0], norad: r[1], cospar: r[2], type: TYPES[r[3]] ? r[3] : 'UNK', owner: r[4], launch: r[5], year: r[5] ? +r[5].slice(0, 4) : 0,
      site: r[6], rcs: r[7], group: r[8] || '', epoch, n: r[10], e: r[11], inc: r[12],
      apo: o.apo, peri: o.peri, period: o.period, mAlt: (o.apo + o.peri) / 2, regime: regime(o, r[11]), fam: family(r[0]),
      alt: (o.apo + o.peri) / 2, nameU: r[0].toUpperCase(),
    };
  });
}

// ---------------------------------------------------------------------------
// time engine: request SGP4 snapshots ahead of the sim clock, blend them on the GPU
let seq = 0, resetSeq = 0, pending = false, lastConj = 0, lastSnapCost = 12;
const stepSec = () => Math.min(600, Math.max(2, Math.abs(S.warp) * 0.5));
const tRel = (ms) => (ms - S.base) / 1000;
function request(ms, conj = false) {
  pending = true; seq++;
  S.worker.postMessage({ type: 'prop', t: ms, seq, conj });
}
function jump() { // after a discontinuity in time
  resetSeq = seq + 1; S.swarm.reset(); pending = false;
  request(S.simT, true);
  if (S.sel >= 0) requestTrack();
}
function schedule(now) {
  if (!S.swarm || pending) return;
  const dir = S.warp >= 0 ? 1 : -1;
  if (S.swarm.have < 2) { request(S.simT + dir * stepSec() * 1000); return; }
  const latest = dir > 0 ? S.swarm.latestT() : S.swarm.earliestT();
  const ahead = (latest - tRel(S.simT)) * dir; // seconds of sim time still covered
  if (ahead < -stepSec() * 2) { jump(); return; }
  if (ahead < stepSec() * 0.75) {
    const wantConj = now - lastConj > 3000; if (wantConj) lastConj = now;
    request(S.base + (latest + dir * stepSec()) * 1000, wantConj);
  }
}
function onSnap(m) {
  if (m.seq < resetSeq) { pending = false; return; }
  pending = false; lastSnapCost = m.cost;
  S.swarm.push(tRel(m.t), m.pv, m.ok);
  if (m.pairs) { S.pairs = m.pairs; renderConj(); }
}

// ---------------------------------------------------------------------------
// selection, tracks
const orbitLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85 }));
orbitLine.frustumCulled = false; orbitLine.visible = false;
globe.inertial.add(orbitLine);
let trackSeq = 0;
function requestTrack() {
  if (S.sel < 0) return;
  S.worker.postMessage({ type: 'track', idx: S.sel, t: S.simT, obs: S.obs, seq: ++trackSeq });
  S.trackAt = S.simT;
}
function onTrack(m) {
  if (m.seq !== trackSeq || m.idx !== S.sel) return;
  S.track = m;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(m.orbit, 3));
  orbitLine.geometry.dispose(); orbitLine.geometry = g; orbitLine.visible = true;
  globe.setGround(m.ground); globe.showGround();
  renderPass();
}
function select(i, fly = true) {
  S.sel = i; S.track = null;
  S.swarm.uniforms.sel.value = i;
  orbitLine.visible = false; globe.clearGround();
  if (i < 0) { $('#selBody').hidden = true; $('#selEmpty').hidden = false; setFollow(false); syncUrl(); return; }
  $('#selBody').hidden = false; $('#selEmpty').hidden = true;
  const it = S.items[i];
  $('#sName').textContent = it.name;
  const tp = $('#sType'); tp.textContent = TYPES[it.type].label; tp.style.background = TYPE_COLORS[it.type];
  $('#sRegime').textContent = it.regime;
  const f = FAMILIES.find((x) => x.id === it.fam); $('#sFam').hidden = !f; if (f) $('#sFam').textContent = f.label;
  renderFacts();
  requestTrack();
  if (fly) flyToObject(i);
  syncUrl();
}

// ---------------------------------------------------------------------------
// camera moves
let fly = null;
function flyTo(dist, target = new THREE.Vector3(), dir = null, dur = 1.6) {
  if (target.lengthSq() < 1e-6) dist *= Math.min(2, Math.max(1, 1.2 / camera.aspect));
  const d = (dir || camera.position.clone().sub(controls.target)).normalize();
  fly = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: target.clone().add(d.multiplyScalar(dist)), t1: target.clone() };
}
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
function worldPos(i, out) { S.swarm.posAt(i, tRel(S.simT), out); return out.applyMatrix4(globe.inertial.matrixWorld); }
function flyToObject(i) {
  const p = worldPos(i, new THREE.Vector3());
  const r = p.length();
  const dist = Math.max(3.5, Math.min(40, r * 0.55));
  if (S.follow) flyTo(dist, p, p.clone().normalize().add(new THREE.Vector3(0, 0.35, 0)));
  else flyTo(Math.max(r + dist, controls.minDistance + 2), new THREE.Vector3(), p.clone().normalize().add(new THREE.Vector3(0, 0.25, 0)));
}
let followPrev = null;
function setFollow(v) {
  S.follow = v && S.sel >= 0; $('#followBtn').classList.toggle('on', S.follow);
  followPrev = null;
  if (S.follow) flyToObject(S.sel);
  else flyTo(camera.position.length(), new THREE.Vector3(), null, 1.2);
}

// ---------------------------------------------------------------------------
// filtering and colour
function isVisible(it) {
  if (!lens().test(it)) return false;
  if (!S.regimes.has(it.regime)) return false;
  if (S.band && (it.alt < S.band[0] || it.alt > S.band[1])) return false;
  const mode = COLOR_MODES[S.color];
  if (S.hidden.has(mode.of(it))) return false;
  return true;
}
const SIZE = { PAY: 1, 'R/B': 1.2, DEB: 0.78, UNK: 0.8 };
function applyFilter() {
  if (!S.swarm) return;
  const mode = COLOR_MODES[S.color]; const cats = mode.cats(); const cmap = new Map(cats.map((c) => [c.id, hexToRgb(c.color)]));
  const vis = [];
  S.swarm.setColors((i) => {
    const it = S.items[i]; const v = isVisible(it); if (v) vis.push(it);
    const c = cmap.get(mode.of(it)) || [0.6, 0.6, 0.6];
    const size = it.fam === 'stations' ? 2.4 : SIZE[it.type] || 1;
    return [c[0], c[1], c[2], v ? size : 0];
  });
  S.visible = vis;
  renderCensus(); renderCharts(); syncUrl();
}

// ---------------------------------------------------------------------------
// panels
function renderCensus() {
  const mode = COLOR_MODES[S.color]; const cats = mode.cats();
  const shownAll = S.items.filter((it) => lens().test(it) && S.regimes.has(it.regime) && (!S.band || (it.alt >= S.band[0] && it.alt <= S.band[1])));
  const counts = new Map(); for (const it of shownAll) { const k = mode.of(it); counts.set(k, (counts.get(k) || 0) + 1); }
  $('#visCount').textContent = n0(S.visible.length);
  $('#allCount').textContent = n0(S.items.length);
  const st = $('#typeStack'); st.innerHTML = '';
  for (const c of cats) { const n = counts.get(c.id) || 0; if (!n || S.hidden.has(c.id)) continue; const i = document.createElement('i'); i.style.flexGrow = n; i.style.background = c.color; st.appendChild(i); }
  const lg = $('#legend'); lg.innerHTML = '';
  for (const c of cats) {
    const n = counts.get(c.id) || 0; if (!n && S.color !== 'type') continue;
    const li = document.createElement('li'); li.className = S.hidden.has(c.id) ? 'off' : '';
    li.innerHTML = `<i style="background:${c.color};box-shadow:0 0 8px ${c.color}66"></i><span>${c.label}</span><em>${n0(n)}</em>`;
    li.title = 'Click to hide or show · double-click to show only this';
    li.addEventListener('click', () => { S.hidden.has(c.id) ? S.hidden.delete(c.id) : S.hidden.add(c.id); applyFilter(); });
    li.addEventListener('dblclick', () => { S.hidden = new Set(cats.map((x) => x.id).filter((x) => x !== c.id)); applyFilter(); });
    lg.appendChild(li);
  }
  const d = S.doc; const c = d?.census;
  $('#censusNote').textContent = c ? `The public catalogue lists ${n0(c.total)} objects still in Earth orbit (${n0(c.PAY || 0)} payloads, ${n0(c['R/B'] || 0)} rocket bodies, ${n0(c.DEB || 0)} debris). Shown: the ${n0(S.items.length)} with current public elements.` : 'Shown: every object in the fetched CelesTrak groups. Types read from names (no SATCAT on a live fetch).';
}
function renderLensUi() {
  $$('#lenses button').forEach((b) => b.classList.toggle('on', b.dataset.l === S.lens));
  $$('#colors button').forEach((b) => b.classList.toggle('on', b.dataset.c === S.color));
  $$('#regimes button').forEach((b) => b.classList.toggle('on', S.regimes.has(b.dataset.r)));
  const L = lens();
  $('#storyK').textContent = L.k; $('#storyT').textContent = L.label;
  let story = L.story;
  if (L.id === 'debris') {
    const cnt = (g) => S.items.filter((it) => it.group === g).length;
    story = `Four events made a large share of low-orbit debris: China's Fengyun-1C anti-satellite test (January 2007, ${n0(cnt('fengyun-1c-debris'))} pieces still tracked here), the Iridium 33 and Cosmos 2251 collision (February 2009, ${n0(cnt('iridium-33-debris') + cnt('cosmos-2251-debris'))}) and Russia's Cosmos 1408 test (November 2021, ${n0(cnt('cosmos-1408-debris'))}). The Gabbard chart shows each cloud's X.`;
  }
  $('#storyP').textContent = story;
}
function setLens(id, flyCam = true) {
  const L = LENSES.find((l) => l.id === id) || LENSES[0];
  S.lens = L.id; S.color = L.color; S.hidden.clear(); S.band = null;
  if (L.chart) setChart(L.chart); else if (S.chart === 'gab') setChart('alt');
  renderLensUi(); applyFilter();
  if (flyCam && !S.follow) flyTo(L.dist, new THREE.Vector3(), null, 1.8);
  if (L.pick) { const it = S.items.find((x) => L.pick.test(x.nameU)); if (it) select(it.i, false); }
}

function renderFacts() {
  const it = S.items[S.sel]; if (!it) return;
  const age = (S.simT - it.epoch);
  const yrs = it.launch ? ((Date.now() - Date.parse(it.launch)) / (365.25 * DAY)) : null;
  const rcs = it.rcs == null ? '—' : `${it.rcs < 0.1 ? it.rcs.toFixed(3) : it.rcs.toFixed(2)} m² · ${it.rcs < 0.1 ? 'small' : it.rcs < 1 ? 'medium' : 'large'}`;
  const grp = GROUPS.find((g) => g.id === it.group)?.label || it.group;
  const rows = [
    ['NORAD id', it.norad], ['COSPAR id', it.cospar || '—'], ['Owner', ownerName(it.owner)],
    ['Launched', it.launch ? `${it.launch} · ${yrs.toFixed(yrs < 2 ? 1 : 0)} yr ago` : '—'], ['Launch site', siteName(it.site) || '—'],
    ['Radar size', rcs], ['Inclination', `${it.inc.toFixed(2)}°`],
    ['Apogee / perigee', `${n0(it.apo)} / ${n0(it.peri)} km`], ['Eccentricity', it.e.toFixed(5)],
    ['Revs per day', it.n.toFixed(4)], ['Elements epoch', `${fmtDur(age)} ${age >= 0 ? 'old' : 'ahead'}`],
    ['Source group', grp], ['Light', '<span id="sLit">—</span>'],
  ];
  $('#sFacts').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}
function renderPass() {
  const el = $('#sPass'); const tr = S.track;
  if (!tr || !tr.pass) { el.innerHTML = tr ? `No pass above 10° from <b>${S.obs.name}</b> in the next 36 hours.` : ''; return; }
  const p = tr.pass;
  if (p.now && tr.periodMin > 1300) { el.innerHTML = `Always above the horizon from <b>${S.obs.name}</b>, peaking at <b>${Math.round(p.maxEl)}°</b>.`; return; }
  const vis = p.sunlit && p.dark ? 'sunlit against a dark sky: <b>visible to the eye</b> if bright enough' : p.sunlit ? 'sunlit, but the sky is too bright' : 'in Earth\'s shadow at its highest';
  el.innerHTML = `${p.now ? 'Passing over' : 'Next pass over'} <b>${S.obs.name}</b>: ${p.now ? 'up now' : `rises <b>${fmtLocal(p.rise)}</b>`}, highest <b>${Math.round(p.maxEl)}°</b> at <b>${fmtLocal(p.tMax)}</b>, sets <b>${fmtLocal(p.set)}</b> local · ${vis}.`;
}
function renderConj() {
  const ol = $('#conj');
  if (!S.pairs.length) { ol.innerHTML = '<li class="dim">No pairs under 25 km right now.</li>'; return; }
  ol.innerHTML = S.pairs.slice(0, 6).map(([a, b, d, v]) => {
    const A = S.items[a], B = S.items[b];
    return `<li data-a="${a}" data-b="${b}"><b title="${A.name} and ${B.name}">${A.name} · ${B.name}</b><em>${d.toFixed(1)} km</em><span>relative speed ${v.toFixed(2)} km/s · ${n0((A.alt + B.alt) / 2)} km up</span></li>`;
  }).join('');
  $$('#conj li[data-a]').forEach((li) => li.addEventListener('click', () => select(+li.dataset.a)));
}

// charts
function setChart(c) {
  S.chart = c; $$('#chartTabs button').forEach((b) => b.classList.toggle('on', b.dataset.c === c));
  $('#chartNote').textContent = {
    alt: 'Live altitude of the shown set, log scale · drag across to filter a band, click to clear',
    inc: 'Inclination against mean altitude: the bands orbits settle into (53° Starlink, 97–99° sun-synchronous, 0° GEO)',
    gab: 'Gabbard diagram: each object\'s apogee and perigee against its period. A break-up spreads into an X',
    yr: 'Launch year of the shown set, from SATCAT',
  }[c];
  renderCharts();
}
let chartGeom = null;
function renderCharts() {
  if (!S.items.length) return;
  const mode = COLOR_MODES[S.color]; const cats = mode.cats(); const cmap = new Map(cats.map((c) => [c.id, c.color]));
  const items = S.visible.map((it) => ({ alt: it.alt, mAlt: it.mAlt, inc: it.inc, apo: it.apo, peri: it.peri, period: it.period, year: it.year, cat: mode.of(it) }));
  const colorOf = (x) => cmap.get(x.cat) || '#888';
  const sel = S.items[S.sel];
  const cv = $('#chart');
  if (S.chart === 'alt') chartGeom = charts.altitudeHist(cv, items, cats, { band: S.band, mark: sel ? sel.alt : null });
  if (S.chart === 'inc') charts.incAlt(cv, items, colorOf, { mark: sel });
  if (S.chart === 'gab') charts.gabbard(cv, items, colorOf, { mark: sel });
  if (S.chart === 'yr') charts.launches(cv, items, cats);
}
{
  const cv = $('#chart'); let drag = null;
  cv.addEventListener('pointerdown', (e) => { if (S.chart !== 'alt' || !chartGeom) return; drag = { x: e.offsetX, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return; if (Math.abs(e.offsetX - drag.x) > 3) drag.moved = true;
    if (drag.moved) { const a = charts.xAlt(Math.min(drag.x, e.offsetX), chartGeom.x0, chartGeom.x1), b = charts.xAlt(Math.max(drag.x, e.offsetX), chartGeom.x0, chartGeom.x1); S.band = [a, b]; renderCharts(); }
  });
  cv.addEventListener('pointerup', () => { if (!drag) return; if (!drag.moved) S.band = null; drag = null; applyFilter(); });
}

// observer
function overhead() {
  if (!S.swarm || S.swarm.have < 1) return;
  const gm = gstime(toJd(S.simT));
  const o = Globe.latLonToVec(S.obs.lat, S.obs.lon, RE + S.obs.h / 1e6);
  o.applyAxisAngle(new THREE.Vector3(0, 1, 0), gm); // inertial
  const up = o.clone().normalize(); const sin10 = Math.sin(10 * Math.PI / 180);
  const list = []; let count = 0; const t = tRel(S.simT); const p = new THREE.Vector3();
  for (const it of S.visible) {
    if (!S.swarm.ok[it.i]) continue;
    S.swarm.posAt(it.i, t, p); p.sub(o); const d = p.length(); const el = p.dot(up) / d;
    if (el > sin10) { count++; list.push([it, Math.asin(el) * 180 / Math.PI, d * 1000]); }
  }
  list.sort((a, b) => b[1] - a[1]);
  $('#obsCount').textContent = n0(count); $('#obsName').textContent = S.obs.name;
  const ol = $('#overList');
  ol.innerHTML = list.slice(0, 5).map(([it, el, d]) => `<li data-i="${it.i}"><b>${it.name}</b><span>${Math.round(el)}° · ${n0(d)} km</span></li>`).join('') || '<li><span>Nothing in the shown set is up</span></li>';
  $$('#overList li[data-i]').forEach((li) => li.addEventListener('click', () => select(+li.dataset.i)));
}
$('#locBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  $('#locBtn').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition((p) => {
    S.obs = { lat: p.coords.latitude, lon: p.coords.longitude, h: p.coords.altitude || 0, name: 'your location' };
    globe.setObserver(S.obs.lat, S.obs.lon); $('#locBtn').textContent = 'Using your location'; overhead(); requestTrack();
  }, () => { $('#locBtn').textContent = 'Location unavailable'; }, { timeout: 10000, maximumAge: 600000 });
});

// ---------------------------------------------------------------------------
// live readouts for the selected object
function liveSel() {
  if (S.sel < 0 || !S.swarm.have) return;
  const p = S.swarm.posAt(S.sel, tRel(S.simT), tmp);
  const v = S.swarm.velAt(S.sel, tmp2);
  if (!S.swarm.ok[S.sel]) { $('#sAlt').textContent = 'decayed?'; return; }
  const teme = { x: p.x * 1000, y: -p.z * 1000, z: p.y * 1000 };
  const g = eciToGeodetic(teme, gstime(toJd(S.simT)));
  S.items[S.sel].alt = g.height;
  $('#sAlt').textContent = n0(g.height);
  $('#sVel').textContent = (Math.hypot(v.x, v.y, v.z) * 1000).toFixed(2);
  const lat = g.latitude * 180 / Math.PI, lon = ((g.longitude * 180 / Math.PI + 540) % 360) - 180;
  $('#sLat').textContent = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  const per = S.items[S.sel].period; $('#sPer').textContent = per < 120 ? `${per.toFixed(1)} m` : per < 2880 ? `${(per / 60).toFixed(2)} h` : `${(per / 1440).toFixed(1)} d`;
  const s = sunVec(S.simT); const along = p.x * s.x + p.y * s.y + p.z * s.z; const perp = Math.hypot(p.x - along * s.x, p.y - along * s.y, p.z - along * s.z);
  const lit = $('#sLit'); if (lit) lit.textContent = along < 0 && perp < RE ? 'in Earth\'s shadow' : 'sunlit';
  if (S.track && Math.abs(S.simT - S.trackAt) > Math.min(S.track.periodMin * 6000, 600000)) requestTrack();
}
const sunV = new THREE.Vector3();
function sunVec(ms) { const r = sunPos(toJd(ms)).rsun; return sunV.set(r.x, r.z, -r.y).normalize(); }

// ---------------------------------------------------------------------------
// picking and hover
const ray = { x: 0, y: 0, dirty: false, inside: false };
canvas.addEventListener('pointermove', (e) => { ray.x = e.clientX; ray.y = e.clientY; ray.dirty = true; ray.inside = true; });
canvas.addEventListener('pointerleave', () => { ray.inside = false; setHover(-1); });
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; idle.poke(); });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const i = pick(e.clientX, e.clientY); if (i >= 0) select(i); else if (S.sel >= 0 && !S.follow) select(-1);
});
const proj = new THREE.Vector3();
function occluded(p) { // segment camera -> p hits the Earth first?
  const c = camera.position; const d = tmp2.copy(p).sub(c); const L = d.length(); d.divideScalar(L);
  const b = c.dot(d); const cc = c.lengthSq() - RE * RE * 0.995; const disc = b * b - cc;
  if (disc < 0) return false; const t = -b - Math.sqrt(disc); return t > 0 && t < L;
}
function pick(x, y, rad = 12) {
  if (!S.swarm || !S.swarm.have) return -1;
  const w = innerWidth, h = innerHeight; let best = -1, bd = rad * rad, bz = Infinity;
  const p = new THREE.Vector3();
  for (const it of S.visible) {
    if (!S.swarm.ok[it.i]) continue;
    worldPos(it.i, p); proj.copy(p).project(camera);
    if (proj.z > 1) continue;
    const sx = (proj.x + 1) / 2 * w, sy = (1 - proj.y) / 2 * h; const d = (sx - x) ** 2 + (sy - y) ** 2;
    if (d < bd || (d < bd * 1.4 && proj.z < bz - 0.002)) { if (occluded(p)) continue; best = it.i; bd = Math.min(bd, d); bz = proj.z; }
  }
  return best;
}
function setHover(i) {
  S.hov = i; if (S.swarm) S.swarm.uniforms.hov.value = i;
  canvas.classList.toggle('hovering', i >= 0);
  const tip = $('#tip');
  if (i < 0) { tip.hidden = true; return; }
  const it = S.items[i];
  tip.innerHTML = `<b>${it.name}</b>${TYPES[it.type].label} · ${it.regime} · ${n0(it.alt)} km · #${it.norad}`;
  tip.hidden = false; tip.style.transform = `translate(${Math.min(ray.x + 14, innerWidth - 260)}px, ${ray.y + 14}px)`;
}

// floating labels: selected object and observer
const labels = $('#labels');
const selLab = document.createElement('div'); selLab.className = 'lab3'; labels.appendChild(selLab);
const obsLab = document.createElement('div'); obsLab.className = 'lab3 obs'; labels.appendChild(obsLab);
function place(el, p) {
  proj.copy(p).project(camera);
  if (proj.z > 1 || occluded(p)) { el.style.display = 'none'; return; }
  el.style.display = 'block'; el.style.transform = `translate(${(proj.x + 1) / 2 * innerWidth + 12}px, ${(1 - proj.y) / 2 * innerHeight - 10}px)`;
}

// ---------------------------------------------------------------------------
// UI wiring
for (const L of LENSES) {
  const b = document.createElement('button'); b.textContent = L.label; b.dataset.l = L.id; b.title = L.k;
  b.addEventListener('click', () => setLens(L.id)); $('#lenses').appendChild(b);
}
for (const [k, m] of Object.entries(COLOR_MODES)) {
  const b = document.createElement('button'); b.textContent = m.label; b.dataset.c = k;
  b.addEventListener('click', () => { S.color = k; S.hidden.clear(); renderLensUi(); applyFilter(); }); $('#colors').appendChild(b);
}
for (const r of ['LEO', 'MEO', 'GEO', 'HEO', 'Beyond GEO']) {
  const b = document.createElement('button'); b.textContent = r; b.dataset.r = r;
  b.addEventListener('click', () => { S.regimes.has(r) ? S.regimes.delete(r) : S.regimes.add(r); if (!S.regimes.size) S.regimes.add(r); renderLensUi(); applyFilter(); });
  $('#regimes').appendChild(b);
}
$$('#chartTabs button').forEach((b) => b.addEventListener('click', () => setChart(b.dataset.c)));
const WARPS = [1, 10, 60, 300, 1800];
for (const w of WARPS) {
  const b = document.createElement('button'); b.textContent = `${w}×`; b.dataset.w = w;
  b.addEventListener('click', () => setWarp(w)); $('#warps').appendChild(b);
}
function setSim(t) { S.simT = t; S.anchorSim = t; S.anchorReal = Date.now(); }
function setWarp(w) {
  const flip = Math.sign(w) !== Math.sign(S.warp);
  setSim(S.simT); S.warp = w; S.paused = false; $('#play').classList.remove('paused');
  $$('#warps button').forEach((b) => b.classList.toggle('on', +b.dataset.w === w));
  $('#warpLbl').textContent = `${w}×`;
  if (flip && S.swarm) jump();
  syncUrl();
}
$('#play').addEventListener('click', () => { setSim(S.simT); S.paused = !S.paused; $('#play').classList.toggle('paused', S.paused); });
$('#liveBtn').addEventListener('click', goLive);
function goLive() { setSim(Date.now()); $('#scrub').value = 0; if (S.swarm) jump(); setWarp(1); }
$('#scrub').addEventListener('input', (e) => { setSim(Date.now() + +e.target.value * 60000); S.paused = true; $('#play').classList.add('paused'); if (S.swarm) jump(); });
$$('#frames button').forEach((b) => b.addEventListener('click', () => { S.frame = b.dataset.f; $$('#frames button').forEach((x) => x.classList.toggle('on', x === b)); syncUrl(); }));
$$('#toggles button').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.t; S[k] = !S[k]; b.classList.toggle('on', S[k]);
  if (k === 'rings') globe.rings.visible = S.rings;
  if (k === 'shadow' && S.swarm) S.swarm.uniforms.dimShadow.value = S.shadow ? 1 : 0;
}));
$('#followBtn').addEventListener('click', () => setFollow(!S.follow));
$('#clearBtn').addEventListener('click', () => select(-1));
$('#panelsBtn').addEventListener('click', () => {
  const b = document.body;
  if (!b.classList.contains('panels')) b.classList.add('panels');
  else if (!b.classList.contains('side-right')) b.classList.add('side-right');
  else b.classList.remove('panels', 'side-right');
  $('#panelsBtn').setAttribute('aria-expanded', b.classList.contains('panels'));
});
// search
const search = $('#search'), results = $('#results');
search.addEventListener('input', () => {
  const s = search.value.trim().toUpperCase(); results.innerHTML = '';
  if (s.length < 2 && !/^\d+$/.test(s)) return;
  const id = /^\d+$/.test(s) ? +s : null;
  const hits = [];
  for (const it of S.items) { if ((id && it.norad === id) || it.nameU.includes(s)) { hits.push(it); if (hits.length > 40) break; } }
  hits.sort((a, b) => (a.nameU.startsWith(s) ? 0 : 1) - (b.nameU.startsWith(s) ? 0 : 1) || a.nameU.length - b.nameU.length);
  results.innerHTML = hits.slice(0, 12).map((it) => `<li data-i="${it.i}"><b>${it.name}</b><span>#${it.norad}</span></li>`).join('') || '<li><span>No match</span></li>';
  $$('#results li[data-i]').forEach((li) => li.addEventListener('click', () => {
    const it = S.items[+li.dataset.i];
    if (!isVisible(it)) { S.lens = 'all'; S.hidden.clear(); S.band = null; S.regimes = new Set(['LEO', 'MEO', 'GEO', 'HEO', 'Beyond GEO']); renderLensUi(); applyFilter(); }
    select(it.i);
  }));
});
search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const li = results.querySelector('li[data-i]'); if (li) li.click(); } });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
  else if (e.key === 'Escape') select(-1);
  else if (e.key.toLowerCase() === 'f') setFollow(!S.follow);
  else if (e.key.toLowerCase() === 'n') goLive();
  else if (e.key.toLowerCase() === 'h') document.body.classList.toggle('clean');
  else if (e.key === '/') { e.preventDefault(); search.focus(); }
  else if (/^[1-8]$/.test(e.key)) setLens(LENSES[+e.key - 1].id);
});

// idle drift
const idle = { at: performance.now(), poke() { this.at = performance.now(); } };
['wheel', 'keydown'].forEach((ev) => addEventListener(ev, () => idle.poke(), { passive: true }));

function syncUrl() {
  if (!S.items.length) return;
  const u = new URLSearchParams();
  if (S.lens !== 'all') u.set('lens', S.lens);
  if (S.color !== lens().color) u.set('color', S.color);
  if (S.sel >= 0) u.set('sat', S.items[S.sel].norad);
  if (S.warp !== 1) u.set('warp', S.warp);
  if (S.frame !== 'eci') u.set('frame', S.frame);
  for (const k of ['clean', 'q']) if (q.has(k)) u.set(k, q.get(k));
  const s = u.toString(); history.replaceState(null, '', s ? `?${s}` : location.pathname);
}

// ---------------------------------------------------------------------------
// frame loop
let lastFrame = performance.now(), lastUi = 0, lastChart = 0, lastObs = 0, lastHover = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  S.simT = S.paused ? S.anchorSim : S.anchorSim + (Date.now() - S.anchorReal) * S.warp;
  const jd = toJd(S.simT); const gm = gstime(jd);
  globe.update(gm, sunVec(S.simT), S.frame === 'ecef');
  scene.updateMatrixWorld();
  if (S.swarm) {
    schedule(now);
    const u = S.swarm.uniforms; u.t.value = tRel(S.simT); u.sunDir.value.copy(sunVec(S.simT)); u.scale.value = renderer.getPixelRatio();
    u.size.value = 3.6 * Math.min(1.4, Math.max(0.8, innerHeight / 900));
  }
  // camera
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / fly.dur); const k = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - Math.pow(-2 * fly.t + 2, 3) / 2;
    camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k);
    if (fly.t >= 1) { fly = null; followPrev = null; }
  }
  if (S.follow && S.sel >= 0 && S.swarm?.have && !fly) {
    const p = worldPos(S.sel, new THREE.Vector3());
    if (followPrev) { const d = p.clone().sub(followPrev); camera.position.add(d); controls.target.add(d); }
    followPrev = p;
  }
  controls.autoRotate = S.spin && !S.follow && !fly && now - idle.at > 25000;
  controls.update();
  // hover pick (throttled)
  if (ray.dirty && ray.inside && now - lastHover > 50) { ray.dirty = false; lastHover = now; setHover(pick(ray.x, ray.y, 9)); }
  // labels
  if (S.sel >= 0 && S.swarm?.have) {
    const it = S.items[S.sel]; place(selLab, worldPos(S.sel, tmp));
    selLab.innerHTML = `<b>${it.name}</b><span>${n0(it.alt)} km · ${it.regime}</span>`;
  } else selLab.style.display = 'none';
  const ow = globe.obs.getWorldPosition(new THREE.Vector3()); place(obsLab, ow); obsLab.innerHTML = `<b>${S.obs.name}</b>`;
  // panels
  if (now - lastUi > 250) {
    lastUi = now;
    $('#simClock').textContent = fmtUTC(S.simT);
    const off = S.simT - Date.now();
    $('#offLbl').textContent = Math.abs(off) < 5000 ? 'Live' : `${off > 0 ? '+' : '−'}${fmtDur(off)}`;
    liveSel();
  }
  if (now - lastObs > 1000 && S.visible.length) { lastObs = now; overhead(); }
  if (now - lastChart > 1000 && S.chart === 'alt' && S.swarm?.have) {
    lastChart = now;
    // refresh live altitudes of the shown set from the snapshot
    const t = tRel(S.simT); const p = new THREE.Vector3();
    for (const it of S.visible) { if (!S.swarm.ok[it.i]) continue; S.swarm.posAt(it.i, t, p); it.alt = p.length() * 1000 - 6371; }
    renderCharts();
  }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// boot
async function start() {
  requestAnimationFrame(frame);
  boot('Drawing the map', 0.1);
  globe.load('data/earth.json', renderer).catch((e) => console.warn(e));
  globe.setObserver(S.obs.lat, S.obs.lon);
  let doc = null;
  boot('Loading the catalogue', 0.25);
  try { doc = await loadBundled(); S.source = /SYNTHETIC/i.test(doc.source) ? 'synthetic' : 'bundled'; }
  catch (e) {
    console.warn('bundled catalogue:', e.message);
    boot('Asking CelesTrak directly', 0.35);
    try { doc = await loadLive(); S.source = 'live'; } catch (e2) { console.warn('live:', e2.message); }
  }
  if (!doc) { $('#boot').classList.add('done'); $('#nodata').hidden = false; setSource(); return; }
  S.doc = doc;
  boot(`Reading ${n0(doc.rows.length)} element sets`, 0.5);
  S.items = buildItems(doc.rows);
  $('#idCount').textContent = doc.rows.length >= 1000 ? `${Math.round(doc.rows.length / 1000)}K` : doc.rows.length;
  setSource();
  const ages = S.items.map((it) => Date.now() - it.epoch).sort((a, b) => a - b);
  $('#ageLbl').textContent = `median ${fmtDur(ages[ages.length >> 1])} old`;
  // swarm + worker
  S.swarm = new Swarm(S.items.length);
  globe.inertial.add(S.swarm.points);
  S.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  S.worker.onmessage = (ev) => { const m = ev.data; if (m.type === 'snap') onSnap(m); else if (m.type === 'track') onTrack(m); else if (m.type === 'ready') ready(m); };
  S.worker.onerror = (e) => { console.error('worker', e.message); boot(`Propagator failed: ${e.message}`); };
  boot('Initialising SGP4 for every object', 0.7);
  S.worker.postMessage({ type: 'init', rows: doc.rows });
}
function ready(m) {
  console.info(`SGP4 ready: ${m.n} objects, ${m.bad} rejected, ${m.ms.toFixed(0)} ms`);
  boot('Propagating', 0.9);
  // deep links
  if (q.has('warp')) { const w = +q.get('warp'); if (WARPS.includes(w)) setWarp(w); } else setWarp(1);
  if (q.get('frame') === 'ecef') $('#frames button[data-f=ecef]').click();
  setLens(q.get('lens') || 'all', false);
  if (q.has('color') && COLOR_MODES[q.get('color')]) { S.color = q.get('color'); renderLensUi(); applyFilter(); }
  if (q.has('sat')) { const it = S.items.find((x) => x.norad === +q.get('sat')); if (it) select(it.i, true); }
  jump();
  const done = () => { if (S.swarm.have) { $('#boot').classList.add('done'); flyTo(lens().dist, new THREE.Vector3(), null, 2.4); } else setTimeout(done, 50); };
  done();
}
function setSource() {
  const el = $('#srcLbl'); el.className = 'mono';
  const d = S.doc;
  if (!d) { el.classList.add('bad'); el.innerHTML = '<i></i>No data'; return; }
  const age = Date.now() - Date.parse(d.generated);
  if (S.source === 'synthetic') { el.classList.add('bad'); el.innerHTML = '<i></i>Synthetic test data'; $('#footSrc').textContent = 'TEST DATA: synthetic orbits, not real objects'; return; }
  if (S.source === 'live') { el.classList.add('live'); el.innerHTML = '<i></i>CelesTrak · live'; return; }
  el.classList.add(age < 18 * 3600000 ? 'live' : 'warn');
  el.innerHTML = `<i></i>CelesTrak · ${fmtDur(age)} ago`;
  el.title = `Catalogue built ${fmtUTC(Date.parse(d.generated))} UTC`;
}
$('#retryBtn').addEventListener('click', () => location.reload());
window.__oc = { S, camera, controls, globe, flyTo, select, setLens };
start();
