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
cards.forEach((c, ci) => { c.setAttribute('aria-roledescription', 'card');
  [...c.querySelectorAll('[data-say]')].forEach((b, bi) => { const mine = list.filter(l => l.card === ci && l.block === bi); b.replaceChildren(...mine.flatMap((l, k) => { const s = document.createElement('span'); s.className = 's'; s.textContent = l.text; l.el = s; return k ? [' ', s] : [s]; })); }); });
deck.setAttribute('aria-roledescription', 'carousel');
$('segs').replaceChildren(...cards.map(() => { const i = document.createElement('i'); i.append(document.createElement('b')); return i; }));

/* ---- The deck ---- */
let index = 0, moving = false, glide = null, begun = false; /* begun: Play has been pressed at least once. Until then the cards are only being looked through, and nothing is marked as read */
const state = R.createPlayer();
/* A tall card on a small screen scrolls. While there is more of it below, the deck says so. */
function cue() { const c = cards[index]; deck.classList.toggle('more', c.scrollHeight - c.clientHeight - c.scrollTop > 10); }
/* Where every card sits when nothing is being dragged: one on top, the next beneath it, the rest out of the way and out of reach. */
function place() { cards.forEach((c, i) => { c.dataset.at = i === index ? 'top' : i === index + 1 ? 'under' : 'away'; c.inert = i !== index; c.tabIndex = i === index ? 0 : -1; /* the card on top can take the keys, so that a tall card can be scrolled with them */ c.classList.remove('glide', 'held'); c.style.transform = ''; c.style.filter = ''; c.style.zIndex = ''; c.style.visibility = ''; }); cue(); }
/* The cards part-way through a turn. dx is how far the top card has been pulled: left (negative) towards the next card, right towards the one before. */
function lay(dx) { const W = deck.clientWidth || 1, top = cards[index];
  if (dx < 0 && index < count - 1) { const p = R.pose(dx, W, index, count), under = cards[index + 1]; top.style.transform = `translateX(${p.x}px) rotate(${p.tilt}deg)`; under.style.transform = `scale(${0.94 + 0.06 * p.under}) translateY(${10 * (1 - p.under)}px)`; under.style.filter = `brightness(${0.6 + 0.4 * p.under})`; }
  else if (dx > 0 && index > 0) { const k = Math.min(1, dx / W), before = cards[index - 1]; before.style.visibility = 'visible'; before.style.zIndex = '3'; before.style.transform = `translateX(${-W * 1.12 * (1 - k)}px) rotate(${-7 * (1 - k)}deg)`; top.style.transform = `scale(${1 - 0.06 * k}) translateY(${10 * k}px)`; top.style.filter = `brightness(${1 - 0.4 * k})`; }
  else top.style.transform = dx ? `translateX(${R.pose(dx, W, index, count).x}px)` : ''; }
/* A card has landed on top. keepLine: the player led here, so the sentence it is on stands; otherwise the reader turned the card, and the player goes to its first sentence, so that Play starts from what you are looking at. */
function shown(i, quiet, keepLine = false) { clearTimeout(glide); glide = null; moving = false; /* a turn still gliding is overtaken by this one: it must not land afterwards and undo it */ const within = document.activeElement && document.activeElement.closest('.card'); index = i; place();
  const first = R.firstOf(list, i); if (!keepLine && list[state.i].card !== i && first >= 0) { R.seek(state, list, first); if (state.playing) speak(); }
  if (!quiet) say(`Card ${i + 1} of ${count}: ${cards[i].dataset.title}.`); paint(); if (within && within !== cards[index]) (i < count - 1 ? $('next') : $('prev')).focus({ preventScroll: true }); } /* the card that held the focus has gone: keep the keys somewhere useful */
