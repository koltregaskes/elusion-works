// Close Shave: the page. game.js holds the rules; this file draws the room, reads the keys and the finger, keeps time, and shows the screens around the game. Nothing is saved or sent.
import * as G from './game.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const canvas = $('room'), ctx = canvas.getContext('2d'), board = $('board'), say = text => { $('live').textContent = text; };
const still = matchMedia('(prefers-reduced-motion: reduce)'); /* less movement: no trail behind you, no shake on a hit, and words that do not drift. The walls still move: that is the game. */
document.body.classList.replace('js-off', 'js-on');

let game = G.create(1), mode = 'ready', seed = 1, slow = false, sound = false, bestScore = 0, pops = [], trail = [], shake = 0, lastHit = -9, audio = null;
const INK = '#f4f5f3', DARK = '#15181b', DOT = '#22272b', GREEN = '#3fe08a';

/* ---- Moving: keys held, or a finger dragged ---- */
const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] }, held = new Set(); let drag = null, forced = null;
function move() { if (forced) return forced(game); let x = 0, y = 0; for (const k of held) { x += KEYS[k][0]; y += KEYS[k][1]; }
  if (drag) { const far = G.YOU.speed * G.STEP; x = Math.max(-1, Math.min(1, (drag.tx - game.x) / far)); y = Math.max(-1, Math.min(1, (drag.ty - game.y) / far)); } return { x, y }; }
addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, onButton = e.target.closest && e.target.closest('button, a');
  if (KEYS[k]) { if (mode === 'playing') { held.add(k); e.preventDefault(); } return; }
  if (k === 'p' || k === 'Escape') { if (mode === 'playing') pause(); else if (mode === 'paused') resume(); e.preventDefault(); return; }
  if ((k === ' ' || k === 'Enter') && !onButton) { if (mode === 'ready' || mode === 'over') start(seed); else if (mode === 'paused') resume(); e.preventDefault(); } });
addEventListener('keyup', e => { held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
/* A drag moves you by as much as the finger moves, from where you were: the finger need not be on you, so it does not hide you. */
const toRoom = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * G.ROOM, y: (e.clientY - r.top) / r.height * G.ROOM }; };
canvas.addEventListener('pointerdown', e => { if (mode !== 'playing') return; const p = toRoom(e); drag = { id: e.pointerId, px: p.x, py: p.y, gx: game.x, gy: game.y, tx: game.x, ty: game.y }; canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
canvas.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; const p = toRoom(e); drag.tx = drag.gx + (p.x - drag.px) * 1.25; drag.ty = drag.gy + (p.y - drag.py) * 1.25; });
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, e => { if (drag && e.pointerId === drag.id) drag = null; });

/* ---- Sound: off until asked for ---- */
function beep(freq, len, type = 'square', when = 0) { if (!sound || !audio) return; const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + when; o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len); o.connect(g).connect(audio.destination); o.start(t); o.stop(t + len); }

/* ---- What happens in the game, shown and said ---- */
function happened(events) { for (const e of events) {
  if (e.type === 'pass') { if (e.close) { pops.push({ x: game.x, y: game.y, text: e.times > 1 ? `CLOSE SHAVE ×${e.times}` : 'CLOSE SHAVE', at: game.t }); beep(660, 0.07); beep(990, 0.09, 'square', 0.07); } else beep(440, 0.05); }
  if (e.type === 'hit') { pops.push({ x: game.x, y: game.y, text: 'OUCH', at: game.t }); shake = 0.25; lastHit = game.t; beep(110, 0.25, 'sawtooth'); say(`Hit. ${e.lives === 1 ? '1 life' : `${e.lives} lives`} left.`); }
  if (e.type === 'level') { pops.push({ x: G.ROOM / 2, y: 16, text: `LEVEL ${e.level}`, at: game.t }); beep(523, 0.08); beep(784, 0.12, 'square', 0.08); say(`Level ${e.level}.`); }
  if (e.type === 'over') finish(); } }
function hud() { $('h-score').textContent = game.score; $('h-pips').textContent = '●'.repeat(game.lives) + '○'.repeat(G.YOU.lives - game.lives); $('h-lives').textContent = game.lives; $('h-level').textContent = G.levelOf(game.passed); $('h-times').textContent = `×${1 + game.streak}`; }

