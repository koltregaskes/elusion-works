# Critic round 8: 5/10. The enemy finally has its own body; the rocks, the camera and the empty played match still give it away

**Method and limits.** A fresh-context art director scored the R8 evidence set
(`.local/shots/R8/evidence/`), the fix-lane exhibits (`R8/fix1-*`, `fix2-*`, `fix3-*`,
`bug-*`) and R7 for comparison, against `CRITIQUE-RUBRIC.md`, in the format of round 7.
All 89 new evidence frames were viewed, either full size or on the `_logs/sheets/`
contact sheets. Twelve were viewed full size. Verdicts that depend on detail were checked
on crops made with `crop.mjs`, which are saved to `.local/shots/R8/critic/` and cited as
`critic/…`. The 50-move totals, the played-match peak and the 26-combination draw test
were recounted from their JSON. The game was not run.

**No blind A/B against Homeworld was performed.** The reference stills are copyrighted
and cannot be fetched, so the "pick out the browser one" test was not run, and nothing
here is a side-by-side comparison.

**Evidence limits.**

- **The fleet battle is still STAGED** (28 ships a side, 33 engaged). The played match
  peaked at **19 engaged** (`_logs/played.json`: peak at game 701 s, `attackOrders` 0).
  The played frames show no fight.
- **22 of the 50 camera moves are STAGED** subjects, including 18 of the 27 frigate and
  capital moves.
- **There is no carrier frame between kill +0 and +1.04 s**, because the renderer stalls.
- **Flicker, fade timing and the haze ramp in motion cannot be judged from stills.**

| Axis | R6 | R7 | **R8** | Δ | Why |
|---|---|---|---|---|---|
| Art direction & composition | 5 | 5 | **5** | = | The bone faction gives the game an identity. However, 3 of 16 beats still fail as framings, and the camera now stipples rock across the subject. |
| Hull design & silhouette | 5 | 5 | **6** | +1 | `fix1-masks-after`: 13 of 13 pairs differ by faction in black mask. Hostile capitals blur together, and player hulls are still boxes. |
| Materials & shading | 5 | 6 | **6** | = | The sky floor keeps planes readable on the destroyer (`R8-cam-s13634-m2-destroyer-t9`). Bone is texel mottle at 2x (`critic/r8-staged-close-carrier-2x`). |
| Lighting & atmosphere | 6 | 6 | **6** | = | The matched haze pair works at 4.6 to 14 km. On 3 of 8 closes, shadow/lit is still below 0.07 (0.032 at the s13634 engagement close). |
| VFX | 6 | 6 | **6** | = | The hit flash at 1800 m is inside the hull (0.48). The kill is still a starburst plus a hard disc, and the carrier dies off camera behind a 1 s stall. |
| Environment | 5 | 6 | **5** | −1 | Faded rock is now a screen-door dither (`critic/r8-cam-destroyer-dither-3x`). Rock walls own whole frames, and slab LODs remain. |
| UI/HUD | 7 | 7 | **7** | = | Contact marks carry the STAGED mid. Otherwise unchanged. |
| Sense of scale | 5 | 5 | **5** | = | No close frame proves the 500 m haze ramp. The capital close parks a cruiser among rocks its own size. |
| Readability in combat | 5 | 6 | **6** | = | Shape now reads the faction, but credit is still for STAGED only. Played readability is 5, and 20% damage reads as 50%. |
| Cohesion | 5 | 5 | **5** | = | Naval gunmetal against bone works as faction language. Clay rocks, dither stipple and texel mottle still look like other kits. |
| **Overall** | **5** | **5** | **5** | = | The axis mean is **5.7**, the same as R7. |

**Overall: 5.** The hull gain is offset by the environment loss, so the mean does not
move. More importantly, what a stranger sees in ten minutes of play has not changed
enough: rocks fill the frame, the camera stipples, and the played match has no battle.
**No axis is at 3 or below, so the blocker rule is not triggered.** The closest thing to
a blocker is the carrier-kill stall, which is the §5 "first-run stutter" tell, landing on
the game's biggest kill.

## Did the four stuck axes move?

**One of four moved: hulls went from 5 to 6. Art direction, scale and cohesion did not.**

