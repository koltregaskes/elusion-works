/* Played match, fast-forwarded: AI against AI on seed 13634 (a Commander is
   attached to the player's side at the first stopped tick), the sim ticked
   without rendering to a target tick (FX updated every 3 ticks so deaths and
   wrecks age as they would), then the peak framed with the game's own camera
   (rig.frameEntities on the engaged hulls = the wide; half that distance =
   the mid; frameEntities on the biggest engaged hull = the close).
   Usage: node played-step.mjs --base URL --out <prefix> [--tick 5941] [--q medium] */
import { chromium } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const g = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BASE = g('base', 'http://127.0.0.1:8901'); const OUT = g('out', 'out/played'); const Q = g('q', 'medium');
const TICK = Number(g('tick', 5941)); const W = Number(g('w', 1280)), H = Number(g('h', 720));
const CONVERGE = Number(g('converge', 14));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const consoleErrors = []; const pageErrors = []; const failed = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 300)));
page.on('requestfailed', (r) => failed.push(r.url()));
await page.goto(`${BASE}/demos/void-sovereign/?autostart=1&seed=13634&quality=${Q}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__VS && window.__VS.ready), null, { timeout: 900000, polling: 50 });
const setup = await page.evaluate(async () => {
  const VS = window.__VS; const w = VS.world; const loop = VS.loop; loop.stop();
  const t = VS.tutorial && VS.tutorial.tutorial; if (t && t.skip && !t.finished) { try { t.skip(); } catch (e) { /* */ } }
  for (const b of document.querySelectorAll('button')) if (/^\s*(dismiss|skip)\s*$/i.test(b.textContent || '')) b.click();
  const { Commander } = await import('./src/sim/ai.js');
  w._commanders.push(new Commander(w, w.humanTeam, { difficulty: 'normal' }));
  const eng = VS.engine;
  let elapsed = loop.elapsed;
  window.__P = {
    frame(dt) { elapsed += dt; loop.elapsed = elapsed; loop.alpha = 1; w.syncTransforms(1); eng.render(dt, elapsed); },
    ff(n) { for (let i = 0; i < n; i++) { w.tick(loop.step); loop.tick++; if (loop.tick % 3 === 0 && VS.fx) { elapsed += loop.step * 3; VS.fx.update(loop.step * 3, elapsed, eng.camera); } } w.syncTransforms(1); return w.tickCount; },
  };
  return { stopTick: w.tickCount };
});
let tick = setup.stopTick;
while (tick < TICK) tick = await page.evaluate((n) => window.__P.ff(n), Math.min(600, TICK - tick));
// One second of real frames with the sim running, so trails, HUD and FX are live.
await page.evaluate(() => { const P = window.__P; const VS = window.__VS; for (let i = 0; i < 30; i++) { P.ff(1); P.frame(1 / 30); } });
const shots = [];
for (const view of ['wide', 'mid', 'close']) {
  const r = await page.evaluate(({ view, CONVERGE }) => {
    const VS = window.__VS; const w = VS.world; const T = VS.THREE; const rig = VS.cameraRig; const P = window.__P; const eng = VS.engine;
    const eng0 = [...w.entities.values()].filter((e) => e.alive && e.engaged && e.team >= 0 && e.team < 2 && e.def && e.def.role !== 'resource');
    const cen = new T.Vector3(); eng0.forEach((e) => cen.add(e.position)); cen.multiplyScalar(1 / Math.max(1, eng0.length));
    const near = eng0.filter((e) => e.position.distanceTo(cen) < 4000);
    if (view === 'wide') rig.frameEntities(near, true);
    else if (view === 'mid') { rig.frameEntities(near, true); for (let i = 0; i < 2; i++) P.frame(1 / 60); rig.focusOn(cen.clone(), Math.max(800, eng.camera.position.distanceTo(cen) * 0.5), true); }
    else { const big = near.slice().sort((a, b) => b.def.length - a.def.length)[0]; rig.frameEntities([big], true); }
    for (let i = 0; i < CONVERGE; i++) P.frame(1 / 60);
    const cam = eng.camera; cam.updateMatrixWorld(); const cv = eng.renderer.domElement;
    const inFrame = (e) => { const p = e.position.clone().project(cam); return p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1; };
    const vis = [...w.entities.values()].filter((e) => e.alive && e.team >= 0 && e.team < 2 && inFrame(e));
    const lowFriendly = vis.filter((e) => e.team === w.humanTeam && e.hull / e.maxHull <= 0.3).map((e) => e.classId);
    const nearest = vis.slice().sort((a, b) => a.hull / a.maxHull - b.hull / b.maxHull).slice(0, 3).map((e) => ({ id: e.id, cls: e.classId, team: e.team === w.humanTeam ? 'ours' : 'theirs', hullPct: Math.round(100 * e.hull / e.maxHull) }));
    const hulls = [0, 1].map((t) => Math.round(vis.filter((e) => e.team === t).reduce((s, e) => s + e.hull / e.maxHull, 0) * 100) / 100);
    return { view, tick: w.tickCount, time: +w.time.toFixed(1), engaged: eng0.length, near: near.length, inFrame: [0, 1].map((t) => vis.filter((e) => e.team === t).length), capsInFrame: [0, 1].map((t) => vis.filter((e) => e.team === t && e.def.length >= 380).length), lowFriendly, nearestDeath: nearest, hullSum: hulls, camDist: Math.round(cam.position.distanceTo(cen)), sov: w.teams.map((t) => Math.round(t.sovereignty)), url: cv.toDataURL('image/png') };
  }, { view, CONVERGE });
  fs.writeFileSync(`${OUT}-${view}-canvas.png`, Buffer.from(r.url.split(',')[1], 'base64')); delete r.url;
  try { await page.screenshot({ path: `${OUT}-${view}-hud.png`, timeout: 120000 }); r.hud = true; } catch (e) { r.hud = 'timeout'; }
  shots.push(r);
}
await browser.close();
const out = { base: BASE, setup, shots, consoleErrors, pageErrors, failed };
fs.writeFileSync(OUT + '.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
