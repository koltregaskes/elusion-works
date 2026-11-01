---
version: "1.0.0"
name: Hoover Dam Field Lab
description: A live 3D model of Hoover Dam and Lake Mead with a wave-simulated lake, a reservoir and powerplant model, x-ray, pressure, section and construction views, a self-driving tour and eight hands-on engineering labs.

colors:
  bg: "#0b0d10"
  panel: "rgba(14, 17, 21, 0.72)"
  ink: "#ede7dc"
  brass: "#e4a94f"
  water: "#5cc8d6"
  warn: "#f0b44a"
  danger: "#ff6b4f"

typography:
  display: "Big Shoulders Display"
  body: "Inter"
  mono: "IBM Plex Mono"

performance:
  runtime: "Static HTML, CSS and ES modules. No build step."
  dependency: "Three.js r180 plus OrbitControls and post-processing addons, vendored in vendor/ (works offline, no CDN)"
---

# Hoover Dam Field Lab

## Thesis

One model drives everything. `src/model/hydro.js` is the single source of truth for lake level,
storage, head, turbine flow, power, spillway discharge, pressure and thrust. The 3D scene, the
console tiles, the live charts, the water-path schematic and several labs all read from it each
frame. Nothing is animated by hand: the generators spin because the model says a unit is making
power, the spillways run because the lake is above the gate top, the bathtub ring sits where the
water is not.

## Layout

- **Stage (100vh):** the canyon fills the screen. Console layout at 1600×900:
  - top-left: the live number (MW) with head, flow, efficiency, base pressure, thrust, spillways
  - left: the Lake Mead gauge, a draggable rail with dead pool, minimum power pool, record low,
    spillway crest, full pool and top of dam
  - right: Operate / Systems / View tabs
  - bottom: three live panels, all redrawn from the model: water-path schematic, lake and flows
    strip chart, output per unit
  - callouts with thin leader lines into the parts they name
- **Labs (scroll):** gravity section, arch, Francis turbine, concrete cooling, construction
  timeline, lake history, quiz, spec sheet.

## Interaction

- Every subsystem is a button (Systems tab): isolate it, ghost the rest, fly the camera.
- View modes: Normal, X-ray (rock turns to glass, penstock and spillway tracers), Pressure
  (heat map on both faces), Section (clip through the crown cantilever with hatched cap and a
  depth-shaded water cap), Build (1931 to 1936, instanced concrete columns rising unevenly).
- Lake: click to splash, drop a boulder. The surface is a 2.5D height-field wave equation on a
  5 m grid, reflecting off the canyon walls and the dam; the intakes pull gentle sinks.
- Break it: push inflow past ~50,000 ft³/s with the drum gates raised and the lake climbs to the
  crest; overtopping is flagged.
- Auto tour: a ghost cursor walks to controls and presses them. Any real click, drag, wheel or
  key hands control over; 25 s of quiet brings it back. `?notour` disables it.
- Deep links: `?scn=flood&mode=xray&view=spillway&hour=19&lake=1100&drum=0&year=1934.4&focus=towers&pause`.
- Keyboard: T tour, H hide panels, F fullscreen, S sound, 1-5 view modes, Space pause.

## Accuracy

Reference numbers are rounded Bureau of Reclamation figures (see `src/model/data.js`). The
reservoir area table, turbine efficiency curve, uplift assumptions and cooling model are teaching
simplifications and are labelled as such on the page. The lake history chart is approximate and
says so. The canyon is generated, not surveyed.

## Look

- Terrain: per-vertex crevice occlusion baked from the height grid, plus per-pixel rock detail
  (strata bands, breccia noise, derivative bump mapping) so cliffs hold up close.
- Atmosphere: exponential haze tinted by the sky horizon, procedural cirrus and cumulus in the dome.
- Post: soft bloom (sun glints, night windows), a mild saturation lift and vignette, then ACES.

## Performance

- Shaders are compiled before the first frame (`renderer.compile`).
- Adaptive quality: if the frame rate sags below 40 fps twice in a row, the pixel ratio, shadow map
  and post-processing step down. `?q=0|1|2` locks a level.
- Callouts and charts redraw every other frame; labs draw only while on screen.

## Do and do not

- Keep the single brass accent for state; water cyan is for water and water data only.
- Do not add numbers to the UI that are not read from the model or `data.js`.
- Do not hide a geometry collision with the camera; fix the number in `scene/util.js`.

# Teardown style (`teardown/`)

A second view of the same dam in the study-model style of the teardown skill
(elvarofficial/teardown): pale studio, one accent, ink outlines, parts that open up.
It imports the field lab's model (`src/model/`), canyon height field and dam geometry
(`src/scene/`), so both pages always agree. A segmented control in each top bar
switches between them.

- **Studio:** paper-gradient backdrop, soft key light onto an invisible shadow-catcher
  floor, a turntable with an engraved degree ring, RoomEnvironment reflections,
  GTAO + soft bloom + mild vignette. Quality tiers drop GTAO, bloom, pixel ratio and
  shadow size; `?q=0|1|2` locks one.
- **Model:** the canyon is a laser-cut block of 9 m terraces in two halves (Nevada |
  Arizona), with strata on every cut face and a glass lake whose upstream face shows
  depth. Structures are white with ink edges; generators graphite.
- **Accent `#ff5a1f` means working:** water in the penstocks, rotors making power,
  wicket gates, drum gates while spilling, the focused part's outline.
- **Take apart:** the canyon halves slide away on a spring and snap back with a small
  overshoot; the dam lifts, powerhouse walls split, roofs lift, generators rise.
- **Turbine A5:** a magnified (×4.4) Francis unit with a glass spiral case, 20 stay
  vanes, 24 wicket gates turned by the live gate setting, a 13-blade runner, shaft and a
  40-pole generator with a cut window. It has its own explode.
- **Modes:** Glass (rock and concrete see-through), Cut (clip through the crown with a
  hatched concrete section and a depth-shaded water section).
- **Console (1600 × 900 field-simulator layout):** orange ID block and title with a slash
  mark; a 40-cell dam-load meter (thrust as a share of thrust at the crest); sim ID,
  runtime, status and operator columns; numbered cards with an orange tick header
  (01 Output, 02 Lake Mead, 03 Unit load, 04 Turbine A5 with a live wicket-gate dial,
  05 Assemblies, 06 Display, 07 Subsystems with status pills computed from the model);
  a huge orange MODE title; tucked-away operator sliders; a footer spec line.
- **Operation log:** a 38 s script of ten operator beats (isolate intake, penstock in
  glass, open unit A5, close and reopen the wicket gates, take apart, flood and drop
  the drum gates, section, reassemble). It plays with a ghost cursor tapping the real
  controls, can be scrubbed on its beat-ticked bar, pauses on any input and restarts
  after 25 s of quiet. Seeking replays every beat up to that time, so a still at `?t=`
  is exactly that moment of the film.
- **Drafting overlay:** orbit circles, dashed arcs, travelling nodes, a crosshair on the
  subject and a dashed model frame, redrawn from the camera every other frame.
- **Callouts:** orange dot, elbow leader, two-line mono label; the set changes with the
  isolated assembly.
- Deep links: `?t=13.5` (film time), `?q=0|1|2`, `?pause`, `?clean`, `?notour`.