/* Turn to the next card (by 1) or the one before (by -1), from wherever a drag has left the top card. */
function turnBy(by, from = 0, quiet = false, keepLine = false) { const to = R.turn(index, by, count); if (moving) return; const W = deck.clientWidth || 1, target = to === index ? 0 : by > 0 ? -W * 1.15 : W;
  if (less.matches || (!from && to === index)) { shown(to, quiet || to === index, keepLine); return; }
  moving = true; lay(from || -0.01 * by); void deck.offsetWidth; for (const c of cards) c.classList.add('glide'); lay(target || 0.0001 * Math.sign(from)); /* first where the cards are now, then, a moment later and gliding, where they are going */
  glide = setTimeout(() => shown(to, quiet || to === index, keepLine), 240); }
/* The player has moved to a sentence on another card: the card follows it. Anything in the way, a drag in hand or a turn still gliding, gives way. */
function follow() { const to = list[state.i].card; if (to === index && !moving) return; if (drag) { drag = null; cards[index].classList.remove('held'); } if (moving || Math.abs(to - index) !== 1) shown(to, true, true); else turnBy(to - index, 0, true, true); }

/* A finger, or the mouse, on the deck. Up and down scrolls a tall card; across turns it. A drag may start anywhere on the card, tick boxes included: a press that became a drag does not tick. */
let drag = null, swiped = false;
deck.addEventListener('pointerdown', e => { swiped = false; if (moving || !e.isPrimary || e.button > 0 || e.target.closest('button, a')) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, trail: [[e.timeStamp, e.clientX]] }; });
deck.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.on) { if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; } if (Math.abs(dx) < 8) return; drag.on = true; swiped = true; try { deck.setPointerCapture(e.pointerId); } catch (err) { /* works without */ } cards[index].classList.add('held'); getSelection()?.removeAllRanges(); }
  drag.trail.push([e.timeStamp, e.clientX]); while (drag.trail.length > 2 && e.timeStamp - drag.trail[0][0] > 90) drag.trail.shift(); lay(less.matches ? 0 : dx); e.preventDefault(); });
function letGo(e) { if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; if (!d.on) return; cards[index].classList.remove('held'); const dx = e.clientX - d.x, a = d.trail[0], b = d.trail[d.trail.length - 1], vx = b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0; turnBy(e.type === 'pointercancel' ? 0 : R.settle(dx, vx, deck.clientWidth || 1), less.matches ? 0 : dx); }
deck.addEventListener('pointerup', letGo); deck.addEventListener('pointercancel', letGo);
deck.addEventListener('click', e => { if (moving || swiped) { e.preventDefault(); e.stopPropagation(); } swiped = false; }, true);
for (const c of cards) c.addEventListener('scroll', cue, { passive: true }); new ResizeObserver(cue).observe(deck);
$('prev').addEventListener('click', () => turnBy(-1)); $('next').addEventListener('click', () => turnBy(1));
$('again').addEventListener('click', () => { R.seek(state, list, 0); if (state.playing) speak(); shown(0, false, true); });

/* ---- The voice ---- */
/* The device's own, where it has one. Each sentence is spoken on its own; when the voice has finished one, the player moves to the next.
   Voices go wrong in several ways: some never start, some never say they have finished, some say so at once. Each is caught, and the briefing is then read along in silence. The reader can switch the voice on again. */
