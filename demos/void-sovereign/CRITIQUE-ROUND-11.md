# Critic round 11: 5/10. A capital is finally in the peak close, and damage now ranks correctly blind, but the wide shows no enemy and the kill frame is still a spark

**Method and limits.** A fresh-context art director scored the R11 evidence set
(`.local/shots/R11/evidence/`), the fix-lane exhibits (`R11/fix1-*`, `fix2-*`, `fix3-*`) and R10.
The scoring follows `CRITIQUE-RUBRIC.md`. The budget was tight: I viewed the P1–P4 peak sheets, the
P3/end sheet, `P4-close`, `hud-numbers`, `fix1-s13634-A-close`, both kill-strip sheets, the kill-crop
sheet, `carrier-take2-04-peak` and the blind damage sheet. I read the played trace
(`_logs/played-s13634.json`). Crops are in `.local/shots/R11/critic/`. The rocks, boot screen, beats
and moves frames were **not re-viewed**; for those I relied on the manifest, because the manifest says
nothing changed. The game was not run.

**No blind A/B against Homeworld was performed.** The reference stills are copyrighted and cannot be
fetched, so nothing here is a side-by-side comparison.

| Axis | R9 | R10 | **R11** | Δ | Why (frame) |
|---|---|---|---|---|---|
| Art direction & composition | 5 | 5 | **5** | = | `P4-close` is the best peak frame yet: a bone carrier with its drives lit and the fight's debris behind it. But `P4-wide` (the peak) is a blown-out half-planet with 7 player specks and **0 hostiles**. The P3 wide and mid frames are rocks over black. |
| Hull design & silhouette | 6 | 6 | **6** | = | No ship change. The bone carrier is still the best asset. |
| Materials & shading | 5 | 6 | **6** | = | At 20%, the damage scorch and pocked fire read on the hull (blind sheet B). Rocks unchanged. |
| Lighting & atmosphere | 6 | 6 | **6** | = | The planet's lit half clips to flat white with a hard terminator (`P4-wide`, `P1-wide`, `hud-numbers`). |
| VFX | 6 | 5 | **6** | +1 | The detonation lands one frame after the kill, and hulls are split by +0.3 s (`sheet-strips-a/b`). Damage escalates (3/3 blind). The peak is an overexposed cream blob that looks the same on every class, inside a hairline wire ring (`carrier-take2-04-peak`). |
| Environment | 5 | 6 | **6** | = | Rocks unchanged. Front40 in the moves set is **up from 0 to 7 frames** (fighter moves). |
| UI/HUD | 7 | 7 | **7** | = | The pause copy is clear ("Sovereignty paused — battle in progress · 35 engaged"). **Every R10 contradiction is still there:** Hulls lost 131 against Hulls commissioned 49 (`end-screen`), population 36/55 with the queue unlabelled, and seam % unlabelled. "PAUSED · 2:31 MAX" does not say what it counts. |
| Sense of scale | 5 | 5 | **6** | +1 | For the first time, a ≥30-engaged played close has a capital: the hostile carrier at 314 px, with interceptor glyphs of 3–5 px beside it (`P4-close`). That gives a real size ratio. The wide and mid frames still have 0 capitals. |
| Readability in combat | 5 | 5 | **5** | = | See R2 below. Contact diamonds help with *where*. They do not show *who is dying*. |
| Cohesion | 5 | 5 | **5** | = | Low-poly slab rocks, a clipped flat planet, and now a cream-blob VFX language that matches neither the bone ships nor the fleet kit. |
| **Overall** | **5** | **5** | **5** | = | The axis mean is **5.8** (R10 5.6, R9 5.5). |

**Overall: 5.** No criterion is at 3 or below, so the **blocker rule is not triggered**. The mean
rounds to 6 and the overall still does not. R2 is still at 4. Art direction and cohesion are 5 for the
sixth round running. And every match a stranger finishes ends on an end screen with impossible
arithmetic. A 6 has to survive the stranger test, and this round does not (see below).

## The three criteria at 4

| Criterion | R10 | **R11** | Reason |
|---|---|---|---|
| **R2 · Combat legibility under load** | 4 | **4** | Rubric test: name the losing side and the three units nearest death. **No R11 played frame allows it.** `P4-wide` has 0 hostiles in frame. In `P4-mid`, hulls are under 10 px. In `P4-close`, the subject is a hostile carrier at 100%, and every other unit is a diamond glyph or a spark. The HUD says you are losing (27% against 99%) while "Hulls 42" against "Hostiles 28" says you are winning. |
| **R3 · Health at a glance** | 4 | **5** | On the hull, damage now ranks: I ranked the blind sheet **3/3**. At 4 km (`critic/r11-dmg-fleet4km-100-50-20-6x`), 20% shows a stern fire, smoke and a red-orange marker at about 45 px. **50% is a grey wisp a stranger would miss**, and its lights look the same as at 100%. Full FX apply to only the nearest 6 ships, and **no played R11 frame shows a damaged ship**. The best in-fight read is the developers' own `fix1-s13634-A-close` (a burning hostile capital). It earns 5, not 6. |
| **P3 · Proportionate destruction** | 4 | **5** | The carrier now visibly breaks into 3–4 sections by +0.3 s, sheds embers at +1 and +1.5 s, and drifts in smoke at +3 s (`sheet-strips-a`). That is the rubric's 5: **"same explosion, different scale factor"**. The destroyer, cruiser and carrier all peak as the same cream ellipse. No staged secondaries appear after +0.3 s apart from sparks, and the Mothership death was not tested. The **kill frame itself** is still a bow star on an intact carrier (0.04–0.07 of hull area, `sheet-killcrops` top row). |

