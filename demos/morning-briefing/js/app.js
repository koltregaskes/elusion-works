// Morning Briefing: the page. reader.js does the arithmetic; this file turns the cards, listens to fingers and keys, and runs the player.
// All the words are in index.html. With scripts off the cards show one after another and there is no player.
import * as R from './reader.js';

const $ = id => document.getElementById(id);
const deck = $('deck'), cards = [...deck.querySelectorAll('.card')], count = cards.length, less = matchMedia('(prefers-reduced-motion: reduce)');
const say = text => { $('live').textContent = text; };
document.body.classList.remove('js-off');

/* ---- The words to be read ---- */
/* Every element marked data-say, in order, split into sentences. Each sentence is wrapped so that it can be marked as it is read. */
const list = R.lines(cards.map(c => ({ id: c.id, title: c.dataset.title, blocks: [...c.querySelectorAll('[data-say]')].map(b => b.textContent) })));
cards.forEach((c, ci) => { c.setAttribute('role', 'group'); c.setAttribute('aria-roledescription', 'card'); c.setAttribute('aria-label', `${ci + 1} of ${count}: ${c.dataset.title}`);
  [...c.querySelectorAll('[data-say]')].forEach((b, bi) => { const mine = list.filter(l => l.card === ci && l.block === bi); b.replaceChildren(...mine.flatMap((l, k) => { const s = document.createElement('span'); s.className = 's'; s.textContent = l.text; l.el = s; return k ? [' ', s] : [s]; })); }); });
deck.setAttribute('aria-roledescription', 'carousel');
$('segs').replaceChildren(...cards.map(() => { const i = document.createElement('i'); i.append(document.createElement('b')); return i; }));

/* ---- The deck ---- */
let index = 0, moving = false, glide = null;
const state = R.createPlayer();
/* Where every card sits when nothing is being dragged: one on top, the next beneath it, the rest out of the way and out of reach. */
function place() { cards.forEach((c, i) => { c.dataset.at = i === index ? 'top' : i === index + 1 ? 'under' : 'away'; c.inert = i !== index; c.tabIndex = i === index ? 0 : -1; /* the card on top can take the keys, so that a tall card on a small screen can be scrolled with them */ c.classList.remove('glide', 'held'); c.style.transform = ''; c.style.filter = ''; c.style.zIndex = ''; c.style.visibility = ''; }); }
/* The cards part-way through a turn. dx is how far the top card has been pulled: left (negative) towards the next card, right towards the one before. */
function lay(dx) { const W = deck.clientWidth || 1, top = cards[index];
  if (dx < 0 && index < count - 1) { const p = R.pose(dx, W, index, count), under = cards[index + 1]; top.style.transform = `translateX(${p.x}px) rotate(${p.tilt}deg)`; under.style.transform = `scale(${0.94 + 0.06 * p.under}) translateY(${10 * (1 - p.under)}px)`; under.style.filter = `brightness(${0.6 + 0.4 * p.under})`; }
  else if (dx > 0 && index > 0) { const k = Math.min(1, dx / W), before = cards[index - 1]; before.style.visibility = 'visible'; before.style.zIndex = '3'; before.style.transform = `translateX(${-W * 1.12 * (1 - k)}px) rotate(${-7 * (1 - k)}deg)`; top.style.transform = `scale(${1 - 0.06 * k}) translateY(${10 * k}px)`; top.style.filter = `brightness(${1 - 0.4 * k})`; }
  else top.style.transform = dx ? `translateX(${R.pose(dx, W, index, count).x}px)` : ''; }
function shown(i, quiet) { clearTimeout(glide); glide = null; moving = false; /* a turn still gliding is overtaken by this one: it must not land afterwards and undo it */ const within = document.activeElement && document.activeElement.closest('.card'); index = i; place();
  const first = R.firstOf(list, i); if (list[state.i].card !== i && first >= 0) { R.seek(state, list, first); if (state.playing) speak(); } /* the player follows the card shown, so that play starts from what you are looking at */
  if (!quiet) say(`Card ${i + 1} of ${count}: ${cards[i].dataset.title}.`); paint(); if (within && within !== cards[index]) (i < count - 1 ? $('next') : $('prev')).focus({ preventScroll: true }); } /* the card that held the focus has gone: keep the keys somewhere useful. After paint(), so that the button is not still switched off from the card before */
/* Turn to the next card (by 1) or the one before (by -1), from wherever a drag has left the top card. */
function turnBy(by, from = 0, quiet = false) { const to = R.turn(index, by, count); if (moving) return; const W = deck.clientWidth || 1, target = to === index ? 0 : by > 0 ? -W * 1.15 : W;
  if (less.matches || (!from && to === index)) { shown(to, quiet || to === index); return; }
  moving = true; lay(from || -0.01 * by); void deck.offsetWidth; for (const c of cards) c.classList.add('glide'); lay(target || 0.0001 * Math.sign(from)); /* first where the cards are now, then, a moment later and gliding, where they are going */ /* a hair off nought, so that a card let go of glides back along the way it came */
  glide = setTimeout(() => shown(to, quiet || to === index), 240); }

