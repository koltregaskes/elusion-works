# Site Pulse: review

Demo 7 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876, checklist item D37).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to look at. An unlisted draft: `noindex`, not in the gallery, not in the sitemap. Merging would still put it on the live site at its own address, reachable by anyone with the link. **Sample data only: every figure is made up.**

**Quality bar it sets:** a dashboard where every figure on the screen is the same slice of the same data, where the figures are worked out a second time from the raw numbers by separate code, and where the page is then read back against them; charts that can all be read by keyboard and as tables; one hue for data, colour kept for trouble.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A personal dashboard for several sites | Eight of Kol's sites on one screen: headline figures, a daily line, a table of every site, sources, a week of hours, devices, pages, deploys, and what stands out | `thumbnail.png`, `screenshot.jpg` |
| Dark and dense | Charcoal, 13 px type, one screen at 1440 by 900 for the top half and one scroll for the rest; a phone layout as well | `screenshot.jpg`, `phone.jpg` |
| Sample data only | Seeded made-up numbers; flagged in the header, footer, title and on every card and tile | `smoke.mjs` |

## Checks run (17 Nov 2026)

Verified by running, in Node and in headless Chromium 153. Run again on the final code after the outside review below; the results are the same as listed here, with the additions marked.

- `node demos/site-pulse/tools/data.test.mjs`: pass.
  - The same seed gives the same numbers. Every day's parts (sources, devices, hours) add up to its visits.
  - For 3 ranges and 6 choices of site, every view agrees with every other; shown percentages add up to 100; notes run worst first.
  - Worked out again from the raw daily arrays, with separate code, for 9 slices: visits, the period before and its dates (same weekday), visitors, page views, time on site, uptime, typical load, every square of the week grid, each site's state, slowness and last deploy, and which notes must appear.
  - Added after the outside review: every failed deploy in the period is counted in the notes, site by site. The same data with its first 98 days cut off gives the same figures for 1 and 4 weeks and refuses 13 weeks, so the code does not assume 182 days.
- `node demos/site-pulse/tools/smoke.mjs <axe.min.js>`: pass.
  - Twelve combinations of range and sites, including none: the headline, all six changes, six table columns, sources, devices, pages, notes in order, every day and all 168 hours through the table views, and the shade of every square.
  - Filters by click, arrow keys and touch; a site name that shows only that site; a range that is not offered is refused.
  - All eight sortable columns, both ways, against an order worked out in the test; ties run A to Z.
  - Both charts read by arrow keys with the figure spoken, and by pointer. Focus stays on a chart when the window changes size.
  - Added after the outside review: the reading of each chart is in a line under it, by keys, pointer, click and tap; Escape (wherever the focus is) and a press or tap elsewhere put it away. A bar's tip shows on focus even when focusing scrolls the page, touches its bar, stays while the pointer is on it, and Escape puts it away. With 13 weeks of all sites, all 14 notes are one press away and the failed deploys they count match the raw sample; the deploys card says it shows 8 of how many. At 390 by 800 with touch, the worst note is on the opening screen, a tap reads a day, an hour or a bar, and a finger dragged up a chart still scrolls the page (touch is simulated in Chromium, not a real phone).
  - Every card and tile carries a sample-data mark at every size and in every state.
  - Phones at 400 by 800, 320 by 568 and 740 by 360, and a plain 320-pixel window: the page never scrolls sideways; wide tables scroll inside their own region.
  - With scripts off the page says why it is empty.
  - axe-core 4.14.0, WCAG 2.2 A and AA: 0 violations with charts and with tables, at five sizes, with every note shown and after tapping. Zero console errors; no request leaves the page.
