// The handbook page: one page shown at a time, search, code samples you can copy, a light and a dark look, and a list of what is on the page.
// All the words are in index.html. With scripts off, the whole handbook shows as one long page and every link still works.
import { buildIndex, search, colour } from './search.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const articles = [...document.querySelectorAll('main article')], say = text => { $('live').textContent = text; };
document.body.classList.remove('js-off');
/* The demo notice under the bar is one line, but larger text can make it two: what is gone to stops clear of it either way. */
const note = $('demo-note'), fit = () => document.documentElement.style.setProperty('--strip', note.offsetHeight + 'px'); fit(); if (window.ResizeObserver) new ResizeObserver(fit).observe(note);

/* ---- The pages, read from the page itself ---- */
const pages = articles.map(a => ({ id: a.id, title: a.dataset.page, sections: [{ id: a.id, heading: a.dataset.page, text: '', code: '' }] }));
/* Each section is a heading and everything up to the next heading. The words before the first heading belong to the page itself. Code samples are kept apart from the prose: they can be found, but a result's snippet is always prose. */
for (const [i, a] of articles.entries()) { const page = pages[i]; let current = page.sections[0]; for (const n of a.children) { if (n.tagName === 'H2') { current = { id: n.id, heading: n.textContent.trim(), text: '', code: '' }; page.sections.push(current); } else if (n.classList.contains('code')) { const c = n.querySelector('code'); current.code += ` ${c.dataset.lang || ''} ${c.textContent}`; } else if (n.tagName !== 'H1' && !n.classList.contains('eyebrow') && !n.classList.contains('pager')) { const t = n.textContent.replace(/\s+/g, ' ').trim(); current.text += (current.text ? ' ' : '') + t; } } }
const index = buildIndex(pages);

