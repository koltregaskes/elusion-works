// The long read: the page. read.js does the arithmetic; this file folds the article into its short read, puts the notes beside the words, follows the reader down the page, and works the controls.
// All the words are in index.html. With scripts off the article reads from top to bottom with its notes at the end.
import * as R from './read.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const root = document.documentElement, story = $('story'), body = $('words'), mast = $('mast');
let spoke = false; const say = text => { spoke = !spoke; $('live').textContent = text + (spoke ? ' ' : ''); }; /* the same words said twice are still announced the second time */
document.body.classList.replace('js-off', 'js-on');

/* ---- The short read: each paragraph's first sentence is marked off from the rest ---- */
/* The sentence is cut where it ends. A link or emphasis inside it goes with it whole; anything after it goes with the rest. */
function fold(p) { const first = R.firstSentence(p.textContent), lead = el('span', { className: 'lead' }), rest = el('span', { className: 'rest' }); let room = first.length + (p.textContent.match(/^\s*/) || [''])[0].length; /* paragraphs are written on one line with single spaces, so the sentence's length is its length in the page */
  for (const n of [...p.childNodes]) { const len = n.textContent.length; if (room <= 0) rest.append(n); else if (n.nodeType === 3 && len > room) { const tail = n.splitText(room); room = 0; lead.append(n); rest.append(tail); } else { room -= len; lead.append(n); } }
  p.append(lead, rest); return { lead, rest }; }
const paras = [...body.querySelectorAll('section > p')], heads = [...body.querySelectorAll('h2')];
for (const p of paras) fold(p);
const titles = heads.map(h => h.querySelector('.t').textContent.trim());
const count = texts => texts.reduce((n, t) => n + R.words(t), 0), fullWords = count([...paras.map(p => p.textContent), ...titles, ...[...body.querySelectorAll('.keys li')].map(l => l.textContent)]), shortWords = count([...paras.map(p => p.querySelector('.lead').textContent), ...titles]);
const mins = R.minutes(fullWords), shortMins = R.minutes(shortWords);
$('mins').textContent = `About ${R.sayMinutes(mins)}`;

/* ---- The strip at the top ---- */
/* On a wide screen it stays in sight, and what a link goes to must stop clear of it: its real height is measured, whatever the text size. On a narrow screen it scrolls away with the page and only the line of progress stays. */
const narrow = matchMedia('(max-width: 44em)');
const measure = () => root.style.setProperty('--top', narrow.matches ? '0.75rem' : `${Math.ceil(mast.getBoundingClientRect().height)}px`);
new ResizeObserver(measure).observe(mast); narrow.addEventListener('change', measure); measure();
const clear = () => (narrow.matches ? 12 : mast.getBoundingClientRect().height); /* how far down the window the words start */

/* ---- Notes: beside the paragraph on a wide screen, opened under it on a narrow one ---- */
const wide = matchMedia('(min-width: 69em)'), notes = [];
for (const ref of body.querySelectorAll('.ref')) { const k = ref.textContent.trim(), src = $('n' + k).cloneNode(true); src.querySelector('a[href^="#r"]')?.remove(); const p = ref.closest('p'), wrap = el('div', { className: 'has-note' }), shut = el('button', { className: 'shut', type: 'button' }), note = el('aside', { className: 'note', id: 'note-' + k, tabIndex: -1 }, el('b', { textContent: `Note ${k}` }), el('span', { textContent: src.textContent.trim() }), ' ', shut); note.setAttribute('role', 'note');
  p.replaceWith(wrap); wrap.append(p, note); ref.setAttribute('aria-controls', note.id); ref.setAttribute('href', '#' + note.id); const n = { k, ref, note, shut, open: false }; notes.push(n);
  const back = () => { if (!wide.matches) { n.open = false; lay(); } ref.focus({ preventScroll: wide.matches }); };
  ref.addEventListener('click', e => { e.preventDefault(); if (!wide.matches) { n.open = !n.open; lay(); } if (wide.matches || n.open) note.focus({ preventScroll: !wide.matches }); });
  shut.addEventListener('click', back); note.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); back(); } }); ref.addEventListener('keydown', e => { if (e.key === 'Escape' && n.open && !wide.matches) { e.preventDefault(); back(); } else if (e.key === ' ') { e.preventDefault(); ref.click(); } }); }
/* Wide: every note is out, the number is a plain link to it, and notes close together are moved down so that none lies over another. Narrow: a note is shut until its number is pressed, and the number says which. */
function lay() { let floor = -Infinity; for (const n of notes) { const open = wide.matches || n.open; if (!open && n.note.contains(document.activeElement)) n.ref.focus({ preventScroll: true }); n.note.hidden = !open; n.shut.textContent = wide.matches ? 'Back to the text' : 'Close note';
    if (wide.matches) { n.ref.removeAttribute('aria-expanded'); n.ref.removeAttribute('role'); n.note.style.marginTop = ''; const r = n.note.getBoundingClientRect(), top = r.top + scrollY; if (top < floor) n.note.style.marginTop = `${Math.ceil(floor - top)}px`; floor = Math.max(top, floor) + r.height + 14; } else { n.ref.setAttribute('role', 'button'); n.ref.setAttribute('aria-expanded', String(open)); n.note.style.marginTop = ''; } } }
