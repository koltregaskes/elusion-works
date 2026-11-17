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
  on every build (twice a day by schedule), into `_site/` only, with a shared response cache
  (`src/freshness-policy.js` sets the GP and SATCAT ages). The file is gitignored.
  The script exits non-zero when no group arrives or fewer than 2,000 objects do.
- **Publication gate:** the deploy then checks the file with `inspectCatalogue(..., { requireComplete: true })`
  (`src/catalogue-status.js`). A failed, partial or stale acquisition stops the deploy and the
  previous deployment stays live.
- **No browser fallback:** the page reads only the published `data/catalog.json`; it never asks
  CelesTrak itself. If that file is missing or fails the same checks, the page shows its
  "Shared catalogue unavailable" state instead of a globe.
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
an instantaneous spatial-hash screen (`src/screen.js`) for pairs under 25 km, from different
launches, moving at least 10 m/s apart; the card states all three rules, counts the slow
pairs it leaves out, and says "No pairs meet this screen's criteria" when the list is empty
(a distance screen, not a probability) · 08 Over you: count and list above 10° from one of
18 cities (London by default), or from your location on request, which the picker then shows.

Keys: Space pause, N now, F follow, Esc clear, / search, 1–8 lenses, H hide panels.
Deep links: `?lens=debris&color=owner&sat=25544&warp=60&frame=ecef&clean`.

## Map

`data/earth.json` is Natural Earth 1:50m land and lakes plus 1:110m borders (public
domain), delta-encoded at 0.05°. It is drawn to a 4096×2048 canvas at load and lit by
the real Sun for the sim time.

## Thumbnail

Captured on 15 Nov 2026 from a real CelesTrak build (19,716 objects), with labels hidden.

## Notes from the first live builds

- Close approaches leave out pairs moving under 10 m/s relative to each other: the ISS modules
  have separate catalogue entries and otherwise filled the list as "0.0 km" approaches. This is a
  speed rule, not docking data, so it would also hide any other pair drifting together that slowly;
  the card counts those pairs instead of hiding them silently.
- Most SATCAT rows no longer carry a radar cross-section. The object card says "not in SATCAT" when the
  object was matched in SATCAT with a blank RCS, and "unavailable" when there was no SATCAT match at all.
- Running the build script locally behind a proxy needs `NODE_USE_ENV_PROXY=1` (Node 22+).

## Tests

- `scripts/orbit-screen.test.mjs`: the close-approach rules at their thresholds (distance,
  same launch, 10 m/s), and that slow pairs are counted.
- `scripts/orbit-census-interactions.mjs`: loads the page in a browser against a generated,
  fresh fixture catalogue and checks the loaded-data behaviour: families (O3b, Guowang via
  HULIANWANG, Rassvet), the RCS wording with and without a SATCAT match, the shortcut guard in
  the city picker, city and location switching, and the close-approach card's wording. The
  failure-state checks in the launch tests stay as they are.
