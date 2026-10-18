# Critic round 6: 5/10. The engines stop drawing lines; the sky, the rocks and the deaths still give it away

**Method and limits.** A fresh-context art director scored the R6 evidence set
(`.local/shots/R6/evidence/`) and the fix-lane frames it cites, against
`CRITIQUE-RUBRIC.md`. Round 5's frames were used for comparison. This was a
budget-limited pass: all 12 beat frames, the damage, death, plume, Mothership and
nebula items were viewed. Death and spark claims were checked on 2x nearest-neighbour
crops. Flash extents were measured with PIL thresholds. The near-plane totals were
recounted from `fix2-run1.json`. Crops and sheets are in `.local/shots/R6/critic/` and
are cited as `critic/…`. The game was not run.

**No blind A/B against Homeworld was performed.** The reference stills are copyrighted
and cannot be fetched, so the "pick out the browser one" test was not run, and nothing
here is a side-by-side comparison.

**Evidence limits.**

- **There is no fleet battle anywhere in the R6 set.** R5's best frame was staged. R6
  staged nothing, and the played engagements have only 0 to 4 hostiles engaged.
  Readability in combat is therefore not demonstrated this round.
- **The fix-lane death frames were shot from the working tree.** They are stamped
  07:24 to 07:28, and commit 4923296 is stamped 07:29. They are treated as
  post-fix evidence, because the manifest uses them that way.
- **Flicker, taper and the dither-fade cannot be judged from stills.**

| Axis | R4 | R5 | **R6** | Δ | Why |
|---|---|---|---|---|---|
| Art direction & composition | 5 | 5 | **5** | = | Two of 12 beats are owned by rock faces, and no frame matches R5's staged best. |
| Hull design & silhouette | 5 | 5 | **5** | = | There was no model work. |
| Materials & shading | 5 | 5 | **5** | = | Damage is localised and cools, but it is still a speckle band. The debris is still amber cardboard. |
| Lighting & atmosphere | 5 | 6 | **6** | = | The Mothership holds 0.134 in play. The planet's lit side is still a flat disc. |
| VFX | 4 | 5 | **6** | +1 | The plumes are fixed in every close frame and the hex bubble is gone. The deaths are still fireworks. |
| Environment | 6 | 6 | **5** | −1 | The seed-99 maze nebula and faceted close-range rocks own 4 of 12 beats. |
| UI/HUD | 7 | 7 | **7** | = | Unchanged. The filled red diamond is still oversized. |
| Sense of scale | 5 | 5 | **5** | = | |
| Readability in combat | 6 | 6 | **5** | −1 | The played engagements are 0 to 4 hostiles, with a frigate cut off by the frame edge. |
| Cohesion | 5 | 5 | **5** | = | |

**Overall: 5.** The axis mean is **5.4**, against 5.5 in R5. **No axis is at 3 or
below, so the blocker rule is not triggered.**

Round 6 fixed the thing a stranger saw first in R5: engines no longer lay 3 to 4 hull
lengths of light across the screen. The black-frame camera is gone on the metric, the
hex shield is gone, and a lost context now comes back. The score still does not move,
for three reasons. The backdrop fix did not land. The close camera now parks against
rock faces instead of inside them. And the death flash the commit says lost its lens
cross still throws a 500 px X across the screen.

---

## Per-fix verdicts

### Fix 1 (15a4f2e), plumes and trails: **PARTIAL. Visually fixed at cruise; the developers' own metric disagrees.**

- **Plumes at cruise: VERIFIED by eye.** In `critic/fix1-plumes-sheet.png`, the
  interceptor's frame-wide cyan bar, the corvette's 450 px orange shaft and the bomber's
  vertical beam are all gone in the `fix1-after-*` frames. Each drive is now a nozzle
  glow of roughly 0.2 to 0.3 times the hull.
- **The beats agree.** The plumes in `R6-s99-first-contact-close` (three hostile
  corvettes) and in `R6-s99-engagement-close` and `R6-s2718-engagement-close`
  (frigates) are all under about 0.3 times the hull.
- **The developers' measurements contradict the claim.**
  - `fix1-after.json` still reports interceptor `plume.overHull` **3.18** and bomber
    `engineTrail.overHull` **1.95**.
  - It reports missile-corvette plume and trail of **1.33** and **1.34**.
  - Either the metric counts nebula and bloom differences, or the trail is still
    there off the visible band. Either way it is not an acceptance number, and it
    must be fixed or explained.
