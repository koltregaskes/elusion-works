// Print sale: the page. shop.js holds the rules and the sums, art.js draws the stand-in pictures; this file shows the prints, hangs one on a wall to scale, and keeps a basket. Nothing is bought, sent or stored.
import * as F from './shop.js';
import { draw, SHEET } from './art.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const say = text => { $('live').textContent = text; };
const TITLE = document.title, VIEWS = ['prints', 'print', 'basket', 'done'];
document.body.classList.replace('js-off', 'js-on');

let basket = [], view = 'prints', shown = null, choice = { size: 'a4', frame: 'none', qty: 1, look: 'wall' }, lastOrder = '', undo = null; const kept = new Map(); /* the size and frame last chosen for each print, so that coming back to one finds it as it was left */

/* ---- The six prints: each reference becomes a link to its print ---- */
for (const li of document.querySelectorAll('#grid li')) { const id = li.dataset.print, h = li.querySelector('.ref'), what = li.querySelector('.what'); what.id = 'what-' + id; h.replaceChildren(el('a', { href: '#' + id, textContent: h.textContent })); h.firstChild.setAttribute('aria-describedby', what.id); }

/* ---- A print in its frame, and on the wall. Everything is drawn in centimetres. ---- */
const WOOD = { black: '#1b1b1b', oak: '#b98a55', white: '#f6f4ef' }, WALL = { w: 250, h: 225, floor: 205, chair: 85, at: 172 }; /* a wall 2.5 m wide; the picture hangs beside the armchair */
const sheetAt = (print, s, x, y) => `<svg x="${x}" y="${y}" width="${s.w}" height="${s.h}" viewBox="0 0 ${SHEET.w} ${SHEET.h}">${draw(print)}</svg>`;
function hung(print, size, frame, x, y) { const s = F.sizeOf(size), o = F.outside(size, frame), m = F.FRAME.moulding, c = F.FRAME.mount; let out = `<rect x="${x + 0.9}" y="${y + 1.5}" width="${o.w}" height="${o.h}" fill="#000" opacity=".24"/>`;
  if (frame !== 'none') out += `<rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="${WOOD[frame]}" stroke="rgba(0,0,0,.35)" stroke-width=".25"/><rect x="${x + m}" y="${y + m}" width="${o.w - 2 * m}" height="${o.h - 2 * m}" fill="#fbf9f4" stroke="rgba(0,0,0,.4)" stroke-width=".3"/>` + sheetAt(print, s, x + m + c, y + m + c) + `<rect x="${x + m + c}" y="${y + m + c}" width="${s.w}" height="${s.h}" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".2"/>`;
  else out += sheetAt(print, s, x, y); return out; }
const CHAIR = `<g transform="translate(4 -25)"><rect x="31" y="216" width="5" height="14" fill="#1f2225"/><rect x="97" y="216" width="5" height="14" fill="#1f2225"/><rect x="34" y="140" width="65" height="78" rx="11" fill="#2e3236"/><rect x="24" y="172" width="19" height="48" rx="8" fill="#3a3f44"/><rect x="90" y="172" width="19" height="48" rx="8" fill="#3a3f44"/><rect x="41" y="186" width="51" height="22" rx="6" fill="#454b51"/></g>`;
function scene() { const print = F.printOf(shown), o = F.outside(choice.size, choice.frame), isFramed = choice.frame !== 'none', size = `${F.cm(o.w)} × ${F.cm(o.h)} cm`, what = isFramed ? `In its ${F.frameName(choice.frame).toLowerCase()} it is ${size}.` : `The sheet is ${size}.`;
  if (choice.look === 'wall') { const mid = WALL.floor - F.HANG, x = WALL.at - o.w / 2, y = mid - o.h / 2, words = `${what} Shown to scale beside an armchair ${WALL.chair} cm wide, with its middle ${F.HANG} cm from the floor (the dashed line), the usual height in a gallery.`;
    $('scene').innerHTML = `<svg viewBox="0 0 ${WALL.w} ${WALL.h}" role="img" aria-label="${print.ref} on the wall"><rect width="${WALL.w}" height="${WALL.floor}" fill="#c9c4b8"/><rect y="${WALL.floor}" width="${WALL.w}" height="${WALL.h - WALL.floor}" fill="#7d776c"/><rect y="${WALL.floor - 5}" width="${WALL.w}" height="5" fill="#b3ada1"/><line x1="0" x2="${WALL.w}" y1="${mid}" y2="${mid}" stroke="rgba(0,0,0,.22)" stroke-width=".4" stroke-dasharray="2.5 2.5"/>${hung(print, choice.size, choice.frame, x, y)}${CHAIR}</svg>`; $('hangs').textContent = words; }
  else { const pad = Math.max(4, o.h * 0.07), h = o.h + 2 * pad, w = h * WALL.w / WALL.h, x0 = o.w / 2 - w / 2; /* the same shape of window as the wall, so that nothing jumps when the look changes */
    $('scene').innerHTML = `<svg viewBox="${x0} ${-pad} ${w} ${h}" role="img" aria-label="${print.ref}, close up"><rect x="${x0}" y="${-pad}" width="${w}" height="${h}" fill="#c9c4b8"/>${hung(print, choice.size, choice.frame, 0, 0)}</svg>`; $('hangs').textContent = `${what} ${isFramed ? `The card mount is ${F.FRAME.mount} cm wide and the wood ${F.FRAME.moulding} cm.` : 'Rolled, with a white edge round the picture.'}`; }
  $('v-wall').setAttribute('aria-pressed', choice.look === 'wall'); $('v-close').setAttribute('aria-pressed', choice.look === 'close'); }

