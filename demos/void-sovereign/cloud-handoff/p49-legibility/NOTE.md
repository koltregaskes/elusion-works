# P49: combat legibility, ships not glyphs (burn worker W1, 20 Oct 2026)

**Answer first.** At combat range the fights read as HUD icons because the hull is built to be invisible there, and the icon sits on top of it. Past about 22 hull lengths every ship becomes a distant impostor. That impostor is a grey sliver with almost no team colour, floored at only 9 to 12 px of hull length. Its value is chosen on purpose to sit inside the backdrop's own range. On top of it the HUD draws a 12 to 21 px amber class glyph or a cyan diamond, centred on the hull. The engine wake is capped at 0.35 *physical* hull lengths, which is about 1 px at 5 km, so the Homeworld streak was gone too. The patch makes the hull carry the read: a 14 to 18 px floor, team-colour strips on the impostor, a short wake measured against the hull as drawn, and contact marks that shrink, fade and lift off a hull once it is legible. In a matched headless A/B run (same seed, same sim tick, same camera), the visible-hull share of the combat region rose from 0.34 to 0.60, 0.21 to 0.42 and 0.22 to 0.44 at the three fleet-range moments. Hull pixels under a glyph fell by 55 to 84%. There were 0 console errors and no measurable frame-time change.

- Patch: `legibility.patch`, against `feat/void-sovereign-shell` **262342a** (the R12 branch the critics' frames came from). It touches 4 files and adds 157 lines, removes 21. `git apply --check` passes against a fresh `git archive` export of 262342a (exported with `core.autocrlf=false`, so line endings match the repo blobs). Nothing was applied to the repo.
- The patch does not overlap P44's death-blur patch (that one is `postfx.js` and `camera.js`).

## Cause, in code (line numbers at 262342a)

1. **The floor is too small to read.** `src/ships/catalog.js:617-619`: `HULL_FLOOR_MAX_GROW = 6` and `hullFloorPx = clamp(9 * (L/14)^0.15, 9, 12)`. The shader applies it at `src/ships/index.js:310` (`vsGrow = clamp(uMinPxR / vsPxR, 1, uMaxGrow)`), but only at LOD 2 and above (`index.js:210`, `IMPOSTOR_LOD = 2`, with `LOD_STEPS = [0, 6, 22, 70]` at `index.js:398`). A 14 m interceptor at 5 km is about 2.8 px of real hull, floored to 9 px long and about 2 to 3 px wide. In the base run, 59% of combat hulls at the 5.2 km moment and 73% at 8 km were under 10 px.
2. **The hull has no identity at range, by design.** `src/ships/index.js:350-351`: the impostor colour is `0x6d747c` with only 16% of the team's secondary colour. The fill floor at `index.js:222` (`IMPOSTOR_FILL = 0.10`) and its comment explain that the value is pitched to sit *inside* the nebula's range. So the hull reads as a silhouette at best, never as "ours" or "theirs".
3. **The glyph is drawn over the hull and outshines it.** `src/ui/select.js:144`: `HOSTILE_K = [0.6, 0.8, 1.05]` on a 20 px authored glyph gives 12, 16 and 21 px. `select.js:1299` and `1329` translate it to the hull's exact screen centre. Opacity is 0.42 to 1.0 (`select.js:1345`). Friendly diamonds are 6, 8 and 12 px (`select.js:90`), also centred. A 12 px outlined silhouette over a 9 px dim sliver is the brightest thing in that patch of sky, and it covers the ship. In the base run, 25 to 30% of all hull pixels in the fleet-range combat regions were under a glyph pixel.
4. **There is no wake at range.** `src/fx/engines.js:723`: `TRAIL_HULLS = PLUME_LEN_CAP` (0.35) is passed as the ribbon's span cap at `engines.js:1087` in physical metres. That is right up close (round 6's "laser pointer" fix), but at 5 km a 14 m interceptor's wake is about 5 m, roughly one pixel. The width floor is a 0.9 px hairline (`src/fx/index.js:1501`). Trails apply only to fast small craft (`engines.js:907`), which is unchanged.
5. Camera: the rig's combat FOV is about 48 to 52 degrees at 2 to 8 km (`src/core/camera.js:1228`, `_fovAt`). This is not a cause. It just sets how few pixels a ship gets.

## What the patch changes (4 files, all parameterised)

