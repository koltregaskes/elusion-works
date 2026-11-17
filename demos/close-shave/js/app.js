// Close Shave: the page. game.js holds the rules; this file draws the room, reads the keys and the finger, keeps time, and shows the screens around the game. Nothing is saved or sent.
import * as G from './game.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const canvas = $('room'), ctx = canvas.getContext('2d'), board = $('board'), say = text => { $('live').textContent = text; };
const still = matchMedia('(prefers-reduced-motion: reduce)'); /* less movement: no trail behind you, no shake on a hit, and words that do not drift. The walls still move: that is the game. */
document.body.classList.replace('js-off', 'js-on');

let game = G.create(1), mode = 'ready', seed = 1, slow = false, sound = false, bestScore = 0, pops = [], trail = [], shake = 0, lastHit = -9, burst = null, audio = null;
const INK = '#f4f5f3', DARK = '#15181b', DOT = '#22272b', GREEN = '#3fe08a';

/* ---- Moving: keys held, or a finger dragged. Keys are read by where they are on the keyboard, so W A S D are the same four keys on any layout. ---- */
const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1] }, held = new Set(); let drag = null, forced = null, creep = false;
function move() { if (forced) return forced(game); let x = 0, y = 0; for (const k of held) { x += KEYS[k][0]; y += KEYS[k][1]; }
  if (drag) { const far = G.YOU.speed * G.STEP; x = Math.max(-1, Math.min(1, (drag.tx - game.x) / far)); y = Math.max(-1, Math.min(1, (drag.ty - game.y) / far)); return { x, y }; } return { x, y, slow: creep }; }
addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return; creep = e.shiftKey; const onButton = e.target.closest && e.target.closest('button, a');
  if (KEYS[e.code]) { if (mode === 'playing') { held.add(e.code); e.preventDefault(); } return; }
  if (e.code === 'KeyP' || e.key === 'Escape') { if (mode === 'playing') pause(); else if (mode === 'paused') resume(); e.preventDefault(); return; }
  if (e.key === ' ' || e.key === 'Enter') { if (mode === 'playing') { e.preventDefault(); return; } /* while a game is running, Space and Enter do nothing: they must not press a button that happens to hold the focus */ if (onButton) return; if (mode === 'ready' || mode === 'over') start(seed); else if (mode === 'paused') resume(); e.preventDefault(); } });
addEventListener('keyup', e => { creep = e.shiftKey; held.delete(e.code); });
/* A drag moves you by as much as the finger moves, from where you were: the finger need not be on you, so it does not hide you. If the finger goes on past a wall of the room, the drag starts afresh from there, so that coming back moves you at once. One finger at a time. */
const toRoom = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * G.ROOM, y: (e.clientY - r.top) / r.width * G.ROOM }; }, inside = v => Math.max(G.YOU.r, Math.min(G.ROOM - G.YOU.r, v));
canvas.addEventListener('pointerdown', e => { if (mode !== 'playing' || drag) return; const p = toRoom(e); drag = { id: e.pointerId, px: p.x, py: p.y, gx: game.x, gy: game.y, tx: game.x, ty: game.y }; canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
canvas.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; const p = toRoom(e), wantX = drag.gx + (p.x - drag.px) * 1.25, wantY = drag.gy + (p.y - drag.py) * 1.25; drag.tx = inside(wantX); drag.ty = inside(wantY); if (drag.tx !== wantX) { drag.px = p.x; drag.gx = drag.tx; } if (drag.ty !== wantY) { drag.py = p.y; drag.gy = drag.ty; } });
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, e => { if (drag && e.pointerId === drag.id) drag = null; });

/* ---- Sound: off until asked for ---- */
function beep(freq, len, type = 'square', when = 0) { if (!sound || !audio) return; const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + when; o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len); o.connect(g).connect(audio.destination); o.start(t); o.stop(t + len); }

/* ---- What happens in the game, shown and said ---- */
function happened(events) { for (const e of events) {
  if (e.type === 'pass') { if (e.close) { pops.push({ x: game.x, y: game.y, text: `CLOSE SHAVE ${Math.max(0, e.spare).toFixed(1)}`, at: game.t }); beep(660, 0.07); beep(990, 0.09, 'square', 0.07); } else beep(440, 0.05); }
  if (e.type === 'hit') { pops.push({ x: game.x, y: game.y, text: 'OUCH', at: game.t }); burst = { x: game.x, y: game.y, at: game.t }; shake = 0.25; lastHit = game.t; beep(110, 0.25, 'sawtooth'); say(`Hit. ${e.lives === 1 ? '1 life' : `${e.lives} lives`} left.`); }
  if (e.type === 'level') { pops.push({ x: G.ROOM / 2, y: 16, text: `LEVEL ${e.level}`, at: game.t }); beep(523, 0.08); beep(784, 0.12, 'square', 0.08); say(`Level ${e.level}.`); }
  if (e.type === 'over') finish(); } }
