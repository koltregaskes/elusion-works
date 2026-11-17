// Print sale: the shop's rules. What is for sale, what it costs, how many are left, what fits in a basket, what the basket comes to, and what an order would say.
// Nothing here touches the page, so every sum can be checked in Node. All money is whole pence.
// Everything in this file is made up for the demonstration: the prices, the sizes on offer, the editions and how many are left.

export const SALE = { off: 20 }; // per cent off every print. Frames are not in the sale.
export const SIZES = [
  { id: 'a4', name: 'A4', w: 21, h: 29.7, price: 3500, frame: 3000, edition: 0 },
  { id: 'a3', name: 'A3', w: 29.7, h: 42, price: 6000, frame: 4500, edition: 50 },
  { id: 'a2', name: 'A2', w: 42, h: 59.4, price: 11000, frame: 7000, edition: 25 },
]; // edition 0 means an open edition: as many as are wanted
export const FRAMES = [['none', 'No frame'], ['black', 'Black frame'], ['oak', 'Oak frame'], ['white', 'White frame']];
export const FRAME = { mount: 5, moulding: 2 }; // cm added on every side by a frame: the card mount, then the wood
export const POST = { rolled: 450, framed: 1400, freeFrom: 15000 }; // one charge an order: a tube, or a box when anything in it is framed
export const MAX = 5; // of one print at one size in one frame
export const HANG = 145; // cm from the floor to the middle of a picture: the usual gallery height

// The six prints. A reference, never a title, as in the Axy Lusion archive. `left` is how many of a numbered edition remain.
export const PRINTS = [
  { id: 'ax-0412', ref: 'AX 0412', kind: 'sun', spot: '#e4572e', what: 'A red sun going down behind black hills, the sky in dots.', left: { a3: 12, a2: 3 } },
  { id: 'ax-0388', ref: 'AX 0388', kind: 'wave', spot: '#2f6fde', what: 'Four heavy black waves under a blue moon.', left: { a3: 31, a2: 9 } },
  { id: 'ax-0451', ref: 'AX 0451', kind: 'burst', spot: '#f2b705', what: 'A yellow burst with black rays, as when something lands in a comic.', left: { a3: 2, a2: 0 } },
  { id: 'ax-0297', ref: 'AX 0297', kind: 'town', spot: '#e0457b', what: 'A black town at night with pink windows lit.', left: { a3: 40, a2: 17 } },
  { id: 'ax-0503', ref: 'AX 0503', kind: 'rings', spot: '#12a594', what: 'Green rings spreading from one point, crossed by a black bar.', left: { a3: 0, a2: 6 } },
  { id: 'ax-0346', ref: 'AX 0346', kind: 'steps', spot: '#7a52d1', what: 'Violet steps climbing out of the dark, each with its shadow.', left: { a3: 22, a2: 11 } },
];
export const printOf = id => PRINTS.find(p => p.id === id), sizeOf = id => SIZES.find(s => s.id === id), frameName = id => (FRAMES.find(f => f[0] === id) || FRAMES[0])[1];

// ---- Money ----
// Pence as pounds: £35, £4.50, £1,250. Whole pounds drop the pence.
export const money = p => { const neg = p < 0, a = Math.abs(Math.round(p)), pounds = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+$)/g, ','), pence = a % 100; return `${neg ? '-' : ''}£${pounds}${pence ? '.' + String(pence).padStart(2, '0') : ''}`; };
// A price with the sale taken off, to the nearest penny.
export const salePrice = pence => Math.round(pence * (100 - SALE.off) / 100);
// What one print costs at a size and in a frame: the print's full price, its sale price, the frame, and the two sums.
export function unit(sizeId, frameId) { const s = sizeOf(sizeId), frame = frameId && frameId !== 'none' ? s.frame : 0, now = salePrice(s.price); return { print: s.price, now, frame, was: s.price + frame, each: now + frame }; }
// How big it is on the wall, in cm: the sheet, or the outside of the frame.
export function outside(sizeId, frameId) { const s = sizeOf(sizeId), add = frameId && frameId !== 'none' ? 2 * (FRAME.mount + FRAME.moulding) : 0, r = n => Math.round(n * 10) / 10; return { w: r(s.w + add), h: r(s.h + add) }; }
export const cm = n => String(Math.round(n * 10) / 10);

