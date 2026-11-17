// Site Pulse: the page. data.js makes and adds up the sample numbers; this file draws them and listens to the filters.
// Every chart is plain SVG or HTML built here. One slice of the data feeds everything, so the numbers always agree.
import { makeData, summarise, fmt, WEEKDAYS, RANGES } from './data.js';

const $ = id => document.getElementById(id), NS = 'http://www.w3.org/2000/svg';
const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role' || k === 'scope' || k === 'style') n.setAttribute(k, v); else n[k] = v; } n.append(...kids.filter(k => k != null)); return n; };
const svg = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids.filter(k => k != null)); return n; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const data = makeData(), ALL = data.sites.map(s => s.id);
const state = { range: 28, sites: new Set(ALL), sort: { key: 'visits', dir: 'descending' }, tables: { trend: false, heat: false } };
let view = null;

// ---- Small shared pieces ----
const ICON = { good: ['var(--good)', 'M4 7.2l2.1 2.1L10.2 5'], warning: ['var(--warning)', 'M7 4v3.6M7 9.9v.1'], critical: ['var(--critical)', 'M4.8 4.8l4.4 4.4M9.2 4.8L4.8 9.2'] };
function icon(level) { const [colour, mark] = ICON[level]; return svg('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' }, level === 'warning' ? svg('path', { d: 'M7 1.2l6 11H1z', fill: colour }) : svg('circle', { cx: 7, cy: 7, r: 6.2, fill: colour }), svg('path', { d: mark, fill: 'none', stroke: level === 'warning' ? '#111315' : '#fff', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); }
// A change on the period before: an arrow and a signed figure, coloured by whether that direction is good news.
function delta(x, { upIsGood = true, words = '', unit = null } = {}) { const flat = x === null || Math.abs(x) < 0.0005, good = flat ? null : (x > 0) === upIsGood, text = unit ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(2)} ${unit}` : fmt.delta(x);
  return el('span', { class: 'delta ' + (flat ? 'flat' : good ? 'good' : 'bad') }, flat ? null : el('span', { 'aria-hidden': 'true', text: x > 0 ? '▲ ' : '▼ ' }), text, words ? el('small', { text: ' ' + words }) : null); }
function sparkline(values, w = 96, h = 24) { const max = Math.max(1, ...values), min = Math.min(...values), span = Math.max(1, max - min), pt = (v, i) => [3 + i / Math.max(1, values.length - 1) * (w - 10), h - 5 - (v - min) / span * (h - 10)], pts = values.map(pt), last = pts[pts.length - 1];
  return svg('svg', { class: 'spark', width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' }, svg('polyline', { points: pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: 'var(--series)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }), svg('circle', { cx: last[0].toFixed(1), cy: last[1].toFixed(1), r: 4, fill: 'var(--series)', stroke: 'var(--card)', 'stroke-width': 2 })); }
const sample = () => el('span', { class: 'sample', text: 'Sample' });
const tip = $('tip');
function showTip(x, y, ...nodes) { tip.replaceChildren(...nodes); tip.hidden = false; const r = tip.getBoundingClientRect(); tip.style.left = clamp(x + 14, 6, innerWidth - r.width - 6) + 'px'; tip.style.top = clamp(y + 14 + r.height > innerHeight ? y - r.height - 10 : y + 14, 6, innerHeight - r.height - 6) + 'px'; }
const hideTip = () => { tip.hidden = true; };
const row = (colour, value, label) => el('div', { class: 'row' }, colour ? el('i', { style: `background:${colour}` }) : null, el('b', { text: value }), label);
const say = text => { $('live').textContent = text; };
function niceMax(v) { if (v <= 0) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p; return 10 * p; }

// ---- Filters ----
function buildFilters() {
  const ranges = RANGES.map(([n, label]) => { const b = el('button', { class: 'chip', type: 'button', role: 'radio', text: label, 'data-range': n }); b.addEventListener('click', () => { state.range = n; render(); b.focus(); }); return b; });
  $('range').append(...ranges);
  $('range').addEventListener('keydown', e => { const i = ranges.indexOf(document.activeElement), by = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0; if (i < 0 || !by) return; e.preventDefault(); ranges[(i + by + ranges.length) % ranges.length].click(); });
  const all = el('button', { class: 'chip all', type: 'button', text: 'All sites', id: 'all-sites' }); all.addEventListener('click', () => { state.sites = new Set(ALL); render(); });
  $('sites').append(all, ...data.sites.map(s => { const b = el('button', { class: 'chip', type: 'button', text: s.name, 'data-site': s.id }); b.addEventListener('click', () => { if (state.sites.has(s.id)) state.sites.delete(s.id); else state.sites.add(s.id); render(); }); return b; }));
}
function only(id) { state.sites = state.sites.size === 1 && state.sites.has(id) ? new Set(ALL) : new Set([id]); render(); }

// ---- Headline numbers ----
const span = () => RANGES.find(r => r[0] === view.range)[1], beforeWords = () => (view.weeks === 1 ? 'on the week before' : `on the ${view.weeks} weeks before`);
function renderKpis() { const t = view.totals, d = view.delta, none = view.siteCount === 0, dash = '\u2013'; // with no sites chosen there is nothing to average, so say so and do not print a nought that looks like a reading
  const tile = (label, value, change, extra = '') => el('div', { class: 'tile ' + extra }, el('div', { class: 'label' }, el('span', { text: label }), sample()), el('div', { class: 'value', text: value }), el('div', { class: 'foot' }, change));
  const hero = tile(`Visits, last ${span()}`, fmt.int(t.visits), delta(d.visits, { words: beforeWords() }), 'hero'), n = Math.min(12, view.series.length);
  hero.querySelector('.foot').append(sparkline(Array.from({ length: n }, (_, k) => { const a = Math.floor(k * view.series.length / n), b = Math.max(a + 1, Math.floor((k + 1) * view.series.length / n)); return view.series.slice(a, b).reduce((s, x) => s + x.visits, 0) / (b - a); }), 120, 28));
  $('kpis').replaceChildren(hero, tile('Daily visitors, summed', fmt.compact(t.visitors), delta(d.visitors)), tile('Pages per visit', none ? dash : t.perVisit.toFixed(2), none ? null : delta(d.perVisit)), tile('Time on site', none ? dash : fmt.secs(t.stay), none ? null : delta(d.stay)),
    tile('Typical page load', none ? dash : fmt.load(t.load), none ? null : delta(d.load, { upIsGood: false })), tile('Uptime', none ? dash : fmt.pct(t.uptime, 2), none ? null : delta(d.uptime, { unit: 'points' }))); }

// ---- Visits a day: this period over the one before ----
let trendAt = -1;
function renderTrend() { const host = $('trend').querySelector('.view'), s = view.series, n = s.length, had = host.contains(document.activeElement) && document.activeElement.classList.contains('plot'); $('trend-sub').textContent = `${fmt.day(view.from)} to ${fmt.day(view.to)}, over ${fmt.day(view.beforeFrom)} to ${fmt.day(view.beforeTo)}`;
  if (state.tables.trend) { const t = el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Day' }), el('th', { scope: 'col', class: 'r', text: 'Visits' }), el('th', { scope: 'col', text: 'Day in the period before' }), el('th', { scope: 'col', class: 'r', text: 'Visits then' }))), el('tbody', {}, ...s.map(d => el('tr', {}, el('th', { scope: 'row', text: fmt.day(d.date) }), el('td', { class: 'r', text: fmt.int(d.visits) }), el('td', { text: fmt.day(d.beforeDate) }), el('td', { class: 'r', text: fmt.int(d.before) })))));
    host.replaceChildren(el('div', { class: 'scroll', tabIndex: 0, role: 'region', 'aria-label': 'Visits a day, as a table', style: 'max-height:270px;overflow-y:auto' }, t)); return; }
  const W = Math.max(280, host.clientWidth || 720), H = 250, L = 42, R = W < 480 ? 14 : 74, T = 10, B = 22, pw = W - L - R, ph = H - T - B, top = niceMax(Math.max(...s.map(d => Math.max(d.visits, d.before)))), X = i => L + (n === 1 ? pw / 2 : i / (n - 1) * pw), Y = v => T + ph - v / top * ph;
  const path = key => s.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d[key]).toFixed(1)}`).join(''), g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'presentation' });
  for (let k = 0; k <= 4; k++) { const v = top * k / 4; g.append(svg('line', { class: 'gridline', x1: L, x2: W - R, y1: Y(v), y2: Y(v) }), Object.assign(svg('text', { class: 'tick', x: L - 6, y: Y(v) + 3, 'text-anchor': 'end' }), { textContent: top >= 10000 ? fmt.compact(v) : fmt.int(v) })); }
  const every = Math.max(1, Math.round(n / (W < 480 ? 4 : 7))); for (let i = n - 1; i >= 0; i -= every) g.append(Object.assign(svg('text', { class: 'tick', x: X(i), y: H - 6, 'text-anchor': i === n - 1 && R < 20 ? 'end' : 'middle' }), { textContent: fmt.day(s[i].date) }));
  g.append(svg('path', { d: `${path('visits')}L${X(n - 1).toFixed(1)},${Y(0)}L${X(0).toFixed(1)},${Y(0)}Z`, fill: 'var(--series)', opacity: 0.1 }), svg('path', { d: path('before'), fill: 'none', stroke: 'var(--deemph)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }), svg('path', { d: path('visits'), fill: 'none', stroke: 'var(--series)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    svg('circle', { cx: X(n - 1), cy: Y(s[n - 1].visits), r: 4, fill: 'var(--series)', stroke: 'var(--card)', 'stroke-width': 2 }));
  if (R > 20) { const yn = Y(s[n - 1].visits), yb = Y(s[n - 1].before), label = (y, text) => g.append(Object.assign(svg('text', { class: 'tick', x: X(n - 1) + 9, y: y + 3, style: 'fill:var(--muted)' }), { textContent: text })); label(yn, 'This period'); if (Math.abs(yn - yb) >= 13) label(yb, 'Before'); } // name the lines at their ends when there is room; the legend is always there
  const cross = svg('g', { visibility: 'hidden' }, svg('line', { y1: T, y2: T + ph, stroke: 'var(--faint)', 'stroke-width': 1 }), svg('circle', { r: 4, fill: 'var(--deemph)', stroke: 'var(--card)', 'stroke-width': 2 }), svg('circle', { r: 4, fill: 'var(--series)', stroke: 'var(--card)', 'stroke-width': 2 })); g.append(cross);
  const plot = el('div', { class: 'plot', tabIndex: 0, role: 'group', 'aria-label': `Visits a day for ${n} days, as a line. Use the left and right arrow keys to read each day, or switch to the table view.` }, g);
  const point = (i, px, py) => { trendAt = i; const d = s[i]; cross.setAttribute('visibility', 'visible'); cross.children[0].setAttribute('x1', X(i)); cross.children[0].setAttribute('x2', X(i)); cross.children[1].setAttribute('cx', X(i)); cross.children[1].setAttribute('cy', Y(d.before)); cross.children[2].setAttribute('cx', X(i)); cross.children[2].setAttribute('cy', Y(d.visits));
    const box = g.getBoundingClientRect(), k = box.width / W; showTip(px ?? box.left + X(i) * k, py ?? box.top + Y(d.visits) * k, el('div', { class: 'when', text: fmt.day(d.date) }), row('var(--series)', fmt.int(d.visits), 'visits'), row('var(--deemph)', fmt.int(d.before), `on ${fmt.day(d.beforeDate)}`)); };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); hideTip(); };
  plot.addEventListener('pointermove', e => { const box = g.getBoundingClientRect(), x = (e.clientX - box.left) / box.width * W; point(clamp(Math.round((x - L) / pw * (n - 1)), 0, n - 1), e.clientX, e.clientY); }); plot.addEventListener('pointerleave', leave); plot.addEventListener('blur', leave);
  plot.addEventListener('keydown', e => { const by = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[e.key]; if (e.key === 'Escape') { leave(); return; } if (!by) return; e.preventDefault(); const i = clamp((trendAt < 0 || trendAt >= n ? n - 1 - Math.sign(by) : trendAt) + by, 0, n - 1); point(i); say(`${fmt.day(s[i].date)}: ${fmt.int(s[i].visits)} visits. ${fmt.int(s[i].before)} on ${fmt.day(s[i].beforeDate)}.`); });
  host.replaceChildren(plot); trendAt = -1; if (had) plot.focus({ preventScroll: true }); } // a redraw (the window changed size) must not take the keyboard away

