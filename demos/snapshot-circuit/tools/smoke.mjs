// Browser checks for Snapshot Circuit. Usage: node smoke.mjs <path-to-axe.min.js> [base-url]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const axeSrc = fs.readFileSync(process.argv[2], 'utf8'), base = process.argv[3] || 'http://127.0.0.1:8771', url = base + '/demos/snapshot-circuit/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [], requests = [], done = [];
const S = fn => `(${fn})(window.snapshotCircuit)`;
async function open(w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!opts.touch, isMobile: !!opts.touch, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', acceptDownloads: false });
  const p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${w}x${h}: ${m.text()}`); }); p.on('pageerror', e => problems.push(`${w}x${h}: ${e}`)); p.on('request', r => requests.push(r.url())); p.on('requestfailed', r => problems.push('failed request ' + r.url()));
  await p.goto(url); await p.evaluate(() => window.snapshotCircuit.ready); return p;
}
const state = p => p.evaluate(() => window.snapshotCircuit.state());
const axe = async (p, label) => { await p.evaluate(axeSrc); const r = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })); assert.equal(r.violations.length, 0, `${label}: axe: ${r.violations.map(v => `${v.id} (${v.nodes.length}: ${v.nodes[0].target})`).join('; ')}`); };
// Everything a person can press is on the screen, big enough, and nothing spills sideways.
const layout = async (p, label) => { const bad = await p.evaluate(() => { const out = [], vw = innerWidth, vh = innerHeight; if (document.documentElement.scrollWidth > vw + 1) out.push(`page is ${document.documentElement.scrollWidth} wide`);
  for (const el of document.querySelectorAll('button, #map, #found, .stat, #say, #speed')) { if (!el.getClientRects().length || el.id === 'file') continue; const r = el.getBoundingClientRect(), name = el.id || el.className; if (r.left < -1 || r.right > vw + 1) out.push(`${name} off the side (${Math.round(r.left)}..${Math.round(r.right)})`);
    if (el.tagName === 'BUTTON') { if (r.width < 24 || r.height < 24) out.push(`${name} is ${Math.round(r.width)}x${Math.round(r.height)}`); const card = el.closest('.card'); if (!card && (r.top < -1 || r.bottom > vh + 1)) out.push(`${name} off the screen vertically`); } }
  const boxes = ['#status', '#tools', '#say', '#speed', '.pads.left', '.pads.right'].map(q => [q, document.querySelector(q)]).filter(([, el]) => el && el.getClientRects().length && el.getBoundingClientRect().width > 0).map(([q, el]) => [q, el.getBoundingClientRect()]);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const [qa, a] = boxes[i], [qb, b] = boxes[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${qa} overlaps ${qb}`); }
  return out; }); assert.deepEqual(bad, [], `${label}: ${bad.join('; ')}`); };
const visible = (p, sel) => p.evaluate(s => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0; }, sel);
const said = p => p.evaluate(() => document.getElementById('say').textContent);

