# Rooms OS handbook

A documentation page: nine short pages with a list of them down the side, search, code samples you can copy, a list of what is on each page, and a light and a dark page. The first of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**The words are sample text.** They were written for this demonstration, in the spirit of Rooms OS. They are not the estate's working rulebook and nothing in them is an instruction. The page says so on its first screen.

**Quality bar it sets:** a documentation page that is one HTML file of plain words which works with scripts off, where search, the contents list and the code colouring are added on top and each is checked against the words on the page.
Use it as the reference for docs pages, help centres and anything with a sidebar and search.

## What it does

- **Nine pages, one file.** One page shows at a time. Each has its own address (`#claims`), each section has one too (`#claims-stale`), and Back and Forward work.
- **Search.** Type in the box, or press `/` first. Results are sections, best first, with the words found marked. Arrow keys walk the list, Enter opens one. Every heading finds itself first.
- **Code samples.** Seven of them, in shell, YAML, JSON and JavaScript, coloured, each with a Copy button. If copying is not allowed, the code is selected and the page says so.
- **On this page.** A list of the page's sections that marks where you are as you scroll.
- **Light and dark.** Follows your device until you press the button. Your choice is not remembered: nothing is stored.
- **A phone.** The list of pages becomes a drawer; search results take the width of the screen.
- **Scripts off.** The whole handbook shows as one long page and every link still works. Search and the buttons, which could not work, are not shown.
- **Print.** The whole handbook, a page to a sheet, without the furniture.

## How it is made

- `index.html`: every word, the styles, and the markup. No build step.
- `js/search.js`: the search (index, scoring, the snippet with its marked words) and the code colouring. No page and nothing drawn, so both run in Node.
- `js/app.js`: reads the pages from the page itself, shows one at a time, builds the contents list and the Before and Next links, runs the search box, colours and copies the code, switches light and dark, and works the drawer.
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
node demos/handbook/tools/shots.mjs http://127.0.0.1:8780 demos/handbook
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- The words are sample text, written by the model that built the page. Nobody who runs Rooms OS has edited them.
- Search matches whole words and the beginnings of words. It does not correct spelling and knows no synonyms.
- The colouring is deliberately small: enough for these samples, not a parser.
- Nine pages in one file is right for a handbook this size. A hundred pages would want a file each.
- Checked only in headless Chromium. Not yet seen in Safari or Firefox, on a real phone, on paper, or with a real screen reader, and nobody has yet read it through by hand.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