/* ---- One page at a time ---- */
let shown = null, pin = null, pinUntil = 0, restore = null;
function pageOf(hash) { let id = ''; try { id = decodeURIComponent((hash || '').replace(/^#/, '')); } catch (err) { id = ''; } /* an address that cannot be read is treated as no address */
  const target = id ? document.getElementById(id) : null, a = target?.closest('article'); if (a) return { article: a, target: target === a ? null : target };
  if (target && shown) return { article: shown, target: null }; /* a link to something that is not in any page, such as "Skip to the page": stay on this page */ return { article: articles[0], target: null }; }
/* The pages not shown are hidden in the way a browser's own Find can still look inside, where the browser knows how. */
function show(article) { for (const a of articles) { if (a === article) a.removeAttribute('hidden'); else a.setAttribute('hidden', 'until-found'); } }
function go(hash, opts = {}) { const { article, target } = pageOf(hash), changed = article !== shown; shown = article; show(article);
  for (const link of document.querySelectorAll('#side a')) { if (link.getAttribute('href') === '#' + article.id) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  document.title = article === articles[0] ? 'Rooms OS handbook' : `${article.dataset.page} · Rooms OS handbook`; contents(article); closeMenu();
  pin = target && target.tagName === 'H2' ? target : null; pinUntil = performance.now() + 600; /* the part just gone to is the part marked in the contents, until the reader scrolls */
  if (restore !== null) { scrollTo(0, restore); restore = null; } else if (opts.keep) { /* the browser is about to scroll to what it found */ } else if (target) target.scrollIntoView({ block: 'start' }); else if (changed || !opts.quiet) scrollTo(0, 0);
  mark(); if (!opts.quiet) { const to = target || article.querySelector('h1'); to.tabIndex = -1; to.focus({ preventScroll: true }); } } /* following a link always takes the focus to where it leads, on this page or another, so that Tab carries on from there. The heading focused is what a screen reader then reads: nothing more is announced */
addEventListener('hashchange', () => go(location.hash));
/* Back and Forward return to where the reader was on the page, not to its top. */
addEventListener('popstate', e => { restore = e.state && typeof e.state.y === 'number' ? e.state.y : null; });
let saving = null; const keepPlace = () => { clearTimeout(saving); saving = setTimeout(() => { try { history.replaceState({ y: Math.round(scrollY) }, ''); } catch (err) { /* not allowed here: Back goes to the top */ } }, 120); };
/* A link to where the address already points changes nothing, so the browser does nothing. Do it by hand: the current page's own link goes to its top, a second press of "Skip to the page" skips again. */
document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href^="#"]'); if (a && !e.defaultPrevented && a.getAttribute('href') === location.hash) { e.preventDefault(); go(location.hash); } });
/* Previous and next, at the foot of each page. */
articles.forEach((a, i) => { const prev = articles[i - 1], next = articles[i + 1], nav = el('nav', { className: 'pager', ariaLabel: 'Previous and next page' }); if (prev) nav.append(el('a', { href: '#' + prev.id, className: 'prev' }, el('small', { textContent: 'Previous' }), prev.dataset.page)); if (next) nav.append(el('a', { href: '#' + next.id, className: 'next' }, el('small', { textContent: 'Next' }), next.dataset.page)); a.append(nav);
  a.addEventListener('beforematch', () => { let aim = null; try { aim = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (err) { aim = null; } if (aim && a.contains(aim)) { show(a); return; } /* a link is being followed into this page: the address is already right, and its own handler does the rest. The other pages are hidden now, not then, so that two pages never show at once in the moment between */ if (a !== shown) { try { history.replaceState(null, '', '#' + a.id); } catch (err) { /* the address stays as it was */ } go('#' + a.id, { quiet: true, keep: true }); } }); }); /* the browser's Find has found something on a page not shown: show that page */

/* ---- What is on this page, and where you are in it ---- */
let heads = [];
function mark() { const top = $('demo-note').getBoundingClientRect().bottom + 30; /* the foot of the bar and the demo notice under it */ let cur = heads[0]; for (const h of heads) if (h.getBoundingClientRect().top <= top) cur = h; if (heads.length && innerHeight + scrollY >= document.documentElement.scrollHeight - 2) cur = heads[heads.length - 1]; /* at the very foot, the last heading is the one being read */
  if (pin && heads.includes(pin)) cur = pin; for (const a of $('toc-list').querySelectorAll('a')) { if (cur && a.getAttribute('href') === '#' + cur.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); } }
function contents(article) { heads = [...article.querySelectorAll('h2')]; $('toc').hidden = heads.length === 0; $('toc-list').replaceChildren(...heads.map(h => el('li', {}, el('a', { href: '#' + h.id, textContent: h.textContent.trim() })))); }
let due = false; addEventListener('scroll', () => { if (performance.now() > pinUntil) pin = null; keepPlace(); if (!due) { due = true; requestAnimationFrame(() => { due = false; mark(); }); } }, { passive: true });

/* ---- Search ---- */
const q = $('q'), box = $('results'); let found = [], at = -1;
function results() { const text = q.value.trim(); found = text ? search(index, text) : []; at = found.length ? 0 : -1; box.hidden = !text; q.setAttribute('aria-expanded', String(!!text)); const more = found.more || 0;
  box.replaceChildren(...(found.length ? [...found.map((r, i) => el('li', { id: 'r' + i, role: 'option', onmousedown: e => { e.preventDefault(); open(i); } }, el('span', { className: 'where' }, r.heading, ...(r.heading === r.pageTitle ? [] : [' ', el('small', { textContent: 'in ' + r.pageTitle })])), el('span', { className: 'bit' }, ...r.snippet.map(p => (p.hit ? el('mark', { textContent: p.text }) : p.text))))), ...(more ? [el('li', { className: 'none', role: 'option', ariaDisabled: 'true', textContent: `And ${more} more. Add a word to narrow it down.` })] : [])] : text ? [el('li', { className: 'none', role: 'option', ariaDisabled: 'true', textContent: `Nothing in the handbook matches “${text}”.` })] : []));
  pick(); if (text) say(found.length ? `${found.length} ${found.length === 1 ? 'result' : 'results'}${more ? `, and ${more} more not shown` : ''}.` : 'No results.'); }
function pick() { [...box.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === at))); if (at >= 0) { q.setAttribute('aria-activedescendant', 'r' + at); box.children[at].scrollIntoView({ block: 'nearest' }); } else q.removeAttribute('aria-activedescendant'); }
function open(i) { const r = found[i]; if (!r) return; q.value = ''; results(); if (location.hash === '#' + r.id) go(location.hash); else location.hash = '#' + r.id; const t = document.getElementById(r.id), to = t.tagName === 'ARTICLE' ? t.querySelector('h1') : t; to.tabIndex = -1; to.focus({ preventScroll: true }); }
q.addEventListener('input', results);
q.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && found.length) { at = (at + 1) % found.length; pick(); e.preventDefault(); } else if (e.key === 'ArrowUp' && found.length) { at = (at - 1 + found.length) % found.length; pick(); e.preventDefault(); } else if (e.key === 'Enter' && at >= 0) { open(at); e.preventDefault(); } else if (e.key === 'Escape') { if (q.value) { q.value = ''; results(); e.preventDefault(); } else q.blur(); } });
q.addEventListener('blur', () => { box.hidden = true; q.setAttribute('aria-expanded', 'false'); }); q.addEventListener('focus', () => { if (q.value.trim()) { box.hidden = false; q.setAttribute('aria-expanded', 'true'); } });
/* Control K, or Command K, goes to the search box. A single letter or sign would get in the way of anyone who speaks to their computer or types by voice. */
addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { q.focus(); q.select(); e.preventDefault(); } });
q.disabled = false; q.placeholder = 'Search (Ctrl K)';

