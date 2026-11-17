// End-to-end check in a real browser, in both versions: HTML-in-Canvas switched on, and plain HTML.
// Needs a static server on http://127.0.0.1:8765 (repo root). Run: node demos/axy-after-hours/tools/smoke.mjs [path-to-axe.min.js]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = 'http://127.0.0.1:8765/demos/axy-after-hours/', axe = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : null;
const base = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], errors = [];
const log = (...a) => console.log('ok ', ...a);
async function open(canvasOn, opts = {}, path = '', init) {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: canvasOn ? [...base, '--enable-features=CanvasDrawElement'] : base });
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 }, ...opts });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => errors.push('[requestfailed] ' + r.url()));
  if (init) await page.addInitScript(init);
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
  if (axe) {
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
for (const canvasOn of [true, false]) for (const [w, h] of [[740, 360], [320, 480], [390, 664], [360, 640]]) {
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
log('short and narrow screens (740x360, 320x480, 390x664, 360x640), both versions: controls, links, wall, lamps and credit all reachable');
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
if (errors.length) { console.log('CONSOLE PROBLEMS\n' + [...new Set(errors)].join('\n')); process.exit(1); }
console.log('ok  zero console errors, warnings or failed requests across all runs');