// ---- 1. The sample photograph: what was found, and the circuit made from it --------------------
{ const p = await open(1280, 800); const s = await state(p);
  assert.equal(s.mode, 'menu'); assert.equal(s.photoKey, 'caps'); assert.equal(s.method, 'colour');
  const want = [[0.251, 0.375], [0.502, 0.502], [0.666, 0.584], [0.781, 0.635], [0.871, 0.733]]; // the five caps, measured on the photograph
  assert.equal(s.blobs.length, 5, 'five objects'); for (const [x, y] of want) assert.ok(s.blobs.some(b => Math.abs(b.x - x) < 0.03 && Math.abs(b.y - y) < 0.03), `no object found near ${x}, ${y}`);
  assert.equal(s.hazards.length + s.flat, 5); assert.ok(s.hazards.length >= 4, `only ${s.hazards.length} of the five caps stand up`); for (const h of s.hazards) assert.ok(s.blobs.some(b => Math.abs(b.x - h.photo[0]) < 1e-6 && Math.abs(b.y - h.photo[1]) < 1e-6), 'a hazard does not stand where its object is in the photograph');
  assert.ok(s.pickups >= 5 && s.length > 150);
  assert.equal(await p.locator('#objects li').count(), 5); assert.match(await p.textContent('#credit'), /Kodak/);
  assert.ok(await visible(p, '#start')); for (const id of ['#status', '#tools', '#speed', '#finish', '#sample']) assert.ok(!(await visible(p, id)), `${id} shows on the start screen`);
  // As the page loads it leaves the focus alone, and the first three presses of Tab each land on something you can see (the repo's own rule).
  { const q = await open(1280, 800); for (const want of ['go', 'own', '']) { await q.keyboard.press('Tab'); const f = await q.evaluate(() => { const n = document.activeElement, r = n.getBoundingClientRect(); return { tag: n.tagName, id: n.id, ok: r.width > 0 && r.height > 0 }; }); assert.ok(f.ok && f.tag !== 'BODY' && f.id === want, `Tab reached ${f.tag} ${f.id}`); } await q.context().close(); }
  const px = await p.evaluate(() => { const c = document.getElementById('found'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4000) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; return lit; }); assert.ok(px > 100, 'the photograph is drawn on the start card');
  await axe(p, 'start'); await layout(p, 'start 1280');
  done.push('sample photo: five objects found where they are, hazards stand on them');

  // ---- 2. A race by keyboard ---------------------------------------------------------------------
  await p.keyboard.press('Enter'); let r = await state(p); assert.equal(r.mode, 'race'); assert.equal(r.go, false); assert.ok(await visible(p, '#status') && await visible(p, '#tools') && !(await visible(p, '#start')));
  await p.keyboard.down('ArrowUp'); await p.evaluate(S(s => s.fast(120))); r = await state(p); assert.equal(r.go, false, 'no moving before the countdown ends'); assert.equal(r.v, 0);
  await p.evaluate(S(s => s.fast(120))); r = await state(p); assert.ok(r.go && r.v > 10, `the up arrow drives the kart (v ${r.v})`);
  await p.keyboard.up('ArrowUp'); await axe(p, 'race'); await layout(p, 'race 1280');
  // Pause really stops the clock.
  await p.keyboard.press('p'); const t0 = (await state(p)).t; await p.waitForTimeout(400); r = await state(p); assert.ok(r.paused && r.t === t0, 'pause stops the race'); assert.equal(await p.getAttribute('#pause', 'aria-pressed'), 'true'); await p.keyboard.press('p'); assert.equal((await state(p)).paused, false);
  await p.waitForTimeout(500); assert.ok((await state(p)).t > t0, 'the race runs on real frames');
  // Head-on into an object: the kart stops at it and the page says so.
  const hit = await p.evaluate(S(s => { const st = s.state(), hz = st.hazards[1]; s.place(hz.x - hz.r - 12, hz.z, 0, 20); return hz; }));
  await p.keyboard.down('ArrowUp'); let slowest = 99, closest = 99; for (let i = 0; i < 50; i++) { await p.evaluate(S(s => s.fast(1))); const q = await p.evaluate(S(s => s.kart())); slowest = Math.min(slowest, q.v); closest = Math.min(closest, Math.hypot(q.x - hit.x, q.z - hit.z)); } await p.keyboard.up('ArrowUp');
  assert.match(await said(p), /Hit the .+ object/); assert.ok(closest >= hit.r + 1.3 - 0.01, 'the object is solid'); assert.ok(slowest < 10, `a square hit takes your speed away (slowest ${slowest.toFixed(1)})`);
  await p.keyboard.press('r'); await p.evaluate(S(s => s.fast(1))); const k2 = await p.evaluate(S(s => s.kart())); // R is carried out by the next step of the race assert.ok(k2.offCentre < 0.01, 'R puts the kart back on the road'); assert.match(await said(p), /Back on the road/);
  await p.keyboard.press('c'); assert.equal((await state(p)).topView, true); assert.equal(await p.getAttribute('#cam', 'aria-pressed'), 'true'); await p.keyboard.press('c');
  await p.keyboard.press('m'); assert.equal((await state(p)).soundOn, false); assert.equal(await p.getAttribute('#sound', 'aria-pressed'), 'false');
  // Shortcuts still work after a button has been clicked with the mouse, and looking away pauses the race.
  await p.click('#cam'); assert.equal((await state(p)).topView, true); await p.keyboard.press('c'); assert.equal((await state(p)).topView, false, 'C works after clicking a button');
  await p.click('#pause'); assert.equal((await state(p)).paused, true); assert.equal(await said(p), 'Paused'); await p.keyboard.press('p'); assert.equal((await state(p)).paused, false, 'P works after clicking Pause');
  await p.evaluate(() => window.dispatchEvent(new Event('blur'))); assert.equal((await state(p)).paused, true, 'looking away pauses the race'); await p.keyboard.press('Escape'); assert.equal((await state(p)).paused, false);
  await p.click('#quit'); assert.equal((await state(p)).mode, 'menu', 'Leave race goes back to the photograph'); assert.ok(await visible(p, '#start')); await p.click('#go'); await p.evaluate(S(s => s.fast(200)));
  done.push('keyboard: start, countdown, drive, pause, hit an object, back on road, view, sound; shortcuts after a click; looking away pauses; Leave race');

  // ---- 3. The whole race: the autopilot drives three laps ------------------------------------------
  await p.evaluate(S(s => { s.autopilot(true); s.fast(60 * 240); })); r = await state(p);
  assert.equal(r.mode, 'done'); assert.ok(await visible(p, '#finish') && !(await visible(p, '#status'))); assert.match(await p.textContent('#finish-h'), /^You finished (1st|2nd|3rd)$/);
  for (const id of ['#r-time', '#r-lap', '#r-best']) assert.match(await p.textContent(id), /^\d:\d\d\.\d$/, id); assert.equal(await p.evaluate(() => document.activeElement.id), 'again');
  assert.equal(await p.evaluate(() => Number(localStorage.getItem('snapshot-circuit:best')) > 20), true, 'the record is kept');
  await axe(p, 'finish'); await layout(p, 'finish 1280');
  // Race again, pressing R every second and a half: the race still finishes, and the result card opens exactly once.
  await p.evaluate(() => { window.__shown = 0; new MutationObserver(() => { if (!document.getElementById('finish').hidden) window.__shown++; }).observe(document.getElementById('finish'), { attributes: true, attributeFilter: ['hidden'] }); });
  await p.click('#again'); assert.equal((await state(p)).mode, 'race'); await p.evaluate(S(s => s.fast(200)));
  for (let i = 0; i < 400 && (await state(p)).mode === 'race'; i++) { await p.keyboard.press('r'); await p.evaluate(S(s => s.fast(90))); }
  assert.equal((await state(p)).mode, 'done', 'a second race, with R pressed all the way round, also finishes'); assert.equal(await p.evaluate(() => window.__shown), 1, 'the result card opened more or less than once');
  // Holding R (400 presses, no accelerator) earns no lap and opens no result card.
  await p.click('#again'); await p.evaluate(S(s => { s.autopilot(false); s.fast(200); })); for (let i = 0; i < 400; i++) { await p.keyboard.press('r'); await p.evaluate(S(s => s.fast(1))); }
  r = await state(p); assert.ok(r.mode === 'race' && r.lap === 0 && !r.done[0], `holding R earned progress: lap ${r.lap}, mode ${r.mode}`); assert.match(await said(p), /Back on the road/);
  await p.evaluate(S(s => { s.autopilot(true); s.fast(60 * 240); })); assert.equal((await state(p)).mode, 'done'); assert.equal(await p.evaluate(() => window.__shown), 2);
  await p.click('#menu'); assert.equal((await state(p)).mode, 'menu'); assert.ok(await visible(p, '#start')); assert.equal(await p.evaluate(() => document.activeElement.id), 'go', 'back at the start card, Start has the focus');
  await p.reload(); await p.evaluate(() => window.snapshotCircuit.ready); assert.equal((await state(p)).soundOn, false, 'the sound choice survives a refresh');
  done.push('a full three-lap race finishes, three times, once with R pressed all the way round; the result card opens once a race; holding R earns no lap');

  // ---- 4. Your own photograph -------------------------------------------------------------------
  const png = Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#8a8f96'; g.fillRect(0, 0, 900, 600);
    for (const [x, y, r, col] of [[250, 220, 70, '#e02020'], [600, 380, 90, '#2050e0'], [450, 130, 30, '#f0d000']]) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } return c.toDataURL('image/png'); })).split(',')[1], 'base64');
  const before = requests.length;
  await p.setInputFiles('#file', { name: 'mine.png', mimeType: 'image/png', buffer: png }); await p.waitForFunction(() => window.snapshotCircuit.state().photoKey === 'own');
  let o = await state(p); assert.equal(o.mode, 'menu'); for (const [x, y, name] of [[250 / 900, 220 / 600, 'red'], [600 / 900, 380 / 600, 'blue'], [450 / 900, 130 / 600, 'yellow']]) assert.ok(o.blobs.some(b => b.name === name && Math.abs(b.x - x) < 0.03 && Math.abs(b.y - y) < 0.03), `own photo: no ${name} object where it was drawn (${JSON.stringify(o.blobs)})`);
  assert.match(await p.textContent('#credit'), /stays on this device/); assert.ok(await visible(p, '#sample'));
  assert.equal(requests.slice(before).filter(u => !u.startsWith('blob:') && !u.startsWith('data:')).length, 0, 'using your own photo sends nothing anywhere');
  await p.click('#go'); await p.evaluate(S(s => { s.autopilot(true); s.fast(60 * 240); })); o = await state(p); assert.equal(o.mode, 'done', 'a race on your own photo finishes'); assert.equal(await p.textContent('#r-best'), 'Not kept');
  await p.click('#menu');
  await p.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') }); await p.waitForFunction(() => /could not be read/.test(document.getElementById('say').textContent));
  assert.equal((await state(p)).photoKey, 'own', 'a bad file changes nothing'); assert.ok(await p.evaluate(() => { const say = document.getElementById('say'), r = say.getBoundingClientRect(), z = el => Number(getComputedStyle(el).zIndex) || 0; return r.width > 40 && r.top >= 0 && z(say) > z(document.getElementById('start')); }), 'the message sits over the start card');
  await p.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/smoke-badfile.png' : undefined });
  await p.click('#sample'); await p.waitForFunction(() => window.snapshotCircuit.state().photoKey === 'caps'); assert.equal((await state(p)).blobs.length, 5); assert.ok(!(await visible(p, '#sample')));
  // A picture with nothing in it still gives a circuit.
  await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 640; const g = c.getContext('2d'); g.fillStyle = '#777'; g.fillRect(0, 0, 640, 640); await window.snapshotCircuit.usePhoto(c, 'own'); });
  o = await state(p); assert.ok(o.length > 150 && o.pickups >= 5, 'a blank picture still gives a circuit'); assert.equal(o.blobs.length, 0, 'a blank picture claims no objects'); assert.match(await p.textContent('#objects'), /Nothing stood out/); await p.click('#go'); await p.evaluate(S(s => { s.autopilot(true); s.fast(60 * 240); })); assert.equal((await state(p)).mode, 'done');
  // Very wide and very tall pictures: the middle is used, the page says so, nothing is logged, and the race can be finished.
  for (const [w, h, word] of [[4000, 300, 'wide'], [300, 4000, 'tall'], [2000, 400, 'wide']]) { await p.click('#menu');
    const buf = Buffer.from((await p.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#909498'; g.fillRect(0, 0, w, h); for (let i = 0; i < 9; i++) { g.fillStyle = ['#e02020', '#2050e0', '#f0d000'][i % 3]; g.beginPath(); g.arc(w * (0.1 + 0.1 * i), h * (0.2 + 0.07 * i), Math.min(w, h) * 0.12, 0, 7); g.fill(); } return c.toDataURL('image/png'); }, [w, h])).split(',')[1], 'base64');
    await p.evaluate(() => window.snapshotCircuit.usePhoto(document.createElement('canvas'), 'x').catch(() => {})); await p.setInputFiles('#file', { name: 'shape.png', mimeType: 'image/png', buffer: buf }); await p.waitForFunction(word => window.snapshotCircuit.state().cropped === word, word);
    o = await state(p); const shape = o.size[0] / o.size[1]; assert.ok(shape <= 2.01 && shape >= 0.59, `${w}x${h} became ${o.size}`); assert.match(await p.textContent('#credit'), new RegExp(`very ${word}`));
    await p.click('#go'); await p.evaluate(S(s => { s.autopilot(true); s.fast(60 * 300); })); assert.equal((await state(p)).mode, 'done', `the race on a ${w}x${h} picture finishes`); }
  done.push('own photo: objects found, raced to the finish, nothing sent, bad file refused, blank picture handled; 4000x300, 300x4000 and 2000x400 pictures cut to their middle and raced');
  await p.context().close(); }

// ---- 4b. Loading: Start waits for a circuit; a sample that fails to load says so and offers another go or your own photo; photo swaps free the graphics memory ----
{ const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(String(e)));
  let release; const held = new Promise(r => { release = r; }); await p.route(/caps\.jpg$/, async r => { await held; await r.continue(); });
  await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.snapshotCircuit); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => document.getElementById('go').disabled), true, 'Start can be pressed before there is a circuit'); assert.match(await p.textContent('#credit'), /Reading the sample/);
  await p.click('#go', { force: true }); await p.keyboard.press('Enter'); assert.ok(await visible(p, '#start') && !(await visible(p, '#status')), 'an early Start began a race');
  release(); assert.equal(await p.evaluate(() => window.snapshotCircuit.ready), true); assert.equal(await p.evaluate(() => document.getElementById('go').disabled), false, 'Start stays off once the circuit is ready');
  await p.click('#go'); await p.evaluate(S(s => s.fast(300))); assert.ok((await state(p)).go); await ctx.close(); assert.deepEqual(errors, [], 'errors while the sample was slow: ' + errors.join('; ')); }
{ const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(String(e)));
  let fail = true; await p.route(/caps\.jpg$/, r => (fail ? r.abort() : r.continue()));
  await p.goto(url); assert.equal(await p.evaluate(() => window.snapshotCircuit.ready), false);
  assert.match(await p.textContent('#credit'), /could not be loaded\. Try again, or use your own photo/); assert.ok(await visible(p, '#sample')); assert.equal(await p.textContent('#sample'), 'Try the sample again');
  assert.equal(await p.evaluate(() => document.getElementById('go').disabled), true); await p.keyboard.press('Enter'); assert.ok(await visible(p, '#start'), 'Enter started a race with no circuit');
  fail = false; await p.click('#sample'); await p.waitForFunction(() => !document.getElementById('go').disabled); const s = await state(p); assert.equal(s.photoKey, 'caps'); assert.equal(s.blobs.length, 5); assert.ok(!(await visible(p, '#sample')));
  await p.click('#go'); await p.evaluate(S(s => { s.autopilot(true); s.fast(60 * 240); })); assert.equal((await state(p)).mode, 'done', 'after a failed sample, a retry gives a race that finishes');
  await ctx.close(); assert.deepEqual(errors, [], 'errors after the sample failed: ' + errors.join('; ')); }
{ const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(String(e)));
  await p.goto(url); await p.evaluate(() => window.snapshotCircuit.ready);
  const swap = k => p.evaluate(async k => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 900, 600); g.fillStyle = ['#e02020', '#2050e0'][k % 2]; g.beginPath(); g.arc(300 + k * 10, 250, 80, 0, 7); g.fill();
    await window.snapshotCircuit.usePhoto(c, 'own'); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return window.snapshotCircuit.gpu(); }, k);
  const first = await swap(0); let last = first; for (let k = 1; k <= 20; k++) last = await swap(k);
  assert.deepEqual(last, first, `after 20 more photo swaps the graphics memory grew from ${JSON.stringify(first)} to ${JSON.stringify(last)}`); await ctx.close(); assert.deepEqual(errors, []); }
