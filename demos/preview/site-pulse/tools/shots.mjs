// The pictures kept with Site Pulse. Usage: node shots.mjs [base-url] [out-dir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8774', out = process.argv[3] || new URL('..', import.meta.url).pathname, url = base + '/demos/site-pulse/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }); const errors = [];
async function page(w, h, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 }); const p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); await p.goto(url); await p.waitForFunction(() => window.sitePulse); return p; }
{ const p = await page(1440, 900); await p.screenshot({ path: `${out}/thumbnail.png` }); await p.screenshot({ path: `${out}/screenshot.jpg`, type: 'jpeg', quality: 88, fullPage: true });
  await p.evaluate(() => window.sitePulse.set({ range: 91, sites: ['kols-korner'] })); await p.mouse.move(700, 450); await p.waitForTimeout(200); /* on the chart itself, so the picture shows a reading */ await p.screenshot({ path: `${out}/proof.jpg`, type: 'jpeg', quality: 88 }); await p.context().close(); }
{ const p = await page(390, 800, true); await p.screenshot({ path: `${out}/phone.jpg`, type: 'jpeg', quality: 88, fullPage: true }); await p.context().close(); }
await browser.close(); console.log(errors.length ? 'console problems:\n' + errors.slice(0, 10).join('\n') : 'pictures written, no console errors or warnings');
