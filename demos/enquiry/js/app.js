// Start a project: the page. flow.js holds the rules; this file shows one step at a time, says what is wrong with an answer, and shows what would be sent. Nothing is sent, and nothing is stored.
import * as F from './flow.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const form = $('enquiry'), sections = F.STEPS.map(s => $(s.id)), say = text => { $('live').textContent = text; };
document.body.classList.replace('js-off', 'js-on');

let step = 0, sent = false;
/* The answers, read from the form as it stands. */
const read = () => { const fd = new FormData(form); return F.tidy({ needs: fd.getAll('needs'), other: fd.get('other'), about: fd.get('about'), link: fd.get('link'), when: fd.get('when') || '', budget: fd.get('budget') || '', name: fd.get('name'), email: fd.get('email'), reply: fd.get('reply') || 'email', phone: fd.get('phone'), agree: fd.get('agree') === 'on' }); };

/* ---- The steps along the top ---- */
$('steps').replaceChildren(...F.STEPS.map((s, i) => el('li', {}, `${i + 1}`, el('b', { textContent: s.short }))));
/* Questions that are asked only after a certain answer. */
const asked = () => { $('w-other').hidden = !form.querySelector('input[name="needs"][value="other"]').checked; $('w-phone').hidden = form.querySelector('input[name="reply"]:checked')?.value !== 'phone'; };
form.addEventListener('change', asked);
$('about').addEventListener('input', () => { $('count').textContent = F.count($('about').value); });

/* ---- What is wrong, said twice: in a list at the top of the step, and beside the question ---- */
/* Each kind of answer has a place for its message and something to mark and go to. */
const where = field => { const group = $('f-' + field); return group ? { box: group, err: $('e-' + field), first: group.querySelector('input'), inputs: [] } : { box: $(field).closest('.field'), err: $('e-' + field), first: $(field), inputs: [$(field)] }; };
function clearErrors() { $('errors').hidden = true; $('errors').querySelector('ul').replaceChildren(); for (const e of form.querySelectorAll('.err')) { e.hidden = true; e.textContent = ''; } for (const b of form.querySelectorAll('.bad')) b.classList.remove('bad'); for (const i of form.querySelectorAll('[aria-invalid]')) { i.removeAttribute('aria-invalid'); i.setAttribute('aria-describedby', (i.getAttribute('aria-describedby') || '').split(' ').filter(x => x && !x.startsWith('e-')).join(' ')); if (!i.getAttribute('aria-describedby')) i.removeAttribute('aria-describedby'); } for (const f of form.querySelectorAll('fieldset[aria-describedby]')) { const d = f.getAttribute('aria-describedby').split(' ').filter(x => !x.startsWith('e-')).join(' '); if (d) f.setAttribute('aria-describedby', d); else f.removeAttribute('aria-describedby'); } }
function showErrors(list) { clearErrors(); const ul = $('errors').querySelector('ul');
  for (const { field, message } of list) { const w = where(field); w.err.replaceChildren(el('span', { className: 'sr', textContent: 'Error: ' }), message); w.err.hidden = false; w.box.classList.add('bad');
    const tell = n => n.setAttribute('aria-describedby', [...new Set([...(n.getAttribute('aria-describedby') || '').split(' ').filter(Boolean), w.err.id])].join(' ')); for (const i of w.inputs) { i.setAttribute('aria-invalid', 'true'); tell(i); } if (!w.inputs.length) tell(w.box);
    ul.append(el('li', {}, el('a', { href: '#' + w.first.id, textContent: message, onclick: e => { e.preventDefault(); w.first.focus(); w.box.scrollIntoView({ block: 'center' }); } }))); }
  $('errors').hidden = false; document.title = `Error: ${F.STEPS[step].title} · Start a project`; $('errors').focus(); }