// ---- What stands out, and the deploys ----
function renderNotes() { const list = $('notes').querySelector('.list'); list.replaceChildren(...(view.notes.length ? view.notes.slice(0, 7).map(n => el('li', {}, icon(n.level), el('span', { class: 'wrap' }, el('span', { class: 'sr', text: { good: 'Good news: ', warning: 'Warning: ', critical: 'Problem: ' }[n.level] }), n.text))) : [el('li', {}, icon('good'), el('span', { text: view.siteCount ? 'Nothing stands out. Every chosen site is healthy and steady.' : 'No sites are chosen.' }))])); }
function renderDeploys() { const list = $('deploys').querySelector('.list'), ago = d => (d === 0 ? 'on the last day' : d === 1 ? '1 day before' : `${d} days before`);
  list.replaceChildren(...(view.deploys.length ? view.deploys.slice(0, 8).map(d => el('li', {}, icon(d.ok ? 'good' : 'warning'), el('span', { class: 'sr', text: d.ok ? 'Fine: ' : 'Warning: ' }), el('span', { class: 'wrap' }, el('strong', { text: d.siteName }), d.ok ? ` deployed in ${fmt.secs(d.seconds)}` : ` failed after ${fmt.secs(d.seconds)}`), el('span', { class: 'when', text: `${fmt.day(d.date)}, ${ago(d.daysAgo)}` }))) : [el('li', {}, icon('good'), el('span', { text: 'No deploys in this period.' }))])); }

