// Browser checks for Site Pulse. Usage: node smoke.mjs <path-to-axe.min.js> [base-url]
// What this proves: that the page shows, for every choice of range and sites, exactly the figures summarise() gives, and that
// the controls, charts and tables behave. It does NOT prove summarise() is right: that is data.test.mjs, which works the
// figures out again from the raw arrays with separate code.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeData, summarise, fmt, WEEKDAYS, RANGES } from '../js/data.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const axeSrc = fs.readFileSync(process.argv[2], 'utf8'), base = process.argv[3] || 'http://127.0.0.1:8774', url = base + '/demos/site-pulse/';
const data = makeData(), ALL = data.sites.map(s => s.id), span = n => RANGES.find(r => r[0] === n)[1];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }); const problems = [], requests = [], done = [];
async function open(w, h, opts = {}) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!opts.touch, isMobile: !!opts.touch, javaScriptEnabled: !opts.noScript }); const p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${w}x${h}: ${m.text()}`); }); p.on('pageerror', e => problems.push(`${w}x${h}: ${e}`)); p.on('request', r => requests.push(r.url())); await p.goto(url); if (!opts.noScript) await p.waitForFunction(() => window.sitePulse); return p; }
const axe = async (p, label) => { await p.evaluate(axeSrc); const r = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })); assert.equal(r.violations.length, 0, `${label}: axe: ${r.violations.map(v => `${v.id} (${v.nodes.length}: ${v.nodes[0].target})`).join('; ')}`); };
const layout = async (p, label) => { const bad = await p.evaluate(() => { const out = [], vw = innerWidth; if (document.documentElement.scrollWidth > vw + 1) out.push(`page is ${document.documentElement.scrollWidth} wide`);
  for (const b of document.querySelectorAll('button')) { const r = b.getBoundingClientRect(); if (!r.width) continue; if (r.width < 24 || r.height < 24) out.push(`button "${b.textContent.trim()}" is ${Math.round(r.width)}x${Math.round(r.height)}`); if (!b.closest('.scroll') && (r.left < -1 || r.right > vw + 1)) out.push(`button "${b.textContent.trim()}" off the side`); }
  for (const c of document.querySelectorAll('.card, .tile, #filters')) { const r = c.getBoundingClientRect(); if (r.left < -1 || r.right > vw + 1) out.push(`${c.id || c.className} off the side`); }
  for (const t of document.querySelectorAll('.tile .value, h2, .bars .name')) if (t.scrollWidth > t.clientWidth + 1) out.push(`"${t.textContent}" is cut off`);
  // Every card and every tile says its figures are sample data, so a cropped screenshot still does.
  for (const c of document.querySelectorAll('.card, .tile')) { const m = c.querySelector('.sample'); if (!m || !m.getBoundingClientRect().width || !/sample/i.test(m.textContent)) out.push(`${c.id || c.querySelector('.label span').textContent} carries no sample-data mark`); }
  if (!document.querySelector('.tag').getBoundingClientRect().width) out.push('the sample-data tag is hidden'); return out; }); assert.deepEqual(bad, [], `${label}: ${bad.join('; ')}`); };
const text = (p, sel) => p.evaluate(s => document.querySelector(s).textContent.trim(), sel);
const texts = (p, sel) => p.$$eval(sel, els => els.map(e => e.textContent.trim()));
const set = (p, o) => p.evaluate(o => window.sitePulse.set(o), o), state = p => p.evaluate(() => window.sitePulse.state());
const signed = (x, unit) => (unit ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(2)} ${unit}` : fmt.delta(x)), avg = v => fmt.int(Math.round(v));
const STATE = { healthy: 'Healthy', slow: 'Slow', outage: 'Had an outage' };
// Read every figure the page shows and compare it with what summarise() gives for that choice of range and sites.
async function agrees(p, range, sites, label) { const v = summarise(data, { range, sites }), t = v.totals, none = sites.length === 0, dash = '–';
  assert.equal(await text(p, '.tile.hero .value'), fmt.int(t.visits), `${label}: headline`); assert.equal(await text(p, '.tile.hero .label span'), `Visits, last ${span(range)}`);
  assert.deepEqual(await texts(p, '.tile:not(.hero) .value'), none ? ['0', dash, dash, dash, dash] : [fmt.compact(t.visitors), t.perVisit.toFixed(2), fmt.secs(t.stay), fmt.load(t.load), fmt.pct(t.uptime, 2)], `${label}: tiles`);
  const want = none ? [fmt.delta(0), fmt.delta(0)] : [signed(v.delta.visits), signed(v.delta.visitors), signed(v.delta.perVisit), signed(v.delta.stay), signed(v.delta.load), signed(v.delta.uptime, 'points')], got = await texts(p, '.tile .delta'); assert.equal(got.length, want.length, `${label}: ${got.length} changes shown`); want.forEach((w, i) => assert.ok(got[i].includes(w), `${label}: change ${i} reads "${got[i]}", not ${w}`));
  assert.ok((await text(p, '#period')).startsWith(`${fmt.day(v.from)} to ${fmt.day(v.to)} 2026`));
  if (!none) { const order = v.sites; assert.deepEqual(await texts(p, '#table tbody th'), order.map(s => s.name), `${label}: sites in the table`); assert.deepEqual(await texts(p, '#table tbody td:nth-child(3)'), order.map(s => fmt.int(s.visits)), `${label}: visits in the table`); assert.deepEqual(await texts(p, '#table tbody td:nth-child(4)'), order.map(s => ((s.delta === null || Math.abs(s.delta) < 0.0005 ? '' : s.delta > 0 ? '▲ ' : '▼ ') + fmt.delta(s.delta))));
    assert.deepEqual(await texts(p, '#table tbody td:nth-child(6)'), order.map(s => `${s.topSource} ${fmt.pct(s.topShare)}`)); assert.deepEqual(await texts(p, '#table tbody td:nth-child(7)'), order.map(s => fmt.load(s.load))); assert.deepEqual(await texts(p, '#table tbody td:nth-child(8)'), order.map(s => fmt.pct(s.uptime, 2)));
    assert.deepEqual(await texts(p, '#table tbody td:nth-child(2)'), order.map(s => STATE[s.status] + (s.outage && s.slow ? 'Slow' : '')), `${label}: states`); assert.deepEqual(await texts(p, '#table tbody td:nth-child(9)'), order.map(s => (s.deploy ? `${s.deploy.ok ? 'Fine' : 'Failed'}, ${fmt.day(s.deploy.date)}` : 'None in this period')), `${label}: last deploys`); }
  assert.deepEqual(await texts(p, '#sources .name'), v.sources.map(s => s.name)); assert.deepEqual(await p.$$eval('#sources .fig', els => els.map(e => e.firstChild.textContent)), v.sources.map(s => fmt.int(s.visits)), `${label}: sources`);
  const pcts = await p.$$eval('#sources .fig small', els => els.map(e => parseInt(e.textContent, 10))); assert.deepEqual(pcts, v.sources.map(s => s.pct)); assert.equal(pcts.reduce((a, b) => a + b, 0), none ? 0 : 100, `${label}: the source percentages on screen add up to ${pcts.reduce((a, b) => a + b, 0)}`);
  const dev = await p.$$eval('#devices .fig', els => els.map(e => parseInt(e.firstChild.textContent, 10))); assert.deepEqual(dev, v.devices.map(s => s.pct)); assert.equal(dev.reduce((a, b) => a + b, 0), none ? 0 : 100);
  assert.deepEqual(await texts(p, '#pages tbody td:nth-child(3)'), v.pages.slice(0, 10).map(x => fmt.int(x.views)), `${label}: pages`);
  assert.equal(await p.locator('#deploys .list li').count(), Math.max(1, Math.min(8, v.deploys.length))); assert.equal(await p.locator('#notes .list li').count(), Math.max(1, Math.min(7, v.notes.length)));
  if (v.notes.length) assert.deepEqual(await p.$$eval('#notes .list li .wrap', els => els.map(e => e.lastChild.textContent)), v.notes.slice(0, 7).map(n => n.text), `${label}: the notes, in order`);
  // The two drawn charts, read through their table views: every day and every hour.
  for (const id of ['trend', 'heat']) if ((await p.getAttribute(`#${id} .astable`, 'aria-pressed')) !== 'true') await p.click(`#${id} .astable`);
  assert.deepEqual(await p.$$eval('#trend tbody tr', rows => rows.map(r => [...r.children].map(c => c.textContent))), v.series.map(d => [fmt.day(d.date), fmt.int(d.visits), fmt.day(d.beforeDate), fmt.int(d.before)]), `${label}: the daily table`);
  assert.deepEqual(await p.$$eval('#heat tbody tr', rows => rows.map(r => [...r.children].slice(1).map(c => c.textContent))), Array.from({ length: 24 }, (_, h) => v.heat.map(r => avg(r[h]))), `${label}: the week grid as a table`);
  for (const id of ['trend', 'heat']) { await p.click(`#${id} .astable`); assert.equal(await p.getAttribute(`#${id} .astable`, 'aria-pressed'), 'false'); assert.equal(await text(p, `#${id} .astable`), 'Table view', 'the button keeps one name; only its pressed state changes'); }
  // Every square of the week grid has the shade its value calls for: five steps between the quietest hour and the busiest.
  const flat = v.heat.flat(), hi = Math.max(...flat), lo = Math.min(...flat), shade = x => (x <= 0 ? 0 : hi <= lo ? 3 : Math.min(5, Math.max(1, 1 + Math.floor((x - lo) / (hi - lo) * 5 - 1e-9))));
  assert.deepEqual(await p.$$eval('#heat .cells rect', rs => rs.map(r => r.getAttribute('fill'))), flat.map(x => `var(--h${shade(x)})`), `${label}: the shading of the week grid`); assert.equal(await p.locator('#heat .scale').count(), hi > 0 ? 1 : 0, 'no scale is shown for an empty grid');
  if (hi > 0) assert.ok((await text(p, '#heat .scale')).includes(`from ${avg(lo)} to ${avg(hi)} visits in the hour`));
  assert.equal(await p.locator('#trend svg path').count(), 3); assert.ok(!/NaN|undefined|Infinity|null/.test(await p.evaluate(() => document.querySelector('main').innerText)), `${label}: a broken number is on the page`); return v; }

