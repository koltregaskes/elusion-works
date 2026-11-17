// The weekly digest: the preview page. email.js makes and checks the email; this page shows the finished file as a desktop and a phone would, shows its plain text, and runs the checks again, here, on the file as served.
import { lint, bytes } from './email.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
document.body.classList.replace('js-off', 'js-on');
const frame = $('mail'), stage = $('stage'), LOOKS = { desktop: 'as a desktop shows it', phone: 'as a phone shows it', text: 'as plain text' };
let look = 'desktop', mail = null, results = [];

/* ---- The email in its frame: as tall as its words, at the width chosen ---- */
function fit() { const doc = frame.contentDocument; if (!doc || !doc.body) return; frame.style.height = '0px'; frame.style.height = `${doc.documentElement.scrollHeight}px`; $('size').textContent = look === 'text' ? `${mail ? mail.text.split('\n').length : 0} lines of plain text.` : `Shown ${frame.clientWidth} px wide, ${LOOKS[look]}.`; }
frame.addEventListener('load', fit); addEventListener('resize', fit);
function show(next) { look = next; stage.dataset.look = next; frame.title = `The email, ${LOOKS[next === 'text' ? 'desktop' : next]}`; for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', b.dataset.look === next); fit(); }
for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => show(b.dataset.look));

/* ---- The checks, run again here on the file as it is served ---- */
async function check() { try { const [h, t] = await Promise.all(['email.html', 'email.txt'].map(f => fetch(f, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.text(); }))), doc = new DOMParser().parseFromString(h, 'text/html');
    mail = { html: h, text: t, subject: doc.title, preheader: doc.body.firstElementChild.textContent.replace(/[͏‌ \s]+$/, '') }; results = lint(mail);
    $('checks').replaceChildren(...results.map(c => el('li', { className: c.ok ? 'ok' : 'bad' }, el('span', { className: 'mark', ariaHidden: 'true', textContent: c.ok ? '✓' : '!' }), el('span', { className: 'what' }, el('b', { textContent: c.name }), el('span', { className: 'sr', textContent: c.ok ? ' (passes)' : ' (fails)' }), el('span', { className: 'detail', textContent: c.detail })))));
    document.querySelector('.inbox .subj').textContent = mail.subject; document.querySelector('.inbox .pre').textContent = mail.preheader; $('plain').textContent = t;
    const failed = results.filter(c => !c.ok).length; $('ran').textContent = failed ? `Run just now in this browser on the email file: ${failed} of ${results.length} fail.` : `Run just now in this browser on the email file: all ${results.length} pass.`; }
  catch (err) { $('ran').textContent = 'The checks could not be run again here, because the email file could not be read. Those shown were run when the email was made.'; } fit(); }

/* ---- Copy ---- */
async function copy(button, what, words) { if (!mail) { $('said').textContent = 'The email file has not been read yet.'; return; } const was = button.textContent;
  try { await navigator.clipboard.writeText(what()); button.textContent = 'Copied'; $('said').textContent = `${words} is copied: ${(bytes(what()) / 1024).toFixed(1)} KB.`; }
  catch (err) { $('said').textContent = `Copying was not allowed. Open ${words.toLowerCase()} on its own with the link below, and copy it there.`; } setTimeout(() => { button.textContent = was; }, 2000); }
$('copy-html').addEventListener('click', e => copy(e.currentTarget, () => mail.html, 'The HTML')); $('copy-text').addEventListener('click', e => copy(e.currentTarget, () => mail.text, 'The plain text'));

show('desktop'); const ready = check();
window.digest = { ready, state: () => ({ look, width: frame.clientWidth, height: frame.clientHeight, results: results.map(c => ({ ...c })), mail: mail ? { subject: mail.subject, preheader: mail.preheader, bytes: bytes(mail.html) } : null }) }; /* for the checks in tools/ */
