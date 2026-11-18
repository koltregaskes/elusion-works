// Usage: node demos/stem-studio/tools/shots.mjs <outDir> [name:WxH:action ...]   action = none|select|arranger|plan
// Needs a static server serving the repo root; set BASE (default http://127.0.0.1:8765).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [outDir, ...specs] = process.argv.slice(2); mkdirSync(outDir, { recursive: true });
const base = process.env.BASE || 'http://127.0.0.1:8765', errors = [];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
for (const spec of specs) {
  const [name, size = '1280x800', action = 'none'] = spec.split(':'), [w, h] = size.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${name}: [${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(base + '/demos/stem-studio/', { waitUntil: 'load' }); await page.waitForFunction(() => window.stemStudio);
  if (action === 'select' || action === 'plan') { await page.click('.clip[data-id="c-lead-12"]'); }
  if (action === 'arranger' || action === 'plan') { await page.click('#tab-arr'); await page.fill('#ask', 'Drop the drums in the break'); await page.click('#ask-go'); await page.click('.chip:has-text("Double the chorus")'); }
  await page.waitForTimeout(300); await page.screenshot({ path: `${outDir}/${name}.png` }); await page.close();
}
await browser.close();
if (errors.length) { console.log('ERRORS\n' + [...new Set(errors)].join('\n')); process.exitCode = 1; } else console.log('no console errors');
