// Start a project: the page. flow.js holds the rules; this file shows one step at a time, says what is wrong with an answer, and shows what would be sent. Nothing is sent, and the page keeps nothing.
import * as F from './flow.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const form = $('enquiry'), card = form.closest('.card'), sections = F.STEPS.map(s => $(s.id)), LAST = F.STEPS.length - 1, say = text => { $('live').textContent = text; };
document.body.classList.replace('js-off', 'js-on'); $('next').disabled = false; /* until this script runs the button is off, so that the form cannot be submitted to anywhere */

let step = 0, sent = false, returning = false, shownFor = [];
/* The answers, read from the form as it stands. */
const read = () => { const fd = new FormData(form); return F.tidy({ needs: fd.getAll('needs'), other: fd.get('other'), about: fd.get('about'), link: fd.get('link'), when: fd.get('when') || '', budget: fd.get('budget') || '', name: fd.get('name'), email: fd.get('email'), reply: fd.get('reply') || 'email', phone: fd.get('phone'), agree: fd.get('agree') === 'on' }); };
const titleNow = () => (sent ? 'Nothing was sent' : F.STEPS[step].title) + ' · Start a project';

/* ---- The steps: where you are, what is done, and the answer each finished step holds ---- */
const marks = F.STEPS.map((s, i) => { const name = el('b', { textContent: s.short }), mark = el('span', { className: 'mark', ariaHidden: 'true' }), state = el('span', { className: 'sr' }), got = el('span', { className: 'got' }); name.dataset.n = `Step ${i + 1} of ${F.STEPS.length}: `; /* shown before the name on a narrow screen, where only the step you are on is named */ return { li: el('li', {}, mark, el('span', { className: 'lbl' }, name, state, got)), mark, state, got }; });
$('steps').replaceChildren(...marks.map(m => m.li));
function paintSteps() { const data = read(), far = F.furthest(data), parts = F.answers(data);
  marks.forEach((m, i) => { const done = sent || (i < far && i !== step), here = !sent && i === step; m.li.classList.toggle('done', done); if (here) m.li.setAttribute('aria-current', 'step'); else m.li.removeAttribute('aria-current');
    m.mark.textContent = done ? '\u2713' : String(i + 1); m.state.textContent = done ? ' (done)' : ''; m.got.textContent = done && parts[i] ? parts[i].rows.map(r => r[1]).filter(a => a !== 'None given').join(' · ') : ''; }); }
/* Questions that are asked only after a certain answer. */
const asked = () => { const other = form.querySelector('input[name="needs"][value="other"]').checked, phone = form.querySelector('input[name="reply"]:checked')?.value === 'phone'; $('w-other').hidden = !other; $('other').required = other; $('w-phone').hidden = !phone; $('phone').required = phone; };
/* The count under the big box: as you type, and said aloud once you pause. */
let pause = 0; const count = aloud => { const text = F.count($('about').value); $('count').textContent = text; clearTimeout(pause); if (aloud) pause = setTimeout(() => say(text), 1200); };

/* ---- What is wrong, said twice: in a list at the top of the step, and in a caption beside the question ---- */
/* Each kind of answer has a place for its message, something to mark as wrong, and something to go to. A group of choices is told about its message as a group; a box, or the one tick box, itself. */
const where = field => { const group = field === 'agree' ? null : $('f-' + field); if (group) return { box: group, err: $('e-' + field), first: group.querySelector('input'), mark: [], tell: [group] }; const input = $(field); return { box: input.closest('.field, fieldset'), err: $('e-' + field), first: input, mark: [input], tell: [input] }; };
const describe = (n, id, on) => { const ids = (n.getAttribute('aria-describedby') || '').split(' ').filter(x => x && x !== id); if (on) ids.unshift(id); /* the message comes first, before any hint */ if (ids.length) n.setAttribute('aria-describedby', ids.join(' ')); else n.removeAttribute('aria-describedby'); };
function clearErrors() { for (const field of shownFor) { const w = where(field); w.err.hidden = true; w.err.textContent = ''; w.box.classList.remove('bad'); for (const n of w.mark) n.removeAttribute('aria-invalid'); for (const n of w.tell) describe(n, w.err.id, false); } shownFor = []; $('errors').hidden = true; $('errors').querySelector('ul').replaceChildren(); }
function showErrors(list, focus = true) { clearErrors(); if (!list.length) { document.title = titleNow(); return; } const ul = $('errors').querySelector('ul');
  for (const { field, message } of list) { const w = where(field); w.err.replaceChildren(el('span', { className: 'sr', textContent: 'Error: ' }), message); w.err.hidden = false; w.box.classList.add('bad'); for (const n of w.mark) n.setAttribute('aria-invalid', 'true'); for (const n of w.tell) describe(n, w.err.id, true);
    ul.append(el('li', {}, el('a', { href: '#' + w.first.id, textContent: message, onclick: e => { e.preventDefault(); w.first.focus(); w.box.scrollIntoView({ block: 'center' }); } }))); }
  shownFor = list.map(e => e.field); $('errors').hidden = false; document.title = `Error: ${F.STEPS[step].title} · Start a project`; if (focus) $('errors').focus(); }
