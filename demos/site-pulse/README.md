# Site Pulse

One dense, dark screen for someone who runs several small websites: visits, sources, speed, uptime and deploys for all of them at once. Demo 7 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**Every number on it is made up.** The site names are Kol's; the figures are sample data generated from a fixed seed. Nothing was measured and nothing is sent anywhere. The page says so at the top and at the bottom.

**Quality bar it sets:** a dashboard where every figure on the screen is the same slice of the same data, proved by working the figures out separately and reading them back off the page; charts that can all be read by keyboard and as tables; one hue for data, colour kept for trouble.
Use it as the reference for dashboards and charts.

## What is on the screen

- **One row of filters** above everything they change: 7, 30 or 90 days, and which sites to include.
- **Headline numbers**: visits (the one big figure), visitors, pages per visit, time on site, typical page load, uptime, each with its change on the period before.
- **Visits a day**: this period as a line over the period before, with a crosshair that reads both.
- **What stands out**: plain sentences, worst first (an outage, a slow site, a failed deploy, a site well up).
- **Every site**: a sortable table with state, visits, change, a small trend line, top source, load, uptime and the last deploy. Press a site's name to see only that site.
- **Where visits come from**, **when people visit** (a week of hours), **what they read on**, **most read pages**, **latest deploys**.

## How the charts were chosen

The charting rules used here are simple and are checked rather than judged by eye.

- The form follows the job: a big figure for the one number that matters, tiles for the rest, a line for change over time, ranked bars for sources, a grid for the week, a table when there are eight of something.
- One hue carries the data (green, darker for marks, brighter for emphasis). Grey is the period before. Red and amber mean trouble and nothing else, always with an icon and a word.
- No second axis, no pie, no rainbow. Text is never coloured to match a line.
- Both drawn charts have a table view, and both can be read with the arrow keys; the figure under the cursor is spoken.
- The greens were checked with a palette validator: the data green sits in the right lightness band for a dark surface, and the five shades of the week grid step evenly and stay visible.

## How it is put together

| File | Job |
|---|---|
| `js/data.js` | Makes 180 days of sample numbers for eight sites from a seed, and adds them up for any range and choice of sites. No drawing, no page. |
| `js/app.js` | Draws everything in plain SVG and HTML, and listens to the filters. No chart library. |

To point it at real numbers, replace `makeData()` with something that returns the same shape (per site, per day: visits, visitors, page views, time on site, load, minutes down, and the splits by source, device and hour). `summarise()` and the page need no change.

## Checks

```bash
node demos/site-pulse/tools/data.test.mjs
```

```bash
PW_CHROMIUM=/opt/pw-browsers/chromium node demos/site-pulse/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8774
```

The first checks that every view of the numbers agrees with every other. The second works the expected figures out in Node, then reads them off the page for twelve combinations of range and sites (serve the repo root first).

## Credit

The idea follows a post by Adam Holter about a personal dashboard for all his sites (x.com/AdamHoltererer/status/2121948560526897554). Nothing was copied from it.

## Status

Not published. The page carries `noindex`, is not in the demo gallery and is not in the sitemap. See `REVIEW.md` for what was checked and what was not.
