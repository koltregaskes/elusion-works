# Critic round 13: 5/10. Prows, altitude stalks and a clean top bar landed; the peak fight still reads through the HUD, and world marks print over it

**Method and limits.** Same as round 12:

- Headless Chromium on SwiftShader in a cloud session with no GPU, every frame stepped at 1/60 s.
- A fresh critic that had not seen the code scored the frames against the written checklist, rubric
  sections 3.1 and 3.9, and round 12's verdict. It wrote its R2 answers before it opened the key.
- PREV is `d89a849` (the build round 12 scored). NOW is `e0329b8` (round 13 fixes 1 to 4, and the
  round 12 follow-ups `ace83e7` and `40baf68`).

Evidence (1280 x 720 unless noted; seed 13634 unless noted):

- **Played peak.** AI against AI, framed on the densest cluster.
- **Staged battle.** Our fleet starts 3 km above theirs and is selected.
- **Player hulls.** Alone at 960 x 540, plus the hostile bone hulls as the reference.
- **The planet.** Seeds 13634 and 99.
- **Carrier and cruiser kill strips.**
- **The top bar at 2x.**

**Caveat on the played pair.** The prow taper moves weapon hardpoints, and combat fires from the
model's hardpoints. So PREV and NOW fight differently from the same seed and the played frames are
different moments. Each frame has its own answer key. Same build, seed and tick still give the same
state (`tools/sim-test.mjs`). The staged battle hashes match across both builds.

No blind A/B against Homeworld was run.

| Axis | R12 | **R13** | Why (frame) |
|---|---|---|---|
| Art direction & composition | 5 | **5** | The fight now sits over dark nebula with no planet. The played mid is no tighter than the wide. |
| Hull design & silhouette | 6 | **6** | The destroyer, cruiser and carrier have real prows. The mothership is still a stack of boxes, and the blue kit still does not look like the bone hostiles. |
| Materials & shading | 6 | **6** | No change. |
| Lighting & atmosphere | 6 | **6** | The planet bands are fixed. The dying carrier is a black cutout in front of its own fire, with no fire light on it. |
| VFX | 7 | **7** | The carrier's ribs and the cruiser's kill frame both read. The shock dome still shows a faint bubble edge at about +0.2 s. |
| Environment | 6 | **6** | The planet bands look like cloud now. The near rocks are still block lumps. |
| UI/HUD | 6 | **6** | The top bar is clean, the view fills the window, and the altitude labels exist. Against that, hull bars and hulls print over HUD digits, and sparks cover the hint text and the selection list. |
| Sense of scale | 5 | **5** | The played close frames one small hull at hero size, with no reference beside it. |
| Readability in combat | 5 | **5** | The bars mark the right units now. Who is winning still reads only from the fleet hull row. |
| Cohesion | 5 | **5** | Two hull languages, block rocks and a grey planet. |
| **Overall** | **5** | **5** | Axis mean 5.7. Capped by art direction and cohesion at 5 (eighth round), R5 at 4, and the stranger test. |

| Criterion | R12 | **R13** | Reason |
|---|---|---|---|
| R2 Combat legibility | 4 | **5** | The critic named all 3 nearest-death units on both the wide and the mid, from their bars, and got the side right each time. It still read the losing side from the HUD row only. Its one complaint: bars in quarters cannot rank 70% against 72%. |
| R3 Health at a glance | 5 | **5** | No friendly was under 30% at the peak, so the test did not bite. |
| R5 Spatial comprehension | 2 | **4** | Stalks and labels exist (+3.0, +0.7, +0.5 km), but only on the selected cyan hulls. There were none on the hostiles and no relative reading, so it still could not say which fleet was higher without orbiting. |
| P3 Proportionate destruction | 7 | **7** | Both round 12 defects are fixed. |

## Per-change verdicts

1. **Prows: PARTIAL.**
   - The destroyer ends in a needle bow, and the cruiser and carrier taper.
   - The assault frigate barely changes.
   - The mothership's bow is still square.
2. **Altitude stalks: PARTIAL.** They are faint, on our selected hulls only, and give height above
   the plane, not above the enemy.
3. **Top bar and nearest-death bars: PARTIAL.**
   - The top bar no longer overprints, and the bars mark the key's units.
   - The seam count is gone at 1280 px.
   - Hostile bars near the top edge print over HUD digits.
4. **Planet bands: VERIFIED.** The streaks are gone and the bands billow.
5. **The view fills the window and marks sit on their hulls: VERIFIED.** Diamonds sit a fixed 14
   to 18 px above their hulls, within 2 px horizontally, with no drift towards the edges.
6. **Carrier ribs and cruiser kill frame: VERIFIED.**

## What the integrator checked after the critic

- **World marks over HUD text: REAL, but older than this round.** The marker layer has always
  sat under the top bar in stacking order (z 1 against z 3). The top bar has no backing, though, so
  marks and hulls beneath show through its text. The 19 Oct blind pass (P51 finding 7) raised the
  same thing. Fixed in round 14 by clipping world marks out of every HUD panel.
- **The seam count is gone: REAL, caused by round 13 fix 3.** The fit pass dropped seams at its
  second level. Round 14 drops the per-meter You / Them words first, and seams only as a last resort.
- **Income disagrees between frames of one tick: REAL.**
  - The rate was credits per second of wall time, so it read double at x2 speed and nothing while
    paused.
  - The harness fast-forward made it read thousands per second.
  - Round 14 computes it per second of game time.
- **The planet left the played frames.** That is a different sim moment, not a defect.
- **Hard key light (standing finding).**
  - A runtime A/B scaled only the key light by 1.6x and 2.2x (`tools/harness/lineup.mjs
    --keymul`).
  - The brightest 1% of a destroyer's hull went from 115 to 121 to 130 out of 255, with no visible
    change: from the 3/4 view the camera mostly sees the shadow side.
  - A brighter key is not the fix. The lighting is left alone and the finding stays open. The
    likely levers are a camera bias toward the lit side or a specular rim, and both need a real
    screen to judge. **UNVERIFIED.**

## Would a stranger believe this is commercial?

**No.** The first five things that break it, most damaging first:

1. The biggest fight still reads as about 26 slivers of 10 to 15 px over a dark field. The mid is
   no tighter than the wide, and the winner reads only from a HUD row.
2. The overlay prints over the HUD.
3. The two sides look like two games, and the player mothership is a box stack.
4. Altitude is still not readable between the two fleets.
5. Scale lies in the close: a small hull at hero size with nothing beside it, and block rocks in
   the wide.

## Top fixes for round 14

1. **A HUD safe zone.** World marks never draw inside a HUD panel, and the hint text gets a backing.
2. **Altitude between the fleets.** Stalks on the hostiles near the selection, and a fleet label
   such as "+3.0 km over hostiles".
3. **Peak framing.** The mid is at least 1.5x tighter than the wide. The close holds a hull from
   each side and has a size reference.
4. **Hull bars that rank.** A continuous fill and three bars per side.
5. **The player kit.** Prows on the mothership and the frigates. Fire light on the dying hull.
