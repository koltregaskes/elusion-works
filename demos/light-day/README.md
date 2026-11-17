# One light-day

Scroll to send a flash of light from Earth to Voyager 1, one light-day away. It is as far out as the Moon in 1.28 seconds and as far out as Neptune in four hours. Then come twenty hours of almost nothing. Demo 9 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

After [a post by NASA Solar System](https://x.com/NASASolarSystem/status/2121282705736515837) about Voyager 1 reaching one light-day from Earth. This is an original page, not made by or with NASA.

**Quality bar it sets:** a scrolling story in which every number on the screen comes from two constants and a list of distances, is worked out a second time by separate code, and is then read back off the page; the picture is checked ring by ring against the same arithmetic at every scroll position.
Use it as the reference for scroll-driven explainers and for any page that states figures.

## What it does

- **The title card.** "One light-day", the date, and links to jump to any part of the journey.
- **The flash.** As you scroll, a green ring spreads out from Earth and a line runs towards Voyager 1. A clock shows how long the flash has been travelling, with its distance and the time still to go.
- **Twelve marks**, each with a card: the Moon, the Sun's distance, the distances of the orbits of Mars, Jupiter, Saturn, Uranus and Neptune, Pluto's distance, the termination shock, the heliopause, Voyager 2's distance, and Voyager 1. The flash does not pass the planets: their rings are yardsticks, and the page says so.
- **A diagram, not a map.** Every ring is a distance from Earth. The length of the whole line is written beside it, so the scale can be read at any moment.
- **Two scales, and it says which.** Up to six hours the page is squeezed, so each mark gets about a screen however long light takes to reach it (the Sun's card says so). After that the page is to scale: every hour of light-time is the same length of scrolling, and most of it is empty.
- **The day, to scale.** A bar shows the whole 24 hours with a tick for each mark. Every planet's orbit is in the first fifth.
- **Real speed.** A button lets the flash run as fast on the page as it does in space: the Moon's distance in 1.28 seconds, then an eight-minute wait for the Sun's.
- **The figures.** Six closing numbers, the whole journey as a table, and how each figure was worked out.

Without scripts the title, every card and the table can still be read as an ordinary page. A change of window size, or turning a phone, keeps the flash where it was in time. With "reduce motion" set, the real-speed button is not offered, because it scrolls the page by itself.

## How it is made

- `js/journey.js`: the constants, the marks, the scroll (which time goes with which place on the page) and the view (how much of space the picture shows). No drawing and no page, so it runs in Node.
- `js/app.js`: reads the scroll position, draws the picture on a canvas, updates the clock.
- `index.html`: all the words. The times on the cards and the rows of the table are written into the page, and the checks compare them with the arithmetic.
- No library, no outside request, nothing stored.

## Checks

From the site's root, with the site served on port 8776:

```bash
node demos/light-day/tools/journey.test.mjs
```

```bash
node demos/light-day/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8776
```

```bash
node demos/light-day/tools/shots.mjs http://127.0.0.1:8776 demos/light-day
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. `REVIEW.md` lists what each one proves and what nobody has checked.

## Where the figures come from, and how sure they are

- **Exact:** the speed of light (299,792.458 km a second) and the astronomical unit (149,597,870.7 km) are defined values. A light-day is therefore 25,902,068,371 km, or 173.14 AU. Every light-time is a distance divided by the speed of light.
- **Yardsticks:** the planets' average distances from the Sun (1.524, 5.2, 9.54, 19.2, 30.1 and 39.5 AU) and the Moon's average distance (384,400 km). The flash does not pass the planets; the page says so.
- **Times are cut short, not rounded up**, so a card never reads later than the clock beside it: 43 min 14 s for 2,594.8 seconds.
- **From NASA, as reported:** the date of the milestone (18 November 2026), Voyager 1's speed (about 3.6 AU a year, 35 degrees north of the plane of the planets), and its crossings of the termination shock (December 2004, 94 AU) and the heliopause (25 August 2012, about 122 AU). These were confirmed by web search on 17 November 2026. NASA's own pages could not be opened from the build session, so the wording was not checked against them directly.
- **Least certain:** Voyager 2's distance, "about 145 AU", is an estimate for November 2026 from a February 2026 figure and its speed. "The middle of the 2030s" for its own light-day follows from that.

## Honest limits

- The picture is a diagram. Distances along the line are true to the scale shown at that moment. Directions are not.
- Checked only in headless Chromium. Not yet seen in Safari or Firefox, on a real phone, or with a real screen reader, and nobody has scrolled it by hand.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
