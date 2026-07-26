---
version: alpha
name: Ashfall
description: Browser-native first-person shooter on Three.js r185 with zero external assets. Every texture is synthesised at runtime, every mesh is built in code, every sound is generated with WebAudio.

colors:
  sun: "#ffcf9a"
  sky-zenith: "#3f6f9e"
  ground-bounce: "#7a6647"
  concrete-lit: "#8d8880"
  concrete-shadow: "#4a5460"
  rust: "#8a4a28"
  hazard-yellow: "#c8a02c"
  hud-primary: "#e8e4dc"

typography:
  display: { fontFamily: Barlow Condensed }
  body: { fontFamily: Inter }
  mono: { fontFamily: IBM Plex Mono }

rounded: { none: 0, hair: 1px, dot: 50% }
---

## Overview

Ashfall is a first-person shooter that runs entirely in a browser tab. Three.js r185 is
vendored into the demo; there is no build step, no bundler and no network fetch after load.
Everything else is written from scratch: a hand-authored HDR post chain, cascaded shadows, a
procedural PBR material library, a capsule character controller with no physics dependency,
procedurally modelled and animated weapons and soldiers, and a synthesised audio mix.

The constraint that shapes the project is **zero external assets**. There is not one `.png`,
`.gltf` or `.wav` anywhere in it. Every texture is generated at runtime from noise fields.
Every mesh, from a shipping container to the vent slots on a carbine handguard, is emitted
vertex by vertex in JavaScript. Every sound, including both convolution reverb impulse
responses, is built from oscillators, noise buffers and biquads. That is not a stunt. Working
without assets forces every decision to be a number in a file you can read, and it makes the
art direction the only thing holding the image together. If the palette is wrong, nothing
rescues it.

## The rendering pipeline

The renderer never draws to the screen. `core/engine.js` owns two scenes and two cameras and
renders in a fixed order: a **normal and roughness prepass** into an RGBA8 target (view-space
normals in RGB, linear roughness in alpha, with transparent surfaces and particles excluded by
layer because they poison occlusion); the **world scene** into an RGBA16F half-float target
with a depth texture; then the **viewmodel scene** into that same target with depth cleared and
colour kept, so the weapon can never intersect world geometry while still writing depth for the
temporal and defocus passes.

`core/postfx.js` owns the final image. Every pass is a hand-written `RawShaderMaterial` in
GLSL ES 3.00 drawn over a single fullscreen *triangle* rather than a quad, because a quad's
shared diagonal shades its edge pixels twice and breaks derivative continuity along the seam.
There is no `EffectComposer`. The chain, in order:

- **Temporal anti-aliasing.** Eight-sample Halton(2,3) sub-pixel jitter on the projection
  matrix, history reprojected from depth and the previous unjittered view-projection,
  Catmull-Rom resampling, and YCoCg neighbourhood variance clipping so the history cannot
  smear a moving edge into a ghost.
- **Screen-space ambient occlusion.** Hemisphere kernel over the prepass normals, sixteen taps
  at `high` and eight at `medium`, interleaved noise, depth-aware bilateral blur, applied
  multiplicatively to indirect light only.
- **Motion blur**, eight velocity-buffer taps at shutter 0.5 and depth-rejected, then **depth
  of field** on aim-down-sight only, hexagonal bokeh, three directions in two passes.
- **Bloom.** An energy-conserving mip chain: six downsamples with the thirteen-tap
  Karis-average filter, then five 3x3 tent upsamples. The Karis weighting runs only on the
  first downsample, which is where fireflies would otherwise enter.
- **Composite.** Lens dirt, radius-scaled chromatic aberration, exposure, AgX tone mapping, the
  filmic grade, vignette, animated grain, CAS sharpening, then the sRGB transfer.

Every intermediate target is half-float and tagged linear. The sRGB encode happens exactly
once, in the last fragment shader. Nothing else encodes. AgX is Troy Sobotka's transform:
Rec.2020 primaries, a desaturating inset basis, a sixth-order fit of the sigmoid across a log
window of -12.47 to +4.03 EV around mid grey, then the outset, paired with an ASC-CDL look and
a saturation restore, since base AgX is contractually neutral and is never shipped naked. The
reason for choosing it over an ACES approximation is specific: a muzzle flash under AgX rolls
off orange to yellow to white the way film does, instead of clipping to a magenta blob.

