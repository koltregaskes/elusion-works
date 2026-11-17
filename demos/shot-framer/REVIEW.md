# Shot Framer: review

Demo 12 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to try. Not published, not in the gallery or the sitemap.

**It has never been given a real 360 photograph.** Every picture it has framed was made for the checks or worked out by the page. The arithmetic is checked to the pixel; how a real stitched photograph looks through it, and how it feels to use, are unproved.

**Quality bar it sets:** a picture tool whose every pixel comes from one piece of arithmetic that runs without a browser, so the frame on screen and the file that comes down can both be compared, pixel for pixel, with the same frame drawn again by the checks.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A 360 panorama shot-framer | Look round a 360 picture, frame it in six shapes through a lens given in millimetres, save a list of shots in plain words, export each as a PNG | `index.html`, `js/app.js`, `js/pano.js` |
| After the Runway post, original | Own arithmetic, own page, own sample picture worked out in the page. Credit and link on the page; says it is not made by or with Runway | `index.html` |
| Kol's taste: charcoal, white, one green | Big white headline on charcoal, one green; the sample is a sculpture park at night in three flat tones | `screenshot.jpg` |
| Own folder, own review, nothing live | `demos/shot-framer/`, this file, `noindex`, no gallery card, no sitemap entry | `index.html` |

## Checks run (17 Nov 2026)

Verified by running. All passed on the code as committed.

- `node demos/shot-framer/tools/pano.test.mjs`: pass.
  - Directions: compass points, the edges of a frame, 500 round trips between frame, direction and picture. Straight lines stay straight.
  - The lens in millimetres for a frame fitted inside a 36 by 24 mm sensor: 55 degrees tall is 19.4 mm in 16:9, 14.5 mm in 2.39:1, 34.6 mm in 9:16.
  - The lens is kept across all 36 changes of shape.
  - 20 drags, at lenses from 30 to 110 degrees, level and tilted: what was taken hold of ends under the pointer to a thousandth of the frame.
  - Drawing: a dot lands in the middle and moves as it should; turning equals sliding; no join where the edges meet; the poles; slices equal the whole.
  - Stripes one pixel wide, seen through a very wide lens in a small frame, come out an even grey.
  - The sample: the same every time, no join, eight things where they should be, the ring all the way round, shadows away from the moon, smooth edges, stars spread evenly.
- `node demos/shot-framer/tools/smoke.mjs`: pass, in headless Chromium.
  - The frame on screen matches the arithmetic pixel for pixel in all six shapes.
  - Dragging with a mouse at an ordinary lens and at 110 degrees tilted keeps hold of what was touched. Changing the shape keeps the lens. Wheel, keys, slider and number keys work and stay within limits. After the keys move the frame, the page says where it looks.
  - Three exported files are PNGs of the size asked whose pixels are the shot, drawn again by the check from the whole picture.
  - The frame as it stands exports as `frame-01`, `frame-02`. Export all sends each shot once, in order, with every other export button off; the status line changes at most 8 times for three files.
  - A file being drawn while another picture is loaded is made wholly from the picture it started with.
  - Your own picture: its middle is straight ahead; shots read ahead, right, behind, left; a wrong shape is warned about; too small a picture and a file that is not a picture are refused in words.
  - Phones 390x800, 320x568 and 740x360, a 320 window, 900x700 and 1920x1080: the frame fits in every shape; a finger keeps hold of what it touched; Go to brings the frame back into sight; the wheel scrolls a narrow page until the picture is selected.
  - axe WCAG 2.2 A and AA at seven sizes, no console errors, no outside requests.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; axe clean; the first three Tabs land on visible things; `python3 scripts/build-site.py` passes.

## Not verified

1. **A real 360 photograph.** Does its middle face forward as assumed? Does a stitched 8K photograph of leaves or brick shimmer at the corners of a very wide frame?
2. **Feel.** Nobody has dragged it by hand. Is the coarse picture while dragging acceptable?
3. **A phone.** Pinch was driven by made-up touch events, not fingers. Speed and memory on a small phone with a large picture are unmeasured.
4. Safari and Firefox. A real screen reader.
5. The fallback when copying the list is not allowed: headless Chromium always allowed it.
6. Dropping a file on the page while an export is running, by hand.