## Did art direction, scale or cohesion move?

- **Scale: yes, to 6, on one frame.** The R10 cause ("no capital in any ≥30-engaged frame") is fixed
  for the close. The trace backs it: capitals engaged 1/1 on **29 of the 74 polls at ≥30**, and
  capitals near the hotspot 1/1 at times. The wide and mid frames still carry none.
- **Art direction: no.** The peak wide is the frame that sells a battle, and it shows a planet. The
  composed images (`P4-close`, `P2-close`, `fix1-A-close`) are portraits of one hull.
- **Cohesion: no.** None of its causes was touched: rocks, the planet, generic panel bone. A fourth kit
  arrived (the cream VFX).

## Blind damage ranking against the key

My ranking, written before I opened `R11-damage-blind-KEY.md`: **A = 100%** (clean), **C = 50%** (one
grey smoke plume, a few mid-hull sparks), **B = 20%** (stern fire over about a third of the hull,
heavy smoke). The key: A = 100, B = 20, C = 50. **3/3 correct. Five rounds after it was first asked
for, the R10 acceptance is met.** Caveats:

- The gap from 100 to 50 is carried by one smoke plume. Without it, A and C are the same ship.
- The selection brackets in C are a tell, which the manifest flags.
- At 20% the drives burn at full glow in the still. The "sputtering engine" cannot be judged from
  stills.

## Per-fix verdicts

### 1. e88714d, capitals gate and drain pause: **VERIFIED as coded. PARTIAL on the R10 acceptance.**

| Claim / acceptance | Verdict | Evidence |
|---|---|---|
| Launch only with capitals within 1.5 km | **Verified (log)** | `aiLaunch`: 788 s and 1066 s launches have caps 1 / capsIn 1. The 136 s launch had 0 capitals owned. |
| The pause starts at ≥20 engaged with ≥4 per side, once a side is ≤30% | **Verified (log)** | 4 pauses, the first at 484.5 s, with the player near 27%. |
| Each pause is capped at 100 s, with a 210 s budget | **Verified** | 577.2–677.2 s, "long", 100 s. Then 683.2–759.2 s, "cap". 11.5 + 22.5 + 100 + 76 = 210. |
| A ≥30-engaged frame with a capital per side, and a capital ≥150 px in the close | **Met for the close only** | `P4-close`: capitals in frame 1·1, the hostile carrier at 314 px. The carrier's engagement is not counted (only destroyers and cruisers are), and the wide and mid frames have 0. |
| Match end within 120 s of the last ≥30 poll | **Met on the letter** | The last ≥30 poll was at 1144 s, and the match ended at 1193.6 s (**49.6 s**). |
| It keeps the climax deciding the match | **Not shown** | Peak to end is **601.6 s**. At the peak it was already 27% against 99%. The pause postponed a defeat that had already happened; it did not let the battle change it. |

### 2. a851509, capital detonation: **PARTIAL. The break-up is real. "On the kill frame" and the frame-time claim are contradicted.**

