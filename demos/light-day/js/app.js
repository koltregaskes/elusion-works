// One light-day: the page. Reads how far you have scrolled, asks journey.js what time that is, and draws it.
import * as J from './journey.js';

const $ = id => document.getElementById(id);
const track = $('track'), stage = $('stage'), sky = $('sky'), ctx = sky.getContext('2d'), hero = document.querySelector('.hero');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const INK = '#f4f5f3', GREEN = '#3fe08a', BG = '#111315', MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

let W = 0, H = 0, dpr = 1, unit = 1, geo = null; // geo: where Earth is drawn, which way the line runs, and how long it is on screen
let y = 0, t = 0, real = null, queued = false, shown = { rings: [], labels: [], bodies: {} };

// Stars: the same scatter every time, so the picture does not change between visits. They are far away and do not move.
const stars = (() => { let s = 20261118; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; return Array.from({ length: 170 }, () => ({ x: r(), y: r(), a: 0.18 + r() * 0.42, z: r() < 0.12 ? 1.5 : 1 })); })();

function layout() {
  W = stage.clientWidth; H = stage.clientHeight; unit = H || 1; dpr = Math.min(2, devicePixelRatio || 1);
  sky.width = Math.round(W * dpr); sky.height = Math.round(H * dpr);
  const portrait = H > W && W <= 1100, card = document.querySelector('.card[data-mark]');
  if (portrait) { const under = $('hud').offsetTop + $('hud').offsetHeight + 8; stage.style.setProperty('--bar-top', under + 'px'); const top = under + $('daybar').offsetHeight + 24; // the clock, then the day bar, then Earth
    geo = { portrait, E: [Math.max(70, W * 0.26), top], d: [0, 1], L: Math.max(76, H * 0.545 - top), edge: W - 6 }; } // on a phone the line runs down the screen, above the cards
  else { stage.style.removeProperty('--bar-top'); const ex = Math.max(60, W * 0.085), cardLeft = card.offsetLeft, L = Math.max(140, cardLeft - 74 - ex); // room at the far end for Voyager 1's name
    const clear = hero.offsetTop + hero.offsetHeight + L * 0.06 + 22; // Earth, at its largest, sits clear of the title
    geo = { portrait, E: [ex, Math.min(Math.max(H * 0.6, clear), H - 104)], d: [1, 0], L, edge: cardLeft - 8 }; stage.style.setProperty('--bar-l', ex + 'px'); stage.style.setProperty('--bar-w', L + 'px'); }
}