- **Hulls moved because the root cause was finally treated in geometry, not paint.**
  - `fix1-masks-before` shows 13 twins. `fix1-masks-after` shows 13 pairs that a
    stranger can split by faction from a black mask: swept spines, claws, rib fringes
    and one-sided fins against blocky prisms.
  - `critic/r8-lineup-hostile-carrier-3x` is a real creature design, a ribbed
    trilobite with a dorsal comb and hanging ribs. It is the most distinctive asset
    the project has made.
  - It stops at 6 because:
    - the hostile capitals (destroyer, cruiser, mothership) are one ribbed slug at
      three scales, and the carrier differs only by its longer ribs;
    - the hostile scout and interceptor are thin hooks that read as debris at range;
    - hostile LOD0 carries 27% of the player's triangles (`fix1-probe-after.json`,
      `lod0Sum.ratio` 0.273);
    - the player side is still Lego (`bug-fixed-capital-close-s99-destroyer`).
- **Art direction did not move because composition did not.**
  - `R8-s2718-first-contact-wide` is a wall of rock with no fleet in it.
  - `R8-s37-first-contact-close` is a 120 px bug in black.
  - `R8-s2718-engagement-close` stacks two box hulls on top of each other.
  - The new faction identity is real. However, the frames that would sell it are
    STAGED (`R8-fleet-STAGED-s13634-close`) or lucky (`R8-s99-first-contact-close`).
- **Scale did not move because the haze evidence is all at 3.7 to 14 km.**
  - The commit's point was the 500 m start. No measured rock pair, and no close, sits
    between 500 m and 1.5 km.
  - The capital close (`R8-cam-capital-close-s13634-cruiser`) puts a cruiser among
    boulders as big as it is, which destroys scale.
  - The only real size cue in play is still the Mothership flank
    (`R8-played-s13634-close`, right).
- **Cohesion did not move because the new faction is coherent, but the world around it
  is not.**
  - The rocks are clay potatoes in some frames and flat-cut slabs in others
    (`bug-fixed-capital-close-s99-destroyer`, left).
  - Faded rocks become a stipple.
  - The bone surface is magnified square texels.
  - Three kits are still on screen; only the ships improved.

---

## Per-fix verdicts

### 1. 0e4a599, hostile silhouettes: **VERIFIED as claimed. Faction is distinguishable; class within the hostile family is not.**

| Claim | Verdict | Evidence |
|---|---|---|
| Own bone shipyard for all 13 classes | **Verified** | `fix1-masks-before` against `-after`: every hostile outline changed. The colour lineup at HEAD (`R8-lineup-sheet`) matches. |
| Masks 13/13 distinguishable (player vs hostile) | **Verified, by eye** | `fix1-masks-after`. No probe scores it; the "after" probe JSON is labelled `wip3`. |
| Swept spines, bevelled rib bands, prongs, one-sided pods and fins | **Verified** | `critic/r8-lineup-hostile-carrier-3x`: ribs are curved bands, not R7's cube teeth. |
| Conceded: hostile capitals too alike | **Confirmed, and worse than conceded** | In `fix1-masks-after`, the destroyer, cruiser and mothership are the same comb-backed slug with a leg fringe. A stranger could not name them (rubric R1). |
| Conceded: hostile fighters thinner | **Confirmed** | The hostile scout and interceptor are hooks of about 2 px stroke in the masks. In `R8-lineup-sheet` cell 01, the scout is a scribble. |
| (Not claimed) surface | **Problem** | `critic/r8-staged-close-carrier-2x`: the bone body is a grid of square tan texels. R7's mottle remains and is now on the hero faction. |

### 2. ddf1705, depth in close shots: **PARTIAL.**

