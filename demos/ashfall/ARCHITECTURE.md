# Ashfall — Engine Architecture & Module Contract

`Ashfall` is a browser-native first-person shooter built on Three.js r185, targeting a
console-shooter look and feel: HDR deferred-ish forward pipeline, cascaded shadows, TAA,
mip-chain bloom, ground-truth-ish AO, procedural PBR materials, spring-driven weapon
handling and synthesised audio.

**Hard constraints — every module must obey these.**

1. Static site. No build step, no bundler, no package manager, no network fetches at runtime.
   Everything is an ES module loaded directly by the browser.
2. Three.js is vendored at `./vendor/three.module.js`. Import it with an explicit relative
   path — e.g. from `src/world/level.js` that is `../../vendor/three.module.js`.
   **Never** `import ... from 'three'`; bare specifiers will not resolve.
3. No external assets. No `.gltf`, `.png`, `.jpg`, `.mp3`, no CDN, no `fetch()`.
   All geometry is built procedurally, all textures are generated at runtime into
   `CanvasTexture`/`DataTexture`, all audio is synthesised with the WebAudio API.
   **One documented exception:** `index.html` links three webfonts for the interface. No module
   may depend on them — `styles.css` carries a condensed system fallback stack so the HUD reads
   correctly with the fonts blocked or absent. Nothing the renderer touches may ever load over
   the network.
4. Units are metres, Y is up, Z is the depth axis. `1.0 === 1 metre`.
5. Target 60 fps at 1080p on integrated graphics at the `medium` quality preset.
   Budget: < 300 draw calls, < 900k triangles visible.
6. British English in user-facing copy. No em dashes in UI strings.

---

## 1. Frame flow

`src/main.js` owns the loop and calls modules in this fixed order. Modules never call each
other directly except through the objects handed to them.

```
tick(dt):
  input.update(dt)
  player.update(dt, game)          // writes game.camera position + euler
  weapon.update(dt, game)          // writes viewmodel transforms, fires shots
  ballistics.update(dt, game)      // resolves shots, spawns impacts
  ai.update(dt, game)              // enemy think + move + animate
  fx.update(dt, game)              // particles, decals, tracers
  sky.update(dt, game)             // sun angle, fog, cloud drift
  shadows.update(game)             // CSM cascade fit
  audio.update(dt, game)           // listener pose, mixing
  post.jitter(game.camera, frame)  // TAA sub-pixel jitter, applied to projection
  engine.renderScene(game)         // prepass + world + viewmodel into HDR targets
  post.render(dt, game)            // full post chain, resolves to the canvas
  hud.update(dt, game)             // DOM HUD
```

`dt` is clamped to `[0, 1/20]` seconds. Simulation code must be frame-rate independent.
Springs and dampers use `1 - exp(-k * dt)` style integration, never raw `* dt` lerps.

---

## 2. The `game` object

Built by `main.js`, passed to every `update`. Treat unlisted fields as private.

```js
game = {
  engine,                       // see 3.1
  post,                         // see 3.2
  scene, camera,                // world THREE.Scene / PerspectiveCamera
  viewScene, viewCamera,        // viewmodel scene + camera (see 3.1)
  clock: { time, dt, frame },   // seconds since start, delta, integer frame counter
  input,                        // see 3.9
  quality,                      // see 3.10
  level,                        // from world/level.js
  player,                       // from player/controller.js
  weapon,                       // from player/weapon.js
  ballistics, ai, fx, audio, hud, sky, shadows, materials,
  state: {
    mode: 'menu' | 'playing' | 'paused' | 'dead',
    health: 100, maxHealth: 100, armour: 0,
    score: 0, kills: 0, deaths: 0, streak: 0,
    hitFlash: 0,                // 0..1, decays, drives HUD damage vignette
    lastDamageDir: THREE.Vector3,
  },
  events,                       // tiny emitter: on(name, fn), off(name, fn), emit(name, payload)
}
```