/* A finger, or the mouse, on the deck. Up and down scrolls a tall card; across turns it. */
let drag = null;
deck.addEventListener('pointerdown', e => { if (moving || !e.isPrimary || e.button > 0 || e.target.closest('button, input, label, a')) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, trail: [[e.timeStamp, e.clientX]] }; });
deck.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.on) { if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; } if (Math.abs(dx) < 8) return; drag.on = true; try { deck.setPointerCapture(e.pointerId); } catch (err) { /* works without */ } cards[index].classList.add('held'); getSelection()?.removeAllRanges(); }
  drag.trail.push([e.timeStamp, e.clientX]); while (drag.trail.length > 2 && e.timeStamp - drag.trail[0][0] > 90) drag.trail.shift(); lay(less.matches ? 0 : dx); e.preventDefault(); });
function letGo(e) { if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; if (!d.on) return; cards[index].classList.remove('held'); const dx = e.clientX - d.x, a = d.trail[0], b = d.trail[d.trail.length - 1], vx = b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0; turnBy(e.type === 'pointercancel' ? 0 : R.settle(dx, vx, deck.clientWidth || 1), less.matches ? 0 : dx); }
deck.addEventListener('pointerup', letGo); deck.addEventListener('pointercancel', letGo);
deck.addEventListener('click', e => { if (moving) { e.preventDefault(); e.stopPropagation(); } }, true); /* a drag that ends on a tick box should not tick it */
$('prev').addEventListener('click', () => turnBy(-1)); $('next').addEventListener('click', () => turnBy(1));
$('again').addEventListener('click', () => { R.seek(state, list, 0); if (state.playing) speak(); turnTo(0); });
function turnTo(i, quiet = false) { if (i === index) { paint(); return; } if (Math.abs(i - index) === 1) turnBy(i - index, 0, quiet); else { moving = false; shown(i, quiet); } }

/* ---- The voice ---- */
/* The device's own, where it has one. Each sentence is spoken on its own; when the voice has finished one, the player moves to the next. */
const synth = window.briefingSynth || ('speechSynthesis' in window ? window.speechSynthesis : null), Utter = window.briefingUtterance || window.SpeechSynthesisUtterance;
let voiceOn = !!synth, dead = !synth || !Utter, speaking = false, token = 0, manual = false;
const voiced = () => voiceOn && !dead;
function hush() { token++; speaking = false; if (synth) try { synth.cancel(); } catch (err) { /* nothing to stop */ } }
function noVoice() { dead = true; hush(); say('This device gave no voice. The briefing is read along in silence.'); paint(); }
function speak() { hush(); if (!voiced() || !state.playing) return; state.t = 0; const mine = token, u = new Utter(list[state.i].text); let started = false; u.lang = 'en-GB'; u.rate = state.rate;
  try { const v = synth.getVoices().filter(x => /^en/i.test(x.lang)).sort((a, b) => (/GB/i.test(b.lang) ? 1 : 0) - (/GB/i.test(a.lang) ? 1 : 0))[0]; if (v) u.voice = v; } catch (err) { /* the default voice will do */ }
  u.onstart = () => { if (mine === token) { started = true; speaking = true; } };
  u.onend = () => { if (mine !== token) return; speaking = false; if (state.playing) happened(R.finish(state, list)); };
  u.onerror = ev => { if (mine !== token) return; speaking = false; if (ev.error !== 'interrupted' && ev.error !== 'canceled') noVoice(); };
  speaking = true; /* until the voice says otherwise, wait for it: the player holds at the end of the sentence and does not run ahead */
  try { synth.speak(u); } catch (err) { noVoice(); return; }
  setTimeout(() => { if (mine === token && !started && state.playing) noVoice(); }, 2500); } /* no sound of a start in two and a half seconds: there is no voice here */

/* ---- The player ---- */
function happened(seen) { if (list[state.i].card !== index) turnTo(list[state.i].card, voiced()); if (seen.includes('line')) speak(); if (seen.includes('end')) { hush(); say('The end of the briefing.'); } paint(); }
function step(dt) { if (!state.playing) return; const was = state.i, seen = R.advance(state, list, dt, voiced() && speaking); if (seen.length) happened(seen); else if (state.i !== was) paint(); else progress(); }
let last = null; function frame(now) { const dt = last === null ? 0 : Math.min(0.25, (now - last) / 1000); last = now; if (!manual) step(dt); requestAnimationFrame(frame); } requestAnimationFrame(frame);
function toggle() { if (state.ended) { R.seek(state, list, 0); turnTo(0, true); } state.playing = !state.playing; if (state.playing) { speak(); say(voiced() ? '' : 'Reading along in silence.'); } else { hush(); say('Paused.'); } paint(); }
const fmt = r => `${r}×`;
function progress() { const at = R.position(state, list), l = list[state.i]; $('t-at').textContent = R.clock(at.at); $('t-of').textContent = R.clock(at.of);
  const engaged = state.playing || state.i > 0 || state.t > 0; [...$('segs').children].forEach((seg, i) => { seg.classList.toggle('past', i < index || (i === index && !engaged)); seg.firstChild.style.width = i === index && engaged ? `${Math.min(100, ((l.n - 1 + Math.min(1, state.t / l.dur)) / l.of) * 100)}%` : ''; }); }