| Claim | Verdict | Evidence |
|---|---|---|
| Near/far gap −9.9 with haze, +0.7 without | **Verified as a number, but weak as an image** | `fix2-s13634.json`. The "near" rock is at 3742 m, not near. With haze on, it is 7.8 against a background of 7.9 (contrast 0.1), so haze makes it vanish rather than separate. The gap is 10 levels out of 255. |
| Haze reads in a matched pair | **Verified** | `R8-s2718-first-contact-wide` against `-hazeoff`: the mid cluster (around 800, 700) lifts to mauve grey, and the near left rock stays dark. The gap is −6.3 / −2.0. |
| Ramp starts at 500 m | **Not verified** | No measured pair, and no close frame, has a rock inside 3.7 km. |
| Subject shadow/lit 0.115–0.131 | **Partial** | 0.115 in `fix2-s13634.json`. At HEAD, the 8 closes range from 0.032 to 0.248. 3 of 8 are below 0.07: `R8-s13634-engagement-close` 0.032, `R8-s99-engagement-close` 0.063 and `R8-s99-first-contact-close` 0.069. |
| Gated to zero at the terminator | **Not testable from stills** | No banding is visible on any hull, which is consistent with the claim. |

### 3. 568d092, capital camera: **PARTIAL. The size bands work; the ghost claim is contradicted.**

- **Recount of `R8-cam-50move.json`:**
  - 50 moves, 27 of them frigate or capital (the ask was 15 or more).
  - front40 0, back40 4, total40 21, small 1, out 3.
  - **ghost 17 frames on 14 moves, 7 of them capital moves.**
- **The last settled frame is over 40% rock on 9 moves.** R7 had 3, but R7 had no capitals.
- **"Rocks fade fully instead of leaving ghosts" is contradicted.**
  - `R8-cam-s13634-m2-destroyer-t9` and `critic/r8-cam-destroyer-dither-3x` show a
    screen-door dither across about a third of the frame, and over the destroyer's
    lower hull.
  - It is uglier than R7's translucency, because the stipple reads as a rendering bug.
- **The 8% minimum height holds** for frigates and capitals (minimum hMinFH 0.086 and
  0.101).
- **"Rock behind" is scored but not limited.** `R8-cam-capital-close-s13634-cruiser`
  passes (back 0.229), yet boulders own about half the frame. The metric is right, but
  the threshold is too loose.

### 4. 51189bb, camera focus: **VERIFIED.**

- `bug-all.json` shows 26 of 26 class/team rows `drawn: true`, with `undrawn` empty.
- At HEAD, small frames fell from 14 to 1 and out-of-frame from 18 to 3 (manifest §4
  against `fix3-after-50move.json`).
- `bug-fixed-s99-m2-ionFrigate-t10` draws its subject; `bug-replay-*` did not.
- **The cost is the ghost rise from 10 to 17.** The focus now reaches hulls that sit
  inside rock fields, so more rock has to fade.

---

## Regressions

1. **Dither ghosts:** the stipple is on screen in camera moves
   (`critic/r8-cam-destroyer-dither-3x`), and ghost frames rose from 10 to 17.
2. **Carrier kill stall:** the render loop stops for about 1.0 s, in 2 of 2 runs
   (manifest §6). When it resumes, `critic/r8-carrier-kill-2x` shows an intact carrier
   with a small flash at the bow. The biggest kill has no kill frame.
3. **Shadow floor not holding on every beat:** 0.032 at the s13634 engagement close,
   against R7's 0.023 at the same seed. That is effectively unchanged where it matters.
4. **Bone texel mottle:** it now covers the faction that carries the art direction.
5. **Still unaddressed from R7:**
   - No played battle (fifth round).
   - Damage is a speckle band, and 20% reads as 50% (`_logs/sheets/dmg-crops.png`).
   - The kill flash keeps its disc rim and about 20 rays (`critic/r8-int-kill-3x`).
   - The rock slab LOD remains (`bug-fixed-capital-close-s99-destroyer`, left).
6. **Design asymmetry seen in passing:** the player population cap is 55 and the
   hostile cap is 99 (`played.json` `pop` 54/55/62/99). The commander's 30-ship order
   needs headroom the cap barely gives.

---

## One-line read of each new frame

