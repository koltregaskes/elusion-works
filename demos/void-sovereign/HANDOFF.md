# Void Sovereign — Handoff Pack

**Read this first if you are a new session picking this project up.**
Last updated: 2026-07-29.

---

## 0. What this is

A **Homeworld-lineage, universe-scale 3D space RTS** running in a browser on
Three.js, living at `demos/void-sovereign/` in the Elusion Works site repo.
Skirmish ("random") mode only — no campaign. It must be genuinely *playable and
fun*, not a tech demo with a pretty screenshot.

**Hard constraint that shapes everything: zero binary art assets.** Every hull,
texture, normal map, nebula, asteroid and sprite is generated procedurally at
runtime from a single seed. `?seed=kharak` rebuilds the identical universe.

### The four phases

| Phase | Scope | Status |
|---|---|---|
| **1. Web** | Push WebGL 2 / Three.js as far as it goes. Fully playable, great UI/HUD, fluent control, AAA-grade look. | **IN PROGRESS** |
| 2. Desktop app | Move to an executable once the browser is genuinely the limiting factor. | Not started |
| 3. Real assets | Authored/generated art pipeline (Blender, image/video/audio MCPs) replacing pure procedural where it wins. | Not started |
| 4. Optimisation | Dedicated profiling and tuning pass **on the target hardware**. | Deliberately deferred |

**Phase 1 is not "done" until it is a 10/10 playable demo.** The bar and the
test procedure are in §6.

### Target hardware

Owner-reported: a gaming laptop with a **"380-class" discrete GPU, ~2–3 years
old**. Exact model still to be confirmed. Treat as **RTX 3080/4080-Laptop
class, ~12 GB VRAM, 1440p**. Budget to **1440p60** with 1,000+ live units, and
keep generated-texture VRAM under **~2.5 GB**.

The development machine is a **mini-PC with an integrated Radeon 890M** and runs
at roughly a third of target. **Never lower visual quality to make the dev box
fast** — that is Phase 4's job, on the real machine.

---

## 1. Documents, in reading order

| File | What it is |
|---|---|
| `ARCHITECTURE.md` | **The binding contract.** Frozen module APIs, canonical event table, per-agent file ownership, scale reference, visual direction (§3), perf policy (§0). Read all of it. |
| `CRITIQUE-RUBRIC.md` | Gameplay/UX/feel rubric derived from real reviews of Homeworld 1–3, Deserts of Kharak, Sins, and modern RTS generally. Extends `ARCHITECTURE.md` §3 into everything §3 doesn't cover. |
| `DESIGN.md` | Site-convention design token doc (colours, type, shapes). |
| `HANDOFF.md` | This file. |

---

## 2. How to run and test it

### Dev server
The site's CSP is `script-src 'self'`, so it must be served over HTTP — opening
`index.html` from the filesystem will not work.

```bash
node "C:/Users/KOLTRE~1/AppData/Local/Temp/claude/W--Websites-sites-elusion-works/028c42ed-ad10-42e9-b13f-325ee69dee45/scratchpad/serve.mjs"
```

Serves the repo root at `http://127.0.0.1:8899/`. The game is at
`http://127.0.0.1:8899/demos/void-sovereign/`.
(If that scratchpad is gone, the script is ~40 lines of `node:http` static
serving with `cache-control: no-store` — trivial to recreate.)

### Screenshot / smoke harness

```bash
node .local/shot.mjs <out.png> [--wait ms] [--w 1920] [--h 1080] [--seed N] \
                     [--eval "js"] [--evalWait ms] [--url ...] [--skipIntro]
```

Prints a JSON report — fps, tick, entity count, credits per team, draw calls,
console errors, page errors, failed requests — and **exits non-zero on any
error**. Use it as the regression gate.

### ⚠️ Playwright on this machine

`chromium.launch()` with no options **fails** — the pinned browser build is not
installed and `npx playwright install` stalls. Do not try to install it.