/* A group's first choice needs an id for the list of problems to point at. */
for (const g of form.querySelectorAll('fieldset[id^="f-"]')) { const first = g.querySelector('input'); if (!first.id) first.id = g.id.replace('f-', '') + '-first'; }
/* As answers change: the questions asked, the steps beside the form, and any problem that has been put right goes from the list. Nothing new is added until Continue is pressed. */
function settle() { asked(); paintSteps(); if (!shownFor.length) return; const still = F.check(F.STEPS[step].id, read()).filter(e => shownFor.includes(e.field)), was = [...$('errors').querySelectorAll('li a')].map(a => a.textContent); if (still.length !== was.length || still.some((e, i) => e.message !== was[i])) { const inList = $('errors').contains(document.activeElement); showErrors(still, false); if (inList) (still.length ? $('errors') : sections[step].querySelector('h2')).focus(); } }
form.addEventListener('change', settle); form.addEventListener('input', e => { if (e.target.id === 'about') count(true); settle(); });
/* The made-up details the page offers, put in the boxes by one press: the phone number too, if a reply by phone is asked for. */
$('madeup').addEventListener('click', () => { $('name').value = F.MADE_UP.name; $('email').value = F.MADE_UP.email; if (!$('w-phone').hidden) $('phone').value = F.MADE_UP.phone; settle(); say('Made-up details are filled in.'); });
/* Enter on a tick box or a choice is not Continue. */
form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[type="checkbox"], input[type="radio"]')) e.preventDefault(); });

/* ---- One step at a time ---- */
function show(i, opts = {}) { const from = step; step = i; if (i === LAST) returning = false; clearErrors(); asked(); sections.forEach((s, k) => { s.hidden = k !== i; }); if (i === LAST) answers(); paintSteps();
  $('back').hidden = i === 0; $('next').textContent = i === LAST ? 'Send enquiry' : returning ? 'Back to your answers' : 'Continue'; document.title = titleNow();
  const at = '#' + F.STEPS[i].id; if (opts.push && location.hash !== at) history.pushState({ from }, '', at); if (opts.replace) history.replaceState(null, '', at); if (opts.quiet) return;
  sections[i].querySelector('h2').focus({ preventScroll: true }); /* the heading takes the focus, so that a screen reader says where you now are and Tab starts at the first question */
  intoView(); }
/* What has just changed starts in sight. On a narrow screen the row of steps sits above the form, and comes into view with it. */
function intoView() { const s = $('steps').getBoundingClientRect(), c = card.getBoundingClientRect(), top = s.bottom <= c.top + 1 ? s.top : c.top; if (top < 0 || top > innerHeight * 0.6) scrollTo(0, Math.max(0, scrollY + top - 16)); }
/* The answers so far, each part with a link back to its step. After a change you come straight back here. */
function answers() { const data = read(); $('answers').replaceChildren(...F.answers(data).map(part => { const s = F.STEPS[F.stepOf(part.step)]; return el('div', { className: 'part' }, el('dl', {}, ...part.rows.flatMap(([q, a]) => [el('dt', { textContent: q }), el('dd', { textContent: a })])), el('a', { href: '#' + part.step, textContent: 'Change', ariaLabel: `Change: ${s.title}`, onclick: () => { returning = true; } })); })); }
/* Continue, or Send on the last step. */
form.addEventListener('submit', e => { e.preventDefault(); const data = read(), errs = F.check(F.STEPS[step].id, data); if (errs.length) { showErrors(errs); return; }
  if (step < LAST) { show(returning ? Math.max(step + 1, F.furthest(data)) : step + 1, { push: true }); return; } if (!F.ready(data)) { show(F.furthest(data), { push: true }); return; } finish(data, true); });
/* The page's Back goes where the browser's Back would, when that is the step before; otherwise it puts the step before in this one's place. */
$('back').addEventListener('click', () => { if (history.state && history.state.from === step - 1) history.back(); else show(step - 1, { replace: true }); });
/* The address says what is shown, so that the browser's Back and Forward work. A step past an unfinished one cannot be reached by its address: you are put at the unfinished one and told what it needs. */
function fromAddress(quiet) { const id = location.hash.slice(1), data = read(); if (id === 'sent' && F.ready(data)) { finish(data, false, quiet); return; } if (sent) { sent = false; form.hidden = false; $('sent').hidden = true; }
  const known = F.STEPS.some(s => s.id === id), want = known ? F.stepOf(id) : id === 'sent' ? LAST : 0, can = Math.min(want, F.furthest(data)); show(can, { quiet }); if (id && (!known || can !== want)) history.replaceState(history.state, '', '#' + F.STEPS[can].id); if (known && can !== want && !quiet) showErrors(F.check(F.STEPS[can].id, data)); }
addEventListener('hashchange', () => fromAddress(false));

/* ---- The end: what would have been sent ---- */
function finish(data, push, quiet) { const from = step; sent = true; form.hidden = true; $('letter').textContent = F.letter(data); $('sent').hidden = false; paintSteps(); document.title = titleNow(); if (push) history.pushState({ from }, '', '#sent'); if (quiet) return; $('sent').querySelector('h2').focus({ preventScroll: true }); intoView(); say('Nothing was sent. The text of the enquiry is shown.'); }
$('copy').addEventListener('click', async () => { const b = $('copy'); try { await navigator.clipboard.writeText($('letter').textContent); b.textContent = 'Copied'; say('The text is copied.'); } catch (err) { const r = document.createRange(); r.selectNodeContents($('letter')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; say('Copying was not allowed. The text is selected: copy it with your keyboard.'); } setTimeout(() => { b.textContent = 'Copy the text'; }, 2000); });
$('again').addEventListener('click', () => { sent = false; returning = false; form.reset(); count(false); form.hidden = false; $('sent').hidden = true; show(0, { push: true }); say('The form is empty again.'); });

fromAddress(true);
/* Coming back to the page, the browser may put old answers back in the boxes after this script has run: the count, the questions asked and the step shown are made to agree with them. */
addEventListener('pageshow', () => { count(false); fromAddress(true); });
window.enquiry = { state: () => ({ step, id: sent ? 'sent' : F.STEPS[step].id, sent, returning, data: read() }) }; /* for the checks in tools/ */
