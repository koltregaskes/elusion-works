# Snapshot Circuit: review

Demo 4 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876, checklist item D09).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

A draft for Kol to try. Unlisted (not in the gallery, not in the sitemap, marked `noindex`). An outside review found real faults in getting back on the road and in loading the photograph; those are fixed and tested (see Outside review). It is not yet a visual reference: the karts are simple block models and nobody has played it.

**Quality bar it sets:** a game whose level comes from the player's own picture, with rules that are proved by running hundreds of races without a screen, and a page that says truthfully what it found in the photograph.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| One photograph becomes a kart track | The photograph is the ground; the circuit is drawn round the group of objects found in it | `proof.jpg` |
| In-shot objects as hazards | Objects stand up, cut out of the picture, solid, beside the road | `thumbnail.png`, `sim.test.mjs` |
| In-shot objects as pick-ups | Small objects become boosts; where a picture has none, boosts take the picture's own colours | `sim.test.mjs` |
| A fixed test image yields a closed drivable track | The sample gives 360 road points, 252 units a lap, inside the picture, nothing blocking it | `sim.test.mjs` |
| At least five landmarks map from the photo into the game | The five caps are found within 3% of their measured positions; four stand as hazards exactly where they lie, the fifth (hard against the edge) is left flat and the page says so | `smoke.mjs` |
| Collision, lap checkpoints and restart work | Square hits stop you, glancing ones slide; checkpoints count only in order and going forward; race again, leave race, back on road | Both test files |
| Works with your own photo | Any picture the browser can read; read in the page, never sent | `smoke.mjs` |
| A GameTrackDaily mini-game | Self-contained folder, no dependencies beyond the shared Three.js copy | Source |

## Checks run (17 Nov 2026)

Verified by running, in Node and in headless Chromium 153.

- `node demos/snapshot-circuit/tools/sim.test.mjs`: pass (21 s).
  - The sample circuit and a full three-lap race, run twice with identical results.
  - 660 made-up pictures in six shapes (16:9, 2:1, 3:2, square, 5:8, 3:5): every road is closed, inside the picture, free of kinks and crossings, with nothing solid in it; all three karts finish every race; no kart is ever inside an object; 0 rescues needed.
  - Rules: no moving before the start; a parked kart earns no lap; five minutes of driving the whole circuit backwards earns no lap; a head-on hit stops the kart at the object.
  - Back on the road (R): held for a minute (four ways, with and without the accelerator) it passes no checkpoint and earns no lap; pressed just before each of the 24 checkpoints of a race it counts nothing itself, and the race still gives exactly three lap events and one finish event that the page can see; pressed after the finish it finishes nothing again.
  - A kart that has finished brakes to a stop, never reverses, and never drives off again.
  - The detector on real pixels in awkward shapes: nothing throws; flat and empty pictures claim no objects; one clear object is kept.
- `node demos/snapshot-circuit/tools/smoke.mjs <axe.min.js>`: pass.
  - The sample: five objects found where they are; the start card lists them.
  - Keyboard: start, countdown, drive, pause, hit an object, back on road, view, sound; shortcuts after a mouse click; looking away pauses; Leave race.
  - A whole race to the result card; the record is kept. A second race with R pressed every second and a half all the way round still finishes, and the result card opens exactly once. 400 presses of R with no accelerator earn no lap and open no result card.
  - Loading: while the sample photograph is still arriving, Start is switched off and pressing it or Enter does nothing (no errors); when the sample cannot be loaded the card says so, offers "Try the sample again" and your own photo, and a retry gives a race that finishes; 21 photo swaps in a row leave the graphics memory count (textures and geometries) exactly where it was after the first.
  - Own photo: objects found where drawn; raced to the finish; no request made; a text file refused in plain words; a blank picture gives a plain loop and says so; 4000 by 300, 300 by 4000 and 2000 by 400 pictures are cut to their middle, the page says so, and each is raced to the finish.
  - Reduced motion starts in the steady view from above.
  - Phones at 400 by 800, 320 by 568 and 740 by 360: Start in reach without scrolling, pads steer and brake, the kart drives itself forward, a race finishes, nothing off screen and nothing overlapping.
  - axe-core 4.14.0, WCAG 2.2 A and AA: 0 violations on start, race and finish at four sizes.
  - Zero console errors, warnings or failed requests; no request leaves the page.
- The repo's own overflow rule and axe at 320, 390 and 1280 px: clean.
- `python3 scripts/build-site.py`: pass with the demo present (49 indexable routes, unchanged).

## Not verified

