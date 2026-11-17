// Checks on the sample numbers, run in Node: node demos/site-pulse/tools/data.test.mjs
// Two kinds of check. First, that every view agrees with every other. Second, and separately, that the figures are right:
// they are worked out again here straight from the raw daily arrays, with none of summarise()'s code.
import assert from 'node:assert/strict';
import { makeData, summarise, share, change, fmt, DAYS, END, RANGES, SOURCES, DEVICES, SLOW_MS } from '../js/data.js';
const sum = a => a.reduce((x, y) => x + y, 0);

// The same seed gives the same numbers, to the last digit; a different seed gives different ones.
const data = makeData(); assert.deepEqual(makeData(), data); assert.notDeepEqual(makeData(7).sites[0].visits, data.sites[0].visits);
assert.equal(data.days.length, DAYS); assert.equal(DAYS % 7, 0); assert.equal(data.days[DAYS - 1], END); for (let i = 1; i < DAYS; i++) assert.equal(new Date(data.days[i]) - new Date(data.days[i - 1]), 86400000, 'the days are not one after another');
assert.equal(data.sites.length, 8); assert.equal(new Set(data.sites.map(s => s.id)).size, 8); assert.deepEqual(RANGES.map(r => r[0]), [7, 28, 91]); for (const [n] of RANGES) { assert.equal(n % 7, 0, 'a range that is not whole weeks counts some weekdays more than others'); assert.ok(n * 2 <= DAYS); }
// Every day, for every site: whole numbers, nothing negative, and the parts add up to the whole.
for (const s of data.sites) for (let i = 0; i < DAYS; i++) { for (const v of [s.visits[i], s.visitors[i], s.views[i], s.stay[i], s.load[i], s.down[i]]) assert.ok(Number.isInteger(v) && v >= 0);
  assert.ok(s.visitors[i] <= s.visits[i], 'more visitors than visits'); assert.ok(s.views[i] >= s.visits[i], 'fewer pages than visits'); assert.ok(s.down[i] <= 1440);
  assert.equal(sum(s.sources[i]), s.visits[i]); assert.equal(sum(s.devices[i]), s.visits[i]); assert.equal(sum(s.hours[i]), s.visits[i]); assert.equal(s.sources[i].length, SOURCES.length); assert.equal(s.devices[i].length, DEVICES.length); assert.equal(s.hours[i].length, 24); }
// Sharing out: exact, whole, fair, and safe with nothing to share.
assert.deepEqual(share(10, [1, 1, 1]), [4, 3, 3]); assert.deepEqual(share(0, [3, 2]), [0, 0]); assert.equal(sum(share(7, [0, 0])), 7); assert.equal(sum(share(999, [0.2, 13, 5, 0.01])), 999);
assert.equal(change(110, 100), 0.1); assert.equal(change(5, 0), null); assert.equal(change(0, 0), 0);