### Event names (the only cross-module coupling permitted)

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `shot` | `{origin, dir, weapon, spread}` | weapon | ballistics, fx, audio |
| `impact` | `{point, normal, surface, material, dir}` | ballistics | fx, audio |
| `hit` | `{enemy, point, damage, headshot, dir}` | ballistics | ai, hud, audio |
| `kill` | `{enemy, headshot, weapon}` | ai | hud, audio, state |
| `damage` | `{amount, from, dir}` | ai | player, hud, audio |
| `reload` | `{phase: 'start'|'magout'|'magin'|'end'}` | weapon | audio, hud |
| `ads` | `{active}` | weapon | post (DOF), audio, hud |
| `footstep` | `{surface, foot, speed}` | player | audio, fx |
| `explosion` | `{point, radius, power}` | any | fx, audio, ai, player |

---

## 3. Module contracts

Each file default-exports nothing; it exports the named factory below. Factories are
synchronous unless marked `async`. Every returned object may carry extra private fields.

### 3.1 `src/core/engine.js` — `createEngine(canvas, quality) -> engine`

Owns the renderer, scenes, cameras and HDR render targets.

```js
engine = {
  renderer,        // THREE.WebGLRenderer, WebGL2, antialias:false (TAA handles it)
  scene, camera,   // world. camera: fov 75 (hipfire), near 0.05, far 600
  viewScene,       // viewmodel scene, own lights, never receives world shadows
  viewCamera,      // fov 60, near 0.008, far 12 — prevents viewmodel near-clipping
  size: { w, h, dpr },
  targets: {
    hdr,           // RGBA16F colour + DepthTexture, the composited world+viewmodel
    normal,        // RGBA8 view-space normals + linear roughness in .a, from the prepass
  },
  prevViewProj,    // THREE.Matrix4, last frame's camera viewProjection, for TAA/motion blur
  resize(w, h),
  setQuality(quality),
  renderScene(game),  // normal/roughness prepass -> world -> viewmodel (depth cleared)
  stats: { drawCalls, triangles, programs },
}
```

- `renderer.toneMapping = THREE.NoToneMapping`, `outputColorSpace` left default. Tone mapping
  and the sRGB transfer are the **final post pass's** job, not the renderer's.
- `renderer.shadowMap.type = THREE.VSMShadowMap` is banned (leaks); use `PCFSoftShadowMap`.
- The viewmodel is rendered with the **depth buffer cleared** but the colour buffer kept, into
  `targets.hdr`, so it never intersects world geometry. It must still write depth so that
  DOF and motion blur can treat it correctly.
- `physicallyCorrectLights` semantics: all lights use physical units, `renderer.useLegacyLights`
  is off (r155+ default).

### 3.2 `src/core/postfx.js` — `createPostFX(engine) -> post`

The full-screen chain. All passes are hand-written `RawShaderMaterial`/`ShaderMaterial` on a
shared fullscreen triangle. No `EffectComposer`.

Chain order (skip a stage when quality disables it):

1. **TAA** — 8-sample Halton(2,3) projection jitter, history reprojected with velocity
   reconstructed from the depth buffer and `prevViewProj`; YCoCg neighbourhood variance
   clipping to kill ghosting; luminance-weighted blend, feedback 0.9 static / 0.6 in motion.
2. **SSAO** — hemisphere kernel over the prepass normals, 16 taps at `high`, 8 at `medium`,
   interleaved noise, depth-aware bilateral blur, applied multiplicatively to indirect only.
3. **Motion blur** — velocity-buffer directional blur, 8 taps, shutter 0.5, clamped to 40 px.
4. **DOF** — ADS only. Circle-of-confusion from depth, hexagonal bokeh, near+far, disabled
   at `low`.
5. **Bloom** — energy-conserving mip chain: 6-level downsample with the 13-tap Karis-average
   filter, 3x3 tent upsample, additively blended at `strength` 0.045. Threshold is soft-knee
   at 1.0 in HDR, so only genuinely bright pixels bloom.
6. **Composite** — lens dirt over bloom, chromatic aberration scaling with radius, AgX tone
   mapping, filmic grade (lift/gamma/gain, split-tone: cool shadows, warm highlights),
   vignette, per-pixel animated film grain, then CAS sharpening, then sRGB transfer.

```js
post = {
  params,               // live-tweakable, see below
  resize(w, h),
  setQuality(quality),
  jitter(camera, frame),// applies/removes the TAA sub-pixel offset on camera.projectionMatrix
  render(dt, game),     // runs the chain, final draw goes to the default framebuffer
  setDOF(active, focusDistance),
}
```

