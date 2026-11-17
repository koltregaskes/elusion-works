// Browser checks for One light-day. Usage: node smoke.mjs <path-to-axe.min.js> [base-url]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const axeSrc = fs.readFileSync(process.argv[2], 'utf8'), base = process.argv[3] || 'http://127.0.0.1:8776', url = base + '/demos/light-day/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }), problems = [], requests = [], done = [];

// The figures, worked out here again from the two constants and the distances a reader can look up. Nothing is read from the page's own module.
const c = 299792.458, au = 149597870.7, day = 86400;
const MARKS = [['moon', 'The Moon', 384400], ['sun', 'The Sun’s distance', au], ['mars', 'Mars’s orbit', 1.52 * au], ['jupiter', 'Jupiter’s orbit', 5.2 * au], ['saturn', 'Saturn’s orbit', 9.5 * au], ['uranus', 'Uranus’s orbit', 19.2 * au], ['neptune', 'Neptune’s orbit', 30.1 * au], ['pluto', 'Pluto’s average distance', 39.5 * au], ['shock', 'The termination shock', 94 * au], ['pause', 'The heliopause', 122 * au], ['voyager2', 'Voyager 2’s distance', 145 * au], ['voyager1', 'Voyager 1', c * day]].map(([id, name, km]) => ({ id, name, km, t: km / c }));
const words = s => { if (s < 9.95) return s.toFixed(1) + ' s'; if (s < 59.5) return Math.round(s) + ' s'; if (s < 3599.5) { const w = Math.round(s); return w % 60 ? `${(w - w % 60) / 60} min ${w % 60} s` : `${w / 60} min`; } const m = Math.round(s / 60); return m % 60 ? `${(m - m % 60) / 60} h ${m % 60} min` : `${m / 60} h`; };
const face = s => { const w = Math.floor(s + 1e-6), two = n => String(n).padStart(2, '0'); return `${two(Math.floor(w / 3600))}:${two(Math.floor(w % 3600 / 60))}:${two(w % 60)}` + (s < 10 ? '.' + two(Math.floor((s - Math.floor(s)) * 100)) : ''); };
const commas = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','), far = n => n < 1e6 ? commas(n) + ' km' : n < 1e9 ? (n / 1e6).toFixed(n < 1e7 ? 2 : n < 1e8 ? 1 : 0) + ' million km' : (n / 1e9).toFixed(n < 1e10 ? 2 : 1) + ' billion km';
const part = s => { const p = s / day * 100; return p < 0.01 ? 'under 0.01%' : p < 1 ? p.toFixed(2) + '%' : p < 99.95 ? p.toFixed(1) + '%' : '100%'; };