/* ---- The screens around the game ---- */
function cover(title, words, stats, go, other) { $('cover').hidden = !title; if (!title) return; $('c-title').textContent = title; $('c-words').textContent = words; $('c-words').hidden = !words; $('c-stats').hidden = !stats; if (stats) $('c-stats').replaceChildren(...stats.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])); $('c-go').textContent = go; $('c-other').hidden = !other; }
function setMode(next) { mode = next; $('pause').disabled = mode !== 'playing' && mode !== 'paused'; $('pause').setAttribute('aria-pressed', mode === 'paused'); $('pause').textContent = mode === 'paused' ? 'Resume' : 'Pause'; canvas.setAttribute('aria-label', mode === 'playing' ? 'The room. The game is running.' : 'The room'); }
function start(to) { seed = to >>> 0 || 1; game = G.create(seed); pops = []; trail = []; shake = 0; lastHit = -9; held.clear(); drag = null; acc = 0; $('run').textContent = `Walls no. ${seed}${slow ? ', slower' : ''}`; hud(); cover(''); setMode('playing'); board.focus({ preventScroll: true }); say('Started.'); }
function pause() { if (mode !== 'playing') return; held.clear(); drag = null; setMode('paused'); cover('Paused', '', null, 'Resume', false); $('c-go').focus({ preventScroll: true }); say('Paused.'); }
function resume() { if (mode !== 'paused') return; acc = 0; cover(''); setMode('playing'); board.focus({ preventScroll: true }); say('Going again.'); }
function finish() { const top = game.score > bestScore; if (top) bestScore = game.score; held.clear(); drag = null; setMode('over');
  cover('Game over', '', [['Score', String(game.score)], ['Best this visit', String(bestScore)], ['Walls', String(game.passed)], ['Close shaves', String(game.shaves)], ['Best run', `×${1 + game.best}`], ['Level', String(G.levelOf(game.passed))], ...(slow ? [['Speed', 'Slower']] : [])], 'Same walls again', true);
  $('c-title').focus({ preventScroll: true }); const many = (n, one, more) => `${n} ${n === 1 ? one : more}`; say(`Game over. ${many(game.score, 'point', 'points')}, ${many(game.passed, 'wall', 'walls')}, ${many(game.shaves, 'close shave', 'close shaves')}.${top && game.score ? ' Your best this visit.' : ''}`); }
$('c-go').addEventListener('click', () => { if (mode === 'paused') resume(); else start(seed); });
$('c-other').addEventListener('click', () => start(1 + Math.floor(Math.random() * 9999)));
$('pause').addEventListener('click', () => { if (mode === 'playing') pause(); else resume(); });
$('slow').addEventListener('click', () => { slow = !slow; $('slow').setAttribute('aria-pressed', slow); $('run').textContent = `Walls no. ${seed}${slow ? ', slower' : ''}`; say(slow ? 'Slower: the game runs at six tenths of its speed.' : 'Full speed.'); });
$('sound').addEventListener('click', () => { sound = !sound; $('sound').setAttribute('aria-pressed', sound); if (sound) { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); beep(660, 0.08); } say(sound ? 'Sound on.' : 'Sound off.'); });
/* Looking away pauses the game. */
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); }); addEventListener('blur', pause);

