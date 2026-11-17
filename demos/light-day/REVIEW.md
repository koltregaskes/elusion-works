# One light-day: review

Demo 9 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to look at. Not published, not in the gallery, not in the sitemap.

**Quality bar it sets:** a scrolling story in which every number on the screen comes from two constants and a list of distances, is worked out a second time by separate code, and is then read back off the page; the picture is checked ring by ring against the same arithmetic at every scroll position and in eleven window sizes.

One thing to know before sharing it: the date of the milestone, 18 November 2026, rests on press reports of NASA's statement. NASA's own pages could not be opened from the build session.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| Light-day scrollytelling, after NASA Solar System's post | A scroll-driven journey of a flash of light from Earth to Voyager 1, with a clock, twelve marks, and the last eighteen hours to scale | `thumbnail.png`, `screenshot.jpg`, `proof.jpg` |
| A light pulse from Earth to Voyager | A spreading ring and a line aimed at Voyager 1; the flash is exactly on each mark's ring when the clock reads that mark's time | `tools/smoke.mjs` |
| Original, crediting the source | Own words, own drawing, credit and link at the foot; says it is not made by or with NASA | `index.html` |
| House style | Big white headline on charcoal, one green accent | `thumbnail.png` |

## Checks run (17 Nov 2026)

Verified by running, in Node and in headless Chromium.

- `node demos/light-day/tools/journey.test.mjs`: pass.
  - A light-day is 25,902,068,371.2 km, 173.14 AU, from the two defined constants.
  - Each of the twelve marks: its distance and light-time from figures a reader can look up, and its time in words worked a second way by hand.
  - A card never reads later than the clock: times in words are cut short, not rounded up.
  - Each distance in AU carries no more figures than its source.
  - 38,720 scroll positions: time never runs backwards and never jumps. The same number of views: the picture only ever pulls back.
  - Each mark meets the flash exactly. The page is to scale after six hours. The picture holds until Pluto's distance and then pulls back, as the Pluto card says.
  - The closing figures: 49 years, about 17 km a second, about 17,600 times, about 48 years, about 1,550 days, 19 h 49 min after Neptune's orbit.
- `node demos/light-day/tools/smoke.mjs`: pass. Its expected figures are worked out inside the test from the constants, not read from the page's own module.
  - At all twelve marks: the flash on the ring to a hundredth of a pixel; clock, distance, time to go and day bar as arithmetic says; the card on screen saying a time no later than the clock; the mark named in the picture; the length of the line as stated.
  - 108 scroll positions top to bottom: every ring where arithmetic puts it, names inside the picture and clear of each other.
  - Jump links and the skip link land exactly on their marks.
  - The table (12 rows, 5 columns) and the six closing figures.
  - The day bar: a tick for each mark and the hour numbers where they fall.
  - Real speed: keeps time with the clock on the wall; one run when pressed twice; gives way to Stop, Escape, the wheel and the scroll bar; the focus always lands on something in view; the note fits a phone.
  - A change of window size, and a phone turned on its side, keep the flash where it was in time.
  - Eleven windows from 320 by 480 to 2560 by 1080, tablets upright and a 200% zoom included: all of the above, and the title never lies over the clock, the day bar or Earth while it scrolls away.
  - With motion kept down there is no real-speed button. With scripts off the cards and table read as an ordinary page.
  - axe WCAG 2.2 A and AA: no violations in any window or state tried. No console errors. No request leaves the page.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; Tab lands on visible things; `python3 scripts/build-site.py` passes.

## Not verified

- **The date and NASA's wording.** Confirmed by web search on 17 November 2026 through several press reports; NASA's own pages were blocked from the session.
- **Voyager 2's distance.** "About 145 AU" is my estimate for November 2026 from a February 2026 figure and its speed. It is marked "about" wherever it appears.
- Nobody has scrolled it by hand. Touch scrolling, a real phone's address bar, Safari and Firefox are untested.
- A real screen reader.
- Kol's Taste Lab rating.

## Known limits