`.local/shot.mjs` exports `findChromium()`, which locates the newest installed
full Chromium under `%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win64/chrome.exe`
and launches with `--headless=new --use-angle=default --ignore-gpu-blocklist`.
This gives a **real GPU path** (`ANGLE / AMD Radeon 890M / D3D11`), so
screenshots are representative rather than software-rendered. Copy that block
into any new script.

### Live debug handles

`window.__VS` exposes `engine`, `world`, `cameraRig`, `input`, `hud`, `fx`,
`environment`, `post`, `loop`, `bus`, `THREE`, `rng`, `seed`, `quality`,
`loadErrors`, `ready`, plus `restart(seed)` and `dispose()`.

Handy one-liners:
```js
window.__VS.bus.emit('ui:speed', { scale: 4 });                     // fast-forward
window.__VS.world.spawn('destroyer', 1, new window.__VS.THREE.Vector3(x, y, z));
window.__VS.cameraRig.focusOn(point, 4000, true);                   // frame something
document.getElementById('vs-hud').style.display = 'none';           // judge the render alone
window.__VS.engine.setPostProcess(null);                            // A/B the post stack
```

### Diagnostic probes in `.local/` (gitignored)
| Script | Use |
|---|---|
| `probe-scene.mjs` | Dump the live scene graph of both scenes |
| `probe-bisect.mjs` / `probe-bisect2.mjs` | Hide objects one at a time to attribute a visual artefact |
| `probe-equirect.mjs` | Unwrap the baked sky into one lat/long image |
| `probe-seam.mjs` | Measure sky discontinuities numerically against the local neighbourhood |
| `probe-faces.mjs` | Cube-face contact sheet (historical — sky is equirect now) |

---

## 3. Current state

**Boots clean.** ~53 fps at 1920×1080 on the dev box's integrated GPU, zero
console errors, sim ticking, economy running, AI fighting.

### Working
- 13 ship classes, three hull families, procedural `BufferGeometry` with LODs.
- Fixed 30 Hz sim with interpolated rendering; spatial hash; formations; stances.
- Combat: firing arcs, projectile travel time, shields → armour → hull, weapon-vs-role affinity.
- AI commander with its own economy — in an unattended soak it out-produced the idle player 14,685 to 5,360 and destroyed their fleet.
- FX: tracers, impacts, burning hulls, debris, engine plumes.
- HUD: production menu with affordability, resource/population/fleet-value bar, speed control.
- Procedural sky: seeded nebula, galaxy band, magnitude-banded stars, 8 palettes.
- Post stack installed and running.

### Measured (dev box: mini-PC, integrated Radeon 890M, ~⅓ of target)

| Metric | Value |
|---|---|
| Boot, end to end | 5.4–13.4 s (was 30–33 s) |
| Draw calls, 32 entities | 84–87 |
| Draw calls, 100 / 500 / 1,000 batched | **85, flat** |
| Draw calls at FX peak stress | 60 (16 of them FX) |
| Peak stress content | 366 tracers · 40 beams · 183 death sequences · 13,685 particles · 900 debris |
| Sim tick | avg 0.196 ms, p99 0.5, peak 4.9, zero NaN |
| Order latency | selection 2.2–6.0 ms · move 25.7–27.5 ms · attack 22.1–23.9 ms |
| Terminator | mothership shadow p02 0.066 sRGB vs lit p90 0.542 (~1:25 linear) |
| Asteroid local contrast | 2.09–2.76 (was 19.79) |
| Console / page errors | zero across 10 seeds |

Latency caveat that must travel with those numbers: any figure for a *visible*
change means **"on the very next rendered frame"** — the instrument cannot
resolve finer than one frame at ~30 fps here. Bus figures are exact.

