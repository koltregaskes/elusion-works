/* Stepped death take for a GPU-less container (SwiftShader runs ~1 fps, so
   wall-clock windows like r12-fix3-death.mjs cannot work here).

   Same setup as r12-fix3-death.mjs: seed 13634, one hostile hull spawned 9 km
   above the field centre, scripted combat.applyDamage hits, game focus camera
   (rig.frameEntities). Then the game loop is stopped and frames are stepped
   by hand at a fixed dt of 1/60 s (sim at its own 30 Hz), so every frame is
   the frame the game would draw at 60 fps, whatever the host speed.

   Measured per stepped frame: JS ms of world.tick, fx.update and the whole
   render call; GL compileShader / linkProgram / texImage / bufferData counts;
   renderer.info.programs. Kill-frame flash box against the hull box exactly
   as r12-fix3-death.mjs (lum > 120 and rise > 40 over the last pre-kill frame,
   largest 2 px-connected blob), plus warm and clipped fractions.

   Usage: node death-step.mjs --kind carrier --out <prefix> [--base URL] [--q medium] [--w 1280 --h 720] */
import { chromium } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const g = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const KIND = g('kind', 'carrier');
const SEED = g('seed', '13634');
const BASE = g('base', 'http://127.0.0.1:8901');
const Q = g('q', 'medium');
const W = Number(g('w', 1280)), H = Number(g('h', 720));
const OUT = g('out', 'out/' + KIND);
const TAKE = Number(g('take', 1));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const PLAN = {
  interceptor: { cls: 'interceptor', hits: 3 },
  frigate: { cls: 'assaultFrigate', hits: 4 },
  destroyer: { cls: 'destroyer', hits: 8 },
  cruiser: { cls: 'cruiser', hits: 8 },
  carrier: { cls: 'carrier', hits: 8 },
  mothership: { cls: 'mothership', hits: 8 },
}[KIND];
/* Frames captured, in 1/60 s steps from the kill frame (0). Later marks are
   reached in coarse steps (see stepTo) and settled with 8 fine frames first. */
