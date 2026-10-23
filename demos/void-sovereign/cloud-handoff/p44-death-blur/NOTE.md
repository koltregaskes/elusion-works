# P44: capital death-frame blur (burn worker W1, 20 Oct 2026)

**Answer first.** The whole-frame blur in the R12 capital death frames comes from **TAA resampling its history under the death camera shake**. It is not depth of field, bloom, motion blur, a low pixel ratio or a CSS filter. A capital death sends `fx:blast`, the camera rig turns that into trauma and moves the camera several pixels a frame. TAA then reprojects and resamples its history at a new sub-pixel offset on every frame. At feedback 0.94 those resamples stack up and soften everything on screen, including the backdrop. The patch keeps the shake and every explosion effect. It only shortens the TAA history while the camera is shaking. In a headless A/B run, the patched death frame was **2.5x sharper** away from the blast than the unpatched one (k10: 0.0205 against 0.0081).

Patch: `death-blur-fix.patch`, against `feat/void-sovereign` HEAD `855c469320b2159699b9fbb5b42e74857ea60a76`. `git apply --check` passes on the repo, and nothing was applied there.

## The code path that runs (call sites, not just definitions)

1. `src/fx/index.js:1423` registers `bus.on('sim:death', (p) => this._onDeath(p))`, which calls `this.explosions.kill(e, p.killer)`.
2. `src/fx/explosions.js:721-726`: `_blast()` runs `bus.emit('fx:blast', { point, radius, strength: strength * Math.pow(seq.L / 380, SHAKE_EXP) })`. The carrier peaks at 1.741 (table at 696-708).
3. `src/core/camera.js:485`: `bus.on('fx:blast', (p) => this._onBlast(p))`, then `addShake()` (1337-1357) sets `this._trauma = Math.min(1, this._trauma + amp)`.
4. `src/core/camera.js:1479-1493`, every frame through the render hook (`main.js:262`, `M.cameraRig.update(dt)`): `const push = o.shakePixels * wpp * s;` moves `cam.position` (shakePixels 26) and adds `roll += noise1(...) * 0.010 * s`. The noise runs at `this._elapsed * 19`, so the image moves several pixels a frame.
5. `src/render/postfx.js:502-503`: on the high and ultra tiers (`taa: true`, lines 55 and 60), `src = this._resolveTaa()`. Line 925 is `u.uFeedback.value = this.params.taaFeedback;` (0.94, line 350). In TAA_FRAG, 1213 is `vec3 hist = sampleHistory( prevUv );`, a Catmull-Rom resample at the reprojected offset, and 1230 is `float feedback = mix( uFeedback, 0.72, speed )` with `speed = length(velPx) / 24`. A shake of a few pixels a frame barely moves feedback off 0.94.
6. Runtime proof that this path ran: the harness logs `rig._trauma` per frame (0.50 at the kill, then decaying). It also logs the image shift between the shake and no-shake runs at the same frame (6 to 8 px, by phase correlation, in an earlier 960x540 pass), and the per-frame `uFeedback` the TAA shader actually received (0.94 unpatched; 0.94 then 0.30 from the kill frame on in the patched run).

Ruled out: nothing in `src/` changes post-FX params at runtime. A grep for `setParams|setFocus|dofStrength|setEnabled(` outside `postfx.js` finds nothing. DoF is far-field only and never touches the backdrop (`postfx.js:1528-1532`), and a no-DoF run gave no meaningful change. There is no CSS filter on the canvas and no motion-blur pass. The pixel ratio is fixed per quality preset (`engine.js:163-166`).

## What the patch changes (3 small edits, 2 files)

- `camera.js`: publishes the current shake, `cam.userData.shake = s` (0 when still).
- `postfx.js` `_resolveTaa`: feedback eases from `taaFeedback` (0.94) down to `taaShakeFeedback` (0.30) as that shake rises from 0 to `taaShakeRamp` (0.08), with smoothstep. It slides back to 0.94 as the trauma decays. Both values are new entries in `params`, so `setParams` can tune them.
- TAA_FRAG: `mix( uFeedback, min( uFeedback, 0.72 ), speed )`, so a fast pixel can never get *more* history than the shake allows. When `uFeedback` is 0.94 this is the same as before.

Kept as it was: the shake itself, bloom, fireball, shockwave, DoF, and TAA at rest and in normal pans.

## How it was verified

Scratch copy only (`git archive` of HEAD, patch applied with `git apply`), served by an in-process Node static server. Chrome-headless-shell 1228 ran under SwiftShader through `withChrome` (`_tools/chrome-lock.mjs`). The harness is `deathblur.mjs` in this folder. Frame stepping is deterministic (dt = 1/60, loop stopped and stepped by hand). Setup: seed 13634, quality high, 1600x900, carrier spawned 9 km above the field centre, `frameEntities`, 90 warm frames, then the R12 schedule of 8 hits 0.3 s apart, then the kill. Grain was off in every run, because it is per-frame noise that would hide the blur. Metric (`metric2.py`): Laplacian variance of luma divided by luma variance (contrast-free). It is measured over the whole frame minus a disc of radius 0.5 x height around the dying hull, and minus a 16 px border.

| run | ref (pre-kill) | k6 (100 ms) | k10 (167 ms) | k12 (200 ms) | k10 vs same instant with no TAA history |
|---|---|---|---|---|---|
| unpatched | 0.0118 | 0.0086 | **0.0081** | 0.0085 | 0.22 |
| unpatched, shake off (`rig._reduced`) | 0.0113 | 0.0111 | 0.0119 | 0.0126 | 0.31 |
| **patched** | 0.0118 | 0.0183 | **0.0205** | 0.0240 | 0.56 |

Raw Laplacian variance at k10 is 7.51 unpatched, 10.67 with no shake and 18.02 patched. Unpatched, the frame loses 31% of its sharpness after the kill. With the shake off it loses none, so the shake is the trigger. Patched, the death frames are sharper than the converged pre-kill frame. For the R12 GPU frames themselves, the same contrast-free metric on the lower-left asteroid falls from 0.20 (ref-prekill) to 0.108 (peak) for the carrier, and from 0.18 to 0.104 for the cruiser. Look at `evidence-crop-ref-vs-k10.png`: top row unpatched ref and k10, bottom row patched ref and k10. Full frames are in `frames/`.

## Limits (read before merging)

- **Not checked on a real GPU or in the live game.** SwiftShader only. The R12 GPU frames lost about 2x sharpness, and this repro loses 31%, so the mechanism is the same but the size is not.
- **This repro did not draw the capital fireball or wreck.** The hull vanishes with sparks. The shake still fired (trauma 0.50), which is what the blur needs, but the fireball, bloom and exposure contribution to R12's look was not reproduced. There were no hook or bus errors. Worth a separate look.
- **Trade-off:** at feedback 0.3 the shake frames carry less anti-aliasing, so more jaggies and shimmer while the camera shakes. Still frames looked clean at 2x zoom, but shimmer in motion was not judged. Tune `taaShakeFeedback` (higher means softer but steadier) and `taaShakeRamp` if it reads badly. Only the 0.3 / 0.08 pair was measured.
- An earlier 960x540 run with no pre-hits showed no difference between shake and no shake. The 1600x900 R12-schedule runs above are the ones the conclusion rests on.
- A separate, standing softness remains, outside this fix: converged TAA at rest is about 0.3x the Laplacian of a history-free frame. Some of that is anti-aliasing doing its job, and some is softness. `taaSharpen` is 0 in every tier on purpose (`postfx.js:1250-1255`).
- The low and medium tiers run SMAA with no TAA, so they were never affected and are unchanged by this patch.
