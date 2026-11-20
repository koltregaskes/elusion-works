// Stem Studio: the song as data. Pure functions, no audio and no page, so every edit, every
// arranger move and every plan from an assistant can be tested and undone the same way.
export const STEPS = 16; // sixteenth notes in a bar
export const MAX_BARS = 64;
export const DRUMS = ['kick', 'snare', 'clap', 'hat', 'open', 'perc'];
const SCALE = [0, 2, 3, 5, 7, 8, 10]; // A natural minor
const BASE = { bass: 33, keys: 57, lead: 69 }; // lowest row: A1, A3, A4
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const pitchName = p => NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1);

// Rows of the clip editor for a track kind, top row first.
export function rowsFor(kind) {
  if (kind === 'drums') return DRUMS.map(d => ({ p: d, label: d[0].toUpperCase() + d.slice(1) }));
  const rows = []; for (let i = 14; i >= 0; i--) { const p = BASE[kind] + 12 * Math.floor(i / 7) + SCALE[i % 7]; rows.push({ p, label: pitchName(p) }); }
  return rows;
}

const clone = x => JSON.parse(JSON.stringify(x));
let uid = 0; const newId = prefix => `${prefix}${Date.now().toString(36)}${(uid++).toString(36)}`;

// ---- The demo song: 32 bars in A minor, written for this page --------------------------------
const n = (t, d, p, v = 0.8) => ({ t, d, p, v });
function demoPatterns() {
  const P = {};
  const add = (id, name, kind, bars, notes) => { P[id] = { id, name, kind, bars, notes }; };
  const four = [0, 4, 8, 12];
  add('d-verse', 'Verse beat', 'drums', 1, [...four.map(t => n(t, 1, 'kick', 0.95)), n(4, 1, 'snare'), n(12, 1, 'snare'), ...[2, 6, 10, 14].map(t => n(t, 1, 'hat', 0.6)), n(15, 1, 'hat', 0.35)]);
  add('d-chorus', 'Chorus beat', 'drums', 1, [...four.map(t => n(t, 1, 'kick', 1)), n(4, 1, 'clap'), n(12, 1, 'clap'), n(4, 1, 'snare', 0.6), n(12, 1, 'snare', 0.6), ...[2, 6, 10, 14].map(t => n(t, 2, 'open', 0.55)), ...[0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15].map(t => n(t, 1, 'hat', t % 4 ? 0.3 : 0.5)), n(7, 1, 'perc', 0.5), n(10, 1, 'perc', 0.45)]);
  add('d-half', 'Half-time', 'drums', 1, [n(0, 1, 'kick', 0.9), n(8, 1, 'snare', 0.8), n(4, 1, 'hat', 0.4), n(12, 1, 'hat', 0.4), n(14, 1, 'perc', 0.4)]);
  add('d-fill', 'Fill', 'drums', 1, [n(0, 1, 'kick'), n(4, 1, 'snare', 0.6), ...[8, 9, 10, 11, 12, 13, 14, 15].map((t, i) => n(t, 1, 'snare', 0.45 + i * 0.07)), n(12, 1, 'kick'), n(14, 2, 'open', 0.6)]);
  const roots = [33, 29 + 12, 36, 31 + 12]; // A1, F2, C2, G2
  add('b-verse', 'Verse bass', 'bass', 4, roots.flatMap((r, bar) => [0, 3, 6, 8, 11, 14].map((t, i) => n(bar * 16 + t, i === 3 ? 3 : 2, r, i % 2 ? 0.65 : 0.85))));
  add('b-chorus', 'Chorus bass', 'bass', 4, roots.flatMap((r, bar) => [0, 2, 4, 6, 8, 10, 12, 14].map((t, i) => n(bar * 16 + t, 2, i % 2 ? r + 12 : r, i % 2 ? 0.6 : 0.9))));
  const chords = [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]]; // Am, F, C, G
  add('k-pad', 'Pad chords', 'keys', 4, chords.flatMap((c, bar) => c.map(p => n(bar * 16, 15, p, 0.55))));
  add('k-stab', 'Chorus stabs', 'keys', 4, chords.flatMap((c, bar) => [2, 6, 10, 13].flatMap(t => c.map(p => n(bar * 16 + t, 2, p + (t === 13 ? 12 : 0), 0.6)))));
  add('l-verse', 'Verse line', 'lead', 4, [[0, 4, 76], [4, 2, 74], [6, 2, 72], [8, 8, 69], [16, 4, 72], [20, 4, 74], [24, 8, 72], [32, 4, 79], [36, 2, 76], [38, 2, 74], [40, 8, 72], [48, 4, 74], [52, 4, 71], [56, 8, 74]].map(([t, d, p]) => n(t, d, p, 0.7)));
  add('l-hook', 'Chorus hook', 'lead', 4, [[0, 3, 81], [3, 3, 84], [6, 2, 81], [8, 4, 79], [12, 4, 76], [16, 3, 81], [19, 3, 84], [22, 2, 86], [24, 8, 84], [32, 3, 79], [35, 3, 84], [38, 2, 79], [40, 4, 76], [44, 4, 79], [48, 3, 83], [51, 3, 81], [54, 2, 79], [56, 8, 81]].map(([t, d, p]) => n(t, d, p, 0.8)));
  return P;
}
export function demoProject() {
  const tracks = [
    { id: 'drums', name: 'Drums', kind: 'drums', vol: 0.85, pan: 0, mute: false, solo: false },
    { id: 'bass', name: 'Bass', kind: 'bass', vol: 0.75, pan: 0, mute: false, solo: false },
    { id: 'keys', name: 'Keys', kind: 'keys', vol: 0.6, pan: -0.15, mute: false, solo: false },
    { id: 'lead', name: 'Lead', kind: 'lead', vol: 0.55, pan: 0.15, mute: false, solo: false },
  ];
  const c = (track, pattern, start, len) => ({ id: `c-${track}-${start}`, track, pattern, start, len });
  return {
    v: 1, name: 'Night Bus Home', bpm: 112, bars: 32, tracks, patterns: demoPatterns(),
    sections: [{ name: 'Intro', start: 0, len: 4 }, { name: 'Verse', start: 4, len: 8 }, { name: 'Chorus', start: 12, len: 8 }, { name: 'Break', start: 20, len: 4 }, { name: 'Last chorus', start: 24, len: 8 }],
    clips: [
      c('keys', 'k-pad', 0, 12), c('drums', 'd-half', 2, 2), c('drums', 'd-verse', 4, 7), c('drums', 'd-fill', 11, 1), c('bass', 'b-verse', 4, 8), c('lead', 'l-verse', 8, 4),
      c('drums', 'd-chorus', 12, 8), c('bass', 'b-chorus', 12, 8), c('keys', 'k-stab', 12, 8), c('lead', 'l-hook', 12, 8),
      c('drums', 'd-half', 20, 3), c('drums', 'd-fill', 23, 1), c('keys', 'k-pad', 20, 4), c('lead', 'l-verse', 20, 4),
      c('drums', 'd-chorus', 24, 8), c('bass', 'b-chorus', 24, 8), c('keys', 'k-stab', 24, 8), c('lead', 'l-hook', 24, 8),
    ],
  };
}

