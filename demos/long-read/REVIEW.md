# The job that said nothing: review

Gap demo 3 of 7 on the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876): an editorial long-read, as an article template for Kol's Korner.
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to read. Not published, not in the gallery or the sitemap.

**The article is sample text written by the model, and it is not Kol's writing.** The look is the house style, not a copy of the live Kol's Korner site, which this session could not see. Nobody has read it on a phone or printed it.

**Quality bar it sets:** an article template whose reading aids are arithmetic checked against the words: the minutes are counted from the text, the bar and the part marked are held to the same sums at every stop down the page, and the short read is proved to be the first sentence of each paragraph with nothing lost.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| An editorial long-read | A sample article of 837 words in six parts, on a title card, with a standfirst, a drop cap, a pull quote, a chart, a box of points and three notes | `index.html` |
| Kol's Korner article template | Every word is in the page; the reading aids are built from whatever words are there | `js/app.js` |
| Kol's taste: title card, charcoal, white, one green; comic-book, not anime | A big white headline on charcoal, one green, a drawing in heavy ink lines made in the page | `thumbnail.png` |
| Own folder, own review, nothing live | `demos/long-read/`, this file, `noindex`, no gallery card, no sitemap entry | `index.html` |

## Checks run (17 Nov 2026)

Verified by running. All passed on the code as committed.

- `node demos/long-read/tools/read.test.mjs`: pass.
  - Words and minutes. The share read rises from nothing to all, never falls, and climbs to the end over the last windowful.
  - Minutes left count down; before the page is scrolled nothing is read. The part marked is the one whose heading has reached the top.
  - Ten first sentences, with quotes, figures, titles and abbreviations. Text sizes. Note numbers.
- `node demos/long-read/tools/smoke.mjs`: pass, in headless Chromium.
  - Scripts off: the article reads from top to bottom with both drawings, the list of parts and the notes at the end; note numbers go to their notes and back.
  - The short read is exactly the first sentence of each of 17 paragraphs, and folding changes no words, also when a first sentence holds a link or emphasis.
  - On a wide screen three notes sit beside their paragraphs, clear of the words and of one another; a number goes to its note and the note goes back.
  - At every stop down the page the bar, the minutes left and the part marked agree with the arithmetic. A link to a part lands clear of the strip. Focus on a button in the strip does not move the page.
  - Folding and unfolding keep your place. Five text sizes reach the notes, the caption and the list of parts. Paper look. Copy link copies exactly, and says so again when pressed again.
  - Print: the whole article in black on white, in a readable column, notes at the end; asked to print from the short read, it unfolds first.
  - Phones 390x800, 320x568 and 740x360: the strip scrolls away and the line of progress stays; a note opens under its paragraph and shuts by Escape, its button or its number.
  - A browser really set to a text size twice as large, on a wide window: one column, words at full width.
  - Forced colours: the bar shows, a pressed button is ringed, the drawings take the reader's colours, the quiet nights are dashed.
  - axe WCAG 2.2 A and AA in both looks, in the short read, at large text, with a note open and with scripts off. No console errors, no outside requests.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; axe clean; the first three Tabs land on visible things; `python3 scripts/build-site.py` passes.

## Not verified

1. **The writing.** Nobody has edited it. The reviewer checked its three notes against what it knows of the sources; no source was opened in this session.
2. **The look**, judged by a person. The reviewer called the first version a competent generic tech blog; the headline, the drawing and the note numbers were changed, and nobody has judged the result.
3. **A screen reader.** What is said when the focus lands on a note is unheard.
4. A real phone, Safari and Firefox, and paper.

## Known limits

- No font is loaded. The body is whichever book serif the device has.
- The drawing is line art made of a few shapes, not illustration.
- In the short read the last parts can all be on screen at once; the strip then says Finished.
- The short read is only as good as the first sentences the writer gives it.
- After Back to the top, the focus stays where it was.

## Independent review

A second pass by a separate Claude agent (Opus), read-only, given the brief and not the author's conclusions. It read the article as an editor and drove the page at eight sizes, in print and in forced colours. 19 findings: 1 blocker, 13 should-fix, 5 minor.

