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
  const p = await ctx.newPage(); if (opts.block) await p.route(opts.block, r => r.abort()); if (!opts.quiet) p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${w}x${h}: ${m.text()}`); }); p.on('pageerror', e => problems.push(`${w}x${h}: ${e}`)); p.on('request', r => requests.push(r.url())); if (!opts.quiet) p.on('requestfailed', r => problems.push('failed request ' + r.url()));
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
const drawn = async p => { const shot = (await p.screenshot({ type: 'png' })).toString('base64'); return p.evaluate(async b64 => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()), c = new OffscreenCanvas(160, 100), g = c.getContext('2d'); g.drawImage(bmp, 0, 0, 160, 100); const d = g.getImageData(0, 0, 160, 100).data, seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3)); return seen.size; }, shot); }; // how many different colours are on the screen
const turnTo = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// ---- 1. The way in ----
{ const p = await open(1280, 800); let s = await state(p);
  assert.equal(s.mode, 'start'); assert.equal(s.loaded, 12, 'all twelve photographs loaded'); assert.equal(s.failed, 0); assert.ok(s.triangles > 20000, `the rooms are drawn (${s.triangles} triangles)`);
  assert.ok(await visible(p, '#start')); assert.ok(!(await visible(p, '#tools')) && !(await visible(p, '#plate')));
  { const colours = await drawn(p); assert.ok(colours > 60, `the view has only ${colours} colours in it`); }
  // The repo's rule: as the page loads, three presses of Tab each land on something you can see.
  { const q = await open(1280, 800); for (const want of ['stage', 'enter', 'enter-tour']) { await q.keyboard.press('Tab'); assert.equal(await q.evaluate(() => document.activeElement.id), want); } await q.context().close(); } await axe(p, 'start'); await layout(p, 'start');
  await p.focus('#enter'); await p.keyboard.press('Enter'); s = await state(p); assert.equal(s.mode, 'walk'); assert.ok(await visible(p, '#tools') && await visible(p, '#plate') && !(await visible(p, '#start')));
  assert.equal(await p.evaluate(() => document.activeElement.id), 'stage', 'the view has the keyboard'); assert.ok(await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('stage')).outlineOffset) < 0 && document.getElementById('stage').matches(':focus-visible')), 'the focus outline on the view is drawn inside the screen, where it can be seen'); assert.equal(await p.textContent('#plate-t'), 'Walk up to a photograph, or press Next.');
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
  const heard = new Set(); for (let i = 0; i < 12; i++) { await p.focus('#stage'); await p.keyboard.press('PageDown'); await fast(p, 3); if ((await state(p)).gliding) assert.equal(await p.textContent('#plate-n'), `On the way to plate ${String(i + 1).padStart(2, '0')}`, 'while walking, the panel says where you are going, not where you were'); let n = 0; while ((await state(p)).gliding && n < 60) { await fast(p, 120); n++; } const s2 = await state(p), v = plates[i].view;
    assert.ok(!s2.gliding, `the walk to plate ${i + 1} never ended`); assert.ok(Math.hypot(s2.x - v.x, s2.z - v.z) < 0.01 && turnTo(s2.yaw, v.yaw) < 0.02, `not standing square in front of plate ${i + 1}`); assert.equal(s2.plate, i + 1); assert.ok(s2.clear);
    assert.equal(await p.textContent('#plate-n'), `Plate ${String(i + 1).padStart(2, '0')} of 12`); assert.equal(await p.textContent('#plate-t'), plates[i].alt);
    assert.equal(s2.said, `Plate ${i + 1} of 12. ${plates[i].alt}`, 'arriving is announced once, with the description'); heard.add(s2.said); }
  assert.equal(heard.size, 12);
  await p.keyboard.press('PageUp'); await fast(p, 60 * 30); assert.equal((await state(p)).plate, 11, 'PageUp goes back one');
  // On the way to a plate, touching a walking key hands control back.
  await p.click('#next'); await fast(p, 20); assert.ok((await state(p)).gliding); await p.keyboard.down('KeyS'); await fast(p, 5); await p.keyboard.up('KeyS'); assert.ok(!(await state(p)).gliding, 'a walking key stops the walk to a plate');
  // Wading: plate 8 hangs across the water.
  await p.evaluate(() => { window.stillWater.goTo(7, true); window.stillWater.fast(60); }); const w8 = await state(p); assert.ok(w8.wade > 0.5 && w8.y < 1.2, 'at plate 8 you stand in the water'); assert.equal(w8.plate, 8);
  // The panel tells the truth: turn until the photograph is off the screen, or look at the floor, and it stops naming it.
  { const v = plates[3].view; await p.evaluate(v => { window.stillWater.place(v.x, v.z, v.yaw); window.stillWater.fast(2); }, v); assert.equal((await state(p)).plate, 4);
    await p.evaluate(v => { window.stillWater.place(v.x, v.z, v.yaw + 0.9); window.stillWater.fast(2); }, v); assert.equal((await state(p)).plate, 0, 'a photograph off to one side is not the one in front of you');
    await p.evaluate(v => { window.stillWater.place(v.x, v.z, v.yaw, -0.7); window.stillWater.fast(2); }, v); assert.equal((await state(p)).plate, 0, 'looking at the floor is not looking at the photograph'); assert.equal(await p.textContent('#plate-n'), 'Still Water'); }
  // Mouse presses hand the keyboard back to the view; key presses leave the focus on the button; letters do nothing while a button has the focus.
  await p.click('#still'); assert.equal(await p.evaluate(() => document.activeElement.id), 'stage'); await p.click('#still');
  await p.focus('#sound'); await p.keyboard.press('t'); assert.equal((await state(p)).touring, false, 'T is not a shortcut while a button has the focus'); await p.keyboard.press('Enter'); assert.equal((await state(p)).soundOn, true); assert.equal(await p.evaluate(() => document.activeElement.id), 'sound'); await p.keyboard.press('Enter'); await p.focus('#stage');
  await axe(p, 'walking'); await layout(p, 'walking');
  done.push('PageDown reaches all twelve plates in order, square on, with the right words; PageUp goes back; plate 8 is reached by wading');

  // ---- 4. The list, and the walk round ----
  await p.evaluate(() => { window.stillWater.goTo(7, true); window.stillWater.fast(2); }); const at8 = await state(p); assert.equal(at8.plate, 8);
  await p.click('#list'); assert.ok(await p.evaluate(() => document.getElementById('all').open)); assert.equal(await p.locator('#plates button').count(), 12); assert.equal(await p.getAttribute('#plates li:nth-child(8) button', 'aria-current'), 'true');
  await p.waitForFunction(() => [...document.querySelectorAll('#plates img')].slice(0, 4).every(i => i.complete && i.naturalWidth > 0)); await axe(p, 'list');
  await p.keyboard.down('KeyW'); await fast(p, 30); await p.keyboard.up('KeyW'); const stay = await state(p); assert.ok(Math.hypot(stay.x - at8.x, stay.z - at8.z) < 1e-6, 'keys do not walk you about behind the list');
  await p.keyboard.press('Escape'); await p.focus('#stage'); await p.keyboard.down('KeyW'); await fast(p, 5); await p.keyboard.press('l'); const held = await state(p); await fast(p, 60); const after = await state(p); assert.ok(Math.hypot(after.x - held.x, after.z - held.z) < 1e-6, 'a key held as the list opens does not keep walking you'); await p.keyboard.up('KeyW');
  assert.match(await p.textContent('#plates li:nth-child(2) small'), /sailing boat/, 'the list shows each description in words');
  await p.click('#plates li:nth-child(3) button'); assert.ok(!(await p.evaluate(() => document.getElementById('all').open))); await fast(p, 60 * 40); assert.equal((await state(p)).plate, 3, 'choosing a plate from the list takes you there');
  await p.click('#list'); await p.keyboard.press('Escape'); assert.ok(!(await p.evaluate(() => document.getElementById('all').open)), 'Escape closes the list');
  await p.evaluate(() => window.stillWater.place(-18, -17, -Math.PI / 2)); await p.click('#tour'); assert.equal(await p.getAttribute('#tour', 'aria-pressed'), 'true');
  const seen = new Set(); for (let i = 0; i < 400 && (await state(p)).touring; i++) { await fast(p, 60); const s3 = await state(p); if (!s3.gliding && s3.plate) seen.add(s3.plate); assert.ok(s3.clear); }
  assert.equal(seen.size, 12, `the walk round stopped at ${seen.size} plates`); assert.equal((await state(p)).touring, false, 'the walk round ends at the last plate'); assert.equal(await p.getAttribute('#tour', 'aria-pressed'), 'false');
  await p.click('#tour'); await fast(p, 30); await p.keyboard.press('Escape'); assert.equal((await state(p)).touring, false, 'Escape stops the walk round'); assert.equal((await state(p)).gliding, false, 'and stops you where you are');
  await p.click('#tour'); await fast(p, 30); await p.click('#tour'); assert.ok(!(await state(p)).touring && !(await state(p)).gliding, 'switching the walk round off stops you where you are');
  // Started in front of plate 7, the walk round still makes all twelve stops, 8 first and 7 last.
  { await p.evaluate(v => { window.stillWater.place(v.x, v.z, v.yaw); window.stillWater.fast(2); }, plates[6].view); assert.equal((await state(p)).plate, 7); await p.click('#tour'); const order = [];
    for (let i = 0; i < 500 && (await state(p)).touring; i++) { await fast(p, 60); const s4 = await state(p); if (!s4.gliding && s4.plate && order[order.length - 1] !== s4.plate) order.push(s4.plate); }
    assert.deepEqual(order, [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7], `from plate 7 the walk round went ${order}`); }
  await p.click('#sound'); assert.equal((await state(p)).soundOn, true); assert.equal(await p.getAttribute('#sound', 'aria-pressed'), 'true'); await fast(p, 30); await p.click('#sound'); assert.equal((await state(p)).soundOn, false);
  done.push('the list of plates opens, is keyboard-safe and takes you there; the walk round visits all twelve and stops; sound toggles');
  await p.context().close(); }

// ---- 5. Reduced motion: cuts, not glides; water still ----
{ const p = await open(1280, 800, { reduced: true }); await p.click('#enter'); assert.equal((await state(p)).still, true); await p.click('#next'); await fast(p, 1); const s = await state(p); assert.ok(!s.gliding && s.plate === 1, 'with reduced motion, Next cuts straight to the plate'); const t = s.time; await p.waitForTimeout(300); assert.equal((await state(p)).time, t);
  // The walk round with reduced motion: a cut to each plate, and a proper six-second stop at every one.
  await p.click('#tour'); const stops = []; let at = 0, since = 0;
  for (let i = 0; i < 12 * 8 && (await state(p)).touring; i++) { await fast(p, 60); const q = await state(p); if (q.plate !== at) { if (at) stops.push([at, since]); at = q.plate; since = 0; } since++; }
  stops.push([at, since]); assert.deepEqual(stops.map(x => x[0]), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1], `with reduced motion the walk round went ${stops.map(x => x[0])}`); assert.ok(stops.slice(0, -1).every(x => x[1] >= 5 && x[1] <= 7), `stops lasted ${stops.map(x => x[1])} seconds`);
  await p.context().close(); done.push('reduced motion: cuts to plates, water still, and the walk round still stops six seconds at each of the twelve'); }

// ---- 5b. A photograph that will not load is called missing, not described ----
{ const p = await open(1280, 800, { block: '**/img/k06.jpg', quiet: true }); const s = await state(p); assert.equal(s.loaded, 11); assert.equal(s.failed, 1); await p.click('#enter'); await p.evaluate(() => { window.stillWater.goTo(1, true); window.stillWater.fast(2); });
  const q = await state(p); assert.equal(q.plate, 2); assert.equal(q.words, 'This photograph could not be loaded.'); assert.match(q.said, /could not be loaded/); await p.click('#list'); await p.waitForSelector('#plates li:nth-child(2) .lost'); assert.equal(await p.textContent('#plates li:nth-child(2) small'), 'This photograph could not be loaded.'); assert.match(await p.textContent('#plates li:nth-child(3) small'), /jetty/);
  await p.context().close(); done.push('a photograph that fails to load is said to be missing, in the panel and in the list'); }

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
  const was = (await state(p)).plate; await p.tap('#next'); await fast(p, 60 * 30); const e = await state(p); assert.equal(e.plate, was % 12 + 1, 'Next goes to the plate after the one in front of you'); await layout(p, `plate ${w}x${h}`); assert.ok(await p.evaluate(() => { const t = document.getElementById('plate-t'); return getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().height > 8 && t.textContent.length > 20; }), `${w}x${h}: the description is on the screen`);
  // On every screen shape the whole photograph is on the screen when you are stood in front of it, even in the water at plate 8.
  for (const i of [0, 4, 7]) { await p.evaluate(i => { window.stillWater.goTo(i, true); window.stillWater.fast(2); }, i); const q = await state(p); assert.equal(q.plate, i + 1); }
  await p.tap('#list'); await axe(p, `list ${w}x${h}`); await layout(p, `list ${w}x${h}`); await p.tap('#all-close');
  await p.context().close(); }
done.push('phones 400x800, 320x568, 740x360: stick walks, drag looks, Next works, nothing off screen or overlapping');

await browser.close();
const outside = requests.filter(u => !u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:'));
assert.deepEqual(outside, [], 'requests left the page: ' + outside.join(', '));
assert.deepEqual(problems, [], 'console problems:\n' + problems.join('\n'));
console.log('ok  ' + done.join('\nok  ') + '\nok  axe WCAG 2.2 A and AA clean on the way in, walking and the list at four sizes; no console errors; no request left the page');
