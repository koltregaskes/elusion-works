/* Stepped fleet-range battle for A/B frames (P49 legibility and later rounds).

   Seed 13634. Two mixed fleets (21 hulls a side) are spawned 3.6 km apart,
   9 km above the field centre, and attack-move into each other. The game
   loop is stopped and the sim stepped by hand at fixed dt, so a base build
   and a patched build reach the same sim state at the same tick (hash of the
   spawned hulls' positions is logged per moment to prove it).

   Each moment poses the rig's focus camera on the engaged centroid at a
   given distance / yaw / pitch, renders `converge` frames at 1/60 s (sim
   paused for those so the pose is fixed), then saves:
     -canvas.png  the WebGL canvas alone
     -hud.png     a page screenshot (what the player sees)
   and logs per-ship projected size, team, hull %.

   Usage: node battle-step.mjs --base URL --out <prefix> [--q high] [--w 1280 --h 720] [--moments m1,m2,m3] */
import { chromium } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const g = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BASE = g('base', 'http://127.0.0.1:8901');
const Q = g('q', 'medium');
const W = Number(g('w', 1280)), H = Number(g('h', 720));
const OUT = g('out', 'out/battle');
const SEED = g('seed', '13634');
const CONVERGE = Number(g('converge', 12));
const EXTRA = g('extra', '');
const ALTSPLIT = Number(g('altsplit', 0)); // our fleet this many metres above theirs
const SELECT = args.includes('--select');
const CY = Number(g('cy', 9000)); // fleet height above the y = 0 plane
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const ALL = {
  m1: { simS: 22, dist: 5200, yaw: 0.8, pitch: 0.32 },
  m2: { simS: 26, dist: 2000, yaw: 2.1, pitch: 0.22 },
  m3: { simS: 30, dist: 8000, yaw: -0.6, pitch: 0.45 },
  m4: { simS: 34, dist: 3200, yaw: 1.3, pitch: 0.12 },
};
const MOMENTS = g('moments', 'm1,m2,m3').split(',').map((k) => Object.assign({ key: k }, ALL[k]));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const consoleErrors = []; const pageErrors = []; const failed = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 300)));
page.on('requestfailed', (r) => failed.push(r.url()));
const T0 = Date.now();
await page.goto(`${BASE}/demos/void-sovereign/?autostart=1&seed=${SEED}&quality=${Q}${EXTRA}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__VS && window.__VS.ready), null, { timeout: 600000, polling: 50 });
const bootS = (Date.now() - T0) / 1000;

const setup = await page.evaluate(({ ALTSPLIT, SELECT, CY }) => {
  const VS = window.__VS; const T = VS.THREE; const w = VS.world; const loop = VS.loop; loop.stop();
  const t = VS.tutorial && VS.tutorial.tutorial; if (t && t.skip && !t.finished) { try { t.skip(); } catch (e) { /* */ } }
  for (const b of document.querySelectorAll('button')) if (/^\s*(dismiss|skip)\s*$/i.test(b.textContent || '')) b.click();
  const eng = VS.engine;
  let accum = 0; let elapsed = loop.elapsed;
  const frame = (dt, sim = true) => {
    elapsed += dt; loop.elapsed = elapsed;
    if (sim) { accum += dt; let s = 0; while (accum >= loop.step - 1e-9 && s < 5) { w.tick(loop.step); loop.tick++; accum -= loop.step; s++; } loop.alpha = Math.max(0, accum / loop.step); } else loop.alpha = 1;
    w.syncTransforms(loop.alpha);
    eng.render(dt, elapsed);
  };
  const tick = (n) => { for (let i = 0; i < n; i++) { w.tick(loop.step); loop.tick++; } w.syncTransforms(1); };
  // Bring every run to the same world tick before anything is spawned.
  const startTick = w.tickCount;
  while (w.time < 3.0) tick(1);
  const me = w.humanTeam; const foe = me ^ 1;
  const a = w.entities.get(w.teams[me].baseId).position; const b = w.entities.get(w.teams[foe].baseId).position;
  const C = a.clone().add(b).multiplyScalar(0.5).setY(CY);
  const across = b.clone().sub(a).setY(0).normalize();
  const side = new T.Vector3(-across.z, 0, across.x);
  const mix = [['interceptor', 8], ['bomber', 4], ['corvette', 4], ['assaultFrigate', 2], ['ionFrigate', 2], ['destroyer', 1]];
  const ids = [[], []];
  let s = 99991; const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0) / 4294967296);
  for (const team of [me, foe]) {
    const sign = team === me ? -1 : 1;
    const base = C.clone().addScaledVector(across, sign * 1800).add(new T.Vector3(0, team === me ? ALTSPLIT : 0, 0));
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), across.clone().multiplyScalar(-sign));
    for (const [cls, n] of mix) for (let i = 0; i < n; i++) {
      const p = base.clone().addScaledVector(side, (rnd() - 0.5) * 1400).addScaledVector(across, sign * (rnd() * 500)).add(new T.Vector3(0, (rnd() - 0.5) * 500, 0));
      const e = w.spawn(cls, team, p, q.clone());
      ids[team === me ? 0 : 1].push(e.id);
    }
  }
  w.commandAttackMove({ ids: ids[0], point: C.clone().addScaledVector(across, 1800) });
  // The hostile fleet is driven the same way (its Commander may also order it).
  w.commandAttackMove({ ids: ids[1], point: C.clone().addScaledVector(across, -1800) });
  const T0s = w.time;
  if (SELECT && VS.input) VS.input.setSelection(ids[0]);
  window.__B = { frame, tick, ids, C, T0s };
  return { startTick, spawnTick: w.tickCount, spawned: ids[0].length + ids[1].length };
}, { ALTSPLIT, SELECT, CY });

const moments = [];
for (const m of MOMENTS) {
  const res = await page.evaluate(({ m, CONVERGE }) => {
    const VS = window.__VS; const B = window.__B; const w = VS.world; const T = VS.THREE; const eng = VS.engine;
    while (w.time - B.T0s < m.simS) B.tick(1);
    const all = B.ids[0].concat(B.ids[1]).map((id) => w.entities.get(id)).filter((e) => e && e.alive);
    // Engaged centroid: alive spawned hulls within 2.5 km of the fleet median.
    const cen = new T.Vector3(); for (const e of all) cen.add(e.position); cen.multiplyScalar(1 / Math.max(1, all.length));
    let h = 2166136261 >>> 0; for (const e of all) for (const v of [e.id, e.position.x, e.position.y, e.position.z]) { h ^= Math.round(v * 10) | 0; h = Math.imul(h, 16777619) >>> 0; }
    const rig = VS.cameraRig;
    rig._yaw.target = m.yaw; rig._yaw.snap(m.yaw); rig._pitch.target = m.pitch; rig._pitch.snap(m.pitch);
    rig.focusOn(cen.clone(), m.dist, true);
    for (let i = 0; i < CONVERGE; i++) B.frame(1 / 60, false);
    const cv = eng.renderer.domElement; const cam = eng.camera; cam.updateMatrixWorld();
    const ships = all.map((e) => { const p = e.position.clone().project(cam); const d = cam.position.distanceTo(e.position); return { id: e.id, cls: e.classId, team: e.team, hullPct: Math.round(100 * e.hull / e.maxHull), x: Math.round((p.x + 1) * cv.width / 2), y: Math.round((1 - p.y) * cv.height / 2), physPx: +((e.def.length / d) * (cv.height / 2) / Math.tan(cam.fov * Math.PI / 360)).toFixed(1) }; });
    const counts = [0, 1].map((t) => ({ alive: all.filter((e) => e.team === t).length, hull: Math.round(all.filter((e) => e.team === t).reduce((s, e) => s + e.hull, 0)) }));
    /* Top-bar text overlap: every leaf element with text in the top bar, and
       every pair whose boxes intersect by more than 1 px. */
    const leaves = [...document.querySelectorAll('.vsh-top *')].filter((n) => n.children.length === 0 && (n.textContent || '').trim() && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none');
    const boxes = leaves.map((n) => { const r = n.getBoundingClientRect(); const c = n.closest('.vsh-obj'); const cr = c ? c.getBoundingClientRect() : null; return { t: n.textContent.trim().slice(0, 24), r: cr ? { left: Math.max(r.left, cr.left), right: Math.min(r.right, cr.right), top: r.top, bottom: r.bottom } : r }; }).filter((b) => b.r.right - b.r.left > 1);
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i].r, b = boxes[j].r; const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left); const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 1 && oy > 1) overlaps.push([boxes[i].t, boxes[j].t]); }
    const mh = document.querySelector('.vsh-host--markers'); const clip = mh ? mh.style.clipPath.length : -1; const seams = (document.querySelector('.vsh-obj__seams') || {}).offsetWidth || 0; const rate = (document.querySelector('.vsh-res__rate') || {}).textContent;
    const mk = VS.hud && VS.hud.markers; const altDebug = mk ? JSON.stringify({ rel: mk._altRel && mk._altRel.text, live: mk._altRel && mk._altRel.live, sel: [...(mk.ctx.selection || [])].length }).slice(0, 900) : 'no markers';
    return { altDebug, clip, seams, rate, overlaps, hash: h.toString(16), tick: w.tickCount, time: +w.time.toFixed(2), camDist: Math.round(cam.position.distanceTo(cen)), fov: +cam.fov.toFixed(1), counts, ships, url: cv.toDataURL('image/png') };
  }, { m, CONVERGE });
  fs.writeFileSync(`${OUT}-${m.key}-canvas.png`, Buffer.from(res.url.split(',')[1], 'base64')); delete res.url;
  try { await page.screenshot({ path: `${OUT}-${m.key}-hud.png`, timeout: 90000 }); res.hud = true; } catch (e) { res.hud = String(e.message).slice(0, 80); }
  moments.push(Object.assign({ key: m.key }, res));
}
await browser.close();
const out = { base: BASE, q: Q, bootS, setup, moments, consoleErrors, pageErrors, failed };
fs.writeFileSync(`${OUT}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ bootS, setup, moments: moments.map((m) => ({ key: m.key, overlaps: m.overlaps, hash: m.hash, tick: m.tick, counts: m.counts, hud: m.hud, medPx: m.ships.map((s) => s.physPx).sort((a, b) => a - b)[m.ships.length >> 1] })), errs: [consoleErrors.length, pageErrors.length, failed.length], consoleErrors: consoleErrors.slice(0, 3) }));
