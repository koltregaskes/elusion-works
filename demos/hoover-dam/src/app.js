// Entry point: boots the engine, wires the console, callouts, charts, tour and labs.
import { Engine, VIEWS } from './engine.js';
import { HOTSPOTS, MARKERS, SCENARIOS, TIMELINE, ELEV } from './model/data.js';
import { UNIT_IDS, storageAt, FULL_STORAGE } from './model/hydro.js';
import { U, fmt, setUnits, onUnits } from './ui/units.js';
import { Callouts } from './ui/callouts.js';
import { Charts } from './ui/charts.js';
import { Audio } from './ui/audio.js';
import { Tour } from './ui/tour.js';
import { initLabs } from './widgets/labs.js';
import { elevToY } from './scene/util.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const bootBar = $('#bootBar');
const setBoot = (p) => { bootBar.style.width = `${p}%`; };

function sliderFill(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', `${p}%`); }

async function main() {
  setBoot(15);
  await new Promise((r) => setTimeout(r, 30));
  let engine;
  try {
    engine = new Engine($('#scene'));
  } catch (err) {
    console.error(err);
    $('.boot-sub').textContent = 'WebGL is not available in this browser, so the 3D model cannot run. The labs below still work.';
    initLabs(null);
    return;
  }
  setBoot(70);
  const app = { engine, audio: new Audio() };
  window.damApp = app;
  const st = engine.state;

  // ---- tabs ------------------------------------------------------------------
  app.tab = (name) => {
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    $$('.tabpane').forEach((p) => p.classList.toggle('on', p.dataset.pane === name));
  };
  $$('.tab').forEach((t) => t.addEventListener('click', () => app.tab(t.dataset.tab)));

  // ---- units -----------------------------------------------------------------
  $$('[data-units]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-units]').forEach((x) => x.classList.toggle('on', x === b));
    setUnits(b.dataset.units);
  }));

  // ---- sliders ---------------------------------------------------------------
  const bind = (id, fn, outFn) => {
    const el = $(`#${id}`), out = $(`#${id}Out`);
    const apply = () => { fn(+el.value); sliderFill(el); if (out && outFn) out.textContent = outFn(+el.value); };
    el.addEventListener('input', apply);
    apply();
    return { el, refresh: () => { sliderFill(el); if (out && outFn) out.textContent = outFn(+el.value); } };
  };
  const sInflow = bind('inflow', (v) => { st.inflow = v; }, (v) => fmt.flow(v));
  const sDrum = bind('drum', (v) => { st.drum = v; }, (v) => `${v <= 0.01 ? 'lowered' : v >= 0.99 ? 'raised' : Math.round(v * 100) + '% raised'} · top ${fmt.elev(ELEV.spillCrest + 16 * v, 1)}`);
  const sGate = bind('gate', (v) => { st.units.forEach((u) => { u.gate = v; }); }, (v) => `${Math.round(v * 100)}%`);
  const sDemand = bind('demand', (v) => { st.demand = v; }, (v) => `${fmt.num(v)} MW`);
  const sHour = bind('hour', (v) => { st.hour = v; }, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor(v % 1 * 60)).padStart(2, '0')}`);
  const sYear = bind('year', (v) => { engine.setBuildYear(v); showBuildEvent(v); }, (v) => { const y = Math.floor(v), m = Math.floor((v - y) * 12); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]} ${y}`; });
  const sliders = [sInflow, sDrum, sGate, sDemand, sHour, sYear];
  onUnits(() => sliders.forEach((s) => s.refresh()));

  function showBuildEvent(v) {
    let ev = TIMELINE[0];
    for (const t of TIMELINE) if (t.t <= v) ev = t;
    $('#buildEvent').innerHTML = `<b>${ev.date} · ${ev.title}</b>${ev.body}`;
    $$('#timeline li').forEach((li) => li.classList.toggle('on', +li.dataset.t === ev.t));
  }

  // ---- dispatch mode -----------------------------------------------------------
  $$('[data-mode="manual"], [data-mode="auto"]').forEach((b) => b.addEventListener('click', () => {
    st.mode = b.dataset.mode;
    $$('[data-mode="manual"], [data-mode="auto"]').forEach((x) => x.classList.toggle('on', x === b));
    $('#manualBox').hidden = st.mode !== 'manual'; $('#autoBox').hidden = st.mode !== 'auto';
    if (st.mode === 'manual') st.units.forEach((u) => { u.gate = +$('#gate').value; });
  }));

  // ---- speed -------------------------------------------------------------------
  const setSpeed = (v) => {
    st.paused = v === 0; if (v) st.speed = v;
    $$('#speedSeg .seg-b').forEach((b) => b.classList.toggle('on', +b.dataset.speed === v));
  };
  $$('#speedSeg .seg-b').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));

  // ---- units grid --------------------------------------------------------------
  const unitsEl = $('#units');
  const unitBtns = {};
  // Nevada wing on the first row (8 + spacer), Arizona on the second (9).
  [...UNIT_IDS.slice(0, 8), null, ...UNIT_IDS.slice(8)].forEach((id) => {
    const b = document.createElement('button');
    if (!id) { b.className = 'unit spacer'; b.tabIndex = -1; unitsEl.appendChild(b); return; }
    b.className = 'unit'; b.innerHTML = `<span>${id}</span>`; b.title = `Unit ${id}: click to start or stop`;
    b.addEventListener('click', () => {
      const u = st.units.find((x) => x.id === id);
      if (st.mode === 'auto') { st.mode = 'manual'; $('[data-mode="manual"]').click(); }
      u.on = !u.on; if (u.on && u.gate < 0.05) u.gate = +$('#gate').value || 0.7;
      selectUnit(id);
    });
    unitsEl.appendChild(b); unitBtns[id] = b;
  });
  let selUnit = null;
  const charts = new Charts(engine);
  function selectUnit(id) { selUnit = id; charts.selected = id; Object.entries(unitBtns).forEach(([k, b]) => b.classList.toggle('sel', k === id)); }
  engine.on('unit', (id) => { selectUnit(id); app.tab('operate'); });

  // ---- scenarios ---------------------------------------------------------------
  const scnEl = $('#scenarios');
  for (const [k, s] of Object.entries(SCENARIOS)) {
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.scn = k; b.textContent = s.label;
    b.addEventListener('click', () => applyScenario(k));
    scnEl.appendChild(b);
  }
  function setRange(id, v) { const el = $(`#${id}`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  function applyScenario(k) {
    const s = SCENARIOS[k];
    $$('[data-scn]').forEach((b) => b.classList.toggle('on', b.dataset.scn === k));
    st.lake = s.lake;
    setRange('inflow', s.inflow);
    setRange('drum', s.drum === 'raised' ? 1 : 0);
    if (st.mode !== 'manual') $('[data-mode="manual"]').click();
    setRange('gate', s.gate);
    st.units.forEach((u, i) => { u.on = false; });
    const order = [7, 8, 6, 9, 5, 10, 4, 11, 3, 12, 2, 13, 1, 14, 0, 15, 16];
    for (let i = 0; i < s.units; i++) st.units[order[i]].on = true;
    setRange('hour', s.hour);
    setSpeed(s.speed);
    $('#scenarioNote').textContent = s.note;
    charts.hist.length = 0;
  }

  // ---- lake rail ---------------------------------------------------------------
  const track = $('#railTrack'), fill = $('#railFill'), handle = $('#railHandle');
  const R0 = 880, R1 = 1240;
  const elevToPct = (e) => (e - R0) / (R1 - R0) * 100;
  const marks = $('#railMarks');
  for (const m of MARKERS) {
    if (m.hideInRail) continue;
    const d = document.createElement('div'); d.className = `rail-mark ${m.tone}`; d.style.bottom = `${elevToPct(m.elev)}%`;
    d.textContent = m.label; marks.appendChild(d);
  }
  let draggingLake = false;
  const lakeFromEvent = (e) => { const r = track.getBoundingClientRect(); const p = 1 - (e.clientY - r.top) / r.height; return Math.max(R0, Math.min(ELEV.crest + 2, R0 + p * (R1 - R0))); };
  track.addEventListener('pointerdown', (e) => { draggingLake = true; track.setPointerCapture(e.pointerId); st.lake = lakeFromEvent(e); });
  track.addEventListener('pointermove', (e) => { if (draggingLake) st.lake = lakeFromEvent(e); });
  track.addEventListener('pointerup', () => { draggingLake = false; });
  track.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' ? 5 : e.key === 'ArrowDown' ? -5 : e.key === 'PageUp' ? 25 : e.key === 'PageDown' ? -25 : 0;
    if (d) { st.lake = Math.max(R0, Math.min(ELEV.crest, st.lake + d)); e.preventDefault(); }
  });
  app.tourDragLake = async (from, to, ms, move, cancelled) => {
    const r = track.getBoundingClientRect();
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (cancelled()) throw 0;
      const k = (performance.now() - t0) / ms, e = from + (to - from) * (k * k * (3 - 2 * k));
      st.lake = e;
      move(r.left + r.width / 2, r.bottom - elevToPct(e) / 100 * r.height);
      await new Promise((res) => setTimeout(res, 30));
    }
  };

  // ---- modes, cameras, systems ------------------------------------------------
  app.setMode = (m) => {
    engine.setMode(m);
    $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('#buildBox').hidden = m !== 'build';
    if (m === 'build') showBuildEvent(+$('#year').value);
    const lg = $('#legend');
    const L = {
      xray: '<b>X-ray.</b> Rock and concrete turn to glass. Blue tracers are water in the 30 ft penstocks, white tracers the spillway tunnels, brown the old diversion tunnels. Click a red generator to select its unit.',
      pressure: `<b>Pressure.</b> Upstream face: water pressure, rising 1 psi every 2.31 ft (lines every 50 ft of depth). Downstream face: where the concrete is squeezed hardest (schematic).<div class="ramp"></div><div class="ramp-l"><span>0</span><span>${fmt.psi(157)}</span><span>${fmt.psi(315)}</span></div>`,
      section: '<b>Section through the crown.</b> Hatched: concrete, 45 ft at the crest, 660 ft at the base. Small squares: inspection galleries. Water is shaded by depth: darker means more pressure.',
    }[m];
    lg.hidden = !L; if (L) lg.innerHTML = L;
  };
  $$('#modes button').forEach((b) => b.addEventListener('click', () => {
    app.setMode(b.dataset.mode);
    if (b.dataset.mode === 'xray') engine.flyTo('xray');
    if (b.dataset.mode === 'section') engine.flyTo('section');
    if (b.dataset.mode === 'pressure') engine.flyTo('pressure');
    if (b.dataset.mode === 'build') engine.flyTo('overview');
  }));
  const camNames = { overview: 'Overview', downstream: 'Downstream face', upstream: 'Lake side', towers: 'Intake towers', powerhouse: 'Powerplant', spillway: 'Spillway', crest: 'Crest road', bridge: 'Bridge' };
  for (const [k, label] of Object.entries(camNames)) {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = label; b.dataset.cam = k;
    b.addEventListener('click', () => engine.flyTo(k)); $('#cams').appendChild(b);
  }

  const SYS = [
    { id: 'dam', hs: 'dam', label: 'Dam', sub: 'Arch-gravity wall', view: 'downstream' },
    { id: 'towers', hs: 'towers', label: 'Intake towers', sub: 'Water in', view: 'towers' },
    { id: 'penstocks', hs: 'penstocks', label: 'Penstocks', sub: '30 ft steel pipes', view: 'xray' },
    { id: 'powerhouse', hs: 'powerhouse', label: 'Powerplant', sub: '17 generators', view: 'powerhouse' },
    { id: 'spillways', hs: 'spillways', label: 'Spillways', sub: 'Flood safety', view: 'spillway' },
    { id: 'tunnels', hs: 'tunnels', label: 'Tunnels', sub: 'Spill + diversion', view: 'xray' },
    { id: 'lake', hs: 'lake', label: 'Lake Mead', sub: 'Storage', view: 'upstream' },
    { id: 'bridge', hs: 'bridge', label: 'Bridge', sub: 'US 93, 2010', view: 'bridge' },
  ];
  const sysEl = $('#systems');
  for (const s of SYS) {
    const b = document.createElement('button'); b.className = 'sys'; b.dataset.sys = s.id;
    b.innerHTML = `<i>${String(HOTSPOTS.find((h) => h.id === s.hs).n).padStart(2, '0')}</i><b>${s.label}</b><span>${s.sub}</span>`;
    b.addEventListener('click', () => pickSystem(s.id));
    sysEl.appendChild(b);
  }
  app.setFocus = (id) => {
    engine.setFocus(id && id !== 'lake' ? id : null);
    $$('.sys').forEach((b) => b.classList.toggle('on', b.dataset.sys === id));
  };
  function pickSystem(id) {
    const s = SYS.find((x) => x.id === id);
    if (engine.mode === 'build') app.setMode('normal');
    app.setFocus(id);
    engine.flyTo(s.view);
    showInfo(s.hs);
  }
  $('#sysAll').addEventListener('click', () => { app.setFocus(null); hideInfo(); engine.flyTo('overview'); });

  // ---- info card + callouts -------------------------------------------------
  const card = $('#infoCard');
  function showInfo(id) {
    const h = HOTSPOTS.find((x) => x.id === id); if (!h) return;
    $('#infoKicker').textContent = `${String(h.n).padStart(2, '0')} · ${h.kicker}`;
    $('#infoTitle').textContent = h.title; $('#infoBody').textContent = h.body;
    $('#infoFacts').innerHTML = h.facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    card.hidden = false; callouts.setActive(id);
  }
  function hideInfo() { card.hidden = true; callouts.setActive(null); }
  $('#infoClose').addEventListener('click', () => { hideInfo(); app.setFocus(null); });
  const callouts = new Callouts(engine, $('#callouts'), $('#leaders'), (id) => {
    const sys = { crest: 'dam', tailrace: 'powerhouse' }[id] || id;
    const s = SYS.find((x) => x.id === sys);
    if (s) { app.setFocus(sys); engine.flyTo(HOTSPOTS.find((h) => h.id === id).view in VIEWS ? HOTSPOTS.find((h) => h.id === id).view : s.view); }
    showInfo(id);
  });
  $('#labelsChk').addEventListener('change', (e) => callouts.setVisible(e.target.checked));
  $('#chartsChk').addEventListener('change', (e) => { $('#charts').hidden = !e.target.checked; });

  // ---- boulder, sound, fullscreen, hide ---------------------------------------
  $('#boulderBtn').addEventListener('click', () => { if (engine.mode === 'build') app.setMode('normal'); engine.dropBoulder(); });
  engine.on('impact', () => app.audio.splash(1.4));
  engine.on('splash', () => app.audio.splash(0.7));
  $('#soundBtn').addEventListener('click', () => { const on = app.audio.toggle(); $('#soundBtn').textContent = on ? '🔊' : '🔇'; $('#soundBtn').setAttribute('aria-pressed', on); });
  $('#fsBtn').addEventListener('click', () => { const s = $('#stage'); document.fullscreenElement ? document.exitFullscreen() : s.requestFullscreen?.(); });
  $('#hideBtn').addEventListener('click', () => document.body.classList.toggle('hide-ui'));
  document.addEventListener('click', (e) => { if (e.target.closest('button')) app.audio.click(); });

  // Build playback
  let playing = null;
  $('#buildPlay').addEventListener('click', () => {
    if (playing) { cancelAnimationFrame(playing); playing = null; $('#buildPlay').textContent = '▶ Play construction'; return; }
    const y = $('#year'); if (+y.value > 1936.7) y.value = 1931.2;
    $('#buildPlay').textContent = '❚❚ Pause';
    const stepFn = () => { y.value = Math.min(1936.9, +y.value + 0.012); y.dispatchEvent(new Event('input')); if (+y.value < 1936.9) playing = requestAnimationFrame(stepFn); else { playing = null; $('#buildPlay').textContent = '▶ Play construction'; } };
    stepFn();
  });

  // Keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'h') document.body.classList.toggle('hide-ui');
    else if (k === 'f') $('#fsBtn').click();
    else if (k === 's') $('#soundBtn').click();
    else if (k === 't') { tour.lastInput = 0; setTimeout(() => tour.start(), 50); }
    else if (k === ' ' && e.target === document.body) { e.preventDefault(); setSpeed(st.paused ? (st.speed || 1) : 0); }
    else if ('12345'.includes(k) && k) app.setMode(['normal', 'xray', 'pressure', 'section', 'build'][+k - 1]);
  });

  // ---- tour ------------------------------------------------------------------
  app.lakeScreenPoint = (x, z) => {
    const v = engine.camera.position.clone().set(x, engine.uniforms.uWaterY.value, z);
    if (!engine.lake.isWater(x, z)) return null;
    const p = engine.project(v); const r = engine.canvas.getBoundingClientRect();
    return p.behind ? null : { x: p.x + r.left, y: p.y + r.top, wx: x, wz: z };
  };
  app.onTourState = (on) => { $('#tourBtn').classList.toggle('live', on); $('#tourLabel').textContent = on ? 'Touring · click to stop' : 'Auto tour'; };
  const tour = new Tour(app);
  $('#tourBtn').addEventListener('click', (e) => { if (tour.running) tour.interrupt(); else { setTimeout(() => tour.start(), 30); } });

  // ---- per-frame HUD ------------------------------------------------------------
  const alertsEl = $('#alerts');
  let lastAlert = '';
  const lakeVal = $('#lakeVal');
  engine.onFrame((dt) => {
    const o = engine.out;
    if (engine.frame % 3 === 0) {
      const building = engine.mode === 'build';
      if (building) {
        $('#bigMW').textContent = Math.round((engine.buildProgress || 0) * 100);
        $('#bigUnit').textContent = '% POURED';
        $('#bigSub').textContent = `Construction view · ${$('#yearOut').textContent} · of 3.25 million yd³ of concrete`;
      } else {
        if ($('#bigUnit').textContent !== 'MW') { $('#bigUnit').textContent = 'MW'; $('#bigSub').innerHTML = '<span id="bigUnits"></span> · <span id="bigHomes"></span> homes\' average use'; }
        $('#bigMW').textContent = fmt.num(o.mw);
        $('#bigUnits').textContent = `${o.running} of 17 units`;
        $('#bigHomes').textContent = fmt.num(Math.round(o.homes / 1000) * 1000);
      }
      $('#tHead').textContent = fmt.len(o.gross);
      $('#tFlow').textContent = fmt.flow(o.turbQ);
      $('#tEta').textContent = o.running ? `${(o.eta * 100).toFixed(1)}%` : '—';
      $('#tPsi').textContent = fmt.psi(o.basePsi);
      $('#tThrust').textContent = fmt.force(o.thrust);
      $('#tSpill').textContent = o.spillQ > 1 ? fmt.flow(o.spillQ) : 'closed';
      const shownLake = engine.mode === 'build' ? (engine.buildLake ?? ELEV.riverbed) : st.lake;
      lakeVal.textContent = fmt.elevVal(shownLake); $('#lakeUnit').textContent = fmt.elevUnit();
      $('#lakePct').textContent = `${Math.max(0, Math.round((building ? storageAt(shownLake) / FULL_STORAGE : o.pct) * 100))}%`;
      $('#lakeTrend').textContent = fmt.rate(o.ftPerDay);
      const pct = Math.max(0, Math.min(100, elevToPct(shownLake)));
      fill.style.height = `${pct}%`; handle.style.bottom = `${pct}%`;
      track.setAttribute('aria-valuenow', Math.round(st.lake));
      const hh = Math.floor(st.hour), mm = Math.floor(st.hour % 1 * 60);
      $('#clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} NV`;
      const hourEl = $('#hour'); if (!st.paused && document.activeElement !== hourEl) { hourEl.value = st.hour; sHour.refresh(); }
      for (const u of st.units) { const b = unitBtns[u.id]; b.classList.toggle('on', u.on); b.style.setProperty('--h', `${Math.min(100, (u.mw || 0) / 122.4 * 100)}%`); }
      const key = o.warn.map((w) => w.text).join('|');
      if (key !== lastAlert) { lastAlert = key; alertsEl.innerHTML = o.warn.slice(0, 2).map((w) => `<div class="alert ${w.tone}">${w.text}</div>`).join(''); }
    }
    callouts.update();
    charts.update(dt);
    app.audio.update(o, engine.camera.position.distanceTo(engine.controls.target));
  });

  // Stop drawing the 3D scene while the stage is scrolled out of view.
  new IntersectionObserver((ents) => { engine.offscreen = !ents[0].isIntersecting; }, { threshold: 0.02 }).observe($('#stage'));

  // ---- labs below the fold ----------------------------------------------------
  initLabs(app);

  // ---- go --------------------------------------------------------------------
  applyScenario('normal');
  setBoot(100);
  engine.start();
  setTimeout(() => $('#boot').classList.add('done'), 250);
  // Deep links: ?scn=flood&mode=xray&view=spillway&hour=19&lake=1100&notour
  const q = new URLSearchParams(location.search);
  if (q.get('scn') && SCENARIOS[q.get('scn')]) applyScenario(q.get('scn'));
  if (q.get('lake')) st.lake = +q.get('lake');
  if (q.get('hour')) setRange('hour', +q.get('hour'));
  if (q.get('drum')) setRange('drum', +q.get('drum'));
  if (q.get('year')) setRange('year', +q.get('year'));
  if (q.get('mode')) app.setMode(q.get('mode'));
  if (q.get('focus')) pickSystem(q.get('focus'));
  if (q.get('view') && VIEWS[q.get('view')]) engine.jumpTo(q.get('view'));
  if (q.get('tab')) app.tab(q.get('tab'));
  if (q.has('pause')) setSpeed(0);
  if (q.has('clean')) document.body.classList.add('hide-ui', 'clean');
  if (q.has('q')) { engine.lockQuality = true; engine.setQuality(+q.get('q')); }
  if (q.has('notour')) tour.enabled = false;
  // First visit: start the tour after a short look around.
  else tour.lastInput = performance.now() - tour.idleMs + 9000;
}

main();