/* A group's first choice needs an id for the list of problems to point at. */
for (const g of form.querySelectorAll('fieldset[id^="f-"]')) { const first = g.querySelector('input'); if (!first.id) first.id = g.id.replace('f-', '') + '-first'; }

/* ---- One step at a time ---- */
function show(i, opts = {}) { step = i; clearErrors(); asked(); sections.forEach((s, k) => { s.hidden = k !== i; });
  [...$('steps').children].forEach((li, k) => { li.classList.toggle('done', k < i); if (k === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
  $('back').hidden = i === 0; $('next').textContent = i === F.STEPS.length - 1 ? 'Send enquiry' : 'Continue'; document.title = `${F.STEPS[i].title} · Start a project`;
  if (F.STEPS[i].id === 'check') answers();
  if (opts.push && location.hash !== '#' + F.STEPS[i].id) history.pushState(null, '', '#' + F.STEPS[i].id); if (!opts.quiet) { sections[i].querySelector('h2').focus({ preventScroll: true }); const top = $('steps').getBoundingClientRect().top; if (top < 0 || top > innerHeight * 0.6) scrollTo(0, Math.max(0, scrollY + top - 16)); } } /* the heading takes the focus, so that a screen reader says where you now are and Tab starts at the first question */
/* The answers so far, each part with a link back to its step. */
function answers() { const data = read(); $('answers').replaceChildren(...F.answers(data).map(part => { const s = F.STEPS[F.stepOf(part.step)]; return el('div', { className: 'part' }, el('dl', {}, ...part.rows.flatMap(([q, a]) => [el('dt', { textContent: q }), el('dd', { textContent: a })])), el('a', { href: '#' + part.step, textContent: 'Change', ariaLabel: `Change: ${s.title}` })); })); }
/* Continue, or Send on the last step. */
form.addEventListener('submit', e => { e.preventDefault(); const data = read(), errs = F.check(F.STEPS[step].id, data); if (errs.length) { showErrors(errs); return; }
  if (step < F.STEPS.length - 1) { show(step + 1, { push: true }); return; } if (!F.ready(data)) { show(F.furthest(data), { push: true }); return; } finish(data); });
$('back').addEventListener('click', () => show(step - 1, { push: true }));
/* The address says which step is shown, so that the browser's Back and a Change link both work. A step past an unfinished one cannot be reached by its address. */
function fromAddress(quiet) { if (sent) return; const want = F.stepOf(location.hash.slice(1)), can = Math.min(want, F.furthest(read())); show(can, { quiet }); if (can !== want) history.replaceState(null, '', '#' + F.STEPS[can].id); }
addEventListener('hashchange', () => fromAddress(false));

/* ---- The end: what would have been sent ---- */
function finish(data) { sent = true; form.hidden = true; $('steps').hidden = true; $('letter').textContent = F.letter(data); $('sent').hidden = false; document.title = 'Nothing was sent · Start a project'; history.replaceState(null, '', location.pathname); $('sent').querySelector('h2').focus({ preventScroll: true }); $('sent').closest('.card').scrollIntoView({ block: 'nearest' }); say('Nothing was sent. The text of the enquiry is shown.'); }
$('copy').addEventListener('click', async () => { const b = $('copy'); try { await navigator.clipboard.writeText($('letter').textContent); b.textContent = 'Copied'; say('The text is copied.'); } catch (err) { const r = document.createRange(); r.selectNodeContents($('letter')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; say('Copying was not allowed. The text is selected: copy it with your keyboard.'); } setTimeout(() => { b.textContent = 'Copy the text'; }, 2000); });
$('again').addEventListener('click', () => { sent = false; form.reset(); $('count').textContent = F.count(''); form.hidden = false; $('steps').hidden = false; $('sent').hidden = true; show(0, { push: true }); say('The form is empty again.'); });

fromAddress(true);
window.enquiry = { state: () => ({ step, id: F.STEPS[step].id, sent, data: read() }) }; /* for the checks in tools/ */
