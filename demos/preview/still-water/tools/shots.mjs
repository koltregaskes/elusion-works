// The pictures kept with Still Water. Usage: node shots.mjs [base-url] [out-dir] [--all]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8772', out = process.argv[3] || new URL('..', import.meta.url).pathname, all = process.argv.includes('--all');
const url = base + '/demos/still-water/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function page(w, h, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch }); const p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); await p.goto(url); await p.evaluate(() => window.stillWater.ready); return p; }
const settle = p => p.waitForTimeout(1200);
const at = (p, x, z, yaw) => p.evaluate(([x, z, yaw]) => { const s = window.stillWater; s.place(x, z, yaw); s.fast(30); }, [x, z, yaw]);
{ const p = await page(1280, 800); await settle(p); await p.screenshot({ path: `${out}/screenshot.jpg`, type: 'jpeg', quality: 86 }); // the way in
  await p.evaluate(() => window.stillWater.enter(false));
  await at(p, 3, -3, -Math.PI / 2 - 0.25); await settle(p); await p.screenshot({ path: `${out}/thumbnail.png` }); // the pool hall from its west end
  await p.evaluate(() => { window.stillWater.goTo(5, true); window.stillWater.fast(30); }); await settle(p); await p.screenshot({ path: `${out}/proof.jpg`, type: 'jpeg', quality: 86 }); // standing at a plate
  if (all) { const views = { lobby: [-18, -17, -Math.PI / 2], west: [-12, -3, Math.PI * 0.75], channel: [1, 6, Math.PI], end: [1, 14, Math.PI], wade: [8, -1, -Math.PI / 2 + 0.5], walkway: [17, 3, 0.4] };
    for (const [name, v] of Object.entries(views)) { await at(p, ...v); await settle(p); await p.screenshot({ path: `${out}/view-${name}.png` }); } }
  await p.context().close(); }
{ const p = await page(390, 800, true); await p.evaluate(() => { const s = window.stillWater; s.enter(false); s.goTo(1, true); s.fast(30); }); await settle(p); await p.screenshot({ path: `${out}/phone.jpg`, type: 'jpeg', quality: 86 }); await p.context().close(); }
await browser.close();
console.log(errors.length ? 'console problems:\n' + errors.slice(0, 12).join('\n') : 'pictures written, no console errors or warnings');
