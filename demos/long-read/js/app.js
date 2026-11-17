// The long read: the page. read.js does the arithmetic; this file folds the article into its short read, puts the notes beside the words, follows the reader down the page, and works the controls.
// All the words are in index.html. With scripts off the article reads from top to bottom with its notes at the end.
import * as R from './read.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const root = document.documentElement, story = $('story'), body = $('words'), say = text => { $('live').textContent = text; };
document.body.classList.replace('js-off', 'js-on');

/* ---- The short read: each paragraph's first sentence is marked off from the rest ---- */
const paras = [...body.querySelectorAll('section > p')], heads = [...body.querySelectorAll('h2')];
for (const p of paras) { const first = R.firstSentence(p.textContent), lead = el('span', { className: 'lead' }), rest = el('span', { className: 'rest' }); let room = first.length;
  for (const n of [...p.childNodes]) { if (room > 0 && n.nodeType === 3) { if (n.data.length <= room) { room -= n.data.length; lead.append(n); } else { const tail = n.splitText(room); room = 0; lead.append(n); rest.append(tail); } } else rest.append(n); } /* the sentence is cut where it ends, inside whatever piece of text holds its last letter; links and notes that come later go with the rest */
  p.append(lead, rest); }
const titles = heads.map(h => [...h.childNodes].filter(n => n.nodeType === 3).map(n => n.data).join('').trim());
const count = texts => texts.reduce((n, t) => n + R.words(t), 0), fullWords = count([...paras.map(p => p.textContent), ...titles, ...[...body.querySelectorAll('.keys li')].map(l => l.textContent)]), shortWords = count([...paras.map(p => p.querySelector('.lead').textContent), ...titles]);
const mins = R.minutes(fullWords), shortMins = R.minutes(shortWords);
$('mins').textContent = `About ${R.sayMinutes(mins)}`;

/* ---- Notes: beside the paragraph on a wide screen, opened under it on a narrow one ---- */
const wide = matchMedia('(min-width: 1100px)'), notes = [];
for (const ref of body.querySelectorAll('.ref')) { const k = ref.textContent.trim(), src = $('n' + k).cloneNode(true); src.querySelector('a[href^="#r"]')?.remove(); const p = ref.closest('p'), wrap = el('div', { className: 'has-note' }), note = el('aside', { className: 'note', id: 'note-' + k, tabIndex: -1 }, el('b', { textContent: `Note ${k}` }), src.textContent.trim()); note.setAttribute('role', 'note'); note.setAttribute('aria-label', `Note ${k}`);
  p.replaceWith(wrap); wrap.append(p, note); ref.setAttribute('role', 'button'); ref.setAttribute('aria-controls', note.id); ref.removeAttribute('href'); ref.tabIndex = 0; notes.push({ ref, note, open: false });
  const press = () => { const n = notes.find(x => x.ref === ref); if (wide.matches) { note.focus({ preventScroll: false }); return; } n.open = !n.open; lay(); if (n.open) note.focus({ preventScroll: true }); say(n.open ? '' : `Note ${k} closed.`); };
  ref.addEventListener('click', e => { e.preventDefault(); press(); }); ref.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); press(); } }); }
function lay() { for (const n of notes) { const open = wide.matches || n.open; n.note.hidden = !open; n.ref.setAttribute('aria-expanded', String(open)); } }
wide.addEventListener('change', lay); lay();

/* ---- Following the reader: how much is read, how long is left, which part they are in ---- */
let short = false, kept = null;
const links = [...document.querySelectorAll('#toc a')];
function follow() { const r = body.getBoundingClientRect(), share = R.readShare(scrollY, r.top + scrollY, r.height, innerHeight, root.scrollHeight - innerHeight), total = short ? shortMins : mins, at = R.current(heads.map(h => h.getBoundingClientRect().top + scrollY), scrollY, innerHeight);
  $('progress').firstChild.style.width = `${(share * 100).toFixed(1)}%`; $('progress').setAttribute('aria-valuenow', String(Math.round(share * 100))); $('left').textContent = R.sayLeft(share, total);
  links.forEach((a, i) => { if (i === at) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }); state.share = share; state.at = at; }
