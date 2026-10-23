/* R12 fix 3 (copy of r11-fix2-death.mjs): adds destroyer/mothership kinds; per-frame instrumentation round the kill (GL compileShader/linkProgram/texImage/bufferData counts, sim:death and fx:blast listener ms, fx.update ms, render ms, renderer.info.programs before/after); kill-frame peak luminance and clipped-pixel count inside the flash blob; optional --trace writes a CDP trace of kill-0.3 s..+1 s and lists its longest renderer events.
   R11 fix 2 (copy of r10-ev-death.mjs): capital kill takes. Harness changes: carrier and cruiser kinds; every frame is copied only to +0.22 s, then one rAF copy at each of +0.3/+1.0/+1.5/+3.0 s; wreck-section screen centres are logged at each of those, so the hull change is measured (adjacent section centre spacing growth, px); one strip PNG per take, cropped round the hull box. Frame-time log as R10.
   R10 EVIDENCE item 5 (copy of r9-ev-death.mjs): carrier kill takes. Changes, harness side only: every frame the game renders from kill-0.15 s to kill+10.1 s is time-stamped (no copies) for the frame-time table; the HUD screenshots inside that window are dropped (later = [12 s] only) so they cannot stall it.
   R8 EVIDENCE item 6: death strips and a hit-flash measurement, with
   requestAnimationFrame-timed captures instead of a CDP screencast.
   Setup as r7-ev-death.mjs (the harness behind R7/fix5-death-*): seed 13634,
   one hostile hull spawned 9 km above the field centre, scripted
   combat.applyDamage hits live at x1, game focus camera (rig.frameEntities).

   Capture: engine.render is wrapped; while a window is open, every frame the
   game renders is copied (drawImage, same task, so it is exactly the frame the
   loop drew) into a pooled 2D canvas with its performance.now() stamp. Frame
   times are reported relative to the moment applyDamage delivered the kill.

   Measurements, in-page:
   - hull bbox: matched mask at pre-hit (loop stopped, frame drawn with the
     hull in place and with it lifted 1e6 m, diff > 8 luminance), px.
   - flash bbox per captured frame: pixels whose luminance rose by > 40 over the
     last pre-kill frame AND are > 120, bbox in px. Ratio = flash bbox / hull
     bbox (area, and the larger of the width / height ratios).

   --kind interceptor | carrier : death strip, 00-prehit + 9 frames (10 max).
   --kind hitflash              : one non-lethal kinetic hit on an Assault
     Frigate seen from 1800 m (engagement range: twinAuto 1600 m, mainBattery
     3000 m), 3 frames (ref, peak, +200 ms).
   Usage: node r8-ev-death.mjs --kind interceptor --out <dir>/R8-death-interceptor-focus */
import { chromium } from '../../../node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

