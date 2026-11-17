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
| Three event times match the cited record | The model meets T+6:08 (below Mach 1), T+6:30 (ignition) and T+6:54 (tower contact, and engines off) within 0.2 s each. The times are whole seconds from secondary summaries, so this is agreement with those figures, not precision. | `flight.test.mjs` check 1 |
| Cameras stay in sync | Five cameras and three views return identical state at one instant | `smoke.mjs` |
| Original build, no copied assets | All geometry, textures and effects are procedural | Source |

## Checks run (17 Nov 2026, re-run after the outside review)

Verified by running, in headless Chromium 153 with software graphics:

- `node demos/booster-catch/tools/flight.test.mjs`: pass. Mach 1 at 368.15 s, first engine lights at 390.11 s, every engine off at 413.91 s, tower contact at 414.00 s, 0 engines lit at T+6:54 and 3 at T+6:53; deterministic; never climbs, never dips below catch height; lean stays under 12 degrees; pins land on the rails; every cut is on the beat; no shader writes `smoothstep` edges in reverse.
- `node demos/booster-catch/tools/smoke.mjs <axe.min.js> <base URL>`: pass.
  - Zero console errors, warnings or failed requests across desktop, phone and reduced-motion runs.
  - Desktop 1280 by 800: autoplay, scrub, markers, keyboard, split view, flight path, sound toggle, sources dialog, end of replay and restart.
  - Phone 400 by 800 with touch: no sideways overflow, every control at least 32 px tall, taps work.
  - Short phone 375 by 548 and short window 1280 by 450: the action stays clear of the panels and the transport stays clickable.
  - The repo's own overflow rule and axe with WCAG 2.2 AA at 320, 390 and 1280 px: clean.
  - Reduced motion: no autoplay, starts on a still frame, no camera shake.
  - axe-core 4.14.0 (the version the repo's checks use), WCAG 2.2 A and AA: 0 violations, with and without the dialog open.
  - Fixes from the outside review: focus ring on the 3D view; Flight path button matches the screen in all three views; thermal note shown in the thermal view; all 9 blueprint labels fit; readout shows 0 / 33 engines at T+6:54; letter and number shortcuts can be switched off; a lost graphics context pauses, restores the Play label and stops the sound; a browser without sound gets a "No sound" button and no errors; with the 3D library blocked, a message and a still frame show; 640 by 400 (1280 by 800 at 200% zoom, emulated by viewport size) has no sideways overflow and the main controls are clickable; "Modelled, not telemetry" shows on phones.
- `python3 scripts/build-site.py`: pass with the demo present (49 indexable routes, unchanged, because the page is `noindex`). The generated security policy needs no new script origin.
- First frame: about 3.2 s after navigation start under software graphics on a quiet machine; 3.7 to 8 s in the re-runs after the outside review, with the machine heavily loaded by other work.
- The built page (`_site`, with its generated security policy, including the new inline fallback script's hash): loads with no console messages, and shows the fallback when the 3D library is blocked.

## Not verified

- **Frame rate on a real GPU and on a real phone.** This session has software graphics only (a few frames a second), so smoothness is unmeasured. The page lowers resolution, then switches bloom off, if frames run slow. The 3 second first-frame target is met in spirit only: 3.2 s on software graphics, expected to be faster on real hardware.
- **Safari and Firefox.** Only Chromium was run.
- **The three event times against primary pages.** The SpaceX mission page and Wikipedia were unreachable from this session (blocked hosts). The times come from search summaries of the Wikipedia flight timeline and of press coverage; two sources disagree by 2 to 3 seconds on the burn and catch (as flown 6:30 and 6:54, pre-flight plan 6:33 and 6:56). The page shows both.
- **Sound.** The toggle and code path run without error; nobody has listened to it.
- **Whether the 6:08 timeline entry means the Mach 1 crossing.** The outside review says the source table calls 6:08 "supersonic". This session could not open the page to check. The page now says the Mach 1 reading is ours and unchecked.
- **Real browser zoom.** 200% zoom was emulated by a 640 by 400 viewport, not by zooming a browser.
- **Blueprint labels at every camera angle.** Labels no longer cut off and were spaced apart; from some close cameras (the drone near T+6:44) a label can still sit under the caption.
- **Kol's Taste Lab rating.**

## Known limits

- Altitude, speed, path and lean are a modelled fit, labelled as such on the page.
- No comparison against the real webcast (rights), and the director's cut uses a generated beat, not one of Kol's tracks.
- The site and landscape are a plausible coastal launch site, not a survey of Starbase.

## Outside review

Reviewed on 17 November 2026 by ChatGPT in chat mode at Pro, driven by another Claude session at Kol's request. It read the code, tests and pictures at commit `8abdc5b` but did not run the page. Score 6 out of 10, verdict HOLD (visual 5, accuracy and honesty 5, interaction and accessibility 6, code and tests 7, performance 5 provisional). Each finding was then checked here by running the old code (a copy of `8abdc5b` served separately) or reading it, before anything was changed.

| Finding | What was done | Held by |
|---|---|---|
| Final eight seconds look like a scale model: exaggerated metal bands, roughness, contact shadows, mechanical detail; needs three references, matched angles, 1440 and 400 px captures and a 20 second clip on a target device | Not done. This is a visual redesign plus reference and device work, which needs Kol's direction and a real device. Only the label part was done: see the next row. | Nothing yet |
| Blueprint labels clipped | True: "33 engines, 13 relight to land" and "Catch arms, rails at 88 m" were cut off (fixed 512 px texture). Each label texture is now sized to its text, and the labels were spaced so they stop stacking from the pad camera. The blueprint tile in `proof.jpg` was replaced with a fresh frame. | `smoke.mjs`: all 9 labels fit |
| Add direct sources for every factual anchor | Not done. The source pages were not reachable from this session and the site refuses unlisted outside addresses. Instead the page, README and this file now say plainly that the times are whole seconds from search summaries, not checked against the pages, and that sources differ by 2 to 3 s. Kol, or a session that can open the pages, should add dated links. | Sources dialog text |
| Define ignition, tower contact and engine shutdown separately | Done. Each is now one exact model event (`flight.js` header and the Sources table) and each is tested on its own. | `flight.test.mjs` check 1 |
| Remove the unsupported plus or minus 0.2 s historical precision | True: this file said "each within 0.2 s" of the record. Reworded everywhere: 0.2 s is how closely the model meets the quoted figures, not how precisely the real events are known. | Wording; `flight.test.mjs` comment |
| 6:08 is described in the source as "supersonic", which does not establish the Mach 1 crossing | Cannot tell: the page could not be opened here. The Sources table now says the Mach 1 reading of the 6:08 entry is ours and unchecked. | Sources dialog text |
| "Modelled data" hidden on phones (`index.html` phone CSS) | True: the note was `display:none` under 820 px. A short "Modelled, not telemetry" line now shows in the readout on phones and short landscape screens. | `smoke.mjs`: phone and 640 by 400 runs |
| Thermal colours not labelled illustrative | True. The readout note now says so while the thermal view is on, and the Sources dialog says so. | `smoke.mjs`: thermal note |
| `sample(414)` has three engines lit at "Engines off" (T+6:54) | True: 3 lit at 414.00, all off only at 415.11 s. The centre three now shut down as the booster settles; all off at 413.91 s, 0 lit at T+6:54. | `flight.test.mjs` check 1 (failed on the old code) |
| Test ignores shutdown; Mach tolerance 0.5 s against an advertised 0.2 s | True. The test now checks shutdown and contact separately and uses 0.2 s for Mach 1 too, with expected times worked out by hand from the quoted clock times. | `flight.test.mjs` check 1 |
| Canvas `outline:none` hides keyboard focus | True: Tab to the 3D view gave outline style "none". The view now shows a 3 px green ring inside its edge on keyboard focus. | `smoke.mjs`: focus ring |
| Blueprint Flight path toggled twice says "off" with the path visible; this file wrongly listed it fixed | True on both counts (old code: `aria-pressed="false"` while the path is always drawn in blueprint). The button now controls the path in every view and always says what is shown; blueprint starts with it on. The earlier row above is corrected. | `smoke.mjs`: path in three views |
| Graphics-context loss bypasses pause: rumble may keep playing, Play icon stale | True: after a forced loss the old code left the label "Pause" and sound on. It now goes through the normal pause, switches sound off and stops drawing. | `smoke.mjs`: context loss |
| Sound failure not handled | True: with no audio support the old code threw two page errors. The button now reads "No sound", stays off and nothing throws. | `smoke.mjs`: no sound |
| Reversed `smoothstep` edges (`app.js` thermal shader, `fx.js` smoke) | True: GLSL leaves this undefined. Both rewritten as `1.0 - smoothstep(low, high, x)`, which gives the same curve. | `flight.test.mjs` check 6 (failed on the old code) |
| Single-key shortcuts cannot be switched off (WCAG 2.1.4) | True. A "Letter and number shortcuts" switch in the Sources dialog turns them off; Space and the arrow keys still work. | `smoke.mjs`: shortcuts off |
| Unsupported-browser fallback has no useful static alternative; start-up failure handling incomplete | True: with the 3D library blocked the old page stayed blank. The fallback now shows for script load failures too, with a still frame of the replay; without JavaScript the message shows. | `smoke.mjs`: script blocked; also checked on the built page |
| 200% zoom unevidenced | True. Now checked at 640 by 400 (1280 by 800 at 200%), emulated by viewport size. | `smoke.mjs`: 640 by 400 |
| Frame rate on the target desktop and phone; three cold phone loads on 4G; someone hears the sound | Not done: cannot be measured or heard on this machine. Still listed under Not verified. | Nothing |
| Fresh viewer understands the goal; reference set and art direction; final side-by-side comparison | Not done: needs a person and Kol's references. | Nothing |
| Links unchecked | Not done: the one outside link (the inspiration post) was not opened, as this session makes no outside requests. | Nothing |
| Earlier review was the same model family | Noted. This outside review is a different family but did not run the page, so the device check the bar asks for is still missing. | Nothing |

One test was changed in a way that is not a new check: the smoke test's first step waited a fixed 6 s for the clock to advance more than 1 s, which failed on the new code while the machine was heavily loaded (about one frame a second); a probe of the old code under the same load moved the clock only 0.2 s in 5 s, so it would have failed too. It now waits up to 2 minutes for the same condition. The assertion itself is unchanged.

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
| Flight path button could say "off" in blueprint, where the path always shows | Low | Only partly fixed: toggling twice in blueprint still said "off" with the path on screen. Found by the outside review and fixed then (below). |
| A note naming the owner shipped in a public HTML comment | Low | Fixed. |
| Thermal and blueprint drop the grid-fin lattice cut-outs and the pad's soft edge | Cosmetic | Left as is. The pad keeps its depth offset so it cannot flicker. |

Also caught by running the repo's own page check locally (WCAG 2.2 target size, 320 px overflow): the timeline marker buttons were under 24 px and the readout overflowed at 320 px. Both fixed. The pull request's first two runs then failed one rule my older local checker had missed (visible text must be part of a button's accessible name, on the timeline markers); fixed, and the local check now uses the repo's checker version.