### Closed
Instancing (2.9 → 0.029 draw calls per unit) · fleet LOD driven · terminator ·
team colour at hero and fleet range · nebula structure · asteroid dazzle ·
boot time · opening frame · explosion disc · tracers · order queueing ·
order integrity · tactical pause · attack-move/guard/patrol/stop · sensors
manager (was never opening — `Tab` was double-bound) · audio.

### Still open
- Critic verdict is **NO** as of iteration 4; iteration 5 is running against a
  substantially changed build.
- Fleet-scale read at 560 hulls — all three inputs (glow layer, LOD, rocks)
  have changed since it was last judged, so it needs re-measuring.
- A reported anamorphic star flare that **environment has measured as
  symmetric** (aspect 0.18–1.01, never wider than tall) and postfx has disabled
  in all tiers. Something else draws it, or it is not there. Unresolved.
- No thumbnail; **not on the demo shelf** — deliberately, until quality
  justifies it. See §6a.

### Known-good next wins (measured, cheap, no owner)

- **Battle damage is fully wired and has no producer.** `aDamage` is *not*
  unread as previously recorded — `HULL_VERT_PARS` declares it and `HULL_BODY`
  consumes it via `vAttr.x`, so scorch, exposed hot metal and flickering cracks
  are all implemented. `ships/index.js:727` allocates the attribute as zeros
  and **nothing ever writes it**. Battle damage appears the moment SIM writes
  per-instance values from `entity.hull / entity.maxHull`. This is the highest
  visible-quality-per-effort item left in the project.
- **The mothership's dark engine bore is a hole in the geometry, not shading.**
  `greeble.js::engineNozzle()` lofts the `KIND.BELL` emitter cone with
  `capEnd: false`, so the throat is a literal hole at r < 0.42r — which is what
  FX's throat disc is actually covering. **Do not remove that disc until the
  throat is capped.** Separately, the `KIND.HULL` recess cone sits 0.06–1.31 m
  from the emitter on a 14.2 m bell and z-fights it; it is redundant (the
  emitter already provides that surface) and dropping it would let
  `uDepthPull` go too.
- **ENV has fill headroom back.** With the new terminator shaping carrying the
  lit side, `hullAmbient 0.20→0.13`, `env:fill 0.42→0.30`, `env:ambient
  0.075→0.05` costs 1–9% of median hull luminance and buys **+5–19%
  interquartile contrast** (going further, to 0.10/0.24/0.04, takes the worst
  seed from 4.06 to 5.41).
- **Two terminator laws coexist for the same ship** — the L2/L3 impostor uses
  `smoothstep(N·L)` with a flat fill, the close-range hull uses
  `pow(N·L, 2.0)·1.61` plus bounce, so there is a value step at the L1→L2
  boundary. `setHullTerminator(gamma, pivot)` is exported if they should agree.
  The impostor's hand-picked grey should also derive from
  `getFamilyAverages()` rather than drifting from the plate atlas.

### Cross-lane measurement hazard

**Record the environment alongside any art measurement.** A materials baseline
was invalidated mid-flight when ENV's sun-elevation clamp landed: every seed
moved 9–10° of elevation between the baseline and the result run, silently
turning an A/B into a comparison of two different scenes. `.local/matseed.mjs`
now dumps `sunElevDeg`, the four light intensities and the live hull uniforms
into every record. Do the same for anything cross-lane.

Related: **the critic's seven-seed luminance table goes stale quickly.** It has
already been superseded twice by concurrent lighting work. Re-measure rather
than quoting it.

### Open items with no owning agent (transcripts lost — respawn to action)

- **FX blast normalisation.** The doc comment says a fighter is `≈0.04`; the
  formula `(L/380)^1.5` gives `0.007` and the bus actually carries **0.002**.
  That mismatch already caused the camera's noise gate to be set five times too
  high, swallowing the rumble phase of every capital death. Reconcile comment
  and code. Separately, a frigate death (0.088) currently registers *smaller
  than an ion lance* (0.16) — plausible, but confirm it is intentional rather
  than a fall-out of the mass curve.
