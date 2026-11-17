// The handbook page: one page shown at a time, search, code samples you can copy, a light and a dark page, and a list of what is on the page.
// All the words are in index.html. With scripts off, the whole handbook shows as one long page and every link still works.
import { buildIndex, search, colour } from './search.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const articles = [...document.querySelectorAll('main article')], say = text => { $('live').textContent = text; };
document.body.classList.remove('js-off');

/* ---- The pages, read from the page itself ---- */
const pages = articles.map(a => ({ id: a.id, title: a.dataset.page, sections: [{ id: a.id, heading: a.dataset.page, text: '' }] }));
/* Each section is a heading and everything up to the next heading. The words before the first heading belong to the page itself. */
for (const [i, a] of articles.entries()) { const page = pages[i], intro = []; let current = null; for (const n of a.children) { if (n.tagName === 'H2') { current = { id: n.id, heading: n.textContent.trim(), text: '' }; page.sections.push(current); } else if (n.tagName !== 'H1' && !n.classList.contains('eyebrow') && !n.classList.contains('pager')) { const t = n.textContent.replace(/\s+/g, ' ').trim(); if (current) current.text += (current.text ? ' ' : '') + t; else intro.push(t); } } page.sections[0].text = intro.join(' '); }
const index = buildIndex(pages);

/* ---- One page at a time ---- */
let shown = null;
function pageOf(hash) { const id = decodeURIComponent((hash || '').replace(/^#/, '')), target = id ? document.getElementById(id) : null, a = target?.closest('article'); return a ? { article: a, target: target === a ? null : target } : { article: articles[0], target: null }; }
function go(hash, opts = {}) { const { article, target } = pageOf(hash), changed = article !== shown; shown = article; for (const a of articles) a.hidden = a !== article;
  for (const link of document.querySelectorAll('#side a')) { if (link.getAttribute('href') === '#' + article.id) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  document.title = article === articles[0] ? 'Rooms OS handbook' : `${article.dataset.page} · Rooms OS handbook`; contents(article); closeMenu();
  if (target) target.scrollIntoView({ block: 'start' }); else if (changed || !opts.quiet) scrollTo(0, 0);
  if (!opts.quiet) { const to = target || article.querySelector('h1'); to.tabIndex = -1; to.focus({ preventScroll: true }); say(`${article.dataset.page}${target ? ': ' + target.textContent.trim() : ''}.`); } } /* following a link always takes the focus to where it leads, on this page or another, so that Tab carries on from there */
addEventListener('hashchange', () => go(location.hash));
/* Previous and next, at the foot of each page. */
articles.forEach((a, i) => { const prev = articles[i - 1], next = articles[i + 1], nav = el('nav', { className: 'pager', ariaLabel: 'Previous and next page' }); if (prev) nav.append(el('a', { href: '#' + prev.id, className: 'prev' }, el('small', { textContent: 'Before' }), prev.dataset.page)); if (next) nav.append(el('a', { href: '#' + next.id, className: 'next' }, el('small', { textContent: 'Next' }), next.dataset.page)); a.append(nav); });

/* ---- What is on this page, and where you are in it ---- */
let heads = [];
function mark() { const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) + 30; let cur = heads[0]; for (const h of heads) if (h.getBoundingClientRect().top <= top) cur = h; if (heads.length && innerHeight + scrollY >= document.documentElement.scrollHeight - 2) cur = heads[heads.length - 1]; /* at the very foot, the last heading is the one being read */
  for (const a of $('toc-list').querySelectorAll('a')) { if (cur && a.getAttribute('href') === '#' + cur.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); } }
function contents(article) { heads = [...article.querySelectorAll('h2')]; $('toc').hidden = heads.length === 0; $('toc-list').replaceChildren(...heads.map(h => el('li', {}, el('a', { href: '#' + h.id, textContent: h.textContent.trim() })))); mark(); }
let due = false; addEventListener('scroll', () => { if (!due) { due = true; requestAnimationFrame(() => { due = false; mark(); }); } }, { passive: true });

/* ---- Search ---- */
const q = $('q'), box = $('results'); let found = [], at = -1;
function results() { const text = q.value.trim(); found = text ? search(index, text) : []; at = found.length ? 0 : -1; box.hidden = !text; q.setAttribute('aria-expanded', String(!!text));
  box.replaceChildren(...(found.length ? found.map((r, i) => el('li', { id: 'r' + i, role: 'option', onmousedown: e => { e.preventDefault(); open(i); } }, el('span', { className: 'where' }, r.heading, ...(r.heading === r.pageTitle ? [] : [' ', el('small', { textContent: 'in ' + r.pageTitle })])), el('span', { className: 'bit' }, ...r.snippet.map(p => (p.hit ? el('mark', { textContent: p.text }) : p.text))))) : text ? [el('li', { className: 'none', role: 'option', ariaDisabled: 'true', textContent: `Nothing in the handbook matches “${text}”.` })] : []));
  pick(); if (text) say(found.length ? `${found.length} ${found.length === 1 ? 'result' : 'results'}.` : 'No results.'); }
function pick() { [...box.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === at))); if (at >= 0) { q.setAttribute('aria-activedescendant', 'r' + at); box.children[at].scrollIntoView({ block: 'nearest' }); } else q.removeAttribute('aria-activedescendant'); }
function open(i) { const r = found[i]; if (!r) return; q.value = ''; results(); location.hash = '#' + r.id; if (location.hash === '#' + r.id) go(location.hash); const t = document.getElementById(r.id); const to = t.tagName === 'ARTICLE' ? t.querySelector('h1') : t; to.tabIndex = -1; to.focus({ preventScroll: true }); }
q.addEventListener('input', results);
q.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && found.length) { at = (at + 1) % found.length; pick(); e.preventDefault(); } else if (e.key === 'ArrowUp' && found.length) { at = (at - 1 + found.length) % found.length; pick(); e.preventDefault(); } else if (e.key === 'Enter' && at >= 0) { open(at); e.preventDefault(); } else if (e.key === 'Escape') { if (q.value) { q.value = ''; results(); e.preventDefault(); } else q.blur(); } });
q.addEventListener('blur', () => { box.hidden = true; q.setAttribute('aria-expanded', 'false'); }); q.addEventListener('focus', () => { if (q.value.trim()) { box.hidden = false; q.setAttribute('aria-expanded', 'true'); } });
addEventListener('keydown', e => { if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { q.focus(); e.preventDefault(); } });
q.disabled = false; q.placeholder = 'Search the handbook ( / )';

