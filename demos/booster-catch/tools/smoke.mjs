// End-to-end check in a real browser. Needs a static server on http://127.0.0.1:8765 (repo root).
// Run: node demos/booster-catch/tools/smoke.mjs [path-to-axe.min.js]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = 'http://127.0.0.1:8765/demos/booster-catch/', axePath = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function open(opts) {
  const page = await browser.newPage({ deviceScaleFactor: 1, ...opts });
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
  await page.selectOption('#rate', '2'); await page.waitForTimeout(6000);
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
  for (const [label, t] of [['Mach 1', 368], ['Burn', 390], ['Catch', 414]]) { await page.click(`.mark:text-is("${label}")`); const s = await st(page); assert.ok(Math.abs(s.t - t) < 0.05, label); }
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
      const res = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
      const v = res.violations.map(x => `${x.id} (${x.nodes.length}): ${x.nodes[0].target.join(' ')}`);
      assert.deepEqual(v, [], 'axe violations'); log(`axe WCAG 2.1 A/AA: 0 violations${openDialog ? ' with the sources dialog open' : ''} (${res.passes.length} rules passed)`);
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
await browser.close();
if (errors.length) { console.log('CONSOLE PROBLEMS\n' + [...new Set(errors)].join('\n')); process.exit(1); }
console.log('ok  zero console errors, warnings or failed requests across all runs');
