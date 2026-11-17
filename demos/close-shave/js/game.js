// Close Shave: the game's rules. Walls of ink cross a square room, each with one gap; you get through the gap; the closer you cut it, the more it is worth.
// Nothing here touches the page or the clock. A game is a seed and the moves made, so the same seed and the same moves always give the same game, and every rule can be checked in Node.
// The room is 100 units square. Times are seconds, speeds units a second.

export const ROOM = 100, STEP = 1 / 120; // the game moves on in steps of a 120th of a second, however fast the screen draws
export const YOU = { r: 2.2, speed: 70, lives: 3, safe: 1.4 }; // safe: seconds after a hit in which nothing can hit you
export const WALL = { thick: 4, edge: 2 }; // edge: the least room between a gap and the side of the room
export const SHAVE = { within: 2, bonus: 10, most: 4 }; // a close shave: through with under 2 units to spare. Each one raises what the next wall is worth, up to five times
export const PASS = 10, PER_LEVEL = 8; // points for a wall at no multiplier; walls to a level
export const SIDES = ['left', 'right', 'top', 'bottom']; // the side a wall comes in from

// How hard a level is: how fast walls move, how wide the gap, how long the warning, how often a wall comes.
export const level = n => ({ n, speed: Math.min(80, 34 + 5 * (n - 1)), gap: Math.max(11, 20 - 1.2 * (n - 1)), warn: Math.max(0.6, 1 - 0.04 * (n - 1)), every: Math.max(0.75, 1.9 - 0.12 * (n - 1)) });
export const levelOf = passed => 1 + Math.floor(passed / PER_LEVEL);
// A small seeded source of numbers: the same seed gives the same walls.
const next = s => { s.rng = (s.rng + 0x6d2b79f5) | 0; let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function create(seed = 1) { return { seed: seed >>> 0, rng: seed >>> 0, t: 0, x: ROOM / 2, y: ROOM / 2, lives: YOU.lives, safe: 0, score: 0, passed: 0, shaves: 0, streak: 0, best: 0, hits: 0, walls: [], due: 0.6, last: { h: { at: -99, c: ROOM / 2 }, v: { at: -99, c: ROOM / 2 } }, id: 0, over: false }; }
// A wall that comes in from the left or right runs up and down the room, and its gap is somewhere along y; one from the top or bottom has its gap along x.
export const axisOf = side => (side === 'left' || side === 'right' ? 'h' : 'v');
// Where a wall's leading face is, along the way it travels, from 0 (just coming in) to ROOM + thick (just gone).
export const along = (w, t) => (t - w.enters) * w.speed;
// The wall as a rectangle in the room at time t, and its gap as a stretch across it.
export function rect(w, t) { const a = along(w, t), lo = a - WALL.thick, far = w.side === 'right' || w.side === 'bottom', from = far ? ROOM - a : lo, to = far ? ROOM - lo : a; return axisOf(w.side) === 'h' ? { x: from, y: 0, w: to - from, h: ROOM } : { x: 0, y: from, w: ROOM, h: to - from }; }

// A new wall. To be fair, it never comes while the last wall the same way round is still in the room, its gap is never further from that wall's gap than you could move in the time, and it is shown at the edge before it comes in.
function spawn(s, events) { const L = level(levelOf(s.passed)), cross = (ROOM + WALL.thick) / L.speed, free = a => s.t >= s.last[a].at + cross + 0.25; let side = SIDES[Math.floor(next(s) * 4)], a = axisOf(side);
  if (!free(a)) { a = a === 'h' ? 'v' : 'h'; if (!free(a)) { next(s); s.due = s.t + 0.1; return; } side = (a === 'h' ? ['left', 'right'] : ['top', 'bottom'])[Math.floor(next(s) * 2)]; } else next(s);
  const half = L.gap / 2, lo = WALL.edge + half, hi = ROOM - WALL.edge - half, reach = YOU.speed * 0.6 * (L.warn + Math.min(3, s.t - s.last[a].at - cross)), c = clamp(lo + next(s) * (hi - lo), Math.max(lo, s.last[a].c - reach), Math.min(hi, s.last[a].c + reach));
  const w = { id: ++s.id, side, c, gap: L.gap, speed: L.speed, shown: s.t, enters: s.t + L.warn, near: Infinity, met: false, broken: false, level: L.n }; s.walls.push(w); s.last[a] = { at: w.enters, c }; s.due = s.t + L.every; events.push({ type: 'wall', id: w.id, side }); }

// One step of the game. `move` is where you are pushing: x and y from -1 to 1. Returns what happened in the step, for the page to show and say.
export function step(s, move = { x: 0, y: 0 }) { const events = []; if (s.over) return events; s.t += STEP; if (s.safe > 0) s.safe = Math.max(0, s.safe - STEP);
  let mx = clamp(move.x || 0, -1, 1), my = clamp(move.y || 0, -1, 1); const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; } s.x = clamp(s.x + mx * YOU.speed * STEP, YOU.r, ROOM - YOU.r); s.y = clamp(s.y + my * YOU.speed * STEP, YOU.r, ROOM - YOU.r);
  if (s.t >= s.due) spawn(s, events);
  for (const w of s.walls) { if (s.t < w.enters) continue; const r = rect(w, s.t), h = axisOf(w.side) === 'h', p = h ? s.x : s.y, q = h ? s.y : s.x, from = h ? r.x : r.y, to = from + (h ? r.w : r.h);
    if (!w.broken && !w.done && p + YOU.r > from && p - YOU.r < to) { const spare = w.gap / 2 - Math.abs(q - w.c) - YOU.r; w.met = true; if (spare < w.near) w.near = spare; /* you are level with the wall: in the gap, or hit */
      if (spare < 0 && s.safe > 0) w.broken = true; /* in the safe moment a wall goes through you: it does not hit, and it is not a pass either */
      else if (spare < 0) { w.broken = true; s.lives--; s.hits++; s.streak = 0; s.safe = YOU.safe; events.push({ type: 'hit', id: w.id, lives: s.lives }); if (s.lives <= 0) { s.over = true; events.push({ type: 'over', score: s.score }); return events; } } }
    else if (w.met && !w.done && !w.broken) { /* it has gone by, and you came through its gap */ w.done = true; const close = w.near < SHAVE.within, times = 1 + s.streak, points = PASS * times + (close ? SHAVE.bonus * times : 0), was = levelOf(s.passed); s.score += points; s.passed++; if (close) { s.shaves++; s.streak = Math.min(SHAVE.most, s.streak + 1); } else s.streak = Math.max(0, s.streak - 1); if (s.streak > s.best) s.best = s.streak;
      events.push({ type: 'pass', id: w.id, close, points, spare: w.near, times }); if (levelOf(s.passed) > was) events.push({ type: 'level', level: levelOf(s.passed) }); }
    else if (w.met && !w.done && w.broken) w.done = true; }
  s.walls = s.walls.filter(w => along(w, s.t) < ROOM + WALL.thick + 1); return events; }