- **How it feels to drive.** Every race in the tests is driven by the autopilot or by scripted keys. Nobody has played it. Handling, difficulty and whether the rivals are fun to race need Kol.
- **Real photographs.** One real photograph (the sample) and drawn test pictures were used. No phone photos, no HEIC files, nothing with faces or clutter. The detector is simple colour grouping: on a busy real photo it may pick odd things. The page shows what it picked before you race.
- **Frame rate.** Only software rendering in a container was run. Real GPUs and phones are unmeasured.
- **The look.** The charcoal haze at the horizon and the soft shadow under each kart were judged only from software-rendered screenshots, not on a real screen.
- **Sound.** Synthesised and never listened to.
- **Safari and Firefox.** Only Chromium was run.
- **The sample photograph is a stand-in whose terms of reuse are not settled.** The only evidence checked is an archive page's statement, repeated by a mirror, that Kodak released the suite for unrestricted use; neither is Kodak's own statement. The page's credit line now says it is a stand-in to be replaced, not that it is free to use. It must be replaced with Kol's own photograph before the page is merged or made public. See the README.
- **Kol's Taste Lab rating.**

## Known limits

- Solid objects always stand beside the road, never in it. An object with no room beside the road (hard against the picture's edge, or boxed in) is left flat and is not solid; the start card says which.
- Very wide or tall pictures are cut to their middle (no wider than 2 to 1, no taller than 5 to 3).
- Objects are found by colour and contrast, not by recognising what they are, so they are named by colour ("Yellow object").
- The record time is kept for the sample photograph only.
- Back on the road puts you on the centre of the road at the point the race already has you, standing still. It never moves you further round.
- Single-letter shortcuts (C, M, P, R and W A S D) cannot be switched off or changed. See Outside review.
- Without WebGL the page shows a notice only; there is no 2D version.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the code and the contract but not my conclusions) read the source and wrote its own probes: 600 random layouts, 300 synthetic photographs, adversarial driving, and browser runs. Both of my test files passed at the time; it still found 12 defects. All are fixed, each with a check.

| Finding | Severity | Status |
|---|---|---|
| A 4000 by 300 picture was refused as "not a picture" (a divide by nothing in the detector) | High, confirmed | Fixed. Tested in Node and in the browser |
| Pictures about 3 to 1 and wider gave a race nobody could finish, with no way to leave it | High, confirmed | Fixed. Wide and tall pictures are cut to their middle; a Leave race button was added |
| On ordinary pictures a rival could get stuck for ever: an object left in the road, or the road looped over itself (7 to 16% of random layouts) | High, confirmed | Fixed. Solid objects must have room beside the road; kinks are smoothed out; a crossing or doubled-back road is rebuilt more plainly; glancing hits slide. 660 random pictures now all finish with 0 rescues |
| Driving the whole circuit backwards counted laps and finished the race | Medium, confirmed | Fixed. A checkpoint counts only when crossed going forward. Tested for five minutes of backwards driving |
| The place shown at the start was wrong (the player at the back was shown 1st) | Medium, confirmed | Fixed. Tested on every random picture |
| With one or two clear objects the page threw them away and listed "Grey object" patches; a blank picture listed six objects | Medium, confirmed | Fixed. Real objects are kept; busy patches are called patches; a flat picture lists nothing |
| A tall picture made a ground image 54,000 pixels high: a five-second freeze and a console warning | Medium, confirmed | Fixed. Shape limits, a size cap, and the old circuit stays if the new one cannot be drawn |
| On a 320-wide phone the map covered the time | Low to medium, confirmed | Fixed. The layout check now looks for overlaps, not only for things off screen |
| Shortcut keys stopped working after any button was clicked | Low, confirmed | Fixed |
| Looking away did not pause; the engine could keep sounding in a hidden tab | Low, confirmed and plausible | Fixed. Losing focus pauses; pausing silences the engine |
| The README pointed at a review file that did not exist | Low, confirmed | This file |
| Boost tokens kept spinning under reduced motion; the Paused message vanished after a minute | Low, plausible | Fixed |

The reviewer also showed that several of my checks proved less than their messages claimed: the wrong-way test ran for too short a time, the blocked-road test used six hand-made layouts, the awkward pictures bypassed the detector, and the layout check ignored overlaps. Each is replaced by the wider checks listed above.

It confirmed as sound: the five caps and their positions; collisions, including at the picture's edge; pick-ups never inside objects; rocking over the start line or spinning on a checkpoint earns nothing; tiny, huge, transparent and one-giant-object pictures; refusal of non-images; an SVG with a script in it runs nothing and fetches nothing; file names are not injected into the page.