`post.params` must expose at minimum: `exposure`, `bloomStrength`, `bloomThreshold`,
`ssaoIntensity`, `ssaoRadius`, `grainAmount`, `vignette`, `chromatic`, `sharpen`,
`saturation`, `contrast`, `lift[3]`, `gamma[3]`, `gain[3]`, `motionBlurAmount`, `taaFeedback`.

### 3.3 `src/core/shadows.js` — `createShadows(engine, sun) -> shadows`

Cascaded shadow maps via the vendored `../../vendor/CSM.js`.

- 4 cascades at `high`/`ultra`, 3 at `medium`, 2 at `low`. `practical` split mode, lambda 0.86.
- `maxFar` 140 m; beyond that geometry is unshadowed and fog dominates.
- Map size 2048 (`high`) / 1024 (`medium`) / 512 (`low`).
- Normal-offset + slope-scaled bias to kill acne without peter-panning.
- Must call `setupMaterial(material)` for every world material — expose
  `shadows.register(material)` and have `world/materials.js` route through it.

```js
shadows = { csm, register(material), update(game), setQuality(q), dispose() }
```

### 3.4 `src/world/materials.js` — `createMaterials(renderer, shadows) -> materials`

**All** procedural PBR texture synthesis lives here. Nothing else in the codebase may create
a texture. Generate into offscreen canvases at 512 or 1024 and build full channel sets:
albedo, normal (derived from a height field via Sobel), roughness, AO, and where relevant a
height map for parallax occlusion.

Required surfaces, each art-directed to the palette in `src/world/art.js`:

`concreteRough`, `concretePanel`, `asphalt`, `rubble`, `brickPainted`, `metalPainted`,
`metalRust`, `corrugatedSteel`, `woodPlank`, `sandbag`, `glassDirty`, `plaster`,
`gravel`, `dirt`, `tarpaulin`, `gunmetal`, `gunPolymer`, `gunWood`, `fabric`, `skin`.

```js
materials = {
  get(name),              // -> THREE.MeshStandardMaterial (cached, shadow-registered)
  getTextures(name),      // -> {map, normalMap, roughnessMap, aoMap, heightMap?}
  triplanar(name, scale), // -> material variant with triplanar mapping, for terrain/rubble
  makeDecal(kind),        // 'bulletConcrete'|'bulletMetal'|'bulletWood'|'blood'|'scorch'
  env,                    // PMREM-filtered environment from the sky, set by world/sky.js
  dispose(),
}
```

Texture authoring rules that separate this from a hobby demo:
- Every albedo needs **three octaves** of value noise plus a large-scale blotch layer, so the
  surface never tiles visibly. Detail-normal blend at 8x UV on top of the base normal.
- Roughness must be **spatially varying and correlated with albedo** (worn edges are smoother
  on metal, rougher on paint). A constant roughness reads instantly as amateur.
- Add directional grunge: water streaks run down, dust settles up-facing (handled by a
  world-normal term in the shader via `onBeforeCompile`).
- AO baked from the height field's local occlusion, not a flat 1.0.

### 3.5 `src/world/sky.js` — `createSky(engine, materials) -> sky`

Physically-motivated dusk sky, the primary light source, plus atmospherics.

- Preetham/Hosek-style analytic sky dome on a `BackSide` sphere in HDR, sun disc with limb
  darkening, Mie forward-scattering halo.
- `DirectionalLight` sun: colour and intensity **derived from the sun elevation**, not
  hard-coded per look — golden hour must fall out of the maths.
- `HemisphereLight` for sky/ground bounce, plus a PMREM cubemap generated once from the sky
  dome and assigned to `scene.environment` and `materials.env`.
- Exponential height fog with an inscattering term that brightens towards the sun; this is
  what sells the dusty air. Implement via `onBeforeCompile` on world materials, not
  `scene.fog` alone.
- Screen-space god rays / volumetric light shafts from the sun, radial blur on an occlusion
  buffer, composited additively — expose `sky.godrayTexture` for `postfx` to consume.