- ~~Audio locked to a stale capital-death script.~~ **CLOSED.** `sfx.js` now
  conducts the death from `fx:blast` with no reads of FX internals at all.
  Worth keeping the diagnosis, because it explains how the coupling survived a
  rebuild of the very thing it was coupled to: **a destroyer is the one hull
  where the old hardcoded 2.98 s was right — measured +0.001 s.** Carrier was
  +0.77 s and mothership +2.12 s. The bug was invisible on precisely the case
  anyone would test first.
  A second-order version of the same mistake nearly shipped: the first fix
  still *mirrored* FX's `(L/380)^1.5` normalisation to size its thresholds, so
  when that was reconciled to `^0.8` a mothership's detonation was silently
  demoted to a secondary. It is now scale-invariant — each session calibrates
  on its own quietest beat and classifies by ratio, so a renormalisation
  requires no re-tuning. **Mirroring a constant is the same bug as mirroring a
  timing.**
- **FX self-identified polish:** the shock front reads flat beige rather than
  having a hot leading edge, and the plume has not been checked against the
  mothership's corrected bell geometry (ships changed it after FX's last
  engine tuning).
- **UI:** `UNSHIPPED_CONTROLS` in `hud.js` still suppresses the "Shift + right
  click — Queue the order" row. That suppression was correct when added but is
  now stale — queueing is shipped and verified. Delete it and the row returns.

---

## 4. How the work is organised

Nine specialist agents, each owning a **disjoint file set** so parallel work
cannot collide. The ownership table is in `ARCHITECTURE.md` §1 and is
authoritative. An agent that needs a change outside its files reports it rather
than editing.

| Role | Owns |
|---|---|
| Materials | `src/render/textures.js`, `materials.js` |
| Ships | `src/ships/index.js`, `hulls.js`, `greeble.js` |
| Environment | `src/render/skybox.js`, `environment.js` |
| VFX | `src/fx/*.js` |
| Sim/AI | `src/sim/*.js` |
| UI | `styles/hud.css`, `src/ui/*.js` |
| Camera | `src/core/camera.js`, `input.js` |
| PostFX | `src/render/postfx.js` |
| Critic | Nothing — reads and files defects only |
| **Integrator (main session)** | `index.html`, `src/main.js`, `src/core/*` (except camera/input), `src/ships/catalog.js`, `styles/shell.css`, all docs |

The **critic agent** runs a loop: capture a fixed 9-shot set → judge against
`ARCHITECTURE.md` §3 and `CRITIQUE-RUBRIC.md` → file a prioritised defect list
naming the owning subsystem → wait for fixes → re-capture. It is instructed to
default to "not good enough" and to get harsher, not softer, over time.

> **Honesty note, and please preserve it:** the original brief asked the critic
> to blind-compare screenshots side by side against the real Homeworld. It
> cannot — fetching and displaying copyrighted game stills is out of bounds. It
> judges against the written rubric and says so. Do not let a future session
> quietly claim a comparison it did not run.

---

## 5. Hard-won knowledge — read before you "fix" these again

**The GLSL backtick trap has now bitten seven times, and `syntax-check.mjs`
does not catch every form of it.** Two more landed in a single session (a
backtick around `` `k` `` and `` `position` `` in shader comments, then
`` `cover` ``). The structural detector caught the first two by fingerprint.
The third presented only as `Unexpected identifier 'cover'` with **no
truncated-literal warning at all**, so a clean-looking failure message hid the
real cause.

A related variant costs just as much and is not a backtick: a replacement that
closes a block comment early, leaving prose loose inside a shader string.
`syntax-check` passes it, because it is still a valid template literal. Only
reading the file finds it.

Rule: when a shader file fails to parse and the message names an identifier you
recognise as English prose, look for an unterminated template literal or an
early `*/` before you look anywhere else.