Found by my own checks on the way: the road folding over itself at tight bends when drawn as a ribbon (now painted onto the ground picture); a comment that swallowed a closing brace; the Start button below the fold on phones.

## Outside review

Reviewed by ChatGPT in chat mode at Pro, driven by another Claude session at the owner's request, 17 November 2026. It read the code and the pictures and did not run the page. Score 6/10, verdict HOLD. Each finding was then checked here by running it (Node scripts, and headless Chromium with software rendering) before anything was changed.

| Finding | What was done | Held by |
|---|---|---|
| Back on the road (R) worked outside the race step, so a lap or finish it caused was wiped by the next step | True. Pressing R just before the final line finished the race in the rules but the page never saw the finish: no result card, the race stuck. Fixed: R is now a control the race step carries out, and everything it causes reaches the page | `sim.test.mjs` (R before all 24 checkpoints: three laps, one finish, all seen); `smoke.mjs` (race with R pressed all the way round finishes) |
| Repeated or held R earned checkpoints and laps | True. Holding R with no accelerator completed all three laps in under a minute; in the browser, 400 presses gave lap 3, a finished kart and no result card. Fixed: R sets you down where the race already has you, standing still, and never moves you further round | `sim.test.mjs` (a minute of R, four ways: no checkpoint, no lap); `smoke.mjs` (400 presses: no lap) |
| Results may appear more than once | Not seen. The result card could fail to appear at all (above), but no path opened it twice. A check now requires exactly one opening per race | `smoke.mjs` (card opens once per race) |
| Finished rivals reverse | True: a finished kart kept braking and reversed at up to 7 units a second. Fixed: a finished kart stops and stays stopped. It can still be nudged by a kart that is racing, as before | `sim.test.mjs` |
| Start can be pressed before a track exists | True: pressing Start or Enter while the sample was loading threw an error. Fixed: Start is switched off until there is a circuit, and the card says the sample is being read | `smoke.mjs` (sample held back on purpose) |
| A failed sample-photo load is not handled | True: an error, a blank card, and no frames drawn even after choosing your own photo. Fixed: the card says the sample could not be loaded and offers to try again or use your own photo; the drawing loop runs either way | `smoke.mjs` (sample blocked, then retried and raced) |
| Photo swaps leave textures, materials and geometries on the graphics card | True by reading and by count: on the old page, 20 swaps took live WebGL textures from 1 to 21 and buffers from 216 to 4,536. Fixed: everything the old photograph used is released before the new one is built | `smoke.mjs` (21 swaps, memory count unchanged) |
| Single-letter shortcuts cannot be turned off, changed or limited to focus (WCAG 2.1.4) | True. Not done: it needs a decision from Kol (a switch for letter keys, or arrows, Escape and buttons only). Arrow keys and Escape already cover steering and pause | None |
| The race canvas has no `tabindex`, so focusing it does nothing | True, though harmless in practice (focus fell to the page, where the keys still work). Fixed with `tabindex="-1"` | `smoke.mjs` Tab-order check still passes |
| Racing view looks like a basic prototype: primitive karts, flat lighting, empty black horizon | True. Two small changes only: the black sky is now a charcoal haze that the table fades into, and each kart has a soft shadow under it. Karts, lighting, wheel and steering animation, and a tabletop setting were not redesigned; that needs Kol's direction and a real screen | Screenshots before and after, looked at; not a test |
| Visual slice on real hardware, 20-second clip, reference set, frame timing, listening to the sound | Not done: no real device, no person to watch or listen here | None |
| "Ready for Kol to play" and being a quality reference overreach | Fair. The verdict above now says draft, and that it is not yet a visual reference | This file |
| No usable fallback without WebGL | True. Not done: a 2D version is a new build. Listed under Known limits | None |
| The 660-case sweep uses made-up layouts, not photographs; full races mostly use the autopilot | True, and already said under Checks run and Not verified | This file |
| (From the outside review of Still Water, which uses the same Kodak suite.) Permission to reuse the photograph is not established, and the page said it was "released by Eastman Kodak for unrestricted use" as fact | True. The credit line, the README and this file now call it a stand-in test image whose terms are not settled, to be replaced with Kol's own photograph before the page is merged or made public. The photograph itself is not replaced: that needs Kol's own picture | Browser check: the credit says so and makes no claim that it is free to use |

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 4 and checklist item D09.
- Method: detector, circuit builder and race rules first, tested in Node; then the page; independent review by a second model; fixes with wider tests.
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
