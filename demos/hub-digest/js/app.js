// The weekly digest: the preview page. email.js makes and checks the email; this page shows the finished file as a desktop and a phone would, shows its plain text, and runs the checks again, here, on the file as served.
import { lint, bytes, TAGS } from './email.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
document.body.classList.replace('js-off', 'js-on');
const frame = $('mail'), stage = $('stage'), WIDE = { desktop: 600, phone: 375, text: 600 };
let look = 'desktop', mail = null, results = [];

/* ---- The email in its frame: as tall as its words, at the width chosen ---- */
/* What is said under the frame is what is true of it: the width it is really shown at, and that a frame of a phone's width is not a phone. */
function told() { const w = frame.clientWidth, asked = WIDE[look]; return look === 'text' ? `${mail ? mail.text.split('\n').length : 0} lines of plain text.` : w < asked ? `Shown ${w} px wide: this window is too narrow to show it at ${asked}.` : look === 'phone' ? 'Shown 375 px wide, about the width of a phone. A phone\u2019s own email program adds its margins, and may change the colours.' : 'Shown 600 px wide, the widest the email goes.'; }
function fit() { const doc = frame.contentDocument; if (!doc || !doc.body) return; frame.style.height = '0px'; frame.style.height = `${doc.documentElement.scrollHeight}px`; $('size').textContent = told(); }
/* A link pressed in the preview does nothing but say where it would go: the preview stays as it is, and nothing is fetched. */
function tame() { const doc = frame.contentDocument; if (!doc) return; doc.addEventListener('click', e => { const a = e.target.closest ? e.target.closest('a') : null; if (!a) return; e.preventDefault(); const href = a.getAttribute('href'); $('size').textContent = Object.values(TAGS).includes(href) ? `That link is left for the sending service to fill in: ${href}` : `Links do nothing in this preview. That one goes to ${href}`; }); }
frame.addEventListener('load', () => { tame(); fit(); }); addEventListener('resize', fit); if (frame.contentDocument && frame.contentDocument.readyState === 'complete') tame();
function show(next) { look = next; stage.dataset.look = next; frame.title = `The email, ${WIDE[next]} wide`; for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', b.dataset.look === next); fit(); }
for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => show(b.dataset.look));

/* ---- The checks, run again here on the email as it is served ---- */
/* The email itself is read from email.html.txt, which the website serves untouched. email.html, shown in the frame, is the same email as a page: the website adds lines of its own to every page it serves, and those must not be copied into an email. */
async function check() { try { const [h, t] = await Promise.all(['email.html.txt', 'email.txt'].map(f => fetch(f, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.text(); }))), doc = new DOMParser().parseFromString(h, 'text/html');
    mail = { html: h, text: t, subject: doc.title, preheader: doc.body.firstElementChild.textContent.replace(/[͏‌ \s]+$/, '') }; results = lint(mail);
    $('checks').replaceChildren(...results.map(c => el('li', { className: c.ok ? 'ok' : 'bad' }, el('span', { className: 'mark', ariaHidden: 'true', textContent: c.ok ? '✓' : '!' }), el('span', { className: 'what' }, el('b', { textContent: c.name }), el('span', { className: 'sr', textContent: c.ok ? ' (passes)' : ' (fails)' }), el('span', { className: 'detail', textContent: c.detail })))));
    document.querySelector('.inbox .subj').textContent = mail.subject; document.querySelector('.inbox .pre').textContent = mail.preheader; $('plain').textContent = t;
    const failed = results.filter(c => !c.ok).length; $('ran').textContent = failed ? `Run just now in this browser on the email file: ${failed} of ${results.length} fail.` : `Run just now in this browser on the email file: all ${results.length} pass.`; }
  catch (err) { $('ran').textContent = 'The checks could not be run again here, because the email file could not be read. Those shown were run when the email was made.'; } fit(); }

/* ---- Copy ---- */
async function copy(button, what, words) { if (!mail) { $('said').textContent = 'The email file has not been read yet.'; return; } const was = button.textContent;
  try { await navigator.clipboard.writeText(what()); button.textContent = 'Copied'; $('said').textContent = `${words} is copied: ${(bytes(what()) / 1024).toFixed(1)} KB.`; }
  catch (err) { $('said').textContent = `Copying was not allowed. Use the link below, "${words === 'The HTML' ? 'The email’s HTML, exactly as made' : 'The plain text on its own'}", and copy it there.`; } setTimeout(() => { button.textContent = was; }, 2000); }
$('copy-html').addEventListener('click', e => copy(e.currentTarget, () => mail.html, 'The HTML')); $('copy-text').addEventListener('click', e => copy(e.currentTarget, () => mail.text, 'The plain text'));

show('desktop'); const ready = check();
window.digest = { ready, state: () => ({ look, width: frame.clientWidth, height: frame.clientHeight, results: results.map(c => ({ ...c })), mail: mail ? { subject: mail.subject, preheader: mail.preheader, bytes: bytes(mail.html) } : null }) }; /* for the checks in tools/ */
