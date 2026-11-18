// Writes the demo's pictures. Usage: node shots.mjs <base-url> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8777', out = process.argv[3] || '.', url = base + '/demos/rooms-os-theme/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }), problems = [];
async function page(w, h, scale = 1, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch, colorScheme: 'dark' }), p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); }); p.on('pageerror', e => problems.push(String(e))); await p.goto(url); await p.waitForFunction(() => window.housePreview); await p.click('#still'); return p; }
{ const p = await page(1280, 800); await p.screenshot({ path: `${out}/thumbnail.png` }); await p.evaluate(() => document.getElementById('spec-h').scrollIntoView()); await p.waitForTimeout(200); await p.screenshot({ path: `${out}/screenshot.jpg`, quality: 88 }); await p.click('#m-light'); await p.waitForTimeout(200); await p.screenshot({ path: `${out}/proof.jpg`, quality: 88 }); await p.context().close(); }
{ const p = await page(390, 800, 2, true); await p.evaluate(() => document.querySelector('.bar').scrollIntoView()); await p.waitForTimeout(200); await p.screenshot({ path: `${out}/phone.jpg`, quality: 85 }); await p.context().close(); }
await browser.close(); if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('pictures written, no console errors or warnings');
