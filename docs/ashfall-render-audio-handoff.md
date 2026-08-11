# Ashfall — render and audio quality: state, evidence, and what is left

**Status:** partial. Audio is done and verified. The renderer fix is diagnosed in full,
partially implemented, and **unverified**.
**Branch:** `claude/ashfall-aaa`
**Repo:** https://github.com/koltregaskes/elusion-works
**Everything below is repo-relative.** e.g. `demos/ashfall/src/world/art.js`.

---

## 1. What Ashfall is, and the constraints you cannot break

`demos/ashfall/` is a first-person shooter that runs in a browser. Roughly 53,000 lines of
JavaScript across `src/`.

Constraints, all of them load-bearing:

- **Three.js r185, vendored locally.** No build step, no bundler, no npm packages at runtime,
  no CDN. Plain ES modules the browser loads from disk. Opening `index.html` through a static
  server is the entire toolchain.
- **Zero external assets.** Every texture, mesh, sky, sound and font is generated procedurally
  in JavaScript at runtime. There are no images, no `.wav` files, no `.gltf`. This is the
  central design constraint of the demo and it is not negotiable — "just use a better texture"
  is never an available fix; you change the generator.
- **It must run on a small mini PC with integrated graphics.** Quality presets exist
  (`low` / `medium` / `high`). **`medium` is the default and is what most players get.** A fix
  gated to `high` mostly does not ship. Several of the bugs below are exactly this: a feature
  that exists, works, and is compiled out at the default preset.
- **`demos/ashfall/src/world/art.js` is the single source of truth for the look.** Palette,
  light intensities, fog, grade. No other file may hard-code a look value. This rule was being
  quietly broken in two places (see §5).

Repo rules are in `AGENTS.md`. The one that bites most often: **comments explain invariants and
non-obvious constraints. They are not a changelog and not a diary.** Parts of this codebase
violate that badly — long archaeological essays about what was tried and rejected. Do not
imitate them; trim them where you touch them.

---

## 2. What the player actually said

This is the specification. Everything else is inference from it.

> "Okay this is the performance. It is dramatically better. I'm on my mini PC and it runs quite
> smoothly. **The sound effects are pretty awful though.** One thing I can't get working is the
> mouse look up. I would also like to customise the controls... I don't think the spacebar jump
> is working... **I think the level quality is about 2 and we need to get up to 10.**"

Then, after the audio was reworked once and the input bugs were fixed:

> "I think the sound's awful and not really feeling the graphics. **I think they need to be
> bumped up from 1/10 to 10/10. I feel like it just needs to be a little bit more 3D. There's
> something wrong with them. It feels a bit flat to me and doesn't feel like it's 2026. It feels
> like a 2019 game or something.** ... I'm not accepting anything else other than 10/10. I'm not
> saying this is a AAA $70 game but the AAA quality is what I'm after."

"A bit flat" and "more 3D" turned out to be a precise, literally measurable description of the
defect. Take it at face value.

---

## 3. Already shipped and merged to `main`

| PR | What |
|---|---|
| #19–#22 | Ground scatter, TAA viewmodel fixes, transparent-arm and DOF fixes, performance presets |
| #25 | **Input frame-order bug** — `input.update()` cleared mouse deltas and key edges at the *top* of the frame, one line before any consumer could read them. JS is single-threaded so DOM events only arrive *between* frames; held state survived, which is why movement and hold-to-fire worked while mouse-look and jump were dead. The clear now runs last. Also added fully rebindable controls with mouse side-button support (`Mouse0`–`Mouse4` are ordinary bindable codes). |
| #26 | First audio pass — measured per-voice synthesis overhaul |

The performance complaint and both input complaints are **resolved and live**. What remains is
quality: graphics and sound.

---

## 4. Audio — done, verified, on the branch

Two faults, both invisible to the per-voice test harness that had been used until then, because
that harness measures every sound *alone* — precisely the condition under which the master bus
and the ambience bed do nothing.

**Fault 1: the ambience bed was louder than the gunfire, and it was a sub-bass drone.**
Measured at the output: ambience RMS **−22.7 dBFS** with its strongest octave at **20–63 Hz**.
A single rifle shot measures −31.8 dBFS RMS. The wind was ~9 dB *louder* than the gun it sits
under, and it was static — 1.6 dB of movement over a 24 s render, i.e. a texture, not a place.