**Fix your instrument before you tune anything.** A whole round of pacing work
was spent tuning against numbers that turned out to be noise, and the noise was
entirely mine.

The tell: the same seed, same settings, run three times, gave 17.2, 14.0 and
35.0 minutes with different winners. Two harness faults, both invisible until
measured. The render loop advanced the sim while the harness waited for the
match to become ready, and only then took over and injected the second
commander — so every run began manual ticking from a different state with the
opponent joining late by a varying amount. And state persisted between matches
inside one page, so the first match in a page did not match later ones.

The sim itself is exactly reproducible: same seed, fresh page, three runs,
identical duration, winner, seams and entity count. **If a measurement varies,
suspect the harness before the code.** Every soak now records
`ticksBeforeTakeover`, which must be 0, and uses a fresh page per seed.

**Entity ids are behaviour, not labels — reset them with the world.** `ai.js`
picks sensor sources with `(e.id & 3) === 0`, `combat.js` sets the flee timer
from `e.id % 7` and the retarget phase from `e.id % 13`. The id counter was
module-level and survived a world rebuild, so a restart numbered its ships from
wherever the last match stopped and all three phases shifted. The result was a
restart that could not reproduce its own seed, on a demo whose entire pitch is
that everything derives from one seed. A tick-0 diff was byte-identical and the
runs still forked inside 30 ticks — the state looked right and the *phase* was
wrong. If you add another `id %` anywhere, this constraint comes with it.

**Prove which code path actually runs before you believe a fix landed.** This
has now cost the project twice, and both times the code was correct.

The first was `setFleetScene()`: never called, so the batch root was unparented
and the fleet did not draw at all. It invalidated a "draw calls are flat"
claim that had already been reported as good news.

The second was the contested band. `generateResourceClusters` + `markContested`
in `sim/spawn.js` produce 4–8 contested clusters on every seed — measured over
40 seeds, histogram `{4:30, 6:9, 8:1}`, mean 4.55, not one seed with none. But
`resolveResourceClusters` prefers `environment.resourceClusters` when present,
and it is *always* present. Measured in the running world, **5 seeds in 8 had
zero contested clusters**, which made the sovereignty victory condition
unreachable and the whole seam economy inert — on the majority of matches, the
mechanic written specifically to stop 12:1 stalemates was not running at all.
A previous agent's fix for mirror-match bias went into that same bypassed path.

The tell in both cases was that the unit-level measurement was clean and the
integrated measurement was never taken. A generator that produces the right
answer is not evidence that anything consumes it. Measure the field the running
game actually uses.

