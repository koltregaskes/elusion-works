# Still Water: review

Demo 5 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to walk round. Not published, not in the gallery, not in the sitemap. **Not to be merged while the stand-in photographs are on it** (see the README): their terms of reuse are not settled.

**Quality bar it sets:** a first-person 3D place that anyone can get round (walking, Next, a guided walk, or a list), where the panel only ever says what is true, and where the rules for walking are tested without a screen.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A walkable first-person gallery | Six rooms on one plan; keyboard, drag to look, a thumb-stick on phones | `smoke.mjs` |
| A liminal "poolrooms" look | White tile, shallow pools you wade into, skylights with shafts of daylight, moving water-light on the walls, no people | `thumbnail.png` |
| Photographs on the walls | Twelve, framed, mounted, numbered, each with a lamp; a plain description for each | `proof.jpg` |
| Original build | Plan, geometry, light and three shaders written for this page; no copied assets beyond the stand-in photographs | Source |

## Checks run (17 Nov 2026)

Verified by running, in Node and in headless Chromium 153.

Re-run after the outside review below, on the final code, the same day.

- `node demos/still-water/tools/world.test.mjs`: pass.
  - The plan: closed at the edges, all 274 open squares reachable, twelve photographs each facing a room and viewable from 0.5 to 5 m.
  - Walking: 160,000 random steps (including absurd time gaps) never end in a wall or pillar, the eye never jumps, and nonsense numbers are refused.
  - Pool floors shelve with no step anywhere (sampled every 5 cm); the drawn floor matches the walked floor to within 4 cm.
  - Routes: from every plate to the next, and from 48 spots hard against the pillars, the walk never passes through anything and ends square on.
  - Geometry: every triangle is wound to its normal and faces open air; light values in range; water over every pool square.
  - The plain gallery in `index.html` lists the same twelve files and descriptions as `js/photos.js`, in order, with a link back to the site; every shader `smoothstep` with number edges runs low to high; no file calls the photographs public domain, and the page says they are unsettled stand-ins.
- `node demos/still-water/tools/smoke.mjs <axe.min.js>`: pass.
  - The way in: twelve photographs loaded, the view really drawn (colour count), Tab reaches visible controls, a visible focus outline on the view.
  - Keyboard walking and turning, a wall that stops you, drag to look, water that can be stilled.
  - PageDown to all twelve plates in order, each time square on, with the right words, announced once; "On the way to plate" while walking. At 1280 by 800 all four corners of each photograph are on the screen and clear of every control.
  - The panel's truth: turn until the photograph is off screen, or look at the floor, and the panel stops naming it.
  - The list: opens, traps nothing behind it, shows each description, takes you there; focus goes where it should for mouse and for keyboard.
  - The walk round: all twelve stops from the start; all twelve when started at plate 7 (8 first, 7 last); Escape or the button stops you where you are. With the list open it waits (no movement, no next stop, the list marks the plate you are at) and carries on when the list shuts.
  - Reduced motion: cuts instead of glides, still water, and the walk round still waits six seconds at each of the twelve.
  - A photograph that fails to load is called missing in the panel and in the list.
  - When the rooms cannot start (WebGL refused, the app script blocked, Three.js blocked, or scripts off), at 1280 and 320 wide: the twelve photographs load and show with their full captions as an ordinary page, with a link back to the site and the reason given; the start card and its buttons are gone; no sideways scroll; axe clean (axe not run with scripts off, where it cannot run).
  - Phones at 400 by 800, 320 by 568 and 740 by 360: the stick walks, the right side looks, the description is on screen, nothing off screen or overlapping. At plates 1, 5 and 8 all four corners of the photograph are on the screen at all three sizes, and clear of the controls at 400 by 800 (not at the other two: see Known limits).
  - axe-core 4.14.0, WCAG 2.2 A and AA: 0 violations on the way in, walking and the list, at four sizes.
  - Zero console errors, warnings or failed requests; no request leaves the page.
- The repo's own overflow rule and axe at 320, 390 and 1280 px: clean.
- `python3 scripts/build-site.py`: pass with the demo present (49 indexable routes, unchanged).

## Not verified

