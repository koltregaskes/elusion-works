# Rooms OS handbook

A documentation page: nine short pages with a list of them down the side, search, code samples you can copy, a list of what is on each page, and a light and a dark look. The first of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**The words are sample text.** They were written for this demonstration, in the spirit of Rooms OS. They are not anyone's working rulebook and nothing in them is an instruction. The page says so in a strip under the bar, "Demo handbook: fictional sample rules", which stays in view on every page and every section link, with scripts on or off, and heads every printed page.

**Quality bar it sets:** a documentation page that is one HTML file of plain words which works with scripts off, where search, the contents list and the code colouring are added on top and each is checked against the words on the page.
Use it as the reference for docs pages, help centres and anything with a sidebar and search.

## What it does

- **Nine pages, one file.** One page shows at a time. Each has its own address (`#claims`), each section has one too (`#claims-stale`), and Back and Forward work.
- **Search.** Type in the box, or press Control K (Command K on a Mac) first. Results are sections, best first, with the words found marked. Arrow keys walk the list, Enter opens one. The forms of a word meet ("approved" finds Approvals, "deleting" finds Never delete), a possessive is its word, and words that are only in a code sample are found too. When there are more results than fit, the list says how many.
- **The browser's own Find** looks inside the pages that are not shown, where the browser can, and opens the one it finds something in.
- **Code samples.** Seven of them, in shell, YAML, JSON and JavaScript, coloured, each with a Copy button. If copying is not allowed, the code is selected and the page says so.
- **On this page.** A list of the page's sections. It marks the one you went to, and follows you as you scroll.
- **Light and dark.** Follows your device until you press the button. Your choice is not remembered: nothing is stored. Both looks use one green; code is coloured with it and with weight, not with more colours.
- **A phone.** The list of pages becomes a drawer that opens at the page you are on; the search box has a row of its own; results take the width of the screen.
- **Back** returns to where you were on a page, not to its top. Text sizes follow the size set in the browser.
- **Scripts off.** The whole handbook shows as one long page and every link still works. Search and the buttons, which could not work, are not shown.
- **A demo notice.** "Demo handbook: fictional sample rules" sits in a strip under the bar and stays there as you scroll, so a link straight to any page or section still shows it above the words. On wider screens it adds that the page is not anyone's working rulebook.
- **Print.** The whole handbook, a page to a sheet, black on white, without the furniture, each page headed "Demo handbook: fictional sample rules".

## How it is made

- `index.html`: every word, the styles, and the markup. No build step.
- `js/search.js`: the search (index, scoring, the snippet with its marked words) and the code colouring. No page and nothing drawn, so both run in Node.
- `js/app.js`: reads the pages from the page itself, shows one at a time, builds the contents list and the Previous and Next links, runs the search box, colours and copies the code, switches light and dark, and works the drawer.
- No library, no outside request, nothing stored.

## Checks

From the site's root, with the site served on port 8780:

```bash
node demos/handbook/tools/search.test.mjs
```

```bash
node demos/handbook/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8780
```

```bash
node demos/handbook/tools/notice.mjs http://127.0.0.1:8780
```

```bash
node demos/handbook/tools/shots.mjs http://127.0.0.1:8780 demos/handbook
```

The second, third and fourth need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- The words are sample text, written by the model that built the page. Nobody who runs Rooms OS has edited them.
- Search matches the stems and the beginnings of words. Its stemming is rough: it does not correct spelling and knows no synonyms.
- Until the script has loaded, the whole handbook shows as one long page for a moment.
- The browser's Find reaches the hidden pages only in browsers that support `hidden="until-found"`. Elsewhere it searches the page shown.
- The colouring is deliberately small: enough for these samples, not a parser.
- Nine pages in one file is right for a handbook this size. A hundred pages would want a file each.
- Checked only in headless Chromium. Not yet seen in Safari or Firefox, on a real phone, on paper, or with a real screen reader, and nobody has yet read it through by hand.

## Status

A draft, and unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. It is not on the live site yet.

Unlisted does not mean private. The site deploys whatever is merged, so merging this would put the page on the live site at its own address (`/demos/handbook/`). Search engines are asked not to list it, but anyone with the link could open it.
