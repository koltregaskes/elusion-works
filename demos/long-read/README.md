# The job that said nothing: a long-read template

An article page for Kol's Korner: a title card, chapters with a list that follows you down the page, notes beside the words, a short read that folds the piece into its first sentences, text sizes, a paper look and a print layout. The third of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**The article is sample text.** It was written to fill the template. Its example of nine quiet nights is invented, and the article says so.

**Quality bar it sets:** an article template whose reading aids are arithmetic checked against the words: the minutes are counted from the text, the bar and the part marked are held to the same sums at every stop down the page, and the short read is proved to be the first sentence of each paragraph with nothing lost.
Use it as the reference for articles, essays and anything meant to be read from top to bottom.

## What it does

- **A title card.** A big white headline on charcoal, a standfirst, and a drawing made in the page: seven bells, six ringing, one still.
- **How long, and how much is left.** The reading time is counted from the words at 230 a minute. A line along the top shows how far through you are, and the strip says how many minutes are left. On a phone the strip scrolls away with the page and only the line stays.
- **In this article.** A list of the six parts that marks the one whose heading has reached the top of the window. A link to a part takes the focus there too.
- **The short read.** One button folds every paragraph to its first sentence: about a minute in place of about four. Pictures, notes, the pull quote and the box of habits step aside. Pressed again, it all comes back, and you stay in the part you were in.
- **Notes.** A small numbered button in the text. On a wide screen the note sits beside its paragraph. On a narrow one it opens under the paragraph when its number is pressed, and shuts by Escape, by its Close button or by the number again. With scripts off the notes are at the end, with links there and back.
- **Text size.** Five steps, from seven eighths to one and a half. The notes, captions and list of parts grow with the words. Sizes and breakpoints are in rem and em, so the browser's own text size is respected too.
- **Paper.** Dark words on a pale page, for those who prefer it. Night is the default.
- **Copy link.** Each part's heading has a button that copies its address.
- **Print.** The whole article whatever was folded, notes at the end, black on white, in a column of readable width.
- Nothing is remembered: nothing is stored.

## How it is made

- `index.html`: every word, both drawings, the styles and the markup. The article is written so that each paragraph's first sentence carries its point: that is what makes the short read work, and it is a rule for anyone filling the template.
- `js/read.js`: counting words and minutes, the share read, minutes left, the part being read, the first sentence of a paragraph, text-size steps. No page, so it runs in Node.
- `js/app.js`: marks off each first sentence, places the notes, follows the reader, and works the controls.
- No library, no font or picture file, no outside request.

## Checks

From the site's root, with the site served on port 8782:

```bash
node demos/long-read/tools/read.test.mjs
```

```bash
node demos/long-read/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8782
```

```bash
node demos/long-read/tools/shots.mjs http://127.0.0.1:8782 demos/long-read
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- The article was written by the model that built the page. Nobody has edited it, and it is not Kol's writing.
- The look is the house style, not a copy of the live Kol's Korner site, which this session could not see.
- The body is set in whichever book serif the device has (Iowan, Palatino, Georgia). No font is loaded, so it will differ from device to device.
- The short read is only as good as the first sentences. The page cannot write them.
- In the short read the last parts can all be on the screen at once. The strip then says Finished, because the page can go no further.
- The drawing is line art made of a few shapes in the page. It is not illustration.
- Reading time is an average. Nobody reads at exactly 230 words a minute.
- Checked only in headless Chromium. Not yet seen in Safari or Firefox, on a real phone or on paper, and no screen reader has been heard on it.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published while this stays a draft. Merging it would put the page on the live site at its own address, unlisted but reachable by anyone with the link, because the site deploys whatever is merged.