| | Where | What | Parameters (default) |
|---|---|---|---|
| (a) min hull size | `ships/catalog.js` | Floor raised from 9-12 px to 14-18 px of drawn hull length, grow ceiling 6 to 8. Same smooth clamp, so no pop: it binds only at LOD 2+, which starts at about 46 px. Engine glow, plume, trail, weapons and wrecks all read the same function, so they follow the drawn hull. | `HULL_FLOOR = {min 14, max 18, ref 14, exp 0.15}`, `HULL_FLOOR_MAX_GROW = 8` |
| (b) team strips | `ships/index.js` (impostor shader only) | Unlit team-trim strips: a girth band fore of midships plus a spine line on the top and bottom plating. They are in object space from the LOD 0 hull box, with anti-aliased edges (`fwidth`). The plates stay bone grey. Cost is one `mix()` per fragment, and no new draw calls or programs. | `IMPOSTOR_STRIP = {gain 1.35, band 0.62, bandHalf 0.075, spineHalf 0.14, spineFacing 0.35, mix 0.85}` |
| (c) engine trails | `fx/engines.js` | Wake span = round 6's 0.35 physical hulls, plus 2.2 *drawn* hulls that fade in only while the drawn hull is under 22 to 60 px. A close-up wake is unchanged. Width grows by sqrt(grow), so it stays thinner than the hull. Life is up to 2x at range. Count stays capped by the existing `trails` budget. | `TRAIL_FAR_HULLS 2.2`, `TRAIL_FAR_PX [22, 60]`, `TRAIL_WIDTH_GROW_POW 0.5`, `TRAIL_FAR_LIFE 1.0` |
| (d) glyphs yield | `ui/select.js` | Contact marks (hostile glyphs and friendly diamonds) shrink by up to 35%, fade by up to 55%, and lift to sit just above the hull once its drawn length passes 8 to 16 px. The drawn length uses the same floor arithmetic as the shader. A dying hull (30% or less) never yields: "about to die" stays at full strength. Hull bars are unchanged. | `GLYPH_YIELD_PX [8, 16]`, `GLYPH_YIELD_FADE 0.55`, `GLYPH_YIELD_SHRINK 0.35`, `GLYPH_YIELD_LIFT 5` |

## Before and after (matched pair: `before/` = base 262342a, `after/` = proto)

Harness: `harness/legibility.mjs`, built on P44's approach. It uses chrome-headless-shell 1228 under SwiftShader, run through `withChrome` (the shared lock), served from an in-process static server at 1600x900, quality high, seed 13634, grain off in both runs.
- The page loop is stopped synchronously when `ready` is set. The fixed-step, seeded sim is then stepped to world time 3.0 s before anything is spawned.
- Two mixed fleets of 22 and 25 hulls are spawned 3.6 km apart and attack-move into each other.
- The camera is fixed per moment: the rig's update is replaced by a pose on the engaged-ship centroid, with the rig's own `_fovAt` FOV.
- Each moment renders 30 converge frames on that pose.
- **Same moment proven:** the pre-spawn world hash and the per-moment hash of every spawned hull's position are identical in both runs (alive 46, 41, 38 and 30). The first pair (`pair1-unmatched/`) diverged because the real-time loop ran for a variable time before the harness took over. Its numbers were directionally the same, but do not quote them.

Metrics come from `harness/metric.py`. The combat region is the projected boxes of the staged fleets, padded 30 px, and the same region is used for both runs.
- **Hull size** is the max side of each ship's projected bounding box, with the floor applied as the shader does (computed, not pixel-measured).
- **hull px** is measured: hulls rendered alone on black.
- **glyph px** is measured: the DOM contact layer alone on black, with the seam ring hidden.
- **share** = visible hull px / (visible hull px + glyph px).
- **contrast** = |hull luma - luma of a 3 to 6 px ring around the hulls| in the shipped frame.
- **chroma** = mean (max - min channel) on hull pixels.