const FINE = [0, 1, 2, 3, 4, 6, 9, 13];
const MARKS = KIND === 'mothership' ? [0.3, 1.0, 1.5, 3.0, 3.2, 5.0] : [0.3, 1.0, 1.5, 3.0];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const consoleErrors = []; const pageErrors = []; const failed = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 300)));
page.on('requestfailed', (r) => failed.push(r.url()));
const T0 = Date.now();
await page.goto(`${BASE}/demos/void-sovereign/?autostart=1&seed=${SEED}&quality=${Q}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__VS && window.__VS.ready), null, { timeout: 600000 });
const bootS = (Date.now() - T0) / 1000;

const setup = await page.evaluate(async ({ cls, take }) => {
  const VS = window.__VS; const T = VS.THREE; const w = VS.world; const me = w.humanTeam; const foe = me ^ 1;
  const t = VS.tutorial && VS.tutorial.tutorial; if (t && t.skip && !t.finished) { try { t.skip(); } catch (e) { /* */ } }
  for (const b of document.querySelectorAll('button')) if (/^\s*(dismiss|skip)\s*$/i.test(b.textContent || '')) b.click();
  const loop = VS.loop; loop.stop();
  const a = w.entities.get(w.teams[me].baseId).position; const b = w.entities.get(w.teams[foe].baseId).position;
  const P = a.clone().add(b).multiplyScalar(0.5).add(new T.Vector3(0, 9000, 0));
  const e = w.spawn(cls, foe, P, new T.Quaternion());
  e.velocity.set(0, 0, 0); e.orderQueue.length = 0;
  VS.cameraRig.frameEntities([e], true);
  const combat = await import('./src/sim/combat.js');
  const cat = await import('./src/ships/catalog.js');
  const eng = VS.engine; const cv = eng.renderer.domElement; const gl = eng.renderer.getContext();
  const I = { cur: null };
  const bump = (k, n) => { if (I.cur) I.cur[k] = (I.cur[k] || 0) + (n || 1); };
  for (const [name, sz] of [['compileShader'], ['linkProgram'], ['texImage2D'], ['texImage3D'], ['texSubImage2D'],
    ['bufferData', (a2) => (a2[1] && a2[1].byteLength) || (typeof a2[1] === 'number' ? a2[1] : 0)], ['bufferSubData', (a2) => (a2[2] && a2[2].byteLength) || 0]]) {
    const o = gl[name].bind(gl); gl[name] = function (...a2) { const r = o(...a2); bump(name); if (sz) bump(name + 'Bytes', sz(a2)); return r; };
  }
  const fxu = VS.fx.update.bind(VS.fx);
  VS.fx.update = function (...a2) { const t0 = performance.now(); const r = fxu(...a2); if (I.cur) I.cur.fxMs = +(performance.now() - t0).toFixed(2); return r; };
  const be = VS.bus.emit.bind(VS.bus);
  VS.bus.emit = function (type, p) { if (!I.cur || (type !== 'sim:death' && type !== 'fx:blast')) return be(type, p); const t0 = performance.now(); const r = be(type, p); I.cur[type + 'Ms'] = +(((I.cur[type + 'Ms'] || 0) + performance.now() - t0).toFixed(2)); return r; };
  let accum = 0; let elapsed = loop.elapsed;
  const DT = 1 / 60;
  /* One frame exactly as Loop._frame does it, at a fixed dt. */
  const frame = (dt = DT, capture = false) => {
    I.cur = {};
    const f0 = performance.now();
    elapsed += dt; loop.elapsed = elapsed;
    accum += dt * loop.timeScale;
    let steps = 0;
    while (accum >= loop.step - 1e-9 && steps < 5) { const t0 = performance.now(); w.tick(loop.step); I.cur.tickMs = +(((I.cur.tickMs || 0) + performance.now() - t0).toFixed(2)); loop.tick++; accum -= loop.step; steps++; }
    if (steps === 5) accum = 0;
    loop.alpha = Math.max(0, accum / loop.step);
    w.syncTransforms(loop.alpha);
    const r0 = performance.now();
    eng.render(dt, elapsed);
    I.cur.renderMs = +(performance.now() - r0).toFixed(2);
    I.cur.cpuMs = +(performance.now() - f0).toFixed(2);
    I.cur.programs = eng.renderer.info.programs.length;
    let c = null;
    if (capture) { c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); }
    const row = I.cur; I.cur = null;
    return { row, c, hull: Math.round(100 * Math.max(0, e.hull) / e.maxHull), alive: e.alive, t: w.time };
  };
  const secPx = () => {
    const fx = VS.fx; if (!fx || !fx.wrecks) return null;
    const cam = eng.camera; cam.updateMatrixWorld(); const v = new T.Vector3();
    return fx.wrecks._sections.filter((s) => s.L >= 300).map((s) => { v.copy(s.pos); if (s.kick) v.addScaledVector(s.kick, fx.wrecks.constructor.breakEase(s.age, s.delay)); v.project(cam); return [Math.round((v.x + 1) * cv.width / 2), Math.round((1 - v.y) * cv.height / 2)]; });
  };
  window.__D = { e, P, combat, cat, frame, secPx, take };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { glRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, bootMs: VS.lastBuildMs, deathWarmMs: VS.deathWarmMs, name: e.def.name, lengthM: e.def.length, canvas: [cv.width, cv.height], camDist: Math.round(eng.camera.position.distanceTo(e.position)) };
}, { cls: PLAN.cls, take: TAKE });

/* Settle the focus camera, then the scripted hits 0.3 s apart, then settle. */
const run = (fn, arg) => page.evaluate(fn, arg);
const steps = async (n, dt) => run(({ n, dt }) => { for (let i = 0; i < n; i++) window.__D.frame(dt); }, { n, dt });
await steps(30, 1 / 30); // 1 s
await steps(10, 1 / 60);
await run(({ hits }) => {
  const D = window.__D; const w = window.__VS.world; const e = D.e;
  const aff = D.cat.damageAffinity('kinetic', e.role) || 1;
  const through = (0.9 * e.maxHull) / hits;
  D.raw = (e.maxShield / hits + through / Math.max(0.05, 1 - (e.def.armour || 0))) / aff;
  /* Deterministic hit origins (the original drew them from Math.random). */
  let s = 1234567 + D.take * 7919; D.rand = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0) / 4294967296);
  D.from = () => { const cam = window.__VS.engine.camera.position; const v = cam.clone().sub(e.position).normalize().multiplyScalar(3000); v.x += (D.rand() - 0.5) * 1500; v.y += (D.rand() - 0.5) * 600; return e.position.clone().add(v); };
}, { hits: PLAN.hits });
for (let h = 0; h < PLAN.hits; h++) {
  await run(() => { const D = window.__D; const f = D.from(); D.combat.applyDamage(window.__VS.world, D.e, D.raw, 'kinetic', null, f.x, f.y, f.z); });
  await steps(6, 1 / 20); // 0.3 s
}
await steps(20, 1 / 20); // let the hit FX die down, 1 s
await steps(16, 1 / 60); // converge TAA at the real frame rate

/* Pre-kill reference frame and the hull box (matched mask, hull lifted 1e6 m). */
const pre = await run(() => {
  const VS = window.__VS; const D = window.__D; const e = D.e; const eng = VS.engine; const cv = eng.renderer.domElement; const loop = VS.loop;
  const Wc = cv.width, Hc = cv.height;
  const ref = D.frame(1 / 60, true); D.preCanvas = ref.c; D.refRow = ref.row;
  const cam = eng.camera; cam.updateMatrixWorld(); const T = VS.THREE; const p = new T.Vector3(); let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9, nv = 0;
  if (e.object3D) e.object3D.traverse((o) => { if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return; o.updateMatrixWorld(); const pa = o.geometry.attributes.position; const st = Math.max(1, Math.floor(pa.count / 2000)); for (let i = 0; i < pa.count; i += st) { p.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld).project(cam); if (p.z > 1) continue; nv++; const X = (p.x + 1) * Wc / 2, Y = (1 - p.y) * Hc / 2; gx0 = Math.min(gx0, X); gx1 = Math.max(gx1, X); gy0 = Math.min(gy0, Y); gy1 = Math.max(gy1, Y); } });
  D.hullBox = nv ? [gx0, gy0, gx1, gy1].map((v, i) => Math.round(Math.max(0, Math.min(v, i % 2 ? Hc - 1 : Wc - 1)))) : [Wc / 3, Hc / 3, 2 * Wc / 3, 2 * Hc / 3];
  return { hullBox: D.hullBox, hullPct: Math.round(100 * e.hull / e.maxHull), camDist: Math.round(eng.camera.position.distanceTo(e.position)), url: ref.c.toDataURL('image/png') };
});
fs.writeFileSync(`${OUT}-00-prehit.png`, Buffer.from(pre.url.split(',')[1], 'base64')); delete pre.url;

/* The kill, delivered between frames as the sim would deliver it, then FINE frames. */
const kill = await run(({ FINE }) => {
  const D = window.__D; const e = D.e; const f = D.from();
  D.combat.applyDamage(window.__VS.world, e, 1e8, 'kinetic', null, f.x, f.y, f.z);
  D.frames = []; D.rows = [];
  D.secs0 = null;
  const last = FINE[FINE.length - 1];
  for (let k = 0; k <= last; k++) {
    const r = D.frame(1 / 60, FINE.includes(k));
    if (k === 0) D.secs0 = D.secPx();
    D.rows.push(Object.assign({ k, tMs: +(k * 1000 / 60).toFixed(1), hull: r.hull, alive: r.alive }, r.row));
    if (r.c) D.frames.push({ k, c: r.c });
  }
  return { alive: e.alive };
}, { FINE });

/* Later marks: coarse 1/30 s frames, then 8 fine ones landing on the mark. */
let tNow = FINE[FINE.length - 1] / 60;
const marks = [];
const PROF = args.includes('--profile');
let cdp = null; if (PROF) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); }
const allRows = [];
for (const m of MARKS) {
  if (PROF && m === 1.5) await cdp.send('Profiler.start');
  const settle = 8 / 60;
  const coarse = Math.max(0, Math.round((m - settle - tNow) * 30));
  await steps(coarse, 1 / 30); tNow += coarse / 30;
  const fine = Math.max(1, Math.round((m - tNow) * 60));
  const r = await run(({ fine, m }) => { const D = window.__D; let r; const rows = []; for (let i = 0; i < fine; i++) { r = D.frame(1 / 60, i === fine - 1); rows.push(r.row); } D.frames.push({ k: 'm' + m, c: r.c }); return { secs: D.secPx(), rows }; }, { fine, m });
  tNow += fine / 60;
  r.rows.forEach((x, i) => allRows.push(Object.assign({ mark: m, i }, x)));
  if (PROF && m === 1.5) { const { profile } = await cdp.send('Profiler.stop'); const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n])); const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').slice(-2).join('/') + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); }); fs.writeFileSync(OUT + '-prof.json', JSON.stringify([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40), null, 1)); }
  marks.push({ target: m, tS: +tNow.toFixed(3), secs: r.secs, maxCpuMs: Math.max(...r.rows.map((x) => x.cpuMs)), worst: r.rows.reduce((a, x) => (!a || x.cpuMs > a.cpuMs ? x : a), null), compiles: r.rows.reduce((s, x) => s + (x.compileShader || 0), 0) });
}

/* Measure every fine frame, write PNGs and a strip. */
const cap = await run(() => {
  const D = window.__D; const hb = D.hullBox; const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const R = D.preCanvas.getContext('2d').getImageData(0, 0, D.preCanvas.width, D.preCanvas.height).data;
  const Wc = D.preCanvas.width, Hc = D.preCanvas.height; const hbW = hb[2] - hb[0] + 1, hbH = hb[3] - hb[1] + 1;
  const meas = D.frames.filter((f) => typeof f.k === 'number').map((f) => {
    const A = f.c.getContext('2d').getImageData(0, 0, Wc, Hc).data; const row = { k: f.k, tMs: +(f.k * 1000 / 60).toFixed(1) };
    const M = new Uint8Array(Wc * Hc); let n = 0;
    for (let i = 0, p = 0; p < Wc * Hc; p++, i += 4) { const la = lum(A, i); if (la > 120 && la - lum(R, i) > 40) { M[p] = 1; n++; } }
    row.flashPx = n; if (!n) return row;
    let best = null; const st = [];
    for (let p0 = 0; p0 < Wc * Hc; p0++) { if (M[p0] !== 1) continue; let c = 0, a0 = 1e9, b0 = 1e9, a1 = -1, b1 = -1; st.push(p0); M[p0] = 2; while (st.length) { const q = st.pop(); const qx = q % Wc, qy = (q / Wc) | 0; c++; if (qx < a0) a0 = qx; if (qx > a1) a1 = qx; if (qy < b0) b0 = qy; if (qy > b1) b1 = qy; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < 0 || nx >= Wc || ny >= Hc) continue; const j = ny * Wc + nx; if (M[j] === 1) { M[j] = 2; st.push(j); } } } if (!best || c > best.c) best = { c, box: [a0, b0, a1, b1] }; }
    const [x0, y0, x1, y1] = best.box; const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
    let mx = 0, clip = 0, warm = 0, hot = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * Wc + x) * 4; const la = lum(A, i); if (la > mx) mx = la; if (la > 120 && la - lum(R, i) > 40) { hot++; if (A[i] >= 250 && A[i + 1] >= 250 && A[i + 2] >= 250) clip++; if (A[i] - A[i + 2] > 60) warm++; } }
    Object.assign(row, { blobPx: best.c, flashBox: best.box, areaRatio: +((fw * fh) / (hbW * hbH)).toFixed(2), maxDimRatio: +Math.max(fw / hbW, fh / hbH).toFixed(2), peakLum: Math.round(mx), clipFrac: +(clip / hot).toFixed(3), warmFrac: +(warm / hot).toFixed(3) });
    return row;
  });
  const cx = (hb[0] + hb[2]) / 2, cy = (hb[1] + hb[3]) / 2; const side = Math.min(Hc, Math.max(200, 1.5 * Math.max(hbW, hbH)));
  const tiles = [{ tag: 'prehit', c: D.preCanvas }].concat(D.frames.map((f) => ({ tag: typeof f.k === 'number' ? `k${f.k} ${(f.k * 1000 / 60).toFixed(0)}ms` : `+${f.k.slice(1)}s`, c: f.c })));
  const TS = 300, cols = 5, rowsN = Math.ceil(tiles.length / cols);
  const strip = document.createElement('canvas'); strip.width = cols * TS; strip.height = rowsN * TS; const sx = strip.getContext('2d'); sx.fillStyle = '#000'; sx.fillRect(0, 0, strip.width, strip.height);
  tiles.forEach((t, i) => { const X = (i % cols) * TS, Y = Math.floor(i / cols) * TS; sx.drawImage(t.c, cx - side / 2, cy - side / 2, side, side, X, Y, TS, TS); sx.fillStyle = '#fff'; sx.font = '13px monospace'; sx.fillText(t.tag, X + 5, Y + 15); });
  const pngs = D.frames.map((f) => ({ tag: typeof f.k === 'number' ? 'k' + String(f.k).padStart(2, '0') : 'plus' + f.k.slice(1) + 's', url: f.c.toDataURL('image/png') }));
  return { meas, strip: strip.toDataURL('image/png'), pngs, rows: D.rows, refRow: D.refRow, secs0: D.secs0, busErrors: (window.__VS.busErrors || []).length, loadErrors: window.__VS.loadErrors || [] };
});
for (const p of cap.pngs) fs.writeFileSync(`${OUT}-${p.tag}.png`, Buffer.from(p.url.split(',')[1], 'base64'));
fs.writeFileSync(`${OUT}-strip.png`, Buffer.from(cap.strip.split(',')[1], 'base64'));
delete cap.strip; delete cap.pngs;
const spacing = (a) => (a && a.length > 1 ? a.slice(1).map((q, i) => Math.hypot(q[0] - a[i][0], q[1] - a[i][1])) : []);
const s0 = spacing(cap.secs0);
for (const m of marks) { const s = spacing(m.secs); m.sections = m.secs ? m.secs.length : 0; m.maxGrowPx = s.length ? Math.max(...s.map((v, i) => +(v - (s0[i] || 0)).toFixed(1))) : 0; delete m.secs; }
await browser.close();
const kf = cap.rows[0];
const steady = cap.refRow;
const out = { kind: KIND, take: TAKE, q: Q, bootS, setup, pre, kill, killFrame: kf, refFrame: steady, flash: cap.meas, marks,
  compilesAfterKill: cap.rows.reduce((s, r) => s + (r.compileShader || 0), 0) + marks.reduce((s, m) => s + m.compiles, 0),
  linksAfterKill: cap.rows.reduce((s, r) => s + (r.linkProgram || 0), 0),
  maxCpuMsAfterKill: Math.max(...cap.rows.map((r) => r.cpuMs), ...marks.map((m) => m.maxCpuMs)),
  consoleErrors, pageErrors, failed, busErrors: cap.busErrors, loadErrors: cap.loadErrors };
out.markRows = allRows; fs.writeFileSync(`${OUT}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ kind: KIND, bootS, warm: setup.deathWarmMs, glr: (setup.glRenderer || '').slice(0, 40), kill: kf, ref: steady, flash: cap.meas.map((m) => [m.k, m.areaRatio, m.maxDimRatio, m.warmFrac, m.clipFrac]), marks, compiles: out.compilesAfterKill, links: out.linksAfterKill, errs: [consoleErrors.length, pageErrors.length, failed.length, cap.busErrors, cap.loadErrors.length] }));