function hud() { $('h-score').textContent = game.score; $('h-pips').textContent = '●'.repeat(game.lives) + '○'.repeat(G.YOU.lives - game.lives); $('h-lives').textContent = game.lives; $('h-level').textContent = G.levelOf(game.passed); $('h-times').textContent = `×${1 + game.streak}`; }

/* ---- The screens around the game ---- */
function cover(title, words, stats, go, other) { $('cover').hidden = !title; if (!title) return; $('c-title').textContent = title; $('c-words').textContent = words; $('c-words').hidden = !words; $('c-stats').hidden = !stats; if (stats) $('c-stats').replaceChildren(...stats.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])); $('c-go').textContent = go; $('c-other').hidden = !other; }
function setMode(next) { mode = next; $('pause').disabled = mode !== 'playing' && mode !== 'paused'; $('pause').textContent = mode === 'paused' ? 'Resume' : 'Pause'; canvas.setAttribute('aria-label', mode === 'playing' ? 'The room. The game is running.' : 'The room'); }
/* The room and the buttons above it are brought into sight together, so that Pause can always be reached while you play. */
function toGame() { const g = document.querySelector('.game').getBoundingClientRect(); if (g.top < 0 || g.bottom > innerHeight) scrollTo(0, Math.max(0, scrollY + g.top - 8)); }
function start(to) { seed = to >>> 0 || 1; game = G.create(seed); pops = []; trail = []; shake = 0; lastHit = -9; burst = null; held.clear(); drag = null; acc = 0; hud(); cover(''); setMode('playing'); board.focus({ preventScroll: true }); toGame(); say('Started.'); }
function pause() { if (mode !== 'playing') return; held.clear(); drag = null; setMode('paused'); cover('Paused', '', null, 'Resume', false); $('c-go').focus({ preventScroll: true }); say('Paused.'); }
function resume() { if (mode !== 'paused') return; acc = 0; cover(''); setMode('playing'); board.focus({ preventScroll: true }); toGame(); say('Resumed.'); }
const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;
function finish() { const top = !slow && game.score > bestScore; if (top) bestScore = game.score; held.clear(); drag = null; setMode('over'); /* a game played at the slower speed is not set against one played at full speed */
  cover('Game over', '', [['Score', String(game.score)], ['Best this visit', String(bestScore)], ['Walls', String(game.passed)], ['Close shaves', String(game.shaves)], ['Best run', `×${1 + game.best}`], ['Level', String(G.levelOf(game.passed))], ...(slow ? [['Speed', 'Slower']] : [])], 'Same walls again', true);
  $('c-title').focus({ preventScroll: true }); $('cover').scrollIntoView({ block: 'nearest' }); say(`Game over. ${many(game.score, 'point', 'points')}, ${many(game.passed, 'wall', 'walls')}, ${many(game.shaves, 'close shave', 'close shaves')}.${top && game.score ? ' Your best this visit.' : ''}`); }
$('c-go').addEventListener('click', () => { if (mode === 'paused') resume(); else start(seed); });
$('c-other').addEventListener('click', () => start(1 + Math.floor(Math.random() * 9999)));
$('pause').addEventListener('click', () => { if (mode === 'playing') pause(); else resume(); });
/* A button pressed in the middle of a game hands the focus back to the room, so that the keys go on going to the game. */
const back = () => { if (mode === 'playing') board.focus({ preventScroll: true }); };
$('slow').addEventListener('click', () => { slow = !slow; $('slow').setAttribute('aria-pressed', slow); say(slow ? 'Slower: the game runs at six tenths of its speed.' : 'Full speed.'); back(); });
$('sound').addEventListener('click', () => { sound = !sound; $('sound').setAttribute('aria-pressed', sound); if (sound) { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); beep(660, 0.08); } say(sound ? 'Sound on.' : 'Sound off.'); back(); });
/* Looking away pauses the game. */
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); }); addEventListener('blur', pause);