| moment (camera) | fighter median px | corvette median px | hulls < 10 px | hull px | glyph px | hull px under a glyph | **share** | contrast | team chroma | frame ms (median) |
|---|---|---|---|---|---|---|---|---|---|---|
| m1 wide 5.2 km | 7.5 to **11.7** | 8.9 to **13.9** | 59% to **0%** | 2155 to 3094 | 3168 to 2005 | 532 to **83** | 0.34 to **0.60** | 35.8 to 46.4 | 21.7 to 38.9 | 679 to 690 |
| m2 mid 2.0 km | 7.9 to **12.2** | 11.5 to **13.6** | 39% to 28% | 18433 to 18854 | 2868 to 3096 | 573 to **141** | 0.86 to 0.86 | 38.9 to 38.3 | 27.2 to 28.4 | 748 to 754 |
| m3 wide 5.2 km, steep | 12.9 to **20.0** | 12.8 to **20.0** | 0% to 0% | 1464 to 2245 | 3776 to 2936 | 456 to **158** | 0.21 to **0.42** | 65.7 to 73.6 | 18.2 to 38.6 | 740 to 737 |
| m4 fleet 8 km | 9.7 to **14.8** | 7.7 to **12.1** | 73% to **13%** | 1154 to 1731 | 2951 to 1999 | 315 to **139** | 0.22 to **0.44** | 56.1 to 64.8 | 13.9 to 32.3 | 678 to 673 |

- **Console errors:** 0 in both runs. Hook errors 0, bus errors 0.
- **Frame time:** the medians move by -0.7% to +1.7%, which is within run noise. This is SwiftShader on a loaded CPU, gl-synced per frame, and includes the HUD update. Treat it as "no measurable cost", not as a real-GPU number. The m1 means include first-use shader compiles in both runs.
- **m2 (2 km) is neutral on share.** At that range most hull pixels belong to frigates and the destroyer, which draw at LOD 0/1 with the untouched PBR material. Glyphs still came off the hulls (573 to 141 covered). The 28% under 10 px there are fighters seen nose-on: the floor is on length, so the bounding box foreshortens.

Frames to look at:
- Side-by-side full frames: `sbs/m1-wide-sbs-full.png` to `sbs/m4-fleet-sbs-full.png`.
- 2x crops of the combat region: `sbs/m*-sbs-crop2x.png`.
- Raw frames: `before/` and `after/`. Each moment has `-hud.png` (what the player sees), `-canvas.png` (no DOM), `-hull.png` (hull mask) and `-glyph.png` (contact layer).

What I saw in them: in the base, the fleet at 5 to 8 km is cyan diamonds and amber silhouettes with grey specks under them, which is the critics' F06 and F09 read. In the proto, the same ships are cyan and amber slivers with short tapered wakes. The marks are small and sit above them, and you can tell the two sides apart with the HUD ignored.

## Limits and unverified claims (read before merging)

- **UNVERIFIED on a real GPU and in live play.** This is SwiftShader only, with a fixed camera pose, not the rig's own composition. Nobody has played it.
- **Not judged in motion.** These are still frames. Strip shimmer at 14 px, and how wakes look when fighters turn hard (some curl into short "commas" in m1 and m3), are unjudged. If the wakes read as scratches, lower `TRAIL_FAR_HULLS` (try 1.5) before touching anything else.
- **New shading step at the LOD 1 to LOD 2 switch.** The strips exist only on the impostor (LOD 2+, about 46 px and below). A hull crossing that boundary gains or loses its strips. The old switch already changed shading model there, but the strips make it more visible. A fix would be to fade `uStripMix` to 0 above about 35 px of drawn hull. This was not done.
- **Side effects of the bigger floor are unverified:** `fx/weapons.js:1530` (target size for hit sprites), `fx/wrecks.js:263/294` and `fx/index.js:1420` (blast scale) all read `hullFloorPx`, so they grow with it. Nothing looked wrong in these frames, but none of it was checked on purpose.
- **Not checked:** whether lifting the marks changes click or hover picking (it should not if picking uses hull projection, but I did not test it), and the seam-ring and nebula clash (critic finding 4) and key light (finding 2), which are separate.
- **Section 3.3 of ARCHITECTURE ("colour from engines and trim, never plating").** The strips are trim, and the plates stay grey, but the art owner should agree with that reading.
- Only one parameter set was measured (the defaults above).

## Reproduce

`harness/run.sh <base|proto> <tag>` waits for 1.2 GB free RAM, then runs `legibility.mjs` under the shared Chrome lock. `harness/metric.py <outdir> <baseTag> <protoTag> <sbsDir>` computes the table and writes the side-by-sides. `harness/make_patch.sh` rebuilds the patch from `base/` and `proto/` and checks it against a fresh export. The `edit_*.py` files are the exact edits that turned `base/` into `proto/`. `base2.log` and `proto2.log` are the matched runs' logs.
