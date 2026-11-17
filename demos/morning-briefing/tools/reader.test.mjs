// Checks the reading and swiping arithmetic without a browser. Usage: node reader.test.mjs
import assert from 'node:assert/strict';
import * as R from '../js/reader.js';
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

// ---- Sentences ----
assert.deepEqual(R.sentences('Nothing broke overnight. One job ran and produced nothing.  That is not the same as failing!'), ['Nothing broke overnight.', 'One job ran and produced nothing.', 'That is not the same as failing!']);
// Stops that do not end a sentence: abbreviations, initials, numbers, times, and a small letter after the stop.
assert.deepEqual(R.sentences('It cost £4.10 against a line of £5. The stop is at 70.'), ['It cost £4.10 against a line of £5.', 'The stop is at 70.']);
assert.deepEqual(R.sentences('The briefing is at 06.30 a.m. sharp. Dr. Ali and J. Smith read it, e.g. on the train. Fine.'), ['The briefing is at 06.30 a.m. sharp.', 'Dr. Ali and J. Smith read it, e.g. on the train.', 'Fine.']);
assert.deepEqual(R.sentences('He asked "Is it done?" and left. She said "No." Then silence...'), ['He asked "Is it done?" and left.', 'She said "No."', 'Then silence...']);
assert.deepEqual(R.sentences('No stop at the end'), ['No stop at the end']); assert.deepEqual(R.sentences('   '), []); assert.deepEqual(R.sentences('One. (Two.) Three?'), ['One.', '(Two.)', 'Three?']);
// A figure after a stop starts a new sentence, except after No. and the like. A single letter or an abbreviation ends a sentence when what follows plainly starts one. List numbers stay with their items.
for (const [text, want] of [['The stop is at 70. 3 jobs failed.', ['The stop is at 70.', '3 jobs failed.']], ['It was worse in 2025. 2026 looks better.', ['It was worse in 2025.', '2026 looks better.']], ['See No. 5 on the list. Fig. 2 shows it.', ['See No. 5 on the list.', 'Fig. 2 shows it.']], ['We chose plan A. Then it rained.', ['We chose plan A.', 'Then it rained.']], ['Take vitamin C. It helps.', ['Take vitamin C.', 'It helps.']], ['It starts at 9 a.m. The rest follows.', ['It starts at 9 a.m.', 'The rest follows.']], ['Apples, pears etc. The shop was shut.', ['Apples, pears etc.', 'The shop was shut.']], ['Steps: 1. Open the app. 2. Press play.', ['Steps: 1. Open the app.', '2. Press play.']], ['1. Open the app. 2. Press play.', ['1. Open the app.', '2. Press play.']], ['J. Smith and A. Jones came. They left.', ['J. Smith and A. Jones came.', 'They left.']], ['Meet at 9 a.m. sharp.', ['Meet at 9 a.m. sharp.']]]) assert.deepEqual(R.sentences(text), want, text);
// Nothing is lost or added: joined back together, the sentences are the text.
for (const text of ['A. B! C? D.', 'Thirty-four jobs ran. Thirty-three did their work; one came back with nothing.', 'Version 2.1 is out. It is 3.5 times faster, i.e. quick.']) assert.equal(R.sentences(text).join(' '), text);

// ---- Timing ----
assert.equal(R.wordCount('Nothing broke overnight.'), 3); assert.deepEqual(['34', '212', '1.8', '£4.10', '06:30', '62%', '£5', '1,200'].map(R.wordCount), [1, 2, 3, 3, 2, 2, 2, 3], 'a figure should count as the words it is said in'); assert.equal(R.wordCount('It cost £4.10 today'), 6); assert.equal(R.wordCount('At 06:30, 34 jobs ran'), 6); assert.equal(R.wordCount("The owner's list"), 3); assert.equal(R.wordCount(''), 0);
assert.ok(near(R.seconds('one two three four five six seven eight nine ten eleven'), 11 * 60 / 165 + 0.3)); assert.ok(near(R.seconds('one two three', 1.5), R.seconds('one two three') / 1.5)); assert.ok(R.seconds('a much longer sentence than that one') > R.seconds('short'));
assert.deepEqual([0, 5, 59.6, 60, 135, -3].map(R.clock), ['0:00', '0:05', '1:00', '1:00', '2:15', '0:00']); assert.deepEqual([20, 89, 91, 200].map(R.minutes), ['1 minute', '1 minute', '2 minutes', '3 minutes']);

// ---- The briefing as lines ----
const cards = [{ id: 'a', title: 'One', blocks: ['First card. It has three sentences.', 'This is the third.'] }, { id: 'b', title: 'Two', blocks: [] }, { id: 'c', title: 'Three', blocks: ['Only one here.'] }], list = R.lines(cards);
assert.deepEqual(list.map(l => [l.text, l.card, l.block, l.n, l.of]), [['First card.', 0, 0, 1, 3], ['It has three sentences.', 0, 0, 2, 3], ['This is the third.', 0, 1, 3, 3], ['Only one here.', 2, 0, 1, 1]]);
for (let i = 1; i < list.length; i++) assert.ok(near(list[i].start, list[i - 1].start + list[i - 1].dur), 'lines do not follow one another'); assert.ok(near(R.total(list), list.reduce((n, l) => n + l.dur, 0))); assert.equal(R.total([]), 0);
assert.deepEqual([0, 1, 2, 3].map(c => R.firstOf(list, c)), [0, -1, 3, -1]);

