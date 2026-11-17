// The long read: the arithmetic of reading. How long an article takes, how far through it a reader is, which part they are in, and what its short version is.
// Nothing here touches the page, so all of it can be checked in Node.

export const WPM = 230; // words a minute, reading to oneself
export const words = text => (text.match(/[A-Za-z0-9À-ɏ]+(?:['’.,:][A-Za-z0-9]+)*/g) || []).length; // "don't", "3.5" and "06:30" are one word each
// Minutes to read so many words, never less than one. Said as a reader would say it.
export const minutes = (count, wpm = WPM) => Math.max(1, Math.round(count / wpm));
export const sayMinutes = m => `${m} ${m === 1 ? 'minute' : 'minutes'}`;

// How far through the article the reader is, from 0 to 1. top and height are the article's place on the page, y is how far the page is scrolled, view is the window's height.
// The measure is a line a little over a third of the way down the window, where the eye usually is: the share of the article above that line. maxY is as far as the page can scroll. Over the last windowful of scrolling the line slides down to the foot of the window, so that the share reaches the whole exactly when the page can go no further, and never jumps.
export function readShare(y, top, height, view, maxY = Infinity) { if (height <= 0) return 0; const near = Math.min(1, Math.max(0, 1 - (maxY - y) / view)); return Math.min(1, Math.max(0, (y + view * (0.35 + 0.65 * near) - top) / height)); }
// Minutes left, from the share read. Nothing left is said as nothing left.
export const left = (share, total) => { const m = Math.ceil((1 - share) * total - 1e-9); return share >= 1 || m <= 0 ? 0 : m; };
export const sayLeft = (share, total, atTop = false) => { const m = left(share, total); return atTop || share <= 0 ? `${sayMinutes(total)} to read` : m === 0 ? 'Finished' : `${sayMinutes(m)} left`; }; // atTop: the page has not been scrolled. On a tall window some of the article is past the reading line before anyone has read a word

// Which part the reader is in: the last part whose heading has come up to the top of the window, give or take a little. tops are the headings' places on the page, in order; clear is how much of the window's top is taken by the strip. Before the first, -1.
// (Not the reading line: a heading a third of the way down the window still has the part before it filling the top of the screen.)
export function current(tops, y, view, clear = 0) { const line = y + clear + Math.min(120, view * 0.15); let at = -1; for (let i = 0; i < tops.length; i++) if (tops[i] <= line) at = i; return at; }

// The short read: the first sentence of a paragraph. A sentence ends at a full stop, question mark or exclamation mark that is followed by a space and a capital, or by the end.
// Stops inside figures (3.5), after initials and common abbreviations, and before a small letter do not end it.
const SHORT = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'etc', 'e.g', 'i.e']);
export function firstSentence(text) { const t = text.replace(/\s+/g, ' ').trim(); for (let i = 0; i < t.length; i++) { if (!'.!?'.includes(t[i])) continue; let end = i + 1; while (end < t.length && /[.!?"'”’)\]]/.test(t[end])) end++; if (end < t.length && t[end] !== ' ') continue;
    const rest = t.slice(end).trimStart(), word = t.slice(0, i).split(' ').pop().toLowerCase().replace(/^[("'“‘]+/, ''); if (rest && (/^[a-z0-9]/.test(rest) || (t[i] === '.' && (SHORT.has(word) || /^[a-z]$/.test(word))))) continue; return t.slice(0, end); } return t; }

// Text sizes the reader can choose: steps of an eighth, from seven eighths to one and a half.
export const SIZES = [0.875, 1, 1.125, 1.25, 1.5];
export const step = (size, by) => { const i = SIZES.indexOf(size); return i < 0 ? 1 : SIZES[Math.min(SIZES.length - 1, Math.max(0, i + by))]; }; // a size that is not one of the steps goes back to the ordinary one

// Notes are numbered in the order they are first pointed to. refs is the list of note ids as the text points to them; returns { id: number }.
export function number(refs) { const n = {}; let k = 0; for (const id of refs) if (!(id in n)) n[id] = ++k; return n; }