const synth = window.briefingSynth || ('speechSynthesis' in window ? window.speechSynthesis : null), Utter = window.briefingUtterance || window.SpeechSynthesisUtterance, none = !synth || !Utter;
let voiceOn = !none, speaking = false, started = false, token = 0, manual = false, current = null, spokeAt = 0, held = 0, tooSoon = 0, stuck = 0;
const voiced = () => voiceOn && !none;
function hush() { token++; speaking = false; started = false; current = null; held = 0; if (synth) try { synth.cancel(); } catch (err) { /* nothing to stop */ } }
function fail(why) { voiceOn = false; tooSoon = 0; stuck = 0; hush(); say(`${why} The briefing is read along in silence. Press Voice to try again.`); paint(); }
function speak() { hush(); if (!voiced() || !state.playing) return; state.t = 0; const mine = token, line = list[state.i], u = new Utter(line.text); current = u; /* kept hold of: a browser may forget a voice nobody is holding, and then it never says it has finished */ u.lang = 'en-GB'; u.rate = state.rate;
  try { const v = synth.getVoices().filter(x => /^en/i.test(x.lang)).sort((a, b) => (/GB/i.test(b.lang) ? 1 : 0) - (/GB/i.test(a.lang) ? 1 : 0))[0]; if (v) u.voice = v; } catch (err) { /* the default voice will do */ }
  u.onstart = () => { if (mine === token) { started = true; spokeAt = performance.now(); } };
  u.onend = () => { if (mine !== token) return; const took = (performance.now() - spokeAt) / 1000, est = line.dur / state.rate; speaking = false; current = null;
    if (!started || took < Math.min(0.25, est * 0.2)) { if (++tooSoon >= 2) fail('The voice here ends each sentence the moment it starts.'); return; } /* too quick to have been said: the clock carries this sentence, and a second such ending switches the voice off */
    tooSoon = 0; stuck = 0; if (state.playing) happened(R.finish(state, list)); };
  u.onerror = ev => { if (mine !== token) return; if (ev.error !== 'interrupted' && ev.error !== 'canceled') fail('The voice stopped with an error.'); };
  speaking = true; /* wait for the voice: the player holds at the end of the sentence and does not run ahead */
  try { synth.speak(u); } catch (err) { fail('The voice could not be started.'); return; }
  setTimeout(() => { if (mine === token && !started && state.playing) fail('The voice did not start.'); }, 4000); }

/* ---- The player ---- */
function happened(seen) { follow(); if (seen.includes('line')) speak(); if (seen.includes('end')) { hush(); say('The end of the briefing.'); } paint(); }
function step(dt) { if (!state.playing) return; const was = state.i, waiting = voiced() && speaking;
  if (waiting) { held += dt; if (held > 3 * list[state.i].dur / state.rate + 2) { speaking = false; if (++stuck >= 2) { fail('The voice stopped saying when it had finished.'); return; } happened(R.finish(state, list)); return; } } /* a voice that never says it has finished is not waited for for ever */
  const seen = R.advance(state, list, dt, waiting); if (seen.length) happened(seen); else if (state.i !== was) paint(); else progress(); }
let last = null; function frame(now) { const dt = last === null ? 0 : Math.min(0.25, (now - last) / 1000); last = now; if (!manual) step(dt); requestAnimationFrame(frame); } requestAnimationFrame(frame);
function toggle() { if (state.ended) { R.seek(state, list, 0); shown(0, true, true); } begun = true; state.playing = !state.playing; if (state.playing) { speak(); say(voiced() ? '' : 'Reading along in silence.'); } else { hush(); say('Paused.'); } paint(); }
const fmt = r => `${r}×`;
/* Switch a button off or on. One that is switched off while it holds the focus passes the focus on, so that the keys are never left on nothing. */
const off = (b, is, next) => { if (is && document.activeElement === b) next.focus({ preventScroll: true }); b.disabled = is; };
function progress() { const at = R.position(state, list), l = list[state.i], engaged = begun && !state.ended; $('t-at').textContent = R.clock(at.at); $('t-of').textContent = R.clock(at.of);
  [...$('segs').children].forEach((seg, i) => { seg.classList.toggle('past', i < index || (i === index && !engaged)); seg.firstChild.style.width = i === index && engaged ? `${Math.min(100, ((l.n - 1 + Math.min(1, state.t / l.dur)) / l.of) * 100)}%` : ''; }); }
