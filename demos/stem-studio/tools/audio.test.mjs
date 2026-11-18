// Checks how loaded audio is started and stopped, without a browser: node demos/stem-studio/tools/audio.test.mjs
// The sound objects here are stand-ins that only write down what they are told. Every expected time is worked out by hand in the comments.
import assert from 'node:assert/strict';
import { schedule, restop, FADE } from '../js/audio.js';

// A stand-in for a volume control: it keeps the list of what is planned, and forgets what is planned from a given moment on when told to.
const param = () => { const ev = []; return { ev, setValueAtTime(v, t) { ev.push(['set', v, t]); }, linearRampToValueAtTime(v, t) { ev.push(['ramp', v, t]); }, cancelScheduledValues(t) { for (let i = ev.length - 1; i >= 0; i--) if (ev[i][2] >= t) ev.splice(i, 1); } }; };
const source = (ended = false) => ({ starts: [], stops: [], start(...a) { this.starts.push(a); }, stop(t) { if (ended) throw new Error('already ended'); this.stops.push(t); }, connect(x) { return x; } });
const made = []; const ctx = { createBufferSource() { const s = source(); made.push(s); return s; }, createGain() { const g = { gain: param(), connect(x) { return x; } }; made.at(-1).g = g; return g; } };
const near = (a, b) => Math.abs(a - b) < 1e-9, fadesOut = g => g.gain.ev.filter(e => e[0] === 'ramp' && e[1] === 0).map(e => e[2]);

// One stem of 30 s on one track, in a clip of two bars from the start of the song. At 120 bpm a beat is half a second, so the clip is 8 beats, 4 s.
const project = { bpm: 120, bars: 8, tracks: [{ id: 't', name: 'Stem', kind: 'stem', vol: 1, mute: false }], patterns: {}, sections: [], clips: [{ id: 'c', track: 't', start: 0, len: 2 }] };
const mixer = { input: () => ({}) }, stems = new Map([['t', { duration: 30 }]]), when = b => b * 0.5;

// In an export the length is fixed at the start: 4 s from the beginning of the recording, with a fade out ending at 4 s, because the recording goes on past the clip.
{ made.length = 0; schedule(ctx, mixer, project, stems, 0, 16, when, false, null, Infinity); const s = made[0]; assert.deepEqual(s.starts, [[0, 0, 4]]); assert.deepEqual(s.stops, []); assert.deepEqual(fadesOut(s.g), [4]); }

// Live, the start gives no length and the stop is set apart, at 4 s, so that it can be moved. What is handed back: the clip, the beat it stops on (8), when the recording would run out by itself (30 s) and when it is to stop (4 s).
let live; { made.length = 0; schedule(ctx, mixer, project, stems, 0, 16, when, false, (id, src, until, gain, ends, at) => { live = { id, src, until, gain, ends, at }; }, Infinity);
  assert.deepEqual(live.src.starts, [[0, 0]]); assert.deepEqual(live.src.stops, [4]); assert.deepEqual([live.id, live.until, live.ends, live.at], ['c', 8, 30, 4]); assert.deepEqual(fadesOut(live.gain), [4]); assert.ok(near(live.gain.gain.ev.find(e => e[0] === 'set' && e[2] > 3)[2], 4 - FADE)); }

// Slower. One second in, at beat 2, the tempo goes from 120 to 60. The six beats left now take a second each, so the clip ends at 1 + 6 = 7 s, not 4.
// The stem must sound on to 7 s: its stop is moved there, the fade planned for 4 s is dropped, and a fade is planned to end at 7 s. Before the fix it stopped at 4 s and was silent for the 3 s after.
{ assert.equal(restop(live.src, live.gain, 1, 7, live.ends), true); assert.equal(live.src.stops.at(-1), 7); assert.deepEqual(fadesOut(live.gain), [7], 'the old fade at 4 s is still planned, or the new one is missing'); const ev = live.gain.gain.ev; assert.deepEqual(ev[0], ['set', 1, 1]); assert.ok(near(ev[1][2], 7 - FADE) && ev[1][1] === 1); }

// Faster. From the same start, one second in, the tempo goes from 120 to 240. The six beats left take a quarter of a second each: the clip ends at 1 + 1.5 = 2.5 s.
// The stop moves to 2.5 s and so does the fade. Before the fix the stop moved and the fade stayed at 4 s, so the stem was cut off at full level.
{ made.length = 0; let l; schedule(ctx, mixer, project, stems, 0, 16, when, false, (id, src, until, gain, ends, at) => { l = { src, gain, ends }; }, Infinity); assert.equal(restop(l.src, l.gain, 1, 2.5, l.ends), true); assert.equal(l.src.stops.at(-1), 2.5); assert.deepEqual(fadesOut(l.gain), [2.5]); assert.ok(l.gain.gain.ev.some(e => e[0] === 'set' && e[1] === 1 && near(e[2], 2.5 - FADE))); }

// A recording that runs out before the stop needs no fade: it ends by itself. A 3 s recording asked to stop at 7 s has its stop moved and nothing planned to fade.
{ const s = source(), g = { gain: param() }; assert.equal(restop(s, g, 1, 7, 3), true); assert.deepEqual(s.stops, [7]); assert.deepEqual(fadesOut(g), []); }
// A stop that is already past is made now, with no time to fade in: the level goes to nothing at once.
{ const s = source(), g = { gain: param() }; assert.equal(restop(s, g, 5, 4, 30), true); assert.deepEqual(s.stops, [5]); assert.deepEqual(fadesOut(g), [5]); }
// A stop that is less than a fade away fades over what time there is, and never starts before now.
{ const s = source(), g = { gain: param() }; restop(s, g, 5, 5.002, 30); assert.deepEqual(s.stops, [5.002]); assert.ok(g.gain.ev.every(e => e[2] >= 5 - 1e-12)); assert.deepEqual(fadesOut(g), [5.002]); }
// A stem that has already ended is left alone, and nothing is planned for it.
{ const s = source(true), g = { gain: param() }; assert.equal(restop(s, g, 1, 7, 30), false); assert.deepEqual(g.gain.ev, []); }
console.log('ok  audio: an export fixes a stem\'s length at the start; live, the stop is set apart and a change of tempo moves it with its fade (120 to 60 bpm one second into a two-bar clip: stops at 7 s, not 4; 120 to 240: stops at 2.5 s with its fade); a recording that runs out first is not faded; a stop already past is made now; an ended stem is left alone');
