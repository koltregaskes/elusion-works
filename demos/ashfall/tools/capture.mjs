/**
 * Gauntlet capture: high-res frames at every vantage, at a chosen quality preset.
 *   node shoot.mjs <outdir> [quality] [vantages...]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const outdir = process.argv[2] || 'shots';
const quality = process.argv[3] || 'high';
const only = process.argv.slice(4);
mkdirSync(outdir, { recursive: true });

const VANTAGES = only.length
  ? only
  : ['yard', 'crane', 'depot', 'depotIn', 'terraces', 'terracesUp', 'sunline', 'containers', 'wide', 'gunclose', 'yardBack', 'depotBack'];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });

for (const v of VANTAGES) {
  await page.goto(`http://127.0.0.1:8123/demos/ashfall/?capture=${v}&quality=${quality}&hud=0`, {
    waitUntil: 'load', timeout: 90000,
  });
  await page.waitForFunction(() => !!window.__ashfall, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const s = document.getElementById('loading');
    return !s || s.hidden || s.classList.contains('is-done');
  }, null, { timeout: 300000 });
  // Let TAA/temporal effects converge and any lazy detail stream in. SwiftShader renders a
  // high-preset frame in seconds, so this is a frame budget, not a wall-clock one.
  const f0 = await page.evaluate(() => window.__ashfall.clock.frame);
  await page.waitForFunction((f) => window.__ashfall.clock.frame > f + 20, f0, { timeout: 600000 });
  await page.screenshot({ path: `${outdir}/${v}.png`, timeout: 180000 });
  console.log('shot', v);
}
await browser.close();