function paint() { const l = list[state.i], engaged = begun && !state.ended, title = cards[l.card].dataset.title;
  $('count').textContent = `${index + 1} of ${count} · ${cards[index].dataset.title}`; off($('prev'), index === 0, $('next')); off($('next'), index === count - 1, $('prev'));
  $('play').dataset.on = String(state.playing); $('play').setAttribute('aria-label', state.playing ? 'Pause' : state.ended ? 'Read the briefing again from the start' : begun ? 'Carry on reading' : 'Read the briefing aloud');
  off($('sback'), state.i === 0 && state.t <= 1.5, $('play')); off($('son'), state.i === list.length - 1, $('play'));
  $('rate').textContent = fmt(state.rate); $('rate').setAttribute('aria-label', `Speed ${fmt(state.rate)}: ${R.sayRate(state.rate).toLowerCase()}. Press to change.`);
  $('voice').textContent = none ? 'No voice' : 'Voice'; $('voice').disabled = none; $('voice').setAttribute('aria-pressed', String(voiced()));
  $('scrub').max = String(list.length - 1); $('scrub').value = String(state.i); $('scrub').setAttribute('aria-valuetext', `Card ${l.card + 1} of ${count}, ${title}: sentence ${l.n} of ${l.of}`);
  $('now').textContent = state.playing ? `${voiced() ? 'Reading aloud' : 'Reading along in silence'}: ${title}` : state.ended ? 'The end.' : begun ? `Paused at ${title}, sentence ${l.n} of ${l.of}.` : index === 0 ? `About ${R.minutes(R.total(list) / state.rate)} to hear.` : 'Play starts from this card.';
  deck.classList.toggle('reading', engaged); for (const x of list) { x.el.classList.toggle('now', engaged && x === l); x.el.classList.toggle('done', engaged && x.card === l.card && x.n < l.n); }
  if (engaged && l.card === index && !moving) { const card = cards[index], a = l.el.getBoundingClientRect(), b = card.getBoundingClientRect(); if (a.bottom > b.bottom - 12) card.scrollTop += a.bottom - b.bottom + 24; else if (a.top < b.top + 12) card.scrollTop -= b.top - a.top + 24; cue(); } /* keep the sentence being read in sight on a tall card */
  progress(); }
const moved = () => { follow(); if (state.playing) speak(); paint(); };
$('play').addEventListener('click', toggle);
$('sback').addEventListener('click', () => { R.back(state, list); moved(); }); $('son').addEventListener('click', () => { R.on(state, list); moved(); });
$('rate').addEventListener('click', () => { state.rate = R.nextRate(state.rate); if (state.playing) speak(); paint(); say(`${R.sayRate(state.rate)}.`); });
$('voice').addEventListener('click', () => { if (none) return; voiceOn = !voiceOn; if (state.playing) { if (voiceOn) speak(); else hush(); } paint(); say(voiceOn ? 'Voice on.' : 'Voice off: reading along in silence.'); });
$('scrub').addEventListener('input', e => { R.seek(state, list, +e.target.value); moved(); });
/* Keys. The arrows and Space work anywhere on the page. The comma and the full stop, being ordinary characters, work only while the briefing itself has the focus, so that they cannot get in the way of someone who types or speaks to their device. */
addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target, field = t.matches && t.matches('input, button, a, summary'), inside = $('phone').contains(t);
  if (e.key === 'ArrowRight' && !(t.matches && t.matches('input'))) { turnBy(1); e.preventDefault(); } else if (e.key === 'ArrowLeft' && !(t.matches && t.matches('input'))) { turnBy(-1); e.preventDefault(); }
  else if (e.key === ' ' && !field) { toggle(); e.preventDefault(); } else if (e.key === ',' && inside) { if (!$('sback').disabled) { R.back(state, list); moved(); } } else if (e.key === '.' && inside) { if (!$('son').disabled) { R.on(state, list); moved(); } } });
addEventListener('pagehide', hush);

/* ---- Go ---- */
shown(0, true);
window.briefing = { /* for the checks in tools/ */
  state: () => ({ index, i: state.i, t: state.t, playing: state.playing, rate: state.rate, ended: state.ended, voice: voiced(), speaking, started, none, begun, moving, count, lines: list.length, total: R.total(list) }),
  lines: () => list.map(l => ({ text: l.text, card: l.card, n: l.n, of: l.of, dur: l.dur, start: l.start })),
  manual(on) { manual = on; }, tick(dt) { step(dt); }, /* take the clock out of the page's hands, and move it by hand */
};