async function open(w, h, o = {}) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!o.touch, isMobile: !!o.touch, reducedMotion: o.reduced ? 'reduce' : 'no-preference', javaScriptEnabled: !o.nojs }), p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${w}x${h}: ${m.text()}`); }); p.on('pageerror', e => problems.push(`${w}x${h}: ${e}`)); p.on('request', r => requests.push(r.url())); await p.goto(url); if (!o.nojs) await p.waitForFunction(() => window.lightDay); return p; }
const state = p => p.evaluate(() => window.lightDay.state()), go = (p, t) => p.evaluate(t => window.lightDay.goto(t), t), text = (p, sel) => p.evaluate(s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), sel);
const axe = async (p, label) => { await p.evaluate(axeSrc); const r = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })); assert.equal(r.violations.length, 0, `${label}: axe: ${r.violations.map(v => `${v.id} (${v.nodes.length}: ${v.nodes[0].target})`).join('; ')}`); };
// The page as laid out: nothing wider than the screen, no card on top of another, every card narrow enough to read.
const layout = async (p, label) => { const bad = await p.evaluate(() => { const out = [], vw = document.documentElement.clientWidth, top = e => e.getBoundingClientRect().top + scrollY; if (document.documentElement.scrollWidth > vw + 1) out.push(`page is ${document.documentElement.scrollWidth} wide in a ${vw} window`);
  const cards = [...document.querySelectorAll('.card, .hour')].map(e => ({ name: (e.id || e.textContent.trim().slice(0, 14)), a: top(e), b: top(e) + e.offsetHeight, l: e.getBoundingClientRect().left, r: e.getBoundingClientRect().right, tall: e.offsetHeight })).sort((x, y) => x.a - y.a);
  for (let i = 1; i < cards.length; i++) if (cards[i].a < cards[i - 1].b + 8 && cards[i].l < cards[i - 1].r && cards[i - 1].l < cards[i].r) out.push(`${cards[i].name} starts ${Math.round(cards[i - 1].b - cards[i].a)} px before ${cards[i - 1].name} ends`);
  for (const k of cards) { if (k.l < -1 || k.r > vw + 1) out.push(`${k.name} is off the side`); if (k.name !== '' && k.tall > innerHeight * 0.95 && !/^Hour/.test(k.name) && k.a > 10) out.push(`${k.name} is ${k.tall} px tall in a ${innerHeight} px window`); }
  const track = document.getElementById('track'), lastCard = cards[cards.length - 1]; if (lastCard.b > track.offsetTop + track.offsetHeight) out.push('the last card runs out of the journey and over the next section');
  for (const b of document.querySelectorAll('a, button, summary')) { const r = b.getBoundingClientRect(); if (r.width && !b.closest('p, li span, caption') && (r.width < 24 || r.height < 24)) out.push(`"${b.textContent.trim().slice(0, 16)}" is ${Math.round(r.width)}x${Math.round(r.height)}`); } return out; }); assert.deepEqual(bad, [], `${label}: ${bad.join('; ')}`); };
// What the picture drew: names inside the picture and clear of each other, every ring where arithmetic puts it.
const picture = async (p, label) => { const s = await state(p), gap = s.geo.portrait ? 16 : 24; for (const l of s.labels) { assert.ok(l.x0 >= -1 && l.x1 <= s.geo.edge + 1 && l.y0 >= -1 && l.y1 <= s.H + 1, `${label}: the name for ${l.id} runs out of the picture (${Math.round(l.x0)} to ${Math.round(l.x1)}, edge ${Math.round(s.geo.edge)})`); for (const o of s.labels) if (o !== l) assert.ok(Math.abs(o.R - l.R) >= gap - 1e-6, `${label}: the names for ${l.id} and ${o.id} collide`); }
  const span = Math.max(s.t * c / s.view.at || 0, 6371 / 0.06); for (const r of s.rings) { const m = MARKS.find(x => x.id === r.id); assert.ok(Math.abs(r.R - m.km / span * s.geo.L) < 0.02 + r.R * 1e-6, `${label}: the ring for ${r.id} is ${r.R} px out, arithmetic says ${m.km / span * s.geo.L}`); assert.equal(r.crossed, m.t <= s.t + 1e-6, `${label}: ${r.id} crossed?`); } return s; };
const colours = async p => { const shot = (await p.screenshot({ type: 'png' })).toString('base64'); return p.evaluate(async b64 => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()), cv = new OffscreenCanvas(160, 100), g = cv.getContext('2d'); g.drawImage(bmp, 0, 0, 160, 100); const d = g.getImageData(0, 0, 160, 100).data, seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3)); return seen.size; }, shot); };

{ const p = await open(1280, 800); await p.waitForTimeout(500);
  // As it opens: the title card, nothing moving, and the site's rule about the Tab key.
  let s = await state(p); assert.equal(s.t, 0); assert.equal(s.y, 0); assert.equal(await p.evaluate(() => document.getElementById('hud').style.opacity), '0', 'the clock is out of the way of the title');
  assert.equal(await p.evaluate(() => document.activeElement.tagName), 'BODY', 'nothing takes the focus as the page opens');
  for (let k = 0; k < 3; k++) { await p.keyboard.press('Tab'); const f = await p.evaluate(() => { const n = document.activeElement, r = n.getBoundingClientRect(); return { tag: n.tagName, ok: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight }; }); assert.ok(f.ok && f.tag !== 'BODY', 'Tab lands on something you can see'); }
  await p.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); }); assert.ok(await colours(p) > 12, 'the picture is drawn');
  { const h = await p.evaluate(() => { const r = document.querySelector('.hero').getBoundingClientRect(); return { bottom: r.bottom, right: r.right }; }); assert.ok(h.bottom < s.earth.y - s.earth.r - 4, `the title (down to ${Math.round(h.bottom)}) sits on Earth (top ${Math.round(s.earth.y - s.earth.r)})`); }
  await axe(p, 'title'); await layout(p, '1280x800');
  done.push('opens on the title card with nothing moving and nothing focused; Tab lands on visible things; the title is clear of Earth');

  // Every mark: go to its time. The flash is exactly on its ring, the clock and the distance read what arithmetic says, and its card is on screen saying the same time.
  for (const m of MARKS) { s = await go(p, m.t); assert.ok(Math.abs(s.t - m.t) < 1e-9 * Math.max(1, m.t), `at ${m.id} the time is ${s.t}, not ${m.t}`); const ring = s.rings.find(r => r.id === m.id); assert.ok(ring && Math.abs(ring.R - s.wave) < 0.01, `${m.id}: the flash is ${s.wave} px out and the ring ${ring?.R}`);
    assert.equal(await text(p, '#clock'), face(m.t), `${m.id}: the clock`); assert.equal(await text(p, '#dist-km'), far(m.km), `${m.id}: the distance`); assert.equal(await text(p, '#togo'), m.id === 'voyager1' ? 'reached' : words(day - m.t), `${m.id}: time to go`);
    assert.ok(Math.abs(parseFloat(await p.evaluate(() => document.getElementById('day-fill').style.width)) - m.t / day * 100) < 1e-3, `${m.id}: the day bar`);
    const card = await p.evaluate(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, y: parseFloat(e.style.getPropertyValue('--y')), when: e.querySelector('.when').textContent, mark: e.dataset.mark, hud: document.getElementById('hud').getBoundingClientRect().right }; }, m.id);
    assert.equal(card.when, words(m.t), `${m.id}: the card says ${card.when}`); assert.equal(card.mark, m.id); assert.ok(Math.abs(card.y - s.y) < 0.002, `${m.id}: the card is placed for ${card.y} screens but the mark is at ${s.y}`); assert.ok(card.top >= 0 && card.bottom <= 800, `${m.id}: its card is not wholly on screen (${Math.round(card.top)} to ${Math.round(card.bottom)})`); assert.ok(card.left > card.hud + 8, 'a card covers the clock');
    await picture(p, m.id); const lab = s.labels.find(l => l.id === m.id); assert.ok(lab, `${m.id}: the mark the flash is on has lost its name`); }
  assert.ok(s.voyager && Math.abs(Math.hypot(s.voyager.x - s.earth.x, s.voyager.y - s.earth.y) - s.wave) < 0.01, 'at the end the flash is on Voyager 1'); assert.ok(Math.abs(s.view.span * 0.92 - c * day) < 1, 'and the line is a light-day long');
  done.push('all twelve marks: the flash exactly on the ring, clock, distance, time to go and day bar as arithmetic says, the card on screen with the same time, names clear of each other');

  // Scrolling by hand: time only goes forwards, and the picture stays right all the way.
  await p.evaluate(() => scrollTo(0, 0)); let prev = -1, steps = 0; const end = await p.evaluate(() => document.getElementById('track').offsetHeight - innerHeight);
  for (let yy = 0; yy <= end; yy += 137) { await p.evaluate(v => window.lightDay.gotoY(v / innerHeight), yy); s = await picture(p, `scroll ${yy}`); assert.ok(s.t >= prev, `time ran backwards at ${yy}`); assert.ok(s.wave <= s.geo.L * 0.92 + 0.01, 'the flash ran off the end of the line'); prev = s.t; steps++; if (steps % 12 === 0) assert.equal(await text(p, '#clock'), face(s.t)); }
  assert.equal(prev, day); assert.equal(await text(p, '#clock'), '24:00:00'); assert.equal(await text(p, '#dist-km'), '25.9 billion km'); assert.equal(await text(p, '#dist-au'), '173.1 AU');
  await p.mouse.move(600, 400); await p.evaluate(() => scrollTo(0, 0)); for (let i = 0; i < 6; i++) await p.mouse.wheel(0, 300); await p.waitForTimeout(200); s = await state(p); assert.ok(s.t > 0 && s.y > 2, 'the wheel moves the flash');
  done.push(`${steps} scroll positions from top to bottom: time never runs back, every ring where arithmetic puts it, the wheel works`);

  // The jump links land exactly on their marks.
  for (const [id, t] of [['moon', MARKS[0].t], ['sun', MARKS[1].t], ['neptune', MARKS[6].t], ['dark', 8 * 3600], ['voyager1', day]]) { await p.evaluate(() => scrollTo(0, 0)); await p.click(`.jump a[href="#${id}"]`); await p.waitForTimeout(120); s = await state(p); assert.ok(Math.abs(s.t - t) <= Math.max(0.02, t * 2e-3), `the link to ${id} lands at ${s.t} s, not ${t}`); assert.ok(await p.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, id)); }
  await p.evaluate(() => scrollTo(0, 0)); await p.click('.jump a[href="#after"]'); await p.waitForTimeout(120); assert.ok(await p.evaluate(() => Math.abs(document.getElementById('after').getBoundingClientRect().top) < 2));
  await axe(p, 'after'); await p.evaluate(() => { scrollTo(0, 0); document.querySelector('.skip').focus(); }); assert.ok(await p.evaluate(() => { const r = document.querySelector('.skip').getBoundingClientRect(); return r.top >= 0 && r.left >= 0; }), 'the skip link shows when it has the focus'); await p.keyboard.press('Enter'); await p.waitForTimeout(120); assert.equal((await state(p)).t, day, 'the skip link goes to the arrival');
  done.push('the jump links and the skip link land exactly on their marks');

  // The table and the closing figures, against the same arithmetic.
  const rows = await p.$$eval('#rows tr', trs => trs.map(tr => [...tr.children].map(td => td.textContent.trim()))); assert.equal(rows.length, 12);
  MARKS.forEach((m, i) => assert.deepEqual(rows[i], [m.name, far(m.km), (m.km / au < 0.095 ? (m.km / au).toFixed(4) : (m.km / au).toFixed(m.km / au < 9.95 ? 2 : 1)), words(m.t), part(m.t)], `the table row for ${m.id}`));
  const stats = await p.$$eval('.stats b', bs => bs.map(b => b.textContent)); assert.deepEqual(stats, ['49 years', '2 days', '17,500 times', '48 years', '20 hours', '1,550 days']);
  { const yrs = (Date.UTC(2026, 10, 18) - Date.UTC(1977, 8, 5)) / (365.2425 * 86400e3), v = 3.6 * au / (365.25 * 86400); assert.equal(Math.floor(yrs), 49); assert.equal(Math.round(c / v / 500) * 500, 17500); assert.equal(Math.round(c * day / au / 3.6), 48); assert.equal(Math.round(4.2465 * 365.25 / 10) * 10, 1550); assert.equal(Math.round(v), 17); assert.equal(words(day - MARKS[6].t), '19 h 50 min'); }
  const body = await p.evaluate(() => document.body.innerText); assert.ok(!/[—–]/.test(body), 'a dash crept into the words'); assert.ok(body.includes('25,902,068,371 kilometres') && commas(c * day) === '25,902,068,371');
  done.push('the table (12 rows, 5 columns) and the six closing figures match arithmetic done here');

  // The day bar and the empty hours.
  const ticks = await p.$$eval('#day-ticks i', is => is.map(i => i.style.left)); assert.equal(ticks.length, 12); MARKS.slice(0, 11).forEach((m, i) => assert.ok(Math.abs(parseFloat(ticks[i]) - m.t / day * 100) < 1e-3));
  const hours = await p.$$eval('.hour', hs => hs.map(h => ({ words: h.textContent, hidden: h.getAttribute('aria-hidden'), y: parseFloat(h.style.getPropertyValue('--y')) }))); assert.deepEqual(hours.map(h => h.words), [7, 10, 11, 12, 15, 16, 19, 22, 23].map(h => `Hour ${h}. Nothing.`)); assert.ok(hours.every(h => h.hidden === 'true'));
  hours.forEach((h, i) => assert.ok(Math.abs(h.y - (10.5 + ([7, 10, 11, 12, 15, 16, 19, 22, 23][i] - 6) * 0.42)) < 1e-9, 'an empty hour is in the wrong place'));
  done.push('the day bar has a tick for every mark where it falls; nine empty hours are marked, to scale, and kept from screen readers');

  // Real speed: a second on the page is a second of light. Stop, Escape or scrolling takes it back.
  await p.evaluate(() => document.getElementById('go').scrollIntoView()); await p.click('#real'); const t0 = Date.now(); assert.ok((await state(p)).real); assert.ok(await p.isVisible('#chip')); assert.equal(await p.evaluate(() => document.activeElement.id), 'stop');
  await p.waitForTimeout(1600); s = await state(p); const el = (Date.now() - t0) / 1000; assert.ok(s.t > el - 0.7 && s.t < el + 0.1, `after ${el.toFixed(2)} s of real time the flash has travelled ${s.t.toFixed(2)} s`); assert.ok(s.rings.find(r => r.id === 'moon').crossed, 'at real speed the Moon is passed in the second second'); assert.match(await text(p, '#chip-text'), /^Real speed\. The Sun’s distance in 8 min 1\d s\.$/);
  await p.keyboard.press('Escape'); assert.equal((await state(p)).real, false); assert.ok(!(await p.isVisible('#chip'))); assert.equal(await p.evaluate(() => document.activeElement.id), 'real', 'Escape hands the focus back');
  await p.click('#real'); await p.waitForTimeout(300); await p.click('#stop'); assert.equal((await state(p)).real, false); await p.click('#real'); await p.waitForTimeout(300); await p.mouse.wheel(0, 200); await p.waitForTimeout(100); assert.equal((await state(p)).real, false, 'the wheel takes over'); const after = (await state(p)).t; await p.waitForTimeout(400); assert.equal((await state(p)).t, after, 'and nothing moves once it has');
  await p.click('#real'); await p.waitForTimeout(300); await p.evaluate(() => scrollTo(0, 5000)); await p.waitForTimeout(150); assert.equal((await state(p)).real, false, 'dragging the scroll bar takes over');
  done.push('real speed keeps time with the clock on the wall, passes the Moon in the second second, and gives way to Stop, Escape, the wheel or the scroll bar');

  // Resizing mid-journey keeps everything true.
  await p.setViewportSize({ width: 1024, height: 700 }); await p.waitForTimeout(150); s = await go(p, MARKS[4].t); assert.ok(Math.abs(s.rings.find(r => r.id === 'saturn').R - s.wave) < 0.01); await picture(p, 'resized'); await layout(p, '1024x700'); await axe(p, 'resized');
  await p.context().close(); }

// Other windows: wide, very wide, a plain narrow window, phones upright and on their side.
for (const [w, h, touch] of [[1920, 1080], [2560, 1080], [320, 640], [390, 800, true], [320, 568, true], [740, 360, true]]) { const p = await open(w, h, { touch }), label = `${w}x${h}`; await layout(p, label); await axe(p, label + ' title');
  let s = await state(p); if (!s.geo.portrait) { const hb = await p.evaluate(() => document.querySelector('.hero').getBoundingClientRect().bottom); assert.ok(hb < s.earth.y - s.earth.r - 2, `${label}: the title (down to ${Math.round(hb)}) sits on Earth (top ${Math.round(s.earth.y - s.earth.r)})`); }
  else { const ht = await p.evaluate(() => document.querySelector('.hero').getBoundingClientRect().top); assert.ok(ht > s.earth.y + s.geo.L, `${label}: the title sits on the line`); }
  for (const m of MARKS) { s = await go(p, m.t); assert.ok(Math.abs(s.t - m.t) < 1e-9 * Math.max(1, m.t), `${label}: at ${m.id} the time is ${s.t}`); assert.ok(Math.abs(s.rings.find(r => r.id === m.id).R - s.wave) < 0.01); await picture(p, `${label} ${m.id}`); assert.equal(await text(p, '#clock'), face(m.t));
    const r = await p.evaluate(id => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, hud: document.getElementById('hud').getBoundingClientRect(), bar: document.getElementById('daybar').getBoundingClientRect() }; }, m.id); assert.ok(r.top >= 0 && r.top < h * 0.7, `${label}: the card for ${m.id} starts at ${Math.round(r.top)}`);
    if (s.geo.portrait) { assert.ok(r.top >= s.earth.y + s.geo.L, `${label}: the card for ${m.id} covers the line`); assert.ok(s.earth.y - s.earth.r > r.bar.bottom, `${label}: Earth is under the day bar`); assert.ok(r.hud.right <= w && r.bar.right <= w && r.hud.bottom <= r.bar.top + 1, `${label}: the clock and the day bar collide`); } }
  await axe(p, label + ' arrival'); await p.evaluate(() => document.getElementById('table-h').scrollIntoView()); await layout(p, label + ' table'); await p.context().close(); }
done.push('1920x1080, 2560x1080, a plain 320 window, phones 390x800 and 320x568, and 740x360 on its side: all twelve marks true, names inside the picture, cards clear of the line, no sideways scroll');

// With motion kept down there is no real-speed button (it scrolls the page by itself); everything else is the same.
{ const p = await open(1280, 800, { reduced: true }); assert.ok(!(await p.isVisible('#real'))); const s = await go(p, MARKS[1].t); assert.equal(await text(p, '#clock'), '00:08:19'); assert.ok(Math.abs(s.rings.find(r => r.id === 'sun').R - s.wave) < 0.01); await axe(p, 'reduced motion'); await p.context().close(); done.push('with motion kept down the real-speed button is gone and the rest works'); }
// Without scripts the words are all there: title, every card with its time, the table. No dead controls.
{ const p = await open(1280, 800, { nojs: true }); assert.ok(await p.isVisible('h1')); assert.equal(await p.locator('.card:visible').count(), 15); assert.ok(!(await p.isVisible('#real')) && !(await p.isVisible('#hud')) && !(await p.isVisible('#chip')) && !(await p.isVisible('#daybar'))); assert.equal(await p.locator('#rows tr').count(), 12); await layout(p, 'no scripts'); await p.context().close(); done.push('without scripts every card and the table can still be read, and no dead control shows'); }
await browser.close();
const outside = requests.filter(u => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')); assert.deepEqual(outside, [], 'requests left the page: ' + outside.join(', ')); assert.deepEqual(problems, [], 'console problems:\n' + problems.join('\n'));
console.log('ok  ' + done.join('\nok  ') + '\nok  axe WCAG 2.2 A and AA clean at the title, the arrival and the figures in every window; no console errors; no request left the page');
