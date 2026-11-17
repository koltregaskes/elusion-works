# Axy Lusion print sale: review

Gap demo 5 of 7 on the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876): a print-shop page, as a mock print sale for Axy Lusion with no payments.
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to try. Not published, not in the gallery or the sitemap.

**Nothing can be bought, and the pictures are not Axy Lusion's.** The six prints are stand-ins drawn by code. The prices, sizes, editions, stock and the sale are made up, and the page says so. Nobody has used it on a phone or heard it in a screen reader.

**Quality bar it sets:** a shop page where every price, size and total on the screen is proved to be the one the rules give: the picture on the wall is drawn in centimetres from the same numbers as the price, the basket is checked line by line and sum by sum, and the order button is proved to send nothing.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A print-shop page | Six prints, three sizes, four frames, a wall that shows each to scale, a basket and an end | `index.html`, `js/app.js` |
| Axy print sale | 20% off every print, frames not included, said to be part of the mock | `js/shop.js` |
| Mock, no payments | No payment, no card or address box, no request, nothing saved. "Nothing was bought" at the end | browser check |
| Kol's taste: title card, charcoal, white, one green; comic-book, not anime | A big white headline on charcoal, one green in the interface. The stand-in prints are flat ink with dots, each in black, paper and one colour of its own | `thumbnail.png` |
| Own folder, own review, nothing live | `demos/print-sale/`, this file, `noindex`, no gallery card, no sitemap entry | `index.html` |

## Checks run (17 Nov 2026)

Verified by running. All passed on the code as committed.

- `node demos/print-sale/tools/shop.test.mjs`: pass.
  - Money, the sale and frame sizes against figures written out by hand. Editions. A basket never holds more than five to a line or more than are left, and gives the right reason.
  - 400 baskets made and changed at random add up. The order text is exact. Six pictures, the same every time, three inks each. The page's own copy of the prints and prices is the one the rules write.
- `node demos/print-sale/tools/smoke.mjs`: pass, in headless Chromium.
  - Scripts off: the six prints with pictures and prices, and nothing that could not work.
  - For all 12 pairs of size and frame, the price and the size on the wall match figures written out by hand in the test. Measured in pixels, the sheet and the 85 cm armchair are to one scale, and the picture's middle is 145 cm from the floor.
  - How many stops at what is left and says why. A sold-out size cannot be chosen.
  - A basket of seven is added up by hand and matches. More, fewer, the limits, Remove and Put it back (whole, in part, and not at all) each show the right sums and the right reason on the page, with the focus kept.
  - The order button pressed twice still shows the order placed. It makes no request. The page has no box for card details.
  - Phones 390x800, 320x568 and 740x360 by touch, and 1920x1080: every view fits, buttons are at least 44 px tall, and the wall stays whole and in sight while a frame is chosen.
  - A browser really set to text twice the size: every view fits 390 and 320 wide, and no choice has its words squeezed into a thin column. Forced colours: the chosen size is ringed and the pictures keep their inks.
  - axe WCAG 2.2 A and AA on every view at five sizes, at large text and with scripts off. No console errors, no outside requests.
- One-off, by hand: with the guard taken out, pressing the order button twice shows a total of £0; with it in, the order placed.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; axe clean; the first three Tabs land on visible things; `python3 scripts/build-site.py` passes.

## Not verified

1. **The look and the pictures**, judged by a person. The reviewer called the pictures a clean set but closer to screen-print posters than to comics; two were redrawn, and nobody has judged the result.
2. **A screen reader.** What is said when something is added or a total changes is unheard.
3. A real phone, Safari and Firefox.
4. Whether these are the sizes, frames and prices Kol would want. They are made up.

## Known limits

- It cannot take an order. A real shop needs a payment provider, counted stock and somebody to post the prints.
- On a small phone the wall is about 1.3 px to the centimetre, so it shows which size is bigger and not much more.
- The basket is lost on reload. Nothing is saved, on purpose.
- The checks compare most of the basket with the rules, and the rules with figures worked out by hand. Only one basket is added up by hand in the browser.

