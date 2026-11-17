// End-to-end check in a real browser. Needs a static server serving the repo root (default http://127.0.0.1:8765).
// Run: node demos/booster-catch/tools/smoke.mjs [path-to-axe.min.js] [base URL]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const axePath = process.argv[2], URL = (process.argv[3] || 'http://127.0.0.1:8765').replace(/\/$/, '') + '/demos/booster-catch/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function open(opts, init) {
  const page = await browser.newPage({ deviceScaleFactor: 1, ...opts });
  if (init) await page.addInitScript(init);
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => errors.push('[requestfailed] ' + r.url()));
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__replay && window.__replay.firstFrameMs !== null, null, { timeout: 120000 });
  return { page, loadMs: Date.now() - t0 };
}
const st = page => page.evaluate(() => window.__replay.state());
const log = (...a) => console.log('ok ', ...a);

// 1. Desktop: autoplays the director's cut, clock advances, cameras cut.
{
  const { page, loadMs } = await open({ viewport: { width: 1280, height: 800 } });
  const first = await page.evaluate(() => window.__replay.firstFrameMs);
  const a = await st(page); assert.equal(a.playing, true); assert.equal(a.director, true);
  // Software graphics on a busy machine can run at one frame a second, so wait for the clock (up to 2 minutes) rather than a fixed 6 s.
  await page.selectOption('#rate', '2'); await page.waitForTimeout(6000);
  await page.waitForFunction(t0 => window.__replay.state().t > t0 + 1, a.t, { timeout: 120000 }).catch(() => {});
  const b = await st(page); assert.ok(b.t > a.t + 1, 'clock did not advance'); 
  log(`desktop first frame ${first} ms after navigation start (page load to first frame wall time ${loadMs} ms, software GL); clock ${a.t.toFixed(1)} -> ${b.t.toFixed(1)}; camera ${a.cam} -> ${b.cam}`);
  // Scrub: same clock value gives identical state whichever camera or view is showing.
  await page.keyboard.press('Space'); assert.equal((await st(page)).playing, false);
  const snaps = [];
  for (const [cam, mode] of [['tracker', 'visual'], ['onboard', 'blueprint'], ['pad', 'thermal'], ['arm', 'visual'], ['free', 'visual']]) {
    await page.evaluate(([c, m]) => { const r = window.__replay; r.setCamera(c); r.setMode(m); r.seek(401.25); r.renderNow(); }, [cam, mode]);
    const s = await st(page); snaps.push(JSON.stringify([s.x, s.y, s.z, s.leanX, s.arm, s.lit, s.thrust])); assert.equal(s.cam, cam); assert.equal(s.mode, mode);
  }
  assert.equal(new Set(snaps).size, 1, 'state differs between cameras'); log('five cameras and three views agree on the state at T+6:41.25');
  // Cited event times through the UI markers.
  for (const [label, t] of [['Mach 1', 368], ['Burn', 390], ['Catch', 414]]) { await page.click(`.mark:has-text("${label}")`); const s = await st(page); assert.ok(Math.abs(s.t - t) < 0.05, label); }
  log('timeline markers jump to T+6:08, T+6:30 and T+6:54');
  // Keyboard: arrows step a second, digits pick cameras, letters switch views.
  assert.equal((await st(page)).phase, 'Caught'); assert.match(await page.getAttribute('#scrub', 'aria-valuetext'), /T plus 06:54, Caught/);
  await page.focus('#stage'); await page.keyboard.press('ArrowRight'); assert.ok(Math.abs((await st(page)).t - 415) < 0.05);
  await page.keyboard.press('Shift+ArrowLeft'); assert.ok(Math.abs((await st(page)).t - 410) < 0.05);
  for (let i = 1; i <= 8; i++) { await page.keyboard.press(String(i)); }
  assert.equal((await st(page)).cam, 'free'); assert.equal((await st(page)).director, false);
  await page.keyboard.press('b'); assert.equal((await st(page)).mode, 'blueprint'); await page.keyboard.press('t'); assert.equal((await st(page)).mode, 'thermal'); await page.keyboard.press('n');
  await page.keyboard.press('d'); assert.equal((await st(page)).director, true);
  await page.keyboard.press('v'); assert.equal(await page.getAttribute('#split', 'aria-pressed'), 'true'); await page.evaluate(() => window.__replay.renderNow());
  assert.equal(await page.locator('button[data-cam]:visible').count() >= 10, true, 'split view inset buttons missing');
  await page.keyboard.press('p'); assert.equal(await page.getAttribute('#path', 'aria-pressed'), 'true');
  await page.keyboard.press('m'); assert.equal(await page.getAttribute('#sound', 'aria-pressed'), 'true'); await page.keyboard.press('m');
  log('keyboard: step, eight cameras, views, director, split, path, sound');
  // Range input by keyboard, dialog open and close, replay to the end stops cleanly.
  await page.focus('#scrub'); await page.keyboard.press('Home'); assert.ok((await st(page)).t < 366.1);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('PageUp'); assert.ok(Math.abs((await st(page)).t - 372) < 0.05, 'timeline arrows step whole seconds'); await page.keyboard.press('Home');
  assert.match(await page.getAttribute('#scrub', 'aria-valuetext'), /T plus 06:06/);
  await page.click('#about-open'); assert.equal(await page.evaluate(() => document.getElementById('about').open), true);
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.getElementById('about').open), false);
  await page.evaluate(() => { window.__replay.seek(419.2); window.__replay.setPlaying(true); }); await page.waitForFunction(() => !window.__replay.state().playing, null, { timeout: 90000 });
  const end = await st(page); assert.equal(end.playing, false); assert.ok(Math.abs(end.t - 420) < 0.01);
  await page.click('#play'); await page.waitForTimeout(1500); const again = await st(page); assert.ok(again.playing && again.t < 370, 'play after the end restarts');
  log('scrubber, sources dialog, end of replay and restart');
  if (axePath) {
    await page.keyboard.press('Space'); await page.addScriptTag({ content: readFileSync(axePath, 'utf8') });
    for (const openDialog of [false, true]) {
      if (openDialog) await page.click('#about-open');
      const res = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }));
      const v = res.violations.map(x => `${x.id} (${x.nodes.length}): ${x.nodes[0].target.join(' ')}`);
      assert.deepEqual(v, [], 'axe violations'); log(`axe WCAG 2.2 A/AA: 0 violations${openDialog ? ' with the sources dialog open' : ''} (${res.passes.length} rules passed)`);
    }
  }
  await page.close();
}
// 2. Phone, 400 px wide, touch: nothing overflows, controls reachable and big enough.
{
  const { page } = await open({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, small: [...document.querySelectorAll('button:not([style*="display: none"]),select,input')].filter(e => e.offsetParent && !e.classList.contains('mark')).map(e => [e.id || e.textContent.trim(), Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 32) }));
  assert.ok(o.sw <= o.w, 'horizontal overflow'); assert.deepEqual(o.small, [], 'small touch targets');
  await page.tap('.modes button[data-mode="thermal"]'); assert.equal((await st(page)).mode, 'thermal');
  await page.tap('#director'); await page.locator('button[data-cam="shore"]').scrollIntoViewIfNeeded(); await page.tap('button[data-cam="shore"]'); assert.equal((await st(page)).cam, 'shore');
  await page.tap('#play'); const p1 = (await st(page)).playing; await page.tap('#play'); assert.notEqual((await st(page)).playing, p1);
  log('phone 400x800: no sideways overflow, touch targets 32 px or taller, taps work');
  await page.close();
}
// 2b. Short phone and short desktop window: the action stays clear of the panels, and split view never covers the transport.
{
  const { page } = await open({ viewport: { width: 375, height: 548 }, hasTouch: true, isMobile: true });
  await page.evaluate(() => { const r = window.__replay; r.setPlaying(false); r.setDirector(false); r.setCamera('tracker'); r.seek(400); r.renderNow(); });
  const hit = await page.evaluate(() => { const top = document.querySelector('.title').getBoundingClientRect().bottom + 6, bottom = Math.min(...['.telemetry', '.modes', '.dock'].map(q => document.querySelector(q).getBoundingClientRect().top)); const e = document.elementFromPoint(innerWidth / 2, (top + bottom) / 2); return { id: e.id, band: Math.round(bottom - top) }; });
  assert.equal(hit.id, 'stage', 'the middle of the free band is covered'); assert.ok(hit.band >= 80, 'free band too small: ' + hit.band);
  const fr = await page.evaluate(() => window.__replay.free); assert.ok(fr.top > 40 && fr.bottom < 400 && fr.bottom - fr.top >= 80, 'picture is not centred in the free band: ' + JSON.stringify(fr));
  await page.close();
  const d = await open({ viewport: { width: 1280, height: 450 } });
  await d.page.evaluate(() => { const r = window.__replay; r.setPlaying(false); document.getElementById('split').click(); r.renderNow(); });
  for (const id of ['play', 'restart', 'rate', 'director']) assert.equal(await d.page.evaluate(i => { const r = document.getElementById(i).getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest('button,select').id; }, id), id, id + ' is covered');
  log(`short phone 375x548: free band ${hit.band} px is clear; 1280x450 split view leaves the transport clickable`);
  await d.page.close();
}
// 3. Reduced motion: no autoplay, a still frame near the catch, sound off.
{
  const { page } = await open({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const s = await st(page); assert.equal(s.playing, false); assert.equal(s.director, false); assert.ok(s.t > 410);
  await page.waitForTimeout(500); assert.equal((await st(page)).t, s.t);
  log('reduced motion: starts paused on a still frame');
  await page.close();
}
// 4. Fixes from the outside review (17 Nov 2026).
{
  const { page } = await open({ viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => window.__replay.setPlaying(false));
  // Keyboard focus on the 3D view is visible.
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const e = document.activeElement, cs = getComputedStyle(e); return { id: e.id, style: cs.outlineStyle, width: cs.outlineWidth }; });
  assert.deepEqual(ring, { id: 'stage', style: 'solid', width: '3px' }, 'canvas focus ring');
  // Flight path button always says what is on screen, in every view.
  const pathState = async () => [(await st(page)).pathShown, await page.getAttribute('#path', 'aria-pressed')];
  await page.evaluate(() => window.__replay.setMode('blueprint')); assert.deepEqual(await pathState(), [true, 'true'], 'blueprint starts with the path on');
  await page.click('#path'); assert.deepEqual(await pathState(), [false, 'false'], 'blueprint path off');
  await page.click('#path'); assert.deepEqual(await pathState(), [true, 'true'], 'blueprint path on again');
  await page.evaluate(() => window.__replay.setMode('visual')); assert.deepEqual(await pathState(), [false, 'false'], 'visual path off');
  await page.click('#path'); assert.deepEqual(await pathState(), [true, 'true'], 'visual path on');
  await page.evaluate(() => window.__replay.setMode('thermal')); assert.deepEqual(await pathState(), [true, 'true'], 'thermal shares the visual setting');
  await page.click('#path'); await page.evaluate(() => window.__replay.setMode('visual'));
  log('focus ring on the 3D view; flight path button matches the screen in all three views');
  // Thermal colours are labelled as illustrative while the thermal view is on.
  assert.equal(await page.locator('.note .note-thermal').isVisible(), false);
  await page.evaluate(() => window.__replay.setMode('thermal')); assert.equal(await page.locator('.note .note-thermal').isVisible(), true, 'thermal note');
  await page.evaluate(() => window.__replay.setMode('visual'));
  // Blueprint labels are never cut off.
  const labels = await page.evaluate(() => window.__replay.labels());
  assert.ok(labels.length === 9 && labels.every(l => l.fits), 'labels cut off: ' + JSON.stringify(labels.filter(l => !l.fits)));
  // The readout says engines off at the moment the page says engines off and caught.
  await page.evaluate(() => { window.__replay.seek(414); window.__replay.renderNow(); });
  assert.equal(await page.textContent('#engn'), '0 / 33'); assert.equal(await page.textContent('#phase'), 'Caught');
  log('thermal colours labelled illustrative; all 9 blueprint labels fit; readout shows 0 / 33 engines at T+6:54');
  // Single-key shortcuts can be switched off (WCAG 2.1.4); Space still works.
  await page.click('#about-open'); await page.uncheck('#keys-on'); await page.keyboard.press('Escape');
  await page.focus('#stage'); const before = await st(page);
  for (const k of ['b', '3', 'd', 'p', 'm', 'k']) await page.keyboard.press(k);
  const after = await st(page);
  assert.deepEqual([after.mode, after.cam, after.director, after.pathShown, after.sound, after.playing], [before.mode, before.cam, before.director, before.pathShown, before.sound, before.playing], 'shortcuts still active');
  await page.keyboard.press('Space'); assert.equal((await st(page)).playing, !before.playing, 'Space should still work'); await page.keyboard.press('Space');
  await page.click('#about-open'); await page.check('#keys-on'); await page.keyboard.press('Escape');
  await page.focus('#stage'); await page.keyboard.press('b'); assert.equal((await st(page)).mode, 'blueprint', 'shortcuts back on'); await page.keyboard.press('n');
  log('letter and number shortcuts can be switched off in Sources; Space still works');
  // Losing the graphics context pauses through the normal path and stops the sound.
  await page.click('#sound'); await page.evaluate(() => window.__replay.setPlaying(true));
  assert.equal((await st(page)).sound, true);
  await page.evaluate(() => document.getElementById('stage').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.waitForFunction(() => window.__replay.state().lost, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__replay.state().audio !== 'running', null, { timeout: 10000 });
  const gone = await st(page);
  assert.deepEqual([gone.playing, gone.sound, await page.getAttribute('#play', 'aria-label'), await page.getAttribute('#sound', 'aria-pressed')], [false, false, 'Play', 'false']);
  assert.equal(await page.locator('#fallback').isVisible(), true); assert.match(await page.textContent('#fallback'), /interrupted/);
  log(`graphics context lost: paused, Play label restored, sound off (audio ${gone.audio}), message shown`);
  await page.close();
}
// 5. A browser that cannot start sound: the button says so and nothing throws.
{
  const { page } = await open({ viewport: { width: 1280, height: 800 } }, () => { delete window.AudioContext; delete window.webkitAudioContext; });
  await page.evaluate(() => window.__replay.setPlaying(false));
  await page.click('#sound'); await page.click('#sound', { force: true }); await page.focus('#stage'); await page.keyboard.press('m');
  assert.deepEqual([await page.getAttribute('#sound', 'aria-pressed'), await page.getAttribute('#sound', 'aria-disabled'), (await page.textContent('#sound')).trim(), (await st(page)).sound], ['false', 'true', 'No sound', false]);
  log('no sound available: button reads "No sound", stays off, no errors');
  await page.close();
}
// 6. The replay script cannot load: a message and a still frame instead of a blank page.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/three.module.js', r => r.abort());
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fallback')).display === 'grid', null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#fallback img').complete, null, { timeout: 30000 });
  const img = await page.evaluate(() => { const i = document.querySelector('#fallback img'); return { src: i.getAttribute('src'), w: i.naturalWidth }; });
  assert.ok(img.src === 'screenshot.jpg' && img.w === 1280, 'fallback still: ' + JSON.stringify(img));
  log('script blocked: fallback message and still frame shown');
  await page.close();
}
// 7. 1280 by 800 at 200% zoom lays out as 640 by 400: nothing sideways, main controls clickable.
{
  const { page } = await open({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  assert.ok(o.sw <= o.w, 'horizontal overflow at 640x400');
  for (const id of ['play', 'restart', 'rate', 'scrub', 'about-open', 'director']) assert.equal(await page.evaluate(i => { const r = document.getElementById(i).getBoundingClientRect(); return r.width > 0 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest('button,select,input').id; }, id), id, id + ' is covered at 640x400');
  assert.equal(await page.locator('.note-short').isVisible(), true, 'modelled label hidden at 640x400');
  log('640x400 (1280x800 at 200% zoom): no sideways overflow, controls clickable, modelled label visible');
  await page.close();
}
// The modelled label is visible on phones too.
{
  const { page } = await open({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
  assert.equal(await page.locator('.note-short').isVisible(), true, 'modelled label hidden on phone');
  const r = await page.evaluate(() => { const a = document.querySelector('.telemetry').getBoundingClientRect(), b = document.querySelector('.modes').getBoundingClientRect(); return a.top >= b.bottom - 0.5; });
  assert.ok(r, 'readout overlaps the view buttons on phone');
  log('phone 400x800: "Modelled, not telemetry" visible and clear of the view buttons');
  await page.close();
}
await browser.close();
if (errors.length) { console.log('CONSOLE PROBLEMS\n' + [...new Set(errors)].join('\n')); process.exit(1); }
console.log('ok  zero console errors, warnings or failed requests across all runs');
