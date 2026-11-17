// Run: node demos/stem-studio/tools/model.test.mjs
import assert from 'node:assert/strict';
import { demoProject, events, edit, applyPlan, interpret, briefFor, validate, rowsFor, MAX_BARS } from '../js/model.js';
const p = demoProject(), snap = JSON.stringify(p);
const noOverlap = q => { for (const t of q.tracks) { const cs = q.clips.filter(c => c.track === t.id).sort((a, b) => a.start - b.start); for (let i = 1; i < cs.length; i++) assert.ok(cs[i - 1].start + cs[i - 1].len <= cs[i].start, `overlap on ${t.id} at bar ${cs[i].start + 1}`); } for (const c of q.clips) assert.ok(c.len >= 1 && c.start >= 0 && c.start + c.len <= MAX_BARS); };
noOverlap(p);
// Events: deterministic, inside the window, and independent of tempo (they are in beats).
const all = events(p, 0, p.bars * 4); assert.ok(all.length > 700, 'demo song has ' + all.length + ' notes');
assert.deepEqual(events(p, 0, p.bars * 4), all); assert.deepEqual(events(edit.setBpm(p, 150), 0, p.bars * 4), all);
assert.equal(events(p, 16, 32).length, all.filter(e => e.beat >= 16 && e.beat < 32).length); for (const e of events(p, 16, 32)) assert.ok(e.beat >= 16 && e.beat < 32);
// Mute and solo.
assert.ok(events(edit.setTrack(p, 'drums', { mute: true }), 0, 128).every(e => e.track !== 'drums')); assert.ok(events(edit.setTrack(p, 'bass', { solo: true }), 0, 128).every(e => e.track === 'bass'));
// Edits never change the project they were given, and never leave clips overlapping.
let q = edit.moveClip(p, 'c-lead-8', 2); noOverlap(q); assert.equal(q.clips.find(c => c.id === 'c-lead-8').start, 2);
q = edit.resizeClip(p, 'c-bass-4', 12); noOverlap(q); assert.deepEqual(q.clips.filter(c => c.track === 'bass').map(c => [c.start, c.len]).sort((x, y) => x[0] - y[0]), [[4, 12], [16, 4], [24, 8]]); // it took the first half of the chorus bass
q = edit.splitClip(p, 'c-keys-0', 6); assert.equal(q.clips.filter(c => c.track === 'keys' && c.start < 12).length, 2);
assert.deepEqual(events(q, 0, 48).filter(e => e.track === 'keys').map(e => [e.beat, e.p]), events(p, 0, 48).filter(e => e.track === 'keys').map(e => [e.beat, e.p]), 'a split clip sounds the same');
q = edit.duplicateClip(p, 'c-lead-8'); noOverlap(q); q = edit.deleteClip(p, 'c-lead-8'); assert.equal(q.clips.length, p.clips.length - 1);
q = edit.addClip(p, 'bass', 'd-fill', 0, 2); assert.equal(q, p, 'a drum pattern cannot go on the bass track');
q = edit.toggleNote(p, 'd-verse', 3, 'kick'); assert.equal(q.patterns['d-verse'].notes.length, p.patterns['d-verse'].notes.length + 1); q = edit.toggleNote(q, 'd-verse', 3, 'kick'); assert.equal(q.patterns['d-verse'].notes.length, p.patterns['d-verse'].notes.length);
q = edit.makeUnique(p, 'c-drums-4'); assert.notEqual(q.clips.find(c => c.id === 'c-drums-4').pattern, 'd-verse'); assert.equal(Object.keys(q.patterns).length, Object.keys(p.patterns).length + 1);
assert.equal(edit.setBpm(p, 999).bpm, 180); assert.equal(JSON.stringify(p), snap, 'the original project was changed');
// Plans: all or nothing, plain errors, bars counted from 1.
let r = applyPlan(p, { ops: [{ op: 'clear', track: 'drums', section: 'Break' }, { op: 'set_tempo', bpm: 120 }] }); noOverlap(r.project);
assert.equal(r.project.bpm, 120); assert.equal(events(r.project, 80, 96).filter(e => e.track === 'drums').length, 0); assert.equal(r.said.length, 2);
r = applyPlan(p, { ops: [{ op: 'insert', section: 'Chorus', at: 21 }] }); noOverlap(r.project); assert.equal(r.project.bars, 40);
assert.deepEqual(events(r.project, 80, 112).map(e => [e.beat - 32, e.track, e.p]), events(p, 48, 80).map(e => [e.beat, e.track, e.p]), 'the inserted chorus is the chorus');
assert.deepEqual(events(r.project, 112, 160).map(e => [e.beat - 32, e.track, e.p]), events(p, 80, 128).map(e => [e.beat, e.track, e.p]), 'what followed moved along intact');
r = applyPlan(p, { ops: [{ op: 'delete', section: 'Intro' }] }); noOverlap(r.project); assert.equal(r.project.bars, 28); assert.equal(r.project.sections[0].name, 'Verse'); assert.equal(r.project.sections[0].start, 0);
assert.deepEqual(events(r.project, 0, 112).map(e => [e.beat + 16, e.track, e.p]), events(p, 16, 128).map(e => [e.beat, e.track, e.p]));
r = applyPlan(p, { ops: [{ op: 'copy', from: 13, to: 16, at: 1, tracks: ['drums'] }] }); noOverlap(r.project); assert.ok(events(r.project, 0, 16).some(e => e.track === 'drums' && e.p === 'clap'));
for (const bad of [{}, { ops: [] }, { ops: [{ op: 'explode' }] }, { ops: [{ op: 'clear', track: 'tuba', from: 1, to: 2 }] }, { ops: [{ op: 'clear', track: 'drums', from: 5, to: 2 }] }, { ops: [{ op: 'set_tempo', bpm: 400 }] }, { ops: [{ op: 'add_clip', track: 'bass', pattern: 'd-fill', at: 1, bars: 2 }] }, { ops: [{ op: 'insert', from: 1, to: 32, at: 33 }, { op: 'insert', from: 1, to: 32, at: 1 }] }])
  assert.throws(() => applyPlan(p, bad), Error); assert.equal(JSON.stringify(p), snap);
