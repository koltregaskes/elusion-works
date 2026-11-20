// Orbit Census with loaded data: the launch tests only ever see the "catalogue unavailable" state,
// because the catalogue is built at deploy time. This serves a generated, fresh fixture catalogue
// in its place and checks the behaviour that only exists once data is loaded.
// Run after `python scripts/build-site.py`. Uses PLAYWRIGHT_CHANNEL (msedge in CI) when set.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FIELDS, GROUPS } from '../demos/orbit-census/src/catalog.js';
import { inspectCatalogue } from '../demos/orbit-census/src/catalogue-status.js';

const root = path.resolve(process.argv.find((a) => a.startsWith('--root='))?.split('=')[1] || '_site');
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
const now = Date.now();
const epoch = iso(now - 3600000);

// name, norad, cospar, type, owner, launch, site, rcs, group, n, e, i, raan, argp, ma
const OBJ = [
  ['ISS (ZARYA)', 25544, '1998-067A', 'PAY', 'ISS', '1998-11-20', 'TYMSC', 399.05, 'stations', 15.5, 0.0005, 51.64, 120, 80, 10],
  // A separately catalogued module on the same elements: a co-moving pair the screen must count, not list.
  ['ISS (NAUKA)', 49044, '2021-066A', 'PAY', 'CIS', '2021-07-21', 'TYMSC', null, 'stations', 15.5, 0.0005, 51.64, 120, 80, 10],
  ['HULIANWANG DIGUI-01', 59001, '2024-210A', 'PAY', 'PRC', '2024-11-11', 'XSC', null, 'active', 13.2, 0.001, 86.5, 40, 0, 100],
  ['O3B MPOWER F7', 59002, '2024-180A', 'PAY', 'O3B', '2024-10-01', 'AFETR', null, 'active', 5.0, 0.0002, 0.05, 0, 0, 200],
  ['RASSVET-1', 59003, '2025-010A', 'PAY', 'CIS', '2025-01-20', 'PKMTR', null, 'active', 15.0, 0.001, 97.6, 300, 0, 250],
  // Same launch (2020-001A/B: the worker compares the first 8 characters) on the same elements.
  // Excluded as a known same-launch pair before the speed rule, so it must not add to the slow count.
  ['STACK A', 59010, '2020-001A', 'PAY', 'US', '2020-01-07', 'AFETR', null, 'active', 14.2, 0.001, 45, 210, 0, 30],
  ['STACK B', 59011, '2020-001B', 'PAY', 'US', '2020-01-07', 'AFETR', null, 'active', 14.2, 0.001, 45, 210, 0, 30],
  // Matched in SATCAT (has a launch date) but no radar size; and one with no SATCAT match at all.
  ['TESTSAT MATCHED', 59004, '2023-001A', 'PAY', 'US', '2023-01-03', 'AFETR', null, 'active', 14.9, 0.001, 53, 10, 0, 300],
  ['TESTSAT UNMATCHED', 59005, '2023-002A', 'PAY', '', '', '', null, 'last-30-days', 14.8, 0.001, 70, 200, 0, 50],
];
// Filler so the lenses and charts have a population; spread out so nothing else falls inside 25 km.
for (let k = 0; k < 120; k++) OBJ.push([`STARLINK-${9000 + k}`, 60000 + k, `2025-${String(100 + k).padStart(3, '0')}A`, 'PAY', 'US', '2025-05-01', 'AFETR', null, 'active', 15.06, 0.0001, 53, (k * 37) % 360, 0, (k * 61) % 360]);

const fixture = {
  v: 1, fields: FIELDS, generated: new Date(now - 600000).toISOString(), source: 'CelesTrak GP + SATCAT (test fixture)',
  rows: OBJ.map((o) => [o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8], epoch, o[9], o[10], o[11], o[12], o[13], o[14], 0.0001, 0, 0]),
  groups: Object.fromEntries(GROUPS.map((g) => [g.id, 1])), satcat: true,
  census: { total: OBJ.length, PAY: OBJ.length, 'R/B': 0, DEB: 0, UNK: 0 },
};
inspectCatalogue(fixture); // the fixture must pass the page's own checks, or this test proves nothing

