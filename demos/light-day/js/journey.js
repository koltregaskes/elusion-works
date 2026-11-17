// One light-day: the distances, the times and the scroll, as plain data and arithmetic.
// Nothing here draws or touches the page, so every figure the page shows can be checked in Node.

export const C = 299792.458; // the speed of light, km a second (exact, by definition)
export const AU = 149597870.7; // one astronomical unit, km (exact, by definition)
export const DAY = 86400; // seconds in a day
export const LIGHT_DAY = C * DAY; // 25,902,068,371.2 km
export const EARTH_R = 6371, MOON_R = 1737.4, SUN_R = 695700; // radii, km

// The marks the flash crosses, in order. Each is a distance from Earth.
// kind 'body': something really at that distance from Earth. kind 'orbit': a yardstick, the average distance of that orbit from the Sun
// (the flash is heading out of the plane of the planets and meets none of them). kind 'edge' and 'craft': where a Voyager was or is.
// ring: the name written on the ring in the picture. inAu: the distance as its source gives it, with no more figures than the source has.
const mark = (id, name, ring, km, kind, inAu) => ({ id, name, ring, km, kind, inAu, t: km / C, au: km / AU });
export const MARKS = [
  mark('moon', 'The Moon', 'MOON', 384400, 'body', '0.0026'),
  mark('sun', 'The Sun’s distance', '1 AU · SUN', AU, 'body', '1'),
  mark('mars', 'Mars’s orbit', '1.52 AU · MARS', 1.524 * AU, 'orbit', '1.524'),
  mark('jupiter', 'Jupiter’s orbit', '5.2 AU · JUPITER', 5.2 * AU, 'orbit', '5.2'),
  mark('saturn', 'Saturn’s orbit', '9.5 AU · SATURN', 9.54 * AU, 'orbit', '9.54'),
  mark('uranus', 'Uranus’s orbit', '19.2 AU · URANUS', 19.2 * AU, 'orbit', '19.2'),
  mark('neptune', 'Neptune’s orbit', '30.1 AU · NEPTUNE', 30.1 * AU, 'orbit', '30.1'),
  mark('pluto', 'Pluto’s average distance', '39.5 AU · PLUTO', 39.5 * AU, 'orbit', '39.5'),
  mark('shock', 'The termination shock', 'TERMINATION SHOCK', 94 * AU, 'edge', '94'),
  mark('pause', 'The heliopause', 'HELIOPAUSE', 122 * AU, 'edge', 'about 122'),
  mark('voyager2', 'Voyager 2’s distance', 'VOYAGER 2', 145 * AU, 'craft', 'about 145'),
  mark('voyager1', 'Voyager 1', 'VOYAGER 1', LIGHT_DAY, 'craft', '173.14'),
];
export const byId = id => MARKS.find(m => m.id === id);

// ---- The scroll. y is how far down the page you are, in screens. ----
// Up to six hours the page is squeezed: each stretch between two marks gets about a screen, however long light takes to cross it.
// After six hours it is to scale: every hour of light-time is the same length of page.
const TAU = 0.3, g = t => Math.log(1 + t / TAU), ungo = v => TAU * (Math.exp(v) - 1);
export const SQUEEZED_UNTIL = 6 * 3600, PER_HOUR = 0.42; // screens of page for each hour, once it is to scale
const T = id => byId(id).t;
export const ANCHORS = [[0, 0], [0.6, 0], [1.8, T('moon')], [3.2, T('sun')], [4.3, T('mars')], [5.4, T('jupiter')], [6.5, T('saturn')], [7.6, T('uranus')], [8.7, T('neptune')], [9.9, T('pluto')], [10.5, SQUEEZED_UNTIL], [10.5 + (DAY - SQUEEZED_UNTIL) / 3600 * PER_HOUR, DAY]];
export const END_Y = ANCHORS[ANCHORS.length - 1][0]; // where the flash arrives
export const TRACK = END_Y + 1.3; // the length of the journey's part of the page, in screens