**Sky is equirectangular, not a cubemap. Do not convert it back.**
Hard straight lines were cutting across the sky. After bisecting the scene
graph, post-processing, the HUD and the dust, the cause was **cube-map seams**:
WebGL 2 has no seamless cube filtering (that's a desktop-GL feature), so
bilinear taps clamp inside each face and all twelve cube edges show as steps —
measured at 3–5 luminance units on a sky whose entire range is only 1–25.
The bake is now a single equirect `WebGLRenderTarget` with
`EquirectangularReflectionMapping` and `RepeatWrapping`, and the fragment shader
reconstructs direction from lat/long per fragment.

**Stars are not baked into the sky map, and must not be put back.** This note
previously claimed sky resolution had to be chosen so baked stars stayed sharp
— *"~0.088°/texel ≈ two screen pixels at 1080p/48° FOV"*. **That arithmetic was
wrong**: a texel of a 4096×2048 map is about **3.5** screen pixels at 1080p/48°,
not two. A star stored as a ~1-texel Gaussian and then magnified 3.5× is a
square blob **at any map size**, so no amount of resolution or density tuning
could ever have fixed the "bokeh snowstorm" — and two passes spent trying.

Resolvable stars are now a `THREE.Points` cloud in `farScene` at 2.2e9 m, sized
in framebuffer pixels, with magnitudes drawn from the Euclidean law
`N(>F) ∝ F^-1.5` that a real sky obeys, and attenuated by a vertex-shader fetch
of the sky map so gas still occludes them. One extra draw call. The baked map
now carries **only gas**, which is low-frequency, so its resolution is a memory
decision rather than a sharpness one — there is a documented ~67 MB VRAM saving
available by baking at 1024×512 and upsampling.

Set the sky texture's anisotropy to `renderer.capabilities.getMaxAnisotropy()`;
at `anisotropy: 1` grazing-angle sampling picks a coarse mip and smears the gas.

**Two scenes, deliberately.** `farScene` (backdrop, 10⁵–10⁹ m) renders first
with its own non-translating camera and a huge far plane, then the depth buffer
is cleared, then `scene` draws gameplay. Sharing one depth range with a 14 m
interceptor destroys precision even with `logarithmicDepthBuffer`.
`renderer.autoClear` is `false`; `engine.renderScenes()` owns the sequence.
Any post-processing stack **must** call it rather than using a plain `RenderPass`.

**Dust billboard atlas needs hand-built mips.** Cell borders must reach exactly
zero alpha (a separable border window — an elliptical falloff alone fails when
`stretch < 1`), and the mip chain must be generated **per cell**, or coarse mips
smear neighbouring cells together and distant dust sheets resolve into visible
rectangles.

**Gas-layer early-outs must fade to zero.** `if (env > threshold)` is a
performance win over the empty half of the sky, but `pow(dens, contrast)` with
contrast < 1 lifts small densities hard, so a plain cutoff shows as a clipped
edge. The envelope now smoothsteps to exactly zero at the threshold.

**Watch for backticks inside GLSL template literals — this is the single most
expensive recurring bug in the project.** A shader comment referring to
`` `someUniform` `` terminates the JS template literal and silently truncates
the shader. It has been introduced **four times**, and every time it presents
as a mystery: the parse error is thrown by an unrelated line, often in a
*different* module that merely imports the broken one, naming an identifier
that looks nothing like the cause. It has nulled the entire FX system (reported
as a `RING_INNER` undeclared identifier) and taken out `environment.js`.

**`node .local/syntax-check.mjs` now detects it.** A GLSL-looking template
literal whose contents end inside an unclosed block comment is exactly the
fingerprint. Run it after every edit — it also catches ordinary parse failures
that `node --check` cannot, because `--check` parses `.js` as CommonJS here and
`import` masks everything behind an unrelated error.

**Projected measurements have produced three phantom defects. Measure in world
space, or measure painted pixels — never a projected bounding box.**

1. "The mothership's long axis is X" — a **world-axis** AABB taken on a *yawed*
   hull. It described that ship's heading, not its model axes. Withdrawn after
   re-measuring on `buildShipModel()` output before rotation: all 13 classes are
   long-axis Z with bbox length to spec within 0.5 m.
2. "The hero ship is 42% of frame width" — a projected AABB again, inflated 77%
   over the **true painted silhouette** (455 px, 23.7%). Three methods
   disagreed; only frame-difference was right. Use `.local/silhouette.mjs`.
3. "The destroyer's bounding box is 77,665 × 12,255" — projected pixels, not
   world units. Verified directly: destroyer 66 × 108 × **380** against a spec
   of 380, mothership 838 × 1266 × **1900** against 1900, all finite, every
   class exact. A bbox that straddles the camera plane projects to garbage, so
   the number was a harness artefact and the geometry was never wrong.

A projected box is not a measurement of an object; it is a measurement of an
object *and* a camera. If the camera is anywhere near the subject, it tells you
about the camera.

**Two of my diagnoses were wrong before the right one.** I flipped the cube face
basis on faulty reasoning (three's `CubeCamera` uses standard orientations for
WebGL — the original basis was correct), and I initially misread a
seam-continuity measurement by comparing seam steps against *star* spikes
instead of the local sky level. Measure against the local neighbourhood.

---

## 6. Definition of done for Phase 1

Phase 1 ships when **all** of these hold:

1. `node .local/shot.mjs` exits zero across at least 10 seeds — no console
   errors, no page errors, no failed requests.
2. Holds **60 fps at 1440p on the target laptop** with 1,000+ live units.
   (Cannot be verified on the dev box — must be measured on the real machine.)
3. The critic agent answers **YES** to "Would this pass as a shipped AAA space
   RTS?" and can no longer name a BLOCKER or MAJOR defect.
4. Every criterion in `CRITIQUE-RUBRIC.md` scores 8+/10, with the test procedure
   for each actually run and recorded.
5. A full skirmish is winnable *and losable* by a human player, and is genuinely
   fun for 30–60 minutes.
6. `DESIGN.md`, `ARCHITECTURE.md`, `CRITIQUE-RUBRIC.md` and this file are current.
7. Thumbnail captured and the demo-shelf card added to `demos/index.html`
   (remember to bump the index count in the header).

**Report to the owner when Phase 1 is at 100%** — that is the signal to move to
Phase 2 (desktop).

---

## 5a. Control scheme

Generated from `CONTROL_SCHEME` in `src/core/input.js`; `src/ui/hud.js` imports
it, so the in-game help panel (`H`) updates itself. Reproduced here for the
demo card and for anyone writing copy.

| Group | Input | Action |
|---|---|---|
| **Time** | `Space` | Pause the battle — you can still select and give orders |
| | `+` / `−` | Game speed: ¼, ½, ×1, ×2, ×4 |
| | `H` | Controls panel |
| | `M` | Mute / unmute (mixer sits above the reference grid) |
| **Selection** | Left click / drag | Select · band-select |
| | `Shift` / `Ctrl` + click | Add to · toggle in selection |
| | Double click | Every ship of that class on screen |
| | `Ctrl` + `A` · `Esc` | Select whole fleet · clear |
| **Orders** | Right click | Move (drag up/down for altitude) |
| | Right click on enemy | Attack |
| | `Shift` + any order | Queue it |
| | `A` · `G` · `P` · `S` | Attack-move · guard · patrol · stop |
| | `1`–`6` | Formation: delta, broad, claw, X, wall, sphere |
| | `Z` / `X` / `C` | Stance: evasive, neutral, aggressive |
| **Camera** | Right drag / middle drag | Orbit (`Alt`+right to orbit with a selection) |
| | Wheel · `PgUp`/`PgDn` | Zoom (exponential) |
| | Arrow keys · screen edge | Pan (`Shift` to hurry) |
| | `Q` / `E` · `F` · `Tab` | Swing · focus selection · sensors manager |
| **Groups** | `Ctrl`+`0`–`9` · `0`–`9` | Assign · recall (twice to focus) |
| **Touch** | Drag · tap · pinch · long press | Orbit · select · zoom · move gizmo |

**Why panning is on the arrow keys and not WASD.** `A` is attack-move and `S`
is stop in every RTS a player has touched, and that collision is unresolvable
while WASD holds the camera. Panning keeps arrows, the screen edge, `Q`/`E` and
middle-drag orbit — in a camera this orbit-centric that is a small loss, and an
attack-move you cannot reach is a missing verb. If this is ever revisited,
revisit it as a rebinding feature rather than by reclaiming `A`.

## 6a. Publishing — how this actually goes live

**Nothing is live until it is merged to `main`.** `.github/workflows/pages.yml`
deploys GitHub Pages on `push` to `main` only. Work on `feat/void-sovereign`
is pushed to GitHub but is **not** served at `elusionworks.com`.

There are two independent gates, and both must be opened deliberately:

1. **Merge `feat/void-sovereign` → `main`** (via PR). That deploys the files,
   making the demo reachable at `elusionworks.com/demos/void-sovereign/`.
2. **Link it from the shelf.** Until the card exists in `demos/index.html`,
   the demo is deployed but undiscoverable — which is a perfectly reasonable
   soft-launch state for sharing a direct URL with a few people.

### The shelf card, ready to paste

Insert into `demos/index.html` alongside the other `data-kind="game"` cards,
and **bump `<span class="ew-index-count">` from 10 to 11**.

```html
<article class="ew-plate ew-demo-card ew-demo-card--wide" data-kind="game">
  <span class="ew-plate-halo" aria-hidden="true"></span>
  <a class="ew-plate-link" href="void-sovereign/" aria-label="Open Void Sovereign"></a>
  <div class="ew-plate-media"><div class="ew-plate-frame"><img src="void-sovereign/thumbnail.webp" alt="" width="1200" height="675" loading="lazy" decoding="async" /><span class="ew-plate-shade"></span><span class="ew-plate-sheen" aria-hidden="true"></span></div></div>
  <div class="ew-plate-meta">
    <div class="ew-plate-meta-row"><span class="ew-mono ew-plate-kind">3D space RTS</span><span class="ew-status ew-status-live">Playable</span></div>
    <h3 class="ew-plate-name">Void Sovereign</h3>
    <p class="ew-plate-blurb">Fleet command at universe scale. Every hull, nebula and asteroid generated in the browser from one seed.</p>
    <div class="ew-plate-footer"><span class="ew-mono ew-plate-family">Three.js</span><span class="ew-plate-cta">Launch <span class="ew-cta-arrow">-&gt;</span></span></div>
  </div>
</article>
```

### Launch checklist

Do these in order. Do not skip 1–3 to hit a date; the whole point of the demo
is that it is good.

- [ ] All Phase 1 conditions in §6 hold.
- [ ] Critic answers **YES** with no BLOCKER or MAJOR outstanding.
- [ ] Measured at **1440p60 on the target laptop** — cannot be checked here.
- [ ] **Capture `thumbnail.webp` at 1200×675.** Do this *after* the art is
      fixed, never before — the thumbnail is the single most-seen image and a
      stale one undersells the whole thing. Use a hero framing of the
      mothership with the nebula behind it, HUD off.
- [ ] Add the card above; bump the index count to 11.
- [ ] Confirm `og:image` and `twitter:card` in `void-sovereign/index.html`
      point at a real image — needed for social embeds.
- [ ] Boot time acceptable (currently ~30 s; see §3 known-weak).
- [ ] Open a PR, let `validate.yml` pass, merge to `main`.
- [ ] Verify the live URL, then check `site-health.yml` stays green.

### Testing on the target laptop before launch

The most useful thing the owner can do is run it on the real hardware, since
the dev box cannot measure the 1440p60 target:

```bash
git clone https://github.com/koltregaskes/elusion-works.git
cd elusion-works
git checkout feat/void-sovereign
node demos/void-sovereign/tools/dev-server.mjs
```

Then open `http://127.0.0.1:8899/demos/void-sovereign/`. Node 20+ only; no
`npm install` needed — there are no runtime dependencies.
Useful URL parameters: `?seed=kharak`, `?quality=ultra`, `?adaptive=1`,
`?difficulty=hard`.

---

## 7. If you are resuming mid-flight

1. Start the dev server (§2) and run `node .local/shot.mjs .local/shots/resume.png`
   to confirm the build still boots.
2. Read `ARCHITECTURE.md` fully, then §5 above.
3. Check `git status` — **commit only `demos/void-sovereign/`**. The repo has
   unrelated in-flight work (neon-seraph, cross-site-nav, cabinet styles) that
   is not yours to commit.
4. Re-dispatch the specialist agents from the table in §4. Give each one its own
   previous report and its owned file list; they resume rather than restart.
5. Keep the critic loop running throughout — it is the quality ratchet.
