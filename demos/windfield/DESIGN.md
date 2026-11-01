# Windfield

A real-time meadow in the browser. One lone oak in the middle of a field, a wind you
can actually watch travelling across the grass, and seven moods to move between.

Built as Elusion Works' answer to the "AI-assembled 3D scene" posts doing the rounds
(the reference was a burning Viking ship on a red sea, with a live control panel).
Windfield keeps that structure: a live scene, a preset bar, a "make it your own" panel
and a free camera. It swaps the sea for a field, and everything in it is generated in
code. There are no models, textures or video files.

## What makes it move

Everything that sways reads from **one wind field** (`src/wind.js`):

- A steady push in the wind direction.
- **Gusts**: noise bands stretched across the wind and scrolled downwind. They are what
  you see as darker, flattened waves rolling over the grass.
- **Flutter**: fast, small, per-blade jitter on top.

Because grass, wildflowers, the oak, the background trees, pollen, embers, rain, mist,
clouds and falling leaves all use the same field, a gust visibly moves through the whole
scene in the right order. A CPU mirror of the gust function drives the wind audio and
the falling leaves.

## Pieces

| File | What it does |
| --- | --- |
| `src/grass.js` | 95k–560k instanced blades plus wildflower drifts. Bending, colour, dry patches, gust sheen and backlit translucency all happen in the vertex shader. |
| `src/tree.js` | Procedural oak: recursive tapered limbs, leaf-cluster cards with per-card colour, crown occlusion and canopy thinning. Same generator makes three background tree variants, instanced along hedgerows. |
| `src/sky.js` | Sky dome with sun or moon, a cumulus deck and a cirrus deck projected onto flat planes, stars, lightning. Ground mist layers. A copy of the dome bakes the environment map. |
| `src/particles.js` | Pollen, fireflies, bonfire embers and rain as stateless GPU particles. Falling leaves and birds on the CPU. |
| `src/subjects.js` | The alternatives to the oak (a copper-seamed monolith, a standing-stone circle) and the bonfire. |
| `src/presets.js` | Every parameter once, with range and tab. Presets are sparse overrides. |
| `src/main.js` | Renderer, post (bloom, ACES, vignette, grain), preset tweening, lightning, quality levels. |
| `src/controls.js` | Cinematic orbit, and free camera on drag or WASD. |

## Moods

Dawn, Meadow, Golden (default), Storm, Autumn, Night, Bonfire. Switching mood tweens
every number and colour over about 2.5 seconds. The headline, the accent colour and the
camera framing follow.

## Controls

Drag to look around. WASD to move, Q and E for height, Shift to hurry. F toggles the
cinematic camera. Keys 1 to 7 switch mood, Space pauses, H hides the interface. The
camera button saves a still.

## Performance

The default is Medium on desktop and Low on touch devices. If the frame rate sits below
about 34 fps for a few seconds, it drops one level, once and quietly. Quality changes
the grass count, field radius, background tree count, shadow resolution and pixel ratio.

## Deliberately left out

**Animals up close.** A convincing deer or horse needs a rigged, scanned or sculpted
model and a proper locomotion cycle. A procedural one at hero scale would land in the
uncanny valley and undercut everything else in the frame. Birds work because they are
small, distant and mostly silhouette. A future version could add an animal from a
photogrammetry or AI-generated mesh (Tripo or similar), which is how the reference
scene got its ship.

## Capture mode

`?manual` stops the render loop and exposes `window.__windfield.step(dt, n)` and
`window.__windfield.preset(i)`, so frames can be rendered deterministically for video.
`?q=low|medium|high|ultra` and `?preset=<id>` set the starting state.
