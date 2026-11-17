// Browser checks for Site Pulse. Usage: node smoke.mjs <path-to-axe.min.js> [base-url]
// The expected figures are worked out here in Node from data.js, then read off the page: the page is never asked what it thinks.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeData, summarise, fmt, WEEKDAYS } from '../js/data.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const axeSrc = fs.readFileSync(process.argv[2], 'utf8'), base = process.argv[3] || 'http://127.0.0.1:8774', url = base + '/demos/site-pulse/';
const data = makeData(), ALL = data.sites.map(s => s.id);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined }); const problems = [], requests = [], done = [];
async function open(w, h, touch = false) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch }); const p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${w}x${h}: ${m.text()}`); }); p.on('pageerror', e => problems.push(`${w}x${h}: ${e}`)); p.on('request', r => requests.push(r.url())); await p.goto(url); await p.waitForFunction(() => window.sitePulse); return p; }
const axe = async (p, label) => { await p.evaluate(axeSrc); const r = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })); assert.equal(r.violations.length, 0, `${label}: axe: ${r.violations.map(v => `${v.id} (${v.nodes.length}: ${v.nodes[0].target})`).join('; ')}`); };
const layout = async (p, label) => { const bad = await p.evaluate(() => { const out = [], vw = innerWidth; if (document.documentElement.scrollWidth > vw + 1) out.push(`page is ${document.documentElement.scrollWidth} wide`);
  for (const b of document.querySelectorAll('button')) { const r = b.getBoundingClientRect(); if (!r.width) continue; if (r.width < 24 || r.height < 24) out.push(`button "${b.textContent.trim()}" is ${Math.round(r.width)}x${Math.round(r.height)}`); if (!b.closest('.scroll') && (r.left < -1 || r.right > vw + 1)) out.push(`button "${b.textContent.trim()}" off the side`); }
  for (const c of document.querySelectorAll('.card, .tile, #filters')) { const r = c.getBoundingClientRect(); if (r.left < -1 || r.right > vw + 1) out.push(`${c.id || c.className} off the side`); }
  for (const t of document.querySelectorAll('.tile .value, h2, .bars .name')) if (t.scrollWidth > t.clientWidth + 1) out.push(`"${t.textContent}" is cut off`);
  if (!document.querySelector('.tag').getBoundingClientRect().width) out.push('the sample-data tag is hidden'); return out; }); assert.deepEqual(bad, [], `${label}: ${bad.join('; ')}`); };
const text = (p, sel) => p.evaluate(s => document.querySelector(s).textContent.trim(), sel);
const texts = (p, sel) => p.$$eval(sel, els => els.map(e => e.textContent.trim()));
const set = (p, o) => p.evaluate(o => window.sitePulse.set(o), o);
// Read every figure the page shows and compare it with what data.js says it should be for that choice of range and sites.
async function agrees(p, range, sites, label) { const v = summarise(data, { range, sites }), t = v.totals;
  assert.equal(await text(p, '.tile.hero .value'), fmt.int(t.visits), `${label}: headline`); assert.equal(await text(p, '.tile.hero .label'), `Visits, last ${range} days`);
  assert.deepEqual(await texts(p, '.tile:not(.hero) .value'), [fmt.compact(t.visitors), t.perVisit.toFixed(2), fmt.secs(t.stay), fmt.load(t.load), fmt.pct(t.uptime, 2)], `${label}: tiles`);
  const dl = await texts(p, '.tile .delta'); assert.ok(dl[0].includes(fmt.delta(v.delta.visits)), `${label}: headline change ${dl[0]}`); assert.ok(dl[1].includes(fmt.delta(v.delta.visitors)));
  assert.ok((await text(p, '#period')).startsWith(`${fmt.day(v.from)} to ${fmt.day(v.to)} 2026`));
  const order = [...v.sites]; assert.deepEqual(await texts(p, '#table tbody th'), order.map(s => s.name), `${label}: sites in the table`); if (order.length) { assert.deepEqual(await texts(p, '#table tbody td:nth-child(3)'), order.map(s => fmt.int(s.visits)), `${label}: visits in the table`); assert.deepEqual(await texts(p, '#table tbody td:nth-child(7)'), order.map(s => fmt.load(s.load))); assert.deepEqual(await texts(p, '#table tbody td:nth-child(8)'), order.map(s => fmt.pct(s.uptime, 2)));
    assert.deepEqual(await texts(p, '#table tbody td:nth-child(2)'), order.map(s => ({ healthy: 'Healthy', slow: 'Slow', outage: 'Had an outage' })[s.status])); }
  assert.deepEqual(await texts(p, '#sources .name'), v.sources.map(s => s.name)); assert.deepEqual(await p.$$eval('#sources .fig', els => els.map(e => e.firstChild.textContent)), v.sources.map(s => fmt.int(s.visits)), `${label}: sources`);
  assert.deepEqual(await p.$$eval('#devices .fig', els => els.map(e => e.firstChild.textContent)), v.devices.map(s => fmt.pct(s.share)));
  assert.deepEqual(await texts(p, '#pages tbody td:nth-child(3)'), v.pages.slice(0, 10).map(x => fmt.int(x.views)), `${label}: pages`);
  assert.equal(await p.locator('#deploys .list li').count(), Math.max(1, Math.min(8, v.deploys.length))); assert.equal(await p.locator('#notes .list li').count(), Math.max(1, Math.min(7, v.notes.length)));
  if (v.notes.length) assert.ok((await text(p, '#notes .list li')).endsWith(v.notes[0].text));
  // The two drawn charts, read through their tables: every day and every hour.
  for (const id of ['trend', 'heat']) if ((await p.getAttribute(`#${id} .astable`, 'aria-pressed')) !== 'true') await p.click(`#${id} .astable`);
  assert.deepEqual(await p.$$eval('#trend tbody tr', rows => rows.map(r => [...r.children].map(c => c.textContent))), v.series.map(d => [fmt.day(d.date), fmt.int(d.visits), fmt.day(d.beforeDate), fmt.int(d.before)]), `${label}: the daily table`);
  assert.deepEqual(await p.$$eval('#heat tbody tr', rows => rows.map(r => [...r.children].slice(1).map(c => c.textContent))), Array.from({ length: 24 }, (_, h) => v.heat.map(r => fmt.int(r[h]))), `${label}: the week grid as a table`);
  for (const id of ['trend', 'heat']) await p.click(`#${id} .astable`); assert.equal(await p.locator('#heat .cells rect').count(), 168); assert.equal(await p.locator('#trend svg path').count(), 3);
  assert.ok(!/NaN|undefined|Infinity|null/.test(await p.evaluate(() => document.querySelector('main').innerText)), `${label}: a broken number is on the page`); return v; }

