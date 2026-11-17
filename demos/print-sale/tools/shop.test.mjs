// Checks the print shop's rules and sums without a browser. Usage: node shop.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as F from '../js/shop.js';
import { draw, sheet, PAPER, INK } from '../js/art.js';
import { grid, facts, between } from './build.mjs';

// Money: whole pence in, pounds out.
assert.deepEqual([3500, 450, 125000, 5, 0, -5600, 1234567].map(F.money), ['£35', '£4.50', '£1,250', '£0.05', '£0', '-£56', '£12,345.67']);
// The sale: a fifth off prints, to the nearest penny. Frames are not in it.
assert.deepEqual([3500, 6000, 11000, 3333, 1999, 1].map(F.salePrice), [2800, 4800, 8800, 2666, 1599, 1]);
assert.deepEqual(F.unit('a3', 'oak'), { print: 6000, now: 4800, frame: 4500, was: 10500, each: 9300 }); assert.deepEqual(F.unit('a3', 'none'), { print: 6000, now: 4800, frame: 0, was: 6000, each: 4800 }); assert.deepEqual(F.unit('a2', 'black').each, 8800 + 7000);
for (const s of F.SIZES) for (const [f] of F.FRAMES) { const u = F.unit(s.id, f); assert.equal(u.each, u.now + u.frame); assert.equal(u.was - u.each, u.print - u.now, 'the saving is on the print alone'); assert.ok(u.now < u.print); }
// How big on the wall: the sheet, or the sheet with a 5 cm mount and 2 cm of wood on every side.
assert.deepEqual(F.outside('a2', 'none'), { w: 42, h: 59.4 }); assert.deepEqual(F.outside('a2', 'oak'), { w: 56, h: 73.4 }); assert.deepEqual(F.outside('a4', 'white'), { w: 35, h: 43.7 }); assert.deepEqual(F.outside('a3', 'black'), { w: 43.7, h: 56 });
for (const s of F.SIZES) assert.ok(Math.abs(s.h / s.w - Math.SQRT2) < 0.01, `${s.name} is not an A size`);
// Editions: A4 is open; the others are numbered, and what is left is never more than the edition.
assert.equal(F.left('ax-0412', 'a4'), Infinity); assert.equal(F.left('ax-0412', 'a2'), 3); assert.equal(F.left('ax-0451', 'a2'), 0);
assert.deepEqual([['ax-0412', 'a4'], ['ax-0412', 'a3'], ['ax-0451', 'a2']].map(a => F.editionText(...a)), ['Open edition', 'Edition of 50. 12 left.', 'Edition of 25. Sold out.']);
assert.equal(new Set(F.PRINTS.map(p => p.id)).size, 6); for (const p of F.PRINTS) for (const s of F.SIZES) if (s.edition) assert.ok(p.left[s.id] >= 0 && p.left[s.id] <= s.edition, `${p.ref} ${s.name}`);
assert.ok(F.PRINTS.some(p => F.SIZES.some(s => F.left(p.id, s.id) === 0)), 'no size is sold out, so that state would go unseen');

// The basket. Adding: a new line, more on a line, and never more than five to a line or more than are left.
const it = (print, size, frame, qty) => ({ print, size, frame, qty }); let b = [], r;
r = F.add(b, it('ax-0388', 'a3', 'oak', 2)); assert.deepEqual([r.added, r.why, r.basket], [2, '', [it('ax-0388', 'a3', 'oak', 2)]]); assert.deepEqual(b, [], 'adding changed the basket it was given'); b = r.basket;
r = F.add(b, it('ax-0388', 'a3', 'oak', 1)); assert.deepEqual(r.basket, [it('ax-0388', 'a3', 'oak', 3)], 'the same thing twice is one line'); b = r.basket;
r = F.add(b, it('ax-0388', 'a3', 'oak', 9)); assert.deepEqual([r.added, r.why, r.basket[0].qty], [2, '5 is the most of one print in one frame.', 5]); b = r.basket;
r = F.add(b, it('ax-0388', 'a3', 'oak', 1)); assert.deepEqual([r.added, r.why, r.basket], [0, '5 is the most of one print in one frame.', b]);
r = F.add(b, it('ax-0388', 'a3', 'none', 1)); assert.equal(r.basket.length, 2, 'another frame is another line'); assert.equal(F.held(r.basket, 'ax-0388', 'a3'), 6);
r = F.add([], it('ax-0451', 'a2', 'none', 1)); assert.deepEqual([r.added, r.why], [0, 'That size is sold out.']);
r = F.add([], it('ax-0412', 'a2', 'none', 5)); assert.deepEqual([r.added, r.why], [3, 'Only 3 are left at that size.']); r = F.add(r.basket, it('ax-0412', 'a2', 'oak', 1)); assert.deepEqual([r.added, r.why], [0, 'Your basket already holds all 3 that are left at that size.']);
r = F.add([it('ax-0451', 'a3', 'black', 1)], it('ax-0451', 'a3', 'oak', 2)); assert.deepEqual([r.added, r.why], [1, 'Only 2 are left at that size, and your basket already holds 1.'], 'an edition is shared by every frame');
r = F.add([], it('ax-0412', 'a4', 'none', 0)); assert.equal(r.added, 1, 'nought asked for is one'); r = F.add([], it('ax-0412', 'a4', 'none', 2.9)); assert.equal(r.added, 2);
// Changing a line: held to the limit, and nought takes it out.
b = [it('ax-0412', 'a2', 'oak', 2), it('ax-0412', 'a2', 'none', 1), it('ax-0388', 'a4', 'none', 1)];
assert.equal(F.limit(b, b[0]), 2, 'three are left and another line holds one'); assert.deepEqual(F.setQty(b, F.key(b[0]), 3), b, 'a line went past what is left'); assert.equal(F.setQty(b, F.key(b[2]), 99)[2].qty, 5); assert.deepEqual(F.setQty(b, F.key(b[1]), 0), [b[0], b[2]]); assert.deepEqual(F.setQty(b, 'no/such/line', 2), b); assert.equal(F.setQty(F.setQty(b, F.key(b[1]), 0), F.key(b[0]), 3)[0].qty, 3);