// ---- Every site: the table ----
const COLS = [['name', 'Site'], ['status', 'State'], ['visits', 'Visits', 'r'], ['delta', 'Change', 'r'], ['spark', 'Trend'], ['topSource', 'Top source'], ['load', 'Typical load', 'r'], ['uptime', 'Uptime', 'r'], ['deploy', 'Last deploy']];
const STATE = { healthy: ['good', 'Healthy'], slow: ['warning', 'Slow'], outage: ['critical', 'Had an outage'] }, RANK = { outage: 0, slow: 1, healthy: 2 };
const sortValue = { name: s => s.name.toLowerCase(), status: s => RANK[s.status] - (s.outage && s.slow ? 0.5 : 0), visits: s => s.visits, delta: s => (s.delta === null ? Infinity : s.delta), topSource: s => s.topSource, load: s => s.load, uptime: s => s.uptime, deploy: s => (s.deploy ? s.deploy.daysAgo : Infinity) };
const firstWay = k => (k === 'name' || k === 'topSource' || k === 'status' || k === 'deploy' || k === 'load' || k === 'uptime' ? 'ascending' : 'descending'); // the first press sorts the way that is most use: A to Z, trouble first, newest first, fastest first, lowest uptime first; numbers of visits largest first
function renderTable() { const head = $('table').querySelector('thead tr'), body = $('table').querySelector('tbody'), { key, dir } = state.sort;
  head.replaceChildren(...COLS.map(([k, label, cls]) => { const th = el('th', { scope: 'col', class: cls || '' }); if (!sortValue[k]) { th.textContent = label; return th; } th.setAttribute('aria-sort', k === key ? dir : 'none'); const b = el('button', { type: 'button', text: label, 'data-sort': k });
    b.addEventListener('click', () => { state.sort = { key: k, dir: k === key ? (dir === 'descending' ? 'ascending' : 'descending') : firstWay(k) }; renderTable(); $('table').querySelector(`[data-sort="${k}"]`).focus(); say(`Sorted by ${label}, ${state.sort.dir}.`); }); th.append(b); return th; }));
  const f = sortValue[key], rows = [...view.sites].sort((a, b) => { const x = f(a), y = f(b), c = x < y ? -1 : x > y ? 1 : 0; return (dir === 'ascending' ? c : -c) || a.name.localeCompare(b.name); }); // ties always run A to Z, whichever way the column is sorted
  if (!rows.length) { body.replaceChildren(el('tr', {}, el('td', { colSpan: COLS.length }, el('p', { class: 'empty', text: 'No sites are chosen. Press All sites, or pick one above.' })))); return; }
  body.replaceChildren(...rows.map(s => { const [level, word] = STATE[s.status], name = el('button', { class: 'sitebtn', type: 'button', text: s.name, 'data-only': s.id, title: `Show only ${s.name}` }); name.addEventListener('click', () => { only(s.id); const again = document.querySelector(`[data-only="${s.id}"]`); if (again) again.focus(); });
    return el('tr', {}, el('th', { scope: 'row' }, name), el('td', {}, el('span', { class: 'status' }, icon(level), word), s.outage && s.slow ? el('span', { class: 'status also' }, icon('warning'), 'Slow') : null), el('td', { class: 'r', text: fmt.int(s.visits) }), el('td', { class: 'r' }, delta(s.delta)), el('td', {}, sparkline(s.spark)),
      el('td', {}, s.topSource, el('span', { class: 'muted', text: ` ${fmt.pct(s.topShare)}` })), el('td', { class: 'r', text: fmt.load(s.load) }), el('td', { class: 'r', text: fmt.pct(s.uptime, 2) }),
      el('td', {}, s.deploy ? el('span', { class: 'status' }, icon(s.deploy.ok ? 'good' : 'warning'), `${s.deploy.ok ? 'Fine' : 'Failed'}, ${fmt.day(s.deploy.date)}`) : el('span', { class: 'muted', text: 'None in this period' }))); })); }

