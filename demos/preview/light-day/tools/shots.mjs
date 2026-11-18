// Writes the demo's pictures. Usage: node shots.mjs <base-url> <out-dir> [--all]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8776', out = process.argv[3] || '.', all = process.argv.includes('--all'), url = base + '/demos/light-day/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }), problems = [];
async function page(w, h, scale = 1, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch }), p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); }); p.on('pageerror', e => problems.push(String(e))); await p.goto(url); await p.waitForFunction(() => window.lightDay); return p; }
const at = async (p, id) => { await p.evaluate(id => { const J = window.lightDay; if (id === 'top') scrollTo(0, 0); else if (typeof id === 'number') J.goto(id); else document.getElementById(id).scrollIntoView(); }, id); await p.waitForTimeout(150); };
{ const p = await page(1280, 800, 1); await at(p, 'top'); await p.screenshot({ path: `${out}/thumbnail.png` }); await at(p, 'saturn'); await p.screenshot({ path: `${out}/screenshot.jpg`, quality: 88 }); await at(p, 'pause'); await p.screenshot({ path: `${out}/proof.jpg`, quality: 88 });
  if (all) for (const id of ['go', 'moon', 'sun', 'mars', 'jupiter', 'uranus', 'neptune', 'pluto', 'dark', 'shock', 'voyager2', 'voyager1', 'after']) { await at(p, id); await p.screenshot({ path: `${out}/at-${id}.png` }); }
  if (all) { await at(p, 6.4 * 3600); await p.screenshot({ path: `${out}/at-pull.png` }); await p.evaluate(() => document.getElementById('table-h').scrollIntoView()); await p.screenshot({ path: `${out}/at-table.png` }); }
  await p.context().close(); }
{ const p = await page(390, 800, 2, true); await at(p, 'jupiter'); await p.screenshot({ path: `${out}/phone.jpg`, quality: 85 }); if (all) for (const id of ['top', 'moon', 'pluto', 'shock', 'voyager1']) { await at(p, id); await p.screenshot({ path: `${out}/phone-${id}.png` }); } await p.context().close(); }
if (all) { const p = await page(740, 360, 1, true); for (const id of ['top', 'sun', 'voyager1']) { await at(p, id); await p.screenshot({ path: `${out}/wide-${id}.png` }); } await p.context().close(); }
await browser.close(); if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('pictures written, no console errors or warnings');
