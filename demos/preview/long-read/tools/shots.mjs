// Writes the demo's pictures. Usage: node shots.mjs <base-url> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8782', out = process.argv[3] || '.', url = base + '/demos/long-read/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }), problems = [];
async function page(w, h, o = {}) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.scale || 1, hasTouch: !!o.touch, isMobile: !!o.touch }), p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); }); p.on('pageerror', e => problems.push(String(e))); await p.goto(url); await p.waitForFunction(() => window.longRead); await p.waitForTimeout(250); return p; }
const to = (p, id, up = 0) => p.evaluate(([id, up]) => { document.getElementById(id).scrollIntoView(); scrollBy(0, -up); }, [id, up]);
{ const p = await page(1280, 800); await p.screenshot({ path: `${out}/thumbnail.png` }); /* the title card */
  await to(p, 'three', 150); await p.waitForTimeout(250); await p.screenshot({ path: `${out}/screenshot.jpg`, quality: 88 }); /* a chapter, with the list of parts, a note in the margin and a pull quote */
  await p.focus('#short'); await p.keyboard.press('Enter'); await p.focus('#look'); await p.keyboard.press('Enter'); await p.evaluate(() => { scrollTo(0, document.getElementById('words').offsetTop - 80); document.activeElement.blur(); }); await p.waitForTimeout(250); await p.screenshot({ path: `${out}/proof.jpg`, quality: 88 }); await p.context().close(); } /* the short read, in the paper look */
{ const p = await page(390, 800, { scale: 2, touch: true }); await to(p, 'hear', 60); await p.tap('.ref >> nth=2'); await p.waitForTimeout(250); await p.evaluate(() => document.activeElement.blur()); await p.screenshot({ path: `${out}/phone.jpg`, quality: 85 }); await p.context().close(); } /* a phone, with a note opened under its paragraph */
await browser.close(); if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('pictures written, no console errors or warnings');