- Palette validator (the charting skill's script) on the card colour `#171a1d`: the data green `#2fa569` passes; the week grid's five shades pass as an ordered ramp.
- The repo's own overflow rule and axe at 320, 390 and 1280 px: clean.
- `python3 scripts/build-site.py`: pass with the demo present (49 indexable routes, unchanged).

## Not verified

- **Real numbers.** Nothing here was measured. The shape `makeData()` returns is what a real source would have to supply; no real source was connected.
- **Whether these are the figures Kol wants to see first.** The choice of what is on the screen is mine.
- **Safari and Firefox.** Only Chromium was run.
- **A real screen reader.** Announcements were checked as text in the page, not heard.
- **Kol's Taste Lab rating.**
- **Real phones and real touch.** Touch was simulated in headless Chromium. No phone was held, and the page was not loaded over a mobile network, so there are no load times.
- **200% zoom in a browser.** Not tried as such. The page was checked at 320 pixels wide, which is what 400% zoom of a 1280-pixel window gives, and nothing ran off the side.
- **A side-by-side with the post it follows.** The credited post was not compared with the page.
- **The site's automatic checks.** They run the repo's shared rules but not this demo's own two test files; those were run by hand, here.

## Known limits

- The comparison is always the same number of weeks immediately before. There is no custom date range.
- Hours are UTC, not the reader's own time.
- The week grid is shaded from the quietest hour to the busiest, not from zero, so that the pattern shows; the scale beside it gives both ends.
- "Daily visitors, summed" is not a count of different people. The sample has no way to know who came back.
- The status colours are the charting skill's fixed set and were not themed.
- On a phone the table of sites still scrolls sideways: load, uptime and last deploy are off to the right. The site's own row is one press of its name away, which narrows every card to that site, but there is no phone layout for the table.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the code and the contract but not my conclusions) read the source, recomputed figures from the raw arrays with its own code, ran the palette validator, and probed the page at eight sizes. Both of my test files passed at the time; it found 24 things. All are dealt with.

| Finding | Severity | Status |
|---|---|---|
| The week grid added up five Mondays and four Tuesdays, so it showed the wrong busiest days | High, confirmed | Fixed. Ranges are whole weeks, the grid shows averages, and both are checked from the raw arrays |
| No single card or tile said its figures were samples | High, confirmed | Fixed. Every card and tile carries the mark; the title does too. Tested at every size and state |
| "Had an outage" meant uptime under 99.9%, so real outages showed as Healthy | Medium, confirmed | Fixed. Any downtime in the period is an outage. The test that guarded the old rule is replaced |
| An outage hid slowness | Medium, confirmed | Fixed. A site can be both, and both show |
| "Worst first" was not true | Medium, confirmed | Fixed. Notes are sorted by level. Tested |
| The last-deploy column ignored the range and contradicted the cards beside it; a failed deploy was amber in one place and red in another | Medium, confirmed | Fixed. It is the last deploy in the period; a failed deploy is a warning everywhere |
| Focus was lost when the charts redrew on a change of window size | Medium, confirmed | Fixed. Tested for both charts |
| With no sites chosen the page showed 100% uptime and a 0.00 s load for nothing | Medium, confirmed | Fixed. Those tiles show a dash and the scale is hidden |
| The tests did not prove what they claimed: the page was compared with the same code that fed it, and nothing recomputed a figure | Medium, confirmed | Fixed. `data.test.mjs` now recomputes from the raw arrays; `smoke.mjs` says what it does and does not prove, and tests every column and every change |
| The README pointed at a review file that did not exist | Low to medium, confirmed | This file |
| The palette claim was only partly true: the brighter green fails the validator and was used for marks | Low to medium, confirmed | Fixed. Marks at rest use the green that passes; the claim is narrowed to what was run |
| Shares on screen added up to 98 to 102% | Low, confirmed | Fixed. Shared out to add up to 100. Tested |
| Meters: an uptime bar starting at 99% without saying so, tracks that read as full bars, a stub drawn for zero | Low | Fixed. The uptime bar is gone (the figure is enough); device meters have a dark track; zero draws nothing |
| Sparklines in the comparison grey, thinner than the rule, with false flat steps over a week | Low, confirmed | Fixed |
| The sample tag used the warning colour; ties sorted Z to A when descending; a bad range left the page out of step; the table buttons changed name and state together; hours not labelled UTC; "Visitors" and "typical load" implied more than the sums gave; comparison periods out of step by weekday; an empty page with scripts off; no hint that the table scrolls on a phone; the first arrow press skipped Monday | Low | All fixed |

It confirmed as sound: the period boundaries and the comparison, recomputed by date; the uptime figure; identical output on two loads; no `innerHTML`, clock or random numbers in the page; no console errors or outside requests; the filters as a radio group and toggle buttons; sort state announced and focus kept after a sort; text contrast including the small grey; no sideways scroll at eight sizes; 200 fast clicks; the line chart's marks; values available outside tooltips.

Found by my own checks on the way: the quietest hour drawn as empty; a hidden label inside a wide table that widened the page at 320 pixels (caught by the repo's rule, not by my phone test); a headline tile that did not wrap.

## Outside review

ChatGPT (chat mode, Pro) reviewed the branch at `c129990` on 17 November 2026, driven by another Claude session at Kol's request. It read the code and the pictures but did not run the page. It scored it 7.5 out of 10 and said HOLD. Each finding was then checked here by running the page or reading the code, and fixed where it was true and could be done and checked on this machine.

| Finding | What was done | Held by |
|---|---|---|
| Tooltips cannot be hovered (`pointer-events:none`, they trail the pointer) | True. The two charts no longer put a box over themselves: the reading is a line of text under each chart, so there is nothing to chase or hover. The bar tips now sit against their bar, touching it, accept the pointer and stay while it is on them | `smoke.mjs`: pointer moved onto a bar tip in 12 steps, tip still shown and under the pointer; charts never show the box |
| Escape does not dismiss the source and device tips; chart Escape needs the chart to have focus | True (seen in a browser: Escape left both a focused bar's tip and a hovered chart's reading up). Escape now puts every reading away wherever the focus is | `smoke.mjs`: Escape with focus on a bar, with focus elsewhere after hovering a bar, and after hovering the line chart |
| No tap handler on the charts; mobile tests only tap the filters | True. A tap (or click) on a day or an hour reads it, writes it under the chart and speaks it; a tap elsewhere or Escape puts it away. A finger moving over a chart is left to scroll the page | `smoke.mjs` at 390 by 800 with simulated touch: taps on a day, an hour and a bar; a tap elsewhere; a finger dragged up the chart scrolls the page and leaves no reading |
| The demo's own test files are not run by the site's automatic checks | True. Not changed: the workflows are outside this demo's folder and are Kol's to change. Both files were run on the final code; results under "Checks run" | Not held by CI. Noted under "Not verified" and in the README |
| No reference comparison, real-device evidence, 200% zoom, screen-reader check or three cold 4G loads | True that none was done. Not done: they need a real phone, a real network, a person listening, or the credited post, none of which can be used here | "Not verified" |
| On a phone the opening screen does not show the most serious issue | True: at 390 by 800, "What stands out" came after the headline numbers and the whole chart. Once the cards stack (1100 pixels and under), it now comes first, above the headline numbers. Wide screens are unchanged | `smoke.mjs`: at 390 by 800 the first note ends inside the opening screen and is the outage; at 1440 the card is still beside the chart. `phone.jpg` |
| On a phone, load, uptime and deploy sit far right in a wide table | True. Not done: a phone layout for the table is a design change for Kol to choose. Recorded under "Known limits" | None |
| The notes silently stop at seven, and failed-deploy notes at three | True. At 4 weeks one failed deploy had no note; at 13 weeks 14 notes were cut to 7 and 14 failed deploys to 3 notes. Failed deploys are now one note per site with a count, so none is dropped; the card says "7 of 14 shown" and one button shows all. The deploys card also showed 8 of 134 without saying so; it now says so | `data.test.mjs` counts failed deploys site by site from the raw sample; `smoke.mjs` reads all 14 notes and the deploys card's count |
| Release steps describe promotion, not an unlisted merge | True. The steps below now separate the two | This file and the README's Status |
| The README's claim that `makeData()` can be swapped with no other change is too broad (182 days and the year 2026 are built in) | True: `summarise()` counted from a fixed 182 and the page printed 2026 whatever the dates. `summarise()` now works from the days it is given and refuses a range it cannot compare; the year comes from the dates. The README now states only the tested contract and says no real source was tried | `data.test.mjs`: the sample cut to 84 days gives the same figures and refuses 13 weeks |
| Make "What stands out" an investigation tool | A suggestion, not a fault. Not done: a new feature for Kol to decide on | None |
| No dedicated sharing metadata | True. Not added on purpose: the page is unlisted and `noindex`, and sharing tags belong with listing it | None |

Found while doing this, not raised by the review: focusing a source or device bar that was off the screen scrolled the page, and the scroll hid the tip at once, so a keyboard user saw nothing (the old test read the tip's text without checking it was shown). Fixed and tested. The picture script hovered five pixels above the chart, so `proof.jpg` never showed a reading; fixed and the pictures taken again.

### Second-family review, 20 November 2026

Codex, a model from a different family, read the code, tests and CI results on 19 November (relayed onto the pull request by another Claude session) and said to keep this in draft. It did not run the page.

| Finding | What was done | Held by |
|---|---|---|
| "Typical page load" was described as what half of all visits waited. The sum is the middle of the daily load readings, weighted by visits, and one reading a day cannot say what single visits met | True. The README, the code's own note and the "is slow" line on the page now say what the figure is and no more | By reading; the data and browser checks still agree with the page |
| On a phone the table still puts load, uptime and the last deploy across a sideways scroll | Still true. A phone layout for the table is a design decision. Listed under Known limits | Kol |
| Nobody has used it with a screen reader or on a real phone | Still true | Kol |

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 7 and checklist item D37.
- Method: the sample numbers and their sums first, tested in Node; chart forms and colours chosen by the charting skill's rules and validator; then the page; independent review by a second model; fixes with independent recomputation.
- Merging as it is: the page goes live at its own address, unlisted (`noindex`, no gallery card, no sitemap entry) but open to anyone with the link. Keep those three exclusions in place for this step.
- Listing it later, only when Kol asks for that separately: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, and add a Typefully draft.