// ---- The player ----
{ const p = R.createPlayer(); assert.deepEqual(R.advance(p, list, 5), [], 'a player that is not playing moved'); assert.equal(p.t, 0); p.playing = true;
  assert.deepEqual(R.advance(p, list, list[0].dur / 2), []); assert.equal(p.i, 0); assert.deepEqual(R.advance(p, list, list[0].dur / 2 + 0.01), ['line']); assert.equal(p.i, 1); assert.ok(near(p.t, 0.01, 1e-9));
  // A long step carries over several lines and says so; a change of card is told.
  const q = { ...R.createPlayer(), playing: true }; assert.deepEqual(R.advance(q, list, list[0].dur + list[1].dur + list[2].dur + 0.1), ['line', 'line', 'line', 'card']); assert.equal(q.i, 3); assert.ok(near(q.t, 0.1, 1e-9));
  // The end: the player stops on the last line, says so once, and stays stopped.
  assert.deepEqual(R.advance(q, list, 100), ['end']); assert.equal(q.playing, false); assert.equal(q.ended, true); assert.equal(q.i, 3); assert.deepEqual(R.advance(q, list, 100), []); const at = R.position(q, list); assert.ok(near(at.at, at.of));
  // Speed: at one and a half times, the same real time covers one and a half times as much.
  const f = { ...R.createPlayer(), playing: true, rate: 1.5 }; R.advance(f, list, 0.4); assert.ok(near(f.t, 0.6)); assert.ok(near(R.position(f, list).of, R.total(list) / 1.5)); assert.ok(near(R.position(f, list).at, 0.6 / 1.5));
  // Holding: while a voice is still saying a line, the player waits at its end and does not run on.
  const h = { ...R.createPlayer(), playing: true }; assert.deepEqual(R.advance(h, list, 50, true), []); assert.equal(h.i, 0); assert.ok(h.t < list[0].dur && h.t > list[0].dur * 0.99); assert.deepEqual(R.finish(h, list), ['line']); assert.equal(h.i, 1); assert.equal(h.t, 0);
  // The voice finishing early moves on at once; finishing the last line ends the briefing.
  const e = { ...R.createPlayer(), playing: true }; R.seek(e, list, 2); assert.deepEqual(R.finish(e, list), ['line', 'card']); assert.deepEqual(R.finish(e, list), ['end']); assert.equal(e.ended, true);
  // Seeking is clamped and clears the end. A sentence back goes to the start of this one when well into it, otherwise to the one before.
  R.seek(e, list, 99); assert.equal(e.i, 3); assert.equal(e.ended, false); R.seek(e, list, -4); assert.equal(e.i, 0); R.seek(e, list, 2); e.t = 2; R.back(e, list); assert.deepEqual([e.i, e.t], [2, 0]); R.back(e, list); assert.equal(e.i, 1); R.seek(e, list, 0); R.back(e, list); assert.equal(e.i, 0);
  R.on(e, list); assert.equal(e.i, 1); R.seek(e, list, 3); e.t = 0.5; R.on(e, list); assert.deepEqual([e.i, e.t], [3, 0.5], 'a sentence on from the last line should do nothing');
  assert.deepEqual(R.advance({ ...R.createPlayer(), playing: true }, [], 5), []); }
// Speeds go round: normal, a little faster, faster, slower, and back.
{ let r = 1; const seen = []; for (let i = 0; i < 5; i++) { seen.push(r); r = R.nextRate(r); } assert.deepEqual(seen, [1, 1.25, 1.5, 0.85, 1]); assert.deepEqual(R.RATES.map(R.sayRate), ['Normal speed', 'A little faster', 'Faster', 'Slower']); }

// ---- Swiping ----
// A long drag turns the card; a short slow one does not; a quick flick does; a flick back the other way at the end cancels.
assert.equal(R.settle(-140, 0, 360), 1); assert.equal(R.settle(140, 0, 360), -1); assert.equal(R.settle(-60, -0.1, 360), 0); assert.equal(R.settle(-60, -0.8, 360), 1); assert.equal(R.settle(60, 0.8, 360), -1); assert.equal(R.settle(-10, -2, 360), 0, 'a twitch turned the card'); assert.equal(R.settle(-200, 0.6, 360), 0, 'a drag taken back still turned the card'); assert.equal(R.settle(0, 0, 360), 0);
assert.deepEqual([R.turn(0, -1, 7), R.turn(0, 1, 7), R.turn(6, 1, 7), R.turn(3, 0, 7)], [0, 1, 6, 3]);
// A dragged card follows the finger and tips; at either end it resists.
{ const mid = R.pose(-90, 360, 2, 7); assert.equal(mid.x, -90); assert.ok(mid.tilt < 0 && mid.tilt > -7 && mid.under > 0 && mid.under <= 1); assert.equal(R.pose(90, 360, 0, 7).x, 22.5); assert.equal(R.pose(-90, 360, 6, 7).x, -22.5); assert.deepEqual(R.pose(0, 360, 3, 7), { x: 0, tilt: 0, under: 0 }); assert.equal(R.pose(-9999, 360, 2, 7).tilt, -7); }
console.log('ok  reader: sentences split at real stops only and lose nothing; figures and times count as the words they are said in; lines follow one another; the player advances, carries over, holds for a voice, ends once, seeks within bounds and changes speed; a drag, a flick and a twitch each come out as they should');
