// Writes the demo's pictures. Usage: node shots.mjs <base-url> <out-dir>
// Each is a game played by rule to a set moment, so the pictures are the same every time.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8786', out = process.argv[3] || '.', url = base + '/demos/close-shave/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }), problems = [];
async function page(w, h, o = {}) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.scale || 1, hasTouch: !!o.touch, isMobile: !!o.touch }), p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); }); p.on('pageerror', e => problems.push(String(e))); await p.goto(url); await p.waitForFunction(() => window.closeShave); await p.waitForTimeout(250); return p; }
// Play to a moment and take the picture at once: started, played and drawn in one go, then the game is paused out of sight of the picture.
const at = async (p, seed, seconds, how, file, opts) => { await p.evaluate(([seed, seconds, how]) => { const c = window.closeShave; c.start(seed); c.play(seconds, how); document.getElementById('board').blur(); }, [seed, seconds, how]); await p.screenshot({ path: `${out}/${file}`, ...opts }); await p.keyboard.press('p'); };
{ const p = await page(1280, 800); await p.screenshot({ path: `${out}/thumbnail.png` }); /* the title and the room, ready */
  await at(p, 5, 21.4, 'fine', 'screenshot.jpg', { quality: 88 }); await p.keyboard.press('p'); /* in play at five times, two walls in the room */
  await p.evaluate(() => { window.closeShave.start(5); window.closeShave.play(60, 'fine'); window.closeShave.play(200, 'still'); }); await p.waitForTimeout(150); await p.screenshot({ path: `${out}/proof.jpg`, quality: 88 }); await p.context().close(); } /* game over, with the game's figures */
{ const p = await page(390, 800, { scale: 2, touch: true }); await p.evaluate(() => document.querySelector('.game').scrollIntoView()); await at(p, 5, 14.2, 'fine', 'phone.jpg', { quality: 85 }); await p.context().close(); } /* a phone, in play */
await browser.close(); if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('pictures written, no console errors or warnings');