// ---- Ranked bars: sources, and what people read on ----
function bars(host, items, figure, describe) { const top = Math.max(1, ...items.map(i => i.visits)), meters = host.classList.contains('meters');
  host.replaceChildren(...items.map(i => { const li = el('li', { tabIndex: 0 }, el('span', { class: 'name', text: i.name }), el('span', { class: 'fig' }, ...figure(i)), el('span', { class: 'track', 'aria-hidden': 'true' }, i.visits > 0 ? el('i', { style: `width:${(meters ? i.share : i.visits / top) * 100}%` }) : null));
    const show = (x, y) => showTip(x, y, el('div', { class: 'when', text: i.name }), ...describe(i)); li.addEventListener('pointermove', e => show(e.clientX, e.clientY)); li.addEventListener('pointerleave', hideTip); li.addEventListener('focus', () => { const r = li.getBoundingClientRect(); show(r.left + 40, r.bottom - 6); }); li.addEventListener('blur', hideTip); return li; })); }
function renderSources() { bars($('sources').querySelector('.bars'), view.sources, i => [fmt.int(i.visits), el('small', {}, `${i.pct}% `, delta(i.delta))], i => [row('var(--series)', fmt.int(i.visits), 'visits'), row(null, fmt.pct(i.share, 1), 'of all visits'), row(null, fmt.delta(i.delta), beforeWords())]); }
function renderDevices() { bars($('devices').querySelector('.bars'), view.devices, i => [`${i.pct}%`, el('small', { text: fmt.int(i.visits) })], i => [row('var(--series)', fmt.pct(i.share, 1), 'of all visits'), row(null, fmt.int(i.visits), 'visits')]); }

