// Site Pulse: the numbers. Everything here is SAMPLE DATA, made up by rule from a fixed seed, so the page looks the same
// every time and nothing real is shown. No drawing and no page: this file can be checked in Node.
export const END = '2026-11-16'; // the last full day in the sample
export const DAYS = 182; // twenty-six whole weeks: enough for a 13-week view and the 13 weeks before it
export const RANGES = [[7, '1 week'], [28, '4 weeks'], [91, '13 weeks']]; // whole weeks only, so every weekday is counted equally and each period lines up with the one before
export const SOURCES = ['Search', 'Direct', 'Social', 'Other sites', 'Newsletter', 'AI assistants'];
export const DEVICES = ['Desktop', 'Phone', 'Tablet'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Eight sites. base: visits on an ordinary day. grow: change across the whole sample. week: Monday to Sunday.
// mix: share by source. dev: share by device. peak: the hour (UTC) reading is busiest. load: typical page load in ms.
const SITES = [
  { id: 'ai-resource-hub', name: 'AI Resource Hub', base: 1350, grow: 0.34, week: [1.08, 1.12, 1.1, 1.06, 0.98, 0.72, 0.7], mix: [46, 18, 9, 8, 7, 12], dev: [62, 34, 4], peak: 14, load: 1180, ppv: 2.6, stay: 96,
    pages: [['/', 'Home', 24], ['/models', 'Model index', 21], ['/compare', 'Compare models', 16], ['/pricing', 'Price tracker', 13], ['/news', 'Latest', 10], ['/benchmarks', 'Benchmarks', 9], ['/glossary', 'Glossary', 7]] },
  { id: 'gametrackdaily', name: 'GameTrackDaily', base: 890, grow: 0.12, week: [0.86, 0.84, 0.88, 0.92, 1.08, 1.3, 1.26], mix: [38, 22, 21, 9, 6, 4], dev: [41, 54, 5], peak: 19, load: 1640, ppv: 3.1, stay: 142,
    pages: [['/', 'Today', 30], ['/releases', 'Release calendar', 22], ['/deals', 'Deals', 15], ['/play', 'Mini-games', 13], ['/reviews', 'Reviews', 11], ['/charts', 'Charts', 9]] },
  { id: 'axy-lusion', name: 'Axy Lusion', base: 610, grow: 0.2, week: [0.9, 0.88, 0.92, 0.96, 1.04, 1.22, 1.2], mix: [21, 19, 41, 10, 6, 3], dev: [38, 55, 7], peak: 20, load: 2680, ppv: 4.2, stay: 118,
    pages: [['/', 'Home', 27], ['/gallery', 'Gallery', 31], ['/series', 'Series', 14], ['/prints', 'Prints', 11], ['/about', 'About', 9], ['/process', 'Process', 8]] },
  { id: 'news-atlas', name: 'News Atlas', base: 540, grow: -0.08, week: [1.1, 1.08, 1.06, 1.04, 1.0, 0.8, 0.78], mix: [33, 27, 12, 14, 9, 5], dev: [57, 39, 4], peak: 7, load: 2860, ppv: 2.2, stay: 74,
    pages: [['/', 'Front page', 41], ['/world', 'World', 16], ['/tech', 'Technology', 15], ['/map', 'Story map', 12], ['/briefing', 'Morning briefing', 10], ['/archive', 'Archive', 6]] },
  { id: 'kols-korner', name: 'Kol’s Korner', base: 420, grow: 0.26, week: [1.04, 1.1, 1.08, 1.02, 0.96, 0.82, 0.86], mix: [29, 21, 24, 8, 14, 4], dev: [55, 41, 4], peak: 8, load: 940, ppv: 1.8, stay: 164,
    pages: [['/', 'Home', 22], ['/posts/ai-efficiency-burnout', 'AI’s efficiency promise has a catch', 19], ['/digest', 'Daily digest', 24], ['/posts/mars-rover-ai-navigation', 'Mars rover navigation', 12], ['/posts/jpmorgan-ai-infrastructure', 'JPMorgan and AI infrastructure', 10], ['/about', 'About', 7], ['/posts/welcome', 'Welcome', 6]] },
  { id: 'stackscout', name: 'StackScout', base: 330, grow: 0.42, week: [1.12, 1.14, 1.12, 1.08, 0.98, 0.62, 0.6], mix: [52, 17, 6, 11, 4, 10], dev: [78, 20, 2], peak: 15, load: 1020, ppv: 2.9, stay: 88,
    pages: [['/', 'Home', 26], ['/tools', 'Tool directory', 29], ['/stacks', 'Stacks', 17], ['/compare', 'Compare', 14], ['/new', 'New this week', 14]] },
  { id: 'ghost-in-the-models', name: 'Ghost in the Models', base: 260, grow: 0.05, week: [1.0, 1.02, 1.04, 1.02, 1.0, 0.94, 0.96], mix: [24, 26, 28, 11, 8, 3], dev: [49, 46, 5], peak: 21, load: 1360, ppv: 2.0, stay: 131,
    pages: [['/', 'Home', 34], ['/episodes', 'Episodes', 28], ['/transcripts', 'Transcripts', 16], ['/notes', 'Notes', 13], ['/about', 'About', 9]] },
  { id: 'elusion-works', name: 'Elusion Works', base: 180, grow: 0.16, week: [1.06, 1.1, 1.08, 1.04, 0.98, 0.84, 0.82], mix: [27, 31, 17, 15, 5, 5], dev: [66, 30, 4], peak: 11, load: 1090, ppv: 3.4, stay: 109,
    pages: [['/', 'Home', 31], ['/demos', 'Demos', 33], ['/work', 'Work', 15], ['/contact', 'Contact', 11], ['/privacy', 'Privacy', 10]] },
];
// Things that happened in the sample: a post that travelled, and two bad days. day counts back from the last day (0).
const EVENTS = [
  { site: 'kols-korner', day: 12, lift: 4.6, tail: 4, source: 2 }, // a post shared widely on social
  { site: 'ai-resource-hub', day: 39, lift: 2.3, tail: 6, source: 0 }, // a model launch drives search
  { site: 'gametrackdaily', day: 67, lift: 2.0, tail: 3, source: 2 },
  { site: 'stackscout', day: 5, lift: 1.9, tail: 5, source: 5 }, // picked up by AI assistants
  { site: 'axy-lusion', day: 101, lift: 2.6, tail: 4, source: 2 },
];
const OUTAGES = [{ site: 'news-atlas', day: 3, minutes: 214 }, { site: 'news-atlas', day: 17, minutes: 96 }, { site: 'axy-lusion', day: 44, minutes: 38 }, { site: 'gametrackdaily', day: 120, minutes: 71 }, { site: 'news-atlas', day: 133, minutes: 55 }];

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Share a whole number out by weights so the parts are whole numbers that add up exactly.
export function share(total, weights) { const sum = weights.reduce((a, b) => a + b, 0), raw = weights.map(w => (sum > 0 ? total * w / sum : 0)), out = raw.map(Math.floor); let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]); for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k][1]]++; return out; }
const iso = d => d.toISOString().slice(0, 10);

