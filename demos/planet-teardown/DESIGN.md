# Planetary Teardown

The eight planets in the teardown style of `hoover-dam/teardown/`, on black.
Same console grammar: ID block, title with a slash, a 40-cell meter, numbered cards with
an accent tick, a big accent MODE title, callouts with elbow leaders, a drafting overlay
and a self-playing operation log with a ghost cursor.

## Look

- Black studio, faint star dust, a dark turntable with an engraved degree ring, soft
  bloom and vignette. One accent means "working": default **lime `#c6ff3d`**, switchable
  to cyan, violet or the original teardown orange (card 05, or `?accent=`).
- Planets are procedural shaders in object space (no textures): cratered rock, sheared
  cloud, ocean world with clouds, rust desert with Olympus Mons, Valles Marineris and
  caps, banded giants with the Great Red Spot and Saturn's hexagon, ice giants.
- Oblateness, axial tilt and spin direction are real; spin speed is compressed.

## Take apart

- Each interior layer is a shell with a 90° wedge removed plus two section caps
  (hatched for solid layers, stippled for fluid). **Cutaway** shows the section;
  **Exploded** springs the inner shells out through the opening, innermost furthest.
  Click a layer (card 04) to isolate it; the rest ghost.
- The planet stands upright while sectioned so the cut faces the camera.
- Rings (Saturn, Jupiter, Uranus, Neptune) are radial profiles from the published ring
  radii, with the planet's shadow cut in. Moons sit on log-compressed orbits.
- **Earth to scale** puts Earth beside the planet at true relative size.

## Data (`src/data.js`)

NASA Planetary Fact Sheet values (mass, radii, density, gravity, escape speed, spin,
day, tilt, albedo, temperatures, pressure, orbit), atmospheric composition, interior
layer radii (model estimates; seismic for Earth, InSight for Mars), major moons, rings,
features, missions and facts. Moon counts are NASA/JPL confirmed totals as of Aug 2026.

The orbit card is live: JPL's approximate Keplerian elements (valid 1800–2050) give the
heliocentric position for the sim date, so distance from the Sun and Earth, light time,
orbital speed (vis-viva) and whether the planet is in the morning or evening sky are
computed, not stored. The top meter shows today's distance between perihelion and
aphelion. Dates can be stepped or run at 20 days a second.

## Operation log

Two beats per planet, 45 s: select it, then one planet-specific teardown (Mercury's iron
core, Earth exploded, Mars's molten layer, Jupiter's metallic hydrogen, Saturn's rings
and moons, Uranus beside Earth...). Any real input hands over; 25 s of quiet hands back.
Deep links: `?p=jupiter&mode=exploded`, `?t=24`, `?notour`, `?pause`, `?clean`, `?q=0|1|2`.
Keys: 1–8 planets, arrows, S/C/X modes, G glass, M moons, E Earth to scale, L labels,
T tour, H hide panels.
