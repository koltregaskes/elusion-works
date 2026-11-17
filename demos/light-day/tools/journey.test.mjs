// Checks the journey's arithmetic without a browser. Usage: node journey.test.mjs
// The expected figures are worked out here from first principles, not read back from the module.
import assert from 'node:assert/strict';
import * as J from '../js/journey.js';

// First principles, written out again on purpose.
const c = 299792.458, au = 149597870.7, day = 24 * 60 * 60;
assert.equal(J.C, c); assert.equal(J.AU, au); assert.equal(J.DAY, day);
assert.ok(Math.abs(J.LIGHT_DAY - 25902068371.2) < 0.01, 'a light-day is 25,902,068,371.2 km');
assert.ok(Math.abs(J.LIGHT_DAY / au - 173.1446) < 0.0001, 'which is 173.14 AU');

// Every mark: its distance, and so its light-time, from the figures a reader can look up.
const expect = { moon: 384400, sun: au, mars: 1.52 * au, jupiter: 5.2 * au, saturn: 9.5 * au, uranus: 19.2 * au, neptune: 30.1 * au, pluto: 39.5 * au, shock: 94 * au, pause: 122 * au, voyager2: 145 * au, voyager1: c * day };
assert.deepEqual(J.MARKS.map(m => m.id), Object.keys(expect), 'the marks, in order');
for (const m of J.MARKS) { assert.ok(Math.abs(m.km - expect[m.id]) < 1e-3, `${m.id} distance`); assert.ok(Math.abs(m.t - expect[m.id] / c) < 1e-9, `${m.id} light-time`); assert.ok(Math.abs(m.au - expect[m.id] / au) < 1e-12); }
for (let i = 1; i < J.MARKS.length; i++) assert.ok(J.MARKS[i].t > J.MARKS[i - 1].t, 'each mark is further than the last');
assert.equal(J.byId('voyager1').t, day, 'Voyager 1 is exactly a day away');

// The times as the page words them. Worked by hand from distance / c.
const words = { moon: '1.3 s', sun: '8 min 19 s', mars: '12 min 38 s', jupiter: '43 min 15 s', saturn: '1 h 19 min', uranus: '2 h 40 min', neptune: '4 h 10 min', pluto: '5 h 29 min', shock: '13 h 2 min', pause: '16 h 55 min', voyager2: '20 h 6 min', voyager1: '24 h' };
const byHand = s => { if (s < 9.95) return s.toFixed(1) + ' s'; if (s < 59.5) return Math.round(s) + ' s'; if (s < 3599.5) { const w = Math.round(s); return w % 60 ? `${(w - w % 60) / 60} min ${w % 60} s` : `${w / 60} min`; } const m = Math.round(s / 60); return m % 60 ? `${(m - m % 60) / 60} h ${m % 60} min` : `${m / 60} h`; };
for (const m of J.MARKS) { assert.equal(J.dur(m.t), words[m.id], `${m.id} in words`); assert.equal(byHand(expect[m.id] / c), words[m.id], `${m.id} by hand`); }
assert.equal(J.dur(59.6), '1 min'); assert.equal(J.dur(3599.6), '1 h'); assert.equal(J.dur(0), '0.0 s'); assert.equal(J.dur(45.2), '45 s'); assert.equal(J.dur(119.5), '2 min'); assert.equal(J.dur(3 * 3600 + 59.6 * 60), '4 h');

// The clock never shows a time that has not happened yet, and reads 24:00:00 on arrival.
assert.equal(J.clock(0), '00:00:00.00'); assert.equal(J.clock(1.282), '00:00:01.28'); assert.equal(J.clock(9.999), '00:00:09.99'); assert.equal(J.clock(10), '00:00:10'); assert.equal(J.clock(499.9), '00:08:19'); assert.equal(J.clock(3600), '01:00:00'); assert.equal(J.clock(day), '24:00:00'); assert.equal(J.clock(day - 0.4), '23:59:59');
for (let t = 0; t < 12; t += 0.013) { const [h, m, s] = J.clock(t).split(':').map(Number); assert.ok(h * 3600 + m * 60 + s <= t + 1e-9, `the clock ran ahead at ${t}`); }

// Distances in words.
assert.equal(J.km(384400), '384,400 km'); assert.equal(J.km(999999.4), '999,999 km'); assert.equal(J.km(4496887), '4.50 million km'); assert.equal(J.km(au), '150 million km'); assert.equal(J.km(5.2 * au), '778 million km'); assert.equal(J.km(30.1 * au), '4.50 billion km'); assert.equal(J.km(c * day), '25.9 billion km'); assert.equal(J.kmExact(c * day), '25,902,068,371 km');
assert.equal(J.au(384400), ''); assert.equal(J.au(au), '1.00 AU'); assert.equal(J.au(30.1 * au), '30.1 AU'); assert.equal(J.au(c * day), '173.1 AU');
assert.equal(J.share(0), 'under 0.01%'); assert.equal(J.share(day / 2), '50.0%'); assert.equal(J.share(day), '100%'); assert.equal(J.share(864), '1.0%'); assert.equal(J.share(499), '0.58%');