**Fault 2: the guns were thin and harsh.** The loudest octave of a rifle shot was **4–8 kHz** —
the band the ear is most sensitive to, where "harsh", "papery" and "cheap" live. Root cause
found by characterising the noise buffers: **`bufBright` is a first difference (+6 dB/oct)**,
so anything fed from it is a treble layer regardless of what its filter says — and it was
feeding the *loudest layer of every gunshot*. The previous round's gates rewarded short attack
and high spectral centroid, which is how it got there. **The gates were measuring the wrong
thing.**

Fixed in commit `b79ed54`:

| | before | after |
|---|---|---|
| Ambience RMS | −22.19 dBFS | **−37.45 dBFS** |
| Ambience strongest octave | 20–63 Hz | 63–125 Hz (20–63 now 8.7 dB below 125–500) |
| Ambience movement (1 s RMS windows) | 1.6 dB (static) | **5.8 dB** (gusting) |
| mk18 4–8 kHz, rel. own peak band | −0.5 dB (i.e. the peak) | **−8.8 dB** |
| mk18 8–16 kHz, rel. peak | −13 dB | **−30 dB** |
| Attack to 90% | — | 0.52–0.82 ms (still instant) |
| Player vs enemy peak | — | 9.3 dB in the player's favour |

Structure changed to an explicit `blast` tier (wide, low, pink-fed — carries the energy) plus an
`edge` tier, with overall level decoupled from `crack.g` so "less harsh" stops also meaning
"quieter". Gameplay battery 13/13.

**Open audio items, honestly stated:**

1. **Nobody has heard any of this.** It is all spectra and envelopes. This needs ears before it
   can be called done.
2. **Weapon class distinctness narrowed.** Centroids are now 825 / 1013 / 1396 Hz (vector /
   mk18 / dmr14), a 1.7× spread, down from 2.9×. The old spread was achieved by making two of
   the three guns harsh, so this is not simply a regression — but if the classes need pushing
   further apart, this is the number to push, and it wants ears first.
3. **In-game ambience level is inferred, not measured.** The offline harness measures
   `buildAmbience`'s constructor defaults; `update()` overwrites them on frame one. The
   `update()` targets were set to land on the same values (gust 0.0499 vs 0.050, low 0.0302 vs
   0.030) so it should be within a fraction of a dB — but it was never confirmed in a live run.
4. **Ambient detail events are unmeasured.** Creak / chain-rattle / clank are scheduled from
   `update()`, which the harness does not drive. They are known not to throw. Their levels are
   judgement, not measurement.
5. **Footsteps have a mild rising shelf above 8 kHz** from the same `bufBright` pattern — 21 dB
   below their peak band, so low priority, but it is the same bug class.

---

## 5. The renderer — the full diagnosis

### 5.1 The measurement that defines the problem

Captured frames, luminance histogram:

```
yard    max 226   median 54   below code 16: 12.5%   above 240: 0.00%   stdev 53.6
depot   max 242   median 50   below code 16: 14.9%   above 240: 0.00%   stdev 55.4
```

**The image never reaches white.** Zero pixels above code 240 out of 255, in an outdoor
golden-hour scene. Meanwhile 12–15% of pixels are crushed below code 16. Everything is
compressed into the midtones with dead shadows and no highlights. That *is* flatness, measured.
The player's "it feels flat" was literally correct.

### 5.2 Why — six independent audits, deduplicated

The recurring theme: **the features are built and paid for, then disabled, mistuned, or
algebraically cancelled.** Most of the work is switching things on, not writing new systems.

Rated by impact (1–10) and GPU cost.

**Lighting and shadow**

- **[10] The ground self-shadows across its own PCF kernel.** At the default `medium` preset
  roughly **43% of the direct sun is deleted from every horizontal surface**, uniformly, by
  shadow acne. The slope-scaled depth bias that prevents it is gated behind `high`+.
  → `demos/ashfall/src/core/shadows.js` (~line 197, `SLOPE_BIAS_TEXELS`; presets ~line 87)
- **[10] Only 0.6 stops separate full sun from full shade** on horizontal surfaces, so the grade
  has no range to expand. Cause: at **8° sun elevation a horizontal surface receives sin(8°) =
  14% of the key**, so the ground was lit almost entirely by ambient fill.
- **[9] Every landmark's shadow was thrown clean off the map.** Throw is cot(elevation) × height
  = 7.1× at 8°. The dock canopy's lattice grid — the signature shadow the art direction is built
  around — landed 33 m downsun, past the edge of the playable area. **The raking grid was never
  missing; it was off-frame.**