{ const p = await open(1440, 900);
  // As it opens: the sample-data flag, 30 days, all eight sites, and the repo's Tab rule.
  assert.equal(await text(p, '.tag'), 'Sample data'); assert.match(await text(p, 'footer'), /Every number on this page is made up/);
  for (let k = 0; k < 3; k++) { await p.keyboard.press('Tab'); const f = await p.evaluate(() => { const n = document.activeElement, r = n.getBoundingClientRect(); return { tag: n.tagName, ok: r.width > 0 && r.height > 0 }; }); assert.ok(f.ok && f.tag !== 'BODY'); }
  await agrees(p, 30, ALL, 'as it opens'); await axe(p, '1440 charts'); await layout(p, '1440');
  done.push('opens on 30 days and all eight sites, flagged as sample data; every figure matches the data');

  // Every figure agrees with the data for every range and several choices of site, including none.
  let n = 0; for (const range of [7, 30, 90]) for (const sites of [ALL, ['kols-korner'], ['news-atlas', 'axy-lusion', 'stackscout'], []]) { await set(p, { range, sites }); await agrees(p, range, sites, `${range} days, ${sites.length} sites`); n++; }
  assert.match(await text(p, '#table tbody'), /No sites are chosen/); assert.equal(await text(p, '.tile.hero .value'), '0');
  done.push(`${n} combinations of range and sites: headline, tiles, table, sources, devices, pages, and all ${7 * 24} hours and every day through the table views`);

  // The filters themselves.
  await set(p, { range: 30, sites: ALL }); await p.click('#range [data-range="7"]'); assert.equal((await p.evaluate(() => window.sitePulse.state())).range, 7); assert.equal(await p.getAttribute('#range [data-range="7"]', 'aria-checked'), 'true'); assert.equal(await p.getAttribute('#range [data-range="30"]', 'aria-checked'), 'false');
  await p.keyboard.press('ArrowRight'); assert.equal((await p.evaluate(() => window.sitePulse.state())).range, 30, 'arrow keys move between ranges'); assert.equal(await p.evaluate(() => document.activeElement.dataset.range), '30'); assert.deepEqual(await p.$$eval('#range button', bs => bs.map(b => b.tabIndex)), [-1, 0, -1]);
  await p.click('#sites [data-site="news-atlas"]'); let st = await p.evaluate(() => window.sitePulse.state()); assert.equal(st.sites.length, 7); assert.equal(await p.getAttribute('#sites [data-site="news-atlas"]', 'aria-pressed'), 'false'); assert.equal(await p.getAttribute('#all-sites', 'aria-pressed'), 'false'); await agrees(p, 30, st.sites, 'seven sites');
  await p.click('#all-sites'); assert.equal((await p.evaluate(() => window.sitePulse.state())).sites.length, 8);
  await p.click('[data-only="stackscout"]'); st = await p.evaluate(() => window.sitePulse.state()); assert.deepEqual(st.sites, ['stackscout']); assert.equal(await p.evaluate(() => document.activeElement.dataset.only), 'stackscout', 'the focus stays on the site you pressed'); assert.match(await text(p, '#period'), /StackScout/);
  await p.click('[data-only="stackscout"]'); assert.equal((await p.evaluate(() => window.sitePulse.state())).sites.length, 8, 'pressing the only site again brings them all back');
  assert.match(await text(p, '#live'), /visits in the last 30 days across all eight sites/);
  done.push('filters: range by click and arrow keys, site chips, All sites, and a site name that shows only that site');

  // Sorting the table.
  const v30 = summarise(data, { range: 30 }); await p.click('[data-sort="visits"]'); assert.equal(await p.getAttribute('#table th:nth-child(3)', 'aria-sort'), 'ascending'); assert.deepEqual(await texts(p, '#table tbody th'), [...v30.sites].reverse().map(s => s.name));
  await p.keyboard.press('Enter'); assert.equal(await p.getAttribute('#table th:nth-child(3)', 'aria-sort'), 'descending', 'the heading keeps the focus, so Enter sorts again');
  await p.click('[data-sort="name"]'); assert.deepEqual(await texts(p, '#table tbody th'), v30.sites.map(s => s.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))); assert.equal(await p.getAttribute('#table th:nth-child(1)', 'aria-sort'), 'ascending'); assert.equal(await p.getAttribute('#table th:nth-child(3)', 'aria-sort'), 'none');
  await p.click('[data-sort="status"]'); assert.equal((await texts(p, '#table tbody td:nth-child(2)'))[0], 'Had an outage', 'sorting by state puts trouble first'); await p.click('[data-sort="load"]'); const loads = (await texts(p, '#table tbody td:nth-child(7)')).map(parseFloat); assert.deepEqual(loads, [...loads].sort((a, b) => b - a));
  await p.click('[data-sort="visits"]'); done.push('the table sorts by every sortable column, both ways, and says so to screen readers');

  // Reading the charts by keyboard and by pointer.
  const s = v30.series; await p.focus('#trend .plot'); await p.keyboard.press('ArrowLeft'); let tip = await text(p, '#tip'); assert.ok(tip.includes(fmt.day(s[s.length - 1].date)), 'the first arrow press reads the latest day'); await p.keyboard.press('ArrowLeft'); tip = await text(p, '#tip'); const d2 = s[s.length - 2]; assert.ok(tip.includes(fmt.day(d2.date)) && tip.includes(fmt.int(d2.visits)) && tip.includes(fmt.int(d2.before)), `the crosshair read "${tip}"`); assert.equal(await text(p, '#live'), `${fmt.day(d2.date)}: ${fmt.int(d2.visits)} visits. ${fmt.int(d2.before)} on ${fmt.day(d2.beforeDate)}.`);
  await p.keyboard.press('Home'); assert.ok((await text(p, '#tip')).includes(fmt.day(s[0].date))); await p.keyboard.press('Escape'); assert.ok(await p.evaluate(() => document.getElementById('tip').hidden));
  const box = await p.locator('#trend svg').boundingBox(), vb = await p.evaluate(() => document.querySelector('#trend svg').viewBox.baseVal.width), i = 9, x = box.x + (42 + i / (s.length - 1) * (vb - 42 - 74)) * box.width / vb; await p.mouse.move(x, box.y + box.height / 2); tip = await text(p, '#tip'); assert.ok(tip.includes(fmt.day(s[i].date)) && tip.includes(fmt.int(s[i].visits)), `hovering day ${i} read "${tip}"`);
  await p.mouse.move(5, 5); assert.ok(await p.evaluate(() => document.getElementById('tip').hidden), 'the tooltip goes when the pointer leaves');
  await p.focus('#heat .plot'); await p.keyboard.press('ArrowRight'); assert.equal(await text(p, '#live'), `${WEEKDAYS[0]}, 00:00 to 01:00: ${fmt.int(v30.heat[0][0])} visits.`); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowRight'); assert.ok((await text(p, '#tip')).includes(fmt.int(v30.heat[1][1])) && (await text(p, '#tip')).includes('Tue, 01:00 to 02:00'));
  const cell = await p.locator('#heat .cells rect[data-d="3"][data-h="14"]').boundingBox(); await p.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2); assert.ok((await text(p, '#tip')).includes(fmt.int(v30.heat[3][14])) && (await text(p, '#tip')).includes('Thu, 14:00 to 15:00'));
  await p.focus('#sources .bars li'); assert.ok((await text(p, '#tip')).includes(fmt.int(v30.sources[0].visits)) && (await text(p, '#tip')).includes(v30.sources[0].name), 'a source bar shows its figures on focus');
  // The busiest and quietest hours really are the lightest and darkest squares.
  const flat = v30.heat.flat(), hi = flat.indexOf(Math.max(...flat)), lo = flat.indexOf(Math.min(...flat)), fills = await p.$$eval('#heat .cells rect', rs => rs.map(r => r.getAttribute('fill'))); assert.equal(fills[hi], 'var(--h5)'); assert.equal(fills[lo], 'var(--h1)');
  await p.click('#trend .astable'); await p.click('#heat .astable'); assert.equal(await text(p, '#trend .astable'), 'Show as chart'); await axe(p, '1440 tables'); await p.click('#trend .astable'); await p.click('#heat .astable');
  done.push('charts read by keyboard (arrow keys, with the figures spoken) and by pointer; the busiest hour is the lightest square');
  // A narrower window redraws the charts to fit.
  await p.setViewportSize({ width: 820, height: 900 }); await p.waitForFunction(() => document.querySelector('#trend svg').viewBox.baseVal.width < 820); await layout(p, '820'); await p.context().close(); }