done.push('loading: Start is off until there is a circuit; a failed sample says so and can be tried again; 20 photo swaps leave the graphics memory where it was');

// ---- 5. Reduced motion: the steady view from above ----------------------------------------------
{ const p = await open(1280, 800, { reduced: true }); assert.equal((await state(p)).topView, true); assert.equal(await p.getAttribute('#cam', 'aria-pressed'), 'true'); await p.context().close(); done.push('reduced motion starts in the view from above'); }

// ---- 6. Phones: touch controls and layout ----------------------------------------------------------
for (const [w, h] of [[400, 800], [320, 568], [740, 360]]) { const p = await open(w, h, { touch: true });
  assert.ok(await p.evaluate(() => document.documentElement.classList.contains('touch'))); await layout(p, `start ${w}x${h}`);
  const go = await p.evaluate(() => { const r = document.getElementById('go').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }); assert.ok(go, `${w}x${h}: Start is on the screen without scrolling`);
  await axe(p, `start ${w}x${h}`);
  await p.tap('#go'); assert.equal((await state(p)).mode, 'race'); await p.evaluate(S(s => s.fast(200))); for (const id of ['#pad-left', '#pad-right', '#pad-brake']) assert.ok(await visible(p, id), `${id} missing`);
  await layout(p, `race ${w}x${h}`); await axe(p, `race ${w}x${h}`);
  await p.evaluate(S(s => s.fast(90))); const a = await p.evaluate(S(s => s.kart())); assert.ok(a.v > 10, 'on a phone the kart drives itself forward');
  await p.dispatchEvent('#pad-left', 'pointerdown', { pointerId: 7, isPrimary: true }); assert.ok(await p.evaluate(() => document.getElementById('pad-left').classList.contains('down'))); await p.evaluate(S(s => s.fast(30))); await p.dispatchEvent('#pad-left', 'pointerup', { pointerId: 7 });
  const b = await p.evaluate(S(s => s.kart())); const turn = Math.atan2(Math.sin(b.h - a.h), Math.cos(b.h - a.h)); assert.ok(turn < -0.3, `the left pad steers left (turned ${turn.toFixed(2)})`); assert.ok(!(await p.evaluate(() => document.getElementById('pad-left').classList.contains('down'))));
  await p.dispatchEvent('#pad-brake', 'pointerdown', { pointerId: 8 }); await p.evaluate(S(s => s.fast(60))); await p.dispatchEvent('#pad-brake', 'pointerup', { pointerId: 8 }); assert.ok((await p.evaluate(S(s => s.kart()))).v < 3, 'the brake pad brakes');
  await p.tap('#rescue'); await p.evaluate(S(s => { s.autopilot(true); s.fast(60 * 240); })); assert.equal((await state(p)).mode, 'done'); await layout(p, `finish ${w}x${h}`); await axe(p, `finish ${w}x${h}`);
  await p.context().close(); }
done.push('phones 400x800, 320x568, 740x360: start in reach, pads steer and brake, race finishes, nothing off screen');

await browser.close();
const outside = requests.filter(u => !u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:'));
assert.deepEqual(outside, [], 'requests left the page: ' + outside.join(', '));
assert.deepEqual(problems, [], 'console problems:\n' + problems.join('\n'));
console.log('ok  ' + done.join('\nok  ') + '\nok  axe WCAG 2.2 A and AA clean on start, race and finish at four sizes; no console errors; no request left the page');