| Frame | Read |
|---|---|
| `R8-s13634-first-contact-wide` (+`-hazeoff`, `-hud`) | A ringed planet with a terminator, and a charcoal rock knot on its face. The fleet is specks; on and off look the same at this range. |
| `R8-s13634-first-contact-close` | A gunmetal corvette at 171 px, a flat grey ghost rock beside it and two blurred tan discs above. Busy and unclear. |
| `R8-s13634-engagement-wide` | Planet, rings, tracers across its face, and rocks along the bottom. Decent poster, small fight. |
| `R8-s13634-engagement-close` | A 77 px frigate in silhouette (0.032) beside the planet. The composition is good; the subject is too small and too dark. |
| `R8-s99-first-contact-wide` (+pair, `-hud`) | Planet arc and dust. No rocks, and glyph fleets. Clean and empty. |
| `R8-s99-first-contact-close` | **Best played close.** A ribbed bone corvette with orange drives against a grey dust lane. It reads as an alien faction at a glance. |
| `R8-s99-engagement-wide` | Planet top, a spark cluster centre. Small event. |
| `R8-s99-engagement-close` | A hostile frigate at 287 px, nose-on, under three beams. Good action, though the hull is mostly a dark shape. |
| `R8-s2718-first-contact-wide` (+`-hazeoff`, `-hud`) | **Failed framing.** Wall-to-wall rock with no ship (0 player warships). It is the best haze proof and the worst beat. |
| `R8-s2718-first-contact-close` | A bone corvette at 132 px under a banded planet, with rock clusters left. Fine. |
| `R8-s2718-engagement-wide` | A rock field against amber and teal cloud. Handsome, but nothing happening. |
| `R8-s2718-engagement-close` | **Weak.** An Ion Frigate overlapping a box-tower hull behind it, with the planet at right. Two Lego shapes, one blob. |
| `R8-s37-first-contact-wide` (+pair, `-hud`) | Violet cloud and grey rock blocks. Glyphs. |
| `R8-s37-first-contact-close` | **Weak.** A 120 px bone corvette in black space. The hostile capital at the edge reads as a cage, which is the right idea. |
| `R8-s37-engagement-wide` | A bone capital, a small fire and rocks at right. Thin. |
| `R8-s37-engagement-close` | A gunmetal frigate with a strong blue drive (0.151). Tidy and plausible. |
| `R8-lineup-sheet` + 13 cells | Faction now reads by shape and colour. Within the hostile family, capitals and fighters each blur. |
| `R8-cam-*` (5) | Cruiser in a boulder nest, destroyer over a dither stipple, carrier in rocks behind the tutorial card, and two subjectless dust frames. |
| `R8-played-s13634-wide / mid / close` | Rock and cloud, an empty 2 km frame, and an "engaged" destroyer with nothing firing. The played game shows no battle. |
| `R8-fleet-STAGED-s13634-wide` | Planet and rocks own the frame; contact marks carry the battle. |
| `R8-fleet-STAGED-s13634-mid` | A swarm with a long beam slicing the frame and a flat-faced boulder. Busier and less legible than R7's two lines. |
| `R8-fleet-STAGED-s13634-close` | **Best frame of the project.** A bone carrier with burning drives, taking a beam, among rocks and dust. At 2x the hull is square texels. |
| `R8-death-interceptor-focus-00…09` | A contained starburst (0.31 of the hull) plus a separate hard white disc. The largest-blob metric excludes the disc. Gone by +0.6 s. |
| `R8-death-carrier-focus-00…08` | Hits, a 1 s freeze, a small bow flash, then smoke at +4 s, an ember spray at +8 s and two clean halves at +12 to +20 s. The staging is good; the kill is missing. |
| `R8-hitflash-assaultFrigate-1800m-00…03` | A 12x14 px flash on a 76x29 px hull. Within budget at last. |
| `R8-damage-friendly-50 / 20-stern-frontlit` (+crops) | Front-lit at last and legible, but the two frames are near identical: speckle along the deck, with no zones and no step. |
| `R8-damage-friendly-20-fleetrange` | A small hull at centre. The damage is invisible at fleet range. |
| `R8-bomber-firing-01…04` | The launch flash reads. After that, the bomber merges with the carrier behind it and the bolts are two short streaks, fired at 2383 m against a 1900 m range. |
| `R8-nebula-after-s{99,37}-sky-{a,b}` | Soft, dim dust with no contours. Metrics are unchanged from R7 (99 sky-b 0.0034, in-band 346,018 px). The 99 sky-a has only 475 px in band and is void. |
| Exhibits: `fix1-close-hostile-frigate` | A black spined hull against the planet with five starbursts, each wider than the hull. |
| Exhibits: `bug-fixed-capital-close-s99-destroyer` | A strong, well-lit destroyer, against a rock that is a flat-cut slab with smeared noise. |

