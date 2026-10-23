/* Hull lineup: one ship of each listed class, per team, alone 9 km above the
   field centre, framed by the game's focus camera from a fixed 3/4 view.
   Usage: node lineup.mjs --base URL --out <dir> [--classes a,b] [--teams 0,1] [--q medium] [--yaw 0.9 --pitch 0.28] [--seed N] [--keymul 1.5] */
import { chromium } from './pw.mjs';
import fs from 'node:fs';
const args = process.argv.slice(2);
const g = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BASE = g('base', 'http://127.0.0.1:8901'); const OUT = g('out', 'out/lineup'); const Q = g('q', 'medium');
const CLASSES = g('classes', 'interceptor,corvette,assaultFrigate,ionFrigate,destroyer,cruiser,carrier,mothership').split(',');
const TEAMS = g('teams', '0,1').split(',').map(Number);
const SEED = g('seed', '13634'); const KEYMUL = Number(g('keymul', 1)); const YAW = Number(g('yaw', 0.9)), PITCH = Number(g('pitch', 0.28)); const W = Number(g('w', 960)), H = Number(g('h', 540));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => errs.push('PAGE ' + e.message.slice(0, 200)));
await page.goto(`${BASE}/demos/void-sovereign/?autostart=1&seed=${SEED}&quality=${Q}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__VS && window.__VS.ready), null, { timeout: 900000, polling: 50 });
await page.evaluate((KEYMUL) => {
  const VS = window.__VS; VS.loop.stop();
  if (KEYMUL !== 1 && VS.environment && VS.environment.keyLight) VS.environment.keyLight.intensity *= KEYMUL;
  const t = VS.tutorial && VS.tutorial.tutorial; if (t && t.skip && !t.finished) { try { t.skip(); } catch (e) { /* */ } }
  document.querySelectorAll('.vs-hud, #vs-hud').forEach((n) => { n.style.visibility = 'hidden'; });
  let el = VS.loop.elapsed;
  window.__L = { frame(dt) { el += dt; VS.loop.elapsed = el; VS.world.syncTransforms(1); VS.engine.render(dt, el); }, cur: null };
}, KEYMUL);
const meta = [];
for (const team of TEAMS) for (const cls of CLASSES) {
  const r = await page.evaluate(({ cls, team, YAW, PITCH }) => {
    const VS = window.__VS; const T = VS.THREE; const w = VS.world; const L = window.__L;
    if (L.cur && L.cur.alive) { L.cur.position.y += 1e7; w.syncTransforms(1); w.remove ? w.remove(L.cur) : null; }
    const me = w.humanTeam; const tm = team === 0 ? me : me ^ 1;
    const a = w.entities.get(w.teams[me].baseId).position; const b = w.entities.get(w.teams[me ^ 1].baseId).position;
    const P = a.clone().add(b).multiplyScalar(0.5).add(new T.Vector3(0, 9000, 0));
    const e = w.spawn(cls, tm, P, new T.Quaternion()); e.velocity.set(0, 0, 0); e.orderQueue.length = 0; L.cur = e;
    const rig = VS.cameraRig; rig._yaw.target = YAW; rig._yaw.snap(YAW); rig._pitch.target = PITCH; rig._pitch.snap(PITCH);
    rig.frameEntities([e], true);
    for (let i = 0; i < 14; i++) L.frame(1 / 60);
    const url = VS.engine.renderer.domElement.toDataURL('image/png');
    // Park it far away so the next ship is alone.
    e.position.y += 1e7; if (e.prevPosition) e.prevPosition.y += 1e7; e.velocity.set(0, 0, 0);
    return { cls, team, len: e.def.length, url };
  }, { cls, team, YAW, PITCH });
  fs.writeFileSync(`${OUT}/t${team}-${cls}.png`, Buffer.from(r.url.split(',')[1], 'base64'));
  meta.push({ cls, team, len: r.len });
}
await browser.close();
console.log(JSON.stringify({ meta, errs }));