/* ---- Code samples: coloured, with a button to copy them ---- */
for (const code of document.querySelectorAll('.code pre code')) { const text = code.textContent, lang = code.dataset.lang || '', wrap = code.closest('.code'), what = wrap.dataset.what || 'a sample'; code.replaceChildren(...colour(text, lang).map(p => (p.kind ? el('span', { className: 't-' + p.kind, textContent: p.text }) : p.text)));
  if (lang) wrap.append(el('span', { className: 'lang', textContent: lang, ariaHidden: 'true' }));
  const b = el('button', { className: 'copy', type: 'button', textContent: 'Copy' }), name = () => b.setAttribute('aria-label', `${b.textContent} the code: ${what}`); name(); /* seven buttons that all say Copy are told apart by what they copy */
  b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; say('Code copied.'); } catch (err) { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; say('Copying was not allowed. The code is selected: copy it with your keyboard.'); } name(); setTimeout(() => { b.textContent = 'Copy'; name(); }, 1800); }); wrap.append(b); }

/* ---- Light and dark: follows your device until you choose, and is not remembered ---- */
const root = document.documentElement, theme = $('theme'), dark = matchMedia('(prefers-color-scheme: dark)');
const now = () => root.dataset.theme || (dark.matches ? 'dark' : 'light'), label = () => { theme.textContent = now() === 'dark' ? 'Light' : 'Dark'; theme.setAttribute('aria-label', now() === 'dark' ? 'Light: switch to the light look' : 'Dark: switch to the dark look'); document.querySelector('meta[name="theme-color"]').content = now() === 'dark' ? '#111315' : '#f7f8f6'; };
theme.hidden = false; theme.addEventListener('click', () => { root.dataset.theme = now() === 'dark' ? 'light' : 'dark'; label(); say(`${now() === 'dark' ? 'Dark' : 'Light'} look.`); }); dark.addEventListener('change', label); label();

/* ---- The list of pages, as a drawer on a small screen ---- */
const side = $('side'), menu = $('menu'), narrow = matchMedia('(max-width: 760px)');
function closeMenu() { side.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); side.inert = narrow.matches; }
menu.addEventListener('click', () => { const open = !side.classList.contains('open'); side.classList.toggle('open', open); side.inert = !open; menu.setAttribute('aria-expanded', String(open)); if (open) (side.querySelector('a[aria-current="page"]') || side.querySelector('a')).focus(); }); /* opened, the drawer starts at the page you are on */
addEventListener('keydown', e => { if (e.key === 'Escape' && side.classList.contains('open')) { closeMenu(); menu.focus(); } }); narrow.addEventListener('change', closeMenu);
document.addEventListener('click', e => { if (side.classList.contains('open') && !side.contains(e.target) && e.target !== menu) closeMenu(); });
side.addEventListener('focusout', e => { if (side.classList.contains('open') && e.relatedTarget && !side.contains(e.relatedTarget) && e.relatedTarget !== menu) closeMenu(); }); /* Tab past the last page shuts the drawer: the keys are never on the page behind an open drawer */

go(location.hash, { quiet: true });
window.handbook = { pages, index, search: text => { const r = search(index, text); return Object.assign([...r], { more: r.more }); }, more: text => search(index, text).more, shown: () => shown.id, theme: now }; /* for the checks in tools/ */
