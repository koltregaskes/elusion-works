/* Real menu flow: open the title screen, click New game, Continue, Take
   command as soon as each works, time Take command to __VS.ready, check the
   sim ticks, and grab loading-card screenshots on the way.
   Usage: node boot-click.mjs --base URL --out <prefix> [--q medium] */
import { chromium } from './pw.mjs';
import fs from 'node:fs';
const args = process.argv.slice(2);
const g = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BASE = g('base', 'http://127.0.0.1:8901'); const OUT = g('out', 'out/boot'); const Q = g('q', '');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => errs.push('PAGE ' + e.message.slice(0, 200)));
const failed = []; page.on('requestfailed', (r) => failed.push(r.url()));
const t0 = Date.now(); const T = () => +((Date.now() - t0) / 1000).toFixed(1);
await page.goto(`${BASE}/demos/void-sovereign/?seed=13634${Q ? '&quality=' + Q : ''}`, { waitUntil: 'domcontentloaded' });
const log = [];
const click = async (re) => {
  for (let i = 0; i < 600; i++) {
    const ok = await page.evaluate((src) => { const r = new RegExp(src, 'i'); for (const b of document.querySelectorAll('button, [data-act]')) { if (r.test((b.textContent || '').trim()) && b.offsetParent !== null && getComputedStyle(b).pointerEvents !== 'none') { b.click(); return true; } } return false; }, re.source);
    if (ok) { log.push([re.source, T()]); return true; }
    await page.waitForTimeout(250);
  }
  return false;
};
await click(/^New game$/); await page.waitForTimeout(500);
await click(/^Continue$/); await page.waitForTimeout(500);
await click(/^Take command$/);
const tTake = Date.now();
const shots = [];
for (const at of [2, 8, 20]) { await page.waitForTimeout(Math.max(0, tTake + at * 1000 - Date.now())); try { await page.screenshot({ path: `${OUT}-load-${at}s.png`, timeout: 120000 }); shots.push([at, T()]); } catch (e) { shots.push([at, 'timeout']); } }
await page.waitForFunction(() => window.__VS && window.__VS.ready, null, { timeout: 900000, polling: 200 });
const takeToReady = (Date.now() - tTake) / 1000;
const t1 = await page.evaluate(() => window.__VS.world.tickCount); await page.waitForTimeout(5000); const t2 = await page.evaluate(() => ({ tick: window.__VS.world.tickCount, ents: window.__VS.world.entities.size, state: window.__VS.shell && window.__VS.shell.state, loadErrors: window.__VS.loadErrors, timings: window.__VS.bootTimings }));
try { await page.screenshot({ path: `${OUT}-match.png`, timeout: 120000 }); } catch (e) { /* */ }
await browser.close();
const r = { base: BASE, clicks: log, takeToReadyS: takeToReady, totalS: T(), ticked: t2.tick - t1, ents: t2.ents, state: t2.state, loadErrors: t2.loadErrors, errs, failed, shots, timings: t2.timings };
fs.writeFileSync(OUT + '.json', JSON.stringify(r, null, 1));
console.log(JSON.stringify(Object.assign({}, r, { timings: undefined })));
