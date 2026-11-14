# Orbit Census

A real-time 3D census of every object in Earth orbit with a public element set:
working satellites, spent rocket bodies and debris fragments, usually around 19,000.
Inspired by Mistral's "Orbital Trace" post (Nov 2026); built independently.

## Data

- **Source:** CelesTrak GP (OMM) element sets for the groups in `src/catalog.js`
  (`active`, `stations`, `visual`, `last-30-days` and the four big debris clouds), merged
  by NORAD id and enriched from the CelesTrak SATCAT (type, owner, launch date and site,
  radar cross-section). The SATCAT also gives the whole on-orbit census shown in card 01.
- **Build:** `tools/build-catalog.mjs` writes `data/catalog.json`. The Pages deploy runs it
  on every build (twice a day by schedule), into `_site/` only. The file is gitignored.
  The script refuses to overwrite with fewer than 2,000 objects and exits non-zero on
  failure; the deploy reports it as a warning and carries on.
- **Fallback:** if `data/catalog.json` is missing, the page asks CelesTrak directly from
  the browser (types then come from names). If that fails too, it says "No data" plainly.
- **Run locally:** `node demos/orbit-census/tools/build-catalog.mjs`, then serve the repo.
- The top bar always says where the data came from and how old it is.

## Propagation

- `src/worker.js` holds one SGP4 satrec per object (satellite.js 7.1.0, pure JS core,
  vendored in `vendor/satellite/`, MIT) and propagates the whole catalogue in ~12 ms.
- The page asks for snapshots ahead of the sim clock. Each snapshot is position plus
  velocity; the vertex shader blends the latest two with a cubic Hermite curve, so motion
  is smooth and exact at the snapshot times at any warp (1× to 1,800×, reverse too).
- Objects inside Earth's shadow cylinder are dimmed in the shader (toggle: Eclipse).
- Frames: Inertial (TEME, the Earth turns underneath) or Earth-fixed (GEO stands still).

## Console

01 Census (click a legend row to hide it, double-click to solo) · 02 Lenses · 03 Colour
by type, regime, owner, constellation, debris event or element age; regime filter ·
04 Find by name or NORAD id · 05 Selected object: live altitude, speed, sub-point,
period, light/shadow, full SATCAT facts, orbit and ground track, next pass over the
observer with visibility · 06 Distribution: live altitude histogram (drag to filter a
band), inclination vs altitude, Gabbard diagram, launch year · 07 Close approaches:
an instantaneous spatial-hash screen for pairs under 25 km from different launches
(labelled as a distance screen, not a probability) · 08 Over you: count and list above
10° from London, or your location on request.

Keys: Space pause, N now, F follow, Esc clear, / search, 1–8 lenses, H hide panels.
Deep links: `?lens=debris&color=owner&sat=25544&warp=60&frame=ecef&clean`.

## Map

`data/earth.json` is Natural Earth 1:50m land and lakes plus 1:110m borders (public
domain), delta-encoded at 0.05°. It is drawn to a 4096×2048 canvas at load and lit by
the real Sun for the sim time.

## Thumbnail

The card image was captured from a local run with stand-in orbits (CelesTrak is not
reachable from the build sandbox). The live page only ever shows real catalogue data.