const state = { share: 0, at: -1 };
let due = false; const soon = () => { if (!due) { due = true; requestAnimationFrame(() => { due = false; follow(); }); } };
addEventListener('scroll', soon, { passive: true }); addEventListener('resize', soon); new ResizeObserver(soon).observe(body);
/* A link to a part takes the focus there too, so that Tab carries on from that part. */
for (const a of links) a.addEventListener('click', () => { const h = $(a.getAttribute('href').slice(1)); requestAnimationFrame(() => h.focus({ preventScroll: true })); });

/* ---- The reader's controls. None of them is remembered: nothing is stored. ---- */
$('short').addEventListener('click', () => { const strip = $('mast').getBoundingClientRect().bottom, near = heads.find(h => { const t = h.getBoundingClientRect().top; return t >= strip - 4 && t < innerHeight * 0.35; }), here = kept && Math.abs(scrollY - kept.y) < 4 ? kept.h : near || (state.at >= 0 ? heads[state.at] : null); /* your place is the heading at the top of the window if there is one, otherwise the part you are reading. If you have not moved since the article was last folded or unfolded, it is the place you had then: a folded article can be too short to scroll that part to the top */ short = !short; story.classList.toggle('short', short); $('short').setAttribute('aria-pressed', String(short)); $('mins').textContent = `About ${R.sayMinutes(short ? shortMins : mins)}`;
  if (here) here.scrollIntoView({ block: 'start' }); else scrollTo(0, Math.min(scrollY, story.offsetTop)); /* the article has just changed length: stay in the part you were in */ kept = here ? { h: here, y: scrollY } : null; follow();
  say(short ? `Short read: the first sentence of each of ${paras.length} paragraphs. About ${R.sayMinutes(shortMins)}.` : `The whole article. About ${R.sayMinutes(mins)}.`); });
let size = 1; const sized = () => { root.style.setProperty('--scale', String(size)); $('smaller').disabled = size === R.SIZES[0]; $('larger').disabled = size === R.SIZES[R.SIZES.length - 1]; soon(); };
$('smaller').addEventListener('click', () => { size = R.step(size, -1); sized(); say(`Text at ${Math.round(size * 100)} per cent.`); if ($('smaller').disabled) $('larger').focus(); }); $('larger').addEventListener('click', () => { size = R.step(size, 1); sized(); say(`Text at ${Math.round(size * 100)} per cent.`); if ($('larger').disabled) $('smaller').focus(); }); sized();
$('look').addEventListener('click', () => { const paper = root.dataset.look !== 'paper'; if (paper) root.dataset.look = 'paper'; else delete root.dataset.look; $('look').setAttribute('aria-pressed', String(paper)); document.querySelector('meta[name="theme-color"]').content = paper ? '#f5f2ea' : '#111315'; say(paper ? 'Paper look: dark words on a pale page.' : 'Night look: pale words on a dark page.'); });
/* Each part's heading has a button that copies a link to it. */
heads.forEach((h, i) => { const b = el('button', { className: 'link', type: 'button', textContent: 'Copy link' }), name = () => b.setAttribute('aria-label', `${b.textContent} to “${titles[i]}”`); name(); h.append(b);
  b.addEventListener('click', async () => { const url = `${location.origin}${location.pathname}#${h.id}`; try { await navigator.clipboard.writeText(url); b.textContent = 'Copied link'; say('Link copied.'); } catch (err) { history.replaceState(null, '', '#' + h.id); b.textContent = 'Link is in the address bar'; say('Copying was not allowed. The link to this part is now in the address bar.'); } b.classList.add('said'); name(); setTimeout(() => { b.textContent = 'Copy link'; b.classList.remove('said'); name(); }, 2200); }); });

follow();
window.longRead = { /* for the checks in tools/ */
  state: () => ({ share: state.share, at: state.at, short, size, look: root.dataset.look || 'night', words: fullWords, shortWords, mins, shortMins, paras: paras.length, notes: notes.map(n => ({ open: !n.note.hidden, wide: wide.matches })) }),
  leads: () => paras.map(p => p.querySelector('.lead').textContent), rests: () => paras.map(p => p.querySelector('.rest').textContent),
};