- Slow drifting cloud layer (procedural, curl-warped fBm) on a large dome.

```js
sky = { dome, sun, hemi, update(dt, game), setTimeOfDay(t01), godrayTexture, params }
```

### 3.6 `src/world/level.js` — `createLevel(scene, materials) -> level`

The playable map. See §4 for art direction. Builds all static geometry, merges aggressively
with `BufferGeometryUtils.mergeGeometries`, and produces the collision representation.

```js
level = {
  root,                     // THREE.Group added to scene
  colliders,                // array of {type:'box'|'ramp', min, max, quat?, surface}
  triangles,                // flat Float32Array of world-space collision triangles
  spawnPoints,              // [{pos: Vector3, yaw: number}]
  coverPoints,              // [{pos, normal}] for AI
  navGrid,                  // {origin, cell, w, h, walkable: Uint8Array} for AI pathing
  raycast(origin, dir, maxDist) -> {hit, point, normal, distance, surface} | null,
  sampleSurface(point, normal) -> 'concrete'|'metal'|'wood'|'dirt'|'gravel'|'glass'|'sandbag',
  bounds,                   // THREE.Box3
  update(dt, game),
}
```

`raycast` is the hot path for ballistics and AI line-of-sight. It must use a broadphase
(uniform grid or BVH over `triangles`), not a linear scan, and must be allocation-free —
reuse scratch vectors.

### 3.7 `src/player/controller.js` — `createPlayer(game) -> player`

Capsule character controller. **No physics library.**

- Capsule radius 0.35 m, height 1.8 m, eye at 1.65 m.
- Speeds: walk 3.2, sprint 6.1, crouch 1.6, ADS 2.1 m/s. Air control 0.28.
- Acceleration model with ground friction (Quake-style `accelerate`/`friction`), so the
  movement has weight but stays responsive. Sprint has a 0.12 s spin-up.
- Gravity 22 m/s², jump impulse 6.4 m/s, coyote time 0.09 s, step-up height 0.4 m.
- Slide: crouch while sprinting, with a friction curve and a camera dip.
- Mantle: auto-vault ledges up to 1.2 m when moving forward into them.
- Collide-and-slide against `level.triangles`, 4 substeps, depenetration epsilon 1e-3.
- Camera: view bob (figure-of-eight, amplitude scaling with speed and suppressed in ADS),
  landing dip, lean on strafe (roll up to 1.1°), breathing idle sway, and a
  **separate recoil/kick transform** applied after look so recoil never fights mouse input.
- Head-bob must be spring-smoothed, never a raw sine slapped on the camera.

```js
player = {
  position, velocity, onGround, crouched, sprinting, sliding,
  eye,                      // world-space eye position, updated each tick
  yaw, pitch,               // radians, pitch clamped to +-1.54
  update(dt, game),
  applyRecoil(pitchKick, yawKick),
  damage(amount, dir),
  teleport(pos, yaw),
  surfaceUnderfoot,         // string, drives footstep audio
}
```

### 3.8 `src/player/weapon.js` — `createWeapon(game) -> weapon`

Procedural weapon models plus all handling feel. Ships **three** weapons the player can cycle
with `1`/`2`/`3` or the mouse wheel:

| id | archetype | rpm | dmg | mag | ads time |
|---|---|---|---|---|---|
| `mk18` | carbine, full-auto | 780 | 33 | 30 | 0.22 s |
| `vector` | SMG, very high rate | 1100 | 22 | 33 | 0.17 s |
| `dmr14` | marksman, semi-auto | 300 | 62 | 20 | 0.30 s |

Model quality bar: each weapon is a **built mesh**, not boxes — receiver, barrel, handguard
with vent slots, muzzle device, magazine, pistol grip, stock with a cheek riser, charging
handle, ejection port, trigger, bolt catch, sling loops, a red-dot or LPVO with a glass
element that renders an emissive reticle, and separate materials for gunmetal, polymer and
rubber. Bevel the silhouettes; hard 90° edges read as programmer art. Add a first-person
**arms/gloves** mesh so the weapon is held, not floating.

Handling:
- Spring-damper recoil with distinct **rotational** (pitch/yaw/roll) and **positional**
  (kick back along Z) components, per-weapon recoil patterns that are learnable, not random.