const failures = [];
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`); if (!ok) failures.push(what); };

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', geolocation: { latitude: -41.2865, longitude: 174.7762 }, permissions: ['geolocation'] });
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'ew.test') return r.abort();
    if (u.pathname.endsWith('/demos/orbit-census/data/catalog.json')) return r.fulfill({ body: JSON.stringify(fixture), contentType: 'application/json' });
    let f = path.resolve(root, '.' + decodeURIComponent(u.pathname));
    if (f !== root && !f.startsWith(root + path.sep)) return r.abort();
    try { if ((await fs.stat(f)).isDirectory()) f = path.join(f, 'index.html'); await r.fulfill({ path: f }); } catch { await r.fulfill({ status: 404, body: '' }); }
  });
  const p = await ctx.newPage(); p.setDefaultTimeout(20000);
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('https://ew.test/demos/orbit-census/', { waitUntil: 'load' });
  await p.waitForFunction(() => document.querySelector('#boot')?.classList.contains('done') && window.__oc?.S?.items?.length > 0);
  check(await p.locator('#nodata').isHidden(), 'loaded-data state, not the unavailable state');
  const n = await p.evaluate(() => window.__oc.S.items.length);
  check(n === OBJ.length, 'every fixture object loaded', `${n}/${OBJ.length}`);

  // the data-quality notice must not sit over either column's controls
  const overlap = await p.evaluate(() => {
    const n = document.querySelector('#dataNotice'); if (n.hidden) return [];
    const a = n.getBoundingClientRect();
    return [...document.querySelectorAll('.col')].filter((c) => {
      const b = c.getBoundingClientRect(); return b.width && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }).map((c) => c.className);
  });
  check(!overlap.length, 'data notice does not cover a panel column', overlap.join(', '));

  // families and RCS wording, through the selected-object card
  const card = async (name) => p.evaluate((nm) => {
    const it = window.__oc.S.items.find((x) => x.name === nm); window.__oc.select(it.i);
    const facts = Object.fromEntries([...document.querySelectorAll('#sFacts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
    return { fam: document.querySelector('#sFam').hidden ? null : document.querySelector('#sFam').textContent, rcs: facts['Radar size'] };
  }, name);
  check((await card('HULIANWANG DIGUI-01')).fam === 'Guowang', 'HULIANWANG is labelled Guowang');
  check((await card('O3B MPOWER F7')).fam === 'O3b', 'O3b family label covers both generations');
  check((await card('RASSVET-1')).fam === 'Rassvet', 'Rassvet family');
  check((await card('TESTSAT MATCHED')).rcs === 'not in SATCAT', 'RCS: matched in SATCAT, blank radar size');
  check((await card('TESTSAT UNMATCHED')).rcs === 'unavailable', 'RCS: no SATCAT match');
  check(/m²/.test((await card('ISS (ZARYA)')).rcs || ''), 'RCS: measured radar size shown');

  // shortcut guard: a lens key works on the page, but not inside the city picker
  await p.keyboard.press('Escape'); await p.locator('body').click({ position: { x: 720, y: 450 } }).catch(() => {});
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.press('3');
  check(await p.evaluate(() => new URLSearchParams(location.search).get('lens')) === 'mega', 'lens shortcut works outside form controls');
  await p.focus('#obsCity'); await p.keyboard.press('4');
  check(await p.evaluate(() => new URLSearchParams(location.search).get('lens')) === 'mega', 'lens shortcut ignored inside the city picker');

  // city and location switching
  await p.selectOption('#obsCity', { label: 'Tokyo' });
  check(await p.evaluate(() => window.__oc.S.obs.name) === 'Tokyo', 'city picker moves the observer');
  await p.click('#locBtn');
  await p.waitForFunction(() => window.__oc.S.obs.name === 'your location');
  const shown = await p.evaluate(() => { const s = document.querySelector('#obsCity'); return s.options[s.selectedIndex].textContent; });
  check(shown === 'Your location', 'picker shows "Your location" after My location', shown);
  check(Math.abs(await p.evaluate(() => window.__oc.S.obs.lat) + 41.2865) < 1e-3, 'observer uses the reported coordinates');
  await p.selectOption('#obsCity', { label: 'London' });
  check(await p.evaluate(() => window.__oc.S.obs.name) === 'London', 'choosing London again after My location takes effect');

  // close-approach card: criteria stated; co-moving ISS pair counted, not listed; honest empty state
  await p.waitForFunction(() => !/Screening/.test(document.querySelector('#conj').textContent));
  const conj = await p.evaluate(() => ({ none: document.querySelector('#conjNone')?.textContent || '', slow: document.querySelector('#conjSlow')?.textContent || '', note: document.querySelector('#conjNote').textContent, listed: document.querySelectorAll('#conj li[data-a]').length }));
  check(/25 km/.test(conj.note) && /10 m\/s/.test(conj.note) && /known same-launch pairs excluded/.test(conj.note) && !/different launches/.test(conj.note), 'card states all three screen rules, without claiming launches are known', conj.note);
  check(conj.listed === 0, 'co-moving ISS pair is not listed as an approach');
  check(/^1 co-moving pair under 10 m\/s left out/.test(conj.slow), 'slow ISS pair counted; 2020-001A/B excluded by launch prefix through the worker', conj.slow);
  check(conj.none === "No pairs meet this screen's criteria right now.", 'empty state names the criteria, not "no pairs under 25 km"', conj.none);
  check(!errors.length, 'no page errors', errors.join(' | '));
  await ctx.close();
} finally { await browser.close(); }

if (failures.length) { console.error(`${failures.length} Orbit Census interaction check(s) failed`); process.exitCode = 1; }
else console.log('Orbit Census interactions: all checks passed');
