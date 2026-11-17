// Writes the demo's pictures. Usage: node shots.mjs <base-url> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8780', out = process.argv[3] || '.', url = base + '/demos/handbook/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }), problems = [];
async function page(w, h, o = {}) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.scale || 1, hasTouch: !!o.touch, isMobile: !!o.touch, colorScheme: o.scheme || 'dark' }), p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); }); p.on('pageerror', e => problems.push(String(e))); await p.goto(url + (o.hash || '')); await p.waitForFunction(() => window.handbook); await p.waitForTimeout(250); return p; }
{ const p = await page(1280, 800); await p.screenshot({ path: `${out}/thumbnail.png` }); await p.goto(url + '#claims'); await p.waitForFunction(() => window.handbook.shown() === 'claims'); await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(200); await p.screenshot({ path: `${out}/screenshot.jpg`, quality: 88 }); /* a page with a code sample, the list of pages and the contents */
  await p.fill('#q', 'stale claim'); await p.waitForTimeout(200); await p.screenshot({ path: `${out}/proof.jpg`, quality: 88 }); await p.context().close(); } /* search at work */
{ const p = await page(390, 800, { scale: 2, touch: true, hash: '#evidence' }); await p.tap('#menu'); await p.waitForTimeout(350); await p.screenshot({ path: `${out}/phone.jpg`, quality: 85 }); await p.context().close(); }
await browser.close(); if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('pictures written, no console errors or warnings');
