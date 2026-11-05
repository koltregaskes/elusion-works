# Windfield

A real-time meadow and wheat field in the browser. A lone oak at the edge of the crop,
a wind you can watch travelling across the grass, a combine harvester cutting real
lanes, and eight moods to move between.

Built as Elusion Works' answer to the "AI-assembled 3D scene" posts doing the rounds
(the reference was a burning Viking ship on a red sea, with a live control panel).
Windfield keeps that structure: a live scene, a preset bar, a "make it your own" panel
and a free camera. It swaps the sea for a field, and everything in it is generated in
code. There are no models, textures or video files.

## What makes it move

Everything that sways reads from **one wind field** (`src/wind.js`):

- A steady push in the wind direction.
- **Gusts**: noise bands stretched across the wind and scrolled downwind. They are what
  you see as darker, flattened waves rolling over the grass and the wheat.
- **Flutter**: fast, small, per-blade jitter on top.

Because grass, wheat ears, wildflowers, the oak, the background trees, pollen, chaff,
embers, rain, mist, clouds and falling leaves all use the same field, a gust visibly
moves through the whole scene in the right order. A CPU mirror of the gust function
drives the wind audio and the falling leaves.

## What the combine does

The combine (`src/combine.js`, `src/harvest.js`) drives lanes back and forth south of
the oak, with U-turns on the headlands and the header lifting on the turns. As it goes
it paints into a **cut mask** (`src/field.js`), a render target covering the field:

- red channel: cut to stubble, stamped by the 9 m header;
- green channel: straw lying in the windrow, stamped from the back of the machine.

The grass, the wheat ears and the ground all read that mask, so a lane it has cut stays
cut. Chaff sprays from the straw spreaders and blows downwind, the header kicks up
dust, and the exhaust puffs. When the field is finished it regrows and the combine
starts again. Press **T** (or "Take the wheel" in the Subject tab) to drive it yourself.

## Pieces

| File | What it does |
| --- | --- |
| `src/grass.js` | Two layers of instanced blades. A dense **near patch** (110k to 720k blades) travels with the camera, each blade owning a world-fixed lattice point so nothing pops, with wheat ears and flower heads riding on a subset. A lighter **far field** fills the distance. Bending, colour, crop, stubble and straw all happen in the vertex shader. |
| `src/field.js` | The terrain height texture (so shader-placed grass sits on the ground) and the cut mask. |
| `src/combine.js` | The procedural combine: bevelled panels, lathed tyres with chevron lugs, a header with a turning reel, auger and knife guards, a glass cab, ladder, mirrors, grilles, lights, beacon and spreaders. Also the lane autopilot and the drive model (rear-wheel steering). |
| `src/harvest.js` | Ties the combine to the field: stamping, chaff, dust and exhaust particles, regrowth. |
| `src/tree.js` | Procedural oak: recursive tapered limbs, high-resolution leaf-cluster cards with per-card colour, crown occlusion and canopy thinning. The same generator makes three background tree variants, instanced along hedgerows. |
| `src/sky.js` | Sky dome with sun or moon, a cumulus deck and a cirrus deck projected onto flat planes, stars, lightning. Ground mist layers. A copy of the dome bakes the environment map. |
| `src/particles.js` | Pollen, fireflies, bonfire embers and rain as stateless GPU particles. Falling leaves and birds on the CPU. |
| `src/subjects.js` | The other things that can stand in the middle (a copper-seamed monolith, a standing-stone circle) and the bonfire. |
| `src/presets.js` | Every parameter once, with range and tab. Presets are sparse overrides. |
| `src/main.js` | Renderer, post (light shafts, bloom, ACES, vignette, grain), preset tweening, lightning, quality levels, driving input. |
| `src/controls.js` | Cinematic orbit around whatever is in focus, free camera on drag or WASD, chase camera while driving. |

## Moods

Dawn, Meadow, Golden, Harvest (default), Storm, Autumn, Night, Bonfire. Switching mood
tweens every number and colour over about 2.5 seconds. The headline, the accent colour
and the camera framing follow. "Meadow to wheat" in the Grass tab turns any mood's
field into a crop, and the Combine subject works in any mood.

## Controls

Drag to look around. WASD to move, Q and E for height, Shift to hurry. F toggles the
cinematic camera. T takes the wheel of the combine (W and S throttle, A and D steer,
drag to swing the camera, Esc hands back to the autopilot). Keys 1 to 8 switch mood,
Space pauses, H hides the interface. The camera button saves a still.

## Performance

The default is High on desktop and Low on touch devices. If the frame rate sits below
about 34 fps for a few seconds, it drops one level, once and quietly. Quality changes
the near-patch blade count and radius, the share of stalks carrying wheat ears, the far
field, the background tree count, shadow resolution and pixel ratio.

To measure a real machine, open the page with `?bench`. It runs each quality level for
two seconds of warm-up and five of measurement, then shows average and slow-frame
(95th percentile) rates, recommends the highest level that stays above 50 fps, and
gives a one-line summary with a copy button.

## Deliberately left out

**Animals up close.** A convincing deer or horse needs a rigged, scanned or sculpted
model and a proper locomotion cycle. A procedural one at hero scale would land in the
uncanny valley and undercut everything else in the frame. Birds work because they are
small, distant and mostly silhouette. A future version could add an animal from a
photogrammetry or AI-generated mesh (Tripo or similar), which is how the reference
scene got its ship.

## Capture mode

`?manual` stops the render loop and exposes `window.__windfield`: `step(dt, n)`,
`preset(i)`, `advanceCombine(seconds)`, `drive(on, throttle, turn)`, `combineAt()` and
`look(x, y, z, tx, ty, tz)`, so frames can be rendered deterministically for video.
`?q=low|medium|high|ultra` and `?preset=<id>` set the starting state.
