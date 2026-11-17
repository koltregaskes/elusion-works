// End-to-end check in a real browser. Needs a static server serving the repo root; set BASE (default http://127.0.0.1:8765).
// Run: node demos/stem-studio/tools/smoke.mjs <path-to-axe.min.js>   (axe is required: the accessibility check is part of the pass)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = (process.env.BASE || 'http://127.0.0.1:8765') + '/demos/stem-studio/', axe = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : null, errors = [];
if (!axe) { console.log('FAIL give the path to axe.min.js as the first argument'); process.exit(1); }
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
const CSS_ESC = s => s.replace(/[^\w-]/g, c => '\\' + c);
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
{ // Review regressions: files that should not be trusted, the moving playhead, the tempo box, no-op edits, stems as one file.
  const { ctx, page } = await open(); const outside = []; page.on('request', r => { if (!r.url().startsWith(URL.split('/demos/')[0]) && !/^(blob|data):/.test(r.url())) outside.push(r.url()); });
  const feed = (name, obj) => A(page, ([n, text]) => { const dt = new DataTransfer(); dt.items.add(new File([text], n, { type: 'application/json' })); const i = document.getElementById('file-project'); i.files = dt.files; i.dispatchEvent(new Event('change')); }, [name, JSON.stringify(obj)]);
  const base = await proj(page), broken = JSON.parse(JSON.stringify(base)); delete broken.patterns['d-verse'].notes; broken.tracks[1].kind = 'bass);background-image:url(https://evil.example/px'; broken.clips[0].shift = 1e9; broken.name = '<img src=x onerror=alert(1)>';
  await feed('broken.json', broken); await page.waitForFunction(() => /Project opened/.test(document.getElementById('toast').textContent));
  let q = await proj(page); assert.ok(!q.patterns['d-verse'] && !q.tracks.some(t => t.id === 'bass') && q.clips.every(c => (c.shift || 0) < 16), 'the file was cleaned on the way in');
  assert.equal(await page.locator('#song img').count(), 0); assert.equal(await page.textContent('#song'), '<img src=x onerror=alert(1)>');
  await page.reload(); await page.waitForFunction(() => window.stemStudio); assert.ok(await page.locator('.clip').count() > 5, 'the page still works after reloading a cleaned file'); assert.deepEqual(outside, [], 'a project file made the page call out');
  await page.click('#more'); await page.click('#reset');
  await page.click('.clip[data-id="c-keys-0"]'); await page.click('#rewind'); await page.click('#play'); await page.waitForFunction(() => window.stemStudio.state().position > 8.3, null, { timeout: 30000 });
  await page.click('#clip-split'); q = await proj(page); assert.deepEqual(clipsOn(q, 'keys').slice(0, 2), [[0, 2], [2, 10]], 'split uses the moving playhead, at the bar line behind it'); await page.click('#play');
  const steps = () => A(page, () => window.stemStudio.state().undo); let n = await steps();
  await page.fill('#bpm', '500'); await page.keyboard.press('Enter'); assert.equal(await page.inputValue('#bpm'), '180'); assert.equal((await proj(page)).bpm, 180); assert.equal(await steps(), n + 1);
  await page.fill('#bpm', ''); await page.keyboard.press('Enter'); assert.equal(await page.inputValue('#bpm'), '180'); await page.click('#bpm-up'); assert.equal(await steps(), n + 1, 'an edit that changes nothing is not an undo step');
  await page.focus('.clip[data-id="c-keys-0"]'); await page.keyboard.press('ArrowLeft'); assert.equal(await steps(), n + 1); assert.equal(await A(page, () => document.activeElement.dataset.id), 'c-keys-0');
  assert.equal(await A(page, () => window.stemStudio.apply({ ops: [{ op: 'constructor' }] }).ok), false); assert.equal(await steps(), n + 1);
  assert.equal(await A(page, () => { const e = document.getElementById('pos'); return e.tagName + (e.getAttribute('aria-live') || '') + (e.getAttribute('role') || ''); }), 'SPAN', 'the position readout is not a live region');
  await page.click('#more'); await page.click('#reset'); const [z] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), (async () => { await A(page, () => window.stemStudio.apply({ ops: [{ op: 'delete', from: 5, to: 32 }] })); await page.click('#more'); await page.click('#save-stems'); })()]);
  const zb = readFileSync(await z.path()); assert.equal(z.suggestedFilename(), 'night-bus-home-stems.zip'); assert.equal(zb.readUInt32LE(0), 0x04034b50); assert.equal(zb.readUInt16LE(zb.length - 22 + 10), 2, 'two tracks have clips in the four bars left'); assert.equal(zb.subarray(30, 30 + 24).toString(), 'night-bus-home-drums.wav'); assert.equal(zb.subarray(30 + 24, 30 + 28).toString(), 'RIFF');
  log('review regressions: untrusted files are cleaned and cannot call out or break a reload; split follows the playhead; tempo box is truthful; no empty undo steps; stems arrive as one zip');
  await ctx.close();
}
// ---- Outside review, 17 Nov 2026 -------------------------------------------------------------------------------
// A plain sine WAV built in the page, so these checks do not depend on the studio's own renderer.
const SINE = () => { window.__sine = (secs, hz = 220) => { const sr = 44100, n = Math.round(secs * sr), b = new DataView(new ArrayBuffer(44 + n * 2)), s = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); s(36, 'data'); b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * hz / sr) * 12000), true); return b.buffer; }; };
{ // 1. A saved stem comes back onto its own edited track after a refresh, not as a new track at bar 1.
  const { ctx, page } = await open(); await A(page, SINE);
  const made = await A(page, async () => window.stemStudio.loadStem('Guitar.wav', window.__sine(20)));
  await A(page, id => window.stemStudio.apply({ ops: [{ op: 'set_level', track: id, level: 0.4 }] }), made.id);
  await page.focus(`.clip[data-id="c-${made.id}"]`); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); // move it to bar 3
  await page.click('#rewind'); await page.click('.ruler', { position: { x: 44 * 6 + 10, y: 36 } }); await page.focus(`.clip[data-id="c-${made.id}"]`); await page.keyboard.press('s'); // split at bar 7
  const edited = await proj(page); assert.deepEqual(clipsOn(edited, made.id), [[2, 4], [6, 6]], 'moved to bar 3 and split at bar 7 (20 s is 10 bars at 112 bpm)');
  const energy = async () => A(page, async () => { const r = await window.stemStudio.render(2, 12, window.stemStudio.project().tracks.at(-1).id), d = new Int16Array(r.wav, 44); let s = 0; for (let i = 0; i < d.length; i += 2) s += d[i] * d[i]; return Math.sqrt(s / (d.length / 2)) / 32768; });
  const heard = await energy(); assert.ok(heard > 0.02, 'the stem is heard before the refresh');
  await page.reload(); await page.waitForFunction(() => window.stemStudio); await A(page, SINE);
  assert.deepEqual(await proj(page), edited, 'the edited song survives the refresh'); assert.equal(await page.locator('.clip.missing').count(), 2); assert.ok(await energy() < 1e-4, 'with no audio the stem is silent');
  const back = await A(page, async () => window.stemStudio.loadStem('Guitar.wav', window.__sine(20)));
  assert.deepEqual(back, { id: made.id, seconds: 20, bars: null, relinked: true }, 'the same file goes back onto its own track');
  assert.deepEqual(await proj(page), edited, 'track count, clip positions, offsets and level are unchanged'); assert.equal(await page.locator('.clip.missing').count(), 0);
  const again = await energy(); assert.ok(Math.abs(again - heard) < heard * 0.01, `the rendered sound is back (${again.toFixed(4)} against ${heard.toFixed(4)} before)`);
  await page.reload(); await page.waitForFunction(() => window.stemStudio); await A(page, SINE); // and by hand: a file with another name, through the clip panel
  await page.click(`.clip[data-id="c-${made.id}"]`); assert.equal(await page.isVisible('#clip-relink'), true);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#clip-relink')]);
  await chooser.setFiles({ name: 'guitar take 2.wav', mimeType: 'audio/wav', buffer: Buffer.from(await A(page, () => [...new Uint8Array(window.__sine(20))])) });
  await page.waitForFunction(() => /back on its own track/.test(document.getElementById('toast').textContent)); assert.deepEqual(await proj(page), edited); assert.equal(await page.isVisible('#clip-relink'), false);
  const [other] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await page.click('#more'); await page.click('#load-stems'); })()]); // a new name still makes a new track
  await other.setFiles({ name: 'Bongos.wav', mimeType: 'audio/wav', buffer: Buffer.from(await A(page, () => [...new Uint8Array(window.__sine(2))])) });
  await page.waitForFunction(() => /loaded as new track/.test(document.getElementById('toast').textContent)); assert.equal((await proj(page)).tracks.length, edited.tracks.length + 1);
  log('stems: after a refresh the same file, or Load its audio on a missing clip, puts the sound back on the edited track; nothing else changes');
  await ctx.close();
}
{ // 2. Looping a short section inside a long stem: each pass stops at the loop end, with a short fade, and copies never stack.
  const { ctx, page } = await open();
  await page.addInitScript(() => { window.__src = []; window.__ramps = []; const st = AudioBufferSourceNode.prototype.start, sp = AudioBufferSourceNode.prototype.stop, lr = AudioParam.prototype.linearRampToValueAtTime;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration) { if (this.buffer && this.buffer.duration > 5) window.__src.push({ when, offset, duration, stops: [], node: this }); return st.call(this, when, offset, duration); };
    AudioBufferSourceNode.prototype.stop = function (when = 0) { const r = window.__src.find(x => x.node === this); if (r) r.stops.push(when); return sp.call(this, when); };
    AudioParam.prototype.linearRampToValueAtTime = function (v, t) { if (v === 0) window.__ramps.push(t); return lr.call(this, v, t); }; });
  await page.reload(); await page.waitForFunction(() => window.stemStudio); await A(page, SINE);
  await A(page, async () => { await window.stemStudio.loadStem('Long take.wav', window.__sine(30)); window.stemStudio.apply({ ops: [{ op: 'set_tempo', bpm: 180 }] }); });
  await page.click('.clip[data-id="c-drums-11"]'); await page.click('#loop'); await page.click('#play'); // the loop is that one-bar clip, bar 12, inside the 30 s stem
  await page.waitForFunction(() => window.__src.length >= 5, null, { timeout: 30000 }); await page.click('#play');
  const recs = await A(page, () => window.__src.map(x => ({ when: x.when, offset: x.offset, duration: x.duration, stops: x.stops }))), ramps = await A(page, () => window.__ramps);
  const bar = 4 * 60 / 180, offset = 11 * bar; // worked by hand: one bar at 180 bpm is 1.3333 s; bar 12 starts 11 bars, 14.667 s, into the stem
  for (const [i, r] of recs.entries()) {
    assert.ok(Math.abs(r.offset - offset) < 1e-6, `pass ${i + 1} starts ${r.offset} s into the stem`); assert.ok(Math.abs(r.duration - bar) < 1e-6, `pass ${i + 1} lasts ${r.duration} s, the loop is ${bar.toFixed(4)} s`);
    if (i) assert.ok(recs[i - 1].when + recs[i - 1].duration <= r.when + 1e-6, `pass ${i} still sounds when pass ${i + 1} starts`);
    assert.ok(ramps.some(t => Math.abs(t - (r.when + r.duration)) < 1e-6), `pass ${i + 1} fades out at the loop end`);
  }
  log(`loop: ${recs.length} passes of a 30 s stem over a one-bar loop, each ${bar.toFixed(3)} s from ${offset.toFixed(3)} s in, no two sounding at once, each fading out at the wrap`);
  await ctx.close();
}
{ // 3. Stem downloads come from one version of the song, even if it is edited while they render; no sound support is handled.
  const { ctx, page } = await open(); await A(page, () => window.stemStudio.apply({ ops: [{ op: 'delete', from: 5, to: 32 }] }));
  const [z] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), (async () => { await page.click('#more'); await page.click('#save-stems'); await A(page, () => window.stemStudio.apply({ ops: [{ op: 'set_tempo', bpm: 180 }] })); })()]);
  const zb = readFileSync(await z.path()), sizes = []; for (let o = 0; zb.readUInt32LE(o) === 0x04034b50;) { const size = zb.readUInt32LE(o + 18), nameLen = zb.readUInt16LE(o + 26); sizes.push(zb.readUInt32LE(o + 30 + nameLen + 40)); o += 30 + nameLen + size; }
  const want = Math.round((8 * 4 * 60 / 112 + 2) * 44100) * 4; // worked by hand: 8 bars at 112 bpm plus the 2 s tail, 16-bit stereo
  assert.deepEqual(sizes, [want, want], 'both stems are the 112 bpm version, though the tempo changed to 180 while they rendered'); assert.equal((await proj(page)).bpm, 180);
  await ctx.close();
  const off = await browser.newContext(); const p2 = await off.newPage(); const errs = []; p2.on('pageerror', e => errs.push(e.message));
  await p2.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; Storage.prototype.setItem = () => { throw new Error('full'); }; });
  await p2.goto(URL); await p2.waitForFunction(() => window.stemStudio); await p2.click('#play');
  assert.match(await p2.textContent('#toast'), /cannot play sound here/); assert.equal(await p2.getAttribute('#play', 'aria-label'), 'Play');
  await p2.click('#bpm-up'); assert.match(await p2.textContent('#toast'), /not keeping your changes/); assert.deepEqual(errs, []);
  await off.close();
  log('stem zip renders one snapshot of the song; with no Web Audio, Play says so; when storage fails, the page says so once');
}
{ // 4. Real autoplay rules: no override flag. A click on Play must still start sound.
  const strict = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }), c2 = await strict.newContext(), p3 = await c2.newPage();
  await p3.goto(URL); await p3.waitForFunction(() => window.stemStudio); await p3.click('#play');
  await p3.waitForFunction(() => window.stemStudio.state().position > 1, null, { timeout: 20000 }); await p3.click('#play'); await strict.close();
  log('without the autoplay override, a click on Play starts the clock');
}
// 5. Every track's controls, the last lane and the editor can be reached by scrolling (wheel), on short screens and with twelve tracks.
async function reach(page, sel, x) {
  for (let i = 0; i < 80; i++) {
    const s = await A(page, ([sel, x]) => { const e = document.querySelector(sel), r = e.getBoundingClientRect(), cx = x === undefined ? r.left + r.width / 2 : x, cy = r.top + r.height / 2;
      const shown = r.top >= -0.5 && r.bottom <= innerHeight + 0.5, hit = shown && document.elementFromPoint(cx, cy);
      if (shown && hit && (e === hit || e.contains(hit))) return { ok: true };
      let a = e.parentElement; while (a && !(/(auto|scroll)/.test(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight)) a = a.parentElement;
      const box = a && a !== document.body && a !== document.documentElement ? a.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      return { ok: false, x: Math.max(1, Math.min(innerWidth - 1, (Math.max(box.left, 0) + Math.min(box.right, innerWidth)) / 2)), y: Math.max(1, Math.min(innerHeight - 1, (Math.max(box.top, 0) + Math.min(box.bottom, innerHeight)) / 2)), dir: r.top < Math.max(box.top, 0) ? -1 : 1 }; }, [sel, x]); // up when the target sits above what its scroll area shows
    if (s.ok) return true; await page.mouse.move(s.x, s.y); await page.mouse.wheel(0, 120 * s.dir); await page.waitForTimeout(40);
  }
  return false;
}
for (const [w, h] of [[320, 568], [740, 360], [640, 400], [400, 800], [1280, 800]]) for (const n of [4, 12]) { // 640 by 400 is a 1280 by 800 screen at 200% zoom
  const { ctx, page } = await open({ viewport: { width: w, height: h } }); await A(page, SINE);
  if (n > 4) await A(page, async n => { for (let i = 4; i < n; i++) await window.stemStudio.loadStem(`Take ${i - 3}.wav`, window.__sine(1)); }, n);
  const ids = (await proj(page)).tracks.map(t => t.id), lost = [], headw = await A(page, () => document.querySelector('.heads').getBoundingClientRect().right);
  for (const id of ids) if (!(await reach(page, `#vol-${CSS_ESC(id)}`))) lost.push('level ' + id);
  for (const sel of ['.lane:last-child', '.lane:first-child']) if (!(await reach(page, sel, headw + 12))) lost.push(sel);
  for (const sel of ['#tab-clip', '#add-clip', '#play', '#more']) if (!(await reach(page, sel))) lost.push(sel);
  await page.click('#tab-arr'); for (const sel of ['#ask', '#plan-go']) if (!(await reach(page, sel))) lost.push(sel);
  assert.deepEqual(lost, [], `out of reach at ${w}x${h} with ${n} tracks`); await ctx.close();
}
log('reach: at 320x568, 740x360, 640x400 (200% zoom), 400x800 and 1280x800, with 4 and 12 tracks, every level slider, the first and last lanes, the editor and the arranger are reached by scrolling');
for (const [w, h] of [[400, 800], [320, 568], [740, 360]]) { // Phones: nothing overflows sideways, controls are finger-sized, taps and drags work.
  const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  const o = await A(page, () => ({ sw: document.documentElement.scrollWidth, w: innerWidth, small: [...document.querySelectorAll('button,select,input:not([type=file]),[role=tab]')].filter(e => e.getClientRects().length).map(e => [e.id || e.textContent.trim().slice(0, 12) || e.getAttribute('aria-label'), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)]).filter(x => x[1] < 24 || x[2] < 24),
    off: [...document.querySelectorAll('.bar button, .bar input, .bar output, .tabs button, .heads button')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map(e => e.id || e.textContent.trim()) }));
  assert.ok(o.sw <= o.w, `sideways overflow at ${w}x${h}`); assert.deepEqual(o.small, [], `small targets at ${w}x${h}`); assert.deepEqual(o.off, [], `controls off screen at ${w}x${h}`);
  assert.ok(await A(page, () => { const r = document.getElementById('vol-drums').getBoundingClientRect(); return r.width > 40 && r.height >= 24 && r.right <= innerWidth; }), `no level control at ${w}x${h}`);
  assert.equal(await A(page, () => getComputedStyle(document.querySelector('.clip:not(.sel)')).touchAction), 'pan-x', 'a swipe on a clip must still scroll the arrangement');
  await page.tap('button[aria-label="Solo Keys"]'); assert.equal((await proj(page)).tracks[2].solo, true); await page.tap('#tab-arr'); await page.tap('.chip:has-text("Cut the intro")'); assert.equal((await proj(page)).bars, 28);
  await ctx.close();
}
log('phones 400x800, 320x568 and 740x360: no sideways overflow, targets 24 px or more, taps work');
await browser.close();
if (errors.length) { console.log('CONSOLE PROBLEMS\n' + [...new Set(errors)].join('\n')); process.exit(1); }
console.log('ok  zero console errors, warnings or failed requests');