- **How it feels to walk.** Nobody has walked it by hand. Pace, turning speed and the thumb-stick need Kol.
- **Frame rate.** Only software rendering in a container was run. The scene is one mesh of about 42,000 triangles plus water, so it should be light, but real GPUs and phones are unmeasured.
- **Sound.** Synthesised and never listened to. It is off until asked for.
- **A real screen reader.** Announcements were checked as text in the page, not heard through NVDA or VoiceOver.
- **Safari and Firefox.** Only Chromium was run.
- **The photographs' permission.** Not established. They are stand-in Kodak test images; an archive page says they were released for unrestricted usage, an outside reviewer reports that Kodak's own document speaks of a grant to sampler-disc holders and of crediting photographers, and the repo holds no licence or credits. They must be replaced with Kol's own photographs before this is merged. See the README.
- **The plain gallery in other browsers.** Tested in Chromium only, with WebGL refused by a script and with files blocked; not on a real machine without 3D graphics.
- **The water shader fix on real graphics hardware.** The edges of one `smoothstep` were the wrong way round (undefined in GLSL). Swapped; in software rendering the picture is identical to the last pixel in three views, two of which show the mirrored skylights. Real GPUs not checked.
- **Kol's Taste Lab rating.**

## Known limits

- The light is worked out once when the page opens. Nothing casts a moving shadow.
- The water mirrors the skylights only, not the rooms.
- Photographs do not fade into the haze at a distance as the walls do, and are not lit by the room.
- Stood square in front of a photograph on small screens, the controls cover a sliver of it: at 320 by 568 the corner of the "Still the water" button covers about 21 by 18 px of the frame's top right (34 px tall for the two upright pictures); at 740 by 360 the panel covers the bottom 13 to 15 px. Measured by projecting the corners, not seen by a person. Standing further back would clear it but makes the picture about a third smaller on a 320 px phone; that is Kol's call.
- The sharing image (`thumbnail.png`) shows two of the stand-in photographs and the green focus outline round the view. It must be re-taken once the photographs are replaced.
- One floor: no stairs, no second level.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the code and the contract but not my conclusions) read the source, wrote its own probes (about 1,600 fuzzed walkers, 1,373 random routes, screenshots from eight places, browser runs) and looked at every photograph against its description. Both of my test files passed at the time; it still found 15 defects. All are fixed, each with a check.

| Finding | Severity | Status |
|---|---|---|
| With reduced motion on, "Walk me round" ran through all twelve plates in a few frames without stopping | High, confirmed | Fixed. Every arrival, walked or cut, waits six seconds. Tested |
| Started in front of a plate, the walk round visited only the plates after it | Medium, confirmed | Fixed. Always twelve stops, wrapping round. Tested from plate 7 |
| The panel named a photograph that was off the screen, or while you looked at the floor | Medium, confirmed | Fixed. The photograph must be within the camera's view. Tested |
| A photograph that failed to load kept its description in the panel and the list | Medium, confirmed | Fixed. It is called missing in both. Tested with a blocked file |
| No visible focus outline on the view (it was drawn off screen) | Medium, confirmed | Fixed. Tested |
| Single-letter shortcuts worked whatever had the focus, and five were undocumented | Medium, plausible | Fixed. Letters act only while the view has the focus; all keys are listed on the start card |
| On short landscape screens the description was hidden from everyone | Low to medium, confirmed | Fixed. One line, cut with an ellipsis; the full words still go to screen readers |
| Screen-reader announcements fired 27 times on one walk round | Low to medium, confirmed | Fixed. One announcement on each arrival, none for the wall between |
| Switching the walk round off mid-walk left you gliding; Next and the list treated it differently | Low, confirmed | Fixed. Off stops you where you are; Next, Previous and the list all end the walk round |
| A key held as the list opened kept walking you behind it | Low, confirmed | Fixed. Tested |
| A not-a-number time step poisoned the walker | Low, confirmed in Node | Fixed. Tested |
| In the water on a very wide window the frame touched the top of the screen | Low, confirmed | Fixed. The viewing distance allows for how low you stand |
| The view stayed blank until all twelve photographs had downloaded | Low, plausible | Fixed. The rooms draw at once; pictures go in as they arrive |
| Copy the code did not back up: a missing review file, "proved", list "descriptions" that were not shown, one wrong sky | Low, confirmed | Fixed. The list now shows each description; the sky is described as it is |
| The drawn pool floor differed from the walked floor by up to 8.4 cm | Low, confirmed | Fixed. Finer panels; now within 4 cm, tested |

The reviewer also showed that five of my checks proved less than they claimed (the triangle test could not fail, the "not a flat colour" test only measured file size, reduced motion was tested for Next only, the walk round always started from nowhere, and the pillar route was never followed). Each is replaced.

It confirmed as sound: walking and pillar-hugging under fuzzing; routes from anywhere; no triangle facing into a wall; water only over pools; no flicker between frame, mount and picture; the list dialog's focus handling; three fingers at once and a cancelled touch; rapid presses of everything; odd window shapes; forty quick sound toggles; a hidden tab; no outside requests. Eleven of the twelve descriptions matched their pictures.