## Known limits

- Frames are drawn by the processor so that screen and file are the same. A 4K export takes a few seconds.
- The copies that stop shimmer are chosen for the middle of the frame; the corners of a very wide, steeply tilted frame can still shimmer a little.
- Millimetres assume a crop of a full-frame sensor. A guide, not a calibration.
- The sample's moon is about six times life size, on purpose.
- On a phone held sideways the frame is small and the controls are below it.
- The picture is a keyboard tool, announced as an application; a screen reader's own browsing keys do not work inside it.

## Independent review

A second pass by a separate Claude agent (Opus), read-only, given the brief and not the author's conclusions. It made its own test pictures and measured the page. 21 findings: 1 blocker, 9 should-fix, 11 minor.

| # | Finding | What was done | Held by |
|---|---|---|---|
| 1 | Blocker. One exported file could mix two pictures, if a picture was loaded or the sample finished sharpening during the export | The picture is taken hold of once when a file begins | browser check: a file drawn while another picture loads equals one drawn in peace |
| 2 | Export all could drop a shot without a word and still say all were exported | One export at a time; every export button off meanwhile; the count is of files made | browser check |
| 3 | The lens number was wrong for wide and tall shapes, and jumped when the shape changed | The frame is fitted inside a 36 by 24 mm sensor; changing the shape keeps the lens; the page says how it is worked out | arithmetic test: 7 shapes, 36 changes |
| 4 | The picture did not stay under the pointer: dragged 300 px, it moved 160 at a wide lens | The view is solved so that it does | arithmetic test, 20 drags; browser check, 3 drags |
| 5 | Wide lenses on large pictures shimmered | Frames read from a smaller copy of the picture when several of its pixels fall in one of theirs | arithmetic test: fine stripes come out grey |
| 6 | Your own picture opened facing its seam | The middle of the picture is straight ahead; shots of your own picture read ahead, right, behind, left | arithmetic test; browser check |
| 7 | The wheel was captured over the picture, so a narrow page could not be scrolled past it | On a narrow page the wheel scrolls until the picture is selected | browser check |
| 8 | Exporting the frame used the next shot's number, so two pictures shared a name | `frame-01`, `frame-02`, numbered on their own | browser check |
| 9 | Go to on a phone changed a frame that was off the screen | The frame is brought back into sight | browser check on three phones |
| 10 | README named a REVIEW.md that did not exist | This file | |
| 11 | The status line spoke for every slice: 64 changes for six files | Progress is shown, not announced; the status line speaks at the start and end of each file | browser check |
| 12 | The slider's name was its changing value | Named "Lens"; the value is its value | browser check |
| 13 | The picture was announced as an image but is worked by keys; the keys said nothing | Announced as an application; says where it looks once the keys stop | browser check; axe |
| 14 | Saved shots showed the new picture with no explanation | The page says they are kept, and why | browser check |
| 15 | A 2 by 1 picture loaded; a very tall one was not capped; errors uncaught | Too small is refused; height is capped at 4096; failures are caught and said | browser check for the small picture; the others read in the code |
| 16 | The sample: stepped edges, stars crowding overhead, a blurred patch underfoot | Edges are worked out again as an average of nine places; stars are spread by area; you stand on a plinth with a clean rim | arithmetic test |
| 17 | README said a 4K export takes a second or two; it took up to 5.9 s | README says a few seconds, and when it is slower | |
| 18 | The file name in the status line showed a multiplication sign for its x | Ligatures and contextual forms are off there | not checked by a test |
| 19 | Placeholder text said 24 mm where the value was 23 | The start is now a 24 mm lens | browser check |
| 20 | After Remove the focus went to the first shot | It goes to the shot that took its place | browser check |
| 21 | A small frame on a sideways phone | Not changed. Listed under known limits | |

## Provenance

- No library. No picture, font or data file; the sample is worked out in the page.
- After a post by Runway on X, credited and linked on the page. Not made by or with Runway.
