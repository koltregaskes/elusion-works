// Morning Briefing: the arithmetic of reading a briefing aloud and of swiping between its cards.
// Nothing here touches the page or makes a sound, so all of it can be checked in Node.

// ---- Sentences ----
// Split a piece of prose into sentences. A full stop ends one unless it belongs to an abbreviation, a single initial, a number (3.5) or a time (06.30),
// or unless what follows starts with a small letter. Closing quotes and brackets stay with the sentence they close.
const SHORT = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'etc', 'e.g', 'i.e', 'a.m', 'p.m', 'approx', 'inc', 'ltd', 'co']);
export function sentences(text) { const clean = text.replace(/\s+/g, ' ').trim(); if (!clean) return []; const out = []; let from = 0;
  for (let i = 0; i < clean.length; i++) { const c = clean[i]; if (c !== '.' && c !== '!' && c !== '?') continue; let end = i + 1; while (end < clean.length && /[.!?]/.test(clean[end])) end++; while (end < clean.length && /["'”’)\]]/.test(clean[end])) end++;
    if (end < clean.length && clean[end] !== ' ') { i = end - 1; continue; } // a stop inside a word or a number: 3.5, 06.30, e.g.
    const rest = clean.slice(end).trimStart(), word = clean.slice(from, i).split(' ').pop().toLowerCase().replace(/^[("'“‘]+/, '');
    if (rest && (/^[a-z0-9]/.test(rest) || (c === '.' && (SHORT.has(word) || /^[a-z]$/.test(word))))) { i = end - 1; continue; } // the sentence plainly carries on (a small letter or a figure follows: "No. 5", "done?" and left), or the stop belongs to an abbreviation or an initial
    out.push(clean.slice(from, end).trim()); from = end; i = end - 1; }
  const tail = clean.slice(from).trim(); if (tail) out.push(tail); return out; }

// ---- Timing ----
// How long a sentence takes to say: 165 words a minute at normal speed, plus a breath after it. A figure such as 34 or £4.10 counts as the words it is said in.
export const WPM = 165, BREATH = 0.3, RATES = [1, 1.25, 1.5, 0.85];
export const wordCount = text => (text.match(/[A-Za-z0-9£%'’]+(?:[.,:][0-9]+)*/g) || []).reduce((n, w) => n + (/[0-9]/.test(w) ? Math.max(1, Math.ceil(w.replace(/[^0-9]/g, '').length / 2) + (/[£%]/.test(w) ? 1 : 0)) : 1), 0);
export const seconds = (text, rate = 1) => (wordCount(text) * 60 / WPM + BREATH) / rate;
export const clock = s => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export const minutes = s => { const m = Math.max(1, Math.round(s / 60)); return `${m} ${m === 1 ? 'minute' : 'minutes'}`; };

// ---- The briefing as a list of lines ----
// cards: [{ id, title, blocks: [text, ...] }]. Each block is split into sentences; each sentence is a line: { text, card, block, n (its place in the card), of (how many in the card), dur (seconds at normal speed), start }.
export function lines(cards) { const out = []; let start = 0; cards.forEach((card, c) => { const mine = []; card.blocks.forEach((block, b) => { for (const text of sentences(block)) mine.push({ text, card: c, block: b }); });
    mine.forEach((l, k) => { l.n = k + 1; l.of = mine.length; l.dur = seconds(l.text); l.start = start; start += l.dur; out.push(l); }); }); return out; }
export const total = list => (list.length ? list[list.length - 1].start + list[list.length - 1].dur : 0);
export const firstOf = (list, card) => list.findIndex(l => l.card === card); // the first line of a card, or -1 if the card says nothing

// ---- The player ----
// state: { i: which line, t: seconds into it (at normal speed), playing, rate, ended }. Time given to advance() is real time; a faster rate uses it up faster.
export const createPlayer = () => ({ i: 0, t: 0, playing: false, rate: 1, ended: false });
// Move on by dt seconds of real time. hold: do not leave the present line (a voice is still saying it). Returns what happened: 'line' when a new line begins, 'card' when it is on a new card, 'end' when the last line is done.
export function advance(state, list, dt, hold = false) { const seen = []; if (!state.playing || state.ended || !list.length) return seen; state.t += dt * state.rate;
  while (state.t >= list[state.i].dur) { if (hold) { state.t = list[state.i].dur * 0.999; break; } const over = state.t - list[state.i].dur; if (state.i === list.length - 1) { state.t = list[state.i].dur; state.playing = false; state.ended = true; seen.push('end'); break; }
    const was = list[state.i].card; state.i++; state.t = over; seen.push('line'); if (list[state.i].card !== was) seen.push('card'); }
  return seen; }
// The voice has finished the present line: go on to the next at once, however long the estimate was.
export function finish(state, list) { if (!list.length) return []; state.t = list[state.i].dur; return advance(state, list, 0); }
// Go to a line. Clamped to the briefing; clears "ended".
export function seek(state, list, i) { state.i = Math.min(list.length - 1, Math.max(0, Math.round(i))); state.t = 0; state.ended = false; return state; }
// A sentence back: to the start of this one if it is more than a second and a half in, otherwise to the one before. A sentence on: the next one.
export function back(state, list) { return seek(state, list, state.t > 1.5 ? state.i : state.i - 1); }
export function on(state, list) { return state.i >= list.length - 1 ? state : seek(state, list, state.i + 1); }
// Where the player is, in seconds at the present speed, and how long the whole briefing is at that speed.
export const position = (state, list) => ({ at: list.length ? (list[state.i].start + Math.min(state.t, list[state.i].dur)) / state.rate : 0, of: total(list) / state.rate });
export const nextRate = rate => RATES[(RATES.indexOf(rate) + 1) % RATES.length];
export const sayRate = rate => (rate === 1 ? 'Normal speed' : rate < 1 ? 'Slower' : rate === 1.25 ? 'A little faster' : 'Faster');

// ---- Swiping ----
// What a finger's drag across a card of this width comes to: -1 go back, 1 go on, 0 stay. dx is how far it moved (left is negative), vx how fast at the end, in pixels a millisecond.
// A long drag or a quick flick turns the card; a short slow one, or a flick back the other way at the end, does not.
export function settle(dx, vx, width) { const far = Math.abs(dx) > width * 0.28, flick = Math.abs(vx) > 0.45 && Math.abs(dx) > 24 && Math.sign(vx) === Math.sign(dx), undone = Math.abs(vx) > 0.25 && Math.sign(vx) !== Math.sign(dx); if (undone || !(far || flick)) return 0; return dx < 0 ? 1 : -1; }
// Which card that leads to. At either end the deck stays where it is.
export const turn = (index, by, count) => Math.min(count - 1, Math.max(0, index + by));
// How a card being dragged sits: moved with the finger, tipped a little, with a pull that weakens when there is nowhere to go.
export function pose(dx, width, index, count) { const blocked = (dx > 0 && index === 0) || (dx < 0 && index === count - 1), x = blocked ? dx * 0.25 : dx, k = Math.max(-1, Math.min(1, x / width)); return { x, tilt: k * 7, under: Math.min(1, Math.abs(k) * 1.6) }; }