{ const p = await open(1440, 900);
  // As it opens: flagged as sample data everywhere, four weeks, all eight sites, and the repo's Tab rule.
  assert.equal(await text(p, '.tag'), 'Sample data'); assert.match(await p.title(), /sample data/i); assert.match(await text(p, 'footer'), /Every number on this page is made up/);
  for (let k = 0; k < 3; k++) { await p.keyboard.press('Tab'); const f = await p.evaluate(() => { const n = document.activeElement, r = n.getBoundingClientRect(); return { tag: n.tagName, ok: r.width > 0 && r.height > 0 }; }); assert.ok(f.ok && f.tag !== 'BODY'); }
  await agrees(p, 28, ALL, 'as it opens'); await axe(p, '1440 charts'); await layout(p, '1440');
  done.push('opens on four weeks and all eight sites; every card and tile is marked as sample data; every figure matches');

  let n = 0; for (const [range] of RANGES) for (const sites of [ALL, ['kols-korner'], ['news-atlas', 'axy-lusion', 'stackscout'], []]) { await set(p, { range, sites }); await agrees(p, range, sites, `${range} days, ${sites.length} sites`); await layout(p, `${range} days, ${sites.length} sites`); n++; }
  assert.match(await text(p, '#table tbody'), /No sites are chosen/); assert.equal(await text(p, '.tile.hero .value'), '0');
  done.push(`${n} combinations of range and sites: headline, all six changes, table columns, sources, devices, pages, notes in order, every day, and all 168 hours with their shading`);

  // The filters themselves.
  await set(p, { range: 28, sites: ALL }); await p.click('#range [data-range="7"]'); assert.equal((await state(p)).range, 7); assert.equal(await p.getAttribute('#range [data-range="7"]', 'aria-checked'), 'true'); assert.equal(await p.getAttribute('#range [data-range="28"]', 'aria-checked'), 'false');
  await p.keyboard.press('ArrowRight'); assert.equal((await state(p)).range, 28, 'arrow keys move between ranges'); assert.equal(await p.evaluate(() => document.activeElement.dataset.range), '28'); assert.deepEqual(await p.$$eval('#range button', bs => bs.map(b => b.tabIndex)), [-1, 0, -1]);
  await p.click('#sites [data-site="news-atlas"]'); let st = await state(p); assert.equal(st.sites.length, 7); assert.equal(await p.getAttribute('#sites [data-site="news-atlas"]', 'aria-pressed'), 'false'); assert.equal(await p.getAttribute('#all-sites', 'aria-pressed'), 'false'); await agrees(p, 28, st.sites, 'seven sites');
  await p.click('#all-sites'); assert.equal((await state(p)).sites.length, 8);
  await p.click('[data-only="stackscout"]'); st = await state(p); assert.deepEqual(st.sites, ['stackscout']); assert.equal(await p.evaluate(() => document.activeElement.dataset.only), 'stackscout', 'the focus stays on the site you pressed'); assert.match(await text(p, '#period'), /StackScout/);
  await p.click('[data-only="stackscout"]'); assert.equal((await state(p)).sites.length, 8, 'pressing the only site again brings them all back');
  assert.match(await text(p, '#live'), /visits in the last 4 weeks across all eight sites/);
  assert.ok(await p.evaluate(() => { try { window.sitePulse.set({ range: 14 }); return false; } catch (e) { return window.sitePulse.state().range === 28; } }), 'a range that is not offered is refused and nothing changes');
  done.push('filters: range by click and arrow keys, site chips, All sites, a site name that shows only that site; a bad range is refused');

  // Sorting: every sortable column, both ways, against an order worked out here. Ties always run A to Z.
  const v28 = summarise(data, { range: 28 }), RANK = { outage: 0, slow: 1, healthy: 2 }, col = { name: [1, s => s.name.toLowerCase()], status: [2, s => RANK[s.status] - (s.outage && s.slow ? 0.5 : 0)], visits: [3, s => s.visits], delta: [4, s => s.delta], topSource: [6, s => s.topSource], load: [7, s => s.load], uptime: [8, s => s.uptime], deploy: [9, s => (s.deploy ? s.deploy.daysAgo : Infinity)] };
  const sorted = (f, dir) => [...v28.sites].sort((a, b) => { const x = f(a), y = f(b), c = x < y ? -1 : x > y ? 1 : 0; return (dir === 'ascending' ? c : -c) || a.name.localeCompare(b.name); }).map(s => s.name);
  for (const [key, [nth, f]] of Object.entries(col)) { await p.click(`[data-sort="${key}"]`); const first = await p.getAttribute(`#table th:nth-child(${nth})`, 'aria-sort'); assert.ok(first === 'ascending' || first === 'descending'); assert.deepEqual(await texts(p, '#table tbody th'), sorted(f, first), `sorted by ${key}, ${first}`);
    assert.equal(await p.evaluate(() => document.activeElement.dataset.sort), key, 'the heading keeps the focus'); await p.keyboard.press('Enter'); const second = await p.getAttribute(`#table th:nth-child(${nth})`, 'aria-sort'); assert.notEqual(second, first); assert.deepEqual(await texts(p, '#table tbody th'), sorted(f, second), `sorted by ${key}, ${second}`);
    assert.equal(await p.locator('#table th[aria-sort="ascending"], #table th[aria-sort="descending"]').count(), 1, 'only one column says it is sorted'); }
  await p.click('[data-sort="status"]'); assert.equal((await texts(p, '#table tbody td:nth-child(2)'))[0], 'Had an outageSlow', 'sorting by state puts the worst trouble first'); await p.click('[data-sort="visits"]');
  done.push('the table sorts by all eight sortable columns, both ways, with ties A to Z, and says so to screen readers');

  // Reading the charts by keyboard and by pointer.
  const s = v28.series; await p.focus('#trend .plot'); await p.keyboard.press('ArrowLeft'); let tip = await text(p, '#tip'); assert.ok(tip.includes(fmt.day(s[s.length - 1].date)), 'the first arrow press reads the latest day'); await p.keyboard.press('ArrowLeft'); tip = await text(p, '#tip'); const d2 = s[s.length - 2];
  assert.ok(tip.includes(fmt.day(d2.date)) && tip.includes(fmt.int(d2.visits)) && tip.includes(fmt.int(d2.before)), `the crosshair read "${tip}"`); assert.equal(await text(p, '#live'), `${fmt.day(d2.date)}: ${fmt.int(d2.visits)} visits. ${fmt.int(d2.before)} on ${fmt.day(d2.beforeDate)}.`);
  await p.keyboard.press('Home'); assert.ok((await text(p, '#tip')).includes(fmt.day(s[0].date))); await p.keyboard.press('Escape'); assert.ok(await p.evaluate(() => document.getElementById('tip').hidden));
  const box = await p.locator('#trend svg').boundingBox(), vb = await p.evaluate(() => document.querySelector('#trend svg').viewBox.baseVal.width), i = 9, x = box.x + (42 + i / (s.length - 1) * (vb - 42 - 74)) * box.width / vb; await p.mouse.move(x, box.y + box.height / 2); tip = await text(p, '#tip'); assert.ok(tip.includes(fmt.day(s[i].date)) && tip.includes(fmt.int(s[i].visits)), `hovering day ${i} read "${tip}"`);
  await p.mouse.move(5, 5); assert.ok(await p.evaluate(() => document.getElementById('tip').hidden), 'the tooltip goes when the pointer leaves');
  await p.focus('#heat .plot'); await p.keyboard.press('ArrowDown'); assert.equal(await text(p, '#live'), `${WEEKDAYS[0]}, 00:00 to 01:00: ${avg(v28.heat[0][0])} visits on average.`, 'the first arrow press, whichever it is, reads Monday at midnight'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowRight'); assert.ok((await text(p, '#tip')).includes(avg(v28.heat[1][1])) && (await text(p, '#tip')).includes('Tue, 01:00 to 02:00'));
  const cell = await p.locator('#heat .cells rect[data-d="3"][data-h="14"]').boundingBox(); await p.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2); assert.ok((await text(p, '#tip')).includes(avg(v28.heat[3][14])) && (await text(p, '#tip')).includes('Thu, 14:00 to 15:00'));
  await p.focus('#sources .bars li'); assert.ok((await text(p, '#tip')).includes(fmt.int(v28.sources[0].visits)) && (await text(p, '#tip')).includes(v28.sources[0].name), 'a source bar shows its figures on focus');
  await p.click('#trend .astable'); await p.click('#heat .astable'); await axe(p, '1440 tables'); await p.click('#trend .astable'); await p.click('#heat .astable');
  done.push('charts read by keyboard (arrow keys, with the figures spoken) and by pointer');
  // A narrower window redraws the charts to fit, and does not take the keyboard away from the chart being read.
  await p.focus('#trend .plot'); await p.keyboard.press('ArrowLeft'); await p.setViewportSize({ width: 820, height: 900 }); await p.waitForFunction(() => document.querySelector('#trend svg').viewBox.baseVal.width < 820); assert.ok(await p.evaluate(() => document.activeElement.classList.contains('plot') && !!document.activeElement.closest('#trend')), 'the focus is lost when the chart redraws');
  await p.focus('#heat .plot'); await p.setViewportSize({ width: 1024, height: 768 }); await p.waitForFunction(() => document.querySelector('#trend svg').viewBox.baseVal.width > 820 || document.querySelector('#heat svg').viewBox.baseVal.width > 700); assert.ok(await p.evaluate(() => !!document.activeElement.closest('#heat')), 'the focus is lost when the week grid redraws'); await layout(p, '1024'); await p.setViewportSize({ width: 1280, height: 800 }); await layout(p, '1280'); await p.context().close(); }

