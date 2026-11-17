// Usage: node demos/axy-after-hours/tools/shots.mjs <outDir> [spec ...]
// spec = name:tier:room:WxH[:action]   tier = canvas (HTML-in-Canvas switched on) or plain; action = feed|feedlong|none
// Needs a static server at http://127.0.0.1:8765 serving the repo root.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [outDir, ...specs] = process.argv.slice(2); mkdirSync(outDir, { recursive: true });
const errors = [];
for (const spec of specs) {
  const [name, tier, room, size = '1280x800', action = 'none'] = spec.split(':'), [w, h] = size.split('x').map(Number);
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']; if (tier === 'canvas') args.push('--enable-features=CanvasDrawElement');
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${name}: [${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto('http://127.0.0.1:8765/demos/axy-after-hours/#' + room, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__afterHours && window.__afterHours.framesReady >= 8, null, { timeout: 60000 });
  if (action.startsWith('feed')) { await page.click('#feed'); await page.waitForTimeout(action === 'feedlong' ? 5200 : 2300); }
  else await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(name, JSON.stringify(await page.evaluate(() => ({ tier: window.__afterHours.tier, painted: window.__afterHours.painted, form: window.__afterHours.uploadForm }))));
  await browser.close();
}
if (errors.length) { console.log('ERRORS\n' + [...new Set(errors)].join('\n')); process.exitCode = 1; } else console.log('no console errors');
