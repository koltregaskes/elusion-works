# Site Pulse: review

Demo 7 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876, checklist item D37).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to look at. Not published, not in the gallery, not in the sitemap. **Sample data only: every figure is made up.**

**Quality bar it sets:** a dashboard where every figure on the screen is the same slice of the same data, where the figures are worked out a second time from the raw numbers by separate code, and where the page is then read back against them; charts that can all be read by keyboard and as tables; one hue for data, colour kept for trouble.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A personal dashboard for several sites | Eight of Kol's sites on one screen: headline figures, a daily line, a table of every site, sources, a week of hours, devices, pages, deploys, and what stands out | `thumbnail.png`, `screenshot.jpg` |
| Dark and dense | Charcoal, 13 px type, one screen at 1440 by 900 for the top half and one scroll for the rest; a phone layout as well | `screenshot.jpg`, `phone.jpg` |
| Sample data only | Seeded made-up numbers; flagged in the header, footer, title and on every card and tile | `smoke.mjs` |

## Checks run (17 Nov 2026)

Verified by running, in Node and in headless Chromium 153.

- `node demos/site-pulse/tools/data.test.mjs`: pass.
  - The same seed gives the same numbers. Every day's parts (sources, devices, hours) add up to its visits.
  - For 3 ranges and 6 choices of site, every view agrees with every other; shown percentages add up to 100; notes run worst first.
  - Worked out again from the raw daily arrays, with separate code, for 9 slices: visits, the period before and its dates (same weekday), visitors, page views, time on site, uptime, typical load, every square of the week grid, each site's state, slowness and last deploy, and which notes must appear.
- `node demos/site-pulse/tools/smoke.mjs <axe.min.js>`: pass.
  - Twelve combinations of range and sites, including none: the headline, all six changes, six table columns, sources, devices, pages, notes in order, every day and all 168 hours through the table views, and the shade of every square.
  - Filters by click, arrow keys and touch; a site name that shows only that site; a range that is not offered is refused.
  - All eight sortable columns, both ways, against an order worked out in the test; ties run A to Z.
  - Both charts read by arrow keys with the figure spoken, and by pointer. Focus stays on a chart when the window changes size.
  - Every card and tile carries a sample-data mark at every size and in every state.
  - Phones at 400 by 800, 320 by 568 and 740 by 360, and a plain 320-pixel window: the page never scrolls sideways; wide tables scroll inside their own region.
  - With scripts off the page says why it is empty.
  - axe-core 4.14.0, WCAG 2.2 A and AA: 0 violations with charts and with tables, at four sizes. Zero console errors; no request leaves the page.
- Palette validator (the charting skill's script) on the card colour `#171a1d`: the data green `#2fa569` passes; the week grid's five shades pass as an ordered ramp.
- The repo's own overflow rule and axe at 320, 390 and 1280 px: clean.
- `python3 scripts/build-site.py`: pass with the demo present (49 indexable routes, unchanged).

## Not verified

- **Real numbers.** Nothing here was measured. The shape `makeData()` returns is what a real source would have to supply; no real source was connected.
- **Whether these are the figures Kol wants to see first.** The choice of what is on the screen is mine.
- **Safari and Firefox.** Only Chromium was run.
- **A real screen reader.** Announcements were checked as text in the page, not heard.
- **Kol's Taste Lab rating.**

## Known limits

- The comparison is always the same number of weeks immediately before. There is no custom date range.
- Hours are UTC, not the reader's own time.
- The week grid is shaded from the quietest hour to the busiest, not from zero, so that the pattern shows; the scale beside it gives both ends.
- "Daily visitors, summed" is not a count of different people. The sample has no way to know who came back.
- The status colours are the charting skill's fixed set and were not themed.

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

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 7 and checklist item D37.
- Method: the sample numbers and their sums first, tested in Node; chart forms and colours chosen by the charting skill's rules and validator; then the page; independent review by a second model; fixes with independent recomputation.
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