/* ---- One print: its sizes, its frames, how many, and what that comes to ---- */
const was = pence => el('s', {}, el('span', { className: 'sr', textContent: 'was ' }), F.money(pence));
const tile = (name, value, checked, disabled, title, sub, cost) => el('label', { className: 'tile' }, el('input', { type: 'radio', name, value, checked, disabled }), el('span', { className: 'name' }, title, el('span', { className: 'sr', textContent: '. ' }), el('span', { className: 'sub', textContent: sub })), el('span', { className: 'cost' }, el('span', { className: 'sr', textContent: ' ' }), ...cost));
function openPrint(id) { const p = F.printOf(id), last = kept.get(id) || { size: 'a4', frame: 'none' }; shown = id; choice = { size: last.size, frame: last.frame, qty: 1, look: choice.look }; $('p-ref').textContent = p.ref; $('p-what').textContent = p.what; said('');
  $('sizes').replaceChildren(...F.SIZES.map(s => { const none = F.left(id, s.id) === 0; return tile('size', s.id, s.id === choice.size, none, s.name, `${F.cm(s.w)} × ${F.cm(s.h)} cm. ${F.editionText(id, s.id)}`, none ? ['Sold out'] : [el('b', { textContent: F.money(F.salePrice(s.price)) }), ' ', was(s.price)]); })); paintChoice(); }
function paintChoice() { const s = F.sizeOf(choice.size), u = F.unit(choice.size, choice.frame), line = { print: shown, size: choice.size, frame: choice.frame }, mine = F.have(basket, line), room = F.limit(basket, line) - mine; kept.set(shown, { size: choice.size, frame: choice.frame });
  $('frames').replaceChildren(...F.FRAMES.map(([fid, name]) => tile('frame', fid, fid === choice.frame, false, name, fid === 'none' ? 'Rolled, in a tube' : 'With a card mount', fid === 'none' ? [] : [`+${F.money(s.frame)}`])));
  $('q-n').textContent = choice.qty; $('q-less').setAttribute('aria-disabled', choice.qty <= 1); $('q-more').setAttribute('aria-disabled', choice.qty >= room); /* a button that cannot be used is dimmed and says why when pressed; it is not taken out of reach */
  $('p-sum').replaceChildren(el('b', { textContent: F.money(u.each) }), ' each ', was(u.was), choice.qty > 1 ? `. ${F.money(u.each * choice.qty)} for ${choice.qty}.` : ''); $('p-have').hidden = !mine; $('p-have').textContent = mine ? `Your basket holds ${mine} of this already.` : ''; scene(); }