// ---- How many are left ----
// Of a print at a size: Infinity for an open edition.
export const left = (printId, sizeId) => (sizeOf(sizeId).edition ? printOf(printId).left[sizeId] : Infinity);
export const editionText = (printId, sizeId) => { const s = sizeOf(sizeId), n = left(printId, sizeId); return !s.edition ? 'Open edition' : n === 0 ? `Edition of ${s.edition}. Sold out.` : `Edition of ${s.edition}. ${n} left.`; };

// ---- The basket: a list of lines, each { print, size, frame, qty }. Every change returns a new list. ----
export const key = l => `${l.print}/${l.size}/${l.frame}`;
// How many of a print at a size are in the basket, across all frames.
export const held = (basket, printId, sizeId) => basket.filter(l => l.print === printId && l.size === sizeId).reduce((n, l) => n + l.qty, 0);
// The most a line may hold: five, or fewer when the edition is nearly gone and other lines hold some of it.
export function limit(basket, line) { const others = held(basket.filter(l => key(l) !== key(line)), line.print, line.size); return Math.max(0, Math.min(MAX, left(line.print, line.size) - others)); }
// Add some. Returns the new basket, how many went in, and, when that is fewer than asked for, why.
export function add(basket, item) { const want = Math.max(1, Math.floor(item.qty) || 1), k = key(item), old = basket.find(l => key(l) === k), have = old ? old.qty : 0, most = limit(basket, item), added = Math.max(0, Math.min(want, most - have));
  const next = added ? (old ? basket.map(l => (key(l) === k ? { ...l, qty: have + added } : l)) : [...basket, { print: item.print, size: item.size, frame: item.frame, qty: added }]) : basket;
  let why = ''; if (added < want) { const n = left(item.print, item.size), all = held(basket, item.print, item.size), are = n === 1 ? 'is' : 'are'; /* which ran out first: the edition, or the five to a line */
    why = n === 0 ? 'That size is sold out.' : n - all > MAX - have ? `${MAX} is the most of one print in one frame.` : n - all <= 0 ? `Your basket already holds all ${n} that ${are} left at that size.` : all ? `Only ${n} ${are} left at that size, and your basket already holds ${all}.` : `Only ${n} ${are} left at that size.`; }
  return { basket: next, added, why }; }
// Set a line's quantity. Nought takes the line out; more than the limit is held to the limit.
export function setQty(basket, k, qty) { const line = basket.find(l => key(l) === k); if (!line) return basket; const q = Math.max(0, Math.min(Math.floor(qty) || 0, limit(basket, line))); return q ? basket.map(l => (key(l) === k ? { ...l, qty: q } : l)) : basket.filter(l => key(l) !== k); }

// ---- What it comes to ----
export const lineTotal = l => unit(l.size, l.frame).each * l.qty;
export function totals(basket) { let count = 0, prints = 0, saving = 0, frames = 0, framed = false; for (const l of basket) { const u = unit(l.size, l.frame); count += l.qty; prints += u.print * l.qty; saving += (u.print - u.now) * l.qty; frames += u.frame * l.qty; if (u.frame) framed = true; }
  const goods = prints - saving + frames, post = !count || goods >= POST.freeFrom ? 0 : framed ? POST.framed : POST.rolled; return { count, prints, saving, frames, goods, framed, post, total: goods + post, toFree: count && goods < POST.freeFrom ? POST.freeFrom - goods : 0 }; }
// A line in words: "AX 0412, A3, oak frame".
export const lineText = l => `${printOf(l.print).ref}, ${sizeOf(l.size).name}, ${frameName(l.frame).toLowerCase()}`;
export const items = n => `${n} ${n === 1 ? 'item' : 'items'}`;
// The order as it would be placed: plain text, a line to a thing.
export function orderText(basket) { const t = totals(basket), out = ['Mock order from the Axy Lusion print sale', 'No payment was asked for or taken. Nothing was ordered.', ''];
  for (const l of basket) out.push(`${l.qty} x ${lineText(l)}: ${money(lineTotal(l))}`);
  out.push('', `Prints at full price: ${money(t.prints)}`, `Sale, ${SALE.off}% off prints: ${money(-t.saving)}`); if (t.frames) out.push(`Frames: ${money(t.frames)}`); out.push(`Postage: ${t.post ? money(t.post) : 'Free'}`, `Total: ${money(t.total)}`); return out.join('\n'); }