function findChromium() {
  const base = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const b = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, c) => Number(c.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of b) for (const r of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) { const p = path.join(base, d, r); if (fs.existsSync(p)) return p; }
}
const args = process.argv.slice(2);
const g = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const KIND = g('kind', 'interceptor');
const SEED = g('seed', '13634');
const BASE = g('base', 'http://127.0.0.1:8901');
const TRACE = args.includes('--trace');
const OUT = g('out', `shots/R8/evidence/R8-death-${KIND}-focus`);
const PLAN = {
  interceptor: { cls: 'interceptor', hits: [0, 0.2, 0.4], killAt: 0.55, win: [-0.08, 0.32], pool: 30, later: [0.6, 1.2, 3.0] },
  carrier: { cls: 'carrier', hits: [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1], killAt: 2.5, win: [-0.08, 0.22], pool: 24, later: [], marks: [0.3, 1.0, 1.5, 3.0] },
  destroyer: { cls: 'destroyer', hits: [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1], killAt: 2.5, win: [-0.08, 0.22], pool: 24, later: [], marks: [0.3, 1.0, 1.5, 3.0] },
  mothership: { cls: 'mothership', hits: [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1], killAt: 2.5, win: [-0.08, 0.22], pool: 24, later: [], marks: [0.3, 1.0, 1.5, 3.0, 5.0] },
  cruiser: { cls: 'cruiser', hits: [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1], killAt: 2.5, win: [-0.08, 0.22], pool: 24, later: [], marks: [0.3, 1.0, 1.5, 3.0] },
  hitflash: { cls: 'assaultFrigate', hits: [], killAt: 0.3, win: [-0.06, 0.3], pool: 24, later: [], camDist: 1800 },
}[KIND];

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--headless=new', '--use-angle=default', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = []; const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 300)));
await page.goto(`${BASE}/demos/void-sovereign/?autostart=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__VS && window.__VS.ready), null, { timeout: 240000 });
// R9: dismiss the tutorial card (as r8-ev-played / r9-ev-played do) so the HUD frames are clear of it. Harness-only change.
await page.evaluate(() => { const VS = window.__VS; const kill = () => { const t = VS.tutorial && VS.tutorial.tutorial; if (t && t.skip && !t.finished) { try { t.skip(); } catch (e) { /* */ } } for (const b of document.querySelectorAll('button')) if (/^\s*(dismiss|skip)\s*$/i.test(b.textContent || '')) b.click(); }; kill(); setInterval(kill, 1000); });
const T0 = Date.now();
await page.evaluate(() => {
  const t = window.__VS.tutorial && window.__VS.tutorial.tutorial;
  if (t && t.skip && !t.finished) { try { t.skip(); } catch (e) { /* no-op */ } }
  window.__VS.bus.emit('ui:speed', { scale: 1 });
});
await page.waitForTimeout(29000);

const setup = await page.evaluate(async ({ cls, kind, camDist }) => {
  const VS = window.__VS; const T = VS.THREE; const w = VS.world; const me = w.humanTeam; const foe = me ^ 1;
  const a = w.entities.get(w.teams[me].baseId).position; const b = w.entities.get(w.teams[foe].baseId).position;
  const P = a.clone().add(b).multiplyScalar(0.5).add(new T.Vector3(0, 9000, 0));
  const e = w.spawn(cls, foe, P, new T.Quaternion());
  e.velocity.set(0, 0, 0); e.orderQueue.length = 0;
  const rig = VS.cameraRig;
  if (kind === 'hitflash') {
    rig._yaw.target = 0.8; rig._yaw.snap(0.8); rig._pitch.target = 0.3; rig._pitch.snap(0.3);
    rig.focusOn(P.clone(), camDist, true); rig.follow([e]);
  } else rig.frameEntities([e], true);
  const combat = await import('./src/sim/combat.js');
  const cat = await import('./src/ships/catalog.js');
  /* capture hook */
  const eng = VS.engine; const cv = eng.renderer.domElement;
  const C = { on: false, frames: [], pool: [], max: 0 };
  const orig = eng.render.bind(eng);
  eng.render = function (dt, el) {
    orig(dt, el);
    if (window.__FT && window.__FT.on) window.__FT.t.push(performance.now());
    if (C.on && C.frames.length < C.max) {
      let c = C.pool[C.frames.length];
      if (!c) { c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; C.pool.push(c); }
      c.getContext('2d').drawImage(cv, 0, 0);
      C.frames.push({ t: performance.now(), c, hull: Math.round(100 * Math.max(0, e.hull) / e.maxHull), alive: e.alive });
    }
    const D = window.__D;
    if (D && D.killPerf && D.marks && D.marks.length) {
      const dtk = (performance.now() - D.killPerf) / 1000;
      if (D.secs0 === undefined) D.secs0 = D.secPx();
      while (D.marks.length && dtk >= D.marks[0]) {
        const m = D.marks.shift();
        const mc = document.createElement('canvas'); mc.width = cv.width; mc.height = cv.height; mc.getContext('2d').drawImage(cv, 0, 0);
        D.markFrames.push({ target: m, tMs: +(dtk * 1000).toFixed(1), c: mc, secs: D.secPx() });
      }
    }
  };
  const secPx = () => {
    const fx = VS.fx; if (!fx || !fx.wrecks) return null;
    const cam = eng.camera; cam.updateMatrixWorld(); const W = cv.width, H = cv.height; const v = new T.Vector3();
    return fx.wrecks._sections.filter((s) => s.L >= 300).map((s) => { v.copy(s.pos); if (s.kick) v.addScaledVector(s.kick, fx.wrecks.constructor.breakEase(s.age, s.delay)); v.project(cam); return [Math.round((v.x + 1) * W / 2), Math.round((1 - v.y) * H / 2)]; });
  };
  const gl = eng.renderer.getContext();
  const I = { frames: [], cur: null, on: false };
  const bump = (k, n) => { if (I.on && I.cur) I.cur[k] = (I.cur[k] || 0) + (n || 1); };
  const wrapGl = (name, sz) => { const o = gl[name].bind(gl); gl[name] = function (...a) { const t = performance.now(); const r = o(...a); if (I.on && I.cur) { bump(name, 1); I.cur[name + 'Ms'] = +(((I.cur[name + 'Ms'] || 0) + performance.now() - t).toFixed(2)); if (sz) bump(name + 'Bytes', sz(a)); } return r; }; };
  wrapGl('compileShader'); wrapGl('linkProgram'); wrapGl('getProgramParameter'); wrapGl('texImage2D'); wrapGl('texImage3D'); wrapGl('texSubImage2D');
  wrapGl('bufferData', (a) => (a[1] && a[1].byteLength) || (typeof a[1] === 'number' ? a[1] : 0));
  wrapGl('bufferSubData', (a) => (a[2] && a[2].byteLength) || 0);
  const be = VS.bus.emit.bind(VS.bus);
  VS.bus.emit = function (type, p) { if (!I.on || !I.cur || (type !== 'sim:death' && type !== 'fx:blast')) return be(type, p); const t = performance.now(); const r = be(type, p); I.cur[type + 'Ms'] = +(((I.cur[type + 'Ms'] || 0) + performance.now() - t).toFixed(2)); return r; };
  const fxu = VS.fx.update.bind(VS.fx);
  VS.fx.update = function (...a) { const t = performance.now(); const r = fxu(...a); if (I.on && I.cur) I.cur.fxMs = +(performance.now() - t).toFixed(2); return r; };
  const wk = VS.world.tick.bind(VS.world);
  VS.world.tick = function (...a) { const t = performance.now(); const r = wk(...a); if (I.on && I.cur) I.cur.tickMs = +(((I.cur.tickMs || 0) + performance.now() - t).toFixed(2)); return r; };
  const ren = eng.render;
  eng.render = function (dt, el) { const t = performance.now(); ren.call(eng, dt, el); if (I.on && I.cur) { I.cur.renderMs = +(performance.now() - t).toFixed(2); I.cur.t = performance.now(); I.cur.programs = eng.renderer.info.programs.length; I.frames.push(I.cur); } I.cur = I.on ? {} : null; };
  window.__I = I;
  window.__D = { e, P, combat, cat, C, events: [], marks: null, markFrames: [], secPx };
  const dbg = eng.renderer.getContext().getExtension('WEBGL_debug_renderer_info'); return { glRenderer: dbg ? eng.renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, bootMs: VS.lastBuildMs, deathWarmMs: VS.deathWarmMs, id: e.id, classId: e.classId, name: e.def.name, lengthM: e.def.length, maxHull: e.maxHull, maxShield: e.maxShield, armour: e.def.armour || 0, canvas: [cv.width, cv.height] };
}, { cls: PLAN.cls, kind: KIND, camDist: PLAN.camDist || 0 });

await page.waitForTimeout(3500); // >= 3 s at x1 before the first hit

/* Pre-hit matched hull mask (loop paused for the grabs, timed). */
const pre = await page.evaluate(() => {
  const VS = window.__VS; const loop = VS.loop; const eng = VS.engine; const cv = eng.renderer.domElement; const e = window.__D.e;
  const W = cv.width, H = cv.height;
  const F0 = eng._post && typeof eng._post._frame === 'number' ? eng._post._frame : null;
  const grab = () => { if (eng._post) { eng._post._historyValid = false; if (F0 !== null) eng._post._frame = F0; } eng.render(0, loop.elapsed); const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(cv, 0, 0); return { c, d: x.getImageData(0, 0, W, H).data }; };
  const t0 = performance.now();
  loop.stop();
  const on = grab(); window.__D.preCanvas = on.c;
  const P = e.position.clone(); const PP = e.prevPosition ? e.prevPosition.clone() : null;
  e.position.y += 1e6; if (e.prevPosition) e.prevPosition.y += 1e6; VS.world.syncTransforms(loop.alpha);
  const off = grab();
  e.position.copy(P); if (PP) e.prevPosition.copy(PP); VS.world.syncTransforms(loop.alpha);
  eng.render(0, loop.elapsed);
  loop.start();
  const pauseMs = +(performance.now() - t0).toFixed(1);
  const lum = (D, i) => 0.2126 * D[i] + 0.7152 * D[i + 1] + 0.0722 * D[i + 2];
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (Math.abs(lum(on.d, i) - lum(off.d, i)) > 8) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  const maskBox = n ? [x0, y0, x1, y1] : null;
  const cam = eng.camera; cam.updateMatrixWorld(); const T = VS.THREE; const p = new T.Vector3(); let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9, nv = 0;
  if (e.object3D) e.object3D.traverse((o) => { if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return; o.updateMatrixWorld(); const pa = o.geometry.attributes.position; const st = Math.max(1, Math.floor(pa.count / 2000)); for (let i = 0; i < pa.count; i += st) { p.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld).project(cam); if (p.z > 1) continue; nv++; const X = (p.x + 1) * W / 2, Y = (1 - p.y) * H / 2; gx0 = Math.min(gx0, X); gx1 = Math.max(gx1, X); gy0 = Math.min(gy0, Y); gy1 = Math.max(gy1, Y); } });
  const geoBox = nv ? [gx0, gy0, gx1, gy1].map((v, i) => Math.round(Math.max(0, Math.min(v, i % 2 ? H - 1 : W - 1)))) : null;
  window.__D.hullBox = geoBox || maskBox;
  window.__D.maskBox = maskBox; window.__D.geoVerts = nv;
  const r = VS.engine.renderer.info.render;
  return { pauseMs, hullPx: n, maskBox, geoBox, geoVerts: nv, hullBox: window.__D.hullBox, camDist: Math.round(VS.engine.camera.position.distanceTo(e.position)), calls: r.calls, tris: r.triangles, url: on.c.toDataURL('image/png') };
});
fs.writeFileSync(`${OUT}-00-prehit.png`, Buffer.from(pre.url.split(',')[1], 'base64'));
delete pre.url;

/* Fire the schedule in-page; open the capture window around the kill. */
await page.evaluate((m) => { window.__MARKS = m; }, PLAN.marks || []);
const sched = await page.evaluate(({ hits, killAt, win, pool, kind }) => {
  const D = window.__D; const w = window.__VS.world; const e = D.e; const C = D.C;
  const aff = D.cat.damageAffinity('kinetic', e.role) || 1;
  const n = Math.max(1, hits.length);
  const through = (0.9 * e.maxHull) / n;
  const raw = (e.maxShield / n + through / Math.max(0.05, 1 - (e.def.armour || 0))) / aff;
  const cam = window.__VS.engine.camera.position;
  const from = () => { const v = cam.clone().sub(e.position).normalize().multiplyScalar(3000); v.x += (Math.random() - 0.5) * 1500; v.y += (Math.random() - 0.5) * 600; return e.position.clone().add(v); };
  const start = Date.now();
  hits.forEach((h) => setTimeout(() => { const f = from(); D.combat.applyDamage(w, e, raw, 'kinetic', null, f.x, f.y, f.z); D.events.push({ t: (Date.now() - start) / 1000, what: 'hit', hullPct: Math.round(100 * Math.max(0, e.hull) / e.maxHull) }); }, h * 1000));
  setTimeout(() => { C.max = pool; C.on = true; }, (killAt + win[0]) * 1000);
  D.marks = (window.__MARKS || []).slice();
  setTimeout(() => {
    const f = from();
    D.killPerf = performance.now();
    if (kind === 'hitflash') {
      const dmg = (e.maxShield + 0.1 * e.maxHull / Math.max(0.05, 1 - (e.def.armour || 0))) / aff;
      D.combat.applyDamage(w, e, dmg, 'kinetic', null, f.x, f.y, f.z);
      D.events.push({ t: (Date.now() - start) / 1000, what: 'hit', hullPct: Math.round(100 * Math.max(0, e.hull) / e.maxHull), alive: e.alive });
    } else {
      D.combat.applyDamage(w, e, 1e8, 'kinetic', null, f.x, f.y, f.z);
      D.events.push({ t: (Date.now() - start) / 1000, what: 'kill', alive: e.alive });
    }
  }, killAt * 1000);
  setTimeout(() => { C.on = false; }, (killAt + win[1]) * 1000);
  window.__FT = { on: false, t: [] };
  const I = window.__I; const progNames = () => window.__VS.engine.renderer.info.programs.map((p) => p.name || p.cacheKey.slice(0, 60));
  setTimeout(() => { D.prog0 = progNames(); I.on = true; I.cur = {}; }, (killAt - 0.3) * 1000);
  setTimeout(() => { D.prog1 = progNames(); }, (killAt + 1.0) * 1000);
  setTimeout(() => { I.on = false; D.prog2 = progNames(); }, (killAt + 9.5) * 1000);
  setTimeout(() => { window.__FT.on = true; }, (killAt - 0.15) * 1000);
  setTimeout(() => { window.__FT.on = false; }, (killAt + 10.1) * 1000);
  return { startEpoch: start, killEpoch: start + killAt * 1000 };
}, { hits: PLAN.hits, killAt: PLAN.killAt, win: PLAN.win, pool: PLAN.pool, kind: KIND });

if (TRACE) {
  const cdp = await page.context().newCDPSession(page);
  const evs = [];
  cdp.on('Tracing.dataCollected', (d) => { for (const e of d.value) evs.push(e); });
  await page.waitForTimeout(Math.max(0, sched.killEpoch - 300 - Date.now()));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8,gpu,blink', transferMode: 'ReportEvents' });
  await page.waitForTimeout(Math.max(0, sched.killEpoch + 1000 - Date.now()));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end'); await done;
  fs.writeFileSync(OUT + '-trace.json', JSON.stringify(evs));
  const longest = evs.filter((e) => e.ph === 'X' && e.dur > 8000).sort((a, b) => b.dur - a.dur).slice(0, 25).map((e) => ({ name: e.name, cat: e.cat, ms: +(e.dur / 1000).toFixed(1), ts: e.ts, tid: e.tid, pid: e.pid, data: e.args && e.args.data ? JSON.stringify(e.args.data).slice(0, 160) : undefined }));
  global.__traceEvents = { count: evs.length, longest };
}
/* Later frames: page screenshots at offsets from the kill (HUD on). */
const later = [];
for (const off of PLAN.later) {
  await page.waitForTimeout(Math.max(0, sched.killEpoch + off * 1000 - Date.now()));
  later.push({ target: off, actual: +((Date.now() - sched.killEpoch) / 1000).toFixed(3), buf: await page.screenshot({ type: 'png' }) });
}
await page.waitForTimeout(Math.max(0, sched.killEpoch + 10400 - Date.now())); // R11: measure after the frame-time window, so the in-page measurement cannot stall it

/* Measure every captured frame; export the chosen ones. */
const cap = await page.evaluate(({ kind }) => {
  const D = window.__D; const C = D.C; const hb = D.hullBox;
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const data = C.frames.map((f) => f.c.getContext('2d').getImageData(0, 0, f.c.width, f.c.height).data);
  const W = C.frames.length ? C.frames[0].c.width : 1600; const H = C.frames.length ? C.frames[0].c.height : 900;
  let ref = -1; for (let k = 0; k < C.frames.length; k++) if (C.frames[k].t < D.killPerf) ref = k;
  const hbW = hb ? hb[2] - hb[0] + 1 : 0; const hbH = hb ? hb[3] - hb[1] + 1 : 0;
  const rows = C.frames.map((f, k) => {
    const row = { k, tMs: +(f.t - D.killPerf).toFixed(1), hull: f.hull, alive: f.alive };
    if (ref < 0 || k <= ref) return row;
    const A = data[k]; const R = data[ref];
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const la = lum(A, i); if (la > 120 && la - lum(R, i) > 40) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (n) {
      const M = new Uint8Array(W * H); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * W + x) * 4; const la = lum(A, i); if (la > 120 && la - lum(R, i) > 40) M[y * W + x] = 1; }
      let best = null; const st = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (M[y * W + x] !== 1) continue; let c = 0, a0 = x, b0 = y, a1 = x, b1 = y; st.push(y * W + x); M[y * W + x] = 2; while (st.length) { const q = st.pop(); const qx = q % W, qy = (q / W) | 0; c++; if (qx < a0) a0 = qx; if (qx > a1) a1 = qx; if (qy < b0) b0 = qy; if (qy > b1) b1 = qy; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (M[j] === 1) { M[j] = 2; st.push(j); } } } if (!best || c > best.c) best = { c, box: [a0, b0, a1, b1] }; }
      row.allBox = [x0, y0, x1, y1]; row.blobPx = best.c; x0 = best.box[0]; y0 = best.box[1]; x1 = best.box[2]; y1 = best.box[3];
      const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
      row.flashPx = n; row.flashBox = [x0, y0, x1, y1];
      { let mx = 0, clip = 0, warm = 0, hot = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * W + x) * 4; const la = lum(A, i); if (la > mx) mx = la; if (A[i] >= 250 && A[i + 1] >= 250 && A[i + 2] >= 250) clip++; if (la > 120 && la - lum(R, i) > 40) { hot++; if (A[i] - A[i + 2] > 60) warm++; } } row.peakLum = Math.round(mx); row.clipPx = clip; row.clipFrac = hot ? +(clip / hot).toFixed(3) : 0; row.warmFrac = hot ? +(warm / hot).toFixed(3) : 0; }
      if (hb) { row.areaRatio = +((fw * fh) / (hbW * hbH)).toFixed(2); row.wRatio = +(fw / hbW).toFixed(2); row.hRatio = +(fh / hbH).toFixed(2); row.maxDimRatio = +Math.max(fw / hbW, fh / hbH).toFixed(2); }
    } else row.flashPx = 0;
    return row;
  });
  /* choose frames to export */
  const post = rows.filter((r) => r.k > ref);
  const pickAt = (ms) => { let best = null; for (const r of post) if (r.tMs >= ms && (!best || r.tMs < best.tMs)) best = r; return best; };
  const want = [];
  if (ref >= 0) want.push({ tag: 'ref-prekill', r: rows[ref] });
  if (kind === 'hitflash') {
    let peak = null; for (const r of post) if (!peak || (r.flashPx || 0) > (peak.flashPx || 0)) peak = r;
    if (peak) want.push({ tag: 'peak', r: peak });
    const l = pickAt(200); if (l) want.push({ tag: 'later', r: l });
  } else {
    if (post[0]) want.push({ tag: 'kill', r: post[0] });
    if (post[1]) want.push({ tag: 'kill-next', r: post[1] });
    let peak = null; for (const r of post) if (r.tMs <= 200 && (!peak || (r.areaRatio || 0) > (peak.areaRatio || 0))) peak = r;
    if (peak && !want.some((w) => w.r === peak)) want.push({ tag: 'peak', r: peak });
    for (const ms of kind === 'interceptor' ? [60, 120, 250] : [100]) { const r = pickAt(ms); if (r && !want.some((w) => w.r === r)) want.push({ tag: 'k' + ms, r }); }
  }
  /* strip: crop round the hull box (2.2x its larger side), 300 px tiles */
  const tiles = want.map((w) => ({ tag: w.tag + ' ' + w.r.tMs + 'ms', c: C.frames[w.r.k].c }))
    .concat(D.markFrames.map((m) => ({ tag: '+' + m.target + 's (' + m.tMs + 'ms)', c: m.c })));
  const cx = hb ? (hb[0] + hb[2]) / 2 : W / 2; const cy = hb ? (hb[1] + hb[3]) / 2 : H / 2;
  const side = Math.min(H, Math.max(200, 1.5 * Math.max(hbW, hbH)));
  const TS = 300; const cols = Math.min(5, tiles.length + 1); const rowsN = Math.ceil((tiles.length + 1) / cols);
  const strip = document.createElement('canvas'); strip.width = cols * TS; strip.height = rowsN * TS; const sx = strip.getContext('2d'); sx.fillStyle = '#000'; sx.fillRect(0, 0, strip.width, strip.height);
  const all = [{ tag: 'prehit', c: D.preCanvas }].concat(tiles);
  all.forEach((t, i) => { if (!t.c) return; const X = (i % cols) * TS, Y = Math.floor(i / cols) * TS; sx.drawImage(t.c, cx - side / 2, cy - side / 2, side, side, X, Y, TS, TS); sx.fillStyle = '#fff'; sx.font = '13px monospace'; sx.fillText(t.tag, X + 5, Y + 15); });
  const stripUrl = strip.toDataURL('image/png');
  const marks = D.markFrames.map((m) => ({ target: m.target, tMs: m.tMs, secs: m.secs }));
  const secs0 = D.secs0;
  const out = want.map((w) => ({ tag: w.tag, k: w.r.k, tMs: w.r.tMs, url: C.frames[w.r.k].c.toDataURL('image/png') }));
  const r = window.__VS.engine.renderer.info.render;
  return { stripUrl, marks, secs0, ref, hullBoxW: hbW, hullBoxH: hbH, rows, out, events: D.events, calls: r.calls, tris: r.triangles, gameS: +window.__VS.world.time.toFixed(1), busErrors: (window.__VS.busErrors || []).length };
}, { kind: KIND });

const saved = [];
let idx = 1;
for (const o of cap.out) {
  const f = `${OUT}-${String(idx++).padStart(2, '0')}-${o.tag}.png`;
  fs.writeFileSync(f, Buffer.from(o.url.split(',')[1], 'base64'));
  saved.push({ file: path.basename(f), tMsFromKill: o.tMs, k: o.k, method: 'rAF canvas copy (no HUD)' });
}
for (const l of later) {
  const f = `${OUT}-${String(idx++).padStart(2, '0')}-plus${l.target}s.png`;
  fs.writeFileSync(f, l.buf);
  saved.push({ file: path.basename(f), sFromKillTarget: l.target, sFromKillActual: l.actual, method: 'page screenshot (HUD on)' });
}
delete cap.out;
fs.writeFileSync(`${OUT}-strip.png`, Buffer.from(cap.stripUrl.split(',')[1], 'base64')); delete cap.stripUrl;
/* hull change: spacing between adjacent wreck-section screen centres vs the kill frame */
const spacing = (a) => (a && a.length > 1 ? a.slice(1).map((q, i) => Math.hypot(q[0] - a[i][0], q[1] - a[i][1])) : []);
const s0 = spacing(cap.secs0);
cap.hullChange = cap.marks.map((m) => { const s = spacing(m.secs); const grow = s.map((v, i) => +(v - (s0[i] || 0)).toFixed(1)); return { target: m.target, tMs: m.tMs, sections: m.secs ? m.secs.length : 0, spacingGrowPx: grow, maxGrowPx: grow.length ? Math.max(...grow) : 0 }; });
await page.waitForTimeout(Math.max(0, sched.killEpoch + 10300 - Date.now()));
const inst = await page.evaluate(() => { const D = window.__D; const k = D.killPerf; const fr = window.__I.frames.map((f) => Object.assign({}, f, { t: +(f.t - k).toFixed(1) })).filter((f) => f.t > -60 && f.t < 9000); const newProg = (a, b) => (b || []).filter((x) => !(a || []).includes(x)); const heavy = fr.filter((f) => (f.renderMs || 0) > 20 || f.compileShader || f.linkProgram || f.texImage2D || f.texImage3D || (f.bufferDataBytes || 0) > 200000); return { programsBefore: (D.prog0 || []).length, programsAfter1s: (D.prog1 || []).length, programsAfter9s: (D.prog2 || []).length, newPrograms1s: newProg(D.prog0, D.prog1), newPrograms9s: newProg(D.prog0, D.prog2), killFrames: fr.filter((f) => f.t >= -40 && f.t <= 120), heavy: heavy.slice(0, 30) }; });
let traceSummary = null;
if (TRACE && global.__traceEvents) traceSummary = global.__traceEvents;
const ft = await page.evaluate(() => { const k = window.__D.killPerf; const t = window.__FT.t.map((x) => +(x - k).toFixed(1)).filter((x) => x >= -100 && x <= 10000); const gaps = []; for (let i = 1; i < t.length; i++) gaps.push({ at: t[i], gap: +(t[i] - t[i - 1]).toFixed(1) }); const gs = gaps.map((g) => g.gap).sort((a, b) => a - b); const pc = (q) => gs.length ? gs[Math.min(gs.length - 1, Math.floor(q * gs.length))] : null; const max = gaps.reduce((m, g) => (!m || g.gap > m.gap ? g : m), null); const killGap = gaps.find((g) => g.at >= 0) || null; return { frames: t.length, first: t[0], last: t[t.length - 1], p50: pc(0.5), p95: pc(0.95), p99: pc(0.99), max, killGap, over33: gaps.filter((g) => g.gap > 33.4).length, over50: gaps.filter((g) => g.gap > 50).length, over100: gaps.filter((g) => g.gap > 100).length, worst5: gaps.slice().sort((a, b) => b.gap - a.gap).slice(0, 5), times: t }; });
await page.close();
await browser.close();
console.log(JSON.stringify({ inst, traceSummary, frameTimes: ft, kind: KIND, seed: SEED, realSinceReadyAtEnd: +((Date.now() - T0) / 1000).toFixed(1), setup, pre, saved, capture: cap, consoleErrors, pageErrors }, null, 1));
