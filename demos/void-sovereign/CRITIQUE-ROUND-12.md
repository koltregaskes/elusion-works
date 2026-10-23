# Critic round 12: 5/10. Capital deaths are fire now and each class dies its own way, but the biggest fight still reads only from the HUD

**Method and limits.** First round run from a Claude Code cloud session, which has no GPU. Every
frame was rendered headless in Chromium on SwiftShader (software WebGL, about one frame a second),
so the game loop was stopped and stepped by hand at a fixed 1/60 s. PREV is `262342a` (round 12
fix 2, the build the 19 and 20 Oct blind passes saw). NOW is `d89a849`: round 12 fix 3 finished,
P49 ship legibility, P44 sharp death frames, P46 loading screen. A fresh-context art director that
had not seen the code scored the frames against a written checklist, the rubric (sections 3.1 and
3.9) and round 11's verdict. It wrote its R2 answers down before it opened the answer key.

Evidence set (1280 x 720, seed 13634; PREV and NOW of each unless noted):

- **Played peak.** AI against AI, fast-forwarded to the same sim tick in both builds (199 s, the
  largest fight in that match: 20 engaged, bombers and corvettes, no capitals). Wide, mid and close
  views, framed by the game's own focus camera.
- **Staged battle.** 42 hulls near an asteroid seam at 5.2, 2 and 8 km, with matching position
  hashes in both builds.
- **Death strips.** Kill strips for the carrier, cruiser and mothership; NOW only for the
  destroyer and frigate.
- **High tier.** A carrier at +1 s, with and without P44.
- **Loading card.** At 8 s and 20 s.

The frames live in the session scratchpad and are not committed: the repo keeps no review
artefacts. They can be rebuilt with the harnesses in `tools/harness/`.

**No blind A/B against Homeworld was run.** Nothing here compares with Homeworld.

| Axis | R11 | PREV | **R12 (NOW)** | Why (frame) |
|---|---|---|---|---|
| Art direction & composition | 5 | 5 | **5** | The played wide sits the fight over a planet that fills about 35% of the frame. The mid shot is the same scale as the wide. |
| Hull design & silhouette | 6 | 6 | **6** | At fleet range the hulls are team-coloured slivers now, but the class cannot be read. The player's blue industrial Mothership and the bone hostiles look like two games. |
| Materials & shading | 6 | 6 | **6** | No change. |
| Lighting & atmosphere | 6 | 6 | **6** | The planet's lit side no longer clips to white, but its bands read as a motion-blur smear. |
| VFX | 6 | 6 | **7** | Real fire on the kill frame, a soft shock front, deaths that differ by class, frames sharp under shake. |
| Environment | 6 | 6 | **6** | The near rocks are still low-poly lumps. |
| UI/HUD | 7 | 7 | **6** | Top-bar text collides at 1280 px. A new opaque band cuts the scene off at the bottom and left. Red brackets float off their hulls. *The band and the brackets were one bug, fixed after scoring (see below).* |
| Sense of scale | 6 | 6 | **5** | The played close frames one hostile hull with none of ours beside it. |
| Readability in combat | 5 | 5 | **5** | The sides now read apart. Who is dying still does not. |
| Cohesion | 5 | 5 | **5** | The fire suits the palette now. The rocks, the planet and the two hull languages still clash. |
| **Overall** | **5** | **5** | **5** | Axis mean 5.7. Capped by R2 at 4, art direction and cohesion at 5 for the seventh round, and the stranger test. |

| Criterion | R11 | **R12** | Reason |
|---|---|---|---|
| R2 Combat legibility | 4 | **4** | The critic named the losing side correctly, but only from the HUD's fleet hull row (71% against 85%), not from the scene. It got 1 of the 3 nearest-death units on each played frame, the one hull with a bar. It had read the red brackets as low hull, and they are not. |
| R3 Health at a glance | 5 | **5** | No friendly was under 30% at the played peak, so the test did not bite. Only one health bar shows in the wide. |
| P3 Proportionate destruction | 5 | **7** | Each class dies differently. The carrier is a white-cored fireball, then a split by +1 s. The destroyer is a keel plume. The frigate is gone by +1.5 s. The cruiser is a chain of section bursts. The mothership is a 5 s staged death with secondaries. The shock front is a soft dome, not a wire. **Against:** the carrier's ribs vanish behind the fireball from k0 to +0.3 s, and the cruiser's kill frame is a small bow burst. |
| Loading | n/a | **6** | Reads as a shipped game's loading card. The per-stage timings look like developer telemetry. |

