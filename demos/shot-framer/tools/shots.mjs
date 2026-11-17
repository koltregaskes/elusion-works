// Writes the demo's pictures. Usage: node shots.mjs <base-url> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8779', out = process.argv[3] || '.', url = base + '/demos/shot-framer/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }), problems = [];
async function page(w, h, scale = 1, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch }), p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); }); p.on('pageerror', e => problems.push(String(e))); await p.goto(url); await p.waitForFunction(() => window.shotFramer && window.shotFramer.state().src && window.shotFramer.state().src.width === 4096, null, { timeout: 180000 }); return p; }
const set = (p, v, id) => p.evaluate(([v, id]) => window.shotFramer.set(v, id), [v, id]);
{ const p = await page(1280, 800); await set(p, { yaw: 96, pitch: 7, fov: 46 }, '16:9'); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/thumbnail.png` });
  for (const [v, id] of [[{ yaw: 96, pitch: 7, fov: 46 }, '16:9'], [{ yaw: 178, pitch: -1, fov: 38 }, '9:16'], [{ yaw: -90, pitch: 4, fov: 40 }, '2.39:1'], [{ yaw: 52, pitch: 27, fov: 34 }, '1:1']]) { await set(p, v, id); await p.click('#save'); } await p.waitForTimeout(300); await p.screenshot({ path: `${out}/screenshot.jpg`, quality: 88 });
  await p.click('#shots li:nth-child(2) button'); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/proof.jpg`, quality: 88 }); await p.context().close(); }
{ const p = await page(390, 800, 2, true); await set(p, { yaw: -90, pitch: 4, fov: 40 }, '4:5'); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/phone.jpg`, quality: 85 }); await p.context().close(); }
await browser.close(); if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('pictures written, no console errors or warnings');