Found by my own checks on the way: light burning out to white near the skylights; the eye jolting on a slow frame; a step in the pool floor at inside corners; a viewing distance that put the frame behind the panel.

## Outside review

Reviewed by ChatGPT in chat mode at Pro, driven by another Claude session at the owner's request, on 17 November 2026. It read the code and the pictures and did not run the page. Score 6/10, verdict HOLD. Each finding was checked by running the page or reading the code, then fixed where it could be fixed and checked here.

| Finding | What was done | Held by |
|---|---|---|
| The photographs are stand-ins and their permission is not established: the README leans on an archive's statement of unrestricted use, while Kodak's own document (as the reviewer reports it) speaks of a grant to sampler-disc holders and of crediting photographers | True that permission is not established: the repo holds no licence, grant or credits. Whether the images may be used cannot be settled here, and the photographs were not replaced (Kol's own are not available to this session). The README, this file, the page's start card, the list and the plain gallery now say plainly that these are stand-in test images whose terms of reuse are not settled and that they must be replaced before the page is merged or made public. Nothing claims they are public domain or free to reuse. **Needs Kol's decision.** | `world.test.mjs` (no "public domain"; the page carries the stand-in wording) |
| With WebGL unavailable the page threw before the list was built and showed only "try another browser"; with the script failing to load the entry buttons did nothing | True: reproduced both (WebGL refused: no list, no images; app script blocked: start card stayed, Walk in did nothing). Added a plain gallery in ordinary HTML: all twelve photographs with their full descriptions, a link back to Elusion Works and the reason. It shows when WebGL fails, when the app script or Three.js fails to load, and with scripts off | `smoke.mjs` section 5c (four failure cases at two widths); `world.test.mjs` (gallery matches `photos.js`) |
| Nobody has walked it by hand, measured a real device's frame rate, loaded it cold on a 4G phone or heard the sound; the capture scripts force software rendering; keyboard, touch, 200% zoom and screen-reader checks by a person are missing | True. Not done: none of it can be done on this machine. The capture scripts do force software rendering (`--use-angle=swiftshader`), so no frame rate here says anything about real devices | Not verified, above |
| The new movement and browser suites are not run by CI | True: no workflow mentions this demo. Not done: workflows are outside this demo's folder | None |
| The "whole photograph" check only compared the plate number | True. The check now projects the photograph's four corners: fully on screen at every size tested, and clear of every control at 1280 by 800 and 400 by 800. Doing so found that at 320 by 568 and 740 by 360 a control covers a sliver of the frame; recorded under Known limits, not fixed (a trade-off for Kol) | `smoke.mjs` sections 3 and 6 |
| Merging publishes a reachable page: `noindex` keeps it out of the sitemap, not off the site | True: `pages.yml` deploys `main` and `build-site.py` copies every demo. The README's Status now says so plainly | README |
| The water shader's `smoothstep(1.25, 0.85, ...)` has undefined results in GLSL | True by the GLSL specification (edge0 must be below edge1); no visible fault was seen here. Changed to `1.0 - smoothstep(0.85, 1.25, ...)`. In software rendering the picture is unchanged to the pixel in three views. Also guarded the tile grout's `smoothstep`, whose two edges would meet if the screen-space change were ever zero | `world.test.mjs` (smoothstep edges); pixel comparison run once, not kept as a test |
| The walk round keeps moving while "All plates" is open, so the marked plate goes stale | True: reproduced (moved from plate 1 to plate 2 behind the open list, which still marked plate 1). Now nothing moves behind the list and the walk round waits; it carries on when the list shuts | `smoke.mjs` section 4 |
| No link back to the site, no way to see the instructions again, no sharing image | True. Added "Back to Elusion Works" on the start card, in the list and in the plain gallery; the list now repeats how to move; added sharing tags (title, description, image, image description), keeping `noindex`. The sharing image shows stand-ins and must be re-taken after the photographs are replaced | `world.test.mjs` (link in the plain gallery); `smoke.mjs` (axe and layout with the new list text) |
| Suggestions: a curated series, distinct lighting per room, water that reflects the architecture, photographs lit by the room, spatial sound | True that the water mirrors only the skylights and the photographs are unlit (already under Known limits). Not done: a visual and sound redesign is outside this pass | None |

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 5.
- Method: the plan and walking rules first, tested in Node; geometry and light as plain arrays; then the page; independent review by a second model; fixes with wider tests.
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