| # | Finding | What was done | Held by |
|---|---|---|---|
| 1 | Blocker. On small screens the top strip took up to 59% of the screen and hid headings and focus | On a narrow screen the strip scrolls away; only the line of progress stays. On a wide one the strip's real height is measured for what links go to | browser check on three phones |
| 2 | With the browser's text size raised, the wide layout squeezed the words to 15 characters a line | Breakpoints are in em | browser check with a browser set to 32 px text |
| 3 | Forced colours: pressed buttons looked unpressed; the drawings kept the page's colours and the chart read the wrong way round | A pressed button is ringed; drawings take system colours; quiet nights are dashed | browser check |
| 4 | The strip said Finished when the reader was not, on tall windows and after folding | The share climbs to the end over the last windowful; nothing counts as read before the page is scrolled. After folding it can still say Finished: a known limit | reader test; browser check at 1600x2400 |
| 5 | The wrong part was marked, especially in the short read | The part marked is the one whose heading has reached the top of the window | reader test; browser check at every stop |
| 6 | The short read did not make sense on its own | Three first sentences rewritten so that each carries its paragraph | by reading |
| 7 | Folding scrambled the words if a first sentence held a link or emphasis | Whole elements go with the sentence they are in | browser check |
| 8 | Headings were named "01 The dog in the night Copy link to…", and each part was a landmark with that name | The number is decoration, the button comes after the heading, parts are not landmarks, notes are not named twice | browser check |
| 9 | Notes: no Escape, no close button, focus lost on resize, no way back from the margin | Escape, a button in the note and the number all shut it; focus goes back to the number | browser check |
| 10 | Text size enlarged only the body | Notes, captions and the list of parts grow too | browser check |
| 11 | The chart's labels were 4 px on a phone | The key is words beneath the drawing | by looking |
| 12 | The look: letters of the headline ran together; thin icon bells that touched, with crossed sound lines; a 50 px drawing on a phone; big green note numbers | Looser headline; heavier bells that do not meet, the still one in the middle with clear air round it; a fixed-height drawing on phones; outlined note numbers | by looking; not judged by a person |
| 13 | Facts and editing: "oldest lesson"; where the dog exchange comes; "any other number means an error"; the standfirst repeated; the pull quote above its own sentence; "nought"; lazy phrases | Each corrected or rewritten | by reading |
| 14 | Print: lines the full width of the sheet; printing from the short read | A readable column; the page unfolds before printing | browser check |
| 15 | README named a REVIEW.md that did not exist and left out the box of habits | This file; corrected | |
| 16 | A note number could start a line, cut off from its word | It is joined to the word before | by looking |
| 17 | Links to the notes at the end went nowhere with scripts on | They go to the note beside the words | browser check |
| 18 | With scripts off the strip on a phone was a tall empty bar | It is as tall as its words | by looking |
| 19 | Smaller: the copy fallback wording; a repeat not announced; no words on the progress bar; the drop cap's baseline; two close notes would overlap | Reworded; a repeat is announced; the bar says the minutes left; adjusted; close notes are moved apart | browser check for the repeat and the overlap |

One thing found by the author while writing the checks: the page had padding at its top to keep headings clear of the strip, and that padding made the browser scroll the page whenever a button in the strip took the focus. The clearance is now set on the headings. The same fault was in the handbook demo and was fixed there too.

## Outside review

A second, outside review was posted on the pull requests on 17 November 2026: ChatGPT in chat mode at Pro, driven by another Claude session at Kol's request. It covered this demo with the handbook and the briefing, read the code and pictures, and did not run the page. It scored the three 7 out of 10 as a set and said of this one: merge after fixes.

| Finding | What was done | Held by |
|---|---|---|
| The short read could cut ordinary text short. The first sentence was measured on text with its spaces tidied, then cut out of the page's own text, so "Alpha   beta. Gamma." became "Alpha   bet". The sample hid it, because it is written with single spaces | The cut is made where the sentence ends in the page's own text, however it is spaced | rules test, seven spacings; browser check |
| A sentence that ends inside emphasis or a link was not cut there | The emphasis or link is cut in two at the sentence's end. A note's number or any other control is never cut. Every character stays in its place | browser check, four cases |
| On a phone a note opened near the foot of the screen could open out of sight | An opened note is brought into sight with its Close button; closing it leaves you at its number | browser check on all three notes |
| A link written in a note was turned to plain text | A note's words go in as they are | browser check |
| The demo's own tests do not run in the repo's CI | Not done here: CI is shared by the whole site, and changing it is outside this demo's folder | |
| No reference comparison, real phone, screen reader or print on paper | Still true. Listed under Not verified | |
| "Unlisted" pages become reachable once merged, because the site deploys its main branch | The README now says so | |

### Second-family review, 20 November 2026

Codex, a model from a different family, read the code, tests and CI results on 19 November (relayed onto the pull request by another Claude session) and said to keep this in draft. Its test reviewer found one more fault.

| Finding | What was done | Held by |
|---|---|---|
| The short read did not end a sentence when the next one began with a figure: "The job stopped. 3 retries followed." stayed whole | True. A stop before a figure now ends the sentence, unless the word before is one written before a figure (No. 3, fig. 2, p. 12, vol. 4). A figure with a stop inside it (3.5, 2.10) is still one figure | `read.test.mjs`: ten cases written out by hand, in the rule and in the page's own text |
| The folding check let a button vanish (it only asked for one or none) and did not look at links or ids | True. Each case now says exactly how many buttons and links must be left, where each link goes, and which ids there are. With the paragraph in the page, every link and button must still take the keyboard's focus | `smoke.mjs`, eight cases |
| Nobody has edited the article, checked a linked note at large text on a real phone, printed it or used a screen reader | Still true | Kol |

## Provenance

- No library, no font, picture or data file. Both drawings are shapes in the page.
- The article is original sample text. It refers to Arthur Conan Doyle's "Silver Blaze" and quotes one nine-word phrase from it.
