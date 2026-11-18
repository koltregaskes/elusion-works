// Writes the demo's pictures. Usage: node shots.mjs <base-url> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8785', out = process.argv[3] || '.', url = base + '/demos/hub-digest/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }), problems = [];
async function page(w, h, o = {}) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.scale || 1, hasTouch: !!o.touch, isMobile: !!o.touch }), p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); }); p.on('pageerror', e => problems.push(String(e))); await p.goto(url); await p.waitForFunction(() => window.digest); await p.evaluate(() => window.digest.ready); await p.waitForTimeout(250); return p; }
{ const p = await page(1280, 800); await p.screenshot({ path: `${out}/thumbnail.png` }); /* the title, the first checks, the inbox line and the top of the email */
  await p.evaluate(() => scrollTo(0, 520)); await p.screenshot({ path: `${out}/screenshot.jpg`, quality: 88 }); /* the checks beside the body of the email */
  await p.click('button[data-look="text"]'); await p.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); }); await p.screenshot({ path: `${out}/proof.jpg`, quality: 88 }); await p.context().close(); } /* the same issue as plain text */
{ const p = await page(390, 800, { scale: 2, touch: true }); await p.evaluate(() => document.querySelector('main').scrollIntoView()); await p.waitForTimeout(200); await p.screenshot({ path: `${out}/phone.jpg`, quality: 85 }); await p.context().close(); } /* a phone: how an inbox shows it, and the email */
await browser.close(); if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('pictures written, no console errors or warnings');