// ---- 1. Every view agrees with every other, for every range and for single sites, pairs, most, all and none. ----
const ids = data.sites.map(s => s.id), picks = [null, [ids[0]], [ids[3]], [ids[1], ids[4]], ids.slice(2), []];
for (const [range] of RANGES) for (const sites of picks) { const v = summarise(data, { range, sites }), label = `${range} days, ${sites ? sites.length : 'all'} sites`;
  assert.equal(v.series.length, range); assert.equal(v.to, END); assert.equal(v.series[0].date, v.from); assert.equal(v.series[range - 1].date, v.to); assert.equal(v.weeks, range / 7);
  assert.equal(sum(v.series.map(d => d.visits)), v.totals.visits, `${label}: the line and the headline disagree`); assert.equal(sum(v.series.map(d => d.before)), v.prev.visits);
  assert.equal(sum(v.sites.map(s => s.visits)), v.totals.visits, `${label}: the table and the headline disagree`); assert.equal(sum(v.sites.map(s => s.before)), v.prev.visits);
  assert.equal(sum(v.sources.map(s => s.visits)), v.totals.visits, `${label}: sources do not add up`); assert.equal(sum(v.devices.map(s => s.visits)), v.totals.visits); assert.equal(sum(v.heatSum.flat()), v.totals.visits, `${label}: the week grid does not add up`);
  assert.equal(sum(v.pages.map(p => p.views)), v.totals.views, `${label}: pages do not add up`);
  for (const list of [v.sources, v.devices]) assert.equal(sum(list.map(s => s.pct)), v.totals.visits ? 100 : 0, `${label}: the percentages shown do not add up to 100`);
  for (const list of [v.sources, v.devices]) for (const s of list) assert.ok(Math.abs(s.pct - s.share * 100) < 1, 'a percentage shown is more than a point from the true share');
  assert.equal(v.siteCount, sites ? sites.length : 8); for (const s of v.sites) { assert.equal(s.spark.length, range); assert.equal(sum(s.spark), s.visits); }
  for (let i = 1; i < v.sites.length; i++) assert.ok(v.sites[i - 1].visits >= v.sites[i].visits, 'sites are not in order of visits'); for (let i = 1; i < v.sources.length; i++) assert.ok(v.sources[i - 1].visits >= v.sources[i].visits);
  const order = { critical: 0, warning: 1, good: 2 }; for (let i = 1; i < v.notes.length; i++) assert.ok(order[v.notes[i - 1].level] <= order[v.notes[i].level], `${label}: the notes are not worst first`); for (const n of v.notes) assert.ok(n.text.endsWith('.') && !/\d{4}-\d\d-\d\d/.test(n.text)); }

// ---- 2. The figures are right: worked out again from the raw arrays, by date, with separate code. ----
const day = iso => data.days.indexOf(iso), raw = id => data.sites.find(s => s.id === id), dow = iso => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
for (const [range] of RANGES) for (const sites of [ids, [ids[2]], [ids[3], ids[4], ids[6]]]) { const v = summarise(data, { range, sites }), label = `${range} days, ${sites.length} sites`, last = day(END), first = last - range + 1;
  assert.equal(v.from, data.days[first]); assert.equal(v.beforeTo, data.days[first - 1]); assert.equal(v.beforeFrom, data.days[first - range]); assert.equal(dow(v.from), dow(v.beforeFrom), 'the period before does not start on the same weekday');
  let visits = 0, before = 0, visitors = 0, views = 0, stayWeighted = 0, down = 0; const loads = [], grid = Array.from({ length: 7 }, () => new Array(24).fill(0)), seen = new Array(7).fill(0);
  for (let i = first; i <= last; i++) { seen[dow(data.days[i])]++; for (const id of sites) { const s = raw(id); visits += s.visits[i]; before += s.visits[i - range]; visitors += s.visitors[i]; views += s.views[i]; stayWeighted += s.stay[i] * s.visits[i]; down += s.down[i]; loads.push([s.load[i], s.visits[i]]); for (let h = 0; h < 24; h++) grid[dow(data.days[i])][h] += s.hours[i][h]; } }
  assert.equal(v.totals.visits, visits, `${label}: visits`); assert.equal(v.prev.visits, before, `${label}: visits in the period before`); assert.equal(v.totals.visitors, visitors); assert.equal(v.totals.views, views); assert.equal(v.totals.stay, Math.round(stayWeighted / visits)); assert.equal(v.totals.downMinutes, down);
  assert.ok(Math.abs(v.totals.uptime - (1 - down / (sites.length * range * 1440))) < 1e-12, `${label}: uptime`); assert.ok(Math.abs(v.delta.visits - (visits - before) / before) < 1e-12); assert.ok(Math.abs(v.totals.perVisit - views / visits) < 1e-12);
  // the typical page load: half the visits waited this long or less
  loads.sort((a, b) => a[0] - b[0]); let run = 0, typical = 0; for (const [ms, n] of loads) { run += n; if (run * 2 >= visits) { typical = ms; break; } } assert.equal(v.totals.load, typical, `${label}: typical load`);
  // the week grid: every weekday is counted the same number of times, and each square is the average for that hour
  assert.ok(seen.every(n => n === range / 7), `${label}: weekdays are counted ${seen}`); for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) assert.ok(Math.abs(v.heat[d][h] - grid[d][h] / seen[d]) < 1e-9, `${label}: the week grid at day ${d}, hour ${h}`);
  // each site: state, slowness, and the last deploy inside the period
  for (const s of v.sites) { const r = raw(s.id); let mins = 0, sv = 0; const sl = []; for (let i = first; i <= last; i++) { mins += r.down[i]; sv += r.visits[i]; sl.push([r.load[i], r.visits[i]]); } sl.sort((a, b) => a[0] - b[0]); let k = 0, med = 0; for (const [ms, n] of sl) { k += n; if (k * 2 >= sv) { med = ms; break; } }
    assert.equal(s.downMinutes, mins); assert.equal(s.outage, mins > 0, `${label}: ${s.name} was down ${mins} minutes but outage is ${s.outage}`); assert.equal(s.slow, med > SLOW_MS); assert.equal(s.status, mins > 0 ? 'outage' : med > SLOW_MS ? 'slow' : 'healthy'); assert.equal(s.load, med);
    const mine = data.deploys.filter(d => d.site === s.id && d.day >= first && d.day <= last).sort((a, b) => b.day - a.day)[0]; assert.equal(s.deploy ? s.deploy.date : null, mine ? mine.date : null, `${label}: ${s.name}'s last deploy`); if (mine) assert.equal(s.deploy.ok, mine.ok);
    assert.equal(v.notes.some(n => n.site === s.id && n.level === 'critical'), mins > 0, 'an outage has no note, or a note has no outage'); assert.equal(v.notes.some(n => n.site === s.id && /is slow/.test(n.text)), med > SLOW_MS, 'slowness is hidden or invented'); }
  assert.equal(v.deploys.length, data.deploys.filter(d => sites.includes(d.site) && d.day >= first && d.day <= last).length); }