const said = (text, link) => { $('p-said').replaceChildren(text, ...(link ? [' ', el('a', { href: '#basket', textContent: 'See your basket' })] : [])); };
/* A new size or frame keeps how many you asked for, unless that many cannot be had: then it is brought down, and the page says so. */
$('buy').addEventListener('change', e => { if (e.target.name === 'size') choice.size = e.target.value; if (e.target.name === 'frame') choice.frame = e.target.value; const test = F.add(basket, { print: shown, size: choice.size, frame: choice.frame, qty: choice.qty }), fewer = Math.max(1, test.added), down = fewer < choice.qty; choice.qty = fewer; paintChoice(); if (e.target.name === 'frame') $('frames').querySelector(`input[value="${choice.frame}"]`).focus(); said(down ? `How many is now ${fewer}. ${test.why}` : ''); if (down) say(`How many is now ${fewer}. ${test.why}`); });
$('q-less').addEventListener('click', () => { if (choice.qty > 1) { choice.qty--; paintChoice(); said(''); say(String(choice.qty)); } });
$('q-more').addEventListener('click', () => { const want = choice.qty + 1, test = F.add(basket, { print: shown, size: choice.size, frame: choice.frame, qty: want }); if (test.added < want) { said(test.why); return; } choice.qty = want; paintChoice(); said(''); say(String(want)); });
$('v-wall').addEventListener('click', () => { choice.look = 'wall'; scene(); }); $('v-close').addEventListener('click', () => { choice.look = 'close'; scene(); });
$('buy').addEventListener('submit', e => { e.preventDefault(); const item = { print: shown, size: choice.size, frame: choice.frame, qty: choice.qty }, r = F.add(basket, item); basket = r.basket; paintBag();
  said(r.added ? `Added to the mock basket: ${r.added} × ${F.lineText(item)}.${r.why ? ' ' + r.why : ''}` : r.why, basket.length > 0); if (r.added) { choice.qty = 1; paintChoice(); } });

/* ---- The basket ---- */
function paintBag() { const t = F.totals(basket); $('bag-n').textContent = t.count; $('bag-n').classList.toggle('none', !t.count); $('bag-words').textContent = t.count ? `: ${F.items(t.count)}` : ': empty'; if (view === 'basket') document.title = `Your basket (${t.count}) · ${TITLE}`; }
function paintSums() { const t = F.totals(basket), row = (k, v, cls = '') => [el('dt', { className: cls, textContent: k }), el('dd', { className: cls, textContent: v })];
  $('sums').replaceChildren(...row('Prints at full price', F.money(t.prints)), ...row(`Sale, ${F.SALE.off}% off prints`, F.money(-t.saving), 'less'), ...(t.frames ? row('Frames', F.money(t.frames)) : []), ...row('Postage', t.post ? F.money(t.post) : 'Free'), ...row('Total', F.money(t.total), 'tot'));
  $('b-post').textContent = t.toFree ? `Postage is free on orders of ${F.money(F.POST.freeFrom)} or more. This one is ${F.money(t.toFree)} short.` : 'Postage is free on this order.'; }
function paintLine(li, l) { li.querySelector('.q').textContent = l.qty; li.querySelector('.more').setAttribute('aria-disabled', l.qty >= F.limit(basket, l)); li.querySelector('.amount').textContent = F.money(F.lineTotal(l)); li.querySelector('.less').setAttribute('aria-disabled', l.qty <= 1); }
const note = text => { $('b-note').hidden = !text; $('b-note').textContent = text; }; /* said on the page as well as aloud: why a line would not go up, or what came back */
function paintBasket() { const full = basket.length > 0; $('b-empty').hidden = full; $('b-full').hidden = !full; $('undo').hidden = !undo; if (undo) $('undo-words').textContent = `Removed: ${F.lineText(undo.line)}.`;
  $('lines').replaceChildren(...basket.map(l => { const p = F.printOf(l.print), o = F.outside(l.size, l.frame), words = F.lineText(l), u = F.unit(l.size, l.frame), k = F.key(l);
    const li = el('li', {}, el('div', { className: 'thumb', innerHTML: `<svg viewBox="0 0 ${SHEET.w} ${SHEET.h}" aria-hidden="true">${draw(p)}</svg>` }),
      el('div', {}, el('h2', {}, el('a', { href: '#' + p.id, textContent: p.ref })), el('p', { textContent: `${F.sizeOf(l.size).name}, ${F.frameName(l.frame).toLowerCase()}. ${F.cm(o.w)} × ${F.cm(o.h)} cm.` }), el('p', { className: 'each' }, `${F.money(u.each)} each `, was(u.was))),
      el('p', { className: 'amount' }),
      el('div', { className: 'ctl' }, el('div', { className: 'stepper', role: 'group', ariaLabel: `How many: ${words}` }, el('button', { type: 'button', className: 'less', ariaLabel: 'One fewer', textContent: '\u2212', onclick: () => change(k, -1, li) }), el('span', { className: 'q' }), el('button', { type: 'button', className: 'more', ariaLabel: 'One more', textContent: '+', onclick: () => change(k, 1, li) })),
        el('button', { type: 'button', className: 'link', textContent: 'Remove', ariaLabel: `Remove ${words}`, onclick: () => remove(k) })));
    li.dataset.key = k; return li; })); for (const li of $('lines').children) paintLine(li, basket.find(l => F.key(l) === li.dataset.key)); paintSums(); paintBag(); }
