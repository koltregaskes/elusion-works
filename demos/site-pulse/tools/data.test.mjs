// Checks on the sample numbers, run in Node: node demos/site-pulse/tools/data.test.mjs
import assert from 'node:assert/strict';
import { makeData, summarise, share, change, fmt, DAYS, END, SOURCES, DEVICES } from '../js/data.js';
const sum = a => a.reduce((x, y) => x + y, 0);

// The same seed gives the same numbers, to the last digit; a different seed gives different ones.
const data = makeData(); assert.deepEqual(makeData(), data); assert.notDeepEqual(makeData(7).sites[0].visits, data.sites[0].visits);
assert.equal(data.days.length, DAYS); assert.equal(data.days[DAYS - 1], END); for (let i = 1; i < DAYS; i++) assert.equal(new Date(data.days[i]) - new Date(data.days[i - 1]), 86400000, 'the days are not one after another');
assert.equal(data.sites.length, 8); assert.equal(new Set(data.sites.map(s => s.id)).size, 8);
// Every day, for every site: whole numbers, nothing negative, and the parts add up to the whole.
for (const s of data.sites) for (let i = 0; i < DAYS; i++) { for (const v of [s.visits[i], s.visitors[i], s.views[i], s.stay[i], s.load[i], s.down[i]]) assert.ok(Number.isInteger(v) && v >= 0);
  assert.ok(s.visitors[i] <= s.visits[i], 'more visitors than visits'); assert.ok(s.views[i] >= s.visits[i], 'fewer pages than visits'); assert.ok(s.down[i] <= 1440);
  assert.equal(sum(s.sources[i]), s.visits[i]); assert.equal(sum(s.devices[i]), s.visits[i]); assert.equal(sum(s.hours[i]), s.visits[i]); assert.equal(s.sources[i].length, SOURCES.length); assert.equal(s.devices[i].length, DEVICES.length); assert.equal(s.hours[i].length, 24); }
// Sharing out: exact, whole, fair, and safe with nothing to share.
assert.deepEqual(share(10, [1, 1, 1]), [4, 3, 3]); assert.deepEqual(share(0, [3, 2]), [0, 0]); assert.deepEqual(share(7, [0, 0]).reduce((a, b) => a + b, 0), 7); assert.equal(sum(share(999, [0.2, 13, 5, 0.01])), 999);
assert.equal(change(110, 100), 0.1); assert.equal(change(5, 0), null); assert.equal(change(0, 0), 0);

