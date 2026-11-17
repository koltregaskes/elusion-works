// Writes the parts of index.html that come from the shop's rules: the six prints with their pictures, and the table of sizes, frames and postage. They are in the page itself so that it reads with scripts off.
// Usage: node build.mjs   (rewrites ../index.html between its markers). shop.test.mjs fails if the page and the rules disagree.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as F from '../js/shop.js';
import { sheet } from '../js/art.js';

const was = pence => `<s><span class="sr">was </span>${F.money(pence)}</s>`;
const gone = p => { const out = F.SIZES.filter(z => F.left(p.id, z.id) === 0).map(z => z.name); return out.length ? `<span class="gone">${out.join(' and ')} sold out</span>` : ''; };
export const grid = () => F.PRINTS.map(p => `<li data-print="${p.id}"><div class="hung">${sheet(p, `role="img" aria-label="Stand-in picture for ${p.ref}"`)}</div><h2 class="ref">${p.ref}</h2><p class="what">${p.what}</p><p class="from">From <b>${F.money(F.unit('a4', 'none').each)}</b> ${was(F.unit('a4', 'none').was)}${gone(p)}</p></li>`).join('\n');
export const facts = () => { const dim = s => `${F.cm(s.w)} × ${F.cm(s.h)} cm`, add = 2 * (F.FRAME.mount + F.FRAME.moulding);
  return `<div class="fact"><h2>Sizes and prices</h2><table><thead><tr><th scope="col">Size</th><th scope="col">Sheet</th><th scope="col">Price</th><th scope="col">Edition</th></tr></thead><tbody>${F.SIZES.map(s => `<tr><th scope="row">${s.name}</th><td>${dim(s)}</td><td><b>${F.money(F.salePrice(s.price))}</b> ${was(s.price)}</td><td>${s.edition ? `Edition of ${s.edition}` : 'Open edition'}</td></tr>`).join('')}</tbody></table></div>
<div class="fact"><h2>Frames</h2><p>Black, oak or white, each with a card mount. A frame adds ${add} cm to the width and to the height. ${F.SIZES.map(s => `${s.name} +${F.money(s.frame)}`).join(', ')}. Frames are not in the sale.</p></div>
<div class="fact"><h2>Postage</h2><p>${F.money(F.POST.rolled)} for an order of rolled prints, sent in a tube. ${F.money(F.POST.framed)} when anything in it is framed. Free on orders of ${F.money(F.POST.freeFrom)} or more.</p></div>
<div class="fact"><h2>Paper and tax</h2><p>A real shop would say here what the prints are made on, such as pigment inks on heavy cotton paper, and whether its prices include VAT. This one is a mock, so there is no paper and no tax.</p></div>`; };
export const between = (html, name) => { const a = `<!--${name}-->`, b = `<!--/${name}-->`, i = html.indexOf(a), j = html.indexOf(b); if (i < 0 || j < 0) throw new Error(`no ${name} markers in the page`); return { before: html.slice(0, i + a.length), inside: html.slice(i + a.length, j), after: html.slice(j) }; };
if (process.argv[1] === fileURLToPath(import.meta.url)) { const file = new URL('../index.html', import.meta.url); let html = fs.readFileSync(file, 'utf8'); for (const [name, make] of [['grid', grid], ['facts', facts]]) { const p = between(html, name); html = `${p.before}\n${make()}\n${p.after}`; } fs.writeFileSync(file, html); console.log('index.html: the prints and the table of prices written from the rules'); }