- **[10] The environment probe has no ground in it.** The PMREM is baked from a sky dome alone,
  so every surface receives ~0.85× the sun's own irradiance as a perfectly uniform, unoccluded
  wash **from every direction including below**. Ambient with no directionality carries no shape
  information. This is arguably the single largest contributor to the flat look.
  → `demos/ashfall/src/world/sky.js`, `buildEnvironment()`
- **[9] Ambient fill roughly equalled the direct sun** on horizontal surfaces. `envIntensity`
  drove diffuse *and* specular together, so it could not be lowered without deleting every sky
  reflection from the metal — which is why previous attempts to fix the wash also killed the
  speculars.
- **[8] The far shadow cascade fits a 446 m ortho box to a 110 × 90 m map** — 43.6 cm texels at
  `medium` for everything past 31.5 m.
- **[7] PCSS is present, physically derived, and inoperative** — penumbra pinned at its
  0.6-texel floor, `maxPenumbra` ~7× larger than anything reachable.
- **[9] Contact shadows are compiled out at the default preset,** so nothing in the shipped
  default frame touches the ground.

**Occlusion and post**

- **[10] SSAO's effective world radius collapses to ~0.2 m.** It darkens creases and cannot
  ground anything, so every object looks pasted onto the background. A crate on concrete needs
  occlusion out to a metre or more. → `demos/ashfall/src/core/postfx.js` (~538 distance
  modulation, ~1921 kernel clustering)
- **[8] AO is applied over the composited frame instead of only the indirect diffuse term,** and
  the knees meant to protect sunlit surfaces are calibrated in *post*-exposure units while
  testing a *pre*-exposure value — so that protection is completely inert.
- **[7] AO is upsampled from half res with a single bilinear tap** at the default preset, so it
  bleeds across every silhouette it is supposed to define. **[5]** It also dies entirely at 27 m.
- **[6] The AO pass runs after TAA,** so it gets zero temporal accumulation and has to be kept
  small and blurry to hide its own noise.
- **[8] Aerial perspective is absent from post entirely** and, per-material, **runs backwards** —
  a sunlit wall measured **0.07 stops *darker* at 110 m than at 20 m**. Distance is supposed to
  wash surfaces toward the sky's radiance.
- **[9] Fog density was 45% below what `art.js` authors,** because `sky.js` overrode it. `art.js`
  was not the source of truth it claims to be.
- **[3] `ATMOSPHERE.godrayStrength` was algebraically inert** — `sky.js` defined
  `godrayGain = 1.4 / godrayStrength` and multiplied the same buffer `postfx.js` multiplies by
  `godrayStrength`, so the two cancelled to a constant and editing the knob did nothing.
- **[7] Screen-space reflections are absent** although the G-buffer they need is already written
  and paid for.

**Materials — nothing in this game has a specular highlight. Not one.**

- **[10] The ash pass drags every up-facing surface to roughness 0.87–0.92,** so no horizontal
  face in the game can glint — including the rail heads, which should carry a hot polished line
  where wheels ride. → `demos/ashfall/src/world/materials.js` (~4085 `uAshRoughness`, ~3667
  blend weight, ~3621 metal gate)
- **[9] Specular anti-aliasing saturates its variance cap on 30–56% of texels,** imposing a hard
  roughness **floor of 0.40** across most of the frame — well outside glint territory.
  → (~4103 `uSpecAAStrength`, ~3729 variance clamp)
- **[8] A height field is generated, packed into ORM.a, uploaded to the GPU and published as
  `heightMap` — then never read by any shader.** You are already paying for it. No parallax
  anywhere.
- **[8] Every wall, container and building tiles on a rigid 2–3 m lattice with zero stochastic
  breakup.** Only the ground gets triplanar treatment.
- **[7] The 15 mm geometric chamfer on every object gets no material response.** The code
  documents a "hot specular line" it cannot produce.
- **[7] No generator authors a large contiguous low-roughness region,** so even with the shader
  chain fixed there is nothing for the sun to glint off.

**Geometry — the far half of the map reads as grey cardboard**

- **[10] The entire horizon casts no shadow and receives none,** which at a raking sun deletes
  every long shadow in the frame. → `demos/ashfall/src/world/level.js` (~1018 bucket record,
  ~8655 cast/receive flags)
- **[10] The nine industrial fringe sheds are 18-triangle boxes standing 28 m from the player.**
- **[9] 162 distant town buildings at 30.5 triangles each,** every face of a building sharing one
  flat tint.
- **[9] Zero instancing in the far field** — 24 instanced sets serve the yard, none the horizon.
- **[8] The triangle budget is inverted: 111,984 triangles on ballast gravel; 19,500 for
  everything from 66 m to 560 m.**