// Every view of the numbers agrees with every other, for every range and for single sites, pairs and all eight.
const ids = data.sites.map(s => s.id), picks = [null, [ids[0]], [ids[3]], [ids[1], ids[4]], ids.slice(2), []];
for (const range of [7, 30, 90]) for (const sites of picks) { const v = summarise(data, { range, sites }), label = `${range} days, ${sites ? sites.length : 'all'} sites`;
  assert.equal(v.series.length, range); assert.equal(v.to, END); assert.equal(v.series[0].date, v.from); assert.equal(v.series[range - 1].date, v.to);
  assert.equal((new Date(v.to) - new Date(v.from)) / 86400000, range - 1); assert.equal((new Date(v.from) - new Date(v.beforeTo)) / 86400000, 1, 'the earlier period does not end the day before'); assert.equal((new Date(v.beforeTo) - new Date(v.beforeFrom)) / 86400000, range - 1);
  assert.equal(sum(v.series.map(d => d.visits)), v.totals.visits, `${label}: the line and the headline disagree`); assert.equal(sum(v.series.map(d => d.before)), v.prev.visits);
  assert.equal(sum(v.sites.map(s => s.visits)), v.totals.visits, `${label}: the table and the headline disagree`); assert.equal(sum(v.sites.map(s => s.before)), v.prev.visits);
  assert.equal(sum(v.sources.map(s => s.visits)), v.totals.visits, `${label}: sources do not add up`); assert.equal(sum(v.devices.map(s => s.visits)), v.totals.visits); assert.equal(sum(v.heat.flat()), v.totals.visits, `${label}: the week grid does not add up`);
  assert.equal(sum(v.pages.map(p => p.views)), v.totals.views, `${label}: pages do not add up`); assert.equal(v.heat.length, 7); assert.ok(v.heat.every(r => r.length === 24));
  if (v.totals.visits) { assert.ok(Math.abs(sum(v.sources.map(s => s.share)) - 1) < 1e-9); assert.ok(Math.abs(sum(v.devices.map(s => s.share)) - 1) < 1e-9); }
  assert.equal(v.delta.visits, change(v.totals.visits, v.prev.visits)); assert.ok(v.totals.uptime <= 1 && v.totals.uptime > 0.9); assert.equal(v.siteCount, sites ? sites.length : 8);
  for (let i = 1; i < v.sites.length; i++) assert.ok(v.sites[i - 1].visits >= v.sites[i].visits, 'sites are not in order of visits'); for (let i = 1; i < v.sources.length; i++) assert.ok(v.sources[i - 1].visits >= v.sources[i].visits);
  for (const s of v.sites) { assert.equal(s.spark.length, range); assert.equal(sum(s.spark), s.visits); assert.ok(['healthy', 'slow', 'outage'].includes(s.status)); assert.equal(s.status === 'outage', s.uptime < 0.999); assert.ok(SOURCES.includes(s.topSource)); }
  for (const d of v.deploys) assert.ok(d.date >= v.from && d.date <= v.to && d.daysAgo >= 0 && d.daysAgo < range); for (const n of v.notes) assert.ok(['good', 'warning', 'critical'].includes(n.level) && n.text.endsWith('.')); }
// Longer ranges hold the shorter ones; nothing chosen gives zeros, not errors; a silly range is refused.
const a7 = summarise(data, { range: 7 }), a30 = summarise(data, { range: 30 }), a90 = summarise(data, { range: 90 }); assert.ok(a7.totals.visits < a30.totals.visits && a30.totals.visits < a90.totals.visits);
const none = summarise(data, { range: 30, sites: [] }); assert.equal(none.totals.visits, 0); assert.equal(none.delta.visits, 0); assert.equal(none.sites.length, 0); assert.equal(none.totals.perVisit, 0);
assert.throws(() => summarise(data, { range: 14 }));
// The sample has the stories the page is meant to show: an outage, a slow site, a site well up, and both kinds of deploy.
assert.ok(a30.sites.some(s => s.status === 'outage') && a30.sites.some(s => s.status === 'slow') && a30.sites.some(s => s.delta > 0.25), 'the 30-day sample is missing a story'); assert.ok(a90.deploys.some(d => d.ok) && a90.deploys.some(d => !d.ok));
assert.ok(a30.notes.length >= 3 && a30.notes[0].level === 'critical');
// Numbers as words.
assert.equal(fmt.int(12345.4), '12,345'); assert.equal(fmt.compact(9999), '9,999'); assert.equal(fmt.compact(12940), '12.9K'); assert.equal(fmt.compact(4200000), '4.2M'); assert.equal(fmt.delta(0.123), '+12%'); assert.equal(fmt.delta(-0.045), '−4.5%'); assert.equal(fmt.delta(null), 'new'); assert.equal(fmt.delta(0), '0.0%'); assert.equal(fmt.secs(96), '1m 36s'); assert.equal(fmt.secs(45), '45s'); assert.equal(fmt.day('2026-11-16'), '16 Nov'); assert.equal(fmt.load(1180), '1.18 s');
console.log(`ok  sample numbers: 8 sites over ${DAYS} days; every view agrees for 3 ranges and 6 choices of site; 30 days: ${fmt.int(a30.totals.visits)} visits (${fmt.delta(a30.delta.visits)}), ${a30.notes.length} notes, statuses ${a30.sites.map(s => s.status[0]).join('')}`);