- Visual recoil ≠ camera recoil. The viewmodel kicks harder than the camera; camera recoil
  partially auto-recenters when the player stops firing.
- ADS: position/rotation lerp on a smootherstep curve to a sight-aligned pose, FOV pull-in on
  the world camera (75 -> 58 for `mk18`), and DOF enabled via the `ads` event.
- Weapon sway: mouse-delta driven lag with an inertia spring, plus idle breathing.
- Full reload sequences with distinct tactical (round in chamber) vs empty (bolt release)
  paths, driven by a small keyframe track system with easing, emitting `reload` sub-events.
- Bolt cycling, ejection-port animation, and a brass casing ejected per shot with tumbling
  physics and a metallic bounce sound.
- Sprint pose, inspect animation on `F`, and a low-ready idle.

```js
weapon = {
  current, weapons,          // active def and all defs
  ads, adsProgress,          // bool, 0..1
  ammo, reserve, reloading, firing,
  root,                      // THREE.Group in engine.viewScene
  update(dt, game),
  switchTo(id), reload(), triggerDown(), triggerUp(),
  muzzleWorld(target)        // writes world-space muzzle position for FX
}
```

### 3.9 `src/player/ballistics.js` — `createBallistics(game) -> ballistics`

- Hitscan with a **ballistic drop and travel-time simulation** for the DMR (visible tracer
  lag at range), pure hitscan for close range.
- Spread cone driven by stance, movement, ADS state and sustained fire; first-shot accuracy
  is perfect when ADS and stationary.
- **Wall penetration**: bullets pass through thin materials (`wood`, `sandbag`, `glass`,
  sheet metal) losing damage by material density and thickness; concrete stops them.
  Requires an exit-point trace.
- Damage falloff by distance, headshot 2.2x, limb 0.85x.
- Tracers on every 3rd round, spawned as stretched billboards with a bright HDR core so they
  bloom, travelling at a visible speed rather than instantly popping in.
- Emits `impact` and `hit`; never draws anything itself.

```js
ballistics = { update(dt, game), fire(origin, dir, weaponDef, game), pending }
```

### 3.10 `src/ai/enemies.js` — `createAI(game) -> ai`

6 to 10 opposing soldiers, procedurally modelled and **procedurally animated** — no skeletal
animation assets, so build a simple bone hierarchy and drive it with IK/proc-anim:

- Body: helmet, plate carrier with pouches, limbs; two-bone IK arms holding a rifle, legs
  with a procedural gait (foot planting, hip sway, contra-body rotation), head look-at,
  additive flinch on hit, and a ragdoll-ish death that respects the last damage direction.
- Behaviour: finite state machine — `idle`, `patrol`, `investigate`, `advance`, `combat`,
  `takeCover`, `suppress`, `reload`, `flee`, `dead`. Vision cone with distance falloff and
  line-of-sight through `level.raycast`; hearing from gunshots.
- Uses `level.coverPoints` and `level.navGrid` for A* pathing, with string-pulling so paths
  don't look gridded.
- Fires with human-plausible error, burst discipline, suppression that pins the player, and
  a first-shot delay so the player is never insta-killed.
- Health 100, hit zones head/torso/limb, gib-free but with impact blood mist and a stagger.

```js
ai = { enemies, update(dt, game), spawnWave(n), damageEnemy(enemy, dmg, point, headshot, dir), alive }
```

### 3.11 `src/fx/particles.js` — `createFX(game) -> fx`

GPU-instanced pools, zero per-frame allocation, all additive/alpha sorted correctly.

Required effects: muzzle flash (multi-lobed, with a real `PointLight` flash that lasts 40 ms),
barrel smoke that accumulates with sustained fire, per-surface impact bursts (concrete dust
puff + spark shower on metal + wood splinters + dirt clods + glass shards), bullet-hole decals
projected onto surfaces with correct orientation and a depth-faded edge, blood mist and
ground pools, brass casings, tracers, explosion fireball + shockwave ring + dust wall,
ambient floating dust motes catching the sun, distant smoke columns, and heat haze over hot
surfaces.

