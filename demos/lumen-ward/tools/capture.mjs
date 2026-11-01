/* Headless check and screenshots for Lumen Ward.

   Serves the repo root, opens the demo in Chromium (software WebGL), waits for
   the ward to build, reports console errors and render stats, then poses the
   camera at each flyover shot and saves a screenshot.

   Usage: node demos/lumen-ward/tools/capture.mjs [--out /tmp/lw] [--q high|low]
          [--shots 0:0.5,2:0.3] [--w 1280 --h 720] [--walk] [--hud]
   Software rendering is slow; numbers here are not real-GPU frame rates. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OUT = arg('out', '/tmp/lw');
const Q = arg('q', 'high');
const W = Number(arg('w', 1280));
const H = Number(arg('h', 720));
const SHOTS = arg('shots', '0:0.6,1:0.75,2:0.35,3:0.5,4:0.45,4:0.95,5:0.5,6:0.3,6:0.9');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('PAGE ' + e.message.slice(0, 300)));
const failed = [];
page.on('requestfailed', (r) => failed.push(r.url()));

const t0 = Date.now();
await page.goto(`${base}/demos/lumen-ward/?q=${Q}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__LW && window.__LW.state.ready) || document.body.classList.contains('has-error'), null, { timeout: 600000, polling: 250 });
const bootS = (Date.now() - t0) / 1000;
const failedBoot = await page.evaluate(() => document.body.classList.contains('has-error') ? document.querySelector('#loader-text').textContent : null);
const result = { bootS, failedBoot, shots: [] };
if (!failedBoot) {
  result.stats = await page.evaluate(() => window.__LW.stats);
  if (args.includes('--hud')) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, 'hud.png'), timeout: 300000 });
  }
  for (const s of SHOTS.split(',')) {
    const [i, u] = s.split(':').map(Number);
    await page.evaluate(([i, u]) => window.__LW.pose(i, u, 14), [i, u]);
    await page.waitForTimeout(1500);
    const file = path.join(OUT, `shot-${i}-${String(u).replace('.', '')}.png`);
    const st = Date.now();
    await page.screenshot({ path: file, timeout: 300000 });
    const info = await page.evaluate(() => { const r = window.__LW.renderer.info.render; return { calls: r.calls, triangles: r.triangles }; });
    result.shots.push({ i, u, file, ms: Date.now() - st, ...info });
  }
  if (args.includes('--walk')) {
    await page.evaluate(() => { window.__LW.resume(); window.__LW.setMode('walk'); });
    await page.waitForTimeout(800);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(4000);
    await page.keyboard.up('KeyW');
    const cam = await page.evaluate(() => { const c = window.__LW.explorer.pos; return [c.x, c.y, c.z].map((v) => +v.toFixed(2)); });
    result.walk = { cam };
    await page.screenshot({ path: path.join(OUT, 'walk.png'), timeout: 300000 });
  }
}
result.errs = errs;
result.failed = failed;
await browser.close();
server.close();
console.log(JSON.stringify(result, null, 1));
