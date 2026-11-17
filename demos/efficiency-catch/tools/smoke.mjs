// Browser checks for the film's page. Usage: node smoke.mjs <path-to-axe.min.js>
// Starts its own small server (see serve.mjs) so that jumping about in the video can be tested.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const axeSrc = fs.readFileSync(process.argv[2], 'utf8'), { server, url: base } = await serve(path.resolve(new URL('../../..', import.meta.url).pathname)), url = base + '/demos/efficiency-catch/';
const lines = JSON.parse(fs.readFileSync(new URL('./transcript.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const problems = [], requests = [], done = [];
async function open(w, h, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch }); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${w}x${h}: ${m.text()}`); }); p.on('pageerror', e => problems.push(`${w}x${h}: ${e}`)); p.on('request', r => requests.push(r.url())); await p.goto(url); return p; }
const film = (p, fn) => p.evaluate(`(${fn})(document.getElementById('film'))`);
const axe = async (p, label) => { await p.evaluate(axeSrc); const r = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })); assert.equal(r.violations.length, 0, `${label}: axe: ${r.violations.map(v => `${v.id} (${v.nodes.length}: ${v.nodes[0].target})`).join('; ')}`); };
const layout = async (p, label) => { const bad = await p.evaluate(() => { const out = [], vw = innerWidth; if (document.documentElement.scrollWidth > vw + 1) out.push(`page is ${document.documentElement.scrollWidth} wide`);
  for (const el of document.querySelectorAll('button, a, video, h1, #lines li')) { const r = el.getBoundingClientRect(); if (!r.width) continue; if (r.left < -1 || r.right > vw + 1) out.push(`${el.tagName} "${el.textContent.trim().slice(0, 20)}" off the side`); if (el.tagName === 'BUTTON' && (r.width < 24 || r.height < 24)) out.push(`button ${el.textContent} is ${Math.round(r.width)}x${Math.round(r.height)}`); } return out; }); assert.deepEqual(bad, [], `${label}: ${bad.join('; ')}`); };

{ const p = await open(1280, 800);
  // The film is there, is the right film, and waits to be asked.
  await p.waitForFunction(() => document.getElementById('film').readyState >= 1); const meta = await film(p, v => ({ dur: v.duration, w: v.videoWidth, h: v.videoHeight, paused: v.paused, controls: v.controls, poster: v.poster }));
  assert.ok(Math.abs(meta.dur - 93.6) < 0.2 && meta.w === 1920 && meta.h === 1080, `the film is ${meta.dur} s at ${meta.w}x${meta.h}`); assert.ok(meta.paused, 'nothing plays until asked'); assert.ok(meta.controls);
  assert.ok(await p.evaluate(src => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth === 1920); i.onerror = () => r(false); i.src = src; }), meta.poster), 'the poster picture loads');
  // The transcript is the film's words, line for line.
  const shown = await p.$$eval('#lines li', rows => rows.map(r => ({ at: Number(r.querySelector('.t').dataset.at), text: r.querySelector(':scope > span').textContent }))); assert.deepEqual(shown, lines.map(l => ({ at: l.at, text: l.text })));
  // Three presses of Tab each land on something you can see (the repo's own rule).
  for (let k = 0; k < 3; k++) { await p.keyboard.press('Tab'); const f = await p.evaluate(() => { const n = document.activeElement, r = n.getBoundingClientRect(); return { tag: n.tagName, ok: r.width > 0 && r.height > 0 }; }); assert.ok(f.ok && f.tag !== 'BODY', `Tab ${k + 1} reached ${f.tag}`); }
  await axe(p, '1280'); await layout(p, '1280');
  // Each time is a button with its own name and its line as its description; the film itself is named.
  const named = await p.$$eval('#lines .t', bs => bs.map(b => ({ name: b.textContent, about: document.getElementById(b.getAttribute('aria-describedby')).textContent, off: b.disabled }))); assert.equal(new Set(named.map(n => n.name)).size, named.length, 'two time buttons have the same name'); assert.ok(named.every((n, i) => n.about === lines[i].text && !n.off && n.name.startsWith('Play from ')));
  assert.match(await p.getAttribute('#film', 'aria-label'), /The Catch Is You/); assert.ok(await p.evaluate(() => !document.getElementById('how').hidden)); assert.equal(await p.locator('#lines li[aria-current]').count(), 0, 'no line is marked before the film has played');
  done.push('the film loads (93.6 s, 1920 by 1080), waits to be played, and the page lists its words line for line');

  // Press a time: the film plays from that line, and the line is marked.
  const fifth = lines[4]; await p.click('#lines li:nth-child(5) .t'); await p.waitForFunction(at => { const v = document.getElementById('film'); return !v.paused && v.currentTime > at + 0.4; }, fifth.at);
  const playing = await film(p, v => ({ t: v.currentTime, paused: v.paused })); assert.ok(playing.t > fifth.at && playing.t < fifth.at + 6, `pressing ${fifth.at} s played from ${playing.t}`);
  assert.equal(await p.textContent('#lines li.now > span'), fifth.text, 'the line on screen is marked in the transcript'); assert.equal(await p.locator('#lines li.now').count(), 1); assert.equal(await p.textContent('#lines li[aria-current="true"] > span'), fifth.text, 'and marked for screen readers, not by colour alone');
  await film(p, v => v.pause());
  // By keyboard too.
  await p.focus('#lines li:nth-child(11) .t'); await p.keyboard.press('Enter'); await p.waitForFunction(at => document.getElementById('film').currentTime >= at, lines[10].at); assert.equal(await p.textContent('#lines li.now > span'), lines[10].text, 'the marked line follows a press at once'); await film(p, v => v.pause());
  // The browser really decodes the picture: at "You're the coal." there is a lot of green type on a dark ground.
  const green = await p.evaluate(() => new Promise(resolve => { const v = document.getElementById('film'); v.addEventListener('seeked', () => requestAnimationFrame(() => { const c = document.createElement('canvas'); c.width = 192; c.height = 108; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 192, 108); const d = g.getImageData(0, 0, 192, 108).data; let green = 0, dark = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 1] > 170 && d[i] < 130) green++; if (d[i] + d[i + 1] + d[i + 2] < 90) dark++; } resolve({ green, dark }); }), { once: true }); v.currentTime = 37; }));
  assert.ok(green.green > 400 && green.dark > 12000, `at 37 s the frame has ${green.green} green and ${green.dark} dark pixels of 20,736`);
  // Every scene's frame is different from the one before.
  const sums = []; for (const t of [3, 10, 20, 30, 45, 58, 78, 91]) sums.push(await p.evaluate(t => new Promise(resolve => { const v = document.getElementById('film'); v.addEventListener('seeked', () => requestAnimationFrame(() => { const c = document.createElement('canvas'); c.width = 96; c.height = 54; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 96, 54); resolve([...g.getImageData(0, 0, 96, 54).data].filter((_, i) => i % 4 === 1)); }), { once: true }); v.currentTime = t; }), t));
  for (let i = 1; i < sums.length; i++) { let diff = 0; for (let k = 0; k < sums[i].length; k++) diff += Math.abs(sums[i][k] - sums[i - 1][k]); assert.ok(diff / sums[i].length > 2, 'two scenes look the same'); }
  // The mark follows the film's own controls too: the very start, between two close lines, and the very end.
  const seek = t => p.evaluate(t => new Promise(r => { const v = document.getElementById('film'); v.addEventListener('seeked', () => r(), { once: true }); v.currentTime = t; }), t), marked = () => p.evaluate(() => { const n = document.querySelector('#lines li.now > span'); return n ? n.textContent : null; });
  await seek(0); assert.equal(await marked(), null, 'nothing is marked at the very start'); await seek(0.72); assert.equal(await marked(), lines[0].text); await seek(3.4); assert.equal(await marked(), lines[0].text); await seek(3.62); assert.equal(await marked(), lines[1].text);
  await seek(60.1); assert.equal(await marked(), lines[15].text); await seek(60.3); assert.equal(await marked(), lines[16].text); await seek(93.5); assert.equal(await marked(), lines[22].text, 'the last line is marked at the end');
  done.push('pressing a time (mouse or keyboard) plays from that line and marks it; the mark is right at the start, between lines and at the end; frames decode and differ scene to scene');
  await p.context().close(); }

for (const [w, h] of [[400, 800], [320, 568], [740, 360]]) { const p = await open(w, h, true); await p.waitForFunction(() => document.getElementById('film').readyState >= 1); await layout(p, `${w}x${h}`); await axe(p, `${w}x${h}`);
  const box = await p.evaluate(() => { const r = document.querySelector('.film').getBoundingClientRect(); return { w: r.width, ratio: r.width / r.height }; }); assert.ok(Math.abs(box.ratio - 16 / 9) < 0.02 && box.w <= w, `the film box is ${box.w} wide at ${box.ratio.toFixed(2)}`);
  await p.tap('#lines li:nth-child(3) .t'); await p.waitForFunction(at => document.getElementById('film').currentTime >= at, lines[2].at); await film(p, v => v.pause()); await p.context().close(); }
done.push('phones 400x800, 320x568, 740x360: nothing off the side, the film keeps its shape, the transcript works by touch');

await browser.close(); server.close();
const outside = requests.filter(u => !u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:'));
assert.deepEqual(outside, [], 'requests left the page: ' + outside.join(', ')); assert.deepEqual(problems, [], 'console problems:\n' + problems.join('\n'));
console.log('ok  ' + done.join('\nok  ') + '\nok  axe WCAG 2.2 A and AA clean at four sizes; no console errors; no request left the page');