// The scroll: time never runs backwards, has no jumps, starts at nought and ends at a day.
assert.equal(J.timeAt(0), 0); assert.equal(J.timeAt(0.6), 0); assert.equal(J.timeAt(-3), 0); assert.equal(J.timeAt(J.END_Y), day); assert.equal(J.timeAt(J.END_Y + 5), day); assert.equal(J.timeAt(NaN), 0);
let prev = 0, steps = 0; for (let y = 0; y <= J.TRACK; y += 0.0005) { const t = J.timeAt(y); assert.ok(t >= prev, `time ran backwards at ${y}`); if (prev > 60) assert.ok(t - prev < prev * 0.012 + 20, `time jumped at ${y}: ${prev} to ${t}`); prev = t; steps++; }
assert.equal(prev, day);
// Each mark is crossed at one place on the page, and going there and back gives the same time.
for (const m of J.MARKS) { const y = J.yAt(m.t); assert.ok(Math.abs(J.timeAt(y) - m.t) < 1e-6 * Math.max(1, m.t), `${m.id}: there and back`); assert.ok(y > 0.6 && y <= J.END_Y); }
for (let t = 0.01; t < day; t *= 1.37) assert.ok(Math.abs(J.timeAt(J.yAt(t)) - t) < 1e-6 * Math.max(1, t), `there and back at ${t}`);
assert.equal(J.yAt(0), 0.6); assert.equal(J.yAt(day), J.END_Y); assert.equal(J.yAt(day * 2), J.END_Y);
// The marks are far enough apart on the page for a card each.
const ys = J.MARKS.map(m => J.yAt(m.t)); for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 1.0, `${J.MARKS[i].id} is only ${(ys[i] - ys[i - 1]).toFixed(2)} screens after ${J.MARKS[i - 1].id}`);
// After six hours the page is to scale: each hour is the same length.
const six = J.yAt(6 * 3600); for (let h = 7; h <= 24; h++) assert.ok(Math.abs(J.yAt(h * 3600) - six - (h - 6) * J.PER_HOUR) < 1e-9, `hour ${h} is not to scale`);
// Before six hours it is squeezed: the first four hours take far more page than their share of the day.
assert.ok(J.yAt(4 * 3600) / J.END_Y > 0.45 && 4 / 24 < 0.17);

// The view: the flash stays on the line, space only ever shrinks, and nothing jumps.
let last = J.view(0), frames = 0; assert.ok(Math.abs(J.EARTH_R / last.span - 0.06) < 1e-12, 'Earth starts 6% of the line across');
for (let y = 0; y <= J.TRACK; y += 0.0005) { const v = J.view(J.timeAt(y)); assert.ok(v.at >= 0 && v.at <= J.FULL + 1e-9, `the flash left the line at ${y}`); assert.ok(v.span >= last.span - 1e-3, `the view zoomed back in at ${y}`); assert.ok(Math.abs(v.at - last.at) < 0.012, `the flash jumped at ${y}`); assert.ok(v.span / last.span < 1.03, `the view jumped at ${y}`); last = v; frames++; }
assert.ok(Math.abs(last.at - J.FULL) < 1e-12 && Math.abs(last.span * J.FULL - J.LIGHT_DAY) < 1, 'at the end the line is a light-day long and the flash is at Voyager 1');
// When the flash crosses a mark, the mark is exactly where the flash is.
for (const m of J.MARKS) { const v = J.view(m.t); assert.ok(Math.abs(m.km / v.span - v.at) < 1e-12, `${m.id} is not where the flash is when it is crossed`); }
// Once the view has pulled back it holds still: the same span from hour seven to the end.
assert.ok(Math.abs(J.view(7 * 3600).span - J.view(day).span) < 1 && Math.abs(J.view(15 * 3600).span - J.view(day).span) < 1);
assert.equal(J.lastMark(0), null); assert.equal(J.lastMark(2).id, 'moon'); assert.equal(J.nextMark(2).id, 'sun'); assert.equal(J.lastMark(day).id, 'voyager1'); assert.equal(J.nextMark(day), null); assert.equal(J.nextMark(0).id, 'moon');

// The figures quoted in the closing section of the page.
const launch = Date.UTC(1977, 8, 5), arrive = Date.UTC(2026, 10, 18), years = (arrive - launch) / (365.2425 * 86400e3);
assert.ok(years > 49.19 && years < 49.21, 'forty-nine years and two months in flight');
const kms = 3.6 * au / (365.25 * 86400); assert.ok(Math.abs(kms - 17.07) < 0.01, 'Voyager 1 does about 17 km a second'); assert.ok(Math.abs(c / kms - 17565) < 20, 'light is about 17,500 times faster');
assert.ok(Math.abs(J.LIGHT_DAY / au / 3.6 - 48.1) < 0.05, 'about 48 years to the next light-day'); assert.ok(Math.abs(4.2465 * 365.25 - 1551) < 1, 'the nearest star is about 1,550 light-days off');
console.log(`ok  journey: 12 marks in order, light-times match first principles and the page's wording; ${steps} scroll positions with time never running back or jumping; ${frames} views that only ever pull back; marks meet the flash exactly; the long dark is to scale; closing figures hold`);