/* ---- Drawing. Everything is drawn in the room's own units, 100 across. ---- */
let dots = null;
function size() { const w = canvas.getBoundingClientRect().width, px = Math.max(1, Math.min(2400, Math.round(w * Math.min(devicePixelRatio || 1, 3)))); if (canvas.width !== px) { canvas.width = canvas.height = px; dots = null; } }
function backdrop() { if (dots) return dots; dots = document.createElement('canvas'); dots.width = dots.height = canvas.width; const c = dots.getContext('2d'), k = canvas.width / G.ROOM; c.fillStyle = DARK; c.fillRect(0, 0, dots.width, dots.height); c.fillStyle = DOT; for (let row = 0, y = 2.5; y < G.ROOM; y += 4.33, row++) for (let x = 2.5 + (row % 2 ? 2.5 : 0); x < G.ROOM; x += 5) { c.beginPath(); c.arc(x * k, y * k, 0.42 * k, 0, 7); c.fill(); } return dots; }
/* A wall in two pieces, either side of its gap. */
function pieces(w, r) { const h = G.axisOf(w.side) === 'h', a = w.c - w.gap / 2, b = w.c + w.gap / 2; return h ? [[r.x, 0, r.w, a], [r.x, b, r.w, G.ROOM - b]] : [[0, r.y, a, r.h], [b, r.y, G.ROOM - b, r.h]]; }
/* Ink thrown off behind a wall as it moves: three rows of dots, each smaller than the last, as tones are printed in a comic. */
function spray(w, r) { const h = G.axisOf(w.side) === 'h', far = w.side === 'right' || w.side === 'bottom', a = w.c - w.gap / 2, b = w.c + w.gap / 2, back = far ? (h ? r.x + r.w : r.y + r.h) : (h ? r.x : r.y), dir = far ? 1 : -1;
  for (let row = 0; row < 3; row++) { const at = back + dir * (1.5 + row * 2.3), rad = 0.85 - row * 0.24; for (let v = 1.2 + (row % 2) * 1.2; v < G.ROOM; v += 2.4) { if (v > a - 0.6 && v < b + 0.6) continue; ctx.beginPath(); ctx.arc(h ? at : v, h ? v : at, rad, 0, 7); ctx.fill(); } } }