export function makeData(seed = 20261117) {
  const rnd = mulberry(seed), end = new Date(END + 'T00:00:00Z'), days = Array.from({ length: DAYS }, (_, i) => iso(new Date(end.getTime() - (DAYS - 1 - i) * 86400000)));
  const sites = SITES.map(s => { const visits = [], visitors = [], views = [], stay = [], load = [], down = [], sources = [], devices = [], hours = [];
    for (let i = 0; i < DAYS; i++) { const back = DAYS - 1 - i, dow = (new Date(days[i] + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0 is Monday
      let lift = 1, pushed = -1; for (const e of EVENTS) if (e.site === s.id && back <= e.day && back > e.day - e.tail) { const k = (e.day - back) / e.tail; lift = 1 + (e.lift - 1) * Math.pow(1 - k, 1.6); pushed = e.source; }
      const out = OUTAGES.find(o => o.site === s.id && o.day === back), lost = out ? out.minutes / 1440 : 0;
      const v = Math.max(0, Math.round(s.base * (1 + s.grow * (i / (DAYS - 1) - 0.5)) * s.week[dow] * (0.9 + rnd() * 0.2) * lift * (1 - lost * 0.9)));
      visits.push(v); visitors.push(Math.min(v, Math.round(v * (0.74 + rnd() * 0.08)))); views.push(Math.round(v * s.ppv * (0.92 + rnd() * 0.16))); stay.push(Math.round(s.stay * (0.88 + rnd() * 0.24)));
      load.push(Math.round(s.load * (0.9 + rnd() * 0.22) * (out ? 1.8 : 1))); down.push(out ? out.minutes : 0);
      const mix = s.mix.map((m, k) => m * (0.85 + rnd() * 0.3) * (k === pushed ? lift * 1.6 : 1)); sources.push(share(v, mix)); devices.push(share(v, s.dev.map(d => d * (0.9 + rnd() * 0.2))));
      const shift = dow >= 5 ? 2 : 0, curve = Array.from({ length: 24 }, (_, h) => { const d = Math.min(Math.abs(h - s.peak - shift), 24 - Math.abs(h - s.peak - shift)); return 0.25 + Math.exp(-d * d / 26) * 1.6 + (h >= 1 && h <= 5 ? -0.12 : 0) + rnd() * 0.12; }); hours.push(share(v, curve)); }
    return { id: s.id, name: s.name, pages: s.pages.map(([path, title, weight]) => ({ path, title, weight })), visits, visitors, views, stay, load, down, sources, devices, hours }; });
  // Deploys: a few a week per site, most fine, the odd one failing.
  const deploys = []; for (const s of sites) for (let i = 0; i < DAYS; i++) if (rnd() < 0.2) deploys.push({ site: s.id, day: i, date: days[i], ok: rnd() > 0.08, seconds: Math.round(40 + rnd() * 130) });
  return { seed, end: END, days, sites, deploys };
}

const sum = a => a.reduce((x, y) => x + y, 0);
// The middle value when each value counts as many times as its weight: here, the page load a typical visit met.
function weightedMedian(pairs) { const list = pairs.filter(p => p[1] > 0).sort((a, b) => a[0] - b[0]), total = sum(list.map(p => p[1])); let run = 0; for (const [value, weight] of list) { run += weight; if (run * 2 >= total) return value; } return 0; }
export const change = (now, before) => (before > 0 ? (now - before) / before : now > 0 ? null : 0); // null: nothing to compare with
const LEVEL = { critical: 0, warning: 1, good: 2 };
export const SLOW_MS = 2500;

// Everything the page shows, for one choice of time range and sites. The same slice feeds every chart, so the numbers agree.
export function summarise(data, { range = 28, sites = null } = {}) {
  if (!RANGES.some(r => r[0] === range)) throw new Error('The range must be 7, 28 or 91 days');
  const chosen = data.sites.filter(s => !sites || sites.includes(s.id)), to = DAYS - 1, from = to - range + 1, pFrom = from - range, idx = Array.from({ length: range }, (_, k) => from + k), pIdx = idx.map(i => i - range), weeks = range / 7;
  const tot = (list, ix) => { const visits = sum(list.map(s => sum(ix.map(i => s.visits[i])))), visitors = sum(list.map(s => sum(ix.map(i => s.visitors[i])))), views = sum(list.map(s => sum(ix.map(i => s.views[i]))));
    const stay = visits ? Math.round(sum(list.map(s => sum(ix.map(i => s.stay[i] * s.visits[i])))) / visits) : 0, load = weightedMedian(list.flatMap(s => ix.map(i => [s.load[i], s.visits[i]]))), downMin = sum(list.map(s => sum(ix.map(i => s.down[i]))));
    return { visits, visitors, views, perVisit: visits ? views / visits : 0, stay, load, downMinutes: downMin, uptime: list.length ? 1 - downMin / (list.length * ix.length * 1440) : null }; };
  const totals = tot(chosen, idx), prev = tot(chosen, pIdx);
  const delta = { visits: change(totals.visits, prev.visits), visitors: change(totals.visitors, prev.visitors), views: change(totals.views, prev.views), perVisit: change(totals.perVisit, prev.perVisit), stay: change(totals.stay, prev.stay), load: change(totals.load, prev.load), uptime: totals.uptime === null ? 0 : totals.uptime - prev.uptime };
  const series = idx.map((i, k) => ({ date: data.days[i], visits: sum(chosen.map(s => s.visits[i])), before: sum(chosen.map(s => s.visits[pIdx[k]])), beforeDate: data.days[pIdx[k]] }));
  const perSite = chosen.map(s => { const one = tot([s], idx), was = tot([s], pIdx), src = SOURCES.map((_, k) => sum(idx.map(i => s.sources[i][k]))), top = src.indexOf(Math.max(...src));
    const last = [...data.deploys].reverse().find(d => d.site === s.id && d.day >= from && d.day <= to), outage = one.downMinutes > 0, slow = one.load > SLOW_MS; // the last deploy inside the period, to agree with the rest of the page
    return { id: s.id, name: s.name, status: outage ? 'outage' : slow ? 'slow' : 'healthy', outage, slow, visits: one.visits, before: was.visits, delta: change(one.visits, was.visits), spark: idx.map(i => s.visits[i]), topSource: SOURCES[top], topShare: one.visits ? src[top] / one.visits : 0, load: one.load, uptime: one.uptime, downMinutes: one.downMinutes,
      deploy: last ? { daysAgo: to - last.day, ok: last.ok, date: last.date } : null }; }).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  // Shares are whole percentages that add up to 100, shared out the same way as everything else.
  const withPct = list => { const pct = share(totals.visits ? 100 : 0, list.map(x => x.visits)); return list.map((x, k) => ({ ...x, pct: pct[k] })); };
  const sources = withPct(SOURCES.map((name, k) => { const v = sum(chosen.map(s => sum(idx.map(i => s.sources[i][k])))), b = sum(chosen.map(s => sum(pIdx.map(i => s.sources[i][k])))); return { name, visits: v, share: totals.visits ? v / totals.visits : 0, delta: change(v, b) }; }).sort((a, b) => b.visits - a.visits));
  const devices = withPct(DEVICES.map((name, k) => { const v = sum(chosen.map(s => sum(idx.map(i => s.devices[i][k])))); return { name, visits: v, share: totals.visits ? v / totals.visits : 0 }; }));
  // The week: average visits in each hour of each weekday. A whole number of weeks means every weekday is counted the same number of times.
  const heatSum = WEEKDAYS.map(() => new Array(24).fill(0)); for (const s of chosen) for (const i of idx) { const dow = (new Date(data.days[i] + 'T00:00:00Z').getUTCDay() + 6) % 7; for (let h = 0; h < 24; h++) heatSum[dow][h] += s.hours[i][h]; }
  const heat = heatSum.map(r => r.map(v => v / weeks));
  const pages = chosen.flatMap(s => { const v = sum(idx.map(i => s.views[i])), parts = share(v, s.pages.map(p => p.weight)); return s.pages.map((p, k) => ({ site: s.id, siteName: s.name, path: p.path, title: p.title, views: parts[k] })); }).sort((a, b) => b.views - a.views || a.path.localeCompare(b.path));
  const deploys = data.deploys.filter(d => d.day >= from && d.day <= to && chosen.some(s => s.id === d.site)).sort((a, b) => b.day - a.day || a.site.localeCompare(b.site)).map(d => ({ ...d, siteName: data.sites.find(s => s.id === d.site).name, daysAgo: to - d.day }));
  const notes = []; // plain sentences about what stands out
  for (const s of perSite) if (s.outage) notes.push({ level: 'critical', site: s.id, text: `${s.name} was down for ${s.downMinutes} minutes in this period.` });
  for (const s of perSite) if (s.slow) notes.push({ level: 'warning', site: s.id, text: `${s.name} is slow: a typical visit waits ${(s.load / 1000).toFixed(1)} seconds for a page.` });
  for (const d of deploys.filter(d => !d.ok).slice(0, 3)) notes.push({ level: 'warning', site: d.site, text: `A deploy of ${d.siteName} failed on ${fmt.day(d.date)}.` });
  for (const s of perSite) if (s.delta !== null && s.delta < -0.15) notes.push({ level: 'warning', site: s.id, text: `${s.name} is down ${Math.round(-s.delta * 100)}% on the ${weeks === 1 ? 'week' : weeks + ' weeks'} before.` });
  for (const s of perSite) if (s.delta !== null && s.delta > 0.25) notes.push({ level: 'good', site: s.id, text: `${s.name} is up ${Math.round(s.delta * 100)}% on the ${weeks === 1 ? 'week' : weeks + ' weeks'} before.` });
  notes.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]); // worst first; within a level, the order above
  return { range, weeks, from: data.days[from], to: data.days[to], beforeFrom: data.days[pFrom], beforeTo: data.days[from - 1], siteCount: chosen.length, totals, prev, delta, series, sites: perSite, sources, devices, heat, heatSum, pages, deploys, notes };
}

// Numbers as people read them.
export const fmt = { int: n => Math.round(n).toLocaleString('en-GB'), compact: n => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : Math.round(n).toLocaleString('en-GB')),
  pct: (x, dp = 0) => (x * 100).toFixed(dp) + '%', delta: x => (x === null ? 'new' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0) + '%'), secs: s => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`), load: ms => (ms / 1000).toFixed(2) + ' s',
  day: iso => { const d = new Date(iso + 'T00:00:00Z'); return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`; } };