---

## Would a stranger believe this is a commercial game?

**No.** For the first time, though, they would believe it had a commercial *concept*.
`R8-fleet-STAGED-s13634-close` and `R8-s99-first-contact-close` show an enemy with its
own anatomy, and that is the single most "real game" signal this project has produced.
In ten minutes of play, a stranger would still see:

1. **Rocks everywhere.** Whole frames are clay boulders (`R8-s2718-first-contact-wide`).
   When the camera fades them, they turn into a stipple.
2. **No battle.** The played match peaks at 19 engaged, and its frames show an empty
   frame and a ship that is not firing. Every good fight frame is STAGED.
3. **A freeze on the big kill.** A 1 s hitch is the fastest way to be filed as a tech demo.
4. **Lego on one side.** The player's own fleet is now the less designed faction.
5. **Damage that does not escalate.** A ship at 20% looks like one at 50%.

The engineering stays honest: the manifest reports its own failures, rejects bad takes
and keeps them. **5.**

---

## Ranked fixes for round 9

1. **Make a played match produce a battle** (`src/sim/`, fifth ask). Targets: readability,
   art direction, scale.
   - The commander needs 30 warships under a 55 cap. Either lower its mass trigger,
     raise the player cap, or let hostile waves converge on the player fleet.
   - Acceptance: a played frame with at least 30 engaged, wide, mid and close.
2. **Rocks: no stipple, no slab, no wall** (`src/core/camera.js`, `src/render/`).
   Targets: environment, cohesion, art direction.
   - Hide occluding rock outright (or move the lens), not by dither.
   - Fix the near LOD that shows cut planes.
   - Thin the fields in hero lanes, and cap rock behind the subject at 35%.
   - Acceptance: 0 ghost frames, and last-frame rock over 40% on no more than 2 of 50 moves.
3. **Hostile class identity and the bone surface** (`src/ships/bone.js`,
   `materials.js`). Targets: hulls, readability, cohesion.
   - Give the destroyer, cruiser, carrier and mothership different masses,
     proportions and appendage counts.
   - Thicken the fighters, so they read at 30 px.
   - Replace the square texel bone with a filtered procedural.
   - Acceptance: a black-mask sheet of the 13 hostiles alone, all distinct.
4. **Carrier kill** (`src/fx/`, renderer warm-up). Targets: VFX, art direction.
   - Remove the 1 s stall by pre-compiling the death path.
   - Give the kill frame a visible primary detonation.
   - Drop the disc rim and cut the kill rays to 4 to 6.
5. **Damage that escalates** (`src/fx/`, `materials.js`). Targets: readability, VFX,
   materials.
   - More hit slots, with breaches, fire and venting that grow at 50% and 20%.
   - Acceptance: a stranger can rank three frames by health. Also fix the Lance range bug.
6. **Scale in the close camera** (`src/core/camera.js`, `src/render/`). Targets: scale,
   lighting.
   - Prefer framings with a larger ship or the Mothership in depth.
   - Prove the 500 m haze start with a rock pair at 0.5 to 1.5 km.
   - Hold shadow/lit at or above 0.08 on all 8 closes.

**The top round-9 fix is #1.** The art can now carry a battle; the game must deliver one.
STAGED evidence has propped up readability for three rounds, and that credit ends at R9.

## Evidence required for round 9

- **The same 16 beats,** with H px, rock front and back, and shadow/lit per close.
  Re-roll the s2718 first-contact wide if it has no fleet.
- **A played match with at least 30 engaged,** with wide, mid and close timestamps.
  Otherwise, the cap and commander changes that were tried, and why each failed.
- **A hostile-only black-mask sheet** (13 cells), plus a lineup at 30 px hull height.
- **The 50-move camera test** with ghost frames, and last-frame rock over 40% per move,
  committed beside the frames. Include a crop of any frame that has a ghost.
- **A haze pair with a rock at 0.5 to 1.5 km**, on and off, matched.
- **The carrier death strip with a frame inside kill + 0 to 100 ms,** and the stall
  measured.
- **Damage at 100%, 50% and 20%,** front-lit, same framing, with at least 8 hit slots.
- **The Lance Bomber firing inside its range,** against clear sky, with the hull unoccluded.