/* ---- Code samples: coloured, with a button to copy them ---- */
for (const code of document.querySelectorAll('.code pre code')) { const text = code.textContent, lang = code.dataset.lang || '', wrap = code.closest('.code'); code.replaceChildren(...colour(text, lang).map(p => (p.kind ? el('span', { className: 't-' + p.kind, textContent: p.text }) : p.text)));
  code.parentElement.tabIndex = 0; code.parentElement.setAttribute('role', 'region'); code.parentElement.setAttribute('aria-label', `Code sample${lang ? ', ' + lang : ''}`); if (lang) wrap.append(el('span', { className: 'lang', textContent: lang, ariaHidden: 'true' }));
  const b = el('button', { className: 'copy', type: 'button', textContent: 'Copy' }); b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; say('Code copied.'); } catch (err) { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; say('Copying was not allowed. The code is selected: copy it with your keyboard.'); } setTimeout(() => { b.textContent = 'Copy'; }, 1800); }); wrap.append(b); }

/* ---- Light and dark: follows your device until you choose, and is not remembered ---- */
const root = document.documentElement, theme = $('theme'), dark = matchMedia('(prefers-color-scheme: dark)');
const now = () => root.dataset.theme || (dark.matches ? 'dark' : 'light'), label = () => { theme.textContent = now() === 'dark' ? 'Light' : 'Dark'; theme.setAttribute('aria-label', now() === 'dark' ? 'Switch to the light page' : 'Switch to the dark page'); document.querySelector('meta[name="theme-color"]').content = now() === 'dark' ? '#111315' : '#f7f8f6'; };
theme.hidden = false; theme.addEventListener('click', () => { root.dataset.theme = now() === 'dark' ? 'light' : 'dark'; label(); say(`${now() === 'dark' ? 'Dark' : 'Light'} page.`); }); dark.addEventListener('change', label); label();

/* ---- The list of pages, as a drawer on a small screen ---- */
const side = $('side'), menu = $('menu'), narrow = matchMedia('(max-width: 760px)');
function closeMenu() { side.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); if (narrow.matches) side.inert = true; else side.inert = false; }
menu.addEventListener('click', () => { const open = !side.classList.contains('open'); side.classList.toggle('open', open); side.inert = !open; menu.setAttribute('aria-expanded', String(open)); if (open) side.querySelector('a[aria-current="page"], a').focus(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && side.classList.contains('open')) { closeMenu(); menu.focus(); } }); narrow.addEventListener('change', closeMenu);
document.addEventListener('click', e => { if (side.classList.contains('open') && !side.contains(e.target) && e.target !== menu) closeMenu(); });

go(location.hash, { quiet: true });
window.handbook = { pages, index, search: text => search(index, text), shown: () => shown.id, theme: now }; /* for the checks in tools/ */
