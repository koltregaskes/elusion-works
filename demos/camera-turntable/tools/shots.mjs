// The pictures kept with Elusion One. Usage: node shots.mjs [base-url] [out-dir] [--all]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8775', out = process.argv[3] || new URL('..', import.meta.url).pathname, all = process.argv.includes('--all'), url = base + '/demos/camera-turntable/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); const errors = [];
async function page(w, h, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch }); const p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); await p.goto(url); await p.waitForFunction(() => window.elusionOne); return p; }
const run = (p, fn, arg) => p.evaluate(`(${fn})(window.elusionOne, ${JSON.stringify(arg ?? null)})`), settle = p => p.waitForTimeout(900);
{ const p = await page(1280, 800); await run(p, s => s.fast(30)); await settle(p); await p.screenshot({ path: `${out}/thumbnail.png` });
  await run(p, s => { s.select('sensor'); s.fast(240); }); await settle(p); await p.screenshot({ path: `${out}/proof.jpg`, type: 'jpeg', quality: 88 });
  await run(p, s => { s.setMode('turntable'); s.fast(200); }); await p.click('#finish'); await run(p, s => s.fast(10)); await settle(p); await p.screenshot({ path: `${out}/screenshot.jpg`, type: 'jpeg', quality: 88 });
  if (all) { await p.click('#finish'); await run(p, s => s.setMode('film')); for (const t of [2.5, 8, 14.5, 18, 23, 26, 29.5, 34]) { await run(p, (s, t) => { const now = s.state().filmT; s.fast(Math.max(0, Math.round((t - now) * 60))); }, t); await settle(p); await p.screenshot({ path: `${out}/film-${String(t).padStart(4, '0')}.png` }); } }
  await p.context().close(); }
{ const p = await page(390, 800, true); await run(p, s => { s.setMode('inside'); s.fast(200); }); await settle(p); await p.screenshot({ path: `${out}/phone.jpg`, type: 'jpeg', quality: 88 }); await p.context().close(); }
await browser.close(); console.log(errors.length ? 'console problems:\n' + errors.slice(0, 10).join('\n') : 'pictures written, no console errors or warnings');