## Per-change verdicts

1. **Fix 3 (kill-frame fire, per-class deaths, soft shock): VERIFIED, with two defects.** Both
   defects (the ribs and the cruiser's kill frame) were fixed after scoring.
2. **P49 ships, not glyphs: PARTIAL.** In the played wide all 20 hulls read as cyan or orange
   ships and the diamonds fade back. In the staged battle the rows of marks persist, and the marks
   sat 10 to 15 px off their hulls.
3. **P44 sharp under shake: VERIFIED.** Debris, ribs and stars are crisp at +1 s. The frame
   without P44 is smeared.
4. **P46 loading screen: PARTIAL.** The card is good. At 20 s the HUD is still fading in.

## What the integrator checked after the critic

The critic's five regressions were checked against the frames and the page, not taken on trust.

1. **The opaque bottom and left band: REAL, a P46 bug, FIXED in `ace83e7`.**
   - P46 named its loading-card rows `.vs-stage`, which is already the class of the container that
     holds the game canvas.
   - The row padding and border landed on that container, so every match drew at 1256 x 636 CSS px,
     24 px in from the left, with a 1280 x 648 drawing buffer and a 72 px black band below.
   - Renamed to `.vs-bstep`. Canvas and buffer are back to 1280 x 720, and the card is unchanged.
2. **Brackets and glyphs 10 to 15 px off their hulls: the same bug.** The HUD projects onto the
   full 1280 x 720 overlay, while the scene was drawn into the shrunken, offset canvas. The offset
   grows towards the edges, which matches what the critic saw. Fixed by the same commit.
3. **Staged battle composition (fleet pushed to the bottom of `m1`): the same bug.** The camera
   pose and sim state were identical, and the canvas was not. Fixed by the same commit.
4. **Carrier ribs vanish from k0 to +0.3 s: REAL, FIXED after scoring.**
   - The carrier fireball was pulled 0.14 of the hull toward the lens, which put it in front of the
     whole rib cage.
   - It is now pulled 0.02, so the near ribs cut it.
5. **The cruiser's small kill frame: REAL, FIXED after scoring.** The chain now opens with a
   burst 0.15 of the hull. Before, its first link alone was 0.05 of the hull box.

Not a game defect:

- **`played-close` lost our ships.** That is the harness choosing the largest engaged hull for the
  close, not a change in the game.
- **The HUD half faded at 20 s on the loading frame.** A screenshot taken while a software
  renderer holds the main thread catches CSS fades mid-flight.
- **"+2104.9 /s" income.** The income rate is per wall-clock second, and the harness fast-forwards
  the sim. It still overprints "SOVEREIGNTY" at 1280 px, which is real and is in fix 3 below.

## Would a stranger believe this is commercial?

**No.** The first five things that break it, most damaging first:

1. The biggest fight does not look like a fight. It is 20 slivers of 8 to 15 px over a planet, and
   who is winning reads only from the HUD.
2. The HUD overprints itself at 1280 px.
3. The band and the floating brackets (fixed since).
4. Red brackets do not mean low hull, so they mislead.
5. The environment does not match the ships: lump rocks, a streaked planet, and a player
   Mothership in a different style from the bone hostiles.

## Top fixes for round 13

1. **Make the peak frames show the fight.** The close holds at least one ship from each side. The
   wide holds at least 20 hulls of at least 12 px. The mid is at least 1.5x tighter than the wide.
   - *Acceptance:* the critic names 3 of 3 nearest-death units on the wide and the mid.
2. **Health in the overlay without selecting.** Hull pips on the three lowest ships per side in
   view.
   - *Acceptance:* every unit the key lists as nearest death has a visible bar.
3. **HUD collisions.**
   - *Acceptance:* no two text boxes overlap at 1280 x 720, and population agrees across panels.
4. **Marks tied to hulls.** One meaning per bracket colour.
   - *Acceptance:* bracket centres within 2 px of hull centres on 10 of 10 crops. Mostly done by
     `ace83e7`; re-measure.
5. **Cohesion.** Subdivide the near rocks, replace the streaked planet bands, and bring the
   player's capitals up to the hostile bone kit.
   - *Acceptance:* 3 rock crops at 2x with no facets, and a planet crop with no streaks.

The lane's standing order of findings is unchanged: player hulls, altitude cues, a HUD that says
who is winning, a hard key light, backdrop planets, a wide peak frame. Rounds 13 onward take them
in that order, with fixes 2 to 4 above folded into the HUD item.