// Longer ranges hold the shorter ones; nothing chosen gives zeros and no readings; a range that is not whole weeks is refused.
const a7 = summarise(data, { range: 7 }), a28 = summarise(data, { range: 28 }), a91 = summarise(data, { range: 91 }); assert.ok(a7.totals.visits < a28.totals.visits && a28.totals.visits < a91.totals.visits);
const none = summarise(data, { range: 28, sites: [] }); assert.equal(none.totals.visits, 0); assert.equal(none.delta.visits, 0); assert.equal(none.sites.length, 0); assert.equal(none.totals.uptime, null, 'no sites have no uptime to report'); assert.equal(none.notes.length, 0);
assert.throws(() => summarise(data, { range: 30 })); assert.throws(() => summarise(data, { range: 14 }));
// The sample has the stories the page is meant to show.
assert.ok(a28.sites.some(s => s.outage && s.slow), 'no site is both down and slow, so that case is never shown'); assert.ok(a28.sites.some(s => s.status === 'slow') && a28.sites.some(s => s.delta > 0.25)); assert.ok(a91.deploys.some(d => d.ok) && a91.deploys.some(d => !d.ok)); assert.equal(a28.notes[0].level, 'critical');
// Numbers as words.
assert.equal(fmt.int(12345.4), '12,345'); assert.equal(fmt.compact(9999), '9,999'); assert.equal(fmt.compact(12940), '12.9K'); assert.equal(fmt.compact(4200000), '4.2M'); assert.equal(fmt.delta(0.123), '+12%'); assert.equal(fmt.delta(-0.045), '−4.5%'); assert.equal(fmt.delta(null), 'new'); assert.equal(fmt.delta(0), '0.0%'); assert.equal(fmt.secs(96), '1m 36s'); assert.equal(fmt.secs(45), '45s'); assert.equal(fmt.day('2026-11-16'), '16 Nov'); assert.equal(fmt.load(1180), '1.18 s');
console.log(`ok  sample numbers: 8 sites over ${DAYS} days; every view agrees for 3 ranges and 6 choices of site; totals, the period before, uptime, typical load, the week grid, states and last deploys recomputed from the raw arrays for 9 slices; 4 weeks: ${fmt.int(a28.totals.visits)} visits (${fmt.delta(a28.delta.visits)}), ${a28.notes.length} notes`);
