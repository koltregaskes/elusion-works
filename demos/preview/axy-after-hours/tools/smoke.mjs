// End-to-end check in a real browser, in both versions: HTML-in-Canvas switched on, and plain HTML.
// Needs a static server serving the repo root.
// Run: node demos/axy-after-hours/tools/smoke.mjs <path-to-axe.min.js> [base URL, default http://127.0.0.1:8765]
// The axe file is required: without it the run stops, so a pass always includes the accessibility check.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
const { chromium } = createRequire(import.meta.url)('playwright');
if (!process.argv[2]) { console.error('Usage: node smoke.mjs <path-to-axe.min.js> [base URL]. The axe file is required.'); process.exit(2); }
const URL = (process.argv[3] || 'http://127.0.0.1:8765').replace(/\/$/, '') + '/demos/axy-after-hours/', axe = readFileSync(process.argv[2], 'utf8');
const base = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], errors = [];
const log = (...a) => console.log('ok ', ...a);
async function open(canvasOn, opts = {}, path = '', init, before, allow) {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: canvasOn ? [...base, '--enable-features=CanvasDrawElement'] : base });
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 }, ...opts });
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !(allow && allow.test(m.text()))) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => errors.push('[requestfailed] ' + r.url()));
  if (init) await page.addInitScript(init);
  if (before) await before(page);
  await page.goto(URL + path, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__afterHours && window.__afterHours.framesReady >= 8, null, { timeout: 60000 });
  return { browser, page };
}
const A = (page, fn, arg) => page.evaluate(fn, arg);
const modes = page => A(page, () => { const m = {}; window.__afterHours.bodies().forEach(b => { m[b.mode] = (m[b.mode] || 0) + 1; }); return m; });
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 });