for (const [w, h] of [[400, 800], [320, 568], [740, 360]]) { const p = await open(w, h, true); await layout(p, `${w}x${h}`); await axe(p, `${w}x${h}`); await p.tap('#range [data-range="90"]'); await agrees(p, 90, ALL, `${w}x${h}`); await p.tap('#sites [data-site="axy-lusion"]'); assert.equal((await p.evaluate(() => window.sitePulse.state())).sites.length, 7);
  assert.ok(await p.evaluate(() => [...document.querySelectorAll('.scroll')].every(s => s.tabIndex === 0 && s.getAttribute('role') === 'region')), 'tables that scroll sideways can be reached by keyboard'); await layout(p, `${w}x${h} after filtering`); await p.context().close(); }
// The repo's own rule uses a plain 320-pixel window, not a phone: the page itself must not be wider than that.
{ const p = await open(320, 720); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 320, 'the page is wider than a 320-pixel window'); await layout(p, '320 plain window'); await p.context().close(); }
done.push('phones 400x800, 320x568, 740x360: nothing off the side, nothing cut off, filters work by touch');

await browser.close(); const outside = requests.filter(u => !u.startsWith(base)); assert.deepEqual(outside, [], 'requests left the page: ' + outside.join(', ')); assert.deepEqual(problems, [], 'console problems:\n' + problems.join('\n'));
console.log('ok  ' + done.join('\nok  ') + '\nok  axe WCAG 2.2 A and AA clean with charts and with tables, at four sizes; no console errors; no request left the page');
