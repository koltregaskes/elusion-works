# Booster Catch: review

Demo 1 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876, checklist item D01).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to look at. Not published, not in the gallery, not in the sitemap.

**Quality bar it sets:** a real event rebuilt as one deterministic scene. A single clock drives the flight, eight cameras, three views, the readout and the sound, so every view agrees at every instant and scrubbing backwards rebuilds exactly the same frame.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A real public launch or landing, different from the reference | Starship Flight 5, 13 Oct 2024 (the reference build used a later flight) | README, Sources dialog |
| Footage and data sources credited | SpaceX, Wikipedia timeline (CC BY-SA), Ethan Mollick for the idea, three.js | Sources dialog, README |
| 8 camera presets | Tracking, pad, onboard, drone, tower top, catch arms, shoreline, free look | `smoke.mjs`: keys 1 to 8 |
| Visual, blueprint and thermal views | All three, switchable at any time | `smoke.mjs`, `proof.jpg` |
| Synced telemetry and scrub timeline | Clock, altitude, speed, engine map; slider with five markers | `smoke.mjs` |
| Director's cut auto-camera | 18 cuts on a 120 bpm grid; turns off when a camera is picked | `flight.test.mjs` check 5 |
| Three event times match the cited record | T+6:08, T+6:30, T+6:54, each within 0.2 s | `flight.test.mjs` check 1 |
| Cameras stay in sync | Five cameras and three views return identical state at one instant | `smoke.mjs` |
| Original build, no copied assets | All geometry, textures and effects are procedural | Source |

## Checks run (17 Nov 2026)

Verified by running, in headless Chromium 153 with software graphics:

- `node demos/booster-catch/tools/flight.test.mjs`: pass. Mach 1 at 368.15 s, burn at 390.11 s, catch at 414.00 s; deterministic; never climbs, never dips below catch height; lean stays under 12 degrees; pins land on the rails; every cut is on the beat.
- `node demos/booster-catch/tools/smoke.mjs <axe.min.js>`: pass.
  - Zero console errors, warnings or failed requests across desktop, phone and reduced-motion runs.
  - Desktop 1280 by 800: autoplay, scrub, markers, keyboard, split view, flight path, sound toggle, sources dialog, end of replay and restart.
  - Phone 400 by 800 with touch: no sideways overflow, every control at least 32 px tall, taps work.
  - Short phone 375 by 548 and short window 1280 by 450: the action stays clear of the panels and the transport stays clickable.
  - The repo's own overflow rule and axe with WCAG 2.2 AA at 320, 390 and 1280 px: clean.
  - Reduced motion: no autoplay, starts on a still frame, no camera shake.
  - axe-core 4.10.2, WCAG 2.1 A and AA: 0 violations, with and without the dialog open.
- `python3 scripts/build-site.py`: pass with the demo present (49 indexable routes, unchanged, because the page is `noindex`). The generated security policy needs no new script origin.
- First frame: about 3.2 s after navigation start under software graphics.

## Not verified

- **Frame rate on a real GPU and on a real phone.** This session has software graphics only (a few frames a second), so smoothness is unmeasured. The page lowers resolution, then switches bloom off, if frames run slow. The 3 second first-frame target is met in spirit only: 3.2 s on software graphics, expected to be faster on real hardware.
- **Safari and Firefox.** Only Chromium was run.
- **The three event times against primary pages.** The SpaceX mission page and Wikipedia were unreachable from this session (blocked hosts). The times come from search summaries of the Wikipedia flight timeline and of press coverage; two sources disagree by 2 to 3 seconds on the burn and catch (as flown 6:30 and 6:54, pre-flight plan 6:33 and 6:56). The page shows both.
- **Sound.** The toggle and code path run without error; nobody has listened to it.
- **Kol's Taste Lab rating.**

## Known limits

- Altitude, speed, path and lean are a modelled fit, labelled as such on the page.
- No comparison against the real webcast (rights), and the director's cut uses a generated beat, not one of Kol's tracks.
- The site and landscape are a plausible coastal launch site, not a survey of Starbase.

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 1 (recorded on the hub issue).
- Method: flight model first, tested in Node; scene built procedurally; iterated against 40 or so headless screenshots; independent review by a second model before sign-off (below).
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the code and the contract but not my conclusions) reviewed the source and ran its own browser probes. It found no severe defects and confirmed the determinism claim by pixel hash (same frame at T+6:41.25 whether reached from the start or the end, and after cycling the views six times). It also loaded the built page under the generated security policy with no errors and no outside requests.

Findings and what was done:

| Finding | Severity | Status |
|---|---|---|
| On short phones (375 by 548, 360 by 640) the panels covered the booster | Medium, confirmed | Fixed. The picture is now centred in the area the panels leave free, and the caption is screen-reader-only on short phones. Covered by a new check. |
| Split-view insets could sit over Play and other controls in short windows (1280 by 450) | Medium, confirmed | Fixed. Insets are sized to the free area and dropped when there is no room. Covered by a new check. |
| Timeline markers landed 0.02 s before the event, so "Catch" read "Final approach" | Low to medium, confirmed | Fixed. Markers land on the event. |
| Arrow keys on the timeline moved 0.05 s, not the one second the help text promises | Low to medium, confirmed | Fixed. One second per press, five with Shift or the Page keys. |
| Slider thumb could go stale in Safari, where clicking a button does not move focus | Low, plausible | Fixed. The thumb follows the clock unless a pointer is dragging it. |
| Free look could go under the ground | Low | Fixed. |
| A steady 30 frames a second counted as slow and lowered quality | Low | Fixed. The threshold is now about 22 frames a second. |
| Sound stayed dead on iOS after backgrounding; audio thread kept running with sound off | Low | Fixed. |
| No message after a lost graphics context | Low | Fixed. |
| Split view redrew the shadow map for each inset; shared materials switched shader programs per draw | Low | Fixed. |
| Flight path button could say "off" in blueprint, where the path always shows | Low | Fixed. |
| A note naming the owner shipped in a public HTML comment | Low | Fixed. |
| Thermal and blueprint drop the grid-fin lattice cut-outs and the pad's soft edge | Cosmetic | Left as is. The pad keeps its depth offset so it cannot flicker. |

Also caught by running the repo's own page check locally (WCAG 2.2 target size, 320 px overflow): the timeline marker buttons were under 24 px and the readout overflowed at 320 px. Both fixed before the pull request's checks ran.