function paint() { const l = list[state.i], engaged = state.playing || state.i > 0 || state.t > 0 || state.ended, title = cards[l.card].dataset.title;
  $('count').textContent = `${index + 1} of ${count} · ${cards[index].dataset.title}`; $('prev').disabled = index === 0; $('next').disabled = index === count - 1;
  $('play').setAttribute('aria-pressed', String(state.playing)); $('play').setAttribute('aria-label', state.playing ? 'Pause' : state.ended ? 'Read the briefing again from the start' : 'Read the briefing aloud');
  $('rate').textContent = fmt(state.rate); $('rate').setAttribute('aria-label', `Speed ${fmt(state.rate)}: ${R.sayRate(state.rate).toLowerCase()}. Press to change.`);
  $('voice').textContent = dead ? 'No voice' : 'Voice'; $('voice').disabled = dead; $('voice').setAttribute('aria-pressed', String(voiced())); $('voice').setAttribute('aria-label', dead ? 'This device has no voice: the briefing is read along in silence' : voiceOn ? 'Voice on. Press to read along in silence.' : 'Voice off. Press to hear the briefing.');
  $('scrub').max = String(list.length - 1); $('scrub').value = String(state.i); $('scrub').setAttribute('aria-valuetext', `Card ${l.card + 1} of ${count}, ${title}: sentence ${l.n} of ${l.of}`);
  $('now').textContent = state.playing ? `${voiced() ? 'Reading aloud' : 'Reading along in silence'}: ${title}` : state.ended ? 'The end.' : engaged ? `Paused at ${title}, sentence ${l.n} of ${l.of}.` : `About ${R.minutes(R.total(list) / state.rate)} to hear.`;
  deck.classList.toggle('reading', engaged && !state.ended); for (const x of list) { x.el.classList.toggle('now', engaged && !state.ended && x === l); x.el.classList.toggle('done', engaged && x.card === l.card && x.n < l.n); }
  if (engaged && !state.ended && l.card === index) { const card = cards[index], a = l.el.getBoundingClientRect(), b = card.getBoundingClientRect(); if (a.bottom > b.bottom - 12) card.scrollTop += a.bottom - b.bottom + 24; else if (a.top < b.top + 12) card.scrollTop -= b.top - a.top + 24; } /* keep the sentence being read in sight on a tall card */
  progress(); }
const moved = () => { if (list[state.i].card !== index) turnTo(list[state.i].card, true); if (state.playing) speak(); paint(); };
$('play').addEventListener('click', toggle);
$('sback').addEventListener('click', () => { R.back(state, list); moved(); }); $('son').addEventListener('click', () => { R.on(state, list); moved(); });
$('rate').addEventListener('click', () => { state.rate = R.nextRate(state.rate); if (state.playing) speak(); paint(); say(`${R.sayRate(state.rate)}.`); });
$('voice').addEventListener('click', () => { if (dead) return; voiceOn = !voiceOn; if (state.playing) { if (voiceOn) speak(); else hush(); } paint(); say(voiceOn ? 'Voice on.' : 'Voice off: reading along in silence.'); });
$('scrub').addEventListener('input', e => { R.seek(state, list, +e.target.value); moved(); });
addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target, field = t.matches && t.matches('input, button, a, summary');
  if (e.key === 'ArrowRight' && !(t.matches && t.matches('input'))) { turnBy(1); e.preventDefault(); } else if (e.key === 'ArrowLeft' && !(t.matches && t.matches('input'))) { turnBy(-1); e.preventDefault(); }
  else if (e.key === ' ' && !field) { toggle(); e.preventDefault(); } else if (e.key === ',') { R.back(state, list); moved(); } else if (e.key === '.') { R.on(state, list); moved(); } });
addEventListener('pagehide', hush);

/* ---- Go ---- */
shown(0, true);
window.briefing = { /* for the checks in tools/ */
  state: () => ({ index, i: state.i, t: state.t, playing: state.playing, rate: state.rate, ended: state.ended, voice: voiced(), speaking, dead, moving, count, lines: list.length, total: R.total(list) }),
  lines: () => list.map(l => ({ text: l.text, card: l.card, n: l.n, of: l.of, dur: l.dur, start: l.start })),
  manual(on) { manual = on; }, tick(dt) { step(dt); }, /* take the clock out of the page's hands, and move it by hand */
};