| Claim | Verdict | Evidence |
|---|---|---|
| The primary fires on the kill frame | **Contradicted for the carrier** | Kill-frame flash is 0.04–0.07 of the hull on 5/5 takes (a bow star). The 0.7-hull fireball lands on `-03-kill-next`. The destroyer is 0.48 and the cruiser 0.29 on the kill frame. |
| Hulls ≥300 m break apart within 1.5 s | **Verified** | All 7 takes show 3–4 sections by +0.3 s, with spacing growth of 30–49 px at +0.3 s. |
| Peak 71–164 ms, flash/hull 0.77–1.12 | **Mostly** | R11 shows 38–217 ms (carrier take 3 at 217) and 0.78–1.23. |
| Max gaps of 22–29 ms | **Contradicted** | Carrier take 1 has **88 ms on the kill frame**, and take 2 has 39 ms. R10's worst was 47 ms, and never on the kill. |
| R10 acceptance: ≥0.5 within 100 ms on 5/5, a hull change at +300 ms, no gap >50 ms | **2 of 3** | The hull change is met 5/5. ≥0.5 within 100 ms is met 4/5 (take 1's kill-next is at 106 ms). The gap test fails on take 1. |
| The developers' concession, "overexposed cream glow" | **Agreed, and worse than conceded** | `carrier-take2-04-peak` is a set of soft white-cream discs with no temperature gradient, no fire texture and no occlusion by the ribs, inside a warped hairline ring that reads as a debug gizmo. |

### 3. 55348ed, escalating damage: **VERIFIED in staging. Unproven in a fight.**

- **Blind: 3/3.** At 912 m, 20% shows fire with dark breach pocks and smoke.
- **50% is subtle at 912 m and nearly invisible at 4 km**, as the developers concede.
- **"Failing lights" at 50% is not visible** in `fix3-damage-50-stern-frontlit`.
- The nearest-6 cap means most of a 50-engaged fight shows no damage. **No R11 played frame contains a
  damaged hull**, so R3's actual test (list friendlies under 30% mid-fight) is still unexercised.

## Regressions

1. **A carrier kill hitch of 88 ms, on the kill frame** (take 1), and 39 ms on take 2. R10 had 0
   gaps over 50 ms.
2. **Moves framing:** all-class front40 went from 0 to 7 frames, and back20 from 10 to 22
   (fighter and corvette moves, manifest §8).
3. **A new VFX tell:** the cream overexposed peak, the same on every class.
4. **Unchanged, now a second round:** HUD arithmetic. 28.85 s boot. Low-poly near rocks.

## One-line read of the key frames

| Frame | Read |
|---|---|
| `P4-wide` (peak, 50 engaged) | A white half-planet and its rings fill 40% of the frame, with a rock top right, star sparks, and 7 player specks. **No enemy.** |
| `P4-mid` | The same planet, lower down. Tracers and a few 10 px hulls. A glyph plot. |
| `P4-close` | **Best peak frame of the project.** The bone carrier at 314 px, with burn sparks at the bow and diamonds and debris at the upper left. It sits over a rock pile, and it is at 100%, so it says nothing about health. |
| `P2-mid` / `P2-close` | Ion beams, frigates and a hit spark. Then an ion frigate with a star hit. Competent frigate fights. |
| `P3-wide` / `-mid` | Rocks and black, with "35 engaged" in the HUD. Empty. |
| `hud-numbers` | The player Mothership at about 300 px with fighters around it: a good size read. Population 36/55, with 6 queued and unlabelled. |
| `end-screen` | DEFEAT over a blurred carrier. **Hulls lost 131, commissioned 49.** |
| Kill strips | A bow star, then a cream blob plus a ring on the next frame. Orange fire and split sections at +0.3 s. Embers at +1 and +1.5 s. Smoke and drifting sections at +3 s. The destroyer and cruiser look the same, just longer. |
| Blind sheet | A clean, a plume, a burning stern. Rankable. |
| `fix1-s13634-A-close` (developer exhibit) | A burning hostile capital with orange fire bands, and a player hull's drives below it. The strongest "capitals fighting" image in either round, but it is not in the evidence set. |

## Would a stranger believe this is a commercial game?

**No, though the gap is narrower than ever.** `P4-close` and the +0.3 to +3 s kill strip would pass
in a trailer. A stranger playing would still meet:

1. **A 29-second load.**
2. **A peak battle whose wide shot shows a planet and no enemy.**
3. **A carrier that dies by a spark** for one frame, then by a cream lightbulb, with a hitch on take 1.
4. **A match that ends 10 minutes after its climax.**
5. **Hulls lost 131 from 49 commissioned** on the end screen.
6. **Low-poly lump rocks** beside the best hull in the game.

## Top 5 fixes for round 12

1. **Frame the peak wide.** Targets: art direction, readability, scale.
   - **Acceptance:** at the max-engaged poll, the wide has ≥10 hostiles and ≥1 capital per side in
     frame, and the planet takes ≤20% of the frame.
   - Then pass the R2 test on that frame: name the losing side and the three units nearest death.
2. **Fix the HUD arithmetic. This is the third ask.** Targets: UI.
   - Make hulls lost count the same units as hulls commissioned.
   - Label the queued population.
   - Label the seam % against the sovereignty %.
   - Say what "PAUSED · 2:31 MAX" counts.
   - **Acceptance:** no two numbers on any frame contradict each other.
3. **Put the detonation on the kill frame, and give it fire.** Targets: VFX, P3.
   - Kill-frame flash ≥0.5 on the carrier.
   - Give the blob a hot core, cooler edges and rib occlusion.
   - Make the shock ring a soft disc, not a wire.
   - Vary the death by class, with staged secondaries on the carrier and above.
   - **Acceptance:** 5/5 takes with no gap over 50 ms, and a stranger able to tell a cruiser death
     from a carrier death.
4. **Damage in the fight, not in staging.** Targets: R3, R2.
   - 50% must read at 4 km: failing lights and a persistent plume.
   - Give damage FX by priority to ships under 50% near the camera focus, not to the nearest 6.
   - **Acceptance:** a played peak frame where three friendlies under 30% can be listed in 3 s
     without selecting anything.
5. **Cohesion: near rocks and the planet.** Targets: cohesion, environment, lighting.
   - Subdivide rocks within 1 km and stop the noise stretching. Retire the slab LOD.
   - Bring the planet's lit side out of clip, with surface detail and a soft terminator.
   - **Acceptance:** 3 rock crops at 2x with no facets, and a peak wide where the planet's lit side
     is not flat white.

**Standing items:** boot under 15 s; and a match end that follows the decisive battle, not one 600 s
after it.
