# Elusion One: review

Demo 8 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to look at. Not published, not in the gallery, not in the sitemap.

**Quality bar it sets:** a product model whose film is a script that can be checked frame by frame without a browser (never inside the object, never jolting, ending where it began), and whose labels are tested against the model's real geometry and sight lines, so a label can never point at empty space or at a part hidden behind another.

It is a good turntable and a clear look inside. It is not yet a showroom render: the body is made of simple shapes and reads as such up close (see Known limits).

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A product-grade 3D turntable of a camera body | An invented mirrorless camera, built in code from shapes and drawn textures, on a turning table, in black or silver | `thumbnail.png`, `screenshot.jpg` |
| A cinematic camera path | A 36.5-second film of seven shots, cut one to the next, each an eased move; it looks inside in the sixth shot and ends on the resting view | `tools/film.test.mjs`, `tools/smoke.mjs` |
| An interior view | The outside fades to a faint outline; eight parts inside can be chosen, each with a view from which it is in plain sight and a sentence on what it does | `proof.jpg` |
| Original, crediting the source | No real camera copied, no model file; xikhar's post is credited in the panel on every screen size | `index.html` |

## Checks run (17 Nov 2026)

Verified by running, in Node and in headless Chromium with software graphics.

- `node demos/camera-turntable/tools/film.test.mjs`: pass.
  - 2,191 frames of the film: the camera is never inside the body, grip or lens (nearest approach 14.8 cm), never jolts within a shot, and never moves faster than 16.7 cm a second.
  - The body opens once and shuts once, in the sixth and seventh shots.
  - The film ends exactly on the view the turntable rests at.
  - Each of the eleven parts has a view that is outside the camera, within the hand limits, and aimed at the part.
  - Turning by hand stays within its limits and the angle never drifts out of range.
- `node demos/camera-turntable/tools/smoke.mjs`: pass.
  - The model is the size the film assumes, and each part's pointer lies on that part.
  - The table turns, holds still while dragged, and holds still when told to. Drag, wheel, arrow keys and Home work; clicking the camera gives it the keys.
  - All eleven parts: the right view, the table square on, the name and words shown and announced. Each inside part is in plain sight from its own view (a ray from the camera to the part meets nothing else).
  - The outside fades by degrees: five pictures from solid to gone, each a step on from the last.
  - Labels appear only on parts in plain sight, sit on their parts, never lie on the panel or the buttons, and are never taken from under the keyboard focus. The table holds still while a label has the focus.
  - A part of the outside cannot stay chosen once the outside has gone. Escape steps back out of every state.
  - The film: the camera is where the script puts it in every shot, the page gets out of the way, and the button, Escape or a drag stops it.
  - With motion kept down: nothing turns, views cut, the film is seven stills, and there is no Hold still button because nothing moves.
  - Phones 400 by 800, 320 by 568 and 740 by 360: a finger turns it, the whole camera fits, what you chose can be read, nothing is off screen or overlapping. Also 920, 1024, 1100 and 1920 wide.
  - Without WebGL the page says so, shows the credit, and hides every control.
  - axe WCAG 2.2 A and AA: no violations in any state or size tried. No console errors. No request leaves the page.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; Tab lands on visible things; `python3 scripts/build-site.py` passes.

## Not verified

- Nobody has turned it by hand. Feel, drag speed and pinch on a real phone are untested.
- Frame rate on a real graphics card or phone. Software graphics in the test browser say nothing about it.
- Safari and Firefox.
- A real screen reader.
- The film on a slow machine: it is written to keep to the clock when frames drop, which I checked by reading, not by measuring.
- Kol's Taste Lab rating.

## Known limits