function draw() {
  const v = J.view(t), { E, d, L, portrait } = geo, px = L / v.span, n = [-d[1], d[0]], far = Math.hypot(Math.max(E[0], W - E[0]), Math.max(E[1], H - E[1])) + 4;
  const at = (dist, turn = 0) => { const c = Math.cos(turn), s = Math.sin(turn); return [E[0] + dist * (d[0] * c + n[0] * s), E[1] + dist * (d[1] * c + n[1] * s)]; }; // a point this far from Earth, turned away from the line by an angle
  const last = J.lastMark(t), next = J.nextMark(t); shown = { rings: [], labels: [], bodies: {} };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  for (const s of stars) { ctx.globalAlpha = s.a; ctx.fillStyle = INK; ctx.fillRect(Math.round(s.x * W), Math.round(s.y * H), s.z, s.z); } ctx.globalAlpha = 1;

  // The marks, as rings round Earth: each is everything at that distance.
  for (const m of J.MARKS) { const R = m.km * px; if (R < 2.5 || R > far) continue; const crossed = m.t <= t + 1e-9, end = m.id === 'voyager1';
    ctx.beginPath(); ctx.arc(E[0], E[1], R, 0, Math.PI * 2); ctx.lineWidth = m === last ? 1.4 : 1; ctx.setLineDash(end ? [3, 6] : []);
    ctx.strokeStyle = end ? `rgba(63,224,138,${crossed ? 0.75 : 0.4})` : `rgba(244,245,243,${m === last ? 0.5 : crossed ? 0.26 : 0.13})`; ctx.stroke(); ctx.setLineDash([]); shown.rings.push({ id: m.id, R, crossed }); }

  // The Sun and the Moon, at their real distances and real sizes (never smaller than a dot). Not in their real directions.
  const body = (id, R, r, turn, fill, glow) => { if (R < 12 || R > far + r) return; const p = at(R, turn), fade = Math.min(1, (R - 12) / 14); ctx.globalAlpha = fade;
    if (glow) { const gr = Math.max(r * 3.2, 16), grad = ctx.createRadialGradient(p[0], p[1], r * 0.6, p[0], p[1], gr); grad.addColorStop(0, 'rgba(255,236,190,.55)'); grad.addColorStop(1, 'rgba(255,236,190,0)'); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p[0], p[1], gr, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); ctx.font = `600 10px ${MONO}`; ctx.fillStyle = 'rgba(244,245,243,.8)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; if (R > 44) text(id.toUpperCase(), p[0] + r + 7, p[1], 1.6);
    ctx.globalAlpha = 1; shown.bodies[id] = { x: p[0], y: p[1], r, R }; };
  body('sun', J.AU * px, Math.max(3.5, J.SUN_R * px), -0.8, '#fff1cf', true); body('moon', 384400 * px, Math.max(2, J.MOON_R * px), -0.55, '#c9ccd0', false);

  // The line to Voyager 1: travelled so far, and still to go.
  const head = at(v.at * L), reach = J.LIGHT_DAY * px, seen = reach <= L * 1.02, tip = at(seen ? reach : L);
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(244,245,243,.3)'; ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.moveTo(head[0], head[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke(); ctx.setLineDash([]);
  if (v.t > 0) { const grad = ctx.createLinearGradient(E[0], E[1], head[0], head[1]); grad.addColorStop(0, 'rgba(63,224,138,.2)'); grad.addColorStop(1, GREEN); ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(E[0], E[1]); ctx.lineTo(head[0], head[1]); ctx.stroke();
    ctx.save(); ctx.shadowColor = GREEN; ctx.shadowBlur = 16; ctx.strokeStyle = GREEN; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(E[0], E[1], v.at * L, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#eafff3'; ctx.beginPath(); ctx.arc(head[0], head[1], 3.2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  shown.wave = v.at * L; shown.head = head;

  // Earth, at its real size until that is too small to see.
  const er = Math.max(3, J.EARTH_R * px), eg = ctx.createRadialGradient(E[0] - er * 0.35, E[1] - er * 0.4, er * 0.1, E[0], E[1], er); eg.addColorStop(0, '#cfe4ff'); eg.addColorStop(0.55, '#6f9fdd'); eg.addColorStop(1, '#274a86');
  ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(E[0], E[1], er, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(244,245,243,.55)'; ctx.stroke();
  ctx.font = `600 10px ${MONO}`; ctx.fillStyle = 'rgba(244,245,243,.8)'; ctx.textBaseline = 'middle'; if (portrait) { ctx.textAlign = 'right'; text('EARTH', E[0] - er - 8, E[1], 1.6); } else { ctx.textAlign = 'center'; text('EARTH', E[0], E[1] + er + 13, 1.6); }
  shown.earth = { x: E[0], y: E[1], r: er };

  // Voyager 1, once the picture is wide enough to hold it; before that, an arrow to say which way it is.
  ctx.save(); ctx.translate(tip[0], tip[1]); ctx.rotate(Math.atan2(d[1], d[0])); ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  if (seen) { ctx.beginPath(); ctx.ellipse(-1, 0, 2.6, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#9aa1a6'; ctx.fillRect(1.5, -3, 6, 6); ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(22, -13); ctx.moveTo(6, 2); ctx.lineTo(15, 9); ctx.moveTo(7, 0); ctx.lineTo(17, 2); ctx.stroke(); ctx.fillStyle = INK; ctx.fillRect(13.5, 7.5, 4, 3.5); }
  else { ctx.beginPath(); ctx.moveTo(-7, -4.5); ctx.lineTo(0, 0); ctx.lineTo(-7, 4.5); ctx.stroke(); }
  ctx.restore(); shown.voyager = seen ? { x: tip[0], y: tip[1] } : null;
  if (!seen) { ctx.font = `600 10px ${MONO}`; ctx.fillStyle = 'rgba(244,245,243,.62)'; ctx.textBaseline = 'middle'; if (portrait) { ctx.textAlign = 'center'; text('TO VOYAGER 1', tip[0], tip[1] + 13, 1.6); } else { ctx.textAlign = 'right'; text('TO VOYAGER 1', tip[0] - 4, tip[1] + 15, 1.6); } }

  // Names where the rings cross the line. Where rings crowd together, the one just crossed and the one coming next keep their names and the rest give way.
  const gap = portrait ? 16 : 24, order = [...shown.rings].filter(r => r.R >= 26 && r.R <= L + 6).sort((a, b) => (b.id === last?.id) - (a.id === last?.id) || (b.id === next?.id) - (a.id === next?.id) || b.R - a.R), kept = [];
  ctx.font = `600 10.5px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; const wide = s => ctx.measureText(s).width + s.length * 0.9, fits = (p, w) => (portrait ? p[0] + 12 + w : p[0] + 18 + Math.cos(0.66) * w + 6) <= geo.edge;
  for (const r of order) { if (kept.some(k => Math.abs(k.R - r.R) < gap)) continue; const m = J.byId(r.id), p = at(r.R), full = `${m.ring}  ${J.dur(m.t).toUpperCase()}`;
    const words = (m === last || m === next) && fits(p, wide(full)) ? full : m.ring, w = wide(words); if (!fits(p, w)) continue; kept.push(r); /* the mark just crossed and the one coming next carry their times; a name that would run off the picture, or under the cards, waits until there is room */
    ctx.strokeStyle = ctx.fillStyle = m === last ? GREEN : r.crossed ? 'rgba(244,245,243,.92)' : 'rgba(244,245,243,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p[0] - n[0] * 5, p[1] - n[1] * 5); ctx.lineTo(p[0] + n[0] * 5, p[1] + n[1] * 5); ctx.stroke();
    if (portrait) { text(words, p[0] + 12, p[1], 0.9); shown.labels.push({ id: r.id, R: r.R, x0: p[0] + 12, y0: p[1] - 6, x1: p[0] + 12 + w, y1: p[1] + 6 }); }
    else { const a = -0.66, off = m.id === 'voyager1' && seen ? 18 : 5; ctx.save(); ctx.translate(p[0] + off, p[1] - 10); ctx.rotate(a); text(words, 0, 0, 0.9); ctx.restore(); shown.labels.push({ id: r.id, R: r.R, x0: p[0], y0: p[1] - 10 + Math.sin(a) * w - 6, x1: p[0] + off + Math.cos(a) * w + 6, y1: p[1] }); } }
  // If the mark just crossed has no room for its name on its ring, it is named beside Earth instead, so the picture always says where the flash is.
  shown.caption = null; if (last && !kept.some(k => k.id === last.id)) { const x = portrait ? E[0] + 14 : E[0] + 46, yy = portrait ? E[1] - er - 12 : E[1] + er + 13, full = `${last.ring}  ${J.dur(last.t).toUpperCase()}`, words = x + wide(full) <= geo.edge ? full : last.ring; ctx.fillStyle = GREEN; ctx.textAlign = 'left'; text(words, x, yy, 0.9); shown.caption = { id: last.id, words, x0: x, x1: x + wide(words), y: yy }; }
  // How long the whole line is, so the scale can be read off.
  { const far = (J.au(v.span) || J.km(v.span)).toUpperCase(), end = at(L); ctx.font = `600 10px ${MONO}`; ctx.fillStyle = 'rgba(244,245,243,.5)'; ctx.textAlign = 'right'; shown.scale = far;
    if (portrait) { const mid = E[1] + L * 0.56; text('WHOLE LINE', E[0] - 12, mid - 6, 1.2); text(far, E[0] - 12, mid + 7, 1.2); } else text(`WHOLE LINE = ${far}`, end[0], end[1] + 30, 1.2); ctx.textAlign = 'left'; }
}
// Letter-spaced text, since canvas letter-spacing is not everywhere yet.
function text(s, x, yy, space) { const align = ctx.textAlign; if (align !== 'left') { const w = ctx.measureText(s).width + space * (s.length - 1); x -= align === 'center' ? w / 2 : w; ctx.textAlign = 'left'; } for (const ch of s) { ctx.fillText(ch, x, yy); x += ctx.measureText(ch).width + space; } ctx.textAlign = align; }

// The clock and the day bar.
function hud() { const v = J.view(t), show = Math.min(1, Math.max(0, ($('hud').offsetTop - 2 - hero.getBoundingClientRect().bottom) / 24)); /* the clock and the day bar come in once the title has scrolled clear of them */
  $('hud').style.opacity = $('daybar').style.opacity = show;
  $('clock').textContent = J.clock(t); $('dist-km').textContent = t >= J.DAY ? J.km(J.LIGHT_DAY) : J.km(v.r); $('dist-au').textContent = J.au(v.r);
  $('togo').parentElement.firstChild.textContent = t >= J.DAY ? 'Voyager 1 ' : 'Voyager 1 in '; $('togo').textContent = t >= J.DAY ? 'reached' : J.dur(J.DAY - t); $('day-fill').style.width = (t / J.DAY * 100) + '%'; }

function read() { unit = stage.offsetHeight || 1; y = Math.max(0, scrollY - track.offsetTop) / unit; t = J.timeAt(y);
  const lo = J.timeAt(y - 0.75 / unit), hi = J.timeAt(y + 0.75 / unit), stop = J.STOPS.find(x => x >= lo && x <= hi); if (stop !== undefined) t = stop; } // a page cannot stop between two pixels: within a pixel of a mark, the flash is on it
function frame() { queued = false; if (real) { t = Math.min(J.DAY, (performance.now() - real.wall) / 1000); y = J.yAt(t); } else read(); draw(); hud();
  if (geo.portrait) for (const h of hours) h.style.visibility = h.getBoundingClientRect().top < geo.E[1] ? 'hidden' : ''; } /* on a phone the empty-hour notes do not ride up over the clock and the day bar */
const hours = [];
const ask = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };

// ---- Real speed: the flash travels as fast on the page as it does in space, and the page scrolls to keep up. ----
const say = s => { $('live').textContent = ''; setTimeout(() => { $('live').textContent = s; }, 60); };
function startReal() { if (still.matches) return; if (real) cancelAnimationFrame(real.raf); /* pressed twice: one run, not two */ real = { wall: performance.now(), want: 0, sec: -1 }; $('chip').hidden = false; $('stop').focus({ preventScroll: true });
  say('Running at the real speed of light. The Moon in 1.3 seconds, the Sun’s distance in 8 minutes 19 seconds, Voyager 1 in 24 hours. Press Stop, press Escape, or scroll, to take over.'); tick(); }
// Where the focus goes when real speed stops: back to its button if that is on screen, otherwise to the card being read, never to something hidden or out of sight.
function landFocus() { const b = $('real'), r = b.getBoundingClientRect(); if (!b.hidden && r.top >= 0 && r.bottom <= innerHeight) return b.focus({ preventScroll: true });
  let best = null, gap = Infinity; for (const c of document.querySelectorAll('.card')) { const q = c.getBoundingClientRect(); if (q.bottom < 0 || q.top > innerHeight) continue; const d = Math.abs((q.top + q.bottom) / 2 - innerHeight / 2); if (d < gap) { gap = d; best = c; } }
  if (best) { best.tabIndex = -1; best.focus({ preventScroll: true }); } else document.activeElement.blur(); }
function stopReal() { if (!real) return; cancelAnimationFrame(real.raf); real = null; const had = document.activeElement === $('stop') || document.activeElement === document.body; $('chip').hidden = true; if (had) landFocus(); say('Stopped. Scrolling moves the flash again.'); ask(); }
function tick() { if (!real) return; const el = (performance.now() - real.wall) / 1000; if (el >= J.DAY) return stopReal();
  real.want = track.offsetTop + J.yAt(el) * unit; scrollTo(0, real.want); const sec = Math.floor(el), nx = J.nextMark(el);
  if (sec !== real.sec || nx?.id !== real.next) { real.sec = sec; real.next = nx?.id; $('chip-text').textContent = nx ? `Real speed. ${nx.name} in ${J.dur(nx.t - el)}.` : 'Real speed.'; }
  frame(); real.raf = requestAnimationFrame(tick); }
addEventListener('scroll', () => { if (real && Math.abs(scrollY - real.want) > 4) stopReal('scroll'); ask(); }, { passive: true });
for (const type of ['wheel', 'touchstart']) addEventListener(type, () => stopReal('scroll'), { passive: true });
addEventListener('keydown', e => { if (real && ['Escape', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) stopReal(e.key === 'Escape' ? 'key' : 'scroll'); });
$('real').addEventListener('click', startReal); $('stop').addEventListener('click', () => stopReal('button'));
const motion = () => { $('real').hidden = still.matches; if (still.matches) stopReal(); }; still.addEventListener('change', motion);

// ---- Set up ----
// Ticks on the day bar, one for each mark, where it truly falls in the day.
$('day-ticks').append(...J.MARKS.map(m => { const i = document.createElement('i'); i.style.left = (m.t / J.DAY * 100) + '%'; if (m.id === 'voyager1') { i.className = 'end'; i.style.left = 'calc(100% - 2px)'; } return i; }));
// The empty hours of the long dark, marked where they fall. They say nothing a card does not, so screen readers skip them.
{ const busy = [...document.querySelectorAll('.card')].map(c => J.timeAt(parseFloat(c.style.getPropertyValue('--y'))) / 3600);
  for (let h = 7; h < 24; h++) { if (busy.some(b => h - b > -0.5 && h - b < 1.3)) continue; /* not where a card is */ const p = document.createElement('p'); p.className = 'hour'; p.setAttribute('aria-hidden', 'true'); p.style.setProperty('--y', J.yAt(h * 3600)); p.textContent = `Hour ${h}. Nothing.`; track.append(p); hours.push(p); } }
$('hud').hidden = $('daybar').hidden = false; motion(); layout(); read(); draw(); hud();
// A change of window size changes how long the page is. Keep the flash where it was, in time, not in pixels.
addEventListener('resize', () => { const keep = y, was = unit; layout(); if (!real && keep <= J.TRACK - 1 && Math.abs(unit - was) > 0.5) scrollTo(0, track.offsetTop + keep * unit); ask(); }); if (document.fonts?.ready) document.fonts.ready.then(() => { layout(); ask(); });

// For the checks in tools/.
window.lightDay = { state: () => ({ y, t, unit, W, H, real: !!real, geo, ...shown, view: J.view(t) }), goto(time) { stopReal('scroll'); scrollTo(0, track.offsetTop + J.yAt(time) * unit); frame(); return this.state(); }, gotoY(yy) { stopReal('scroll'); scrollTo(0, track.offsetTop + yy * unit); frame(); return this.state(); } };