```js
fx = {
  update(dt, game),
  spawnImpact(point, normal, surface, dir), spawnMuzzle(pos, dir, scale),
  spawnBlood(point, normal, dir), spawnCasing(pos, vel, spin),
  spawnTracer(from, to, speed), spawnExplosion(point, radius),
  addDecal(point, normal, kind, size),
}
```

Decals must be capped (256) with FIFO recycling and fade out at the cap edge.

### 3.12 `src/audio/audio.js` — `createAudio(game) -> audio`

100% synthesised WebAudio. No files.

- Gunshots: layered — a transient click, a body from filtered noise bursts through a
  resonant lowpass with a fast decay envelope, a low-frequency thump, and a **tail** sent to
  a convolution reverb whose impulse response is generated procedurally (exponential noise
  decay, ~1.4 s, with an early-reflection pattern that suggests a large outdoor yard).
- Distance modelling: `PannerNode` HRTF, plus a lowpass whose cutoff falls with distance
  (air absorption) and a delay of `distance / 343` so far shots arrive late.
- Indoor/outdoor reverb send driven by an overhead raycast.
- Per-surface impact sounds, footsteps that vary per surface with subtle randomisation,
  brass tinkle, mag-in/mag-out/bolt mechanical clicks, cloth movement, whizz-by cracks for
  near misses, tinnitus + ducking after an explosion, and a low ambient wind bed.
- Master chain: bus compressor, gentle limiter, and a `masterGain` the settings menu drives.

```js
audio = { ctx, resume(), update(dt, game), setVolume(v), muted, playOneShot(name, opts) }
```

### 3.13 `src/ui/hud.js` — `createHUD(game) -> hud`

DOM + a small canvas overlay, styled in `styles.css`. Modern-military-shooter language, but
original — do not reproduce another game's exact HUD artwork.

- Dynamic crosshair whose gap tracks the live spread value, fading out in ADS.
- Hitmarker (white) / headshot (chevron, higher pitch) / kill (red X), each with a punchy
  scale-and-fade.
- Ammo block: mag/reserve with tabular figures, a low-ammo state, and a reload prompt.
- Health: regenerating, with a blood-vignette that intensifies as health drops, plus a
  directional damage indicator arc showing where fire came from.
- Kill feed, killstreak callouts, XP pop-ups that rise and fade.
- Compass strip with cardinal ticks and objective markers.
- Minimap: top-down canvas render of `level.navGrid` with the player arrow, enemy blips that
  only appear when the enemy fires, and a rotating view cone.
- Hit-direction, low-health heartbeat, and a clean pause/settings overlay.
- Everything must be `requestAnimationFrame`-cheap: no layout thrash, transform/opacity only.

```js
hud = { update(dt, game), show(), hide(), setMode(mode), notify(text, kind) }
```

### 3.14 `src/ui/menu.js` — `createMenu(game) -> menu`

Title screen, settings, pause. Pointer-lock handling lives here.

- Title: the game's name, a slow parallax camera drift over the map behind it, `Play`.
- Settings: quality preset (`low`/`medium`/`high`/`ultra`), FOV slider, sensitivity,
  invert Y, master volume, film grain toggle, motion blur toggle, TAA toggle, crosshair
  colour. Persisted to `localStorage` under `ashfall.settings`.
- Pause on `Esc`, which must also release pointer lock, and a controls reference card.
- A loading screen shown until the first frame is rendered, with real progress.

```js
menu = { open(page), close(), settings, onChange(fn), update(dt, game) }
```

### 3.15 `src/core/input.js` — `createInput(canvas) -> input` (written by main)

```js
input = {
  keys,                     // Set of KeyboardEvent.code
  down(code), pressed(code),// held / edge-triggered this frame
  mouse: { dx, dy, left, right, wheel },
  locked,
  sensitivity,
  update(dt),               // consumes edges, zeroes deltas
}
```

---

## 4. Art direction — `src/world/art.js` is the single source of truth

**Setting.** `Ashfall` — a bombed-out rail freight yard on the edge of an Eastern European
industrial town, an hour before dusk. Ash and concrete dust hang in the air. The sun is low
and hard from the west, raking across the yard; everything not lit by it falls into cool
sky-blue shadow. This warm/cool split is the entire look — protect it.

