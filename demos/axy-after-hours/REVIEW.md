# Axy Lusion After Hours: review

Demo 2 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876, the HTML-in-Canvas "weird web" brief of 16 November).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to look at. Not published, not in the gallery, not in the sitemap.

**Quality bar it sets:** an experimental landing page where every visible thing is still real HTML, drawn through a shader where the browser allows it and fully usable as ordinary HTML where it does not.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| Our own concept, not a copy of the reference demos | A gravity well in a homepage, and a gallery wall after closing. Own code, own shaders, own artwork | Source, README |
| Real HTML text and buttons bend and fall into a gravity well | Headline letters, copy, two links and the frames lean, fall and stretch. In the canvas version the page itself is bent by a lens shader | `proof.jpg`, `smoke.mjs` |
| A "lit room" variant with pictures under movable lamps | Lamplight: eight frames, three lamps with brightness and warmth, house lights | `proof.jpg`, `smoke.mjs` |
| No titles on Axy images | Frames carry a queue reference and date only | Source |
| Feature detection with a real HTML fallback | Detected at start. Falls back if the feature is missing, if the first draw fails, if nothing paints in 1.5 s, if a later draw fails, or if the graphics context is lost | `smoke.mjs` (four fallback cases) |
| Keyboard and screen-reader access to the underlying HTML | Same DOM in both versions. Focus pulls a swallowed piece back. Lamps are buttons with arrow keys | `smoke.mjs`, axe |
| A performance budget on phones | Canvas capped at 1.5 device pixels, smaller artwork, three shader noise octaves, redraw only on change in Lamplight | Source. Not measured on a real phone |
| A credit line to the inspiration | In the footer of every view, and in About | Page |
| One version for Elusion Works and one Claude artifact | This folder, and a single file built from it by `tools/build-artifact.mjs` | See "Artifact version" |

## Checks run (17 Nov 2026)

Verified by running, in headless Chromium 153 with software graphics. The HTML-in-Canvas version was switched on with the browser's `CanvasDrawElement` feature.

- `node demos/axy-after-hours/tools/smoke.mjs <axe.min.js>`: pass, in both versions.
  - The page falls into the well, focus pulls a link back out, restore returns everything.
  - Slider by keyboard, well handle by arrow keys, well drag, real mouse clicks on real links, lamps by keyboard, panel and drag, About dialog.
  - axe-core 4.14.0, WCAG 2.2 A and AA: 0 violations in both rooms.
  - Phone 400 by 800 with touch: no sideways overflow, targets 24 px or taller, taps work.
  - Short and narrow screens (740 by 360, 320 by 480, 390 by 664, 360 by 640): every control, link, lamp and the credit line reachable; the wall never collapses.
  - Reduced motion: nothing travels; focus still brings a piece back.
  - Fallback: a failing first draw, a failing later draw, a lost graphics context and `?plain` all give the ordinary HTML page, with keyboard focus kept.
  - Zero console errors, warnings or failed requests.
- The repo's own overflow rule and axe at 320, 390 and 1280 px, both rooms: clean.
- `python3 scripts/build-site.py`: pass with the demo present (49 indexable routes, unchanged). The built page runs under the generated security policy with no errors and no outside requests; fonts load locally.

## Not verified

- **Inside Claude's desktop app.** The brief's done-when says it should run there. I could only test the canvas version in Chromium 153 with the feature flag. The feature's programming interface has changed shape three times; the code tries all three, and only the Chromium 153 shape has actually been run. The other two are written from the published explainer and are unproven.
- **Frame rate on a real GPU and a real phone.** Software graphics only here.
- **Safari and Firefox.** Only Chromium was run. They will get the plain HTML version.
- **Real Axy images.** The archive's image host is blocked from this session, so the frames are generative stand-ins built from each frame's recorded colours. The page says so.
- **Kol's Taste Lab rating.**

## Known limits

- In the canvas version, a bent control is drawn slightly away from where it really is. The header, the control dock and the footer are therefore never bent, and the lens fades to nothing at the rim of the hole so nothing is hidden. The two links and the frames in the bending area can be up to about 60 px from their drawn position when the well is close; they fall in when it gets closer still.
- Lamplight is a dark room by design. The wall label, the frame references and whichever element has focus are exempt from the darkness so they stay readable; the pictures themselves are only as visible as the lamps and house lights make them.
- Text cannot be selected, because dragging moves the well.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the code and the contract but not my conclusions) read the source and ran its own probes. It found 13 defects that my first test suite had missed, mostly on short screens and for keyboard users. All confirmed ones are fixed and each now has its own check.

| Finding | Severity | Status |
|---|---|---|
| On short screens the Undertow controls were cut off with no way to reach them | High, confirmed | Fixed. The controls always stay on screen; the hero sheds its extras in order until everything fits |
| Lamplight wall collapsed in landscape and the lamp panel covered the credit line on small phones | High, confirmed | Fixed. The panel sits above the footer by measurement, lamps cannot sit under it, small screens get a layout that keeps the wall |
| Focus could scroll the page under the header and leave the physics out of step | High, confirmed | Fixed. Nothing in the page can scroll |
| With reduced motion, focusing a swallowed piece left it invisible | Medium, confirmed | Fixed |
| At zero mass, falling pieces hung in mid-air for good | Medium, confirmed | Fixed. They come home |
| A draw failure after the first paint froze the canvas instead of falling back | Medium, confirmed | Fixed. Any failure hands the page back |
| The lens hid real, clickable controls inside a wide ring around the well | Medium, confirmed | Fixed. New lens maths hides nothing, and the header, dock and footer never bend |
| Unlit text and the focus ring failed contrast in Lamplight | Medium, measured | Fixed. Label, references and the focused element stay lit |
| Header overflowed at 320 px | Low, confirmed | Fixed |
| A lost graphics context dropped keyboard focus and showed the wrong status | Low, confirmed | Fixed |
| Lamps were in reverse Tab order | Low | Fixed |
| Two shader portability risks (pow of a negative, a variable named like a built-in) | Low, plausible | Fixed |
| The newest interface shape could draw black without failing | Low, plausible | Fixed in code (sizes from the element, error checked on first draw). Still unproven, see "Not verified" |

Also found by my own tests on the way: a negative first frame time that hid the page for a second at load; a browser link-drag that hijacked lamp dragging; and the Axy address in the script tripping the site's host check.

## Artifact version

`node demos/axy-after-hours/tools/build-artifact.mjs <output.html>` writes a single file for a Claude artifact from the same source: fonts from Google Fonts, script inlined, nothing else changed. See the pull request for whether one has been published.

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, the Chief of Staff's brief for item 2, and the 16 Nov hub comment setting the hard requirements.
- Method: probed the HTML-in-Canvas calls in the test browser first; built one DOM with two renderers; iterated against headless screenshots in both versions; independent review by a second model before sign-off.
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
