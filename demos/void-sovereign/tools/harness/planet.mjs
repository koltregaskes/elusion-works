/* The backdrop planet, framed on its own: the camera rig is parked and the
   camera aimed at the planet group from the field centre, with the planet
   filling about 70% of the frame height. Stepped frames as everywhere else.
   Usage: node planet.mjs --out <prefix> [--base URL] [--seeds 13634,99,37] [--q medium] */
import { chromium } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const g = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BASE = g('base', 'http://127.0.0.1:8901'); const OUT = g('out', 'out/planet'); const Q = g('q', 'medium');
const SEEDS = g('seeds', '13634').split(','); const W = Number(g('w', 960)), H = Number(g('h', 540));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => errs.push('PAGE ' + e.message.slice(0, 200)));
  await page.goto(`${BASE}/demos/void-sovereign/?autostart=1&seed=${seed}&quality=${Q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__VS && window.__VS.ready), null, { timeout: 900000, polling: 50 });
  const r = await page.evaluate(() => {
    const VS = window.__VS; VS.loop.stop();
    document.querySelectorAll('.vs-hud, #vs-hud').forEach((n) => { n.style.visibility = 'hidden'; });
    const env = VS.environment; const grp = env && env._planetGroup; if (!grp) return { error: 'no planet group' };
    const rig = VS.cameraRig; rig.update = () => {};
    const cam = VS.engine.camera; const T = VS.THREE;
    grp.updateMatrixWorld(true);
    const P = new T.Vector3().setFromMatrixPosition(grp.matrixWorld);
    const R = env._planetRadius || 1;
    const dir = P.clone().normalize();
    const dist = R / Math.tan((cam.fov * Math.PI / 180) * 0.35);
    cam.position.copy(P).addScaledVector(dir, -dist);
    cam.lookAt(P); cam.updateMatrixWorld();
    let el = VS.loop.elapsed;
    for (let i = 0; i < 10; i++) { el += 1 / 60; VS.loop.elapsed = el; VS.engine.render(1 / 60, el); }
    return { scheme: env.planetScheme && env.planetScheme.name, R: Math.round(R), dist: Math.round(dist), url: VS.engine.renderer.domElement.toDataURL('image/png') };
  });
  if (r.url) { fs.writeFileSync(`${OUT}-s${seed}.png`, Buffer.from(r.url.split(',')[1], 'base64')); delete r.url; }
  out.push(Object.assign({ seed, errs }, r));
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out));