- The picture is a diagram. Distances along the line are true; directions are not. The planets' rings are yardsticks drawn round Earth, named for the planet whose orbit is that far from the Sun.
- In small windows there is room for few names, so the picture names the mark just crossed and lets the others wait.
- Cards scroll over the clock on phones and short windows, as cards do.
- Real speed always starts from the beginning.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the code and the contract but not my conclusions) read everything, redid the arithmetic, and looked at the page in more than a dozen window sizes. Both of my test files passed at the time; it found 16 things.

| Finding | Severity | Status |
|---|---|---|
| Resizing the window, or turning a phone, threw the reader to a different time (10 h became 19 h 40 min) | Blocker | Fixed. The page keeps its place in time, not in pixels. Tested both ways |
| On phones and short windows the title scrolled up over the clock, the day bar and Earth | Blocker | Fixed. The clock and bar come in only once the title has cleared them; on phones the title is a panel; short wide windows get a two-column title. Tested at every 3% of the first screen and a half, in eleven windows |
| On tablets upright and at 200% zoom the picture never named the mark the flash was on | Should fix | Fixed. Tablets upright get the upright layout; where a ring has no room for its name, the mark is named beside Earth. Tested at every mark in every window |
| At 1366 by 600 Earth and the line sat on the day bar | Should fix | Fixed. The title no longer pushes Earth down, and the bar has its own backing |
| The card and the clock disagreed at a mark ("43 min 15 s" beside 00:43:14) | Should fix | Fixed. Times in words are cut short everywhere. Tested for every mark |
| Wording that said the flash passes the Moon and the planets | Should fix | Fixed. "As far out as"; ring names give the distance first ("5.2 AU · JUPITER"); the first card says the picture is a diagram and nothing is in its true direction |
| The page never said the first six hours are squeezed; the pull-back began before the card that announced it; no scale was shown | Should fix | Fixed. The Sun's card says it; the pull-back starts at Pluto's distance; the length of the line is written beside it |
| False precision in the table (94.0, 122.0, 145.0); Saturn and Mars a little off | Should fix | Fixed. Each distance as its source gives it; Mars 1.524 AU, Saturn 9.54 AU |
| "17,500 times" was rounded the wrong way | Should fix | Fixed: 17,600, with "roughly" |
| README: "every planet in the first sixth" (it is the first fifth); no review file; unstated needs of the commands | Should fix | Fixed |
| The real-speed note was crushed to five lines on a phone and covered the day bar on a desktop | Should fix | Fixed and tested |
| Real speed: the focus was lost or left out of sight when it stopped; pressing twice ran it twice | Should fix | Fixed and tested. Starting from the beginning is kept, and the button now says so |
| The hour numbers under the day bar were up to half an hour out | Minor | Fixed and tested |
| Names clashing in the picture in places | Minor | Partly. Voyager 1's name clears its drawing; fewer names carry times. Some crowding remains near Earth late in the day |
| With scripts off the words described a picture that was not there, with long gaps | Minor | Fixed. The cards become an ordinary page, the card about the picture is left out, and a line says why |
| The clock and distance disagreed for an instant at the very start; the 8 h card was a few seconds off on a phone | Minor | The second is fixed (the page settles on a card's time within a pixel of it). The first stands: the clock shows hundredths of a second and the distance is exact |

It confirmed as sound: every light-time, share and closing figure, recomputed; the cards' places on the page; the day bar's fill and ticks; jumps, back and forward, and reload; no sideways scroll; headings in order; no dashes; no console errors or outside requests. On the history, from its own knowledge: high confidence in the launch and fly-by dates, Io's volcanoes, the Titan swing-by, Voyager 2 at Uranus and Neptune, the termination shock and heliopause crossings, the speed and heading, the solar wind, and Proxima's distance; medium confidence in "the size of a small car" and in Voyager 2's distance. It could not verify the date either.

Found by my own checks on the way: a comment that swallowed half a line of script (caught by the syntax check); names running off the phone screen; a note riding up over the clock on phones.

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 9.
- Method: facts checked by web search first; the arithmetic as a module tested in Node; then the page; independent review by a second model; fixes, each with a check that would have caught it.
- Release steps when approved: check the date against NASA's own page, remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