## Independent review

A second pass by a separate Claude agent (Opus), read-only, given the brief and not the author's conclusions. It checked the sums, measured the wall in pixels, drove the shop by keyboard and touch at five sizes, and read every word. It found the arithmetic right and the scale drawing true. 18 findings: 1 blocker, 8 should-fix, 9 minor.

| # | Finding | What was done | Held by |
|---|---|---|---|
| 1 | Blocker. Pressing the order button twice replaced the order with an empty one of £0 | A second press does nothing | browser check; one-off with the guard removed |
| 2 | Put it back returned fewer than were removed and did not say so | The page says how many came back and why | browser check |
| 3 | When nothing could be put back, the reason was only read aloud | The reason is shown where the line was, and takes the focus | browser check |
| 4 | One description was wrong (four black waves; two are blue) and one colour misnamed | Descriptions rewritten to match the pictures | by looking |
| 5 | Lines stated as fact what a mock cannot do: signed, numbered, sent in a box. The notice left out sizes and stock. Nothing said "mock" when adding | "In a real shop…would". The notice names prices, sizes, editions, stock and the sale. The reply reads "Added to the mock basket" | browser check for the notice and the reply |
| 6 | A sale with struck-through old prices and no end date is a known sales trick | The notice and the README say the sale is part of the mock and no print was sold at the old price. The sale stays, because the brief asks for one | by reading |
| 7 | At text twice the size on a small phone, words in the size choices broke in the middle | When name and price cannot share a line, the price goes underneath | browser check in a browser set to 32 px text |
| 8 | On phones the wall was tiny, sat above the choices and was taller than a phone on its side | The wall is tighter, with the picture beside the chair. In one column it stays at the top of the screen while you choose; on a phone on its side it sits beside the choices | browser check at four sizes |
| 9 | Numbers and descriptions were announced two or three times | The count is no longer a live region of its own; the wall and the grid pictures have short names | by reading the code |
| 10 | Changing size silently reset how many; coming back to a print lost its size and frame | How many is kept, or brought down with the reason shown. Each print is found as it was left | browser check |
| 11 | The stepper did not show when it could not be used; nothing said five were already in the basket | Dimmed when it cannot be used, with the reason on pressing. "Your basket holds 5 of this already." | browser check |
| 12 | Untidy names: a stray space in the basket link, a goods total beside it, size choices run together, a capital-letter address lost | Tidied; the link says how many items; addresses are read in either case | browser check |
| 13 | Wording: a message starting with a numeral, "Of 50", a hyphen for a minus, "x" for times, an eyebrow that added nothing | Reworded; a real minus sign and times sign | rules test |
| 14 | Visual: a gap in the Total rule; the picture hung far from the chair; every card said the same price; two buttons kept their colours in forced colours | Fixed; cards now say which size is sold out; system colours are used | by looking |
| 15 | The README linked to this file before it existed | This file | |
| 16 | The checks proved less than they said: the browser checks compared the page with the rules, not with fixed numbers; several cases were not covered | Sizes and prices are written out by hand in the browser check and the scale is measured in pixels. Double press, part and failed put-back, and thin columns at large text are covered. Random baskets now change quantities too | the checks themselves |
| 17 | A print buyer would look for the paper and a line about VAT | The page says a real shop would give both, and that this one has neither | by reading |
| 18 | The pictures: two were weak (a target with an arbitrary bar; buildings like a wireframe) | Both redrawn: a drop about to land in rings, and a solid town against a dotted sky. They remain stand-ins | by looking; not judged by a person |

## Provenance

- No library, no font, picture or data file. The six pictures are drawn by `js/art.js`.
- The pictures, prices and editions are original and made up for the demonstration. None of it is Axy Lusion's work or price list.
