// Writes the demo's pictures. Usage: node shots.mjs <base-url> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8778', out = process.argv[3] || '.', url = base + '/demos/kitchen-line/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }), problems = [];
async function page(w, h, scale = 1, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch }), p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); }); p.on('pageerror', e => problems.push(String(e))); await p.goto(url); await p.waitForFunction(() => window.kitchenLine); return p; }
// Play on until a moment worth a picture: a rally a few shots old, with the ball in the air.
const rally = p => p.evaluate(() => { const K = window.kitchenLine; K.start('watch', { seed: 12, level: 'club', toWin: 7 }); for (let i = 0; i < 6000; i++) { K.fast(1); const s = K.state(); if (s.rally.hits >= 5 && s.phase === 'live' && s.ball.y > 0.9 && Math.abs(s.ball.z) < 3) break; } });
{ const p = await page(1280, 800); await p.waitForTimeout(1200); await p.screenshot({ path: `${out}/thumbnail.png` }); await rally(p); await p.waitForTimeout(700); await p.screenshot({ path: `${out}/screenshot.jpg`, quality: 88 });
  await p.evaluate(() => { const K = window.kitchenLine; K.start('play', { seed: 12, level: 'club', toWin: 7 }); K.fast(150); }); await p.waitForTimeout(700); await p.screenshot({ path: `${out}/proof.jpg`, quality: 88 }); await p.context().close(); }
{ const p = await page(390, 800, 2, true); await rally(p); await p.waitForTimeout(700); await p.screenshot({ path: `${out}/phone.jpg`, quality: 85 }); await p.context().close(); }
await browser.close(); if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('pictures written, no console errors or warnings');