for (const canvasOn of [true, false]) {
  const name = canvasOn ? 'HTML-in-Canvas' : 'plain HTML';
  const { browser, page } = await open(canvasOn);
  const info = await A(page, () => ({ tier: window.__afterHours.tier, inCanvas: !!document.getElementById('glass') && document.getElementById('glass').contains(document.getElementById('page')), status: document.getElementById('tier').textContent }));
  assert.equal(info.tier, canvasOn ? 'canvas' : 'html'); assert.equal(info.inCanvas, canvasOn);
  if (canvasOn) { await until(page, () => window.__afterHours.painted); assert.match(info.status, /HTML-in-Canvas: on/); } else assert.match(info.status, /Plain HTML version/);
  // Everything is real HTML: a heading, links with real addresses, a slider.
  const real = await A(page, () => ({ h1: document.querySelector('h1').getAttribute('aria-label'), cta: document.querySelector('.btn').href, range: document.getElementById('mass').type, links: document.querySelectorAll('#page a[href]').length }));
  assert.equal(real.h1, 'Axy Lusion'); assert.match(real.cta, /^https:\/\/axylusion\.com\//); assert.equal(real.range, 'range'); assert.ok(real.links >= 12);
  // Feed the well: pieces fall in. Focus brings one back. Restore brings all back.
  await page.click('#feed'); await until(page, () => window.__afterHours.bodies().filter(b => b.mode === 'gone').length >= 6);
  await until(page, () => window.__afterHours.bodies().find(b => b.text.startsWith('Enter the')).mode === 'gone');
  await A(page, () => document.querySelector('.btn').focus());
  await until(page, () => { const b = window.__afterHours.bodies().find(x => x.text.startsWith('Enter the')); return b.mode === 'home' && b.a === 1; });
  assert.equal(await A(page, () => document.activeElement.textContent), 'Enter the gallery');
  await page.click('#restore'); await until(page, () => window.__afterHours.bodies().every(b => b.mode === 'home' && b.a === 1));
  log(`${name}: page falls into the well, focus pulls a link back out, restore returns everything`);
  // The well: slider by keyboard, arrow keys on its handle, and a pointer drag on empty page.
  await page.focus('#mass'); const m0 = await A(page, () => window.__afterHours.well.mass); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.ok(await A(page, () => window.__afterHours.well.mass) > m0);
  await page.focus('#wellkey'); const x0 = await A(page, () => window.__afterHours.well.tx); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+ArrowUp');
  const w1 = await A(page, () => ({ x: window.__afterHours.well.tx, y: window.__afterHours.well.ty })); assert.equal(Math.round(w1.x), Math.round(x0 - 24));
  await page.mouse.move(1150, 150); await page.mouse.down(); await page.mouse.move(1100, 200, { steps: 4 }); await page.mouse.up();
  assert.equal(await A(page, () => Math.round(window.__afterHours.well.tx)), 1100);
  // Rooms: a real mouse click on a real link, then the lamps by keyboard, panel and drag.
  const lk = await A(page, () => { const r = document.querySelector('.rooms a[data-room="lamplight"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.click(lk[0], lk[1]); assert.equal(await A(page, () => window.__afterHours.room), 'lamplight'); assert.equal(await A(page, () => location.hash), '#lamplight');
  const lamp = page.locator('.lamp').first(); await lamp.focus(); const l0 = await A(page, () => ({ ...window.__afterHours.lamps[2] }));
  const which = await A(page, () => [...document.querySelectorAll('.lamp')].indexOf(document.activeElement)); // lamps are inserted in reverse order
  const idx = await A(page, () => Number(document.getElementById('lamp-name').textContent.replace('Lamp ', '')) - 1);
  const before = await A(page, i => ({ ...window.__afterHours.lamps[i] }), idx);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const after = await A(page, i => ({ ...window.__afterHours.lamps[i] }), idx);
  assert.ok(after.x > before.x && after.y > before.y && after.on === false, 'lamp keyboard control'); assert.equal(await A(page, () => document.activeElement.getAttribute('aria-pressed')), 'false');
  await page.keyboard.press('Enter'); await page.focus('#lamp-bright'); await page.keyboard.press('Home'); assert.ok(await A(page, i => window.__afterHours.lamps[i].b, idx) <= 0.11);
  const box = await page.locator('.lamp.sel').boundingBox(); await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down(); await page.mouse.move(640, 300, { steps: 4 }); await page.mouse.up();
  assert.ok(Math.abs(await A(page, i => window.__afterHours.lamps[i].x, idx) - 0.5) < 0.01);
  await page.click('#about-open'); assert.equal(await A(page, () => document.getElementById('about').open), true); await page.keyboard.press('Escape');
  void l0; void which;
  log(`${name}: slider, well handle, drag, room links, lamps by keyboard, panel and drag, about dialog`);
  {
    await page.addScriptTag({ content: axe });
    for (const room of ['lamplight', 'undertow']) {
      await A(page, r => window.__afterHours.setRoom(r), room); await page.waitForTimeout(300);
      const res = await A(page, () => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }));
      assert.deepEqual(res.violations.map(v => `${v.id}: ${v.nodes[0].target.join(' ')}`), [], 'axe violations in ' + room);
    }
    log(`${name}: axe WCAG 2.2 A/AA, 0 violations in both rooms`);
  }
  await browser.close();
}
// Phone, 400 px wide with touch, both versions: nothing overflows, targets are finger-sized, taps work.
for (const canvasOn of [true, false]) {
  const { browser, page } = await open(canvasOn, { viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
  const o = await A(page, () => ({ sw: document.documentElement.scrollWidth, w: innerWidth, smallTargets: [...document.querySelectorAll('a[href],button,input')].filter(e => e.getClientRects().length && !e.closest('[hidden]') && !e.classList.contains('skip')).map(e => [e.textContent.trim().slice(0, 14) || e.id, Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 24) }));
  assert.ok(o.sw <= o.w, 'sideways overflow'); assert.deepEqual(o.smallTargets, [], 'targets under 24 px');
  await page.tap('#feed'); await until(page, () => window.__afterHours.bodies().some(b => b.mode === 'gone')); await page.tap('#restore');
  await page.tap('.rooms a[data-room="lamplight"]'); assert.equal(await A(page, () => window.__afterHours.room), 'lamplight');
  assert.equal(await A(page, () => document.querySelector('.top').getBoundingClientRect().top), 0, 'header scrolled away');
  log(`phone 400x800 (${canvasOn ? 'HTML-in-Canvas' : 'plain HTML'}): no sideways overflow, targets 24 px or taller, taps work, header stays put`);
  await browser.close();
}
// Reduced motion: nothing travels. Pieces simply go and come back.
{
  const { browser, page } = await open(true, { reducedMotion: 'reduce' });
  await page.click('#feed');
  const s = await A(page, () => ({ gone: window.__afterHours.bodies().filter(b => b.mode === 'gone').length, moved: [...document.querySelectorAll('#undertow .fall')].filter(e => e.style.transform).length }));
  assert.ok(s.gone > 0); assert.equal(s.moved, 0); await page.click('#restore'); assert.equal((await modes(page)).gone || 0, 0);
  log('reduced motion: no travelling pieces');
  await browser.close();
}
// The fallback is real: if the canvas call fails, or ?plain is asked for, the page is handed back as ordinary HTML.
{
  const a = await open(true, {}, '', () => { const P = WebGL2RenderingContext.prototype; for (const k of ['texElementImage2D', 'texElementSubImage2D']) if (P[k]) P[k] = () => { throw new Error('simulated failure'); }; });
  await until(a.page, () => window.__afterHours.tier === 'html');
  assert.equal(await A(a.page, () => document.getElementById('stage').contains(document.getElementById('page')) && !document.getElementById('glass')), true);
  assert.match(await A(a.page, () => document.getElementById('tier').textContent), /Plain HTML version/);
  await a.page.click('#feed'); await until(a.page, () => window.__afterHours.bodies().some(b => b.mode === 'gone')); await a.browser.close();
  const b = await open(true, {}, '?plain'); assert.equal(await A(b.page, () => window.__afterHours.tier), 'html'); await b.browser.close();
  log('fallback: a failing canvas call, or ?plain, gives the ordinary HTML page');
}
// Short and narrow screens, both versions: the controls, the wall and the credit are always there to use.
for (const canvasOn of [true, false]) for (const [w, h] of [[740, 360], [320, 480], [390, 664], [360, 640], [640, 400]]) { // 640x400 is a 1280x800 screen at 200% zoom
  const { browser, page } = await open(canvasOn, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  const u = await A(page, () => { const inView = el => { const r = el.getBoundingClientRect(), f = document.querySelector('.foot').getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= f.top + 0.5; };
    return { controls: ['mass', 'feed', 'restore', 'wellkey'].filter(id => !inView(document.getElementById(id))), cta: [...document.querySelectorAll('.btn')].filter(e => !inView(e)).length, h1: inView(document.querySelector('h1')), pills: [...document.querySelectorAll('.rooms a')].filter(e => !inView(e)).length, sl: document.getElementById('page').scrollLeft }; });
  assert.deepEqual(u, { controls: [], cta: 0, h1: true, pills: 0, sl: 0 }, `Undertow at ${w}x${h}`);
  await A(page, () => window.__afterHours.setRoom('lamplight')); await page.waitForTimeout(250);
  const l = await A(page, () => { const hit = el => { const r = el.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e === el || el.contains(e); }, panel = document.querySelector('.lamp-panel').getBoundingClientRect();
    return { wall: Math.round(document.getElementById('wall').getBoundingClientRect().height), frames: [...document.querySelectorAll('.wall li')].filter(e => e.getClientRects().length && e.getBoundingClientRect().height > 50).length, credit: hit(document.querySelector('.foot a')), about: hit(document.getElementById('about-open')),
      lampsUnderPanel: [...document.querySelectorAll('.lamp')].filter(b => { const r = b.getBoundingClientRect(), x = r.left + 22, y = r.top + 22; return x > panel.left && x < panel.right && y > panel.top && y < panel.bottom; }).length, lampsHit: [...document.querySelectorAll('.lamp')].filter(b => !hit(b)).length }; });
  assert.ok(l.wall >= 80 && l.frames >= 2, `Lamplight wall at ${w}x${h}: ${JSON.stringify(l)}`); assert.deepEqual([l.credit, l.about, l.lampsUnderPanel, l.lampsHit], [true, true, 0, 0], `Lamplight at ${w}x${h}: ${JSON.stringify(l)}`);
  await browser.close();
}
log('short and narrow screens (740x360, 320x480, 390x664, 360x640, and 640x400 for 200% zoom), both versions: controls, links, wall, lamps and credit all reachable');
// Keyboard: Tabbing through a fed page never scrolls it; lamps come in order; a failure mid-session keeps focus.
{
  const { browser, page } = await open(true);
  await A(page, () => { window.__afterHours.setWell(900, 600); window.__afterHours.setFeeding(true); }); await until(page, () => window.__afterHours.bodies().filter(b => b.mode === 'gone').length >= 10);
  for (let i = 0; i < 26; i++) await page.keyboard.press('Tab');
  assert.deepEqual(await A(page, () => [document.getElementById('room').scrollTop, document.getElementById('page').scrollTop, document.querySelector('.hero').scrollTop, scrollY]), [0, 0, 0, 0], 'focus scrolled the page');
  await A(page, () => window.__afterHours.restore());
  // Mass at zero: nothing hangs in mid-air.
  await A(page, () => window.__afterHours.setFeeding(true)); await until(page, () => window.__afterHours.bodies().some(b => b.mode === 'falling'));
  await A(page, () => { window.__afterHours.setFeeding(false); const m = document.getElementById('mass'); m.value = 0; m.dispatchEvent(new Event('input', { bubbles: true })); });
  await until(page, () => window.__afterHours.bodies().every(b => b.mode !== 'falling'));
  await A(page, () => window.__afterHours.setRoom('lamplight')); await page.focus('#about-open'); await page.keyboard.press('Shift+Tab'); // back from the footer into the lamps
  const order = await A(page, () => [...document.querySelectorAll('.lamp')].map(b => b.getAttribute('aria-label').slice(0, 6))); assert.deepEqual(order, ['Lamp 1', 'Lamp 2', 'Lamp 3']);
  await page.focus('.wall a'); await A(page, () => document.getElementById('glass').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  const after = await A(page, () => ({ tier: window.__afterHours.tier, focus: document.activeElement.className + document.activeElement.tagName, status: document.getElementById('tier').textContent }));
  assert.equal(after.tier, 'html'); assert.equal(after.focus, 'A'); assert.match(after.status, /stopped working/);
  log('keyboard: no scroll from focus, nothing hangs at zero mass, lamps in order, focus survives a lost graphics context');
  await browser.close();
}
// A failure long after the first paint still hands the page back.
{
  const a = await open(true, {}, '', () => { const P = WebGL2RenderingContext.prototype, real = P.texElementImage2D; let n = 0; if (real) P.texElementImage2D = function (...args) { if (++n > 20) throw new Error('simulated late failure'); return real.apply(this, args); }; });
  await until(a.page, () => window.__afterHours.tier === 'html'); assert.match(await A(a.page, () => document.getElementById('tier').textContent), /stopped working/);
  await a.browser.close();
  // Reduced motion: focusing a piece that has gone brings it straight back.
  const b = await open(false, { reducedMotion: 'reduce' }); await b.page.click('#feed'); await A(b.page, () => document.querySelector('.btn.ghost').focus()); await b.page.waitForTimeout(300);
  assert.equal(await A(b.page, () => getComputedStyle(document.querySelector('.btn.ghost')).opacity), '1'); await b.browser.close();
  log('late canvas failure hands the page back; reduced-motion focus brings a piece back');
}
// ---- Checks added after the outside review of 17 Nov 2026 ----
// Pixels of a screenshot, read inside the page, so no image library is needed.
const pixels = (page, buf) => A(page, async u => { const im = new Image(); im.src = u; await im.decode(); const c = new OffscreenCanvas(im.width, im.height), g = c.getContext('2d'); g.drawImage(im, 0, 0); return [...g.getImageData(0, 0, im.width, im.height).data]; }, 'data:image/png;base64,' + buf.toString('base64'));
const rectOf = (page, sel) => A(page, s => { const r = document.querySelector(s).getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; }, sel);
async function settle(page, sel) { // until the element is in place (not falling, fully shown) and has not moved for two seconds
  let last = null;
  for (let i = 0; i < 40; i++) {
    const r = JSON.stringify([Object.values(await rectOf(page, sel)).map(v => Math.round(v)), await A(page, s => { const f = document.querySelector(s).closest('.fall'); return f.style.pointerEvents + '|' + f.style.opacity; }, sel)]);
    if (r === last && r.endsWith('"|"]')) return; last = r; await page.waitForTimeout(2000);
  }
  throw new Error(sel + ' never settled');
}
// Where is this link actually drawn? Paint it green, then blue, then green again, and keep the pixels that went green, blue,
// green. The well's glow adds at most about 21 to blue, and anything else that moves between pictures (falling letters with
// colour fringes) does not come back to the same colour, so only the link's own pixels pass.
async function drawnBox(page, sel) {
  const paintAs = async c => { await A(page, ([s, c]) => { let st = document.getElementById('marker'); if (!st) { st = document.createElement('style'); st.id = 'marker'; document.head.appendChild(st); } st.textContent = `${s}{background:${c}!important;color:${c}!important;border-color:${c}!important;text-shadow:none!important;outline:none!important} ${s} img{visibility:hidden!important}`; }, [sel, c]); await page.waitForTimeout(300); return page.screenshot(); };
  const a = await pixels(page, await paintAs('#00ff00')), b = await pixels(page, await paintAs('#0000ff')), a2 = await pixels(page, await paintAs('#00ff00')), w = page.viewportSize().width;
  await A(page, () => document.getElementById('marker').remove());
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i + 1] - b[i + 1] > 150 && b[i + 2] - a[i + 2] > 150 && Math.abs(a[i] - a2[i]) + Math.abs(a[i + 1] - a2[i + 1]) + Math.abs(a[i + 2] - a2[i + 2]) < 30) { const x = (i / 4) % w, y = Math.floor(i / 4 / w); n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  return { n, x0, y0, x1, y1 };
}
// HTML-in-Canvas, the well close and at full mass: each link is drawn exactly where its click target is, and a click or tap
// at the drawn centre opens that link. Expected value: the link's own box from the browser's layout, not anything the shader reports.
for (const [label, opts, input] of [['mouse 1280x800', {}, 'mouse'], ['touch 400x800', { viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true }, 'touch']]) {
  const { browser, page } = await open(true, opts);
  await until(page, () => window.__afterHours.painted);
  await A(page, () => { const m = document.getElementById('mass'); m.value = 100; m.dispatchEvent(new Event('input', { bubbles: true })); window.__clicked = []; document.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { e.preventDefault(); window.__clicked.push(a.getAttribute('aria-label') || a.textContent.trim()); } }, true); });
  const rs = input === 'touch' ? (16 + 58) * 0.62 : 16 + 58; // the hole's radius at full mass, from the well's own rule
  for (const [sel, name, offsets] of [['.btn:not(.ghost)', 'Enter the gallery', [[2.7, 0], [3.5, -1.2], [1.6, 1.6]]], ['.strip li:nth-child(2) a', 'Frame F0005, 13 Dec 2025. Open the gallery', [[2.2, -1.0], [-2.4, -0.4]]]]) {
    const home = await rectOf(page, sel);
    for (const [ox, oy] of offsets) {
      await A(page, ([x, y]) => { window.__afterHours.restore(); window.__afterHours.setWell(x, y); }, [(home.x0 + home.x1) / 2 + ox * rs, (home.y0 + home.y1) / 2 + oy * rs]);
      await settle(page, sel); // the lean settles. With software graphics a frame can take a second, so wait on the layout, not the clock
      const before = await rectOf(page, sel), box = await drawnBox(page, sel), dom = await rectOf(page, sel), well = await A(page, () => ({ x: window.__afterHours.well.x, y: window.__afterHours.well.y, mass: window.__afterHours.well.mass }));
      const where = `${label}, ${name}, well at (${Math.round(well.x)}, ${Math.round(well.y)}) mass ${well.mass}: drawn ${JSON.stringify(box)}, link box ${JSON.stringify(dom)}`;
      assert.ok(Math.abs(before.x0 - dom.x0) < 1 && Math.abs(before.y0 - dom.y0) < 1, 'the link was still moving: ' + where);
      assert.ok(box.n > 0.8 * (dom.x1 - dom.x0) * (dom.y1 - dom.y0), 'link not drawn in full: ' + where);
      for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(box[k] - dom[k]) <= 2, `drawn edge ${k} is away from the click target: ` + where);
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      if (input === 'mouse') await page.mouse.click(cx, cy); else await page.touchscreen.tap(cx, cy);
      const clicked = await A(page, () => window.__clicked.splice(0));
      assert.deepEqual(clicked, [name], `${input} at the drawn centre (${cx}, ${cy}) did not open the link: ` + where);
    }
  }
  assert.equal(await A(page, () => window.__afterHours.tier), 'canvas');
  log(`HTML-in-Canvas, ${label}: with the well close at full mass, two links are drawn within 2 px of their click targets and open at their drawn centres`);
  await browser.close();
}
// Skip link: keeps the room you are in, in both versions. A stray address mark does not switch rooms either.
for (const canvasOn of [true, false]) {
  const { browser, page } = await open(canvasOn);
  await A(page, () => window.__afterHours.setRoom('lamplight'));
  await page.focus('.skip'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  assert.deepEqual(await A(page, () => [window.__afterHours.room, location.hash, document.activeElement.id]), ['lamplight', '#lamplight', 'room'], 'skip link');
  await A(page, () => { location.hash = 'room'; }); await page.waitForTimeout(200);
  assert.deepEqual(await A(page, () => [window.__afterHours.room, location.hash]), ['lamplight', '#lamplight'], 'stray address mark');
  await A(page, () => { location.hash = 'undertow'; }); await page.waitForTimeout(200);
  assert.equal(await A(page, () => window.__afterHours.room), 'undertow', 'room address still works');
  log(`${canvasOn ? 'HTML-in-Canvas' : 'plain HTML'}: the skip link focuses the room and keeps Lamplight; #undertow still switches rooms`);
  await browser.close();
}
// Resize, both versions: 400x800 to 400x640 and back. Every drawing surface matches the window, and the page at 400x640
// looks the same as one opened at 400x640 from the start (reduced motion, so nothing moves between pictures).
for (const canvasOn of [true, false]) {
  const phone = h => ({ viewport: { width: 400, height: h }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const fresh = await open(canvasOn, phone(640)), { browser, page } = await open(canvasOn, phone(800));
  const sizes = p => A(p, () => ['wellfx', 'dark', 'glass'].map(id => document.getElementById(id)).filter(c => c && getComputedStyle(c).display !== 'none').map(c => `${c.id} ${c.width}x${c.height}`));
  const want = h => canvasOn ? [`glass 400x${h}`] : [`wellfx 400x${h}`, `dark 400x${h}`]; // device scale 1, so one canvas pixel per CSS pixel
  await page.setViewportSize({ width: 400, height: 640 }); await page.waitForTimeout(400);
  assert.deepEqual(await sizes(page), want(640), 'after 800 to 640');
  for (const room of ['undertow', 'lamplight']) {
    for (const p of [fresh.page, page]) { await A(p, r => { window.__afterHours.setRoom(r); window.__afterHours.setWell(300, 300); }, room); if (canvasOn) await A(p, () => new Promise(r => setTimeout(r, 400))); }
    await page.waitForTimeout(400);
    const [a, b] = [await pixels(page, await fresh.page.screenshot()), await pixels(page, await page.screenshot())];
    let off = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 48) off++;
    assert.ok(off < 200, `${room} at 400x640 after a resize differs from a fresh 400x640 page in ${off} pixels`);
  }
  await page.setViewportSize({ width: 400, height: 800 }); await page.waitForTimeout(400);
  assert.deepEqual(await sizes(page), want(800), 'after 640 back to 800');
  log(`${canvasOn ? 'HTML-in-Canvas' : 'plain HTML'}: 400x800 to 400x640 and back resizes every drawing surface; after the change both rooms match a fresh 400x640 page`);
  await fresh.browser.close(); await browser.close();
}
// Reduced motion: with no mass nothing vanishes, and Restore keeps the page whole until the well is changed again.
{
  const { browser, page } = await open(false, { reducedMotion: 'reduce' });
  const cta = '.btn:not(.ghost)', seen = () => A(page, s => getComputedStyle(document.querySelector(s)).opacity, cta), mass = v => A(page, v => { const m = document.getElementById('mass'); m.value = v; m.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  const c = await rectOf(page, cta); await A(page, ([x, y]) => window.__afterHours.setWell(x, y), [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2]); await page.waitForTimeout(200);
  assert.equal(await seen(), '0', 'well on the link at mass 55: it goes');
  await mass(0); await page.waitForTimeout(200); assert.equal(await seen(), '1', 'mass 0: nothing is pulled in');
  await mass(55); await page.waitForTimeout(200); assert.equal(await seen(), '0', 'mass back up: it goes again');
  await page.click('#restore'); await page.waitForTimeout(200); assert.equal(await seen(), '1', 'Restore brings it back and it stays');
  await page.focus('#wellkey'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200); assert.equal(await seen(), '0', 'moving the well 24 px pulls it in again');
  log('reduced motion: nothing vanishes at zero mass, and Restore holds until the well is changed');
  await browser.close();
}
// A graphics error reported after the first paint (without any call throwing) still hands the page back.
{
  const { browser, page } = await open(true, {}, '', () => { const P = WebGL2RenderingContext.prototype, real = P.getError; let n = 0; P.getError = function () { return ++n > 1 ? 0x0502 : real.call(this); }; });
  await until(page, () => window.__afterHours.tier === 'html');
  assert.equal(await A(page, () => window.__afterHours.painted), true, 'the first paint went through');
  assert.match(await A(page, () => document.getElementById('tier').textContent), /stopped working/);
  log('a graphics error flag raised after the first paint hands the page back');
  await browser.close();
}
// Real images: an entry with an image path shows that file; one whose file fails shows a dimmed study marked missing.
// The image is a tiny picture made here by the test (8 by 10 pixels); nothing is added to the repo.
{
  const png = (w, h) => { const chunk = (t, d) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), td = Buffer.concat([Buffer.from(t), d]); l.writeUInt32BE(d.length); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
    const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([40 + x * 20, 60 + y * 15, 90], y * (w * 3 + 1) + 1 + x * 3);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
  for (const canvasOn of [true, false]) {
    const routes = async page => {
      await page.route('**/demos/axy-after-hours/app.js', async route => { const res = await route.fetch(); let js = await res.text(); const n = js.length;
        js = js.replace("{ ref: 'F0006', date", "{ ref: 'F0006', image: 'test-frames/ok.png', date").replace("{ ref: 'F0005', date", "{ ref: 'F0005', image: 'test-frames/missing.png', date");
        assert.ok(js.length === n + "image: 'test-frames/ok.png', ".length + "image: 'test-frames/missing.png', ".length, 'test could not add image paths'); await route.fulfill({ response: res, body: js }); });
      await page.route('**/test-frames/ok.png', r => r.fulfill({ status: 200, contentType: 'image/png', body: png(8, 10) }));
      await page.route('**/test-frames/missing.png', r => r.fulfill({ status: 404, contentType: 'text/plain', body: 'not here' }));
    };
    const { browser, page } = await open(canvasOn, {}, '', null, routes, /status of 404/);
    const f = await A(page, () => [...document.querySelectorAll('img')].filter(i => i.closest('a')).map(i => ({ label: i.closest('a').getAttribute('aria-label'), w: i.naturalWidth, h: i.naturalHeight, src: i.src.split('/').pop().slice(0, 7), missing: i.classList.contains('missing'), ref: i.closest('li').querySelector('.ref').textContent })));
    const ok = f.filter(x => x.label.startsWith('Frame F0006')), bad = f.filter(x => x.label.startsWith('Frame F0005')), rest = f.filter(x => !/F000[56]/.test(x.label));
    assert.equal(ok.length, 2); assert.equal(bad.length, 2); assert.equal(rest.length, 10);
    for (const x of ok) assert.deepEqual([x.w, x.h, x.src, x.missing, x.ref], [8, 10, 'ok.png', false, 'F0006'], 'given image shown');
    for (const x of bad) assert.deepEqual([x.w, x.h, x.missing, x.ref, x.label], [360, 450, true, 'F0005 missing', 'Frame F0005, 13 Dec 2025. Image did not load. Open the gallery'], 'failed image state');
    for (const x of rest) assert.deepEqual([x.w, x.h, x.missing], [360, 450, false], 'other frames unchanged');
    assert.equal(await A(page, () => getComputedStyle(document.querySelector('img.missing')).opacity), '0.45');
    log(`${canvasOn ? 'HTML-in-Canvas' : 'plain HTML'}: a frame given an image shows that file (8x10 test picture); a failed file shows a dimmed study marked missing`);
    await browser.close();
  }
}
if (errors.length) { console.log('CONSOLE PROBLEMS\n' + [...new Set(errors)].join('\n')); process.exit(1); }
console.log('ok  zero console errors, warnings or failed requests across all runs');
