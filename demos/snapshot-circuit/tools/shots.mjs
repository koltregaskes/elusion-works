// The pictures kept with Snapshot Circuit. Usage: node shots.mjs [base-url] [out-dir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8771', out = process.argv[3] || new URL('..', import.meta.url).pathname;
const url = base + '/demos/snapshot-circuit/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function page(w, h, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch }); const p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); await p.goto(url); await p.evaluate(() => window.snapshotCircuit.ready); return p; }
const settle = p => p.waitForTimeout(900);
{ const p = await page(1280, 800); await settle(p); await p.screenshot({ path: `${out}/screenshot.jpg`, type: 'jpeg', quality: 86 }); // the start card: what was found in the photograph
  await p.evaluate(() => { const s = window.snapshotCircuit; s.autopilot(true); s.start(); s.fast(180 + 75 * 6); }); await settle(p); await p.screenshot({ path: `${out}/thumbnail.png` }); // the race, crossing the line
  await p.click('#cam'); await p.evaluate(() => window.snapshotCircuit.fast(150)); await settle(p); await p.screenshot({ path: `${out}/proof.jpg`, type: 'jpeg', quality: 86 }); await p.context().close(); } // from above: the circuit round the objects
{ const p = await page(390, 800, true); await p.evaluate(() => { const s = window.snapshotCircuit; s.autopilot(true); s.start(); s.fast(180 + 75 * 6); }); await settle(p); await p.screenshot({ path: `${out}/phone.jpg`, type: 'jpeg', quality: 86 }); await p.context().close(); }
await browser.close();
console.log(errors.length ? 'console problems:\n' + errors.slice(0, 12).join('\n') : 'four pictures written, no console errors or warnings');