**Palette.** Sun `#ffcf9a` at elevation 8°, sky zenith `#3f6f9e`, horizon haze `#d8c3a4`,
ground bounce `#7a6647`. Concrete reads `#8d8880` in sun, `#4a5460` in shadow. Rust `#8a4a28`,
faded rail green `#3d4a3f`, tarpaulin blue `#2d4a63`, warning yellow `#c8a02c`. Keep
saturation low overall so the few saturated hits (rust, hazard paint, tracers, muzzle flash)
carry the frame.

**Composition.** The map must have real silhouette hierarchy: a tall gantry crane and a water
tower as landmarks readable from anywhere, mid-ground rolling stock and container stacks that
break sightlines, and low cover (sandbags, concrete barriers, rubble piles) that creates
lanes. Three distinct combat spaces connected by two flanking routes each, so the space is
legible and never a flat arena.

**Layout.** Roughly 110 m x 90 m playable.
1. **The Yard** — open rails, container stacks, wrecked flatbed wagons, the gantry crane.
2. **The Depot** — a bombed-out maintenance shed, roof partly collapsed so shafts of sunlight
   fall through onto the floor, interior gantries and a pit.
3. **The Terraces** — a two-storey brick admin block with blown-out windows overlooking the
   yard, stairwells, and a collapsed corner that forms a rubble ramp.

**Detail bar.** Every surface needs a story: cable runs, conduit, drainpipes, rebar poking out
of broken concrete, weeds through the sleepers, scattered debris, tarps, oil stains, graffiti,
a burnt-out car, scorch marks, sandbag emplacements, hanging chains that sway. Empty flat
polygons are the single biggest tell of a non-AAA scene — nothing may be untextured, and
nothing large may be a bare unbroken plane.

**Lighting rules.**
- One dominant key (the sun). Everything else is fill and must stay subordinate.
- Bounce light is warm off the ground, cool from the sky.
- Practical lights (a few work lamps, a burning barrel) are the only point lights and they
  must be motivated by visible fixtures.
- Contact shadows matter more than shadow distance; get the AO right.
- The dust in the air is what makes light *visible* — commit to the volumetrics.

---

## 5. Quality presets

`quality` is one of `low` | `medium` | `high` | `ultra`, and each module reads it via
`setQuality`. Defaults: detect via `renderer.capabilities` and device memory, default `high`
on desktop, `low` on touch devices.

| | low | medium | high | ultra |
|---|---|---|---|---|
| render divisor | 2 | 1 | 1 | 1 |

Render scale is an integer **divisor** of the backbuffer, not a fractional multiplier. A
fractional scale meant the internal buffer was not a whole-pixel map of the backbuffer, and the
final blit resampled the whole 3D image through a bilinear filter while the DOM HUD drawn over
it did not — which read as "the 3D is soft but the interface is crisp" in review after review.
`renderer.setSize` must be given the **backbuffer** size so the final post pass writes at native
resolution; the internal targets are then derived from it by the divisor.
| shadow cascades / size | 2 / 512 | 3 / 1024 | 4 / 2048 | 4 / 2048 |
| TAA | off | on | on | on |
| SSAO | off | 8 tap | 16 tap | 16 tap |
| motion blur | off | off | on | on |
| DOF | off | off | ADS | ADS |
| bloom mips | 4 | 5 | 6 | 6 |
| particles | 0.35x | 0.6x | 1.0x | 1.4x |
| decals | 64 | 128 | 256 | 256 |
| god rays | off | half res | half res | full res |

---

## 6. Coding standards

- ES2022 modules, `const`/`let`, no `var`. No TypeScript syntax — these files run raw.
- **Zero allocation in the hot path.** Preallocate `Vector3`/`Matrix4` scratch objects at
  module scope. `new THREE.Vector3()` inside `update()` is a defect.
- Dispose geometries, materials and textures in `dispose()`.
- Guard WebGL feature use: if `EXT_color_buffer_float` is missing, fall back to RGBA8 and
  keep running rather than throwing.
- No `console.log` in the shipped path; use `game.debug` gated logging.
- Comment the *why* for anything non-obvious (shader maths, spring constants, magic numbers).
- The page must never throw. Wrap module init in try/catch and surface a readable error card.