Shadows are cascaded via the vendored CSM addon: four cascades at `high` down to two at `low`,
practical splits at lambda 0.86, 140 m range, cross-cascade fading. Per-cascade bias comes from
the measured world size of a shadow texel rather than tuned constants, and an optional
contact-hardening filter takes its penumbra width from the sun's real angular diameter. At
eight degrees of elevation every shadow in frame is roughly ten times longer than the object
casting it, so the shadow solution is the image. Nothing in the chain allocates during a frame,
every HDR fetch passes a NaN scrub (one bad texel otherwise poisons the temporal history for
the session), and if `EXT_color_buffer_float` is missing the targets degrade to RGBA8 and the
demo keeps running.

## Art direction

A rail freight yard on the edge of an Eastern European industrial town, an hour before dusk.
The sun sits at eight degrees of elevation and 252 of azimuth, low and hard from the west,
raking across the yard. Everything it touches is warm. Everything it does not touch falls into
cool, sky-filled shadow. That one decision is the entire look, and `src/world/art.js` exists so
that no other file is allowed to have an opinion about it.

The sun is not painted. `world/sky.js` derives its colour and intensity from Rayleigh, Mie and
ozone extinction through a Kasten-Young air mass, and at eight degrees that lands within a few
percent of the authored `PALETTE.sun` on its own. The golden hour is what eight degrees does to
a spectrum, not a swatch someone picked. Saturation is held at 0.94 through the grade so the
few saturated hits carry the frame: rust, hazard yellow, tarpaulin blue, tracers, muzzle flash.

The interesting part of `art.js` is not the palette but the comments recording values that were
recalibrated against real renders:

- **`hemiSkyIntensity`**, the sky fill that makes an unlit face read cool, went 0.85 to 1.20
  and back to 0.55. The 1.20 was chosen while a shader chunk was being injected into every
  program twice, which broke six materials and washed the image out; against that damage,
  cranking the blue fill looked like it was helping. With the injection fixed it turned every
  shadowed surface electric blue. At 0.55 the sun dominates, 4.6 against 0.55.
- **`exposure`** went 0.92 to 1.15 to 3.4. At 0.92 nothing ever crossed the tone curve's
  shoulder: peak luminance measured 228 to 244 out of 255 with zero pixels above 254, so the
  image ran entirely on AgX's linear mid-slope and read as a grey-box render. 3.4 came from
  sweeping the live render at 2.2, 3.6 and 5.5 and reading the frames back.
- **`bloomThreshold`** was 1.0, which nothing in any frame ever reached, so the pass never
  fired and what looked like glow was fog inscatter. At 0.75 it catches the sun disc, tracers,
  muzzle flash and metal speculars and nothing else, and the strength rose to 0.14 to match.

The pattern is the same in all three: measure the frame, then trust the measurement over the
impression. Practical lights are the only point lights and each has a visible fixture, work
lamps and a burning barrel with a fuel-starved flicker.

## The map

Roughly 110 by 90 metres of playable ground in three combat spaces, each joined to its
neighbours by two routes so no space has a single choke.

**The Yard** is the open middle. Five running tracks at 8 m centres, with container stacks laid
along the midlines between them so freight never stands on the rail it was unloaded from. Stack
heights step 3/1/2 and 2/1/3 along each row with deliberate gaps forming cross lanes, and door
ends alternate so there is always a door face and a corner casting in view to carry the scale.
Rolling stock breaks the remaining sightlines: flatbeds, a tank wagon, box vans, one derailed
flat tipped off the rail. Two landmarks orient the player without a compass, a gantry crane
about 19 m to its top beam and an 18 m riveted water tower.

**The Depot**, north-west: a 30 by 32 m maintenance shed, brick to a 2.7 m dado and corrugated
steel above, eaves at 9.2 m. The roof is partly collapsed, so shafts of low sun fall through
onto the floor. Inside are a mezzanine with a steel stair, an overhead travelling crane, and a
real 19 m inspection pit cut out of both the floor slab and the collision, with the spur
bridging it and dying on a buffer stop outside. Its two routes to the Yard are a personnel door
in the south gable and a 5.6 m shell hole beside it.