- **[8] Nothing occupies the 60–100 m band,** so the eye gets no intermediate depth reference —
  exactly the distance at which parallax between layers sells three-dimensionality as you move.

---

## 6. What is on the branch right now, and how much to trust it

`claude/ashfall-aaa`, three commits on top of `main`:

**`3ea08b7` — art.js constants. Verified only to the extent that it renders.**

| constant | from | to | why |
|---|---|---|---|
| `SUN_ELEVATION` | 8.0 | **18.0** | throw 7.1× → 3.1× (shadows land *inside* the map); ground NdotL 0.139 → 0.309 |
| `LIGHTING.hemiSkyIntensity` | 0.55 | 0.42 | pull total ambient fill down |
| `LIGHTING.envDiffuseIntensity` | — | **0.30** (new) | separates diffuse IBL from specular IBL |
| `LIGHTING.envIntensity` | 0.70 | 0.70 | now means *specular only* |
| `ATMOSPHERE.fogDensity` | 0.0072 | 0.011 | transmittance 0.82 / 0.54 / 0.33 at 20 / 60 / 110 m |
| `ATMOSPHERE.fogHeightFalloff` | 0.055 | 0.045 | at 0.055 the fog halved by 13 m, so the 22 m crane stood in clean air |
| `ATMOSPHERE.godrayStrength` | 0.55 | 1.4 | live only once `sky.js` `godrayGain` collapses to 1.0 |
| `GRADE.ssaoRadius` | 0.55 | 1.6 | metre-scale occlusion is what grounds an object |
| `GRADE.ssaoIntensity` | 0.85 | 0.75 | same darkness over a metre reads as grime |
| `GRADE.vignette` | 0.34 | 0.22 | 0.34 cost 1.18 stops in the corners |

Measured effect of the constants **alone** (yard): crushed blacks improved (below code 16:
12.5% → 8.5%) but **peak dropped 226 → 209** — the increased fog washes the top while aerial
perspective is still inverted. This is an expected, incomplete mid-state, not a result.

**`b79ed54` — audio.** Verified. See §4.

**`ebeb17c` — renderer, partial. UNVERIFIED. Do not trust any line of it.**
Four agents were mid-flight on disjoint files when the container restarted. Their edits were
committed rather than discarded because they implement the top findings and the tree still
works. What is *known*: it boots, and the gameplay battery passes **13/13**. What is *not*
known: whether any of it looks right — **no frame has been visually checked**.

From reading the diff:
- `shadows.js` — screen-space contact shadows (`ASHFALL_SSCS*`), slope-scaled and normal bias
  constants, penumbra floor work
- `sky.js` — a ground plane added to the environment probe scene (the [10] fix above)
- `postfx.js` — SSAO uniform and kernel rework
- `materials.js` — a standard-map fragment path plus new uniforms
- `level.js` — **untouched. That entire workstream is not started.**

**A `yard` frame was captured from this commit after the fact. It is a visual regression.**

```
base (main)        max 226   mean 71.6   median 54   <16: 12.5%   >240: 0.00%   stdev 53.6
consts only        max 209   mean 78.4   median 58   <16:  8.5%   >240: 0.00%   stdev 55.9
ebeb17c (WIP)      max 217   mean 90.1   median 68   <16:  2.9%   >240: 0.00%   stdev 58.1
```

The numbers move the right way on shadow detail — crushed blacks fall from 12.5% to **2.9%**,
which is a genuine improvement and consistent with the ambient/probe/bias work landing. But
**looking at the frame, it is worse**: the scene is washed out under heavy haze, the distant
container stacks have nearly dissolved, and the canopy's shadow on the platform has gone soft
and pale rather than becoming the crisp raking grid the sun-elevation change was supposed to
deliver. It reads as a foggy morning, not golden hour. And the top end is still dead —
**still zero pixels above code 240**, which is the original defect, untouched.

Best interpretation: fog density went up (0.0072 → 0.011) while aerial perspective is still
inverted and the specular chain in `materials.js` is still incomplete, so the haze is lifting
the floor without anything bright existing to survive it. That is consistent with the design —
`GRADE.exposure` and the fog were always meant to be recalibrated *after* the lighting and
materials work, and neither is finished.

**Recommended first move:** capture `yard`, `depot`, `terraces`, look at them, and decide
per-file whether to keep, finish, or revert. Two viable routes:
- **Finish forward** — complete `materials.js` (speculars are what create highlights and are
  what the frame is missing), then aerial perspective, then recalibrate exposure. The haze
  should resolve into depth once there is contrast for it to act on.
