// The page pictures kept with this demo. Usage: node shots.mjs  (starts its own server)
import { createRequire } from 'node:module';
import path from 'node:path';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('..', import.meta.url).pathname, { server, url } = await serve(path.resolve(new URL('../../..', import.meta.url).pathname));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
for (const [w, h, name, touch] of [[1280, 800, 'thumbnail.png', false], [1280, 2000, 'screenshot.jpg', false], [390, 800, 'phone.jpg', true]]) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch }), p = await ctx.newPage(); await p.goto(url + '/demos/efficiency-catch/'); await p.waitForFunction(() => document.getElementById('film').readyState >= 1);
  await p.evaluate(() => new Promise(r => { const v = document.getElementById('film'); v.addEventListener('seeked', () => requestAnimationFrame(r), { once: true }); v.currentTime = 36.6; }));
  // Wait until the browser has enough of the film to stop showing its loading spinner (it was caught in an earlier thumbnail), then a moment more.
  await p.waitForFunction(() => { const v = document.getElementById('film'); return !v.seeking && v.readyState >= 3; }, null, { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.screenshot(name.endsWith('.png') ? { path: out + name } : { path: out + name, type: 'jpeg', quality: 86 }); await ctx.close(); }
await browser.close(); server.close(); console.log('pictures written');