// The moves a careful player would make: for each way round, go to the gap of the wall that will reach you first, and stay level with it. Used by the checks to prove that every wall can be got through, and by the page to show the game being played.
export function careful(s, aim = 0) { const out = { x: 0, y: 0 }; for (const a of ['h', 'v']) { let first = null, when = Infinity; for (const w of s.walls) { if (axisOf(w.side) !== a || w.done || w.broken) continue; const p = a === 'h' ? s.x : s.y, far = w.side === 'right' || w.side === 'bottom', gone = far ? ROOM - p + YOU.r + WALL.thick : p + YOU.r + WALL.thick, at = w.enters + gone / w.speed; if (at > s.t && at < when) { when = at; first = w; } }
    if (!first) continue; const q = a === 'h' ? s.y : s.x, want = first.c + aim * (first.gap / 2 - YOU.r), d = want - q, push = clamp(d / (YOU.speed * STEP), -1, 1); if (a === 'h') out.y = push; else out.x = push; } return out; }
// A game as a short string, for comparing two games.
export const print = s => [s.t.toFixed(3), s.x.toFixed(3), s.y.toFixed(3), s.lives, s.score, s.passed, s.shaves, s.streak, s.walls.map(w => `${w.id}${w.side[0]}${w.c.toFixed(2)}`).join(',')].join('|');