// ---- Events: what sounds between two beats ------------------------------------------------------
// Used by live playback and by the offline export, so the file you download is what you heard.
export function audible(project) { const solo = project.tracks.some(t => t.solo); return new Set(project.tracks.filter(t => !t.mute && (!solo || t.solo)).map(t => t.id)); }
export function events(project, fromBeat, toBeat) {
  const out = [], on = audible(project), at = new Map(project.clips.map(c => [c.track + '|' + c.start, c]));
  for (const clip of project.clips) {
    if (!on.has(clip.track) || !clip.pattern) continue;
    const pat = project.patterns[clip.pattern]; if (!pat) continue;
    const c0 = clip.start * 4, c1 = (clip.start + clip.len) * 4; if (c1 <= fromBeat || c0 >= toBeat) continue;
    // A note may ring on past the clip's end when the next clip carries straight on with the same notes in step (a split),
    // so splitting never shortens a held note. Anything else ends at the clip's end.
    let hold = c1; for (let cur = clip, next, guard = 0; guard < 600 && (next = at.get(clip.track + '|' + (cur.start + cur.len))) && next.pattern === clip.pattern && (((cur.shift || 0) + cur.len - (next.shift || 0)) % pat.bars + pat.bars) % pat.bars === 0; guard++) { hold = (next.start + next.len) * 4; cur = next; }
    const loop = pat.bars * 4, kind = pat.kind, origin = c0 - (clip.shift || 0) * 4; // a clip cut on its left keeps the pattern in step
    const first = Math.max(fromBeat, c0); // start at the repeat that covers the window, stop at its end: the work is bounded whatever the clip holds
    for (let base = origin + Math.max(0, Math.floor((first - origin) / loop)) * loop; base < c1 && base < toBeat; base += loop) {
      if (base + loop <= first) continue;
      for (const note of pat.notes) {
        const beat = base + note.t / 4; if (beat < c0 || beat < fromBeat || beat >= toBeat || beat >= c1) continue;
        out.push({ beat, dur: Math.min(note.d / 4, hold - beat), track: clip.track, kind, p: note.p, v: note.v });
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

// ---- Edits: each returns a new project and never changes the one it was given ------------------------
const clampBar = b => Math.max(0, Math.min(MAX_BARS - 1, Math.round(b)));
const fit = p => { p.bars = Math.max(8, Math.min(MAX_BARS, Math.max(p.bars, ...p.clips.map(c => c.start + c.len), 0))); return p; };
// Make room on a track: trim, split or drop whatever lies in [from, to).
function carve(p, track, from, to, keepId) {
  const next = [];
  for (const c of p.clips) {
    if (c.track !== track || c.id === keepId || c.start + c.len <= from || c.start >= to) { next.push(c); continue; }
    if (c.start < from) next.push({ ...c, len: from - c.start });
    if (c.start + c.len > to) next.push({ ...c, id: c.start < from ? newId('c') : c.id, start: to, len: c.start + c.len - to, shift: ((c.shift || 0) + to - c.start) });
  }
  p.clips = next;
}
export const edit = {
  moveClip(p0, id, start, track) { const p = clone(p0), c = p.clips.find(x => x.id === id); if (!c) return p0; const tr = p.tracks.find(t => t.id === (track || c.track)); if (!tr || (c.pattern && p.patterns[c.pattern].kind !== tr.kind)) track = c.track; c.start = Math.max(0, Math.min(MAX_BARS - c.len, Math.round(start))); c.track = track || c.track; carve(p, c.track, c.start, c.start + c.len, id); return fit(p); },
  resizeClip(p0, id, len) { const p = clone(p0), c = p.clips.find(x => x.id === id); if (!c) return p0; c.len = Math.max(1, Math.min(MAX_BARS - c.start, Math.round(len))); carve(p, c.track, c.start, c.start + c.len, id); return fit(p); },
  deleteClip(p0, id) { const p = clone(p0); p.clips = p.clips.filter(c => c.id !== id); return p; },
  duplicateClip(p0, id) { const p = clone(p0), c = p.clips.find(x => x.id === id); if (!c || c.start + 2 * c.len > MAX_BARS) return p0; const d = { ...c, id: newId('c'), start: c.start + c.len }; carve(p, c.track, d.start, d.start + d.len); p.clips.push(d); return fit(p); },
  splitClip(p0, id, bar) { const p = clone(p0), c = p.clips.find(x => x.id === id); if (!c || bar <= c.start || bar >= c.start + c.len) return p0; p.clips.push({ ...c, id: newId('c'), start: bar, len: c.start + c.len - bar, shift: (c.shift || 0) + bar - c.start }); c.len = bar - c.start; return p; },
  addClip(p0, track, pattern, start, len) { const p = clone(p0), pat = p.patterns[pattern], tr = p.tracks.find(t => t.id === track); if (!pat || !tr || pat.kind !== tr.kind || !(Math.round(start) >= 0 && Math.round(start) < MAX_BARS)) return p0; start = clampBar(start); len = Math.min(MAX_BARS - start, Math.round(len)); if (!(len >= 1)) return p0; carve(p, track, start, start + len); p.clips.push({ id: newId('c'), track, pattern, start, len }); return fit(p); },
  // Give a clip its own copy of the pattern, so editing it leaves the others alone.
  makeUnique(p0, id) { const p = clone(p0), c = p.clips.find(x => x.id === id); if (!c || !c.pattern) return p0; const src = p.patterns[c.pattern], pid = newId('p'); p.patterns[pid] = { ...clone(src), id: pid, name: src.name + ' (copy)' }; c.pattern = pid; return p; },
  toggleNote(p0, patternId, t, pitch, d = 1) { const p = clone(p0), pat = p.patterns[patternId]; if (!pat) return p0; const i = pat.notes.findIndex(x => x.p === pitch && t >= x.t && t < x.t + x.d); if (i >= 0) pat.notes.splice(i, 1); else pat.notes.push({ t, d: Math.min(d, pat.bars * STEPS - t), p: pitch, v: 0.8 }); return p; },
  setBpm(p0, bpm) { const p = clone(p0); p.bpm = Math.max(60, Math.min(180, Math.round(bpm))); return p; },
  setTrack(p0, id, patch) { const p = clone(p0), t = p.tracks.find(x => x.id === id); if (!t) return p0; for (const k of ['vol', 'pan', 'mute', 'solo', 'name']) if (k in patch) t[k] = k === 'vol' ? Math.max(0, Math.min(1, patch[k])) : k === 'pan' ? Math.max(-1, Math.min(1, patch[k])) : patch[k]; return p; },
  addTrack(p0, track) { const p = clone(p0); p.tracks.push({ vol: 0.8, pan: 0, mute: false, solo: false, ...track }); return p; },
};

// ---- Plans: a short list of moves an assistant (or a preset) can hand over ---------------------------
export const PLAN_OPS = {
  set_tempo: 'bpm (60 to 180)',
  clear: 'track (a track id, or "all"), from, to (bars, counted from 1, "to" is the last bar cleared) or section',
  copy: 'from, to or section; at (bar to paste at, replacing what is there); optional tracks [ids]',
  insert: 'from, to or section; at (bar to insert at, pushing later bars along)',
  delete: 'from, to or section (later bars close the gap)',
  add_clip: 'track, pattern (a pattern id), at, bars',
  set_level: 'track, level (0 to 1)',
  mute: 'track, on (true or false)',
};
function range(p, op) { // bars in a plan are counted from 1 and inclusive, the way people say them
  if (op.section !== undefined) { const s = p.sections.find(x => x.name.toLowerCase() === String(op.section).toLowerCase()); if (!s) throw new Error(`No section called "${op.section}". Sections: ${p.sections.map(x => x.name).join(', ')}`); return [s.start, s.start + s.len]; }
  const a = Number(op.from), b = Number(op.to); if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b > MAX_BARS) throw new Error(`"${op.op}" needs whole bars with from at least 1 and to no less than from`);
  return [a - 1, b];
}
const slices = (p, from, to, tracks) => p.clips.filter(c => c.start < to && c.start + c.len > from && (!tracks || tracks.includes(c.track))).map(c => { const s = Math.max(c.start, from), e = Math.min(c.start + c.len, to); return { ...c, id: newId('c'), start: s - from, len: e - s, shift: (c.shift || 0) + s - c.start }; });
const shiftAfter = (p, at, by) => { for (const c of p.clips) if (c.start >= at) c.start += by; for (const s of p.sections) if (s.start >= at) s.start += by; };
const trackOrThrow = (p, id) => { const t = p.tracks.find(x => x.id === id || x.name.toLowerCase() === String(id).toLowerCase()); if (!t) throw new Error(`No track called "${id}". Tracks: ${p.tracks.map(x => x.id).join(', ')}`); return t; };

// Apply a whole plan or nothing. Returns the new project and one plain sentence per move.
export function applyPlan(p0, plan) {
  if (!plan || !Array.isArray(plan.ops) || !plan.ops.length) throw new Error('A plan is an object with an "ops" list of at least one move');
  if (plan.ops.length > 40) throw new Error('A plan can hold at most 40 moves');
  let p = clone(p0); const said = [];
  for (const op of plan.ops) {
    if (!op || typeof op.op !== 'string' || !Object.hasOwn(PLAN_OPS, op.op)) throw new Error(`Unknown move "${op && op.op}". Moves: ${Object.keys(PLAN_OPS).join(', ')}`);
    if (op.op === 'set_tempo') { const b = Number(op.bpm); if (!(b >= 60 && b <= 180)) throw new Error('Tempo must be between 60 and 180'); p.bpm = Math.round(b); said.push(`Tempo to ${p.bpm} bpm`); }
    else if (op.op === 'clear') { const [a, b] = range(p, op), ts = op.track === 'all' || op.track === undefined ? p.tracks : [trackOrThrow(p, op.track)]; for (const t of ts) carve(p, t.id, a, b); said.push(`Cleared ${ts.length === p.tracks.length ? 'everything' : ts.map(t => t.name).join(', ')} in bars ${a + 1} to ${b}`); }
    else if (op.op === 'copy' || op.op === 'insert') {
      const [a, b] = range(p, op), at = Number(op.at) - 1, len = b - a; if (!Number.isInteger(at) || at < 0 || at + len > MAX_BARS) throw new Error(`"${op.op}" needs "at" as a bar that leaves room for ${len} bars (the song can be ${MAX_BARS} bars long)`);
      const tracks = op.tracks ? op.tracks.map(t => trackOrThrow(p, t).id) : null, copies = slices(p, a, b, tracks);
      if (op.op === 'insert') { if (Math.max(...p.clips.map(c => c.start + c.len), 0) + len > MAX_BARS) throw new Error('That would make the song longer than ' + MAX_BARS + ' bars'); if (at < p.bars) p.bars = Math.min(MAX_BARS, p.bars + len); for (const c of [...p.clips]) if (c.start < at && c.start + c.len > at) { p.clips.push({ ...c, id: newId('c'), start: at, len: c.start + c.len - at, shift: (c.shift || 0) + at - c.start }); c.len = at - c.start; } for (const s of p.sections) if (s.start < at && s.start + s.len > at) s.len += len; shiftAfter(p, at, len); } // a section the new bars land inside grows to hold them
      else for (const t of p.tracks) if (!tracks || tracks.includes(t.id)) carve(p, t.id, at, at + len);
      for (const c of copies) p.clips.push({ ...c, start: c.start + at });
      said.push(`${op.op === 'insert' ? 'Inserted' : 'Copied'} bars ${a + 1} to ${b} at bar ${at + 1}`);
    }
    else if (op.op === 'delete') { const [a, b] = range(p, op); for (const t of p.tracks) carve(p, t.id, a, b);
      p.sections = p.sections.map(s => { const s0 = s.start, s1 = s.start + s.len; if (s1 <= a || s0 >= b) return s; const n0 = Math.min(s0, a), n1 = s1 > b ? a + (s1 - b) : a; return n1 - n0 >= 1 ? { ...s, start: n0 < a ? n0 : b, len: n1 - n0 } : null; }).filter(Boolean); // a section that crosses the cut keeps only the bars that survive
      shiftAfter(p, b, a - b); p.bars = Math.max(8, p.bars - (b - a)); said.push(`Removed bars ${a + 1} to ${b}`); }
    else if (op.op === 'add_clip') { const t = trackOrThrow(p, op.track), pat = Object.hasOwn(p.patterns, String(op.pattern)) ? p.patterns[op.pattern] : null; if (!pat) throw new Error(`No pattern "${op.pattern}". Patterns: ${Object.keys(p.patterns).join(', ')}`); if (pat.kind !== t.kind) throw new Error(`Pattern "${op.pattern}" is for ${pat.kind}, not ${t.kind}`); const at = Number(op.at) - 1, len = Number(op.bars); if (!Number.isInteger(at) || at < 0 || !Number.isInteger(len) || len < 1 || at + len > MAX_BARS) throw new Error('"add_clip" needs "at" (a bar) and "bars" (a whole number of bars) that fit in the song'); carve(p, t.id, at, at + len); p.clips.push({ id: newId('c'), track: t.id, pattern: op.pattern, start: at, len }); said.push(`Added ${pat.name} on ${t.name} at bar ${at + 1} for ${len} bar${len > 1 ? 's' : ''}`); }
    else if (op.op === 'set_level') { const t = trackOrThrow(p, op.track), l = Number(op.level); if (!(l >= 0 && l <= 1)) throw new Error('Level must be between 0 and 1'); t.vol = l; said.push(`${t.name} level to ${Math.round(l * 100)}%`); }
    else if (op.op === 'mute') { const t = trackOrThrow(p, op.track); if (op.on !== undefined && typeof op.on !== 'boolean') throw new Error('"mute" needs "on" as true or false'); t.mute = op.on !== false; said.push(`${t.name} ${t.mute ? 'muted' : 'unmuted'}`); }
    p.clips = p.clips.filter(c => c.len >= 1 && c.start < MAX_BARS);
  }
  p.bars = Math.max(8, Math.min(MAX_BARS, Math.max(p.bars, ...p.clips.map(c => c.start + c.len)))); /* grows to fit; only a delete makes the song shorter (Clear leaves empty bars) */ p.sections.sort((x, y) => x.start - y.start);
  return { project: p, said };
}

// A handful of plain requests the page understands on its own. Anything else goes to an assistant as a brief.
export function interpret(text, p) {
  const t = text.toLowerCase().trim(), ops = []; let rules = 0;
  if (/\b(don'?t|do not|never|keep|leave|no changes?|unchanged|except)\b/.test(t)) return null; // it cannot weigh a "don't": better to say so than to do the opposite
  const clauses = t.split(/\band\b|\bthen\b|\balso\b|\bplus\b|\bwith\b|\bbut\b|[,;]/).filter(x => x.trim()).length, sec = name => p.sections.find(s => s.name.toLowerCase() === name) || p.sections.find(s => s.name.toLowerCase().includes(name));
  const where = () => { const m = t.match(/bars? (\d+)\s*(?:to|-|through)\s*(\d+)/); if (m) return { from: Number(m[1]), to: Number(m[2]) }; for (const name of ['last chorus', 'intro', 'verse', 'chorus', 'break']) if (t.includes(name) && sec(name)) return { section: sec(name).name }; return null; };
  const track = () => { for (const tr of p.tracks) if (t.includes(tr.name.toLowerCase())) return tr.id; return null; };
  let m;
  const n0 = () => ops.length;
  let before = n0();
  if ((m = t.match(/(\d{2,3})\s*bpm/))) ops.push({ op: 'set_tempo', bpm: Number(m[1]) });
  else if (/\bfaster\b|speed (it )?up/.test(t)) ops.push({ op: 'set_tempo', bpm: Math.min(180, p.bpm + 8) });
  else if (/\bslower\b|slow (it )?down/.test(t)) ops.push({ op: 'set_tempo', bpm: Math.max(60, p.bpm - 8) });
  if (n0() > before) rules++; before = n0();
  if (/\b(drop|mute|remove|cut|no|lose|take out)\b/.test(t) && track() && where()) ops.push({ op: 'clear', track: track(), ...where() });
  else if (/\b(double|repeat)\b/.test(t) && where()) { const w = where(), s = w.section ? sec(w.section.toLowerCase()) : { start: w.from - 1, len: w.to - w.from + 1 }; ops.push({ op: 'insert', ...w, at: s.start + s.len + 1 }); }
  else if (/\b(cut|remove|skip|delete|lose)\b/.test(t) && where() && !track()) ops.push({ op: 'delete', ...where() });
  else if (/strip|break ?down|bare/.test(t) && where()) { for (const id of ['drums', 'bass']) if (p.tracks.some(x => x.id === id)) ops.push({ op: 'clear', track: id, ...where() }); }
  else if (/\bonly\b/.test(t) && track() && where()) { for (const tr of p.tracks) if (tr.id !== track()) ops.push({ op: 'clear', track: tr.id, ...where() }); }
  if (n0() > before) rules++;
  return ops.length && rules >= clauses ? { ops } : null; // every part of the request must have been understood
}

// The brief to paste to an assistant: the song, the moves it may use, and the request.
export function briefFor(p, request) {
  const lanes = p.tracks.map(t => `- ${t.id} (${t.kind}): ` + (p.clips.filter(c => c.track === t.id).sort((a, b) => a.start - b.start).map(c => `${c.pattern || 'audio'} bars ${c.start + 1}-${c.start + c.len}`).join('; ') || 'empty')).join('\n');
  return `You are rearranging a song in Stem Studio. Reply with JSON only: {"ops":[...]}.\n\nSong: "${p.name}", ${p.bpm} bpm, ${p.bars} bars, 4/4.\nSections: ${p.sections.map(s => `${s.name} bars ${s.start + 1}-${s.start + s.len}`).join('; ')}.\nTracks and clips:\n${lanes}\nPatterns: ${Object.values(p.patterns).map(x => `${x.id} (${x.kind}, ${x.bars} bar${x.bars > 1 ? 's' : ''})`).join(', ')}.\n\nMoves you may use, applied in order:\n${Object.entries(PLAN_OPS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\nBars are counted from 1. The song can be at most ${MAX_BARS} bars.\n\nRequest: ${request || '(describe the change you want)'}`;
}

// Rebuild anything loaded from a file or storage from known fields only; throws a plain message if it is not a project.
// Nothing from the file is trusted: unknown kinds, odd ids, missing notes and absurd numbers are dropped or clamped here,
// so the rest of the studio never meets them.
const KINDS = ['drums', 'bass', 'keys', 'lead'];
export function validate(p) {
  if (!p || p.v !== 1 || !Array.isArray(p.tracks) || !Array.isArray(p.clips) || !p.patterns || typeof p.patterns !== 'object') throw new Error('That file is not a Stem Studio project');
  const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }, int = (v, lo, hi, d) => Math.round(num(v, lo, hi, d));
  const str = (v, d, max = 40) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : d), okId = v => typeof v === 'string' && /^[A-Za-z0-9][\w-]{0,47}$/.test(v) && !(v in Object.prototype);
  const q = { v: 1, name: str(p.name, 'Untitled', 60), bpm: int(p.bpm, 60, 180, 112), bars: 8, tracks: [], patterns: {}, sections: [], clips: [] }, seen = new Set();
  for (const t of p.tracks.slice(0, 16)) { if (!t || !okId(t.id) || seen.has(t.id) || !(KINDS.includes(t.kind) || t.kind === 'audio')) continue; seen.add(t.id); q.tracks.push({ id: t.id, name: str(t.name, t.id), kind: t.kind, vol: num(t.vol, 0, 1, 0.8), pan: num(t.pan, -1, 1, 0), mute: t.mute === true, solo: t.solo === true }); }
  if (!q.tracks.length) throw new Error('That file is not a Stem Studio project');
  for (const id of Object.keys(p.patterns).slice(0, 200)) {
    const pat = p.patterns[id]; if (!okId(id) || !pat || !KINDS.includes(pat.kind) || !Array.isArray(pat.notes)) continue;
    const bars = int(pat.bars, 1, 16, 1), steps = bars * STEPS, notes = [];
    for (const x of pat.notes.slice(0, 2000)) { if (!x) continue; const t = Number(x.t), ok = pat.kind === 'drums' ? DRUMS.includes(x.p) : Number.isInteger(x.p) && x.p >= 0 && x.p <= 127; if (!Number.isInteger(t) || t < 0 || t >= steps || !ok) continue; notes.push({ t, d: int(x.d, 1, steps - t, 1), p: x.p, v: num(x.v, 0, 1, 0.8) }); }
    q.patterns[id] = { id, name: str(pat.name, id), kind: pat.kind, bars, notes };
  }
  const ids = new Set();
  for (const c of p.clips.slice(0, 600)) {
    if (!c) continue; const t = q.tracks.find(x => x.id === c.track); if (!t || !Number.isInteger(c.start) || c.start < 0 || c.start >= MAX_BARS) continue;
    const pat = t.kind === 'audio' ? null : (typeof c.pattern === 'string' && Object.hasOwn(q.patterns, c.pattern) ? q.patterns[c.pattern] : undefined); if (pat === undefined || (pat && pat.kind !== t.kind)) continue;
    const len = int(c.len, 1, MAX_BARS - c.start, 0); if (len < 1) continue;
    const clip = { id: okId(c.id) && !ids.has(c.id) ? c.id : newId('c'), track: t.id, pattern: pat ? pat.id : null, start: c.start, len }, shift = int(c.shift, 0, MAX_BARS, 0); ids.add(clip.id);
    if (shift) clip.shift = pat ? shift % pat.bars : shift; if (!clip.shift) delete clip.shift;
    q.clips.push(clip);
  }
  for (const t of q.tracks) { let end = 0; for (const c of q.clips.filter(x => x.track === t.id).sort((a, b) => a.start - b.start)) { if (c.start < end) { const cut = end - c.start; c.len -= cut; c.start = end; if (c.len >= 1 && c.pattern) c.shift = ((c.shift || 0) + cut) % q.patterns[c.pattern].bars || undefined; if (c.shift === undefined) delete c.shift; } end = Math.max(end, c.start + Math.max(0, c.len)); } }
  q.clips = q.clips.filter(c => c.len >= 1);
  if (Array.isArray(p.sections)) for (const s of p.sections.slice(0, 32)) { if (!s || !Number.isInteger(s.start) || s.start < 0 || s.start >= MAX_BARS) continue; q.sections.push({ name: str(s.name, 'Section', 24), start: s.start, len: int(s.len, 1, MAX_BARS - s.start, 1) }); }
  q.bars = int(p.bars, 8, MAX_BARS, 8);
  return fit(q);
}