**The Terraces**, north-east: a 26 by 26 m two-storey brick admin block with an accessible
roof, blown-out windows on every face, two stairwells and a first-floor balcony on the south
elevation overlooking the Yard. Its two routes are a collapsed south-west corner whose rubble
forms a ramp straight from the Yard onto the first floor, and a loading dock on the west face.

One construction detail matters more than it sounds: every hard edge carries a one to two
centimetre chamfer. At eight degrees of key elevation an unchamfered edge has no highlight and
reads as a CSG boolean rather than a manufactured object. Everything is written through one
geometry builder into merged buffers, which is how a map this dense lands at roughly 35 static
draw calls. Collision is separate: box and ramp colliders, a triangle soup with a 2 m grid
broadphase for the raycast hot path, a 0.75 m nav grid, cover points, and nine spawn points,
each guaranteed an occluder within about three metres.

## Procedural materials

Twenty surfaces, from `concreteRough` and `corrugatedSteel` to `gunPolymer` and `skin`,
generated at load into typed arrays. The pipeline is the same for all of them:

    seeded noise fields -> height field -> Sobel normal
                        -> albedo, painted from the palette and driven by the height
                        -> roughness, a function of height and albedo
                        -> ambient occlusion, from a horizon sweep plus a cavity term

The height field comes first and everything else derives from it, which is why the maps agree
with each other. Noise octaves are tileable value noise on a periodic lattice using Perlin's
quintic fade rather than a cubic smoothstep, because the quintic is C2 continuous and a cubic
leaves faint grid creases once you differentiate it to build a normal. The AO is a
multi-direction horizon sweep over the same field with a high-frequency cavity term on top, so
panel grooves and the shadowed sides of aggregate stones darken instead of sitting at 1.0.
Output is packed ORM (occlusion, roughness, metalness, height), exactly what Three.js samples,
so a hero surface costs three textures rather than five.

**Spatially varying roughness is what stops a surface reading as plastic.** A constant
roughness gives it away immediately, however good the albedo is. Real surfaces vary: paint is
rougher where it has weathered and smoother where it is intact, metal polishes at worn edges
and pits in the hollows, concrete is smoother in the fines and rougher over exposed aggregate.
Because roughness here is computed from the same height field and albedo that produced the
visible detail, the specular response tracks the geometry the eye is already reading, and the
surface stops looking like a photograph wrapped round a box.

Four things are patched into every material via `onBeforeCompile`: a detail normal at 8x UV
using reoriented normal mapping, distance-faded so it dies before it can alias; a world-space
up-facing ash term that settles on horizontal faces, lightens and roughens them and kills the
metallic response, because a dust film is a dielectric; low-frequency world-space macro
variation, which breaks tiling on large planes in a way texture-space work cannot; and analytic
height fog with Henyey-Greenstein inscattering, driven from one shared uniform block so the sky
module mutates a single object and every surface follows. On top sits Kaplanyan-style specular
anti-aliasing, widening roughness by local normal variance, which is the difference between a
sparkling, crawling mess in motion and a solid one.

## Weapons and game feel

Three weapons: the MK18 carbine at 780 rpm, the Vector SMG at 1100 rpm and the DMR14 marksman
rifle at 300 rpm semi-auto, with 30, 33 and 20 round magazines and 0.22, 0.17 and 0.30 second
aim times. Each is a built mesh of roughly ninety primitives: receiver, vented handguard,
muzzle device, magazine, stock with a cheek riser, charging handle, ejection port, optic with a
glass element and an emissive reticle. Static parts merge per material at build time, so a
rifle costs five to seven draw calls and only genuinely animated parts stay separate.

Everything below the viewmodel root lives in camera space: the root copies the viewmodel
camera's world transform every frame, so the pose group's local numbers are literally "metres
in front of and to the right of the eye". That is what makes exact sight alignment possible.
The aimed pose is derived arithmetically from the optic's own local position rather than
hand-tuned, so the reticle cannot drift off centre.