- **Reset and go incrementally** — `git revert ebeb17c`, then re-apply one workstream at a
  time, capturing a frame after each. Slower, but every step stays attributable.

Given three separate systems are half-applied here, the incremental route is probably the safer
one. `git revert ebeb17c` is a clean escape hatch.

---

## 7. What is left, in priority order

1. **Verify or revert `ebeb17c`.** Nothing else is safe until you know what that commit does.
2. **Finish the four renderer workstreams** — the briefs are §5.2, grouped by file. Strict file
   ownership matters if you parallelise: `postfx.js`, `shadows.js`, `materials.js`, `sky.js`,
   `level.js` are disjoint; `art.js` is shared and should have exactly one owner.
3. **`level.js` has not been started at all.** The horizon cast/receive split (~1018, ~8655) is
   rated [10] and is trivial — do that first.
4. **Recalibrate `GRADE.exposure` LAST.** It is still 5.0. Once the lighting is right, set it so
   the histogram lands: peak reaching 250+, roughly 0.5–2% of pixels above 240, under 3% below
   code 8, stdev meaningfully above the current 53. **Do not compensate for lighting bugs with
   the grade** — that is how it got flat in the first place.
5. **Add real aerial perspective to the composite** (§5.2). Analytic exponential height fog off
   the depth buffer, ~30 ALU, then make the inscatter directional:
   `mix(fogAway, fogSun, HG(dot(V,L), g))` with g ≈ 0.65–0.80, `fogSun` warm and 3–5× brighter
   than the cool `fogAway`. Looking toward the sun the haze glows, away it goes cold.
   `ATMOSPHERE` already authors `inscatterStrength` and `inscatterAnisotropy` for exactly this.
   One dot product, and it is the highest perceived-depth-per-instruction item on the list.
6. **Get ears on the audio** and act on §4's open items.
7. **Blind A/B gauntlet.** A pristine `main` checkout served on a second port gives matched
   before/after pairs; have independent reviewers score them without being told which is which.

---

## 8. Traps that have already cost real time

- **A backtick anywhere inside a GLSL template literal — including inside a GLSL comment —
  terminates the JavaScript string** and the game fails to boot with a confusing syntax error.
  This has happened twice. Never type a backtick inside a shader string.
- **Test through the real frame loop.** A gameplay harness that called `player.update()`
  directly passed 13/13 for six rounds against an input ordering that was completely broken in
  the real rAF loop. Events only arrive *between* frames; a harness that steps subsystems by
  hand cannot see frame-ordering bugs.
- **Measure the system, not the component.** Every audio voice passed every gate while the mix
  was unusable, because the gates measured voices in isolation. Same class of error as above.
- **Per-shot jitter is ±9 dB per octave.** Average 8+ shots before concluding anything about a
  weapon's spectrum. Several tuning iterations were spent chasing noise.
- **A convolver's output follows the impulse response's *energy*, not its peak.** A
  peak-normalised IR built from `Math.random()` gives a different room loudness every session.
  The IR noise is seeded for this reason — keep it that way.
- **Software rendering (SwiftShader) takes 3–8 minutes per 960×540 frame.** Budget for it, run
  one capture at a time, and do not interpret a timeout as a bug in the game.
- **A single-threaded static server silently serves loading screens** to a Playwright page
  pulling ~40 modules at once. Four of six frames in one run were the title card and the
  harness reported success.

---

## 9. Verifying anything

Tools and full usage: **`demos/ashfall/tools/README.md`**. Summary:

```bash
# serve the REPO ROOT, not the demo folder
python3 -m http.server 8123

cd demos/ashfall/tools
node gameplay-battery.mjs                       # 13/13 — run after every change
node capture.mjs shots high yard depot terraces # then LOOK at the PNGs
node audio-scene.mjs firefight                  # real bus, writes .wav + metrics
NOAMB=1 node audio-scene.mjs single             # one-shots without the ambience bed
```

For matched before/after comparison, serve a pristine `main` on a second port:

```bash
git worktree add /tmp/ashfall-before origin/main
cd /tmp/ashfall-before && python3 -m http.server 8124 &
PORT=8124 node audio-scene.mjs firefight before/     # capture.mjs takes PORT the same way
```

The target histogram for a finished frame is in §7 item 4. The play test that matters is a
person looking at it and listening to it — every failure in this project so far has been a
number that looked fine while the experience did not.
