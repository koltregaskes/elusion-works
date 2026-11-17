// Checks the reading arithmetic without a browser. Usage: node read.test.mjs
import assert from 'node:assert/strict';
import * as R from '../js/read.js';
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

// Words: contractions, figures and times are one word each; punctuation is not a word.
assert.equal(R.words('A failure makes a noise.'), 5); assert.equal(R.words("It doesn’t; it can't."), 4); assert.equal(R.words('Read 212 items at 06:30, 3.5 times.'), 7); assert.equal(R.words('  “…”  '), 0); assert.equal(R.words('café naïve'), 2);
// Minutes: 230 words a minute, rounded, never less than one.
assert.deepEqual([0, 100, 230, 344, 346, 823, 2300].map(n => R.minutes(n)), [1, 1, 1, 1, 2, 4, 10]); assert.deepEqual([1, 2].map(R.sayMinutes), ['1 minute', '2 minutes']);

// How much is read. An article 3000 px tall that starts 1000 px down the page, in a window 800 px tall on a page that scrolls to 3600.
{ const share = y => R.readShare(y, 1000, 3000, 800, 3600); assert.equal(share(0), 0, 'at the top of the page nothing is read'); assert.ok(near(share(720), 0)); assert.ok(near(share(2220), 0.5), 'with the middle of the article on the reading line, half is read'); assert.ok(share(2900) < 0.8 && share(3300) < 1 && share(3300) > share(2900), 'over the last windowful the share should climb to the whole, not jump'); assert.equal(share(3600), 1, 'at the foot of the page, all of it'); assert.equal(share(99999), 1);
  for (let y = 0; y < 3600; y += 37) assert.ok(share(y + 37) >= share(y), 'the share read went down while scrolling down'); assert.equal(R.readShare(0, 0, 0, 800), 0);
  // A short article that is all on the screen of a page that cannot scroll is all read.
  assert.equal(R.readShare(0, 100, 300, 800, 0), 1); }
// Minutes left: counted down from the whole, never more than the whole, nothing at the end.
assert.deepEqual([0, 0.01, 0.25, 0.26, 0.74, 0.76, 0.999, 1].map(s => R.left(s, 4)), [4, 4, 3, 3, 2, 1, 1, 0]); assert.deepEqual([0, 0.3, 0.9, 1].map(s => R.sayLeft(s, 4)), ['4 minutes to read', '3 minutes left', '1 minute left', 'Finished']); assert.equal(R.sayLeft(0, 1), '1 minute to read'); assert.equal(R.sayLeft(0.2, 4, true), '4 minutes to read', 'before the page is scrolled, nothing has been read, however tall the window');
// Which part: the last heading that has come up to the top of the window, below the strip.
{ const tops = [1200, 2000, 2900]; assert.deepEqual([0, 1079, 1081, 1879, 1881, 2781, 9000].map(y => R.current(tops, y, 800)), [-1, -1, 0, 0, 1, 2, 2]); assert.deepEqual([1021, 1023].map(y => R.current(tops, y, 800, 58)), [-1, 0]); assert.equal(R.current(tops, 1100, 400), -1, 'on a short window the margin is smaller'); assert.equal(R.current([], 500, 800), -1); }

// The short read: the first sentence of a paragraph.
for (const [text, first] of [['A failure makes a noise. Something stops.', 'A failure makes a noise.'], ['We talk about jobs as if they had two outcomes, and they have three. It worked.', 'We talk about jobs as if they had two outcomes, and they have three.'], ['Not “done”. Say more.', 'Not “done”.'], ['It cost £4.10 a day. Cheap.', 'It cost £4.10 a day.'], ['Dr. Watson wrote it down. Holmes did not.', 'Dr. Watson wrote it down.'], ['Was it the dog? It was.', 'Was it the dog?'], ['He said “No.” Then he left.', 'He said “No.”'], ['One sentence only', 'One sentence only'], ['  Spaces   are  tidied. Yes.', 'Spaces are tidied.'], ['The e.g. is here, i.e. inside. Done.', 'The e.g. is here, i.e. inside.']]) assert.equal(R.firstSentence(text), first);
// Text sizes: five steps, stopping at each end.
assert.deepEqual([R.step(1, 1), R.step(1, -1), R.step(1.5, 1), R.step(0.875, -1), R.step(1.25, 1), R.step(7, 1)], [1.125, 0.875, 1.5, 0.875, 1.5, 1]);
// Notes are numbered in the order the text first points to them.
assert.deepEqual(R.number(['dog', 'code', 'dog', 'handle']), { dog: 1, code: 2, handle: 3 }); assert.deepEqual(R.number([]), {});
console.log('ok  read: words and minutes; the share read rises from nothing to all and never falls; minutes left count down; the part being read; ten first sentences; text sizes; note numbers');
