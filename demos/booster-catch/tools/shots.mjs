// Usage: node demos/booster-catch/tools/shots.mjs <outDir> [spec ...]   spec = name:time:camera:mode[:WxH]
// Needs a static server serving the repo root: http://127.0.0.1:8765 unless BASE is set (BASE=http://127.0.0.1:8831).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';
const [outDir, ...specs] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
for (const spec of specs) {
  const [name, t, camera, mode, size = '1280x800', clean] = spec.split(':'); const [w, h] = size.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto((process.env.BASE || 'http://127.0.0.1:8765') + '/demos/booster-catch/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__replay && window.__replay.firstFrameMs !== null, null, { timeout: 120000 });
  if (clean) await page.addStyleTag({ content: '.title,.telemetry,.modes,.dock,.caption{display:none!important}' });
  await page.evaluate(([t, camera, mode]) => { const r = window.__replay; r.setPlaying(false); r.setMode(mode); r.setCamera(camera); r.seek(Number(t)); r.renderNow(); }, [t, camera, mode]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(name, JSON.stringify(await page.evaluate(() => ({ ms: window.__replay.firstFrameMs, cam: window.__replay.state().cam }))));
  await page.close();
}
await browser.close();
if (errors.length) { console.log('ERRORS\n' + errors.join('\n')); process.exitCode = 1; } else console.log('no console errors');