// ---- When people visit: seven days by twenty-four hours ----
let heatAt = null;
const hourSpan = h => `${String(h).padStart(2, '0')}:00 to ${String((h + 1) % 24).padStart(2, '0')}:00`;
function renderHeat() { const host = $('heat').querySelector('.view'), m = view.heat, flat = m.flat(), top = Math.max(...flat), low = Math.min(...flat), had = host.contains(document.activeElement) && document.activeElement.classList.contains('plot');
  const step = v => (v <= 0 ? 0 : top <= low ? 3 : clamp(1 + Math.floor((v - low) / (top - low) * 5 - 1e-9), 1, 5)); // five shades spread between the quietest hour and the busiest; an hour with no visits at all gets the empty shade
  const avg = v => fmt.int(Math.round(v));
  if (state.tables.heat) { host.replaceChildren(el('div', { class: 'scroll', tabIndex: 0, role: 'region', 'aria-label': 'Average visits by day and hour, as a table', style: 'max-height:270px;overflow-y:auto' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Hour (UTC)' }), ...WEEKDAYS.map(d => el('th', { scope: 'col', class: 'r', text: d })))), el('tbody', {}, ...Array.from({ length: 24 }, (_, h) => el('tr', {}, el('th', { scope: 'row', text: hourSpan(h) }), ...m.map(r => el('td', { class: 'r', text: avg(r[h]) })))))))); return; }
  const W = Math.max(280, host.clientWidth || 560), L = 34, T = 16, cw = (W - L) / 24, ch = Math.max(16, Math.min(26, cw)), H = T + ch * 7, g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'presentation' }), cells = svg('g', { class: 'cells' }), cursor = svg('rect', { class: 'cursor', width: cw, height: ch, visibility: 'hidden' });
  for (let h = 0; h < 24; h += 3) g.append(Object.assign(svg('text', { class: 'tick', x: L + h * cw + 1, y: 10 }), { textContent: String(h).padStart(2, '0') }));
  m.forEach((r, d) => { g.append(Object.assign(svg('text', { class: 'tick', x: 0, y: T + d * ch + ch / 2 + 3 }), { textContent: WEEKDAYS[d] })); r.forEach((v, h) => cells.append(svg('rect', { x: L + h * cw + 1, y: T + d * ch + 1, width: cw - 2, height: ch - 2, fill: `var(--h${step(v)})`, 'data-d': d, 'data-h': h }))); }); g.append(cells, cursor);
  const plot = el('div', { class: 'plot', tabIndex: 0, role: 'group', 'aria-label': 'Average visits by day of the week and hour of the day, as a grid of shaded squares. Use the arrow keys to read each square, or switch to the table view.' }, g);
  const point = (d, h, px, py) => { heatAt = [d, h]; cursor.setAttribute('visibility', 'visible'); cursor.setAttribute('x', L + h * cw); cursor.setAttribute('y', T + d * ch); const box = g.getBoundingClientRect(), k = box.width / W; showTip(px ?? box.left + (L + (h + 1) * cw) * k, py ?? box.top + (T + d * ch) * k, el('div', { class: 'when', text: `${WEEKDAYS[d]}, ${hourSpan(h)}` }), row(`var(--h${Math.max(1, step(m[d][h]))})`, avg(m[d][h]), view.weeks === 1 ? 'visits' : 'visits on average')); };
  const leave = () => { cursor.setAttribute('visibility', 'hidden'); hideTip(); };
  cells.addEventListener('pointermove', e => { const t = e.target; if (t.dataset.d !== undefined) point(Number(t.dataset.d), Number(t.dataset.h), e.clientX, e.clientY); }); plot.addEventListener('pointerleave', leave); plot.addEventListener('blur', leave);
  plot.addEventListener('keydown', e => { const by = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key]; if (e.key === 'Escape') { leave(); return; } if (!by) return; e.preventDefault(); const [d, h] = heatAt ? [clamp(heatAt[0] + by[0], 0, 6), clamp(heatAt[1] + by[1], 0, 23)] : [0, 0]; point(d, h); say(`${WEEKDAYS[d]}, ${hourSpan(h)}: ${avg(m[d][h])} visits${view.weeks === 1 ? '' : ' on average'}.`); }); // the first press reads Monday at midnight
  const scale = top > 0 ? el('div', { class: 'scale', 'aria-hidden': 'true' }, 'Fewer', ...[1, 2, 3, 4, 5].map(k => el('i', { style: `background:var(--h${k})` })), 'More', el('span', { text: ` (from ${avg(low)} to ${avg(top)} visits in the hour${view.weeks === 1 ? '' : ', on average'})` })) : null;
  host.replaceChildren(...[plot, scale].filter(Boolean)); heatAt = null; if (had) plot.focus({ preventScroll: true }); }

// ---- Most read pages ----
function renderPages() { const body = $('pages').querySelector('tbody'), rows = view.pages.slice(0, 10), top = Math.max(1, rows.length ? rows[0].views : 1);
  body.replaceChildren(...(rows.length ? rows.map(p => el('tr', {}, el('th', { scope: 'row' }, p.title, el('span', { class: 'muted', text: ' ' + p.path })), el('td', { text: p.siteName }), el('td', { class: 'r', text: fmt.int(p.views) }), el('td', { style: 'width:28%' }, el('span', { class: 'meter', 'aria-hidden': 'true', style: 'width:100%;margin:0;background:transparent' }, el('i', { style: `width:${p.views / top * 100}%;background:var(--series);border-radius:0 2px 2px 0` }))))) : [el('tr', {}, el('td', { colSpan: 4 }, el('p', { class: 'empty', text: 'No sites are chosen.' })))])); }

// ---- Putting it together ----
function render() { view = summarise(data, { range: state.range, sites: [...state.sites] }); hideTip();
  for (const b of $('range').querySelectorAll('button')) { const on = Number(b.dataset.range) === state.range; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  for (const b of $('sites').querySelectorAll('[data-site]')) b.setAttribute('aria-pressed', String(state.sites.has(b.dataset.site))); $('all-sites').setAttribute('aria-pressed', String(state.sites.size === ALL.length));
  const which = view.siteCount === ALL.length ? 'all eight sites' : view.siteCount === 1 ? view.sites[0].name : view.siteCount === 0 ? 'no sites' : `${view.siteCount} sites`;
  $('period').textContent = `${fmt.day(view.from)} to ${fmt.day(view.to)} 2026, ${which}, compared with the ${view.weeks === 1 ? 'week' : view.weeks + ' weeks'} before.`;
  renderKpis(); renderTrend(); renderNotes(); renderTable(); renderSources(); renderHeat(); renderDevices(); renderPages(); renderDeploys();
  say(`${fmt.int(view.totals.visits)} visits in the last ${span()} across ${which}.`); }
for (const b of document.querySelectorAll('.astable')) b.addEventListener('click', () => { const k = b.dataset.for; state.tables[k] = !state.tables[k]; b.setAttribute('aria-pressed', String(state.tables[k])); hideTip(); if (k === 'trend') renderTrend(); else renderHeat(); });
let wide = 0; new ResizeObserver(() => { const w = $('trend').clientWidth + $('heat').clientWidth; if (w !== wide && view) { wide = w; renderTrend(); renderHeat(); } }).observe(document.querySelector('.grid')); // the two drawn charts fit their cards
addEventListener('scroll', hideTip, { passive: true });
buildFilters(); render();
window.sitePulse = { state: () => ({ range: state.range, sites: [...state.sites], sort: { ...state.sort }, tables: { ...state.tables } }), view: () => view, set(o) { if (o.range !== undefined) { if (!RANGES.some(r => r[0] === o.range)) throw new Error('The range must be 7, 28 or 91 days'); state.range = o.range; } if (o.sites) state.sites = new Set(o.sites.filter(id => ALL.includes(id))); render(); } }; // for the automated checks