// Plain requests the page understands itself, and the brief for anything else.
assert.deepEqual(interpret('Drop the drums in the break', p), { ops: [{ op: 'clear', track: 'drums', section: 'Break' }] });
assert.deepEqual(interpret('double the chorus', p), { ops: [{ op: 'insert', section: 'Chorus', at: 21 }] });
assert.deepEqual(interpret('make it 128 bpm', p), { ops: [{ op: 'set_tempo', bpm: 128 }] }); assert.deepEqual(interpret('cut the intro', p), { ops: [{ op: 'delete', section: 'Intro' }] });
assert.equal(interpret('make it sound like rain on a tin roof', p), null);
for (const text of ['Drop the drums in the break', 'double the chorus', 'cut the intro', 'no bass in bars 5 to 8', 'keys only in the intro']) noOverlap(applyPlan(p, interpret(text, p)).project);
const brief = briefFor(p, 'make the ending bigger'); assert.ok(brief.includes('"ops"') && brief.includes('Last chorus bars 25-32') && brief.includes('make the ending bigger'));
// Loading: junk is refused in plain words, a saved project survives a round trip.
assert.throws(() => validate({ hello: 1 }), /not a Stem Studio project/); assert.deepEqual(validate(JSON.parse(snap)), p);
assert.equal(rowsFor('drums').length, 6); assert.equal(rowsFor('bass').length, 15); assert.equal(rowsFor('lead')[14].label, 'A4');
// Review regressions: hostile or broken files, half-understood requests, sections after a cut, the 64-bar limit.
const bad = JSON.parse(snap); delete bad.patterns['d-verse'].notes; bad.tracks[0].kind = 'drums);background-image:url(https://evil.example/px'; bad.clips[0].shift = 1e9; bad.clips[1].len = 1e9; bad.patterns['__proto__x'] = { kind: 'drums', bars: 1, notes: [] };
bad.tracks.push({ id: 'x', name: 'X', kind: 'keys', vol: 'loud' }); bad.patterns['k-pad'].notes.push({ t: 'a', d: 1, p: 60 }, { t: 2, d: 1e9, p: 200 }, null);
const safe = validate(bad); noOverlap(safe);
assert.ok(safe.tracks.every(t => ['drums', 'bass', 'keys', 'lead', 'audio'].includes(t.kind)) && !safe.tracks.some(t => t.id === 'drums'), 'an unknown kind is dropped with its track');
assert.ok(Object.values(safe.patterns).every(x => Array.isArray(x.notes) && x.notes.every(n => Number.isInteger(n.t) && n.d >= 1 && n.v >= 0 && n.v <= 1)) && !safe.patterns['d-verse']); assert.equal(safe.tracks.find(t => t.id === 'x').vol, 0.8);
assert.ok(safe.clips.every(c => c.len <= MAX_BARS && (c.shift || 0) < 16)); let t0 = Date.now(); events(safe, 0, 256); assert.ok(Date.now() - t0 < 200, 'events stays fast on odd data');
const far = JSON.parse(snap); far.clips[0].shift = 4e6; t0 = Date.now(); events(far, 0, 4); assert.ok(Date.now() - t0 < 50, 'a huge shift does not stall playback');
for (const text of ["Don't drop the bass in the chorus", 'Keep the drums in the break, no changes', 'Double the chorus with no drums', 'Faster, and add a string section']) assert.equal(interpret(text, p), null, `should not act on: ${text}`);
assert.deepEqual(interpret('128 bpm and drop the drums in the break', p), { ops: [{ op: 'set_tempo', bpm: 128 }, { op: 'clear', track: 'drums', section: 'Break' }] });
r = applyPlan(p, { ops: [{ op: 'delete', from: 10, to: 14 }] }); noOverlap(r.project); assert.deepEqual(r.project.sections.map(s => [s.name, s.start, s.len]), [['Intro', 0, 4], ['Verse', 4, 5], ['Chorus', 9, 6], ['Break', 15, 4], ['Last chorus', 19, 8]], 'sections follow a cut');
for (let i = 1; i < r.project.sections.length; i++) assert.ok(r.project.sections[i - 1].start + r.project.sections[i - 1].len <= r.project.sections[i].start);
r = applyPlan(p, { ops: [{ op: 'insert', from: 13, to: 14, at: 7 }] }); assert.deepEqual(r.project.sections.find(s => s.name === 'Verse'), { name: 'Verse', start: 4, len: 10 });
for (const badPlan of [{ ops: [{ op: 'constructor' }] }, { ops: [{ op: 'toString' }] }, { ops: [{ op: 'mute', track: 'lead', on: 'false' }] }, { ops: [{ op: 'add_clip', track: 'keys', pattern: 'k-pad', at: 1, bars: 1.4 }] }, { ops: [{ op: 'add_clip', track: 'keys', pattern: 'constructor', at: 1, bars: 1 }] }]) assert.throws(() => applyPlan(p, badPlan), Error);
assert.equal(edit.addClip(p, 'drums', 'd-fill', 64, 1), p, 'no clip past the last bar'); q = edit.addClip(edit.deleteClip(p, 'c-drums-24'), 'drums', 'd-fill', 63, 4); assert.deepEqual(q.clips.at(-1).start + q.clips.at(-1).len, 64);
console.log(`ok  model: ${all.length} notes in the demo song, edits, plans, requests and loading all behave`);