Recoil is a second-order critically damped spring integrated semi-implicitly, sub-stepped so a
20 Hz frame cannot make a 340 N/m spring explode. Critical damping is what stops recoil looking
bouncy. A shot enters as an instantaneous velocity impulse, and the impulse needed to reach a
given peak is derived from the stiffness, so the per-weapon numbers are real peak angles.

Recoil patterns are **learnable, not random**. Each weapon carries a twelve-entry table of
pitch and yaw multipliers indexed by round number in a burst. The MK18 climbs near vertically
for the first five, walks left through rounds six to nine as the grip loads up, then snaps back
right into a shallow drift. The Vector, with almost no time to correct between rounds, is a
tight fast right-hand hook. A small random ride-along sits on top, deliberately far smaller
than the pattern step, so the shape stays readable after a dozen magazines and a player who
traces it can hold a twenty-round burst on a torso at 30 m. **Visual recoil is not camera
recoil**: the viewmodel figures run about 2.2 times the camera figures, which makes the gun
look like it is being fought while the crosshair stays trackable, and camera recoil partially
auto-recentres when the player stops firing.

Reloads run on a small keyframe track system with per-track easing, in two distinct sequences:
tactical, which keeps a round in the chamber, and empty, which adds the bolt release. Both emit
sub-events at the right frames, so audio and the HUD stay in step with the animation rather
than with a timer. The arms are a gloved two-arm rig posed by analytic two-bone IK, so the
support hand stays on the handguard through recoil, sway and the reload tracks instead of
floating. Spread is modelled per weapon with separate hip, aimed, per-shot bloom, bloom
ceiling, decay, movement and airborne terms, exact on the first shot when aimed and stationary.

## Performance

Four presets, `low` through `ultra`, drive render scale, cascade count and shadow map size,
which post passes run at all, bloom mip count, particle multiplier and decal cap. The target is
60 fps at 1080p on integrated graphics at `medium`, under 300 draw calls and under 900k visible
triangles. Every particle, casing, tracer, flash and haze billboard costs two draw calls: one
instanced mesh for the alpha pool, one for the additive pool, over a generated 4x4 atlas. A
module that throws during construction is replaced with an inert stub and reported on an error
card, so one failure degrades the demo instead of blanking it.

## Honest limitations

This is a demo, not a shipped game, and the gap is real.

Ashfall does not match a native AAA title on asset density. A shipping shooter's freight yard
would carry thousands of hand-modelled unique props with sculpted, baked, hand-painted
materials at 4K. This map has a prop library of a few dozen procedural primitives recombined,
and textures generated at 512 or 1024 at load time. It reads as a coherent place at playable
range. It does not survive being walked up to and inspected the way an authored asset does.

It does not match one on animation quality. There is no skeletal animation data, because there
are no asset files, so every soldier is a bone hierarchy driven by procedural gait, look-at and
IK, and every weapon animation is a keyframe track written as numbers in a source file.
Procedural animation gets you plausible weight and timing. It does not get you the specificity
of a captured or hand-keyed performance, and the difference shows most in death and transitions.

It does not match one on content volume either. One map, three weapons, a handful of opposing
soldiers, no campaign, no progression, no multiplayer, no save. Shadow range stops at 140 m,
decals cap at 256 and recycle, and enemy counts stay small enough to keep the AI honest inside
a browser's single main thread.

Parity was never the goal. The goal was to find out how far a browser, one vendored rendering
library and runtime procedural generation can be pushed when the art direction is decided first
and everything else is made to serve it. The answer is: further than expected, and the
pipeline, the lighting model and the game feel are where the distance shows.

## Do's and don'ts

- Read `src/world/art.js` before touching any colour, intensity or fog value. Its comments
  record what was already tried and measured.
- Keep the warm key against cool shadow. Nearly every other value is subordinate to it.
- Keep roughness spatially varying. A constant roughness undoes the whole material library.
- Preallocate. Allocation inside an update or a post pass is a defect, not a style preference.
- Don't add an external asset, apply a tone curve outside the composite shader, or introduce a
  second shadow-casting directional light. The cascade lights are the sun.
- Don't quote this as a finished game. It is an engine study with a map attached.
