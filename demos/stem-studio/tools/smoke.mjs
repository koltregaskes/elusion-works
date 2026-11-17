// End-to-end check in a real browser. Needs a static server serving the repo root; set BASE (default http://127.0.0.1:8765).
// Run: node demos/stem-studio/tools/smoke.mjs [path-to-axe.min.js]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = (process.env.BASE || 'http://127.0.0.1:8765') + '/demos/stem-studio/', axe = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : null, errors = [];
const log = (...a) => console.log('ok ', ...a);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
async function open(opts = {}) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...opts }), page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message)); page.on('requestfailed', r => errors.push('[requestfailed] ' + r.url()));
  await page.goto(URL, { waitUntil: 'load' }); await page.waitForFunction(() => window.stemStudio);
  return { ctx, page };
}
const A = (page, fn, arg) => page.evaluate(fn, arg);
const proj = page => A(page, () => window.stemStudio.project());
const clipsOn = (p, t) => p.clips.filter(c => c.track === t).map(c => [c.start, c.len]).sort((a, b) => a[0] - b[0]);

{ // Desktop: edit clips by pointer and by keyboard, undo, edit notes, change tempo.
  const { ctx, page } = await open(); const p0 = await proj(page); assert.equal(p0.tracks.length, 4); assert.equal(p0.bars, 32);
  const lead = page.locator('.clip[data-id="c-lead-8"]'), box = await lead.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 30 - 88, box.y + 20, { steps: 4 }); await page.mouse.up(); // two bars left at 44 px a bar
  assert.deepEqual(clipsOn(await proj(page), 'lead')[0], [6, 4], 'drag moves a clip by whole bars');
  const b2 = await page.locator('.clip[data-id="c-lead-8"]').boundingBox(); await page.mouse.move(b2.x + b2.width - 4, b2.y + 20); await page.mouse.down(); await page.mouse.move(b2.x + b2.width - 4 + 44, b2.y + 20, { steps: 3 }); await page.mouse.up();
  assert.deepEqual(clipsOn(await proj(page), 'lead')[0], [6, 5], 'dragging the right edge resizes');
  await page.focus('.clip[data-id="c-lead-8"]'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowLeft'); assert.deepEqual(clipsOn(await proj(page), 'lead')[0], [7, 4]);
  assert.equal(await A(page, () => document.activeElement.dataset.id), 'c-lead-8', 'focus stays on the clip after an edit');
  await page.keyboard.press('d'); assert.equal(clipsOn(await proj(page), 'lead').length, p0.clips.filter(c => c.track === 'lead').length + 1);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  assert.deepEqual(await proj(page), p0, 'five undos return the song exactly'); await page.keyboard.press('Control+Shift+z'); assert.deepEqual(clipsOn(await proj(page), 'lead')[0], [6, 4]); await page.click('#undo');
  // Notes: keyboard in the grid, then a click on the canvas.
  await page.focus('.clip[data-id="c-drums-4"]'); await page.keyboard.press('Enter'); assert.equal(await A(page, () => document.activeElement.id), 'grid');
  const n0 = p0.patterns['d-verse'].notes.length; await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  assert.equal((await proj(page)).patterns['d-verse'].notes.length, n0 + 1); assert.match(await page.textContent('#grid-say'), /Kick, bar 1 step 2, added/);
  await page.keyboard.press('Enter'); assert.equal((await proj(page)).patterns['d-verse'].notes.length, n0);
  const g = await page.locator('#grid').boundingBox(); await page.mouse.click(g.x + 22 * 6 + 8, g.y + 22 * 3 + 8); assert.equal((await proj(page)).patterns['d-verse'].notes.filter(n => n.p === 'hat' && n.t === 6).length, 0, 'click removes the hat on step 7');
  await page.click('#clip-unique'); assert.notEqual((await proj(page)).clips.find(c => c.id === 'c-drums-4').pattern, 'd-verse');
  await page.fill('#bpm', '126'); await page.keyboard.press('Tab'); assert.equal((await proj(page)).bpm, 126); await page.click('#bpm-down'); assert.equal((await proj(page)).bpm, 125);
  await page.click('button[aria-label="Mute Bass"]'); assert.equal((await proj(page)).tracks[1].mute, true); assert.equal(await page.getAttribute('button[aria-label="Mute Bass"]', 'aria-pressed'), 'true');
  log('clips move and resize by pointer and keys, duplicate, undo and redo; notes by keyboard and click; tempo; mute');
  // Save and reload: the edited song survives a refresh.
  const before = await proj(page); await page.reload(); await page.waitForFunction(() => window.stemStudio); assert.deepEqual(await proj(page), before);
  await page.click('#more'); await page.click('#reset'); assert.equal((await proj(page)).bpm, 112); await page.click('#undo'); assert.equal((await proj(page)).bpm, 125); await page.click('#more'); await page.click('#reset');
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('#more'); await page.click('#save-project'); })()]);
  const saved = JSON.parse(readFileSync(await dl.path(), 'utf8')); assert.equal(saved.v, 1); assert.equal(dl.suggestedFilename(), 'night-bus-home.stemstudio.json');
  await A(page, () => { const dt = new DataTransfer(); dt.items.add(new File(['{"nope":true}'], 'bad.json', { type: 'application/json' })); const i = document.getElementById('file-project'); i.files = dt.files; i.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => /not a Stem Studio project/.test(document.getElementById('toast').textContent));
  log('survives a refresh, reset is undoable, project file saves, a wrong file is refused in plain words');
  // Plans: plain requests, a pasted plan, a bad plan, and the script interface.
  await page.click('#tab-arr'); await page.fill('#ask', 'Drop the drums in the break'); await page.keyboard.press('Enter');
  assert.equal(clipsOn(await proj(page), 'drums').some(([s, l]) => s < 24 && s + l > 20), false); assert.match(await page.textContent('#log li'), /Cleared Drums in bars 21 to 24/);
  await page.click('.chip:has-text("Double the chorus")'); assert.equal((await proj(page)).bars, 40);
  await page.fill('#ask', 'make it sound like rain on a tin roof'); await page.click('#ask-go'); assert.match(await page.textContent('#log li.err'), /only knows a few moves/); assert.equal((await proj(page)).bars, 40);
  await page.fill('#plan', '{"ops":[{"op":"set_tempo","bpm":96},{"op":"clear","track":"tuba","from":1,"to":2}]}'); await page.click('#plan-go'); assert.equal((await proj(page)).bpm, 112, 'a plan with one bad move changes nothing'); assert.match(await page.textContent('#log li.err'), /No track called "tuba"/);
  await page.fill('#plan', '{"ops":[{"op":"set_tempo","bpm":96},{"op":"delete","section":"Intro"}]}'); await page.click('#plan-go'); let q = await proj(page); assert.equal(q.bpm, 96); assert.equal(q.bars, 36);
  await page.click('#undo'); q = await proj(page); assert.equal(q.bpm, 112); assert.equal(q.bars, 40, 'one undo takes a whole plan back');
  const viaScript = await A(page, () => window.stemStudio.apply({ ops: [{ op: 'mute', track: 'lead', on: true }] })); assert.deepEqual(viaScript, { ok: true, said: ['Lead muted'] });
  assert.match(await A(page, () => window.stemStudio.brief('bigger ending')), /Reply with JSON only[\s\S]*Request: bigger ending/);
  await page.fill('#plan', 'not json'); await page.click('#plan-go'); assert.match(await page.textContent('#log li.err'), /not valid JSON/);
  log('arranger: plain requests, pasted plans applied whole or not at all, one undo per plan, script interface, brief');
  await page.click('#more'); await page.click('#reset');
  // Sound: the eight-bar fixture, the exported file, stems, and live playback.
  const fx = await A(page, async () => { const r = await window.stemStudio.render(12, 20), v = new DataView(r.wav), d = new Int16Array(r.wav, 44); let sum = 0, max = 0; for (let i = 0; i < d.length; i += 2) { sum += d[i] * d[i]; max = Math.max(max, Math.abs(d[i])); }
    return { seconds: r.seconds, samples: r.samples, peak: r.peak, riff: String.fromCharCode(...new Uint8Array(r.wav, 0, 4)), fmt: v.getUint16(20, true), ch: v.getUint16(22, true), sr: v.getUint32(24, true), bits: v.getUint16(34, true), dataBytes: v.getUint32(40, true), fileBytes: r.wav.byteLength, rms: Math.sqrt(sum / (d.length / 2)) / 32768, max }; });
  const want = 8 * 4 * 60 / 112 + 2; assert.ok(Math.abs(fx.seconds - want) < 1e-3, `eight bars at 112 bpm plus the tail is ${want.toFixed(3)} s, got ${fx.seconds}`); assert.equal(fx.samples, Math.round(want * 44100));
  assert.ok(fx.peak <= 0.98 && fx.max < 32767, 'the export clips'); assert.ok(fx.rms > 0.05, 'the export is near silent');
  assert.deepEqual([fx.riff, fx.fmt, fx.ch, fx.sr, fx.bits, fx.dataBytes, fx.fileBytes], ['RIFF', 1, 2, 44100, 16, fx.samples * 4, fx.samples * 4 + 44]);
  const stem = await A(page, async () => { const one = await window.stemStudio.render(12, 14, 'bass'); const made = await window.stemStudio.loadStem('My bass take.wav', one.wav); const p = window.stemStudio.project(); const withStem = await window.stemStudio.render(0, 2); const s2 = window.stemStudio.apply({ ops: [{ op: 'mute', track: made.id, on: true }] }); const without = await window.stemStudio.render(0, 2);
    const energy = w => { const d = new Int16Array(w, 44); let s = 0; for (let i = 0; i < d.length; i += 2) s += d[i] * d[i]; return s; };
    return { made, track: p.tracks.at(-1), clip: p.clips.at(-1), louder: energy(withStem.wav) > energy(without.wav) * 1.5, muted: s2.ok }; });
  assert.equal(stem.track.kind, 'audio'); assert.equal(stem.track.name, 'My bass take'); assert.equal(stem.clip.len, 3); assert.ok(stem.louder && stem.muted, 'a loaded stem is in the mix and can be muted');
  assert.equal(await page.locator('.lane[data-track^="stem-"] .clip').count(), 1);
  await page.click('#play'); await page.waitForFunction(() => window.stemStudio.state().playing && window.stemStudio.state().position > 1.5, null, { timeout: 20000 });
  assert.equal(await page.getAttribute('#play', 'aria-label'), 'Stop'); await page.keyboard.press('Space').catch(() => {}); await page.focus('#scroll'); if (await A(page, () => window.stemStudio.state().playing)) await page.keyboard.press('Space');
  assert.equal(await A(page, () => window.stemStudio.state().playing), false);
  const [wav] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), page.click('#export')]); assert.equal(wav.suggestedFilename(), 'night-bus-home.wav'); const bytes = readFileSync(await wav.path()); assert.equal(bytes.subarray(0, 4).toString(), 'RIFF'); assert.ok(bytes.length > 5e6);
  log(`sound: eight bars render to exactly ${fx.samples} samples (${fx.seconds.toFixed(3)} s), peak ${(fx.peak * 100).toFixed(0)}%, valid 16-bit stereo WAV; a stem loads, plays and mutes; playback runs; full export downloads (${(bytes.length / 1e6).toFixed(1)} MB)`);
  if (axe) { await page.addScriptTag({ content: axe }); for (const t of ['tab-clip', 'tab-arr']) { await page.click('#' + t); if (t === 'tab-clip') await page.click('.clip[data-id="c-keys-0"]');
    const res = await A(page, () => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })); assert.deepEqual(res.violations.map(v => `${v.id}: ${v.nodes[0].target.join(' ')}`), [], 'axe violations'); } log('axe WCAG 2.2 A/AA: 0 violations on both tabs'); }
  await ctx.close();
}
for (const [w, h] of [[400, 800], [320, 568], [740, 360]]) { // Phones: nothing overflows sideways, controls are finger-sized, taps and drags work.
  const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  const o = await A(page, () => ({ sw: document.documentElement.scrollWidth, w: innerWidth, small: [...document.querySelectorAll('button,select,input:not([type=file]),[role=tab]')].filter(e => e.getClientRects().length).map(e => [e.id || e.textContent.trim().slice(0, 12) || e.getAttribute('aria-label'), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)]).filter(x => x[1] < 24 || x[2] < 24),
    off: [...document.querySelectorAll('.bar button, .bar input, .bar output, .tabs button, .heads button')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map(e => e.id || e.textContent.trim()) }));
  assert.ok(o.sw <= o.w, `sideways overflow at ${w}x${h}`); assert.deepEqual(o.small, [], `small targets at ${w}x${h}`); assert.deepEqual(o.off, [], `controls off screen at ${w}x${h}`);
  await page.tap('button[aria-label="Solo Keys"]'); assert.equal((await proj(page)).tracks[2].solo, true); await page.tap('#tab-arr'); await page.tap('.chip:has-text("Cut the intro")'); assert.equal((await proj(page)).bars, 28);
  await ctx.close();
}
log('phones 400x800, 320x568 and 740x360: no sideways overflow, targets 24 px or more, taps work');
await browser.close();
if (errors.length) { console.log('CONSOLE PROBLEMS\n' + [...new Set(errors)].join('\n')); process.exit(1); }
console.log('ok  zero console errors, warnings or failed requests');