- **A long ribbon remains in a neutral frame.** `R6-s13634-engagement-close`
  (`critic/r6-crops-a.png`, right) has a tan ribbon about **450 px** long behind a
  craft under 20 px. It is either a missile smoke trail or a fighter trail. Either
  way, it is the longest line on screen.
- **The bomber firing was not captured.** This was requested in R5 and is still open.

### Fix 2 (0144672), camera near-plane: **VERIFIED on the metric. A new framing fault replaces the clip.**

- `fix2-run1.json` reports **50 moves, 700 samples, 0 bad frames, worstBack 0**
  across 13634, 99 and 2718. This was recounted, not taken from the manifest.
- There is no black frame in the 12 beats.
- **But the follow camera now sits against rock instead of inside it.**
  - `R6-s99-engagement-close` is about **75% faceted rock face**, with hard polygon
    edges and smeared noise texture. The subject frigate is cut by the left edge.
  - `R6-s13634-engagement-wide` is about **60% rock**, and the fight is one spark
    (the capture lane's flag is confirmed).
  - A camera that cannot clip but parks against rock faces still produces an
    unusable frame. The dither-fade itself is not visible in any frame, so it is
    unverified.

### Fix 3 (c769ed1), damage tied to hits: **PARTIAL. Cooling and wreck char are real; the zones are not.**

All evidence is in `critic/damage-sheet.png`.

- **The far side stays clean: VERIFIED, but the test is weak.**
  `R6-damage-other-side-50-focus` shows no marks. However, that side is a backlit
  silhouette against the planet, where marks could hardly show. On the hit-side
  control (`-50-hitside`), the damage is only faint flecks on a pale, front-lit hull.
- **The cracks cool: VERIFIED.** The bright peach speckle of `fix3-20-focus` drops to
  dark red in `fix3-20-cooled` (5.5 s after the last hit).
- **Wrecks get dark char: VERIFIED** (`fix3-wreck`).
- **"Three to five local zones with clean plating between": NOT VERIFIED.**
  - `fix3-50-focus-crop` and `fix3-20-focus-crop` show one continuous speckle band
    along the upper hull, from the bow to the tower.
  - The two frames are nearly indistinguishable, so 50% and 20% do not read
    differently.
  - The five hit records span z −138 to +133 on a 380 m hull. The radius is spread
    over the whole hull, so "local" covers everything.
- **The filled red diamond (about 25 px) is still on the hull** (`fix3-20-cooled`).

### Fix 4 (4923296), shields, cores, flare and rings: **PARTIAL. Two verified, one contradicted.**

All evidence is in `critic/fix4-deaths-sheet.png`.

| Claim | Verdict | Evidence |
|---|---|---|
| Hex shield deleted, small ripple | **Verified** | `fix4-death-carrier-focus-01`: a small flash at the hit point and no tiled bubble. The core is 27x25 px. |
| Cores at 8 px or less beyond 900 m | **Verified** | The close beats have a 1x1 px core or none. The wide beats reach 15x15 px, and that is an impact on a foreground rock (manifest §4). |
| The 79x64 px core at focus (interceptor) | **Acceptable as a core** | It is about 0.17 times a hull of about 460 px (`-00-prehit` thresholded at 200 or more). The core is not the problem; the next row is. |
| Lens cross removed | **Contradicted** | `fix4-death-interceptor-focus-01` has a **four-arm X flare about 510x540 px**. It reaches about 2.7 times the hull's height, beyond the silhouette that the commit says flashes stay inside. `-02` has a six-spoke version. A stranger reads both as a lens cross. |
| Shock rings are hairlines | **Partial** | The cruiser ring is a thin ellipse (`cruiser-06`), which is close. The carrier ring is a 6–8 px glowing, wobbly band around a dense radial spark burst about 300 px across (`critic/r6-crops-a.png`, left), so the "radial streaks" are still there as sparks. The debris is still flat amber cardboard. |

### Fix 5, backdrop: **NOT VERIFIED (did not land, and the developers say so).**

- **The seed-99 maze nebula is confirmed** (the capture lane's flag). It covers about
  45% of `R6-s99-first-contact-close` and most of the lower half of `-wide`, and it
  dominates all three `fix1-after-*` frames.
  - It is the **same pattern** as `R5-s99-first-contact-close`, so it is unchanged,
    not a regression.
  - Round 5's "the worm maze is gone" was too generous. This is braided rope, not
    dust.
- **The manifest's nebula crops are the wrong window.**
  `R6-nebula-s37-sky-a-brightest-crop2x` looks soft because the brightest window
  avoids the maze. The contours live at mid-luminance.
- **Still open:** the impostor slabs and the flat lit side of the planet. The planet is
  a flat white disc behind the destroyer in `R6-damage-other-side-50-focus`.

### Fix 6 (effdac5), context restore and boot: **PARTIAL. Restore verified; pacing not done.**

- **The context restore: VERIFIED.** In `.local/r6f6/ctxrestore-1337.json`, restores
  go from 0 to 1. Calls are 84 before and 84 after, triangles are 794,032 before and
  after, and the fatal panel is not shown.
- **Seed 2718 booted 10/10 clean: VERIFIED** (manifest §2). However, the cause of R5's
  VALIDATE_STATUS failure was never identified. Going from 2 failures in 3 boots to 0
  in 10, with no fix aimed at it, suggests it is intermittent, not cured.
- **The seed-13634 opening: explained and accepted.** R6 opens with 18 warships.
  R4's 17 were spawned by the harness.
- **The played-match battle: NOT DONE.** This is the third round it has been asked
  for.

---

## Regressions

1. **The close camera parks against rock faces** (`R6-s99-engagement-close`,
   `R6-s13634-engagement-wide`). This is plausibly a side effect of 0144672: the
   camera is kept out of rocks but not away from them.
2. **No battle in the evidence set.** Readability drops from 6 to 5 because nothing
   shows ships fighting as fleets. The played engagements have 0 to 4 hostiles
   engaged.
3. **The developers' plume metric now contradicts their own fix** (`fix1-after.json`).
   This is a process regression: an acceptance number nobody believes.
4. **Still unaddressed:**
   - the interceptor's orange-and-white blotch camouflage (`fix4-...-00-prehit`);
   - the Mothership's grey texel-checker plating (`R6-mothership-tutorialcam-s2718`).
     It holds the lighting contract at 0.134, but reads as stucco;
   - the blocky, palette-swapped hostile capital (`R6-s13634-engagement-close`, top
     right);
   - the title art in a different style from the game.

---

## One-line read of each new beat frame

| Frame | Read |
|---|---|
| `R6-s13634-first-contact-wide` | A well-lit rock cluster on the left and soft blue cloud in the centre. The fleet is specks. A competent establishing shot with no event in it. |
| `R6-s13634-first-contact-close` | A player corvette with a short blue drive. It reads as a model, not a ship in a fight: it is engaged, but no fire is visible. |
| `R6-s13634-engagement-wide` | **Failed framing.** About 60% faceted rock, and the battle is one spark and one streak. |
| `R6-s13634-engagement-close` | A nose-on hostile frigate glowing orange, with a spark fan and two bloom puffs of about 50 px. A 450 px tan ribbon crosses the sky, and a blocky front-lit tower capital sits top right. |
| `R6-s99-first-contact-wide` | The ringed giant is still a good backdrop. A grey braided-rope nebula takes the lower third, and the fleet is glyphs. |
| `R6-s99-first-contact-close` | Three rust corvettes with short, correct drives: the best engine frame yet. It is ruined by the maze behind them (about 45%) and a smeared foreground rock. |
| `R6-s99-engagement-wide` | Giant, rocks and dots, with 0 hostiles engaged. Nothing is happening. |
| `R6-s99-engagement-close` | **The worst frame in the set.** Rock faces fill about 75% of it, with polygon facets and noise smear, and the frigate is cut by the frame edge. |
| `R6-s2718-first-contact-wide` | Brown rock clusters, a cyan smudge and specks. The emberfall colour works, but there is no subject. |
| `R6-s2718-first-contact-close` | Rocks frame a soft amber cloud nicely. The "close" subject is a corvette of about 40 px, with a cyan bloom smear at the top. Pleasant, but not a close. |
| `R6-s2718-engagement-wide` | Giant, moon, rocks, a small Mothership and glyphs. Decent depth, with 2 hostiles engaged. |
| `R6-s2718-engagement-close` | A frigate with a short drive in amber dust among rocks. Tidy, and the most "game-like" close in the set. |

---

## Would a stranger believe this is a commercial game?

**No.** Round 6 removed the loudest tell, but the next layer is now in plain view.

In the first ten minutes, a stranger would see:

1. **A seed whose sky is braided rope.** On ironmoth, the nebula is the biggest thing
   on screen, and it looks like a procedural-noise bug.
2. **A camera that ends up looking at rock.** The black frames are gone, but the close
   follow camera can still deliver a screen of grey facets with the ship cut off.
3. **Deaths that are fireworks.** The ship the player watches most closely, the small
   one, dies in a giant X. The carrier dies in a soap bubble full of sparks and
   cardboard.
4. **No battle.** The played match still resolves on sovereignty with a handful of
   ships engaged. The art is built for a fleet fight the game does not produce.
5. **Placeholder surfaces:** the camouflaged interceptor, the stucco Mothership, slab
   impostors and a flat planet.

The engineering is honest. The manifest is exemplary, and three claims were verified
cleanly. The visual floor rose a little, but the axes the stranger judges first
(environment and combat) fell. **5.**

---

## Ranked fixes for round 7

1. **The backdrop, third attempt, with a different method** (`src/render/skybox.js`).
   - Stop tuning the density-edge term and remove it: no darkening keyed to the
     gradient of the density.
   - If ironmoth's field still braids, replace its noise basis. Use a low-frequency
     domain-warped fbm with no ridged or abs() octaves, because the rope look is a
     ridged-noise signature.
   - Measure contours with an edge-density metric at mid-luminance, not the brightest
     window.
   - In the same pass, give the planet's lit side a gradient and give impostors a
     terminator and a contrast floor.
   - Acceptance: seed 99 first contact, with no closed contour loops visible at 2x.
2. **Make the played match produce a battle** (seam drain and commander muster in
   `src/sim/`).
   - Slow the drain or raise the attack threshold until 30 or more hostiles are
     engaged before minute 12.
   - If this cannot be done, ship a scripted set-piece in the opening as a fallback.
3. **Close-camera framing against rocks** (`src/core/camera.js`).
   - After the near-plane guarantee, score candidate positions by the share of the
     screen covered by rock and the subject's screen size.
   - Reject any position where rock covers more than 40% or the subject is clipped by
     the frame edge.
   - Fade any rock between the camera and the subject, not only rocks that cut the
     near plane.
4. **Small-ship and carrier deaths** (`src/fx/explosions.js`).
   - Find what draws the X and the six spokes. It is not the core, and the sprite
     change did not remove it.
   - Keep every element of a strike-craft death inside 1.2 times the hull's screen
     bounding box.
   - Cut the carrier's radial spark burst to sparse embers, and draw its ring at the
     cruiser's thickness.
   - Give the debris the wreck's dark char material instead of amber.
5. **Damage as zones** (`src/render/materials.js`).
   - Cap the scorch radius at about 8–10% of hull length per hit.
   - Merge nearby hits instead of widening the radius.
   - At 20%, show more and larger zones, so that 50% and 20% read differently.
   - Swap the filled red diamond for an outline of 12 px or less at focus range.
6. **Surfaces that read as placeholder** (`src/ships/`).
   - Mothership plating: break up the grey texel checker.
   - Interceptor livery: replace the blotch camouflage with the faction's rust trim.
   - Fix or explain the plume metric in `fix1-*.json`, and capture the bomber firing.

**The top round-7 fix is #1.** The nebula fills the frame for an entire match, and it
has failed twice.

## Evidence required for round 7

- **The same 12 beats** (seeds 13634, 99 and 2718), with the subject's screen size in
  px and the rock-coverage share for every close frame.
- **Seed 99 and seed 37 nebula frames, before and after,** at 2x, cropped where the
  contour metric is worst, not where the sky is brightest. Include the nebula's share
  of each frame.
- **A played match with at least 30 hostiles engaged,** wide and close, with time
  stamps. Otherwise, the drain and AI changes that were tried and why they failed.
- **Death strips at focus distance** for an interceptor and a carrier, with the flash
  bounding box (all elements, at a threshold of 110 or more) divided by the hull's
  bounding box.
- **Damage at 50% and 20%,** with the hits clustered at the stern. Both sides should be
  front-lit, not silhouetted, and a frame at fleet range should be included.
- **Plumes:** a fixed metric that agrees with the frames, plus the Lance Bomber firing,
  with the hull in frame.
- **Seed 2718 for 30 boots, or the root cause of VALIDATE_STATUS.**
- **The Mothership and a hostile capital at fleet range,** each with a shading sample
  from the impostor.