function caption(text, x, y, alpha) { ctx.font = '800 3.4px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const w = ctx.measureText(text).width + 4, bx = Math.max(1, Math.min(G.ROOM - w - 2, x - w / 2)), by = Math.max(1, Math.min(G.ROOM - 8, y - 3)); ctx.globalAlpha = alpha; ctx.fillStyle = '#000'; ctx.fillRect(bx + 0.7, by + 0.7, w, 6); ctx.fillStyle = INK; ctx.fillRect(bx, by, w, 6); ctx.fillStyle = '#0b0c0d'; ctx.fillText(text, bx + w / 2, by + 3.2); ctx.globalAlpha = 1; }
function star(x, y, big, small, points) { ctx.beginPath(); for (let i = 0; i < points * 2; i++) { const a = i / (points * 2) * Math.PI * 2 - 0.3, r = i % 2 ? small : big; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }
function draw() { size(); const k = canvas.width / G.ROOM, t = game.t, calm = still.matches; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(backdrop(), 0, 0); const jolt = !calm && shake > 0 ? shake * 4 : 0; ctx.setTransform(k, 0, 0, k, Math.sin(t * 90) * jolt * k, Math.cos(t * 70) * jolt * k);
  const live = game.walls.filter(w => t >= w.enters).map(w => ({ w, r: G.rect(w, t) })).map(o => ({ ...o, parts: pieces(o.w, o.r) }));
  for (const w of game.walls) if (t < w.enters) { /* the warning: the wall shown at the side it will come from, its gap already in place, growing clearer */ const far = w.side === 'right' || w.side === 'bottom', h = G.axisOf(w.side) === 'h', r = h ? { x: far ? G.ROOM - 2.2 : 0, y: 0, w: 2.2, h: G.ROOM } : { x: 0, y: far ? G.ROOM - 2.2 : 0, w: G.ROOM, h: 2.2 }; ctx.globalAlpha = 0.5 + 0.5 * (t - w.shown) / (w.enters - w.shown); ctx.fillStyle = INK; for (const p of pieces(w, r)) ctx.fillRect(...p); ctx.globalAlpha = 1; }
  ctx.fillStyle = '#000'; for (const o of live) { ctx.globalAlpha = o.w.broken ? 0.3 : 1; for (const p of o.parts) ctx.fillRect(p[0] + 0.7, p[1] + 0.7, p[2], p[3]); } /* every shadow first, so that no shadow falls across another wall */
  ctx.fillStyle = INK; for (const o of live) { ctx.globalAlpha = o.w.broken ? 0.45 : 1; for (const p of o.parts) ctx.fillRect(...p); if (!o.w.broken) spray(o.w, o.r); } ctx.globalAlpha = 1;
  ctx.fillStyle = GREEN; for (const o of live) if (!o.w.broken && !o.w.done) { const h = G.axisOf(o.w.side) === 'h', a = o.w.c - o.w.gap / 2, b = o.w.c + o.w.gap / 2; if (h) { ctx.fillRect(o.r.x, a - 0.7, o.r.w, 0.7); ctx.fillRect(o.r.x, b, o.r.w, 0.7); } else { ctx.fillRect(a - 0.7, o.r.y, 0.7, o.r.h); ctx.fillRect(b, o.r.y, 0.7, o.r.h); } } /* the two edges of the gap, marked: get within a whisker of one for a close shave */
  if (burst && t - burst.at < 0.45) { ctx.globalAlpha = calm ? 1 : 1 - (t - burst.at) / 0.45 * 0.5; ctx.fillStyle = '#000'; star(burst.x + 0.8, burst.y + 0.8, 9, 5, 11); ctx.fill(); ctx.fillStyle = INK; star(burst.x, burst.y, 9, 5, 11); ctx.fill(); ctx.globalAlpha = 1; } /* a hit, as a comic draws one */
  if (!calm) for (let i = 0; i < trail.length; i++) { ctx.globalAlpha = 0.07 * (i + 1); ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(trail[i][0], trail[i][1], G.YOU.r * (0.5 + 0.08 * i), 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
  ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(game.x, game.y, G.YOU.r, 0, 7); ctx.fill(); ctx.lineWidth = 0.5; ctx.strokeStyle = '#06210f'; ctx.stroke();
  if (game.safe > 0) { ctx.setLineDash([1.6, 1.2]); ctx.lineWidth = 0.9; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(game.x, game.y, G.YOU.r + 1.8, 0, 7); ctx.stroke(); ctx.setLineDash([]); } /* safe for a moment after a hit: a dashed ring, not a flash */
  for (const p of pops) { const age = (t - p.at) / 0.9; caption(p.text, p.x, p.y - 7 - (calm ? 0 : age * 5), age > 0.7 ? Math.max(0, 1 - (age - 0.7) / 0.3) : 1); } }

/* ---- Time. The game moves in fixed steps; the screen draws as often as it can. ---- */
let acc = 0, before = 0;
function advance(seconds, timed = true) { acc += seconds * (timed && slow ? 0.6 : 1); /* timed: by the clock, so Slower applies. The checks also play games step by step, where it does not. */ while (acc >= G.STEP && mode === 'playing') { acc -= G.STEP; happened(G.step(game, move())); if (trail.length === 0 || Math.hypot(game.x - trail.at(-1)[0], game.y - trail.at(-1)[1]) > 0.8) { trail.push([game.x, game.y]); if (trail.length > 7) trail.shift(); } } pops = pops.filter(p => game.t - p.at < 0.9); if (shake > 0) shake = Math.max(0, 0.25 - (game.t - lastHit)); hud(); }
function frame(now) { const dt = Math.min(0.1, (now - before) / 1000); before = now; if (mode === 'playing' && !forced) advance(dt); draw(); requestAnimationFrame(frame); }
addEventListener('resize', draw);
cover('Ready?', $('c-words').textContent, null, 'Start', false); setMode('ready'); hud(); requestAnimationFrame(now => { before = now; frame(now); });

/* For the checks in tools/: read the game, and play it a set number of seconds with moves made by rule, not by the clock. `clock` runs the page's own timekeeping for a stated number of seconds, as if that much time had passed on the screen. */
window.closeShave = { state: () => ({ mode, seed, slow, sound, bestScore, creep, calm: still.matches, t: game.t, x: game.x, y: game.y, lives: game.lives, score: game.score, passed: game.passed, shaves: game.shaves, streak: game.streak, level: G.levelOf(game.passed), walls: game.walls.length, safe: game.safe, over: game.over, pops: pops.map(p => p.text), trail: trail.length, shake, drag: drag ? { tx: drag.tx, ty: drag.ty } : null, print: G.print(game) }),
  start, clock(seconds, frames = 60) { for (let k = 0; k < Math.round(seconds * frames); k++) advance(1 / frames); draw(); },
  play(seconds, how = 'careful') { forced = how === 'still' ? () => ({ x: 0, y: 0 }) : how === 'fine' ? s => G.careful(s, 0.9) : s => G.careful(s, 0); acc = 0; for (let k = 0; k < Math.round(seconds / G.STEP) && mode === 'playing'; k++) advance(G.STEP, false); forced = null; acc = 0; draw(); } };