function change(k, by, li) { const line = basket.find(l => F.key(l) === k); if (by < 0 && line.qty <= 1) return; const next = F.setQty(basket, k, line.qty + by), now = next.find(l => F.key(l) === k);
  if (now.qty === line.qty) { const why = F.add(basket, { ...line, qty: 1 }).why; note(why); say(why); return; } basket = next; note(''); for (const row of $('lines').children) paintLine(row, basket.find(l => F.key(l) === row.dataset.key)); paintSums(); paintBag(); say(`${now.qty}. Total ${F.money(F.totals(basket).total)}.`); }
function remove(k) { const at = basket.findIndex(l => F.key(l) === k); undo = { line: basket[at], at }; basket = basket.filter(l => F.key(l) !== k); note(''); paintBasket(); $('undo-go').focus(); say(`Removed: ${F.lineText(undo.line)}. Total ${F.money(F.totals(basket).total)}.`); }
/* Put it back: as many as can still be had. If that is fewer than were taken out, or none, the page says how many and why. */
$('undo-go').addEventListener('click', () => { const { line, at } = undo, r = F.add(basket, line), words = F.lineText(line); undo = null; if (r.added) { const put = r.basket.find(l => F.key(l) === F.key(line)); basket = r.basket.filter(l => l !== put); basket.splice(Math.min(at, basket.length), 0, put); }
  const told = r.added === line.qty ? '' : r.added ? `Put back ${r.added} of ${line.qty}: ${words}. ${r.why}` : `Not put back: ${words}. ${r.why}`; paintBasket(); note(told); const li = [...$('lines').children].find(n => n.dataset.key === F.key(line)); (li ? li.querySelector('h2 a') : $('b-note')).focus(); say(told || `Put back: ${words}.`); });
$('order').addEventListener('click', () => { if (!basket.length) return; /* a second press, before the page has turned, must not write an empty order over the first */ lastOrder = F.orderText(basket); basket = []; undo = null; paintBag(); location.hash = '#done'; });
$('copy').addEventListener('click', async () => { const b = $('copy'); try { await navigator.clipboard.writeText($('order-text').textContent); b.textContent = 'Copied'; say('The text is copied.'); } catch (err) { const r = document.createRange(); r.selectNodeContents($('order-text')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; say('Copying was not allowed. The text is selected: copy it with your keyboard.'); } setTimeout(() => { b.textContent = 'Copy the text'; }, 2000); });

/* ---- Which view is shown follows the address, so that the browser's Back works ---- */
function route() { const h = location.hash.slice(1).toLowerCase(); if (F.printOf(h)) return { view: 'print', id: h }; if (h === 'basket') return { view: 'basket' }; if (h === 'done') return lastOrder ? { view: 'done' } : { view: 'basket', fix: '#basket' }; return { view: 'prints', fix: h && h !== 'prints' ? location.pathname : '' }; }
function show(quiet) { const r = route(), from = view === 'print' ? shown : null; if (r.fix) history.replaceState(null, '', r.fix); view = r.view;
  if (view === 'print') openPrint(r.id); if (view === 'basket') { note(''); paintBasket(); } if (view === 'done') $('order-text').textContent = lastOrder;
  for (const v of VIEWS) $(v).hidden = v !== view; document.title = view === 'print' ? `${F.printOf(shown).ref} · ${TITLE}` : view === 'basket' ? `Your basket (${F.totals(basket).count}) · ${TITLE}` : view === 'done' ? `Nothing was bought · ${TITLE}` : TITLE;
  if (quiet) return; const back = view === 'prints' && from ? document.querySelector(`#grid li[data-print="${from}"] a`) : null; /* coming back from a print, you are put back at that print */
  if (back) { back.focus({ preventScroll: true }); back.closest('li').scrollIntoView({ block: 'center' }); } else { scrollTo(0, 0); $(view).querySelector('h1').focus({ preventScroll: true }); } }
addEventListener('hashchange', () => show(false));
paintBag(); show(true);
window.printSale = { state: () => ({ view, id: view === 'print' ? shown : null, choice: { ...choice }, basket: basket.map(l => ({ ...l })), totals: F.totals(basket), order: lastOrder, undo: undo ? { ...undo.line } : null }) }; /* for the checks in tools/ */