for (const [w, h] of [[400, 800], [320, 568], [740, 360]]) { const p = await open(w, h, { touch: true }); await layout(p, `${w}x${h}`); await axe(p, `${w}x${h}`); await p.tap('#range [data-range="91"]'); await agrees(p, 91, ALL, `${w}x${h}`); await p.tap('#sites [data-site="axy-lusion"]'); assert.equal((await state(p)).sites.length, 7);
  assert.ok(await p.evaluate(() => [...document.querySelectorAll('.scroll')].every(s => s.tabIndex === 0 && s.getAttribute('role') === 'region')), 'tables that scroll sideways can be reached by keyboard'); if (w < 700) assert.ok(await p.evaluate(() => document.querySelector('.hint').getBoundingClientRect().width > 0), 'a narrow screen is told the table scrolls sideways'); await layout(p, `${w}x${h} after filtering`); await p.context().close(); }
// The repo's own rule uses a plain 320-pixel window, not a phone: the page itself must not be wider than that.
{ const p = await open(320, 720); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 320, 'the page is wider than a 320-pixel window'); await layout(p, '320 plain window'); await p.context().close(); }
done.push('phones 400x800, 320x568, 740x360 and a plain 320-pixel window: nothing off the side, nothing cut off, filters work by touch');
// With scripts switched off the page says why it is empty, and still says the figures are samples.
{ const p = await open(1280, 800, { noScript: true }); assert.match(await p.textContent('noscript'), /switched off/); assert.equal((await p.textContent('.tag')).trim(), 'Sample data'); await p.context().close(); done.push('with scripts off the page explains itself'); }

await browser.close(); const outside = requests.filter(u => !u.startsWith(base)); assert.deepEqual(outside, [], 'requests left the page: ' + outside.join(', ')); assert.deepEqual(problems, [], 'console problems:\n' + problems.join('\n'));
console.log('ok  ' + done.join('\nok  ') + '\nok  axe WCAG 2.2 A and AA clean with charts and with tables, at four sizes; no console errors; no request left the page');