- **It reads as built from shapes.** The grip is a rounded block with no finger groove; the sides carry one door and two lugs; the inside is simplified blocks. The reviewer called several details toy-like. The ones that could be fixed with shapes were (see below). A sculpted body needs a modelled mesh, which this demo does not load on purpose.
- The reflections in the front glass are painted on, not traced.
- Labels give way to each other and to the panel, so on a small screen only a few show at once. The list always offers every part.
- The page is one screen with no scrolling; on a short landscape phone the parts panel is small and scrolls.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the code and the contract but not my conclusions) read the source, recomputed the film against the model's real geometry, and took its own pictures from every side and at ten window sizes. Both of my test files passed at the time; it found 14 things.

| Finding | Severity | Status |
|---|---|---|
| The outside never faded: it stayed solid, then vanished in one frame, with sorting faults just before | Blocker | Fixed. The materials are rebuilt when they turn see-through and keep writing depth. A new check takes five pictures through the fade and fails if any step is missing |
| Labels and views named parts hidden behind other parts (the card slot's label sat on the lens) | Should fix | Fixed. A label shows only when a ray from the camera reaches its part. The card slot, stabiliser and main board have new views; two pointers that were buried were moved to visible faces. Checked for every part |
| Choosing an outside part, then Look inside, left the panel naming a part that had faded away | Should fix | Fixed and tested |
| Clicking the model did not give it the arrow keys | Should fix | Fixed and tested |
| A label could be hidden while it had the keyboard focus | Should fix | Fixed. A focused label stays, and the table holds still under it. Tested over 15 seconds |
| No way to stop the table turning | Should fix | Fixed. A Hold still button; tested |
| The credit ran under the buttons between 900 and 1100 wide, and was missing on phones | Should fix | Fixed. The credit is in the panel at every size, and on the no-WebGL screen. Tested at four more widths |
| The credit was unreadable over a bright floor; the table threw a white glare | Should fix | Fixed. The table is matt and the credit sits on the panel |
| The back was laid out for a left-handed camera: thumb controls on the side away from the grip | Should fix | Fixed. Controls and thumb rest are behind the grip, the screen moved over, the lamp sits between grip and lens. Tested against the geometry |
| Toy-like details: a battery like a nine-volt cell, a flat hot shoe, a tray under the body, the camera floating above the table, the board running into the card slot, a part turning solid green when chosen | Should fix | Mostly fixed. The battery is a flat cell with a label and end contacts; the shoe has rails, lips, a stop and contacts; the tray is gone and the camera stands on the table; a seam shows where the top plate meets the body; a card door sits over the card slot; the board stops short of it; the glow is a third as strong. **Not done:** a sculpted grip and more side detail (see Known limits) |
| On small screens the list covered the camera and the chosen part's words scrolled out of view | Should fix | Fixed. Choosing a part shuts the list and shows its name and words; the focus moves to the list's heading. Tested at three sizes |
| "Page furniture hidden" in the film was only partly true | Minor | Fixed. Only the buttons that stop the film stay |
| README: no review file, "36-second", "fades", commands that needed unstated packages | Minor | Fixed. This file; the README now says 36.5 seconds and what the commands need |
| Escape did nothing in Look inside with no part chosen; the canvas was described as black when silver; the film ran slow below ten frames a second; the angle drifted without limit; the front glass stood proud of the lens rim; two side faces lay in the same plane | Minor | Fixed, each one |

It confirmed as sound: the film never enters the real model (recomputed against the geometry, not the three boxes the film assumes); hand limits keep the camera outside the model and above the table; the film stops cleanly by every route; pressed states; no console errors or outside requests; no dashes; UK spelling; no sideways scroll; the Tab rule; the no-WebGL fallback; reduced motion; the live region is not noisy.

Found by my own checks on the way: a list with headings placed straight inside it (axe); the faint twin of the front glass drawn unsquashed, as a bubble 2 cm proud of the lens; a row of buttons wrapping on phones and covering the panel; labels running off the screen edge and crowding each other.

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 8.
- Method: the film's script and the parts list first, as plain data tested in Node; then the model, looked at from every side; then the page; independent review by a second model; fixes, each with a check that would have caught it.
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
