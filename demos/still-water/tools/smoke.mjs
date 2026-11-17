// Browser checks for Still Water. Usage: node smoke.mjs <path-to-axe.min.js> [base-url]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const axeSrc = fs.readFileSync(process.argv[2], 'utf8'), base = process.argv[3] || 'http://127.0.0.1:8772', url = base + '/demos/still-water/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [], requests = [], done = [];
async function open(w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!opts.touch, isMobile: !!opts.touch, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${w}x${h}: ${m.text()}`); }); p.on('pageerror', e => problems.push(`${w}x${h}: ${e}`)); p.on('request', r => requests.push(r.url())); p.on('requestfailed', r => problems.push('failed request ' + r.url()));
  await p.goto(url); await p.evaluate(() => window.stillWater.ready); return p;
}
const state = p => p.evaluate(() => window.stillWater.state());
const fast = (p, n) => p.evaluate(n => window.stillWater.fast(n), n);
const visible = (p, sel) => p.evaluate(s => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0; }, sel);
const axe = async (p, label) => { await p.evaluate(axeSrc); const r = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })); assert.equal(r.violations.length, 0, `${label}: axe: ${r.violations.map(v => `${v.id} (${v.nodes.length}: ${v.nodes[0].target})`).join('; ')}`); };
const layout = async (p, label) => { const bad = await p.evaluate(() => { const out = [], vw = innerWidth, vh = innerHeight; if (document.documentElement.scrollWidth > vw + 1) out.push(`page is ${document.documentElement.scrollWidth} wide`);
  for (const el of document.querySelectorAll('button, #map, #plate, #start')) { if (!el.getClientRects().length) continue; const r = el.getBoundingClientRect(), name = el.id || el.textContent.trim().slice(0, 16); if (r.left < -1 || r.right > vw + 1) out.push(`${name} off the side`);
    if (el.tagName === 'BUTTON') { if (r.width < 24 || r.height < 24) out.push(`${name} is ${Math.round(r.width)}x${Math.round(r.height)}`); if (!el.closest('.card, dialog') && (r.top < -1 || r.bottom > vh + 1)) out.push(`${name} off the screen`); } }
  const a = document.getElementById('plate').getBoundingClientRect(), b = document.getElementById('tools').getBoundingClientRect(); if (a.width && b.width && a.top < b.bottom && a.right > b.left && a.left < b.right && a.bottom > b.top) out.push('the plate panel and the tools overlap');
  return out; }); assert.deepEqual(bad, [], `${label}: ${bad.join('; ')}`); };
// Is the picture on screen more than one flat colour? Reads the drawn frame back.
const drawn = async p => { const shot = await p.screenshot({ type: 'png' }); return shot.length; };
const turnTo = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// ---- 1. The way in ----
{ const p = await open(1280, 800); let s = await state(p);
  assert.equal(s.mode, 'start'); assert.equal(s.loaded, 12, 'all twelve photographs loaded'); assert.equal(s.failed, 0); assert.ok(s.triangles > 20000, `the rooms are drawn (${s.triangles} triangles)`);
  assert.ok(await visible(p, '#start')); assert.ok(!(await visible(p, '#tools')) && !(await visible(p, '#plate')));
  assert.ok(await drawn(p) > 60000, 'the view is not a flat colour'); await axe(p, 'start'); await layout(p, 'start');
  await p.focus('#enter'); await p.keyboard.press('Enter'); s = await state(p); assert.equal(s.mode, 'walk'); assert.ok(await visible(p, '#tools') && await visible(p, '#plate') && !(await visible(p, '#start')));
  assert.equal(await p.evaluate(() => document.activeElement.id), 'stage', 'the view has the keyboard'); assert.equal(await p.textContent('#plate-t'), 'Walk up to a photograph, or press Next.');
  done.push('the way in: twelve photographs loaded, rooms drawn, Walk in works by keyboard');

  // ---- 2. Walking by keyboard ----
  const a = await state(p); await p.keyboard.down('KeyW'); await fast(p, 60); await p.keyboard.up('KeyW'); let b = await state(p); assert.ok(Math.abs(b.x - a.x - 2.7) < 0.1 && Math.abs(b.z - a.z) < 0.01, `W walks forward, east, 2.7 m a second (moved ${(b.x - a.x).toFixed(2)})`);
  await p.keyboard.down('ArrowLeft'); await fast(p, 30); await p.keyboard.up('ArrowLeft'); let c = await state(p); assert.ok(Math.abs(Math.atan2(Math.sin(c.yaw - b.yaw), Math.cos(c.yaw - b.yaw)) - 0.95) < 0.05, 'the left arrow turns left');
  await p.keyboard.down('ArrowUp'); await fast(p, 600); await p.keyboard.up('ArrowUp'); c = await state(p); assert.ok(c.clear, 'ten seconds of walking at a wall does not go through it'); await fast(p, 5); const d = await state(p); assert.ok(Math.hypot(d.x - c.x, d.z - c.z) < 1e-6, 'letting go of the key stops you');
  // Dragging looks round, and real frames advance the place.
  const y0 = (await state(p)).yaw; await p.mouse.move(640, 400); await p.mouse.down(); await p.mouse.move(740, 430, { steps: 4 }); await p.mouse.up(); const y1 = await state(p); assert.ok(y1.yaw < y0 - 0.3 || y1.yaw > y0 + 5, 'dragging right looks right'); assert.ok(y1.pitch < -0.05, 'dragging down looks down');
  const t0 = (await state(p)).time; await p.waitForTimeout(500); assert.ok((await state(p)).time > t0, 'the water moves on real frames');
  await p.click('#still'); const t1 = (await state(p)).time; await p.waitForTimeout(300); assert.equal((await state(p)).time, t1, 'Still the water stops it'); assert.equal(await p.getAttribute('#still', 'aria-pressed'), 'true'); await p.click('#still');
  done.push('keyboard walking, turning, a wall that stops you, drag to look, water can be stilled');

  // ---- 3. From plate to plate ----
  const plates = await p.evaluate(() => window.stillWater.plates()); assert.equal(plates.length, 12); assert.equal(new Set(plates.map(q => q.alt)).size, 12);
  await p.evaluate(() => window.stillWater.place(-18, -17, -Math.PI / 2));
  for (let i = 0; i < 12; i++) { await p.focus('#stage'); await p.keyboard.press('PageDown'); let n = 0; while ((await state(p)).gliding && n < 60) { await fast(p, 120); n++; } const s2 = await state(p), v = plates[i].view;
    assert.ok(!s2.gliding, `the walk to plate ${i + 1} never ended`); assert.ok(Math.hypot(s2.x - v.x, s2.z - v.z) < 0.01 && turnTo(s2.yaw, v.yaw) < 0.02, `not standing square in front of plate ${i + 1}`); assert.equal(s2.plate, i + 1); assert.ok(s2.clear);
    assert.equal(await p.textContent('#plate-n'), `Plate ${String(i + 1).padStart(2, '0')} of 12`); assert.equal(await p.textContent('#plate-t'), plates[i].alt);
    if (i === 6) assert.ok(s2.y < 1.62 + 0.001, 'eye height is sane'); }
  await p.keyboard.press('PageUp'); await fast(p, 60 * 30); assert.equal((await state(p)).plate, 11, 'PageUp goes back one');
  // On the way to a plate, touching a walking key hands control back.
  await p.click('#next'); await fast(p, 20); assert.ok((await state(p)).gliding); await p.keyboard.down('KeyS'); await fast(p, 5); await p.keyboard.up('KeyS'); assert.ok(!(await state(p)).gliding, 'a walking key stops the walk to a plate');
  // Wading: plate 8 hangs across the water.
  await p.evaluate(() => { window.stillWater.goTo(7, true); window.stillWater.fast(60); }); const w8 = await state(p); assert.ok(w8.wade > 0.5 && w8.y < 1.2, 'at plate 8 you stand in the water'); assert.equal(w8.plate, 8);
  await axe(p, 'walking'); await layout(p, 'walking');
  done.push('PageDown reaches all twelve plates in order, square on, with the right words; PageUp goes back; plate 8 is reached by wading');

  // ---- 4. The list, and the walk round ----
  await p.click('#list'); assert.ok(await p.evaluate(() => document.getElementById('all').open)); assert.equal(await p.locator('#plates button').count(), 12); assert.equal(await p.getAttribute('#plates li:nth-child(8) button', 'aria-current'), 'true');
  await p.waitForFunction(() => [...document.querySelectorAll('#plates img')].slice(0, 4).every(i => i.complete && i.naturalWidth > 0)); await axe(p, 'list');
  await p.keyboard.down('KeyW'); await fast(p, 30); await p.keyboard.up('KeyW'); const stay = await state(p); assert.ok(Math.hypot(stay.x - w8.x, stay.z - w8.z) < 1e-6, 'keys do not walk you about behind the list');
  await p.click('#plates li:nth-child(3) button'); assert.ok(!(await p.evaluate(() => document.getElementById('all').open))); await fast(p, 60 * 40); assert.equal((await state(p)).plate, 3, 'choosing a plate from the list takes you there');
  await p.click('#list'); await p.keyboard.press('Escape'); assert.ok(!(await p.evaluate(() => document.getElementById('all').open)), 'Escape closes the list');
  await p.evaluate(() => window.stillWater.place(-18, -17, -Math.PI / 2)); await p.click('#tour'); assert.equal(await p.getAttribute('#tour', 'aria-pressed'), 'true');
  const seen = new Set(); for (let i = 0; i < 400 && (await state(p)).touring; i++) { await fast(p, 60); const s3 = await state(p); if (!s3.gliding && s3.plate) seen.add(s3.plate); assert.ok(s3.clear); }
  assert.equal(seen.size, 12, `the walk round stopped at ${seen.size} plates`); assert.equal((await state(p)).touring, false, 'the walk round ends at the last plate'); assert.equal(await p.getAttribute('#tour', 'aria-pressed'), 'false');
  await p.click('#tour'); await fast(p, 30); await p.keyboard.press('Escape'); assert.equal((await state(p)).touring, false, 'Escape stops the walk round');
  await p.click('#sound'); assert.equal((await state(p)).soundOn, true); assert.equal(await p.getAttribute('#sound', 'aria-pressed'), 'true'); await fast(p, 30); await p.click('#sound'); assert.equal((await state(p)).soundOn, false);
  done.push('the list of plates opens, is keyboard-safe and takes you there; the walk round visits all twelve and stops; sound toggles');
  await p.context().close(); }

// ---- 5. Reduced motion: cuts, not glides; water still ----
{ const p = await open(1280, 800, { reduced: true }); await p.click('#enter'); assert.equal((await state(p)).still, true); await p.click('#next'); await fast(p, 1); const s = await state(p); assert.ok(!s.gliding && s.plate === 1, 'with reduced motion, Next cuts straight to the plate'); const t = s.time; await p.waitForTimeout(300); assert.equal((await state(p)).time, t); await p.context().close(); done.push('reduced motion: cuts to plates, water still'); }

// ---- 6. Phones ----
for (const [w, h] of [[400, 800], [320, 568], [740, 360]]) { const p = await open(w, h, { touch: true }); await layout(p, `start ${w}x${h}`); await axe(p, `start ${w}x${h}`);
  assert.ok(await p.evaluate(() => { const r = document.getElementById('enter').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), `${w}x${h}: Walk in is on the screen`);
  await p.tap('#enter'); await layout(p, `walking ${w}x${h}`); await axe(p, `walking ${w}x${h}`);
  // The left of the screen is a stick to walk with; the right looks round.
  const a = await state(p); const sx = Math.round(w * 0.2), sy = Math.round(h * 0.55);
  await p.dispatchEvent('#stage', 'pointerdown', { pointerId: 5, pointerType: 'touch', clientX: sx, clientY: sy, isPrimary: true }); await p.dispatchEvent('#stage', 'pointermove', { pointerId: 5, pointerType: 'touch', clientX: sx, clientY: sy - 70 }); assert.ok(await visible(p, '#stick'));
  await fast(p, 60); await p.dispatchEvent('#stage', 'pointerup', { pointerId: 5, pointerType: 'touch', clientX: sx, clientY: sy - 70 }); const b = await state(p); assert.ok(b.x - a.x > 2.3, `the stick walks you forward (moved ${(b.x - a.x).toFixed(2)})`); assert.ok(!(await visible(p, '#stick')));
  await fast(p, 10); const c = await state(p); assert.ok(Math.hypot(c.x - b.x, c.z - b.z) < 1e-6, 'lifting the thumb stops you');
  const rx = Math.round(w * 0.75); await p.dispatchEvent('#stage', 'pointerdown', { pointerId: 6, pointerType: 'touch', clientX: rx, clientY: sy }); await p.dispatchEvent('#stage', 'pointermove', { pointerId: 6, pointerType: 'touch', clientX: rx - 60, clientY: sy }); await p.dispatchEvent('#stage', 'pointerup', { pointerId: 6, pointerType: 'touch', clientX: rx - 60, clientY: sy });
  const d = await state(p); assert.ok(Math.atan2(Math.sin(d.yaw - c.yaw), Math.cos(d.yaw - c.yaw)) > 0.2, 'dragging left on the right of the screen looks left');
  await p.tap('#next'); await fast(p, 60 * 30); const e = await state(p); assert.equal(e.plate, 1); await layout(p, `plate ${w}x${h}`);
  await p.tap('#list'); await axe(p, `list ${w}x${h}`); await layout(p, `list ${w}x${h}`); await p.tap('#all-close');
  await p.context().close(); }
done.push('phones 400x800, 320x568, 740x360: stick walks, drag looks, Next works, nothing off screen or overlapping');

await browser.close();
const outside = requests.filter(u => !u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:'));
assert.deepEqual(outside, [], 'requests left the page: ' + outside.join(', '));
assert.deepEqual(problems, [], 'console problems:\n' + problems.join('\n'));
console.log('ok  ' + done.join('\nok  ') + '\nok  axe WCAG 2.2 A and AA clean on the way in, walking and the list at four sizes; no console errors; no request left the page');