// What it comes to.
assert.deepEqual(F.totals([]), { count: 0, prints: 0, saving: 0, frames: 0, goods: 0, framed: false, post: 0, total: 0, toFree: 0 });
assert.deepEqual(F.totals([it('ax-0388', 'a3', 'none', 1)]), { count: 1, prints: 6000, saving: 1200, frames: 0, goods: 4800, framed: false, post: 450, total: 5250, toFree: 10200 });
assert.deepEqual(F.totals([it('ax-0388', 'a3', 'oak', 1)]), { count: 1, prints: 6000, saving: 1200, frames: 4500, goods: 9300, framed: true, post: 1400, total: 10700, toFree: 5700 });
assert.deepEqual(F.totals([it('ax-0388', 'a3', 'oak', 1), it('ax-0297', 'a4', 'white', 1)]), { count: 2, prints: 9500, saving: 1900, frames: 7500, goods: 15100, framed: true, post: 0, total: 15100, toFree: 0 }, 'postage is free from £150');
assert.equal(F.totals([it('ax-0388', 'a4', 'none', 5), it('ax-0297', 'a4', 'none', 1)]).post, 0, 'six A4 prints come to £168'); assert.equal(F.totals([it('ax-0388', 'a4', 'none', 5)]).post, 450, 'five come to £140');
// Any basket at all: the lines add up to the goods, nothing is negative, and postage is charged exactly when the order is short of free postage.
{ let seed = 20261117; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }, pick = list => list[Math.floor(rnd() * list.length)]; let tried = 0;
  for (let k = 0; k < 400; k++) { let basket = []; for (let n = 0; n < 1 + Math.floor(rnd() * 6); n++) basket = F.add(basket, it(pick(F.PRINTS).id, pick(F.SIZES).id, pick(F.FRAMES)[0], 1 + Math.floor(rnd() * 5))).basket; const t = F.totals(basket); tried++;
    assert.equal(basket.reduce((a, l) => a + F.lineTotal(l), 0), t.goods); assert.equal(t.prints - t.saving + t.frames, t.goods); assert.equal(t.goods + t.post, t.total); assert.equal(t.count, basket.reduce((a, l) => a + l.qty, 0)); assert.equal(t.post > 0, t.toFree > 0); assert.equal(t.post, !t.count || t.goods >= F.POST.freeFrom ? 0 : t.framed ? F.POST.framed : F.POST.rolled);
    for (const l of basket) { assert.ok(l.qty >= 1 && l.qty <= F.MAX); assert.ok(F.held(basket, l.print, l.size) <= F.left(l.print, l.size), 'more in the basket than are left'); } assert.equal(new Set(basket.map(F.key)).size, basket.length); } assert.equal(tried, 400); }
// The order as text.
assert.equal(F.orderText([it('ax-0412', 'a2', 'oak', 2), it('ax-0388', 'a4', 'none', 1)]), ['Mock order from the Axy Lusion print sale', 'No payment was asked for or taken. Nothing was ordered.', '', '2 x AX 0412, A2, oak frame: £316', '1 x AX 0388, A4, no frame: £28', '', 'Prints at full price: £255', 'Sale, 20% off prints: -£51', 'Frames: £140', 'Postage: Free', 'Total: £344'].join('\n'));
assert.equal(F.orderText([it('ax-0388', 'a4', 'none', 1)]).split('\n').slice(-3).join('|'), 'Sale, 20% off prints: -£7|Postage: £4.50|Total: £32.50');

// The pictures: the same every time, six different ones, and only three inks each: the paper, black and the print's one colour.
for (const p of F.PRINTS) { const a = draw(p), again = draw(p); assert.equal(a, again, `${p.ref} is not the same twice`); const inks = new Set((a.match(/#[0-9a-f]{6}\b/gi) || []).map(c => c.toLowerCase())); assert.deepEqual([...inks].sort(), [PAPER, INK, p.spot].map(c => c.toLowerCase()).sort(), `${p.ref} uses other inks`); assert.ok(a.length > 2000 && a.length < 40000, `${p.ref} is ${a.length} characters`); assert.ok(!/NaN|undefined|Infinity/.test(a)); }
assert.equal(new Set(F.PRINTS.map(draw)).size, 6); assert.equal(new Set(F.PRINTS.map(p => p.spot)).size, 6);
// The page and the rules agree: the prints and the table of prices in index.html are the ones these rules write.
{ const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'); assert.equal(between(html, 'grid').inside.trim(), grid(), 'the prints in the page are not the ones the rules write: run tools/build.mjs'); assert.equal(between(html, 'facts').inside.trim(), facts(), 'the table of prices in the page is not the one the rules write: run tools/build.mjs'); for (const p of F.PRINTS) assert.ok(html.includes(sheet(p, `role="img" aria-label="Stand-in picture. ${p.what}"`))); }
console.log('ok  shop: money, the sale and frame sizes; editions; a basket never holds more than five to a line or more than are left, and says why; 400 baskets made at random add up; the order reads as it should; six pictures, the same every time, in three inks each; the page and the rules agree');
