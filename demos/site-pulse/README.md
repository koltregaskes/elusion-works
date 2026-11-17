# Site Pulse

One dense, dark screen for someone who runs several small websites: visits, sources, speed, uptime and deploys for all of them at once. Demo 7 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**Every number on it is made up.** The site names are Kol's; the figures are sample data generated from a fixed seed. Nothing was measured and nothing is sent anywhere. The page says so at the top, at the bottom, in its title, and on every card and tile, so a cropped screenshot still says it.

**Quality bar it sets:** a dashboard where every figure on the screen is the same slice of the same data, where the figures are worked out a second time from the raw numbers by separate code, and where the page is then read back against them; charts that can all be read by keyboard and as tables; one hue for data, colour kept for trouble.
Use it as the reference for dashboards and charts.

## What is on the screen

- **One row of filters** above everything they change: 1, 4 or 13 weeks, and which sites to include. Whole weeks only, so every weekday is counted equally and each period lines up, day for day, with the one before.
- **Headline numbers**: visits (the one big figure), daily visitors summed, pages per visit, time on site, typical page load, uptime, each with its change on the period before.
- **Visits a day**: this period as a line over the period before, with a crosshair that reads both. The figures for the day being read are written in a line under the chart.
- **What stands out**: plain sentences, worst first (an outage, a slow site, failed deploys, a site well up). The first seven show; if there are more, the card says how many and one press shows them all. Failed deploys are one note per site with their count, so none is left out. On a phone or any narrow window this card comes first, above the headline numbers.
- **Every site**: a sortable table with state, visits, change, a small trend line, top source, load, uptime and the last deploy. Press a site's name to see only that site.
- **Where visits come from**, **when people visit** (a week of hours), **what they read on**, **most read pages**, **latest deploys**.

## What the figures mean

- **Daily visitors, summed** adds up each day's visitors. Someone who comes on three days counts three times; it is not a count of different people.
- **Typical page load** is the load a typical visit met: half the visits in the period waited that long or less.
- **Had an outage** means any downtime at all in the period. **Slow** means a typical load over 2.5 seconds. A site can be both, and the page shows both.
- **Last deploy** is the last one inside the period, so it agrees with the list of deploys beside it.
- **When people visit** shows the average number of visits in each hour of each weekday. Hours are UTC.
- **Percentages** are whole numbers shared out so that each set adds up to 100.

## How the charts were chosen

The charting rules used here are simple and are checked rather than judged by eye.

- The form follows the job: a big figure for the one number that matters, tiles for the rest, a line for change over time, ranked bars for sources, a grid for the week, a table when there are eight of something.
- One hue carries the data (green, darker for marks, brighter for emphasis). Grey is the period before. Red and amber mean trouble and nothing else, always with an icon and a word.
- No second axis, no pie, no rainbow. Text is never coloured to match a line.
- Both drawn charts have a table view, and both can be read with the arrow keys, the pointer or a tap. The reading goes in a line under the chart, not in a box over it, so nothing is covered; readings made by the keys or a tap are also spoken. Escape, or a press or tap anywhere else, puts a reading away. The bars for sources and devices show a small box with their figures; it sits against its bar, stays while the pointer is on it, and Escape puts it away.
- The greens were checked with a palette validator on the card colour. The green used for lines, bars and meters passes its checks for a dark surface. The five shades of the week grid pass as an ordered ramp: one hue, each step visibly lighter than the last, the darkest still clear of the background. A brighter green is kept for the bar under the pointer and for good news in text; it is not used for marks at rest.

## How it is put together

| File | Job |
|---|---|
| `js/data.js` | Makes 182 days of sample numbers for eight sites from a seed, and adds them up for any range and choice of sites. No drawing, no page. |
| `js/app.js` | Draws everything in plain SVG and HTML, and listens to the filters. No chart library. |

No real data source is connected, and none should be for this demo. For the record, the contract the code supports: `summarise()` takes data of the same shape `makeData()` returns (a list of days one after another, ending on the last full day; per site, per day: visits, visitors, page views, time on site, load, minutes down, and the splits by source, device and hour; and a list of deploys). It works from the number of days it is given, which must be at least twice the longest range offered (26 weeks for the 13-week view), and the page takes the year from the dates. That much is tested with the sample cut short. It has not been tried with any real numbers, and real sources would need more (time zones, missing days, sites added part way through), which this code does not handle.

## Checks

```bash
node demos/site-pulse/tools/data.test.mjs
```

```bash
PW_CHROMIUM=/opt/pw-browsers/chromium node demos/site-pulse/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8774
```

The first checks that every view of the numbers agrees with every other, and then works the main figures out again from the raw daily arrays with separate code (totals, the period before, uptime, typical load, the week grid, each site's state and last deploy, and that every failed deploy is counted in the notes). The second reads every figure off the page for twelve combinations of range and sites and compares it with `summarise()`, and works the controls, the charts and the tips by keyboard, mouse and (simulated) touch (serve the repo root first). Between them: the first shows the sums are right, the second shows the page prints them.

The site's automatic checks on GitHub do not run either of these; they are run by hand.

## Credit

The idea follows a post by Adam Holter about a personal dashboard for all his sites (x.com/AdamHoltererer/status/2121948560526897554). Nothing was copied from it.

## Status

**Unlisted draft.** The page carries `noindex`, is not in the demo gallery and is not in the sitemap, and should stay that way until Kol decides otherwise.

Merging this branch would put the page on the live site at its own address (`/demos/site-pulse/`), because the site deploys whatever is merged. It would be unlisted, but anyone with the link could open it. Listing it in the gallery is a separate, later step; see `REVIEW.md`.

See `REVIEW.md` for what was checked and what was not.
