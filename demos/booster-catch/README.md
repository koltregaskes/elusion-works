# Booster Catch

A 3D replay of a real event: the last 54 seconds of the first Super Heavy tower catch (Starship Flight 5, 13 October 2024, Starbase, Texas). Built with Claude Fable 5.2 as the first of Kol's Fable benchmark demos.

**Quality bar it sets:** a real event rebuilt as one deterministic scene, where a single clock drives the flight, eight cameras, three ways of seeing it, the readout and the sound, so every view agrees at every instant.
Use it as the reference for 3D scenes with a timeline.

## What it does

- Scrub, replay, slow down or speed up a 54 second timeline (T+6:06 to T+7:00).
- Eight cameras: tracking, pad, onboard, drone, tower top, catch arms, shoreline and free look.
- Three views: visual (dawn light), blueprint (see-through line drawing with dimensions and the tanks inside), thermal (false-colour heat).
- Director's cut: cuts between cameras on a 120 beats-per-minute grid. The three cited events land exactly on the beat.
- Split view: two more cameras at the same instant.
- Flight path, a modelled readout (altitude, speed, engines lit) and optional synthesised sound.

## What is real and what is modelled

| Item | Value here | Basis |
|---|---|---|
| Slows through the speed of sound | T+6:08 | Published flight timeline |
| Landing burn starts | T+6:30 | Published flight timeline, as flown (pre-flight plan: 6:33) |
| Engines off and caught | T+6:54 | Published flight timeline, as flown (pre-flight plan: 6:56) |
| 13 engines relight, then 3 | Yes | Press coverage of the flight |
| Booster 71 m by 9 m, 33 engines, tower 146 m | To scale | Published vehicle figures |
| Altitude, speed, path, lean, arm timing, site layout, weather, light | Modelled | A plausible fit between the three known times. Not telemetry. |

## Credits and rights

- Flight and vehicle: SpaceX. No SpaceX footage, models, textures or logos are used. All geometry, textures and effects are procedural and original to this page.
- Timeline: the Wikipedia article "Starship flight test 5" (CC BY-SA), flight timeline table.
- Idea: Ethan Mollick's booster catch replay (https://x.com/emollick/status/2122036763468214711). This is a separate build of a different flight.
- three.js r160 (MIT), loaded from `demos/_shared/three-r160`.

## Files

- `index.html`: page, styles and controls.
- `js/flight.js`: the flight model. Pure maths, no rendering. Change the timeline here.
- `js/world.js`: sky, sea, land, pad, tower and arms.
- `js/booster.js`: the booster.
- `js/fx.js`: plumes, smoke, flight path, blueprint labels.
- `js/app.js`: renderer, cameras, views, controls, sound.
- `tools/`: checks (not shipped). `flight.test.mjs` needs only Node. `smoke.mjs` and `shots.mjs` need Playwright and a static server on port 8765 serving the repo root.

## Status

Unlisted. The page carries `noindex` and is not in the gallery or the sitemap. To release it: remove the `noindex` line, add the gallery card in `demos/index.html` and the route in `sitemap.xml`. Kol approves publishing.