// How long the flash has been travelling when the page is at y.
export function timeAt(y) {
  if (!(y > 0)) return 0; if (y >= END_Y) return DAY;
  let i = 1; while (ANCHORS[i][0] < y) i++; const [y0, t0] = ANCHORS[i - 1], [y1, t1] = ANCHORS[i], k = (y - y0) / (y1 - y0);
  return t1 <= SQUEEZED_UNTIL ? ungo(g(t0) + (g(t1) - g(t0)) * k) : t0 + (t1 - t0) * k;
}
// Where on the page the flash has been travelling for t seconds (the first such place).
export function yAt(t) {
  if (!(t > 0)) return ANCHORS[1][0]; if (t >= DAY) return END_Y;
  let i = 2; while (ANCHORS[i][1] < t) i++; const [y0, t0] = ANCHORS[i - 1], [y1, t1] = ANCHORS[i];
  const k = t1 <= SQUEEZED_UNTIL ? (g(t) - g(t0)) / (g(t1) - g(t0)) : (t - t0) / (t1 - t0); return y0 + (y1 - y0) * k;
}

// ---- The view. The picture is a line from Earth towards Voyager 1; this says how much of space that line shows. ----
// While the page is squeezed the flash is held at the same place on the line and space shrinks behind it.
// Then the view pulls back until the whole line is one light-day long, and the flash crawls along it.
export const HOLD = 0.62, FULL = 0.92, PULL_FROM = T('pluto'), PULL_TO = 7 * 3600, START_SPAN = EARTH_R / 0.06; // at the start Earth is 6% of the line across
const smooth = k => k * k * (3 - 2 * k);
export function view(t) {
  const time = Math.min(Math.max(t, 0), DAY), r = time * C; // how far the flash has got, km
  const hold = time <= PULL_FROM ? HOLD : time >= PULL_TO ? FULL * time / DAY : HOLD + (FULL * PULL_TO / DAY - HOLD) * smooth((time - PULL_FROM) / (PULL_TO - PULL_FROM));
  const span = Math.max(r / hold, START_SPAN); // km shown along the whole line
  return { t: time, r, span, at: r / span }; // at: how far along the line the flash is, 0 to 1
}

// ---- Words and figures ----
const group = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// A length of time in words: 1.28 s, 8 min 19 s, 4 h 10 min, 24 h. Cut short, never rounded up, so it never reads later than the clock does.
export function dur(t) {
  const x = t + 1e-9; if (x < 10) return `${(Math.floor(x * 100) / 100).toFixed(2)} s`; const s = Math.floor(x); if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  const mins = Math.floor(s / 60), h = Math.floor(mins / 60); return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
}
// The clock: 00:00:01.28 for the first ten seconds, then 00:08:19.
export function clock(t) {
  const whole = t < 10 ? Math.floor(t) : Math.min(Math.floor(t + 1e-6), DAY), h = Math.floor(whole / 3600), m = Math.floor(whole % 3600 / 60), s = whole % 60, two = n => String(n).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)}` + (t < 10 ? '.' + two(Math.min(99, Math.floor((t - whole) * 100))) : '');
}
// A distance: 384,400 km, 4.5 million km, 25.9 billion km.
export function km(n) { return n < 1e6 ? `${group(Math.round(n))} km` : n < 1e9 ? `${(n / 1e6).toFixed(n < 1e7 ? 2 : n < 1e8 ? 1 : 0)} million km` : `${(n / 1e9).toFixed(n < 1e10 ? 2 : 1)} billion km`; }
export const kmExact = n => `${group(Math.round(n))} km`;
export function au(n) { const v = n / AU; return v < 0.095 ? '' : `${v.toFixed(v < 9.95 ? 2 : 1)} AU`; }
export const share = t => { const p = t / DAY * 100; return p < 0.01 ? 'under 0.01%' : p < 1 ? `${p.toFixed(2)}%` : p < 99.95 ? `${p.toFixed(1)}%` : '100%'; };
// The mark the flash crossed last, and the one it will cross next.
export const lastMark = t => { let m = null; for (const x of MARKS) if (x.t <= t + 1e-9) m = x; return m; };
export const nextMark = t => MARKS.find(x => x.t > t + 1e-9) || null;
// The times a card is written for. A page cannot stop between two pixels, so within a pixel of one of these the flash is taken to be on it.
export const STOPS = [...MARKS.map(m => m.t), 8 * 3600];