/* ---- Drawing. Everything is drawn in the room's own units, 100 across. ---- */
let dots = null;
function size() { const r = canvas.getBoundingClientRect(), px = Math.max(240, Math.min(1600, Math.round(r.width * Math.min(devicePixelRatio || 1, 2)))); if (canvas.width !== px) { canvas.width = canvas.height = px; dots = null; } }
function backdrop() { if (dots) return dots; dots = document.createElement('canvas'); dots.width = dots.height = canvas.width; const c = dots.getContext('2d'), k = canvas.width / G.ROOM; c.fillStyle = DARK; c.fillRect(0, 0, dots.width, dots.height); c.fillStyle = DOT; for (let row = 0, y = 2.5; y < G.ROOM; y += 4.33, row++) for (let x = 2.5 + (row % 2 ? 2.5 : 0); x < G.ROOM; x += 5) { c.beginPath(); c.arc(x * k, y * k, 0.42 * k, 0, 7); c.fill(); } return dots; }
/* A wall in two pieces, either side of its gap. */
function pieces(w, r) { const h = G.axisOf(w.side) === 'h', a = w.c - w.gap / 2, b = w.c + w.gap / 2; return h ? [[r.x, 0, r.w, a], [r.x, b, r.w, G.ROOM - b]] : [[0, r.y, a, r.h], [b, r.y, G.ROOM - b, r.h]]; }
function caption(text, x, y, alpha) { ctx.font = '800 3.4px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const w = ctx.measureText(text).width + 4, bx = Math.max(1, Math.min(G.ROOM - w - 2, x - w / 2)), by = Math.max(1, Math.min(G.ROOM - 8, y - 3)); ctx.globalAlpha = alpha; ctx.fillStyle = '#000'; ctx.fillRect(bx + 0.7, by + 0.7, w, 6); ctx.fillStyle = INK; ctx.fillRect(bx, by, w, 6); ctx.fillStyle = '#0b0c0d'; ctx.fillText(text, bx + w / 2, by + 3.2); ctx.globalAlpha = 1; }
function draw() { size(); const k = canvas.width / G.ROOM, t = game.t, calm = still.matches; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(backdrop(), 0, 0); const jolt = !calm && shake > 0 ? shake * 4 : 0; ctx.setTransform(k, 0, 0, k, Math.sin(t * 90) * jolt * k, Math.cos(t * 70) * jolt * k);
  for (const w of game.walls) { if (t < w.enters) { /* the warning: the wall shown thin at the side it will come from, its gap already in place, growing clearer */ const far = w.side === 'right' || w.side === 'bottom', h = G.axisOf(w.side) === 'h', r = h ? { x: far ? G.ROOM - 1.4 : 0, y: 0, w: 1.4, h: G.ROOM } : { x: 0, y: far ? G.ROOM - 1.4 : 0, w: G.ROOM, h: 1.4 }; ctx.globalAlpha = 0.3 + 0.6 * (t - w.shown) / (w.enters - w.shown); ctx.fillStyle = INK; for (const p of pieces(w, r)) ctx.fillRect(...p); ctx.globalAlpha = 1; continue; }
    const r = G.rect(w, t), parts = pieces(w, r); ctx.globalAlpha = w.broken ? 0.28 : 1; ctx.fillStyle = '#000'; for (const p of parts) ctx.fillRect(p[0] + 0.7, p[1] + 0.7, p[2], p[3]); ctx.fillStyle = INK; for (const p of parts) ctx.fillRect(...p); ctx.globalAlpha = 1; }
  if (!calm) for (let i = 0; i < trail.length; i++) { ctx.globalAlpha = 0.07 * (i + 1); ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(trail[i][0], trail[i][1], G.YOU.r * (0.5 + 0.08 * i), 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
  ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(game.x, game.y, G.YOU.r, 0, 7); ctx.fill(); ctx.lineWidth = 0.5; ctx.strokeStyle = '#06210f'; ctx.stroke();
  if (game.safe > 0) { ctx.setLineDash([1.2, 1.2]); ctx.lineWidth = 0.5; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(game.x, game.y, G.YOU.r + 1.6, 0, 7); ctx.stroke(); ctx.setLineDash([]); } /* safe for a moment after a hit: a dashed ring, not a flash */
  for (const p of pops) { const age = (t - p.at) / 0.9; caption(p.text, p.x, p.y - 6 - (calm ? 0 : age * 5), age > 0.7 ? Math.max(0, 1 - (age - 0.7) / 0.3) : 1); } }

/* ---- Time. The game moves in fixed steps; the screen draws as often as it can. ---- */
let acc = 0, before = 0;
function advance(seconds) { acc += seconds * (slow ? 0.6 : 1); while (acc >= G.STEP && mode === 'playing') { acc -= G.STEP; happened(G.step(game, move())); if (trail.length === 0 || Math.hypot(game.x - trail.at(-1)[0], game.y - trail.at(-1)[1]) > 0.8) { trail.push([game.x, game.y]); if (trail.length > 7) trail.shift(); } } pops = pops.filter(p => game.t - p.at < 0.9); if (shake > 0) shake = Math.max(0, 0.25 - (game.t - lastHit)); hud(); }
function frame(now) { const dt = Math.min(0.1, (now - before) / 1000); before = now; if (mode === 'playing' && !forced) advance(dt); draw(); requestAnimationFrame(frame); }
addEventListener('resize', draw);
cover('Ready?', $('c-words').textContent, null, 'Start', false); setMode('ready'); hud(); requestAnimationFrame(now => { before = now; frame(now); });

/* For the checks in tools/: read the game, and play it a set number of seconds with moves made by rule, not by the clock. */
window.closeShave = { state: () => ({ mode, seed, slow, sound, bestScore, calm: still.matches, t: game.t, x: game.x, y: game.y, lives: game.lives, score: game.score, passed: game.passed, shaves: game.shaves, streak: game.streak, level: G.levelOf(game.passed), walls: game.walls.length, safe: game.safe, over: game.over, pops: pops.map(p => p.text), trail: trail.length, shake, print: G.print(game) }),
  start, play(seconds, how = 'careful') { forced = how === 'still' ? () => ({ x: 0, y: 0 }) : how === 'fine' ? s => G.careful(s, 0.9) : s => G.careful(s, 0); const was = slow; slow = false; acc = 0; for (let k = 0; k < Math.round(seconds / G.STEP) && mode === 'playing'; k++) advance(G.STEP); slow = was; forced = null; acc = 0; draw(); } };
