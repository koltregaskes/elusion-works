# Axy Lusion print sale: a mock print shop

A small shop page for Axy Lusion: six prints, three sizes, four frames, each print hung on a wall to scale so you can see how big it is, and a basket that adds up. The fifth of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**It is a mock. Nothing can be bought.** No payment is asked for or taken, there is no box for card details, nothing is sent and nothing is saved. Placing the mock order shows the text of the order, and that is all.

**The pictures are stand-ins, not Axy Lusion's work.** They are drawn by code. The prices, the sizes on offer, the editions and how many are left are made up.

**Quality bar it sets:** a shop page where every price, size and total on the screen is proved to be the one the rules give: the picture on the wall is drawn in centimetres from the same numbers as the price, the basket is checked line by line and sum by sum, and the order button is proved to send nothing.
Use it as the reference for shop pages, price lists and anything with a basket.

## What it does

- **Six prints.** Each has a reference, never a title, as in the Axy Lusion archive. The whole card is the link.
- **On the wall, to scale.** Choose a size and a frame and the print is hung on a wall 3.3 m wide, beside an armchair 85 cm wide, with its middle 145 cm from the floor, the usual height in a gallery. The drawing is in centimetres, so an A2 in a frame really is that much bigger than an A4 without one. "Close up" shows the same print large.
- **Sizes, frames and editions.** A4 is an open edition. A3 is an edition of 50 and A2 an edition of 25, with the number left shown. A sold-out size cannot be chosen and says so. A frame adds a card mount and wood: 14 cm to the width and to the height.
- **The sale.** 20% off every print, with the old price struck through and read out as "was". Frames are not in the sale.
- **How many.** Up to five of one print in one frame, and never more than are left of a numbered size, counted across every frame in the basket. When it stops, it says why.
- **The basket.** Every line with its size on the wall and its price, more and fewer, Remove with "Put it back", prints at full price, the saving, frames, postage and the total. Postage is one charge an order, and free from £150.
- **The end.** "Nothing was bought", and the text of the order, with a button to copy it.
- **The address says what is shown,** so the browser's Back works, and coming back from a print puts you at that print.
- **With scripts off** the six prints, their pictures and the table of prices are all there. The page says that choosing and the basket need scripts.

## How it is made

- `js/shop.js`: the rules. What is for sale, the sale, frames, editions, what fits in a basket and why not, postage, totals, and the order as text. All money is whole pence. No page, so it runs in Node.
- `js/art.js`: the six stand-in pictures. Flat ink on paper: black, the paper and one colour each, with dots for the tones between, as in a comic. The same every time.
- `js/app.js`: the views, the wall, and the basket.
- `index.html`: the styles and the markup. The six prints and the table of prices are written into it by `tools/build.mjs` from the rules, and the test fails if the page and the rules disagree.
- No library, no font or picture file, no outside request.

## Checks

From the site's root, with the site served on port 8784:

```bash
node demos/print-sale/tools/shop.test.mjs
```

```bash
node demos/print-sale/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8784
```

```bash
node demos/print-sale/tools/shots.mjs http://127.0.0.1:8784 demos/print-sale
```

After changing a price, a print or a picture, write the page's own copy again:

```bash
node demos/print-sale/tools/build.mjs
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- It cannot take an order. A real shop needs a payment provider, stock that is counted somewhere, and somebody to post the prints. None of that is here, and none of it should be added without Kol's say-so.
- The pictures are stand-ins made of a few shapes. To sell real prints, each needs its own image, and the wall would show that image.
- Prices are shown without any mention of VAT. A real shop has to say.
- The basket is lost if the page is reloaded. Nothing is saved, on purpose.
- The wall shows size, not colour: a screen cannot promise how a print will look on paper.
- Checked only in headless Chromium. Not yet seen in Safari or Firefox or on a real phone, and no screen reader has been heard on it.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