wide.addEventListener('change', lay); new ResizeObserver(() => { if (wide.matches) lay(); }).observe(body); lay();
/* A link to a note at the end of the article, where the notes are when scripts are off, goes to the note beside the words. */
function toNote() { const m = /^#n(\d+)$/.exec(location.hash), n = m && notes.find(x => x.k === m[1]); if (!n) return; if (!wide.matches) { n.open = true; lay(); } n.note.scrollIntoView({ block: 'center' }); n.note.focus({ preventScroll: true }); }
addEventListener('hashchange', toNote);

/* ---- Following the reader: how much is read, how long is left, which part they are in ---- */
let short = false, kept = null;
const links = [...document.querySelectorAll('#toc a')], state = { share: 0, at: -1 };
function follow() { const r = body.getBoundingClientRect(), share = R.readShare(scrollY, r.top + scrollY, r.height, innerHeight, root.scrollHeight - innerHeight), total = short ? shortMins : mins, at = R.current(heads.map(h => h.getBoundingClientRect().top + scrollY), scrollY, innerHeight, clear());
  $('progress').firstChild.style.width = `${(share * 100).toFixed(1)}%`; $('progress').setAttribute('aria-valuenow', String(Math.round(share * 100))); const words = R.sayLeft(share, total, scrollY <= 0); $('progress').setAttribute('aria-valuetext', words); $('left').textContent = words;
  links.forEach((a, i) => { if (i === at) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }); state.share = share; state.at = at; }
let due = false; const soon = () => { if (!due) { due = true; requestAnimationFrame(() => { due = false; follow(); }); } };
addEventListener('scroll', soon, { passive: true }); addEventListener('resize', soon); new ResizeObserver(soon).observe(body);
/* A link to a part takes the focus there too, so that Tab carries on from that part. */
for (const a of links) a.addEventListener('click', () => { const h = $(a.getAttribute('href').slice(1)); requestAnimationFrame(() => h.focus({ preventScroll: true })); });

/* ---- The reader's controls. None of them is remembered: nothing is stored. ---- */
function setShort(on, quiet) { const top = clear(), near = heads.find(h => { const t = h.getBoundingClientRect().top; return t >= top - 4 && t < innerHeight * 0.35; }), here = kept && Math.abs(scrollY - kept.y) < 4 ? kept.h : near || (state.at >= 0 ? heads[state.at] : null); /* your place is the heading at the top of the window if there is one, otherwise the part you are reading. If you have not moved since the article was last folded or unfolded, it is the place you had then: a folded article can be too short to scroll that part to the top */
  short = on; story.classList.toggle('short', short); $('short').setAttribute('aria-pressed', String(short)); $('mins').textContent = `About ${R.sayMinutes(short ? shortMins : mins)}`;
  if (here) here.scrollIntoView({ block: 'start' }); else scrollTo(0, Math.min(scrollY, story.offsetTop)); kept = here ? { h: here, y: scrollY } : null; lay(); follow();
  if (!quiet) say(short ? `Short read: the first sentence of each of ${paras.length} paragraphs. About ${R.sayMinutes(shortMins)}.` : `The whole article. About ${R.sayMinutes(mins)}.`); }
$('short').addEventListener('click', () => setShort(!short));
/* On paper the article is always whole. */
let folded = false; addEventListener('beforeprint', () => { folded = short; if (short) setShort(false, true); }); addEventListener('afterprint', () => { if (folded) setShort(true, true); folded = false; });
let size = 1; const sized = () => { root.style.setProperty('--scale', String(size)); $('smaller').disabled = size === R.SIZES[0]; $('larger').disabled = size === R.SIZES[R.SIZES.length - 1]; soon(); };
$('smaller').addEventListener('click', () => { size = R.step(size, -1); sized(); say(`Text at ${Math.round(size * 100)} per cent.`); if ($('smaller').disabled) $('larger').focus(); }); $('larger').addEventListener('click', () => { size = R.step(size, 1); sized(); say(`Text at ${Math.round(size * 100)} per cent.`); if ($('larger').disabled) $('smaller').focus(); }); sized();
$('look').addEventListener('click', () => { const paper = root.dataset.look !== 'paper'; if (paper) root.dataset.look = 'paper'; else delete root.dataset.look; $('look').setAttribute('aria-pressed', String(paper)); document.querySelector('meta[name="theme-color"]').content = paper ? '#f5f2ea' : '#111315'; say(paper ? 'Paper look: dark words on a pale page.' : 'Night look: pale words on a dark page.'); });
/* Each part's heading has a button beside it that copies a link to the part. It sits after the heading, not inside it, so that the heading's name is its words and nothing more. */
heads.forEach((h, i) => { const b = el('button', { className: 'link', type: 'button', textContent: 'Copy link' }), name = () => b.setAttribute('aria-label', `${b.textContent} to “${titles[i]}”`); name(); h.after(b);
  b.addEventListener('click', async () => { const url = `${location.origin}${location.pathname}#${h.id}`; try { await navigator.clipboard.writeText(url); b.textContent = 'Copied link'; say('Link copied.'); } catch (err) { history.replaceState(null, '', '#' + h.id); b.textContent = 'Link is now this page’s address'; say('Copying was not allowed. This page’s address is now the link to this part: copy or share it from your browser.'); } b.classList.add('said'); name(); setTimeout(() => { b.textContent = 'Copy link'; b.classList.remove('said'); name(); }, 2600); }); });

follow(); if (document.readyState === 'complete') toNote(); else addEventListener('load', () => setTimeout(toNote, 60)); /* after the page has finished loading: before that the browser is still dealing with the address itself, and takes the focus back */
window.longRead = { /* for the checks in tools/ */
  state: () => ({ share: state.share, at: state.at, short, size, look: root.dataset.look || 'night', words: fullWords, shortWords, mins, shortMins, paras: paras.length, clear: clear(), notes: notes.map(n => ({ open: !n.note.hidden, wide: wide.matches })) }),
  leads: () => paras.map(p => p.querySelector('.lead').textContent), rests: () => paras.map(p => p.querySelector('.rest').textContent), fold,
};
